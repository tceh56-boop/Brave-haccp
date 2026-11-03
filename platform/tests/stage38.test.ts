import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createProduct, createSupplier } from '../src/server/ops/catalog';
import { createReceipt, addReceiptLine, completeReceipt } from '../src/server/ops/receipts';
import { createDish, getDish, updateVersion, addLine, submitVersion, approveVersion } from '../src/server/ops/recipes';
import { createProduction, startProduction, completeProduction } from '../src/server/ops/production';
import { importSales } from '../src/server/ops/pos';
import { openLot } from '../src/server/ops/labels';
import { consume } from '../src/server/ops/stock';
import { listTasks } from '../src/server/ops/tasks';
import { blockLot, getRecall, decideRecall, listRecalls } from '../src/server/ops/recalls';
import { makeUser, lastLinkToken, fact } from './helpers';

/** ТЗ 3.0 §10.5, сценарий 4 §29.2: блокировка партии, вся цепочка дочерних партий, продажи, решение ответственного. */

afterAll(() => closePool());
type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, chef: U, cook: U, keeper: U, haccp: U, orgId: string, siteId: string, beef: string, sup: string;
const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);
const lotOf = async (q: string, p: unknown[]) => (await withSystem((tx) => tx.query(q, p))).rows[0];
const status = async (id: string) => lotOf(`select status, quantity::float8 as quantity from lots where id = $1`, [id]);

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}
async function receive(lotNo: string, qty: number) {
  const rc = await createReceipt(keeper.id, orgId, { siteId, supplierId: sup, documentNo: `УПД-${lotNo}`, documentDate: today() });
  await addReceiptLine(keeper.id, orgId, rc.id, { productId: beef, quantity: qty, unitPrice: 500, lotNo, manufacturedAt: inDays(-1), expiresAt: inDays(lotNo === 'Г-1' ? 4 : 6), expiryBasis: 'маркировка изготовителя',
    checks: { packaging: true, labeling: true, documents: true, quality: true }, decision: 'accepted' });
  await completeReceipt(keeper.id, orgId, rc.id);
  return (await lotOf(`select id from lots where product_id = $1 and lot_no = $2`, [beef, lotNo])).id as string;
}
async function approved(name: string, kind: 'dish' | 'semi', line: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const d = (await createDish(chef.id, orgId, { name, kind, salePrice: kind === 'dish' ? 300 : undefined })).id as string;
  const v = (await getDish(chef.id, orgId, d)).current!.version.id as string;
  await updateVersion(chef.id, orgId, v, { technology: 'Приготовить по технологии предприятия.', storageConditions: '+2…+6 °C', shelfLife: 'по основанию сроков', ...extra });
  await addLine(chef.id, orgId, v, line);
  await submitVersion(chef.id, orgId, v); await approveVersion(chef.id, orgId, v);
  return d;
}

let lotA: string, lotB: string, semiLot: string, opened: string;

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кафе «Отзыв»' });
  orgId = r.organization.id; siteId = r.site.id;
  chef = await invite('chef'); cook = await invite('line_staff'); keeper = await invite('storekeeper'); haccp = await invite('haccp_lead');
  beef = (await createProduct(chef.id, orgId, { name: 'Говядина', unit: 'кг' })).id;
  sup = (await createSupplier(chef.id, orgId, { name: 'ООО «Мясо»', inn: '7700000000' })).id;
  lotA = await receive('Г-1', 5);
  lotB = await receive('Г-2', 5);
  // п/ф из партии Г-1 (FEFO: у неё срок раньше), блюдо из п/ф, продажа блюда, вскрытие остатка Г-1
  const semi = await approved('Фарш', 'semi', { productId: beef, unit: 'кг', brutto: 1.1, netto: 1 }, { yieldG: 1000, storageHours: 48, shelfLifeHours: 24, shelfBasis: 'СТО 001-2026' });
  const o = await createProduction(chef.id, orgId, { siteId, dishId: semi, plannedKg: 1, plannedFor: today() });
  await startProduction(cook.id, orgId, o.id);
  semiLot = (await completeProduction(cook.id, orgId, o.id, { consumed: await fact(cook.id, orgId, o.id), actualKg: 1, operationId: randomUUID() })).lot_id;
  await approved('Котлеты', 'dish', { subDishId: semi, unit: 'г', brutto: 200, netto: 200 }, { yieldG: 200, portionG: 200 });
  const s = await importSales(chef.id, orgId, { siteId, source: 'other', rows: [{ externalId: 'чек-1', soldAt: new Date().toISOString(), name: 'Котлеты', qty: 2, price: 300 }] });
  expect(s).toMatchObject({ inserted: 1, done: 1 });
  opened = (await openLot(cook.id, orgId, lotA, { quantity: 1, hours: 24, basis: 'маркировка: после вскрытия 24 ч', operationId: randomUUID() })).lot_id;
});

