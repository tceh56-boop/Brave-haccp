import { z } from 'zod';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse } from './common';

/**
 * Задачи смены. Задачи, которые закрываются только действием над объектом (подтвердить срок, решить по
 * карантину, разобрать отклонение), вручную не закрываются — кнопка ведёт к объекту и нужному действию.
 */

const SPECIAL: Record<string, string> = {
  confirm_expiry: 'Задача закроется, когда будет подтверждён срок партии.',
  quarantine_decision: 'Задача закроется после решения по карантину.',
  incident: 'Задача закроется вместе с отклонением.',
};

export function taskHref(orgId: string, t: { kind: string; entity_type: string | null; entity_id: string | null; id: string }) {
  if (t.entity_type === 'lot' && t.entity_id) return `/app/${orgId}/lots/${t.entity_id}`;
  if (t.entity_type === 'incident' && t.entity_id) return `/app/${orgId}/incidents/${t.entity_id}`;
  if (t.entity_type === 'control_object' && t.entity_id) return `/app/${orgId}/objects/${t.entity_id}`;
  return `/app/${orgId}/tasks#${t.id}`;
}

const ACTION: Record<string, string> = { confirm_expiry: 'Подтвердить срок', quarantine_decision: 'Решить по карантину', incident: 'Открыть отклонение' };

export async function listTasks(userId: string, orgId: string, opts: { siteId?: string | null; all?: boolean } = {}) {
  return inOrg(userId, orgId, 'task.read', async (tx, m) => {
    const seeAll = opts.all && ['owner', 'enterprise_admin', 'director', 'chef', 'haccp_lead'].includes(m.role);
    const rows = (await tx.query(`select t.*, s.name as site_name from tasks t left join sites s on s.id = t.site_id
      where t.organization_id = $1 and t.status = 'open' and ($2::uuid is null or t.site_id = $2)
        and ($3::boolean or t.assignee_user_id = $4 or t.assignee_role = $5 or $5 in ('owner', 'enterprise_admin'))
      order by t.due_at nulls last, t.created_at`, [orgId, opts.siteId || null, !!seeAll, userId, m.role])).rows;
    const now = Date.now();
    return rows.filter((t) => !t.site_id || !m.site_ids.length || m.site_ids.includes(t.site_id)).map((t) => ({
      ...t, overdue: !!t.due_at && new Date(t.due_at).getTime() < now, href: taskHref(orgId, t), action: ACTION[t.kind] || 'Выполнить', manual: !SPECIAL[t.kind],
    }));
  });
}

export async function completeTask(userId: string, orgId: string, taskId: string, input: unknown) {
  const d = parse(z.object({ result: z.string().trim().min(2, 'Опишите результат.').max(1000) }), input);
  return inOrg(userId, orgId, 'task.work', async (tx, m) => {
    const t = (await tx.query(`select * from tasks where id = $1 and organization_id = $2 for update`, [taskId, orgId])).rows[0];
    if (!t) throw Errors.notFound('Задача не найдена.');
    if (t.site_id && m.site_ids.length && !m.site_ids.includes(t.site_id)) throw Errors.forbidden('Нет доступа к этой площадке.');
    if (t.status !== 'open') throw Errors.conflict('Задача уже закрыта.');
    if (SPECIAL[t.kind]) throw Errors.conflict(SPECIAL[t.kind]);
    await tx.query(`update tasks set status = 'done', done_by = $2, done_at = now(), result = $3 where id = $1`, [taskId, userId, d.result]);
    await audit.record(tx, { organizationId: orgId, siteId: t.site_id, actorUserId: userId, action: 'task.complete', entityType: 'task', entityId: taskId, after: { result: d.result } });
    return { ok: true };
  });
}
