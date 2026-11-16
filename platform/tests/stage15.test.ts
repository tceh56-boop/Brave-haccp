import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createControlObject } from '../src/server/ops/control';
import { recordMeasurement } from '../src/server/ops/measurements';
import { createEquipment, listEquipment, getEquipment, recordEvent, listInstruments, updateEquipment, retireEquipment } from '../src/server/ops/equipment';
import { createDisinfectant, approveDisinfectant, createPlan, listSanitation, recordDone, verifyRecord, archivePlan } from '../src/server/ops/sanitation';
import { getJournal } from '../src/server/ops/journals';
import { getProblems } from '../src/server/ops/dashboard';
import { makeUser, lastLinkToken } from './helpers';

afterAll(() => closePool());

type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, chef: U, cook: U, cook2: U, haccp: U, cashier: U;
let orgId: string, siteId: string, fridgeObj: string, fridge: string, thermo: string, oldThermo: string;
const mskDay = (n: number) => new Date(Date.now() + n * 86400e3).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
const today = mskDay(0);
const period = { from: mskDay(-1), to: mskDay(1) };

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кафе «Оборудование»' });
  orgId = r.organization.id; siteId = r.site.id;
  chef = await invite('chef'); cook = await invite('line_staff'); cook2 = await invite('line_staff'); haccp = await invite('haccp_lead'); cashier = await invite('cashier');
  fridgeObj = (await createControlObject(owner.id, orgId, { siteId, name: 'Холодильник №1', kind: 'fridge' })).id;
});

