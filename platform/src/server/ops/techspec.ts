import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText } from './common';
import { convertUnits } from './recipes';
import { semiGrams } from './bom';

/**
 * Технические условия (этап 11; перенос TechSpecCore.gs прежнего ЦЕХ, Stage 106; MON CHEF 9–10).
 * Расчётные показатели ТУ — из утверждённой ТТК так же, как себестоимость:
 *  - пищевая ценность: Σ(нетто × нутриент/100) × (1 − потери) / выход × 100; потери при тепловой обработке
 *    Б/Ж/У 6/12/9 %; энергия Б×4 + Ж×9 + У×4 ккал и Б×17 + Ж×37 + У×17 кДж (ТР ТС 022/2011, прил. 4);
 *    п/ф раскладывается до сырья; данные — пищевая ценность товара по документу, иначе справочник MON CHEF;
 *  - физико-химия «не менее / не более» с допуском (по умолчанию 10 %); рецептура на выход, 1 кг и 100 кг;
 *  - аллергены — объединение профилей товаров (вводит человек по документу), включая п/ф;
 *  - микробиологические нормы и срок годности система не придумывает: их вносит технолог.
 * Статус «ПРОЕКТ», пока не всё подтверждено; «Готов к испытаниям» — когда данные полные и проверенные;
 * утверждает человек с протоколом испытаний аккредитованной лаборатории — неизменяемый снимок.
 */

export const ALLERGENS: Record<string, { label: string; stems: string[] }> = {
  peanut: { label: 'арахис', stems: ['арахис'] }, aspartame: { label: 'аспартам и аспартам-ацесульфамная соль', stems: ['аспартам'] },
  mustard: { label: 'горчица', stems: ['горчиц'] }, sulphites: { label: 'диоксид серы и сульфиты', stems: ['сульфит', 'диоксид серы'] },
  gluten: { label: 'злаки, содержащие глютен', stems: ['глютен', 'клейковин', 'пшениц', 'мук', 'хлеб', 'рож', 'ячмен', 'овёс', 'овес', 'макарон', 'манк'] },
  sesame: { label: 'кунжут', stems: ['кунжут'] }, lupin: { label: 'люпин', stems: ['люпин'] }, molluscs: { label: 'моллюски', stems: ['моллюск', 'мидии', 'кальмар', 'осьминог'] },
  milk: { label: 'молоко и продукты его переработки', stems: ['молок', 'молоч', 'лактоз', 'сливк', 'сыр', 'творог', 'масло слив', 'кефир', 'сметан', 'йогурт'] },
  nuts: { label: 'орехи', stems: ['орех', 'миндал', 'фундук', 'кешью', 'фисташ'] }, crustaceans: { label: 'ракообразные', stems: ['ракообраз', 'креветк', 'краб', 'рак', 'лангуст'] },
  fish: { label: 'рыба', stems: ['рыб', 'лосос', 'семг', 'треск', 'тунец', 'сельд', 'анчоус'] }, celery: { label: 'сельдерей', stems: ['сельдере'] },
  soy: { label: 'соя', stems: ['соя', 'соев'] }, egg: { label: 'яйца и продукты их переработки', stems: ['яйц', 'яичн', 'меланж', 'майонез'] },
};
const ALLERGEN_CODES = Object.keys(ALLERGENS) as [string, ...string[]];

const ENERGY = { protein: 4, fat: 9, carbs: 4 }, ENERGY_KJ = { protein: 17, fat: 37, carbs: 17 };
const LOSSES = { raw: { protein: 0, fat: 0, carbs: 0 }, thermal: { protein: 0.06, fat: 0.12, carbs: 0.09 } };
const THERMAL = /(варить|варят|отвар|жар|обжар|туш|запек|запеч|пассер|бланшир|кипят|кипяч|выпек|томит|припуск|фритюр|гриль|коптит|пасте(р|ур)из|\b(6\d|[7-9]\d|1\d\d|2\d\d)\s*°?\s*c\b)/i;

