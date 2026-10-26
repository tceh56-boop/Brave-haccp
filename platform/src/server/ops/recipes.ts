import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { withSystem, type Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { roleHas } from '../access/roles';
import { inOrg, parse, optText, openTask, fmtNum } from './common';
import { versionSteps, defaultSteps, applyLineSteps } from './processing';
import { chain, retention, type From } from '../recipes/chain';

/**
 * Блюда, полуфабрикаты и ТТК (ТЗ v1 §9, §12; этап 6 ТЗ v2). Версия ТТК: черновик → на согласовании → утверждена →
 * архив. Утверждённая версия не меняется (триггер в базе) — изменения новой версией. Утверждает человек с правом
 * ttk.approve; списание при производстве и продаже — только по утверждённой версии.
 * Себестоимость — по ценам партий из документов поставки; нет цены — себестоимость неполная, а не нулевая.
 * Обработка сырья: брутто → холодная → нетто → тепловая → выход по нормам организации (processing.ts).
 * КБЖУ — из справочника MON CHEF по закладке нетто с потерями нутриентов по нормам тепловой обработки (если заданы); пока записи
 * справочника не проверены (Б-5), результат помечается как ориентировочный.
 */

export const TTK_STATUS: Record<string, string> = { draft: 'Черновик', review: 'На согласовании', approved: 'Утверждена', archived: 'Архив' };
export const KIND_LABEL: Record<string, string> = { dish: 'Блюдо', semi: 'Полуфабрикат' };
type Unit = 'кг' | 'г' | 'л' | 'мл' | 'шт' | 'порция';
const UNITS: Unit[] = ['кг', 'г', 'л', 'мл', 'шт', 'порция'];
const BASE: Record<string, { dim: string; k: number }> = { 'кг': { dim: 'm', k: 1000 }, 'г': { dim: 'm', k: 1 }, 'л': { dim: 'v', k: 1000 }, 'мл': { dim: 'v', k: 1 } };
const r2 = (n: number) => Math.round(n * 100) / 100;

export const normName = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[«»"'.,()]/g, ' ').replace(/\s+/g, ' ').trim();

/* ───────────── Архив ТТК (справочник платформы) ───────────── */

export const TTK_ARCHIVE_FILE = path.resolve(__dirname, '../../../data/reference/ttk_archive.json');

interface ArchiveCard { source_path: string; category_path?: string[]; name?: string; yield_raw?: string; yield_g?: number | null; yield_source?: string; basis?: string; format?: string;
  lines: { no?: number; name: string; unit: string; brutto: number | null; netto: number | null; ready?: number | null; is_portion_ref?: boolean; portion_g?: number | null }[]; technology?: string; issues?: string[] }

/** Загрузка архива ТТК (повторная — обновляет по пути файла, ничего не удаляет). */
export async function importTtkArchive(file = TTK_ARCHIVE_FILE) {
  const data = JSON.parse(readFileSync(file, 'utf8')) as { cards: ArchiveCard[] };
  return withSystem(async (tx) => {
    let n = 0;
    for (const c of data.cards) {
      if (!c.name) continue;
      await tx.query(`insert into ttk_archive (source_path, category_path, name, yield_raw, yield_g, yield_source, basis, format, lines, technology, issues)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        on conflict (source_path) do update set category_path = excluded.category_path, name = excluded.name, yield_raw = excluded.yield_raw, yield_g = excluded.yield_g,
          yield_source = excluded.yield_source, basis = excluded.basis, format = excluded.format, lines = excluded.lines, technology = excluded.technology, issues = excluded.issues, imported_at = now()`,
        [c.source_path, (c.category_path || []).filter((x) => x !== 'ttk'), c.name, c.yield_raw || null, c.yield_g ?? null, c.yield_source || null, c.basis || null, c.format || null,
          JSON.stringify(c.lines || []), c.technology || null, JSON.stringify(c.issues || [])]);
      n++;
    }
    await audit.record(tx, { action: 'ttk_archive.import', entityType: 'ttk_archive', after: { cards: n } });
    return { cards: n };
  });
}

export async function listArchive(userId: string, orgId: string, opts: { q?: string | null; category?: string | null } = {}) {
  const q = normName(String(opts.q || ''));
  return inOrg(userId, orgId, 'menu.read', async (tx) => {
    const rows = (await tx.query(`select a.id, a.name, a.category_path, a.yield_g, a.basis, a.format, jsonb_array_length(a.lines) as lines, jsonb_array_length(a.issues) as issues,
        d.id as dish_id from ttk_archive a left join dishes d on d.archive_id = a.id and d.organization_id = $1
      where ($2 = '' or lower(a.name) like '%' || $2 || '%') and ($3::text is null or a.category_path[1] = $3)
      order by a.category_path, a.name limit 300`, [orgId, q, opts.category || null])).rows;
    const categories = (await tx.query(`select category_path[1] as name, count(*)::int as n from ttk_archive group by 1 order by 1`)).rows;
    return { cards: rows, categories };
  });
}

export async function getArchiveCard(userId: string, orgId: string, id: string) {
  return inOrg(userId, orgId, 'menu.read', async (tx) => {
    const c = (await tx.query(`select a.*, d.id as dish_id from ttk_archive a left join dishes d on d.archive_id = a.id and d.organization_id = $2 where a.id = $1`, [parse(z.uuid(), id), orgId])).rows[0];
    if (!c) throw Errors.notFound('Карта архива не найдена.');
    return c;
  });
}

const cardUnit = (u: string): Unit | null => (UNITS.includes(u as Unit) ? (u as Unit) : u === 'гр' ? 'г' : null);

/** Импорт карт архива в организацию: блюдо + черновик ТТК; сырьё сопоставляется по запомненным названиям. */
export async function importFromArchive(userId: string, orgId: string, input: unknown) {
  const d = parse(z.object({ archiveIds: z.array(z.uuid()).min(1, 'Выберите карты.').max(600) }), input);
  return inOrg(userId, orgId, 'ttk.manage', async (tx) => {
    const res = { dishes: 0, skipped: 0, lines: 0, matched: 0 };
    for (const id of d.archiveIds) {
      const c = (await tx.query(`select * from ttk_archive where id = $1`, [id])).rows[0];
      if (!c) throw Errors.notFound('Карта архива не найдена.');
      if ((await tx.query(`select 1 from dishes where organization_id = $1 and (archive_id = $2 or (status = 'active' and lower(name) = lower($3)))`, [orgId, id, c.name])).rowCount) { res.skipped++; continue; }
      const kind = /п\s*\/\s*ф|полуфабрикат/i.test(`${c.name} ${(c.category_path || []).join(' ')}`) ? 'semi' : 'dish';
      const dish = (await tx.query(`insert into dishes (organization_id, name, kind, category, archive_id, created_by, card_no) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [orgId, c.name, kind, (c.category_path || []).slice(-1)[0] || null, id, userId, await nextCardNo(tx, orgId)])).rows[0];
      const portion = kind === 'dish' && c.basis === '1 порция' && c.yield_g ? c.yield_g : null;
      const v = (await tx.query(`insert into ttk_versions (organization_id, dish_id, version, yield_g, portion_g, technology, source, created_by)
        values ($1, $2, 1, $3, $4, $5, $6, $7) returning id`, [orgId, dish.id, c.yield_g, portion, c.technology || null, `Архив ТТК: ${c.source_path}`, userId])).rows[0];
      let pos = 0;
      for (const l of c.lines as ArchiveCard['lines']) {
        const unit = cardUnit(l.unit);
        const note = [unit ? '' : `единица в карте: «${l.unit}»`, l.is_portion_ref && l.portion_g ? `порция ${l.portion_g} г` : ''].filter(Boolean).join('; ') || null;
        const m = await aliasFor(tx, orgId, l.name);
        await tx.query(`insert into ttk_lines (organization_id, version_id, position, name_raw, product_id, sub_dish_id, unit, brutto, netto, ready, note) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [orgId, v.id, ++pos, l.name, m?.product_id || null, m?.sub_dish_id || null, unit || 'кг', l.brutto, l.netto, l.ready ?? null, note]);
        res.lines++; if (m) res.matched++;
      }
      res.dishes++;
    }
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'ttk.archive_import', entityType: 'dish', after: res });
    return res;
  });
}

