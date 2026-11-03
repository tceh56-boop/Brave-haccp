import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation, createSite } from '../src/server/org/organizations';
import { createProduct, createSupplier } from '../src/server/ops/catalog';
import { createReceipt, addReceiptLine, completeReceipt } from '../src/server/ops/receipts';
import { createDish, getDish, updateVersion, addLine, submitVersion, approveVersion } from '../src/server/ops/recipes';
import { createProduction, startProduction, completeProduction, getProduction } from '../src/server/ops/production';
import { blockLot } from '../src/server/ops/recalls';
import { makeUser, lastLinkToken } from './helpers';

/** Мастер-промт, раздел 2; дефект Д-1 аудита: выпуск списывает только факт, норма ТТК — отдельно, отклонение видно. */

afterAll(() => closePool());
type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, chef: U, cook: U, haccp: U, orgId: string, siteId: string, site2: string, beef: string, salt: string, foreign: string, sup: string;
const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);
const lotQ = async (id: string) => Number((await withSystem((tx) => tx.query(`select quantity from lots where id = $1`, [id]))).rows[0].quantity);

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}
async function receive(site: string, productId: string, lotNo: string, qty: number, price: number) {
  const rc = await createReceipt(chef.id, orgId, { siteId: site, supplierId: sup, documentNo: `УПД-${lotNo}`, documentDate: today() });
  await addReceiptLine(chef.id, orgId, rc.id, { productId, quantity: qty, unitPrice: price, lotNo, manufacturedAt: inDays(-1), expiresAt: inDays(5), expiryBasis: 'маркировка изготовителя',
    checks: { packaging: true, labeling: true, documents: true, quality: true }, decision: 'accepted' });
  await completeReceipt(chef.id, orgId, rc.id);
  return (await withSystem((tx) => tx.query(`select id from lots where product_id = $1 and lot_no = $2`, [productId, lotNo]))).rows[0].id as string;
}

let semi: string, b1: string, b2: string, s1: string, other: string, alien: string;

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Цех факта' });
  orgId = r.organization.id; siteId = r.site.id;
  site2 = (await createSite(owner.id, orgId, { name: 'Вторая кухня' })).id;
  chef = await invite('chef'); cook = await invite('line_staff'); haccp = await invite('haccp_lead');
  beef = (await createProduct(chef.id, orgId, { name: 'Говядина', unit: 'кг' })).id;
  salt = (await createProduct(chef.id, orgId, { name: 'Соль', unit: 'кг' })).id;
  foreign = (await createProduct(chef.id, orgId, { name: 'Свинина', unit: 'кг' })).id;
  sup = (await createSupplier(chef.id, orgId, { name: 'ООО «Мясо»' })).id;
  b1 = await receive(siteId, beef, 'Г-1', 3, 500); b2 = await receive(siteId, beef, 'Г-2', 3, 600);
  s1 = await receive(siteId, salt, 'С-1', 1, 40);
  other = await receive(siteId, foreign, 'С-9', 2, 400);
  alien = await receive(site2, beef, 'Г-9', 2, 500);
  semi = (await createDish(chef.id, orgId, { name: 'Фарш', kind: 'semi' })).id;
  const v = (await getDish(chef.id, orgId, semi)).current!.version.id;
  await updateVersion(chef.id, orgId, v, { yieldG: 1000, technology: 'Измельчить, посолить.', storageConditions: '+2…+6 °C', shelfLife: 'по основанию', storageHours: 24, shelfLifeHours: 12, shelfBasis: 'СТО 001-2026' });
  await addLine(chef.id, orgId, v, { productId: beef, unit: 'кг', brutto: 1.1, netto: 1 });
  await addLine(chef.id, orgId, v, { productId: salt, unit: 'кг', brutto: 0.01, netto: 0.01 });
  await submitVersion(chef.id, orgId, v); await approveVersion(chef.id, orgId, v);
});

async function order(kg: number) {
  const o = await createProduction(chef.id, orgId, { siteId, dishId: semi, plannedKg: kg, plannedFor: today() });
  await startProduction(cook.id, orgId, o.id);
  return o.id as string;
}

