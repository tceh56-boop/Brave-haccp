import { z } from 'zod';
import { Errors } from '../http/errors';
import { roleHas } from '../access/roles';
import { inOrg, parse, assertSiteAccess } from './common';

/**
 * Баланс и экономика партии (ТЗ 3.0 §9.3, §10.3, §13.4; мастер-промт, этап 1).
 *  Баланс: начальный остаток 0 + приход + выпуск + получено − расход − передано − списания ± инвентаризация = расчётный остаток;
 *  сверяется с остатком партии. Расхождение показывается, а не подгоняется.
 *  Потери — по классам (функция loss_class в БД, по виду движения и причине).
 *  Стоимость — по цене партии (lots.unit_price), только при праве cost.read; для партии выпуска — снимок расчёта
 *  (cost_basis): входные партии, количества, цены, формула и метод. Для приёмки — цена строки приёмки.
 */

export const LOSS_CLASS: Record<string, string> = { technological: 'Технологические', sanitary: 'Санитарные (порча, брак, отзыв)', emergency: 'Аварийные (повреждение)',
  commercial: 'Коммерческие (истёк срок)', unexplained: 'Необъяснённые (требуют разбора)' };

const GROUP: Record<string, { group: 'in' | 'out' | 'loss' | 'adjust'; label: string }> = {
  receipt: { group: 'in', label: 'Приёмка' }, produce: { group: 'in', label: 'Выпуск' }, transfer_in: { group: 'in', label: 'Получено перемещением' }, open_in: { group: 'in', label: 'Из вскрытой тары' },
  consume: { group: 'out', label: 'Расход' }, open_out: { group: 'out', label: 'Вскрыто (в новую партию)' }, transfer_out: { group: 'out', label: 'Передано на другую площадку' },
  return_to_supplier: { group: 'out', label: 'Возврат поставщику' }, write_off: { group: 'loss', label: 'Списание' }, count_adjust: { group: 'adjust', label: 'Инвентаризация' },
};
const REF: Record<string, string> = { production: 'в производство', sale: 'по продажам (расчётное списание)', banquet: 'на мероприятие', manual: 'прочий расход' };
const r3 = (x: number) => Math.round(x * 1000) / 1000, r2 = (x: number) => Math.round(x * 100) / 100;

export async function lotBalance(userId: string, orgId: string, lotId: string) {
  return inOrg(userId, orgId, 'lot.read', async (tx, m) => {
    const l = (await tx.query(`select l.*, p.name as product from lots l join products p on p.id = l.product_id where l.id = $1 and l.organization_id = $2`, [parse(z.uuid(), lotId), orgId])).rows[0];
    if (!l) throw Errors.notFound('Партия не найдена.');
    assertSiteAccess(m, l.site_id);
    const seeCost = roleHas(m.role, 'cost.read');
    const price = l.unit_price === null ? null : Number(l.unit_price);
    const mv = (await tx.query(`select kind, ref_type, loss_class(kind, reason_code, quantity) as loss_class, sum(quantity)::float8 as q, count(*)::int as n
      from stock_movements where lot_id = $1 group by 1, 2, 3 order by 1, 2, 3`, [l.id])).rows;
    const rows = mv.map((x) => {
      const g = GROUP[x.kind] || { group: 'adjust', label: x.kind };
      const label = x.kind === 'consume' ? `${g.label} ${REF[x.ref_type] || x.ref_type || ''}`.trim()
        : x.kind === 'count_adjust' ? (x.q < 0 ? 'Инвентаризация: недостача' : 'Инвентаризация: излишек')
        : x.kind === 'write_off' ? `Списание — ${LOSS_CLASS[x.loss_class]?.toLowerCase() || 'без класса'}` : g.label;
      return { kind: x.kind, group: x.loss_class ? 'loss' : g.group, label, loss_class: x.loss_class, quantity: r3(x.q), operations: x.n, value: seeCost && price !== null ? r2(x.q * price) : null };
    }).sort((a, b) => ['in', 'out', 'loss', 'adjust'].indexOf(a.group) - ['in', 'out', 'loss', 'adjust'].indexOf(b.group));
    const sum = (f: (r: (typeof rows)[number]) => boolean) => r3(rows.filter(f).reduce((s, r) => s + r.quantity, 0));
    const closing = sum(() => true);
    const actual = r3(Number(l.quantity));
    const losses = Object.keys(LOSS_CLASS).map((k) => ({ class: k, label: LOSS_CLASS[k], quantity: -sum((r) => r.loss_class === k), value: null as number | null }))
      .filter((x) => x.quantity > 0).map((x) => ({ ...x, value: seeCost && price !== null ? r2(x.quantity * price) : null }));
    // основание цены: приёмка (строка документа) или снимок выпуска; у вскрытой и перемещённой — цена исходной партии
    let basis: unknown = null;
    if (seeCost) {
      if (l.cost_basis) basis = { source: 'production', ...l.cost_basis };
      else if (l.receipt_line_id) {
        const rl = (await tx.query(`select r.id as receipt_id, r.document_no, r.document_date, rl.unit_price::float8 as unit_price, rl.quantity::float8 as quantity, rl.unit
          from receipt_lines rl join receipts r on r.id = rl.receipt_id where rl.id = $1`, [l.receipt_line_id])).rows[0];
        const parent = (await tx.query(`select k.kind, k.parent_lot_id from lot_links k where k.child_lot_id = $1`, [l.id])).rows[0];
        basis = { source: parent ? `${parent.kind === 'opened' ? 'вскрытие' : 'перемещение'} — цена исходной партии` : 'receipt', formula: 'цена строки приёмки', ...rl, parent_lot_id: parent?.parent_lot_id || null };
      } else if ((await tx.query(`select 1 from stock_movements where lot_id = $1 and kind = 'produce'`, [l.id])).rowCount) {
        basis = { source: 'партия выпущена до сохранения снимка расчёта: входные партии — в прослеживаемости, формула не сохранена' };
      }
    }
    return {
      lot: { id: l.id, product: l.product, lot_no: l.lot_no, unit: l.unit, status: l.status, unit_price: seeCost ? price : null },
      rows, totals: { in: sum((r) => r.group === 'in'), out: -sum((r) => r.group === 'out'), losses: -sum((r) => r.group === 'loss'), adjust: sum((r) => r.group === 'adjust') },
      opening: 0, closing, actual, mismatch: Math.abs(closing - actual) > 1e-6 ? r3(actual - closing) : null, losses,
      value: seeCost && price !== null ? { remaining: r2(actual * price), losses: r2(losses.reduce((s, x) => s + x.quantity, 0) * price) } : null,
      cost_basis: basis, cost_visible: seeCost,
    };
  });
}
