/**
 * Микробиологические нормативы безопасности продукции общественного питания — ТР ТС 021/2011 (ред. на 22.04.2024,
 * ИС «Техэксперт»). Значения перенесены вручную из:
 *  - приложения 2, таблица 1, п. 1.8 «Другие продукты» (с. 70–83 издания; показатели КМАФАнМ, БГКП, E. coli,
 *    S. aureus, Proteus, сульфитредуцирующие клостридии, дрожжи, плесени). Степени у КМАФАнМ в тексте издания —
 *    изображения: сверены по страницам 71–73, дрожжи и плесени — по с. 82;
 *  - приложения 1 «патогенные»: «Готовые кулинарные изделия, блюда общественного питания» — 25 г
 *    (50 г — для напитков общественного питания); Listeria monocytogenes — «салаты из сырых овощей и фруктов» — 25 г.
 * Названия групп — формулировки регламента. Показатель, который регламент для группы не устанавливает, — null:
 * в ТУ пишется «не нормируется», а не выдумывается.
 */

export const MICRO_DOC = 'ТР ТС 021/2011';
export type MicroCode = 'KMAFANM' | 'BGKP' | 'ECOLI' | 'SAUREUS' | 'PROTEUS' | 'CLOSTRIDIA' | 'SALMONELLA' | 'LISTERIA' | 'YEAST' | 'MOLD';

export const MICRO_INDICATORS: { code: MicroCode; name: string; method: string; ref: string }[] = [
  { code: 'KMAFANM', name: 'КМАФАнМ, КОЕ/г, не более', method: 'ГОСТ 10444.15-94', ref: 'прил. 2, табл. 1, п. 1.8' },
  { code: 'BGKP', name: 'БГКП (колиформы), масса продукта (г), в которой не допускаются', method: 'ГОСТ 31747-2012', ref: 'прил. 2, табл. 1, п. 1.8' },
  { code: 'ECOLI', name: 'E. coli, масса продукта (г), в которой не допускаются', method: 'ГОСТ 30726-2001', ref: 'прил. 2, табл. 1, п. 1.8' },
  { code: 'SAUREUS', name: 'S. aureus, масса продукта (г), в которой не допускаются', method: 'ГОСТ 31746-2012', ref: 'прил. 2, табл. 1, п. 1.8' },
  { code: 'PROTEUS', name: 'Бактерии рода Proteus, масса продукта (г), в которой не допускаются', method: 'ГОСТ 28560-90', ref: 'прил. 2, табл. 1, п. 1.8' },
  { code: 'CLOSTRIDIA', name: 'Сульфитредуцирующие клостридии, масса продукта (г), в которой не допускаются', method: 'ГОСТ 29185-2014', ref: 'прил. 2, табл. 1, п. 1.8' },
  { code: 'SALMONELLA', name: 'Патогенные, в т. ч. сальмонеллы, масса продукта (г), в которой не допускаются', method: 'ГОСТ 31659-2012', ref: 'прил. 1' },
  { code: 'LISTERIA', name: 'L. monocytogenes, масса продукта (г), в которой не допускаются', method: 'ГОСТ 32031-2022', ref: 'прил. 1' },
  { code: 'YEAST', name: 'Дрожжи, КОЕ/г, не более', method: 'ГОСТ 10444.12-2013', ref: 'прил. 2, табл. 1, п. 1.8' },
  { code: 'MOLD', name: 'Плесени, КОЕ/г, не более', method: 'ГОСТ 10444.12-2013', ref: 'прил. 2, табл. 1, п. 1.8' },
];

type V = Partial<Record<MicroCode, string>>;
export interface MicroGroup { code: string; name: string; keys: string[]; values: V; note?: string }

const S25 = { SALMONELLA: '25' };
const HOT = { BGKP: '1,0', SAUREUS: '1,0', ...S25 };

