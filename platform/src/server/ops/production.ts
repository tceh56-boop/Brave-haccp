import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText, assertSiteAccess, getSite, openTask, fmtNum } from './common';
import { once, move } from './stock';
import { approvedRecipe, convertUnits } from './recipes';
import { explode, availability, USABLE, type Need } from './bom';
import { raiseIncident } from './incidents';
import { labelForLot } from './labels';

/**
 * Производство полуфабрикатов (этап 10; перенос Production.gs / SemiFinished.gs прежнего ЦЕХ и MON CHEF 3.1–3.3).
 *  - Задание: план → в работе → выпущено (или отменено с причиной). Переходы только явные: списание один раз.
 *  - Выпуск (мастер-промт, раздел 2; ТЗ 3.0 §11.4): повар указывает фактически использованные партии и количества.
 *    В движения склада попадает только этот факт. Норма по утверждённой ТТК пересчитывается на фактический выход и
 *    хранится отдельно (consumption_estimates, «расчётное»); отклонение факта от нормы — по каждой позиции.
 *    Подсказка в форме (FEFO на плановый выход) — только предзаполнение; подтверждает человек.
 *    Выход приходуется партией: количество — фактическое, цена — стоимость фактически списанных партий / выход,
 *    срок — часы хранения из утверждённой ТТК; без них партия получает «срок не подтверждён» и задачу шефу.
 *  - Контроль при выпуске (ККТ): параметры с пределами и основанием задаёт ХАССП; выпуск закрыт, пока последний замер
 *    по каждому параметру не в пределах. Замер вне предела — отклонение ответственному; замеры не меняются.
 *  - Прослеживаемость: каждая израсходованная партия связана с партией п/ф (lot_links.kind = 'production').
 */

export const ORDER_STATUS: Record<string, string> = { planned: 'План', in_progress: 'В работе', done: 'Выпущено', cancelled: 'Отменено' };
const qtyKg = z.union([z.number(), z.string().trim().regex(/^\d+([.,]\d+)?$/, 'Введите число.').transform((s) => Number(s.replace(',', '.')))])
  .refine((v) => Number.isFinite(v) && v > 0 && v <= 10000, 'Количество — больше нуля, в килограммах.');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД.');

async function orderFor(tx: Tx, orgId: string, id: string, lock = false) {
  const o = (await tx.query(`select o.*, d.name as dish_name, d.kind as dish_kind, d.product_id from production_orders o join dishes d on d.id = o.dish_id
    where o.id = $1 and o.organization_id = $2 ${lock ? 'for update of o' : ''}`, [id, orgId])).rows[0];
  if (!o) throw Errors.notFound('Задание не найдено.');
  return o;
}

async function activeChecks(tx: Tx, dishId: string) {
  return (await tx.query(`select id, name, unit, min_value, max_value, basis from release_checks where dish_id = $1 and status = 'active' order by created_at`, [dishId])).rows;
}

/** Последний замер по каждому параметру выпуска. */
async function lastChecks(tx: Tx, orderId: string) {
  return (await tx.query(`select distinct on (c.check_id) c.check_id, c.value, c.ok, c.recorded_at, c.incident_id, u.full_name as recorded_by
    from production_checks c join users u on u.id = c.recorded_by where c.order_id = $1 order by c.check_id, c.recorded_at desc`, [orderId])).rows;
}

const limits = (c: { min_value: string | null; max_value: string | null; unit: string }) =>
  [c.min_value !== null ? `не ниже ${fmtNum(c.min_value)}` : '', c.max_value !== null ? `не выше ${fmtNum(c.max_value)}` : ''].filter(Boolean).join(' и ') + ` ${c.unit}`;

/* ───────────── Задания ───────────── */

