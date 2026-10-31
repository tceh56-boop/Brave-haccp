import type { Tx } from '../db/pool';
import { requiredContractsState } from '../ops/contracts';
import { CLAUSES, DOCS, applies, clauseById, samplesRequired, type NormProfile } from '../norms/library';

/**
 * Единый движок готовности предприятия (ТЗ доработки, этап 1). Одна реализация каждой проверки — для главного экрана,
 * «Готов ли я к проверке», конструктора и утверждения ППК, пакета для проверки, отчёта руководителя.
 *
 * Статусы: ok · not_checked (по данным не проверить) · not_applicable · missing (нет данных/документа) · overdue
 * (просрочено действие) · expired (истёк срок документа/допуска/поверки) · warning · incomplete (данные неполные) ·
 * blocked (техническое несоответствие, например ссылка на неизвестный пункт нормативной базы).
 * Пустое поле никогда не считается выполнением.
 *
 * Каждый пункт: основания (id пунктов библиотеки), что блокирует (утверждение ППК и т. п.), кто исправляет, где.
 */

export type RStatus = 'ok' | 'not_checked' | 'not_applicable' | 'missing' | 'overdue' | 'expired' | 'warning' | 'incomplete' | 'blocked';
export type Blocks = 'ppk_approve';
export interface RItem {
  key: string; group: string; title: string; status: RStatus; detail: string;
  items?: string[]; href?: string | null; basis: string[]; blocks: Blocks[]; owner: string;
}
export interface Ctx { tx: Tx; orgId: string; siteIds: string[]; today: string; base: string; profile: NormProfile }
type Def = { key: string; group: string; title: string; basis: string[]; blocks: Blocks[]; owner: string; run: (c: Ctx) => Promise<Omit<RItem, 'key' | 'group' | 'title' | 'basis' | 'blocks' | 'owner'>> };

/** Плохой ли статус (не выполнено). warning и not_checked — предупреждение, не провал. */
export const isBad = (s: RStatus) => !['ok', 'not_applicable', 'warning', 'not_checked'].includes(s);
const list = (rows: { name: string }[], max = 8) => rows.slice(0, max).map((r) => r.name).concat(rows.length > max ? [`… ещё ${rows.length - max}`] : []);
const dmy = (s: string) => s.slice(0, 10).split('-').reverse().join('.');
const FOOD_ROLES = ['line_staff', 'chef', 'storekeeper'];
const offsite = (p: NormProfile) => p.features.includes('outside_sales') || p.salesModes.some((m) => ['takeaway', 'delivery', 'catering'].includes(m));

/** Реестр нормативных ссылок модулей — проверяется на существование (fail-closed). */
const NORM_REFS: { module: string; ids: string[] }[] = [];
export function registerNormRefs(module: string, ids: string[]) {
  const ex = NORM_REFS.find((r) => r.module === module);
  if (ex) ex.ids = [...new Set([...ex.ids, ...ids])]; else NORM_REFS.push({ module, ids: [...new Set(ids)] });
}
export const unknownNormRefs = () => NORM_REFS.flatMap((r) => r.ids.filter((id) => !clauseById.has(id)).map((id) => ({ module: r.module, id })));

