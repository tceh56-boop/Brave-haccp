import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText } from './common';
import { normName } from './recipes';
import { chain, inSeason, mmdd, seasonLabel, seasonsOverlap, type ChainStep, type From } from '../recipes/chain';

/**
 * Обработка сырья (ГОСТ 31988-2012). Нормы отходов (холодная) и потерь (тепловая) по товару и способу вносит
 * организация по основанию — Сборник рецептур (таблица) или акт контрольной проработки; утверждает человек с правом
 * ttk.approve. Система норм не придумывает: без нормы процент вводят вручную с основанием. Подсказка — только
 * статистика собственного архива ТТК (брутто/нетто/выход), её переносит в норму человек.
 */

const r1 = (x: number) => Math.round(x * 10) / 10;

async function orgToday(tx: Tx, orgId: string): Promise<string> {
  return (await tx.query(`select (now() at time zone timezone)::date::text as d from organizations where id = $1`, [orgId])).rows[0].d;
}

export async function listMethods(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'menu.read', async (tx) => (await tx.query(`select code, name, kind from processing_methods order by position`)).rows);
}

const md = z.string().regex(/^\d{1,2}\.\d{1,2}$/, 'Дата сезона — ДД.ММ.').transform((s, ctx) => {
  const [d, m] = s.split('.').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > new Date(2024, m, 0).getDate()) { ctx.addIssue({ code: 'custom', message: `Нет такой даты: ${s}.` }); return z.NEVER; }
  return m * 100 + d;
});
const pct = z.coerce.number().min(0).max(100).nullable().optional();
const NormInput = z.object({
  productId: z.uuid('Выберите товар.'),
  method: z.string().min(1, 'Выберите способ обработки.'),
  lossPct: z.coerce.number('Укажите процент.').gt(-500).lt(100, 'Отход меньше 100 %.'),
  seasonFrom: md.nullable().optional(), seasonTo: md.nullable().optional(),
  proteinLossPct: pct, fatLossPct: pct, carbsLossPct: pct,
  basis: z.string('Укажите основание.').trim().min(5, 'Укажите основание: таблица Сборника рецептур или акт контрольной проработки.').max(500),
  note: optText(500),
}).refine((x) => (x.seasonFrom == null) === (x.seasonTo == null), 'Сезон — обе даты или ни одной.');

export async function createNorm(userId: string, orgId: string, input: unknown) {
  const d = parse(NormInput, input);
  return inOrg(userId, orgId, 'ttk.manage', async (tx) => {
    const m = (await tx.query(`select * from processing_methods where code = $1`, [d.method])).rows[0];
    if (!m) throw Errors.validation('Способ обработки не найден.');
    if (!(await tx.query(`select 1 from products where id = $1 and organization_id = $2`, [d.productId, orgId])).rowCount) throw Errors.validation('Товар не найден.');
    const nutr = [d.proteinLossPct, d.fatLossPct, d.carbsLossPct];
    if (m.kind === 'cold' && nutr.some((x) => x != null)) throw Errors.validation('Потери нутриентов указываются для тепловой обработки.');
    if (nutr.some((x) => x != null) && nutr.some((x) => x == null)) throw Errors.validation('Потери нутриентов — все три (Б, Ж, У) или ни одного.');
    if (d.lossPct < 0 && m.kind === 'cold' && m.code !== 'soak') throw Errors.validation('Привар (отрицательный процент) — для тепловой обработки или замачивания.');
    const n = (await tx.query(`insert into processing_norms (organization_id, product_id, method_code, loss_pct, season_from, season_to, protein_loss_pct, fat_loss_pct, carbs_loss_pct, basis, note, created_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning *`,
      [orgId, d.productId, d.method, d.lossPct, d.seasonFrom ?? null, d.seasonTo ?? null, d.proteinLossPct ?? null, d.fatLossPct ?? null, d.carbsLossPct ?? null, d.basis, d.note, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'processing_norm.create', entityType: 'processing_norm', entityId: n.id, after: d });
    return n;
  });
}

/** Утверждение: пересекающаяся по сезону утверждённая норма того же товара и способа уходит в архив. */
export async function approveNorm(userId: string, orgId: string, normId: string) {
  return inOrg(userId, orgId, 'ttk.approve', async (tx) => {
    const n = (await tx.query(`select * from processing_norms where id = $1 and organization_id = $2 for update`, [parse(z.uuid(), normId), orgId])).rows[0];
    if (!n) throw Errors.notFound('Норма не найдена.');
    if (n.status !== 'draft') throw Errors.conflict('Утвердить можно только черновик нормы.');
    const old = (await tx.query(`select * from processing_norms where organization_id = $1 and product_id = $2 and method_code = $3 and status = 'approved' for update`, [orgId, n.product_id, n.method_code])).rows
      .filter((o) => seasonsOverlap([o.season_from, o.season_to], [n.season_from, n.season_to]));
    for (const o of old) await tx.query(`update processing_norms set status = 'archived', archived_by = $2, archived_at = now(), archive_reason = $3 where id = $1`, [o.id, userId, 'заменена новой нормой']);
    await tx.query(`update processing_norms set status = 'approved', approved_by = $2, approved_at = now() where id = $1`, [n.id, userId]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'processing_norm.approve', entityType: 'processing_norm', entityId: n.id, after: { replaced: old.map((o) => o.id) } });
    return { ok: true, replaced: old.length };
  });
}

