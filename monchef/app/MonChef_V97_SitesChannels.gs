/**
 * MON CHEF V97 — площадки, склады, каналы продаж, перемещение между складами.
 *
 * Площадка (кафе, точка) — лист «Площадки_V97»; склад площадки — «Склады_V97»; место хранения (V22, «Склад_Места_V22») относится к складу —
 *   «Склады_Места_V97». Пока площадок и складов не заводили, есть одна «Основная площадка» (SITE-MAIN) с «Основным складом» (WH-MAIN):
 *   все прежние места хранения, партии и продажи — там. Названия по умолчанию — служебные, их переименовывают.
 * Склад партии — склад её места хранения. Остаток склада — сумма партий в его местах (лист остатков общий не меняется: перемещение —
 *   внутреннее движение).
 * Перемещение между складами (лист «Перемещения_V97»): отправитель выбирает партии и количество (часть партии выделяется дочерней —
 *   splitBatch V-BL), партии получают статус «transit» («в пути»): их не продают, не списывают в производство и не берут в отбор;
 *   получатель принимает в места хранения своего склада (тип хранения проверяется), можно частично; недостачу закрывают с причиной —
 *   списание (BATCH_WASTE, экономика V64 «Отходы и брак»). Отменить можно, пока ничего не принято.
 * Журнал продаж: два столбца в конце листа (после служебных — старые записи не сдвигаются): «Площадка» и «Канал продаж» (зал, доставка);
 *   выдача банкета — канал «банкет». Продажи до V97 — основная площадка, зал. Продажа списывает партии только со складов своей площадки.
 * Прогноз V93: по площадкам и каналам — тем же методом (среднее по тем же дням недели), с уверенностью по числу наблюдений.
 */
var MC_V97_SITE_ = 'Площадки_V97', MC_V97_SITE_HEAD_ = ['SiteID', 'Название', 'Адрес', 'Статус', 'Создал', 'Создано', 'Изменено'];
var MC_V97_WH_ = 'Склады_V97', MC_V97_WH_HEAD_ = ['WarehouseID', 'SiteID', 'Название', 'Статус', 'Создал', 'Создано', 'Изменено'];
var MC_V97_LOC_ = 'Склады_Места_V97', MC_V97_LOC_HEAD_ = ['LocationID', 'WarehouseID', 'Назначил', 'Назначено'];
var MC_V97_TR_ = 'Перемещения_V97', MC_V97_TR_HEAD_ = ['TransferID', 'Создано', 'Со склада', 'На склад', 'Статус', 'Позиции (JSON)', 'Отправил', 'Отправлено', 'Принял', 'Принято',
  'Расхождения (JSON)', 'Комментарий', 'Закрыл', 'Закрыто', 'Причина закрытия', 'OperationID'];
var MC_V97_CH_RU_ = { HALL: 'зал', DELIVERY: 'доставка', BANQUET: 'банкет' };
var MC_V97_TR_RU_ = { SENT: 'в пути', PARTIAL: 'принято частично', RECEIVED: 'принято', CLOSED: 'закрыто с недостачей', CANCELLED: 'отменено' };
var MC_V97_J36_EXTRA_ = ['Площадка', 'Канал продаж'];
var _V97_SITE_ = null;   // площадка продажи на время записи (списание только с её складов)

/* ---------------- права, меню ---------------- */
(function () {
  try { MC_RB_MODULES_.sites = 'stock|stock_view|org_edit'; MC_RB_MODULE_RU_.sites = 'Площадки, склады и перемещения'; } catch (e) {}
  try { if (MC_UI_VIEWS_.indexOf('sites') < 0) MC_UI_VIEWS_ = MC_UI_VIEWS_.concat(['sites']); } catch (e) {}
  try { var o = _mcViewOfParams_; _mcViewOfParams_ = function (params) { if (params && (params.sites === '1' || params.transfers === '1')) return 'sites'; return o.apply(this, arguments); }; } catch (e) {}
  try {
    var sec = function (k, btn) { var orig = _UI_BUILDERS_[k]; if (typeof orig !== 'function') return; _UI_BUILDERS_[k] = function (token, opts, s) { var r = orig(token, opts, s) || {}; r.actions = (r.actions || []).concat([btn]); return r; }; };
    sec('stock', { label: 'Площадки, склады и перемещения между складами', module: 'sites' });
    sec('settings', { label: 'Площадки и склады', module: 'sites' });
  } catch (e) {}
})();

