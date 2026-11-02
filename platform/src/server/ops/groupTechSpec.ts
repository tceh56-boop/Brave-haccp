import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText } from './common';
import { calcTechSpec } from './techspec';
import { effectiveParams } from './dishgroups';
import { assertSnapshotIntact } from './integrity';

/**
 * Групповые технические условия — одни ТУ на несколько наименований продукции (ГОСТ Р 51740-2016).
 * Расчёт по каждому наименованию — тот же, что для ТУ на одно блюдо (рецептура, органолептика, физико-химия, пищевая
 * ценность, микробиология по группе регламента, сроки). Групповые требования стандарта:
 *  - 4.2.8 — на титульном листе код ОКПД2 категории, включающей всю продукцию ТУ (код категории — начало кодов всех наименований);
 *  - 4.3.6, 4.3.7 — наименование ТУ: обобщённое, во множественном числе; 4.3.10 — не сочетать групповой заголовок и
 *    наименование конкретного продукта;
 *  - 4.3.8 — не включать в одни ТУ продукцию разных видов ОКПД2 (9 знаков) с разными показателями;
 *  - 5.1.3 — ассортимент в разделе «Область применения»; пример записи продукции при заказе (прил. Б);
 *  - 4.4.1 — обозначение: «ТУ» + первые 6 знаков ОКПД2 + номер + ОКПО + год.
 * Дополнительно: у всех наименований один регламент на мясо/птицу (ТР ТС 034 / ТР ЕАЭС 051 / ни один) — иначе
 * требования безопасности разные и одни ТУ их не охватывают.
 */

const okpdRe = /^\d{2}\.\d{2}(\.\d{1,2}(\.\d{1,3})?)?$/;
const ParamsInput = z.object({
  title: z.string().trim().min(3, 'Обобщённое наименование продукции.').max(300).optional(),
  dishIds: z.array(z.uuid()).max(50).optional(),
  okpd2: z.string().trim().regex(okpdRe, 'Код ОКПД2 категории — вида 10.13.14 или 10.13.14.700.').nullable().optional().or(z.literal('').transform(() => null)),
  items: z.record(z.uuid(), z.object({ okpd2: z.string().trim().regex(/^\d{2}\.\d{2}\.\d{2}\.\d{3}$/, 'Код ОКПД2 наименования — 9 знаков: 10.13.14.700.').nullable().optional().or(z.literal('').transform(() => null)) })).optional(),
  okpo: z.string().trim().regex(/^\d{8}(\d{2})?$/, 'ОКПО — 8 или 10 цифр.').nullable().optional().or(z.literal('').transform(() => null)),
  seq: z.string().trim().regex(/^\d{1,3}$/, 'Регистрационный номер — до 3 цифр.').nullable().optional().or(z.literal('').transform(() => null)),
  tuOks: optText(60), tuReplaces: optText(120), tuIntroDate: z.iso.date().nullable().optional().or(z.literal('').transform(() => null)),
  tuDeveloper: optText(300), tuLocation: optText(200), tuPurpose: optText(500), channel: optText(300), packaging: optText(2000),
});
type GroupParams = Omit<z.infer<typeof ParamsInput>, 'title' | 'dishIds'>;

const segs = (c: string) => c.split('.');
const isPrefix = (cat: string, code: string) => { const a = segs(cat), b = segs(code); return a.length <= b.length && a.every((x, i) => x === b[i]); };
/** Наибольший общий код категории (по разрядам ОКПД2) для всех кодов наименований. */
export function commonCategory(codes: string[]) {
  if (!codes.length) return null;
  const parts = codes.map(segs);
  const out: string[] = [];
  for (let i = 0; i < Math.min(...parts.map((p) => p.length)); i++) { if (parts.every((p) => p[i] === parts[0][i])) out.push(parts[0][i]); else break; }
  return out.length >= 2 ? out.join('.') : null;
}

