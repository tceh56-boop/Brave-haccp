import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText, getSite, assertSiteAccess, openTask, fmtNum } from './common';
import { raiseIncident } from './incidents';
import { KINDS } from '../../lib/floorplan';

/**
 * Чек-листы (ТЗ 3.0 §15.6; мастер-промт, раздел 7). Пункты берутся только из утверждённых источников:
 *  - этапы утверждённых ТТК, привязанные к местам на 2D-плане площадки → чек-лист участка (место плана);
 *  - мониторинг утверждённого плана ХАССП → чек-лист «Мониторинг ККТ/ОПП»; если у мониторинга есть правило контроля
 *    с числовыми пределами — пункт требует фактическое измерение, иначе — запись наблюдения.
 * Не каждый абзац становится пунктом: пункт — только этап с указанным контролем и точка мониторинга.
 * Формирование создаёт черновик; утверждает специалист. Выполнение: факт с временем; вне предела — отклонение;
 * закрытие с невыполненными пунктами — задача ответственному. Норма вместо факта не подставляется.
 */

const ROLE_LABEL: Record<string, string> = { line_staff: 'сотрудник цеха', chef: 'шеф / су-шеф', haccp_lead: 'ответственный ХАССП', technologist: 'технолог', storekeeper: 'кладовщик' };

interface ItemIn { action: string; object: string | null; criterion: string | null; kind: 'check' | 'measure' | 'observe'; unit: string | null; min_value: number | null; max_value: number | null;
  frequency: string | null; responsible_role: string | null; source_type: string; source_id: string | null; source_ref: string }

/** Сборка пунктов из источников площадки (без записи). */
async function collect(tx: Tx, orgId: string, siteId: string) {
  const groups = new Map<string, { name: string; items: ItemIn[]; sources: Set<string> }>();
  const put = (key: string, name: string, it: ItemIn, src: string) => {
    if (!groups.has(key)) groups.set(key, { name, items: [], sources: new Set() });
    const g = groups.get(key)!; g.items.push(it); g.sources.add(src);
  };
  // этапы утверждённых ТТК на планах площадки: пункт — только этап с указанным контролем
  const stages = (await tx.query(`select s.id, s.position, s.operation, s.params, s.control, s.plan_object_id, o.kind, o.label, o.props->>'no' as no, fp.name as plan, d.name as dish, v.version
      from ttk_stages s join ttk_versions v on v.id = s.version_id and v.status = 'approved' join dishes d on d.id = v.dish_id
      join floor_plans fp on fp.id = s.plan_id and fp.site_id = $2 join plan_objects o on o.id = s.plan_object_id and o.plan_id = s.plan_id
      where s.organization_id = $1 and s.control is not null and length(trim(s.control)) > 0 order by o.id, d.name, s.position`, [orgId, siteId])).rows;
  for (const s of stages) {
    const place = `${s.no ? `№ ${s.no} ` : ''}${s.label || KINDS[s.kind]?.label || s.kind}`;
    put(`place:${s.plan_object_id}`, `Участок: ${place} (${s.plan})`, {
      action: `${s.operation} — ${s.dish}`, object: place, criterion: [s.control, s.params].filter(Boolean).join('; '), kind: 'check', unit: null, min_value: null, max_value: null,
      frequency: 'при каждом выполнении этапа', responsible_role: 'line_staff', source_type: 'ttk_stage', source_id: s.id, source_ref: `ТТК «${s.dish}» v${s.version}, этап ${s.position}`,
    }, `ТТК «${s.dish}» v${s.version}`);
  }
  // мониторинг утверждённого плана ХАССП
  const plan = (await tx.query(`select id, version from haccp_plans where organization_id = $1 and status = 'approved' order by version desc limit 1`, [orgId])).rows[0];
  if (plan) {
    const mon = (await tx.query(`select m.*, h.code, h.class, h.description, r.min_value::float8 as min_value, r.max_value::float8 as max_value, r.unit, r.status as rule_status
        from haccp_monitoring m join haccp_hazards h on h.id = m.hazard_id left join control_rules r on r.id = m.control_rule_id
      where m.plan_id = $1 order by h.code`, [plan.id])).rows;
    for (const x of mon) {
      const numeric = x.rule_status === 'approved' && (x.min_value !== null || x.max_value !== null);
      put('haccp', 'Мониторинг ККТ и ОПП', {
        action: `${x.what}: ${x.method}`, object: x.where_text || null, criterion: x.critical_limit || null, kind: numeric ? 'measure' : 'observe', unit: numeric ? x.unit : null,
        min_value: numeric ? x.min_value : null, max_value: numeric ? x.max_value : null, frequency: x.frequency, responsible_role: x.responsible_role,
        source_type: 'haccp_monitoring', source_id: x.id, source_ref: `План ХАССП v${plan.version}, ${x.code}${x.class ? ` (${({ ccp: 'ККТ', oprp: 'ОПП', prp: 'ПУП' } as Record<string, string>)[x.class] || x.class})` : ''}`,
      }, `План ХАССП v${plan.version}`);
    }
  }
  return groups;
}

