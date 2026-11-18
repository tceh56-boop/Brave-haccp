import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { roleHas } from '../access/roles';
import { inOrg, parse, optText, assertSiteAccess, getSite, orgToday, fmtNum, notifyRoles } from './common';
import { once, move } from './stock';
import { EXPENSE_CATEGORY } from './finance';

/**
 * Деньги (финансовый контур, этап Ф-3; решение владельца — оплаты поставщикам и наличные кассы ведутся в ЦЕХ).
 *
 *  Долг поставщику (кредиторская задолженность):
 *    к оплате по накладным (снимок при завершении) − возвраты и корректировки − оплаты + возвраты денег от поставщика.
 *    Отрицательный долг — аванс поставщику. Накладная со строкой без цены — сумма «не определена» и в долг не входит,
 *    но показывается отдельно (неизвестное — не ноль).
 *  Оплата разносится по накладным: выбранным или по сроку оплаты (FIFO). Неразнесённый остаток — аванс.
 *  Наличные в кассе: ожидаемые = на начало + оплаты наличными − возвраты наличными + внесения и оплаты мероприятий
 *    − выемки − инкассации − расходы и оплаты поставщикам из кассы. Выдать больше, чем в кассе, нельзя.
 *  Мероприятие: сумма — по меню (до проведения) или выручка (после); оплачено = предоплаты + доплаты − возвраты.
 *  Записи о деньгах не меняются и не удаляются: ошибочную аннулируют с причиной.
 */

export const METHOD: Record<string, string> = { bank: 'Банк (расчётный счёт)', cash: 'Наличные (не из кассы)', cash_register: 'Из кассы смены', card: 'Карта' };
const r2 = (x: number) => Math.round(x * 100) / 100;
const amountT = z.union([z.number(), z.string().trim().regex(/^\d+([.,]\d+)?$/, 'Введите сумму.').transform((s) => Number(s.replace(',', '.')))])
  .refine((v) => Number.isFinite(v) && v > 0 && v <= 1e10, 'Сумма больше нуля.');
const operationId = z.string().trim().min(8, 'Нужен ключ операции (operationId).').max(100);
const method = z.enum(['bank', 'cash', 'cash_register', 'card'], 'Способ оплаты.');
const reasonT = z.string('Причина.').trim().min(5, 'Укажите причину (не короче 5 символов).').max(300);

/* ───────────── Касса: наличные ───────────── */

const CASH_IN = ['deposit', 'event_payment'], CASH_OUT = ['withdrawal', 'collection', 'expense', 'supplier_payment'];
export const CASH_OP: Record<string, string> = { deposit: 'Внесение', event_payment: 'Оплата мероприятия', withdrawal: 'Выемка', collection: 'Инкассация', expense: 'Расход из кассы', supplier_payment: 'Оплата поставщику из кассы' };

/** Наличные смены: операции кассы и ожидаемый остаток. */
export async function shiftCash(tx: Tx, shift: { id: string; cash_start: string | number }) {
  const cashPays = Number((await tx.query(`select coalesce(sum(amount), 0) as s from pos_payments where shift_id = $1 and method = 'cash'`, [shift.id])).rows[0].s);
  const ops = (await tx.query(`select kind, sum(amount)::float8 as amount, count(*)::int as n from pos_cash_ops where shift_id = $1 group by kind`, [shift.id])).rows;
  const by = Object.fromEntries(ops.map((o) => [o.kind, r2(o.amount)])) as Record<string, number>;
  const cin = r2(CASH_IN.reduce((s, k) => s + (by[k] || 0), 0)), cout = r2(CASH_OUT.reduce((s, k) => s + (by[k] || 0), 0));
  return { ops: by, cash_in: cin, cash_out: cout, cash_expected: r2(Number(shift.cash_start) + cashPays + cin - cout) };
}

async function openShiftFor(tx: Tx, siteId: string) {
  const s = (await tx.query(`select * from pos_shifts where site_id = $1 and status = 'open' for update`, [siteId])).rows[0];
  if (!s) throw Errors.conflict('На площадке нет открытой смены кассы — операция с наличными кассы невозможна.');
  return s;
}