export async function calcGroupTechSpec(tx: Tx, orgId: string, spec: { id: string; title: string; dish_ids: string[]; params: GroupParams; seq: number }) {
  const errors: string[] = [], warnings: string[] = [];
  const p = spec.params || {};
  type Calc = Awaited<ReturnType<typeof calcTechSpec>>;
  type Item = Pick<Calc, 'object' | 'recipe' | 'physico' | 'tolerance' | 'nutrition' | 'micro' | 'storage' | 'organoleptic_table' | 'allergens' | 'meat_regulation' | 'normative' | 'raw' | 'processing' | 'status'>
    & { dish_id: string; name: string; kind: string; okpd2: string | null; ttk_version: number; ttk_version_id: string };
  const items: Item[] = [];
  for (const dishId of spec.dish_ids) {
    const d = (await tx.query(`select id, name, kind from dishes where id = $1 and organization_id = $2`, [dishId, orgId])).rows[0];
    if (!d) { errors.push(`Наименование ${dishId.slice(0, 8)} не найдено.`); continue; }
    const okpd2 = p.items?.[dishId]?.okpd2 || null;
    try {
      const base = await effectiveParams(tx, dishId);
      const c = await calcTechSpec(tx, orgId, dishId, { ...base, okpd2: okpd2 || base.okpd2, okpo: p.okpo || base.okpo, seq: p.seq || base.seq });
      for (const e of c.errors) errors.push(`«${d.name}»: ${e}`);
      // замечания расчёта блюда, кроме титульных (ОКПД2/ОКПО/обозначение/местонахождение заполняются на уровне групповых ТУ)
      for (const w of c.warnings.filter((x) => !/ГОСТ Р 51740-2016, 4\.(2\.8|2\.13|4\.1)/.test(x))) warnings.push(`«${d.name}»: ${w}`);
      if (c.status !== 'ready' && !c.errors.length) warnings.push(`«${d.name}»: расчёт неполный — наименование в статусе «проект».`);
      items.push({ dish_id: d.id, name: d.name, kind: d.kind, okpd2, ttk_version: c.object.ttk_version, ttk_version_id: c.object.ttk_version_id, status: c.status,
        object: c.object, recipe: c.recipe, physico: c.physico, tolerance: c.tolerance, nutrition: c.nutrition, micro: c.micro, storage: c.storage,
        organoleptic_table: c.organoleptic_table, allergens: c.allergens, meat_regulation: c.meat_regulation, normative: c.normative, raw: c.raw, processing: c.processing });
    } catch (e) { errors.push(`«${d.name}»: ${(e as Error).message}`); }
  }
  if (spec.dish_ids.length < 2) errors.push('В групповых ТУ должно быть не менее двух наименований; для одного продукта оформляют ТУ на блюдо.');
  if (items.some((i) => i.name.trim().toLowerCase() === spec.title.trim().toLowerCase()))
    warnings.push('Наименование ТУ совпадает с наименованием одного из продуктов — для групповых ТУ приводят обобщённое наименование во множественном числе (ГОСТ Р 51740-2016, 4.3.6, 4.3.10).');
  // 4.2.8 — код категории
  const missingCode = items.filter((i) => !i.okpd2);
  if (missingCode.length) warnings.push(`Не указан девятиразрядный код ОКПД2 наименований: ${missingCode.map((i) => `«${i.name}»`).join(', ')} (ГОСТ Р 51740-2016, 4.2.8, 4.3.8).`);
  const codes = items.map((i) => i.okpd2).filter(Boolean) as string[];
  const suggested = commonCategory(codes);
  const category = p.okpd2 || suggested;
  if (!category) warnings.push('Укажите код ОКПД2 категории, включающей всю продукцию ТУ (ГОСТ Р 51740-2016, 4.2.8).');
  else if (codes.some((c) => !isPrefix(category, c))) errors.push(`Код категории ${category} не включает коды всех наименований (${codes.join(', ')}) — ГОСТ Р 51740-2016, 4.2.8.`);
  // 4.3.8 — разные виды ОКПД2 с разными показателями
  const byCode = new Map<string, typeof items>();
  for (const i of items) if (i.okpd2) byCode.set(i.okpd2, [...(byCode.get(i.okpd2) || []), i]);
  if (byCode.size > 1) {
    const sig = (i: (typeof items)[number]) => JSON.stringify({ m: i.micro.code, r: i.meat_regulation });
    const groups = [...byCode.values()].map((g) => sig(g[0]));
    if (new Set(groups).size > 1) errors.push(`Наименования разных видов ОКПД2 (${[...byCode.keys()].join(', ')}) с разными показателями безопасности — в одни ТУ не включаются (ГОСТ Р 51740-2016, 4.3.8). Разделите ТУ по видам.`);
  }
  // один регламент на мясо/птицу
  const regs = new Set(items.map((i) => i.meat_regulation || 'none'));
  if (regs.size > 1) errors.push('В группе продукция разных регламентов (ТР ТС 034/2013, ТР ЕАЭС 051/2021, без мясного регламента) — требования безопасности разные, оформите отдельные ТУ.');
  // нормативные ссылки — объединение по наименованиям, в порядке первого появления
  const normative: { code: string; title: string; use: string; state: string }[] = [];
  for (const i of items) for (const n of i.normative) if (!normative.some((x) => x.code === n.code)) normative.push(n);
  const org = (await tx.query(`select name, legal_form, region from organizations where id = $1`, [orgId])).rows[0];
  const ppk = (await tx.query(`select version, approved_at::date::text as d from ppk_versions where organization_id = $1 order by version desc limit 1`, [orgId])).rows[0] || null;
  const holder = `${org.legal_form && org.legal_form !== 'другое' && !org.name.startsWith(org.legal_form) ? `${org.legal_form} ` : ''}${org.name}`;
  const allSemi = items.length > 0 && items.every((i) => i.kind === 'semi');
  const title = { holder, okpd2: category, oks: p.tuOks || null, replaces: p.tuReplaces || null, intro_date: p.tuIntroDate || null, developer: p.tuDeveloper || null,
    location: p.tuLocation || org.region || null,
    purpose: p.tuPurpose || (allSemi ? 'для использования на предприятиях общественного питания при изготовлении блюд и кулинарных изделий' : 'для непосредственного употребления в пищу') };
  if (!title.location) warnings.push('Укажите местонахождение держателя подлинника — субъект РФ и населённый пункт (ГОСТ Р 51740-2016, 4.2.13).');
  const okpd6 = category ? segs(category).slice(0, 3).join('.') : '__.__.__';
  const designation = `ТУ ${okpd6}-${(p.seq || String(spec.seq)).padStart(3, '0')}-${p.okpo || '________'}-${new Date().getFullYear()}`;
  if (!p.okpo) warnings.push('Для обозначения ТУ укажите код ОКПО держателя подлинника (ГОСТ Р 51740-2016, 4.4.1).');
  const ready = !errors.length && items.length >= 2 && items.every((i) => i.status === 'ready') && !!category && !missingCode.length;
  return {
    id: spec.id, name: spec.title, items, title, designation, normative, ppk, suggested_category: suggested,
    channel: p.channel || 'через предприятия общественного питания и вне их', packaging: p.packaging || null, meat_regulation: [...regs][0] === 'none' ? null : [...regs][0],
    status: errors.length ? 'error' : ready ? 'ready' : 'project', errors, warnings, generated_at: new Date().toISOString(),
  };
}

