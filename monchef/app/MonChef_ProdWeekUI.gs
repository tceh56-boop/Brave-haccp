/**
 * MON CHEF — «Производство» и «Неделя» в новом интерфейсе (перенесено из Mon Cher / прежнего App.html).
 *
 * uiProductionBoard — производство полуфабрикатов: потребность в п/ф по банкетам на 7 дней
 *   (что произвести, для каких банкетов), заказы в работе с состоянием ККТ, последние выпуски.
 *   Действия — прежние серверные функции: planProduction → startProduction → (замеры ККТ) →
 *   completeProduction (выпуск блокируется без обязательных ККТ) / cancelProduction.
 * uiWeekBoard — неделя: дни с банкетами. Каждый банкет раскрывается с уже посчитанными ТТК:
 *   меню, ТТК на банкет (состав каждого блюда × порции, п/ф раскрыты до сырья по своей карте),
 *   закупка на банкет (с учётом готовых п/ф на складе). Итог недели и заявка на закупку
 *   (потребность − остаток + минимальный запас; позиции ниже минимума — тоже).
 * Ничего не записывается: только расчёт. Записи — кнопками, через права и шлюз.
 */
function _pwR_(x, n) { var m = Math.pow(10, n === undefined ? 3 : n); return Math.round((Number(x) || 0) * m) / m; }
function _pwPretty_(q, u) { if ((u === 'г' || u === 'мл') && q >= 1000) return { qty: _pwR_(q / 1000, 2), unit: u === 'г' ? 'кг' : 'л' }; return { qty: _pwR_(q, 2), unit: u }; }

