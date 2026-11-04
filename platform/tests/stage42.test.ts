import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { closePool } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createProduct, createSupplier } from '../src/server/ops/catalog';
import { createReceipt, addReceiptLine, completeReceipt } from '../src/server/ops/receipts';
import { createDish, getDish, updateVersion, addLine, submitVersion, approveVersion } from '../src/server/ops/recipes';
import { createProduction, startProduction, completeProduction, addReleaseCheck, approveReleaseCheck, recordCheck } from '../src/server/ops/production';
import { openLot } from '../src/server/ops/labels';
import { blockLot } from '../src/server/ops/recalls';
import { productPassport } from '../src/server/ops/passport';
import { makeUser, lastLinkToken } from './helpers';

/** Мастер-промт, раздел 2: паспорт продукта — состав, версии документов, происхождение, контроль, допуск, «нет данных». */

afterAll(() => closePool());
type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, chef: U, cook: U, haccp: U, cashier: U, orgId: string, siteId: string, beef: string, onion: string, dish: string;
const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}

let beefLot: string, onionLot: string;

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Цех паспорта' });
  orgId = r.organization.id; siteId = r.site.id;
  chef = await invite('chef'); cook = await invite('line_staff'); haccp = await invite('haccp_lead'); cashier = await invite('cashier');
  beef = (await createProduct(chef.id, orgId, { name: 'Говядина', unit: 'кг' })).id;
  onion = (await createProduct(chef.id, orgId, { name: 'Лук', unit: 'кг' })).id;
  const sup = (await createSupplier(chef.id, orgId, { name: 'ООО «Ферма»', inn: '7711111111' })).id;
  const rc = await createReceipt(chef.id, orgId, { siteId, supplierId: sup, documentNo: 'УПД-9', documentDate: today() });
  for (const [p, no, q] of [[beef, 'Г-1', 5], [onion, 'Л-1', 2]] as const) {
    await addReceiptLine(chef.id, orgId, rc.id, { productId: p, quantity: q, unitPrice: 100, lotNo: no, manufacturedAt: inDays(-1), expiresAt: inDays(5), expiryBasis: 'маркировка',
      manufacturer: 'Мясокомбинат №1', vsdNo: p === beef ? 'ВСД-777' : undefined, checks: { packaging: true, labeling: true, documents: true, quality: true }, decision: 'accepted' });
  }
  await completeReceipt(chef.id, orgId, rc.id);
  dish = (await createDish(chef.id, orgId, { name: 'Котлеты', kind: 'semi' })).id;
  const v = (await getDish(chef.id, orgId, dish)).current!.version.id;
  await updateVersion(chef.id, orgId, v, { yieldG: 1000, technology: 'Сформовать котлеты, обжарить.', storageConditions: '+2…+6 °C', shelfLife: 'по основанию', storageHours: 24, shelfLifeHours: 12, shelfBasis: 'СТО 002-2026' });
  await addLine(chef.id, orgId, v, { productId: beef, unit: 'кг', brutto: 1, netto: 0.9 });
  await addLine(chef.id, orgId, v, { productId: onion, unit: 'кг', brutto: 0.2, netto: 0.18 });
  await submitVersion(chef.id, orgId, v); await approveVersion(chef.id, orgId, v);
  const { withSystem } = await import('../src/server/db/pool');
  [beefLot, onionLot] = await Promise.all([beef, onion].map(async (p) => (await withSystem((tx) => tx.query(`select id from lots where product_id = $1`, [p]))).rows[0].id as string));
});

describe('Паспорт продукта', () => {
  it('выпущенная партия: происхождение до поставщика и ВСД, версия ТТК, замер ККТ, факт против нормы, «нет данных»', async () => {
    const ck = await addReleaseCheck(haccp.id, orgId, dish, { name: 'Температура в толще', unit: '°C', min: 75, basis: 'План ХАССП, ККТ-1' });
    await approveReleaseCheck(owner.id, orgId, ck.id);
    const o = await createProduction(chef.id, orgId, { siteId, dishId: dish, plannedKg: 1, plannedFor: today() });
    await startProduction(cook.id, orgId, o.id);
    await recordCheck(cook.id, orgId, o.id, { checkId: ck.id, value: 80 });
    const out = await completeProduction(cook.id, orgId, o.id, { actualKg: 1, consumed: [{ lotId: beefLot, quantity: 1 }, { lotId: onionLot, quantity: 0.25 }], operationId: randomUUID() });
    const opened = await openLot(cook.id, orgId, out.lot_id, { quantity: 0.4, hours: 6, basis: 'СТО 002-2026: после вскрытия 6 ч', operationId: randomUUID() });

    await expect(productPassport(cashier.id, orgId, opened.lot_id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(productPassport(cook.id, orgId, opened.lot_id)).rejects.toMatchObject({ code: 'FORBIDDEN' });   // нет права «прослеживаемость»
    const p = await productPassport(chef.id, orgId, opened.lot_id);                 // паспорт вскрытой тары ведёт к выпуску и сырью
    expect(p.admission).toEqual({ allowed: true, reasons: [] });
    expect(p.production).toMatchObject({ dish: 'Котлеты', planned_kg: 1, actual_kg: 1, equipment: null,
      checks: [expect.objectContaining({ name: 'Температура в толще', value: 80, ok: true })] });
    expect(p.production!.deviation).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Лук', norm: 0.2, fact: 0.25 })]));
    expect(p.documents).toMatchObject({ ttk: { version: 1 }, tu: null, ti: null });
    const raw = p.origins.filter((x) => x.receipt_id).map((x) => [x.product, x.supplier, x.supplier_inn, x.document_no, x.vsd_no, x.manufacturer]);
    expect(raw).toEqual(expect.arrayContaining([['Говядина', 'ООО «Ферма»', '7711111111', 'УПД-9', 'ВСД-777', 'Мясокомбинат №1'], ['Лук', 'ООО «Ферма»', '7711111111', 'УПД-9', null, 'Мясокомбинат №1']]));
    expect(p.origins.map((x) => x.link)).toEqual(expect.arrayContaining([null, 'opened', 'production']));
    expect(p.missing).toEqual(expect.arrayContaining([expect.stringMatching(/ТУ на продукт не утверждены/), expect.stringMatching(/оборудование и участок операции не регистрируются/)]));
    expect(p.card.composition).toEqual(['Говядина', 'Лук']);
  });

  it('допуск — только из фактов: отзыв сырья делает продукт недопущенным с причиной', async () => {
    await blockLot(haccp.id, orgId, beefLot, { hazard: 'Проверка паспорта: письмо поставщика', source: 'supplier' });
    const { withSystem } = await import('../src/server/db/pool');
    const out = (await withSystem((tx) => tx.query(`select output_lot_id from production_orders where organization_id = $1`, [orgId]))).rows[0].output_lot_id;
    const p = await productPassport(chef.id, orgId, out);
    expect(p.admission.allowed).toBe(false);
    expect(p.admission.reasons.join('; ')).toMatch(/заблокирована — отзыв: Проверка паспорта.*партия цепочки в открытом отзыве/);
    expect(p.recalls).toEqual([expect.objectContaining({ status: 'open' })]);
  });
});
