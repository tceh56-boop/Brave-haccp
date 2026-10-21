import { randomInt } from 'node:crypto';
import { z } from 'zod';
import type { Tx } from '../db/pool';
import { withSystem } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, assertSiteAccess, fmtNum } from './common';
import { once, move } from './stock';
import { assertLotUsable, expiryState, EXPIRY_LABEL, LOT_STATUS_LABEL } from './lots';

/**
 * Маркировка (этап 9; перенос Labeling.gs прежнего ЦЕХ и MON CHEF 8.1–8.2).
 *  - Этикетка — неизменяемый снимок партии на момент печати: товар, партия, даты, срок с основанием.
 *    Если партию использовать нельзя (карантин, срок не подтверждён, истёк), это печатается на этикетке.
 *  - QR ведёт на карточку партии по короткому коду (/l/КОД); без входа и без права код ничего не раскрывает.
 *  - Журнал маркировки — каждая печать: сколько копий, формат, кто, когда.
 *  - Вскрытие тары — дочерняя партия с новым сроком: раньше из срока изготовителя и «вскрыто + N ч».
 *    N берётся из правила товара (с основанием) или вводится с маркировки при вскрытии; без основания — отказ.
 */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // без I, O, 0, 1 — не путаются при ручном вводе
const newCode = () => Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

export const LABEL_FORMATS = { '58x40': 'Термоэтикетка 58×40 мм', '58x30': 'Термоэтикетка 58×30 мм', a4: 'Лист A4, 24 наклейки 70×37 мм' } as const;

const num = z.union([z.number(), z.string().trim().regex(/^\d+([.,]\d+)?$/, 'Введите число.').transform((s) => Number(s.replace(',', '.')))])
  .refine((v) => Number.isFinite(v) && v > 0, 'Значение больше нуля.');

interface LotRow { id: string; site_id: string; product: string; lot_no: string | null; quantity: string; unit: string; manufactured_at: string | null; received_at: string;
  opened_at: string | null; expires_at: string | null; expiry_basis: string | null; status: string; site_name: string; storage_name: string | null; supplier: string | null }

async function lotForLabel(tx: Tx, orgId: string, lotId: string): Promise<LotRow> {
  const l = (await tx.query(`select l.*, p.name as product, s.name as site_name, o.name as storage_name, sp.name as supplier
    from lots l join products p on p.id = l.product_id join sites s on s.id = l.site_id left join control_objects o on o.id = l.storage_object_id
    left join receipt_lines rl on rl.id = l.receipt_line_id left join receipts r on r.id = rl.receipt_id left join suppliers sp on sp.id = r.supplier_id
    where l.id = $1 and l.organization_id = $2`, [lotId, orgId])).rows[0];
  if (!l) throw Errors.notFound('Партия не найдена.');
  return l;
}

/** Что печатается на этикетке. Предупреждение — если партию сейчас использовать нельзя. */
function payloadOf(l: LotRow, now = new Date()) {
  const st = expiryState(l, now);
  const warning = l.status === 'quarantine' ? 'КАРАНТИН — НЕ ИСПОЛЬЗОВАТЬ'
    : l.status !== 'available' ? `${(LOT_STATUS_LABEL[l.status] || l.status).toUpperCase()} — НЕ ИСПОЛЬЗОВАТЬ`
    : st === 'unconfirmed' ? 'СРОК НЕ ПОДТВЕРЖДЁН — НЕ ИСПОЛЬЗОВАТЬ'
    : st === 'expired' ? 'СРОК ИСТЁК — НЕ ИСПОЛЬЗОВАТЬ' : null;
  return {
    product: l.product, lot_no: l.lot_no, quantity: Number(l.quantity), unit: l.unit,
    manufactured_at: l.manufactured_at, received_at: l.received_at, opened_at: l.opened_at,
    expires_at: l.expires_at, expiry_basis: l.expiry_basis, expiry_label: EXPIRY_LABEL[st], status: l.status, warning,
    site: l.site_name, storage: l.storage_name, supplier: l.supplier,
  };
}

