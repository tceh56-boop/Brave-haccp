/**
 * MonChef License API — проверка запроса, частота запросов, идемпотентность requestId,
 * счётчики подозрительной активности, генерация токенов.
 */

// ---------------------------------------------------------------- проверка запроса

var MC_PATTERNS_ = {
  requestId: /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/,
  licenseId: /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/,
  clientId: /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/,
  installationId: /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/,
  clientToken: /^[A-Za-z0-9_-]{32,256}$/,
  appVersion: /^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/,
  documentId: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
  module: /^[A-Za-z0-9_]{1,64}$/
};

/**
 * Разбор и проверка тела запроса. Возвращает { ok:true, req } или { ok:false, code, requestId }.
 * Права доступа из запроса не принимаются: лишние поля (fileId, status, allowedModules, …) — отказ.
 */
function validateRequest_(body, declaredLength) {
  var raw = String(body || '');
  if (!raw) return { ok: false, code: 'INVALID_REQUEST' };
  var bytes = Math.max(declaredLength || 0, raw.length);
  if (bytes > MC_MAX_REQUEST_BYTES_ || mcUtf8Length_(raw) > MC_MAX_REQUEST_BYTES_) return { ok: false, code: 'REQUEST_TOO_LARGE' };
  var obj;
  try { obj = JSON.parse(raw); } catch (e) { return { ok: false, code: 'INVALID_REQUEST' }; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, code: 'INVALID_REQUEST' };
  var rid = typeof obj.requestId === 'string' && MC_PATTERNS_.requestId.test(obj.requestId) ? obj.requestId : '';

  var keys = Object.keys(obj);
  for (var i = 0; i < keys.length; i++) {
    if (MC_REQUEST_FIELDS_.indexOf(keys[i]) < 0) return { ok: false, code: 'INVALID_REQUEST', requestId: rid, field: keys[i] };
    var v = obj[keys[i]];
    if (typeof v !== 'string' || v.length > MC_MAX_STRING_) return { ok: false, code: 'INVALID_REQUEST', requestId: rid, field: keys[i] };
  }
  var required = ['requestId', 'licenseId', 'clientId', 'installationId', 'clientToken', 'action', 'appVersion'];
  for (var j = 0; j < required.length; j++) if (!obj[required[j]]) return { ok: false, code: 'INVALID_REQUEST', requestId: rid, field: required[j] };
  for (var k in MC_PATTERNS_) {
    if (obj[k] !== undefined && obj[k] !== '' && !MC_PATTERNS_[k].test(obj[k])) return { ok: false, code: 'INVALID_REQUEST', requestId: rid, field: k };
  }
  if (MC_ACTIONS_.indexOf(obj.action) < 0) return { ok: false, code: 'UNKNOWN_ACTION', requestId: rid };
  if (obj.action === 'LIST_DOCUMENTS' && !obj.module) return { ok: false, code: 'INVALID_REQUEST', requestId: rid, field: 'module' };
  if (obj.action === 'GET_DOCUMENT' && !obj.documentId) return { ok: false, code: 'INVALID_REQUEST', requestId: rid, field: 'documentId' };

  return { ok: true, req: {
    requestId: obj.requestId, licenseId: obj.licenseId, clientId: obj.clientId, installationId: obj.installationId,
    clientToken: obj.clientToken, action: obj.action, appVersion: obj.appVersion,
    documentId: obj.documentId || '', module: obj.module ? String(obj.module).toUpperCase() : ''
  } };
}

function mcUtf8Length_(s) {
  var n = 0;
  for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xd800 && c < 0xdc00) ? 4 : (c >= 0xdc00 && c < 0xe000) ? 0 : 3; }
  return n;
}

/** Хеш содержимого запроса без токена: тот же requestId с другим содержимым — REQUEST_ID_PAYLOAD_MISMATCH. */
function payloadHash_(req) {
  return mcSha256Hex_(JSON.stringify([req.licenseId, req.clientId, req.installationId, req.action, req.documentId || '',
    req.module || '', req.appVersion]));
}

