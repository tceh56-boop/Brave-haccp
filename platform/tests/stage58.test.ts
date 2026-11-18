import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createProduct, createSupplier } from '../src/server/ops/catalog';
import { createReceipt, addReceiptLine, completeReceipt } from '../src/server/ops/receipts';
import { createDish, getDish, updateVersion, addLine, submitVersion, approveVersion } from '../src/server/ops/recipes';
import { createEvent, setItem, confirmEvent, completeEvent } from '../src/server/ops/planmenu';
import { takeSample, setSampleSettings } from '../src/server/ops/lab';
import { consume, writeOff, startCount, getCount, setCountLine, closeCount } from '../src/server/ops/stock';
import { importSales } from '../src/server/ops/pos';
import { pnl } from '../src/server/ops/finance';
import { econReport } from '../src/server/ops/econReports';
import { updateOrganization } from '../src/server/org/organizations';
import { makeUser, lastLinkToken } from './helpers';

/**
 * Финансовый контур, этап Ф-1: всё, что ушло со склада, попадает ровно в одну строку P&L.
 * Картофель 10 кг × 30 ₽ = 300 ₽. Блюдо — 0,1 кг на порцию (3 ₽), цена 200 ₽.
 */

afterAll(() => closePool());
type U = Awaited<ReturnType<typeof makeUser>>;
const OK = { packaging: true, labeling: true, documents: true, quality: true };
const day = (n: number) => new Date(Date.now() + n * 86400e3).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
const period = { from: day(-1), to: day(0) };

for (const mode of ['estimate', 'ttk_writeoff'] as const) describe(`Ф-1: честный P&L — режим «${mode === 'estimate' ? 'расчётное потребление' : 'списание по ТТК'}»`, () => {
let owner: U, chef: U, cook: U, orgId: string, siteId: string, potato: string, soup: string, lotId: string;
const wo = mode === 'ttk_writeoff';
async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кафе «Сверка»' });
  orgId = r.organization.id; siteId = r.site.id;
  if (wo) await updateOrganization(owner.id, orgId, { salesConsumption: 'ttk_writeoff' });
  chef = await invite('chef'); cook = await invite('line_staff');
  potato = (await createProduct(chef.id, orgId, { name: 'Картофель', unit: 'кг' })).id;
  const sup = (await createSupplier(chef.id, orgId, { name: 'ООО «Овощи»' })).id;
  const rc = await createReceipt(cook.id, orgId, { siteId, supplierId: sup, documentNo: 'Н-1' });
  await addReceiptLine(cook.id, orgId, rc.id, { productId: potato, quantity: 10, unitPrice: 30, lotNo: 'К-1', expiresAt: day(10), expiryBasis: 'маркировка изготовителя', checks: OK, decision: 'accepted' });
  await completeReceipt(cook.id, orgId, rc.id);
  lotId = (await withSystem((tx) => tx.query(`select id from lots where product_id = $1`, [potato]))).rows[0].id;
  const d = await createDish(chef.id, orgId, { name: 'Пюре', salePrice: 200 });
  const v = (await getDish(chef.id, orgId, d.id)).current!.version.id;
  await updateVersion(chef.id, orgId, v, { yieldG: 250, portionG: 250, technology: 'Приготовить по технологии предприятия.', storageConditions: '+2…+6 °C', shelfLife: '2 часа' });
  await addLine(chef.id, orgId, v, { productId: potato, unit: 'кг', brutto: 0.1, netto: 0.1 });
  await submitVersion(chef.id, orgId, v); await approveVersion(chef.id, orgId, v);
  soup = d.id;
});

