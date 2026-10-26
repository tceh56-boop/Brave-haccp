import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { roleHas } from '../access/roles';
import { inOrg, parse, optText, assertSiteAccess, getSite, fmtNum } from './common';
import { once } from './stock';
import { approvedRecipe, calcVersion, productPrice } from './recipes';
import { explode, takeFefo, semiGrams, type Need } from './bom';
import { dishesWithoutSample } from './lab';

/**
 * План-меню: мероприятия и банкеты (этап 13; перенос PlanMenu.gs и Stage 114 прежнего ЦЕХ, MON CHEF «Банкеты»).
 *  - Мероприятие: дата, время, гости, формат, контакт. План → подтверждено → проведено; отмена с причиной.
 *  - Меню: блюдо и порции. «На гостя» — порции = ⌈норма × гости⌉ и пересчитываются при смене числа гостей;
 *    «итого» — как на бланке заказа, не пересчитываются. Цена порции — из карточки блюда или своя.
 *  - Потребность — по утверждённым ТТК тем же расчётом, что продажа и производство (готовые п/ф идут первыми).
 *    Остаток — годные партии, срок которых не истекает до дня мероприятия. Блюдо без утверждённой ТТК —
 *    «потребность не рассчитана», а не ноль; подтвердить такое мероприятие нельзя.
 *  - Нехватка → заказ поставщику (связан с мероприятием); п/ф → задание на производство. Только явными действиями.
 *  - «Проведено»: фактические порции, списание по ТТК (FEFO) с источником «мероприятие», себестоимость, выручка;
 *    по каждому поданному блюду должна быть отобрана суточная проба (этап 14).
 */

export const EVENT_STATUS: Record<string, string> = { planned: 'План', confirmed: 'Подтверждено', done: 'Проведено', cancelled: 'Отменено' };
const num = (max: number, msg: string) => z.union([z.number(), z.string().trim().regex(/^\d+([.,]\d+)?$/, 'Введите число.').transform((s) => Number(s.replace(',', '.')))])
  .refine((v) => Number.isFinite(v) && v > 0 && v <= max, msg);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД.');
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;

async function eventFor(tx: Tx, orgId: string, id: string, lock = false) {
  const e = (await tx.query(`select e.*, e.event_date::text as event_date, s.name as site_name, o.timezone from plan_events e join sites s on s.id = e.site_id join organizations o on o.id = e.organization_id
    where e.id = $1 and e.organization_id = $2 ${lock ? 'for update of e' : ''}`, [id, orgId])).rows[0];
  if (!e) throw Errors.notFound('Мероприятие не найдено.');
  return e;
}
const editable = (e: { status: string }) => {
  if (!['planned', 'confirmed'].includes(e.status)) throw Errors.conflict(`Мероприятие «${EVENT_STATUS[e.status].toLowerCase()}» — менять нельзя.`);
};

/* ───────────── Мероприятия ───────────── */

const EventInput = z.object({
  title: z.string().trim().min(2, 'Укажите название мероприятия.').max(200),
  eventDate: day, eventTime: optText(20),
  guests: z.coerce.number().int('Число гостей — целое.').min(1, 'Укажите число гостей больше нуля.').max(10000),
  format: optText(100), contact: optText(300), note: optText(1000),
});

export async function createEvent(userId: string, orgId: string, input: unknown) {
  const d = parse(EventInput.extend({ siteId: z.uuid({ message: 'Выберите площадку.' }) }), input);
  return inOrg(userId, orgId, 'event.manage', async (tx) => {
    await getSite(tx, orgId, d.siteId);
    await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [`plan_event:${orgId}`]);
    const number = Number((await tx.query(`select coalesce(max(number), 0) + 1 as n from plan_events where organization_id = $1`, [orgId])).rows[0].n);
    const e = (await tx.query(`insert into plan_events (organization_id, site_id, number, title, event_date, event_time, guests, format, contact, note, created_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *, event_date::text as event_date`,
    [orgId, d.siteId, number, d.title, d.eventDate, d.eventTime, d.guests, d.format, d.contact, d.note, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: 'event.create', entityType: 'plan_event', entityId: e.id, after: { number, title: d.title, guests: d.guests, date: d.eventDate } });
    return e;
  }, d.siteId);
}

