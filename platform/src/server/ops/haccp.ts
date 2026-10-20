import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { ROLES, isRole } from '../access/roles';
import { inOrg, parse, optText } from './common';
import { requirementRef } from './regulatory';

/**
 * План ХАССП (ТЗ v1 §10, ТЗ v2 §12, этап 5): этапы процесса с подтверждением на месте → опасности по этапам с
 * оценкой вероятности и тяжести → дерево решений → класс меры (PRP/OPRP/ККТ) назначает человек с обоснованием →
 * план мониторинга (что, где, как, частота, предел, прибор, ответственный, запись, реакция).
 * Система предлагает, но не назначает: класс без решения человека пуст, оценки «не известно» не равны нулю.
 * Утверждённая версия не правится — изменения идут новой версией с причиной; предыдущая становится «Заменён».
 */

export const HAZARD_TYPE: Record<string, string> = {
  biological: 'Биологическая', chemical: 'Химическая', physical: 'Физическая', allergen: 'Аллерген', radiological: 'Радиологическая', other: 'Иная',
};
export const CLASS_LABEL: Record<string, string> = { prp: 'ПРП', oprp: 'ОПРП', ccp: 'ККТ' };
export const PROPOSAL_LABEL: Record<string, string> = { ccp: 'ККТ', not_ccp: 'не ККТ', modify_step: 'изменить этап или процесс' };
export const PLAN_STATUS: Record<string, string> = { draft: 'Проект', approved: 'Утверждён', superseded: 'Заменён' };
const LEVEL = ['', 'низкая', 'средняя', 'высокая'];

/** Вопросы дерева решений (Кодекс Алиментариус, CAC/RCP 1-1969). Ответы даёт группа ХАССП. */
export const TREE = [
  { key: 'q1', text: 'Существуют ли меры управления для этой опасности на этом или последующих этапах?' },
  { key: 'q1a', text: 'Необходимо ли управление на этом этапе для безопасности продукции?', when: { q1: false } },
  { key: 'q2', text: 'Этап специально предназначен для устранения опасности или снижения до допустимого уровня?', when: { q1: true } },
  { key: 'q3', text: 'Может ли загрязнение возникнуть или возрасти до недопустимого уровня?', when: { q1: true, q2: false } },
  { key: 'q4', text: 'Устранит ли опасность или снизит её до допустимого уровня последующий этап?', when: { q1: true, q2: false, q3: true } },
] as const;

type Answers = Partial<Record<'q1' | 'q1a' | 'q2' | 'q3' | 'q4', boolean>>;

/** Предложение по дереву решений; неполные ответы — нет предложения. */
export function treeProposal(a: Answers): 'ccp' | 'not_ccp' | 'modify_step' | null {
  if (a.q1 === undefined) return null;
  if (a.q1 === false) return a.q1a === undefined ? null : a.q1a ? 'modify_step' : 'not_ccp';
  if (a.q2 === undefined) return null;
  if (a.q2) return 'ccp';
  if (a.q3 === undefined) return null;
  if (!a.q3) return 'not_ccp';
  if (a.q4 === undefined) return null;
  return a.q4 ? 'not_ccp' : 'ccp';
}

export function riskText(l: number | null, s: number | null) {
  if (!l || !s) return 'не оценено';
  return `${l}×${s} = ${l * s} (вероятность ${LEVEL[l]}, тяжесть ${LEVEL[s]})`;
}

const roleLabel = (r: string | null) => (r && isRole(r) ? ROLES[r].label : r || '');

async function draftPlan(tx: Tx, orgId: string, planId: string) {
  const p = (await tx.query(`select * from haccp_plans where id = $1 and organization_id = $2 for update`, [planId, orgId])).rows[0];
  if (!p) throw Errors.notFound('План ХАССП не найден.');
  if (p.status !== 'draft') throw Errors.conflict('План утверждён — изменения вносятся новой версией.');
  return p;
}

