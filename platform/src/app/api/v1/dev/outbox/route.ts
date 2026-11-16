import { handler } from '@/server/http/route';
import { Errors } from '@/server/http/errors';
import { withSystem } from '@/server/db/pool';

/**
 * Только для разработки и стенда: последние письма из очереди (почтовый сервер не подключён).
 * В рабочей среде маршрут отвечает «не найдено».
 */
export const GET = handler(async (c) => {
  if (process.env.NODE_ENV === 'production' || process.env.DEV_MAILBOX !== '1') throw Errors.notFound();
  const email = c.req.nextUrl.searchParams.get('email');
  return withSystem(async (tx) => (await tx.query(
    `select to_email, subject, body, created_at from outbox_emails where ($1::text is null or to_email = $1) order by created_at desc limit 20`,
    [email])).rows);
}, { auth: false });
