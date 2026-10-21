import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createProduct, createSupplier } from '../src/server/ops/catalog';
import { createReceipt, addReceiptLine, completeReceipt } from '../src/server/ops/receipts';
import { createDish, getDish, updateVersion, addLine, submitVersion, approveVersion } from '../src/server/ops/recipes';
import { listTasks } from '../src/server/ops/tasks';
import {
  openShift, getShift, closeShift, getMenu, createOrder, addOrderLine, setOrderLineQty, cancelOrder, payOrder, refundOrder, getOrder,
  setStop, liftStop, getStopList, importSales, mapSaleName, salesQueue, retryQueue, economics,
} from '../src/server/ops/pos';
import { makeUser, lastLinkToken } from './helpers';

afterAll(() => closePool());

type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, chef: U, cashier: U, store: U, accountant: U, stranger: U;
let orgId: string, siteId: string, supplierId: string;
let beef: string, onion: string, cranberry: string, stroganoff: string, mors: string, steak: string;
let orderId: string;

async function invite(role: string, siteIds: string[] = []) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role, siteIds });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}
const ALL_OK = { packaging: true, labeling: true, documents: true, quality: true };
const inDays = (n: number) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
let op = 0;
const opId = () => `test-op-${Date.now()}-${op++}`;
async function receive(productId: string, quantity: number, unitPrice: number) {
  const r = await createReceipt(store.id, orgId, { siteId, supplierId });
  await addReceiptLine(store.id, orgId, r.id, { productId, quantity, unitPrice, lotNo: `L${op++}`, expiresAt: inDays(5), expiryBasis: 'маркировка', checks: ALL_OK, decision: 'accepted' });
  await completeReceipt(store.id, orgId, r.id);
}
async function dishWithTtk(name: string, price: number, lines: { productId: string; unit: string; brutto: number; netto: number }[], portion = 150) {
  const d = await createDish(chef.id, orgId, { name, salePrice: price });
  const v = (await getDish(chef.id, orgId, d.id)).current!.version.id;
  await updateVersion(chef.id, orgId, v, { yieldG: portion, portionG: portion, technology: 'Приготовить по технологии предприятия.', storageConditions: '+2…+6 °C', shelfLife: '2 часа' });
  for (const l of lines) await addLine(chef.id, orgId, v, l);
  await submitVersion(chef.id, orgId, v);
  await approveVersion(chef.id, orgId, v);
  return d.id;
}
const lotQty = async (productId: string) => Number((await withSystem((tx) => tx.query(`select coalesce(sum(quantity), 0) as q from lots where product_id = $1 and status in ('available', 'consumed')`, [productId]))).rows[0].q);

beforeAll(async () => {
  owner = await makeUser({ name: 'Ольга Владелец' });
  const r = await createOrganization(owner, { name: 'Кафе «Касса»' });
  orgId = r.organization.id; siteId = r.site.id;
  chef = await invite('chef'); cashier = await invite('cashier', [siteId]); store = await invite('storekeeper'); accountant = await invite('accountant');
  stranger = await makeUser();
  await createOrganization(stranger, { name: 'Чужое кафе' });
  supplierId = (await createSupplier(store.id, orgId, { name: 'ООО «Поставщик»' })).id;
  beef = (await createProduct(chef.id, orgId, { name: 'Говядина', unit: 'кг' })).id;
  onion = (await createProduct(chef.id, orgId, { name: 'Лук', unit: 'кг' })).id;
  cranberry = (await createProduct(chef.id, orgId, { name: 'Клюква', unit: 'кг' })).id;
  await receive(beef, 2, 800); await receive(onion, 1, 40);
  stroganoff = await dishWithTtk('Бефстроганов', 450, [{ productId: beef, unit: 'кг', brutto: 0.15, netto: 0.12 }, { productId: onion, unit: 'г', brutto: 30, netto: 25 }]);
  steak = await dishWithTtk('Стейк', 1200, [{ productId: beef, unit: 'кг', brutto: 5, netto: 4 }], 300);
  mors = (await createDish(chef.id, orgId, { name: 'Морс клюквенный', salePrice: 150 })).id;
});

