import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, assertSiteAccess, closeTasksFor } from './common';
import { raiseIncident } from './incidents';

/**
 * Партии и сроки годности (ТЗ v2 §3 «Срок годности», §4, §6).
 * Статус срока: «В норме», «Скоро истекает», «Истёк», «Срок не подтверждён». Срок считается только по
 * утверждённому основанию (маркировка изготовителя и т.п.); без основания система срок не назначает.
 * Расчёт срока после вскрытия/приготовления подключается правилами сроков (этап 3).
 */

export const SOON_HOURS = 24;

export type ExpiryState = 'ok' | 'soon' | 'expired' | 'unconfirmed';
export const EXPIRY_LABEL: Record<ExpiryState, string> = { ok: 'В норме', soon: 'Скоро истекает', expired: 'Истёк', unconfirmed: 'Срок не подтверждён' };
export const LOT_STATUS_LABEL: Record<string, string> = { available: 'Доступна', quarantine: 'Карантин', blocked: 'Заблокирована', consumed: 'Израсходована', written_off: 'Списана' };

export function expiryState(lot: { expires_at: string | Date | null; expiry_basis?: string | null }, now = new Date(), soonHours = SOON_HOURS): ExpiryState {
  if (!lot.expires_at || !lot.expiry_basis) return 'unconfirmed';
  const t = new Date(lot.expires_at).getTime();
  if (t <= now.getTime()) return 'expired';
  if (t - now.getTime() <= soonHours * 3600e3) return 'soon';
  return 'ok';
}

/**
 * Можно ли использовать партию (расход, производство, отпуск) — AT-03. Просроченная, карантинная,
 * заблокированная и партия без подтверждённого срока не используются.
 */
export function assertLotUsable(lot: { status: string; expires_at: string | Date | null; expiry_basis?: string | null }, now = new Date()) {
  if (lot.status === 'quarantine') throw Errors.forbidden('Партия в карантине — использовать нельзя до решения ответственного.');
  if (lot.status !== 'available') throw Errors.forbidden(`Партия недоступна: ${LOT_STATUS_LABEL[lot.status] || lot.status}.`);
  const st = expiryState(lot, now);
  if (st === 'expired') throw Errors.forbidden('Срок годности партии истёк — использовать нельзя.');
  if (st === 'unconfirmed') throw Errors.forbidden('Срок годности партии не подтверждён — использовать нельзя до подтверждения.');
}

export async function listLots(userId: string, orgId: string, siteId: string, opts: { state?: ExpiryState | 'quarantine' } = {}) {
  return inOrg(userId, orgId, 'lot.read', async (tx) => {
    const rows = (await tx.query(`select l.*, p.name as product, o.name as storage_name from lots l join products p on p.id = l.product_id
      left join control_objects o on o.id = l.storage_object_id
      where l.organization_id = $1 and l.site_id = $2 and l.status in ('available', 'quarantine', 'blocked') order by l.expires_at nulls first, p.name`, [orgId, siteId])).rows;
    const now = new Date();
    return rows.map((l) => ({ ...l, expiry_state: expiryState(l, now), expiry_label: EXPIRY_LABEL[expiryState(l, now)], status_label: LOT_STATUS_LABEL[l.status] }))
      .filter((l) => !opts.state || (opts.state === 'quarantine' ? l.status === 'quarantine' : l.expiry_state === opts.state));
  }, siteId);
}

/**
 * Сведения карточки / этикетки партии (ТЗ доработки 6.2). Происхождение — по корневой партии (вскрытие и перемещение
 * наследуют приёмку или выпуск). Чего нет в данных — null: система не подставляет догадки.
 */
