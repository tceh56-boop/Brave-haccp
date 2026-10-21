import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText, assertSiteAccess, getSite, openTask, fmtNum } from './common';
import { once, move } from './stock';
import { approvedRecipe, convertUnits } from './recipes';
import { explode, takeFefo, availability } from './bom';
import { raiseIncident } from './incidents';
import { labelForLot } from './labels';

/**
 * Производство полуфабрикатов (этап 10; перенос Production.gs / SemiFinished.gs прежнего ЦЕХ и MON CHEF 3.1–3.3).
 *  - Задание: план → в работе → выпущено (или отменено с причиной). Переходы только явные: списание один раз.
 *  - Выпуск: по утверждённой ТТК (версия фиксируется в задании) на плановый выход раскладываются складские позиции;
 *    готовые п/ф со склада идут первыми, затем сырьё; всё — по FEFO. Выход приходуется партией п/ф: количество —
 *    фактическое, цена — себестоимость / выход, срок — часы хранения из утверждённой ТТК; без них партия получает
 *    «срок не подтверждён» и задачу шефу (система срок не придумывает).
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

/** Полуфабрикаты с утверждённой ТТК — то, что можно ставить в производство. */
export async function producibleDishes(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'production.read', async (tx) => (await tx.query(`
    select d.id, d.name, v.version, v.yield_g, v.shelf_life_hours from dishes d join ttk_versions v on v.dish_id = d.id and v.status = 'approved'
    where d.organization_id = $1 and d.status = 'active' and d.kind = 'semi' order by d.name`, [orgId])).rows);
}

const CreateInput = z.object({ siteId: z.uuid(), dishId: z.uuid(), plannedKg: qtyKg, plannedFor: day, note: optText(500) });

