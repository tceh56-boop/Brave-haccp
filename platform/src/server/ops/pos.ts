import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { roleHas } from '../access/roles';
import { inOrg, parse, optText, getSite, openTask, closeTasksFor, fmtNum } from './common';
import { once, move } from './stock';
import { normName } from './recipes';
import { explode, takeFefo, USABLE, type Need } from './bom';

/**
 * Касса и продажи (этап 6 ТЗ v2; механика Pos.gs прежнего ЦЕХ):
 *  смена с наличными на начало → заказы (сумма считается на сервере по цене блюда) → оплата (наличные со сдачей,
 *  карта, прочее; повтор с тем же ключом операции не создаёт вторую оплату — AT-12) → продажа → списание сырья по
 *  утверждённой ТТК через FEFO. Если списать нельзя (нет ТТК, не хватает годного остатка) — оплата не срывается:
 *  продажа уходит в очередь, шефу ставится задача, списание повторяется после исправления.
 *  Возврат — отрицательная оплата и продажа; закрытие смены — со сверкой наличных.
 *  Продажи внешней кассы (iiko, r_keeper) импортируются с уникальным ID; неизвестные названия — в очередь сопоставления.
 *  Фискальный чек пробивает ККТ предприятия (ТЗ v2 §10): система её не заменяет.
 */

export const METHOD_LABEL: Record<string, string> = { cash: 'Наличные', card: 'Карта', other: 'Прочее' };
export const ORDER_STATUS: Record<string, string> = { open: 'Открыт', paid: 'Оплачен', cancelled: 'Отменён', refunded: 'Возврат' };
export const FULFIL_LABEL: Record<string, string> = {
  pending: 'Ожидает списания', done: 'Списано по ТТК', failed: 'Не списано', no_ttk: 'Нет утверждённой ТТК', unmatched: 'Не сопоставлено с блюдом', not_required: 'Не требуется',
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const LOW_PORTIONS = 5;
const money = z.coerce.number().min(0).max(10_000_000);
const opId = z.string().trim().min(8, 'Нужен ключ операции.').max(100);

/* Развёртка ТТК и FEFO — в bom.ts (общие с производством); готовые п/ф со склада идут в расход первыми. */

/** Списание одной продажи по ТТК. Ошибка не роняет транзакцию оплаты: продажа уходит в очередь. */
export async function fulfilSale(tx: Tx, orgId: string, saleId: string, userId: string | null): Promise<string> {
  const s = (await tx.query(`select s.*, d.name as dish_name from sales s left join dishes d on d.id = s.dish_id where s.id = $1 for update of s`, [saleId])).rows[0];
  if (!s || s.fulfil_status === 'done' || s.fulfil_status === 'not_required') return s?.fulfil_status;
  if (!s.dish_id) { await tx.query(`update sales set fulfil_status = 'unmatched' where id = $1`, [saleId]); return 'unmatched'; }
  await tx.query('savepoint fulfil');
  try {
    const { needs, versionId } = await explode(tx, orgId, s.dish_id, { portions: Number(s.qty) }, { siteId: s.site_id });
    let cost: number | null = 0;
    for (const n of needs.values()) {
      const c = await takeFefo(tx, orgId, s.site_id, n, { refType: 'sale', refId: s.id, reason: `продажа: ${s.name} × ${fmtNum(s.qty)}`, operationId: `sale:${s.id}`, userId });
      cost = cost === null || c === null ? null : cost + c;
    }
    await tx.query(`update sales set fulfil_status = 'done', fulfil_error = null, ttk_version_id = $2, cost = $3, fulfilled_at = now() where id = $1`, [saleId, versionId, cost === null ? null : r2(cost)]);
    await tx.query('release savepoint fulfil');
    return 'done';
  } catch (e) {
    await tx.query('rollback to savepoint fulfil');
    const noTtk = !!(e as { noTtk?: boolean }).noTtk;
    const msg = (e as Error).message;
    await tx.query(`update sales set fulfil_status = $2, fulfil_error = $3 where id = $1`, [saleId, noTtk ? 'no_ttk' : 'failed', msg]);
    await openTask(tx, { orgId, siteId: s.site_id, kind: 'sale_fulfil', title: `Продажи не списаны: ${s.dish_name}`, details: `${msg} Исправьте ТТК или остатки — затем «Повторить списание» в очереди продаж.`,
      entityType: 'dish', entityId: s.dish_id, assigneeRole: 'chef', createdBy: userId });
    return noTtk ? 'no_ttk' : 'failed';
  }
}

/** Повтор очереди: продажи без ТТК или с нехваткой — после утверждения ТТК, приёмки или исправления. */
export async function retryQueue(userId: string, orgId: string, input: unknown) {
  const d = parse(z.object({ siteId: z.uuid().optional().nullable() }), input ?? {});
  return inOrg(userId, orgId, 'sales.manage', async (tx) => {
    const rows = (await tx.query(`select id, dish_id from sales where organization_id = $1 and ($2::uuid is null or site_id = $2) and fulfil_status in ('pending', 'failed', 'no_ttk')
      order by sold_at limit 500`, [orgId, d.siteId || null])).rows;
    const res: Record<string, number> = { done: 0, failed: 0, no_ttk: 0 };
    for (const r of rows) { const st = await fulfilSale(tx, orgId, r.id, userId); res[st] = (res[st] || 0) + 1; }
    // Задача по блюду закрывается, когда по нему не осталось несписанных продаж.
    for (const dishId of new Set(rows.map((r) => r.dish_id).filter(Boolean))) {
      if (!(await tx.query(`select 1 from sales where organization_id = $1 and dish_id = $2 and fulfil_status in ('failed', 'no_ttk')`, [orgId, dishId])).rowCount) {
        await closeTasksFor(tx, orgId, 'sale_fulfil', dishId, userId, 'продажи списаны по ТТК');
      }
    }
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: 'sales.retry', entityType: 'sales', after: { processed: rows.length, ...res } });
    return { processed: rows.length, ...res };
  });
}

