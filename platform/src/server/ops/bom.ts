import type { Tx } from '../db/pool';
import { Errors } from '../http/errors';
import { fmtNum } from './common';
import { move } from './stock';
import { approvedRecipe, convertUnits } from './recipes';

/**
 * Раскладка утверждённой ТТК до складских позиций и расход по FEFO — общие для продажи и производства.
 * Механика MON CHEF «готовые п/ф со склада берутся первыми»: если у полуфабриката есть складская позиция
 * и на площадке есть его годные партии, в расход идут они; раскладка до сырья — только на недостающее.
 * Иначе сырьё произведённого п/ф списалось бы второй раз.
 */

export interface Need { productId: string; name: string; unit: string; qty: number; semiOf?: string }

export const USABLE = `l.status = 'available' and l.expires_at is not null and l.expiry_basis is not null and l.expires_at > now() and l.quantity > 0`;

async function usableQty(tx: Tx, orgId: string, siteId: string, productId: string): Promise<number> {
  return Number((await tx.query(`select coalesce(sum(l.quantity), 0) as q from lots l where l.organization_id = $1 and l.site_id = $2 and l.product_id = $3 and ${USABLE}`,
    [orgId, siteId, productId])).rows[0].q);
}

/** Масса полуфабриката по строке ТТК, г (или null, если не определить). */
export async function semiGrams(tx: Tx, subDishId: string, q: number, unit: string): Promise<number | null> {
  if (unit === 'г') return q;
  if (unit === 'кг') return q * 1000;
  if (unit === 'порция') {
    const sp = (await tx.query(`select portion_g from ttk_versions where dish_id = $1 and status = 'approved'`, [subDishId])).rows[0]?.portion_g;
    return sp ? q * Number(sp) : null;
  }
  return null;
}

/**
 * Сколько каждой складской позиции нужно на amount блюда/п/ф по утверждённым ТТК.
 * opts.siteId — учитывать готовые п/ф на складе этой площадки (продажа, производство).
 */
export async function explode(tx: Tx, orgId: string, dishId: string, amount: { portions?: number; grams?: number },
  opts: { siteId?: string } = {}, depth = 0, acc = new Map<string, Need>()): Promise<{ needs: Map<string, Need>; versionId: string }> {
  if (depth > 5) throw Errors.conflict('Слишком глубокая вложенность полуфабрикатов.');
  const r = await approvedRecipe(tx, orgId, dishId);
  if (!r) {
    const name = (await tx.query(`select name from dishes where id = $1`, [dishId])).rows[0]?.name;
    throw Object.assign(Errors.conflict(`Нет утверждённой ТТК: ${name}`), { noTtk: true });
  }
  const v = r.version;
  if (!v.yield_g) throw Errors.conflict(`В ТТК «${dishId}» не указан выход.`);
  const grams = amount.grams ?? (v.portion_g ? amount.portions! * Number(v.portion_g) : null);
  if (grams === null) throw Errors.conflict('В ТТК не указан выход порции.');
  const factor = grams / Number(v.yield_g);
  for (const l of r.lines) {
    const q = Number(l.brutto ?? l.netto ?? 0) * factor;
    if (l.product_id) {
      const inUnit = await convertUnits(tx, l.product_id, q, l.unit, l.product_unit);
      if (inUnit === null) throw Errors.conflict(`Нет коэффициента «${l.unit} → ${l.product_unit}» для «${l.product_name}».`);
      const cur = acc.get(l.product_id) || { productId: l.product_id, name: l.product_name, unit: l.product_unit, qty: 0 };
      cur.qty += inUnit; acc.set(l.product_id, cur);
    } else if (l.sub_dish_id) {
      let g = await semiGrams(tx, l.sub_dish_id, q, l.unit);
      if (g === null) throw Errors.conflict(`Не определить массу полуфабриката «${l.name_raw}».`);
      if (opts.siteId) {
        const semi = (await tx.query(`select d.name, d.product_id, p.unit from dishes d join products p on p.id = d.product_id where d.id = $1`, [l.sub_dish_id])).rows[0];
        if (semi) {
          const need = await convertUnits(tx, semi.product_id, g, 'г', semi.unit);
          if (need !== null && need > 0) {
            const planned = acc.get(semi.product_id)?.qty || 0;
            const free = Math.max(0, (await usableQty(tx, orgId, opts.siteId, semi.product_id)) - planned);
            const take = Math.min(free, need);
            if (take > 1e-9) {
              const cur = acc.get(semi.product_id) || { productId: semi.product_id, name: `${semi.name} (п/ф)`, unit: semi.unit, qty: 0, semiOf: l.sub_dish_id };
              cur.qty += take; acc.set(semi.product_id, cur);
              g = g * (1 - take / need);                       // остаток — раскладкой до сырья
            }
          }
        }
      }
      if (g > 1e-9) await explode(tx, orgId, l.sub_dish_id, { grams: g }, opts, depth + 1, acc);
    } else throw Errors.conflict(`В ТТК не сопоставлено сырьё «${l.name_raw}».`);
  }
  return { needs: acc, versionId: v.id };
}

/** FEFO-расход позиции с площадки; стоимость — по ценам партий (null, если у партии нет цены). */
export async function takeFefo(tx: Tx, orgId: string, siteId: string, n: Need,
  ref: { refType: string; refId: string; reason: string; operationId: string; userId: string | null }, taken?: { lotId: string; qty: number; unit: string }[]) {
  const lots = (await tx.query(`select l.* from lots l where l.organization_id = $1 and l.site_id = $2 and l.product_id = $3 and ${USABLE} order by l.expires_at, l.received_at for update`,
    [orgId, siteId, n.productId])).rows;
  const have = lots.reduce((s, l) => s + Number(l.quantity), 0);
  if (have + 1e-9 < n.qty) throw Errors.conflict(`Не хватает годного остатка «${n.name}»: есть ${fmtNum(Math.round(have * 1000) / 1000)} ${n.unit}, нужно ${fmtNum(Math.round(n.qty * 1000) / 1000)}.`);
  let left = n.qty, cost: number | null = 0;
  for (const l of lots) {
    if (left <= 1e-9) break;
    const q = Math.min(Number(l.quantity), left);
    await move(tx, { orgId, siteId, lotId: l.id, productId: n.productId, kind: 'consume', quantity: -q, unit: n.unit, reason: ref.reason, refType: ref.refType, refId: ref.refId, operationId: ref.operationId, userId: ref.userId });
    cost = cost === null || l.unit_price === null ? null : cost + q * Number(l.unit_price);
    taken?.push({ lotId: l.id, qty: q, unit: n.unit });
    left -= q;
  }
  return cost;
}

/** Хватает ли годного остатка на раскладку (без списания) — для предпросмотра задания. */
export async function availability(tx: Tx, orgId: string, siteId: string, needs: Map<string, Need>) {
  const out = [];
  for (const n of needs.values()) {
    const have = await usableQty(tx, orgId, siteId, n.productId);
    out.push({ product_id: n.productId, name: n.name, unit: n.unit, need: Math.round(n.qty * 1000) / 1000, have: Math.round(have * 1000) / 1000, enough: have + 1e-9 >= n.qty, semi: !!n.semiOf });
  }
  return out.sort((a, b) => Number(a.enough) - Number(b.enough) || a.name.localeCompare(b.name));
}
