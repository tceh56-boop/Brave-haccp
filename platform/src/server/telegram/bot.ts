import { randomInt } from 'node:crypto';
import { withSystem } from '../db/pool';
import { tokenHash } from '../security/crypto';
import { AppError } from '../http/errors';
import { audit } from '../audit/audit';
import { inOrg } from '../ops/common';
import { listSites } from '../org/organizations';
import { shiftCards } from '../ops/shift';
import { listIncidents } from '../ops/incidents';
import { askQuestion } from '../ops/ai';

/**
 * Telegram-бот «ЦЕХ ИИ». Бот — ещё один вход в ту же систему, без своих правил: каждое действие выполняется от имени
 * привязанного сотрудника обычными операциями (inOrg) — с его ролью, площадками и допуском.
 *  - Привязка: одноразовый код из приложения (15 минут) → /start КОД. Без привязки бот ничего не показывает.
 *  - Команды: /smena — что сделать сейчас; /problems — открытые отклонения; /stop — отвязать; вопрос текстом — AI-помощник
 *    (отвечает только по утверждённым источникам реестра; платный провайдер включает владелец настройкой AI_PROVIDER).
 *  - Уведомления ролей (отклонения, бракераж, изменение себестоимости) доставляются привязанным сотрудникам один раз.
 * В Telegram уходят заголовки уведомлений и ответы помощника — подключение бота решает владелец.
 */

const API = () => `${process.env.TELEGRAM_API_URL || 'https://api.telegram.org'}/bot${process.env.TELEGRAM_BOT_TOKEN}`;
export const telegramConfigured = () => !!process.env.TELEGRAM_BOT_TOKEN;
export const botUsername = () => process.env.TELEGRAM_BOT_USERNAME || null;

export async function tg<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API()}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(40_000) });
  const j = await res.json().catch(() => ({})) as { ok?: boolean; result?: T; description?: string };
  if (!res.ok || !j.ok) throw new Error(`Telegram ${method}: ${res.status} ${j.description || ''}`.trim());
  return j.result as T;
}
const send = (chatId: number, text: string) => tg('sendMessage', { chat_id: chatId, text: text.slice(0, 3900), disable_web_page_preview: true });

/* ───────────── Привязка (из приложения) ───────────── */

const CODE_MINUTES = 15;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // без похожих символов

/** Одноразовый код привязки. В базе — только хеш; прежние неиспользованные коды сотрудника гасятся. */
export async function createLinkCode(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'org.read', async (tx) => {
    const code = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    await tx.query(`update telegram_link_codes set used_at = now() where organization_id = $1 and user_id = $2 and used_at is null`, [orgId, userId]);
    await tx.query(`insert into telegram_link_codes (code_hash, organization_id, user_id, expires_at) values ($1, $2, $3, now() + make_interval(mins => $4))`, [tokenHash(code), orgId, userId, CODE_MINUTES]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'telegram.code', entityType: 'user', entityId: userId });
    return { code, minutes: CODE_MINUTES, bot: botUsername(), configured: telegramConfigured() };
  });
}

export async function telegramStatus(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'org.read', async (tx) => {
    const l = (await tx.query(`select username, linked_at from telegram_links where organization_id = $1 and user_id = $2 and revoked_at is null`, [orgId, userId])).rows[0];
    return { configured: telegramConfigured(), bot: botUsername(), linked: !!l, username: l?.username || null, linked_at: l?.linked_at || null };
  });
}

export async function unlinkTelegram(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'org.read', async (tx) => {
    const n = (await tx.query(`update telegram_links set revoked_at = now() where organization_id = $1 and user_id = $2 and revoked_at is null`, [orgId, userId])).rowCount;
    if (n) await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'telegram.unlink', entityType: 'user', entityId: userId });
    return { ok: true };
  });
}

/* ───────────── Обработка сообщений ───────────── */

interface Link { organization_id: string; user_id: string; org_name: string; full_name: string }
interface Update { update_id: number; message?: { chat: { id: number; type: string }; from?: { username?: string }; text?: string } }

async function linkOf(chatId: number): Promise<Link | null> {
  return withSystem(async (tx) => (await tx.query(`select l.organization_id, l.user_id, o.name as org_name, u.full_name from telegram_links l
    join organizations o on o.id = l.organization_id join users u on u.id = l.user_id join memberships m on m.organization_id = l.organization_id and m.user_id = l.user_id
    where l.chat_id = $1 and l.revoked_at is null and u.status = 'active' and m.status = 'active'`, [chatId])).rows[0] || null);
}

