// ЦЕХ — TechNormsCore.gs
// Нормативный контур ТТК: структурные этапы технологии, справочник нормативов
// (TECH_NORMS), расчёт срока годности и предложения ККТ/критических пределов.
//
// Принципы (флагую явно):
//  1. Система ПРЕДЛАГАЕТ, технолог УТВЕРЖДАЕТ. Нормы справочника имеют статус
//     НЕ_ПРОВЕРЕНО, пока технолог не сверит значение и пункт с официальным текстом
//     (VERIFY_TECH_NORM). Срок/предел из непроверенной нормы помечается «предварительно».
//  2. Предложения ККТ живут в TTK_CCP_PROPOSALS и НЕ попадают в действующую ППК:
//     движок решений ХАССП (runHaccpDecisionEngine_) учитывает все контроли текущей
//     ППК независимо от статуса, поэтому непроверенный предел блокировал бы партии.
//     Принятое предложение переносится только в ЧЕРНОВИК ППК и вступает в силу
//     вместе с утверждением новой версии ППК.
//  3. Срок годности сырья в упаковке НЕ определяет срок блюда. Срок блюда — самый
//     строгий из норм групп продукции (по составу и этапам) и сроков ПФ; срок сверх
//     нормы требует протокола по МУК 4.2.1847-04.

var TECH_STEP_TYPES = {
  RECEIVING: 'Приёмка сырья', DEFROST: 'Размораживание', COLD_PREP: 'Холодная обработка/сборка',
  THERMAL: 'Тепловая обработка', COOLING: 'Охлаждение', STORAGE: 'Хранение', SERVING: 'Подача/раздача'
};

// Порядок важен: первое совпадение определяет тип предложения.
var TECH_STEP_KEYWORDS = [
  ['DEFROST', ['разморо', 'дефрост']],
  ['COOLING', ['охлад', 'остуд', 'шоков']],
  ['THERMAL', ['жар', 'запек', 'запеч', 'выпек', 'испеч', 'вар', 'отвар', 'тушит', 'тушен', 'томит', 'потомит', 'пассер', 'пасер', 'бланш', 'припуск', 'гриль', 'фритюр', 'прогре', 'разогре', 'подогре', 'уварить', 'обжар', 'тепловая', 'конфи', 'су-вид', 'сувид', 'кипят', 'кипен', 'копт', 'пароконв', 'духовк', 'карамелиз', 'фламбир']],
  ['STORAGE', ['хранить', 'хранение', 'в холодильник', 'в холодильнике']],
  ['SERVING', ['подава', 'подать', 'при подаче', 'украс', 'оформ', 'сервир', 'выложить', 'отпуск', 'декор', 'на тарелк', 'на блюдо']],
  ['COLD_PREP', ['нарез', 'поруб', 'измельч', 'смеш', 'вмеш', 'формов', 'панир', 'закат', 'очист', 'промы', 'заправ', 'натереть', 'собрать', 'сделать']]
];

// Группы риска сырья — по категории справочника и названию (эвристика, помечается как таковая).
var TECH_RISK_GROUPS = [
  ['POULTRY', 'птица', ['птиц', 'индей', 'куриц', 'курин', 'кура ', 'бройлер', 'утк', 'утин', 'цыпл', 'гус', 'перепел']],
  ['MEAT', 'мясо', ['говя', 'свин', 'баран', 'телят', 'фарш', 'мяс', 'ростбиф', 'вырезк', 'кролик']],
  ['FISH', 'рыба и морепродукты', ['рыб', 'лосос', 'семг', 'сёмг', 'форел', 'сибас', 'дорадо', 'тунец', 'треск', 'креветк', 'краб', 'мидии', 'кальмар', 'икр', 'раков']],
  ['EGG', 'яйца', ['яйц', 'яичн', 'желток', 'белок яич']],
  ['DAIRY', 'молочные', ['сливк', 'молок', 'молоч', 'сыр', 'творог', 'сметан', 'кефир', 'йогурт', 'масло слив', 'маскарпоне', 'фет', 'моцарел', 'пармез']]
];