describe('Смена и заказ: цена — на сервере, стоп-лист, версия заказа', () => {
  it('без смены заказ не создать; смена одна на площадку', async () => {
    await expect(createOrder(cashier.id, orgId, { siteId })).rejects.toThrow(/Смена не открыта/);
    await openShift(cashier.id, orgId, { siteId, cashStart: 1000 });
    await expect(openShift(cashier.id, orgId, { siteId, cashStart: 0 })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('меню: автоматический стоп по годному остатку и ТТК с причиной', async () => {
    const menu = await getMenu(cashier.id, orgId, siteId);
    expect(menu.map((d) => d.name)).toEqual(['Бефстроганов', 'Морс клюквенный', 'Стейк']);
    expect(menu.find((d) => d.name === 'Стейк')!.stop).toMatchObject({ source: 'auto', reason: expect.stringMatching(/Не хватает: Говядина \(есть 2 кг, на порцию 5 кг\)/) });
    expect(menu.find((d) => d.name === 'Морс клюквенный')!.stop).toBeNull();   // нет ТТК — авто-стоп не ставится
  });

  it('позиции: сумма по цене блюда; одинаковые суммируются; ручной стоп ставит шеф, не кассир', async () => {
    const o = await createOrder(cashier.id, orgId, { siteId, tableLabel: '5' });
    orderId = o.order.id;
    await expect(createOrder(cashier.id, orgId, { siteId, tableLabel: '5' })).rejects.toThrow(/уже есть открытый заказ/);
    await addOrderLine(cashier.id, orgId, orderId, { dishId: stroganoff });
    let v = await addOrderLine(cashier.id, orgId, orderId, { dishId: stroganoff });
    expect(v.lines).toHaveLength(1);
    expect(Number(v.order.total)).toBe(900);
    await expect(addOrderLine(cashier.id, orgId, orderId, { dishId: steak })).rejects.toThrow(/в стоп-листе: Не хватает/);
    await expect(setStop(cashier.id, orgId, { siteId, dishId: mors, reason: 'закончилась клюква' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const stop = await setStop(chef.id, orgId, { siteId, dishId: mors, reason: 'закончилась клюква' });
    await expect(addOrderLine(cashier.id, orgId, orderId, { dishId: mors })).rejects.toThrow(/закончилась клюква/);
    expect((await getStopList(chef.id, orgId, siteId)).map((s) => s.dish)).toEqual(expect.arrayContaining(['Морс клюквенный', 'Стейк']));
    await liftStop(chef.id, orgId, stop.id);
    v = await addOrderLine(cashier.id, orgId, orderId, { dishId: mors, qty: 3 });
    await expect(setOrderLineQty(cashier.id, orgId, v.lines[1].id, { qty: 2, version: v.order.version - 1 })).rejects.toThrow(/изменён на другом устройстве/);
    v = await setOrderLineQty(cashier.id, orgId, v.lines[1].id, { qty: 2, version: v.order.version });
    expect(Number(v.order.total)).toBe(1200);
  });
});

describe('Оплата → продажа → списание по ТТК (FEFO); повтор оплаты не дублирует', () => {
  it('проверки суммы; сдача; повтор с тем же ключом — тот же результат', async () => {
    await expect(payOrder(cashier.id, orgId, orderId, { payments: [{ method: 'card', amount: 1300 }], operationId: opId() })).rejects.toThrow(/Безналичная оплата больше/);
    await expect(payOrder(cashier.id, orgId, orderId, { payments: [{ method: 'cash', amount: 1000 }], operationId: opId() })).rejects.toThrow(/Не хватает 200 ₽/);
    const key = opId();
    const r = await payOrder(cashier.id, orgId, orderId, { payments: [{ method: 'card', amount: 700 }, { method: 'cash', amount: 1000 }], operationId: key });
    expect(r).toMatchObject({ total: 1200, change: 500, fulfil: { done: 1, no_ttk: 1 } });
    const again = await payOrder(cashier.id, orgId, orderId, { payments: [{ method: 'card', amount: 700 }, { method: 'cash', amount: 1000 }], operationId: key });
    expect(again).toMatchObject({ total: 1200, change: 500, repeated: true });
    const o = await getOrder(cashier.id, orgId, orderId);
    expect(o.order.status_label).toBe('Оплачен');
    expect(o.payments.map((p) => `${p.method}:${Number(p.amount)}`)).toEqual(['cash:500', 'card:700']);
    await expect(withSystem((tx) => tx.query(`update pos_payments set amount = 1 where order_id = $1`, [orderId]))).rejects.toThrow(/оформите возврат/);
  });

  it('сырьё списано по FEFO по утверждённой ТТК; себестоимость — по ценам партий', async () => {
    expect(await lotQty(beef)).toBeCloseTo(2 - 0.3, 6);
    expect(await lotQty(onion)).toBeCloseTo(1 - 0.06, 6);
    const sale = (await withSystem((tx) => tx.query(`select cost, fulfil_status from sales where name = 'Бефстроганов' and organization_id = $1`, [orgId]))).rows[0];
    expect(sale).toMatchObject({ fulfil_status: 'done', cost: String(0.3 * 800 + 0.06 * 40) });
  });

  it('продажа без ТТК — в очереди и задача шефу; после утверждения ТТК — повтор списывает и закрывает задачу', async () => {
    const q = await salesQueue(chef.id, orgId);
    expect(q.waiting.map((w) => `${w.name}:${w.status_label}`)).toEqual(['Морс клюквенный:Нет утверждённой ТТК']);
    expect((await listTasks(chef.id, orgId)).some((t) => t.kind === 'sale_fulfil' && t.entity_id === mors)).toBe(true);
    await receive(cranberry, 1, 300);
    const v = (await getDish(chef.id, orgId, mors)).current!.version.id;
    await updateVersion(chef.id, orgId, v, { yieldG: 300, portionG: 300, technology: 'Клюкву протереть, залить водой, процедить.', storageConditions: '+2…+6 °C', shelfLife: '24 часа' });
    await addLine(chef.id, orgId, v, { productId: cranberry, unit: 'г', brutto: 50, netto: 50 });
    await submitVersion(chef.id, orgId, v); await approveVersion(chef.id, orgId, v);
    expect(await retryQueue(chef.id, orgId, {})).toMatchObject({ processed: 1, done: 1 });
    expect(await lotQty(cranberry)).toBeCloseTo(0.9, 6);
    expect((await listTasks(chef.id, orgId)).some((t) => t.kind === 'sale_fulfil')).toBe(false);
  });
});

describe('Возврат и закрытие смены', () => {
  it('возврат — право руководителя; безнал не больше оплаченного им; частичный, затем полный', async () => {
    const lines = (await getOrder(owner.id, orgId, orderId)).lines;
    const s = lines.find((l) => l.name === 'Бефстроганов')!;
    await expect(refundOrder(cashier.id, orgId, orderId, { lineIds: [s.id], method: 'cash', reason: 'жалоба гостя', operationId: opId() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(refundOrder(owner.id, orgId, orderId, { method: 'card', reason: 'жалоба гостя', operationId: opId() })).rejects.toThrow(/оплачено 700 ₽/);
    await expect(refundOrder(owner.id, orgId, orderId, { lineIds: [s.id], method: 'card', reason: 'жалоба гостя', operationId: opId() })).rejects.toThrow(/оплачено 700 ₽ — вернуть 900 ₽/);
    expect(await refundOrder(owner.id, orgId, orderId, { lineIds: [s.id], method: 'cash', reason: 'жалоба гостя', operationId: opId() })).toMatchObject({ refunded: 900, full: false });
    expect(await refundOrder(owner.id, orgId, orderId, { method: 'card', reason: 'гость ушёл', operationId: opId() })).toMatchObject({ refunded: 300, full: true });
    expect((await getOrder(owner.id, orgId, orderId)).order.status_label).toBe('Возврат');
    const neg = (await withSystem((tx) => tx.query(`select sum(amount) as a from sales where organization_id = $1 and qty < 0`, [orgId]))).rows[0];
    expect(Number(neg.a)).toBe(-1200);
  });

  it('закрыть смену с неоплаченным заказом нельзя; расхождение наличных фиксируется', async () => {
    const o = await createOrder(cashier.id, orgId, { siteId });
    await expect(closeShift(cashier.id, orgId, { siteId, cashFact: 1200 })).rejects.toThrow(/неоплаченные заказы \(1\)/);
    await expect(cancelOrder(cashier.id, orgId, o.order.id, { reason: '' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await cancelOrder(cashier.id, orgId, o.order.id, { reason: 'гость передумал' });
    const t = (await getShift(cashier.id, orgId, siteId)).totals!;
    expect(t).toMatchObject({ cash: -400, card: 400, revenue: 0, gross: 1200, refunds: 1200, cash_expected: 600 });
    const r = await closeShift(cashier.id, orgId, { siteId, cashFact: 550 });
    expect(r.cash_diff).toBe(-50);
  });
});

describe('Импорт продаж внешней кассы: уникальный ID, очередь сопоставления', () => {
  it('повторный импорт не дублирует; неизвестное название — в очередь; сопоставили раз — списалось', async () => {
    const rows = [
      { externalId: 'iiko-1', soldAt: new Date().toISOString(), name: 'Бефстроганов', qty: 1, price: 450 },
      { externalId: 'iiko-2', soldAt: new Date().toISOString(), name: 'Морс клюкв. 0,3', qty: 2, price: 150 },
      { externalId: 'iiko-3', soldAt: new Date().toISOString(), name: 'Морс клюкв. 0,3', qty: 1, price: 150 },
    ];
    expect(await importSales(accountant.id, orgId, { siteId, source: 'iiko', rows })).toMatchObject({ inserted: 3, duplicates: 0, done: 1, unmatched: 2 });
    expect(await importSales(accountant.id, orgId, { siteId, source: 'iiko', rows })).toMatchObject({ inserted: 0, duplicates: 3 });
    const q = await salesQueue(accountant.id, orgId);
    expect(q.unmatched).toEqual([{ source: 'iiko', name: 'Морс клюкв. 0,3', count: 2, qty: 3 }]);
    expect(await mapSaleName(accountant.id, orgId, { source: 'iiko', name: 'морс клюкв. 0,3', dishId: mors })).toMatchObject({ matched: 2, done: 2 });
    expect((await salesQueue(accountant.id, orgId)).unmatched).toEqual([]);
    await expect(importSales(cashier.id, orgId, { siteId, source: 'iiko', rows })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('Экономика', () => {
  it('выручка с возвратами, себестоимость списанного, фудкост; кассир отчёт не видит', async () => {
    const e = await economics(accountant.id, orgId, { siteId, from: today, to: today });
    expect(e).toMatchObject({ revenue: 1200 - 1200 + 450 + 450, refunds: 1200, orders: 1, complete: true });
    // касса: бефстроганов 2 порц. 242,4 + морс 2 порц. (0,1 кг × 300) 30; импорт: бефстроганов 121,2 + морс 3 порц. 45
    expect(e.cogs).toBeCloseTo(242.4 + 30 + 121.2 + 45, 6);
    expect(e.top[0].name).toBe('Бефстроганов');
    expect(e.shifts[0]).toMatchObject({ cash_diff: -50 });
    await expect(economics(cashier.id, orgId, { siteId, from: today, to: today })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(economics(stranger.id, orgId, { from: today, to: today })).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) });
  });
});