function uiProductionBoard(token) {
  var s;
  try { s = _requireAuth_(token); } catch (e) { return { ok: false, auth: true, error: String(e.message || e) }; }
  try {
    var perm = s.permissions || {}, can = perm.all === true || perm.kanban === true;
    if (!can) return { ok: true, can: false, suggest: [], active: [], history: [], note: 'Производство полуфабрикатов доступно роли с правом «Канбан и производство».' };
    var sug = [], orders = [];
    try { var r1 = JSON.parse(suggestProduction(7, token)); sug = (r1 && r1.data && r1.data.items) || []; } catch (e) {}
    try { var r2 = JSON.parse(getProductionOrders('', token)); orders = (r2 && r2.data) || []; } catch (e) {}
    var suggest = sug.filter(function (x) { return x.to_produce > 0.001; }).map(function (x) {
      var ev = {}; (x.allocations || []).forEach(function (a) { ev[a.eventId] = (a.format || 'Банкет') + ' ' + _uiRu_(a.date); });
      return { code: x.code, name: x.name, unit: x.unit, demand: _pwR_(x.demand), stock: _pwR_(x.stock), planned: _pwR_(x.planned), toProduce: _pwR_(x.to_produce),
        forEvents: Object.keys(ev).map(function (k) { return ev[k]; }), allocations: x.allocations || [] };
    });
    var active = orders.filter(function (o) { return o.status === 'PLANNED' || o.status === 'IN_PROGRESS'; }).map(function (o) {
      var st = null; try { st = _tccpState_(o.code, o.id); } catch (e) {}
      o.ccp = st ? { required: st.required, ok: st.ok, items: st.items } : { required: 0, ok: true, items: [] };
      return o;
    });
    var history = orders.filter(function (o) { return o.status === 'COMPLETED' || o.status === 'CANCELLED'; }).slice(0, 15);
    // ТТК, пересчитанная на запланированный вес п/ф (множитель = вес / выход карты)
    var idx = _buildDishIndexes_(), tech = _pwTechMap_();
    suggest.forEach(function (x) { x.ttk = _pwPfTtk_(x.code, x.toProduce, x.unit, idx, tech); });
    active.forEach(function (o) { o.ttk = _pwPfTtk_(o.code, o.planned, o.unit, idx, tech); });
    return JSON.parse(JSON.stringify({ ok: true, can: true, suggest: suggest, active: active, history: history,
      canCost: perm.all === true || perm.costs === true }));
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

/** Состав карты повторён дважды подряд (вторая половина строк = первой): признак двойной загрузки.
 *  Расчёт не меняется молча — показывается предупреждение; исправляется карта (новая версия ТТК). */
function _pwDoubled_(d) {
  var a = (d && d.ing) || [], n = a.length; if (n < 2 || n % 2) return false;
  var key = function (x) { return [x[0], x[1], x[2], x[3]].join('|'); };
  for (var i = 0; i < n / 2; i++) if (key(a[i]) !== key(a[i + n / 2])) return false;
  return true;
}
/** Технология и шаги заготовки из листа «Блюда» (действующая версия карты). */
function _pwTechMap_() {
  var m = {};
  try { var v = _book_().getSheetByName('Блюда').getDataRange().getValues(); for (var i = 1; i < v.length; i++) if (v[i][0]) m[String(v[i][0])] = { tech: String(v[i][5] || ''), prep: String(v[i][7] || '') }; } catch (e) {}
  return m;
}
/** ТТК полуфабриката на заданный вес: состав × (вес / выход карты), вложенные п/ф до сырья, сырьё — с остатком склада. */
function _pwPfTtk_(code, qty, unit, idx, tech) {
  var d = idx.dishByCode[code]; if (!d || !d.ing || !d.ing.length) return null;
  var base = _subYield_(d), q = _toBaseUnitServer_(Number(qty) || 0, unit || 'г');
  if (!(base > 0) || !(q.qty > 0)) return null;
  var mult = q.qty / base, yu = d.yieldUnit || q.unit;
  var acc = {}; _serverExplodeInto_(d.ing, mult, acc, [code], 0, idx.dishByCode, idx.dishByNormName, null, null, idx.dishByLooseName);
  var raw = Object.keys(acc).filter(function (k) { return acc[k] > 0.0005; }).map(function (k) {
    var sep = k.lastIndexOf('|'), name = k.slice(0, sep), u = k.slice(sep + 1), need = acc[k], avail = null;
    try { avail = _mcAvailableBase_(name, u, false); } catch (e) {}
    var nb = _toBaseUnitServer_(need, u).qty;
    return { name: name, need: _pwR_(need), unit: u, avail: avail === null ? null : _pwR_(avail), short: avail === null ? null : _pwR_(Math.max(0, nb - avail)) };
  }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); });
  var t = (tech || {})[code] || {}, dbl = _pwDoubled_(d), nested = [];
  (function walk(ls) { (ls || []).forEach(function (l) { if (l.doubled && nested.indexOf(l.name) < 0) nested.push(l.name); walk(l.sub); }); })(_pwTtkTree_(d.ing, 1, idx, [code], 0));
  return { doubled: dbl || nested.length > 0, warning: (dbl ? 'Состав карты записан дважды подряд — сырьё в этом расчёте удвоено. ' : '') + (nested.length ? 'Задвоен состав вложенного п/ф: ' + nested.join(', ') + ' — его сырьё удвоено. ' : '') + (dbl || nested.length ? 'Исправьте карту (новая версия ТТК), затем пересчитайте.' : ''),
    code: code, name: d.name, qty: _pwR_(q.qty), unit: q.unit, cardYield: _pwR_(base), cardUnit: yu, factor: _pwR_(mult, 4),
    lines: _pwTtkTree_(d.ing, mult, idx, [code], 0), raw: raw, short: raw.filter(function (r) { return r.short > 0.0005; }).length, tech: t.tech || '', prep: t.prep || '' };
}

/** ТТК блюда на N порций: состав × порции; п/ф раскрыт по своей карте (выход карты п/ф). */
function _pwTtkTree_(ing, mult, idx, seen, depth) {
  return (ing || []).map(function (x) {
    var name = x[0], unit = x[2], br = (x[1] || 0) * mult, net = (x[3] === undefined || x[3] === '' ? x[1] || 0 : x[3] || 0) * mult;
    var row = { name: _cleanProdName_(name), unit: unit, brutto: _pwR_(br), netto: _pwR_(net) };
    var sub = depth < 6 ? _findSubDish_(name, idx.dishByNormName, idx.dishByLooseName) : null;
    if (sub && sub.ing && sub.ing.length && seen.indexOf(sub.code) < 0) {
      var base = _subYield_(sub), need = net || br;
      row.pf = true; row.code = sub.code; if (_pwDoubled_(sub)) row.doubled = true;
      if (base > 0) row.sub = _pwTtkTree_(sub.ing, need / base, idx, seen.concat(sub.code), depth + 1);
    }
    return row;
  });
}

