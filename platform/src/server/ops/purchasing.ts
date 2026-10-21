import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText, assertSiteAccess, getSite, fmtNum } from './common';
import { USABLE } from './bom';

/**
 * Закупки (этап 12; перенос Purchasing.gs прежнего ЦЕХ и MON CHEF 1.4–1.5, 1.12).
 *  - Норма запаса на площадке: вручную — с основанием; автоматически — средний расход в день за окно (по журналу
 *    движений: расход, продажи, производство) × дни покрытия × (1 + страховой %).
 *  - «Что заказать»: норма − годный остаток − уже заказанное (отправленные и подтверждённые заказы); дни запаса.
 *    Карантинные, просроченные и без подтверждённого срока партии в остаток не входят.
 *  - Заказ: черновик → отправлен → подтверждён → принят; отмена с причиной. Заблокированному поставщику не заказать.
 *  - Приёмка по заказу — обычная приёмка с проверками; её завершение переводит заказ в «принят»,
 *    расхождения «заказано / принято» видны в заказе.
 */

export const ORDER_STATUS: Record<string, string> = { draft: 'Черновик', sent: 'Отправлен', confirmed: 'Подтверждён', received: 'Принят', cancelled: 'Отменён' };
const qty = z.union([z.number(), z.string().trim().regex(/^\d+([.,]\d+)?$/, 'Введите число.').transform((s) => Number(s.replace(',', '.')))])
  .refine((v) => Number.isFinite(v) && v > 0 && v <= 100000, 'Количество — больше нуля.');
const money = z.union([z.number(), z.string().trim().regex(/^\d+([.,]\d+)?$/, 'Введите число.').transform((s) => Number(s.replace(',', '.')))]).refine((v) => v >= 0, 'Цена не меньше нуля.');
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Средний расход в день по журналу движений (расход, продажи, производство) за окно. */
async function dailyUse(tx: Tx, siteId: string, productId: string, windowDays: number) {
  const used = Number((await tx.query(`select coalesce(-sum(quantity), 0) as q from stock_movements where site_id = $1 and product_id = $2 and kind = 'consume'
    and created_at >= now() - make_interval(days => $3)`, [siteId, productId, windowDays])).rows[0].q);
  return used / windowDays;
}

function normQty(n: { mode: string; min_qty: string | null; cover_days: string; safety_pct: string }, daily: number) {
  if (n.mode === 'manual') return Number(n.min_qty);
  return r3(daily * Number(n.cover_days) * (1 + Number(n.safety_pct) / 100));
}

/* ───────────── Что заказать ───────────── */

export async function purchaseNeeds(userId: string, orgId: string, siteId: string) {
  const sid = parse(z.uuid({ message: 'Выберите площадку.' }), siteId);
  return inOrg(userId, orgId, 'purchase.read', async (tx) => {
    // позиции с нормой или с расходом за 28 дней
    const products = (await tx.query(`select p.id, p.name, p.unit, n.id as norm_id, n.mode, n.min_qty, n.cover_days, n.safety_pct, n.window_days, n.basis
      from products p left join stock_norms n on n.product_id = p.id and n.site_id = $2
      where p.organization_id = $1 and p.status = 'active' and (n.id is not null or exists (select 1 from stock_movements m where m.site_id = $2 and m.product_id = p.id
        and m.kind = 'consume' and m.created_at >= now() - interval '28 days'))
      order by p.name`, [orgId, sid])).rows;
    const out = [];
    for (const p of products) {
      const window = p.window_days || 28;
      const daily = await dailyUse(tx, sid, p.id, window);
      const stock = Number((await tx.query(`select coalesce(sum(l.quantity), 0) as q from lots l where l.site_id = $1 and l.product_id = $2 and ${USABLE}`, [sid, p.id])).rows[0].q);
      const ordered = Number((await tx.query(`select coalesce(sum(ol.quantity), 0) as q from supplier_order_lines ol join supplier_orders o on o.id = ol.order_id
        where o.site_id = $1 and ol.product_id = $2 and o.status in ('sent', 'confirmed')`, [sid, p.id])).rows[0].q);
      const draft = Number((await tx.query(`select coalesce(sum(ol.quantity), 0) as q from supplier_order_lines ol join supplier_orders o on o.id = ol.order_id
        where o.site_id = $1 and ol.product_id = $2 and o.status = 'draft'`, [sid, p.id])).rows[0].q);
      const last = (await tx.query(`select r.supplier_id, s.name as supplier, rl.unit_price from receipt_lines rl join receipts r on r.id = rl.receipt_id left join suppliers s on s.id = r.supplier_id
        where rl.product_id = $1 and r.site_id = $2 and r.status <> 'draft' order by r.completed_at desc nulls last limit 1`, [p.id, sid])).rows[0] || null;
      const min = p.norm_id ? normQty(p, daily) : null;
      const suggest = min === null ? 0 : Math.max(0, r3(min - stock - ordered));
      out.push({ product_id: p.id, name: p.name, unit: p.unit, norm: p.norm_id ? { mode: p.mode, min: min, cover_days: Number(p.cover_days), safety_pct: Number(p.safety_pct), window_days: window, basis: p.basis } : null,
        daily: r3(daily), stock: r3(stock), ordered: r3(ordered), draft: r3(draft), days_left: daily > 0 ? Math.round(stock / daily * 10) / 10 : null, suggest,
        last_supplier_id: last?.supplier_id || null, last_supplier: last?.supplier || null, last_price: last?.unit_price === null || last?.unit_price === undefined ? null : Number(last.unit_price) });
    }
    return out.sort((a, b) => Number(b.suggest > 0) - Number(a.suggest > 0) || (a.days_left ?? 1e9) - (b.days_left ?? 1e9) || a.name.localeCompare(b.name));
  }, sid);
}

