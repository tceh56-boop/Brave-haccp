import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, assertSiteAccess, getSite } from './common';
import { pnl, abcXyz, EXPENSE_CATEGORY, MGMT_NOTE } from './finance';
import { WRITE_OFF_REASONS } from './stock';
import type { Table } from './tableExport';

/**
 * Управленческие отчёты (ТЗ доработки, 9.4): склад в рублях, закупки по поставщикам, изменение закупочных цен,
 * потери по причинам, прибыль по блюдам / площадкам / каналам, план-факт бюджета, движение денежных средств,
 * оборачиваемость, неликвиды и просроченные остатки, полнота данных. Неизвестная цена — не ноль: такие строки
 * показываются отдельно и делают итог неполным. Дебиторская и кредиторская задолженность в системе не ведутся —
 * отчёт об этом прямо говорит.
 */

export const REPORTS = {
  stock_value: 'Остатки склада в рублях',
  purchases: 'Закупки по поставщикам',
  price_changes: 'Изменение закупочных цен',
  losses: 'Потери по причинам',
  dishes: 'Прибыль по блюдам',
  sites: 'Прибыль по площадкам',
  channels: 'Прибыль по каналам продаж',
  plan_fact: 'План-факт бюджета',
  cash_flow: 'Движение денежных средств',
  turnover: 'Оборачиваемость запасов',
  illiquid: 'Неликвиды и просроченные остатки',
  completeness: 'Полнота данных',
  debts: 'Дебиторская и кредиторская задолженность',
} as const;
export type ReportKind = keyof typeof REPORTS;

const Input = z.object({ kind: z.enum(Object.keys(REPORTS) as [ReportKind, ...ReportKind[]]), from: z.iso.date(), to: z.iso.date(), siteId: z.uuid().nullable().optional() })
  .refine((p) => p.from <= p.to, 'Начало периода позже конца.').refine((p) => (Date.parse(p.to) - Date.parse(p.from)) / 86400e3 <= 370, 'Период — не больше года.');
const r2 = (v: number) => Math.round(v * 100) / 100;
const CHANNEL: Record<string, string> = { pos: 'Касса ЦЕХ (зал, вынос)', iiko: 'iiko (импорт)', r_keeper: 'r_keeper (импорт)', other: 'Другая касса (импорт)', import: 'Импорт' };
const METHOD: Record<string, string> = { cash: 'Наличные', card: 'Карта', other: 'Прочее' };

type Ctx = { tx: Tx; orgId: string; userId: string; from: string; to: string; siteId: string | null; tz: string; per: string; args: unknown[] };

