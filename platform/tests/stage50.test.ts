import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createProduct, createSupplier } from '../src/server/ops/catalog';
import { createReceipt, addReceiptLine, completeReceipt } from '../src/server/ops/receipts';
import { createDish, getDish, updateVersion, addLine, submitVersion, approveVersion } from '../src/server/ops/recipes';
import { saveStages } from '../src/server/ops/ttkStages';
import { createPlan, addStep, confirmStep, addHazard, answerTree, classifyHazard, setMonitoring, approvePlan } from '../src/server/ops/haccp';
import { createEquipment } from '../src/server/ops/equipment';
import { createProduction, startProduction, getProduction, recordCheck, completeProduction, addReleaseCheck, approveReleaseCheck, correctCheck } from '../src/server/ops/production';
import { getJournal, addEntry, listForms } from '../src/server/ops/journals';
import { makeUser, lastLinkToken, fact, orgDate } from './helpers';

/** Этап 1 доработки под кухню и ХАССП: ККТ из производства (J22–J24 из замеров при выпуске). */

afterAll(() => closePool());
type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, chef: U, cook: U, haccp: U, tech: U;
let orgId: string, siteId: string, supplierId: string, beef: string, boiled: string, chilled: string, probe: string, oldProbe: string;
const ALL_OK = { packaging: true, labeling: true, documents: true, quality: true };
const op = () => randomUUID();
const ACTION_COOK = 'Продолжить варку до достижения предела и повторить замер; не достигнуто — партию не выпускать, решение ответственного ХАССП.';
const ACTION_COOL = 'Перенести в шкаф шоковой заморозки; не уложились во время — партию не реализовывать.';

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}
/** П/ф с утверждённой ТТК, этапы которой ссылаются на ККТ плана ХАССП. */
async function semi(name: string, stages: { operation: string; ccp_code?: string }[]) {
  const d = await createDish(chef.id, orgId, { name, kind: 'semi' });
  const v = (await getDish(chef.id, orgId, d.id)).current!.version.id;
  await updateVersion(chef.id, orgId, v, { yieldG: 1000, technology: 'Варить по технологии предприятия.', storageConditions: '+2…+6 °C', shelfLife: '24 часа', shelfLifeHours: 24, shelfBasis: 'лабораторное обоснование срока' });
  await addLine(chef.id, orgId, v, { productId: beef, unit: 'кг', brutto: 1.2, netto: 1 });
  await saveStages(chef.id, orgId, v, { stages: stages.map((s) => ({ ...s, state: 'semi' })) });
  await submitVersion(chef.id, orgId, v);
  await approveVersion(chef.id, orgId, v);
  return d.id as string;
}
async function startOrder(dishId: string) {
  const id = (await createProduction(chef.id, orgId, { siteId, dishId, plannedKg: 1, plannedFor: orgDate() })).id as string;
  await startProduction(cook.id, orgId, id);
  return id;
}
const release = async (id: string) => completeProduction(cook.id, orgId, id, { consumed: await fact(cook.id, orgId, id), actualKg: 0.95, operationId: op() });

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кухня ККТ' });
  orgId = r.organization.id; siteId = r.site.id;
  chef = await invite('chef'); cook = await invite('line_staff'); haccp = await invite('haccp_lead'); tech = await invite('technologist');
  beef = (await createProduct(chef.id, orgId, { name: 'Говядина', unit: 'кг' })).id;
  supplierId = (await createSupplier(chef.id, orgId, { name: 'ООО «Мясо»' })).id;
  const rc = await createReceipt(cook.id, orgId, { siteId, supplierId });
  await addReceiptLine(cook.id, orgId, rc.id, { productId: beef, quantity: 20, unitPrice: 500, lotNo: 'М-1', expiresAt: orgDate(5), expiryBasis: 'маркировка изготовителя', checks: ALL_OK, decision: 'accepted' });
  await completeReceipt(cook.id, orgId, rc.id);
  // План ХАССП: О-01 — тепловая обработка (J22), О-02 — охлаждение (J23); утверждает руководитель
  const planId = (await createPlan(tech.id, orgId, { scope: 'Полуфабрикаты горячего цеха', team: 'технолог, ответственный ХАССП, шеф' })).id;
  const cookStep = (await addStep(tech.id, orgId, planId, { name: 'Варка' })).id, coolStep = (await addStep(tech.id, orgId, planId, { name: 'Охлаждение' })).id;
  const h1 = (await addHazard(tech.id, orgId, planId, { stepId: cookStep, hazardType: 'biological', description: 'Выживание патогенов при недостаточной тепловой обработке', likelihood: 3, severity: 3, controlMeasures: 'Варка до температуры в толще' })).id;
  const h2 = (await addHazard(tech.id, orgId, planId, { stepId: coolStep, hazardType: 'biological', description: 'Рост спорообразующих при медленном охлаждении', likelihood: 3, severity: 3, controlMeasures: 'Шоковое охлаждение' })).id;
  for (const h of [h1, h2]) { await answerTree(tech.id, orgId, h, { q1: true, q2: true }); await classifyHazard(tech.id, orgId, h, { class: 'ccp', rationale: 'Этап устраняет опасность; последующих этапов нет.' }); }
  for (const s of [cookStep, coolStep]) await confirmStep(tech.id, orgId, s, { note: 'Проверено на месте с шеф-поваром' });
  await setMonitoring(tech.id, orgId, h1, { what: 'Температура в толще', method: 'Щуп в самой толстой части', frequency: 'каждая партия', criticalLimit: 'по утверждённому параметру выпуска', responsibleRole: 'chef', correctiveAction: ACTION_COOK, recordForm: 'J22' });
  await setMonitoring(tech.id, orgId, h2, { what: 'Температура и время охлаждения', method: 'Щуп: начало и конец', frequency: 'каждая партия', criticalLimit: 'по утверждённому параметру выпуска', responsibleRole: 'chef', correctiveAction: ACTION_COOL, recordForm: 'J23' });
  await approvePlan(owner.id, orgId, planId, { note: 'приказ о внедрении' });
  probe = (await createEquipment(chef.id, orgId, { siteId, name: 'Щуп ТЦ-2', kind: 'instrument', serialNo: '77', calibratedOn: orgDate(-30), calibrationDue: orgDate(300), calibrationDoc: 'Свидетельство № 1' })).id;
  oldProbe = (await createEquipment(chef.id, orgId, { siteId, name: 'Щуп старый', kind: 'instrument', calibratedOn: orgDate(-400), calibrationDue: orgDate(-2), calibrationDoc: 'Свидетельство № 0' })).id;
  boiled = await semi('Говядина отварная', [{ operation: 'Подготовка мяса' }, { operation: 'Варка до готовности', ccp_code: 'О-01' }]);
  chilled = await semi('Говядина охлаждённая', [{ operation: 'Варка', ccp_code: 'О-01' }, { operation: 'Шоковое охлаждение', ccp_code: 'О-02' }]);
});