/* ───────────── Стоп-лист ───────────── */

/** Порций из годного остатка площадки по утверждённой ТТК; null — посчитать нельзя (нет ТТК) — авто-стоп не ставится. */
async function portionsLeft(tx: Tx, orgId: string, siteId: string, dishId: string) {
  let needs: Map<string, Need>;
  try { needs = (await explode(tx, orgId, dishId, { portions: 1 }, { siteId })).needs; } catch { return null; }
  let portions = Infinity; let short: { name: string; have: number; need: number; unit: string } | null = null;
  for (const n of needs.values()) {
    if (n.qty <= 0) continue;
    const have = Number((await tx.query(`select coalesce(sum(l.quantity), 0) as q from lots l where l.organization_id = $1 and l.site_id = $2 and l.product_id = $3 and ${USABLE}`, [orgId, siteId, n.productId])).rows[0].q);
    const p = Math.floor((have + 1e-9) / n.qty);
    if (p < portions) { portions = p; short = { name: n.name, have, need: n.qty, unit: n.unit }; }
  }
  return portions === Infinity ? null : { portions, short };
}

async function recalcStops(tx: Tx, orgId: string, siteId: string) {
  const dishes = (await tx.query(`select id, name from dishes where organization_id = $1 and status = 'active' and kind = 'dish' and sale_price > 0`, [orgId])).rows;
  const low: Record<string, number> = {};
  for (const d of dishes) {
    const calc = await portionsLeft(tx, orgId, siteId, d.id);
    const auto = (await tx.query(`select id from stop_list where site_id = $1 and dish_id = $2 and source = 'auto' and lifted_at is null`, [siteId, d.id])).rows[0];
    if (!calc) continue;
    if (calc.portions < 1) {
      if (!auto) {
        const s = calc.short!;
        await tx.query(`insert into stop_list (organization_id, site_id, dish_id, reason, source) values ($1, $2, $3, $4, 'auto')`,
          [orgId, siteId, d.id, `Не хватает: ${s.name} (есть ${fmtNum(Math.round(s.have * 1000) / 1000)} ${s.unit}, на порцию ${fmtNum(Math.round(s.need * 1000) / 1000)} ${s.unit})`]);
      }
    } else {
      if (auto) await tx.query(`update stop_list set lifted_at = now() where id = $1`, [auto.id]);
      if (calc.portions < LOW_PORTIONS) low[d.id] = calc.portions;
    }
  }
  return low;
}

async function activeStop(tx: Tx, siteId: string, dishId: string) {
  return (await tx.query(`select * from stop_list where site_id = $1 and dish_id = $2 and lifted_at is null order by (source = 'manual') desc limit 1`, [siteId, dishId])).rows[0] || null;
}

export async function getStopList(userId: string, orgId: string, siteId: string) {
  return inOrg(userId, orgId, 'menu.read', async (tx) => {
    await recalcStops(tx, orgId, siteId);
    return (await tx.query(`select s.id, s.dish_id, d.name as dish, s.reason, s.source, s.created_at, u.full_name as who from stop_list s join dishes d on d.id = s.dish_id
      left join users u on u.id = s.created_by where s.site_id = $1 and s.lifted_at is null order by s.created_at desc`, [siteId])).rows;
  }, siteId);
}