export async function listProduction(userId: string, orgId: string, siteId: string, date?: string | null) {
  const d = parse(z.object({ siteId: z.uuid({ message: 'Выберите площадку.' }), date: day.optional().nullable() }), { siteId, date });
  return inOrg(userId, orgId, 'production.read', async (tx) => (await tx.query(`
    select o.id, o.status, o.planned_g, o.actual_g, o.planned_for, o.note, o.created_at, o.started_at, o.completed_at, o.output_lot_id, o.cost,
      d.name as dish_name, v.version as ttk_version, cu.full_name as created_by_name, su.full_name as started_by_name
    from production_orders o join dishes d on d.id = o.dish_id join ttk_versions v on v.id = o.ttk_version_id
    join users cu on cu.id = o.created_by left join users su on su.id = o.started_by
    where o.organization_id = $1 and o.site_id = $2
      and (o.planned_for = coalesce($3::date, current_date) or (o.status in ('planned', 'in_progress') and o.planned_for < coalesce($3::date, current_date)))
    order by case o.status when 'in_progress' then 0 when 'planned' then 1 when 'done' then 2 else 3 end, o.planned_for, o.created_at`,
  [orgId, d.siteId, d.date || null])).rows.map((r) => ({ ...r, status_label: ORDER_STATUS[r.status] })), d.siteId);
}

/** Полуфабрикаты и блюда с утверждённой ТТК — то, что можно выпускать партией (блюдо — фасованная готовая продукция). */
export async function producibleDishes(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'production.read', async (tx) => (await tx.query(`
    select d.id, d.name, d.kind, v.version, v.yield_g, v.shelf_life_hours from dishes d join ttk_versions v on v.dish_id = d.id and v.status = 'approved'
    where d.organization_id = $1 and d.status = 'active' and d.kind in ('semi', 'dish') order by d.kind desc, d.name`, [orgId])).rows);
}

const CreateInput = z.object({ siteId: z.uuid(), dishId: z.uuid(), plannedKg: qtyKg, plannedFor: day, note: optText(500), planEventId: z.uuid().optional().nullable() });

export async function createProduction(userId: string, orgId: string, input: unknown) {
  const d = parse(CreateInput, input);
  return inOrg(userId, orgId, 'production.plan', async (tx) => {
    await getSite(tx, orgId, d.siteId);
    const dish = (await tx.query(`select id, name, kind from dishes where id = $1 and organization_id = $2 and status = 'active'`, [d.dishId, orgId])).rows[0];
    if (!dish) throw Errors.notFound('Полуфабрикат или блюдо не найдены.');
    // готовое блюдо — партией (фасованная продукция, выпуск под реализацию); продажа такой партии списывает её, а не сырьё
    const r = await approvedRecipe(tx, orgId, dish.id);
    if (!r) throw Errors.conflict(`У «${dish.name}» нет утверждённой ТТК — ставить в производство нельзя.`);
    if (!r.version.yield_g) throw Errors.conflict('В утверждённой ТТК не указан выход.');
    if (d.planEventId && !(await tx.query(`select 1 from plan_events where id = $1 and organization_id = $2 and site_id = $3 and status in ('planned', 'confirmed')`, [d.planEventId, orgId, d.siteId])).rowCount)
      throw Errors.conflict('Мероприятие не найдено на этой площадке или уже проведено.');
    const o = (await tx.query(`insert into production_orders (organization_id, site_id, dish_id, ttk_version_id, planned_g, planned_for, note, created_by, plan_event_id)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`, [orgId, d.siteId, dish.id, r.version.id, d.plannedKg * 1000, d.plannedFor, d.note, userId, d.planEventId || null])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: 'production.create', entityType: 'production_order', entityId: o.id,
      after: { dish: dish.name, planned_g: o.planned_g, planned_for: d.plannedFor, ttk_version: r.version.version } });
    return o;
  }, d.siteId);
}