async function planOf(tx: Tx, orgId: string, table: 'haccp_steps' | 'haccp_hazards' | 'haccp_monitoring', id: string) {
  const r = (await tx.query(`select * from ${table} where id = $1 and organization_id = $2`, [id, orgId])).rows[0];
  if (!r) throw Errors.notFound('Запись плана не найдена.');
  await draftPlan(tx, orgId, r.plan_id);
  return r;
}

async function loadPlan(tx: Tx, orgId: string, plan: Record<string, any>) {
  const steps = (await tx.query(`select s.*, u.full_name as confirmed_by_name from haccp_steps s left join users u on u.id = s.confirmed_by
    where s.plan_id = $1 order by s.position, s.name`, [plan.id])).rows;
  const hazards = (await tx.query(`select h.*, u.full_name as classified_by_name from haccp_hazards h left join users u on u.id = h.classified_by
    where h.plan_id = $1 order by h.code`, [plan.id])).rows;
  const monitoring = (await tx.query(`select m.*, r.status as rule_status, r.min_value, r.max_value, r.unit, o.name as object_name from haccp_monitoring m
    left join control_rules r on r.id = m.control_rule_id left join control_objects o on o.id = r.control_object_id where m.plan_id = $1`, [plan.id])).rows;
  const byHazard = new Map(monitoring.map((m) => [m.hazard_id, { ...m, responsible_label: roleLabel(m.responsible_role) }]));
  const stepName = new Map(steps.map((s) => [s.id, s.name]));
  const hz = hazards.map((h) => ({
    ...h, type_label: HAZARD_TYPE[h.hazard_type], step_name: stepName.get(h.step_id), risk: riskText(h.likelihood, h.severity),
    score: h.likelihood && h.severity ? h.likelihood * h.severity : null,
    proposal_label: h.proposal ? PROPOSAL_LABEL[h.proposal] : null, class_label: h.class ? CLASS_LABEL[h.class] : null, monitoring: byHazard.get(h.id) || null,
  }));
  return {
    plan: { ...plan, status_label: PLAN_STATUS[plan.status], approved_by_name: plan.approved_by ? (await tx.query(`select full_name from users where id = $1`, [plan.approved_by])).rows[0]?.full_name : null } as Record<string, any>,
    steps, hazards: hz, blockers: plan.status === 'draft' ? blockers(plan, steps, hz) : [],
  };
}

/** Что мешает утвердить план — понятным списком. */
function blockers(plan: Record<string, any>, steps: Record<string, any>[], hazards: (Record<string, any> & { monitoring: Record<string, any> | null })[]): string[] {
  const out: string[] = [];
  if (!plan.scope?.trim()) out.push('Не указана область применения плана.');
  if (!steps.length) out.push('Нет этапов процесса.');
  for (const s of steps) if (!s.confirmed_at) out.push(`Этап «${s.name}» не подтверждён на месте.`);
  if (!hazards.length) out.push('Не внесено ни одной опасности.');
  for (const h of hazards) {
    const n = `${h.code} (${h.step_name})`;
    if (!h.likelihood || !h.severity) out.push(`${n}: не оценены вероятность и тяжесть.`);
    if (!h.control_measures) out.push(`${n}: не указаны меры управления.`);
    if (!h.class) out.push(`${n}: класс меры (ПРП/ОПРП/ККТ) не назначен человеком.`);
    if (h.class === 'ccp' || h.class === 'oprp') {
      const m = h.monitoring;
      if (!m) out.push(`${n}: нет плана мониторинга.`);
      else {
        if (h.class === 'ccp' && !m.critical_limit) out.push(`${n}: для ККТ не указан критический предел.`);
        if (m.control_rule_id && m.rule_status !== 'approved') out.push(`${n}: связанное правило контроля не утверждено.`);
      }
    }
  }
  return out;
}

