import { inOrg } from './common';
import { measurementDue, KIND_LABEL, criterionText } from './control';
import { expiryState, sweepExpiredLots } from './lots';
import { SEVERITY_LABEL, STATUS_LABEL } from './incidents';
import { taskHref } from './tasks';
import { ROLES, roleHas, type Role } from '../access/roles';

/**
 * Дашборд проблем (ТЗ v2 §2, AT-06): «обнаружил → открыл → исправил». Порядок:
 *  1 критический риск безопасности; 2 просроченная/карантинная партия; 3 выход за подтверждённый предел;
 *  4 проблемная приёмка; 5 пропущенное обязательное измерение; 6 просроченная задача; 7 предупреждение.
 * Каждая карточка ведёт на конкретный объект и нужное действие, а не в общий раздел.
 */

export interface ProblemCard {
  key: string; priority: number; tone: 'crit' | 'warn' | 'info';
  title: string; what: string; where: string; at: string | null; risk: string;
  responsible: string | null; due_at: string | null; source: string | null; action: string; href: string; status?: string;
}

const roleLabel = (r: string | null) => (r ? ROLES[r as Role]?.label || r : null);

export async function getProblems(userId: string, orgId: string, siteId?: string | null) {
  // Сначала — перевод просроченных партий в «заблокировано» с отклонением (идемпотентно).
  const sites = await inOrg(userId, orgId, 'incident.read', async (tx, m) => (await tx.query(
    `select id, name from sites where organization_id = $1 and status = 'active' and ($2::uuid is null or id = $2)`, [orgId, siteId || null])).rows
    .filter((s) => !m.site_ids.length || m.site_ids.includes(s.id)));
  for (const s of sites) await sweepExpiredLots(userId, orgId, s.id).catch(() => 0);
  const siteIds = sites.map((s) => s.id);
  const siteName = new Map(sites.map((s) => [s.id, s.name]));

  return inOrg(userId, orgId, 'incident.read', async (tx, m) => {
    const cards: ProblemCard[] = [];
    const now = new Date();

    const incidents = (await tx.query(`select i.*, o.name as object_name, p.name as product from incidents i
        left join control_objects o on i.entity_type = 'control_object' and o.id = i.entity_id
        left join lots l on i.entity_type = 'lot' and l.id = i.entity_id left join products p on p.id = l.product_id
      where i.organization_id = $1 and i.status <> 'closed' and (i.site_id is null or i.site_id = any($2::uuid[]))`, [orgId, siteIds])).rows;
    const coveredLots = new Set(incidents.filter((i) => i.entity_type === 'lot').map((i) => i.entity_id));
    for (const i of incidents) {
      const priority = i.severity === 'critical' ? 1 : i.kind === 'expired_lot' ? 2 : i.kind === 'temperature_deviation' ? 3 : i.kind === 'receipt_problem' ? 4 : i.severity === 'high' ? 3 : 7;
      cards.push({
        key: `incident:${i.id}`, priority, tone: priority <= 4 ? 'crit' : 'warn', title: i.title, what: i.what,
        where: [siteName.get(i.site_id), i.object_name || i.product].filter(Boolean).join(' · '), at: i.created_at,
        risk: SEVERITY_LABEL[i.severity], responsible: roleLabel(i.responsible_role), due_at: i.due_at, source: i.rule_source,
        action: i.status === 'pending_review' ? 'Проверить и подтвердить' : i.recommended_action || 'Открыть', href: `/app/${orgId}/incidents/${i.id}`, status: STATUS_LABEL[i.status],
      });
    }

    const lots = (await tx.query(`select l.*, p.name as product, o.name as storage_name from lots l join products p on p.id = l.product_id
      left join control_objects o on o.id = l.storage_object_id where l.organization_id = $1 and l.site_id = any($2::uuid[]) and l.status in ('available', 'quarantine')`, [orgId, siteIds])).rows;
    for (const l of lots) {
      if (coveredLots.has(l.id)) continue;
      const where = [siteName.get(l.site_id), l.storage_name].filter(Boolean).join(' · ');
      const lotWhat = `Партия ${l.lot_no || 'без номера'}, ${Number(l.quantity)} ${l.unit}`;
      if (l.status === 'quarantine') {
        cards.push({ key: `lot:q:${l.id}`, priority: 2, tone: 'crit', title: `Партия в карантине: ${l.product}`, what: `${lotWhat}. ${l.status_reason || ''}`.trim(), where, at: l.received_at,
          risk: 'Нельзя использовать до решения', responsible: roleLabel('haccp_lead'), due_at: null, source: null, action: 'Решить по карантину', href: `/app/${orgId}/lots/${l.id}` });
        continue;
      }
      const st = expiryState(l, now);
      if (st === 'soon') cards.push({ key: `lot:s:${l.id}`, priority: 7, tone: 'warn', title: `Скоро истекает срок: ${l.product}`, what: lotWhat, where, at: null,
        risk: 'Предупреждение', responsible: roleLabel('chef'), due_at: l.expires_at, source: l.expiry_basis, action: 'Использовать в первую очередь или списать по процедуре', href: `/app/${orgId}/lots/${l.id}` });
      if (st === 'unconfirmed') cards.push({ key: `lot:u:${l.id}`, priority: 7, tone: 'warn', title: `Срок не подтверждён: ${l.product}`, what: `${lotWhat}. Использовать нельзя до подтверждения срока.`, where, at: l.received_at,
        risk: 'Партия не используется', responsible: roleLabel('chef'), due_at: null, source: null, action: 'Подтвердить срок по маркировке', href: `/app/${orgId}/lots/${l.id}` });
    }

    const objects = (await tx.query(`select o.id, o.name, o.kind, o.site_id, r.id as rule_id, r.frequency_hours, r.grace_minutes, r.min_value, r.max_value, r.unit, r.source_ref,
        (select json_build_object('measured_at', m.measured_at) from measurements m where m.control_object_id = o.id order by m.measured_at desc limit 1) as last
      from control_objects o join control_rules r on r.control_object_id = o.id and r.status = 'approved' and r.frequency_hours is not null
      where o.organization_id = $1 and o.status = 'active' and o.site_id = any($2::uuid[])`, [orgId, siteIds])).rows;
    for (const o of objects) {
      const due = measurementDue(o, now);
      if (due.state !== 'missed') continue;
      cards.push({ key: `missed:${o.id}`, priority: 5, tone: 'warn', title: `Пропущен замер: ${o.name}`,
        what: o.last ? `Последний замер ${new Date(o.last.measured_at).toLocaleString('ru-RU')}; по правилу — каждые ${Number(o.frequency_hours)} ч.` : `Замеров ещё нет; по правилу — каждые ${Number(o.frequency_hours)} ч.`,
        where: [siteName.get(o.site_id), KIND_LABEL[o.kind]].join(' · '), at: o.last?.measured_at || null, risk: `Предел ${criterionText(o)}`,
        responsible: roleLabel('line_staff'), due_at: due.due_at, source: o.source_ref, action: 'Внести замер', href: `/app/${orgId}/objects/${o.id}` });
    }

    const tasks = (await tx.query(`select t.* from tasks t where t.organization_id = $1 and t.status = 'open' and t.due_at < now()
      and (t.site_id is null or t.site_id = any($2::uuid[])) and t.kind <> 'incident'`, [orgId, siteIds])).rows;
    for (const t of tasks) {
      cards.push({ key: `task:${t.id}`, priority: 6, tone: 'warn', title: `Просрочена задача: ${t.title}`, what: t.details || '', where: siteName.get(t.site_id) || '',
        at: t.created_at, risk: 'Просрочено', responsible: roleLabel(t.assignee_role), due_at: t.due_at, source: null, action: 'Выполнить', href: taskHref(orgId, t) });
    }

    // Лабораторный контроль: наступил срок исследования по программе; суточные пробы мероприятий (этап 14).
    if (roleHas(m.role, 'lab.read')) {
      const due = (await tx.query(`select p.id, p.site_id, p.test_type, p.target, p.next_due, p.basis, p.responsible_role from lab_programs p join organizations o on o.id = p.organization_id
        where p.organization_id = $1 and p.site_id = any($2::uuid[]) and p.status = 'active' and p.next_due < (now() at time zone o.timezone)::date`, [orgId, siteIds])).rows;
      for (const p of due) cards.push({ key: `lab:${p.id}`, priority: 6, tone: 'warn', title: `Просрочено исследование: ${p.test_type}`, what: `${p.target} — срок по программе прошёл.`,
        where: siteName.get(p.site_id) || '', at: null, risk: 'Программа производственного контроля не выполняется', responsible: roleLabel(p.responsible_role), due_at: p.next_due,
        source: p.basis, action: 'Отобрать пробу и внести результат', href: `/app/${orgId}/lab?tab=lab` });
    }
    if (roleHas(m.role, 'sample.record')) {
      const miss = (await tx.query(`select e.id, e.site_id, e.number, e.title, string_agg(d.name, ', ' order by d.name) as dishes from plan_events e join plan_event_items i on i.event_id = e.id
        join dishes d on d.id = i.dish_id join organizations o on o.id = e.organization_id
        where e.organization_id = $1 and e.site_id = any($2::uuid[]) and e.status in ('confirmed', 'done') and coalesce(i.actual_portions, i.portions) > 0
          and e.event_date between (now() at time zone o.timezone)::date - 1 and (now() at time zone o.timezone)::date
          and not exists (select 1 from daily_samples x where x.plan_event_id = e.id and x.dish_id = i.dish_id) group by e.id`, [orgId, siteIds])).rows;
      for (const e of miss) cards.push({ key: `sample:${e.id}`, priority: 5, tone: 'warn', title: `Нет суточной пробы: мероприятие № ${e.number}`, what: `«${e.title}»: ${e.dishes}.`,
        where: siteName.get(e.site_id) || '', at: null, risk: 'Без пробы мероприятие не закрыть; при проверке — нарушение', responsible: roleLabel('chef'), due_at: null, source: 'СанПиН 2.3/2.4.3590-20',
        action: 'Отобрать пробы', href: `/app/${orgId}/lab?event=${e.id}` });
      const old = (await tx.query(`select count(*)::int as n, min(s.site_id::text) as site_id from daily_samples s where s.organization_id = $1 and s.site_id = any($2::uuid[]) and s.keep_until < now() - interval '1 day'
        and not exists (select 1 from daily_sample_destructions x where x.sample_id = s.id)`, [orgId, siteIds])).rows[0];
      if (old.n) cards.push({ key: 'sample:due', priority: 7, tone: 'warn', title: `Пробы не уничтожены по сроку: ${old.n}`, what: 'Срок хранения истёк больше суток назад — уничтожьте и отметьте.',
        where: siteName.get(old.site_id) || '', at: null, risk: 'Предупреждение', responsible: roleLabel('chef'), due_at: null, source: null, action: 'Уничтожить и отметить', href: `/app/${orgId}/lab` });
    }

    // Нормативный реестр: утверждённая редакция с наступившей датой проверки актуальности (ТЗ v2 §7).
    if (roleHas(m.role, 'reg.read')) {
      const due = (await tx.query(`select v.id, v.edition, v.next_check_at, s.id as source_id, s.code, u.full_name as owner from reg_source_versions v join reg_sources s on s.id = v.source_id
        left join users u on u.id = v.owner_user_id where v.organization_id = $1 and v.workflow_status = 'approved' and v.next_check_at <= current_date`, [orgId])).rows;
      for (const v of due) cards.push({ key: `reg:${v.id}`, priority: 7, tone: 'warn', title: `Пора проверить актуальность: ${v.code}`, what: `Редакция «${v.edition}» — плановая проверка по официальному источнику.`,
        where: 'Нормативный реестр', at: null, risk: 'Предупреждение', responsible: v.owner, due_at: v.next_check_at, source: null, action: 'Проверить редакцию', href: `/app/${orgId}/regulatory/${v.source_id}` });
    }

    cards.sort((a, b) => a.priority - b.priority || String(a.at || '').localeCompare(String(b.at || '')));
    return { cards, counts: { critical: cards.filter((c) => c.priority <= 4).length, total: cards.length } };
  });
}