/** Сформировать черновики чек-листов площадки из утверждённых источников. Утверждённые версии не трогаются. */
export async function generateChecklists(userId: string, orgId: string, input: unknown) {
  const d = parse(z.object({ siteId: z.uuid() }), input);
  return inOrg(userId, orgId, 'checklist.manage', async (tx) => {
    await getSite(tx, orgId, d.siteId);
    const groups = await collect(tx, orgId, d.siteId);
    if (!groups.size) throw Errors.conflict('Нет источников: привяжите этапы утверждённых ТТК к местам на плане площадки (с указанием контроля) или утвердите план ХАССП с мониторингом.');
    const made: { scope: string; name: string; version: number; items: number }[] = [];
    for (const [key, g] of groups) {
      // черновик этого чек-листа пересобирается на месте; утверждённые версии не трогаются
      let t = (await tx.query(`select id, version from checklist_templates where site_id = $1 and scope_key = $2 and status = 'draft'`, [d.siteId, key])).rows[0];
      if (t) {
        await tx.query(`delete from checklist_items where template_id = $1`, [t.id]);
        await tx.query(`update checklist_templates set name = $2, sources = $3, created_by = $4, created_at = now() where id = $1`, [t.id, g.name, JSON.stringify([...g.sources]), userId]);
      } else {
        const n = Number((await tx.query(`select coalesce(max(version), 0) + 1 as n from checklist_templates where site_id = $1 and scope_key = $2`, [d.siteId, key])).rows[0].n);
        t = (await tx.query(`insert into checklist_templates (organization_id, site_id, scope_key, name, version, sources, created_by) values ($1, $2, $3, $4, $5, $6, $7) returning id, version`,
          [orgId, d.siteId, key, g.name, n, JSON.stringify([...g.sources]), userId])).rows[0];
      }
      const n = Number(t.version);
      for (const [i, it] of g.items.entries()) {
        await tx.query(`insert into checklist_items (organization_id, template_id, position, action, object, criterion, kind, unit, min_value, max_value, frequency, responsible_role, source_type, source_id, source_ref)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [orgId, t.id, i + 1, it.action, it.object, it.criterion, it.kind, it.unit, it.min_value, it.max_value, it.frequency, it.responsible_role, it.source_type, it.source_id, it.source_ref]);
      }
      made.push({ scope: key, name: g.name, version: n, items: g.items.length });
    }
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: 'checklist.generate', entityType: 'site', entityId: d.siteId, after: { made } });
    return { made };
  }, d.siteId);
}

export async function listChecklists(userId: string, orgId: string, siteId: string) {
  const sid = parse(z.uuid({ message: 'Выберите площадку.' }), siteId);
  return inOrg(userId, orgId, 'task.read', async (tx) => {
    const t = (await tx.query(`select t.id, t.name, t.scope_key, t.version, t.status, t.sources, t.approved_at, u.full_name as approved_by, (select count(*)::int from checklist_items i where i.template_id = t.id) as items,
        (select json_build_object('id', r.id, 'status', r.status, 'missing', r.missing) from checklist_runs r where r.template_id = t.id and r.run_date = (now() at time zone o.timezone)::date) as today
      from checklist_templates t join organizations o on o.id = t.organization_id left join users u on u.id = t.approved_by
      where t.organization_id = $1 and t.site_id = $2 and t.status <> 'archived' order by t.scope_key = 'haccp' desc, t.name, t.version desc`, [orgId, sid])).rows;
    return t;
  }, sid);
}

export async function getChecklist(userId: string, orgId: string, id: string) {
  return inOrg(userId, orgId, 'task.read', async (tx, m) => {
    const t = (await tx.query(`select t.*, u.full_name as approved_by_name from checklist_templates t left join users u on u.id = t.approved_by where t.id = $1 and t.organization_id = $2`, [parse(z.uuid(), id), orgId])).rows[0];
    if (!t) throw Errors.notFound('Чек-лист не найден.');
    assertSiteAccess(m, t.site_id);
    const items = (await tx.query(`select * from checklist_items where template_id = $1 order by position`, [t.id])).rows
      .map((i) => ({ ...i, min_value: i.min_value === null ? null : Number(i.min_value), max_value: i.max_value === null ? null : Number(i.max_value), responsible: ROLE_LABEL[i.responsible_role] || i.responsible_role }));
    return { template: t, items };
  });
}

/** Утверждение: прежняя утверждённая версия того же чек-листа — в архив. */
export async function approveChecklist(userId: string, orgId: string, id: string) {
  return inOrg(userId, orgId, 'checklist.approve', async (tx, m) => {
    const t = (await tx.query(`select * from checklist_templates where id = $1 and organization_id = $2 for update`, [parse(z.uuid(), id), orgId])).rows[0];
    if (!t) throw Errors.notFound('Чек-лист не найден.');
    assertSiteAccess(m, t.site_id);
    if (t.status !== 'draft') throw Errors.conflict('Утвердить можно только черновик.');
    if (!(await tx.query(`select 1 from checklist_items where template_id = $1`, [t.id])).rowCount) throw Errors.conflict('В чек-листе нет пунктов.');
    await tx.query(`update checklist_templates set status = 'archived' where site_id = $1 and scope_key = $2 and status = 'approved'`, [t.site_id, t.scope_key]);
    await tx.query(`update checklist_templates set status = 'approved', approved_by = $2, approved_at = now() where id = $1`, [t.id, userId]);
    await audit.record(tx, { organizationId: orgId, siteId: t.site_id, actorUserId: userId, action: 'checklist.approve', entityType: 'checklist', entityId: t.id, after: { name: t.name, version: t.version } });
    return { ok: true };
  });
}

/** Выполнение на сегодня (одно на день и чек-лист): открыть или вернуть открытое. */
export async function startRun(userId: string, orgId: string, templateId: string) {
  return inOrg(userId, orgId, 'task.work', async (tx, m) => {
    const t = (await tx.query(`select t.*, (now() at time zone o.timezone)::date::text as today from checklist_templates t join organizations o on o.id = t.organization_id where t.id = $1 and t.organization_id = $2`,
      [parse(z.uuid(), templateId), orgId])).rows[0];
    if (!t) throw Errors.notFound('Чек-лист не найден.');
    assertSiteAccess(m, t.site_id);
    if (t.status !== 'approved') throw Errors.conflict('Выполняется только утверждённый чек-лист.');
    const r = (await tx.query(`insert into checklist_runs (organization_id, site_id, template_id, run_date, started_by) values ($1, $2, $3, $4, $5)
      on conflict (template_id, run_date) do update set template_id = excluded.template_id returning id, status`, [orgId, t.site_id, t.id, t.today, userId])).rows[0];
    return r;
  });
}

export async function getRun(userId: string, orgId: string, runId: string) {
  return inOrg(userId, orgId, 'task.read', async (tx, m) => {
    const r = (await tx.query(`select r.*, t.name, t.version from checklist_runs r join checklist_templates t on t.id = r.template_id where r.id = $1 and r.organization_id = $2`, [parse(z.uuid(), runId), orgId])).rows[0];
    if (!r) throw Errors.notFound('Выполнение не найдено.');
    assertSiteAccess(m, r.site_id);
    const items = (await tx.query(`select i.*, x.done, x.value::float8 as value, x.observation, x.ok, x.comment, x.event_at, x.incident_id, u.full_name as done_by
      from checklist_items i left join checklist_results x on x.item_id = i.id and x.run_id = $1 left join users u on u.id = x.done_by where i.template_id = $2 order by i.position`, [r.id, r.template_id])).rows
      .map((i) => ({ ...i, min_value: i.min_value === null ? null : Number(i.min_value), max_value: i.max_value === null ? null : Number(i.max_value), responsible: ROLE_LABEL[i.responsible_role] || i.responsible_role }));
    return { run: r, items };
  });
}

const ResultIn = z.object({
  itemId: z.uuid(), done: z.boolean(),
  value: z.union([z.number(), z.string().trim().regex(/^-?\d+([.,]\d+)?$/, 'Введите число.').transform((s) => Number(s.replace(',', '.')))]).nullable().optional(),
  observation: optText(500), comment: optText(500),
});

/** Отметка пункта: измерение — только фактическое число; вне предела — отклонение ответственному. */
export async function recordItem(userId: string, orgId: string, runId: string, input: unknown) {
  const d = parse(ResultIn, input);
  return inOrg(userId, orgId, 'task.work', async (tx, m) => {
    const r = (await tx.query(`select r.*, t.name from checklist_runs r join checklist_templates t on t.id = r.template_id where r.id = $1 and r.organization_id = $2 for update of r`, [parse(z.uuid(), runId), orgId])).rows[0];
    if (!r) throw Errors.notFound('Выполнение не найдено.');
    assertSiteAccess(m, r.site_id);
    if (r.status !== 'open') throw Errors.conflict('Чек-лист за этот день закрыт.');
    const it = (await tx.query(`select * from checklist_items where id = $1 and template_id = $2`, [d.itemId, r.template_id])).rows[0];
    if (!it) throw Errors.notFound('Пункт не найден.');
    let ok: boolean | null = null, incidentId: string | null = null;
    if (!d.done && !(d.comment && d.comment.length >= 3)) throw Errors.validation('Укажите, почему пункт не выполнен.');
    if (d.done && it.kind === 'measure') {
      if (d.value == null) throw Errors.validation(`Внесите фактическое значение, ${it.unit}. Норма вместо измерения не подставляется.`);
      ok = (it.min_value === null || d.value >= Number(it.min_value)) && (it.max_value === null || d.value <= Number(it.max_value));
      if (!ok) incidentId = (await raiseIncident(tx, { orgId, siteId: r.site_id, severity: 'high', kind: 'checklist', title: `Вне предела: ${it.action}`,
        what: `${r.name}: ${fmtNum(d.value)} ${it.unit} при пределе ${[it.min_value !== null ? `не ниже ${fmtNum(it.min_value)}` : '', it.max_value !== null ? `не выше ${fmtNum(it.max_value)}` : ''].filter(Boolean).join(', ')} ${it.unit} (${it.source_ref}).`,
        entityType: 'checklist_item', entityId: it.id, responsibleRole: 'haccp_lead', dueMinutes: 60, recommendedAction: it.criterion || 'Действовать по корректирующему действию плана ХАССП', createdBy: userId })).id;
    }
    if (d.done && it.kind === 'observe' && !(d.observation && d.observation.length >= 2)) throw Errors.validation('Запишите, что фактически наблюдали или измерили.');
    const ins = await tx.query(`insert into checklist_results (organization_id, run_id, item_id, done, value, observation, ok, comment, incident_id, event_at, done_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10) on conflict (run_id, item_id) do nothing`,
    [orgId, r.id, it.id, d.done, d.done && it.kind === 'measure' ? d.value : null, d.observation, ok, d.comment, incidentId, userId]);
    if (!ins.rowCount) throw Errors.conflict('Пункт уже отмечен; запись не меняется.');
    await audit.record(tx, { organizationId: orgId, siteId: r.site_id, actorUserId: userId, action: 'checklist.item', entityType: 'checklist_run', entityId: r.id,
      after: { item: it.id, done: d.done, value: d.value ?? null, ok } });
    return { ok, incident_id: incidentId };
  });
}

/** Закрытие: невыполненные и неотмеченные пункты считаются, ставится задача; ничего не дописывается за сотрудника. */
export async function closeRun(userId: string, orgId: string, runId: string) {
  return inOrg(userId, orgId, 'task.work', async (tx, m) => {
    const r = (await tx.query(`select r.*, t.name from checklist_runs r join checklist_templates t on t.id = r.template_id where r.id = $1 and r.organization_id = $2 for update of r`, [parse(z.uuid(), runId), orgId])).rows[0];
    if (!r) throw Errors.notFound('Выполнение не найдено.');
    assertSiteAccess(m, r.site_id);
    if (r.status !== 'open') throw Errors.conflict('Уже закрыто.');
    const gaps = (await tx.query(`select i.action, x.done from checklist_items i left join checklist_results x on x.item_id = i.id and x.run_id = $1
      where i.template_id = $2 and (x.id is null or not x.done) order by i.position`, [r.id, r.template_id])).rows;
    await tx.query(`update checklist_runs set status = 'closed', closed_by = $2, closed_at = now(), missing = $3 where id = $1`, [r.id, userId, gaps.length]);
    if (gaps.length) await openTask(tx, { orgId, siteId: r.site_id, kind: 'checklist_gap', title: `Чек-лист «${r.name}» за ${r.run_date.toISOString?.().slice(0, 10) ?? r.run_date}: не выполнено ${gaps.length}`,
      details: gaps.map((g) => `${g.action}${g.done === false ? ' (с причиной)' : ' (не отмечено)'}`).join('; '), entityType: 'checklist_run', entityId: r.id, assigneeRole: 'chef', createdBy: userId });
    await audit.record(tx, { organizationId: orgId, siteId: r.site_id, actorUserId: userId, action: 'checklist.close', entityType: 'checklist_run', entityId: r.id, after: { missing: gaps.length } });
    return { missing: gaps.length };
  });
}
