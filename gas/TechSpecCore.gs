// ЦЕХ — TechSpecCore.gs
// Технические условия (ТУ) и расчётные показатели ТТК для блюда и полуфабриката.
// Источник истины — рецептура (RECIPES) + справочник сырья (GLOBAL_PRODUCTS,
// PRODUCT_ALLERGENS). Расчёт выполняется автоматически так же, как себестоимость:
// при открытии ТТК, при сохранении черновика и с фиксацией снимка при утверждении.
//
// Что считается, а что нет (флагую явно):
//  - КБЖУ, энергетическая ценность, массовые доли жира/белка/углеводов/соли,
//    рецептура на 100 кг, аллергены — РАСЧЁТ по рецептуре;
//  - микробиологические нормативы и срок годности НЕ рассчитываются: они берутся
//    из ТР ТС 021/2011 и СанПиН 2.3/2.4.3590-20, а срок сверх установленного
//    требует обоснования по МУК 4.2.1847-04 (лабораторные испытания);
//  - расчётные значения в ТУ подтверждаются протоколом испытаний аккредитованной
//    лаборатории — документ без протокола имеет статус «ПРОЕКТ».

// ТР ТС 022/2011, приложение 4 — коэффициенты пересчёта, ккал/г и кДж/г.
var TECH_SPEC_ENERGY = { protein: 4, fat: 9, carbohydrate: 4 };
var TECH_SPEC_ENERGY_KJ = { protein: 17, fat: 37, carbohydrate: 17 };

// Потери пищевых веществ при тепловой кулинарной обработке (усреднённые
// коэффициенты методики расчёта по справочнику «Химический состав российских
// пищевых продуктов» / сборникам рецептур): белки 6%, жиры 12%, углеводы 9%.
var TECH_SPEC_LOSSES = {
  raw:     { protein: 0,    fat: 0,    carbohydrate: 0 },
  thermal: { protein: 0.06, fat: 0.12, carbohydrate: 0.09 }
};

// Допуск для нормируемых физико-химических показателей ТУ («не менее/не более»).
// Устанавливается разработчиком ТУ и подтверждается испытаниями.
var TECH_SPEC_DEFAULT_TOLERANCE = 0.1;

// ТР ТС 022/2011, ст. 4 — компоненты, вызывающие аллергические реакции.
// Ключ — название по регламенту, значение — основы слов для сопоставления записей PRODUCT_ALLERGENS.
var TECH_SPEC_ALLERGENS = {
  'арахис': ['арахис'], 'аспартам': ['аспартам'], 'горчица': ['горчиц'], 'диоксид серы и сульфиты': ['сульфит', 'диоксид серы'],
  'глютен': ['глютен', 'клейковин', 'пшениц', 'рож', 'ячмен', 'овёс', 'овес'], 'кунжут': ['кунжут'], 'люпин': ['люпин'], 'моллюски': ['моллюск'],
  'молоко': ['молок', 'молоч', 'лактоз'], 'орехи': ['орех'], 'ракообразные': ['ракообраз', 'креветк', 'краб'], 'рыба': ['рыб'],
  'сельдерей': ['сельдере'], 'соя': ['соя', 'соев'], 'яйца': ['яйц', 'яичн']
};

// ТР ТС 021/2011 (приложения 1–2) — показатели для кулинарной продукции.
// Численные нормы зависят от группы продукции и заносятся технологом из текста
// регламента (data.microNorms), интерфейс их не придумывает.
var TECH_SPEC_MICRO_INDICATORS = [
  { code: 'KMAFANM', name: 'КМАФАнМ, КОЕ/г, не более', method: 'ГОСТ 10444.15-94' },
  { code: 'BGKP', name: 'БГКП (колиформы), масса продукта (г), в которой не допускаются', method: 'ГОСТ 31747-2012' },
  { code: 'ECOLI', name: 'E. coli, масса продукта (г), в которой не допускаются', method: 'ГОСТ 30726-2001' },
  { code: 'SAUREUS', name: 'S. aureus, масса продукта (г), в которой не допускаются', method: 'ГОСТ 31746-2012' },
  { code: 'PROTEUS', name: 'Бактерии рода Proteus, масса продукта (г), в которой не допускаются', method: 'ГОСТ 28560-90' },
  { code: 'SALMONELLA', name: 'Патогенные, в т.ч. сальмонеллы, масса продукта (г), в которой не допускаются', method: 'ГОСТ 31659-2012' },
  { code: 'LISTERIA', name: 'L. monocytogenes, масса продукта (г), в которой не допускаются', method: 'ГОСТ 32031-2022' },
  { code: 'YEAST_MOLD', name: 'Дрожжи и плесени, КОЕ/г, не более (если нормируются для группы)', method: 'ГОСТ 10444.12-2013' }
];

