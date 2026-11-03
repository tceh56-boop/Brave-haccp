import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, openTask, closeTasksFor, notifyRoles, fmtNum } from './common';
import { move } from './stock';

/**
 * Блокировка и отзыв партии (ТЗ 3.0 §10.5, сценарий 4 §29.2).
 *  1. Блокировка: исходная партия и все дочерние (вскрытие, перемещение, производство — на любую глубину) с остатком
 *     получают статус «заблокирована»; израсходовать, вскрыть или переместить их нельзя. Прежний статус каждой сохраняется.
 *  2. Затронутое — снимок на момент блокировки: партии с остатком и уже израсходованные, продукция (блюда и п/ф),
 *     продажи, при которых списывались партии цепочки, поставщик и приёмка исходной партии.
 *  3. Перечень действий строится из этих данных; система ничего не решает за человека.
 *  4. Решение — ответственный с правом recall.decide: «вернуть в оборот» (с обоснованием: протокол, ответ поставщика)
 *     или «списать остатки». Решение закрывает задачу и пишется в аудит.
 * Граница (§10.6): найдено только то, что зарегистрировано в системе.
 */

const SOURCES = ['laboratory', 'supplier', 'authority', 'complaint', 'internal'] as const;
export const SOURCE_LABEL: Record<string, string> = { laboratory: 'Лабораторное исследование', supplier: 'Сообщение поставщика или изготовителя', authority: 'Предписание или информация Роспотребнадзора',
  complaint: 'Жалоба гостя', internal: 'Внутренний контроль' };

interface TreeLot { id: string; parent_id: string | null; link: string | null; depth: number; lot_no: string | null; product: string; product_id: string; quantity: number; unit: string;
  status: string; site_id: string; site: string; expires_at: string | null }

/** Партия и все потомки по lot_links (без циклов). */
async function tree(tx: Tx, orgId: string, rootId: string): Promise<TreeLot[]> {
  return (await tx.query(`with recursive t(id, parent_id, link, depth, path) as (
      select l.id, null::uuid, null::text, 0, array[l.id] from lots l where l.id = $1 and l.organization_id = $2
      union all
      select k.child_lot_id, k.parent_lot_id, k.kind, t.depth + 1, t.path || k.child_lot_id from lot_links k join t on k.parent_lot_id = t.id
        where not k.child_lot_id = any(t.path) and t.depth < 30)
    select distinct on (t.id) t.id, t.parent_id, t.link, t.depth, l.lot_no, p.name as product, l.product_id, l.quantity::float8 as quantity, l.unit, l.status, l.site_id, s.name as site, l.expires_at
    from t join lots l on l.id = t.id join products p on p.id = l.product_id join sites s on s.id = l.site_id order by t.id, t.depth`, [rootId, orgId])).rows
    .sort((a, b) => a.depth - b.depth || a.product.localeCompare(b.product));
}

async function affectedOf(tx: Tx, orgId: string, lots: TreeLot[]) {
  const ids = lots.map((l) => l.id);
  const products = [...new Set(lots.map((l) => l.product_id))];
  const dishes = (await tx.query(`select id, name, kind from dishes where organization_id = $1 and product_id = any($2::uuid[]) order by name`, [orgId, products])).rows;
  const sales = (await tx.query(`select s.id, s.name, s.qty::float8 as qty, s.sold_at, s.source, st.name as site, sum(-m.quantity)::float8 as from_chain, m.unit
      from stock_movements m join sales s on s.id = m.ref_id join sites st on st.id = s.site_id
      where m.organization_id = $1 and m.lot_id = any($2::uuid[]) and m.ref_type = 'sale' group by s.id, st.name, m.unit order by s.sold_at`, [orgId, ids])).rows;
  const sold = (await tx.query(`select d.id, d.name, sum(s.qty)::float8 as qty from sales s join dishes d on d.id = s.dish_id where s.id = any($1::uuid[]) group by d.id order by d.name`, [sales.map((s) => s.id)])).rows;
  const origin = (await tx.query(`select r.id as receipt_id, r.document_no, r.document_date, sp.id as supplier_id, sp.name as supplier, sp.inn as supplier_inn, sp.phone as supplier_phone, rl.manufacturer
      from lots l join receipt_lines rl on rl.id = l.receipt_line_id join receipts r on r.id = rl.receipt_id left join suppliers sp on sp.id = r.supplier_id where l.id = $1`, [lots[0].id])).rows[0] || null;
  const inStock = lots.filter((l) => l.quantity > 0 && ['available', 'quarantine', 'blocked'].includes(l.status));
  // продажи без списания партий (режим «только расчёт»): возможно затронуты — блюда с позициями цепочки по ТТК,
  // та же площадка, с момента появления партии. Это расчёт, а не установленный факт (§10.6).
  const sites = [...new Set(lots.map((l) => l.site_id))];
  const since = (await tx.query(`select min(created_at) as t from lots where id = any($1::uuid[])`, [ids])).rows[0].t;
  const possible = (await tx.query(`select distinct s.id, s.name, s.qty::float8 as qty, s.sold_at, st.name as site from consumption_estimates e join sales s on s.id = e.ref_id join sites st on st.id = s.site_id
      where e.organization_id = $1 and e.kind = 'sale' and e.product_id = any($2::uuid[]) and s.site_id = any($3::uuid[]) and s.sold_at >= $4
        and s.id <> all($5::uuid[]) order by s.sold_at`, [orgId, products, sites, since, sales.map((x) => x.id)])).rows;
  return { lots, in_stock: inStock, dishes, sales, sold_dishes: sold, possible_sales: possible, origin };
}

