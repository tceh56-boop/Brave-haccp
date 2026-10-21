import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText, assertSiteAccess, getSite, openTask, fmtNum } from './common';
import { raiseIncident } from './incidents';

/**
 * Суточные пробы и лабораторный контроль (этап 14; перенос MonChef_DailySamples.gs и LabTests.gs прежнего ЦЕХ).
 *  Пробы:
 *   - от блюда мероприятия (банкета), партии п/ф или блюда смены; одна проба на блюдо мероприятия / партию;
 *   - масса не меньше минимальной (или порция целиком), тара, место хранения и измеренная температура в пределах —
 *     иначе проба не принимается (переложить в исправный холодильник); срок хранения — от момента отбора;
 *   - параметры — настройка предприятия с основанием; пока её нет — значения по умолчанию с пометкой «проверьте»;
 *   - уничтожение — не раньше окончания срока, отдельной записью; записи не меняются;
 *   - без пробы по каждому поданному блюду мероприятие не отметить «проведено».
 *  Лаборатория:
 *   - программа: вид исследования, объект, периодичность, основание (программа производственного контроля);
 *   - результат — протокол лаборатории, показатели «норма / факт»; итог считается по показателям (любой вне нормы —
 *     «не соответствует»), без показателей — указывает человек по протоколу;
 *   - «не соответствует» → отклонение ответственному, задача на повторный отбор, срок по программе — через
 *     дни повтора; иначе следующий срок = дата отбора + периодичность.
 */

export const SAMPLE_DEFAULTS = { min_weight_g: 100, retention_hours: 48, t_min: 2, t_max: 6,
  basis: 'по умолчанию системы (СанПиН 2.3/2.4.3590-20, суточная проба) — проверьте по нормативному реестру и утвердите', confirmed: false };