export async function listEvents(userId: string, orgId: string, siteId: string, period: string | null) {
  const sid = parse(z.uuid({ message: 'Выберите площадку.' }), siteId);
  const past = period === 'past';
  return inOrg(userId, orgId, 'event.read', async (tx) => (await tx.query(`
    select e.id, e.number, e.title, e.event_date::text as event_date, e.event_time, e.guests, e.format, e.status, e.revenue,
      (select count(*)::int from plan_event_items i where i.event_id = e.id) as items,
      (select sum(i.portions) from plan_event_items i where i.event_id = e.id) as portions
    from plan_events e where e.organization_id = $1 and e.site_id = $2
      and e.status in (${past ? `'done', 'cancelled'` : `'planned', 'confirmed'`})
    order by e.event_date ${past ? 'desc' : 'asc'}, e.event_time nulls last limit 200`, [orgId, sid])).rows
    .map((e) => ({ ...e, status_label: EVENT_STATUS[e.status] })), sid);
}

/** Изменение шапки; при смене числа гостей порции «на гостя» пересчитываются. */
export async function updateEvent(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(EventInput.partial(), input);
  return inOrg(userId, orgId, 'event.manage', async (tx, m) => {
    const e = await eventFor(tx, orgId, id, true);
    assertSiteAccess(m, e.site_id);
    editable(e);
    const next = { title: d.title ?? e.title, event_date: d.eventDate ?? e.event_date, event_time: d.eventTime !== undefined ? d.eventTime : e.event_time, guests: d.guests ?? e.guests,
      format: d.format !== undefined ? d.format : e.format, contact: d.contact !== undefined ? d.contact : e.contact, note: d.note !== undefined ? d.note : e.note };
    await tx.query(`update plan_events set title = $2, event_date = $3, event_time = $4, guests = $5, format = $6, contact = $7, note = $8 where id = $1`,
      [e.id, next.title, next.event_date, next.event_time, next.guests, next.format, next.contact, next.note]);
    let recalculated = 0;
    if (next.guests !== e.guests) recalculated = (await tx.query(`update plan_event_items set portions = ceil(per_guest * $2) where event_id = $1 and per_guest is not null`, [e.id, next.guests])).rowCount || 0;
    await audit.record(tx, { organizationId: orgId, siteId: e.site_id, actorUserId: userId, action: 'event.update', entityType: 'plan_event', entityId: e.id,
      before: { guests: e.guests, date: e.event_date, title: e.title }, after: d });
    return { ok: true, recalculated };
  });
}

/* ───────────── Меню мероприятия ───────────── */

const ItemInput = z.object({
  dishId: z.uuid({ message: 'Выберите блюдо.' }),
  perGuest: num(20, 'Порций на гостя — от 0 до 20.').optional().nullable(),
  portions: num(100000, 'Порций — больше нуля.').optional().nullable(),
  price: z.union([z.number(), z.string().trim().regex(/^\d+([.,]\d+)?$/, 'Введите число.').transform((s) => Number(s.replace(',', '.')))]).refine((v) => v >= 0, 'Цена не меньше нуля.').optional().nullable(),
  note: optText(200),
}).refine((x) => (x.perGuest == null) !== (x.portions == null), 'Укажите либо порций на гостя, либо порций итого.');

/** Блюдо в меню (повторное добавление того же блюда заменяет позицию). */
export async function setItem(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(ItemInput, input);
  return inOrg(userId, orgId, 'event.manage', async (tx, m) => {
    const e = await eventFor(tx, orgId, id, true);
    assertSiteAccess(m, e.site_id);
    editable(e);
    const dish = (await tx.query(`select id, name, kind from dishes where id = $1 and organization_id = $2 and status = 'active'`, [d.dishId, orgId])).rows[0];
    if (!dish) throw Errors.notFound('Блюдо не найдено.');
    if (dish.kind !== 'dish') throw Errors.validation('В меню мероприятия — блюда; полуфабрикаты попадут в потребность сами.');
    const portions = d.perGuest != null ? Math.ceil(d.perGuest * e.guests) : d.portions!;
    await tx.query(`insert into plan_event_items (organization_id, event_id, dish_id, per_guest, portions, price, note) values ($1, $2, $3, $4, $5, $6, $7)
      on conflict (event_id, dish_id) do update set per_guest = excluded.per_guest, portions = excluded.portions, price = excluded.price, note = excluded.note`,
    [orgId, e.id, dish.id, d.perGuest ?? null, portions, d.price ?? null, d.note]);
    await audit.record(tx, { organizationId: orgId, siteId: e.site_id, actorUserId: userId, action: 'event.item', entityType: 'plan_event', entityId: e.id, after: { dish: dish.name, portions, perGuest: d.perGuest ?? null } });
    return { portions };
  });
}

