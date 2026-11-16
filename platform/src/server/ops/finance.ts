import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { roleHas } from '../access/roles';
import { inOrg, parse, optText, assertSiteAccess, getSite } from './common';

/**
 * Управленческая экономика (как Expenses / SalesAnalytics / Analytics прежнего ЦЕХ):
 *  - расходы — разовые (на дату) и ежемесячные (на месяц, распределяются по дням периода точно);
 *  - P&L: выручка − себестоимость продаж (по фактически списанным партиям) − списания (потери) − расходы = прибыль;
 *    Prime Cost = себестоимость продаж + ФОТ; неполные данные помечаются, а не считаются нулём;
 *  - ABC по выручке и по марже (A — первые 80 %, B — следующие 15 %, C — остальные 5 %); XYZ — по коэффициенту
 *    вариации недельных продаж (X ≤ 10 %, Y ≤ 25 %, Z > 25 %), при периоде меньше 3 недель — не рассчитывается.
 */

export const EXPENSE_CATEGORY: Record<string, string> = { payroll: 'ФОТ (зарплата и взносы)', rent: 'Аренда', utilities: 'Коммунальные услуги', marketing: 'Маркетинг',
  services: 'Услуги (связь, вывоз, обслуживание)', equipment: 'Оборудование и ремонт', taxes: 'Налоги и сборы', acquiring: 'Эквайринг', delivery: 'Доставка', other: 'Прочее' };
export const MGMT_NOTE = 'Отчет управленческий. Не является бухгалтерской или налоговой отчетностью.';
/** Статус полноты цифр (ТЗ доработки, 9.1). */
export const COMPLETENESS: Record<string, string> = { full: 'полный', incomplete: 'неполный', approximate: 'ориентировочный', estimated: 'расчетный', unconfirmed: 'есть неподтвержденные данные' };
const r2 = (x: number) => Math.round(x * 100) / 100;

const Period = z.object({ from: z.iso.date('Дата начала — ГГГГ-ММ-ДД.'), to: z.iso.date('Дата конца — ГГГГ-ММ-ДД.'), siteId: z.uuid().nullable().optional() })
  .refine((p) => p.from <= p.to, 'Начало периода позже конца.').refine((p) => (Date.parse(p.to) - Date.parse(p.from)) / 86400e3 <= 370, 'Период — не больше года.');

/* ───────────── Расходы ───────────── */

const ExpenseInput = z.object({
  siteId: z.uuid().nullable().optional(),
  category: z.enum(Object.keys(EXPENSE_CATEGORY) as [string, ...string[]], 'Выберите статью расхода.'),
  kind: z.enum(['once', 'monthly']),
  date: z.iso.date('Дата — ГГГГ-ММ-ДД.'),
  amount: z.coerce.number('Сумма.').positive('Сумма больше нуля.').max(1e10),
  title: z.string('Что за расход.').trim().min(2, 'Что за расход.').max(200),
  basis: optText(300),
});

