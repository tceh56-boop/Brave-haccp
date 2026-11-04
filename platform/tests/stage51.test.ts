import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createProduct, createSupplier } from '../src/server/ops/catalog';
import { createReceipt, addReceiptLine, completeReceipt } from '../src/server/ops/receipts';
import { createDish, getDish, updateVersion, addLine, submitVersion, approveVersion } from '../src/server/ops/recipes';
import { createProduction, startProduction, getProduction, completeProduction, decideBrakerage, setSampleOnRelease } from '../src/server/ops/production';
import { createEvent } from '../src/server/ops/planmenu';
import { takeSample } from '../src/server/ops/lab';
import { listTasks } from '../src/server/ops/tasks';
import { getJournal, addEntry, listForms } from '../src/server/ops/journals';
import { makeUser, lastLinkToken, fact, orgDate } from './helpers';

/** Этап 2 доработки под кухню и ХАССП: бракераж из выпуска блюда; J02/J40 из решений; суточная проба при выпуске. */

afterAll(() => closePool());
type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, chef: U, cook: U, haccp: U;
let orgId: string, siteId: string, beef: string, cutlet: string, plain: string;
const ALL_OK = { packaging: true, labeling: true, documents: true, quality: true };
const ORG = { appearance: 'Котлеты овальной формы, без трещин', color: 'Корочка золотистая, на разрезе серый', consistency: 'Сочная, однородная', taste: 'Свойственные жареному мясу, без посторонних' };

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}
async function dish(name: string, organoleptic?: Record<string, string>) {
  const d = await createDish(chef.id, orgId, { name, kind: 'dish', salePrice: 300 });
  const v = (await getDish(chef.id, orgId, d.id)).current!.version.id;
  await updateVersion(chef.id, orgId, v, { yieldG: 1000, portionG: 150, technology: 'Жарить по технологии предприятия.', storageConditions: '+2…+6 °C', shelfLife: '24 часа', saleHours: 3, shelfBasis: 'СТО предприятия', ...(organoleptic ? { organoleptic } : {}) });
  await addLine(chef.id, orgId, v, { productId: beef, unit: 'кг', brutto: 1.2, netto: 1 });
  await submitVersion(chef.id, orgId, v);
  await approveVersion(chef.id, orgId, v);
  return d.id as string;
}
async function released(dishId: string, extra: Record<string, unknown> = {}, by: U = cook, planEventId?: string) {
  const id = (await createProduction(chef.id, orgId, { siteId, dishId, plannedKg: 1, plannedFor: orgDate(), planEventId })).id as string;
  await startProduction(by.id, orgId, id);
  const r = await completeProduction(by.id, orgId, id, { consumed: await fact(by.id, orgId, id), actualKg: 0.95, operationId: randomUUID(), ...extra });
  return { id, r };
}
const lotStatus = async (lotId: string) => (await withSystem((tx) => tx.query(`select status, status_reason from lots where id = $1`, [lotId]))).rows[0];

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кухня бракеража' });
  orgId = r.organization.id; siteId = r.site.id;
  chef = await invite('chef'); cook = await invite('line_staff'); haccp = await invite('haccp_lead');
  beef = (await createProduct(chef.id, orgId, { name: 'Фарш говяжий', unit: 'кг' })).id;
  const sup = (await createSupplier(chef.id, orgId, { name: 'ООО «Мясо»' })).id;
  const rc = await createReceipt(cook.id, orgId, { siteId, supplierId: sup });
  await addReceiptLine(cook.id, orgId, rc.id, { productId: beef, quantity: 30, unitPrice: 400, lotNo: 'Ф-1', expiresAt: orgDate(4), expiryBasis: 'маркировка изготовителя', checks: ALL_OK, decision: 'accepted' });
  await completeReceipt(cook.id, orgId, rc.id);
  cutlet = await dish('Котлеты рубленые', ORG);
  plain = await dish('Тефтели без эталона');
});