// ---------------------------------------------------------------- коды наружу

function mcExternalCode_(code) {
  if (MC_AUTH_CODES_.indexOf(code) >= 0 && mcCfg_('MC_STRICT_AUTH_ERRORS') !== 'false') return 'AUTH_FAILED';
  return MC_ERRORS_[code] ? code : 'INTERNAL_ERROR';
}

// ---------------------------------------------------------------- частота запросов

/**
 * Лимит в минуту на licenseId (общий и, если задан, по операции). Счётчики — в CacheService,
 * в таблицу не пишутся. Заодно считается почасовой объём для уведомления о резком росте.
 */
function rateLimitOk_(licenseId, action) {
  var minute = Math.floor(Date.now() / 60000);
  var total = mcCfgInt_('MC_RATE_LIMIT_PER_LICENSE', 60), per = mcCfgInt_('MC_RATE_LIMIT_' + action, 0);
  var kAll = mcKey_('rl', licenseId + '|' + minute), kAct = mcKey_('rl', licenseId + '|' + action + '|' + minute);
  var nAll = parseInt((mcCacheGet_(kAll) || 0), 10) || 0, nAct = parseInt((mcCacheGet_(kAct) || 0), 10) || 0;
  if (total > 0 && nAll >= total) return false;
  if (per > 0 && nAct >= per) return false;
  mcCacheIncr_(kAll, 120);
  if (per > 0) mcCacheIncr_(kAct, 120);

  var hourN = mcCacheIncr_(mcKey_('rh', licenseId + '|' + Math.floor(Date.now() / 3600000)), 3700);
  var spike = mcCfgInt_('MC_SPIKE_PER_HOUR', 1200);
  if (spike > 0 && hourN === spike) notifySuspiciousEvent_({ type: 'REQUEST_SPIKE', licenseId: licenseId, details: hourN + ' запросов за текущий час' });
  return true;
}

/**
 * Учёт отказов. Неверный clientId/токен подряд — BAD_TOKENS; обращение по недействующей лицензии —
 * INACTIVE_LICENSE_USE; неизвестный licenseId — UNKNOWN_LICENSE; много отказов за час — MANY_ERRORS.
 */
function mcNoteFailure_(req, code) {
  var lic = req && req.licenseId ? String(req.licenseId) : '';
  if (code === 'LICENSE_NOT_FOUND') {
    notifySuspiciousEvent_({ type: 'UNKNOWN_LICENSE', licenseId: lic, clientId: req.clientId, installationId: req.installationId });
  } else if (code === 'INVALID_TOKEN' || code === 'CLIENT_MISMATCH') {
    var n = mcCacheIncr_(mcKey_('bt', lic), 900);
    if (n >= mcCfgInt_('MC_BAD_TOKEN_THRESHOLD', 5)) notifySuspiciousEvent_({ type: 'BAD_TOKENS', licenseId: lic, clientId: req.clientId,
      installationId: req.installationId, details: n + ' неверных попыток за 15 минут (' + code + ')' });
  } else if (code === 'LICENSE_EXPIRED' || code === 'LICENSE_INACTIVE') {
    notifySuspiciousEvent_({ type: 'INACTIVE_LICENSE_USE', licenseId: lic, clientId: req.clientId, installationId: req.installationId, details: code });
  }
  if (!lic) return;
  var e = mcCacheIncr_(mcKey_('eh', lic + '|' + Math.floor(Date.now() / 3600000)), 3700);
  var lim = mcCfgInt_('MC_ERRORS_PER_HOUR', 60);
  if (lim > 0 && e === lim) notifySuspiciousEvent_({ type: 'MANY_ERRORS', licenseId: lic, details: e + ' отказов за текущий час' });
}

function mcNoteAuthSuccess_(req) { mcCacheRemove_(mcKey_('bt', req.licenseId)); }