export const MICRO = [
  { code: 'KMAFANM', name: 'КМАФАнМ, КОЕ/г, не более', method: 'ГОСТ 10444.15-94' },
  { code: 'BGKP', name: 'БГКП (колиформы), масса продукта (г), в которой не допускаются', method: 'ГОСТ 31747-2012' },
  { code: 'ECOLI', name: 'E. coli, масса продукта (г), в которой не допускаются', method: 'ГОСТ 30726-2001' },
  { code: 'SAUREUS', name: 'S. aureus, масса продукта (г), в которой не допускаются', method: 'ГОСТ 31746-2012' },
  { code: 'PROTEUS', name: 'Бактерии рода Proteus, масса продукта (г), в которой не допускаются', method: 'ГОСТ 28560-90' },
  { code: 'SALMONELLA', name: 'Патогенные, в т. ч. сальмонеллы, масса продукта (г), в которой не допускаются', method: 'ГОСТ 31659-2012' },
  { code: 'LISTERIA', name: 'L. monocytogenes, масса продукта (г), в которой не допускаются', method: 'ГОСТ 32031-2022' },
  { code: 'YEAST_MOLD', name: 'Дрожжи и плесени, КОЕ/г, не более (если нормируются для группы)', method: 'ГОСТ 10444.12-2013' },
];

/** Документы, на которые ссылается ТУ. Санитарные правила — из нормативного реестра предприятия (не зашиты в систему). */
const NORMATIVE = [
  { code: 'ГОСТ Р 51740-2016', title: 'Технические условия на пищевую продукцию. Общие требования к разработке и оформлению', use: 'состав разделов ТУ' },
  { code: 'ГОСТ Р 1.3-2018', title: 'Технические условия на продукцию. Общие требования к содержанию, оформлению, обозначению и обновлению', use: 'обозначение, титульный лист' },
  { code: 'ГОСТ 31987-2012', title: 'Технологические документы на продукцию общественного питания. Общие требования', use: 'ТТК предприятия' },
  { code: 'ГОСТ 30390-2013', title: 'Продукция общественного питания, реализуемая населению. Общие технические условия', use: 'общие требования, приёмка, хранение' },
  { code: 'ГОСТ 31988-2012', title: 'Метод расчёта отходов и потерь сырья и пищевых продуктов', use: 'брутто, нетто, потери' },
  { code: 'ГОСТ 31986-2012', title: 'Метод органолептической оценки качества продукции общественного питания', use: 'органолептика, приёмка' },
  { code: 'ТР ТС 021/2011', title: 'О безопасности пищевой продукции', use: 'показатели безопасности, микробиология' },
  { code: 'ТР ТС 022/2011', title: 'Пищевая продукция в части её маркировки', use: 'энергетические коэффициенты, аллергены, маркировка' },
  { code: 'ТР ТС 029/2012', title: 'Требования безопасности пищевых добавок, ароматизаторов и технологических вспомогательных средств', use: 'пищевые добавки' },
  { code: 'ТР ТС 005/2011', title: 'О безопасности упаковки', use: 'упаковка' },
  { code: 'МУК 4.2.1847-04', title: 'Санитарно-эпидемиологическая оценка обоснования сроков годности и условий хранения пищевых продуктов', use: 'срок годности сверх установленного' },
];

const r1 = (n: number) => Math.round(n * 10) / 10, r2 = (n: number) => Math.round(n * 100) / 100;

interface Agg {
  input_g: number; protein: number; fat: number; carbs: number; data_g: number; verified_g: number; salt_g: number;
  missing: Set<string>; unverified: Set<string>; allergens: Map<string, Set<string>>; noProfile: Set<string>; suggest: Map<string, Set<string>>; warnings: string[];
}
const emptyAgg = (): Agg => ({ input_g: 0, protein: 0, fat: 0, carbs: 0, data_g: 0, verified_g: 0, salt_g: 0, missing: new Set(), unverified: new Set(), allergens: new Map(), noProfile: new Set(), suggest: new Map(), warnings: [] });

