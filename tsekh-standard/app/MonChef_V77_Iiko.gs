// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
/**
 * ЦЕХ Стандарт V77 — интеграция с iiko, этап 2: продажи по API сервера iiko (iikoServer / iikoOffice, REST «resto API»).
 *
 * Подключение: адрес сервера ресторана (как в iikoOffice, например https://kafe.iiko.it), логин и пароль пользователя iiko
 * с правом работы с API. Пароль не хранится: iiko принимает его SHA-1, в свойствах проекта лежит только он.
 * Каждое подключение занимает лицензию API на сервере iiko, поэтому сессия всегда закрывается (logout) в finally.
 *
 * Продажи: OLAP-отчёт SALES (POST /resto/api/v2/reports/olap) по закрытым заказам: учётный день, время закрытия, номер заказа,
 * код и название блюда, официант; количество и сумма со скидкой. Строки идут в общий вход _v77Ingest_ (MonChef_V77_Integrations.gs):
 * сопоставление с ТТК, журнал продаж, списание склада, без дублей.
 * Автозагрузка (если включена) — каждые 30 минут за сегодня и вчера (заказы, закрытые после полуночи, и поздние правки).
 * Один день — один источник: если продажи дня уже загружены файлом, API их не дублирует (и наоборот).
 * Названия полей OLAP можно поменять в настройках (fields), если на сервере клиента они отличаются.
 */
var MC_V77_IIKO_PROP = 'MC_V77_IIKO';
var MC_V77_IIKO_FIELDS = { day: 'OpenDate.Typed', time: 'CloseTime', check: 'OrderNum', id: 'DishCode', name: 'DishName', waiter: 'OrderWaiter.Name', qty: 'DishAmountInt', sum: 'DishDiscountSumInt' };
var MC_V77_IIKO_MAX_DAYS = 31;

