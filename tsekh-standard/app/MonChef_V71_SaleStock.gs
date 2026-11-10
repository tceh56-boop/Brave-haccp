/**
 * ЦЕХ Стандарт V71 — ручная продажа списывает склад и связывается с партиями.
 *
 * Что продано:
 *   • блюдо по ТТК — сначала готовые партии этого блюда, допущенные к выдаче (бракераж, суточная проба, ККТ — _bcReleaseState_), по FEFO;
 *     оставшиеся порции — «приготовлено под заказ»: состав по ТТК (_serverExplodeInto_): п/ф со склада, недостающий п/ф — до сырья;
 *     партии п/ф и сырья — по FEFO;
 *   • товар со склада без ТТК (вода, соки в упаковке и т. п.) — партии этого товара по FEFO.
 * Не списываются: партии в карантине и с любым статусом, кроме «active»; просроченные на дату продажи; полученные позже даты продажи;
 *   заблокированные по отклонению; зарезервированные под банкет (резерв партий V22 и резерв продуктов будущих банкетов).
 * Каждая списанная партия → связь «партия —РЕАЛИЗОВАНА_В→ продажа» (TRACE_LINKS: паспорт партии, «куда ушла») и строка листа
 *   «Продажи_Списание_V71» (что списано по партиям и чего не хватило). Не хватило — продажа всё равно записывается (это факт),
 *   недостача видна в итоге продажи, на экране и в экономике («Проблемные записи»). Система ничего не досписывает «из воздуха»:
 *   остаток уменьшается только на то, что списано с партий.
 * Название, которого нет ни в ТТК, ни на складе, не принимается: списать нечего.
 */
var MC_V71 = { SHEET: 'Продажи_Списание_V71' };
var MC_V71_HEAD = ['SaleID', 'Дата продажи', 'Время', 'Что продано', 'Вид', 'Код ТТК / ProductID', 'Кол-во', 'Ед.', 'Списано по партиям (JSON)',
  'Не хватило (JSON)', 'Готовые партии не допущены (JSON)', 'Себестоимость по партиям, ₽', 'Оценка недостающего, ₽', 'Статус', 'Продавец', 'Внёс', 'OperationID', 'Создано'];
var MC_V71_STATUS_RU_ = { FULL: 'списано', PARTIAL: 'списано не полностью', ERROR: 'склад не списан' };
var MC_V71_FROM_RU_ = { READY: 'готовая партия', PF: 'п/ф со склада', RAW: 'сырьё по ТТК', GOODS: 'товар' };

function _v71Sheet_() {
  var ss = _book_(), sh = ss.getSheetByName(MC_V71.SHEET);
  if (!sh) {
    sh = ss.insertSheet(MC_V71.SHEET);
    sh.getRange(1, 1, 1, MC_V71_HEAD.length).setValues([MC_V71_HEAD]);
    sh.setFrozenRows(1);
    try { sh.getRange(1, 1, 1, MC_V71_HEAD.length).setFontWeight('bold'); } catch (e) {}
  }
  return sh;
}
function _v71R2_(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function _v71R3_(x) { return Math.round((Number(x) || 0) * 1000) / 1000; }
/** Дата → «гггг-мм-дд» в часовом поясе проекта (сравнение сроков и дат получения по дням). */
function _v71Day_(x) {
  var d = x instanceof Date ? x : (x ? _parseDate_(x) : null);
  if (!d || !d.getTime || isNaN(d.getTime())) return null;
  return Utilities.formatDate(d, _mcTz_(), 'yyyy-MM-dd');
}
/** Момент продажи из даты (гггг-мм-дд или дд.мм.гггг) и времени (ЧЧ:ММ); пусто — сейчас. */
function _v71At_(date, time) {
  var now = typeof _mcNow_ === 'function' ? _mcNow_() : new Date();
  var d = date ? _mcDateOnly_(date) : null;
  if (!d) d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(time || ''));
  if (m) d.setHours(+m[1], +m[2], 0, 0);
  else if (!date) return now;
  else d.setHours(12, 0, 0, 0);
  return d;
}

