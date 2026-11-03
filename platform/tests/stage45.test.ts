import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createProduct } from '../src/server/ops/catalog';
import { createDish, getDish, updateVersion, addLine, submitVersion, approveVersion } from '../src/server/ops/recipes';
import { createPlan, savePlan } from '../src/server/ops/floorplan';
import { saveStages } from '../src/server/ops/ttkStages';
import { generateChecklists, listChecklists, getChecklist, approveChecklist, startRun, getRun, recordItem, closeRun } from '../src/server/ops/checklists';
import { centerFromCorner, type PlanObject } from '../src/lib/floorplan';
import { makeUser, lastLinkToken } from './helpers';

/** ТЗ 3.0 §15.6; мастер-промт, раздел 7: чек-листы из этапов ТТК и мониторинга ХАССП; факт вместо нормы; пропуск — задача. */

afterAll(() => closePool());
type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, chef: U, cook: U, haccp: U, orgId: string, siteId: string;
const room: PlanObject = { id: randomUUID(), kind: 'room', x_mm: 2000, y_mm: 2000, w_mm: 4000, h_mm: 4000, rotation: 0, props: {} };
const stove = { id: randomUUID(), kind: 'stove', label: 'Плита', w_mm: 800, h_mm: 700, rotation: 0, size_confirmed: true, props: {}, ...centerFromCorner(room, 3000, 0, 800, 700, 0) };

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Цех чек-листов' });
  orgId = r.organization.id; siteId = r.site.id;
  chef = await invite('chef'); cook = await invite('line_staff'); haccp = await invite('haccp_lead');
  // план площадки и ТТК с этапом на плите (контроль указан) и этапом без контроля
  const planId = (await createPlan(chef.id, orgId, { siteId, name: 'Цех', width_mm: 5000, height_mm: 5000 })).id;
  await savePlan(chef.id, orgId, planId, { revision: 1, objects: [room, stove], routes: [] });
  const beef = (await createProduct(chef.id, orgId, { name: 'Говядина', unit: 'кг' })).id;
  const dish = (await createDish(chef.id, orgId, { name: 'Бифштекс', kind: 'dish', salePrice: 400 })).id;
  const v = (await getDish(chef.id, orgId, dish)).current!.version.id;
  await updateVersion(chef.id, orgId, v, { yieldG: 150, portionG: 150, technology: 'Обжарить до готовности с двух сторон.', storageConditions: '+2…+6 °C', shelfLife: 'сразу после приготовления' });
  await addLine(chef.id, orgId, v, { productId: beef, unit: 'кг', brutto: 0.2, netto: 0.16 });
  await saveStages(chef.id, orgId, v, { stages: [
    { operation: 'Обжарка', plan_object_id: stove.id, state: 'ready', params: 'до +75 °C в толще', control: 'температура в толще продукта' },
    { operation: 'Выкладка', plan_object_id: stove.id, state: 'ready' }] });
  await submitVersion(chef.id, orgId, v); await approveVersion(chef.id, orgId, v);
  // утверждённый план ХАССП: ККТ с правилом контроля (числовой предел) и ОПП без правила
  await withSystem(async (tx) => {
    const obj = (await tx.query(`insert into control_objects (organization_id, site_id, name, kind, code) values ($1, $2, 'Щуп в толще', 'other', 'T-1') returning id`, [orgId, siteId])).rows[0].id;
    const rule = (await tx.query(`insert into control_rules (organization_id, control_object_id, unit, min_value, source_ref, status, created_by, approved_by, approved_at)
      values ($1, $2, '°C', 75, 'План ХАССП, ККТ-1', 'approved', $3, $3, now()) returning id`, [orgId, obj, haccp.id])).rows[0].id;
    const plan = (await tx.query(`insert into haccp_plans (organization_id, version, scope, created_by) values ($1, 1, 'Горячий цех', $2) returning id`, [orgId, haccp.id])).rows[0].id;
    const step = (await tx.query(`insert into haccp_steps (organization_id, plan_id, position, name) values ($1, $2, 1, 'Тепловая обработка') returning id`, [orgId, plan])).rows[0].id;
    const h1 = (await tx.query(`insert into haccp_hazards (organization_id, plan_id, step_id, code, hazard_type, description) values ($1, $2, $3, 'О-01', 'biological', 'Выживание патогенов') returning id`, [orgId, plan, step])).rows[0].id;
    const h2 = (await tx.query(`insert into haccp_hazards (organization_id, plan_id, step_id, code, hazard_type, description) values ($1, $2, $3, 'О-02', 'physical', 'Посторонние включения') returning id`, [orgId, plan, step])).rows[0].id;
    await tx.query(`insert into haccp_monitoring (organization_id, plan_id, hazard_id, what, where_text, method, frequency, critical_limit, responsible_role, corrective_action, control_rule_id)
      values ($1, $2, $3, 'Температура в толще', 'Плита', 'щуп-термометр', 'каждая партия', 'не ниже 75 °C', 'line_staff', 'Довести до температуры', $4)`, [orgId, plan, h1, rule]);
    await tx.query(`insert into haccp_monitoring (organization_id, plan_id, hazard_id, what, where_text, method, frequency, critical_limit, responsible_role, corrective_action)
      values ($1, $2, $3, 'Посторонние включения', 'Раздача', 'визуально', 'каждая порция', 'отсутствие', 'line_staff', 'Изъять порцию')`, [orgId, plan, h2]);
    await tx.query(`update haccp_plans set status = 'approved', approved_by = $2, approved_at = now() where id = $1`, [plan, haccp.id]);
  });
});

