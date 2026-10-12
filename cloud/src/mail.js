// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * Отправка писем из очереди tsekh_mail через Yandex Cloud Postbox (API, совместимый с Amazon SES v2).
 * MailApp.sendEmail в коде ЦЕХ только ставит письмо в очередь — отправка идёт в фоне (каждые 15 минут),
 * поэтому сбой почты не ломает операцию. До 5 попыток, затем статус «ошибка» с текстом причины.
 *
 * Переменные: TSEKH_MAIL_FROM (адрес отправителя с подтверждённым в Postbox доменом),
 * TSEKH_POSTBOX_ENDPOINT (https://postbox.cloud.yandex.net), YC_ACCESS_KEY_ID, YC_SECRET_ACCESS_KEY.
 * Без TSEKH_MAIL_FROM письма остаются в очереди.
 */
const { sign } = require('./sigv4');

const MAIL_SQL = [
  `ALTER TABLE tsekh_mail ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0`,
  `ALTER TABLE tsekh_mail ADD COLUMN IF NOT EXISTS last_error text`,
  `ALTER TABLE tsekh_mail ADD COLUMN IF NOT EXISTS sent_at timestamptz`
];
const MAX_ATTEMPTS = 5;

function mailConfig(env) {
  env = env || process.env;
  if (!env.TSEKH_MAIL_FROM) return null;
  return { from: env.TSEKH_MAIL_FROM, endpoint: (env.TSEKH_POSTBOX_ENDPOINT || 'https://postbox.cloud.yandex.net').replace(/\/+$/, ''),
    region: env.TSEKH_POSTBOX_REGION || 'ru-central1', accessKeyId: env.YC_ACCESS_KEY_ID, secretAccessKey: env.YC_SECRET_ACCESS_KEY };
}

function flushMail(db, env, limit) {
  const cfg = mailConfig(env);
  if (!cfg) return { отправлено: 0, ошибок: 0, пропущено: 'не задан TSEKH_MAIL_FROM' };
  const rows = db.query(`SELECT id, recipient, subject, body, attempts FROM tsekh_mail WHERE status = 'к_отправке' ORDER BY id LIMIT $1`, [limit || 50]);
  let sent = 0, failed = 0;
  rows.forEach(m => {
    const url = cfg.endpoint + '/v2/email/outbound-emails';
    const body = JSON.stringify({ FromEmailAddress: cfg.from, Destination: { ToAddresses: String(m.recipient).split(',').map(s => s.trim()).filter(Boolean) },
      Content: { Simple: { Subject: { Data: m.subject || '', Charset: 'UTF-8' }, Body: { Text: { Data: m.body || '', Charset: 'UTF-8' } } } } });
    try {
      const signed = sign({ method: 'POST', url, region: cfg.region, service: 'ses', headers: { 'content-type': 'application/json' }, body,
        accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey });
      const r = db.fetch(url, { method: 'POST', headers: signed.headers, payload: body });
      if (r.status >= 300) throw new Error('Postbox ответил ' + r.status + ': ' + Buffer.from(r.body, 'base64').toString('utf8').slice(0, 300));
      db.query(`UPDATE tsekh_mail SET status = 'отправлено', sent_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = $1`, [m.id]);
      sent++;
    } catch (e) {
      failed++;
      db.query(`UPDATE tsekh_mail SET attempts = attempts + 1, last_error = $2, status = CASE WHEN attempts + 1 >= $3 THEN 'ошибка' ELSE status END WHERE id = $1`,
        [m.id, String(e.message).slice(0, 500), MAX_ATTEMPTS]);
    }
  });
  return { отправлено: sent, ошибок: failed };
}

module.exports = { flushMail, mailConfig, MAIL_SQL, MAX_ATTEMPTS };