{
  it('ручной расход — только прочий, питание персонала, проработка; продажу и мероприятие вручную не провести', async () => {
    await expect(consume(cook.id, orgId, { siteId, productId: potato, quantity: 1, purpose: 'на банкет', refType: 'banquet', operationId: randomUUID() })).rejects.toThrow(/Назначение/);
    await consume(cook.id, orgId, { siteId, productId: potato, quantity: 1, purpose: 'обед смены', refType: 'staff_meal', operationId: randomUUID() });      // 30 ₽
    await consume(cook.id, orgId, { siteId, productId: potato, quantity: 0.5, purpose: 'проработка нового пюре', refType: 'tasting', operationId: randomUUID() });   // 15 ₽
    await consume(cook.id, orgId, { siteId, productId: potato, quantity: 0.2, purpose: 'на кухню', operationId: randomUUID() });   // прочий, 6 ₽
  });

  it('продажа (импорт кассы) и мероприятие: выручка и себестоимость по каналам; банкет — продажа с источником «мероприятие»', async () => {
    await importSales(owner.id, orgId, { siteId, source: 'other', rows: [{ externalId: 'ч-1', soldAt: new Date().toISOString(), name: 'Пюре', qty: 10, price: 200 }] });   // 2000 ₽, себестоимость 30 ₽
    await setSampleSettings(owner.id, orgId, { minWeightG: 100, retentionHours: 48, tMin: 2, tMax: 6, basis: 'программа производственного контроля, п. 5' });
    const e = await createEvent(chef.id, orgId, { siteId, title: 'Банкет', eventDate: day(0), guests: 5 });
    await setItem(chef.id, orgId, e.id, { dishId: soup, perGuest: 1, price: 300 });
    await confirmEvent(chef.id, orgId, e.id);
    await takeSample(cook.id, orgId, { siteId, source: 'event', eventId: e.id, dishId: soup, weightG: 150, container: 'стерильная банка с крышкой, маркировка', storagePlace: 'Холодильник для проб', temperature: 4 });
    const op = randomUUID();
    expect(await completeEvent(chef.id, orgId, e.id, { operationId: op })).toMatchObject({ revenue: 1500, cost: 15 });
    await completeEvent(chef.id, orgId, e.id, { operationId: op });   // повтор — без второй продажи
    const ev = (await withSystem((tx) => tx.query(`select qty::float, amount::float, cost::float, fulfil_status from sales where organization_id = $1 and source = 'event'`, [orgId]))).rows;
    expect(ev).toEqual([{ qty: 5, amount: 1500, cost: 15, fulfil_status: 'done' }]);
    const ch = await econReport(owner.id, orgId, { kind: 'channels', ...period });
    expect(ch.table.rows.map((x) => [x.name, x.net, x.cogs])).toEqual(expect.arrayContaining([['Другая касса (импорт)', 2000, 30], ['Мероприятия (банкеты)', 1500, 15]]));
  });

  it('списание и инвентаризация (недостача) — свои строки; прибыль учитывает всё, что ушло со склада', async () => {
    await writeOff(chef.id, orgId, { lotId, quantity: 0.3, reasonCode: 'spoiled', operationId: randomUUID() });   // 9 ₽ потерь
    // по книге: 10 − 1 − 0,5 − 0,2 − 0,5 (банкет) − 0,3 = 7,5 кг; при списании по ТТК ещё − 1 кг продаж = 6,5. Насчитали 6,0.
    const c = await startCount(chef.id, orgId, { siteId });
    const cnt = await getCount(chef.id, orgId, c.id);
    expect(Number(cnt.lines[0].expected)).toBe(wo ? 6.5 : 7.5);
    await setCountLine(chef.id, orgId, c.id, cnt.lines[0].id, { counted: 6 });
    await closeCount(chef.id, orgId, c.id);

    const f = await pnl(owner.id, orgId, period);
    expect(f).toMatchObject({ revenue: 3500, cogs: 45, losses: 9, inventory_surplus: 0, staff_meals: 45, other_consumption: 6 });
    if (wo) {
      // недостача — только реальная: 0,5 кг
      expect(f).toMatchObject({ inventory_shortage: 15, inventory_diff: 15 });
      expect(f.profit).toBe(3500 - 45 - 9 - 15 - 45 - 6);
    } else {
      // недостача 1,5 кг включает 1 кг проданного (уже в себестоимости) — в прибыль не вычитается, причина названа
      expect(f).toMatchObject({ inventory_shortage: 45, inventory_diff: null });
      expect(f.profit).toBe(3500 - 45 - 9 - 45 - 6);
      expect(f.reasons.find((r) => r.code === 'inventory_in_reconciliation')!.text).toMatch(/Сверка склада/);
    }
  });

  it('сверка склада: начало + движения = конец; фудкост по ТТК и фактический', async () => {
    const r = await econReport(owner.id, orgId, { kind: 'stock_flow', ...period });
    const row = (s: string) => r.table.rows.find((x) => String(x.item).startsWith(s))!;
    expect(row('Запас на начало').amount).toBe(0);
    expect(row('Закупки').amount).toBe(300);
    if (wo) expect(row('Расход по продажам').amount).toBe(-30);
    else expect(row('Справочно: расход по продажам').amount).toBe(-30);
    expect(row('Расход на мероприятия').amount).toBe(-15);
    expect(row('Питание персонала').amount).toBe(-45);
    expect(row('Прочий расход').amount).toBe(-6);
    expect(row('Списания').amount).toBe(-9);
    expect(row('Недостачи').amount).toBe(wo ? -15 : -45);
    expect(row('Запас на конец').amount).toBe(180);   // 6 кг × 30 ₽
    expect(row('Проверка').amount).toBe(0);
    expect(row('Расход сырья по ТТК')).toMatchObject({ amount: 45, pct: 1.3 });          // 45 / 3500
    expect(row('Фактический расход')).toMatchObject({ amount: 75, pct: 2.1 });            // + потери 9, прочий 6, недостача 15
    expect(row('Разница факт')).toMatchObject({ amount: 30 });
    expect((r.table.notes || []).join(' ')).toMatch(/Последняя инвентаризация: .+ — \d{2}\.\d{2}\.\d{4}/);
  });

  it('запас на прошлую дату восстанавливается по журналу: до приёмки — 0, оборачиваемость — по среднему запасу', async () => {
    const before = await econReport(owner.id, orgId, { kind: 'stock_flow', from: day(-10), to: day(-5) });
    expect(before.table.rows.find((x) => String(x.item).startsWith('Запас на конец'))!.amount).toBe(0);
    const t = await econReport(owner.id, orgId, { kind: 'turnover', ...period });
    expect(t.table.rows.find((x) => x.item === 'Средний запас, ₽')!.value).toBe(90);   // (0 + 180) / 2
  });

  it('повар отчётов не видит', async () => {
    await expect(econReport(cook.id, orgId, { kind: 'stock_flow', ...period })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
}
});