export async function archiveNorm(userId: string, orgId: string, normId: string, input: unknown) {
  const d = parse(z.object({ reason: z.string('Укажите причину.').trim().min(5, 'Укажите причину.').max(500) }), input);
  return inOrg(userId, orgId, 'ttk.approve', async (tx) => {
    const n = (await tx.query(`select * from processing_norms where id = $1 and organization_id = $2 for update`, [parse(z.uuid(), normId), orgId])).rows[0];
    if (!n) throw Errors.notFound('Норма не найдена.');
    if (n.status === 'archived') throw Errors.conflict('Норма уже в архиве.');
    await tx.query(`update processing_norms set status = 'archived', archived_by = $2, archived_at = now(), archive_reason = $3 where id = $1`, [n.id, userId, d.reason]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'processing_norm.archive', entityType: 'processing_norm', entityId: n.id, reason: d.reason });
    return { ok: true };
  });
}

/** Обработка по умолчанию (подставляется в новую строку ТТК); только для утверждённой нормы. */
export async function setNormDefault(userId: string, orgId: string, normId: string, input: unknown) {
  const d = parse(z.object({ isDefault: z.boolean() }), input);
  return inOrg(userId, orgId, 'ttk.manage', async (tx) => {
    const n = (await tx.query(`select * from processing_norms where id = $1 and organization_id = $2 for update`, [parse(z.uuid(), normId), orgId])).rows[0];
    if (!n) throw Errors.notFound('Норма не найдена.');
    if (n.status !== 'approved') throw Errors.conflict('По умолчанию — только утверждённая норма.');
    await tx.query(`update processing_norms set is_default = $2 where id = $1`, [n.id, d.isDefault]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'processing_norm.default', entityType: 'processing_norm', entityId: n.id, after: d });
    return { ok: true };
  });
}

/** Шаги по умолчанию для товара на дату: способы с отметкой «по умолчанию», процент — действующей по сезону нормы. */
export async function defaultSteps(tx: Tx, orgId: string, productId: string) {
  const today = await orgToday(tx, orgId);
  const codes = (await tx.query(`select distinct n.method_code, m.position from processing_norms n join processing_methods m on m.code = n.method_code
    where n.organization_id = $1 and n.product_id = $2 and n.status = 'approved' and n.is_default order by m.position`, [orgId, productId])).rows;
  const out: { method: string; normId: string; basis: null }[] = [];
  for (const c of codes) { const n = await normFor(tx, orgId, productId, c.method_code, today); if (n) out.push({ method: c.method_code, normId: n.id, basis: null }); }
  return out;
}

/**
 * Пересчёт черновиков ТТК по утверждённой норме (по решению человека): в строках этого товара шаг того же способа
 * получает процент нормы; выход строки сохраняется, брутто и нетто пересчитываются.
 */