/** Текущий план: проект (если идёт работа) или утверждённый; плюс список версий. */
export async function getPlan(userId: string, orgId: string, planId?: string | null) {
  return inOrg(userId, orgId, 'haccp.read', async (tx) => {
    const versions = (await tx.query(`select p.id, p.version, p.status, p.created_at, p.approved_at, p.change_reason, u.full_name as approved_by_name
      from haccp_plans p left join users u on u.id = p.approved_by where p.organization_id = $1 order by p.version desc`, [orgId])).rows
      .map((v) => ({ ...v, status_label: PLAN_STATUS[v.status] }));
    const id = planId || versions.find((v) => v.status === 'draft')?.id || versions.find((v) => v.status === 'approved')?.id;
    if (!id) return { versions, current: null, tree: TREE };
    const plan = (await tx.query(`select * from haccp_plans where id = $1 and organization_id = $2`, [id, orgId])).rows[0];
    if (!plan) throw Errors.notFound('План ХАССП не найден.');
    return { versions, current: await loadPlan(tx, orgId, plan), tree: TREE };
  });
}

/** Утверждённый план (для журналов J30–J32 и пакета проверки). */
export async function approvedPlan(tx: Tx, orgId: string) {
  const plan = (await tx.query(`select * from haccp_plans where organization_id = $1 and status = 'approved'`, [orgId])).rows[0];
  return plan ? loadPlan(tx, orgId, plan) : null;
}

const PlanInput = z.object({ scope: z.string().trim().min(5, 'Опишите область применения: продукция, процессы, площадки.').max(2000), team: optText(1000) });

/** Первая версия — с нуля; следующая — копия утверждённой с причиной изменения. */
export async function createPlan(userId: string, orgId: string, input: unknown) {
  return inOrg(userId, orgId, 'haccp.manage', async (tx) => {
    const cur = (await tx.query(`select * from haccp_plans where organization_id = $1 and status in ('draft', 'approved') order by version desc`, [orgId])).rows;
    if (cur.some((p) => p.status === 'draft')) throw Errors.conflict('Проект плана уже есть — продолжите работу с ним.');
    const approved = cur.find((p) => p.status === 'approved');
    if (!approved) {
      const d = parse(PlanInput, input);
      const p = (await tx.query(`insert into haccp_plans (organization_id, version, scope, team, created_by) values ($1, 1, $2, $3, $4) returning *`, [orgId, d.scope, d.team, userId])).rows[0];
      await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'haccp.plan_create', entityType: 'haccp_plan', entityId: p.id, after: { version: 1, scope: d.scope } });
      return p;
    }
    const d = parse(z.object({ changeReason: z.string('Укажите причину новой версии.').trim().min(5, 'Укажите причину новой версии.').max(1000) }), input);
    const p = (await tx.query(`insert into haccp_plans (organization_id, version, scope, team, based_on_id, change_reason, created_by)
      values ($1, $2, $3, $4, $5, $6, $7) returning *`, [orgId, approved.version + 1, approved.scope, approved.team, approved.id, d.changeReason, userId])).rows[0];
    const stepMap = new Map<string, string>();
    for (const s of (await tx.query(`select * from haccp_steps where plan_id = $1 order by position`, [approved.id])).rows) {
      const n = (await tx.query(`insert into haccp_steps (organization_id, plan_id, position, name, description, confirmed_by, confirmed_at, confirmation_note)
        values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`, [orgId, p.id, s.position, s.name, s.description, s.confirmed_by, s.confirmed_at, s.confirmation_note])).rows[0];
      stepMap.set(s.id, n.id);
    }
    for (const h of (await tx.query(`select * from haccp_hazards where plan_id = $1`, [approved.id])).rows) {
      const n = (await tx.query(`insert into haccp_hazards (organization_id, plan_id, step_id, code, hazard_type, description, requirement_id, likelihood, severity, control_measures,
          answers, proposal, class, class_rationale, classified_by, classified_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) returning id`,
        [orgId, p.id, stepMap.get(h.step_id), h.code, h.hazard_type, h.description, h.requirement_id, h.likelihood, h.severity, h.control_measures,
          JSON.stringify(h.answers), h.proposal, h.class, h.class_rationale, h.classified_by, h.classified_at])).rows[0];
      await tx.query(`insert into haccp_monitoring (organization_id, plan_id, hazard_id, what, where_text, method, frequency, critical_limit, device, responsible_role, record_form, corrective_action, control_rule_id)
        select organization_id, $2, $3, what, where_text, method, frequency, critical_limit, device, responsible_role, record_form, corrective_action, control_rule_id
        from haccp_monitoring where hazard_id = $1`, [h.id, p.id, n.id]);
    }
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'haccp.plan_new_version', entityType: 'haccp_plan', entityId: p.id, after: { version: p.version, based_on: approved.version }, reason: d.changeReason });
    return p;
  });
}

