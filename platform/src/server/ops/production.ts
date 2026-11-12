import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText, assertSiteAccess, getSite, openTask, closeTasksFor, fmtNum, orgToday } from './common';
import { once, move } from './stock';
import { approvedRecipe, convertUnits } from './recipes';
import { explode, availability, USABLE, type Need } from './bom';
import { raiseIncident } from './incidents';
import { labelForLot } from './labels';
import { capaForIncident } from './capa';
import { assertInstrument } from './equipment';
import { roleHas } from '../access/roles';
import { requirementsFor, limitsText, KIND_LABEL, FORM_KIND, NEEDS_PROBE, monitoringByCode, type CheckKind, type Requirement } from './ccp';

/**
 * Производство полуфабрикатов (этап 10; перенос Production.gs / SemiFinished.gs прежнего ЦЕХ и MON CHEF 3.1–3.3).
 *  - Задание: план → в работе → выпущено (или отменено с причиной). Переходы только явные: списание один раз.
 *  - Выпуск (мастер-промт, раздел 2; ТЗ 3.0 §11.4): повар указывает фактически использованные партии и количества.
 *    В движения склада попадает только этот факт. Норма по утверждённой ТТК пересчитывается на фактический выход и
 *    хранится отдельно (consumption_estimates, «расчётное»); отклонение факта от нормы — по каждой позиции.
 *    Подсказка в форме (FEFO на плановый выход) — только предзаполнение; подтверждает человек.
 *    Выход приходуется партией: количество — фактическое, цена — стоимость фактически списанных партий / выход,
 *    срок — часы хранения из утверждённой ТТК; без них партия получает «срок не подтверждён» и задачу шефу.
 *  - Контроль при выпуске (ККТ, этап 1 доработки): какие замеры нужны — из этапов ТТК со ссылкой на ККТ плана ХАССП и
 *    утверждённых параметров выпуска (ccp.ts). Без замера выпуск закрыт; нет утверждённого предела — «не настроено», закрыт.
 *    Щуп — из реестра с действующей поверкой. Последний замер вне предела — партия выпускается в карантин, отклонение и CAPA,
 *    корректирующее действие плана показывается сразу. Замеры не меняются; исправление — новой записью с причиной.
 *  - Прослеживаемость: каждая израсходованная партия связана с партией п/ф (lot_links.kind = 'production').
 */

export const ORDER_STATUS: Record<string, string> = { planned: 'План', in_progress: 'В работе', done: 'Выпущено', cancelled: 'Отменено' };
const qtyKg = z.union([z.number(), z.string().trim().regex(/^\d+([.,]\d+)?$/, 'Введите число.').transform((s) => Number(s.replace(',', '.')))])
  .refine((v) => Number.isFinite(v) && v > 0 && v <= 10000, 'Количество — больше нуля, в килограммах.');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД.');

async function orderFor(tx: Tx, orgId: string, id: string, lock = false) {
  const o = (await tx.query(`select o.*, d.name as dish_name, d.kind as dish_kind, d.product_id from production_orders o join dishes d on d.id = o.dish_id
    where o.id = $1 and o.organization_id = $2 ${lock ? 'for update of o' : ''}`, [id, orgId])).rows[0];
  if (!o) throw Errors.notFound('Задание не найдено.');
  return o;
}

async function activeChecks(tx: Tx, dishId: string, statuses = ['active']) {
  return (await tx.query(`select r.*, a.full_name as approved_by_name from release_checks r left join users a on a.id = r.approved_by
    where r.dish_id = $1 and r.status = any($2::text[]) order by r.created_at`, [dishId, statuses])).rows;
}

/** Действующие (не исправленные) замеры задания. */
const LIVE = `not exists (select 1 from production_checks x where x.corrects_id = c.id)`;

/** Последний итоговый замер по каждому параметру выпуска (одиночный или конец охлаждения). */
async function lastChecks(tx: Tx, orderId: string) {
  return (await tx.query(`select distinct on (c.check_id) c.id, c.check_id, c.value, c.value_before, c.ok, c.phase, c.measured_at, c.recorded_at, c.duration_min, c.instrument, c.incident_id,
      s.value as start_value, s.measured_at as start_at, u.full_name as recorded_by
    from production_checks c join users u on u.id = c.recorded_by left join production_checks s on s.id = c.start_id
    where c.order_id = $1 and c.phase in ('single', 'end') and ${LIVE} order by c.check_id, c.measured_at desc, c.recorded_at desc`, [orderId])).rows;
}

/** Начатое и не законченное охлаждение (последнее начало без конца). */
async function openStarts(tx: Tx, orderId: string) {
  return (await tx.query(`select distinct on (c.check_id) c.id, c.check_id, c.value, c.measured_at, c.instrument from production_checks c
    where c.order_id = $1 and c.phase = 'start' and ${LIVE} and not exists (select 1 from production_checks e where e.phase = 'end' and (e.start_id = c.id or e.start_id = c.corrects_id))
    order by c.check_id, c.measured_at desc`, [orderId])).rows;
}

const limits = limitsText;

function withLast(reqs: Requirement[], last: Record<string, any>[], starts: Record<string, any>[]) {
  return reqs.map((r) => ({ ...r, limits: r.check ? limits(r.check) : null, corrective_action: r.monitoring?.corrective_action || null, record_form: r.monitoring?.record_form || null,
    last: r.check ? last.find((x) => x.check_id === r.check!.id) || null : null, open_start: r.check ? starts.find((x) => x.check_id === r.check!.id) || null : null }));
}

/* ───────────── Задания ───────────── */

export async function listProduction(userId: string, orgId: string, siteId: string, date?: string | null) {
  const d = parse(z.object({ siteId: z.uuid({ message: 'Выберите площадку.' }), date: day.optional().nullable() }), { siteId, date });
  return inOrg(userId, orgId, 'production.read', async (tx) => (await tx.query(`
    select o.id, o.status, o.planned_g, o.actual_g, o.planned_for, o.note, o.created_at, o.started_at, o.completed_at, o.output_lot_id, o.cost,
      d.name as dish_name, v.version as ttk_version, cu.full_name as created_by_name, su.full_name as started_by_name
    from production_orders o join dishes d on d.id = o.dish_id join ttk_versions v on v.id = o.ttk_version_id
    join users cu on cu.id = o.created_by left join users su on su.id = o.started_by
    where o.organization_id = $1 and o.site_id = $2
      and (o.planned_for = coalesce($3::date, org_today($1)) or (o.status in ('planned', 'in_progress') and o.planned_for < coalesce($3::date, org_today($1))))
    order by case o.status when 'in_progress' then 0 when 'planned' then 1 when 'done' then 2 else 3 end, o.planned_for, o.created_at`,
  [orgId, d.siteId, d.date || null])).rows.map((r) => ({ ...r, status_label: ORDER_STATUS[r.status] })), d.siteId);
}