/** Движение наличных кассы (внутреннее): выдача больше, чем в кассе, — запрещена. */
export async function cashOp(tx: Tx, c: { orgId: string; siteId: string; kind: string; amount: number; reason: string; userId: string; expenseId?: string; supplierPaymentId?: string; eventPaymentId?: string; operationId?: string | null }) {
  const shift = await openShiftFor(tx, c.siteId);
  if (CASH_OUT.includes(c.kind)) {
    const { cash_expected } = await shiftCash(tx, shift);
    if (c.amount > cash_expected + 1e-9) throw Errors.conflict(`В кассе по расчёту ${fmtNum(cash_expected)} ₽ — выдать ${fmtNum(c.amount)} ₽ нельзя.`);
  }
  return (await tx.query(`insert into pos_cash_ops (organization_id, site_id, shift_id, kind, amount, reason, expense_id, supplier_payment_id, event_payment_id, operation_id, created_by)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
  [c.orgId, c.siteId, shift.id, c.kind, r2(c.amount), c.reason, c.expenseId || null, c.supplierPaymentId || null, c.eventPaymentId || null, c.operationId || null, c.userId])).rows[0];
}

const CashInput = z.object({ siteId: z.uuid(), kind: z.enum(['deposit', 'withdrawal', 'collection'], 'Вид операции.'), amount: amountT, reason: reasonT, operationId });

/** Внесение, выемка, инкассация. Внесение и инкассацию делает кассир; выемку — руководитель (право возврата). */
export async function registerCashOp(userId: string, orgId: string, input: unknown) {
  const d = parse(CashInput, input);
  return inOrg(userId, orgId, 'pos.sell', async (tx, m) => once(tx, orgId, d.operationId, 'cash_op', userId, async () => {
    if (d.kind === 'withdrawal' && !roleHas(m.role, 'pos.refund')) throw Errors.forbidden('Выемку наличных делает руководитель.');
    const op = await cashOp(tx, { orgId, siteId: d.siteId, kind: d.kind, amount: d.amount, reason: d.reason, userId });
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: `cash.${d.kind}`, entityType: 'pos_shift', entityId: op.shift_id, after: { amount: op.amount, reason: d.reason } });
    return { id: op.id, kind: op.kind, amount: Number(op.amount) };
  }), d.siteId);
}

export async function listCashOps(userId: string, orgId: string, siteId: string) {
  return inOrg(userId, orgId, 'pos.sell', async (tx) => {
    const shift = (await tx.query(`select * from pos_shifts where site_id = $1 and status = 'open'`, [siteId])).rows[0];
    if (!shift) return { shift: null, ops: [], cash: null };
    const ops = (await tx.query(`select o.id, o.kind, o.amount::float8 as amount, o.reason, o.created_at, u.full_name as who from pos_cash_ops o join users u on u.id = o.created_by
      where o.shift_id = $1 order by o.created_at`, [shift.id])).rows.map((o) => ({ ...o, label: CASH_OP[o.kind], direction: CASH_IN.includes(o.kind) ? 'in' : 'out' }));
    return { shift: { id: shift.id, opened_at: shift.opened_at }, ops, cash: await shiftCash(tx, shift) };
  }, siteId);
}

/* ───────────── Поставщики: долг, оплаты, возвраты ───────────── */

/** Открытые суммы накладных поставщика: к оплате − возвраты и корректировки по накладной − разнесённые оплаты. */
async function openReceipts(tx: Tx, orgId: string, supplierId: string) {
  return (await tx.query(`select r.id, r.document_no, r.document_date::text, r.due_date::text, r.payable::float8 as payable, r.completed_at,
      coalesce((select sum(a.amount) from supplier_payment_allocations a join supplier_payments p on p.id = a.payment_id where a.receipt_id = r.id and p.voided_at is null), 0)::float8 as paid,
      coalesce((select sum(c.amount) from supplier_credits c where c.receipt_id = r.id and c.voided_at is null), 0)::float8 as credited
    from receipts r where r.organization_id = $1 and r.supplier_id = $2 and r.status <> 'draft' and r.payable is not null
    order by r.due_date nulls last, r.completed_at`, [orgId, supplierId])).rows.map((r) => ({ ...r, open: r2(r.payable - r.paid - r.credited) }));
}

/** Долги поставщикам: по каждому — к оплате, возвраты и корректировки, оплачено, долг, просрочено, накладные без суммы. */
export async function supplierBalances(tx: Tx, orgId: string, today: string, supplierId: string | null = null) {
  const rows = (await tx.query(`select s.id, s.name, s.inn, s.payment_days,
      coalesce((select sum(payable) from receipts r where r.supplier_id = s.id and r.status <> 'draft' and r.payable is not null), 0)::float8 as invoiced,
      (select count(*) from receipts r where r.supplier_id = s.id and r.status <> 'draft' and r.payable is null)::int as unpriced,
      coalesce((select sum(amount) from supplier_credits c where c.supplier_id = s.id and c.voided_at is null), 0)::float8 as credits,
      coalesce((select sum(amount) from supplier_payments p where p.supplier_id = s.id and p.voided_at is null and p.kind = 'payment'), 0)::float8 as paid,
      coalesce((select sum(amount) from supplier_payments p where p.supplier_id = s.id and p.voided_at is null and p.kind = 'refund'), 0)::float8 as refunded
    from suppliers s where s.organization_id = $1 and ($2::uuid is null or s.id = $2) order by s.name`, [orgId, supplierId])).rows;
  const out = [];
  for (const s of rows) {
    const balance = r2(s.invoiced - s.credits - s.paid + s.refunded);
    let overdue = 0;
    if (balance > 0) for (const r of await openReceipts(tx, orgId, s.id)) if (r.open > 0 && r.due_date && r.due_date < today) overdue = r2(overdue + r.open);
    if (!s.invoiced && !s.paid && !s.credits && !s.unpriced && !s.refunded) continue;
    out.push({ supplier_id: s.id, name: s.name, inn: s.inn, payment_days: s.payment_days, invoiced: r2(s.invoiced), credits: r2(s.credits), paid: r2(s.paid), refunded: r2(s.refunded),
      balance, debt: balance > 0 ? balance : 0, advance: balance < 0 ? -balance : 0, overdue: Math.min(overdue, Math.max(balance, 0)), unpriced: s.unpriced });
  }
  return out;
}

export async function listSupplierBalances(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'econ.read', async (tx, m) => {
    const today = await orgToday(tx, orgId);
    const rows = await supplierBalances(tx, orgId, today);
    return { today, rows, can_pay: roleHas(m.role, 'payment.manage'),
      totals: { debt: r2(rows.reduce((s, r) => s + r.debt, 0)), overdue: r2(rows.reduce((s, r) => s + r.overdue, 0)), advance: r2(rows.reduce((s, r) => s + r.advance, 0)), unpriced: rows.reduce((s, r) => s + r.unpriced, 0) } };
  });
}

export async function supplierLedger(userId: string, orgId: string, supplierId: string) {
  const sid = parse(z.uuid(), supplierId);
  return inOrg(userId, orgId, 'econ.read', async (tx) => {
    const today = await orgToday(tx, orgId);
    const sup = (await tx.query(`select id, name, inn, payment_days from suppliers where id = $1 and organization_id = $2`, [sid, orgId])).rows[0];
    if (!sup) throw Errors.notFound('Поставщик не найден.');
    const receipts = (await openReceipts(tx, orgId, sid)).map((r) => ({ ...r, state: r.open <= 0.005 ? 'оплачена' : r.paid + r.credited > 0 ? 'частично' : 'не оплачена', overdue: r.open > 0.005 && !!r.due_date && r.due_date < today }));
    const unpriced = (await tx.query(`select id, document_no, completed_at from receipts where organization_id = $1 and supplier_id = $2 and status <> 'draft' and payable is null order by completed_at`, [orgId, sid])).rows;
    const payments = (await tx.query(`select p.id, p.kind, p.paid_on::text, p.amount::float8 as amount, p.method, p.doc_no, p.comment, p.source, p.voided_at, p.void_reason, u.full_name as who
      from supplier_payments p join users u on u.id = p.created_by where p.organization_id = $1 and p.supplier_id = $2 order by p.paid_on desc, p.created_at desc`, [orgId, sid])).rows.map((p) => ({ ...p, method_label: METHOD[p.method] }));
    const credits = (await tx.query(`select c.id, c.kind, c.on_date::text, c.amount::float8 as amount, c.doc_no, c.reason, c.receipt_id, c.quantity::float8 as quantity, c.voided_at, c.void_reason
      from supplier_credits c where c.organization_id = $1 and c.supplier_id = $2 order by c.on_date desc, c.created_at desc`, [orgId, sid])).rows;
    return { supplier: sup, balance: (await supplierBalances(tx, orgId, today, sid))[0] || null, receipts, unpriced, payments, credits, today };
  });
}

const PayInput = z.object({
  supplierId: z.uuid(), kind: z.enum(['payment', 'refund']).default('payment'), amount: amountT, paidOn: z.iso.date('Дата оплаты.'), method,
  siteId: z.uuid().optional().nullable(), docNo: optText(60), comment: optText(300), receiptIds: z.array(z.uuid()).max(200).optional(), operationId,
});

/** Разнести оплату: выбранные накладные или по сроку оплаты; остаток — аванс поставщику. */
async function allocate(tx: Tx, orgId: string, paymentId: string, supplierId: string, amount: number, receiptIds?: string[]) {
  let left = amount;
  const open = (await openReceipts(tx, orgId, supplierId)).filter((r) => r.open > 0.005 && (!receiptIds?.length || receiptIds.includes(r.id)));
  if (receiptIds?.length && open.length !== new Set(receiptIds).size) throw Errors.validation('Часть выбранных накладных не найдена у этого поставщика или уже оплачена.');
  const alloc: { receipt_id: string; amount: number }[] = [];
  for (const r of open) {
    if (left <= 0.005) break;
    const a = r2(Math.min(left, r.open));
    await tx.query(`insert into supplier_payment_allocations (organization_id, payment_id, receipt_id, amount) values ($1, $2, $3, $4)`, [orgId, paymentId, r.id, a]);
    alloc.push({ receipt_id: r.id, amount: a }); left = r2(left - a);
  }
  return { allocations: alloc, advance: left };
}

/** Записать оплату (внутреннее): касса смены, разнесение, аудит. */
export async function recordSupplierPayment(tx: Tx, orgId: string, userId: string, d: z.infer<typeof PayInput> & { source?: 'manual' | 'bank'; bankLineId?: string | null }) {
  const sup = (await tx.query(`select id, name from suppliers where id = $1 and organization_id = $2`, [d.supplierId, orgId])).rows[0];
  if (!sup) throw Errors.notFound('Поставщик не найден.');
  if (d.method === 'cash_register' && (!d.siteId || d.kind !== 'payment')) throw Errors.validation('Из кассы смены — только оплата поставщику с указанием площадки.');
  if (d.siteId) await getSite(tx, orgId, d.siteId);
  const p = (await tx.query(`insert into supplier_payments (organization_id, site_id, supplier_id, kind, paid_on, amount, method, doc_no, comment, source, bank_line_id, operation_id, created_by)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning *`,
  [orgId, d.siteId || null, d.supplierId, d.kind, d.paidOn, r2(d.amount), d.method, d.docNo, d.comment, d.source || 'manual', d.bankLineId || null, d.operationId, userId])).rows[0];
  if (d.method === 'cash_register') await cashOp(tx, { orgId, siteId: d.siteId!, kind: 'supplier_payment', amount: d.amount, reason: `оплата поставщику ${sup.name}${d.docNo ? `, ${d.docNo}` : ''}`, userId, supplierPaymentId: p.id });
  const res = d.kind === 'payment' ? await allocate(tx, orgId, p.id, d.supplierId, r2(d.amount), d.receiptIds) : { allocations: [], advance: 0 };
  await audit.record(tx, { organizationId: orgId, siteId: d.siteId || null, actorUserId: userId, action: `supplier.${d.kind}`, entityType: 'supplier', entityId: d.supplierId,
    after: { payment_id: p.id, amount: r2(d.amount), method: d.method, paid_on: d.paidOn, ...res } });
  return { id: p.id as string, ...res };
}

export async function paySupplier(userId: string, orgId: string, input: unknown) {
  const d = parse(PayInput, input);
  return inOrg(userId, orgId, 'payment.manage', async (tx, m) => once(tx, orgId, d.operationId, 'supplier_payment', userId, async () => {
    if (d.siteId) assertSiteAccess(m, d.siteId);
    return recordSupplierPayment(tx, orgId, userId, d);
  }));
}

export async function voidSupplierPayment(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(z.object({ reason: reasonT }), input);
  return inOrg(userId, orgId, 'payment.manage', async (tx) => {
    const p = (await tx.query(`select * from supplier_payments where id = $1 and organization_id = $2 for update`, [parse(z.uuid(), id), orgId])).rows[0];
    if (!p) throw Errors.notFound('Оплата не найдена.');
    if (p.voided_at) throw Errors.conflict('Оплата уже аннулирована.');
    if (p.method === 'cash_register') throw Errors.conflict('Оплата из кассы смены не аннулируется: наличные уже выданы. Если поставщик вернул деньги — оформите внесение в кассу.');
    if (p.bank_line_id) throw Errors.conflict('Оплата создана из банковской выписки — она подтверждена банком и не аннулируется.');
    await tx.query(`update supplier_payments set voided_by = $2, voided_at = now(), void_reason = $3 where id = $1`, [p.id, userId, d.reason]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'supplier.payment_void', entityType: 'supplier', entityId: p.supplier_id, reason: d.reason, before: { amount: p.amount, paid_on: p.paid_on } });
    return { ok: true };
  });
}

const ReturnInput = z.object({ lotId: z.uuid(), quantity: amountT, reason: reasonT, docNo: optText(60), operationId });

/**
 * Возврат товара поставщику: движение «возврат поставщику» по партии и зачёт в долг на сумму по цене накладной
 * (цена строки с НДС, без доли доставки — её поставщик не возвращает). Партия должна быть из приёмки с поставщиком.
 */
export async function returnToSupplier(userId: string, orgId: string, input: unknown) {
  const d = parse(ReturnInput, input);
  return inOrg(userId, orgId, 'stock.write_off', async (tx, m) => once(tx, orgId, d.operationId, 'supplier_return', userId, async () => {
    const lot = (await tx.query(`select l.*, p.name as product, rl.unit_price::float8 as line_price, r.id as receipt_id, r.supplier_id, r.document_no
      from lots l join products p on p.id = l.product_id left join receipt_lines rl on rl.id = l.receipt_line_id left join receipts r on r.id = rl.receipt_id
      where l.id = $1 and l.organization_id = $2 for update of l`, [d.lotId, orgId])).rows[0];
    if (!lot) throw Errors.notFound('Партия не найдена.');
    assertSiteAccess(m, lot.site_id);
    if (!lot.supplier_id) throw Errors.conflict('Партия не из приёмки от поставщика — вернуть поставщику нельзя.');
    if (['consumed', 'written_off'].includes(lot.status) || Number(lot.quantity) <= 0) throw Errors.conflict('Партия уже израсходована или списана.');
    if (d.quantity > Number(lot.quantity) + 1e-9) throw Errors.conflict(`В партии ${fmtNum(lot.quantity)} ${lot.unit} — вернуть больше нельзя.`);
    const reason = `Возврат поставщику: ${d.reason}`;
    await move(tx, { orgId, siteId: lot.site_id, lotId: lot.id, productId: lot.product_id, kind: 'return_to_supplier', quantity: -d.quantity, unit: lot.unit, reason, refType: 'receipt', refId: lot.receipt_id, operationId: d.operationId, userId });
    if (Number(lot.quantity) - d.quantity <= 1e-9) await tx.query(`update lots set status = 'consumed', status_reason = $2 where id = $1`, [lot.id, reason]);
    const amount = lot.line_price === null ? null : r2(d.quantity * lot.line_price);
    let creditId: string | null = null;
    if (amount && amount > 0) {
      const today = await orgToday(tx, orgId);
      creditId = (await tx.query(`insert into supplier_credits (organization_id, supplier_id, receipt_id, kind, on_date, amount, doc_no, reason, lot_id, quantity, created_by)
        values ($1, $2, $3, 'return', $4, $5, $6, $7, $8, $9, $10) returning id`, [orgId, lot.supplier_id, lot.receipt_id, today, amount, d.docNo, d.reason, lot.id, d.quantity, userId])).rows[0].id;
      await notifyRoles(tx, { orgId, siteId: lot.site_id, roles: ['accountant'], title: `Возврат поставщику: ${lot.product}`, body: `${fmtNum(d.quantity)} ${lot.unit} на ${fmtNum(amount)} ₽ по накладной ${lot.document_no || 'без номера'} — долг уменьшен. ${d.reason}`, entityType: 'receipt', entityId: lot.receipt_id });
    }
    await audit.record(tx, { organizationId: orgId, siteId: lot.site_id, actorUserId: userId, action: 'supplier.return', entityType: 'lot', entityId: lot.id, reason: d.reason,
      after: { quantity: d.quantity, amount, credit_id: creditId } });
    return { lot_id: lot.id, product: lot.product, quantity: d.quantity, unit: lot.unit, amount, credit_id: creditId };
  }));
}

const CorrectionInput = z.object({
  supplierId: z.uuid(), receiptId: z.uuid().optional().nullable(), onDate: z.iso.date(),
  amount: z.coerce.number().refine((v) => v !== 0 && Math.abs(v) <= 1e9, 'Сумма корректировки не ноль.'), docNo: optText(60), reason: reasonT,
});

/** Корректировка долга без товара (УКД, скидка, пересчёт): «+» — должны меньше, «−» — должны больше. */
export async function supplierCorrection(userId: string, orgId: string, input: unknown) {
  const d = parse(CorrectionInput, input);
  return inOrg(userId, orgId, 'payment.manage', async (tx) => {
    if (!(await tx.query(`select 1 from suppliers where id = $1 and organization_id = $2`, [d.supplierId, orgId])).rowCount) throw Errors.notFound('Поставщик не найден.');
    if (d.receiptId && !(await tx.query(`select 1 from receipts where id = $1 and organization_id = $2 and supplier_id = $3 and status <> 'draft'`, [d.receiptId, orgId, d.supplierId])).rowCount)
      throw Errors.validation('Накладная не найдена у этого поставщика.');
    const c = (await tx.query(`insert into supplier_credits (organization_id, supplier_id, receipt_id, kind, on_date, amount, doc_no, reason, created_by) values ($1, $2, $3, 'correction', $4, $5, $6, $7, $8) returning id`,
      [orgId, d.supplierId, d.receiptId || null, d.onDate, r2(d.amount), d.docNo, d.reason, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'supplier.correction', entityType: 'supplier', entityId: d.supplierId, reason: d.reason, after: { ...d, id: c.id } });
    return c;
  });
}

export async function voidSupplierCredit(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(z.object({ reason: reasonT }), input);
  return inOrg(userId, orgId, 'payment.manage', async (tx) => {
    const c = (await tx.query(`select * from supplier_credits where id = $1 and organization_id = $2 for update`, [parse(z.uuid(), id), orgId])).rows[0];
    if (!c) throw Errors.notFound('Корректировка не найдена.');
    if (c.voided_at) throw Errors.conflict('Уже аннулирована.');
    if (c.kind === 'return') throw Errors.conflict('Возврат товара уже проведён по складу и не аннулируется.');
    await tx.query(`update supplier_credits set voided_by = $2, voided_at = now(), void_reason = $3 where id = $1`, [c.id, userId, d.reason]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'supplier.correction_void', entityType: 'supplier', entityId: c.supplier_id, reason: d.reason, before: { amount: c.amount } });
    return { ok: true };
  });
}

/* ───────────── Мероприятия: предоплата, доплата, возврат ───────────── */

/** Сумма мероприятия и оплаты: до проведения — по меню (цена × порции), после — выручка; неизвестная цена — сумма не определена. */
export async function eventMoney(tx: Tx, eventId: string) {
  const e = (await tx.query(`select id, status, revenue::float8 as revenue from plan_events where id = $1`, [eventId])).rows[0];
  let amount: number | null = e.revenue;
  if (e.status !== 'done') {
    const items = (await tx.query(`select coalesce(i.price, d.sale_price)::float8 as price, i.portions::float8 as portions from plan_event_items i join dishes d on d.id = i.dish_id where i.event_id = $1`, [eventId])).rows;
    amount = items.length && items.every((i) => i.price !== null) ? r2(items.reduce((s, i) => s + i.price * i.portions, 0)) : null;
  }
  const p = (await tx.query(`select coalesce(sum(amount) filter (where kind in ('prepayment', 'payment')), 0)::float8 as paid, coalesce(sum(amount) filter (where kind = 'refund'), 0)::float8 as refunded
    from event_payments where event_id = $1 and voided_at is null`, [eventId])).rows[0];
  const paid = r2(p.paid - p.refunded);
  return { status: e.status as string, amount, paid, balance: amount === null ? null : r2(amount - paid) };
}

const EventPayInput = z.object({ kind: z.enum(['prepayment', 'payment', 'refund']), amount: amountT, paidOn: z.iso.date(), method, docNo: optText(60), comment: optText(300), operationId });

export async function recordEventPayment(tx: Tx, orgId: string, userId: string, eventId: string, d: z.infer<typeof EventPayInput> & { source?: 'manual' | 'bank'; bankLineId?: string | null }) {
  const e = (await tx.query(`select id, number, title, site_id, status from plan_events where id = $1 and organization_id = $2 for update`, [eventId, orgId])).rows[0];
  if (!e) throw Errors.notFound('Мероприятие не найдено.');
  const mo = await eventMoney(tx, e.id);
  if (d.kind === 'refund' && d.amount > mo.paid + 1e-9) throw Errors.conflict(`Оплачено ${fmtNum(mo.paid)} ₽ — вернуть больше нельзя.`);
  const p = (await tx.query(`insert into event_payments (organization_id, event_id, kind, paid_on, amount, method, doc_no, comment, source, bank_line_id, operation_id, created_by)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning *`,
  [orgId, e.id, d.kind, d.paidOn, r2(d.amount), d.method, d.docNo, d.comment, d.source || 'manual', d.bankLineId || null, d.operationId, userId])).rows[0];
  if (d.method === 'cash_register') await cashOp(tx, { orgId, siteId: e.site_id, kind: d.kind === 'refund' ? 'withdrawal' : 'event_payment', amount: d.amount,
    reason: `${d.kind === 'refund' ? 'возврат клиенту' : 'оплата'}: мероприятие № ${e.number} «${e.title}»`, userId, eventPaymentId: p.id });
  await audit.record(tx, { organizationId: orgId, siteId: e.site_id, actorUserId: userId, action: `event.${d.kind}`, entityType: 'plan_event', entityId: e.id, after: { amount: r2(d.amount), method: d.method, paid_on: d.paidOn } });
  return { id: p.id as string, ...(await eventMoney(tx, e.id)) };
}

export async function addEventPayment(userId: string, orgId: string, eventId: string, input: unknown) {
  const d = parse(EventPayInput, input);
  return inOrg(userId, orgId, 'event.manage', async (tx, m) => once(tx, orgId, d.operationId, 'event_payment', userId, async () => {
    const e = (await tx.query(`select site_id from plan_events where id = $1 and organization_id = $2`, [parse(z.uuid(), eventId), orgId])).rows[0];
    if (!e) throw Errors.notFound('Мероприятие не найдено.');
    assertSiteAccess(m, e.site_id);
    if (d.kind === 'refund' && !roleHas(m.role, 'payment.manage') && !roleHas(m.role, 'pos.refund')) throw Errors.forbidden('Возврат денег клиенту делает руководитель.');
    return recordEventPayment(tx, orgId, userId, eventId, d);
  }));
}

export async function listEventPayments(userId: string, orgId: string, eventId: string) {
  return inOrg(userId, orgId, 'event.read', async (tx, m) => {
    const e = (await tx.query(`select site_id from plan_events where id = $1 and organization_id = $2`, [parse(z.uuid(), eventId), orgId])).rows[0];
    if (!e) throw Errors.notFound('Мероприятие не найдено.');
    assertSiteAccess(m, e.site_id);
    if (!roleHas(m.role, 'event.manage') && !roleHas(m.role, 'menu.price')) return { hidden: true, rows: [], money: null };
    const rows = (await tx.query(`select p.id, p.kind, p.paid_on::text, p.amount::float8 as amount, p.method, p.doc_no, p.comment, p.voided_at, p.void_reason, u.full_name as who
      from event_payments p join users u on u.id = p.created_by where p.event_id = $1 order by p.paid_on, p.created_at`, [eventId])).rows.map((p) => ({ ...p, method_label: METHOD[p.method] }));
    return { hidden: false, rows, money: await eventMoney(tx, eventId) };
  });
}

export async function voidEventPayment(userId: string, orgId: string, paymentId: string, input: unknown) {
  const d = parse(z.object({ reason: reasonT }), input);
  return inOrg(userId, orgId, 'payment.manage', async (tx) => {
    const p = (await tx.query(`select * from event_payments where id = $1 and organization_id = $2 for update`, [parse(z.uuid(), paymentId), orgId])).rows[0];
    if (!p) throw Errors.notFound('Оплата не найдена.');
    if (p.voided_at) throw Errors.conflict('Оплата уже аннулирована.');
    if (p.method === 'cash_register' || p.bank_line_id) throw Errors.conflict('Оплата через кассу или из выписки не аннулируется — оформите возврат.');
    await tx.query(`update event_payments set voided_by = $2, voided_at = now(), void_reason = $3 where id = $1`, [p.id, userId, d.reason]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'event.payment_void', entityType: 'plan_event', entityId: p.event_id, reason: d.reason, before: { amount: p.amount } });
    return { ok: true };
  });
}

/** Расчёты по мероприятиям: авансы полученные, долги клиентов, к возврату по отменённым. */
export async function eventSettlements(tx: Tx, orgId: string, siteId: string | null) {
  const evs = (await tx.query(`select e.id, e.number, e.title, e.event_date::text, e.status from plan_events e where e.organization_id = $1 and ($2::uuid is null or e.site_id = $2)
    and (e.status = 'done' or exists (select 1 from event_payments p where p.event_id = e.id and p.voided_at is null)) order by e.event_date`, [orgId, siteId])).rows;
  const out = [];
  for (const e of evs) {
    const mo = await eventMoney(tx, e.id);
    const state = e.status === 'cancelled' ? (mo.paid > 0 ? 'вернуть клиенту' : null)
      : e.status !== 'done' ? (mo.paid > 0 ? 'аванс получен' : null)
      : mo.balance === null ? 'сумма не определена' : mo.balance > 0.005 ? 'долг клиента' : mo.balance < -0.005 ? 'переплата клиента' : null;
    if (state) out.push({ event_id: e.id, name: `№ ${e.number} «${e.title}»`, date: e.event_date, status: e.status, amount: mo.amount, paid: mo.paid, balance: e.status === 'cancelled' ? -mo.paid : mo.balance, state });
  }
  return out;
}

/* ───────────── Банковская выписка (1С «Клиент-Банк») ───────────── */

interface BankDoc { doc_no: string | null; op_date: string; amount: number; counterparty: string | null; counterparty_inn: string | null; purpose: string | null }
const ddmmyyyy = (s?: string) => { const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec((s || '').trim()); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

/**
 * Разбор выписки в формате обмена с 1С (текст «1CClientBankExchange»): свой счёт — «РасчСчет»; документ — от «СекцияДокумент»
 * до «КонецДокумента». Списание — плательщик = наш счёт, поступление — получатель = наш счёт. Чужие документы пропускаются.
 */
export function parseClientBank(text: string) {
  if (!/^﻿?1CClientBankExchange/.test(text.trim())) throw Errors.validation('Это не выписка в формате обмена с 1С (файл должен начинаться с «1CClientBankExchange»). Выгрузите выписку из банка в формате 1С.');
  const lines = text.split(/\r?\n/);
  const own = new Set<string>(); let from: string | null = null, to: string | null = null;
  const docs: BankDoc[] = []; let cur: Record<string, string> | null = null;
  for (const raw of lines) {
    const ln = raw.trim(); const i = ln.indexOf('='); const k = i > 0 ? ln.slice(0, i) : ln; const v = i > 0 ? ln.slice(i + 1).trim() : '';
    if (k === 'РасчСчет' && !cur) own.add(v);
    else if (k === 'ДатаНачала' && !cur) from = ddmmyyyy(v);
    else if (k === 'ДатаКонца' && !cur) to = ddmmyyyy(v);
    else if (k === 'СекцияДокумент') cur = {};
    else if (k === 'КонецДокумента' && cur) {
      const out = own.has(cur['ПлательщикСчет'] || cur['ПлательщикРасчСчет'] || ''), inc = own.has(cur['ПолучательСчет'] || cur['ПолучательРасчСчет'] || '');
      const sum = Number((cur['Сумма'] || '').replace(',', '.'));
      const date = ddmmyyyy(out ? cur['ДатаСписано'] || cur['Дата'] : cur['ДатаПоступило'] || cur['Дата']) || ddmmyyyy(cur['Дата']);
      if ((out || inc) && !(out && inc) && sum > 0 && date) docs.push({ doc_no: cur['Номер'] || null, op_date: date, amount: out ? -sum : sum,
        counterparty: (out ? cur['Получатель1'] || cur['Получатель'] : cur['Плательщик1'] || cur['Плательщик']) || null,
        counterparty_inn: (out ? cur['ПолучательИНН'] : cur['ПлательщикИНН']) || null, purpose: cur['НазначениеПлатежа'] || null });
      cur = null;
    } else if (cur && i > 0) cur[k] = v;
  }
  if (!own.size) throw Errors.validation('В выписке не найден свой расчётный счёт («РасчСчет»).');
  return { accounts: [...own], from, to, docs };
}

export async function importBankStatement(userId: string, orgId: string, input: unknown) {
  const d = parse(z.object({ text: z.string().min(20, 'Пустой файл.').max(5_000_000, 'Файл слишком большой.') }), input);
  return inOrg(userId, orgId, 'payment.manage', async (tx) => {
    const p = parseClientBank(d.text);
    const hash = createHash('sha256').update(d.text).digest('hex');
    if ((await tx.query(`select 1 from bank_statements where organization_id = $1 and file_hash = $2`, [orgId, hash])).rowCount) throw Errors.conflict('Эта выписка уже загружена.');
    const st = (await tx.query(`insert into bank_statements (organization_id, account, date_from, date_to, file_hash, lines, imported_by) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [orgId, p.accounts.join(', '), p.from, p.to, hash, p.docs.length, userId])).rows[0];
    let added = 0, dup = 0;
    for (const x of p.docs) {
      const lh = createHash('sha256').update([p.accounts.join(','), x.doc_no, x.op_date, x.amount, x.counterparty_inn, x.purpose].join('|')).digest('hex');
      const ins = await tx.query(`insert into bank_lines (organization_id, statement_id, line_hash, doc_no, op_date, amount, counterparty, counterparty_inn, purpose) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        on conflict (organization_id, line_hash) do nothing`, [orgId, st.id, lh, x.doc_no, x.op_date, x.amount, x.counterparty, x.counterparty_inn, x.purpose]);
      if (ins.rowCount) added++; else dup++;
    }
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'bank.import', entityType: 'bank_statement', entityId: st.id, after: { accounts: p.accounts, from: p.from, to: p.to, added, duplicates: dup } });
    return { statement_id: st.id, accounts: p.accounts, from: p.from, to: p.to, added, duplicates: dup };
  });
}