export async function setStop(userId: string, orgId: string, input: unknown) {
  const d = parse(z.object({ siteId: z.uuid(), dishId: z.uuid(), reason: z.string().trim().min(3, 'Укажите причину стопа.').max(200) }), input);
  return inOrg(userId, orgId, 'pos.stop', async (tx) => {
    await getSite(tx, orgId, d.siteId);
    if (!(await tx.query(`select 1 from dishes where id = $1 and organization_id = $2`, [d.dishId, orgId])).rowCount) throw Errors.notFound('Блюдо не найдено.');
    if ((await tx.query(`select 1 from stop_list where site_id = $1 and dish_id = $2 and source = 'manual' and lifted_at is null`, [d.siteId, d.dishId])).rowCount) throw Errors.conflict('Блюдо уже в стоп-листе.');
    const s = (await tx.query(`insert into stop_list (organization_id, site_id, dish_id, reason, source, created_by) values ($1, $2, $3, $4, 'manual', $5) returning *`, [orgId, d.siteId, d.dishId, d.reason, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: 'pos.stop', entityType: 'dish', entityId: d.dishId, after: { reason: d.reason } });
    return s;
  }, d.siteId);
}

/** Снять стоп. Авто-стоп при нехватке сырья вернётся при следующем пересчёте — это честно. */
export async function liftStop(userId: string, orgId: string, stopId: string) {
  return inOrg(userId, orgId, 'pos.stop', async (tx, m) => {
    const s = (await tx.query(`select * from stop_list where id = $1 and organization_id = $2`, [stopId, orgId])).rows[0];
    if (!s) throw Errors.notFound('Стоп не найден.');
    if (m.site_ids.length && !m.site_ids.includes(s.site_id)) throw Errors.forbidden('Нет доступа к этой площадке.');
    if (s.lifted_at) throw Errors.conflict('Стоп уже снят.');
    await tx.query(`update stop_list set lifted_at = now(), lifted_by = $2 where id = $1`, [stopId, userId]);
    await audit.record(tx, { organizationId: orgId, siteId: s.site_id, actorUserId: userId, action: 'pos.stop_lift', entityType: 'dish', entityId: s.dish_id, before: { reason: s.reason, source: s.source } });
    return { ok: true };
  });
}

/* ───────────── Смена ───────────── */

async function openShiftOf(tx: Tx, siteId: string) {
  return (await tx.query(`select * from pos_shifts where site_id = $1 and status = 'open'`, [siteId])).rows[0] || null;
}

async function shiftTotals(tx: Tx, shift: Record<string, any>) {
  const pays = (await tx.query(`select method, amount from pos_payments where shift_id = $1`, [shift.id])).rows;
  const t = { cash: 0, card: 0, other: 0 }; let gross = 0, refunds = 0;
  for (const p of pays) { const a = Number(p.amount); t[p.method as keyof typeof t] = r2(t[p.method as keyof typeof t] + a); if (a < 0) refunds = r2(refunds - a); else gross = r2(gross + a); }
  const orders = (await tx.query(`select status, count(*)::int as n from pos_orders where shift_id = $1 group by status`, [shift.id])).rows;
  const cnt = (s: string) => orders.find((o) => o.status === s)?.n || 0;
  const sold = cnt('paid') + cnt('refunded');
  return { cash: t.cash, card: t.card, other: t.other, revenue: r2(t.cash + t.card + t.other), gross, refunds, orders: sold, open_orders: cnt('open'),
    avg_check: sold ? r2(gross / sold) : 0, cash_expected: r2(Number(shift.cash_start) + t.cash) };
}

export async function getShift(userId: string, orgId: string, siteId: string) {
  return inOrg(userId, orgId, 'pos.sell', async (tx) => {
    const shift = await openShiftOf(tx, siteId);
    return { shift, totals: shift ? await shiftTotals(tx, shift) : null };
  }, siteId);
}

export async function openShift(userId: string, orgId: string, input: unknown) {
  const d = parse(z.object({ siteId: z.uuid(), cashStart: money }), input);
  return inOrg(userId, orgId, 'pos.sell', async (tx) => {
    await getSite(tx, orgId, d.siteId);
    if (await openShiftOf(tx, d.siteId)) throw Errors.conflict('Смена на этой площадке уже открыта.');
    const s = (await tx.query(`insert into pos_shifts (organization_id, site_id, opened_by, cash_start) values ($1, $2, $3, $4) returning *`, [orgId, d.siteId, userId, r2(d.cashStart)])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: 'pos.shift_open', entityType: 'pos_shift', entityId: s.id, after: { cash_start: s.cash_start } });
    return s;
  }, d.siteId);
}

/** Закрытие: без неоплаченных заказов, с фактом наличных; расхождение фиксируется, а не подгоняется. */
export async function closeShift(userId: string, orgId: string, input: unknown) {
  const d = parse(z.object({ siteId: z.uuid(), cashFact: money, note: optText(500) }), input);
  return inOrg(userId, orgId, 'pos.sell', async (tx) => {
    const shift = (await tx.query(`select * from pos_shifts where site_id = $1 and status = 'open' for update`, [d.siteId])).rows[0];
    if (!shift) throw Errors.conflict('Открытой смены нет.');
    const t = await shiftTotals(tx, shift);
    if (t.open_orders) throw Errors.conflict(`Есть неоплаченные заказы (${t.open_orders}). Оплатите или отмените их перед закрытием смены.`);
    const diff = r2(d.cashFact - t.cash_expected);
    const totals = { ...t, cash_diff: diff, note: d.note };
    await tx.query(`update pos_shifts set status = 'closed', closed_by = $2, closed_at = now(), cash_fact = $3, totals = $4 where id = $1`, [shift.id, userId, r2(d.cashFact), JSON.stringify(totals)]);
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: 'pos.shift_close', entityType: 'pos_shift', entityId: shift.id, after: totals });
    return { totals, cash_diff: diff };
  }, d.siteId);
}

/* ───────────── Меню и заказы ───────────── */

export async function getMenu(userId: string, orgId: string, siteId: string) {
  return inOrg(userId, orgId, 'pos.sell', async (tx) => {
    const low = await recalcStops(tx, orgId, siteId);
    const dishes = (await tx.query(`select d.id, d.name, d.category, d.sale_price,
        (select json_build_object('reason', s.reason, 'source', s.source) from stop_list s where s.site_id = $2 and s.dish_id = d.id and s.lifted_at is null order by (s.source = 'manual') desc limit 1) as stop,
        exists (select 1 from ttk_versions v where v.dish_id = d.id and v.status = 'approved') as has_ttk
      from dishes d where d.organization_id = $1 and d.status = 'active' and d.kind = 'dish' and d.sale_price > 0 order by d.category nulls last, d.name`, [orgId, siteId])).rows;
    return dishes.map((d) => ({ ...d, low: low[d.id] ?? null }));
  }, siteId);
}

