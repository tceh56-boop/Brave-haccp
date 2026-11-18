import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation, updateOrganization } from '../src/server/org/organizations';
import { createProduct, createSupplier } from '../src/server/ops/catalog';
import { updateSupplier } from '../src/server/ops/purchasing';
import { createReceipt, addReceiptLine, completeReceipt } from '../src/server/ops/receipts';
import { createDish, getDish, updateVersion, addLine, submitVersion, approveVersion } from '../src/server/ops/recipes';
import { createEvent, setItem, confirmEvent } from '../src/server/ops/planmenu';
import { openShift, closeShift, getShift } from '../src/server/ops/pos';
import { addExpense } from '../src/server/ops/finance';
import { econReport } from '../src/server/ops/econReports';
import {
  listSupplierBalances, supplierLedger, paySupplier, voidSupplierPayment, returnToSupplier, supplierCorrection, registerCashOp, listCashOps,
  addEventPayment, listEventPayments, importBankStatement, listBankLines, decideBankLine, parseClientBank,
} from '../src/server/ops/money';
import { makeUser, lastLinkToken } from './helpers';

/** Финансовый контур, этап Ф-3: долги поставщикам, наличные кассы, расчёты по мероприятиям, банковская выписка, ДДС. */

afterAll(() => closePool());
type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, acc: U, chef: U, cashier: U, cook: U, orgId: string, siteId: string, sup: string, beef: string, dish: string, eventId: string, lotR2: string;
const OK = { packaging: true, labeling: true, documents: true, quality: true };
const day = (n: number) => new Date(Date.now() + n * 86400e3).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
const op = () => ({ operationId: randomUUID() });
const ddmm = (iso: string) => iso.split('-').reverse().join('.');

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}
async function receipt(docDate: string, qty: number, price: number) {
  const r = await createReceipt(chef.id, orgId, { siteId, supplierId: sup, documentNo: `Н-${Math.random().toString(36).slice(2, 6)}`, documentDate: docDate, pricesWithVat: true });
  await addReceiptLine(chef.id, orgId, r.id, { productId: beef, quantity: qty, unitPrice: price, expiresAt: day(20), expiryBasis: 'маркировка изготовителя', checks: OK, decision: 'accepted' });
  await completeReceipt(chef.id, orgId, r.id);
  return r.id as string;
}

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кафе «Деньги»' });
  orgId = r.organization.id; siteId = r.site.id;
  await updateOrganization(owner.id, orgId, { modules: ['pos'] });
  acc = await invite('accountant'); chef = await invite('chef'); cashier = await invite('cashier'); cook = await invite('line_staff');
  beef = (await createProduct(chef.id, orgId, { name: 'Говядина', unit: 'кг' })).id;
  sup = (await createSupplier(chef.id, orgId, { name: 'ООО «Мясо»', inn: '7700000001' })).id;
  await updateSupplier(chef.id, orgId, sup, { phone: null, email: null, blockedReason: null, paymentDays: 7 });
  await receipt(day(-10), 2, 500);             // 1000 ₽, срок оплаты — 3 дня назад
  const r2 = await receipt(day(0), 5, 100);   // 500 ₽, срок — через неделю
  lotR2 = (await withSystem((tx) => tx.query(`select l.id from lots l join receipt_lines rl on rl.id = l.receipt_line_id where rl.receipt_id = $1`, [r2]))).rows[0].id;
  const d = await createDish(chef.id, orgId, { name: 'Стейк', salePrice: 1000 });
  const v = (await getDish(chef.id, orgId, d.id)).current!.version.id;
  await updateVersion(chef.id, orgId, v, { yieldG: 250, portionG: 250, technology: 'Приготовить по технологии предприятия.', storageConditions: '+2…+6 °C', shelfLife: '2 часа' });
  await addLine(chef.id, orgId, v, { productId: beef, unit: 'кг', brutto: 0.3, netto: 0.25 });
  await submitVersion(chef.id, orgId, v); await approveVersion(chef.id, orgId, v);
  dish = d.id;
});