/** Данные пищевой ценности товара: по документу (подтверждено) или справочник (статус справочника). */
export async function nutritionOf(tx: Tx, productId: string) {
  const own = (await tx.query(`select kcal_100, protein_100, fat_100, carbs_100, basis, dry_matter_100, sucrose_100, fat_mass_100 from product_nutrition where product_id = $1 order by created_at desc limit 1`, [productId])).rows[0];
  const opt = (x: unknown) => (x === null || x === undefined ? null : Number(x));
  if (own) return { protein: Number(own.protein_100), fat: Number(own.fat_100), carbs: Number(own.carbs_100), verified: true, source: own.basis as string,
    dry_matter: opt(own.dry_matter_100), sucrose: opt(own.sucrose_100), fat_mass: opt(own.fat_mass_100) };
  const ref = (await tx.query(`select r.protein_100, r.fat_100, r.carbs_100, r.kcal_100, r.verification_status, r.code from products p join reference_products r on r.id = p.reference_product_id where p.id = $1`, [productId])).rows[0];
  if (ref && ref.kcal_100 !== null) return { protein: Number(ref.protein_100 || 0), fat: Number(ref.fat_100 || 0), carbs: Number(ref.carbs_100 || 0), verified: ref.verification_status === 'VERIFIED', source: `справочник MON CHEF ${ref.code}`,
    dry_matter: null, sucrose: null, fat_mass: null };
  return null;
}

export async function allergenProfile(tx: Tx, productId: string): Promise<string[] | null> {
  const r = (await tx.query(`select allergens from product_allergens where product_id = $1 order by created_at desc limit 1`, [productId])).rows[0];
  return r ? r.allergens : null;
}

export function suggestAllergens(name: string): string[] {
  const n = name.toLowerCase();
  return Object.entries(ALLERGENS).filter(([, a]) => a.stems.some((s) => n.includes(s))).map(([k]) => k);
}

const merge = (into: Map<string, Set<string>>, code: string, src: string) => { if (!into.has(code)) into.set(code, new Set()); into.get(code)!.add(src); };

/** Раскладка утверждённой ТТК до сырья с учётом п/ф: массы, нутриенты, покрытие данными, соль, аллергены. */
async function aggregate(tx: Tx, orgId: string, dishId: string, scale: number, path: string, depth: number, acc: Agg, stack: Set<string>) {
  if (depth > 5 || stack.has(dishId)) { acc.warnings.push(`${path}: циклическая или слишком глубокая вложенность п/ф.`); return; }
  const v = (await tx.query(`select id, yield_g from ttk_versions where dish_id = $1 and organization_id = $2 and status = 'approved'`, [dishId, orgId])).rows[0];
  if (!v) { acc.warnings.push(`${path}: нет утверждённой ТТК.`); return; }
  const lines = (await tx.query(`select l.*, p.name as product_name from ttk_lines l left join products p on p.id = l.product_id where l.version_id = $1 and l.kind = 'item' order by l.position`, [v.id])).rows;
  for (const l of lines) {
    const net = Number(l.netto ?? l.brutto ?? 0);
    if (l.product_id) {
      const g = await convertUnits(tx, l.product_id, net, l.unit, 'г');
      if (g === null) { acc.warnings.push(`${l.product_name}: нет пересчёта «${l.unit} → г» — строка не учтена в расчёте.`); continue; }
      const sg = g * scale;
      acc.input_g += sg;
      const nu = await nutritionOf(tx, l.product_id);
      if (nu) {
        acc.protein += sg * nu.protein / 100; acc.fat += sg * nu.fat / 100; acc.carbs += sg * nu.carbs / 100; acc.data_g += sg;
        if (nu.verified) acc.verified_g += sg; else acc.unverified.add(l.product_name);
      } else acc.missing.add(l.product_name);
      if (/(^|[^а-яё])соль([^а-яё]|$)/i.test(l.product_name)) acc.salt_g += sg;
      const prof = await allergenProfile(tx, l.product_id);
      if (prof === null) {
        acc.noProfile.add(l.product_name);
        for (const code of suggestAllergens(l.product_name)) merge(acc.suggest, code, l.product_name);
      } else for (const code of prof) merge(acc.allergens, code, path === '' ? l.product_name : `${l.product_name} (в ${path})`);
    } else if (l.sub_dish_id) {
      const sub = (await tx.query(`select d.name, v.yield_g from dishes d left join ttk_versions v on v.dish_id = d.id and v.status = 'approved' where d.id = $1`, [l.sub_dish_id])).rows[0];
      const g = await semiGrams(tx, l.sub_dish_id, net, l.unit);
      if (g === null || !sub?.yield_g) { acc.warnings.push(`${sub?.name || l.name_raw}: не определить массу п/ф — строка не учтена.`); continue; }
      await aggregate(tx, orgId, l.sub_dish_id, scale * g / Number(sub.yield_g), sub.name, depth + 1, acc, new Set([...stack, dishId]));
    } else acc.warnings.push(`${l.name_raw}: не сопоставлено с товаром — строка не учтена.`);
  }
}