/** Перечень действий — только из найденных данных. */
function actionsFor(a: Awaited<ReturnType<typeof affectedOf>>): string[] {
  const out: string[] = [];
  for (const l of a.in_stock) out.push(`Изолировать и промаркировать «НЕ ИСПОЛЬЗОВАТЬ»: ${l.product}${l.lot_no ? `, партия ${l.lot_no}` : ''} — ${fmtNum(l.quantity)} ${l.unit}, ${l.site}.`);
  if (!a.in_stock.length) out.push('Остатков партии и её дочерних партий в системе нет — проверить места хранения физически (незарегистрированное движение система не видит).');
  if (a.sales.length) out.push(`Оценить риск для реализованной продукции: ${a.sales.length} продаж(и) с ${new Date(a.sales[0].sold_at).toLocaleDateString('ru-RU')} — ${a.sold_dishes.map((d) => `${d.name} × ${fmtNum(d.qty)}`).join(', ')}.`);
  if (a.possible_sales?.length) out.push(`Проверить продажи, где партия могла использоваться (расчёт по ТТК, списание по продажам не ведётся): ${a.possible_sales.length} с ${new Date(a.possible_sales[0].sold_at).toLocaleDateString('ru-RU')} — ${[...new Set(a.possible_sales.map((x) => x.name))].join(', ')}.`);
  if (a.origin?.supplier) out.push(`Сообщить поставщику ${a.origin.supplier}${a.origin.supplier_inn ? ` (ИНН ${a.origin.supplier_inn})` : ''} о блокировке партии; запросить документы и сведения о партии.`);
  if (a.dishes.length) out.push(`Проверить продукцию, в которую входила партия: ${a.dishes.map((d) => d.name).join(', ')}.`);
  out.push('Принять решение: вернуть в оборот (с обоснованием) или списать остатки.');
  return out;
}

const BlockInput = z.object({
  hazard: z.string().trim().min(5, 'Опишите опасность: что обнаружено.').max(1000),
  source: z.enum(SOURCES, 'Укажите источник сведений.'),
});

export async function blockLot(userId: string, orgId: string, lotId: string, input: unknown) {
  const d = parse(BlockInput, input);
  return inOrg(userId, orgId, 'recall.block', async (tx) => {
    const id = parse(z.uuid(), lotId);
    const lots = await tree(tx, orgId, id);
    if (!lots.length) throw Errors.notFound('Партия не найдена.');
    // блокировки по одной партии в двух отзывах не бывает: показываем уже открытый
    const busy = (await tx.query(`select r.id from recall_lots rl join recalls r on r.id = rl.recall_id where rl.lot_id = $1 and r.status = 'open'`, [id])).rows[0];
    if (busy) throw Errors.conflict(`Партия уже заблокирована по открытому отзыву — откройте его: /recalls/${busy.id}`);
    await tx.query(`select 1 from lots where id = any($1::uuid[]) for update`, [lots.map((l) => l.id)]);
    const a = await affectedOf(tx, orgId, lots);
    const r = (await tx.query(`insert into recalls (organization_id, root_lot_id, hazard, source, opened_by, affected) values ($1, $2, $3, $4, $5, $6) returning id, opened_at`,
      [orgId, id, d.hazard, d.source, userId, JSON.stringify({ ...a, actions: actionsFor(a) })])).rows[0];
    let blocked = 0;
    for (const l of a.in_stock) {
      const cur = (await tx.query(`select status, status_reason from lots where id = $1`, [l.id])).rows[0];
      const other = (await tx.query(`select 1 from recall_lots rl join recalls x on x.id = rl.recall_id where rl.lot_id = $1 and x.status = 'open'`, [l.id])).rowCount;
      if (other) continue;                                   // дочерняя партия уже в другом открытом отзыве
      await tx.query(`insert into recall_lots (recall_id, lot_id, organization_id, prev_status, prev_reason, quantity) values ($1, $2, $3, $4, $5, $6)`, [r.id, l.id, orgId, cur.status, cur.status_reason, l.quantity]);
      await tx.query(`update lots set status = 'blocked', status_reason = $2 where id = $1`, [l.id, `отзыв: ${d.hazard}`.slice(0, 500)]);
      blocked++;
    }
    const root = lots[0];
    await openTask(tx, { orgId, siteId: root.site_id, kind: 'recall_decision', title: `Решение по отзыву: ${root.product}${root.lot_no ? `, партия ${root.lot_no}` : ''}`,
      details: `${SOURCE_LABEL[d.source]}: ${d.hazard}. Заблокировано партий: ${blocked}; продаж с партиями цепочки: ${a.sales.length}.`, entityType: 'recall', entityId: r.id,
      assigneeRole: 'haccp_lead', dueAt: new Date(Date.now() + 24 * 3600e3), createdBy: userId });
    await notifyRoles(tx, { orgId, siteId: root.site_id, roles: ['haccp_lead', 'chef', 'director'], title: `Партия заблокирована: ${root.product}${root.lot_no ? ` ${root.lot_no}` : ''}`,
      body: d.hazard, entityType: 'recall', entityId: r.id });
    await audit.record(tx, { organizationId: orgId, siteId: root.site_id, actorUserId: userId, action: 'recall.block', entityType: 'lot', entityId: id,
      after: { recall: r.id, source: d.source, hazard: d.hazard, blocked, lots: lots.length, sales: a.sales.length } });
    return { id: r.id as string, blocked, lots: lots.length, sales: a.sales.length };
  });
}