const sameLabel = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  ['product', 'lot_no', 'expires_at', 'expiry_basis', 'opened_at', 'warning', 'storage'].every((k) => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null));

async function makeLabel(tx: Tx, orgId: string, userId: string, l: LotRow) {
  const payload = payloadOf(l);
  const last = (await tx.query(`select id, code, payload from labels where lot_id = $1 order by created_at desc limit 1`, [l.id])).rows[0];
  if (last && sameLabel(last.payload, payload)) return { id: last.id as string, code: last.code as string, reused: true };
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    const r = await tx.query(`insert into labels (organization_id, site_id, lot_id, code, kind, payload, created_by) values ($1, $2, $3, $4, $5, $6, $7)
      on conflict (code) do nothing returning id, code`, [orgId, l.site_id, l.id, code, l.opened_at ? 'opened' : 'lot', JSON.stringify(payload), userId]);
    if (r.rows[0]) return { ...r.rows[0], reused: false } as { id: string; code: string; reused: boolean };
  }
  throw Errors.conflict('Не удалось выдать код этикетки — повторите.');
}

const LabelsInput = z.object({ lotIds: z.array(z.uuid()).min(1, 'Выберите партии.').max(100, 'Не больше 100 партий за раз.') });

/** Этикетки для партий: та же этикетка, если данные партии не изменились, иначе — новая с новым кодом. */
export async function createLabels(userId: string, orgId: string, input: unknown) {
  const d = parse(LabelsInput, input);
  return inOrg(userId, orgId, 'label.print', async (tx, m) => {
    const out = [];
    for (const id of [...new Set(d.lotIds)]) {
      const l = await lotForLabel(tx, orgId, id);
      assertSiteAccess(m, l.site_id);
      out.push(await makeLabel(tx, orgId, userId, l));
    }
    return out;
  });
}

export async function getLabels(userId: string, orgId: string, ids: string[]) {
  const list = parse(z.array(z.uuid()).min(1).max(100), ids);
  return inOrg(userId, orgId, 'lot.read', async (tx, m) => {
    const rows = (await tx.query(`select lb.id, lb.code, lb.kind, lb.lot_id, lb.site_id, lb.payload, lb.created_at, u.full_name as created_by_name,
        (select coalesce(sum(copies), 0)::int from label_prints p where p.label_id = lb.id) as printed
      from labels lb left join users u on u.id = lb.created_by where lb.organization_id = $1 and lb.id = any($2::uuid[])`, [orgId, list])).rows;
    rows.forEach((r) => assertSiteAccess(m, r.site_id));
    return list.map((id) => rows.find((r) => r.id === id)).filter(Boolean);
  });
}

const PrintInput = z.object({
  labelIds: z.array(z.uuid()).min(1).max(100),
  format: z.enum(Object.keys(LABEL_FORMATS) as [keyof typeof LABEL_FORMATS, ...(keyof typeof LABEL_FORMATS)[]]),
  copies: z.coerce.number().int().min(1, 'Копий — от 1.').max(100, 'Копий — не больше 100.'),
});

/** Запись в журнал маркировки перед отправкой на принтер. */
export async function logPrint(userId: string, orgId: string, input: unknown) {
  const d = parse(PrintInput, input);
  return inOrg(userId, orgId, 'label.print', async (tx, m) => {
    const labels = (await tx.query(`select id, site_id, lot_id from labels where organization_id = $1 and id = any($2::uuid[])`, [orgId, d.labelIds])).rows;
    if (labels.length !== new Set(d.labelIds).size) throw Errors.notFound('Этикетка не найдена.');
    for (const lb of labels) {
      assertSiteAccess(m, lb.site_id);
      await tx.query(`insert into label_prints (organization_id, site_id, label_id, copies, format, printed_by) values ($1, $2, $3, $4, $5, $6)`,
        [orgId, lb.site_id, lb.id, d.copies, d.format, userId]);
    }
    await audit.record(tx, { organizationId: orgId, siteId: labels[0].site_id, actorUserId: userId, action: 'label.print', entityType: 'lot', entityId: labels[0].lot_id,
      after: { labels: labels.length, copies: d.copies, format: d.format } });
    return { printed: labels.length * d.copies };
  });
}