const NormInput = z.object({
  siteId: z.uuid(), productId: z.uuid(), mode: z.enum(['manual', 'auto', 'off']),
  minQty: qty.or(z.literal(0)).optional().nullable(), basis: optText(300),
  coverDays: z.coerce.number().positive().max(90).optional(), safetyPct: z.coerce.number().min(0).max(300).optional(), windowDays: z.coerce.number().int().min(7).max(180).optional(),
}).refine((x) => x.mode !== 'manual' || (x.minQty != null && !!x.basis && x.basis.length >= 5), 'Для ручной нормы укажите количество и основание (например, «поставка раз в неделю, запас на 7 дней»).');

/** Норма запаса: вручную (с основанием), автоматически по обороту, или снять («off»). */
export async function setNorm(userId: string, orgId: string, input: unknown) {
  const d = parse(NormInput, input);
  return inOrg(userId, orgId, 'purchase.manage', async (tx) => {
    await getSite(tx, orgId, d.siteId);
    if (!(await tx.query(`select 1 from products where id = $1 and organization_id = $2`, [d.productId, orgId])).rowCount) throw Errors.notFound('Товар не найден.');
    const before = (await tx.query(`select mode, min_qty, cover_days, safety_pct, window_days, basis from stock_norms where site_id = $1 and product_id = $2`, [d.siteId, d.productId])).rows[0] || null;
    if (d.mode === 'off') {
      await tx.query(`delete from stock_norms where site_id = $1 and product_id = $2`, [d.siteId, d.productId]);
    } else {
      await tx.query(`insert into stock_norms (organization_id, site_id, product_id, mode, min_qty, cover_days, safety_pct, window_days, basis, updated_by)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        on conflict (site_id, product_id) do update set mode = excluded.mode, min_qty = excluded.min_qty, cover_days = excluded.cover_days, safety_pct = excluded.safety_pct,
          window_days = excluded.window_days, basis = excluded.basis, updated_by = excluded.updated_by, updated_at = now()`,
      [orgId, d.siteId, d.productId, d.mode, d.mode === 'manual' ? d.minQty : null, d.coverDays ?? 3, d.safetyPct ?? 20, d.windowDays ?? 28, d.basis, userId]);
    }
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: 'stock.norm', entityType: 'product', entityId: d.productId, before, after: d });
    return { ok: true };
  }, d.siteId);
}

/* ───────────── Заказы поставщикам ───────────── */

async function orderFor(tx: Tx, orgId: string, id: string, lock = false) {
  const o = (await tx.query(`select o.*, s.name as supplier, s.phone as supplier_phone, s.email as supplier_email, s.blocked_reason, st.name as site_name
    from supplier_orders o join suppliers s on s.id = o.supplier_id join sites st on st.id = o.site_id where o.id = $1 and o.organization_id = $2 ${lock ? 'for update of o' : ''}`, [id, orgId])).rows[0];
  if (!o) throw Errors.notFound('Заказ не найден.');
  return o;
}

const LineIn = z.object({ productId: z.uuid(), quantity: qty, price: money.nullable().optional(), note: optText(200) });
const OrderInput = z.object({ siteId: z.uuid(), supplierId: z.uuid({ message: 'Выберите поставщика.' }), expectedAt: z.iso.date().optional().nullable(), note: optText(500),
  lines: z.array(LineIn).min(1, 'Добавьте хотя бы одну позицию.').max(200) });

