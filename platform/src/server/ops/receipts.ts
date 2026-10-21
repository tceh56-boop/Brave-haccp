import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText, getSite, assertSiteAccess, openTask, fmtNum } from './common';
import { raiseIncident } from './incidents';

/**
 * Приёмка (ТЗ v2 §3, §4, §12, AT-01). Сотрудник вносит строку один раз: товар, количество, партию, даты
 * маркировки, результаты проверок, температуру. При завершении одной операцией система:
 *  - создаёт партии (принятые — в доступный остаток, карантинные — нет);
 *  - для партии без подтверждённого срока — задача «Срок не подтверждён» (AT-02);
 *  - для карантина — отклонение «проблемная приёмка» и задача решения;
 *  - пишет аудит. Склад обновляется только после завершения приёмки.
 */

export const RECEIPT_STATUS_LABEL: Record<string, string> = {
  draft: 'Черновик', accepted: 'Принято', review: 'На проверке', quarantine: 'Карантин', rejected: 'Отказано', returned: 'Возвращено',
};
export const CHECKS = { packaging: 'Целостность упаковки', labeling: 'Маркировка', documents: 'Документы', quality: 'Качество (органолептика)' } as const;
type CheckKey = keyof typeof CHECKS;

const CreateInput = z.object({
  siteId: z.uuid(),
  supplierId: z.uuid().optional().nullable(),
  documentNo: optText(60),
  documentDate: z.iso.date().optional().nullable(),
});

