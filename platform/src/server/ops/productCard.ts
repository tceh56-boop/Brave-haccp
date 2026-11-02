import { z } from 'zod';
import type { Tx } from '../db/pool';
import { Errors } from '../http/errors';
import { inOrg, parse } from './common';
import { calcTechSpec } from './techspec';
import { effectiveParams } from './dishgroups';
import { activeDeclarationFor, meatProfile, DECL_STATUS, declStatus } from './declarations';

/**
 * Единая карточка продукта (ТЗ доработки, 5.1): блюдо или полуфабрикат и всё, что к нему относится, на одном экране —
 * ТТК и версия, ТУ/ТИ/СТО с признаком «устарел» (основаны не на действующей версии ТТК), калькуляция, состав и аллергены,
 * сроки и хранение, маркировка и декларации, ККТ/КТ, лабораторные основания, журналы, история изменений.
 * Ничего не досчитывается «по умолчанию»: нет документа — «нет», не «ок».
 */

type Doc = { version: number; designation?: string | null; approved_at: string; ttk_version_id?: string | null } | null;
const outdated = (d: Doc, ttkId: string | null) => (d && ttkId && d.ttk_version_id ? d.ttk_version_id !== ttkId : false);

async function composition(tx: Tx, orgId: string, dishId: string) {
  try {
    const calc = await calcTechSpec(tx, orgId, dishId, await effectiveParams(tx, dishId));
    return {
      recipe: calc.recipe.map((r) => ({ name: r.name, kind: r.kind, netto_g: r.netto_g })),
      allergens: calc.allergens.contains.map((a) => a.label), allergens_complete: calc.allergens.complete, allergens_missing: calc.allergens.no_profile,
      nutrition: calc.nutrition.per100, nutrition_coverage_pct: calc.nutrition.coverage_pct, nutrition_verified_pct: calc.nutrition.verified_pct, errors: calc.errors,
    };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function getProductCard(userId: string, orgId: string, dishIdInput: unknown) {
  const dishId = parse(z.uuid(), dishIdInput);
  return inOrg(userId, orgId, 'menu.read', async (tx) => {
    const q = async (sql: string, a: unknown[]) => (await tx.query(sql, a)).rows;
    const dish = (await q(`select d.*, p.opened_shelf_hours, p.opened_shelf_basis, p.name as product_name from dishes d left join products p on p.id = d.product_id
      where d.id = $1 and d.organization_id = $2`, [dishId, orgId]))[0];
    if (!dish) throw Errors.notFound('Блюдо или полуфабрикат не найдены.');
    const ttk = (await q(`select v.*, u.full_name as approver from ttk_versions v left join users u on u.id = v.approved_by where v.dish_id = $1 and v.status = 'approved'`, [dishId]))[0] || null;
    const ttkId = ttk?.id || null;
    const semis = ttk ? await q(`select distinct d.id, d.name, v.version from ttk_lines l join dishes d on d.id = l.sub_dish_id
      left join ttk_versions v on v.dish_id = d.id and v.status = 'approved' where l.version_id = $1 order by d.name`, [ttkId]) : [];
    const tu: Doc = (await q(`select version, designation, approved_at, ttk_version_id from tech_spec_versions where dish_id = $1 order by version desc limit 1`, [dishId]))[0] || null;
    const ti: Doc = (await q(`select version, designation, approved_at, ttk_version_id from ti_versions where dish_id = $1 order by version desc limit 1`, [dishId]))[0] || null;
    const sto = (await q(`select s.id, s.seq, s.title, v.version, v.designation, v.approved_at, v.review_due from sto_standards s
      left join lateral (select * from sto_versions x where x.sto_id = s.id order by x.version desc limit 1) v on true
      where s.organization_id = $1 and (s.dish_ids @> array[$2]::uuid[] or ($3::uuid is not null and s.group_id = $3)) order by s.seq`, [orgId, dishId, dish.group_id]));
    const costing = (await q(`select doc_no, calc_date, cost_1, sale_price, markup_pct, ttk_version_id, approved_at from costing_cards where dish_id = $1 order by approved_at desc nulls last, calc_date desc limit 1`, [dishId]))[0] || null;
    const checks = await q(`select c.name, c.unit, c.min_value, c.max_value, c.basis, h.code as hazard, h.class from release_checks c left join haccp_hazards h on h.id = c.hazard_id
      where c.dish_id = $1 and c.status = 'active' order by c.created_at`, [dishId]);
    const labPrograms = await q(`select test_type, target, period_days, next_due::text, basis from lab_programs where dish_id = $1 and status = 'active' order by next_due`, [dishId]);
    const labResults = await q(`select test_type, lab_name, protocol_no, sampled_on::text, result, conclusion from lab_results where dish_id = $1
      or lot_id in (select output_lot_id from production_orders where dish_id = $1) order by sampled_on desc limit 10`, [dishId]);
    const declarations = (await q(`select d.id, d.number, d.input->>'scheme' as scheme,
        (select row_to_json(a) from (select accepted_at from declaration_acceptances where declaration_id = d.id) a) as acceptance,
        (select row_to_json(r) from (select reg_number, reg_date::text, valid_to::text from declaration_registrations where declaration_id = d.id) r) as registration,
        (select row_to_json(t) from (select terminated_on::text from declaration_terminations where declaration_id = d.id) t) as termination,
        current_date::text as today from declarations d where d.dish_id = $1 order by d.number desc`, [dishId]))
      .map((r) => ({ id: r.id, number: r.number, scheme: r.scheme, registration: r.registration, status: DECL_STATUS[declStatus(r, r.today)] }));
    const active = await activeDeclarationFor(tx, orgId, dishId);
    const meat = ttk ? await meatProfile(tx, dishId) : null;
    const journals = (await q(`select
        (select count(*)::int from production_orders where dish_id = $1 and status = 'done' and completed_at > now() - interval '30 days') as releases,
        (select count(*)::int from daily_samples where dish_id = $1 and taken_at > now() - interval '30 days') as samples,
        (select count(*)::int from lab_results where dish_id = $1) as lab`, [dishId]))[0];
    const history = await q(`select v.version, v.status, v.change_reason, v.created_at, cu.full_name as author, v.approved_at, au.full_name as approver
      from ttk_versions v left join users cu on cu.id = v.created_by left join users au on au.id = v.approved_by where v.dish_id = $1 order by v.version desc`, [dishId]);

    const issues: string[] = [];
    if (!ttk) issues.push('Нет утверждённой ТТК — продукт не изготавливается и не продаётся по нормативу.');
    if (outdated(tu, ttkId)) issues.push(`ТУ (версия ${tu!.version}) основаны не на действующей ТТК — устарели, нужен пересмотр.`);
    if (outdated(ti, ttkId)) issues.push(`ТИ (версия ${ti!.version}) основана не на действующей ТТК — устарела, нужен пересмотр.`);
    if (costing && ttkId && costing.ttk_version_id !== ttkId) issues.push(`Калькуляционная карточка № ${costing.doc_no} составлена по другой версии ТТК — пересчитайте.`);
    if (ttk && !(dish.kind === 'dish' ? ttk.sale_hours ?? ttk.shelf_life_hours : ttk.shelf_life_hours))
      issues.push(dish.kind === 'dish' ? 'В ТТК не указан срок реализации в часах — выпущенной партии нельзя назначить срок.' : 'В ТТК не указан срок партии п/ф в часах — партии нельзя назначить срок.');
    const comp = ttk ? await composition(tx, orgId, dishId) : null;
    if (comp && 'allergens_complete' in comp && !comp.allergens_complete) issues.push('Профиль аллергенов неполный — «не содержит» не утверждается.');
    if (meat?.unknown.length) issues.push(`Не указан вид сырья (ТР ТС 034 / ТР ЕАЭС 051): ${meat.unknown.map((x) => x.name).join(', ')}.`);
    for (const s of sto) if (s.review_due && s.review_due < new Date().toISOString().slice(0, 10)) issues.push(`СТО «${s.title}»: срок актуализации прошёл.`);

    return {
      dish: { id: dish.id, name: dish.name, kind: dish.kind, card_no: dish.card_no, sale_price: dish.sale_price, status: dish.status },
      ttk: ttk ? { id: ttk.id, version: ttk.version, card_date: ttk.card_date, approved_at: ttk.approved_at, approver: ttk.approver, yield_g: ttk.yield_g, portion_g: ttk.portion_g } : null,
      semis,
      documents: {
        tu: tu ? { ...tu, outdated: outdated(tu, ttkId) } : null,
        ti: ti ? { ...ti, outdated: outdated(ti, ttkId) } : null,
        sto,
        costing: costing ? { ...costing, outdated: !!(ttkId && costing.ttk_version_id !== ttkId) } : null,
      },
      composition: comp,
      storage: ttk ? { conditions: ttk.storage_conditions, shelf_life: ttk.shelf_life, shelf_life_hours: ttk.shelf_life_hours,
        storage_hours: ttk.storage_hours, sale_hours: ttk.sale_hours, opened_hours: ttk.opened_hours, basis: ttk.shelf_basis,
        after_opening: dish.opened_shelf_hours ? { hours: Number(dish.opened_shelf_hours), basis: dish.opened_shelf_basis } : null } : null,
      labeling: { meat_group: meat?.group || null, meat_pct: meat?.meat_pct ?? null, eac: !!active, active_declaration: active?.reg_number || null, declarations },
      ccp: checks,
      lab: { programs: labPrograms, results: labResults },
      journals,
      history,
      issues,
    };
  });
}