/** Полуфабрикаты и блюда с утверждённой ТТК — то, что можно выпускать партией (блюдо — фасованная готовая продукция). */
export async function producibleDishes(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'production.read', async (tx) => (await tx.query(`
    select d.id, d.name, d.kind, v.version, v.yield_g, v.shelf_life_hours from dishes d join ttk_versions v on v.dish_id = d.id and v.status = 'approved'
    where d.organization_id = $1 and d.status = 'active' and d.kind in ('semi', 'dish') order by d.kind desc, d.name`, [orgId])).rows);
}

const CreateInput = z.object({ siteId: z.uuid(), dishId: z.uuid(), plannedKg: qtyKg, plannedFor: day, note: optText(500), planEventId: z.uuid().optional().nullable() });

export async function createProduction(userId: string, orgId: string, input: unknown) {
  const d = parse(CreateInput, input);
  return inOrg(userId, orgId, 'production.plan', async (tx) => {
    await getSite(tx, orgId, d.siteId);
    const dish = (await tx.query(`select id, name, kind from dishes where id = $1 and organization_id = $2 and status = 'active'`, [d.dishId, orgId])).rows[0];
    if (!dish) throw Errors.notFound('Полуфабрикат или блюдо не найдены.');
    // готовое блюдо — партией (фасованная продукция, выпуск под реализацию); продажа такой партии списывает её, а не сырьё
    const r = await approvedRecipe(tx, orgId, dish.id);
    if (!r) throw Errors.conflict(`У «${dish.name}» нет утверждённой ТТК — ставить в производство нельзя.`);
    if (!r.version.yield_g) throw Errors.conflict('В утверждённой ТТК не указан выход.');
    if (d.planEventId && !(await tx.query(`select 1 from plan_events where id = $1 and organization_id = $2 and site_id = $3 and status in ('planned', 'confirmed')`, [d.planEventId, orgId, d.siteId])).rowCount)
      throw Errors.conflict('Мероприятие не найдено на этой площадке или уже проведено.');
    const o = (await tx.query(`insert into production_orders (organization_id, site_id, dish_id, ttk_version_id, planned_g, planned_for, note, created_by, plan_event_id)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`, [orgId, d.siteId, dish.id, r.version.id, d.plannedKg * 1000, d.plannedFor, d.note, userId, d.planEventId || null])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: 'production.create', entityType: 'production_order', entityId: o.id,
      after: { dish: dish.name, planned_g: o.planned_g, planned_for: d.plannedFor, ttk_version: r.version.version } });
    return o;
  }, d.siteId);
}

/** Карточка задания: ТТК, потребность и остатки (до выпуска), замеры, выпущенная партия и расход (после). */
export async function getProduction(userId: string, orgId: string, id: string) {
  return inOrg(userId, orgId, 'production.read', async (tx, m) => {
    const o = await orderFor(tx, orgId, id);
    assertSiteAccess(m, o.site_id);
    const v = (await tx.query(`select version, yield_g, shelf_life_hours, sale_hours, opened_hours, shelf_basis, storage_conditions from ttk_versions where id = $1`, [o.ttk_version_id])).rows[0];
    const reqs = withLast(await requirementsFor(tx, orgId, o), await lastChecks(tx, o.id), await openStarts(tx, o.id));
    let need: Awaited<ReturnType<typeof availability>> | null = null, needError: string | null = null;
    let lots: { product_id: string; lot_id: string; lot_no: string | null; quantity: number; unit: string; expires_at: string; suggest: number }[] = [];
    if (['planned', 'in_progress'].includes(o.status)) {
      try {
        const needs = (await explode(tx, orgId, o.dish_id, { grams: Number(o.planned_g) }, { siteId: o.site_id })).needs;
        need = await availability(tx, orgId, o.site_id, needs);
        // подсказка для формы выпуска: годные партии по FEFO и сколько из каждой взять на плановый выход (факт вводит повар)
        for (const nd of needs.values()) {
          let left = nd.qty;
          for (const l of (await tx.query(`select l.id, l.lot_no, l.quantity::float8 as quantity, l.unit, l.expires_at from lots l where l.organization_id = $1 and l.site_id = $2 and l.product_id = $3 and ${USABLE}
              order by l.expires_at, l.received_at`, [orgId, o.site_id, nd.productId])).rows) {
            const take = Math.max(0, Math.min(l.quantity, left)); left -= take;
            lots.push({ product_id: nd.productId, lot_id: l.id, lot_no: l.lot_no, quantity: l.quantity, unit: l.unit, expires_at: l.expires_at, suggest: Math.round(take * 1000) / 1000 });
          }
        }
      } catch (e) { needError = (e as Error).message; lots = []; }
    }
    const consumed = o.status === 'done' ? (await tx.query(`select m.lot_id, m.quantity, m.unit, p.name as product, l.lot_no from stock_movements m join products p on p.id = m.product_id join lots l on l.id = m.lot_id
      where m.ref_type = 'production' and m.ref_id = $1 and m.kind = 'consume' order by p.name`, [o.id])).rows : [];
    const lot = o.output_lot_id ? (await tx.query(`select id, lot_no, quantity, unit, expires_at, expiry_basis, status, status_reason from lots where id = $1`, [o.output_lot_id])).rows[0] : null;
    const orgRef = organolepticRef((await tx.query(`select organoleptic from ttk_versions where id = $1`, [o.ttk_version_id])).rows[0]?.organoleptic);
    const assessor = o.assessed_by ? (await tx.query(`select full_name from users where id = $1`, [o.assessed_by])).rows[0]?.full_name : null;
    const brakerage = o.dish_kind !== 'dish' ? null : { reference: o.organoleptic_ref || orgRef, decision: o.release_decision, organoleptic: o.organoleptic, reject_reason: o.reject_reason,
      assessed_at: o.assessed_at, assessed_by_name: assessor, can_decide: roleHas(m.role, 'brakerage.decide') };
    const label = lot ? (await tx.query(`select id, code from labels where lot_id = $1 order by created_at desc limit 1`, [lot.id])).rows[0] || null : null;
    const users = (await tx.query(`select id, full_name from users where id = any($1::uuid[])`, [[o.created_by, o.started_by, o.completed_by].filter(Boolean)])).rows;
    const name = (uid: string | null) => users.find((u) => u.id === uid)?.full_name || null;
    return {
      order: { ...o, status_label: ORDER_STATUS[o.status], created_by_name: name(o.created_by), started_by_name: name(o.started_by), completed_by_name: name(o.completed_by) },
      ttk: v, checks: reqs, ccp_blocked: reqs.filter((r) => r.state === 'not_configured').map((r) => `${r.kind_label} (${r.source}): ${r.reason}`),
      need, need_error: needError, lots, consumed, lot, label, deviation: o.consumption_deviation || null, brakerage, sample_offer: await sampleOffer(tx, o, o.output_lot_id),
    };
  });
}

