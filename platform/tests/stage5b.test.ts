import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, createSite, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createControlObject, createRule, approveRule } from '../src/server/ops/control';
import { recordMeasurement } from '../src/server/ops/measurements';
import { getIncident, takeIncident, recordIncidentAction, confirmIncident } from '../src/server/ops/incidents';
import { listTasks } from '../src/server/ops/tasks';
import { getPlan, createPlan, addStep, confirmStep, addHazard, updateHazard, answerTree, classifyHazard, setMonitoring, approvePlan, treeProposal } from '../src/server/ops/haccp';
import { createCapa, updateCapa, completeCapa, verifyCapa, getCapa, listCapas } from '../src/server/ops/capa';
import { addEvidence, listEvidence, getEvidenceFile } from '../src/server/ops/evidence';
import { buildPack } from '../src/server/ops/pack';
import { getJournal } from '../src/server/ops/journals';
import { makeUser, lastLinkToken } from './helpers';

afterAll(() => closePool());

type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, haccp: U, tech: U, chef: U, cook: U, cook2: U, stranger: U;
let orgId: string, siteId: string, site2: string, fridgeId: string, ruleId: string;
let planId: string, hz1: string, hz2: string;
const steps: Record<string, string> = {};

async function invite(role: string, siteIds: string[] = []) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role, siteIds });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
const P = () => ({ siteId, from: today, to: today });
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('фото холодильника')]);
const PDF = Buffer.from('%PDF-1.4\n% накладная\n');

beforeAll(async () => {
  owner = await makeUser({ name: 'Ольга Владелец' });
  const r = await createOrganization(owner, { name: 'Кафе «План»' });
  orgId = r.organization.id; siteId = r.site.id;
  site2 = (await createSite(owner.id, orgId, { name: 'Вторая точка' })).id;
  haccp = await invite('haccp_lead');
  tech = await invite('technologist');
  chef = await invite('chef');
  cook = await invite('line_staff', [siteId]);
  cook2 = await invite('line_staff', [site2]);
  stranger = await makeUser();
  await createOrganization(stranger, { name: 'Чужое кафе' });
  fridgeId = (await createControlObject(owner.id, orgId, { siteId, name: 'Камера мяса', kind: 'fridge' })).id;
  ruleId = (await createRule(haccp.id, orgId, { controlObjectId: fridgeId, minValue: 0, maxValue: 4, frequencyHours: 4,
    sourceRef: 'Процедура ПК-03, п. 2', reaction: 'Повторить замер; при подтверждении — изолировать продукцию и сообщить ответственному.', allowIsolation: true })).id;
});

describe('Дерево решений: предложение системы, решение человека', () => {
  it('ветки дерева', () => {
    expect(treeProposal({})).toBeNull();
    expect(treeProposal({ q1: true, q2: true })).toBe('ccp');
    expect(treeProposal({ q1: true, q2: false, q3: false })).toBe('not_ccp');
    expect(treeProposal({ q1: true, q2: false, q3: true, q4: true })).toBe('not_ccp');
    expect(treeProposal({ q1: true, q2: false, q3: true, q4: false })).toBe('ccp');
    expect(treeProposal({ q1: false, q1a: true })).toBe('modify_step');
    expect(treeProposal({ q1: true, q2: false, q3: true })).toBeNull();
  });
});

