import { z } from 'zod';
import { withSystem } from '../db/pool';
import { hashPassword, verifyPassword, newToken, tokenHash } from '../security/crypto';
import { Errors, AppError } from '../http/errors';
import { audit } from '../audit/audit';
import { inOrg, parse, getSite } from '../ops/common';
import { ROLES, isRole } from '../access/roles';
import type { Session } from './auth';

/**
 * Вход на кухне по PIN (перенос из версии ЦЕХ на Google Диске: выбрать себя из списка → PIN → смена).
 *  - PIN принимается только на «кухонном планшете» — устройстве, которое владелец привязал к площадке (cookie с токеном,
 *    в базе только sha256). С любого другого устройства по PIN не войти: PIN из 4–6 цифр сам по себе слабый секрет.
 *  - PIN задаёт сам сотрудник после обычного входа; руководитель может только сбросить. Хранится scrypt-хешем.
 *  - Лестница блокировок как на Диске: 5 неудач → 15 мин, следующие 5 → 1 ч, дальше → 4 ч; успешный вход сбрасывает.
 *    Плюс ограничение на устройство: не больше 30 неудач за 15 минут.
 *  - Сессия по PIN — 12 часов, только в организации планшета; отвязка планшета закрывает его сессии.
 */

export const KIOSK_COOKIE = 'ceh_kiosk';
export const KIOSK_SESSION_HOURS = 12;
const PIN_FAILS = 5;
const LOCK_LADDER_MIN = [15, 60, 240];
const DEVICE_FAILS_MAX = 30;

/** Слабые PIN не принимаются: одинаковые цифры и подряд идущие (1234, 9876). */
export function pinProblem(pin: string): string | null {
  if (!/^\d{4,6}$/.test(pin)) return 'PIN — от 4 до 6 цифр.';
  if (/^(\d)\1+$/.test(pin)) return 'PIN из одинаковых цифр слишком простой.';
  const d = [...pin].map(Number);
  const step = d[1] - d[0];
  if ((step === 1 || step === -1) && d.every((x, i) => i === 0 || x - d[i - 1] === step)) return 'PIN из цифр подряд слишком простой.';
  return null;
}

/* ───────────── Устройства (владелец) ───────────── */

const EnrollInput = z.object({ siteId: z.uuid({ message: 'Выберите площадку.' }), name: z.string().trim().min(2, 'Назовите устройство, например «Планшет горячего цеха».').max(100) });

/** Привязать текущее устройство как кухонный планшет площадки. Токен возвращается один раз и уходит в cookie устройства. */
export async function enrollDevice(userId: string, orgId: string, input: unknown) {
  const d = parse(EnrollInput, input);
  return inOrg(userId, orgId, 'device.manage', async (tx) => {
    await getSite(tx, orgId, d.siteId);
    const token = newToken();
    const dev = (await tx.query(`insert into kiosk_devices (organization_id, site_id, name, token_hash, created_by) values ($1, $2, $3, $4, $5) returning id, name, created_at`,
      [orgId, d.siteId, d.name, tokenHash(token), userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: 'device.enroll', entityType: 'kiosk_device', entityId: dev.id, after: { name: d.name } });
    return { device: dev, token };
  }, d.siteId);
}

export async function listDevices(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'device.manage', async (tx) => (await tx.query(`select k.id, k.name, k.site_id, s.name as site, k.created_at, k.last_seen_at, k.revoked_at, u.full_name as created_by_name
    from kiosk_devices k join sites s on s.id = k.site_id join users u on u.id = k.created_by where k.organization_id = $1 order by k.revoked_at nulls first, k.created_at desc`, [orgId])).rows);
}

/** Отвязать планшет: вход по PIN с него прекращается, открытые на нём сессии закрываются сразу. */
export async function revokeDevice(userId: string, orgId: string, deviceId: string) {
  // сессии планшета недействительны сразу (getSession проверяет отвязку); записи сессий закрываются системным шагом
  const d = await inOrg(userId, orgId, 'device.manage', async (tx) => {
    const r = (await tx.query(`update kiosk_devices set revoked_at = now(), revoked_by = $3 where id = $1 and organization_id = $2 and revoked_at is null returning id, site_id, name`,
      [parse(z.uuid(), deviceId), orgId, userId])).rows[0];
    if (!r) throw Errors.notFound('Устройство не найдено или уже отвязано.');
    await audit.record(tx, { organizationId: orgId, siteId: r.site_id, actorUserId: userId, action: 'device.revoke', entityType: 'kiosk_device', entityId: r.id, after: { name: r.name } });
    return r;
  });
  const n = await withSystem(async (tx) => (await tx.query(`update sessions set revoked_at = now() where kiosk_device_id = $1 and revoked_at is null`, [d.id])).rowCount);
  return { ok: true, sessions_closed: n };
}

