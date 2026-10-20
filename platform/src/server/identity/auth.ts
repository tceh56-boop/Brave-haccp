import { z } from 'zod';
import { withSystem, type Tx } from '../db/pool';
import { hashPassword, verifyPassword, newToken, tokenHash, passwordProblem } from '../security/crypto';
import { Errors, AppError } from '../http/errors';
import { audit } from '../audit/audit';
import { queueEmail, appUrl } from '../mail/outbox';

/**
 * Учётные записи (ТЗ v1 §5, v2 §9): регистрация по email с подтверждением, вход, выход,
 * восстановление пароля. Ответы на регистрацию и восстановление одинаковы для существующего
 * и нового адреса — по ним нельзя узнать, зарегистрирован ли человек.
 */

export const SESSION_DAYS = 14;
const VERIFY_HOURS = 48;
const RESET_MINUTES = 60;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const IP_FAILS_WINDOW_MIN = 15;
const IP_FAILS_MAX = 20;

const email = z.string().trim().toLowerCase().max(254).pipe(z.email({ message: 'Некорректный email.' }));

export const RegisterInput = z.object({
  email,
  password: z.string().max(200),
  fullName: z.string().trim().min(2, 'Укажите имя и фамилию.').max(200),
});

export interface SessionUser {
  id: string;
  email: string;
  full_name: string;
  email_verified: boolean;
}

export interface Session { sessionId: string; user: SessionUser }

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw Errors.validation(r.error.issues[0]?.message || 'Проверьте данные.', r.error.issues);
  return r.data;
}

async function issueEmailToken(tx: Tx, userId: string, purpose: 'verify_email' | 'reset_password', minutes: number): Promise<string> {
  // Новая ссылка гасит прежние неиспользованные ссылки того же назначения.
  await tx.query(`update email_tokens set used_at = now() where user_id = $1 and purpose = $2 and used_at is null`, [userId, purpose]);
  const token = newToken();
  await tx.query(`insert into email_tokens (user_id, purpose, token_hash, expires_at) values ($1, $2, $3, now() + make_interval(mins => $4))`,
    [userId, purpose, tokenHash(token), minutes]);
  return token;
}

export async function register(input: unknown, ip?: string | null): Promise<{ ok: true }> {
  const data = parse(RegisterInput, input);
  const problem = passwordProblem(data.password);
  if (problem) throw Errors.validation(problem);
  const hash = await hashPassword(data.password);
  await withSystem(async (tx) => {
    const existing = (await tx.query(`select id, full_name, email_verified_at from users where email = $1`, [data.email])).rows[0];
    if (existing) {
      if (existing.email_verified_at) {
        await queueEmail(tx, data.email, 'already_registered', { name: existing.full_name, link: `${appUrl()}/login` });
      } else {
        const token = await issueEmailToken(tx, existing.id, 'verify_email', VERIFY_HOURS * 60);
        await queueEmail(tx, data.email, 'verify_email', { name: existing.full_name, link: `${appUrl()}/verify?token=${token}` });
      }
      return;
    }
    const user = (await tx.query(`insert into users (email, full_name, password_hash) values ($1, $2, $3) returning id`,
      [data.email, data.fullName, hash])).rows[0];
    const token = await issueEmailToken(tx, user.id, 'verify_email', VERIFY_HOURS * 60);
    await queueEmail(tx, data.email, 'verify_email', { name: data.fullName, link: `${appUrl()}/verify?token=${token}` });
    await audit.record(tx, { actorUserId: user.id, action: 'user.register', entityType: 'user', entityId: user.id, after: { email: data.email, full_name: data.fullName }, ip });
  });
  return { ok: true };
}