export interface TuParams {
  processing?: 'thermal' | 'raw' | null; tolerance?: number | null; microGroup?: string | null; micro?: Record<string, string>;
  physNormed?: { dry?: boolean; fat?: boolean; sugar?: boolean; salt?: boolean }; gerberPct?: number | null; saltMaxPct?: number | null; dryCoef?: number | null; sugarCoef?: number | null;
  physBasis?: string | null; microIndex?: string | null; microNote?: string | null;
  tiGroup?: string | null; tiOks?: string | null; tiSeq?: string | null; tiCity?: string | null; tiPackaging?: string | null; tiSafety?: string | null; tiEnvironment?: string | null;
  tiEquipment?: string | null; rawDocs?: Record<string, string>;
  organoleptic?: string | null; channel?: string | null; okpd2?: string | null; seq?: string | null; okpo?: string | null;
}

/** Расчёт ТУ по утверждённой ТТК и параметрам. */
export async function calcTechSpec(tx: Tx, orgId: string, dishId: string, params: TuParams) {
  const dish = (await tx.query(`select id, name, kind from dishes where id = $1 and organization_id = $2`, [dishId, orgId])).rows[0];
  if (!dish) throw Errors.notFound('Блюдо не найдено.');
  const v = (await tx.query(`select * from ttk_versions where dish_id = $1 and organization_id = $2 and status = 'approved'`, [dishId, orgId])).rows[0];
  if (!v) throw Errors.conflict(`У «${dish.name}» нет утверждённой ТТК — ТУ рассчитываются по утверждённой карте.`);
  const acc = emptyAgg();
  await aggregate(tx, orgId, dishId, 1, '', 0, acc, new Set());
  const warnings = [...acc.warnings];
  const yieldG = Number(v.yield_g || 0);
  if (!yieldG) warnings.push('В ТТК не указан выход — расчёт невозможен.');

  const auto = THERMAL.test(v.technology || '') ? 'thermal' : 'raw';
  const processing = params.processing || auto;
  const loss = LOSSES[processing];
  const k = yieldG > 0 ? 100 / yieldG : 0;
  // без данных пищевой ценности ни по одному сырью — «не рассчитано», а не ноль
  const has = acc.data_g > 0 && yieldG > 0;
  const per100 = has ? { protein: r1(acc.protein * (1 - loss.protein) * k), fat: r1(acc.fat * (1 - loss.fat) * k), carbs: r1(acc.carbs * (1 - loss.carbs) * k), kcal: 0, kj: 0 } : null;
  if (per100) {
    per100.kcal = Math.round(per100.protein * ENERGY.protein + per100.fat * ENERGY.fat + per100.carbs * ENERGY.carbs);
    per100.kj = Math.round(per100.protein * ENERGY_KJ.protein + per100.fat * ENERGY_KJ.fat + per100.carbs * ENERGY_KJ.carbs);
  }
  const portionG = dish.kind === 'dish' && v.portion_g ? Number(v.portion_g) : null;
  const f = portionG ? portionG / 100 : 0;
  const perPortion = portionG && per100 ? { protein: r1(per100.protein * f), fat: r1(per100.fat * f), carbs: r1(per100.carbs * f), kcal: Math.round(per100.kcal * f), kj: Math.round(per100.kj * f) } : null;
  const coverage = acc.input_g > 0 ? Math.round(acc.data_g / acc.input_g * 100) : 0;
  const verified = acc.input_g > 0 ? Math.round(acc.verified_g / acc.input_g * 100) : 0;
  if (acc.missing.size) warnings.push(`Нет пищевой ценности: ${[...acc.missing].join(', ')} — расчёт занижен. Внесите данные по документу (маркировка изготовителя).`);
  if (acc.unverified.size) warnings.push(`Пищевая ценность не подтверждена документом (справочник «требует проверки»): ${[...acc.unverified].join(', ')}.`);

  const tol = params.tolerance ?? 0.1;
  const saltPct = yieldG > 0 ? r2(acc.salt_g / yieldG * 100) : 0;
  const physico = (per100 ? [
    { indicator: 'Массовая доля жира, %, не менее', calc: per100.fat, norm: r1(per100.fat * (1 - tol)), method: 'по методике аккредитованной лаборатории' },
    { indicator: 'Массовая доля белка, %, не менее', calc: per100.protein, norm: r1(per100.protein * (1 - tol)), method: 'по методике аккредитованной лаборатории' },
    { indicator: 'Массовая доля углеводов, %', calc: per100.carbs, norm: 'справочно', method: 'расчётный' },
  ] : []) as { indicator: string; calc: number; norm: number | string; method: string }[];
  if (acc.salt_g > 0) physico.push({ indicator: 'Массовая доля хлорида натрия (соли), %, не более', calc: saltPct, norm: r2(saltPct * (1 + tol)), method: 'по методике аккредитованной лаборатории' });

  const lossPct = acc.input_g > 0 && yieldG > 0 ? r1((acc.input_g - yieldG) / acc.input_g * 100) : 0;
  if (lossPct < 0) warnings.push(`Выход (${Math.round(yieldG)} г) больше закладки нетто (${Math.round(acc.input_g)} г) — проверьте выход и единицы (ГОСТ 31988-2012).`);
  const top = (await tx.query(`select l.name_raw, l.unit, l.netto, l.brutto, l.product_id, l.sub_dish_id, p.name as product_name, d.name as sub_name
    from ttk_lines l left join products p on p.id = l.product_id left join dishes d on d.id = l.sub_dish_id where l.version_id = $1 and l.kind = 'item' order by l.position`, [v.id])).rows;
  const recipe = [];
  for (const l of top) {
    const net = Number(l.netto ?? l.brutto ?? 0);
    const g = l.product_id ? await convertUnits(tx, l.product_id, net, l.unit, 'г') : l.sub_dish_id ? await semiGrams(tx, l.sub_dish_id, net, l.unit) : null;
    recipe.push({ name: l.product_name || l.sub_name || l.name_raw, kind: l.sub_dish_id ? 'п/ф' : 'сырьё', netto_g: g === null ? null : r1(g),
      per_1kg_g: g === null || !yieldG ? null : r1(g / yieldG * 1000), per_100kg_kg: g === null || !yieldG ? null : r2(g / yieldG * 100) });
  }

  const allergens = [...acc.allergens.entries()].map(([code, src]) => ({ code, label: ALLERGENS[code]?.label || code, sources: [...src] }));
  const suggest = [...acc.suggest.entries()].map(([code, src]) => ({ code, label: ALLERGENS[code]?.label || code, sources: [...src] }));
  if (acc.noProfile.size) warnings.push(`Нет профиля аллергенов: ${[...acc.noProfile].join(', ')} — аллергенная информация неполная.`);

  const storage = { conditions: v.storage_conditions || null, shelf_life: v.shelf_life || null, shelf_life_hours: v.shelf_life_hours ? Number(v.shelf_life_hours) : null };
  if (!storage.shelf_life) warnings.push('Срок годности в ТТК не указан — установите по действующим санитарным правилам; срок сверх установленного обосновывается по МУК 4.2.1847-04.');
  const micro = MICRO.map((m) => ({ ...m, norm: (params.micro || {})[m.code]?.trim() || null }));
  if (!micro.some((m) => m.norm)) warnings.push('Микробиологические нормативы не заполнены — внесите значения для группы продукции из ТР ТС 021/2011.');
  else if (micro.some((m) => !m.norm)) warnings.push(`Не заполнены микробиологические нормативы: ${micro.filter((m) => !m.norm).map((m) => m.code).join(', ')} (для показателей, не нормируемых для группы, укажите «не нормируется»).`);

  // Нормативные документы: состояние в реестре предприятия; санитарные правила — только из реестра.
  const reg = (await tx.query(`select s.code, s.kind, s.title,
      exists (select 1 from reg_source_versions x where x.source_id = s.id and x.workflow_status = 'approved' and (x.effective_from is null or x.effective_from <= current_date)
        and (x.effective_to is null or x.effective_to > current_date)) as in_force
    from reg_sources s where s.organization_id = $1`, [orgId])).rows as { code: string; kind: string; title: string; in_force: boolean }[];
  const normative = NORMATIVE.map((d) => ({ ...d, state: reg.find((r) => r.code === d.code)?.in_force ? 'действует' : reg.some((r) => r.code === d.code) ? 'не проверено' : 'нет в реестре' }));
  const sanpin = reg.filter((r) => r.kind === 'СанПиН' && r.in_force);
  for (const s of sanpin) normative.push({ code: s.code, title: s.title.replace(/^СанПиН\s+\S+\s*/, '').replace(/^«|»$/g, '') || s.title, use: 'санитарные требования, хранение, сроки', state: 'действует' });
  if (!sanpin.length) warnings.push('В нормативном реестре нет утверждённых действующих санитарных правил для общественного питания — ТУ на них сослаться не могут.');

  const designation = `ТУ ${params.okpd2 || '__.__.__'}-${(params.seq || '001').padStart(3, '0')}-${params.okpo || '________'}-${new Date().getFullYear()}`;
  if (!params.okpd2 || !params.okpo) warnings.push('Для обозначения ТУ укажите код ОКПД2 продукции и код ОКПО предприятия (ГОСТ Р 1.3-2018).');

  const complete = !!per100 && coverage === 100 && verified === 100 && !acc.noProfile.size && !!storage.shelf_life && micro.every((m) => m.norm) && sanpin.length > 0 && yieldG > 0;
  return {
    object: { dish_id: dish.id, name: dish.name, kind: dish.kind, ttk_version_id: v.id, ttk_version: v.version, yield_g: yieldG, portion_g: portionG, input_mass_g: r1(acc.input_g), production_loss_pct: lossPct },
    processing: { mode: processing, auto, reason: auto === 'thermal' ? 'в технологии есть тепловая обработка' : 'в технологии нет тепловой обработки', losses: loss },
    nutrition: { per100, per_portion: perPortion, coverage_pct: coverage, verified_pct: verified },
    physico, tolerance: tol, recipe,
    allergens: { contains: allergens, suggest, no_profile: [...acc.noProfile], complete: !acc.noProfile.size },
    storage, micro: { group: params.microGroup || (dish.kind === 'semi' ? 'Полуфабрикаты кулинарные' : 'Кулинарная продукция'), indicators: micro },
    organoleptic: params.organoleptic || 'Внешний вид, цвет, консистенция, вкус и запах — по описанию утверждённой ТТК; оценка по ГОСТ 31986-2012.',
    channel: params.channel || 'через предприятия общественного питания и вне их',
    normative, designation, status: complete ? 'ready' : 'project', warnings, generated_at: new Date().toISOString(),
  };
}