async function redeem(chatId: number, username: string | undefined, code: string): Promise<string> {
  return withSystem(async (tx) => {
    const c = (await tx.query(`select * from telegram_link_codes where code_hash = $1 and used_at is null and expires_at > now() for update`, [tokenHash(code.toUpperCase())])).rows[0];
    if (!c) return 'Код не подошёл или истёк. Получите новый: в приложении «Смена» → «Telegram-бот ЦЕХ ИИ» → «Получить код».';
    await tx.query(`update telegram_link_codes set used_at = now() where code_hash = $1`, [c.code_hash]);
    await tx.query(`update telegram_links set revoked_at = now() where revoked_at is null and (chat_id = $1 or (organization_id = $2 and user_id = $3))`, [chatId, c.organization_id, c.user_id]);
    await tx.query(`insert into telegram_links (organization_id, user_id, chat_id, username) values ($1, $2, $3, $4)`, [c.organization_id, c.user_id, chatId, username || null]);
    await audit.record(tx, { organizationId: c.organization_id, actorUserId: c.user_id, action: 'telegram.link', entityType: 'user', entityId: c.user_id, after: { username: username || null } });
    const who = (await tx.query(`select u.full_name, o.name from users u, organizations o where u.id = $1 and o.id = $2`, [c.user_id, c.organization_id])).rows[0];
    return `Готово, ${who.full_name}. Чат привязан к «${who.name}».\n\n${HELP}`;
  });
}

const HELP = ['Что я умею:', '/smena — что сделать сейчас на смене', '/problems — открытые отклонения', '/stop — отвязать этот чат',
  'Или задайте вопрос по требованиям текстом — отвечу со ссылкой на источник из реестра предприятия.'].join('\n');
const BUCKET: Record<string, string> = { overdue: '🔴 Просрочено', now: '🟡 Сейчас', later: '⚪ Позже сегодня' };

async function smena(l: Link): Promise<string> {
  const sites = (await listSites(l.user_id, l.organization_id)).filter((s: { status: string }) => s.status !== 'archived');
  if (!sites.length) return 'Нет доступных площадок.';
  const parts: string[] = [];
  for (const s of sites.slice(0, 3)) {
    const r = await shiftCards(l.user_id, l.organization_id, s.id);
    const lines: string[] = [];
    let prev = '';
    for (const c of r.cards.slice(0, 15)) {
      if (c.bucket !== prev) { lines.push(BUCKET[c.bucket]); prev = c.bucket; }
      lines.push(`• ${c.title}${c.detail ? ` — ${c.detail}` : ''}`);
    }
    parts.push(`${s.name}\n${lines.length ? lines.join('\n') : 'На сейчас всё сделано.'}${r.cards.length > 15 ? `\n…и ещё ${r.cards.length - 15}` : ''}`);
  }
  return `${parts.join('\n\n')}\n\nОтметить выполнение — в приложении: ${process.env.APP_URL || ''}/app/${l.organization_id}/shift`;
}

async function problems(l: Link): Promise<string> {
  const list = await listIncidents(l.user_id, l.organization_id, { open: true }) as { title: string; status_label?: string; severity_label?: string }[];
  if (!list.length) return 'Открытых отклонений нет.';
  return `Открытые отклонения: ${list.length}\n${list.slice(0, 12).map((i) => `• ${i.title}${i.severity_label ? ` (${i.severity_label})` : ''}`).join('\n')}\n\nРазбор — в приложении: ${process.env.APP_URL || ''}/app/${l.organization_id}/problems`;
}

async function ask(l: Link, question: string): Promise<string> {
  const r = await askQuestion(l.user_id, l.organization_id, { question });
  if (r.status !== 'ok' || !r.answer) return r.message || 'Ответа нет.';
  const a = r.answer;
  return [a.found, a.why ? `Почему важно: ${a.why}` : '', a.do_now.length ? `Что сделать:\n${a.do_now.map((x) => `• ${x}`).join('\n')}` : '',
    a.dont.length ? `Нельзя до решения ответственного:\n${a.dont.map((x) => `• ${x}`).join('\n')}` : '', a.who_confirms ? `Подтверждает: ${a.who_confirms}` : '',
    r.citations.length ? `Источник:\n${r.citations.map((c) => `• ${c.code}, ${c.clause}: «${c.quote}»`).join('\n')}` : '', a.limitations ? `Ограничения: ${a.limitations}` : '',
    'Это подсказка, а не решение: решение принимает ответственный.'].filter(Boolean).join('\n\n');
}

