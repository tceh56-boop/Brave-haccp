import { withSystem } from '../src/server/db/pool';
import { register, verifyEmail, login, type SessionUser } from '../src/server/identity/auth';

let n = 0;
export const uniq = (p = 'u') => `${p}${Date.now().toString(36)}${(n++).toString(36)}@example.test`;

/** Ссылка из последнего письма на адрес (письма лежат в outbox_emails). */
export async function lastLinkToken(email: string, template: string): Promise<string> {
  const row = (await withSystem((tx) => tx.query(`select body from outbox_emails where to_email = $1 and template = $2 order by created_at desc limit 1`, [email, template]))).rows[0];
  if (!row) throw new Error(`нет письма ${template} для ${email}`);
  const m = /token=([A-Za-z0-9_-]+)/.exec(row.body);
  if (!m) throw new Error('в письме нет ссылки');
  return m[1];
}

export const PASSWORD = 'Пароль-надёжный-2026';

export async function makeUser(opts: { verified?: boolean; name?: string } = {}): Promise<SessionUser & { token: string }> {
  const email = uniq();
  await register({ email, password: PASSWORD, fullName: opts.name || 'Тест Тестов' });
  if (opts.verified !== false) await verifyEmail(await lastLinkToken(email, 'verify_email'));
  const r = await login({ email, password: PASSWORD }, { ip: '10.0.0.' + (n % 250) });
  return { ...r.session.user, token: r.token };
}

/**
 * Фактический расход для выпуска в тестах: берём подсказку формы (FEFO на плановый выход) как будто повар её подтвердил.
 * В системе это делает человек; сервер расчёт фактом не пишет.
 */
export async function fact(userId: string, orgId: string, orderId: string) {
  const { getProduction } = await import('../src/server/ops/production');
  const p = await getProduction(userId, orgId, orderId);
  return p.lots.filter((l) => l.suggest > 0).map((l) => ({ lotId: l.lot_id, quantity: l.suggest }));
}

/** Дата в часовом поясе организации со сдвигом в днях (по умолчанию — Москва, как у тестовых организаций). */
export function orgDate(n = 0, tz = 'Europe/Moscow') {
  return new Date(Date.now() + n * 864e5).toLocaleDateString('sv-SE', { timeZone: tz });
}

/** «n минут назад», но не раньше начала текущих суток организации: тест на стыке суток не уходит во вчера. */
export function minutesAgoSameDay(n: number, tz = 'Europe/Moscow') {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const sinceMidnight = Number(p.find((x) => x.type === 'hour')!.value) * 60 + Number(p.find((x) => x.type === 'minute')!.value);
  return new Date(Date.now() - Math.max(0, Math.min(n, sinceMidnight - 1)) * 60e3).toISOString();
}