export async function removeItem(userId: string, orgId: string, id: string, dishId: string) {
  return inOrg(userId, orgId, 'event.manage', async (tx, m) => {
    const e = await eventFor(tx, orgId, id, true);
    assertSiteAccess(m, e.site_id);
    editable(e);
    const r = await tx.query(`delete from plan_event_items where event_id = $1 and dish_id = $2`, [e.id, dishId]);
    if (!r.rowCount) throw Errors.notFound('Позиции нет в меню.');
    await audit.record(tx, { organizationId: orgId, siteId: e.site_id, actorUserId: userId, action: 'event.item_remove', entityType: 'plan_event', entityId: e.id, after: { dishId } });
    return { ok: true };
  });
}

async function itemsOf(tx: Tx, eventId: string) {
  return (await tx.query(`select i.*, d.name as dish, d.sale_price, v.version as ttk_version, v.portion_g
    from plan_event_items i join dishes d on d.id = i.dish_id left join ttk_versions v on v.dish_id = d.id and v.status = 'approved'
    where i.event_id = $1 order by d.name`, [eventId])).rows;
}

/* ───────────── Потребность ───────────── */

/** Годный остаток на день мероприятия: партии, срок которых не истекает раньше этого дня. */
async function stockOn(tx: Tx, orgId: string, siteId: string, productId: string, date: string) {
  return Number((await tx.query(`select coalesce(sum(l.quantity), 0) as q from lots l where l.organization_id = $1 and l.site_id = $2 and l.product_id = $3
    and l.status = 'available' and l.expires_at is not null and l.expiry_basis is not null and l.quantity > 0 and l.expires_at > greatest(now(), $4::date)`,
  [orgId, siteId, productId, date])).rows[0].q);
}

/**
 * Потребность по меню: складские позиции (сырьё и готовые п/ф), остаток на день мероприятия, заказано под мероприятие,
 * нехватка; полуфабрикаты к приготовлению; блюда без расчёта.
 */
async function needsOf(tx: Tx, orgId: string, e: { id: string; site_id: string; event_date: string | Date }, items: Awaited<ReturnType<typeof itemsOf>>) {
  const date = typeof e.event_date === 'string' ? e.event_date.slice(0, 10) : e.event_date.toLocaleDateString('sv-SE');
  const acc = new Map<string, Need>();
  const missing: { dish: string; reason: string }[] = [];
  const semis = new Map<string, { dish_id: string; name: string; grams: number }>();
  for (const it of items) {
    try {
      await explode(tx, orgId, it.dish_id, { portions: Number(it.portions) }, { siteId: e.site_id }, 0, acc);
    } catch (err) { missing.push({ dish: it.dish, reason: (err as Error).message }); continue; }
    // п/ф первого уровня — сколько нужно приготовить
    const r = await approvedRecipe(tx, orgId, it.dish_id);
    if (!r?.version.portion_g || !r.version.yield_g) continue;
    const factor = Number(it.portions) * Number(r.version.portion_g) / Number(r.version.yield_g);
    for (const l of r.lines.filter((x) => x.sub_dish_id)) {
      const g = await semiGrams(tx, l.sub_dish_id, Number(l.brutto ?? l.netto ?? 0) * factor, l.unit);
      if (g === null) continue;
      const name = (await tx.query(`select name from dishes where id = $1`, [l.sub_dish_id])).rows[0]?.name || l.name_raw;
      const cur = semis.get(l.sub_dish_id) || { dish_id: l.sub_dish_id, name, grams: 0 };
      cur.grams += g; semis.set(l.sub_dish_id, cur);
    }
  }
  const ordered = new Map<string, number>((await tx.query(`select l.product_id, sum(l.quantity) as q from supplier_order_lines l join supplier_orders o on o.id = l.order_id
    where o.plan_event_id = $1 and o.status in ('draft', 'sent', 'confirmed') group by l.product_id`, [e.id])).rows.map((x) => [x.product_id, Number(x.q)]));
  const lines = [];
  for (const n of acc.values()) {
    const stock = await stockOn(tx, orgId, e.site_id, n.productId, date);
    const ord = ordered.get(n.productId) || 0;
    const last = (await tx.query(`select r.supplier_id, rl.unit_price from receipt_lines rl join receipts r on r.id = rl.receipt_id
      where rl.product_id = $1 and r.site_id = $2 and r.status <> 'draft' and r.supplier_id is not null order by r.completed_at desc nulls last limit 1`, [n.productId, e.site_id])).rows[0];
    lines.push({ product_id: n.productId, name: n.name, unit: n.unit, semi: !!n.semiOf, need: r3(n.qty), stock: r3(stock), ordered: r3(ord),
      shortage: r3(Math.max(0, n.qty - stock - ord)), last_supplier_id: last?.supplier_id || null, last_price: last?.unit_price == null ? null : Number(last.unit_price) });
  }
  lines.sort((a, b) => Number(b.shortage > 0) - Number(a.shortage > 0) || a.name.localeCompare(b.name));
  const semiOut = [];
  for (const s of semis.values()) {
    const p = (await tx.query(`select d.product_id, p.unit from dishes d left join products p on p.id = d.product_id where d.id = $1`, [s.dish_id])).rows[0];
    const readyKg = p?.product_id && p.unit === 'кг' ? await stockOn(tx, orgId, e.site_id, p.product_id, date) : 0;
    const planned = Number((await tx.query(`select coalesce(sum(planned_g), 0) as g from production_orders where plan_event_id = $1 and dish_id = $2 and status in ('planned', 'in_progress', 'done')`,
      [e.id, s.dish_id])).rows[0].g) / 1000;
    const needKg = s.grams / 1000;
    semiOut.push({ dish_id: s.dish_id, name: s.name, need_kg: r3(needKg), ready_kg: r3(readyKg), planned_kg: r3(planned), to_make_kg: r3(Math.max(0, needKg - readyKg - planned)) });
  }
  return { lines, semis: semiOut.sort((a, b) => a.name.localeCompare(b.name)), missing, complete: missing.length === 0 };
}