export async function lotCard(tx: Tx, orgId: string, l: Record<string, any>) {
  const root = (await tx.query(`with recursive up(id, depth) as (select $1::uuid, 0 union all
      select k.parent_lot_id, up.depth + 1 from lot_links k join up on k.child_lot_id = up.id where k.kind in ('opened', 'transfer') and up.depth < 20)
    select id from up order by depth desc limit 1`, [l.id])).rows[0].id as string;
  const rl = (await tx.query(`select rl.manufacturer, rl.vsd_no, rl.storage_conditions, r.id as receipt_id, r.document_no, r.document_date, r.completed_at, sp.name as supplier
    from lots x join receipt_lines rl on rl.id = x.receipt_line_id join receipts r on r.id = rl.receipt_id left join suppliers sp on sp.id = r.supplier_id where x.id = $1`, [root])).rows[0];
  const po = (await tx.query(`select o.id as order_id, o.completed_at, d.id as dish_id, d.name as dish, d.kind as dish_kind, d.card_no, v.version, v.allergens, v.storage_conditions,
      v.id as ttk_version_id, org.name as org_name, org.legal_address
    from production_orders o join dishes d on d.id = o.dish_id join ttk_versions v on v.id = o.ttk_version_id join organizations org on org.id = o.organization_id
    where o.output_lot_id = $1 and o.organization_id = $2`, [root, orgId])).rows[0];
  let composition: string[] | null = null;
  if (po?.dish_kind === 'dish') composition = (await tx.query(`select coalesce(p.name, sd.name, l.name_raw) as name from ttk_lines l left join products p on p.id = l.product_id
      left join dishes sd on sd.id = l.sub_dish_id where l.version_id = $1 and l.kind = 'item' order by l.netto desc nulls last, l.position`, [po.ttk_version_id])).rows.map((r: { name: string }) => r.name as string);
  const afterOpening = l.opened_shelf_hours ? { hours: Number(l.opened_shelf_hours), basis: l.opened_shelf_basis as string } : null;
  return {
    product: l.product, lot_no: l.lot_no,
    manufacturer: po ? [po.org_name, po.legal_address].filter(Boolean).join(', ') : rl?.manufacturer || null,
    supplier: po ? null : rl?.supplier || null,
    manufactured_at: l.manufactured_at, received_at: po ? null : l.received_at, expires_at: l.expires_at, expiry_basis: l.expiry_basis,
    after_opening: afterOpening, opened_at: l.opened_at,
    storage_conditions: l.storage_conditions || rl?.storage_conditions || po?.storage_conditions || null,
    quantity: l.quantity, unit: l.unit, storage_place: l.storage_name || null, status: LOT_STATUS_LABEL[l.status],
    receipt: rl ? { id: rl.receipt_id, date: rl.completed_at, document_no: rl.document_no, document_date: rl.document_date } : null,
    vsd_no: rl?.vsd_no || null,
    ttk: po ? { dish_id: po.dish_id, card_no: po.card_no, version: po.version, label: `ТТК${po.card_no ? ` № ${po.card_no}` : ''} «${po.dish}», версия ${po.version}` } : null,
    allergens: po?.dish_kind === 'dish' ? po.allergens || null : null, composition,
    origin: po ? 'production' : rl ? 'receipt' : 'unknown',
  };
}

export async function getLot(userId: string, orgId: string, lotId: string) {
  return inOrg(userId, orgId, 'lot.read', async (tx, m) => {
    const l = (await tx.query(`select l.*, p.name as product, p.opened_shelf_hours, p.opened_shelf_basis, o.name as storage_name, s.name as site_name, r.document_no, sp.name as supplier
      from lots l join products p on p.id = l.product_id join sites s on s.id = l.site_id left join control_objects o on o.id = l.storage_object_id
      left join receipt_lines rl on rl.id = l.receipt_line_id left join receipts r on r.id = rl.receipt_id left join suppliers sp on sp.id = r.supplier_id
      where l.id = $1 and l.organization_id = $2`, [lotId, orgId])).rows[0];
    if (!l) throw Errors.notFound('Партия не найдена.');
    assertSiteAccess(m, l.site_id);
    const tasks = (await tx.query(`select id, kind, title, status from tasks where entity_id = $1 and status = 'open'`, [lotId])).rows;
    // вскрытие: из какой партии вскрыта эта и какие вскрытые партии получены из неё; последняя этикетка
    const openedFrom = (await tx.query(`select k.parent_lot_id as id, pl.lot_no from lot_links k join lots pl on pl.id = k.parent_lot_id where k.child_lot_id = $1 and k.kind = 'opened'`, [lotId])).rows[0] || null;
    const opened = (await tx.query(`select k.child_lot_id as id, k.quantity, k.unit, cl.opened_at, cl.expires_at, cl.status from lot_links k join lots cl on cl.id = k.child_lot_id
      where k.parent_lot_id = $1 and k.kind = 'opened' order by cl.opened_at desc`, [lotId])).rows;
    const label = (await tx.query(`select lb.id, lb.code, lb.created_at, (select coalesce(sum(copies), 0)::int from label_prints p where p.label_id = lb.id) as printed
      from labels lb where lb.lot_id = $1 order by lb.created_at desc limit 1`, [lotId])).rows[0] || null;
    const st = expiryState(l);
    const card = await lotCard(tx, orgId, l);
    return { lot: { ...l, expiry_state: st, expiry_label: EXPIRY_LABEL[st], status_label: LOT_STATUS_LABEL[l.status] }, tasks, opened_from: openedFrom, opened, label, card };
  });
}

