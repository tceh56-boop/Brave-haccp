import type { Tx } from '../db/pool';
import { requiredContractsState } from '../ops/contracts';

/**
 * Проверки требований нормативной библиотеки по данным системы. Каждая проверка отвечает на вопрос «выполнено ли
 * требование по записям предприятия» и, если нет, — что именно не так и где это исправить. Нет данных — не «выполнено»:
 * система пишет, чего не хватает.
 */

export type CheckStatus = 'ok' | 'fail' | 'warn';
export interface CheckResult { status: CheckStatus; detail: string; href?: string; items?: string[] }
interface Ctx { tx: Tx; orgId: string; siteIds: string[]; today: string; base: string }

const list = (rows: { name: string }[], max = 6) => rows.slice(0, max).map((r) => r.name).concat(rows.length > max ? [`… ещё ${rows.length - max}`] : []);
const FOOD_ROLES = ['line_staff', 'chef', 'storekeeper'];

const CHECKS: Record<string, (c: Ctx) => Promise<CheckResult>> = {
  async haccp_plan({ tx, orgId, base }) {
    const p = (await tx.query(`select version, approved_at::date::text as d from haccp_plans where organization_id = $1 and status = 'approved' order by version desc limit 1`, [orgId])).rows[0];
    return p ? { status: 'ok', detail: `План ХАССП утверждён (версия ${p.version}, ${p.d.split('-').reverse().join('.')}).`, href: `${base}/haccp` }
      : { status: 'fail', detail: 'Нет утверждённого плана ХАССП — производственный контроль на принципах ХАССП не подтверждён.', href: `${base}/haccp` };
  },

  async receipt_docs({ tx, orgId, siteIds, base }) {
    const r = (await tx.query(`select p.name || ' (' || coalesce(rc.document_no, 'без документа') || ')' as name from receipt_lines l join receipts rc on rc.id = l.receipt_id join products p on p.id = l.product_id
      where l.organization_id = $1 and rc.site_id = any($2::uuid[]) and l.decision = 'accepted' and rc.created_at > now() - interval '30 days'
        and (coalesce((l.checks->>'documents')::boolean, false) = false or coalesce((l.checks->>'labeling')::boolean, false) = false)`, [orgId, siteIds])).rows;
    const n = Number((await tx.query(`select count(*) from receipt_lines l join receipts rc on rc.id = l.receipt_id where l.organization_id = $1 and rc.site_id = any($2::uuid[]) and rc.created_at > now() - interval '30 days'`, [orgId, siteIds])).rows[0].count);
    if (r.length) return { status: 'fail', detail: `Принято без документов или маркировки за 30 дней: ${r.length}.`, items: list(r), href: `${base}/stock` };
    return { status: 'ok', detail: n ? `Все ${n} позиций приёмки за 30 дней — с документами и маркировкой.` : 'Приёмок за 30 дней нет; приёмка без документов и маркировки системой не принимается.', href: `${base}/stock` };
  },

  async expired_lots({ tx, orgId, siteIds, base }) {
    const r = (await tx.query(`select p.name || coalesce(' · ' || l.lot_no, '') || ' — истёк ' || to_char(l.expires_at, 'DD.MM.YYYY') as name from lots l join products p on p.id = l.product_id
      where l.organization_id = $1 and l.site_id = any($2::uuid[]) and l.quantity > 0 and l.expires_at < now() and l.status in ('available', 'quarantine', 'blocked') order by l.expires_at`, [orgId, siteIds])).rows;
    return r.length ? { status: 'fail', detail: `Партии с истёкшим сроком не утилизированы: ${r.length}. Спишите их с причиной «истёк срок».`, items: list(r), href: `${base}/lots` }
      : { status: 'ok', detail: 'Партий с истёкшим сроком на остатке нет; истёкшая партия блокируется для расхода.', href: `${base}/lots` };
  },

  async tech_docs({ tx, orgId, base }) {
    const r = (await tx.query(`select d.name from dishes d where d.organization_id = $1 and d.status = 'active'
      and not exists (select 1 from ttk_versions v where v.dish_id = d.id and v.status = 'approved') order by d.name`, [orgId])).rows;
    return r.length ? { status: 'fail', detail: `Блюд и полуфабрикатов без утверждённой ТТК: ${r.length}. Готовить их по закону нельзя.`, items: list(r), href: `${base}/menu` }
      : { status: 'ok', detail: 'На каждое блюдо и полуфабрикат есть утверждённая ТТК; списание и производство — только по ней.', href: `${base}/menu` };
  },

  async water_lab({ tx, orgId, siteIds, base }) {
    const n = Number((await tx.query(`select count(*) from lab_programs where organization_id = $1 and site_id = any($2::uuid[]) and status = 'active' and (test_type ilike '%вод%' or target ilike '%вод%')`, [orgId, siteIds])).rows[0].count);
    return n ? { status: 'ok', detail: 'Исследование воды включено в программу лабораторного контроля.', href: `${base}/lab` }
      : { status: 'warn', detail: 'В программе лабораторного контроля нет исследования воды — качество воды нечем подтвердить.', href: `${base}/lab` };
  },

  async lab_program({ tx, orgId, siteIds, today, base }) {
    const r = (await tx.query(`select count(*)::int as n, count(*) filter (where next_due < $3::date)::int as late from lab_programs where organization_id = $1 and site_id = any($2::uuid[]) and status = 'active'`, [orgId, siteIds, today])).rows[0];
    if (!r.n) return { status: 'fail', detail: 'Нет программы лабораторных исследований с аккредитованной лабораторией.', href: `${base}/lab` };
    return r.late ? { status: 'fail', detail: `Просрочены исследования по программе: ${r.late} из ${r.n}.`, href: `${base}/lab` }
      : { status: 'ok', detail: `Программа лабораторного контроля: ${r.n} исследований, сроки соблюдаются.`, href: `${base}/lab` };
  },

  async contract_waste(c) { return contract(c, 'waste'); },
  async contract_pest(c) { return contract(c, 'pest_control'); },

  async daily_cleaning({ tx, orgId, siteIds, today, base }) {
    const plans = (await tx.query(`select p.area || ': ' || p.work as name, p.next_due::text as due from sanitation_plans p where p.organization_id = $1 and p.site_id = any($2::uuid[]) and p.status = 'active'
      and p.period_days = 1 and p.disinfectant_id is not null`, [orgId, siteIds])).rows;
    if (!plans.length) return { status: 'fail', detail: 'В плане санитарии нет ежедневной влажной уборки производственных помещений с дезинфицирующим средством.', href: `${base}/sanitation` };
    const late = plans.filter((p) => p.due < today);
    return late.length ? { status: 'fail', detail: `Ежедневная уборка с дезсредством просрочена: ${late.length}.`, items: list(late), href: `${base}/sanitation` }
      : { status: 'ok', detail: `Ежедневная уборка с дезсредством в плане (${plans.length}) и выполняется по графику.`, href: `${base}/sanitation` };
  },

  async staff_medical({ tx, orgId, today, base }) {
    const r = (await tx.query(`select u.full_name as name, m.exam_due::text as exam_due, m.hygiene_due::text as hyg from memberships ms join users u on u.id = ms.user_id
      left join lateral (select exam_due, hygiene_due from staff_medical x where x.organization_id = ms.organization_id and x.user_id = ms.user_id order by recorded_at desc limit 1) m on true
      where ms.organization_id = $1 and ms.status = 'active' and ms.role = any($2::text[]) order by u.full_name`, [orgId, FOOD_ROLES])).rows;
    const bad = r.filter((x) => !x.exam_due || x.exam_due < today || !x.hyg || x.hyg < today)
      .map((x) => ({ name: `${x.name}: ${!x.exam_due ? 'нет данных ЛМК' : x.exam_due < today ? 'медосмотр истёк' : 'аттестация истекла'}` }));
    if (!r.length) return { status: 'warn', detail: 'Нет работников цеха, склада или шефа в системе — проверить медосмотры некого.', href: `${base}/staff` };
    return bad.length ? { status: 'fail', detail: `Без действующего медосмотра или гигиенической аттестации: ${bad.length} из ${r.length}.`, items: list(bad), href: `${base}/staff` }
      : { status: 'ok', detail: `У всех ${r.length} работников, контактирующих с продукцией, действуют медосмотр и аттестация.`, href: `${base}/staff` };
  },

  async health_checks({ tx, orgId, siteIds, today, base }) {
    // кто работал с продукцией сегодня (замеры, приёмка, производство, уборка, журналы) — должен быть осмотрен сегодня
    const active = (await tx.query(`select distinct u.id, u.full_name as name from users u join memberships ms on ms.user_id = u.id and ms.organization_id = $1 and ms.role = any($3::text[])
      where u.id in (
        select author_user_id from measurements where organization_id = $1 and site_id = any($2::uuid[]) and measured_at::date = $4::date
        union select completed_by from receipts where organization_id = $1 and site_id = any($2::uuid[]) and completed_at::date = $4::date
        union select started_by from production_orders where organization_id = $1 and site_id = any($2::uuid[]) and started_at::date = $4::date
        union select done_by from sanitation_records where organization_id = $1 and site_id = any($2::uuid[]) and done_at::date = $4::date
        union select author_user_id from journal_entries where organization_id = $1 and site_id = any($2::uuid[]) and occurred_at::date = $4::date)`, [orgId, siteIds, FOOD_ROLES, today])).rows;
    const checked = new Set((await tx.query(`select user_id from health_checks where organization_id = $1 and checked_on = $2`, [orgId, today])).rows.map((x) => x.user_id));
    const miss = active.filter((x) => !checked.has(x.id));
    if (miss.length) return { status: 'fail', detail: `Работали с продукцией сегодня без осмотра: ${miss.length}. Список в гигиеническом журнале должен совпадать со сменой.`, items: list(miss), href: `${base}/staff` };
    return { status: 'ok', detail: active.length ? `Все ${active.length} работавших сегодня осмотрены перед сменой.` : 'Сегодня с продукцией ещё никто не работал; осмотр отмечается в разделе «Персонал».', href: `${base}/staff` };
  },

  async daily_temps({ tx, orgId, siteIds, today, base }) {
    const objs = (await tx.query(`select o.id, o.name, o.kind, greatest(o.created_at::date, $3::date - 6)::text as since from control_objects o
      where o.organization_id = $1 and o.site_id = any($2::uuid[]) and o.status = 'active' and o.kind in ('fridge', 'freezer', 'room')`, [orgId, siteIds, today])).rows;
    if (!objs.length) return { status: 'fail', detail: 'Нет объектов контроля: холодильники и склады не заведены — регистрировать температуру негде.', href: `${base}/setup` };
    const gaps: { name: string }[] = [];
    for (const o of objs) {
      for (const param of o.kind === 'room' ? ['temperature', 'humidity'] : ['temperature']) {
        const days = Number((await tx.query(`select count(distinct measured_at::date) from measurements where control_object_id = $1 and parameter = $2 and measured_at::date between $3::date and $4::date`,
          [o.id, param, o.since, today])).rows[0].count);
        const need = Math.round((Date.parse(today) - Date.parse(o.since)) / 864e5) + 1;
        if (days < need) gaps.push({ name: `${o.name}: ${param === 'humidity' ? 'влажность' : 'температура'} — ${need - days} дн. без записи` });
      }
    }
    return gaps.length ? { status: 'fail', detail: `За последние 7 дней есть дни без ежедневной регистрации: ${gaps.length}.`, items: list(gaps), href: `${base}/shift` }
      : { status: 'ok', detail: `Температура (и влажность складов) регистрируется ежедневно по ${objs.length} объектам.`, href: `${base}/shift` };
  },

  async instruments({ tx, orgId, siteIds, today, base }) {
    const r = (await tx.query(`select count(*) filter (where measuring and status = 'active' and calibration_due >= $3::date) as ok, count(*) filter (where measuring and status = 'active') as total
      from equipment where organization_id = $1 and site_id = any($2::uuid[])`, [orgId, siteIds, today])).rows[0];
    const rooms = Number((await tx.query(`select count(*) from control_objects where organization_id = $1 and site_id = any($2::uuid[]) and status = 'active' and kind = 'room'`, [orgId, siteIds])).rows[0].count);
    if (!Number(r.total)) return { status: 'fail', detail: 'В реестре оборудования нет ни одного средства измерения (контрольного термометра, гигрометра).', href: `${base}/equipment` };
    if (!Number(r.ok)) return { status: 'fail', detail: 'Ни у одного средства измерения нет действующей поверки.', href: `${base}/equipment` };
    return { status: rooms ? 'warn' : 'ok', detail: `Средств измерения с действующей поверкой: ${r.ok} из ${r.total}.${rooms ? ' Проверьте на месте: в каждом складе — прибор для температуры и влажности, в каждом холодильнике — контрольный термометр.' : ''}`, href: `${base}/equipment` };
  },

  async allergens({ tx, orgId, base }) {
    const r = (await tx.query(`select distinct p.name from ttk_versions v join ttk_lines l on l.version_id = v.id join products p on p.id = l.product_id
      where v.organization_id = $1 and v.status = 'approved' and not exists (select 1 from product_allergens a where a.product_id = p.id) order by p.name`, [orgId])).rows;
    return r.length ? { status: 'fail', detail: `У сырья утверждённых ТТК не указаны аллергены (по документу): ${r.length}. Сведения об аллергенах в блюдах неполные.`, items: list(r), href: `${base}/menu` }
      : { status: 'ok', detail: 'Аллергены всего сырья утверждённых ТТК внесены по документам — сведения для гостей полные.', href: `${base}/menu/reports` };
  },

  async fryer({ tx, orgId, siteIds, today, base }) {
    const last = (await tx.query(`select max(occurred_at)::date::text as d from journal_entries where organization_id = $1 and site_id = any($2::uuid[]) and form_code in ('J38', 'J41')`, [orgId, siteIds])).rows[0].d;
    return last === today ? { status: 'ok', detail: 'Контроль фритюрных жиров сегодня записан.', href: `${base}/journals/J38` }
      : { status: 'fail', detail: last ? `Последняя запись контроля фритюрных жиров — ${last.split('-').reverse().join('.')}; нужен ежедневный контроль.` : 'Журнал контроля фритюрных жиров не ведётся.', href: `${base}/journals/J38` };
  },

  async disinfectants({ tx, orgId, base }) {
    const r = (await tx.query(`select status, count(*)::int as n from disinfectants where organization_id = $1 group by status`, [orgId])).rows;
    const ok = r.find((x) => x.status === 'approved')?.n || 0, draft = r.filter((x) => x.status !== 'approved' && x.status !== 'archived').reduce((s, x) => s + x.n, 0);
    if (!ok) return { status: 'fail', detail: 'Нет утверждённого дезинфицирующего средства с режимом по инструкции производителя.', href: `${base}/sanitation` };
    return { status: draft ? 'warn' : 'ok', detail: `Утверждённых средств с режимом по инструкции: ${ok}.${draft ? ` Не утверждено: ${draft}.` : ''}`, href: `${base}/sanitation` };
  },

  async concentration({ tx, orgId, siteIds, base }) {
    const n = Number((await tx.query(`select count(*) from sanitation_plans where organization_id = $1 and site_id = any($2::uuid[]) and status = 'active' and check_concentration`, [orgId, siteIds])).rows[0].count);
    return n ? { status: 'ok', detail: `Контроль концентрации рабочих растворов включён в план: ${n}.`, href: `${base}/sanitation` }
      : { status: 'fail', detail: 'Ни в одном плане санитарии нет контроля концентрации рабочего раствора.', href: `${base}/sanitation` };
  },

  async daily_samples({ tx, orgId, siteIds, today, base }) {
    const set = (await tx.query(`select 1 from sample_settings where organization_id = $1`, [orgId])).rowCount;
    const n = Number((await tx.query(`select count(*) from daily_samples where organization_id = $1 and site_id = any($2::uuid[]) and taken_at::date = $3::date`, [orgId, siteIds, today])).rows[0].count);
    if (!set) return { status: 'fail', detail: 'Параметры суточной пробы не утверждены.', href: `${base}/lab` };
    return n ? { status: 'ok', detail: `Сегодня отобрано суточных проб: ${n}.`, href: `${base}/lab` } : { status: 'warn', detail: 'Сегодня суточные пробы ещё не отбирались.', href: `${base}/lab` };
  },

  async ttk_content({ tx, orgId, base }) {
    const r = (await tx.query(`select d.name, v.technology, v.storage_conditions, v.shelf_life, v.organoleptic from dishes d join ttk_versions v on v.dish_id = d.id and v.status = 'approved'
      where d.organization_id = $1 and d.status = 'active'`, [orgId])).rows;
    const bad = r.map((x) => {
      const miss = [!x.technology?.trim() && 'технологический процесс', (!x.storage_conditions?.trim() || !x.shelf_life?.trim()) && 'условия хранения и срок годности',
        (!x.organoleptic?.appearance || !x.organoleptic?.taste) && 'органолептические показатели'].filter(Boolean);
      return miss.length ? { name: `${x.name}: нет — ${miss.join(', ')}` } : null;
    }).filter(Boolean) as { name: string }[];
    if (!r.length) return { status: 'warn', detail: 'Утверждённых ТТК пока нет.', href: `${base}/menu` };
    return bad.length ? { status: 'fail', detail: `В утверждённых ТТК не заполнены обязательные разделы: ${bad.length} из ${r.length}. Дополните новой версией.`, items: list(bad), href: `${base}/menu` }
      : { status: 'ok', detail: `Все ${r.length} утверждённых ТТК содержат обязательные разделы.`, href: `${base}/menu` };
  },

  async ttk_number({ tx, orgId, base }) {
    const r = (await tx.query(`select d.name from dishes d where d.organization_id = $1 and d.status = 'active' and d.card_no is null
      and exists (select 1 from ttk_versions v where v.dish_id = d.id and v.status = 'approved') order by d.name`, [orgId])).rows;
    return r.length ? { status: 'fail', detail: `Утверждённые ТТК без порядкового номера: ${r.length}.`, items: list(r), href: `${base}/menu` }
      : { status: 'ok', detail: 'У каждой утверждённой ТТК есть порядковый номер.', href: `${base}/menu` };
  },

  async versioning() {
    return { status: 'ok', detail: 'Обеспечено системой: утверждённая ТТК не меняется, изменение рецептуры или технологии оформляется новой версией с датой.' };
  },

  async ppk_update() {
    return { status: 'warn', detail: 'Программа производственного контроля по СанПиН 2.3/2.4.4282-26 в системе ещё не сформирована — её соберёт мастер ППК.' };
  },
};

async function contract({ tx, orgId, siteIds, base }: Ctx, kind: string): Promise<CheckResult> {
  const c = (await requiredContractsState(tx, orgId, siteIds)).find((x) => x.kind === kind)!;
  return { status: c.state === 'ok' ? 'ok' : c.state === 'expiring' ? 'warn' : 'fail', detail: `${c.label}: ${c.detail}.`, href: `${base}/contracts` };
}

export async function runCheck(key: string, ctx: Ctx): Promise<CheckResult> {
  const f = CHECKS[key];
  if (!f) throw new Error(`Нет проверки ${key}`);
  return f(ctx);
}
export const CHECK_KEYS = Object.keys(CHECKS);
