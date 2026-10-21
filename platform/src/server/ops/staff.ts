import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText, assertSiteAccess, getSite } from './common';
import { ROLES, roleHas, type Role } from '../access/roles';
import { FOOD_ROLES, medicalState } from '../access/admission';

/**
 * Персонал: готовность к работе (этап 16; перенос Safety.gs / EmployeeSafetyIntegration.gs прежнего ЦЕХ и допуска MON CHEF).
 *  - Медицинский допуск: номер ЛМК, даты и сроки медосмотра и гигиенической аттестации, ограничения — как в книжке.
 *    Вносит и видит даты только право «медицинский допуск»; остальные видят статус. Диагнозы не хранятся.
 *  - Осмотр перед сменой: «допущен» или «не допущен» с признаками и мерами; один раз в день; не допущен — при режиме
 *    «блокировать» записи по продукции от сотрудника не принимаются.
 *  - Инструктажи: тема (охрана труда, санминимум, ХАССП) с материалом, периодичностью и ролями. Проведение — вид,
 *    дата, результат, инструктирующий; следующий срок = дата + периодичность. Сотрудник подтверждает ознакомление сам.
 */

export const CATEGORY_LABEL: Record<string, string> = { safety: 'Охрана труда', sanitary: 'Санминимум', haccp: 'ХАССП' };
export const TYPE_LABEL: Record<string, string> = { intro: 'вводный', primary: 'первичный на рабочем месте', repeat: 'повторный', unscheduled: 'внеплановый', target: 'целевой', training: 'обучение' };
const MED_LABEL: Record<string, string> = { ok: 'допущен', soon: 'истекает', expired: 'срок истёк', missing: 'нет данных' };
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД.');
const addMonths = (s: string, n: number) => { const t = new Date(`${s}T12:00:00Z`); t.setUTCMonth(t.getUTCMonth() + n); return t.toISOString().slice(0, 10); };

async function todayOf(tx: Tx, orgId: string) {
  return (await tx.query(`select (now() at time zone timezone)::date::text as d from organizations where id = $1`, [orgId])).rows[0].d as string;
}
async function memberOf(tx: Tx, orgId: string, userId: string) {
  const m = (await tx.query(`select m.user_id, m.role, m.position, m.site_ids, m.status, u.full_name from memberships m join users u on u.id = m.user_id
    where m.organization_id = $1 and m.user_id = $2`, [orgId, userId])).rows[0];
  if (!m || m.status !== 'active') throw Errors.notFound('Сотрудник не найден.');
  return m;
}

/* ───────────── Готовность ───────────── */