export async function getEvent(userId: string, orgId: string, id: string) {
  return inOrg(userId, orgId, 'event.read', async (tx, m) => {
    const e = await eventFor(tx, orgId, id);
    assertSiteAccess(m, e.site_id);
    const items = await itemsOf(tx, e.id);
    const cost = roleHas(m.role, 'cost.read'), money = cost || roleHas(m.role, 'menu.price');   // цены и выручка — не всем
    const sampled = new Set((await tx.query(`select dish_id from daily_samples where plan_event_id = $1`, [e.id])).rows.map((r) => r.dish_id as string));
    // плановая себестоимость порции по утверждённой ТТК (неполная — null, не ноль)
    const unitCost = new Map<string, number | null>();
    if (cost) for (const i of items) unitCost.set(i.dish_id, await portionCost(tx, orgId, i.dish_id));
    const priced = items.map((i) => ({ unit_cost: cost ? unitCost.get(i.dish_id) ?? null : null, sampled: sampled.has(i.dish_id), id: i.id, dish_id: i.dish_id, dish: i.dish, per_guest: i.per_guest === null ? null : Number(i.per_guest), portions: Number(i.portions),
      price: !money ? null : i.price !== null ? Number(i.price) : i.sale_price !== null ? Number(i.sale_price) : null, own_price: i.price !== null, note: i.note, ttk_version: i.ttk_version,
      actual_portions: i.actual_portions === null ? null : Number(i.actual_portions), cost: cost && i.cost !== null ? Number(i.cost) : null }));
    const amount = money && priced.length && priced.every((i) => i.price !== null) ? r2(priced.reduce((s, i) => s + i.price! * i.portions, 0)) : null;
    const needs = ['planned', 'confirmed'].includes(e.status) ? await needsOf(tx, orgId, e, items) : null;
    const orders = (await tx.query(`select o.id, o.number, o.status, s.name as supplier from supplier_orders o join suppliers s on s.id = o.supplier_id where o.plan_event_id = $1 order by o.number`, [e.id])).rows;
    const production = (await tx.query(`select o.id, o.status, o.planned_g, o.planned_for, d.name as dish from production_orders o join dishes d on d.id = o.dish_id where o.plan_event_id = $1 order by o.planned_for`, [e.id])).rows;
    const { timezone: _tz, ...ev } = e;
    return { event: { ...ev, status_label: EVENT_STATUS[e.status], revenue: !money || e.revenue === null ? null : Number(e.revenue), can_see_money: money, cost: cost && e.cost !== null ? Number(e.cost) : null },
      items: priced, amount, per_guest_amount: amount === null ? null : r2(amount / e.guests), needs, orders, production };
  });
}

