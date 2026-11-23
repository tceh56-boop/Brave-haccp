/**
 * MON CHEF V73 — КБЖУ с источником и статусом (нормативный аудит 16.11.2026, ДОК_12, разделы 6–7).
 *
 * Каждое значение КБЖУ — запись с источником: способ получения, источник, таблица / код, страница, кто внёс,
 * кто и когда проверил, статус. Порядок доверия к способу получения:
 *   1 лабораторный протокол продукта или партии; 2 спецификация производителя; 3 маркировка производителя;
 *   4 официальная техническая документация; 5 справочные таблицы; 6 расчёт по рецептуре; 7 неподтверждённое значение.
 * Статусы: DRAFT (черновик) → REVIEW (на проверке) → APPROVED (утверждено); REJECTED; SUPERSEDED (заменено новым утверждённым).
 * В расчёт КБЖУ блюда, в карточку и на этикетку идут ТОЛЬКО утверждённые значения. Пустое значение — «нет данных», не ноль.
 * Неподтверждённое значение (способ 7) — только черновик, утвердить его нельзя.
 * Утверждает ответственный за ХАССП или тот, у кого право утверждать ТТК, и не автор записи.
 *
 * Справочник: Скурихин И. М., Тутельян В. А. (ред.) «Химический состав российских пищевых продуктов», 2002 —
 * значения на 100 г съедобной части, извлечены из DjVu по координатам; взяты только строки, у которых энергия книги
 * совпала с расчётом по её же методике (белки 4,0; жиры 9,0; углеводы 4,0 ккал/г — табл. А книги). Справочное значение —
 * не подтверждение состава конкретного продукта производителя: в записи это написано, утверждает человек.
 */
var MC_V73 = { SHEET: 'КБЖУ_Значения_V73' };
var MC_V73_HEAD_ = ['RecordID', 'Ключ', 'Продукт', 'На', 'Ккал', 'Белки', 'Жиры', 'Углеводы', 'Пищевые волокна', 'Сахара', 'Соль',
  'Способ', 'Источник', 'Таблица / код', 'Страница', 'Статус', 'Проверка энергии', 'Внёс', 'ID внёсшего', 'Внесено', 'Проверил',
  'Проверено', 'Комментарий', 'OperationID'];
var MC_V73_C_ = {}; MC_V73_HEAD_.forEach(function (h, i) { MC_V73_C_[h] = i; });
var MC_V73_METHODS_ = {
  LAB: [1, 'Лабораторный протокол продукта или партии'], SPEC: [2, 'Спецификация производителя'], LABEL: [3, 'Маркировка производителя'],
  TECHDOC: [4, 'Официальная техническая документация'], REFERENCE: [5, 'Справочные таблицы'], RECIPE: [6, 'Расчёт по рецептуре'],
  UNCONFIRMED: [7, 'Неподтверждённое значение']
};
var MC_V73_STATUS_RU_ = { DRAFT: 'черновик', REVIEW: 'на проверке', APPROVED: 'утверждено', REJECTED: 'отклонено', SUPERSEDED: 'заменено' };
var MC_V73_BOOK_ = 'Скурихин И. М., Тутельян В. А. (ред.). Химический состав российских пищевых продуктов: справочник. — М.: ДеЛи принт, 2002';
var MC_V73_BOOK_NOTE_ = 'справочное значение на 100 г съедобной части — не подтверждение состава конкретного продукта производителя';

