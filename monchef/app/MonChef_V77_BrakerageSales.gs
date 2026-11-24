/**
 * MON CHEF V77 — бракераж по продажам: список блюд составляет система, человек оценивает одним нажатием.
 *
 * Откуда список (сегодня, по часовому поясу проекта):
 *   • «Продано без бракеража» — блюда по ТТК, проданные сегодня под заказ (лист «Продажи_Списание_V71»: списано не только
 *     с готовых партий), по которым сегодня нет оценки в журнале бракеража (J02);
 *   • «Обычно продаётся» — блюда, которые продавались под заказ за 7 предыдущих дней и сегодня ещё не оценены:
 *     их удобно оценить до начала продаж;
 *   • «Оценено сегодня» — строки J02 за сегодня; если оценка позже первой продажи, это видно («после первой продажи»).
 * Блюда из готовых партий (выпуск на производстве) оцениваются по партии — прежним порядком, здесь их нет; оценка партии
 *   производства не засчитывается за порции, приготовленные под заказ (это другое приготовление).
 *
 * «Соответствует» записывает строку J02 через ту же проверку, что и форма бракеража (_addBrakerageEntry_core_):
 * дата, время, блюдо, «соответствует» по внешнему виду, вкусу и запаху, «Отпуск разрешён», бракер — вошедший сотрудник,
 * повар — если указан. Решение принимает человек: без нажатия система ничего не записывает и оценку не подставляет.
 * «Замечания» — подробная форма бракеража с этим блюдом (доработка, брак).
 */
var MC_V77_VIEW_ = 'brakerage|haccp|haccp_view', MC_V77_ACT_ = 'brakerage';
var MC_V77_OK_ = 'соответствует';