/** Группы продукции общественного питания (п. 1.8). keys — слова для подсказки группы по названию блюда. */
export const MICRO_GROUPS: MicroGroup[] = [
  { code: 'soup_hot', name: 'Супы горячие и другие горячие блюда: борщи, щи, рассольник, суп-харчо, солянки, овощные супы, бульоны', keys: ['борщ', 'щи', 'рассольник', 'харчо', 'солянк', 'бульон', 'суп'],
    values: { KMAFANM: '5×10²', BGKP: '1,0', ...S25 }, note: 'S. aureus регламент устанавливает только для супов с макаронными изделиями, картофелем, овощами, бобовыми, крупами, молочных и супов-пюре.' },
  { code: 'soup_filled', name: 'Супы с макаронными изделиями и картофелем, овощами, бобовыми, крупами; супы молочные с теми же наполнителями', keys: ['лапш', 'суп молочн', 'гороховый', 'фасолев', 'с вермишел', 'с крупой'],
    values: { KMAFANM: '5×10²', ...HOT } },
  { code: 'soup_puree', name: 'Супы-пюре', keys: ['суп-пюре', 'крем-суп', 'суп пюре'], values: { KMAFANM: '5×10²', ECOLI: '1,0', ...HOT } },
  { code: 'soup_cold_sweet', name: 'Супы холодные сладкие и супы-пюре из плодов и ягод консервированных и сушеных', keys: ['суп фруктов', 'суп из ягод', 'суп из плодов'], values: { KMAFANM: '1×10³', ...HOT } },
  { code: 'soup_cold_borsch', name: 'Супы холодные: борщи, щи зеленые с мясом, рыбой, яйцом (без заправки сметаной)', keys: ['борщ холодн', 'щи зелен'],
    values: { KMAFANM: '1×10⁴', BGKP: '0,01', ECOLI: '0,1', SAUREUS: '0,1', PROTEUS: '0,1', ...S25 } },
  { code: 'soup_cold', name: 'Супы холодные: окрошка, овощные, мясные на квасе, кефире, свекольник, ботвинья', keys: ['окрошк', 'свекольник', 'ботвинь', 'холодник'],
    values: { BGKP: '0,01', ECOLI: '0,1', SAUREUS: '0,1', PROTEUS: '0,1', ...S25 }, note: 'КМАФАнМ для этих супов регламент не устанавливает.' },
  { code: 'eggs_boiled', name: 'Блюда из яиц: яйца вареные', keys: ['яйцо варен', 'яйца варен'], values: { KMAFANM: '1×10³', ...HOT } },
  { code: 'eggs', name: 'Блюда из яиц: омлеты из яиц (меланжа, яичного порошка) натуральные и с добавлением овощей, мясных продуктов и т.п., начинки с включением яиц', keys: ['омлет', 'яичниц', 'фриттат', 'скрэмбл', 'драчен'],
    values: { KMAFANM: '1×10³', PROTEUS: '0,1', ...HOT } },
  { code: 'curd_steam', name: 'Блюда из творога: вареники ленивые, пудинг вареный на пару', keys: ['вареники ленив', 'пудинг на пару', 'пудинг паров'], values: { KMAFANM: '5×10²', ...HOT } },
  { code: 'curd_baked', name: 'Блюда из творога: сырники творожные, запеканки, пудинг запеченный, начинки из творога, пироги', keys: ['сырник', 'запеканк', 'творож'], values: { KMAFANM: '1×10³', PROTEUS: '0,1', ...HOT } },
  { code: 'fish', name: 'Блюда из рыбы: рыба отварная, припущенная, тушеная, жареная, запеченная', keys: ['рыб', 'лосос', 'семг', 'треск', 'судак', 'форел', 'минта', 'хек', 'горбуш', 'скумбри', 'дорадо', 'сибас'],
    values: { KMAFANM: '1×10³', PROTEUS: '0,1', ...HOT } },
  { code: 'fish_minced', name: 'Блюда из рыбной котлетной массы (котлеты, зразы, шницели, фрикадельки с томатным соусом); запеченные изделия, пироги', keys: ['котлеты рыб', 'рыбные котлет', 'тефтели рыб', 'фрикадельки рыб', 'зразы рыб'],
    values: { KMAFANM: '2,5×10³', PROTEUS: '0,1', ...HOT } },
  { code: 'meat', name: 'Блюда из мяса и мясных продуктов: мясо отварное, жареное, тушеное, пловы, пельмени, беляши, блинчики, изделия из рубленого мяса, в т.ч. запеченные',
    keys: ['говядин', 'свинин', 'баранин', 'телятин', 'мясо', 'плов', 'пельмен', 'беляш', 'блинчик', 'котлет', 'тефтел', 'биточ', 'гуляш', 'бефстроганов', 'азу', 'стейк', 'шашлык', 'жаркое'],
    values: { KMAFANM: '1×10³', PROTEUS: '0,1', ...HOT } },
  { code: 'poultry', name: 'Блюда из птицы, кролика: отварные, жареные, тушеные, запеченные; изделия из рубленой птицы, пельмени, пироги', keys: ['кур', 'цыпл', 'индейк', 'утк', 'гус', 'кролик', 'птиц'],
    values: { KMAFANM: '1×10³', PROTEUS: '0,1', ...HOT } },
  { code: 'garnish', name: 'Гарниры: рис отварной, макаронные изделия отварные, пюре картофельное (без заправки), картофель отварной, жареный (без заправки)', keys: ['гарнир', 'рис отвар', 'макарон', 'спагетти', 'паста', 'пюре картоф', 'картофель', 'гречк', 'каша'],
    values: { KMAFANM: '1×10³', PROTEUS: '0,1', ...HOT } },
  { code: 'garnish_veg', name: 'Гарниры: овощи тушеные (без заправки)', keys: ['овощи туш', 'рагу овощ'], values: { KMAFANM: '5×10²', PROTEUS: '0,1', ...HOT } },
  { code: 'sauce', name: 'Соусы и заправки для вторых блюд', keys: ['соус', 'подлив', 'заправк', 'грейви'], values: { KMAFANM: '5×10³', PROTEUS: '0,1', ...HOT } },
  { code: 'sweet_drinks', name: 'Сладкие блюда и напитки: компоты из плодов и ягод свежих, консервированных, сушеных; кисели из свежих, сушеных плодов и ягод, соков, сиропов, пюре плодовых и ягодных',
    keys: ['компот', 'кисел', 'морс'], values: { KMAFANM: '5×10²', BGKP: '1,0', SAUREUS: '1,0', SALMONELLA: '50' }, note: 'Патогенные — 50 г: напитки общественного питания (прил. 1).' },
  { code: 'jelly', name: 'Желе, муссы', keys: ['желе', 'мусс'], values: { KMAFANM: '1×10³', ...HOT } },
  { code: 'charlotte', name: 'Шарлотка с яблоками', keys: ['шарлотк'], values: { KMAFANM: '1×10³', ...HOT } },
  { code: 'boiled_cold', name: 'Говядина, птица, кролик, свинина и т.д. отварные (без заправки и соуса)', keys: ['отварн', 'буженин', 'язык отвар'], values: { KMAFANM: '1×10⁴', PROTEUS: '0,1', ...HOT } },
  { code: 'fish_marinade', name: 'Рыба отварная, жареная под маринадом', keys: ['под маринад'], values: { KMAFANM: '1×10⁴', PROTEUS: '0,1', ...HOT } },
  { code: 'aspic_meat', name: 'Студни из говядины, свинины, птицы (заливные)', keys: ['студен', 'холодец', 'заливн'], values: { KMAFANM: '1×10⁴', BGKP: '0,1', ECOLI: '1,0', SAUREUS: '0,1', PROTEUS: '0,1', ...S25 } },
  { code: 'aspic_fish', name: 'Студни из рыбы (заливные)', keys: ['рыба заливн', 'заливное из рыб'], values: { KMAFANM: '1×10³', PROTEUS: '0,1', ...HOT } },
  { code: 'pate', name: 'Паштеты из мяса и печени', keys: ['паштет'], values: { KMAFANM: '1×10⁴', BGKP: '0,1', ECOLI: '1,0', SAUREUS: '0,1', PROTEUS: '0,1', ...S25 } },
  { code: 'salad_raw', name: 'Салаты из сырых овощей и фруктов без заправки', keys: ['салат из свеж', 'салат овощн', 'салат из огурц', 'салат из помидор', 'салат фруктов'],
    values: { KMAFANM: '1×10⁴', BGKP: '0,1', ECOLI: '1,0', SAUREUS: '1,0', LISTERIA: '25', ...S25 } },
  { code: 'salad_raw_dressed', name: 'Салаты из сырых овощей и фруктов с заправками (майонез, соусы и др.)', keys: ['салат'],
    values: { KMAFANM: '5×10⁴', BGKP: '0,1', ECOLI: '1,0', SAUREUS: '1,0', LISTERIA: '25', YEAST: '500', MOLD: '50', ...S25 } },
  { code: 'salad_raw_egg', name: 'Салаты из сырых овощей с добавлением яиц, консервированных овощей, плодов и т.д. без заправки и без добавления соленых овощей', keys: [],
    values: { BGKP: '0,01', ECOLI: '0,1', SAUREUS: '0,1', PROTEUS: '0,1', ...S25 }, note: 'КМАФАнМ для группы регламент не устанавливает.' },
  { code: 'salad_raw_egg_dressed', name: 'Салаты из сырых овощей с добавлением яиц, консервированных овощей, плодов и т.д. с заправками (майонез, соусы и др.)', keys: [],
    values: { BGKP: '0,01', ECOLI: '0,1', SAUREUS: '0,1', PROTEUS: '0,1', YEAST: '500', MOLD: '50', ...S25 }, note: 'КМАФАнМ для группы регламент не устанавливает.' },
  { code: 'salad_pickled', name: 'Салаты из маринованных, квашеных, соленых овощей', keys: ['квашен', 'маринован', 'солен'], values: { BGKP: '0,1', SAUREUS: '1,0', PROTEUS: '0,1', ...S25 }, note: 'КМАФАнМ для группы регламент не устанавливает.' },
  { code: 'salad_boiled', name: 'Салаты и винегреты из вареных овощей и блюда из вареных, жареных, тушеных овощей без добавления соленых овощей и заправки', keys: ['винегрет'],
    values: { KMAFANM: '5×10³', BGKP: '0,1', SAUREUS: '1,0', PROTEUS: '0,1', ...S25 } },
  { code: 'salad_boiled_dressed', name: 'Салаты и винегреты из вареных овощей и блюда из вареных, жареных, тушеных овощей с заправками (майонез, соусы и др.)', keys: ['оливье', 'шуба', 'винегрет'],
    values: { KMAFANM: '5×10⁴', BGKP: '0,1', ECOLI: '0,1', SAUREUS: '1,0', PROTEUS: '0,1', YEAST: '500', MOLD: '50', ...S25 } },
  { code: 'salad_meat', name: 'Салаты с добавлением мяса, птицы, рыбы, копченостей и т.д. без заправки', keys: [], values: { KMAFANM: '1×10⁴', BGKP: '0,1', ECOLI: '0,1', PROTEUS: '0,1', ...S25 },
    note: 'S. aureus для группы регламент не устанавливает.' },
  { code: 'salad_meat_dressed', name: 'Салаты с добавлением мяса, птицы, рыбы, копченостей и т.д. с заправками (майонез, соусы и др.)', keys: ['цезарь', 'мимоза', 'столичн'],
    values: { KMAFANM: '5×10⁴', BGKP: '0,1', ECOLI: '0,1', PROTEUS: '0,1', YEAST: '500', MOLD: '50', ...S25 }, note: 'S. aureus для группы регламент не устанавливает.' },
  { code: 'creams', name: 'Кремы (из цитрусовых, ванильный, шоколадный и т.п.)', keys: ['крем'], values: { BGKP: '0,1', SAUREUS: '0,1', ...S25 }, note: 'КМАФАнМ для группы регламент не устанавливает.' },
  { code: 'pizza', name: 'Пицца готовая', keys: ['пицц'], values: { KMAFANM: '1×10³', PROTEUS: '0,1', ...HOT } },
  { code: 'burgers', name: 'Гамбургеры, чизбургеры, сэндвичи готовые', keys: ['бургер', 'сэндвич', 'сендвич', 'бутерброд', 'шаурм', 'ролл'], values: { KMAFANM: '2×10⁴', BGKP: '0,1', ECOLI: '1,0', SAUREUS: '1,0', ...S25 } },
  { code: 'packaged', name: 'Готовые кулинарные изделия из мяса птицы, рыбы в потребительской таре, в т.ч. упакованные под вакуумом', keys: ['вакуум', 'в потребительской тар'],
    values: { KMAFANM: '1×10³', PROTEUS: '0,1', CLOSTRIDIA: '0,1', ...HOT } },
];