/** Запомненное сопоставление или точное совпадение названия с товаром / полуфабрикатом организации. */
async function aliasFor(tx: Tx, orgId: string, name: string): Promise<{ product_id: string | null; sub_dish_id: string | null } | null> {
  const n = normName(name);
  const a = (await tx.query(`select product_id, sub_dish_id from ingredient_aliases where organization_id = $1 and name_norm = $2`, [orgId, n])).rows[0];
  if (a) return a;
  const p = (await tx.query(`select id from products where organization_id = $1 and status = 'active' and lower(replace(name, 'ё', 'е')) = $2 limit 2`, [orgId, n])).rows;
  if (p.length === 1) return { product_id: p[0].id, sub_dish_id: null };
  return null;
}

/* ───────────── Блюда и версии ───────────── */

/** Следующий номер рецептуры по порядку (номера, введённые вручную не числом, не мешают). */
async function nextCardNo(tx: Tx, orgId: string) {
  return String(Number((await tx.query(`select coalesce(max(card_no::int) filter (where card_no ~ '^[0-9]{1,9}$'), 0) + 1 as n from dishes where organization_id = $1`, [orgId])).rows[0].n));
}

const DishInput = z.object({
  cardNo: optText(30),
  name: z.string().trim().min(2, 'Название блюда.').max(200),
  kind: z.enum(['dish', 'semi']).default('dish'),
  category: optText(100),
  salePrice: z.coerce.number().min(0).nullable().optional(),
});

