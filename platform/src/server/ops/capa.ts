import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText, openTask, closeTasksFor, notifyRoles, assertSiteAccess, getSite } from './common';

/**
 * CAPA — корректирующие и предупреждающие действия (ТЗ v1 §10, ТЗ v2 §12): отклонение → причина → действия →
 * исполнение → проверка эффективности другим человеком по заранее заданному критерию. Неэффективное CAPA
 * возвращается в работу; закрыть без проверки нельзя (ограничение в базе). История событий неизменяема.
 */

export const CAPA_STATUS: Record<string, string> = { open: 'Открыто', in_progress: 'В работе', verification: 'Проверка эффективности', closed: 'Закрыто' };

async function addEvent(tx: Tx, orgId: string, capaId: string, userId: string | null, event: string, note?: string | null) {
  await tx.query(`insert into capa_events (organization_id, capa_id, user_id, event, note) values ($1, $2, $3, $4, $5)`, [orgId, capaId, userId, event, note || null]);
}

async function load(tx: Tx, orgId: string, id: string, lock = false) {
  const c = (await tx.query(`select * from capas where id = $1 and organization_id = $2 ${lock ? 'for update' : ''}`, [id, orgId])).rows[0];
  if (!c) throw Errors.notFound('CAPA не найдено.');
  return c;
}

/** CAPA по отклонению (одно на отклонение) — вызывается внутри транзакции. */
export async function capaForIncident(tx: Tx, orgId: string, incidentId: string, userId: string | null): Promise<{ id: string; created: boolean }> {
  const ex = (await tx.query(`select id from capas where incident_id = $1`, [incidentId])).rows[0];
  if (ex) return { id: ex.id, created: false };
  const i = (await tx.query(`select * from incidents where id = $1 and organization_id = $2`, [incidentId, orgId])).rows[0];
  if (!i) throw Errors.notFound('Отклонение не найдено.');
  const c = (await tx.query(`insert into capas (organization_id, site_id, incident_id, title, problem, created_by) values ($1, $2, $3, $4, $5, $6) returning *`,
    [orgId, i.site_id, incidentId, `CAPA: ${i.title}`, [i.what, i.action_note ? `Сделано по отклонению: ${i.action_note}` : ''].filter(Boolean).join('\n'), userId])).rows[0];
  await addEvent(tx, orgId, c.id, userId, 'created', `по отклонению «${i.title}»`);
  await openTask(tx, { orgId, siteId: i.site_id, kind: 'capa', title: `CAPA: установить причину и действия — ${i.title}`, entityType: 'capa', entityId: c.id,
    assigneeRole: 'haccp_lead', dueAt: new Date(Date.now() + 3 * 86400e3), createdBy: userId });
  await notifyRoles(tx, { orgId, siteId: i.site_id, roles: ['haccp_lead'], title: `Открыто CAPA: ${i.title}`, entityType: 'capa', entityId: c.id });
  await audit.record(tx, { organizationId: orgId, siteId: i.site_id, actorUserId: userId, action: 'capa.create', entityType: 'capa', entityId: c.id, after: { incident_id: incidentId, title: c.title } });
  return { id: c.id, created: true };
}

const CreateInput = z.object({
  incidentId: z.uuid().optional(),
  siteId: z.uuid().nullable().optional(),
  title: z.string().trim().min(5, 'Короткое название.').max(200).optional(),
  problem: z.string().trim().min(10, 'Опишите проблему.').max(4000).optional(),
});

export async function createCapa(userId: string, orgId: string, input: unknown) {
  const d = parse(CreateInput, input);
  return inOrg(userId, orgId, 'capa.manage', async (tx, m) => {
    if (d.incidentId) {
      const i = (await tx.query(`select site_id from incidents where id = $1 and organization_id = $2`, [d.incidentId, orgId])).rows[0];
      if (!i) throw Errors.notFound('Отклонение не найдено.');
      if (i.site_id) assertSiteAccess(m, i.site_id);
      return capaForIncident(tx, orgId, d.incidentId, userId);
    }
    if (!d.title || !d.problem) throw Errors.validation('Укажите название и описание проблемы.');
    if (d.siteId) { await getSite(tx, orgId, d.siteId); assertSiteAccess(m, d.siteId); }
    const c = (await tx.query(`insert into capas (organization_id, site_id, title, problem, created_by) values ($1, $2, $3, $4, $5) returning id`, [orgId, d.siteId || null, d.title, d.problem, userId])).rows[0];
    await addEvent(tx, orgId, c.id, userId, 'created', null);
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: 'capa.create', entityType: 'capa', entityId: c.id, after: d });
    return { id: c.id, created: true };
  });
}