describe('Бракераж при выпуске блюда', () => {
  it('повар выпускает без решения — партия ждёт бракеража на удержании, задача шефу; сам решать не может', async () => {
    const { id, r } = await released(cutlet);
    expect(r).toMatchObject({ brakerage: 'pending', lot_status: 'quarantine' });
    expect(await lotStatus(r.lot_id)).toMatchObject({ status: 'quarantine', status_reason: 'ожидает бракеража' });
    expect((await listTasks(chef.id, orgId, { siteId })).some((t: { kind: string; title: string }) => t.kind === 'brakerage' && t.title.includes('Котлеты рубленые'))).toBe(true);
    await expect(decideBrakerage(cook.id, orgId, id, { decision: 'allowed' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const card = await getProduction(chef.id, orgId, id);
    expect(card.brakerage).toMatchObject({ decision: null, can_decide: true });
    expect(card.brakerage!.reference.map((x: { label: string }) => x.label)).toEqual(['внешний вид', 'цвет', 'консистенция', 'вкус и запах']);
    // «соответствует» — по эталону ТТК; разрешение к реализации со временем и ФИО
    const d = await decideBrakerage(chef.id, orgId, id, { decision: 'allowed' });
    expect(d).toMatchObject({ decision: 'allowed', lot_status: 'available' });
    expect(await lotStatus(r.lot_id)).toMatchObject({ status: 'available' });
    const after = await getProduction(chef.id, orgId, id);
    expect(after.brakerage).toMatchObject({ decision: 'allowed', organoleptic: 'соответствует эталону ТТК', assessed_by_name: expect.any(String), assessed_at: expect.anything() });
    await expect(decideBrakerage(haccp.id, orgId, id, { decision: 'rejected', organoleptic: 'передумали' })).rejects.toThrow(/не меняется/);
    expect((await listTasks(chef.id, orgId, { siteId })).some((t: { kind: string; entity_id: string }) => t.kind === 'brakerage' && t.entity_id === id)).toBe(false);
  });

  it('повар не может внести решение при выпуске; шеф — может сразу', async () => {
    await expect(released(cutlet, { decision: 'allowed' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const { r } = await released(cutlet, { decision: 'allowed' }, chef);
    expect(r).toMatchObject({ brakerage: 'allowed', lot_status: 'available' });
  });

  it('«не соответствует» — только с причиной; партия не реализуется, отклонение ответственному', async () => {
    const { id, r } = await released(cutlet);
    await expect(decideBrakerage(haccp.id, orgId, id, { decision: 'rejected' })).rejects.toThrow(/укажите причину/);
    const d = await decideBrakerage(haccp.id, orgId, id, { decision: 'rejected', organoleptic: 'Посторонний запах, корочка подгоревшая' });
    expect(d).toMatchObject({ decision: 'rejected', lot_status: 'quarantine', incident_id: expect.any(String) });
    expect(await lotStatus(r.lot_id)).toMatchObject({ status: 'quarantine', status_reason: 'бракераж: не соответствует — Посторонний запах, корочка подгоревшая' });
    const inc = (await withSystem((tx) => tx.query(`select kind, severity, entity_id from incidents where id = $1`, [d.incident_id]))).rows[0];
    expect(inc).toMatchObject({ kind: 'brakerage', severity: 'high', entity_id: id });
  });

  it('нет эталона органолептики в ТТК — «соответствует» только с описанием', async () => {
    const { id } = await released(plain);
    await expect(decideBrakerage(chef.id, orgId, id, { decision: 'allowed' })).rejects.toThrow(/нет эталона органолептики/);
    expect(await decideBrakerage(chef.id, orgId, id, { decision: 'allowed', organoleptic: 'Форма шаров, вкус и запах мясные, без посторонних' })).toMatchObject({ lot_status: 'available' });
  });
});

describe('Суточная проба при выпуске', () => {
  it('предлагается для мероприятий и для блюд с отметкой в настройках проб; отбирается существующим takeSample', async () => {
    expect((await released(cutlet)).r.sample_offer).toBeNull();
    const ev = await createEvent(chef.id, orgId, { siteId, title: 'Банкет', eventDate: orgDate(), guests: 20 });
    expect((await released(cutlet, {}, cook, ev.id)).r.sample_offer).toMatchObject({ source: 'event', reason: expect.stringContaining('мероприятие № ') });
    await expect(setSampleOnRelease(cook.id, orgId, cutlet, { onRelease: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await setSampleOnRelease(haccp.id, orgId, cutlet, { onRelease: true });
    const { id, r } = await released(cutlet);
    expect(r.sample_offer).toMatchObject({ source: 'lot', lot_id: r.lot_id, taken: null, reason: 'для блюда указано в настройках проб' });
    await takeSample(cook.id, orgId, { siteId, source: 'lot', lotId: r.lot_id, weightG: 150, container: 'стерильная банка', storagePlace: 'Холодильник для проб', temperature: 4 });
    expect((await getProduction(cook.id, orgId, id)).sample_offer).toMatchObject({ taken: expect.objectContaining({ id: expect.any(String) }) });
  });
});

describe('J02 и J40 — из решений бракеража', () => {
  it('строки совпадают с выпусками блюд: решение, кто и когда разрешил; ручная строка не принимается', async () => {
    for (const c of ['J02', 'J40']) expect(listForms().find((f) => f.code === c)).toMatchObject({ mode: 'auto' });
    const period = { siteId, from: orgDate(), to: orgDate() };
    const n = Number((await withSystem((tx) => tx.query(`select count(*) from production_orders o join dishes d on d.id = o.dish_id where o.organization_id = $1 and o.status = 'done' and d.kind = 'dish'`, [orgId]))).rows[0].count);
    const j02 = await getJournal(haccp.id, orgId, 'J02', period), j40 = await getJournal(haccp.id, orgId, 'J40', period);
    expect(j02.rows).toHaveLength(n);
    expect(j40.rows).toHaveLength(n);
    expect(j02.rows.map((r) => r[6])).toEqual(expect.arrayContaining(['допустить', 'брак: Посторонний запах, корочка подгоревшая', 'ожидает бракеража']));
    expect(j40.rows.find((r) => r[3] === 'соответствует эталону ТТК')![8]).not.toBe('—');
    expect(j40.rows.some((r) => r[6] === 'ожидает бракеража')).toBe(true);
    expect(j02.blockers.join(' ')).toMatch(/Бракераж: не соответствует/);
    expect(j02.form.basis.join(' ')).toMatch(/СанПиН/);
    await expect(addEntry(cook.id, orgId, 'J40', { siteId, values: { 0: 'сегодня', 2: 'котлеты' } })).rejects.toThrow(/заполняется автоматически/);
  });
});
