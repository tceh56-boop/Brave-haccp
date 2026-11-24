/**
 * MonChef V83 — обработка яиц по расходу (17.11.2026).
 *
 * Пример предприятия: в бракераже «Салат Оливье», 10 порций; по ТТК на них 5 яиц. Сколько яиц и из какой партии ушло в блюдо,
 * система уже знает: при выпуске на производстве и при продаже под заказ склад списывает яйца по партиям (TRACE_LINKS:
 * «РАСХОДОВАНА_НА» выпуск, «РЕАЛИЗОВАНА_В» продажу). Отсюда список «яйца израсходованы — обработка не записана»:
 * «Салат Оливье — 10 порц.: 5 шт, партия …». Повар нажимает «Обработал по режиму» и подтверждает — строка журнала обработки
 * яиц (V82) с режимом из утверждённого, количеством из расхода, ссылкой на блюдо и временем нажатия.
 *
 *  - Без нажатия система ничего не пишет: обработку делает человек, запись — его подтверждение.
 *  - Учитываются записи «обработал партию на складе» (V82): обработанные заранее яйца покрывают расход этой партии.
 *  - Список ведётся с момента, когда ответственный за ХАССП выбрал режим обработки (до этого обработка не настроена).
 *  - Напоминание — в «Бракераже», на главном экране и на экране «Яйца»; за последние 3 суток. Более старый расход без записи
 *    показывается числом — это пробел, его не «закрывают» задним числом.
 */
var MC_V83_DAYS_ = 3, MC_V83_VIEW_ = 'journals|haccp_view|brakerage|haccp';

