import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, createSite, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createProduct, createSupplier } from '../src/server/ops/catalog';
import { createReceipt, addReceiptLine, completeReceipt } from '../src/server/ops/receipts';
import { listLots, getLot } from '../src/server/ops/lots';
import { consume, lotMovements, trace } from '../src/server/ops/stock';
import { createLabels, getLabels, logPrint, labelLog, resolveLabelCode, openLot, setOpenedShelfLife } from '../src/server/ops/labels';
import { securityChecks } from '../src/server/ops/security';
import { makeUser, lastLinkToken } from './helpers';

afterAll(() => closePool());

type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, cook: U, store: U, cashier: U, stranger: U, cookSite2: U;
let orgId: string, siteId: string, site2: string, creamId: string, supplierId: string;
const ALL_OK = { packaging: true, labeling: true, documents: true, quality: true };
const inDays = (n: number) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const op = () => randomUUID();

async function invite(role: string, siteIds?: string[]) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role, siteIds });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}

async function receive(lines: Record<string, unknown>[]) {
  const rec = await createReceipt(store.id, orgId, { siteId, supplierId, documentNo: `УПД-${Math.random().toString(36).slice(2, 6)}` });
  for (const l of lines) await addReceiptLine(store.id, orgId, rec.id, { productId: creamId, checks: ALL_OK, decision: 'accepted', expiryBasis: 'маркировка изготовителя', ...l });
  await completeReceipt(store.id, orgId, rec.id);
  const lots = await listLots(store.id, orgId, siteId);
  return Object.fromEntries(lines.map((l) => [l.lotNo as string, lots.find((x) => x.lot_no === l.lotNo)!]));
}

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кафе «Этикетка»' });
  orgId = r.organization.id; siteId = r.site.id;
  site2 = (await createSite(owner.id, orgId, { name: 'Вторая кухня' })).id;
  cook = await invite('line_staff');
  store = await invite('storekeeper');
  cashier = await invite('cashier');
  cookSite2 = await invite('line_staff', [site2]);
  stranger = await makeUser();
  await createOrganization(stranger, { name: 'Чужое кафе' });
  creamId = (await createProduct(store.id, orgId, { name: 'Сливки 33%', unit: 'л' })).id;
  supplierId = (await createSupplier(store.id, orgId, { name: 'ООО «Молочник»' })).id;
});

describe('Этикетки партий и журнал маркировки', () => {
  it('этикетка — снимок партии с QR-кодом; без изменений партии повторно выдаётся та же; печать пишется в журнал', async () => {
    const L = await receive([{ lotNo: 'С-1', quantity: 6, expiresAt: inDays(5) }, { lotNo: 'С-Q', quantity: 2, expiresAt: inDays(5), checks: { ...ALL_OK, packaging: false }, decision: 'quarantine', decisionReason: 'вздутие упаковки' },
      { lotNo: 'С-U', quantity: 1, expiryBasis: null }]);
    const [a, q, u] = await createLabels(store.id, orgId, { lotIds: [L['С-1'].id, L['С-Q'].id, L['С-U'].id] });
    expect(a.code).toMatch(/^[A-Z2-9]{8}$/);
    const again = await createLabels(cook.id, orgId, { lotIds: [L['С-1'].id] });
    expect(again[0]).toMatchObject({ id: a.id, reused: true });
    const got = await getLabels(cook.id, orgId, [a.id, q.id, u.id]);
    expect(got[0].payload).toMatchObject({ product: 'Сливки 33%', lot_no: 'С-1', expiry_basis: 'маркировка изготовителя', warning: null });
    expect(got[1].payload.warning).toBe('КАРАНТИН — НЕ ИСПОЛЬЗОВАТЬ');
    expect(got[2].payload.warning).toBe('СРОК НЕ ПОДТВЕРЖДЁН — НЕ ИСПОЛЬЗОВАТЬ');
    expect(await logPrint(cook.id, orgId, { labelIds: [a.id, q.id], format: '58x40', copies: 2 })).toEqual({ printed: 4 });
    const log = await labelLog(owner.id, orgId, siteId, 7);
    expect(log.filter((x) => x.label_id === a.id)).toEqual([expect.objectContaining({ copies: 2, format: '58x40', product: 'Сливки 33%', code: a.code })]);
    expect((await getLabels(cook.id, orgId, [a.id]))[0].printed).toBe(2);
    await expect(withSystem((tx) => tx.query(`update labels set payload = '{}' where id = $1`, [a.id]))).rejects.toThrow(/не изменяются/);
    await expect(withSystem((tx) => tx.query(`delete from label_prints where label_id = $1`, [a.id]))).rejects.toThrow(/не изменяются/);
  });

  it('QR-код открывает партию только своим сотрудникам с доступом к площадке', async () => {
    const L = await receive([{ lotNo: 'С-QR', quantity: 1, expiresAt: inDays(3) }]);
    const [lb] = await createLabels(store.id, orgId, { lotIds: [L['С-QR'].id] });
    expect(await resolveLabelCode(cook.id, lb.code.toLowerCase())).toEqual({ orgId, lotId: L['С-QR'].id });
    await expect(resolveLabelCode(stranger.id, lb.code)).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) });
    await expect(resolveLabelCode(cookSite2.id, lb.code)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(resolveLabelCode(cook.id, 'ZZZZZZZZ')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(createLabels(cashier.id, orgId, { lotIds: [L['С-QR'].id] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(logPrint(stranger.id, orgId, { labelIds: [lb.id], format: 'a4', copies: 1 })).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) });
  });
});

