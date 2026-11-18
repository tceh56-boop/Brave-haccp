import { assertFiscalNotDuplicate } from './integrations';
import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText, getSite, assertSiteAccess, openTask, fmtNum, notifyRoles } from './common';
import { markOrderReceived } from './purchasing';
import { raiseIncident } from './incidents';
import { norm, supplierKey } from '../recognition/match';
import { affectedDishes, dishCosts, priceSnapshot, diffImpact } from './priceImpact';
import { roleHas } from '../access/roles';

/**
 * Приёмка (ТЗ v2 §3, §4, §12, AT-01). Сотрудник вносит строку один раз: товар, количество, партию, даты
 * маркировки, результаты проверок, температуру. При завершении одной операцией система:
 *  - создаёт партии (принятые — в доступный остаток, карантинные — нет);
 *  - для партии без подтверждённого срока — задача «Срок не подтверждён» (AT-02);
 *  - для карантина — отклонение «проблемная приёмка» и задача решения;
 *  - пишет аудит. Склад обновляется только после завершения приёмки.
 */

export const RECEIPT_STATUS_LABEL: Record<string, string> = {
  draft: 'Черновик', accepted: 'Принято', review: 'На проверке', quarantine: 'Карантин', rejected: 'Отказано', returned: 'Возвращено',
};
export const CHECKS = { packaging: 'Целостность упаковки', labeling: 'Маркировка', documents: 'Документы', quality: 'Качество (органолептика)' } as const;
type CheckKey = keyof typeof CHECKS;

const CreateInput = z.object({
  siteId: z.uuid(),
  supplierId: z.uuid().optional().nullable(),
  documentNo: optText(60),
  documentDate: z.iso.date().optional().nullable(),
  pricesWithVat: z.boolean().optional(),          // не указано — как принято у предприятия
});

/* ───────────── Деньги накладной ───────────── */

const r2 = (x: number) => Math.round(x * 100) / 100, r4 = (x: number) => Math.round(x * 10000) / 10000;

/**
 * Цена для себестоимости. Предприятие на АУСН или патенте НДС к вычету не принимает, поэтому себестоимость — полная
 * цена с НДС поставщика: цена документа «без НДС» доводится до цены с НДС по ставке из документа. Нет ставки — «без НДС».
 */
export function costPrice(docPrice: number | null, vatRate: number | null, pricesWithVat: boolean) {
  if (docPrice === null) return null;
  return pricesWithVat || vatRate === null ? docPrice : r4(docPrice * (1 + vatRate / 100));
}
/** НДС в том числе в сумме строки с НДС: сумма × ставка / (100 + ставка). */
export const vatIn = (gross: number, vatRate: number | null) => (vatRate ? r2(gross * vatRate / (100 + vatRate)) : 0);

/** Суммы документа по строкам: всего с НДС (все строки, как в документе), НДС в т. ч., к оплате (без отказанных) + доп. расходы. */
export function invoiceTotals(lines: { quantity: number | string; unit_price: number | string | null; vat_rate: number | string | null; decision: string }[], extraCosts: number) {
  let total: number | null = 0, vat = 0, payable: number | null = 0;
  for (const l of lines) {
    if (l.unit_price === null) { total = null; if (l.decision !== 'rejected') payable = null; continue; }
    const gross = r2(Number(l.quantity) * Number(l.unit_price));
    if (total !== null) total = r2(total + gross);
    vat = r2(vat + vatIn(gross, l.vat_rate === null ? null : Number(l.vat_rate)));
    if (l.decision !== 'rejected' && payable !== null) payable = r2(payable + gross);
  }
  return { lines_total: total, vat_total: vat, payable: payable === null ? null : r2(payable + extraCosts) };
}
/** Допуск на округление при сверке с итогом документа: копейка на строку. */
const tolerance = (n: number) => r2(0.01 * Math.max(1, n));

