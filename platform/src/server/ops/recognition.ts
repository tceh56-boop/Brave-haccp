import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse } from './common';
import { yandexStatus, complete } from '../integrations/yandex';

/**
 * Распознавание документов — настройка (этап 17). Сами разборы (ТОРГ-12, УПД, QR кассового чека, банкетный бланк)
 * переносятся из MON CHEF и подключаются через usageGuard: включено ли на предприятии, разрешён ли вид, не превышен ли
 * месячный лимит страниц. Каждое обращение к облаку учитывается (страницы, токены модели, итог).
 */

export const KINDS: Record<string, string> = { torg12: 'Товарная накладная ТОРГ-12', upd: 'УПД', fiscal_qr: 'QR-код кассового чека', banquet: 'Банкетный бланк заказа' };

async function settingsOf(tx: Tx, orgId: string) {
  const s = (await tx.query(`select s.*, u.full_name as updated_by_name from recognition_settings s join users u on u.id = s.updated_by where s.organization_id = $1`, [orgId])).rows[0];
  return s ? { enabled: s.enabled as boolean, kinds: s.kinds as string[], monthly_pages: Number(s.monthly_pages), updated_by: s.updated_by_name as string, updated_at: s.updated_at as string }
    : { enabled: false, kinds: Object.keys(KINDS), monthly_pages: 200, updated_by: null, updated_at: null };
}

async function usedThisMonth(tx: Tx, orgId: string) {
  return (await tx.query(`select u.kind, coalesce(sum(u.pages), 0)::int as pages, coalesce(sum(u.llm_tokens), 0)::int as tokens, count(*)::int as calls,
      count(*) filter (where u.status <> 'ok')::int as failed
    from recognition_usage u join organizations o on o.id = u.organization_id
    where u.organization_id = $1 and u.created_at >= date_trunc('month', now() at time zone o.timezone) at time zone o.timezone group by u.kind`, [orgId])).rows;
}

export async function getRecognition(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'recognition.manage', async (tx) => {
    const usage = await usedThisMonth(tx, orgId);
    return { server: yandexStatus(), settings: await settingsOf(tx, orgId), kinds: KINDS, usage, pages_used: usage.reduce((s, u) => s + u.pages, 0) };
  });
}

const SettingsInput = z.object({ enabled: z.boolean(), kinds: z.array(z.enum(['torg12', 'upd', 'fiscal_qr', 'banquet'])).max(4),
  monthlyPages: z.coerce.number().int().min(0, 'Лимит — не меньше 0.').max(100000) });

export async function setRecognition(userId: string, orgId: string, input: unknown) {
  const d = parse(SettingsInput, input);
  return inOrg(userId, orgId, 'recognition.manage', async (tx) => {
    if (d.enabled && !yandexStatus().configured) throw Errors.conflict('На сервере не заданы ключи Yandex Cloud — включить распознавание нельзя. См. раздел «Распознавание документов» в инструкции по развёртыванию.');
    const before = await settingsOf(tx, orgId);
    await tx.query(`insert into recognition_settings (organization_id, enabled, kinds, monthly_pages, updated_by) values ($1, $2, $3, $4, $5)
      on conflict (organization_id) do update set enabled = excluded.enabled, kinds = excluded.kinds, monthly_pages = excluded.monthly_pages, updated_by = excluded.updated_by, updated_at = now()`,
    [orgId, d.enabled, d.kinds, d.monthlyPages, userId]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'recognition.settings', entityType: 'organization', entityId: orgId,
      before: { enabled: before.enabled, kinds: before.kinds, monthly_pages: before.monthly_pages }, after: d });
    return settingsOf(tx, orgId);
  });
}

/** Перед платным обращением: включено, вид разрешён, лимит страниц месяца не превышен. */
export async function usageGuard(tx: Tx, orgId: string, kind: string, pages: number) {
  if (!yandexStatus().configured) throw Errors.conflict('Распознавание не настроено на сервере. Внесите данные вручную.');
  const s = await settingsOf(tx, orgId);
  if (!s.enabled) throw Errors.conflict('Распознавание документов выключено на предприятии. Внесите данные вручную.');
  if (kind !== 'check' && !s.kinds.includes(kind)) throw Errors.conflict(`Распознавание «${KINDS[kind] || kind}» не включено на предприятии.`);
  const used = (await usedThisMonth(tx, orgId)).reduce((a, u) => a + u.pages, 0);
  if (used + pages > s.monthly_pages) throw Errors.conflict(`Лимит распознавания на месяц исчерпан: ${used} из ${s.monthly_pages} страниц. Внесите данные вручную или увеличьте лимит.`);
}

export async function recordUsage(tx: Tx, u: { orgId: string; kind: string; pages: number; tokens: number; status: 'ok' | 'failed' | 'rejected'; error?: string | null; userId: string }) {
  await tx.query(`insert into recognition_usage (organization_id, kind, pages, llm_tokens, status, error, created_by) values ($1, $2, $3, $4, $5, $6, $7)`,
    [u.orgId, u.kind, u.pages, u.tokens, u.status, u.error ? u.error.slice(0, 500) : null, u.userId]);
}

/**
 * Проверка подключения — один короткий платный запрос к YandexGPT. Только по явному подтверждению (confirmPaid).
 * Запрос к облаку идёт вне транзакции; результат и ошибка — в учёт обращений.
 */
export async function checkConnection(userId: string, orgId: string, input: unknown) {
  parse(z.object({ confirmPaid: z.literal(true, { message: 'Проверка — платный запрос к облаку: подтвердите.' }) }), input);
  await inOrg(userId, orgId, 'recognition.manage', async () => {
    if (!yandexStatus().configured) throw Errors.conflict('На сервере не заданы YANDEX_API_KEY и YANDEX_FOLDER_ID.');
    if (!yandexStatus().llm) throw Errors.conflict('Модель отключена (RECOGNITION_LLM_DISABLED=1) — проверка через модель недоступна.');
  });
  let ok = false, tokens = 0, error: string | null = null;
  try {
    const r = await complete('Ты проверка связи. Ответь одним словом.', 'Ответь: готово', 5);
    ok = r.text.length > 0; tokens = r.tokens;
  } catch (e) { error = (e as Error).message; }
  await inOrg(userId, orgId, 'recognition.manage', (tx) => recordUsage(tx, { orgId, kind: 'check', pages: 0, tokens, status: ok ? 'ok' : 'failed', error, userId }));
  if (!ok) throw Errors.conflict(`Подключение не работает: ${error || 'пустой ответ модели'}`);
  return { ok: true, tokens };
}
