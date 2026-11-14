// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
/**
 * ЦЕХ Стандарт V72 — «ЦЕХ Финансы и Экономика», этап 2: реестр первичных операций и дневные итоги.
 *
 * Принцип ТЗ: одно заполнение → одна первичная операция → пересчёт зависимых показателей.
 *
 * Реестр «Фин_Реестр» — по одной записи на каждую первичную операцию, которая влияет на экономику (приёмка партии,
 * событие партии, акт разбора, выпуск, выдача, факт банкета, продажа, акт списания, списание вручную, ревизия,
 * финансовая операция, расход, корректировка). Ключ записи — тип и номер операции в её первичном листе, поэтому
 * повторная сверка того же события вторую запись не создаёт. У записи: OperationID, дата, организация, точка,
 * источник, автор, статус, версия, сумма и хеш содержания. Данные не копируются: реестр указывает на первичную запись.
 * Изменение первичной записи меняет хеш → версия +1 и строка в «Фин_Реестр_История» (было → стало);
 * исчезнувшая первичная запись → статус REMOVED и строка истории. Первичные листы реестр не меняет.
 *
 * Дневные итоги «Фин_Итоги_День» (день → выручка, себестоимость, потери, инвентаризация, расходы …) и
 * «Фин_Итоги_Блюдо_День» (день × блюдо → продано, выручка, себестоимость) пересчитываются только за дни, которых
 * коснулись изменённые операции. Сводка за период (v72GetSummary) складывает готовые дни — экраны и отчёты
 * не перечитывают всю историю. Дни закрытого финансового периода заморожены: изменение операции в них попадает
 * в историю с признаком «закрытый период», итоги дня не меняются (исправление — корректировкой в «Экономике»).
 *
 * Сверка: по расписанию (каждые 15 минут), после закрытия периода и по кнопке «Обновить» (v72SyncNow).
 * Точка = предприятие (решение 14.11.2026): организация и точка берутся из настроек предприятия; свод сети — позже.
 */
var MC_V72 = {
  REG: ['Фин_Реестр', ['RegKey', 'OperationID', 'Type', 'ObjectType', 'ObjectID', 'Date', 'OrgID', 'LocationID', 'Source', 'SourceRef', 'Author', 'Status', 'Version',
    'Amount', 'Hash', 'Days', 'ClosedChanged', 'FirstSeenAt', 'UpdatedAt', 'RunID']],
  HIST: ['Фин_Реестр_История', ['At', 'RunID', 'RegKey', 'OperationID', 'Action', 'VersionFrom', 'VersionTo', 'AmountBefore', 'AmountAfter', 'HashBefore', 'HashAfter',
    'Days', 'ClosedPeriod', 'Note']],
  DAY: ['Фин_Итоги_День', ['Day', 'LocationID'].concat(MC_V64_SUM_KEYS).concat(['WasteByReason', 'Frozen', 'UpdatedAt', 'RunID'])],
  DISH: ['Фин_Итоги_Блюдо_День', ['Day', 'LocationID', 'Dish', 'DishCode', 'Qty', 'Revenue', 'Cost', 'UpdatedAt', 'RunID']]
};
var MC_V72_TYPE_RU = { PURCHASE: 'Приёмка партии', BATCH_EVENT: 'Событие партии', PROCESSING: 'Зачистка и разделка', PRODUCTION: 'Выпуск', ISSUE: 'Выдача на банкет',
  BANQUET: 'Факт банкета', SALE: 'Продажа', WRITEOFF: 'Акт списания', STOCK_OP: 'Списание со склада', REVISION: 'Ревизия', FIN_OP: 'Финансовая операция',
  EXPENSE: 'Управленческий расход', FIN_CORR: 'Корректировка закрытого периода', OTHER: 'Прочее' };
var MC_V72_STALE_MIN = 30;