var TECH_SPEC_NORMATIVE_BASE = [
  { code: 'ГОСТ 31987-2012', title: 'Услуги общественного питания. Технологические документы на продукцию общественного питания. Общие требования к оформлению, построению и содержанию', use: 'Структура ТК/ТТК и ТУ (СТО) предприятия общественного питания' },
  { code: 'ГОСТ Р 51740-2016', title: 'Технические условия на пищевую продукцию. Общие требования к разработке и оформлению', use: 'Состав разделов ТУ' },
  { code: 'ГОСТ Р 1.3-2018', title: 'Стандартизация в Российской Федерации. Технические условия на продукцию. Общие требования к содержанию, оформлению, обозначению и обновлению', use: 'Обозначение ТУ, титульный лист, обновление' },
  { code: 'ГОСТ 30390-2013', title: 'Услуги общественного питания. Продукция общественного питания, реализуемая населению. Общие технические условия', use: 'Общие требования к продукции, приёмка, хранение' },
  { code: 'ГОСТ 31988-2012', title: 'Услуги общественного питания. Метод расчёта отходов и потерь сырья и пищевых продуктов при производстве продукции общественного питания', use: 'Брутто/нетто, отходы, потери' },
  { code: 'ГОСТ 31986-2012', title: 'Услуги общественного питания. Метод органолептической оценки качества продукции общественного питания', use: 'Органолептические показатели, приёмка' },
  { code: 'ТР ТС 021/2011', title: 'О безопасности пищевой продукции', use: 'Микробиологические нормативы, показатели безопасности' },
  { code: 'ТР ТС 022/2011', title: 'Пищевая продукция в части её маркировки', use: 'Энергетические коэффициенты (прил. 4), аллергены, маркировка' },
  { code: 'ТР ТС 029/2012', title: 'Требования безопасности пищевых добавок, ароматизаторов и технологических вспомогательных средств', use: 'Применение пищевых добавок в рецептуре' },
  { code: 'ТР ТС 005/2011', title: 'О безопасности упаковки', use: 'Упаковка продукции, реализуемой вне зала' },
  { code: 'СанПиН 2.3/2.4.3590-20', title: 'Санитарно-эпидемиологические требования к организации общественного питания населения', use: 'Условия и сроки хранения, технологический процесс' },
  { code: 'МУК 4.2.1847-04', title: 'Санитарно-эпидемиологическая оценка обоснования сроков годности и условий хранения пищевых продуктов', use: 'Обоснование срока годности сверх установленного' },
  { code: 'Справочник Скурихина–Тутельяна', title: 'Химический состав российских пищевых продуктов (под ред. И.М. Скурихина, В.А. Тутельяна)', use: 'КБЖУ сырья при отсутствии данных производителя' },
  { code: 'Сборник рецептур', title: 'Сборник рецептур блюд и кулинарных изделий для предприятий общественного питания', use: 'Нормы отходов и потерь, рецептуры-аналоги' }
];

