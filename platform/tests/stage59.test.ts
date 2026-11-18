import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation, updateOrganization } from '../src/server/org/organizations';
import { createProduct, createSupplier } from '../src/server/ops/catalog';
import { updateSupplier } from '../src/server/ops/purchasing';
import { createReceipt, addReceiptLine, completeReceipt, updateReceiptTerms, getReceipt } from '../src/server/ops/receipts';
import { pnl } from '../src/server/ops/finance';
import { econReport } from '../src/server/ops/econReports';
import { makeUser, lastLinkToken } from './helpers';

/**
 * Финансовый контур, этап Ф-2: накладная. Предприятие на АУСН — НДС не возмещается, себестоимость по цене с НДС.
 * Говядина 10 кг × 100 ₽ без НДС, ставка 20 % → 120 ₽; соль 1 кг × 50 ₽ без НДС; молоко 2 л × 80 ₽ + 10 % — отказ.
 */

afterAll(() => closePool());
type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, chef: U, cook: U, acc: U, orgId: string, siteId: string, sup: string, beef: string, salt: string, milk: string;
const OK = { packaging: true, labeling: true, documents: true, quality: true };
const day = (n: number) => new Date(Date.now() + n * 86400e3).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
const line = (productId: string, quantity: number, unitPrice: number, vatRate: number | null, decision: 'accepted' | 'rejected' = 'accepted') => ({ productId, quantity, unitPrice, vatRate,
  expiresAt: day(5), expiryBasis: 'маркировка изготовителя', checks: OK, decision, decisionReason: decision === 'rejected' ? 'температура выше нормы' : null });

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кафе «Накладная»' });
  orgId = r.organization.id; siteId = r.site.id;
  chef = await invite('chef'); cook = await invite('line_staff'); acc = await invite('accountant');
  beef = (await createProduct(chef.id, orgId, { name: 'Говядина', unit: 'кг' })).id;
  salt = (await createProduct(chef.id, orgId, { name: 'Соль', unit: 'кг' })).id;
  milk = (await createProduct(chef.id, orgId, { name: 'Молоко', unit: 'л' })).id;
  sup = (await createSupplier(chef.id, orgId, { name: 'ООО «Мясо»' })).id;
});