/* ---------------- служебное ---------------- */
function _v72Sh_(k) { return _v64Sheet_(MC_V72[k][0], MC_V72[k][1]); }
function _v72Read_(k) {
  var sh = _v72Sh_(k), v = sh.getDataRange().getValues(), h = MC_V72[k][1], out = [];
  for (var i = 1; i < v.length; i++) { if (!v[i][0] && v[i][0] !== 0) continue; var o = { _row: i + 1 }; h.forEach(function (c, j) { o[c] = v[i][j] === undefined ? '' : v[i][j]; }); out.push(o); }
  return { sh: sh, rows: out, head: h };
}
function _v72RowOf_(h, o) { return h.map(function (c) { var x = o[c]; return x === undefined || x === null ? '' : x; }); }
function _v72Hash_(x) { return _v64Hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(x), Utilities.Charset.UTF_8)).slice(0, 24); }
function _v72Tenant_() { var t = { organization_id: 'ORG-001', location_id: 'LOC-001' }; try { t = _defaultTenant_(); } catch (e) {} return t; }
function _v72DayOf_(l) { return l.date ? _v64Day_(l.date) : ''; }

/** Ключ первичной операции строки журнала V64: тип + номер в первичном листе. */
function _v72Key_(l) {
  var s = l.source || '', ot = l.objType || '';
  if (ot === 'SALE' || (l.stage === 'PACKAGING' && ot === 'SALE')) return ['SALE', l.objId];
  if (ot === 'FIN_OPERATION' || s === 'Финансы_Операции') return ['FIN_OP', l.ref || l.objId];
  if (s === 'Финансы_Корректировки') return ['FIN_CORR', l.ref || l.objId];
  if (s === 'Финансы_Расходы' || ot === 'EXPENSE') return ['EXPENSE', l.objId];
  if (ot === 'WRITEOFF_ACT') return ['WRITEOFF', l.objId];
  if (ot === 'STOCK_OP') return ['STOCK_OP', l.objId];
  if (ot === 'REVISION') return ['REVISION', l.objId];
  if (s === 'Партии_События') return ['BATCH_EVENT', l.ref || (l.objId + '|' + l.stage)];
  if (s === 'Разбор_Акты' || s === 'Разбор_Строки') return ['PROCESSING', l.ref];
  if (l.production || ot === 'PRODUCTION') return ['PRODUCTION', l.production || l.objId];
  if (ot === 'ISSUE') return ['ISSUE', l.objId];
  if (ot === 'BANQUET') return ['BANQUET', l.ref || l.objId];
  if (l.stage === 'PURCHASE' && ot === 'BATCH') return ['PURCHASE', l.objId];
  return ['OTHER', s + '|' + ot + '|' + (l.objId || l.ref || '')];
}
/** Строки журнала → первичные операции: {key, type, objId, amount, hash, days[], date, source, ref, author, op}. */
function _v72Group_(lines) {
  var g = {};
  lines.forEach(function (l) {
    var k = _v72Key_(l); if (!k[1]) return;
    var key = k[0] + '|' + k[1], x = g[key];
    if (!x) x = g[key] = { key: key, type: k[0], objId: String(k[1]), amount: 0, sig: [], days: {}, date: null, source: l.source || '', ref: l.ref || '', author: '', op: '' };
    // Сумма операции: для продажи — выручка (строка IN), для остальных — сумма движений.
    if (l.dir !== 'INFO' && !(x.type === 'SALE' && l.dir !== 'IN')) x.amount += Number(l.amount) || 0;
    x.sig.push([l.stage, l.dir, _v72DayOf_(l), l.batch || '', l.product || '', _v64R3_(l.qty || 0), _v64R2_(l.amount), (l.flags || []).slice().sort().join(',')].join('␟'));
    var d = _v72DayOf_(l); if (d) x.days[d] = 1;
    if (l.date && (!x.date || l.date < x.date)) x.date = l.date;
    if (!x.author && l.employee) x.author = l.employee;
    if (!x.op && l.op) x.op = l.op;
  });
  Object.keys(g).forEach(function (k) { var x = g[k]; x.sig.sort(); x.hash = _v72Hash_(x.sig); x.amount = _v64R2_(x.amount); x.days = Object.keys(x.days).sort(); delete x.sig; });
  return g;
}
/** Дни закрытых финансовых периодов среди переданных. */
function _v72ClosedDays_(days) {
  var per = []; try { per = _v64Periods_().filter(function (p) { return p.status === 'CLOSED'; }); } catch (e) {}
  var out = {}; days.forEach(function (d) { if (per.some(function (p) { return p.from <= d && p.to >= d; })) out[d] = 1; });
  return out;
}