export async function createReceipt(userId: string, orgId: string, input: unknown) {
  const d = parse(CreateInput, input);
  return inOrg(userId, orgId, 'receipt.record', async (tx) => {
    await getSite(tx, orgId, d.siteId);
    if (d.supplierId && !(await tx.query(`select 1 from suppliers where id = $1 and organization_id = $2`, [d.supplierId, orgId])).rowCount) throw Errors.validation('Поставщик не найден.');
    const withVat = d.pricesWithVat ?? (await tx.query(`select invoice_prices_with_vat from organizations where id = $1`, [orgId])).rows[0].invoice_prices_with_vat;
    const r = (await tx.query(`insert into receipts (organization_id, site_id, supplier_id, document_no, document_date, prices_with_vat, created_by) values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      [orgId, d.siteId, d.supplierId || null, d.documentNo, d.documentDate || null, withVat, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: 'receipt.create', entityType: 'receipt', entityId: r.id, after: r });
    return r;
  }, d.siteId);
}

const num = z.union([z.number(), z.string().trim().regex(/^-?\d+([.,]\d+)?$/, 'Введите число.').transform((s) => Number(s.replace(',', '.')))]);
const check = z.boolean().nullable().optional();

const LineInput = z.object({
  productId: z.uuid(),
  quantity: num.refine((v) => v > 0, 'Количество больше нуля.'),
  lotNo: optText(60),
  manufacturedAt: z.iso.date().optional().nullable(),
  expiresAt: z.iso.date().optional().nullable(),
  expiryBasis: optText(300),
  temperature: num.optional().nullable(),
  checks: z.object({ packaging: check, labeling: check, documents: check, quality: check }).default({}),
  decision: z.enum(['accepted', 'quarantine', 'rejected']),
  decisionReason: optText(500),
  storageObjectId: z.uuid().optional().nullable(),
  unitPrice: num.refine((v) => v >= 0, 'Цена не может быть отрицательной.').optional().nullable(),   // ₽ за единицу товара, как в документе
  vatRate: num.refine((v) => v >= 0 && v <= 30, 'Ставка НДС — из документа, от 0 до 30 %.').optional().nullable(),   // пусто — «без НДС»
  manufacturer: optText(300),          // изготовитель по маркировке
  vsdNo: optText(100),                 // ВСД (ФГИС «Меркурий»), если применимо
  storageConditions: optText(300),     // условия хранения по маркировке
}).superRefine((l, ctx) => {
  if (l.expiresAt && !l.expiryBasis) ctx.addIssue({ code: 'custom', message: 'Срок годности указан — укажите основание (например, «маркировка изготовителя»).' });
  if (l.decision === 'accepted') {
    const missing = (Object.keys(CHECKS) as CheckKey[]).filter((k) => l.checks[k] !== true);
    if (missing.length) ctx.addIssue({ code: 'custom', message: `Принять можно только при пройденных проверках: ${missing.map((k) => CHECKS[k]).join(', ')}. Иначе — карантин или отказ с причиной.` });
  } else if (!l.decisionReason) {
    ctx.addIssue({ code: 'custom', message: l.decision === 'quarantine' ? 'Укажите причину карантина.' : 'Укажите причину отказа.' });
  }
  if (l.manufacturedAt && l.expiresAt && l.expiresAt < l.manufacturedAt) ctx.addIssue({ code: 'custom', message: 'Срок годности раньше даты изготовления.' });
});

async function draftReceipt(tx: Tx, orgId: string, receiptId: string, m: { site_ids: string[] }) {
  const r = (await tx.query(`select * from receipts where id = $1 and organization_id = $2 for update`, [receiptId, orgId])).rows[0];
  if (!r) throw Errors.notFound('Приёмка не найдена.');
  assertSiteAccess(m as never, r.site_id);
  if (r.status !== 'draft') throw Errors.conflict('Приёмка уже завершена — изменения вносятся корректировкой.');
  return r;
}

export async function addReceiptLine(userId: string, orgId: string, receiptId: string, input: unknown) {
  const d = parse(LineInput, input);
  return inOrg(userId, orgId, 'receipt.record', async (tx, m) => insertLine(tx, orgId, await draftReceipt(tx, orgId, receiptId, m), d));
}

async function insertLine(tx: Tx, orgId: string, r: { id: string; site_id: string; prices_with_vat: boolean }, d: z.infer<typeof LineInput>) {
  {
    const p = (await tx.query(`select id, unit from products where id = $1 and organization_id = $2 and status = 'active'`, [d.productId, orgId])).rows[0];
    if (!p) throw Errors.validation('Товар не найден в справочнике.');
    if (d.storageObjectId && !(await tx.query(`select 1 from control_objects where id = $1 and site_id = $2 and status = 'active'`, [d.storageObjectId, r.site_id])).rowCount)
      throw Errors.validation('Место хранения не найдено на этой площадке.');
    if (d.expiresAt && d.decision === 'accepted') {
      const past = (await tx.query(`select (($1::date + time '23:59:59') at time zone (select timezone from organizations where id = $2)) < now() as past`, [d.expiresAt, orgId])).rows[0].past;
      if (past) throw Errors.validation('Срок годности уже истёк — принять нельзя. Отказ или возврат поставщику с причиной.');
    }
    // Срок «до даты» — до конца этих суток по часовому поясу предприятия.
    const line = (await tx.query(`insert into receipt_lines (organization_id, receipt_id, product_id, quantity, unit, lot_no, manufactured_at, expires_at, expiry_basis, temperature, checks, decision, decision_reason, storage_object_id, unit_price, doc_price, vat_rate, manufacturer, vsd_no, storage_conditions)
      values ($1, $2, $3, $4, $5, $6, $7, ($8::date + time '23:59:59') at time zone (select timezone from organizations where id = $1), $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) returning *`,
      [orgId, r.id, p.id, d.quantity, p.unit, d.lotNo, d.manufacturedAt || null, d.expiresAt || null, d.expiryBasis, d.temperature ?? null,
        JSON.stringify(d.checks), d.decision, d.decisionReason, d.storageObjectId || null, costPrice(d.unitPrice ?? null, d.vatRate ?? null, r.prices_with_vat), d.unitPrice ?? null, d.vatRate ?? null,
        d.manufacturer ?? null, d.vsdNo ?? null, d.storageConditions ?? null])).rows[0];
    return line;
  }
}

/** Единица из документа → единица справочника (кг/л/шт и их написания); неизвестная — null. */
const UNIT_SYN: Record<string, string> = { 'кг': 'кг', 'kg': 'кг', 'килограмм': 'кг', 'г': 'г', 'гр': 'г', 'грамм': 'г', 'л': 'л', 'l': 'л', 'литр': 'л', 'мл': 'мл', 'шт': 'шт', 'штук': 'шт', 'штука': 'шт', 'pcs': 'шт', 'уп': 'уп', 'упак': 'уп' };
export function docUnit(u: string | null | undefined) {
  const k = String(u || '').toLowerCase().replace(/[.\s]/g, '');
  return UNIT_SYN[k] || null;
}

const FromDocInput = z.object({
  documentId: z.uuid(),
  lines: z.array(z.object({ lineNumber: z.number().int().min(1), productId: z.uuid() })).min(1, 'Выберите строки.').max(200),
  checks: z.object({ packaging: check, labeling: check, documents: check, quality: check }),
  temperature: num.optional().nullable(),
  storageObjectId: z.uuid().optional().nullable(),
});

/**
 * Принять строки распознанной накладной одним действием (как «подтвердить накладную» в версии на Google Диске).
 * Количество, цена, партия и срок берутся из сохранённого на сервере результата распознавания, не из браузера.
 * Проверки приёмки человек подтверждает для всей поставки; строка с несходящейся суммой, неизвестной или другой
 * единицей не принимается автоматически — её вносят вручную. Выбор товара запоминается для поставщика.
 */
export async function acceptFromDocument(userId: string, orgId: string, receiptId: string, input: unknown) {
  const d = parse(FromDocInput, input);
  const notYes = (Object.keys(CHECKS) as CheckKey[]).filter((k) => d.checks[k] !== true);
  if (notYes.length) throw Errors.validation(`Подтвердите проверки поставки: ${notYes.map((k) => CHECKS[k]).join(', ')}. Если что-то не так — вносите строки по одной с карантином или отказом.`);
  return inOrg(userId, orgId, 'receipt.record', async (tx, m) => {
    const r = await draftReceipt(tx, orgId, receiptId, m);
    const doc = (await tx.query(`select id, result, applied_lines from recognition_documents where id = $1 and organization_id = $2 and site_id = $3 and (receipt_id is null or receipt_id = $4)`,
      [d.documentId, orgId, r.site_id, r.id])).rows[0];
    if (!doc) throw Errors.notFound('Распознанный документ не найден для этой приёмки.');
    const items = (doc.result.items || []) as { line_number: number; raw_name: string; quantity: number | null; unit: string | null; price: number | null; vat: number | null; batch_number: string | null; expiry_date: string | null; calculation_mismatch: boolean }[];
    const problems: string[] = [];
    const plan: { it: (typeof items)[number]; productId: string; unit: string }[] = [];
    for (const l of d.lines) {
      const it = items.find((x) => x.line_number === l.lineNumber);
      if (!it) { problems.push(`строка ${l.lineNumber}: нет в документе`); continue; }
      if ((doc.applied_lines as number[]).includes(l.lineNumber)) { problems.push(`строка ${l.lineNumber} «${it.raw_name}»: уже принята из этого документа`); continue; }
      const p = (await tx.query(`select id, name, unit from products where id = $1 and organization_id = $2 and status = 'active'`, [l.productId, orgId])).rows[0];
      if (!p) { problems.push(`строка ${l.lineNumber}: товар не найден`); continue; }
      if (it.calculation_mismatch) { problems.push(`строка ${l.lineNumber} «${it.raw_name}»: сумма не сходится — внесите вручную`); continue; }
      if (!it.quantity || it.quantity <= 0) { problems.push(`строка ${l.lineNumber} «${it.raw_name}»: количество не распознано`); continue; }
      const u = docUnit(it.unit);
      if (!u) { problems.push(`строка ${l.lineNumber} «${it.raw_name}»: единица «${it.unit || '?'}» не распознана — внесите вручную`); continue; }
      if (u !== p.unit) { problems.push(`строка ${l.lineNumber} «${it.raw_name}»: в документе ${u}, у товара «${p.name}» — ${p.unit}; внесите вручную с пересчётом`); continue; }
      plan.push({ it, productId: p.id, unit: p.unit });
    }
    if (problems.length) throw Errors.validation(`Не принято ни одной строки: ${problems.join('; ')}.`);
    const added = [];
    for (const x of plan) {
      added.push(await insertLine(tx, orgId, r, parse(LineInput, {
        productId: x.productId, quantity: x.it.quantity, lotNo: x.it.batch_number || null, expiresAt: x.it.expiry_date || null,
        expiryBasis: x.it.expiry_date ? 'сопроводительный документ (распознанная накладная)' : null, temperature: d.temperature ?? null,
        checks: d.checks, decision: 'accepted', storageObjectId: d.storageObjectId || null, unitPrice: x.it.price ?? null,
        // ставка НДС из документа (не сумма): берётся, только если распознанное значение — правдоподобная ставка
        vatRate: typeof x.it.vat === 'number' && x.it.vat >= 0 && x.it.vat <= 30 ? x.it.vat : null,
      })));
      const raw = norm(x.it.raw_name);
      if (raw) await tx.query(`insert into recognition_aliases (organization_id, supplier_key, raw_text, raw_norm, product_id, created_by) values ($1, $2, $3, $4, $5, $6)
        on conflict (organization_id, supplier_key, raw_norm) do update set product_id = excluded.product_id, hits = recognition_aliases.hits + 1, updated_at = now()`,
      [orgId, doc.result.supplier ? supplierKey(doc.result.supplier) : '', x.it.raw_name, raw, x.productId, userId]);
    }
    await tx.query(`update recognition_documents set applied_lines = applied_lines || $2::int[] where id = $1`, [doc.id, plan.map((x) => x.it.line_number)]);
    if (!r.document_no && doc.result.document_number) await tx.query(`update receipts set document_no = $2 where id = $1`, [r.id, doc.result.document_number]);
    if (r.doc_total === null && typeof doc.result.total === 'number' && doc.result.total >= 0) await tx.query(`update receipts set doc_total = $2 where id = $1`, [r.id, doc.result.total]);
    await audit.record(tx, { organizationId: orgId, siteId: r.site_id, actorUserId: userId, action: 'receipt.lines_from_document', entityType: 'receipt', entityId: r.id,
      after: { document: d.documentId, lines: added.length, checks: d.checks } });
    return { added: added.length };
  });
}

const TermsInput = z.object({
  pricesWithVat: z.boolean().optional(),
  docTotal: num.refine((v) => v >= 0, 'Итог документа не меньше нуля.').optional().nullable(),
  extraCosts: num.refine((v) => v >= 0 && v <= 1e9, 'Доп. расходы не меньше нуля.').optional(),
  extraCostsNote: optText(200),
  totalMismatchReason: optText(300),
  documentNo: optText(60),
  documentDate: z.iso.date().optional().nullable(),
}).refine((x) => !x.extraCosts || !!x.extraCostsNote, 'Укажите, что за доп. расходы (доставка, тара…).');

/** Реквизиты и деньги черновика накладной. Смена «цены с НДС / без НДС» пересчитывает цены строк для себестоимости. */
export async function updateReceiptTerms(userId: string, orgId: string, receiptId: string, input: unknown) {
  const d = parse(TermsInput, input);
  const given = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  return inOrg(userId, orgId, 'receipt.record', async (tx, m) => {
    const r = await draftReceipt(tx, orgId, receiptId, m);
    const sets: string[] = [], vals: unknown[] = [r.id];
    const put = (col: string, v: unknown) => { vals.push(v); sets.push(col + ' = $' + vals.length); };
    if (d.pricesWithVat !== undefined) put('prices_with_vat', d.pricesWithVat);
    if (Object.hasOwn(given, 'docTotal')) put('doc_total', d.docTotal ?? null);
    if (d.extraCosts !== undefined) { put('extra_costs', d.extraCosts); put('extra_costs_note', d.extraCosts ? d.extraCostsNote : null); }
    if (Object.hasOwn(given, 'totalMismatchReason')) put('total_mismatch_reason', d.totalMismatchReason);
    if (Object.hasOwn(given, 'documentNo')) put('document_no', d.documentNo);
    if (Object.hasOwn(given, 'documentDate')) put('document_date', d.documentDate || null);
    if (!sets.length) return r;
    const after = (await tx.query('update receipts set ' + sets.join(', ') + ' where id = $1 returning *', vals)).rows[0];
    if (d.pricesWithVat !== undefined && d.pricesWithVat !== r.prices_with_vat) {
      for (const l of (await tx.query(`select id, doc_price, vat_rate from receipt_lines where receipt_id = $1`, [r.id])).rows)
        await tx.query(`update receipt_lines set unit_price = $2 where id = $1`, [l.id, costPrice(l.doc_price === null ? null : Number(l.doc_price), l.vat_rate === null ? null : Number(l.vat_rate), d.pricesWithVat)]);
    }
    await audit.record(tx, { organizationId: orgId, siteId: r.site_id, actorUserId: userId, action: 'receipt.terms', entityType: 'receipt', entityId: r.id,
      before: { prices_with_vat: r.prices_with_vat, doc_total: r.doc_total, extra_costs: r.extra_costs }, after: { prices_with_vat: after.prices_with_vat, doc_total: after.doc_total, extra_costs: after.extra_costs } });
    return after;
  });
}

export async function removeReceiptLine(userId: string, orgId: string, receiptId: string, lineId: string) {
  return inOrg(userId, orgId, 'receipt.record', async (tx, m) => {
    await draftReceipt(tx, orgId, receiptId, m);
    const n = (await tx.query(`delete from receipt_lines where id = $1 and receipt_id = $2`, [lineId, receiptId])).rowCount;
    if (!n) throw Errors.notFound('Строка не найдена.');
    return { ok: true };
  });
}

export async function completeReceipt(userId: string, orgId: string, receiptId: string) {
  return inOrg(userId, orgId, 'receipt.record', async (tx, m) => {
    const r = await draftReceipt(tx, orgId, receiptId, m);
    await assertFiscalNotDuplicate(tx, orgId, r.id);   // тот же кассовый чек уже проведён — повторной приёмки нет
    const lines = (await tx.query(`select l.*, p.name as product from receipt_lines l join products p on p.id = l.product_id where l.receipt_id = $1 order by l.created_at`, [r.id])).rows;
    if (!lines.length) throw Errors.validation('Добавьте хотя бы одну позицию.');
    // сверка с итогом документа: сумма всех строк (как в документе, с НДС) против «Всего к оплате»
    const extra = Number(r.extra_costs);
    const totals = invoiceTotals(lines, extra);
    let mismatch = false;
    if (r.doc_total !== null) {
      const diff = totals.lines_total === null ? null : r2(totals.lines_total - Number(r.doc_total));
      if (diff === null || Math.abs(diff) > tolerance(lines.length)) {
        mismatch = true;
        if (!r.total_mismatch_reason) throw Errors.validation(diff === null
          ? `Итог документа ${fmtNum(Number(r.doc_total))} ₽ не сверить: у части строк нет цены. Укажите цены или причину расхождения.`
          : `Сумма строк ${fmtNum(totals.lines_total!)} ₽ не сходится с итогом документа ${fmtNum(Number(r.doc_total))} ₽ (разница ${fmtNum(diff)} ₽). Проверьте количество и цены или укажите причину расхождения.`);
      }
    }
    // доп. расходы (доставка, тара) — на принятые строки с ценой пропорционально сумме строки: входят в цену партии
    const share = new Map<string, number>();
    const base = lines.filter((l) => l.decision !== 'rejected' && l.unit_price !== null).map((l) => ({ id: l.id as string, q: Number(l.quantity), sum: Number(l.quantity) * Number(l.unit_price) }));
    const baseSum = base.reduce((s, x) => s + x.sum, 0);
    if (extra > 0 && baseSum <= 0) throw Errors.validation('Доп. расходы распределяются на принятые строки с ценой — таких строк нет.');
    if (extra > 0) for (const x of base) share.set(x.id, x.sum / baseSum * extra / x.q);
    const created = { lots: 0, quarantine: 0, rejected: 0, unconfirmed: 0, tasks: 0, incidents: 0 };
    // каскад цен: цена товаров с ценой в приёмке и себестоимость затронутых блюд — до и после прихода
    const priced = lines.filter((l) => l.decision !== 'rejected' && l.unit_price !== null);
    const pids = [...new Set(priced.map((l) => l.product_id as string))];
    const names = new Map(lines.map((l) => [l.product_id as string, l.product as string]));
    const dishIds = await affectedDishes(tx, orgId, pids);
    const pricesBefore = await priceSnapshot(tx, orgId, pids), costsBefore = await dishCosts(tx, orgId, dishIds);
    for (const l of lines) {
      if (l.decision === 'rejected') { created.rejected++; continue; }
      const status = l.decision === 'accepted' ? 'available' : 'quarantine';
      const lot = (await tx.query(`insert into lots (organization_id, site_id, product_id, receipt_line_id, lot_no, quantity, unit, manufactured_at, expires_at, expiry_basis, storage_object_id, status, status_reason, unit_price, storage_conditions)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id`,
        [orgId, r.site_id, l.product_id, l.id, l.lot_no, l.quantity, l.unit, l.manufactured_at, l.expires_at, l.expiry_basis, l.storage_object_id, status, l.decision_reason,
          l.unit_price === null ? null : r4(Number(l.unit_price) + (share.get(l.id) || 0)), l.storage_conditions])).rows[0];
      await tx.query(`update receipt_lines set lot_id = $2 where id = $1`, [l.id, lot.id]);
      // Приход — первое движение партии в журнале склада.
      await tx.query(`insert into stock_movements (organization_id, site_id, lot_id, product_id, kind, quantity, unit, reason, ref_type, ref_id, created_by)
        values ($1, $2, $3, $4, 'receipt', $5, $6, $7, 'receipt', $8, $9)`, [orgId, r.site_id, lot.id, l.product_id, l.quantity, l.unit, `приёмка ${r.document_no || ''}`.trim(), r.id, userId]);
      created.lots++;
      if (!l.expires_at) {
        created.unconfirmed++;
        if (await openTask(tx, { orgId, siteId: r.site_id, kind: 'confirm_expiry', title: `Срок не подтверждён: ${l.product}`,
          details: `Партия ${l.lot_no || 'без номера'} из приёмки ${r.document_no || ''}. Укажите срок и его основание (маркировка изготовителя, удостоверение качества).`.trim(),
          entityType: 'lot', entityId: lot.id, assigneeRole: 'chef', dueAt: new Date(Date.now() + 4 * 3600e3), createdBy: userId })) created.tasks++;
      }
      if (status === 'quarantine') {
        created.quarantine++;
        if (await openTask(tx, { orgId, siteId: r.site_id, kind: 'quarantine_decision', title: `Решение по карантину: ${l.product}`, details: l.decision_reason,
          entityType: 'lot', entityId: lot.id, assigneeRole: 'haccp_lead', dueAt: new Date(Date.now() + 4 * 3600e3), createdBy: userId })) created.tasks++;
        const temp = l.temperature !== null ? ` Температура при приёмке: ${fmtNum(l.temperature)} °C.` : '';
        await raiseIncident(tx, { orgId, siteId: r.site_id, severity: 'medium', kind: 'receipt_problem', title: `Карантин при приёмке: ${l.product}`,
          what: `Партия ${l.lot_no || 'без номера'}, ${fmtNum(l.quantity)} ${l.unit}. Причина: ${l.decision_reason}.${temp}`, entityType: 'lot', entityId: lot.id,
          responsibleRole: 'haccp_lead', dueMinutes: 240, recommendedAction: 'Проверьте партию и документы; допустите с основанием или забракуйте.', createdBy: userId, notify: ['haccp_lead', 'chef'] });
        created.incidents++;
      }
    }
    const status = created.rejected === lines.length ? 'rejected' : created.quarantine ? 'quarantine' : 'accepted';
    // срок оплаты: дата документа (или приёмки) + отсрочка поставщика
    await tx.query(`update receipts set status = $2, completed_by = $3, completed_at = now(), lines_total = $4, vat_total = $5, payable = $6,
        due_date = coalesce(document_date, (now() at time zone (select timezone from organizations where id = organization_id))::date)
          + coalesce((select payment_days from suppliers where id = supplier_id), 0)
      where id = $1`, [r.id, status, userId, totals.lines_total, totals.vat_total, totals.payable]);
    if (mismatch)
      await notifyRoles(tx, { orgId, siteId: r.site_id, roles: ['accountant'], title: `Накладная ${r.document_no || 'без номера'}: сумма не сходится с итогом документа`,
        body: `Итог документа ${fmtNum(Number(r.doc_total))} ₽, сумма строк ${totals.lines_total === null ? 'не определена' : `${fmtNum(totals.lines_total)} ₽`}. Причина: ${r.total_mismatch_reason}.`, entityType: 'receipt', entityId: r.id });
    const impact = diffImpact(names, pricesBefore, await priceSnapshot(tx, orgId, pids), costsBefore, await dishCosts(tx, orgId, dishIds));
    if (impact.dishes.length) {
      const top = impact.dishes.slice(0, 5).map((d) => `${d.name}: ${d.old_cost === null ? '—' : fmtNum(d.old_cost)} → ${d.new_cost === null ? 'неполная' : fmtNum(d.new_cost)} ₽/${d.per}${d.change_pct !== null ? ` (${d.change_pct > 0 ? '+' : ''}${fmtNum(d.change_pct)} %)` : ''}`).join('; ');
      await notifyRoles(tx, { orgId, siteId: r.site_id, roles: ['chef', 'accountant'], title: `Себестоимость изменилась после приёмки${r.document_no ? ` ${r.document_no}` : ''}: блюд ${impact.dishes.length}`,
        body: top, entityType: 'receipt', entityId: r.id });
      await audit.record(tx, { organizationId: orgId, siteId: r.site_id, actorUserId: userId, action: 'price.cascade', entityType: 'receipt', entityId: r.id, after: impact });
    }
    await markOrderReceived(tx, r);                                  // приёмка по заказу поставщику → заказ «принят»
    await audit.record(tx, { organizationId: orgId, siteId: r.site_id, actorUserId: userId, action: 'receipt.complete', entityType: 'receipt', entityId: r.id,
      before: { status: 'draft' }, after: { status, lines: lines.length, ...created, ...totals, doc_total: r.doc_total, total_mismatch_reason: mismatch ? r.total_mismatch_reason : null } });
    // себестоимость видят только роли с правом cost.read; остальным — только факт приёмки
    const money = roleHas(m.role, 'cost.read');
    return { status, status_label: RECEIPT_STATUS_LABEL[status], ...created, ...(money ? totals : {}), price_impact: money ? impact : null };
  });
}

export async function listReceipts(userId: string, orgId: string, siteId: string) {
  return inOrg(userId, orgId, 'receipt.record', async (tx) => (await tx.query(
    `select r.id, r.status, r.document_no, r.document_date, r.created_at, r.completed_at, s.name as supplier, u.full_name as author,
       (select count(*) from receipt_lines l where l.receipt_id = r.id)::int as lines
     from receipts r left join suppliers s on s.id = r.supplier_id left join users u on u.id = r.created_by
     where r.organization_id = $1 and r.site_id = $2 order by r.created_at desc limit 100`, [orgId, siteId])).rows.map((r) => ({ ...r, status_label: RECEIPT_STATUS_LABEL[r.status] })), siteId);
}

export async function getReceipt(userId: string, orgId: string, receiptId: string) {
  return inOrg(userId, orgId, 'receipt.record', async (tx, m) => {
    const r = (await tx.query(`select r.*, s.name as supplier from receipts r left join suppliers s on s.id = r.supplier_id where r.id = $1 and r.organization_id = $2`, [receiptId, orgId])).rows[0];
    if (!r) throw Errors.notFound('Приёмка не найдена.');
    assertSiteAccess(m, r.site_id);
    const lines = (await tx.query(`select l.*, p.name as product, o.name as storage_name from receipt_lines l join products p on p.id = l.product_id
      left join control_objects o on o.id = l.storage_object_id where l.receipt_id = $1 order by l.created_at`, [r.id])).rows;
    const order = r.supplier_order_id ? (await tx.query(`select o.id, o.number, (select json_agg(json_build_object('product_id', l.product_id, 'product', p.name, 'quantity', l.quantity, 'unit', l.unit, 'price', l.price) order by p.name)
      from supplier_order_lines l join products p on p.id = l.product_id where l.order_id = o.id) as lines from supplier_orders o where o.id = $1`, [r.supplier_order_id])).rows[0] : null;
    return { receipt: { ...r, status_label: RECEIPT_STATUS_LABEL[r.status] }, lines, order };
  });
}

/** Последний распознанный документ этой приёмки — черновик строк не теряется при перезагрузке страницы. */
export async function receiptDocument(userId: string, orgId: string, receiptId: string) {
  return inOrg(userId, orgId, 'receipt.record', async (tx) => {
    const d = (await tx.query(`select id, result, duplicate_of, created_at, applied_lines from recognition_documents where organization_id = $1 and receipt_id = $2 order by created_at desc limit 1`, [orgId, receiptId])).rows[0];
    return d ? { id: d.id, document: d.result, applied_lines: d.applied_lines as number[], duplicate: d.duplicate_of ? { id: d.duplicate_of, at: d.created_at } : null } : null;
  });
}