export async function updatePlan(userId: string, orgId: string, planId: string, input: unknown) {
  const d = parse(PlanInput, input);
  return inOrg(userId, orgId, 'haccp.manage', async (tx) => {
    const p = await draftPlan(tx, orgId, planId);
    await tx.query(`update haccp_plans set scope = $2, team = $3 where id = $1`, [planId, d.scope, d.team]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'haccp.plan_update', entityType: 'haccp_plan', entityId: planId, before: { scope: p.scope, team: p.team }, after: d });
    return { ok: true };
  });
}

const StepInput = z.object({ name: z.string().trim().min(2, 'Название этапа.').max(200), description: optText(2000), position: z.coerce.number().int().min(0).max(999).optional() });

export async function addStep(userId: string, orgId: string, planId: string, input: unknown) {
  const d = parse(StepInput, input);
  return inOrg(userId, orgId, 'haccp.manage', async (tx) => {
    await draftPlan(tx, orgId, planId);
    const pos = d.position ?? Number((await tx.query(`select coalesce(max(position), 0) + 1 as n from haccp_steps where plan_id = $1`, [planId])).rows[0].n);
    const s = (await tx.query(`insert into haccp_steps (organization_id, plan_id, position, name, description) values ($1, $2, $3, $4, $5) returning *`, [orgId, planId, pos, d.name, d.description])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'haccp.step_add', entityType: 'haccp_step', entityId: s.id, after: d });
    return s;
  });
}

/** Изменение этапа снимает подтверждение на месте — схему нужно проверить заново. */
export async function updateStep(userId: string, orgId: string, stepId: string, input: unknown) {
  const d = parse(StepInput, input);
  return inOrg(userId, orgId, 'haccp.manage', async (tx) => {
    const s = await planOf(tx, orgId, 'haccp_steps', stepId);
    await tx.query(`update haccp_steps set name = $2, description = $3, position = coalesce($4, position), confirmed_by = null, confirmed_at = null, confirmation_note = null where id = $1`,
      [stepId, d.name, d.description, d.position ?? null]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'haccp.step_update', entityType: 'haccp_step', entityId: stepId, before: { name: s.name, description: s.description }, after: d });
    return { ok: true };
  });
}

export async function removeStep(userId: string, orgId: string, stepId: string) {
  return inOrg(userId, orgId, 'haccp.manage', async (tx) => {
    const s = await planOf(tx, orgId, 'haccp_steps', stepId);
    if ((await tx.query(`select 1 from haccp_hazards where step_id = $1`, [stepId])).rowCount) throw Errors.conflict('На этапе есть опасности — сначала перенесите или удалите их.');
    await tx.query(`delete from haccp_steps where id = $1`, [stepId]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'haccp.step_remove', entityType: 'haccp_step', entityId: stepId, before: { name: s.name } });
    return { ok: true };
  });
}

