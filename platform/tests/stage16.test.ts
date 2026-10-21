import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createControlObject } from '../src/server/ops/control';
import { recordMeasurement } from '../src/server/ops/measurements';
import { listStaff, getStaffCard, setMedical, setStaffSettings, recordHealthCheck, createTopic, recordBriefing, acknowledgeBriefing, archiveTopic } from '../src/server/ops/staff';
import { getJournal } from '../src/server/ops/journals';
import { getProblems } from '../src/server/ops/dashboard';
import { makeUser, lastLinkToken } from './helpers';

afterAll(() => closePool());

type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, chef: U, cook: U, cook2: U, haccp: U, accountant: U;
let orgId: string, siteId: string, fridge: string, otTopic: string, sanTopic: string;
const mskDay = (n: number) => new Date(Date.now() + n * 86400e3).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
const today = mskDay(0);
const period = { from: mskDay(-1), to: mskDay(1) };
const medOk = { medBookNo: 'ЛМК 77-123', examOn: mskDay(-30), examDue: mskDay(335), hygieneOn: mskDay(-30), hygieneDue: mskDay(700) };

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}
const row = async (uid: string) => (await listStaff(haccp.id, orgId, null)).staff.find((s) => s.user_id === uid)!;

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кафе «Персонал»' });
  orgId = r.organization.id; siteId = r.site.id;
  chef = await invite('chef'); cook = await invite('line_staff'); cook2 = await invite('line_staff'); haccp = await invite('haccp_lead'); accountant = await invite('accountant');
  fridge = (await createControlObject(owner.id, orgId, { siteId, name: 'Холодильник', kind: 'fridge' })).id;
});