function _tsNum_(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
function _tsHas_(v) { return v !== '' && v !== null && v !== undefined && !isNaN(Number(v)); }
function _tsRound_(n, d) { var p = Math.pow(10, d === undefined ? 1 : d); return Math.round((Number(n) || 0) * p) / p; }

/** Масса в граммах. мл/л приравниваются к г/кг (плотность 1) — с предупреждением; «шт» не переводится. */
function _tsMassG_(qty, unit, warnings, label) {
  var u = String(unit || 'г').toLowerCase().replace('.', '').trim();
  if (u === 'г' || u === 'гр' || u === 'g') return qty;
  if (u === 'кг' || u === 'kg') return qty * 1000;
  if (u === 'мл' || u === 'л') {
    if (warnings) warnings.push('«' + label + '»: объём (' + u + ') пересчитан в массу с плотностью 1,0 — уточните плотность.');
    return u === 'л' ? qty * 1000 : qty;
  }
  if (warnings) warnings.push('«' + label + '»: единица «' + unit + '» не переводится в массу — строка исключена из расчёта КБЖУ.');
  return null;
}

/** Строка рецептуры → масса закладки нетто, г. Нетто пустое → брутто за вычетом потерь. */
function _tsLineNettoG_(line, warnings, label) {
  var netto = _tsNum_(line.нетто);
  if (!(netto > 0)) netto = _tsNum_(line.брутто) * (1 - _tsNum_(line.потери_процент) / 100);
  return _tsMassG_(netto, line.единица, warnings, label);
}

function _tsIsSalt_(name) { return /(^|[^а-яё])соль([^а-яё]|$)/i.test(String(name || '')); }

function _tsAllergenKey_(name) {
  var s = String(name || '').toLowerCase().trim();
  var keys = Object.keys(TECH_SPEC_ALLERGENS);
  for (var i = 0; i < keys.length; i++) {
    if (TECH_SPEC_ALLERGENS[keys[i]].some(function (stem) { return s.indexOf(stem) !== -1; })) return keys[i];
  }
  return s;
}

/** Выход объекта, г: блюдо — DISHES.выход (г на порцию), ПФ — выход × единица. */
function _tsYieldG_(parentType, entity, inputMass, warnings) {
  if (parentType === 'PF') {
    var y = _tsMassG_(_tsNum_(entity.выход), entity.единица || 'кг', warnings, entity.название || entity.pf_id);
    if (y > 0) return y;
  } else if (_tsNum_(entity.выход) > 0) {
    return _tsNum_(entity.выход);
  }
  warnings.push('Выход не задан — для расчёта принята сумма масс нетто (' + _tsRound_(inputMass, 0) + ' г).');
  return inputMass;
}

/**
 * Свернуть рецептуру в сырьевой состав с суммами нутриентов. ПФ раскрываются
 * рекурсивно до сырья (с защитой глубиной и visited), потери при тепловой
 * обработке применяются один раз — на верхнем уровне, чтобы не учесть их дважды.
 */
function _tsAggregate_(parentType, parentId, scale, depth, visited, acc) {
  if (depth > 10) { acc.warnings.push('Глубина вложенности ПФ больше 10 — расчёт остановлен.'); return; }
  var lines = getRecipeLines_(parentType, parentId);
  lines.forEach(function (line) {
    var id = String(line.product_id || '');
    var isPf = id.indexOf('PF-') === 0;
    var ing = isPf ? getSemiFinishedById_(id) : getProductById_(id);
    var name = ing ? (ing.название || id) : id;
    var mass = _tsLineNettoG_(line, acc.warnings, name);
    if (mass === null) { acc.excluded_mass_lines++; return; }
    mass = mass * scale;
    if (depth === 0) acc.input_mass += mass;
    if (isPf) {
      if (!ing) { acc.warnings.push('ПФ не найден: ' + id); return; }
      if (visited[id]) { acc.warnings.push('Циклическая ссылка ПФ: ' + id); return; }
      var pfInput = getRecipeLines_('PF', id).reduce(function (s, l) { var m = _tsLineNettoG_(l, null, ''); return s + (m || 0); }, 0);
      var pfYield = _tsMassG_(_tsNum_(ing.выход), ing.единица || 'кг', null, '') || pfInput;
      if (!(pfYield > 0)) { acc.warnings.push('ПФ «' + name + '» без рецептуры/выхода — исключён из расчёта.'); return; }
      if (pfInput > 0 && pfYield > pfInput * 1.02) acc.warnings.push('ПФ «' + name + '»: выход (' + _tsRound_(pfYield, 0) + ' г) больше закладки нетто (' + _tsRound_(pfInput, 0) + ' г) — в рецептуре не хватает компонента (вода, бульон) или ошибка единиц.');
      visited[id] = true;
      _tsAggregate_('PF', id, mass / pfYield, depth + 1, visited, acc);
      delete visited[id];
      if (depth === 0) acc.lines.push({ name: name, type: 'ПФ', netto_g: mass, source: 'раскрыт по рецептуре ПФ' });
      return;
    }
    var global = ing && ing.global_product_id ? getGlobalProductById_(ing.global_product_id) : null;
    var row = { name: name, type: 'сырьё', netto_g: mass, protein: '', fat: '', carbohydrate: '', verified: false, source: '' };
    acc.raw_mass += mass;
    if (_tsIsSalt_(name)) acc.salt_g += mass;
    if (global && _tsHas_(global.protein_g_100g) && _tsHas_(global.fat_g_100g) && _tsHas_(global.carbohydrate_g_100g)) {
      row.protein = _tsNum_(global.protein_g_100g); row.fat = _tsNum_(global.fat_g_100g); row.carbohydrate = _tsNum_(global.carbohydrate_g_100g);
      row.verified = global.verified === 'да';
      row.source = global.source || '';
      acc.protein += mass * row.protein / 100;
      acc.fat += mass * row.fat / 100;
      acc.carbohydrate += mass * row.carbohydrate / 100;
      acc.covered_mass += mass; acc.data_mass += mass;
      if (row.verified) acc.verified_mass += mass;
      else if (acc.unverified.indexOf(name) === -1) acc.unverified.push(name);
    } else if (_tsIsSalt_(name) || /(^|[^а-яё])вода([^а-яё]|$)/i.test(name)) {
      acc.covered_mass += mass; acc.verified_mass += mass; // соль и вода не содержат Б/Ж/У
    } else if (acc.missing.indexOf(name) === -1) {
      acc.missing.push(name);
    }
    if (global) {
      findRows_('PRODUCT_ALLERGENS', function (a) { return a.product_id === global.global_product_id && a.активен !== 'нет'; }).forEach(function (a) {
        var key = _tsAllergenKey_(a.allergen);
        var cur = acc.allergens[key] || (acc.allergens[key] = { allergen: key, verified: true, sources: [] });
        if (cur.sources.indexOf(name) === -1) cur.sources.push(name);
        if (a.verified !== 'да' && a.verified !== true) cur.verified = false;
      });
    }
    if (depth === 0) acc.lines.push(row);
  });
}

/** Тепловая обработка: явный параметр > этапы ТТК с температурой ≥ 60 °C > по умолчанию без потерь. */
function _tsProcessing_(opts, steps) {
  if (opts.processing === 'raw' || opts.processing === 'thermal') return opts.processing;
  if ((steps || []).some(function (s) { return typeof techStepType_ === 'function' && techStepType_(s) === 'THERMAL'; })) return 'thermal';
  var hot = (steps || []).some(function (s) {
    var m = String(s && s.temperature || '').match(/\d+(?:[.,]\d+)?/g) || [];
    return m.some(function (x) { return Number(x.replace(',', '.')) >= 60; });
  });
  return hot ? 'thermal' : 'raw';
}

function _tsNutritionText_(n) {
  return 'На 100 г: белки ' + n.protein + ' г, жиры ' + n.fat + ' г, углеводы ' + n.carbohydrate + ' г; энергетическая ценность ' + n.energy_kcal + ' ккал / ' + n.energy_kj + ' кДж';
}

/**
 * Главный расчёт: parentType DISH|PF. opts: {processing, ttkSteps, tolerance,
 * microNorms:{CODE:value}, microGroup, storage, shelfLife, okpd2, seq}.
 * Возвращает всё, что нужно для ТТК и документа ТУ, плюс список предупреждений.
 */
function calcTechSpec_(parentType, parentId, session, opts) {
  opts = opts || {};
  if (parentType !== 'DISH' && parentType !== 'PF') throw new Error('calcTechSpec_: parentType должен быть DISH или PF.');
  getRecipeLines_(parentType, parentId, session); // проверка принадлежности организации
  var entity = parentType === 'PF' ? getSemiFinishedById_(parentId) : findOne_('DISHES', 'dish_id', parentId);
  if (!entity) throw new Error('Объект не найден: ' + parentId);

  var ttk = parentType === 'DISH' && typeof _ttkCurrent_ === 'function' ? _ttkCurrent_(parentId) : null;
  var steps = opts.ttkSteps;
  if (!steps && ttk) { try { steps = JSON.parse(ttk.технологические_этапы_json || '[]'); } catch (e) { steps = []; } }

  var acc = { lines: [], input_mass: 0, raw_mass: 0, covered_mass: 0, data_mass: 0, verified_mass: 0, salt_g: 0, protein: 0, fat: 0, carbohydrate: 0, allergens: {}, missing: [], unverified: [], excluded_mass_lines: 0, warnings: [] };
  var visited = {}; if (parentType === 'PF') visited[parentId] = true;
  _tsAggregate_(parentType, parentId, 1, 0, visited, acc);
  if (!acc.lines.length) acc.warnings.push('Рецептура пуста — расчёт невозможен.');

  var processing = _tsProcessing_(opts, steps);
  var loss = TECH_SPEC_LOSSES[processing];
  var yieldG = _tsYieldG_(parentType, entity, acc.input_mass, acc.warnings);
  var k = yieldG > 0 ? 100 / yieldG : 0;
  var per100 = {
    protein: _tsRound_(acc.protein * (1 - loss.protein) * k),
    fat: _tsRound_(acc.fat * (1 - loss.fat) * k),
    carbohydrate: _tsRound_(acc.carbohydrate * (1 - loss.carbohydrate) * k)
  };
  per100.energy_kcal = _tsRound_(per100.protein * TECH_SPEC_ENERGY.protein + per100.fat * TECH_SPEC_ENERGY.fat + per100.carbohydrate * TECH_SPEC_ENERGY.carbohydrate, 0);
  per100.energy_kj = _tsRound_(per100.protein * TECH_SPEC_ENERGY_KJ.protein + per100.fat * TECH_SPEC_ENERGY_KJ.fat + per100.carbohydrate * TECH_SPEC_ENERGY_KJ.carbohydrate, 0);
  var portionG = parentType === 'DISH' ? yieldG : 0;
  var perPortion = portionG ? {
    protein: _tsRound_(per100.protein * portionG / 100), fat: _tsRound_(per100.fat * portionG / 100),
    carbohydrate: _tsRound_(per100.carbohydrate * portionG / 100), energy_kcal: _tsRound_(per100.energy_kcal * portionG / 100, 0),
    energy_kj: _tsRound_(per100.energy_kj * portionG / 100, 0)
  } : null;
  var coverage = acc.raw_mass > 0 ? _tsRound_(acc.covered_mass / acc.raw_mass * 100, 0) : 0;
  var verifiedPct = acc.raw_mass > 0 ? _tsRound_(acc.verified_mass / acc.raw_mass * 100, 0) : 0;
  if (acc.missing.length) acc.warnings.push('Нет КБЖУ в справочнике: ' + acc.missing.join(', ') + ' — пищевая ценность занижена.');
  if (acc.unverified.length) acc.warnings.push('КБЖУ не подтверждено источником (verified≠да): ' + acc.unverified.join(', ') + '.');

  var tol = opts.tolerance === undefined ? TECH_SPEC_DEFAULT_TOLERANCE : Number(opts.tolerance) || 0;
  var saltPct = yieldG > 0 ? _tsRound_(acc.salt_g / yieldG * 100, 2) : 0;
  var physico = [
    { indicator: 'Массовая доля жира, %, не менее', calc: per100.fat, norm: _tsRound_(per100.fat * (1 - tol)), method: 'по методике аккредитованной лаборатории' },
    { indicator: 'Массовая доля белка, %, не менее', calc: per100.protein, norm: _tsRound_(per100.protein * (1 - tol)), method: 'по методике аккредитованной лаборатории' },
    { indicator: 'Массовая доля углеводов, %', calc: per100.carbohydrate, norm: 'справочно', method: 'расчётный' }
  ];
  if (acc.salt_g > 0) physico.push({ indicator: 'Массовая доля хлорида натрия (соли), %, не более', calc: saltPct, norm: _tsRound_(saltPct * (1 + tol), 2), method: 'по методике аккредитованной лаборатории' });

  // Выход и потери при производстве (ГОСТ 31988-2012): закладка нетто → выход.
  var lossPct = acc.input_mass > 0 ? _tsRound_((acc.input_mass - yieldG) / acc.input_mass * 100) : 0;
  if (lossPct < 0) acc.warnings.push('Выход (' + _tsRound_(yieldG, 0) + ' г) больше суммы закладки нетто (' + _tsRound_(acc.input_mass, 0) + ' г) — проверьте выход и единицы рецептуры (ГОСТ 31988-2012).');
  var recipe100kg = acc.lines.map(function (l) {
    return { name: l.name, type: l.type, netto_g: _tsRound_(l.netto_g), per_1kg_g: yieldG > 0 ? _tsRound_(l.netto_g / yieldG * 1000) : 0, per_100kg_kg: yieldG > 0 ? _tsRound_(l.netto_g / yieldG * 100, 2) : 0 };
  });

  var allergens = Object.keys(acc.allergens).map(function (k2) { return acc.allergens[k2]; });
  var storage = { conditions: '', shelf_life: '', source: '' };
  // Заглушка импорта («ТРЕБУЕТ ЗАПОЛНЕНИЯ») — не значение: считаем, что срок не задан.
  ['storage', 'shelfLife'].forEach(function (k) { if (String(opts[k] || '').indexOf('ТРЕБУЕТ ЗАПОЛНЕНИЯ') !== -1) opts[k] = ''; });
  if (opts.storage || opts.shelfLife) { storage.conditions = opts.storage || ''; storage.shelf_life = opts.shelfLife || ''; storage.source = 'ТТК'; }
  else if (parentType === 'PF') { storage.conditions = entity.условия_хранения || ''; storage.shelf_life = entity.срок_хранения_часов ? entity.срок_хранения_часов + ' ч' : ''; storage.source = 'карточка ПФ'; }
  else if (ttk) { storage.conditions = ttk.условия_хранения || ''; storage.shelf_life = ttk.срок_реализации || ''; storage.source = 'утверждённая ТТК'; }
  var pfShelf = acc.lines.filter(function (l) { return l.type === 'ПФ'; }).map(function (l) { return l.name; });
  // Срок годности по нормам (TechNormsCore.gs): самое строгое ограничение из норм групп и сроков ПФ.
  var shelf = typeof calcShelfLife_ === 'function' ? calcShelfLife_(parentType, parentId, session, steps || [], opts.servingMode || (ttk ? ttk.режим_подачи : '')) : null;
  if (shelf) {
    shelf.warnings.forEach(function (w) { acc.warnings.push(w); });
    if (!storage.shelf_life && shelf.hours !== null) { storage.shelf_life = shelf.text; storage.conditions = storage.conditions || shelf.conditions; storage.source = shelf.status === 'ПО_ПРОВЕРЕННЫМ_НОРМАМ' ? 'расчёт по проверенным нормам' : 'расчёт по нормам (предварительно)'; }
    else if (storage.shelf_life && shelf.hours !== null) {
      var m = String(storage.shelf_life).toLowerCase().match(/(\d+(?:[.,]\d+)?)\s*(ч|час|сут|дн|день|дня)/);
      var declared = m ? Number(m[1].replace(',', '.')) * (/^(сут|дн|день|дня)/.test(m[2]) ? 24 : 1) : null;
      if (declared !== null && declared > shelf.hours) acc.warnings.push('Срок в ТТК (' + storage.shelf_life + ') больше нормы (' + shelf.hours + ' ч) — нужен протокол испытаний по МУК 4.2.1847-04.');
    }
  }
  if (!storage.shelf_life) acc.warnings.push('Срок годности не задан — установите по СанПиН 2.3/2.4.3590-20; срок сверх установленного требует обоснования по МУК 4.2.1847-04.');

  var microNorms = opts.microNorms || {};
  var micro = TECH_SPEC_MICRO_INDICATORS.map(function (m) { return { code: m.code, indicator: m.name, norm: microNorms[m.code] || '', method: m.method }; });
  if (!micro.some(function (m) { return m.norm; })) acc.warnings.push('Микробиологические нормативы не заполнены — внесите значения для группы продукции из ТР ТС 021/2011.');

  // Без данных КБЖУ текст не формируется: «белки 0 г» в ТТК выглядел бы как результат расчёта.
  var nutritionText = acc.data_mass === 0 ? '' : _tsNutritionText_(per100) + (perPortion ? '; на порцию ' + portionG + ' г: Б ' + perPortion.protein + ', Ж ' + perPortion.fat + ', У ' + perPortion.carbohydrate + ' г, ' + perPortion.energy_kcal + ' ккал' : '') + ' (расчётно, ТР ТС 022/2011' + (coverage < 100 ? '; неполный расчёт — данные КБЖУ есть для ' + coverage + ' % массы сырья' : '') + ')';
  if (acc.data_mass === 0) nutritionText = '';
  var allergenText = allergens.length ? 'Содержит: ' + allergens.map(function (a) { return a.allergen + (a.verified ? '' : ' (не подтверждено)'); }).join(', ') : 'Аллергены по справочнику сырья не выявлены (проверьте заполнение PRODUCT_ALLERGENS)';

  var shelfOk = !shelf || storage.source === 'ТТК' || storage.source === 'утверждённая ТТК' || storage.source === 'карточка ПФ' || shelf.status === 'ПО_ПРОВЕРЕННЫМ_НОРМАМ';
  var status = (coverage === 100 && verifiedPct === 100 && storage.shelf_life && shelfOk && micro.some(function (m) { return m.norm; })) ? 'ГОТОВ_К_ИСПЫТАНИЯМ' : 'ПРОЕКТ';
  return {
    object: { type: parentType, id: parentId, name: entity.название || parentId, yield_g: _tsRound_(yieldG), portion_g: portionG, input_mass_g: _tsRound_(acc.input_mass), production_loss_pct: lossPct },
    processing: processing, losses: loss,
    nutrition: { per_100g: per100, per_portion: perPortion, coverage_pct: coverage, verified_pct: verifiedPct, energy_factors: TECH_SPEC_ENERGY, method: 'Σ(нетто × нутриент/100) × (1 − потери) / выход × 100; ккал = Б×4 + Ж×9 + У×4' },
    physico_chemical: physico, tolerance: tol,
    recipe: recipe100kg, ingredients: acc.lines,
    allergens: allergens,
    storage: storage, pf_components: pfShelf, shelf_life: shelf,
    microbiology: { group: opts.microGroup || (parentType === 'PF' ? 'Полуфабрикаты кулинарные' : 'Кулинарная продукция'), indicators: micro, reference: 'ТР ТС 021/2011, приложения 1–2' },
    normative_base: TECH_SPEC_NORMATIVE_BASE,
    text: { пищевая_ценность: nutritionText, аллергенная_информация: allergenText },
    status: status,
    warnings: acc.warnings,
    generated_at: nowIso_()
  };
}

/** Без исключений — для автозаполнения ТТК: расчёт не должен ломать сохранение ТТК. */
function calcTechSpecSafe_(parentType, parentId, session, opts) {
  try { return calcTechSpec_(parentType, parentId, session, opts); }
  catch (e) { return { error: String(e.message || e), warnings: [String(e.message || e)] }; }
}

/** Снимок расчёта, сохраняемый в TTK_VERSIONS.tech_spec_snapshot_json. */
function techSpecSnapshotJson_(spec) {
  if (!spec || spec.error) return '';
  return JSON.stringify({ nutrition: spec.nutrition, physico_chemical: spec.physico_chemical, allergens: spec.allergens, processing: spec.processing, object: spec.object, status: spec.status, warnings: spec.warnings, generated_at: spec.generated_at });
}

/** Миграция: колонка снимка расчёта в существующем листе TTK_VERSIONS (только добавляет). */
function migrateTechSpecSchema_() {
  var sheet = getSheet_('TTK_VERSIONS'), expected = CONFIG.SCHEMA.TTK_VERSIONS, changed = [];
  var last = sheet.getLastColumn();
  var headers = last ? sheet.getRange(1, 1, 1, last).getValues()[0] : [];
  expected.forEach(function (h) { if (headers.indexOf(h) === -1) { sheet.getRange(1, headers.length + 1).setValue(h); headers.push(h); changed.push('TTK_VERSIONS.' + h); } });
  if (changed.length) invalidateCache_('TTK_VERSIONS');
  return { ok: true, changed: changed };
}

function getTechSpec_(data, session) {
  var parentType = data.parentType || (data.pfId ? 'PF' : 'DISH');
  var parentId = data.parentId || data.pfId || data.dishId;
  if (!parentId) throw new Error('Укажите dishId или pfId.');
  return calcTechSpec_(parentType, parentId, session, data);
}

function _tsEsc_(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/** Обозначение по ГОСТ Р 1.3-2018: ТУ <ОКПД2>-<рег.№>-<ОКПО>-<год>. */
function _tsDesignation_(org, opts) {
  var okpd2 = opts.okpd2 || '10.85.19';
  var seq = String(opts.seq || '001'); while (seq.length < 3) seq = '0' + seq;
  var okpo = (org && (org.ОКПО || org.okpo)) || opts.okpo || '________';
  return 'ТУ ' + okpd2 + '-' + seq + '-' + okpo + '-' + (opts.year || new Date().getFullYear());
}

/** HTML-документ ТУ по структуре ГОСТ Р 51740-2016. Расчётная часть — из calcTechSpec_. */
function renderTechSpecHtml_(spec, org, opts) {
  opts = opts || {};
  var e = _tsEsc_, o = spec.object, n = spec.nutrition.per_100g;
  var orgName = org ? (org.название || org.name || '') : '';
  var designation = _tsDesignation_(org, opts);
  var tr = function (cells, th) { return '<tr>' + cells.map(function (c) { return (th ? '<th>' : '<td>') + e(c) + (th ? '</th>' : '</td>'); }).join('') + '</tr>'; };
  var recipe = spec.recipe.map(function (r, i) { return tr([i + 1, r.name, r.type, r.netto_g, r.per_1kg_g, r.per_100kg_kg]); }).join('');
  var phys = spec.physico_chemical.map(function (p) { return tr([p.indicator, p.norm, p.calc, p.method]); }).join('');
  var micro = spec.microbiology.indicators.map(function (m) { return tr([m.indicator, m.norm || '— заполнить по ТР ТС 021/2011', m.method]); }).join('');
  var norms = spec.normative_base.map(function (d) { return tr([d.code, d.title]); }).join('');
  var allergens = spec.allergens.length ? spec.allergens.map(function (a) { return a.allergen + ' (' + a.sources.join(', ') + ')' + (a.verified ? '' : ' — не подтверждено'); }).join('; ') : 'не выявлены по справочнику сырья';
  var portion = spec.nutrition.per_portion ? tr(['На порцию ' + o.portion_g + ' г', spec.nutrition.per_portion.protein, spec.nutrition.per_portion.fat, spec.nutrition.per_portion.carbohydrate, spec.nutrition.per_portion.energy_kcal + ' / ' + spec.nutrition.per_portion.energy_kj]) : '';
  var warn = spec.warnings.length ? '<div class="warn"><b>Замечания расчёта (устранить до утверждения ТУ):</b><ul>' + spec.warnings.map(function (w) { return '<li>' + e(w) + '</li>'; }).join('') + '</ul></div>' : '';
  var organoleptic = opts.organoleptic || 'Внешний вид, цвет, консистенция, вкус и запах — по описанию утверждённой ТТК; оценка по ГОСТ 31986-2012.';
  return '<!doctype html><html><head><meta charset="UTF-8"><title>' + e(designation) + '</title><style>@page{size:A4;margin:15mm}body{font-family:Arial,sans-serif;font-size:9.5pt;color:#111;line-height:1.4}h1{font-size:15pt;text-align:center;margin:18px 0 4px}h2{font-size:11pt;margin:14px 0 5px;border-bottom:1px solid #777}table{width:100%;border-collapse:collapse;margin:5px 0 10px}th,td{border:1px solid #888;padding:3px 5px;vertical-align:top}th{background:#f2f2f2}.c{text-align:center}.r{text-align:right}.warn{border:1px solid #c80;background:#fff7e6;padding:6px 10px;margin:10px 0}.stamp{display:inline-block;border:2px solid #a00;color:#a00;padding:2px 8px;font-weight:bold}.small{font-size:8pt;color:#555}</style></head><body>' +
    '<div class="r">УТВЕРЖДАЮ<br>Руководитель ' + e(orgName) + '<br>____________ / ____________<br>«___» __________ ' + new Date().getFullYear() + ' г.</div>' +
    '<h1>' + e(o.name) + '</h1><div class="c">ТЕХНИЧЕСКИЕ УСЛОВИЯ<br><b>' + e(designation) + '</b><br>Дата введения: «___» __________ 20__ г. · <span class="stamp">' + e(spec.status === 'ПРОЕКТ' ? 'ПРОЕКТ' : 'ГОТОВ К ИСПЫТАНИЯМ') + '</span></div>' +
    '<h2>Вводная часть</h2><p>Настоящие технические условия распространяются на ' + (o.type === 'PF' ? 'полуфабрикат' : 'продукцию общественного питания') + ' «' + e(o.name) + '» (далее — продукция), изготавливаемую ' + e(orgName) + ' и предназначенную для реализации ' + (opts.channel ? e(opts.channel) : 'через предприятия общественного питания и вне их') + '. Продукция изготавливается по технологической документации, разработанной в соответствии с ГОСТ 31987-2012.</p><p>Пример записи при заказе: «' + e(o.name) + ' ' + e(designation) + '».</p>' +
    '<h2>1 Технические требования</h2><p>1.1 Продукция должна соответствовать требованиям ТР ТС 021/2011, ТР ТС 022/2011, СанПиН 2.3/2.4.3590-20, ГОСТ 30390-2013 и настоящих ТУ и изготавливаться по рецептуре и технологической инструкции с соблюдением санитарных норм и правил.</p>' +
    '<p>1.2 Рецептура (выход ' + e(o.yield_g) + ' г; закладка нетто ' + e(o.input_mass_g) + ' г; потери при производстве ' + e(o.production_loss_pct) + ' % по ГОСТ 31988-2012).</p><table>' + tr(['№', 'Сырьё', 'Вид', 'Нетто на выход, г', 'На 1 кг, г', 'На 100 кг, кг'], true) + recipe + '</table>' +
    '<p>1.3 Органолептические показатели: ' + e(organoleptic) + '</p>' +
    '<p>1.4 Физико-химические показатели (допуск ' + e(_tsRound_(spec.tolerance * 100, 0)) + ' % от расчётного значения).</p><table>' + tr(['Показатель', 'Норма', 'Расчётное', 'Метод'], true) + phys + '</table>' +
    '<p>1.5 Микробиологические показатели — группа «' + e(spec.microbiology.group) + '», ' + e(spec.microbiology.reference) + '.</p><table>' + tr(['Показатель', 'Норматив', 'Метод'], true) + micro + '</table>' +
    '<p>1.6 Пищевая и энергетическая ценность (расчётно; коэффициенты ТР ТС 022/2011 прил. 4; обработка: ' + (spec.processing === 'thermal' ? 'тепловая, потери Б/Ж/У 6/12/9 %' : 'без тепловой обработки') + '; покрытие данными ' + e(spec.nutrition.coverage_pct) + ' %, подтверждено ' + e(spec.nutrition.verified_pct) + ' %).</p><table>' + tr(['', 'Белки, г', 'Жиры, г', 'Углеводы, г', 'Энерг. ценность, ккал / кДж'], true) + tr(['На 100 г', n.protein, n.fat, n.carbohydrate, n.energy_kcal + ' / ' + n.energy_kj]) + portion + '</table>' +
    '<p>1.7 Аллергены (ТР ТС 022/2011): ' + e(allergens) + '.</p>' +
    '<p>1.8 Требования к сырью: сырьё и пищевые продукты должны сопровождаться документами, подтверждающими их безопасность и прослеживаемость (декларации/сертификаты соответствия, ветеринарные сопроводительные документы), и соответствовать ТР ТС 021/2011 и ТР ТС 029/2012.</p>' +
    '<p>1.9 Упаковка — материалы, соответствующие ТР ТС 005/2011. Маркировка потребительской упаковки — по ТР ТС 022/2011: наименование, состав, количество, дата изготовления, срок годности, условия хранения, пищевая ценность, аллергены, изготовитель, обозначение настоящих ТУ.</p>' +
    '<h2>2 Требования безопасности</h2><p>Содержание потенциально опасных веществ (токсичных элементов, пестицидов, микотоксинов, радионуклидов) и микробиологические показатели — не выше норм ТР ТС 021/2011 для сырья и группы продукции. Производство ведётся в рамках программы производственного контроля на принципах ХАССП.</p>' +
    '<h2>3 Правила приёмки</h2><p>Продукцию принимают партиями. Партия — продукция одного наименования, изготовленная за одну смену. Каждая партия проходит органолептическую оценку (бракераж) по ГОСТ 31986-2012 с записью в журнале. Периодичность контроля физико-химических и микробиологических показателей — по программе производственного контроля.</p>' +
    '<h2>4 Методы контроля</h2><p>Отбор проб — по ГОСТ 31904-2012 (микробиология) и ГОСТ 26668-85/ГОСТ 26669-85; органолептика — ГОСТ 31986-2012; микробиологические показатели — методами, указанными в 1.5; физико-химические — по методикам аккредитованной лаборатории.</p>' +
    '<h2>5 Транспортирование и хранение</h2><p>Условия хранения: ' + e(spec.storage.conditions || '— указать') + '. Срок годности: ' + e(spec.storage.shelf_life || '— указать') + (spec.storage.source ? ' (источник: ' + e(spec.storage.source) + ')' : '') + '. Транспортирование — специализированным транспортом с соблюдением температурного режима по СанПиН 2.3/2.4.3590-20. Срок годности сверх установленного санитарными правилами обосновывается по МУК 4.2.1847-04.</p>' +
    warn +
    '<h2>Приложение А (справочное). Перечень нормативных документов</h2><table>' + tr(['Обозначение', 'Наименование'], true) + norms + '</table>' +
    (opts.ccp && opts.ccp.length ? '<h2>Приложение Б (рекомендуемое). Контрольные точки ХАССП</h2><table>' + tr(['Этап', 'Опасность', 'Тип', 'Параметр', 'Предел', 'Мониторинг', 'Корректирующее действие', 'Норма'], true) + opts.ccp.map(function (c) { var has = function (v) { return v !== '' && v !== null && v !== undefined; }; var lim = has(c.min_value) || has(c.max_value) ? ((has(c.min_value) ? 'не менее ' + c.min_value + ' ' : '') + (has(c.max_value) ? 'не более ' + c.max_value + ' ' : '') + (c.unit || '')).trim() : (c.point_type === 'PRP' ? '—' : '— внести'); return tr([c.step, c.hazard, c.point_type, c.parameter, lim, c.monitoring_method + ', ' + c.frequency, c.corrective_action, c.source_document + ' (' + c.clause + '); ' + (c.norm_status === 'ПРОВЕРЕНО' ? 'проверено' : 'НЕ ПРОВЕРЕНО')]); }).join('') + '</table><p class="small">Предложение системы по этапам ТТК. Вступает в силу только после проверки технологом и включения в утверждённую программу производственного контроля.</p>' : '') +
    '<div class="small">Сформировано автоматически системой «ЦЕХ» по рецептуре и справочнику сырья · ' + e(spec.generated_at) + '. Расчётные показатели подлежат подтверждению протоколом испытаний аккредитованной лаборатории до утверждения ТУ.</div></body></html>';
}

function getTechSpecDocument_(data, session) {
  var spec = getTechSpec_(data, session);
  var org = findOne_('ORGANIZATIONS', 'organization_id', session.organization_id);
  if (spec.object.type === 'DISH' && typeof proposeTtkCcp_ === 'function' && !data.ccp) {
    try { data.ccp = proposeTtkCcp_(spec.object.id, session, data.ttkSteps || [], data.servingMode); } catch (e) { data.ccp = null; }
  }
  var html = renderTechSpecHtml_(spec, org, data);
  var out = { document_type: 'TECH_SPEC_TU', designation: _tsDesignation_(org, data), status: spec.status, warnings: spec.warnings, html: html, generated_at: spec.generated_at };
  try {
    var blob = Utilities.newBlob(html, 'text/html', 'tu.html').getAs(MimeType.PDF).setName('TU_' + spec.object.id + '.pdf');
    out.base64 = Utilities.base64Encode(blob.getBytes()); out.mimeType = 'application/pdf'; out.fileName = blob.getName();
  } catch (e) { out.pdf_error = String(e.message || e); }
  return out;
}

/** Блок расчётных показателей для печатной ТТК (из снимка при утверждении). */
function techSpecTtkSectionHtml_(snapshotJson, esc) {
  var s = null; try { s = snapshotJson ? JSON.parse(snapshotJson) : null; } catch (e) { s = null; }
  if (!s || !s.nutrition) return '';
  var n = s.nutrition.per_100g, p = s.nutrition.per_portion;
  var rows = '<tr><td>На 100 г</td><td>' + esc(n.protein) + '</td><td>' + esc(n.fat) + '</td><td>' + esc(n.carbohydrate) + '</td><td>' + esc(n.energy_kcal) + ' / ' + esc(n.energy_kj) + '</td></tr>' +
    (p ? '<tr><td>На порцию ' + esc(s.object.portion_g) + ' г</td><td>' + esc(p.protein) + '</td><td>' + esc(p.fat) + '</td><td>' + esc(p.carbohydrate) + '</td><td>' + esc(p.energy_kcal) + ' / ' + esc(p.energy_kj) + '</td></tr>' : '');
  var phys = (s.physico_chemical || []).map(function (x) { return '<tr><td>' + esc(x.indicator) + '</td><td>' + esc(x.norm) + '</td><td>' + esc(x.calc) + '</td></tr>'; }).join('');
  return '<h2>7. Расчётные показатели (ТУ)</h2><table><tr><th></th><th>Белки, г</th><th>Жиры, г</th><th>Углеводы, г</th><th>ккал / кДж</th></tr>' + rows + '</table>' +
    '<table><tr><th>Физико-химический показатель</th><th>Норма</th><th>Расчётное</th></tr>' + phys + '</table>' +
    '<div class="small">Расчёт по рецептуре: покрытие данными ' + esc(s.nutrition.coverage_pct) + ' %, подтверждено ' + esc(s.nutrition.verified_pct) + ' %; ' + (s.processing === 'thermal' ? 'тепловая обработка' : 'без тепловой обработки') + '; статус ' + esc(s.status) + '.</div>';
}
