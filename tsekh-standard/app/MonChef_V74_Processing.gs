// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
/**
 * ЦЕХ Стандарт V74 — карточка продукта: виды обработки сырья, пищевая ценность, состав; наполнение с этикеток.
 *
 * 1) Справочник видов обработки продукта (лист «Продукты_Обработка»), как в программах для технологов:
 *    обработка (например «Очистка, варка»), потери массы при холодной, тепловой и окончательной обработке, %,
 *    потери белков, жиров и углеводов, %, «по умолчанию», источник. В «Новой карточке ТТК» у каждого ингредиента
 *    выбирается обработка — нетто и выход считаются: нетто = брутто × (1 − холодная %), выход = нетто × (1 − тепловая %) ×
 *    (1 − окончательная %). Выбор сохраняется (лист «ТТК_Обработка»), КБЖУ блюда считается с учётом потерь.
 *    Если для продукта есть только норма разбора («Нормы_Разбора»), она предлагается как холодная обработка.
 *    Проценты система не придумывает: их вносит технолог (или источник, который он указал).
 * 2) Пищевая ценность, состав, аллергены и производитель продукта — в справочнике «Справочник_Пищевая_Ценность»
 *    (колонки дописаны справа). Кнопка «Распознать этикетку» заполняет форму из фото (Yandex Vision), человек проверяет
 *    и сохраняет. При приёмке по этикетке база пополняется сама: только если у продукта ещё нет данных или прежние
 *    тоже взяты с этикетки; значения, внесённые вручную, не перезаписываются.
 */
var MC_V74_PROC = ['Продукты_Обработка', ['Продукт', 'Обработка', 'Холодная, %', 'Тепловая, %', 'Окончательная, %', 'Потери белков, %', 'Потери жиров, %', 'Потери углеводов, %', 'По умолчанию', 'Источник', 'Обновлено']];
var MC_V74_LINES = ['ТТК_Обработка', ['Код', 'Строка', 'Ингредиент', 'Обработка', 'Брутто, г', 'Холодная, %', 'Тепловая, %', 'Окончательная, %', 'Нетто, г', 'Выход, г', 'Потери белков, %', 'Потери жиров, %', 'Потери углеводов, %', 'Создано']];
var MC_V74_NUT_EXT = ['Состав', 'Аллергены', 'Производитель', 'Источник', 'Обновлено', 'Комментарий'];
var MC_V74_PCT = ['cold', 'thermal', 'final', 'lossP', 'lossF', 'lossC'];

function _v74Key_(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim(); }
function _v74Pct_(x) { if (x === '' || x === null || x === undefined) return 0; var n = parseFloat(String(x).replace(',', '.')); return isFinite(n) ? n : NaN; }
function _v74Round_(x) { return Math.round(x * 100) / 100; }
function _v74Sheet_(def) { return _v64Sheet_(def[0], def[1]); }
function _v74Rows_(def) { var sh = _book_().getSheetByName(def[0]); if (!sh || sh.getLastRow() < 2) return []; return sh.getDataRange().getValues().slice(1).map(function (r, i) { r._row = i + 2; return r; }).filter(function (r) { return r[0] !== ''; }); }
/** Лист КБЖУ с дописанными колонками; возвращает индексы колонок по названию. */
function _v74NutSheet_() {
  var sh = _nutritionSheet_(), lc = Math.max(5, sh.getLastColumn()), h = sh.getRange(1, 1, 1, lc).getValues()[0].map(function (x) { return String(x || '').trim(); });
  while (h.length > 5 && !h[h.length - 1]) h.pop();
  var add = MC_V74_NUT_EXT.filter(function (c) { return h.indexOf(c) < 0; });
  if (add.length) { sh.getRange(1, h.length + 1, 1, add.length).setValues([add]); h = h.concat(add); }
  var ix = {}; h.forEach(function (c, i) { ix[c] = i; }); return { sh: sh, h: h, ix: ix };
}
function _v74NutRow_(N, name) {
  var v = N.sh.getDataRange().getValues(), k = _v74Key_(name);
  for (var i = 1; i < v.length; i++) if (_v74Key_(v[i][0]) === k) return { row: i + 1, v: v[i] };
  return null;
}
function _v74Proc_(r) { return { product: String(r[0]), name: String(r[1]), cold: Number(r[2]) || 0, thermal: Number(r[3]) || 0, final: Number(r[4]) || 0, lossP: Number(r[5]) || 0, lossF: Number(r[6]) || 0, lossC: Number(r[7]) || 0,
  isDefault: r[8] === true || /^(да|true|1)$/i.test(String(r[8])), source: String(r[9] || '') }; }