const date = z.iso.date().nullable().optional();
const UpdateInput = z.object({
  risk: optText(1000), rootCause: optText(4000), correctiveAction: optText(4000), preventiveAction: optText(4000),
  effectivenessCriterion: optText(1000), responsibleUserId: z.uuid().nullable().optional(), dueAt: date, checkDueAt: date,
});

export async function updateCapa(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(UpdateInput, input);
  return inOrg(userId, orgId, 'capa.manage', async (tx, m) => {
    const c = await load(tx, orgId, id, true);
    if (c.site_id) assertSiteAccess(m, c.site_id);
    if (c.status === 'verification' || c.status === 'closed') throw Errors.conflict('CAPA на проверке или закрыто — изменения не вносятся.');
    if (d.responsibleUserId && !(await tx.query(`select 1 from memberships where organization_id = $1 and user_id = $2 and status = 'active'`, [orgId, d.responsibleUserId])).rowCount) {
      throw Errors.validation('Ответственный — не сотрудник организации.');
    }
    if (d.dueAt && d.checkDueAt && d.checkDueAt < d.dueAt) throw Errors.validation('Проверка эффективности — не раньше срока выполнения.');
    await tx.query(`update capas set risk = $2, root_cause = $3, corrective_action = $4, preventive_action = $5, effectiveness_criterion = $6,
        responsible_user_id = $7, due_at = $8, check_due_at = $9, status = 'in_progress' where id = $1`,
      [id, d.risk, d.rootCause, d.correctiveAction, d.preventiveAction, d.effectivenessCriterion, d.responsibleUserId || null, d.dueAt || null, d.checkDueAt || null]);
    if (d.responsibleUserId) {
      await tx.query(`update tasks set assignee_user_id = $3, due_at = coalesce($4::date::timestamptz, due_at) where organization_id = $1 and kind = 'capa' and entity_id = $2 and status = 'open'`,
        [orgId, id, d.responsibleUserId, d.dueAt || null]);
    }
    await addEvent(tx, orgId, id, userId, 'updated', null);
    await audit.record(tx, { organizationId: orgId, siteId: c.site_id, actorUserId: userId, action: 'capa.update', entityType: 'capa', entityId: id,
      before: { root_cause: c.root_cause, corrective_action: c.corrective_action, preventive_action: c.preventive_action, effectiveness_criterion: c.effectiveness_criterion, status: c.status }, after: d });
    return { ok: true };
  });
}

/** Действия выполнены → на проверку эффективности (другим человеком, к дате проверки). */
export async function completeCapa(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(z.object({ note: z.string().trim().min(5, 'Опишите, что выполнено.').max(2000) }), input);
  return inOrg(userId, orgId, 'capa.manage', async (tx, m) => {
    const c = await load(tx, orgId, id, true);
    if (c.site_id) assertSiteAccess(m, c.site_id);
    if (c.status !== 'open' && c.status !== 'in_progress') throw Errors.conflict('CAPA уже на проверке или закрыто.');
    const missing = [!c.root_cause && 'причина', !c.corrective_action && 'корректирующее действие', !c.effectiveness_criterion && 'критерий эффективности'].filter(Boolean);
    if (missing.length) throw Errors.validation(`Сначала заполните: ${missing.join(', ')}.`);
    await tx.query(`update capas set status = 'verification', done_note = $2, done_by = $3, done_at = now() where id = $1`, [id, d.note, userId]);
    await addEvent(tx, orgId, id, userId, 'done', d.note);
    await closeTasksFor(tx, orgId, 'capa', id, userId, d.note);
    await openTask(tx, { orgId, siteId: c.site_id, kind: 'capa_verify', title: `Проверить эффективность: ${c.title}`, details: `Критерий: ${c.effectiveness_criterion}`, entityType: 'capa', entityId: id,
      assigneeRole: 'haccp_lead', dueAt: c.check_due_at ? new Date(c.check_due_at) : new Date(Date.now() + 7 * 86400e3), createdBy: userId });
    await audit.record(tx, { organizationId: orgId, siteId: c.site_id, actorUserId: userId, action: 'capa.done', entityType: 'capa', entityId: id, before: { status: c.status }, after: { status: 'verification', note: d.note } });
    return { status: 'verification' };
  });
}

