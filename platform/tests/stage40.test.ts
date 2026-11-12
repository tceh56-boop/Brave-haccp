import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation, updateOrganization, getOrganization } from '../src/server/org/organizations';
import { createProduct, createSupplier } from '../src/server/ops/catalog';
import { createReceipt, addReceiptLine, completeReceipt } from '../src/server/ops/receipts';
import { createDish, getDish, updateVersion, addLine, submitVersion, approveVersion } from '../src/server/ops/recipes';
import { importSales } from '../src/server/ops/pos';
import { blockLot, getRecall } from '../src/server/ops/recalls';
import { makeUser, lastLinkToken } from './helpers';

/** Дефект Д-2 аудита; ТЗ 3.0 §12.5: по умолчанию продажа — только расчётное потребление, склад не меняется. */

afterAll(() => closePool());
type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, chef: U, haccp: U, orgId: string, siteId: string, beef: string, lot: string, dish: string;
const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);
const lotQ = async () => Number((await withSystem((tx) => tx.query(`select quantity from lots where id = $1`, [lot]))).rows[0].quantity);

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кафе «Расчёт»' });
  orgId = r.organization.id; siteId = r.site.id;
  chef = await invite('chef'); haccp = await invite('haccp_lead');
  beef = (await createProduct(chef.id, orgId, { name: 'Говядина', unit: 'кг' })).id;
  const sup = (await createSupplier(chef.id, orgId, { name: 'ООО «Мясо»' })).id;
  const rc = await createReceipt(chef.id, orgId, { siteId, supplierId: sup, documentNo: 'УПД-1', documentDate: today() });
  await addReceiptLine(chef.id, orgId, rc.id, { productId: beef, quantity: 5, unitPrice: 600, lotNo: 'Г-1', manufacturedAt: inDays(-1), expiresAt: inDays(5), expiryBasis: 'маркировка',
    checks: { packaging: true, labeling: true, documents: true, quality: true }, decision: 'accepted' });
  await completeReceipt(chef.id, orgId, rc.id);
  lot = (await withSystem((tx) => tx.query(`select id from lots where product_id = $1`, [beef]))).rows[0].id;
  dish = (await createDish(chef.id, orgId, { name: 'Бифштекс', kind: 'dish', salePrice: 500 })).id;
  const v = (await getDish(chef.id, orgId, dish)).current!.version.id;
  await updateVersion(chef.id, orgId, v, { yieldG: 150, portionG: 150, technology: 'Нарезать порционно, обжарить до готовности.', storageConditions: '+2…+6 °C', shelfLife: 'реализация сразу после приготовления' });
  await addLine(chef.id, orgId, v, { productId: beef, unit: 'кг', brutto: 0.2, netto: 0.16 });
  await submitVersion(chef.id, orgId, v); await approveVersion(chef.id, orgId, v);
});

describe('Расход по продажам: расчёт отдельно от факта', () => {
  it('по умолчанию продажа не меняет склад: расчётное потребление по ТТК и оценка себестоимости по ценам партий', async () => {
    expect((await getOrganization(owner.id, orgId)).organization.sales_consumption).toBe('estimate');
    const r = await importSales(chef.id, orgId, { siteId, source: 'other', rows: [{ externalId: 'ч-1', soldAt: new Date().toISOString(), name: 'Бифштекс', qty: 3, price: 500 }] });
    expect(r).toMatchObject({ inserted: 1, done: 1 });
    expect(await lotQ()).toBe(5);                                                              // факт не тронут
    const s = (await withSystem((tx) => tx.query(`select id, consumption_kind, cost::float8 as cost from sales where organization_id = $1`, [orgId]))).rows[0];
    expect(s).toMatchObject({ consumption_kind: 'estimate', cost: 360 });                    // 3 × 0,2 кг × 600 ₽ — оценка
    const e = (await withSystem((tx) => tx.query(`select quantity::float8 as q, basis from consumption_estimates where ref_type = 'sale' and ref_id = $1`, [s.id]))).rows;
    expect(e).toEqual([{ q: 0.6, basis: 'ТТК «Бифштекс» v1 × 3 порц.' }]);
    expect((await withSystem((tx) => tx.query(`select count(*)::int as n from stock_movements where ref_type = 'sale' and ref_id = $1`, [s.id]))).rows[0].n).toBe(0);
  });

  it('отзыв в режиме расчёта показывает возможно затронутые продажи отдельно от установленных', async () => {
    const r = await blockLot(haccp.id, orgId, lot, { hazard: 'Проверка отзыва в режиме расчёта', source: 'internal' });
    const a = (await getRecall(haccp.id, orgId, r.id)).affected;
    expect(a.sales).toEqual([]);
    expect(a.possible_sales).toEqual([expect.objectContaining({ name: 'Бифштекс', qty: 3 })]);
    expect(a.actions.join('\n')).toMatch(/Проверить продажи, где партия могла использоваться \(расчёт по ТТК.*\): 1 .*Бифштекс/);
  });

  it('методика «списание по ТТК» включается явно, аудируется; движения помечены как расчётное списание', async () => {
    await expect(updateOrganization(chef.id, orgId, { salesConsumption: 'ttk_writeoff' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await updateOrganization(owner.id, orgId, { salesConsumption: 'ttk_writeoff' });
    const log = (await withSystem((tx) => tx.query(`select before, after from audit_events where organization_id = $1 and action = 'org.sales_consumption'`, [orgId]))).rows;
    expect(log).toEqual([{ before: { sales_consumption: 'estimate' }, after: { sales_consumption: 'ttk_writeoff' } }]);
    // партия заблокирована предыдущим тестом — продажа уходит в очередь «не списано», а не списывает заблокированное
    const r = await importSales(chef.id, orgId, { siteId, source: 'other', rows: [{ externalId: 'ч-2', soldAt: new Date().toISOString(), name: 'Бифштекс', qty: 1, price: 500 }] });
    expect(r).toMatchObject({ failed: 1 });
    expect(await lotQ()).toBe(5);
  });
});