describe('Этап 15: реестр оборудования и поверка приборов', () => {
  it('реестр ведёт шеф; средство измерения — с документом о поверке', async () => {
    await expect(createEquipment(cook.id, orgId, { siteId, name: 'Холодильник', kind: 'cold' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    fridge = (await createEquipment(chef.id, orgId, { siteId, name: 'Холодильник Polair №1', kind: 'cold', serialNo: 'P-77', controlObjectId: fridgeObj, maintenanceDays: 90 })).id;
    await expect(createEquipment(chef.id, orgId, { siteId, name: 'Термометр-щуп', kind: 'instrument', calibrationDue: mskDay(200) })).rejects.toThrow(/документ о поверке/);
    thermo = (await createEquipment(chef.id, orgId, { siteId, name: 'Термометр-щуп ТЦ-1', kind: 'instrument', serialNo: '123', calibratedOn: mskDay(-100), calibrationDue: mskDay(200), calibrationDoc: 'Свидетельство № С-1/2026' })).id;
    oldThermo = (await createEquipment(chef.id, orgId, { siteId, name: 'Термометр старый', kind: 'instrument', calibrationDue: mskDay(-3), calibrationDoc: 'Свидетельство № С-0' })).id;
    const l = await listEquipment(cook.id, orgId, siteId);
    expect(l.find((e) => e.id === fridge)).toMatchObject({ measuring: false, usable: true, object_name: 'Холодильник №1', maintenance_due: mskDay(90) });
    expect(l.find((e) => e.id === thermo)).toMatchObject({ measuring: true, calibration: 'ok', usable: true });
    expect(l.find((e) => e.id === oldThermo)).toMatchObject({ calibration: 'expired', usable: false, reason: expect.stringMatching(/поверка истекла/) });
    await expect(listEquipment(cashier.id, orgId, siteId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('замер: прибор обязателен, если приборы есть; с истёкшей поверкой — не принимается', async () => {
    await expect(recordMeasurement(cook.id, orgId, { controlObjectId: fridgeObj, value: 4 })).rejects.toThrow(/Выберите прибор/);
    await expect(recordMeasurement(cook.id, orgId, { controlObjectId: fridgeObj, value: 4, instrumentId: oldThermo })).rejects.toThrow(/Измерение не принимается.*поверка истекла/);
    await expect(recordMeasurement(cook.id, orgId, { controlObjectId: fridgeObj, value: 4, instrumentId: fridge })).rejects.toThrow(/не средство измерения/);
    const m = await recordMeasurement(cook.id, orgId, { controlObjectId: fridgeObj, value: 4, instrumentId: thermo });
    expect(m.measurement).toMatchObject({ instrument_id: thermo, device: expect.stringMatching(/Термометр-щуп ТЦ-1, № 123, поверка до/) });
    expect((await listInstruments(cook.id, orgId, siteId)).map((i) => [i.name, i.usable])).toEqual([['Термометр старый', false], ['Термометр-щуп ТЦ-1', true]]);
    expect((await getProblems(chef.id, orgId, siteId)).cards.find((c) => c.key === `calib:${oldThermo}`)).toMatchObject({ title: 'Истекла поверка: Термометр старый' });
  });

  it('поверка — событием с документом и сроком; прибор снова пригоден', async () => {
    await expect(recordEvent(chef.id, orgId, oldThermo, { kind: 'calibration', description: 'Поверка в ЦСМ', nextDue: mskDay(365) })).rejects.toThrow(/документ о поверке/);
    await expect(recordEvent(chef.id, orgId, oldThermo, { kind: 'calibration', description: 'Поверка в ЦСМ', document: 'Свидетельство № С-2', nextDue: today })).rejects.toThrow(/позже даты/);
    await expect(recordEvent(chef.id, orgId, fridge, { kind: 'calibration', description: 'Поверка', document: 'С-3', nextDue: mskDay(365) })).rejects.toThrow(/не средство измерения/);
    await recordEvent(chef.id, orgId, oldThermo, { kind: 'calibration', description: 'Поверка в ЦСМ', document: 'Свидетельство № С-2', nextDue: mskDay(365), performer: 'ФБУ «ЦСМ»' });
    const g = await getEquipment(cook.id, orgId, oldThermo);
    expect(g.equipment).toMatchObject({ calibration_due: mskDay(365), calibration_doc: 'Свидетельство № С-2', usable: true });
    expect(g.events[0]).toMatchObject({ kind: 'calibration', kind_label: 'Поверка', document: 'Свидетельство № С-2' });
  });

  it('неисправность сообщает повар → «неисправно», отклонение; ремонт с допуском — шеф; ТО сдвигает срок', async () => {
    const b = await recordEvent(cook.id, orgId, fridge, { kind: 'breakdown', description: 'Не держит температуру, +12 °C', safetyImpact: 'мясо в камере — оценить партии' });
    expect(b.incident_id).toBeTruthy();
    const inc = (await withSystem((tx) => tx.query(`select kind, severity, title from incidents where id = $1`, [b.incident_id]))).rows[0];
    expect(inc).toMatchObject({ kind: 'equipment', severity: 'high', title: 'Неисправно: Холодильник Polair №1' });
    expect((await getEquipment(cook.id, orgId, fridge)).equipment).toMatchObject({ status: 'broken', status_label: 'Неисправно' });
    await expect(recordEvent(cook.id, orgId, fridge, { kind: 'repair', description: 'Заменён компрессор', admitted: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(recordEvent(chef.id, orgId, fridge, { kind: 'repair', description: 'Заменён компрессор' })).rejects.toThrow(/допущено/);
    await recordEvent(chef.id, orgId, fridge, { kind: 'repair', description: 'Заменён компрессор', performer: 'ООО «Холод-Сервис»', admitted: true });
    expect((await getEquipment(cook.id, orgId, fridge)).equipment.status).toBe('active');
    await recordEvent(chef.id, orgId, fridge, { kind: 'maintenance', description: 'Чистка конденсатора', happenedOn: mskDay(-1) });
    expect((await getEquipment(cook.id, orgId, fridge)).equipment.maintenance_due).toBe(mskDay(89));
    await expect(recordEvent(chef.id, orgId, fridge, { kind: 'maintenance', description: 'Чистка', happenedOn: mskDay(2) })).rejects.toThrow(/будущем/);
    const j = await getJournal(chef.id, orgId, 'J18', { siteId, ...period });
    expect(j.rows).toHaveLength(1);
    expect(j.rows[0].slice(1)).toEqual(['Холодильник Polair №1', 'Не держит температуру, +12 °C', 'мясо в камере — оценить партии', expect.any(String), 'ООО «Холод-Сервис»', 'Заменён компрессор', expect.any(String), 'допущено']);
    await expect(withSystem((tx) => tx.query(`update equipment_events set description = 'x' where equipment_id = $1`, [fridge]))).rejects.toThrow(/не изменяются/);
    await updateEquipment(chef.id, orgId, fridge, { inventoryNo: 'ИН-001' });
    await expect(retireEquipment(chef.id, orgId, oldThermo, { reason: '' })).rejects.toThrow(/причину/);
  });
});

describe('Этап 15: санитария', () => {
  let dis: string, noRange: string, plan: string, washPlan: string;
  it('дезсредство — с основанием; в план только утверждённое; замер концентрации — при заданном режиме', async () => {
    await expect(createDisinfectant(haccp.id, orgId, { name: 'Ника-Хлор', purpose: 'поверхности', basis: '' })).rejects.toThrow(/основание/);
    await expect(createDisinfectant(cook.id, orgId, { name: 'Ника-Хлор', purpose: 'поверхности', basis: 'Инструкция № 1' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    dis = (await createDisinfectant(haccp.id, orgId, { name: 'Ника-Хлор', purpose: 'поверхности, инвентарь', concentrationMin: '0,1', concentrationMax: '0,2', exposure: '30 мин',
      basis: 'Инструкция производителя № 12/2024, СГР RU.77…' })).id;
    noRange = (await createDisinfectant(haccp.id, orgId, { name: 'Моющее средство', purpose: 'посуда', basis: 'Инструкция производителя' })).id;
    await expect(createPlan(haccp.id, orgId, { siteId, area: 'Горячий цех', work: 'Дезинфекция столов', kind: 'disinfection', periodDays: 1, disinfectantId: dis, checkConcentration: true }))
      .rejects.toThrow(/не утверждён/);
    await approveDisinfectant(haccp.id, orgId, dis); await approveDisinfectant(haccp.id, orgId, noRange);
    await expect(createPlan(haccp.id, orgId, { siteId, area: 'Моечная', work: 'Мойка', kind: 'inventory', periodDays: 1, disinfectantId: noRange, checkConcentration: true })).rejects.toThrow(/не задана рабочая концентрация/);
    await expect(createPlan(cook.id, orgId, { siteId, area: 'Цех', work: 'Уборка', kind: 'current', periodDays: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    plan = (await createPlan(haccp.id, orgId, { siteId, area: 'Горячий цех', work: 'Дезинфекция производственных столов', kind: 'disinfection', periodDays: 1, disinfectantId: dis, checkConcentration: true, nextDue: mskDay(-1) })).id;
    washPlan = (await createPlan(chef.id, orgId, { siteId, area: 'Разделочные доски', work: 'Мытьё и обработка', kind: 'inventory', periodDays: 1, disinfectantId: noRange })).id;
    const l = await listSanitation(cook.id, orgId, siteId);
    expect(l.plans.find((p) => p.id === plan)).toMatchObject({ state: 'overdue', range: '0,1–0,2 %', kind_label: 'Дезинфекция' });
    expect(l.plans.find((p) => p.id === washPlan)).toMatchObject({ state: 'today' });
    expect((await getProblems(chef.id, orgId, siteId)).cards.find((c) => c.key === `san:${plan}`)).toMatchObject({ title: 'Просрочена уборка: Горячий цех' });
  });

  it('выполнение: концентрация обязательна; вне режима — отклонение и срок не сдвигается; в режиме — следующий срок', async () => {
    await expect(recordDone(cook.id, orgId, plan, {})).rejects.toThrow(/Измерьте концентрацию/);
    const bad = await recordDone(cook.id, orgId, plan, { concentration: '0,05' });
    expect(bad).toMatchObject({ result: 'deviation', next_due: mskDay(-1) });
    expect((await withSystem((tx) => tx.query(`select kind, title from incidents where id = $1`, [bad.incident_id]))).rows[0]).toMatchObject({ kind: 'sanitation', title: 'Концентрация вне режима: Ника-Хлор' });
    const ok = await recordDone(cook.id, orgId, plan, { concentration: 0.15 });
    expect(ok).toMatchObject({ result: 'done', incident_id: null, next_due: mskDay(1) });
    const w = await recordDone(cook.id, orgId, washPlan, { note: 'доски №1–4' });
    expect(w.result).toBe('done');
  });

  it('проверка — другим сотрудником; «не принято» — с замечанием и повтором сегодня', async () => {
    const l = await listSanitation(cook.id, orgId, siteId);
    const rec = l.records.find((r) => r.plan_id === plan && r.result === 'done')!;
    await expect(verifyRecord(cook.id, orgId, rec.id, { ok: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(verifyRecord(chef.id, orgId, rec.id, { ok: false })).rejects.toThrow(/замечание/);
    await verifyRecord(chef.id, orgId, rec.id, { ok: true });
    await expect(verifyRecord(haccp.id, orgId, rec.id, { ok: true })).rejects.toThrow(/уже проверена/);
    const wash = l.records.find((r) => r.plan_id === washPlan)!;
    await verifyRecord(chef.id, orgId, wash.id, { ok: false, note: 'на доске №3 остатки жира' });
    expect((await listSanitation(cook.id, orgId, siteId)).plans.find((p) => p.id === washPlan)).toMatchObject({ state: 'today' });
    // шеф выполнил сам — сам не проверяет
    const own = await recordDone(chef.id, orgId, washPlan, {});
    await expect(verifyRecord(chef.id, orgId, own.id, { ok: true })).rejects.toThrow(/другой сотрудник/);
    await expect(withSystem((tx) => tx.query(`delete from sanitation_records where id = $1`, [own.id]))).rejects.toThrow(/не изменяются/);
  });

  it('журналы J10, J09, J15 собираются из записей', async () => {
    const j10 = await getJournal(chef.id, orgId, 'J10', { siteId, ...period });
    expect(j10.rows.map((r) => [r[1], r[6]])).toEqual([['Горячий цех', 'нет — концентрация вне режима'], ['Горячий цех', 'да']]);
    expect(j10.rows[1][8]).toMatch(/принято/);
    const j09 = await getJournal(chef.id, orgId, 'J09', { siteId, ...period });
    expect(j09.rows.map((r) => r[6])).toEqual(['не принято: на доске №3 остатки жира', 'не проверено']);
    const j15 = await getJournal(chef.id, orgId, 'J15', { siteId, ...period });
    expect(j15.rows.map((r) => [r[2], r[3], r[4], r[6]])).toEqual([['Ника-Хлор', 'от 0,1 % до 0,2 %', '0,05 %', 'нет'], ['Ника-Хлор', 'от 0,1 % до 0,2 %', '0,15 %', 'да']]);
    expect(j15.blockers[0]).toMatch(/Концентрация вне режима/);
    await archivePlan(haccp.id, orgId, washPlan, { reason: 'доски заменены на одноразовые' });
    expect((await listSanitation(cook2.id, orgId, siteId)).plans.map((p) => p.id)).toEqual([plan]);
  });
});
