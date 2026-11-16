import { handler } from '@/server/http/route';
import { verifyEmail, verifyInfo } from '@/server/identity/auth';

/** Подтверждение email: { token, info: true } — нужен ли пароль; { token, password? } — подтвердить. */
export const POST = handler(async (c) => {
  const b = ((await c.body()) || {}) as { token?: unknown; password?: unknown; info?: unknown };
  return b.info ? verifyInfo(b.token) : verifyEmail(b.token, b.password);
}, { auth: false });