/** Виды обработки продукта; если своих нет — норма разбора как холодная обработка. */
function _v74ProcFor_(name, all) {
  var k = _v74Key_(name), kc = ''; try { kc = _v74Key_(_cleanProdName_(name)); } catch (e) {}
  var own = (all || _v74Rows_(MC_V74_PROC)).filter(function (r) { var p = _v74Key_(r[0]); return p === k || (kc && p === kc); }).map(_v74Proc_);
  if (own.length) return own;
  try { var wn = JSON.parse(getWasteNorm(name) || 'null'); if (wn && wn.maxWastePercent > 0) return [{ product: wn.name, name: 'Холодная обработка (норма разбора)', cold: wn.maxWastePercent, thermal: 0, final: 0, lossP: 0, lossF: 0, lossC: 0, isDefault: true, source: 'Нормы разбора: «' + wn.name + '»', fromWasteNorm: true }]; } catch (e) {}
  return [];
}
/** Нетто и выход строки по обработке. qtyBase — брутто в г/мл. */
function _v74Calc_(qtyBase, p) {
  var b = Number(qtyBase) || 0, netto = b * (1 - (Number(p.cold) || 0) / 100), out = netto * (1 - (Number(p.thermal) || 0) / 100) * (1 - (Number(p.final) || 0) / 100);
  return { netto: _v74Round_(netto), out: _v74Round_(out) };
}
function _v74CheckProc_(p) {
  var bad = [];
  MC_V74_PCT.forEach(function (k) { var v = _v74Pct_(p[k]); if (isNaN(v) || v < 0 || v >= 100) bad.push(k); });
  return bad;
}