function _pwStockIndex_() {
  var byKey = {}, pf = {};
  try {
    JSON.parse(getStockBalances()).forEach(function (b) {
      var bb = _toBaseUnitServer_(Number(b.qty) || 0, b.unit), mb = _toBaseUnitServer_(Number(b.minQty) || 0, b.unit), k = _prodKey_(b.name) + '|' + bb.unit;
      var x = byKey[k] || (byKey[k] = { name: b.name, unit: bb.unit, qty: 0, min: 0 });
      x.qty += bb.qty; x.min = Math.max(x.min, mb.qty);
      if (b.isSemi && bb.qty > 0) pf[k] = (pf[k] || 0) + bb.qty;
    });
  } catch (e) {}
  return { byKey: byKey, pf: pf };
}
function _pwAccRows_(acc) {
  return Object.keys(acc).filter(function (k) { return acc[k] > 0.0005; }).map(function (k) {
    var sep = k.lastIndexOf('|'), p = _pwPretty_(acc[k], k.slice(sep + 1));
    return { name: k.slice(0, sep), qty: p.qty, unit: p.unit, base: _pwR_(acc[k]), baseUnit: k.slice(sep + 1) };
  }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); });
}

function uiWeekBoard(token, offset) {
  var s;
  try { s = _requireAuth_(token); } catch (e) { return { ok: false, auth: true, error: String(e.message || e) }; }
  try {
    var perm = s.permissions || {}, all = perm.all === true;
    var mon = new Date(); mon.setHours(0, 0, 0, 0); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7) + 7 * (parseInt(offset, 10) || 0));
    var days = [], iso = function (d) { return Utilities.formatDate(d, _mcTz_(), 'yyyy-MM-dd'); };
    for (var i = 0; i < 7; i++) { var d = new Date(mon); d.setDate(mon.getDate() + i); days.push({ date: iso(d), events: [] }); }
    var from = days[0].date, to = days[6].date;
    var idx = _buildDishIndexes_(), stock = _pwStockIndex_(), weekPfStock = JSON.parse(JSON.stringify(stock.pf));
    var evs = JSON.parse(getEvents()).filter(function (e) { var x = _uiIso_(e.date); return x >= from && x <= to; })
      .sort(function (a, b) { return (_uiIso_(a.date) + (a.time || '')).localeCompare(_uiIso_(b.date) + (b.time || '')); });
    var weekAcc = {}, weekPfUsed = {}, totalPortions = 0;
    evs.forEach(function (e) {
      var items = e.items || [];
      var menu = items.map(function (it) { var dd = idx.dishByCode[it.code]; return { code: it.code, name: dd ? dd.name : (it.name || it.code), qty: Number(it.qty) || 0, found: !!dd,
        out: dd && dd.yieldBase ? _pwR_(dd.yieldBase * (Number(it.qty) || 0), 1) : '', outUnit: dd ? dd.yieldUnit || '' : '' }; });
      var ttk = items.map(function (it) { var dd = idx.dishByCode[it.code]; if (!dd) return null;
        return { code: it.code, name: dd.name, qty: Number(it.qty) || 0, doubled: _pwDoubled_(dd), lines: _pwTtkTree_(dd.ing, Number(it.qty) || 0, idx, [it.code], 0) }; }).filter(Boolean);
      // закупка на банкет: готовые п/ф на складе закрывают свою часть (как в прежнем «Неделя»)
      var acc = {}, pfUsed = {}, evPf = JSON.parse(JSON.stringify(stock.pf));
      items.forEach(function (it) { var dd = idx.dishByCode[it.code]; if (dd) _serverExplodeInto_(dd.ing, Number(it.qty) || 0, acc, [it.code], 0, idx.dishByCode, idx.dishByNormName, evPf, pfUsed, idx.dishByLooseName); });
      items.forEach(function (it) { var dd = idx.dishByCode[it.code]; if (dd) _serverExplodeInto_(dd.ing, Number(it.qty) || 0, weekAcc, [it.code], 0, idx.dishByCode, idx.dishByNormName, weekPfStock, weekPfUsed, idx.dishByLooseName); });
      var pure = {}; items.forEach(function (it) { var dd = idx.dishByCode[it.code]; if (dd) _serverExplodeInto_(dd.ing, Number(it.qty) || 0, pure, [it.code], 0, idx.dishByCode, idx.dishByNormName, null, null, idx.dishByLooseName); });
      Object.keys(pure).forEach(function (k) { pure[k] = _pwR_(pure[k]); });
      var portions = menu.reduce(function (a, m) { return a + m.qty; }, 0); totalPortions += portions;
      var day = days.filter(function (x) { return x.date === _uiIso_(e.date); })[0];
      day.events.push({ id: e.id, name: e.format || e.name || 'Банкет', time: e.time || '', place: e.place || '', guests: e.guests || '', contact: e.contact || '', comment: e.comment || '',
        status: e.status || '', blankId: e.blankId || '', blank: e.blank || '', portions: portions, ttkAgg: pure, raw: { id: e.id, date: e.date, time: e.time || '', format: e.format || e.name || '', name: e.name || '', place: e.place || '', guests: e.guests || '', items: items }, menu: menu, ttk: ttk, purchase: _pwAccRows_(acc), pfFromStock: _pwAccRows_(pfUsed),
        missing: menu.filter(function (m) { return !m.found; }).map(function (m) { return m.name; }) });
    });
    // заявка на закупку: потребность недели − остаток + минимальный запас
    var req = [], inNeed = {};
    Object.keys(weekAcc).forEach(function (k) {
      var sep = k.lastIndexOf('|'), name = k.slice(0, sep), unit = k.slice(sep + 1), need = weekAcc[k]; if (!(need > 0)) return;
      var ik = _prodKey_(name) + '|' + unit; inNeed[ik] = true;
      var st = stock.byKey[ik] || { qty: 0, min: 0 }, buy = need + st.min - st.qty;
      if (buy > 0.001) { var p = _pwPretty_(buy, unit); req.push({ name: name, qty: p.qty, unit: p.unit, need: _pwPretty_(need, unit), stock: _pwPretty_(st.qty, unit), min: st.min ? _pwPretty_(st.min, unit) : null, reason: 'банкеты недели' }); }
    });
    Object.keys(stock.byKey).forEach(function (k) {
      if (inNeed[k]) return; var st = stock.byKey[k];
      if (st.min > 0 && st.qty < st.min) { var p = _pwPretty_(st.min - st.qty, st.unit); req.push({ name: st.name, qty: p.qty, unit: p.unit, need: null, stock: _pwPretty_(st.qty, st.unit), min: _pwPretty_(st.min, st.unit), reason: 'ниже минимального запаса' }); }
    });
    req.sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); });
    return JSON.parse(JSON.stringify({ ok: true, offset: parseInt(offset, 10) || 0, from: from, to: to, today: iso(new Date()), days: days,
      totals: { events: evs.length, portions: totalPortions }, weekPurchase: _pwAccRows_(weekAcc), weekPfFromStock: _pwAccRows_(weekPfUsed), purchaseRequest: req,
      canEdit: all || perm.banquets === true, canConsume: all || perm.stock === true, canExport: true }));
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