function _v77IikoCfg_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(MC_V77_IIKO_PROP) || 'null'); } catch (e) { return null; } }
function _v77IikoPut_(c) { PropertiesService.getScriptProperties().setProperty(MC_V77_IIKO_PROP, JSON.stringify(c)); }
/** Адрес сервера: https по умолчанию, без хвоста /resto и слеша. */
function _v77IikoUrl_(u) {
  u = String(u || '').trim().replace(/\s+/g, '');
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  u = u.replace(/\/+$/, '').replace(/\/resto(\/api)?$/i, '');
  return /^https?:\/\/[^\/?#]+(:\d+)?$/i.test(u) ? u : '';
}
function _v77Sha1_(s) { return _v64Hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, String(s), Utilities.Charset.UTF_8)); }
function _v77IikoErr_(code, text, what) {
  var t = String(text || '').slice(0, 300);
  if (code === 401 || /wrong|неверн|invalid.*(login|password)/i.test(t)) return 'iiko: неверный логин или пароль (' + what + ')';
  if (/licen[cs]e|лиценз/i.test(t)) return 'iiko: на сервере нет свободной лицензии API — обратитесь к дилеру iiko (' + what + ')';
  if (code === 403) return 'iiko: у пользователя нет права работы с API (' + what + ')';
  return 'iiko: сервер ответил ' + code + (t ? ' — ' + t : '') + ' (' + what + ')';
}
/** Сессия iiko: f(call), где call(method, path, body?) → разобранный JSON или текст. Выход из сессии — всегда. */
function _v77IikoSession_(cfg, f) {
  var base = cfg.url + '/resto/api', key = null;
  var r = UrlFetchApp.fetch(base + '/auth?login=' + encodeURIComponent(cfg.login) + '&pass=' + encodeURIComponent(cfg.passHash), { method: 'get', muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error(_v77IikoErr_(r.getResponseCode(), r.getContentText(), 'вход'));
  key = String(r.getContentText() || '').trim();
  if (!key || key.length > 200 || /\s/.test(key)) throw new Error('iiko: сервер не выдал ключ сессии — проверьте адрес сервера');
  var call = function (method, path, body) {
    var o = { method: method, muteHttpExceptions: true };
    if (body !== undefined) { o.contentType = 'application/json'; o.payload = JSON.stringify(body); }
    var x = UrlFetchApp.fetch(base + path + (path.indexOf('?') >= 0 ? '&' : '?') + 'key=' + encodeURIComponent(key), o), code = x.getResponseCode(), t = x.getContentText();
    if (code !== 200) throw new Error(_v77IikoErr_(code, t, path.split('?')[0]));
    try { return JSON.parse(t); } catch (e) { return t; }
  };
  try { return f(call); }
  finally { try { UrlFetchApp.fetch(base + '/logout?key=' + encodeURIComponent(key), { method: 'get', muteHttpExceptions: true }); } catch (e) {} }
}
function _v77IikoIso_(d) { return _v77DayIso_(d) + 'T00:00:00.000'; }
/** Продажи из OLAP за дни [from, to] → строки для _v77Ingest_. */
function _v77IikoSales_(call, cfg, from, to) {
  var F = {}; Object.keys(MC_V77_IIKO_FIELDS).forEach(function (k) { F[k] = (cfg.fields && cfg.fields[k]) || MC_V77_IIKO_FIELDS[k]; });
  var next = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1);
  var filters = {}; filters[F.day] = { filterType: 'DateRange', periodType: 'CUSTOM', from: _v77IikoIso_(from), to: _v77IikoIso_(next), includeLow: true, includeHigh: false };
  filters.DeletedWithWriteoff = { filterType: 'IncludeValues', values: ['NOT_DELETED'] };
  filters.OrderDeleted = { filterType: 'IncludeValues', values: ['NOT_DELETED'] };
  var rows = [F.day, F.time, F.check, F.id, F.name, F.waiter].filter(function (x) { return x; });
  var res = call('post', '/v2/reports/olap', { reportType: 'SALES', buildSummary: 'false', groupByRowFields: rows, groupByColFields: [], aggregateFields: [F.qty, F.sum], filters: filters });
  var data = res && Array.isArray(res.data) ? res.data : Array.isArray(res) ? res : null;
  if (!data) throw new Error('iiko: неожиданный ответ OLAP-отчёта');
  var out = [], errors = [];
  data.forEach(function (x, i) {
    var w = _v77When_(x[F.day]), tw = x[F.time] ? _v77When_(x[F.time]) : null, qty = _v77Num_(x[F.qty]), sum = _v77Num_(x[F.sum]), name = String(x[F.name] || '').trim();
    if (!w || !name || isNaN(qty) || isNaN(sum)) { errors.push('строка ' + (i + 1) + ' отчёта iiko не разобрана'); return; }
    out.push({ day: w.day, time: tw && tw.time ? tw.time : _v77Time_(x[F.time]), check: String(x[F.check] === undefined || x[F.check] === null ? '' : x[F.check]), extId: String(x[F.id] || '').trim(), name: name,
      qty: qty, price: qty ? _v77R2_(sum / qty) : 0, sum: sum, waiter: String(x[F.waiter] || '').trim() });
  });
  return { lines: out, errors: errors };
}
function _v77IikoPublic_(c) {
  c = c || {};
  return { configured: !!(c.url && c.login && c.passHash), url: c.url || '', login: c.login || '', auto: !!c.auto, lastSync: c.lastSync || '', lastResult: c.lastResult || null, lastError: c.lastError || '',
    fields: c.fields || {}, defaultFields: MC_V77_IIKO_FIELDS };
}

/** Настройки подключения. json: {url, login, password? (пусто — прежний), auto, fields?}. Сохраняет и проверяет вход. */
function v77IikoSave(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'finance_edit', 'V77_IIKO_SAVE', 'Интеграции', 'iiko', null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), old = _v77IikoCfg_() || {}, url = _v77IikoUrl_(d.url), login = String(d.login || '').trim();
    if (!url) return _v64Fail_(op, 'VALIDATION', 'Адрес сервера iiko — как в iikoOffice, например https://kafe.iiko.it');
    if (!login) return _v64Fail_(op, 'VALIDATION', 'Укажите логин пользователя iiko');
    var pass = String(d.password || '');
    var hash = pass ? _v77Sha1_(pass) : (old.url === url && old.login === login ? old.passHash : '');
    if (!hash) return _v64Fail_(op, 'VALIDATION', 'Укажите пароль пользователя iiko');
    var fields = {}; if (d.fields && typeof d.fields === 'object') Object.keys(MC_V77_IIKO_FIELDS).forEach(function (k) { var v = String(d.fields[k] || '').trim(); if (v && v !== MC_V77_IIKO_FIELDS[k]) fields[k] = v; });
    var cfg = { url: url, login: login, passHash: hash, auto: d.auto === true || d.auto === 'true', fields: fields, lastSync: old.lastSync || '', lastResult: old.lastResult || null, lastError: '',
      savedAt: new Date().toISOString(), savedBy: _v64Who_(op) };
    var check = { ok: true, message: 'Вход в iiko выполнен' };
    try { _v77IikoSession_(cfg, function () { return true; }); } catch (e) { check = { ok: false, message: String(e.message || e) }; cfg.lastError = check.message; }
    _v77IikoPut_(cfg);
    _audit_(op, 'V77_IIKO_SAVE', 'Интеграции', 'iiko', null, { сервер: url, логин: login, автозагрузка: cfg.auto, проверка: check.message });   // пароль в аудит не пишется
    _endOp_(op);
    return _ok_({ settings: _v77IikoPublic_(cfg), check: check }, op.id);
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Загрузить продажи из iiko за период. json: {from, to} (по умолчанию — вчера и сегодня). */
function v77IikoPull(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'finance_edit', 'V77_IIKO_PULL', 'Интеграции', 'iiko', null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), cfg = _v77IikoCfg_();
    if (!cfg || !cfg.passHash) return _v64Fail_(op, 'VALIDATION', 'Сначала настройте подключение к iiko');
    var now = _mcNow_(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var from = d.from ? (_v77When_(d.from) || {}).day : new Date(today.getTime() - 86400000), to = d.to ? (_v77When_(d.to) || {}).day : today;
    if (!from || !to) return _v64Fail_(op, 'VALIDATION', 'Период не распознан');
    if (from > to) return _v64Fail_(op, 'VALIDATION', 'Начало периода позже конца');
    if (to > today) to = today;
    if ((to - from) / 86400000 + 1 > MC_V77_IIKO_MAX_DAYS) return _v64Fail_(op, 'VALIDATION', 'За один раз — не больше ' + MC_V77_IIKO_MAX_DAYS + ' дней');
    var res = _v77IikoRun_(op, cfg, from, to);
    _endOp_(op, res.error ? 'FAILED' : 'COMPLETED');
    if (res.error) return _fail_('IIKO', res.error, op.id);
    return _ok_(res, op.id);
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function _v77IikoRun_(op, cfg, from, to) {
  var P = null, err = '';
  try { P = _v77IikoSession_(cfg, function (call) { return _v77IikoSales_(call, cfg, from, to); }); } catch (e) { err = String(e.message || e); }
  var res = err ? { error: err } : _withLock_(function () { var r = _v77Ingest_(op, 'iiko', P.lines, { source: 'API', fileName: 'iiko API ' + _v77DayIso_(from) + ' — ' + _v77DayIso_(to), errors: P.errors }); r.parseErrors = P.errors.slice(0, 20); return r; });
  var c = _v77IikoCfg_() || cfg;
  c.lastSync = new Date().toISOString(); c.lastError = err;
  if (!err) c.lastResult = { from: _v77DayIso_(from), to: _v77DayIso_(to), lines: res.lines, recorded: res.recorded, duplicates: res.duplicates, pending: res.pending, otherSource: res.otherSource || 0 };
  _v77IikoPut_(c);
  return res;
}
/** Расписание (MC_SCHEDULE, каждые 30 минут): если автозагрузка включена — вчера и сегодня. */
function v77IikoSyncSystem() {
  var cfg = _v77IikoCfg_();
  if (!cfg || !cfg.auto || !cfg.passHash) return { skipped: true };
  var op = null; try { op = _createOperation_('V77_IIKO_SYNC', null, 'iiko'); } catch (e) { op = { id: '', session: null }; }
  var now = _mcNow_(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var res = _v77IikoRun_(op, cfg, new Date(today.getTime() - 86400000), today);
  if (res.error) try { _log_('WARN', 'iiko: автозагрузка продаж не выполнена: ' + res.error, op.id); } catch (e) {}
  try { if (op.id) _endOp_(op, res.error ? 'FAILED' : 'COMPLETED'); } catch (e) {}
  return res;
}
/** Отключить подключение (ключи удаляются). */
function v77IikoDisconnect(token) {
  var op = null;
  try { op = _beginOp_(token, 'finance_edit', 'V77_IIKO_OFF', 'Интеграции', 'iiko', null); } catch (e) { return _failFrom_(e); }
  try { PropertiesService.getScriptProperties().deleteProperty(MC_V77_IIKO_PROP); _endOp_(op); return _ok_({ settings: _v77IikoPublic_(null) }, op.id); }
  catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