/** Что продано: блюдо по ТТК (не п/ф) или товар со склада без ТТК. {kind, name, code|pid, unit, dish} или {error}. */
function _v71Resolve_(name, kind, unit, idx) {
  name = String(name || '').trim();
  if (!name) return { error: 'Укажите, что продано' };
  idx = idx || _buildDishIndexes_();
  var goods = String(kind || '').toLowerCase() === 'goods';
  var d = idx.dishByNormName[_normNameServer_(name)] || null;
  if (!goods) {
    if (!d) return { error: '«' + name + '» нет в ТТК. Выберите блюдо из подсказки; товар без ТТК (вода, соки в упаковке и т. п.) — «Товар со склада».' };
    if (d.semi) return { error: '«' + d.name + '» — полуфабрикат. В зал продаётся блюдо; полуфабрикат можно продать как «Товар со склада».' };
    return { kind: 'DISH', name: String(d.name), code: String(d.code), dish: d, unit: 'порц.' };
  }
  if (d && !d.semi) return { error: '«' + d.name + '» есть в ТТК как блюдо — выберите «Блюдо по ТТК»: оно списывается по карте.' };
  var v = _stockBatchesSheet_().getDataRange().getValues(), key = _prodKey_(name), hit = null;
  for (var i = 1; i < v.length; i++) if (v[i][0] && _prodKey_(v[i][1]) === key) { hit = v[i]; if (String(v[i][10] || 'active') === 'active' && (parseFloat(v[i][9]) || 0) > 0) break; }
  if (!hit) return { error: '«' + name + '» нет на складе: товар продаётся из партий прихода. Сначала оформите приход.' };
  var bu = String(hit[2] || 'шт'), u = unit ? String(unit) : bu;
  if (!_unitsCompatible_(u, bu)) return { error: 'Единица «' + u + '» не подходит к партиям «' + hit[1] + '» (' + bu + ')' };
  return { kind: 'GOODS', name: String(hit[1]), pid: String(hit[17] || ''), unit: u };
}

/* ---------------- подбор и списание партий ---------------- */
function _v71Reserved_() {
  var m = {};
  try {
    if (typeof _mcV22Res_ !== 'function') return m;
    var v = _mcV22Res_().getDataRange().getValues();
    for (var i = 1; i < v.length; i++) if (String(v[i][9]) === 'ACTIVE') m[String(v[i][2])] = (m[String(v[i][2])] || 0) + (parseFloat(v[i][5]) || 0);
  } catch (e) {}
  return m;
}
function _v71Blocked_() {
  var m = {};
  try {
    if (typeof _mcBlocksSheet_ !== 'function') return m;
    var v = _mcBlocksSheet_().getDataRange().getValues();
    for (var i = 1; i < v.length; i++) if (String(v[i][1]) === 'BATCH' && String(v[i][9]) === 'ACTIVE') m[String(v[i][2])] = true;
  } catch (e) {}
  return m;
}
/** Партии-кандидаты: по названию или ProductID, совместимая единица, статус active, остаток за вычетом резерва банкета,
 *  срок годности не раньше дня продажи, получена не позже дня продажи, не заблокирована. Порядок — FEFO. */
