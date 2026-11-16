// ЦЕХ — MercuryCore.gs
// ФГИС «Меркурий» (ВетИС.API 2.x): получение, сверка и гашение ВСД при приёмке.
// Перенос MonChef_Mercury.gs; встроено в приёмку по накладной (Stage 111): строка черновика →
// ВСД → проводка → партия ждёт гашения → гашение → партия допускается.
//
// Порядок для ветеринарно подконтрольного товара:
//   накладная → «Получить ВСД» (входящие ВСД площадки, отбор по номеру накладной и поставщику) →
//   «Сопоставить» со строкой черновика (сверка до проводки) → проводка: партия создаётся со статусом
//   ОЖИДАЕТ_ВСД (не списывается и не идёт в производство, Warehouse берёт только «активна») →
//   «Погасить» (processIncomingConsignment) → партии ВСД переходят в «активна».
//
// Обмен асинхронный: submitApplicationRequest → applicationId → receiveApplicationResult (опрос).
// Правила (как в МонШеф):
//   • CANCELLED ставится только по ответу «Меркурия» (заявка COMPLETED или ВСД в статусе UTILIZED);
//     без настроенной интеграции гашение не выполняется и не имитируется;
//   • повторного гашения нет: SENDING/UNKNOWN (запрос ушёл, ответа нет) — только «Проверить результат»:
//     фактический статус в «Меркурии», затем, если не погашен, — повтор;
//   • перед гашением ВСД перечитывается: уже погашен в «Меркурии» — результат привязывается без запроса;
//   • расхождение по количеству, получателю, поставщику, единице, партии, сроку блокирует гашение;
//     расхождение в названии продукта/изготовителя — только с подтверждением человека и причиной;
//   • частичная приёмка и возврат через API не делаются — их оформляют в «Меркурии», затем «Проверить».
// Учётные данные — в свойствах скрипта (по организации), в браузер не отдаются.
// Удержание партий до гашения включается только при настроенной интеграции организации.

var MERCURY_HOLD_STATUS = 'ОЖИДАЕТ_ВСД';
var MERCURY_URLS = { prod: 'https://api.vetrf.ru/platform/services/2.1/ApplicationManagementService', test: 'https://api2.vetrf.ru:8002/platform/services/2.1/ApplicationManagementService' };
var MERCURY_NS = { soap: 'http://schemas.xmlsoap.org/soap/envelope/', apldef: 'http://api.vetrf.ru/schema/cdm/application/ws-definitions',
  apl: 'http://api.vetrf.ru/schema/cdm/application', merc: 'http://api.vetrf.ru/schema/cdm/mercury/g2b/applications/v2',
  vd: 'http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2', dt: 'http://api.vetrf.ru/schema/cdm/dictionary/v2', bs: 'http://api.vetrf.ru/schema/cdm/base' };
var MERCURY_UNITS = { '21ed96c9-337b-4a27-8761-c6e6ad3c9f5b': 'кг' };
var MERCURY_STATUS_RU = { FOUND: 'Новая', VALID: 'Сверена', CONFLICT: 'Расхождение', READY_TO_CANCEL: 'Ожидает гашения', SENDING: 'Гашение выполняется',
  UNKNOWN: 'Результат уточняется', CANCELLED: 'Погашена', REJECTED: 'Отклонена', ERROR: 'Ошибка' };
var MERCURY_ERR = {
  MERCURY_NOT_CONFIGURED: 'Интеграция с «Меркурием» не настроена',
  MERCURY_AUTH_ERROR: '«Меркурий» отклонил учётные данные — проверьте логин, пароль, APIKey и issuerId',
  MERCURY_TIMEOUT: '«Меркурий» не ответил вовремя — нажмите «Проверить результат» через несколько минут',
  MERCURY_UNAVAILABLE: '«Меркурий» недоступен — партия остаётся в ожидании ВСД, повторите позже',
  MERCURY_VSD_NOT_FOUND: 'ВСД не найден',
  MERCURY_VSD_ALREADY_CANCELLED: 'ВСД уже погашен',
  MERCURY_PRODUCT_MISMATCH: 'Продукт/изготовитель/партия/срок в ВСД не совпадает с приёмкой',
  MERCURY_QUANTITY_MISMATCH: 'Расхождение по количеству или единице — гашение заблокировано',
  MERCURY_SUPPLIER_MISMATCH: 'Отправитель в ВСД не совпадает с поставщиком',
  MERCURY_RECEIVER_MISMATCH: 'ВСД оформлен не на вашу площадку',
  MERCURY_INVALID_STATUS: 'Статус ВСД в «Меркурии» не позволяет гашение',
  MERCURY_API_ERROR: '«Меркурий» вернул ошибку',
  MERCURY_UNKNOWN_RESULT: 'Результат предыдущего гашения неизвестен — нажмите «Проверить результат»',
  MERCURY_LOCAL_INCOMPLETE: 'ВСД погашен в «Меркурии», но запись в ЦЕХ не завершена — нажмите «Проверить результат»'
};

function _mrErr_(code, extra) { var e = new Error((MERCURY_ERR[code] || MERCURY_ERR.MERCURY_API_ERROR) + (extra ? ': ' + extra : '')); e.code = code; return e; }

// ---------- настройки (по организации, в свойствах скрипта) ----------

function _mrCfg_(organizationId, locationId) {
  var raw = PropertiesService.getScriptProperties().getProperty('MERCURY_CFG_' + organizationId), c = {};
  try { c = raw ? JSON.parse(raw) : {}; } catch (e) { c = {}; }
  var cfg = { url: MERCURY_URLS[c.url] || c.url || '', urlKey: c.url || '', login: c.login || '', password: c.password || '', apiKey: c.apiKey || '', issuerId: c.issuerId || '',
    enterprises: c.enterprises || {}, initiator: c.initiator || '', users: c.users || {}, units: {}, serviceId: c.serviceId || 'mercury-g2b.service:2.1',
    tries: Math.max(1, Math.min(40, Number(c.pollTries) || 12)), pollDelayMs: c.pollDelayMs === undefined ? 2000 : Number(c.pollDelayMs) };
  Object.keys(MERCURY_UNITS).forEach(function (k) { cfg.units[k] = MERCURY_UNITS[k]; });
  Object.keys(c.unitMap || {}).forEach(function (k) { cfg.units[String(k).toLowerCase()] = c.unitMap[k]; });
  cfg.enterprise = locationId ? (cfg.enterprises[locationId] || cfg.enterprises['*'] || '') : (cfg.enterprises['*'] || '');
  cfg.missing = [['url', 'адрес сервиса'], ['login', 'логин API'], ['password', 'пароль API'], ['apiKey', 'APIKey'], ['issuerId', 'issuerId (GUID хозяйствующего субъекта)'],
    ['enterprise', 'GUID площадки этой точки'], ['initiator', 'логин пользователя «Меркурия»']].filter(function (x) { return !cfg[x[0]]; }).map(function (x) { return x[1]; });
  cfg.ready = !cfg.missing.length;
  cfg.configured = !!(cfg.url && cfg.login && cfg.apiKey);
  return cfg;
}

function _mrLoginFor_(cfg, session) { return String(cfg.users[session.user_id] || cfg.initiator || ''); }

/** Настройки для экрана: секреты не отдаются, только «задан/не задан». */
function getMercuryConfig_(session) {
  var cfg = _mrCfg_(session.organization_id, session.location_id);
  return { url: cfg.urlKey, login: cfg.login, password_set: !!cfg.password, apiKey_set: !!cfg.apiKey, issuerId: cfg.issuerId, enterprises: cfg.enterprises, initiator: cfg.initiator,
    users: cfg.users, ready: cfg.ready, missing: cfg.missing, location_id: session.location_id };
}

