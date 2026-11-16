import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createControlObject, createRule, approveRule } from '../src/server/ops/control';
import { recordMeasurement } from '../src/server/ops/measurements';
import { createPlan, recordDone } from '../src/server/ops/sanitation';
import { createProduct, createSupplier } from '../src/server/ops/catalog';
import { createReceipt, addReceiptLine, completeReceipt } from '../src/server/ops/receipts';
import { createDish, getDish, updateVersion, addLine, submitVersion, approveVersion } from '../src/server/ops/recipes';
import { createProduction } from '../src/server/ops/production';
import { setSampleSettings, takeSample } from '../src/server/ops/lab';
import { setMedical, recordHealthCheck, setStaffSettings } from '../src/server/ops/staff';
import { shiftCards } from '../src/server/ops/shift';
import { makeUser, lastLinkToken, orgDate } from './helpers';

/** Этап 3 доработки под кухню и ХАССП: экран смены — карточки «что сделать сейчас» из существующих источников. */

afterAll(() => closePool());
type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, chef: U, cook: U, haccp: U, tech: U, orgId: string, siteId: string, fridge: string, plan: string, semi: string;

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}
const cards = async (u: U) => shiftCards(u.id, orgId, siteId);
const keys = (r: Awaited<ReturnType<typeof shiftCards>>) => r.cards.map((c) => c.key);

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кухня смены' });
  orgId = r.organization.id; siteId = r.site.id;
  chef = await invite('chef'); cook = await invite('line_staff'); haccp = await invite('haccp_lead'); tech = await invite('technologist');
  fridge = (await createControlObject(owner.id, orgId, { siteId, name: 'Холодильник мяса', kind: 'fridge' })).id;
  const rule = await createRule(haccp.id, orgId, { controlObjectId: fridge, minValue: 2, maxValue: 6, frequencyHours: 4, sourceRef: 'ППК, раздел 4 (тест)' });
  await approveRule(haccp.id, orgId, rule.id);
  plan = (await createPlan(haccp.id, orgId, { siteId, area: 'Разделочные столы', work: 'Мойка и дезинфекция', kind: 'current', periodDays: 1, nextDue: orgDate() })).id;
  const beef = (await createProduct(chef.id, orgId, { name: 'Говядина', unit: 'кг' })).id;
  const sup = (await createSupplier(chef.id, orgId, { name: 'ООО «Мясо»' })).id;
  const rc = await createReceipt(cook.id, orgId, { siteId, supplierId: sup });
  await addReceiptLine(cook.id, orgId, rc.id, { productId: beef, quantity: 5, unitPrice: 500, lotNo: 'Г-1', expiresAt: orgDate(4), expiryBasis: 'маркировка', checks: { packaging: true, labeling: true, documents: true, quality: true }, decision: 'accepted' });
  await completeReceipt(cook.id, orgId, rc.id);
  const d = await createDish(chef.id, orgId, { name: 'Бульон', kind: 'semi' });
  const v = (await getDish(chef.id, orgId, d.id)).current!.version.id;
  await updateVersion(chef.id, orgId, v, { yieldG: 1000, technology: 'Варить по технологии предприятия.', storageConditions: '+2…+6 °C', shelfLife: '24 часа', shelfLifeHours: 24, shelfBasis: 'лабораторное обоснование срока' });
  await addLine(chef.id, orgId, v, { productId: beef, unit: 'кг', brutto: 1, netto: 0.8 });
  await submitVersion(chef.id, orgId, v); await approveVersion(chef.id, orgId, v);
  semi = d.id;
});