async function build(c: Ctx, kind: ReportKind): Promise<Table> {
  const { tx, per, args } = c;
  const q = async (sql: string, a: unknown[] = args) => (await tx.query(sql, a)).rows;
  switch (kind) {
    case 'stock_value': {
      const rows = (await q(`select p.name, l.unit, sum(l.quantity)::float as qty, count(*)::int as lots,
          sum(l.quantity * l.unit_price) filter (where l.unit_price is not null)::float as value,
          count(*) filter (where l.unit_price is null)::int as unpriced,
          sum(l.quantity * l.unit_price) filter (where l.unit_price is not null and l.expires_at < now())::float as expired_value
        from lots l join products p on p.id = l.product_id where l.organization_id = $1 and ($5::uuid is null or l.site_id = $5)
          and l.quantity > 0 and l.status in ('available', 'quarantine', 'blocked') and ($2::text is not null and $3::text is not null and $4::text is not null)
        group by p.name, l.unit order by value desc nulls last`));
      const unpriced = rows.reduce((s, r) => s + r.unpriced, 0);
      return { title: REPORTS.stock_value, columns: [{ key: 'name', label: 'Товар' }, { key: 'qty', label: 'Остаток', type: 'num' }, { key: 'unit', label: 'Ед.' }, { key: 'lots', label: 'Партий', type: 'num' },
          { key: 'value', label: 'Стоимость, ₽', type: 'money' }, { key: 'expired_value', label: 'В т. ч. с истёкшим сроком, ₽', type: 'money' }, { key: 'unpriced', label: 'Партий без цены', type: 'num' }],
        rows, totals: { name: 'Итого', value: r2(rows.reduce((s, r) => s + (r.value || 0), 0)), expired_value: r2(rows.reduce((s, r) => s + (r.expired_value || 0), 0)), unpriced },
        notes: [`Остаток на момент формирования; стоимость — по цене партий.${unpriced ? ` Партий без цены: ${unpriced} — их стоимость не включена, итог неполный.` : ''}`] };
    }
    case 'purchases': {
      const rows = (await q(`select coalesce(s.name, 'Поставщик не указан') as supplier, count(distinct r.id)::int as receipts, count(l.id)::int as lines,
          sum(l.quantity * l.unit_price) filter (where l.unit_price is not null)::float as amount, count(l.id) filter (where l.unit_price is null)::int as unpriced,
          count(distinct r.id) filter (where coalesce(r.document_no, '') = '')::int as no_doc
        from receipts r join receipt_lines l on l.receipt_id = r.id left join suppliers s on s.id = r.supplier_id
        where r.organization_id = $1 and ($5::uuid is null or r.site_id = $5) and r.status <> 'draft' and l.decision <> 'rejected' and r.completed_at ${per}
        group by 1 order by amount desc nulls last`));
      return { title: REPORTS.purchases, columns: [{ key: 'supplier', label: 'Поставщик' }, { key: 'receipts', label: 'Приёмок', type: 'num' }, { key: 'lines', label: 'Позиций', type: 'num' },
          { key: 'amount', label: 'Сумма, ₽', type: 'money' }, { key: 'unpriced', label: 'Позиций без цены', type: 'num' }, { key: 'no_doc', label: 'Приёмок без документа', type: 'num' }],
        rows, totals: { supplier: 'Итого', receipts: rows.reduce((s, r) => s + r.receipts, 0), amount: r2(rows.reduce((s, r) => s + (r.amount || 0), 0)), unpriced: rows.reduce((s, r) => s + r.unpriced, 0) },
        notes: ['Принятые позиции (отклонённые не входят), по ценам приёмки.'] };
    }
    case 'price_changes': {
      const rows = (await q(`with x as (select p.name, l.unit, l.unit_price::float as price, r.completed_at,
          row_number() over (partition by l.product_id order by r.completed_at) as rn, count(*) over (partition by l.product_id) as cnt
          from receipt_lines l join receipts r on r.id = l.receipt_id join products p on p.id = l.product_id
          where r.organization_id = $1 and ($5::uuid is null or r.site_id = $5) and r.status <> 'draft' and l.unit_price is not null and r.completed_at ${per})
        select name, unit, max(cnt)::int as deliveries, max(price) filter (where rn = 1) as first, max(price) filter (where rn = cnt) as last, min(price) as min, max(price) as max
        from x group by name, unit having max(cnt) > 1 order by name`)).map((r) => ({ ...r, change: r.first ? Math.round((r.last - r.first) / r.first * 1000) / 10 : null }))
        .sort((a, b) => Math.abs(b.change || 0) - Math.abs(a.change || 0));
      return { title: REPORTS.price_changes, columns: [{ key: 'name', label: 'Товар' }, { key: 'unit', label: 'Ед.' }, { key: 'deliveries', label: 'Поставок', type: 'num' },
          { key: 'first', label: 'Первая цена, ₽', type: 'money' }, { key: 'last', label: 'Последняя цена, ₽', type: 'money' }, { key: 'min', label: 'Мин., ₽', type: 'money' }, { key: 'max', label: 'Макс., ₽', type: 'money' }, { key: 'change', label: 'Изменение', type: 'pct' }],
        rows, notes: ['Товары с двумя и более поставками за период; цены — за единицу партии.'] };
    }
    case 'losses': {
      const rows = (await q(`select coalesce(m.reason_code, 'other') as code, count(*)::int as cnt,
          sum(-m.quantity * l.unit_price) filter (where l.unit_price is not null)::float as value, count(*) filter (where l.unit_price is null)::int as unpriced
        from stock_movements m join lots l on l.id = m.lot_id where m.organization_id = $1 and ($5::uuid is null or m.site_id = $5) and m.kind = 'write_off' and m.created_at ${per}
        group by 1 order by value desc nulls last`)).map((r) => ({ reason: WRITE_OFF_REASONS[r.code as keyof typeof WRITE_OFF_REASONS] || r.code, ...r }));
      const unpriced = rows.reduce((s, r) => s + r.unpriced, 0);
      return { title: REPORTS.losses, columns: [{ key: 'reason', label: 'Причина' }, { key: 'cnt', label: 'Списаний', type: 'num' }, { key: 'value', label: 'Стоимость, ₽', type: 'money' }, { key: 'unpriced', label: 'Без цены', type: 'num' }],
        rows, totals: { reason: 'Итого', cnt: rows.reduce((s, r) => s + r.cnt, 0), value: r2(rows.reduce((s, r) => s + (r.value || 0), 0)), unpriced },
        notes: unpriced ? [`Списаний без цены партии: ${unpriced} — потери занижены.`] : [] };
    }
    case 'dishes': {
      const a = await abcXyz(c.userId, c.orgId, { from: c.from, to: c.to, siteId: c.siteId });
      const rows = a.rows.map((r) => ({ name: r.name, qty: r.qty, revenue: r.revenue, cost: r.incomplete ? null : r.cost, margin: r.margin,
        margin_pct: r.margin !== null && r.revenue > 0 ? Math.round(r.margin / r.revenue * 1000) / 10 : null, abc: r.abc_revenue, xyz: r.xyz, note: r.incomplete ? 'себестоимость неполная' : '' }));
      return { title: REPORTS.dishes, columns: [{ key: 'name', label: 'Блюдо' }, { key: 'qty', label: 'Продано', type: 'num' }, { key: 'revenue', label: 'Выручка, ₽', type: 'money' }, { key: 'cost', label: 'Себестоимость, ₽', type: 'money' },
          { key: 'margin', label: 'Маржа, ₽', type: 'money' }, { key: 'margin_pct', label: 'Маржа', type: 'pct' }, { key: 'abc', label: 'ABC' }, { key: 'xyz', label: 'XYZ' }, { key: 'note', label: 'Примечание' }],
        rows, totals: { name: 'Итого', revenue: r2(rows.reduce((s, r) => s + r.revenue, 0)), margin: rows.every((r) => r.margin !== null) ? r2(rows.reduce((s, r) => s + (r.margin || 0), 0)) : null }, notes: a.notes };
    }
    case 'sites': case 'channels': {
      const by = kind === 'sites' ? 'st.name' : 's.source';
      const rows = (await q(`select ${by} as key, coalesce(sum(s.amount) filter (where s.qty > 0), 0)::float as gross, coalesce(-sum(s.amount) filter (where s.qty < 0), 0)::float as returns,
          coalesce(sum(s.cost) filter (where s.qty > 0 and s.fulfil_status = 'done' and s.cost is not null), 0)::float as cogs,
          count(*) filter (where s.qty > 0 and (s.fulfil_status <> 'done' or s.cost is null))::int as uncosted
        from sales s join sites st on st.id = s.site_id where s.organization_id = $1 and ($5::uuid is null or s.site_id = $5) and s.sold_at ${per} group by 1 order by gross desc`))
        .map((r) => { const net = r2(r.gross - r.returns); return { name: kind === 'sites' ? r.key : CHANNEL[r.key] || r.key, gross: r.gross, returns: r.returns, net, cogs: r.cogs,
          gross_profit: r.uncosted ? null : r2(net - r.cogs), uncosted: r.uncosted }; });
      return { title: REPORTS[kind], columns: [{ key: 'name', label: kind === 'sites' ? 'Площадка' : 'Канал' }, { key: 'gross', label: 'Валовая выручка, ₽', type: 'money' }, { key: 'returns', label: 'Возвраты, ₽', type: 'money' },
          { key: 'net', label: 'Чистая выручка, ₽', type: 'money' }, { key: 'cogs', label: 'Себестоимость, ₽', type: 'money' }, { key: 'gross_profit', label: 'Валовая прибыль, ₽', type: 'money' }, { key: 'uncosted', label: 'Продаж без себестоимости', type: 'num' }],
        rows, totals: { name: 'Итого', net: r2(rows.reduce((s, r) => s + r.net, 0)), cogs: r2(rows.reduce((s, r) => s + r.cogs, 0)) },
        notes: ['Валовая прибыль не показывается, если у части продаж нет себестоимости (неизвестное — не ноль). Расходы по площадкам и каналам не распределяются.'] };
    }
    case 'plan_fact': {
      const f = await pnl(c.userId, c.orgId, { from: c.from, to: c.to, siteId: c.siteId });
      // план: последняя запись бюджета по статье на каждый месяц периода, доля дней месяца в периоде
      const plans = await q(`select distinct on (month, item) month::text, item, amount::float from budgets where organization_id = $1 and ($5::uuid is null or site_id = $5 or site_id is null)
        and month <= $3::date and (month + interval '1 month')::date > $2::date and ($4::text is not null) order by month, item, created_at desc`);
      const plan: Record<string, number> = {};
      for (const p of plans) {
        const start = Date.parse(`${p.month}T00:00:00Z`), endD = new Date(start); endD.setUTCMonth(endD.getUTCMonth() + 1);
        const a = Math.max(start, Date.parse(`${c.from}T00:00:00Z`)), b = Math.min(endD.getTime(), Date.parse(`${c.to}T00:00:00Z`) + 864e5);
        plan[p.item] = r2((plan[p.item] || 0) + p.amount * Math.max(0, b - a) / (endD.getTime() - start));
      }
      const fact: Record<string, number> = { revenue: f.revenue, ...f.expenses };
      const items = [...new Set(['revenue', ...Object.keys(plan), ...Object.keys(f.expenses)])];
      const rows = items.map((k) => ({ item: k === 'revenue' ? 'Чистая выручка' : EXPENSE_CATEGORY[k] || k, plan: plan[k] ?? null, fact: fact[k] ?? 0,
        diff: plan[k] === undefined ? null : r2((fact[k] ?? 0) - plan[k]), pct: plan[k] ? Math.round((fact[k] ?? 0) / plan[k] * 1000) / 10 : null }));
      return { title: REPORTS.plan_fact, columns: [{ key: 'item', label: 'Статья' }, { key: 'plan', label: 'План, ₽', type: 'money' }, { key: 'fact', label: 'Факт, ₽', type: 'money' }, { key: 'diff', label: 'Отклонение, ₽', type: 'money' }, { key: 'pct', label: 'Исполнение', type: 'pct' }],
        rows, notes: [plans.length ? 'План — бюджет по месяцам, долей дней месяца в периоде.' : 'Бюджет на период не внесён — план пустой.', `Факт — данные: ${f.status_label}.`] };
    }
    case 'cash_flow': {
      const inflow = await q(`select method, coalesce(sum(amount) filter (where kind = 'payment'), 0)::float as inc, coalesce(-sum(amount) filter (where kind = 'refund'), 0)::float as ref
        from pos_payments where organization_id = $1 and ($5::uuid is null or site_id = $5) and created_at ${per} group by method`);
      const f = await pnl(c.userId, c.orgId, { from: c.from, to: c.to, siteId: c.siteId });
      const rows = [
        ...inflow.map((r) => ({ item: `Поступления: ${METHOD[r.method] || r.method}`, amount: r2(r.inc) })),
        ...inflow.filter((r) => r.ref).map((r) => ({ item: `Возвраты покупателям: ${METHOD[r.method] || r.method}`, amount: -r2(r.ref) })),
        ...Object.entries(f.expenses).map(([k, v]) => ({ item: `Расходы: ${EXPENSE_CATEGORY[k] || k}`, amount: -v })),
      ];
      return { title: REPORTS.cash_flow, columns: [{ key: 'item', label: 'Статья' }, { key: 'amount', label: 'Сумма, ₽', type: 'money' }],
        rows, totals: { item: 'Сальдо по учтённым движениям', amount: r2(rows.reduce((s, r) => s + r.amount, 0)) },
        notes: ['Поступления — оплаты кассы ЦЕХ; продажи из внешних касс деньгами здесь не учитываются.', 'Оплаты поставщикам в системе не ведутся — в ДДС их нет; расходы — по датам внесения (ежемесячные — долей дней).', 'ДДС неполный, пока не подключены банк и оплаты поставщикам (P3).'] };
    }
    case 'turnover': {
      const f = await pnl(c.userId, c.orgId, { from: c.from, to: c.to, siteId: c.siteId });
      const stock = (await q(`select coalesce(sum(quantity * unit_price) filter (where unit_price is not null), 0)::float as value, count(*) filter (where unit_price is null)::int as unpriced
        from lots where organization_id = $1 and ($5::uuid is null or site_id = $5) and quantity > 0 and status in ('available', 'quarantine', 'blocked') and ($2::text is not null and $3::text is not null and $4::text is not null)`))[0];
      const days = (Date.parse(c.to) - Date.parse(c.from)) / 864e5 + 1;
      const daily = f.cogs / days;
      const rows = [
        { item: 'Себестоимость продаж за период, ₽', value: f.cogs }, { item: 'Дней в периоде', value: days }, { item: 'Запас на складе сейчас, ₽', value: r2(stock.value) },
        { item: 'Оборачиваемость запаса, дней', value: daily > 0 ? Math.round(stock.value / daily * 10) / 10 : null },
      ];
      return { title: REPORTS.turnover, columns: [{ key: 'item', label: 'Показатель' }, { key: 'value', label: 'Значение', type: 'num' }], rows,
        notes: ['Оборачиваемость = текущий запас / средняя дневная себестоимость продаж (средний остаток за период не хранится).', ...(stock.unpriced ? [`Партий без цены: ${stock.unpriced} — запас занижен.`] : []), ...(f.status !== 'full' ? [`Данные продаж: ${f.status_label}.`] : [])] };
    }
    case 'illiquid': {
      const rows = (await q(`select p.name, l.lot_no, l.quantity::float as qty, l.unit, l.expires_at, (l.quantity * l.unit_price)::float as value, l.status,
          (select max(m.created_at) from stock_movements m where m.lot_id = l.id) as last_move
        from lots l join products p on p.id = l.product_id where l.organization_id = $1 and ($5::uuid is null or l.site_id = $5) and l.quantity > 0 and l.status in ('available', 'quarantine', 'blocked')
          and ($2::text is not null and $3::text is not null and $4::text is not null)
          and (l.expires_at < now() or not exists (select 1 from stock_movements m where m.lot_id = l.id and m.created_at > now() - interval '30 days'))
        order by l.expires_at nulls last`)).map((r) => ({ ...r, kind: r.expires_at && new Date(r.expires_at) < new Date() ? 'срок годности истёк' : 'нет движения 30 дней',
          expires: r.expires_at ? new Date(r.expires_at).toLocaleDateString('ru-RU', { timeZone: c.tz }) : '—', last: r.last_move ? new Date(r.last_move).toLocaleDateString('ru-RU', { timeZone: c.tz }) : '—' }));
      return { title: REPORTS.illiquid, columns: [{ key: 'name', label: 'Товар' }, { key: 'lot_no', label: 'Партия' }, { key: 'qty', label: 'Остаток', type: 'num' }, { key: 'unit', label: 'Ед.' },
          { key: 'expires', label: 'Годен до' }, { key: 'last', label: 'Последнее движение' }, { key: 'value', label: 'Стоимость, ₽', type: 'money' }, { key: 'kind', label: 'Почему' }],
        rows, totals: { name: 'Итого', value: r2(rows.reduce((s, r) => s + (r.value || 0), 0)) }, notes: ['На момент формирования; просроченные остатки подлежат списанию по процедуре.'] };
    }
    case 'completeness': {
      const f = await pnl(c.userId, c.orgId, { from: c.from, to: c.to, siteId: c.siteId });
      const noTtk = (await q(`select count(*)::int as n from dishes d where d.organization_id = $1 and d.status = 'active' and d.kind = 'dish'
        and not exists (select 1 from ttk_versions v where v.dish_id = d.id and v.status = 'approved') and ($2::text is not null and $3::text is not null and $4::text is not null and ($5::uuid is null or true))`))[0].n;
      const noCosting = (await q(`select count(*)::int as n from dishes d where d.organization_id = $1 and d.status = 'active' and d.kind = 'dish'
        and exists (select 1 from ttk_versions v where v.dish_id = d.id and v.status = 'approved') and not exists (select 1 from costing_cards k where k.dish_id = d.id)
        and ($2::text is not null and $3::text is not null and $4::text is not null and ($5::uuid is null or true))`))[0].n;
      const rows = [...f.reasons.map((r) => ({ area: r.affects === 'cost' ? 'Себестоимость' : r.affects === 'expenses' ? 'Расходы' : 'Подтверждение', text: r.text })),
        ...(noTtk ? [{ area: 'Меню', text: `блюд без утверждённой ТТК: ${noTtk}` }] : []), ...(noCosting ? [{ area: 'Меню', text: `блюд без калькуляционной карточки: ${noCosting}` }] : [])];
      return { title: REPORTS.completeness, columns: [{ key: 'area', label: 'Область' }, { key: 'text', label: 'Что не хватает' }], rows,
        notes: [`Статус цифр за период: ${f.status_label}.`, rows.length ? 'Пока причины не устранены, отчёты считаются по известным данным и помечаются.' : 'Причин неполноты не найдено.'] };
    }
    case 'debts':
      return { title: REPORTS.debts, columns: [{ key: 'item', label: 'Показатель' }, { key: 'value', label: 'Значение' }],
        rows: [{ item: 'Дебиторская задолженность', value: 'не ведётся: продажи в кредит и счета покупателям в системе не оформляются' },
          { item: 'Кредиторская задолженность', value: 'не ведётся: оплаты поставщикам в системе не фиксируются (план — интеграция с банком и ЭДО, P3)' }],
        notes: ['Система не выдаёт задолженность, которой не знает: пустое значение не равно нулю.'] };
  }
}