export async function createReceipt(userId: string, orgId: string, input: unknown) {
  const d = parse(CreateInput, input);
  return inOrg(userId, orgId, 'receipt.record', async (tx) => {
    await getSite(tx, orgId, d.siteId);
    if (d.supplierId && !(await tx.query(`select 1 from suppliers where id = $1 and organization_id = $2`, [d.supplierId, orgId])).rowCount) throw Errors.validation('Поставщик не найден.');
    const r = (await tx.query(`insert into receipts (organization_id, site_id, supplier_id, document_no, document_date, created_by) values ($1, $2, $3, $4, $5, $6) returning *`,
      [orgId, d.siteId, d.supplierId || null, d.documentNo, d.documentDate || null, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: 'receipt.create', entityType: 'receipt', entityId: r.id, after: r });
    return r;
  }, d.siteId);
}

const num = z.union([z.number(), z.string().trim().regex(/^-?\d+([.,]\d+)?$/, 'Введите число.').transform((s) => Number(s.replace(',', '.')))]);
const check = z.boolean().nullable().optional();

const LineInput = z.object({
  productId: z.uuid(),
  quantity: num.refine((v) => v > 0, 'Количество больше нуля.'),
  lotNo: optText(60),
  manufacturedAt: z.iso.date().optional().nullable(),
  expiresAt: z.iso.date().optional().nullable(),
  expiryBasis: optText(300),
  temperature: num.optional().nullable(),
  checks: z.object({ packaging: check, labeling: check, documents: check, quality: check }).default({}),
  decision: z.enum(['accepted', 'quarantine', 'rejected']),
  decisionReason: optText(500),
  storageObjectId: z.uuid().optional().nullable(),
  unitPrice: num.refine((v) => v >= 0, 'Цена не может быть отрицательной.').optional().nullable(),   // ₽ за единицу товара, как в документе
}).superRefine((l, ctx) => {
  if (l.expiresAt && !l.expiryBasis) ctx.addIssue({ code: 'custom', message: 'Срок годности указан — укажите основание (например, «маркировка изготовителя»).' });
  if (l.decision === 'accepted') {
    const missing = (Object.keys(CHECKS) as CheckKey[]).filter((k) => l.checks[k] !== true);
    if (missing.length) ctx.addIssue({ code: 'custom', message: `Принять можно только при пройденных проверках: ${missing.map((k) => CHECKS[k]).join(', ')}. Иначе — карантин или отказ с причиной.` });
  } else if (!l.decisionReason) {
    ctx.addIssue({ code: 'custom', message: l.decision === 'quarantine' ? 'Укажите причину карантина.' : 'Укажите причину отказа.' });
  }
  if (l.manufacturedAt && l.expiresAt && l.expiresAt < l.manufacturedAt) ctx.addIssue({ code: 'custom', message: 'Срок годности раньше даты изготовления.' });
});

async function draftReceipt(tx: Tx, orgId: string, receiptId: string, m: { site_ids: string[] }) {
  const r = (await tx.query(`select * from receipts where id = $1 and organization_id = $2 for update`, [receiptId, orgId])).rows[0];
  if (!r) throw Errors.notFound('Приёмка не найдена.');
  assertSiteAccess(m as never, r.site_id);
  if (r.status !== 'draft') throw Errors.conflict('Приёмка уже завершена — изменения вносятся корректировкой.');
  return r;
}

export async function addReceiptLine(userId: string, orgId: string, receiptId: string, input: unknown) {
  const d = parse(LineInput, input);
  return inOrg(userId, orgId, 'receipt.record', async (tx, m) => {
    const r = await draftReceipt(tx, orgId, receiptId, m);
    const p = (await tx.query(`select id, unit from products where id = $1 and organization_id = $2 and status = 'active'`, [d.productId, orgId])).rows[0];
    if (!p) throw Errors.validation('Товар не найден в справочнике.');
    if (d.storageObjectId && !(await tx.query(`select 1 from control_objects where id = $1 and site_id = $2 and status = 'active'`, [d.storageObjectId, r.site_id])).rowCount)
      throw Errors.validation('Место хранения не найдено на этой площадке.');
    if (d.expiresAt && d.decision === 'accepted') {
      const past = (await tx.query(`select (($1::date + time '23:59:59') at time zone (select timezone from organizations where id = $2)) < now() as past`, [d.expiresAt, orgId])).rows[0].past;
      if (past) throw Errors.validation('Срок годности уже истёк — принять нельзя. Отказ или возврат поставщику с причиной.');
    }
    // Срок «до даты» — до конца этих суток по часовому поясу предприятия.
    const line = (await tx.query(`insert into receipt_lines (organization_id, receipt_id, product_id, quantity, unit, lot_no, manufactured_at, expires_at, expiry_basis, temperature, checks, decision, decision_reason, storage_object_id, unit_price)
      values ($1, $2, $3, $4, $5, $6, $7, ($8::date + time '23:59:59') at time zone (select timezone from organizations where id = $1), $9, $10, $11, $12, $13, $14, $15) returning *`,
      [orgId, r.id, p.id, d.quantity, p.unit, d.lotNo, d.manufacturedAt || null, d.expiresAt || null, d.expiryBasis, d.temperature ?? null,
        JSON.stringify(d.checks), d.decision, d.decisionReason, d.storageObjectId || null, d.unitPrice ?? null])).rows[0];
    return line;
  });
}

export async function removeReceiptLine(userId: string, orgId: string, receiptId: string, lineId: string) {
  return inOrg(userId, orgId, 'receipt.record', async (tx, m) => {
    await draftReceipt(tx, orgId, receiptId, m);
    const n = (await tx.query(`delete from receipt_lines where id = $1 and receipt_id = $2`, [lineId, receiptId])).rowCount;
    if (!n) throw Errors.notFound('Строка не найдена.');
    return { ok: true };
  });
}

export async function completeReceipt(userId: string, orgId: string, receiptId: string) {
  return inOrg(userId, orgId, 'receipt.record', async (tx, m) => {
    const r = await draftReceipt(tx, orgId, receiptId, m);
    const lines = (await tx.query(`select l.*, p.name as product from receipt_lines l join products p on p.id = l.product_id where l.receipt_id = $1 order by l.created_at`, [r.id])).rows;
    if (!lines.length) throw Errors.validation('Добавьте хотя бы одну позицию.');
    const created = { lots: 0, quarantine: 0, rejected: 0, unconfirmed: 0, tasks: 0, incidents: 0 };
    for (const l of lines) {
      if (l.decision === 'rejected') { created.rejected++; continue; }
      const status = l.decision === 'accepted' ? 'available' : 'quarantine';
      const lot = (await tx.query(`insert into lots (organization_id, site_id, product_id, receipt_line_id, lot_no, quantity, unit, manufactured_at, expires_at, expiry_basis, storage_object_id, status, status_reason, unit_price)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id`,
        [orgId, r.site_id, l.product_id, l.id, l.lot_no, l.quantity, l.unit, l.manufactured_at, l.expires_at, l.expiry_basis, l.storage_object_id, status, l.decision_reason, l.unit_price])).rows[0];
      await tx.query(`update receipt_lines set lot_id = $2 where id = $1`, [l.id, lot.id]);
      // Приход — первое движение партии в журнале склада.
      await tx.query(`insert into stock_movements (organization_id, site_id, lot_id, product_id, kind, quantity, unit, reason, ref_type, ref_id, created_by)
        values ($1, $2, $3, $4, 'receipt', $5, $6, $7, 'receipt', $8, $9)`, [orgId, r.site_id, lot.id, l.product_id, l.quantity, l.unit, `приёмка ${r.document_no || ''}`.trim(), r.id, userId]);
      created.lots++;
      if (!l.expires_at) {
        created.unconfirmed++;
        if (await openTask(tx, { orgId, siteId: r.site_id, kind: 'confirm_expiry', title: `Срок не подтверждён: ${l.product}`,
          details: `Партия ${l.lot_no || 'без номера'} из приёмки ${r.document_no || ''}. Укажите срок и его основание (маркировка изготовителя, удостоверение качества).`.trim(),
          entityType: 'lot', entityId: lot.id, assigneeRole: 'chef', dueAt: new Date(Date.now() + 4 * 3600e3), createdBy: userId })) created.tasks++;
      }
      if (status === 'quarantine') {
        created.quarantine++;
        if (await openTask(tx, { orgId, siteId: r.site_id, kind: 'quarantine_decision', title: `Решение по карантину: ${l.product}`, details: l.decision_reason,
          entityType: 'lot', entityId: lot.id, assigneeRole: 'haccp_lead', dueAt: new Date(Date.now() + 4 * 3600e3), createdBy: userId })) created.tasks++;
        const temp = l.temperature !== null ? ` Температура при приёмке: ${fmtNum(l.temperature)} °C.` : '';
        await raiseIncident(tx, { orgId, siteId: r.site_id, severity: 'medium', kind: 'receipt_problem', title: `Карантин при приёмке: ${l.product}`,
          what: `Партия ${l.lot_no || 'без номера'}, ${fmtNum(l.quantity)} ${l.unit}. Причина: ${l.decision_reason}.${temp}`, entityType: 'lot', entityId: lot.id,
          responsibleRole: 'haccp_lead', dueMinutes: 240, recommendedAction: 'Проверьте партию и документы; допустите с основанием или забракуйте.', createdBy: userId, notify: ['haccp_lead', 'chef'] });
        created.incidents++;
      }
    }
    const status = created.rejected === lines.length ? 'rejected' : created.quarantine ? 'quarantine' : 'accepted';
    await tx.query(`update receipts set status = $2, completed_by = $3, completed_at = now() where id = $1`, [r.id, status, userId]);
    await audit.record(tx, { organizationId: orgId, siteId: r.site_id, actorUserId: userId, action: 'receipt.complete', entityType: 'receipt', entityId: r.id,
      before: { status: 'draft' }, after: { status, lines: lines.length, ...created } });
    return { status, status_label: RECEIPT_STATUS_LABEL[status], ...created };
  });
}

export async function listReceipts(userId: string, orgId: string, siteId: string) {
  return inOrg(userId, orgId, 'receipt.record', async (tx) => (await tx.query(
    `select r.id, r.status, r.document_no, r.document_date, r.created_at, r.completed_at, s.name as supplier, u.full_name as author,
       (select count(*) from receipt_lines l where l.receipt_id = r.id)::int as lines
     from receipts r left join suppliers s on s.id = r.supplier_id left join users u on u.id = r.created_by
     where r.organization_id = $1 and r.site_id = $2 order by r.created_at desc limit 100`, [orgId, siteId])).rows.map((r) => ({ ...r, status_label: RECEIPT_STATUS_LABEL[r.status] })), siteId);
}

export async function getReceipt(userId: string, orgId: string, receiptId: string) {
  return inOrg(userId, orgId, 'receipt.record', async (tx, m) => {
    const r = (await tx.query(`select r.*, s.name as supplier from receipts r left join suppliers s on s.id = r.supplier_id where r.id = $1 and r.organization_id = $2`, [receiptId, orgId])).rows[0];
    if (!r) throw Errors.notFound('Приёмка не найдена.');
    assertSiteAccess(m, r.site_id);
    const lines = (await tx.query(`select l.*, p.name as product, o.name as storage_name from receipt_lines l join products p on p.id = l.product_id
      left join control_objects o on o.id = l.storage_object_id where l.receipt_id = $1 order by l.created_at`, [r.id])).rows;
    return { receipt: { ...r, status_label: RECEIPT_STATUS_LABEL[r.status] }, lines };
  });
}
