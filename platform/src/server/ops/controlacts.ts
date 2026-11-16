import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText, assertSiteAccess, getSite } from './common';
import { convertUnits } from './recipes';
import { semiGrams } from './bom';
import { versionSteps } from './processing';
import { stages, lossPct } from '../recipes/chain';

/**
 * Акт контрольной проработки (ГОСТ 31988-2012): комиссия готовит блюдо по ТТК и взвешивает сырьё по стадиям.
 * Черновик заполняется плановыми массами из ТТК (на порцию блюда, для п/ф — на закладку), комиссия вписывает
 * фактические; проценты отходов и потерь считаются по массам. Утверждает человек с правом ttk.approve; утверждённый
 * акт не меняется и служит основанием норм обработки сырья.
 */

const r1 = (x: number) => Math.round(x * 10) / 10;

export interface ActLine { name: string; unit: string; processing: string; brutto: number | null; netto: number | null; thermal: number | null; ready: number | null; in_yield: boolean }

const withPct = (l: ActLine) => ({ ...l, cold_pct: lossPct(l.brutto, l.netto), thermal_pct: lossPct(l.netto, l.thermal), after_pct: lossPct(l.thermal, l.ready) });

async function planned(tx: Tx, orgId: string, v: Record<string, any>, isDish: boolean) {
  const scale = isDish && v.portion_g && v.yield_g ? Number(v.portion_g) / Number(v.yield_g) : 1;
  const rows = (await tx.query(`select l.*, p.name as product_name, d.name as sub_name from ttk_lines l left join products p on p.id = l.product_id left join dishes d on d.id = l.sub_dish_id
    where l.version_id = $1 and l.kind = 'item' order by l.position`, [v.id])).rows;
  const steps = await versionSteps(tx, v.id);
  const lines: ActLine[] = [];
  for (const l of rows) {
    const g = async (q: unknown) => (q === null || q === undefined ? null : l.product_id ? await convertUnits(tx, l.product_id, Number(q) * scale, l.unit, 'г') : l.sub_dish_id ? await semiGrams(tx, l.sub_dish_id, Number(q) * scale, l.unit) : null);
    const ls = steps.get(l.id) || [];
    const b = await g(l.brutto ?? l.netto), n = await g(l.netto ?? l.brutto), rd = await g(l.ready);
    let thermal = rd ?? n, ready = rd ?? n;
    if (ls.length && b !== null) { const s = stages(ls as any, b); thermal = s.thermal; ready = s.ready; }
    lines.push({ name: l.product_name || (l.sub_name ? `${l.sub_name} (п/ф)` : l.name_raw), unit: 'г', processing: ls.length ? ls.map((s) => s.method_name).join(', ') : 'Нет обработки',
      brutto: b === null ? null : r1(b), netto: n === null ? null : r1(n), thermal: thermal === null ? null : r1(thermal), ready: ready === null ? null : r1(ready), in_yield: l.in_yield });
  }
  return { lines, output: isDish && v.portion_g ? Number(v.portion_g) : v.yield_g ? Number(v.yield_g) : null };
}

const Member = z.object({ position: z.string().trim().min(2, 'Должность члена комиссии.').max(120), name: z.string().trim().min(2, 'ФИО члена комиссии.').max(120) });