export async function startProduction(userId: string, orgId: string, id: string) {
  return inOrg(userId, orgId, 'production.run', async (tx, m) => {
    const o = await orderFor(tx, orgId, id, true);
    assertSiteAccess(m, o.site_id);
    if (o.status !== 'planned') throw Errors.conflict(`Задание уже ${ORDER_STATUS[o.status].toLowerCase()}.`);
    await tx.query(`update production_orders set status = 'in_progress', started_by = $2, started_at = now() where id = $1`, [id, userId]);
    await audit.record(tx, { organizationId: orgId, siteId: o.site_id, actorUserId: userId, action: 'production.start', entityType: 'production_order', entityId: id });
    return { status: 'in_progress' };
  });
}

const CheckInput = z.object({
  checkId: z.uuid(),
  value: z.coerce.number({ message: 'Введите значение.' }).refine(Number.isFinite, 'Введите значение.'),
  phase: z.enum(['single', 'start', 'end']).optional(),
  valueBefore: z.coerce.number().refine(Number.isFinite).nullable().optional(),
  durationMin: z.coerce.number().min(0).max(24 * 60).nullable().optional(),
  measuredAt: z.iso.datetime({ offset: true }).nullable().optional(),
  instrumentId: z.uuid().nullable().optional(),
});

/** Оценка замера по утверждённому пределу. Охлаждение: конец — в пределах и не дольше допустимого от начала. */
function evaluate(c: Record<string, any>, phase: string, value: number, minutes: number | null) {
  if (phase === 'start') return c.start_min === null || value >= Number(c.start_min);
  const inRange = (c.min_value === null || value >= Number(c.min_value)) && (c.max_value === null || value <= Number(c.max_value));
  return phase === 'end' ? inRange && (c.max_minutes === null || (minutes !== null && minutes <= Number(c.max_minutes))) : inRange;
}

async function deviationIncident(tx: Tx, orgId: string, userId: string, o: Record<string, any>, c: Record<string, any>, text: string) {
  const m = c.ccp_code ? (await monitoringByCode(tx, orgId, [c.ccp_code])).get(c.ccp_code) : null;
  const action = m?.corrective_action || 'Продолжить обработку до достижения предела и повторить замер. Если предел недостижим — партию не выпускать, решение ответственного.';
  const inc = await raiseIncident(tx, { orgId, siteId: o.site_id, severity: 'high', kind: 'release_check', title: `Вне предела при выпуске: ${o.dish_name}`,
    what: `${text} Последний замер вне предела — партия выпускается только в карантин.`, entityType: 'production_order', entityId: o.id,
    responsibleRole: 'haccp_lead', dueMinutes: 30, ruleSource: [m ? `План ХАССП v${m.plan_version}, ${c.ccp_code}` : '', c.basis].filter(Boolean).join('; '),
    recommendedAction: action, createdBy: userId, notify: ['haccp_lead', 'chef'] });
  return { id: inc.id, action };
}

/**
 * Замер при выпуске. Время замера — отдельно от времени внесения (не в будущем, не раньше старта задания).
 * Вне предела — отклонение и корректирующее действие из плана ХАССП в ответе; выпуск после этого — только в карантин.
 */
export async function recordCheck(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(CheckInput, input);
  return inOrg(userId, orgId, 'production.run', async (tx, m) => {
    const o = await orderFor(tx, orgId, id);
    assertSiteAccess(m, o.site_id);
    if (o.status !== 'in_progress') throw Errors.conflict('Замеры при выпуске вносятся по заданию «в работе».');
    const c = (await tx.query(`select * from release_checks where id = $1 and dish_id = $2 and status = 'active'`, [d.checkId, o.dish_id])).rows[0];
    if (!c) throw Errors.notFound('Параметр контроля не найден или не утверждён.');
    const kind = c.kind as CheckKind;
    const phase = kind === 'cooling' ? d.phase : 'single';
    if (kind === 'cooling' && (phase !== 'start' && phase !== 'end')) throw Errors.validation('Охлаждение — два замера: укажите «начало» или «конец».');
    if (kind !== 'cooling' && d.phase && d.phase !== 'single') throw Errors.validation('Начало и конец — только для охлаждения.');
    const at = d.measuredAt ? new Date(d.measuredAt) : new Date();
    if (at.getTime() > Date.now() + 2 * 60e3) throw Errors.validation('Время замера не может быть в будущем.');
    if (o.started_at && at.getTime() < new Date(o.started_at).getTime() - 60e3) throw Errors.validation('Время замера раньше начала задания.');
    if (NEEDS_PROBE.has(kind) && !d.instrumentId) throw Errors.validation('Выберите щуп из реестра оборудования — замер ККТ принимается только прибором с действующей поверкой.');
    const instrument = await assertInstrument(tx, orgId, o.site_id, d.instrumentId);
    let start: Record<string, any> | null = null, minutes: number | null = d.durationMin ?? null;
    if (phase === 'end') {
      start = (await openStarts(tx, o.id)).find((x) => x.check_id === c.id) || null;
      if (!start) throw Errors.conflict('Сначала запишите начало охлаждения: температуру и время.');
      if (at.getTime() < new Date(start.measured_at).getTime()) throw Errors.validation('Конец охлаждения раньше начала.');
      minutes = Math.round((at.getTime() - new Date(start.measured_at).getTime()) / 6e3) / 10;
    }
    const ok = evaluate(c, phase!, d.value, minutes);
    let incident: { id: string; action: string } | null = null;
    if (!ok) {
      const what = phase === 'end' ? `${c.name}: конец ${fmtNum(d.value)} ${c.unit} через ${fmtNum(minutes!)} мин (начало ${fmtNum(start!.value)} ${c.unit}) при пределе ${limits(c)}.`
        : phase === 'start' ? `${c.name}: в начале охлаждения ${fmtNum(d.value)} ${c.unit} при пределе ${limits(c)}.`
        : `${c.name}: ${fmtNum(d.value)} ${c.unit} при пределе ${limits(c)}.`;
      incident = await deviationIncident(tx, orgId, userId, o, c, what);
    }
    const row = (await tx.query(`insert into production_checks (organization_id, order_id, check_id, value, ok, incident_id, recorded_by, phase, measured_at, value_before, duration_min, start_id, instrument_id, instrument)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id, recorded_at, measured_at`,
      [orgId, o.id, c.id, d.value, ok, incident?.id || null, userId, phase, at, d.valueBefore ?? null, minutes, start?.id || null, d.instrumentId || null, instrument])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: o.site_id, actorUserId: userId, action: 'production.check', entityType: 'production_order', entityId: o.id,
      after: { check: c.name, kind, phase, value: d.value, value_before: d.valueBefore ?? null, minutes, ok, instrument, measured_at: at.toISOString() } });
    return { id: row.id, ok, phase, minutes, incident_id: incident?.id || null, limits: limits(c), corrective_action: incident?.action || null };
  });
}

const CorrectInput = z.object({
  value: z.coerce.number({ message: 'Введите значение.' }).refine(Number.isFinite, 'Введите значение.'),
  valueBefore: z.coerce.number().refine(Number.isFinite).nullable().optional(),
  reason: z.string().trim().min(10, 'Укажите причину исправления: что было записано неверно и откуда верное значение.').max(500),
});