/** Подтверждение схемы на месте: кто, когда и что проверил. */
export async function confirmStep(userId: string, orgId: string, stepId: string, input: unknown) {
  const d = parse(z.object({ note: z.string().trim().min(5, 'Опишите, как подтверждено на месте.').max(1000) }), input);
  return inOrg(userId, orgId, 'haccp.manage', async (tx) => {
    await planOf(tx, orgId, 'haccp_steps', stepId);
    await tx.query(`update haccp_steps set confirmed_by = $2, confirmed_at = now(), confirmation_note = $3 where id = $1`, [stepId, userId, d.note]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'haccp.step_confirm', entityType: 'haccp_step', entityId: stepId, after: d });
    return { ok: true };
  });
}

const Level = z.coerce.number().int().min(1).max(3).nullable().optional();
const HazardInput = z.object({
  stepId: z.uuid(),
  hazardType: z.enum(Object.keys(HAZARD_TYPE) as [string, ...string[]]),
  description: z.string().trim().min(5, 'Опишите опасность.').max(2000),
  requirementId: z.uuid().nullable().optional(),
  likelihood: Level, severity: Level,
  controlMeasures: optText(2000),
});

async function stepInPlan(tx: Tx, orgId: string, planId: string, stepId: string) {
  if (!(await tx.query(`select 1 from haccp_steps where id = $1 and plan_id = $2 and organization_id = $3`, [stepId, planId, orgId])).rowCount) throw Errors.validation('Этап не из этого плана.');
}

export async function addHazard(userId: string, orgId: string, planId: string, input: unknown) {
  const d = parse(HazardInput, input);
  return inOrg(userId, orgId, 'haccp.manage', async (tx) => {
    await draftPlan(tx, orgId, planId);
    await stepInPlan(tx, orgId, planId, d.stepId);
    if (d.requirementId) await requirementRef(tx, orgId, d.requirementId);
    const n = Number((await tx.query(`select count(*) from haccp_hazards where plan_id = $1`, [planId])).rows[0].count) + 1;
    let code = `О-${String(n).padStart(2, '0')}`;
    while ((await tx.query(`select 1 from haccp_hazards where plan_id = $1 and code = $2`, [planId, code])).rowCount) code = `О-${String(Number(code.slice(2)) + 1).padStart(2, '0')}`;
    const h = (await tx.query(`insert into haccp_hazards (organization_id, plan_id, step_id, code, hazard_type, description, requirement_id, likelihood, severity, control_measures)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`, [orgId, planId, d.stepId, code, d.hazardType, d.description, d.requirementId || null, d.likelihood ?? null, d.severity ?? null, d.controlMeasures])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'haccp.hazard_add', entityType: 'haccp_hazard', entityId: h.id, after: { code, ...d } });
    return h;
  });
}

/** Изменение сути опасности или оценки снимает назначенный класс — решение принимается заново. */
export async function updateHazard(userId: string, orgId: string, hazardId: string, input: unknown) {
  const d = parse(HazardInput, input);
  return inOrg(userId, orgId, 'haccp.manage', async (tx) => {
    const h = await planOf(tx, orgId, 'haccp_hazards', hazardId);
    await stepInPlan(tx, orgId, h.plan_id, d.stepId);
    if (d.requirementId) await requirementRef(tx, orgId, d.requirementId);
    const changed = h.description !== d.description || h.hazard_type !== d.hazardType || h.likelihood !== (d.likelihood ?? null) || h.severity !== (d.severity ?? null)
      || (h.control_measures || null) !== d.controlMeasures || h.step_id !== d.stepId;
    await tx.query(`update haccp_hazards set step_id = $2, hazard_type = $3, description = $4, requirement_id = $5, likelihood = $6, severity = $7, control_measures = $8
      ${changed ? ', class = null, class_rationale = null, classified_by = null, classified_at = null' : ''} where id = $1`,
      [hazardId, d.stepId, d.hazardType, d.description, d.requirementId || null, d.likelihood ?? null, d.severity ?? null, d.controlMeasures]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'haccp.hazard_update', entityType: 'haccp_hazard', entityId: hazardId,
      before: { description: h.description, likelihood: h.likelihood, severity: h.severity, class: h.class }, after: { ...d, class_reset: changed && !!h.class } });
    return { ok: true, classReset: changed && !!h.class };
  });
}