const ExpiryInput = z.object({
  expiresAt: z.iso.datetime({ offset: true }),
  basis: z.string().trim().min(5, 'Укажите основание срока: маркировка изготовителя, удостоверение качества, утверждённое правило.').max(300),
});

/** Подтверждение срока по основанию (задача «Срок не подтверждён»). Изменение аудируется. */
export async function confirmLotExpiry(userId: string, orgId: string, lotId: string, input: unknown) {
  const d = parse(ExpiryInput, input);
  return inOrg(userId, orgId, 'receipt.decide', async (tx, m) => {
    const l = (await tx.query(`select * from lots where id = $1 and organization_id = $2 for update`, [lotId, orgId])).rows[0];
    if (!l) throw Errors.notFound('Партия не найдена.');
    assertSiteAccess(m, l.site_id);
    const after = (await tx.query(`update lots set expires_at = $2, expiry_basis = $3 where id = $1 returning *`, [lotId, d.expiresAt, d.basis])).rows[0];
    await closeTasksFor(tx, orgId, 'confirm_expiry', lotId, userId, `срок подтверждён: ${d.basis}`);
    await audit.record(tx, { organizationId: orgId, siteId: l.site_id, actorUserId: userId, action: 'lot.expiry_confirm', entityType: 'lot', entityId: lotId,
      before: { expires_at: l.expires_at, expiry_basis: l.expiry_basis }, after: { expires_at: after.expires_at, expiry_basis: after.expiry_basis } });
    return after;
  });
}

const DecisionInput = z.object({
  decision: z.enum(['release', 'reject']),
  reason: z.string().trim().min(5, 'Укажите основание решения.').max(500),
});

/** Решение по карантину: допустить (только с основанием) или забраковать. */
export async function decideQuarantine(userId: string, orgId: string, lotId: string, input: unknown) {
  const d = parse(DecisionInput, input);
  return inOrg(userId, orgId, 'receipt.decide', async (tx, m) => {
    const l = (await tx.query(`select * from lots where id = $1 and organization_id = $2 for update`, [lotId, orgId])).rows[0];
    if (!l) throw Errors.notFound('Партия не найдена.');
    assertSiteAccess(m, l.site_id);
    if (l.status !== 'quarantine') throw Errors.conflict('Партия не в карантине.');
    const status = d.decision === 'release' ? 'available' : 'blocked';
    await tx.query(`update lots set status = $2, status_reason = $3 where id = $1`, [lotId, status, d.reason]);
    await closeTasksFor(tx, orgId, 'quarantine_decision', lotId, userId, d.reason);
    await audit.record(tx, { organizationId: orgId, siteId: l.site_id, actorUserId: userId, action: d.decision === 'release' ? 'lot.release' : 'lot.reject',
      entityType: 'lot', entityId: lotId, before: { status: l.status }, after: { status }, reason: d.reason });
    return { status };
  });
}

/** Просроченные доступные партии → отклонение «Истёк срок» и блокировка (вызывается при открытии смены/дашборда). */
export async function sweepExpiredLots(userId: string, orgId: string, siteId: string) {
  return inOrg(userId, orgId, 'lot.read', async (tx) => {
    const expired = (await tx.query(`select l.id, l.lot_no, p.name as product from lots l join products p on p.id = l.product_id
      where l.organization_id = $1 and l.site_id = $2 and l.status = 'available' and l.expires_at is not null and l.expires_at <= now() for update of l`, [orgId, siteId])).rows;
    for (const l of expired) {
      await tx.query(`update lots set status = 'blocked', status_reason = 'истёк срок годности' where id = $1`, [l.id]);
      await raiseIncident(tx, { orgId, siteId, severity: 'high', kind: 'expired_lot', title: `Истёк срок: ${l.product}`, what: `Партия ${l.lot_no || 'без номера'} — срок годности истёк, партия заблокирована.`,
        entityType: 'lot', entityId: l.id, responsibleRole: 'chef', dueMinutes: 120, recommendedAction: 'Убрать продукт из оборота и оформить списание по утверждённой процедуре.', notify: ['chef', 'storekeeper'] });
      await audit.record(tx, { organizationId: orgId, siteId, actorUserId: null, action: 'lot.auto_block_expired', entityType: 'lot', entityId: l.id, after: { status: 'blocked' } });
    }
    return expired.length;
  }, siteId);
}