/**
 * Исправление замера (единственная «ручная запись» в J22–J24): новая запись со ссылкой на исправляемую и причиной.
 * Исходная остаётся в истории. Исправленное значение вне предела по выпущенной партии — партия в карантин и отклонение;
 * исправление в предел партию из карантина не выводит — это решение ответственного.
 */
export async function correctCheck(userId: string, orgId: string, checkRowId: string, input: unknown) {
  const d = parse(CorrectInput, input);
  return inOrg(userId, orgId, 'haccp.manage', async (tx, m) => {
    const x = (await tx.query(`select c.*, r.kind, r.name, r.unit, r.min_value, r.max_value, r.max_minutes, r.start_min, r.ccp_code, r.basis from production_checks c
      join release_checks r on r.id = c.check_id where c.id = $1 and c.organization_id = $2`, [parse(z.uuid(), checkRowId), orgId])).rows[0];
    if (!x) throw Errors.notFound('Замер не найден.');
    if ((await tx.query(`select 1 from production_checks where corrects_id = $1`, [x.id])).rowCount) throw Errors.conflict('Замер уже исправлен — исправляйте последнюю запись.');
    const o = await orderFor(tx, orgId, x.order_id, true);
    assertSiteAccess(m, o.site_id);
    const minutes = x.duration_min === null ? null : Number(x.duration_min);
    const ok = evaluate(x, x.phase, d.value, minutes);
    let incident: { id: string; action: string } | null = null;
    if (!ok) incident = await deviationIncident(tx, orgId, userId, o, x, `${x.name}: исправлено ${fmtNum(x.value)} → ${fmtNum(d.value)} ${x.unit} при пределе ${limits(x)} (${d.reason}).`);
    const row = (await tx.query(`insert into production_checks (organization_id, order_id, check_id, value, ok, incident_id, recorded_by, phase, measured_at, value_before, duration_min, start_id,
        instrument_id, instrument, corrects_id, correction_reason)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) returning id`,
      [orgId, o.id, x.check_id, d.value, ok, incident?.id || null, userId, x.phase, x.measured_at, d.valueBefore === undefined ? x.value_before : d.valueBefore, x.duration_min, x.start_id,
        x.instrument_id, x.instrument, x.id, d.reason])).rows[0];
    // время замера и длительность не исправляются: исправляется значение (время — факт события)
    let quarantined = false;
    if (!ok && o.status === 'done' && o.output_lot_id) {
      const l = (await tx.query(`update lots set status = 'quarantine', status_reason = $2 where id = $1 and status = 'available' returning id`,
        [o.output_lot_id, `ККТ: исправленный замер вне предела — ${x.name}`])).rows[0];
      quarantined = !!l;
      if (incident) await capaForIncident(tx, orgId, incident.id, userId);
    }
    await audit.record(tx, { organizationId: orgId, siteId: o.site_id, actorUserId: userId, action: 'production.check_correct', entityType: 'production_order', entityId: o.id,
      before: { check_row: x.id, value: Number(x.value), ok: x.ok }, after: { check_row: row.id, value: d.value, ok, lot_quarantined: quarantined }, reason: d.reason });
    return { id: row.id, ok, incident_id: incident?.id || null, corrective_action: incident?.action || null, lot_quarantined: quarantined };
  });
}

const lotQty = z.union([z.number(), z.string().trim().regex(/^\d+([.,]\d+)?$/, 'Введите число.').transform((s) => Number(s.replace(',', '.')))])
  .refine((v) => Number.isFinite(v) && v > 0, 'Количество — больше нуля.');
const CompleteInput = z.object({ actualKg: qtyKg, operationId: z.string().trim().min(8).max(100),
  consumed: z.array(z.object({ lotId: z.uuid(), quantity: lotQty }), 'Укажите фактически использованные партии.')
    .min(1, 'Укажите фактически использованные партии и количества — расход по норме ТТК фактом не записывается.').max(200),
  // бракераж готовой продукции (J58): решение — только с правом бракеража; без решения партия ждёт бракеража на удержании
  organoleptic: z.string().trim().max(1000).optional().nullable(), decision: z.enum(['allowed', 'rejected']).optional().nullable() });

const BrakerageInput = z.object({
  decision: z.enum(['allowed', 'rejected'], 'Выберите: соответствует или не соответствует.'),
  organoleptic: z.string().trim().max(1000).optional().nullable().transform((v) => v || null),
});

const ORG_LABEL: Record<string, string> = { appearance: 'внешний вид', color: 'цвет', consistency: 'консистенция', taste: 'вкус и запах' };
/** Эталон органолептики из утверждённой ТТК: только заполненные показатели. */
export function organolepticRef(o: Record<string, string | null> | null | undefined) {
  const src = (o || {}) as Record<string, string | null>;
  return Object.keys(ORG_LABEL).filter((k) => src[k] && String(src[k]).trim()).map((k) => ({ key: k, label: ORG_LABEL[k], text: String(src[k]).trim() }));
}

/**
 * Решение бракеража по выпуску блюда. «Соответствует» — по эталону ТТК (если его нет — нужно описание органолептики);
 * «не соответствует» — с причиной: партия остаётся на удержании, отклонение ответственному. Разрешение к реализации снимает
 * удержание бракеража, но не карантин по ККТ.
 */
async function applyBrakerage(tx: Tx, orgId: string, userId: string, o: Record<string, any>, lotId: string, b: { decision: 'allowed' | 'rejected'; organoleptic: string | null }, ref: unknown[]) {
  if (b.decision === 'rejected' && (!b.organoleptic || b.organoleptic.length < 5)) throw Errors.validation('«Не соответствует» — укажите причину: что именно не соответствует эталону ТТК.');
  if (b.decision === 'allowed' && !ref.length && (!b.organoleptic || b.organoleptic.length < 5))
    throw Errors.validation('В ТТК нет эталона органолептики — опишите внешний вид, цвет, консистенцию, вкус и запах.');
  const ccp = (await tx.query(`select count(*)::int as n from production_checks c where c.order_id = $1 and c.phase <> 'start' and not c.ok
      and not exists (select 1 from production_checks x where x.corrects_id = c.id)
      and c.recorded_at = (select max(y.recorded_at) from production_checks y where y.order_id = c.order_id and y.check_id = c.check_id and y.phase <> 'start'
        and not exists (select 1 from production_checks z where z.corrects_id = y.id))`, [o.id])).rows[0].n > 0;
  let incidentId: string | null = null;
  if (b.decision === 'rejected') {
    incidentId = (await raiseIncident(tx, { orgId, siteId: o.site_id, severity: 'high', kind: 'brakerage', title: `Бракераж: не соответствует — ${o.dish_name}`,
      what: `Партия не допущена к реализации: ${b.organoleptic}.`, entityType: 'production_order', entityId: o.id, responsibleRole: 'haccp_lead', dueMinutes: 60,
      ruleSource: 'Бракераж по эталону утверждённой ТТК', recommendedAction: 'Партию не реализовывать; решение о переработке или утилизации — ответственный, с основанием.',
      createdBy: userId, notify: ['haccp_lead', 'chef'] })).id;
    await tx.query(`update lots set status = 'quarantine', status_reason = $2 where id = $1 and status in ('available', 'quarantine')`, [lotId, `бракераж: не соответствует — ${b.organoleptic}`]);
  } else if (!ccp) {
    await tx.query(`update lots set status = 'available', status_reason = 'бракераж: допущено к реализации' where id = $1 and status = 'quarantine' and status_reason = 'ожидает бракеража'`, [lotId]);
  }
  await tx.query(`update production_orders set organoleptic = $2, release_decision = $3, assessed_by = $4, assessed_at = now(), reject_reason = $5, organoleptic_ref = $6 where id = $1`,
    [o.id, b.organoleptic || (b.decision === 'allowed' ? 'соответствует эталону ТТК' : null), b.decision, userId, b.decision === 'rejected' ? b.organoleptic : null, JSON.stringify(ref)]);
  await closeTasksFor(tx, orgId, 'brakerage', o.id, userId, b.decision === 'allowed' ? 'допущено к реализации' : 'не допущено');
  await audit.record(tx, { organizationId: orgId, siteId: o.site_id, actorUserId: userId, action: 'production.brakerage', entityType: 'production_order', entityId: o.id,
    after: { decision: b.decision, organoleptic: b.organoleptic, lot: lotId, ccp_quarantine: ccp, incident: incidentId } });
  return { decision: b.decision, incident_id: incidentId, lot_status: b.decision === 'rejected' || ccp ? 'quarantine' : 'available', ccp_quarantine: ccp };
}

