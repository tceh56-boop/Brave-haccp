import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, createSite, inviteMember, acceptInvitation, listAudit } from '../src/server/org/organizations';
import { createProduct, createSupplier } from '../src/server/ops/catalog';
import { createControlObject, createRule, approveRule, getControlObject } from '../src/server/ops/control';
import { recordMeasurement, correctMeasurement } from '../src/server/ops/measurements';
import { getIncident, takeIncident, recordIncidentAction, confirmIncident, reportProblem, listIncidents } from '../src/server/ops/incidents';
import { createReceipt, addReceiptLine, completeReceipt } from '../src/server/ops/receipts';
import { listLots, getLot, assertLotUsable, confirmLotExpiry, decideQuarantine, expiryState } from '../src/server/ops/lots';
import { listTasks, completeTask } from '../src/server/ops/tasks';
import { getProblems, getShift, listNotifications } from '../src/server/ops/dashboard';
import { makeUser, lastLinkToken } from './helpers';

afterAll(() => closePool());

type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, haccp: U, cook: U, chef: U, store: U;
let orgId: string, siteId: string, site2: string, fridgeId: string, productId: string, supplierId: string;

async function invite(role: string, siteIds: string[] = []) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role, siteIds });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}

const ALL_OK = { packaging: true, labeling: true, documents: true, quality: true };
const minutesAgo = (n: number) => new Date(Date.now() - n * 60e3).toISOString();
const inDays = (n: number) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);

beforeAll(async () => {
  owner = await makeUser({ name: 'Ольга Владелец' });
  const r = await createOrganization(owner, { name: 'Кафе «Смена»' });
  orgId = r.organization.id; siteId = r.site.id;
  site2 = (await createSite(owner.id, orgId, { name: 'Вторая точка' })).id;
  haccp = await invite('haccp_lead');
  chef = await invite('chef');
  cook = await invite('line_staff', [siteId]);
  store = await invite('storekeeper');
  fridgeId = (await createControlObject(owner.id, orgId, { siteId, name: 'Холодильник №1 (мясо)', kind: 'fridge' })).id;
  productId = (await createProduct(store.id, orgId, { name: 'Говядина охлаждённая', unit: 'кг', category: 'мясо' })).id;
  supplierId = (await createSupplier(store.id, orgId, { name: 'ООО «Мясной двор»', inn: '6670000000' })).id;
});