/* ---------------- сверка: реестр → история → дневные итоги ---------------- */
/**
 * Сверить реестр с первичными листами и пересчитать дни, которых коснулись изменения.
 * opts.full — пересчитать все незамороженные дни; opts.freeze — {from, to}: заморозить дни (после закрытия периода).
 * Повторный запуск без изменений ничего не пишет.
 */
function _v72SyncCore_(opts, op) {
  opts = opts || {};
  _v64Drop_();
  var res = _v64Build_(null), lines = res.lines, G = _v72Group_(lines), T = _v72Tenant_(), now = new Date();
  var runId = 'V72-' + Utilities.formatDate(now, _mcTz_(), 'yyyyMMdd-HHmmss') + '-' + Utilities.getUuid().slice(0, 4);
  var who = op && op.session ? (op.session.fullName || op.session.name || '') : 'система';
  return _withLock_(function () {
    var R = _v72Read_('REG'), byKey = {}; R.rows.forEach(function (r) { byKey[String(r.RegKey)] = r; });
    var D = _v72Read_('DAY'), frozen = {}, haveDay = {}; D.rows.forEach(function (r) { var d = _v72DayStr_(r.Day); haveDay[d] = 1; if (r.Frozen === true || String(r.Frozen) === 'true') frozen[d] = 1; });
    var touched = {}, hist = [], appendReg = [], stats = { created: 0, changed: 0, removed: 0, unchanged: 0, closedChanged: 0 };
    var allDays = {}; lines.forEach(function (l) { var d = _v72DayOf_(l); if (d) allDays[d] = 1; });
    var closed = _v72ClosedDays_(Object.keys(allDays).concat(R.rows.reduce(function (a, r) { return a.concat(String(r.Days || '').split(',').filter(String)); }, [])));
    var histRow = function (o) { hist.push(_v72RowOf_(MC_V72.HIST[1], Object.assign({ At: now, RunID: runId }, o))); };
    var mark = function (days) { days.forEach(function (d) { if (d) touched[d] = 1; }); };
    var inClosed = function (days) { return days.some(function (d) { return closed[d] || frozen[d]; }); };
    Object.keys(G).forEach(function (k) {
      var x = G[k], r = byKey[k];
      if (!r) {
        var opId = x.op || ('FIN-' + Utilities.getUuid().slice(0, 13).toUpperCase());
        appendReg.push(_v72RowOf_(MC_V72.REG[1], { RegKey: k, OperationID: opId, Type: x.type, ObjectType: x.type, ObjectID: x.objId, Date: x.date || '', OrgID: T.organization_id, LocationID: T.location_id,
          Source: x.source, SourceRef: x.ref, Author: x.author, Status: 'ACTIVE', Version: 1, Amount: x.amount, Hash: x.hash, Days: x.days.join(','), ClosedChanged: '', FirstSeenAt: now, UpdatedAt: now, RunID: runId }));
        histRow({ RegKey: k, OperationID: opId, Action: 'CREATED', VersionFrom: 0, VersionTo: 1, AmountBefore: '', AmountAfter: x.amount, HashBefore: '', HashAfter: x.hash, Days: x.days.join(','), ClosedPeriod: '', Note: MC_V72_TYPE_RU[x.type] || x.type });
        stats.created++; mark(x.days); return;
      }
      r._seen = true;
      if (String(r.Hash) === x.hash && String(r.Status) === 'ACTIVE') { stats.unchanged++; return; }
      var oldDays = String(r.Days || '').split(',').filter(String), days = oldDays.concat(x.days), cl = inClosed(days), ver = (Number(r.Version) || 1) + 1;
      var action = String(r.Status) === 'REMOVED' ? 'RESTORED' : 'CHANGED';
      histRow({ RegKey: k, OperationID: r.OperationID, Action: action, VersionFrom: Number(r.Version) || 1, VersionTo: ver, AmountBefore: r.Amount, AmountAfter: x.amount, HashBefore: r.Hash, HashAfter: x.hash,
        Days: x.days.join(','), ClosedPeriod: cl ? true : '', Note: cl ? 'изменение затрагивает закрытый период — итоги закрытых дней не меняются, нужна корректировка' : '' });
      R.sh.getRange(r._row, 1, 1, MC_V72.REG[1].length).setValues([_v72RowOf_(MC_V72.REG[1], Object.assign({}, r, { Status: 'ACTIVE', Version: ver, Amount: x.amount, Hash: x.hash, Days: x.days.join(','),
        Date: x.date || r.Date, ClosedChanged: cl ? true : r.ClosedChanged, UpdatedAt: now, RunID: runId }))]);
      stats.changed++; if (cl) stats.closedChanged++; mark(days);
    });
    R.rows.forEach(function (r) {
      if (r._seen || String(r.Status) === 'REMOVED') return;
      var days = String(r.Days || '').split(',').filter(String), cl = inClosed(days), ver = (Number(r.Version) || 1) + 1;
      histRow({ RegKey: r.RegKey, OperationID: r.OperationID, Action: 'REMOVED', VersionFrom: Number(r.Version) || 1, VersionTo: ver, AmountBefore: r.Amount, AmountAfter: 0, HashBefore: r.Hash, HashAfter: '',
        Days: days.join(','), ClosedPeriod: cl ? true : '', Note: 'первичная запись больше не найдена' + (cl ? ' — в закрытом периоде' : '') });
      R.sh.getRange(r._row, 1, 1, MC_V72.REG[1].length).setValues([_v72RowOf_(MC_V72.REG[1], Object.assign({}, r, { Status: 'REMOVED', Version: ver, ClosedChanged: cl ? true : r.ClosedChanged, UpdatedAt: now, RunID: runId }))]);
      stats.removed++; if (cl) stats.closedChanged++; mark(days);
    });
    if (appendReg.length) R.sh.getRange(R.sh.getLastRow() + 1, 1, appendReg.length, MC_V72.REG[1].length).setValues(appendReg);
    var H = _v72Sh_('HIST'); if (hist.length) H.getRange(H.getLastRow() + 1, 1, hist.length, MC_V72.HIST[1].length).setValues(hist);
    // дни к пересчёту: затронутые + (полный пересчёт или первый запуск) все дни с данными; замороженные не трогаются,
    // закрытые без итогов считаются один раз (первый запуск после закрытия до этапа 2)
    var want = {}; Object.keys(touched).forEach(function (d) { want[d] = 1; });
    Object.keys(allDays).forEach(function (d) { if (opts.full || !haveDay[d]) want[d] = 1; });
    var days = Object.keys(want).filter(function (d) { return !frozen[d] && (!closed[d] || !haveDay[d]); }).sort();
    _v72WriteDays_(days, lines, D, runId, now, T);
    var froze = opts.freeze ? _v72Freeze_(opts.freeze.from, opts.freeze.to) : 0;
    var info = { runId: runId, at: now.toISOString(), by: who, days: days.length, operations: Object.keys(G).length, created: stats.created, changed: stats.changed, removed: stats.removed,
      unchanged: stats.unchanged, closedChanged: stats.closedChanged, frozenDays: froze };
    try { PropertiesService.getScriptProperties().setProperty('MC_V72_LAST', JSON.stringify(info)); } catch (e) {}
    return info;
  });
}
function _v72DayStr_(x) { if (Object.prototype.toString.call(x) === '[object Date]') return _v64Day_(x); var d = _v64Date_(x); return d ? _v64Day_(d) : String(x || ''); }
/** Пересчитать дневные итоги за дни (строки этих дней заменяются, остальные не трогаются). */
function _v72WriteDays_(days, lines, D, runId, now, T) {
  if (!days.length) return 0;
  var set = {}; days.forEach(function (d) { set[d] = 1; });
  var byDay = {}; lines.forEach(function (l) { var d = _v72DayOf_(l); if (set[d]) (byDay[d] = byDay[d] || []).push(l); });
  var H = MC_V72.DAY[1], fresh = days.map(function (d) {
    var t = _v64Totals_(byDay[d] || []), o = { Day: d, LocationID: T.location_id, WasteByReason: JSON.stringify(t.wasteByReason || {}), Frozen: false, UpdatedAt: now, RunID: runId };
    MC_V64_SUM_KEYS.forEach(function (k) { o[k] = t[k] || 0; }); return _v72RowOf_(H, o);
  });
  _v72Replace_(D.sh, H, set, fresh);
  // день × блюдо — для меню-аналитики и сводки по блюдам
  var Dh = _v72Read_('DISH'), dish = {};
  days.forEach(function (d) { (byDay[d] || []).forEach(function (l) {
    if (l.objType !== 'SALE' || !(l.stage === 'SALE' || l.stage === 'PACKAGING')) return;
    var name = l.stage === 'PACKAGING' ? l.dish : l.product; if (!name) return;
    var k = d + '|' + name, x = dish[k] || (dish[k] = { Day: d, LocationID: T.location_id, Dish: name, DishCode: '', Qty: 0, Revenue: 0, Cost: 0, UpdatedAt: now, RunID: runId });
    if (l.stage === 'SALE' && l.dir === 'IN') { x.Qty += Number(l.qty) || 0; x.Revenue += Number(l.amount) || 0; if (l.productId) x.DishCode = l.productId; }
    else if (l.dir === 'OUT') x.Cost += Number(l.amount) || 0;
  }); });
  var rows = Object.keys(dish).sort().map(function (k) { var x = dish[k]; x.Qty = _v64R3_(x.Qty); x.Revenue = _v64R2_(x.Revenue); x.Cost = _v64R2_(x.Cost); return _v72RowOf_(MC_V72.DISH[1], x); });
  _v72Replace_(Dh.sh, MC_V72.DISH[1], set, rows);
  return days.length;
}
/** Заменить строки листа, у которых день (колонка 1) входит в set, на rows; остальные строки сохраняются. */
function _v72Replace_(sh, head, set, rows) {
  var v = sh.getDataRange().getValues(), keep = [head];
  for (var i = 1; i < v.length; i++) { if (v[i].every(function (x) { return x === '' || x === null; })) continue; if (!set[_v72DayStr_(v[i][0])]) keep.push(v[i].slice(0, head.length)); }
  var all = keep.concat(rows).map(function (r) { var x = r.slice(0, head.length); while (x.length < head.length) x.push(''); return x; });
  sh.clearContents(); sh.getRange(1, 1, all.length, head.length).setValues(all);
}
/** Заморозить дневные итоги периода (после закрытия): дальше они не пересчитываются. */
function _v72Freeze_(from, to) {
  var sh = _v72Sh_('DAY'), v = sh.getDataRange().getValues(), c = MC_V72.DAY[1].indexOf('Frozen'), n = 0;
  for (var i = 1; i < v.length; i++) { var d = _v72DayStr_(v[i][0]); if (d >= from && d <= to && !(v[i][c] === true || String(v[i][c]) === 'true')) { sh.getRange(i + 1, c + 1).setValue(true); n++; } }
  return n;
}
/** Хук закрытия периода (v64ClosePeriod): сверить и заморозить дни периода. Ошибка здесь закрытие не отменяет. */
function _v72AfterClose_(fromIso, toIso, op) { try { return _v72SyncCore_({ freeze: { from: fromIso, to: toIso } }, op); } catch (e) { try { _log_('WARN', 'V72: итоги после закрытия не обновлены: ' + e, op && op.id); } catch (e2) {} return null; } }

