import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText } from './common';
import { KINDS, type PlanObject, type PlanRoute } from '../../lib/floorplan';
import { monitoringByCode } from './ccp';

/**
 * Этапы ТТК на 2D-плане (мастер-промт, раздел 6): операция → место (стол, оборудование, зона) → состояние продукта.
 * Из последовательности мест утверждённых ТТК строится схема движения продукта по плану; её отрезки проверяются
 * теми же правилами поточности, что и маршруты потоков. Это схема последовательности (прямые между местами),
 * а не трассировка пути вокруг оборудования.
 */

export const STATE: Record<string, string> = { raw: 'сырьё', semi: 'полуфабрикат', ready: 'готовая продукция' };

const StageIn = z.object({
  operation: z.string().trim().min(3, 'Опишите операцию этапа.').max(300),
  plan_object_id: z.uuid().nullable().optional(),
  state: z.enum(['raw', 'semi', 'ready'], 'Укажите состояние продукта после этапа.'),
  params: optText(300), control: optText(300),
  // этап — ККТ/ОПП плана ХАССП: код опасности утверждённого плана; при выпуске нужен замер по её мониторингу
  ccp_code: z.string().trim().max(20).nullable().optional().transform((v) => v || null),
});

async function versionFor(tx: Tx, orgId: string, versionId: string) {
  const v = (await tx.query(`select v.*, d.name as dish from ttk_versions v join dishes d on d.id = v.dish_id where v.id = $1 and v.organization_id = $2`, [parse(z.uuid(), versionId), orgId])).rows[0];
  if (!v) throw Errors.notFound('Версия ТТК не найдена.');
  return v;
}

export async function getStages(userId: string, orgId: string, versionId: string) {
  return inOrg(userId, orgId, 'menu.read', async (tx) => {
    const v = await versionFor(tx, orgId, versionId);
    const stages = (await tx.query(`select s.id, s.position, s.operation, s.plan_id, s.plan_object_id, s.state, s.params, s.control, s.ccp_code, o.kind, o.label, fp.name as plan
      from ttk_stages s left join plan_objects o on o.id = s.plan_object_id and o.plan_id = s.plan_id left join floor_plans fp on fp.id = s.plan_id
      where s.version_id = $1 order by s.position`, [v.id])).rows
      .map((s) => ({ ...s, place: s.plan_object_id ? (s.kind ? `${s.label || KINDS[s.kind]?.label || s.kind} (${s.plan})` : null) : null, place_missing: !!s.plan_object_id && !s.kind }));
    // места для выбора: оборудование, зоны и помещения всех планов организации
    const places = (await tx.query(`select o.id, o.plan_id, o.kind, o.label, o.props->>'no' as no, fp.name as plan from plan_objects o join floor_plans fp on fp.id = o.plan_id
      where o.organization_id = $1 and fp.status = 'draft' and o.kind not in ('wall', 'column', 'door', 'window', 'water', 'drain', 'power', 'vent') order by fp.name, o.kind, o.label`, [orgId])).rows
      .map((o) => ({ id: o.id, plan_id: o.plan_id, label: `${o.plan}: ${o.no ? `№ ${o.no} ` : ''}${o.label || KINDS[o.kind]?.label || o.kind}` }));
    // ККТ и ОПП утверждённого плана ХАССП с мониторингом — для связи этапа
    const ccps = (await tx.query(`select h.code, h.class, h.description, m.what, m.record_form from haccp_plans p join haccp_hazards h on h.plan_id = p.id join haccp_monitoring m on m.hazard_id = h.id
      where p.organization_id = $1 and p.status = 'approved' and h.class in ('ccp', 'oprp') order by h.code`, [orgId])).rows;
    return { version: { id: v.id, version: v.version, status: v.status, dish: v.dish }, stages, places, ccps };
  });
}

