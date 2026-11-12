import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText, assertSiteAccess, getSite } from './common';
import { raiseIncident } from './incidents';

/**
 * Оборудование, ТО и поверка (этап 15; перенос Equipment.gs прежнего ЦЕХ и реестра приборов MON CHEF).
 *  - Реестр площадки: вид, модель, заводской и инвентарный номер, связь с объектом контроля (холодильник ↔ замеры).
 *  - Средство измерения (термометр, щуп, весы): поверка — дата, срок следующей, документ. Срок прошёл или не задан —
 *    прибор не принимается для замеров («измерение не принимается»). Если на площадке есть приборы — замер
 *    вносится с выбором прибора.
 *  - События не меняются: ТО (сдвигает срок следующего ТО), поверка (обновляет срок поверки — только с документом),
 *    неисправность (оборудование «неисправно», отклонение; влияние на безопасность — высокий риск),
 *    ремонт с решением о допуске к работе (допущено → «исправно»).
 */

export const KIND_LABEL: Record<string, string> = { cold: 'Холодильное', thermal: 'Тепловое', mechanical: 'Механическое', washing: 'Моечное', instrument: 'Средство измерения',
  scales: 'Весы', other: 'Прочее' };
export const EVENT_LABEL: Record<string, string> = { maintenance: 'ТО', calibration: 'Поверка', breakdown: 'Неисправность', repair: 'Ремонт' };
export const STATUS_LABEL: Record<string, string> = { active: 'Исправно', broken: 'Неисправно', retired: 'Списано' };
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД.');
const addDays = (s: string, n: number) => { const t = new Date(`${s}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const ddmm = (s: string) => s.slice(0, 10).split('-').reverse().join('.');

async function todayOf(tx: Tx, orgId: string) {
  return (await tx.query(`select (now() at time zone timezone)::date::text as d from organizations where id = $1`, [orgId])).rows[0].d as string;
}

/** Состояние единицы: пригоден ли прибор, просрочено ли ТО. */
function stateOf(e: { status: string; measuring: boolean; calibration_due: string | null; maintenance_due: string | null }, today: string) {
  const calibration = !e.measuring ? null : !e.calibration_due ? 'none' : e.calibration_due < today ? 'expired' : addDays(today, 30) >= e.calibration_due ? 'soon' : 'ok';
  const usable = e.status === 'active' && (!e.measuring || calibration === 'ok' || calibration === 'soon');
  const reason = e.status === 'broken' ? 'неисправно' : e.status === 'retired' ? 'списано' : calibration === 'expired' ? `поверка истекла ${ddmm(e.calibration_due!)}` : calibration === 'none' ? 'нет даты следующей поверки' : null;
  return { calibration, usable, reason, maintenance_overdue: !!e.maintenance_due && e.maintenance_due < today };
}

const EQ_COLS = `e.*, e.calibrated_on::text as calibrated_on, e.calibration_due::text as calibration_due, e.maintenance_due::text as maintenance_due`;

/* ───────────── Приборы для замеров ───────────── */

/**
 * Прибор для замера: выбран — должен быть исправным средством измерения площадки с действующей поверкой;
 * не выбран — допустимо, только если на площадке нет средств измерения в реестре. Возвращает подпись прибора.
 */
export async function assertInstrument(tx: Tx, orgId: string, siteId: string, instrumentId: string | null | undefined): Promise<string | null> {
  if (!instrumentId) {
    const any = (await tx.query(`select 1 from equipment where organization_id = $1 and site_id = $2 and measuring and status = 'active' limit 1`, [orgId, siteId])).rowCount;
    if (any) throw Errors.validation('Выберите прибор, которым измеряли (из реестра оборудования).');
    return null;
  }
  const e = (await tx.query(`select ${EQ_COLS} from equipment e where e.id = $1 and e.organization_id = $2`, [instrumentId, orgId])).rows[0];
  if (!e || e.site_id !== siteId) throw Errors.notFound('Прибор не найден на этой площадке.');
  if (!e.measuring) throw Errors.validation(`«${e.name}» — не средство измерения.`);
  const st = stateOf(e, await todayOf(tx, orgId));
  if (!st.usable) throw Errors.conflict(`Измерение не принимается — «${e.name}»: ${st.reason}. Возьмите другой прибор.`);
  return [e.name, e.serial_no ? `№ ${e.serial_no}` : '', e.calibration_due ? `поверка до ${ddmm(e.calibration_due)}` : ''].filter(Boolean).join(', ');
}

/** Приборы площадки для выбора при замере (только пригодные). */
export async function listInstruments(userId: string, orgId: string, siteId: string) {
  const sid = parse(z.uuid({ message: 'Выберите площадку.' }), siteId);
  return inOrg(userId, orgId, 'site.read', async (tx) => {
    const today = await todayOf(tx, orgId);
    const rows = (await tx.query(`select ${EQ_COLS} from equipment e where e.organization_id = $1 and e.site_id = $2 and e.measuring and e.status <> 'retired' order by e.name`, [orgId, sid])).rows;
    return rows.map((e) => ({ id: e.id, name: e.name, serial_no: e.serial_no, calibration_due: e.calibration_due, ...stateOf(e, today) }));
  }, sid);
}

/* ───────────── Реестр ───────────── */

const EquipmentInput = z.object({
  siteId: z.uuid(), name: z.string().trim().min(2, 'Укажите наименование.').max(200), kind: z.enum(['cold', 'thermal', 'mechanical', 'washing', 'instrument', 'scales', 'other']),
  model: optText(200), serialNo: optText(100), inventoryNo: optText(100), controlObjectId: z.uuid().optional().nullable(),
  measuring: z.boolean().optional(), calibratedOn: day.optional().nullable(), calibrationDue: day.optional().nullable(), calibrationDoc: optText(300),
  maintenanceDays: z.coerce.number().int().min(1).max(730).optional().nullable(), maintenanceDue: day.optional().nullable(),
});

export async function createEquipment(userId: string, orgId: string, input: unknown) {
  const d = parse(EquipmentInput, input);
  return inOrg(userId, orgId, 'equipment.manage', async (tx) => {
    await getSite(tx, orgId, d.siteId);
    if (d.controlObjectId && !(await tx.query(`select 1 from control_objects where id = $1 and organization_id = $2 and site_id = $3`, [d.controlObjectId, orgId, d.siteId])).rowCount)
      throw Errors.notFound('Объект контроля не найден на этой площадке.');
    const measuring = d.measuring ?? (d.kind === 'instrument' || d.kind === 'scales');
    if (measuring && d.calibrationDue && !d.calibrationDoc) throw Errors.validation('Укажите документ о поверке (свидетельство, запись в ФГИС «Аршин»).');
    const today = await todayOf(tx, orgId);
    const e = (await tx.query(`insert into equipment (organization_id, site_id, name, kind, model, serial_no, inventory_no, control_object_id, measuring, calibrated_on, calibration_due, calibration_doc,
        maintenance_days, maintenance_due, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id`,
    [orgId, d.siteId, d.name, d.kind, d.model, d.serialNo, d.inventoryNo, d.controlObjectId || null, measuring, measuring ? d.calibratedOn || null : null, measuring ? d.calibrationDue || null : null,
      measuring ? d.calibrationDoc : null, d.maintenanceDays || null, d.maintenanceDays ? d.maintenanceDue || addDays(today, d.maintenanceDays) : null, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: 'equipment.create', entityType: 'equipment', entityId: e.id, after: { ...d, measuring } });
    return e;
  }, d.siteId);
}

export async function listEquipment(userId: string, orgId: string, siteId: string) {
  const sid = parse(z.uuid({ message: 'Выберите площадку.' }), siteId);
  return inOrg(userId, orgId, 'equipment.read', async (tx) => {
    const today = await todayOf(tx, orgId);
    const rows = (await tx.query(`select ${EQ_COLS}, o.name as object_name from equipment e left join control_objects o on o.id = e.control_object_id
      where e.organization_id = $1 and e.site_id = $2 and e.status <> 'retired' order by e.status = 'active', e.name`, [orgId, sid])).rows;
    return rows.map((e) => ({ id: e.id, name: e.name, kind: e.kind, kind_label: KIND_LABEL[e.kind], model: e.model, serial_no: e.serial_no, inventory_no: e.inventory_no, object_name: e.object_name,
      measuring: e.measuring, calibration_due: e.calibration_due, maintenance_due: e.maintenance_due, status: e.status, status_label: STATUS_LABEL[e.status], ...stateOf(e, today) }));
  }, sid);
}

export async function getEquipment(userId: string, orgId: string, id: string) {
  return inOrg(userId, orgId, 'equipment.read', async (tx, m) => {
    const e = (await tx.query(`select ${EQ_COLS}, o.name as object_name from equipment e left join control_objects o on o.id = e.control_object_id where e.id = $1 and e.organization_id = $2`, [id, orgId])).rows[0];
    if (!e) throw Errors.notFound('Оборудование не найдено.');
    assertSiteAccess(m, e.site_id);
    const events = (await tx.query(`select v.id, v.kind, v.happened_on::text as happened_on, v.description, v.safety_impact, v.performer, v.document, v.next_due::text as next_due, v.admitted,
        v.incident_id, v.recorded_at, u.full_name as recorded_by from equipment_events v join users u on u.id = v.recorded_by where v.equipment_id = $1 order by v.recorded_at desc limit 200`, [e.id])).rows
      .map((v) => ({ ...v, kind_label: EVENT_LABEL[v.kind] }));
    return { equipment: { ...e, kind_label: KIND_LABEL[e.kind], status_label: STATUS_LABEL[e.status], ...stateOf(e, await todayOf(tx, orgId)) }, events };
  });
}

const EditInput = z.object({ name: z.string().trim().min(2).max(200).optional(), model: optText(200), serialNo: optText(100), inventoryNo: optText(100),
  controlObjectId: z.uuid().optional().nullable(), maintenanceDays: z.coerce.number().int().min(1).max(730).optional().nullable() });

/** Карточка: наименование, номера, связь с объектом, периодичность ТО. Поверка — только событием с документом. */
export async function updateEquipment(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(EditInput, input);
  return inOrg(userId, orgId, 'equipment.manage', async (tx, m) => {
    const e = (await tx.query(`select ${EQ_COLS} from equipment e where e.id = $1 and e.organization_id = $2 for update`, [id, orgId])).rows[0];
    if (!e) throw Errors.notFound('Оборудование не найдено.');
    assertSiteAccess(m, e.site_id);
    if (d.controlObjectId && !(await tx.query(`select 1 from control_objects where id = $1 and organization_id = $2 and site_id = $3`, [d.controlObjectId, orgId, e.site_id])).rowCount)
      throw Errors.notFound('Объект контроля не найден на этой площадке.');
    const md = d.maintenanceDays !== undefined ? d.maintenanceDays : e.maintenance_days;
    const mdue = md ? e.maintenance_due || addDays(await todayOf(tx, orgId), md) : null;
    await tx.query(`update equipment set name = $2, model = $3, serial_no = $4, inventory_no = $5, control_object_id = $6, maintenance_days = $7, maintenance_due = $8 where id = $1`,
      [e.id, d.name ?? e.name, d.model !== undefined ? d.model : e.model, d.serialNo !== undefined ? d.serialNo : e.serial_no, d.inventoryNo !== undefined ? d.inventoryNo : e.inventory_no,
        d.controlObjectId !== undefined ? d.controlObjectId : e.control_object_id, md || null, mdue]);
    await audit.record(tx, { organizationId: orgId, siteId: e.site_id, actorUserId: userId, action: 'equipment.update', entityType: 'equipment', entityId: e.id,
      before: { name: e.name, serial_no: e.serial_no, maintenance_days: e.maintenance_days }, after: d });
    return { ok: true };
  });
}

export async function retireEquipment(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(z.object({ reason: z.string().trim().min(5, 'Укажите причину списания.').max(300) }), input);
  return inOrg(userId, orgId, 'equipment.manage', async (tx, m) => {
    const e = (await tx.query(`select * from equipment where id = $1 and organization_id = $2 for update`, [id, orgId])).rows[0];
    if (!e) throw Errors.notFound('Оборудование не найдено.');
    assertSiteAccess(m, e.site_id);
    await tx.query(`update equipment set status = 'retired', retired_reason = $2 where id = $1`, [e.id, d.reason]);
    await audit.record(tx, { organizationId: orgId, siteId: e.site_id, actorUserId: userId, action: 'equipment.retire', entityType: 'equipment', entityId: e.id, reason: d.reason });
    return { ok: true };
  });
}

/* ───────────── События ───────────── */

const EventInput = z.object({
  kind: z.enum(['maintenance', 'calibration', 'breakdown', 'repair']),
  happenedOn: day.optional().nullable(),
  description: z.string().trim().min(3, 'Опишите, что сделано или что случилось.').max(1000),
  safetyImpact: optText(500), performer: optText(200), document: optText(300), nextDue: day.optional().nullable(), admitted: z.boolean().optional().nullable(),
});

/** ТО, поверка, неисправность, ремонт. Неисправность может сообщить любой сотрудник; остальное — ответственный за оборудование. */
export async function recordEvent(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(EventInput, input);
  return inOrg(userId, orgId, d.kind === 'breakdown' ? 'equipment.report' : 'equipment.manage', async (tx, m) => {
    const e = (await tx.query(`select ${EQ_COLS} from equipment e where e.id = $1 and e.organization_id = $2 for update`, [id, orgId])).rows[0];
    if (!e) throw Errors.notFound('Оборудование не найдено.');
    assertSiteAccess(m, e.site_id);
    if (e.status === 'retired') throw Errors.conflict('Оборудование списано.');
    const today = await todayOf(tx, orgId);
    const on = d.happenedOn || today;
    if (on > today) throw Errors.validation('Дата события не может быть в будущем.');
    let incidentId: string | null = null, breakdownId: string | null = null;
    if (d.kind === 'calibration') {
      if (!e.measuring) throw Errors.validation(`«${e.name}» — не средство измерения, поверка не ведётся.`);
      if (!d.document || d.document.length < 3) throw Errors.validation('Укажите документ о поверке (свидетельство, запись в ФГИС «Аршин»).');
      if (!d.nextDue || d.nextDue <= on) throw Errors.validation('Укажите срок следующей поверки — позже даты поверки.');
      await tx.query(`update equipment set calibrated_on = $2, calibration_due = $3, calibration_doc = $4 where id = $1`, [e.id, on, d.nextDue, d.document]);
    } else if (d.kind === 'maintenance') {
      if (e.maintenance_days) await tx.query(`update equipment set maintenance_due = $2 where id = $1`, [e.id, addDays(on, e.maintenance_days)]);
    } else if (d.kind === 'breakdown') {
      await tx.query(`update equipment set status = 'broken' where id = $1`, [e.id]);
      incidentId = (await raiseIncident(tx, { orgId, siteId: e.site_id, severity: d.safetyImpact ? 'high' : 'medium', kind: 'equipment', title: `Неисправно: ${e.name}`,
        what: `${d.description}${d.safetyImpact ? ` Влияние на безопасность: ${d.safetyImpact}` : ''}`, entityType: 'equipment', entityId: e.id, responsibleRole: 'chef', dueMinutes: d.safetyImpact ? 60 : 24 * 60,
        recommendedAction: e.kind === 'cold' ? 'Переместить продукцию в исправное оборудование, проверить температуру продукции, вызвать сервис' : 'Вывести из работы, вызвать сервис; продукцию, затронутую неисправностью, оценить по процедуре',
        createdBy: userId, notify: ['chef', 'haccp_lead'] })).id;
    } else {
      if (d.admitted == null) throw Errors.validation('Укажите решение: допущено к работе или нет.');
      breakdownId = (await tx.query(`select id from equipment_events where equipment_id = $1 and kind = 'breakdown' order by recorded_at desc limit 1`, [e.id])).rows[0]?.id || null;
      if (d.admitted) await tx.query(`update equipment set status = 'active' where id = $1`, [e.id]);
    }
    const v = (await tx.query(`insert into equipment_events (organization_id, site_id, equipment_id, kind, happened_on, description, safety_impact, performer, document, next_due, admitted, breakdown_id, incident_id, recorded_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id`,
    [orgId, e.site_id, e.id, d.kind, on, d.description, d.kind === 'breakdown' ? d.safetyImpact : null, d.performer, d.document, d.kind === 'calibration' ? d.nextDue : null,
      d.kind === 'repair' ? d.admitted : null, breakdownId, incidentId, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: e.site_id, actorUserId: userId, action: `equipment.${d.kind}`, entityType: 'equipment', entityId: e.id, after: d });
    return { id: v.id as string, incident_id: incidentId };
  });
}