async function loadOrder(tx: Tx, orgId: string, orderId: string, lock = false) {
  const o = (await tx.query(`select * from pos_orders where id = $1 and organization_id = $2 ${lock ? 'for update' : ''}`, [orderId, orgId])).rows[0];
  if (!o) throw Errors.notFound('Заказ не найден.');
  return o;
}
function assertVersion(o: { version: number }, v?: number | null) {
  if (v !== undefined && v !== null && Number(v) !== Number(o.version)) throw Errors.conflict('Заказ изменён на другом устройстве. Обновите экран.');
}
async function retotal(tx: Tx, orderId: string) {
  const o = (await tx.query(`update pos_orders set total = coalesce((select sum(amount) from pos_order_lines where order_id = $1 and status = 'new'), 0), version = version + 1 where id = $1 returning *`, [orderId])).rows[0];
  return o;
}

async function orderView(tx: Tx, orgId: string, orderId: string) {
  const o = await loadOrder(tx, orgId, orderId);
  const lines = (await tx.query(`select id, dish_id, name, qty, price, amount, status from pos_order_lines where order_id = $1 and status <> 'removed' order by created_at`, [orderId])).rows;
  const payments = (await tx.query(`select method, amount, kind, reason, created_at from pos_payments where order_id = $1 order by created_at`, [orderId])).rows;
  return { order: { ...o, status_label: ORDER_STATUS[o.status] }, lines, payments };
}

