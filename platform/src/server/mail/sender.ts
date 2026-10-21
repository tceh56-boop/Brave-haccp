import nodemailer from 'nodemailer';
import { withSystem } from '../db/pool';

/**
 * Отправка писем из очереди outbox_emails через SMTP (SMTP_URL, MAIL_FROM). Письмо захватывается
 * «for update skip locked» — несколько обработчиков не отправят одно письмо дважды. Неудача — повтор через
 * 1, 2, 4, 8, 16 минут; после 6 попыток письмо остаётся с ошибкой (видно в готовности к пилоту).
 */

export interface MailTransport { send(m: { to: string; subject: string; text: string }): Promise<void> }
export const MAX_ATTEMPTS = 6;

export function smtpTransport(): MailTransport | null {
  if (!process.env.SMTP_URL) return null;
  const t = nodemailer.createTransport(process.env.SMTP_URL);
  const from = process.env.MAIL_FROM || 'ЦЕХ <no-reply@localhost>';
  return { async send(m) { await t.sendMail({ from, to: m.to, subject: m.subject, text: m.text }); } };
}

export async function sendPending(transport: MailTransport, limit = 50) {
  const res = { sent: 0, failed: 0 };
  for (let i = 0; i < limit; i++) {
    const done = await withSystem(async (tx) => {
      const m = (await tx.query(`select id, to_email, subject, body, attempts from outbox_emails
        where sent_at is null and attempts < $1 and next_attempt_at <= now() order by created_at limit 1 for update skip locked`, [MAX_ATTEMPTS])).rows[0];
      if (!m) return null;
      try {
        await transport.send({ to: m.to_email, subject: m.subject, text: m.body });
        await tx.query(`update outbox_emails set sent_at = now(), error = null, attempts = attempts + 1 where id = $1`, [m.id]);
        return 'sent';
      } catch (e) {
        await tx.query(`update outbox_emails set error = $2, attempts = attempts + 1, next_attempt_at = now() + make_interval(mins => power(2, attempts)::int) where id = $1`,
          [m.id, String((e as Error).message).slice(0, 500)]);
        return 'failed';
      }
    });
    if (!done) break;
    res[done]++;
  }
  return res;
}

/** Состояние доставки для готовности к пилоту. */
export async function mailHealth() {
  return withSystem(async (tx) => (await tx.query(`select count(*) filter (where sent_at is null and created_at < now() - interval '30 minutes')::int as stuck,
      count(*) filter (where sent_at is null and attempts >= $1)::int as dead, count(*) filter (where sent_at is not null and sent_at > now() - interval '7 days')::int as sent_week
    from outbox_emails`, [MAX_ATTEMPTS])).rows[0] as { stuck: number; dead: number; sent_week: number });
}

if (typeof require !== 'undefined' && require.main === module) {
  const t = smtpTransport();
  if (!t) { console.error('SMTP_URL не задан — отправка невозможна.'); process.exitCode = 1; }
  else {
    const watch = process.argv.includes('--watch');
    const tick = async () => { const r = await sendPending(t); if (r.sent || r.failed) console.log(new Date().toISOString(), r); };
    if (watch) { const safe = () => tick().catch((e) => console.error(e.message)); safe(); setInterval(safe, 15_000); }
    else tick().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(async () => (await import('../db/pool')).closePool());
  }
}