export async function econReport(userId: string, orgId: string, input: unknown) {
  const p = parse(Input, input);
  return inOrg(userId, orgId, 'econ.read', async (tx, m) => {
    if (p.siteId) { await getSite(tx, orgId, p.siteId); assertSiteAccess(m, p.siteId); }
    const org = (await tx.query(`select name, legal_form, inn, legal_address, timezone from organizations where id = $1`, [orgId])).rows[0];
    const per = `between (($2::date)::timestamp at time zone $4) and ((($3::date) + 1)::timestamp at time zone $4)`;
    const args = [orgId, p.from, p.to, org.timezone, p.siteId || null];
    const site = p.siteId ? (await tx.query(`select name from sites where id = $1`, [p.siteId])).rows[0].name : 'все площадки';
    const table = await build({ tx, orgId, userId, from: p.from, to: p.to, siteId: p.siteId || null, tz: org.timezone, per, args }, p.kind);
    const dmy = (d: string) => d.split('-').reverse().join('.');
    return { kind: p.kind, table, org: { name: org.name, legal_form: org.legal_form, inn: org.inn, legal_address: org.legal_address },
      subtitle: `Период: ${dmy(p.from)} — ${dmy(p.to)} · ${site}`, generated: new Date().toLocaleString('ru-RU', { timeZone: org.timezone }), note: MGMT_NOTE, reports: REPORTS };
  }, p.siteId || null);
}