// Базовое наполнение справочника. Все записи — НЕ_ПРОВЕРЕНО: значения внесены как
// ориентир для сверки, а не как норматив. Там, где ориентира нет, значение пустое —
// система не подставляет число, а требует внести его из официального текста.
var TECH_NORMS_SEED = [
  { kind: 'SHELF_LIFE', code: 'SL_HOT_SERVE', group_name: 'Горячие блюда (вторые блюда, гарниры) на раздаче', parameter: 'температура при раздаче', min_value: 65, unit: '°C', duration: 3, duration_unit: 'h', source_document: 'СанПиН 2.3/2.4.3590-20', clause: 'требования к раздаче горячих блюд — сверить пункт', note: 'Нахождение на мармите/горячей плите с момента изготовления.' },
  { kind: 'SHELF_LIFE', code: 'SL_COLD_SERVE', group_name: 'Холодные блюда и закуски на раздаче', parameter: 'температура при раздаче', max_value: 14, unit: '°C', duration: '', duration_unit: 'h', source_document: 'СанПиН 2.3/2.4.3590-20', clause: 'требования к раздаче холодных блюд — сверить пункт', note: 'Срок реализации внести по группе продукции.' },
  { kind: 'SHELF_LIFE', code: 'SL_CHILLED_MEAT_POULTRY', group_name: 'Кулинарные изделия из мяса и птицы (охлаждённые)', storage_temp_min: 2, storage_temp_max: 6, duration: '', duration_unit: 'h', source_document: 'СанПиН 2.3/2.4.3590-20', clause: 'приложение: сроки годности и условия хранения особо скоропортящихся продуктов — сверить', note: '' },
  { kind: 'SHELF_LIFE', code: 'SL_CHILLED_FISH', group_name: 'Кулинарные изделия из рыбы и морепродуктов (охлаждённые)', storage_temp_min: 2, storage_temp_max: 6, duration: '', duration_unit: 'h', source_document: 'СанПиН 2.3/2.4.3590-20', clause: 'приложение: особо скоропортящиеся продукты — сверить', note: '' },
  { kind: 'SHELF_LIFE', code: 'SL_CHILLED_DAIRY', group_name: 'Блюда и соусы с молочными компонентами, сыры без тепловой обработки', storage_temp_min: 2, storage_temp_max: 6, duration: '', duration_unit: 'h', source_document: 'СанПиН 2.3/2.4.3590-20', clause: 'приложение: особо скоропортящиеся продукты — сверить', note: '' },
  { kind: 'SHELF_LIFE', code: 'SL_CHILLED_EGG', group_name: 'Изделия с яйцом без последующей тепловой обработки', storage_temp_min: 2, storage_temp_max: 6, duration: '', duration_unit: 'h', source_document: 'СанПиН 2.3/2.4.3590-20', clause: 'сверить пункт', note: '' },
  { kind: 'CCP_LIMIT', code: 'CCP_RECEIVING_CHILLED', group_name: 'Приёмка охлаждённого скоропортящегося сырья', parameter: 'температура продукта при приёмке', min_value: 2, max_value: 6, unit: '°C', source_document: 'ТР ТС 021/2011; СанПиН 2.3/2.4.3590-20', clause: 'условия хранения особо скоропортящихся продуктов — сверить; уточнить по маркировке изготовителя', note: 'Дополнительно: документы, маркировка, органолептика.' },
  { kind: 'CCP_LIMIT', code: 'CCP_THERMAL_CORE', group_name: 'Тепловая обработка изделий из мяса, птицы, рыбы, яиц', parameter: 'температура в толще изделия', min_value: '', unit: '°C', source_document: 'СанПиН 2.3/2.4.3590-20', clause: 'требования к тепловой обработке — внести значение из текста', note: 'Значение не подставляется системой: внесите из действующего СанПиН/ППК.' },
  { kind: 'CCP_LIMIT', code: 'CCP_COOLING', group_name: 'Охлаждение после тепловой обработки', parameter: 'температура продукта по окончании охлаждения', max_value: '', unit: '°C', source_document: 'СанПиН 2.3/2.4.3590-20', clause: 'внести значение и время охлаждения из текста', note: '' },
  { kind: 'CCP_LIMIT', code: 'CCP_COLD_ASSEMBLY', group_name: 'Сборка из компонентов без тепловой обработки', parameter: 'температура компонентов', min_value: 2, max_value: 6, unit: '°C', source_document: 'СанПиН 2.3/2.4.3590-20', clause: 'сверить пункт; время нахождения при комнатной температуре внести', note: '' },
  { kind: 'CCP_LIMIT', code: 'CCP_STORAGE_CHILLED', group_name: 'Хранение полуфабрикатов в холодильнике', parameter: 'температура хранения', min_value: 2, max_value: 6, unit: '°C', source_document: 'СанПиН 2.3/2.4.3590-20', clause: 'сверить пункт', note: 'Срок — по карточке ПФ.' },
  { kind: 'CCP_LIMIT', code: 'CCP_HOT_SERVE', group_name: 'Раздача горячих блюд', parameter: 'температура при раздаче', min_value: 65, unit: '°C', source_document: 'СанПиН 2.3/2.4.3590-20', clause: 'требования к раздаче — сверить пункт', note: 'Время на мармите — по норме SL_HOT_SERVE.' },
  { kind: 'CCP_LIMIT', code: 'CCP_COLD_SERVE', group_name: 'Раздача холодных блюд', parameter: 'температура при раздаче', max_value: 14, unit: '°C', source_document: 'СанПиН 2.3/2.4.3590-20', clause: 'требования к раздаче — сверить пункт', note: '' },
  { kind: 'CCP_LIMIT', code: 'CCP_ALLERGEN', group_name: 'Управление аллергенами', parameter: 'раздельное хранение и маркировка аллергенов', unit: '', source_document: 'ТР ТС 022/2011', clause: 'ст. 4 — перечень аллергенов', note: 'Программа предварительных условий (PRP), без числового предела.' }
];

function _tnNum_(v) { return v === '' || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v); }
function _tnHasAny_(s, stems) { s = String(s || '').toLowerCase(); return stems.some(function (x) { return s.indexOf(x) !== -1; }); }

/** Миграция + первичное наполнение справочника (только добавляет отсутствующие коды). */
function seedTechNorms_() {
  var existing = {};
  findRows_('TECH_NORMS', function (r) { return !r.organization_id; }).forEach(function (r) { existing[r.code] = true; });
  var added = [];
  TECH_NORMS_SEED.forEach(function (n) {
    if (existing[n.code]) return;
    insertRow_('TECH_NORMS', {
      norm_id: generateId_('TECH_NORMS'), organization_id: '', kind: n.kind, code: n.code, group_name: n.group_name, parameter: n.parameter || '',
      min_value: n.min_value === undefined ? '' : n.min_value, max_value: n.max_value === undefined ? '' : n.max_value, unit: n.unit || '',
      duration: n.duration === undefined ? '' : n.duration, duration_unit: n.duration_unit || '', storage_temp_min: n.storage_temp_min === undefined ? '' : n.storage_temp_min,
      storage_temp_max: n.storage_temp_max === undefined ? '' : n.storage_temp_max, source_document: n.source_document || '', clause: n.clause || '', note: n.note || '',
      status: 'НЕ_ПРОВЕРЕНО', verified_by: '', verified_at: '', created_at: nowIso_()
    });
    added.push(n.code);
  });
  return { ok: true, added: added };
}

/** Норма по коду: проверенная запись организации важнее базовой. */
function getTechNorm_(code, organizationId) {
  var rows = findRows_('TECH_NORMS', function (r) { return r.code === code && r.status !== 'АРХИВ' && (!r.organization_id || r.organization_id === organizationId); });
  rows.sort(function (a, b) { return (b.organization_id ? 1 : 0) - (a.organization_id ? 1 : 0); });
  return rows[0] || null;
}

/** Справочник для экрана технолога: действующая запись, базовая для сравнения, где используется. */
function getTechNorms_(session) {
  var codes = {}, out = [];
  findRows_('TECH_NORMS', function (r) { return r.status !== 'АРХИВ' && (!r.organization_id || r.organization_id === session.organization_id); }).forEach(function (r) { codes[r.code] = true; });
  var usage = {};
  findRows_('TTK_CCP_PROPOSALS', function (r) { return r.organization_id === session.organization_id && r.status !== 'ЗАМЕНЕНО'; }).forEach(function (r) { usage[r.norm_code] = (usage[r.norm_code] || 0) + 1; });
  Object.keys(codes).sort().forEach(function (c) {
    var n = getTechNorm_(c, session.organization_id), o = {};
    Object.keys(n).forEach(function (k) { if (k !== '__row') o[k] = n[k]; });
    var base = findRows_('TECH_NORMS', function (r) { return r.code === c && !r.organization_id && r.status !== 'АРХИВ'; })[0];
    o.is_org_override = !!n.organization_id;
    o.base = base ? { min_value: base.min_value, max_value: base.max_value, duration: base.duration, storage_temp_min: base.storage_temp_min, storage_temp_max: base.storage_temp_max, clause: base.clause } : null;
    o.usage_count = usage[c] || 0;
    o.missing_value = n.kind === 'CCP_LIMIT' ? (c !== 'CCP_ALLERGEN' && _tnNum_(n.min_value) === null && _tnNum_(n.max_value) === null) : _tnNum_(n.duration) === null;
    out.push(o);
  });
  return out;
}