const SOURCE_LABEL: Record<string, string> = { event: 'мероприятие', lot: 'партия п/ф', dish: 'блюдо смены' };
const decimal = z.union([z.number(), z.string().trim().regex(/^-?\d+([.,]\d+)?$/, 'Введите число.').transform((s) => Number(s.replace(',', '.')))]);
const ddmm = (s: string) => s.slice(0, 10).split('-').reverse().join('.');
const addDays = (s: string, n: number) => { const t = new Date(`${s}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД.');

async function settingsOf(tx: Tx, orgId: string) {
  const s = (await tx.query(`select s.*, u.full_name as updated_by_name from sample_settings s join users u on u.id = s.updated_by where s.organization_id = $1`, [orgId])).rows[0];
  if (!s) return { ...SAMPLE_DEFAULTS };
  return { min_weight_g: Number(s.min_weight_g), retention_hours: Number(s.retention_hours), t_min: Number(s.t_min), t_max: Number(s.t_max), basis: s.basis as string,
    confirmed: true, updated_by: s.updated_by_name as string, updated_at: s.updated_at as string };
}

const SettingsInput = z.object({ minWeightG: decimal.refine((v) => v > 0, 'Масса больше нуля.'), retentionHours: decimal.refine((v) => v > 0 && v <= 720, 'Срок хранения — от 1 до 720 ч.'),
  tMin: decimal, tMax: decimal, basis: z.string().trim().min(5, 'Укажите основание: документ и пункт.').max(300) }).refine((x) => x.tMin < x.tMax, 'Нижняя граница температуры меньше верхней.');

/** Параметры проб предприятия: масса, срок хранения, температура — с основанием. */
export async function setSampleSettings(userId: string, orgId: string, input: unknown) {
  const d = parse(SettingsInput, input);
  return inOrg(userId, orgId, 'lab.manage', async (tx) => {
    const before = await settingsOf(tx, orgId);
    await tx.query(`insert into sample_settings (organization_id, min_weight_g, retention_hours, t_min, t_max, basis, updated_by) values ($1, $2, $3, $4, $5, $6, $7)
      on conflict (organization_id) do update set min_weight_g = excluded.min_weight_g, retention_hours = excluded.retention_hours, t_min = excluded.t_min, t_max = excluded.t_max,
        basis = excluded.basis, updated_by = excluded.updated_by, updated_at = now()`, [orgId, d.minWeightG, d.retentionHours, d.tMin, d.tMax, d.basis, userId]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'sample.settings', entityType: 'organization', entityId: orgId, before, after: d });
    return settingsOf(tx, orgId);
  });
}

/* ───────────── Суточные пробы ───────────── */

/** Блюда мероприятий (вчера, сегодня, завтра; подтверждённые или проведённые), по которым нет пробы. */
async function missingSamples(tx: Tx, orgId: string, siteId: string) {
  return (await tx.query(`select e.id as event_id, e.number, e.title, e.event_date::text as event_date, i.dish_id, d.name as dish
    from plan_events e join plan_event_items i on i.event_id = e.id join dishes d on d.id = i.dish_id
    join organizations o on o.id = e.organization_id
    where e.organization_id = $1 and e.site_id = $2 and e.status in ('confirmed', 'done') and coalesce(i.actual_portions, i.portions) > 0
      and e.event_date between (now() at time zone o.timezone)::date - 1 and (now() at time zone o.timezone)::date + 1
      and not exists (select 1 from daily_samples s where s.plan_event_id = e.id and s.dish_id = i.dish_id)
    order by e.event_date, e.number, d.name`, [orgId, siteId])).rows;
}

export async function listSamples(userId: string, orgId: string, siteId: string) {
  const sid = parse(z.uuid({ message: 'Выберите площадку.' }), siteId);
  return inOrg(userId, orgId, 'sample.record', async (tx) => {
    const rows = (await tx.query(`select s.id, s.source, s.title, s.weight_g, s.whole_portion, s.container, s.storage_place, s.temperature, s.taken_at, s.keep_until, s.basis,
        s.plan_event_id, e.number as event_number, s.lot_id, tu.full_name as taken_by, x.destroyed_at, du.full_name as destroyed_by
      from daily_samples s join users tu on tu.id = s.taken_by left join plan_events e on e.id = s.plan_event_id
      left join daily_sample_destructions x on x.sample_id = s.id left join users du on du.id = x.destroyed_by
      where s.organization_id = $1 and s.site_id = $2 and (x.sample_id is null or x.destroyed_at > now() - interval '30 days')
      order by s.taken_at desc limit 300`, [orgId, sid])).rows;
    const now = Date.now();
    const out = rows.map((r) => ({ ...r, source_label: SOURCE_LABEL[r.source], weight_g: r.weight_g === null ? null : Number(r.weight_g), temperature: Number(r.temperature),
      status: r.destroyed_at ? 'destroyed' : new Date(r.keep_until).getTime() <= now ? 'due' : 'stored' }));
    return { settings: await settingsOf(tx, orgId), missing: await missingSamples(tx, orgId, sid),
      stored: out.filter((r) => r.status !== 'destroyed'), destroyed: out.filter((r) => r.status === 'destroyed') };
  }, sid);
}

const TakeInput = z.object({
  siteId: z.uuid(), source: z.enum(['event', 'lot', 'dish']),
  eventId: z.uuid().optional().nullable(), dishId: z.uuid().optional().nullable(), lotId: z.uuid().optional().nullable(),
  weightG: decimal.optional().nullable(), wholePortion: z.boolean().default(false),
  container: z.string().trim().min(3, 'Укажите тару: стерильная ёмкость с крышкой, маркировка.').max(200),
  storageObjectId: z.uuid().optional().nullable(), storagePlace: optText(200),
  temperature: decimal.refine((v) => v > -50 && v < 100, 'Проверьте температуру.'),
});

/** Отбор пробы. Масса и температура хранения проверяются по параметрам предприятия; вне пределов — не принимается. */
export async function takeSample(userId: string, orgId: string, input: unknown) {
  const d = parse(TakeInput, input);
  return inOrg(userId, orgId, 'sample.record', async (tx) => {
    await getSite(tx, orgId, d.siteId);
    const cfg = await settingsOf(tx, orgId);
    let title: string, eventId: string | null = null, dishId: string | null = null, lotId: string | null = null;
    if (d.source === 'event') {
      if (!d.eventId || !d.dishId) throw Errors.validation('Выберите мероприятие и блюдо.');
      const it = (await tx.query(`select e.number, e.title, e.status, d.name as dish from plan_events e join plan_event_items i on i.event_id = e.id join dishes d on d.id = i.dish_id
        where e.id = $1 and e.organization_id = $2 and e.site_id = $3 and i.dish_id = $4`, [d.eventId, orgId, d.siteId, d.dishId])).rows[0];
      if (!it) throw Errors.notFound('Блюда нет в меню мероприятия на этой площадке.');
      if (!['confirmed', 'done'].includes(it.status)) throw Errors.conflict('Проба отбирается по подтверждённому мероприятию.');
      title = `${it.dish} — мероприятие № ${it.number} «${it.title}»`; eventId = d.eventId; dishId = d.dishId;
    } else if (d.source === 'lot') {
      if (!d.lotId) throw Errors.validation('Выберите партию.');
      const l = (await tx.query(`select l.lot_no, l.status, p.name from lots l join products p on p.id = l.product_id where l.id = $1 and l.organization_id = $2 and l.site_id = $3`, [d.lotId, orgId, d.siteId])).rows[0];
      if (!l) throw Errors.notFound('Партия не найдена на этой площадке.');
      if (l.status === 'blocked') throw Errors.conflict('Партия заблокирована — проба не отбирается.');
      title = `${l.name}, партия ${l.lot_no || 'без номера'}`; lotId = d.lotId;
    } else {
      if (!d.dishId) throw Errors.validation('Выберите блюдо.');
      const dish = (await tx.query(`select name from dishes where id = $1 and organization_id = $2 and status = 'active'`, [d.dishId, orgId])).rows[0];
      if (!dish) throw Errors.notFound('Блюдо не найдено.');
      title = dish.name; dishId = d.dishId;
    }
    if (!d.wholePortion && (d.weightG == null || d.weightG < cfg.min_weight_g)) throw Errors.validation(`Масса пробы — не менее ${fmtNum(cfg.min_weight_g)} г (или отметьте «порция целиком»).`);
    let place = d.storagePlace;
    if (d.storageObjectId) {
      const o = (await tx.query(`select name from control_objects where id = $1 and organization_id = $2 and site_id = $3`, [d.storageObjectId, orgId, d.siteId])).rows[0];
      if (!o) throw Errors.notFound('Место хранения не найдено на этой площадке.');
      place = o.name;
    }
    if (!place) throw Errors.validation('Укажите место хранения (холодильник для проб).');
    if (d.temperature < cfg.t_min || d.temperature > cfg.t_max)
      throw Errors.conflict(`Температура хранения проб ${fmtNum(d.temperature)} °C вне ${fmtNum(cfg.t_min)}…${fmtNum(cfg.t_max)} °C — переложите пробу в исправный холодильник и измерьте снова.`);
    const basis = `не менее ${fmtNum(cfg.min_weight_g)} г, ${fmtNum(cfg.t_min)}…${fmtNum(cfg.t_max)} °C, ${fmtNum(cfg.retention_hours)} ч — ${cfg.basis}`;
    const dup = eventId ? 'по этому блюду мероприятия' : 'по этой партии';
    const s = (await tx.query(`insert into daily_samples (organization_id, site_id, source, plan_event_id, lot_id, dish_id, title, weight_g, whole_portion, container, storage_object_id, storage_place,
        temperature, basis, taken_by, keep_until) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now() + make_interval(secs => $16 * 3600))
      on conflict do nothing returning id, keep_until`,
    [orgId, d.siteId, d.source, eventId, lotId, dishId, title, d.wholePortion ? null : d.weightG, d.wholePortion, d.container, d.storageObjectId || null, place, d.temperature, basis, userId, cfg.retention_hours])).rows[0];
    if (!s) throw Errors.conflict(`Проба ${dup} уже отобрана.`);
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: 'sample.take', entityType: 'daily_sample', entityId: s.id,
      after: { title, weight_g: d.wholePortion ? 'порция' : d.weightG, temperature: d.temperature, keep_until: s.keep_until } });
    return { id: s.id as string, keep_until: s.keep_until as string, title };
  }, d.siteId);
}

/** Уничтожение пробы — не раньше окончания срока хранения. */
export async function destroySample(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(z.object({ note: optText(300) }), input ?? {});
  return inOrg(userId, orgId, 'sample.record', async (tx, m) => {
    const s = (await tx.query(`select s.*, x.sample_id as destroyed from daily_samples s left join daily_sample_destructions x on x.sample_id = s.id where s.id = $1 and s.organization_id = $2`, [id, orgId])).rows[0];
    if (!s) throw Errors.notFound('Проба не найдена.');
    assertSiteAccess(m, s.site_id);
    if (s.destroyed) throw Errors.conflict('Проба уже уничтожена.');
    if (new Date(s.keep_until).getTime() > Date.now()) throw Errors.conflict(`Срок хранения пробы ещё не истёк (до ${new Date(s.keep_until).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}) — уничтожать нельзя.`);
    await tx.query(`insert into daily_sample_destructions (sample_id, organization_id, destroyed_by, note) values ($1, $2, $3, $4)`, [s.id, orgId, userId, d.note]);
    await audit.record(tx, { organizationId: orgId, siteId: s.site_id, actorUserId: userId, action: 'sample.destroy', entityType: 'daily_sample', entityId: s.id });
    return { ok: true };
  });
}

/** Для «Проведено»: блюда мероприятия с фактическими порциями без суточной пробы. */
export async function dishesWithoutSample(tx: Tx, eventId: string, dishIds: string[]) {
  if (!dishIds.length) return [];
  return (await tx.query(`select d.name from dishes d where d.id = any($2::uuid[]) and not exists (select 1 from daily_samples s where s.plan_event_id = $1 and s.dish_id = d.id) order by d.name`,
    [eventId, dishIds])).rows.map((r) => r.name as string);
}

/* ───────────── Лабораторный контроль ───────────── */

const ProgramInput = z.object({
  siteId: z.uuid(), testType: z.string().trim().min(3, 'Укажите вид исследования.').max(200), target: z.string().trim().min(2, 'Укажите объект исследования.').max(200),
  dishId: z.uuid().optional().nullable(), periodDays: z.coerce.number().int().min(1, 'Периодичность — от 1 дня.').max(730), retestDays: z.coerce.number().int().min(1).max(90).optional().nullable(),
  nextDue: day, basis: z.string().trim().min(5, 'Укажите основание: программа производственного контроля, пункт.').max(300),
  responsibleRole: z.enum(['haccp_lead', 'technologist', 'chef', 'director']).default('haccp_lead'),
});

export async function createProgram(userId: string, orgId: string, input: unknown) {
  const d = parse(ProgramInput, input);
  return inOrg(userId, orgId, 'lab.manage', async (tx) => {
    await getSite(tx, orgId, d.siteId);
    if (d.dishId && !(await tx.query(`select 1 from dishes where id = $1 and organization_id = $2`, [d.dishId, orgId])).rowCount) throw Errors.notFound('Блюдо не найдено.');
    const p = (await tx.query(`insert into lab_programs (organization_id, site_id, test_type, target, dish_id, period_days, retest_days, next_due, basis, responsible_role, created_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
    [orgId, d.siteId, d.testType, d.target, d.dishId || null, d.periodDays, d.retestDays || null, d.nextDue, d.basis, d.responsibleRole, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: 'lab.program_create', entityType: 'lab_program', entityId: p.id, after: d });
    return p;
  }, d.siteId);
}

