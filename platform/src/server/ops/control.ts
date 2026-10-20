import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText, getSite, assertSiteAccess, fmtNum } from './common';

/**
 * Объекты контроля (холодильники, склады, линии раздачи) и правила контроля.
 * ТЗ v2 §5: пределы, частота и места контроля задаются для конкретной применимости на основании
 * подтверждённого требования и утверждённой процедуры; одной универсальной температуры нет.
 * Правило вступает в силу только после утверждения (control.approve); прежнее утверждённое правило
 * объекта при этом выводится из действия, история версий сохраняется.
 */

export const KIND_LABEL: Record<string, string> = {
  fridge: 'Холодильник', freezer: 'Морозильник', room: 'Помещение / склад', hot_holding: 'Мармит / горячее хранение', line: 'Линия раздачи', other: 'Другое',
};

export interface Rule {
  id: string; control_object_id: string; parameter: string; unit: string; min_value: string | null; max_value: string | null;
  frequency_hours: string | null; grace_minutes: number; source_ref: string; reaction: string | null; allow_isolation: boolean;
  status: string; version: number;
}

export function criterionText(r: Pick<Rule, 'min_value' | 'max_value' | 'unit'>): string {
  if (r.min_value !== null && r.max_value !== null) return `от ${fmtNum(r.min_value)} до ${fmtNum(r.max_value)} ${r.unit}`;
  if (r.min_value !== null) return `не ниже ${fmtNum(r.min_value)} ${r.unit}`;
  return `не выше ${fmtNum(r.max_value)} ${r.unit}`;
}

export async function activeRule(tx: Tx, objectId: string, parameter = 'temperature'): Promise<Rule | null> {
  return (await tx.query(`select * from control_rules where control_object_id = $1 and parameter = $2 and status = 'approved'`, [objectId, parameter])).rows[0] || null;
}

const ObjectInput = z.object({
  siteId: z.uuid(),
  name: z.string().trim().min(2, 'Укажите название.').max(120),
  kind: z.enum(['fridge', 'freezer', 'room', 'hot_holding', 'line', 'other']),
  location: optText(200),
});

export async function listControlObjects(userId: string, orgId: string, siteId: string) {
  return inOrg(userId, orgId, 'control.read', async (tx) => {
    const rows = (await tx.query(`select o.*,
        r.id as rule_id, r.min_value, r.max_value, r.unit, r.frequency_hours, r.grace_minutes, r.source_ref, r.version,
        (select json_build_object('value', m.value, 'unit', m.unit, 'measured_at', m.measured_at, 'result', m.result)
           from measurements m where m.control_object_id = o.id order by m.measured_at desc limit 1) as last,
        (select count(*) from control_rules d where d.control_object_id = o.id and d.status = 'draft')::int as drafts
      from control_objects o left join control_rules r on r.control_object_id = o.id and r.status = 'approved' and r.parameter = 'temperature'
      where o.organization_id = $1 and o.site_id = $2 and o.status = 'active' order by o.name`, [orgId, siteId])).rows;
    return rows.map((o) => ({ ...o, kind_label: KIND_LABEL[o.kind], criterion: o.rule_id ? criterionText(o) : null, due: measurementDue(o) }));
  }, siteId);
}

/** Когда нужен следующий замер по правилу: «пропущен» после частоты + допуска. */
export function measurementDue(o: { rule_id?: string | null; frequency_hours?: string | number | null; grace_minutes?: number | null; last?: { measured_at: string } | null }, now = new Date()) {
  if (!o.rule_id || !o.frequency_hours) return { state: 'no_schedule' as const, due_at: null };
  if (!o.last) return { state: 'missed' as const, due_at: null };
  const dueAt = new Date(new Date(o.last.measured_at).getTime() + Number(o.frequency_hours) * 3600e3);
  const missedAt = new Date(dueAt.getTime() + (o.grace_minutes || 0) * 60e3);
  return { state: now > missedAt ? ('missed' as const) : now > dueAt ? ('due' as const) : ('ok' as const), due_at: dueAt.toISOString() };
}

export async function createControlObject(userId: string, orgId: string, input: unknown) {
  const d = parse(ObjectInput, input);
  return inOrg(userId, orgId, 'control.manage', async (tx) => {
    await getSite(tx, orgId, d.siteId);
    const code = randomBytes(5).toString('base64url').toUpperCase();
    const o = (await tx.query(`insert into control_objects (organization_id, site_id, name, kind, location, code) values ($1, $2, $3, $4, $5, $6) returning *`,
      [orgId, d.siteId, d.name, d.kind, d.location, code])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: 'control.object_create', entityType: 'control_object', entityId: o.id, after: o });
    return o;
  }, d.siteId);
}

const num = z.union([z.number(), z.string().trim().regex(/^-?\d+([.,]\d+)?$/).transform((s) => Number(s.replace(',', '.')))]);

const RuleInput = z.object({
  controlObjectId: z.uuid(),
  parameter: z.enum(['temperature', 'humidity']).default('temperature'),
  minValue: num.optional().nullable(),
  maxValue: num.optional().nullable(),
  frequencyHours: num.optional().nullable(),
  graceMinutes: z.number().int().min(0).max(240).default(30),
  sourceRef: z.string({ error: 'Укажите основание: документ, пункт или утверждённую процедуру.' }).trim().min(5, 'Укажите основание: документ, пункт или утверждённую процедуру.').max(500),
  reaction: optText(1000),
  allowIsolation: z.boolean().default(false),
}).refine((r) => r.minValue != null || r.maxValue != null, 'Задайте хотя бы одну границу.')
  .refine((r) => r.minValue == null || r.maxValue == null || r.minValue <= r.maxValue, 'Нижняя граница больше верхней.');