/** Проверка значений нормы до записи: числа, порядок min/max, срок для групп сроков годности. */
function _tnValidateNorm_(kind, code, v) {
  ['min_value', 'max_value', 'duration', 'storage_temp_min', 'storage_temp_max'].forEach(function (k) {
    if (v[k] !== '' && v[k] !== null && v[k] !== undefined && isNaN(Number(String(v[k]).replace(',', '.')))) throw new Error('Поле ' + k + ': нужно число, получено «' + v[k] + '».');
    if (v[k] !== '' && v[k] !== null && v[k] !== undefined) v[k] = Number(String(v[k]).replace(',', '.'));
  });
  if (_tnNum_(v.min_value) !== null && _tnNum_(v.max_value) !== null && v.min_value > v.max_value) throw new Error('Минимум больше максимума.');
  if (_tnNum_(v.storage_temp_min) !== null && _tnNum_(v.storage_temp_max) !== null && v.storage_temp_min > v.storage_temp_max) throw new Error('Температура хранения: от больше до.');
  if (kind === 'CCP_LIMIT' && code !== 'CCP_ALLERGEN' && _tnNum_(v.min_value) === null && _tnNum_(v.max_value) === null) throw new Error('Для критического предела укажите минимальное и/или максимальное значение.');
  if (kind === 'SHELF_LIFE' && !(_tnNum_(v.duration) > 0)) throw new Error('Для группы сроков годности укажите срок (положительное число).');
  if (kind === 'SHELF_LIFE' && ['h', 'd'].indexOf(v.duration_unit) === -1) throw new Error('Единица срока: h (часы) или d (сутки).');
  if (!v.source_document || !String(v.source_document).trim()) throw new Error('Укажите нормативный документ.');
}

/**
 * Технолог сверил норму с официальным текстом: создаётся (или обновляется) запись
 * организации со статусом ПРОВЕРЕНО. Базовая запись платформы не меняется — её
 * проверка в одной организации не должна становиться нормой для других.
 */
function verifyTechNorm_(data, session) {
  return withLock_(function () {
    var base = getTechNorm_(data.code, session.organization_id);
    if (!base) throw new Error('Норма не найдена: ' + data.code);
    if (!data.clause || !String(data.clause).trim()) throw new Error('Укажите пункт нормативного документа.');
    var fields = ['parameter', 'min_value', 'max_value', 'unit', 'duration', 'duration_unit', 'storage_temp_min', 'storage_temp_max', 'source_document', 'clause', 'note'];
    var patch = {};
    fields.forEach(function (k) { patch[k] = data[k] !== undefined ? data[k] : base[k]; });
    if (!patch.duration_unit) patch.duration_unit = 'h';
    _tnValidateNorm_(base.kind, base.code, patch);
    patch.status = 'ПРОВЕРЕНО'; patch.verified_by = session.user_id; patch.verified_at = nowIso_();
    var row;
    if (base.organization_id === session.organization_id) { updateRow_('TECH_NORMS', base, patch); row = findOne_('TECH_NORMS', 'norm_id', base.norm_id); }
    else {
      row = { norm_id: generateId_('TECH_NORMS'), organization_id: session.organization_id, kind: base.kind, code: base.code, group_name: base.group_name, created_at: nowIso_() };
      Object.keys(patch).forEach(function (k) { row[k] = patch[k]; });
      insertRow_('TECH_NORMS', row);
    }
    // Нерешённые предложения ККТ с этой нормой получают проверенные значения сразу, без пересоздания.
    if (base.kind === 'CCP_LIMIT') findRows_('TTK_CCP_PROPOSALS', function (r) { return r.organization_id === session.organization_id && r.norm_code === base.code && r.status === 'ПРЕДЛОЖЕНО'; }).forEach(function (r) {
      updateRow_('TTK_CCP_PROPOSALS', r, { parameter: patch.parameter, min_value: patch.min_value, max_value: patch.max_value, unit: patch.unit, source_document: patch.source_document, clause: patch.clause, norm_status: 'ПРОВЕРЕНО' });
    });
    auditLog_(session.user_id, 'Норматив проверен технологом', 'TECH_NORMS:' + data.code, base.status, JSON.stringify(patch), 'success', session.cascade_id || '');
    return row;
  });
}

/** Отменить проверку организации: запись архивируется, действует базовая (НЕ_ПРОВЕРЕНО). */
function resetTechNorm_(data, session) {
  return withLock_(function () {
    if (!data.reason) throw new Error('Укажите причину возврата к базовой норме.');
    var row = findRows_('TECH_NORMS', function (r) { return r.code === data.code && r.organization_id === session.organization_id && r.status !== 'АРХИВ'; })[0];
    if (!row) throw new Error('У организации нет своей записи для ' + data.code + '.');
    updateRow_('TECH_NORMS', row, { status: 'АРХИВ', note: String(row.note || '') + ' | возврат к базовой: ' + data.reason });
    var base = getTechNorm_(data.code, session.organization_id);
    findRows_('TTK_CCP_PROPOSALS', function (r) { return r.organization_id === session.organization_id && r.norm_code === data.code && r.status === 'ПРЕДЛОЖЕНО'; }).forEach(function (r) {
      updateRow_('TTK_CCP_PROPOSALS', r, base ? { parameter: base.parameter, min_value: base.min_value, max_value: base.max_value, unit: base.unit, source_document: base.source_document, clause: base.clause, norm_status: base.status } : { norm_status: 'НЕ_ПРОВЕРЕНО' });
    });
    auditLog_(session.user_id, 'Норматив возвращён к базовому', 'TECH_NORMS:' + data.code, 'ПРОВЕРЕНО', data.reason, 'success', session.cascade_id || '');
    return getTechNorm_(data.code, session.organization_id);
  });
}

