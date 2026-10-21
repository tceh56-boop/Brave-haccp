import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createProduct, createSupplier, listSuppliers } from '../src/server/ops/catalog';
import { createReceipt, addReceiptLine, completeReceipt, getReceipt } from '../src/server/ops/receipts';
import { consume } from '../src/server/ops/stock';
import { purchaseNeeds, setNorm, createOrder, listOrders, getOrder, editOrder, stepOrder, cancelOrder, startReceiptFromOrder, updateSupplier } from '../src/server/ops/purchasing';
import { makeUser, lastLinkToken } from './helpers';

afterAll(() => closePool());

type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, chef: U, keeper: U, cook: U, accountant: U, stranger: U;
let orgId: string, siteId: string, farm: string, other: string, beef: string, cream: string;
const ALL_OK = { packaging: true, labeling: true, documents: true, quality: true };
const inDays = (n: number) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const need = async (productId: string) => (await purchaseNeeds(keeper.id, orgId, siteId)).find((x) => x.product_id === productId)!;

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кафе «Закупки»' });
  orgId = r.organization.id; siteId = r.site.id;
  chef = await invite('chef'); keeper = await invite('storekeeper'); cook = await invite('line_staff'); accountant = await invite('accountant');
  stranger = await makeUser(); await createOrganization(stranger, { name: 'Чужое кафе' });
  beef = (await createProduct(chef.id, orgId, { name: 'Говядина вырезка', unit: 'кг' })).id;
  cream = (await createProduct(chef.id, orgId, { name: 'Сливки 33%', unit: 'л' })).id;
  farm = (await createSupplier(chef.id, orgId, { name: 'ООО «Фермер»' })).id;
  other = (await createSupplier(chef.id, orgId, { name: 'ООО «Сомнительный»' })).id;
  // 10 кг говядины по 500 ₽, расход 2,8 кг (за 28 дней — 0,1 кг/день)
  const rc = await createReceipt(cook.id, orgId, { siteId, supplierId: farm });
  await addReceiptLine(cook.id, orgId, rc.id, { productId: beef, quantity: 10, unitPrice: 500, lotNo: 'B1', expiresAt: inDays(10), expiryBasis: 'маркировка изготовителя', checks: ALL_OK, decision: 'accepted' });
  await completeReceipt(cook.id, orgId, rc.id);
  await consume(cook.id, orgId, { siteId, productId: beef, quantity: 2.8, purpose: 'горячий цех', operationId: randomUUID() });
});