/** Предложение суточной пробы после выпуска: блюдо мероприятия или блюдо с отметкой «проба при выпуске» в настройках проб. */
async function sampleOffer(tx: Tx, o: Record<string, any>, lotId: string | null) {
  if (!lotId) return null;
  const dish = (await tx.query(`select sample_on_release from dishes where id = $1`, [o.dish_id])).rows[0];
  const ev = o.plan_event_id ? (await tx.query(`select id, number, title from plan_events where id = $1`, [o.plan_event_id])).rows[0] : null;
  if (!ev && !dish?.sample_on_release) return null;
  const taken = (await tx.query(`select id, taken_at from daily_samples where lot_id = $1 or (plan_event_id = $2 and dish_id = $3) limit 1`, [lotId, ev?.id || null, o.dish_id])).rows[0] || null;
  return { reason: ev ? `мероприятие № ${ev.number} «${ev.title}»` : 'для блюда указано в настройках проб', source: ev ? 'event' : 'lot', event_id: ev?.id || null, dish_id: o.dish_id, lot_id: lotId, taken };
}

/** Бракераж выпущенной партии блюда (если при выпуске решения не было). */
export async function decideBrakerage(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(BrakerageInput, input);
  return inOrg(userId, orgId, 'brakerage.decide', async (tx, m) => {
    const o = await orderFor(tx, orgId, id, true);
    assertSiteAccess(m, o.site_id);
    if (o.dish_kind !== 'dish') throw Errors.validation('Бракераж проводится по готовой продукции.');
    if (o.status !== 'done' || !o.output_lot_id) throw Errors.conflict('Бракераж — по выпущенной партии.');
    if (o.release_decision) throw Errors.conflict('Решение бракеража уже принято — оно не меняется.');
    const v = (await tx.query(`select organoleptic from ttk_versions where id = $1`, [o.ttk_version_id])).rows[0];
    return applyBrakerage(tx, orgId, userId, o, o.output_lot_id, d, organolepticRef(v.organoleptic));
  });
}

/** Выпуск партии: фактический расход по партиям, норма ТТК отдельно, партия с себестоимостью и сроком из ТТК, этикетка. */
/** Позиции, которые можно списать на задание: всё из раскладки утверждённой ТТК — сырьё и выпущенные п/ф. */
async function allowedProducts(tx: Tx, orgId: string, o: { dish_id: string; site_id: string; planned_g: string }, own: string | null) {
  const a = await explode(tx, orgId, o.dish_id, { grams: Number(o.planned_g) }, { siteId: o.site_id });
  const b = await explode(tx, orgId, o.dish_id, { grams: Number(o.planned_g) }, {});
  const set = new Set<string>([...a.needs.keys(), ...b.needs.keys()]);
  if (own) set.delete(own);
  return set;
}

/** Факт против нормы по позициям. Позиция п/ф, взятая готовой со склада, сравнивается не с сырьём, а показывается отдельно. */
function deviations(norm: Map<string, Need>, taken: { productId: string; qty: number; name: string; unit: string }[], allowed: Set<string>) {
  const fact = new Map<string, number>();
  for (const t of taken) fact.set(t.productId, (fact.get(t.productId) || 0) + t.qty);
  const out: { product_id: string; name: string; unit: string; norm: number | null; fact: number; diff: number | null; diff_pct: number | null }[] = [];
  const r = (x: number) => Math.round(x * 1000) / 1000;
  for (const n of norm.values()) {
    const f = fact.get(n.productId) || 0;
    out.push({ product_id: n.productId, name: n.name, unit: n.unit, norm: r(n.qty), fact: r(f), diff: r(f - n.qty), diff_pct: n.qty > 0 ? Math.round(((f - n.qty) / n.qty) * 1000) / 10 : null });
  }
  for (const [pid, f] of fact) if (!norm.has(pid) && allowed.has(pid)) { const t = taken.find((x) => x.productId === pid)!; out.push({ product_id: pid, name: `${t.name} (готовый п/ф со склада)`, unit: t.unit, norm: null, fact: r(f), diff: null, diff_pct: null }); }
  return out;
}

