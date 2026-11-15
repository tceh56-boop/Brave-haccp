// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
/**
 * ЦЕХ Стандарт V77 — интеграция с R-Keeper 7, этап 4: продажи через XML-интерфейс кассового сервера.
 *
 * Подключение: на кассовом (или справочном) сервере ресторана включается XML-интерфейс R-Keeper 7 — это делает дилер
 * R-Keeper, у него же лицензия на XML-интерфейс. Адрес вида https://<адрес ресторана>:<порт>/rk7api/v0/xmlinterface.xml,
 * пользователь и пароль XML-интерфейса (Basic). Сервер должен быть доступен из интернета (проброс порта / VPN дилера).
 * Сертификат у кассового сервера обычно самоподписанный — для него есть отдельная галочка.
 * Пароль нужен R-Keeper как есть: хранится в свойствах проекта на сервере ЦЕХ, в экран и аудит не уходит.
 *
 * Продажи: GetOrderList (заказы текущего общего дня кассового сервера) → по каждому закрытому заказу GetOrder → блюда
 * (код, название, количество в тысячных, сумма в копейках) со скидками заказа, разнесёнными по блюдам пропорционально сумме.
 * Строки идут в общий вход _v77Ingest_ (сопоставление с ТТК, журнал продаж, списание склада). Ключ строки —
 * визит:заказ:строка R-Keeper, поэтому повтор ничего не задваивает, а уже загруженные заказы второй раз не запрашиваются.
 * Кассовый сервер отдаёт только текущую смену, поэтому автозагрузка (каждые 30 минут) включена по умолчанию;
 * прошлые дни загружаются отчётом R-Keeper из файла (этап 1). Один день — один источник: файл и сеть не задваивают друг друга.
 * Модификаторы без цены не проводятся (они часть блюда); платные модификаторы — отдельные строки, как в чеке.
 */
var MC_V77_RK_PROP = 'MC_V77_RK';
var MC_V77_RK_MONEY = 100;    // суммы XML-интерфейса — в копейках
var MC_V77_RK_QTY = 1000;     // количество — в тысячных