/* ---------------- справочники ---------------- */
function _v97S_(x) { return String(x === undefined || x === null ? '' : x).replace(/\s+/g, ' ').trim(); }
function _v97R3_(x) { return Math.round((Number(x) || 0) * 1000) / 1000; }
function _v97Sites_() {
  var R = _v92Rows_(MC_V97_SITE_).map(function (r) { return { id: String(r.SiteID), name: String(r['Название'] || r.SiteID), address: String(r['Адрес'] || ''), active: String(r['Статус'] || 'ACTIVE') === 'ACTIVE', _row: r._row }; });
  if (!R.some(function (x) { return x.id === 'SITE-MAIN'; })) R.unshift({ id: 'SITE-MAIN', name: 'Основная площадка', address: '', active: true, virtual: true });
  return R;
}
function _v97Whs_() {
  var R = _v92Rows_(MC_V97_WH_).map(function (r) { return { id: String(r.WarehouseID), site: String(r.SiteID), name: String(r['Название'] || r.WarehouseID), active: String(r['Статус'] || 'ACTIVE') === 'ACTIVE', _row: r._row }; });
  if (!R.some(function (x) { return x.id === 'WH-MAIN'; })) R.unshift({ id: 'WH-MAIN', site: 'SITE-MAIN', name: 'Основной склад', active: true, virtual: true });
  return R;
}
function _v97LocWh_() { var m = {}; _v92Rows_(MC_V97_LOC_).forEach(function (r) { m[String(r.LocationID)] = String(r.WarehouseID); }); return m; }
/** Склад строки «Склад_Партии»: по месту хранения (столбец 15); в пути — TRANSIT. */
function _v97WhOfRow_(r, L) { if (String(r[10]) === 'transit') return 'TRANSIT'; var loc = String(r[14] || ''); return (L || _v97LocWh_())[loc] || 'WH-MAIN'; }
function _v97SiteOfWh_(id, W) { var w = (W || _v97Whs_()).filter(function (x) { return x.id === id; })[0]; return w ? w.site : ''; }
/** Списание продажи: строки партий, которые не на складах площадки (если площадок больше одной). */
function _v97SkipRows_(v, site) {
  site = site || _V97_SITE_; if (!site) return null;
  var W = _v97Whs_(), sites = {}; W.forEach(function (w) { sites[w.site] = 1; });
  if (Object.keys(sites).length <= 1 && sites[site]) return null;
  var mine = {}; W.forEach(function (w) { if (w.site === site) mine[w.id] = 1; });
  var L = _v97LocWh_(), skip = {};
  for (var i = 1; i < v.length; i++) if (v[i][0] && !mine[_v97WhOfRow_(v[i], L)]) skip[i] = true;
  return skip;
}
function _v97Materialize_(who) {
  var now = new Date();
  if (!_v92Rows_(MC_V97_SITE_).some(function (r) { return String(r.SiteID) === 'SITE-MAIN'; })) _v93Write_(MC_V97_SITE_, MC_V97_SITE_HEAD_, { SiteID: 'SITE-MAIN', 'Название': 'Основная площадка', 'Статус': 'ACTIVE', 'Создал': who + ' (по умолчанию)', 'Создано': now });
  if (!_v92Rows_(MC_V97_WH_).some(function (r) { return String(r.WarehouseID) === 'WH-MAIN'; })) _v93Write_(MC_V97_WH_, MC_V97_WH_HEAD_, { WarehouseID: 'WH-MAIN', SiteID: 'SITE-MAIN', 'Название': 'Основной склад', 'Статус': 'ACTIVE', 'Создал': who + ' (по умолчанию)', 'Создано': now });
}
function _v97Id_(p) { return p + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase(); }
function _v97Fail_(op, c, m) { _endOp_(op, 'FAILED'); return _fail_(c, m, op.id); }
/** Партии склада с остатком. */
function _v97Stock_(whId) {
  var v = _stockBatchesSheet_().getDataRange().getValues(), L = _v97LocWh_(), out = [], today = _v71Day_(new Date());
  for (var i = 1; i < v.length; i++) {
    var r = v[i]; if (!r[0] || !((parseFloat(r[9]) || 0) > 0.0005)) continue;
    var wh = _v97WhOfRow_(r, L); if (whId && wh !== whId) continue;
    var exp = r[5] ? _v71Day_(r[5]) : '';
    out.push({ batchId: String(r[0]), product: String(r[1]), unit: String(r[2] || ''), remain: _v97R3_(r[9]), expiry: exp, expired: !!(exp && exp < today), status: String(r[10] || 'active'), location: String(r[14] || ''), locationName: _mcBlLocName_(r[14]), wh: wh });
  }
  return out;
}

/* ---------------- данные экрана ---------------- */
function v97Data(token) {
  var s; try { s = _requireAuth_(token, 'stock|stock_view|org_edit|banquets|journals|finance_view'); } catch (e) { return _failFrom_(e); }
  try {
    var S = _v97Sites_(), W = _v97Whs_(), L = _v97LocWh_(), all = _v97Stock_(''), locs = _mcBlLocations_();
    var whs = W.map(function (w) {
      var st = all.filter(function (b) { return b.wh === w.id; });
      return { id: w.id, site: w.site, siteName: (S.filter(function (x) { return x.id === w.site; })[0] || {}).name || w.site, name: w.name, active: w.active, virtual: !!w.virtual,
        batches: st.length, products: Object.keys(st.reduce(function (m, b) { m[b.product] = 1; return m; }, {})).length,
        locations: locs.filter(function (l) { return (L[l.id] || 'WH-MAIN') === w.id; }).map(function (l) { return { id: l.id, name: l.name, type: l.type, active: l.active }; }),
        stock: st.filter(function (b) { return b.status === 'active'; }).slice(0, 400) };
    });
    var tr = _v92Rows_(MC_V97_TR_).map(function (r) { return _v97TrView_(r, W); }).reverse().slice(0, 60);
    var transit = all.filter(function (b) { return b.wh === 'TRANSIT'; });
    return _ok_({ sites: S.map(function (x) { return { id: x.id, name: x.name, address: x.address, active: x.active, virtual: !!x.virtual }; }), warehouses: whs, transfers: tr, transit: transit.length,
      channels: [['HALL', 'зал'], ['DELIVERY', 'доставка']], can: { org: !s.dev && _mcRbHasExact_(s, 'org_edit'), stock: !s.dev && _mcRbHasExact_(s, 'stock') } });
  } catch (e) { return _failFrom_(e); }
}
function _v97TrView_(r, W) {
  var nm = function (id) { var w = (W || _v97Whs_()).filter(function (x) { return x.id === id; })[0]; return w ? w.name : id; }, L = [], D = [];
  try { L = JSON.parse(String(r['Позиции (JSON)'] || '[]')); } catch (e) {} try { D = JSON.parse(String(r['Расхождения (JSON)'] || '[]')); } catch (e) {}
  var f = function (x) { return x instanceof Date ? Utilities.formatDate(x, _mcTz_(), 'dd.MM.yyyy HH:mm') : String(x || ''); };
  return { id: String(r.TransferID), from: String(r['Со склада']), fromName: nm(String(r['Со склада'])), to: String(r['На склад']), toName: nm(String(r['На склад'])), status: String(r['Статус']),
    statusRu: MC_V97_TR_RU_[r['Статус']] || r['Статус'], lines: L.map(function (l) { l.left = _v97R3_(l.qty - (l.received || 0) - (l.lost || 0)); return l; }), gaps: D,
    sentBy: String(r['Отправил'] || ''), sentAt: f(r['Отправлено']), recBy: String(r['Принял'] || ''), recAt: f(r['Принято']), comment: String(r['Комментарий'] || ''), closeReason: String(r['Причина закрытия'] || '') };
}