describe('Ф-3: долги поставщикам', () => {
  it('долг и просрочка; оплата разносится по сроку; повар и кассир долгов не видят', async () => {
    await expect(listSupplierBalances(cook.id, orgId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(paySupplier(chef.id, orgId, { supplierId: sup, amount: 1, paidOn: day(0), method: 'bank', ...op() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    let b = await listSupplierBalances(acc.id, orgId);
    expect(b.rows[0]).toMatchObject({ name: 'ООО «Мясо»', invoiced: 1500, debt: 1500, overdue: 1000, advance: 0 });
    const k = op();
    const p = await paySupplier(acc.id, orgId, { supplierId: sup, amount: 1200, paidOn: day(0), method: 'bank', docNo: 'п/п 15', ...k });
    expect(p.allocations.map((a) => a.amount)).toEqual([1000, 200]);   // сначала просроченная
    await paySupplier(acc.id, orgId, { supplierId: sup, amount: 1200, paidOn: day(0), method: 'bank', ...k });   // повтор — без второй оплаты
    b = await listSupplierBalances(acc.id, orgId);
    expect(b.rows[0]).toMatchObject({ paid: 1200, debt: 300, overdue: 0 });
  });

  it('возврат товара уменьшает долг по цене накладной и склад; корректировка (УКД) — в обе стороны', async () => {
    await expect(returnToSupplier(cook.id, orgId, { lotId: lotR2, quantity: 1, reason: 'брак при вскрытии', ...op() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const r = await returnToSupplier(chef.id, orgId, { lotId: lotR2, quantity: 1, reason: 'брак при вскрытии', docNo: 'акт 3', ...op() });
    expect(r).toMatchObject({ amount: 100, quantity: 1 });
    expect(Number((await withSystem((tx) => tx.query(`select quantity from lots where id = $1`, [lotR2]))).rows[0].quantity)).toBe(4);
    await supplierCorrection(acc.id, orgId, { supplierId: sup, onDate: day(0), amount: -50, docNo: 'УКД 1', reason: 'доначислена доставка по УКД' });
    const l = await supplierLedger(acc.id, orgId, sup);
    expect(l.balance).toMatchObject({ credits: 50, debt: 250 });   // 1500 − (100 − 50) − 1200
    expect(l.receipts.map((x) => x.state)).toEqual(['оплачена', 'частично']);
  });

  it('переплата — аванс; аннулирование оплаты с причиной; запись о деньгах в базе не правится', async () => {
    const p = await paySupplier(acc.id, orgId, { supplierId: sup, amount: 400, paidOn: day(0), method: 'card', ...op() });
    expect((await listSupplierBalances(acc.id, orgId)).rows[0]).toMatchObject({ debt: 0, advance: 150 });
    await expect(voidSupplierPayment(acc.id, orgId, p.id, { reason: 'нет' })).rejects.toThrow(/причину/);
    await voidSupplierPayment(acc.id, orgId, p.id, { reason: 'ошибочно внесена дважды' });
    expect((await listSupplierBalances(acc.id, orgId)).rows[0]).toMatchObject({ debt: 250, advance: 0 });
    await expect(withSystem((tx) => tx.query(`update supplier_payments set amount = 1 where id = $1`, [p.id]))).rejects.toThrow(/не изменяется/);
    await expect(withSystem((tx) => tx.query(`delete from supplier_payments where id = $1`, [p.id]))).rejects.toThrow(/не удаляется/);
  });
});

describe('Ф-3: наличные кассы и мероприятия', () => {
  it('внесение, выемка (руководитель), инкассация, расход из кассы; выдать больше, чем в кассе, нельзя; закрытие смены сходится', async () => {
    await openShift(cashier.id, orgId, { siteId, cashStart: 1000 });
    await registerCashOp(cashier.id, orgId, { siteId, kind: 'deposit', amount: 200, reason: 'размен от управляющего', ...op() });
    await expect(registerCashOp(cashier.id, orgId, { siteId, kind: 'withdrawal', amount: 100, reason: 'на хозяйственные нужды', ...op() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await registerCashOp(owner.id, orgId, { siteId, kind: 'withdrawal', amount: 100, reason: 'изъятие владельцем', ...op() });
    await registerCashOp(cashier.id, orgId, { siteId, kind: 'collection', amount: 500, reason: 'инкассация, сумка № 12', ...op() });
    await addExpense(owner.id, orgId, { siteId, category: 'services', kind: 'once', date: day(0), amount: 300, title: 'вывоз мусора', paymentMethod: 'cash_register' });
    await expect(paySupplier(owner.id, orgId, { supplierId: sup, amount: 400, paidOn: day(0), method: 'cash_register', siteId, ...op() })).rejects.toThrow(/В кассе по расчёту 300 ₽ — выдать 400 ₽ нельзя/);
    await paySupplier(owner.id, orgId, { supplierId: sup, amount: 250, paidOn: day(0), method: 'cash_register', siteId, ...op() });
    const c = await listCashOps(cashier.id, orgId, siteId);
    expect(c.cash).toMatchObject({ cash_in: 200, cash_out: 1150, cash_expected: 50 });
    expect((await getShift(cashier.id, orgId, siteId)).totals!.cash_expected).toBe(50);
    expect((await listSupplierBalances(acc.id, orgId)).rows[0]).toMatchObject({ debt: 0 });
  });

  it('мероприятие: предоплата через кассу — аванс; возврат больше оплаченного нельзя; закрытие смены с этими деньгами', async () => {
    const e = await createEvent(chef.id, orgId, { siteId, title: 'Юбилей', eventDate: day(5), guests: 3 });
    eventId = e.id;
    await setItem(chef.id, orgId, eventId, { dishId: dish, perGuest: 1 });
    await confirmEvent(chef.id, orgId, eventId);
    const p = await addEventPayment(chef.id, orgId, eventId, { kind: 'prepayment', amount: 1000, paidOn: day(0), method: 'cash_register', ...op() });
    expect(p).toMatchObject({ amount: 3000, paid: 1000, balance: 2000 });
    await expect(addEventPayment(owner.id, orgId, eventId, { kind: 'refund', amount: 1500, paidOn: day(0), method: 'bank', ...op() })).rejects.toThrow(/вернуть больше нельзя/);
    expect((await listEventPayments(chef.id, orgId, eventId)).rows).toHaveLength(1);
    const r = await econReport(acc.id, orgId, { kind: 'receivables', from: day(-1), to: day(0) });
    expect(r.table.rows).toEqual([expect.objectContaining({ amount: 3000, paid: 1000, state: 'аванс получен' })]);
    const close = await closeShift(cashier.id, orgId, { siteId, cashFact: 1050 });
    expect(close.cash_diff).toBe(0);
  });
});

describe('Ф-3: банковская выписка 1С и ДДС', () => {
  const OWN = '40702810000000000001';
  const doc = (n: string, sum: string, payerAcc: string, payeeAcc: string, inn: string, who: string, purpose: string) => [
    'СекцияДокумент=Платежное поручение', `Номер=${n}`, `Дата=${ddmm(day(0))}`, `Сумма=${sum}`, `ПлательщикСчет=${payerAcc}`, `ПолучательСчет=${payeeAcc}`,
    `ПлательщикИНН=${payerAcc === OWN ? '7700000999' : inn}`, `ПолучательИНН=${payeeAcc === OWN ? '7700000999' : inn}`,
    `${payerAcc === OWN ? 'Получатель1' : 'Плательщик1'}=${who}`, `ДатаСписано=${ddmm(day(0))}`, `ДатаПоступило=${ddmm(day(0))}`, `НазначениеПлатежа=${purpose}`, 'КонецДокумента'].join('\r\n');
  const text = ['1CClientBankExchange', 'ВерсияФормата=1.03', 'Кодировка=Windows', `ДатаНачала=${ddmm(day(0))}`, `ДатаКонца=${ddmm(day(0))}`, `РасчСчет=${OWN}`,
    doc('101', '700.00', OWN, '40702810999000000002', '7700000001', 'ООО «Мясо»', 'Оплата по накладной, без НДС'),
    doc('102', '30000.00', OWN, '40702810999000000003', '7700000555', 'ИП Арендодатель', 'Аренда за ноябрь'),
    doc('9', '5000.00', '30101810000000000999', OWN, '7700000777', 'Банк', 'Возмещение по операциям эквайринга'),
    doc('55', '2000.00', '40817810000000000044', OWN, '', 'Клиент', 'Доплата за юбилей'),
    'КонецФайла'].join('\r\n');

  it('разбор формата: свой счёт, направление, даты; чужой файл — понятная ошибка', () => {
    const p = parseClientBank(text);
    expect(p.accounts).toEqual([OWN]);
    expect(p.docs.map((x) => x.amount)).toEqual([-700, -30000, 5000, 2000]);
    expect(() => parseClientBank('Дата;Сумма')).toThrow(/формате обмена с 1С/);
  });

  it('загрузка один раз; подсказки по ИНН и эквайрингу; разнесение создаёт оплату, расход, оплату мероприятия', async () => {
    await expect(importBankStatement(chef.id, orgId, { text })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await importBankStatement(acc.id, orgId, { text })).toMatchObject({ added: 4, duplicates: 0 });
    await expect(importBankStatement(acc.id, orgId, { text })).rejects.toThrow(/уже загружена/);
    const lines = await listBankLines(acc.id, orgId, {});
    const by = (n: string) => lines.find((l) => l.doc_no === n)!;
    expect(by('101').suggest).toMatchObject({ kind: 'supplier_payment', supplier_id: sup });
    expect(by('9').suggest).toMatchObject({ kind: 'acquiring' });
    await decideBankLine(acc.id, orgId, by('101').id, { kind: 'supplier_payment', supplierId: sup });
    await expect(decideBankLine(acc.id, orgId, by('101').id, { kind: 'transfer' })).rejects.toThrow(/уже разнесена/);
    await expect(decideBankLine(acc.id, orgId, by('9').id, { kind: 'expense', category: 'rent' })).rejects.toThrow(/списание со счёта/);
    await decideBankLine(acc.id, orgId, by('102').id, { kind: 'expense', category: 'rent' });
    await decideBankLine(acc.id, orgId, by('9').id, { kind: 'acquiring' });
    await decideBankLine(acc.id, orgId, by('55').id, { kind: 'event_payment', eventId });
    expect(await listBankLines(acc.id, orgId, {})).toHaveLength(0);
    expect((await listSupplierBalances(acc.id, orgId)).rows[0]).toMatchObject({ advance: 700 });
    expect((await listEventPayments(chef.id, orgId, eventId)).money).toMatchObject({ paid: 3000, balance: 0 });
    const e = (await withSystem((tx) => tx.query(`select category, amount::float, payment_method from expenses where organization_id = $1 and category = 'rent'`, [orgId]))).rows;
    expect(e).toEqual([{ category: 'rent', amount: 30000, payment_method: 'bank' }]);
  });

  it('ДДС: поступления и выплаты по способам; инкассация и эквайринг — внутренние, в сальдо не входят', async () => {
    const t = (await econReport(acc.id, orgId, { kind: 'cash_flow', from: day(-1), to: day(0) })).table;
    const row = (s: string) => t.rows.find((r) => String(r.item).startsWith(s))?.amount;
    expect(row('Оплаты мероприятий: Из кассы')).toBe(1000);
    expect(row('Оплаты мероприятий: Банк')).toBe(2000);
    expect(row('Внесения наличных')).toBe(200);
    expect(row('Оплаты поставщикам: Банк')).toBe(-1900);         // 1200 + 700 из выписки
    expect(row('Оплаты поставщикам: Из кассы')).toBe(-250);
    expect(row('Оплаты поставщикам: Карта')).toBeUndefined();     // аннулирована
    expect(row('Расходы: Аренда')).toBe(-30000);
    expect(row('Расходы: Услуги')).toBe(-300);
    expect(row('Выемки')).toBe(-100);
    expect(row('Инкассация')).toBe(500);
    expect(row('Зачисления эквайринга')).toBe(5000);
    expect(t.totals!.amount).toBe(1000 + 2000 + 200 - 1900 - 250 - 30000 - 300 - 100);
    const d = (await econReport(acc.id, orgId, { kind: 'debts', from: day(-1), to: day(0) })).table.rows;
    expect(d.find((r) => r.item === 'Авансы, выданные поставщикам')!.value).toBe(700);
    expect(d.find((r) => String(r.item).startsWith('Авансы, полученные'))!.value).toBe(3000);
  });
});