/** Себестоимость порции по утверждённой ТТК: полная — число, иначе null. */
async function portionCost(tx: Tx, orgId: string, dishId: string) {
  const v = (await tx.query(`select id, yield_g, portion_g from ttk_versions where dish_id = $1 and status = 'approved'`, [dishId])).rows[0];
  if (!v?.yield_g || !v.portion_g) return null;
  const c = await calcVersion(tx, orgId, v.id, new Set([dishId]));
  return c.cost.complete ? r2(c.cost.total * Number(v.portion_g) / Number(v.yield_g)) : null;
}

/**
 * Требование в кладовую по плану-меню (как в Шеф Эксперте): сырьё по утверждённым ТТК на все порции, полуфабрикаты
 * раскладываются до сырья (до 5 уровней). Цена — средняя по партиям в остатке, иначе последняя закупка; видят те,
 * кому положено видеть себестоимость. Нет цены — сумма не считается (не ноль).
 */
export async function getRequisition(userId: string, orgId: string, id: string) {
  return inOrg(userId, orgId, 'event.read', async (tx, m) => {
    const e = await eventFor(tx, orgId, id);
    assertSiteAccess(m, e.site_id);
    const items = await itemsOf(tx, e.id);
    const seeCost = roleHas(m.role, 'cost.read');
    const acc = new Map<string, Need>();
    const missing: { dish: string; reason: string }[] = [];
    for (const it of items) {
      try { await explode(tx, orgId, it.dish_id, { portions: Number(it.portions) }, {}, 0, acc); }
      catch (err) { missing.push({ dish: it.dish, reason: (err as Error).message }); }
    }
    const lines = [];
    for (const n of acc.values()) {
      const pp = seeCost ? await productPrice(tx, orgId, n.productId) : null;
      const price = pp && pp.unit === n.unit ? r2(pp.price) : null;
      lines.push({ product_id: n.productId, name: n.name, unit: n.unit, qty: r3(n.qty), price, sum: price === null ? null : r2(price * n.qty), price_source: price === null ? null : pp!.source });
    }
    lines.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    const total = seeCost && lines.length && lines.every((l) => l.sum !== null) ? r2(lines.reduce((s2, l) => s2 + l.sum!, 0)) : null;
    const org = (await tx.query(`select name, legal_form from organizations where id = $1`, [orgId])).rows[0];
    return { event: { id: e.id, number: e.number, title: e.title, event_date: e.event_date, site_name: e.site_name, guests: e.guests }, org, lines, total, see_cost: seeCost, missing,
      no_price: seeCost ? lines.filter((l) => l.price === null).map((l) => l.name) : [] };
  });
}

/* ───────────── Переходы ───────────── */

/** Подтвердить: меню не пустое, у каждого блюда утверждённая ТТК (иначе потребность не рассчитать). */
export async function confirmEvent(userId: string, orgId: string, id: string) {
  return inOrg(userId, orgId, 'event.manage', async (tx, m) => {
    const e = await eventFor(tx, orgId, id, true);
    assertSiteAccess(m, e.site_id);
    if (e.status !== 'planned') throw Errors.conflict(`Мероприятие уже «${EVENT_STATUS[e.status].toLowerCase()}».`);
    const items = await itemsOf(tx, e.id);
    if (!items.length) throw Errors.validation('В меню нет блюд.');
    const noTtk = items.filter((i) => !i.ttk_version);
    if (noTtk.length) throw Errors.conflict(`Нет утверждённой ТТК: ${noTtk.map((i) => i.dish).join(', ')}. Без неё не рассчитать потребность и списание.`);
    await tx.query(`update plan_events set status = 'confirmed', confirmed_at = now() where id = $1`, [e.id]);
    await audit.record(tx, { organizationId: orgId, siteId: e.site_id, actorUserId: userId, action: 'event.confirm', entityType: 'plan_event', entityId: e.id, before: { status: e.status }, after: { status: 'confirmed' } });
    return { status: 'confirmed' };
  });
}