describe('Температуры: только утверждённые правила (ТЗ v2 §5, AT-04)', () => {
  it('без утверждённого правила замер сохраняется с результатом «критерий не задан»; проект правила не применяется', async () => {
    const m1 = await recordMeasurement(cook.id, orgId, { controlObjectId: fridgeId, value: '4,5' });
    expect(m1.result).toBe('no_criterion');
    await expect(createRule(haccp.id, orgId, { controlObjectId: fridgeId, maxValue: 6 })).rejects.toMatchObject({ code: 'VALIDATION' }); // без основания
    const draft = await createRule(haccp.id, orgId, { controlObjectId: fridgeId, minValue: 2, maxValue: 6, frequencyHours: 4,
      sourceRef: 'Процедура ПК-03 «Контроль холодильного оборудования», п. 2 (утв. 01.10.2026)', reaction: 'Повторить замер через 15 минут; проверить дверь и уплотнитель; при повторном отклонении — изолировать продукцию и сообщить ответственному.', allowIsolation: true });
    expect((await recordMeasurement(cook.id, orgId, { controlObjectId: fridgeId, value: 9 })).result).toBe('no_criterion');
    await expect(approveRule(cook.id, orgId, draft.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await approveRule(haccp.id, orgId, draft.id);
  });

  it('замер хранит значение, единицу, объект, автора, время измерения и время внесения', async () => {
    const r = await recordMeasurement(cook.id, orgId, { controlObjectId: fridgeId, value: 3.8 });
    expect(r.result).toBe('ok');
    expect(r.measurement).toMatchObject({ unit: '°C', control_object_id: fridgeId, author_user_id: cook.id, is_late: false });
    expect(Number(r.measurement.value)).toBe(3.8);
    expect(r.measurement.measured_at).toBeTruthy();
    expect(r.measurement.entered_at).toBeTruthy();
    expect(r.criterion).toMatch(/от 2 до 6 °C.*ПК-03/);
  });

  it('поздний ввод отмечается и требует пояснения; старше суток и в будущем — нельзя', async () => {
    await expect(recordMeasurement(cook.id, orgId, { controlObjectId: fridgeId, value: 4, measuredAt: minutesAgo(60) })).rejects.toThrow(/укажите в комментарии/);
    const late = await recordMeasurement(cook.id, orgId, { controlObjectId: fridgeId, value: 4, measuredAt: minutesAgo(60), comment: 'записано на бумаге, связь пропала' });
    expect(late.measurement.is_late).toBe(true);
    expect(new Date(late.measurement.entered_at).getTime() - new Date(late.measurement.measured_at).getTime()).toBeGreaterThan(55 * 60e3);
    await expect(recordMeasurement(cook.id, orgId, { controlObjectId: fridgeId, value: 4, measuredAt: minutesAgo(25 * 60), comment: 'задним числом' })).rejects.toThrow(/старше суток/);
    await expect(recordMeasurement(cook.id, orgId, { controlObjectId: fridgeId, value: 4, measuredAt: new Date(Date.now() + 3600e3).toISOString() })).rejects.toThrow(/будущем/);
  });

  it('замер нельзя изменить или удалить; исправление — новая запись с причиной и аудитом (AT-11)', async () => {
    const r = await recordMeasurement(cook.id, orgId, { controlObjectId: fridgeId, value: 5 });
    await expect(withSystem((tx) => tx.query(`update measurements set value = 1 where id = $1`, [r.measurement.id]))).rejects.toThrow(/нельзя изменить/);
    await expect(withSystem((tx) => tx.query(`delete from measurements where id = $1`, [r.measurement.id]))).rejects.toThrow(/нельзя изменить/);
    const fix = await correctMeasurement(cook.id, orgId, r.measurement.id, { value: 5.5, reason: 'опечатка при вводе' });
    expect(fix.corrects_id).toBe(r.measurement.id);
    await expect(correctMeasurement(cook.id, orgId, r.measurement.id, { value: 6, reason: 'ещё раз' })).rejects.toMatchObject({ code: 'CONFLICT' });
    const ev = (await listAudit(owner.id, orgId, { limit: 200 })).find((e) => e.action === 'measurement.correct')!;
    expect(ev.before.value).toBe(5);
    expect(ev.after.value).toBe(5.5);
  });
});

describe('Отклонение → инцидент, задача, уведомление; закрытие с подтверждением (ТЗ v2 §2, §5, AT-05)', () => {
  let incidentId: string;
  let lotInFridge: string;

  it('выход за предел создаёт один инцидент, задачу и уведомления; повтор не плодит дубли', async () => {
    const rec = await createReceipt(store.id, orgId, { siteId, supplierId });
    await addReceiptLine(store.id, orgId, rec.id, { productId, quantity: 12.5, lotNo: 'M-0412', expiresAt: inDays(5), expiryBasis: 'маркировка изготовителя', checks: ALL_OK, decision: 'accepted', storageObjectId: fridgeId, temperature: 3 });
    await completeReceipt(store.id, orgId, rec.id);
    lotInFridge = (await listLots(store.id, orgId, siteId)).find((l) => l.lot_no === 'M-0412')!.id;

    const r = await recordMeasurement(cook.id, orgId, { controlObjectId: fridgeId, value: 9.2 });
    expect(r.result).toBe('deviation');
    incidentId = r.incidentId!;
    const again = await recordMeasurement(cook.id, orgId, { controlObjectId: fridgeId, value: 9.4 });
    expect(again.incidentId).toBe(incidentId);
    const open = (await listIncidents(owner.id, orgId, { open: true })).filter((i) => i.kind === 'temperature_deviation');
    expect(open).toHaveLength(1);
    const { incident, events, lots } = await getIncident(haccp.id, orgId, incidentId);
    expect(incident).toMatchObject({ status: 'new', responsible_role: 'haccp_lead', rule_source: expect.stringContaining('ПК-03') });
    expect(incident.recommended_action).toMatch(/Повторить замер/);
    expect(events.map((e) => e.event)).toEqual(['created', 'repeat']);
    expect(lots.map((l) => l.id)).toContain(lotInFridge);
    expect((await listTasks(haccp.id, orgId)).some((t) => t.kind === 'incident' && t.entity_id === incidentId)).toBe(true);
    expect((await listNotifications(haccp.id, orgId)).some((n) => n.entity_id === incidentId)).toBe(true);
    expect((await listNotifications(chef.id, orgId)).some((n) => n.entity_id === incidentId)).toBe(true);
  });

  it('нормальный повторный замер не закрывает отклонение сам', async () => {
    await recordMeasurement(cook.id, orgId, { controlObjectId: fridgeId, value: 4.1 });
    const { incident, events } = await getIncident(haccp.id, orgId, incidentId);
    expect(incident.status).toBe('new');
    expect(events.at(-1)!.event).toBe('remeasure_ok');
  });

  it('сотрудник цеха не работает с отклонением; изоляция — только по процедуре; закрывает другой ответственный', async () => {
    await expect(takeIncident(cook.id, orgId, incidentId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await takeIncident(haccp.id, orgId, incidentId);
    const res = await recordIncidentAction(haccp.id, orgId, incidentId, { note: 'Дверь была неплотно закрыта, уплотнитель заменён; продукция изолирована до решения.', isolateLots: true });
    expect(res).toMatchObject({ status: 'pending_review', isolated: 1 });
    expect((await getLot(store.id, orgId, lotInFridge)).lot.status).toBe('quarantine');
    await expect(confirmIncident(haccp.id, orgId, incidentId, {})).rejects.toThrow(/другой ответственный/);
    await expect(confirmIncident(cook.id, orgId, incidentId, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await confirmIncident(chef.id, orgId, incidentId, { note: 'проверено на месте' });
    const done = await getIncident(owner.id, orgId, incidentId);
    expect(done.incident.status).toBe('closed');
    expect((await listTasks(haccp.id, orgId)).some((t) => t.entity_id === incidentId)).toBe(false);
  });

  it('закрыть отклонение без записанного действия нельзя даже напрямую в базе', async () => {
    const r = await reportProblem(cook.id, orgId, { siteId, what: 'Течёт кран в моечной, вода на полу' });
    await expect(withSystem((tx) => tx.query(`update incidents set status = 'closed' where id = $1`, [r.id]))).rejects.toThrow(/check constraint/);
  });
});

describe('Приёмка одной операцией (ТЗ v2 §4, §12, AT-01, AT-02, AT-03)', () => {
  it('принять можно только при пройденных проверках; истёкший срок не принимается', async () => {
    const rec = await createReceipt(store.id, orgId, { siteId, supplierId, documentNo: 'УПД-17' });
    await expect(addReceiptLine(store.id, orgId, rec.id, { productId, quantity: 1, checks: { ...ALL_OK, documents: false }, decision: 'accepted' })).rejects.toThrow(/Документы/);
    await expect(addReceiptLine(store.id, orgId, rec.id, { productId, quantity: 1, checks: ALL_OK, decision: 'quarantine' })).rejects.toThrow(/причину карантина/);
    await expect(addReceiptLine(store.id, orgId, rec.id, { productId, quantity: 1, checks: ALL_OK, decision: 'accepted', expiresAt: inDays(-1), expiryBasis: 'маркировка изготовителя' })).rejects.toThrow(/истёк/);
    await expect(addReceiptLine(store.id, orgId, rec.id, { productId, quantity: 1, checks: ALL_OK, decision: 'accepted', expiresAt: inDays(3) })).rejects.toThrow(/основание/);
  });

  it('завершение создаёт партии, задачи «срок не подтверждён», отклонение по карантину и аудит', async () => {
    const rec = await createReceipt(store.id, orgId, { siteId, supplierId, documentNo: 'УПД-18' });
    await addReceiptLine(store.id, orgId, rec.id, { productId, quantity: 4, lotNo: 'A-1', expiresAt: inDays(6), expiryBasis: 'маркировка изготовителя', checks: ALL_OK, decision: 'accepted', storageObjectId: fridgeId });
    await addReceiptLine(store.id, orgId, rec.id, { productId, quantity: 2, lotNo: 'A-2', checks: ALL_OK, decision: 'accepted' });
    await addReceiptLine(store.id, orgId, rec.id, { productId, quantity: 3, lotNo: 'A-3', expiresAt: inDays(6), expiryBasis: 'маркировка изготовителя', checks: { ...ALL_OK, packaging: false }, decision: 'quarantine', decisionReason: 'повреждена вакуумная упаковка', temperature: 7 });
    await addReceiptLine(store.id, orgId, rec.id, { productId, quantity: 1, lotNo: 'A-4', checks: { ...ALL_OK, quality: false }, decision: 'rejected', decisionReason: 'посторонний запах' });
    const res = await completeReceipt(store.id, orgId, rec.id);
    expect(res).toMatchObject({ status: 'quarantine', lots: 3, quarantine: 1, rejected: 1, unconfirmed: 1, incidents: 1 });
    await expect(completeReceipt(store.id, orgId, rec.id)).rejects.toMatchObject({ code: 'CONFLICT' });

    const lots = await listLots(store.id, orgId, siteId);
    const a1 = lots.find((l) => l.lot_no === 'A-1')!, a2 = lots.find((l) => l.lot_no === 'A-2')!, a3 = lots.find((l) => l.lot_no === 'A-3')!;
    expect(lots.find((l) => l.lot_no === 'A-4')).toBeUndefined();
    expect(a1).toMatchObject({ status: 'available', expiry_state: 'ok', expiry_label: 'В норме' });
    expect(a2).toMatchObject({ status: 'available', expiry_state: 'unconfirmed', expiry_label: 'Срок не подтверждён' });
    expect(a2.expires_at).toBeNull(); // система срок не выдумала
    expect(a3.status).toBe('quarantine');

    expect(() => assertLotUsable(a1)).not.toThrow();
    expect(() => assertLotUsable(a2)).toThrow(/не подтверждён/);
    expect(() => assertLotUsable(a3)).toThrow(/карантине/);

    const tasks = await listTasks(owner.id, orgId, { all: true });
    expect(tasks.find((t) => t.kind === 'confirm_expiry' && t.entity_id === a2.id)).toMatchObject({ assignee_role: 'chef', href: `/app/${orgId}/lots/${a2.id}` });
    expect(tasks.some((t) => t.kind === 'quarantine_decision' && t.entity_id === a3.id)).toBe(true);
    const confirmTask = tasks.find((t) => t.kind === 'confirm_expiry' && t.entity_id === a2.id)!;
    await expect(completeTask(chef.id, orgId, confirmTask.id, { result: 'готово' })).rejects.toThrow(/подтверждён срок/);

    await confirmLotExpiry(chef.id, orgId, a2.id, { expiresAt: new Date(Date.now() + 4 * 86400e3).toISOString(), basis: 'маркировка изготовителя на этикетке' });
    expect((await getLot(chef.id, orgId, a2.id)).lot.expiry_state).toBe('ok');
    expect((await listTasks(owner.id, orgId, { all: true })).some((t) => t.id === confirmTask.id)).toBe(false);

    await expect(decideQuarantine(cook.id, orgId, a3.id, { decision: 'release', reason: 'проверено' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await decideQuarantine(haccp.id, orgId, a3.id, { decision: 'reject', reason: 'упаковка нарушена, возврат поставщику' });
    expect((await getLot(haccp.id, orgId, a3.id)).lot.status).toBe('blocked');

    const actions = (await listAudit(owner.id, orgId, { limit: 200 })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['receipt.complete', 'lot.expiry_confirm', 'lot.reject', 'incident.create']));
  });

  it('статус срока: в норме / скоро / истёк / не подтверждён', () => {
    const now = new Date('2026-10-20T12:00:00Z');
    expect(expiryState({ expires_at: '2026-10-25T00:00:00Z', expiry_basis: 'маркировка' }, now)).toBe('ok');
    expect(expiryState({ expires_at: '2026-10-21T06:00:00Z', expiry_basis: 'маркировка' }, now)).toBe('soon');
    expect(expiryState({ expires_at: '2026-10-20T11:00:00Z', expiry_basis: 'маркировка' }, now)).toBe('expired');
    expect(expiryState({ expires_at: '2026-10-25T00:00:00Z', expiry_basis: null }, now)).toBe('unconfirmed');
    expect(expiryState({ expires_at: null }, now)).toBe('unconfirmed');
  });
});

describe('Дашборд проблем (ТЗ v2 §2, AT-06)', () => {
  it('карточки упорядочены по приоритету и ведут на конкретный объект с действием', async () => {
    const shelf = await createControlObject(owner.id, orgId, { siteId, name: 'Склад сухой', kind: 'room' });
    const rule = await createRule(haccp.id, orgId, { controlObjectId: shelf.id, maxValue: 25, frequencyHours: 12, sourceRef: 'Процедура ПК-05 «Склад», п. 1' });
    await approveRule(haccp.id, orgId, rule.id);

    // Партия, у которой срок «истёк» (имитация хода времени): заблокируется с отклонением при открытии дашборда.
    const rec = await createReceipt(store.id, orgId, { siteId, supplierId });
    await addReceiptLine(store.id, orgId, rec.id, { productId, quantity: 1, lotNo: 'OLD-1', expiresAt: inDays(2), expiryBasis: 'маркировка изготовителя', checks: ALL_OK, decision: 'accepted' });
    await completeReceipt(store.id, orgId, rec.id);
    const old = (await listLots(store.id, orgId, siteId)).find((l) => l.lot_no === 'OLD-1')!;
    await withSystem((tx) => tx.query(`update lots set expires_at = now() - interval '1 hour' where id = $1`, [old.id]));

    const { cards } = await getProblems(chef.id, orgId, siteId);
    const missed = cards.find((c) => c.key === `missed:${shelf.id}`)!;
    expect(missed).toMatchObject({ priority: 5, action: 'Внести замер', href: `/app/${orgId}/objects/${shelf.id}`, source: expect.stringContaining('ПК-05') });
    const expired = cards.find((c) => c.title.startsWith('Истёк срок'))!;
    expect(expired).toMatchObject({ priority: 2, href: expect.stringMatching(new RegExp(`^/app/${orgId}/incidents/`)) });
    expect((await getLot(chef.id, orgId, old.id)).lot.status).toBe('blocked');
    expect(() => assertLotUsable({ status: 'available', expires_at: new Date(Date.now() - 1000), expiry_basis: 'маркировка' })).toThrow(/истёк/);
    const prio = cards.map((c) => c.priority);
    expect(prio).toEqual([...prio].sort((a, b) => a - b));
    for (const c of cards) expect(c.href).toMatch(new RegExp(`^/app/${orgId}/(objects|lots|incidents|tasks)`));

    // Повторное открытие дашборда не создаёт второго отклонения по той же партии.
    await getProblems(chef.id, orgId, siteId);
    expect((await listIncidents(owner.id, orgId)).filter((i) => i.kind === 'expired_lot' && i.entity_id === old.id)).toHaveLength(1);
  });

  it('экран смены: объекты с состоянием замера, мои задачи', async () => {
    const s = await getShift(cook.id, orgId, siteId);
    expect(s.objects.find((o) => o.id === fridgeId)).toMatchObject({ criterion: 'от 2 до 6 °C', due: { state: 'ok' } });
    expect(typeof s.myTasks).toBe('number');
  });
});

describe('Изоляция и область доступа на этапе 2', () => {
  it('чужая организация и чужая площадка недоступны', async () => {
    const stranger = await makeUser();
    await createOrganization(stranger, { name: 'Чужое кафе' });
    await expect(recordMeasurement(stranger.id, orgId, { controlObjectId: fridgeId, value: 3 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getControlObject(stranger.id, orgId, fridgeId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const other = await createControlObject(owner.id, orgId, { siteId: site2, name: 'Холодильник на второй точке', kind: 'fridge' });
    await expect(recordMeasurement(cook.id, orgId, { controlObjectId: other.id, value: 3 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(getShift(cook.id, orgId, site2)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