describe('Требования к замерам — из ТТК и мониторинга плана ХАССП', () => {
  it('этап ТТК ссылается только на ККТ/ОПП утверждённого плана', async () => {
    const d = await createDish(chef.id, orgId, { name: 'Проба кода', kind: 'semi' });
    const v = (await getDish(chef.id, orgId, d.id)).current!.version.id;
    await expect(saveStages(chef.id, orgId, v, { stages: [{ operation: 'Жарка', state: 'semi', ccp_code: 'О-99' }] })).rejects.toThrow(/Нет в утверждённом плане ХАССП.*О-99/);
  });

  it('нет утверждённого предела → «не настроено», выпуск закрыт; утверждает право утверждения плана ХАССП', async () => {
    const id = await startOrder(boiled);
    const card = await getProduction(cook.id, orgId, id);
    expect(card.checks).toEqual([expect.objectContaining({ ccp_code: 'О-01', kind: 'core_temp', state: 'not_configured', reason: 'нет утверждённого предела для этого блюда' })]);
    await expect(release(id)).rejects.toThrow(/Выпуск закрыт: контроль ККТ не настроено.*нет утверждённого предела/);
    // вид замера — из формы мониторинга (J22), выбрать другой нельзя
    await expect(addReleaseCheck(haccp.id, orgId, boiled, { name: 'Температура в толще', min: 75, ccpCode: 'О-01', kind: 'cooling', basis: 'План ХАССП v1, О-01' })).rejects.toThrow(/форме J22/);
    const ck = await addReleaseCheck(haccp.id, orgId, boiled, { name: 'Температура в толще', min: 75, ccpCode: 'О-01', basis: 'План ХАССП v1, О-01; ТТК' });
    expect(ck).toMatchObject({ status: 'draft', kind: 'core_temp' });
    expect((await getProduction(cook.id, orgId, id)).checks[0]).toMatchObject({ state: 'not_configured', reason: 'предел «Температура в толще» ждёт утверждения' });
    await expect(approveReleaseCheck(haccp.id, orgId, ck.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await approveReleaseCheck(owner.id, orgId, ck.id);
    expect((await getProduction(cook.id, orgId, id)).checks[0]).toMatchObject({ state: 'ready', limits: 'не ниже 75 °C', corrective_action: ACTION_COOK, record_form: 'J22' });
  });

  it('выпуск без замера отклонён; щуп — только из реестра с действующей поверкой', async () => {
    const id = await startOrder(boiled);
    await expect(release(id)).rejects.toThrow(/Выпуск закрыт: нет замера — Температура в толще \(не ниже 75 °C\)/);
    const checkId = (await getProduction(cook.id, orgId, id)).checks[0].check!.id;
    await expect(recordCheck(cook.id, orgId, id, { checkId, value: 80 })).rejects.toThrow(/Выберите щуп/);
    await expect(recordCheck(cook.id, orgId, id, { checkId, value: 80, instrumentId: oldProbe })).rejects.toThrow(/поверка истекла/);
    await expect(recordCheck(cook.id, orgId, id, { checkId, value: 80, instrumentId: probe, measuredAt: new Date(Date.now() + 3600e3).toISOString() })).rejects.toThrow(/в будущем/);
    expect(await recordCheck(cook.id, orgId, id, { checkId, value: 82, valueBefore: 20, instrumentId: probe })).toMatchObject({ ok: true, corrective_action: null });
    const r = await release(id);
    expect(r).toMatchObject({ lot_status: 'available', ccp_deviation: null });
  });

  it('замер ниже предела → корректирующее действие плана сразу, партия в карантин, отклонение и CAPA', async () => {
    const id = await startOrder(boiled);
    const checkId = (await getProduction(cook.id, orgId, id)).checks[0].check!.id;
    const bad = await recordCheck(cook.id, orgId, id, { checkId, value: 68, instrumentId: probe });
    expect(bad).toMatchObject({ ok: false, corrective_action: ACTION_COOK });
    const inc = (await withSystem((tx) => tx.query(`select * from incidents where id = $1`, [bad.incident_id]))).rows[0];
    expect(inc).toMatchObject({ kind: 'release_check', severity: 'high', recommended_action: ACTION_COOK, rule_source: expect.stringContaining('План ХАССП v1, О-01') });
    const r = await release(id);
    expect(r).toMatchObject({ lot_status: 'quarantine', ccp_deviation: expect.stringContaining('Температура в толще 68 °C'), corrective_actions: [ACTION_COOK] });
    const lot = (await withSystem((tx) => tx.query(`select status, status_reason from lots where id = $1`, [r.lot_id]))).rows[0];
    expect(lot).toMatchObject({ status: 'quarantine', status_reason: expect.stringMatching(/^ККТ: последний замер вне предела/) });
    expect(r.capa_ids).toHaveLength(1);
    expect((await withSystem((tx) => tx.query(`select incident_id from capas where id = $1`, [r.capa_ids[0]]))).rows[0].incident_id).toBe(bad.incident_id);
  });

  it('охлаждение — два замера со временем: конец без начала нельзя, длительность из времени замеров', async () => {
    const cool = await addReleaseCheck(haccp.id, orgId, chilled, { name: 'Охлаждение в толще', max: 6, maxMinutes: 60, startMin: 60, ccpCode: 'О-02', basis: 'План ХАССП v1, О-02' });
    await expect(addReleaseCheck(haccp.id, orgId, chilled, { name: 'Охлаждение', max: 6, ccpCode: 'О-02', basis: 'План ХАССП v1, О-02' })).rejects.toThrow(/длительность/);
    const hot = await addReleaseCheck(haccp.id, orgId, chilled, { name: 'Температура в толще', min: 75, ccpCode: 'О-01', basis: 'План ХАССП v1, О-01' });
    await approveReleaseCheck(owner.id, orgId, cool.id); await approveReleaseCheck(owner.id, orgId, hot.id);
    const id = await startOrder(chilled);
    await recordCheck(cook.id, orgId, id, { checkId: hot.id, value: 85, instrumentId: probe });
    await expect(recordCheck(cook.id, orgId, id, { checkId: cool.id, value: 4, instrumentId: probe })).rejects.toThrow(/«начало» или «конец»/);
    await expect(recordCheck(cook.id, orgId, id, { checkId: cool.id, value: 4, phase: 'end', instrumentId: probe })).rejects.toThrow(/Сначала запишите начало/);
    const startAt = new Date(Date.now() - 50 * 60e3).toISOString();
    // время начала — фактическое (раньше старта задания нельзя): задание стартовало только что, поэтому сдвигаем старт
    await withSystem((tx) => tx.query(`update production_orders set started_at = now() - interval '2 hours' where id = $1`, [id]));
    expect(await recordCheck(cook.id, orgId, id, { checkId: cool.id, value: 72, phase: 'start', measuredAt: startAt, instrumentId: probe })).toMatchObject({ ok: true });
    await expect(release(id)).rejects.toThrow(/нет замера — Охлаждение в толще/);
    const end = await recordCheck(cook.id, orgId, id, { checkId: cool.id, value: 4, phase: 'end', instrumentId: probe });
    expect(end).toMatchObject({ ok: true, phase: 'end' });
    expect(end.minutes).toBeGreaterThanOrEqual(49.9);
    expect((await release(id)).lot_status).toBe('available');
  });
});

describe('Журналы J22–J24 — из замеров при выпуске', () => {
  it('J22 за период совпадает с замерами; ручная строка не принимается; основание — ТР ТС 021', async () => {
    const forms = listForms();
    for (const c of ['J22', 'J23', 'J24']) expect(forms.find((f) => f.code === c)).toMatchObject({ mode: 'auto' });
    const period = { siteId, from: orgDate(), to: orgDate() };
    const j = await getJournal(haccp.id, orgId, 'J22', period);
    const live = (await withSystem((tx) => tx.query(`select pc.value from production_checks pc join release_checks r on r.id = pc.check_id
      where pc.organization_id = $1 and r.kind = 'core_temp' and not exists (select 1 from production_checks x where x.corrects_id = pc.id) order by pc.measured_at`, [orgId]))).rows;
    expect(j.rows).toHaveLength(live.length);
    expect(j.rows.map((r) => r[5])).toEqual(live.map((x) => `${Number(x.value)} °C`));
    expect(j.rows.find((r) => r[5] === '68 °C')).toEqual(expect.arrayContaining(['нет', expect.stringContaining(ACTION_COOK), expect.stringMatching(/\(карантин\)$/), expect.stringMatching(/^щуп: Щуп ТЦ-2/)]));
    expect(j.form.basis.join(' ')).toMatch(/ТР ТС 021\/2011, ст\. 11/);
    expect(j.blockers.length).toBeGreaterThan(0);   // открытое отклонение ККТ периода — подписать нельзя
    const j23 = await getJournal(haccp.id, orgId, 'J23', period);
    expect(j23.rows).toEqual([expect.arrayContaining(['72 °C', '4 °C', expect.stringMatching(/соответствует, 5\d(,\d)? мин$/)])]);
    await expect(addEntry(cook.id, orgId, 'J22', { siteId, values: { 0: 'сегодня', 5: '80' } })).rejects.toThrow(/заполняется автоматически/);
  });

  it('исправление — новой записью с причиной: в журнале исправленное значение и было/причина; вне предела по выпущенной партии — карантин', async () => {
    const row = (await withSystem((tx) => tx.query(`select pc.id, o.output_lot_id from production_checks pc join production_orders o on o.id = pc.order_id
      join release_checks r on r.id = pc.check_id where pc.organization_id = $1 and r.kind = 'core_temp' and pc.value = 82`, [orgId]))).rows[0];
    await expect(correctCheck(cook.id, orgId, row.id, { value: 72, reason: 'опечатка при вводе, на щупе было 72' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(correctCheck(haccp.id, orgId, row.id, { value: 72, reason: 'ошибка' })).rejects.toThrow(/причину/);
    const r = await correctCheck(haccp.id, orgId, row.id, { value: 72, reason: 'опечатка при вводе, на щупе было 72' });
    expect(r).toMatchObject({ ok: false, lot_quarantined: true, corrective_action: ACTION_COOK });
    await expect(correctCheck(haccp.id, orgId, row.id, { value: 90, reason: 'повторное исправление старой записи' })).rejects.toThrow(/уже исправлен/);
    const j = await getJournal(haccp.id, orgId, 'J22', { siteId, from: orgDate(), to: orgDate() });
    expect(j.rows.find((x) => x[5] === '72 °C')![10]).toMatch(/исправлено \(было 82\): опечатка при вводе/);
    expect(j.rows.some((x) => x[5] === '82 °C')).toBe(false);
    expect((await withSystem((tx) => tx.query(`select status from lots where id = $1`, [row.output_lot_id]))).rows[0].status).toBe('quarantine');
  });
});
