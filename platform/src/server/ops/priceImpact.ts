import type { Tx } from '../db/pool';
import { calcVersion, productPrice } from './recipes';
import { inOrg } from './common';

/**
 * Каскад цен (вариант А: как PriceCascade на Google Диске). Себестоимость блюда считается по утверждённой ТТК и средней цене
 * партий в остатке — при каждом показе. Здесь — «что изменилось»: какие товары подорожали после приёмки и какие блюда
 * (напрямую и через полуфабрикаты) это затронуло. Утверждённые калькуляционные карточки (ОП-1) не меняются — это снимки.
 */

export interface DishCost { dish_id: string; name: string; kind: string; cost: number | null; per: 'порция' | 'кг'; complete: boolean; sale_price: number | null; food_cost_pct: number | null; margin: number | null }

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Блюда и п/ф с утверждённой ТТК, где товар входит напрямую или через полуфабрикаты (до 5 уровней). */
export async function affectedDishes(tx: Tx, orgId: string, productIds: string[]): Promise<string[]> {
  if (!productIds.length) return [];
  const found = new Set<string>((await tx.query(`select distinct v.dish_id from ttk_lines l join ttk_versions v on v.id = l.version_id
    where v.organization_id = $1 and v.status = 'approved' and l.product_id = any($2::uuid[])`, [orgId, productIds])).rows.map((r) => r.dish_id));
  let frontier = [...found];
  for (let depth = 0; depth < 5 && frontier.length; depth++) {
    const up = (await tx.query(`select distinct v.dish_id from ttk_lines l join ttk_versions v on v.id = l.version_id
      where v.organization_id = $1 and v.status = 'approved' and l.sub_dish_id = any($2::uuid[])`, [orgId, frontier])).rows.map((r) => r.dish_id as string).filter((x) => !found.has(x));
    up.forEach((x) => found.add(x));
    frontier = up;
  }
  return [...found];
}

/** Себестоимость по утверждённой ТТК: блюдо — на порцию, п/ф — на кг выхода; неполная (нет цены) — null, а не 0. */
export async function dishCosts(tx: Tx, orgId: string, dishIds: string[]): Promise<DishCost[]> {
  if (!dishIds.length) return [];
  const rows = (await tx.query(`select d.id, d.name, d.kind, d.sale_price, v.id as version_id, v.yield_g, v.portion_g from dishes d
    join ttk_versions v on v.dish_id = d.id and v.status = 'approved' where d.organization_id = $1 and d.id = any($2::uuid[]) order by d.name`, [orgId, dishIds])).rows;
  const out: DishCost[] = [];
  for (const d of rows) {
    const c = await calcVersion(tx, orgId, d.version_id, new Set([d.id]));
    const perPortion = d.kind === 'dish' && d.portion_g && d.yield_g ? Number(d.portion_g) / Number(d.yield_g) : null;
    const cost = !c.cost.complete ? null : d.kind === 'dish' ? (perPortion ? r2(c.cost.total * perPortion) : null) : d.yield_g ? r2((c.cost.total / Number(d.yield_g)) * 1000) : null;
    const price = d.sale_price === null ? null : Number(d.sale_price);
    out.push({ dish_id: d.id, name: d.name, kind: d.kind, cost, per: d.kind === 'dish' ? 'порция' : 'кг', complete: c.cost.complete, sale_price: price,
      food_cost_pct: cost !== null && price && d.kind === 'dish' ? Math.round((cost / price) * 1000) / 10 : null,
      margin: cost !== null && price && d.kind === 'dish' ? r2(price - cost) : null });
  }
  return out;
}

export async function priceSnapshot(tx: Tx, orgId: string, productIds: string[]) {
  const m = new Map<string, number | null>();
  for (const id of productIds) m.set(id, (await productPrice(tx, orgId, id))?.price ?? null);
  return m;
}

/** Сравнение «до/после»: изменившиеся цены товаров и себестоимость затронутых блюд (порог — 0,5 %). */
export function diffImpact(names: Map<string, string>, before: Map<string, number | null>, after: Map<string, number | null>, costsBefore: DishCost[], costsAfter: DishCost[]) {
  const changed = (a: number | null, b: number | null) => (a === null) !== (b === null) || (a !== null && b !== null && Math.abs(b - a) > Math.abs(a) * 0.005);
  const pct = (a: number | null, b: number | null) => (a && b !== null ? Math.round(((b - a) / a) * 1000) / 10 : null);
  const products = [...after.keys()].filter((id) => changed(before.get(id) ?? null, after.get(id) ?? null))
    .map((id) => ({ product_id: id, name: names.get(id) || '', old_price: before.get(id) === null ? null : r2(before.get(id)!), new_price: after.get(id) === null ? null : r2(after.get(id)!), change_pct: pct(before.get(id) ?? null, after.get(id) ?? null) }));
  const dishes = costsAfter.map((n) => ({ n, o: costsBefore.find((x) => x.dish_id === n.dish_id) })).filter(({ n, o }) => changed(o?.cost ?? null, n.cost))
    .map(({ n, o }) => ({ dish_id: n.dish_id, name: n.name, kind: n.kind, per: n.per, old_cost: o?.cost ?? null, new_cost: n.cost, change_pct: pct(o?.cost ?? null, n.cost),
      food_cost_pct: n.food_cost_pct, old_food_cost_pct: o?.food_cost_pct ?? null, margin: n.margin }))
    .sort((a, b) => Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0));
  return { products, dishes };
}

/** Себестоимость, фудкост и маржа всех блюд с утверждённой ТТК — для списка меню (право cost.read). */
export async function menuCosts(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'cost.read', async (tx) => {
    const ids = (await tx.query(`select d.id from dishes d where d.organization_id = $1 and d.status = 'active'
      and exists (select 1 from ttk_versions v where v.dish_id = d.id and v.status = 'approved')`, [orgId])).rows.map((r) => r.id as string);
    return dishCosts(tx, orgId, ids);
  });
}