describe('Блокировка и отзыв партии', () => {
  it('блокировка: вся цепочка дочерних партий с остатком, продажи, блюда, поставщик, перечень действий, задача ответственному', async () => {
    await expect(blockLot(cook.id, orgId, lotA, { hazard: 'Сальмонелла в протоколе', source: 'laboratory' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(blockLot(keeper.id, orgId, lotA, { hazard: 'x', source: 'laboratory' })).rejects.toThrow(/Опишите опасность/);
    const r = await blockLot(keeper.id, orgId, lotA, { hazard: 'Поставщик сообщил об отзыве партии Г-1: листерии', source: 'supplier' });
    expect(r).toMatchObject({ blocked: 3, lots: 3, sales: 1 });                       // Г-1, п/ф, вскрытая тара
    for (const id of [lotA, semiLot, opened]) expect((await status(id)).status).toBe('blocked');
    expect((await status(lotB)).status).toBe('available');                               // чужая партия не затронута

    const rc = await getRecall(chef.id, orgId, r.id);
    expect(rc).toMatchObject({ status: 'open', source_label: 'Сообщение поставщика или изготовителя', held: expect.arrayContaining([expect.objectContaining({ lot_id: semiLot, prev_status: 'available' })]) });
    const a = rc.affected;
    expect(a.origin).toMatchObject({ supplier: 'ООО «Мясо»', supplier_inn: '7700000000', document_no: 'УПД-Г-1' });
    expect(a.dishes.map((d: { name: string }) => d.name)).toEqual(['Фарш']);
    expect(a.sold_dishes).toEqual([expect.objectContaining({ name: 'Котлеты', qty: 2 })]);
    expect(a.actions.join('\n')).toMatch(/Изолировать.*Говядина, партия Г-1[\s\S]*Фарш[\s\S]*Оценить риск.*Котлеты × 2[\s\S]*Сообщить поставщику ООО «Мясо» \(ИНН 7700000000\)[\s\S]*Принять решение/);
    const t = (await listTasks(haccp.id, orgId, { all: true })).find((x: { kind: string }) => x.kind === 'recall_decision');
    expect(t).toMatchObject({ href: `/app/${orgId}/recalls/${r.id}`, action: 'Решить по отзыву' });
    expect(await listRecalls(chef.id, orgId)).toEqual([expect.objectContaining({ id: r.id, status: 'open', product: 'Говядина', lot_no: 'Г-1' })]);

    // заблокированное не расходуется и не вскрывается; повторной блокировки нет
    const c = await consume(cook.id, orgId, { siteId, productId: beef, quantity: 1, purpose: 'заготовка', operationId: randomUUID() });
    expect(JSON.stringify(c)).toContain(lotB);
    expect(JSON.stringify(c)).not.toContain(lotA);
    await expect(openLot(cook.id, orgId, lotA, { quantity: 0.5, hours: 24, basis: 'маркировка', operationId: randomUUID() })).rejects.toThrow();
    await expect(blockLot(haccp.id, orgId, lotA, { hazard: 'повторно то же самое', source: 'internal' })).rejects.toThrow(/уже заблокирована по открытому отзыву/);
  });

  it('решение — только ответственный, с обоснованием; «списать» обнуляет остатки всей цепочки, «вернуть» восстанавливает прежний статус', async () => {
    const [r] = await listRecalls(chef.id, orgId);
    await expect(decideRecall(chef.id, orgId, r.id, { decision: 'write_off', note: 'списать всё по письму поставщика' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(decideRecall(haccp.id, orgId, r.id, { decision: 'write_off', note: 'кратко' })).rejects.toThrow(/Обоснуйте решение/);
    expect(await decideRecall(haccp.id, orgId, r.id, { decision: 'write_off', note: 'Письмо поставщика № 15 от 03.11.2026: партия отозвана изготовителем' })).toMatchObject({ lots: 3 });
    for (const id of [lotA, semiLot, opened]) expect(await status(id)).toEqual({ status: 'written_off', quantity: 0 });
    const mv = (await withSystem((tx) => tx.query(`select count(*)::int as n from stock_movements where ref_type = 'recall' and ref_id = $1 and kind = 'write_off' and reason_code = 'recall'`, [r.id]))).rows[0].n;
    expect(mv).toBe(3);
    await expect(decideRecall(haccp.id, orgId, r.id, { decision: 'release', note: 'передумали, вернуть в оборот' })).rejects.toThrow(/уже принято/);
    expect((await listTasks(haccp.id, orgId, { all: true })).filter((x: { kind: string }) => x.kind === 'recall_decision')).toEqual([]);

    const r2 = await blockLot(haccp.id, orgId, lotB, { hazard: 'Подозрение на нарушение температуры при доставке', source: 'internal' });
    expect((await status(lotB)).status).toBe('blocked');
    await decideRecall(haccp.id, orgId, r2.id, { decision: 'release', note: 'Логгер температуры поставщика: 0…+3 °C всю доставку, протокол приложен' });
    expect((await status(lotB)).status).toBe('available');
    const log = (await withSystem((tx) => tx.query(`select action from audit_events where organization_id = $1 and action like 'recall.%' and result <> 'denied' order by created_at`, [orgId]))).rows.map((x) => x.action);
    expect(log).toEqual(['recall.block', 'recall.write_off', 'recall.block', 'recall.release']);
  });
});