export const microGroup = (code: string | null | undefined) => MICRO_GROUPS.find((g) => g.code === code) || null;

/** Подсказка группы по названию блюда: самое длинное совпавшее ключевое слово. Решение — за человеком. */
export function suggestMicroGroup(name: string): MicroGroup | null {
  const n = name.toLowerCase().replace(/ё/g, 'е');
  let best: { g: MicroGroup; len: number } | null = null;
  for (const g of MICRO_GROUPS) for (const k of g.keys) if (n.includes(k) && (!best || k.length > best.len)) best = { g, len: k.length };
  return best?.g || null;
}

/** Нормативы группы по всем показателям: значение регламента или «не нормируется». */
export function microTable(g: MicroGroup) {
  return MICRO_INDICATORS.map((i) => ({ ...i, norm: g.values[i.code] ?? null,
    basis: g.values[i.code] ? `${MICRO_DOC}, ${i.ref}: «${g.name}»` : `${MICRO_DOC}: для группы «${g.name}» не устанавливается` }));
}

export interface MicroParams { microGroupCode?: string | null; micro?: Record<string, string>; microIndex?: string | null }
export interface MicroResolved {
  mode: 'law' | 'custom' | 'none';
  code: string | null; group: string | null; confirmed: boolean;
  suggested: { code: string; name: string } | null;
  index: string | null; note: string | null;
  indicators: { code: string; name: string; method: string; norm: string | null; basis: string | null }[];
}