/** Журнал маркировки площадки за период. */
export async function labelLog(userId: string, orgId: string, siteId: string, days = 7) {
  const period = Math.min(Math.max(Math.trunc(days) || 7, 1), 92);
  parse(z.uuid({ message: 'Выберите площадку.' }), siteId);
  return inOrg(userId, orgId, 'lot.read', async (tx) => (await tx.query(`
    select pr.id, pr.printed_at, pr.copies, pr.format, u.full_name as printed_by, lb.id as label_id, lb.code, lb.kind, lb.lot_id,
      lb.payload->>'product' as product, lb.payload->>'lot_no' as lot_no, lb.payload->>'expires_at' as expires_at, lb.payload->>'warning' as warning
    from label_prints pr join labels lb on lb.id = pr.label_id join users u on u.id = pr.printed_by
    where pr.organization_id = $1 and pr.site_id = $2 and pr.printed_at >= now() - make_interval(days => $3)
    order by pr.printed_at desc limit 500`, [orgId, siteId, period])).rows, siteId);
}

/** Код с этикетки → партия. Сначала находим организацию кода, затем проверяем право пользователя в ней. */
export async function resolveLabelCode(userId: string, code: string) {
  const c = String(code || '').trim().toUpperCase();
  if (!/^[A-Z2-9]{8}$/.test(c)) throw Errors.notFound('Этикетка не найдена.');
  const lb = await withSystem(async (tx) => (await tx.query(`select organization_id, lot_id, site_id from labels where code = $1`, [c])).rows[0]);
  if (!lb) throw Errors.notFound('Этикетка не найдена.');
  return inOrg(userId, lb.organization_id, 'lot.read', async (_tx, m) => {
    assertSiteAccess(m, lb.site_id);
    return { orgId: lb.organization_id as string, lotId: lb.lot_id as string };
  });
}

const OpenInput = z.object({
  quantity: num.optional(),                                    // не указано — вся партия
  hours: num.optional(),                                       // не указано — по правилу товара
  basis: z.string().trim().max(300).optional().nullable().transform((v) => v || null),
  operationId: z.string().trim().min(8).max(100),
});