/** Готовность сотрудников: медицинский допуск, осмотр сегодня, инструктажи по их ролям. */
async function readiness(tx: Tx, orgId: string, userIds: string[] | null, seeMedical: boolean) {
  const today = await todayOf(tx, orgId);
  const members = (await tx.query(`select m.user_id, m.role, m.position, m.site_ids, u.full_name from memberships m join users u on u.id = m.user_id
    where m.organization_id = $1 and m.status = 'active' and ($2::uuid[] is null or m.user_id = any($2::uuid[])) order by u.full_name`, [orgId, userIds])).rows;
  const ids = members.map((x) => x.user_id);
  const med = new Map((await tx.query(`select distinct on (user_id) user_id, med_book_no, exam_on::text as exam_on, exam_due::text as exam_due, hygiene_on::text as hygiene_on,
      hygiene_due::text as hygiene_due, restrictions, recorded_at from staff_medical where organization_id = $1 and user_id = any($2::uuid[]) order by user_id, recorded_at desc`, [orgId, ids])).rows
    .map((r) => [r.user_id, r]));
  const checks = new Map((await tx.query(`select h.user_id, h.admitted, h.signs, h.action, u.full_name as checked_by from health_checks h join users u on u.id = h.checked_by
    where h.organization_id = $1 and h.checked_on = $2 and h.user_id = any($3::uuid[])`, [orgId, today, ids])).rows.map((r) => [r.user_id, r]));
  const topics = (await tx.query(`select id, title, category, material, period_months, roles from briefing_topics where organization_id = $1 and status = 'active' order by category, title`, [orgId])).rows;
  const last = (await tx.query(`select distinct on (b.user_id, b.topic_id) b.id, b.user_id, b.topic_id, b.held_on::text as held_on, b.next_due::text as next_due, b.result, b.briefing_type,
      a.acknowledged_at from briefings b left join briefing_acks a on a.briefing_id = b.id
    where b.organization_id = $1 and b.user_id = any($2::uuid[]) and b.result = 'passed' order by b.user_id, b.topic_id, b.held_on desc, b.recorded_at desc`, [orgId, ids])).rows;
  return members.map((x) => {
    const food = FOOD_ROLES.includes(x.role);
    const ms = medicalState(med.get(x.user_id), today);
    const hc = checks.get(x.user_id) || null;
    const required = topics.filter((t) => !t.roles.length || t.roles.includes(x.role));
    const brief = required.map((t) => {
      const b = last.find((l) => l.user_id === x.user_id && l.topic_id === t.id);
      const state = !b ? 'missing' : b.next_due && b.next_due < today ? 'overdue' : !b.acknowledged_at ? 'unconfirmed' : 'ok';
      return { topic_id: t.id, title: t.title, category: t.category, category_label: CATEGORY_LABEL[t.category], held_on: b?.held_on || null, next_due: b?.next_due || null, briefing_id: b?.id || null, state };
    });
    const m = med.get(x.user_id);
    return {
      user_id: x.user_id, full_name: x.full_name, role: x.role, role_label: ROLES[x.role as Role]?.label || x.role, position: x.position, site_ids: x.site_ids, food,
      medical: { status: ms.status, label: MED_LABEL[ms.status], restrictions: ms.restrictions,
        ...(seeMedical ? { exam_on: m?.exam_on || null, exam_due: ms.exam_due, hygiene_on: m?.hygiene_on || null, hygiene_due: ms.hygiene_due, med_book_no: m?.med_book_no || null } : {}) },
      today_check: hc ? { admitted: hc.admitted, signs: hc.signs, action: hc.action, checked_by: hc.checked_by } : null,
      briefings: brief, briefings_due: brief.filter((b) => b.state === 'missing' || b.state === 'overdue').length,
    };
  });
}

export async function listStaff(userId: string, orgId: string, siteId: string | null) {
  return inOrg(userId, orgId, 'staff.read', async (tx, m) => {
    if (siteId) assertSiteAccess(m, siteId);
    const rows = await readiness(tx, orgId, null, roleHas(m.role, 'staff.medical'));
    const gate = (await tx.query(`select medical_gate from staff_settings where organization_id = $1`, [orgId])).rows[0]?.medical_gate || 'warn';
    const topics = (await tx.query(`select id, title, category, material, period_months, roles from briefing_topics where organization_id = $1 and status = 'active' order by category, title`, [orgId])).rows
      .map((t) => ({ ...t, category_label: CATEGORY_LABEL[t.category] }));
    return { gate, today: await todayOf(tx, orgId), staff: rows.filter((r) => !siteId || !r.site_ids.length || r.site_ids.includes(siteId)), topics };
  });
}