function _v77Lo_(s) { return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/\s*\(ттк, версия[^)]*\)\s*$/, '').replace(/[«»"]/g, '').replace(/\s+/g, ' ').trim(); }
function _v77Day_(d) { return Utilities.formatDate(d, _mcTz_(), 'yyyy-MM-dd'); }
function _v77D_(x) {
  if (x instanceof Date) return isNaN(x.getTime()) ? null : x;
  var s = String(x || '').trim(), m;
  if ((m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(s))) return new Date(+m[3], +m[2] - 1, +m[1]);
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return new Date(+m[1], +m[2] - 1, +m[3]);
  return null;
}
function _v77HM_(x) { if (x instanceof Date) return Utilities.formatDate(x, _mcTz_(), 'HH:mm'); var m = /(\d{1,2}):(\d{2})/.exec(String(x || '')); return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : ''; }
/** Продажи блюд по ТТК под заказ: { day, hm, name, code, qty, seller }. */
function _v77Sales_(fromDay, toDay) {
  var out = [], sh = null;
  try { sh = _book_().getSheetByName(MC_V71.SHEET); } catch (e) {}
  if (!sh) return out;
  var v = sh.getDataRange().getValues(), H = v[0] || [], c = function (n) { return H.indexOf(n); };
  var cD = c('Дата продажи'), cT = c('Время'), cN = c('Что продано'), cK = c('Вид'), cC = c('Код ТТК / ProductID'), cQ = c('Кол-во'), cL = c('Списано по партиям (JSON)'), cS = c('Продавец');
  for (var i = 1; i < v.length; i++) {
    if (!v[i][0] || !/ттк/i.test(String(v[i][cK] || ''))) continue;
    var d = _v77D_(v[i][cD]); if (!d) continue; var day = _v77Day_(d);
    if (day < fromDay || day > toDay) continue;
    var lines = []; try { lines = JSON.parse(String(v[i][cL] || '[]')) || []; } catch (e) {}
    var toOrder = !lines.length || lines.some(function (l) { return l.from !== 'READY'; });
    if (!toOrder) continue;
    out.push({ day: day, hm: _v77HM_(v[i][cT]), name: String(v[i][cN] || ''), code: String(v[i][cC] || ''), qty: Number(v[i][cQ]) || 0, seller: String(v[i][cS] || '') });
  }
  return out;
}
/** Оценки бракеража блюд под заказ за день из J02 (строки без партии склада): { ключ блюда → [{ hm, by, decision, dish }] }. */
function _v77Brak_(day) {
  var out = {}, j = (typeof JOURNALS !== 'undefined' ? JOURNALS : []).filter(function (x) { return x.id === 'J02'; })[0];
  if (!j) return out;
  var sh = _book_().getSheetByName(j.sheetName); if (!sh) return out;
  var v = sh.getDataRange().getValues(), C = j.columns, ix = function (n) { return C.indexOf(n); };
  for (var i = 1; i < v.length; i++) {
    var d = _v77D_(v[i][ix('Дата')]); if (!d || _v77Day_(d) !== day) continue;
    var dec = String(v[i][ix('Решение (отпуск/брак)')] || ''); if (!dec || /ожидает/.test(dec)) continue;
    if (/^(B\d{6,}|MC-\d{8}-\d{6})/.test(String(v[i][ix('Партия')] || ''))) continue;   // оценка партии производства не относится к порциям под заказ
    var k = _v77Lo_(v[i][ix('Наименование блюда')]); if (!k) continue;
    (out[k] = out[k] || []).push({ hm: _v77HM_(v[i][ix('Время изготовления')]), by: String(v[i][ix('ФИО бракера')] || ''), decision: dec, dish: String(v[i][ix('Наименование блюда')] || '') });
  }
  return out;
}
function _v77List_() {
  var now = new Date(), today = _v77Day_(now), from = _v77Day_(new Date(now.getTime() - 7 * 86400000)), y = _v77Day_(new Date(now.getTime() - 86400000));
  var S = _v77Sales_(from, today), B = _v77Brak_(today), M = {};
  S.forEach(function (s) {
    var k = _v77Lo_(s.name), x = M[k] = M[k] || { key: k, dish: s.name, code: s.code, soldToday: 0, firstSale: '', sellers: [], soldWeek: 0 };
    if (s.day === today) { x.soldToday += s.qty; if (!x.firstSale || s.hm < x.firstSale) x.firstSale = s.hm; if (s.seller && x.sellers.indexOf(s.seller) < 0) x.sellers.push(s.seller); }
    else if (s.day <= y) x.soldWeek += s.qty;
  });
  Object.keys(B).forEach(function (k) { if (!M[k]) M[k] = { key: k, dish: B[k][0].dish.replace(/\s*\(ТТК, версия[^)]*\)\s*$/, ''), code: '', soldToday: 0, firstSale: '', sellers: [], soldWeek: 0 }; });
  var items = Object.keys(M).map(function (k) {
    var x = M[k], b = (B[k] || []).slice().sort(function (p, q) { return p.hm < q.hm ? -1 : 1; })[0] || null;
    x.brak = b ? { hm: b.hm, by: b.by, decision: b.decision, late: !!(x.firstSale && b.hm && b.hm > x.firstSale) } : null;
    x.status = b ? 'DONE' : x.soldToday > 0 ? 'SOLD' : 'EXPECTED';
    return x;
  });
  var rank = { SOLD: 0, EXPECTED: 1, DONE: 2 };
  items.sort(function (p, q) { return rank[p.status] - rank[q.status] || q.soldToday - p.soldToday || q.soldWeek - p.soldWeek || p.dish.localeCompare(q.dish, 'ru'); });
  return { day: today, items: items };
}
function _v77Counts_() {
  try { var L = _v77List_().items; return { sold: L.filter(function (x) { return x.status === 'SOLD'; }).length, expected: L.filter(function (x) { return x.status === 'EXPECTED'; }).length, done: L.filter(function (x) { return x.status === 'DONE'; }).length }; }
  catch (e) { return { sold: 0, expected: 0, done: 0 }; }
}
function v77BrakData(token) {
  var op = null;
  try { op = _beginOp_(token, MC_V77_VIEW_, 'BRAKERAGE_SALES_VIEW', 'Бракераж', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var L = _v77List_(), staff = [];
    try { staff = JSON.parse(getEmployees() || '[]').filter(function (e) { return e.active !== false; }).map(function (e) { return { name: e.name, position: e.position || '' }; }); } catch (e) {}
    _endOp_(op);
    return _ok_({ day: Utilities.formatDate(new Date(), _mcTz_(), 'dd.MM.yyyy'), items: L.items, staff: staff,
      counts: { sold: L.items.filter(function (x) { return x.status === 'SOLD'; }).length, expected: L.items.filter(function (x) { return x.status === 'EXPECTED'; }).length, done: L.items.filter(function (x) { return x.status === 'DONE'; }).length } }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** «Соответствует» по одному или нескольким блюдам: строки J02 той же проверкой, что форма бракеража. */
function v77BrakConfirm(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V77_ACT_, 'BRAKERAGE_QUICK', 'Бракераж', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), dishes = (Array.isArray(d.dishes) ? d.dishes : [d.dish]).map(function (x) { return String(x || '').trim(); }).filter(String);
    if (!dishes.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Выберите блюдо', op.id); }
    if (d.confirm !== true) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Подтвердите, что оценили блюдо сами: внешний вид, вкус, запах', op.id); }
    var cook = String(d.cookName || '').trim();
    if (cook) { var emps = []; try { emps = JSON.parse(getEmployees() || '[]'); } catch (e) {} if (!emps.some(function (e) { return e.name === cook && e.active !== false; })) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Повар — из действующих сотрудников', op.id); } }
    var idx = _buildDishIndexes_(), done = [], skipped = [], refused = [];
    var known = {}; Object.keys(idx.dishByCode).forEach(function (c) { known[_v77Lo_(idx.dishByCode[c].name)] = idx.dishByCode[c].name; });
    return _withLock_(function () {
      var B = _v77Brak_(_v77Day_(new Date()));
      dishes.forEach(function (name) {
        var k = _v77Lo_(name);
        if (!known[k]) { refused.push({ dish: name, reason: 'нет такого блюда в ТТК' }); return; }
        if (B[k]) { skipped.push({ dish: known[k], reason: 'уже оценено сегодня в ' + B[k][0].hm + ' (' + B[k][0].by + ')' }); return; }
        var r = {}; try { r = JSON.parse(_addBrakerageEntry_core_(JSON.stringify({ dishName: known[k], appearance: MC_V77_OK_, taste: MC_V77_OK_, smell: MC_V77_OK_, decision: 'RELEASE', cookName: cook }), token) || '{}'); } catch (e) { r = { error: String(e.message || e) }; }
        if (r && r.ok) { done.push({ dish: known[k], time: r.time, braker: r.braker }); B[k] = [{ hm: r.time, by: r.braker }]; }
        else refused.push({ dish: known[k], reason: (r && r.error && (r.error.message || r.error)) || 'не записано' });
      });
      _audit_(op, 'BRAKERAGE_QUICK', 'Бракераж', 'J02', null, { done: done.map(function (x) { return x.dish; }), skipped: skipped.length, refused: refused.map(function (x) { return x.dish + ': ' + x.reason; }) });
      _endOp_(op, done.length ? 'COMPLETED' : 'FAILED');
      if (!done.length && refused.length) return _fail_('VALIDATION', refused.map(function (x) { return x.dish + ': ' + x.reason; }).join('; '), op.id);
      return _ok_({ done: done, skipped: skipped, refused: refused }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- главное окно: кнопка «Бракераж» первой у тех, кто ведёт бракераж ---------------- */
(function () {
  if (typeof _UI_BUILDERS_ !== 'object') return;
  var add = function (sec, first) {
    var orig = _UI_BUILDERS_[sec]; if (typeof orig !== 'function') return;
    _UI_BUILDERS_[sec] = function (token, opts, s) {
      var r = orig(token, opts, s) || {};
      try {
        if (!s || _mcRbHasExact_(s, MC_V77_ACT_)) {
          var n = _v77Counts_(), wait = n.sold + n.expected, btn = { label: 'Бракераж' + (wait ? ': ждут ' + wait : ': всё оценено'), module: 'brakesales' };
          r.actions = first ? [btn].concat(r.actions || []) : (r.actions || []).concat([btn]);
          if (first && n.sold) r.kpis = [{ label: 'Продано без бракеража', value: n.sold, hint: 'блюд — оцените', tone: 'red', go: { module: 'brakesales' } }].concat(r.kpis || []);
        }
      } catch (e) {}
      return r;
    };
  };
  add('home', true); add('production', false);
})();
try { if (MC_UI_VIEWS_.indexOf('brakesales') < 0) MC_UI_VIEWS_ = MC_UI_VIEWS_.concat(['brakesales']); } catch (e) {}
