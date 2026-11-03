import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createProduct, createSupplier } from '../src/server/ops/catalog';
import { createReceipt, addReceiptLine, completeReceipt } from '../src/server/ops/receipts';
import { createDish, getDish, updateVersion, addLine, submitVersion, approveVersion } from '../src/server/ops/recipes';
import { createProduction, startProduction, completeProduction } from '../src/server/ops/production';
import { openLot } from '../src/server/ops/labels';
import { getLot } from '../src/server/ops/lots';
import { makeUser, lastLinkToken, fact } from './helpers';

/** ТЗ доработки 5.2 (раздельные сроки ТТК) и 6.2 (карточка партии). */

afterAll(() => closePool());
type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, chef: U, cook: U, orgId: string, siteId: string, beef: string, beefLot: string;
const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);
const BASE = { technology: 'Сырьё измельчают, формуют, жарят до готовности.', storageConditions: 'при +2…+6 °C', shelfLife: 'по основанию сроков' };

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}
async function draft(name: string, kind: 'dish' | 'semi', extra: Record<string, unknown>) {
  const d = (await createDish(chef.id, orgId, { name, kind, salePrice: kind === 'dish' ? 300 : undefined })).id as string;
  const v = (await getDish(chef.id, orgId, d)).current!.version.id as string;
  await updateVersion(chef.id, orgId, v, { yieldG: 1000, portionG: kind === 'dish' ? 200 : undefined, ...BASE, ...extra });
  await addLine(chef.id, orgId, v, { productId: beef, unit: 'кг', brutto: 1.1, netto: 1 });
  return { d, v };
}
async function produce(dishId: string, extra: Record<string, unknown> = {}) {
  const o = await createProduction(chef.id, orgId, { siteId, dishId, plannedKg: 1, plannedFor: today() });
  await startProduction(cook.id, orgId, o.id);
  return completeProduction(cook.id, orgId, o.id, { consumed: await fact(cook.id, orgId, o.id), actualKg: 1, operationId: randomUUID(), ...extra });
}

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Цех сроков' });
  orgId = r.organization.id; siteId = r.site.id;
  chef = await invite('chef'); cook = await invite('line_staff');
  beef = (await createProduct(chef.id, orgId, { name: 'Говядина', unit: 'кг' })).id;
  const sup = (await createSupplier(chef.id, orgId, { name: 'ООО «Мясо»' })).id;
  const rc = await createReceipt(cook.id, orgId, { siteId, supplierId: sup, documentNo: 'УПД-501', documentDate: today() });
  await addReceiptLine(cook.id, orgId, rc.id, { productId: beef, quantity: 10, unitPrice: 500, lotNo: 'Г-9', manufacturedAt: inDays(-1), expiresAt: inDays(5), expiryBasis: 'маркировка изготовителя',
    manufacturer: 'ООО «Мясокомбинат»', vsdNo: 'ВСД-123456', storageConditions: '0…+4 °C', checks: { packaging: true, labeling: true, documents: true, quality: true }, decision: 'accepted' });
  await completeReceipt(cook.id, orgId, rc.id);
  beefLot = (await withSystem((tx) => tx.query(`select id from lots where product_id = $1`, [beef]))).rows[0].id;
});

describe('Раздельные сроки ТТК', () => {
  it('срок без основания и несогласованные сроки не утверждаются', async () => {
    const { v } = await draft('Фарш', 'semi', { storageHours: 24, shelfLifeHours: 36, openedHours: 48 });
    await expect(submitVersion(chef.id, orgId, v)).rejects.toThrow(/Укажите основание сроков \(срок хранения, срок партии п\/ф, срок после вскрытия\)/);
    await updateVersion(chef.id, orgId, v, { shelfBasis: 'СТО 001-2026, протокол № 7' });
    await expect(submitVersion(chef.id, orgId, v)).rejects.toThrow(/Срок партии п\/ф \(36 ч\) больше срока хранения \(24 ч\).*Срок после вскрытия \(48 ч\) больше срока хранения/);
    await updateVersion(chef.id, orgId, v, { storageHours: 48, shelfLifeHours: 24, openedHours: 12 });
    await submitVersion(chef.id, orgId, v);
    await approveVersion(chef.id, orgId, v);
  });

  it('готовая продукция: срок партии — срок реализации; после вскрытия — правило товара из ТТК', async () => {
    const { d, v } = await draft('Котлеты', 'dish', { storageHours: 24, saleHours: 12, openedHours: 6, shelfBasis: 'СТО 002-2026, протокол № 8' });
    await submitVersion(chef.id, orgId, v); await approveVersion(chef.id, orgId, v);
    const r = await produce(d, { organoleptic: 'соответствует ТТК', decision: 'allowed' });
    expect(r.expiry_basis).toMatch(/^ТТК «Котлеты» v1: срок реализации 12 ч, при \+2…\+6 °C \(СТО 002-2026, протокол № 8\)$/);
    const hours = (new Date(r.expires_at!).getTime() - Date.now()) / 3600e3;
    expect(hours).toBeGreaterThan(11.9); expect(hours).toBeLessThanOrEqual(12);
    const c = (await getLot(cook.id, orgId, r.lot_id)).card;
    expect(c).toMatchObject({
      origin: 'production', manufacturer: 'Цех сроков', supplier: null, received_at: null, storage_conditions: 'при +2…+6 °C',
      after_opening: { hours: 6, basis: 'ТТК «Котлеты» v1: СТО 002-2026, протокол № 8' },
      ttk: { dish_id: d, label: expect.stringMatching(/^ТТК № \d+ «Котлеты», версия 1$/) }, composition: ['Говядина'], receipt: null, vsd_no: null,
    });
    // вскрытие упаковки готовой продукции — по правилу из ТТК, без ручного срока
    const opened = await openLot(cook.id, orgId, r.lot_id, { quantity: 0.5, operationId: randomUUID() });
    expect((await getLot(cook.id, orgId, opened.lot_id)).card).toMatchObject({ ttk: { dish_id: d }, storage_conditions: 'при +2…+6 °C' });
  });
});

describe('Карточка партии (6.2)', () => {
  it('приёмка: изготовитель, поставщик, даты, УПД, ВСД, условия; вскрытая тара наследует происхождение', async () => {
    const c = (await getLot(cook.id, orgId, beefLot)).card;
    expect(c).toMatchObject({ origin: 'receipt', product: 'Говядина', lot_no: 'Г-9', manufacturer: 'ООО «Мясокомбинат»', supplier: 'ООО «Мясо»', vsd_no: 'ВСД-123456',
      storage_conditions: '0…+4 °C', expiry_basis: 'маркировка изготовителя', status: expect.any(String), ttk: null, composition: null,
      receipt: { document_no: 'УПД-501', document_date: expect.anything() } });
    expect(c.manufactured_at).toBeTruthy(); expect(c.received_at).toBeTruthy();
    const o = await openLot(cook.id, orgId, beefLot, { quantity: 1, hours: 24, basis: 'маркировка: после вскрытия 24 ч', operationId: randomUUID() });
    expect((await getLot(cook.id, orgId, o.lot_id)).card).toMatchObject({ manufacturer: 'ООО «Мясокомбинат»', vsd_no: 'ВСД-123456', storage_conditions: '0…+4 °C', opened_at: expect.anything() });
  });
});