/** Карточка сотрудника — для ответственных или самого сотрудника (свои данные, включая даты ЛМК). */
export async function getStaffCard(userId: string, orgId: string, targetId: string) {
  return inOrg(userId, orgId, 'org.read', async (tx, m) => {
    const self = userId === targetId;
    if (!self && !roleHas(m.role, 'staff.read')) throw Errors.forbidden();
    await memberOf(tx, orgId, targetId);
    const [r] = await readiness(tx, orgId, [targetId], self || roleHas(m.role, 'staff.medical'));
    const history = (await tx.query(`select b.id, t.title, t.category, b.briefing_type, b.held_on::text as held_on, b.result, b.note, b.next_due::text as next_due, u.full_name as instructor, a.acknowledged_at
      from briefings b join briefing_topics t on t.id = b.topic_id join users u on u.id = b.instructor_id left join briefing_acks a on a.briefing_id = b.id
      where b.organization_id = $1 and b.user_id = $2 order by b.held_on desc, b.recorded_at desc limit 100`, [orgId, targetId])).rows
      .map((b) => ({ ...b, category_label: CATEGORY_LABEL[b.category], type_label: TYPE_LABEL[b.briefing_type] }));
    const checks = (await tx.query(`select h.checked_on::text as checked_on, h.admitted, h.signs, h.action, u.full_name as checked_by from health_checks h join users u on u.id = h.checked_by
      where h.organization_id = $1 and h.user_id = $2 order by h.checked_on desc limit 30`, [orgId, targetId])).rows;
    return { ...r, history, checks, self };
  });
}

/* ───────────── Медицинский допуск ───────────── */

const MedicalInput = z.object({
  medBookNo: optText(60), examOn: day.optional().nullable(), examDue: day, hygieneOn: day.optional().nullable(), hygieneDue: day, restrictions: optText(300),
}).refine((x) => !x.examOn || x.examDue > x.examOn, 'Срок медосмотра — позже даты прохождения.').refine((x) => !x.hygieneOn || x.hygieneDue > x.hygieneOn, 'Срок аттестации — позже даты прохождения.');

export async function setMedical(userId: string, orgId: string, targetId: string, input: unknown) {
  const d = parse(MedicalInput, input);
  return inOrg(userId, orgId, 'staff.medical', async (tx) => {
    const t = await memberOf(tx, orgId, targetId);
    await tx.query(`insert into staff_medical (organization_id, user_id, med_book_no, exam_on, exam_due, hygiene_on, hygiene_due, restrictions, recorded_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [orgId, targetId, d.medBookNo, d.examOn || null, d.examDue, d.hygieneOn || null, d.hygieneDue, d.restrictions, userId]);
    // в аудит — без дат о здоровье: только факт обновления
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'staff.medical', entityType: 'user', entityId: targetId, after: { employee: t.full_name } });
    return { ok: true };
  });
}

export async function setStaffSettings(userId: string, orgId: string, input: unknown) {
  const d = parse(z.object({ medicalGate: z.enum(['off', 'warn', 'block']) }), input);
  return inOrg(userId, orgId, 'staff.medical', async (tx) => {
    const before = (await tx.query(`select medical_gate from staff_settings where organization_id = $1`, [orgId])).rows[0]?.medical_gate || 'warn';
    await tx.query(`insert into staff_settings (organization_id, medical_gate, updated_by) values ($1, $2, $3)
      on conflict (organization_id) do update set medical_gate = excluded.medical_gate, updated_by = excluded.updated_by, updated_at = now()`, [orgId, d.medicalGate, userId]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'staff.settings', entityType: 'organization', entityId: orgId, before: { medical_gate: before }, after: d });
    return { ok: true };
  });
}

/* ───────────── Осмотр перед сменой ───────────── */

const CheckInput = z.object({ siteId: z.uuid(), admitted: z.boolean(), signs: optText(300), action: optText(300) })
  .refine((x) => x.admitted || (x.signs && x.signs.length >= 3 && x.action && x.action.length >= 3), 'Не допущен — укажите признаки и принятые меры (например, «отстранён, направлен к врачу»).');

export async function recordHealthCheck(userId: string, orgId: string, targetId: string, input: unknown) {
  const d = parse(CheckInput, input);
  return inOrg(userId, orgId, 'staff.health_check', async (tx) => {
    await getSite(tx, orgId, d.siteId);
    const t = await memberOf(tx, orgId, targetId);
    if (targetId === userId && !d.admitted) throw Errors.validation('Себя отстранить через осмотр нельзя — сообщите ответственному.');
    const today = await todayOf(tx, orgId);
    const r = await tx.query(`insert into health_checks (organization_id, site_id, user_id, checked_on, admitted, signs, action, checked_by) values ($1, $2, $3, $4, $5, $6, $7, $8)
      on conflict do nothing returning id`, [orgId, d.siteId, targetId, today, d.admitted, d.signs, d.admitted ? null : d.action, userId]);
    if (!r.rowCount) throw Errors.conflict(`Осмотр «${t.full_name}» сегодня уже записан.`);
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: 'staff.health_check', entityType: 'user', entityId: targetId, after: { admitted: d.admitted } });
    return { id: r.rows[0].id as string };
  }, d.siteId);
}

/* ───────────── Инструктажи ───────────── */

const TopicInput = z.object({
  title: z.string().trim().min(3, 'Укажите тему.').max(200), category: z.enum(['safety', 'sanitary', 'haccp']),
  material: z.string().trim().min(3, 'Укажите материал: инструкция или программа, номер, версия.').max(300),
  periodMonths: z.coerce.number().int().min(1).max(60).optional().nullable(),
  roles: z.array(z.string()).max(20).default([]),
});

export async function createTopic(userId: string, orgId: string, input: unknown) {
  const d = parse(TopicInput, input);
  const bad = d.roles.filter((r) => !(r in ROLES));
  if (bad.length) throw Errors.validation(`Неизвестная роль: ${bad.join(', ')}.`);
  return inOrg(userId, orgId, 'staff.brief', async (tx) => {
    const t = (await tx.query(`insert into briefing_topics (organization_id, title, category, material, period_months, roles, created_by) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [orgId, d.title, d.category, d.material, d.periodMonths || null, d.roles, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'staff.topic_create', entityType: 'briefing_topic', entityId: t.id, after: d });
    return t;
  });
}

