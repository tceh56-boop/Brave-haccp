/**
 * MonChef V88 — «Моя смена»: заготовки по норме из продаж, сроки годности и go-лист, списание «брак / персонал / пересорт» (18.11.2026).
 *
 *  1. Заготовки. Спрос на каждый полуфабрикат считается из продаж блюд (журнал продаж J36 — зал и банкеты) за 4 недели
 *     по неделям: порции блюда × п/ф на порцию по ТТК (вложенные п/ф — по их ТТК). Норма запаса = спрос в день × дни запаса
 *     (по умолчанию 1 день — заготовка на день вперёд; меняют шеф-повар, су-шеф, директор). Если норма п/ф закреплена
 *     вручную в «Нормах остатка» — берётся она. Приготовить = норма − годный остаток п/ф − уже в плане производства.
 *     В «Моей смене» — карточка на каждый п/ф ниже нормы, «Запланировать» (заказ производства).
 *  2. Сроки годности. Партии, у которых срок истекает в ближайшие N дней (по умолчанию 3): остаток, цена, сумма, в каких
 *     блюдах используется и сколько порций можно продать. Go-лист — что продать сегодня (блюда из этих продуктов);
 *     спецпредложение вписывает человек, система цену не меняет.
 *  3. Кнопки по партии: «Брак» — списание партии (wasteBatch, причина обязательна); «Персонал» — акт «Питание персонала»
 *     (FEFO, просроченное не берётся); «Пересорт» — продукт отдаётся вместо другого продукта из базы (например, вырезка вместо
 *     задка): продажи блюд с этим продуктом списывают партию пересорта, пока не израсходовано выделенное количество.
 *     Отчёт о пересорте за день: сколько порций продано, выручка, себестоимость по ТТК и фактическая, фудкост, на сколько
 *     меньше заработали из-за пересорта. Цены — только из партий и остатков склада (средняя), выручка — из журнала продаж.
 */
var MC_V88_PREP_PROP_ = 'MC_V88_PREP_DAYS', MC_V88_EXP_PROP_ = 'MC_V88_EXP_DAYS';
var MC_V88_RS_ = 'Пересорт_V88', MC_V88_RS_HEAD_ = ['ID', 'Создан', 'Партия', 'Продукт', 'Ед. (база)', 'Выделено', 'Цена за ед. (база)', 'Замена — продукт по ТТК', 'Цена замены за ед. (база)',
  'Блюда', 'Использовано', 'Остаток', 'Статус', 'Кто', 'Основание', 'Годен до'];
var MC_V88_RU_ = 'Пересорт_Расход_V88', MC_V88_RU_HEAD_ = ['Время', 'Дата', 'Пересорт', 'Продажа', 'Блюдо', 'Порций в продаже', 'Партия', 'Кол-во (база)', 'Ед.', 'Цена за ед. (база)', 'Цена замены за ед. (база)', 'Разница, ₽'];
var MC_V88_GO_ = 'Go_Лист_V88', MC_V88_GO_HEAD_ = ['Дата', 'Сформирован', 'Блюдо', 'Код ТТК', 'Продукт', 'Партия', 'Годен до', 'Порций из остатка', 'Цена продажи (последняя)', 'Спецпредложение', 'Кто'];