/** Проверка эффективности: не тот, кто выполнял. Неэффективно — обратно в работу с выводом. */
export async function verifyCapa(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(z.object({ effective: z.boolean(), note: z.string().trim().min(5, 'Опишите, что проверено и чем подтверждено.').max(2000) }), input);
  return inOrg(userId, orgId, 'capa.verify', async (tx, m) => {
    const c = await load(tx, orgId, id, true);
    if (c.site_id) assertSiteAccess(m, c.site_id);
    if (c.status !== 'verification') throw Errors.conflict('CAPA не ожидает проверки эффективности.');
    if (c.done_by === userId) throw Errors.forbidden('Эффективность проверяет другой ответственный — не тот, кто выполнял действия.');
    if (d.effective) {
      await tx.query(`update capas set status = 'closed', verified_by = $2, verified_at = now(), verification_note = $3 where id = $1`, [id, userId, d.note]);
      await addEvent(tx, orgId, id, userId, 'effective', d.note);
      await closeTasksFor(tx, orgId, 'capa_verify', id, userId, `эффективно: ${d.note}`);
    } else {
      await tx.query(`update capas set status = 'in_progress', verification_note = $2 where id = $1`, [id, d.note]);
      await addEvent(tx, orgId, id, userId, 'ineffective', d.note);
      await closeTasksFor(tx, orgId, 'capa_verify', id, userId, `неэффективно: ${d.note}`);
      await openTask(tx, { orgId, siteId: c.site_id, kind: 'capa', title: `CAPA неэффективно — пересмотреть причину и действия: ${c.title}`, details: d.note, entityType: 'capa', entityId: id,
        assigneeRole: 'haccp_lead', assigneeUserId: c.responsible_user_id, dueAt: new Date(Date.now() + 3 * 86400e3), createdBy: userId });
    }
    await audit.record(tx, { organizationId: orgId, siteId: c.site_id, actorUserId: userId, action: 'capa.verify', entityType: 'capa', entityId: id,
      before: { status: c.status }, after: { effective: d.effective, status: d.effective ? 'closed' : 'in_progress' }, reason: d.note });
    return { status: d.effective ? 'closed' : 'in_progress' };
  });
}

export async function listCapas(userId: string, orgId: string, opts: { open?: boolean } = {}) {
  return inOrg(userId, orgId, 'capa.read', async (tx, m) => (await tx.query(`select c.id, c.title, c.status, c.due_at, c.check_due_at, c.created_at, c.site_id, c.incident_id,
      s.name as site_name, u.full_name as responsible
    from capas c left join sites s on s.id = c.site_id left join users u on u.id = c.responsible_user_id
    where c.organization_id = $1 and ($2::boolean is false or c.status <> 'closed') order by (c.status = 'closed'), c.created_at desc limit 200`, [orgId, !!opts.open])).rows
    .filter((c) => !c.site_id || !m.site_ids.length || m.site_ids.includes(c.site_id))
    .map((c) => ({ ...c, status_label: CAPA_STATUS[c.status], overdue: ['open', 'in_progress'].includes(c.status) && !!c.due_at && new Date(c.due_at) < new Date(new Date().toDateString()) })));
}

export async function getCapa(userId: string, orgId: string, id: string) {
  return inOrg(userId, orgId, 'capa.read', async (tx, m) => {
    const c = (await tx.query(`select c.*, s.name as site_name, ru.full_name as responsible, du.full_name as done_by_name, vu.full_name as verified_by_name, i.title as incident_title, i.status as incident_status
      from capas c left join sites s on s.id = c.site_id left join users ru on ru.id = c.responsible_user_id left join users du on du.id = c.done_by left join users vu on vu.id = c.verified_by
      left join incidents i on i.id = c.incident_id where c.id = $1 and c.organization_id = $2`, [id, orgId])).rows[0];
    if (!c) throw Errors.notFound('CAPA не найдено.');
    if (c.site_id) assertSiteAccess(m, c.site_id);
    const events = (await tx.query(`select e.at, e.event, e.note, u.full_name as who from capa_events e left join users u on u.id = e.user_id where e.capa_id = $1 order by e.id`, [id])).rows;
    const members = (await tx.query(`select u.id, u.full_name from memberships ms join users u on u.id = ms.user_id where ms.organization_id = $1 and ms.status = 'active' order by u.full_name`, [orgId])).rows;
    return { capa: { ...c, status_label: CAPA_STATUS[c.status] }, events, members };
  });
}
