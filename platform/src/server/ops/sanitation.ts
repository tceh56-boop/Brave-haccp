import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText, assertSiteAccess, getSite, fmtNum } from './common';
import { raiseIncident } from './incidents';

/**
 * Санитария (этап 15; перенос санитарного контура MON CHEF V41–V43).
 *  - Дезсредство: назначение, рабочая концентрация (от/до, %), экспозиция — из инструкции производителя;
 *    основание обязательно, система концентраций не придумывает. В план — только утверждённое средство.
 *  - План: зона и работа, вид (текущая, генеральная уборка, дезинфекция, мойка инвентаря), периодичность, средство,
 *    нужен ли замер концентрации, исполнитель (роль), ближайший срок.
 *  - Выполнение (запись не меняется): с замером концентрации, если он нужен. Концентрация вне режима — запись
 *    «отклонение», отклонение ответственному, срок плана не сдвигается (приготовить раствор заново и повторить).
 *    Выполнено — следующий срок = сегодня + периодичность.
 *  - Проверка — другим сотрудником: «принято» или «не принято» с замечанием (повторить: срок плана — сегодня).
 */

export const PLAN_KIND: Record<string, string> = { current: 'Текущая уборка', general: 'Генеральная уборка', disinfection: 'Дезинфекция', inventory: 'Мойка инвентаря и тары' };
const pct = z.union([z.number(), z.string().trim().regex(/^\d+([.,]\d+)?$/, 'Введите число.').transform((s) => Number(s.replace(',', '.')))]).refine((v) => v >= 0 && v <= 100, 'Концентрация — от 0 до 100 %.');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД.');
const addDays = (s: string, n: number) => { const t = new Date(`${s}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const range = (x: { concentration_min: string | null; concentration_max: string | null }) =>
  x.concentration_min !== null && x.concentration_max !== null ? (Number(x.concentration_min) === Number(x.concentration_max) ? `${fmtNum(x.concentration_min)} %` : `${fmtNum(x.concentration_min)}–${fmtNum(x.concentration_max)} %`)
    : x.concentration_min !== null ? `не менее ${fmtNum(x.concentration_min)} %` : x.concentration_max !== null ? `не более ${fmtNum(x.concentration_max)} %` : null;

async function todayOf(tx: Tx, orgId: string) {
  return (await tx.query(`select (now() at time zone timezone)::date::text as d from organizations where id = $1`, [orgId])).rows[0].d as string;
}

/* ───────────── Дезсредства ───────────── */

const DisInput = z.object({
  name: z.string().trim().min(2, 'Укажите наименование средства.').max(200), purpose: z.string().trim().min(3, 'Укажите назначение: поверхности, инвентарь, посуда.').max(300),
  concentrationMin: pct.optional().nullable(), concentrationMax: pct.optional().nullable(), exposure: optText(200),
  basis: z.string().trim().min(5, 'Укажите основание: инструкция производителя (дата, номер), СГР или декларация.').max(300),
}).refine((x) => x.concentrationMin == null || x.concentrationMax == null || x.concentrationMin <= x.concentrationMax, 'Концентрация «от» не больше «до».');

export async function createDisinfectant(userId: string, orgId: string, input: unknown) {
  const d = parse(DisInput, input);
  return inOrg(userId, orgId, 'sanitation.manage', async (tx) => {
    const r = (await tx.query(`insert into disinfectants (organization_id, name, purpose, concentration_min, concentration_max, exposure, basis, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [orgId, d.name, d.purpose, d.concentrationMin ?? null, d.concentrationMax ?? null, d.exposure, d.basis, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'disinfectant.create', entityType: 'disinfectant', entityId: r.id, after: d });
    return r;
  });
}