function _v71Cands_(ctx, name, unit, pid) {
  var v = ctx.v, key = _prodKey_(name), out = [];
  for (var i = 1; i < v.length; i++) {
    var r = v[i]; if (!r[0]) continue;
    if (_prodKey_(r[1]) !== key && !(pid && String(r[17] || '') === String(pid))) continue;
    if (!_unitsCompatible_(r[2], unit)) continue;
    if (String(r[10] || 'active') !== 'active') continue;
    var remain = parseFloat(r[9]) || 0; if (!(remain > 0.0005)) continue;
    var exp = r[5] ? _parseDate_(r[5]) : null, expDay = exp ? _v71Day_(exp) : null;
    if (expDay && expDay < ctx.day) continue;
    var recDay = r[4] ? _v71Day_(r[4]) : null;
    if (recDay && recDay > ctx.day) continue;
    if (ctx.blocked[String(r[0])]) continue;
    var avail = remain - (ctx.res[String(r[0])] || 0) - (ctx.taken[String(r[0])] || 0);
    if (!(avail > 0.0005)) continue;
    out.push({ i: i, id: String(r[0]), product: String(r[1]), unit: String(r[2] || unit), avail: avail, exp: exp || null, price: parseFloat(r[6]) || 0 });
  }
  out.sort(function (a, b) { if (a.exp && b.exp) return a.exp - b.exp; if (a.exp) return -1; if (b.exp) return 1; return a.i - b.i; });
  return out;
}
/** Почему партий не хватило — для человека: какие партии продукта есть и чем они не подходят. */
function _v71Why_(ctx, name, unit, pid) {
  var v = ctx.v, key = _prodKey_(name), c = { q: 0, exp: 0, late: 0, blk: 0, res: 0, other: 0 };
  for (var i = 1; i < v.length; i++) {
    var r = v[i]; if (!r[0]) continue;
    if (_prodKey_(r[1]) !== key && !(pid && String(r[17] || '') === String(pid))) continue;
    if (!_unitsCompatible_(r[2], unit) || !((parseFloat(r[9]) || 0) > 0.0005)) continue;
    var st = String(r[10] || 'active'), expDay = r[5] ? _v71Day_(r[5]) : null, recDay = r[4] ? _v71Day_(r[4]) : null;
    if (st === 'quarantine') c.q++; else if (st !== 'active') c.other++;
    else if (expDay && expDay < ctx.day) c.exp++;
    else if (recDay && recDay > ctx.day) c.late++;
    else if (ctx.blocked[String(r[0])]) c.blk++;
    else c.res++;
  }
  var p = [];
  if (c.q) p.push('в карантине: ' + c.q);
  if (c.exp) p.push('срок истёк: ' + c.exp);
  if (c.late) p.push('получены позже даты продажи: ' + c.late);
  if (c.blk) p.push('заблокированы: ' + c.blk);
  if (c.res) p.push('остаток в резерве банкета или уже списан: ' + c.res);
  if (c.other) p.push('другой статус: ' + c.other);
  return p.length ? 'на складе нет годного остатка (партии ' + p.join('; ') + ')' : 'на складе нет остатка';
}
/** Списать qty (в единице unit) с партий cands по порядку. В пробном режиме лист не меняется. */
function _v71Take_(ctx, cands, qty, unit) {
  var left = qty, got = [], reqOne = _toBaseUnitServer_(1, unit).qty || 1;
  for (var k = 0; k < cands.length && left > 0.0005; k++) {
    var c = cands[k], needBase = left * reqOne, rowOne = _toBaseUnitServer_(1, c.unit).qty || 1, haveBase = c.avail * rowOne;
    var takeBase = Math.min(needBase, haveBase); if (!(takeBase > 0)) continue;
    var take = takeBase / rowOne, r = ctx.v[c.i];
    var newRemain = _v71R3_((parseFloat(r[9]) || 0) - take), newUsed = _v71R3_((parseFloat(r[8]) || 0) + take);
    if (!ctx.dry) {
      ctx.sh.getRange(c.i + 1, 9).setValue(newUsed);
      ctx.sh.getRange(c.i + 1, 10).setValue(newRemain);
      if (newRemain <= 0.001) ctx.sh.getRange(c.i + 1, 11).setValue('consumed');
      r[8] = newUsed; r[9] = newRemain; if (newRemain <= 0.001) r[10] = 'consumed';
    } else ctx.taken[c.id] = (ctx.taken[c.id] || 0) + take;
    c.avail -= take;
    got.push({ batchId: c.id, product: c.product, qty: _v71R3_(take), unit: c.unit, price: c.price, expiry: c.exp ? _v71Day_(c.exp) : '' });
    left -= takeBase / reqOne;
  }
  return { got: got, left: left > 0.0005 ? _v71R3_(left) : 0 };
}
/** Остаток п/ф по годным партиям (для раскладки ТТК): { "продукт|базовая ед.": количество } минус резерв банкетов по продукту. */
function _v71PfStock_(ctx) {
  var m = {}, v = ctx.v;
  for (var i = 1; i < v.length; i++) {
    var r = v[i]; if (!r[0] || String(r[10] || 'active') !== 'active') continue;
    var remain = (parseFloat(r[9]) || 0) - (ctx.res[String(r[0])] || 0); if (!(remain > 0.0005)) continue;
    var expDay = r[5] ? _v71Day_(r[5]) : null, recDay = r[4] ? _v71Day_(r[4]) : null;
    if ((expDay && expDay < ctx.day) || (recDay && recDay > ctx.day) || ctx.blocked[String(r[0])]) continue;
    var b = _toBaseUnitServer_(remain, r[2]), k = _prodKey_(r[1]) + '|' + b.unit;
    m[k] = (m[k] || 0) + b.qty;
  }
  var res = _v71ResMap_(); Object.keys(m).forEach(function (k) { if (res[k]) m[k] = Math.max(0, m[k] - res[k]); });
  return m;
}