export async function verifyEmail(token: unknown): Promise<{ ok: true }> {
  if (typeof token !== 'string' || !token) throw Errors.validation('Ссылка подтверждения недействительна.');
  return withSystem(async (tx) => {
    const t = (await tx.query(`select id, user_id, expires_at < now() as expired, used_at from email_tokens
      where token_hash = $1 and purpose = 'verify_email' for update`, [tokenHash(token)])).rows[0];
    if (!t || t.used_at || t.expired) throw Errors.validation('Ссылка подтверждения недействительна или устарела. Запросите новую.');
    await tx.query(`update email_tokens set used_at = now() where id = $1`, [t.id]);
    await tx.query(`update users set email_verified_at = coalesce(email_verified_at, now()), updated_at = now() where id = $1`, [t.user_id]);
    await audit.record(tx, { actorUserId: t.user_id, action: 'user.verify_email', entityType: 'user', entityId: t.user_id });
    return { ok: true as const };
  });
}

export async function resendVerification(userId: string): Promise<{ ok: true }> {
  await withSystem(async (tx) => {
    const u = (await tx.query(`select email, full_name, email_verified_at from users where id = $1`, [userId])).rows[0];
    if (!u || u.email_verified_at) return;
    const token = await issueEmailToken(tx, userId, 'verify_email', VERIFY_HOURS * 60);
    await queueEmail(tx, u.email, 'verify_email', { name: u.full_name, link: `${appUrl()}/verify?token=${token}` });
  });
  return { ok: true };
}

const LoginInput = z.object({ email, password: z.string().min(1, 'Введите пароль.').max(200) });

const BAD_LOGIN = 'Неверный email или пароль.';
const LOCKED_LOGIN = 'Вход временно заблокирован после нескольких неудачных попыток. Повторите через 15 минут или восстановите пароль.';
// Хеш-заглушка с теми же параметрами, что и настоящие: проверка занимает столько же времени.
const DUMMY_HASH = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$' + 'A'.repeat(86);

export async function login(input: unknown, meta: { ip?: string | null; userAgent?: string | null }): Promise<{ token: string; session: Session }> {
  const data = parse(LoginInput, input);
  const ip = meta.ip || 'unknown';
  // Неудачная попытка должна сохраниться (счётчик, блокировка, аудит), поэтому транзакция
  // завершается коммитом и в случае отказа, а ошибка выбрасывается уже после неё.
  const outcome = await withSystem(async (tx): Promise<{ error: AppError } | { token: string; session: Session }> => {
    const ipFails = Number((await tx.query(`select count(*) from login_attempts where ip = $1 and not success
      and created_at > now() - make_interval(mins => $2)`, [ip, IP_FAILS_WINDOW_MIN])).rows[0].count);
    if (ipFails >= IP_FAILS_MAX) return { error: Errors.tooMany('Слишком много неудачных попыток входа. Повторите через 15 минут.') };

    const u = (await tx.query(`select id, email, full_name, password_hash, email_verified_at, status, failed_logins,
      coalesce(locked_until > now(), false) as locked from users where email = $1 for update`, [data.email])).rows[0];
    // Пароль проверяется и для несуществующего адреса — время ответа не выдаёт, есть ли учётная запись.
    const ok = await verifyPassword(data.password, u ? u.password_hash : DUMMY_HASH);
    const fail = async (reason: string, message = BAD_LOGIN) => {
      await tx.query(`insert into login_attempts (ip, email, success) values ($1, $2, false)`, [ip, data.email]);
      if (u) await audit.record(tx, { actorUserId: u.id, action: 'user.login', entityType: 'user', entityId: u.id, result: 'denied', reason, ip });
      return { error: Errors.validation(message) };
    };
    if (u && u.locked) return fail('вход временно заблокирован', LOCKED_LOGIN);
    if (!u || !ok || u.status !== 'active') {
      if (u && !ok) {
        const n = u.failed_logins + 1;
        await tx.query(`update users set failed_logins = $2::int, locked_until = case when $2::int >= $3::int then now() + make_interval(mins => $4::int) else locked_until end where id = $1`,
          [u.id, n, MAX_FAILED, LOCK_MINUTES]);
      }
      return fail(!u ? 'нет учётной записи' : !ok ? 'неверный пароль' : 'учётная запись отключена');
    }
    await tx.query(`update users set failed_logins = 0, locked_until = null where id = $1`, [u.id]);
    await tx.query(`insert into login_attempts (ip, email, success) values ($1, $2, true)`, [ip, data.email]);
    const token = newToken();
    const s = (await tx.query(`insert into sessions (user_id, token_hash, ip, user_agent, expires_at)
      values ($1, $2, $3, $4, now() + make_interval(days => $5)) returning id`, [u.id, tokenHash(token), ip, (meta.userAgent || '').slice(0, 300), SESSION_DAYS])).rows[0];
    await audit.record(tx, { actorUserId: u.id, action: 'user.login', entityType: 'user', entityId: u.id, ip });
    return { token, session: { sessionId: s.id, user: { id: u.id, email: u.email, full_name: u.full_name, email_verified: !!u.email_verified_at } } };
  });
  if ('error' in outcome) throw outcome.error;
  return outcome;
}