/* ───────────── PIN сотрудника ───────────── */

/** Сотрудник задаёт свой PIN (после обычного входа по паролю). */
export async function setMyPin(userId: string, orgId: string, input: unknown) {
  const d = parse(z.object({ pin: z.string().trim() }), input);
  const problem = pinProblem(d.pin);
  if (problem) throw Errors.validation(problem);
  const hash = await hashPassword(d.pin);
  return inOrg(userId, orgId, 'org.read', async (tx) => {
    await tx.query(`insert into member_pins (organization_id, user_id, pin_hash) values ($1, $2, $3)
      on conflict (organization_id, user_id) do update set pin_hash = excluded.pin_hash, failed = 0, lock_level = 0, locked_until = null, set_at = now()`, [orgId, userId, hash]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'pin.set', entityType: 'user', entityId: userId });
    return { ok: true };
  });
}

export async function myPinState(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'org.read', async (tx) => {
    const p = (await tx.query(`select set_at, locked_until > now() as locked from member_pins where organization_id = $1 and user_id = $2`, [orgId, userId])).rows[0];
    return { has_pin: !!p, set_at: p?.set_at || null, locked: !!p?.locked };
  });
}

/** Руководитель сбрасывает PIN сотрудника (забыл, или подозрение, что PIN узнали). Задать чужой PIN нельзя. */
export async function resetPin(userId: string, orgId: string, targetUserId: string) {
  await inOrg(userId, orgId, 'member.manage', async (tx) => {
    const r = (await tx.query(`delete from member_pins where organization_id = $1 and user_id = $2 returning user_id`, [orgId, parse(z.uuid(), targetUserId)])).rows[0];
    if (!r) throw Errors.notFound('У сотрудника нет PIN.');
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'pin.reset', entityType: 'user', entityId: targetUserId });
  });
  await withSystem((tx) => tx.query(`update sessions set revoked_at = now() where user_id = $1 and organization_id = $2 and kiosk_device_id is not null and revoked_at is null`, [targetUserId, orgId]));
  return { ok: true };
}

/* ───────────── Вход на планшете ───────────── */

async function deviceOf(tx: Parameters<Parameters<typeof withSystem>[0]>[0], token: string | null | undefined) {
  if (!token) return null;
  return (await tx.query(`select k.id, k.organization_id, k.site_id, k.name, o.name as org_name, s.name as site_name from kiosk_devices k
    join organizations o on o.id = k.organization_id join sites s on s.id = k.site_id where k.token_hash = $1 and k.revoked_at is null`, [tokenHash(token)])).rows[0] || null;
}

/** Список для экрана планшета: сотрудники площадки с заданным PIN. Без cookie устройства — ничего. */
export async function kioskRoster(token: string | null | undefined) {
  return withSystem(async (tx) => {
    const dev = await deviceOf(tx, token);
    if (!dev) return { device: null, people: [] };
    await tx.query(`update kiosk_devices set last_seen_at = now() where id = $1 and (last_seen_at is null or last_seen_at < now() - interval '5 minutes')`, [dev.id]);
    const people = (await tx.query(`select u.id, u.full_name, m.role, p.locked_until > now() as locked from member_pins p
        join memberships m on m.organization_id = p.organization_id and m.user_id = p.user_id join users u on u.id = p.user_id
      where p.organization_id = $1 and m.status = 'active' and u.status = 'active' and (cardinality(m.site_ids) = 0 or $2 = any(m.site_ids)) order by u.full_name`,
    [dev.organization_id, dev.site_id])).rows.map((r) => ({ id: r.id, full_name: r.full_name, role_label: isRole(r.role as unknown) ? ROLES[r.role as keyof typeof ROLES].label : String(r.role), locked: !!r.locked }));
    return { device: { name: dev.name, organization: dev.org_name, site: dev.site_name, organization_id: dev.organization_id, site_id: dev.site_id }, people };
  });
}

const BAD_PIN = 'Неверный PIN.';