/** Утверждение режима средства (концентрация, экспозиция, основание). */
export async function approveDisinfectant(userId: string, orgId: string, id: string) {
  return inOrg(userId, orgId, 'sanitation.manage', async (tx) => {
    const x = (await tx.query(`select * from disinfectants where id = $1 and organization_id = $2 for update`, [id, orgId])).rows[0];
    if (!x) throw Errors.notFound('Средство не найдено.');
    if (x.status !== 'draft') throw Errors.conflict('Утвердить можно только черновик.');
    await tx.query(`update disinfectants set status = 'approved', approved_by = $2, approved_at = now() where id = $1`, [x.id, userId]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'disinfectant.approve', entityType: 'disinfectant', entityId: x.id, after: { range: range(x), basis: x.basis } });
    return { ok: true };
  });
}

export async function archiveDisinfectant(userId: string, orgId: string, id: string) {
  return inOrg(userId, orgId, 'sanitation.manage', async (tx) => {
    const x = (await tx.query(`select * from disinfectants where id = $1 and organization_id = $2 for update`, [id, orgId])).rows[0];
    if (!x) throw Errors.notFound('Средство не найдено.');
    if ((await tx.query(`select 1 from sanitation_plans where disinfectant_id = $1 and status = 'active'`, [x.id])).rowCount) throw Errors.conflict('Средство указано в действующем плане — сначала замените его в плане.');
    await tx.query(`update disinfectants set status = 'archived' where id = $1`, [x.id]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'disinfectant.archive', entityType: 'disinfectant', entityId: x.id });
    return { ok: true };
  });
}

/* ───────────── План ───────────── */

const PlanInput = z.object({
  siteId: z.uuid(), area: z.string().trim().min(2, 'Укажите зону или объект.').max(200), work: z.string().trim().min(3, 'Укажите, что делать.').max(500),
  kind: z.enum(['current', 'general', 'disinfection', 'inventory']), periodDays: z.coerce.number().int().min(1, 'Периодичность — от 1 дня.').max(365),
  disinfectantId: z.uuid().optional().nullable(), checkConcentration: z.boolean().default(false),
  responsibleRole: z.enum(['line_staff', 'chef', 'storekeeper', 'haccp_lead']).default('line_staff'), nextDue: day.optional().nullable(),
});

