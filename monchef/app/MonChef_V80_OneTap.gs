/**
 * MonChef V80 — одно нажатие вместо форм (17.11.2026).
 *
 *  1. Бракераж партий производства: в одном списке с блюдами под заказ (экран «Бракераж»), «✓ Соответствует» одним нажатием —
 *     строка J02, заведённая при выпуске, дописывается той же проверкой, что форма; замечания — обычная форма.
 *  2. Входной контроль: для товара, который в прошлый раз принят с «температура не измеряется», причина берётся из той записи
 *     (кто и когда её указал); для охлаждённого и замороженного — вводится только измеренная температура, пределы — из базы
 *     нормативов или прошлой приёмки. Органолептику и упаковку человек подтверждает одним нажатием.
 *  3. Сроки годности (J05, КТ-9): вопрос «на полке так же» — только по партиям, у которых срок истекает сегодня или завтра
 *     и по просроченным (было — неделя). Порог — свойство MC_ROTATION_DAYS (0–7 дней).
 *  4. Суточная проба: кнопка на главном экране «Суточные пробы: ждут N»; тара, место и термометр — как в прошлой пробе,
 *     температуру в холодильнике для проб человек измеряет и вводит.
 * Органолептика, решения и измерения система сама не подставляет: запись — только после нажатия и подтверждения человеком.
 */
var MC_V80_OK_ = 'соответствует';
var MC_V80_BATCH_RE_ = /^(B\d{6,}|MC-\d{8}-\d{6})/;

/* ---------------- 1. бракераж партий ---------------- */
/** Партии производства, ждущие бракеража: строки J02 с партией без решения (или «ожидает»), партия на складе не забракована. */
function _v80BrakPending_() {
  var out = [], j = (typeof JOURNALS !== 'undefined' ? JOURNALS : []).filter(function (x) { return x.id === 'J02'; })[0]; if (!j) return out;
  var sh = _book_().getSheetByName(j.sheetName); if (!sh || sh.getLastRow() < 2) return out;
  var v = sh.getDataRange().getValues(), C = j.columns, ix = function (n) { return C.indexOf(n); }, seen = {};
  for (var i = v.length - 1; i >= 1; i--) {
    var pv = String(v[i][ix('Партия')] || ''), m = MC_V80_BATCH_RE_.exec(pv); if (!m) continue;
    var dec = String(v[i][ix('Решение (отпуск/брак)')] || ''); if (dec && !/ожидает/.test(dec)) { seen[m[1]] = true; continue; }
    if (seen[m[1]]) continue; seen[m[1]] = true;
    var b = null; try { b = _bcFind_(m[1]); } catch (e) {}
    if (!b) continue; var st = String(b.v[10] || 'active'); if (st !== 'active' && st !== 'recheck') continue;
    var d = v[i][ix('Дата')], t = v[i][ix('Время изготовления')];
    out.push({ batchId: m[1], dish: String(v[i][ix('Наименование блюда')] || b.v[1]).replace(/\s*\(ТТК, версия[^)]*\)\s*$/, ''), product: String(b.v[1]),
      made: (d instanceof Date ? Utilities.formatDate(d, _mcTz_(), 'dd.MM') : String(d || '')) + ' ' + (t instanceof Date ? Utilities.formatDate(t, _mcTz_(), 'HH:mm') : String(t || '')),
      cook: String(v[i][ix('ФИО повара')] || ''), qty: b.v[9], unit: String(b.v[2] || '') });
  }
  return out.reverse();
}
/** «Соответствует» по партии: {batchId, confirm: true}. Строка J02 выпуска дописывается: органолептика «соответствует», «Отпуск разрешён». */
function v80BrakBatch(json, token) {
  var op = null, d = {};
  try { d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}); op = _beginOp_(token, 'brakerage', 'BRAKERAGE_BATCH_QUICK', 'Бракераж', String(d.batchId || ''), null); } catch (e) { return _failFrom_(e); }
  try {
    var ids = (Array.isArray(d.batchIds) ? d.batchIds : [d.batchId]).map(function (x) { return String(x || '').trim(); }).filter(String);
    if (!ids.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Выберите партию', op.id); }
    if (d.confirm !== true) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Подтвердите, что оценили партию сами: внешний вид, вкус, запах', op.id); }
    var pend = {}; _v80BrakPending_().forEach(function (x) { pend[x.batchId] = x; });
    var done = [], refused = [];
    ids.forEach(function (id) {
      var p = pend[id]; if (!p) { refused.push({ batchId: id, reason: 'партия не ждёт бракеража' }); return; }
      var r = {}; try { r = JSON.parse(_addBrakerageEntry_core_(JSON.stringify({ dishName: p.product, batchId: id, appearance: MC_V80_OK_, taste: MC_V80_OK_, smell: MC_V80_OK_, decision: 'RELEASE' }), token) || '{}'); }
      catch (e) { r = { error: String(e && e.message || e) }; }
      if (r && r.ok) done.push({ batchId: id, dish: p.dish, braker: r.braker, time: r.time });
      else refused.push({ batchId: id, reason: (r && r.error && (r.error.message || r.error)) || 'не записано' });
    });
    _audit_(op, 'BRAKERAGE_BATCH_QUICK', 'Бракераж', 'J02', null, { done: done.map(function (x) { return x.batchId; }), refused: refused.map(function (x) { return x.batchId + ': ' + x.reason; }) });
    _endOp_(op, done.length ? 'COMPLETED' : 'FAILED');
    if (!done.length) return _fail_('VALIDATION', refused.map(function (x) { return x.batchId + ' — ' + x.reason; }).join('; '), op.id);
    return _ok_({ done: done, refused: refused }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
// экран «Бракераж» (V77): партии производства — в том же списке; кнопка на главном экране считает и их
(function () {
  try {
    var o = v77BrakData;
    v77BrakData = function (token) {
      var r = o(token);
      try { var x = typeof r === 'string' ? JSON.parse(r) : r; if (x && (x.ok || x.success) && x.data) { x.data.batches = _v80BrakPending_(); x.data.counts.batches = x.data.batches.length; return typeof r === 'string' ? JSON.stringify(x) : x; } } catch (e) {}
      return r;
    };
  } catch (e) {}
  try { var c = _v77Counts_; _v77Counts_ = function () { var n = c(); try { n.expected += _v80BrakPending_().length; } catch (e) {} return n; }; } catch (e) {}
})();

/* ---------------- 2. входной контроль ---------------- */
/** Прошлая принятая приёмка этого товара: причина «t° не измеряется» или пределы, кто и когда. */
function _v80PrevControl_() {
  var sh = _book_().getSheetByName(MC_BC_IN_), out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  var v = sh.getDataRange().getValues(), H = v[0], ix = function (n) { return H.indexOf(n); };
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][ix('Решение')]) !== 'RELEASED' && String(v[i][ix('Решение')]) !== 'HOLD_VSD') continue;
    var k = _prodKey_(v[i][ix('Продукт')]), t = String(v[i][ix('t° факт')] === null ? '' : v[i][ix('t° факт')]), at = v[i][ix('Время')];
    var m = /^не требуется:\s*(.+)$/.exec(t);
    out[k] = { noTemp: !!m, reason: m ? m[1] : '', tMin: v[i][ix('t° мин')] === '' ? null : Number(v[i][ix('t° мин')]), tMax: v[i][ix('t° макс')] === '' ? null : Number(v[i][ix('t° макс')]),
      by: String(v[i][ix('Сотрудник')] || ''), at: at instanceof Date ? Utilities.formatDate(at, _mcTz_(), 'dd.MM.yyyy') : String(at || ''), batchId: String(v[i][ix('BatchID')] || '') };
  }
  return out;
}
(function () {
  if (typeof _bcControlList_ !== 'function') return;
  var orig = _bcControlList_;
  _bcControlList_ = function () {
    var out = orig.apply(this, arguments);
    try { var P = _v80PrevControl_(); ['quarantine', 'recheck'].forEach(function (k) { (out[k] || []).forEach(function (it) { var p = P[_prodKey_(it.product)]; if (p && p.batchId !== String(it.batchId)) it.prev = p; }); }); } catch (e) {}
    return out;
  };
})();