/* ---------- резервы банкетов на продукты (Склад_Резервы) ----------
 * Резерв держит продукт под будущий банкет. Раньше он оставался «ACTIVE» и после выдачи, и после закрытия банкета:
 * п/ф на складе считался занятым, выпуск и продажа раскладывали ТТК до сырья — сырьё списывалось второй раз,
 * а п/ф оставался лежать. Теперь резерв снимается, когда банкет выдан полностью или закрыт (обёртки ниже),
 * а зависшие резервы — шагом 9 «Миграции данных». При продаже резервы прошедших банкетов тоже не учитываются. */
function _v71EventsDone_() {
  var done = {}, today = _v71Day_(new Date()), issued = {};
  try { var cs = _book_().getSheetByName('Закрытие_V29'); if (cs) cs.getDataRange().getValues().forEach(function (r, i) { if (i && String(r[4]) === 'CLOSED') done[String(r[1])] = 'банкет закрыт'; }); } catch (e) {}
  try { var is = _book_().getSheetByName('Выдача_V28'); if (is) is.getDataRange().getValues().forEach(function (r, i) {
    if (!i || String(r[12]) !== 'ISSUED') return; var k = String(r[1]) + '|' + (String(r[4] || '') || _prodKey_(r[5])); issued[k] = (issued[k] || 0) + (parseFloat(r[7]) || 0); }); } catch (e) {}
  var evs = []; try { evs = JSON.parse(getEvents() || '[]'); } catch (e) {}
  evs.forEach(function (e) {
    var id = String(e.id); if (done[id]) return;
    var items = (e.items || []).filter(function (it) { return (parseFloat(it.qty) || 0) > 0; });
    if (items.length && items.every(function (it) { return (issued[id + '|' + (String(it.code || '') || _prodKey_(it.name))] || 0) + 1e-9 >= (parseFloat(it.qty) || 0); })) { done[id] = 'банкет выдан полностью'; return; }
    var dd = e.date ? _v71Day_(e.date) : null;
    if (dd && dd < today) done[id] = 'дата банкета прошла';
  });
  return done;
}
/** Резервы, которые действительно держат продукт: активные, банкет не выдан, не закрыт и не в прошлом. { "продукт|базовая ед.": количество }. */
function _v71ResMap_() {
  var m = {};
  try {
    var done = _v71EventsDone_(), v = _reservationsSheet_().getDataRange().getValues();
    for (var i = 1; i < v.length; i++) {
      if (v[i][7] !== 'ACTIVE' || done[String(v[i][2])]) continue;
      var b = _toBaseUnitServer_(parseFloat(v[i][6]) || 0, v[i][5] || 'г'), k = _prodKey_(v[i][4]) + '|' + b.unit;
      m[k] = (m[k] || 0) + b.qty;
    }
  } catch (e) {}
  return m;
}
/** Снять активные резервы выданных полностью и закрытых банкетов (один банкет или все). Резервы банкетов «в прошлом» без выдачи
 *  и закрытия не снимаются: банкет надо закрыть — это решение человека. */
