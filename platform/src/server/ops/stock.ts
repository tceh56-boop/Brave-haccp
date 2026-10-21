import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText, assertSiteAccess, getSite, closeTasksFor, fmtNum } from './common';
import { assertLotUsable, LOT_STATUS_LABEL } from './lots';

/**
 * Склад (ТЗ v2 §4, §12; v1 §11). Механика MON CHEF «FEFO — единственный путь расхода»:
 *  - расход списывается с годных партий в порядке ближайшего срока годности; карантинные, просроченные,
 *    заблокированные и без подтверждённого срока не участвуют (AT-03);
 *  - остаток не уходит в минус: не хватает — операция отклоняется с указанием доступного количества;
 *  - каждое изменение остатка — движение в неизменяемом журнале; повтор операции с тем же operationId
 *    возвращает прежний результат и не создаёт второе движение (AT-12);
 *  - единицы пересчитываются только по подтверждённому коэффициенту (v1 §6).
 */

const num = z.union([z.number(), z.string().trim().regex(/^\d+([.,]\d+)?$/, 'Введите число.').transform((s) => Number(s.replace(',', '.')))])
  .refine((v) => Number.isFinite(v) && v > 0, 'Количество больше нуля.');
const operationId = z.string().trim().min(8, 'Нужен ключ операции (operationId).').max(100);

/** Выполнить операцию один раз: повтор с тем же ключом возвращает сохранённый результат. */
export async function once<T>(tx: Tx, orgId: string, opId: string, kind: string, userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = (await tx.query(`select kind, result from operations where organization_id = $1 and operation_id = $2`, [orgId, opId])).rows[0];
  if (prev) {
    if (prev.kind !== kind) throw Errors.conflict('Ключ операции уже использован для другой операции.');
    return { ...prev.result, repeated: true } as T;
  }
  const result = await fn();
  await tx.query(`insert into operations (organization_id, operation_id, kind, result, created_by) values ($1, $2, $3, $4, $5)`, [orgId, opId, kind, JSON.stringify(result), userId]);
  return result;
}

interface Move { orgId: string; siteId: string; lotId: string; productId: string; kind: string; quantity: number; unit: string;
  reasonCode?: string | null; reason?: string | null; refType?: string | null; refId?: string | null; operationId?: string | null; fefoOverride?: boolean; userId: string | null }

