import { createHash } from 'node:crypto';
import { complete } from '../integrations/yandex';
import { MODEL, type Vis } from './vision';
import { norm } from './match';

/**
 * Извлечение данных документа моделью — перенос MON CHEF V10 (промпт, нормализация, сверка арифметики), V11 (классификация),
 * V12 (вторая проверка моделью только для сомнительных документов, калибровка уверенности, ключ документа для дублей).
 * Промпты — дословно из MON CHEF. Ничего не проводится: результат — черновик, который проверяет человек.
 */

export const LIMITS = { MAX_TEXT_FOR_MODEL: 18000, REVIEW_THRESHOLD: 0.78, AUTOPASS_THRESHOLD: 0.90 };

/** V10 _mcV10InvoicePrompt_ — без изменений. */
export const EXTRACT_PROMPT = 'Ты — модуль извлечения данных из реальных документов кухни/ресторана. ' +
  'Тебе переданы результаты OCR одного изображения. Есть координатные строки, полный текст и иногда Markdown-таблица. ' +
  'Сначала определи тип: retail_receipt, product_receipt, invoice, upd, payment_order или unknown. ' +
  'Никогда не смешивай числа из разных физических строк. Для широкой таблицы используй координаты X/Y и Markdown как взаимную проверку. ' +
  'Для узкого кассового чека учитывай конструкции вида "цена x количество = сумма", а также строки скидок. ' +
  'Для рукописного товарного чека сохраняй текст максимально близко к оригиналу и снижай confidence, если не уверен. ' +
  'Верни ТОЛЬКО JSON: ' +
  '{"document_type":"...","document_number":null,"document_date":null,"supplier":null,"buyer":null,' +
  '"total":null,"recognition_confidence":0.0,"warnings":[],"items":[' +
  '{"line_number":1,"raw_name":"","normalized_name":"","quantity":null,"unit":null,' +
  '"price":null,"sum":null,"vat":null,"batch_number":null,"expiry_date":null,"confidence":0.0}]} . ' +
  'Правила: ' +
  '1) raw_name — что реально видно; не додумывай. ' +
  '2) quantity, price и sum должны соответствовать одной позиции. ' +
  '3) Если в документе цена за кг/шт и количество даны отдельно — вычисляй отсутствующее только арифметически. ' +
  '4) Не превращай скидку, НДС, итоги, ИНН, ФН, ФД, ККТ, QR, адрес и телефоны в товар. ' +
  '5) Для розничного чека магазин — supplier. ' +
  '6) Единицу измерения не придумывай: если явно нет единицы, null; затем сервер может предложить нормализацию. ' +
  '7) Дату всегда ISO YYYY-MM-DD, если уверенно прочитана. ' +
  '8) Если строка сомнительная — confidence < 0.75 и добавь предупреждение. ' +
  '9) Для УПД/счёта различай цену без НДС, ставку НДС и итоговую стоимость. ' +
  '10) Если документ имеет рукописные изменения, отдельно укажи это в warnings.';

/** V12 _mcV12AuditPrompt_ — без изменений. */
export const AUDIT_PROMPT = 'Ты проверяешь результат OCR документа кухни. Тебе дан OCR-текст и JSON извлечения. Не переписывай документ целиком. Верни ТОЛЬКО JSON: ' +
  '{"ok":true,"document_number":null,"document_date":null,"supplier":null,"total":null,"line_corrections":[],"warnings":[]}. ' +
  'line_corrections содержит только реально подтверждаемые исправления: [{"line_number":1,"raw_name":null,"quantity":null,"unit":null,"price":null,"sum":null}]. ' +
  'Ничего не угадывай. Если данных недостаточно — оставь null. Проверяй прежде всего числа, номер, дату, поставщика и соответствие quantity*price≈sum.';