describe('Ф-2: накладная', () => {
  it('режим налогообложения — АУСН или патент, меняет владелец; цены в накладных по умолчанию — настройка предприятия', async () => {
    await expect(updateOrganization(chef.id, orgId, { taxRegime: 'psn' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(updateOrganization(owner.id, orgId, { taxRegime: 'osn' })).rejects.toThrow(/режим налогообложения/);
    await updateOrganization(owner.id, orgId, { taxRegime: 'ausn_income', invoicePricesWithVat: false });
    const o = (await withSystem((tx) => tx.query(`select tax_regime, invoice_prices_with_vat from organizations where id = $1`, [orgId]))).rows[0];
    expect(o).toEqual({ tax_regime: 'ausn_income', invoice_prices_with_vat: false });
    await updateSupplier(chef.id, orgId, sup, { phone: null, email: null, blockedReason: null, paymentDays: 14 });
  });

  it('цена без НДС доводится до цены с НДС по ставке строки; переключатель пересчитывает строки', async () => {
    const r = await createReceipt(cook.id, orgId, { siteId, supplierId: sup, documentNo: 'УПД-7', documentDate: day(0) });
    expect(r.prices_with_vat).toBe(false);
    await addReceiptLine(cook.id, orgId, r.id, line(beef, 10, 100, 20));
    await addReceiptLine(cook.id, orgId, r.id, line(salt, 1, 50, null));
    await addReceiptLine(cook.id, orgId, r.id, line(milk, 2, 80, 10, 'rejected'));
    const price = async () => Object.fromEntries((await getReceipt(cook.id, orgId, r.id)).lines.map((l) => [l.product, [Number(l.doc_price), Number(l.unit_price)]]));
    expect(await price()).toEqual({ 'Говядина': [100, 120], 'Соль': [50, 50], 'Молоко': [80, 88] });
    await updateReceiptTerms(cook.id, orgId, r.id, { pricesWithVat: true });
    expect((await price())['Говядина']).toEqual([100, 100]);
    await updateReceiptTerms(cook.id, orgId, r.id, { pricesWithVat: false });
    expect((await price())['Говядина']).toEqual([100, 120]);

    // итог документа не сходится — без причины не завершить; доставка без описания — нельзя
    await expect(updateReceiptTerms(cook.id, orgId, r.id, { extraCosts: 125 })).rejects.toThrow(/что за доп. расходы/);
    await updateReceiptTerms(cook.id, orgId, r.id, { docTotal: 1500, extraCosts: 125, extraCostsNote: 'доставка по счёту № 15' });
    await expect(completeReceipt(cook.id, orgId, r.id)).rejects.toThrow(/Сумма строк 1 ?426 ₽ не сходится с итогом документа 1 ?500 ₽ \(разница −?-?74 ₽\)/);
    await updateReceiptTerms(cook.id, orgId, r.id, { totalMismatchReason: 'недовоз 0,5 кг — составлен акт расхождений' });
    const done = await completeReceipt(chef.id, orgId, r.id);
    // всего по документу 1200 + 50 + 176 = 1426; НДС в т. ч. 200 + 16 = 216; к оплате без отказа + доставка = 1375
    expect(done).toMatchObject({ lines_total: 1426, vat_total: 216, payable: 1375 });
    const x = (await withSystem((tx) => tx.query(`select lines_total::float, vat_total::float, payable::float, due_date::text, document_date::text from receipts where id = $1`, [r.id]))).rows[0];
    expect(x).toMatchObject({ lines_total: 1426, vat_total: 216, payable: 1375, due_date: day(14) });
    // доставка 125 ₽ — пропорционально сумме: говядине 120 ₽ (12 ₽/кг), соли 5 ₽
    const lots = Object.fromEntries((await withSystem((tx) => tx.query(`select p.name, l.unit_price::float from lots l join products p on p.id = l.product_id where l.organization_id = $1`, [orgId]))).rows.map((l) => [l.name, l.unit_price]));
    expect(lots).toEqual({ 'Говядина': 132, 'Соль': 55 });
    const note = (await withSystem((tx) => tx.query(`select role, body from notifications where organization_id = $1 and title like '%не сходится%'`, [orgId]))).rows;
    expect(note).toEqual([{ role: 'accountant', body: expect.stringMatching(/недовоз/) }]);
    // повар сумм к оплате в ответе не получает
    const r2 = await createReceipt(cook.id, orgId, { siteId, supplierId: sup, documentNo: 'УПД-8', pricesWithVat: true });
    await addReceiptLine(cook.id, orgId, r2.id, line(salt, 2, 60, 20));
    await updateReceiptTerms(cook.id, orgId, r2.id, { docTotal: 120 });
    const c2 = await completeReceipt(cook.id, orgId, r2.id);
    expect(c2).not.toHaveProperty('payable');
    expect((await withSystem((tx) => tx.query(`select payable::float, vat_total::float from receipts where id = $1`, [r2.id]))).rows[0]).toEqual({ payable: 120, vat_total: 20 });
  });

  it('строка без цены — к оплате «не определено», а не ноль; приёмка без итога документа — в полноте данных', async () => {
    const r = await createReceipt(cook.id, orgId, { siteId, supplierId: sup, documentNo: 'Н-9' });
    await addReceiptLine(cook.id, orgId, r.id, { ...line(salt, 1, 0, null), unitPrice: null });
    await completeReceipt(cook.id, orgId, r.id);
    expect((await withSystem((tx) => tx.query(`select payable, lines_total from receipts where id = $1`, [r.id]))).rows[0]).toEqual({ payable: null, lines_total: null });
    const f = await pnl(acc.id, orgId, { from: day(-1), to: day(0) });
    expect(f.reasons.map((x) => x.code)).toContain('no_doc_total');
  });

  it('закупки по поставщикам: по документам, НДС, доп. расходы, к оплате; накладная без цены — отдельно', async () => {
    const t = await econReport(acc.id, orgId, { kind: 'purchases', from: day(-1), to: day(0) });
    expect(t.table.rows).toEqual([expect.objectContaining({ supplier: 'ООО «Мясо»', receipts: 3, doc_amount: 1546, vat: 236, extra: 125, payable: 1495, unpriced: 1, no_total: 1 })]);
  });
});
