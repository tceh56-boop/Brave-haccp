import { z } from 'zod';
import { withSystem, withTenant, type Tx } from '../db/pool';
import { Errors } from '../http/errors';
import { audit } from '../audit/audit';
import { requirePermission } from '../access/guard';
import { ROLES, isRole, canAssignRole, type Role } from '../access/roles';
import { newToken, tokenHash } from '../security/crypto';
import { queueEmail, appUrl } from '../mail/outbox';
import type { SessionUser } from '../identity/auth';

/**
 * Организации, площадки, участники и приглашения (ТЗ v1 §4–5, v2 этап 1).
 * Каждая операция в организации: проверка права роли на сервере + Row-Level Security в базе.
 */

const INVITE_DAYS = 7;

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw Errors.validation(r.error.issues[0]?.message || 'Проверьте данные.', r.error.issues);
  return r.data;
}

const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));

export const OrgInput = z.object({
  name: z.string().trim().min(2, 'Укажите название предприятия.').max(200),
  legalForm: z.enum(['ИП', 'ООО', 'АО', 'другое']).optional(),
  inn: z.string().trim().regex(/^(\d{10}|\d{12})?$/, 'ИНН — 10 цифр (организация) или 12 (ИП).').optional().transform((v) => v || null),
  phone: optText(40),
  region: optText(120),
  timezone: z.string().trim().max(60).optional(),
  firstSiteName: z.string().trim().min(2).max(200).optional(),
});

export async function createOrganization(user: SessionUser, input: unknown) {
  // ТЗ v1 AT-01: пользователь с неподтверждённым email не становится владельцем.
  if (!user.email_verified) throw Errors.forbidden('Сначала подтвердите email — ссылка пришла в письме после регистрации.');
  const d = parse(OrgInput, input);
  return withSystem(async (tx) => {
    const org = (await tx.query(`insert into organizations (name, legal_form, inn, phone, region, timezone, created_by)
      values ($1, $2, $3, $4, $5, coalesce($6, 'Europe/Moscow'), $7) returning *`,
      [d.name, d.legalForm || null, d.inn, d.phone, d.region, d.timezone || null, user.id])).rows[0];
    await tx.query(`insert into memberships (organization_id, user_id, role) values ($1, $2, 'owner')`, [org.id, user.id]);
    const site = (await tx.query(`insert into sites (organization_id, name, timezone) values ($1, $2, $3) returning *`,
      [org.id, d.firstSiteName || 'Основная площадка', org.timezone])).rows[0];
    await audit.record(tx, { organizationId: org.id, actorUserId: user.id, action: 'org.create', entityType: 'organization', entityId: org.id, after: org });
    await audit.record(tx, { organizationId: org.id, actorUserId: user.id, action: 'member.add', entityType: 'membership', entityId: user.id, after: { role: 'owner' }, reason: 'создатель организации' });
    await audit.record(tx, { organizationId: org.id, siteId: site.id, actorUserId: user.id, action: 'site.create', entityType: 'site', entityId: site.id, after: site });
    return { organization: org, site };
  });
}

export async function listMyOrganizations(userId: string) {
  return withTenant({ userId }, async (tx) => (await tx.query(
    `select o.id, o.name, o.status, m.role from memberships m join organizations o on o.id = m.organization_id
      where m.user_id = $1 and m.status = 'active' order by o.name`, [userId])).rows.map((r) => ({ ...r, role_label: ROLES[r.role as Role]?.label || r.role })));
}

export async function getOrganization(userId: string, orgId: string) {
  return withTenant({ userId, orgId }, async (tx) => {
    const m = await requirePermission(tx, userId, orgId, 'org.read');
    const org = (await tx.query(`select * from organizations where id = $1`, [orgId])).rows[0];
    if (!org) throw Errors.notFound('Организация не найдена.');
    return { organization: org, membership: { role: m.role, role_label: ROLES[m.role as Role]?.label, site_ids: m.site_ids, permissions: ROLES[m.role as Role]?.permissions || [] } };
  });
}

const OrgPatch = OrgInput.omit({ firstSiteName: true }).partial();

export async function updateOrganization(userId: string, orgId: string, input: unknown) {
  const d = parse(OrgPatch, input);
  return withTenant({ userId, orgId }, async (tx) => {
    await requirePermission(tx, userId, orgId, 'org.update');
    const before = (await tx.query(`select * from organizations where id = $1 for update`, [orgId])).rows[0];
    const after = (await tx.query(`update organizations set name = coalesce($2, name), legal_form = coalesce($3, legal_form), inn = coalesce($4, inn),
        phone = coalesce($5, phone), region = coalesce($6, region), timezone = coalesce($7, timezone), updated_at = now()
      where id = $1 returning *`, [orgId, d.name ?? null, d.legalForm ?? null, d.inn ?? null, d.phone ?? null, d.region ?? null, d.timezone ?? null])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'org.update', entityType: 'organization', entityId: orgId, before, after });
    return after;
  });
}

