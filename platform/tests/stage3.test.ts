import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, createSite, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createProduct, createSupplier } from '../src/server/ops/catalog';
import { createReceipt, addReceiptLine, completeReceipt } from '../src/server/ops/receipts';
import { listLots, getLot } from '../src/server/ops/lots';
import { listTasks } from '../src/server/ops/tasks';
import { consume, writeOff, transfer, balances, trace, lotsBySupplier, startCount, getCount, setCountLine, closeCount, setUnitConversion, lotMovements } from '../src/server/ops/stock';
import { importReference, searchReference, getReference, linkProductToReference, createProductFromReference } from '../src/server/ops/reference';
import { makeUser, lastLinkToken } from './helpers';

afterAll(() => closePool());

type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, cook: U, store: U;
let orgId: string, siteId: string, site2: string, beefId: string, supplierId: string;
const ALL_OK = { packaging: true, labeling: true, documents: true, quality: true };
const inDays = (n: number) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const op = () => randomUUID();

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}

/** Приёмка набора партий одного товара; возвращает партии по номерам. */
async function receive(lines: Record<string, unknown>[]) {
  const rec = await createReceipt(store.id, orgId, { siteId, supplierId, documentNo: `УПД-${Math.random().toString(36).slice(2, 6)}` });
  for (const l of lines) await addReceiptLine(store.id, orgId, rec.id, { productId: beefId, checks: ALL_OK, decision: 'accepted', expiryBasis: 'маркировка изготовителя', ...l });
  await completeReceipt(store.id, orgId, rec.id);
  const lots = await listLots(store.id, orgId, siteId);
  return Object.fromEntries(lines.map((l) => [l.lotNo as string, lots.find((x) => x.lot_no === l.lotNo)!]));
}

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Цех «Склад»' });
  orgId = r.organization.id; siteId = r.site.id;
  site2 = (await createSite(owner.id, orgId, { name: 'Кафе на набережной' })).id;
  cook = await invite('line_staff');
  store = await invite('storekeeper');
  beefId = (await createProduct(store.id, orgId, { name: 'Говядина вырезка', unit: 'кг' })).id;
  supplierId = (await createSupplier(store.id, orgId, { name: 'ООО «Фермер»' })).id;
});