function _v83ProcSheet_() {
  var sh = _bcSheet_(MC_V82_PROC_, MC_V82_PROC_HEAD_), w = MC_V82_PROC_HEAD_.length;
  var h = sh.getRange(1, 1, 1, w).getValues()[0];
  if (String(h[w - 2]) !== MC_V82_PROC_HEAD_[w - 2] || String(h[w - 1]) !== MC_V82_PROC_HEAD_[w - 1]) sh.getRange(1, w - 1, 1, 2).setValues([[MC_V82_PROC_HEAD_[w - 2], MC_V82_PROC_HEAD_[w - 1]]]);   // лист V82 до этой версии
  return sh;
}
function _v83Start_() { var x = Number(_v82Props_().getProperty('MC_V82_EGG_REGIME_AT') || 0); return x > 0 ? x : 0; }
function _v83Base_(q, u) { var b = _toBaseUnitServer_(Number(q) || 0, u); return b; }
function _v83Ref_(type, id, cache) {
  var k = type + '|' + id; if (cache[k]) return cache[k];
  var pid = type === 'PRODUCTION' ? ((/PR\d+/.exec(String(id)) || [String(id)])[0]) : String(id);   // в связи выпуска — «Производство PR…»
  var o = { text: (type === 'PRODUCTION' ? 'выпуск ' : 'продажа ') + pid, dish: '' };
  try {
    if (type === 'PRODUCTION') {
      if (!cache._prod) cache._prod = _productionSheet_().getDataRange().getValues();
      var P = cache._prod;
      for (var i = 1; i < P.length; i++) if (String(P[i][PROD_COL_.id]) === pid) {
        var q = P[i][PROD_COL_.fact] !== '' && P[i][PROD_COL_.fact] != null ? P[i][PROD_COL_.fact] : P[i][PROD_COL_.plan];
        o.dish = String(P[i][PROD_COL_.name] || ''); o.text = o.dish + ' — ' + q + ' ' + String(P[i][PROD_COL_.unit] || '') + ' (выпуск ' + pid + ')'; break;
      }
    } else {
      if (!cache._sale) { var sh = _book_().getSheetByName(MC_V71.SHEET); cache._sale = sh ? sh.getDataRange().getValues() : [[]]; }
      var S = cache._sale, H = S[0] || [], c = function (n) { return H.indexOf(n); };
      for (var j = 1; j < S.length; j++) if (String(S[j][0]) === String(id)) {
        o.dish = String(S[j][c('Что продано')] || ''); o.text = o.dish + ' — ' + S[j][c('Кол-во')] + ' ' + String(S[j][c('Ед.')] || '') + ' (продажа ' + id + ')'; break;
      }
    }
  } catch (e) {}
  cache[k] = o; return o;
}
/** Расход яиц без записи об обработке: { pending: [...за 3 сут], older: N, start }. */
function _v83Pending_() {
  var start = _v83Start_(), out = { pending: [], older: 0, start: start };
  if (!start || !_v82Regime_()) return out;
  var B = {}, v = _stockBatchesSheet_().getDataRange().getValues();
  for (var i = 1; i < v.length; i++) { var k = v[i][0] && _v82Kind_(v[i][1]); if (k && k !== 'WATERFOWL') B[String(v[i][0])] = { product: String(v[i][1]), unit: String(v[i][2] || 'шт'), kind: k }; }
  if (!Object.keys(B).length) return out;
  var tl = _mcTraceSheet_().getDataRange().getValues(), ev = {};
  for (var t = 1; t < tl.length; t++) {
    var r = tl[t], rel = String(r[3]), bid = String(r[2]);
    if (String(r[1]) !== 'BATCH' || !B[bid] || (rel !== 'РАСХОДОВАНА_НА' && rel !== 'РЕАЛИЗОВАНА_В')) continue;
    var at = r[7] instanceof Date ? r[7].getTime() : new Date(r[7]).getTime(); if (!(at >= (String(r[4]) === 'SALE' ? start - start % 60000 : start))) continue;   // время продажи — до минуты
    var q = _v83Base_(r[10], r[11] || B[bid].unit).qty; if (!(q > 0)) continue;
    var key = bid + '|' + String(r[5]);
    (ev[bid] = ev[bid] || []);
    var ex = ev[bid].filter(function (e) { return e.key === key; })[0];
    if (ex) ex.qty += q; else ev[bid].push({ key: key, batchId: bid, refType: String(r[4]), ref: String(r[5]), at: at, qty: q });
  }
  var spec = {}, gen = {};
  _v82Rows_(MC_V82_PROC_, MC_V82_PROC_HEAD_).forEach(function (x) {
    var bid = String(x['Партия'] || ''); if (!B[bid]) return;
    var q = _v83Base_(x['Количество'], x['Ед.'] || B[bid].unit).qty, ref = String(x['Расход (ID)'] || '');
    if (ref) spec[bid + '|' + ref] = (spec[bid + '|' + ref] || 0) + q; else gen[bid] = (gen[bid] || 0) + q;
  });
  var cache = {}, lim = Date.now() - MC_V83_DAYS_ * 864e5;
  Object.keys(ev).forEach(function (bid) {
    var g = gen[bid] || 0, f = _v83Base_(1, B[bid].unit).qty || 1;
    ev[bid].sort(function (a, b) { return a.at - b.at; }).forEach(function (e) {
      var s = Math.min(e.qty, spec[e.key] || 0), rem = e.qty - s; spec[e.key] = (spec[e.key] || 0) - s;
      var gg = Math.min(rem, g); g -= gg; rem -= gg;
      if (rem <= 0.0005) return;
      if (e.at < lim) { out.older++; return; }
      var need = rem / f; need = /^шт/i.test(B[bid].unit) ? Math.ceil(need - 1e-9) : Math.round(need * 1000) / 1000;
      var R = _v83Ref_(e.refType, e.ref, cache);
      out.pending.push({ key: e.key, batchId: bid, product: B[bid].product, unit: B[bid].unit, qty: need, ref: e.ref, refType: e.refType, dish: R.dish, text: R.text,
        at: Utilities.formatDate(new Date(e.at), _mcTz_(), 'dd.MM HH:mm') });
    });
  });
  out.pending.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  return out;
}
function _v83Can_(s) { return !!s && !s.dev && _mcRbHasExact_(s, 'journals'); }
function _v83Summary_(s) {
  var P = _v83Pending_(), rg = _v82Regime_();
  return { pending: P.pending, older: P.older, regime: rg ? { product: rg.product, conc: rg.conc, exposure: rg.exposure, method: rg.method } : null, can: _v83Can_(s) };
}
/** Список «яйца израсходованы — обработка не записана». */
function v83EggsPending(token) {
  var op = null;
  try { op = _beginOp_(token, MC_V83_VIEW_, 'EGG_USE_VIEW', 'ХАССП', null, null); } catch (e) { return _failFrom_(e); }
  try { var d = _v83Summary_(op.session); _endOp_(op); return _ok_(d, op.id); } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Обработал яйца по режиму для израсходованного: {keys: ['партия|выпуск/продажа', ...], confirm: true}. Количество — из расхода. */
function v83ProcessUsed(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'journals', 'EGG_PROCESS_USED', 'ХАССП', null, null); } catch (e) { return _failFrom_(e); }
  try {
    if (op.session && op.session.dev) return _v82Fail_(op, 'FORBIDDEN', 'Технический доступ записей не делает');
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), keys = [].concat(d.keys || []).map(String).filter(Boolean);
    var reg = _v82Regime_();
    if (!reg) return _v82Fail_(op, 'STATE', 'Режим обработки яиц не выбран — его выбирает ответственный за ХАССП (экран «Яйца» → «Обработка яиц»)');
    if (!reg.approved) return _v82Fail_(op, 'STATE', 'Выбранный режим больше не утверждён — обратитесь к ответственному за ХАССП');
    if (!keys.length) return _v82Fail_(op, 'VALIDATION', 'Выберите, для чего обработаны яйца');
    if (d.confirm !== true) return _v82Fail_(op, 'VALIDATION', 'Подтвердите, что обработали яйца по режиму: ' + reg.product + ', ' + reg.conc + ', ' + reg.exposure);
    var a = _author_(op);
    return _withLock_(function () {
      var P = _v83Pending_().pending, sh = _v83ProcSheet_(), now = new Date(), done = [], miss = [];
      keys.forEach(function (k) {
        var x = P.filter(function (p) { return p.key === k; })[0];
        if (!x) { miss.push(k); return; }
        sh.appendRow([_v82Day_(now), "'" + Utilities.formatDate(now, _mcTz_(), 'HH:mm'), x.batchId, x.product, x.qty, x.unit, reg.product, reg.conc, reg.exposure, reg.method,
          'использованы', '—', a.фио, a.должность, op.id, x.text + ', расход ' + x.at, x.ref]);
        done.push({ key: k, dish: x.dish, qty: x.qty, unit: x.unit, batchId: x.batchId });
      });
      if (!done.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Обработка по этому расходу уже записана или расхода нет', op.id); }
      _audit_(op, 'EGG_PROCESS_USED', 'ХАССП', done.map(function (x) { return x.batchId; }).join(','), null, { записано: done, средство: reg.product, режим: reg.conc + ' / ' + reg.exposure, не_найдено: miss });
      _endOp_(op); return _ok_({ done: done, missing: miss }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- «Бракераж», «Яйца», главный экран ---------------- */
try {
  var _v83o_brak_ = v77BrakData;
  v77BrakData = function (token) {
    var r = _v83o_brak_.apply(this, arguments);
    try { var x = JSON.parse(r); if (x && x.success && x.data) { var s = _getSession_(token); x.data.eggs = _v83Summary_(s); return JSON.stringify(x); } } catch (e) {}
    return r;
  };
} catch (e) {}
try {
  var _v83o_eggs_ = v82Data;
  v82Data = function (token) {
    var r = _v83o_eggs_.apply(this, arguments);
    try { var x = JSON.parse(r); if (x && x.success && x.data) { var s = _getSession_(token); x.data.use = _v83Summary_(s); return JSON.stringify(x); } } catch (e) {}
    return r;
  };
} catch (e) {}
(function () {
  if (typeof _UI_BUILDERS_ !== 'object') return;
  var orig = _UI_BUILDERS_.home; if (typeof orig !== 'function') return;
  _UI_BUILDERS_.home = function (token, opts, s) {
    var r = orig(token, opts, s) || {};
    try {
      if (_v83Can_(s)) {
        var n = _v83Pending_().pending.length;
        if (n) {
          var A0 = r.actions || [], bi = A0.findIndex ? A0.findIndex(function (x) { return x && x.module === 'brakesales'; }) : -1, btn = { label: 'Обработка яиц: ждут ' + n, module: 'eggs' };
          r.actions = bi >= 0 ? A0.slice(0, bi + 1).concat([btn], A0.slice(bi + 1)) : [btn].concat(A0);
        }
      }
    } catch (e) {}
    return r;
  };
})();