/** V10 _mcV10PackOcrText_: координатные строки, Markdown Vision, полный текст. */
export function packOcrText(vis: Pick<Vis, 'layoutText' | 'fullText' | 'markdown'>) {
  const layout = String(vis.layoutText || vis.fullText || '').trim(), full = String(vis.fullText || '').trim(), md = String(vis.markdown || '').trim();
  const parts = [`=== КООРДИНАТНЫЕ СТРОКИ ===\n${layout}`];
  if (md) parts.push(`=== MARKDOWN / ТАБЛИЦЫ VISION ===\n${md}`);
  if (full && full !== layout) parts.push(`=== ПОЛНЫЙ ТЕКСТ ===\n${full}`);
  const out = parts.join('\n\n');
  return out.length > LIMITS.MAX_TEXT_FOR_MODEL ? out.slice(0, LIMITS.MAX_TEXT_FOR_MODEL) : out;
}

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function isoDate(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim().replace(/\./g, '-').replace(/\//g, '-');
  const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (m) { let y = Number(m[3]); if (y < 100) y += 2000; return `${y}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`; }
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Ответ модели → объект (V10: убрать ```json, взять JSON). */
export function parseModelJson(raw: string): Record<string, unknown> {
  const t = String(raw || '').replace(/```json|```/g, '').trim();
  return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
}

/**
 * Тип документа по тексту (V11 _mcV11Classify_). Адаптация ЦЕХ: товарно-транспортная накладная и ТОРГ-12 → WAYBILL
 * (в MON CHEF их не было; на реальной накладной METRO форма 1-Т классифицировалась бы по ответу модели).
 */
export function classify(text: string, llmType: string) {
  const s = String(text || '').toLowerCase().replace(/ё/g, 'е');
  if (/универсальн.{0,25}передаточн|\bупд\b/.test(s)) return 'UPD';
  if (/счет\s+на\s+оплату/.test(s)) return 'INVOICE';
  if (/товарно-?\s*транспортн.{0,10}накладн|товарн.{0,10}накладн|торг-12/.test(s)) return 'WAYBILL';
  if (/платежн.{0,25}поручен|образец заполнения платежного поручения/.test(s)) return 'PAYMENT_ORDER';
  if (/формат мероприятия|место проведения|количество персон|пожелания/.test(s)) return 'BANQUET_ORDER';
  if (/пятерочка|x5 клуб|ккм|ккт|фн\s*[:№]|фд\s*[:№]|кассовый чек/.test(s)) return 'RETAIL_RECEIPT';
  if (/магнит|карта магнит/.test(s)) return 'RETAIL_RECEIPT';
  if (/товарный чек|подпись продавца|наименование товара/.test(s)) return 'PRODUCT_RECEIPT';
  return String(llmType || 'UNKNOWN').toUpperCase();
}

/** Калибровка уверенности (V12 _mcV12Calibrate_). */
export function calibrate(rawConf: unknown, visQuality: number, matchConf: number | null, arithOk: boolean, docType: string) {
  let c = num(rawConf);
  if (c === null) c = Number(visQuality) || 0;
  c = Math.max(0, Math.min(1, c));
  if (matchConf !== null && matchConf !== undefined) c = c * 0.78 + Math.max(0, Math.min(1, Number(matchConf) || 0)) * 0.22;
  if (arithOk === false) c -= 0.14;
  if (docType === 'PRODUCT_RECEIPT') c -= 0.04;
  if (docType === 'RETAIL_RECEIPT' && arithOk === true) c += 0.03;
  return Math.round(Math.max(0, Math.min(1, c)) * 100) / 100;
}

export interface Extracted { document_type?: string; document_number?: string | null; document_date?: string | null; supplier?: string | null; buyer?: string | null; total?: unknown;
  recognition_confidence?: unknown; warnings?: unknown[]; items?: Record<string, unknown>[]; _audit?: string }

/** Применить вторую проверку (V12 _mcV12ApplyAudit_): только подтверждаемые исправления. */
export function applyAudit(ext: Extracted, audit: Record<string, unknown> | null): Extracted {
  if (!audit) return ext;
  if (audit.document_number && !ext.document_number) ext.document_number = String(audit.document_number);
  if (audit.document_date && !ext.document_date) ext.document_date = String(audit.document_date);
  if (audit.supplier && !ext.supplier) ext.supplier = String(audit.supplier);
  if (audit.total !== null && audit.total !== undefined && (ext.total === null || ext.total === undefined)) ext.total = audit.total;
  const items = Array.isArray(ext.items) ? ext.items : [];
  for (const c of (Array.isArray(audit.line_corrections) ? audit.line_corrections : []) as Record<string, unknown>[]) {
    const n = Number(c.line_number) - 1;
    if (n < 0 || n >= items.length) continue;
    for (const k of ['raw_name', 'quantity', 'unit', 'price', 'sum']) if (c[k] !== null && c[k] !== undefined && c[k] !== '') items[n][k] = c[k];
    items[n].confidence = Math.max(Number(items[n].confidence) || 0, 0.82);
  }
  if (Array.isArray(audit.warnings)) ext.warnings = [...(ext.warnings || []), ...audit.warnings.map(String)];
  ext._audit = audit.ok !== false ? 'SECOND_PASS_OK' : 'SECOND_PASS_WARNINGS';
  return ext;
}

export interface Line { line_number: number; raw_name: string; normalized_name: string; quantity: number | null; unit: string | null; price: number | null; sum: number | null; vat: number | null;
  batch_number: string | null; expiry_date: string | null; confidence: number; calculation_mismatch: boolean; requires_manual_review: boolean;
  matched_product: { id: string; name: string; unit: string; confidence: number; source: string } | null; alternatives: { id: string; name: string; unit: string; confidence: number; source: string }[] }
export interface Doc { document_type: string; document_number: string | null; document_date: string | null; supplier: string | null; buyer: string | null; total: number | null;
  recognition_confidence: number; items: Line[]; warnings: string[]; requires_manual_review: boolean; auto_accept: boolean; second_pass: string | null; doc_key: string;
  ocr: { model: string; quality: number; pages: number; orient: number[]; text: string } }

type Resolver = (raw: string) => { matched: Line['matched_product']; alternatives: Line['alternatives'] };

/** Итог разбора (V12 _mcV12Finalize_): арифметика строк, сопоставление, калибровка, порог ручной проверки. */
export function finalize(ext: Extracted, vis: Pick<Vis, 'layoutText' | 'fullText' | 'markdown' | 'quality' | 'model' | 'pages' | 'orient'>, resolve: Resolver): Doc {
  const rawText = String(vis.layoutText || vis.fullText || '');
  const type = classify(rawText, String(ext.document_type || 'unknown'));
  const supplier = String(ext.supplier || '').trim();
  const warnings: string[] = Array.isArray(ext.warnings) ? ext.warnings.map(String) : [];
  let total = 0, review = 0, allArith = true;
  const items: Line[] = (Array.isArray(ext.items) ? ext.items : []).map((it, idx) => {
    const raw = String(it.raw_name || it.name || '').trim();
    const resolved = resolve(raw);
    const q = num(it.quantity);
    let p = num(it.price), sum = num(it.sum), mismatch = false;
    if (q !== null && p !== null && sum !== null) mismatch = Math.abs(q * p - sum) > Math.max(1, Math.abs(sum) * 0.02);
    if (mismatch) allArith = false;
    if (sum === null && q !== null && p !== null) sum = Math.round(q * p * 100) / 100;
    if (p === null && q !== null && sum !== null && q > 0) p = Math.round(sum / q * 100) / 100;
    if (sum !== null) total += sum;
    let base = num(it.confidence);
    if (base === null) base = vis.quality;
    const mc = resolved.matched ? Number(resolved.matched.confidence) || 0 : null;
    const conf = calibrate(base, vis.quality, mc, !mismatch, type);
    const needs = !raw || q === null || q <= 0 || mismatch || conf < LIMITS.REVIEW_THRESHOLD || !resolved.matched;
    if (needs) review++;
    if (!resolved.matched) warnings.push(`Строка ${idx + 1}: нет уверенного соответствия номенклатуре.`);
    if (mismatch) warnings.push(`Строка ${idx + 1}: количество × цена не совпадает с суммой.`);
    return { line_number: Number(it.line_number) || idx + 1, raw_name: raw, normalized_name: String(it.normalized_name || raw).trim(), quantity: q, unit: it.unit ? String(it.unit).trim() : null,
      price: p, sum, vat: num(it.vat), batch_number: it.batch_number ? String(it.batch_number) : null, expiry_date: isoDate(it.expiry_date), confidence: conf,
      calculation_mismatch: mismatch, requires_manual_review: needs, matched_product: resolved.matched, alternatives: resolved.alternatives };
  });
  const docConf = calibrate(ext.recognition_confidence, vis.quality, items.length ? items.reduce((s, x) => s + (x.confidence || 0), 0) / items.length : null, allArith, type);
  if (vis.model === MODEL.HANDWRITTEN) warnings.push('Использован дополнительный проход OCR для рукописного текста.');
  if (review) warnings.push(`Требуют проверки: ${review} строк(и).`);
  if (vis.quality < 0.68) warnings.push('Низкое качество исходного OCR.');
  const doc: Doc = {
    document_type: type, document_number: ext.document_number ? String(ext.document_number) : null, document_date: isoDate(ext.document_date), supplier: supplier || null,
    buyer: ext.buyer ? String(ext.buyer) : null, total: ext.total !== null && ext.total !== undefined ? num(ext.total) : (total ? Math.round(total * 100) / 100 : null),
    recognition_confidence: docConf, items, warnings, requires_manual_review: review > 0 || warnings.length > 0, auto_accept: false, second_pass: ext._audit || null, doc_key: '',
    ocr: { model: vis.model, quality: vis.quality, pages: vis.pages, orient: vis.orient, text: rawText },
  };
  doc.doc_key = docKey(doc);
  doc.auto_accept = docConf >= LIMITS.AUTOPASS_THRESHOLD && review === 0;
  return doc;
}

/** Ключ документа для поиска дублей (V12 _mcV12DocKey_). */
export function docKey(doc: Pick<Doc, 'document_type' | 'supplier' | 'document_number' | 'document_date' | 'total' | 'items'>) {
  const parts = [doc.document_type || '', doc.supplier || '', doc.document_number || '', doc.document_date || '', num(doc.total) ?? ''];
  const lines = (doc.items || []).slice(0, 30).map((x) => `${norm(x.raw_name)}|${num(x.quantity) ?? ''}|${num(x.sum) ?? ''}`).join('~');
  return createHash('sha256').update(`${parts.join('|')}|${lines}`).digest('base64url');
}

/** Разбор моделью (V10 _mcV10CallGpt_). */
export async function extractWithModel(vis: Vis): Promise<{ ext: Extracted; tokens: number }> {
  const r = await complete(EXTRACT_PROMPT, packOcrText(vis), 4000);
  return { ext: parseModelJson(r.text) as Extracted, tokens: r.tokens };
}

/** Вторая проверка моделью (V12 _mcV12AuditExtraction_). Ошибка проверки не ломает разбор. */
export async function auditWithModel(vis: Vis, ext: Extracted): Promise<{ audit: Record<string, unknown> | null; tokens: number }> {
  try {
    const r = await complete(AUDIT_PROMPT, `=== OCR ===\n${packOcrText(vis)}\n\n=== EXTRACTED JSON ===\n${JSON.stringify(ext)}`, 2500);
    return { audit: parseModelJson(r.text), tokens: r.tokens };
  } catch { return { audit: null, tokens: 0 }; }
}