export async function archiveProgram(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(z.object({ reason: z.string().trim().min(5, 'Укажите причину (например, исследование исключено из программы ПК).').max(300) }), input);
  return inOrg(userId, orgId, 'lab.manage', async (tx, m) => {
    const p = (await tx.query(`select * from lab_programs where id = $1 and organization_id = $2 for update`, [id, orgId])).rows[0];
    if (!p) throw Errors.notFound('Исследование программы не найдено.');
    assertSiteAccess(m, p.site_id);
    await tx.query(`update lab_programs set status = 'archived' where id = $1`, [p.id]);
    await audit.record(tx, { organizationId: orgId, siteId: p.site_id, actorUserId: userId, action: 'lab.program_archive', entityType: 'lab_program', entityId: p.id, reason: d.reason });
    return { ok: true };
  });
}

export async function listLab(userId: string, orgId: string, siteId: string) {
  const sid = parse(z.uuid({ message: 'Выберите площадку.' }), siteId);
  return inOrg(userId, orgId, 'lab.read', async (tx) => {
    const programs = (await tx.query(`select p.id, p.test_type, p.target, p.dish_id, p.period_days, p.retest_days, p.next_due::text as next_due, p.basis, p.responsible_role,
        (p.next_due < (now() at time zone o.timezone)::date) as overdue,
        (select json_build_object('result', r.result, 'result_on', r.result_on::text, 'protocol_no', r.protocol_no) from lab_results r where r.program_id = p.id order by r.sampled_on desc, r.recorded_at desc limit 1) as last
      from lab_programs p join organizations o on o.id = p.organization_id where p.organization_id = $1 and p.site_id = $2 and p.status = 'active' order by p.next_due, p.test_type`, [orgId, sid])).rows;
    const results = (await tx.query(`select r.id, r.program_id, r.test_type, r.target, r.lab_name, r.protocol_no, r.sampled_on::text as sampled_on, r.result_on::text as result_on, r.result, r.conclusion,
        r.incident_id, jsonb_array_length(r.params) as params, u.full_name as recorded_by,
        (select count(*)::int from evidence_files f where f.entity_type = 'lab_result' and f.entity_id = r.id) as files
      from lab_results r join users u on u.id = r.recorded_by where r.organization_id = $1 and r.site_id = $2 order by r.result_on desc, r.recorded_at desc limit 200`, [orgId, sid])).rows;
    return { programs, results };
  }, sid);
}