export async function createAct(userId: string, orgId: string, dishId: string, input: unknown) {
  const d = parse(z.object({ siteId: z.uuid().nullable().optional(), actDate: z.iso.date().optional(), commission: z.array(Member).max(10).default([]) }), input);
  return inOrg(userId, orgId, 'ttk.manage', async (tx, m) => {
    if (d.siteId) { await getSite(tx, orgId, d.siteId); assertSiteAccess(m, d.siteId); }
    const dish = (await tx.query(`select * from dishes where id = $1 and organization_id = $2`, [parse(z.uuid(), dishId), orgId])).rows[0];
    if (!dish) throw Errors.notFound('Блюдо не найдено.');
    // проработка — обычно по разрабатываемой версии; нет черновика — по утверждённой
    const v = (await tx.query(`select * from ttk_versions where dish_id = $1 order by (status in ('draft', 'review')) desc, (status = 'approved') desc, version desc limit 1`, [dishId])).rows[0];
    const p = await planned(tx, orgId, v, dish.kind === 'dish');
    if (!p.lines.length) throw Errors.validation('В ТТК нет состава — прорабатывать нечего.');
    const number = Number((await tx.query(`select coalesce(max(number), 0) + 1 as n from control_acts where organization_id = $1`, [orgId])).rows[0].n);
    const today = (await tx.query(`select (now() at time zone timezone)::date::text as d from organizations where id = $1`, [orgId])).rows[0].d;
    const a = (await tx.query(`insert into control_acts (organization_id, site_id, dish_id, ttk_version_id, number, act_date, commission, lines, output_g, technology, created_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id, number`,
      [orgId, d.siteId || null, dishId, v.id, number, d.actDate || today, JSON.stringify(d.commission), JSON.stringify(p.lines), p.output, v.technology, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId || null, actorUserId: userId, action: 'control_act.create', entityType: 'control_act', entityId: a.id, after: { number, dish: dish.name, version: v.version } });
    return a;
  });
}

const mass = z.coerce.number().min(0).nullable().optional();
const UpdateInput = z.object({
  siteId: z.uuid().nullable().optional(), actDate: z.iso.date().optional(), commission: z.array(Member).max(10).optional(),
  lines: z.array(z.object({ brutto: mass, netto: mass, thermal: mass, ready: mass })).optional(),
  outputG: z.coerce.number().positive('Выход больше нуля.').nullable().optional(), technology: optText(10000), note: optText(2000),
});

async function draftAct(tx: Tx, orgId: string, id: string) {
  const a = (await tx.query(`select * from control_acts where id = $1 and organization_id = $2 for update`, [parse(z.uuid(), id), orgId])).rows[0];
  if (!a) throw Errors.notFound('Акт не найден.');
  if (a.status !== 'draft') throw Errors.conflict('Акт утверждён — не изменяется.');
  return a;
}

/** Фактические массы и состав комиссии (черновик). */
export async function updateAct(userId: string, orgId: string, actId: string, input: unknown) {
  const d = parse(UpdateInput, input);
  return inOrg(userId, orgId, 'ttk.manage', async (tx, m) => {
    const a = await draftAct(tx, orgId, actId);
    if (d.siteId) { await getSite(tx, orgId, d.siteId); assertSiteAccess(m, d.siteId); }
    let lines: ActLine[] = a.lines;
    if (d.lines) {
      if (d.lines.length !== lines.length) throw Errors.validation('Состав акта — как в ТТК: число строк не совпадает.');
      lines = lines.map((l, i) => {
        const x = d.lines![i], v = { brutto: x.brutto ?? null, netto: x.netto ?? null, thermal: x.thermal ?? null, ready: x.ready ?? null };
        return { ...l, ...v };
      });
    }
    await tx.query(`update control_acts set site_id = $2, act_date = $3, commission = $4, lines = $5, output_g = $6, technology = $7, note = $8 where id = $1`,
      [a.id, d.siteId === undefined ? a.site_id : d.siteId, d.actDate || a.act_date, JSON.stringify(d.commission ?? a.commission), JSON.stringify(lines),
        d.outputG === undefined ? a.output_g : d.outputG, d.technology === undefined ? a.technology : d.technology, d.note === undefined ? a.note : d.note]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'control_act.update', entityType: 'control_act', entityId: a.id, after: { lines: !!d.lines, commission: d.commission?.length } });
    return { ok: true };
  });
}

/** Утверждение: массы по всем строкам, нетто ≤ брутто (кроме привара), выход и комиссия не менее двух человек. */
export async function approveAct(userId: string, orgId: string, actId: string) {
  return inOrg(userId, orgId, 'ttk.approve', async (tx) => {
    const a = await draftAct(tx, orgId, actId);
    const problems: string[] = [];
    if ((a.commission as unknown[]).length < 2) problems.push('Комиссия — не менее двух человек.');
    if (!a.output_g) problems.push('Укажите выход готового изделия.');
    for (const l of a.lines as ActLine[]) {
      if (!(Number(l.brutto) > 0) || l.netto === null || l.ready === null) problems.push(`«${l.name}»: внесите массы брутто, нетто и выхода.`);
      else if (Number(l.netto) > Number(l.brutto)) problems.push(`«${l.name}»: нетто больше брутто.`);
    }
    if (problems.length) throw Errors.validation(`Утвердить нельзя: ${problems.join(' ')}`, problems);
    await tx.query(`update control_acts set status = 'approved', approved_by = $2, approved_at = now() where id = $1`, [a.id, userId]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'control_act.approve', entityType: 'control_act', entityId: a.id, after: { number: a.number } });
    return { ok: true };
  });
}

export async function deleteAct(userId: string, orgId: string, actId: string) {
  return inOrg(userId, orgId, 'ttk.manage', async (tx) => {
    const a = await draftAct(tx, orgId, actId);
    await tx.query(`delete from control_acts where id = $1`, [a.id]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'control_act.delete', entityType: 'control_act', entityId: a.id, before: { number: a.number } });
    return { ok: true };
  });
}

export async function listActs(userId: string, orgId: string, dishId: string) {
  return inOrg(userId, orgId, 'menu.read', async (tx) => (await tx.query(`select a.id, a.number, a.act_date::text as act_date, a.status, v.version as ttk_version
    from control_acts a join ttk_versions v on v.id = a.ttk_version_id where a.dish_id = $1 and a.organization_id = $2 order by a.number desc`, [parse(z.uuid(), dishId), orgId])).rows);
}

export async function getAct(userId: string, orgId: string, actId: string) {
  return inOrg(userId, orgId, 'menu.read', async (tx) => {
    const a = (await tx.query(`select a.*, a.act_date::text as act_date, d.name as dish_name, d.kind as dish_kind, s.name as site_name, v.version as ttk_version, ua.full_name as approved_by_name
      from control_acts a join dishes d on d.id = a.dish_id left join sites s on s.id = a.site_id join ttk_versions v on v.id = a.ttk_version_id left join users ua on ua.id = a.approved_by
      where a.id = $1 and a.organization_id = $2`, [parse(z.uuid(), actId), orgId])).rows[0];
    if (!a) throw Errors.notFound('Акт не найден.');
    const org = (await tx.query(`select name, legal_form from organizations where id = $1`, [orgId])).rows[0];
    return { ...a, lines: (a.lines as ActLine[]).map(withPct), org, basis: `Акт контрольной проработки № ${a.number} от ${String(a.act_date).split('-').reverse().join('.')}` };
  });
}