async function assertSupplierOpen(tx: Tx, orgId: string, supplierId: string) {
  const s = (await tx.query(`select name, status, blocked_reason from suppliers where id = $1 and organization_id = $2`, [supplierId, orgId])).rows[0];
  if (!s) throw Errors.notFound('Поставщик не найден.');
  if (s.status !== 'active') throw Errors.conflict(`Поставщик «${s.name}» в архиве.`);
  if (s.blocked_reason) throw Errors.conflict(`Поставщик «${s.name}» заблокирован для заказов: ${s.blocked_reason}`);
}

async function putLine(tx: Tx, orgId: string, orderId: string, l: z.infer<typeof LineIn>) {
  const p = (await tx.query(`select id, unit from products where id = $1 and organization_id = $2`, [l.productId, orgId])).rows[0];
  if (!p) throw Errors.notFound('Товар не найден.');
  await tx.query(`insert into supplier_order_lines (organization_id, order_id, product_id, quantity, unit, price, note) values ($1, $2, $3, $4, $5, $6, $7)
    on conflict (order_id, product_id) do update set quantity = excluded.quantity, price = excluded.price, note = excluded.note`,
  [orgId, orderId, p.id, l.quantity, p.unit, l.price ?? null, l.note]);
}

export async function createOrder(userId: string, orgId: string, input: unknown) {
  const d = parse(OrderInput, input);
  return inOrg(userId, orgId, 'purchase.manage', async (tx) => {
    await getSite(tx, orgId, d.siteId);
    await assertSupplierOpen(tx, orgId, d.supplierId);
    await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [`supplier_order:${orgId}`]);   // сквозная нумерация без дублей
    const number = Number((await tx.query(`select coalesce(max(number), 0) + 1 as n from supplier_orders where organization_id = $1`, [orgId])).rows[0].n);
    const o = (await tx.query(`insert into supplier_orders (organization_id, site_id, supplier_id, number, expected_at, note, created_by) values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      [orgId, d.siteId, d.supplierId, number, d.expectedAt || null, d.note, userId])).rows[0];
    for (const l of d.lines) await putLine(tx, orgId, o.id, l);
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: 'purchase.order_create', entityType: 'supplier_order', entityId: o.id, after: { number, lines: d.lines.length } });
    return o;
  }, d.siteId);
}

export async function listOrders(userId: string, orgId: string, siteId: string) {
  const sid = parse(z.uuid({ message: 'Выберите площадку.' }), siteId);
  return inOrg(userId, orgId, 'purchase.read', async (tx) => (await tx.query(`
    select o.id, o.number, o.status, o.expected_at, o.created_at, o.sent_at, o.received_at, s.name as supplier,
      (select count(*)::int from supplier_order_lines l where l.order_id = o.id) as lines,
      (select sum(l.quantity * l.price) from supplier_order_lines l where l.order_id = o.id) as amount
    from supplier_orders o join suppliers s on s.id = o.supplier_id where o.organization_id = $1 and o.site_id = $2
    order by case o.status when 'draft' then 0 when 'sent' then 1 when 'confirmed' then 2 else 3 end, o.created_at desc limit 200`, [orgId, sid])).rows
    .map((o) => ({ ...o, status_label: ORDER_STATUS[o.status] })), sid);
}

/** Заказ: строки; после приёмки — сколько принято по каждой позиции и расхождения. */
export async function getOrder(userId: string, orgId: string, id: string) {
  return inOrg(userId, orgId, 'purchase.read', async (tx, m) => {
    const o = await orderFor(tx, orgId, id);
    assertSiteAccess(m, o.site_id);
    const lines = (await tx.query(`select l.id, l.product_id, p.name as product, l.quantity, l.unit, l.price, l.note,
        (select coalesce(sum(rl.quantity) filter (where rl.decision <> 'rejected'), 0) from receipt_lines rl join receipts r on r.id = rl.receipt_id
          where r.supplier_order_id = l.order_id and r.status <> 'draft' and rl.product_id = l.product_id) as received
      from supplier_order_lines l join products p on p.id = l.product_id where l.order_id = $1 order by p.name`, [o.id])).rows
      .map((l) => ({ ...l, diff: o.status === 'received' ? r3(Number(l.received) - Number(l.quantity)) : null }));
    const extra = o.status === 'received' ? (await tx.query(`select p.name as product, sum(rl.quantity) as quantity, rl.unit from receipt_lines rl join receipts r on r.id = rl.receipt_id join products p on p.id = rl.product_id
      where r.supplier_order_id = $1 and r.status <> 'draft' and rl.decision <> 'rejected' and rl.product_id not in (select product_id from supplier_order_lines where order_id = $1)
      group by p.name, rl.unit`, [o.id])).rows : [];
    const receipts = (await tx.query(`select id, status, document_no, completed_at from receipts where supplier_order_id = $1 order by created_at`, [o.id])).rows;
    const amount = lines.every((l) => l.price !== null) ? Math.round(lines.reduce((s, l) => s + Number(l.quantity) * Number(l.price), 0) * 100) / 100 : null;
    return { order: { ...o, status_label: ORDER_STATUS[o.status] }, lines, extra, receipts, amount, text: orderText(o, lines) };
  });
}

/** Текст заказа для отправки поставщику (почта, мессенджер) — копируется с экрана. */
function orderText(o: { number: number; site_name: string; supplier: string; expected_at: string | null; note: string | null }, lines: { product: string; quantity: string; unit: string; price: string | null }[]) {
  const exp = o.expected_at ? `\nПоставка: ${new Date(o.expected_at).toLocaleDateString('ru-RU')}` : '';
  return `Заказ № ${o.number} для «${o.supplier}»\nКуда: ${o.site_name}${exp}\n\n` +
    lines.map((l, i) => `${i + 1}. ${l.product} — ${fmtNum(l.quantity)} ${l.unit}${l.price !== null ? ` × ${fmtNum(l.price)} ₽` : ''}`).join('\n') +
    (o.note ? `\n\n${o.note}` : '') + '\n\nПросим подтвердить заказ.';
}

const EditInput = z.object({ lines: z.array(LineIn).max(200).optional(), removeProductIds: z.array(z.uuid()).max(200).optional(),
  expectedAt: z.iso.date().optional().nullable(), note: optText(500) });

/** Изменение черновика: позиции, дата поставки, комментарий. */
export async function editOrder(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(EditInput, input);
  return inOrg(userId, orgId, 'purchase.manage', async (tx, m) => {
    const o = await orderFor(tx, orgId, id, true);
    assertSiteAccess(m, o.site_id);
    if (o.status !== 'draft') throw Errors.conflict('Менять можно только черновик. Отправленный заказ — отмените и создайте новый.');
    for (const l of d.lines || []) await putLine(tx, orgId, o.id, l);
    if (d.removeProductIds?.length) await tx.query(`delete from supplier_order_lines where order_id = $1 and product_id = any($2::uuid[])`, [o.id, d.removeProductIds]);
    if (d.expectedAt !== undefined || d.note !== undefined) await tx.query(`update supplier_orders set expected_at = coalesce($2, expected_at), note = coalesce($3, note) where id = $1`, [o.id, d.expectedAt ?? null, d.note ?? null]);
    await audit.record(tx, { organizationId: orgId, siteId: o.site_id, actorUserId: userId, action: 'purchase.order_edit', entityType: 'supplier_order', entityId: o.id, after: d });
    return { ok: true };
  });
}

const STEP: Record<string, { from: string[]; to: string; action: string }> = {
  send: { from: ['draft'], to: 'sent', action: 'purchase.order_send' },
  confirm: { from: ['sent'], to: 'confirmed', action: 'purchase.order_confirm' },
};

/** Переходы заказа: отправить (из черновика), отметить подтверждение поставщика. */
export async function stepOrder(userId: string, orgId: string, id: string, step: string) {
  const s = STEP[step];
  if (!s) throw Errors.notFound();
  return inOrg(userId, orgId, 'purchase.manage', async (tx, m) => {
    const o = await orderFor(tx, orgId, id, true);
    assertSiteAccess(m, o.site_id);
    if (!s.from.includes(o.status)) throw Errors.conflict(`Заказ уже «${ORDER_STATUS[o.status].toLowerCase()}».`);
    if (step === 'send') {
      if (!(await tx.query(`select 1 from supplier_order_lines where order_id = $1`, [o.id])).rowCount) throw Errors.validation('В заказе нет позиций.');
      await assertSupplierOpen(tx, orgId, o.supplier_id);
      await tx.query(`update supplier_orders set status = 'sent', sent_by = $2, sent_at = now() where id = $1`, [o.id, userId]);
    } else await tx.query(`update supplier_orders set status = 'confirmed', confirmed_at = now() where id = $1`, [o.id]);
    await audit.record(tx, { organizationId: orgId, siteId: o.site_id, actorUserId: userId, action: s.action, entityType: 'supplier_order', entityId: o.id, before: { status: o.status }, after: { status: s.to } });
    return { status: s.to };
  });
}

export async function cancelOrder(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(z.object({ reason: z.string().trim().min(3, 'Укажите причину отмены.').max(300) }), input);
  return inOrg(userId, orgId, 'purchase.manage', async (tx, m) => {
    const o = await orderFor(tx, orgId, id, true);
    assertSiteAccess(m, o.site_id);
    if (!['draft', 'sent', 'confirmed'].includes(o.status)) throw Errors.conflict(`Заказ «${ORDER_STATUS[o.status].toLowerCase()}» — отменить нельзя.`);
    if ((await tx.query(`select 1 from receipts where supplier_order_id = $1 and status = 'draft'`, [o.id])).rowCount) throw Errors.conflict('По заказу идёт приёмка — завершите или удалите её черновик.');
    await tx.query(`update supplier_orders set status = 'cancelled', cancel_reason = $2 where id = $1`, [o.id, d.reason]);
    await audit.record(tx, { organizationId: orgId, siteId: o.site_id, actorUserId: userId, action: 'purchase.order_cancel', entityType: 'supplier_order', entityId: o.id, reason: d.reason });
    return { status: 'cancelled' };
  });
}

/** Начать приёмку по заказу: черновик приёмки с поставщиком заказа (или уже начатый). Проверки — как в обычной приёмке. */
export async function startReceiptFromOrder(userId: string, orgId: string, id: string) {
  return inOrg(userId, orgId, 'receipt.record', async (tx, m) => {
    const o = await orderFor(tx, orgId, id, true);
    assertSiteAccess(m, o.site_id);
    if (!['sent', 'confirmed'].includes(o.status)) throw Errors.conflict(o.status === 'draft' ? 'Сначала отправьте заказ поставщику.' : `Заказ «${ORDER_STATUS[o.status].toLowerCase()}».`);
    const open = (await tx.query(`select id from receipts where supplier_order_id = $1 and status = 'draft'`, [o.id])).rows[0];
    if (open) return { receipt_id: open.id as string, existing: true };
    const r = (await tx.query(`insert into receipts (organization_id, site_id, supplier_id, supplier_order_id, comment, created_by) values ($1, $2, $3, $4, $5, $6) returning id`,
      [orgId, o.site_id, o.supplier_id, o.id, `по заказу № ${o.number}`, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: o.site_id, actorUserId: userId, action: 'receipt.create', entityType: 'receipt', entityId: r.id, after: { supplier_order: o.number } });
    return { receipt_id: r.id as string, existing: false };
  });
}

/** Вызывается при завершении приёмки: заказ переходит в «принят». */
export async function markOrderReceived(tx: Tx, receipt: { id: string; supplier_order_id: string | null }) {
  if (!receipt.supplier_order_id) return;
  await tx.query(`update supplier_orders set status = 'received', receipt_id = $2, received_at = now() where id = $1 and status in ('sent', 'confirmed')`, [receipt.supplier_order_id, receipt.id]);
}

/* ───────────── Поставщики ───────────── */

const SupplierEdit = z.object({
  phone: z.string().trim().max(40).optional().nullable().transform((v) => v || null),
  email: z.string().trim().max(200).optional().nullable().transform((v) => v || null).refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'Проверьте email.'),
  blockedReason: z.string().trim().max(300).optional().nullable().transform((v) => v || null),
});

/** Контакты поставщика и блокировка для заказов (с причиной). */
export async function updateSupplier(userId: string, orgId: string, supplierId: string, input: unknown) {
  const d = parse(SupplierEdit, input);
  return inOrg(userId, orgId, 'catalog.manage', async (tx) => {
    const before = (await tx.query(`select phone, email, blocked_reason from suppliers where id = $1 and organization_id = $2`, [supplierId, orgId])).rows[0];
    if (!before) throw Errors.notFound('Поставщик не найден.');
    if (d.blockedReason !== null && d.blockedReason.length < 5) throw Errors.validation('Причина блокировки — не короче 5 символов.');
    await tx.query(`update suppliers set phone = $2, email = $3, blocked_reason = $4 where id = $1`, [supplierId, d.phone, d.email, d.blockedReason]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'supplier.update', entityType: 'supplier', entityId: supplierId, before, after: d });
    return { ok: true };
  });
}