export async function removeHazard(userId: string, orgId: string, hazardId: string) {
  return inOrg(userId, orgId, 'haccp.manage', async (tx) => {
    const h = await planOf(tx, orgId, 'haccp_hazards', hazardId);
    await tx.query(`delete from haccp_monitoring where hazard_id = $1`, [hazardId]);
    await tx.query(`delete from haccp_hazards where id = $1`, [hazardId]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'haccp.hazard_remove', entityType: 'haccp_hazard', entityId: hazardId, before: { code: h.code, description: h.description } });
    return { ok: true };
  });
}

/** Ответы на дерево решений → предложение системы. Класс остаётся за человеком. */
export async function answerTree(userId: string, orgId: string, hazardId: string, input: unknown) {
  const a = parse(z.object({ q1: z.boolean().optional(), q1a: z.boolean().optional(), q2: z.boolean().optional(), q3: z.boolean().optional(), q4: z.boolean().optional() }), input);
  // Ответы на неактуальные ветки отбрасываются.
  const clean: Answers = {};
  for (const q of TREE) {
    const when = 'when' in q ? q.when : {};
    if (Object.entries(when).every(([k, v]) => clean[k as keyof Answers] === v) && a[q.key] !== undefined) clean[q.key] = a[q.key];
  }
  const proposal = treeProposal(clean);
  return inOrg(userId, orgId, 'haccp.manage', async (tx) => {
    await planOf(tx, orgId, 'haccp_hazards', hazardId);
    await tx.query(`update haccp_hazards set answers = $2, proposal = $3 where id = $1`, [hazardId, JSON.stringify(clean), proposal]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'haccp.hazard_tree', entityType: 'haccp_hazard', entityId: hazardId, after: { answers: clean, proposal } });
    return { answers: clean, proposal, proposal_label: proposal ? PROPOSAL_LABEL[proposal] : null };
  });
}

/** Назначение класса меры человеком: обоснование обязательно; несогласие с деревом решений — подробно. */
export async function classifyHazard(userId: string, orgId: string, hazardId: string, input: unknown) {
  const d = parse(z.object({ class: z.enum(['prp', 'oprp', 'ccp']), rationale: z.string().trim().min(10, 'Обоснуйте решение группы ХАССП.').max(2000) }), input);
  return inOrg(userId, orgId, 'haccp.manage', async (tx) => {
    const h = await planOf(tx, orgId, 'haccp_hazards', hazardId);
    if (!h.likelihood || !h.severity) throw Errors.validation('Сначала оцените вероятность и тяжесть опасности.');
    if (!h.control_measures) throw Errors.validation('Сначала укажите меры управления.');
    const disagree = h.proposal && ((h.proposal === 'ccp') !== (d.class === 'ccp'));
    if (disagree && d.rationale.length < 30) throw Errors.validation(`Решение расходится с деревом решений (${PROPOSAL_LABEL[h.proposal]}) — обоснуйте подробнее.`);
    await tx.query(`update haccp_hazards set class = $2, class_rationale = $3, classified_by = $4, classified_at = now() where id = $1`, [hazardId, d.class, d.rationale, userId]);
    if (d.class === 'prp') await tx.query(`delete from haccp_monitoring where hazard_id = $1`, [hazardId]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'haccp.hazard_classify', entityType: 'haccp_hazard', entityId: hazardId,
      before: { class: h.class }, after: { class: d.class, proposal: h.proposal, disagree: !!disagree }, reason: d.rationale });
    return { ok: true };
  });
}