function _v71ReleaseDone_(eventId) {
  var done = _v71EventsDone_(), sh = _reservationsSheet_(), v = sh.getDataRange().getValues(), n = 0, ev = {};
  for (var i = 1; i < v.length; i++) {
    var id = String(v[i][2]);
    if (v[i][7] !== 'ACTIVE' || (eventId && id !== String(eventId))) continue;
    var why = done[id]; if (!why || why === 'дата банкета прошла') continue;
    sh.getRange(i + 1, 8).setValue('RELEASED'); sh.getRange(i + 1, 10).setValue(new Date()); n++; ev[id] = why;
  }
  return { released: n, events: ev };
}
function _v71AfterBanquet_(r, eventId, token, what) {
  try {
    var o = typeof r === 'string' ? JSON.parse(r) : r; if (!o || !(o.ok || o.success)) return;
    var op = _beginOp_(token, 'banquets', 'RESERVATION_RELEASE', 'Банкет', eventId, null);
    var res = _withLock_(function () { return _v71ReleaseDone_(eventId); });
    if (res.released) _audit_(op, 'RESERVATION_RELEASE', 'Склад_Резервы', eventId, null, { снято: res.released, причина: res.events[String(eventId)], после: what });
    _endOp_(op);
  } catch (e) { try { _log_('WARN', 'V71: резервы банкета ' + eventId + ' не сняты после «' + what + '»: ' + e); } catch (x) {} }
}
(function () {
  if (typeof issueV28Banquet === 'function') { var o1 = issueV28Banquet; issueV28Banquet = function (eventId, linesJson, token) { var r = o1.apply(this, arguments); _v71AfterBanquet_(r, eventId, token, 'выдача'); return r; }; }
  if (typeof closeV29Banquet === 'function') { var o2 = closeV29Banquet; closeV29Banquet = function (eventId, linesJson, note, token) { var r = o2.apply(this, arguments); _v71AfterBanquet_(r, eventId, token, 'закрытие'); return r; }; }
})();

/**
 * Списание по продаже. item — из _v71Resolve_; qty — порций (блюдо) или в единице товара.
 * o: { dry, at (Date), saleId, op, seller, note }. Возвращает { lines[], short[], unreleased[], cost, est, status }.
 */