export const BANK_STATUS: Record<string, string> = { new: 'не разнесено', supplier_payment: 'оплата поставщику', expense: 'расход', event_payment: 'оплата мероприятия', acquiring: 'эквайринг (зачисление по картам)', transfer: 'перевод между своими счетами / инкассация', ignored: 'не учитывается' };

export async function listBankLines(userId: string, orgId: string, input: unknown) {
  const d = parse(z.object({ status: z.enum(['new', 'all']).default('new') }), input);
  return inOrg(userId, orgId, 'payment.manage', async (tx) => {
    const rows = (await tx.query(`select b.*, b.op_date::text as op_date, b.amount::float8 as amount from bank_lines b where b.organization_id = $1 and ($2 = 'all' or b.status = 'new') order by b.op_date, b.doc_no limit 500`, [orgId, d.status])).rows;
    const sups = (await tx.query(`select id, name, inn from suppliers where organization_id = $1 and inn is not null`, [orgId])).rows;
    return rows.map((b) => {
      const s = b.counterparty_inn ? sups.find((x) => x.inn === b.counterparty_inn) : null;
      const suggest = b.status !== 'new' ? null : s ? { kind: 'supplier_payment', supplier_id: s.id, supplier: s.name }
        : b.amount > 0 && /эквайр|возмещ|терминал|по картам|торгов/i.test(b.purpose || '') ? { kind: 'acquiring' } : null;
      return { ...b, status_label: BANK_STATUS[b.status], suggest };
    });
  });
}

const DecideInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('supplier_payment'), supplierId: z.uuid() }),
  z.object({ kind: z.literal('expense'), category: z.enum(Object.keys(EXPENSE_CATEGORY) as [string, ...string[]], 'Статья расхода.'), siteId: z.uuid().optional().nullable() }),
  z.object({ kind: z.literal('event_payment'), eventId: z.uuid() }),
  z.object({ kind: z.literal('acquiring') }),
  z.object({ kind: z.literal('transfer') }),
  z.object({ kind: z.literal('ignored'), note: reasonT }),
]);

/** Разнести строку выписки: создаёт оплату поставщику, расход или оплату мероприятия; эквайринг и переводы — без двойного счёта. */
export async function decideBankLine(userId: string, orgId: string, lineId: string, input: unknown) {
  const d = parse(DecideInput, input);
  return inOrg(userId, orgId, 'payment.manage', async (tx) => {
    const b = (await tx.query(`select *, op_date::text as op_date, amount::float8 as amount from bank_lines where id = $1 and organization_id = $2 for update`, [parse(z.uuid(), lineId), orgId])).rows[0];
    if (!b) throw Errors.notFound('Строка выписки не найдена.');
    if (b.status !== 'new') throw Errors.conflict(`Строка уже разнесена: ${BANK_STATUS[b.status]}.`);
    const out = b.amount < 0, amount = Math.abs(b.amount), doc = `п/п № ${b.doc_no || '—'} от ${b.op_date.split('-').reverse().join('.')}`;
    const set = async (status: string, extra: Record<string, unknown> = {}) => {
      const cols = Object.keys(extra), vals = Object.values(extra);
      await tx.query(`update bank_lines set status = $2, decided_by = $3, decided_at = now(), note = $4${cols.map((c, i) => `, ${c} = $${i + 5}`).join('')} where id = $1`,
        [b.id, status, userId, d.kind === 'ignored' ? d.note : null, ...vals]);
    };
    let result: Record<string, unknown> = {};
    if (d.kind === 'supplier_payment') {
      const p = await recordSupplierPayment(tx, orgId, userId, { supplierId: d.supplierId, kind: out ? 'payment' : 'refund', amount, paidOn: b.op_date, method: 'bank', docNo: doc,
        comment: b.purpose, operationId: `bank:${b.id}`, source: 'bank', bankLineId: b.id });
      await set('supplier_payment', { supplier_payment_id: p.id }); result = p;
    } else if (d.kind === 'expense') {
      if (!out) throw Errors.validation('Расход — это списание со счёта; поступление разнесите иначе.');
      if (d.siteId) await getSite(tx, orgId, d.siteId);
      const e = (await tx.query(`insert into expenses (organization_id, site_id, category, kind, on_date, amount, title, basis, payment_method, created_by) values ($1, $2, $3, 'once', $4, $5, $6, $7, 'bank', $8) returning id`,
        [orgId, d.siteId || null, d.category, b.op_date, amount, (b.purpose || b.counterparty || 'расход по выписке').slice(0, 200), `выписка банка, ${doc}${b.counterparty ? `, ${b.counterparty}` : ''}`.slice(0, 300), userId])).rows[0];
      await set('expense', { expense_id: e.id }); result = { expense_id: e.id };
    } else if (d.kind === 'event_payment') {
      if (out) throw Errors.validation('Списание со счёта по мероприятию — это возврат клиенту: оформите его в карточке мероприятия.');
      const st = (await tx.query(`select status from plan_events where id = $1 and organization_id = $2`, [d.eventId, orgId])).rows[0];
      if (!st) throw Errors.notFound('Мероприятие не найдено.');
      const p = await recordEventPayment(tx, orgId, userId, d.eventId, { kind: st.status === 'done' ? 'payment' : 'prepayment', amount, paidOn: b.op_date, method: 'bank', docNo: doc, comment: b.purpose,
        operationId: `bank:${b.id}`, source: 'bank', bankLineId: b.id });
      await set('event_payment', { event_payment_id: p.id }); result = p;
    } else {
      if (d.kind === 'acquiring' && out) throw Errors.validation('Эквайринг — зачисление на счёт; комиссию банка внесите расходом «Эквайринг».');
      await set(d.kind);
    }
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'bank.decide', entityType: 'bank_line', entityId: b.id, after: { kind: d.kind, amount: b.amount, ...result } });
    return { status: d.kind, ...result };
  });
}