/** ТТК п/ф на произвольный вес — для поля «вес» и блока «Произвести любой п/ф». Только расчёт. */
function uiPfTtk(token, code, qty, unit) {
  var s;
  try { s = _requireAuth_(token); } catch (e) { return { ok: false, auth: true, error: String(e.message || e) }; }
  try {
    var p = s.permissions || {}; if (!(p.all === true || p.kanban === true)) return { ok: false, error: 'Нужно право «Канбан и производство»' };
    var q = parseFloat(String(qty).replace(',', '.')); if (!(q > 0)) return { ok: false, error: 'Укажите вес' };
    var t = _pwPfTtk_(String(code), q, unit || 'г', _buildDishIndexes_(), _pwTechMap_());
    return t ? JSON.parse(JSON.stringify({ ok: true, ttk: t })) : { ok: false, error: 'У карты нет состава или выхода — пересчитать на вес нельзя' };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

/* ===== Исправление карт с задвоенным составом (повтор строк «Состав» второй раз подряд) =====
   Для каждой такой карты создаётся ЧЕРНОВИК новой версии ТТК без повтора (saveDish). Рабочая карта
   не меняется, пока шеф не утвердит черновик (Меню и ТТК → «На согласовании»). Выход, нетто,
   выход ингредиента и нетто на порцию берутся из первой копии как есть — ничего не пересчитывается. */
function _mcDoubledList_() {
  var idx = _buildDishIndexes_();
  return Object.keys(idx.dishByCode).filter(function (k) { return _pwDoubled_(idx.dishByCode[k]); }).map(function (k) { var d = idx.dishByCode[k]; return { code: k, name: d.name, rows: d.ing.length }; });
}
function mcFixDoubledCards(token) {
  var s;
  try { s = _requireAuth_(token, 'catalog'); } catch (e) { return _failFrom_(e); }
  try {
    var list = _mcDoubledList_(); if (!list.length) return _ok_({ created: [], skipped: [], note: 'Карт с задвоенным составом нет' });
    var ss = _book_(), dv = ss.getSheetByName('Блюда').getDataRange().getValues(), sv = ss.getSheetByName('Состав').getDataRange().getValues();
    var pend = {}; try { _ttkVersionsSheet_().getDataRange().getValues().slice(1).forEach(function (r) { if (String(r[2]) === 'черновик') pend[String(r[0])] = r[1]; }); } catch (e) {}
    var created = [], skipped = [];
    list.forEach(function (x) {
      if (pend[x.code]) { skipped.push({ code: x.code, name: x.name, why: 'уже есть черновик v' + pend[x.code] + ' — утвердите или отклоните его' }); return; }
      var d = dv.filter(function (r) { return String(r[0]) === x.code; })[0], rows = sv.filter(function (r) { return String(r[0]) === x.code; });
      var half = rows.slice(0, rows.length / 2);
      var num = function (v) { return v === '' || v === null || v === undefined ? undefined : Number(v); };
      var dish = { code: x.code, name: d ? d[1] : x.name, yield: d ? d[3] : '', method: d ? d[5] : '', note: 'Исправление: убран повтор состава (строки были записаны дважды подряд)',
        ingredients: half.map(function (r) { return { name: r[1], unit: r[2], brutto: r[3], brutto_g: num(r[4]), netto_g: num(r[5]), out_g: num(r[6]), portion_g: num(r[8]) }; }) };
      var raw = saveDish(JSON.stringify(dish), token), res = null;
      try { res = typeof raw === 'string' && raw.charAt(0) === '{' ? JSON.parse(raw) : raw; } catch (e) { res = null; }
      if (res && (res.success || res.ok) && res.data && res.data.version) created.push({ code: x.code, name: x.name, version: res.data.version, rowsWas: rows.length, rowsNow: half.length });
      else skipped.push({ code: x.code, name: x.name, why: String((res && res.error && (res.error.message || res.error)) || raw || 'не создан').slice(0, 160) });
    });
    return _ok_({ created: created, skipped: skipped, note: 'Черновики созданы. Рабочие карты не изменятся, пока черновик не утверждён: Меню и ТТК → «На согласовании».' });
  } catch (e) { return _failFrom_(e); }
}

/** Единое окно, экран «Задания кухни»: задачи канбана (банкеты, ручные и системные — просрочка, отклонение, замена лампы).
 *  Повар и кондитер видят задачи своего цеха (этап 10.7), задачи без цеха — все. Раньше доска была только в старом интерфейсе. */
function uiKanbanTasks(date, token) {
  var s;
  try { s = _requireAuth_(token); } catch (e) { return { ok: false, auth: true, error: String(e.message || e) }; }
  try {
    var all = JSON.parse(getKanbanTasks(date || '', '') || '[]');
    if (!Array.isArray(all)) all = [];
    var mine = all.filter(function (t) { return !t.workshop || _mcRbShopAllowed_(s, t.workshop); });
    mine.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)) || String(a.dueTime || '99:99').localeCompare(String(b.dueTime || '99:99')); });
    return { ok: true, date: date || '', who: String(s.fullName || s.name || ''), tasks: mine.slice(-500) };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}