export async function createDish(userId: string, orgId: string, input: unknown) {
  const d = parse(DishInput, input);
  return inOrg(userId, orgId, 'ttk.manage', async (tx, m) => {
    if (d.salePrice != null && !roleHas(m.role, 'menu.price')) throw Errors.forbidden('Цену продажи устанавливает руководитель или шеф.');
    if ((await tx.query(`select 1 from dishes where organization_id = $1 and status = 'active' and lower(name) = lower($2)`, [orgId, d.name])).rowCount) throw Errors.conflict('Блюдо с таким названием уже есть.');
    const dish = (await tx.query(`insert into dishes (organization_id, name, kind, category, sale_price, created_by, card_no) values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      [orgId, d.name, d.kind, d.category, d.salePrice ?? null, userId, d.cardNo || await nextCardNo(tx, orgId)])).rows[0];
    await tx.query(`insert into ttk_versions (organization_id, dish_id, version, created_by) values ($1, $2, 1, $3)`, [orgId, dish.id, userId]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'dish.create', entityType: 'dish', entityId: dish.id, after: d });
    return dish;
  });
}

export async function updateDish(userId: string, orgId: string, dishId: string, input: unknown) {
  const d = parse(z.object({ name: z.string().trim().min(2).max(200).optional(), category: optText(100), salePrice: z.coerce.number().min(0).nullable().optional(),
    status: z.enum(['active', 'archived']).optional(), cardNo: z.string().trim().min(1, 'Номер рецептуры.').max(30).optional() }), input);
  return inOrg(userId, orgId, d.salePrice !== undefined && Object.keys(d).length === 1 ? 'menu.price' : 'ttk.manage', async (tx, m) => {
    const dish = (await tx.query(`select * from dishes where id = $1 and organization_id = $2 for update`, [dishId, orgId])).rows[0];
    if (!dish) throw Errors.notFound('Блюдо не найдено.');
    if (d.salePrice !== undefined && !roleHas(m.role, 'menu.price')) throw Errors.forbidden('Цену продажи устанавливает руководитель или шеф.');
    await tx.query(`update dishes set name = coalesce($2, name), category = case when $3::boolean then $4 else category end,
        sale_price = case when $5::boolean then $6 else sale_price end, status = coalesce($7, status), card_no = coalesce($8, card_no) where id = $1`,
      [dishId, d.name || null, d.category !== undefined, d.category ?? null, d.salePrice !== undefined, d.salePrice ?? null, d.status || null, d.cardNo || null]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'dish.update', entityType: 'dish', entityId: dishId,
      before: { name: dish.name, sale_price: dish.sale_price, status: dish.status }, after: d });
    return { ok: true };
  });
}

export async function listDishes(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'menu.read', async (tx, m) => (await tx.query(`select d.id, d.name, d.kind, d.category, d.status, d.archive_id,
      ${roleHas(m.role, 'cost.read') || roleHas(m.role, 'menu.price') ? 'd.sale_price' : 'null as sale_price'},
      (select json_build_object('id', v.id, 'version', v.version, 'approved_at', v.approved_at) from ttk_versions v where v.dish_id = d.id and v.status = 'approved') as approved,
      (select json_build_object('id', v.id, 'version', v.version, 'status', v.status) from ttk_versions v where v.dish_id = d.id and v.status in ('draft', 'review')) as open,
      (select count(*)::int from ttk_lines l join ttk_versions v on v.id = l.version_id where v.dish_id = d.id and v.status in ('draft', 'review') and l.kind = 'item' and l.product_id is null and l.sub_dish_id is null) as unmatched
    from dishes d where d.organization_id = $1 and d.status = 'active' order by d.kind, d.category nulls last, d.name`, [orgId])).rows);
}

async function loadVersion(tx: Tx, orgId: string, versionId: string, lock = false) {
  const v = (await tx.query(`select * from ttk_versions where id = $1 and organization_id = $2 ${lock ? 'for update' : ''}`, [versionId, orgId])).rows[0];
  if (!v) throw Errors.notFound('Версия ТТК не найдена.');
  return v;
}
async function draftVersion(tx: Tx, orgId: string, versionId: string) {
  const v = await loadVersion(tx, orgId, versionId, true);
  if (v.status !== 'draft') throw Errors.conflict('ТТК не в черновике — изменения вносятся новой версией.');
  return v;
}

/** Карточка блюда: версии, выбранная версия со строками, препятствия, себестоимость и КБЖУ. */
export async function getDish(userId: string, orgId: string, dishId: string, versionId?: string | null) {
  return inOrg(userId, orgId, 'menu.read', async (tx, m) => {
    const dish = (await tx.query(`select * from dishes where id = $1 and organization_id = $2`, [dishId, orgId])).rows[0];
    if (!dish) throw Errors.notFound('Блюдо не найдено.');
    const seeCost = roleHas(m.role, 'cost.read');
    if (!seeCost && !roleHas(m.role, 'menu.price')) dish.sale_price = null;
    const versions = (await tx.query(`select v.id, v.version, v.status, v.created_at, v.approved_at, v.change_reason, u.full_name as approved_by_name
      from ttk_versions v left join users u on u.id = v.approved_by where v.dish_id = $1 order by v.version desc`, [dishId])).rows.map((v) => ({ ...v, status_label: TTK_STATUS[v.status] }));
    const id = versionId || versions.find((v) => v.status === 'draft' || v.status === 'review')?.id || versions.find((v) => v.status === 'approved')?.id || versions[0]?.id;
    const v = id ? await loadVersion(tx, orgId, id) : null;
    if (v && v.dish_id !== dishId) throw Errors.notFound('Версия не относится к блюду.');
    const card = v ? await versionCard(tx, orgId, v, dish, seeCost) : null;
    const archive = dish.archive_id ? (await tx.query(`select source_path, issues, yield_raw, yield_source, basis from ttk_archive where id = $1`, [dish.archive_id])).rows[0] : null;
    return { dish: { ...dish, kind_label: KIND_LABEL[dish.kind] }, versions, current: card, archive, canSeeCost: seeCost };
  });
}

async function versionCard(tx: Tx, orgId: string, v: Record<string, any>, dish: Record<string, any>, seeCost: boolean) {
  const lines = (await tx.query(`select l.*, p.name as product_name, p.unit as product_unit, p.reference_product_id, sd.name as sub_dish_name
    from ttk_lines l left join products p on p.id = l.product_id left join dishes sd on sd.id = l.sub_dish_id where l.version_id = $1 order by l.position`, [v.id])).rows;
  const steps = await versionSteps(tx, v.id);
  for (const l of lines) l.steps = steps.get(l.id) || [];
  const calc = await calcVersion(tx, orgId, v.id, new Set([dish.id]));
  const blockers = await versionBlockers(tx, orgId, v, dish, lines);
  const perPortion = dish.kind === 'dish' && v.portion_g && v.yield_g ? Number(v.portion_g) / Number(v.yield_g) : null;
  const cost = seeCost ? {
    total: calc.cost.complete ? r2(calc.cost.total) : null, known: r2(calc.cost.total), complete: calc.cost.complete, missing: calc.cost.missing,
    per_portion: calc.cost.complete && perPortion ? r2(calc.cost.total * perPortion) : null,
    per_kg: calc.cost.complete && v.yield_g ? r2(calc.cost.total / Number(v.yield_g) * 1000) : null,
    food_cost_pct: calc.cost.complete && perPortion && Number(dish.sale_price) > 0 ? Math.round(calc.cost.total * perPortion / Number(dish.sale_price) * 1000) / 10 : null,
    lines: calc.lines,
  } : null;
  const warnings: string[] = [];
  if (calc.ready_complete && calc.ready_g && v.yield_g && Math.abs(Number(v.yield_g) - calc.ready_g) > calc.ready_g * 0.03) {
    warnings.push(`Выход карты (${fmtNum(v.yield_g)} г) расходится с выходом по обработке сырья (${fmtNum(Math.round(calc.ready_g))} г) — проверьте выход или нормы обработки.`);
  } else if (!calc.ready_complete && calc.mass_g && v.yield_g && Number(v.yield_g) > calc.mass_g * 1.02) warnings.push(`Выход (${fmtNum(v.yield_g)} г) больше закладки нетто (${fmtNum(Math.round(calc.mass_g))} г) — проверьте единицы или состав.`);
  return { version: { ...v, status_label: TTK_STATUS[v.status] } as Record<string, any>, lines, blockers, warnings, cost, kbju: calc.kbju,
    output: { netto_g: calc.mass_g ? Math.round(calc.mass_g) : null, ready_g: calc.ready_complete && calc.ready_g ? Math.round(calc.ready_g) : null, sections: sections(lines, calc) } };
}

/**
 * Выход по разделам рецептуры (подзаголовкам): «120/110/95», как в Шеф Эксперте. Строки до первого подзаголовка —
 * отдельный раздел. Раздел, где выход хотя бы одной строки не определён, — «?» (не ноль).
 */
function sections(lines: Record<string, any>[], calc: Calc) {
  if (!lines.some((l) => l.kind === 'heading')) return null;
  const ready = new Map(calc.lines.map((x) => [x.line_id, x.ready_g ?? null]));
  const out: { title: string | null; ready_g: number | null }[] = [];
  let cur: { title: string | null; ready_g: number | null; n: number } | null = null;
  for (const l of lines) {
    if (l.kind === 'heading') { if (cur && cur.n) out.push({ title: cur.title, ready_g: cur.ready_g }); cur = { title: l.name_raw, ready_g: 0, n: 0 }; continue; }
    cur = cur || { title: null, ready_g: 0, n: 0 };
    cur.n++;
    const g = ready.get(l.id);
    cur.ready_g = g === null || g === undefined || cur.ready_g === null ? null : cur.ready_g + g;
  }
  if (cur && cur.n) out.push({ title: cur.title, ready_g: cur.ready_g });
  const list = out.map((x) => ({ ...x, ready_g: x.ready_g === null ? null : Math.round(x.ready_g) }));
  return { list, label: list.map((x) => (x.ready_g === null ? '?' : String(x.ready_g))).join('/') };
}

/* ───────────── Расчёт: себестоимость и КБЖУ ───────────── */

interface Calc { cost: { total: number; complete: boolean; missing: string[] }; lines: { line_id: string; cost: number | null; price: number | null; price_unit: string | null; source: string | null; ready_g?: number | null }[];
  kbju: { per100: { kcal: number; protein: number; fat: number; carbs: number } | null; complete: boolean; verified: boolean; missing: string[]; losses: 'none' | 'partial' | 'all' };
  mass_g: number; ready_g: number; ready_complete: boolean }

/** Количество line в единице to: масса и объём — стандартно, иначе подтверждённый коэффициент товара. */
async function convert(tx: Tx, productId: string | null, qty: number, from: string, to: string): Promise<number | null> {
  if (from === to) return qty;
  const a = BASE[from], b = BASE[to];
  if (a && b && a.dim === b.dim) return qty * a.k / b.k;
  if (!productId) return null;
  const direct = (await tx.query(`select from_unit, to_unit, factor from unit_conversions where product_id = $1`, [productId])).rows;
  for (const c of direct) {
    // from → c.from (станд.) → c.to → to (станд.)
    const toFrom = await convert(tx, null, qty, from, c.from_unit);
    if (toFrom !== null) { const mid = toFrom * Number(c.factor); const res = await convert(tx, null, mid, c.to_unit, to); if (res !== null) return res; }
    const toTo = await convert(tx, null, qty, from, c.to_unit);
    if (toTo !== null) { const mid = toTo / Number(c.factor); const res = await convert(tx, null, mid, c.from_unit, to); if (res !== null) return res; }
  }
  return null;
}

/** Цена за единицу товара: средневзвешенная по партиям в остатке, иначе последняя закупка. */
export async function productPrice(tx: Tx, orgId: string, productId: string): Promise<{ price: number; unit: string; source: string } | null> {
  const avg = (await tx.query(`select sum(quantity * unit_price) / nullif(sum(quantity), 0) as price, min(unit) as unit, count(*)::int as n
    from lots where organization_id = $1 and product_id = $2 and unit_price is not null and quantity > 0 and status in ('available', 'quarantine')`, [orgId, productId])).rows[0];
  if (avg?.price !== null && avg?.price !== undefined) return { price: Number(avg.price), unit: avg.unit, source: `средняя по остатку (${avg.n} парт.)` };
  const last = (await tx.query(`select unit_price, unit, received_at from lots where organization_id = $1 and product_id = $2 and unit_price is not null order by received_at desc limit 1`, [orgId, productId])).rows[0];
  if (last) return { price: Number(last.unit_price), unit: last.unit, source: `последняя закупка ${new Date(last.received_at).toLocaleDateString('ru-RU')}` };
  return null;
}

/** Масса строки в граммах для полуфабриката: г/кг или порции его утверждённой ТТК. */
async function subGrams(tx: Tx, subId: string, qty: number, unit: string) {
  if (BASE[unit]?.dim === 'm') return qty * BASE[unit].k;
  if (unit === 'порция') {
    const sv = (await tx.query(`select portion_g from ttk_versions where dish_id = $1 and status = 'approved'`, [subId])).rows[0];
    return sv?.portion_g ? qty * Number(sv.portion_g) : null;
  }
  return null;
}

export async function calcVersion(tx: Tx, orgId: string, versionId: string, stack: Set<string>): Promise<Calc> {
  const v = (await tx.query(`select * from ttk_versions where id = $1`, [versionId])).rows[0];
  // пищевая ценность: по документу (product_nutrition — подтверждено), иначе справочник MON CHEF со своим статусом
  const lines = (await tx.query(`select l.*, p.name as product_name, p.unit as product_unit,
      coalesce(pn.kcal_100, r.kcal_100) as kcal_100, coalesce(pn.protein_100, r.protein_100) as protein_100, coalesce(pn.fat_100, r.fat_100) as fat_100,
      coalesce(pn.carbs_100, r.carbs_100) as carbs_100, case when pn.id is not null then 'VERIFIED' else r.verification_status end as verification_status, sd.name as sub_name
    from ttk_lines l left join products p on p.id = l.product_id left join reference_products r on r.id = p.reference_product_id left join dishes sd on sd.id = l.sub_dish_id
    left join lateral (select * from product_nutrition x where x.product_id = l.product_id order by x.created_at desc limit 1) pn on true
    where l.version_id = $1 and l.kind = 'item' order by l.position`, [versionId])).rows;
  const out: Calc = { cost: { total: 0, complete: true, missing: [] }, lines: [], kbju: { per100: null, complete: true, verified: true, missing: [], losses: 'none' }, mass_g: 0, ready_g: 0, ready_complete: true };
  const k = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  const steps = await versionSteps(tx, versionId);
  let counted = 0, thermal = 0, withLosses = 0;   // строк, вошедших в КБЖУ: ни одной — значит «не рассчитано», а не ноль
  for (const l of lines) {
    const gross = Number(l.brutto ?? l.netto ?? 0), net = Number(l.netto ?? l.brutto ?? 0);
    let lineReady: number | null = null;
    let lineCost: number | null = null, price: number | null = null, priceUnit: string | null = null, source: string | null = null;
    if (l.product_id) {
      const pp = await productPrice(tx, orgId, l.product_id);
      const qty = pp ? await convert(tx, l.product_id, gross, l.unit, pp.unit) : null;
      if (pp && qty !== null) { lineCost = qty * pp.price; price = pp.price; priceUnit = pp.unit; source = pp.source; }
      else out.cost.missing.push(pp ? `${l.product_name}: нет коэффициента «${l.unit} → ${pp.unit}»` : `${l.product_name}: нет цены закупки`);
      const g = l.in_yield ? await convert(tx, l.product_id, net, l.unit, 'г') : null;
      if (!l.in_yield) { out.lines.push({ line_id: l.id, cost: lineCost === null ? null : r2(lineCost), price: price === null ? null : r2(price), price_unit: priceUnit, source, ready_g: 0 }); if (lineCost !== null) out.cost.total += lineCost; continue; }
      if (g !== null) out.mass_g += g;
      const ls = steps.get(l.id) || [];
      const rg = l.ready !== null ? await convert(tx, l.product_id, Number(l.ready), l.unit, 'г') : ls.some((s) => s.kind === 'thermal') ? null : g;
      if (rg !== null) out.ready_g += rg; else out.ready_complete = false;
      lineReady = rg;
      // потери нутриентов при тепловой обработке — по нормам шагов; неизвестны — без потерь (ориентировочно)
      const hasThermal = ls.some((s) => s.kind === 'thermal'), keep = hasThermal ? retention(ls as any) : null;
      if (hasThermal) { thermal++; if (keep) withLosses++; }
      if (g !== null && l.kcal_100 !== null) {
        const kp = keep || { protein: 1, fat: 1, carbs: 1 };
        const p0 = g * Number(l.protein_100 || 0) / 100, f0 = g * Number(l.fat_100 || 0) / 100, c0 = g * Number(l.carbs_100 || 0) / 100;
        const pr = p0 * kp.protein, ft = f0 * kp.fat, cb = c0 * kp.carbs;
        // энергия: по справочнику минус потерянные нутриенты (4/9/4 ккал, ТР ТС 022/2011)
        k.kcal += g * Number(l.kcal_100) / 100 - ((p0 - pr) * 4 + (f0 - ft) * 9 + (c0 - cb) * 4); k.protein += pr; k.fat += ft; k.carbs += cb;
        counted++;
        if (l.verification_status !== 'VERIFIED') out.kbju.verified = false;
      } else out.kbju.missing.push(g === null ? `${l.product_name}: нет пересчёта «${l.unit} → г»` : `${l.product_name}: нет данных справочника`);
    } else if (l.sub_dish_id) {
      const sv = (await tx.query(`select id, yield_g from ttk_versions where dish_id = $1 and status = 'approved'`, [l.sub_dish_id])).rows[0];
      const g0 = await subGrams(tx, l.sub_dish_id, net, l.unit), gg = await subGrams(tx, l.sub_dish_id, gross, l.unit);
      const g = l.in_yield ? g0 : 0;
      if (!sv || !sv.yield_g || g === null || gg === null || stack.has(l.sub_dish_id)) {
        const why = stack.has(l.sub_dish_id) ? 'циклическая ссылка' : !sv ? 'нет утверждённой ТТК' : 'нет массы порции или выхода';
        out.cost.missing.push(`${l.sub_name}: ${why}`); out.kbju.missing.push(`${l.sub_name}: ${why}`);
      } else {
        out.mass_g += g;
        const ls = steps.get(l.id) || [];
        const rg = !l.in_yield ? 0 : l.ready !== null ? await subGrams(tx, l.sub_dish_id, Number(l.ready), l.unit) : ls.some((s) => s.kind === 'thermal') ? null : g;
        if (rg !== null) out.ready_g += rg; else out.ready_complete = false;
        lineReady = rg;
        const sub = await calcVersion(tx, orgId, sv.id, new Set([...stack, l.sub_dish_id]));
        if (sub.cost.complete) { lineCost = sub.cost.total * gg / Number(sv.yield_g); source = 'по ТТК полуфабриката'; }
        else out.cost.missing.push(`${l.sub_name}: себестоимость полуфабриката неполная`);
        if (sub.kbju.per100 && sub.kbju.complete) {
          k.kcal += g * sub.kbju.per100.kcal / 100; k.protein += g * sub.kbju.per100.protein / 100; k.fat += g * sub.kbju.per100.fat / 100; k.carbs += g * sub.kbju.per100.carbs / 100;
          counted++;
          if (!sub.kbju.verified) out.kbju.verified = false;
        } else out.kbju.missing.push(`${l.sub_name}: КБЖУ полуфабриката неполное`);
      }
    } else {
      out.cost.missing.push(`${l.name_raw}: не сопоставлено с товаром`); out.kbju.missing.push(`${l.name_raw}: не сопоставлено`); out.ready_complete = false;
    }
    if (lineCost !== null) out.cost.total += lineCost;
    out.lines.push({ line_id: l.id, cost: lineCost === null ? null : r2(lineCost), price: price === null ? null : r2(price), price_unit: priceUnit, source, ready_g: lineReady });
  }
  if (out.cost.missing.length || !lines.length) out.cost.complete = false;
  if (!lines.length) out.ready_complete = false;
  out.kbju.losses = !thermal ? 'none' : withLosses === thermal ? 'all' : 'partial';
  out.kbju.complete = !out.kbju.missing.length && lines.length > 0;
  if (v?.yield_g && counted) {
    const f = 100 / Number(v.yield_g);
    out.kbju.per100 = { kcal: Math.round(k.kcal * f), protein: Math.round(k.protein * f * 10) / 10, fat: Math.round(k.fat * f * 10) / 10, carbs: Math.round(k.carbs * f * 10) / 10 };
  }
  if (!out.kbju.complete) out.kbju.verified = false;
  return out;
}

/* ───────────── Препятствия к утверждению ───────────── */

async function versionBlockers(tx: Tx, orgId: string, v: Record<string, any>, dish: Record<string, any>, lines: Record<string, any>[]): Promise<string[]> {
  const out: string[] = [];
  if (!v.technology || v.technology.trim().length < 10) out.push('Опишите технологию приготовления.');
  if (!v.storage_conditions) out.push('Укажите условия хранения.');
  if (!v.shelf_life) out.push('Укажите срок годности (реализации) — по утверждённому основанию.');
  if (!v.yield_g) out.push('Укажите выход.');
  if (dish.kind === 'dish' && !v.portion_g) out.push('Укажите выход порции.');
  if (v.portion_g && v.yield_g && Number(v.portion_g) > Number(v.yield_g)) out.push('Порция больше выхода закладки.');
  if (!lines.some((l) => l.kind !== 'heading')) out.push('Нет состава.');
  const stepsOf = await versionSteps(tx, v.id);
  for (const l of lines) {
    if (l.kind === 'heading') continue;
    const n = `«${l.name_raw}»`;
    if (!l.product_id && !l.sub_dish_id) { out.push(`${n}: не сопоставлено с товаром или полуфабрикатом.`); continue; }
    if (!(Number(l.netto) > 0)) out.push(`${n}: нет нетто.`);
    if (l.brutto !== null && l.netto !== null && Number(l.netto) > Number(l.brutto) + 1e-9 && !(stepsOf.get(l.id) || []).some((s) => s.loss_pct < 0)) out.push(`${n}: нетто больше брутто.`);
    if (l.product_id) {
      if (l.unit === 'порция') out.push(`${n}: «порция» — только для полуфабриката.`);
      else if ((await convert(tx, l.product_id, 1, l.unit, l.product_unit)) === null) out.push(`${n}: нет коэффициента «${l.unit} → ${l.product_unit}» — без него не списать со склада.`);
    } else {
      if (l.sub_dish_id === dish.id) out.push(`${n}: блюдо не может входить само в себя.`);
      else if (!(await tx.query(`select 1 from ttk_versions where dish_id = $1 and status = 'approved'`, [l.sub_dish_id])).rowCount) out.push(`${n}: у полуфабриката нет утверждённой ТТК.`);
      else if ((await subGrams(tx, l.sub_dish_id, 1, l.unit)) === null) out.push(`${n}: у полуфабриката не указана порция — используйте г или кг.`);
    }
  }
  return out;
}

/* ───────────── Изменение черновика ───────────── */

const VersionInput = z.object({
  yieldG: z.coerce.number().positive().nullable().optional(), portionG: z.coerce.number().positive().nullable().optional(),
  technology: optText(10000), storageConditions: optText(1000), shelfLife: optText(300), quality: optText(2000), allergens: optText(1000),
  shelfLifeHours: z.coerce.number().positive('Срок — больше нуля часов.').max(24 * 365).nullable().optional(),   // срок партии п/ф при выпуске
  cardDate: z.iso.date('Дата рецептуры — ГГГГ-ММ-ДД.').optional(), semiYieldG: z.coerce.number().min(0).nullable().optional(),
});

export async function updateVersion(userId: string, orgId: string, versionId: string, input: unknown) {
  const d = parse(VersionInput, input);
  return inOrg(userId, orgId, 'ttk.manage', async (tx) => {
    const v = await draftVersion(tx, orgId, versionId);
    await tx.query(`update ttk_versions set yield_g = $2, portion_g = $3, technology = $4, storage_conditions = $5, shelf_life = $6, quality = $7, allergens = $8, shelf_life_hours = $9, return_note = null,
        card_date = coalesce($10, card_date), semi_yield_g = case when $11::boolean then $12 else semi_yield_g end where id = $1`,
      [versionId, d.yieldG ?? null, d.portionG ?? null, d.technology, d.storageConditions, d.shelfLife, d.quality, d.allergens, d.shelfLifeHours ?? null,
        d.cardDate || null, d.semiYieldG !== undefined, d.semiYieldG ?? null]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'ttk.update', entityType: 'ttk_version', entityId: versionId,
      before: { yield_g: v.yield_g, portion_g: v.portion_g, shelf_life: v.shelf_life }, after: d });
    return { ok: true };
  });
}

const qty = z.coerce.number().min(0).nullable().optional();
const LineInput = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  productId: z.uuid().nullable().optional(), subDishId: z.uuid().nullable().optional(),
  unit: z.enum(UNITS as [Unit, ...Unit[]]), brutto: qty, netto: qty, ready: qty, note: optText(300),
  inYield: z.boolean().optional(),   // учитывать в выходе готового изделия
});

async function checkRefs(tx: Tx, orgId: string, productId?: string | null, subDishId?: string | null) {
  if (productId && subDishId) throw Errors.validation('Строка — либо товар, либо полуфабрикат.');
  if (productId && !(await tx.query(`select 1 from products where id = $1 and organization_id = $2`, [productId, orgId])).rowCount) throw Errors.validation('Товар не найден.');
  if (subDishId && !(await tx.query(`select 1 from dishes where id = $1 and organization_id = $2`, [subDishId, orgId])).rowCount) throw Errors.validation('Полуфабрикат не найден.');
}

export async function addLine(userId: string, orgId: string, versionId: string, input: unknown) {
  const d = parse(LineInput, input);
  return inOrg(userId, orgId, 'ttk.manage', async (tx) => {
    await draftVersion(tx, orgId, versionId);
    await checkRefs(tx, orgId, d.productId, d.subDishId);
    let name = d.name;
    if (!name && d.productId) name = (await tx.query(`select name from products where id = $1`, [d.productId])).rows[0].name;
    if (!name && d.subDishId) name = (await tx.query(`select name from dishes where id = $1`, [d.subDishId])).rows[0].name;
    if (!name) throw Errors.validation('Укажите ингредиент.');
    const pos = Number((await tx.query(`select coalesce(max(position), 0) + 1 as n from ttk_lines where version_id = $1`, [versionId])).rows[0].n);
    const l = (await tx.query(`insert into ttk_lines (organization_id, version_id, position, name_raw, product_id, sub_dish_id, unit, brutto, netto, ready, note)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`, [orgId, versionId, pos, name, d.productId || null, d.subDishId || null, d.unit, d.brutto ?? null, d.netto ?? null, d.ready ?? null, d.note])).rows[0];
    if (d.inYield === false) await tx.query(`update ttk_lines set in_yield = false where id = $1`, [l.id]);
    // обработка по умолчанию товара (как в Шеф Эксперте): брутто/нетто/выход считаются от введённой величины
    const defs = d.productId && d.unit !== 'шт' ? await defaultSteps(tx, orgId, d.productId) : [];
    const from = (['ready', 'netto', 'brutto'] as From[]).find((f) => Number(d[f]) > 0);
    if (defs.length && from) Object.assign(l, await applyLineSteps(tx, orgId, userId, l.id, { steps: defs, from, value: Number(d[from]) }));
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'ttk.line_add', entityType: 'ttk_version', entityId: versionId, after: { line: l.id, ...d, name } });
    return l;
  });
}

export async function updateLine(userId: string, orgId: string, lineId: string, input: unknown) {
  const d = parse(LineInput, input);
  return inOrg(userId, orgId, 'ttk.manage', async (tx) => {
    const l = (await tx.query(`select * from ttk_lines where id = $1 and organization_id = $2`, [lineId, orgId])).rows[0];
    if (!l) throw Errors.notFound('Строка не найдена.');
    if (l.kind === 'heading') throw Errors.validation('Это подзаголовок — у него нет сырья и количества.');
    await draftVersion(tx, orgId, l.version_id);
    await checkRefs(tx, orgId, d.productId, d.subDishId);
    let q = { brutto: d.brutto ?? null, netto: d.netto ?? null, ready: d.ready ?? null };
    // есть шаги обработки — величины считаются цепочкой от той, что изменил человек
    const ls = (await versionSteps(tx, l.version_id)).get(lineId) || [];
    if (ls.length) {
      const changed = (['ready', 'netto', 'brutto'] as From[]).find((f) => q[f] !== null && Number(q[f]) !== Number(l[f])) || (l.calc_from as From) || 'brutto';
      if (q[changed] === null || !(Number(q[changed]) > 0)) throw Errors.validation('Укажите количество больше нуля.');
      q = chain(ls as any, changed, Number(q[changed]));
      await tx.query(`update ttk_lines set calc_from = $2 where id = $1`, [lineId, changed]);
    }
    await tx.query(`update ttk_lines set name_raw = coalesce($2, name_raw), product_id = $3, sub_dish_id = $4, unit = $5, brutto = $6, netto = $7, note = $8, ready = $9, in_yield = coalesce($10, in_yield) where id = $1`,
      [lineId, d.name || null, d.productId === undefined ? l.product_id : d.productId, d.subDishId === undefined ? l.sub_dish_id : d.subDishId, d.unit, q.brutto, q.netto, d.note, q.ready, d.inYield ?? null]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'ttk.line_update', entityType: 'ttk_version', entityId: l.version_id,
      before: { name: l.name_raw, unit: l.unit, brutto: l.brutto, netto: l.netto, ready: l.ready }, after: { ...d, ...q } });
    return { ok: true };
  });
}

/** Копия строк (с подзаголовками и шагами обработки) в черновик, позиции — после shift. */
async function copyLines(tx: Tx, fromVersion: string, toVersion: string, shift: number) {
  await tx.query(`insert into ttk_lines (organization_id, version_id, position, kind, name_raw, product_id, sub_dish_id, unit, brutto, netto, ready, calc_from, in_yield, note)
    select organization_id, $2, position + $3, kind, name_raw, product_id, sub_dish_id, unit, brutto, netto, ready, calc_from, in_yield, note from ttk_lines where version_id = $1`, [fromVersion, toVersion, shift]);
  await tx.query(`insert into ttk_line_steps (organization_id, version_id, line_id, position, method_code, norm_id, loss_pct, protein_loss_pct, fat_loss_pct, carbs_loss_pct, basis)
    select s.organization_id, $2, nl.id, s.position, s.method_code, s.norm_id, s.loss_pct, s.protein_loss_pct, s.fat_loss_pct, s.carbs_loss_pct, s.basis
    from ttk_line_steps s join ttk_lines ol on ol.id = s.line_id join ttk_lines nl on nl.version_id = $2 and nl.position = ol.position + $3 where s.version_id = $1`, [fromVersion, toVersion, shift]);
}

/** Подзаголовок рецептуры: делит состав на разделы с отдельным выходом (выход блюда через «/»). */
export async function addHeading(userId: string, orgId: string, versionId: string, input: unknown) {
  const d = parse(z.object({ title: z.string('Текст подзаголовка.').trim().min(1, 'Текст подзаголовка.').max(200) }), input);
  return inOrg(userId, orgId, 'ttk.manage', async (tx) => {
    await draftVersion(tx, orgId, versionId);
    const pos = Number((await tx.query(`select coalesce(max(position), 0) + 1 as n from ttk_lines where version_id = $1`, [versionId])).rows[0].n);
    const l = (await tx.query(`insert into ttk_lines (organization_id, version_id, position, kind, name_raw) values ($1, $2, $3, 'heading', $4) returning *`, [orgId, versionId, pos, d.title])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'ttk.heading_add', entityType: 'ttk_version', entityId: versionId, after: { line: l.id, title: d.title } });
    return l;
  });
}

export async function renameHeading(userId: string, orgId: string, lineId: string, input: unknown) {
  const d = parse(z.object({ title: z.string('Текст подзаголовка.').trim().min(1, 'Текст подзаголовка.').max(200) }), input);
  return inOrg(userId, orgId, 'ttk.manage', async (tx) => {
    const l = (await tx.query(`select * from ttk_lines where id = $1 and organization_id = $2 and kind = 'heading'`, [parse(z.uuid(), lineId), orgId])).rows[0];
    if (!l) throw Errors.notFound('Подзаголовок не найден.');
    await draftVersion(tx, orgId, l.version_id);
    await tx.query(`update ttk_lines set name_raw = $2 where id = $1`, [l.id, d.title]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'ttk.heading_rename', entityType: 'ttk_version', entityId: l.version_id, before: { title: l.name_raw }, after: d });
    return { ok: true };
  });
}

/** Строку вверх / вниз (обмен позициями с соседней). */
export async function moveLine(userId: string, orgId: string, lineId: string, input: unknown) {
  const d = parse(z.object({ dir: z.enum(['up', 'down']) }), input);
  return inOrg(userId, orgId, 'ttk.manage', async (tx) => {
    const l = (await tx.query(`select * from ttk_lines where id = $1 and organization_id = $2`, [parse(z.uuid(), lineId), orgId])).rows[0];
    if (!l) throw Errors.notFound('Строка не найдена.');
    await draftVersion(tx, orgId, l.version_id);
    const n = (await tx.query(`select * from ttk_lines where version_id = $1 and position ${d.dir === 'up' ? '<' : '>'} $2 order by position ${d.dir === 'up' ? 'desc' : 'asc'} limit 1`,
      [l.version_id, l.position])).rows[0];
    if (!n) return { ok: true };
    await tx.query(`update ttk_lines set position = $2 where id = $1`, [l.id, n.position]);
    await tx.query(`update ttk_lines set position = $2 where id = $1`, [n.id, l.position]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'ttk.line_move', entityType: 'ttk_version', entityId: l.version_id, after: { line: l.id, dir: d.dir } });
    return { ok: true };
  });
}

/** Вставить в черновик весь состав другой рецептуры (утверждённой, иначе последней версии) — для однотипных блюд. */
export async function insertFromDish(userId: string, orgId: string, versionId: string, input: unknown) {
  const d = parse(z.object({ dishId: z.uuid('Выберите рецептуру.') }), input);
  return inOrg(userId, orgId, 'ttk.manage', async (tx) => {
    const v = await draftVersion(tx, orgId, versionId);
    if (v.dish_id === d.dishId) throw Errors.validation('Выберите другую рецептуру.');
    const src = (await tx.query(`select v.id, d.name from ttk_versions v join dishes d on d.id = v.dish_id where v.dish_id = $1 and v.organization_id = $2
      order by (v.status = 'approved') desc, v.version desc limit 1`, [d.dishId, orgId])).rows[0];
    if (!src) throw Errors.notFound('Рецептура не найдена.');
    const shift = Number((await tx.query(`select coalesce(max(position), 0) as n from ttk_lines where version_id = $1`, [versionId])).rows[0].n);
    await copyLines(tx, src.id, versionId, shift);
    const n = Number((await tx.query(`select count(*)::int as n from ttk_lines where version_id = $1 and position > $2`, [versionId, shift])).rows[0].n);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'ttk.insert_from', entityType: 'ttk_version', entityId: versionId, after: { from: src.name, lines: n } });
    return { lines: n };
  });
}

export async function removeLine(userId: string, orgId: string, lineId: string) {
  return inOrg(userId, orgId, 'ttk.manage', async (tx) => {
    const l = (await tx.query(`select * from ttk_lines where id = $1 and organization_id = $2`, [lineId, orgId])).rows[0];
    if (!l) throw Errors.notFound('Строка не найдена.');
    await draftVersion(tx, orgId, l.version_id);
    await tx.query(`delete from ttk_lines where id = $1`, [lineId]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'ttk.line_remove', entityType: 'ttk_version', entityId: l.version_id, before: { name: l.name_raw } });
    return { ok: true };
  });
}

/** Сопоставление названия из карты с товаром или п/ф. «Запомнить» — применить ко всем черновикам организации. */
export async function matchLine(userId: string, orgId: string, lineId: string, input: unknown) {
  const d = parse(z.object({ productId: z.uuid().nullable().optional(), subDishId: z.uuid().nullable().optional(), remember: z.boolean().default(true) })
    .refine((x) => !!x.productId !== !!x.subDishId, 'Выберите товар или полуфабрикат.'), input);
  return inOrg(userId, orgId, 'ttk.manage', async (tx) => {
    const l = (await tx.query(`select * from ttk_lines where id = $1 and organization_id = $2`, [lineId, orgId])).rows[0];
    if (!l) throw Errors.notFound('Строка не найдена.');
    if (l.kind === 'heading') throw Errors.validation('Это подзаголовок — у него нет сырья и количества.');
    await draftVersion(tx, orgId, l.version_id);
    await checkRefs(tx, orgId, d.productId, d.subDishId);
    await tx.query(`update ttk_lines set product_id = $2, sub_dish_id = $3 where id = $1`, [lineId, d.productId || null, d.subDishId || null]);
    let applied = 1;
    if (d.remember) {
      const n = normName(l.name_raw);
      await tx.query(`insert into ingredient_aliases (organization_id, name_norm, product_id, sub_dish_id, created_by) values ($1, $2, $3, $4, $5)
        on conflict (organization_id, name_norm) do update set product_id = excluded.product_id, sub_dish_id = excluded.sub_dish_id, created_by = excluded.created_by, created_at = now()`,
        [orgId, n, d.productId || null, d.subDishId || null, userId]);
      const others = (await tx.query(`select l.id, l.name_raw from ttk_lines l join ttk_versions v on v.id = l.version_id
        where l.organization_id = $1 and v.status = 'draft' and l.kind = 'item' and l.product_id is null and l.sub_dish_id is null and l.id <> $2`, [orgId, lineId])).rows.filter((o) => normName(o.name_raw) === n);
      for (const o of others) await tx.query(`update ttk_lines set product_id = $2, sub_dish_id = $3 where id = $1`, [o.id, d.productId || null, d.subDishId || null]);
      applied += others.length;
    }
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'ttk.line_match', entityType: 'ttk_version', entityId: l.version_id,
      after: { name: l.name_raw, product_id: d.productId, sub_dish_id: d.subDishId, applied } });
    return { applied };
  });
}

/** Несопоставленные названия по всем черновикам — чтобы сопоставить каждое один раз. */
export async function unmatchedNames(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'ttk.manage', async (tx) => {
    const rows = (await tx.query(`select l.id, l.name_raw, l.unit, d.name as dish from ttk_lines l join ttk_versions v on v.id = l.version_id join dishes d on d.id = v.dish_id
      where l.organization_id = $1 and v.status = 'draft' and l.kind = 'item' and l.product_id is null and l.sub_dish_id is null order by l.name_raw`, [orgId])).rows;
    const by = new Map<string, { name: string; line_id: string; units: Set<string>; dishes: Set<string>; count: number }>();
    for (const r of rows) {
      const n = normName(r.name_raw);
      const g = by.get(n) || { name: r.name_raw, line_id: r.id, units: new Set<string>(), dishes: new Set<string>(), count: 0 };
      g.units.add(r.unit); g.dishes.add(r.dish); g.count++; by.set(n, g);
    }
    return [...by.values()].sort((a, b) => b.count - a.count).map((g) => ({ name: g.name, line_id: g.line_id, units: [...g.units], dishes: [...g.dishes].slice(0, 5), count: g.count }));
  });
}

/* ───────────── Жизненный цикл ───────────── */

/** Новая версия — копия утверждённой (или последней) с причиной изменения. */
export async function newVersion(userId: string, orgId: string, dishId: string, input: unknown) {
  const d = parse(z.object({ changeReason: z.string('Укажите причину новой версии.').trim().min(5, 'Укажите причину новой версии.').max(500) }), input);
  return inOrg(userId, orgId, 'ttk.manage', async (tx) => {
    if ((await tx.query(`select 1 from ttk_versions where dish_id = $1 and organization_id = $2 and status in ('draft', 'review')`, [dishId, orgId])).rowCount) throw Errors.conflict('Черновик уже есть — продолжите работу с ним.');
    const src = (await tx.query(`select * from ttk_versions where dish_id = $1 and organization_id = $2 order by (status = 'approved') desc, version desc limit 1`, [dishId, orgId])).rows[0];
    if (!src) throw Errors.notFound('Блюдо не найдено.');
    const max = Number((await tx.query(`select max(version) as m from ttk_versions where dish_id = $1`, [dishId])).rows[0].m);
    const v = (await tx.query(`insert into ttk_versions (organization_id, dish_id, version, yield_g, portion_g, technology, storage_conditions, shelf_life, quality, allergens, source, change_reason, created_by, shelf_life_hours, semi_yield_g)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning *`,
      [orgId, dishId, max + 1, src.yield_g, src.portion_g, src.technology, src.storage_conditions, src.shelf_life, src.quality, src.allergens, src.source, d.changeReason, userId, src.shelf_life_hours, src.semi_yield_g])).rows[0];
    await copyLines(tx, src.id, v.id, 0);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'ttk.new_version', entityType: 'ttk_version', entityId: v.id, after: { version: v.version, from: src.version }, reason: d.changeReason });
    return v;
  });
}

export async function submitVersion(userId: string, orgId: string, versionId: string) {
  return inOrg(userId, orgId, 'ttk.manage', async (tx) => {
    const v = await draftVersion(tx, orgId, versionId);
    const dish = (await tx.query(`select * from dishes where id = $1`, [v.dish_id])).rows[0];
    const lines = (await tx.query(`select l.*, p.unit as product_unit from ttk_lines l left join products p on p.id = l.product_id where l.version_id = $1`, [versionId])).rows;
    const b = await versionBlockers(tx, orgId, v, dish, lines);
    if (b.length) throw Errors.validation(`Отправить на согласование нельзя: ${b.join(' ')}`, b);
    await tx.query(`update ttk_versions set status = 'review', submitted_by = $2, submitted_at = now(), return_note = null where id = $1`, [versionId, userId]);
    await openTask(tx, { orgId, kind: 'ttk_approve', title: `Согласовать ТТК: ${dish.name} (v${v.version})`, entityType: 'dish', entityId: dish.id, assigneeRole: 'chef', createdBy: userId });
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'ttk.submit', entityType: 'ttk_version', entityId: versionId, after: { version: v.version } });
    return { ok: true };
  });
}

export async function returnVersion(userId: string, orgId: string, versionId: string, input: unknown) {
  const d = parse(z.object({ note: z.string().trim().min(5, 'Укажите, что доработать.').max(1000) }), input);
  return inOrg(userId, orgId, 'ttk.approve', async (tx) => {
    const v = await loadVersion(tx, orgId, versionId, true);
    if (v.status !== 'review') throw Errors.conflict('Вернуть можно только ТТК на согласовании.');
    await tx.query(`update ttk_versions set status = 'draft', return_note = $2 where id = $1`, [versionId, d.note]);
    await tx.query(`update tasks set status = 'done', done_by = $3, done_at = now(), result = $4 where organization_id = $1 and kind = 'ttk_approve' and entity_id = $2 and status = 'open'`,
      [orgId, v.dish_id, userId, `возвращено: ${d.note}`]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'ttk.return', entityType: 'ttk_version', entityId: versionId, reason: d.note });
    return { ok: true };
  });
}

/** Утверждение: прежняя утверждённая версия — в архив; при утверждённом плане ХАССП — задача проверить влияние. */
export async function approveVersion(userId: string, orgId: string, versionId: string) {
  return inOrg(userId, orgId, 'ttk.approve', async (tx) => {
    const v = await loadVersion(tx, orgId, versionId, true);
    if (v.status !== 'review') throw Errors.conflict('Утвердить можно только ТТК на согласовании.');
    const dish = (await tx.query(`select * from dishes where id = $1`, [v.dish_id])).rows[0];
    const lines = (await tx.query(`select l.*, p.unit as product_unit from ttk_lines l left join products p on p.id = l.product_id where l.version_id = $1`, [versionId])).rows;
    const b = await versionBlockers(tx, orgId, v, dish, lines);
    if (b.length) throw Errors.validation(`Утвердить нельзя: ${b.join(' ')}`, b);
    await tx.query(`update ttk_versions set status = 'archived', archived_at = now() where dish_id = $1 and status = 'approved'`, [v.dish_id]);
    await tx.query(`update ttk_versions set status = 'approved', approved_by = $2, approved_at = now() where id = $1`, [versionId, userId]);
    await tx.query(`update tasks set status = 'done', done_by = $3, done_at = now(), result = 'утверждено' where organization_id = $1 and kind = 'ttk_approve' and entity_id = $2 and status = 'open'`, [orgId, v.dish_id, userId]);
    if ((await tx.query(`select 1 from haccp_plans where organization_id = $1 and status = 'approved'`, [orgId])).rowCount) {
      await openTask(tx, { orgId, kind: 'haccp_review', title: `Проверить план ХАССП: новая ТТК «${dish.name}» v${v.version}`, details: 'Изменилась рецептура или технология — проверьте опасности, ККТ и пределы.',
        entityType: 'dish', entityId: dish.id, assigneeRole: 'haccp_lead', createdBy: userId });
    }
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'ttk.approve', entityType: 'ttk_version', entityId: versionId, after: { dish: dish.name, version: v.version } });
    return { ok: true, version: v.version };
  });
}

/** Утверждённая ТТК блюда с составом на одну порцию (или на граммы выхода) — для списания при продаже и производстве. */
export async function approvedRecipe(tx: Tx, orgId: string, dishId: string) {
  const v = (await tx.query(`select * from ttk_versions where dish_id = $1 and organization_id = $2 and status = 'approved'`, [dishId, orgId])).rows[0];
  if (!v) return null;
  const lines = (await tx.query(`select l.*, p.name as product_name, p.unit as product_unit from ttk_lines l left join products p on p.id = l.product_id where l.version_id = $1 and l.kind = 'item' order by l.position`, [v.id])).rows;
  return { version: v, lines };
}

export { convert as convertUnits };

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  importTtkArchive().then((r) => console.log('архив ТТК:', r)).catch((e) => { console.error(e.message); process.exitCode = 1; })
    .finally(async () => (await import('../db/pool')).closePool());
}