// ───────────── Площадки ─────────────

const SiteInput = z.object({
  name: z.string().trim().min(2, 'Укажите название площадки.').max(200),
  address: optText(300),
  timezone: z.string().trim().max(60).optional(),
});

export async function listSites(userId: string, orgId: string) {
  return withTenant({ userId, orgId }, async (tx) => {
    const m = await requirePermission(tx, userId, orgId, 'site.read');
    const rows = (await tx.query(`select * from sites where organization_id = $1 order by status, name`, [orgId])).rows;
    return m.site_ids.length ? rows.filter((s) => m.site_ids.includes(s.id)) : rows;
  });
}

export async function createSite(userId: string, orgId: string, input: unknown) {
  const d = parse(SiteInput, input);
  return withTenant({ userId, orgId }, async (tx) => {
    await requirePermission(tx, userId, orgId, 'site.manage');
    const site = (await tx.query(`insert into sites (organization_id, name, address, timezone) values ($1, $2, $3, $4) returning *`,
      [orgId, d.name, d.address, d.timezone || null])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: site.id, actorUserId: userId, action: 'site.create', entityType: 'site', entityId: site.id, after: site });
    return site;
  });
}

export async function updateSite(userId: string, orgId: string, siteId: string, input: unknown) {
  const d = parse(SiteInput.partial().extend({ status: z.enum(['active', 'archived']).optional() }), input);
  return withTenant({ userId, orgId }, async (tx) => {
    await requirePermission(tx, userId, orgId, 'site.manage', siteId);
    const before = (await tx.query(`select * from sites where id = $1 and organization_id = $2 for update`, [siteId, orgId])).rows[0];
    if (!before) throw Errors.notFound('Площадка не найдена.');
    const after = (await tx.query(`update sites set name = coalesce($2, name), address = coalesce($3, address), timezone = coalesce($4, timezone),
      status = coalesce($5, status), updated_at = now() where id = $1 returning *`, [siteId, d.name ?? null, d.address ?? null, d.timezone ?? null, d.status ?? null])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId, actorUserId: userId, action: 'site.update', entityType: 'site', entityId: siteId, before, after });
    return after;
  });
}

// ───────────── Участники и приглашения ─────────────

async function assertSitesOfOrg(tx: Tx, orgId: string, siteIds: string[]) {
  if (!siteIds.length) return;
  const n = Number((await tx.query(`select count(*) from sites where organization_id = $1 and id = any($2::uuid[])`, [orgId, siteIds])).rows[0].count);
  if (n !== new Set(siteIds).size) throw Errors.validation('Указана площадка не из этой организации.');
}

export async function listMembers(userId: string, orgId: string) {
  return withTenant({ userId, orgId }, async (tx) => {
    await requirePermission(tx, userId, orgId, 'member.read');
    const members = (await tx.query(`select m.id, m.user_id, u.full_name, u.email, m.role, m.site_ids, m.position, m.status, m.created_at, m.blocked_at, m.blocked_reason
      from memberships m join users u on u.id = m.user_id where m.organization_id = $1 order by m.status, u.full_name`, [orgId])).rows;
    return members.map((m) => ({ ...m, role_label: ROLES[m.role as Role]?.label || m.role }));
  });
}

const InviteInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email({ message: 'Некорректный email.' })),
  fullName: optText(200),
  role: z.string().refine(isRole, 'Неизвестная роль.'),
  siteIds: z.array(z.uuid()).max(100).default([]),
  position: optText(120),
});