/* ───────────── API ───────────── */

async function loadSpec(tx: Tx, orgId: string, id: string, lock = false) {
  const s = (await tx.query(`select * from group_tech_specs where id = $1 and organization_id = $2 ${lock ? 'for update' : ''}`, [parse(z.uuid(), id), orgId])).rows[0];
  if (!s) throw Errors.notFound('Групповые ТУ не найдены.');
  return s;
}

export async function listGroupTechSpecs(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'menu.read', async (tx) => (await tx.query(`select s.id, s.seq, s.title, array_length(s.dish_ids, 1) as items, s.updated_at,
      (select row_to_json(v) from (select version, designation, approved_at from group_tech_spec_versions x where x.spec_id = s.id order by version desc limit 1) v) as last
    from group_tech_specs s where s.organization_id = $1 and s.status = 'active' order by s.seq`, [orgId])).rows);
}

async function assertDishes(tx: Tx, orgId: string, ids: string[]) {
  const n = Number((await tx.query(`select count(*) from dishes where organization_id = $1 and id = any($2::uuid[])`, [orgId, ids])).rows[0].count);
  if (n !== new Set(ids).size) throw Errors.validation('Часть наименований не найдена.');
}

export async function createGroupTechSpec(userId: string, orgId: string, input: unknown) {
  const d = parse(z.object({ title: z.string().trim().min(3, 'Обобщённое наименование продукции.').max(300), dishIds: z.array(z.uuid()).min(2, 'Выберите не менее двух наименований.').max(50) }), input);
  return inOrg(userId, orgId, 'ttk.manage', async (tx) => {
    await assertDishes(tx, orgId, d.dishIds);
    await tx.query(`select pg_advisory_xact_lock(hashtext('gtu:' || $1))`, [orgId]);
    const seq = Number((await tx.query(`select coalesce(max(seq), 0) + 1 as n from group_tech_specs where organization_id = $1`, [orgId])).rows[0].n);
    const r = (await tx.query(`insert into group_tech_specs (organization_id, seq, title, dish_ids, created_by) values ($1, $2, $3, $4, $5) returning id, seq`,
      [orgId, seq, d.title, [...new Set(d.dishIds)], userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'gtu.create', entityType: 'group_tech_spec', entityId: r.id, after: d });
    return r as { id: string; seq: number };
  });
}

export async function updateGroupTechSpec(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(ParamsInput, input);
  return inOrg(userId, orgId, 'ttk.manage', async (tx) => {
    const s = await loadSpec(tx, orgId, id, true);
    if (d.dishIds) await assertDishes(tx, orgId, d.dishIds);
    const { title, dishIds, ...rest } = d;
    const given = new Set(Object.keys((input && typeof input === 'object' ? input : {}) as object));
    const params = { ...s.params, ...Object.fromEntries(Object.entries(rest).filter(([k]) => given.has(k))) };
    if (rest.items) params.items = { ...(s.params.items || {}), ...rest.items };
    await tx.query(`update group_tech_specs set title = coalesce($2, title), dish_ids = coalesce($3, dish_ids), params = $4, updated_by = $5, updated_at = now() where id = $1`,
      [s.id, title ?? null, dishIds ? [...new Set(dishIds)] : null, JSON.stringify(params), userId]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'gtu.update', entityType: 'group_tech_spec', entityId: s.id, before: { title: s.title, dish_ids: s.dish_ids, params: s.params }, after: d });
    return getInTx(tx, orgId, s.id);
  });
}