describe('Этап 16: медицинский допуск', () => {
  it('даты ЛМК вносит и видит право «медицинский допуск»; шеф видит только статус', async () => {
    expect((await row(cook.id)).medical).toMatchObject({ status: 'missing', label: 'нет данных' });
    await expect(setMedical(chef.id, orgId, cook.id, medOk)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(setMedical(haccp.id, orgId, cook.id, { ...medOk, examDue: mskDay(-40) })).rejects.toThrow(/позже даты/);
    await setMedical(haccp.id, orgId, cook.id, medOk);
    expect((await row(cook.id)).medical).toMatchObject({ status: 'ok', exam_due: mskDay(335), med_book_no: 'ЛМК 77-123' });
    const chefView = (await listStaff(chef.id, orgId, null)).staff.find((s) => s.user_id === cook.id)!;
    expect(chefView.medical).toEqual({ status: 'ok', label: 'допущен', restrictions: null });
    await setMedical(haccp.id, orgId, cook2.id, { examDue: mskDay(10), hygieneDue: mskDay(400) });
    expect((await row(cook2.id)).medical.status).toBe('soon');
    await expect(listStaff(accountant.id, orgId, null)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // своя карточка — с датами
    expect((await getStaffCard(cook.id, orgId, cook.id)).medical).toMatchObject({ exam_due: mskDay(335) });
    await expect(getStaffCard(cook.id, orgId, cook2.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // аудит без дат о здоровье
    const a = (await withSystem((tx) => tx.query(`select after from audit_events where organization_id = $1 and action = 'staff.medical'`, [orgId]))).rows[0].after;
    expect(JSON.stringify(a)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('режим «блокировать»: без действующего допуска замер не принимается; «предупреждать» — только карточки', async () => {
    const cards = (await getProblems(chef.id, orgId, siteId)).cards;
    expect(cards.find((c) => c.key === `med:${chef.id}`)).toMatchObject({ title: expect.stringMatching(/Нет медицинского допуска/) });
    expect((await recordMeasurement(chef.id, orgId, { controlObjectId: fridge, value: 4 })).result).toBe('no_criterion');   // режим «предупреждать»
    await expect(setStaffSettings(chef.id, orgId, { medicalGate: 'block' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await setStaffSettings(haccp.id, orgId, { medicalGate: 'block' });
    await expect(recordMeasurement(chef.id, orgId, { controlObjectId: fridge, value: 4 })).rejects.toThrow(/Нет медицинского допуска: данные ЛМК не внесены/);
    expect((await recordMeasurement(cook.id, orgId, { controlObjectId: fridge, value: 4 })).result).toBe('no_criterion');
    expect((await recordMeasurement(haccp.id, orgId, { controlObjectId: fridge, value: 4 })).result).toBe('no_criterion');   // не пищевая роль
    await setStaffSettings(haccp.id, orgId, { medicalGate: 'off' });
    expect((await getProblems(chef.id, orgId, siteId)).cards.find((c) => c.key === `med:${chef.id}`)).toBeUndefined();
    await setStaffSettings(haccp.id, orgId, { medicalGate: 'block' });
  });
});

describe('Этап 16: осмотр перед сменой', () => {
  it('не допущен — с признаками и мерами; один раз в день; записи по продукции закрыты', async () => {
    await expect(recordHealthCheck(cook.id, orgId, cook2.id, { siteId, admitted: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(recordHealthCheck(chef.id, orgId, cook2.id, { siteId, admitted: false })).rejects.toThrow(/признаки/);
    await recordHealthCheck(chef.id, orgId, cook2.id, { siteId, admitted: false, signs: 'гнойничковое поражение кисти', action: 'отстранён, направлен к врачу' });
    await recordHealthCheck(chef.id, orgId, cook.id, { siteId, admitted: true });
    await expect(recordHealthCheck(chef.id, orgId, cook.id, { siteId, admitted: true })).rejects.toThrow(/уже записан/);
    await expect(recordMeasurement(cook2.id, orgId, { controlObjectId: fridge, value: 4 })).rejects.toThrow(/не допущены/);
    expect((await row(cook2.id)).today_check).toMatchObject({ admitted: false, signs: 'гнойничковое поражение кисти' });
    const j = await getJournal(chef.id, orgId, 'J07', { siteId, ...period });
    expect(j.rows.map((r) => r[5]).sort()).toEqual(['допущен', 'не допущен; отстранён, направлен к врачу']);
    await expect(withSystem((tx) => tx.query(`update health_checks set admitted = true where organization_id = $1`, [orgId]))).rejects.toThrow(/не изменяются/);
  });
});

describe('Этап 16: инструктажи', () => {
  it('тема с материалом и ролями; проведение группе; ознакомление — сам сотрудник; срок по периодичности', async () => {
    await expect(createTopic(cook.id, orgId, { title: 'Инструкция по ОТ', category: 'safety', material: 'ИОТ-01' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(createTopic(chef.id, orgId, { title: 'Инструкция по ОТ', category: 'safety', material: 'ИОТ-01', roles: ['повар'] })).rejects.toThrow(/Неизвестная роль/);
    otTopic = (await createTopic(chef.id, orgId, { title: 'Охрана труда повара', category: 'safety', material: 'ИОТ-01, ред. 2026', periodMonths: 6, roles: ['line_staff', 'chef'] })).id;
    sanTopic = (await createTopic(haccp.id, orgId, { title: 'Санитарный минимум', category: 'sanitary', material: 'Программа гигиенического обучения, ред. 1', periodMonths: 12 })).id;
    expect((await row(cook.id)).briefings.map((b) => [b.title, b.state])).toEqual([['Охрана труда повара', 'missing'], ['Санитарный минимум', 'missing']]);
    expect((await row(haccp.id)).briefings.map((b) => b.title)).toEqual(['Санитарный минимум']);      // ОТ повара — не для его роли
    expect((await getProblems(chef.id, orgId, siteId)).cards.find((c) => c.key === `brief:${cook.id}`)).toBeTruthy();
    await expect(recordBriefing(chef.id, orgId, { topicId: otTopic, userIds: [cook.id], briefingType: 'primary', heldOn: mskDay(1) })).rejects.toThrow(/будущем/);
    await expect(recordBriefing(chef.id, orgId, { topicId: otTopic, userIds: [cook.id], briefingType: 'primary', result: 'failed' })).rejects.toThrow(/повторить/);
    const r = await recordBriefing(chef.id, orgId, { topicId: otTopic, userIds: [cook.id, cook2.id], briefingType: 'primary' });
    const [y, mo, dd] = today.split('-').map(Number);
    expect(r.next_due).toBe(new Date(Date.UTC(y, mo - 1 + 6, dd)).toISOString().slice(0, 10));
    expect((await row(cook.id)).briefings[0]).toMatchObject({ state: 'unconfirmed', held_on: today });
    expect((await getProblems(cook.id, orgId, siteId)).cards.find((c) => c.key === `ack:${r.ids[0]}`)).toMatchObject({ title: 'Подтвердите ознакомление: Охрана труда повара' });
    await expect(acknowledgeBriefing(cook2.id, orgId, r.ids[0])).rejects.toThrow(/сам сотрудник/);
    await acknowledgeBriefing(cook.id, orgId, r.ids[0]);
    await expect(acknowledgeBriefing(cook.id, orgId, r.ids[0])).rejects.toThrow(/уже подтверждено/);
    expect((await row(cook.id)).briefings[0].state).toBe('ok');
    await recordBriefing(haccp.id, orgId, { topicId: sanTopic, userIds: [cook.id], briefingType: 'training', note: 'тест 18/20' });
    const j17 = await getJournal(chef.id, orgId, 'J17', { siteId, ...period });
    expect(j17.rows.map((x) => [x[3], x[4], x[6].startsWith('подтверждено') ? 'да' : x[6]]).sort()).toEqual([['Охрана труда повара', 'первичный', 'да'], ['Охрана труда повара', 'первичный', 'не подтверждено']]);
    const j16 = await getJournal(chef.id, orgId, 'J16', { siteId, ...period });
    expect(j16.rows).toHaveLength(1);
    expect(j16.rows[0][3]).toBe('Санитарный минимум (обучение)');
    const card = await getStaffCard(chef.id, orgId, cook.id);
    expect(card.history).toHaveLength(2);
    await archiveTopic(haccp.id, orgId, sanTopic);
    expect((await row(cook.id)).briefings.map((b) => b.title)).toEqual(['Охрана труда повара']);
  });
});