function _v73Sheet_() { return _bcSheet_(MC_V73.SHEET, MC_V73_HEAD_); }
function _v73Key_(s) { return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/[«»"“”]/g, '').replace(/\s+/g, ' ').trim(); }
function _v73Num_(x) {
  if (x === null || x === undefined) return null;
  var s = String(x).replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  var n = Number(s); return isNaN(n) ? NaN : n;
}
function _v73Now_() { return Utilities.formatDate(new Date(), _mcTz_(), 'dd.MM.yyyy HH:mm'); }
function _v73Rows_() {
  var sh = _book_().getSheetByName(MC_V73.SHEET); if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) {
    if (!v[i][0]) continue;
    var o = { row: i + 1 }; MC_V73_HEAD_.forEach(function (h, j) { o[h] = v[i][j]; }); out.push(o);
  }
  return out;
}
function _v73Obj_(r) {
  var n = function (k) { var x = r[k]; return x === '' || x === null || x === undefined ? null : Number(x); };
  var m = MC_V73_METHODS_[r['Способ']] || [0, String(r['Способ'] || '')];
  return { id: String(r.RecordID), key: String(r['Ключ']), name: String(r['Продукт']), per: String(r['На'] || '100 г'),
    kcal: n('Ккал'), protein: n('Белки'), fat: n('Жиры'), carbs: n('Углеводы'), fiber: n('Пищевые волокна'), sugars: n('Сахара'), salt: n('Соль'),
    method: String(r['Способ']), methodRu: m[1], trust: m[0], source: String(r['Источник'] || ''), table: String(r['Таблица / код'] || ''), page: String(r['Страница'] || ''),
    status: String(r['Статус']), statusRu: MC_V73_STATUS_RU_[r['Статус']] || String(r['Статус']), energy: String(r['Проверка энергии'] || ''),
    by: String(r['Внёс'] || ''), at: String(r['Внесено'] || ''), checkedBy: String(r['Проверил'] || ''), checkedAt: String(r['Проверено'] || ''),
    comment: String(r['Комментарий'] || '') };
}

/** Проверка энергии: 4/9/4 (как в табл. А справочника). Если не сходится — пробует «углеводы вместе с пищевыми волокнами». */
function _v73Energy_(d) {
  if ([d.kcal, d.protein, d.fat, d.carbs].some(function (x) { return x === null || isNaN(x); })) return 'нет данных для проверки';
  var calc = 4 * d.protein + 9 * d.fat + 4 * d.carbs, diff = d.kcal - calc, big = Math.max(d.kcal, calc);
  var txt = function (c) { return Math.round(c * 10) / 10; };
  if (Math.abs(diff) <= Math.max(8, 0.05 * big)) return 'сходится (4/9/4 = ' + txt(calc) + ' ккал)';
  if (d.acids > 0) {   // органические кислоты — 3 ккал/г (табл. А справочника ИП РАМН, «для смеси кислот»)
    var ca = calc + 3 * d.acids;
    if (Math.abs(d.kcal - ca) <= Math.max(8, 0.05 * Math.max(d.kcal, ca))) return 'сходится с учётом органических кислот ' + d.acids + ' г (' + txt(ca) + ' ккал)';
  }
  if (d.fiber !== null && !isNaN(d.fiber) && d.fiber > 0 && d.fiber <= d.carbs) {
    var c2 = 4 * d.protein + 9 * d.fat + 4 * (d.carbs - d.fiber) + 2 * d.fiber;
    if (Math.abs(d.kcal - c2) <= Math.max(8, 0.05 * Math.max(d.kcal, c2))) return 'сходится, если углеводы указаны вместе с пищевыми волокнами (' + txt(c2) + ' ккал) — уточните методику источника';
  }
  if (Math.abs(diff) <= Math.max(20, 0.15 * big)) return 'небольшое расхождение: 4/9/4 = ' + txt(calc) + ' ккал';
  return 'НЕ СХОДИТСЯ: 4/9/4 = ' + txt(calc) + ' ккал, указано ' + d.kcal + ' (алкоголь, сахарозаменители, органические кислоты — или ошибка)';
}

function _v73Clean_(d) {
  d = d || {};
  var o = { name: String(d.name || '').trim(), per: String(d.per || '100 г'), method: String(d.method || 'UNCONFIRMED').toUpperCase(),
    source: String(d.source || '').trim(), table: String(d.table || '').trim(), page: String(d.page || '').trim(), comment: String(d.comment || '').trim() };
  ['kcal', 'protein', 'fat', 'carbs', 'fiber', 'sugars', 'salt'].forEach(function (k) { o[k] = _v73Num_(d[k]); });
  o.acids = _v73Num_(d.acids); if (o.acids === null || isNaN(o.acids) || o.acids < 0) o.acids = null;   // только для проверки энергии
  var e = [];
  if (!o.name) e.push('продукт');
  if (['100 г', '100 мл'].indexOf(o.per) < 0) e.push('«на»: 100 г или 100 мл');
  if (!MC_V73_METHODS_[o.method]) e.push('способ получения');
  ['kcal', 'protein', 'fat', 'carbs'].forEach(function (k) { if (o[k] === null || isNaN(o[k]) || o[k] < 0) e.push({ kcal: 'ккал', protein: 'белки', fat: 'жиры', carbs: 'углеводы' }[k] + ' — число не меньше 0'); });
  ['fiber', 'sugars', 'salt'].forEach(function (k) { if (o[k] !== null && (isNaN(o[k]) || o[k] < 0)) e.push({ fiber: 'пищевые волокна', sugars: 'сахара', salt: 'соль' }[k] + ' — число не меньше 0 или пусто'); });
  if (!e.length) {
    if (o.protein > 100 || o.fat > 100 || o.carbs > 100) e.push('белки, жиры, углеводы — не больше 100 г на 100 г');
    if (o.protein + o.fat + o.carbs > 100.5) e.push('белки + жиры + углеводы больше 100 г на 100 г');
    if (o.sugars !== null && o.sugars > o.carbs + 0.5) e.push('сахара больше углеводов');
    if (o.kcal > 900) e.push('энергия больше 900 ккал на 100 г');
  }
  if (o.method !== 'UNCONFIRMED' && !o.source) e.push('источник (документ, протокол, справочник)');
  if (o.method === 'REFERENCE' && (!o.table || !o.page)) e.push('для справочника — таблица / код и страница');
  if (e.length) throw new Error('VALIDATION: ' + e.join('; '));
  return o;
}

function _v73Append_(o, status, op) {
  var a = _author_(op);
  var id = 'KB-' + Utilities.formatDate(new Date(), _mcTz_(), 'yyyyMMdd') + '-' + Utilities.getUuid().slice(0, 8).toUpperCase();
  var energy = _v73Energy_(o);
  _v73Sheet_().appendRow([id, _v73Key_(o.name), o.name, o.per, o.kcal, o.protein, o.fat, o.carbs,
    o.fiber === null ? '' : o.fiber, o.sugars === null ? '' : o.sugars, o.salt === null ? '' : o.salt,
    o.method, o.source, o.table, o.page, status, energy, a.фио, a.id, _v73Now_(), '', '', o.comment, op ? op.id : '']);
  _v73Cache_ = null;
  return { id: id, status: status, energy: energy };
}

var _v73Cache_ = null;
/** Утверждённые значения: ключ → запись (последняя утверждённая). */
function _v73Approved_() {
  if (_v73Cache_) return _v73Cache_;
  var m = {};
  _v73Rows_().forEach(function (r) { if (String(r['Статус']) === 'APPROVED') m[String(r['Ключ'])] = _v73Obj_(r); });
  _v73Cache_ = m; return m;
}
/** Значение для ингредиента: по названию, затем по сопоставлению с базой продуктов (ТТК_Сопоставление). Только утверждённое. */
function _v73Lookup_(name) {
  var ap = _v73Approved_(), k = _v73Key_(name);
  if (ap[k]) return ap[k];
  try {
    var mp = typeof _loadTtkMatchMap_ === 'function' ? _loadTtkMatchMap_() : {};
    var rec = mp[String(name || '').trim().toLowerCase()];
    if (rec && rec.matchedName && ap[_v73Key_(rec.matchedName)]) return ap[_v73Key_(rec.matchedName)];
  } catch (e) {}
  return null;
}

// --- расчёт КБЖУ блюда: только утверждённые значения ---
_findNutrition_ = function (name) {
  var r = _v73Lookup_(name);
  return r ? { name: r.name, kcal: r.kcal, protein: r.protein, fat: r.fat, carbs: r.carbs, source: r.methodRu + ': ' + r.source } : null;
};
(function () {
  var orig = calculateKBZHU;
  calculateKBZHU = function (code) {
    var j = orig.apply(this, arguments), k = null;
    try { k = JSON.parse(j); } catch (e) { return j; }
    if (!k || k.error) return j;
    k.approvedOnly = true;
    (k.perIngredient || []).forEach(function (x) {
      var r = _v73Lookup_(x.name);
      x.status = r ? 'утверждено' : 'нет утверждённого значения';
      if (r) { x.method = r.methodRu; x.source = r.source + (r.table ? ', ' + r.table : '') + (r.page ? ', с. ' + r.page : ''); }
    });
    k.missing = (k.perIngredient || []).filter(function (x) { return x.kcal === null; }).map(function (x) { return x.name; });
    k.complete = !k.hasMissingData;
    return JSON.stringify(k);
  };
})();
// старый справочник: чтение — утверждённые значения, запись — запись V73 (черновик или на проверку)
getNutritionData = function () {
  try {
    var ap = _v73Approved_(), out = {};
    Object.keys(ap).forEach(function (k) { var r = ap[k]; out[k] = { name: r.name, kcal: r.kcal, protein: r.protein, fat: r.fat, carbs: r.carbs }; });
    return JSON.stringify(out);
  } catch (e) { return JSON.stringify({}); }
};
setNutritionItem = function (json, token) {
  var op = null;
  try { op = _beginOp_(token, 'ttk_edit', 'NUTRITION_SET', 'КБЖУ', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = JSON.parse(json || '{}'); if (!d.method) d.method = 'UNCONFIRMED';
    var o = _v73Clean_(d);
    return _withLock_(function () {
      var r = _v73Append_(o, o.method === 'UNCONFIRMED' ? 'DRAFT' : 'REVIEW', op);
      _audit_(op, 'NUTRITION_SET', 'КБЖУ', r.id, null, { name: o.name, status: r.status, method: o.method });
      _endOp_(op);
      return _ok_({ name: o.name, id: r.id, status: r.status, note: 'Значение записано как «' + MC_V73_STATUS_RU_[r.status] + '». В расчёт идёт только после утверждения.' }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return /VALIDATION/.test(String(e)) ? _fail_('VALIDATION', String(e.message || e).replace(/^VALIDATION:\s*/, ''), op && op.id) : _failFrom_(e, op && op.id); }
};
// этикетка (прежний путь печати): без полного утверждённого КБЖУ — без КБЖУ, а не нули
(function () {
  var orig = getLabelData;
  getLabelData = function (code, manufacturingDateISO, shelfLifeHours, responsible) {   // те же 4 параметра: шлюз ищет токен по числу параметров
    var j = orig.apply(this, arguments), l = null;
    try { l = JSON.parse(j); } catch (e) { return j; }
    if (l && !l.error && l.hasMissingNutrition) { l.kbzhu = null; l.kbzhuPerPortion = null; l.nutritionNote = 'КБЖУ не указано: не все продукты имеют утверждённые значения'; }
    if (l && !l.error && !(l.shelfLifeHours > 0)) { l.expiryDate = ''; l.shelfLifeHours = null; l.shelfNote = 'СРОК РЕАЛИЗАЦИИ НЕ УКАЗАН'; }
    return JSON.stringify(l);
  };
})();

// --- справочник ИП РАМН 2002 ---
function _v73Book_() { return typeof MC_V73_REF_ !== 'undefined' ? MC_V73_REF_ : []; }
function _v73BookRow_(r) {
  return { code: r[0], table: r[1], page: r[2], group: r[3], name: r[4], protein: r[5], fat: r[6], carbs: r[7], fiber: r[8], sugars: r[9],
    starch: r[10], acids: r[11], water: r[12], kcal: r[13] };
}
function _v73Words_(s) { return _v73Key_(s).replace(/[^a-zа-я0-9 ]+/g, ' ').split(' ').filter(function (w) { return w.length > 2; }).map(function (w) { return w.slice(0, 5); }); }
function _v73BookFind_(q, limit) {
  var ws = _v73Words_(q); if (!ws.length) return [];
  var out = [];
  _v73Book_().forEach(function (r) {
    var nw = _v73Words_(r[4]), gw = _v73Words_(r[3]), score = 0;
    ws.forEach(function (w) { if (nw.indexOf(w) >= 0) score += 2; else if (gw.indexOf(w) >= 0) score += 1; });
    if (score > 0) out.push({ s: score - nw.length * 0.01, r: r });
  });
  out.sort(function (a, b) { return b.s - a.s; });
  return out.slice(0, limit || 30).map(function (x) { return _v73BookRow_(x.r); });
}

// --- API ---
function v73List(json, token) {
  try { _requireAuth_(token, 'catalog|ttk_edit|haccp|ttk_approve'); } catch (e) { return _failFrom_(e); }
  try {
    var d = {}; try { d = JSON.parse(json || '{}') || {}; } catch (e) {}
    var recs = _v73Rows_().map(_v73Obj_).reverse(), q = _v73Key_(d.q || '');
    if (q) recs = recs.filter(function (r) { return r.key.indexOf(q) >= 0; });
    if (d.status) recs = recs.filter(function (r) { return r.status === d.status; });
    // покрытие ингредиентов ТТК (сырьё, без п/ф собственного производства)
    var idx = _buildDishIndexes_(), names = {}, all = _v73Rows_().map(_v73Obj_), best = {};
    Object.keys(idx.dishByCode).forEach(function (code) {
      (idx.dishByCode[code].ing || []).forEach(function (i) {
        var nm = String(i[0] || '').trim(); if (!nm) return;
        if (idx.dishByNormName && typeof _normNameServer_ === 'function' && idx.dishByNormName[_normNameServer_(nm)]) return;
        names[_v73Key_(nm)] = nm;
      });
    });
    var rank = { APPROVED: 4, REVIEW: 3, DRAFT: 2, REJECTED: 1, SUPERSEDED: 0 };
    all.forEach(function (r) { if (!best[r.key] || rank[r.status] > rank[best[r.key].status]) best[r.key] = r; });
    var cov = Object.keys(names).sort().map(function (k) {
      var ap = _v73Lookup_(names[k]), b = best[k];
      return { name: names[k], status: ap ? 'APPROVED' : (b ? b.status : ''), statusRu: ap ? 'утверждено' : (b ? b.statusRu : 'нет значения'), kcal: ap ? ap.kcal : null, via: ap && ap.key !== k ? ap.name : '' };
    });
    var cnt = { total: cov.length, approved: 0, review: 0, draft: 0, none: 0 };
    cov.forEach(function (c) { if (c.status === 'APPROVED') cnt.approved++; else if (c.status === 'REVIEW') cnt.review++; else if (c.status === 'DRAFT') cnt.draft++; else cnt.none++; });
    var lim = Math.min(Number(d.limit) || 300, 1000);
    return _ok_({ records: recs.slice(0, lim), totalRecords: recs.length, coverage: cov, counts: cnt,
      methods: Object.keys(MC_V73_METHODS_).map(function (k) { return { id: k, ru: MC_V73_METHODS_[k][1], trust: MC_V73_METHODS_[k][0] }; }),
      book: { title: MC_V73_BOOK_, rows: _v73Book_().length, note: MC_V73_BOOK_NOTE_ } });
  } catch (e) { return _failFrom_(e); }
}
function v73BookSearch(q, token) {
  try { _requireAuth_(token, 'catalog|ttk_edit|haccp|ttk_approve'); } catch (e) { return _failFrom_(e); }
  try { return _ok_({ q: String(q || ''), rows: _v73BookFind_(q, 30), book: MC_V73_BOOK_ }); } catch (e) { return _failFrom_(e); }
}
function v73Propose(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'ttk_edit|haccp', 'KBJU_PROPOSE', 'КБЖУ', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var o = _v73Clean_(JSON.parse(json || '{}'));
    return _withLock_(function () {
      var r = _v73Append_(o, o.method === 'UNCONFIRMED' ? 'DRAFT' : 'REVIEW', op);
      _audit_(op, 'KBJU_PROPOSE', 'КБЖУ', r.id, null, { name: o.name, method: o.method, status: r.status, energy: r.energy });
      _endOp_(op);
      return _ok_(r, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return /VALIDATION/.test(String(e)) ? _fail_('VALIDATION', String(e.message || e).replace(/^VALIDATION:\s*/, ''), op && op.id) : _failFrom_(e, op && op.id); }
}
/** Значение из справочника для продукта предприятия: {name — продукт (как в ТТК), code — код строки справочника}. */
function v73FromBook(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'ttk_edit|haccp', 'KBJU_FROM_BOOK', 'КБЖУ', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = JSON.parse(json || '{}'), row = _v73Book_().filter(function (r) { return String(r[0]) === String(d.code); })[0];
    if (!row) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Строки справочника с кодом ' + d.code + ' нет', op.id); }
    var b = _v73BookRow_(row);
    var o = _v73Clean_({ name: d.name || b.name, per: '100 г', kcal: b.kcal, protein: b.protein, fat: b.fat, carbs: b.carbs, fiber: b.fiber, sugars: b.sugars,
      acids: b.acids, method: 'REFERENCE', source: MC_V73_BOOK_, table: 'табл. ' + b.table + ', код ' + b.code + ' «' + b.name + '»', page: String(b.page),
      comment: MC_V73_BOOK_NOTE_ + '; углеводы — усвояемые, сахара — моно- и дисахариды' + (b.acids ? '; органические кислоты ' + b.acids + ' г' : '') + (d.comment ? '; ' + d.comment : '') });
    return _withLock_(function () {
      var r = _v73Append_(o, 'REVIEW', op);
      _audit_(op, 'KBJU_FROM_BOOK', 'КБЖУ', r.id, null, { name: o.name, code: b.code, page: b.page });
      _endOp_(op);
      return _ok_({ id: r.id, status: r.status, energy: r.energy, name: o.name, book: b }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return /VALIDATION/.test(String(e)) ? _fail_('VALIDATION', String(e.message || e).replace(/^VALIDATION:\s*/, ''), op && op.id) : _failFrom_(e, op && op.id); }
}
function _v73ApproveOne_(id, comment, op) {
  var sh = _v73Sheet_(), v = sh.getDataRange().getValues(), C = MC_V73_C_, a = _author_(op);
  for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(id)) {
    var st = String(v[i][C['Статус']]);
    if (st !== 'REVIEW') return { id: id, ok: false, error: st === 'DRAFT' ? 'черновик (неподтверждённое значение) утвердить нельзя — внесите значение с источником' : 'запись не «на проверке» (' + (MC_V73_STATUS_RU_[st] || st) + ')' };
    if (String(v[i][C['Способ']]) === 'UNCONFIRMED') return { id: id, ok: false, error: 'неподтверждённое значение утвердить нельзя' };
    if (a.id && String(v[i][C['ID внёсшего']]) === String(a.id)) return { id: id, ok: false, error: 'утверждает не автор записи' };
    if (/^НЕ СХОДИТСЯ/.test(String(v[i][C['Проверка энергии']])) && !comment) return { id: id, ok: false, error: 'энергия не сходится с белками, жирами и углеводами — утверждение только с пояснением' };
    var key = String(v[i][C['Ключ']]);
    for (var j = 1; j < v.length; j++) if (j !== i && String(v[j][C['Ключ']]) === key && String(v[j][C['Статус']]) === 'APPROVED') sh.getRange(j + 1, C['Статус'] + 1).setValue('SUPERSEDED');
    sh.getRange(i + 1, C['Статус'] + 1).setValue('APPROVED');
    sh.getRange(i + 1, C['Проверил'] + 1, 1, 2).setValues([[a.фио + (a.должность ? ', ' + a.должность : ''), _v73Now_()]]);
    if (comment) sh.getRange(i + 1, C['Комментарий'] + 1).setValue(String(v[i][C['Комментарий']] || '') + (v[i][C['Комментарий']] ? '; ' : '') + 'при утверждении: ' + comment);
    _audit_(op, 'KBJU_APPROVE', 'КБЖУ', id, 'REVIEW', { status: 'APPROVED', key: key });
    _v73Cache_ = null;
    return { id: id, ok: true, name: String(v[i][C['Продукт']]) };
  }
  return { id: id, ok: false, error: 'запись не найдена' };
}
function v73Approve(id, comment, token) {
  var op = null;
  try { op = _beginOp_(token, 'ttk_approve|haccp', 'KBJU_APPROVE', 'КБЖУ', id, null); } catch (e) { return _failFrom_(e); }
  try {
    return _withLock_(function () {
      var r = _v73ApproveOne_(id, String(comment || '').trim(), op);
      if (!r.ok) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', r.error, op.id); }
      _endOp_(op); return _ok_(r, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function v73ApproveMany(idsJson, comment, token) {
  var op = null;
  try { op = _beginOp_(token, 'ttk_approve|haccp', 'KBJU_APPROVE_MANY', 'КБЖУ', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var ids = JSON.parse(idsJson || '[]'); if (!Array.isArray(ids) || !ids.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Не выбраны записи', op.id); }
    return _withLock_(function () {
      var res = ids.slice(0, 200).map(function (id) { return _v73ApproveOne_(id, String(comment || '').trim(), op); });
      _endOp_(op);
      return _ok_({ approved: res.filter(function (x) { return x.ok; }).length, refused: res.filter(function (x) { return !x.ok; }) }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function v73Reject(id, reason, token) {
  var op = null;
  try { op = _beginOp_(token, 'ttk_approve|haccp', 'KBJU_REJECT', 'КБЖУ', id, null); } catch (e) { return _failFrom_(e); }
  try {
    reason = String(reason || '').trim();
    if (!reason) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите причину', op.id); }
    return _withLock_(function () {
      var sh = _v73Sheet_(), v = sh.getDataRange().getValues(), C = MC_V73_C_, a = _author_(op);
      for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(id)) {
        var st = String(v[i][C['Статус']]);
        if (st !== 'REVIEW' && st !== 'DRAFT') { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Отклонить можно черновик или запись на проверке', op.id); }
        sh.getRange(i + 1, C['Статус'] + 1).setValue('REJECTED');
        sh.getRange(i + 1, C['Проверил'] + 1, 1, 2).setValues([[a.фио, _v73Now_()]]);
        sh.getRange(i + 1, C['Комментарий'] + 1).setValue(String(v[i][C['Комментарий']] || '') + (v[i][C['Комментарий']] ? '; ' : '') + 'отклонено: ' + reason);
        _audit_(op, 'KBJU_REJECT', 'КБЖУ', id, st, { status: 'REJECTED', reason: reason });
        _v73Cache_ = null; _endOp_(op);
        return _ok_({ id: id, status: 'REJECTED' }, op.id);
      }
      _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Запись не найдена', op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Миграция (шаг 11): прежние значения — в черновики V73 (способ «неподтверждённое значение»). Повторный запуск не дублирует. */
function _v73ImportLegacy_() {
  var have = {}, n = { fromRef: 0, fromMatch: 0, skipped: 0 };
  _v73Rows_().forEach(function (r) { if (String(r['Способ']) === 'UNCONFIRMED') have[[r['Ключ'], r['Ккал'], r['Белки'], r['Жиры'], r['Углеводы']].join('|')] = 1; });
  var add = function (name, k, p, f, c, fi, su, src, kind) {
    var o = { name: String(name).trim(), per: '100 г', kcal: _v73Num_(k), protein: _v73Num_(p), fat: _v73Num_(f), carbs: _v73Num_(c), fiber: _v73Num_(fi), sugars: _v73Num_(su), salt: null,
      method: 'UNCONFIRMED', source: src, table: '', page: '', comment: 'перенесено из прежнего справочника (нормативный аудит, ДОК_12): источник и проверка не указаны' };
    if (!o.name || [o.kcal, o.protein, o.fat, o.carbs].some(function (x) { return x === null || isNaN(x); })) { n.skipped++; return; }
    ['fiber', 'sugars'].forEach(function (x) { if (o[x] !== null && isNaN(o[x])) o[x] = null; });
    var sig = [_v73Key_(o.name), o.kcal, o.protein, o.fat, o.carbs].join('|');
    if (have[sig]) { n.skipped++; return; }
    _v73Append_(o, 'DRAFT', null); have[sig] = 1; n[kind]++;
  };
  var sh = _book_().getSheetByName('Справочник_Пищевая_Ценность');
  if (sh && sh.getLastRow() > 1) sh.getDataRange().getValues().slice(1).forEach(function (r) { add(r[0], r[1], r[2], r[3], r[4], '', '', 'справочник КБЖУ программы до 16.11.2026 — источник не указан', 'fromRef'); });
  var ms = _book_().getSheetByName(typeof TTK_MATCH_SHEET !== 'undefined' ? TTK_MATCH_SHEET : 'ТТК_Сопоставление');
  if (ms && ms.getLastRow() > 1) {
    var seen = {};
    ms.getDataRange().getValues().slice(1).forEach(function (r) {
      if (!r[1] || seen[_v73Key_(r[1])]) return; seen[_v73Key_(r[1])] = 1;
      add(r[1], r[3], r[4], r[5], r[6], r[7], r[8], 'база продуктов «' + (typeof PRODUCTS_DB_SHEET !== 'undefined' ? PRODUCTS_DB_SHEET : 'Продукты_Справочник') + '» — источник не указан', 'fromMatch');
    });
  }
  return n;
}

/** Миграция (шаг 12): реестр нормативов V33 — ГОСТ Р 51705.1-2001 заменён 2024; добавлены СП 2.3.6.4281-26, приказы 29н и 862 (ДОК_12).
 *  Строку, изменённую на предприятии (статус не «GUIDANCE»), не трогает. Повторный запуск ничего не меняет. */
function _v33UpdateNormDocs_() {
  if (typeof _v33SeedNorms_ === 'function') _v33SeedNorms_();
  var sh = _book_().getSheetByName(typeof MC_V33 !== 'undefined' ? MC_V33.NORM : 'Нормативы_V33'); if (!sh) return { skipped: 'реестра нет' };
  var v = sh.getDataRange().getValues(), ids = {}, out = { updated: [], added: [], kept: [] };
  for (var i = 1; i < v.length; i++) ids[String(v[i][0])] = i;
  if (ids.GOST_R_51705_1_2001 !== undefined) {
    var r = v[ids.GOST_R_51705_1_2001];
    if (String(r[2]) === 'GUIDANCE') {
      sh.getRange(ids.GOST_R_51705_1_2001 + 1, 3).setValue('HISTORICAL'); sh.getRange(ids.GOST_R_51705_1_2001 + 1, 7).setValue('2024-11-01');
      sh.getRange(ids.GOST_R_51705_1_2001 + 1, 10).setValue('Заменён ГОСТ Р 51705.1-2024 (карточка Росстандарта; нормативный аудит, ДОК_12)');
      out.updated.push('ГОСТ Р 51705.1-2001 → заменён');
    } else if (String(r[2]) !== 'HISTORICAL') out.kept.push('ГОСТ Р 51705.1-2001 (статус изменён на предприятии: ' + r[2] + ')');
  }
  [['GOST_R_51705_1_2024','GOST','GUIDANCE','ГОСТ Р 51705.1-2024','Управление качеством и безопасностью пищевых продуктов на основе принципов ХАССП. Общие требования','2024-11-01','',false,'https://protect.gost.ru/','Заменил ГОСТ Р 51705.1-2001; дата введения — по карточке Росстандарта (найдено поиском, текст не открыт — ДОК_12)'],
   ['SP_2_3_6_4281_26','SANPIN','ACTIVE','СП 2.3.6.4281-26','Требования к торговым объектам и рынкам, реализующим пищевую продукцию (наименование сверить по официальной публикации)','2026-09-01','',false,'http://publication.pravo.gov.ru/document/0001202606020079','Постановление ГГСВ РФ от 02.06.2026 № 17; заменил СП 2.3.6.3668-20; применяется при реализации товаров (торговле) — ДОК_12'],
   ['PRIKAZ_MZ_29N_2021','ORDER','ACTIVE','Приказ Минздрава России от 28.01.2021 № 29н','Порядок обязательных предварительных и периодических медицинских осмотров работников (наименование сверить)','2021-04-01','2027-04-01',true,'','Медосмотры персонала (сноска к п. 24 СанПиН 2.3/2.4.4282-26); срок действия — по страницам Роспотребнадзора (ДОК_12)'],
   ['PRIKAZ_MSH_862_2022','ORDER','ACTIVE','Приказ Минсельхоза России от 13.12.2022 № 862','Ветеринарные правила организации работы по оформлению ветеринарных сопроводительных документов','','',true,'','В ред. приказа от 07.05.2025 № 317 (с 01.09.2025); оформление и гашение ВСД (ДОК_12)']
  ].forEach(function (row) { if (ids[row[0]] === undefined) { sh.appendRow(row); out.added.push(row[3]); } });
  return out;
}
/** Миграция (шаг 13): у товаров, импортированных из базы продуктов, в «единицу» попадала размерность типа (UNKNOWN). */
function _v53FixImportedUnits_() {
  var sh = _book_().getSheetByName(typeof V53 !== 'undefined' ? V53.PRODUCTS : 'Продукты_ID_V53'); if (!sh || sh.getLastRow() < 2) return { fixed: 0 };
  var v = sh.getDataRange().getValues(), h = v[0], cu = h.indexOf('CanonicalUnit'), src = h.indexOf('Source'), n = 0;
  if (cu < 0 || src < 0) return { fixed: 0, skipped: 'нет колонок' };
  for (var i = 1; i < v.length; i++) if (String(v[i][src]) === 'PRODUCTS_DB' && String(v[i][cu]) === 'UNKNOWN') { sh.getRange(i + 1, cu + 1).setValue(''); n++; }
  return { fixed: n };
}

/* Справочник ИП РАМН 2002 (Скурихин, Тутельян): строки «на 100 г», прошедшие проверку энергии по методике книги.
 * Поля: код, таблица, страница, группа, продукт, белки, жиры, углеводы (усвояемые), пищевые волокна, моно- и дисахариды,
 * крахмал, органические кислоты, вода, энергия (ккал). Строки, не прошедшие проверку, сюда не включены (ДОК_12, приложение П8). */
var MC_V73_REF_ = [
["1.1.1.1","1",24,"Жирность / Молоко","Молоко пастеризованное нежирное",3.0,0.05,4.9,0.0,4.9,0.0,0.15,91.2,32.0],
["1.1.1.2","1",24,"Жирность / Молоко","Молоко топленое нежирное",3.0,0.05,5.0,0.0,5.0,0.0,0.15,91.2,32.0],
["1.1.1.3","1",24,"Жирность / Молоко","Молоко топленое 1,0% жирности",3.0,1.0,4.8,0.0,4.8,0.0,0.1,90.4,40.0],
["1.1.1.4","1",24,"Жирность / Молоко","Молоко белковое",4.3,1.0,6.4,0.0,6.4,0.0,0.1,87.4,52.0],
["1.1.1.5","1",24,"Жирность / Молоко","Пахта «Идеал» пастеризованная",3.3,1.0,4.7,0.0,4.7,0.0,0.1,90.2,41.0],
["1.1.2.1","1",24,"Жирность / Кисломолочные продукты","Ацидофилин нежирный",3.0,0.05,3.9,0.0,3.9,0.0,0.95,91.4,31.0],
["1.1.2.2","1",24,"Жирность / Кисломолочные продукты","Ацидофилин 1,0% жирности",3.0,1.0,4.0,0.0,4.0,0.0,0.9,90.4,40.0],
["1.1.2.3","1",24,"Жирность / Кисломолочные продукты","Кефир нежирный",3.0,0.05,4.0,0.0,4.0,0.0,0.85,91.4,31.0],
["1.1.2.4","1",24,"Жирность / Кисломолочные продукты","Кефир 1,0% жирности",3.0,1.0,4.0,0.0,4.0,0.0,0.9,90.4,40.0],
["1.1.2.5","1",24,"Жирность / Кисломолочные продукты","Кумыс из коровьего молока, нежирный",3.0,0.05,6.3,0.0,6.3,0.0,1.05,88.9,41.0],
["1.1.2.6","1",24,"Жирность / Кисломолочные продукты","Напиток «Снежок», плодово-ягодный 1,0% жирности",2.7,1.0,12.2,0.0,12.2,0.0,0.8,82.6,69.0],
["1.1.2.7","1",24,"Жирность / Кисломолочные продукты","Напиток «Юбилейный», 1,0% жирности",3.0,1.0,4.1,0.0,4.1,0.0,0.8,90.4,40.0],
["1.1.2.8","1",26,"Жирность / Кисломолочные продукты","Напиток плодово-ягодный, 1 0% жирности",2.7,1.0,12.2,0.0,12.2,0.0,0.8,82.6,71.0],
["1.1.2.9","1",26,"Жирность / Кисломолочные продукты","Пахта «Идеал», сквашенная",3.0,1.0,3.8,0.0,3.8,0.0,1.0,90.2,40.0],
["1.1.2.10","1",26,"Жирность / Кисломолочные продукты","Простокваша нежирная",3.0,0.05,3.8,0.0,3.8,0.0,0.85,91.6,30.0],
["1.1.2.11","1",26,"Жирность / Кисломолочные продукты","Простокваша 1 0% жирности",3.0,1.0,4.1,0.0,4.1,0.0,0.8,90.4,40.0],
["1.1.2.12","1",26,"Жирность / Кисломолочные продукты","Простокваша цитрусовая, 1 0% жирности",2.7,1.0,10.1,0.0,10.1,0.0,0.9,84.6,63.0],
["1.1.2.13","1",26,"Жирность / Кисломолочные продукты","Ряженка 1 0% жирности",3.0,1.0,4.2,0.0,4.2,0.0,0.9,90.2,40.0],
["1.1.3.1","1",26,"Жирность / Творожные изделия","Творог нежирный",22.0,0.6,3.3,0.0,3.3,0.0,1.2,71.7,110.0],
["1.1.3.2","1",26,"Жирность / Творожные изделия","Творог мягкий диетический, нежирный",22.0,0.6,3.3,0.0,3.3,0.0,1.2,71.7,110.0],
["1.1.3.3","1",26,"Жирность / Творожные изделия","Творог мягкий диетический, нежирный плодово-ягодный",18.2,0.5,14.0,0.0,14.0,0.0,1.4,64.7,138.0],
["1.1.3.4","1",26,"Жирность / Творожные изделия","Сыр домашний нежирный",18.0,0.6,1.5,0.0,1.5,0.0,1.0,78.0,86.0],
["1.1.3.5","1",26,"Жирность / Творожные изделия","Паста ацидофильная, сладкая, нежирная",5.5,0.2,13.5,0.0,13.5,0.0,1.0,78.8,81.0],
["1.1.3.6","1",26,"Жирность / Творожные изделия","Паста молочная белковая",11.0,0.2,2.0,0.0,2.0,0.0,1.0,84.9,57.0],
["1.2.1.1","1",28,"Жирность / Молоко","Молоко пастеризованное, 1,5% жирности",3.0,1.5,4.8,null,4.8,0.0,0.1,89.9,45.0],
["1.2.1.2","1",28,"Жирность / Молоко","Молоко пастеризованное, 2,5% жирности",2.9,2.5,4.8,null,4.8,0.0,0.1,89.0,54.0],
["1.2.1.3","1",28,"Жирность / Молоко","Молоко стерилизованное, 1,5% жирности",3.0,1.5,4.8,null,4.8,0.0,0.1,89.9,45.0],
["1.2.1.4","1",28,"Жирность / Молоко","Молоко стерилизованное, 2,5% жирности",2.9,2.5,4.8,null,4.8,0.0,0.1,89.0,54.0],
["1.2.1.5","1",28,"Жирность / Молоко","Молоко стерилизованное, «Можайское» 3,0% жирности",2.9,3.0,4.7,null,4.7,0.0,0.1,88.6,58.0],
["1.2.2.1","1",28,"Жирность / Кисломолочные продукты","Варенец 2,5% жирности",2.9,2.5,4.1,null,4.1,0.0,0.8,89.0,53.0],
["1.2.2.2","1",28,"Жирность / Кисломолочные продукты","Йогурт 1,5% жирности",4.1,1.5,5.9,null,5.9,0.0,1.1,86.5,57.0],
["1.2.2.3","1",28,"Жирность / Кисломолочные продукты","Йогурт плодово-ягодный, 1,5% жирности",4.0,1.5,14.3,null,14.3,0.0,1.2,78.1,90.0],
["1.2.2.4","1",30,"Жирность / Кисломолочные продукты","Кефир 2 5% жирности",2.9,2.5,4.0,0.0,4.0,0.0,0.9,89.0,53.0],
["1.2.2.5","1",30,"Жирность / Кисломолочные продукты","Кумыс из кобь льего молока",2.1,1.9,5.0,0.0,5.0,0.0,1.4,89.1,50.0],
["1.2.2.6","1",30,"Жирность / Кисломолочные продукты","Напиток кисломолочный, «Бифидин» 2 5% жирности",3.4,2.5,5.5,0.0,5.5,0.0,0.9,87.0,61.0],
["1.2.2.7","1",30,"Жирность / Кисломолочные продукты","Напиток «Снежок» 2,5% жирности",2.0,2.5,10.8,0.0,10.8,0.0,0.8,82.5,79.0],
["1.2.2.9","1",30,"Жирность / Кисломолочные продукты","Напиток «Юбилейный», плодово-ягодный, 2,5% жирности",2.6,2.5,12.2,0.0,12.2,0.0,0.8,81.2,84.0],
["1.2.2.10","1",30,"Жирность / Кисломолочные продукты","Продукт кисломолочный «Тонус» 2,5% жирности",2.9,2.5,4.1,0.0,4.1,0.0,0.8,89.0,53.0],
["1.2.2.11","1",30,"Жирность / Кисломолочные продукты","Простокваша 2,5% жирности",2.9,2.5,4.1,0.0,4.1,0.0,0.8,89.0,53.0],
["1.2.2.12","1",30,"Жирность / Кисломолочные продукты","Простокваша «Цитрусовая» 2,5% жирности",2.6,2.5,10.1,0.0,10.1,0.0,0.9,83.2,76.0],
["1.2.2.13","1",30,"Жирность / Кисломолочные продукты","Ряженка 2,5% жирности",2.9,2.5,4.2,0.0,4.2,0.0,0.9,88.8,54.0],
["1.2.3.1","1",30,"Жирность / Творожные изделия","Творог «Столовый» 2,0% жирности",20.0,2.0,3.0,0.0,3.0,0.0,1.2,72.6,114.0],
["1.2.4.1","1",30,"Жирность / Консервы","Молоко «Дружба» сгущенное с сахаром",7.4,2.5,54.6,0.0,54.6,0.0,0.3,33.4,271.0],
["1.2.5.1","1",32,"Жирность / Кулинарные изделия","Суп молочный с макаронами по 1-172",2.2,1.9,7.9,1.0,2.6,5.3,0.1,86.5,58.0],
["1.2.5.2","1",32,"Жирность / Кулинарные изделия","молочный Суп с рисом по 1-174",1.8,1.9,7.3,0.2,2.9,4.4,0.1,87.7,54.0],
["1.2.5.3","1",32,"Жирность / Кулинарные изделия","Суп молочный с тыквой и манной крупой по 1-178",2.0,2.2,5.4,0.6,3.3,2.1,0.1,88.6,50.0],
["1.2.5.4","1",32,"Жирность / Кулинарные изделия","Суп молочный с белокочанной капустой 1-180 по",2.0,2.0,6.8,0.6,3.2,3.6,0.1,87.2,54.0],
["1.3.1.1","1",32,"Жирность / Молоко","Молоко пастеризованное 3,2% жирности",2.9,3.2,4.7,0.0,4.7,0.0,0.1,88.4,60.0],
["1.3.1.2","1",32,"Жирность / Молоко","Молоко стерилизованное 3,2% жирности",3.0,3.2,4.7,0.0,4.7,0.0,0.1,88.3,60.0],
["1.3.1.3","1",32,"Жирность / Молоко","Молоко пастеризованное 3,5% жирности",2.9,3.5,4.7,0.0,4.7,0.0,0.1,88.1,62.0],
["1.3.1.4","1",32,"Жирность / Молоко","Молоко стерилизованное 3,5% жирности",3.0,3.5,4.7,0.0,4.7,0.0,0.1,88.0,63.0],
["1.3.1.5","1",32,"Жирность / Молоко","Молоко топленое 4,0% жирности",2.9,4.0,4.7,0.0,4.7,0.0,0.1,87.6,67.0],
["1.3.2.1","1",34,"Жирность / Кисломолочные продукты","Ацидофилин 3,2% жирности",2.9,3.2,3.8,0.0,3.8,0.0,1.0,88.4,59.0],
["1.3.2.2","1",34,"Жирность / Кисломолочные продукты","Ацидофилин сладкий 3,2% жирности",2.8,3.2,8.6,0.0,8.6,0.0,0.9,83.8,77.0],
["1.3.2.4","1",34,"Жирность / Кисломолочные продукты","Йогурт сладкий 3,2% жирности",5.0,3.2,8.5,0.0,8.5,0.0,1.3,81.3,87.0],
["1.3.2.5","1",34,"Жирность / Кисломолочные продукты","Йогурт 6,0% жирности",5.0,6.0,3.5,0.0,3.5,0.0,1.3,83.5,92.0],
["1.3.2.6","1",34,"Жирность / Кисломолочные продукты","Йогурт сладкий 6,0% жирности",5.0,6.0,8.5,0.0,8.5,0.0,1.3,78.5,112.0],
["1.3.2.7","1",34,"Жирность / Кисломолочные продукты","Кефир 3,2% жирности",2.9,3.2,4.0,0.0,4.0,0.0,0.9,88.3,59.0],
["1.3.2.8","1",34,"Жирность / Кисломолочные продукты","Простокваша 3,2% жирности",2.9,3.2,4.1,0.0,4.1,0.0,0.8,88.3,59.0],
["1.3.2.9","1",34,"Жирность / Кисломолочные продукты","Простокваша «Мечниковская» 4,0% жирности",2.8,4.0,4.1,0.0,4.1,0.0,0.8,87.6,66.0],
["1.3.2.10","1",34,"Жирность / Кисломолочные продукты","Ряженка 4,0% жирности",2.8,4.0,4.2,0.0,4.2,0.0,0.9,87.4,67.0],
["1.3.2.11","1",36,"Жирность / Кисломолочные продукты","Ряженка 6,0% жирности",3.0,6.0,4.1,0.0,4.1,0.0,0.9,85.3,85.0],
["1.3.2.12","1",36,"Жирность / Кисломолочные продукты","Сметана 10,0% жирности",2.7,10.0,3.9,0.0,3.9,0.0,0.8,82.0,119.0],
["1.3.2.13","1",36,"Жирность / Кисломолочные продукты","Сметана «Домашняя» 10,0% жирности",3.8,10.0,5.6,0.0,5.6,0.0,0.9,78.5,130.0],
["1.3.3.1","1",36,"Жирность / Творожные изделия","Творог мягкий диетический 4,0% жирности",21.0,4.0,3.0,0.0,3.0,0.0,1.2,69.6,136.0],
["1.3.3.2","1",36,"Жирность / Творожные изделия","Творог мягкий диетический, плодово-ягодный, 4,0% жирности",17.0,4.0,13.7,0.0,13.7,0.0,1.4,62.4,164.0],
["1.3.3.3","1",36,"Жирность / Творожные изделия","Сыр домашний 4,0% жирности",17.0,4.0,1.5,0.0,1.5,0.0,1.0,75.5,113.0],
["1.3.3.4","1",36,"Жирность / Творожные изделия","Паста ацидофильная 4,0% жирности -Творог «Крестьянский» 5,0% жирности",5.5,4.0,20.5,0.0,20.5,0.0,1.0,68.1,143.0],
["1.3.3.6","1",36,"Жирность / Творожные изделия","Крем творожный с ванилином 5,0% жирности",11.0,5.0,19.2,0.0,19.2,0.0,0.5,63.4,167.0],
["1.3.3.7","1",36,"Жирность / Творожные изделия","Паста ацидофильная, сладкая 8,0% жирности",6.6,8.0,25.5,0.0,25.5,0.0,1.0,58.0,203.0],
["1.3.3.8","1",36,"Жирность / Творожные изделия","Сырки и масса творожная «Цитрон» сладкие, 8,0% жирности",15.0,8.0,11.5,0.0,11.5,0.0,1.0,63.6,181.0],
["1.3.3.9","1",36,"Жирность / Творожные изделия","Творог полужирный 9,0% жирности",18.0,9.0,3.0,0.0,3.0,0.0,1.2,67.8,169.0],
["1.3.4.1","1",38,"Жирность / Молочные консервы","Молоко сгущенное с сахаром, 5,0% жирности",7.1,5.0,55.2,0.0,55.2,0.0,0.3,30.6,295.0],
["1.3.4.2","1",38,"Жирность / Молочные консервы","Молоко сгущенное с сахаром 8,5% жирности",7.2,8.5,55.5,0.0,55.5,0.0,0.4,26.6,328.0],
["1.3.4.3","1",38,"Жирность / Молочные консервы","Молоко сгущенное стерилизованное 7,8% жирности",6.4,7.8,10.3,0.0,10.3,0.0,0.4,73.6,138.0],
["1.3.4.4","1",38,"Жирность / Молочные консервы","Какао со сгущенным молоком и сахаром",8.2,7.5,51.6,3.3,51.0,0.6,0.5,26.7,321.0],
["1.3.4.5","1",38,"Жирность / Молочные консервы","Кофе натуральный со сгущенным молоком и сахаром",8.4,8.6,53.0,0.0,53.0,0.0,0.5,27.5,324.0],
["1.3.5.1","1",38,"Жирность / Кулинарные изделия","Вареники ленивые отварные по 1-328",13.0,7.0,13.8,0.6,6.9,6.9,0.8,63.6,173.0],
["1.3.5.2","1",38,"Жирность / Кулинарные изделия","Сырники из творога (творог нежирный) 1-330 по",18.6,3.6,18.2,0.8,10.2,8.0,1.1,55.4,183.0],
["1.3.5.3","1",38,"Жирность / Кулинарные изделия","Сырники из творога и картофеля по 1 -330",11.9,7.7,15.2,1.2,1.6,13.6,0.6,61.6,180.0],
["1.3.5.4","1",38,"Жирность / Кулинарные изделия","Пудинг из творога (творог п/жирный) по 1-334",13.9,9.6,20.1,1.4,14.1,6.0,0.9,52.2,224.0],
["1.3.5.5","1",38,"Жирность / Кулинарные изделия","Запеканка из творога (творог нежирный) 1-338 по",17.6,4.2,14.2,0.4,8.1,6.1,1.1,60.6,168.0],
["1.3.5.6","1",38,"Жирность / Кулинарные изделия","Лапшевник с творогом по 1-308",7.7,7.4,20.3,0.7,4.4,15.6,0.4,62.3,180.0],
["1.4.1.1","1",38,"Жирность","Сливки пастеризованные 20,0% жирности",2.5,20.0,4.0,0.0,4.0,0.0,0.2,72.8,207.0],
["1.4.1.2","1",38,"Жирность","Сливки пастеризованные 35,0% жирности",2.2,35.0,3.2,0.0,3.2,0.0,0.2,59.0,337.0],
["1.4.1.3","1",40,"Жирность","Сливки стерилизованные 25,0% жирности",2.4,25.0,3.9,0.0,3.9,0.0,0.2,68.0,251.0],
["1.4.2.1","1",40,"Жирность / Кисломолочные продукты","Сметана 15,0% жирности",2.6,15.0,3.6,0.0,3.6,0.0,0.8,77.5,162.0],
["1.4.2.2","1",40,"Жирность / Кисломолочные продукты","Сметана 20,0% жирности",2.5,20.0,3.4,0.0,3.4,0.0,0.8,72.8,206.0],
["1.4.2.3","1",40,"Жирность / Кисломолочные продукты","Сметана 25,0% жирности",2.4,25.0,3.2,0.0,3.2,0.0,0.7,68.2,250.0],
["1.4.2.4","1",40,"Жирность / Кисломолочные продукты","Сметана 30,0% жирности",2.3,30.0,3.1,0.0,3.1,0.0,0.7,63.4,293.0],
["1.4.3.1","1",40,"Жирность / Творожные изделия","Творог мягкий диетический 11,0% жирности",16.0,11.0,3.0,0.0,3.0,0.0,1.2,67.8,178.0],
["1.4.3.2","1",40,"Жирность / Творожные изделия","Творог жирный 18,0% жирности",15.0,18.0,2.8,0.0,2.8,0.0,1.2,62.0,236.0],
["1.4.3.3","1",40,"Жирность / Творожные изделия","Сырки и масса творожная сладкая с ванилином, 16,5% жирности",12.0,16.5,9.5,0.0,9.5,0.0,1.0,60.1,238.0],
["1.4.3.8","1",42,"Жирность / Творожные изделия","Сырки глазированные с ванилином 27,7% жирности",7.9,27.7,32.6,1.2,31.7,0.9,0.5,29.3,413.0],
["1.4.4.2","1",42,"Жирность / Молочные консервы","Молоко сухое цельное, 25,0% жирности",24.2,25.0,39.3,0.0,39.3,0.0,1.2,4.0,483.0],
["1.4.4.3","1",42,"Жирность / Молочные консервы","Сливки сгущенные с сахаром, 19,0% жирности",8.0,19.0,47.0,0.0,47.0,0.0,0.3,23.9,392.0],
["1.4.4.4","1",42,"Жирность / Молочные консервы","Сливки сухие 42,0% жирности",19.0,42.0,30.2,0.0,30.2,0.0,0.8,4.0,577.0],
["1.4.5.1","1",42,"Жирность / Кулинарные изделия","Сырники с морковью по 1-332",12.9,11.5,18.8,1.3,9.7,9.1,0.7,53.0,232.0],
["1.4.5.2","1",42,"Жирность / Кулинарные изделия","Творожная масса с изюмом 1-332 по",6.8,21.6,29.9,0.6,29.9,0.0,0.5,39.6,343.0],
["1.5.1","1",42,"Мороженое","Молочное",3.7,3.5,21.3,0.0,21.3,0.0,0.2,70.5,132.0],
["1.5.2","1",42,"Мороженое","Молочное крем-брюле",3.7,3.5,22.9,0.0,22.9,0.0,0.1,69.0,138.0],
["1.5.3","1",42,"Мороженое","Молочное шоколадное",3.6,3.7,21.2,1.4,20.9,0.3,0.2,69.0,133.0],
["1.5.4","1",42,"Мороженое","Молочное с плодами и ягодами",3.2,2.8,21.2,0.6,21.2,0.0,0.3,71.4,124.0],
["1.5.5","1",42,"Мороженое","Молочное в шоколадной глазури",3.2,15.0,20.6,1.2,19.7,0.9,0.2,59.0,231.0],
["1.5.6","1",42,"Мороженое","Сливочное",3.7,10.0,19.4,0.0,19.4,0.0,0.1,66.0,183.0],
["1.5.7","1",42,"Мороженое","Сливочное крем-брюле",3.7,10.0,21.4,0.0,21.4,0.0,0.1,64.0,191.0],
["1.5.8","1",42,"Мороженое","Сливочное шоколадное",3.6,10.0,20.0,1.4,19.7,0.3,0.2,64.0,185.0],
["1.5.9","1",42,"Мороженое","Сливочное с плодами и ягодами",3.2,8.0,20.1,0.6,20.1,0.0,0.3,67.0,166.0],
["1.5.10","1",44,"Мороженое","Сливочное в шоколадной глазури",3.2,20.0,19.4,1.2,18.5,0.9,0.1,55.3,271.0],
["1.5.11","1",44,"Мороженое","Пломбир",3.7,15.0,20.4,0.0,20.4,0.0,0.1,60.0,232.0],
["1.5.12","1",44,"Мороженое","Пломбир крем-брюле",3.7,15.0,22.4,0.0,22.4,0.0,0.1,58.0,240.0],
["1.5.13","1",44,"Мороженое","Пломбир шоколадный",3.6,15.0,20.4,1.4,20.1,0.3,0.2,58.4,231.0],
["1.5.14","1",44,"Мороженое","Пломбир с плодами и ягодами",3.2,12.0,21.1,0.6,21.1,0.0,0.3,62.0,206.0],
["1.5.15","1",44,"Мороженое","Пломбир в шоколадной глазури",3.2,24.0,20.1,1.2,19.2,0.9,0.2,50.5,310.0],
["1.6.1.1","1",44,"Сыры / Сычужные твердые","Сусанинский",23.8,23.9,0.0,0.0,0.0,0.0,1.5,47.9,315.0],
["1.6.1.2","1",44,"Сыры / Сычужные твердые","Латвийский",23.3,24.1,0.0,0.0,0.0,0.0,2.0,46.4,316.0],
["1.6.1.3","1",44,"Сыры / Сычужные твердые","Костромской",25.6,26.1,0.0,0.0,0.0,0.0,1.9,41.9,343.0],
["1.6.1.4","1",44,"Сыры / Сычужные твердые","Пошехонский",26.0,26.1,0.0,0.0,0.0,0.0,1.7,41.9,344.0],
["1.6.1.5","1",44,"Сыры / Сычужные твердые","Угличский",25.8,26.3,0.0,0.0,0.0,0.0,2.2,41.6,347.0],
["1.6.1.6","1",44,"Сыры / Сычужные твердые","Голландский (брусковый)",26.3,26.6,0.0,0.0,0.0,0.0,2.0,40.8,350.0],
["1.6.1.7","1",44,"Сыры / Сычужные твердые","Ярославский",26.2,26.6,0.0,0.0,0.0,0.0,1.8,40.9,350.0],
["1.6.1.8","1",44,"Сыры / Сычужные твердые","Российский",23.2,29.5,0.0,0.0,0.0,0.0,2.0,41.0,364.0],
["1.6.1.9","1",46,"Сыры / Сычужные твердые","Бийский",24.2,29.9,0.0,0.0,0.0,0.0,1.6,40.3,371.0],
["1.6.1.10","1",46,"Сыры / Сычужные твердые","Голландский (круглый)",23.7,30.4,0.0,0.0,0.0,0.0,2.1,39.3,375.0],
["1.6.1.11","1",46,"Сыры / Сычужные твердые","Чеддер",23.5,30.8,0.0,0.0,0.0,0.0,2.8,38.5,380.0],
["1.6.1.12","1",46,"Сыры / Сычужные твердые","Советский",24.4,31.1,0.0,0.0,0.0,0.0,2.6,37.9,385.0],
["1.6.1.13","1",46,"Сыры / Сычужные твердые","Швейцарский",24.6,31.6,0.0,0.0,0.0,0.0,2.8,36.9,391.0],
["1.6.2.1","1",46,"Сыры / Сычужные полутвердые","Прибалтийский",29.8,9.0,0.0,0.0,0.0,0.0,2.2,55.0,207.0],
["1.6.2.2","1",46,"Сыры / Сычужные полутвердые","Литовский",27.9,14.7,0.0,0.0,0.0,0.0,2.0,51.0,250.0],
["1.6.3.1","1",46,"Сыры / Сычужные мягкие","Адыгейский",19.8,19.8,1.5,0.0,1.5,0.0,0.1,56.0,264.0],
["1.6.3.2","1",46,"Сыры / Сычужные мягкие","Рокфор",20.5,27.5,0.0,0.0,0.0,0.0,1.8,45.0,335.0],
["1.6.3.3","1",46,"Сыры / Сычужные мягкие","Русский камамбер",15.3,28.8,0.1,0.0,0.1,0.0,0.9,52.0,324.0],
["1.6.4.1","1",46,"Сыры / Сычужные рассольные","Брынза (из овечьего молока)",21.1,18.8,0.3,0.0,0.3,0.0,2.0,53.0,260.0],
["1.6.4.2","1",46,"Сыры / Сычужные рассольные","Брынза (из коровьего молока)",22.1,19.2,0.4,0.0,0.4,0.0,1.7,52.0,262.0],
["1.6.4.3","1",48,"Сыры / Сычужные рассольные","Сулугуни",20.5,22.0,0.4,0.0,0.4,0.0,1.5,51.9,286.0],
["1.6.5.1","1",48,"Сыры / Плавленые","Костромской",21.4,19.2,2.3,0.0,2.1,0.0,0.5,52.0,269.0],
["1.6.5.2","1",48,"Сыры / Плавленые","Колбасный (копченый)",21.2,19.4,3.7,0.0,3.5,0.0,0.4,51.6,275.0],
["1.6.5.3","1",48,"Сыры / Плавленые","Российский",20.5,23.0,2.5,0.0,2.3,0.0,0.5,49.0,300.0],
["1.6.5.4","1",48,"Сыры / Плавленые","Золушка",15.2,10.8,23.8,0.0,23.6,0.0,0.3,46.0,254.0],
["1.6.5.5","1",48,"Сыры / Плавленые","Сластена",13.0,11.4,28.4,0.0,28.2,0.0,0.3,43.0,269.0],
["1.6.5.6","1",48,"Сыры / Плавленые","Медовый",6.1,16.5,29.4,0.0,29.1,0.0,0.3,45.0,291.0],
["1.6.5.7","1",48,"Сыры / Плавленые","Сказка",12.2,18.0,26.1,0.0,25.1,0.0,0.2,40.0,316.0],
["1.6.5.8","1",48,"Сыры / Плавленые","Мятный",7.9,19.1,32.7,0.0,32.4,0.0,0.3,36.5,335.0],
["2.1.1","2",50,"Куриные яйца","Яйцо целое",12.0,11.5,0.7,0.0,0.7,0.0,0.0,74.1,157.0],
["2.1.2","2",50,"Куриные яйца","Яйцо отварное 1-310 по",12.0,11.5,0.7,0.0,0.7,0.0,0.0,74.1,157.0],
["2.1.3","2",50,"Куриные яйца","Яичница глазунья по 1-312",12.9,20.9,0.9,0.0,0.9,0.0,0.0,63.5,243.0],
["2.1.4","2",50,"Куриные яйца","Яйцо под майонезом по 1-86",4.1,24.5,4.7,0.6,2.4,2.3,0.2,64.5,256.0],
["2.1.5","2",50,"Куриные яйца","Салат яичный по 1-86",7.6,18.8,3.1,0.7,2.8,0.2,0.2,67.7,213.0],
["2.2.1","2",50,"Меланж","Меланж",12.7,11.5,0.7,0.0,0.7,0.0,0.0,74.1,157.0],
["2.2.2","2",50,"Меланж","Яичный порошок",46.0,37.3,4.5,0.0,4.5,0.0,0.0,7.3,542.0],
["2.2.3","2",50,"Меланж","Омлет из яичного порошка по 1-316 %",10.3,17.0,1.6,0.0,1.6,0.0,0.0,69.5,200.0],
["2.3","2",50,"","БЕЛОК",11.1,0.0,1.0,0.0,1.0,0.0,0.0,87.3,48.0],
["2.3.1","2",50,"БЕЛОК","Белок сухой",82.4,1.8,1.2,0.0,1.2,0.0,0.0,9.0,350.0],
["2.4","2",50,"","ЖЕЛТОК",16.2,31.2,0.0,0.0,0.0,0.0,0.0,50.0,354.0],
["2.4.1","2",50,"ЖЕЛТОК","Желток сухой",31.1,52.2,4.7,0.0,4.7,0.0,0.0,7.5,612.0],
["2.5.1","2",50,"Перепелиные яйца","Яйцо целое",11.9,13.1,0.6,0.0,0.6,0.0,0.0,73.2,168.0],
["3.1.1","3",52,"Мясо","Баранина 1 кат.",15.6,16.3,0.0,0.0,0.0,0.0,0.0,67.3,209.0],
["3.1.2","3",52,"Мясо","Баранина 2 кат.",19.8,9.6,0.0,0.0,0.0,0.0,0.0,69.0,166.0],
["3.1.3","3",52,"Мясо","Говядина 1 кат.",18.6,16.0,0.0,0.0,0.0,0.0,0.0,64.5,218.0],
["3.1.4","3",52,"Мясо","Говядина 2 кат.",20.0,9.8,0.0,0.0,0.0,0.0,0.0,69.2,168.0],
["3.1.5","3",52,"Мясо","Конина 1 кат.",19.5,9.9,0.0,0.0,0.0,0.0,0.0,69.6,167.0],
["3.1.6","3",52,"Мясо","Конина 2 кат.",20.9,4.1,0.0,0.0,0.0,0.0,0.0,73.9,121.0],
["3.1.7","3",52,"Мясо","Мясо кролика",21.2,11.0,0.0,0.0,0.0,0.0,0.0,66.7,183.0],
["3.1.8","3",52,"Мясо","Оленина 1 кат.",19.5,8.5,0.0,0.0,0.0,0.0,0.0,71.0,155.0],
["3.1.9","3",52,"Мясо","Поросята",20.6,3.0,0.0,0.0,0.0,0.0,0.0,75.4,109.0],
["3.1.10","3",52,"Мясо","Свинина беконная",17.0,27.8,0.0,0.0,0.0,0.0,0.0,54.2,318.0],
["3.1.11","3",52,"Мясо","Свинина жирная",11.7,49.3,0.0,0.0,0.0,0.0,0.0,38.4,491.0],
["3.1.12","3",52,"Мясо","Свинина мясная",14.3,33.3,0.0,0.0,0.0,0.0,0.0,51.5,357.0],
["3.1.13","3",52,"Мясо","Телятина 1 кат.",19.7,2.0,0.0,0.0,0.0,0.0,0.0,77.3,97.0],
["3.1.14","3",52,"Мясо","Телятина 2 кат.",20.4,0.9,0.0,0.0,0.0,0.0,0.0,78.0,89.0],
["3.1.15.1","3",52,"Мясо / Мясо","Бройлеры (цыплята) 1 кат.",18.7,16.1,0.0,0.0,0.0,0.0,0.0,64.3,220.0],
["3.1.15.2","3",52,"Мясо / Мясо","Бройлеры 2 (цыплята) кат.",19.7,11.2,0.0,0.0,0.0,0.0,0.0,68.2,180.0],
["3.1.15.3","3",52,"Мясо / Мясо","Гуси 1 кат.",15.2,39.0,0.0,0.0,0.0,0.0,0.0,45.0,412.0],
["3.1.15.4","3",52,"Мясо / Мясо","Гуси 2 кат.",17.0,27.7,0.0,0.0,0.0,0.0,0.0,54.4,317.0],
["3.1.15.5","3",52,"Мясо / Мясо","Индейки 1 кат.",19.5,22.0,0.0,0.0,0.0,0.0,0.0,57.6,276.0],
["3.1.15.6","3",52,"Мясо / Мясо","2 Индейки кат.",21.6,12.0,0.0,0.0,0.0,0.0,0.0,65.3,194.0],
["3.1.15.7","3",52,"Мясо / Мясо","Куры 1 кат.",18.2,18.4,0.0,0.0,0.0,0.0,0.0,62.6,238.0],
["3.1.15.8","3",52,"Мясо / Мясо","Куры 2 кат.",21.2,8.2,0.0,0.0,0.0,0.0,0.0,69.7,159.0],
["3.1.15.9","3",52,"Мясо / Мясо","Утки 1 кат.",15.8,38.0,0.0,0.0,0.0,0.0,0.0,45.6,405.0],
["3.1.15.10","3",52,"Мясо / Мясо","Утки 2 кат.",17.2,24.2,0.0,0.0,0.0,0.0,0.0,56.7,287.0],
["3.2.1.1","3",52,"Субпродукты / Говяжьи","Мозги",11.7,8.6,0.8,0.0,0.0,0.0,0.0,77.6,127.0],
["3.2.1.2","3",52,"Субпродукты / Говяжьи","Печень",17.9,3.7,5.3,0.0,0.0,0.0,0.0,71.7,127.0],
["3.2.2.1","3",54,"Субпродукты / Свиные","Мозги",10.5,8.6,0.8,0.0,0.0,0.0,0.0,79.1,119.0],
["3.2.2.5","3",54,"Субпродукты / Свиные","Язык",15.9,16.0,2.1,0.0,0.0,0.0,0.0,65.1,208.0],
["3.3.1","3",54,"Консервы","Баранина тушеная",17.4,13.4,0.2,0.1,0.2,0.0,0.0,67.2,191.0],
["3.3.2","3",54,"Консервы","Ветчина особая",17.6,6.2,0.0,0.0,0.0,0.0,0.0,72.8,126.0],
["3.3.3","3",54,"Консервы","Говядина отварная в собственном соку",15.4,16.9,0.0,0.0,0.0,0.0,0.0,65.4,214.0],
["3.3.4","3",54,"Консервы","Говядина тушеная",16.8,17.0,0.2,0.1,0.2,0.0,0.0,64.0,220.0],
["3.3.5","3",54,"Консервы","Гуляш бараний",14.2,15.6,3.9,0.5,1.8,2.1,0.1,63.6,213.0],
["3.3.6","3",54,"Консервы","Гуляш говяжий",16.8,14.3,3.9,0.5,1.8,2.1,0.1,62.1,212.0],
["3.3.7","3",54,"Консервы","Гуляш свиной",13.1,29.4,3.9,0.5,1.8,2.1,0.1,50.8,333.0],
["3.3.8","3",54,"Консервы","Завтрак туриста (баранина)",18.0,15.2,0.2,0.0,0.2,0.0,0.0,64.5,210.0],
["3.3.9","3",54,"Консервы","Завтрак туриста (говядина)",20.5,14.9,0.2,0.0,0.2,0.0,0.0,62.2,217.0],
["3.3.10","3",54,"Консервы","Завтрак туриста (свинина)",16.9,31.0,0.2,0.0,0.2,0.0,0.0,49.8,347.0],
["3.3.11","3",56,"Консервы","Курица в собственном соку !",23.2,9.9,0.4,0.0,0.4,0.0,1.0,64.4,183.0],
["3.3.12","3",56,"Консервы","Мясо в белом соусе (говядина)",18.0,14.8,3.6,0.3,0.9,2.7,0.1,60.9,220.0],
["3.3.13","3",56,"Консервы","Паштет мясной (говяжий)",16.1,23.3,0.4,0.3,0.4,0.0,0.0,58.1,275.0],
["3.3.14","3",56,"Консервы","Паштет печеночный",11.6,28.1,3.4,0.2,0.4,0.0,0.0,54.7,301.0],
["3.3.15","3",56,"Консервы","Свинина жирная",11.5,48.9,0.0,0.0,0.0,0.0,0.0,37.8,486.0],
["3.3.16","3",56,"Консервы","Свинина тушеная",14.9,32.2,0.2,0.1,0.2,0.0,0.0,50.8,349.0],
["3.3.17","3",56,"Консервы","Утка собственном в соку",16.0,17.5,0.3,0.0,0.3,0.0,0.0,64.0,223.0],
["3.3.18","3",56,"Консервы","Фарш свиной сосисочный",10.6,20.4,4.3,0.1,0.4,3.9,0.0,62.2,244.0],
["3.3.19","3",56,"Консервы","Фарш колбасный куриный",15.0,15.6,0.0,0.0,0.0,0.0,0.0,66.9,200.0],
["3.4.1","3",56,"Готовые быстрозамороженные блюда","Мясо цыплят жареное",26.2,16.0,0.3,0.0,0.3,0.0,0.0,56.1,250.0],
["3.4.2","3",56,"Готовые быстрозамороженные блюда","Мясо цыплят паровое",23.3,13.3,0.0,0.0,0.0,0.0,0.0,62.4,213.0],
["3.5.1.1","3",58,"Кулинарные изделия / Баранина","Барнина жареная по 1-396",22.4,19.4,0.0,0.0,0.0,0.0,0.0,55.4,264.0],
["3.5.1.2","3",58,"Кулинарные изделия / Баранина","Баранина отварная по 1-392",21.8,17.4,0.0,0.0,0.0,0.0,0.0,55.9,244.0],
["3.5.1.3","3",58,"Кулинарные изделия / Баранина","Баранина тушеная 1-422 по",10.3,12.7,3.6,0.4,1.4,2.1,0.1,70.7,170.0],
["3.5.1.4","3",58,"Кулинарные изделия / Баранина","Котлеты отбивные 1-416 по",20.6,30.6,9.1,0.9,0.2,8.9,0.0,36.5,394.0],
["3.5.1.5","3",58,"Кулинарные изделия / Баранина","Котлеты рубленые по 1-442",13.6,14.8,12.9,1.4,0.3,12.6,0.1,54.5,240.0],
["3.5.1.6","3",58,"Кулинарные изделия / Баранина","Поджарка по 1-408",19.5,35.1,3.9,1.0,3.8,0.1,0.2,36.2,409.0],
["3.5.1.7","3",58,"Кулинарные изделия / Баранина","Рагу из баранины по 1-430",5.1,10.1,10.1,1.3,2.2,7.9,0.2,71.3,152.0],
["3.5.1.8","3",58,"Кулинарные изделия / Баранина","Шницель отбивной по 1-416",21.8,23.2,9.1,0.9,0.2,8.9,0.0,42.7,333.0],
["3.5.2.1","3",58,"Кулинарные изделия / Говядина","Азу по 1-432",6.3,4.0,10.2,1.1,1.7,8.5,0.2,76.1,103.0],
["3.5.2.2","3",58,"Кулинарные изделия / Говядина","Антрекот по 1-404",29.6,11.2,0.0,0.0,0.0,0.0,0.0,56.8,220.0],
["3.5.2.3","3",58,"Кулинарные изделия / Говядина","Бефстроганов по 1 -406",16.7,11.3,5.9,0.9,3.4,2.5,0.2,61.8,193.0],
["3.5.2.4","3",60,"Кулинарные изделия / Говядина","Биточки паровые по 1-454",14.5,10.8,9.1,0.8,1.2,7.9,0.1,62.0,192.0],
["3.5.2.5","3",60,"Кулинарные изделия / Говядина","Биточки с рисом 1-446 по",5.0,5.5,18.5,1.1,0.9,17.6,0.1,68.2,144.0],
["3.5.2.6","3",60,"Кулинарные изделия / Говядина","Бифштекс 1-400 по",29.2,11.2,0.0,0.0,0.0,0.0,0.0,57.2,216.0],
["3.5.2.7","3",60,"Кулинарные изделия / Говядина","Бифштекс с яйцом по 1-402",21.5,20.8,0.4,0.0,0.4,0.0,0.0,55.5,275.0],
["3.5.2.8","3",60,"Кулинарные изделия / Говядина","Бифштекс рубленый по 1-438",18.4,25.6,0.0,0.0,0.0,0.0,0.0,54.2,306.0],
["3.5.2.9","3",60,"Кулинарные изделия / Говядина","Говядина жареная по 1-396",28.4,6.0,0.0,0.0,0.0,0.0,0.0,61.8,168.0],
["3.5.2.10","3",60,"Кулинарные изделия / Говядина","Говядина отварная по 1-392",25.8,16.8,0.0,0.0,0.0,0.0,0.0,53.9,254.0],
["3.5.2.12","3",60,"Кулинарные изделия / Говядина","Говядина тушеная по 1-422",13.6,5.4,3.3,0.4,1.3,2.0,0.1,74.9,116.0],
["3.5.2.13","3",60,"Кулинарные изделия / Говядина","Жаркое по-домашнему по 1-426",6.5,4.0,11.1,1.2,1.7,9.4,0.1,75.1,108.0],
["3.5.2.14","3",60,"Кулинарные изделия / Говядина","Зразы рубленые 1-448 по",12.1,15.7,13.1,2.2,3.5,9.6,0.2,54.6,244.0],
["3.5.2.15","3",60,"Кулинарные изделия / Говядина","Котлеты рубленые 1-444 по",14.2,11.4,13.0,1.3,0.4,12.6,0.1,57.6,213.0],
["3.5.2.17","3",62,"Кулинарные изделия / Говядина","Мясо духовое по 1-424",6.6,3.8,10.7,1.3,2.2,8.5,0.2,75.4,104.0],
["3.5.2.18","3",62,"Кулинарные изделия / Говядина","Окрошка мясная со сметаной по 1-192",2.1,1.7,6.3,0.2,4.8,1.5,0.3,88.2,52.0],
["3.5.2.19","3",62,"Кулинарные изделия / Говядина","Окрошка мясная на кефире по 1-194",2.8,1.1,4.3,0.3,2.8,1.5,0.3,90.0,39.0],
["3.5.2.20","3",62,"Кулинарные изделия / Говядина","Поджарка по 1-408",24.9,13.6,4.0,1.0,3.9,0.1,0.2,51.6,237.0],
["3.5.2.21","3",62,"Кулинарные изделия / Говядина","Ромштекс по 1-418",24.9,11.3,8.6,0.9,0.2,8.4,0.0,51.9,237.0],
["3.5.2.22","3",62,"Кулинарные изделия / Говядина","Рулет мясной с луком и яйцом по 1-450",12.3,7.0,8.1,1.2,1.7,6.4,0.2,68.6,146.0],
["3.5.2.23","3",62,"Кулинарные изделия / Говядина","Салат мясной говяжий по 1-80",5.3,18.8,7.1,0.7,1.6,5.5,0.1,66.8,219.0],
["3.5.2.24","3",62,"Кулинарные изделия / Говядина","Сардельки говяжьи отварные по 1-394",11.4,18.2,1.2,0.2,0.4,0.8,0.0,66.2,215.0],
["3.5.2.25","3",62,"Кулинарные изделия / Говядина","Солянка сборная мясная 1-168 по",2.1,2.8,1.3,0.3,1.2,0.1,0.1,91.7,39.0],
["3.5.2.26","3",62,"Кулинарные изделия / Говядина","Сосиски говяжьи отварные 1-394 по",10.4,20.0,0.8,0.0,0.2,0.6,0.0,65.9,225.0],
["3.5.2.27","3",62,"Кулинарные изделия / Говядина","Тефтели (вариант 1) по 1-452",7.4,9.1,9.6,1.3,2.8,6.8,0.1,70.4,150.0],
["3.5.2.28","3",64,"Кулинарные изделия / Говядина","Шницель рубленый 1-442 по",17.5,24.9,9.0,0.9,0.2,8.8,0.0,46.0,331.0],
["3.5.3.7","3",64,"Кулинарные изделия / Говяжьи субпродукты","Почки по-русски по 1-436",5.7,3.3,11.3,1.5,2.9,7.7,0.2,76.8,96.0],
["3.5.4.1","3",64,"Кулинарные изделия / Свинина","Котлеты отбивные по 1-414",17.5,40.3,8.8,0.9,0.2,8.2,0.1,30.2,470.0],
["3.5.4.2","3",64,"Кулинарные изделия / Свинина","Котлеты рубленые по 1 -440",13.6,45.7,0.0,0.0,0.0,0.0,0.0,38.8,466.0],
["3.5.4.3","3",66,"Кулинарные изделия / Свинина","Поджарка 1-406 по",15.7,49.3,4.2,0.1,4.0,0.2,0.2,26.3,524.0],
["3.5.4.4","3",66,"Кулинарные изделия / Свинина","Поросенок жареный 1-400 по",26.4,4.5,0.2,0.0,0.2,0.0,0.0,66.0,147.0],
["3.5.4.5","3",66,"Кулинарные изделия / Свинина","Свинина жареная по 1-396",19.6,26.2,0.0,0.0,0.0,0.0,0.0,50.6,314.0],
["3.5.4.6","3",66,"Кулинарные изделия / Свинина","Свинина отварная по 1-390",22.5,31.5,0.0,0.0,0.0,0.0,0.0,41.1,373.0],
["3.5.4.7","3",66,"Кулинарные изделия / Свинина","Свинина тушеная по 1-422",9.0,20.4,3.5,0.4,1.4,2.1,0.1,64.4,235.0],
["3.5.4.8","3",66,"Кулинарные изделия / Свинина","Шницель отбивной по 1-416",19.0,32.2,8.8,0.9,0.2,8.6,0.1,36.7,403.0],
["3.5.4.9","3",66,"Кулинарные изделия / Свинина","Шницель рубленый по 1-442",13.5,42.5,9.0,0.9,0.2,8.8,0.0,32.4,473.0],
["3.5.4.10","3",66,"Кулинарные изделия / Свинина","Эскалоп по 1-412",18.1,32.3,0.0,0.0,0.0,0.0,0.0,47.5,363.0],
["3.5.5.1","3",66,"Кулинарные изделия / Из мяса кролика","Кролик жареный по 2-18",31.5,12.7,0.1,0.0,0.1,0.0,0.0,50.8,241.0],
["3.5.5.2","3",66,"Кулинарные изделия / Из мяса кролика","Кролик отварной по 2-6",25.5,10.4,0.0,0.0,0.0,0.0,0.0,62.1,194.0],
["3.5.5.3","3",66,"Кулинарные изделия / Из мяса кролика","Рагу из кролика по 2-10",6.4,6.1,10.4,1.6,3.0,7.4,0.2,73.4,123.0],
["3.5.6.1","3",68,"Кулинарные изделия / Из мяса бройлеров","Цыплята жареные по 2-14",24.0,18.3,0.1,0.0,0.1,0.0,null,53.9,261.0],
["3.5.6.2","3",68,"Кулинарные изделия / Из мяса бройлеров","Цыплята жареные табака по 2-20",24.8,20.2,0.1,0.0,0.1,0.0,null,52.9,281.0],
["3.5.6.3","3",68,"Кулинарные изделия / Из мяса бройлеров","Цыплята отварные по 2-4",21.1,13.6,0.0,0.0,0.0,0.0,null,63.5,211.0],
["3.5.6.4","3",68,"Кулинарные изделия / Из мяса бройлеров","Котлеты рубленые 2-22 по",15.2,13.6,13.5,1.2,1.3,12.2,null,50.4,238.0],
["3.5.6.5","3",68,"Кулинарные изделия / Из мяса бройлеров","Рагу из цыплят 2-8 по",6.2,7.1,8.9,1.2,2.0,6.9,null,74.5,125.0],
["3.5.7.1","3",68,"Кулинарные изделия / Из мяса кур","Биточки паровые по 2-24",18.6,7.2,9.3,0.7,1.4,7.9,null,58.8,176.0],
["3.5.7.2","3",68,"Кулинарные изделия / Из мяса кур","Котлеты куриные 2-20 по",18.2,10.4,13.8,1.2,1.3,12.5,null,49.7,222.0],
["3.5.7.3","3",68,"Кулинарные изделия / Из мяса кур","Курица жареная 2-16 по",23.3,19.8,0.1,0.0,0.1,0.0,null,52.9,272.0],
["3.5.7.4","3",68,"Кулинарные изделия / Из мяса кур","Курица жареная во фритюре 2-20 по",24.5,11.2,13.3,1.3,0.2,13.1,null,45.6,251.0],
["3.5.7.5","3",68,"Кулинарные изделия / Из мяса кур","Курица отварная по 2-4",22.6,17.0,0.0,0.0,0.0,0.0,null,59.5,244.0],
["3.5.7.6","3",68,"Кулинарные изделия / Из мяса кур","Курица тушеная с овощами по 2-14",5.5,7.1,9.6,1.4,3.2,6.4,null,74.4,125.0],
["3.5.7.7","3",70,"Кулинарные изделия / Из мяса кур","Рагу из кур по 2-8",6.0,8.0,8.5,1.1,1.6,6.9,0.2,74.3,131.0],
["3.5.7.8","3",70,"Кулинарные изделия / Из мяса кур","Салат с курицей 1-82 по",5.7,9.9,6.0,1.2,2.5,3.5,0.5,75.5,137.0],
["3.5.7.9","3",70,"Кулинарные изделия / Из мяса кур","Фрикадельки по 2-26 куриные",18.2,6.5,7.8,0.6,1.2,6.6,0.0,63.8,163.0],
["3.5.8.1","3",70,"Кулинарные изделия / Из мяса индейки","Котлеты из индейки по 2-22",18.6,12.2,8.7,1.4,1.1,7.6,0.1,52.2,220.0],
["3.5.8.2","3",70,"Кулинарные изделия / Из мяса индейки","Индейка жареная по 2-16",23.4,20.7,0.1,0.0,0.1,0.0,0.0,51.7,280.0],
["3.5.8.3","3",70,"Кулинарные изделия / Из мяса индейки","Индейка отварная по 2-6",23.6,19.8,0.0,0.0,0.0,0.0,0.0,54.7,273.0],
["3.5.8.4","3",70,"Кулинарные изделия / Из мяса индейки","Рагу из индейки по 2-10",6.0,7.9,8.9,1.0,1.7,7.2,0.2,74.2,131.0],
["3.5.9.1","3",70,"Кулинарные изделия / Из мяса утки","Утка жареная по 2-16",23.2,34.9,0.1,0.0,0.1,0.0,0.0,38.4,407.0],
["3.5.9.2","3",70,"Кулинарные изделия / Из мяса утки","Утка отварная по 2-6",18.1,34.6,0.0,0.0,0.0,0.0,0.0,45.4,385.0],
["3.5.9.3","3",70,"Кулинарные изделия / Из мяса утки","Утка фаршированная картофелем по 2-18",7.1,10.9,10.5,0.9,0.9,9.6,0.1,69.0,169.0],
["3.5.9.4","3",70,"Кулинарные изделия / Из мяса утки","Рагу из утки по 2-10",6.3,13.5,9.6,1.0,2.0,7.6,0.2,67.6,186.0],
["3.5.10.1","3",72,"Кулинарные изделия / Мучные изделия","Пельмени отварные по 2-170",9.9,13.9,13.5,1.0,0.5,13.0,0.0,60.0,219.0],
["3.5.10.2","3",72,"Кулинарные изделия / Мучные изделия","Пельмени жареные по 2-170",11.0,22.5,14.1,1.0,0.6,13.5,0.0,49.8,303.0],
["3.5.10.3","3",72,"Кулинарные изделия / Мучные изделия","Пирожки печеные с мясным фаршем и луком по 2-188",12.2,5.7,35.5,3.0,3.6,31.9,0.0,42.0,245.0],
["3.5.10.4","3",72,"Кулинарные изделия / Мучные изделия","Расстегаи мясом с и луком 2-194 по",12.1,6.4,36.4,3.2,2.5,33.9,0.0,40.6,254.0],
["3.6.1.1","3",72,"Колбасные изделия / Вареные колбасы","Говяжья",15.0,11.7,0.2,0.1,0.1,0.0,0.0,69.7,165.0],
["3.6.1.2","3",72,"Колбасные изделия / Вареные колбасы","Диабетическая",12.1,22.8,0.0,0.0,0.0,0.0,0.0,62.4,254.0],
["3.6.1.3","3",72,"Колбасные изделия / Вареные колбасы","Диетическая",12.1,13.5,0.0,0.0,0.0,0.0,0.0,71.6,170.0],
["3.6.1.4","3",72,"Колбасные изделия / Вареные колбасы","Для завтрака",13.0,13.9,2.4,0.1,1.0,1.4,0.0,68.0,187.0],
["3.6.1.5","3",72,"Колбасные изделия / Вареные колбасы","Докторская",12.8,22.2,1.5,0.0,1.5,0.0,0.0,60.8,257.0],
["3.6.1.6","3",72,"Колбасные изделия / Вареные колбасы","Любительская",12.2,28.0,0.1,0.0,0.1,0.0,0.0,56.9,301.0],
["3.6.1.7","3",72,"Колбасные изделия / Вареные колбасы","Молочная",11.7,22.8,0.2,0.0,0.2,0.0,0.0,62.6,252.0],
["3.6.1.8","3",74,"Колбасные изделия / Вареные колбасы","Отдельная",11.0,21.0,1.7,0.1,0.7,1.0,0.0,63.0,240.0],
["3.6.1.9","3",74,"Колбасные изделия / Вареные колбасы","Русская",11.5,27.9,1.7,0.1,0.7,1.0,0.0,55.9,302.0],
["3.6.1.10","3",74,"Колбасные изделия / Вареные колбасы","Свиная",10.8,25.8,0.5,0.1,0.2,0.3,0.0,60.0,277.0],
["3.6.1.11","3",74,"Колбасные изделия / Вареные колбасы","Столовая",11.1,20.2,1.8,0.1,1.1,0.7,0.0,63.7,234.0],
["3.6.1.12","3",74,"Колбасные изделия / Вареные колбасы","Телячья",13.2,28.3,0.3,0.3,0.1,0.0,0.0,55.0,308.0],
["3.6.1.13","3",74,"Колбасные изделия / Вареные колбасы","Чайная",11.7,18.4,1.7,0.2,1.0,0.7,0.0,64.8,216.0],
["3.6.1.14","3",74,"Колбасные изделия / Вареные колбасы","Зеленоградская (с мясом утки)",17.2,12.1,2.2,0.1,0.5,1.7,0.0,65.1,187.0],
["3.6.1.15","3",74,"Колбасные изделия / Вареные колбасы","Подмосковная (с куриным мясом)",17.2,11.6,1.7,0.1,1.0,0.7,0.0,65.6,180.0],
["3.6.2.1","3",74,"Колбасные изделия / Сардельки","Говяжьи",11.4,18.2,1.3,0.2,0.5,0.8,0.0,66.1,215.0],
["3.6.2.2","3",74,"Колбасные изделия / Сардельки","1 сорта",10.3,17.2,1.5,0.2,0.9,0.6,0.0,68.0,202.0],
["3.6.2.3","3",74,"Колбасные изделия / Сардельки","Свиные",10.1,31.6,1.8,0.1,0.3,1.5,0.0,53.7,322.0],
["3.6.3.1","3",74,"Колбасные изделия / Сосиски","Говяжьи",10.4,20.1,0.8,0.0,0.2,0.6,0.0,65.8,226.0],
["3.6.3.2","3",74,"Колбасные изделия / Сосиски","Молочные",11.0,23.9,0.4,0.0,0.4,0.0,0.0,61.7,261.0],
["3.6.3.3","3",74,"Колбасные изделия / Сосиски","Русские",11.3,22.0,1.7,0.1,0.7,1.0,0.0,62.3,250.0],
["3.6.3.4","3",74,"Колбасные изделия / Сосиски","Столичные",12.2,20.3,0.5,0.0,0.5,0.0,0.0,64.2,234.0],
["3.6.4.1","3",76,"Колбасные изделия / Мясные хлебы","Ветчинный",12.9,21.8,1.9,0.1,0.6,1.3,0.0,60.2,256.0],
["3.6.4.2","3",76,"Колбасные изделия / Мясные хлебы","Говяжий",10.5,23.9,1.4,0.1,0.2,1.2,0.0,61.2,263.0],
["3.6.4.3","3",76,"Колбасные изделия / Мясные хлебы","Отдельный",12.0,21.0,2.1,0.2,0.6,1.5,0.0,61.7,246.0],
["3.6.5.1","3",76,"Колбасные изделия / Варено-копченые колбасы","Любительская",17.2,39.0,0.2,0.0,0.2,0.0,0.0,39.0,420.0],
["3.6.5.2","3",76,"Колбасные изделия / Варено-копченые колбасы","Московская",19.1,36.6,0.2,0.0,0.2,0.0,0.0,39.7,406.0],
["3.6.6.1","3",76,"Колбасные изделия / Полукопченые колбасы","Армавирская",15.1,40.1,0.3,0.1,0.1,0.2,0.0,39.6,423.0],
["3.6.6.2","3",76,"Колбасные изделия / Полукопченые колбасы","Одесская",14.8,38.1,0.3,0.0,0.1,0.2,0.0,41.9,402.0],
["3.6.6.3","3",76,"Колбасные изделия / Полукопченые колбасы","Охотничьи колбаски",25.3,40.0,0.3,0.1,0.1,0.2,0.0,30.0,463.0],
["3.6.6.4","3",76,"Колбасные изделия / Полукопченые колбасы","Таллинская",17.1,33.8,0.2,0.0,0.1,0.1,0.0,44.6,373.0],
["3.6.7.1","3",76,"Колбасные изделия / Сырокопченые колбасы","Брауншвейгская",27.7,42.2,0.2,0.0,0.2,0.0,0.0,23.3,491.0],
["3.6.7.2","3",76,"Колбасные изделия / Сырокопченые колбасы","Дорожная",17.0,47.7,0.4,0.0,0.4,0.0,0.0,29.9,498.0],
["3.6.7.3","3",78,"Колбасные изделия / Сырокопченые колбасы","Зернистая",9.9,62.8,0.3,0.1,0.2,0.1,0.0,22.5,606.0],
["3.6.7.4","3",78,"Колбасные изделия / Сырокопченые колбасы","Олимпийская",21.1,39.1,0.4,0.0,0.4,0.0,0.0,34.1,436.0],
["3.6.7.5","3",78,"Колбасные изделия / Сырокопченые колбасы","Свиная",13.0,57.0,0.2,0.1,0.2,0.0,0.0,23.7,566.0],
["3.6.7.6","3",78,"Колбасные изделия / Сырокопченые колбасы","\" Сервелат",24.0,40.5,0.2,0.0,0.2,0.0,0.0,29.1,461.0],
["3.6.8.1","3",78,"Колбасные изделия / Продукты","Грудинка копченозапеченная",10.0,52.7,0.0,0.0,0.0,0.0,0.0,33.8,514.0],
["3.6.8.2","3",78,"Колбасные изделия / Продукты","Грудинка сырокопченая",8.9,63.3,0.0,0.0,0.0,0.0,0.0,23.0,605.0],
["3.6.8.3","3",78,"Колбасные изделия / Продукты","Корейка копченозапеченная",10.2,48.2,0.0,0.0,0.0,0.0,0.0,37.7,475.0],
["3.6.8.4","3",78,"Колбасные изделия / Продукты","Корейка сырокопченая",10.5,47.4,0.0,0.0,0.0,0.0,0.0,37.4,469.0],
["3.6.8.5","3",78,"Колбасные изделия / Продукты","Окорок тамбовский вареный",14.3,25.6,0.0,0.0,0.0,0.0,0.0,57.0,288.0],
["4.1.1.1","4",80,"Рыба / Сельдевые","Килька балтийская",14.1,9.0,0.0,0.0,0.0,0.0,0.0,75.0,137.0],
["4.1.1.2","4",80,"Рыба / Сельдевые","Килька балтийская горячего копчения",21.3,8.5,0.0,0.0,0.0,0.0,0.0,67.3,162.0],
["4.1.1.3","4",80,"Рыба / Сельдевые","Килька балтийская соленая",17.1,7.6,0.0,0.0,0.0,0.0,0.0,61.0,137.0],
["4.1.1.4","4",80,"Рыба / Сельдевые","Килька соленая с и маслом луком по 1-98",10.0,13.8,1.1,0.4,1.0,0.1,0.0,66.5,169.0],
["4.1.1.5","4",80,"Рыба / Сельдевые","Килька соленая с картофелем и маслом по 1-100",11.3,12.2,9.2,0.8,0.5,8.7,0.1,62.5,192.0],
["4.1.1.7","4",80,"Рыба / Сельдевые","Килька каспийская",18.5,13.1,0.0,0.0,0.0,0.0,0.0,66.8,192.0],
["4.1.1.8","4",80,"Рыба / Сельдевые","Шпроты в масле. Консервы",17.4,32.4,0.0,0.0,0.0,0.0,0.0,47.1,363.0],
["4.1.1.9","4",80,"Рыба / Сельдевые","Салака",17.0,6.3,0.0,0.0,0.0,0.0,0.0,75.4,125.0],
["4.1.1.10","4",80,"Рыба / Сельдевые","Салака горячего копчения i",25.4,5.6,0.0,0.0,0.0,0.0,0.0,65.1,152.0],
["4.1.1.11","4",80,"Рыба / Сельдевые","Сельдь атлантическая жирная",17.7,19.5,0.0,0.0,0.0,0.0,0.0,61.3,248.0],
["4.1.1.12","4",80,"Рыба / Сельдевые","Сельдь атлантическая нежирная",19.1,6.5,0.0,0.0,0.0,0.0,0.0,72.9,135.0],
["4.1.1.13","4",80,"Рыба / Сельдевые","Сельдь атлантическая среднесоленая",17.0,8.5,0.0,0.0,0.0,1.0,0.0,63.0,145.0],
["4.1.1.14","4",80,"Рыба / Сельдевые","Сельдь тихоокеанская жирная",14.0,15.0,0.0,0.0,0.0,0.0,0.0,69.5,191.0],
["4.1.1.15","4",82,"Рыба / Сельдевые","Сельдь тихоокеанская нежирная",18.0,7.0,0.0,0.0,0.0,0.0,0.0,73.5,135.0],
["4.1.1.16","4",82,"Рыба / Сельдевые","Сельдь тихоокеанская среднесоленая",17.4,17.1,0.0,0.0,0.0,0.0,0.0,52.8,224.0],
["4.1.1.17","4",82,"Рыба / Сельдевые","Сельдь с луком по 1-98",8.3,8.3,4.2,0.3,4.2,0.0,0.4,72.7,125.0],
["4.1.1.18","4",82,"Рыба / Сельдевые","Сельдь рубленая по 1-98",10.3,9.7,2.0,1.0,1.9,0.1,0.2,70.6,136.0],
["4.1.2.1","4",82,"Рыба","Скумбрия атлантическая",18.0,13.2,0.0,0.0,0.0,0.0,0.0,67.5,191.0],
["4.1.2.2","4",82,"Рыба","Скумбрия холодного копчения Скумбрия натуральная. Консервы",23.4,6.4,0.0,0.0,0.0,0.0,0.0,60.3,150.0],
["4.1.2.4","4",82,"Рыба","Скумбрия в масле. Консервы",14.4,28.9,0.0,0.0,0.0,0.0,0.0,54.0,318.0],
["4.1.2.5","4",82,"Рыба","Скумбрия дальневосточная",19.3,18.0,0.0,0.0,0.0,0.0,0.0,61.4,239.0],
["4.1.2.6","4",82,"Рыба","Скумбрия курильская натуральная. Консервы",18.8,19.2,0.0,0.0,0.0,0.0,0.0,59.3,248.0],
["4.1.3.1","4",82,"Рыба / Ставридовые","Ставрида океаническая",18.5,4.5,0.0,0.0,0.0,0.0,0.0,75.6,114.0],
["4.1.3.2","4",82,"Рыба / Ставридовые","Ставрида отварная по 1-344",20.0,4.9,0.0,0.0,0.0,0.0,0.0,72.5,124.0],
["4.1.3.3","4",84,"Рыба / Ставридовые","Ставрида припущенная по 1-358",19.6,4.8,0.0,0.0,0.0,0.0,0.0,72.4,122.0],
["4.1.3.4","4",84,"Рыба / Ставридовые","Ставрида жареная 1-366 по",20.3,10.5,3.7,0.3,0.0,3.7,0.0,60.5,190.0],
["4.1.4.1","4",84,"Рыба / Тресковые","Минтай",15.9,0.9,0.0,0.0,0.0,0.0,0.0,81.9,72.0],
["4.1.4.2","4",84,"Рыба / Тресковые","Минтай припущенный по 1-354",16.2,1.1,0.0,0.0,0.0,0.0,0.0,79.7,75.0],
["4.1.4.3","4",84,"Рыба / Тресковые","Фрикадельки из минтая по 1-386",11.8,1.9,7.6,0.8,3.2,4.4,0.0,73.7,95.0],
["4.1.4.4","4",84,"Рыба / Тресковые","Навага",19.2,1.6,0.0,0.0,0.0,0.0,0.0,77.9,91.0],
["4.1.4.5","4",84,"Рыба / Тресковые","Навага жареная по 1-368",18.3,8.3,4.8,0.3,0.0,4.8,0.0,63.3,169.0],
["4.1.4.6","4",84,"Рыба / Тресковые","Пикша",17.2,0.5,0.0,0.0,0.0,0.0,0.0,81.1,73.0],
["4.1.4.7","4",84,"Рыба / Тресковые","Путассу",18.5,0.9,0.0,0.0,0.0,0.0,0.0,79.2,82.0],
["4.1.4.8","4",84,"Рыба / Тресковые","Треска",16.0,0.6,0.0,0.0,0.0,0.0,0.0,82.1,69.0],
["4.1.4.9","4",84,"Рыба / Тресковые","Треска отварная по 1-340",17.9,0.8,0.0,0.0,0.0,0.0,0.0,78.8,79.0],
["4.1.4.10","4",84,"Рыба / Тресковые","Треска припущенная по 1-358",17.0,0.8,0.0,0.0,0.0,0.0,0.0,79.5,75.0],
["4.1.4.11","4",84,"Рыба / Тресковые","Треска тушеная по 1-362",9.7,5.1,3.9,0.9,3.6,0.3,0.3,77.1,101.0],
["4.1.4.12","4",84,"Рыба / Тресковые","Треска запеченная 1-374 по",6.0,3.7,8.0,0.7,0.3,7.7,0.0,79.4,90.0],
["4.1.4.13","4",84,"Рыба / Тресковые","Котлеты из трески 1-380 по",12.6,5.9,15.0,1.2,1.5,13.5,0.0,60.2,164.0],
["4.1.4.14","4",86,"Рыба / Тресковые","Галки ! из трески по 1-388",12.0,1.1,7.3,0.1,2.2,5.1,0.0,76.7,87.0],
["4.1.4.15","4",86,"Рыба / Тресковые","Треска жареная 1-366 по [",16.0,5.1,3.1,0.2,0.0,3.1,0.0,72.1,123.0],
["4.1.4.16","4",86,"Рыба / Тресковые","Солянка рыбная 1-170 по",2.4,1.2,1.2,1.0,1.2,0.0,0.1,93.9,25.0],
["4.1.4.17","4",86,"Рыба / Тресковые","Треска соленая",23.1,0.6,0.0,0.0,0.0,0.0,0.0,60.7,98.0],
["4.1.4.18","4",86,"Рыба / Тресковые","Треска горячего копчения",26.7,1.2,0.0,0.0,0.0,0.0,0.0,69.4,115.0],
["4.1.4.19","4",86,"Рыба / Тресковые","Треска копченая в масле. Консервы",20.8,23.0,0.0,0.0,0.0,0.0,0.0,53.0,290.0],
["4.1.4.20","4",86,"Рыба / Тресковые","Хек",16.6,2.2,0.0,0.0,0.0,0.0,0.0,79.9,86.0],
["4.1.4.21","4",86,"Рыба / Тресковые","Хек припущенный по 1-356",17.8,2.4,0.0,0.0,0.0,0.0,0.0,77.0,91.0],
["4.1.4.22","4",86,"Рыба / Тресковые","Зразы из хека по 1-374",13.1,5.6,9.3,1.3,1.5,7.8,0.0,68.0,140.0],
["4.1.5.1","4",86,"Рыба / Камбаловые","Камбала дальневосточная",15.7,3.0,0.0,0.0,0.0,0.0,0.0,79.7,90.0],
["4.1.5.2","4",86,"Рыба / Камбаловые","Камбала обжаренная в масле. Консервы",14.4,21.8,0.0,0.0,0.0,0.0,0.0,60.4,254.0],
["4.1.5.3","4",86,"Рыба / Камбаловые","Палтус белокорый",18.9,3.0,0.0,0.0,0.0,0.0,0.0,76.9,103.0],
["4.1.6.1","4",88,"Рыба / Лососевые","Горбуша",20.5,6.5,0.0,0.0,0.0,0.0,null,71.8,140.0],
["4.1.6.2","4",88,"Рыба / Лососевые","Горбуша отварная по 1-342",21.8,7.3,0.0,0.0,0.0,0.0,null,68.6,152.0],
["4.1.6.3","4",88,"Рыба / Лососевые","Горбуша соленая",22.1,9.0,0.0,0.0,0.0,0.0,null,54.1,169.0],
["4.1.6.5","4",88,"Рыба / Лососевые","Горбуша натуральная. Консервь",20.9,5.8,0.0,0.0,0.0,0.0,null,70.6,136.0],
["4.1.6.6","4",88,"Рыба / Лососевые","Горбуша в томатном соусе. Консервы",15.0,6.0,4.1,1.0,2.7,1.4,null,70.7,130.0],
["4.1.6.7","4",88,"Рыба / Лососевые","Кета",19.0,5.6,0.0,0.0,0.0,0.0,null,74.2,127.0],
["4.1.6.8","4",88,"Рыба / Лососевые","Кета соленая",24.3,9.6,0.0,0.0,0.0,0.0,null,54.7,184.0],
["4.1.6.9","4",88,"Рыба / Лососевые","Кета натуральная. Консервы",21.5,4.8,0.0,0.0,0.0,0.0,null,70.4,129.0],
["4.1.6.10","4",88,"Рыба / Лососевые","Кижуч",21.6,6.0,0.0,0.0,0.0,0.0,null,71.2,140.0],
["4.1.6.11","4",88,"Рыба / Лососевые","Лосось атлантический (семга)",20.0,8.1,0.0,0.0,0.0,0.0,null,70.6,153.0],
["4.1.6.12","4",88,"Рыба / Лососевые","Семга соленая потрошенная с головой",22.5,12.5,0.0,0.0,0.0,0.0,null,56.5,202.0],
["4.1.6.13","4",88,"Рыба / Лососевые","Нерка красная i",20.3,8.4,0.0,0.0,0.0,0.0,null,70.1,157.0],
["4.1.6.14","4",88,"Рыба / Лососевые","Нерка натуральная. Консервы",19.1,10.5,0.0,0.0,0.0,0.0,null,67.3,171.0],
["4.1.6.15","4",88,"Рыба / Лососевые","Чавыча",19.1,8.0,0.0,0.0,0.0,0.0,null,71.6,148.0],
["4.1.7.1","4",90,"Рыба / Карповые","Вобла",18.0,2.8,0.0,0.0,0.0,0.0,0.0,78.2,95.0],
["4.1.7.2","4",90,"Рыба / Карповые","Вобла холодного копчения",31.1,6.3,0.0,0.0,0.0,0.0,0.0,50.0,181.0],
["4.1.7.3","4",90,"Рыба / Карповые","Карась",17.7,1.8,0.0,0.0,0.0,0.0,0.0,78.9,87.0],
["4.1.7.4","4",90,"Рыба / Карповые","Карп",16.0,5.3,0.0,0.0,0.0,0.0,0.0,77.4,112.0],
["4.1.7.5","4",90,"Рыба / Карповые","Карп жареный по 1-364",18.5,10.5,3.2,0.4,0.0,3.2,0.0,63.5,181.0],
["4.1.7.6","4",90,"Рыба / Карповые","Лещ",17.1,4.4,0.0,0.0,0.0,0.0,0.0,77.4,105.0],
["4.1.7.7","4",90,"Рыба / Карповые","Лещ горячего копчения",32.8,4.5,0.0,0.0,0.0,0.0,0.0,59.9,172.0],
["4.1.7.8","4",90,"Рыба / Карповые","Лещ холодного копчения",29.7,4.6,0.0,0.0,0.0,0.0,0.0,53.3,160.0],
["4.1.7.9","4",90,"Рыба / Карповые","Лещ вяленый",42.0,5.9,0.0,0.0,0.0,0.0,0.0,38.5,221.0],
["4.1.7.10","4",90,"Рыба / Карповые","Лещ в томатном соусе. Консервы",15.3,5.1,4.0,1.0,2.7,1.3,0.4,71.1,124.0],
["4.1.7.11","4",90,"Рыба / Карповые","Сазан",18.2,2.7,0.0,0.0,0.0,0.0,0.0,78.0,97.0],
["4.1.7.12","4",90,"Рыба / Карповые","Сазан в томатном соусе. Консервы",12.4,8.7,3.5,0.8,2.4,1.1,0.5,71.1,143.0],
["4.1.8.1","4",90,"Рыба / Осетровые","Осетр каспийский",16.4,10.9,0.0,0.0,0.0,0.0,0.0,71.4,164.0],
["4.1.8.2","4",90,"Рыба / Осетровые","Осетр жаренный во фритюре 1-372 по",16.0,17.4,13.2,0.8,0.1,13.1,0.0,47.9,273.0],
["4.1.8.3","4",90,"Рыба / Осетровые","Осетр припущенный по 1-350",17.8,11.9,0.0,0.0,0.0,0.0,0.0,67.2,179.0],
["4.1.8.4","4",92,"Рыба / Осетровые","Осетр отварной по 1-344",17.7,12.0,0.0,0.0,0.0,0.0,0.0,68.2,179.0],
["4.1.8.5","4",92,"Рыба / Осетровые","Балык осетровый холодного копчения",20.4,12.5,0.0,0.0,0.0,0.0,0.0,57.2,194.0],
["4.1.8.6","4",92,"Рыба / Осетровые","Теша осетровая холодного копчения",17.6,25.7,0.0,0.0,0.0,0.0,0.0,47.6,302.0],
["4.1.8.8","4",92,"Рыба / Осетровые","Севрюга",16.9,10.3,0.0,0.0,0.0,0.0,0.0,71.6,160.0],
["4.1.8.9","4",92,"Рыба / Осетровые","Севрюга припущенная по 1-350",18.2,11.2,0.0,0.0,0.0,0.0,0.0,67.6,173.0],
["4.1.8.10","4",92,"Рыба / Осетровые","Севрюга в томатном соусе. Консервы",16.0,11.4,2.6,0.6,1.9,0.7,0.4,66.4,178.0],
["4.1.9.1","4",92,"Рыба / Окуневые","Окунь речной",18.5,0.9,0.0,0.0,0.0,0.0,0.0,79.2,82.0],
["4.1.9.2","4",92,"Рыба / Окуневые","Окунь морской",18.2,3.3,0.0,0.0,0.0,0.0,0.0,77.1,103.0],
["4.1.9.3","4",92,"Рыба / Окуневые","Окунь морской отварной 1-338 по",19.9,3.6,0.0,0.0,0.0,0.0,0.0,74.3,112.0],
["4.1.9.4","4",92,"Рыба / Окуневые","Окунь морской тушеный по 1-364",10.9,6.6,4.2,0.8,4.0,0.2,0.1,74.9,120.0],
["4.1.9.5","4",92,"Рыба / Окуневые","Окунь жареный по 1-336",20.6,9.1,4.0,0.3,0.0,4.0,0.0,61.4,180.0],
["4.1.9.6","4",92,"Рыба / Окуневые","Окунь запеченный по 1-374",6.8,4.7,8.4,0.8,0.4,8.0,0.0,76.9,103.0],
["4.1.9.7","4",92,"Рыба / Окуневые","Окунь припущенный по 1-348",19.5,3.5,0.0,0.0,0.0,0.0,0.0,73.7,109.0],
["4.1.9.8","4",94,"Рыба / Окуневые","Окунь фаршированный по 1-360",14.9,6.1,3.9,0.3,2.3,1.6,0.0,71.1,130.0],
["4.1.9.9","4",94,"Рыба / Окуневые","Шницель рыбный из окуня 1-380 по",17.6,12.5,8.1,1.0,1.7,6.4,0.0,55.5,215.0],
["4.1.9.10","4",94,"Рыба / Окуневые","Окунь горячего копчения",23.5,8.0,0.0,0.0,0.0,0.0,0.0,64.8,166.0],
["4.1.9.11","4",94,"Рыба / Окуневые","Салат рыбный из окуня 1-80 по",4.7,15.7,5.5,0.6,1.7,3.8,0.1,72.1,182.0],
["4.1.9.12","4",94,"Рыба / Окуневые","Судак",18.4,1.1,0.0,0.0,0.0,0.0,0.0,79.2,84.0],
["4.1.9.13","4",94,"Рыба / Окуневые","Судак отварной 1-342 по",20.5,1.2,0.0,0.0,0.0,0.0,0.0,74.7,96.0],
["4.1.9.14","4",94,"Рыба / Окуневые","Судак припущенный 1-346 по",19.6,1.2,0.0,0.0,0.0,0.0,0.0,76.5,89.0],
["4.1.9.15","4",94,"Рыба / Окуневые","Судак фаршированный по 1-362",13.7,6.0,8.7,0.7,2.3,6.4,0.1,66.4,144.0],
["4.1.9.16","4",94,"Рыба / Окуневые","Зразы из судака по 1-382",12.1,7.4,12.1,1.4,2.1,10.0,0.1,62.1,164.0],
["4.1.9.17","4",94,"Рыба / Окуневые","Судак в томатном соусе. Консервы",14.0,5.3,3.1,0.6,2.0,1.1,0.4,74.2,119.0],
["4.1.10.1","4",94,"Рыба / Тунцовые","Тунец",24.4,4.6,0.0,0.0,0.0,0.0,0.0,69.3,139.0],
["4.1.10.2","4",94,"Рыба / Тунцовые","Тунец натуральный. Консервы",22.5,0.7,0.0,0.0,0.0,0.0,0.0,74.0,96.0],
["4.1.10.3","4",94,"Рыба / Тунцовые","Тунец в масле. Консервы",22.0,15.9,0.0,0.0,0.0,0.0,0.0,59.6,232.0],
["4.1.11.1","4",96,"Рыба / Зубатковые","Зубатка пестрая",19.6,5.3,0.0,0.0,0.0,0.0,0.0,74.0,126.0],
["4.1.11.2","4",96,"Рыба / Зубатковые","Зубатка отварная 1-342 по",19.0,5.1,0.0,0.0,0.0,0.0,0.0,72.8,122.0],
["4.1.11.3","4",96,"Рыба / Зубатковые","Зубатка жареная по 1-364",22.2,11.5,4.1,0.3,0.0,4.1,0.0,57.4,209.0],
["4.1.11.4","4",96,"Рыба / Зубатковые","Зубатка, запеченная в сметанном соусе по 1-376",7.4,8.8,6.8,0.6,0.5,6.3,0.2,74.3,137.0],
["4.1.12.1","4",96,"Рыба / Корюшковые","Мойва весенняя",13.1,7.1,0.0,0.0,0.0,0.0,0.0,78.4,116.0],
["4.1.12.2","4",96,"Рыба / Корюшковые","Мойва осенняя",13.6,18.1,0.0,0.0,0.0,0.0,0.0,66.9,217.0],
["4.1.13.1","4",96,"Рыба / Другие виды рыб","Пеламида",22.4,14.2,0.0,0.0,0.0,0.0,0.0,62.4,217.0],
["4.1.13.2","4",96,"Рыба / Другие виды рыб","Сом",17.2,5.1,0.0,0.0,0.0,0.0,0.0,76.7,115.0],
["4.1.13.3","4",96,"Рыба / Другие виды рыб","Сом припущенный 1-346 по",18.2,5.4,0.0,0.0,0.0,0.0,0.0,73.6,121.0],
["4.1.13.4","4",96,"Рыба / Другие виды рыб","Сом в томатном соусе. Консервы",12.9,6.3,4.0,0.8,2.7,1.3,0.4,72.4,126.0],
["4.1.13.5","4",96,"Рыба / Другие виды рыб","Угорь",14.5,30.5,0.0,0.0,0.0,0.0,0.0,54.0,333.0],
["4.1.13.6","4",96,"Рыба / Другие виды рыб","Щука",18.4,1.1,0.0,0.0,0.0,0.0,0.0,79.3,84.0],
["4.1.13.7","4",96,"Рыба / Другие виды рыб","Щука отварная по 1-340",21.3,1.3,0.0,0.0,0.0,0.0,0.0,74.9,98.0],
["4.1.13.8","4",96,"Рыба / Другие виды рыб","Щука припущенная 1-348 по",19.6,1.2,0.0,0.0,0.0,0.0,0.0,76.6,90.0],
["4.1.13.10","4",96,"Рыба / Другие виды рыб","Щука в томатном соусе. Консервы",14.2,4.0,3.1,0.5,2.0,1.1,0.4,74.7,110.0],
["4.2.1","4",98,"Печень рыб","Печень трески. Консервы",4.2,65.7,1.2,0.0,1.2,0.0,0.2,26.4,613.0],
["4.3.1","4",98,"Соленая продукция","Белужья зернистая",26.8,13.8,0.8,0.0,0.0,0.0,0.0,54.2,235.0],
["4.3.2","4",98,"Соленая продукция","Горбуши зернистая",30.6,11.5,1.0,0.0,0.0,0.0,0.0,49.7,230.0],
["4.3.3","4",98,"Соленая продукция","Кеты зернистая",31.5,13.2,1.0,0.0,0.0,0.0,0.0,46.9,249.0],
["4.3.4","4",98,"Соленая продукция","Минтаевая пробойная",27.9,1.8,1.1,0.0,0.0,0.0,0.0,62.8,132.0],
["4.3.5","4",98,"Соленая продукция","Осетровая зернистая",28.4,9.3,0.6,0.0,0.0,0.0,0.0,56.5,200.0],
["4.3.6","4",98,"Соленая продукция","Осетровая паюсная",38.2,14.5,1.5,0.0,0.0,0.0,0.0,39.5,289.0],
["4.3.7","4",98,"Соленая продукция","Севрюжья зернистая",28.2,11.7,0.7,0.0,0.0,0.0,0.0,54.0,221.0],
["4.4.1","4",100,"Ракообразные","камчатский Краб (мясо)",18.2,1.0,0.0,0.0,0.0,0.0,0.0,78.9,82.0],
["4.4.2","4",100,"Ракообразные","Крабы натуральные. Консервь",18.7,1.1,0.0,0.0,0.0,0.0,0.0,78.2,85.0],
["4.4.3","4",100,"Ракообразные","Креветка дальневосточная (мясо)",18.3,1.2,0.8,0.0,0.0,0.0,0.0,78.2,87.0],
["4.4.4","4",100,"Ракообразные","Креветка антарктическая (мясо) варено-мороженая",20.5,1.6,0.3,0.0,0.0,0.0,0.0,75.3,98.0],
["4.4.5","4",100,"Ракообразные","Креветка антарктическая натуральная. Консервы",17.7,1.1,0.3,0.0,0.0,0.0,0.0,78.7,82.0],
["4.4.6","4",100,"Ракообразные","Раки речные",15.5,1.0,1.2,0.0,0.0,0.0,0.0,81.0,76.0],
["4.4.7","4",100,"Ракообразные","Раки речные вареные",20.3,1.3,1.0,0.0,0.0,0.0,0.0,75.5,97.0],
["4.4.8","4",100,"Ракообразные","Раки морские (лангуст, омар)",18.8,1.3,0.5,0.0,0.0,0.0,0.0,77.2,89.0],
["4.4.9","4",100,"Ракообразные","Раки морские вареные",20.5,0.7,0.3,0.0,0.0,0.0,0.0,76.0,90.0],
["4.5.1","4",100,"Моллюски","Кальмар (мясо)",18.0,2.2,2.0,0.0,0.0,0.0,0.0,76.4,100.0],
["4.5.2","4",100,"Моллюски","Мидии",11.5,2.0,3.3,0.0,0.0,0.0,0.0,82.0,77.0],
["4.5.3","4",100,"Моллюски","Устрица",9.0,2.0,4.5,0.0,0.0,0.0,0.0,82.7,72.0],
["4.6.1","4",100,"Млекопитающие","Китовое мясо",22.5,3.2,0.0,0.0,0.0,0.0,0.0,73.1,119.0],
["4.6.2","4",100,"Млекопитающие","Мясо ластоногих",24.5,1.7,0.0,0.0,0.0,0.0,0.0,72.6,113.0],
["5.1.1","5",102,"Молочный жир","Масло сладко-сливочное несоленое",0.5,82.5,0.8,null,0.8,null,null,16.0,748.0],
["5.1.2","5",102,"Молочный жир","Масло сладко-сливочное «Вологодское»",0.5,82.5,0.8,null,0.8,null,null,16.0,748.0],
["5.1.3","5",102,"Молочный жир","Масло сладко-сливочное несоленое «Любительское»",0.0,78.0,1.0,null,1.0,null,null,20.0,709.0],
["5.1.4","5",102,"Молочный жир","Масло сладко-сливочное соленое «Любительское»",0.7,77.0,1.0,null,1.0,null,null,20.0,700.0],
["5.1.5","5",102,"Молочный жир","Масло сливочное несоленое «Крестьянское»",0.8,72.5,1.3,null,1.3,null,null,25.0,661.0],
["5.1.6","5",102,"Молочный жир","Масло сливочное соленое «Крестьянское»",0.8,71.5,1.3,null,1.3,null,null,25.0,647.0],
["5.1.7","5",102,"Молочный жир","Масло сладко-сливочное «Бутербродное»",1.3,61.5,1.7,null,1.7,null,null,35.0,566.0],
["5.1.8","5",102,"Молочный жир","Масло топленое",0.2,99.0,0.0,null,0.0,null,null,0.7,892.0],
["5.2.1","5",102,"Животные жиры","Жир бараний топленый",0.0,99.7,0.0,null,0.0,null,null,0.3,897.0],
["5.2.2","5",102,"Животные жиры","Жир говяжий топленый",0.0,99.6,0.0,null,0.0,null,null,0.3,896.0],
["5.2.3","5",102,"Животные жиры","Жир костный топленый",0.0,99.7,0.0,null,0.0,null,null,0.3,897.0],
["5.2.4","5",102,"Животные жиры","свиной Жир топленый",0.0,99.6,0.0,null,0.0,null,null,0.3,896.0],
["5.2.5","5",104,"Животные жиры","Шпик свиной",1.4,92.8,0.0,null,0.0,null,null,5.7,841.0],
["5.2.6","5",104,"Животные жиры","Шпик свиной соленый",1.4,90.0,0.0,null,0.0,null,null,5.5,816.0],
["5.2.7","5",104,"Животные жиры","Жир куриный",0.0,99.7,0.0,null,0.0,null,null,0.2,897.0],
["5.3.1","5",104,"Жиры рыб","Жир из печени трески",0.0,99.8,0.0,null,0.0,null,null,0.2,898.0],
["5.4.1","5",104,"Растительные масла","Масло арахисовое",0.0,99.9,0.0,null,0.0,null,null,0.1,899.0],
["5.4.2","5",104,"Растительные масла","Масло горчичное",0.0,99.8,0.0,null,0.0,null,null,0.2,898.0],
["5.4.3","5",104,"Растительные масла","Масло какао",0.0,99.9,0.0,null,0.0,null,null,0.1,899.0],
["5.4.4","5",104,"Растительные масла","Масло какаовелла",0.0,99.8,0.0,null,0.0,null,null,0.2,898.0],
["5.4.5","5",104,"Растительные масла","Масло канолы",0.0,99.9,0.0,null,0.0,null,null,0.1,899.0],
["5.4.6","5",104,"Растительные масла","Масло кокосовое",0.0,99.9,0.0,null,0.0,null,null,0.1,899.0],
["5.4.7","5",104,"Растительные масла","Масло конопляное",0.0,99.9,0.0,null,0.0,null,null,0.1,899.0],
["5.4.8","5",104,"Растительные масла","Масло кукурузное",0.0,99.9,0.0,null,0.0,null,null,0.1,899.0],
["5.4.9","5",106,"Растительные масла","Масло кунжутное",0.0,99.9,0.0,null,0.0,null,null,0.1,899.0],
["5.4.10","5",106,"Растительные масла","Масло льняное",0.0,99.8,0.0,null,0.0,null,null,0.2,898.0],
["5.4.11","5",106,"Растительные масла","Масло оливковое",0.0,99.8,0.0,null,0.0,null,null,0.2,898.0],
["5.4.12","5",106,"Растительные масла","Масло пальмовое",0.0,99.9,0.0,null,0.0,null,null,0.1,899.0],
["5.4.13","5",106,"Растительные масла","Масло подсолнечное",0.0,99.9,0.0,null,0.0,null,null,0.1,899.0],
["5.4.14","5",106,"Растительные масла","Масло рапсовое",0.0,99.9,0.0,null,0.0,null,null,0.1,899.0],
["5.4.15","5",106,"Растительные масла","Масло соевое",0.0,99.9,0.0,null,0.0,null,null,0.1,899.0],
["5.5.1","5",106,"Маргарины","Маргарин «Здоровье»",0.5,82.0,0.7,null,0.7,null,null,16.5,743.0],
["5.5.2","5",106,"Маргарины","Маргарин низкокалорийный 60% жирности",0.5,60.0,0.7,null,0.7,null,null,38.4,545.0],
["5.5.3","5",106,"Маргарины","молочный Маргарин столовый",0.3,82.0,1.0,null,1.0,null,null,16.2,743.0],
["5.5.4","5",106,"Маргарины","Маргарин сливочный",0.3,82.0,1.0,null,1.0,null,null,16.2,743.0],
["5.5.5","5",106,"Маргарины","Маргарин «Экстра»",0.5,82.0,1.0,null,1.0,null,null,16.0,744.0],
["5.6.1","5",106,"Жиры кулинарные","Жир кулинарный «Белорусский»",0.0,99.7,0.0,null,0.0,null,null,0.3,897.0],
["5.6.2","5",106,"Жиры кулинарные","Жир кулинарный «Восточный»",0.0,99.7,0.0,null,0.0,null,null,0.3,897.0],
["5.6.3","5",108,"Жиры кулинарные","Жир кулинарный «Новинка»",0.0,99.7,0.0,null,0.0,null,null,0.3,897.0],
["5.6.4","5",108,"Жиры кулинарные","Жир кулинарный «Украинский»",0.0,99.7,0.0,null,0.0,null,null,0.3,897.0],
["5.7.1","5",108,"Жиры кондитерские","Жир кондитерский твердый",0.0,99.8,0.0,null,0.0,null,null,0.2,898.0],
["5.7.2","5",108,"Жиры кондитерские","Жир кондитерский для изделий шоколадных",0.0,99.7,0.0,null,0.0,null,null,0.3,897.0],
["5.8.1","5",108,"Майонезы","Майонез «Провансаль»",2.8,67.0,3.7,null,3.7,null,null,25.0,629.0],
["5.8.2","5",108,"Майонезы","Майонез столовый молочный",2.4,67.0,3.9,null,3.9,null,null,25.0,627.0],
["6.1.1.1","6",110,"Пшеница / Зерно","Зерно твердой пшеницы",13.0,2.5,57.5,11.3,2.0,54.5,0.0,14.0,304.0],
["6.1.1.2","6",110,"Пшеница / Зерно","Зерно мягкой пшеницы",11.8,2.2,59.5,10.8,2.5,55.5,0.0,14.0,305.0],
["6.1.2.1","6",110,"Пшеница / Изделия из зерна твердой пшеницы","Мука высшего сорта",10.8,1.3,69.9,3.5,1.0,67.9,0.0,14.0,334.0],
["6.1.2.1.1","6",110,"Пшеница / Изделия из зерна твердой пшеницы / Мука высшего сорта","Макароны из в/с муки",11.0,1.3,70.5,3.7,2.0,67.7,0.0,13.0,338.0],
["6.1.2.1.2","6",110,"Пшеница / Изделия из зерна твердой пшеницы / Мука высшего сорта","Макароны яичные",11.3,2.1,69.6,3.4,2.0,67.0,0.0,13.0,342.0],
["6.1.2.1.3","6",110,"Пшеница / Изделия из зерна твердой пшеницы / Мука высшего сорта","Макароны отварные по 1-302",3.6,0.4,20.0,1.2,0.7,19.3,0.0,74.2,98.0],
["6.1.2.1.4","6",110,"Пшеница / Изделия из зерна твердой пшеницы / Мука высшего сорта","Макароны отварные с жиром по 1-304",3.4,5.0,19.0,1.1,0.7,18.3,0.0,70.9,135.0],
["6.1.2.1.5","6",110,"Пшеница / Изделия из зерна твердой пшеницы / Мука высшего сорта","Макароны, запеченные с яйцом по 1-306",4.6,8.3,14.8,0.9,1.5,13.3,0.0,70.5,152.0],
["6.1.2.1.6","6",110,"Пшеница / Изделия из зерна твердой пшеницы / Мука высшего сорта","Лапша домашняя 2-198 по",12.0,3.7,60.1,3.2,0.3,59.8,0.0,18.0,322.0],
["6.1.2.1.7","6",110,"Пшеница / Изделия из зерна твердой пшеницы / Мука высшего сорта","Лапшевник с творогом по 1-308",7.7,7.4,20.3,0.7,4.4,15.9,0.4,62.3,180.0],
["6.1.2.2","6",110,"Пшеница / Изделия из зерна твердой пшеницы","Мука 1 сорта",11.1,1.5,67.8,4.9,1.2,66.1,0.0,14.0,329.0],
["6.1.2.2.1","6",110,"Пшеница / Изделия из зерна твердой пшеницы / Мука 1 сорта","1 Макароны из муки сорта",11.2,1.6,68.4,5.1,2.3,65.7,0.0,13.0,333.0],
["6.1.3.1","6",110,"Пшеница / Изделия из зерна мягкой пшеницы","Мука высшего сорта",10.3,1.1,70.6,3.5,1.6,68.5,0.0,14.0,334.0],
["6.1.3.2.1","6",110,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки высшего сорта","Хлеб пшеничный формовой",7.6,0.8,49.2,2.6,0.7,48.5,0.3,37.8,235.0],
["6.1.3.2.2","6",110,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки высшего сорта","Батон нарезной",7.5,2.9,51.4,2.5,2.9,48.5,0.2,34.0,262.0],
["6.1.3.2.3","6",110,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки высшего сорта","Булки городские",7.7,2.4,52.9,2.6,2.9,50.0,0.2,32.7,265.0],
["6.1.3.2.4","6",110,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки высшего сорта","Булочки молочные",8.8,2.2,50.3,2.6,2.0,48.3,0.3,34.3,257.0],
["6.1.3.2.5","6",110,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки высшего сорта","Булочки сдобные",7.9,9.4,55.5,2.1,15.9,39.6,0.2,23.7,339.0],
["6.1.32.6","6",112,"Пшеница","Булочки столичные",8.4,2.2,53.7,2.8,1.5,52.2,0.2,31.1,269.0],
["6.1.3.2.7","6",112,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки высшего сорта","Булочки столичная с молочной сывороткой",8.4,2.2,53.7,2.7,1.8,51.9,0.2,31.1,269.0],
["6.1.3.2.8","6",112,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки высшего сорта","Рожки к чаю",8.4,5.6,56.8,2.5,9.6,47.2,0.2,25.2,312.0],
["6.1.3.2.9","6",112,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки высшего сорта","Баранки сдобные",8.3,8.0,60.4,2.8,6.4,54.0,0.3,18.6,348.0],
["6.1.3.2.10","6",112,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки высшего сорта","Сушки простые",10.7,1.2,71.2,3.6,1.0,70.2,0.2,11.0,339.0],
["6.1.3.2.11","6",112,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки высшего сорта","Сухари сливочные",8.5,10.8,66.7,2.8,15.6,51.1,0.3,9.6,399.0],
["6.1.3.2.12","6",112,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки высшего сорта","Галеты",9.7,10.2,65.6,3.2,0.7,64.9,0.0,9.5,393.0],
["6.1.3.2.13","6",112,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки высшего сорта","Печенье затяжное",8.5,11.3,69.7,2.7,15.4,54.3,0.0,6.5,414.0],
["6.1.3.2.14","6",112,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки высшего сорта","Печенье миндальное",7.6,13.6,67.4,5.3,60.1,7.3,0.0,5.0,422.0],
["6.1.3.2.15","6",112,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки высшего сорта","Печенье сахарное",7.5,9.8,74.4,2.3,23.6,50.8,0.5,4.5,417.0],
["6.1.3.2.16","6",112,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки высшего сорта","Печенье сдобное",6.4,16.8,68.5,1.8,34.1,34.4,0.0,6.0,451.0],
["6.1.3.2.17","6",112,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки высшего сорта","Пряники заварные",5.9,4.7,75.0,2.1,36.2,38.8,0.0,12.0,366.0],
["6.1.3.2.18","6",112,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки высшего сорта","Пряники сырцовые",6.3,2.1,75.6,2.2,34.6,41.0,0.0,13.5,346.0],
["6.1.3.3.1","6",114,"Пшеница / Изделия из зерна мягкой пшеницы / Кулинарнь изделия из муки высшего сорта","Ватрушка по 2-194",11.9,6.4,37.5,1.4,5.0,32.5,0.3,41.3,256.0],
["6.1.3.3.2","6",114,"Пшеница / Изделия из зерна мягкой пшеницы / Кулинарнь изделия из муки высшего сорта","Клецки по 2-196",4.1,4.1,19.4,1.1,0.5,18.9,0.0,70.7,131.0],
["6.1.3.3.3","6",114,"Пшеница / Изделия из зерна мягкой пшеницы / Кулинарнь изделия из муки высшего сорта","Кулебяка с рыбой и по 2-196 рисом",10.5,4.1,31.8,1.6,2.5,29.3,0.0,50.4,206.0],
["6.1.3.4","6",114,"Пшеница / Изделия из зерна мягкой пшеницы","Мука 1 сорта",10.6,1.3,69.0,4.4,1.8,66.7,0.0,14.0,330.0],
["6.1.3.5.1","6",114,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки сорта","Хлеб пшеничный подовый",7.9,1.0,48.3,3.3,2.1,46.2,0.3,37.7,235.0],
["6.1.3.5.2","6",114,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки сорта","Хлеб паляница",8.3,1.0,49.9,3.4,2.1,47.8,0.3,35.4,243.0],
["6.1.3.5.3","6",114,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки сорта","Батон простой",8.0,1.0,49.1,3.3,1.6,47.5,0.3,36.6,238.0],
["6.1.3.5.4","6",114,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки сорта","Батон нарезной",7.7,3.0,50.1,3.2,3.3,46.8,0.3,34.1,259.0],
["6.1.3.5.5","6",114,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки сорта","Булка ярославская",7.6,5.3,53.7,3.1,7.5,46.2,0.3,28.8,294.0],
["6.1.3.5.6","6",114,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки сорта","Булочка повышенной калорийности",7.6,10.0,53.8,3.3,22.8,31.0,0.4,23.2,337.0],
["6.1.3.5.7","6",114,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки сорта","Сдоба обыкновенная",8.1,5.3,54.9,3.2,7.7,47.2,0.2,26.6,301.0],
["6.1.3.5.8","6",114,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки сорта","Баранки простые",10.4,1.3,64.2,4.6,2.0,62.2,0.3,17.0,311.0],
["6.1.3.5.9","6",114,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки сорта","Бублики простые",9.1,1.1,57.1,4.5,1.8,55.3,0.3,26.0,276.0],
["6.1.3.5.10","6",114,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки сорта","Сушки простые",10.9,1.3,68.8,4.5,2.4,66.4,0.2,12.0,331.0],
["6.1.3.5.11","6",114,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки сорта","Соломка сладкая",9.1,6.1,69.3,4.0,13.9,55.4,0.2,10.0,372.0],
["6.1.3.5.12","6",116,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки сорта","Сухари армейские",11.2,1.4,67.5,5.1,2.5,65.0,0.7,12.0,330.0],
["6.1.3.5.13","6",116,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки сорта","Галеты",11.0,1.4,69.5,4.8,3.3,66.2,0.0,11.0,345.0],
["6.1.3.5.14","6",116,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки сорта","Печенье сахарное",7.4,9.4,73.1,3.9,25.8,47.3,0.0,5.0,407.0],
["6.1.3.5.15","6",116,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки сорта","Печенье затяжное",7.7,9.1,70.9,4.3,18.3,52.6,0.0,7.0,396.0],
["6.1.3.6.2","6",116,"Пшеница / Изделия из зерна мягкой пшеницы / Кулинарные изделия из муки сорта","Вареники по 2-174",12.0,6.4,16.2,1.3,4.3,11.9,0.6,62.1,172.0],
["6.1.3.6.3","6",116,"Пшеница / Изделия из зерна мягкой пшеницы / Кулинарные изделия из муки сорта","Галушки по 1-126",3.9,1.0,20.3,1.5,0.6,19.7,0.0,71.8,106.0],
["6.1.3.6.4","6",116,"Пшеница / Изделия из зерна мягкой пшеницы / Кулинарные изделия из муки сорта","Оладьи 2-176 по",6.5,6.6,31.6,2.5,5.4,26.2,0.3,50.7,213.0],
["6.1.3.6.5","6",116,"Пшеница / Изделия из зерна мягкой пшеницы / Кулинарные изделия из муки сорта","Пампушки с чесноком по 1-124",8.6,3.3,58.8,3.5,6.3,52.5,0.0,25.2,299.0],
["6.1.3.6.6","6",116,"Пшеница / Изделия из зерна мягкой пшеницы / Кулинарные изделия из муки сорта","Пирожки жареные с капустой по 2-188",5.0,10.5,28.8,2.4,4.4,24.4,0.1,51.6,230.0],
["6.1.3.6.7","6",116,"Пшеница / Изделия из зерна мягкой пшеницы / Кулинарные изделия из муки сорта","Пирожки печеные простые по 2-188",12.7,7.3,33.2,2.2,3.6,29.6,0.3,42.7,250.0],
["6.1.3.7","6",116,"Пшеница / Изделия из зерна мягкой пшеницы","2 Мука сорта",11.6,1.8,64.8,6.7,2.2,62.0,0.0,14.0,322.0],
["6.1.3.8.1","6",116,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки сорта","Хлеб подовый",8.6,1.3,45.2,4.6,2.5,42.7,0.3,38.2,228.0],
["6.1.3.8.2","6",116,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из муки сорта","Сухари армейские",12.3,1.9,63.5,7.0,3.1,60.4,0.8,12.0,323.0],
["6.1.3.9","6",116,"Пшеница / Изделия из зерна мягкой пшеницы","Мука обойная",11.5,2.2,61.5,9.3,2.3,58.5,0.0,14.0,312.0],
["6.1.3.10.1","6",118,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из обойной муки","Хлеб подовый",8.0,1.5,40.1,6.8,2.4,37.7,0.6,41.0,208.0],
["6.1.3.10.2","6",118,"Пшеница / Изделия из зерна мягкой пшеницы / Хлебобулочные изделия из обойной муки","Сухари армейские",12.3,2.3,60.1,10.0,3.2,56.9,1.3,11.0,304.0],
["6.1.3.11.1","6",118,"Пшеница / Изделия из зерна мягкой пшеницы / Крупа","Крупа «Артек»",11.0,1.2,68.5,4.6,1.8,66.2,0.0,14.0,329.0],
["6.1.3.11.2","6",118,"Пшеница / Изделия из зерна мягкой пшеницы / Крупа","Крупа манная",10.3,1.0,70.6,3.6,1.6,68.5,0.0,14.0,333.0],
["6.1.3.11.3","6",118,"Пшеница / Изделия из зерна мягкой пшеницы / Крупа","«Полтавская» Крупа",11.5,1.3,67.9,4.4,2.0,66.5,0.0,14.0,329.0],
["6.1.3.12.1","6",118,"Пшеница / Изделия из зерна мягкой пшеницы / Кулинарные изделия","Каша манная вязкая по 1-276",2.2,2.9,16.4,0.8,2.2,14.2,0.0,76.6,100.0],
["6.1.3.12.2","6",118,"Пшеница / Изделия из зерна мягкой пшеницы / Кулинарные изделия","Каша пшеничная из рассыпчатая крупы «Полтавская» 1-272 по",4.4,3.6,25.7,1.7,0.9,24.8,0.0,63.3,153.0],
["6.1.3.12.3","6",118,"Пшеница / Изделия из зерна мягкой пшеницы / Кулинарные изделия","Котлеты манные по 1-294",3.0,5.3,20.2,1.1,4.1,16.1,0.1,68.9,141.0],
["6.2.1.1","6",118,"Хлебобулочные комбинированные изделия / На основе пшеницы","Хлеб зерновой в/с (мука и зерно дробленое)",8.6,1.4,45.1,6.1,2.1,43.0,0.3,37.0,228.0],
["6.2.1.2","6",118,"Хлебобулочные комбинированные изделия / На основе пшеницы","Хлебцы докторские (мука в/с и отруби пшеничные)",8.2,2.6,46.3,7.5,3.6,42.7,0.3,33.3,242.0],
["6.2.1.3","6",118,"Хлебобулочные комбинированные изделия / На основе пшеницы","Хлеб соловецкий (мука 1 и 2 сорта)",8.3,1.2,47.9,4.1,2.7,45.2,0.4,36.0,237.0],
["6.2.1.4","6",118,"Хлебобулочные комбинированные изделия / На основе пшеницы","Крекеры с отрубями",9.2,14.1,63.2,4.0,1.0,62.2,0.0,8.0,416.0],
["6.2.1.5","6",118,"Хлебобулочные комбинированные изделия / На основе пшеницы","Пластинки из цельномолотой пшеницы",12.7,2.4,67.3,11.4,4.0,62.7,0.0,3.5,342.0],
["6.2.2.1","6",118,"Хлебобулочные комбинированные изделия / На основе пшеницы ржи","Хлеб бородинский обойная (мука ржаная и 2 пшеничная сорта)",6.8,1.3,39.8,7.9,5.1,34.7,0.9,41.6,201.0],
["6.2.2.2","6",118,"Хлебобулочные комбинированные изделия / На основе пшеницы ржи","Хлеб рижский (мука ржаная сеяная 1 и пшеничная сорта)",5.6,1.1,49.4,8.0,2.4,47.0,0.6,33.6,232.0],
["6.2.2.3","6",120,"Хлебобулочные комбинированные изделия / На основе пшеницы ржи","Хлеб украинский (мука ржаная обдирная и пшеничная обойная)",6.6,1.2,39.6,8.0,1.7,37.9,0.9,41.8,198.0],
["6.3.1","6",120,"Рожь","Зерно продовольственное",9.9,2.2,55.8,16.4,1.5,54.0,0.0,14.0,283.0],
["6.3.2","6",120,"Рожь","Мука сеяная",6.9,1.4,66.3,10.8,0.7,65.3,0.0,14.0,305.0],
["6.3.3","6",120,"Рожь","Мука обдирная",8.9,1.7,61.8,12.4,0.9,60.7,0.0,14.0,298.0],
["6.3.4","6",120,"Рожь","обойная Мука",10.7,1.9,58.5,13.3,1.1,57.2,0.0,14.0,294.0],
["6.3.5.1","6",120,"Рожь / Хлебобулочные изделия","Хлеб подовый (из сеяной муки)",4.9,1.0,44.8,7.7,1.1,43.7,0.6,39.5,210.0],
["6.3.5.2","6",120,"Рожь / Хлебобулочные изделия","Хлеб подовый (из обдирной муки)",6.1,1.2,39.9,8.5,1.4,38.5,0.8,41.6,197.0],
["6.3.5.3","6",120,"Рожь / Хлебобулочные изделия","Хлеб формовой обойной (из муки)",6.6,1.2,33.4,8.3,1.2,32.2,1.0,47.0,174.0],
["6.3.5.4","6",120,"Рожь / Хлебобулочные изделия","Сухари армейские обойной (из муки)",11.3,2.0,56.4,14.1,2.1,54.3,1.9,11.0,294.0],
["6.4.1","6",120,"Овес","Зерно продовольственное",10.0,6.2,55.1,12.0,1.1,53.7,0.0,13.5,316.0],
["6.4.2","6",120,"Овес","Мука диетическая",13.0,6.8,64.9,4.5,1.0,63.5,0.0,9.0,369.0],
["6.4.3","6",120,"Овес","Толокно",12.5,6.0,64.9,4.8,1.5,62.9,0.0,10.0,363.0],
["6.4.4","6",120,"Овес","Крупа овсяная",12.3,6.1,59.5,8.0,0.9,58.2,0.0,12.0,342.0],
["6.4.5","6",120,"Овес","Хлопья «Геркулес»",12.3,6.2,61.8,6.0,1.2,60.1,0.0,12.0,352.0],
["6.4.6.1","6",120,"Овес / Кулинарные изделия","Каша овсяная по 1-280",2.6,4.1,15.5,1.9,1.2,14.3,0.0,74.4,109.0],
["6.4.6.2","6",120,"Овес / Кулинарные изделия","Каша из хлопьев «Геркулес» по 1-280",2.4,4.0,14.8,1.3,1.2,13.6,0.0,76.2,105.0],
["6.5.1","6",120,"Рис","Зерно продовольственное",7.5,2.6,62.3,9.7,0.9,61.4,0.0,14.0,303.0],
["6.5.2","6",120,"Рис","Мука диетическая",7.4,0.6,80.2,2.3,0.7,79.1,0.0,9.0,356.0],
["6.5.3","6",120,"Рис","Крупа рисовая",7.0,1.0,74.0,3.0,0.7,72.9,0.0,14.0,333.0],
["6.5.4.1","6",120,"Рис / Кулинарные изделия из риса","Суп рисовый по 1-158",0.9,1.1,6.2,0.4,0.8,5.4,0.0,90.2,38.0],
["6.5.4.2","6",122,"Рис / Кулинарные изделия из риса","Суп-пюре из рисовой крупы по 1-186",1.4,1.3,7.7,0.4,1.1,6.6,0.0,88.0,48.0],
["6.5.4.3","6",122,"Рис / Кулинарные изделия из риса","Суп харчо с мясом 1-164 по",3.1,4.5,5.5,0.4,1.3,4.2,0.1,85.3,75.0],
["6.5.4.4","6",122,"Рис / Кулинарные изделия из риса","Запеканка рисовая по 1-288",4.0,5.6,19.4,0.8,4.0,15.4,0.0,68.8,144.0],
["6.5.4.5","6",122,"Рис / Кулинарные изделия из риса","Запеканка рисовая с творогом 1-288 по",5.1,7.1,26.1,1.0,6.1,20.0,0.2,59.2,189.0],
["6.5.4.6","6",122,"Рис / Кулинарные изделия из риса","Каша рисовая 1-268 по",2.4,3.5,25.8,1.0,0.3,25.5,0.0,66.1,144.0],
["6.5.4.7","6",122,"Рис / Кулинарные изделия из риса","Пудинг рисовый 1-292 по",5.6,5.7,32.0,0.9,16.2,15.8,0.1,54.4,202.0],
["6.6.1","6",122,"Гречиха","Зерно продовольственное",10.8,3.2,56.0,14.0,1.5,54.1,0.0,14.0,296.0],
["6.6.2","6",122,"Гречиха","Мука диетическая",13.6,1.2,71.9,2.8,1.4,70.2,0.0,9.0,353.0],
["6.6.3","6",122,"Гречиха","Крупа продел",9.5,2.3,60.4,12.5,1.1,59.0,0.0,14.0,300.0],
["6.6.4","6",122,"Гречиха","Крупа ядрица",12.6,3.3,57.1,11.3,1.4,55.4,0.0,14.0,308.0],
["6.6.5.1","6",122,"Гречиха / Кулинарные изделия","Каша гречневая из крупы ядрица по 1-278",3.0,3.4,14.6,2.7,1.3,13.3,0.0,74.9,101.0],
["6.6.5.2","6",122,"Гречиха / Кулинарные изделия","Крупеник 1-288 по",8.8,8.8,21.1,3.6,4.7,16.4,0.3,55.9,199.0],
["6.7.1","6",122,"Ячмень","Зерно продовольственное",10.3,2.4,56.4,14.5,1.3,54.6,0.0,14.0,288.0],
["6.7.2","6",122,"Ячмень","Крупа перловая",9.3,1.1,66.9,7.8,0.9,65.7,0.0,14.0,315.0],
["6.7.3","6",122,"Ячмень","Крупа ячневая",10.0,1.3,65.4,8.1,1.1,63.8,0.0,14.0,313.0],
["6.7.4.1","6",122,"Ячмень / Кулинарные изделия","Суп перловый с грибами по 1-164",1.6,1.2,6.4,1.5,1.3,5.1,0.0,88.2,43.0],
["6.7.4.2","6",124,"Ячмень / Кулинарные изделия","Биточки перловые 1-294 с творогом по",7.9,6.4,18.9,1.9,4.0,14.9,0.3,63.4,166.0],
["6.7.4.3","6",124,"Ячмень / Кулинарные изделия","Каша перловая по 1-270",2.9,3.5,22.9,2.5,0.3,22.6,0.0,67.0,135.0],
["6.7.4.4","6",124,"Ячмень / Кулинарные изделия","Каша ячневая по 1-278",2.1,2.9,15.3,1.9,1.2,14.1,0.0,76.6,96.0],
["6.8.1","6",124,"Просо","Зерно продовольственное",11.2,3.9,54.6,13.9,1.9,52.4,0.0,13.5,298.0],
["6.8.2","6",124,"Просо","пшено Крупа шлифованное",11.5,3.3,66.5,3.6,1.7,64.6,0.0,14.0,342.0],
["6.8.3.1","6",124,"Просо / Кулинарные изделия","пшенный Суп с мясом 1-160 по",2.9,2.2,6.4,0.5,0.2,6.2,0.0,87.0,57.0],
["6.8.3.2","6",124,"Просо / Кулинарные изделия","Биточки пшенные по 1-292",6.9,5.9,22.2,1.2,4.1,18.1,0.1,62.2,170.0],
["6.8.3.3","6",124,"Просо / Кулинарные изделия","Каша пшенная по 1-278",2.8,3.4,16.8,0.9,1.4,15.4,0.0,74.9,109.0],
["6.9.1","6",124,"Кукуруза","Зерно продовольственное",10.3,4.9,60.0,9.6,1.6,58.2,0.0,14.0,325.0],
["6.9.2","6",124,"Кукуруза","Крупа",8.3,1.2,71.0,4.8,1.2,69.6,0.0,14.0,328.0],
["6.9.3","6",124,"Кукуруза","Крахмал",1.0,0.6,83.5,1.7,0.0,83.5,0.0,13.0,343.0],
["6.9.4","6",124,"Кукуруза","Мука из желтой кукурузы",7.2,1.5,72.1,4.4,1.3,70.6,0.0,14.0,331.0],
["7.1.1","7",126,"Бобовые","Горох, зерно",20.5,2.0,49.5,11.2,4.6,44.9,0.0,14.0,298.0],
["7.1.2","7",126,"Бобовые","Горох, лущеный",23.0,1.6,48.1,10.7,3.4,44.7,0.0,14.0,299.0],
["7.1.3","7",126,"Бобовые","Горох отварной по 1-296",10.5,0.8,20.4,5.0,1.4,19.0,0.0,60.9,130.0],
["7.1.4","7",126,"Бобовые","Горох отварной с копченой грудинкой по 1-298",8.4,5.7,17.8,4.1,3.5,14.3,0.0,61.7,156.0],
["7.1.5","7",126,"Бобовые","Горошек зеленый",5.0,0.2,8.3,5.5,4.0,4.3,0.1,80.0,55.0],
["7.1.6","7",126,"Бобовые","Горошек зеленый. Консервы",3.1,0.2,6.5,4.9,3.3,3.2,0.1,83.9,40.0],
["7.1.7","7",126,"Бобовые","Соя, зерно",34.9,17.3,17.3,13.5,5.7,11.6,0.0,12.0,364.0],
["7.1.8","7",126,"Бобовые","Мука соевая необезжиренная",36.5,18.6,17.9,13.3,5.9,12.0,0.0,9.0,385.0],
["7.1.9","7",126,"Бобовые","Мука соевая полуобезжиренная",43.0,9.5,19.1,14.5,6.6,12.5,0.0,9.0,334.0],
["7.1.10","7",126,"Бобовые","Мука соевая обезжиренная",48.9,1.0,21.7,14.1,6.2,15.5,0.0,9.0,291.0],
["7.1.11","7",126,"Бобовые","Фасоль, зерно",21.0,2.0,47.0,12.4,3.2,43.8,0.0,14.0,298.0],
["7.1.12","7",126,"Бобовые","Фасоль (стручок)",2.5,0.3,3.0,3.4,2.0,1.0,0.1,90.0,23.0],
["7.1.13","7",126,"Бобовые","Фасоль стручковая. Консервы",1.2,0.1,2.4,2.5,1.5,0.9,0.1,92.0,16.0],
["7.1.14","7",126,"Бобовые","Суп с бобовыми (фасоль) 1-162 по",3.0,1.3,6.9,1.7,1.4,5.5,0.0,85.5,54.0],
["7.1.15","7",126,"Бобовые","Чечевица, зерно",24.0,1.5,46.3,11.5,2.9,43.4,0.0,14.0,295.0],
["7.2.1","7",126,"Орехи","Арахис",26.3,45.2,9.9,8.1,4.2,5.7,0.0,7.9,552.0],
["7.2.2","7",126,"Орехи","Грецкий",16.2,60.8,11.1,6.1,3.9,7.2,0.0,3.8,656.0],
["7.2.3","7",126,"Орехи","Кешью",18.5,48.5,22.5,2.0,7.5,15.0,0.0,5.3,600.0],
["7.2.4","7",126,"Орехи","Лещина",13.0,62.6,9.3,6.0,3.4,5.9,0.1,5.4,653.0],
["7.2.5","7",126,"Орехи","Миндаль",18.6,53.7,13.0,7.0,6.0,7.0,0.0,4.0,609.0],
["7.2.6","7",126,"Орехи","Фундук",15.0,61.5,9.4,5.9,3.6,5.8,0.0,4.8,651.0],
["7.3.1","7",126,"Семена масличные","Горчица",25.8,30.8,23.4,8.8,3.6,19.8,0.0,6.4,474.0],
["7.3.2","7",126,"Семена масличные","Кунжут",19.4,48.7,12.2,5.6,2.0,10.2,0.0,9.0,565.0],
["7.3.3","7",126,"Семена масличные","Мак",17.5,47.5,14.5,6.0,1.1,13.4,0.0,7.8,556.0],
["7.3.4","7",126,"Семена масличные","Оливки (мякоть)",1.6,23.7,19.0,4.0,null,null,0.2,50.0,296.0],
["7.3.5","7",126,"Семена масличные","Оливки. Консервы",1.8,16.3,5.2,2.2,5.2,0.0,0.2,69.6,175.0],
["7.3.6","7",126,"Семена масличные","Подсолнечник",20.7,52.9,10.5,5.0,3.4,7.1,0.0,8.0,601.0],
["7.3.7","7",126,"Семена масличные","Рапс (низкоэруковый)",30.8,43.6,7.2,5.8,3.5,3.7,0.0,8.1,544.0],
["8.1.1.1","8",128,"Овощи / Листовые","Петрушка",3.7,0.4,7.6,2.1,6.4,1.2,0.1,85.0,49.0],
["8.1.1.2","8",128,"Овощи / Листовые","Ревень",0.7,0.1,2.5,3.2,2.3,0.2,1.0,91.5,16.0],
["8.1.1.3","8",128,"Овощи / Листовые","Сельдерей",0.9,0.1,2.1,1.8,2.0,0.1,0.1,94.0,13.0],
["8.1.1.6","8",128,"Овощи / Листовые","Салат зеленый с огурцами по 1-60",1.5,4.1,2.2,1.1,2.0,0.2,0.2,90.2,52.0],
["8.1.1.7","8",128,"Овощи / Листовые","Шпинат",2.9,0.3,2.0,1.3,1.9,0.1,0.1,91.6,23.0],
["8.1.1.8","8",128,"Овощи / Листовые","Суп-пюре из шпината 1-184 по",1.9,2.0,4.0,0.6,1.6,2.4,0.1,89.8,42.0],
["8.1.1.9","8",128,"Овощи / Листовые","Шпинат-пюре. Консервы",2.0,0.1,2.0,1.3,2.0,0.0,0.1,92.8,16.0],
["8.1.1.10","8",128,"Овощи / Листовые","Щавель",1.5,0.3,2.9,1.2,2.8,0.1,0.7,92.0,22.0],
["8.1.1.11","8",128,"Овощи / Листовые","Щи из щавеля по 1-132",2.3,3.5,1.8,0.4,1.8,0.0,0.2,90.2,48.0],
["8.1.1.12","8",128,"Овощи / Листовые","Укроп",2.5,0.5,6.3,2.8,6.2,0.1,0.1,85.5,40.0],
["8.1.1.13","8",128,"Овощи / Листовые","Спаржа",1.9,0.1,3.1,1.5,2.2,0.9,0.1,92.7,21.0],
["8.1.2.1.3","8",130,"Овощи / Капуста / Белокочанная","Щи из свежей капусты по 1-130",0.9,1.1,2.5,0.9,2.1,0.4,0.1,93.2,24.0],
["8.1.2.1.4","8",130,"Овощи / Капуста / Белокочанная","Капуста отварная по 1-210",1.4,0.1,4.2,2.2,4.0,0.2,0.1,91.0,24.0],
["8.1.2.1.6","8",130,"Овощи / Капуста / Белокочанная","Капуста жареная по 2-50",1.8,2.8,4.2,2.6,4.1,0.1,0.1,88.0,50.0],
["8.1.2.1.7","8",130,"Овощи / Капуста / Белокочанная","Капуста запеченная по 1-256",2.8,8.0,7.3,1.4,3.8,3.5,0.2,79.0,113.0],
["8.1.2.1.8","8",130,"Овощи / Капуста / Белокочанная","Капуста припущенная по 1-218",1.7,1.5,4.0,2.1,3.9,0.1,0.3,89.4,37.0],
["8.1.2.1.9","8",130,"Овощи / Капуста / Белокочанная","Голубцы овощные по 1-256",2.2,5.2,9.7,2.2,5.2,4.5,0.2,79.5,95.0],
["8.1.2.1.10","8",130,"Овощи / Капуста / Белокочанная","Запеканка капустная по 1-248",3.1,5.2,13.5,2.6,4.6,8.9,0.2,74.0,114.0],
["8.1.2.1.11","8",130,"Овощи / Капуста / Белокочанная","Котлеты капустные по 1-236",4.2,8.2,15.3,2.7,4.2,11.1,0.3,68.0,153.0],
["8.1.2.1.12","8",130,"Овощи / Капуста / Белокочанная","Шницель из капусты 1-236 по",3.4,6.4,11.6,2.7,2.8,8.8,0.2,74.6,118.0],
["8.1.2.1.14","8",132,"Овощи / Капуста / Белокочанная","Салат из квашеной капусты по 1-74",1.4,4.9,6.0,null,6.0,0.0,null,82.7,76.0],
["8.1.2.1.16","8",132,"Овощи / Капуста / Белокочанная","Щи суточные 1-134 по",0.9,1.0,1.5,null,1.3,0.2,null,94.0,19.0],
["8.1.2.2","8",132,"Овощи / Капуста","Брюссельская",4.8,0.3,3.1,null,2.7,0.4,null,86.0,35.0],
["8.1.2.3","8",132,"Овощи / Капуста","Кольраби",2.8,0.1,7.9,null,7.4,0.5,null,86.2,44.0],
["8.1.2.4","8",132,"Овощи / Капуста","Краснокочанная",0.8,0.2,5.1,null,4.6,0.5,null,91.0,26.0],
["8.1.2.5","8",132,"Овощи / Капуста","Цветная",2.5,0.3,4.2,null,3.8,0.4,null,90.0,30.0],
["8.1.2.5.1","8",132,"Овощи / Капуста / Цветная","Салат цветной из капусты, помидоров и зелени по 1-66",1.5,8.7,5.6,null,5.3,0.3,null,82.4,108.0],
["8.1.2.5.2","8",132,"Овощи / Капуста / Цветная","Капуста цветная жареная 1-238 по",1.7,3.1,3.0,null,2.6,0.4,null,89.6,47.0],
["8.1.2.5.3","8",132,"Овощи / Капуста / Цветная","Капуста цветная отварная по 1-210",1.7,0.2,3.4,null,3.1,0.3,null,91.8,22.0],
["8.1.3.1","8",132,"Овощи / Луковые","зеленый Лук (перо)",1.3,0.1,3.2,null,3.1,0.1,null,93.0,20.0],
["8.1.3.2","8",132,"Овощи / Луковые","Салат из зеленого лука по 1-60",1.6,4.0,3.3,null,3.3,0.0,null,89.0,56.0],
["8.1.3.3","8",132,"Овощи / Луковые","Лук порей",2.0,0.2,6.3,null,6.0,0.3,null,88.0,36.0],
["8.1.3.4","8",132,"Овощи / Луковые","Лук репка",1.4,0.2,8.2,null,8.1,0.1,null,86.0,41.0],
["8.1.3.5","8",132,"Овощи / Луковые","Лук жареный по 2-56",4.5,13.5,27.4,null,23.5,3.9,null,45.6,251.0],
["8.1.3.6","8",134,"Овощи / Луковые","Лук маринованный по 2-56",1.2,4.7,7.6,2.2,7.5,0.1,0.4,81.7,79.0],
["8.1.3.7","8",134,"Овощи / Луковые","Чеснок",6.5,0.5,29.9,1.5,3.9,26.0,0.1,60.0,149.0],
["8.1.4.1","8",134,"Овощи / Картофель","Картофель",2.0,0.4,16.3,1.4,1.3,15.0,0.2,78.6,77.0],
["8.1.4.2","8",134,"Овощи / Картофель","Картофель сушеный",6.6,0.3,71.6,5.0,5.0,66.6,0.5,12.0,317.0],
["8.1.4.3","8",134,"Овощи / Картофель","Борщ с картофелем по 1-112",1.1,1.1,6.8,0.8,4.3,2.5,0.2,88.5,42.0],
["8.1.4.4","8",134,"Овощи / Картофель","Окрошка овощная по 1-192",0.9,0.8,6.8,0.5,4.6,2.2,0.3,89.7,39.0],
["8.1.4.5","8",134,"Овощи / Картофель","Рассольник домашний 1-136 по",1.0,1.0,5.8,0.8,1.7,4.1,0.1,89.7,36.0],
["8.1.4.6","8",134,"Овощи / Картофель","Суп картофельный по 1-142",1.1,1.2,7.8,0.8,1.4,6.4,0.1,87.5,45.0],
["8.1.4.7","8",134,"Овощи / Картофель","Суп картофельный с перловой крупой 1-146 по",1.0,1.1,6.5,0.9,1.1,5.4,0.1,89.0,37.0],
["8.1.4.8","8",134,"Овощи / Картофель","Суп-пюре из картофеля по 1-180",1.6,2.0,8.3,0.6,1.8,6.5,0.1,85.8,58.0],
["8.1.4.9","8",134,"Овощи / Картофель","Картофель отварной по 1-206",2.0,0.4,15.8,1.4,0.9,14.9,0.2,78.9,75.0],
["8.1.4.10","8",136,"Овощи / Картофель","Картофель, тушенный с грибами 1-226 по",2.5,7.7,13.4,2.1,2.3,11.1,0.2,72.0,134.0],
["8.1.4.11","8",136,"Овощи / Картофель","Картофель, жаренный ломтиками (из отварного) по 1-230",2.0,8.6,18.6,1.6,0.7,17.9,0.1,67.0,161.0],
["8.1.4.13","8",136,"Овощи / Картофель","Картофель, жаренный во фритюре по 1-230",3.0,15.5,30.1,2.8,2.3,27.8,0.4,46.0,276.0],
["8.1.4.14","8",136,"Овощи / Картофель","Картофель, запеченный сметанном в соусе 1-244 по",2.0,5.3,13.8,0.9,2.2,11.6,0.3,75.4,114.0],
["8.1.4.15","8",136,"Овощи / Картофель","запеченный Картофель, с яйцом по 1-244",4.7,14.5,19.5,1.8,2.4,17.1,0.2,57.0,228.0],
["8.1.4.17","8",136,"Овощи / Картофель","Пюре картофельное 1-208 по",2.1,0.8,14.7,1.2,1.4,13.3,0.2,79.4,75.0],
["8.1.4.18","8",136,"Овощи / Картофель","Салат картофельный с огурцами по 1-70",1.7,3.2,8.6,1.2,2.2,6.4,0.4,83.4,71.0],
["8.1.4.19","8",136,"Овощи / Картофель","Котлеты картофельные по 1-232",2.8,4.7,22.0,1.8,1.2,20.8,0.2,66.5,142.0],
["8.1.4.20","8",136,"Овощи / Картофель","Котлеты картофельные, запеченные 1-248 по",2.8,6.9,16.2,1.3,2.0,14.2,0.3,70.7,139.0],
["8.1.4.21","8",136,"Овощи / Картофель","Котлеты картофельные с творогом по 1-232",8.1,9.7,15.8,1.3,1.2,14.6,0.4,62.9,179.0],
["8.1.4.22","8",136,"Овощи / Картофель","Запеканка картофельная с овощами 1-248 по",3.0,5.9,17.5,1.8,2.4,15.1,0.2,69.6,136.0],
["8.1.4.23","8",136,"Овощи / Картофель","Зразы картофельные 1-232 по",2.8,6.4,20.3,2.5,2.5,17.8,0.4,65.4,152.0],
["8.1.4.25","8",138,"Овощи / Картофель","Пирожки картофельные с морковью по 1-246",2.4,4.2,18.9,1.8,2.3,16.6,0.3,70.4,124.0],
["8.1.4.26","8",138,"Овощи / Картофель","Ватрушки картофельные по 1-246",6.2,7.6,17.7,1.3,3.9,13.8,0.4,64.9,165.0],
["8.1.4.27","8",138,"Овощи / Картофель","Топинамбур",2.1,0.1,12.8,4.5,3.2,9.6,0.1,79.0,61.0],
["8.1.5.2","8",138,"Овощи / Корнеплоды","Салат из моркови по 1-78",1.3,2.0,10.7,2.0,10.5,0.2,0.3,82.8,67.0],
["8.1.5.4","8",138,"Овощи / Корнеплоды","Суп-пюре из моркови 1-182 по",1.2,1.8,4.5,0.9,3.1,1.4,0.1,90.0,39.0],
["8.1.5.5","8",138,"Овощи / Корнеплоды","Морковь отварная по 2-40",1.3,0.1,6.4,2.4,6.2,0.2,0.3,88.7,33.0],
["8.1.5.6","8",138,"Овощи / Корнеплоды","Морковь припущенная по 1-214",1.4,1.6,7.7,2.6,7.5,0.2,0.3,84.6,52.0],
["8.1.5.7","8",138,"Овощи / Корнеплоды","Морковь тушеная с рисом по 1-224",1.8,5.0,17.2,1.7,5.8,11.4,0.2,73.0,122.0],
["8.1.5.8","8",138,"Овощи / Корнеплоды","Котлеты морковные по 1-234",3.4,6.7,19.2,3.3,6.7,12.5,0.4,64.5,152.0],
["8.1.5.9","8",138,"Овощи / Корнеплоды","Запеканка морковная по 1-250",2.7,5.0,17.8,3.1,9.2,8.6,0.4,68.9,128.0],
["8.1.5.10","8",138,"Овощи / Корнеплоды","Пудинг морковный по 1-250",3.0,4.1,14.0,2.2,8.7,5.3,0.3,74.4,106.0],
["8.1.5.11","8",138,"Овощи / Корнеплоды","Суфле морковное по 1-250",6.5,12.9,11.3,2.0,10.9,0.4,0.5,64.8,189.0],
["8.1.5.12","8",140,"Овощи / Корнеплоды","Свекла",1.5,0.1,8.8,2.5,8.7,0.1,0.1,86.0,42.0],
["8.1.5.13","8",140,"Овощи / Корнеплоды","Икра свекольная 1-96 по",2.3,6.8,11.7,2.7,11.5,0.2,0.6,74.0,119.0],
["8.1.5.14","8",140,"Овощи / Корнеплоды","Свекла отварная по 1-76",1.8,0.1,9.8,3.0,9.7,0.1,0.1,84.0,48.0],
["8.1.5.15","8",140,"Овощи / Корнеплоды","Салат из свеклы с и чесноком сыром по 1-76",5.1,14.2,7.1,2.0,7.0,0.1,0.3,69.7,178.0],
["8.1.5.16","8",140,"Овощи / Корнеплоды","Свекла тушеная по 2-50",1.6,3.0,10.3,2.4,9.4,0.9,0.2,80.9,75.0],
["8.1.5.17","8",140,"Овощи / Корнеплоды","Свекла, тушенная с яблоками 1-222 по",1.3,3.9,10.7,2.3,10.0,0.7,0.3,80.4,84.0],
["8.1.5.18","8",140,"Овощи / Корнеплоды","Котлеты свекольные 1-234 по",4.1,8.1,24.1,3.7,11.3,12.8,0.4,57.7,187.0],
["8.1.5.19","8",140,"Овощи / Корнеплоды","Борщ по 1-110",0.8,1.0,4.1,0.9,4.1,0.0,0.1,91.7,29.0],
["8.1.5.20","8",140,"Овощи / Корнеплоды","летний Борщ по 1-122",1.1,1.2,5.7,0.8,3.2,2.5,0.1,89.6,38.0],
["8.1.5.21","8",140,"Овощи / Корнеплоды","Борщ украинский по 1-122",1.1,2.2,6.5,0.8,4.2,2.3,0.1,87.8,50.0],
["8.1.5.22","8",140,"Овощи / Корнеплоды","Свекольник холодный по 1-198",0.8,0.2,6.1,0.6,6.1,0.0,0.3,91.0,30.0],
["8.1.5.23","8",140,"Овощи / Корнеплоды","Сельдерей (корень)",1.3,0.3,6.5,3.1,5.5,1.0,0.1,87.7,34.0],
["8.1.5.24","8",142,"Овощи / Корнеплоды","Редис",1.2,0.1,3.4,1.6,3.1,0.3,0.1,93.0,20.0],
["8.1.5.25","8",142,"Овощи / Корнеплоды","Салат из редиса по 1-64",2.5,5.0,2.9,1.0,2.7,0.2,0.2,87.8,67.0],
["8.1.5.26","8",142,"Овощи / Корнеплоды","Брюква",1.2,0.1,7.7,2.2,7.0,0.7,0.2,87.8,37.0],
["8.1.5.27","8",142,"Овощи / Корнеплоды","Брюква припущенная по 1-214",1.3,1.6,8.4,2.5,7.6,0.8,0.2,84.3,54.0],
["8.1.5.28","8",142,"Овощи / Корнеплоды","Репа",1.5,0.1,6.2,1.9,5.9,0.3,0.1,89.5,32.0],
["8.1.5.29","8",142,"Овощи / Корнеплоды","Репа припущенная по 1-214",1.6,1.5,6.3,2.0,6.0,0.3,0.1,87.0,45.0],
["8.1.5.30","8",142,"Овощи / Корнеплоды","Петрушка (корень)",1.5,0.6,10.1,3.2,6.1,4.0,0.1,83.0,51.0],
["8.1.5.31","8",142,"Овощи / Корнеплоды","Пастернак (корень)",1.4,0.5,9.2,4.5,5.2,4.0,0.1,83.0,47.0],
["8.1.5.32","8",142,"Овощи / Корнеплоды","Редька черная",1.9,0.2,6.7,2.1,6.4,0.3,0.1,88.0,36.0],
["8.1.5.33","8",142,"Овощи / Корнеплоды","Редька с маслом 1-78 по",1.7,7.0,6.4,2.1,6.1,0.3,0.1,81.8,96.0],
["8.1.5.34","8",142,"Овощи / Корнеплоды","Хрен",3.2,0.4,10.5,7.3,6.6,3.9,0.2,77.0,59.0],
["8.1.6.1","8",142,"Овощи / Другие овощные культуры","Огурцы (парниковые)",0.7,0.1,1.9,0.7,1.8,0.1,0.1,96.0,11.0],
["8.1.6.2","8",142,"Овощи / Другие овощные культуры","Огурцы (грунтовые)",0.8,0.1,2.5,1.0,2.4,0.1,0.1,95.0,14.0],
["8.1.6.3","8",142,"Овощи / Другие овощные культуры","Салат из свежих огурцов 1-60 по",1.2,4.0,2.7,0.8,2.6,0.1,0.2,90.6,52.0],
["8.1.6.4","8",142,"Овощи / Другие овощные культуры","Огурцы соленые",0.8,0.1,1.7,0.8,1.6,0.1,0.7,92.0,13.0],
["8.1.6.5","8",142,"Овощи / Другие овощные культуры","Салат из соленых огурцов с луком по 1-60",0.9,5.0,2.6,1.1,2.6,0.0,0.6,86.5,61.0],
["8.1.6.6","8",142,"Овощи / Другие овощные культуры","Томаты (грунтовые)",1.1,0.2,3.8,1.4,3.5,0.3,0.8,92.0,24.0],
["8.1.6.7","8",142,"Овощи / Другие овощные культуры","Салат из свежих помидоров по 1-62",1.5,4.1,3.6,1.1,3.5,0.1,0.7,88.3,59.0],
["8.1.6.10","8",144,"Овощи / Другие овощные культуры","Помидоры жареные по 2-56",1.8,4.7,5.1,1.9,4.6,0.5,1.1,83.7,73.0],
["8.1.6.11","8",144,"Овощи / Другие овощные культуры","Помидоры, фаршированные с рисом и морковью по 1-262",2.0,4.9,9.3,3.7,5.0,4.3,0.6,77.0,91.0],
["8.1.6.12","8",144,"Овощи / Другие овощные культуры","Помидоры, фаршированные яйцом и луком 1-90 по",2.9,6.2,3.5,1.2,3.2,0.3,0.6,84.7,83.0],
["8.1.6.13","8",144,"Овощи / Другие овощные культуры","Соус томатный острый",2.5,0.0,21.2,1.2,20.2,1.0,1.5,70.6,99.0],
["8.1.6.14","8",144,"Овощи / Другие овощные культуры","Помидоры с кожицей. Консервы",1.1,0.1,3.5,1.3,3.3,0.2,0.3,92.1,20.0],
["8.1.6.15","8",144,"Овощи / Другие овощные культуры","Помидоры без кожицы. Консервы",0.5,0.0,2.3,0.3,2.1,0.2,0.2,95.3,12.0],
["8.1.6.16","8",144,"Овощи / Другие овощные культуры","Томатное пюре. Консервы",3.6,0.0,11.8,0.8,11.2,0.6,1.8,80.0,66.0],
["8.1.6.17","8",144,"Овощи / Другие овощные культуры","Томатная паста. Консервы",4.8,0.0,19.0,1.1,18.0,1.0,2.4,70.0,102.0],
["8.1.6.18","8",144,"Овощи / Другие овощные культуры","Баклажаны",1.2,0.1,4.5,2.5,3.6,0.9,0.2,91.0,24.0],
["8.1.6.19","8",144,"Овощи / Другие овощные культуры","Икра из баклажанов. Консервы",1.7,13.3,5.1,3.8,4.5,0.6,0.5,73.6,148.0],
["8.1.6.20","8",144,"Овощи / Другие овощные культуры","Баклажаны, фаршированные овощами 1-266 по",2.9,4.5,7.4,2.9,6.6,0.8,0.3,80.2,83.0],
["8.1.6.21","8",144,"Овощи / Другие овощные культуры","Кабачки",0.6,0.3,4.6,1.0,4.6,0.0,0.1,93.0,24.0],
["8.1.6.22","8",144,"Овощи / Другие овощные культуры","III",1.1,5.9,7.5,1.8,6.1,1.4,0.1,82.2,88.0],
["8.1.6.23","8",144,"Овощи / Другие овощные культуры","Кабачки припущенные по 1-216",0.7,1.8,5.0,1.7,5.0,0.0,0.1,89.5,39.0],
["8.1.6.24","8",144,"Овощи / Другие овощные культуры","Кабачки запеченные 1-258 по",2.7,10.0,9.7,1.4,4.9,4.8,0.1,74.5,140.0],
["8.1.6.25","8",146,"Овощи / Другие овощные культуры","Кабачки, фаршированные овощами по 1-94",2.0,10.5,6.3,1.6,6.1,0.2,0.2,76.0,130.0],
["8.1.6.27","8",146,"Овощи / Другие овощные культуры","кабачковая Икра по 1-92",1.0,4.7,7.7,1.8,7.2,0.5,0.2,83.0,78.0],
["8.1.6.31","8",146,"Овощи / Другие овощные культуры","Тыква",1.0,0.1,4.4,2.0,4.2,0.2,0.1,91.8,22.0],
["8.1.6.32","8",146,"Овощи / Другие овощные культуры","Тыква отварная по 1-210",1.2,0.1,4.9,2.4,4.6,0.3,0.1,89.8,26.0],
["8.1.6.33","8",146,"Овощи / Другие овощные культуры","Тыква припущенная 1-216 по",1.2,1.7,4.8,2.4,4.5,0.3,0.1,88.5,40.0],
["8.1.6.34","8",146,"Овощи / Другие овощные культуры","Тыква жареная по 2-58",1.7,5.7,6.9,2.5,3.9,3.0,0.1,81.6,86.0],
["8.1.6.35","8",146,"Овощи / Другие овощные культуры","Тыква маринованная по 1-88",0.6,0.1,8.9,1.2,8.8,0.1,0.9,87.3,42.0],
["8.1.6.36","8",146,"Овощи / Другие овощные культуры","Пюре из тыквы 1-212 по",1.7,6.2,6.3,1.2,3.6,2.7,0.1,83.4,88.0],
["8.1.6.37","8",146,"Овощи / Другие овощные культуры","Каша из тыквы по 1-218",2.1,1.7,15.7,1.9,7.3,8.4,0.1,77.1,87.0],
["8.1.6.38","8",146,"Овощи / Другие овощные культуры","Оладьи из тыквы по 1-238",4.0,7.0,19.8,2.2,8.1,11.7,0.1,65.6,158.0],
["8.1.6.39","8",146,"Овощи / Другие овощные культуры","Запеканка из тыквы по 1-254",4.1,6.1,16.3,2.0,4.5,11.8,0.1,69.5,137.0],
["8.1.6.40","8",146,"Овощи / Другие овощные культуры","Пудинг из тыквы по 1-254",3.0,3.2,12.3,2.2,9.7,2.6,0.5,77.4,92.0],
["8.2.2","8",148,"Грибы","Белые сушеные",30.0,14.3,9.0,26.2,9.0,0.0,0.0,13.0,286.0],
["8.2.3","8",148,"Грибы","Солянка грибная по 1-172",0.0,1.2,1.3,0.3,1.3,0.0,0.1,95.5,18.0],
["8.2.6","8",148,"Грибы","Грибы жареные в сметанном соусе по 1-242",6.7,14.5,3.5,6.8,1.0,2.5,0.1,65.3,172.0],
["8.2.7","8",148,"Грибы","Грибы жареные с картофелем по 1-242",3.9,5.2,12.7,2.5,1.2,11.5,0.2,73.5,114.0],
["8.2.8","8",148,"Грибы","Грибы, запеченные в сметанном соусе по 1-260",6.5,16.6,3.2,7.8,1.0,2.2,0.1,62.4,188.0],
["8.2.9","8",148,"Грибы","Лисички",1.5,1.0,1.0,7.0,1.0,0.0,0.0,88.5,19.0],
["8.2.10","8",148,"Грибы","Опята",2.2,1.2,0.5,5.1,0.5,0.0,0.0,90.0,22.0],
["8.2.11","8",148,"Грибы","Подберезовики",2.1,0.8,1.2,5.1,1.2,0.0,0.0,90.1,20.0],
["8.2.12","8",148,"Грибы","Подосиновики",3.3,0.5,1.2,6.0,1.2,0.0,0.0,88.1,22.0],
["8.2.13","8",148,"Грибы","Сыроежки",1.7,0.7,1.5,5.5,1.5,0.0,0.0,90.0,19.0],
["8.2.14","8",148,"Грибы","Шампиньоны",4.3,1.0,0.1,2.6,0.1,0.0,0.0,91.0,27.0],
["9.1.1.1","9",150,"Фрукты / Фрукты косточковые","Абрикось",0.9,0.1,9.0,2.1,8.3,0.7,1.0,86.2,44.0],
["9.1.1.2","9",150,"Фрукты / Фрукты косточковые","Абрикосы сушеные с косточкой (урюк)",5.0,0.4,53.0,17.6,49.8,3.2,2.0,18.0,242.0],
["9.1.1.3","9",150,"Фрукты / Фрукты косточковые","Абрикосы сушеные без косточки (курага)",5.2,0.3,51.0,18.0,48.0,3.0,1.5,20.0,232.0],
["9.1.1.4","9",150,"Фрукты / Фрукты косточковые","Алыча",0.2,0.1,7.9,1.8,7.8,0.1,0.5,89.0,34.0],
["9.1.1.5","9",150,"Фрукты / Фрукты косточковые","Вишня",0.8,0.2,10.6,1.8,10.5,0.1,1.6,84.4,52.0],
["9.1.1.6","9",150,"Фрукты / Фрукты косточковые","Вишня с сахаром по 2-116",0.7,0.4,21.7,1.6,21.7,0.0,1.3,73.9,97.0],
["9.1.1.7","9",150,"Фрукты / Фрукты косточковые","Персик",0.9,0.1,9.5,2.1,8.3,1.2,0.7,86.1,45.0],
["9.1.1.8","9",150,"Фрукты / Фрукты косточковые","Персик сушеный",3.0,0.4,57.7,14.9,52.2,5.5,2.5,18.0,254.0],
["9.1.1.9","9",150,"Фрукты / Фрукты косточковые","Слива (садовая)",0.8,0.3,9.6,1.5,9.5,0.1,1.0,86.3,49.0],
["9.1.1.10","9",150,"Фрукты / Фрукты косточковые","Слива сушеная (чернослив)",2.3,0.7,57.5,9.0,56.9,0.6,3.5,25.0,256.0],
["9.1.1.11","9",150,"Фрукты / Фрукты косточковые","Чернослив со взбитыми сливками по 2-116",2.3,12.6,38.0,7.2,37.6,0.4,2.2,36.3,281.0],
["9.1.1.12","9",150,"Фрукты / Фрукты косточковые","Терн",1.5,0.3,9.4,2.0,9.3,0.1,2.5,83.0,54.0],
["9.1.2.1","9",150,"Фрукты / Фрукты семечковые","Айва",0.6,0.5,9.6,3.6,7.6,2.0,0.9,84.0,48.0],
["9.1.2.3","9",150,"Фрукты / Фрукты семечковые","Груша сушеная",2.3,0.6,62.6,6.0,42.3,20.3,1.5,24.0,270.0],
["9.1.2.4","9",152,"Фрукты / Фрукты семечковые","Рябина садовая красная",1.4,0.2,8.9,5.4,8.5,0.4,2.2,81.1,50.0],
["9.1.2.5","9",152,"Фрукты / Фрукты семечковые","Рябина черноплодная",1.5,0.2,10.9,4.1,10.8,0.1,1.3,80.5,55.0],
["9.1.2.6","9",152,"Фрукты / Фрукты семечковые","Яблоки",0.4,0.4,9.8,1.8,9.0,0.8,0.8,86.3,47.0],
["9.1.2.7","9",152,"Фрукты / Фрукты семечковые","Суп из свежих фруктов по 1-200",0.1,0.1,11.9,0.6,10.2,1.7,0.2,87.0,50.0],
["9.1.2.8","9",152,"Фрукты / Фрукты семечковые","Яблоки сушеные",2.2,0.1,59.0,14.9,55.6,3.4,2.3,20.0,253.0],
["9.1.3.1","9",152,"Фрукты / Фрукты субтропические","Гранат",0.7,0.6,14.5,0.9,14.5,0.0,1.8,81.0,72.0],
["9.1.3.2","9",152,"Фрукты / Фрукты субтропические","Инжир",0.7,0.2,12.0,2.5,11.2,0.8,0.5,83.0,54.0],
["9.1.3.3","9",152,"Фрукты / Фрукты субтропические","Инжир сушеный",3.1,0.8,57.9,18.2,54.9,3.0,2.0,16.0,257.0],
["9.1.3.4","9",152,"Фрукты / Фрукты субтропические","Киви",0.8,0.4,8.1,3.8,7.8,0.3,2.5,83.8,47.0],
["9.1.3.5","9",152,"Фрукты / Фрукты субтропические","Киви пюре",0.8,0.4,8.2,4.0,7.9,0.3,2.5,83.4,47.0],
["9.1.3.6","9",152,"Фрукты / Фрукты субтропические","Киви подварка",0.4,0.2,58.9,2.0,58.7,0.2,1.3,36.9,243.0],
["9.1.3.7","9",152,"Фрукты / Фрукты субтропические","Хурма",0.5,0.4,15.3,1.6,15.3,0.0,0.1,81.5,67.0],
["9.1.4.1","9",152,"Фрукты / Фрукты цитрусовые","Апельсин",0.9,0.2,8.1,2.2,8.1,0.0,1.3,86.8,43.0],
["9.1.4.2","9",152,"Фрукты / Фрукты цитрусовые","Апельсин с сахаром 2-116 по",0.7,0.2,28.7,1.7,28.7,0.0,1.0,67.3,122.0],
["9.1.4.4","9",154,"Фрукты / Фрукты цитрусовые","Грейпфрут с сахаром по 2-116",0.5,0.2,28.1,1.4,28.1,0.0,1.1,68.3,120.0],
["9.1.4.5","9",154,"Фрукты / Фрукты цитрусовые","Лимон",0.9,0.1,3.0,2.0,3.0,0.0,5.7,87.8,34.0],
["9.1.4.6","9",154,"Фрукты / Фрукты цитрусовые","Лимон с сахаром по 2-116",0.6,0.1,38.7,1.3,38.7,0.0,3.6,55.4,169.0],
["9.1.4.7","9",154,"Фрукты / Фрукты цитрусовые","Мандарин",0.8,0.2,7.5,1.9,7.5,0.0,1.1,88.0,38.0],
["9.1.5.1","9",154,"Фрукты / Тропические фрукты","Ананас",0.4,0.2,11.5,1.2,11.5,0.0,0.7,85.3,52.0],
["9.1.5.2","9",154,"Фрукты / Тропические фрукты","Банан",1.5,0.5,21.0,1.7,19.0,2.0,0.4,74.0,96.0],
["9.2.1.1","9",154,"Ягоды / Ягоды садовые","Виноград",0.6,0.6,15.4,1.6,15.4,0.0,0.8,80.5,72.0],
["9.2.1.2","9",154,"Ягоды / Ягоды садовые","Виноград сушеный (кишмиш)",2.3,0.5,65.8,9.6,65.8,0.0,1.4,18.0,281.0],
["9.2.1.3","9",154,"Ягоды / Ягоды садовые","Земляника (садовая)",0.8,0.4,7.5,2.2,7.4,0.1,1.3,87.4,41.0],
["9.2.1.4","9",154,"Ягоды / Ягоды садовые","Крыжовник",0.7,0.2,9.1,3.4,9.1,0.0,1.3,84.7,45.0],
["9.2.1.5","9",154,"Ягоды / Ягоды садовые","Малина",0.8,0.5,8.3,3.7,8.3,0.0,1.5,84.7,46.0],
["9.2.1.6","9",154,"Ягоды / Ягоды садовые","Малина с молоком 2-116 по",1.8,1.8,12.7,1.5,12.7,0.0,0.7,80.9,76.0],
["9.2.1.8","9",156,"Ягоды / Ягоды садовые","Облепиха",1.2,5.4,5.7,2.0,5.7,0.0,2.0,83.0,82.0],
["9.2.1.9","9",156,"Ягоды / Ягоды садовые","Смородина белая",0.5,0.2,8.0,3.4,8.0,0.0,2.0,85.4,42.0],
["9.2.1.10","9",156,"Ягоды / Ягоды садовые","Смородина красная",0.6,0.2,7.7,3.4,7.7,0.0,2.5,85.0,43.0],
["9.2.1.11","9",156,"Ягоды / Ягоды садовые","Смородина черная",1.0,0.4,7.3,4.8,7.3,0.0,2.3,83.3,44.0],
["9.2.1.12","9",156,"Ягоды / Ягоды садовые","Шиповник",1.6,0.7,22.4,10.8,19.4,3.0,2.3,60.0,109.0],
["9.2.2.1","9",156,"Ягоды / Ягоды лесные","Брусника",0.7,0.5,8.2,2.5,8.1,0.1,1.9,86.0,46.0],
["9.2.2.2","9",156,"Ягоды / Ягоды лесные","Голубика",1.0,0.5,6.6,null,6.6,0.0,1.4,87.7,39.0],
["9.2.2.3","9",156,"Ягоды / Ягоды лесные","Ежевика",1.5,0.5,4.4,2.9,4.4,0.0,2.0,88.0,34.0],
["9.2.2.4","9",156,"Ягоды / Ягоды лесные","Клюква",0.5,0.2,3.7,3.3,3.7,0.0,3.1,88.9,28.0],
["9.2.2.5","9",156,"Ягоды / Ягоды лесные","Морошка",0.8,0.9,7.4,6.3,7.4,0.0,0.8,83.3,40.0],
["9.2.2.6","9",158,"Ягоды / Ягоды лесные","Черника",1.1,0.6,7.6,3.1,7.6,0.0,1.2,86.0,44.0],
["9.3.1","9",158,"Бахчевые","Арбуз",0.6,0.1,5.8,0.4,5.8,0.0,0.1,92.6,27.0],
["9.3.2","9",158,"Бахчевые","Дыня",0.6,0.3,7.4,0.9,7.3,0.1,0.2,90.0,35.0],
["9.3.3","9",158,"Бахчевые","Тыква",1.0,0.1,4.4,2.0,4.2,0.2,0.1,91.8,23.0],
["9.4.12","9",160,"Варенье, джем, повидло","Джем черносмородиновый",0.6,0.1,72.9,1.4,72.8,0.1,1.2,23.3,284.0],
["9.4.14","9",160,"Варенье, джем, повидло","Пюре яблочное",0.6,0.2,19.0,1.1,18.8,0.2,0.6,78.2,82.0],
["10.1.1","10",162,"Сахар","Сахар-песок",0.0,0.0,99.8,0.0,99.8,0.0,0.0,0.1,399.0],
["10.1.2","10",162,"Сахар","Сахар-рафинад",0.0,0.0,99.9,0.0,99.9,0.0,0.0,0.1,400.0],
["10.2.1","10",162,"Карамель","Глазированная",1.0,0.8,92.9,0.4,81.8,11.1,0.6,4.2,378.0],
["10.2.2","10",162,"Карамель","Леденцовая",0.0,0.0,95.8,0.0,83.3,12.5,0.5,3.6,384.0],
["10.2.3","10",162,"Карамель","С молочной начинкой",0.8,1.0,91.2,0.0,77.8,13.4,0.0,6.7,377.0],
["10.2.4","10",162,"Карамель","С фруктово-я годной начинкой",0.1,0.1,92.4,0.2,81.8,10.6,0.5,6.6,371.0],
["10.2.5","10",162,"Карамель","С шоколадно-ореховой начинкой",1.6,8.0,87.1,1.0,77.7,9.4,0.2,1.6,427.0],
["10.3.1","10",162,"Драже","Драже сахарное",0.0,0.0,97.7,0.0,96.1,1.6,0.7,1.6,393.0],
["10.4.1","10",162,"Ирис","Ирис полутвердый",3.3,7.6,81.5,0.0,69.4,12.1,0.2,6.5,408.0],
["10.4.2","10",162,"Ирис","Иристираженный с орехом",6.6,15.9,68.2,0.8,60.7,7.5,0.2,7.5,443.0],
["10.5.1","10",164,"Мармелад","Мармелад желейный",0.1,0.0,79.4,1.2,74.5,4.9,1.1,18.0,321.0],
["10.5.2","10",164,"Мармелад","Мармелад фруктово-ягодный, глазированный шоколадом",1.5,9.2,64.2,2.5,63.0,1.2,1.1,21.0,349.0],
["10.6.1","10",164,"Пастила зефир","Пастила",0.5,0.0,80.0,0.8,76.4,3.6,0.5,18.0,324.0],
["10.6.2","10",164,"Пастила зефир","Пастила, глазированная шоколадом",1.9,12.0,70.9,2.6,67.0,3.9,0.8,11.4,402.0],
["10.6.3","10",164,"Пастила зефир","Зефир",0.8,0.1,79.8,1.0,74.8,5.0,1.0,17.0,326.0],
["10.6.4","10",164,"Пастила зефир","Зефир, глазированный шоколадом",2.2,12.3,68.4,2.7,63.8,4.6,0.8,13.3,396.0],
["10.7.1","10",164,"Халва","Халва тахинно-арахисовая",12.7,29.2,47.0,5.1,32.7,14.3,0.0,3.9,502.0],
["10.7.2","10",164,"Халва","Халва тахинно-шоколадная",12.8,28.1,48.4,4.7,35.5,12.9,0.1,3.0,498.0],
["10.8.1","10",164,"Шоколад какао-порошок","Какао-порошок",24.3,15.0,10.2,35.3,2.0,8.2,3.9,5.0,289.0],
["10.8.2.1","10",164,"Шоколад какао-порошок / Шоколад без добавлений","Шоколад горький",6.2,35.4,48.2,7.4,42.6,5.6,0.9,0.8,539.0],
["10.8.2.2","10",164,"Шоколад какао-порошок / Шоколад без добавлений","Шоколад полугорький",4.5,35.4,52.5,5.2,50.4,2.1,0.7,0.7,549.0],
["10.8.2.3","10",164,"Шоколад какао-порошок / Шоколад без добавлений","Шоколад сладкий",3.0,34.0,57.6,3.6,54.6,3.0,0.5,0.6,550.0],
["10.8.3.1","10",166,"Шоколад какао-порошок / Шоколад добавлениями","сливочный Шоколад",6.3,35.5,53.7,2.3,51.8,1.9,0.3,1.2,560.0],
["10.8.3.2","10",166,"Шоколад какао-порошок / Шоколад добавлениями","молочный Шоколад",9.8,34.7,50.4,1.3,47.5,2.9,0.5,1.1,554.0],
["10.8.3.3","10",166,"Шоколад какао-порошок / Шоколад добавлениями","Шоколад молочно-ореховы й",7.5,33.9,51.3,4.0,48.1,3.2,0.6,1.1,542.0],
["10.8.3.4","10",166,"Шоколад какао-порошок / Шоколад добавлениями","Шоколад ореховый",7.3,33.8,49.7,6.5,44.3,5.4,0.7,1.1,534.0],
["10.8.3.5","10",166,"Шоколад какао-порошок / Шоколад добавлениями","Шоколад молочно-ореховый с изюмом",8.0,30.3,48.2,6.0,44.8,3.4,0.7,5.0,500.0],
["10.8.3.6","10",166,"Шоколад какао-порошок / Шоколад добавлениями","Шоколадная паста",8.2,30.6,56.6,2.0,54.2,2.4,0.3,1.0,536.0],
["10.8.3.7","10",166,"Шоколад какао-порошок / Шоколад добавлениями","Плитки кондитерские",7.8,34.6,48.1,5.8,47.0,1.1,0.7,1.2,537.0],
["10.8.3.8","10",166,"Шоколад какао-порошок / Шоколад добавлениями","Плитки кондитерские сладкие",6.2,34.2,54.5,2.7,51.5,3.0,0.4,0.8,552.0],
["10.9.1.1","10",166,"Конфеты / Конфеты неглазированные","Помадные",3.7,16.2,70.9,0.2,69.5,1.4,0.2,8.2,445.0],
["10.9.1.2","10",166,"Конфеты / Конфеты неглазированные","Пралине с ржаной мукой",4.7,37.7,52.0,3.3,42.6,9.4,0.2,0.9,567.0],
["10.9.1.3","10",166,"Конфеты / Конфеты неглазированные","Пралине с соевой мукой (*раффинозы и стахиозы менее 0,3%)",9.9,32.2,51.2,3.4,49.4,1.8,0.2,1.8,535.0],
["10.9.1.4","10",166,"Конфеты / Конфеты неглазированные","Шоколадные",4.0,26.3,59.2,4.6,56.7,2.5,0.5,4.9,491.0],
["10.9.2.1","10",168,"Конфеты / КОНФЕТЫ","Грильяжными",7.8,22.0,64.9,3.6,61.7,3.2,0.2,0.9,489.0],
["10.9.2.2","10",168,"Конфеты / КОНФЕТЫ","Желейными (*морковными)",1.4,8.2,69.4,4.2,65.2,4.2,0.7,15.6,359.0],
["10.9.2.3","10",168,"Конфеты / КОНФЕТЫ","Кремово-сбивнь ми",2.7,25.8,54.7,2.1,48.5,6.2,0.4,14.0,463.0],
["10.9.2.4","10",168,"Конфеты / КОНФЕТЫ","Помадными",1.5,7.2,81.8,2.3,77.7,4.1,0.3,6.6,399.0],
["10.9.2.5","10",168,"Конфеты / КОНФЕТЫ","Пралине",6.9,30.8,56.9,3.4,55.6,1.3,0.2,1.0,533.0],
["10.9.2.6","10",168,"Конфеты / КОНФЕТЫ","Пралине со слоями вафель",6.6,31.0,56.6,3.6,49.8,6.8,0.4,1.1,533.0],
["10.9.2.7","10",168,"Конфеты / КОНФЕТЫ","Сбивными",3.0,15.5,65.0,5.0,60.1,4.9,0.5,10.2,413.0],
["10.10.1.1","10",168,"Мучные кондитерские изделия / Вафли","Вафли с жировыми начинками",3.9,30.6,62.5,1.2,38.0,24.5,0.4,1.0,542.0],
["10.10.1.2","10",168,"Мучные кондитерские изделия / Вафли","Вафли с фруктово-ягодными начинками",2.8,3.3,77.3,3.1,67.1,10.2,1.2,12.0,354.0],
["10.10.2.1","10",168,"Мучные кондитерские изделия / Торты пирожные","Пирожное слоеное с белковым кремом",6.1,26.0,50.6,1.5,19.6,31.0,0.0,14.8,461.0],
["10.10.2.2","10",168,"Мучные кондитерские изделия / Торты пирожные","Пирожное бисквитное с белковым кремом",4.4,7.3,63.1,0.4,56.0,7.1,0.1,24.1,336.0],
["10.10.2.3","10",168,"Мучные кондитерские изделия / Торты пирожные","Пирожное песочное с кремом",5.1,28.2,52.1,1.5,26.8,25.3,0.7,12.4,485.0],
["10.10.2.4","10",168,"Мучные кондитерские изделия / Торты пирожные","Пирожное воздушное с кремом",2.6,20.8,60.5,0.0,60.5,0.0,0.0,15.8,440.0],
["10.10.2.5","10",170,"Мучные кондитерские изделия / Торты пирожные","Пирожное миндальное",8.5,16.2,63.2,2.1,54.1,9.1,0.0,8.0,433.0],
["10.10.2.6","10",170,"Мучные кондитерские изделия / Торты пирожные","Пирожное заварное с кремом (трубочка)",4.4,24.5,48.8,0.4,41.1,7.7,0.0,21.3,433.0],
["10.10.2.7","10",170,"Мучные кондитерские изделия / Торты пирожные","Пирожное крошковое",5.9,19.4,47.5,0.8,35.9,11.6,0.0,25.9,388.0],
["10.10.2.8","10",170,"Мучные кондитерские изделия / Торты пирожные","Пирожное вафельное молочное",4.8,36.7,55.3,1.0,42.0,13.3,0.2,1.1,572.0],
["10.10.2.9","10",170,"Мучные кондитерские изделия / Торты пирожные","Торт бисквитнь й начинкой с фруктовой",3.9,2.6,61.3,0.7,52.4,8.9,0.2,30.9,285.0],
["10.10.2.10","10",170,"Мучные кондитерские изделия / Торты пирожные","Торт слоеный",8.5,37.7,42.2,1.3,16.3,25.9,0.1,9.9,542.0],
["10.10.2.11","10",170,"Мучные кондитерские изделия / Торты пирожные","Торт миндальный",7.8,28.7,44.6,2.3,40.7,3.9,0.2,15.2,468.0],
["10.11.1","10",170,"Кондитерское сырье","Агар НПВ (*в т. ч. - 75,6)",2.0,0.0,0.8,79.4,0.0,0.8,0.2,14.0,12.0],
["10.11.2","10",170,"Кондитерское сырье","Глазурь жировая",3.9,37.2,48.9,7.4,46.7,2.2,0.2,1.4,547.0],
["10.11.3","10",170,"Кондитерское сырье","Глазурь шоколадная",4.9,34.5,52.5,6.0,48.2,4.3,0.7,0.8,542.0],
["10.11.4","10",170,"Кондитерское сырье","Какао тертое",13.5,49.4,13.6,16.5,1.0,12.6,2.0,2.0,559.0],
["10.11.5","10",170,"Кондитерское сырье","Какаовелла",15.0,4.5,11.0,56.8,0.0,11.0,0.8,6.5,147.0],
["10.11.6","10",170,"Кондитерское сырье","Крахмал картофельный",0.1,0.0,78.2,1.4,0.9,77.3,0.0,20.0,313.0],
["10.11.7","10",170,"Кондитерское сырье","Крахмал кукурузный",1.0,0.6,83.5,1.7,0.0,83.5,0.0,13.0,343.0],
["10.11.8","10",170,"Кондитерское сырье","Мед пчелиный",0.8,0.0,80.3,0.0,74.6,5.5,1.2,17.4,328.0],
["10.11.9","10",170,"Кондитерское сырье","Мука из зародышей пшеницы",33.8,7.7,32.7,15.6,17.3,15.5,0.0,5.9,335.0],
["10.11.10","10",170,"Кондитерское сырье","Патока кукурузная",0.0,0.3,78.3,0.0,43.3,35.0,0.0,21.0,316.0],
["10.11.11","10",170,"Кондитерское сырье","Пектин (*вт.ч. РПВ-69,9)",3.5,0.0,9.3,75.5,9.3,0.0,0.2,10.0,52.0],
["10.11.12","10",170,"Кондитерское сырье","Повидло морковное",0.5,0.4,65.8,1.1,65.5,0.3,0.7,31.0,282.0],
["10.11.13","10",172,"Кондитерское сырье","Подварка апельсиновая",0.4,0.1,66.3,1.5,66.3,0.0,0.5,31.0,268.0],
["10.11.14","10",172,"Кондитерское сырье","Подварка морковная",0.5,0.4,65.8,1.1,65.5,0.3,0.7,31.0,271.0],
["10.11.15","10",172,"Кондитерское сырье","Подварка кабачковая",0.2,0.1,67.2,0.5,67.2,0.0,0.5,31.0,272.0],
["10.11.16","10",172,"Кондитерское сырье","Подварка свекольная",0.5,0.1,65.9,1.3,65.8,0.1,0.7,31.0,269.0],
["10.11.17","10",172,"Кондитерское сырье","Рожь молотая жареная",7.9,1.7,68.7,13.7,1.5,67.2,0.1,4.3,322.0],
["10.11.18","10",172,"Кондитерское сырье","Сироп из шиповника",0.2,0.0,70.5,0.0,70.5,0.0,0.8,28.0,285.0],
["10.11.19","10",172,"Кондитерское сырье","Фосфатидныи концентрат соевый",0.0,93.7,0.0,0.0,0.0,0.0,0.0,1.0,843.0],
["10.11.20","10",172,"Кондитерское сырье","Цукаты морковные",2.9,0.2,70.5,5.5,70.1,0.4,1.5,17.4,300.0],
["10.11.21","10",172,"Кондитерское сырье","Шикозин",0.2,99.6,0.0,0.0,0.0,0.0,0.0,0.1,897.0],
["10.11.22","10",172,"Кондитерское сырье","Ядро ореха арахиса жареное",26.0,52.0,13.4,4.8,1.0,12.4,0.1,2.5,626.0],
["10.11.23","10",172,"Кондитерское сырье","Ядро миндаля ореха жареное",22.4,55.9,12.3,4.7,2.6,9.7,0.1,2.5,642.0],
["10.11.24","10",172,"Кондитерское сырье","Ядро ореха фундука жареное",17.8,66.1,9.4,2.8,0.2,9.2,0.1,2.0,703.0],
["11.1.1.1","11",174,"Соки консервы","Абрикосовый",0.5,0.0,12.7,1.3,12.3,0.4,0.8,84.3,55.0],
["11.1.1.2","11",174,"Соки консервы","Айвовый",0.5,0.1,11.2,1.5,10.2,1.0,1.2,85.1,51.0],
["11.1.1.3","11",174,"Соки консервы","Ананасовый",0.3,0.1,11.8,1.0,11.8,0.0,1.0,85.5,52.0],
["11.1.1.4","11",174,"Соки консервы","Апельсиновый",0.7,0.1,13.2,0.2,13.0,0.2,1.0,84.5,60.0],
["11.1.1.5","11",174,"Соки консервы","Виноградный",0.3,0.2,16.3,0.3,16.3,0.0,0.5,81.9,70.0],
["11.1.1.6","11",174,"Соки консервы","Вишневый",0.7,0.2,11.4,0.4,11.4,0.0,1.7,85.0,51.0],
["11.1.1.7","11",174,"Соки консервы","Гранатовый",0.3,0.1,14.2,0.2,14.2,0.0,2.4,82.5,56.0],
["11.1.1.8","11",174,"Соки консервы","Грейпфрутовый",0.3,0.1,7.9,0.2,7.9,0.0,1.6,89.6,38.0],
["11.1.1.9","11",174,"Соки консервы","Лимонный Мандариновый",0.6,0.0,3.9,0.1,3.9,0.0,5.0,90.0,33.0],
["11.1.1.13","11",176,"Соки консервы","Черносмородиновый",0.5,0.0,7.3,1.0,7.3,0.0,2.7,87.8,41.0],
["11.1.1.14","11",176,"Соки консервы","Черноплоднорябиновый",0.1,0.1,11.4,1.0,11.4,0.0,1.2,86.0,50.0],
["11.1.1.15","11",176,"Соки консервы","Шиповниковый",0.1,0.2,16.1,0.5,14.9,1.2,0.8,82.0,67.0],
["11.1.1.16","11",176,"Соки консервы","Яблочный",0.5,0.1,10.1,0.2,9.9,0.2,0.5,88.1,46.0],
["11.1.2.1","11",176,"Соки консервы","Морковный",1.1,0.1,12.6,1.0,12.4,0.2,0.2,84.6,56.0],
["11.1.2.2","11",176,"Соки консервы","Свекольный",1.0,0.0,14.1,1.0,14.1,0.0,0.2,83.4,61.0],
["11.1.2.3","11",176,"Соки консервы","Томатный",1.0,0.1,2.9,0.7,2.8,0.1,0.5,94.3,18.0],
["11.1.3.1","11",176,"Напитки плодовые ягодные негазированные","Яблочновиноградный. Консервы",0.3,0.0,12.3,0.2,12.2,0.1,0.4,86.6,52.0],
["11.1.3.2","11",178,"Напитки плодовые ягодные негазированные","Яблочноабрикосовый. Консервы",0.2,0.0,14.0,0.2,13.8,0.2,0.4,85.0,58.0],
["11.1.3.3","11",178,"Напитки плодовые ягодные негазированные","Яблочно морковный. Консервы",0.3,0.0,15.5,0.2,15.3,0.2,0.3,83.5,68.0],
["11.1.3.4","11",178,"Напитки плодовые ягодные негазированные","Из плодов шиповника по 2-162",0.2,0.1,11.9,0.8,11.8,0.1,0.2,86.5,50.0],
["11.1.3.5","11",178,"Напитки плодовые ягодные негазированные","Коктейль персиковый по 2-164",1.7,1.9,18.5,0.1,18.4,0.1,0.2,77.1,98.0],
["11.1.3.6","11",178,"Напитки плодовые ягодные негазированные","Напиток апельсиновый 2-160 по",0.1,0.0,13.0,0.2,13.0,0.0,0.1,86.5,53.0],
["11.1.3.7","11",178,"Напитки плодовые ягодные негазированные","Напиток клюквенный по 2-160",0.1,0.0,12.4,0.3,12.4,0.0,0.4,86.7,51.0],
["11.1.3.8","11",178,"Напитки плодовые ягодные негазированные","Напиток яблочный по 2-160",0.1,0.1,13.2,0.2,13.1,0.1,0.1,86.2,54.0],
["11.1.4","11",178,"","Компот из абрикосов 2-122 по",0.2,0.0,13.6,0.4,13.5,0.1,0.3,85.2,56.0],
["11.1.4.2","11",178,"Компот из абрикосов 2-122 по","Компот из абрикосов. Консервы",0.2,0.0,21.7,0.6,21.4,0.3,0.5,76.5,89.0],
["11.1.4.3","11",178,"Компот из абрикосов 2-122 по","Компот из айвы по 2-118",0.1,0.1,13.7,0.6,13.5,0.2,0.3,85.0,56.0],
["11.1.4.4","11",178,"Компот из абрикосов 2-122 по","Компот из айвы. Консервы",0.4,0.3,19.7,2.2,18.5,1.2,0.4,76.7,82.0],
["11.1.4.5","11",178,"Компот из абрикосов 2-122 по","Компот вишневый по 2-120",0.2,0.1,13.8,0.4,13.8,0.0,0.3,85.1,57.0],
["11.1.4.6","11",180,"Компот из абрикосов 2-122 по","Компот из вишни. Консервы",0.6,0.3,23.7,1.8,23.7,0.0,1.3,72.0,101.0],
["11.1.4.7","11",180,"Компот из абрикосов 2-122 по","Компот грушевый по 2-118",0.1,0.1,13.4,0.6,13.3,0.1,0.2,85.5,55.0],
["11.1.4.8","11",180,"Компот из абрикосов 2-122 по","Компот из груш. Консервы",0.2,0.2,18.1,2.1,17.8,0.3,0.2,79.0,74.0],
["11.1.4.9","11",180,"Компот из абрикосов 2-122 по","Компот из и крыжовника черной смородины 2-124 по",0.3,0.1,13.9,1.2,13.9,0.0,0.5,83.7,58.0],
["11.1.4.10","11",180,"Компот из абрикосов 2-122 по","Компот персиковый по 2-122",0.2,0.0,21.8,0.4,21.6,0.2,0.1,77.4,88.0],
["11.1.4.11","11",180,"Компот из абрикосов 2-122 по","Компот из персиков. Консервы",0.3,0.0,21.6,1.0,21.3,0.3,0.3,76.5,88.0],
["11.1.4.12","11",180,"Компот из абрикосов 2-122 по","Компот черешневый по 2-120",0.2,0.1,14.0,0.2,14.0,0.0,0.2,85.2,58.0],
["11.1.4.13","11",180,"Компот из абрикосов 2-122 по","Компот из черешни. Консервы",0.5,0.2,20.6,1.1,20.6,0.0,0.4,76.8,87.0],
["11.1.4.14","11",180,"Компот из абрикосов 2-122 по","Компот яблочный по 2-118",0.1,0.1,13.6,0.4,13.4,0.2,0.2,85.5,55.0],
["11.1.4.15","11",180,"Компот из абрикосов 2-122 по","Компот из яблок. Консервы",0.2,0.2,22.3,1.7,22.0,0.3,0.4,75.0,93.0],
["11.1.4.16","11",180,"Компот из абрикосов 2-122 по","Яблоки в сиропе. Консервы",0.2,0.1,11.5,1.7,11.3,0.2,0.5,85.8,48.0],
["11.1.5.1","11",182,"Кисели","Кисель из вишневого сока по 2-132",0.2,0.0,18.9,0.1,14.9,4.0,0.5,80.2,78.0],
["11.1.5.2","11",182,"Кисели","Кисель из клюквы по 2-126",0.0,0.0,13.0,0.4,9.6,3.4,0.3,86.2,53.0],
["11.1.5.3","11",182,"Кисели","Кисель из кураги 2-130 по",0.4,0.0,12.9,1.8,9.2,3.7,0.3,84.2,54.0],
["11.1.5.4","11",182,"Кисели","Кисель из сливового варенья по 2-134",0.1,0.0,15.5,0.1,12.7,2.8,0.2,84.0,63.0],
["11.1.5.5","11",182,"Кисели","Кисель из яблок сушеных 2-130 по",0.1,0.0,16.3,0.9,13.3,3.0,0.2,82.4,66.0],
["11.1.5.6","11",182,"Кисели","Кисель из яблок 2-128 по",0.1,0.1,23.7,0.3,11.0,12.7,0.2,75.5,97.0],
["11.1.7.1","11",182,"Чай","Чай с сахаром по 2-154",0.1,0.0,7.0,0.0,7.0,0.0,0.0,92.8,28.0],
["11.1.7.2","11",182,"Чай","Чай с лимоном по 2-154",0.1,0.0,6.8,0.1,6.8,0.0,0.2,92.7,28.0],
["11.1.7.3","11",182,"Чай","Чай с молоком по 2-154",0.7,0.8,8.2,0.0,8.2,0.0,0.0,90.1,43.0],
["11.1.8.1","11",184,"Кофе","Кофе жареный в зернах",13.9,14.4,29.5,22.2,2.8,null,9.2,4.7,331.0],
["11.1.8.2","11",184,"Кофе","Кофе черный (без сахара) 2-154 по",0.2,0.5,0.2,0.0,0.1,0.1,0.3,98.7,7.0],
["11.1.8.3","11",184,"Кофе","Кофе на молоке по 2-154",0.7,1.0,11.2,0.0,11.2,0.0,0.3,86.6,58.0],
["11.1.8.4","11",184,"Кофе","Кофе на молоке сгущенном по 2-154",0.7,0.9,10.9,0.0,10.9,0.0,0.3,87.0,55.0],
["11.1.9.1","11",184,"Минеральные воды","«Боржоми»",0.0,0.0,0.0,0.0,0.0,0.0,0.0,99.4,0.0],
["11.1.9.2","11",184,"Минеральные воды","«Нарзан»",0.0,0.0,0.0,0.0,0.0,0.0,0.0,99.7,0.0],
["11.1.9.3","11",184,"Минеральные воды","«Ессентуки № 4»",0.0,0.0,0.0,0.0,0.0,0.0,0.0,99.1,0.0],
["11.1.10.1","11",184,"Напитки газированные","На цитрусовых настоях",0.0,0.0,7.5,0.0,7.5,0.0,0.1,91.9,33.0],
["11.1.10.2","11",184,"Напитки газированные","На плодовоягодных настоях",0.0,0.0,9.5,0.0,9.5,0.0,1.8,88.0,46.0],
["11.1.10.3","11",184,"Напитки газированные","На эссенциях («Кока-кола», «Пепси-кола», «Байкал» и др.)",0.0,0.0,8.7,0.0,8.7,0.0,1.2,90.0,38.0],
["12.1.1","12",190,"Вспомогательные пищевые продукты","Дрожжи прессованные (*эргостерин)",12.7,2.7,8.5,0.0,8.5,0.0,0.0,74.0,109.0],
["12.1.2","12",190,"Вспомогательные пищевые продукты","Соль поваренная пищевая",0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.2,0.0],
["12.1.3","12",190,"Вспомогательные пищевые продукты","Винный уксус (3%)",0.0,0.0,0.0,0.0,0.0,0.0,3.0,97.0,9.0],
["12.1.4","12",190,"Вспомогательные пищевые продукты","Желатин",87.2,0.4,0.7,0.0,0.0,0.7,0.0,10.0,355.0],
["12.1.5","12",190,"Вспомогательные пищевые продукты","Отруби пшеничные",16.0,3.8,16.6,43.6,5.0,11.6,0.0,15.0,165.0],
["12.2.1","12",190,"Улучшители вкусовых блюд","Соус красный основной по 2-74",1.1,2.0,6.2,0.5,3.2,3.0,0.1,88.5,48.0],
["12.2.2","12",190,"Улучшители вкусовых блюд","белый Соус основной по 2-82",1.0,4.1,3.8,0.4,0.4,3.4,0.0,89.1,56.0],
["12.2.3","12",190,"Улучшители вкусовых блюд","Соус грибной 2-96 по",1.2,6.2,4.8,1.4,2.1,2.7,0.0,85.1,82.0],
["12.2.4","12",190,"Улучшители вкусовых блюд","Соус луковый 2-76 по",1.3,4.8,6.1,1.0,4.0,2.1,0.6,84.8,75.0],
["12.2.5","12",190,"Улучшители вкусовых блюд","Соус майонез сметаной со 2-102 по",2.8,31.9,3.3,0.0,3.3,0.0,0.6,61.3,312.0],
["12.2.6","12",190,"Улучшители вкусовых блюд","Соус молочный 2-92 по",2.0,5.2,7.1,0.2,3.4,3.7,0.1,84.2,84.0],
["12.2.7","12",190,"Улучшители вкусовых блюд","Соус польский по 2-98",2.6,6.1,3.0,0.2,0.6,2.4,0.2,86.6,78.0],
["12.2.8","12",190,"Улучшители вкусовых блюд","Соус сметанный по 2-94",1.9,5.2,5.7,0.3,0.8,4.9,0.2,85.7,78.0],
["12.2.9","12",190,"Улучшители вкусовых блюд","Соус клюквенный по 2-112",0.0,0.0,12.6,0.2,10.6,2.0,0.3,86.9,51.0],
["12.2.10","12",192,"Улучшители вкусовых блюд","томатный Соус 2-84 по Соус черносмородиновый 2-110 по",1.7,4.5,7.8,0.7,5.2,2.6,0.5,82.8,80.0],
["12.2.12","12",192,"Улучшители вкусовых блюд","Соус с хреном по 2-104",0.7,0.1,4.2,2.1,3.3,0.9,2.2,88.4,27.0],
["12.2.13","12",192,"Улучшители вкусовых блюд","Заправка салата для по 2-106",0.0,23.3,4.8,0.0,4.8,0.0,2.1,67.9,235.0],
["12.2.14","12",192,"Улучшители вкусовых блюд","Маринад овощной без томата по 2-106",1.2,9.1,10.5,2.3,9.0,1.5,1.8,73.2,134.0],
["12.2.15","12",192,"Улучшители вкусовых блюд","Горчица столовая по 2-108",9.9,5.3,12.7,1.7,9.9,2.8,1.7,63.9,143.0],
["12.2.16","12",192,"Улучшители вкусовых блюд","Порошок горчичный",37.1,11.1,32.6,5.9,21.6,11.0,0.0,7.3,378.0]
];