const DEFS: Def[] = [
  // ───── документы системы ХАССП и нормативная основа ─────
  { key: 'norm_refs', group: 'Нормативная основа', title: 'Ссылки модулей на нормативную базу существуют', basis: [], blocks: ['ppk_approve'], owner: 'администратор системы',
    async run() {
      const bad = unknownNormRefs();
      return bad.length ? { status: 'blocked', detail: `Ссылки на пункты, которых нет в нормативной базе: ${bad.length}. Документы с такими ссылками утверждать нельзя.`, items: bad.map((b) => `${b.module}: «${b.id}»`) }
        : { status: 'ok', detail: 'Все ссылки модулей на пункты нормативной базы существуют.' };
    } },
  { key: 'doc_expiry', group: 'Нормативная основа', title: 'Документы нормативной базы действуют', basis: ['sanpin3685:3'], blocks: ['ppk_approve'], owner: 'технолог',
    async run({ today }) {
      const used = new Set(CLAUSES.map((c) => c.doc));
      const gone = Object.entries(DOCS).filter(([k, d]) => used.has(k) && d.effectiveTo && d.effectiveTo <= today).map(([, d]) => ({ name: `${d.code} — утратил силу ${dmy(d.effectiveTo!)}` }));
      const soon = Object.values(DOCS).filter((d) => d.effectiveTo && d.effectiveTo > today && (Date.parse(d.effectiveTo) - Date.parse(today)) / 864e5 <= 180).map((d) => ({ name: `${d.code} — действует до ${dmy(d.effectiveTo!)}` }));
      if (gone.length) return { status: 'expired', detail: 'В нормативной базе есть документы, срок действия которых истёк: ссылки на них нужно заменить.', items: list(gone) };
      return soon.length ? { status: 'warning', detail: 'Срок действия документов истекает в ближайшие полгода.', items: list(soon) } : { status: 'ok', detail: 'Все документы нормативной базы действуют.' };
    } },
  { key: 'haccp_plan', group: 'Документы ХАССП', title: 'Утверждённый план ХАССП', basis: ['sanpin4282:4', 'trts021:10.3'], blocks: ['ppk_approve'], owner: 'ответственный ХАССП',
    async run({ tx, orgId, base }) {
      const p = (await tx.query(`select version, approved_at::date::text as d from haccp_plans where organization_id = $1 and status = 'approved' order by version desc limit 1`, [orgId])).rows[0];
      return p ? { status: 'ok', detail: `План ХАССП утверждён (версия ${p.version}, ${dmy(p.d)}).`, href: `${base}/haccp` }
        : { status: 'missing', detail: 'Нет утверждённого плана ХАССП.', href: `${base}/haccp` };
    } },
  { key: 'haccp_ccp', group: 'Документы ХАССП', title: 'ККТ: пределы, мониторинг, действия при отклонении', basis: ['trts021:11.3'], blocks: ['ppk_approve'], owner: 'ответственный ХАССП',
    async run({ tx, orgId, base }) {
      const plan = (await tx.query(`select id from haccp_plans where organization_id = $1 and status = 'approved' order by version desc limit 1`, [orgId])).rows[0];
      if (!plan) return { status: 'missing', detail: 'Нет утверждённого плана ХАССП.', href: `${base}/haccp` };
      const hz = Number((await tx.query(`select count(*) from haccp_hazards where plan_id = $1`, [plan.id])).rows[0].count);
      if (!hz) return { status: 'missing', detail: 'В утверждённом плане нет перечня опасных факторов.', href: `${base}/haccp` };
      const r = (await tx.query(`select h.code || ' ' || h.description as name, m.critical_limit, m.corrective_action, m.id as mid from haccp_hazards h left join haccp_monitoring m on m.hazard_id = h.id
        where h.plan_id = $1 and h.class in ('ccp', 'oprp')`, [plan.id])).rows;
      if (!r.length) return { status: 'warning', detail: `Опасных факторов: ${hz}; ККТ и ОПРП не выделено — проверьте анализ опасностей.`, href: `${base}/haccp` };
      const bad = r.filter((x) => !x.mid || !x.critical_limit?.trim() || !x.corrective_action?.trim());
      return bad.length ? { status: 'incomplete', detail: `ККТ/ОПРП без предела, мониторинга или действий при отклонении: ${bad.length} из ${r.length}.`, items: list(bad), href: `${base}/haccp` }
        : { status: 'ok', detail: `ККТ/ОПРП: ${r.length} — у каждой предел, мониторинг и действия при отклонении.`, href: `${base}/haccp` };
    } },
  { key: 'ppk_update', group: 'Документы ХАССП', title: 'Утверждённая программа производственного контроля, соответствует данным', basis: ['sp4285:4', 'rpn:ppk_update'], blocks: [], owner: 'руководитель',
    async run({ tx, orgId, base }) {
      const { ppkState } = await import('../ops/ppk');
      const st = await ppkState(tx, orgId);
      const href = `${base}/compliance/ppk`;
      if (st.state === 'none') return { status: 'missing', detail: 'Программа производственного контроля не утверждена.', href };
      if (st.state === 'outdated') return { status: 'warning', detail: `Программа (версия ${st.version}, ${dmy(st.approved_at!)}) не совпадает с текущими данными — пересмотрите и утвердите новую версию.`, href };
      return { status: 'ok', detail: `Программа утверждена (версия ${st.version}, ${dmy(st.approved_at!)}) и соответствует данным.`, href };
    } },
  { key: 'tech_docs', group: 'Технологические документы', title: 'Утверждённые ТТК блюд и полуфабрикатов', basis: ['sanpin4282:11', 'gost31987:4'], blocks: ['ppk_approve'], owner: 'шеф / технолог',
    async run({ tx, orgId, base }) {
      const r = (await tx.query(`select d.name || case when d.kind = 'semi' then ' (п/ф)' else '' end as name from dishes d where d.organization_id = $1 and d.status = 'active'
        and not exists (select 1 from ttk_versions v where v.dish_id = d.id and v.status = 'approved') order by d.kind, d.name`, [orgId])).rows;
      const total = Number((await tx.query(`select count(*) from dishes where organization_id = $1 and status = 'active'`, [orgId])).rows[0].count);
      if (!total) return { status: 'missing', detail: 'Нет ни одного блюда с ТТК.', href: `${base}/menu` };
      return r.length ? { status: 'missing', detail: `Блюд и полуфабрикатов без утверждённой ТТК: ${r.length} из ${total}.`, items: list(r), href: `${base}/menu` }
        : { status: 'ok', detail: `На все ${total} блюд и полуфабрикатов есть утверждённые ТТК.`, href: `${base}/menu` };
    } },
  { key: 'ttk_content', group: 'Технологические документы', title: 'Обязательные разделы утверждённых ТТК', basis: ['gost31987:5.3.2'], blocks: [], owner: 'технолог',
    async run({ tx, orgId, base }) {
      const r = (await tx.query(`select d.name, v.technology, v.storage_conditions, v.shelf_life, v.organoleptic from dishes d join ttk_versions v on v.dish_id = d.id and v.status = 'approved'
        where d.organization_id = $1 and d.status = 'active'`, [orgId])).rows;
      if (!r.length) return { status: 'missing', detail: 'Утверждённых ТТК пока нет.', href: `${base}/menu` };
      const bad = r.map((x) => {
        const miss = [!x.technology?.trim() && 'технология', (!x.storage_conditions?.trim() || !x.shelf_life?.trim()) && 'хранение и срок', (!x.organoleptic?.appearance || !x.organoleptic?.taste) && 'органолептика'].filter(Boolean);
        return miss.length ? { name: `${x.name}: нет — ${miss.join(', ')}` } : null;
      }).filter(Boolean) as { name: string }[];
      return bad.length ? { status: 'incomplete', detail: `В утверждённых ТТК не заполнены обязательные разделы: ${bad.length} из ${r.length}.`, items: list(bad), href: `${base}/menu` }
        : { status: 'ok', detail: `Все ${r.length} утверждённых ТТК содержат обязательные разделы.`, href: `${base}/menu` };
    } },
  { key: 'ttk_number', group: 'Технологические документы', title: 'Порядковые номера ТТК', basis: ['gost31987:5.3.3'], blocks: [], owner: 'технолог',
    async run({ tx, orgId, base }) {
      const r = (await tx.query(`select d.name from dishes d where d.organization_id = $1 and d.status = 'active' and d.card_no is null
        and exists (select 1 from ttk_versions v where v.dish_id = d.id and v.status = 'approved') order by d.name`, [orgId])).rows;
      return r.length ? { status: 'incomplete', detail: `Утверждённые ТТК без номера: ${r.length}.`, items: list(r), href: `${base}/menu` } : { status: 'ok', detail: 'У каждой утверждённой ТТК есть номер.', href: `${base}/menu` };
    } },
  { key: 'tu_offsite', group: 'Технологические документы', title: 'ТУ на продукцию, реализуемую вне зала', basis: ['sanpin4282:7'], blocks: [], owner: 'технолог',
    async run({ tx, orgId, base, profile }) {
      if (!offsite(profile)) return { status: 'not_applicable', detail: 'Реализации вне зала (вынос, доставка, кейтеринг, продажа вне предприятия) в профиле нет.' };
      const r = (await tx.query(`select d.name from dishes d where d.organization_id = $1 and d.status = 'active' and exists (select 1 from ttk_versions v where v.dish_id = d.id and v.status = 'approved')
        and not exists (select 1 from tech_spec_versions t where t.dish_id = d.id) order by d.name`, [orgId])).rows;
      return r.length ? { status: 'warning', detail: `Продукция без утверждённых ТУ: ${r.length}. Для продажи вне зала ТУ — документ, по которому изготовлена продукция, основа для декларации.`, items: list(r), href: `${base}/menu` }
        : { status: 'ok', detail: 'На всю продукцию с утверждённой ТТК есть ТУ.', href: `${base}/menu` };
    } },
  { key: 'allergens', group: 'Технологические документы', title: 'Аллергены сырья по документам', basis: ['sanpin4282:43'], blocks: [], owner: 'технолог',
    async run({ tx, orgId, base }) {
      const r = (await tx.query(`select distinct p.name from ttk_versions v join ttk_lines l on l.version_id = v.id join products p on p.id = l.product_id
        where v.organization_id = $1 and v.status = 'approved' and not exists (select 1 from product_allergens a where a.product_id = p.id) order by p.name`, [orgId])).rows;
      return r.length ? { status: 'incomplete', detail: `У сырья утверждённых ТТК не указаны аллергены: ${r.length}.`, items: list(r), href: `${base}/menu` }
        : { status: 'ok', detail: 'Аллергены всего сырья утверждённых ТТК внесены по документам.', href: `${base}/menu/reports` };
    } },

  { key: 'versioning', group: 'Технологические документы', title: 'Изменение ТТК — новой версией', basis: ['gost31987:5.3.4'], blocks: [], owner: 'система',
    async run() { return { status: 'ok', detail: 'Обеспечено системой: утверждённая ТТК не меняется, изменение оформляется новой версией с датой.' }; } },
  { key: 'docs_retention', group: 'Склад и партии', title: 'Документы о безопасности сырья хранятся', basis: ['trts021:11.4'], blocks: [], owner: 'система',
    async run() { return { status: 'ok', detail: 'Обеспечено системой: документы и фото приёмки — неизменяемые файлы с контрольной суммой, не удаляются.' }; } },

  // ───── персонал ─────
  { key: 'staff_medical', group: 'Персонал', title: 'Медосмотры работников, контактирующих с продукцией', basis: ['sanpin4282:24', 'trts021:11.6'], blocks: ['ppk_approve'], owner: 'руководитель / HR',
    async run({ tx, orgId, today, base }) {
      const r = (await tx.query(`select u.full_name as name, m.exam_due::text as due from memberships ms join users u on u.id = ms.user_id
        left join lateral (select exam_due from staff_medical x where x.organization_id = ms.organization_id and x.user_id = ms.user_id order by recorded_at desc limit 1) m on true
        where ms.organization_id = $1 and ms.status = 'active' and ms.role = any($2::text[]) order by u.full_name`, [orgId, FOOD_ROLES])).rows;
      if (!r.length) return { status: 'not_checked', detail: 'Работников цеха, склада и шефа в системе нет — проверить некого.', href: `${base}/staff` };
      const none = r.filter((x) => !x.due), exp = r.filter((x) => x.due && x.due < today);
      if (none.length) return { status: 'missing', detail: `Нет данных о медосмотре: ${none.length} из ${r.length}.`, items: list([...none.map((x) => ({ name: `${x.name}: нет данных` })), ...exp.map((x) => ({ name: `${x.name}: истёк ${dmy(x.due)}` }))]), href: `${base}/staff` };
      return exp.length ? { status: 'expired', detail: `Медосмотр истёк: ${exp.length} из ${r.length}.`, items: list(exp.map((x) => ({ name: `${x.name}: истёк ${dmy(x.due)}` }))), href: `${base}/staff` }
        : { status: 'ok', detail: `У всех ${r.length} работников медосмотр действует.`, href: `${base}/staff` };
    } },
  { key: 'staff_hygiene', group: 'Персонал', title: 'Гигиеническая подготовка и аттестация', basis: ['sanpin4282:24'], blocks: ['ppk_approve'], owner: 'руководитель / HR',
    async run({ tx, orgId, today, base }) {
      const r = (await tx.query(`select u.full_name as name, m.hygiene_due::text as due from memberships ms join users u on u.id = ms.user_id
        left join lateral (select hygiene_due from staff_medical x where x.organization_id = ms.organization_id and x.user_id = ms.user_id order by recorded_at desc limit 1) m on true
        where ms.organization_id = $1 and ms.status = 'active' and ms.role = any($2::text[]) order by u.full_name`, [orgId, FOOD_ROLES])).rows;
      if (!r.length) return { status: 'not_checked', detail: 'Работников цеха, склада и шефа в системе нет — проверить некого.', href: `${base}/staff` };
      const none = r.filter((x) => !x.due), exp = r.filter((x) => x.due && x.due < today);
      if (none.length) return { status: 'missing', detail: `Нет данных о гигиенической аттестации: ${none.length} из ${r.length}.`, items: list(none.map((x) => ({ name: x.name }))), href: `${base}/staff` };
      return exp.length ? { status: 'expired', detail: `Гигиеническая аттестация истекла: ${exp.length} из ${r.length}.`, items: list(exp.map((x) => ({ name: `${x.name}: истекла ${dmy(x.due)}` }))), href: `${base}/staff` }
        : { status: 'ok', detail: `У всех ${r.length} работников аттестация действует.`, href: `${base}/staff` };
    } },
  { key: 'health_checks', group: 'Персонал', title: 'Осмотр работавших сегодня перед сменой', basis: ['sanpin4282:25'], blocks: [], owner: 'шеф / администратор смены',
    async run({ tx, orgId, siteIds, today, base }) {
      const active = (await tx.query(`select distinct u.id, u.full_name as name from users u join memberships ms on ms.user_id = u.id and ms.organization_id = $1 and ms.role = any($3::text[])
        where u.id in (
          select author_user_id from measurements where organization_id = $1 and site_id = any($2::uuid[]) and measured_at::date = $4::date
          union select completed_by from receipts where organization_id = $1 and site_id = any($2::uuid[]) and completed_at::date = $4::date
          union select started_by from production_orders where organization_id = $1 and site_id = any($2::uuid[]) and started_at::date = $4::date
          union select done_by from sanitation_records where organization_id = $1 and site_id = any($2::uuid[]) and done_at::date = $4::date
          union select author_user_id from journal_entries where organization_id = $1 and site_id = any($2::uuid[]) and occurred_at::date = $4::date)`, [orgId, siteIds, FOOD_ROLES, today])).rows;
      const checked = new Set((await tx.query(`select user_id from health_checks where organization_id = $1 and checked_on = $2`, [orgId, today])).rows.map((x) => x.user_id));
      const miss = active.filter((x) => !checked.has(x.id));
      return miss.length ? { status: 'missing', detail: `Работали с продукцией сегодня без осмотра: ${miss.length}.`, items: list(miss), href: `${base}/staff` }
        : { status: 'ok', detail: active.length ? `Все ${active.length} работавших сегодня осмотрены.` : 'Сегодня с продукцией ещё никто не работал.', href: `${base}/staff` };
    } },

  // ───── оборудование и средства измерений ─────
  { key: 'instruments', group: 'Оборудование', title: 'Поверка/калибровка средств измерений действует', basis: ['trts021:15.2', 'sanpin4282:40'], blocks: ['ppk_approve'], owner: 'технолог / завхоз',
    async run({ tx, orgId, siteIds, today, base }) {
      const r = (await tx.query(`select name, calibration_due::text as due from equipment where organization_id = $1 and site_id = any($2::uuid[]) and measuring and status = 'active' order by name`, [orgId, siteIds])).rows;
      if (!r.length) return { status: 'missing', detail: 'В реестре оборудования нет ни одного средства измерения.', href: `${base}/equipment` };
      const none = r.filter((x) => !x.due), exp = r.filter((x) => x.due && x.due < today);
      const items = list([...none.map((x) => ({ name: `${x.name}: срок поверки не указан` })), ...exp.map((x) => ({ name: `${x.name}: истекла ${dmy(x.due)}` }))]);
      if (exp.length) return { status: 'expired', detail: `Поверка истекла: ${exp.length} из ${r.length}.`, items, href: `${base}/equipment` };
      return none.length ? { status: 'incomplete', detail: `Срок поверки не указан: ${none.length} из ${r.length} — действительность не подтверждена.`, items, href: `${base}/equipment` }
        : { status: 'ok', detail: `Поверка действует у всех ${r.length} средств измерений.`, href: `${base}/equipment` };
    } },
  { key: 'equipment_state', group: 'Оборудование', title: 'Состояние оборудования', basis: ['trts021:15.2'], blocks: [], owner: 'завхоз',
    async run({ tx, orgId, siteIds, base }) {
      const r = (await tx.query(`select name from equipment where organization_id = $1 and site_id = any($2::uuid[]) and status = 'broken' order by name`, [orgId, siteIds])).rows;
      return r.length ? { status: 'warning', detail: `Неисправно оборудование: ${r.length}.`, items: list(r), href: `${base}/equipment` } : { status: 'ok', detail: 'Неисправного оборудования нет.', href: `${base}/equipment` };
    } },
  { key: 'daily_temps', group: 'Контроль условий хранения', title: 'Ежедневная регистрация температуры и влажности', basis: ['sanpin4282:35'], blocks: [], owner: 'сотрудники смены',
    async run({ tx, orgId, siteIds, today, base }) {
      const objs = (await tx.query(`select o.id, o.name, o.kind, greatest(o.created_at::date, $3::date - 6)::text as since from control_objects o
        where o.organization_id = $1 and o.site_id = any($2::uuid[]) and o.status = 'active' and o.kind in ('fridge', 'freezer', 'room')`, [orgId, siteIds, today])).rows;
      if (!objs.length) return { status: 'missing', detail: 'Нет объектов контроля: холодильники и склады не заведены.', href: `${base}/setup` };
      const gaps: { name: string }[] = [];
      for (const o of objs) for (const param of o.kind === 'room' ? ['temperature', 'humidity'] : ['temperature']) {
        const days = Number((await tx.query(`select count(distinct measured_at::date) from measurements where control_object_id = $1 and parameter = $2 and measured_at::date between $3::date and $4::date`, [o.id, param, o.since, today])).rows[0].count);
        const need = Math.round((Date.parse(today) - Date.parse(o.since)) / 864e5) + 1;
        if (days < need) gaps.push({ name: `${o.name}: ${param === 'humidity' ? 'влажность' : 'температура'} — ${need - days} дн. без записи` });
      }
      return gaps.length ? { status: 'incomplete', detail: `Пропуски ежедневной регистрации за 7 дней: ${gaps.length}. Значения задним числом не подставляются.`, items: list(gaps), href: `${base}/shift` }
        : { status: 'ok', detail: `Регистрация ведётся ежедневно по ${objs.length} объектам.`, href: `${base}/shift` };
    } },
  { key: 'storage_objects', group: 'Контроль условий хранения', title: 'Допустимые диапазоны объектов контроля утверждены', basis: ['sanpin4282:35'], blocks: ['ppk_approve'], owner: 'ответственный ХАССП',
    async run({ tx, orgId, siteIds, base }) {
      const r = (await tx.query(`select o.name from control_objects o where o.organization_id = $1 and o.site_id = any($2::uuid[]) and o.status = 'active'
        and not exists (select 1 from control_rules r where r.control_object_id = o.id and r.status = 'approved') order by o.name`, [orgId, siteIds])).rows;
      const n = Number((await tx.query(`select count(*) from control_objects where organization_id = $1 and site_id = any($2::uuid[]) and status = 'active'`, [orgId, siteIds])).rows[0].count);
      if (!n) return { status: 'missing', detail: 'Объекты контроля не заведены.', href: `${base}/objects` };
      return r.length ? { status: 'incomplete', detail: `Объекты без утверждённого диапазона: ${r.length} из ${n}.`, items: list(r), href: `${base}/objects` } : { status: 'ok', detail: `Диапазоны утверждены для всех ${n} объектов.`, href: `${base}/objects` };
    } },
  { key: 'fryer', group: 'Контроль условий хранения', title: 'Ежедневный контроль фритюрных жиров', basis: ['sanpin4282:44'], blocks: [], owner: 'повар фритюра',
    async run({ tx, orgId, siteIds, today, base, profile }) {
      if (!profile.features.includes('fryer')) return { status: 'not_applicable', detail: 'Фритюра в профиле нет.' };
      const last = (await tx.query(`select max(occurred_at)::date::text as d from journal_entries where organization_id = $1 and site_id = any($2::uuid[]) and form_code in ('J38', 'J41')`, [orgId, siteIds])).rows[0].d;
      if (!last) return { status: 'missing', detail: 'Журнал контроля фритюрных жиров не ведётся.', href: `${base}/journals/J38` };
      return last === today ? { status: 'ok', detail: 'Контроль фритюрных жиров сегодня записан.', href: `${base}/journals/J38` }
        : { status: 'overdue', detail: `Последняя запись — ${dmy(last)}; нужен ежедневный контроль. Запись делает человек по факту теста.`, href: `${base}/journals/J38` };
    } },

  // ───── санитария, договоры, лаборатория ─────
  { key: 'daily_cleaning', group: 'Санитария', title: 'Ежедневная уборка с дезинфицирующим средством', basis: ['sanpin4282:21'], blocks: ['ppk_approve'], owner: 'шеф',
    async run({ tx, orgId, siteIds, today, base }) {
      const plans = (await tx.query(`select p.area || ': ' || p.work as name, p.next_due::text as due from sanitation_plans p where p.organization_id = $1 and p.site_id = any($2::uuid[]) and p.status = 'active'
        and p.period_days = 1 and p.disinfectant_id is not null`, [orgId, siteIds])).rows;
      if (!plans.length) return { status: 'missing', detail: 'В плане санитарии нет ежедневной уборки с дезинфицирующим средством.', href: `${base}/sanitation` };
      const late = plans.filter((p) => p.due < today);
      return late.length ? { status: 'overdue', detail: `Ежедневная уборка просрочена: ${late.length}.`, items: list(late), href: `${base}/sanitation` }
        : { status: 'ok', detail: `Ежедневная уборка с дезсредством в плане (${plans.length}) и выполняется.`, href: `${base}/sanitation` };
    } },
  { key: 'disinfectants', group: 'Санитария', title: 'Дезинфицирующие средства с режимами утверждены', basis: ['sanpin4282:46'], blocks: ['ppk_approve'], owner: 'технолог',
    async run({ tx, orgId, base }) {
      const r = (await tx.query(`select status, count(*)::int as n from disinfectants where organization_id = $1 group by status`, [orgId])).rows;
      const ok = r.find((x) => x.status === 'approved')?.n || 0, draft = r.filter((x) => x.status === 'draft').reduce((s, x) => s + x.n, 0);
      if (!ok) return { status: 'missing', detail: 'Нет утверждённого дезинфицирующего средства с режимом.', href: `${base}/sanitation` };
      return { status: draft ? 'warning' : 'ok', detail: `Утверждённых средств: ${ok}.${draft ? ` Не утверждено: ${draft}.` : ''}`, href: `${base}/sanitation` };
    } },
  { key: 'concentration', group: 'Санитария', title: 'Контроль концентрации рабочих растворов', basis: ['sanpin4282:47'], blocks: ['ppk_approve'], owner: 'технолог',
    async run({ tx, orgId, siteIds, base }) {
      const n = Number((await tx.query(`select count(*) from sanitation_plans where organization_id = $1 and site_id = any($2::uuid[]) and status = 'active' and check_concentration`, [orgId, siteIds])).rows[0].count);
      return n ? { status: 'ok', detail: `Контроль концентрации в плане: ${n}.`, href: `${base}/sanitation` } : { status: 'missing', detail: 'Ни в одном плане санитарии нет контроля концентрации.', href: `${base}/sanitation` };
    } },
  ...(['pest_control', 'waste', 'lab'] as const).map((kind): Def => ({
    key: `contract_${kind === 'pest_control' ? 'pest' : kind}`, group: 'Договоры',
    title: { pest_control: 'Договор на дезинсекцию и дератизацию', waste: 'Договор на вывоз отходов', lab: 'Договор с аккредитованной лабораторией' }[kind],
    basis: { pest_control: ['sanpin4282:26', 'sanpin4282:45'], waste: ['sanpin4282:20', 'trts021:16.3'], lab: ['sanpin4282:4'] }[kind], blocks: ['ppk_approve'], owner: 'руководитель',
    async run({ tx, orgId, siteIds, base }) {
      const c = (await requiredContractsState(tx, orgId, siteIds)).find((x) => x.kind === kind)!;
      const status: RStatus = ({ ok: 'ok', expiring: 'warning', expired: 'expired', no_file: 'incomplete', terminated: 'missing', not_started: 'missing', missing: 'missing' } as Record<string, RStatus>)[c.state] || 'missing';
      return { status, detail: `${c.label}: ${c.detail}${c.state === 'no_file' ? ' — без файла договор не доказывает ничего' : ''}.`, href: `${base}/contracts` };
    } })),
  { key: 'lab_program', group: 'Лабораторный контроль', title: 'Программа лабораторных исследований выполняется', basis: ['sanpin4282:4', 'sp4285:4'], blocks: ['ppk_approve'], owner: 'ответственный ХАССП',
    async run({ tx, orgId, siteIds, today, base }) {
      const r = (await tx.query(`select p.test_type || ': ' || p.target as name, p.next_due::text as due, p.period_days, p.created_at::date::text as created,
          (select max(x.result_on)::text from lab_results x where x.program_id = p.id and x.protocol_no is not null and x.protocol_no <> '') as last_protocol
        from lab_programs p where p.organization_id = $1 and p.site_id = any($2::uuid[]) and p.status = 'active' order by p.next_due`, [orgId, siteIds])).rows;
      if (!r.length) return { status: 'missing', detail: 'Нет программы лабораторных исследований.', href: `${base}/lab` };
      const late = r.filter((x) => x.due < today);
      // исследование, срок первого цикла которого прошёл, а протокола нет — данные неполные
      const noProto = r.filter((x) => !x.last_protocol && Date.parse(today) - Date.parse(x.created) > Number(x.period_days) * 864e5);
      if (late.length) return { status: 'overdue', detail: `Просрочены исследования: ${late.length} из ${r.length}.`, items: list(late.map((x) => ({ name: `${x.name}: срок ${dmy(x.due)}` }))), href: `${base}/lab` };
      return noProto.length ? { status: 'incomplete', detail: `Нет протокола исследования за прошедший период: ${noProto.length} из ${r.length}.`, items: list(noProto), href: `${base}/lab` }
        : { status: 'ok', detail: `Исследований в программе: ${r.length}, сроки соблюдаются.`, href: `${base}/lab` };
    } },
  { key: 'water_lab', group: 'Лабораторный контроль', title: 'Исследование питьевой воды в программе', basis: ['sanpin4282:13', 'trts021:12'], blocks: ['ppk_approve'], owner: 'ответственный ХАССП',
    async run({ tx, orgId, siteIds, base }) {
      const n = Number((await tx.query(`select count(*) from lab_programs where organization_id = $1 and site_id = any($2::uuid[]) and status = 'active' and (test_type ilike '%вод%' or target ilike '%вод%')`, [orgId, siteIds])).rows[0].count);
      return n ? { status: 'ok', detail: 'Исследование воды в программе.', href: `${base}/lab` } : { status: 'missing', detail: 'В программе нет исследования воды.', href: `${base}/lab` };
    } },
  { key: 'microclimate_lab', group: 'Лабораторный контроль', title: 'Микроклимат рабочих мест не реже раза в год', basis: ['sp4285:15'], blocks: ['ppk_approve'], owner: 'ответственный ХАССП',
    async run({ tx, orgId, siteIds, base }) {
      const n = Number((await tx.query(`select count(*) from lab_programs where organization_id = $1 and site_id = any($2::uuid[]) and status = 'active' and period_days <= 366 and (test_type ilike '%микроклим%' or target ilike '%микроклим%')`, [orgId, siteIds])).rows[0].count);
      return n ? { status: 'ok', detail: 'Микроклимат в программе (не реже раза в год).', href: `${base}/lab` } : { status: 'missing', detail: 'В программе нет измерения микроклимата не реже раза в год.', href: `${base}/lab` };
    } },
  { key: 'daily_samples', group: 'Лабораторный контроль', title: 'Суточные пробы', basis: ['sanpin4282:56.4', 'sanpin4282:59.10'], blocks: ['ppk_approve'], owner: 'шеф',
    async run({ tx, orgId, siteIds, today, base, profile }) {
      if (!samplesRequired(profile)) return { status: 'not_applicable', detail: 'Суточная проба обязательна для медицинских и социальных организаций и питания детей; по профилю не требуется.' };
      const s = (await tx.query(`select min_weight_g, retention_hours, t_min, t_max, basis from sample_settings where organization_id = $1`, [orgId])).rows[0];
      const empty = !s || !s.min_weight_g || !s.retention_hours || s.t_min == null || s.t_max == null || !s.basis?.trim();
      if (empty) return { status: s ? 'incomplete' : 'missing', detail: s ? 'Параметры суточной пробы заполнены не полностью (масса, срок хранения, температура, основание).' : 'Параметры суточной пробы не утверждены.', href: `${base}/lab` };
      const n = Number((await tx.query(`select count(*) from daily_samples where organization_id = $1 and site_id = any($2::uuid[]) and taken_at::date = $3::date`, [orgId, siteIds, today])).rows[0].count);
      return n ? { status: 'ok', detail: `Сегодня отобрано суточных проб: ${n}.`, href: `${base}/lab` } : { status: 'warning', detail: 'Сегодня суточные пробы ещё не отбирались.', href: `${base}/lab` };
    } },
  { key: 'capa_overdue', group: 'Корректирующие действия', title: 'Корректирующие действия в срок', basis: ['trts021:11.3'], blocks: [], owner: 'ответственный ХАССП',
    async run({ tx, orgId, base }) {
      const r = (await tx.query(`select title as name, due_at from capas where organization_id = $1 and status in ('open', 'in_progress') and due_at < now() order by due_at`, [orgId])).rows;
      const open = Number((await tx.query(`select count(*) from capas where organization_id = $1 and status <> 'closed'`, [orgId])).rows[0].count);
      return r.length ? { status: 'overdue', detail: `Просрочены корректирующие действия: ${r.length} (открытых всего ${open}).`, items: list(r), href: `${base}/capa` }
        : { status: 'ok', detail: open ? `Открытых корректирующих действий: ${open}, просроченных нет.` : 'Открытых корректирующих действий нет.', href: `${base}/capa` };
    } },

  // ───── склад и партии ─────
  { key: 'receipt_docs', group: 'Склад и партии', title: 'Приёмка только с маркировкой и документами', basis: ['sanpin4282:5'], blocks: [], owner: 'кладовщик',
    async run({ tx, orgId, siteIds, base }) {
      const r = (await tx.query(`select p.name || ' (' || coalesce(rc.document_no, 'без документа') || ')' as name from receipt_lines l join receipts rc on rc.id = l.receipt_id join products p on p.id = l.product_id
        where l.organization_id = $1 and rc.site_id = any($2::uuid[]) and l.decision = 'accepted' and rc.created_at > now() - interval '30 days'
          and (coalesce((l.checks->>'documents')::boolean, false) = false or coalesce((l.checks->>'labeling')::boolean, false) = false)`, [orgId, siteIds])).rows;
      return r.length ? { status: 'incomplete', detail: `Принято без документов или маркировки за 30 дней: ${r.length}.`, items: list(r), href: `${base}/stock` }
        : { status: 'ok', detail: 'Приёмка за 30 дней — с документами и маркировкой.', href: `${base}/stock` };
    } },
  { key: 'expired_lots', group: 'Склад и партии', title: 'Просроченные партии на остатке', basis: ['sanpin4282:6', 'trts021:18'], blocks: [], owner: 'кладовщик / шеф',
    async run({ tx, orgId, siteIds, base }) {
      const r = (await tx.query(`select p.name || coalesce(' · ' || l.lot_no, '') || ' — истёк ' || to_char(l.expires_at, 'DD.MM.YYYY') as name from lots l join products p on p.id = l.product_id
        where l.organization_id = $1 and l.site_id = any($2::uuid[]) and l.quantity > 0 and l.expires_at < now() and l.status in ('available', 'quarantine', 'blocked') order by l.expires_at`, [orgId, siteIds])).rows;
      return r.length ? { status: 'expired', detail: `Партии с истёкшим сроком не утилизированы: ${r.length}.`, items: list(r), href: `${base}/lots` } : { status: 'ok', detail: 'Просроченных партий на остатке нет.', href: `${base}/lots` };
    } },
  { key: 'storage_expiry', group: 'Склад и партии', title: 'Партии без подтверждённого срока', basis: ['trts021:17.7'], blocks: [], owner: 'кладовщик',
    async run({ tx, orgId, siteIds, base }) {
      const r = (await tx.query(`select p.name || coalesce(' · ' || l.lot_no, '') as name from lots l join products p on p.id = l.product_id
        where l.organization_id = $1 and l.site_id = any($2::uuid[]) and l.quantity > 0 and l.status in ('available', 'quarantine', 'blocked') and (l.expires_at is null or l.expiry_basis is null) order by p.name`, [orgId, siteIds])).rows;
      return r.length ? { status: 'incomplete', detail: `Партии без подтверждённого срока: ${r.length}.`, items: list(r), href: `${base}/lots` } : { status: 'ok', detail: 'У всех партий на хранении срок подтверждён.', href: `${base}/lots` };
    } },
  { key: 'quarantine_lots', group: 'Склад и партии', title: 'Карантинные остатки', basis: ['trts021:18'], blocks: [], owner: 'шеф',
    async run({ tx, orgId, siteIds, base }) {
      const r = (await tx.query(`select p.name || coalesce(' · ' || l.lot_no, '') as name from lots l join products p on p.id = l.product_id
        where l.organization_id = $1 and l.site_id = any($2::uuid[]) and l.quantity > 0 and l.status = 'quarantine' order by p.name`, [orgId, siteIds])).rows;
      return r.length ? { status: 'warning', detail: `На карантине: ${r.length} — нужно решение (вернуть, списать, допустить).`, items: list(r), href: `${base}/lots` } : { status: 'ok', detail: 'Карантинных остатков нет.', href: `${base}/lots` };
    } },
  { key: 'lots_no_price', group: 'Экономика', title: 'Партии без цены', basis: [], blocks: [], owner: 'кладовщик / бухгалтер',
    async run({ tx, orgId, siteIds, base }) {
      const r = (await tx.query(`select p.name || coalesce(' · ' || l.lot_no, '') as name from lots l join products p on p.id = l.product_id
        where l.organization_id = $1 and l.site_id = any($2::uuid[]) and l.quantity > 0 and l.unit_price is null order by p.name`, [orgId, siteIds])).rows;
      return r.length ? { status: 'incomplete', detail: `Партий без цены на остатке: ${r.length} — себестоимость по ним неизвестна, нулём не считается.`, items: list(r), href: `${base}/lots` } : { status: 'ok', detail: 'У всех партий на остатке есть цена.', href: `${base}/lots` };
    } },
  { key: 'sales_unfulfilled', group: 'Экономика', title: 'Продажи без ТТК и без списания', basis: [], blocks: [], owner: 'шеф / бухгалтер',
    async run({ tx, orgId, siteIds, base }) {
      const r = (await tx.query(`select fulfil_status, count(*)::int as n from sales where organization_id = $1 and site_id = any($2::uuid[]) and sold_at > now() - interval '30 days'
        and fulfil_status in ('no_ttk', 'unmatched', 'failed', 'pending') group by fulfil_status`, [orgId, siteIds])).rows;
      if (!r.length) return { status: 'ok', detail: 'За 30 дней все продажи списаны по ТТК.', href: `${base}/sales` };
      const L: Record<string, string> = { no_ttk: 'без ТТК', unmatched: 'не сопоставлены с блюдом', failed: 'списание не прошло', pending: 'ожидают списания' };
      return { status: 'incomplete', detail: `Продажи за 30 дней без полного списания: ${r.map((x) => `${L[x.fulfil_status]} — ${x.n}`).join(', ')}. Себестоимость и фудкост по ним неполные.`, href: `${base}/sales` };
    } },
  { key: 'writeoffs_no_price', group: 'Экономика', title: 'Списания без цены', basis: [], blocks: [], owner: 'бухгалтер',
    async run({ tx, orgId, siteIds, base }) {
      const n = Number((await tx.query(`select count(*) from stock_movements m join lots l on l.id = m.lot_id where m.organization_id = $1 and m.site_id = any($2::uuid[]) and m.kind = 'write_off'
        and m.created_at > now() - interval '30 days' and l.unit_price is null`, [orgId, siteIds])).rows[0].count);
      return n ? { status: 'incomplete', detail: `Списаний без цены за 30 дней: ${n} — потери в рублях неполные.`, href: `${base}/stock` } : { status: 'ok', detail: 'У всех списаний за 30 дней известна цена.', href: `${base}/stock` };
    } },
];