function _v71Run_(item, qty, o) {
  o = o || {};
  var at = o.at || new Date();
  var ctx = { dry: !!o.dry, day: _v71Day_(at), sh: _stockBatchesSheet_(), res: _v71Reserved_(), blocked: _v71Blocked_(), taken: {} };
  ctx.v = ctx.sh.getDataRange().getValues();
  var src = 'Продажа ' + (o.saleId || ''), lines = [], short = [], unreleased = [], pid = {};
  try { pid = _ttkPidByProdKey_(); } catch (e) {}
  var avgOf = function (nm, un) { try { return _currentAvgPrice_(nm, un) || 0; } catch (e) { return 0; } };
  var push = function (g, from, need) {
    var cost = g.price > 0 ? g.qty * g.price : 0, ps = 'BATCH';
    if (!(g.price > 0)) { var avg = avgOf(need.name, need.unit), gb = _toBaseUnitServer_(g.qty, g.unit).qty; cost = gb * (avg / (_toBaseUnitServer_(1, need.unit).qty || 1)); ps = avg > 0 ? 'AVG_MISSING_PRICE' : 'MISSING_PRICE'; }
    lines.push({ from: from, product: g.product, batchId: g.batchId, qty: g.qty, unit: g.unit, price: g.price, cost: _v71R2_(cost), priceSource: ps, expiry: g.expiry });
  };
  var log = function (nm, q, un, note) { if (!ctx.dry && q > 0.0005) _logStockOp_('Расход', nm, _v71R3_(q), un, 0, src, note); };
  var sumGot = function (got, un) { var one = _toBaseUnitServer_(1, un).qty || 1; return got.reduce(function (a, g) { return a + _toBaseUnitServer_(g.qty, g.unit).qty / one; }, 0); };
  var consumeMap = function (map, from) {
    Object.keys(map).forEach(function (k) {
      var sep = k.lastIndexOf('|'), nm = k.slice(0, sep), un = k.slice(sep + 1), q = map[k];
      if (!(q > 0.0005)) return;
      var p = pid[_prodKey_(nm)] || '', t = _v71Take_(ctx, _v71Cands_(ctx, nm, un, p), q, un);
      t.got.forEach(function (g) { push(g, from, { name: nm, unit: un }); });
      log(nm, sumGot(t.got, un), un, (o.note || 'Продажа в зал') + (from === 'PF' ? ': п/ф со склада' : ': сырьё по ТТК'));
      if (t.left > 0) short.push({ from: from, product: nm, qty: t.left, unit: un, reason: _v71Why_(ctx, nm, un, p), est: _v71R2_(t.left * avgOf(nm, un)) });
    });
  };
  if (item.kind === 'DISH') {
    var cands = _v71Cands_(ctx, item.name, 'порц.', ''), rel = [], unrel = [];
    cands.forEach(function (c) {
      var st = typeof _bcReleaseState_ === 'function' ? _bcReleaseState_(c.id) : { ok: true, reasons: [] };
      if (st.ok) rel.push(c); else { c.reasons = st.reasons || []; unrel.push(c); }
    });
    var t = _v71Take_(ctx, rel, qty, 'порц.');
    t.got.forEach(function (g) { push(g, 'READY', { name: item.name, unit: 'порц.' }); });
    log(item.name, sumGot(t.got, 'порц.'), 'порц.', (o.note || 'Продажа в зал') + ': готовая партия');
    var rest = t.left;
    if (rest > 0) {
      unrel.forEach(function (c) { unreleased.push({ batchId: c.id, qty: _v71R3_(c.avail), unit: c.unit, reasons: c.reasons }); });
      var dish = item.dish || {};
      if (!dish.ing || !dish.ing.length) short.push({ from: 'TTK', product: item.name, qty: rest, unit: 'порц.', reason: 'в ТТК нет состава — списать нечего', est: 0 });
      else {
        var idx = o.idx || _buildDishIndexes_(), pfUsed = {}, acc = _pfRawRequirement_(item.code, rest, 'порц.', idx, _v71PfStock_(ctx), pfUsed) || {};
        consumeMap(pfUsed, 'PF');
        consumeMap(acc, 'RAW');
      }
    }
  } else {
    var tg = _v71Take_(ctx, _v71Cands_(ctx, item.name, item.unit, item.pid), qty, item.unit);
    tg.got.forEach(function (g) { push(g, 'GOODS', { name: item.name, unit: item.unit }); });
    log(item.name, sumGot(tg.got, item.unit), item.unit, (o.note || 'Продажа в зал') + ': товар');
    if (tg.left > 0) short.push({ from: 'GOODS', product: item.name, qty: tg.left, unit: item.unit, reason: _v71Why_(ctx, item.name, item.unit, item.pid), est: _v71R2_(tg.left * avgOf(item.name, item.unit)) });
  }
  var cost = _v71R2_(lines.reduce(function (a, l) { return a + l.cost; }, 0)), est = _v71R2_(short.reduce(function (a, s) { return a + (s.est || 0); }, 0));
  return { item: { kind: item.kind, name: item.name, code: item.code || item.pid || '', unit: item.unit }, qty: qty, lines: lines, short: short, unreleased: unreleased,
    cost: cost, est: est, status: short.length ? 'PARTIAL' : 'FULL' };
}

