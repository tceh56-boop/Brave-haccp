import { inOrg, assertSiteAccess, getSite, orgToday } from './common';
import { measurementDue, criterionText } from './control';
import { taskHref } from './tasks';
import { memberHas } from '../access/roles';
import { FOOD_ROLES, admissionMode, medicalState } from '../access/admission';

/**
 * Экран смены повара (этап 3 доработки под кухню и ХАССП): карточки «что сделать сейчас» из существующих источников —
 * осмотр перед сменой, слоты замеров по утверждённым правилам контроля, план уборок, производственные задания на сегодня,
 * суточные пробы к уничтожению, открытые задачи. Нового хранилища нет: агрегация на сервере, действие карточки вызывает
 * существующий API (замер, отметка уборки, уничтожение пробы, осмотр). Порядок: просрочено → сейчас → позже сегодня.
 * Нормы, пределы и сроки — только из записей системы; система ничего не отмечает за человека.
 */

export type Bucket = 'overdue' | 'now' | 'later';
export interface Action {
  type: 'number' | 'done' | 'open' | 'info';
  method?: 'POST'; url?: string; body?: Record<string, unknown>;   // действие: вызов существующего API (значение — в поле `value`)
  field?: string; unit?: string; label?: string; href?: string;
}
export interface Card { key: string; kind: string; bucket: Bucket; title: string; detail: string; due_at: string | null; action: Action; href?: string | null }

const ORDER: Record<Bucket, number> = { overdue: 0, now: 1, later: 2 };