/* ───────────── Бюджет (план) ───────────── */

const BudgetInput = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, 'Месяц — ГГГГ-ММ.'), item: z.string().refine((v) => v === 'revenue' || v in EXPENSE_CATEGORY, 'Статья бюджета.'),
  amount: z.coerce.number().min(0).max(1e11), siteId: z.uuid().nullable().optional(), note: z.string().trim().max(300).optional().nullable() });

export async function setBudget(userId: string, orgId: string, input: unknown) {
  const d = parse(BudgetInput, input);
  return inOrg(userId, orgId, 'expense.manage', async (tx, m) => {
    if (d.siteId) { await getSite(tx, orgId, d.siteId); assertSiteAccess(m, d.siteId); }
    const r = (await tx.query(`insert into budgets (organization_id, site_id, month, item, amount, note, created_by) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [orgId, d.siteId || null, `${d.month}-01`, d.item, d.amount, d.note || null, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId || null, actorUserId: userId, action: 'budget.set', entityType: 'budget', entityId: r.id, after: d });
    return r;
  });
}

export async function listBudget(userId: string, orgId: string, monthInput: unknown) {
  const month = parse(z.string().regex(/^\d{4}-\d{2}$/, 'Месяц — ГГГГ-ММ.'), monthInput);
  return inOrg(userId, orgId, 'econ.read', async (tx) => {
    const rows = (await tx.query(`select distinct on (item, site_id) b.item, b.site_id, b.amount::float, b.note, b.created_at, u.full_name as author from budgets b join users u on u.id = b.created_by
      where b.organization_id = $1 and b.month = $2::date order by item, site_id, b.created_at desc`, [orgId, `${month}-01`])).rows;
    if (!rows) throw Errors.notFound('Нет данных.');
    return { month, rows, items: { revenue: 'Чистая выручка', ...EXPENSE_CATEGORY } };
  });
}
