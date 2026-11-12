import { z } from 'zod';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText, assertSiteAccess, fmtNum } from './common';
import { activeRule, criterionText } from './control';
import { raiseIncident } from './incidents';
import { assertInstrument } from './equipment';

/**
 * Замер (ТЗ v2 §3 «Температура», §5, AT-04, AT-05).
 *  - Сравнение только с утверждённым правилом объекта; без него — «критерий не задан», без оценки.
 *  - Время измерения хранится отдельно от времени внесения; ввод позже 15 минут — «поздний», нужен
 *    комментарий; старше суток — нельзя (пропущенные показания задним числом не создаются).
 *  - Отклонение: инцидент + задача ответственному + уведомление; затронутые партии видны в карточке.
 */

const LATE_MINUTES = 15;
const MAX_LATE_HOURS = 24;

const num = z.union([z.number(), z.string().trim().regex(/^-?\d+([.,]\d+)?$/, 'Введите число.').transform((s) => Number(s.replace(',', '.')))]);

const MeasureInput = z.object({
  controlObjectId: z.uuid(),
  value: num.refine((v) => Number.isFinite(v) && Math.abs(v) < 1000, 'Значение вне допустимого диапазона прибора.'),
  unit: z.enum(['°C', '%']).default('°C'),
  measuredAt: z.iso.datetime({ offset: true }).optional(),
  comment: optText(500),
  device: optText(120),
  instrumentId: z.uuid().optional().nullable(),
});