/** Этапы черновика сохраняются целиком; место — объект существующего плана организации. */
export async function saveStages(userId: string, orgId: string, versionId: string, input: unknown) {
  const d = parse(z.object({ stages: z.array(StageIn).max(60) }), input);
  return inOrg(userId, orgId, 'ttk.manage', async (tx) => {
    const v = await versionFor(tx, orgId, versionId);
    if (v.status !== 'draft') throw Errors.conflict('Этапы меняются только в черновике ТТК — создайте новую версию.');
    const ids = d.stages.map((s) => s.plan_object_id).filter(Boolean) as string[];
    const objs = new Map((await tx.query(`select o.id, o.plan_id from plan_objects o where o.organization_id = $1 and o.id = any($2::uuid[])`, [orgId, ids])).rows.map((o) => [o.id as string, o.plan_id as string]));
    const missing = ids.filter((id) => !objs.has(id));
    if (missing.length) throw Errors.validation('Место этапа не найдено на планах организации — обновите страницу.');
    const codes = [...new Set(d.stages.map((s) => s.ccp_code).filter(Boolean) as string[])];
    if (codes.length) {
      const known = new Set((await monitoringByCode(tx, orgId, codes)).keys());
      const unknown = codes.filter((c) => !known.has(c));
      if (unknown.length) throw Errors.validation(`Нет в утверждённом плане ХАССП среди ККТ/ОПП с мониторингом: ${unknown.join(', ')}.`);
    }
    await tx.query(`delete from ttk_stages where version_id = $1`, [v.id]);
    for (const [i, s] of d.stages.entries()) {
      await tx.query(`insert into ttk_stages (organization_id, version_id, position, operation, plan_id, plan_object_id, state, params, control, ccp_code) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [orgId, v.id, i + 1, s.operation, s.plan_object_id ? objs.get(s.plan_object_id) : null, s.plan_object_id || null, s.state, s.params, s.control, s.ccp_code]);
    }
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'ttk.stages', entityType: 'ttk_version', entityId: v.id, after: { stages: d.stages.length, placed: ids.length, ccp: codes } });
    return { ok: true, stages: d.stages.length };
  });
}

/**
 * Схемы движения продукта по плану из утверждённых ТТК: отрезок между соседними местами несёт состояние продукта
 * после предыдущего этапа. Идентификаторы детерминированы — решения специалиста по рискам к ним привязываются.
 */
export async function ttkRoutesForPlan(tx: Tx, planId: string, objects: PlanObject[]) {
  const rows = (await tx.query(`select s.position, s.plan_object_id, s.state, s.operation, d.id as dish_id, d.name as dish, v.version from ttk_stages s
      join ttk_versions v on v.id = s.version_id and v.status = 'approved' join dishes d on d.id = v.dish_id
    where s.plan_id = $1 order by d.name, s.position`, [planId])).rows;
  const byId = new Map(objects.map((o) => [o.id, o]));
  const out: (PlanRoute & { dish: string; dish_id: string; version: number; stages: string[]; from_id: string; to_id: string })[] = [];
  const dishes = [...new Set(rows.map((r) => r.dish_id))];
  for (const dishId of dishes) {
    const st = rows.filter((r) => r.dish_id === dishId && byId.has(r.plan_object_id));
    for (let i = 0; i + 1 < st.length; i++) {
      const a = byId.get(st[i].plan_object_id)!, b = byId.get(st[i + 1].plan_object_id)!;
      if (a.id === b.id) continue;
      out.push({ id: `ttk:${dishId}:${st[i].position}`, flow: st[i].state, label: `ТТК «${st[i].dish}»: ${st[i].operation} → ${st[i + 1].operation}`, points: [[a.x_mm, a.y_mm], [b.x_mm, b.y_mm]],
        dish: st[i].dish, dish_id: dishId, version: st[i].version, stages: [st[i].operation, st[i + 1].operation], from_id: a.id, to_id: b.id });
    }
  }
  return out;
}