/* ---------------- публичные функции ---------------- */
/** Сверить реестр и обновить дневные итоги сейчас (кнопка «Обновить»). json: {full?: true}. */
function v72SyncNow(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'finance_view', 'V72_SYNC', 'Экономика', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), r = _v72SyncCore_({ full: d.full === true || d.full === 'true' }, op);
    _audit_(op, 'V72_SYNC', 'Фин_Реестр', r.runId, null, r); _endOp_(op);
    return _ok_(r, op.id);
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Фоновая сверка (расписание MC_SCHEDULE, каждые 15 минут). */
function v72FinSyncSystem() {
  var op = null; try { op = _createOperation_('V72_SYNC', null, ''); } catch (e) {}
  var r = _v72SyncCore_({}, op);
  if (r.created || r.changed || r.removed) try { _audit_(op, 'V72_SYNC', 'Фин_Реестр', r.runId, null, r); } catch (e) {}
  if (op) try { _endOp_(op); } catch (e) {}
  return r;
}
/**
 * Сводка за период из дневных итогов: те же показатели, что у v64GetDashboard (totals), плюс по дням и по блюдам.
 * Не пересобирает журнал. Свежесть — время последней сверки; stale — сверки не было дольше 30 минут.
 */
function v72GetSummary(token, fromDate, toDate) {
  try {
    _requireAuth_(token, 'finance_view');
    var rg = _v64Range_(fromDate, toDate), D = _v72Read_('DAY'), t = {}, wr = {}, byDay = [], frozen = 0;
    MC_V64_SUM_KEYS.forEach(function (k) { t[k] = 0; });
    D.rows.forEach(function (r) {
      var d = _v72DayStr_(r.Day); if (d < rg.fromIso || d > rg.toIso) return;
      MC_V64_SUM_KEYS.forEach(function (k) { t[k] += _v64Num_(r[k]); });
      var w = {}; try { w = JSON.parse(String(r.WasteByReason || '{}')); } catch (e) {}
      Object.keys(w).forEach(function (k) { wr[k] = (wr[k] || 0) + _v64Num_(w[k]); });
      if (r.Frozen === true || String(r.Frozen) === 'true') frozen++;
      var dt = _v64Derive_((function () { var o = {}; MC_V64_SUM_KEYS.forEach(function (k) { o[k] = _v64Num_(r[k]); }); return o; })());
      byDay.push({ day: d, revenue: dt.revenue, cogs: dt.cogsWithPackaging, gross: dt.grossContribution, marginPct: dt.marginPct, waste: dt.wasteCost, frozen: r.Frozen === true || String(r.Frozen) === 'true' });
    });
    t.wasteByReason = wr; t = _v64Derive_(t);
    var dish = {}; _v72Read_('DISH').rows.forEach(function (r) {
      var d = _v72DayStr_(r.Day); if (d < rg.fromIso || d > rg.toIso) return;
      var x = dish[r.Dish] || (dish[r.Dish] = { dish: String(r.Dish), code: String(r.DishCode || ''), qty: 0, revenue: 0, cost: 0 });
      x.qty += _v64Num_(r.Qty); x.revenue += _v64Num_(r.Revenue); x.cost += _v64Num_(r.Cost); if (!x.code && r.DishCode) x.code = String(r.DishCode);
    });
    var dishes = Object.keys(dish).map(function (k) { var x = dish[k]; x.qty = _v64R3_(x.qty); x.revenue = _v64R2_(x.revenue); x.cost = _v64R2_(x.cost); x.gross = _v64R2_(x.revenue - x.cost);
      x.marginPct = x.revenue > 0 ? Math.round(x.gross / x.revenue * 1000) / 10 : null; return x; }).sort(function (a, b) { return b.revenue - a.revenue; });
    var last = null; try { last = JSON.parse(PropertiesService.getScriptProperties().getProperty('MC_V72_LAST') || 'null'); } catch (e) {}
    var age = last && last.at ? Math.round((Date.now() - new Date(last.at).getTime()) / 60000) : null;
    var reasons = Object.keys(t.wasteByReason).map(function (k) { return { code: k, title: MC_V64_WASTE_REASON_RU[k] || (k === 'BANQUET' ? 'Брак и остаток банкета' : k), amount: t.wasteByReason[k] }; });
    return _ok_({ from: rg.fromIso, to: rg.toIso, totals: t, wasteByReason: reasons, byDay: byDay.sort(function (a, b) { return a.day < b.day ? -1 : 1; }), dishes: dishes,
      frozenDays: frozen, lastSync: last, minutesSinceSync: age, stale: age === null || age > MC_V72_STALE_MIN,
      closedChanged: last ? last.closedChanged || 0 : 0,
      note: 'Сводка из дневных итогов реестра операций. Управленческие показатели (валовой вклад), бухгалтерский учёт не заменяют.' });
  } catch (e) { return _failFrom_(e); }
}
/** Реестр операций с отбором. json: {from, to, type, status, q, limit}. */
function v72GetRegistry(json, token) {
  try {
    _requireAuth_(token, 'finance_view');
    var d = _v64Json_(json), rg = d.from || d.to ? _v64Range_(d.from, d.to) : null, lim = Math.min(Number(d.limit) || 200, 2000), q = String(d.q || '').toLowerCase();
    var rows = _v72Read_('REG').rows.filter(function (r) {
      if (d.type && String(r.Type) !== String(d.type)) return false;
      if (d.status && String(r.Status) !== String(d.status)) return false;
      if (d.closedChanged && !(r.ClosedChanged === true || String(r.ClosedChanged) === 'true')) return false;
      if (rg) { var days = String(r.Days || '').split(',').filter(String); if (!days.some(function (x) { return x >= rg.fromIso && x <= rg.toIso; })) return false; }
      if (q && (String(r.RegKey) + ' ' + r.OperationID + ' ' + r.Author + ' ' + r.SourceRef).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var total = rows.length;
    rows = rows.slice(-lim).reverse().map(function (r) { return { key: String(r.RegKey), operationId: String(r.OperationID), type: String(r.Type), typeRu: MC_V72_TYPE_RU[r.Type] || String(r.Type),
      objectId: String(r.ObjectID), date: r.Date ? _v72DayStr_(r.Date) : '', source: String(r.Source), sourceRef: String(r.SourceRef), author: String(r.Author), status: String(r.Status),
      version: Number(r.Version) || 1, amount: _v64Num_(r.Amount), days: String(r.Days || ''), closedChanged: r.ClosedChanged === true || String(r.ClosedChanged) === 'true',
      updatedAt: r.UpdatedAt ? String(r.UpdatedAt) : '' }; });
    var st = {}; _v72Read_('REG').rows.forEach(function (r) { st[r.Status] = (st[r.Status] || 0) + 1; });
    return _ok_({ total: total, items: rows, byStatus: st, types: MC_V72_TYPE_RU });
  } catch (e) { return _failFrom_(e); }
}
/** История одной операции реестра: создание, версии (было → стало), удаление. */
function v72GetOperationHistory(regKey, token) {
  try {
    _requireAuth_(token, 'finance_view');
    var k = String(regKey || ''); if (!k) return _fail_('VALIDATION', 'Укажите операцию');
    var reg = _v72Read_('REG').rows.filter(function (r) { return String(r.RegKey) === k || String(r.OperationID) === k; })[0];
    if (!reg) return _fail_('NOT_FOUND', 'Операция не найдена в реестре');
    var h = _v72Read_('HIST').rows.filter(function (r) { return String(r.RegKey) === String(reg.RegKey); }).map(function (r) {
      return { at: String(r.At), action: String(r.Action), versionFrom: r.VersionFrom, versionTo: r.VersionTo, amountBefore: r.AmountBefore, amountAfter: r.AmountAfter, days: String(r.Days || ''),
        closedPeriod: r.ClosedPeriod === true || String(r.ClosedPeriod) === 'true', note: String(r.Note || '') }; });
    return _ok_({ key: String(reg.RegKey), operationId: String(reg.OperationID), type: String(reg.Type), typeRu: MC_V72_TYPE_RU[reg.Type] || String(reg.Type), status: String(reg.Status),
      version: Number(reg.Version) || 1, amount: _v64Num_(reg.Amount), source: String(reg.Source), sourceRef: String(reg.SourceRef), author: String(reg.Author), history: h });
  } catch (e) { return _failFrom_(e); }
}
