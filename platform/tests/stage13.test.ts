import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createProduct, createSupplier } from '../src/server/ops/catalog';
import { createReceipt, addReceiptLine, completeReceipt } from '../src/server/ops/receipts';
import { createDish, getDish, updateVersion, addLine, submitVersion, approveVersion } from '../src/server/ops/recipes';
import { createProduction } from '../src/server/ops/production';
import { createOrder } from '../src/server/ops/purchasing';
import { createEvent, listEvents, getEvent, updateEvent, setItem, removeItem, confirmEvent, cancelEvent, completeEvent } from '../src/server/ops/planmenu';
import { makeUser, lastLinkToken } from './helpers';

afterAll(() => closePool());

type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, chef: U, cook: U, cashier: U, stranger: U;
let orgId: string, siteId: string, supplierId: string, beef: string, onion: string, broth: string, stew: string, salad: string, ev1: string;
const ALL_OK = { packaging: true, labeling: true, documents: true, quality: true };
const inDays = (n: number) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
const later = new Date(Date.now() + 2 * 86400e3).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
const line = (x: Awaited<ReturnType<typeof getEvent>>, productId: string) => x.needs!.lines.find((l) => l.product_id === productId)!;

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}
async function receive(productId: string, quantity: number, unitPrice: number, lotNo: string, expiresAt: string) {
  const r = await createReceipt(cook.id, orgId, { siteId, supplierId });
  await addReceiptLine(cook.id, orgId, r.id, { productId, quantity, unitPrice, lotNo, expiresAt, expiryBasis: 'маркировка изготовителя', checks: ALL_OK, decision: 'accepted' });
  await completeReceipt(cook.id, orgId, r.id);
}
async function withTtk(name: string, kind: 'dish' | 'semi', yieldG: number, lines: Record<string, unknown>[]) {
  const d = await createDish(chef.id, orgId, { name, kind, salePrice: kind === 'dish' ? 300 : undefined });
  const v = (await getDish(chef.id, orgId, d.id)).current!.version.id;
  await updateVersion(chef.id, orgId, v, { yieldG, portionG: kind === 'dish' ? yieldG : undefined, technology: 'Приготовить по технологии предприятия.', storageConditions: '+2…+6 °C', shelfLife: '24 часа' });
  for (const l of lines) await addLine(chef.id, orgId, v, l);
  await submitVersion(chef.id, orgId, v);
  await approveVersion(chef.id, orgId, v);
  return d.id as string;
}

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Ресторан «Банкет»' });
  orgId = r.organization.id; siteId = r.site.id;
  chef = await invite('chef'); cook = await invite('line_staff'); cashier = await invite('cashier');
  stranger = await makeUser(); await createOrganization(stranger, { name: 'Чужой ресторан' });
  beef = (await createProduct(chef.id, orgId, { name: 'Говядина на кости', unit: 'кг' })).id;
  onion = (await createProduct(chef.id, orgId, { name: 'Лук репчатый', unit: 'кг' })).id;
  supplierId = (await createSupplier(chef.id, orgId, { name: 'ООО «Фермер»' })).id;
  // Бульон (п/ф): 1 кг из 0,8 кг говядины и 0,2 кг лука; суп: порция 300 г — 250 г бульона + 50 г лука, цена 300 ₽
  broth = await withTtk('Бульон говяжий', 'semi', 1000, [{ productId: beef, unit: 'кг', brutto: 0.8, netto: 0.7 }, { productId: onion, unit: 'кг', brutto: 0.2, netto: 0.18 }]);
  stew = await withTtk('Суп с луком', 'dish', 300, [{ subDishId: broth, unit: 'г', brutto: 250, netto: 250 }, { productId: onion, unit: 'г', brutto: 50, netto: 50 }]);
  salad = (await createDish(chef.id, orgId, { name: 'Салат сезонный', kind: 'dish' })).id;   // без утверждённой ТТК
  await receive(beef, 2, 600, 'Г-1', inDays(1));       // истекает до мероприятия — в остаток на его день не входит
  await receive(beef, 3, 700, 'Г-2', inDays(10));
  await receive(onion, 3, 40, 'Л-1', inDays(20));
});