// ---------------------------------------------------------------- идемпотентность requestId

function mcRequestKey_(req) { return mcKey_('req', req.licenseId + '|' + req.requestId); }

/**
 * Начало обработки requestId. Возвращает:
 *   { state:'NEW' } — выполнять;  { state:'DONE', response } — вернуть сохранённый ответ;
 *   { state:'PROCESSING' } — тот же запрос ещё выполняется;  { state:'MISMATCH' } — другой payload;
 *   { state:'BUSY' } — не удалось взять блокировку.
 * Таблица REQUESTS читается до блокировки; под блокировкой — только проверка и отметка в кэше.
 */
function beginRequest_(req) {
  var key = mcRequestKey_(req), ph = payloadHash_(req);
  var known = mcCacheGet_(key);
  if (!known) {
    var row = mcStore_().getRequest(req.licenseId, req.requestId);
    if (row) known = { status: String(row.status), payloadHash: String(row.payloadHash), response: String(row.responseJson || '') };
  }
  if (known && known.status === 'DONE') {
    if (known.payloadHash !== ph) return { state: 'MISMATCH' };
    return { state: 'DONE', response: known.response };
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return { state: 'BUSY' };
  try {
    var cur = mcCacheGet_(key);
    if (cur) {
      if (cur.payloadHash !== ph) return { state: 'MISMATCH' };
      return cur.status === 'DONE' ? { state: 'DONE', response: cur.response } : { state: 'PROCESSING' };
    }
    mcCachePut_(key, { status: 'PROCESSING', payloadHash: ph }, 300);
    return { state: 'NEW' };
  } finally { lock.releaseLock(); }
}

/**
 * Завершение: ответ сохраняется в REQUESTS (DONE) и в кэш. Содержимое документа (contentBase64)
 * в таблицу и кэш не пишется — при повторе GET_DOCUMENT файл читается заново с теми же проверками.
 * Временные ошибки (retryable) не сохраняются: клиент может повторить тот же requestId.
 */
function finishRequest_(req, resp, createdAt) {
  var key = mcRequestKey_(req);
  if (!resp.ok && resp.retryable) { mcCacheRemove_(key); return; }
  var stored = resp;
  if (resp.ok && resp.result && resp.result.contentBase64 !== undefined) {
    stored = JSON.parse(JSON.stringify(resp));
    delete stored.result.contentBase64;
    stored.result.contentOmitted = true;
  }
  var json = JSON.stringify(stored);
  if (json.length > 45000) json = JSON.stringify({ ok: resp.ok, requestId: resp.requestId, error: resp.error || '', contentOmitted: true });
  var ph = payloadHash_(req);
  mcCachePut_(key, { status: 'DONE', payloadHash: ph, response: json }, 21600);
  try {
    mcStore_().insertRequest({ requestId: req.requestId, licenseId: req.licenseId, clientId: req.clientId,
      installationId: req.installationId, action: req.action, payloadHash: ph, status: 'DONE', responseJson: json,
      createdAt: createdAt, finishedAt: mcNowIso_() });
  } catch (e) { /* ответ уже готов; кэш сохранит идемпотентность на 6 ч */ }
}

function abortRequest_(req) { mcCacheRemove_(mcRequestKey_(req)); }

// ---------------------------------------------------------------- токены

/**
 * Длинный непредсказуемый токен установки: 2 случайных UUID (SecureRandom) + время,
 * через SHA-256 дважды → 64 байта → base64url. Префикс mct_ помогает найти токен при утечке.
 */
function generateClientToken_() {
  var a = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + '|' + Utilities.getUuid() + '|' + Date.now(), Utilities.Charset.UTF_8);
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + '|' + Utilities.getUuid() + '|' + Math.random(), Utilities.Charset.UTF_8);
  return 'mct_' + Utilities.base64EncodeWebSafe(a.concat(b)).replace(/=+$/, '');
}
