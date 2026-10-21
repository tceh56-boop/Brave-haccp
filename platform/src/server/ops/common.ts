import { z } from 'zod';
import { withTenant, type Tx } from '../db/pool';
import { requirePermission, type Membership } from '../access/guard';
import type { Permission } from '../access/roles';
import { Errors } from '../http/errors';
import { admissionGate } from '../access/admission';

/** Операция в организации: контекст изоляции + проверка права (и площадки, если она известна заранее). */
export function inOrg<T>(userId: string, orgId: string, permission: Permission, fn: (tx: Tx, m: Membership) => Promise<T>, siteId?: string | null): Promise<T> {
  return withTenant({ userId, orgId }, async (tx) => {
    const m = await requirePermission(tx, userId, orgId, permission, siteId);
    await admissionGate(tx, m, permission);                // допуск к работе с продукцией (этап 16)
    return fn(tx, m);
  });
}

/** Площадка внутри области доступа участника (site_ids пусто — все площадки). */
export function assertSiteAccess(m: Membership, siteId: string) {
  if (m.site_ids.length && !m.site_ids.includes(siteId)) throw Errors.forbidden('Нет доступа к этой площадке.');
}

export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw Errors.validation(r.error.issues[0]?.message || 'Проверьте данные.', r.error.issues);
  return r.data;
}

export const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

export async function getSite(tx: Tx, orgId: string, siteId: string) {
  const s = (await tx.query(`select id, name, status from sites where id = $1 and organization_id = $2`, [siteId, orgId])).rows[0];
  if (!s) throw Errors.notFound('Площадка не найдена.');
  return s as { id: string; name: string; status: string };
}

export interface NewTask {
  orgId: string; siteId?: string | null; kind: string; title: string; details?: string | null;
  entityType?: string; entityId?: string; assigneeRole?: string | null; assigneeUserId?: string | null; dueAt?: Date | null; createdBy?: string | null;
}

/** Задача без дублей: одна открытая задача одного вида на объект. */
export async function openTask(tx: Tx, t: NewTask): Promise<string | null> {
  const r = await tx.query(`insert into tasks (organization_id, site_id, kind, title, details, entity_type, entity_id, assignee_role, assignee_user_id, due_at, created_by)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    on conflict (organization_id, kind, entity_id) where status = 'open' and entity_id is not null do nothing returning id`,
    [t.orgId, t.siteId || null, t.kind, t.title, t.details || null, t.entityType || null, t.entityId || null, t.assigneeRole || null, t.assigneeUserId || null, t.dueAt || null, t.createdBy || null]);
  return r.rows[0]?.id || null;
}

export async function closeTasksFor(tx: Tx, orgId: string, kind: string, entityId: string, userId: string, result: string) {
  await tx.query(`update tasks set status = 'done', done_by = $4, done_at = now(), result = $5
    where organization_id = $1 and kind = $2 and entity_id = $3 and status = 'open'`, [orgId, kind, entityId, userId, result]);
}

/** Уведомление ролям (лента в приложении; доставка по email/Telegram подключается каналами). */
export async function notifyRoles(tx: Tx, n: { orgId: string; siteId?: string | null; roles: string[]; title: string; body?: string; entityType?: string; entityId?: string }) {
  for (const role of n.roles) {
    await tx.query(`insert into notifications (organization_id, site_id, role, title, body, entity_type, entity_id) values ($1, $2, $3, $4, $5, $6, $7)`,
      [n.orgId, n.siteId || null, role, n.title, n.body || null, n.entityType || null, n.entityId || null]);
  }
}

export function fmtNum(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  return String(Number(v)).replace('.', ',');
}
