import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse } from './common';
import { yandexStatus, complete } from '../integrations/yandex';
import { bestVision, pdfPages } from '../recognition/vision';
import { extractWithModel, auditWithModel, applyAudit, finalize, LIMITS, type Extracted } from '../recognition/extract';
import { resolver, norm, supplierKey, type Product, type Alias } from '../recognition/match';

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

/* ───────────── Распознавание документа поставщика (часть 2: перенос MON CHEF V10–V12) ───────────── */

/** Доступно ли распознавание вида документа сотруднику (для кнопки на экране приёмки). */
export async function recognitionAvailable(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'receipt.record', async (tx) => {
    const s = await settingsOf(tx, orgId), srv = yandexStatus();
    const used = (await usedThisMonth(tx, orgId)).reduce((a, u) => a + u.pages, 0);
    return { enabled: srv.configured && s.enabled, kinds: s.kinds, pages_left: Math.max(0, s.monthly_pages - used) };
  });
}

export interface UploadedFile { bytes: Buffer; mimeType: string; name: string }
const MIME_OK = /^(image\/(jpeg|png)|application\/pdf)$/;

/**
 * Распознать документ (одно или несколько фото, PDF): черновик строк с кандидатами из номенклатуры.
 * Ничего не проводит. Перед обращением — лимит; после — учёт страниц и токенов; дубль документа отмечается.
 */
export async function recognizeDocument(userId: string, orgId: string, input: unknown, files: UploadedFile[]) {
  const d = parse(z.object({ siteId: z.uuid(), receiptId: z.uuid().optional().nullable(), kind: z.enum(['torg12', 'upd']).default('torg12') }), input);
  if (!files.length) throw Errors.validation('Добавьте фото или PDF документа.');
  if (files.length > 10) throw Errors.validation('Не больше 10 файлов на документ.');
  for (const f of files) if (!MIME_OK.test(f.mimeType)) throw Errors.validation(`«${f.name}»: нужен JPEG, PNG или PDF.`);
  const estimate = files.reduce((s, f) => s + (f.mimeType === 'application/pdf' ? Math.max(1, pdfPages(f.bytes)) : 1), 0);
  const ctx = await inOrg(userId, orgId, 'receipt.record', async (tx) => {
    if (!(await tx.query(`select 1 from sites where id = $1 and organization_id = $2`, [d.siteId, orgId])).rowCount) throw Errors.notFound('Площадка не найдена.');
    if (d.receiptId && !(await tx.query(`select 1 from receipts where id = $1 and organization_id = $2 and site_id = $3 and status = 'draft'`, [d.receiptId, orgId, d.siteId])).rowCount)
      throw Errors.conflict('Приёмка не найдена или уже завершена.');
    await usageGuard(tx, orgId, d.kind, estimate);
    const products = (await tx.query(`select id, name, unit from products where organization_id = $1 and status = 'active'`, [orgId])).rows as Product[];
    const aliases = (await tx.query(`select raw_norm, product_id, nullif(supplier_key, '') as supplier_key from recognition_aliases where organization_id = $1`, [orgId])).rows as Alias[];
    return { products, aliases };
  }, d.siteId);

  let billed = 0, tokens = 0;
  try {
    const best = await bestVision(files.map((f) => ({ bytes: f.bytes, mimeType: f.mimeType })));
    billed = best.pagesBilled;
    const first = await extractWithModel(best.vis);
    tokens += first.tokens;
    let ext: Extracted = first.ext;
    const resolveFor = (e: Extracted) => resolver(ctx.products, ctx.aliases, e.supplier ? String(e.supplier) : null);
    const pre = finalize(JSON.parse(JSON.stringify(ext)), best.vis, resolveFor(ext));
    // вторая проверка — только для сомнительных документов (время и лимит), как в MON CHEF V12
    if (pre.requires_manual_review || pre.recognition_confidence < LIMITS.AUTOPASS_THRESHOLD) {
      const a = await auditWithModel(best.vis, ext);
      tokens += a.tokens;
      ext = applyAudit(ext, a.audit);
    }
    const doc = finalize(ext, best.vis, resolveFor(ext));
    return await inOrg(userId, orgId, 'receipt.record', async (tx) => {
      await recordUsage(tx, { orgId, kind: d.kind, pages: billed, tokens, status: 'ok', userId });
      const dup = (await tx.query(`select id, created_at from recognition_documents where organization_id = $1 and doc_key = $2 order by created_at limit 1`, [orgId, doc.doc_key])).rows[0];
      const row = (await tx.query(`insert into recognition_documents (organization_id, site_id, receipt_id, kind, doc_key, duplicate_of, result, files, pages, created_by)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`, [orgId, d.siteId, d.receiptId || null, d.kind, doc.doc_key, dup?.id || null, JSON.stringify(doc), files.length, billed, userId])).rows[0];
      await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: 'recognition.document', entityType: 'recognition_document', entityId: row.id,
        after: { type: doc.document_type, number: doc.document_number, lines: doc.items.length, pages: billed, duplicate: !!dup } });
      return { id: row.id as string, duplicate: dup ? { id: dup.id as string, at: dup.created_at as string } : null, document: doc };
    }, d.siteId);
  } catch (e) {
    const msg = (e as Error).message;
    await inOrg(userId, orgId, 'receipt.record', (tx) => recordUsage(tx, { orgId, kind: d.kind, pages: billed, tokens, status: 'failed', error: msg, userId }));
    if (e instanceof SyntaxError) throw Errors.conflict('Модель вернула ответ не в том формате — внесите строки вручную или повторите.');
    throw Errors.conflict(`Распознать не удалось: ${msg}`);
  }
}

/** Запомнить соответствие, выбранное или подтверждённое человеком (MON CHEF V11 rememberOcrAlias). */
export async function rememberAlias(userId: string, orgId: string, input: unknown) {
  const d = parse(z.object({ rawText: z.string().trim().min(2).max(300), productId: z.uuid(), supplier: z.string().trim().max(300).optional().nullable() }), input);
  return inOrg(userId, orgId, 'receipt.record', async (tx) => {
    if (!(await tx.query(`select 1 from products where id = $1 and organization_id = $2`, [d.productId, orgId])).rowCount) throw Errors.notFound('Товар не найден.');
    const raw = norm(d.rawText);
    if (!raw) throw Errors.validation('Пустое название.');
    await tx.query(`insert into recognition_aliases (organization_id, supplier_key, raw_text, raw_norm, product_id, created_by) values ($1, $2, $3, $4, $5, $6)
      on conflict (organization_id, supplier_key, raw_norm) do update set product_id = excluded.product_id, hits = recognition_aliases.hits + 1, updated_at = now()`,
    [orgId, d.supplier ? supplierKey(d.supplier) : '', d.rawText, raw, d.productId, userId]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'recognition.alias', entityType: 'product', entityId: d.productId, after: { raw: d.rawText, supplier: d.supplier || null } });
    return { ok: true };
  });
}