/** Главный экран смены: объекты и сроки замеров, мои задачи, число проблем. */
export async function getShift(userId: string, orgId: string, siteId: string) {
  return inOrg(userId, orgId, 'measure.record', async (tx, m) => {
    const site = (await tx.query(`select id, name from sites where id = $1 and organization_id = $2`, [siteId, orgId])).rows[0];
    const objects = (await tx.query(`select o.id, o.name, o.kind, r.id as rule_id, r.frequency_hours, r.grace_minutes, r.min_value, r.max_value, r.unit,
        (select json_build_object('value', x.value, 'unit', x.unit, 'measured_at', x.measured_at, 'result', x.result) from measurements x where x.control_object_id = o.id order by x.measured_at desc limit 1) as last
      from control_objects o left join control_rules r on r.control_object_id = o.id and r.status = 'approved' and r.parameter = 'temperature'
      where o.organization_id = $1 and o.site_id = $2 and o.status = 'active' order by o.name`, [orgId, siteId])).rows
      .map((o) => ({ ...o, kind_label: KIND_LABEL[o.kind], criterion: o.rule_id ? criterionText(o) : null, due: measurementDue(o) }));
    const myTasks = Number((await tx.query(`select count(*) from tasks where organization_id = $1 and status = 'open' and (site_id is null or site_id = $2)
      and (assignee_user_id = $3 or assignee_role = $4)`, [orgId, siteId, userId, m.role])).rows[0].count);
    const openIncidents = Number((await tx.query(`select count(*) from incidents where organization_id = $1 and site_id = $2 and status <> 'closed'`, [orgId, siteId])).rows[0].count);
    const production = Number((await tx.query(`select count(*) from production_orders where organization_id = $1 and site_id = $2 and status in ('planned', 'in_progress') and planned_for <= current_date`, [orgId, siteId])).rows[0].count);
    return { site, objects, myTasks, openIncidents, production, role: m.role };
  }, siteId);
}

export async function listNotifications(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'org.read', async (tx, m) => (await tx.query(
    `select n.*, (r.user_id is not null) as read from notifications n
       left join notification_reads r on r.notification_id = n.id and r.user_id = $2
     where n.organization_id = $1 and (n.user_id = $2 or n.role = $3 or $3 in ('owner', 'enterprise_admin'))
       and (n.site_id is null or cardinality($4::uuid[]) = 0 or n.site_id = any($4::uuid[]))
     order by n.created_at desc limit 50`, [orgId, userId, m.role, m.site_ids])).rows);
}

export async function markNotificationsRead(userId: string, orgId: string, ids: string[]) {
  return inOrg(userId, orgId, 'org.read', async (tx) => {
    for (const id of ids.slice(0, 100)) {
      await tx.query(`insert into notification_reads (notification_id, user_id, organization_id)
        select id, $2, $3 from notifications where id = $1 and organization_id = $3 on conflict do nothing`, [id, userId, orgId]);
    }
    return { ok: true };
  });
}