describe('Фактический расход при выпуске (Д-1)', () => {
  it('без партий, чужая позиция, другая площадка, заблокированная партия — отказ, ничего не списано', async () => {
    const id = await order(1);
    await expect(completeProduction(cook.id, orgId, id, { actualKg: 1, operationId: randomUUID() })).rejects.toThrow(/фактически использованные партии/);
    await expect(completeProduction(cook.id, orgId, id, { actualKg: 1, consumed: [], operationId: randomUUID() })).rejects.toThrow(/расход по норме ТТК фактом не записывается/);
    await expect(completeProduction(cook.id, orgId, id, { actualKg: 1, consumed: [{ lotId: other, quantity: 1 }], operationId: randomUUID() })).rejects.toThrow(/Свинина.*позиции нет в утверждённой ТТК/);
    await expect(completeProduction(cook.id, orgId, id, { actualKg: 1, consumed: [{ lotId: alien, quantity: 1 }], operationId: randomUUID() })).rejects.toThrow(/другой площадки/);
    await expect(completeProduction(cook.id, orgId, id, { actualKg: 1, consumed: [{ lotId: b1, quantity: 1 }, { lotId: b1, quantity: 0.1 }], operationId: randomUUID() })).rejects.toThrow(/указана дважды/);
    await expect(completeProduction(cook.id, orgId, id, { actualKg: 1, consumed: [{ lotId: b1, quantity: 1.1 }], operationId: randomUUID() })).rejects.toThrow(/Не указан фактический расход: Соль \(по ТТК 0,01 кг\).*не соответствует утверждённой карте/);
    expect(await lotQ(b1)).toBe(3);
  });

  it('подсказка формы — FEFO на план, но списывается то, что указал повар; норма на фактический выход — отдельно; отклонение и себестоимость — по факту', async () => {
    const id = await order(2);
    const p = await getProduction(cook.id, orgId, id);
    // подсказка: 2,2 кг говядины из Г-1 (ранний приход при равном сроке) и 0,02 кг соли
    expect(p.lots.filter((l) => l.suggest > 0).map((l) => [l.lot_no, l.suggest])).toEqual(expect.arrayContaining([['Г-1', 2.2], ['С-1', 0.02]]));
    // факт: повар взял 1,5 кг из Г-1 и 1,0 кг из Г-2 (перерасход), соль 0,02; выход 2 кг
    const r = await completeProduction(cook.id, orgId, id, { actualKg: 2, operationId: randomUUID(),
      consumed: [{ lotId: b1, quantity: 1.5 }, { lotId: b2, quantity: '1,0' }, { lotId: s1, quantity: 0.02 }] });
    expect(await lotQ(b1)).toBeCloseTo(1.5, 6); expect(await lotQ(b2)).toBeCloseTo(2, 6);
    expect(r.cost).toBeCloseTo(1.5 * 500 + 1 * 600 + 0.02 * 40, 2);                       // стоимость факта, а не нормы
    const beefDev = r.deviation.find((x: { name: string }) => x.name === 'Говядина');
    expect(beefDev).toMatchObject({ norm: 2.2, fact: 2.5, diff: 0.3, diff_pct: 13.6 });
    const est = (await withSystem((tx) => tx.query(`select p.name, e.quantity::float8 as q, e.basis from consumption_estimates e join products p on p.id = e.product_id
      where e.ref_type = 'production' and e.ref_id = $1 and e.kind = 'production_norm' order by p.name`, [id]))).rows;
    expect(est).toEqual([{ name: 'Говядина', q: 2.2, basis: 'ТТК «Фарш» v1 на 2 кг выхода' }, { name: 'Соль', q: 0.02, basis: 'ТТК «Фарш» v1 на 2 кг выхода' }]);
    const mv = (await withSystem((tx) => tx.query(`select count(*)::int as n, sum(-quantity)::float8 as q from stock_movements where ref_type = 'production' and ref_id = $1 and kind = 'consume'`, [id]))).rows[0];
    expect(mv).toEqual({ n: 3, q: 2.52 });
    expect((await getProduction(cook.id, orgId, id)).deviation).toEqual(r.deviation);
  });

  it('партия, заблокированная по отзыву, в выпуск не идёт', async () => {
    const id = await order(0.5);
    await blockLot(haccp.id, orgId, b2, { hazard: 'Проверка: подозрение на нарушение хранения', source: 'internal' });
    await expect(completeProduction(cook.id, orgId, id, { actualKg: 0.5, consumed: [{ lotId: b2, quantity: 0.5 }], operationId: randomUUID() })).rejects.toThrow(/использовать нельзя/);
  });
});