const hits = new Map<number, number[]>();
/** Не больше 20 сообщений за 5 минут с одного чата. */
function limited(chatId: number) {
  const now = Date.now(), list = (hits.get(chatId) || []).filter((t) => now - t < 5 * 60e3);
  list.push(now); hits.set(chatId, list);
  return list.length > 20;
}

/** Ответ на одно сообщение. Возвращает текст (для тестов) и отправляет его в чат. */
export async function handleUpdate(u: Update, deliver: (chatId: number, text: string) => Promise<unknown> = send): Promise<string | null> {
  const m = u.message;
  if (!m?.text) return null;
  const chatId = m.chat.id, text = m.text.trim();
  let reply: string;
  try {
    if (m.chat.type !== 'private') reply = 'Я работаю только в личном чате: данные предприятия в группы не отправляю.';
    else if (limited(chatId)) reply = 'Слишком много сообщений. Подождите несколько минут.';
    else {
      const start = /^\/start(?:@\w+)?(?:\s+(\S+))?$/i.exec(text);
      if (start?.[1]) reply = await redeem(chatId, m.from?.username, start[1]);
      else {
        const l = await linkOf(chatId);
        if (!l) reply = 'Чат не привязан к сотруднику. В приложении ЦЕХ откройте «Смена» → «Telegram-бот ЦЕХ ИИ» → «Получить код» и отправьте мне: /start КОД';
        else if (start || /^\/help/i.test(text)) reply = `${l.full_name}, «${l.org_name}».\n\n${HELP}`;
        else if (/^\/stop/i.test(text)) { await unlinkTelegram(l.user_id, l.organization_id); reply = 'Чат отвязан. Уведомления приходить не будут.'; }
        else if (/^\/(smena|смена)/i.test(text) || /^смена$/i.test(text)) reply = await smena(l);
        else if (/^\/(problems|проблемы)/i.test(text)) reply = await problems(l);
        else if (text.startsWith('/')) reply = `Не знаю такой команды.\n\n${HELP}`;
        else reply = await ask(l, text);
      }
    }
  } catch (e) {
    reply = e instanceof AppError ? e.message : 'Не получилось выполнить запрос. Попробуйте позже.';
    if (!(e instanceof AppError)) console.error('telegram', e);
  }
  await deliver(chatId, reply);
  return reply;
}

/* ───────────── Доставка уведомлений ───────────── */

/**
 * Уведомления последних суток → привязанным сотрудникам с подходящей ролью (или лично) и доступом к площадке.
 * Каждое уведомление в каждый чат — один раз; ошибка отправки записывается и не повторяется бесконечно.
 */
export async function deliverNotifications(deliver: (chatId: number, text: string) => Promise<unknown> = send): Promise<number> {
  const rows = await withSystem(async (tx) => (await tx.query(`select n.id, n.organization_id, n.title, n.body, n.entity_type, n.entity_id, l.chat_id
    from notifications n join telegram_links l on l.organization_id = n.organization_id and l.revoked_at is null
      join memberships m on m.organization_id = l.organization_id and m.user_id = l.user_id and m.status = 'active'
    where n.created_at > now() - interval '1 day' and n.created_at >= l.linked_at
      and (n.user_id = l.user_id or (n.user_id is null and n.role = m.role))
      and (n.site_id is null or cardinality(m.site_ids) = 0 or n.site_id = any(m.site_ids))
      and not exists (select 1 from telegram_deliveries d where d.notification_id = n.id and d.chat_id = l.chat_id)
    order by n.created_at limit 50`)).rows);
  let sent = 0;
  for (const n of rows) {
    const href = n.entity_type === 'incident' ? `/app/${n.organization_id}/incidents/${n.entity_id}` : n.entity_type === 'capa' ? `/app/${n.organization_id}/capa/${n.entity_id}`
      : n.entity_type === 'receipt' ? `/app/${n.organization_id}/receipts/${n.entity_id}` : `/app/${n.organization_id}/tasks`;
    let error: string | null = null;
    try { await deliver(Number(n.chat_id), `${n.title}${n.body ? `\n${n.body}` : ''}\n${process.env.APP_URL || ''}${href}`); sent++; } catch (e) { error = (e as Error).message.slice(0, 300); }
    await withSystem((tx) => tx.query(`insert into telegram_deliveries (notification_id, organization_id, chat_id, error) values ($1, $2, $3, $4) on conflict do nothing`, [n.id, n.organization_id, n.chat_id, error]));
  }
  return sent;
}