export async function cancelEvent(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(z.object({ reason: z.string().trim().min(3, 'Укажите причину отмены.').max(300) }), input);
  return inOrg(userId, orgId, 'event.manage', async (tx, m) => {
    const e = await eventFor(tx, orgId, id, true);
    assertSiteAccess(m, e.site_id);
    editable(e);
    await tx.query(`update plan_events set status = 'cancelled', cancel_reason = $2 where id = $1`, [e.id, d.reason]);
    await audit.record(tx, { organizationId: orgId, siteId: e.site_id, actorUserId: userId, action: 'event.cancel', entityType: 'plan_event', entityId: e.id, reason: d.reason });
    return { status: 'cancelled' };
  });
}

const CompleteInput = z.object({
  operationId: z.string().trim().min(8).max(100),
  actual: z.array(z.object({ dishId: z.uuid(), portions: z.coerce.number().min(0).max(100000) })).max(300).default([]),
});

/**
 * «Проведено»: фактические порции (по умолчанию — плановые), списание по ТТК (FEFO, готовые п/ф первыми) с источником
 * «мероприятие», себестоимость по ценам партий, выручка по ценам порций. Не хватает остатка — ничего не списывается.
 */
export async function completeEvent(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(CompleteInput, input);
  return inOrg(userId, orgId, 'event.manage', async (tx, m) => once(tx, orgId, d.operationId, 'event_complete', userId, async () => {
    const e = await eventFor(tx, orgId, id, true);
    assertSiteAccess(m, e.site_id);
    if (e.status !== 'confirmed') throw Errors.conflict(e.status === 'planned' ? 'Сначала подтвердите мероприятие.' : `Мероприятие уже «${EVENT_STATUS[e.status].toLowerCase()}».`);
    const today = (await tx.query(`select (now() at time zone $1)::date::text as d`, [e.timezone || 'Europe/Moscow'])).rows[0].d;
    const date = typeof e.event_date === 'string' ? e.event_date.slice(0, 10) : e.event_date.toLocaleDateString('sv-SE');
    if (date > today) throw Errors.conflict('Мероприятие ещё не наступило: «Проведено» — в день мероприятия или позже.');
    const items = await itemsOf(tx, e.id);
    const served = items.filter((it) => (d.actual.find((a) => a.dishId === it.dish_id)?.portions ?? Number(it.portions)) > 0).map((it) => it.dish_id);
    const noSample = await dishesWithoutSample(tx, e.id, served);
    if (noSample.length) throw Errors.conflict(`Нет суточной пробы: ${noSample.join(', ')}. Отберите пробу по каждому поданному блюду («Лаборатория и пробы»).`);
    let revenue: number | null = 0, total: number | null = 0, written = 0;
    for (const it of items) {
      const fact = d.actual.find((a) => a.dishId === it.dish_id)?.portions ?? Number(it.portions);
      let cost: number | null = 0;
      if (fact > 0) {
        const { needs } = await explode(tx, orgId, it.dish_id, { portions: fact }, { siteId: e.site_id });
        for (const n of needs.values()) {
          const c = await takeFefo(tx, orgId, e.site_id, n, { refType: 'banquet', refId: e.id, reason: `мероприятие № ${e.number}: ${it.dish} × ${fmtNum(fact)}`, operationId: d.operationId, userId });
          cost = cost === null || c === null ? null : cost + c;
          written++;
        }
      }
      const price = it.price !== null ? Number(it.price) : it.sale_price !== null ? Number(it.sale_price) : null;
      revenue = revenue === null || price === null ? null : revenue + price * fact;
      total = total === null || cost === null ? null : total + cost;
      await tx.query(`update plan_event_items set actual_portions = $2, cost = $3 where id = $1`, [it.id, fact, cost === null ? null : r2(cost)]);
    }
    revenue = revenue === null ? null : r2(revenue); total = total === null ? null : r2(total);
    await tx.query(`update plan_events set status = 'done', completed_by = $2, completed_at = now(), revenue = $3, cost = $4 where id = $1`, [e.id, userId, revenue, total]);
    await audit.record(tx, { organizationId: orgId, siteId: e.site_id, actorUserId: userId, action: 'event.complete', entityType: 'plan_event', entityId: e.id, after: { revenue, cost: total, movements: written } });
    return { status: 'done', revenue, cost: total, movements: written };
  }));
}
