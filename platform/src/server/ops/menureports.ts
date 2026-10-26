import { z } from 'zod';
import type { Tx } from '../db/pool';
import { Errors } from '../http/errors';
import { roleHas } from '../access/roles';
import { inOrg, parse } from './common';
import { buildTtkDoc } from './ttkdoc';
import { calcTechSpec } from './techspec';
import { effectiveParams } from './dishgroups';

/**
 * Отчёты по меню (как в Шеф Эксперте): информационный лист для гостей, лист калорийности, закладки (мини-рецептуры
 * для поваров), содержание ингредиента в рецептурах. Отбор — по папке с вложенными; в отчёты по блюдам — только
 * утверждённые ТТК. Нет данных — «не рассчитано», а не ноль.
 */

export type ReportKind = 'info' | 'calories' | 'bookmarks';

async function dishesFor(tx: Tx, orgId: string, groupId: string | null, kinds: string[]) {
  return (await tx.query(`with recursive down(id) as (select $2::uuid where $2::uuid is not null union all select g.id from dish_groups g join down on g.parent_id = down.id)
    select d.id, d.name, d.kind, d.card_no, d.sale_price, g.name as group_name, v.id as version_id
    from dishes d join ttk_versions v on v.dish_id = d.id and v.status = 'approved' left join dish_groups g on g.id = d.group_id
    where d.organization_id = $1 and d.status = 'active' and d.kind = any($3::text[]) and ($2::uuid is null or d.group_id in (select id from down))
    order by g.name nulls last, d.name`, [orgId, groupId, kinds])).rows;
}

export async function menuReport(userId: string, orgId: string, kind: ReportKind, groupId: string | null) {
  return inOrg(userId, orgId, 'menu.read', async (tx, m) => {
    const gid = groupId ? parse(z.uuid(), groupId) : null;
    const group = gid ? (await tx.query(`select name from dish_groups where id = $1 and organization_id = $2`, [gid, orgId])).rows[0]?.name : null;
    if (gid && !group) throw Errors.notFound('Папка не найдена.');
    const seePrice = roleHas(m.role, 'menu.price') || roleHas(m.role, 'cost.read');
    const list = await dishesFor(tx, orgId, gid, kind === 'info' ? ['dish'] : ['dish', 'semi']);
    const rows = [];
    for (const d of list) {
      const doc = await buildTtkDoc(tx, orgId, d.id, d.version_id);
      const base = { id: d.id, name: d.name, kind: d.kind, card_no: d.card_no, group: d.group_name, out_g: doc.out_g, out_label: doc.out_label,
        nutrition: doc.nutrition && { total: doc.nutrition.total, per100: doc.nutrition.per100, complete: doc.nutrition.complete } };
      if (kind === 'info') {
        const tu = await calcTechSpec(tx, orgId, d.id, await effectiveParams(tx, d.id));
        rows.push({ ...base, description: doc.version.menu_description, price: seePrice && d.sale_price !== null ? Number(d.sale_price) : null,
          allergens: tu.allergens.contains.map((a) => a.label), allergens_complete: tu.allergens.complete });
      } else if (kind === 'calories') rows.push(base);
      else rows.push({ ...base, lines: doc.lines.map((l) => ({ kind: l.kind, name: l.name, brutto_g: l.brutto_g, netto_g: l.netto_g, ready_g: l.ready_g, processing: l.processing, in_yield: l.in_yield })),
        technology: doc.version.technology, serving: doc.version.serving, sections: doc.sections });
    }
    const org = (await tx.query(`select name, legal_form from organizations where id = $1`, [orgId])).rows[0];
    return { kind, group, org, rows, see_price: seePrice, generated_at: new Date().toISOString() };
  });
}

/**
 * Содержание ингредиента в рецептурах: блюда и п/ф, где товар входит в действующую рецептуру (утверждённую, иначе
 * разрабатываемую) — напрямую или через полуфабрикат (до 5 уровней).
 */
export async function ingredientUsage(userId: string, orgId: string, productId: string) {
  return inOrg(userId, orgId, 'menu.read', async (tx) => {
    const pid = parse(z.uuid(), productId);
    const p = (await tx.query(`select id, name, unit from products where id = $1 and organization_id = $2`, [pid, orgId])).rows[0];
    if (!p) throw Errors.notFound('Товар не найден.');
    // текущая версия блюда: утверждённая, иначе черновик / на согласовании
    const cur = `(select v.id from ttk_versions v where v.dish_id = d.id order by (v.status = 'approved') desc, (v.status in ('draft', 'review')) desc, v.version desc limit 1)`;
    const direct = (await tx.query(`select d.id, d.name, d.kind, v.status, v.version, l.netto, l.brutto, l.unit, v.yield_g, v.portion_g
      from dishes d join ttk_versions v on v.id = ${cur} join ttk_lines l on l.version_id = v.id
      where d.organization_id = $1 and d.status = 'active' and l.product_id = $2 and l.kind = 'item' order by d.name`, [orgId, pid])).rows;
    const out = direct.map((r) => ({ dish_id: r.id, name: r.name, kind: r.kind, status: r.status, version: r.version, via: null as string | null,
      brutto: r.brutto === null ? null : Number(r.brutto), netto: r.netto === null ? null : Number(r.netto), unit: r.unit, basis: r.kind === 'dish' && r.portion_g ? `на выход ${Number(r.yield_g)} г` : r.yield_g ? `на выход ${Number(r.yield_g)} г` : '' }));
    // через полуфабрикаты
    let semis = direct.filter((r) => r.kind === 'semi').map((r) => ({ id: r.id as string, name: r.name as string }));
    const seen = new Set(semis.map((s) => s.id));
    for (let depth = 0; depth < 5 && semis.length; depth++) {
      const next: { id: string; name: string }[] = [];
      for (const s of semis) {
        const users = (await tx.query(`select d.id, d.name, d.kind, v.status, v.version from dishes d join ttk_versions v on v.id = ${cur} join ttk_lines l on l.version_id = v.id
          where d.organization_id = $1 and d.status = 'active' and l.sub_dish_id = $2 order by d.name`, [orgId, s.id])).rows;
        for (const u of users) {
          out.push({ dish_id: u.id, name: u.name, kind: u.kind, status: u.status, version: u.version, via: s.name, brutto: null, netto: null, unit: '', basis: '' });
          if (u.kind === 'semi' && !seen.has(u.id)) { seen.add(u.id); next.push({ id: u.id, name: u.name }); }
        }
      }
      semis = next;
    }
    return { product: p, rows: out };
  });
}