describe('Вскрытие тары: новый срок только с основанием', () => {
  it('без правила товара и без срока с маркировки — отказ; со сроком — дочерняя партия, срок = вскрытие + N ч, этикетка', async () => {
    const L = await receive([{ lotNo: 'В-1', quantity: 5, expiresAt: inDays(10) }]);
    await expect(openLot(cook.id, orgId, L['В-1'].id, { operationId: op() })).rejects.toThrow(/не задан срок после вскрытия/);
    await expect(openLot(cook.id, orgId, L['В-1'].id, { hours: 48, basis: 'да', operationId: op() })).rejects.toThrow(/основание/);
    const id = op();
    const before = Date.now();
    const r = await openLot(cook.id, orgId, L['В-1'].id, { quantity: '1,5', hours: 48, basis: 'маркировка: после вскрытия хранить 48 ч при +2…+6 °C', operationId: id });
    expect(r).toMatchObject({ quantity: 1.5, unit: 'л', expiry_basis: expect.stringContaining('после вскрытия 48 ч') });
    const exp = new Date(r.expires_at).getTime();
    expect(exp).toBeGreaterThanOrEqual(before + 48 * 3600e3 - 5000);
    expect(exp).toBeLessThanOrEqual(Date.now() + 48 * 3600e3 + 5000);
    expect(await openLot(cook.id, orgId, L['В-1'].id, { quantity: '1,5', hours: 48, basis: 'маркировка: после вскрытия хранить 48 ч', operationId: id })).toMatchObject({ lot_id: r.lot_id, repeated: true });
    const parent = await getLot(cook.id, orgId, L['В-1'].id);
    expect(Number(parent.lot.quantity)).toBe(3.5);
    expect(parent.opened).toEqual([expect.objectContaining({ id: r.lot_id })]);
    const child = await getLot(cook.id, orgId, r.lot_id);
    expect(child.lot).toMatchObject({ status: 'available', expiry_state: 'ok', lot_no: 'В-1' });
    expect(child.opened_from).toMatchObject({ id: L['В-1'].id });
    expect(child.label).toMatchObject({ id: r.label_id, code: r.code });
    const lb = (await getLabels(cook.id, orgId, [r.label_id]))[0];
    expect(lb).toMatchObject({ kind: 'opened' });
    expect(lb.payload.opened_at).toBeTruthy();
    const mv = (await lotMovements(cook.id, orgId, L['В-1'].id)).map((m: { kind: string; quantity: string }) => [m.kind, Number(m.quantity)]);
    expect(mv).toContainEqual(['open_out', -1.5]);
    const tr = await trace(owner.id, orgId, r.lot_id);
    expect(JSON.stringify(tr)).toContain(L['В-1'].id);                // прослеживаемость до исходной партии и приёмки
    await expect(openLot(cook.id, orgId, r.lot_id, { hours: 24, basis: 'маркировка изготовителя', operationId: op() })).rejects.toThrow(/уже вскрыта/);
  });

  it('срок изготовителя раньше — остаётся он; FEFO берёт вскрытую тару первой; правило товара с основанием', async () => {
    await expect(setOpenedShelfLife(cook.id, orgId, creamId, { hours: 72, basis: 'маркировка изготовителя' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(setOpenedShelfLife(store.id, orgId, creamId, { hours: 72 })).rejects.toThrow(/основание/);
    await setOpenedShelfLife(store.id, orgId, creamId, { hours: 72, basis: 'маркировка изготовителя: после вскрытия 72 ч' });
    const L = await receive([{ lotNo: 'В-2', quantity: 2, expiresAt: inDays(1) }, { lotNo: 'В-3', quantity: 2, expiresAt: inDays(9) }]);
    const early = await openLot(cook.id, orgId, L['В-2'].id, { operationId: op() });          // вся тара, правило товара
    expect(early.expiry_basis).toMatch(/срок изготовителя наступает раньше/);
    expect(new Date(early.expires_at).toISOString().slice(0, 10)).toBe(new Date(L['В-2'].expires_at).toISOString().slice(0, 10));
    expect((await getLot(cook.id, orgId, L['В-2'].id)).lot.status).toBe('consumed');
    const late = await openLot(cook.id, orgId, L['В-3'].id, { quantity: 1, operationId: op() });
    expect(late.expiry_basis).toMatch(/после вскрытия 72 ч/);
    const used = await consume(cook.id, orgId, { siteId, productId: creamId, quantity: 0.5, purpose: 'соус', operationId: op() });
    expect(used.lots[0].lot_id).toBe(early.lot_id);                                           // ближайший срок — вскрытая тара
  });

  it('карантинную и без подтверждённого срока тару не вскрывают; кассир не вскрывает', async () => {
    const L = await receive([{ lotNo: 'В-Q', quantity: 1, expiresAt: inDays(5), checks: { ...ALL_OK, labeling: false }, decision: 'quarantine', decisionReason: 'маркировка не читается' },
      { lotNo: 'В-U', quantity: 1, expiryBasis: null }, { lotNo: 'В-4', quantity: 1, expiresAt: inDays(5) }]);
    await expect(openLot(cook.id, orgId, L['В-Q'].id, { operationId: op() })).rejects.toThrow(/карантин/i);
    await expect(openLot(cook.id, orgId, L['В-U'].id, { operationId: op() })).rejects.toThrow(/не подтверждён/);
    await expect(openLot(cashier.id, orgId, L['В-4'].id, { operationId: op() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(openLot(cookSite2.id, orgId, L['В-4'].id, { operationId: op() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('Безопасность', () => {
  it('этикетки и журнал маркировки — неизменяемые и с изоляцией организаций', async () => {
    const s = await securityChecks();
    expect(s.checks.find((c) => c.key === 'immutable_grants')).toMatchObject({ ok: true });
    expect(s.checks.find((c) => c.key === 'immutable_triggers')).toMatchObject({ ok: true });
    expect(s.checks.find((c) => c.key === 'rls')).toMatchObject({ ok: true });
  });
});