/** Движение + изменение остатка партии в одной транзакции. */
export async function move(tx: Tx, m: Move) {
  const lot = (await tx.query(`update lots set quantity = quantity + $2,
      status = case when quantity + $2 = 0 and status = 'available' then 'consumed' else status end
    where id = $1 returning quantity, status`, [m.lotId, m.quantity])).rows[0];
  if (!lot) throw Errors.notFound('Партия не найдена.');
  await tx.query(`insert into stock_movements (organization_id, site_id, lot_id, product_id, kind, quantity, unit, reason_code, reason, ref_type, ref_id, operation_id, fefo_override, created_by)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [m.orgId, m.siteId, m.lotId, m.productId, m.kind, m.quantity, m.unit, m.reasonCode || null, m.reason || null, m.refType || null, m.refId || null, m.operationId || null, !!m.fefoOverride, m.userId]);
  return lot;
}

/** Количество в единице товара: та же единица или подтверждённый коэффициент. */
async function toProductUnit(tx: Tx, product: { id: string; unit: string; name: string }, qty: number, unit?: string | null): Promise<number> {
  if (!unit || unit === product.unit) return qty;
  const c = (await tx.query(`select factor from unit_conversions where product_id = $1 and from_unit = $2 and to_unit = $3`, [product.id, unit, product.unit])).rows[0];
  if (c) return qty * Number(c.factor);
  const back = (await tx.query(`select factor from unit_conversions where product_id = $1 and from_unit = $2 and to_unit = $3`, [product.id, product.unit, unit])).rows[0];
  if (back) return qty / Number(back.factor);
  throw Errors.validation(`Нет подтверждённого коэффициента «${unit} → ${product.unit}» для «${product.name}». Укажите количество в ${product.unit} или задайте коэффициент с основанием.`);
}

const USABLE = `l.status = 'available' and l.expires_at is not null and l.expiry_basis is not null and l.expires_at > now() and l.quantity > 0`;

const ConsumeInput = z.object({
  siteId: z.uuid(),
  productId: z.uuid(),
  quantity: num,
  unit: z.enum(['кг', 'г', 'л', 'мл', 'шт']).optional().nullable(),
  purpose: z.string().trim().min(2, 'Укажите назначение расхода.').max(200),
  refType: z.enum(['production', 'sale', 'banquet', 'manual']).default('manual'),
  refId: z.uuid().optional().nullable(),
  lotId: z.uuid().optional().nullable(),
  overrideReason: optText(300),
  operationId,
});

/** Расход по FEFO (или из выбранной партии — с причиной, если есть партия с более ранним сроком). */
export async function consume(userId: string, orgId: string, input: unknown) {
  const d = parse(ConsumeInput, input);
  return inOrg(userId, orgId, 'stock.consume', async (tx) => once(tx, orgId, d.operationId, 'consume', userId, async () => {
    const product = (await tx.query(`select id, name, unit from products where id = $1 and organization_id = $2`, [d.productId, orgId])).rows[0];
    if (!product) throw Errors.notFound('Товар не найден.');
    const need = await toProductUnit(tx, product, d.quantity, d.unit);
    const usable = (await tx.query(`select l.* from lots l where l.organization_id = $1 and l.site_id = $2 and l.product_id = $3 and ${USABLE}
      order by l.expires_at, l.received_at for update`, [orgId, d.siteId, d.productId])).rows;
    let plan: { lot: (typeof usable)[number]; qty: number }[] = [];
    let override = false;
    if (d.lotId) {
      const lot = (await tx.query(`select * from lots where id = $1 and organization_id = $2 and site_id = $3 and product_id = $4 for update`, [d.lotId, orgId, d.siteId, d.productId])).rows[0];
      if (!lot) throw Errors.notFound('Партия не найдена на этой площадке.');
      assertLotUsable(lot);
      if (Number(lot.quantity) < need) throw Errors.conflict(`В партии осталось ${fmtNum(lot.quantity)} ${product.unit}.`);
      const earlier = usable.find((u) => u.id !== lot.id && new Date(u.expires_at) < new Date(lot.expires_at));
      if (earlier) {
        if (!d.overrideReason) throw Errors.validation(`Есть партия с более ранним сроком (${earlier.lot_no || 'без номера'}). По FEFO расходуется она — либо укажите причину выбора этой партии.`);
        override = true;
      }
      plan = [{ lot, qty: need }];
    } else {
      const total = usable.reduce((s, l) => s + Number(l.quantity), 0);
      if (total + 1e-9 < need) throw Errors.conflict(`Недостаточно годного остатка «${product.name}»: доступно ${fmtNum(Math.round(total * 1000) / 1000)} ${product.unit}, нужно ${fmtNum(need)}. Карантинные и просроченные партии не расходуются.`);
      let left = need;
      for (const lot of usable) {
        if (left <= 1e-9) break;
        const q = Math.min(Number(lot.quantity), left);
        plan.push({ lot, qty: q }); left -= q;
      }
    }
    const taken = [];
    for (const p of plan) {
      await move(tx, { orgId, siteId: d.siteId, lotId: p.lot.id, productId: product.id, kind: 'consume', quantity: -p.qty, unit: product.unit,
        reason: d.purpose, refType: d.refType, refId: d.refId || null, operationId: d.operationId, fefoOverride: override, userId,
        reasonCode: override ? 'fefo_override' : null });
      taken.push({ lot_id: p.lot.id, lot_no: p.lot.lot_no, quantity: p.qty, expires_at: p.lot.expires_at });
    }
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: 'stock.consume', entityType: 'product', entityId: product.id,
      after: { quantity: need, unit: product.unit, purpose: d.purpose, lots: taken, fefo_override: override }, reason: d.overrideReason || undefined });
    return { product: product.name, quantity: need, unit: product.unit, lots: taken, fefo_override: override };
  }), d.siteId);
}

export const WRITE_OFF_REASONS = {
  expired: 'Истёк срок годности', spoiled: 'Порча (признаки порчи)', damaged: 'Повреждение упаковки', quality: 'Несоответствие качества',
  quarantine_reject: 'Забракована по карантину', production_loss: 'Технологические потери (по факту)', other: 'Другое',
} as const;

const WriteOffInput = z.object({
  lotId: z.uuid(),
  quantity: num.optional(),                  // не указано — вся партия
  reasonCode: z.enum(Object.keys(WRITE_OFF_REASONS) as [keyof typeof WRITE_OFF_REASONS, ...(keyof typeof WRITE_OFF_REASONS)[]]),
  comment: optText(500),
  operationId,
}).refine((x) => x.reasonCode !== 'other' || !!x.comment, 'Для причины «Другое» опишите причину.');

/** Списание по причине. Разрешено для любой непогашенной партии — в том числе просроченной и карантинной. */
export async function writeOff(userId: string, orgId: string, input: unknown) {
  const d = parse(WriteOffInput, input);
  return inOrg(userId, orgId, 'stock.write_off', async (tx, m) => once(tx, orgId, d.operationId, 'write_off', userId, async () => {
    const lot = (await tx.query(`select l.*, p.name as product from lots l join products p on p.id = l.product_id where l.id = $1 and l.organization_id = $2 for update of l`, [d.lotId, orgId])).rows[0];
    if (!lot) throw Errors.notFound('Партия не найдена.');
    assertSiteAccess(m, lot.site_id);
    if (['consumed', 'written_off'].includes(lot.status) || Number(lot.quantity) <= 0) throw Errors.conflict('Партия уже израсходована или списана.');
    const qty = d.quantity ?? Number(lot.quantity);
    if (qty > Number(lot.quantity) + 1e-9) throw Errors.conflict(`В партии ${fmtNum(lot.quantity)} ${lot.unit} — списать больше нельзя.`);
    const reason = `${WRITE_OFF_REASONS[d.reasonCode]}${d.comment ? `: ${d.comment}` : ''}`;
    await move(tx, { orgId, siteId: lot.site_id, lotId: lot.id, productId: lot.product_id, kind: 'write_off', quantity: -qty, unit: lot.unit,
      reasonCode: d.reasonCode, reason, operationId: d.operationId, userId });
    const rest = Number(lot.quantity) - qty;
    if (rest <= 1e-9) {
      await tx.query(`update lots set status = 'written_off', status_reason = $2 where id = $1`, [lot.id, reason]);
      await closeTasksFor(tx, orgId, 'quarantine_decision', lot.id, userId, `списано: ${reason}`);
      await closeTasksFor(tx, orgId, 'confirm_expiry', lot.id, userId, `списано: ${reason}`);
    }
    // Открытое отклонение по партии не закрывается само: ответственный видит факт списания и подтверждает закрытие.
    const inc = (await tx.query(`select id from incidents where entity_type = 'lot' and entity_id = $1 and status <> 'closed'`, [lot.id])).rows[0];
    if (inc) await tx.query(`insert into incident_events (organization_id, incident_id, user_id, event, note) values ($1, $2, $3, 'write_off', $4)`,
      [orgId, inc.id, userId, `Списано ${fmtNum(qty)} ${lot.unit}: ${reason}`]);
    await audit.record(tx, { organizationId: orgId, siteId: lot.site_id, actorUserId: userId, action: 'stock.write_off', entityType: 'lot', entityId: lot.id,
      before: { quantity: Number(lot.quantity), status: lot.status }, after: { quantity: rest, written_off: qty, reason_code: d.reasonCode }, reason });
    return { lot_id: lot.id, product: lot.product, written_off: qty, unit: lot.unit, rest };
  }));
}

const TransferInput = z.object({ lotId: z.uuid(), toSiteId: z.uuid(), quantity: num.optional(), operationId });

/** Перемещение на другую площадку: на месте назначения — дочерняя партия с теми же сроками и основанием. */
export async function transfer(userId: string, orgId: string, input: unknown) {
  const d = parse(TransferInput, input);
  return inOrg(userId, orgId, 'stock.transfer', async (tx, m) => once(tx, orgId, d.operationId, 'transfer', userId, async () => {
    const lot = (await tx.query(`select * from lots where id = $1 and organization_id = $2 for update`, [d.lotId, orgId])).rows[0];
    if (!lot) throw Errors.notFound('Партия не найдена.');
    assertSiteAccess(m, lot.site_id); assertSiteAccess(m, d.toSiteId);
    if (lot.site_id === d.toSiteId) throw Errors.validation('Партия уже на этой площадке.');
    await getSite(tx, orgId, d.toSiteId);
    assertLotUsable(lot);   // карантинные и просроченные не перемещаются
    const qty = d.quantity ?? Number(lot.quantity);
    if (qty > Number(lot.quantity) + 1e-9) throw Errors.conflict(`В партии ${fmtNum(lot.quantity)} ${lot.unit}.`);
    const child = (await tx.query(`insert into lots (organization_id, site_id, product_id, receipt_line_id, lot_no, quantity, unit, manufactured_at, expires_at, expiry_basis, status, status_reason, unit_price)
      values ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9, 'available', 'перемещение', $10) returning id`,
      [orgId, d.toSiteId, lot.product_id, lot.receipt_line_id, lot.lot_no, lot.unit, lot.manufactured_at, lot.expires_at, lot.expiry_basis, lot.unit_price])).rows[0];
    await tx.query(`insert into lot_links (organization_id, parent_lot_id, child_lot_id, kind, quantity, unit) values ($1, $2, $3, 'transfer', $4, $5)`, [orgId, lot.id, child.id, qty, lot.unit]);
    await move(tx, { orgId, siteId: lot.site_id, lotId: lot.id, productId: lot.product_id, kind: 'transfer_out', quantity: -qty, unit: lot.unit, refType: 'lot', refId: child.id, operationId: d.operationId, userId });
    await move(tx, { orgId, siteId: d.toSiteId, lotId: child.id, productId: lot.product_id, kind: 'transfer_in', quantity: qty, unit: lot.unit, refType: 'lot', refId: lot.id, operationId: d.operationId, userId });
    await audit.record(tx, { organizationId: orgId, siteId: lot.site_id, actorUserId: userId, action: 'stock.transfer', entityType: 'lot', entityId: lot.id, after: { to_site: d.toSiteId, child_lot: child.id, quantity: qty } });
    return { from_lot: lot.id, to_lot: child.id, quantity: qty, unit: lot.unit };
  }));
}

/** Остатки по товарам площадки: годный (доступный к расходу), скоро истекает, карантин, недоступный. */
export async function balances(userId: string, orgId: string, siteId: string) {
  return inOrg(userId, orgId, 'lot.read', async (tx) => (await tx.query(`
    select p.id as product_id, p.name, p.unit, p.category,
      coalesce(sum(l.quantity) filter (where ${USABLE}), 0) as available,
      coalesce(sum(l.quantity) filter (where ${USABLE} and l.expires_at <= now() + interval '24 hours'), 0) as soon,
      coalesce(sum(l.quantity) filter (where l.status = 'quarantine'), 0) as quarantine,
      coalesce(sum(l.quantity) filter (where l.status = 'available' and (l.expires_at is null or l.expiry_basis is null)), 0) as unconfirmed,
      coalesce(sum(l.quantity) filter (where l.status = 'blocked' or (l.status = 'available' and l.expires_at <= now())), 0) as unusable,
      count(*) filter (where l.status in ('available', 'quarantine', 'blocked') and l.quantity > 0)::int as lots,
      min(l.expires_at) filter (where ${USABLE}) as next_expiry
    from products p join lots l on l.product_id = p.id and l.site_id = $2 and l.quantity > 0
    where p.organization_id = $1 group by p.id order by p.name`, [orgId, siteId])).rows, siteId);
}

export async function lotMovements(userId: string, orgId: string, lotId: string) {
  return inOrg(userId, orgId, 'lot.read', async (tx) => (await tx.query(`select m.kind, m.quantity, m.unit, m.reason, m.reason_code, m.ref_type, m.ref_id, m.fefo_override, m.created_at, u.full_name as who
    from stock_movements m left join users u on u.id = m.created_by where m.lot_id = $1 and m.organization_id = $2 order by m.created_at, m.id`, [lotId, orgId])).rows);
}

// ───────── Прослеживаемость ─────────

async function lotNode(tx: Tx, lotId: string) {
  return (await tx.query(`select l.id, l.lot_no, l.quantity, l.unit, l.status, l.expires_at, l.received_at, l.site_id, s.name as site, p.name as product
    from lots l join products p on p.id = l.product_id join sites s on s.id = l.site_id where l.id = $1`, [lotId])).rows[0];
}

/**
 * Прослеживаемость партии (ТЗ v2 §4, AT-13): назад — до поставщика, документа и результатов приёмки;
 * вперёд — расход, списания, перемещения и дочерние партии. В пределах имеющихся данных.
 */
export async function trace(userId: string, orgId: string, lotId: string) {
  return inOrg(userId, orgId, 'trace.read', async (tx) => {
    const start = await lotNode(tx, lotId);
    if (!start) throw Errors.notFound('Партия не найдена.');
    // Назад: родительские партии до исходной принятой.
    const chain = [start];
    for (let cur = start, i = 0; i < 20; i++) {
      const parent = (await tx.query(`select parent_lot_id from lot_links where child_lot_id = $1`, [cur.id])).rows[0];
      if (!parent) break;
      cur = await lotNode(tx, parent.parent_lot_id); chain.unshift(cur);
    }
    const origin = (await tx.query(`select r.id as receipt_id, r.document_no, r.document_date, r.completed_at, sp.name as supplier, sp.inn as supplier_inn,
        rl.checks, rl.temperature, rl.decision, rl.decision_reason, u.full_name as accepted_by
      from lots l join receipt_lines rl on rl.id = l.receipt_line_id join receipts r on r.id = rl.receipt_id
      left join suppliers sp on sp.id = r.supplier_id left join users u on u.id = r.completed_by where l.id = $1`, [chain[0].id])).rows[0] || null;
    // Вперёд: дерево дочерних партий с движениями.
    const forward = async (id: string, depth: number): Promise<unknown> => {
      const node = await lotNode(tx, id);
      const moves = (await tx.query(`select kind, quantity, unit, reason, ref_type, ref_id, created_at from stock_movements where lot_id = $1 order by created_at, id`, [id])).rows;
      const kids = depth > 10 ? [] : (await tx.query(`select child_lot_id, kind, quantity from lot_links where parent_lot_id = $1`, [id])).rows;
      return { ...node, status_label: LOT_STATUS_LABEL[node.status], movements: moves, children: await Promise.all(kids.map((k) => forward(k.child_lot_id, depth + 1))) };
    };
    return { origin, ancestry: chain.slice(0, -1), lot: await forward(lotId, 0) };
  });
}

/** Все партии поставщика с текущим состоянием — для проверки и отзыва (ТЗ v1 §10 «учение по отзыву»). */
export async function lotsBySupplier(userId: string, orgId: string, supplierId: string) {
  return inOrg(userId, orgId, 'trace.read', async (tx) => (await tx.query(`select l.id, l.lot_no, l.quantity, l.unit, l.status, l.expires_at, l.received_at, p.name as product, s.name as site,
      r.document_no, (select coalesce(sum(-m.quantity), 0) from stock_movements m where m.lot_id = l.id and m.kind = 'consume') as consumed
    from lots l join receipt_lines rl on rl.id = l.receipt_line_id join receipts r on r.id = rl.receipt_id join products p on p.id = l.product_id join sites s on s.id = l.site_id
    where r.supplier_id = $1 and l.organization_id = $2 order by l.received_at desc`, [supplierId, orgId])).rows);
}

// ───────── Инвентаризация ─────────

export async function startCount(userId: string, orgId: string, input: unknown) {
  const d = parse(z.object({ siteId: z.uuid(), comment: optText(300) }), input);
  return inOrg(userId, orgId, 'stock.count', async (tx) => {
    await getSite(tx, orgId, d.siteId);
    if ((await tx.query(`select 1 from stock_counts where site_id = $1 and status = 'open'`, [d.siteId])).rowCount) throw Errors.conflict('На площадке уже идёт инвентаризация.');
    const c = (await tx.query(`insert into stock_counts (organization_id, site_id, comment, created_by) values ($1, $2, $3, $4) returning *`, [orgId, d.siteId, d.comment, userId])).rows[0];
    const n = (await tx.query(`insert into stock_count_lines (organization_id, count_id, lot_id, expected)
      select $1, $2, id, quantity from lots where site_id = $3 and status in ('available', 'quarantine', 'blocked') and quantity > 0`, [orgId, c.id, d.siteId])).rowCount;
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: 'stock.count_start', entityType: 'stock_count', entityId: c.id, after: { lines: n } });
    return { ...c, lines: n };
  }, d.siteId);
}

export async function getOpenCount(userId: string, orgId: string, siteId: string) {
  return inOrg(userId, orgId, 'lot.read', async (tx) => (await tx.query(`select id, created_at from stock_counts where site_id = $1 and organization_id = $2 and status = 'open'`, [siteId, orgId])).rows[0] || null, siteId);
}

export async function getCount(userId: string, orgId: string, countId: string) {
  return inOrg(userId, orgId, 'lot.read', async (tx, m) => {
    const c = (await tx.query(`select c.*, s.name as site from stock_counts c join sites s on s.id = c.site_id where c.id = $1 and c.organization_id = $2`, [countId, orgId])).rows[0];
    if (!c) throw Errors.notFound('Инвентаризация не найдена.');
    assertSiteAccess(m, c.site_id);
    const lines = (await tx.query(`select cl.*, l.lot_no, l.unit, l.status, l.expires_at, p.name as product from stock_count_lines cl join lots l on l.id = cl.lot_id join products p on p.id = l.product_id
      where cl.count_id = $1 order by p.name, l.expires_at`, [countId])).rows;
    return { count: c, lines };
  });
}

export async function setCountLine(userId: string, orgId: string, countId: string, lineId: string, input: unknown) {
  const d = parse(z.object({ counted: z.union([z.number(), z.string().trim().regex(/^\d+([.,]\d+)?$/).transform((s) => Number(s.replace(',', '.')))]).refine((v) => v >= 0), note: optText(300) }), input);
  return inOrg(userId, orgId, 'stock.count', async (tx) => {
    const c = (await tx.query(`select status from stock_counts where id = $1 and organization_id = $2`, [countId, orgId])).rows[0];
    if (!c) throw Errors.notFound('Инвентаризация не найдена.');
    if (c.status !== 'open') throw Errors.conflict('Инвентаризация закрыта.');
    const l = (await tx.query(`update stock_count_lines set counted = $3, note = $4, counted_by = $5, counted_at = now() where id = $1 and count_id = $2 returning *`, [lineId, countId, d.counted, d.note, userId])).rows[0];
    if (!l) throw Errors.notFound('Строка не найдена.');
    return l;
  });
}

/** Закрытие: расхождения проводятся корректирующими движениями с причиной; непосчитанные строки не меняются. */
export async function closeCount(userId: string, orgId: string, countId: string) {
  return inOrg(userId, orgId, 'stock.count', async (tx) => {
    const c = (await tx.query(`select * from stock_counts where id = $1 and organization_id = $2 for update`, [countId, orgId])).rows[0];
    if (!c) throw Errors.notFound('Инвентаризация не найдена.');
    if (c.status !== 'open') throw Errors.conflict('Инвентаризация уже закрыта.');
    const lines = (await tx.query(`select cl.*, l.product_id, l.unit, l.quantity as current from stock_count_lines cl join lots l on l.id = cl.lot_id where cl.count_id = $1 for update of l`, [countId])).rows;
    const pending = lines.filter((l) => l.counted === null).length;
    if (pending) throw Errors.validation(`Не посчитано строк: ${pending}. Внесите фактическое количество (0 — если партии нет).`);
    let adjusted = 0;
    for (const l of lines) {
      // Разница считается от остатка в момент закрытия: движения во время подсчёта не теряются.
      const diff = Number(l.counted) - Number(l.expected);
      if (Math.abs(diff) < 1e-9) continue;
      if (Number(l.current) + diff < -1e-9) throw Errors.conflict('Остаток партии изменился во время инвентаризации — пересчитайте строку.');
      await move(tx, { orgId, siteId: c.site_id, lotId: l.lot_id, productId: l.product_id, kind: 'count_adjust', quantity: diff, unit: l.unit,
        reasonCode: diff < 0 ? 'shortage' : 'surplus', reason: `Инвентаризация: ${diff < 0 ? 'недостача' : 'излишек'}${l.note ? ` — ${l.note}` : ''}`, refType: 'stock_count', refId: countId, userId });
      adjusted++;
    }
    await tx.query(`update stock_counts set status = 'closed', closed_by = $2, closed_at = now() where id = $1`, [countId, userId]);
    await audit.record(tx, { organizationId: orgId, siteId: c.site_id, actorUserId: userId, action: 'stock.count_close', entityType: 'stock_count', entityId: countId, after: { lines: lines.length, adjusted } });
    return { lines: lines.length, adjusted };
  });
}

// ───────── Коэффициенты единиц ─────────

const ConvInput = z.object({
  productId: z.uuid(), fromUnit: z.enum(['кг', 'г', 'л', 'мл', 'шт']), toUnit: z.enum(['кг', 'г', 'л', 'мл', 'шт']),
  factor: num, source: z.string().trim().min(5, 'Укажите основание коэффициента: контрольное взвешивание, спецификация, маркировка.').max(300),
}).refine((x) => x.fromUnit !== x.toUnit, 'Единицы совпадают.');

export async function setUnitConversion(userId: string, orgId: string, input: unknown) {
  const d = parse(ConvInput, input);
  return inOrg(userId, orgId, 'catalog.manage', async (tx) => {
    if (!(await tx.query(`select 1 from products where id = $1 and organization_id = $2`, [d.productId, orgId])).rowCount) throw Errors.notFound('Товар не найден.');
    const r = (await tx.query(`insert into unit_conversions (organization_id, product_id, from_unit, to_unit, factor, source, confirmed_by) values ($1, $2, $3, $4, $5, $6, $7)
      on conflict (product_id, from_unit, to_unit) do update set factor = excluded.factor, source = excluded.source, confirmed_by = excluded.confirmed_by, created_at = now() returning *`,
      [orgId, d.productId, d.fromUnit, d.toUnit, d.factor, d.source, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'catalog.unit_conversion', entityType: 'product', entityId: d.productId, after: { from: d.fromUnit, to: d.toUnit, factor: d.factor, source: d.source } });
    return r;
  });
}
