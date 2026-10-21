import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createProduct, createSupplier } from '../src/server/ops/catalog';
import { createReceipt, addReceiptLine, completeReceipt } from '../src/server/ops/receipts';
import { getLot } from '../src/server/ops/lots';
import { trace } from '../src/server/ops/stock';
import { createDish, getDish, updateVersion, addLine, submitVersion, approveVersion, newVersion } from '../src/server/ops/recipes';
import { openShift, createOrder, addOrderLine, payOrder } from '../src/server/ops/pos';
import { listProduction, producibleDishes, createProduction, getProduction, startProduction, recordCheck, completeProduction, cancelProduction,
  addReleaseCheck, listReleaseChecks, archiveReleaseCheck } from '../src/server/ops/production';
import { listTasks } from '../src/server/ops/tasks';
import { makeUser, lastLinkToken } from './helpers';

afterAll(() => closePool());

type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, chef: U, cook: U, haccp: U, cashier: U, stranger: U;
let orgId: string, siteId: string, supplierId: string, beef: string, onion: string, broth: string, stew: string;
const ALL_OK = { packaging: true, labeling: true, documents: true, quality: true };
const inDays = (n: number) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);
const op = () => randomUUID();
const qty = async (productId: string) => Number((await withSystem((tx) => tx.query(`select coalesce(sum(quantity), 0) as q from lots where product_id = $1 and status = 'available'`, [productId]))).rows[0].q);

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}
async function receive(productId: string, quantity: number, unitPrice: number, lotNo: string, expiresAt = inDays(5)) {
  const r = await createReceipt(cook.id, orgId, { siteId, supplierId });
  await addReceiptLine(cook.id, orgId, r.id, { productId, quantity, unitPrice, lotNo, expiresAt, expiryBasis: 'маркировка изготовителя', checks: ALL_OK, decision: 'accepted' });
  await completeReceipt(cook.id, orgId, r.id);
}
/** Блюдо или п/ф с утверждённой ТТК. */
async function withTtk(name: string, kind: 'dish' | 'semi', yieldG: number, lines: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  const d = await createDish(chef.id, orgId, { name, kind, salePrice: kind === 'dish' ? 300 : undefined });
  const v = (await getDish(chef.id, orgId, d.id)).current!.version.id;
  await updateVersion(chef.id, orgId, v, { yieldG, portionG: kind === 'dish' ? yieldG : undefined, technology: 'Приготовить по технологии предприятия.', storageConditions: '+2…+6 °C', shelfLife: '24 часа', ...extra });
  for (const l of lines) await addLine(chef.id, orgId, v, l);
  await submitVersion(chef.id, orgId, v);
  await approveVersion(chef.id, orgId, v);
  return d.id as string;
}

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кафе «Цех заготовок»' });
  orgId = r.organization.id; siteId = r.site.id;
  chef = await invite('chef'); cook = await invite('line_staff'); haccp = await invite('haccp_lead'); cashier = await invite('cashier');
  stranger = await makeUser(); await createOrganization(stranger, { name: 'Чужое кафе' });
  beef = (await createProduct(chef.id, orgId, { name: 'Говядина на кости', unit: 'кг' })).id;
  onion = (await createProduct(chef.id, orgId, { name: 'Лук репчатый', unit: 'кг' })).id;
  supplierId = (await createSupplier(chef.id, orgId, { name: 'ООО «Фермер»' })).id;
  // Бульон (п/ф): 1 кг выхода из 0,8 кг говядины и 0,2 кг лука, хранение 48 ч
  broth = await withTtk('Бульон говяжий', 'semi', 1000, [{ productId: beef, unit: 'кг', brutto: 0.8, netto: 0.7 }, { productId: onion, unit: 'кг', brutto: 0.2, netto: 0.18 }], { shelfLifeHours: 48 });
  // Суп (блюдо): порция 300 г — 250 г бульона + 50 г лука
  stew = await withTtk('Суп с луком', 'dish', 300, [{ subDishId: broth, unit: 'г', brutto: 250, netto: 250 }, { productId: onion, unit: 'г', brutto: 50, netto: 50 }]);
  await receive(beef, 4, 600, 'Г-1', inDays(2));
  await receive(beef, 4, 700, 'Г-2', inDays(6));
  await receive(onion, 3, 40, 'Л-1');
});

