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
