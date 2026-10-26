import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { saveProfile } from '../src/server/ops/regulatory';
import { getPpk, savePpkParams, approvePpk, getPpkVersion } from '../src/server/ops/ppk';
import { getCompliance } from '../src/server/ops/compliance';
import { makeUser, lastLinkToken } from './helpers';

/** Мастер ППК: программа из нормативной базы и данных, пробелы блокируют утверждение, изменение данных требует пересмотра. */

afterAll(() => closePool());

type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, cook: U, orgId: string, siteId: string;

beforeAll(async () => {
  owner = await makeUser({ name: 'Иванов Иван' });
  const r = await createOrganization(owner, { name: 'Кафе «ППК»', inn: '7700000000' });
  orgId = r.organization.id; siteId = r.site.id;
  cook = await makeUser({ name: 'Петров Пётр' });
  await inviteMember(owner.id, orgId, { email: cook.email, role: 'line_staff' });
  await acceptInvitation(cook, await lastLinkToken(cook.email, 'invitation'));
  await saveProfile(owner.id, orgId, { objectTypes: ['cafe'], salesModes: ['hall'], seats: 30, features: [] });
});

const sys = (sql: string, a: unknown[]) => withSystem((tx) => tx.query(sql, a));

/** Данные, которые закрывают все пробелы программы. */
async function fill() {
  await sys(`update sites set address = 'г. Тула, ул. Ленина, 1' where id = $1`, [siteId]);
  const plan = (await sys(`insert into haccp_plans (organization_id, version, status, scope, created_by, approved_by, approved_at) values ($1, 1, 'draft', 'Горячие блюда', $2, null, null) returning id`, [orgId, owner.id])).rows[0].id;
  const step = (await sys(`insert into haccp_steps (organization_id, plan_id, position, name) values ($1, $2, 1, 'Тепловая обработка') returning id`, [orgId, plan])).rows[0].id;
  const hz = (await sys(`insert into haccp_hazards (organization_id, plan_id, step_id, code, hazard_type, description, class, class_rationale, classified_by, classified_at) values ($1, $2, $3, 'ККТ-1', 'biological', 'Выживание патогенов', 'ccp', 'Дерево решений', $4, now()) returning id`, [orgId, plan, step, owner.id])).rows[0].id;
  await sys(`insert into haccp_monitoring (organization_id, plan_id, hazard_id, what, method, frequency, responsible_role, critical_limit, corrective_action, record_form)
    values ($1, $2, $3, 'Температура в толще', 'Термощуп', 'Каждая партия', 'chef', 'не ниже 75 °C', 'Продолжить обработку', 'J22')`, [orgId, plan, hz]);
  await sys(`update haccp_plans set status = 'approved', approved_by = $2, approved_at = now() where id = $1`, [plan, owner.id]);
  const obj = (await sys(`insert into control_objects (organization_id, site_id, name, kind, code) values ($1, $2, 'Холодильник 1', 'fridge', 'X1') returning id`, [orgId, siteId])).rows[0].id;
  await sys(`insert into control_rules (organization_id, control_object_id, parameter, unit, min_value, max_value, source_ref, status, created_by) values ($1, $2, 'temperature', '°C', 2, 6, 'маркировка', 'approved', $3)`, [orgId, obj, owner.id]);
  for (const [t, g, p] of [['Вода питьевая', 'Кран, горячий цех', 180], ['Микроклимат', 'Горячий цех', 365]] as const)
    await sys(`insert into lab_programs (organization_id, site_id, test_type, target, period_days, next_due, basis, created_by) values ($1, $2, $3, $4, $5, current_date + 30, 'ППК', $6)`, [orgId, siteId, t, g, p, owner.id]);
  const dis = (await sys(`insert into disinfectants (organization_id, name, purpose, basis, status, created_by, approved_by, approved_at) values ($1, 'Део-хлор', 'поверхности', 'инструкция', 'approved', $2, $2, now()) returning id`, [orgId, owner.id])).rows[0].id;
  await sys(`insert into sanitation_plans (organization_id, site_id, area, work, kind, period_days, next_due, disinfectant_id, check_concentration, created_by) values ($1, $2, 'Горячий цех', 'Дезинфекция столов', 'disinfection', 1, current_date + 1, $3, true, $4)`, [orgId, siteId, dis, owner.id]);
  for (const k of ['lab', 'pest_control', 'waste']) {
    const c = (await sys(`insert into contracts (organization_id, kind, title, counterparty, number, signed_on, valid_from, valid_to, created_by) values ($1, $2, 'Договор', $3, '1', current_date - 10, current_date - 10, current_date + 300, $4) returning id`, [orgId, k, `ООО «${k}»`, owner.id])).rows[0].id;
    await sys(`insert into evidence_files (organization_id, entity_type, entity_id, filename, mime, size_bytes, sha256, content, uploaded_by) values ($1, 'contract', $2, 'd.pdf', 'application/pdf', 4, $3, '\\x25504446', $4)`, [orgId, c, `h${k}${orgId}`, owner.id]);
  }
  const dish = (await sys(`insert into dishes (organization_id, name) values ($1, 'Котлета') returning id`, [orgId])).rows[0].id;
  await sys(`insert into ttk_versions (organization_id, dish_id, version, status, created_by, approved_by, approved_at) values ($1, $2, 1, 'approved', $3, $3, now())`, [orgId, dish, owner.id]);
  await sys(`insert into staff_medical (organization_id, user_id, exam_due, hygiene_due, recorded_by) values ($1, $2, current_date + 300, current_date + 300, $3)`, [orgId, cook.id, owner.id]);
}