/** Связи партий с продажей и запись листа «Продажи_Списание_V71». Вызывается под блокировкой после строки журнала продаж. */
function _v71Commit_(saleId, p, meta) {
  meta = meta || {};
  var actor = meta.seller || '', when = meta.at || new Date();
  if (typeof _mcCreateTraceLink_ === 'function') {
    var agg = {};
    p.lines.forEach(function (l) { var a = agg[l.batchId] || (agg[l.batchId] = { qty: 0, unit: l.unit }); a.qty += l.qty; });
    Object.keys(agg).forEach(function (bid) {
      _mcCreateTraceLink_('BATCH', bid, 'РЕАЛИЗОВАНА_В', 'SALE', saleId, { dateTime: when, actor: actor, source: saleId, weight: _v71R3_(agg[bid].qty), unit: agg[bid].unit });
    });
    if (p.item.kind === 'DISH') _mcCreateTraceLink_('SALE', saleId, 'ПО_БЛЮДУ', 'DISH', String(p.item.code || p.item.name), { dateTime: when, actor: actor, source: 'J36' });
    else _mcCreateTraceLink_('SALE', saleId, 'ПО_ТОВАРУ', 'PRODUCT', String(p.item.code || p.item.name), { dateTime: when, actor: actor, source: 'J36' });
  }
  var tz = _mcTz_();
  _v71Sheet_().appendRow([saleId, Utilities.formatDate(when, tz, 'dd.MM.yyyy'), Utilities.formatDate(when, tz, 'HH:mm'), p.item.name, p.item.kind === 'DISH' ? 'блюдо по ТТК' : 'товар без ТТК',
    p.item.code || '', p.qty, p.item.unit, JSON.stringify(p.lines), JSON.stringify(p.short), JSON.stringify(p.unreleased), p.cost, p.est, p.status, actor, meta.author || '', meta.opId || '', new Date()]);
}

/** Коротко для экрана: что списано и чего не хватило. */
function _v71Brief_(p) {
  var fmt = function (q, u) { return String(_v71R3_(q)).replace('.', ',') + ' ' + u; };
  return {
    status: p.status, statusRu: MC_V71_STATUS_RU_[p.status] || p.status, cost: p.cost, est: p.est, kind: p.item.kind, name: p.item.name,
    lines: p.lines.map(function (l) { return { from: MC_V71_FROM_RU_[l.from] || l.from, product: l.product, batchId: l.batchId, qty: l.qty, unit: l.unit, text: l.product + ' — ' + fmt(l.qty, l.unit) + ' (партия ' + l.batchId + (l.expiry ? ', годен до ' + l.expiry.split('-').reverse().join('.') : '') + ')' }; }),
    short: p.short.map(function (s) { return { product: s.product, qty: s.qty, unit: s.unit, reason: s.reason, text: s.product + ' — ' + fmt(s.qty, s.unit) + ': ' + s.reason }; }),
    unreleased: p.unreleased.map(function (u) { return { batchId: u.batchId, text: 'готовая партия ' + u.batchId + ' (' + fmt(u.qty, u.unit) + ') не допущена: ' + (u.reasons || []).join('; ') + ' — не списана' }; })
  };
}

