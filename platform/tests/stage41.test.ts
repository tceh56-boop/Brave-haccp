import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createProduct, createSupplier } from '../src/server/ops/catalog';
import { createReceipt, addReceiptLine, completeReceipt } from '../src/server/ops/receipts';
import { createDish, getDish, updateVersion, addLine, submitVersion, approveVersion } from '../src/server/ops/recipes';
import { createProduction, startProduction, completeProduction } from '../src/server/ops/production';
import { writeOff, startCount, getCount, setCountLine, closeCount } from '../src/server/ops/stock';
import { openLot } from '../src/server/ops/labels';
import { lotBalance } from '../src/server/ops/lotEconomics';
import { makeUser, lastLinkToken } from './helpers';

/** ТЗ 3.0 §9.3, §10.3, §13.4: баланс партии, классы потерь, экономика партии до исходных партий и цен. */

afterAll(() => closePool());
type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, chef: U, cook: U, orgId: string, siteId: string, beef: string, lot: string, semi: string;
const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Цех баланса' });
  orgId = r.organization.id; siteId = r.site.id;
  chef = await invite('chef'); cook = await invite('line_staff');
  beef = (await createProduct(chef.id, orgId, { name: 'Говядина', unit: 'кг' })).id;
  await withSystem((tx) => tx.query(`update products set opened_shelf_hours = 24, opened_shelf_basis = 'маркировка изготовителя' where id = $1`, [beef]));
  const sup = (await createSupplier(chef.id, orgId, { name: 'ООО «Мясо»' })).id;
  const rc = await createReceipt(chef.id, orgId, { siteId, supplierId: sup, documentNo: 'УПД-77', documentDate: today() });
  await addReceiptLine(chef.id, orgId, rc.id, { productId: beef, quantity: 10, unitPrice: 500, lotNo: 'Г-1', manufacturedAt: inDays(-1), expiresAt: inDays(5), expiryBasis: 'маркировка',
    checks: { packaging: true, labeling: true, documents: true, quality: true }, decision: 'accepted' });
  await completeReceipt(chef.id, orgId, rc.id);
  lot = (await withSystem((tx) => tx.query(`select id from lots where product_id = $1`, [beef]))).rows[0].id;
  semi = (await createDish(chef.id, orgId, { name: 'Фарш', kind: 'semi' })).id;
  const v = (await getDish(chef.id, orgId, semi)).current!.version.id;
  await updateVersion(chef.id, orgId, v, { yieldG: 1000, technology: 'Измельчить на мясорубке.', storageConditions: '+2…+6 °C', shelfLife: 'по основанию', storageHours: 24, shelfLifeHours: 12, shelfBasis: 'СТО 001-2026' });
  await addLine(chef.id, orgId, v, { productId: beef, unit: 'кг', brutto: 1.1, netto: 1 });
  await submitVersion(chef.id, orgId, v); await approveVersion(chef.id, orgId, v);
});

describe('Баланс и экономика партии', () => {
  it('баланс сходится по формуле; потери разнесены по классам; стоимость — по цене партии', async () => {
    // 10 кг: производство 2,2 кг, вскрытие 1 кг, списания: порча 0,5, повреждение 0,3, технологические 0,2; инвентаризация −0,4
    const o = await createProduction(chef.id, orgId, { siteId, dishId: semi, plannedKg: 2, plannedFor: today() });
    await startProduction(cook.id, orgId, o.id);
    const out = await completeProduction(cook.id, orgId, o.id, { actualKg: 1.9, consumed: [{ lotId: lot, quantity: 2.2 }], operationId: randomUUID() });
    await openLot(cook.id, orgId, lot, { quantity: 1, operationId: randomUUID() });
    for (const [reasonCode, quantity] of [['spoiled', 0.5], ['damaged', 0.3], ['production_loss', 0.2]] as const) {
      await writeOff(chef.id, orgId, { lotId: lot, quantity, reasonCode, operationId: randomUUID() });
    }
    const c = await startCount(chef.id, orgId, { siteId });
    for (const line of (await getCount(chef.id, orgId, c.id)).lines as { id: string; lot_id: string; expected: string }[]) {
      // Г-1: по учёту 5,8 — насчитали 5,4; остальные партии — как по учёту
      const q = (await withSystem((tx) => tx.query(`select quantity from lots where id = $1`, [line.lot_id]))).rows[0].quantity;
      await setCountLine(chef.id, orgId, c.id, line.id, { counted: line.lot_id === lot ? 5.4 : Number(q) });
    }
    await closeCount(chef.id, orgId, c.id);

    const b = await lotBalance(chef.id, orgId, lot);
    expect(b.totals).toEqual({ in: 10, out: 3.2, losses: 1.4, adjust: 0 });
    expect(b).toMatchObject({ opening: 0, closing: 5.4, actual: 5.4, mismatch: null });
    expect(Object.fromEntries(b.losses.map((x) => [x.class, x.quantity]))).toEqual({ technological: 0.2, sanitary: 0.5, emergency: 0.3, unexplained: 0.4 });
    expect(b.losses.find((x) => x.class === 'unexplained')).toMatchObject({ value: 200 });
    expect(b.rows.find((r) => r.label === 'Расход в производство')).toMatchObject({ quantity: -2.2, value: -1100 });
    expect(b.value).toEqual({ remaining: 2700, losses: 700 });
    expect(b.cost_basis).toMatchObject({ source: 'receipt', document_no: 'УПД-77', unit_price: 500 });

    // партия выпуска: себестоимость раскрывается до исходной партии, количества и цены
    const pb = await lotBalance(chef.id, orgId, out.lot_id);
    expect(pb.cost_basis).toMatchObject({ source: 'production', method: 'fact-v1', total: 1100, output: 1.9, unit_price: 578.95,
      inputs: [{ lot_id: lot, lot_no: 'Г-1', product: 'Говядина', quantity: 2.2, unit_price: 500, amount: 1100 }], missing_prices: [] });
    expect(pb.totals.in).toBe(1.9);
  });

  it('без права «себестоимость» стоимости не видно; история цены партии не меняется при новой закупочной цене', async () => {
    const b = await lotBalance(cook.id, orgId, lot);
    expect(b).toMatchObject({ cost_visible: false, value: null, cost_basis: null, lot: { unit_price: null } });
    expect(b.rows.every((r) => r.value === null)).toBe(true);
    const before = (await lotBalance(chef.id, orgId, lot)).lot.unit_price;
    await withSystem((tx) => tx.query(`update products set name = name where id = $1`, [beef]));   // смена справочника не трогает партию
    expect((await lotBalance(chef.id, orgId, lot)).lot.unit_price).toBe(before);
  });
});