/* ───────────── API ───────────── */

export async function getTechSpec(userId: string, orgId: string, dishId: string) {
  return inOrg(userId, orgId, 'menu.read', async (tx) => {
    const spec = (await tx.query(`select params, updated_at from tech_specs where dish_id = $1 and organization_id = $2`, [dishId, orgId])).rows[0];
    const params: TuParams = spec?.params || {};
    const calc = await calcTechSpec(tx, orgId, dishId, params);
    const versions = (await tx.query(`select v.id, v.version, v.designation, v.lab_protocol, v.approved_at, u.full_name as approved_by_name, t.version as ttk_version
      from tech_spec_versions v join users u on u.id = v.approved_by join ttk_versions t on t.id = v.ttk_version_id where v.dish_id = $1 order by v.version desc`, [dishId])).rows;
    // по каждому сырью — данные пищевой ценности и профиль аллергенов (для ввода по документу)
    const products = (await tx.query(`with recursive tree(dish_id, depth) as (select $1::uuid, 0 union
        select l.sub_dish_id, t.depth + 1 from tree t join ttk_versions v on v.dish_id = t.dish_id and v.status = 'approved' join ttk_lines l on l.version_id = v.id where l.sub_dish_id is not null and t.depth < 5)
      select distinct p.id, p.name, p.unit from tree t join ttk_versions v on v.dish_id = t.dish_id and v.status = 'approved' join ttk_lines l on l.version_id = v.id join products p on p.id = l.product_id order by p.name`, [dishId])).rows;
    for (const p of products) {
      p.nutrition = await nutritionOf(tx, p.id);
      p.allergens = await allergenProfile(tx, p.id);
      p.suggest = suggestAllergens(p.name);
    }
    return { params, calc, versions, products, allergen_list: Object.entries(ALLERGENS).map(([code, a]) => ({ code, label: a.label })), micro_list: MICRO };
  });
}