describe('Экран смены: карточки «что сделать сейчас»', () => {
  it('замер, уборка, задание — из правил, плана и производства; порядок: просрочено → сейчас → позже', async () => {
    await createProduction(chef.id, orgId, { siteId, dishId: semi, plannedKg: 1, plannedFor: orgDate() });
    const r = await cards(cook);
    const measure = r.cards.find((c) => c.key === `measure:${fridge}:temperature`)!;
    expect(measure).toMatchObject({ bucket: 'overdue', kind: 'measure', action: { type: 'number', url: `/orgs/${orgId}/measurements`, field: 'value', unit: '°C' } });
    expect(measure.detail).toMatch(/Предел .*2.*6/);
    expect(r.cards.find((c) => c.key === `sanitation:${plan}`)).toMatchObject({ bucket: 'now', action: { type: 'done', url: `/orgs/${orgId}/sanitation/plans/${plan}/done` } });
    expect(r.cards.find((c) => c.kind === 'production')).toMatchObject({ bucket: 'now', title: 'Задание: Бульон', action: { type: 'open' } });
    const order = r.cards.map((c) => ({ overdue: 0, now: 1, later: 2 })[c.bucket]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(r.counts.overdue).toBeGreaterThan(0);
  });

  it('действие карточки — существующая операция; после неё карточка уходит в «позже» или исчезает', async () => {
    await recordMeasurement(cook.id, orgId, { controlObjectId: fridge, value: 4 });
    await recordDone(cook.id, orgId, plan, {});
    const r = await cards(cook);
    const m = r.cards.find((c) => c.key === `measure:${fridge}:temperature`);
    expect(m === undefined || m.bucket === 'later').toBe(true);   // следующий слот — через 4 ч, если он до конца суток
    expect(keys(r)).not.toContain(`sanitation:${plan}`);
  });

  it('технолог без прав на замер и уборку карточек замеров и уборок не видит', async () => {
    const r = await cards(tech);
    expect(r.cards.some((c) => c.kind === 'measure' || c.kind === 'sanitation')).toBe(false);
  });

  it('суточная проба: срок хранения истекает сегодня — «позже», без кнопки до срока', async () => {
    await setSampleSettings(haccp.id, orgId, { minWeightG: 100, retentionHours: 1, tMin: 2, tMax: 6, basis: 'Тест: приказ о пробах, п. 3' });
    const s = await takeSample(cook.id, orgId, { siteId, source: 'dish', dishId: semi, weightG: 120, container: 'стерильная банка', storagePlace: 'Холодильник проб', temperature: 4 });
    const c = (await cards(cook)).cards.find((x) => x.key === `sample:${s.id}`);
    if (c) expect(c).toMatchObject({ bucket: 'later', action: { type: 'info' } });   // если до конца суток меньше часа — срок уже завтра
  });

  it('допуск: в режиме «блокировать» повар видит «осмотр не отмечен» первой карточкой; шеф — карточку «Допущен» на повара', async () => {
    await setStaffSettings(owner.id, orgId, { medicalGate: 'block' });
    await setMedical(haccp.id, orgId, cook.id, { medBookNo: 'ЛМК 1', examOn: orgDate(-10), examDue: orgDate(300), hygieneOn: orgDate(-10), hygieneDue: orgDate(600) });
    const mine = await cards(cook);
    expect(mine.cards[0]).toMatchObject({ key: 'self:health', bucket: 'overdue', action: { type: 'info' } });
    expect(mine.admission).toMatchObject({ required: true, admitted: null, medical: 'ok' });
    const ch = await cards(chef);
    expect(ch.cards.find((x) => x.key === `health:${cook.id}`)).toMatchObject({ action: { type: 'done', url: `/orgs/${orgId}/staff/${cook.id}/health-check`, body: { siteId, admitted: true } } });
    await recordHealthCheck(chef.id, orgId, cook.id, { siteId, admitted: true });
    expect(keys(await cards(cook))).not.toContain('self:health');
    expect(keys(await cards(chef))).not.toContain(`health:${cook.id}`);
  });

  it('чужой организации экран смены недоступен', async () => {
    const stranger = await makeUser();
    await expect(shiftCards(stranger.id, orgId, siteId)).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) });
  });
});