export async function getRecall(userId: string, orgId: string, recallId: string) {
  return inOrg(userId, orgId, 'trace.read', async (tx) => {
    const r = (await tx.query(`select r.*, u.full_name as opened_by_name, du.full_name as decided_by_name from recalls r join users u on u.id = r.opened_by
      left join users du on du.id = r.decided_by where r.id = $1 and r.organization_id = $2`, [parse(z.uuid(), recallId), orgId])).rows[0];
    if (!r) throw Errors.notFound('Отзыв не найден.');
    const held = (await tx.query(`select rl.lot_id, rl.prev_status, rl.quantity::float8 as quantity_at_block, l.quantity::float8 as quantity, l.status, l.unit, l.lot_no, p.name as product, s.name as site
      from recall_lots rl join lots l on l.id = rl.lot_id join products p on p.id = l.product_id join sites s on s.id = l.site_id where rl.recall_id = $1 order by p.name`, [r.id])).rows;
    return { ...r, source_label: SOURCE_LABEL[r.source], held };
  });
}

export async function listRecalls(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'trace.read', async (tx) => (await tx.query(`select r.id, r.status, r.hazard, r.source, r.opened_at, r.decision, r.decided_at, p.name as product, l.lot_no
    from recalls r join lots l on l.id = r.root_lot_id join products p on p.id = l.product_id where r.organization_id = $1 order by r.status, r.opened_at desc limit 200`, [orgId])).rows
    .map((x) => ({ ...x, source_label: SOURCE_LABEL[x.source] })));
}

const DecideInput = z.object({
  decision: z.enum(['release', 'write_off'], 'Выберите решение.'),
  note: z.string().trim().min(10, 'Обоснуйте решение: протокол исследования, ответ поставщика, заключение.').max(2000),
});

export async function decideRecall(userId: string, orgId: string, recallId: string, input: unknown) {
  const d = parse(DecideInput, input);
  return inOrg(userId, orgId, 'recall.decide', async (tx) => {
    const r = (await tx.query(`select * from recalls where id = $1 and organization_id = $2 for update`, [parse(z.uuid(), recallId), orgId])).rows[0];
    if (!r) throw Errors.notFound('Отзыв не найден.');
    if (r.status !== 'open') throw Errors.conflict('Решение по отзыву уже принято.');
    const held = (await tx.query(`select rl.*, l.quantity::float8 as cur_qty, l.status, l.site_id, l.product_id, l.unit from recall_lots rl join lots l on l.id = rl.lot_id
      where rl.recall_id = $1 for update of l`, [r.id])).rows;
    let changed = 0;
    for (const h of held) {
      if (h.status !== 'blocked') continue;                  // партию уже списали вручную — не трогаем
      if (d.decision === 'release') {
        await tx.query(`update lots set status = $2, status_reason = $3 where id = $1`, [h.lot_id, h.cur_qty > 0 ? h.prev_status : 'consumed', h.prev_reason]);
      } else if (h.cur_qty > 0) {
        await move(tx, { orgId, siteId: h.site_id, lotId: h.lot_id, productId: h.product_id, kind: 'write_off', quantity: -h.cur_qty, unit: h.unit,
          reasonCode: 'recall', reason: `Отзыв партии: ${r.hazard}`.slice(0, 500), refType: 'recall', refId: r.id, operationId: `recall:${r.id}:${h.lot_id}`, userId });
        await tx.query(`update lots set status = 'written_off', status_reason = $2 where id = $1`, [h.lot_id, `отзыв: ${d.note}`.slice(0, 500)]);
      }
      changed++;
    }
    await tx.query(`update recalls set status = 'decided', decision = $2, decision_note = $3, decided_by = $4, decided_at = now() where id = $1`, [r.id, d.decision, d.note, userId]);
    await closeTasksFor(tx, orgId, 'recall_decision', r.id, userId, d.decision === 'release' ? `возвращено в оборот: ${d.note}` : `списано: ${d.note}`);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: d.decision === 'release' ? 'recall.release' : 'recall.write_off', entityType: 'lot', entityId: r.root_lot_id,
      reason: d.note, after: { recall: r.id, lots: changed } });
    return { ok: true, lots: changed };
  });
}