function saveMercuryConfig_(data, session) {
  var key = 'MERCURY_CFG_' + session.organization_id, p = PropertiesService.getScriptProperties(), cur = {};
  try { cur = JSON.parse(p.getProperty(key) || '{}'); } catch (e) { cur = {}; }
  ['url', 'login', 'issuerId', 'initiator'].forEach(function (k) { if (data[k] !== undefined) cur[k] = String(data[k] || '').trim(); });
  ['password', 'apiKey'].forEach(function (k) { if (data[k]) cur[k] = String(data[k]).trim(); }); // пустое — не менять
  if (data.enterprise !== undefined) { cur.enterprises = cur.enterprises || {}; cur.enterprises[data.locationId || session.location_id || '*'] = String(data.enterprise || '').trim(); }
  if (data.users && typeof data.users === 'object') cur.users = data.users;
  if (data.unitMap && typeof data.unitMap === 'object') cur.unitMap = data.unitMap;
  if (cur.url && !MERCURY_URLS[cur.url] && !/^https:\/\//.test(cur.url)) throw new Error('Адрес сервиса: prod, test или https://…');
  p.setProperty(key, JSON.stringify(cur));
  auditLog_(session.user_id, 'Настройки «Меркурия»', 'MERCURY_CFG:' + session.organization_id, '', JSON.stringify({ url: cur.url, login: cur.login, issuerId: cur.issuerId, enterprises: cur.enterprises }), 'success', session.cascade_id || '');
  return getMercuryConfig_(session);
}

// ---------- XML (разбор/сборка без внешних библиотек; перенос из МонШеф) ----------

function _mrEsc_(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]; }); }
function _mrUnesc_(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, function (m, e) {
    var k = e.toLowerCase(); if (k === 'lt') return '<'; if (k === 'gt') return '>'; if (k === 'amp') return '&'; if (k === 'quot') return '"'; if (k === 'apos') return "'";
    return String.fromCharCode(k.charAt(1) === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
  });
}
/** XML → узлы {n, p, ns, a, c, t} с учётом пространств имён. */
function mercuryParseXml_(s) {
  var root = { n: '#doc', ns: '', p: '', a: {}, c: [], t: '' }, stack = [{ node: root, map: {} }];
  var re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s>\/!?]+)((?:\s+[^\s=\/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g, m;
  s = String(s || '');
  while ((m = re.exec(s))) {
    var top = stack[stack.length - 1];
    if (m[1] !== undefined) { top.node.t += m[1]; continue; }
    if (m[6] !== undefined) { top.node.t += _mrUnesc_(m[6]); continue; }
    if (m[2] !== undefined) { if (stack.length > 1) stack.pop(); continue; }
    if (m[3] === undefined) continue;
    var map = {}; Object.keys(top.map).forEach(function (k) { map[k] = top.map[k]; });
    var attrs = {}, ar = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g, am;
    while ((am = ar.exec(m[4] || ''))) {
      var an = am[1], av = _mrUnesc_(am[3] !== undefined ? am[3] : am[4]);
      if (an === 'xmlns') map[''] = av; else if (an.indexOf('xmlns:') === 0) map[an.slice(6)] = av; else attrs[an] = av;
    }
    var q = m[3], ci = q.indexOf(':'), pf = ci > 0 ? q.slice(0, ci) : '', ln = ci > 0 ? q.slice(ci + 1) : q;
    var node = { n: ln, p: pf, ns: map[pf] || '', a: attrs, c: [], t: '' };
    top.node.c.push(node);
    if (!m[5]) stack.push({ node: node, map: map });
  }
  return root;
}
function _mrKids_(node, name) { return node && node.c ? node.c.filter(function (x) { return !name || x.n === name; }) : []; }
function _mrKid_(node, name) { return _mrKids_(node, name)[0] || null; }
function _mrPath_(node, path) { var cur = node, parts = String(path).split('/'); for (var i = 0; i < parts.length && cur; i++) cur = _mrKid_(cur, parts[i]); return cur; }
function _mrTxt_(node) { return node ? String(node.t || '').trim() : ''; }
function _mrPT_(node, path) { return _mrTxt_(_mrPath_(node, path)); }
function _mrDeep_(node, name) {
  if (!node || !node.c) return null;
  for (var i = 0; i < node.c.length; i++) { if (node.c[i].n === name) return node.c[i]; var d = _mrDeep_(node.c[i], name); if (d) return d; }
  return null;
}
function _mrDeepAll_(node, name, out) { out = out || []; (node && node.c || []).forEach(function (x) { if (x.n === name) out.push(x); else _mrDeepAll_(x, name, out); }); return out; }
/** Узел обратно в XML: префиксы по URI, неизвестные пространства объявляются в конверте. */
function _mrSer_(node, ctx) {
  var uri = node.ns || '', pf = ctx.pf[uri];
  if (pf === undefined) { pf = 'n' + (++ctx.n); ctx.pf[uri] = pf; ctx.extra[pf] = uri; }
  var q = pf ? pf + ':' + node.n : node.n, a = '';
  Object.keys(node.a || {}).forEach(function (k) { if (k.indexOf(':') < 0) a += ' ' + k + '="' + _mrEsc_(node.a[k]) + '"'; });
  var inner = node.c.length ? node.c.map(function (x) { return _mrSer_(x, ctx); }).join('') : _mrEsc_(String(node.t || '').trim());
  return '<' + q + a + '>' + inner + '</' + q + '>';
}
function _mrCtx_() { var pf = {}; Object.keys(MERCURY_NS).forEach(function (k) { pf[MERCURY_NS[k]] = k; }); return { pf: pf, extra: {}, n: 0 }; }
function _mrEnvelope_(body, ctx) {
  var decl = Object.keys(MERCURY_NS).map(function (k) { return ' xmlns:' + k + '="' + MERCURY_NS[k] + '"'; }).join('') +
    Object.keys((ctx && ctx.extra) || {}).map(function (k) { return ' xmlns:' + k + '="' + _mrEsc_(ctx.extra[k]) + '"'; }).join('');
  return '<?xml version="1.0" encoding="UTF-8"?><soap:Envelope' + decl + '><soap:Header/><soap:Body>' + body + '</soap:Body></soap:Envelope>';
}
function _mrIso_(d, withTime) {
  var p = function (n) { return ('0' + n).slice(-2); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + (withTime ? 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) : '');
}
/** Дата ВетИС (firstDate {year, month, day} или xs:date) → ГГГГ-ММ-ДД. */
function _mrGDay_(node) {
  if (!node) return '';
  var f = _mrKid_(node, 'firstDate') || node, y = _mrPT_(f, 'year');
  var p = function (n) { return ('0' + n).slice(-2); };
  if (y) return y + '-' + p(Number(_mrPT_(f, 'month') || 1)) + '-' + p(Number(_mrPT_(f, 'day') || 1));
  var m = /^(\d{4}-\d{2}-\d{2})/.exec(_mrTxt_(node));
  return m ? m[1] : '';
}

// ---------- транспорт SOAP ----------

function _mrLog_(session, kind, vsdId, res) {
  try {
    insertRow_('MERCURY_EXCHANGE_LOG', { log_id: generateId_('MERCURY_EXCHANGE_LOG'), organization_id: session.organization_id, at: nowIso_(), kind: kind, vsd_id: vsdId || '',
      application_id: res.applicationId || '', http: res.http || '', app_status: res.appStatus || res.state || '', code: res.code || '', message: String(res.message || '').slice(0, 1000),
      raw_fragment: String(res.raw || '').slice(0, 20000), user_id: session.user_id });
  } catch (e) {}
}
function _mrHttp_(cfg, action, xml) {
  var r = UrlFetchApp.fetch(cfg.url, { method: 'post', contentType: 'text/xml;charset=UTF-8', payload: xml, muteHttpExceptions: true,
    headers: { SOAPAction: action, Authorization: 'Basic ' + Utilities.base64Encode(cfg.login + ':' + cfg.password, Utilities.Charset.UTF_8) } });
  return { http: r.getResponseCode(), raw: String(r.getContentText() || '') };
}
function _mrClassify_(http, text, exc) {
  var t = String(text || '') + ' ' + String(exc || '');
  if (exc) return /timed? ?out|timeout|превышен/i.test(t) ? 'MERCURY_TIMEOUT' : 'MERCURY_UNAVAILABLE';
  if (http === 401 || http === 403 || /unauthori[sz]ed|authenticat|apikey|api key|доступ запрещ|не авторизован/i.test(t)) return 'MERCURY_AUTH_ERROR';
  if (http === 502 || http === 503 || http === 504 || http === 0) return 'MERCURY_UNAVAILABLE';
  if (http === 408) return 'MERCURY_TIMEOUT';
  if (/не найден|not found/i.test(t)) return 'MERCURY_VSD_NOT_FOUND';
  if (/UTILIZED|погашен/i.test(t)) return 'MERCURY_VSD_ALREADY_CANCELLED';
  if (/статус|status/i.test(t)) return 'MERCURY_INVALID_STATUS';
  return 'MERCURY_API_ERROR';
}
function _mrErrors_(app) {
  return _mrDeepAll_(app, 'error').map(function (e) { return { code: String(e.a.code || ''), message: _mrTxt_(e) }; }).filter(function (e) { return e.code || e.message; });
}
/**
 * Заявка: отправить и дождаться результата. state: COMPLETED | REJECTED | FAILED (точно не выполнена) |
 * UNKNOWN (могла дойти, результата нет — только проверка статуса, без повтора вслепую).
 */
function _mrApply_(session, cfg, kind, dataXml, vsdId, ctx) {
  var res = { state: 'FAILED', applicationId: '', http: '', raw: '', code: '', message: '', errors: [], result: null };
  var sub = '<apldef:submitApplicationRequest><apldef:apiKey>' + _mrEsc_(cfg.apiKey) + '</apldef:apiKey><apl:application><apl:serviceId>' + _mrEsc_(cfg.serviceId) +
    '</apl:serviceId><apl:issuerId>' + _mrEsc_(cfg.issuerId) + '</apl:issuerId><apl:issueDate>' + _mrIso_(new Date(), true) + '</apl:issueDate><apl:data>' + dataXml + '</apl:data></apl:application></apldef:submitApplicationRequest>';
  try {
    var h = _mrHttp_(cfg, 'submitApplicationRequest', _mrEnvelope_(sub, ctx));
    res.http = h.http; res.raw = h.raw;
    var doc = mercuryParseXml_(h.raw), app = _mrDeep_(doc, 'application'), fault = _mrDeep_(doc, 'Fault');
    if (h.http !== 200 || fault || !app) {
      res.message = fault ? _mrPT_(fault, 'faultstring') || _mrTxt_(_mrDeep_(fault, 'message')) : 'HTTP ' + h.http;
      res.code = _mrClassify_(h.http, res.message + ' ' + h.raw.slice(0, 500));
      res.state = res.code === 'MERCURY_TIMEOUT' && kind === 'CANCEL' ? 'UNKNOWN' : 'FAILED';
      _mrLog_(session, kind, vsdId, res); return res;
    }
    res.applicationId = _mrPT_(app, 'applicationId'); res.appStatus = _mrPT_(app, 'status');
    if (res.appStatus === 'REJECTED' || !res.applicationId) {
      res.errors = _mrErrors_(app); res.message = res.errors.map(function (e) { return (e.code ? e.code + ': ' : '') + e.message; }).join('; ') || 'заявка не принята';
      res.code = _mrClassify_(200, res.message); res.state = 'REJECTED'; _mrLog_(session, kind, vsdId, res); return res;
    }
  } catch (e) {
    res.code = _mrClassify_(0, '', e && e.message || e); res.message = String(e && e.message || e);
    res.state = kind === 'CANCEL' ? 'UNKNOWN' : 'FAILED';
    _mrLog_(session, kind, vsdId, res); return res;
  }
  _mrLog_(session, kind + '_SUBMIT', vsdId, res);
  return _mrPoll_(session, cfg, kind, res.applicationId, vsdId, cfg.tries);
}
function _mrPoll_(session, cfg, kind, applicationId, vsdId, tries) {
  var res = { state: 'UNKNOWN', applicationId: applicationId, http: '', raw: '', code: 'MERCURY_TIMEOUT', message: 'заявка в обработке', errors: [], result: null };
  var req = _mrEnvelope_('<apldef:receiveApplicationResultRequest><apldef:apiKey>' + _mrEsc_(cfg.apiKey) + '</apldef:apiKey><apldef:issuerId>' + _mrEsc_(cfg.issuerId) +
    '</apldef:issuerId><apldef:applicationId>' + _mrEsc_(applicationId) + '</apldef:applicationId></apldef:receiveApplicationResultRequest>');
  for (var i = 0; i < tries; i++) {
    if (cfg.pollDelayMs) Utilities.sleep(i === 0 ? Math.min(1500, cfg.pollDelayMs) : cfg.pollDelayMs);
    try {
      var h = _mrHttp_(cfg, 'receiveApplicationResult', req); res.http = h.http; res.raw = h.raw;
      var doc = mercuryParseXml_(h.raw), app = _mrDeep_(doc, 'application'), st = app ? _mrPT_(app, 'status') : '';
      if (h.http !== 200 || !app) { res.code = _mrClassify_(h.http, h.raw.slice(0, 500)); res.message = 'HTTP ' + h.http; if (res.code === 'MERCURY_AUTH_ERROR') break; continue; }
      res.appStatus = st;
      if (st === 'COMPLETED') { res.state = 'COMPLETED'; res.code = ''; res.message = ''; res.result = _mrKid_(app, 'result'); break; }
      if (st === 'REJECTED') { res.state = 'REJECTED'; res.errors = _mrErrors_(app); res.message = res.errors.map(function (e) { return (e.code ? e.code + ': ' : '') + e.message; }).join('; ') || 'заявка отклонена'; res.code = _mrClassify_(200, res.message); break; }
    } catch (e) { res.code = _mrClassify_(0, '', e && e.message || e); res.message = String(e && e.message || e); }
  }
  if (res.state === 'UNKNOWN' && !res.message) res.message = 'результат заявки не получен';
  _mrLog_(session, kind, vsdId, res);
  return res;
}
function _mrHead_(login) { return '<merc:localTransactionId>TSEKH-' + Utilities.getUuid().slice(0, 18) + '</merc:localTransactionId><merc:initiator><vd:login>' + _mrEsc_(login) + '</vd:login></merc:initiator>'; }

// ---------- данные ВСД ----------

/** vd:vetDocument → понятный объект. */
function mercuryNormVsd_(vd) {
  var cc = _mrKid_(vd, 'certifiedConsignment') || {}, bt = _mrKid_(cc, 'batch') || {}, org = _mrKid_(bt, 'origin');
  var refs = _mrKids_(vd, 'referencedDocument').map(function (r) { return { series: _mrPT_(r, 'issueSeries'), number: _mrPT_(r, 'issueNumber'), date: _mrPT_(r, 'issueDate'), type: _mrPT_(r, 'type') }; });
  var way = refs.filter(function (r) { return r.type === '1' || r.type === '5'; })[0] || refs[0] || null;
  var hist = _mrKids_(vd, 'statusChange').map(function (s) { return { status: _mrPT_(s, 'status'), fio: _mrPT_(s, 'specifiedPerson/fio'), at: _mrPT_(s, 'actualDateTime') }; });
  var o = {
    uuid: _mrPT_(vd, 'uuid'), series: _mrPT_(vd, 'issueSeries'), number: _mrPT_(vd, 'issueNumber'), issueDate: _mrPT_(vd, 'issueDate'), status: _mrPT_(vd, 'vetDStatus'),
    consignorBE: _mrPT_(cc, 'consignor/businessEntity/guid'), consignorEnt: _mrPT_(cc, 'consignor/enterprise/guid'),
    consignorName: _mrPT_(cc, 'consignor/enterprise/name') || _mrPT_(cc, 'consignor/businessEntity/name'),
    consigneeEnt: _mrPT_(cc, 'consignee/enterprise/guid'), consigneeName: _mrPT_(cc, 'consignee/enterprise/name') || _mrPT_(cc, 'consignee/businessEntity/name'),
    product: _mrPT_(bt, 'productItem/name') || _mrPT_(bt, 'subProduct/name') || _mrPT_(bt, 'product/name'),
    volume: parseFloat(_mrPT_(bt, 'volume')), unitGuid: _mrPT_(bt, 'unit/guid'), unitName: _mrPT_(bt, 'unit/name'),
    production: _mrGDay_(_mrKid_(bt, 'dateOfProduction')), expiry: _mrGDay_(_mrKid_(bt, 'expiryDate')),
    batchIds: _mrKids_(bt, 'batchID').map(_mrTxt_).filter(Boolean),
    country: org ? (_mrPT_(org, 'country/name') || _mrPT_(org, 'country/guid')) : '',
    producers: org ? _mrKids_(org, 'producer').map(function (p) { return _mrPT_(p, 'enterprise/name') || _mrPT_(p, 'enterprise/guid'); }).filter(Boolean) : [],
    waybill: way, refs: refs, history: hist
  };
  o.numberText = (o.series ? o.series + ' ' : '') + (o.number || '') || ('UUID ' + o.uuid.slice(0, 8));
  var u = hist.filter(function (h) { return h.status === 'UTILIZED'; }).pop();
  o.utilizedAt = u ? u.at : ''; o.utilizedBy = u ? u.fio : '';
  return o;
}
function _mrUnit_(cfg, guid, name) {
  var u = cfg.units[String(guid || '').toLowerCase()] || cfg.units[guid] || '';
  if (!u) {
    var n = String(name || '').toLowerCase().replace(/\./g, '').trim();
    u = /^(кг|килограмм)/.test(n) ? 'кг' : /^(т|тонн)/.test(n) ? 'т' : /^(г|грамм)$/.test(n) ? 'г' : /^(шт|штук)/.test(n) ? 'шт' : /^(л|литр)/.test(n) ? 'л' : '';
  }
  return u;
}
/** Количество в сравнимой единице: масса — в кг, объём — в л. */
function mercuryQty_(q, unit) {
  q = Number(q); unit = String(unit || '');
  return unit === 'г' ? { q: q / 1000, u: 'кг' } : unit === 'т' ? { q: q * 1000, u: 'кг' } : unit === 'мл' ? { q: q / 1000, u: 'л' } : { q: q, u: unit };
}

function _mrRow_(vsdId) { return findOne_('VET_DOCUMENTS', 'vsd_id', vsdId); }
function _mrOwned_(session, vsdId) { var r = _mrRow_(vsdId); assertOwnedByOrg_(session, r, 'VET_DOCUMENTS:' + vsdId); return r; }
function _mrJson_(v, fb) { try { return v ? JSON.parse(v) : fb; } catch (e) { return fb; } }
function _mrBatches_(r) { return String(r.batch_ids || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }

/** Запись/обновление ВСД из ответа «Меркурия» (ключ — организация + UUID). */
function _mrUpsert_(session, vd) {
  var n = mercuryNormVsd_(vd), ctx = _mrCtx_(), cfg = _mrCfg_(session.organization_id, session.location_id);
  var xml = _mrSer_(vd, ctx), unit = _mrUnit_(cfg, n.unitGuid, n.unitName);
  var map = findRows_('MERCURY_SUPPLIER_MAP', function (m) { return m.organization_id === session.organization_id && ((n.consignorBE && m.be_guid === n.consignorBE) || (n.consignorEnt && m.ent_guid === n.consignorEnt)); }).pop();
  var rec = findRows_('VET_DOCUMENTS', function (r) { return r.organization_id === session.organization_id && r.uuid === n.uuid; })[0];
  var f = { number_text: n.numberText, issue_date: n.issueDate, product_name: n.product, volume: isFinite(n.volume) ? n.volume : '', unit: unit || n.unitName || '', unit_guid: n.unitGuid,
    consignor_be: n.consignorBE, consignor_ent: n.consignorEnt, consignor_name: n.consignorName, consignee_ent: n.consigneeEnt, consignee_name: n.consigneeName,
    producers: n.producers.join('; '), country: n.country, mfr_batches: n.batchIds.join(', '), production_date: n.production, expiry_date: n.expiry,
    waybill_json: JSON.stringify(n.waybill || null), refs_json: JSON.stringify(n.refs), mercury_status: n.status, supplier_id: map ? map.supplier_id : (rec ? rec.supplier_id : ''),
    raw_xml: xml.length < 40000 ? xml : '', raw_ns_json: JSON.stringify(ctx.extra), updated_at: nowIso_() };
  if (!rec) {
    rec = { vsd_id: generateId_('VET_DOCUMENTS'), organization_id: session.organization_id, location_id: session.location_id || '', uuid: n.uuid, status: 'FOUND', product_id: '', batch_ids: '', draft_id: '', line_no: '',
      check_json: '', confirm_json: '', application_id: '', attempt: 0, utilized_at: '', utilized_by: '', result: '', error: '', created_at: nowIso_(), created_by: session.user_id, sending_at: '' };
    Object.keys(f).forEach(function (k) { rec[k] = f[k]; });
    insertRow_('VET_DOCUMENTS', rec);
  } else updateRow_('VET_DOCUMENTS', rec, f);
  if (n.status === 'WITHDRAWN' && rec.status !== 'CANCELLED') updateRow_('VET_DOCUMENTS', rec, { status: 'REJECTED', error: 'ВСД аннулирован в «Меркурии»' });
  if (n.status === 'UTILIZED' && !_mrBatches_(rec).length && ['CANCELLED', 'SENDING', 'UNKNOWN'].indexOf(rec.status) === -1)
    updateRow_('VET_DOCUMENTS', rec, { status: 'CANCELLED', utilized_at: n.utilizedAt, utilized_by: (n.utilizedBy || '') + ' (в «Меркурии», вне ЦЕХ)', result: 'погашен ранее, вне ЦЕХ (по данным «Меркурия»)' });
  rec._norm = n;
  return rec;
}
function _mrNormOf_(rec) {
  if (rec._norm) return rec._norm;
  if (!rec.raw_xml) return null;
  var ns = _mrJson_(rec.raw_ns_json, {}), decl = Object.keys(MERCURY_NS).map(function (k) { return ' xmlns:' + k + '="' + MERCURY_NS[k] + '"'; }).join('') +
    Object.keys(ns).map(function (k) { return ' xmlns:' + k + '="' + _mrEsc_(ns[k]) + '"'; }).join('');
  var vd = _mrDeep_(mercuryParseXml_('<w' + decl + '>' + rec.raw_xml + '</w>'), 'vetDocument');
  return vd ? mercuryNormVsd_(vd) : null;
}
function _mrVdOf_(rec) {
  var ns = _mrJson_(rec.raw_ns_json, {}), decl = Object.keys(MERCURY_NS).map(function (k) { return ' xmlns:' + k + '="' + MERCURY_NS[k] + '"'; }).join('') +
    Object.keys(ns).map(function (k) { return ' xmlns:' + k + '="' + _mrEsc_(ns[k]) + '"'; }).join('');
  return _mrDeep_(mercuryParseXml_('<w' + decl + '>' + (rec.raw_xml || '') + '</w>'), 'vetDocument');
}

// ---------- сверка ----------

function _mrNameScore_(a, b) { return Math.max(_irFuzzy_(a, b), _irFuzzy_(b, a)); }
function _mrNormBatch_(s) { return String(s || '').toUpperCase().replace(/[\s\-–—_.\/№#]/g, ''); }

/** Данные приёмки для сверки: строка черновика (до проводки) или партии (после). */
function _mrLocalFromLine_(draft, line) {
  var doc = _mrJson_(draft.document_json, {}), prod = line.match && line.match.product_id ? getProductById_(line.match.product_id) : null;
  var unit = typeof _invUnit_ === 'function' ? _invUnit_(line.unit || (prod && prod.единица)) : String(line.unit || '');
  var q = mercuryQty_(Number(line.qty) || 0, unit);
  return { supplierId: doc.supplier_id || '', supplier: doc.supplier || '', product: prod ? prod.название : (line.name || ''), productId: prod ? prod.product_id : '', rawName: line.raw_name || line.name || '',
    qty: q.q, unit: q.u, mfrBatch: line.batch_number ? [String(line.batch_number)] : [], expiry: line.expiryDate || '', expirySrc: line.expiryDate ? 'строка приёмки' : '', manufacturer: line.manufacturer || '' };
}
function _mrLocalFromBatches_(rec) {
  var ids = _mrBatches_(rec), out = { supplierId: '', supplier: '', product: '', productId: '', qty: 0, unit: '', mfrBatch: [], expiry: '', expirySrc: '', manufacturer: '' };
  ids.forEach(function (bid) {
    var b = findOne_('BATCHES', 'batch_id', bid); if (!b) return;
    var p = getProductById_(b.product_id);
    out.productId = out.productId || b.product_id; out.product = out.product || (p ? p.название : '');
    var q = mercuryQty_(Number(b.количество) || 0, typeof _invUnit_ === 'function' ? _invUnit_(p && p.единица) : (p && p.единица)); out.qty += q.q; out.unit = out.unit || q.u;
    if (b.партия_номер && !/^B-|^BATCH/i.test(String(b.партия_номер))) out.mfrBatch.push(String(b.партия_номер));
    if (b.срок_годности && !out.expiry) { out.expiry = String(b.срок_годности).slice(0, 10); out.expirySrc = 'партия'; }
  });
  if (rec.draft_id) {
    var d = findOne_('INVOICE_INTAKE_DRAFTS', 'draft_id', rec.draft_id), doc = d ? _mrJson_(d.document_json, {}) : {};
    out.supplierId = doc.supplier_id || ''; out.supplier = doc.supplier || '';
  }
  out.qty = Math.round(out.qty * 1e6) / 1e6;
  return out;
}

/** Сверка ВСД с приёмкой: hard — гашение заблокировано; soft — нужно подтверждение человека с причиной. */
function mercuryCheck_(n, unit, local, cfg, confirm, session) {
  confirm = confirm || {};
  var checks = [], add = function (key, label, ok, vsd, loc, msg, sev, code) {
    var conf = !ok && sev === 'soft' && confirm[key] && confirm[key].reason;
    checks.push({ key: key, label: label, ok: !!ok || !!conf, confirmed: !!conf, confirm_reason: conf ? confirm[key].reason : '', vsd: vsd, local: loc, msg: ok ? '' : msg, hard: !ok && sev === 'hard', soft: !ok && sev === 'soft' && !conf, code: code || '' });
  };
  var map = findRows_('MERCURY_SUPPLIER_MAP', function (m) { return m.organization_id === session.organization_id && ((n.consignorBE && m.be_guid === n.consignorBE) || (n.consignorEnt && m.ent_guid === n.consignorEnt)); }).pop();
  var mapSup = map ? getSupplierById_(map.supplier_id) : null;
  if (!map) add('supplier', 'Поставщик', false, n.consignorName || n.consignorBE || '—', local.supplier || '—', 'отправитель ВСД не сопоставлен с поставщиком — сопоставьте один раз', 'hard', 'MERCURY_SUPPLIER_MISMATCH');
  else add('supplier', 'Поставщик', !local.supplierId || map.supplier_id === local.supplierId, mapSup ? mapSup.название : map.supplier_id, local.supplier || local.supplierId || '—', 'в ВСД — «' + (mapSup ? mapSup.название : map.supplier_id) + '», в накладной — «' + (local.supplier || local.supplierId) + '»', 'hard', 'MERCURY_SUPPLIER_MISMATCH');
  add('receiver', 'Получатель', !!cfg.enterprise && n.consigneeEnt === cfg.enterprise, n.consigneeName || n.consigneeEnt || '—', cfg.enterprise ? 'ваша площадка' : 'GUID площадки не задан',
    cfg.enterprise ? 'ВСД оформлен на другую площадку (' + (n.consigneeName || n.consigneeEnt || '—') + ')' : 'в настройках не задан GUID площадки этой точки', 'hard', 'MERCURY_RECEIVER_MISMATCH');
  var ps = n.product && (local.product || local.rawName) ? Math.max(_mrNameScore_(n.product, local.product || ''), _mrNameScore_(n.product, local.rawName || '')) : 0;
  add('product', 'Продукт', ps >= 0.5, n.product || '—', local.product || local.rawName || '—', 'названия не совпадают', 'soft', 'MERCURY_PRODUCT_MISMATCH');
  var vu = mercuryQty_(n.volume, unit);
  add('unit', 'Единица', !!unit && (!local.unit || vu.u === local.unit), unit || n.unitName || n.unitGuid || '—', local.unit || '—',
    unit ? 'в ВСД — ' + vu.u + ', в приёмке — ' + local.unit : 'единица ВСД не распознана (' + (n.unitName || n.unitGuid) + ') — добавьте её в настройки', 'hard', 'MERCURY_QUANTITY_MISMATCH');
  var qOk = isFinite(vu.q) && local.qty > 0 && vu.u === local.unit && Math.abs(vu.q - local.qty) <= Math.max(0.001, vu.q * 0.005), dq = Math.round((local.qty - vu.q) * 1000) / 1000;
  add('qty', 'Количество', qOk, (isFinite(vu.q) ? vu.q : '—') + ' ' + (vu.u || ''), local.qty + ' ' + (local.unit || ''),
    'ВСД: ' + vu.q + ' ' + vu.u + ' · фактически: ' + local.qty + ' ' + local.unit + ' · разница ' + (dq > 0 ? '+' : '') + dq, 'hard', 'MERCURY_QUANTITY_MISMATCH');
  if (n.producers.length && local.manufacturer) {
    var best = Math.max.apply(null, n.producers.map(function (p) { return _mrNameScore_(p, local.manufacturer); }));
    add('producer', 'Изготовитель', best >= 0.34, n.producers.join('; '), local.manufacturer, 'изготовитель в ВСД и на этикетке различается', 'soft', 'MERCURY_PRODUCT_MISMATCH');
  }
  if (n.batchIds.length && local.mfrBatch.length) {
    var nb = n.batchIds.map(_mrNormBatch_), okB = local.mfrBatch.every(function (b) { return nb.indexOf(_mrNormBatch_(b)) >= 0; });
    add('batch', 'Партия изготовителя', okB, n.batchIds.join(', '), local.mfrBatch.join(', '), 'номер партии в ВСД и в приёмке различается', 'hard', 'MERCURY_PRODUCT_MISMATCH');
  }
  if (n.expiry && local.expiry) add('expiry', 'Срок годности', n.expiry === String(local.expiry).slice(0, 10), n.expiry, local.expiry + ' (' + local.expirySrc + ')', 'срок в ВСД и в приёмке различается', 'hard', 'MERCURY_PRODUCT_MISMATCH');
  var hard = checks.filter(function (c) { return c.hard; }), soft = checks.filter(function (c) { return c.soft; });
  return { checks: checks, blocked: hard.length > 0, need_confirm: soft.length > 0, codes: hard.concat(soft).map(function (c) { return c.code; }).filter(Boolean),
    summary: hard.length ? 'Гашение заблокировано: ' + hard.map(function (c) { return c.label + ' — ' + c.msg; }).join('; ') : soft.length ? 'Нужно подтверждение: ' + soft.map(function (c) { return c.label + ' — ' + c.msg; }).join('; ') : 'Совпадает' };
}

function _mrRunCheck_(session, rec) {
  var n = _mrNormOf_(rec); if (!n) return null;
  var cfg = _mrCfg_(session.organization_id, rec.location_id || session.location_id), unit = _mrUnit_(cfg, n.unitGuid, n.unitName);
  var local;
  if (_mrBatches_(rec).length) local = _mrLocalFromBatches_(rec);
  else if (rec.draft_id) {
    var d = findOne_('INVOICE_INTAKE_DRAFTS', 'draft_id', rec.draft_id), lines = d ? _mrJson_(d.lines_json, []) : [];
    var line = lines.filter(function (l) { return Number(l.line_no) === Number(rec.line_no); })[0];
    local = line ? _mrLocalFromLine_(d, line) : null;
  }
  if (!local) return null;
  var chk = mercuryCheck_(n, unit, local, cfg, _mrJson_(rec.confirm_json, {}), session);
  if (n.status && n.status !== 'CONFIRMED' && n.status !== 'UTILIZED') { chk.blocked = true; chk.codes.push('MERCURY_INVALID_STATUS'); chk.summary = 'Гашение заблокировано: статус ВСД в «Меркурии» — ' + n.status + (chk.summary !== 'Совпадает' ? '; ' + chk.summary : ''); }
  var st = rec.status;
  if (['CANCELLED', 'SENDING', 'UNKNOWN', 'REJECTED'].indexOf(st) === -1) st = chk.blocked || chk.need_confirm ? 'CONFLICT' : _mrBatches_(rec).length ? 'READY_TO_CANCEL' : 'VALID';
  updateRow_('VET_DOCUMENTS', rec, { status: st, check_json: JSON.stringify({ at: nowIso_(), by: session.user_id, checks: chk.checks, summary: chk.summary, codes: chk.codes }) });
  chk.status = st; chk.local = local;
  return chk;
}

function _mrView_(rec) {
  if (!rec) return null;
  var chk = _mrJson_(rec.check_json, null);
  return { vsd_id: rec.vsd_id, uuid: rec.uuid, number: rec.number_text, issue_date: rec.issue_date, status: rec.status, status_ru: MERCURY_STATUS_RU[rec.status] || rec.status, mercury_status: rec.mercury_status,
    product: rec.product_name, volume: rec.volume, unit: rec.unit, producers: rec.producers, country: rec.country, mfr_batches: rec.mfr_batches, production_date: rec.production_date,
    expiry_date: rec.expiry_date, consignor: rec.consignor_name, consignor_be: rec.consignor_be, consignor_ent: rec.consignor_ent, consignee: rec.consignee_name,
    supplier_id: rec.supplier_id, supplier_mapped: !!rec.supplier_id, batch_ids: _mrBatches_(rec), draft_id: rec.draft_id, line_no: rec.line_no, check: chk,
    waybill: _mrJson_(rec.waybill_json, null), application_id: rec.application_id, utilized_at: rec.utilized_at, utilized_by: rec.utilized_by, result: rec.result, error: rec.error };
}

// ---------- публичные операции ----------

/** Получить ВСД: по UUID — один; иначе входящие ВСД площадки, отобранные по накладной и поставщику. */
function fetchVsd_(data, session) {
  var cfg = _mrCfg_(session.organization_id, session.location_id);
  if (!cfg.ready) throw _mrErr_('MERCURY_NOT_CONFIGURED', 'не заполнено: ' + cfg.missing.join(', '));
  var login = _mrLoginFor_(cfg, session), uuid = String(data.uuid || '').trim().toLowerCase();
  var docNo = String(data.docNo || ''), supplierId = data.supplierId || '';
  if (data.draftId) { var dr = findOne_('INVOICE_INTAKE_DRAFTS', 'draft_id', data.draftId); assertOwnedByOrg_(session, dr, 'INVOICE_INTAKE_DRAFTS:' + data.draftId); var doc = _mrJson_(dr.document_json, {}); docNo = docNo || doc.invoice_number || ''; supplierId = supplierId || doc.supplier_id || ''; }
  var body = uuid ? '<merc:getVetDocumentByUuidRequest>' + _mrHead_(login) + '<bs:uuid>' + _mrEsc_(uuid) + '</bs:uuid><dt:enterpriseGuid>' + _mrEsc_(cfg.enterprise) + '</dt:enterpriseGuid></merc:getVetDocumentByUuidRequest>'
    : '<merc:getVetDocumentListRequest>' + _mrHead_(login) + '<bs:listOptions><bs:count>' + Math.min(1000, Number(data.count) || 200) + '</bs:count><bs:offset>0</bs:offset></bs:listOptions><vd:vetDocumentType>INCOMING</vd:vetDocumentType>' +
      (data.status ? '<vd:vetDocumentStatus>' + _mrEsc_(data.status) + '</vd:vetDocumentStatus>' : '') + '<dt:enterpriseGuid>' + _mrEsc_(cfg.enterprise) + '</dt:enterpriseGuid></merc:getVetDocumentListRequest>';
  var res = _mrApply_(session, cfg, uuid ? 'GET_VSD' : 'GET_VSD_LIST', body, '', null);
  if (res.state !== 'COMPLETED') throw _mrErr_(res.code || 'MERCURY_API_ERROR', res.message);
  var docs = _mrDeepAll_(res.result, 'vetDocument'), digits = docNo.replace(/\D/g, '');
  return withLock_(function () {
    var out = docs.map(function (vd) { return _mrUpsert_(session, vd); }).map(function (rec) {
      var n = rec._norm, v = _mrView_(rec);
      v.invoice_match = !!digits && n.refs.some(function (r) { return String(r.number || '').replace(/\D/g, '') === digits; });
      v.supplier_match = !!supplierId && rec.supplier_id === supplierId;
      v.free = !_mrBatches_(rec).length && !rec.draft_id;
      return v;
    });
    if (!uuid && (digits || supplierId)) { var f = out.filter(function (v) { return v.invoice_match || v.supplier_match; }); if (f.length || data.strict) out = f; }
    out.sort(function (a, b) { return (b.invoice_match - a.invoice_match) || (b.free - a.free); });
    auditLog_(session.user_id, 'Получены ВСД из «Меркурия»', 'VET_DOCUMENTS', '', JSON.stringify({ found: out.length, docNo: docNo, applicationId: res.applicationId }), 'success', session.cascade_id || '');
    return { vsd: out, application_id: res.applicationId };
  });
}

/** Сопоставить ВСД со строкой черновика приёмки (до проводки) и сверить. */
function linkVsdToDraftLine_(data, session) {
  return withLock_(function () {
    var rec = _mrOwned_(session, data.vsdId);
    var d = findOne_('INVOICE_INTAKE_DRAFTS', 'draft_id', data.draftId); assertOwnedByOrg_(session, d, 'INVOICE_INTAKE_DRAFTS:' + data.draftId);
    if (['POSTED', 'POSTING'].indexOf(d.status) !== -1) throw new Error('Приёмка уже проведена — сопоставляйте ВСД с партией.');
    if (rec.status === 'REJECTED') throw new Error('ВСД отклонён — сопоставить нельзя.');
    if (_mrBatches_(rec).length) throw new Error('ВСД уже привязан к партии ' + _mrBatches_(rec).join(', ') + '.');
    var lines = _mrJson_(d.lines_json, []), line = lines.filter(function (l) { return Number(l.line_no) === Number(data.lineNo); })[0];
    if (!line) throw new Error('Строка ' + data.lineNo + ' не найдена.');
    var other = findRows_('VET_DOCUMENTS', function (r) { return r.organization_id === session.organization_id && r.draft_id === d.draft_id && Number(r.line_no) === Number(data.lineNo) && r.vsd_id !== rec.vsd_id && r.status !== 'REJECTED'; })[0];
    if (other && !data.addSecond) throw new Error('К строке уже сопоставлен ВСД ' + other.number_text + '.');
    if (rec.draft_id && (rec.draft_id !== d.draft_id || Number(rec.line_no) !== Number(data.lineNo)) && !data.move) throw new Error('ВСД уже сопоставлен с другой строкой приёмки.');
    var patch = { draft_id: d.draft_id, line_no: Number(data.lineNo), product_id: line.match && line.match.product_id || '' };
    if (data.confirm) patch.confirm_json = JSON.stringify(_mrConfirm_(rec, data.confirm, session));
    updateRow_('VET_DOCUMENTS', rec, patch);
    var chk = _mrRunCheck_(session, rec);
    auditLog_(session.user_id, 'ВСД сопоставлен со строкой приёмки', 'VET_DOCUMENTS:' + rec.vsd_id, '', JSON.stringify({ draft: d.draft_id, line: data.lineNo, result: chk ? chk.summary : '' }), 'success', session.cascade_id || '');
    var v = _mrView_(rec); v.check = chk; return v;
  });
}

function _mrConfirm_(rec, confirm, session) {
  var conf = _mrJson_(rec.confirm_json, {});
  Object.keys(confirm || {}).forEach(function (k) {
    var r = String((confirm[k] || {}).reason || confirm[k] || '').trim();
    if (r && /^(product|producer)$/.test(k)) conf[k] = { reason: r, by: session.user_id, at: nowIso_() };
  });
  return conf;
}

/** Привязать ВСД к партиям (после проводки или из карточки партии) и сверить. */
function linkVsdToBatches_(data, session) {
  return withLock_(function () {
    var rec = _mrOwned_(session, data.vsdId);
    var ids = (Array.isArray(data.batchIds) ? data.batchIds : String(data.batchId || '').split(',')).map(function (x) { return String(x).trim(); }).filter(Boolean);
    if (!ids.length) throw new Error('Укажите партию.');
    ids.forEach(function (id) { var b = findOne_('BATCHES', 'batch_id', id); if (!b) throw new Error('Партия ' + id + ' не найдена.'); var p = getProductById_(b.product_id); assertOwnedByOrg_(session, p, 'PRODUCTS:' + b.product_id); });
    var have = _mrBatches_(rec).filter(function (b) { return ids.indexOf(b) < 0; });
    if (have.length) throw new Error('ВСД ' + rec.number_text + ' уже привязан к партии ' + have.join(', ') + '.');
    if (rec.status === 'REJECTED') throw new Error('ВСД отклонён — привязать нельзя.');
    var other = findRows_('VET_DOCUMENTS', function (r) { return r.organization_id === session.organization_id && r.vsd_id !== rec.vsd_id && r.status !== 'REJECTED' && _mrBatches_(r).some(function (b) { return ids.indexOf(b) >= 0; }); })[0];
    if (other && !data.addSecond) throw new Error('К партии уже привязан ВСД ' + other.number_text + ' (' + (MERCURY_STATUS_RU[other.status] || other.status) + ').');
    updateRow_('VET_DOCUMENTS', rec, { batch_ids: ids.join(',') });
    ids.forEach(function (id) { var b = findOne_('BATCHES', 'batch_id', id); updateRow_('BATCHES', b, { veterinary_document_id: rec.vsd_id }); });
    var chk = _mrRunCheck_(session, rec);
    if (rec.status === 'CANCELLED') {
      if (chk && !chk.blocked) _mrReleaseHeld_(session, rec);
      else updateRow_('VET_DOCUMENTS', rec, { error: 'ВСД погашен, но не совпадает с приёмкой — партии не допущены' + (chk ? ': ' + chk.summary : '') });
    }
    auditLog_(session.user_id, 'ВСД привязан к партиям', 'VET_DOCUMENTS:' + rec.vsd_id, '', JSON.stringify({ batches: ids, result: chk ? chk.summary : '' }), 'success', session.cascade_id || '');
    var v = _mrView_(rec); v.check = chk; return v;
  });
}

/** Проверить ВСД: перечитать из «Меркурия» (если настроен) и сверить; подтверждения — с причиной. */
function checkVsd_(data, session) {
  var rec = _mrOwned_(session, data.vsdId), note = '';
  var cfg = _mrCfg_(session.organization_id, rec.location_id || session.location_id);
  if (cfg.ready && rec.uuid) {
    var fr = _mrFetchOne_(session, cfg, rec.uuid, rec.vsd_id);
    if (fr.vd) withLock_(function () { _mrUpsert_(session, fr.vd); });
    else note = (MERCURY_ERR[fr.code] || '') + ' — сверка по сохранённым данным от ' + String(rec.updated_at).slice(0, 16);
  }
  rec = _mrRow_(rec.vsd_id);
  if (rec.status !== 'CANCELLED' && rec.mercury_status === 'UTILIZED' && _mrBatches_(rec).length) return syncVsd_({ vsdId: rec.vsd_id }, session);
  return withLock_(function () {
    if (data.confirm) updateRow_('VET_DOCUMENTS', rec, { confirm_json: JSON.stringify(_mrConfirm_(rec, data.confirm, session)) });
    var chk = _mrRunCheck_(session, rec);
    auditLog_(session.user_id, 'Проверка ВСД', 'VET_DOCUMENTS:' + rec.vsd_id, '', chk ? chk.summary : 'нет данных для сверки', 'success', session.cascade_id || '');
    var v = _mrView_(rec); v.check = chk; v.note = note; return v;
  });
}

function _mrFetchOne_(session, cfg, uuid, vsdId) {
  var res = _mrApply_(session, cfg, 'GET_VSD', '<merc:getVetDocumentByUuidRequest>' + _mrHead_(_mrLoginFor_(cfg, session)) + '<bs:uuid>' + _mrEsc_(uuid) + '</bs:uuid><dt:enterpriseGuid>' +
    _mrEsc_(cfg.enterprise) + '</dt:enterpriseGuid></merc:getVetDocumentByUuidRequest>', vsdId, null);
  if (res.state !== 'COMPLETED') return { vd: null, code: res.code || 'MERCURY_API_ERROR', message: res.message, res: res };
  var vd = _mrDeep_(res.result, 'vetDocument');
  return vd ? { vd: vd, res: res } : { vd: null, code: 'MERCURY_VSD_NOT_FOUND', message: 'UUID ' + uuid, res: res };
}

/** Партии, удержанные до гашения ВСД, допускаются (только из статуса ОЖИДАЕТ_ВСД). */
function _mrReleaseHeld_(session, rec) {
  var out = [];
  _mrBatches_(rec).forEach(function (id) {
    var b = findOne_('BATCHES', 'batch_id', id);
    if (b && b.статус === MERCURY_HOLD_STATUS) { updateRow_('BATCHES', b, { статус: 'активна' }); out.push(id); }
  });
  if (out.length) auditLog_(session.user_id, 'Партии допущены: ВСД погашен', 'VET_DOCUMENTS:' + rec.vsd_id, MERCURY_HOLD_STATUS, 'активна: ' + out.join(','), 'success', session.cascade_id || '');
  return out;
}

/** ВСД погашен (ответ «Меркурия» или его фактический статус) — запись в ЦЕХ. Повторно ничего не делает. */
function _mrFinalize_(session, rec, info) {
  if (rec.status === 'CANCELLED' && rec.result) return rec;
  updateRow_('VET_DOCUMENTS', rec, { status: 'CANCELLED', mercury_status: 'UTILIZED', utilized_at: info.at || nowIso_(), utilized_by: info.by || session.user_id,
    result: info.result || 'погашен через интеграцию («Меркурий»: заявка выполнена)', application_id: info.applicationId || rec.application_id, error: '', stock_entry: info.stockEntry || rec.stock_entry || '' });
  // Партии допускаются, только если ВСД сходится с приёмкой: погашенный вне ЦЕХ чужой ВСД не открывает партию.
  var chk = _mrBatches_(rec).length ? _mrRunCheck_(session, rec) : null, released = [];
  if (chk && chk.blocked) updateRow_('VET_DOCUMENTS', rec, { error: 'ВСД погашен, но не совпадает с приёмкой — партии не допущены: ' + chk.summary });
  else released = _mrReleaseHeld_(session, rec);
  auditLog_(session.user_id, info.recovered ? 'ВСД погашен (восстановлено по статусу)' : 'ВСД погашен', 'VET_DOCUMENTS:' + rec.vsd_id, info.before || '', JSON.stringify({ applicationId: info.applicationId || '', released: released, external: !!info.external }), 'success', session.cascade_id || '');
  return rec;
}

/** processIncomingConsignmentRequest: груз из ВСД, получатель — площадка, решение — принять всё. */
function _mrCancelXml_(rec, vd, login, ctx) {
  var cc = _mrKid_(vd, 'certifiedConsignment'); if (!cc) throw new Error('в ВСД нет сведений о грузе (certifiedConsignment)');
  var bt = _mrKid_(cc, 'batch'); if (!bt) throw new Error('в ВСД нет сведений о партии (batch)');
  var copy = function (name) { var x = _mrKid_(cc, name); return x ? _mrSer_(x, ctx) : ''; };
  var cons = _mrSer_({ n: 'consignment', ns: MERCURY_NS.vd, a: bt.a, c: bt.c, t: bt.t }, ctx);
  var n = _mrNormOf_(rec) || {}, wb = n.waybill || {}, d = rec.draft_id ? findOne_('INVOICE_INTAKE_DRAFTS', 'draft_id', rec.draft_id) : null, doc = d ? _mrJson_(d.document_json, {}) : {};
  var wNum = wb.number || doc.invoice_number || '', wDate = wb.date || doc.invoice_date || _mrIso_(new Date(), false);
  if (!wNum) throw new Error('нет номера товарно-транспортной накладной (ни в ВСД, ни в приёмке)');
  var resp = '<vd:responsible><vd:login>' + _mrEsc_(login) + '</vd:login></vd:responsible>';
  return '<merc:processIncomingConsignmentRequest>' + _mrHead_(login) +
    '<vd:delivery><vd:deliveryDate>' + _mrIso_(new Date(), true) + '</vd:deliveryDate>' + copy('consignor') + copy('consignee') + cons + copy('broker') + copy('transportInfo') + copy('transportStorageType') +
    '<vd:accompanyingForms><vd:waybill>' + (wb.series ? '<vd:issueSeries>' + _mrEsc_(wb.series) + '</vd:issueSeries>' : '') + '<vd:issueNumber>' + _mrEsc_(wNum) + '</vd:issueNumber><vd:issueDate>' + _mrEsc_(wDate) +
    '</vd:issueDate><vd:type>' + _mrEsc_(wb.type || '1') + '</vd:type></vd:waybill><vd:vetCertificate><bs:uuid>' + _mrEsc_(rec.uuid) + '</bs:uuid></vd:vetCertificate></vd:accompanyingForms></vd:delivery>' +
    '<vd:deliveryFacts><vd:vetCertificatePresence>ELECTRONIC</vd:vetCertificatePresence><vd:docInspection>' + resp + '<vd:result>CORRESPONDS</vd:result></vd:docInspection>' +
    '<vd:vetInspection>' + resp + '<vd:result>CORRESPONDS</vd:result></vd:vetInspection><vd:decision>ACCEPT_ALL</vd:decision></vd:deliveryFacts></merc:processIncomingConsignmentRequest>';
}

/**
 * Погасить ВСД: ВСД → не погашен → свежий статус из «Меркурия» → сверка → захват (SENDING) →
 * processIncomingConsignment → результат → CANCELLED / ERROR / UNKNOWN.
 */
function cancelVsd_(data, session) {
  var cfg = _mrCfg_(session.organization_id, session.location_id);
  if (!cfg.ready) throw _mrErr_('MERCURY_NOT_CONFIGURED', 'не заполнено: ' + cfg.missing.join(', '));
  var rec = _mrOwned_(session, data.vsdId);
  if (rec.status === 'CANCELLED') return _mrAlready_(rec, false);
  if (rec.status === 'SENDING' || rec.status === 'UNKNOWN') throw _mrErr_('MERCURY_UNKNOWN_RESULT', rec.application_id ? 'заявка ' + rec.application_id : '');
  if (rec.status === 'REJECTED') throw _mrErr_('MERCURY_INVALID_STATUS', 'ВСД отклонён');
  if (!_mrBatches_(rec).length) throw new Error('ВСД не привязан к партии — сначала проведите приёмку или привяжите ВСД к партии.');
  if (!rec.uuid) throw new Error('ВСД внесён без «Меркурия» — получите его через «Получить ВСД».');
  var fr = _mrFetchOne_(session, cfg, rec.uuid, rec.vsd_id);
  if (!fr.vd) throw _mrErr_(fr.code, fr.message);
  var pre = withLock_(function () {
    var fresh = _mrUpsert_(session, fr.vd), n = fresh._norm;
    if (n.status === 'UTILIZED') {
      _mrFinalize_(session, fresh, { external: true, before: fresh.status, at: n.utilizedAt, by: (n.utilizedBy || 'вне ЦЕХ') + ' (в «Меркурии», вне ЦЕХ)', result: 'погашен ранее, вне ЦЕХ — результат привязан без повторного гашения' });
      return _mrAlready_(fresh, true);
    }
    if (n.status !== 'CONFIRMED') { updateRow_('VET_DOCUMENTS', fresh, { status: 'CONFLICT', error: 'статус в «Меркурии»: ' + n.status }); throw _mrErr_('MERCURY_INVALID_STATUS', n.status); }
    var chk = _mrRunCheck_(session, fresh);
    if (!chk || chk.blocked || chk.need_confirm) {
      auditLog_(session.user_id, 'Гашение ВСД заблокировано сверкой', 'VET_DOCUMENTS:' + fresh.vsd_id, '', chk ? chk.summary : 'нет данных приёмки', 'success', session.cascade_id || '');
      var e = _mrErr_((chk && chk.codes[0]) || 'MERCURY_API_ERROR', chk ? chk.summary : 'нет данных приёмки для сверки'); e.check = chk; throw e;
    }
    // захват: второй запрос невозможен, пока не выяснен результат этого
    var cur = _mrRow_(fresh.vsd_id);
    if (cur.status === 'SENDING' || cur.status === 'UNKNOWN') throw _mrErr_('MERCURY_UNKNOWN_RESULT', '');
    updateRow_('VET_DOCUMENTS', cur, { status: 'SENDING', attempt: (Number(cur.attempt) || 0) + 1, application_id: '', sending_at: nowIso_(), sending_by: session.user_id, error: '' });
    return null;
  });
  if (pre) return pre;
  var ctx = _mrCtx_(), xml;
  try { xml = _mrCancelXml_(_mrRow_(rec.vsd_id), fr.vd, _mrLoginFor_(cfg, session), ctx); }
  catch (eX) { withLock_(function () { updateRow_('VET_DOCUMENTS', _mrRow_(rec.vsd_id), { status: 'ERROR', error: String(eX.message || eX) }); }); throw _mrErr_('MERCURY_API_ERROR', String(eX.message || eX)); }
  var res = _mrApply_(session, cfg, 'CANCEL', xml, rec.vsd_id, ctx);
  return withLock_(function () {
    var cur = _mrRow_(rec.vsd_id);
    if (res.applicationId) updateRow_('VET_DOCUMENTS', cur, { application_id: res.applicationId });
    if (res.state === 'COMPLETED') {
      try { _mrFinalize_(session, cur, { before: 'SENDING', applicationId: res.applicationId, by: session.user_id, stockEntry: _mrPT_(_mrDeep_(res.result, 'stockEntry') || {}, 'uuid') }); }
      catch (eF) { updateRow_('VET_DOCUMENTS', cur, { status: 'UNKNOWN', error: '«Меркурий»: погашен (заявка ' + res.applicationId + '); ЦЕХ: запись не завершена — ' + String(eF.message || eF).slice(0, 300) }); throw _mrErr_('MERCURY_LOCAL_INCOMPLETE', ''); }
      var v = _mrView_(_mrRow_(cur.vsd_id)); v.message = 'ВСД погашен. Партии допущены.'; return v;
    }
    var unknown = res.state === 'UNKNOWN', code = unknown ? 'MERCURY_UNKNOWN_RESULT' : (res.code || 'MERCURY_API_ERROR');
    updateRow_('VET_DOCUMENTS', cur, { status: unknown ? 'UNKNOWN' : 'ERROR', error: MERCURY_ERR[code] + (res.message ? ': ' + res.message : '') });
    auditLog_(session.user_id, 'ВСД не погашен', 'VET_DOCUMENTS:' + cur.vsd_id, 'SENDING', (unknown ? 'UNKNOWN' : 'ERROR') + ': ' + res.message, 'error', session.cascade_id || '');
    var v2 = _mrView_(cur); v2.failed = true; v2.message = (unknown ? 'Результат неизвестен: ' : 'ВСД не погашен: ') + MERCURY_ERR[code] + (res.message ? ' (' + res.message + ')' : ''); return v2;
  });
}
function _mrAlready_(rec, justLinked) {
  var v = _mrView_(rec); v.already = true;
  v.message = 'ВСД уже погашен' + (justLinked ? ' в «Меркурии» — результат привязан к приёмке, повторный запрос не отправлялся' : ' — повторный запрос не отправляется');
  return v;
}

/** Проверить результат / статус: результат последней заявки и фактический статус ВСД; восстановление без повторного гашения. */
function syncVsd_(data, session) {
  var rec = _mrOwned_(session, data.vsdId), cfg = _mrCfg_(session.organization_id, rec.location_id || session.location_id);
  if (!cfg.ready) throw _mrErr_('MERCURY_NOT_CONFIGURED', 'не заполнено: ' + cfg.missing.join(', '));
  if (!rec.uuid) throw new Error('ВСД внесён без «Меркурия» — статус не запрашивается.');
  var before = rec.status, pending = before === 'SENDING' || before === 'UNKNOWN', appRes = null, stockEntry = '';
  if (pending && rec.application_id) {
    var c1 = {}; Object.keys(cfg).forEach(function (k) { c1[k] = cfg[k]; }); c1.pollDelayMs = 0;
    appRes = _mrPoll_(session, c1, 'CANCEL_RESULT', rec.application_id, rec.vsd_id, 1);
    if (appRes.state === 'COMPLETED') stockEntry = _mrPT_(_mrDeep_(appRes.result, 'stockEntry') || {}, 'uuid');
  }
  var fr = _mrFetchOne_(session, cfg, rec.uuid, rec.vsd_id);
  if (!fr.vd && !(appRes && appRes.state === 'COMPLETED')) throw _mrErr_(fr.code, fr.message);
  return withLock_(function () {
    var cur = fr.vd ? _mrUpsert_(session, fr.vd) : _mrRow_(rec.vsd_id), ms = fr.vd ? cur._norm.status : 'UTILIZED', msg;
    if (ms === 'UTILIZED' || (appRes && appRes.state === 'COMPLETED')) {
      if (cur.status !== 'CANCELLED' || !cur.result) {
        var n = cur._norm || {};
        _mrFinalize_(session, cur, { recovered: pending, external: !pending, before: before, applicationId: rec.application_id, stockEntry: stockEntry, at: n.utilizedAt,
          by: pending ? (rec.sending_by || session.user_id) + ' (подтверждено проверкой статуса)' : (n.utilizedBy || 'вне ЦЕХ') + ' (в «Меркурии», вне ЦЕХ)',
          result: pending ? 'погашен через интеграцию; результат подтверждён проверкой статуса, без повторного гашения' : 'погашен вне ЦЕХ (по данным «Меркурия»)' });
        msg = pending ? 'ВСД погашен в «Меркурии». Приёмка восстановлена — повторное гашение не выполнялось.' : 'ВСД погашен в «Меркурии» (вне ЦЕХ) — результат привязан.';
      } else msg = 'ВСД погашен.';
    } else if (ms === 'CONFIRMED' && appRes && appRes.state === 'UNKNOWN') {
      updateRow_('VET_DOCUMENTS', cur, { status: 'UNKNOWN', error: 'заявка ' + rec.application_id + ' ещё обрабатывается в «Меркурии»' });
      msg = 'Заявка на гашение ещё обрабатывается — проверьте позже. Повторное гашение пока недоступно.';
    } else if (ms === 'CONFIRMED') {
      if (pending) updateRow_('VET_DOCUMENTS', cur, { status: 'READY_TO_CANCEL', error: 'предыдущая попытка не выполнена в «Меркурии»' + (appRes && appRes.state === 'REJECTED' ? ': ' + appRes.message : '') });
      if (cur.status !== 'CANCELLED') _mrRunCheck_(session, cur);
      msg = 'ВСД в «Меркурии» не погашен' + (pending ? ' — предыдущая попытка не выполнена, гашение можно повторить' : '') + '.';
    } else if (ms === 'WITHDRAWN') { updateRow_('VET_DOCUMENTS', cur, { status: 'REJECTED', error: 'ВСД аннулирован в «Меркурии»' }); msg = 'ВСД аннулирован в «Меркурии» — гашение невозможно.'; }
    else { updateRow_('VET_DOCUMENTS', cur, { status: pending ? 'UNKNOWN' : 'CONFLICT', error: 'статус в «Меркурии»: ' + ms }); msg = 'Статус ВСД в «Меркурии»: ' + ms + '.'; }
    auditLog_(session.user_id, 'Проверка статуса ВСД', 'VET_DOCUMENTS:' + cur.vsd_id, before, _mrRow_(cur.vsd_id).status + ': ' + msg, 'success', session.cascade_id || '');
    var v = _mrView_(_mrRow_(cur.vsd_id)); v.message = msg; v.retry = v.status === 'READY_TO_CANCEL'; return v;
  });
}

/** Отклонить ВСД в ЦЕХ (неверный документ/отказ от груза). Возврат оформляется в интерфейсе «Меркурия». */
function rejectVsd_(data, session) {
  return withLock_(function () {
    var rec = _mrOwned_(session, data.vsdId);
    if (!String(data.reason || '').trim()) throw new Error('Укажите причину.');
    if (['CANCELLED', 'SENDING', 'UNKNOWN'].indexOf(rec.status) !== -1) throw new Error('ВСД в статусе «' + (MERCURY_STATUS_RU[rec.status] || rec.status) + '» отклонить нельзя.');
    updateRow_('VET_DOCUMENTS', rec, { status: 'REJECTED', error: 'отклонён: ' + data.reason });
    auditLog_(session.user_id, 'ВСД отклонён', 'VET_DOCUMENTS:' + rec.vsd_id, rec.status, 'REJECTED: ' + data.reason, 'success', session.cascade_id || '');
    return _mrView_(rec);
  });
}

/** Сопоставить отправителя ВСД (GUID ХС/площадки) с поставщиком — один раз. */
function mapMercurySupplier_(data, session) {
  return withLock_(function () {
    var s = getSupplierById_(data.supplierId); assertOwnedByOrg_(session, s, 'SUPPLIERS:' + data.supplierId);
    if (!data.beGuid && !data.entGuid) throw new Error('Нет GUID отправителя.');
    insertRow_('MERCURY_SUPPLIER_MAP', { map_id: generateId_('MERCURY_SUPPLIER_MAP'), organization_id: session.organization_id, be_guid: data.beGuid || '', ent_guid: data.entGuid || '', name_in_vsd: data.name || '', supplier_id: s.supplier_id, created_by: session.user_id, created_at: nowIso_() });
    findRows_('VET_DOCUMENTS', function (r) { return r.organization_id === session.organization_id && ((data.beGuid && r.consignor_be === data.beGuid) || (data.entGuid && r.consignor_ent === data.entGuid)); })
      .forEach(function (r) { updateRow_('VET_DOCUMENTS', r, { supplier_id: s.supplier_id }); if (['CANCELLED', 'SENDING', 'UNKNOWN', 'REJECTED'].indexOf(r.status) === -1) _mrRunCheck_(session, r); });
    auditLog_(session.user_id, 'Отправитель ВСД сопоставлен с поставщиком', 'SUPPLIERS:' + s.supplier_id, '', (data.name || '') + ' ' + (data.beGuid || data.entGuid), 'success', session.cascade_id || '');
    return { supplier_id: s.supplier_id };
  });
}

function getVsdList_(data, session) {
  data = data || {};
  return findRows_('VET_DOCUMENTS', function (r) {
    return r.organization_id === session.organization_id && (!data.status || r.status === data.status) && (!data.draftId || r.draft_id === data.draftId) && (!data.batchId || _mrBatches_(r).indexOf(data.batchId) !== -1);
  }).slice(-200).reverse().map(_mrView_);
}

// ---------- приёмка: после проводки ----------

/** Нужен ли ВСД продукту: требование профиля комплаенса или ВСД, уже сопоставленный со строкой. */
function _mrVetRequired_(productId, session) {
  var p = getProductById_(productId); if (!p) return false;
  var g = p.global_product_id && typeof getGlobalProductById_ === 'function' ? getGlobalProductById_(p.global_product_id) : null;
  try { return resolveComplianceRequirements_(session.organization_id, p.категория_id, g ? g.product_type : '').requirements.indexOf('VET_DOCUMENT_REQUIRED') !== -1; } catch (e) { return false; }
}

/**
 * После проводки приёмки: ВСД строк привязываются к созданным партиям; партия ветконтрольного
 * товара без погашенного ВСД удерживается (ОЖИДАЕТ_ВСД). Удержание — только при настроенной интеграции.
 * lines — проведённые строки (порядок как в receiveGoodsBatch_), results — его результаты.
 */
function mercuryAfterReceipt_(draftId, lines, results, session) {
  var cfg = _mrCfg_(session.organization_id, session.location_id), out = { linked: [], held: [] };
  lines.forEach(function (l, idx) {
    var rr = (results || []).filter(function (x) { return x.line === idx; })[0], bid = rr && rr.результат && rr.результат.batch_id;
    if (!bid) return;
    var vsds = findRows_('VET_DOCUMENTS', function (r) { return r.organization_id === session.organization_id && r.draft_id === draftId && Number(r.line_no) === Number(l.line_no) && r.status !== 'REJECTED'; });
    vsds.forEach(function (rec) {
      updateRow_('VET_DOCUMENTS', rec, { batch_ids: _mrBatches_(rec).concat([bid]).join(',') });
      var b = findOne_('BATCHES', 'batch_id', bid); updateRow_('BATCHES', b, { veterinary_document_id: rec.vsd_id });
      _mrRunCheck_(session, rec); out.linked.push({ batch_id: bid, vsd_id: rec.vsd_id });
    });
    if (!cfg.ready) return;
    var need = vsds.length || _mrVetRequired_(l.match.product_id, session), done = vsds.length && vsds.every(function (r) { return r.status === 'CANCELLED'; });
    if (need && !done) { var bb = findOne_('BATCHES', 'batch_id', bid); if (bb && bb.статус === 'активна') { updateRow_('BATCHES', bb, { статус: MERCURY_HOLD_STATUS }); out.held.push(bid); } }
  });
  if (out.held.length) auditLog_(session.user_id, 'Партии ждут гашения ВСД', 'INVOICE_INTAKE_DRAFTS:' + draftId, 'активна', MERCURY_HOLD_STATUS + ': ' + out.held.join(','), 'success', session.cascade_id || '');
  return out;
}

/** Проверка соединения: запрос списка входящих ВСД (1 документ). */
function testMercuryConnection_(session) {
  var cfg = _mrCfg_(session.organization_id, session.location_id);
  if (!cfg.ready) throw _mrErr_('MERCURY_NOT_CONFIGURED', 'не заполнено: ' + cfg.missing.join(', '));
  var res = _mrApply_(session, cfg, 'TEST', '<merc:getVetDocumentListRequest>' + _mrHead_(_mrLoginFor_(cfg, session)) + '<bs:listOptions><bs:count>1</bs:count><bs:offset>0</bs:offset></bs:listOptions><vd:vetDocumentType>INCOMING</vd:vetDocumentType><dt:enterpriseGuid>' + _mrEsc_(cfg.enterprise) + '</dt:enterpriseGuid></merc:getVetDocumentListRequest>', '', null);
  return { ok: res.state === 'COMPLETED', state: res.state, code: res.code, message: res.state === 'COMPLETED' ? 'Соединение работает' : (MERCURY_ERR[res.code] || '') + (res.message ? ': ' + res.message : ''), application_id: res.applicationId };
}

/** Расписание: незавершённые гашения (SENDING/UNKNOWN) проверяются автоматически. */
function mercurySyncPendingTrigger_() {
  var rows = findRows_('VET_DOCUMENTS', function (r) { return (r.status === 'SENDING' || r.status === 'UNKNOWN') && r.uuid; }).slice(0, 10);
  rows.forEach(function (r) {
    if (r.status === 'SENDING' && r.sending_at && Date.now() - new Date(r.sending_at).getTime() < 10 * 60000) return;
    try { syncVsd_({ vsdId: r.vsd_id }, { organization_id: r.organization_id, location_id: r.location_id, user_id: 'SYSTEM:mercury_sync', cascade_id: '' }); }
    catch (e) { if (typeof logSystemError_ === 'function') logSystemError_('mercurySyncPendingTrigger_', null, 'mercury', e, { vsd_id: r.vsd_id }); }
  });
}

function migrateMercurySchema_() {
  var changed = [];
  ['VET_DOCUMENTS', 'MERCURY_EXCHANGE_LOG', 'MERCURY_SUPPLIER_MAP'].forEach(function (k) { changed = changed.concat(ensureSchemaColumns_(k) || []); });
  return { ok: true, changed: changed };
}