export async function createPlan(userId: string, orgId: string, input: unknown) {
  const d = parse(PlanInput, input);
  return inOrg(userId, orgId, 'sanitation.manage', async (tx) => {
    await getSite(tx, orgId, d.siteId);
    if (d.disinfectantId) {
      const x = (await tx.query(`select * from disinfectants where id = $1 and organization_id = $2`, [d.disinfectantId, orgId])).rows[0];
      if (!x) throw Errors.notFound('Средство не найдено.');
      if (x.status !== 'approved') throw Errors.conflict(`Режим средства «${x.name}» не утверждён — в план не включается.`);
      if (d.checkConcentration && !range(x)) throw Errors.conflict(`У средства «${x.name}» не задана рабочая концентрация — замер не с чем сравнить.`);
    }
    if (d.checkConcentration && !d.disinfectantId) throw Errors.validation('Для замера концентрации выберите средство.');
    const p = (await tx.query(`insert into sanitation_plans (organization_id, site_id, area, work, kind, period_days, disinfectant_id, check_concentration, responsible_role, next_due, created_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
    [orgId, d.siteId, d.area, d.work, d.kind, d.periodDays, d.disinfectantId || null, d.checkConcentration, d.responsibleRole, d.nextDue || await todayOf(tx, orgId), userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: 'sanitation.plan_create', entityType: 'sanitation_plan', entityId: p.id, after: d });
    return p;
  }, d.siteId);
}

export async function archivePlan(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(z.object({ reason: z.string().trim().min(5, 'Укажите причину.').max(300) }), input);
  return inOrg(userId, orgId, 'sanitation.manage', async (tx, m) => {
    const p = (await tx.query(`select * from sanitation_plans where id = $1 and organization_id = $2 for update`, [id, orgId])).rows[0];
    if (!p) throw Errors.notFound('Пункт плана не найден.');
    assertSiteAccess(m, p.site_id);
    await tx.query(`update sanitation_plans set status = 'archived' where id = $1`, [p.id]);
    await audit.record(tx, { organizationId: orgId, siteId: p.site_id, actorUserId: userId, action: 'sanitation.plan_archive', entityType: 'sanitation_plan', entityId: p.id, reason: d.reason });
    return { ok: true };
  });
}

/** План на площадке со сроками; записи за 7 дней с проверкой; средства. */
export async function listSanitation(userId: string, orgId: string, siteId: string) {
  const sid = parse(z.uuid({ message: 'Выберите площадку.' }), siteId);
  return inOrg(userId, orgId, 'sanitation.record', async (tx) => {
    const today = await todayOf(tx, orgId);
    const plans = (await tx.query(`select p.id, p.area, p.work, p.kind, p.period_days, p.check_concentration, p.responsible_role, p.next_due::text as next_due, p.disinfectant_id,
        x.name as disinfectant, x.concentration_min, x.concentration_max, x.exposure
      from sanitation_plans p left join disinfectants x on x.id = p.disinfectant_id where p.organization_id = $1 and p.site_id = $2 and p.status = 'active' order by p.next_due, p.area`, [orgId, sid])).rows
      .map((p) => ({ ...p, kind_label: PLAN_KIND[p.kind], range: p.disinfectant_id ? range(p) : null, state: p.next_due < today ? 'overdue' : p.next_due === today ? 'today' : 'later' }));
    const records = (await tx.query(`select r.id, r.plan_id, p.area, p.work, p.kind, r.done_at, u.full_name as done_by, r.done_by as done_by_id, r.concentration, r.concentration_ok, r.result, r.note,
        x.name as disinfectant, v.ok as verified_ok, v.note as verify_note, vu.full_name as verified_by, v.verified_at
      from sanitation_records r join sanitation_plans p on p.id = r.plan_id join users u on u.id = r.done_by left join disinfectants x on x.id = r.disinfectant_id
      left join sanitation_verifications v on v.record_id = r.id left join users vu on vu.id = v.verified_by
      where r.organization_id = $1 and r.site_id = $2 and r.done_at > now() - interval '7 days' order by r.done_at desc limit 300`, [orgId, sid])).rows
      .map((r) => ({ ...r, kind_label: PLAN_KIND[r.kind], concentration: r.concentration === null ? null : Number(r.concentration) }));
    const disinfectants = (await tx.query(`select x.id, x.name, x.purpose, x.concentration_min, x.concentration_max, x.exposure, x.basis, x.status, x.approved_at, u.full_name as approved_by
      from disinfectants x left join users u on u.id = x.approved_by where x.organization_id = $1 and x.status <> 'archived' order by x.status, x.name`, [orgId])).rows
      .map((x) => ({ ...x, range: range(x) }));
    return { today, plans, records, disinfectants };
  }, sid);
}

/* ───────────── Выполнение и проверка ───────────── */

const DoneInput = z.object({ concentration: pct.optional().nullable(), note: optText(500) });

export async function recordDone(userId: string, orgId: string, planId: string, input: unknown) {
  const d = parse(DoneInput, input ?? {});
  return inOrg(userId, orgId, 'sanitation.record', async (tx, m) => {
    const p = (await tx.query(`select p.*, p.next_due::text as next_due, x.name as disinfectant, x.concentration_min, x.concentration_max, x.status as dis_status from sanitation_plans p left join disinfectants x on x.id = p.disinfectant_id
      where p.id = $1 and p.organization_id = $2 and p.status = 'active' for update of p`, [planId, orgId])).rows[0];
    if (!p) throw Errors.notFound('Пункт плана не найден.');
    assertSiteAccess(m, p.site_id);
    if (p.disinfectant_id && p.dis_status !== 'approved') throw Errors.conflict(`Средство «${p.disinfectant}» больше не утверждено — обратитесь к ответственному за санитарию.`);
    if (p.check_concentration && d.concentration == null) throw Errors.validation(`Измерьте концентрацию рабочего раствора «${p.disinfectant}» и внесите (%).`);
    let ok: boolean | null = null;
    if (d.concentration != null && p.disinfectant_id) {
      ok = (p.concentration_min === null || d.concentration >= Number(p.concentration_min)) && (p.concentration_max === null || d.concentration <= Number(p.concentration_max));
    }
    const result = ok === false ? 'deviation' : 'done';
    let incidentId: string | null = null;
    if (result === 'deviation') {
      incidentId = (await raiseIncident(tx, { orgId, siteId: p.site_id, severity: 'medium', kind: 'sanitation', title: `Концентрация вне режима: ${p.disinfectant}`,
        what: `${p.area} — ${p.work}: ${fmtNum(d.concentration!)} % при режиме ${range(p)}.`, entityType: 'sanitation_plan', entityId: p.id, responsibleRole: 'haccp_lead', dueMinutes: 120,
        recommendedAction: 'Приготовить рабочий раствор заново по инструкции, проверить концентрацию и повторить обработку', createdBy: userId })).id;
    }
    const r = (await tx.query(`insert into sanitation_records (organization_id, site_id, plan_id, done_by, disinfectant_id, concentration, concentration_ok, result, note, incident_id)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`, [orgId, p.site_id, p.id, userId, p.disinfectant_id, d.concentration ?? null, ok, result, d.note, incidentId])).rows[0];
    let nextDue: string = p.next_due;
    if (result === 'done') {
      nextDue = addDays(await todayOf(tx, orgId), p.period_days);
      await tx.query(`update sanitation_plans set next_due = $2 where id = $1`, [p.id, nextDue]);
    }
    await audit.record(tx, { organizationId: orgId, siteId: p.site_id, actorUserId: userId, action: 'sanitation.done', entityType: 'sanitation_plan', entityId: p.id,
      after: { record: r.id, result, concentration: d.concentration ?? null } });
    return { id: r.id as string, result, incident_id: incidentId, next_due: nextDue };
  });
}

const VerifyInput = z.object({ ok: z.boolean(), note: optText(500) }).refine((x) => x.ok || (x.note && x.note.length >= 3), 'Укажите замечание: что не так.');

/** Проверка выполнения — другим сотрудником. «Не принято» — повторить сегодня. */
export async function verifyRecord(userId: string, orgId: string, recordId: string, input: unknown) {
  const d = parse(VerifyInput, input);
  return inOrg(userId, orgId, 'sanitation.verify', async (tx, m) => {
    const r = (await tx.query(`select r.*, p.area, p.work from sanitation_records r join sanitation_plans p on p.id = r.plan_id where r.id = $1 and r.organization_id = $2`, [recordId, orgId])).rows[0];
    if (!r) throw Errors.notFound('Запись не найдена.');
    assertSiteAccess(m, r.site_id);
    if (r.done_by === userId) throw Errors.conflict('Проверяет другой сотрудник — не тот, кто выполнял.');
    const ins = await tx.query(`insert into sanitation_verifications (record_id, organization_id, verified_by, ok, note) values ($1, $2, $3, $4, $5) on conflict do nothing`, [r.id, orgId, userId, d.ok, d.note]);
    if (!ins.rowCount) throw Errors.conflict('Запись уже проверена.');
    if (!d.ok) await tx.query(`update sanitation_plans set next_due = least(next_due, $2::date) where id = $1`, [r.plan_id, await todayOf(tx, orgId)]);
    await audit.record(tx, { organizationId: orgId, siteId: r.site_id, actorUserId: userId, action: 'sanitation.verify', entityType: 'sanitation_plan', entityId: r.plan_id,
      after: { record: r.id, ok: d.ok, note: d.note } });
    return { ok: true };
  });
}