describe('Задание на производство п/ф', () => {
  it('ставится только для п/ф с утверждённой ТТК и правом планирования; повар видит, но не планирует', async () => {
    expect((await producibleDishes(cook.id, orgId)).map((d: { name: string }) => d.name)).toEqual(['Бульон говяжий']);
    await expect(createProduction(chef.id, orgId, { siteId, dishId: stew, plannedKg: 1, plannedFor: today })).rejects.toThrow(/полуфабрикаты/);
    await expect(createProduction(cook.id, orgId, { siteId, dishId: broth, plannedKg: 1, plannedFor: today })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(createProduction(cashier.id, orgId, { siteId, dishId: broth, plannedKg: 1, plannedFor: today })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const o = await createProduction(chef.id, orgId, { siteId, dishId: broth, plannedKg: '2,5', plannedFor: today, note: 'на обед' });
    expect(Number(o.planned_g)).toBe(2500);
    const card = await getProduction(cook.id, orgId, o.id);
    expect(card.need).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Говядина на кости', need: 2, have: 8, enough: true })]));
    const list = await listProduction(cook.id, orgId, siteId);
    expect(list.map((x: { id: string }) => x.id)).toContain(o.id);
    await expect(getProduction(stranger.id, orgId, o.id)).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) });
    await cancelProduction(chef.id, orgId, o.id, { reason: 'перенесли на завтра' });
    await expect(startProduction(cook.id, orgId, o.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('Контроль при выпуске и выпуск партии п/ф', () => {
  let checkId: string, orderId: string;

  it('ККТ задаёт ХАССП с основанием; выпуск закрыт без замера в пределах; вне предела — отклонение', async () => {
    await expect(addReleaseCheck(cook.id, orgId, broth, { name: 'Температура в толще', min: 75, basis: 'План ХАССП, ККТ-1' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(addReleaseCheck(haccp.id, orgId, broth, { name: 'Температура в толще', basis: 'План ХАССП, ККТ-1' })).rejects.toThrow(/предел/);
    checkId = (await addReleaseCheck(haccp.id, orgId, broth, { name: 'Температура в толще', unit: '°C', min: 75, basis: 'План ХАССП, ККТ-1: тепловая обработка' })).id;
    expect(await listReleaseChecks(cook.id, orgId, broth)).toEqual([expect.objectContaining({ limits: 'не ниже 75 °C' })]);
    orderId = (await createProduction(chef.id, orgId, { siteId, dishId: broth, plannedKg: 2, plannedFor: today })).id;
    await expect(completeProduction(cook.id, orgId, orderId, { actualKg: 1.9, operationId: op() })).rejects.toThrow(/Сначала «Начать»/);
    await expect(recordCheck(cook.id, orgId, orderId, { checkId, value: 80 })).rejects.toThrow(/«в работе»/);
    await startProduction(cook.id, orgId, orderId);
    await expect(completeProduction(cook.id, orgId, orderId, { actualKg: 1.9, operationId: op() })).rejects.toThrow(/Выпуск закрыт: нет замера в пределах — Температура в толще \(не ниже 75 °C\)/);
    const bad = await recordCheck(cook.id, orgId, orderId, { checkId, value: 68 });
    expect(bad).toMatchObject({ ok: false, incident_id: expect.any(String) });
    const inc = (await withSystem((tx) => tx.query(`select kind, severity, rule_source, status from incidents where id = $1`, [bad.incident_id]))).rows[0];
    expect(inc).toMatchObject({ kind: 'release_check', severity: 'high', rule_source: 'План ХАССП, ККТ-1: тепловая обработка' });
    await expect(completeProduction(cook.id, orgId, orderId, { actualKg: 1.9, operationId: op() })).rejects.toThrow(/Выпуск закрыт/);
    expect(await recordCheck(cook.id, orgId, orderId, { checkId, value: 82 })).toMatchObject({ ok: true });
    await expect(withSystem((tx) => tx.query(`update production_checks set value = 90 where order_id = $1`, [orderId]))).rejects.toThrow(/не изменяются/);
  });

  it('выпуск: сырьё по FEFO по плану, партия по факту со сроком из ТТК и себестоимостью, этикетка, прослеживаемость; повтор не списывает дважды', async () => {
    const beefBefore = await qty(beef), onionBefore = await qty(onion);
    const id = op();
    const r = await completeProduction(cook.id, orgId, orderId, { actualKg: '1,9', operationId: id });
    expect(r).toMatchObject({ unit: 'кг', quantity: 1.9, expiry_basis: expect.stringContaining('ТТК «Бульон говяжий» v1: 48 ч'), yield_diff_pct: -5 });
    // 2 кг выхода: говядина 1,6 кг (из Г-1 по 600 ₽ — ближайший срок), лук 0,4 кг по 40 ₽ → 960 + 16 = 976 ₽
    expect(r.cost).toBe(976);
    expect(r.unit_price).toBeCloseTo(976 / 1.9, 2);
    expect(await qty(beef)).toBeCloseTo(beefBefore - 1.6, 6);
    expect(await qty(onion)).toBeCloseTo(onionBefore - 0.4, 6);
    expect(await completeProduction(cook.id, orgId, orderId, { actualKg: '1,9', operationId: id })).toMatchObject({ lot_id: r.lot_id, repeated: true });
    expect(await qty(beef)).toBeCloseTo(beefBefore - 1.6, 6);
    await expect(completeProduction(cook.id, orgId, orderId, { actualKg: 1, operationId: op() })).rejects.toMatchObject({ code: 'CONFLICT' });
    const lot = (await getLot(cook.id, orgId, r.lot_id)).lot;
    expect(lot).toMatchObject({ status: 'available', expiry_state: 'ok', unit: 'кг', product: 'Бульон говяжий' });
    expect(Math.abs(new Date(lot.expires_at).getTime() - (Date.now() + 48 * 3600e3))).toBeLessThan(60e3);
    const card = await getProduction(cook.id, orgId, orderId);
    expect(card.order).toMatchObject({ status: 'done', output_lot_id: r.lot_id });
    expect(card.consumed.map((c: { lot_no: string }) => c.lot_no).sort()).toEqual(['Г-1', 'Л-1']);
    expect(card.label).toMatchObject({ id: r.label_id });
    const tr = JSON.stringify(await trace(owner.id, orgId, r.lot_id));
    expect(tr).toContain('Г-1');
  });

  it('продажа блюда с п/ф берёт готовый бульон со склада, а не сырьё второй раз', async () => {
    await openShift(cashier.id, orgId, { siteId, cashStart: 0 });
    const o = await createOrder(cashier.id, orgId, { siteId });
    await addOrderLine(cashier.id, orgId, o.order.id, { dishId: stew });
    await addOrderLine(cashier.id, orgId, o.order.id, { dishId: stew });
    const broth0 = await qty((await withSystem((tx) => tx.query(`select product_id from dishes where id = $1`, [broth]))).rows[0].product_id);
    const beef0 = await qty(beef), onion0 = await qty(onion);
    await payOrder(cashier.id, orgId, o.order.id, { payments: [{ method: 'card', amount: 600 }], operationId: op() });
    const brothProduct = (await withSystem((tx) => tx.query(`select product_id from dishes where id = $1`, [broth]))).rows[0].product_id;
    expect(await qty(brothProduct)).toBeCloseTo(broth0 - 0.5, 6);        // 2 порции × 250 г бульона
    expect(await qty(beef)).toBeCloseTo(beef0, 6);                        // говядина повторно не списана
    expect(await qty(onion)).toBeCloseTo(onion0 - 0.1, 6);               // 2 × 50 г лука
  });

  it('без часов хранения в ТТК партия п/ф — «срок не подтверждён» и задача шефу; новая версия ТТК закрывает старые задания', async () => {
    const plain = await withTtk('Лук пассерованный', 'semi', 500, [{ productId: onion, unit: 'кг', brutto: 0.6, netto: 0.55 }]);
    const o = await createProduction(chef.id, orgId, { siteId, dishId: plain, plannedKg: 0.5, plannedFor: today });
    await startProduction(cook.id, orgId, o.id);
    const r = await completeProduction(cook.id, orgId, o.id, { actualKg: 0.5, operationId: op() });
    expect(r.expires_at).toBeNull();
    expect((await getLot(cook.id, orgId, r.lot_id)).lot.expiry_state).toBe('unconfirmed');
    const tasks = await listTasks(chef.id, orgId, { all: true });
    expect(tasks.some((t: { kind: string; entity_id: string }) => t.kind === 'confirm_expiry' && t.entity_id === r.lot_id)).toBe(true);

    const o2 = await createProduction(chef.id, orgId, { siteId, dishId: plain, plannedKg: 0.5, plannedFor: today });
    await startProduction(cook.id, orgId, o2.id);
    const v2 = await newVersion(chef.id, orgId, plain, { changeReason: 'уточнили закладку лука' });
    await submitVersion(chef.id, orgId, v2.id);
    await approveVersion(chef.id, orgId, v2.id);
    await expect(completeProduction(cook.id, orgId, o2.id, { actualKg: 0.5, operationId: op() })).rejects.toThrow(/больше не действует/);
  });

  it('нехватка сырья — выпуск отклоняется целиком, ничего не списано; параметр ККТ снимается только с основанием', async () => {
    const o = await createProduction(chef.id, orgId, { siteId, dishId: broth, plannedKg: 20, plannedFor: today });
    await startProduction(cook.id, orgId, o.id);
    await recordCheck(cook.id, orgId, o.id, { checkId, value: 90 });
    const b0 = await qty(beef);
    await expect(completeProduction(cook.id, orgId, o.id, { actualKg: 20, operationId: op() })).rejects.toThrow(/Не хватает годного остатка «Говядина на кости»/);
    expect(await qty(beef)).toBeCloseTo(b0, 6);
    await expect(archiveReleaseCheck(haccp.id, orgId, checkId, { reason: 'нет' })).rejects.toThrow(/основание/);
    await archiveReleaseCheck(haccp.id, orgId, checkId, { reason: 'План ХАССП v2: ККТ перенесена на этап охлаждения' });
    expect(await listReleaseChecks(cook.id, orgId, broth)).toEqual([]);
  });
});
