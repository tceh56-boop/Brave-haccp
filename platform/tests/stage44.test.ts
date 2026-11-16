import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createProduct } from '../src/server/ops/catalog';
import { createDish, getDish, updateVersion, addLine, submitVersion, approveVersion, newVersion } from '../src/server/ops/recipes';
import { createPlan, getPlan, savePlan } from '../src/server/ops/floorplan';
import { getStages, saveStages } from '../src/server/ops/ttkStages';
import { centerFromCorner, type PlanObject } from '../src/lib/floorplan';
import { makeUser, lastLinkToken } from './helpers';

/** Мастер-промт, раздел 6: этапы ТТК на 2D-плане, схема движения продукта, поточность, анализ влияния правки плана. */

afterAll(() => closePool());
type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, chef: U, tech: U, orgId: string, siteId: string, planId: string, beef: string;

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}
const room: PlanObject = { id: randomUUID(), kind: 'room', x_mm: 3000, y_mm: 2000, w_mm: 6000, h_mm: 4000, rotation: 0, props: {} };
const at = (kind: string, x: number, y: number, w: number, h: number, extra: Partial<PlanObject> = {}): PlanObject =>
  ({ id: randomUUID(), kind, w_mm: w, h_mm: h, rotation: 0, size_confirmed: true, props: {}, ...extra, ...centerFromCorner(room, x, y, w, h, 0) });
// холодильник сырья слева вверху, стол сырья слева внизу, плита справа внизу, раздача справа вверху; зона сырья — левая нижняя четверть
const fridge = at('fridge', 0, 0, 700, 700, { label: 'Холодильник сырья' });
const rawTable = at('table', 0, 3000, 1200, 600, { label: 'Стол сырья' });
const stove = at('stove', 5000, 3000, 800, 700, { label: 'Плита' });
const pass = at('table', 5000, 0, 1000, 600, { label: 'Раздача' });
const salad = at('table', 2500, 0, 1000, 600, { label: 'Стол салатов' });
const rawZone = at('zone', 0, 2000, 2500, 2000, { zone_class: 'raw', label: 'Зона сырья' });

async function dish(name: string) {
  const d = (await createDish(chef.id, orgId, { name, kind: 'dish', salePrice: 300 })).id as string;
  const v = (await getDish(chef.id, orgId, d)).current!.version.id as string;
  await updateVersion(chef.id, orgId, v, { yieldG: 200, portionG: 200, technology: 'Приготовить по технологии предприятия.', storageConditions: '+2…+6 °C', shelfLife: 'сразу после приготовления' });
  await addLine(chef.id, orgId, v, { productId: beef, unit: 'кг', brutto: 0.25, netto: 0.2 });
  return { d, v };
}

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Цех маршрутов' });
  orgId = r.organization.id; siteId = r.site.id;
  chef = await invite('chef'); tech = await invite('technologist');
  beef = (await createProduct(chef.id, orgId, { name: 'Говядина', unit: 'кг' })).id;
  planId = (await createPlan(tech.id, orgId, { siteId, name: 'Цех', width_mm: 7000, height_mm: 5000 })).id;
  await savePlan(tech.id, orgId, planId, { revision: 1, objects: [room, fridge, rawTable, stove, pass, salad, rawZone], routes: [] });
});