export async function completeProduction(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(CompleteInput, input);
  return inOrg(userId, orgId, 'production.run', async (tx, m) => once(tx, orgId, d.operationId, 'production_complete', userId, async () => {
    const o = await orderFor(tx, orgId, id, true);
    assertSiteAccess(m, o.site_id);
    if (o.status !== 'in_progress') throw Errors.conflict(o.status === 'planned' ? 'Сначала «Начать»: выпуск — из задания в работе.' : `Задание уже ${ORDER_STATUS[o.status].toLowerCase()}.`);
    if (d.decision && o.dish_kind !== 'dish') throw Errors.validation('Бракераж — для готовой продукции.');
    if (d.decision && !roleHas(m.role, 'brakerage.decide'))
      throw Errors.forbidden('Бракераж проводит сотрудник с правом бракеража (шеф, ответственный ХАССП). Выпустите партию без решения — она будет ждать бракеража.');
    const reqs = withLast(await requirementsFor(tx, orgId, o), await lastChecks(tx, o.id), []);
    const unset = reqs.filter((r) => r.state === 'not_configured');
    if (unset.length) throw Errors.conflict(`Выпуск закрыт: контроль ККТ не настроено — ${unset.map((r) => `${r.kind_label}, ${r.source}: ${r.reason}`).join('; ')}.`);
    const missing = reqs.filter((r) => !r.last);
    if (missing.length) throw Errors.conflict(`Выпуск закрыт: нет замера — ${missing.map((r) => `${r.check!.name} (${r.limits})`).join('; ')}.`);
    const bad = reqs.filter((r) => !r.last!.ok);
    const v = (await tx.query(`select * from ttk_versions where id = $1`, [o.ttk_version_id])).rows[0];
    if (v.status !== 'approved') throw Errors.conflict('ТТК задания больше не действует (утверждена новая версия). Отмените задание и создайте новое.');

    // складская позиция п/ф (создаётся при первом выпуске)
    let productId: string = o.product_id;
    if (!productId) {
      productId = (await tx.query(`insert into products (organization_id, name, unit, category) values ($1, $2, 'кг', $3) returning id`, [orgId, o.dish_name, o.dish_kind === 'dish' ? 'Готовая продукция' : 'Полуфабрикат'])).rows[0].id;
      await tx.query(`update dishes set product_id = $2 where id = $1`, [o.dish_id, productId]);
      // срок после вскрытия из утверждённой ТТК — правило новой складской позиции
      if (v.opened_hours) await tx.query(`update products set opened_shelf_hours = $2, opened_shelf_basis = $3 where id = $1`, [productId, v.opened_hours, `ТТК «${o.dish_name}» v${v.version}: ${v.shelf_basis}`]);
    }
    const unit = (await tx.query(`select unit from products where id = $1`, [productId])).rows[0].unit as string;
    const outQty = await convertUnits(tx, productId, d.actualKg, 'кг', unit);
    if (outQty === null) throw Errors.conflict(`Единица п/ф «${unit}» — нет пересчёта из кг.`);

    // фактический расход: только указанные партии этой площадки, годные, из позиций утверждённой ТТК (с п/ф)
    const allowed = await allowedProducts(tx, orgId, o, productId);
    const taken: { lotId: string; qty: number; unit: string; productId: string; name: string; lotNo: string | null; price: number | null }[] = [];
    const seen = new Set<string>();
    let cost: number | null = 0;
    for (const c of d.consumed) {
      if (seen.has(c.lotId)) throw Errors.validation('Партия указана дважды — объедините количество в одной строке.');
      seen.add(c.lotId);
      const l = (await tx.query(`select l.*, p.name as product from lots l join products p on p.id = l.product_id where l.id = $1 and l.organization_id = $2 for update of l`, [c.lotId, orgId])).rows[0];
      if (!l) throw Errors.notFound('Партия не найдена.');
      const label = `${l.product}${l.lot_no ? `, партия ${l.lot_no}` : ''}`;
      if (l.site_id !== o.site_id) throw Errors.conflict(`${label}: партия другой площадки.`);
      if (!allowed.has(l.product_id)) throw Errors.conflict(`${label}: позиции нет в утверждённой ТТК «${o.dish_name}» — замена сырья оформляется новой версией ТТК.`);
      const usable = (await tx.query(`select 1 from lots l where l.id = $1 and ${USABLE}`, [l.id])).rowCount;
      if (!usable) throw Errors.conflict(`${label}: партию использовать нельзя (статус, срок или срок не подтверждён).`);
      if (c.quantity > Number(l.quantity) + 1e-9) throw Errors.conflict(`${label}: в партии ${fmtNum(l.quantity)} ${l.unit}, указано ${fmtNum(c.quantity)}.`);
      await move(tx, { orgId, siteId: o.site_id, lotId: l.id, productId: l.product_id, kind: 'consume', quantity: -c.quantity, unit: l.unit,
        reason: `производство: ${o.dish_name} (факт)`, refType: 'production', refId: o.id, operationId: d.operationId, userId });
      cost = cost === null || l.unit_price === null ? null : cost + c.quantity * Number(l.unit_price);
      taken.push({ lotId: l.id, qty: c.quantity, unit: l.unit, productId: l.product_id, name: l.product, lotNo: l.lot_no, price: l.unit_price === null ? null : Number(l.unit_price) });
    }
    // норма по ТТК на фактический выход — расчёт, отдельно от факта
    const norm = (await explode(tx, orgId, o.dish_id, { grams: d.actualKg * 1000 }, {})).needs;
    norm.delete(productId);
    // каждая позиция ТТК должна быть в факте — или покрыта готовым п/ф со склада, в который она входит
    const factIds = new Set(taken.map((t) => t.productId));
    const covered = new Set<string>();
    for (const sd of (await tx.query(`select id from dishes where organization_id = $1 and product_id = any($2::uuid[])`, [orgId, [...factIds]])).rows) {
      for (const k of (await explode(tx, orgId, sd.id, { grams: 1000 }, {})).needs.keys()) covered.add(k);
    }
    const absent = [...norm.values()].filter((n) => n.qty > 0 && !factIds.has(n.productId) && !covered.has(n.productId));
    if (absent.length) throw Errors.conflict(`Не указан фактический расход: ${absent.map((n) => `${n.name} (по ТТК ${fmtNum(Math.round(n.qty * 1000) / 1000)} ${n.unit})`).join(', ')}. `
      + 'Без позиции ТТК продукция не соответствует утверждённой карте — выпуск не оформляется; при замене сырья нужна новая версия ТТК.');
    const deviation = deviations(norm, taken, allowed);
    for (const n of norm.values()) {
      await tx.query(`insert into consumption_estimates (organization_id, site_id, kind, ref_type, ref_id, product_id, quantity, unit, ttk_version_id, basis, created_by)
        values ($1, $2, 'production_norm', 'production', $3, $4, $5, $6, $7, $8, $9)`,
      [orgId, o.site_id, o.id, n.productId, Math.round(n.qty * 1e6) / 1e6, n.unit, v.id, `ТТК «${o.dish_name}» v${v.version} на ${fmtNum(d.actualKg)} кг выхода`, userId]);
    }

    const now = new Date();
    // ТЗ 5.2: партия п/ф — срок партии п/ф; готовая продукция — срок реализации (иначе срок партии); основание сроков — из ТТК
    const kindOf = o.dish_kind === 'dish' && v.sale_hours ? 'срок реализации' : 'срок партии';
    const hoursRaw = o.dish_kind === 'dish' ? (v.sale_hours ?? v.shelf_life_hours) : v.shelf_life_hours;
    const hours = hoursRaw ? Number(hoursRaw) : null;
    const expiresAt = hours ? new Date(now.getTime() + hours * 3600e3) : null;
    const basis = hours ? `ТТК «${o.dish_name}» v${v.version}: ${kindOf} ${fmtNum(hours)} ч${v.storage_conditions ? `, ${v.storage_conditions}` : ''}${v.shelf_basis ? ` (${v.shelf_basis})` : ''}` : null;
    const lotNo = `${o.dish_kind === 'dish' ? 'ГП' : 'ПФ'}-${now.toISOString().slice(2, 10).replace(/-/g, '')}-${o.id.slice(0, 4).toUpperCase()}`;
    const rejected = false;   // «не соответствует» оформляется ниже через applyBrakerage
    const pendingBrakerage = o.dish_kind === 'dish';      // до решения бракеража партия блюда на удержании
    const ccpBad = bad.length ? `ККТ: последний замер вне предела — ${bad.map((r) => `${r.check!.name} ${fmtNum(r.last!.value)} ${r.check!.unit} (${r.limits})`).join('; ')}` : null;
    const unitPrice = cost === null || outQty <= 0 ? null : Math.round((cost / outQty) * 100) / 100;
    const lot = (await tx.query(`insert into lots (organization_id, site_id, product_id, lot_no, quantity, unit, manufactured_at, expires_at, expiry_basis, status, status_reason, unit_price, storage_conditions)
      values ($1, $2, $3, $4, 0, $5, $6, $7, $8, $10, $11, $9, $12) returning id`,
      [orgId, o.site_id, productId, lotNo, unit, await orgToday(tx, orgId), expiresAt, basis, unitPrice, rejected || ccpBad || pendingBrakerage ? 'quarantine' : 'available',
        ccpBad ? ccpBad : pendingBrakerage ? 'ожидает бракеража' : o.dish_kind === 'dish' ? 'выпуск готовой продукции' : 'выпуск п/ф', v.storage_conditions || null])).rows[0];
    await move(tx, { orgId, siteId: o.site_id, lotId: lot.id, productId, kind: 'produce', quantity: outQty, unit, refType: 'production', refId: o.id, operationId: d.operationId, userId, reason: `выпуск: ${o.dish_name}` });
    for (const t of taken) {
      await tx.query(`insert into lot_links (organization_id, parent_lot_id, child_lot_id, kind, quantity, unit) values ($1, $2, $3, 'production', $4, $5)`, [orgId, t.lotId, lot.id, t.qty, t.unit]);
    }
    // снимок расчёта себестоимости партии (ТЗ 3.0 §13.5): метод, формула, входные партии и цены — не пересчитывается задним числом
    const costBasis = { method: 'fact-v1', formula: 'Σ (фактическое количество × цена партии сырья) ÷ фактический выход', currency: 'RUB', rounding: '0,01 ₽',
      inputs: taken.map((t) => ({ lot_id: t.lotId, lot_no: t.lotNo, product: t.name, quantity: t.qty, unit: t.unit, unit_price: t.price, amount: t.price === null ? null : Math.round(t.qty * t.price * 100) / 100 })),
      total: cost === null ? null : Math.round(cost * 100) / 100, output: outQty, output_unit: unit, unit_price: unitPrice,
      missing_prices: taken.filter((t) => t.price === null).map((t) => `${t.name}${t.lotNo ? ` ${t.lotNo}` : ''}`), calculated_at: now.toISOString() };
    await tx.query(`update lots set cost_basis = $2 where id = $1`, [lot.id, JSON.stringify(costBasis)]);
    if (!expiresAt) {
      await openTask(tx, { orgId, siteId: o.site_id, kind: 'confirm_expiry', title: `Срок не подтверждён: ${o.dish_name}`,
        details: `Партия ${lotNo}: в утверждённой ТТК не указан срок хранения в часах. Укажите срок и основание — до этого партию использовать нельзя.`,
        entityType: 'lot', entityId: lot.id, assigneeRole: 'chef', dueAt: new Date(now.getTime() + 2 * 3600e3), createdBy: userId });
    }
    const cRound = cost === null ? null : Math.round(cost * 100) / 100;
    await tx.query(`update production_orders set status = 'done', completed_by = $2, completed_at = now(), actual_g = $3, output_lot_id = $4, cost = $5,
      consumption_deviation = $6 where id = $1`,
      [o.id, userId, d.actualKg * 1000, lot.id, cRound, JSON.stringify(deviation)]);
    // бракераж: решение сразу (есть право) или задача шефу; эталон — органолептика утверждённой ТТК
    let brakerage: Awaited<ReturnType<typeof applyBrakerage>> | null = null;
    if (o.dish_kind === 'dish') {
      if (d.decision) brakerage = await applyBrakerage(tx, orgId, userId, { ...o, site_id: o.site_id }, lot.id, { decision: d.decision, organoleptic: d.organoleptic || null }, organolepticRef(v.organoleptic));
      else await openTask(tx, { orgId, siteId: o.site_id, kind: 'brakerage', title: `Бракераж: ${o.dish_name}, партия ${lotNo}`,
        details: 'Партия выпущена и ждёт бракеража: сверить органолептику с эталоном ТТК и решить о допуске к реализации.', entityType: 'production_order', entityId: o.id,
        assigneeRole: 'chef', dueAt: new Date(now.getTime() + 30 * 60e3), createdBy: userId });
    }
    // отклонение ККТ: партия в карантине, к отклонению — запись о партии и CAPA сразу (не дожидаясь закрытия)
    const capas: string[] = [];
    for (const r of bad) {
      if (!r.last!.incident_id) continue;
      await tx.query(`insert into incident_events (organization_id, incident_id, user_id, event, note) values ($1, $2, $3, 'lot', $4)`,
        [orgId, r.last!.incident_id, userId, `Партия ${lotNo} выпущена в карантин: ${r.check!.name} ${fmtNum(r.last!.value)} ${r.check!.unit}.`]);
      capas.push((await capaForIncident(tx, orgId, r.last!.incident_id, userId)).id);
    }
    const label = await labelForLot(tx, orgId, userId, lot.id);
    const yieldDiff = Math.round(((d.actualKg * 1000) / Number(o.planned_g) - 1) * 1000) / 10;
    await audit.record(tx, { organizationId: orgId, siteId: o.site_id, actorUserId: userId, action: 'production.complete', entityType: 'production_order', entityId: o.id,
      after: { lot: lot.id, lot_no: lotNo, actual_g: d.actualKg * 1000, planned_g: Number(o.planned_g), yield_diff_pct: yieldDiff, cost: cRound, consumed: taken.map((t) => ({ lot: t.lotId, qty: t.qty, unit: t.unit })), deviation, ccp_quarantine: ccpBad } });
    return { lot_id: lot.id, lot_no: lotNo, label_id: label.id, quantity: outQty, unit, cost: cRound, unit_price: unitPrice,
      expires_at: expiresAt?.toISOString() || null, expiry_basis: basis, yield_diff_pct: yieldDiff, consumed: taken.length, deviation,
      lot_status: brakerage ? brakerage.lot_status : ccpBad || pendingBrakerage ? 'quarantine' : 'available', ccp_deviation: ccpBad, capa_ids: capas,
      brakerage: o.dish_kind !== 'dish' ? null : brakerage ? brakerage.decision : 'pending', sample_offer: await sampleOffer(tx, o, lot.id),
      corrective_actions: bad.map((r) => r.corrective_action).filter(Boolean) };
  }));
}