async function getInTx(tx: Tx, orgId: string, id: string) {
  const s = await loadSpec(tx, orgId, id);
  const calc = await calcGroupTechSpec(tx, orgId, s);
  const versions = (await tx.query(`select v.version, v.designation, v.lab_protocol, v.approved_at, u.full_name as approved_by_name from group_tech_spec_versions v join users u on u.id = v.approved_by
    where v.spec_id = $1 order by v.version desc`, [s.id])).rows;
  const dishes = (await tx.query(`select d.id, d.name, d.kind from dishes d where d.organization_id = $1 and d.status = 'active'
    and exists (select 1 from ttk_versions v where v.dish_id = d.id and v.status = 'approved') order by d.kind desc, d.name`, [orgId])).rows;
  return { spec: { id: s.id, seq: s.seq, title: s.title, dish_ids: s.dish_ids, params: s.params }, calc, versions, dishes };
}

export async function getGroupTechSpec(userId: string, orgId: string, id: string) {
  return inOrg(userId, orgId, 'menu.read', async (tx) => getInTx(tx, orgId, id));
}

/** Утверждение: только полный расчёт по всем наименованиям и протокол испытаний; снимок неизменяем, с контрольной суммой. */
export async function approveGroupTechSpec(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(z.object({ labProtocol: z.string().trim().min(8, 'Укажите протоколы испытаний аккредитованной лаборатории по наименованиям: номер, дата, лаборатория.').max(1000) }), input);
  return inOrg(userId, orgId, 'ttk.approve', async (tx) => {
    const s = await loadSpec(tx, orgId, id, true);
    const calc = await calcGroupTechSpec(tx, orgId, s);
    if (calc.status !== 'ready') throw Errors.conflict(`Групповые ТУ — проект, утвердить нельзя: ${[...calc.errors, ...calc.warnings].slice(0, 12).join(' ')}`);
    const n = Number((await tx.query(`select coalesce(max(version), 0) + 1 as n from group_tech_spec_versions where spec_id = $1`, [s.id])).rows[0].n);
    const row = (await tx.query(`insert into group_tech_spec_versions (organization_id, spec_id, version, designation, snapshot, lab_protocol, approved_by)
      values ($1, $2, $3, $4, $5, $6, $7) returning id, version, approved_at, content_hash`, [orgId, s.id, n, calc.designation, JSON.stringify(calc), d.labProtocol, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'gtu.approve', entityType: 'group_tech_spec', entityId: s.id, after: { version: n, designation: calc.designation, items: calc.items.length } });
    return row as { id: string; version: number; approved_at: string; content_hash: string };
  });
}

export async function getGroupTechSpecVersion(userId: string, orgId: string, id: string, version: number) {
  return inOrg(userId, orgId, 'menu.read', async (tx) => {
    const v = (await tx.query(`select v.*, u.full_name as approved_by_name from group_tech_spec_versions v join users u on u.id = v.approved_by
      where v.spec_id = $1 and v.organization_id = $2 and v.version = $3`, [parse(z.uuid(), id), orgId, version])).rows[0];
    if (!v) throw Errors.notFound('Версия групповых ТУ не найдена.');
    return { ...v, integrity: await assertSnapshotIntact(tx, 'group_tech_spec_versions', v.id, { orgId, userId }) };
  });
}
