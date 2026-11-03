import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createPlan, getPlan, savePlan, decideRisk, approvePlan } from '../src/server/ops/floorplan';
import { specification, findRisks, passages, centerFromCorner, scene3d, type PlanObject } from '../src/lib/floorplan';
import { makeUser, lastLinkToken } from './helpers';

/** ТЗ 3.0 §15.2, §15.4; мастер-промт, раздел 4: 2D-план в мм, спецификация, риски, решения специалиста, версии. */

afterAll(() => closePool());
type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, tech: U, haccp: U, cook: U, orgId: string, siteId: string, planId: string;

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}

// помещение 4000 × 8000 (внутренние грани от 0,0); оборудование задаём как в спецификации чертежа: X, Y левого верхнего угла
const room: PlanObject = { id: randomUUID(), kind: 'room', label: 'Цех', x_mm: 2000, y_mm: 4000, w_mm: 4000, h_mm: 8000, rotation: 0, props: { wall_mm: 200 } };
const at = (kind: string, x: number, y: number, w: number, h: number, extra: Partial<PlanObject> = {}): PlanObject =>
  ({ id: randomUUID(), kind, w_mm: w, h_mm: h, rotation: 0, size_confirmed: true, props: {}, ...extra, ...centerFromCorner(room, x, y, w, h, extra.rotation ?? 0) });

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Цех планировки' });
  orgId = r.organization.id; siteId = r.site.id;
  tech = await invite('technologist'); haccp = await invite('haccp_lead'); cook = await invite('line_staff');
});

describe('Геометрия и спецификация (чистые функции)', () => {
  it('X/Y от стен до левого верхнего угла, до правой и нижней стены; поворот на 90° меняет Ш и Г местами', () => {
    const rack = at('rack', 3500, 0, 500, 1000, { label: 'Стеллаж' });
    const fridge = at('fridge', 0, 2700, 700, 700, { props: { no: 7 } });
    const turned = at('table', 1000, 4000, 600, 1500, { rotation: 90 });
    const spec = specification([room, rack, fridge, turned]);
    expect(spec.find((s) => s.id === rack.id)).toMatchObject({ name: 'Стеллаж', w: 500, d: 1000, x: 3500, y: 0, to_right: 0, to_bottom: 7000 });
    expect(spec.find((s) => s.id === fridge.id)).toMatchObject({ no: 7, x: 0, y: 2700, to_right: 3300, to_bottom: 4600 });
    expect(spec.find((s) => s.id === turned.id)).toMatchObject({ w: 1500, d: 600, x: 1000, y: 4000 });
    expect(spec.map((s) => s.no)).toEqual([7, 8, 9]);                                          // ручной № сохраняется, остальные — дальше по порядку
  });

  it('риски: наложение, перекрытая зона открывания двери, пересечение потоков, поток через зону, условный габарит', () => {
    const a = at('table', 0, 0, 1200, 600), b = at('table', 1000, 300, 1200, 600);          // перекрываются на 200 × 300
    const f = at('fridge', 0, 2000, 700, 700, { props: { swing_mm: 700, front: 'right' } });
    const blocker = at('rack', 900, 2000, 500, 700);                                        // стоит в зоне открывания
    const z = at('zone', 2500, 5000, 1500, 2000, { zone_class: 'waste', label: 'Отходы' });
    const loose = at('stove', 2000, 0, 800, 700, { size_confirmed: false });
    const risks = findRisks([room, a, b, f, blocker, z, loose], [
      { id: 'r1', flow: 'raw', points: [[500, 7000], [3500, 7000]] }, { id: 'r2', flow: 'ready', points: [[2000, 6000], [2000, 7500]] },
      { id: 'r3', flow: 'ready', points: [[3000, 4500], [3200, 6500]] }]);
    const types = risks.map((r) => r.title);
    expect(types).toEqual(expect.arrayContaining([expect.stringMatching(/Габариты накладываются/), expect.stringMatching(/Зона открывания двери: Холодильный шкаф упирается в Стеллаж/),
      'Сырьё пересекает путь готовой продукции', 'Готовая продукция проходит через зону отходов: «Отходы»', expect.stringMatching(/Плита: габарит условный/)]));
    expect(risks.find((r) => r.type === 'flow_cross')!.at).toEqual([2000, 7000]);
  });
});

describe('Проходы', () => {
  it('расстояние до ближайшего соседа справа и снизу; без перекрытия по другой оси — не проход; минимум задаёт специалист', () => {
    const a = at('table', 0, 0, 1000, 700, { label: 'Стол 1' }), b = at('table', 1950, 100, 1000, 700, { label: 'Стол 2' });
    const c = at('fridge', 0, 1500, 700, 700, { label: 'Шкаф' }), far = at('rack', 3200, 3000, 500, 500);
    const g = passages([room, a, b, c, far]);
    expect(g.map((x) => [x.label, x.axis, x.gap])).toEqual(expect.arrayContaining([['Стол 1 — Стол 2', 'x', 950], ['Стол 1 — Шкаф', 'y', 800]]));
    expect(g.some((x) => x.b === far.id && x.a === a.id)).toBe(false);
    expect(findRisks([room, a, b, c], []).some((r) => r.type === 'narrow')).toBe(false);          // минимум не задан — проверки нет
    const narrow = findRisks([room, a, b, c], [], { minPassage: 900, basis: 'Проект, лист 3' }).filter((r) => r.type === 'narrow');
    expect(narrow.map((r) => r.title)).toEqual(['Проход 800 мм меньше заданного минимума 900 мм: Стол 1 — Шкаф']);
    expect(narrow[0].basis).toBe('Минимальная ширина прохода: 900 мм — Проект, лист 3');
  });
});

