/**
 * MON CHEF — интеграция с ФГИС «Меркурий» (ВетИС.API, Ветеринарная служба РФ): получение, проверка и гашение ВСД
 * при приёмке. Расширяет существующий ветеринарный контур (MonChef_SupplyDocs.gs: лист «ВСД», «Ветконтроль_Продукты»,
 * правило REQUIRES_VET_DOCUMENT во входном контроле) — второй системы приёмки, партий или журнала ВСД нет.
 *
 * Порядок для ветеринарно подконтрольного товара:
 *   накладная → ПОЛУЧИТЬ ВСД (запрос в «Меркурий») → СОПОСТАВИТЬ со строкой накладной → приёмка: партия создаётся
 *   в КАРАНТИНЕ, ВСД привязан к партии → ПРОВЕРИТЬ (поставщик, получатель, продукт, количество, единица, изготовитель,
 *   партия, срок — ВСД против накладной и оригинальной этикетки) → ПОГАСИТЬ ВСД (processIncomingConsignment) →
 *   входной контроль допускает партию только при погашенном ВСД.
 *
 * Обмен (ВетИС.API 2.x, SOAP, асинхронно): submitApplicationRequest → applicationId → receiveApplicationResult
 * (опрос, пока не COMPLETED / REJECTED). Операции: getVetDocumentListRequest, getVetDocumentByUuidRequest,
 * processIncomingConsignmentRequest. Адрес, логин/пароль API, APIKey, issuerId, GUID хозяйствующего субъекта и
 * площадки, логин инициатора — только в свойствах скрипта (PropertiesService), браузеру не отдаются.
 *
 * Правила:
 *   • Статус CANCELLED ставится только по ответу «Меркурия» (заявка COMPLETED или ВСД в статусе UTILIZED).
 *     Если интеграция не настроена — гашение не выполняется и не имитируется.
 *   • Повторного гашения нет: CANCELLED — ответ «уже погашен»; SENDING/UNKNOWN (запрос ушёл, ответ не получен) —
 *     только «Проверить результат»: сначала фактический статус в «Меркурии», затем, если не погашен, — повтор.
 *   • Перед гашением ВСД перечитывается из «Меркурия»: уже погашен там — результат привязывается без запроса.
 *   • Погашено в «Меркурии», а запись в MonChef не завершилась — «Проверить результат» восстанавливает
 *     приёмку (CANCELLED, история партии, прослеживаемость, аудит) без повторного гашения.
 *   • Сотрудник, роль, время — только из серверной сессии. Гасит ответственный за ХАССП (право «vsd_cancel»); другим —
 *     только индивидуальное право, выданное директором (этап 10.7). Технический доступ ВСД не гасит.
 *   • Расхождение по количеству не гасится: частичная приёмка и возврат через API в этой версии не реализованы —
 *     их оформляют в веб-интерфейсе «Меркурия», затем «Проверить статус» подтягивает результат.
 */
var MC_MV_LOG_ = 'Меркурий_Обмен', MC_MV_LOG_HEAD_ = ['Время', 'OperationID', 'Операция', 'VSDID', 'ApplicationID', 'HTTP', 'Статус заявки', 'Код ошибки',
  'Сообщение', 'Ответ (фрагмент)', 'Хеш ответа', 'Сотрудник'];
var MC_MV_SUP_ = 'Меркурий_Поставщики', MC_MV_SUP_HEAD_ = ['GUID ХС отправителя', 'GUID площадки', 'Название в ВСД', 'SupplierID', 'Поставщик', 'Кто', 'Когда'];
var MC_MV_CANCEL_ROLES_ = ['Ответственный за ХАССП'];   // этап 10.7: по роли; Директору, Шефу, Су-шефу — индивидуальное право
// этап 10.7: статусы словами ТЗ §16 (+2 технических: без них обрыв связи мог бы привести к двойному гашению)
var MC_MV_ST_RU_ = { NOT_FOUND: 'Не найдена', FOUND: 'Новая', CHECKING: 'Новая', VALID: 'Принята', CONFLICT: 'Ожидает гашения — расхождение',
  READY_TO_CANCEL: 'Ожидает гашения', SENDING: 'Гашение выполняется', UNKNOWN: 'Результат уточняется', CANCELLED: 'Погашена', REJECTED: 'Отклонена', ERROR: 'Ошибка' };
var MC_MV_ERR_ = {
  MERCURY_NOT_CONFIGURED: ['Интеграция с «Меркурием» не настроена', 'Администратор: «Документы на сырьё» → «ВСД» → «Настройки Меркурия» — адрес, APIKey, логин и пароль API, GUID предприятия'],
  MERCURY_AUTH_ERROR: ['«Меркурий» отклонил учётные данные', 'Проверьте логин и пароль API, APIKey и issuerId в настройках интеграции'],
  MERCURY_TIMEOUT: ['«Меркурий» не ответил вовремя', 'Нажмите «Проверить результат» через несколько минут — повторное гашение без проверки не выполняется'],
  MERCURY_UNAVAILABLE: ['МЕРКУРИЙ НЕДОСТУПЕН', 'Приёмка сохранена, партия остаётся в карантине. Повторите, когда связь восстановится'],
  MERCURY_VSD_NOT_FOUND: ['Ветеринарный документ не найден', 'Проверьте номер/UUID ВСД и что ВСД оформлен на ваше предприятие. Партия не допускается без погашенного ВСД'],
  MERCURY_VSD_ALREADY_CANCELLED: ['ВСД уже погашен', 'Повторное гашение не выполняется — результат привязан к приёмке'],
  MERCURY_PRODUCT_MISMATCH: ['Продукт в ВСД не совпадает с накладной', 'Проверьте товар; если это тот же товар под другим названием — подтвердите сопоставление с причиной'],
  MERCURY_QUANTITY_MISMATCH: ['РАСХОЖДЕНИЕ ПО КОЛИЧЕСТВУ', 'Гашение заблокировано. Исправьте количество в приёмке (если ошиблись при вводе) или оформите частичную приёмку / возврат в «Меркурии», затем «Проверить статус»'],
  MERCURY_SUPPLIER_MISMATCH: ['Отправитель в ВСД не совпадает с поставщиком накладной', 'Сопоставьте отправителя ВСД с поставщиком MonChef (один раз) или проверьте документы'],
  MERCURY_RECEIVER_MISMATCH: ['ВСД оформлен не на ваше предприятие', 'Такой ВСД гасить нельзя — свяжитесь с поставщиком'],
  MERCURY_INVALID_STATUS: ['Статус ВСД в «Меркурии» не позволяет гашение', 'ВСД аннулирован, ещё не оформлен или уже обработан — проверьте его в «Меркурии»'],
  MERCURY_API_ERROR: ['«Меркурий» вернул ошибку', 'Текст и код ошибки сохранены в журнале обмена; исправьте причину и повторите'],
  MERCURY_UNKNOWN_RESULT: ['Результат предыдущего гашения неизвестен', 'Нажмите «Проверить результат»: система узнает фактический статус ВСД в «Меркурии»'],
  MERCURY_LOCAL_INCOMPLETE: ['ВСД погашен в «Меркурии», но запись в MonChef не завершена', 'Нажмите «Восстановить приёмку» — запись завершится без повторного гашения']
};
var MC_MV_NS_ = { soap: 'http://schemas.xmlsoap.org/soap/envelope/', apldef: 'http://api.vetrf.ru/schema/cdm/application/ws-definitions',
  apl: 'http://api.vetrf.ru/schema/cdm/application', merc: 'http://api.vetrf.ru/schema/cdm/mercury/g2b/applications/v2',
  vd: 'http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2', dt: 'http://api.vetrf.ru/schema/cdm/dictionary/v2', bs: 'http://api.vetrf.ru/schema/cdm/base' };
var MC_MV_URLS_ = { prod: 'https://api.vetrf.ru/platform/services/2.1/ApplicationManagementService', test: 'https://api2.vetrf.ru:8002/platform/services/2.1/ApplicationManagementService' };
// единицы измерения справочника ВетИС: GUID → единица MonChef (дополняется свойством MERCURY_UNIT_MAP)
var MC_MV_UNITS_ = { '21ed96c9-337b-4a27-8761-c6e6ad3c9f5b': 'кг' };
var MC_MV_CFG_KEYS_ = ['MERCURY_API_URL', 'MERCURY_LOGIN', 'MERCURY_PASSWORD', 'MERCURY_API_KEY', 'MERCURY_ISSUER_ID', 'MERCURY_ORGANIZATION_ID',
  'MERCURY_ENTERPRISE_ID', 'MERCURY_INITIATOR', 'MERCURY_USER_LOGINS', 'MERCURY_UNIT_MAP', 'MERCURY_SERVICE_ID', 'MERCURY_POLL_TRIES'];
var MC_MV_SECRET_ = { MERCURY_PASSWORD: 1, MERCURY_API_KEY: 1 };