export async function kioskLogin(token: string | null | undefined, input: unknown, meta: { ip?: string | null; userAgent?: string | null }): Promise<{ token: string; session: Session; orgId: string; siteId: string }> {
  const d = parse(z.object({ userId: z.uuid(), pin: z.string().trim().max(12) }), input);
  const outcome = await withSystem(async (tx): Promise<{ error: AppError } | { token: string; session: Session; orgId: string; siteId: string }> => {
    const dev = await deviceOf(tx, token);
    if (!dev) return { error: Errors.forbidden('Вход по PIN — только на кухонном планшете, привязанном владельцем.') };
    const devFails = Number((await tx.query(`select count(*) from login_attempts where email = $1 and not success and created_at > now() - interval '15 minutes'`, [`kiosk:${dev.id}`])).rows[0].count);
    if (devFails >= DEVICE_FAILS_MAX) return { error: Errors.tooMany('Слишком много неудачных попыток на этом планшете. Повторите через 15 минут.') };
    const p = (await tx.query(`select p.*, p.locked_until > now() as locked, u.full_name, u.email, u.email_verified_at, u.status as user_status, m.status as m_status, m.site_ids
      from member_pins p join users u on u.id = p.user_id join memberships m on m.organization_id = p.organization_id and m.user_id = p.user_id
      where p.organization_id = $1 and p.user_id = $2 for update of p`, [dev.organization_id, d.userId])).rows[0];
    const allowed = p && p.user_status === 'active' && p.m_status === 'active' && (!p.site_ids.length || p.site_ids.includes(dev.site_id));
    const fail = async (reason: string, message = BAD_PIN) => {
      await tx.query(`insert into login_attempts (ip, email, success) values ($1, $2, false)`, [meta.ip || 'unknown', `kiosk:${dev.id}`]);
      await audit.record(tx, { organizationId: dev.organization_id, siteId: dev.site_id, actorUserId: allowed ? d.userId : null, action: 'user.login_pin', entityType: 'kiosk_device', entityId: dev.id, result: 'denied', reason, ip: meta.ip });
      return { error: Errors.validation(message) };
    };
    if (!allowed) { await verifyPassword(d.pin, 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$' + 'A'.repeat(86)); return fail('нет PIN или нет доступа к площадке'); }
    if (p.locked) return fail('PIN временно заблокирован', `Вход по PIN заблокирован до ${new Date(p.locked_until).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} — слишком много ошибок. Войдите по паролю или попросите руководителя сбросить PIN.`);
    const ok = await verifyPassword(d.pin, p.pin_hash);
    if (!ok) {
      const n = p.failed + 1;
      if (n >= PIN_FAILS) {
        const mins = LOCK_LADDER_MIN[Math.min(p.lock_level, LOCK_LADDER_MIN.length - 1)];
        await tx.query(`update member_pins set failed = 0, lock_level = lock_level + 1, locked_until = now() + make_interval(mins => $3) where organization_id = $1 and user_id = $2`, [dev.organization_id, d.userId, mins]);
        return fail('неверный PIN — блокировка', `Неверный PIN. Вход по PIN заблокирован на ${mins >= 60 ? `${mins / 60} ч` : `${mins} мин`}.`);
      }
      await tx.query(`update member_pins set failed = $3 where organization_id = $1 and user_id = $2`, [dev.organization_id, d.userId, n]);
      return fail('неверный PIN', `${BAD_PIN} Осталось попыток: ${PIN_FAILS - n}.`);
    }
    await tx.query(`update member_pins set failed = 0, lock_level = 0, locked_until = null where organization_id = $1 and user_id = $2`, [dev.organization_id, d.userId]);
    await tx.query(`insert into login_attempts (ip, email, success) values ($1, $2, true)`, [meta.ip || 'unknown', `kiosk:${dev.id}`]);
    const sessionToken = newToken();
    const s = (await tx.query(`insert into sessions (user_id, token_hash, ip, user_agent, expires_at, organization_id, kiosk_device_id)
      values ($1, $2, $3, $4, now() + make_interval(hours => $5), $6, $7) returning id`,
    [d.userId, tokenHash(sessionToken), meta.ip, (meta.userAgent || '').slice(0, 300), KIOSK_SESSION_HOURS, dev.organization_id, dev.id])).rows[0];
    await audit.record(tx, { organizationId: dev.organization_id, siteId: dev.site_id, actorUserId: d.userId, action: 'user.login_pin', entityType: 'kiosk_device', entityId: dev.id, ip: meta.ip });
    return { token: sessionToken, orgId: dev.organization_id, siteId: dev.site_id,
      session: { sessionId: s.id, orgScope: dev.organization_id, user: { id: d.userId, email: p.email, full_name: p.full_name, email_verified: !!p.email_verified_at } } };
  });
  if ('error' in outcome) throw outcome.error;
  return outcome;
}