export async function applyNormToDrafts(userId: string, orgId: string, normId: string) {
  return inOrg(userId, orgId, 'ttk.manage', async (tx) => {
    const n = (await tx.query(`select * from processing_norms where id = $1 and organization_id = $2`, [parse(z.uuid(), normId), orgId])).rows[0];
    if (!n) throw Errors.notFound('Норма не найдена.');
    if (n.status !== 'approved') throw Errors.conflict('Пересчитать можно только по утверждённой норме.');
    const rows = (await tx.query(`select s.id as step_id, s.line_id from ttk_line_steps s join ttk_lines l on l.id = s.line_id join ttk_versions v on v.id = s.version_id
      where s.organization_id = $1 and v.status = 'draft' and l.product_id = $2 and s.method_code = $3 and (s.norm_id is distinct from $4 or s.loss_pct <> $5)`,
      [orgId, n.product_id, n.method_code, n.id, n.loss_pct])).rows;
    const basis = `${n.basis}${n.season_from ? ` (${seasonLabel(n.season_from, n.season_to)})` : ''}`;
    const lines = [...new Set(rows.map((r) => r.line_id))];
    for (const r of rows) {
      // шаг пересоздаётся (шаги не изменяются на месте)
      const s = (await tx.query(`delete from ttk_line_steps where id = $1 returning *`, [r.step_id])).rows[0];
      await tx.query(`insert into ttk_line_steps (organization_id, version_id, line_id, position, method_code, norm_id, loss_pct, protein_loss_pct, fat_loss_pct, carbs_loss_pct, basis)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [orgId, s.version_id, s.line_id, s.position, s.method_code, n.id, n.loss_pct, n.protein_loss_pct, n.fat_loss_pct, n.carbs_loss_pct, basis]);
    }
    for (const id of lines) await recalcLine(tx, id);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'processing_norm.apply_drafts', entityType: 'processing_norm', entityId: n.id, after: { lines: lines.length } });
    return { lines: lines.length };
  });
}

/** Пересчёт строки по её шагам: от выхода, если он есть, иначе от той величины, от которой строка считалась. */
async function recalcLine(tx: Tx, lineId: string) {
  const l = (await tx.query(`select * from ttk_lines where id = $1`, [lineId])).rows[0];
  const steps = (await versionSteps(tx, l.version_id)).get(lineId) || [];
  const from: From = l.ready !== null && Number(l.ready) > 0 ? 'ready' : (l.calc_from as From) || 'brutto';
  const value = Number(l[from]);
  if (!(value > 0)) return;
  const c = chain(steps as any, from, value);
  await tx.query(`update ttk_lines set brutto = $2, netto = $3, ready = $4 where id = $1`, [lineId, c.brutto, c.netto, c.ready]);
}

const normRow = (n: Record<string, any>) => ({ ...n, loss_pct: Number(n.loss_pct), season: seasonLabel(n.season_from, n.season_to),
  protein_loss_pct: n.protein_loss_pct === null ? null : Number(n.protein_loss_pct), fat_loss_pct: n.fat_loss_pct === null ? null : Number(n.fat_loss_pct),
  carbs_loss_pct: n.carbs_loss_pct === null ? null : Number(n.carbs_loss_pct) });

export async function listNorms(userId: string, orgId: string, opts: { productId?: string | null; archived?: boolean } = {}) {
  return inOrg(userId, orgId, 'menu.read', async (tx) => {
    const rows = (await tx.query(`select n.*, p.name as product_name, p.unit as product_unit, m.name as method_name, m.kind as method_kind, ua.full_name as approved_by_name
      from processing_norms n join products p on p.id = n.product_id join processing_methods m on m.code = n.method_code left join users ua on ua.id = n.approved_by
      where n.organization_id = $1 and ($2::uuid is null or n.product_id = $2) and ($3::boolean or n.status <> 'archived')
      order by p.name, m.position, n.season_from nulls first, n.created_at desc`, [orgId, opts.productId || null, !!opts.archived])).rows;
    return { norms: rows.map(normRow), today: await orgToday(tx, orgId) };
  });
}

/** Утверждённая норма товара и способа на дату (по сезону). */
export async function normFor(tx: Tx, orgId: string, productId: string, method: string, date: string) {
  const rows = (await tx.query(`select * from processing_norms where organization_id = $1 and product_id = $2 and method_code = $3 and status = 'approved'`, [orgId, productId, method])).rows;
  const x = mmdd(date);
  // сезонная норма точнее круглогодичной
  return rows.filter((n) => inSeason(x, n.season_from, n.season_to)).sort((a, b) => Number(a.season_from === null) - Number(b.season_from === null))[0] || null;
}

/** Утверждённые нормы товара, действующие сегодня — для выбора шагов в карте. */
export async function normsToday(userId: string, orgId: string, productId: string) {
  return inOrg(userId, orgId, 'menu.read', async (tx) => {
    const today = await orgToday(tx, orgId);
    const methods = (await tx.query(`select code from processing_methods`)).rows;
    const out: Record<string, unknown> = {};
    for (const m of methods) { const n = await normFor(tx, orgId, parse(z.uuid(), productId), m.code, today); if (n) out[m.code] = normRow(n); }
    return { today, norms: out };
  });
}

/**
 * Подсказка из архива ТТК: фактические отходы и потери по строкам с тем же сырьём (по названию товара и запомненным
 * названиям). Это не норма — человек переносит значение в норму со своим основанием.
 */
export async function suggestFromArchive(userId: string, orgId: string, productId: string) {
  return inOrg(userId, orgId, 'menu.read', async (tx) => {
    const p = (await tx.query(`select name from products where id = $1 and organization_id = $2`, [parse(z.uuid(), productId), orgId])).rows[0];
    if (!p) throw Errors.notFound('Товар не найден.');
    const names = new Set([normName(p.name), ...(await tx.query(`select name_norm from ingredient_aliases where organization_id = $1 and product_id = $2`, [orgId, productId])).rows.map((r) => r.name_norm)]);
    const rows = (await tx.query(`select a.name as card, l->>'name' as name, (l->>'brutto')::numeric as brutto, (l->>'netto')::numeric as netto, (l->>'ready')::numeric as ready
      from ttk_archive a, jsonb_array_elements(a.lines) l where l->>'name' is not null`)).rows.filter((r) => names.has(normName(r.name)));
    const stat = (xs: { v: number; card: string }[]) => {
      if (!xs.length) return null;
      const s = xs.map((x) => x.v).sort((a, b) => a - b);
      return { n: s.length, min: r1(s[0]), median: r1(s[Math.floor(s.length / 2)]), max: r1(s[s.length - 1]), cards: [...new Set(xs.map((x) => x.card))].slice(0, 8) };
    };
    const cold: { v: number; card: string }[] = [], thermal: { v: number; card: string }[] = [];
    for (const r of rows) {
      const b = Number(r.brutto), n = Number(r.netto), y = Number(r.ready);
      // строки без обработки (брутто = нетто, нетто = выход) — не статистика отходов
      if (b > 0 && n > 0 && n < b) cold.push({ v: (1 - n / b) * 100, card: r.card });
      if (n > 0 && y > 0 && r.ready !== null && Math.abs(n - y) > 1e-9) thermal.push({ v: (1 - y / n) * 100, card: r.card });
    }
    return { product: p.name, names: [...names], lines: rows.length, cold: stat(cold), thermal: stat(thermal) };
  });
}

/* ───────────── Шаги строки ТТК ───────────── */

const StepsInput = z.object({
  steps: z.array(z.object({
    method: z.string().min(1),
    normId: z.uuid().nullable().optional(),
    lossPct: z.coerce.number().gt(-500).lt(100).nullable().optional(),
    basis: optText(500),
  })).max(12),
  from: z.enum(['brutto', 'netto', 'ready']).default('brutto'),
  value: z.coerce.number('Укажите количество.').positive('Количество больше нуля.'),
});

/**
 * Шаги обработки строки черновика: процент — из утверждённой нормы товара (явно выбранной или действующей сегодня по
 * сезону), либо вручную с основанием. Брутто, нетто и выход пересчитываются от указанной величины.
 */
export async function setLineSteps(userId: string, orgId: string, lineId: string, input: unknown) {
  const d = parse(StepsInput, input);
  return inOrg(userId, orgId, 'ttk.manage', (tx) => applyLineSteps(tx, orgId, userId, lineId, d));
}

export async function applyLineSteps(tx: Tx, orgId: string, userId: string, lineId: string, d: z.infer<typeof StepsInput>) {
  {
    const l = (await tx.query(`select l.*, v.status as v_status, p.name as product_name from ttk_lines l join ttk_versions v on v.id = l.version_id left join products p on p.id = l.product_id
      where l.id = $1 and l.organization_id = $2 for update of l`, [parse(z.uuid(), lineId), orgId])).rows[0];
    if (!l) throw Errors.notFound('Строка не найдена.');
    if (l.v_status !== 'draft') throw Errors.conflict('ТТК не в черновике — изменения вносятся новой версией.');
    if (l.unit === 'порция' || l.unit === 'шт') { if (d.steps.length) throw Errors.validation('Обработка считается по массе или объёму — укажите строку в г, кг, мл или л.'); }
    const today = await orgToday(tx, orgId);
    const methods = new Map((await tx.query(`select * from processing_methods`)).rows.map((m) => [m.code, m]));
    const steps: (ChainStep & { method: string; norm_id: string | null; basis: string; protein_loss_pct: number | null; fat_loss_pct: number | null; carbs_loss_pct: number | null })[] = [];
    for (const s of d.steps) {
      const m = methods.get(s.method);
      if (!m) throw Errors.validation('Способ обработки не найден.');
      let norm = null;
      if (s.normId) {
        norm = (await tx.query(`select * from processing_norms where id = $1 and organization_id = $2`, [s.normId, orgId])).rows[0];
        if (!norm || norm.status !== 'approved') throw Errors.validation(`${m.name}: норма не утверждена.`);
        if (norm.product_id !== l.product_id || norm.method_code !== s.method) throw Errors.validation(`${m.name}: норма относится к другому товару или способу.`);
      } else if (s.lossPct == null && l.product_id) norm = await normFor(tx, orgId, l.product_id, s.method, today);
      if (norm) {
        steps.push({ kind: m.kind, method: s.method, norm_id: norm.id, loss_pct: Number(norm.loss_pct), basis: `${norm.basis}${norm.season_from ? ` (${seasonLabel(norm.season_from, norm.season_to)})` : ''}`,
          protein_loss_pct: norm.protein_loss_pct === null ? null : Number(norm.protein_loss_pct), fat_loss_pct: norm.fat_loss_pct === null ? null : Number(norm.fat_loss_pct),
          carbs_loss_pct: norm.carbs_loss_pct === null ? null : Number(norm.carbs_loss_pct) });
      } else {
        const who = l.product_name || l.name_raw;
        if (s.lossPct == null) throw Errors.validation(`${who} — ${m.name.toLowerCase()}: нет утверждённой нормы. Внесите норму или укажите процент с основанием.`);
        if (!s.basis || s.basis.length < 5) throw Errors.validation(`${who} — ${m.name.toLowerCase()}: укажите основание процента (акт контрольной проработки, таблица Сборника).`);
        steps.push({ kind: m.kind, method: s.method, norm_id: null, loss_pct: s.lossPct, basis: s.basis, protein_loss_pct: null, fat_loss_pct: null, carbs_loss_pct: null });
      }
    }
    if (!steps.length) {
      await tx.query(`delete from ttk_line_steps where line_id = $1`, [l.id]);
      await tx.query(`update ttk_lines set calc_from = null where id = $1`, [l.id]);
      await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'ttk.line_steps', entityType: 'ttk_version', entityId: l.version_id, after: { line: l.id, steps: [] } });
      return { brutto: l.brutto === null ? null : Number(l.brutto), netto: l.netto === null ? null : Number(l.netto), ready: l.ready === null ? null : Number(l.ready), steps: [] };
    }
    const c = chain(steps, d.from as From, d.value);
    await tx.query(`delete from ttk_line_steps where line_id = $1`, [l.id]);
    let pos = 0;
    for (const s of steps) {
      await tx.query(`insert into ttk_line_steps (organization_id, version_id, line_id, position, method_code, norm_id, loss_pct, protein_loss_pct, fat_loss_pct, carbs_loss_pct, basis)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [orgId, l.version_id, l.id, ++pos, s.method, s.norm_id, s.loss_pct, s.protein_loss_pct, s.fat_loss_pct, s.carbs_loss_pct, s.basis]);
    }
    await tx.query(`update ttk_lines set brutto = $2, netto = $3, ready = $4, calc_from = $5 where id = $1`, [l.id, c.brutto, c.netto, c.ready, d.from]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'ttk.line_steps', entityType: 'ttk_version', entityId: l.version_id,
      before: { brutto: l.brutto, netto: l.netto, ready: l.ready }, after: { line: l.id, ...c, from: d.from, steps: steps.map((s) => ({ method: s.method, loss_pct: s.loss_pct, norm_id: s.norm_id })) } });
    return { ...c, steps };
  }
}

/** Шаги строк версии (для карточки, расчёта и копирования). */
export async function versionSteps(tx: Tx, versionId: string) {
  const rows = (await tx.query(`select s.*, m.name as method_name, m.kind from ttk_line_steps s join processing_methods m on m.code = s.method_code where s.version_id = $1 order by s.line_id, s.position`, [versionId])).rows;
  const by = new Map<string, Record<string, any>[]>();
  for (const r of rows) {
    const x = { ...r, loss_pct: Number(r.loss_pct), protein_loss_pct: r.protein_loss_pct === null ? null : Number(r.protein_loss_pct),
      fat_loss_pct: r.fat_loss_pct === null ? null : Number(r.fat_loss_pct), carbs_loss_pct: r.carbs_loss_pct === null ? null : Number(r.carbs_loss_pct) };
    by.set(r.line_id, [...(by.get(r.line_id) || []), x]);
  }
  return by;
}
