import { z } from 'zod';
import type { Tx } from '../db/pool';
import { Errors } from '../http/errors';
import { inOrg, parse } from './common';
import { calcVersion, convertUnits } from './recipes';
import { semiGrams } from './bom';
import { versionSteps } from './processing';
import { nutritionOf, allergenProfile, suggestAllergens, ALLERGENS, MICRO, type TuParams } from './techspec';
import { stages, retention } from '../recipes/chain';

/**
 * Технико-технологическая карта по ГОСТ 31987-2012 и обоснование расчётов пищевой ценности и физико-химических
 * показателей (методика Методических указаний по лабораторному контролю качества продукции общественного питания,
 * 1997, — как в Шеф Эксперте). Один расчёт на обе формы:
 *  - по каждому ингредиенту на порцию (п/ф — на выход): нетто, Б/Ж/У на 100 г и в блюде, потери нутриентов при тепловой
 *    обработке (по нормам шагов), потери продукта после тепловой обработки, содержание с учётом потерь;
 *  - в расчёт входят только ингредиенты, учитываемые в выходе;
 *  - энергия: Б×4 + Ж×9 + У×4 ккал (Б×17 + Ж×37 + У×17 кДж), ТР ТС 022/2011;
 *  - сухие вещества: Σ / выход × 100 + соль (макс.), мин. = макс. × коэффициент; жир — по ингредиентам с массовой долей
 *    жира, мин. = макс. × коэффициент Гербера; сахар — по сахарозе × коэффициент потерь; соль — по норме блюда.
 * Коэффициенты и нормы задаёт технолог в параметрах блюда; данных нет — показатель «не рассчитан», а не ноль.
 */

const r1 = (x: number) => Math.round(x * 10) / 10, r2 = (x: number) => Math.round(x * 100) / 100;

export interface DocLine {
  kind: 'item' | 'heading'; name: string; brutto_g: number | null; netto_g: number | null; ready_g: number | null; processing: string; in_yield: boolean;
  per100: { protein: number; fat: number; carbs: number } | null; source: string | null;
  in_dish: { protein: number; fat: number; carbs: number } | null;
  nutr_loss: { protein: number; fat: number; carbs: number } | null;   // % потерь при тепловой обработке
  after_loss: number;                                                  // % потерь продукта после тепловой обработки
  with_losses: { protein: number; fat: number; carbs: number } | null;
  dry_g: number | null; fat_mass_g: number | null; sugar_g: number | null; dry_100: number | null; fat_mass_100: number | null; sucrose_100: number | null;
}

