import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createProduct, createSupplier } from '../src/server/ops/catalog';
import { createReceipt, acceptFromDocument, receiptDocument, getReceipt, docUnit } from '../src/server/ops/receipts';
import { makeUser, lastLinkToken, orgDate } from './helpers';

/** Вариант А: накладная по фото принимается одним действием (как «подтвердить накладную» на Google Диске). */

afterAll(() => closePool());
type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, cook: U, orgId: string, siteId: string, beef: string, cream: string, eggs: string, receiptId: string, docId: string;
const YES = { packaging: true, labeling: true, documents: true, quality: true };
const SUPPLIER = 'ООО «Фермер» (тест)';

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}
const item = (n: number, raw: string, qty: number | null, unit: string | null, price: number, extra: Record<string, unknown> = {}) => ({
  line_number: n, raw_name: raw, normalized_name: raw.toLowerCase(), quantity: qty, unit, price, sum: qty === null ? null : qty * price, vat: null, batch_number: null, expiry_date: null,
  confidence: 0.95, calculation_mismatch: false, requires_manual_review: false, matched_product: null, alternatives: [], ...extra });

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кухня накладных' });
  orgId = r.organization.id; siteId = r.site.id;
  cook = await invite('line_staff');
  beef = (await createProduct(owner.id, orgId, { name: 'Говядина', unit: 'кг' })).id;
  cream = (await createProduct(owner.id, orgId, { name: 'Сливки 33 %', unit: 'л' })).id;
  eggs = (await createProduct(owner.id, orgId, { name: 'Яйцо', unit: 'шт' })).id;
  const sup = (await createSupplier(owner.id, orgId, { name: SUPPLIER })).id;
  receiptId = (await createReceipt(cook.id, orgId, { siteId, supplierId: sup })).id;
  const result = { document_type: 'UPD', document_number: 'УПД-77', document_date: orgDate(), supplier: SUPPLIER, buyer: null, total: 9450, recognition_confidence: 0.93,
    warnings: [], requires_manual_review: false, auto_accept: false, second_pass: null, doc_key: 'k', ocr: { pages: 1, orient: [0] },
    items: [
      item(1, 'Говядина вырезка охл.', 5, 'кг', 980, { batch_number: 'Г-0421', expiry_date: orgDate(4) }),
      item(2, 'Сливки 33% 1л', 4, 'л.', 410),
      item(3, 'Яйцо С0 (десяток)', 3, 'уп', 150),
      item(4, 'Масло сливочное', 2, 'кг', 900, { calculation_mismatch: true }),
    ] };
  docId = (await withSystem((tx) => tx.query(`insert into recognition_documents (organization_id, site_id, receipt_id, kind, doc_key, result, files, pages, created_by)
    values ($1, $2, $3, 'upd', $4, $5, 1, 1, $6) returning id`, [orgId, siteId, receiptId, randomUUID(), JSON.stringify(result), cook.id]))).rows[0].id;
});

describe('Накладная по фото — принять одним действием', () => {
  it('единицы из документа сводятся к справочнику', () => {
    expect([docUnit('КГ'), docUnit('л.'), docUnit('шт.'), docUnit('pcs'), docUnit('коробка')]).toEqual(['кг', 'л', 'шт', 'шт', null]);
  });

  it('без подтверждённых проверок поставки — отказ; другая единица и несходящаяся сумма — не принимаются автоматически', async () => {
    await expect(acceptFromDocument(cook.id, orgId, receiptId, { documentId: docId, lines: [{ lineNumber: 1, productId: beef }], checks: { ...YES, quality: false } }))
      .rejects.toThrow(/Подтвердите проверки поставки: Качество/);
    await expect(acceptFromDocument(cook.id, orgId, receiptId, { documentId: docId, lines: [{ lineNumber: 3, productId: eggs }, { lineNumber: 4, productId: beef }], checks: YES }))
      .rejects.toThrow(/строка 3 «Яйцо С0 \(десяток\)»: в документе уп, у товара «Яйцо» — шт.*строка 4 «Масло сливочное»: сумма не сходится/);
    expect((await getReceipt(cook.id, orgId, receiptId)).lines).toHaveLength(0);   // ничего не принято частично
  });

  it('строки принимаются с количеством, ценой, партией и сроком из документа; номер документа — в приёмку; выбор товара запомнен', async () => {
    const r = await acceptFromDocument(cook.id, orgId, receiptId, { documentId: docId, lines: [{ lineNumber: 1, productId: beef }, { lineNumber: 2, productId: cream }], checks: YES, temperature: '3,5' });
    expect(r).toEqual({ added: 2 });
    const rc = await getReceipt(cook.id, orgId, receiptId);
    expect(rc.receipt.document_no).toBe('УПД-77');
    const b = rc.lines.find((l: { product_id: string }) => l.product_id === beef)!;
    expect(b).toMatchObject({ lot_no: 'Г-0421', decision: 'accepted', expiry_basis: 'сопроводительный документ (распознанная накладная)' });
    expect(Number(b.quantity)).toBe(5);
    expect(Number(rc.lines.find((l: { product_id: string }) => l.product_id === cream)!.quantity)).toBe(4);
    const al = (await withSystem((tx) => tx.query(`select raw_text, product_id from recognition_aliases where organization_id = $1 order by raw_text`, [orgId]))).rows;
    expect(al).toEqual([{ raw_text: 'Говядина вырезка охл.', product_id: beef }, { raw_text: 'Сливки 33% 1л', product_id: cream }]);
  });

  it('повторно та же строка не принимается; черновик документа виден после перезагрузки с отметкой принятых строк', async () => {
    await expect(acceptFromDocument(cook.id, orgId, receiptId, { documentId: docId, lines: [{ lineNumber: 1, productId: beef }], checks: YES })).rejects.toThrow(/уже принята из этого документа/);
    const d = await receiptDocument(cook.id, orgId, receiptId);
    expect(d).toMatchObject({ id: docId, applied_lines: [1, 2], document: { document_number: 'УПД-77' } });
  });
});