export async function archiveTopic(userId: string, orgId: string, id: string) {
  return inOrg(userId, orgId, 'staff.brief', async (tx) => {
    const r = await tx.query(`update briefing_topics set status = 'archived' where id = $1 and organization_id = $2 and status = 'active'`, [id, orgId]);
    if (!r.rowCount) throw Errors.notFound('Тема не найдена.');
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'staff.topic_archive', entityType: 'briefing_topic', entityId: id });
    return { ok: true };
  });
}

const BriefInput = z.object({
  topicId: z.uuid({ message: 'Выберите тему.' }), userIds: z.array(z.uuid()).min(1, 'Выберите сотрудников.').max(200),
  briefingType: z.enum(['intro', 'primary', 'repeat', 'unscheduled', 'target', 'training']), heldOn: day.optional().nullable(),
  result: z.enum(['passed', 'failed']).default('passed'), note: optText(500),
}).refine((x) => x.result === 'passed' || (x.note && x.note.length >= 3), 'Не сдал — укажите, что повторить.');

/** Проведение инструктажа группе: запись на каждого сотрудника; ознакомление каждый подтверждает сам. */
export async function recordBriefing(userId: string, orgId: string, input: unknown) {
  const d = parse(BriefInput, input);
  return inOrg(userId, orgId, 'staff.brief', async (tx) => {
    const t = (await tx.query(`select * from briefing_topics where id = $1 and organization_id = $2 and status = 'active'`, [d.topicId, orgId])).rows[0];
    if (!t) throw Errors.notFound('Тема не найдена.');
    const today = await todayOf(tx, orgId);
    const on = d.heldOn || today;
    if (on > today) throw Errors.validation('Дата инструктажа не может быть в будущем.');
    const next = d.result === 'passed' && t.period_months ? addMonths(on, t.period_months) : null;
    const ids: string[] = [];
    for (const uid of d.userIds) {
      await memberOf(tx, orgId, uid);
      ids.push((await tx.query(`insert into briefings (organization_id, topic_id, user_id, briefing_type, held_on, result, note, next_due, instructor_id) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
        [orgId, t.id, uid, d.briefingType, on, d.result, d.note, next, userId])).rows[0].id);
    }
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'staff.briefing', entityType: 'briefing_topic', entityId: t.id,
      after: { type: d.briefingType, held_on: on, result: d.result, employees: d.userIds.length } });
    return { ids, next_due: next };
  });
}

/** Сотрудник подтверждает ознакомление со своим инструктажем. */
export async function acknowledgeBriefing(userId: string, orgId: string, briefingId: string) {
  return inOrg(userId, orgId, 'org.read', async (tx) => {
    const b = (await tx.query(`select * from briefings where id = $1 and organization_id = $2`, [briefingId, orgId])).rows[0];
    if (!b) throw Errors.notFound('Инструктаж не найден.');
    if (b.user_id !== userId) throw Errors.forbidden('Ознакомление подтверждает сам сотрудник.');
    const r = await tx.query(`insert into briefing_acks (briefing_id, organization_id, user_id) values ($1, $2, $3) on conflict do nothing`, [b.id, orgId, userId]);
    if (!r.rowCount) throw Errors.conflict('Ознакомление уже подтверждено.');
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'staff.briefing_ack', entityType: 'briefing', entityId: b.id });
    return { ok: true };
  });
}

/** Для «Проблем»: допуск и инструктажи сотрудников (ответственным) и свои неподтверждённые инструктажи (каждому). */
export async function staffProblems(tx: Tx, orgId: string, userId: string, seeAll: boolean) {
  const gate = (await tx.query(`select medical_gate from staff_settings where organization_id = $1`, [orgId])).rows[0]?.medical_gate || 'warn';
  const rows = await readiness(tx, orgId, seeAll ? null : [userId], false);
  const out: { key: string; priority: number; title: string; what: string; action: string; href: string; employee: string }[] = [];
  for (const r of rows) {
    const href = `/app/${orgId}/staff/${r.user_id}`;
    if (seeAll && r.food && gate !== 'off' && (r.medical.status === 'expired' || r.medical.status === 'missing'))
      out.push({ key: `med:${r.user_id}`, priority: 5, title: `Нет медицинского допуска: ${r.full_name}`, what: r.medical.status === 'missing' ? 'Данные ЛМК не внесены.' : 'Срок медосмотра или гигиенической аттестации истёк.',
        action: gate === 'block' ? 'Записи по продукции от сотрудника не принимаются — обновите ЛМК' : 'Обновить данные ЛМК', href, employee: r.full_name });
    else if (seeAll && r.food && gate !== 'off' && r.medical.status === 'soon')
      out.push({ key: `med:${r.user_id}`, priority: 7, title: `Истекает медосмотр или аттестация: ${r.full_name}`, what: 'Срок — меньше 30 дней.', action: 'Направить на медосмотр', href, employee: r.full_name });
    if (seeAll && r.briefings_due) out.push({ key: `brief:${r.user_id}`, priority: 7, title: `Инструктажи: ${r.full_name}`,
      what: r.briefings.filter((b) => b.state === 'missing' || b.state === 'overdue').map((b) => `${b.title} — ${b.state === 'missing' ? 'не проведён' : 'просрочен'}`).join('; '), action: 'Провести инструктаж', href, employee: r.full_name });
    if (r.user_id === userId) for (const b of r.briefings.filter((x) => x.state === 'unconfirmed'))
      out.push({ key: `ack:${b.briefing_id}`, priority: 7, title: `Подтвердите ознакомление: ${b.title}`, what: `Инструктаж от ${b.held_on!.split('-').reverse().join('.')}.`, action: 'Подтвердить', href: `/app/${orgId}/staff/${userId}`, employee: r.full_name });
  }
  return out;
}