/** Свободный текст технологии → черновик структурных этапов (тип, t°, время). Технолог правит результат. */
function parseTechnologySteps_(text) {
  var parts = String(text || '').replace(/\s+/g, ' ').split(/[.;!]\s+(?=[А-ЯЁA-Z0-9«"(])|[;!]\s+|\n+/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 2; });
  return parts.map(function (s) {
    var low = s.toLowerCase(), type = 'COLD_PREP';
    for (var i = 0; i < TECH_STEP_KEYWORDS.length; i++) { if (_tnHasAny_(low, TECH_STEP_KEYWORDS[i][1])) { type = TECH_STEP_KEYWORDS[i][0]; break; } }
    var t = low.match(/(\d+(?:[.,]\d+)?)\s*(?:°|градус|º|\*\s*[cс])/) || low.match(/(?:^|[^а-яёa-z])[тt]\s*[-=:]?\s*(\d{2,3})(?!\d)/);
    var tm = low.match(/(\d+(?:[.,]\d+)?)\s*(мин|минут|ч|час)/);
    return { stage: TECH_STEP_TYPES[type], step_type: type, description: s, temperature: t ? t[1].replace(',', '.') : '', time: tm ? tm[1].replace(',', '.') + (/^ч/.test(tm[2]) ? ' ч' : ' мин') : '', core_temperature: '', parsed: true };
  });
}

/** Тип этапа: явный step_type, иначе распознавание по названию и описанию. */
function techStepType_(step) {
  if (step && TECH_STEP_TYPES[step.step_type]) return step.step_type;
  var low = String((step && step.stage) || '') + ' ' + String((step && step.description) || '');
  low = low.toLowerCase();
  for (var i = 0; i < TECH_STEP_KEYWORDS.length; i++) if (_tnHasAny_(low, TECH_STEP_KEYWORDS[i][1])) return TECH_STEP_KEYWORDS[i][0];
  return 'COLD_PREP';
}

/**
 * Режим подачи: явный выбор технолога (HOT/COLD) важнее догадки. Догадка — по категории
 * (холодные закуски/салаты → COLD; горячие, гарниры, супы → HOT), иначе по этапам:
 * последняя тепловая обработка после последнего охлаждения и после неё нет холодной сборки.
 * Пример ошибки без явного режима: «отварить, нарезать, заправить» — это салат, а не горячее.
 */
function guessServingMode_(explicitMode, categoryText, steps) {
  if (explicitMode === 'HOT' || explicitMode === 'COLD') return explicitMode;
  var cat = String(categoryText || '').toLowerCase();
  if (/холодн|салат|десерт/.test(cat)) return 'COLD';
  if (/горяч|гарнир|суп|многопорц/.test(cat)) return 'HOT';
  var types = (steps || []).map(techStepType_);
  var lt = types.lastIndexOf('THERMAL');
  if (lt === -1 || types.lastIndexOf('COOLING') > lt) return 'COLD';
  return types.slice(lt + 1).some(function (t) { return t === 'COLD_PREP'; }) && !types.slice(lt + 1).some(function (t) { return t === 'SERVING'; }) ? 'COLD' : 'HOT';
}

function _tnEntityCategory_(parentType, parentId) {
  var e = parentType === 'PF' ? getSemiFinishedById_(parentId) : findOne_('DISHES', 'dish_id', parentId);
  return e ? (e.категория_id || '') : '';
}

/** Группы риска состава (включая вложенные ПФ). */
function _tnRiskProfile_(parentType, parentId, depth, acc) {
  acc = acc || { groups: {}, pf: [] };
  if (depth > 10) return acc;
  getRecipeLines_(parentType, parentId).forEach(function (l) {
    var id = String(l.product_id || '');
    if (id.indexOf('PF-') === 0) {
      var pf = getSemiFinishedById_(id);
      if (!pf) return;
      if (depth === 0) acc.pf.push(pf);
      _tnRiskProfile_('PF', id, depth + 1, acc);
      return;
    }
    var p = getProductById_(id); if (!p) return;
    var g = p.global_product_id && typeof getGlobalProductById_ === 'function' ? getGlobalProductById_(p.global_product_id) : null;
    var text = [p.название, p.внутреннее_название, g && g.name, g && g.category, g && g.product_type].join(' ');
    TECH_RISK_GROUPS.forEach(function (rg) {
      if (_tnHasAny_(text, rg[2])) (acc.groups[rg[0]] = acc.groups[rg[0]] || []).indexOf(p.название) === -1 && acc.groups[rg[0]].push(p.название);
    });
  });
  return acc;
}

function _tnNormRef_(norm) {
  if (!norm) return null;
  return { code: norm.code, group: norm.group_name, status: norm.status, source_document: norm.source_document, clause: norm.clause, verified: norm.status === 'ПРОВЕРЕНО' };
}

function _tnHours_(norm) {
  var d = _tnNum_(norm && norm.duration); if (d === null) return null;
  return norm.duration_unit === 'd' ? d * 24 : d;
}

/**
 * Срок годности блюда/ПФ: самое строгое ограничение из (а) норм групп продукции,
 * определённых по составу и этапам, (б) сроков хранения вложенных ПФ.
 */
function calcShelfLife_(parentType, parentId, session, steps, servingMode) {
  var org = session && session.organization_id;
  var profile = _tnRiskProfile_(parentType, parentId, 0);
  var types = (steps || []).map(techStepType_);
  var thermalIdx = types.lastIndexOf('THERMAL'), coolingIdx = types.lastIndexOf('COOLING');
  var hasThermal = thermalIdx !== -1;
  var servedHot = parentType === 'DISH' ? guessServingMode_(servingMode, _tnEntityCategory_(parentType, parentId), steps) === 'HOT' : hasThermal && coolingIdx < thermalIdx;
  var codes = [];
  if (parentType === 'DISH') codes.push(servedHot ? 'SL_HOT_SERVE' : 'SL_COLD_SERVE');
  if (!servedHot || parentType === 'PF') {
    if (profile.groups.POULTRY || profile.groups.MEAT) codes.push('SL_CHILLED_MEAT_POULTRY');
    if (profile.groups.FISH) codes.push('SL_CHILLED_FISH');
    if (profile.groups.DAIRY) codes.push('SL_CHILLED_DAIRY');
    if (profile.groups.EGG && !hasThermal) codes.push('SL_CHILLED_EGG');
  }
  var constraints = [], warnings = [];
  codes.forEach(function (c) {
    var n = getTechNorm_(c, org);
    if (!n) { warnings.push('В справочнике нет нормы ' + c + ' — запустите runAllMigrations().'); return; }
    var h = _tnHours_(n);
    constraints.push({ source: 'норма: ' + n.group_name, hours: h, temp_min: _tnNum_(n.storage_temp_min !== '' ? n.storage_temp_min : n.min_value), temp_max: _tnNum_(n.storage_temp_max !== '' ? n.storage_temp_max : n.max_value), parameter: n.parameter || 'температура хранения', norm: _tnNormRef_(n) });
    if (h === null) warnings.push('Норма «' + n.group_name + '»: срок не внесён — заполните по ' + n.source_document + ' (' + n.clause + ').');
    else if (n.status !== 'ПРОВЕРЕНО') warnings.push('Норма «' + n.group_name + '» не проверена технологом — срок предварительный.');
  });
  profile.pf.forEach(function (pf) {
    var h = _tnNum_(pf.срок_хранения_часов);
    if (h !== null) constraints.push({ source: 'срок ПФ «' + pf.название + '»', hours: h, temp_min: null, temp_max: null, parameter: pf.условия_хранения || '', norm: null });
  });
  var withHours = constraints.filter(function (c) { return c.hours !== null; });
  withHours.sort(function (a, b) { return a.hours - b.hours; });
  var limiting = withHours[0] || null;
  var allVerified = constraints.length > 0 && constraints.every(function (c) { return !c.norm || c.norm.verified; }) && constraints.every(function (c) { return c.hours !== null || !c.norm; });
  var hotNorm = constraints.filter(function (c) { return c.norm && c.norm.code === 'SL_HOT_SERVE'; })[0];
  var conditions = servedHot && parentType === 'DISH'
    ? 'Реализация в горячем виде' + (hotNorm && hotNorm.temp_min !== null ? ' при температуре не ниже ' + hotNorm.temp_min + ' °C' : '')
    : 'Хранение при температуре' + (function () { var t = constraints.filter(function (c) { return c.temp_max !== null; }); if (!t.length) return ' — указать'; var mx = Math.min.apply(null, t.map(function (c) { return c.temp_max; })); var mn = Math.max.apply(null, t.map(function (c) { return c.temp_min === null ? -Infinity : c.temp_min; })); return (isFinite(mn) ? ' от +' + mn : '') + ' до +' + mx + ' °C'; })();
  return {
    served_hot: servedHot, risk_groups: profile.groups, group_codes: codes, constraints: constraints,
    limiting: limiting, hours: limiting ? limiting.hours : null, conditions: conditions,
    status: !limiting ? 'НЕ_ОПРЕДЕЛЁН' : (allVerified ? 'ПО_ПРОВЕРЕННЫМ_НОРМАМ' : 'ПРЕДВАРИТЕЛЬНО'),
    text: limiting ? ('не более ' + limiting.hours + ' ч с момента изготовления (' + limiting.source + ')') : '',
    lab_rule: 'Срок сверх нормы устанавливается только по результатам испытаний (МУК 4.2.1847-04).',
    warnings: warnings
  };
}

/** Правила ККТ: этап × состав → опасность, тип точки, параметр, норма. */
function _tnCcpRules_(type, profile, isHotDish, laterThermal) {
  var g = profile.groups, highRisk = !!(g.POULTRY || g.MEAT || g.FISH || g.EGG);
  var out = [];
  if (type === 'THERMAL' && highRisk) out.push({ hazard_type: 'BIO', hazard: 'Выживание патогенных микроорганизмов (сальмонеллы и др.) при недостаточной тепловой обработке ' + Object.keys(g).filter(function (k) { return k !== 'DAIRY'; }).map(function (k) { return k === 'POULTRY' ? 'птицы' : k === 'MEAT' ? 'мяса' : k === 'FISH' ? 'рыбы' : 'яиц'; }).join(', '), point_type: 'ККТ', norm: 'CCP_THERMAL_CORE', method: 'Термощуп в толще изделия', frequency: 'каждая партия', corrective: 'Продолжить тепловую обработку до достижения предела; при невозможности — утилизация' });
  // Дерево решений: если опасность устраняется последующим этапом (дальше есть тепловая обработка) — не ККТ.
  if (type === 'COOLING') out.push({ hazard_type: 'BIO', hazard: 'Рост микрофлоры при медленном охлаждении' + (laterThermal ? ' (устраняется последующей тепловой обработкой)' : ''), point_type: highRisk && !laterThermal ? 'ККТ' : 'КТ', norm: 'CCP_COOLING', method: 'Термощуп + время', frequency: 'каждая партия', corrective: 'Ускорить охлаждение; при превышении времени — утилизация' });
  if (type === 'COLD_PREP' && (g.DAIRY || g.FISH || g.EGG) && !isHotDish && !laterThermal) out.push({ hazard_type: 'BIO', hazard: 'Рост микрофлоры и вторичное загрязнение при сборке из компонентов без тепловой обработки', point_type: 'КТ', norm: 'CCP_COLD_ASSEMBLY', method: 'Контроль температуры компонентов и времени сборки', frequency: 'каждая партия', corrective: 'Вернуть в холодильник; при нарушении времени — утилизация' });
  if (type === 'SERVING') out.push(isHotDish
    ? { hazard_type: 'BIO', hazard: 'Рост микрофлоры при остывании блюда на раздаче', point_type: 'КТ', norm: 'CCP_HOT_SERVE', method: 'Термощуп на раздаче', frequency: 'каждые 2 ч / при отпуске', corrective: 'Подогреть; по истечении срока на раздаче — снять с реализации' }
    : { hazard_type: 'BIO', hazard: 'Рост микрофлоры при нарушении температуры раздачи', point_type: 'КТ', norm: 'CCP_COLD_SERVE', method: 'Термометр витрины', frequency: 'каждые 2 ч', corrective: 'Перенести в холодильную витрину; по истечении срока — снять' });
  if (type === 'STORAGE') out.push({ hazard_type: 'BIO', hazard: 'Рост микрофлоры при нарушении режима хранения', point_type: 'КТ', norm: 'CCP_STORAGE_CHILLED', method: 'Журнал температуры холодильника', frequency: '2 раза в смену', corrective: 'Перенести в исправное оборудование, оценить безопасность' });
  return out;
}

/**
 * Предложения ККТ для блюда: по этапам ТТК + обязательные этапы (приёмка скоропорта,
 * хранение ПФ, аллергены). Ничего не записывает — только расчёт.
 */
function proposeTtkCcp_(dishId, session, steps, servingMode) { return proposeCcp_('DISH', dishId, session, steps, servingMode); }

/**
 * Предложения ККТ для блюда (DISH) или полуфабриката (PF).
 * Для ПФ: нет раздачи, всегда есть хранение самого ПФ; если после тепловой обработки
 * нет охлаждения — предлагается ККТ охлаждения (рост спорообразующих при медленном
 * остывании — типичная опасность варёных ПФ: рис, крупы, соусы, бульоны).
 */
function proposeCcp_(parentType, parentId, session, steps, servingMode) {
  var org = session && session.organization_id;
  var isPf = parentType === 'PF';
  var entity = isPf ? getSemiFinishedById_(parentId) : findOne_('DISHES', 'dish_id', parentId);
  var profile = _tnRiskProfile_(parentType, parentId, 0);
  var types = (steps || []).map(techStepType_);
  var lastThermal = types.lastIndexOf('THERMAL'), lastCooling = types.lastIndexOf('COOLING');
  var isHot = !isPf && guessServingMode_(servingMode, _tnEntityCategory_('DISH', parentId), steps) === 'HOT';
  var raw = [];
  var highRisk = Object.keys(profile.groups).filter(function (k) { return profile.groups[k]; });
  if (highRisk.length) raw.push({ step_no: 0, step_type: 'RECEIVING', step: 'Приёмка сырья', r: { hazard_type: 'BIO', hazard: 'Поступление скоропортящегося сырья с нарушением температуры/сроков (' + highRisk.map(function (k) { return profile.groups[k].join(', '); }).join('; ') + ')', point_type: 'КТ', norm: 'CCP_RECEIVING_CHILLED', method: 'Термометр, проверка документов и маркировки', frequency: 'каждая поставка', corrective: 'Отказ в приёмке/возврат поставщику' } });
  if (profile.pf.length) raw.push({ step_no: 0, step_type: 'STORAGE', step: 'Хранение ПФ: ' + profile.pf.map(function (p) { return p.название; }).join(', '), r: _tnCcpRules_('STORAGE', profile, isHot)[0] });
  var seen = {};
  (steps || []).forEach(function (s, i) {
    var t = types[i];
    if (t === 'THERMAL' && i !== lastThermal) return; // ККТ — на завершающем этапе нагрева, который устраняет опасность
    var laterThermal = types.indexOf('THERMAL', i + 1) !== -1;
    _tnCcpRules_(t, profile, isHot, laterThermal).forEach(function (r) {
      // Приготовленный ПФ, который дальше хранится: охлаждение — ККТ независимо от группы сырья
      // (споры B. cereus/C. perfringens переживают варку и растут при медленном остывании).
      if (isPf && t === 'COOLING' && !laterThermal && lastThermal !== -1 && lastThermal < i) r = { hazard_type: 'BIO', hazard: 'Рост спорообразующих микроорганизмов (B. cereus, C. perfringens) при медленном охлаждении приготовленного ПФ перед хранением', point_type: 'ККТ', norm: r.norm, method: r.method, frequency: r.frequency, corrective: r.corrective };
      var key = t + ':' + r.norm; if (seen[key]) return; seen[key] = true; // одна точка на тип этапа: несколько «жарить/запекать» подряд — один контроль
      raw.push({ step_no: i + 1, step_type: t, step: s.stage || TECH_STEP_TYPES[t], step_text: s.description || '', temperature: s.temperature || '', r: r });
    });
  });
  if (isHot && !seen['SERVING:CCP_HOT_SERVE']) raw.push({ step_no: (steps || []).length + 1, step_type: 'SERVING', step: 'Раздача (не описана в ТТК)', r: _tnCcpRules_('SERVING', profile, true)[0] });
  if (isPf) {
    if (lastThermal !== -1 && lastCooling < lastThermal) raw.push({ step_no: lastThermal + 1.5, step_type: 'COOLING', step: 'Охлаждение после тепловой обработки (не описано в карте ПФ)', r: { hazard_type: 'BIO', hazard: 'Рост спорообразующих микроорганизмов (B. cereus, C. perfringens) при медленном охлаждении приготовленного ПФ перед хранением', point_type: 'ККТ', norm: 'CCP_COOLING', method: 'Термощуп + время от окончания нагрева', frequency: 'каждая партия', corrective: 'Ускорить охлаждение (шоковое охлаждение, мелкая тара); при превышении времени — утилизация' } });
    var storeRule = _tnCcpRules_('STORAGE', profile, false)[0];
    raw.push({ step_no: (steps || []).length + 1, step_type: 'STORAGE', step: 'Хранение ПФ «' + (entity ? entity.название : parentId) + '»' + (entity && entity.срок_хранения_часов ? ', не более ' + entity.срок_хранения_часов + ' ч' : ''), r: { hazard_type: storeRule.hazard_type, hazard: storeRule.hazard, point_type: 'КТ', norm: 'CCP_STORAGE_CHILLED', method: 'Журнал температуры холодильника, маркировка ПФ датой и временем изготовления', frequency: storeRule.frequency, corrective: 'Перенести в исправное оборудование; ПФ с истёкшим сроком или без маркировки — утилизировать' } });
  }
  var allergens = [];
  try { var spec = calcTechSpecSafe_(parentType, parentId, session, { ttkSteps: steps }); allergens = (spec.allergens || []).map(function (a) { return a.allergen; }); } catch (e) {}
  if (allergens.length) raw.push({ step_no: 0, step_type: 'STORAGE', step: 'Аллергены: ' + allergens.join(', '), r: { hazard_type: 'ALLERGEN', hazard: 'Перекрёстный контакт и неинформирование потребителя об аллергенах', point_type: 'PRP', norm: 'CCP_ALLERGEN', method: 'Раздельное хранение, маркировка, информирование гостя', frequency: 'постоянно', corrective: 'Изолировать продукт, проинформировать, переоформить маркировку' } });
  return raw.map(function (x) {
    var n = getTechNorm_(x.r.norm, org);
    var stepTemp = _tnNum_(x.temperature);
    return {
      step_no: x.step_no, step_type: x.step_type, step: x.step, step_text: x.step_text || '',
      hazard_type: x.r.hazard_type, hazard: x.r.hazard, point_type: x.r.point_type,
      control_name: (TECH_STEP_TYPES[x.step_type] || x.step) + ': ' + (n ? n.parameter : x.r.norm),
      parameter: n ? n.parameter : '', min_value: n ? n.min_value : '', max_value: n ? n.max_value : '', unit: n ? n.unit : '',
      norm_code: x.r.norm, norm_status: n ? n.status : 'НЕТ_НОРМЫ', source_document: n ? n.source_document : '', clause: n ? n.clause : '',
      monitoring_method: x.r.method, frequency: x.r.frequency, corrective_action: x.r.corrective,
      ttk_value_note: stepTemp !== null ? 'В ТТК указано ' + stepTemp + ' °C — это температура оборудования, не продукта.' : '',
      needs: n && n.status === 'ПРОВЕРЕНО' ? '' : (x.r.point_type === 'PRP' ? 'сверить с документом' : (n && (_tnNum_(n.min_value) !== null || _tnNum_(n.max_value) !== null) ? 'сверить предел с текстом документа' : 'внести значение предела'))
    };
  });
}

/**
 * Сохранить предложения для карты (ТТК блюда: field ttk_version_id; техкарта ПФ: pf_tech_id).
 * Нерешённые заменяются, принятые/отклонённые не трогаются и не предлагаются повторно.
 */
function _tnSaveProposals_(field, cardId, parentType, parentId, list, session) {
  var existing = findRows_('TTK_CCP_PROPOSALS', function (r) { return r[field] === cardId; });
  var decided = {};
  existing.forEach(function (r) { if (r.status === 'ПРЕДЛОЖЕНО') updateRow_('TTK_CCP_PROPOSALS', r, { status: 'ЗАМЕНЕНО' }); else decided[r.step_type + ':' + r.norm_code] = true; });
  var rows = list.filter(function (p) { return !decided[p.step_type + ':' + p.norm_code]; }).map(function (p) {
    var row = { proposal_id: generateId_('TTK_CCP_PROPOSALS'), organization_id: session.organization_id, dish_id: parentId, ttk_version_id: field === 'ttk_version_id' ? cardId : '', pf_tech_id: field === 'pf_tech_id' ? cardId : '', parent_type: parentType, status: 'ПРЕДЛОЖЕНО', decided_by: '', decided_at: '', ppk_id: '', ppk_control_id: '', ppk_limit_id: '', created_at: nowIso_() };
    ['step_no', 'step_type', 'step', 'hazard_type', 'hazard', 'point_type', 'control_name', 'parameter', 'min_value', 'max_value', 'unit', 'norm_code', 'norm_status', 'source_document', 'clause', 'monitoring_method', 'frequency', 'corrective_action'].forEach(function (k) { row[k] = p[k] === undefined || p[k] === null ? '' : p[k]; });
    insertRow_('TTK_CCP_PROPOSALS', row);
    return row;
  });
  auditLog_(session.user_id, 'Сформированы предложения ККТ', parentType + ':' + parentId + ' ' + field + ':' + cardId, '', String(rows.length), 'success', session.cascade_id || '');
  return { created: rows, proposals: findRows_('TTK_CCP_PROPOSALS', function (r) { return r[field] === cardId && r.status !== 'ЗАМЕНЕНО'; }) };
}

/** Сохранить предложения для версии ТТК блюда. */
function generateTtkCcpProposals_(data, session) {
  return withLock_(function () {
    var ttk = findOne_('TTK_VERSIONS', 'ttk_version_id', data.ttkVersionId); assertOwnedByOrg_(session, ttk, 'TTK_VERSIONS:' + data.ttkVersionId);
    var steps = []; try { steps = JSON.parse(ttk.технологические_этапы_json || '[]'); } catch (e) { steps = []; }
    if (!steps.length && ttk.технология) steps = parseTechnologySteps_(ttk.технология);
    return _tnSaveProposals_('ttk_version_id', ttk.ttk_version_id, 'DISH', ttk.dish_id, proposeCcp_('DISH', ttk.dish_id, session, steps, ttk.режим_подачи), session);
  });
}

function getTtkCcpProposals_(data, session) {
  var ttk = findOne_('TTK_VERSIONS', 'ttk_version_id', data.ttkVersionId); assertOwnedByOrg_(session, ttk, 'TTK_VERSIONS:' + data.ttkVersionId);
  return findRows_('TTK_CCP_PROPOSALS', function (r) { return r.ttk_version_id === ttk.ttk_version_id && r.status !== 'ЗАМЕНЕНО'; });
}

/**
 * Решение технолога. Принятие требует числового предела (кроме PRP) и источника.
 * Если у организации есть черновик ППК — контроль и предел создаются в нём
 * (status DRAFT, source TTK_PROPOSAL); в действующую ППК ничего не пишется.
 */
function decideTtkCcpProposal_(data, session) {
  return withLock_(function () {
    var p = findOne_('TTK_CCP_PROPOSALS', 'proposal_id', data.proposalId); assertOwnedByOrg_(session, p, 'TTK_CCP_PROPOSALS:' + data.proposalId);
    if (p.status !== 'ПРЕДЛОЖЕНО') throw new Error('Предложение уже рассмотрено: ' + p.status);
    if (data.decision === 'ОТКЛОНЕНО') {
      if (!data.reason) throw new Error('Укажите причину отклонения.');
      updateRow_('TTK_CCP_PROPOSALS', p, { status: 'ОТКЛОНЕНО', decided_by: session.user_id, decided_at: nowIso_(), corrective_action: p.corrective_action + ' | отклонено: ' + data.reason });
      return findOne_('TTK_CCP_PROPOSALS', 'proposal_id', p.proposal_id);
    }
    if (data.decision !== 'ПРИНЯТО') throw new Error('decision: ПРИНЯТО или ОТКЛОНЕНО.');
    var patch = data.patch || {}, upd = {};
    ['point_type', 'parameter', 'min_value', 'max_value', 'unit', 'source_document', 'clause', 'monitoring_method', 'frequency', 'corrective_action'].forEach(function (k) { if (patch[k] !== undefined) upd[k] = patch[k]; });
    var merged = {}; Object.keys(p).forEach(function (k) { merged[k] = p[k]; }); Object.keys(upd).forEach(function (k) { merged[k] = upd[k]; });
    ['min_value', 'max_value'].forEach(function (k) {
      if (merged[k] === '' || merged[k] === null || merged[k] === undefined) { merged[k] = ''; if (upd[k] !== undefined) upd[k] = ''; return; }
      var n = Number(String(merged[k]).replace(',', '.'));
      if (isNaN(n)) throw new Error((k === 'min_value' ? 'Минимум' : 'Максимум') + ': нужно число, получено «' + merged[k] + '».');
      merged[k] = n; if (upd[k] !== undefined) upd[k] = n;
    });
    if (merged.min_value !== '' && merged.max_value !== '' && merged.min_value > merged.max_value) throw new Error('Минимум больше максимума.');
    if (PPK_POINT_TYPES.indexOf(merged.point_type) === -1) throw new Error('Недопустимый тип контрольной точки.');
    if (merged.point_type !== 'PRP' && _tnNum_(merged.min_value) === null && _tnNum_(merged.max_value) === null) throw new Error('Нельзя принять ' + merged.point_type + ' без числового предела: внесите значение из нормативного документа.');
    if (!merged.source_document || !merged.clause) throw new Error('Укажите нормативный документ и пункт.');
    var draft = findRows_('PPK_VERSIONS', function (r) { return r.organization_id === session.organization_id && r.status === 'DRAFT'; })[0] || null;
    upd.status = 'ПРИНЯТО'; upd.decided_by = session.user_id; upd.decided_at = nowIso_();
    if (draft) {
      var ids = _tnMaterializeCcp_(p, merged, draft, session, data.responsibleRole);
      upd.ppk_id = draft.ppk_id; upd.ppk_control_id = ids.control_id; upd.ppk_limit_id = ids.limit_id;
    } else if (typeof detectAndRequestPpkReview_ === 'function') {
      detectAndRequestPpkReview_(session.organization_id, session.location_id, 'RECIPE_CHANGED', 'TTK_CCP_PROPOSALS', p.proposal_id, session.user_id, session, 'Принята ККТ из ТТК: ' + merged.control_name + '. Создайте черновик ППК для переноса.');
    }
    updateRow_('TTK_CCP_PROPOSALS', p, upd);
    auditLog_(session.user_id, 'Принято предложение ККТ', 'TTK_CCP_PROPOSALS:' + p.proposal_id, 'ПРЕДЛОЖЕНО', JSON.stringify(upd), 'success', session.cascade_id || '');
    return findOne_('TTK_CCP_PROPOSALS', 'proposal_id', p.proposal_id);
  });
}

/** Принятая точка → контроль (+ предел) в черновике ППК. В действующую ППК не пишет. */
function _tnMaterializeCcp_(p, merged, draft, session, role) {
  var c = _ppkCtx_(session, session.location_id);
  // Решение технолога в ТТК (числовой предел + пункт документа) — это и есть подтверждение
  // человеком: точка и предел попадают в черновик ППК подтверждёнными, иначе шлюз
  // готовности ППК (buildPpkReadinessGate_) не даст его утвердить. product_id = блюдо/ПФ:
  // движок ХАССП применяет контроль только к этому продукту, а не ко всему сырью.
  var decidedBy = p.decided_by || session.user_id;
  var control = { control_id: _ppkId_('PPK_CONTROLS'), ppk_id: draft.ppk_id, organization_id: session.organization_id, location_id: c.locationId, process_id: '', stage_id: '', product_id: p.dish_id, hazard_id: '', point_type: merged.point_type, control_name: merged.control_name, purpose: (p.parent_type === 'PF' ? 'Из техкарты ПФ ' : 'Из ТТК ') + p.dish_id + ', этап ' + merged.step, risk_description: merged.hazard, critical_limit_ref: '', monitoring_parameter: merged.parameter, monitoring_method: merged.monitoring_method, frequency: merged.frequency, responsible_role: role || 'ШЕФ-ПОВАР', journal_definition_id: '', corrective_action: merged.corrective_action, verification_method: 'Проверка записей журнала технологом', status: 'CONFIRMED', human_confirmed: true, confirmed_by: decidedBy, confirmed_at: p.decided_at || nowIso_(), source: 'TTK_PROPOSAL:' + p.proposal_id, created_at: nowIso_() };
  insertRow_('PPK_CONTROLS', control);
  var limitId = '';
  if (merged.point_type !== 'PRP') {
    var limit = { limit_id: _ppkId_('PPK_CRITICAL_LIMITS'), ppk_id: draft.ppk_id, organization_id: session.organization_id, location_id: c.locationId, control_id: control.control_id, parameter: merged.parameter, min_value: merged.min_value, max_value: merged.max_value, unit: merged.unit, applicable_stage: merged.step, applicable_product: p.dish_id, source: 'TTK_PROPOSAL', source_document: merged.source_document + ', ' + merged.clause, effective_date: todayDateStr_(), version: 1, approved_by: decidedBy, status: 'CONFIRMED', created_at: nowIso_() };
    insertRow_('PPK_CRITICAL_LIMITS', limit);
    updateRow_('PPK_CONTROLS', findOne_('PPK_CONTROLS', 'control_id', control.control_id), { critical_limit_ref: limit.limit_id });
    limitId = limit.limit_id;
  }
  return { control_id: control.control_id, limit_id: limitId };
}

/** Карта, к которой относится предложение, не в архиве (ККТ архивной ТТК/техкарты в новую ППК не переносится). */
function _tnProposalCardActive_(p) {
  if (p.pf_tech_id) { var c = findOne_('PF_TECH_CARDS', 'pf_tech_id', p.pf_tech_id); return !!c && c.status !== 'архив'; }
  if (p.ttk_version_id) { var t = findOne_('TTK_VERSIONS', 'ttk_version_id', p.ttk_version_id); return !!t && t.status !== 'архив'; }
  return true;
}

/**
 * Перенос принятых точек в текущий черновик ППК. Новая версия ППК не копирует контроли
 * предыдущей, поэтому переносятся и точки, уже перенесённые в прошлые версии, — если
 * их карта не в архиве и в этом черновике их ещё нет.
 */
function transferTtkCcpToPpk_(data, session) {
  return withLock_(function () {
    var draft = findRows_('PPK_VERSIONS', function (r) { return r.organization_id === session.organization_id && r.status === 'DRAFT'; })[0];
    if (!draft) throw new Error('Нет черновика ППК: создайте новую версию ППК.');
    var inDraft = {};
    findRows_('PPK_CONTROLS', function (c) { return c.ppk_id === draft.ppk_id; }).forEach(function (c) { inDraft[String(c.source || '')] = true; });
    var rows = findRows_('TTK_CCP_PROPOSALS', function (r) { return r.organization_id === session.organization_id && r.status === 'ПРИНЯТО' && !inDraft['TTK_PROPOSAL:' + r.proposal_id] && _tnProposalCardActive_(r) && (!data.ttkVersionId || r.ttk_version_id === data.ttkVersionId); });
    rows.forEach(function (p) {
      var ids = _tnMaterializeCcp_(p, p, draft, session, data.responsibleRole);
      updateRow_('TTK_CCP_PROPOSALS', p, { ppk_id: draft.ppk_id, ppk_control_id: ids.control_id, ppk_limit_id: ids.limit_id });
    });
    auditLog_(session.user_id, 'Перенос ККТ из ТТК в черновик ППК', 'PPK_VERSIONS:' + draft.ppk_id, '', String(rows.length), 'success', session.cascade_id || '');
    return { ppk_id: draft.ppk_id, transferred: rows.length };
  });
}

/** Контекст нормативного контура для редактора ТТК (расчёт без записи). */
function getTtkNormsContext_(data, session) {
  var dishId = data.dishId; if (!dishId) throw new Error('Укажите dishId.');
  getRecipeLines_('DISH', dishId, session);
  var steps = Array.isArray(data.ttkSteps) ? data.ttkSteps : [];
  if (!steps.length && data.technology) steps = parseTechnologySteps_(data.technology);
  return { steps: steps.map(function (s) { var t = techStepType_(s); var o = {}; Object.keys(s).forEach(function (k) { o[k] = s[k]; }); o.step_type = t; return o; }), step_types: TECH_STEP_TYPES, shelf_life: calcShelfLife_('DISH', dishId, session, steps, data.servingMode), ccp: proposeTtkCcp_(dishId, session, steps, data.servingMode), serving_mode: guessServingMode_(data.servingMode, _tnEntityCategory_('DISH', dishId), steps) };
}

function migrateTechNormsSchema_() {
  var changed = [];
  ['TECH_NORMS', 'TTK_CCP_PROPOSALS'].forEach(function (key) {
    var sheet = getSheet_(key), expected = CONFIG.SCHEMA[key];
    var last = sheet.getLastColumn();
    var headers = last ? sheet.getRange(1, 1, 1, last).getValues()[0] : [];
    expected.forEach(function (h) { if (headers.indexOf(h) === -1) { sheet.getRange(1, headers.length + 1).setValue(h); headers.push(h); changed.push(key + '.' + h); } });
  });
  return { ok: true, changed: changed, seed: seedTechNorms_() };
}