const ParamIn = z.object({ name: z.string().trim().min(1).max(200), norm: z.string().trim().min(1, 'Укажите норму показателя.').max(200), fact: z.string().trim().min(1, 'Укажите фактическое значение.').max(200),
  unit: optText(40), pass: z.boolean() });
const ResultInput = z.object({
  siteId: z.uuid(), programId: z.uuid().optional().nullable(),
  testType: z.string().trim().max(200).optional().nullable(), target: z.string().trim().max(200).optional().nullable(),
  dishId: z.uuid().optional().nullable(), lotId: z.uuid().optional().nullable(),
  labName: z.string().trim().min(3, 'Укажите лабораторию.').max(200), protocolNo: z.string().trim().min(1, 'Укажите номер протокола.').max(100),
  sampledOn: day, resultOn: day, params: z.array(ParamIn).max(50).default([]),
  result: z.enum(['pass', 'fail']).optional().nullable(), conclusion: optText(1000),
}).refine((x) => x.resultOn >= x.sampledOn, 'Дата результата не раньше даты отбора.');

/** Результат исследования по протоколу. «Не соответствует» → отклонение, задача на повторный отбор, срок по программе. */
export async function recordResult(userId: string, orgId: string, input: unknown) {
  const d = parse(ResultInput, input);
  return inOrg(userId, orgId, 'lab.manage', async (tx) => {
    await getSite(tx, orgId, d.siteId);
    const p = d.programId ? (await tx.query(`select * from lab_programs where id = $1 and organization_id = $2 and site_id = $3 and status = 'active' for update`, [d.programId, orgId, d.siteId])).rows[0] : null;
    if (d.programId && !p) throw Errors.notFound('Исследование программы не найдено на этой площадке.');
    const testType = p?.test_type || d.testType, target = p?.target || d.target;
    if (!testType || testType.length < 3 || !target || target.length < 2) throw Errors.validation('Укажите вид исследования и объект (или выберите из программы).');
    if (d.lotId && !(await tx.query(`select 1 from lots where id = $1 and organization_id = $2`, [d.lotId, orgId])).rowCount) throw Errors.notFound('Партия не найдена.');
    // итог — по показателям; без показателей — по протоколу, указывает человек
    const result = d.params.length ? (d.params.some((x) => !x.pass) ? 'fail' : 'pass') : d.result;
    if (!result) throw Errors.validation('Добавьте показатели из протокола или укажите итог: соответствует / не соответствует.');
    if (d.params.length && d.result && d.result !== result) throw Errors.validation('Итог не совпадает с показателями: проверьте отметки «в норме».');
    if (result === 'fail' && (!d.conclusion || d.conclusion.length < 5)) throw Errors.validation('Для несоответствия укажите заключение лаборатории.');
    const id = randomUUID();
    let incidentId: string | null = null, nextDue: string | null = null;
    if (p) {
      const today = (await tx.query(`select (now() at time zone timezone)::date::text as d from organizations where id = $1`, [orgId])).rows[0].d as string;
      nextDue = result === 'fail' && p.retest_days ? addDays(d.resultOn > today ? d.resultOn : today, p.retest_days) : addDays(d.sampledOn, p.period_days);
      await tx.query(`update lab_programs set next_due = $2::date where id = $1`, [p.id, nextDue]);
    }
    if (result === 'fail') {
      const bad = d.params.filter((x) => !x.pass).map((x) => `${x.name}: ${x.fact}${x.unit ? ` ${x.unit}` : ''} при норме ${x.norm}`).join('; ');
      incidentId = (await raiseIncident(tx, { orgId, siteId: d.siteId, severity: 'high', kind: 'lab_fail', title: `Не соответствует: ${testType}`,
        what: `${target} — протокол ${d.protocolNo} (${d.labName}) от ${ddmm(d.resultOn)}. ${bad || d.conclusion}`.trim(),
        entityType: 'lab_result', entityId: id, responsibleRole: p?.responsible_role || 'haccp_lead', dueMinutes: 24 * 60,
        ruleSource: p?.basis || null, recommendedAction: 'Установить причину, устранить, назначить повторный отбор; при угрозе безопасности — остановить выпуск продукции', createdBy: userId })).id;
    }
    await tx.query(`insert into lab_results (id, organization_id, site_id, program_id, test_type, target, dish_id, lot_id, lab_name, protocol_no, sampled_on, result_on, params, result, conclusion, incident_id, recorded_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [id, orgId, d.siteId, p?.id || null, testType, target, d.dishId || p?.dish_id || null, d.lotId || null, d.labName, d.protocolNo, d.sampledOn, d.resultOn, JSON.stringify(d.params), result, d.conclusion, incidentId, userId]);
    if (result === 'fail') await openTask(tx, { orgId, siteId: d.siteId, kind: 'lab_retest', title: `Повторный отбор: ${testType} — ${target}`,
      details: `Несоответствие по протоколу ${d.protocolNo}.${nextDue ? ` Срок повторного отбора — ${ddmm(nextDue)}.` : ''}`,
      entityType: 'lab_result', entityId: id, assigneeRole: p?.responsible_role || 'haccp_lead', dueAt: nextDue ? new Date(`${nextDue}T18:00:00+03:00`) : null, createdBy: userId });
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: 'lab.result', entityType: 'lab_result', entityId: id,
      after: { testType, target, protocol: d.protocolNo, result, params: d.params.length, next_due: nextDue } });
    return { id, result, incident_id: incidentId, next_due: nextDue };
  }, d.siteId);
}

export async function getResult(userId: string, orgId: string, id: string) {
  return inOrg(userId, orgId, 'lab.read', async (tx, m) => {
    const r = (await tx.query(`select r.*, r.sampled_on::text as sampled_on, r.result_on::text as result_on, u.full_name as recorded_by_name, p.basis as program_basis, d.name as dish, l.lot_no
      from lab_results r join users u on u.id = r.recorded_by left join lab_programs p on p.id = r.program_id left join dishes d on d.id = r.dish_id left join lots l on l.id = r.lot_id
      where r.id = $1 and r.organization_id = $2`, [id, orgId])).rows[0];
    if (!r) throw Errors.notFound('Результат не найден.');
    assertSiteAccess(m, r.site_id);
    return r;
  });
}