/* ---------------------------------------------------------------- лист ВСД ---- */
function _mvSheet_() {
  var sh = _bcSheet_(MC_SD_VET_, MC_SD_VET_HEAD_);
  if (String(sh.getRange(1, MC_SD_VET_HEAD_.length).getValue() || '') !== MC_SD_VET_HEAD_[MC_SD_VET_HEAD_.length - 1])   // лист этапа 10 — дописать колонки
    sh.getRange(1, 1, 1, MC_SD_VET_HEAD_.length).setValues([MC_SD_VET_HEAD_]);
  return sh;
}
function _mvC_(h) { return MC_SD_VET_HEAD_.indexOf(h); }
function _mvRows_() {
  var v = _mvSheet_().getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) if (v[i][0]) out.push(_mvRec_(v[i], i + 1));
  return out;
}
function _mvRec_(r, row) {
  var o = { _row: row, _raw: r };
  MC_SD_VET_HEAD_.forEach(function (h, j) { o[h] = r[j] === undefined ? '' : r[j]; });
  o.id = String(o.VetID); o.status = String(o.VSDStatus || (o['Статус'] === 'ПОГАШЕН' ? 'CANCELLED' : o['Статус'] === 'АННУЛИРОВАН' ? 'REJECTED' : 'FOUND'));
  o.batches = String(o.BatchID || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  o.data = _mcBlJson_(o['Сырые данные']); o.check = _mcBlJson_(o['Проверка']); o.confirm = _mcBlJson_(o['Подтверждения']);
  return o;
}
function _mvFind_(vsdId) {
  var k = String(vsdId || '').trim(); if (!k) return null;
  var all = _mvRows_();
  return all.filter(function (r) { return r.id === k; })[0] || all.filter(function (r) { return String(r.MercuryUUID) === k; })[0] || null;
}
function _mvSet_(rec, fields) {
  var sh = _mvSheet_();
  Object.keys(fields).forEach(function (k) {
    var c = _mvC_(k); if (c < 0) return;
    var val = fields[k]; if (val && typeof val === 'object' && !(val instanceof Date)) val = JSON.stringify(val);
    if (typeof val === 'string' && val.length > 45000) val = val.slice(0, 45000);
    sh.getRange(rec._row, c + 1).setValue(val === undefined || val === null ? '' : val); rec[k] = val; rec._raw[c] = val;
  });
  if (fields.VSDStatus) rec.status = fields.VSDStatus;
  if (fields.BatchID !== undefined) rec.batches = String(fields.BatchID || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
}
function _mvRu_(st) { return MC_MV_ST_RU_[st] || st || ''; }
function _mvLegacy_(st) { return st === 'CANCELLED' ? 'ПОГАШЕН' : st === 'REJECTED' ? 'АННУЛИРОВАН' : 'ОФОРМЛЕН'; }

/* ------------------------------------------------------------- настройки ---- */
function _mvProps_() { return PropertiesService.getScriptProperties(); }
function _mvCfg_() {
  var p = _mvProps_(), g = function (k) { return String(p.getProperty(k) || '').trim(); }, url = g('MERCURY_API_URL');
  var c = { url: MC_MV_URLS_[url] || url, login: g('MERCURY_LOGIN'), password: g('MERCURY_PASSWORD'), apiKey: g('MERCURY_API_KEY'), issuerId: g('MERCURY_ISSUER_ID') || g('MERCURY_ORGANIZATION_ID'),
    org: g('MERCURY_ORGANIZATION_ID'), enterprise: g('MERCURY_ENTERPRISE_ID'), initiator: g('MERCURY_INITIATOR'), serviceId: g('MERCURY_SERVICE_ID') || 'mercury-g2b.service:2.1',
    tries: Math.max(1, Math.min(40, parseInt(g('MERCURY_POLL_TRIES'), 10) || 12)), users: _mcBlJson_(g('MERCURY_USER_LOGINS')), units: {} };
  Object.keys(MC_MV_UNITS_).forEach(function (k) { c.units[k] = MC_MV_UNITS_[k]; });
  var um = _mcBlJson_(g('MERCURY_UNIT_MAP')); Object.keys(um).forEach(function (k) { c.units[String(k).toLowerCase()] = um[k]; });
  c.missing = [['url', 'адрес сервиса'], ['login', 'логин API'], ['password', 'пароль API'], ['apiKey', 'APIKey'], ['issuerId', 'issuerId / GUID хозяйствующего субъекта'],
    ['enterprise', 'GUID площадки (предприятия)'], ['initiator', 'логин пользователя «Меркурия» (инициатор)']].filter(function (x) { return !c[x[0]]; }).map(function (x) { return x[1]; });
  c.ready = !c.missing.length;
  return c;
}
/** Логин «Меркурия» сотрудника (сопоставление в MERCURY_USER_LOGINS по ID сотрудника или ФИО), иначе — общий инициатор. */
function _mvLoginFor_(cfg, who) { return String(cfg.users[who.id] || cfg.users[who.фио] || cfg.initiator || ''); }

/* ------------------------------------------------------------------- XML ---- */
function _mvEsc_(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]; }); }
function _mvUnesc_(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, function (m, e) {
    var k = e.toLowerCase(); if (k === 'lt') return '<'; if (k === 'gt') return '>'; if (k === 'amp') return '&'; if (k === 'quot') return '"'; if (k === 'apos') return "'";
    return String.fromCharCode(k.charAt(1) === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
  });
}
/** Разбор XML с пространствами имён: узел {p, n, ns, a, c, t}. Без внешних библиотек — одинаково на сервере и в тестах. */
function _mvParse_(s) {
  var root = { n: '#doc', ns: '', p: '', a: {}, c: [], t: '' }, stack = [{ node: root, map: {} }];
  var re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s>\/!?]+)((?:\s+[^\s=\/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g, m;
  s = String(s || '');
  while ((m = re.exec(s))) {
    var top = stack[stack.length - 1];
    if (m[1] !== undefined) { top.node.t += m[1]; continue; }
    if (m[6] !== undefined) { top.node.t += _mvUnesc_(m[6]); continue; }
    if (m[2] !== undefined) { if (stack.length > 1) stack.pop(); continue; }
    if (m[3] === undefined) continue;
    var map = {}; Object.keys(top.map).forEach(function (k) { map[k] = top.map[k]; });
    var attrs = {}, ar = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g, am;
    while ((am = ar.exec(m[4] || ''))) {
      var an = am[1], av = _mvUnesc_(am[3] !== undefined ? am[3] : am[4]);
      if (an === 'xmlns') map[''] = av; else if (an.indexOf('xmlns:') === 0) map[an.slice(6)] = av; else attrs[an] = av;
    }
    var q = m[3], ci = q.indexOf(':'), pf = ci > 0 ? q.slice(0, ci) : '', ln = ci > 0 ? q.slice(ci + 1) : q;
    var node = { n: ln, p: pf, ns: map[pf] || '', a: attrs, c: [], t: '', parent: top.node };
    top.node.c.push(node);
    if (!m[5]) stack.push({ node: node, map: map });
  }
  return root;
}
function _mvKids_(node, name) { return node && node.c ? node.c.filter(function (x) { return !name || x.n === name; }) : []; }
function _mvKid_(node, name) { return _mvKids_(node, name)[0] || null; }
function _mvPath_(node, path) { var cur = node, parts = String(path).split('/'); for (var i = 0; i < parts.length && cur; i++) cur = _mvKid_(cur, parts[i]); return cur; }
function _mvTxt_(node) { return node ? String(node.t || '').trim() : ''; }
function _mvPT_(node, path) { return _mvTxt_(_mvPath_(node, path)); }
function _mvDeep_(node, name) {
  if (!node || !node.c) return null;
  for (var i = 0; i < node.c.length; i++) { if (node.c[i].n === name) return node.c[i]; var d = _mvDeep_(node.c[i], name); if (d) return d; }
  return null;
}
function _mvDeepAll_(node, name, out) { out = out || []; (node && node.c || []).forEach(function (x) { if (x.n === name) out.push(x); else _mvDeepAll_(x, name, out); }); return out; }
/** Узел обратно в XML: префиксы по URI пространства имён запроса, неизвестные — объявляются на корне. */
function _mvSer_(node, ctx) {
  var uri = node.ns || '', pf = ctx.pf[uri];
  if (pf === undefined) { pf = 'n' + (++ctx.n); ctx.pf[uri] = pf; ctx.extra[pf] = uri; }
  var q = pf ? pf + ':' + node.n : node.n, a = '';
  Object.keys(node.a || {}).forEach(function (k) { if (k.indexOf(':') < 0) a += ' ' + k + '="' + _mvEsc_(node.a[k]) + '"'; });
  var inner = node.c.length ? node.c.map(function (x) { return _mvSer_(x, ctx); }).join('') : _mvEsc_(String(node.t || '').trim());
  return '<' + q + a + '>' + inner + '</' + q + '>';
}
function _mvCtx_() { var pf = {}; Object.keys(MC_MV_NS_).forEach(function (k) { pf[MC_MV_NS_[k]] = k; }); return { pf: pf, extra: {}, n: 0 }; }
function _mvEnvelope_(body, ctx) {
  var decl = Object.keys(MC_MV_NS_).map(function (k) { return ' xmlns:' + k + '="' + MC_MV_NS_[k] + '"'; }).join('') +
    Object.keys((ctx && ctx.extra) || {}).map(function (k) { return ' xmlns:' + k + '="' + _mvEsc_(ctx.extra[k]) + '"'; }).join('');
  return '<?xml version="1.0" encoding="UTF-8"?><soap:Envelope' + decl + '><soap:Header/><soap:Body>' + body + '</soap:Body></soap:Envelope>';
}
function _mvIso_(d, withTime) {
  var p = function (n) { return ('0' + n).slice(-2); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + (withTime ? 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) : '');
}
/** Дата ВетИС: firstDate {year, month, day, hour} или xs:date / xs:dateTime. */
function _mvGDate_(node) {
  if (!node) return null;
  var f = _mvKid_(node, 'firstDate') || node, y = _mvPT_(f, 'year');
  if (y) { var d = new Date(Number(y), Number(_mvPT_(f, 'month') || 1) - 1, Number(_mvPT_(f, 'day') || 1), Number(_mvPT_(f, 'hour') || 0)); return isNaN(d.getTime()) ? null : d; }
  var t = _mvTxt_(node); if (!t) return null;
  var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(t);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)) : null;
}