describe('Чек-листы', () => {
  it('формируются только из утверждённых источников; этап без контроля — не пункт; черновик утверждает специалист', async () => {
    await expect(generateChecklists(cook.id, orgId, { siteId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const g = await generateChecklists(chef.id, orgId, { siteId });
    expect(g.made.map((m) => [m.name, m.items]).sort()).toEqual([['Мониторинг ККТ и ОПП', 2], ['Участок: Плита (Цех)', 1]]);
    const list = await listChecklists(cook.id, orgId, siteId);
    const ccp = list.find((x) => x.scope_key === 'haccp')!;
    const c = await getChecklist(cook.id, orgId, ccp.id);
    expect(c.items.map((i) => [i.kind, i.unit, i.min_value, i.source_ref])).toEqual([['measure', '°C', 75, 'План ХАССП v1, О-01'], ['observe', null, null, 'План ХАССП v1, О-02']]);
    const place = await getChecklist(cook.id, orgId, list.find((x) => x.scope_key.startsWith('place:'))!.id);
    expect(place.items).toEqual([expect.objectContaining({ action: 'Обжарка — Бифштекс', criterion: 'температура в толще продукта; до +75 °C в толще', source_ref: 'ТТК «Бифштекс» v1, этап 1' })]);
    await expect(startRun(cook.id, orgId, ccp.id)).rejects.toThrow(/только утверждённый/);
    await expect(approveChecklist(chef.id, orgId, ccp.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await approveChecklist(haccp.id, orgId, ccp.id);
    await expect(withSystem((tx) => tx.query(`update checklist_items set action = 'x' where template_id = $1`, [ccp.id]))).rejects.toThrow(/утверждён/);
    // повторное формирование не трогает утверждённую версию — создаёт новый черновик
    const g2 = await generateChecklists(chef.id, orgId, { siteId });
    expect(g2.made.find((m) => m.scope === 'haccp')).toMatchObject({ version: 2 });
  });

  it('выполнение: измерение только фактом, вне предела — отклонение; запись не меняется; пропуск — задача', async () => {
    const ccp = (await listChecklists(cook.id, orgId, siteId)).find((x) => x.scope_key === 'haccp' && x.status === 'approved')!;
    const run = await startRun(cook.id, orgId, ccp.id);
    expect((await startRun(cook.id, orgId, ccp.id)).id).toBe(run.id);                       // одно выполнение на день
    const [meas, obs] = (await getRun(cook.id, orgId, run.id)).items;
    await expect(recordItem(cook.id, orgId, run.id, { itemId: meas.id, done: true })).rejects.toThrow(/фактическое значение.*Норма вместо измерения не подставляется/);
    const r = await recordItem(cook.id, orgId, run.id, { itemId: meas.id, done: true, value: '71,5' });
    expect(r).toMatchObject({ ok: false, incident_id: expect.any(String) });
    await expect(recordItem(cook.id, orgId, run.id, { itemId: meas.id, done: true, value: 80 })).rejects.toThrow(/уже отмечен/);
    await expect(withSystem((tx) => tx.query(`update checklist_results set value = 80 where run_id = $1`, [run.id]))).rejects.toThrow();
    await expect(recordItem(cook.id, orgId, run.id, { itemId: obs.id, done: false })).rejects.toThrow(/почему пункт не выполнен/);
    const closed = await closeRun(cook.id, orgId, run.id);
    expect(closed).toEqual({ missing: 1 });                                                 // наблюдение не отмечено
    const t = (await withSystem((tx) => tx.query(`select title, details from tasks where organization_id = $1 and kind = 'checklist_gap' and entity_id = $2`, [orgId, run.id]))).rows[0];
    expect(t).toMatchObject({ title: expect.stringMatching(/не выполнено 1/), details: expect.stringMatching(/Посторонние включения.*\(не отмечено\)/) });
    const inc = (await withSystem((tx) => tx.query(`select kind, title from incidents where id = $1`, [r.incident_id]))).rows[0];
    expect(inc).toMatchObject({ kind: 'checklist', title: 'Вне предела: Температура в толще: щуп-термометр' });
    await expect(recordItem(cook.id, orgId, run.id, { itemId: obs.id, done: true, observation: 'нет' })).rejects.toThrow(/закрыт/);
  });
});
