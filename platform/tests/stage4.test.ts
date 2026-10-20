import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createControlObject, createRule, approveRule } from '../src/server/ops/control';
import { listTasks } from '../src/server/ops/tasks';
import {
  seedStartList, listSources, getSource, createSource, addVersion, updateVersion, addRequirement, markChecked, approveVersion, setVersionSuspended,
  saveProfile, decideApplicability, regulatoryProfile, versionState, proposeApplicability, START_LIST,
} from '../src/server/ops/regulatory';
import { makeUser, lastLinkToken } from './helpers';

afterAll(() => closePool());

type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, haccp: U, tech: U, cook: U;
let orgId: string, siteId: string;
const day = (n: number) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const CHECK = { evidence: 'Сверено с официальной публикацией на publication.pravo.gov.ru, № публикации 0001202606020001', nextCheckAt: day(180) };

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кафе «Норма»' });
  orgId = r.organization.id; siteId = r.site.id;
  haccp = await invite('haccp_lead'); tech = await invite('technologist'); cook = await invite('line_staff');
});

describe('Стартовый перечень (ТЗ v2 §8) и запрет автоматической активации (AT-08)', () => {
  it('загружается как «Требует проверки»; ничего не действует без проверки; данные только из ТЗ', async () => {
    const r = await seedStartList(haccp.id, orgId);
    expect(r).toEqual({ added: START_LIST.length, total: START_LIST.length });
    expect((await seedStartList(haccp.id, orgId)).added).toBe(0);
    const list = await listSources(haccp.id, orgId);
    expect(list).toHaveLength(START_LIST.length);
    expect(list.every((s) => s.current.state === 'needs_review' && s.current.state_label === 'Требует проверки')).toBe(true);
    const sanpin = list.find((s) => s.code === 'СанПиН 2.3/2.4.4282-26')!;
    expect(sanpin.current).toMatchObject({ data_origin: expect.stringContaining('требует сверки') });
    expect(new Date(sanpin.current.effective_from).toISOString().slice(0, 10)).toBe('2026-09-01');   // дата из ТЗ v2 §8
    expect(sanpin.current.workflow_status).toBe('needs_review');
    const old = list.find((s) => s.code === 'СанПиН 2.3/2.4.3590-20')!;
    expect(old.current.effective_from).toBeNull();     // дат нет в ТЗ — не выдуманы
    expect((await regulatoryProfile(haccp.id, orgId)).items).toHaveLength(0);
  });

  it('утвердить без проверки, дат, владельца и требований нельзя — список причин', async () => {
    const s = (await listSources(haccp.id, orgId)).find((x) => x.code === 'СанПиН 2.3/2.4.3590-20')!;
    await expect(approveVersion(owner.id, orgId, s.current.id)).rejects.toThrow(/не проверена специалистом.*не указана дата начала действия.*не внесено ни одного требования/);
    await expect(markChecked(haccp.id, orgId, s.current.id, { evidence: 'коротко', nextCheckAt: day(30) })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(markChecked(haccp.id, orgId, s.current.id, { ...CHECK, nextCheckAt: day(-1) })).rejects.toThrow(/в будущем/);
    await markChecked(haccp.id, orgId, s.current.id, CHECK);
    await expect(approveVersion(owner.id, orgId, s.current.id)).rejects.toThrow(/не указана дата начала действия/);
  });

  it('права: технолог проверяет, но не утверждает; сотрудник цеха реестр не видит', async () => {
    const { version } = await createSource(tech.id, orgId, { code: 'ПК-ВН-01', kind: 'Внутренний', title: 'Процедура контроля холодильного оборудования ПК-01', jurisdiction: 'Организация', binding: 'mandatory', edition: 'ред. 1', effectiveFrom: day(-10) });
    await addRequirement(tech.id, orgId, version.id, { clause: 'п. 1', text: 'Температура в холодильной камере для мяса контролируется не реже двух раз в смену.', scope: 'холодильное оборудование цехов', processes: ['storage'] });
    await markChecked(tech.id, orgId, version.id, CHECK);
    await expect(approveVersion(tech.id, orgId, version.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(approveVersion(haccp.id, orgId, version.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(listSources(cook.id, orgId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const res = await approveVersion(owner.id, orgId, version.id);
    expect(res.version).toMatchObject({ state: 'in_force', state_label: 'Действует' });
    await expect(updateVersion(tech.id, orgId, version.id, { edition: 'ред. 2' })).rejects.toThrow(/не изменяется/);
  });
});

describe('Статусы по датам и правка проверенной редакции', () => {
  it('«Скоро вступает в силу», «Утратил силу», «Приостановлен»; правка проверенной возвращает на проверку', async () => {
    expect(versionState({ workflow_status: 'approved', effective_from: '2026-11-01', effective_to: null }, '2026-10-20')).toBe('upcoming');
    expect(versionState({ workflow_status: 'approved', effective_from: '2020-01-01', effective_to: '2026-09-01' }, '2026-10-20')).toBe('repealed');
    expect(versionState({ workflow_status: 'approved', effective_from: '2020-01-01', effective_to: null, replaced_from: '2026-09-01' }, '2026-10-20')).toBe('repealed');
    expect(versionState({ workflow_status: 'checked', effective_from: '2020-01-01', effective_to: null }, '2026-10-20')).toBe('checked');

    const { version } = await createSource(tech.id, orgId, { code: 'МУК-ТЕСТ', kind: 'МУК', title: 'Методические указания (тест статусов)', binding: 'methodological', edition: 'ред. 2026', effectiveFrom: day(30) });
    await addRequirement(tech.id, orgId, version.id, { clause: 'п. 3.1', text: 'Методика измерения температуры в толще продукта щупом.', scope: 'контроль тепловой обработки', processes: ['thermal'] });
    await markChecked(tech.id, orgId, version.id, CHECK);
    await updateVersion(tech.id, orgId, version.id, { transitional: 'переходный период 3 месяца' });
    const v1 = (await getSource(tech.id, orgId, version.source_id)).versions[0];
    expect(v1.workflow_status).toBe('needs_review');      // правка после проверки — снова на проверку
    await markChecked(tech.id, orgId, version.id, CHECK);
    expect((await approveVersion(owner.id, orgId, version.id)).version.state).toBe('upcoming');
    await setVersionSuspended(owner.id, orgId, version.id, { suspended: true, reason: 'оспаривается в суде, письмо Роспотребнадзора' });
    expect((await getSource(tech.id, orgId, version.source_id)).versions[0].state_label).toBe('Приостановлен / оспаривается');
  });
});

describe('Нормативный профиль и связь требование → правило контроля', () => {
  let reqThermal: string, reqStorage: string, reqAll: string, sourceId: string, v1: string;

  it('применимость предлагается по профилю, решает специалист', async () => {
    expect(proposeApplicability({ object_types: [], processes: [] }, null).proposed).toBeNull();
    await saveProfile(haccp.id, orgId, { objectTypes: ['cafe'], processes: ['receiving', 'storage', 'thermal'] });
    const { version } = await createSource(tech.id, orgId, { code: 'СП-ТЕСТ', kind: 'Другое', title: 'Требования к хранению (тестовый источник)', binding: 'mandatory', edition: 'ред. 1', effectiveFrom: day(-30) });
    sourceId = version.source_id; v1 = version.id;
    reqStorage = (await addRequirement(tech.id, orgId, v1, { clause: 'п. 1', text: 'Скоропортящаяся продукция хранится при температуре, установленной изготовителем.', scope: 'хранение сырья', processes: ['storage'] })).id;
    reqThermal = (await addRequirement(tech.id, orgId, v1, { clause: 'п. 2', text: 'Температура в толще продукта при тепловой обработке контролируется.', scope: 'тепловая обработка', processes: ['thermal'] })).id;
    reqAll = (await addRequirement(tech.id, orgId, v1, { clause: 'п. 3', text: 'Требование к школьному питанию — только для образовательных организаций.', scope: 'школьное питание', objectTypes: ['school'] })).id;
    await markChecked(haccp.id, orgId, v1, CHECK);
    await approveVersion(owner.id, orgId, v1);
    const p = await regulatoryProfile(haccp.id, orgId);
    const by = (id: string) => p.items.find((i) => i.id === id)!;
    expect(by(reqStorage).proposal.proposed).toBe(true);
    expect(by(reqAll).proposal).toMatchObject({ proposed: false, reason: 'Тип объекта не совпадает с профилем' });
    expect(by(reqStorage).applicable ?? null).toBeNull();   // предложение ≠ решение
    await decideApplicability(haccp.id, orgId, reqStorage, { applicable: true, rationale: 'кафе хранит скоропортящееся сырьё' });
    await decideApplicability(haccp.id, orgId, reqThermal, { applicable: true, rationale: 'есть горячий цех' });
    await decideApplicability(haccp.id, orgId, reqAll, { applicable: false, rationale: 'не образовательная организация' });
    await expect(decideApplicability(cook.id, orgId, reqAll, { applicable: true, rationale: 'считаю применимым' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const after = await regulatoryProfile(haccp.id, orgId);
    expect(after.counts).toMatchObject({ applicable: 2, not_applicable: 1, without_control: 2 });
  });

  it('правило контроля ссылается только на применимое требование действующей редакции; основание подставляется', async () => {
    const fridge = await createControlObject(owner.id, orgId, { siteId, name: 'Холодильник мясной', kind: 'fridge' });
    await expect(createRule(haccp.id, orgId, { controlObjectId: fridge.id, maxValue: 6, requirementId: reqAll })).rejects.toThrow(/не подтверждена/);
    const rule = await createRule(haccp.id, orgId, { controlObjectId: fridge.id, minValue: 2, maxValue: 6, frequencyHours: 6, requirementId: reqStorage });
    expect(rule.source_ref).toBe('СП-ТЕСТ, п. 1 (ред. ред. 1)');
    await approveRule(haccp.id, orgId, rule.id);
    const stove = await createControlObject(owner.id, orgId, { siteId, name: 'Мармит горячего цеха', kind: 'hot_holding' });
    const r2 = await createRule(haccp.id, orgId, { controlObjectId: stove.id, minValue: 65, requirementId: reqThermal, sourceRef: 'процедура ПК-07' });
    expect(r2.source_ref).toBe('СП-ТЕСТ, п. 2 (ред. ред. 1); процедура ПК-07');
    await approveRule(haccp.id, orgId, r2.id);
    expect((await regulatoryProfile(haccp.id, orgId)).counts.without_control).toBe(0);
  });

  it('новая редакция: история сохраняется, сравнение пунктов, задачи пересмотра изменённых, перенос неизменённых (AT-09)', async () => {
    const v2 = await addVersion(tech.id, orgId, sourceId, { edition: 'ред. 2', effectiveFrom: day(-1) });
    const copied = (await getSource(tech.id, orgId, sourceId)).requirements.filter((r) => r.version_id === v2.id);
    expect(copied.map((r) => r.clause).sort()).toEqual(['п. 1', 'п. 2', 'п. 3']);
    // В новой редакции п. 2 изменён, п. 3 исключён, добавлен п. 4. Правим копию через пересоздание редакции нельзя — вносим изменения в черновик.
    const { withSystem } = await import('../src/server/db/pool');
    await withSystem(async (tx) => {
      await tx.query(`update reg_requirements set text = 'Температура в толще продукта при тепловой обработке — не ниже значения, установленного ТТК, с записью в журнал.' where version_id = $1 and clause = 'п. 2'`, [v2.id]);
      await tx.query(`delete from reg_requirements where version_id = $1 and clause = 'п. 3'`, [v2.id]);
    });
    await addRequirement(tech.id, orgId, v2.id, { clause: 'п. 4', text: 'Охлаждение готовой продукции контролируется по времени и температуре.', scope: 'охлаждение', processes: ['cooling'] });
    await markChecked(haccp.id, orgId, v2.id, CHECK);
    const { review } = await approveVersion(owner.id, orgId, v2.id);
    expect(review.diff.added.map((x: { clause: string }) => x.clause)).toEqual(['п. 4']);
    expect(review.diff.removed.map((x: { clause: string }) => x.clause)).toEqual(['п. 3']);
    expect(review.diff.changed.map((x: { clause: string }) => x.clause)).toEqual(['п. 2']);
    expect(review.affected_rules).toBe(1);

    const src = await getSource(tech.id, orgId, sourceId);
    expect(src.versions.map((v) => v.state)).toEqual(['repealed', 'in_force']);   // прежняя редакция в истории — «утратил силу»
    const tasks = await listTasks(owner.id, orgId, { all: true });
    expect(tasks.filter((t) => t.kind === 'reg_review').map((t) => t.title)).toEqual(['Пересмотреть правило контроля: Мармит горячего цеха']);
    // Правило по неизменённому п. 1 перешло на новую редакцию автоматически.
    const p1new = src.requirements.find((r) => r.version_id === v2.id && r.clause === 'п. 1')!;
    expect(p1new.rules).toBe(1);
  });
});