/** Проект правила. В силу не вступает до утверждения. */
export async function createRule(userId: string, orgId: string, input: unknown) {
  const d = parse(RuleInput, input);
  return inOrg(userId, orgId, 'control.manage', async (tx) => {
    const o = (await tx.query(`select id, site_id from control_objects where id = $1 and organization_id = $2`, [d.controlObjectId, orgId])).rows[0];
    if (!o) throw Errors.notFound('Объект контроля не найден.');
    const unit = d.parameter === 'temperature' ? '°C' : '%';
    const version = Number((await tx.query(`select coalesce(max(version), 0) + 1 as v from control_rules where control_object_id = $1 and parameter = $2`, [o.id, d.parameter])).rows[0].v);
    const r = (await tx.query(`insert into control_rules (organization_id, control_object_id, parameter, unit, min_value, max_value, frequency_hours, grace_minutes, source_ref, reaction, allow_isolation, version, created_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning *`,
      [orgId, o.id, d.parameter, unit, d.minValue ?? null, d.maxValue ?? null, d.frequencyHours ?? null, d.graceMinutes, d.sourceRef, d.reaction, d.allowIsolation, version, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: o.site_id, actorUserId: userId, action: 'control.rule_draft', entityType: 'control_rule', entityId: r.id, after: r });
    return r;
  });
}

export async function approveRule(userId: string, orgId: string, ruleId: string) {
  return inOrg(userId, orgId, 'control.approve', async (tx) => {
    const r = (await tx.query(`select r.*, o.site_id from control_rules r join control_objects o on o.id = r.control_object_id
      where r.id = $1 and r.organization_id = $2 for update of r`, [ruleId, orgId])).rows[0];
    if (!r) throw Errors.notFound('Правило не найдено.');
    if (r.status !== 'draft') throw Errors.conflict('Утвердить можно только проект правила.');
    const prev = (await tx.query(`update control_rules set status = 'retired', retired_at = now()
      where control_object_id = $1 and parameter = $2 and status = 'approved' returning id, version`, [r.control_object_id, r.parameter])).rows[0];
    const after = (await tx.query(`update control_rules set status = 'approved', approved_by = $2, approved_at = now() where id = $1 returning *`, [ruleId, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: r.site_id, actorUserId: userId, action: 'control.rule_approve', entityType: 'control_rule', entityId: ruleId,
      before: prev ? { replaced_rule: prev.id, version: prev.version } : undefined, after });
    return after;
  });
}

export async function listRules(userId: string, orgId: string, objectId: string) {
  return inOrg(userId, orgId, 'control.read', async (tx) => (await tx.query(
    `select r.*, cu.full_name as created_by_name, au.full_name as approved_by_name from control_rules r
       left join users cu on cu.id = r.created_by left join users au on au.id = r.approved_by
      where r.control_object_id = $1 and r.organization_id = $2 order by r.version desc`, [objectId, orgId])).rows.map((r) => ({ ...r, criterion: criterionText(r) })));
}

/** Карточка объекта: правило, последние замеры, партии на хранении, открытое отклонение, пропуск замера. */
export async function getControlObject(userId: string, orgId: string, objectId: string) {
  return inOrg(userId, orgId, 'control.read', async (tx, m) => {
    const o = (await tx.query(`select o.*, s.name as site_name from control_objects o join sites s on s.id = o.site_id where o.id = $1 and o.organization_id = $2`, [objectId, orgId])).rows[0];
    if (!o) throw Errors.notFound('Объект контроля не найден.');
    assertSiteAccess(m, o.site_id);
    const rule = await activeRule(tx, o.id);
    const history = (await tx.query(`select m.id, m.value, m.unit, m.measured_at, m.entered_at, m.is_late, m.result, m.criterion, m.comment, m.corrects_id, m.correction_reason,
        coalesce(u.full_name, 'датчик ' || m.sensor_id) as author
      from measurements m left join users u on u.id = m.author_user_id where m.control_object_id = $1 order by m.measured_at desc, m.entered_at desc limit 30`, [o.id])).rows;
    const lots = (await tx.query(`select l.id, p.name as product, l.lot_no, l.quantity, l.unit, l.status, l.expires_at from lots l join products p on p.id = l.product_id
      where l.storage_object_id = $1 and l.status in ('available', 'quarantine') order by p.name`, [o.id])).rows;
    const incident = (await tx.query(`select id, title, status, severity from incidents where entity_type = 'control_object' and entity_id = $1 and status <> 'closed' order by created_at desc limit 1`, [o.id])).rows[0] || null;
    const last = history.find((h) => !history.some((x) => x.corrects_id === h.id)) || null;
    return {
      object: { ...o, kind_label: KIND_LABEL[o.kind] },
      rule: rule ? { ...rule, criterion: criterionText(rule) } : null,
      due: measurementDue({ rule_id: rule?.id, frequency_hours: rule?.frequency_hours, grace_minutes: rule?.grace_minutes, last }),
      history, lots, incident,
    };
  });
}