describe('Этап 13: мероприятие и меню', () => {
  it('создание: гости и дата обязательны; права — у шефа, не у повара; номер сквозной', async () => {
    await expect(createEvent(chef.id, orgId, { siteId, title: 'Юбилей', eventDate: later, guests: 0 })).rejects.toThrow(/гостей/);
    await expect(createEvent(cook.id, orgId, { siteId, title: 'Юбилей', eventDate: later, guests: 20 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const e = await createEvent(chef.id, orgId, { siteId, title: 'Юбилей', eventDate: later, eventTime: '18:00', guests: 20, format: 'банкет', contact: 'Ирина, +7 900 000-00-00' });
    ev1 = e.id;
    expect(e).toMatchObject({ number: 1, status: 'planned', event_date: later });
    expect((await listEvents(cook.id, orgId, siteId, null)).map((x) => x.title)).toEqual(['Юбилей']);
    await expect(getEvent(cashier.id, orgId, ev1)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(getEvent(stranger.id, orgId, ev1)).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) });
  });

  it('позиции: «на гостя» — ⌈норма × гости⌉ и пересчёт при смене гостей; «итого» — как на бланке; п/ф в меню не добавить', async () => {
    await expect(setItem(chef.id, orgId, ev1, { dishId: stew })).rejects.toThrow(/либо/);
    await expect(setItem(chef.id, orgId, ev1, { dishId: broth, portions: 5 })).rejects.toThrow(/полуфабрикаты/);
    expect(await setItem(chef.id, orgId, ev1, { dishId: stew, perGuest: '1', note: 'горячее' })).toEqual({ portions: 20 });
    expect(await setItem(chef.id, orgId, ev1, { dishId: salad, portions: 10, price: 250 })).toEqual({ portions: 10 });
    const x = await getEvent(chef.id, orgId, ev1);
    expect(x.items.map((i) => [i.dish, i.portions, i.price])).toEqual([['Салат сезонный', 10, 250], ['Суп с луком', 20, 300]]);
    expect(x.amount).toBe(8500);
    expect(x.per_guest_amount).toBe(425);
    expect((await getEvent(cook.id, orgId, ev1)).amount).toBeNull();          // цены — не всем
    await updateEvent(chef.id, orgId, ev1, { guests: 23 });
    const y = await getEvent(chef.id, orgId, ev1);
    expect(y.items.find((i) => i.dish_id === stew)!.portions).toBe(23);
    expect(y.items.find((i) => i.dish_id === salad)!.portions).toBe(10);
  });

  it('потребность по ТТК: блюдо без ТТК — «не рассчитано»; остаток на день мероприятия; п/ф к приготовлению', async () => {
    const x = await getEvent(chef.id, orgId, ev1);
    expect(x.needs!.complete).toBe(false);
    expect(x.needs!.missing[0].dish).toBe('Салат сезонный');
    // 23 порции: бульон 5,75 кг → говядина 4,6 кг, лук 1,15 + 1,15 = 2,3 кг
    expect(line(x, beef)).toMatchObject({ need: 4.6, stock: 3, ordered: 0, shortage: 1.6, last_supplier_id: supplierId, last_price: 700 });
    expect(line(x, onion)).toMatchObject({ need: 2.3, stock: 3, shortage: 0 });
    expect(x.needs!.semis).toEqual([expect.objectContaining({ dish_id: broth, need_kg: 5.75, ready_kg: 0, to_make_kg: 5.75 })]);
    await expect(confirmEvent(chef.id, orgId, ev1)).rejects.toThrow(/Салат сезонный/);
  });

  it('заказ и производство под мероприятие уменьшают нехватку; подтверждение — когда у всех блюд ТТК', async () => {
    await createOrder(chef.id, orgId, { siteId, supplierId, planEventId: ev1, lines: [{ productId: beef, quantity: 1.6 }] });
    await createProduction(chef.id, orgId, { siteId, dishId: broth, plannedKg: 5.75, plannedFor: today, planEventId: ev1 });
    await removeItem(chef.id, orgId, ev1, salad);
    const x = await getEvent(chef.id, orgId, ev1);
    expect(line(x, beef)).toMatchObject({ ordered: 1.6, shortage: 0 });
    expect(x.needs!.semis[0]).toMatchObject({ planned_kg: 5.75, to_make_kg: 0 });
    expect(x.orders).toHaveLength(1);
    expect(x.production).toHaveLength(1);
    await confirmEvent(chef.id, orgId, ev1);
    await expect(completeEvent(chef.id, orgId, ev1, { operationId: randomUUID() })).rejects.toThrow(/не наступило/);
    await cancelEvent(chef.id, orgId, ev1, { reason: 'заказчик перенёс на весну' });
    await expect(setItem(chef.id, orgId, ev1, { dishId: stew, portions: 5 })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(createOrder(chef.id, orgId, { siteId, supplierId, planEventId: ev1, lines: [{ productId: beef, quantity: 1 }] })).rejects.toThrow(/Мероприятие/);
  });
});

describe('Этап 13: «Проведено» — списание по ТТК', () => {
  it('факт порций, FEFO, себестоимость и выручка; повтор операции не списывает второй раз', async () => {
    const e = await createEvent(chef.id, orgId, { siteId, title: 'Обед для группы', eventDate: today, guests: 2 });
    expect(e.number).toBe(2);
    await setItem(chef.id, orgId, e.id, { dishId: stew, portions: 2 });
    await expect(completeEvent(chef.id, orgId, e.id, { operationId: randomUUID() })).rejects.toThrow(/подтвердите/);
    await confirmEvent(chef.id, orgId, e.id);
    const op = randomUUID();
    await expect(completeEvent(cook.id, orgId, e.id, { operationId: op })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // факт 3 порции: говядина 0,6 кг (партия Г-1 по 600 ₽ — раньше истекает), лук 0,3 кг по 40 ₽
    const r = await completeEvent(chef.id, orgId, e.id, { operationId: op, actual: [{ dishId: stew, portions: 3 }] });
    expect(r).toMatchObject({ status: 'done', revenue: 900, cost: 372 });
    expect(await completeEvent(chef.id, orgId, e.id, { operationId: op, actual: [{ dishId: stew, portions: 3 }] })).toMatchObject({ repeated: true });
    const mv = (await withSystem((tx) => tx.query(`select l.lot_no, -m.quantity as q from stock_movements m join lots l on l.id = m.lot_id where m.ref_type = 'banquet' and m.ref_id = $1 order by l.lot_no`, [e.id]))).rows;
    expect(mv.map((m) => [m.lot_no, Math.round(Number(m.q) * 1000) / 1000])).toEqual([['Г-1', 0.6], ['Л-1', 0.3]]);
    const x = await getEvent(chef.id, orgId, e.id);
    expect(x.event).toMatchObject({ status: 'done', revenue: 900, cost: 372 });
    expect(x.items[0]).toMatchObject({ actual_portions: 3, cost: 372 });
    expect(x.needs).toBeNull();
    expect((await getEvent(cook.id, orgId, e.id)).event).toMatchObject({ revenue: null, cost: null });
    expect((await listEvents(chef.id, orgId, siteId, 'past')).map((y) => y.status).sort()).toEqual(['cancelled', 'done']);
  });

  it('не хватает остатка — ничего не списывается', async () => {
    const e = await createEvent(chef.id, orgId, { siteId, title: 'Большой фуршет', eventDate: today, guests: 100 });
    await setItem(chef.id, orgId, e.id, { dishId: stew, perGuest: 1 });
    await confirmEvent(chef.id, orgId, e.id);
    await expect(completeEvent(chef.id, orgId, e.id, { operationId: randomUUID() })).rejects.toThrow(/Не хватает/);
    expect((await getEvent(chef.id, orgId, e.id)).event.status).toBe('confirmed');
    const audit = (await withSystem((tx) => tx.query(`select action from audit_events where organization_id = $1 and action like 'event.%'`, [orgId]))).rows.map((a) => a.action);
    expect(audit).toEqual(expect.arrayContaining(['event.create', 'event.item', 'event.update', 'event.item_remove', 'event.confirm', 'event.cancel', 'event.complete']));
  });
});