export async function shiftCards(userId: string, orgId: string, siteId: string) {
  return inOrg(userId, orgId, 'task.read', async (tx, m) => {
    assertSiteAccess(m, siteId);
    const site = await getSite(tx, orgId, siteId);
    const can = (p: Parameters<typeof memberHas>[1]) => memberHas(m, p);
    const today = await orgToday(tx, orgId);
    const now = new Date();
    const endOfDay = (await tx.query(`select ((org_today($1) + 1)::timestamp at time zone o.timezone) as t from organizations o where o.id = $1`, [orgId])).rows[0].t as Date;
    const base = `/orgs/${orgId}`;
    const cards: Card[] = [];
    const mode = await admissionMode(tx, orgId);

    // 1. Осмотр перед сменой: свой статус (пищевая роль в режиме «блокировать») и осмотр сотрудников (у кого есть право)
    let admission: { required: boolean; admitted: boolean | null; medical: string | null } = { required: false, admitted: null, medical: null };
    if (FOOD_ROLES.includes(m.role) && mode !== 'off') {
      const hc = (await tx.query(`select admitted from health_checks where organization_id = $1 and user_id = $2 and checked_on = $3`, [orgId, userId, today])).rows[0];
      const med = (await tx.query(`select exam_due::text as exam_due, hygiene_due::text as hygiene_due, restrictions from staff_medical where organization_id = $1 and user_id = $2
        order by recorded_at desc limit 1`, [orgId, userId])).rows[0];
      const ms = medicalState(med, today);
      admission = { required: mode === 'block', admitted: hc ? hc.admitted : null, medical: ms.status };
      if (ms.status === 'missing' || ms.status === 'expired') cards.push({ key: 'self:medical', kind: 'admission', bucket: 'overdue',
        title: ms.status === 'missing' ? 'Нет данных медкнижки' : 'Медкнижка просрочена', detail: mode === 'block' ? 'Записи по продукции не принимаются — обратитесь к ответственному.' : 'Сообщите ответственному.',
        due_at: null, action: { type: 'info' } });
      if (!hc) cards.push({ key: 'self:health', kind: 'admission', bucket: 'overdue', title: 'Осмотр перед сменой не отмечен',
        detail: mode === 'block' ? 'До осмотра записи по продукции не принимаются. Попросите шефа или ответственного отметить осмотр.' : 'Попросите шефа или ответственного отметить осмотр.',
        due_at: null, action: { type: 'info' } });
      else if (!hc.admitted) cards.push({ key: 'self:health', kind: 'admission', bucket: 'overdue', title: 'Сегодня вы не допущены к работе с продукцией', detail: 'Решение по осмотру перед сменой.', due_at: null, action: { type: 'info' } });
    }
    if (can('staff.health_check') && mode !== 'off') {
      const ppl = (await tx.query(`select u.id, u.full_name, ms.role from memberships ms join users u on u.id = ms.user_id
        where ms.organization_id = $1 and ms.status = 'active' and ms.role = any($2::text[]) and ms.user_id <> $4 and (cardinality(ms.site_ids) = 0 or $3 = any(ms.site_ids))
          and not exists (select 1 from health_checks h where h.organization_id = $1 and h.user_id = ms.user_id and h.checked_on = $5) order by u.full_name`,
        [orgId, FOOD_ROLES, siteId, userId, today])).rows;
      for (const p of ppl) cards.push({ key: `health:${p.id}`, kind: 'health_check', bucket: 'now', title: `Осмотр перед сменой: ${p.full_name}`,
        detail: 'Кожа рук, признаки инфекций, самочувствие. «Не допущен» — с признаками и мерами, в разделе «Персонал».', due_at: null,
        action: { type: 'done', method: 'POST', url: `${base}/staff/${p.id}/health-check`, body: { siteId, admitted: true }, label: 'Допущен' }, href: `/app/${orgId}/staff` });
    }

    // 2. Замеры по утверждённым правилам контроля (температура, влажность)
    if (can('measure.record')) {
      const objs = (await tx.query(`select o.id, o.name, r.id as rule_id, r.parameter, r.frequency_hours, r.grace_minutes, r.min_value, r.max_value, r.unit,
          (select json_build_object('measured_at', x.measured_at, 'value', x.value) from measurements x where x.control_object_id = o.id and x.parameter = r.parameter order by x.measured_at desc limit 1) as last
        from control_objects o join control_rules r on r.control_object_id = o.id and r.status = 'approved' and r.frequency_hours is not null
        where o.organization_id = $1 and o.site_id = $2 and o.status = 'active' order by o.name`, [orgId, siteId])).rows;
      for (const o of objs) {
        const due = measurementDue(o, now);
        if (due.state === 'no_schedule') continue;
        const bucket: Bucket | null = due.state === 'missed' ? 'overdue' : due.state === 'due' ? 'now' : due.due_at && new Date(due.due_at) < endOfDay ? 'later' : null;
        if (!bucket) continue;
        cards.push({ key: `measure:${o.id}:${o.parameter}`, kind: 'measure', bucket, title: `${o.parameter === 'humidity' ? 'Влажность' : 'Температура'}: ${o.name}`,
          detail: `Предел ${criterionText(o)}${o.last ? ` · последний ${Number(o.last.value)} ${o.unit}` : ' · замеров ещё нет'}`, due_at: due.due_at,
          action: { type: 'number', method: 'POST', url: `${base}/measurements`, body: { controlObjectId: o.id, unit: o.unit }, field: 'value', unit: o.unit, label: 'Записать' },
          href: `/app/${orgId}/objects/${o.id}` });
      }
    }

    // 3. План уборок и дезинфекции на сегодня и просроченные
    if (can('sanitation.record')) {
      const plans = (await tx.query(`select p.id, p.area, p.work, p.next_due::text as next_due, p.check_concentration, x.name as disinfectant
        from sanitation_plans p left join disinfectants x on x.id = p.disinfectant_id
        where p.organization_id = $1 and p.site_id = $2 and p.status = 'active' and p.next_due <= $3::date order by p.next_due, p.area`, [orgId, siteId, today])).rows;
      for (const p of plans) cards.push({ key: `sanitation:${p.id}`, kind: 'sanitation', bucket: p.next_due < today ? 'overdue' : 'now', title: `Уборка: ${p.area}`,
        detail: `${p.work}${p.disinfectant ? ` · ${p.disinfectant}` : ''}${p.next_due < today ? ` · срок был ${p.next_due.split('-').reverse().join('.')}` : ''}`, due_at: p.next_due,
        action: p.check_concentration
          ? { type: 'number', method: 'POST', url: `${base}/sanitation/plans/${p.id}/done`, body: {}, field: 'concentration', unit: '%', label: 'Сделано' }
          : { type: 'done', method: 'POST', url: `${base}/sanitation/plans/${p.id}/done`, body: {}, label: 'Сделано' }, href: `/app/${orgId}/sanitation` });
    }

    // 4. Производственные задания на сегодня (и не выполненные с прошлых дней)
    if (can('production.read')) {
      const ords = (await tx.query(`select o.id, o.status, o.planned_for::text as planned_for, o.planned_g, d.name from production_orders o join dishes d on d.id = o.dish_id
        where o.organization_id = $1 and o.site_id = $2 and o.status in ('planned', 'in_progress') and o.planned_for <= $3::date order by o.planned_for, d.name`, [orgId, siteId, today])).rows;
      for (const o of ords) cards.push({ key: `production:${o.id}`, kind: 'production', bucket: o.planned_for < today ? 'overdue' : 'now',
        title: `${o.status === 'in_progress' ? 'В работе' : 'Задание'}: ${o.name}`, detail: `${Number(o.planned_g) / 1000} кг${o.planned_for < today ? ` · план был на ${o.planned_for.split('-').reverse().join('.')}` : ''}`,
        due_at: o.planned_for, action: { type: 'open', href: `/app/${orgId}/production/${o.id}`, label: o.status === 'in_progress' ? 'Продолжить' : 'Открыть' } });
    }

    // 5. Суточные пробы, срок хранения которых истёк, — уничтожить и отметить
    if (can('sample.record')) {
      const ss = (await tx.query(`select s.id, s.title, s.keep_until from daily_samples s where s.organization_id = $1 and s.site_id = $2 and s.keep_until < $3
          and not exists (select 1 from daily_sample_destructions x where x.sample_id = s.id) order by s.keep_until`, [orgId, siteId, endOfDay])).rows;
      for (const s of ss) cards.push({ key: `sample:${s.id}`, kind: 'sample_destroy', bucket: new Date(s.keep_until) <= now ? 'overdue' : 'later', title: `Уничтожить пробу: ${s.title}`,
        detail: 'Срок хранения суточной пробы истекает.', due_at: new Date(s.keep_until).toISOString(),
        action: new Date(s.keep_until) <= now ? { type: 'done', method: 'POST', url: `${base}/samples/${s.id}/destroy`, body: {}, label: 'Уничтожено' } : { type: 'info' }, href: `/app/${orgId}/lab` });
    }

    // 6. Открытые задачи сотрудника (по роли или лично) — кроме уже показанных выше источников
    const shown = new Set(cards.map((c) => c.key.split(':')[1]));
    const tasks = (await tx.query(`select t.id, t.kind, t.title, t.details, t.entity_type, t.entity_id, t.due_at from tasks t
      where t.organization_id = $1 and t.status = 'open' and (t.site_id is null or t.site_id = $2) and (t.assignee_user_id = $3 or t.assignee_role = $4)
        and (t.due_at is null or t.due_at < $5) order by t.due_at nulls last limit 50`, [orgId, siteId, userId, m.role, endOfDay])).rows;
    for (const t of tasks) {
      if (t.entity_id && shown.has(t.entity_id)) continue;
      cards.push({ key: `task:${t.id}`, kind: 'task', bucket: t.due_at && new Date(t.due_at) < now ? 'overdue' : t.due_at ? 'now' : 'later', title: t.title, detail: t.details || '',
        due_at: t.due_at ? new Date(t.due_at).toISOString() : null, action: { type: 'open', href: taskHref(orgId, t), label: 'Открыть' } });
    }

    cards.sort((a, b) => ORDER[a.bucket] - ORDER[b.bucket] || (a.due_at || '9').localeCompare(b.due_at || '9'));
    const probes = can('measure.record') ? (await tx.query(`select e.id, e.name, e.serial_no from equipment e join organizations o on o.id = e.organization_id
      where e.organization_id = $1 and e.site_id = $2 and e.measuring and e.status = 'active' and e.calibration_due >= org_today($1) order by e.name`, [orgId, siteId])).rows : [];
    return { site: { id: site.id, name: site.name }, today, admission, probes, cards,
      counts: { overdue: cards.filter((c) => c.bucket === 'overdue').length, now: cards.filter((c) => c.bucket === 'now').length, later: cards.filter((c) => c.bucket === 'later').length } };
  }, siteId);
}