describe('Этап 12: что заказать и нормы запаса', () => {
  it('позиция с расходом видна без нормы: остаток, расход в день, дни запаса, последний поставщик и цена', async () => {
    const x = await need(beef);
    expect(x.norm).toBeNull();
    expect(x.stock).toBe(7.2);
    expect(x.daily).toBe(0.1);
    expect(x.days_left).toBe(72);
    expect(x.suggest).toBe(0);                                   // без нормы — ничего не придумываем
    expect(x).toMatchObject({ last_supplier_id: farm, last_supplier: 'ООО «Фермер»', last_price: 500 });
    expect((await purchaseNeeds(keeper.id, orgId, siteId)).find((p) => p.product_id === cream)).toBeUndefined();
  });

  it('ручная норма требует основание; права — у закупщика, не у повара; чужим недоступно', async () => {
    await expect(setNorm(keeper.id, orgId, { siteId, productId: beef, mode: 'manual', minQty: 20 })).rejects.toThrow(/основание/);
    await expect(setNorm(cook.id, orgId, { siteId, productId: beef, mode: 'auto' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(setNorm(accountant.id, orgId, { siteId, productId: beef, mode: 'auto' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(purchaseNeeds(cook.id, orgId, siteId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(purchaseNeeds(stranger.id, orgId, siteId)).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) });
    expect((await purchaseNeeds(accountant.id, orgId, siteId)).length).toBeGreaterThan(0);
  });

  it('автонорма = расход в день × дни × (1 + страховой %); ручная — заданное количество', async () => {
    await setNorm(keeper.id, orgId, { siteId, productId: beef, mode: 'auto', coverDays: 7, safetyPct: 50 });
    let x = await need(beef);
    expect(x.norm).toMatchObject({ mode: 'auto', min: 1.05 });
    expect(x.suggest).toBe(0);
    await setNorm(keeper.id, orgId, { siteId, productId: beef, mode: 'manual', minQty: '20', basis: 'поставка раз в неделю, запас на 7 дней' });
    x = await need(beef);
    expect(x.norm).toMatchObject({ mode: 'manual', min: 20 });
    expect(x.suggest).toBe(12.8);
    expect(x.days_left).toBe(72);
    // норма на позицию без расхода — позиция появляется, предложение = вся норма
    await setNorm(keeper.id, orgId, { siteId, productId: cream, mode: 'manual', minQty: 5, basis: 'минимум для соусов на выходные' });
    expect((await need(cream)).suggest).toBe(5);
    expect((await purchaseNeeds(keeper.id, orgId, siteId))[0].suggest).toBeGreaterThan(0);   // сначала то, что надо заказать
    await setNorm(keeper.id, orgId, { siteId, productId: cream, mode: 'off' });
    expect((await purchaseNeeds(keeper.id, orgId, siteId)).find((p) => p.product_id === cream)).toBeUndefined();
  });
});

describe('Этап 12: заказ поставщику и приёмка по заказу', () => {
  let orderId: string;
  it('заблокированному поставщику заказ не создаётся; контакты и блокировка — с причиной', async () => {
    await expect(updateSupplier(keeper.id, orgId, other, { blockedReason: 'нет' })).rejects.toThrow(/не короче/);
    await updateSupplier(keeper.id, orgId, other, { phone: '+7 900 000-00-00', blockedReason: 'две поставки с нарушением температуры' });
    await updateSupplier(keeper.id, orgId, farm, { email: 'zakaz@fermer.example' });
    await expect(updateSupplier(keeper.id, orgId, farm, { email: 'не почта' })).rejects.toThrow(/email/);
    const list = await listSuppliers(keeper.id, orgId);
    expect(list.find((s: { id: string }) => s.id === other)).toMatchObject({ blocked_reason: 'две поставки с нарушением температуры' });
    await expect(createOrder(keeper.id, orgId, { siteId, supplierId: other, lines: [{ productId: beef, quantity: 1 }] })).rejects.toThrow(/заблокирован/);
    await expect(createOrder(accountant.id, orgId, { siteId, supplierId: farm, lines: [{ productId: beef, quantity: 1 }] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(createOrder(keeper.id, orgId, { siteId, supplierId: farm, lines: [] })).rejects.toThrow(/позицию/);
  });

  it('черновик не уменьшает «к заказу»; отправленный — уменьшает; менять можно только черновик', async () => {
    const o = await createOrder(keeper.id, orgId, { siteId, supplierId: farm, expectedAt: inDays(2), lines: [{ productId: beef, quantity: '12,8', price: 500 }, { productId: cream, quantity: 3 }] });
    orderId = o.id;
    expect(o.number).toBe(1);
    expect(await need(beef)).toMatchObject({ draft: 12.8, ordered: 0, suggest: 12.8 });
    await editOrder(keeper.id, orgId, orderId, { lines: [{ productId: beef, quantity: 12, price: 510 }], removeProductIds: [cream] });
    let g = await getOrder(keeper.id, orgId, orderId);
    expect(g.lines).toHaveLength(1);
    expect(g.amount).toBe(6120);
    expect(g.text).toMatch(/Заказ № 1 для «ООО «Фермер»»[\s\S]*Говядина вырезка — 12 кг × 510 ₽/);
    await stepOrder(keeper.id, orgId, orderId, 'send');
    expect(await need(beef)).toMatchObject({ draft: 0, ordered: 12, suggest: 0.8 });
    await expect(editOrder(keeper.id, orgId, orderId, { lines: [{ productId: beef, quantity: 1 }] })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(stepOrder(keeper.id, orgId, orderId, 'send')).rejects.toMatchObject({ code: 'CONFLICT' });
    await stepOrder(keeper.id, orgId, orderId, 'confirm');
    g = await getOrder(accountant.id, orgId, orderId);
    expect(g.order.status).toBe('confirmed');
    await expect(getOrder(stranger.id, orgId, orderId)).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) });
  });

  it('приёмка по заказу: черновик с поставщиком заказа, повторный вызов — тот же; завершение → заказ «принят», видны расхождения', async () => {
    const a = await startReceiptFromOrder(cook.id, orgId, orderId);
    expect(a.existing).toBe(false);
    expect((await startReceiptFromOrder(cook.id, orgId, orderId))).toEqual({ receipt_id: a.receipt_id, existing: true });
    await expect(cancelOrder(keeper.id, orgId, orderId, { reason: 'передумали' })).rejects.toThrow(/приёмка/);
    const rc = await getReceipt(cook.id, orgId, a.receipt_id);
    expect(rc.order).toMatchObject({ id: orderId, number: 1 });
    expect(rc.order!.lines[0]).toMatchObject({ product_id: beef, unit: 'кг' });
    await addReceiptLine(cook.id, orgId, a.receipt_id, { productId: beef, quantity: 11.5, unitPrice: 510, lotNo: 'B2', expiresAt: inDays(10), expiryBasis: 'маркировка изготовителя', checks: ALL_OK, decision: 'accepted' });
    await addReceiptLine(cook.id, orgId, a.receipt_id, { productId: cream, quantity: 1, unitPrice: 300, lotNo: 'C1', expiresAt: inDays(5), expiryBasis: 'маркировка изготовителя', checks: ALL_OK, decision: 'accepted' });
    await completeReceipt(cook.id, orgId, a.receipt_id);
    const g = await getOrder(keeper.id, orgId, orderId);
    expect(g.order.status).toBe('received');
    expect(g.lines[0]).toMatchObject({ received: '11.5', diff: -0.5 });
    expect(g.extra).toEqual([expect.objectContaining({ product: 'Сливки 33%' })]);
    expect(await need(beef)).toMatchObject({ ordered: 0, stock: 18.7, suggest: 1.3 });
    await expect(startReceiptFromOrder(cook.id, orgId, orderId)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(cancelOrder(keeper.id, orgId, orderId, { reason: 'поздно' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('отмена — с причиной; нумерация сквозная; приёмка из черновика заказа запрещена', async () => {
    const o = await createOrder(keeper.id, orgId, { siteId, supplierId: farm, lines: [{ productId: beef, quantity: 2 }] });
    expect(o.number).toBe(2);
    await expect(startReceiptFromOrder(cook.id, orgId, o.id)).rejects.toThrow(/отправьте/);
    await expect(cancelOrder(keeper.id, orgId, o.id, { reason: '' })).rejects.toThrow(/причину/);
    await cancelOrder(keeper.id, orgId, o.id, { reason: 'заказали у другого поставщика' });
    const list = await listOrders(keeper.id, orgId, siteId);
    expect(list.map((x) => [x.number, x.status]).sort()).toEqual([[1, 'received'], [2, 'cancelled']]);
    const audit = (await withSystem((tx) => tx.query(`select action from audit_events where organization_id = $1 and action like 'purchase.%' order by created_at`, [orgId]))).rows.map((x) => x.action);
    expect(audit).toEqual(expect.arrayContaining(['purchase.order_create', 'purchase.order_edit', 'purchase.order_send', 'purchase.order_confirm', 'purchase.order_cancel']));
  });
});