describe('Этапы ТТК на плане', () => {
  it('этапы — только в черновике и только с местом существующего плана; новая версия копирует этапы', async () => {
    const { d, v } = await dish('Бифштекс');
    await expect(saveStages(chef.id, orgId, v, { stages: [{ operation: 'Хранение', plan_object_id: randomUUID(), state: 'raw' }] })).rejects.toThrow(/не найдено на планах/);
    await saveStages(chef.id, orgId, v, { stages: [
      { operation: 'Хранение сырья', plan_object_id: fridge.id, state: 'raw', params: '0…+4 °C' },
      { operation: 'Зачистка и нарезка', plan_object_id: rawTable.id, state: 'raw' },
      { operation: 'Жарка', plan_object_id: stove.id, state: 'ready', params: 'до +75 °C в толще', control: 'температура в толще' },
      { operation: 'Отпуск', plan_object_id: pass.id, state: 'ready' }] });
    const s = await getStages(chef.id, orgId, v);
    expect(s.stages.map((x) => [x.operation, x.place])).toEqual([['Хранение сырья', 'Холодильник сырья (Цех)'], ['Зачистка и нарезка', 'Стол сырья (Цех)'], ['Жарка', 'Плита (Цех)'], ['Отпуск', 'Раздача (Цех)']]);
    await submitVersion(chef.id, orgId, v); await approveVersion(chef.id, orgId, v);
    await expect(saveStages(chef.id, orgId, v, { stages: [] })).rejects.toThrow(/только в черновике/);
    await expect(withSystem((tx) => tx.query(`update ttk_stages set operation = 'x' where version_id = $1`, [v]))).rejects.toThrow(/не в черновике/);
    const nv = await newVersion(chef.id, orgId, d, { changeReason: 'Проверка копирования этапов' });
    expect((await getStages(chef.id, orgId, nv.id)).stages).toHaveLength(4);
  });

  it('схема движения продукта по плану из утверждённой ТТК и проверка поточности', async () => {
    const { v } = await dish('Салат');
    // салат: готовое несут со стола салатов через зону сырья к раздаче — нарушение поточности (на схеме)
    await saveStages(chef.id, orgId, v, { stages: [
      { operation: 'Сборка салата', plan_object_id: salad.id, state: 'ready' }, { operation: 'Охлаждение в зоне', plan_object_id: rawZone.id, state: 'ready' }, { operation: 'Отпуск', plan_object_id: pass.id, state: 'ready' }] });
    await submitVersion(chef.id, orgId, v); await approveVersion(chef.id, orgId, v);
    const p = await getPlan(tech.id, orgId, planId);
    expect(p.ttk_routes.map((r) => [r.dish, r.flow, r.stages.join(' → ')])).toEqual(expect.arrayContaining([
      ['Бифштекс', 'raw', 'Хранение сырья → Зачистка и нарезка'], ['Бифштекс', 'raw', 'Зачистка и нарезка → Жарка'], ['Бифштекс', 'ready', 'Жарка → Отпуск'],
      ['Салат', 'ready', 'Сборка салата → Охлаждение в зоне']]));
    const titles = p.risks.map((r) => r.title);
    expect(titles).toEqual(expect.arrayContaining(['Готовая продукция проходит через зону сырья: «Зона сырья»']));
    expect(titles.filter((t) => t === 'Сырьё пересекает путь готовой продукции').length).toBeGreaterThan(0);   // сырьё бифштекса пересекает путь готового салата
  });

  it('удаление места этапа с плана — задача проверить ТТК; новая версия с потерянным местом не утверждается', async () => {
    const p = await getPlan(tech.id, orgId, planId);
    await savePlan(tech.id, orgId, planId, { revision: p.plan.revision, objects: p.objects.filter((o) => o.id !== rawTable.id), routes: [] });
    const t = (await withSystem((tx) => tx.query(`select title, details from tasks where organization_id = $1 and kind = 'ttk_dependent_review' and status = 'open'`, [orgId]))).rows;
    expect(t).toEqual([expect.objectContaining({ title: 'Проверить ТТК «Бифштекс»: место этапа удалено с плана «Цех»', details: expect.stringMatching(/Зачистка и нарезка/) })]);
    const draft = (await withSystem((tx) => tx.query(`select v.id from ttk_versions v join dishes d on d.id = v.dish_id where d.organization_id = $1 and d.name = 'Бифштекс' and v.status = 'draft'`, [orgId]))).rows[0].id;
    expect((await getStages(chef.id, orgId, draft)).stages[1]).toMatchObject({ place_missing: true });
    await expect(submitVersion(chef.id, orgId, draft)).rejects.toThrow(/Место этапа удалено с плана: 2\. Зачистка и нарезка/);
  });
});