registerNormRefs('readiness', DEFS.flatMap((d) => d.basis));
export const READINESS_KEYS = DEFS.map((d) => d.key);

export async function contextFor(tx: Tx, orgId: string, siteIds?: string[] | null, asOf?: string | null): Promise<Ctx> {
  const org = (await tx.query(`select timezone, region from organizations where id = $1`, [orgId])).rows[0];
  await tx.query(`select set_config('timezone', $1, true)`, [org.timezone || 'Europe/Moscow']);
  const today = asOf || (await tx.query(`select current_date::text as d`)).rows[0].d as string;
  const sites = siteIds && siteIds.length ? siteIds : (await tx.query(`select id from sites where organization_id = $1 and status = 'active'`, [orgId])).rows.map((s) => s.id);
  const pr = (await tx.query(`select object_types, sales_modes, seats, features from org_regulatory_profiles where organization_id = $1`, [orgId])).rows[0];
  const profile: NormProfile = { objectTypes: pr?.object_types || [], salesModes: pr?.sales_modes || [], seats: pr?.seats ?? null, features: pr?.features || [], region: org.region || null };
  return { tx, orgId, siteIds: sites, today, base: `/app/${orgId}`, profile };
}

/** Один пункт (для «Готов ли я к проверке» по пункту нормативной базы). */
export async function runReadinessItem(key: string, ctx: Ctx): Promise<RItem> {
  const d = DEFS.find((x) => x.key === key);
  if (!d) return { key, group: 'Нормативная основа', title: key, status: 'blocked', detail: `Проверка «${key}» не найдена в движке готовности.`, basis: [], blocks: ['ppk_approve'], owner: 'администратор системы' };
  const r = await d.run(ctx);
  return { key: d.key, group: d.group, title: d.title, basis: d.basis.filter((id) => clauseById.has(id) && applies(clauseById.get(id)!, ctx.profile)), blocks: d.blocks, owner: d.owner, href: null, items: [], ...r };
}

/**
 * Единая проверка готовности предприятия на дату. options.keys — подмножество (по умолчанию все);
 * options.exclude — исключить (конструктор ППК не проверяет сам себя).
 */
export async function validateEnterpriseReadiness(tx: Tx, orgId: string, asOfDate?: string | null, options: { siteIds?: string[] | null; keys?: string[]; exclude?: string[] } = {}) {
  const ctx = await contextFor(tx, orgId, options.siteIds, asOfDate);
  const keys = (options.keys || READINESS_KEYS).filter((k) => !(options.exclude || []).includes(k));
  const items: RItem[] = [];
  for (const k of keys) items.push(await runReadinessItem(k, ctx));
  const count = (s: RStatus) => items.filter((i) => i.status === s).length;
  const blocking = (what: Blocks) => items.filter((i) => i.blocks.includes(what) && isBad(i.status));
  return {
    as_of: ctx.today, items,
    summary: Object.fromEntries((['ok', 'not_checked', 'not_applicable', 'missing', 'overdue', 'expired', 'warning', 'incomplete', 'blocked'] as RStatus[]).map((s) => [s, count(s)])) as Record<RStatus, number>,
    blocking_ppk: blocking('ppk_approve'),
  };
}