export async function recordMeasurement(userId: string, orgId: string, input: unknown) {
  const d = parse(MeasureInput, input);
  return inOrg(userId, orgId, 'measure.record', async (tx, m) => {
    const o = (await tx.query(`select * from control_objects where id = $1 and organization_id = $2 and status = 'active'`, [d.controlObjectId, orgId])).rows[0];
    if (!o) throw Errors.notFound('Объект контроля не найден.');
    assertSiteAccess(m, o.site_id);
    const parameter = d.unit === '%' ? 'humidity' : 'temperature';
    const now = new Date();
    const measuredAt = d.measuredAt ? new Date(d.measuredAt) : now;
    if (measuredAt.getTime() > now.getTime() + 2 * 60e3) throw Errors.validation('Время измерения не может быть в будущем.');
    if (now.getTime() - measuredAt.getTime() > MAX_LATE_HOURS * 3600e3) throw Errors.validation('Замер старше суток внести нельзя: пропущенные показания задним числом не создаются. Сообщите о пропуске ответственному.');
    const isLate = now.getTime() - measuredAt.getTime() > LATE_MINUTES * 60e3;
    if (isLate && !d.comment) throw Errors.validation('Замер вносится позже — укажите в комментарии, почему (например, «записано на бумаге в 09:00»).');

    // прибор из реестра: поверка действует; если приборы на площадке есть — выбор обязателен (этап 15)
    const instrument = await assertInstrument(tx, orgId, o.site_id, d.instrumentId);
    const rule = await activeRule(tx, o.id, parameter);
    if (rule && rule.unit !== d.unit) throw Errors.validation(`Единица замера должна быть ${rule.unit}.`);
    let result: 'ok' | 'deviation' | 'no_criterion' = 'no_criterion';
    if (rule) {
      const below = rule.min_value !== null && d.value < Number(rule.min_value);
      const above = rule.max_value !== null && d.value > Number(rule.max_value);
      result = below || above ? 'deviation' : 'ok';
    }
    const criterion = rule ? `${criterionText(rule)} (правило v${rule.version}; ${rule.source_ref})` : null;
    const row = (await tx.query(`insert into measurements (organization_id, site_id, control_object_id, rule_id, parameter, value, unit, measured_at, is_late, author_user_id, device, criterion, result, comment, instrument_id)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning *`,
      [orgId, o.site_id, o.id, rule?.id || null, parameter, d.value, d.unit, measuredAt, isLate, userId, instrument || d.device, criterion, result, d.comment, d.instrumentId || null])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: o.site_id, actorUserId: userId, action: 'measurement.record', entityType: 'measurement', entityId: row.id,
      after: { object: o.name, value: d.value, unit: d.unit, measured_at: measuredAt.toISOString(), result, late: isLate } });

    let incidentId: string | null = null;
    if (result === 'deviation' && rule) {
      const tz = (await tx.query(`select timezone from organizations where id = $1`, [orgId])).rows[0]?.timezone || 'Europe/Moscow';
      const when = measuredAt.toLocaleString('ru-RU', { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const what = `«${o.name}»: ${fmtNum(d.value)} ${d.unit} при пределе ${criterionText(rule)}. Замер ${when}.`;
      const inc = await raiseIncident(tx, {
        orgId, siteId: o.site_id, severity: 'high', kind: 'temperature_deviation', title: `Температура вне предела: ${o.name}`, what,
        entityType: 'control_object', entityId: o.id, responsibleRole: 'haccp_lead', dueMinutes: 30, ruleSource: rule.source_ref,
        recommendedAction: rule.reaction || 'Повторите замер. Сообщите ответственному: решение по продукции принимается по утверждённой процедуре.',
        createdBy: userId, notify: ['haccp_lead', 'chef'],
      });
      incidentId = inc.id;
    } else if (result === 'ok') {
      const open = (await tx.query(`select id from incidents where entity_type = 'control_object' and entity_id = $1 and kind = 'temperature_deviation' and status <> 'closed'`, [o.id])).rows[0];
      if (open) {
        // Нормальный повторный замер не закрывает отклонение сам: решение и закрытие — за ответственными.
        await tx.query(`insert into incident_events (organization_id, incident_id, user_id, event, note) values ($1, $2, $3, 'remeasure_ok', $4)`,
          [orgId, open.id, userId, `Повторный замер ${fmtNum(d.value)} ${d.unit} — в пределе.`]);
        incidentId = open.id;
      }
    }
    return { measurement: row, result, incidentId, criterion };
  });
}

const CorrectInput = z.object({
  value: num,
  reason: z.string().trim().min(5, 'Укажите причину исправления.').max(500),
});

/** Исправление: исходная запись остаётся, новая хранит исправленное значение, автора и причину (ТЗ v2 §10, AT-11). */
export async function correctMeasurement(userId: string, orgId: string, measurementId: string, input: unknown) {
  const d = parse(CorrectInput, input);
  return inOrg(userId, orgId, 'measure.record', async (tx, m) => {
    const orig = (await tx.query(`select * from measurements where id = $1 and organization_id = $2`, [measurementId, orgId])).rows[0];
    if (!orig) throw Errors.notFound('Замер не найден.');
    assertSiteAccess(m, orig.site_id);
    if ((await tx.query(`select 1 from measurements where corrects_id = $1`, [orig.id])).rowCount) throw Errors.conflict('Этот замер уже исправлен — исправляйте последнюю версию.');
    const rule = orig.rule_id ? (await tx.query(`select * from control_rules where id = $1`, [orig.rule_id])).rows[0] : null;
    let result = 'no_criterion';
    if (rule) result = (rule.min_value !== null && d.value < Number(rule.min_value)) || (rule.max_value !== null && d.value > Number(rule.max_value)) ? 'deviation' : 'ok';
    const row = (await tx.query(`insert into measurements (organization_id, site_id, control_object_id, rule_id, parameter, value, unit, measured_at, is_late, author_user_id, device, criterion, result, comment, corrects_id, correction_reason)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) returning *`,
      [orgId, orig.site_id, orig.control_object_id, orig.rule_id, orig.parameter, d.value, orig.unit, orig.measured_at, orig.is_late, userId, orig.device, orig.criterion, result,
        orig.comment, orig.id, d.reason])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: orig.site_id, actorUserId: userId, action: 'measurement.correct', entityType: 'measurement', entityId: row.id,
      before: { id: orig.id, value: Number(orig.value), result: orig.result }, after: { value: d.value, result }, reason: d.reason });
    return row;
  });
}
