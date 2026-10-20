import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText, openTask, closeTasksFor, notifyRoles, assertSiteAccess, getSite } from './common';

/**
 * Отклонения и проблемы (ТЗ v2 §2, §5, §12): Новая → В работе → Ожидает проверки → Закрыта.
 * Отклонение создаёт инцидент, задачу ответственному и уведомление ролям (AT-05). Закрыть критическое
 * отклонение одной кнопкой нельзя: нужно записать выполненное действие, а при требовании процедуры —
 * подтверждение другого ответственного (incident.confirm). Система предлагает только шаги из утверждённой
 * процедуры и не объявляет продукцию безопасной по одному замеру.
 */

export const SEVERITY_LABEL: Record<string, string> = { critical: 'Критично', high: 'Высокий риск', medium: 'Средний', low: 'Низкий' };
export const STATUS_LABEL: Record<string, string> = { new: 'Новая', in_progress: 'В работе', pending_review: 'Ожидает проверки', closed: 'Закрыта' };

export interface NewIncident {
  orgId: string; siteId?: string | null; severity: 'critical' | 'high' | 'medium' | 'low';
  kind: 'temperature_deviation' | 'receipt_problem' | 'expired_lot' | 'reported';
  title: string; what: string; entityType?: string; entityId?: string;
  responsibleRole?: string; dueMinutes?: number; ruleSource?: string | null; recommendedAction?: string | null;
  requiresConfirmation?: boolean; createdBy?: string | null; notify?: string[];
}

/** Инцидент по объекту без дублей: если по объекту уже есть открытый — дописывается событие. */
export async function raiseIncident(tx: Tx, n: NewIncident): Promise<{ id: string; created: boolean }> {
  if (n.entityId) {
    const open = (await tx.query(`select id from incidents where organization_id = $1 and kind = $2 and entity_id = $3 and status <> 'closed' order by created_at desc limit 1`,
      [n.orgId, n.kind, n.entityId])).rows[0];
    if (open) {
      await addEvent(tx, n.orgId, open.id, n.createdBy || null, 'repeat', n.what);
      return { id: open.id, created: false };
    }
  }
  const inc = (await tx.query(`insert into incidents (organization_id, site_id, severity, kind, title, what, entity_type, entity_id, responsible_role, due_at,
      rule_source, recommended_action, requires_confirmation, created_by)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + make_interval(mins => $10), $11, $12, $13, $14) returning id`,
    [n.orgId, n.siteId || null, n.severity, n.kind, n.title, n.what, n.entityType || null, n.entityId || null, n.responsibleRole || 'haccp_lead',
      n.dueMinutes ?? 60, n.ruleSource || null, n.recommendedAction || null, n.requiresConfirmation ?? true, n.createdBy || null])).rows[0];
  await addEvent(tx, n.orgId, inc.id, n.createdBy || null, 'created', n.what);
  await openTask(tx, { orgId: n.orgId, siteId: n.siteId, kind: 'incident', title: `Разобрать: ${n.title}`, details: n.what, entityType: 'incident', entityId: inc.id,
    assigneeRole: n.responsibleRole || 'haccp_lead', dueAt: new Date(Date.now() + (n.dueMinutes ?? 60) * 60e3), createdBy: n.createdBy || null });
  await notifyRoles(tx, { orgId: n.orgId, siteId: n.siteId, roles: n.notify || [n.responsibleRole || 'haccp_lead'], title: n.title, body: n.what, entityType: 'incident', entityId: inc.id });
  await audit.record(tx, { organizationId: n.orgId, siteId: n.siteId, actorUserId: n.createdBy || null, action: 'incident.create', entityType: 'incident', entityId: inc.id,
    after: { kind: n.kind, severity: n.severity, title: n.title, entity_type: n.entityType, entity_id: n.entityId } });
  return { id: inc.id, created: true };
}

async function addEvent(tx: Tx, orgId: string, incidentId: string, userId: string | null, event: string, note?: string | null, data?: unknown) {
  await tx.query(`insert into incident_events (organization_id, incident_id, user_id, event, note, data) values ($1, $2, $3, $4, $5, $6)`,
    [orgId, incidentId, userId, event, note || null, data === undefined ? null : JSON.stringify(data)]);
}

const ReportInput = z.object({
  siteId: z.uuid(),
  what: z.string().trim().min(5, 'Опишите, что случилось.').max(2000),
  entityType: z.enum(['control_object', 'lot', 'receipt']).optional(),
  entityId: z.uuid().optional(),
});