describe('3D из 2D (критерий 7 мастер-промта)', () => {
  it('оборудование — те же центр и габариты; проём двери вырезан в стене, над ним перемычка; условные высоты помечены', () => {
    const t = at('table', 1000, 2000, 1200, 600, { props: { height_mm: 900 } });
    const f = at('fridge', 0, 0, 700, 700);
    const door = at('door', 1600, 8000 + 100 - 900 / 2 + 450, 900, 200);                       // центр двери — на нижней стене
    const d2 = { ...door, x_mm: 1600 + 450, y_mm: 8000 + 100 };
    const boxes = scene3d([room, t, f, d2]);
    expect(boxes.find((b) => b.id === t.id)).toMatchObject({ part: 'equipment', x: t.x_mm, y: t.y_mm, w: 1200, d: 600, h: 900, conventional: false });
    expect(boxes.find((b) => b.id === f.id)).toMatchObject({ h: 2000, conventional: true });                // высота не указана — условная
    const bottom = boxes.filter((b) => b.part !== 'floor' && b.kind === 'wall' && Math.abs(b.y - 8100) < 1);
    const solid = bottom.filter((b) => b.part === 'wall').map((b) => [Math.round(b.x - b.w / 2), Math.round(b.x + b.w / 2)]).sort((a, c) => a[0] - c[0]);
    expect(solid).toEqual([[-200, 1600], [2500, 4200]]);                                             // проём 1600…2500 по X
    expect(bottom.find((b) => b.part === 'lintel')).toMatchObject({ z: 2100, h: 900, w: 900 });     // 3000 − 2100
    expect(boxes.find((b) => b.part === 'floor')).toMatchObject({ x: 2000, y: 4000, w: 4000, d: 8000 });
  });
});

describe('План на сервере', () => {
  it('сохранение с ревизией, права, версия только после решений специалиста по рискам', async () => {
    await expect(createPlan(cook.id, orgId, { siteId, name: 'Цех', width_mm: 6000, height_mm: 10000 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    planId = (await createPlan(tech.id, orgId, { siteId, name: 'Горячий цех', width_mm: 6000, height_mm: 10000 })).id;
    const t1 = at('table', 0, 0, 1200, 600), t2 = at('table', 1000, 300, 1200, 600);
    const r = await savePlan(tech.id, orgId, planId, { revision: 1, objects: [room, t1, t2], routes: [{ id: randomUUID(), flow: 'raw', points: [[100, 100], [3000, 100]] }] });
    expect(r.revision).toBe(2);
    await expect(savePlan(tech.id, orgId, planId, { revision: 1, objects: [room], routes: [] })).rejects.toThrow(/изменён другим сотрудником/);
    await expect(savePlan(cook.id, orgId, planId, { revision: 2, objects: [room], routes: [] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(savePlan(tech.id, orgId, planId, { revision: 2, objects: [{ ...room, kind: 'ракета' }], routes: [] })).rejects.toThrow(/Неизвестный тип объекта/);

    await expect(savePlan(tech.id, orgId, planId, { revision: 2, objects: [room, t1, t2], routes: [], passage: { min_mm: 900, basis: '' } })).rejects.toThrow(/основание минимальной ширины прохода/);
    const p = await getPlan(cook.id, orgId, planId);                                         // повар видит план
    expect(p.objects.map((o) => o.id).sort()).toEqual([room.id, t1.id, t2.id].sort());      // идентификаторы стабильны между сохранениями
    const overlap = p.risks.find((x) => x.type === 'overlap')!;
    await expect(approvePlan(haccp.id, orgId, planId, { changeNote: 'Первая расстановка' })).rejects.toThrow(/Нет решения специалиста по рискам \(1\): Габариты накладываются/);
    await expect(decideRisk(tech.id, orgId, planId, { riskKey: overlap.key, decision: 'rejected', rationale: 'Стол стоит над другим столом — нет' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(decideRisk(haccp.id, orgId, planId, { riskKey: overlap.key, decision: 'confirmed', rationale: 'Столы действительно пересекаются на плане' })).rejects.toThrow(/укажите меру/);
    await decideRisk(haccp.id, orgId, planId, { riskKey: overlap.key, decision: 'confirmed', rationale: 'Столы действительно пересекаются на плане', measure: 'Сдвинуть стол 2 на 300 мм вниз' });
    const v = await approvePlan(haccp.id, orgId, planId, { changeNote: 'Первая расстановка' });
    expect(v).toMatchObject({ version: 1, content_hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    await expect(withSystem((tx) => tx.query(`update floor_plan_versions set change_note = 'x' where plan_id = $1`, [planId]))).rejects.toThrow();
    const after = await getPlan(tech.id, orgId, planId);
    expect(after.risks.find((x) => x.key === overlap.key)!.decision).toMatchObject({ decision: 'confirmed', measure: 'Сдвинуть стол 2 на 300 мм вниз' });
    const log = (await withSystem((tx) => tx.query(`select action from audit_events where organization_id = $1 and action like 'plan.%' and result <> 'denied' order by created_at`, [orgId]))).rows.map((x) => x.action);
    expect(log).toEqual(['plan.create', 'plan.save', 'plan.risk_decision', 'plan.approve']);
  });
});