/* ---------------- 3. сроки годности: только истекающие ---------------- */
function _v80RotDays_() {
  var n = parseInt(PropertiesService.getScriptProperties().getProperty('MC_ROTATION_DAYS') || '1', 10);
  return isFinite(n) ? Math.max(0, Math.min(7, n)) : 1;
}
/** Порог вопросов J05 (дней до конца срока, 0–7): {days}. Ответственный за ХАССП. */
function v80SetRotationDays(days, token) {
  var op = null;
  try { op = _beginOp_(token, 'haccp|system', 'ROTATION_DAYS_SET', 'Журналы', 'J05', null); } catch (e) { return _failFrom_(e); }
  try {
    var n = parseInt(days, 10); if (!(n >= 0 && n <= 7)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Порог — от 0 до 7 дней', op.id); }
    var old = _v80RotDays_(); PropertiesService.getScriptProperties().setProperty('MC_ROTATION_DAYS', String(n));
    _audit_(op, 'ROTATION_DAYS_SET', 'Журналы', 'J05', { days: old }, { days: n });
    _endOp_(op); return _ok_({ days: n }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- 4. суточная проба ---------------- */
(function () {
  if (typeof _dsState_ !== 'function') return;
  var o = _dsState_;
  _dsState_ = function () {
    var s = o.apply(this, arguments);
    try { var R = _dsRows_(), x = R[R.length - 1]; if (x) s.last = { container: String(x.container || ''), location: String(x.location || ''), equipmentId: String(x.equipment || ''), portion: x.portion === 'да', who: String(x.who || ''), taken: _bcDate_(x.taken) }; } catch (e) {}
    return s;
  };
})();

/* ---------------- главное окно: «Суточные пробы: ждут N» ---------------- */
(function () {
  if (typeof _UI_BUILDERS_ !== 'object') return;
  var add = function (sec) {
    var orig = _UI_BUILDERS_[sec]; if (typeof orig !== 'function') return;
    _UI_BUILDERS_[sec] = function (token, opts, s) {
      var r = orig(token, opts, s) || {};
      try {
        if (s && !s.dev && _mcRbHasExact_(s, 'journals')) {
          var n = _dsMissing_().length;
          if (n) r.actions = (r.actions || []).concat([{ label: 'Суточные пробы: ждут ' + n, module: 'samples' }]);
        }
      } catch (e) {}
      return r;
    };
  };
  add('home'); add('production');
})();