describe('Единый каталог MON CHEF (ТЗ v1 §6, AT-05)', () => {
  it('загружаются все 1549 ProductID; повторная загрузка ничего не дублирует; дубли не сливаются', async () => {
    const first = await importReference();
    expect(first.total).toBe(1549);
    const again = await importReference();
    expect(again).toMatchObject({ inserted: 0, updated: 1549 });
    const n = (await withSystem((tx) => tx.query(`select count(*)::int as n, count(*) filter (where verification_status = 'REVIEW')::int as review,
      count(distinct duplicate_group)::int as groups from reference_products`))).rows[0];
    expect(n).toMatchObject({ n: 1549, review: 1549, groups: 88 });
  });

  it('поиск, близнецы-дубли и создание товара из справочника', async () => {
    const found = await searchReference(store.id, orgId, 'кетчуп');
    expect(found.length).toBeGreaterThan(1);
    const dup = found.find((f) => f.duplicate_group)!;
    const card = await getReference(store.id, orgId, dup.id);
    expect(card.twins.length).toBeGreaterThan(0);
    expect(card.twins.every((t: { id: string }) => t.id !== dup.id)).toBe(true);
    const p = await createProductFromReference(store.id, orgId, { referenceId: dup.id, unit: 'кг' });
    expect(p.reference_product_id).toBe(dup.id);
    await linkProductToReference(store.id, orgId, beefId, { referenceId: (await searchReference(store.id, orgId, 'говядина'))[0].id });
    await expect(createProductFromReference(cook.id, orgId, { referenceId: dup.id, unit: 'кг' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('FEFO: единственный путь расхода (ТЗ v2 §4, AT-03)', () => {
  it('расход берёт годные партии по ближайшему сроку; карантин и без срока не трогаются; в минус не уходит', async () => {
    const L = await receive([
      { lotNo: 'B-late', quantity: 4, expiresAt: inDays(6) },
      { lotNo: 'A-early', quantity: 2, expiresAt: inDays(2) },
      { lotNo: 'Q-quar', quantity: 5, expiresAt: inDays(1), checks: { ...ALL_OK, packaging: false }, decision: 'quarantine', decisionReason: 'вздутие упаковки' },
      { lotNo: 'U-noexp', quantity: 7, expiryBasis: null },
    ]);
    const bal = (await balances(store.id, orgId, siteId)).find((b) => b.product_id === beefId)!;
    expect(Number(bal.available)).toBe(6);
    expect(Number(bal.quarantine)).toBe(5);
    expect(Number(bal.unconfirmed)).toBe(7);

    const r = await consume(cook.id, orgId, { siteId, productId: beefId, quantity: '3', purpose: 'бифштексы на обед', operationId: op() });
    expect(r.lots.map((x: { lot_no: string; quantity: number }) => [x.lot_no, x.quantity])).toEqual([['A-early', 2], ['B-late', 1]]);
    expect((await getLot(store.id, orgId, L['A-early'].id)).lot.status).toBe('consumed');
    expect(Number((await getLot(store.id, orgId, L['Q-quar'].id)).lot.quantity)).toBe(5);
    expect(Number((await getLot(store.id, orgId, L['U-noexp'].id)).lot.quantity)).toBe(7);

    await expect(consume(cook.id, orgId, { siteId, productId: beefId, quantity: 10, purpose: 'банкет', operationId: op() })).rejects.toThrow(/доступно 3 кг, нужно 10/);
    expect(Number((await getLot(store.id, orgId, L['B-late'].id)).lot.quantity)).toBe(3);
  });

  it('выбор не той партии по FEFO — только с причиной; отметка в движении', async () => {
    const L = await receive([{ lotNo: 'C-1', quantity: 2, expiresAt: inDays(3) }, { lotNo: 'C-2', quantity: 2, expiresAt: inDays(8) }]);
    await expect(consume(cook.id, orgId, { siteId, productId: beefId, quantity: 1, purpose: 'тест', lotId: L['C-2'].id, operationId: op() })).rejects.toThrow(/более ранним сроком/);
    const r = await consume(cook.id, orgId, { siteId, productId: beefId, quantity: 1, purpose: 'стейк по заказу', lotId: L['C-2'].id, overrideReason: 'гость заказал мраморность этой партии', operationId: op() });
    expect(r.fefo_override).toBe(true);
    const mv = await lotMovements(store.id, orgId, L['C-2'].id);
    expect(mv.at(-1)).toMatchObject({ kind: 'consume', fefo_override: true });
    await expect(consume(cook.id, orgId, { siteId, productId: beefId, quantity: 1, purpose: 'тест', lotId: (await listLots(store.id, orgId, siteId)).find((l) => l.lot_no === 'Q-quar')!.id, operationId: op() })).rejects.toThrow(/карантине/);
  });

  it('повтор операции с тем же ключом не списывает второй раз (ТЗ v2 AT-12)', async () => {
    const key = op();
    const before = (await balances(store.id, orgId, siteId)).find((b) => b.product_id === beefId)!;
    const a = await consume(cook.id, orgId, { siteId, productId: beefId, quantity: 1, purpose: 'гуляш', operationId: key });
    const b = await consume(cook.id, orgId, { siteId, productId: beefId, quantity: 1, purpose: 'гуляш', operationId: key });
    expect(b).toMatchObject({ repeated: true, quantity: a.quantity });
    const after = (await balances(store.id, orgId, siteId)).find((x) => x.product_id === beefId)!;
    expect(Number(before.available) - Number(after.available)).toBe(1);
    const moves = (await withSystem((tx) => tx.query(`select count(*)::int as n from stock_movements where operation_id = $1`, [key]))).rows[0].n;
    expect(moves).toBe(a.lots.length);
  });

  it('единицы пересчитываются только по подтверждённому коэффициенту', async () => {
    await expect(consume(cook.id, orgId, { siteId, productId: beefId, quantity: 4, unit: 'шт', purpose: 'порции', operationId: op() })).rejects.toThrow(/Нет подтверждённого коэффициента/);
    await expect(setUnitConversion(store.id, orgId, { productId: beefId, fromUnit: 'шт', toUnit: 'кг', factor: 0.25, source: 'мало' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await setUnitConversion(store.id, orgId, { productId: beefId, fromUnit: 'шт', toUnit: 'кг', factor: 0.25, source: 'контрольное взвешивание 10 порций 20.10.2026' });
    const r = await consume(cook.id, orgId, { siteId, productId: beefId, quantity: 4, unit: 'шт', purpose: 'порции', operationId: op() });
    expect(r.quantity).toBe(1);
  });

  it('движение запаса нельзя изменить или удалить', async () => {
    const id = (await withSystem((tx) => tx.query(`select id from stock_movements limit 1`))).rows[0].id;
    await expect(withSystem((tx) => tx.query(`update stock_movements set quantity = 100 where id = $1`, [id]))).rejects.toThrow(/нельзя изменить/);
    await expect(withSystem((tx) => tx.query(`delete from stock_movements where id = $1`, [id]))).rejects.toThrow(/нельзя изменить/);
  });
});

describe('Списания и перемещения', () => {
  it('карантинную партию можно списать; задача решения закрывается; «Другое» — только с описанием', async () => {
    const q = (await listLots(store.id, orgId, siteId)).find((l) => l.lot_no === 'Q-quar')!;
    await expect(writeOff(cook.id, orgId, { lotId: q.id, reasonCode: 'quarantine_reject', operationId: op() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(writeOff(store.id, orgId, { lotId: q.id, reasonCode: 'other', operationId: op() })).rejects.toThrow(/опишите причину/);
    const r = await writeOff(store.id, orgId, { lotId: q.id, reasonCode: 'quarantine_reject', comment: 'возврат не принят поставщиком', operationId: op() });
    expect(r).toMatchObject({ written_off: 5, rest: 0 });
    expect((await getLot(store.id, orgId, q.id)).lot.status).toBe('written_off');
    expect((await listTasks(owner.id, orgId, { all: true })).some((t) => t.entity_id === q.id)).toBe(false);
  });

  it('перемещение создаёт дочернюю партию с тем же сроком; карантинную переместить нельзя', async () => {
    const L = await receive([{ lotNo: 'T-1', quantity: 5, expiresAt: inDays(4) }]);
    const r = await transfer(store.id, orgId, { lotId: L['T-1'].id, toSiteId: site2, quantity: 2, operationId: op() });
    const child = (await listLots(store.id, orgId, site2)).find((l) => l.id === r.to_lot)!;
    expect(child).toMatchObject({ lot_no: 'T-1', expiry_state: 'ok' });
    expect(Number(child.quantity)).toBe(2);
    expect(child.expires_at).toEqual(L['T-1'].expires_at);
    expect(Number((await getLot(store.id, orgId, L['T-1'].id)).lot.quantity)).toBe(3);

    // Прослеживаемость: от дочерней партии назад — до поставщика и приёмки; вперёд от родителя — до дочерней.
    const back = await trace(store.id, orgId, r.to_lot);
    expect(back.origin).toMatchObject({ supplier: 'ООО «Фермер»', decision: 'accepted' });
    expect(back.ancestry.map((a: { id: string }) => a.id)).toEqual([L['T-1'].id]);
    const fwd = await trace(store.id, orgId, L['T-1'].id) as unknown as { lot: { movements: { kind: string }[]; children: { id: string }[] } };
    expect(fwd.lot.movements.map((m) => m.kind)).toEqual(['receipt', 'transfer_out']);
    expect(fwd.lot.children.map((c) => c.id)).toEqual([r.to_lot]);
    const bySupplier = await lotsBySupplier(store.id, orgId, supplierId);
    expect(bySupplier.some((l) => l.lot_no === 'T-1')).toBe(true);
  });
});

describe('Инвентаризация', () => {
  it('расхождения проводятся корректирующими движениями; непосчитанные строки не дают закрыть', async () => {
    const c = await startCount(store.id, orgId, { siteId });
    await expect(startCount(store.id, orgId, { siteId })).rejects.toMatchObject({ code: 'CONFLICT' });
    const { lines } = await getCount(store.id, orgId, c.id);
    expect(lines.length).toBeGreaterThan(0);
    await expect(closeCount(store.id, orgId, c.id)).rejects.toThrow(/Не посчитано/);
    const target = lines.find((l) => l.lot_no === 'B-late')!;
    for (const l of lines) await setCountLine(store.id, orgId, c.id, l.id, { counted: l.id === target.id ? Number(l.expected) - 0.5 : Number(l.expected), note: l.id === target.id ? 'обрезь при зачистке не списана' : undefined });
    const res = await closeCount(store.id, orgId, c.id);
    expect(res.adjusted).toBe(1);
    const mv = await lotMovements(store.id, orgId, target.lot_id);
    expect(mv.at(-1)).toMatchObject({ kind: 'count_adjust', reason_code: 'shortage' });
    expect(Number(mv.at(-1)!.quantity)).toBe(-0.5);
  });
});

describe('Изоляция этапа 3', () => {
  it('чужая организация не расходует и не видит прослеживаемость', async () => {
    const stranger = await makeUser();
    await createOrganization(stranger, { name: 'Чужая кухня' });
    await expect(consume(stranger.id, orgId, { siteId, productId: beefId, quantity: 1, purpose: 'взлом', operationId: op() })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const anyLot = (await listLots(store.id, orgId, siteId))[0];
    await expect(trace(stranger.id, orgId, anyLot.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
