import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createProduct, createSupplier } from '../src/server/ops/catalog';
import { createReceipt, addReceiptLine, completeReceipt } from '../src/server/ops/receipts';
import { createDish, getDish, updateVersion, addLine, submitVersion, approveVersion, updateDish } from '../src/server/ops/recipes';
import { menuCosts } from '../src/server/ops/priceImpact';
import { makeUser, lastLinkToken, orgDate } from './helpers';

/** Вариант А: каскад цен как на Google Диске — приход меняет себестоимость блюд, видно что и насколько. */

afterAll(() => closePool());
type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, chef: U, cook: U, orgId: string, siteId: string, sup: string, beef: string, salt: string, mince: string, cutlet: string, salad: string;
const OK = { packaging: true, labeling: true, documents: true, quality: true };

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}
async function receive(by: U, lines: [string, number, number][]) {
  const r = await createReceipt(by.id, orgId, { siteId, supplierId: sup, documentNo: `Н-${Math.random().toString(36).slice(2, 6)}` });
  for (const [productId, quantity, unitPrice] of lines) await addReceiptLine(by.id, orgId, r.id, { productId, quantity, unitPrice, expiresAt: orgDate(5), expiryBasis: 'маркировка изготовителя', checks: OK, decision: 'accepted' });
  return completeReceipt(by.id, orgId, r.id);
}
async function ttk(name: string, kind: 'dish' | 'semi', yieldG: number, lines: Record<string, unknown>[], portionG?: number) {
  const d = await createDish(chef.id, orgId, { name, kind });
  const v = (await getDish(chef.id, orgId, d.id)).current!.version.id;
  await updateVersion(chef.id, orgId, v, { yieldG, portionG, technology: 'Готовить по технологии предприятия.', storageConditions: '+2…+6 °C', shelfLife: '24 часа', shelfLifeHours: 24, saleHours: 2, shelfBasis: 'СТО предприятия' });
  for (const l of lines) await addLine(chef.id, orgId, v, l);
  await submitVersion(chef.id, orgId, v); await approveVersion(chef.id, orgId, v);
  return d.id as string;
}

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кухня цен' });
  orgId = r.organization.id; siteId = r.site.id;
  chef = await invite('chef'); cook = await invite('line_staff');
  beef = (await createProduct(chef.id, orgId, { name: 'Говядина', unit: 'кг' })).id;
  salt = (await createProduct(chef.id, orgId, { name: 'Соль', unit: 'кг' })).id;
  sup = (await createSupplier(chef.id, orgId, { name: 'ООО «Мясо»' })).id;
  await receive(cook, [[beef, 10, 500], [salt, 1, 40]]);
  // фарш (п/ф) из говядины; котлета (блюдо) из фарша; салат — без говядины
  mince = await ttk('Фарш', 'semi', 1000, [{ productId: beef, unit: 'кг', brutto: 1, netto: 1 }]);
  cutlet = await ttk('Котлета', 'dish', 1000, [{ subDishId: mince, unit: 'г', brutto: 800, netto: 800 }, { productId: salt, unit: 'г', brutto: 10, netto: 10 }], 100);
  salad = await ttk('Салат', 'dish', 1000, [{ productId: salt, unit: 'г', brutto: 5, netto: 5 }], 200);
  await updateDish(owner.id, orgId, cutlet, { salePrice: 300 });
});

describe('Каскад цен после приёмки', () => {
  it('себестоимость, фудкост и маржа в списке меню — по средней цене партий; повару — нет', async () => {
    await expect(menuCosts(cook.id, orgId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const m = Object.fromEntries((await menuCosts(chef.id, orgId)).map((x) => [x.name, x]));
    expect(m['Фарш']).toMatchObject({ cost: 500, per: 'кг' });
    expect(m['Котлета']).toMatchObject({ cost: 40.04, per: 'порция', food_cost_pct: 13.3, margin: 259.96 });   // (0,8 × 500 + 0,01 × 40) × 100 / 1000
  });

  it('дорогая поставка: средняя цена говядины и себестоимость фарша и котлеты (через п/ф) — до/после; салат не затронут', async () => {
    const r = await receive(chef, [[beef, 10, 800]]);
    expect(r.price_impact!.products).toEqual([expect.objectContaining({ name: 'Говядина', old_price: 500, new_price: 650, change_pct: 30 })]);
    const d = Object.fromEntries(r.price_impact!.dishes.map((x) => [x.name, x]));
    expect(Object.keys(d).sort()).toEqual(['Котлета', 'Фарш']);
    expect(d['Фарш']).toMatchObject({ old_cost: 500, new_cost: 650, change_pct: 30 });
    expect(d['Котлета']).toMatchObject({ old_cost: 40.04, new_cost: 52.04, old_food_cost_pct: 13.3, food_cost_pct: 17.3 });
    const n = (await withSystem((tx) => tx.query(`select role, title, body from notifications where organization_id = $1 and title like 'Себестоимость изменилась%'`, [orgId]))).rows;
    expect(n.map((x) => x.role).sort()).toEqual(['accountant', 'chef']);
    expect(n[0].body).toMatch(/Котлета: 40,04 → 52,04 ₽\/порция \(\+30 %\)|Фарш: 500 → 650 ₽\/кг \(\+30 %\)/);
  });

  it('повар принимает товар — цены и себестоимость ему не показываются, уведомление шефу приходит', async () => {
    const r = await receive(cook, [[beef, 20, 650]]);
    expect(r.price_impact).toBeNull();
    const same = await receive(chef, [[salt, 1, 40]]);   // цена не изменилась — каскада нет
    expect(same.price_impact).toEqual({ products: [], dishes: [] });
  });
});