export async function inviteMember(userId: string, orgId: string, input: unknown) {
  const d = parse(InviteInput, input);
  const { inv, token, orgName } = await withTenant({ userId, orgId }, async (tx) => {
    const me = await requirePermission(tx, userId, orgId, 'member.invite');
    if (!canAssignRole(me.role, d.role as Role)) throw Errors.forbidden('Ваша роль не может назначать эту роль.');
    await assertSitesOfOrg(tx, orgId, d.siteIds);
    const existing = (await tx.query(`select m.status from memberships m join users u on u.id = m.user_id
      where m.organization_id = $1 and u.email = $2`, [orgId, d.email])).rows[0];
    if (existing) throw Errors.conflict(existing.status === 'active' ? 'Этот сотрудник уже в организации.' : 'Сотрудник заблокирован. Разблокируйте его вместо нового приглашения.');
    // Повторное приглашение на тот же адрес гасит прежнее.
    await tx.query(`update invitations set revoked_at = now() where organization_id = $1 and email = $2 and accepted_at is null and revoked_at is null`, [orgId, d.email]);
    const token = newToken();
    const inv = (await tx.query(`insert into invitations (organization_id, email, full_name, role, site_ids, position, token_hash, invited_by, expires_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(days => $9))
      returning id, organization_id, email, full_name, role, site_ids, position, expires_at, created_at`,
      [orgId, d.email, d.fullName, d.role, d.siteIds, d.position, tokenHash(token), userId, INVITE_DAYS])).rows[0];
    const org = (await tx.query(`select name from organizations where id = $1`, [orgId])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'member.invite', entityType: 'invitation', entityId: inv.id, after: inv });
    return { inv, token, orgName: org.name as string };
  });
  // Письмо — только после сохранения приглашения.
  await withSystemQueue(d.email, orgName, ROLES[d.role as Role].label, token);
  return inv;
}

// outbox_emails недоступна роли ceh_app — письмо кладётся системной транзакцией.
async function withSystemQueue(to: string, org: string, role: string, token: string) {
  await withSystem((tx) => queueEmail(tx, to, 'invitation', { org, role, link: `${appUrl()}/invite?token=${token}` }));
}

export async function listInvitations(userId: string, orgId: string) {
  return withTenant({ userId, orgId }, async (tx) => {
    await requirePermission(tx, userId, orgId, 'member.invite');
    return (await tx.query(`select id, email, full_name, role, site_ids, position, expires_at, created_at,
        case when accepted_at is not null then 'accepted' when revoked_at is not null then 'revoked' when expires_at < now() then 'expired' else 'pending' end as state
      from invitations where organization_id = $1 order by created_at desc limit 200`, [orgId])).rows;
  });
}

export async function revokeInvitation(userId: string, orgId: string, invitationId: string) {
  return withTenant({ userId, orgId }, async (tx) => {
    await requirePermission(tx, userId, orgId, 'member.invite');
    const inv = (await tx.query(`update invitations set revoked_at = now() where id = $1 and organization_id = $2 and accepted_at is null and revoked_at is null returning id, email`, [invitationId, orgId])).rows[0];
    if (!inv) throw Errors.notFound('Приглашение не найдено или уже закрыто.');
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'member.invite_revoke', entityType: 'invitation', entityId: inv.id, before: inv });
    return { ok: true };
  });
}

/** Принятие приглашения: только тем же email, на который оно отправлено, и только после подтверждения email. */
export async function acceptInvitation(user: SessionUser, token: unknown) {
  if (typeof token !== 'string' || !token) throw Errors.validation('Ссылка приглашения недействительна.');
  if (!user.email_verified) throw Errors.forbidden('Сначала подтвердите email, затем откройте ссылку приглашения ещё раз.');
  return withSystem(async (tx) => {
    const inv = (await tx.query(`select *, expires_at < now() as expired from invitations where token_hash = $1 for update`, [tokenHash(token)])).rows[0];
    if (!inv || inv.accepted_at || inv.revoked_at || inv.expired) throw Errors.validation('Приглашение недействительно или устарело. Попросите прислать новое.');
    if (String(inv.email).toLowerCase() !== user.email.toLowerCase()) throw Errors.forbidden('Приглашение отправлено на другой email. Войдите под тем адресом, на который пришло письмо.');
    const exists = (await tx.query(`select status from memberships where organization_id = $1 and user_id = $2`, [inv.organization_id, user.id])).rows[0];
    if (exists) throw Errors.conflict(exists.status === 'active' ? 'Вы уже состоите в этой организации.' : 'Ваш доступ к организации заблокирован.');
    await tx.query(`insert into memberships (organization_id, user_id, role, site_ids, position) values ($1, $2, $3, $4, $5)`,
      [inv.organization_id, user.id, inv.role, inv.site_ids, inv.position]);
    await tx.query(`update invitations set accepted_at = now(), accepted_by = $2 where id = $1`, [inv.id, user.id]);
    await audit.record(tx, { organizationId: inv.organization_id, actorUserId: user.id, action: 'member.add', entityType: 'membership', entityId: user.id,
      after: { role: inv.role, site_ids: inv.site_ids }, reason: `приглашение ${inv.id}` });
    return { organizationId: inv.organization_id as string };
  });
}

async function memberForChange(tx: Tx, orgId: string, memberId: string) {
  const m = (await tx.query(`select * from memberships where id = $1 and organization_id = $2 for update`, [memberId, orgId])).rows[0];
  if (!m) throw Errors.notFound('Сотрудник не найден.');
  return m;
}