/** Что спишется со склада при такой продаже — без записи. {dish, kind?, unit?, qty, date?, time?}. */
function mcSaleStockPreview(json, token) {
  try {
    _requireAuth_(token, 'banquets|journals');
    var d = _mcBlJson_(json) || {};
    if (!String(d.dish || '').trim()) return _ok_({ empty: true });
    var qty = parseFloat(String(d.qty === undefined || d.qty === '' ? '1' : d.qty).replace(',', '.'));
    if (!(qty > 0)) return _fail_('VALIDATION', 'Количество больше нуля');
    var R = _v71Resolve_(d.dish, d.kind, d.unit);
    if (R.error) return _fail_('VALIDATION', R.error);
    return _ok_(_v71Brief_(_v71Run_(R, qty, { dry: true, at: _v71At_(d.date, d.time) })));
  } catch (e) { return _failFrom_(e); }
}

/** Товары со склада без ТТК для подсказки: годные партии с остатком, кроме блюд из ТТК. */
function _v71GoodsList_(idx) {
  var v = _stockBatchesSheet_().getDataRange().getValues(), m = {}, today = _v71Day_(new Date());
  for (var i = 1; i < v.length; i++) {
    var r = v[i]; if (!r[0] || String(r[10] || 'active') !== 'active') continue;
    var remain = parseFloat(r[9]) || 0; if (!(remain > 0.0005)) continue;
    var expDay = r[5] ? _v71Day_(r[5]) : null; if (expDay && expDay < today) continue;
    var d = idx.dishByNormName[_normNameServer_(r[1])]; if (d && !d.semi) continue;
    var k = _prodKey_(r[1]) + '|' + _toBaseUnitServer_(1, r[2]).unit, x = m[k] || (m[k] = { name: String(r[1]), unit: String(r[2] || 'шт'), qty: 0 });
    x.qty += remain * (_toBaseUnitServer_(1, r[2]).qty / (_toBaseUnitServer_(1, x.unit).qty || 1));
  }
  return Object.keys(m).map(function (k) { m[k].qty = _v71R3_(m[k].qty); return m[k]; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); });
}
/** Списание по продажам для «Последних записей»: SaleID → {status, statusRu, cost, short[]}. */
function _v71BySale_() {
  var sh = _book_().getSheetByName(MC_V71.SHEET), m = {};
  if (!sh || sh.getLastRow() < 2) return m;
  sh.getRange(2, 1, sh.getLastRow() - 1, MC_V71_HEAD.length).getValues().forEach(function (r) {
    var sf = []; try { sf = JSON.parse(r[9] || '[]'); } catch (e) {}
    var ln = []; try { ln = JSON.parse(r[8] || '[]'); } catch (e) {}
    m[String(r[0])] = { status: String(r[13]), statusRu: MC_V71_STATUS_RU_[String(r[13])] || String(r[13]), cost: Number(r[11]) || 0, batches: ln.length,
      short: sf.map(function (s) { return s.product + ' ' + String(_v71R3_(s.qty)).replace('.', ',') + ' ' + s.unit; }) };
  });
  return m;
}

// Прежний вызов addSaleEntry (офлайн-очередь, старые экраны) идёт тем же путём, что и экран «Журнал продаж»:
// проверка по ТТК или складу и списание партий. Ответ — в прежнем виде {ok, date, time, sum, seller} или {error}.
(function () {
  if (typeof addSaleEntry !== 'function' || typeof mcSaleAdd !== 'function') return;
  addSaleEntry = function (entryJson, token) {
    var e = {}; try { e = JSON.parse(entryJson || '{}'); } catch (x) { return JSON.stringify({ error: 'format' }); }
    var r = {}; try { r = JSON.parse(mcSaleAdd(JSON.stringify({ dish: e.dishName || e.dish, kind: e.kind, unit: e.unit, qty: e.qty, price: e.price, sum: e.sum, seller: e.sellerName || e.seller }), token)); } catch (x) { return JSON.stringify({ error: String(x) }); }
    if (r && (r.ok || r.success)) { var d = r.data || {}; return JSON.stringify({ ok: true, date: d.date, time: d.time, sum: d.sum, seller: d.seller, stock: d.stock || null }); }
    return JSON.stringify({ error: (r && r.error && (r.error.message || r.error)) || 'не записано' });
  };
})();