/* ---------------- площадки и склады ---------------- */
/** {id?, name, address?, status? ('ACTIVE'|'INACTIVE'), confirm}. */
function v97SaveSite(json, token) {
  var op = null; try { op = _beginOp_(token, 'org_edit', 'V97_SITE_SAVE', 'Площадки', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {}, name = _v97S_(d.name), st = String(d.status || 'ACTIVE');
    if (op.session.dev) return _v97Fail_(op, 'FORBIDDEN', 'Технический доступ площадки не меняет');
    if (d.confirm !== true) return _v97Fail_(op, 'VALIDATION', 'Подтвердите галочкой');
    if (name.length < 2) return _v97Fail_(op, 'VALIDATION', 'Укажите название площадки');
    if (['ACTIVE', 'INACTIVE'].indexOf(st) < 0) return _v97Fail_(op, 'VALIDATION', 'Статус: действует или закрыта');
    return _withLock_(function () {
      var who = _author_(op).фио; _v97Materialize_(who);
      var S = _v97Sites_(), cur = d.id ? S.filter(function (x) { return x.id === String(d.id); })[0] : null;
      if (d.id && !cur) return _v97Fail_(op, 'NOT_FOUND', 'Площадка не найдена');
      if (S.some(function (x) { return x.name.toLowerCase() === name.toLowerCase() && (!cur || x.id !== cur.id); })) return _v97Fail_(op, 'DUPLICATE', 'Площадка «' + name + '» уже есть');
      if (st === 'INACTIVE' && cur) {
        if (_v97Whs_().some(function (w) { return w.site === cur.id && w.active; })) return _v97Fail_(op, 'VALIDATION', 'У площадки есть действующие склады — сначала закройте их');
        if (S.filter(function (x) { return x.active && x.id !== cur.id; }).length === 0) return _v97Fail_(op, 'VALIDATION', 'Это единственная действующая площадка');
      }
      var id = cur ? cur.id : _v97Id_('SITE'), row = cur ? _v92Rows_(MC_V97_SITE_).filter(function (r) { return String(r.SiteID) === id; })[0] : { SiteID: id, 'Создал': who, 'Создано': new Date() };
      row['Название'] = name; row['Адрес'] = _v97S_(d.address).slice(0, 300); row['Статус'] = st; row['Изменено'] = new Date();
      _v93Write_(MC_V97_SITE_, MC_V97_SITE_HEAD_, row);
      _audit_(op, 'V97_SITE_SAVE', MC_V97_SITE_, id, cur ? { название: cur.name, активна: cur.active } : null, { название: name, адрес: row['Адрес'], статус: st });
      _endOp_(op); return _ok_({ id: id, name: name, status: st }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** {id?, siteId, name, status?, confirm}. */
function v97SaveWarehouse(json, token) {
  var op = null; try { op = _beginOp_(token, 'org_edit', 'V97_WH_SAVE', 'Склады', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {}, name = _v97S_(d.name), st = String(d.status || 'ACTIVE');
    if (op.session.dev) return _v97Fail_(op, 'FORBIDDEN', 'Технический доступ склады не меняет');
    if (d.confirm !== true) return _v97Fail_(op, 'VALIDATION', 'Подтвердите галочкой');
    if (name.length < 2) return _v97Fail_(op, 'VALIDATION', 'Укажите название склада');
    return _withLock_(function () {
      var who = _author_(op).фио; _v97Materialize_(who);
      var W = _v97Whs_(), cur = d.id ? W.filter(function (x) { return x.id === String(d.id); })[0] : null, site = _v97Sites_().filter(function (x) { return x.id === String(d.siteId || (cur && cur.site) || ''); })[0];
      if (d.id && !cur) return _v97Fail_(op, 'NOT_FOUND', 'Склад не найден');
      if (!site || !site.active) return _v97Fail_(op, 'VALIDATION', 'Выберите действующую площадку');
      if (W.some(function (x) { return x.site === site.id && x.name.toLowerCase() === name.toLowerCase() && (!cur || x.id !== cur.id); })) return _v97Fail_(op, 'DUPLICATE', 'Склад «' + name + '» на этой площадке уже есть');
      if (cur && (st === 'INACTIVE' || site.id !== cur.site)) {
        var left = _v97Stock_(cur.id).length, tr = _v92Rows_(MC_V97_TR_).some(function (r) { return /SENT|PARTIAL/.test(String(r['Статус'])) && (String(r['На склад']) === cur.id || String(r['Со склада']) === cur.id); });
        if (left) return _v97Fail_(op, 'VALIDATION', 'На складе ' + left + ' партий с остатком — сначала переместите или спишите');
        if (tr) return _v97Fail_(op, 'VALIDATION', 'Есть незавершённые перемещения этого склада');
      }
      var id = cur ? cur.id : _v97Id_('WH'), row = cur ? _v92Rows_(MC_V97_WH_).filter(function (r) { return String(r.WarehouseID) === id; })[0] : { WarehouseID: id, 'Создал': who, 'Создано': new Date() };
      row.SiteID = site.id; row['Название'] = name; row['Статус'] = st; row['Изменено'] = new Date();
      _v93Write_(MC_V97_WH_, MC_V97_WH_HEAD_, row);
      _audit_(op, 'V97_WH_SAVE', MC_V97_WH_, id, cur ? { название: cur.name, площадка: cur.site } : null, { название: name, площадка: site.id, статус: st });
      _endOp_(op); return _ok_({ id: id, name: name, site: site.id, status: st }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Место хранения → склад: {locationId, warehouseId, confirm}. Место с партиями не переносится (это было бы перемещение без документа). */
function v97AssignLocation(json, token) {
  var op = null; try { op = _beginOp_(token, 'org_edit|stock', 'V97_LOC_ASSIGN', 'Склады', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {};
    if (op.session.dev) return _v97Fail_(op, 'FORBIDDEN', 'Технический доступ склады не меняет');
    if (d.confirm !== true) return _v97Fail_(op, 'VALIDATION', 'Подтвердите галочкой');
    return _withLock_(function () {
      var loc = _mcBlLoc_(d.locationId), W = _v97Whs_(), wh = W.filter(function (x) { return x.id === String(d.warehouseId || ''); })[0], L = _v97LocWh_();
      if (!loc) return _v97Fail_(op, 'NOT_FOUND', 'Место хранения не найдено');
      if (!wh || !wh.active) return _v97Fail_(op, 'VALIDATION', 'Выберите действующий склад');
      var cur = L[loc.id] || 'WH-MAIN'; if (cur === wh.id) return _v97Fail_(op, 'VALIDATION', '«' + loc.name + '» уже на складе «' + wh.name + '»');
      var n = _v97Stock_('').filter(function (b) { return b.location === loc.id && b.status !== 'transit'; }).length;
      if (n) return _v97Fail_(op, 'VALIDATION', 'В «' + loc.name + '» лежит ' + n + ' партий — переносите товар перемещением между складами, а не сменой склада у места');
      var who = _author_(op).фио; _v97Materialize_(who);
      var r = _v92Rows_(MC_V97_LOC_).filter(function (x) { return String(x.LocationID) === loc.id; })[0] || { LocationID: loc.id };
      r.WarehouseID = wh.id; r['Назначил'] = who; r['Назначено'] = new Date();
      _v93Write_(MC_V97_LOC_, MC_V97_LOC_HEAD_, r);
      _audit_(op, 'V97_LOC_ASSIGN', MC_V97_LOC_, loc.id, { склад: cur }, { склад: wh.id });
      _endOp_(op); return _ok_({ locationId: loc.id, warehouseId: wh.id }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- перемещение между складами ---------------- */
function _v97Tr_(id) { return _v92Rows_(MC_V97_TR_).filter(function (r) { return String(r.TransferID) === String(id || ''); })[0] || null; }
/** Отправить: {from, to, lines: [{batchId, qty}], comment?, confirm}. Количество — в единице партии. */
function v97TransferSend(json, token) {
  var op = null; try { op = _beginOp_(token, 'stock', 'V97_TRANSFER_SEND', 'Склад', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {}, lines = d.lines || [];
    if (op.session.dev) return _v97Fail_(op, 'FORBIDDEN', 'Технический доступ склад не двигает');
    if (d.confirm !== true) return _v97Fail_(op, 'VALIDATION', 'Подтвердите отправку галочкой');
    if (!lines.length) return _v97Fail_(op, 'VALIDATION', 'Добавьте партии для перемещения');
    return _withLock_(function () {
      var W = _v97Whs_(), from = W.filter(function (x) { return x.id === String(d.from || ''); })[0], to = W.filter(function (x) { return x.id === String(d.to || ''); })[0];
      if (!from || !to || !from.active || !to.active) return _v97Fail_(op, 'VALIDATION', 'Выберите действующие склады отправителя и получателя');
      if (from.id === to.id) return _v97Fail_(op, 'VALIDATION', 'Склад отправителя и получателя совпадают');
      var L = _v97LocWh_(), res = _v71Reserved_(), seen = {}, plan = [];
      for (var k = 0; k < lines.length; k++) {   // сначала проверка всех строк — затем движение
        var ln = lines[k], id = String(ln.batchId || ''), b = _bcFind_(id), q = _v97R3_(String(ln.qty).replace(',', '.'));
        if (!b) return _v97Fail_(op, 'NOT_FOUND', 'Партия ' + id + ' не найдена');
        if (seen[id]) return _v97Fail_(op, 'VALIDATION', 'Партия ' + id + ' указана дважды'); seen[id] = 1;
        var st = _mcBlState_(b, _mcBlPass_(id), _mcBlEvents_(id));
        if (String(b.v[10]) !== 'active' || !st.usable) return _v97Fail_(op, 'BATCH_STATE', 'Партия ' + id + ' (' + b.v[1] + '): ' + st.statusRu + ' — перемещать можно только допущенную партию');
        if (_v97WhOfRow_(b.v, L) !== from.id) return _v97Fail_(op, 'VALIDATION', 'Партия ' + id + ' не на складе «' + from.name + '»');
        var rem = Number(b.v[9]) || 0;
        if (!(q > 0) || q > rem + 0.0005) return _v97Fail_(op, 'VALIDATION', 'Партия ' + id + ': количество больше нуля и не больше остатка ' + _v97R3_(rem) + ' ' + b.v[2]);
        if ((res[id] || 0) > rem - q + 0.0005) return _v97Fail_(op, 'VALIDATION', 'Партия ' + id + ' в резерве банкета (' + res[id] + ' ' + b.v[2] + ') — снимите резерв или переместите меньше');
        plan.push({ b: b, q: q, rem: rem });
      }
      var tid = 'TR-' + Utilities.formatDate(new Date(), _mcTz_(), 'yyyyMMdd') + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase(), who = _author_(op).фио, out = [];
      plan.forEach(function (p) {
        var target = p.q < p.rem - 0.0005 ? _mcBlSplitCore_(op, p.b, p.q, 'перемещение ' + tid + ' на склад «' + to.name + '»') : p.b, loc = String(target.v[14] || '');
        _bcSetStatus_(target, 'transit');
        _mcBlEvent_(op, target.v[0], 'MOVE', { qty: p.q, unit: target.v[2], from: loc, to: 'в пути → ' + to.name, reason: 'перемещение ' + tid + ' со склада «' + from.name + '» на «' + to.name + '»', doc: tid,
          before: { location: loc, status: 'active' }, after: { status: 'transit' } });
        try { _mcCreateTraceLink_('BATCH', String(target.v[0]), 'MOVE', 'WAREHOUSE', to.id, { actor: who, source: tid, weight: p.q, unit: target.v[2] }); } catch (e) {}
        out.push({ batchId: String(target.v[0]), parent: target === p.b ? '' : String(p.b.v[0]), product: String(target.v[1]), qty: p.q, unit: String(target.v[2]), fromLocation: loc, received: 0, lost: 0, got: [] });
      });
      _v93Write_(MC_V97_TR_, MC_V97_TR_HEAD_, { TransferID: tid, 'Создано': new Date(), 'Со склада': from.id, 'На склад': to.id, 'Статус': 'SENT', 'Позиции (JSON)': JSON.stringify(out), 'Отправил': who, 'Отправлено': new Date(),
        'Комментарий': _v97S_(d.comment).slice(0, 300), OperationID: op.id });
      _audit_(op, 'V97_TRANSFER_SEND', MC_V97_TR_, tid, null, { со_склада: from.name, на_склад: to.name, позиции: out.map(function (l) { return l.product + ' ' + l.qty + ' ' + l.unit + ' (' + l.batchId + ')'; }) });
      _endOp_(op);
      return _ok_({ id: tid, from: from.name, to: to.name, lines: out }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Принять: {id, lines: [{batchId, qty, locationId}], confirm}. Принять можно частично; остаток остаётся «в пути». */
function v97TransferReceive(json, token) {
  var op = null; try { op = _beginOp_(token, 'stock', 'V97_TRANSFER_RECEIVE', 'Склад', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {}, lines = d.lines || [];
    if (op.session.dev) return _v97Fail_(op, 'FORBIDDEN', 'Технический доступ склад не двигает');
    if (d.confirm !== true) return _v97Fail_(op, 'VALIDATION', 'Подтвердите приёмку галочкой');
    return _withLock_(function () {
      var T = _v97Tr_(d.id); if (!T) return _v97Fail_(op, 'NOT_FOUND', 'Перемещение не найдено');
      if (!/^(SENT|PARTIAL)$/.test(String(T['Статус']))) return _v97Fail_(op, 'VALIDATION', 'Перемещение ' + T.TransferID + ': ' + (MC_V97_TR_RU_[T['Статус']] || T['Статус']) + ' — принимать нечего');
      var W = _v97Whs_(), to = W.filter(function (x) { return x.id === String(T['На склад']); })[0] || { id: String(T['На склад']), name: String(T['На склад']) }, L = _v97LocWh_(), TL = JSON.parse(String(T['Позиции (JSON)'] || '[]')), plan = [];
      if (!lines.length) return _v97Fail_(op, 'VALIDATION', 'Укажите, что принято');
      for (var k = 0; k < lines.length; k++) {
        var ln = lines[k], tl = TL.filter(function (x) { return x.batchId === String(ln.batchId || ''); })[0], q = _v97R3_(String(ln.qty).replace(',', '.'));
        if (!tl) return _v97Fail_(op, 'VALIDATION', 'Партии ' + ln.batchId + ' нет в перемещении');
        var left = _v97R3_(tl.qty - (tl.received || 0) - (tl.lost || 0));
        if (!(q > 0) || q > left + 0.0005) return _v97Fail_(op, 'VALIDATION', tl.product + ': принять больше нуля и не больше ' + left + ' ' + tl.unit);
        var loc = _mcBlLoc_(ln.locationId);
        if (!loc || !loc.active || (L[loc.id] || 'WH-MAIN') !== to.id) return _v97Fail_(op, 'VALIDATION', tl.product + ': выберите место хранения склада «' + to.name + '»');
        var b = _bcFind_(tl.batchId); if (!b || String(b.v[10]) !== 'transit') return _v97Fail_(op, 'BATCH_STATE', 'Партия ' + tl.batchId + ' не в пути');
        var pass = _mcBlPass_(tl.batchId), st2 = pass ? String(pass.v[MC_RCV_C_['Тип хранения']] || '') : '';
        if (st2 && !_mcBlTypeFits_(st2, loc.type)) return _v97Fail_(op, 'STORAGE_CONFLICT', tl.product + ' хранится: ' + (MC_BL_TYPE_RU_[st2] || st2) + ', а «' + loc.name + '» — ' + (MC_BL_TYPE_RU_[loc.type] || loc.type));
        plan.push({ tl: tl, q: q, loc: loc, b: b });
      }
      var who = _author_(op).фио;
      plan.forEach(function (p) {
        var rem = Number(p.b.v[9]) || 0, target = p.q < rem - 0.0005 ? _mcBlSplitCore_(op, p.b, p.q, 'принято по перемещению ' + T.TransferID) : p.b;
        _mcBlSetLocation_(target, p.loc.id); _bcSetStatus_(target, 'active');
        _mcBlEvent_(op, target.v[0], 'MOVE', { qty: p.q, unit: target.v[2], from: 'в пути', to: p.loc.id, reason: 'принято по перемещению ' + T.TransferID + ' на склад «' + to.name + '»', doc: T.TransferID, before: { status: 'transit' }, after: { location: p.loc.id, status: 'active' } });
        try { _mcCreateTraceLink_('BATCH', String(target.v[0]), 'MOVE', 'LOCATION', p.loc.id, { actor: who, source: T.TransferID, weight: p.q, unit: target.v[2] }); } catch (e) {}
        p.tl.received = _v97R3_((p.tl.received || 0) + p.q); (p.tl.got = p.tl.got || []).push({ batchId: String(target.v[0]), qty: p.q, location: p.loc.id });
      });
      var open = TL.filter(function (x) { return _v97R3_(x.qty - (x.received || 0) - (x.lost || 0)) > 0.0005; });
      T['Позиции (JSON)'] = JSON.stringify(TL); T['Статус'] = open.length ? 'PARTIAL' : 'RECEIVED'; T['Принял'] = who; T['Принято'] = new Date();
      T['Расхождения (JSON)'] = JSON.stringify(open.map(function (x) { return { batchId: x.batchId, product: x.product, left: _v97R3_(x.qty - (x.received || 0) - (x.lost || 0)), unit: x.unit }; }));
      _v93Write_(MC_V97_TR_, MC_V97_TR_HEAD_, T);
      _audit_(op, 'V97_TRANSFER_RECEIVE', MC_V97_TR_, T.TransferID, null, { принято: plan.map(function (p) { return p.tl.product + ' ' + p.q + ' ' + p.tl.unit + ' → ' + p.loc.name; }), статус: T['Статус'] });
      _endOp_(op);
      return _ok_({ id: T.TransferID, status: T['Статус'], statusRu: MC_V97_TR_RU_[T['Статус']], left: JSON.parse(T['Расхождения (JSON)']) }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Отменить, пока ничего не принято: партии снова «active» на месте отправителя. {id, reason, confirm}. */
function v97TransferCancel(json, token) {
  var op = null; try { op = _beginOp_(token, 'stock', 'V97_TRANSFER_CANCEL', 'Склад', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {}, why = _v97S_(d.reason);
    if (op.session.dev) return _v97Fail_(op, 'FORBIDDEN', 'Технический доступ склад не двигает');
    if (d.confirm !== true) return _v97Fail_(op, 'VALIDATION', 'Подтвердите галочкой');
    if (why.length < 5) return _v97Fail_(op, 'VALIDATION', 'Укажите причину отмены (не короче 5 символов)');
    return _withLock_(function () {
      var T = _v97Tr_(d.id); if (!T) return _v97Fail_(op, 'NOT_FOUND', 'Перемещение не найдено');
      if (String(T['Статус']) !== 'SENT') return _v97Fail_(op, 'VALIDATION', 'Отменить можно, пока ничего не принято (сейчас: ' + (MC_V97_TR_RU_[T['Статус']] || T['Статус']) + ')');
      var TL = JSON.parse(String(T['Позиции (JSON)'] || '[]'));
      TL.forEach(function (l) { var b = _bcFind_(l.batchId); if (!b || String(b.v[10]) !== 'transit') return; _bcSetStatus_(b, 'active');
        _mcBlEvent_(op, l.batchId, 'MOVE', { qty: l.qty, unit: l.unit, from: 'в пути', to: l.fromLocation, reason: 'перемещение ' + T.TransferID + ' отменено: ' + why, doc: T.TransferID, before: { status: 'transit' }, after: { status: 'active', location: l.fromLocation } }); });
      T['Статус'] = 'CANCELLED'; T['Закрыл'] = _author_(op).фио; T['Закрыто'] = new Date(); T['Причина закрытия'] = why;
      _v93Write_(MC_V97_TR_, MC_V97_TR_HEAD_, T);
      _audit_(op, 'V97_TRANSFER_CANCEL', MC_V97_TR_, T.TransferID, null, { причина: why });
      _endOp_(op); return _ok_({ id: T.TransferID, status: 'CANCELLED' }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Закрыть с недостачей: то, что не дошло, списывается (BATCH_WASTE). {id, reason, confirm}. */
function v97TransferClose(json, token) {
  var op = null; try { op = _beginOp_(token, 'stock', 'V97_TRANSFER_CLOSE', 'Склад', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {}, why = _v97S_(d.reason);
    if (op.session.dev) return _v97Fail_(op, 'FORBIDDEN', 'Технический доступ склад не двигает');
    if (d.confirm !== true) return _v97Fail_(op, 'VALIDATION', 'Подтвердите списание недостачи галочкой');
    if (why.length < 5) return _v97Fail_(op, 'VALIDATION', 'Укажите причину недостачи (не короче 5 символов)');
    return _withLock_(function () {
      var T = _v97Tr_(d.id); if (!T) return _v97Fail_(op, 'NOT_FOUND', 'Перемещение не найдено');
      if (!/^(SENT|PARTIAL)$/.test(String(T['Статус']))) return _v97Fail_(op, 'VALIDATION', 'Закрывать нечего (сейчас: ' + (MC_V97_TR_RU_[T['Статус']] || T['Статус']) + ')');
      var TL = JSON.parse(String(T['Позиции (JSON)'] || '[]')), lost = [];
      TL.forEach(function (l) {
        var left = _v97R3_(l.qty - (l.received || 0) - (l.lost || 0)); if (!(left > 0.0005)) return;
        var b = _bcFind_(l.batchId); if (!b || String(b.v[10]) !== 'transit') return;
        var rem = Number(b.v[9]) || 0, q = Math.min(left, rem), price = Number(b.v[6]) || 0;
        b.sh.getRange(b.row, 9).setValue(_v97R3_((Number(b.v[8]) || 0) + q)); b.sh.getRange(b.row, 10).setValue(_v97R3_(rem - q)); b.v[9] = _v97R3_(rem - q);
        _bcSetStatus_(b, b.v[9] > 0.001 ? 'active' : 'consumed');
        _logStockOp_('Списание', b.v[1], q, b.v[2], price, 'Перемещение ' + T.TransferID, 'недостача при перемещении: ' + why);
        _mcBlEvent_(op, l.batchId, 'BATCH_WASTE', { qty: q, unit: b.v[2], reason: 'недостача при перемещении ' + T.TransferID + ': ' + why, doc: T.TransferID, before: { remain: rem }, after: { remain: b.v[9] } });
        l.lost = _v97R3_((l.lost || 0) + q); lost.push({ batchId: l.batchId, product: l.product, qty: q, unit: l.unit, sum: Math.round(price * q * 100) / 100 });
      });
      T['Позиции (JSON)'] = JSON.stringify(TL); T['Статус'] = 'CLOSED'; T['Закрыл'] = _author_(op).фио; T['Закрыто'] = new Date(); T['Причина закрытия'] = why; T['Расхождения (JSON)'] = JSON.stringify(lost);
      _v93Write_(MC_V97_TR_, MC_V97_TR_HEAD_, T);
      _audit_(op, 'V97_TRANSFER_CLOSE', MC_V97_TR_, T.TransferID, null, { причина: why, списано: lost.map(function (x) { return x.product + ' ' + x.qty + ' ' + x.unit; }) });
      _endOp_(op); return _ok_({ id: T.TransferID, status: 'CLOSED', lost: lost }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- партия «в пути» — не допущена к использованию ---------------- */
(function () {
  if (typeof _mcBlState_ !== 'function') return;
  var o = _mcBlState_;
  _mcBlState_ = function (b) {
    var x = o.apply(this, arguments);
    try { if (b && b.v && String(b.v[10]) === 'transit') { x.status = 'TRANSIT'; x.statusRu = 'в пути (перемещение между складами)'; x.usable = false; x.level = 'amber'; } } catch (e) {}
    return x;
  };
})();

/* ---------------- журнал продаж: площадка и канал ---------------- */
/** Номера столбцов (с 1) «Площадка» и «Канал продаж» — после служебных столбцов журнала; заголовки ставятся при первой записи. */
function _v97J36Cols_(sh, n, write) {
  var A = typeof JOURNAL_AUTHOR_COLS !== 'undefined' ? JOURNAL_AUTHOR_COLS.length : 5, c = n + A + 1;
  if (write) { var h = sh.getRange(1, c, 1, 2).getValues()[0]; if (String(h[0]) !== MC_V97_J36_EXTRA_[0] || String(h[1]) !== MC_V97_J36_EXTRA_[1]) sh.getRange(1, c, 1, 2).setValues([MC_V97_J36_EXTRA_]); }
  return { site: c, channel: c + 1 };
}
function _v97SiteCell_(site) { return site ? site.name + ' · ' + site.id : ''; }
function _v97SiteOfCell_(x) { var m = /\b(SITE-[A-Z0-9]+)\b/.exec(String(x || '')); return m ? m[1] : 'SITE-MAIN'; }
function _v97ChOfCell_(x, seller, src) { if (/Выдача банкета/i.test(String(seller || '')) || /банкет/i.test(String(src || ''))) return 'BANQUET'; return /достав/i.test(String(x || '')) ? 'DELIVERY' : 'HALL'; }
/** Строка продажи по номеру SL-… → площадка и канал. */
function _v97SaleTag_(saleId, site, ch) {
  var j = _mcJById_('J36'), sh = _book_().getSheetByName(j.sheetName), n = j.columns.length; if (!sh) return;
  var C = _v97J36Cols_(sh, n, true), v = sh.getRange(1, n + 4, sh.getLastRow(), 1).getValues();
  for (var i = v.length - 1; i >= 1; i--) if (String(v[i][0]).indexOf(saleId) >= 0 && !/сторно\s+CN-/i.test(String(v[i][0]))) { sh.getRange(i + 1, C.site, 1, 2).setValues([[_v97SiteCell_(site), MC_V97_CH_RU_[ch]]]); return i + 1; }
}
/** Сторно (V95) — площадка и канал исходной строки. */
function _v97CopyTags_(sh, n, fromRow, toRow) { var C = _v97J36Cols_(sh, n, true); sh.getRange(toRow, C.site, 1, 2).setValues(sh.getRange(fromRow, C.site, 1, 2).getValues()); }
(function () {
  if (typeof mcSaleAdd !== 'function') return;
  var orig = mcSaleAdd;
  mcSaleAdd = function (json, token) {
    var d = {}; try { d = _mcBlJson_(json) || {}; } catch (e) {}
    var S = _v97Sites_().filter(function (x) { return x.active; }), site = d.site ? S.filter(function (x) { return x.id === String(d.site); })[0] : null, ch = String(d.channel || 'HALL').toUpperCase();
    if (d.site && !site) return _fail_('VALIDATION', 'Площадка не найдена или закрыта');
    if (['HALL', 'DELIVERY'].indexOf(ch) < 0) return _fail_('VALIDATION', 'Канал продажи: зал или доставка');
    var defaulted = !site; site = site || S.filter(function (x) { return x.id === 'SITE-MAIN'; })[0] || S[0];
    var res; _V97_SITE_ = site ? site.id : null;
    try { res = orig(json, token); } finally { _V97_SITE_ = null; }
    var o; try { o = JSON.parse(res); } catch (e) { return res; }
    if (o && (o.ok || o.success) && o.data && o.data.saleId) {
      try { _withLock_(function () { _v97SaleTag_(o.data.saleId, site, ch); }); } catch (e) {}
      o.data.site = site ? site.name : ''; o.data.siteId = site ? site.id : ''; o.data.channel = MC_V97_CH_RU_[ch]; o.data.siteDefaulted = defaulted && S.length > 1;
      return JSON.stringify(o);
    }
    return res;
  };
})();
(function () {
  if (typeof mcSaleData !== 'function') return;
  var orig = mcSaleData;
  mcSaleData = function (token) {
    var res = orig(token), o; try { o = JSON.parse(res); } catch (e) { return res; }
    if (!o || !(o.ok || o.success) || !o.data) return res;
    try {
      var j = _mcJById_('J36'), sh = _book_().getSheetByName(j.sheetName), n = j.columns.length, S = _v97Sites_(), C = sh ? _v97J36Cols_(sh, n, false) : null;
      var nm = function (id) { var x = S.filter(function (s) { return s.id === id; })[0]; return x ? x.name : id; };
      (o.data.recent || []).forEach(function (rc) {
        if (!sh || !rc.row) return; var r = sh.getRange(rc.row, 1, 1, C.channel).getValues()[0], src = String(r[n + 3] || ''), seller = String(r[j.columns.indexOf('ФИО продавца')] || '');
        var sid = _v97SiteOfCell_(r[C.site - 1]), ch = _v97ChOfCell_(r[C.channel - 1], seller, src); rc.siteId = sid; rc.site = nm(sid); rc.channel = MC_V97_CH_RU_[ch];
      });
      o.data.sites = S.filter(function (x) { return x.active; }).map(function (x) { return { id: x.id, name: x.name }; }); o.data.channels = [['HALL', 'зал'], ['DELIVERY', 'доставка']];
    } catch (e) {}
    return JSON.stringify(o);
  };
})();

/* ---------------- прогноз V93: по площадкам и каналам ---------------- */
(function () {
  if (typeof _v93Forecast_ !== 'function') return;
  var orig = _v93Forecast_;
  _v93Forecast_ = function () {
    var F = orig.apply(this, arguments);
    try {
      var S = _v97Sites_(), nm = function (id) { var x = S.filter(function (s) { return s.id === id; })[0]; return x ? x.name : id; }, combos = {};
      F._S.rows.forEach(function (r) { if (r.ch === 'hall') combos[(r.site || 'SITE-MAIN') + '|' + (r.channel || 'HALL')] = 1; });
      F.bySite = Object.keys(combos).map(function (k) {
        var site = k.split('|')[0], ch = k.split('|')[1], pick = function (r) { return (r.site || 'SITE-MAIN') === site && (r.channel || 'HALL') === ch; };
        var tot = F._obs.map(function (d) { return (F._by[d] || []).filter(pick).reduce(function (s, r) { return s + r.qty; }, 0); });
        var rev = F._obs.map(function (d) { return (F._by[d] || []).filter(pick).reduce(function (s, r) { return s + (r.sum || 0); }, 0); });
        var st = _v93Stat_(tot), sr = _v93Stat_(rev), fact = 0, factRev = 0;
        F._S.rows.forEach(function (r) { if (r.ch === 'hall' && r.day === F.day && pick(r)) { fact += r.qty; factRev += r.sum || 0; } });
        var conf = F.status === 'OK' ? _v93Conf_(st) : 'NONE';
        return { siteId: site, site: nm(site), channel: ch, channelRu: MC_V97_CH_RU_[ch], value: st ? _v93R_(st.mean) : null, low: st ? st.low : null, high: st ? st.high : null, n: F._obs.length,
          withSales: tot.filter(function (x) { return x > 0; }).length, conf: conf, confRu: MC_V93_CONF_RU_[conf], fact: _v93R_(fact), revenue: sr ? _v93R_(sr.mean) : null, factRevenue: _v93R_(factRev) };
      }).sort(function (a, b) { return a.site.localeCompare(b.site, 'ru') || a.channel.localeCompare(b.channel); });
      F.limitations = F.limitations.map(function (x) { return /площадки и каналы/.test(x) ? 'площадки и каналы — в таблице «По площадкам и каналам»; продажи до V97 считаются на основной площадке в зале; банкеты — по заказам' : x; });
    } catch (e) { F.bySite = null; }
    return F;
  };
})();

/* ---------------- «Моя смена»: принять перемещение, недостача ---------------- */
try {
  MC_V87_SOURCES_.push(function (ctx) {
    var s = ctx.s; if (!s || s.dev || !_mcRbHasExact_(s, 'stock') || !_book_().getSheetByName(MC_V97_TR_)) return [];
    var W = _v97Whs_(), out = [];
    _v92Rows_(MC_V97_TR_).forEach(function (r) {
      var st = String(r['Статус']); if (!/SENT|PARTIAL/.test(st)) return; var v = _v97TrView_(r, W), act = _v87ModOk_(s, 'sites') ? { kind: 'open', module: 'sites', label: 'Перемещения' } : null;
      if (st === 'SENT') out.push({ key: 'V97|in|' + v.id, group: 'now', source: 'Перемещения между складами', title: 'Принять перемещение ' + v.id + ' на склад «' + v.toName + '»', detail: 'Со склада «' + v.fromName + '»: ' + v.lines.map(function (l) { return l.product + ' ' + l.qty + ' ' + l.unit; }).slice(0, 4).join('; ') + '. Партии в пути не продаются и не идут в производство.', act: act });
      else out.push({ key: 'V97|gap|' + v.id, group: 'now', source: 'Перемещения между складами', title: 'Перемещение ' + v.id + ': принято частично', detail: 'Не дошло: ' + v.gaps.map(function (g) { return g.product + ' ' + g.left + ' ' + g.unit; }).join('; ') + '. Найдите и примите или закройте с недостачей (списание с причиной).', act: act });
    });
    return out;
  });
} catch (e) {}