export async function createOrder(userId: string, orgId: string, input: unknown) {
  const d = parse(z.object({ siteId: z.uuid(), tableLabel: optText(40), guests: z.coerce.number().int().min(0).max(500).optional().nullable(), comment: optText(300) }), input);
  return inOrg(userId, orgId, 'pos.sell', async (tx) => {
    const shift = await openShiftOf(tx, d.siteId);
    if (!shift) throw Errors.conflict('Смена не открыта — откройте смену кассы.');
    if (d.tableLabel && (await tx.query(`select 1 from pos_orders where shift_id = $1 and table_label = $2 and status = 'open'`, [shift.id, d.tableLabel])).rowCount) {
      throw Errors.conflict(`На столе «${d.tableLabel}» уже есть открытый заказ.`);
    }
    const num = Number((await tx.query(`select coalesce(max(number), 0) + 1 as n from pos_orders where shift_id = $1`, [shift.id])).rows[0].n);
    const o = (await tx.query(`insert into pos_orders (organization_id, site_id, shift_id, number, table_label, guests, comment, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [orgId, d.siteId, shift.id, num, d.tableLabel, d.guests ?? null, d.comment, userId])).rows[0];
    return orderView(tx, orgId, o.id);
  }, d.siteId);
}

export async function listOrders(userId: string, orgId: string, siteId: string) {
  return inOrg(userId, orgId, 'pos.sell', async (tx) => {
    const shift = await openShiftOf(tx, siteId);
    if (!shift) return [];
    return (await tx.query(`select o.id, o.number, o.table_label, o.status, o.total, o.refunded, o.created_at, o.paid_at, u.full_name as created_by_name
      from pos_orders o join users u on u.id = o.created_by where o.shift_id = $1 order by (o.status = 'open') desc, o.number desc`, [shift.id])).rows.map((o) => ({ ...o, status_label: ORDER_STATUS[o.status] }));
  }, siteId);
}

export async function getOrder(userId: string, orgId: string, orderId: string) {
  return inOrg(userId, orgId, 'pos.sell', async (tx, m) => {
    const o = await loadOrder(tx, orgId, orderId);
    if (m.site_ids.length && !m.site_ids.includes(o.site_id)) throw Errors.forbidden('Нет доступа к этой площадке.');
    return orderView(tx, orgId, orderId);
  });
}

/** Позиция: цена — из карточки блюда на сервере; стоп-лист проверяется; одинаковые позиции суммируются. */
export async function addOrderLine(userId: string, orgId: string, orderId: string, input: unknown) {
  const d = parse(z.object({ dishId: z.uuid(), qty: z.coerce.number().int().min(1).max(999).default(1), version: z.coerce.number().int().optional().nullable() }), input);
  return inOrg(userId, orgId, 'pos.sell', async (tx, m) => {
    const o = await loadOrder(tx, orgId, orderId, true);
    if (m.site_ids.length && !m.site_ids.includes(o.site_id)) throw Errors.forbidden('Нет доступа к этой площадке.');
    if (o.status !== 'open') throw Errors.conflict('Заказ закрыт — изменения не вносятся.');
    assertVersion(o, d.version);
    const dish = (await tx.query(`select * from dishes where id = $1 and organization_id = $2 and status = 'active'`, [d.dishId, orgId])).rows[0];
    if (!dish) throw Errors.notFound('Блюдо не найдено.');
    if (!(Number(dish.sale_price) > 0)) throw Errors.validation(`У блюда «${dish.name}» не указана цена продажи.`);
    const stop = await activeStop(tx, o.site_id, dish.id);
    if (stop) throw Errors.conflict(`«${dish.name}» в стоп-листе: ${stop.reason}`);
    const price = r2(Number(dish.sale_price));
    const same = (await tx.query(`select * from pos_order_lines where order_id = $1 and dish_id = $2 and price = $3 and status = 'new'`, [orderId, dish.id, price])).rows[0];
    if (same) await tx.query(`update pos_order_lines set qty = qty + $2, amount = round((qty + $2) * price, 2) where id = $1`, [same.id, d.qty]);
    else await tx.query(`insert into pos_order_lines (organization_id, order_id, dish_id, name, qty, price, amount) values ($1, $2, $3, $4, $5, $6, $7)`,
      [orgId, orderId, dish.id, dish.name, d.qty, price, r2(price * d.qty)]);
    await retotal(tx, orderId);
    return orderView(tx, orgId, orderId);
  });
}

export async function setOrderLineQty(userId: string, orgId: string, lineId: string, input: unknown) {
  const d = parse(z.object({ qty: z.coerce.number().int().min(0).max(999), version: z.coerce.number().int().optional().nullable() }), input);
  return inOrg(userId, orgId, 'pos.sell', async (tx, m) => {
    const l = (await tx.query(`select * from pos_order_lines where id = $1 and organization_id = $2`, [lineId, orgId])).rows[0];
    if (!l) throw Errors.notFound('Позиция не найдена.');
    const o = await loadOrder(tx, orgId, l.order_id, true);
    if (m.site_ids.length && !m.site_ids.includes(o.site_id)) throw Errors.forbidden('Нет доступа к этой площадке.');
    if (o.status !== 'open' || l.status !== 'new') throw Errors.conflict('Заказ закрыт — изменения не вносятся.');
    assertVersion(o, d.version);
    if (d.qty === 0) await tx.query(`update pos_order_lines set status = 'removed' where id = $1`, [lineId]);
    else await tx.query(`update pos_order_lines set qty = $2, amount = round($2 * price, 2) where id = $1`, [lineId, d.qty]);
    await retotal(tx, o.id);
    return orderView(tx, orgId, o.id);
  });
}

export async function cancelOrder(userId: string, orgId: string, orderId: string, input: unknown) {
  const d = parse(z.object({ reason: z.string().trim().min(3, 'Укажите причину отмены.').max(300) }), input);
  return inOrg(userId, orgId, 'pos.sell', async (tx, m) => {
    const o = await loadOrder(tx, orgId, orderId, true);
    if (m.site_ids.length && !m.site_ids.includes(o.site_id)) throw Errors.forbidden('Нет доступа к этой площадке.');
    if (o.status !== 'open') throw Errors.conflict('Отменить можно только неоплаченный заказ. Оплаченный — возвратом.');
    await tx.query(`update pos_orders set status = 'cancelled', cancel_reason = $2, version = version + 1 where id = $1`, [orderId, d.reason]);
    await audit.record(tx, { organizationId: orgId, siteId: o.site_id, actorUserId: userId, action: 'pos.order_cancel', entityType: 'pos_order', entityId: orderId, after: { total: o.total }, reason: d.reason });
    return { ok: true };
  });
}

const PayInput = z.object({
  payments: z.array(z.object({ method: z.enum(['cash', 'card', 'other']), amount: money })).min(1, 'Укажите оплату.'),
  operationId: opId, version: z.coerce.number().int().optional().nullable(),
});

/**
 * Оплата: безнал не больше суммы заказа; переплата — только наличными (сдача). В оплаты пишется зачтённая сумма,
 * поэтому сумма оплат = итог заказа. Повтор с тем же ключом операции возвращает первый результат.
 */
export async function payOrder(userId: string, orgId: string, orderId: string, input: unknown) {
  const d = parse(PayInput, input);
  return inOrg(userId, orgId, 'pos.sell', async (tx, m) => once(tx, orgId, d.operationId, 'pos_pay', userId, async () => {
    const o = await loadOrder(tx, orgId, orderId, true);
    if (m.site_ids.length && !m.site_ids.includes(o.site_id)) throw Errors.forbidden('Нет доступа к этой площадке.');
    if (o.status === 'paid') throw Errors.conflict('Заказ уже оплачен.');
    if (o.status !== 'open') throw Errors.conflict(`Заказ ${ORDER_STATUS[o.status].toLowerCase()} — оплатить нельзя.`);
    assertVersion(o, d.version);
    const shift = await openShiftOf(tx, o.site_id);
    if (!shift || shift.id !== o.shift_id) throw Errors.conflict('Заказ из закрытой смены — отмените его и создайте заново.');
    const lines = (await tx.query(`select * from pos_order_lines where order_id = $1 and status = 'new' order by created_at`, [orderId])).rows;
    if (!lines.length) throw Errors.validation('В заказе нет позиций.');
    const total = r2(Number(o.total));
    const sums = { cash: 0, card: 0, other: 0 };
    for (const p of d.payments) sums[p.method] = r2(sums[p.method] + p.amount);
    const nonCash = r2(sums.card + sums.other);
    if (nonCash > total) throw Errors.validation('Безналичная оплата больше суммы заказа.');
    const paid = r2(nonCash + sums.cash);
    if (paid < total) throw Errors.validation(`Не хватает ${fmtNum(r2(total - paid))} ₽ до суммы заказа.`);
    const change = r2(paid - total);
    for (const [method, amount] of [['cash', r2(sums.cash - change)], ['card', sums.card], ['other', sums.other]] as const) {
      if (amount <= 0) continue;
      await tx.query(`insert into pos_payments (organization_id, site_id, shift_id, order_id, method, amount, kind, operation_id, created_by) values ($1, $2, $3, $4, $5, $6, 'payment', $7, $8)`,
        [orgId, o.site_id, shift.id, orderId, method, amount, d.operationId, userId]);
    }
    await tx.query(`update pos_order_lines set status = 'sold' where order_id = $1 and status = 'new'`, [orderId]);
    await tx.query(`update pos_orders set status = 'paid', paid_at = now(), version = version + 1 where id = $1`, [orderId]);
    const fulfil: Record<string, number> = {};
    for (const l of lines) {
      const s = (await tx.query(`insert into sales (organization_id, site_id, source, external_id, dish_id, name, qty, price, amount, sold_at, order_line_id, fulfil_status, created_by)
        values ($1, $2, 'pos', $3, $4, $5, $6, $7, $8, now(), $10, 'pending', $9) returning id`, [orgId, o.site_id, String(l.id), l.dish_id, l.name, l.qty, l.price, l.amount, userId, l.id])).rows[0];
      const st = await fulfilSale(tx, orgId, s.id, userId);
      fulfil[st] = (fulfil[st] || 0) + 1;
    }
    await audit.record(tx, { organizationId: orgId, siteId: o.site_id, actorUserId: userId, action: 'pos.pay', entityType: 'pos_order', entityId: orderId,
      after: { total, payments: sums, change, fulfil, operation_id: d.operationId } });
    return { order_id: orderId, total, change, fulfil };
  }));
}

const RefundInput = z.object({
  lineIds: z.array(z.uuid()).optional(), method: z.enum(['cash', 'card', 'other']),
  reason: z.string().trim().min(3, 'Укажите причину возврата.').max(300), operationId: opId,
});

/** Возврат — полный или по позициям, деньги из текущей смены; безнал — не больше, чем им оплачено. Сырьё не возвращается на склад. */
export async function refundOrder(userId: string, orgId: string, orderId: string, input: unknown) {
  const d = parse(RefundInput, input);
  return inOrg(userId, orgId, 'pos.refund', async (tx, m) => once(tx, orgId, d.operationId, 'pos_refund', userId, async () => {
    const o = await loadOrder(tx, orgId, orderId, true);
    if (m.site_ids.length && !m.site_ids.includes(o.site_id)) throw Errors.forbidden('Нет доступа к этой площадке.');
    if (o.status !== 'paid') throw Errors.conflict(o.status === 'refunded' ? 'По заказу уже сделан полный возврат.' : 'Вернуть можно только оплаченный заказ.');
    const shift = await openShiftOf(tx, o.site_id);
    if (!shift) throw Errors.conflict('Смена не открыта — возврат проводится в открытой смене.');
    const lines = (await tx.query(`select * from pos_order_lines where order_id = $1 and status = 'sold'`, [orderId])).rows;
    const want = d.lineIds?.length ? d.lineIds : lines.map((l) => l.id);
    const picked = lines.filter((l) => want.includes(l.id));
    if (picked.length !== want.length) throw Errors.conflict('Часть позиций уже возвращена или не относится к заказу.');
    if (!picked.length) throw Errors.validation('Нет позиций для возврата.');
    const amount = r2(picked.reduce((s, l) => s + Number(l.amount), 0));
    if (d.method !== 'cash') {
      const paidBy = Number((await tx.query(`select coalesce(sum(amount), 0) as s from pos_payments where order_id = $1 and method = $2`, [orderId, d.method])).rows[0].s);
      if (r2(paidBy) < amount) throw Errors.validation(`Способом «${METHOD_LABEL[d.method]}» по заказу оплачено ${fmtNum(r2(paidBy))} ₽ — вернуть ${fmtNum(amount)} ₽ этим способом нельзя.`);
    }
    for (const l of picked) {
      await tx.query(`insert into sales (organization_id, site_id, source, external_id, dish_id, name, qty, price, amount, sold_at, order_line_id, fulfil_status, created_by)
        values ($1, $2, 'pos', $3, $4, $5, $6, $7, $8, now(), $9, 'not_required', $10)`, [orgId, o.site_id, `${l.id}:R`, l.dish_id, l.name, -Number(l.qty), l.price, -Number(l.amount), l.id, userId]);
      await tx.query(`update pos_order_lines set status = 'refunded' where id = $1`, [l.id]);
    }
    await tx.query(`insert into pos_payments (organization_id, site_id, shift_id, order_id, method, amount, kind, reason, operation_id, created_by) values ($1, $2, $3, $4, $5, $6, 'refund', $7, $8, $9)`,
      [orgId, o.site_id, shift.id, orderId, d.method, -amount, d.reason, d.operationId, userId]);
    const refunded = r2(Number(o.refunded) + amount);
    const full = refunded >= r2(Number(o.total));
    await tx.query(`update pos_orders set refunded = $2, status = $3, version = version + 1 where id = $1`, [orderId, refunded, full ? 'refunded' : 'paid']);
    await audit.record(tx, { organizationId: orgId, siteId: o.site_id, actorUserId: userId, action: full ? 'pos.refund_full' : 'pos.refund_partial', entityType: 'pos_order', entityId: orderId,
      after: { amount, method: d.method, lines: picked.map((l) => l.name) }, reason: d.reason });
    return { refunded: amount, full };
  }));
}

/* ───────────── Импорт продаж внешней кассы ───────────── */

const ImportInput = z.object({
  siteId: z.uuid(),
  source: z.enum(['iiko', 'r_keeper', 'other']),
  rows: z.array(z.object({
    externalId: z.string().trim().min(1).max(100), soldAt: z.iso.datetime({ offset: true }).or(z.iso.date()),
    name: z.string().trim().min(1).max(200), qty: z.coerce.number().refine((v) => v !== 0, 'Количество не ноль.'), price: z.coerce.number().min(0),
    amount: z.coerce.number().optional().nullable(),
  })).min(1, 'Нет строк.').max(5000),
});

/** Повторная загрузка того же файла не дублирует продажи: ID строки внешней кассы уникален. */
export async function importSales(userId: string, orgId: string, input: unknown) {
  const d = parse(ImportInput, input);
  return inOrg(userId, orgId, 'sales.manage', async (tx) => {
    await getSite(tx, orgId, d.siteId);
    const res: Record<string, number> = { inserted: 0, duplicates: 0 };
    for (const r of d.rows) {
      const dish = await dishForName(tx, orgId, d.source, r.name);
      const ins = (await tx.query(`insert into sales (organization_id, site_id, source, external_id, dish_id, name, qty, price, amount, sold_at, fulfil_status, created_by)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) on conflict (organization_id, source, external_id) do nothing returning id`,
        [orgId, d.siteId, d.source, r.externalId, dish, r.name, r.qty, r.price, r.amount ?? r2(r.qty * r.price), r.soldAt, r.qty < 0 ? 'not_required' : dish ? 'pending' : 'unmatched', userId])).rows[0];
      if (!ins) { res.duplicates++; continue; }
      res.inserted++;
      const st = r.qty < 0 ? 'not_required' : dish ? await fulfilSale(tx, orgId, ins.id, userId) : 'unmatched';
      res[st] = (res[st] || 0) + 1;
    }
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: 'sales.import', entityType: 'sales', after: { source: d.source, rows: d.rows.length, ...res } });
    return res;
  }, d.siteId);
}

async function dishForName(tx: Tx, orgId: string, source: string, name: string): Promise<string | null> {
  const n = normName(name);
  const a = (await tx.query(`select dish_id from sale_aliases where organization_id = $1 and source = $2 and name_norm = $3`, [orgId, source, n])).rows[0];
  if (a) return a.dish_id;
  const ds = (await tx.query(`select id from dishes where organization_id = $1 and status = 'active' and lower(replace(name, 'ё', 'е')) = $2 limit 2`, [orgId, n])).rows;
  return ds.length === 1 ? ds[0].id : null;
}

/** Сопоставление названия внешней кассы с блюдом — один раз; все такие продажи сразу уходят на списание. */
export async function mapSaleName(userId: string, orgId: string, input: unknown) {
  const d = parse(z.object({ source: z.string().min(1).max(30), name: z.string().trim().min(1).max(200), dishId: z.uuid() }), input);
  return inOrg(userId, orgId, 'sales.manage', async (tx) => {
    if (!(await tx.query(`select 1 from dishes where id = $1 and organization_id = $2`, [d.dishId, orgId])).rowCount) throw Errors.notFound('Блюдо не найдено.');
    const n = normName(d.name);
    await tx.query(`insert into sale_aliases (organization_id, source, name_norm, dish_id, created_by) values ($1, $2, $3, $4, $5)
      on conflict (organization_id, source, name_norm) do update set dish_id = excluded.dish_id, created_by = excluded.created_by, created_at = now()`, [orgId, d.source, n, d.dishId, userId]);
    const rows = (await tx.query(`select id, name from sales where organization_id = $1 and source = $2 and fulfil_status = 'unmatched'`, [orgId, d.source])).rows.filter((r) => normName(r.name) === n);
    const res: Record<string, number> = { matched: rows.length };
    for (const r of rows) {
      await tx.query(`update sales set dish_id = $2, fulfil_status = 'pending' where id = $1`, [r.id, d.dishId]);
      const st = await fulfilSale(tx, orgId, r.id, userId);
      res[st] = (res[st] || 0) + 1;
    }
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'sales.map_name', entityType: 'dish', entityId: d.dishId, after: { source: d.source, name: d.name, ...res } });
    return res;
  });
}

/** Очередь: продажи, по которым сырьё не списано — с причиной; несопоставленные названия — группами. */
export async function salesQueue(userId: string, orgId: string, siteId?: string | null) {
  return inOrg(userId, orgId, 'sales.manage', async (tx) => {
    const rows = (await tx.query(`select s.id, s.source, s.name, s.qty, s.amount, s.sold_at, s.fulfil_status, s.fulfil_error, s.dish_id, d.name as dish_name, si.name as site_name
      from sales s left join dishes d on d.id = s.dish_id join sites si on si.id = s.site_id
      where s.organization_id = $1 and ($2::uuid is null or s.site_id = $2) and s.fulfil_status in ('pending', 'failed', 'no_ttk', 'unmatched') order by s.sold_at desc limit 500`, [orgId, siteId || null])).rows;
    const groups = new Map<string, { source: string; name: string; count: number; qty: number }>();
    for (const r of rows.filter((x) => x.fulfil_status === 'unmatched')) {
      const k = `${r.source}|${normName(r.name)}`;
      const g = groups.get(k) || { source: r.source, name: r.name, count: 0, qty: 0 };
      g.count++; g.qty += Number(r.qty); groups.set(k, g);
    }
    return { unmatched: [...groups.values()], waiting: rows.filter((x) => x.fulfil_status !== 'unmatched').map((r) => ({ ...r, status_label: FULFIL_LABEL[r.fulfil_status] })) };
  });
}

/* ───────────── Экономика ───────────── */

const PeriodInput = z.object({ siteId: z.uuid().optional().nullable(), from: z.iso.date(), to: z.iso.date() }).refine((p) => p.to >= p.from, 'Конец периода раньше начала.')
  .refine((p) => (Date.parse(p.to) - Date.parse(p.from)) / 86400e3 <= 370, 'Период — не больше года.');

/**
 * Выручка — по продажам (касса и импорт; возвраты — минусом). Себестоимость продаж — по партиям, фактически
 * списанным по ТТК. Продажи без списания или без цены партий дают «неполную» маржу — со счётчиком, не нулём.
 */
export async function economics(userId: string, orgId: string, input: unknown) {
  const p = parse(PeriodInput, input);
  return inOrg(userId, orgId, 'econ.read', async (tx, m) => {
    if (p.siteId && m.site_ids.length && !m.site_ids.includes(p.siteId)) throw Errors.forbidden('Нет доступа к этой площадке.');
    const tz = (await tx.query(`select timezone from organizations where id = $1`, [orgId])).rows[0].timezone;
    const per = `between (($2::date)::timestamp at time zone $4) and ((($3::date) + 1)::timestamp at time zone $4)`;
    const args = [orgId, p.from, p.to, tz, p.siteId || null];
    const s = (await tx.query(`select coalesce(sum(amount), 0) as revenue, coalesce(sum(amount) filter (where qty < 0), 0) as refunds,
        coalesce(sum(cost) filter (where fulfil_status = 'done' and cost is not null), 0) as cogs,
        coalesce(sum(amount) filter (where qty > 0 and fulfil_status = 'done' and cost is not null), 0) as revenue_costed,
        count(*) filter (where qty > 0 and (fulfil_status <> 'done' or cost is null))::int as uncosted,
        coalesce(sum(amount) filter (where qty > 0 and (fulfil_status <> 'done' or cost is null)), 0) as uncosted_amount,
        count(*) filter (where qty > 0)::int as lines
      from sales where organization_id = $1 and ($5::uuid is null or site_id = $5) and sold_at ${per}`, args)).rows[0];
    const orders = (await tx.query(`select count(*)::int as n, coalesce(sum(total), 0) as total from pos_orders where organization_id = $1 and ($5::uuid is null or site_id = $5)
      and status in ('paid', 'refunded') and paid_at ${per}`, args)).rows[0];
    const methods = (await tx.query(`select method, sum(amount) as amount from pos_payments where organization_id = $1 and ($5::uuid is null or site_id = $5) and created_at ${per} group by method`, args)).rows;
    const writeOff = (await tx.query(`select coalesce(sum(-m.quantity * l.unit_price), 0) as value, count(*) filter (where l.unit_price is null)::int as unpriced
      from stock_movements m join lots l on l.id = m.lot_id where m.organization_id = $1 and ($5::uuid is null or m.site_id = $5) and m.kind = 'write_off' and m.created_at ${per}`, args)).rows[0];
    const top = (await tx.query(`select coalesce(d.name, s.name) as name, sum(s.qty) as qty, sum(s.amount) as revenue, sum(s.cost) filter (where s.fulfil_status = 'done') as cost,
        bool_or(s.qty > 0 and (s.fulfil_status <> 'done' or s.cost is null)) as incomplete
      from sales s left join dishes d on d.id = s.dish_id where s.organization_id = $1 and ($5::uuid is null or s.site_id = $5) and s.sold_at ${per}
      group by 1 order by sum(s.amount) desc limit 30`, args)).rows;
    const shifts = (await tx.query(`select sh.id, sh.opened_at, sh.closed_at, sh.status, sh.cash_start, sh.cash_fact, sh.totals, si.name as site_name, u.full_name as opened_by_name
      from pos_shifts sh join sites si on si.id = sh.site_id join users u on u.id = sh.opened_by
      where sh.organization_id = $1 and ($5::uuid is null or sh.site_id = $5) and sh.opened_at ${per} order by sh.opened_at desc limit 60`, args)).rows;
    const revenue = r2(Number(s.revenue)), cogs = r2(Number(s.cogs)), costed = r2(Number(s.revenue_costed));
    return {
      period: p, revenue, refunds: r2(-Number(s.refunds)), orders: orders.n, avg_check: orders.n ? r2(Number(orders.total) / orders.n) : null,
      payments: Object.fromEntries(methods.map((x) => [x.method, r2(Number(x.amount))])),
      cogs, margin_costed: r2(costed - cogs), food_cost_pct: costed > 0 ? Math.round(cogs / costed * 1000) / 10 : null,
      complete: Number(s.uncosted) === 0, uncosted: { lines: Number(s.uncosted), amount: r2(Number(s.uncosted_amount)) },
      write_off: { value: r2(Number(writeOff.value)), unpriced: writeOff.unpriced },
      top: top.map((t) => ({ name: t.name, qty: Number(t.qty), revenue: r2(Number(t.revenue)), cost: t.cost === null ? null : r2(Number(t.cost)), incomplete: t.incomplete })),
      shifts: shifts.map((x) => ({ ...x, cash_diff: x.totals?.cash_diff ?? null, revenue: x.totals?.revenue ?? null })),
      can_see_cost: roleHas(m.role, 'cost.read'),
    };
  }, p.siteId || null);
}