/** Карточка задания: ТТК, потребность и остатки (до выпуска), замеры, выпущенная партия и расход (после). */
export async function getProduction(userId: string, orgId: string, id: string) {
  return inOrg(userId, orgId, 'production.read', async (tx, m) => {
    const o = await orderFor(tx, orgId, id);
    assertSiteAccess(m, o.site_id);
    const v = (await tx.query(`select version, yield_g, shelf_life_hours, sale_hours, opened_hours, shelf_basis, storage_conditions from ttk_versions where id = $1`, [o.ttk_version_id])).rows[0];
    const checks = await activeChecks(tx, o.dish_id);
    const last = await lastChecks(tx, o.id);
    let need: Awaited<ReturnType<typeof availability>> | null = null, needError: string | null = null;
    let lots: { product_id: string; lot_id: string; lot_no: string | null; quantity: number; unit: string; expires_at: string; suggest: number }[] = [];
    if (['planned', 'in_progress'].includes(o.status)) {
      try {
        const needs = (await explode(tx, orgId, o.dish_id, { grams: Number(o.planned_g) }, { siteId: o.site_id })).needs;
        need = await availability(tx, orgId, o.site_id, needs);
        // подсказка для формы выпуска: годные партии по FEFO и сколько из каждой взять на плановый выход (факт вводит повар)
        for (const nd of needs.values()) {
          let left = nd.qty;
          for (const l of (await tx.query(`select l.id, l.lot_no, l.quantity::float8 as quantity, l.unit, l.expires_at from lots l where l.organization_id = $1 and l.site_id = $2 and l.product_id = $3 and ${USABLE}
              order by l.expires_at, l.received_at`, [orgId, o.site_id, nd.productId])).rows) {
            const take = Math.max(0, Math.min(l.quantity, left)); left -= take;
            lots.push({ product_id: nd.productId, lot_id: l.id, lot_no: l.lot_no, quantity: l.quantity, unit: l.unit, expires_at: l.expires_at, suggest: Math.round(take * 1000) / 1000 });
          }
        }
      } catch (e) { needError = (e as Error).message; lots = []; }
    }
    const consumed = o.status === 'done' ? (await tx.query(`select m.lot_id, m.quantity, m.unit, p.name as product, l.lot_no from stock_movements m join products p on p.id = m.product_id join lots l on l.id = m.lot_id
      where m.ref_type = 'production' and m.ref_id = $1 and m.kind = 'consume' order by p.name`, [o.id])).rows : [];
    const lot = o.output_lot_id ? (await tx.query(`select id, lot_no, quantity, unit, expires_at, expiry_basis from lots where id = $1`, [o.output_lot_id])).rows[0] : null;
    const label = lot ? (await tx.query(`select id, code from labels where lot_id = $1 order by created_at desc limit 1`, [lot.id])).rows[0] || null : null;
    const users = (await tx.query(`select id, full_name from users where id = any($1::uuid[])`, [[o.created_by, o.started_by, o.completed_by].filter(Boolean)])).rows;
    const name = (uid: string | null) => users.find((u) => u.id === uid)?.full_name || null;
    return {
      order: { ...o, status_label: ORDER_STATUS[o.status], created_by_name: name(o.created_by), started_by_name: name(o.started_by), completed_by_name: name(o.completed_by) },
      ttk: v, checks: checks.map((c) => ({ ...c, limits: limits(c), last: last.find((x) => x.check_id === c.id) || null })),
      need, need_error: needError, lots, consumed, lot, label, deviation: o.consumption_deviation || null,
    };
  });
}

export async function startProduction(userId: string, orgId: string, id: string) {
  return inOrg(userId, orgId, 'production.run', async (tx, m) => {
    const o = await orderFor(tx, orgId, id, true);
    assertSiteAccess(m, o.site_id);
    if (o.status !== 'planned') throw Errors.conflict(`Задание уже ${ORDER_STATUS[o.status].toLowerCase()}.`);
    await tx.query(`update production_orders set status = 'in_progress', started_by = $2, started_at = now() where id = $1`, [id, userId]);
    await audit.record(tx, { organizationId: orgId, siteId: o.site_id, actorUserId: userId, action: 'production.start', entityType: 'production_order', entityId: id });
    return { status: 'in_progress' };
  });
}

const CheckInput = z.object({ checkId: z.uuid(), value: z.coerce.number({ message: 'Введите значение.' }).refine(Number.isFinite, 'Введите значение.') });