/** «Сообщить о проблеме»: сотрудник описывает словами, система назначает ответственного и уведомляет. */
export async function reportProblem(userId: string, orgId: string, input: unknown) {
  const d = parse(ReportInput, input);
  return inOrg(userId, orgId, 'incident.report', async (tx) => {
    const site = await getSite(tx, orgId, d.siteId);
    const r = await raiseIncident(tx, {
      orgId, siteId: site.id, severity: 'medium', kind: 'reported', title: 'Сообщение о проблеме', what: d.what,
      entityType: d.entityType, entityId: d.entityId, responsibleRole: 'chef', dueMinutes: 120, createdBy: userId,
      recommendedAction: 'Ответственный оценивает ситуацию и решает по утверждённой процедуре.', notify: ['chef', 'haccp_lead'],
    });
    return { id: r.id };
  }, d.siteId);
}

export async function listIncidents(userId: string, orgId: string, opts: { open?: boolean } = {}) {
  return inOrg(userId, orgId, 'incident.read', async (tx, m) => {
    const rows = (await tx.query(`select i.*, s.name as site_name from incidents i left join sites s on s.id = i.site_id
      where i.organization_id = $1 and ($2::boolean is not true or i.status <> 'closed') order by (i.status = 'closed'), i.created_at desc limit 200`, [orgId, opts.open ?? null])).rows;
    return rows.filter((r) => !r.site_id || !m.site_ids.length || m.site_ids.includes(r.site_id))
      .map((r) => ({ ...r, severity_label: SEVERITY_LABEL[r.severity], status_label: STATUS_LABEL[r.status] }));
  });
}

async function loadIncident(tx: Tx, orgId: string, id: string, lock = false) {
  const i = (await tx.query(`select * from incidents where id = $1 and organization_id = $2 ${lock ? 'for update' : ''}`, [id, orgId])).rows[0];
  if (!i) throw Errors.notFound('Отклонение не найдено.');
  return i;
}

/** Затронутые партии: для отклонения по объекту — всё, что на нём хранится; для партии — она сама. */
async function affectedLots(tx: Tx, i: { entity_type: string | null; entity_id: string | null }) {
  if (i.entity_type === 'control_object') {
    return (await tx.query(`select l.id, p.name as product, l.lot_no, l.quantity, l.unit, l.status from lots l join products p on p.id = l.product_id
      where l.storage_object_id = $1 and l.status in ('available', 'quarantine') order by p.name`, [i.entity_id])).rows;
  }
  if (i.entity_type === 'lot') {
    return (await tx.query(`select l.id, p.name as product, l.lot_no, l.quantity, l.unit, l.status from lots l join products p on p.id = l.product_id where l.id = $1`, [i.entity_id])).rows;
  }
  return [];
}

export async function getIncident(userId: string, orgId: string, id: string) {
  return inOrg(userId, orgId, 'incident.read', async (tx, m) => {
    const i = await loadIncident(tx, orgId, id);
    if (i.site_id) assertSiteAccess(m, i.site_id);
    const events = (await tx.query(`select e.at, e.event, e.note, u.full_name as who from incident_events e left join users u on u.id = e.user_id
      where e.incident_id = $1 order by e.id`, [id])).rows;
    let allowIsolation = false;
    if (i.entity_type === 'control_object') {
      allowIsolation = !!(await tx.query(`select allow_isolation from control_rules where control_object_id = $1 and status = 'approved'`, [i.entity_id])).rows[0]?.allow_isolation;
    }
    return { incident: { ...i, severity_label: SEVERITY_LABEL[i.severity], status_label: STATUS_LABEL[i.status] }, events, lots: await affectedLots(tx, i), allowIsolation };
  });
}

export async function takeIncident(userId: string, orgId: string, id: string) {
  return inOrg(userId, orgId, 'incident.work', async (tx) => {
    const i = await loadIncident(tx, orgId, id, true);
    if (i.status !== 'new') throw Errors.conflict('Отклонение уже в работе.');
    await tx.query(`update incidents set status = 'in_progress', responsible_user_id = $2 where id = $1`, [id, userId]);
    await addEvent(tx, orgId, id, userId, 'taken', 'взято в работу');
    await audit.record(tx, { organizationId: orgId, siteId: i.site_id, actorUserId: userId, action: 'incident.take', entityType: 'incident', entityId: id, before: { status: i.status }, after: { status: 'in_progress' } });
    return { ok: true };
  });
}

const ActionInput = z.object({
  note: z.string().trim().min(5, 'Опишите, что сделано.').max(2000),
  isolateLots: z.boolean().default(false),
});