const ParamsInput = z.object({
  processing: z.enum(['thermal', 'raw']).nullable().optional(),
  tolerance: z.coerce.number().min(0).max(0.5).nullable().optional(),
  microGroup: optText(200), organoleptic: optText(2000), channel: optText(300),
  okpd2: z.string().trim().regex(/^\d{2}\.\d{2}(\.\d{1,2}){0,2}$/, 'ОКПД2 — например 10.85.19.').nullable().optional().or(z.literal('').transform(() => null)),
  seq: z.string().trim().regex(/^\d{1,3}$/, 'Порядковый номер — до 3 цифр.').nullable().optional().or(z.literal('').transform(() => null)),
  okpo: z.string().trim().regex(/^\d{8,10}$/, 'ОКПО — 8 или 10 цифр.').nullable().optional().or(z.literal('').transform(() => null)),
  micro: z.record(z.string(), z.string().trim().max(200)).optional(),
  // ТТК: нормируемые физико-химические показатели (Методические указания по лабораторному контролю, 1997)
  physNormed: z.object({ dry: z.boolean(), fat: z.boolean(), sugar: z.boolean(), salt: z.boolean() }).partial().optional(),
  gerberPct: z.coerce.number().min(0).max(100).nullable().optional(), saltMaxPct: z.coerce.number().min(0).max(20).nullable().optional(),
  dryCoef: z.coerce.number().min(0).max(1).nullable().optional(), sugarCoef: z.coerce.number().min(0).max(1).nullable().optional(),
  physBasis: optText(500), microIndex: optText(300), microNote: optText(1000),
  // ТИ: титульный лист и разделы, которые вписывает технолог
  tiGroup: optText(60), tiOks: optText(60), tiSeq: z.string().trim().regex(/^\d{1,3}$/, 'Порядковый номер ТИ — до 3 цифр.').nullable().optional().or(z.literal('').transform(() => null)),
  tiCity: optText(100), tiPackaging: optText(4000), tiSafety: optText(4000), tiEnvironment: optText(4000), tiEquipment: optText(4000),
  rawDocs: z.record(z.uuid(), z.string().trim().max(300)).optional(),   // НД на сырьё: ГОСТ, ТУ, спецификация
});