export async function cancelProduction(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(z.object({ reason: z.string().trim().min(3, 'Укажите причину отмены.').max(300) }), input);
  return inOrg(userId, orgId, 'production.plan', async (tx, m) => {
    const o = await orderFor(tx, orgId, id, true);
    assertSiteAccess(m, o.site_id);
    if (!['planned', 'in_progress'].includes(o.status)) throw Errors.conflict(`Задание уже ${ORDER_STATUS[o.status].toLowerCase()} — отменить нельзя.`);
    await tx.query(`update production_orders set status = 'cancelled', cancel_reason = $2 where id = $1`, [id, d.reason]);
    await audit.record(tx, { organizationId: orgId, siteId: o.site_id, actorUserId: userId, action: 'production.cancel', entityType: 'production_order', entityId: id, reason: d.reason });
    return { status: 'cancelled' };
  });
}

/* ───────────── Контроль при выпуске (ККТ) ───────────── */

export async function listReleaseChecks(userId: string, orgId: string, dishId: string) {
  return inOrg(userId, orgId, 'menu.read', async (tx) => (await activeChecks(tx, dishId, ['active', 'draft'])).map((c) => ({ ...c, limits: limits(c), kind_label: KIND_LABEL[c.kind as CheckKind] })));
}

const num = z.union([z.number(), z.string().trim().regex(/^-?\d+([.,]\d+)?$/, 'Введите число.').transform((s) => Number(s.replace(',', '.')))]);
const ReleaseCheckInput = z.object({
  name: z.string().trim().min(3, 'Что измеряется, например «Температура в толще продукта».').max(200),
  unit: z.string().trim().min(1).max(20).default('°C'),
  min: num.nullable().optional(), max: num.nullable().optional(),
  basis: z.string().trim().min(5, 'Укажите основание: пункт плана ХАССП или норматива.').max(500),
  hazardId: z.uuid().nullable().optional(),
  ccpCode: z.string().trim().min(1).max(20).nullable().optional(),
  kind: z.enum(['core_temp', 'cooling', 'reheat', 'other']).optional(),
  maxMinutes: num.nullable().optional(), startMin: num.nullable().optional(),
}).refine((x) => x.min != null || x.max != null, 'Задайте нижний или верхний предел.')
  .refine((x) => x.min == null || x.max == null || x.min <= x.max, 'Нижний предел больше верхнего.')
  .refine((x) => x.maxMinutes == null || x.maxMinutes > 0, 'Длительность — больше нуля.');