/**
 * Микробиологические нормативы документа (ТУ, ТТК, ТИ, СТО):
 *  - группа ТР ТС 021 выбрана (у блюда или папки) — значения регламента, вручную не меняются;
 *  - «custom» — продукция вне групп п. 1.8: значения вводит технолог со своим основанием (как раньше);
 *  - ничего не выбрано — система предлагает группу по названию; пока человек не подтвердил, документ — проект.
 * Старые параметры с ручными значениями без группы читаются как «custom».
 */
export function resolveMicro(params: MicroParams, dishName: string): MicroResolved {
  const manual = Object.fromEntries(Object.entries(params.micro || {}).filter(([, v]) => v && v.trim()));
  const g = microGroup(params.microGroupCode);
  const sug = suggestMicroGroup(dishName);
  const suggested = sug ? { code: sug.code, name: sug.name } : null;
  if (g) return { mode: 'law', code: g.code, group: g.name, confirmed: true, suggested, index: `${MICRO_DOC}, прил. 2, табл. 1, п. 1.8; прил. 1 — «${g.name}»`, note: g.note || null, indicators: microTable(g) };
  if (params.microGroupCode === 'custom' || Object.keys(manual).length) {
    const ind = MICRO_INDICATORS.map((i) => ({ ...i, norm: manual[i.code]?.trim() || null, basis: params.microIndex || null }));
    return { mode: 'custom', code: 'custom', group: params.microIndex || 'группа указана технологом', confirmed: ind.every((i) => i.norm) && !!params.microIndex, suggested, index: params.microIndex || null, note: null, indicators: ind };
  }
  return { mode: 'none', code: null, group: sug?.name || null, confirmed: false, suggested, index: null, note: sug?.note || null,
    indicators: sug ? microTable(sug) : MICRO_INDICATORS.map((i) => ({ ...i, norm: null, basis: null })) };
}