export async function saveTechSpecParams(userId: string, orgId: string, dishId: string, input: unknown) {
  const d = parse(ParamsInput, input);
  return inOrg(userId, orgId, 'ttk.manage', async (tx) => {
    if (!(await tx.query(`select 1 from dishes where id = $1 and organization_id = $2`, [dishId, orgId])).rowCount) throw Errors.notFound('Блюдо не найдено.');
    const micro = Object.fromEntries(Object.entries(d.micro || {}).filter(([k, v]) => MICRO.some((m) => m.code === k) && v));
    // параметры ТУ и ТТК хранятся вместе: не переданное сохраняется
    const old = (await tx.query(`select params from tech_specs where dish_id = $1`, [dishId])).rows[0]?.params || {};
    const given = new Set(Object.keys((input && typeof input === 'object' ? input : {}) as object));
    const params = { ...old, ...Object.fromEntries(Object.entries(d).filter(([k]) => given.has(k))), ...(d.micro ? { micro } : {}) };
    await tx.query(`insert into tech_specs (organization_id, dish_id, params, updated_by) values ($1, $2, $3, $4)
      on conflict (dish_id) do update set params = excluded.params, updated_by = excluded.updated_by, updated_at = now()`, [orgId, dishId, JSON.stringify(params), userId]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'tu.params', entityType: 'dish', entityId: dishId, after: params });
    return { ok: true };
  });
}

const ApproveInput = z.object({ labProtocol: z.string().trim().min(8, 'Укажите протокол испытаний аккредитованной лаборатории: номер, дата, лаборатория.').max(500) });

