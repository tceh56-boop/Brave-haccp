import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText, getSite, assertSiteAccess } from './common';
import { KINDS, FLOWS, ZONE_CLASS, findRisks, type PlanObject, type PlanRoute } from '../../lib/floorplan';

/**
 * 2D-план предприятия (ТЗ 3.0 §15.2, §15.4; мастер-промт, раздел 4). Геометрия — в мм.
 *  - Черновик сохраняется целиком (объекты и маршруты) с проверкой ревизии: две правки одновременно не затирают друг друга.
 *  - Подложка — файл PNG/JPG (доказательство floor_plan) с калибровкой «мм на пиксель» по известному размеру.
 *  - Риски (наложения, пересечение потоков, поток через неподходящую зону, условные габариты) находятся автоматически,
 *    но это потенциальные риски: специалист подтверждает или отклоняет с обоснованием.
 *  - Утверждение — неизменяемый снимок версии с хешем и записью об изменении.
 */

const mm = z.coerce.number().refine((v) => Number.isFinite(v) && Math.abs(v) <= 1_000_000, 'Координата вне допустимых пределов.');
const pos = z.coerce.number().refine((v) => Number.isFinite(v) && v > 0 && v <= 500_000, 'Размер — больше нуля, в миллиметрах.');
const ObjIn = z.object({
  id: z.uuid('Идентификатор объекта — UUID.'), kind: z.string().refine((k) => k in KINDS, 'Неизвестный тип объекта.'), label: optText(120),
  x_mm: mm, y_mm: mm, w_mm: pos, h_mm: pos, rotation: z.coerce.number().refine((v) => Number.isFinite(v)).transform((v) => ((v % 360) + 360) % 360).default(0),
  zone_class: z.string().refine((k) => k in ZONE_CLASS, 'Неизвестное назначение зоны.').nullable().optional(),
  equipment_id: z.uuid().nullable().optional(), size_confirmed: z.boolean().default(false), props: z.record(z.string(), z.unknown()).default({}),
});
const RouteIn = z.object({ id: z.uuid('Идентификатор маршрута — UUID.'), flow: z.string().refine((k) => k in FLOWS, 'Неизвестный поток.'), label: optText(120),
  points: z.array(z.tuple([mm, mm])).min(2, 'Маршрут — не менее двух точек.').max(200) });
const SaveIn = z.object({
  revision: z.coerce.number().int(), name: z.string().trim().min(2, 'Название плана.').max(200).optional(),
  width_mm: z.coerce.number().int().min(1000).max(500000).optional(), height_mm: z.coerce.number().int().min(1000).max(500000).optional(),
  objects: z.array(ObjIn).max(2000), routes: z.array(RouteIn).max(300),
  background: z.object({ file_id: z.uuid().nullable(), mm_per_px: z.coerce.number().positive().nullable(), offset_x: mm.default(0), offset_y: mm.default(0) }).optional(),
  passage: z.object({ min_mm: z.coerce.number().int().min(300, 'Минимальный проход — от 300 мм.').max(5000).nullable(), basis: optText(300) })
    .refine((x) => x.min_mm === null || (x.basis && x.basis.length >= 5), 'Укажите основание минимальной ширины прохода: норматив, проект или инструкцию.').optional(),
});

async function planFor(tx: Tx, orgId: string, id: string, lock = false) {
  const p = (await tx.query(`select * from floor_plans where id = $1 and organization_id = $2 ${lock ? 'for update' : ''}`, [parse(z.uuid(), id), orgId])).rows[0];
  if (!p) throw Errors.notFound('План не найден.');
  return p;
}

async function content(tx: Tx, planId: string) {
  const objects = (await tx.query(`select id, kind, label, x_mm::float8 as x_mm, y_mm::float8 as y_mm, w_mm::float8 as w_mm, h_mm::float8 as h_mm, rotation::float8 as rotation,
    zone_class, equipment_id, size_confirmed, props from plan_objects where plan_id = $1 order by kind = 'room' desc, id`, [planId])).rows as PlanObject[];
  const routes = (await tx.query(`select id, flow, label, points from plan_routes where plan_id = $1 order by id`, [planId])).rows as PlanRoute[];
  return { objects, routes };
}

export async function listPlans(userId: string, orgId: string, siteId: string) {
  const sid = parse(z.uuid({ message: 'Выберите площадку.' }), siteId);
  return inOrg(userId, orgId, 'plan.read', async (tx) => (await tx.query(`select p.id, p.name, p.width_mm, p.height_mm, p.revision, p.updated_at,
      (select max(version) from floor_plan_versions v where v.plan_id = p.id) as approved_version, (select count(*)::int from plan_objects o where o.plan_id = p.id) as objects
    from floor_plans p where p.organization_id = $1 and p.site_id = $2 and p.status = 'draft' order by p.name`, [orgId, sid])).rows, sid);
}

const CreateIn = z.object({ siteId: z.uuid(), name: z.string().trim().min(2, 'Название плана.').max(200),
  width_mm: z.coerce.number().int().min(1000, 'Ширина — от 1 м.').max(500000), height_mm: z.coerce.number().int().min(1000, 'Глубина — от 1 м.').max(500000) });