/** Сессия по токену из cookie. Просроченная, отозванная или с отключённым пользователем — нет сессии. */
export async function getSession(token: string | undefined | null): Promise<Session | null> {
  if (!token) return null;
  return withSystem(async (tx) => {
    const r = (await tx.query(`select s.id as session_id, s.last_seen_at < now() - interval '5 minutes' as stale,
        u.id, u.email, u.full_name, u.email_verified_at
       from sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now() and u.status = 'active'`, [tokenHash(token)])).rows[0];
    if (!r) return null;
    if (r.stale) await tx.query(`update sessions set last_seen_at = now() where id = $1`, [r.session_id]);
    return { sessionId: r.session_id, user: { id: r.id, email: r.email, full_name: r.full_name, email_verified: !!r.email_verified_at } };
  });
}

export async function logout(token: string | undefined | null): Promise<void> {
  if (!token) return;
  await withSystem(async (tx) => {
    const s = (await tx.query(`update sessions set revoked_at = now() where token_hash = $1 and revoked_at is null returning user_id`, [tokenHash(token)])).rows[0];
    if (s) await audit.record(tx, { actorUserId: s.user_id, action: 'user.logout', entityType: 'user', entityId: s.user_id });
  });
}

export async function requestPasswordReset(input: unknown): Promise<{ ok: true }> {
  const { email: addr } = parse(z.object({ email }), input);
  await withSystem(async (tx) => {
    const u = (await tx.query(`select id, full_name from users where email = $1 and status = 'active'`, [addr])).rows[0];
    if (!u) return;
    const token = await issueEmailToken(tx, u.id, 'reset_password', RESET_MINUTES);
    await queueEmail(tx, addr, 'reset_password', { name: u.full_name, link: `${appUrl()}/reset?token=${token}` });
    await audit.record(tx, { actorUserId: u.id, action: 'user.password_reset_requested', entityType: 'user', entityId: u.id });
  });
  return { ok: true };
}

export async function resetPassword(input: unknown): Promise<{ ok: true }> {
  const data = parse(z.object({ token: z.string().min(1), password: z.string().max(200) }), input);
  const problem = passwordProblem(data.password);
  if (problem) throw Errors.validation(problem);
  const hash = await hashPassword(data.password);
  return withSystem(async (tx) => {
    const t = (await tx.query(`select id, user_id, expires_at < now() as expired, used_at from email_tokens
      where token_hash = $1 and purpose = 'reset_password' for update`, [tokenHash(data.token)])).rows[0];
    if (!t || t.used_at || t.expired) throw Errors.validation('Ссылка восстановления недействительна или устарела. Запросите новую.');
    await tx.query(`update email_tokens set used_at = now() where id = $1`, [t.id]);
    // Новый пароль снимает блокировку и закрывает все открытые сессии — на чужом устройстве тоже.
    await tx.query(`update users set password_hash = $2, failed_logins = 0, locked_until = null, updated_at = now() where id = $1`, [t.user_id, hash]);
    await tx.query(`update sessions set revoked_at = now() where user_id = $1 and revoked_at is null`, [t.user_id]);
    await audit.record(tx, { actorUserId: t.user_id, action: 'user.password_reset', entityType: 'user', entityId: t.user_id });
    return { ok: true as const };
  });
}