const MonitoringInput = z.object({
  what: z.string().trim().min(3, 'Что контролируется.').max(500),
  where: optText(300),
  method: z.string().trim().min(3, 'Как контролируется.').max(1000),
  frequency: z.string().trim().min(2, 'Как часто.').max(200),
  criticalLimit: optText(500),
  device: optText(200),
  responsibleRole: z.string().refine(isRole, 'Выберите ответственную роль.'),
  recordForm: z.string().regex(/^J\d{2}$/).nullable().optional(),
  correctiveAction: z.string().trim().min(5, 'Реакция на отклонение.').max(2000),
  controlRuleId: z.uuid().nullable().optional(),
});

/** План мониторинга для ОПРП/ККТ: может опираться на правило контроля объекта (тогда предел — из правила). */
export async function setMonitoring(userId: string, orgId: string, hazardId: string, input: unknown) {
  const d = parse(MonitoringInput, input);
  return inOrg(userId, orgId, 'haccp.manage', async (tx) => {
    const h = await planOf(tx, orgId, 'haccp_hazards', hazardId);
    if (h.class !== 'ccp' && h.class !== 'oprp') throw Errors.validation('План мониторинга ведётся для ОПРП и ККТ — сначала назначьте класс.');
    if (d.controlRuleId && !(await tx.query(`select 1 from control_rules where id = $1 and organization_id = $2`, [d.controlRuleId, orgId])).rowCount) throw Errors.validation('Правило контроля не найдено.');
    const m = (await tx.query(`insert into haccp_monitoring (organization_id, plan_id, hazard_id, what, where_text, method, frequency, critical_limit, device, responsible_role, record_form, corrective_action, control_rule_id)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      on conflict (hazard_id) do update set what = excluded.what, where_text = excluded.where_text, method = excluded.method, frequency = excluded.frequency,
        critical_limit = excluded.critical_limit, device = excluded.device, responsible_role = excluded.responsible_role, record_form = excluded.record_form,
        corrective_action = excluded.corrective_action, control_rule_id = excluded.control_rule_id returning *`,
      [orgId, h.plan_id, hazardId, d.what, d.where, d.method, d.frequency, d.criticalLimit, d.device, d.responsibleRole, d.recordForm || null, d.correctiveAction, d.controlRuleId || null])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'haccp.monitoring_set', entityType: 'haccp_hazard', entityId: hazardId, after: d });
    return m;
  });
}

/** Утверждение: только без препятствий; предыдущая утверждённая версия становится «Заменён». */
export async function approvePlan(userId: string, orgId: string, planId: string, input: unknown) {
  const d = parse(z.object({ note: optText(1000) }), input ?? {});
  return inOrg(userId, orgId, 'haccp.approve', async (tx) => {
    const p = await draftPlan(tx, orgId, planId);
    const full = await loadPlan(tx, orgId, p);
    if (full.blockers.length) throw Errors.validation(`Утвердить нельзя: ${full.blockers.join(' ')}`, full.blockers);
    await tx.query(`update haccp_plans set status = 'superseded' where organization_id = $1 and status = 'approved'`, [orgId]);
    await tx.query(`update haccp_plans set status = 'approved', approved_by = $2, approved_at = now(), approval_note = $3 where id = $1`, [planId, userId, d.note]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'haccp.plan_approve', entityType: 'haccp_plan', entityId: planId,
      after: { version: p.version, hazards: full.hazards.length, ccp: full.hazards.filter((h) => h.class === 'ccp').length }, reason: d.note || undefined });
    return { ok: true, version: p.version };
  });
}

/** Правила контроля организации для связи с мониторингом. */
export async function linkableRules(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'haccp.read', async (tx) => (await tx.query(`select r.id, r.status, r.parameter, r.min_value, r.max_value, r.unit, r.frequency_hours, o.name as object_name, s.name as site_name
    from control_rules r join control_objects o on o.id = r.control_object_id join sites s on s.id = o.site_id
    where r.organization_id = $1 and r.status in ('approved', 'draft') order by o.name`, [orgId])).rows);
}