function _v77RkCfg_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(MC_V77_RK_PROP) || 'null'); } catch (e) { return null; } }
function _v77RkPut_(c) { PropertiesService.getScriptProperties().setProperty(MC_V77_RK_PROP, JSON.stringify(c)); }
function _v77RkPublic_(c) {
  c = c || {};
  return { configured: !!(c.url && c.login), url: c.url || '', login: c.login || '', auto: !!c.auto, insecure: !!c.insecure, lastSync: c.lastSync || '', lastResult: c.lastResult || null, lastError: c.lastError || '' };
}
/** Адрес XML-интерфейса: https по умолчанию; если путь не указан — стандартный /rk7api/v0/xmlinterface.xml. */
function _v77RkUrl_(u) {
  u = String(u || '').trim().replace(/\s+/g, ''); if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  var m = /^(https?:\/\/[^\/?#]+)(\/[^?#]*)?$/i.exec(u.replace(/\/+$/, '')); if (!m) return '';
  return m[1] + (m[2] && /\.xml$/i.test(m[2]) ? m[2] : '/rk7api/v0/xmlinterface.xml');
}
/* ---------------- XML: атрибуты ---------------- */
function _v77XmlAttrs_(s) {
  var o = {}, re = /([\w:.\-]+)\s*=\s*("([^"]*)"|'([^']*)')/g, m;
  while ((m = re.exec(String(s || '')))) o[m[1].toLowerCase()] = _v77XmlDec_(m[3] !== undefined ? m[3] : m[4]);
  return o;
}
/** Открывающие теги из списка имён — по порядку в документе: [{tag, a: атрибуты (ключи в нижнем регистре)}]. */
function _v77XmlOpen_(xml, tags) {
  var re = new RegExp('<(' + tags.join('|') + ')(\\s[^>]*?)?\\s*/?>', 'g'), out = [], m;
  while ((m = re.exec(String(xml || '')))) out.push({ tag: m[1], a: _v77XmlAttrs_(m[2] || '') });
  return out;
}
function _v77RkA_(a, names) { for (var i = 0; i < names.length; i++) { var v = a[names[i].toLowerCase()]; if (v !== undefined && v !== '') return v; } return ''; }

/* ---------------- запросы ---------------- */
function _v77RkCall_(cfg, cmdXml, what) {
  var body = '<?xml version="1.0" encoding="UTF-8"?><RK7Query>' + cmdXml + '</RK7Query>';
  var r = UrlFetchApp.fetch(cfg.url, { method: 'post', contentType: 'application/xml; charset=utf-8', payload: body, muteHttpExceptions: true, validateHttpsCertificates: !cfg.insecure,
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(cfg.login + ':' + (cfg.password || ''), Utilities.Charset.UTF_8) } });
  var code = r.getResponseCode(), t = r.getContentText() || '';
  if (code === 401) throw new Error('R-Keeper: неверный пользователь или пароль XML-интерфейса');
  if (code === 404) throw new Error('R-Keeper: XML-интерфейс не найден по адресу ' + cfg.url + ' — проверьте адрес и порт у дилера');
  if (code !== 200) throw new Error('R-Keeper: сервер ответил ' + code + (t ? ' — ' + t.slice(0, 200) : '') + ' (' + what + ')');
  var head = _v77XmlOpen_(t, ['RK7QueryResult', 'CommandResult']);
  if (!head.length) throw new Error('R-Keeper: ответ не похож на XML-интерфейс — проверьте адрес');
  for (var i = 0; i < head.length; i++) {
    var st = _v77RkA_(head[i].a, ['Status']);
    if (st && !/^ok$/i.test(st)) {
      var err = _v77RkA_(head[i].a, ['ErrorText', 'ErrorMessage']) || st;
      if (/licen[cs]|лиценз/i.test(err)) throw new Error('R-Keeper: нет лицензии на XML-интерфейс — обратитесь к дилеру R-Keeper (' + what + ')');
      throw new Error('R-Keeper: ' + err + ' (' + what + ')');
    }
  }
  return t;
}
/** Закрытые заказы смены: [{visit, order, guid, name, day, time, waiter}]. */
function _v77RkOrderList_(cfg) {
  var t = _v77RkCall_(cfg, '<RK7CMD CMD="GetOrderList" onlyOpened="0"/>', 'список заказов'), visit = '', out = [];
  _v77XmlOpen_(t, ['Visit', 'Order']).forEach(function (x) {
    if (x.tag === 'Visit') { visit = _v77RkA_(x.a, ['VisitID', 'visit', 'ID']); return; }
    var finished = _v77RkA_(x.a, ['Finished']), v = _v77RkA_(x.a, ['visit', 'VisitID']) || visit, o = _v77RkA_(x.a, ['OrderID', 'orderIdent', 'ID']);
    if (!v || !o || !/^(1|true)$/i.test(finished)) return;
    out.push({ visit: v, order: o, name: _v77RkA_(x.a, ['OrderName', 'orderName']), guid: _v77RkA_(x.a, ['Guid', 'guid']), open: _v77RkA_(x.a, ['CloseTime', 'OpenTime', 'openTime']) });
  });
  return out;
}
/** Блюда закрытого заказа → строки для _v77Ingest_ (скидки заказа разнесены пропорционально). */
function _v77RkOrderLines_(cfg, o, today) {
  var t = _v77RkCall_(cfg, '<RK7CMD CMD="GetOrder"><Order visit="' + o.visit + '" orderIdent="' + o.order + '"/></RK7CMD>', 'заказ ' + (o.name || o.order));
  var tags = _v77XmlOpen_(t, ['Order', 'Waiter', 'Dish', 'Modi', 'Discount']), head = tags.filter(function (x) { return x.tag === 'Order'; })[0] || { a: {} };
  var when = _v77When_(_v77RkA_(head.a, ['closeTime', 'CloseTime', 'openTime', 'OpenTime']) || o.open) || { day: today, time: '' };
  var waiter = (tags.filter(function (x) { return x.tag === 'Waiter'; })[0] || { a: {} }).a;
  var dishes = [], disc = 0;
  tags.forEach(function (x) {
    if (x.tag === 'Discount') { disc -= Math.abs(Number(_v77RkA_(x.a, ['amount', 'Amount'])) || 0) / MC_V77_RK_MONEY; return; }   // скидка уменьшает сумму, знак в разных версиях разный
    if (x.tag !== 'Dish' && x.tag !== 'Modi') return;
    var qty = (Number(_v77RkA_(x.a, ['quantity', 'Quantity'])) || 0) / MC_V77_RK_QTY, price = (Number(_v77RkA_(x.a, ['price', 'Price'])) || 0) / MC_V77_RK_MONEY;
    var amount = _v77RkA_(x.a, ['amount', 'Amount', 'sum']), sum = amount !== '' ? Number(amount) / MC_V77_RK_MONEY : qty * price;
    if (x.tag === 'Modi' && !(sum > 0)) return;   // бесплатный модификатор — часть блюда
    var name = _v77RkA_(x.a, ['name', 'Name']); if (!name || !qty) return;   // удалённое из заказа блюдо — количество 0
    dishes.push({ uni: _v77RkA_(x.a, ['uni', 'line_guid', 'guid']) || String(dishes.length + 1), code: _v77RkA_(x.a, ['code', 'Code']), name: name, qty: qty, sum: sum });
  });
  var gross = dishes.reduce(function (a, d) { return a + (d.sum > 0 ? d.sum : 0); }, 0), k = gross > 0 && disc ? Math.max(0, (gross + disc) / gross) : 1;
  return dishes.map(function (d) {
    var sum = _v77R2_(d.sum > 0 ? d.sum * k : d.sum);
    return { day: when.day, time: when.time || '', check: o.name || o.order, extId: d.code, name: d.name, qty: _v77R3_(d.qty), price: d.qty ? _v77R2_(sum / d.qty) : 0, sum: sum,
      waiter: _v77RkA_(waiter, ['name', 'Name']), extLineId: o.visit + ':' + o.order + ':' + d.uni };
  });
}
/** Загрузка смены: заказы, уже загруженные ранее (по ключу визит:заказ), повторно не запрашиваются. */
function _v77RkRun_(op, cfg) {
  var P = null, err = '', now = _mcNow_(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  try {
    var have = {}; _v77Read_('SALE').forEach(function (x) { var m = /^rkeeper:([^:]+:[^:]+):/.exec(String(x.ExtKey)); if (m) have[m[1]] = true; });
    var list = _v77RkOrderList_(cfg), todo = list.filter(function (o) { return !have[o.visit + ':' + o.order]; }), lines = [], errors = [];
    todo.forEach(function (o) { try { lines = lines.concat(_v77RkOrderLines_(cfg, o, today)); } catch (e) { if (/неверный|не найден|лиценз/.test(String(e.message))) throw e; errors.push(String(e.message || e)); } });
    P = { orders: list.length, fresh: todo.length, lines: lines, errors: errors };
  } catch (e) { err = String(e.message || e); }
  var res = err ? { error: err } : _withLock_(function () {
    var r = _v77Ingest_(op, 'rkeeper', P.lines, { source: 'API', fileName: 'R-Keeper XML · смена ' + _v77DayIso_(today), errors: P.errors });
    r.orders = P.orders; r.newOrders = P.fresh; r.parseErrors = P.errors.slice(0, 20); return r;
  });
  var c = _v77RkCfg_() || cfg;
  c.lastSync = new Date().toISOString(); c.lastError = err;
  if (!err) c.lastResult = { orders: res.orders, newOrders: res.newOrders, lines: res.lines, recorded: res.recorded, duplicates: res.duplicates, pending: res.pending, otherSource: res.otherSource || 0 };
  _v77RkPut_(c);
  return res;
}

/* ---------------- публичные функции ---------------- */
/** Настройки. json: {url, login, password? (пусто — прежний), auto (по умолчанию да), insecure}. Сохраняет и проверяет доступ. */
function v77RkSave(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'finance_edit', 'V77_RK_SAVE', 'Интеграции', 'rkeeper', null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), old = _v77RkCfg_() || {}, url = _v77RkUrl_(d.url), login = String(d.login || '').trim();
    if (!url) return _v64Fail_(op, 'VALIDATION', 'Адрес XML-интерфейса R-Keeper, например https://kafe.example.ru:4545');
    if (!login) return _v64Fail_(op, 'VALIDATION', 'Укажите пользователя XML-интерфейса R-Keeper');
    var pass = d.password ? String(d.password) : (old.url === url && old.login === login ? old.password || '' : '');
    var cfg = { url: url, login: login, password: pass, auto: !(d.auto === false || d.auto === 'false'), insecure: d.insecure === true || d.insecure === 'true',
      lastSync: old.lastSync || '', lastResult: old.lastResult || null, lastError: '', savedAt: new Date().toISOString(), savedBy: _v64Who_(op) };
    var check = { ok: true, message: 'Доступ к R-Keeper есть' };
    try { var n = _v77RkOrderList_(cfg).length; check.message += ', закрытых заказов в смене: ' + n; } catch (e) { check = { ok: false, message: String(e.message || e) }; cfg.lastError = check.message; }
    _v77RkPut_(cfg);
    _audit_(op, 'V77_RK_SAVE', 'Интеграции', 'rkeeper', null, { адрес: url, пользователь: login, автозагрузка: cfg.auto, проверка: check.message });   // пароль в аудит не пишется
    _endOp_(op);
    return _ok_({ settings: _v77RkPublic_(cfg), check: check }, op.id);
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Загрузить закрытые заказы текущей смены. */
function v77RkPull(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'finance_edit', 'V77_RK_PULL', 'Интеграции', 'rkeeper', null); } catch (e) { return _failFrom_(e); }
  try {
    var cfg = _v77RkCfg_();
    if (!cfg || !cfg.url) return _v64Fail_(op, 'VALIDATION', 'Сначала настройте подключение к R-Keeper');
    var res = _v77RkRun_(op, cfg);
    _endOp_(op, res.error ? 'FAILED' : 'COMPLETED');
    if (res.error) return _fail_('RKEEPER', res.error, op.id);
    return _ok_(res, op.id);
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Расписание (MC_SCHEDULE, каждые 30 минут): если автозагрузка включена — закрытые заказы текущей смены. */
function v77RkSyncSystem() {
  var cfg = _v77RkCfg_();
  if (!cfg || !cfg.auto || !cfg.url) return { skipped: true };
  var op = null; try { op = _createOperation_('V77_RK_SYNC', null, 'rkeeper'); } catch (e) { op = { id: '', session: null }; }
  var res = _v77RkRun_(op, cfg);
  if (res.error) try { _log_('WARN', 'R-Keeper: автозагрузка продаж не выполнена: ' + res.error, op.id); } catch (e) {}
  try { if (op.id) _endOp_(op, res.error ? 'FAILED' : 'COMPLETED'); } catch (e) {}
  return res;
}
function v77RkDisconnect(token) {
  var op = null;
  try { op = _beginOp_(token, 'finance_edit', 'V77_RK_OFF', 'Интеграции', 'rkeeper', null); } catch (e) { return _failFrom_(e); }
  try { PropertiesService.getScriptProperties().deleteProperty(MC_V77_RK_PROP); _endOp_(op); return _ok_({ settings: _v77RkPublic_(null) }, op.id); }
  catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