export async function createPlan(userId: string, orgId: string, input: unknown) {
  const d = parse(CreateIn, input);
  return inOrg(userId, orgId, 'plan.manage', async (tx) => {
    await getSite(tx, orgId, d.siteId);
    const p = (await tx.query(`insert into floor_plans (organization_id, site_id, name, width_mm, height_mm, created_by) values ($1, $2, $3, $4, $5, $6) returning id`,
      [orgId, d.siteId, d.name, d.width_mm, d.height_mm, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: 'plan.create', entityType: 'floor_plan', entityId: p.id, after: d });
    return p;
  }, d.siteId);
}

export async function getPlan(userId: string, orgId: string, planId: string) {
  return inOrg(userId, orgId, 'plan.read', async (tx, m) => {
    const p = await planFor(tx, orgId, planId);
    assertSiteAccess(m, p.site_id);
    const c = await content(tx, p.id);
    const decisions = (await tx.query(`select d.risk_key, d.decision, d.rationale, d.measure, d.decided_at, u.full_name as decided_by from plan_risk_decisions d join users u on u.id = d.decided_by
      where d.plan_id = $1`, [p.id])).rows;
    const risks = findRisks(c.objects, c.routes, { minPassage: p.min_passage_mm, basis: p.min_passage_basis }).map((r) => ({ ...r, decision: decisions.find((x) => x.risk_key === r.key) || null }));
    const versions = (await tx.query(`select v.version, v.change_note, v.approved_at, v.content_hash, u.full_name as approved_by from floor_plan_versions v join users u on u.id = v.approved_by
      where v.plan_id = $1 order by v.version desc`, [p.id])).rows;
    const equipment = (await tx.query(`select id, name from equipment where organization_id = $1 and site_id = $2 and status <> 'retired' order by name`, [orgId, p.site_id])).rows;
    return { plan: p, ...c, risks, versions, equipment };
  });
}

/** Сохранение черновика целиком; ревизия защищает от затирания чужой правки. */
export async function savePlan(userId: string, orgId: string, planId: string, input: unknown) {
  const d = parse(SaveIn, input);
  return inOrg(userId, orgId, 'plan.manage', async (tx, m) => {
    const p = await planFor(tx, orgId, planId, true);
    assertSiteAccess(m, p.site_id);
    if (p.revision !== d.revision) throw Errors.conflict('План изменён другим сотрудником, пока вы его правили. Обновите страницу — ваши изменения не сохранены.');
    const ids = new Set<string>();
    for (const x of [...d.objects, ...d.routes]) { if (ids.has(x.id)) throw Errors.validation('Повторяющийся идентификатор объекта.'); ids.add(x.id); }
    const eq = d.objects.map((o) => o.equipment_id).filter(Boolean) as string[];
    if (eq.length && (await tx.query(`select count(*)::int as n from equipment where organization_id = $1 and site_id = $2 and id = any($3::uuid[])`, [orgId, p.site_id, eq])).rows[0].n !== new Set(eq).size)
      throw Errors.validation('Оборудование должно быть из карточек этой площадки.');
    const bg = d.background;
    if (bg?.file_id && !(await tx.query(`select 1 from evidence_files where id = $1 and organization_id = $2 and entity_type = 'floor_plan' and entity_id = $3 and mime in ('image/png', 'image/jpeg', 'image/webp')`,
      [bg.file_id, orgId, p.id])).rowCount) throw Errors.validation('Подложка — изображение PNG, JPG или WEBP, загруженное к этому плану.');
    await tx.query(`delete from plan_objects where plan_id = $1`, [p.id]);
    await tx.query(`delete from plan_routes where plan_id = $1`, [p.id]);
    for (const o of d.objects) {
      await tx.query(`insert into plan_objects (id, organization_id, plan_id, kind, label, x_mm, y_mm, w_mm, h_mm, rotation, zone_class, equipment_id, size_confirmed, props)
        values ($14, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [orgId, p.id, o.kind, o.label, o.x_mm, o.y_mm, o.w_mm, o.h_mm, o.rotation, o.zone_class || null, o.equipment_id || null, o.size_confirmed, JSON.stringify(o.props), o.id]);
    }
    for (const r of d.routes) {
      await tx.query(`insert into plan_routes (id, organization_id, plan_id, flow, label, points) values ($6, $1, $2, $3, $4, $5)`, [orgId, p.id, r.flow, r.label, JSON.stringify(r.points), r.id]);
    }
    const row = (await tx.query(`update floor_plans set revision = revision + 1, updated_at = now(), name = coalesce($2, name), width_mm = coalesce($3, width_mm), height_mm = coalesce($4, height_mm),
        background_file_id = case when $5::boolean then $6::uuid else background_file_id end, bg_mm_per_px = case when $5::boolean then $7::numeric else bg_mm_per_px end,
        bg_offset_x = case when $5::boolean then $8::numeric else bg_offset_x end, bg_offset_y = case when $5::boolean then $9::numeric else bg_offset_y end,
        min_passage_mm = case when $10::boolean then $11::int else min_passage_mm end, min_passage_basis = case when $10::boolean then $12::text else min_passage_basis end
      where id = $1 returning revision`, [p.id, d.name ?? null, d.width_mm ?? null, d.height_mm ?? null, !!bg, bg?.file_id ?? null, bg?.mm_per_px ?? null, bg?.offset_x ?? 0, bg?.offset_y ?? 0,
        !!d.passage, d.passage?.min_mm ?? null, d.passage?.min_mm ? d.passage.basis : null])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: p.site_id, actorUserId: userId, action: 'plan.save', entityType: 'floor_plan', entityId: p.id,
      after: { revision: row.revision, objects: d.objects.length, routes: d.routes.length } });
    return { revision: row.revision as number };
  });
}

/** Решение специалиста по риску: подтвердить (с мерой) или отклонить (с обоснованием). */
export async function decideRisk(userId: string, orgId: string, planId: string, input: unknown) {
  const d = parse(z.object({ riskKey: z.string().min(3).max(300), decision: z.enum(['confirmed', 'rejected']),
    rationale: z.string().trim().min(10, 'Обоснуйте решение: почему риск применим или неприменим к объекту.').max(2000), measure: optText(1000) })
    .refine((x) => x.decision === 'rejected' || (x.measure && x.measure.length >= 5), 'Для подтверждённого риска укажите меру управления.'), input);
  return inOrg(userId, orgId, 'plan.approve', async (tx, m) => {
    const p = await planFor(tx, orgId, planId);
    assertSiteAccess(m, p.site_id);
    const c = await content(tx, p.id);
    if (!findRisks(c.objects, c.routes, { minPassage: p.min_passage_mm, basis: p.min_passage_basis }).some((r) => r.key === d.riskKey)) throw Errors.conflict('Такого риска в текущем плане нет — план изменился. Обновите страницу.');
    await tx.query(`insert into plan_risk_decisions (organization_id, plan_id, risk_key, decision, rationale, measure, decided_by) values ($1, $2, $3, $4, $5, $6, $7)
      on conflict (plan_id, risk_key) do update set decision = excluded.decision, rationale = excluded.rationale, measure = excluded.measure, decided_by = excluded.decided_by, decided_at = now()`,
    [orgId, p.id, d.riskKey, d.decision, d.rationale, d.measure, userId]);
    await audit.record(tx, { organizationId: orgId, siteId: p.site_id, actorUserId: userId, action: 'plan.risk_decision', entityType: 'floor_plan', entityId: p.id, after: d });
    return { ok: true };
  });
}

/** Утверждение версии: неизменяемый снимок плана, рисков и решений с хешем. */
export async function approvePlan(userId: string, orgId: string, planId: string, input: unknown) {
  const d = parse(z.object({ changeNote: z.string().trim().min(3, 'Что утверждено или изменено (лист изменений).').max(500) }), input);
  return inOrg(userId, orgId, 'plan.approve', async (tx, m) => {
    const p = await planFor(tx, orgId, planId, true);
    assertSiteAccess(m, p.site_id);
    const c = await content(tx, p.id);
    if (!c.objects.some((o) => o.kind === 'room')) throw Errors.conflict('На плане нет ни одного помещения — утверждать нечего.');
    const decisions = (await tx.query(`select risk_key, decision, rationale, measure from plan_risk_decisions where plan_id = $1`, [p.id])).rows;
    const risks = findRisks(c.objects, c.routes, { minPassage: p.min_passage_mm, basis: p.min_passage_basis }).map((r) => ({ ...r, decision: decisions.find((x) => x.risk_key === r.key) || null }));
    const open = risks.filter((r) => r.severity === 'high' && !r.decision);
    if (open.length) throw Errors.conflict(`Нет решения специалиста по рискам (${open.length}): ${open.slice(0, 3).map((r) => r.title).join('; ')}${open.length > 3 ? '…' : ''}. Подтвердите с мерой или отклоните с обоснованием.`);
    const snapshot = { name: p.name, width_mm: p.width_mm, height_mm: p.height_mm, background_file_id: p.background_file_id, bg_mm_per_px: p.bg_mm_per_px, ...c, risks, revision: p.revision };
    const hash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    const n = Number((await tx.query(`select coalesce(max(version), 0) + 1 as n from floor_plan_versions where plan_id = $1`, [p.id])).rows[0].n);
    await tx.query(`insert into floor_plan_versions (organization_id, plan_id, version, snapshot, content_hash, change_note, approved_by) values ($1, $2, $3, $4, $5, $6, $7)`,
      [orgId, p.id, n, JSON.stringify(snapshot), hash, d.changeNote, userId]);
    await audit.record(tx, { organizationId: orgId, siteId: p.site_id, actorUserId: userId, action: 'plan.approve', entityType: 'floor_plan', entityId: p.id, after: { version: n, hash, note: d.changeNote } });
    return { version: n, content_hash: hash };
  });
}