export async function addExpense(userId: string, orgId: string, input: unknown) {
  const d = parse(ExpenseInput, input);
  return inOrg(userId, orgId, 'expense.manage', async (tx, m) => {
    if (d.siteId) { await getSite(tx, orgId, d.siteId); assertSiteAccess(m, d.siteId); }
    const onDate = d.kind === 'monthly' ? `${d.date.slice(0, 8)}01` : d.date;
    const e = (await tx.query(`insert into expenses (organization_id, site_id, category, kind, on_date, amount, title, basis, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [orgId, d.siteId || null, d.category, d.kind, onDate, d.amount, d.title, d.basis, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId || null, actorUserId: userId, action: 'expense.add', entityType: 'expense', entityId: e.id, after: { ...d, on_date: onDate } });
    return e;
  });
}

export async function voidExpense(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(z.object({ reason: z.string('Причина.').trim().min(5, 'Укажите причину аннулирования.').max(300) }), input);
  return inOrg(userId, orgId, 'expense.manage', async (tx) => {
    const e = (await tx.query(`select * from expenses where id = $1 and organization_id = $2 for update`, [parse(z.uuid(), id), orgId])).rows[0];
    if (!e) throw Errors.notFound('Расход не найден.');
    if (e.voided_at) throw Errors.conflict('Расход уже аннулирован.');
    await tx.query(`update expenses set voided_by = $2, voided_at = now(), void_reason = $3 where id = $1`, [e.id, userId, d.reason]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'expense.void', entityType: 'expense', entityId: e.id, reason: d.reason, before: { amount: e.amount, title: e.title } });
    return { ok: true };
  });
}

/** Расходы, попадающие в период: разовые — по дате, ежемесячные — долей дней месяца внутри периода. */
async function expensesIn(tx: Tx, orgId: string, from: string, to: string, siteId: string | null) {
  const rows = (await tx.query(`select e.*, e.on_date::text as on_date, s.name as site_name, u.full_name as created_by_name from expenses e left join sites s on s.id = e.site_id
    join users u on u.id = e.created_by
    where e.organization_id = $1 and ($4::uuid is null or e.site_id is null or e.site_id = $4)
      and ((e.kind = 'once' and e.on_date between $2::date and $3::date) or (e.kind = 'monthly' and e.on_date <= $3::date and (e.on_date + interval '1 month')::date > $2::date))
    order by e.on_date, e.created_at`, [orgId, from, to, siteId])).rows;
  return rows.map((e) => {
    let share = 1;
    if (e.kind === 'monthly') {
      const start = new Date(`${e.on_date}T00:00:00Z`), end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
      const days = (end.getTime() - start.getTime()) / 86400e3;
      const a = Math.max(start.getTime(), Date.parse(`${from}T00:00:00Z`)), b = Math.min(end.getTime(), Date.parse(`${to}T00:00:00Z`) + 86400e3);
      share = Math.max(0, (b - a) / 86400e3) / days;
    }
    return { id: e.id, category: e.category, category_label: EXPENSE_CATEGORY[e.category], kind: e.kind, on_date: e.on_date, amount: Number(e.amount), title: e.title, basis: e.basis,
      site_name: e.site_name, created_by_name: e.created_by_name, voided: !!e.voided_at, void_reason: e.void_reason, share: Math.round(share * 10000) / 10000,
      in_period: e.voided_at ? 0 : r2(Number(e.amount) * share) };
  });
}

export async function listExpenses(userId: string, orgId: string, input: unknown) {
  const p = parse(Period, input);
  return inOrg(userId, orgId, 'econ.read', async (tx, m) => {
    if (p.siteId) assertSiteAccess(m, p.siteId);
    return { rows: await expensesIn(tx, orgId, p.from, p.to, p.siteId || null), categories: EXPENSE_CATEGORY, can_manage: roleHas(m.role, 'expense.manage') };
  });
}

/* ───────────── P&L ───────────── */

/**
 * P&L и сводка руководителя (ТЗ доработки, 9.2–9.3):
 *   чистая выручка (валовая − возвраты) − себестоимость продаж = валовая прибыль;
 *   валовая прибыль − списания − ФОТ − операционные расходы = управленческая прибыль.
 * Фудкост, наценка и маржинальность — только по продажам с известной себестоимостью; неизвестная себестоимость
 * нулём не считается. Статус полноты — с перечнем причин (9.1).
 */
export async function pnl(userId: string, orgId: string, input: unknown) {
  const p = parse(Period, input);
  return inOrg(userId, orgId, 'econ.read', async (tx, m) => {
    if (p.siteId) assertSiteAccess(m, p.siteId);
    const tz = (await tx.query(`select timezone from organizations where id = $1`, [orgId])).rows[0].timezone;
    const per = `between (($2::date)::timestamp at time zone $4) and ((($3::date) + 1)::timestamp at time zone $4)`;
    const args = [orgId, p.from, p.to, tz, p.siteId || null];
    const s = (await tx.query(`select
        coalesce(sum(amount) filter (where qty > 0), 0) as gross, coalesce(-sum(amount) filter (where qty < 0), 0) as returns,
        count(distinct coalesce(order_id::text, source || ':' || external_id)) filter (where qty > 0)::int as orders,
        coalesce(sum(cost) filter (where qty > 0 and fulfil_status = 'done' and cost is not null), 0) as cogs,
        coalesce(sum(amount) filter (where qty > 0 and fulfil_status = 'done' and cost is not null), 0) as costed_revenue,
        count(*) filter (where qty > 0 and (fulfil_status <> 'done' or cost is null))::int as uncosted,
        coalesce(sum(amount) filter (where qty > 0 and (fulfil_status <> 'done' or cost is null)), 0) as uncosted_amount,
        count(*) filter (where qty > 0 and fulfil_status in ('no_ttk', 'unmatched'))::int as no_ttk,
        count(*) filter (where qty > 0 and fulfil_status in ('pending', 'failed'))::int as not_written_off,
        count(*) filter (where qty > 0 and coalesce(price, 0) <= 0)::int as no_price,
        count(*) filter (where source <> 'pos')::int as imported
      from (select s.*, ol.order_id from sales s left join pos_order_lines ol on ol.id = s.order_line_id
        where s.organization_id = $1 and ($5::uuid is null or s.site_id = $5) and s.sold_at ${per}) x`, args)).rows[0];
    const w = (await tx.query(`select coalesce(sum(-m.quantity * l.unit_price) filter (where l.unit_price is not null), 0) as value,
        count(*) filter (where l.unit_price is null)::int as unpriced
      from stock_movements m join lots l on l.id = m.lot_id where m.organization_id = $1 and ($5::uuid is null or m.site_id = $5) and m.kind = 'write_off' and m.created_at ${per}`, args)).rows[0];
    const lotsNoPrice = Number((await tx.query(`select count(*) from lots where organization_id = $1 and ($5::uuid is null or site_id = $5) and unit_price is null and quantity > 0
      and opened_at is null and coalesce(received_at, created_at) ${per}`, args)).rows[0].count);
    const noDocs = Number((await tx.query(`select count(*) from receipts where organization_id = $1 and ($5::uuid is null or site_id = $5) and status <> 'draft'
      and coalesce(document_no, '') = '' and completed_at ${per}`, args)).rows[0].count);
    const card = Number((await tx.query(`select coalesce(sum(amount), 0) as c from pos_payments where organization_id = $1 and ($5::uuid is null or site_id = $5) and method = 'card' and created_at ${per}`, args)).rows[0].c);
    const ex = await expensesIn(tx, orgId, p.from, p.to, p.siteId || null);
    const byCat: Record<string, number> = {};
    for (const e of ex) if (e.in_period) byCat[e.category] = r2((byCat[e.category] || 0) + e.in_period);

    const gross = r2(Number(s.gross)), returns = r2(Number(s.returns)), revenue = r2(gross - returns);
    const cogs = r2(Number(s.cogs)), costedRev = r2(Number(s.costed_revenue));
    const losses = r2(Number(w.value)), payroll = byCat.payroll || 0;
    const opexOther = r2(Object.entries(byCat).filter(([k]) => k !== 'payroll').reduce((a, [, v]) => a + v, 0));
    const grossProfit = r2(revenue - cogs);
    const profit = r2(grossProfit - losses - payroll - opexOther);
    const prime = r2(cogs + payroll);
    const pct = (x: number, base = revenue) => (base > 0 ? Math.round(x / base * 1000) / 10 : null);

    // причины неполноты (9.1) и статус
    const reasons: { code: string; text: string; affects: 'cost' | 'expenses' | 'confirmation' }[] = [];
    if (s.no_ttk) reasons.push({ code: 'sales_no_ttk', affects: 'cost', text: `продажи без ТТК или без сопоставления с блюдом: ${s.no_ttk}` });
    if (s.not_written_off) reasons.push({ code: 'sales_not_written_off', affects: 'cost', text: `продажи без списания по ТТК (в очереди или с ошибкой): ${s.not_written_off}` });
    const noCost = Number(s.uncosted) - Number(s.no_ttk) - Number(s.not_written_off);
    if (noCost > 0) reasons.push({ code: 'sales_no_cost', affects: 'cost', text: `продажи без себестоимости (у списанных партий нет цены): ${noCost}` });
    if (Number(s.uncosted)) reasons.push({ code: 'uncosted_total', affects: 'cost', text: `итого продаж без себестоимости: ${s.uncosted} на ${r2(Number(s.uncosted_amount))} ₽ — фудкост и прибыль считаются только по продажам с известной себестоимостью` });
    if (s.no_price) reasons.push({ code: 'sales_no_price', affects: 'cost', text: `продажи без цены: ${s.no_price}` });
    if (lotsNoPrice) reasons.push({ code: 'lots_no_price', affects: 'cost', text: `партии без цены, поступившие в периоде: ${lotsNoPrice}` });
    if (w.unpriced) reasons.push({ code: 'writeoffs_no_price', affects: 'cost', text: `списания без цены партии: ${w.unpriced} (потери занижены)` });
    if (!payroll) reasons.push({ code: 'no_payroll', affects: 'expenses', text: 'неучтенный ФОТ: нет расходов на зарплату за период' });
    const missingCats = ['rent', 'utilities'].filter((k) => !byCat[k]);
    if (missingCats.length) reasons.push({ code: 'expenses_incomplete', affects: 'expenses', text: `неполные расходы: не внесены ${missingCats.map((k) => EXPENSE_CATEGORY[k].toLowerCase()).join(', ')}` });
    if (card > 0 && !byCat.acquiring) reasons.push({ code: 'no_acquiring', affects: 'expenses', text: `оплаты картой ${r2(card)} ₽, а расходов на эквайринг нет` });
    if (noDocs) reasons.push({ code: 'no_purchase_docs', affects: 'confirmation', text: `приёмки без номера закупочного документа: ${noDocs}` });
    if (s.imported) reasons.push({ code: 'imported_sales', affects: 'confirmation', text: `продажи из внешней кассы (импорт): ${s.imported} — сверяются с ККТ вне системы` });
    const status = reasons.some((r) => r.affects === 'cost') ? 'incomplete' : reasons.some((r) => r.affects === 'expenses') ? 'approximate'
      : reasons.some((r) => r.affects === 'confirmation') ? 'unconfirmed' : 'full';

    return {
      period: p, note: MGMT_NOTE, status, status_label: COMPLETENESS[status], reasons,
      gross_revenue: gross, returns, revenue, orders: s.orders, avg_check: s.orders ? r2(revenue / s.orders) : null,
      cogs, costed_revenue: costedRev, food_cost_pct: pct(cogs, costedRev), markup_pct: cogs > 0 ? Math.round((costedRev - cogs) / cogs * 1000) / 10 : null,
      margin_pct: pct(costedRev - cogs, costedRev), gross_margin: grossProfit,
      losses, losses_unpriced: w.unpriced, payroll, prime_cost: prime, expenses: byCat, opex: r2(payroll + opexOther), opex_other: opexOther, profit,
      pct: { cogs: pct(cogs), gross: pct(grossProfit), losses: pct(losses), opex: pct(r2(payroll + opexOther)), profit: pct(profit), prime: pct(prime) },
      categories: EXPENSE_CATEGORY, complete: status === 'full', incomplete: reasons.map((r) => r.text),
    };
  }, p.siteId || null);
}

/* ───────────── ABC / XYZ ───────────── */

function abcClass<T>(items: T[], val: (x: T) => number) {
  const sorted = [...items].filter((x) => val(x) > 0).sort((a, b) => val(b) - val(a));
  const total = sorted.reduce((s, x) => s + val(x), 0);
  const out = new Map<T, { cls: 'A' | 'B' | 'C'; share: number }>();
  let cum = 0;
  for (const x of sorted) {
    const before = cum; cum += val(x);
    // класс — по накопленной доле до позиции: первые 80 % — A, следующие 15 % — B
    out.set(x, { cls: before / total < 0.8 ? 'A' : before / total < 0.95 ? 'B' : 'C', share: Math.round(val(x) / total * 1000) / 10 });
  }
  return out;
}

export async function abcXyz(userId: string, orgId: string, input: unknown) {
  const p = parse(Period, input);
  return inOrg(userId, orgId, 'econ.read', async (tx, m) => {
    if (p.siteId) assertSiteAccess(m, p.siteId);
    const tz = (await tx.query(`select timezone from organizations where id = $1`, [orgId])).rows[0].timezone;
    const per = `between (($2::date)::timestamp at time zone $4) and ((($3::date) + 1)::timestamp at time zone $4)`;
    const args = [orgId, p.from, p.to, tz, p.siteId || null];
    const rows = (await tx.query(`select s.dish_id, coalesce(d.name, s.name) as name, sum(s.qty) as qty, sum(s.amount) as revenue,
        sum(s.cost) filter (where s.fulfil_status = 'done' and s.cost is not null) as cost, bool_or(s.qty > 0 and (s.fulfil_status <> 'done' or s.cost is null)) as incomplete
      from sales s left join dishes d on d.id = s.dish_id where s.organization_id = $1 and ($5::uuid is null or s.site_id = $5) and s.sold_at ${per}
      group by 1, 2 having sum(s.qty) > 0`, args)).rows.map((r) => ({ dish_id: r.dish_id as string | null, name: r.name as string, qty: Number(r.qty), revenue: r2(Number(r.revenue)),
      cost: r.cost === null ? null : r2(Number(r.cost)), incomplete: r.incomplete as boolean }));
    const weeks = Math.floor(((Date.parse(p.to) - Date.parse(p.from)) / 86400e3 + 1) / 7);
    const weekly = new Map<string, number[]>();
    if (weeks >= 3) {
      const w = (await tx.query(`select coalesce(s.dish_id::text, s.name) as key, (((s.sold_at at time zone $4)::date - $2::date) / 7)::int as wk, sum(s.qty) as qty
        from sales s where s.organization_id = $1 and ($5::uuid is null or s.site_id = $5) and s.sold_at ${per} group by 1, 2`, args)).rows;
      for (const x of w) { if (x.wk >= weeks) continue; const a = weekly.get(x.key) || Array(weeks).fill(0); a[x.wk] = Number(x.qty); weekly.set(x.key, a); }
    }
    const withMargin = rows.map((r) => ({ ...r, margin: r.cost === null || r.incomplete ? null : r2(r.revenue - r.cost) }));
    const byRev = abcClass(withMargin, (x) => x.revenue);
    const marginKnown = withMargin.every((x) => x.margin !== null);
    const byMargin = marginKnown ? abcClass(withMargin, (x) => x.margin!) : null;
    const out = withMargin.map((r) => {
      const a = weekly.get(r.dish_id || r.name) || (weeks >= 3 ? Array(weeks).fill(0) : null);
      let cv: number | null = null, xyz: 'X' | 'Y' | 'Z' | null = null;
      if (a) {
        const mean = a.reduce((s, x) => s + x, 0) / a.length;
        const sd = Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / a.length);
        cv = mean > 0 ? Math.round(sd / mean * 1000) / 10 : null;
        xyz = cv === null ? null : cv <= 10 ? 'X' : cv <= 25 ? 'Y' : 'Z';
      }
      return { ...r, abc_revenue: byRev.get(r)?.cls || 'C', revenue_share: byRev.get(r)?.share || 0, abc_margin: byMargin ? byMargin.get(r)?.cls || 'C' : null, cv, xyz };
    }).sort((a, b) => b.revenue - a.revenue);
    return { period: p, weeks, xyz_available: weeks >= 3, margin_available: marginKnown, rows: out,
      notes: [!marginKnown ? 'ABC по марже не рассчитан: у части продаж нет себестоимости.' : '', weeks < 3 ? 'XYZ не рассчитан: в периоде меньше 3 полных недель.' : ''].filter(Boolean) };
  }, p.siteId || null);
}