/** Утверждение ТУ: только полный проверенный расчёт и протокол испытаний; снимок не меняется. */
export async function approveTechSpec(userId: string, orgId: string, dishId: string, input: unknown) {
  const d = parse(ApproveInput, input);
  return inOrg(userId, orgId, 'ttk.approve', async (tx) => {
    const spec = (await tx.query(`select params from tech_specs where dish_id = $1 and organization_id = $2 for update`, [dishId, orgId])).rows[0];
    const calc = await calcTechSpec(tx, orgId, dishId, spec?.params || {});
    if (calc.status !== 'ready') throw Errors.conflict(`ТУ — проект, утвердить нельзя: ${calc.warnings.join(' ')}`);
    const n = Number((await tx.query(`select coalesce(max(version), 0) as m from tech_spec_versions where dish_id = $1`, [dishId])).rows[0].m) + 1;
    const row = (await tx.query(`insert into tech_spec_versions (organization_id, dish_id, version, ttk_version_id, designation, snapshot, lab_protocol, approved_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8) returning id, version, approved_at`, [orgId, dishId, n, calc.object.ttk_version_id, calc.designation, JSON.stringify(calc), d.labProtocol, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'tu.approve', entityType: 'dish', entityId: dishId, after: { version: n, designation: calc.designation, lab_protocol: d.labProtocol } });
    return row;
  });
}

export async function getTechSpecVersion(userId: string, orgId: string, dishId: string, version: number) {
  return inOrg(userId, orgId, 'menu.read', async (tx) => {
    const v = (await tx.query(`select v.*, u.full_name as approved_by_name from tech_spec_versions v join users u on u.id = v.approved_by
      where v.dish_id = $1 and v.organization_id = $2 and v.version = $3`, [dishId, orgId, version])).rows[0];
    if (!v) throw Errors.notFound('Версия ТУ не найдена.');
    return v;
  });
}

const num = z.union([z.number(), z.string().trim().regex(/^\d+([.,]\d+)?$/, 'Введите число.').transform((s) => Number(s.replace(',', '.')))]).refine((x) => x >= 0 && x <= 1000, 'Значение на 100 г — от 0 до 1000.');
const pct100 = z.union([z.number(), z.string().trim().regex(/^\d+([.,]\d+)?$/, 'Введите число.').transform((s) => Number(s.replace(',', '.')))]).refine((x) => x >= 0 && x <= 100, 'Значение на 100 г — от 0 до 100.');
const NutritionInput = z.object({ kcal: num, protein: num, fat: num, carbs: num,
  dryMatter: pct100.nullable().optional(), sucrose: pct100.nullable().optional(), fatMass: pct100.nullable().optional(),   // сухие вещества, сахароза, массовая доля жира
  basis: z.string().trim().min(5, 'Укажите документ: маркировка изготовителя, удостоверение качества, протокол.').max(300) })
  .refine((x) => x.protein + x.fat + x.carbs <= 100, 'Белки, жиры и углеводы вместе — не больше 100 г на 100 г.');

/** Пищевая ценность товара на 100 г по документу. Новая запись заменяет прежнюю, история сохраняется. */
export async function setProductNutrition(userId: string, orgId: string, productId: string, input: unknown) {
  const d = parse(NutritionInput, input);
  return inOrg(userId, orgId, 'ttk.manage', async (tx) => {
    if (!(await tx.query(`select 1 from products where id = $1 and organization_id = $2`, [productId, orgId])).rowCount) throw Errors.notFound('Товар не найден.');
    await tx.query(`insert into product_nutrition (organization_id, product_id, kcal_100, protein_100, fat_100, carbs_100, basis, created_by, dry_matter_100, sucrose_100, fat_mass_100)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [orgId, productId, d.kcal, d.protein, d.fat, d.carbs, d.basis, userId, d.dryMatter ?? null, d.sucrose ?? null, d.fatMass ?? null]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'product.nutrition', entityType: 'product', entityId: productId, after: d });
    return { ok: true };
  });
}

const AllergenInput = z.object({ allergens: z.array(z.enum(ALLERGEN_CODES)).max(ALLERGEN_CODES.length),
  basis: z.string().trim().min(5, 'Укажите документ: состав на маркировке, спецификация поставщика.').max(300) });

/** Профиль аллергенов товара по документу (пустой список — «не содержит»). */
export async function setProductAllergens(userId: string, orgId: string, productId: string, input: unknown) {
  const d = parse(AllergenInput, input);
  return inOrg(userId, orgId, 'ttk.manage', async (tx) => {
    if (!(await tx.query(`select 1 from products where id = $1 and organization_id = $2`, [productId, orgId])).rowCount) throw Errors.notFound('Товар не найден.');
    await tx.query(`insert into product_allergens (organization_id, product_id, allergens, basis, created_by) values ($1, $2, $3, $4, $5)`, [orgId, productId, [...new Set(d.allergens)], d.basis, userId]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'product.allergens', entityType: 'product', entityId: productId, after: d });
    return { ok: true };
  });
}