/** Выполненное действие. Изоляция партий — только если её предусматривает утверждённая процедура объекта. */
export async function recordIncidentAction(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(ActionInput, input);
  return inOrg(userId, orgId, 'incident.work', async (tx) => {
    const i = await loadIncident(tx, orgId, id, true);
    if (i.status === 'closed' || i.status === 'pending_review') throw Errors.conflict('Действие уже записано.');
    let isolated: string[] = [];
    if (d.isolateLots) {
      const allowed = i.entity_type === 'control_object'
        && !!(await tx.query(`select allow_isolation from control_rules where control_object_id = $1 and status = 'approved'`, [i.entity_id])).rows[0]?.allow_isolation;
      if (!allowed) throw Errors.forbidden('Изоляция продукции не предусмотрена утверждённой процедурой для этого объекта.');
      isolated = (await tx.query(`update lots set status = 'quarantine', status_reason = $2 where storage_object_id = $1 and status = 'available' returning id`,
        [i.entity_id, `изоляция по отклонению: ${i.title}`])).rows.map((r) => r.id);
      for (const lotId of isolated) await openTask(tx, { orgId, siteId: i.site_id, kind: 'quarantine_decision', title: 'Решение по партии в карантине', details: i.title, entityType: 'lot', entityId: lotId, assigneeRole: 'haccp_lead', createdBy: userId });
    }
    const next = i.requires_confirmation ? 'pending_review' : 'closed';
    await tx.query(`update incidents set status = $2, action_note = $3, action_by = $4, action_at = now(), responsible_user_id = coalesce(responsible_user_id, $4),
      closed_at = case when $2 = 'closed' then now() else null end where id = $1`, [id, next, d.note, userId]);
    await addEvent(tx, orgId, id, userId, 'action', d.note, isolated.length ? { isolated_lots: isolated } : undefined);
    if (next === 'closed') await closeTasksFor(tx, orgId, 'incident', id, userId, d.note);
    else await notifyRoles(tx, { orgId, siteId: i.site_id, roles: ['haccp_lead', 'chef'], title: `Проверьте закрытие: ${i.title}`, body: d.note, entityType: 'incident', entityId: id });
    await audit.record(tx, { organizationId: orgId, siteId: i.site_id, actorUserId: userId, action: 'incident.action', entityType: 'incident', entityId: id,
      before: { status: i.status }, after: { status: next, note: d.note, isolated_lots: isolated } });
    return { status: next, isolated: isolated.length };
  });
}

/** Подтверждение закрытия — другим человеком, не тем, кто записал действие. */
export async function confirmIncident(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(z.object({ note: optText(1000) }), input ?? {});
  return inOrg(userId, orgId, 'incident.confirm', async (tx) => {
    const i = await loadIncident(tx, orgId, id, true);
    if (i.status !== 'pending_review') throw Errors.conflict('Подтвердить можно только отклонение, ожидающее проверки.');
    if (i.action_by === userId) throw Errors.forbidden('Закрытие подтверждает другой ответственный — не тот, кто записал действие.');
    await tx.query(`update incidents set status = 'closed', confirmed_by = $2, confirmed_at = now(), closed_at = now() where id = $1`, [id, userId]);
    await addEvent(tx, orgId, id, userId, 'confirmed', d.note || 'закрытие подтверждено');
    await closeTasksFor(tx, orgId, 'incident', id, userId, 'закрыто с подтверждением');
    await audit.record(tx, { organizationId: orgId, siteId: i.site_id, actorUserId: userId, action: 'incident.confirm', entityType: 'incident', entityId: id, before: { status: i.status }, after: { status: 'closed' } });
    return { ok: true };
  });
}

/** Возврат на доработку: проверяющий не согласен с действием. */
export async function returnIncident(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(z.object({ note: z.string().trim().min(5, 'Укажите, что нужно доделать.').max(1000) }), input);
  return inOrg(userId, orgId, 'incident.confirm', async (tx) => {
    const i = await loadIncident(tx, orgId, id, true);
    if (i.status !== 'pending_review') throw Errors.conflict('Вернуть можно только отклонение, ожидающее проверки.');
    await tx.query(`update incidents set status = 'in_progress', action_note = null, action_by = null, action_at = null where id = $1`, [id]);
    await addEvent(tx, orgId, id, userId, 'returned', d.note);
    await audit.record(tx, { organizationId: orgId, siteId: i.site_id, actorUserId: userId, action: 'incident.return', entityType: 'incident', entityId: id, before: { status: i.status }, after: { status: 'in_progress' }, reason: d.note });
    return { ok: true };
  });
}