/* ---------------- для формы ТТК ---------------- */
/** Виды обработки для списка ингредиентов: { имя: [обработки] }. */
function v74ProcessingFor(namesJson, token) {
  try { _requireAuth_(token, 'catalog|ttk_edit');
    var names = typeof namesJson === 'string' ? JSON.parse(namesJson || '[]') : (namesJson || []), all = _v74Rows_(MC_V74_PROC), out = {};
    [].concat(names).slice(0, 200).forEach(function (n) { n = String(n || '').trim(); if (n) out[n] = _v74ProcFor_(n, all); });
    return _ok_(out);
  } catch (e) { return _failFrom_(e); }
}
/** Добавить продукту один вид обработки прямо из формы ТТК (остальные обработки продукта не меняются). json: {product, proc:{name, cold, thermal, final, lossP, lossF, lossC, isDefault}} */
function v74AddProcessing(json, token) {
  var op = null; try { op = _beginOp_(token, 'catalog|ttk_edit', 'V74_PROC_ADD', 'Продукт', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), product = String(d.product || '').trim(), p = d.proc || {}, pname = String(p.name || '').trim();
    if (!product || !pname) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите продукт и название обработки', op.id); }
    if (_v74CheckProc_(p).length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Проценты потерь — числа от 0 до 99,9', op.id); }
    return _withLock_(function () {
      var sh = _v74Sheet_(MC_V74_PROC), v = sh.getDataRange().getValues(), k = _v74Key_(product), w = MC_V74_PROC[1].length, now = new Date(), src = 'вручную: ' + _v65Who_(op).name, hit = 0;
      var line = [product, pname, _v74Pct_(p.cold), _v74Pct_(p.thermal), _v74Pct_(p.final), _v74Pct_(p.lossP), _v74Pct_(p.lossF), _v74Pct_(p.lossC), !!p.isDefault, src, now];
      for (var i = 1; i < v.length; i++) {
        if (_v74Key_(v[i][0]) !== k) continue;
        if (p.isDefault && v[i][8] === true) sh.getRange(i + 1, 9).setValue(false);
        if (_v74Key_(v[i][1]) === _v74Key_(pname)) { line[0] = v[i][0]; sh.getRange(i + 1, 1, 1, w).setValues([line]); hit = i + 1; }
      }
      if (!hit) sh.appendRow(line);
      _audit_(op, 'V74_PROC_ADD', 'Продукт', product, null, { обработка: pname, холодная: line[2], тепловая: line[3], окончательная: line[4], обновлено: !!hit });
      _endOp_(op);
      return _ok_({ product: product, processing: _v74ProcFor_(product) }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Сохранить обработки строк созданной карты (вызывается из createDish). lines: [{name, qtyBase, proc}] */
function _v74SaveDishLines_(code, lines) {
  var sh = _v74Sheet_(MC_V74_LINES), now = new Date(), v = sh.getDataRange().getValues(), keep = [v[0]];
  for (var i = 1; i < v.length; i++) if (v[i][0] !== '' && String(v[i][0]) !== String(code)) keep.push(v[i]);
  lines.forEach(function (l, i) { if (!l.proc) return; var c = _v74Calc_(l.qtyBase, l.proc);
    keep.push([code, i + 1, l.name, l.proc.name || '', l.qtyBase, Number(l.proc.cold) || 0, Number(l.proc.thermal) || 0, Number(l.proc.final) || 0, c.netto, c.out, Number(l.proc.lossP) || 0, Number(l.proc.lossF) || 0, Number(l.proc.lossC) || 0, now]); });
  var w = MC_V74_LINES[1].length; if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, w).clearContent();
  if (keep.length > 1) sh.getRange(1, 1, keep.length, w).setValues(keep);
}
/** Потери пищевых веществ по строкам карты: { ключ продукта: {k (нетто/брутто), lossP, lossF, lossC} }. */
function _v74DishLosses_(code) {
  var m = {}; try { _v74Rows_(MC_V74_LINES).forEach(function (r) { if (String(r[0]) !== String(code)) return; var b = Number(r[4]) || 0;
    var key = _v74Key_(_cleanProdName_(r[2])); m[key] = { k: b > 0 ? (Number(r[8]) || 0) / b : 1, lossP: Number(r[10]) || 0, lossF: Number(r[11]) || 0, lossC: Number(r[12]) || 0, proc: String(r[3]) }; }); } catch (e) {}
  return m;
}

/* ---------------- карточка продукта ---------------- */
function v74ProductCard(name, token) {
  try { _requireAuth_(token, 'catalog|ttk_edit|stock');
    name = String(name || '').trim(); if (!name) return _fail_('VALIDATION', 'Укажите продукт');
    var N = _v74NutSheet_(), r = _v74NutRow_(N, name), g = function (c) { return r && N.ix[c] !== undefined ? r.v[N.ix[c]] : ''; };
    var wn = null; try { wn = JSON.parse(getWasteNorm(name) || 'null'); } catch (e) {}
    return _ok_({ name: r ? String(r.v[0]) : name, exists: !!r, kcal: r ? r.v[1] : '', protein: r ? r.v[2] : '', fat: r ? r.v[3] : '', carbs: r ? r.v[4] : '',
      composition: g('Состав'), allergens: g('Аллергены'), manufacturer: g('Производитель'), source: g('Источник'), comment: g('Комментарий'),
      updated: g('Обновлено') ? Utilities.formatDate(new Date(g('Обновлено')), _mcTz_(), 'dd.MM.yyyy') : '',
      processing: _v74Rows_(MC_V74_PROC).filter(function (x) { return _v74Key_(x[0]) === _v74Key_(name); }).map(_v74Proc_), wasteNorm: wn && wn.maxWastePercent ? wn : null });
  } catch (e) { return _failFrom_(e); }
}
/** Записать КБЖУ и описание продукта. force=false — не трогать данные, внесённые вручную (для автонаполнения). */
function _v74WriteProduct_(d, source, force) {
  var N = _v74NutSheet_(), name = String(d.name || '').trim(), r = _v74NutRow_(N, name), w = N.h.length;
  var prevSrc = r && N.ix['Источник'] !== undefined ? String(r.v[N.ix['Источник']] || '') : '';
  if (r && !force && !/^этикетка/i.test(prevSrc)) return { written: false, reason: 'есть данные, внесённые вручную' + (prevSrc ? ' (' + prevSrc + ')' : '') };
  var line = r ? r.v.slice(0, w) : []; while (line.length < w) line.push('');
  line[0] = r ? r.v[0] : name;
  var nums = ['kcal', 'protein', 'fat', 'carbs'], hasNut = nums.every(function (k) { return d[k] !== '' && d[k] !== null && d[k] !== undefined && isFinite(parseFloat(String(d[k]).replace(',', '.'))); });
  if (hasNut) nums.forEach(function (k, i) { line[i + 1] = parseFloat(String(d[k]).replace(',', '.')); });
  else if (!r) nums.forEach(function (k, i) { line[i + 1] = ''; });
  var set = function (c, v) { if (N.ix[c] !== undefined && v !== undefined) line[N.ix[c]] = v; };
  set('Состав', d.composition); set('Аллергены', d.allergens); set('Производитель', d.manufacturer); set('Комментарий', d.comment);
  set('Источник', source); set('Обновлено', new Date());
  if (r) N.sh.getRange(r.row, 1, 1, w).setValues([line]); else N.sh.appendRow(line);
  try { if (typeof _dropCatalogCache_ === 'function') _dropCatalogCache_(); } catch (e) {}
  return { written: true, nutrition: hasNut, created: !r };
}
/** Сохранить карточку продукта: КБЖУ (все четыре или ни одного), состав, аллергены, производитель, виды обработки. */
function v74SaveProduct(json, token) {
  var op = null; try { op = _beginOp_(token, 'catalog', 'V74_PRODUCT', 'Продукт', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), name = String(d.name || '').trim(); if (!name) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите продукт', op.id); }
    var nums = ['kcal', 'protein', 'fat', 'carbs'], filled = nums.filter(function (k) { return String(d[k] === undefined ? '' : d[k]).trim() !== ''; });
    if (filled.length && filled.length < 4) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Пищевая ценность: заполните ккал, белки, жиры и углеводы на 100 г (или оставьте все пустыми)', op.id); }
    if (filled.some(function (k) { var v = parseFloat(String(d[k]).replace(',', '.')); return !isFinite(v) || v < 0; })) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Пищевая ценность — числа не меньше нуля', op.id); }
    var procs = [].concat(d.processing || []).filter(function (p) { return p && String(p.name || '').trim(); });
    for (var i = 0; i < procs.length; i++) { var bad = _v74CheckProc_(procs[i]); if (bad.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Обработка «' + procs[i].name + '»: проценты от 0 до 99,9', op.id); } }
    if (procs.filter(function (p) { return p.isDefault; }).length > 1) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'По умолчанию — только одна обработка', op.id); }
    return _withLock_(function () {
      var src = String(d.source || '').trim() || 'вручную: ' + _v65Who_(op).name;
      var res = _v74WriteProduct_(d, src, true);
      var sh = _v74Sheet_(MC_V74_PROC), v = sh.getDataRange().getValues(), keep = [v[0]], k = _v74Key_(name), now = new Date(), w = MC_V74_PROC[1].length;
      for (var j = 1; j < v.length; j++) if (v[j][0] !== '' && _v74Key_(v[j][0]) !== k) keep.push(v[j].slice(0, w));
      procs.forEach(function (p) { keep.push([name, String(p.name).trim(), _v74Pct_(p.cold), _v74Pct_(p.thermal), _v74Pct_(p.final), _v74Pct_(p.lossP), _v74Pct_(p.lossF), _v74Pct_(p.lossC), !!p.isDefault, String(p.source || '').trim() || src, now]); });
      if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, w).clearContent();
      sh.getRange(1, 1, keep.length, w).setValues(keep);
      _audit_(op, 'V74_PRODUCT', 'Продукт', name, null, { nutrition: res.nutrition, processing: procs.length, source: src }); _endOp_(op);
      return _ok_({ name: name, nutrition: res.nutrition, processing: procs.length }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Список продуктов справочника (КБЖУ, есть ли обработки и состав). */
function v74ProductList(token) {
  try { _requireAuth_(token, 'catalog|ttk_edit|stock');
    var N = _v74NutSheet_(), v = N.sh.getDataRange().getValues(), pc = {};
    _v74Rows_(MC_V74_PROC).forEach(function (r) { var k = _v74Key_(r[0]); pc[k] = (pc[k] || 0) + 1; });
    var items = v.slice(1).filter(function (r) { return String(r[0] || '').trim(); }).map(function (r) { var g = function (c) { return N.ix[c] !== undefined ? r[N.ix[c]] : ''; };
      return { name: String(r[0]), kcal: r[1], protein: r[2], fat: r[3], carbs: r[4], processing: pc[_v74Key_(r[0])] || 0, composition: g('Состав') ? 'да' : '', source: String(g('Источник') || '') }; });
    Object.keys(pc).forEach(function (k) { if (!items.some(function (x) { return _v74Key_(x.name) === k; })) { var r = _v74Rows_(MC_V74_PROC).filter(function (x) { return _v74Key_(x[0]) === k; })[0]; items.push({ name: String(r[0]), kcal: '', protein: '', fat: '', carbs: '', processing: pc[k], composition: '', source: '' }); } });
    items.sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); });
    return _ok_({ items: items });
  } catch (e) { return _failFrom_(e); }
}

/* ---------------- этикетка → карточка продукта ---------------- */
function _v74FromLabel_(p) {
  var num = function (x) { return x === null || x === undefined || x === '' ? '' : x; };
  return { name: p.matched_product ? p.matched_product.name : (p.name || ''), labelName: p.name || '', candidates: p.name_candidates || [], kcal: num(p.calories_kcal_100g), protein: num(p.protein_g_100g), fat: num(p.fat_g_100g), carbs: num(p.carbohydrate_g_100g),
    composition: p.composition || '', allergens: p.allergens || '', manufacturer: p.manufacturer || '', rawText: String(p.raw_text || '').slice(0, 3000) };
}
/** Распознать этикетку для карточки продукта: возвращает черновик, ничего не сохраняет. */
function v74LabelToProduct(dataUrl, token) {
  var op = null; try { op = _beginOp_(token, 'catalog|stock', 'V74_LABEL', 'Продукт', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var vis = _yandexVisionRecognize_(dataUrl);
    if (vis.error) { _endOp_(op, 'FAILED'); return _fail_('OCR', vis.error === 'no-key' ? 'Распознавание не настроено: нужны ключи Yandex Cloud (YANDEX_API_KEY, YANDEX_FOLDER_ID)' : 'Этикетка не распознана (' + vis.error + '): сфотографируйте ближе и ровнее', op.id); }
    var lines = _visionBlockLines_(vis.ann); if (!lines.length) lines = String(vis.fullText || '').split('\n');
    var p = _parseLabelText_(lines.join('\n')), best = null;
    try { (p.name_candidates.length ? p.name_candidates : [p.name]).slice(0, 6).forEach(function (c) { var r = _matchNomenclature_(c, 3); if (r.matched && (!best || r.matched.confidence > best.confidence)) best = r.matched; }); } catch (e) {}
    p.matched_product = best && best.confidence >= 0.6 ? best : null;
    var out = _v74FromLabel_(p), miss = ['kcal', 'protein', 'fat', 'carbs'].filter(function (k) { return out[k] === ''; });
    out.warnings = (miss.length ? ['не найдено на этикетке: ' + miss.map(function (k) { return { kcal: 'ккал', protein: 'белки', fat: 'жиры', carbs: 'углеводы' }[k]; }).join(', ')] : []).concat(p.warnings || []);
    _audit_(op, 'V74_LABEL', 'Продукт', out.name, null, { label: out.labelName, nutrition: !miss.length }); _endOp_(op);
    return _ok_(out, op.id);
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Автонаполнение при приёмке: этикетка распознана и продукт найден в номенклатуре уверенно. */
function _v74LearnFromLabel_(p, labelId) {
  try {
    if (!p || !p.matched_product || !(Number(p.matched_product.confidence) >= 0.8)) return null;
    var d = _v74FromLabel_(p), has = ['kcal', 'protein', 'fat', 'carbs'].every(function (k) { return d[k] !== ''; });
    if (!has && !d.composition) return null;
    if (!has) { delete d.kcal; delete d.protein; delete d.fat; delete d.carbs; }
    return _v74WriteProduct_(d, 'этикетка ' + (labelId || '') + (d.labelName ? ' «' + String(d.labelName).slice(0, 60) + '»' : ''), false);
  } catch (e) { try { _log_('WARN', 'V74 автонаполнение с этикетки: ' + e.message); } catch (x) {} return null; }
}