/* --------------------------------------------------------- транспорт SOAP ---- */
function _mvLogSheet_() { return _bcSheet_(MC_MV_LOG_, MC_MV_LOG_HEAD_); }
function _mvLog_(op, kind, vsdId, res) {
  try {
    var raw = String(res.raw || ''), who = _author_(op);
    _mvLogSheet_().appendRow([new Date(), (op && op.id) || '', kind, vsdId || '', res.applicationId || '', res.http || '', res.appStatus || res.state || '',
      res.code || '', String(res.message || '').slice(0, 1000), raw.slice(0, 20000), raw ? _mcBlHash_(raw) : '', who.фио]);
  } catch (e) {}
}
function _mvHttp_(cfg, action, xml) {
  var r = UrlFetchApp.fetch(cfg.url, { method: 'post', contentType: 'text/xml;charset=UTF-8', payload: xml, muteHttpExceptions: true,
    headers: { SOAPAction: action, Authorization: 'Basic ' + Utilities.base64Encode(cfg.login + ':' + cfg.password, Utilities.Charset.UTF_8) } });
  return { http: r.getResponseCode(), raw: String(r.getContentText() || '') };
}
/** Ошибка транспорта/ответа → нормализованный код (MC_MV_ERR_). */
function _mvClassify_(http, text, exc) {
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
function _mvErrors_(app) {
  return _mvDeepAll_(app, 'error').map(function (e) { return { code: String(e.a.code || ''), message: _mvTxt_(e) }; }).filter(function (e) { return e.code || e.message; });
}
/**
 * Заявка в «Меркурий»: отправить и дождаться результата.
 * state: COMPLETED | REJECTED (ошибка по существу) | FAILED (заявка не принята, запрос точно не выполнен) |
 *        UNKNOWN (запрос мог дойти, результат не получен — только проверка статуса).
 */
function _mvApply_(op, cfg, kind, dataXml, vsdId, ctx) {
  var res = { state: 'FAILED', applicationId: '', http: '', raw: '', code: '', message: '', errors: [], result: null };
  var sub = '<apldef:submitApplicationRequest><apldef:apiKey>' + _mvEsc_(cfg.apiKey) + '</apldef:apiKey><apl:application><apl:serviceId>' + _mvEsc_(cfg.serviceId) +
    '</apl:serviceId><apl:issuerId>' + _mvEsc_(cfg.issuerId) + '</apl:issuerId><apl:issueDate>' + _mvIso_(new Date(), true) + '</apl:issueDate><apl:data>' + dataXml + '</apl:data></apl:application></apldef:submitApplicationRequest>';
  try {
    var h = _mvHttp_(cfg, 'submitApplicationRequest', _mvEnvelope_(sub, ctx));
    res.http = h.http; res.raw = h.raw;
    var doc = _mvParse_(h.raw), app = _mvDeep_(doc, 'application'), fault = _mvDeep_(doc, 'Fault');
    if (h.http !== 200 || fault || !app) {
      res.message = fault ? _mvPT_(fault, 'faultstring') || _mvTxt_(_mvDeep_(fault, 'message')) : 'HTTP ' + h.http;
      res.code = _mvClassify_(h.http, res.message + ' ' + h.raw.slice(0, 500));
      res.state = res.code === 'MERCURY_TIMEOUT' && kind === 'CANCEL' ? 'UNKNOWN' : 'FAILED';
      _mvLog_(op, kind, vsdId, res); return res;
    }
    res.applicationId = _mvPT_(app, 'applicationId'); res.appStatus = _mvPT_(app, 'status');
    if (res.appStatus === 'REJECTED' || !res.applicationId) { res.errors = _mvErrors_(app); res.message = res.errors.map(function (e) { return (e.code ? e.code + ': ' : '') + e.message; }).join('; ') || 'заявка не принята';
      res.code = _mvClassify_(200, res.message); res.state = 'REJECTED'; _mvLog_(op, kind, vsdId, res); return res; }
  } catch (e) {
    res.code = _mvClassify_(0, '', e && e.message || e); res.message = String(e && e.message || e);
    res.state = kind === 'CANCEL' ? 'UNKNOWN' : 'FAILED';                         // запрос на гашение мог уйти — не повторять вслепую
    _mvLog_(op, kind, vsdId, res); return res;
  }
  _mvLog_(op, kind + '_SUBMIT', vsdId, res);
  return _mvPoll_(op, cfg, kind, res.applicationId, vsdId, cfg.tries);
}
/** Опрос результата заявки (receiveApplicationResult). */
function _mvPoll_(op, cfg, kind, applicationId, vsdId, tries) {
  var res = { state: 'UNKNOWN', applicationId: applicationId, http: '', raw: '', code: 'MERCURY_TIMEOUT', message: 'заявка в обработке', errors: [], result: null };
  var req = _mvEnvelope_('<apldef:receiveApplicationResultRequest><apldef:apiKey>' + _mvEsc_(cfg.apiKey) + '</apldef:apiKey><apldef:issuerId>' + _mvEsc_(cfg.issuerId) +
    '</apldef:issuerId><apldef:applicationId>' + _mvEsc_(applicationId) + '</apldef:applicationId></apldef:receiveApplicationResultRequest>');
  for (var i = 0; i < tries; i++) {
    Utilities.sleep(i === 0 ? 1500 : 2000);
    try {
      var h = _mvHttp_(cfg, 'receiveApplicationResult', req); res.http = h.http; res.raw = h.raw;
      var doc = _mvParse_(h.raw), app = _mvDeep_(doc, 'application'), st = app ? _mvPT_(app, 'status') : '';
      if (h.http !== 200 || !app) { res.code = _mvClassify_(h.http, h.raw.slice(0, 500)); res.message = 'HTTP ' + h.http; if (res.code === 'MERCURY_AUTH_ERROR') break; continue; }
      res.appStatus = st;
      if (st === 'COMPLETED') { res.state = 'COMPLETED'; res.code = ''; res.message = ''; res.result = _mvKid_(app, 'result'); break; }
      if (st === 'REJECTED') { res.state = 'REJECTED'; res.errors = _mvErrors_(app); res.message = res.errors.map(function (e) { return (e.code ? e.code + ': ' : '') + e.message; }).join('; ') || 'заявка отклонена'; res.code = _mvClassify_(200, res.message); break; }
    } catch (e) { res.code = _mvClassify_(0, '', e && e.message || e); res.message = String(e && e.message || e); }
  }
  if (res.state === 'UNKNOWN' && !res.message) res.message = 'результат заявки не получен';
  _mvLog_(op, kind, vsdId, res);
  return res;
}
function _mvHead_(cfg, login) { return '<merc:localTransactionId>MC-' + Utilities.getUuid().slice(0, 18) + '</merc:localTransactionId><merc:initiator><vd:login>' + _mvEsc_(login) + '</vd:login></merc:initiator>'; }

/* ------------------------------------------------------- данные ВСД ---- */
/** vd:vetDocument → понятный объект (всё, что пришло, плюс исходный узел для запроса гашения). */
function _mvNorm_(vd) {
  var cc = _mvKid_(vd, 'certifiedConsignment') || {}, bt = _mvKid_(cc, 'batch') || {}, org = _mvKid_(bt, 'origin');
  var refs = _mvKids_(vd, 'referencedDocument').map(function (r) { return { series: _mvPT_(r, 'issueSeries'), number: _mvPT_(r, 'issueNumber'), date: _mvPT_(r, 'issueDate'), type: _mvPT_(r, 'type') }; });
  var way = refs.filter(function (r) { return r.type === '1' || r.type === '5'; })[0] || refs[0] || null;
  var hist = _mvKids_(vd, 'statusChange').map(function (s) { return { status: _mvPT_(s, 'status'), fio: _mvPT_(s, 'specifiedPerson/fio'), at: _mvPT_(s, 'actualDateTime') }; });
  var unitG = _mvPT_(bt, 'unit/guid'), unitN = _mvPT_(bt, 'unit/name');
  var o = {
    uuid: _mvPT_(vd, 'uuid'), series: _mvPT_(vd, 'issueSeries'), number: _mvPT_(vd, 'issueNumber'), issueDate: _mvPT_(vd, 'issueDate'),
    form: _mvPT_(vd, 'vetDForm'), type: _mvPT_(vd, 'vetDType'), status: _mvPT_(vd, 'vetDStatus'), lastUpdate: _mvPT_(vd, 'lastUpdateDate'),
    consignorBE: _mvPT_(cc, 'consignor/businessEntity/guid'), consignorEnt: _mvPT_(cc, 'consignor/enterprise/guid'),
    consignorName: _mvPT_(cc, 'consignor/enterprise/name') || _mvPT_(cc, 'consignor/businessEntity/name'),
    consigneeBE: _mvPT_(cc, 'consignee/businessEntity/guid'), consigneeEnt: _mvPT_(cc, 'consignee/enterprise/guid'),
    consigneeName: _mvPT_(cc, 'consignee/enterprise/name') || _mvPT_(cc, 'consignee/businessEntity/name'),
    product: _mvPT_(bt, 'productItem/name') || _mvPT_(bt, 'subProduct/name') || _mvPT_(bt, 'product/name'), productGuid: _mvPT_(bt, 'product/guid'), subProductGuid: _mvPT_(bt, 'subProduct/guid'),
    productItemGuid: _mvPT_(bt, 'productItem/guid'), volume: parseFloat(_mvPT_(bt, 'volume')), unitGuid: unitG, unitName: unitN,
    production: _mvGDate_(_mvKid_(bt, 'dateOfProduction')), expiry: _mvGDate_(_mvKid_(bt, 'expiryDate')),
    batchIds: _mvKids_(bt, 'batchID').map(_mvTxt_).filter(Boolean), perishable: _mvPT_(bt, 'perishable'),
    country: org ? (_mvPT_(org, 'country/name') || _mvPT_(org, 'country/guid')) : '',
    producers: org ? _mvKids_(org, 'producer').map(function (p) { return _mvPT_(p, 'enterprise/name') || _mvPT_(p, 'enterprise/guid'); }).filter(Boolean) : [],
    waybill: way, refs: refs, history: hist
  };
  o.numberText = (o.series ? o.series + ' ' : '') + (o.number || '') || ('UUID ' + o.uuid.slice(0, 8));
  var u = hist.filter(function (h) { return h.status === 'UTILIZED'; }).pop();
  o.utilizedAt = u ? u.at : ''; o.utilizedBy = u ? u.fio : '';
  return o;
}
function _mvUnit_(cfg, guid, name) {
  var u = cfg.units[String(guid || '').toLowerCase()] || cfg.units[guid] || '';
  if (!u) { var n = String(name || '').toLowerCase().replace(/\./g, '').trim();
    u = /^(кг|килограмм)/.test(n) ? 'кг' : /^(т|тонн)/.test(n) ? 'т' : /^(г|грамм)$/.test(n) ? 'г' : /^(шт|штук)/.test(n) ? 'шт' : /^(л|литр)/.test(n) ? 'л' : ''; }
  return u;
}
/** Количество в сравнимой единице: масса — в кг, остальное как есть. */
function _mvQty_(q, unit) { q = Number(q); unit = String(unit || ''); return unit === 'г' ? { q: q / 1000, u: 'кг' } : unit === 'т' ? { q: q * 1000, u: 'кг' } : unit === 'мл' ? { q: q / 1000, u: 'л' } : { q: q, u: unit }; }
function _mvDay_(d) { return d ? _mvIso_(d, false) : ''; }

/** Запись/обновление ВСД из ответа «Меркурия» (ключ — UUID). */
function _mvUpsert_(op, vd, extra) {
  var n = _mvNorm_(vd), ctx = _mvCtx_(), cfg = _mvCfg_(), rec = _mvFind_(n.uuid), now = new Date(), who = _author_(op), unit = _mvUnit_(cfg, n.unitGuid, n.unitName);
  var xml = _mvSer_(vd, ctx), stored = { norm: n, xml: xml.length < 30000 ? xml : '', ns: ctx.extra };
  var mst = n.status, st = mst === 'UTILIZED' ? 'CANCELLED' : mst === 'WITHDRAWN' ? 'REJECTED' : null;
  var sup = _mvSupplierFor_(n.consignorBE, n.consignorEnt);
  var f = { 'Номер ВСД': n.numberText, 'Продукт': n.product, 'SupplierID': sup ? sup.id : '', 'Поставщик': sup ? sup.name : (n.consignorName || ''),
    MercuryUUID: n.uuid, MercuryDocumentID: n.uuid, 'Дата оформления': n.issueDate, 'Продукт ВСД': n.product, 'Изготовитель': n.producers.join('; '), 'Страна': n.country,
    'Кол-во': isFinite(n.volume) ? n.volume : '', 'Ед.': unit || n.unitName || n.unitGuid, 'Партия изготовителя': n.batchIds.join(', '), 'Дата выработки': n.production || '',
    'Годен до': n.expiry || '', 'Откуда': n.consignorName || n.consignorEnt, 'Куда': n.consigneeName || n.consigneeEnt, 'GUID отправителя ХС': n.consignorBE,
    'GUID отправителя площадки': n.consignorEnt, 'GUID получателя площадки': n.consigneeEnt, 'Статус в Меркурии': mst, 'Сырые данные': stored, 'Обновлено': now, 'Источник': 'MERCURY' };
  var isNew = !rec;
  if (!rec) {
    var id = 'VSD-' + _mcBlYmd_(now) + '-' + Utilities.getUuid().slice(0, 8), row = [];
    for (var k = 0; k < MC_SD_VET_HEAD_.length; k++) row.push('');
    row[0] = id; row[_mvC_('Статус')] = _mvLegacy_(st || 'FOUND'); row[_mvC_('VSDStatus')] = st || 'FOUND'; row[_mvC_('Кто')] = who.фио; row[_mvC_('Когда')] = now;
    row[_mvC_('OperationID')] = (op && op.id) || ''; row[_mvC_('Ключ')] = n.uuid;
    var sh = _mvSheet_(); sh.appendRow(row); rec = _mvRec_(row, sh.getLastRow());
  } else if (st === 'REJECTED' && rec.status !== 'CANCELLED') { f.VSDStatus = 'REJECTED'; f['Статус'] = 'АННУЛИРОВАН'; f['Ошибка'] = 'ВСД аннулирован в «Меркурии»'; }
  if (st === 'CANCELLED' && !rec.batches.length && (isNew || !/^(CANCELLED|SENDING|UNKNOWN)$/.test(rec.status))) { f.VSDStatus = 'CANCELLED'; f['Статус'] = 'ПОГАШЕН';
    f['Погашено'] = n.utilizedAt ? _mcBlDate_(n.utilizedAt) || n.utilizedAt : ''; f['Дата гашения'] = f['Погашено']; f['Погасил'] = n.utilizedBy ? n.utilizedBy + ' (в «Меркурии», вне MonChef)' : 'вне MonChef (по данным «Меркурия»)';
    f['Результат гашения'] = 'погашен ранее, вне MonChef (по данным «Меркурия»)'; }
  Object.keys(extra || {}).forEach(function (k) { f[k] = extra[k]; });
  _mvSet_(rec, f);
  rec.norm = n; rec.data = stored;
  return rec;
}
function _mvVdOf_(rec) {
  var d = rec.data || {}; if (!d.xml) return null;
  var decl = Object.keys(d.ns || {}).map(function (k) { return ' xmlns:' + k + '="' + _mvEsc_(d.ns[k]) + '"'; }).join('');
  var nsDecl = Object.keys(MC_MV_NS_).map(function (k) { return ' xmlns:' + k + '="' + MC_MV_NS_[k] + '"'; }).join('');
  return _mvDeep_(_mvParse_('<w' + nsDecl + decl + '>' + d.xml + '</w>'), 'vetDocument');
}

/* --------------------------------------------- поставщики: GUID ↔ SupplierID ---- */
function _mvSupplierFor_(beGuid, entGuid) {
  if (!beGuid && !entGuid) return null;
  var v = _bcSheet_(MC_MV_SUP_, MC_MV_SUP_HEAD_).getDataRange().getValues(), hit = null;
  for (var i = 1; i < v.length; i++) if ((beGuid && String(v[i][0]) === beGuid) || (entGuid && String(v[i][1]) === entGuid)) hit = { id: String(v[i][3]), name: String(v[i][4]) };
  return hit && hit.id ? hit : null;
}

/* ------------------------------------------------------------- проверка ---- */
/** Данные приёмки для сверки: из партий (паспорт) или из строки накладной до сохранения. */
function _mvLocalFromBatches_(ids) {
  var C = MC_RCV_C_, out = { supplierId: '', supplier: '', product: '', qty: 0, unit: '', manufacturer: '', mfrBatch: [], expiry: null, expirySrc: '', batches: ids.slice(), docNo: '', docId: '' };
  ids.forEach(function (bid) {
    var p = _mcBlPass_(bid), b = _bcFind_(bid); if (!p && !b) return;
    var pv = function (k) { return p ? p.v[C[k]] : ''; };
    out.supplierId = out.supplierId || String(pv('SupplierID') || (b ? b.v[18] : '') || ''); out.supplier = out.supplier || String(pv('Поставщик') || '');
    out.product = out.product || String(pv('Продукт') || (b ? b.v[1] : ''));
    var q = _mvQty_(_mcBlNum_(pv('Кол-во')), String(pv('Ед.') || '')); out.qty += q.q; out.unit = out.unit || q.u;
    out.manufacturer = out.manufacturer || String(pv('Изготовитель') || ''); if (pv('Партия изготовителя')) out.mfrBatch.push(String(pv('Партия изготовителя')));
    var src = String(pv('Источник срока') || ''), e = _mcBlDate_(pv('Срок производителя')) || (src === 'MANUAL' ? _mcBlDate_(pv('Годен до')) : null);
    if (e && !out.expiry) { out.expiry = e; out.expirySrc = pv('Срок производителя') ? 'этикетка' : 'введено при приёмке'; }
    out.docNo = out.docNo || String(pv('Накладная') || ''); out.docId = out.docId || String(pv('DocumentID накладной') || '');
  });
  out.qty = Math.round(out.qty * 1000000) / 1000000;
  return out;
}
function _mvLocalFromLine_(line, supplier) {
  var sup = supplier ? _mdResolveSupplier_(supplier, false) : null, q = _mvQty_(parseFloat(line.qty) || 0, _mcRcvUnit_(line.unit));
  var lab = line.label || {}, e = line.expiry ? _parseDate_(line.expiry) : lab.expiration_date ? _parseDate_(lab.expiration_date) : null;
  return { supplierId: sup ? sup.id : '', supplier: sup ? sup.name : String(supplier || ''), product: String(line.name || ''), qty: q.q, unit: q.u, manufacturer: String(lab.manufacturer || line.manufacturer || ''),
    mfrBatch: lab.supplier_batch ? [String(lab.supplier_batch)] : [], expiry: e || null, expirySrc: line.expiry ? 'введено при приёмке' : lab.expiration_date ? 'этикетка' : '', batches: [], docNo: '', docId: '' };
}
function _mvNormBatch_(s) { return String(s || '').toUpperCase().replace(/[\s\-–—_.\/№#]/g, ''); }
/**
 * Сверка ВСД с приёмкой. hard — гашение заблокировано (исправить данные); soft — нужно подтверждение человека с причиной.
 * Возвращает { checks:[{key,label,ok,vsd,local,msg,hard,code}], status, blocked, summary }.
 */
function _mvCheck_(n, unit, local, cfg, confirm) {
  confirm = confirm || {};
  var checks = [], add = function (key, label, ok, vsd, loc, msg, sev, code) {
    var conf = !ok && sev === 'soft' && confirm[key] && confirm[key].reason;
    checks.push({ key: key, label: label, ok: !!ok || !!conf, confirmed: !!conf, confirmReason: conf ? confirm[key].reason : '', vsd: vsd, local: loc, msg: ok ? '' : msg, hard: !ok && sev === 'hard', soft: !ok && sev === 'soft' && !conf, code: code || '' });
  };
  var map = _mvSupplierFor_(n.consignorBE, n.consignorEnt);
  if (!map) add('supplier', 'Поставщик', false, n.consignorName || n.consignorBE || '—', local.supplier || local.supplierId || '—', 'отправитель ВСД не сопоставлен с поставщиком MonChef — сопоставьте один раз', 'hard', 'MERCURY_SUPPLIER_MISMATCH');
  else add('supplier', 'Поставщик', !local.supplierId || map.id === local.supplierId, map.name, local.supplier || local.supplierId, 'в ВСД — «' + map.name + '», в накладной — «' + (local.supplier || local.supplierId) + '»', 'hard', 'MERCURY_SUPPLIER_MISMATCH');
  add('receiver', 'Получатель', !!cfg.enterprise && n.consigneeEnt === cfg.enterprise, n.consigneeName || n.consigneeEnt || '—', cfg.enterprise ? 'ваше предприятие' : 'GUID предприятия не задан',
    cfg.enterprise ? 'ВСД оформлен на другую площадку (' + (n.consigneeName || n.consigneeEnt || '—') + ')' : 'в настройках не задан GUID вашей площадки', 'hard', 'MERCURY_RECEIVER_MISMATCH');
  var ps = n.product && local.product ? _mcRcvNameScore_(n.product, local.product) : 0;
  add('product', 'Продукт', ps >= 0.5, n.product || '—', local.product || '—', 'названия не совпадают', 'soft', 'MERCURY_PRODUCT_MISMATCH');
  var vu = _mvQty_(n.volume, unit);
  add('unit', 'Единица измерения', !!unit && (!local.unit || vu.u === local.unit), unit || (n.unitName || n.unitGuid || '—'), local.unit || '—',
    unit ? 'в ВСД — ' + unit + ', в приёмке — ' + local.unit : 'единица ВСД не распознана (' + (n.unitName || n.unitGuid) + ') — добавьте её в MERCURY_UNIT_MAP', 'hard', 'MERCURY_QUANTITY_MISMATCH');
  var qOk = isFinite(vu.q) && local.qty > 0 && vu.u === local.unit && Math.abs(vu.q - local.qty) <= Math.max(0.001, vu.q * 0.005), dq = Math.round((local.qty - vu.q) * 1000) / 1000;
  add('qty', 'Количество', qOk, (isFinite(vu.q) ? vu.q : '—') + ' ' + (vu.u || ''), local.qty + ' ' + (local.unit || ''),
    'ВСД: ' + vu.q + ' ' + vu.u + ' · фактически: ' + local.qty + ' ' + local.unit + ' · разница: ' + (dq > 0 ? '+' : '') + dq + ' ' + (vu.u || ''), 'hard', 'MERCURY_QUANTITY_MISMATCH');
  if (n.producers.length && local.manufacturer) {
    var best = Math.max.apply(null, n.producers.map(function (p) { return _mcRcvNameScore_(p, local.manufacturer); }));
    add('producer', 'Изготовитель', best >= 0.34, n.producers.join('; '), local.manufacturer, 'изготовитель в ВСД и на этикетке различается', 'soft', 'MERCURY_PRODUCT_MISMATCH');
  } else add('producer', 'Изготовитель', true, n.producers.join('; ') || 'нет в ВСД', local.manufacturer || 'нет на этикетке', '', 'soft');
  if (n.batchIds.length && local.mfrBatch.length) {
    var nb = n.batchIds.map(_mvNormBatch_), okB = local.mfrBatch.every(function (b) { return nb.indexOf(_mvNormBatch_(b)) >= 0; });
    add('batch', 'Партия изготовителя', okB, n.batchIds.join(', '), local.mfrBatch.join(', '), 'номер партии в ВСД и на этикетке различается', 'hard', 'MERCURY_PRODUCT_MISMATCH');
  } else add('batch', 'Партия изготовителя', true, n.batchIds.join(', ') || 'нет в ВСД', local.mfrBatch.join(', ') || 'нет на этикетке', '', 'hard');
  if (n.expiry && local.expiry) add('expiry', 'Срок годности', _mvDay_(n.expiry) === _mvDay_(local.expiry), _mcRcvFmt_(n.expiry), _mcRcvFmt_(local.expiry) + ' (' + local.expirySrc + ')', 'срок в ВСД и на этикетке различается', 'hard', 'MERCURY_PRODUCT_MISMATCH');
  else add('expiry', 'Срок годности', true, n.expiry ? _mcRcvFmt_(n.expiry) : 'нет в ВСД', local.expiry ? _mcRcvFmt_(local.expiry) : 'нет на этикетке', '', 'hard');
  var hard = checks.filter(function (c) { return c.hard; }), soft = checks.filter(function (c) { return c.soft; });
  return { checks: checks, blocked: hard.length > 0, needConfirm: soft.length > 0, codes: hard.concat(soft).map(function (c) { return c.code; }).filter(Boolean),
    summary: hard.length ? 'ПРИЁМКА ЗАБЛОКИРОВАНА: ' + hard.map(function (c) { return c.label + ' — ' + c.msg; }).join('; ') : soft.length ? 'Нужно подтверждение: ' + soft.map(function (c) { return c.label + ' — ' + c.msg; }).join('; ') : 'Совпадает' };
}
function _mvStatusAfterCheck_(rec, chk) {
  if (rec.status === 'CANCELLED' || rec.status === 'SENDING' || rec.status === 'UNKNOWN' || rec.status === 'REJECTED') return rec.status;
  if (String(rec['Статус в Меркурии']) && String(rec['Статус в Меркурии']) !== 'CONFIRMED') return 'CONFLICT';
  return chk.blocked || chk.needConfirm ? 'CONFLICT' : rec.batches.length ? 'READY_TO_CANCEL' : 'VALID';
}
function _mvRunCheck_(op, rec) {
  var n = (rec.data && rec.data.norm) || null; if (!n) return null;
  n.expiry = _mcBlDate_(n.expiry); n.production = _mcBlDate_(n.production);
  var cfg = _mvCfg_(), unit = _mvUnit_(cfg, n.unitGuid, n.unitName), local = _mvLocalFromBatches_(rec.batches);
  var chk = _mvCheck_(n, unit, local, cfg, rec.confirm);
  var ms = String(rec['Статус в Меркурии'] || '');
  if (ms && ms !== 'CONFIRMED' && ms !== 'UTILIZED') { chk.blocked = true; chk.codes.push('MERCURY_INVALID_STATUS'); chk.summary = 'ПРИЁМКА ЗАБЛОКИРОВАНА: статус ВСД в «Меркурии» — ' + ms + (chk.summary !== 'Совпадает' ? '; ' + chk.summary : ''); }
  if (!rec.batches.length) chk.summary += ' · ВСД ещё не привязан к партии';
  var who = _author_(op), st = _mvStatusAfterCheck_(rec, chk);
  _mvSet_(rec, { VSDStatus: st, 'Статус': _mvLegacy_(st), 'Проверка': { at: new Date(), by: who.фио, checks: chk.checks, summary: chk.summary, codes: chk.codes }, 'Проверено': new Date(), 'Проверил': who.фио });
  chk.status = st; chk.local = local;
  return chk;
}

/* ------------------------------------------------- привязка к приёмке ---- */
/** ВСД ↔ партии приёмки (вызывается из stockReceiveSave и из карточки партии). */
function _mvLink_(op, rec, batchIds, info) {
  info = info || {};
  var have = rec.batches.filter(function (b) { return batchIds.indexOf(b) < 0; });
  if (have.length) throw new Error('VALIDATION: ВСД ' + rec['Номер ВСД'] + ' уже привязан к партии ' + have.join(', ') + ' — приёмка по нему уже завершена');
  if (rec.status === 'REJECTED') throw new Error('VALIDATION: ВСД ' + rec['Номер ВСД'] + ' отклонён/аннулирован — привязать нельзя');
  var local = _mvLocalFromBatches_(batchIds), who = _author_(op), now = new Date();
  _mvSet_(rec, { BatchID: batchIds.join(','), 'Приход (накладная)': info.docNo || local.docNo, ReceivingDocumentID: info.docId || local.docId, 'Накладная №': info.docNo || local.docNo,
    'Дата доставки': info.at || now, ProductID: (function () { var b = _bcFind_(batchIds[0]); return b ? String(b.v[17] || '') : ''; })(), DocumentID: info.docId || local.docId, 'Кто': who.фио, 'Когда': now });
  var chk0 = _mvRunCheck_(op, rec);
  batchIds.forEach(function (bid) {
    _mcBlEvent_(op, bid, 'VSD_LINKED', { doc: rec.id, reason: 'ВСД ' + rec['Номер ВСД'] + ' — ' + _mvRu_(rec.status) + (chk0 ? ': ' + chk0.summary : ''), after: { vsd: rec.id, uuid: rec.MercuryUUID, status: rec.status } });
    _mcCreateTraceLink_('VSD', rec.id, 'ВСД_ПАРТИИ', 'BATCH', bid, { actor: who.фио, source: 'MERCURY', weight: rec['Кол-во'], unit: rec['Ед.'] });
  });
  if (info.docId || local.docId) _mcCreateTraceLink_('SUPPLIER_DOCUMENT', info.docId || local.docId, 'ВСД_НАКЛАДНОЙ', 'VSD', rec.id, { actor: who.фио, source: 'MERCURY' });
  if (rec.status === 'CANCELLED') {     // погашен ранее (вне MonChef): результат «Меркурия» привязывается к приёмке без повторного гашения
    batchIds.forEach(function (bid) {
      _mcBlEvent_(op, bid, 'VSD_CANCELLED', { doc: rec.id, qty: rec['Кол-во'], unit: rec['Ед.'], reason: 'ВСД ' + rec['Номер ВСД'] + ' погашен ранее, вне MonChef — привязан без повторного гашения' });
      _mcCreateTraceLink_('VSD', rec.id, 'ВСД_ПОГАШЕН', 'BATCH', bid, { actor: String(rec['Погасил'] || ''), source: 'MERCURY', weight: rec['Кол-во'], unit: rec['Ед.'] });
    });
    _audit_(op, 'VSD_CANCEL', 'ВСД', rec['Номер ВСД'], { status: 'CANCELLED' }, _mvAuditBody_(op, rec, { before: 'CANCELLED', after: 'CANCELLED', result: 'ALREADY_CANCELLED_LINKED' }));
  }
  var chk = chk0;
  batchIds.forEach(function (bid) { _mvPassport_(bid, rec); });
  if (rec.status === 'CANCELLED') _vtReleaseHeld_(op, rec);   // этап 10.7: партия ждала только ВСД — допускается
  _vtRefreshBatches_(batchIds, op);                            // уведомление «Непогашенная накладная»
  return chk;
}
/** Колонки ВСД в журнале приёмки (паспорт партии). */
function _mvPassport_(bid, rec) {
  try {
    var p = _mcBlPass_(bid); if (!p) return;
    _mcBlPassSet_(p, { 'ВСД': /^UUID /.test(String(rec['Номер ВСД'])) && rec.MercuryUUID ? 'UUID ' + rec.MercuryUUID : rec['Номер ВСД'] + (rec.MercuryUUID ? ' · UUID ' + rec.MercuryUUID : ''), 'VSDID': rec.id, 'Статус ВСД': _mvRu_(rec.status),
      'Дата гашения ВСД': rec.status === 'CANCELLED' ? rec['Погашено'] || '' : '', 'Погасил ВСД': rec.status === 'CANCELLED' ? rec['Погасил'] || '' : '' });
  } catch (e) {}
}

/* ----------------------------------------------------- гашение: итог ---- */
/** ВСД погашен (ответ «Меркурия» или его фактический статус) — запись в MonChef. Повторно ничего не делает. */
function _mvFinalize_(op, rec, info) {
  if (rec.status === 'CANCELLED' && rec['Результат гашения']) return rec;
  var who = _author_(op), now = new Date(), at = info.at || now, by = info.by || who.фио;
  _mvSet_(rec, { VSDStatus: 'CANCELLED', 'Статус': 'ПОГАШЕН', 'Статус в Меркурии': 'UTILIZED', 'Погашено': at, 'Дата гашения': at, 'Погасил': by,
    'Результат гашения': info.result || 'погашен через интеграцию («Меркурий»: заявка выполнена)', StockEntry: info.stockEntry || rec.StockEntry || '',
    'Ответ Меркурия': info.raw ? String(info.raw).slice(0, 20000) : rec['Ответ Меркурия'], ApplicationID: info.applicationId || rec.ApplicationID, 'Ошибка': '', 'Обновлено': now });
  rec.batches.forEach(function (bid) {
    _mvPassport_(bid, rec);
    _mcBlEvent_(op, bid, 'VSD_CANCELLED', { doc: rec.id, qty: rec['Кол-во'], unit: rec['Ед.'], reason: 'ВСД ' + rec['Номер ВСД'] + ' погашен' + (info.recovered ? ' (восстановлено по статусу «Меркурия», без повторного гашения)' : ''),
      after: { vsd: rec.id, uuid: rec.MercuryUUID, applicationId: info.applicationId || '', stockEntry: info.stockEntry || '' } });
    _mcCreateTraceLink_('VSD', rec.id, 'ВСД_ПОГАШЕН', 'BATCH', bid, { actor: by, source: 'MERCURY', weight: rec['Кол-во'], unit: rec['Ед.'] });
  });
  var b0 = rec.batches[0] ? _bcFind_(rec.batches[0]) : null;
  var released = _vtReleaseHeld_(op, rec);   // этап 10.7: входной контроль повара пройден, ждали только ВСД — партия допускается
  b0 = rec.batches[0] ? _bcFind_(rec.batches[0]) : null;
  _audit_(op, info.recovered ? 'VSD_CANCEL_RECOVERED' : 'VSD_CANCEL', 'ВСД', rec['Номер ВСД'], { status: info.before || '' }, _mvAuditBody_(op, rec, {
    before: info.before || '', after: 'CANCELLED', result: info.recovered ? 'RECOVERED' : info.external ? 'ALREADY_CANCELLED' : 'SUCCESS', mercury: info.raw, applicationId: info.applicationId, stockEntry: info.stockEntry, batchStatus: b0 ? b0.v[10] : '', released: released }));
  _vtRefreshBatches_(rec.batches, op);        // «Непогашенная накладная» → «Выполнено», когда погашены все ВСД накладной
  return rec;
}
function _mvAuditBody_(op, rec, x) {
  var who = _author_(op);
  return { OperationID: (op && op.id) || '', VSDID: rec.id, VSDNumber: rec['Номер ВСД'], MercuryUUID: rec.MercuryUUID, BatchID: rec.batches.join(','), EmployeeID: who.id, EmployeeName: who.фио,
    Role: who.роль, DateTime: _mvIso_(new Date(), true), BeforeState: x.before || '', AfterState: x.after || rec.status, Quantity: rec['Кол-во'] + ' ' + rec['Ед.'], Supplier: rec['Поставщик'] || rec.SupplierID,
    SupplierID: rec.SupplierID, Product: rec['Продукт ВСД'] || rec['Продукт'], Result: x.result || '', ApplicationID: x.applicationId || rec.ApplicationID || '', StockEntry: x.stockEntry || '',
    BatchStatus: x.batchStatus || '', MercuryResponse: String(x.mercury || '').slice(0, 3000), ErrorCode: x.code || '', ErrorMessage: x.message || '' };
}
function _mvCanCancel_(s) { return !!s && !s.dev && _mcRbHasExact_(s, 'vsd_cancel'); }
function _mvErrOut_(code, extra, opId) {
  var e = MC_MV_ERR_[code] || MC_MV_ERR_.MERCURY_API_ERROR;
  return JSON.stringify({ success: false, error: { code: code, message: e[0] + (extra ? ': ' + extra : ''), fix: e[1], operation_id: opId || null } });
}
function _mvView_(rec) {
  if (!rec) return null;
  var d = function (x) { var t = _mcBlDate_(x); return t ? _mcRcvFmt_(t, /[T:]/.test(String(x)) || x instanceof Date) : String(x || ''); };
  return { id: rec.id, number: String(rec['Номер ВСД'] || ''), uuid: String(rec.MercuryUUID || ''), status: rec.status, statusRu: _mvRu_(rec.status), mercuryStatus: String(rec['Статус в Меркурии'] || ''),
    issueDate: d(rec['Дата оформления']), supplier: String(rec['Поставщик'] || rec.SupplierID || rec['Откуда'] || ''), supplierId: String(rec.SupplierID || ''), product: String(rec['Продукт ВСД'] || rec['Продукт'] || ''),
    qty: rec['Кол-во'], unit: String(rec['Ед.'] || ''), producer: String(rec['Изготовитель'] || ''), country: String(rec['Страна'] || ''), mfrBatch: String(rec['Партия изготовителя'] || ''),
    production: d(rec['Дата выработки']), expiry: d(rec['Годен до']), from: String(rec['Откуда'] || ''), to: String(rec['Куда'] || ''), batches: rec.batches, invoice: String(rec['Накладная №'] || rec['Приход (накладная)'] || ''),
    receivingDocumentId: String(rec.ReceivingDocumentID || ''), checkedAt: d(rec['Проверено']), checkedBy: String(rec['Проверил'] || ''), cancelledAt: rec.status === 'CANCELLED' ? d(rec['Погашено'] || rec['Дата гашения']) : '',
    cancelledBy: rec.status === 'CANCELLED' ? String(rec['Погасил'] || rec['Кто'] || '') : '', result: String(rec['Результат гашения'] || ''), error: String(rec['Ошибка'] || ''), applicationId: String(rec.ApplicationID || ''),
    check: rec.check && rec.check.checks ? rec.check : null, source: String(rec['Источник'] || 'MANUAL'), unsupplied: !rec.SupplierID && !!rec['GUID отправителя ХС'],
    consignorBE: String(rec['GUID отправителя ХС'] || ''), consignorEnt: String(rec['GUID отправителя площадки'] || ''), consignorName: String(rec['Откуда'] || '') };
}

/* ======================================================= ПУБЛИЧНЫЕ ФУНКЦИИ ==== */

/**
 * ПОЛУЧИТЬ ВСД: по UUID — один документ; иначе входящие ВСД вашей площадки (оформленные и погашенные),
 * отобранные по накладной (номер в связанных документах ВСД) и поставщику. Найденные сохраняются в лист «ВСД».
 */
function mcVsdFetch(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock', 'VSD_FETCH', 'ВСД', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), cfg = _mvCfg_();
    if (!cfg.ready) { _endOp_(op, 'FAILED'); return _mvErrOut_('MERCURY_NOT_CONFIGURED', 'не заполнено: ' + cfg.missing.join(', '), op.id); }
    var who = _author_(op), login = _mvLoginFor_(cfg, who), uuid = String(d.uuid || '').trim().toLowerCase();
    var data = uuid ? '<merc:getVetDocumentByUuidRequest>' + _mvHead_(cfg, login) + '<bs:uuid>' + _mvEsc_(uuid) + '</bs:uuid><dt:enterpriseGuid>' + _mvEsc_(cfg.enterprise) + '</dt:enterpriseGuid></merc:getVetDocumentByUuidRequest>'
      : '<merc:getVetDocumentListRequest>' + _mvHead_(cfg, login) + '<bs:listOptions><bs:count>' + Math.min(1000, parseInt(d.count, 10) || 200) + '</bs:count><bs:offset>0</bs:offset></bs:listOptions><vd:vetDocumentType>INCOMING</vd:vetDocumentType>' +
        (d.status ? '<vd:vetDocumentStatus>' + _mvEsc_(d.status) + '</vd:vetDocumentStatus>' : '') + '<dt:enterpriseGuid>' + _mvEsc_(cfg.enterprise) + '</dt:enterpriseGuid></merc:getVetDocumentListRequest>';
    var res = _mvApply_(op, cfg, uuid ? 'GET_VSD' : 'GET_VSD_LIST', data, '', null);
    if (res.state !== 'COMPLETED') {
      _audit_(op, 'VSD_FETCH', 'ВСД', uuid || d.docNo || '', null, { result: 'FAILED', code: res.code, message: res.message });
      _endOp_(op, 'FAILED'); return _mvErrOut_(res.code || 'MERCURY_API_ERROR', res.message, op.id);
    }
    var docs = _mvDeepAll_(res.result, 'vetDocument');
    var docNo = String(d.docNo || '').replace(/\D/g, ''), sup = d.supplier ? _mdResolveSupplier_(d.supplier, false) : null;
    return _withLock_(function () {
      var out = docs.map(function (vd) { return _mvUpsert_(op, vd, {}); }).map(function (rec) {
        var n = rec.norm, v = _mvView_(rec);
        v.invoiceMatch = !!docNo && n.refs.some(function (r) { return String(r.number || '').replace(/\D/g, '') === docNo; });
        var sm = _mvSupplierFor_(n.consignorBE, n.consignorEnt); v.supplierMatch = !!(sup && sm && sm.id === sup.id);
        v.free = !rec.batches.length; v.waybill = n.waybill;
        return v;
      });
      if (!uuid && (docNo || sup)) { var f = out.filter(function (v) { return v.invoiceMatch || v.supplierMatch; }); if (f.length || d.strict) out = f; }
      out.sort(function (a, b) { return (b.invoiceMatch - a.invoiceMatch) || (b.free - a.free); });
      _audit_(op, 'VSD_FETCH', 'ВСД', uuid || ('накладная ' + (d.docNo || '')), null, { result: out.length ? 'FOUND' : 'NOT_FOUND', found: out.length, applicationId: res.applicationId, uuids: out.map(function (v) { return v.uuid; }).slice(0, 50) });
      _endOp_(op, 'COMPLETED');
      if (!out.length) return _mvErrOut_('MERCURY_VSD_NOT_FOUND', uuid ? 'UUID ' + uuid : (d.docNo ? 'по накладной № ' + d.docNo : 'входящих ВСД нет'), op.id);
      return _ok_({ vsd: out, applicationId: res.applicationId }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** СОПОСТАВИТЬ до сохранения приёмки: сверка ВСД со строкой накладной и этикеткой (ничего не пишет, кроме чтения). */
function mcVsdPreview(vsdId, lineJson, supplier, token) {
  try {
    _requireAuth_(token, 'stock');
    var rec = _mvFind_(vsdId); if (!rec) return _mvErrOut_('MERCURY_VSD_NOT_FOUND', String(vsdId || ''));
    var line = typeof lineJson === 'string' ? JSON.parse(lineJson || '{}') : (lineJson || {}), n = rec.data.norm; if (!n) return _fail_('VALIDATION', 'ВСД внесён вручную — сверка с «Меркурием» недоступна');
    n.expiry = _mcBlDate_(n.expiry); var cfg = _mvCfg_(), chk = _mvCheck_(n, _mvUnit_(cfg, n.unitGuid, n.unitName), _mvLocalFromLine_(line, supplier), cfg, line.vsdConfirm || {});
    var v = _mvView_(rec); v.check = chk;
    if (rec.batches.length) { v.taken = true; chk.blocked = true; chk.summary = 'ВСД уже привязан к партии ' + rec.batches.join(', ') + ' — приёмка по нему завершена'; }
    return _ok_(v);
  } catch (e) { return _failFrom_(e); }
}

/** СОПОСТАВИТЬ после приёмки: привязать ВСД к партиям (из карточки партии) и сверить. */
function mcVsdLink(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock', 'VSD_LINK', 'ВСД', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    var ids = (Array.isArray(d.batchIds) ? d.batchIds : String(d.batchId || '').split(',')).map(function (x) { return String(x).trim(); }).filter(Boolean);
    if (!ids.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите партию', op.id); }
    return _withLock_(function () {
      var rec = _mvFind_(d.vsdId); if (!rec) { _endOp_(op, 'FAILED'); return _mvErrOut_('MERCURY_VSD_NOT_FOUND', String(d.vsdId || ''), op.id); }
      for (var i = 0; i < ids.length; i++) if (!_bcFind_(ids[i])) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Партия ' + ids[i] + ' не найдена', op.id); }
      var other = _mvRows_().filter(function (r) { return r.id !== rec.id && r.status !== 'REJECTED' && r.batches.some(function (b) { return ids.indexOf(b) >= 0; }); })[0];
      if (other && !d.addSecond) { _endOp_(op, 'FAILED'); return _fail_('DUPLICATE', 'К партии уже привязан ВСД ' + other['Номер ВСД'] + ' (' + _mvRu_(other.status) + ')', op.id); }
      var before = rec.status, chk = _mvLink_(op, rec, ids, {});
      _audit_(op, 'VSD_LINK', 'ВСД', rec['Номер ВСД'], { status: before }, _mvAuditBody_(op, rec, { before: before, after: rec.status, result: chk ? chk.summary : 'привязан' }));
      _endOp_(op, 'COMPLETED');
      return _ok_({ vsd: _mvView_(rec), check: chk }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** ПРОВЕРИТЬ ВСД: перечитать из «Меркурия» (если настроен) и сверить с приёмкой; подтверждения — с причиной. */
function mcVsdCheck(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock', 'VSD_CHECK', 'ВСД', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? (/^\s*\{/.test(json) ? JSON.parse(json) : { vsdId: json }) : (json || {});
    var rec = _mvFind_(d.vsdId); if (!rec) { _endOp_(op, 'FAILED'); return _mvErrOut_('MERCURY_VSD_NOT_FOUND', String(d.vsdId || ''), op.id); }
    if (!rec.data || !rec.data.norm) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'ВСД внесён вручную (без «Меркурия») — сверка недоступна', op.id); }
    var cfg = _mvCfg_(), note = '';
    if (cfg.ready && rec.MercuryUUID) {
      var fr = _mvFetchOne_(op, cfg, rec.MercuryUUID, rec.id);
      if (fr.vd) _withLock_(function () { rec = _mvUpsert_(op, fr.vd, {}); }); else note = (MC_MV_ERR_[fr.code] || [''])[0] + ' — сверка по сохранённым данным ВСД от ' + _mcRcvFmt_(_mcBlDate_(rec['Обновлено']) || new Date(), true);
    }
    rec = _mvFind_(rec.id);
    if (rec.status !== 'CANCELLED' && String(rec['Статус в Меркурии']) === 'UTILIZED' && rec.batches.length) { var sr = _mvSyncOne_(op, rec.id); _endOp_(op, /"success":true/.test(sr) ? 'COMPLETED' : 'FAILED'); return sr; }
    return _withLock_(function () {
      rec = _mvFind_(rec.id);
      var conf = rec.confirm || {}, who = _author_(op);
      Object.keys(d.confirm || {}).forEach(function (k) { var r = String((d.confirm[k] || {}).reason || d.confirm[k] || '').trim(); if (r && /^(product|producer)$/.test(k)) conf[k] = { reason: r, by: who.фио, at: _mvIso_(new Date(), true) }; });
      _mvSet_(rec, { 'Подтверждения': conf }); rec.confirm = conf;
      var before = rec.status, chk = _mvRunCheck_(op, rec);
      _audit_(op, 'VSD_CHECK', 'ВСД', rec['Номер ВСД'], { status: before }, _mvAuditBody_(op, rec, { before: before, after: rec.status, result: chk.summary, code: chk.codes.join(',') }));
      _endOp_(op, 'COMPLETED');
      var v = _mvView_(rec); v.check = chk; v.note = note;
      return _ok_(v, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function _mvFetchOne_(op, cfg, uuid, vsdId) {
  var who = _author_(op);
  var res = _mvApply_(op, cfg, 'GET_VSD', '<merc:getVetDocumentByUuidRequest>' + _mvHead_(cfg, _mvLoginFor_(cfg, who)) + '<bs:uuid>' + _mvEsc_(uuid) + '</bs:uuid><dt:enterpriseGuid>' +
    _mvEsc_(cfg.enterprise) + '</dt:enterpriseGuid></merc:getVetDocumentByUuidRequest>', vsdId, null);
  if (res.state !== 'COMPLETED') return { vd: null, code: res.code || 'MERCURY_API_ERROR', message: res.message, res: res };
  var vd = _mvDeep_(res.result, 'vetDocument');
  return vd ? { vd: vd, res: res } : { vd: null, code: 'MERCURY_VSD_NOT_FOUND', message: 'UUID ' + uuid, res: res };
}

/**
 * ПОГАСИТЬ ВСД (acceptAndCancelVSD): права → ВСД → не погашен → свежий статус из «Меркурия» → сверка →
 * захват (SENDING) → processIncomingConsignment → результат → запись (CANCELLED / ERROR / UNKNOWN) → аудит VSD_CANCEL.
 */
function mcVsdCancel(json, token) {
  var op = null, d = {};
  try { d = typeof json === 'string' ? (/^\s*\{/.test(json) ? JSON.parse(json) : { vsdId: json }) : (json || {}); op = _beginOp_(token, 'stock', 'VSD_CANCEL', 'ВСД', d.vsdId || null, null); } catch (e) { return _failFrom_(e); }
  try {
    if (!_mvCanCancel_(op.session)) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', '403 — гасить ВСД может ответственный за ХАССП или сотрудник с индивидуальным правом «Гашение ВСД» (роль «' + (op.session && (op.session.dev ? 'Технический доступ' : op.session.role)) + '»)', op.id); }
    var cfg = _mvCfg_();
    if (!cfg.ready) { _endOp_(op, 'FAILED'); return _mvErrOut_('MERCURY_NOT_CONFIGURED', 'не заполнено: ' + cfg.missing.join(', '), op.id); }
    var rec = _mvFind_(d.vsdId);
    if (!rec) { _endOp_(op, 'FAILED'); return _mvErrOut_('MERCURY_VSD_NOT_FOUND', String(d.vsdId || ''), op.id); }
    var gone = _mvAlready_(rec); if (gone) { _audit_(op, 'VSD_CANCEL', 'ВСД', rec['Номер ВСД'], { status: rec.status }, _mvAuditBody_(op, rec, { before: rec.status, after: rec.status, result: 'ALREADY_CANCELLED_NO_REQUEST' })); _endOp_(op, 'COMPLETED'); return gone; }
    if (rec.status === 'SENDING' || rec.status === 'UNKNOWN') { _endOp_(op, 'FAILED'); return _mvErrOut_('MERCURY_UNKNOWN_RESULT', rec.ApplicationID ? 'заявка ' + rec.ApplicationID : '', op.id); }
    if (rec.status === 'REJECTED') { _endOp_(op, 'FAILED'); return _mvErrOut_('MERCURY_INVALID_STATUS', 'ВСД отклонён', op.id); }
    if (!rec.batches.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'ВСД не привязан к партии приёмки — сначала «Сопоставить» с принятым товаром', op.id); }
    if (!rec.MercuryUUID || !rec.data || !rec.data.norm) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'ВСД внесён вручную, без «Меркурия» — получите его через «Получить ВСД»', op.id); }
    // 1. фактический статус в «Меркурии» (уже погашен там — привязать без запроса)
    var fr = _mvFetchOne_(op, cfg, rec.MercuryUUID, rec.id);
    if (!fr.vd) { _audit_(op, 'VSD_CANCEL', 'ВСД', rec['Номер ВСД'], { status: rec.status }, _mvAuditBody_(op, rec, { before: rec.status, after: rec.status, result: 'NOT_SENT', code: fr.code, message: fr.message }));
      _endOp_(op, 'FAILED'); return _mvErrOut_(fr.code, fr.message, op.id); }
    var fresh = null;
    var pre = _withLock_(function () {
      fresh = _mvUpsert_(op, fr.vd, {});
      if (fresh.norm.status === 'UTILIZED') {
        _mvFinalize_(op, fresh, { external: true, before: fresh.status, at: _mcBlDate_(fresh.norm.utilizedAt) || new Date(), by: fresh.norm.utilizedBy ? fresh.norm.utilizedBy + ' (в «Меркурии», вне MonChef)' : 'вне MonChef (по данным «Меркурия»)',
          result: 'погашен ранее, вне MonChef — результат «Меркурия» привязан к приёмке без повторного гашения', raw: fr.res.raw });
        return _mvAlready_(fresh, true);
      }
      if (fresh.norm.status !== 'CONFIRMED') { _mvSet_(fresh, { VSDStatus: 'CONFLICT', 'Ошибка': 'статус в «Меркурии»: ' + fresh.norm.status }); return _mvErrOut_('MERCURY_INVALID_STATUS', fresh.norm.status, op.id); }
      var chk = _mvRunCheck_(op, fresh);
      if (chk.blocked || chk.needConfirm) {
        _audit_(op, 'VSD_CANCEL', 'ВСД', fresh['Номер ВСД'], { status: 'CONFLICT' }, _mvAuditBody_(op, fresh, { before: 'CHECKING', after: 'CONFLICT', result: 'BLOCKED', code: chk.codes.join(','), message: chk.summary }));
        return JSON.stringify({ success: false, error: { code: chk.codes[0] || 'MERCURY_API_ERROR', message: chk.summary, fix: (MC_MV_ERR_[chk.codes[0]] || MC_MV_ERR_.MERCURY_API_ERROR)[1], operation_id: op.id }, data: { check: chk, vsd: _mvView_(fresh) } });
      }
      // 2. захват: с этого момента второй запрос невозможен (SENDING → только «Проверить результат»)
      var cur = _mvFind_(fresh.id);
      if (cur.status === 'SENDING' || cur.status === 'UNKNOWN' || cur.status === 'CANCELLED') return _mvAlready_(cur) || _mvErrOut_('MERCURY_UNKNOWN_RESULT', '', op.id);
      _mvSet_(cur, { VSDStatus: 'SENDING', 'Попытка': (parseInt(cur['Попытка'], 10) || 0) + 1, ApplicationID: '', OperationID: op.id, 'Кто': _author_(op).фио, 'Когда': new Date(), 'Ошибка': '' });
      fresh = cur;
      return null;
    });
    if (pre) { _endOp_(op, /"success":true/.test(pre) ? 'COMPLETED' : 'FAILED'); return pre; }
    // 3. гашение
    var who = _author_(op), login = _mvLoginFor_(cfg, who), vd = fr.vd, ctx = _mvCtx_(), xml;
    try { xml = _mvCancelXml_(fresh, vd, login, ctx); }
    catch (eX) { _withLock_(function () { _mvSet_(_mvFind_(fresh.id), { VSDStatus: 'ERROR', 'Ошибка': String(eX.message || eX) }); }); _endOp_(op, 'FAILED'); return _mvErrOut_('MERCURY_API_ERROR', String(eX.message || eX), op.id); }
    var res = _mvApply_(op, cfg, 'CANCEL', xml, fresh.id, ctx);
    return _withLock_(function () {
      var cur = _mvFind_(fresh.id);
      if (res.applicationId) _mvSet_(cur, { ApplicationID: res.applicationId });
      if (res.state === 'COMPLETED') {
        try {
          _mvFinalize_(op, cur, { before: 'READY_TO_CANCEL', applicationId: res.applicationId, raw: res.raw, stockEntry: _mvPT_(_mvDeep_(res.result, 'stockEntry') || {}, 'uuid') });
        } catch (eF) {
          try { _mvSet_(cur, { VSDStatus: 'UNKNOWN', 'Ошибка': '«Меркурий»: погашен (заявка ' + res.applicationId + '); MonChef: запись не завершена — ' + String(eF.message || eF).slice(0, 300) }); } catch (e2) {}
          _audit_(op, 'VSD_CANCEL', 'ВСД', cur['Номер ВСД'], null, _mvAuditBody_(op, cur, { before: 'SENDING', after: 'UNKNOWN', result: 'LOCAL_INCOMPLETE', code: 'MERCURY_LOCAL_INCOMPLETE', message: String(eF.message || eF), applicationId: res.applicationId, mercury: res.raw }));
          _endOp_(op, 'FAILED'); return _mvErrOut_('MERCURY_LOCAL_INCOMPLETE', '', op.id);
        }
        _endOp_(op, 'COMPLETED');
        var v = _mvView_(_mvFind_(cur.id)); v.batchStatus = cur.batches.map(function (b) { var x = _bcFind_(b); return { batchId: b, status: x ? x.v[10] : '' }; });
        v.note = cur.batches.some(function (b) { var x = _bcFind_(b); return x && /quarantine|recheck/.test(String(x.v[10])); }) ? 'ВСД погашена. Партия в карантине до входного контроля — его проводит повар при приёмке; после контроля партия допустится сама.' : 'ВСД погашена. Партия допущена: входной контроль при приёмке пройден.';
        return _ok_(v, op.id);
      }
      var unknown = res.state === 'UNKNOWN', st = unknown ? 'UNKNOWN' : 'ERROR', code = unknown ? (res.code === 'MERCURY_UNAVAILABLE' ? 'MERCURY_UNAVAILABLE' : 'MERCURY_UNKNOWN_RESULT') : (res.code || 'MERCURY_API_ERROR');
      _mvSet_(cur, { VSDStatus: st, 'Статус': 'ОФОРМЛЕН', 'Ошибка': (MC_MV_ERR_[code] || [''])[0] + (res.message ? ': ' + res.message : ''), 'Ответ Меркурия': String(res.raw || '').slice(0, 20000) });
      cur.batches.forEach(function (bid) { _mvPassport_(bid, cur); _mcBlEvent_(op, bid, 'VSD_CANCEL_FAILED', { doc: cur.id, reason: 'ВСД НЕ ПОГАШЕН: ' + (MC_MV_ERR_[code] || [''])[0] + (res.message ? ' — ' + res.message : ''), result: st }); });
      _audit_(op, 'VSD_CANCEL', 'ВСД', cur['Номер ВСД'], { status: 'SENDING' }, _mvAuditBody_(op, cur, { before: 'SENDING', after: st, result: unknown ? 'UNKNOWN' : 'FAILED', code: code, message: res.message, applicationId: res.applicationId, mercury: res.raw }));
      _endOp_(op, 'FAILED');
      var out = JSON.parse(_mvErrOut_(code, res.message, op.id)); out.error.title = unknown ? 'РЕЗУЛЬТАТ НЕИЗВЕСТЕН' : 'ВСД НЕ ПОГАШЕН'; out.data = { vsd: _mvView_(cur) };
      return JSON.stringify(out);
    });
  } catch (e) {
    try { if (d.vsdId) { var r2 = _mvFind_(d.vsdId); if (r2 && r2.status === 'SENDING') _mvSet_(r2, { VSDStatus: 'UNKNOWN', 'Ошибка': 'сбой во время гашения: ' + String(e.message || e).slice(0, 300) }); } } catch (e3) {}
    _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id);
  }
}
function acceptAndCancelVSD(json, token) { return mcVsdCancel(json, token); }
/** «ВСД уже погашен»: ответ без повторного запроса. */
function _mvAlready_(rec, justLinked) {
  if (rec.status !== 'CANCELLED') return null;
  var v = _mvView_(rec);
  v.already = true; v.justLinked = !!justLinked;
  v.message = 'ВСД уже погашен' + (justLinked ? ' в «Меркурии» — результат привязан к приёмке, повторный запрос не отправлялся' : ' — повторный запрос не отправляется');
  return JSON.stringify({ success: true, data: v });
}
/** processIncomingConsignmentRequest: груз из ВСД, получатель — ваша площадка, решение — принять всё. */
function _mvCancelXml_(rec, vd, login, ctx) {
  var cc = _mvKid_(vd, 'certifiedConsignment'); if (!cc) throw new Error('в ВСД нет сведений о грузе (certifiedConsignment)');
  var bt = _mvKid_(cc, 'batch'); if (!bt) throw new Error('в ВСД нет сведений о партии (batch)');
  var copy = function (name) { var x = _mvKid_(cc, name); return x ? _mvSer_(x, ctx) : ''; };
  var re = function (node, name) { var c = JSON.parse(JSON.stringify(node, function (k, v) { return k === 'parent' ? undefined : v; })); c.n = name; c.ns = MC_MV_NS_.vd; return _mvSer_(c, ctx); };
  var cons = re(bt, 'consignment');
  var n = rec.data.norm, wb = n.waybill || {}, inv = String(rec['Накладная №'] || rec['Приход (накладная)'] || '').replace(/^накладная\s*/i, ''), dd = _mcBlDate_(rec['Дата доставки']) || new Date();
  var wNum = wb.number || inv, wDate = wb.date || _mvIso_(_mcBlDate_(rec['Дата доставки']) || new Date(), false);
  var resp = '<vd:responsible><vd:login>' + _mvEsc_(login) + '</vd:login></vd:responsible>';
  return '<merc:processIncomingConsignmentRequest>' + _mvHead_(null, login) +
    '<vd:delivery><vd:deliveryDate>' + _mvIso_(dd, true) + '</vd:deliveryDate>' + copy('consignor') + copy('consignee') + cons + copy('broker') + copy('transportInfo') + copy('transportStorageType') +
    '<vd:accompanyingForms><vd:waybill>' + (wb.series ? '<vd:issueSeries>' + _mvEsc_(wb.series) + '</vd:issueSeries>' : '') + '<vd:issueNumber>' + _mvEsc_(wNum) + '</vd:issueNumber><vd:issueDate>' + _mvEsc_(wDate) +
    '</vd:issueDate><vd:type>' + _mvEsc_(wb.type || '1') + '</vd:type></vd:waybill><vd:vetCertificate><bs:uuid>' + _mvEsc_(rec.MercuryUUID) + '</bs:uuid></vd:vetCertificate></vd:accompanyingForms></vd:delivery>' +
    '<vd:deliveryFacts><vd:vetCertificatePresence>ELECTRONIC</vd:vetCertificatePresence><vd:docInspection>' + resp + '<vd:result>CORRESPONDS</vd:result></vd:docInspection>' +
    '<vd:vetInspection>' + resp + '<vd:result>CORRESPONDS</vd:result></vd:vetInspection><vd:decision>ACCEPT_ALL</vd:decision></vd:deliveryFacts></merc:processIncomingConsignmentRequest>';
}

/**
 * ПРОВЕРИТЬ СТАТУС / ПРОВЕРИТЬ РЕЗУЛЬТАТ / ВОССТАНОВИТЬ ПРИЁМКУ: результат последней заявки и фактический статус ВСД.
 * UTILIZED → приёмка завершается в MonChef без повторного гашения; CONFIRMED → не погашен, можно повторить.
 */
function mcVsdSync(vsdId, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock', 'VSD_SYNC', 'ВСД', vsdId || null, null); } catch (e) { return _failFrom_(e); }
  try { var r = _mvSyncOne_(op, vsdId); _endOp_(op, /"success":true/.test(r) ? 'COMPLETED' : 'FAILED'); return r; }
  catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function _mvSyncOne_(op, vsdId) {
  var cfg = _mvCfg_(); if (!cfg.ready) return _mvErrOut_('MERCURY_NOT_CONFIGURED', 'не заполнено: ' + cfg.missing.join(', '), op.id);
  var rec = _mvFind_(vsdId); if (!rec) return _mvErrOut_('MERCURY_VSD_NOT_FOUND', String(vsdId || ''), op.id);
  if (!rec.MercuryUUID) return _fail_('VALIDATION', 'ВСД внесён вручную — статус в «Меркурии» не запрашивается', op.id);
  var before = rec.status, pending = before === 'SENDING' || before === 'UNKNOWN', appRes = null, stockEntry = '';
  if (pending && rec.ApplicationID) {
    appRes = _mvPoll_(op, cfg, 'CANCEL_RESULT', rec.ApplicationID, rec.id, 1);
    if (appRes.state === 'COMPLETED') stockEntry = _mvPT_(_mvDeep_(appRes.result, 'stockEntry') || {}, 'uuid');
  }
  var fr = _mvFetchOne_(op, cfg, rec.MercuryUUID, rec.id);
  if (!fr.vd) {
    if (appRes && appRes.state === 'COMPLETED') fr = { vd: null, completed: true }; else return _mvErrOut_(fr.code, fr.message, op.id);
  }
  return _withLock_(function () {
    var cur = fr.vd ? _mvUpsert_(op, fr.vd, {}) : _mvFind_(rec.id), ms = fr.vd ? cur.norm.status : 'UTILIZED', msg;
    if (ms === 'UTILIZED' || (appRes && appRes.state === 'COMPLETED')) {
      if (cur.status !== 'CANCELLED' || !cur['Результат гашения']) {
        var ours = pending;
        _mvFinalize_(op, cur, { recovered: ours, external: !ours, before: before, applicationId: rec.ApplicationID, stockEntry: stockEntry, raw: (appRes && appRes.raw) || '',
          at: (cur.norm && _mcBlDate_(cur.norm.utilizedAt)) || new Date(), by: ours ? String(rec['Кто'] || '') + ' (подтверждено проверкой статуса)' : (cur.norm && cur.norm.utilizedBy ? cur.norm.utilizedBy + ' (в «Меркурии», вне MonChef)' : 'вне MonChef (по данным «Меркурия»)'),
          result: ours ? 'погашен через интеграцию; результат подтверждён проверкой статуса, приёмка восстановлена без повторного гашения' : 'погашен вне MonChef (по данным «Меркурия»)' });
        msg = ours ? 'ВСД погашен в «Меркурии». Приёмка восстановлена — повторное гашение не выполнялось.' : 'ВСД погашен в «Меркурии» (вне MonChef) — результат привязан.';
      } else msg = 'ВСД погашен.';
    } else if (ms === 'CONFIRMED' && appRes && appRes.state === 'UNKNOWN') {
      _mvSet_(cur, { VSDStatus: 'UNKNOWN', 'Ошибка': 'заявка ' + rec.ApplicationID + ' ещё обрабатывается в «Меркурии»' });
      msg = 'Заявка на гашение ещё обрабатывается в «Меркурии» — проверьте позже. Повторное гашение пока недоступно.';
    } else if (ms === 'CONFIRMED') {
      if (pending) { _mvSet_(cur, { VSDStatus: 'READY_TO_CANCEL', 'Ошибка': 'предыдущая попытка не выполнена в «Меркурии»' + (appRes && appRes.state === 'REJECTED' ? ': ' + appRes.message : '') }); cur.status = 'READY_TO_CANCEL'; }
      if (cur.status !== 'CANCELLED') _mvRunCheck_(op, cur);
      msg = 'ВСД в «Меркурии» не погашен' + (pending ? ' — предыдущая попытка не выполнена, гашение можно повторить' : '') + '.';
    } else if (ms === 'WITHDRAWN') { _mvSet_(cur, { VSDStatus: 'REJECTED', 'Статус': 'АННУЛИРОВАН', 'Ошибка': 'ВСД аннулирован в «Меркурии»' }); msg = 'ВСД аннулирован в «Меркурии» — гашение невозможно.'; }
    else { _mvSet_(cur, { VSDStatus: pending ? 'UNKNOWN' : 'CONFLICT', 'Ошибка': 'статус в «Меркурии»: ' + ms }); msg = 'Статус ВСД в «Меркурии»: ' + ms + '.'; }
    _audit_(op, 'VSD_SYNC', 'ВСД', cur['Номер ВСД'], { status: before }, _mvAuditBody_(op, cur, { before: before, after: cur.status, result: msg, applicationId: rec.ApplicationID }));
    var v = _mvView_(_mvFind_(cur.id)); v.message = msg; v.mercuryStatus = ms; v.retry = v.status === 'READY_TO_CANCEL';
    return _ok_(v, op.id);
  });
}
/** Расписание: незавершённые гашения (SENDING/UNKNOWN) проверяются автоматически — после сбоя или закрытого браузера. */
function mcMercurySyncPendingSystem() {
  try {
    if (!_mvCfg_().ready) return;
    var op = _createOperation_('VSD_SYNC_SCHEDULED', null, '');
    _mvRows_().filter(function (r) { return (r.status === 'SENDING' || r.status === 'UNKNOWN') && r.MercuryUUID; }).slice(0, 10).forEach(function (r) {
      var t = _mcBlDate_(r['Когда']); if (r.status === 'SENDING' && t && new Date() - t < 10 * 60000) return;   // ещё выполняется
      try { _mvSyncOne_(op, r.id); } catch (e) {}
    });
    _closeOperation_(op.id, 'COMPLETED');
  } catch (e) {}
}

/** Отклонить ВСД в MonChef (неверный документ / отказ от груза). Возврат в «Меркурии» оформляется в его интерфейсе. */
function mcVsdReject(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock', 'VSD_REJECT', 'ВСД', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), why = String(d.reason || '').trim();
    if (!why) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите причину отклонения', op.id); }
    return _withLock_(function () {
      var rec = _mvFind_(d.vsdId); if (!rec) { _endOp_(op, 'FAILED'); return _mvErrOut_('MERCURY_VSD_NOT_FOUND', '', op.id); }
      if (rec.status === 'CANCELLED') { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'ВСД уже погашен — отклонить нельзя (возврат оформляется отдельным ВСД в «Меркурии»)', op.id); }
      if (rec.status === 'SENDING' || rec.status === 'UNKNOWN') { _endOp_(op, 'FAILED'); return _mvErrOut_('MERCURY_UNKNOWN_RESULT', '', op.id); }
      var before = rec.status, unlink = d.unlink === true;
      rec.batches.forEach(function (bid) { _mcBlEvent_(op, bid, unlink ? 'VSD_UNLINKED' : 'VSD_REJECTED', { doc: rec.id, reason: 'ВСД ' + rec['Номер ВСД'] + ': ' + why }); });
      var olds = rec.batches.slice();
      _mvSet_(rec, unlink ? { BatchID: '', VSDStatus: 'FOUND', 'Ошибка': 'отвязан: ' + why } : { VSDStatus: 'REJECTED', 'Статус': 'АННУЛИРОВАН', 'Ошибка': 'отклонён: ' + why });
      olds.forEach(function (bid) { try { var p = _mcBlPass_(bid); if (p) _mcBlPassSet_(p, unlink ? { 'ВСД': '', 'VSDID': '', 'Статус ВСД': '' } : { 'Статус ВСД': _mvRu_('REJECTED') }); } catch (e) {} });
      _audit_(op, unlink ? 'VSD_UNLINK' : 'VSD_REJECT', 'ВСД', rec['Номер ВСД'], { status: before, batches: olds }, _mvAuditBody_(op, rec, { before: before, after: rec.status, result: why }));
      _vtRefreshBatches_(olds, op);   // этап 10.7: отклонён → «Закрыто: ВСД отклонена»; отвязан → снова «ждёт ВСД»
      _endOp_(op, 'COMPLETED');
      return _ok_({ vsd: _mvView_(rec), note: unlink ? 'ВСД отвязан от партии' : 'ВСД отклонён в MonChef. Партия остаётся в карантине. Отказ/возврат в «Меркурии» оформите в его интерфейсе.' }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Сопоставить отправителя ВСД (GUID «Меркурия») с поставщиком MonChef — решение человека, в аудит. */
function mcMercuryMapSupplier(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock', 'VSD_SUPPLIER_MAP', 'ВСД', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    var be = String(d.businessEntityGuid || '').trim(), ent = String(d.enterpriseGuid || '').trim(), sup = _mdResolveSupplier_(d.supplier, false);
    if (!be && !ent) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Нет GUID отправителя', op.id); }
    if (!sup) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Поставщик «' + d.supplier + '» не найден в справочнике', op.id); }
    return _withLock_(function () {
      var who = _author_(op); _bcSheet_(MC_MV_SUP_, MC_MV_SUP_HEAD_).appendRow([be, ent, String(d.name || ''), sup.id, sup.name, who.фио, new Date()]);
      _mvRows_().forEach(function (r) { if ((be && String(r['GUID отправителя ХС']) === be) || (ent && String(r['GUID отправителя площадки']) === ent)) _mvSet_(r, { SupplierID: sup.id, 'Поставщик': sup.name }); });
      _audit_(op, 'VSD_SUPPLIER_MAP', 'ВСД', be || ent, null, { businessEntityGuid: be, enterpriseGuid: ent, supplierId: sup.id, supplier: sup.name, by: who.фио });
      _endOp_(op, 'COMPLETED');
      return _ok_({ supplierId: sup.id, supplier: sup.name }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Настройки интеграции (только администратор). Пароль и APIKey браузеру не возвращаются. */
function mcMercuryGetConfig(token) {
  try {
    var s = _requireAuth_(token); if (!s.dev) return _fail_('FORBIDDEN', '403 — настройки «Меркурия» — только технический доступ');
    var p = _mvProps_(), out = {};
    MC_MV_CFG_KEYS_.forEach(function (k) { var v = String(p.getProperty(k) || ''); out[k] = MC_MV_SECRET_[k] ? (v ? 'задан' : '') : v; });
    var c = _mvCfg_();
    return _ok_({ values: out, ready: c.ready, missing: c.missing, urls: MC_MV_URLS_, cancelRoles: MC_MV_CANCEL_ROLES_ });
  } catch (e) { return _failFrom_(e); }
}
function mcMercurySaveConfig(json, token) {
  var op = null;
  try { op = _beginOp_(token, null, 'MERCURY_CONFIG', 'Меркурий', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var s = op.session; if (!s.dev) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', '403 — настройки «Меркурия» — только технический доступ', op.id); }
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), p = _mvProps_(), changed = [];
    MC_MV_CFG_KEYS_.forEach(function (k) {
      if (d[k] === undefined) return; var v = String(d[k] === null ? '' : d[k]).trim();
      if (MC_MV_SECRET_[k] && (v === 'задан' || v === '')) return;                       // секрет не трогаем, если не ввели новый
      if ((k === 'MERCURY_USER_LOGINS' || k === 'MERCURY_UNIT_MAP') && v) { try { JSON.parse(v); } catch (e) { throw new Error('VALIDATION: ' + k + ' — нужен JSON, например {"EMP-1":"login"}'); } }
      if (v) p.setProperty(k, v); else p.deleteProperty(k); changed.push(k);
    });
    _audit_(op, 'MERCURY_CONFIG', 'Меркурий', '', null, { changed: changed });
    _endOp_(op, 'COMPLETED');
    var c = _mvCfg_(); return _ok_({ ready: c.ready, missing: c.missing, changed: changed }, op.id);
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Проверка связи: запрос одного входящего ВСД. */
function mcMercuryTestConnection(token) {
  var op = null;
  try { op = _beginOp_(token, null, 'MERCURY_TEST', 'Меркурий', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var s = op.session; if (!s.dev) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', '403 — настройки «Меркурия» — только технический доступ', op.id); }
    var cfg = _mvCfg_(); if (!cfg.ready) { _endOp_(op, 'FAILED'); return _mvErrOut_('MERCURY_NOT_CONFIGURED', 'не заполнено: ' + cfg.missing.join(', '), op.id); }
    var res = _mvApply_(op, cfg, 'TEST', '<merc:getVetDocumentListRequest>' + _mvHead_(cfg, cfg.initiator) + '<bs:listOptions><bs:count>1</bs:count><bs:offset>0</bs:offset></bs:listOptions><vd:vetDocumentType>INCOMING</vd:vetDocumentType><dt:enterpriseGuid>' +
      _mvEsc_(cfg.enterprise) + '</dt:enterpriseGuid></merc:getVetDocumentListRequest>', '', null);
    _audit_(op, 'MERCURY_TEST', 'Меркурий', '', null, { state: res.state, code: res.code, message: res.message, applicationId: res.applicationId });
    _endOp_(op, res.state === 'COMPLETED' ? 'COMPLETED' : 'FAILED');
    return res.state === 'COMPLETED' ? _ok_({ ok: true, applicationId: res.applicationId, message: 'Связь с «Меркурием» есть: заявка ' + res.applicationId + ' выполнена' }, op.id) : _mvErrOut_(res.code || 'MERCURY_API_ERROR', res.message, op.id);
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** ВСД для экранов: список с фильтрами, карточка ВСД (история обмена и аудит), ВСД партии. */
function mcGetVsdList(json, token) {
  try {
    var s = _requireAuth_(token), p = s.permissions || {};
    if (!_mcRbHasExact_(s, 'mercury|vsd_cancel|vsd_view|audit_view')) return _fail_('FORBIDDEN', '403 — нет доступа к ВСД');
    var f = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), q = _mdNorm_(f.q || '');
    var list = _mvRows_().reverse().map(_mvView_).filter(function (v) {
      if (f.status && v.status !== f.status) return false;
      if (f.batchId && v.batches.indexOf(String(f.batchId)) < 0) return false;
      if (q && _mdNorm_([v.number, v.uuid, v.product, v.supplier, v.batches.join(' '), v.invoice].join(' ')).indexOf(q) < 0) return false;
      return true;
    }).slice(0, 300);
    var c = _mvCfg_();
    return _ok_({ vsd: list, configured: c.ready, missing: c.missing, canCancel: _mvCanCancel_(s), statuses: MC_MV_ST_RU_, isAdmin: s.dev === true,
      suppliers: _mdSuppliers_().map(function (x) { return { id: x.id, name: x.name }; }) });
  } catch (e) { return _failFrom_(e); }
}
function mcGetVsdCard(vsdId, token) {
  try {
    var s = _requireAuth_(token), rec = _mvFind_(vsdId); if (!rec) return _mvErrOut_('MERCURY_VSD_NOT_FOUND', String(vsdId || ''));
    var v = _mvView_(rec);
    v.exchange = _mvLogSheet_().getDataRange().getValues().slice(1).filter(function (r) { return String(r[3]) === rec.id; }).reverse().slice(0, 50)
      .map(function (r) { return { at: _mcRcvFmt_(_mcBlDate_(r[0]) || new Date(), true), op: r[1], kind: r[2], applicationId: r[4], http: r[5], status: r[6], code: r[7], message: r[8] }; });
    v.history = _mvAuditRows_({ vsd: rec['Номер ВСД'] }).slice(0, 50);
    v.raw = { mercuryStatus: rec['Статус в Меркурии'], history: rec.data && rec.data.norm ? rec.data.norm.history : [], refs: rec.data && rec.data.norm ? rec.data.norm.refs : [] };
    v.canCancel = _mvCanCancel_(s);
    return _ok_(v);
  } catch (e) { return _failFrom_(e); }
}
function _mvAuditRows_(f) {
  f = f || {};
  var sh = _auditSheet_(), n = sh.getLastRow(), from = Math.max(2, n - 8000), out = [];
  if (n < 2) return out;
  var df = f.from ? _parseDate_(f.from) : null, dt = f.to ? _parseDate_(f.to) : null; if (dt) dt = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59);
  sh.getRange(from, 1, n - from + 1, 13).getValues().forEach(function (r) {
    var act = String(r[7]); if (!/^VSD_|^MERCURY_/.test(act) || r[11] === '' || r[11] === null) return;   // строка «операция начата» без результата не показывается
    if (f.type && act !== f.type) return;
    var a = _mcBlJson_(r[11]), t = r[0] instanceof Date ? r[0] : new Date(r[0]);
    if (f.vsd && String(r[9]) !== String(f.vsd) && String(a.VSDNumber || '') !== String(f.vsd) && String(a.MercuryUUID || '') !== String(f.vsd)) return;
    if (f.batchId && String(a.BatchID || '').split(',').indexOf(String(f.batchId)) < 0) return;
    if (f.supplier && _mdNorm_(String(a.Supplier || '') + ' ' + String(a.SupplierID || '')).indexOf(_mdNorm_(f.supplier)) < 0) return;
    if (f.employee && _mdNorm_(String(r[2]) + ' ' + String(a.EmployeeName || a.by || '')).indexOf(_mdNorm_(f.employee)) < 0) return;
    if (df && t < df) return; if (dt && t > dt) return;
    out.push({ at: _mcRcvFmt_(t, true), operationId: r[1], employee: a.EmployeeName || a.by || r[2], role: a.Role || r[3], action: act, vsd: r[9], batch: a.BatchID || '', supplier: a.Supplier || '', product: a.Product || '',
      qty: a.Quantity || '', result: a.Result || '', before: a.BeforeState || '', after: a.AfterState || '', code: a.ErrorCode || '', message: a.ErrorMessage || '', applicationId: a.ApplicationID || '', mercury: String(a.MercuryResponse || '').slice(0, 600) });
  });
  return out.reverse();
}
/** Журнал аудита ВСД с фильтрами: тип операции, поставщик, ВСД, партия, сотрудник, даты. */
function mcGetVsdAudit(json, token) {
  try {
    var s = _requireAuth_(token), p = s.permissions || {};
    if (!_mcRbHasExact_(s, 'mercury|vsd_cancel|vsd_view|audit_view')) return _fail_('FORBIDDEN', '403 — нет доступа к журналу ВСД');
    var f = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    return _ok_({ rows: _mvAuditRows_(f).slice(0, 500), types: ['VSD_CANCEL', 'VSD_CANCEL_RECOVERED', 'VSD_CHECK', 'VSD_FETCH', 'VSD_LINK', 'VSD_SYNC', 'VSD_REJECT', 'VSD_UNLINK', 'VSD_SUPPLIER_MAP', 'MERCURY_CONFIG', 'MERCURY_TEST'] });
  } catch (e) { return _failFrom_(e); }
}
/** ВСД партии — для карточки партии и прослеживаемости. */
function _mvForBatch_(batchId) {
  var rows = _mvRows_(), id = String(batchId), hop = 0, out = rows.filter(function (r) { return r.batches.indexOf(id) >= 0; }).map(_mvView_);
  // п/ф и разделённые партии: ВСД сырья — по цепочке ParentBatchID (только для показа, гасится на партии сырья)
  while (!out.length && hop++ < 6) {
    var p = _mcBlPass_(id), par = p ? String(p.v[MC_RCV_C_['ParentBatchID']] || '') : '';
    if (!par) { var m = /^(.*)-\d{2}$/.exec(id); par = m ? m[1] : ''; }
    if (!par || par === id) break;
    id = par;
    out = rows.filter(function (r) { return r.batches.indexOf(id) >= 0; }).map(function (r) { var v = _mvView_(r); v.inheritedFrom = id; return v; });
  }
  return out;
}