function _v88R2_(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function _v88R3_(x) { return Math.round((Number(x) || 0) * 1000) / 1000; }
function _v88Prop_(k, d, lo, hi) { try { var n = parseInt(PropertiesService.getScriptProperties().getProperty(k), 10); return n >= lo && n <= hi ? n : d; } catch (e) { return d; } }
function _v88PrepDays_() { return _v88Prop_(MC_V88_PREP_PROP_, 1, 1, 7); }
function _v88ExpDays_() { return _v88Prop_(MC_V88_EXP_PROP_, 3, 1, 14); }
function _v88Boss_(s) { if (!s || s.dev) return false; var r = _mcRbNormRole_(s.role); return ['S', 'SS', 'D'].some(function (k) { return MC_RB_J_[k] === r; }); }
function _v88Today_() { return _v71Day_(new Date()); }
function _v88DayDiff_(a, b) { return Math.round((Date.parse(a) - Date.parse(b)) / 864e5); }
/** Число по-русски: разряды через неразрывный пробел, дробная часть через запятую. */
function _v88N_(x, d) { var p = Math.pow(10, d === undefined ? 2 : d), t = String(Math.round((Number(x) || 0) * p) / p).split('.'); t[0] = t[0].replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0'); return t.join(','); }
/** Количество в базовой единице → текст: 1 250 г → «1,25 кг», 600 г → «600 г». */
function _v88Fmt_(q, u) {
  q = Number(q) || 0; u = String(u || '');
  var n = function (x, d) { return _v88N_(x, d); };
  if (u === 'г' && Math.abs(q) >= 1000) return n(q / 1000, 2) + ' кг';
  if (u === 'мл' && Math.abs(q) >= 1000) return n(q / 1000, 2) + ' л';
  return n(q, u === 'шт' ? 1 : 0) + ' ' + u;
}
/** Цена за базовую единицу → «1 800 ₽/кг». */
function _v88PriceTxt_(pb, u) {
  if (!(pb > 0)) return 'цена неизвестна';
  var f = function (x) { return _v88N_(x, 2) + ' ₽'; };
  return u === 'г' ? f(pb * 1000) + '/кг' : u === 'мл' ? f(pb * 1000) + '/л' : f(pb) + '/' + u;
}
function _v88Money_(x) { return _v88N_(x, 2) + ' ₽'; }

/* ---------------- продажи (J36) и спрос на п/ф ---------------- */
function _v88Sales_() {
  var j = _mcJById_('J36'), sh = j && _book_().getSheetByName(j.sheetName), today = _v88Today_(), out = { rows: [], first: null, today: today };
  if (!sh || sh.getLastRow() < 2) return out;
  var v = sh.getDataRange().getValues(), H = v[0], cD = H.indexOf('Дата'), cB = H.indexOf('Блюдо'), cQ = H.indexOf('Количество'), cP = H.indexOf('Цена'), cS = H.indexOf('Сумма'), cR = H.indexOf('Источник записи');
  for (var i = 1; i < v.length; i++) {
    var d = _v71Day_(v[i][cD]); if (!d || !v[i][cB]) continue;
    if (!out.first || d < out.first) out.first = d;
    out.rows.push({ day: d, age: _v88DayDiff_(today, d), dish: String(v[i][cB]), qty: parseFloat(v[i][cQ]) || 0, price: parseFloat(v[i][cP]), sum: parseFloat(v[i][cS]), src: cR >= 0 ? String(v[i][cR] || '') : '' });
  }
  return out;
}
function _v88LastPrice_(S) { var m = {}; (S || _v88Sales_()).rows.forEach(function (r) { var k = _normNameServer_(r.dish); if (r.price >= 0 && (!m[k] || r.day >= m[k].day)) m[k] = { day: r.day, price: r.price }; }); return m; }
function _v88Dish_(name, idx) { return idx.dishByNormName[_normNameServer_(name)] || idx.dishByLooseName[_looseNameServer_(name)] || null; }
function _v88PfOf_(name, idx, memo) {
  var k = _normNameServer_(name); if (memo && memo.hasOwnProperty(k)) return memo[k];
  var d = idx.dishByNormName[k] || null; if (!d || !d.semi) d = (typeof _findPfDish_ === 'function' ? _findPfDish_(name, idx) : null) || d;
  var r = d && d.semi ? d : null; if (memo) memo[k] = r; return r;
}
function _v88AddPf_(pf, q, u, w, D, idx, memo, depth) {
  var x = D[pf.code] || (D[pf.code] = { code: pf.code, name: pf.name, unit: u, weeks: [0, 0, 0, 0], total: 0 });
  if (x.unit !== u) return;
  x.weeks[w] += q; x.total += q;
  if (depth >= 3) return;
  var y = _subYield_(pf); if (!(y > 0)) return;
  (pf.ing || []).forEach(function (ing) { var sub = _v88PfOf_(ing[0], idx, memo); if (!sub || sub.code === pf.code) return; var b = _toBaseUnitServer_(Number(ing[1]) || 0, ing[2]); _v88AddPf_(sub, b.qty * q / y, b.unit, w, D, idx, memo, depth + 1); });
}
/** Спрос на п/ф из продаж блюд за 4 недели: {D: {код: {name, unit, weeks[4], total}}, days — сколько дней истории (≤ 28)}. */
function _v88Demand_(idx, S) {
  S = S || _v88Sales_(); var D = {}, memo = {};
  S.rows.forEach(function (r) {
    if (r.age < 0 || r.age >= 28 || !(r.qty > 0)) return;
    var dish = _v88Dish_(r.dish, idx); if (!dish || dish.semi) return;
    var w = Math.floor(r.age / 7);
    (dish.ing || []).forEach(function (ing) { var pf = _v88PfOf_(ing[0], idx, memo); if (!pf) return; var b = _toBaseUnitServer_((Number(ing[1]) || 0) * r.qty, ing[2]); _v88AddPf_(pf, b.qty, b.unit, w, D, idx, memo, 0); });
  });
  var days = S.first ? Math.min(28, Math.max(1, _v88DayDiff_(S.today, S.first) + 1)) : 0;
  return { D: D, days: days };
}
function _v88PfStockMap_() {
  var ctx = { day: _v88Today_(), sh: _stockBatchesSheet_(), res: _v71Reserved_(), blocked: _v71Blocked_(), taken: {} }; ctx.v = ctx.sh.getDataRange().getValues();
  return _v71PfStock_(ctx);
}
function _v88Planned_() {
  var m = {}, pv = _productionSheet_().getDataRange().getValues();
  for (var j = 1; j < pv.length; j++) {
    var st = pv[j][PROD_COL_.status]; if (st !== 'PLANNED' && st !== 'IN_PROGRESS') continue;
    var b = _toBaseUnitServer_(parseFloat(pv[j][PROD_COL_.plan]) || 0, pv[j][PROD_COL_.unit] || 'г'), k = String(pv[j][PROD_COL_.code]) + '|' + b.unit;
    m[k] = (m[k] || 0) + b.qty;
  }
  return m;
}
/** Нормы, закреплённые вручную в «Склад_Остатки» (режим «вручную»): ключ продукта → {qty, unit} в базовой единице. */
function _v88ManualNorms_() {
  var m = {};
  try { var v = _stockBalanceSheet_().getDataRange().getValues();
    for (var i = 1; i < v.length; i++) if (v[i][0] && String(v[i][7] || '').toLowerCase() === 'вручную') { var b = _toBaseUnitServer_(parseFloat(v[i][3]) || 0, v[i][1] || 'г'); m[_prodKey_(v[i][0])] = { qty: b.qty, unit: b.unit }; } } catch (e) {}
  return m;
}
function _v88Ceil_(q, u) { if (!(q > 0)) return 0; return u === 'шт' ? Math.ceil(q - 1e-9) : Math.ceil(q / 10 - 1e-9) * 10; }
/** Заготовки: все п/ф, которые продаются в блюдах, с нормой и «приготовить». */
function _v88Prep_() {
  var idx = _buildDishIndexes_(), S = _v88Sales_(), dm = _v88Demand_(idx, S), st = _v88PfStockMap_(), pl = _v88Planned_(), man = _v88ManualNorms_(), days = _v88PrepDays_(), out = [];
  Object.keys(dm.D).forEach(function (code) {
    var x = dm.D[code], stock = st[_prodKey_(x.name) + '|' + x.unit] || 0, planned = pl[code + '|' + x.unit] || 0, perDay = dm.days ? x.total / dm.days : 0, mn = man[_prodKey_(x.name)];
    var manual = !!(mn && mn.unit === x.unit), norm = manual ? mn.qty : perDay * days, make = _v88Ceil_(norm - stock - planned, x.unit);
    out.push({ code: code, name: x.name, unit: x.unit, weeks: x.weeks.map(_v88R3_), perDay: _v88R3_(perDay), norm: _v88R3_(norm), manual: manual, stock: _v88R3_(stock), planned: _v88R3_(planned), make: make, days: days, history: dm.days });
  });
  out.sort(function (a, b) { return (b.make > 0) - (a.make > 0) || b.make - a.make || a.name.localeCompare(b.name, 'ru'); });
  return out;
}
function _v88PrepText_(x) {
  var f = function (q) { return _v88Fmt_(q, x.unit); };
  return 'на складе ' + f(x.stock) + (x.planned ? ' · в плане ' + f(x.planned) : '') + ' · норма ' + f(x.norm) +
    (x.manual ? ' (закреплена вручную)' : ' на ' + x.days + ' дн. — по продажам за ' + x.history + ' дн.; по неделям (от последней): ' + x.weeks.map(f).join(' / '));
}
function v88PrepData(token) {
  var op = null;
  try { op = _beginOp_(token, 'kanban|plan|prod_manage|stock', 'PREP_VIEW', 'Производство', null, null); } catch (e) { return _failFrom_(e); }
  try { var L = _v88Prep_(); _endOp_(op); return _ok_({ items: L, prepDays: _v88PrepDays_(), canPlan: _mcRbHasExact_(op.session, 'kanban') && !op.session.dev }, op.id); }
  catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** «Запланировать»: {code, qty, unit} → заказ производства п/ф (planProduction). Повтор, когда уже в плане, — отказ. */
function v88PlanPrep(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'kanban', 'PREP_PLAN', 'Производство', null, null); } catch (e) { return _failFrom_(e); }
  try {
    if (op.session && op.session.dev) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', 'Технический доступ заказы производства не создаёт', op.id); }
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), q = parseFloat(String(d.qty || '').replace(',', '.'));
    if (!d.code) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Не указан полуфабрикат', op.id); }
    if (!(q > 0)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Количество больше нуля', op.id); }
    return _withLock_(function () {
      var x = _v88Prep_().filter(function (i) { return String(i.code) === String(d.code); })[0];
      if (x && !(x.make > 0) && d.force !== true) { _endOp_(op, 'FAILED'); return _fail_('CONFLICT', '«' + x.name + '»: запас в норме или уже в плане (' + _v88Fmt_(x.planned, x.unit) + ') — повтор не нужен', op.id); }
      var r = _v86Res_(planProduction(String(d.code), q, d.unit || (x && x.unit) || 'г', '[]', 'Заготовка по норме из продаж' + (x ? ' (норма ' + _v88Fmt_(x.norm, x.unit) + ', на складе ' + _v88Fmt_(x.stock, x.unit) + ')' : ''), token));
      if (!r.ok) { _endOp_(op, 'FAILED'); return _fail_(r.code || 'VALIDATION', r.msg, op.id); }
      _audit_(op, 'PREP_PLAN', 'Производство', r.data.id, null, { pf: x ? x.name : d.code, qty: q, unit: d.unit || (x && x.unit) });
      _endOp_(op); return _ok_({ id: r.data.id, name: x ? x.name : String(d.code), qty: q, unit: d.unit || (x && x.unit) || 'г', text: _v88Fmt_(q, d.unit || (x && x.unit) || 'г') }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- сроки годности и go-лист ---------------- */
/** Блюда (не п/ф), где продукт идёт прямо или через п/ф: порций можно продать из остатка. */
function _v88DishesFor_(name, remainBase, baseUnit, idx, lp) {
  var key = _prodKey_(name), viaPf = {}, out = [];
  Object.keys(idx.dishByCode).forEach(function (c) {
    var d = idx.dishByCode[c]; if (!d.semi) return; var y = _subYield_(d); if (!(y > 0)) return;
    (d.ing || []).forEach(function (ing) { if (_prodKey_(ing[0]) !== key) return; var b = _toBaseUnitServer_(Number(ing[1]) || 0, ing[2]); if (b.unit === baseUnit) viaPf[_prodKey_(d.name)] = { pf: d, per: b.qty / y }; });
  });
  Object.keys(idx.dishByCode).forEach(function (c) {
    var d = idx.dishByCode[c]; if (d.semi) return; var per = 0, via = '';
    (d.ing || []).forEach(function (ing) {
      var b = _toBaseUnitServer_(Number(ing[1]) || 0, ing[2]);
      if (_prodKey_(ing[0]) === key) { if (b.unit === baseUnit) per += b.qty; return; }
      var p = viaPf[_prodKey_(ing[0])]; if (p) { per += b.qty * p.per; via = p.pf.name; }
    });
    if (per > 0) { var pr = lp[_normNameServer_(d.name)]; out.push({ code: String(d.code), name: String(d.name), per: _v88R3_(per), portions: Math.floor(remainBase / per + 1e-9), via: via, price: pr ? pr.price : null }); }
  });
  out.sort(function (a, b) { return b.portions - a.portions; });
  return out;
}
/** Партии со сроком годности в ближайшие days дней (годные, с остатком, не заблокированные). */
function _v88Expiring_(days) {
  var v = _stockBatchesSheet_().getDataRange().getValues(), today = _v88Today_(), lim = _v71Day_(new Date(Date.now() + days * 864e5)), blk = _v71Blocked_(), idx = _buildDishIndexes_(), lp = _v88LastPrice_(), out = [];
  for (var i = 1; i < v.length; i++) {
    var r = v[i]; if (!r[0] || String(r[10] || 'active') !== 'active' || blk[String(r[0])]) continue;
    var rem = parseFloat(r[9]) || 0; if (!(rem > 0.0005)) continue;
    var ed = r[5] ? _v71Day_(r[5]) : null; if (!ed || ed < today || ed > lim) continue;
    var unit = String(r[2] || 'г'), b = _toBaseUnitServer_(rem, unit), one = _toBaseUnitServer_(1, unit).qty || 1, price = parseFloat(r[6]) || 0;
    out.push({ batchId: String(r[0]), product: String(r[1]), unit: unit, baseUnit: b.unit, remain: _v88R3_(rem), remainBase: _v88R3_(b.qty), remainText: _v88Fmt_(b.qty, b.unit),
      expiry: ed, expiryText: ed.split('-').reverse().join('.'), daysLeft: _v88DayDiff_(ed, today), priceBase: price / one, priceText: _v88PriceTxt_(price / one, b.unit), value: _v88R2_(rem * price),
      dishes: _v88DishesFor_(r[1], b.qty, b.unit, idx, lp), rs: _v88RsOfBatch_(String(r[0])) });
  }
  out.sort(function (a, b) { return a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : a.product.localeCompare(b.product, 'ru'); });
  return out;
}
/** Go-лист: блюда из продуктов с подходящим сроком — что продать сегодня. */
function _v88GoRows_(E) {
  var rows = [];
  E.forEach(function (e) { e.dishes.forEach(function (d) { if (d.portions > 0) rows.push({ dish: d.name, code: d.code, product: e.product, batchId: e.batchId, expiry: e.expiry, expiryText: e.expiryText, daysLeft: e.daysLeft, portions: d.portions, price: d.price, via: d.via }); }); });
  rows.sort(function (a, b) { return a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : b.portions - a.portions; });
  return rows;
}
function _v88GoSaved_(day) {
  var sh = _book_().getSheetByName(MC_V88_GO_); if (!sh || sh.getLastRow() < 2) return { at: '', by: '', rows: [] };
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, MC_V88_GO_HEAD_.length).getValues(), last = 0;
  v.forEach(function (r) { if (_v71Day_(r[0]) === day && r[1] instanceof Date && r[1].getTime() > last) last = r[1].getTime(); });
  var rows = v.filter(function (r) { return _v71Day_(r[0]) === day && r[1] instanceof Date && r[1].getTime() === last; }).map(function (r) {
    return { dish: String(r[2]), code: String(r[3]), product: String(r[4]), batchId: String(r[5]), expiryText: r[6] instanceof Date ? Utilities.formatDate(r[6], _mcTz_(), 'dd.MM.yyyy') : String(r[6]), portions: Number(r[7]) || 0, price: r[8] === '' ? null : Number(r[8]), offer: String(r[9] || ''), by: String(r[10] || '') }; });
  return { at: last ? Utilities.formatDate(new Date(last), _mcTz_(), 'HH:mm') : '', by: rows.length ? rows[0].by : '', rows: rows };
}
/** «Сформировать go-лист»: {offers: {"код|партия": "текст спецпредложения"}} — снимок на сегодня. */
function v88GoList(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock|kanban|costs|banquets', 'GO_LIST', 'Склад', null, null); } catch (e) { return _failFrom_(e); }
  try {
    if (op.session && op.session.dev) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', 'Технический доступ go-лист не формирует', op.id); }
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), offers = d.offers || {};
    return _withLock_(function () {
      var rows = _v88GoRows_(_v88Expiring_(_v88ExpDays_()));
      if (!rows.length) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Продуктов с подходящим сроком, которые входят в блюда ТТК, нет — go-лист пуст', op.id); }
      var sh = _bcSheet_(MC_V88_GO_, MC_V88_GO_HEAD_), now = new Date(), day = _v88Today_(), who = _author_(op).фио;
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, MC_V88_GO_HEAD_.length).setValues(rows.map(function (r) {
        return ["'" + day.split('-').reverse().join('.'), now, r.dish, r.code, r.product, r.batchId, "'" + r.expiryText, r.portions, r.price === null || r.price === undefined ? '' : r.price, String(offers[r.code + '|' + r.batchId] || '').slice(0, 200), who]; }));
      _audit_(op, 'GO_LIST', 'Склад', day, null, { rows: rows.length });
      _endOp_(op); return _ok_({ day: day.split('-').reverse().join('.'), rows: rows.length, dishes: rows.map(function (r) { return r.dish; }).filter(function (x, i, a) { return a.indexOf(x) === i; }) }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- брак и питание персонала ---------------- */
function _v88Batch_(id) {
  var v = _stockBatchesSheet_().getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(id)) return { row: i + 1, v: v[i] };
  return null;
}
/** {batchId, mode: 'SPOIL' (брак) | 'STAFF' (питание персонала), qty, unit, comment, confirm: true}. */
function v88WriteOff(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock', 'EXPIRY_WRITEOFF', 'Склад', null, null); } catch (e) { return _failFrom_(e); }
  try {
    if (op.session && op.session.dev) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', 'Технический доступ не списывает', op.id); }
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), mode = String(d.mode || ''), q = parseFloat(String(d.qty || '').replace(',', '.')), cm = String(d.comment || '').trim();
    if (['SPOIL', 'STAFF'].indexOf(mode) < 0) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Выберите: брак или питание персонала', op.id); }
    var b = _v88Batch_(d.batchId); if (!b) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Партия не найдена', op.id); }
    var unit = String(d.unit || b.v[2] || 'г');
    if (!(q > 0)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Количество больше нуля', op.id); }
    if (!_unitsCompatible_(unit, b.v[2])) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Единица «' + unit + '» не подходит к партии (' + b.v[2] + ')', op.id); }
    if (_toBaseUnitServer_(q, unit).qty > _toBaseUnitServer_(parseFloat(b.v[9]) || 0, b.v[2]).qty + 0.0005) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'В партии осталось ' + _v88Fmt_(_toBaseUnitServer_(parseFloat(b.v[9]) || 0, b.v[2]).qty, _toBaseUnitServer_(1, b.v[2]).unit), op.id); }
    if (mode === 'SPOIL' && !cm) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Брак: опишите, что не так (вид, запах, упаковка) — система причину не придумывает', op.id); }
    if (d.confirm !== true) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Подтвердите списание', op.id); }
    var r = mode === 'SPOIL' ? _v86Res_(wasteBatch(String(d.batchId), q, unit, 'Брак: ' + cm, '', 'из «Сроков годности»', token))
      : _v86Res_(mcWriteOffAct(JSON.stringify({ reason: 'STAFF', comment: 'из «Сроков годности», партия ' + d.batchId + (cm ? ': ' + cm : ''), lines: [{ kind: 'product', name: String(b.v[1]), qty: q, unit: unit }] }), token));
    if (!r.ok) { _endOp_(op, 'FAILED'); return _fail_(r.code || 'VALIDATION', r.msg, op.id); }
    _endOp_(op);
    return _ok_({ mode: mode, product: String(b.v[1]), batchId: String(d.batchId), qty: q, unit: unit, text: _v88Fmt_(_toBaseUnitServer_(q, unit).qty, _toBaseUnitServer_(1, unit).unit),
      cost: mode === 'SPOIL' ? r.data.cost : r.data.total, actId: r.data.actId || '', remainText: r.data.remainText || '', batches: mode === 'STAFF' ? (r.data.rows || []).reduce(function (a, x) { return a.concat((x.batches || []).map(function (y) { return y.batchId; })); }, []) : [String(d.batchId)] }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- пересорт ---------------- */
function _v88RsRows_() {
  var sh = _book_().getSheetByName(MC_V88_RS_); if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, MC_V88_RS_HEAD_.length).getValues().map(function (r, i) { var o = { _row: i + 2 }; MC_V88_RS_HEAD_.forEach(function (h, j) { o[h] = r[j]; }); return o; });
}
function _v88RsOfBatch_(id) { return _v88RsRows_().filter(function (r) { return String(r['Партия']) === String(id) && String(r['Статус']) === 'ACTIVE'; }).map(function (r) { return { id: String(r.ID), target: String(r['Замена — продукт по ТТК']), left: _v88Fmt_(Number(r['Остаток']) || 0, String(r['Ед. (база)'])) }; }); }
function _v88ActiveRs_() {
  return _v88RsRows_().filter(function (r) { return String(r['Статус']) === 'ACTIVE' && Number(r['Остаток']) > 0.0005; }).map(function (r) {
    return { row: r._row, id: String(r.ID), batchId: String(r['Партия']), product: String(r['Продукт']), target: String(r['Замена — продукт по ТТК']), baseUnit: String(r['Ед. (база)']), remainBase: Number(r['Остаток']) || 0,
      srcPriceBase: Number(r['Цена за ед. (база)']) || 0, tgtPriceBase: r['Цена замены за ед. (база)'] === '' ? null : Number(r['Цена замены за ед. (база)']) };
  });
}
/** Продукты ТТК, на которые можно сделать пересорт: ингредиенты блюд (и п/ф) с ценой склада и блюдами. */
function _v88Targets_() {
  var idx = _buildDishIndexes_(), m = {};
  Object.keys(idx.dishByCode).forEach(function (c) {
    var d = idx.dishByCode[c];
    (d.ing || []).forEach(function (ing) {
      if (_v88PfOf_(ing[0], idx, null)) return;
      var k = _prodKey_(ing[0]), b = _toBaseUnitServer_(1, ing[2]), x = m[k] || (m[k] = { name: String(ing[0]), baseUnit: b.unit, dishes: [] });
      if (!d.semi && x.dishes.indexOf(String(d.name)) < 0) x.dishes.push(String(d.name));
      if (d.semi) Object.keys(idx.dishByCode).forEach(function (c2) { var d2 = idx.dishByCode[c2]; if (d2.semi) return; if ((d2.ing || []).some(function (i2) { return _prodKey_(i2[0]) === _prodKey_(d.name) || _normNameServer_(i2[0]) === _normNameServer_(d.name); }) && x.dishes.indexOf(String(d2.name)) < 0) x.dishes.push(String(d2.name)); });
    });
  });
  return Object.keys(m).map(function (k) { var x = m[k], p = 0; try { p = _currentAvgPrice_(x.name, x.baseUnit) || 0; } catch (e) {} x.priceBase = p; x.priceText = _v88PriceTxt_(p, x.baseUnit); return x; })
    .filter(function (x) { return x.dishes.length; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); });
}
/** «Пересорт»: {batchId, qty, unit, target, comment, confirm} — партия идёт в блюда вместо продукта target. */
function v88Resort(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock', 'RESORT', 'Склад', null, null); } catch (e) { return _failFrom_(e); }
  try {
    if (!_v88Boss_(op.session)) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', 'Пересорт решают шеф-повар, су-шеф, директор: это меняет себестоимость блюд', op.id); }
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), q = parseFloat(String(d.qty || '').replace(',', '.')), tg = String(d.target || '').trim();
    var b = _v88Batch_(d.batchId); if (!b) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Партия не найдена', op.id); }
    if (String(b.v[10] || 'active') !== 'active') { _endOp_(op, 'FAILED'); return _fail_('BATCH_STATE', 'Партия не в обороте (статус «' + b.v[10] + '»)', op.id); }
    var unit = String(d.unit || b.v[2] || 'г'), bu = _toBaseUnitServer_(1, b.v[2]).unit, qb = _toBaseUnitServer_(q, unit).qty, remB = _toBaseUnitServer_(parseFloat(b.v[9]) || 0, b.v[2]).qty;
    if (!(q > 0) || !_unitsCompatible_(unit, b.v[2])) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите количество в единице партии (' + b.v[2] + ')', op.id); }
    var busy = _v88ActiveRs_().filter(function (r) { return r.batchId === String(d.batchId); }).reduce(function (a, r) { return a + r.remainBase; }, 0);
    if (qb > remB - busy + 0.0005) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'В партии ' + _v88Fmt_(remB, bu) + (busy ? ', из них уже в пересорте ' + _v88Fmt_(busy, bu) : '') + ' — больше выделить нельзя', op.id); }
    var T = _v88Targets_().filter(function (x) { return _prodKey_(x.name) === _prodKey_(tg); })[0];
    if (!T) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Выберите продукт из базы, который входит в блюда ТТК', op.id); }
    if (_prodKey_(T.name) === _prodKey_(b.v[1])) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Это тот же продукт — пересорт не нужен', op.id); }
    if (T.baseUnit !== bu) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', '«' + T.name + '» учитывается в «' + T.baseUnit + '», партия — в «' + bu + '»: пересорт между ними не считается', op.id); }
    if (d.confirm !== true) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Подтвердите пересорт: себестоимость блюд изменится', op.id); }
    return _withLock_(function () {
      var one = _toBaseUnitServer_(1, b.v[2]).qty || 1, src = (parseFloat(b.v[6]) || 0) / one, tgt = T.priceBase > 0 ? T.priceBase : null, now = new Date(), who = _author_(op).фио;
      var sh = _bcSheet_(MC_V88_RS_, MC_V88_RS_HEAD_), n = _v88RsRows_().filter(function (r) { return String(r.ID).indexOf('RS-' + Utilities.formatDate(now, _mcTz_(), 'yyyyMMdd')) === 0; }).length + 1;
      var id = 'RS-' + Utilities.formatDate(now, _mcTz_(), 'yyyyMMdd') + '-' + ('00' + n).slice(-3);
      sh.appendRow([id, now, String(d.batchId), String(b.v[1]), bu, _v88R3_(qb), src, T.name, tgt === null ? '' : tgt, T.dishes.join('; '), 0, _v88R3_(qb), 'ACTIVE', who, String(d.comment || '').slice(0, 200), b.v[5] || '']);
      var diff = tgt === null ? null : (src - tgt) * qb;
      try { _notify_('resort', 'warning', 'Пересорт: ' + b.v[1] + ' вместо ' + T.name, _v88Fmt_(qb, bu) + ' ' + b.v[1] + ' (' + _v88PriceTxt_(src, bu) + ') пойдёт в блюда вместо «' + T.name + '» (' + _v88PriceTxt_(tgt || 0, bu) + '): ' + T.dishes.join(', ') +
        (diff === null ? '. Цена замены неизвестна — разницу в себестоимости посчитать нельзя.' : '. Себестоимость выше на ' + _v88Money_(diff) + ' на всё количество.') + ' Решил: ' + who + '.', 'Директор', 'resort|' + id, op); } catch (e) {}
      _audit_(op, 'RESORT', 'Склад', id, null, { batch: d.batchId, product: b.v[1], target: T.name, qty: _v88R3_(qb), unit: bu, src: src, tgt: tgt });
      _endOp_(op);
      return _ok_({ id: id, product: String(b.v[1]), target: T.name, qtyText: _v88Fmt_(qb, bu), srcText: _v88PriceTxt_(src, bu), tgtText: _v88PriceTxt_(tgt || 0, bu), diff: diff === null ? null : _v88R2_(diff), dishes: T.dishes }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function v88ResortCancel(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock', 'RESORT_CANCEL', 'Склад', null, null); } catch (e) { return _failFrom_(e); }
  try {
    if (!_v88Boss_(op.session)) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', 'Пересорт отменяют шеф-повар, су-шеф, директор', op.id); }
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    return _withLock_(function () {
      var r = _v88RsRows_().filter(function (x) { return String(x.ID) === String(d.id); })[0];
      if (!r) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Пересорт не найден', op.id); }
      if (String(r['Статус']) !== 'ACTIVE') { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Пересорт уже не действует', op.id); }
      _bcSheet_(MC_V88_RS_, MC_V88_RS_HEAD_).getRange(r._row, MC_V88_RS_HEAD_.indexOf('Статус') + 1).setValue('CANCELLED');
      _audit_(op, 'RESORT_CANCEL', 'Склад', String(d.id), 'ACTIVE', 'CANCELLED');
      _endOp_(op); return _ok_({ id: String(d.id), left: _v88Fmt_(Number(r['Остаток']) || 0, String(r['Ед. (база)'])) }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
// продажа (V71): продукт-замена берётся сначала из партии пересорта, пока выделенное не израсходовано
var _V88_RUN_ = null;
try {
  var _v88o_run_ = _v71Run_;
  _v71Run_ = function (item, qty, o) {
    var prev = _V88_RUN_; _V88_RUN_ = { item: item, qty: qty, o: o || {}, rs: null, uses: [] };
    try {
      var res = _v88o_run_(item, qty, o), R = _V88_RUN_;
      if (R.uses.length) { res.resort = R.uses.map(function (u) { return { id: u.s.id, product: u.s.product, target: u.s.target, qtyText: _v88Fmt_(u.qtyBase, u.s.baseUnit) }; }); if (!(o && o.dry)) _v88SaveUses_(R); }
      return res;
    } finally { _V88_RUN_ = prev; }
  };
  var _v88o_cands_ = _v71Cands_;
  _v71Cands_ = function (ctx, name, unit, pid) {
    var out = _v88o_cands_(ctx, name, unit, pid), R = _V88_RUN_;
    if (!R || !R.item || R.item.kind !== 'DISH') return out;
    if (R.rs === null) R.rs = _v88ActiveRs_();
    var key = _prodKey_(name), add = [];
    R.rs.forEach(function (s) {
      if (_prodKey_(s.target) !== key || !_unitsCompatible_(s.baseUnit, unit)) return;
      var left = s.remainBase - (s.usedNow || 0); if (!(left > 0.0005)) return;
      for (var i = 1; i < ctx.v.length; i++) if (String(ctx.v[i][0]) === s.batchId) {
        var r = ctx.v[i]; if (String(r[10] || 'active') !== 'active' || ctx.blocked[s.batchId]) break;
        var ed = r[5] ? _v71Day_(r[5]) : null; if (ed && ed < ctx.day) break;
        var one = _toBaseUnitServer_(1, r[2]).qty || 1, av = Math.min((parseFloat(r[9]) || 0) - (ctx.res[s.batchId] || 0) - (ctx.taken[s.batchId] || 0), left / one);
        if (av > 0.0005) add.push({ i: i, id: s.batchId, product: String(r[1]), unit: String(r[2] || unit), avail: av, exp: r[5] ? _parseDate_(r[5]) : null, price: parseFloat(r[6]) || 0, v88: s });
        break;
      }
    });
    if (!add.length) return out;
    var ids = {}; add.forEach(function (c) { ids[c.id] = true; });
    return add.concat(out.filter(function (c) { return !ids[c.id]; }));
  };
  var _v88o_take_ = _v71Take_;
  _v71Take_ = function (ctx, cands, qty, unit) {
    var res = _v88o_take_(ctx, cands, qty, unit), R = _V88_RUN_;
    if (R && cands && cands.some(function (c) { return c.v88; })) res.got.forEach(function (g) {
      var c = cands.filter(function (x) { return x.v88 && x.id === g.batchId; })[0]; if (!c) return;
      var qb = _toBaseUnitServer_(g.qty, g.unit).qty; c.v88.usedNow = (c.v88.usedNow || 0) + qb;
      R.uses.push({ s: c.v88, qtyBase: qb, qty: g.qty, unit: g.unit });
    });
    return res;
  };
} catch (e) {}
function _v88SaveUses_(R) {
  try {
    var sh = _bcSheet_(MC_V88_RU_, MC_V88_RU_HEAD_), rs = _bcSheet_(MC_V88_RS_, MC_V88_RS_HEAD_), now = new Date(), day = _v88Today_(), by = {};
    R.uses.forEach(function (u) {
      var s = u.s, diff = s.tgtPriceBase === null ? '' : _v88R2_(u.qtyBase * (s.srcPriceBase - s.tgtPriceBase));
      sh.appendRow([now, "'" + day, s.id, String(R.o.saleId || ''), String(R.item.name), R.qty, s.batchId, _v88R3_(u.qtyBase), s.baseUnit, s.srcPriceBase, s.tgtPriceBase === null ? '' : s.tgtPriceBase, diff]);
      by[s.id] = by[s.id] || { s: s, q: 0 }; by[s.id].q += u.qtyBase;
    });
    Object.keys(by).forEach(function (id) {
      var x = by[id], r = _v88RsRows_().filter(function (y) { return String(y.ID) === id; })[0]; if (!r) return;
      var used = _v88R3_((Number(r['Использовано']) || 0) + x.q), left = _v88R3_(Math.max(0, (Number(r['Остаток']) || 0) - x.q));
      rs.getRange(r._row, MC_V88_RS_HEAD_.indexOf('Использовано') + 1, 1, 3).setValues([[used, left, left > 0.0005 ? 'ACTIVE' : 'DONE']]);
    });
  } catch (e) { try { _log_('WARN', 'пересорт: расход не записан: ' + e); } catch (x) {} }
}
/** Отчёт о пересорте за день: по пересорту и блюду — порции, выручка, себестоимость по ТТК и фактическая, фудкост, потеря. */
function _v88Report_(day) {
  var sh = _book_().getSheetByName(MC_V88_RU_); if (!sh || sh.getLastRow() < 2) return { day: day, items: [], loss: 0 };
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, MC_V88_RU_HEAD_.length).getValues(), rsMap = {}, S = _v88Sales_(), sales = {}, cost = {};
  _v88RsRows_().forEach(function (r) { rsMap[String(r.ID)] = r; });
  S.rows.forEach(function (r) { var m = /SL-\d{8}-[0-9A-F]{8}/.exec(r.src); if (m) sales[m[0]] = r; });
  try { var cv = _v71Sheet_().getDataRange().getValues(); for (var i = 1; i < cv.length; i++) cost[String(cv[i][0])] = Number(cv[i][11]) || 0; } catch (e) {}
  var G = {};
  v.forEach(function (r) {
    if (_v71Day_(r[1]) !== day && String(r[1]).replace(/^'/, '') !== day) return;
    var id = String(r[2]), dish = String(r[4]), k = id + '|' + dish, x = G[k] || (G[k] = { id: id, dish: dish, qty: 0, unit: String(r[8]), diff: 0, diffKnown: true, sales: {} });
    x.qty += Number(r[7]) || 0; if (r[11] === '') x.diffKnown = false; else x.diff += Number(r[11]) || 0;
    x.sales[String(r[3])] = Number(r[5]) || 0;
  });
  var items = Object.keys(G).map(function (k) {
    var x = G[k], rs = rsMap[x.id] || {}, por = 0, rev = 0, revKnown = true, act = 0;
    Object.keys(x.sales).forEach(function (sid) { por += x.sales[sid]; var s = sales[sid]; if (s && s.sum >= 0) rev += s.sum; else if (s && s.price >= 0) rev += s.price * s.qty; else revKnown = false; act += cost[sid] || 0; });
    var plan = x.diffKnown ? act - x.diff : null, fcA = rev > 0 ? act / rev * 100 : null, fcP = rev > 0 && plan !== null ? plan / rev * 100 : null;
    var product = String(rs['Продукт'] || ''), target = String(rs['Замена — продукт по ТТК'] || '');
    var t = 'Пересорт: ' + product + ' (' + _v88PriceTxt_(Number(rs['Цена за ед. (база)']) || 0, x.unit) + ') вместо «' + target + '» (' + (rs['Цена замены за ед. (база)'] === '' ? 'цена неизвестна' : _v88PriceTxt_(Number(rs['Цена замены за ед. (база)']) || 0, x.unit)) + '), ' + _v88Fmt_(x.qty, x.unit) + '. ' +
      x.dish + ' — продано ' + String(Math.round(por * 100) / 100).replace('.', ',') + ' порц.' + (revKnown ? ' на ' + _v88Money_(rev) : ' (выручка не по всем продажам)') + '; себестоимость ' +
      (plan === null ? 'по ТТК не посчитать (нет цены замены)' : 'по ТТК ' + _v88Money_(plan) + (fcP !== null ? ' (фудкост ' + String(Math.round(fcP * 10) / 10).replace('.', ',') + ' %)' : '')) + ', фактическая ' + _v88Money_(act) +
      (fcA !== null ? ' (' + String(Math.round(fcA * 10) / 10).replace('.', ',') + ' %)' : '') + (plan === null || !revKnown ? '.' : '; заработали ' + _v88Money_(rev - act) + ' вместо ' + _v88Money_(rev - plan) + ' — меньше на ' + _v88Money_(x.diff) + ' из-за пересорта.');
    return { id: x.id, product: product, target: target, dish: x.dish, qty: _v88R3_(x.qty), qtyText: _v88Fmt_(x.qty, x.unit), portions: Math.round(por * 100) / 100, revenue: revKnown ? _v88R2_(rev) : null, costActual: _v88R2_(act), costPlan: plan === null ? null : _v88R2_(plan),
      foodcostActual: fcA === null ? null : Math.round(fcA * 10) / 10, foodcostPlan: fcP === null ? null : Math.round(fcP * 10) / 10, marginActual: revKnown ? _v88R2_(rev - act) : null, marginPlan: revKnown && plan !== null ? _v88R2_(rev - plan) : null, loss: x.diffKnown ? _v88R2_(x.diff) : null, text: t };
  });
  return { day: day, items: items, loss: _v88R2_(items.reduce(function (a, x) { return a + (x.loss || 0); }, 0)) };
}
function v88ResortReport(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock|costs|finance_view|kanban', 'RESORT_REPORT', 'Склад', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), day = d.date ? _v71Day_(d.date) : _v88Today_();
    if (!day) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Дата не распознана', op.id); }
    var R = _v88Report_(day); _endOp_(op); return _ok_(R, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- экран «Сроки, go-лист и пересорт» ---------------- */
function v88ExpiryData(token) {
  var op = null;
  try { op = _beginOp_(token, 'stock|kanban|costs|banquets|prod_manage', 'EXPIRY_VIEW', 'Склад', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var s = op.session, days = _v88ExpDays_(), E = _v88Expiring_(days), stock = !s.dev && _mcRbHas_(s, 'stock'), boss = _v88Boss_(s);   // «Склад» — как у «Списания по акту» (с прежними синонимами прав)
    var data = { days: days, prepDays: _v88PrepDays_(), items: E, goDraft: _v88GoRows_(E), go: _v88GoSaved_(_v88Today_()), active: _v88ActiveRs_().map(function (r) { return { id: r.id, product: r.product, target: r.target, left: _v88Fmt_(r.remainBase, r.baseUnit) }; }),
      report: _v88Report_(_v88Today_()), can: { stock: stock, resort: stock && boss, boss: boss, go: !s.dev }, targets: stock && boss ? _v88Targets_() : [] };
    _endOp_(op); return _ok_(data, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Настройки: {expDays 1–14, prepDays 1–7} — шеф-повар, су-шеф, директор. */
function v88Settings(json, token) {
  var op = null;
  try { op = _beginOp_(token, '', 'SHIFT_STOCK_SETTINGS', 'Склад', null, null); } catch (e) { return _failFrom_(e); }
  try {
    if (!_v88Boss_(op.session)) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', 'Настройки меняют шеф-повар, су-шеф, директор', op.id); }
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), e = parseInt(d.expDays, 10), p = parseInt(d.prepDays, 10), P = PropertiesService.getScriptProperties();
    if (!(e >= 1 && e <= 14) || !(p >= 1 && p <= 7)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Срок — от 1 до 14 дней; запас заготовок — от 1 до 7 дней', op.id); }
    var was = { expDays: _v88ExpDays_(), prepDays: _v88PrepDays_() }; P.setProperty(MC_V88_EXP_PROP_, String(e)); P.setProperty(MC_V88_PREP_PROP_, String(p));
    _audit_(op, 'SHIFT_STOCK_SETTINGS', 'Склад', null, was, { expDays: e, prepDays: p });
    _endOp_(op); return _ok_({ expDays: e, prepDays: p }, op.id);
  } catch (e2) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e2, op && op.id); }
}

/* ---------------- «Моя смена»: заготовки, сроки, пересорт ---------------- */
try {
  MC_V87_SOURCES_.push(function (ctx) {
    if (!_mcRbHasExact_(ctx.s, 'kanban|plan|prod_manage')) return [];
    var can = _mcRbHasExact_(ctx.s, 'kanban');
    return _v88Prep_().filter(function (x) { return x.make > 0; }).map(function (x) {
      var mk = _v88Fmt_(x.make, x.unit);
      return { key: 'PREP|' + x.code, group: 'prep', source: 'Заготовки', title: x.name + ': приготовить ' + mk, detail: _v88PrepText_(x), who: 'цех',
        act: can ? { kind: 'call', fn: 'v88PlanPrep', args: [{ code: x.code, qty: x.make, unit: x.unit }], label: 'Запланировать ' + mk, confirm: 'Запланировать «' + x.name + '» — ' + mk + '?', alt: { module: 'kanban', label: 'Задания кухни' } } : { kind: 'open', module: 'kanban', label: 'Задания кухни' } };
    });
  });
  MC_V87_SOURCES_.push(function (ctx) {
    if (!_mcRbHasExact_(ctx.s, 'stock|kanban|costs')) return [];
    var E = _v88Expiring_(_v88ExpDays_()), out = [];
    E.slice(0, 15).forEach(function (e) {
      var ds = e.dishes.filter(function (d) { return d.portions > 0; }).slice(0, 3).map(function (d) { return d.name + ' — до ' + d.portions + ' порц.'; });
      out.push({ key: 'EXP|' + e.batchId, group: 'expiry', source: 'Срок годности', title: e.product + ': годен до ' + e.expiryText + (e.daysLeft === 0 ? ' (сегодня)' : ' (через ' + e.daysLeft + ' дн.)'),
        detail: 'остаток ' + e.remainText + (e.value ? ' на ' + _v88Money_(e.value) : '') + (ds.length ? ' · продать: ' + ds.join(', ') : ' · в блюдах ТТК не используется — персонал, пересорт или брак') + (e.rs.length ? ' · пересорт вместо «' + e.rs[0].target + '»' : ''),
        who: 'склад, шеф-повар', act: { kind: 'open', module: 'expiry', label: 'Go-лист · персонал · брак · пересорт' } });
    });
    if (E.length > 15) out.push({ key: 'EXP|more', group: 'expiry', source: 'Срок годности', title: 'Ещё партий с подходящим сроком: ' + (E.length - 15), detail: '', act: { kind: 'open', module: 'expiry', label: 'Все' } });
    return out;
  });
  MC_V87_SOURCES_.push(function (ctx) {
    if (!_v88Boss_(ctx.s) && !_mcRbHasExact_(ctx.s, 'costs|finance_view')) return [];
    var R = _v88Report_(_v88Today_()); if (!R.items.length) return [];
    return [{ key: 'RSR|' + R.day, group: 'expiry', source: 'Пересорт', title: 'Пересорт сегодня: меньше заработали на ' + _v88Money_(R.loss), detail: R.items.map(function (x) { return x.text; }).join(' '), who: 'руководитель', act: { kind: 'open', module: 'expiry', label: 'Отчёт о пересорте' } }];
  });
} catch (e) {}
// итог операции (V87) для действий V88
try {
  MC_V87_OPNAME_.v88PlanPrep = 'Заготовка'; MC_V87_OPNAME_.v88WriteOff = 'Списание партии'; MC_V87_OPNAME_.v88Resort = 'Пересорт'; MC_V87_OPNAME_.v88ResortCancel = 'Пересорт: отмена'; MC_V87_OPNAME_.v88GoList = 'Go-лист';
  MC_V87_OPMOD_.v88PlanPrep = 'kanban'; MC_V87_OPMOD_.v88WriteOff = 'expiry'; MC_V87_OPMOD_.v88Resort = 'expiry'; MC_V87_OPMOD_.v88ResortCancel = 'expiry'; MC_V87_OPMOD_.v88GoList = 'expiry';
  MC_V87_DESCRIBE_.v88PlanPrep = function (d) { return { message: 'Заготовка запланирована', completed: ['заказ производства ' + d.id + ': ' + d.name + ' — ' + d.text], pending: ['начать и выпустить — «Задания кухни» / «Производство»; партия п/ф появится при выпуске'] }; };
  MC_V87_DESCRIBE_.v88WriteOff = function (d) { return { message: d.mode === 'SPOIL' ? 'Списано как брак' : 'Списано на питание персонала', completed: [d.product + ' — ' + d.text + (d.cost !== undefined && d.cost !== null ? ' на ' + _v88Money_(d.cost) : ''), d.actId ? 'акт ' + d.actId : 'партия ' + d.batchId + (d.remainText ? ', в партии осталось ' + d.remainText : '')] }; };
  MC_V87_DESCRIBE_.v88Resort = function (d) { return { message: 'Пересорт: ' + d.product + ' вместо «' + d.target + '»', completed: [d.qtyText + ' — ' + d.srcText + ' вместо ' + d.tgtText, 'блюда: ' + d.dishes.join(', ')],
    pending: ['продажи этих блюд спишут ' + d.product + ', пока не израсходовано ' + d.qtyText, d.diff === null ? 'цена замены неизвестна — разницу не посчитать' : 'себестоимость выше на ' + _v88Money_(d.diff) + ' на всё количество — отчёт о пересорте у руководителя'] }; };
  MC_V87_DESCRIBE_.v88ResortCancel = function (d) { return { message: 'Пересорт отменён', completed: ['неиспользованный остаток ' + d.left + ' снова обычный продукт'] }; };
  MC_V87_DESCRIBE_.v88GoList = function (d) { return { message: 'Go-лист сформирован', completed: ['на ' + d.day + ': ' + d.dishes.length + ' блюд(а), строк ' + d.rows], pending: ['спецпредложение и цену решает руководитель — система цену не меняет'] }; };
  (function (g) { ['v88PlanPrep', 'v88WriteOff', 'v88Resort', 'v88ResortCancel', 'v88GoList'].forEach(function (fn) { _v87Wrap_(g, fn); }); })(this);
} catch (e) {}
try { if (MC_UI_VIEWS_.indexOf('expiry') < 0) MC_UI_VIEWS_ = MC_UI_VIEWS_.concat(['expiry']); } catch (e) {}
try { MC_RB_MODULES_.expiry = 'stock|kanban|costs|banquets|prod_manage'; MC_RB_MODULE_RU_.expiry = 'Сроки, go-лист и пересорт'; } catch (e) {}