describe('План ХАССП (ТЗ v1 §10): этапы → опасности → класс → мониторинг → утверждение', () => {
  it('ведёт технолог/ответственный ХАССП; шеф не ведёт; пустой план не утверждается', async () => {
    await expect(createPlan(chef.id, orgId, { scope: 'Горячий цех' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const p = await createPlan(tech.id, orgId, { scope: 'Блюда горячего цеха, хранение сырья; площадка «Основная»', team: 'технолог, ответственный ХАССП, шеф' });
    planId = p.id;
    await expect(createPlan(tech.id, orgId, { scope: 'ещё один план' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(approvePlan(owner.id, orgId, planId, {})).rejects.toThrow(/Нет этапов процесса.*Не внесено ни одной опасности/);
    expect((await getPlan(chef.id, orgId)).current!.plan.status_label).toBe('Проект');
  });

  it('опасности: класс назначает человек с обоснованием, система только предлагает', async () => {
    for (const name of ['Приёмка сырья', 'Хранение в холоде', 'Тепловая обработка']) steps[name] = (await addStep(tech.id, orgId, planId, { name })).id;
    hz1 = (await addHazard(tech.id, orgId, planId, { stepId: steps['Тепловая обработка'], hazardType: 'biological', description: 'Выживание патогенов (сальмонелла) при недостаточной термообработке мяса птицы' })).id;
    hz2 = (await addHazard(tech.id, orgId, planId, { stepId: steps['Хранение в холоде'], hazardType: 'biological', description: 'Рост микроорганизмов при нарушении температуры хранения мяса',
      likelihood: 2, severity: 3, controlMeasures: 'Хранение 0…+4 °C, контроль температуры камеры' })).id;
    const plan = (await getPlan(tech.id, orgId)).current!;
    expect(plan.hazards.map((h) => h.code)).toEqual(['О-01', 'О-02']);
    expect(plan.hazards[0]).toMatchObject({ risk: 'не оценено', class: null, proposal: null });

    await expect(classifyHazard(tech.id, orgId, hz1, { class: 'ccp', rationale: 'по дереву решений — ККТ' })).rejects.toThrow(/оцените вероятность/);
    await updateHazard(tech.id, orgId, hz1, { stepId: steps['Тепловая обработка'], hazardType: 'biological', description: 'Выживание патогенов (сальмонелла) при недостаточной термообработке мяса птицы',
      likelihood: 3, severity: 3, controlMeasures: 'Термообработка до температуры в толще по ТТК, контроль щупом' });
    // ответ на неактуальную ветку отбрасывается
    expect((await answerTree(tech.id, orgId, hz1, { q1: false, q2: true })).answers).toEqual({ q1: false });
    expect((await answerTree(tech.id, orgId, hz1, { q1: true, q2: true })).proposal).toBe('ccp');
    await classifyHazard(tech.id, orgId, hz1, { class: 'ccp', rationale: 'Этап устраняет опасность; последующих этапов нет.' });

    expect((await answerTree(tech.id, orgId, hz2, { q1: true, q2: false, q3: true, q4: true })).proposal).toBe('not_ccp');
    await expect(classifyHazard(tech.id, orgId, hz2, { class: 'ccp', rationale: 'считаем ККТ' })).rejects.toThrow(/расходится с деревом решений/);
    await classifyHazard(tech.id, orgId, hz2, { class: 'oprp', rationale: 'Значимая опасность, управляется программой контроля температуры камеры; критического предела этапа нет.' });

    // изменение оценки снимает решение
    const r = await updateHazard(tech.id, orgId, hz2, { stepId: steps['Хранение в холоде'], hazardType: 'biological', description: 'Рост микроорганизмов при нарушении температуры хранения мяса',
      likelihood: 3, severity: 3, controlMeasures: 'Хранение 0…+4 °C, контроль температуры камеры' });
    expect(r.classReset).toBe(true);
    await classifyHazard(tech.id, orgId, hz2, { class: 'oprp', rationale: 'Значимая опасность, управляется программой контроля температуры камеры; критического предела этапа нет.' });
  });

  it('утверждение: подтверждение на месте, мониторинг, предел ККТ, утверждённое правило; утверждает руководитель', async () => {
    const b = (await getPlan(tech.id, orgId)).current!.blockers.join(' ');
    expect(b).toMatch(/не подтверждён на месте/);
    expect(b).toMatch(/О-01.*нет плана мониторинга/);
    for (const id of Object.values(steps)) await confirmStep(tech.id, orgId, id, { note: 'Проверено на месте с шеф-поваром, схема совпадает' });
    await setMonitoring(tech.id, orgId, hz1, { what: 'Температура в толще продукта', method: 'Щуп-термометр в самой толстой части', frequency: 'каждая партия', responsibleRole: 'chef', correctiveAction: 'Продолжить обработку до достижения предела; партию без достижения — не выпускать.', recordForm: 'J22' });
    await setMonitoring(tech.id, orgId, hz2, { what: 'Температура камеры', method: 'Термометр камеры', frequency: 'каждые 4 часа', responsibleRole: 'line_staff', correctiveAction: 'По процедуре ПК-03', controlRuleId: ruleId, recordForm: 'J01' });
    const b2 = (await getPlan(tech.id, orgId)).current!.blockers.join(' ');
    expect(b2).toMatch(/для ККТ не указан критический предел/);
    expect(b2).toMatch(/правило контроля не утверждено/);
    await setMonitoring(tech.id, orgId, hz1, { what: 'Температура в толще продукта', method: 'Щуп-термометр в самой толстой части', frequency: 'каждая партия', criticalLimit: 'по утверждённой ТТК (вносит технолог)', responsibleRole: 'chef', correctiveAction: 'Продолжить обработку до достижения предела; партию без достижения — не выпускать.', recordForm: 'J22' });
    await approveRule(haccp.id, orgId, ruleId);
    expect((await getPlan(tech.id, orgId)).current!.blockers).toEqual([]);
    await expect(approvePlan(tech.id, orgId, planId, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await approvePlan(owner.id, orgId, planId, { note: 'утверждено приказом' });
    expect((await getPlan(chef.id, orgId)).current!.plan).toMatchObject({ status: 'approved', version: 1 });
  });

  it('утверждённый план не правится ни через систему, ни напрямую в базе', async () => {
    await expect(addStep(tech.id, orgId, planId, { name: 'Порционирование' })).rejects.toThrow(/новой версией/);
    await expect(withSystem((tx) => tx.query(`update haccp_hazards set class = 'prp' where id = $1`, [hz1]))).rejects.toThrow(/новой версией/);
    await expect(withSystem((tx) => tx.query(`update haccp_plans set scope = 'x' where id = $1`, [planId]))).rejects.toThrow(/новой версией/);
  });

  it('реестры J30–J32 из утверждённого плана', async () => {
    const j31 = await getJournal(chef.id, orgId, 'J31', P());
    expect(j31.rows).toHaveLength(2);
    expect(j31.rows[0]).toEqual(expect.arrayContaining(['О-01', 'Тепловая обработка', 'Биологическая', 'ККТ']));
    const j32 = await getJournal(chef.id, orgId, 'J32', P());
    expect(j32.rows).toHaveLength(2);
    expect(j32.rows.find((r) => r[0] === 'О-02')![4]).toMatch(/по правилу: от 0 до 4/);
    expect((await getJournal(chef.id, orgId, 'J30', P())).rows).toHaveLength(1);
  });

  it('новая версия: копия с причиной; после утверждения прежняя — «Заменён»', async () => {
    await expect(createPlan(tech.id, orgId, {})).rejects.toThrow(/причину/);
    const v2 = await createPlan(tech.id, orgId, { changeReason: 'Добавлен этап порционирования' });
    expect(v2.version).toBe(2);
    await addStep(tech.id, orgId, v2.id, { name: 'Порционирование' });
    const cur = (await getPlan(tech.id, orgId)).current!;
    expect(cur.hazards).toHaveLength(2);
    expect(cur.hazards.every((h) => h.monitoring)).toBe(true);
    expect(cur.blockers.join(' ')).toMatch(/«Порционирование» не подтверждён/);
    await confirmStep(tech.id, orgId, cur.steps.find((s) => s.name === 'Порционирование')!.id, { note: 'Проверено на месте' });
    await approvePlan(owner.id, orgId, v2.id, {});
    const all = await getPlan(chef.id, orgId);
    expect(all.versions.map((v) => `${v.version}:${v.status}`)).toEqual(['2:approved', '1:superseded']);
    expect((await getJournal(chef.id, orgId, 'J30', P())).rows).toHaveLength(2);
  });
});

describe('CAPA: отклонение → причина → действия → проверка эффективности другим человеком', () => {
  let incidentId: string, capaId: string;

  it('отклонение высокого риска после закрытия открывает CAPA', async () => {
    const m = await recordMeasurement(cook.id, orgId, { controlObjectId: fridgeId, value: 8.5 });
    incidentId = m.incidentId!;
    await takeIncident(haccp.id, orgId, incidentId);
    await recordIncidentAction(haccp.id, orgId, incidentId, { note: 'Дверь камеры закрыта, уплотнитель заменён.' });
    const res = await confirmIncident(chef.id, orgId, incidentId, {});
    capaId = res.capaId!;
    expect(capaId).toBeTruthy();
    expect((await getIncident(owner.id, orgId, incidentId)).capa).toMatchObject({ id: capaId, status: 'open' });
    expect((await createCapa(haccp.id, orgId, { incidentId })).id).toBe(capaId);
    expect((await listTasks(haccp.id, orgId)).some((t) => t.kind === 'capa' && t.entity_id === capaId && t.href.endsWith(`/capa/${capaId}`))).toBe(true);
    await expect(createCapa(cook.id, orgId, { incidentId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('выполнить без причины и критерия нельзя; проверяет не исполнитель; неэффективно — снова в работу', async () => {
    await expect(completeCapa(haccp.id, orgId, capaId, { note: 'сделано всё' })).rejects.toThrow(/причина.*критерий эффективности/);
    await updateCapa(haccp.id, orgId, capaId, { rootCause: 'Износ уплотнителя двери; замена не была запланирована', correctiveAction: 'Замена уплотнителя',
      preventiveAction: 'Осмотр уплотнителей раз в месяц в графике ТО', effectivenessCriterion: 'Нет отклонений температуры камеры 14 дней', responsibleUserId: haccp.id, dueAt: today, checkDueAt: today });
    await completeCapa(haccp.id, orgId, capaId, { note: 'Уплотнитель заменён, осмотр включён в график' });
    await expect(updateCapa(haccp.id, orgId, capaId, { rootCause: 'другое' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(verifyCapa(haccp.id, orgId, capaId, { effective: true, note: 'проверил сам' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await verifyCapa(chef.id, orgId, capaId, { effective: false, note: 'Было повторное отклонение через 5 дней' });
    expect((await getCapa(owner.id, orgId, capaId)).capa.status).toBe('in_progress');
    await completeCapa(haccp.id, orgId, capaId, { note: 'Заменён также датчик двери' });
    await verifyCapa(chef.id, orgId, capaId, { effective: true, note: 'Отклонений 14 дней нет (J01)' });
    const c = await getCapa(owner.id, orgId, capaId);
    expect(c.capa.status_label).toBe('Закрыто');
    expect(c.events.map((e) => e.event)).toEqual(['created', 'updated', 'done', 'ineffective', 'done', 'effective']);
    expect((await listCapas(cook.id, orgId).catch((e) => e)).code).toBe('FORBIDDEN');
    expect((await getJournal(chef.id, orgId, 'J34', P())).rows.find((r) => r[5].includes('Износ уплотнителя'))).toBeTruthy();
  });

  it('закрыть CAPA без проверки нельзя даже напрямую в базе; история неизменяема', async () => {
    const { id } = await createCapa(haccp.id, orgId, { siteId, title: 'Повторяющиеся пропуски замеров', problem: 'Ночная смена пропускает замер в 03:00' });
    await expect(withSystem((tx) => tx.query(`update capas set status = 'closed' where id = $1`, [id]))).rejects.toThrow(/check constraint/);
    await expect(withSystem((tx) => tx.query(`delete from capa_events where capa_id = $1`, [id]))).rejects.toThrow(/не изменяется/);
  });
});

describe('Доказательства: неизменяемы, с хешем, тип по содержимому', () => {
  let incidentId: string;
  beforeAll(async () => { incidentId = (await listCapas(owner.id, orgId)).find((c) => c.incident_id)!.incident_id; });

  it('прикрепление, дубль, тип и размер, просмотр', async () => {
    const r = await addEvidence(cook.id, orgId, { entityType: 'incident', entityId: incidentId, filename: 'камера.jpg', note: 'термометр 8,5' }, JPEG);
    expect(r.duplicate).toBe(false);
    expect((await addEvidence(cook.id, orgId, { entityType: 'incident', entityId: incidentId, filename: 'ещё.jpg' }, JPEG)).duplicate).toBe(true);
    await expect(addEvidence(cook.id, orgId, { entityType: 'incident', entityId: incidentId, filename: 'x.jpg' }, Buffer.from('<html>не картинка'))).rejects.toThrow(/Поддерживаются/);
    await expect(addEvidence(cook.id, orgId, { entityType: 'incident', entityId: incidentId, filename: 'big.pdf' }, Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]))).rejects.toThrow(/10 МБ/);
    await expect(addEvidence(cook.id, orgId, { entityType: 'users', entityId: incidentId, filename: 'x.pdf' }, PDF)).rejects.toMatchObject({ code: 'VALIDATION' });
    await addEvidence(haccp.id, orgId, { entityType: 'haccp_step', entityId: steps['Тепловая обработка'], filename: 'схема.pdf' }, PDF);
    const list = await listEvidence(chef.id, orgId, 'incident', incidentId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ mime: 'image/jpeg', filename: 'камера.jpg', uploaded_by_name: expect.any(String) });
    const f = await getEvidenceFile(chef.id, orgId, r.id);
    expect(Buffer.compare(f.content, JPEG)).toBe(0);
    await expect(withSystem((tx) => tx.query(`update evidence_files set filename = 'x' where id = $1`, [r.id]))).rejects.toThrow(/нельзя/);
  });

  it('изоляция: чужая организация и чужая площадка', async () => {
    await expect(listEvidence(stranger.id, orgId, 'incident', incidentId)).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) });
    await expect(listEvidence(cook2.id, orgId, 'incident', incidentId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(addEvidence(cook2.id, orgId, { entityType: 'incident', entityId: incidentId, filename: 'x.pdf' }, PDF)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('Пакет для проверки', () => {
  it('ZIP: сводка, журналы, доказательства, контрольные суммы; сотрудник цеха пакет не выгружает', async () => {
    await expect(buildPack(cook.id, orgId, P())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const r = await buildPack(haccp.id, orgId, P());
    expect(r.files).toEqual(expect.arrayContaining(['index.html', 'journals/J01.csv', 'journals/J31.html', 'journals/J34.html', 'checksums.sha256']));
    expect(r.files.some((f) => f.startsWith('evidence/incident/') && f.endsWith('камера.jpg'))).toBe(true);
    const dir = mkdtempSync(path.join(tmpdir(), 'pack-'));
    const file = path.join(dir, 'p.zip');
    writeFileSync(file, r.archive);
    const out = execFileSync('python3', ['-I', '-c', `
import zipfile, hashlib, sys
z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
sums = dict(reversed(l.split('  ', 1)) for l in z.read('checksums.sha256').decode().strip().split('\\n'))
for n, h in sums.items(): assert hashlib.sha256(z.read(n)).hexdigest() == h, n
idx = z.read('index.html').decode()
print(len(sums), 'Пакет документов для проверки' in idx, 'Утверждённого плана ХАССП нет' in idx, 'полное соответствие' in idx)`, file]).toString().trim();
    const [n, title, noPlan, claim] = out.split(' ');
    expect(Number(n)).toBe(r.files.length - 1);
    expect([title, noPlan, claim]).toEqual(['True', 'False', 'False']);
  });
});