/** Вскрытие тары: дочерняя партия с новым сроком и этикеткой. */
export async function openLot(userId: string, orgId: string, lotId: string, input: unknown) {
  const d = parse(OpenInput, input);
  return inOrg(userId, orgId, 'lot.open', async (tx, m) => once(tx, orgId, d.operationId, 'lot_open', userId, async () => {
    const lot = (await tx.query(`select l.*, p.name as product, p.opened_shelf_hours, p.opened_shelf_basis from lots l join products p on p.id = l.product_id
      where l.id = $1 and l.organization_id = $2 for update of l`, [lotId, orgId])).rows[0];
    if (!lot) throw Errors.notFound('Партия не найдена.');
    assertSiteAccess(m, lot.site_id);
    if (lot.opened_at) throw Errors.conflict('Эта тара уже вскрыта — срок после вскрытия уже назначен.');
    assertLotUsable(lot);                       // карантинную, просроченную и без подтверждённого срока не вскрывают
    let hours = d.hours ?? null, basis = d.basis;
    if (hours === null) {
      if (!lot.opened_shelf_hours) throw Errors.validation(`Для «${lot.product}» не задан срок после вскрытия. Укажите его и основание с маркировки изготовителя («после вскрытия хранить …»).`);
      hours = Number(lot.opened_shelf_hours); basis = basis || lot.opened_shelf_basis;
    }
    if (!basis || basis.length < 5) throw Errors.validation('Укажите основание срока после вскрытия: маркировка изготовителя или утверждённое правило.');
    const qty = d.quantity ?? Number(lot.quantity);
    if (qty > Number(lot.quantity) + 1e-9) throw Errors.conflict(`В партии ${fmtNum(lot.quantity)} ${lot.unit} — вскрыть больше нельзя.`);
    const now = new Date();
    const byOpening = new Date(now.getTime() + hours * 3600e3);
    const makerFirst = new Date(lot.expires_at) < byOpening;
    const expiresAt = makerFirst ? new Date(lot.expires_at) : byOpening;
    const expiryBasis = makerFirst
      ? `срок изготовителя наступает раньше, чем ${fmtNum(hours)} ч после вскрытия (${basis})`
      : `после вскрытия ${fmtNum(hours)} ч: ${basis}`;
    const child = (await tx.query(`insert into lots (organization_id, site_id, product_id, receipt_line_id, lot_no, quantity, unit, manufactured_at, expires_at, expiry_basis,
        storage_object_id, status, status_reason, unit_price, opened_at)
      values ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9, $10, 'available', 'вскрытая тара', $11, $12) returning id`,
      [orgId, lot.site_id, lot.product_id, lot.receipt_line_id, lot.lot_no, lot.unit, lot.manufactured_at, expiresAt, expiryBasis, lot.storage_object_id, lot.unit_price, now])).rows[0];
    await tx.query(`insert into lot_links (organization_id, parent_lot_id, child_lot_id, kind, quantity, unit) values ($1, $2, $3, 'opened', $4, $5)`, [orgId, lot.id, child.id, qty, lot.unit]);
    await move(tx, { orgId, siteId: lot.site_id, lotId: lot.id, productId: lot.product_id, kind: 'open_out', quantity: -qty, unit: lot.unit, refType: 'lot', refId: child.id, operationId: d.operationId, userId, reason: 'вскрытие тары' });
    await move(tx, { orgId, siteId: lot.site_id, lotId: child.id, productId: lot.product_id, kind: 'open_in', quantity: qty, unit: lot.unit, refType: 'lot', refId: lot.id, operationId: d.operationId, userId, reason: 'вскрытие тары' });
    const label = await makeLabel(tx, orgId, userId, await lotForLabel(tx, orgId, child.id));
    await audit.record(tx, { organizationId: orgId, siteId: lot.site_id, actorUserId: userId, action: 'lot.open', entityType: 'lot', entityId: lot.id,
      after: { child_lot: child.id, quantity: qty, expires_at: expiresAt.toISOString(), expiry_basis: expiryBasis } });
    return { lot_id: child.id, label_id: label.id, code: label.code, quantity: qty, unit: lot.unit, expires_at: expiresAt.toISOString(), expiry_basis: expiryBasis };
  }));
}

const RuleInput = z.object({
  hours: num.nullable(),
  basis: z.string().trim().max(300).optional().nullable().transform((v) => v || null),
}).refine((x) => x.hours === null || (x.basis && x.basis.length >= 5), 'Укажите основание: маркировка изготовителя или утверждённое правило.');

/** Правило «срок после вскрытия» для товара (с основанием). null — снять правило. */
export async function setOpenedShelfLife(userId: string, orgId: string, productId: string, input: unknown) {
  const d = parse(RuleInput, input);
  return inOrg(userId, orgId, 'catalog.manage', async (tx) => {
    const p = (await tx.query(`select id, opened_shelf_hours, opened_shelf_basis from products where id = $1 and organization_id = $2`, [productId, orgId])).rows[0];
    if (!p) throw Errors.notFound('Товар не найден.');
    const after = (await tx.query(`update products set opened_shelf_hours = $2, opened_shelf_basis = $3 where id = $1 returning id, name, opened_shelf_hours, opened_shelf_basis`,
      [productId, d.hours, d.hours === null ? null : d.basis])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'product.opened_shelf_life', entityType: 'product', entityId: productId,
      before: { hours: p.opened_shelf_hours, basis: p.opened_shelf_basis }, after: { hours: after.opened_shelf_hours, basis: after.opened_shelf_basis } });
    return after;
  });
}
