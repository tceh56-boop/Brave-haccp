'use strict';
/**
 * Отправка писем из очереди (MailApp.sendEmail кладёт письмо в очередь предприятия).
 * SMTP_URL — почта Яндекс 360: smtps://ящик%40домен.ru:пароль_приложения@smtp.yandex.ru:465
 * Без SMTP_URL письма остаются в очереди и уйдут, когда почту настроят.
 */
const nodemailer = require('nodemailer');
const tenants = require('./tenants');

let transport = null;
function getTransport() {
  if (!process.env.SMTP_URL) return null;
  if (!transport) transport = nodemailer.createTransport(process.env.SMTP_URL);
  return transport;
}

async function sendPending() {
  const tr = getTransport();
  if (!tr) return 0;
  const from = process.env.MAIL_FROM || '';
  let sent = 0;
  for (const cfg of tenants.list()) {
    const t = tenants.get(cfg.slug);
    if (!t) continue;
    for (const row of t.store.pendingMail(20)) {
      const m = JSON.parse(row.msg);
      try {
        const addr = (from.match(/<([^>]+)>/) || [])[1] || from;
        await tr.sendMail({
          from: m.name ? { name: m.name, address: addr } : from,
          to: m.to || undefined, cc: m.cc || undefined, bcc: m.bcc || undefined, replyTo: m.noReply ? undefined : m.replyTo || undefined,
          subject: m.subject, text: m.text || undefined, html: m.html || undefined,
          attachments: (m.attachments || []).map((a) => ({ filename: a.name, contentType: a.type, content: Buffer.from(a.data, 'base64') }))
            .concat(Object.keys(m.inline || {}).map((cid) => ({ cid, filename: m.inline[cid].name, contentType: m.inline[cid].type, content: Buffer.from(m.inline[cid].data, 'base64') }))),
        });
        t.store.mailDone(row.id, null);
        sent++;
      } catch (e) {
        t.store.mailDone(row.id, e.message);
      }
    }
  }
  return sent;
}

module.exports = { sendPending };