/** Замер при выпуске. Вне предела — отклонение; выпуск закрыт до замера в пределах. */
export async function recordCheck(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(CheckInput, input);
  return inOrg(userId, orgId, 'production.run', async (tx, m) => {
    const o = await orderFor(tx, orgId, id);
    assertSiteAccess(m, o.site_id);
    if (o.status !== 'in_progress') throw Errors.conflict('Замеры при выпуске вносятся по заданию «в работе».');
    const c = (await tx.query(`select * from release_checks where id = $1 and dish_id = $2 and status = 'active'`, [d.checkId, o.dish_id])).rows[0];
    if (!c) throw Errors.notFound('Параметр контроля не найден.');
    const ok = (c.min_value === null || d.value >= Number(c.min_value)) && (c.max_value === null || d.value <= Number(c.max_value));
    let incidentId: string | null = null;
    if (!ok) {
      incidentId = (await raiseIncident(tx, { orgId, siteId: o.site_id, severity: 'high', kind: 'release_check', title: `Вне предела при выпуске: ${o.dish_name}`,
        what: `${c.name}: ${fmtNum(d.value)} ${c.unit} при пределе ${limits(c)}. Выпуск закрыт до замера в пределах.`, entityType: 'production_order', entityId: o.id,
        responsibleRole: 'haccp_lead', dueMinutes: 30, ruleSource: c.basis,
        recommendedAction: 'Продолжить обработку до достижения предела и повторить замер. Если предел недостижим — партию не выпускать, решение ответственного.',
        createdBy: userId, notify: ['haccp_lead', 'chef'] })).id;
    }
    const row = (await tx.query(`insert into production_checks (organization_id, order_id, check_id, value, ok, incident_id, recorded_by) values ($1, $2, $3, $4, $5, $6, $7) returning id, recorded_at`,
      [orgId, o.id, c.id, d.value, ok, incidentId, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: o.site_id, actorUserId: userId, action: 'production.check', entityType: 'production_order', entityId: o.id,
      after: { check: c.name, value: d.value, ok } });
    return { id: row.id, ok, incident_id: incidentId, limits: limits(c) };
  });
}

const lotQty = z.union([z.number(), z.string().trim().regex(/^\d+([.,]\d+)?$/, 'Введите число.').transform((s) => Number(s.replace(',', '.')))])
  .refine((v) => Number.isFinite(v) && v > 0, 'Количество — больше нуля.');
const CompleteInput = z.object({ actualKg: qtyKg, operationId: z.string().trim().min(8).max(100),
  consumed: z.array(z.object({ lotId: z.uuid(), quantity: lotQty }), 'Укажите фактически использованные партии.')
    .min(1, 'Укажите фактически использованные партии и количества — расход по норме ТТК фактом не записывается.').max(200),
  // бракераж готовой продукции (J58): органолептика и решение о допуске — обязательны для блюда
  organoleptic: z.string().trim().max(1000).optional().nullable(), decision: z.enum(['allowed', 'rejected']).optional().nullable() });

/** Выпуск партии: фактический расход по партиям, норма ТТК отдельно, партия с себестоимостью и сроком из ТТК, этикетка. */
/** Позиции, которые можно списать на задание: всё из раскладки утверждённой ТТК — сырьё и выпущенные п/ф. */
async function allowedProducts(tx: Tx, orgId: string, o: { dish_id: string; site_id: string; planned_g: string }, own: string | null) {
  const a = await explode(tx, orgId, o.dish_id, { grams: Number(o.planned_g) }, { siteId: o.site_id });
  const b = await explode(tx, orgId, o.dish_id, { grams: Number(o.planned_g) }, {});
  const set = new Set<string>([...a.needs.keys(), ...b.needs.keys()]);
  if (own) set.delete(own);
  return set;
}

/** Факт против нормы по позициям. Позиция п/ф, взятая готовой со склада, сравнивается не с сырьём, а показывается отдельно. */
function deviations(norm: Map<string, Need>, taken: { productId: string; qty: number; name: string; unit: string }[], allowed: Set<string>) {
  const fact = new Map<string, number>();
  for (const t of taken) fact.set(t.productId, (fact.get(t.productId) || 0) + t.qty);
  const out: { product_id: string; name: string; unit: string; norm: number | null; fact: number; diff: number | null; diff_pct: number | null }[] = [];
  const r = (x: number) => Math.round(x * 1000) / 1000;
  for (const n of norm.values()) {
    const f = fact.get(n.productId) || 0;
    out.push({ product_id: n.productId, name: n.name, unit: n.unit, norm: r(n.qty), fact: r(f), diff: r(f - n.qty), diff_pct: n.qty > 0 ? Math.round(((f - n.qty) / n.qty) * 1000) / 10 : null });
  }
  for (const [pid, f] of fact) if (!norm.has(pid) && allowed.has(pid)) { const t = taken.find((x) => x.productId === pid)!; out.push({ product_id: pid, name: `${t.name} (готовый п/ф со склада)`, unit: t.unit, norm: null, fact: r(f), diff: null, diff_pct: null }); }
  return out;
}

export async function completeProduction(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(CompleteInput, input);
  return inOrg(userId, orgId, 'production.run', async (tx, m) => once(tx, orgId, d.operationId, 'production_complete', userId, async () => {
    const o = await orderFor(tx, orgId, id, true);
    assertSiteAccess(m, o.site_id);
    if (o.status !== 'in_progress') throw Errors.conflict(o.status === 'planned' ? 'Сначала «Начать»: выпуск — из задания в работе.' : `Задание уже ${ORDER_STATUS[o.status].toLowerCase()}.`);
    if (o.dish_kind === 'dish' && (!d.organoleptic || d.organoleptic.length < 5 || !d.decision))
      throw Errors.validation('Выпуск готовой продукции — с бракеражем: опишите органолептику (внешний вид, цвет, консистенция, вкус и запах) и решение о допуске к реализации.');
    const checks = await activeChecks(tx, o.dish_id), last = await lastChecks(tx, o.id);
    const missing = checks.filter((c) => !last.find((x) => x.check_id === c.id && x.ok));
    if (missing.length) throw Errors.conflict(`Выпуск закрыт: нет замера в пределах — ${missing.map((c) => `${c.name} (${limits(c)})`).join('; ')}.`);
    const v = (await tx.query(`select * from ttk_versions where id = $1`, [o.ttk_version_id])).rows[0];
    if (v.status !== 'approved') throw Errors.conflict('ТТК задания больше не действует (утверждена новая версия). Отмените задание и создайте новое.');

    // складская позиция п/ф (создаётся при первом выпуске)
    let productId: string = o.product_id;
    if (!productId) {
      productId = (await tx.query(`insert into products (organization_id, name, unit, category) values ($1, $2, 'кг', $3) returning id`, [orgId, o.dish_name, o.dish_kind === 'dish' ? 'Готовая продукция' : 'Полуфабрикат'])).rows[0].id;
      await tx.query(`update dishes set product_id = $2 where id = $1`, [o.dish_id, productId]);
      // срок после вскрытия из утверждённой ТТК — правило новой складской позиции
      if (v.opened_hours) await tx.query(`update products set opened_shelf_hours = $2, opened_shelf_basis = $3 where id = $1`, [productId, v.opened_hours, `ТТК «${o.dish_name}» v${v.version}: ${v.shelf_basis}`]);
    }
    const unit = (await tx.query(`select unit from products where id = $1`, [productId])).rows[0].unit as string;
    const outQty = await convertUnits(tx, productId, d.actualKg, 'кг', unit);
    if (outQty === null) throw Errors.conflict(`Единица п/ф «${unit}» — нет пересчёта из кг.`);

    // фактический расход: только указанные партии этой площадки, годные, из позиций утверждённой ТТК (с п/ф)
    const allowed = await allowedProducts(tx, orgId, o, productId);
    const taken: { lotId: string; qty: number; unit: string; productId: string; name: string }[] = [];
    const seen = new Set<string>();
    let cost: number | null = 0;
    for (const c of d.consumed) {
      if (seen.has(c.lotId)) throw Errors.validation('Партия указана дважды — объедините количество в одной строке.');
      seen.add(c.lotId);
      const l = (await tx.query(`select l.*, p.name as product from lots l join products p on p.id = l.product_id where l.id = $1 and l.organization_id = $2 for update of l`, [c.lotId, orgId])).rows[0];
      if (!l) throw Errors.notFound('Партия не найдена.');
      const label = `${l.product}${l.lot_no ? `, партия ${l.lot_no}` : ''}`;
      if (l.site_id !== o.site_id) throw Errors.conflict(`${label}: партия другой площадки.`);
      if (!allowed.has(l.product_id)) throw Errors.conflict(`${label}: позиции нет в утверждённой ТТК «${o.dish_name}» — замена сырья оформляется новой версией ТТК.`);
      const usable = (await tx.query(`select 1 from lots l where l.id = $1 and ${USABLE}`, [l.id])).rowCount;
      if (!usable) throw Errors.conflict(`${label}: партию использовать нельзя (статус, срок или срок не подтверждён).`);
      if (c.quantity > Number(l.quantity) + 1e-9) throw Errors.conflict(`${label}: в партии ${fmtNum(l.quantity)} ${l.unit}, указано ${fmtNum(c.quantity)}.`);
      await move(tx, { orgId, siteId: o.site_id, lotId: l.id, productId: l.product_id, kind: 'consume', quantity: -c.quantity, unit: l.unit,
        reason: `производство: ${o.dish_name} (факт)`, refType: 'production', refId: o.id, operationId: d.operationId, userId });
      cost = cost === null || l.unit_price === null ? null : cost + c.quantity * Number(l.unit_price);
      taken.push({ lotId: l.id, qty: c.quantity, unit: l.unit, productId: l.product_id, name: l.product });
    }
    // норма по ТТК на фактический выход — расчёт, отдельно от факта
    const norm = (await explode(tx, orgId, o.dish_id, { grams: d.actualKg * 1000 }, {})).needs;
    norm.delete(productId);
    // каждая позиция ТТК должна быть в факте — или покрыта готовым п/ф со склада, в который она входит
    const factIds = new Set(taken.map((t) => t.productId));
    const covered = new Set<string>();
    for (const sd of (await tx.query(`select id from dishes where organization_id = $1 and product_id = any($2::uuid[])`, [orgId, [...factIds]])).rows) {
      for (const k of (await explode(tx, orgId, sd.id, { grams: 1000 }, {})).needs.keys()) covered.add(k);
    }
    const absent = [...norm.values()].filter((n) => n.qty > 0 && !factIds.has(n.productId) && !covered.has(n.productId));
    if (absent.length) throw Errors.conflict(`Не указан фактический расход: ${absent.map((n) => `${n.name} (по ТТК ${fmtNum(Math.round(n.qty * 1000) / 1000)} ${n.unit})`).join(', ')}. `
      + 'Без позиции ТТК продукция не соответствует утверждённой карте — выпуск не оформляется; при замене сырья нужна новая версия ТТК.');
    const deviation = deviations(norm, taken, allowed);
    for (const n of norm.values()) {
      await tx.query(`insert into consumption_estimates (organization_id, site_id, kind, ref_type, ref_id, product_id, quantity, unit, ttk_version_id, basis, created_by)
        values ($1, $2, 'production_norm', 'production', $3, $4, $5, $6, $7, $8, $9)`,
      [orgId, o.site_id, o.id, n.productId, Math.round(n.qty * 1e6) / 1e6, n.unit, v.id, `ТТК «${o.dish_name}» v${v.version} на ${fmtNum(d.actualKg)} кг выхода`, userId]);
    }

    const now = new Date();
    // ТЗ 5.2: партия п/ф — срок партии п/ф; готовая продукция — срок реализации (иначе срок партии); основание сроков — из ТТК
    const kindOf = o.dish_kind === 'dish' && v.sale_hours ? 'срок реализации' : 'срок партии';
    const hoursRaw = o.dish_kind === 'dish' ? (v.sale_hours ?? v.shelf_life_hours) : v.shelf_life_hours;
    const hours = hoursRaw ? Number(hoursRaw) : null;
    const expiresAt = hours ? new Date(now.getTime() + hours * 3600e3) : null;
    const basis = hours ? `ТТК «${o.dish_name}» v${v.version}: ${kindOf} ${fmtNum(hours)} ч${v.storage_conditions ? `, ${v.storage_conditions}` : ''}${v.shelf_basis ? ` (${v.shelf_basis})` : ''}` : null;
    const lotNo = `${o.dish_kind === 'dish' ? 'ГП' : 'ПФ'}-${now.toISOString().slice(2, 10).replace(/-/g, '')}-${o.id.slice(0, 4).toUpperCase()}`;
    const rejected = d.decision === 'rejected';
    const unitPrice = cost === null || outQty <= 0 ? null : Math.round((cost / outQty) * 100) / 100;
    const lot = (await tx.query(`insert into lots (organization_id, site_id, product_id, lot_no, quantity, unit, manufactured_at, expires_at, expiry_basis, status, status_reason, unit_price, storage_conditions)
      values ($1, $2, $3, $4, 0, $5, $6, $7, $8, $10, $11, $9, $12) returning id`,
      [orgId, o.site_id, productId, lotNo, unit, now.toISOString().slice(0, 10), expiresAt, basis, unitPrice, rejected ? 'quarantine' : 'available',
        rejected ? `бракераж: не допущено к реализации — ${d.organoleptic}` : o.dish_kind === 'dish' ? 'выпуск готовой продукции' : 'выпуск п/ф', v.storage_conditions || null])).rows[0];
    await move(tx, { orgId, siteId: o.site_id, lotId: lot.id, productId, kind: 'produce', quantity: outQty, unit, refType: 'production', refId: o.id, operationId: d.operationId, userId, reason: `выпуск: ${o.dish_name}` });
    for (const t of taken) {
      await tx.query(`insert into lot_links (organization_id, parent_lot_id, child_lot_id, kind, quantity, unit) values ($1, $2, $3, 'production', $4, $5)`, [orgId, t.lotId, lot.id, t.qty, t.unit]);
    }
    if (!expiresAt) {
      await openTask(tx, { orgId, siteId: o.site_id, kind: 'confirm_expiry', title: `Срок не подтверждён: ${o.dish_name}`,
        details: `Партия ${lotNo}: в утверждённой ТТК не указан срок хранения в часах. Укажите срок и основание — до этого партию использовать нельзя.`,
        entityType: 'lot', entityId: lot.id, assigneeRole: 'chef', dueAt: new Date(now.getTime() + 2 * 3600e3), createdBy: userId });
    }
    const cRound = cost === null ? null : Math.round(cost * 100) / 100;
    await tx.query(`update production_orders set status = 'done', completed_by = $2, completed_at = now(), actual_g = $3, output_lot_id = $4, cost = $5,
      organoleptic = $6, release_decision = $7, assessed_by = $8, consumption_deviation = $9 where id = $1`,
      [o.id, userId, d.actualKg * 1000, lot.id, cRound, d.organoleptic || null, d.decision || null, d.decision ? userId : null, JSON.stringify(deviation)]);
    const label = await labelForLot(tx, orgId, userId, lot.id);
    const yieldDiff = Math.round(((d.actualKg * 1000) / Number(o.planned_g) - 1) * 1000) / 10;
    await audit.record(tx, { organizationId: orgId, siteId: o.site_id, actorUserId: userId, action: 'production.complete', entityType: 'production_order', entityId: o.id,
      after: { lot: lot.id, lot_no: lotNo, actual_g: d.actualKg * 1000, planned_g: Number(o.planned_g), yield_diff_pct: yieldDiff, cost: cRound, consumed: taken.map((t) => ({ lot: t.lotId, qty: t.qty, unit: t.unit })), deviation } });
    return { lot_id: lot.id, lot_no: lotNo, label_id: label.id, quantity: outQty, unit, cost: cRound, unit_price: unitPrice,
      expires_at: expiresAt?.toISOString() || null, expiry_basis: basis, yield_diff_pct: yieldDiff, consumed: taken.length, deviation };
  }));
}

export async function cancelProduction(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(z.object({ reason: z.string().trim().min(3, 'Укажите причину отмены.').max(300) }), input);
  return inOrg(userId, orgId, 'production.plan', async (tx, m) => {
    const o = await orderFor(tx, orgId, id, true);
    assertSiteAccess(m, o.site_id);
    if (!['planned', 'in_progress'].includes(o.status)) throw Errors.conflict(`Задание уже ${ORDER_STATUS[o.status].toLowerCase()} — отменить нельзя.`);
    await tx.query(`update production_orders set status = 'cancelled', cancel_reason = $2 where id = $1`, [id, d.reason]);
    await audit.record(tx, { organizationId: orgId, siteId: o.site_id, actorUserId: userId, action: 'production.cancel', entityType: 'production_order', entityId: id, reason: d.reason });
    return { status: 'cancelled' };
  });
}

/* ───────────── Контроль при выпуске (ККТ) ───────────── */

export async function listReleaseChecks(userId: string, orgId: string, dishId: string) {
  return inOrg(userId, orgId, 'menu.read', async (tx) => (await activeChecks(tx, dishId)).map((c) => ({ ...c, limits: limits(c) })));
}

const num = z.union([z.number(), z.string().trim().regex(/^-?\d+([.,]\d+)?$/, 'Введите число.').transform((s) => Number(s.replace(',', '.')))]);
const ReleaseCheckInput = z.object({
  name: z.string().trim().min(3, 'Что измеряется, например «Температура в толще продукта».').max(200),
  unit: z.string().trim().min(1).max(20).default('°C'),
  min: num.nullable().optional(), max: num.nullable().optional(),
  basis: z.string().trim().min(5, 'Укажите основание: пункт плана ХАССП или норматива.').max(500),
  hazardId: z.uuid().nullable().optional(),
}).refine((x) => x.min != null || x.max != null, 'Задайте нижний или верхний предел.')
  .refine((x) => x.min == null || x.max == null || x.min <= x.max, 'Нижний предел больше верхнего.');

export async function addReleaseCheck(userId: string, orgId: string, dishId: string, input: unknown) {
  const d = parse(ReleaseCheckInput, input);
  return inOrg(userId, orgId, 'haccp.manage', async (tx) => {
    const dish = (await tx.query(`select id, name, kind from dishes where id = $1 and organization_id = $2`, [dishId, orgId])).rows[0];
    if (!dish) throw Errors.notFound('Полуфабрикат не найден.');
    if (dish.kind !== 'semi') throw Errors.validation('Контроль при выпуске задаётся для полуфабрикатов.');
    const c = (await tx.query(`insert into release_checks (organization_id, dish_id, name, unit, min_value, max_value, basis, hazard_id, created_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`, [orgId, dishId, d.name, d.unit, d.min ?? null, d.max ?? null, d.basis, d.hazardId || null, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'release_check.add', entityType: 'dish', entityId: dishId, after: { name: d.name, min: d.min, max: d.max, basis: d.basis } });
    return c;
  });
}

export async function archiveReleaseCheck(userId: string, orgId: string, checkId: string, input: unknown) {
  const d = parse(z.object({ reason: z.string().trim().min(5, 'Укажите основание: например, изменение плана ХАССП.').max(300) }), input);
  return inOrg(userId, orgId, 'haccp.manage', async (tx) => {
    const c = (await tx.query(`update release_checks set status = 'archived' where id = $1 and organization_id = $2 and status = 'active' returning dish_id, name`, [checkId, orgId])).rows[0];
    if (!c) throw Errors.notFound('Параметр не найден.');
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'release_check.archive', entityType: 'dish', entityId: c.dish_id, after: { name: c.name }, reason: d.reason });
    return { ok: true };
  });
}