export async function createProduction(userId: string, orgId: string, input: unknown) {
  const d = parse(CreateInput, input);
  return inOrg(userId, orgId, 'production.plan', async (tx) => {
    await getSite(tx, orgId, d.siteId);
    const dish = (await tx.query(`select id, name, kind from dishes where id = $1 and organization_id = $2 and status = 'active'`, [d.dishId, orgId])).rows[0];
    if (!dish) throw Errors.notFound('Полуфабрикат не найден.');
    if (dish.kind !== 'semi') throw Errors.validation('В производство ставятся полуфабрикаты. Блюдо списывается по ТТК при продаже.');
    const r = await approvedRecipe(tx, orgId, dish.id);
    if (!r) throw Errors.conflict(`У «${dish.name}» нет утверждённой ТТК — ставить в производство нельзя.`);
    if (!r.version.yield_g) throw Errors.conflict('В утверждённой ТТК не указан выход.');
    const o = (await tx.query(`insert into production_orders (organization_id, site_id, dish_id, ttk_version_id, planned_g, planned_for, note, created_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`, [orgId, d.siteId, dish.id, r.version.id, d.plannedKg * 1000, d.plannedFor, d.note, userId])).rows[0];
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
    const v = (await tx.query(`select version, yield_g, shelf_life_hours, storage_conditions from ttk_versions where id = $1`, [o.ttk_version_id])).rows[0];
    const checks = await activeChecks(tx, o.dish_id);
    const last = await lastChecks(tx, o.id);
    let need: Awaited<ReturnType<typeof availability>> | null = null, needError: string | null = null;
    if (['planned', 'in_progress'].includes(o.status)) {
      try { need = await availability(tx, orgId, o.site_id, (await explode(tx, orgId, o.dish_id, { grams: Number(o.planned_g) }, { siteId: o.site_id })).needs); }
      catch (e) { needError = (e as Error).message; }
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
      need, need_error: needError, consumed, lot, label,
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

const CompleteInput = z.object({ actualKg: qtyKg, operationId: z.string().trim().min(8).max(100) });

/** Выпуск партии п/ф: списание по ТТК (FEFO), партия с себестоимостью и сроком из ТТК, этикетка. */
export async function completeProduction(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(CompleteInput, input);
  return inOrg(userId, orgId, 'production.run', async (tx, m) => once(tx, orgId, d.operationId, 'production_complete', userId, async () => {
    const o = await orderFor(tx, orgId, id, true);
    assertSiteAccess(m, o.site_id);
    if (o.status !== 'in_progress') throw Errors.conflict(o.status === 'planned' ? 'Сначала «Начать»: выпуск — из задания в работе.' : `Задание уже ${ORDER_STATUS[o.status].toLowerCase()}.`);
    const checks = await activeChecks(tx, o.dish_id), last = await lastChecks(tx, o.id);
    const missing = checks.filter((c) => !last.find((x) => x.check_id === c.id && x.ok));
    if (missing.length) throw Errors.conflict(`Выпуск закрыт: нет замера в пределах — ${missing.map((c) => `${c.name} (${limits(c)})`).join('; ')}.`);
    const v = (await tx.query(`select * from ttk_versions where id = $1`, [o.ttk_version_id])).rows[0];
    if (v.status !== 'approved') throw Errors.conflict('ТТК задания больше не действует (утверждена новая версия). Отмените задание и создайте новое.');

    // складская позиция п/ф (создаётся при первом выпуске)
    let productId: string = o.product_id;
    if (!productId) {
      productId = (await tx.query(`insert into products (organization_id, name, unit, category) values ($1, $2, 'кг', 'Полуфабрикат') returning id`, [orgId, o.dish_name])).rows[0].id;
      await tx.query(`update dishes set product_id = $2 where id = $1`, [o.dish_id, productId]);
    }
    const unit = (await tx.query(`select unit from products where id = $1`, [productId])).rows[0].unit as string;
    const outQty = await convertUnits(tx, productId, d.actualKg, 'кг', unit);
    if (outQty === null) throw Errors.conflict(`Единица п/ф «${unit}» — нет пересчёта из кг.`);

    // списание: готовые п/ф со склада первыми, затем сырьё; всё по FEFO
    const { needs } = await explode(tx, orgId, o.dish_id, { grams: Number(o.planned_g) }, { siteId: o.site_id });
    needs.delete(productId);
    const taken: { lotId: string; qty: number; unit: string }[] = [];
    let cost: number | null = 0;
    for (const n of needs.values()) {
      const c = await takeFefo(tx, orgId, o.site_id, n, { refType: 'production', refId: o.id, reason: `производство: ${o.dish_name}`, operationId: d.operationId, userId }, taken);
      cost = cost === null || c === null ? null : cost + c;
    }

    const now = new Date();
    const hours = v.shelf_life_hours ? Number(v.shelf_life_hours) : null;
    const expiresAt = hours ? new Date(now.getTime() + hours * 3600e3) : null;
    const basis = hours ? `ТТК «${o.dish_name}» v${v.version}: ${fmtNum(hours)} ч${v.storage_conditions ? `, ${v.storage_conditions}` : ''}` : null;
    const lotNo = `ПФ-${now.toISOString().slice(2, 10).replace(/-/g, '')}-${o.id.slice(0, 4).toUpperCase()}`;
    const unitPrice = cost === null || outQty <= 0 ? null : Math.round((cost / outQty) * 100) / 100;
    const lot = (await tx.query(`insert into lots (organization_id, site_id, product_id, lot_no, quantity, unit, manufactured_at, expires_at, expiry_basis, status, status_reason, unit_price)
      values ($1, $2, $3, $4, 0, $5, $6, $7, $8, 'available', 'выпуск п/ф', $9) returning id`,
      [orgId, o.site_id, productId, lotNo, unit, now.toISOString().slice(0, 10), expiresAt, basis, unitPrice])).rows[0];
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
    await tx.query(`update production_orders set status = 'done', completed_by = $2, completed_at = now(), actual_g = $3, output_lot_id = $4, cost = $5 where id = $1`,
      [o.id, userId, d.actualKg * 1000, lot.id, cRound]);
    const label = await labelForLot(tx, orgId, userId, lot.id);
    const yieldDiff = Math.round(((d.actualKg * 1000) / Number(o.planned_g) - 1) * 1000) / 10;
    await audit.record(tx, { organizationId: orgId, siteId: o.site_id, actorUserId: userId, action: 'production.complete', entityType: 'production_order', entityId: o.id,
      after: { lot: lot.id, lot_no: lotNo, actual_g: d.actualKg * 1000, planned_g: Number(o.planned_g), yield_diff_pct: yieldDiff, cost: cRound, consumed: taken.length } });
    return { lot_id: lot.id, lot_no: lotNo, label_id: label.id, quantity: outQty, unit, cost: cRound, unit_price: unitPrice,
      expires_at: expiresAt?.toISOString() || null, expiry_basis: basis, yield_diff_pct: yieldDiff, consumed: taken.length };
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