export async function buildTtkDoc(tx: Tx, orgId: string, dishId: string, versionId?: string | null) {
  const dish = (await tx.query(`select * from dishes where id = $1 and organization_id = $2`, [dishId, orgId])).rows[0];
  if (!dish) throw Errors.notFound('Блюдо не найдено.');
  const v = (await tx.query(versionId ? `select *, card_date::text as card_date from ttk_versions where id = $2 and dish_id = $1` : `select *, card_date::text as card_date from ttk_versions where dish_id = $1
      order by (status = 'approved') desc, (status in ('draft', 'review')) desc, version desc limit 1`, versionId ? [dishId, versionId] : [dishId])).rows[0];
  if (!v) throw Errors.notFound('Версия ТТК не найдена.');
  const isDish = dish.kind === 'dish';
  const outG = isDish ? Number(v.portion_g || 0) : Number(v.yield_g || 0);
  const scale = isDish && v.portion_g && v.yield_g ? Number(v.portion_g) / Number(v.yield_g) : 1;
  const params: TuParams = (await tx.query(`select params from tech_specs where dish_id = $1`, [dishId])).rows[0]?.params || {};
  const org = (await tx.query(`select name, legal_form, inn from organizations where id = $1`, [orgId])).rows[0];
  const sites = (await tx.query(`select name from sites where organization_id = $1 and status = 'active' order by created_at`, [orgId])).rows.map((x) => x.name);
  const rows = (await tx.query(`select l.*, p.name as product_name, d.name as sub_name from ttk_lines l left join products p on p.id = l.product_id left join dishes d on d.id = l.sub_dish_id
    where l.version_id = $1 order by l.position`, [v.id])).rows;
  const steps = await versionSteps(tx, v.id);
  const lines: DocLine[] = [];
  const missing = { nutrition: new Set<string>(), dry: new Set<string>(), fatMass: [] as string[], sucrose: [] as string[] };
  for (const l of rows) {
    if (l.kind === 'heading') { lines.push({ kind: 'heading', name: l.name_raw, brutto_g: null, netto_g: null, ready_g: null, processing: '', in_yield: false, per100: null, source: null, in_dish: null, nutr_loss: null, after_loss: 0, with_losses: null, dry_g: null, fat_mass_g: null, sugar_g: null, dry_100: null, fat_mass_100: null, sucrose_100: null }); continue; }
    const g = async (q: unknown) => (q === null || q === undefined ? null : l.product_id ? await convertUnits(tx, l.product_id, Number(q) * scale, l.unit, 'г') : l.sub_dish_id ? await semiGrams(tx, l.sub_dish_id, Number(q) * scale, l.unit) : null);
    const ls = steps.get(l.id) || [];
    const b = await g(l.brutto ?? l.netto), n = await g(l.netto ?? l.brutto), rd = await g(l.ready);
    let afterLoss = 0, ready = rd ?? n;
    if (ls.length && b !== null) { const st = stages(ls as any, b); afterLoss = st.thermal > 0 ? (st.thermal - st.ready) / st.thermal * 100 : 0; ready = rd ?? st.ready; }
    const keep = ls.some((s) => s.kind === 'thermal') ? retention(ls as any) : { protein: 1, fat: 1, carbs: 1 };
    const name = l.product_name || (l.sub_name ? `${l.sub_name} (п/ф)` : l.name_raw);
    let per100: DocLine['per100'] = null, source: string | null = null, dry100: number | null = null, fm100: number | null = null, suc100: number | null = null;
    if (l.product_id) {
      const nu = await nutritionOf(tx, l.product_id);
      if (nu) { per100 = { protein: nu.protein, fat: nu.fat, carbs: nu.carbs }; source = nu.source; dry100 = nu.dry_matter; fm100 = nu.fat_mass; suc100 = nu.sucrose; }
    } else if (l.sub_dish_id) {
      const sv = (await tx.query(`select id from ttk_versions where dish_id = $1 and status = 'approved'`, [l.sub_dish_id])).rows[0];
      if (sv) { const c = await calcVersion(tx, orgId, sv.id, new Set([dishId, l.sub_dish_id])); if (c.kbju.per100 && c.kbju.complete) { per100 = { protein: c.kbju.per100.protein, fat: c.kbju.per100.fat, carbs: c.kbju.per100.carbs }; source = 'по ТТК полуфабриката'; } }
    }
    const net = n ?? 0, kAfter = 1 - afterLoss / 100;
    const inDish = per100 ? { protein: net * per100.protein / 100, fat: net * per100.fat / 100, carbs: net * per100.carbs / 100 } : null;
    const nutrLoss = keep ? { protein: r1((1 - keep.protein) * 100), fat: r1((1 - keep.fat) * 100), carbs: r1((1 - keep.carbs) * 100) } : null;
    const withLosses = inDish ? { protein: inDish.protein * (keep?.protein ?? 1) * kAfter, fat: inDish.fat * (keep?.fat ?? 1) * kAfter, carbs: inDish.carbs * (keep?.carbs ?? 1) * kAfter } : null;
    if (l.in_yield) {
      if (!per100) missing.nutrition.add(name);
      else if (!keep) missing.nutrition.add(`${name}: потери нутриентов при тепловой обработке не заданы`);
      if (dry100 === null) missing.dry.add(name);
    }
    lines.push({ kind: 'item', name, brutto_g: b === null ? null : r1(b), netto_g: n === null ? null : r1(n), ready_g: ready === null ? null : r1(ready), in_yield: l.in_yield,
      processing: ls.length ? ls.map((s) => s.method_name).join(', ') : 'Нет обработки', per100, source,
      in_dish: inDish && { protein: r2(inDish.protein), fat: r2(inDish.fat), carbs: r2(inDish.carbs) }, nutr_loss: nutrLoss, after_loss: r1(afterLoss),
      with_losses: withLosses && { protein: r2(withLosses.protein), fat: r2(withLosses.fat), carbs: r2(withLosses.carbs) },
      dry_g: dry100 === null ? null : r2(net * dry100 / 100 * kAfter), fat_mass_g: fm100 === null ? null : r2(net * fm100 / 100 * kAfter), sugar_g: suc100 === null ? null : r2(net * suc100 / 100 * kAfter),
      dry_100: dry100, fat_mass_100: fm100, sucrose_100: suc100 });
  }
  const used = lines.filter((l) => l.kind === 'item' && l.in_yield);
  const sum = (f: (l: DocLine) => number | null) => used.reduce((s, l) => s + (f(l) ?? 0), 0);
  const P = sum((l) => l.with_losses?.protein ?? null), F = sum((l) => l.with_losses?.fat ?? null), C = sum((l) => l.with_losses?.carbs ?? null);
  const has = used.some((l) => l.with_losses);
  const kcal = P * 4 + F * 9 + C * 4, kj = P * 17 + F * 37 + C * 17;
  const nutrition = has && outG > 0 ? {
    total: { protein: r2(P), fat: r2(F), carbs: r2(C), kcal: r2(kcal), kj: r2(kj) },
    per_out: { protein: r2(P), fat: r2(F), carbs: r2(C), kcal: r2(kcal), kj: r2(kj) },
    per100: { protein: r2(P / outG * 100), fat: r2(F / outG * 100), carbs: r2(C / outG * 100), kcal: r2(kcal / outG * 100), kj: r2(kj / outG * 100) },
    complete: missing.nutrition.size === 0,
  } : null;

  // физико-химические показатели (только то, что нормируется для блюда, и только по полным данным)
  const pn = params.physNormed || {};
  const saltMax = params.saltMaxPct ?? null;
  const physico = {
    dry: !pn.dry ? { normed: false as const } : (() => {
      const why: string[] = [];
      if (missing.dry.size) why.push(`нет содержания сухих веществ: ${[...missing.dry].join(', ')}`);
      if (params.dryCoef == null) why.push('не задан коэффициент сухих веществ');
      if (saltMax == null) why.push('не задано максимальное содержание соли');
      const pct = outG > 0 ? sum((l) => l.dry_g) / outG * 100 : 0;
      const max = why.length ? null : r2(pct + saltMax!), min = max === null ? null : r2(max * params.dryCoef!);
      return { normed: true as const, theoretical_pct: r2(pct), max, min, missing: why };
    })(),
    fat: !pn.fat ? { normed: false as const } : (() => {
      const why: string[] = [];
      if (params.gerberPct == null) why.push('не задан коэффициент Гербера');
      const fatty = used.filter((l) => l.fat_mass_100 !== null);
      if (!fatty.length) why.push('ни у одного ингредиента не задана массовая доля жира');
      const pct = outG > 0 ? sum((l) => l.fat_mass_g) / outG * 100 : 0;
      const max = why.length ? null : r2(pct), min = max === null ? null : r2(max * params.gerberPct! / 100);
      return { normed: true as const, max, min, missing: why, ingredients: fatty.map((l) => l.name) };
    })(),
    sugar: !pn.sugar ? { normed: false as const } : (() => {
      const why: string[] = [];
      if (params.sugarCoef == null) why.push('не задан коэффициент потерь сахарозы');
      const sweet = used.filter((l) => l.sucrose_100 !== null);
      if (!sweet.length) why.push('ни у одного ингредиента не задано содержание сахарозы');
      const pct = outG > 0 ? sum((l) => l.sugar_g) * (params.sugarCoef ?? 0) / outG * 100 : 0;
      return { normed: true as const, value: why.length ? null : r2(pct), missing: why, ingredients: sweet.map((l) => l.name) };
    })(),
    salt: !pn.salt ? { normed: false as const } : { normed: true as const, value: saltMax, missing: saltMax == null ? ['не задано максимальное содержание соли'] : [] },
    basis: params.physBasis || null,
  };
  const micro = MICRO.map((m) => ({ ...m, norm: (params.micro || {})[m.code]?.trim() || null }));
  const sections = rows.some((l) => l.kind === 'heading');
  // сырьё карты — для ввода данных по документу (пищевая ценность, сухие вещества, сахароза, жир, аллергены)
  const products = [];
  for (const p of [...new Map(rows.filter((l) => l.product_id).map((l) => [l.product_id, l.product_name])).entries()]) {
    products.push({ id: p[0], name: p[1], nutrition: await nutritionOf(tx, p[0]), allergens: await allergenProfile(tx, p[0]), suggest: suggestAllergens(p[1]) });
  }
  return {
    org, sites, dish: { id: dish.id, name: dish.name, kind: dish.kind, card_no: dish.card_no, sale_price: dish.sale_price },
    version: { id: v.id, version: v.version, status: v.status, card_date: v.card_date, yield_g: v.yield_g === null ? null : Number(v.yield_g), portion_g: v.portion_g === null ? null : Number(v.portion_g),
      technology: v.technology, serving: v.serving, storage_conditions: v.storage_conditions, shelf_life: v.shelf_life, organoleptic: v.organoleptic || {}, menu_description: v.menu_description, source: v.source },
    out_g: outG, out_label: isDish ? `на 1 порцию (${outG} г)` : `на выход ${outG} г`, sections,
    lines, nutrition, physico, micro, micro_index: params.microIndex || null, micro_note: params.microNote || null,
    missing: { nutrition: [...missing.nutrition] }, products, allergen_list: Object.entries(ALLERGENS).map(([code, a]) => ({ code, label: a.label })),
    params: { physNormed: params.physNormed || {}, gerberPct: params.gerberPct ?? null, saltMaxPct: params.saltMaxPct ?? null, dryCoef: params.dryCoef ?? null, sugarCoef: params.sugarCoef ?? null,
      physBasis: params.physBasis ?? null, microIndex: params.microIndex ?? null, microNote: params.microNote ?? null, micro: params.micro || {} },
  };
}

export async function getTtkDoc(userId: string, orgId: string, dishId: string, versionId?: string | null) {
  return inOrg(userId, orgId, 'menu.read', async (tx) => buildTtkDoc(tx, orgId, parse(z.uuid(), dishId), versionId ? parse(z.uuid(), versionId) : null));
}