async function activeOwners(tx: Tx, orgId: string): Promise<number> {
  return Number((await tx.query(`select count(*) from memberships where organization_id = $1 and role = 'owner' and status = 'active'`, [orgId])).rows[0].count);
}

const ChangeInput = z.object({
  role: z.string().refine(isRole, 'Неизвестная роль.').optional(),
  siteIds: z.array(z.uuid()).max(100).optional(),
  position: optText(120),
});

export async function changeMember(userId: string, orgId: string, memberId: string, input: unknown) {
  const d = parse(ChangeInput, input);
  return withTenant({ userId, orgId }, async (tx) => {
    const me = await requirePermission(tx, userId, orgId, 'member.manage');
    const m = await memberForChange(tx, orgId, memberId);
    if (m.user_id === userId) throw Errors.forbidden('Свою роль и площадки меняет другой ответственный.');
    if (!canAssignRole(me.role, m.role as Role)) throw Errors.forbidden('Ваша роль не может менять этого сотрудника.');
    if (d.role && !canAssignRole(me.role, d.role as Role)) throw Errors.forbidden('Ваша роль не может назначать эту роль.');
    if (d.siteIds) await assertSitesOfOrg(tx, orgId, d.siteIds);
    if (m.role === 'owner' && d.role && d.role !== 'owner' && (await activeOwners(tx, orgId)) <= 1) throw Errors.conflict('Нельзя снять последнего владельца.');
    const after = (await tx.query(`update memberships set role = coalesce($2, role), site_ids = coalesce($3, site_ids), position = coalesce($4, position)
      where id = $1 returning *`, [memberId, d.role ?? null, d.siteIds ?? null, d.position ?? null])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'member.change', entityType: 'membership', entityId: memberId,
      before: { role: m.role, site_ids: m.site_ids, position: m.position }, after: { role: after.role, site_ids: after.site_ids, position: after.position } });
    return after;
  });
}

/**
 * Блокировка (ТЗ v1 §4: при увольнении доступ блокируется, история сохраняется). Запись участия
 * не удаляется; вход в организацию закрывается сразу — проверка статуса идёт в каждом запросе.
 */
export async function setMemberBlocked(userId: string, orgId: string, memberId: string, blocked: boolean, reason?: unknown) {
  const why = typeof reason === 'string' ? reason.trim().slice(0, 300) : '';
  if (blocked && !why) throw Errors.validation('Укажите причину блокировки.');
  return withTenant({ userId, orgId }, async (tx) => {
    const me = await requirePermission(tx, userId, orgId, 'member.manage');
    const m = await memberForChange(tx, orgId, memberId);
    if (m.user_id === userId) throw Errors.forbidden('Нельзя заблокировать самого себя.');
    if (!canAssignRole(me.role, m.role as Role)) throw Errors.forbidden('Ваша роль не может менять этого сотрудника.');
    if (blocked && m.role === 'owner' && (await activeOwners(tx, orgId)) <= 1) throw Errors.conflict('Нельзя заблокировать последнего владельца.');
    const after = (await tx.query(`update memberships set status = $2, blocked_at = case when $2 = 'blocked' then now() else null end,
      blocked_reason = case when $2 = 'blocked' then $3 else null end where id = $1 returning *`, [memberId, blocked ? 'blocked' : 'active', why || null])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: blocked ? 'member.block' : 'member.unblock', entityType: 'membership', entityId: memberId,
      before: { status: m.status }, after: { status: after.status }, reason: why || undefined });
    return after;
  });
}

// ───────────── Аудит ─────────────

export async function listAudit(userId: string, orgId: string, opts: { beforeId?: number; limit?: number } = {}) {
  const limit = Math.min(Math.max(opts.limit || 50, 1), 200);
  return withTenant({ userId, orgId }, async (tx) => {
    await requirePermission(tx, userId, orgId, 'audit.read');
    return (await tx.query(`select e.id, e.created_at, e.action, e.entity_type, e.entity_id, e.result, e.reason, e.before, e.after, e.site_id, u.full_name as actor
      from audit_events e left join users u on u.id = e.actor_user_id
      where e.organization_id = $1 and ($2::bigint is null or e.id < $2) order by e.id desc limit $3`, [orgId, opts.beforeId || null, limit])).rows;
  });
}

export async function verifyAudit(userId: string, orgId: string) {
  return withTenant({ userId, orgId }, async (tx) => {
    await requirePermission(tx, userId, orgId, 'audit.read');
    return audit.verifyChain(tx, orgId);
  });
}