/**
 * Проект предела замера при выпуске. Вид замера по ККТ берётся из формы мониторинга плана ХАССП (J22/J23/J24), не выбирается
 * произвольно. Действует после утверждения (approveReleaseCheck).
 */
export async function addReleaseCheck(userId: string, orgId: string, dishId: string, input: unknown) {
  const d = parse(ReleaseCheckInput, input);
  return inOrg(userId, orgId, 'haccp.manage', async (tx) => {
    const dish = (await tx.query(`select id, name, kind from dishes where id = $1 and organization_id = $2`, [dishId, orgId])).rows[0];
    if (!dish) throw Errors.notFound('Блюдо или полуфабрикат не найдено.');
    let kind: CheckKind = d.kind || 'other';
    if (d.ccpCode) {
      const mo = (await monitoringByCode(tx, orgId, [d.ccpCode])).get(d.ccpCode);
      if (!mo) throw Errors.validation(`${d.ccpCode}: нет такой ККТ/ОПП с мониторингом в утверждённом плане ХАССП.`);
      const fk = mo.record_form ? FORM_KIND[mo.record_form] : undefined;
      if (fk && d.kind && d.kind !== fk) throw Errors.validation(`Мониторинг ${d.ccpCode} ведётся по форме ${mo.record_form} — вид замера «${KIND_LABEL[fk]}».`);
      kind = fk || kind;
    }
    if (kind === 'cooling' && d.maxMinutes == null) throw Errors.validation('Для охлаждения укажите допустимую длительность от начала до конца, мин.');
    const c = (await tx.query(`insert into release_checks (organization_id, dish_id, name, unit, min_value, max_value, basis, hazard_id, created_by, kind, ccp_code, max_minutes, start_min, status)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'draft') returning *`,
      [orgId, dishId, d.name, d.unit, d.min ?? null, d.max ?? null, d.basis, d.hazardId || null, userId, kind, d.ccpCode || null, kind === 'cooling' ? d.maxMinutes : null, kind === 'cooling' ? d.startMin ?? null : null])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'release_check.add', entityType: 'dish', entityId: dishId,
      after: { name: d.name, kind, ccp: d.ccpCode || null, min: d.min, max: d.max, max_minutes: d.maxMinutes ?? null, basis: d.basis } });
    return { ...c, limits: limits(c) };
  });
}

/** Утверждение предела (право утверждения плана ХАССП). Прежний действующий предел той же ККТ уходит в архив. */
export async function approveReleaseCheck(userId: string, orgId: string, checkId: string) {
  return inOrg(userId, orgId, 'haccp.approve', async (tx) => {
    const c = (await tx.query(`select * from release_checks where id = $1 and organization_id = $2 for update`, [parse(z.uuid(), checkId), orgId])).rows[0];
    if (!c) throw Errors.notFound('Параметр не найден.');
    if (c.status !== 'draft') throw Errors.conflict('Утвердить можно только проект параметра.');
    const prev = c.ccp_code ? (await tx.query(`update release_checks set status = 'archived' where dish_id = $1 and ccp_code = $2 and status = 'active' returning id`, [c.dish_id, c.ccp_code])).rows : [];
    await tx.query(`update release_checks set status = 'active', approved_by = $2, approved_at = now() where id = $1`, [c.id, userId]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'release_check.approve', entityType: 'dish', entityId: c.dish_id,
      before: prev.length ? { replaced: prev.map((x) => x.id) } : undefined, after: { check: c.id, name: c.name, limits: limits(c) } });
    return { ok: true };
  });
}

export async function archiveReleaseCheck(userId: string, orgId: string, checkId: string, input: unknown) {
  const d = parse(z.object({ reason: z.string().trim().min(5, 'Укажите основание: например, изменение плана ХАССП.').max(300) }), input);
  return inOrg(userId, orgId, 'haccp.manage', async (tx) => {
    const c = (await tx.query(`update release_checks set status = 'archived' where id = $1 and organization_id = $2 and status in ('active', 'draft') returning dish_id, name`, [checkId, orgId])).rows[0];
    if (!c) throw Errors.notFound('Параметр не найден.');
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'release_check.archive', entityType: 'dish', entityId: c.dish_id, after: { name: c.name }, reason: d.reason });
    return { ok: true };
  });
}

/** Настройки проб: отбирать суточную пробу при каждом выпуске этого блюда (кроме мероприятий — там всегда). */
export async function setSampleOnRelease(userId: string, orgId: string, dishId: string, input: unknown) {
  const d = parse(z.object({ onRelease: z.boolean() }), input);
  return inOrg(userId, orgId, 'lab.manage', async (tx) => {
    const r = (await tx.query(`update dishes set sample_on_release = $3 where id = $1 and organization_id = $2 returning id, name`, [parse(z.uuid(), dishId), orgId, d.onRelease])).rows[0];
    if (!r) throw Errors.notFound('Блюдо не найдено.');
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'sample.on_release', entityType: 'dish', entityId: r.id, after: { on_release: d.onRelease } });
    return { ok: true, sample_on_release: d.onRelease };
  });
}