describe('Программа производственного контроля', () => {
  it('новое предприятие: программа собрана, но с пробелами — каждый со ссылкой, где исправить', async () => {
    const r = await getPpk(owner.id, orgId);
    const gaps = r.doc.gaps.map((g) => g.text).join(' | ');
    expect(gaps).toMatch(/Нет утверждённого плана ХАССП/);
    expect(gaps).toMatch(/Не назначен ответственный/);
    expect(gaps).toMatch(/Не указан адрес/);
    expect(gaps).toMatch(/нет исследования воды/);
    expect(gaps).toMatch(/Петров Пётр/);                 // нет медосмотра у повара
    expect(r.doc.gaps.every((g) => g.href)).toBe(true);
    // каждая строка без пробела — с основанием из библиотеки, тексты оснований — в приложении
    for (const s of r.doc.sections) for (const l of s.lines) if (!l.gap) expect(l.basis.length, l.text).toBeGreaterThan(0);
    expect(r.doc.basis.find((b) => b.id === 'sanpin4282:4')!.text).toMatch(/принципах ХАССП/);
    // кафе без фритюра — журналов фритюра нет; СП 2.1.4284 к отдельному кафе не цитируется
    const journals = r.doc.sections.find((s) => s.title.startsWith('Перечень форм'))!.table!.rows.map((x) => x[0]);
    expect(journals).toContain('J42');
    expect(journals).not.toContain('J38');
    expect(r.doc.basis.some((b) => b.doc === 'СП 2.1.4284-26')).toBe(false);
  });

  it('с пробелами утвердить нельзя; в «Готов ли я к проверке» — нарушение', async () => {
    await expect(approvePpk(owner.id, orgId, { changeNote: 'Введена впервые' })).rejects.toThrow(/утвердить нельзя/);
    const c = await getCompliance(owner.id, orgId);
    expect(c.items.find((i) => i.id === 'rpn:ppk_update')!.status).toBe('fail');
  });

  it('ответственный — только сотрудник предприятия; повар не может менять реквизиты', async () => {
    const stranger = await makeUser();
    await expect(savePpkParams(owner.id, orgId, { responsibleUserId: stranger.id })).rejects.toThrow(/действующим сотрудником/);
    await expect(savePpkParams(cook.id, orgId, { city: 'Тула' })).rejects.toThrow();
    await savePpkParams(owner.id, orgId, { responsibleUserId: owner.id, approverTitle: 'Директор' });
    await savePpkParams(owner.id, orgId, { city: 'Тула' });   // частичное сохранение не стирает остальное
    const r = await getPpk(owner.id, orgId);
    expect(r.doc.params).toMatchObject({ responsibleUserId: owner.id, approverTitle: 'Директор', city: 'Тула' });
    expect(r.doc.responsible!.name).toBe('Иванов Иван');
  });

  it('данные внесены — пробелов нет, программа утверждается; повтор без изменений не нужен', async () => {
    await fill();
    const r = await getPpk(owner.id, orgId);
    expect(r.doc.gaps).toEqual([]);
    expect(r.doc.sections.find((s) => s.title.startsWith('Критические'))!.table!.rows[0].join()).toMatch(/не ниже 75 °C/);
    await expect(approvePpk(cook.id, orgId, { changeNote: 'Введена впервые' })).rejects.toThrow();
    const v = await approvePpk(owner.id, orgId, { changeNote: 'Введена впервые' });
    expect(v.version).toBe(1);
    expect((await getPpk(owner.id, orgId)).current).toBe(true);
    await expect(approvePpk(owner.id, orgId, { changeNote: 'Ещё раз' })).rejects.toThrow(/не изменились/);
    const c = await getCompliance(owner.id, orgId);
    expect(c.items.find((i) => i.id === 'rpn:ppk_update')!.status).toBe('ok');
  });

  it('изменились данные — система требует пересмотра; утверждённый снимок неизменен', async () => {
    await sys(`insert into control_objects (organization_id, site_id, name, kind, code) values ($1, $2, 'Морозильник', 'freezer', 'X2')`, [orgId, siteId]);
    const r = await getPpk(owner.id, orgId);
    expect(r.current).toBe(false);
    expect(r.doc.gaps.map((g) => g.text).join()).toMatch(/Морозильник.*диапазон/);
    const c = await getCompliance(owner.id, orgId);
    expect(c.items.find((i) => i.id === 'rpn:ppk_update')!.status).toBe('warn');
    const v1 = await getPpkVersion(owner.id, orgId, 1);
    expect(JSON.stringify(v1.snapshot)).not.toMatch(/Морозильник/);
    await expect(sys(`update ppk_versions set change_note = 'x' where organization_id = $1`, [orgId])).rejects.toThrow();
  });
});
