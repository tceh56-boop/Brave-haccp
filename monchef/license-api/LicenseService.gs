/**
 * MonChef License API — лицензии, токены установок, установки.
 *
 * Порядок проверки (checkLicense_):
 *   1) лицензия существует;  2) clientId совпадает;  3) хеш токена совпадает;
 *   4) статус ACTIVE или TEST;  5) сегодня в периоде validFrom..validUntil;  6) установка разрешена (лимит).
 * Статус и сроки сообщаются клиенту только после проверки токена: посторонний не узнает,
 * что лицензия с таким номером существует, отозвана или истекла.
 * Модуль и документ проверяются в обработчиках (isModuleAllowed_, DocumentService).
 */

// ---------------------------------------------------------------- токены

/** Секрет («перец») для HMAC-SHA-256 хеша токена. Хранится только в Script Properties API. */
function mcPepper_() {
  var p = mcCfg_('MC_TOKEN_PEPPER');
  if (!p) throw mcFail_('SERVICE_UNAVAILABLE', 'MC_TOKEN_PEPPER не задан — выполните MC_setupLicenseRegistry()');
  return p;
}

/**
 * Хеш токена: HMAC-SHA-256(token, MC_TOKEN_PEPPER) в hex. В реестре хранится только он.
 * Даже при утечке таблицы лицензий без Script Properties API токен по хешу не подобрать.
 */
function hashToken_(token) {
  return mcHex_(Utilities.computeHmacSha256Signature(String(token || ''), mcPepper_()));
}

/** Сравнение без раннего выхода: время не зависит от того, в каком символе расхождение. */
function constantTimeEqual_(a, b) {
  a = String(a === null || a === undefined ? '' : a);
  b = String(b === null || b === undefined ? '' : b);
  var len = Math.max(a.length, b.length), diff = a.length ^ b.length;
  for (var i = 0; i < len; i++) diff |= (i < a.length ? a.charCodeAt(i) : 0) ^ (i < b.length ? b.charCodeAt(i) : 0);
  return diff === 0 && a.length > 0;
}

// ---------------------------------------------------------------- лицензия

/** Нормализованная лицензия (без лишних полей наружу — их отбирают обработчики). */
function mcNormLicense_(r) {
  if (!r) return null;
  return {
    licenseId: String(r.licenseId || '').trim(),
    clientId: String(r.clientId || '').trim(),
    clientTokenHash: String(r.clientTokenHash || '').trim().toLowerCase(),
    status: String(r.status || '').trim().toUpperCase(),
    validFrom: mcDay_(r.validFrom),
    validUntil: mcDay_(r.validUntil),
    allowedModules: mcList_(r.allowedModules).map(function (x) { return x.toUpperCase(); }),
    allowedDocuments: mcList_(r.allowedDocuments),
    maxInstallations: Math.max(0, parseInt(r.maxInstallations, 10) || 0),
    plan: String(r.plan || '').trim().toUpperCase()
  };
}

/** Лицензия по licenseId: кэш (MC_LICENSE_CACHE_SECONDS), иначе одна строка реестра через TextFinder. */
function getLicense_(licenseId) {
  var key = mcKey_('lic', licenseId), hit = mcCacheGet_(key);
  if (hit) return hit.none ? null : hit;
  var lic = mcNormLicense_(mcStore_().getLicense(licenseId));
  mcCachePut_(key, lic || { none: true }, lic ? mcCfgInt_('MC_LICENSE_CACHE_SECONDS', 300) : 60);
  return lic;
}

function mcDropLicenseCache_(licenseId) {
  mcCacheRemove_(mcKey_('lic', licenseId));
  mcCacheRemove_(mcKey_('inst', licenseId));
}

var MC_DUMMY_HASH_ = '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Проверка лицензии и токена для запроса. Возвращает { ok:true } или { ok:false, code }.
 * Установка проверяется здесь же (checkInstallation_), модуль и документ — в обработчиках.
 */
function checkLicense_(license, request) {
  var h = hashToken_(request.clientToken);       // считается всегда — время ответа одинаковое
  if (!license) { constantTimeEqual_(h, MC_DUMMY_HASH_); return { ok: false, code: 'LICENSE_NOT_FOUND' }; }
  var tokenOk = constantTimeEqual_(h, license.clientTokenHash);
  if (license.clientId !== String(request.clientId)) return { ok: false, code: 'CLIENT_MISMATCH' };
  if (!tokenOk) return { ok: false, code: 'INVALID_TOKEN' };

  if (license.status === 'EXPIRED') return { ok: false, code: 'LICENSE_EXPIRED' };
  if (license.status !== 'ACTIVE' && license.status !== 'TEST') return { ok: false, code: 'LICENSE_INACTIVE' };
  var today = mcDay_(new Date());
  if (!license.validFrom || !license.validUntil) return { ok: false, code: 'LICENSE_INACTIVE' };
  if (today < license.validFrom) return { ok: false, code: 'LICENSE_INACTIVE' };
  if (today > license.validUntil) return { ok: false, code: 'LICENSE_EXPIRED' };

  var inst = checkInstallation_(license, request);
  if (!inst.ok) return inst;
  return { ok: true };
}

/** Разрешён ли модуль лицензии. '*' — все модули. TEST-лицензия видит только модуль TEST. */
function isModuleAllowed_(license, module) {
  module = String(module || '').toUpperCase();
  if (!module) return false;
  if (license.status === 'TEST') return module === 'TEST';
  return license.allowedModules.indexOf('*') >= 0 || license.allowedModules.indexOf(module) >= 0;
}

// ---------------------------------------------------------------- установки

function mcInstallations_(licenseId, fresh) {
  var key = mcKey_('inst', licenseId);
  if (!fresh) { var hit = mcCacheGet_(key); if (hit) return hit; }
  var list = mcStore_().listInstallations(licenseId).map(function (r) {
    return { installationId: String(r.installationId), status: String(r.status || 'ACTIVE').toUpperCase() };
  });
  mcCachePut_(key, list, 600);
  return list;
}

/**
 * Установка разрешена, если она уже зарегистрирована (ACTIVE) или свободен слот (maxInstallations).
 * Новая установка регистрируется автоматически под блокировкой. Слот освобождает только владелец
 * (MC_releaseInstallation) — так переустановка не превращается в бесконечное число копий.
 */
function checkInstallation_(license, request) {
  var id = String(request.installationId), list = mcInstallations_(license.licenseId, false);
  var mine = list.filter(function (x) { return x.installationId === id; })[0];
  if (mine) return mine.status === 'ACTIVE' ? { ok: true } : { ok: false, code: 'INSTALLATION_NOT_ALLOWED', reason: 'blocked' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { ok: false, code: 'BUSY' };
  try {
    list = mcInstallations_(license.licenseId, true);
    mine = list.filter(function (x) { return x.installationId === id; })[0];
    if (mine) return mine.status === 'ACTIVE' ? { ok: true } : { ok: false, code: 'INSTALLATION_NOT_ALLOWED', reason: 'blocked' };
    var active = list.filter(function (x) { return x.status === 'ACTIVE'; }).length;
    if (active >= license.maxInstallations) {
      notifySuspiciousEvent_({ type: license.maxInstallations === 1 ? 'MULTI_INSTALL' : 'INSTALL_LIMIT', licenseId: license.licenseId,
        clientId: license.clientId, installationId: id, details: 'активных установок: ' + active + ', лимит: ' + license.maxInstallations });
      return { ok: false, code: 'INSTALLATION_NOT_ALLOWED', reason: 'limit' };
    }
    var now = mcNowIso_();
    mcStore_().insertInstallation({ licenseId: license.licenseId, installationId: id, status: 'ACTIVE', firstSeenAt: now,
      lastSeenAt: now, appVersion: String(request.appVersion || ''), notes: '' });
    mcStore_().updateLicense(license.licenseId, { currentInstallations: active + 1, updatedAt: now });
    mcCacheRemove_(mcKey_('inst', license.licenseId));
    writeAdminLog_('INSTALLATION_REGISTERED', license.licenseId, '', 'installationId=' + id);
    return { ok: true, registered: true };
  } finally { lock.releaseLock(); }
}

/**
 * Отметка «последнее обращение»: не чаще раза в 10 минут на лицензию — в таблицу не пишется каждый запрос.
 * Число запросов копится в кэше и переносится в requestCount при отметке.
 */
function touchLicense_(license, request) {
  var cnt = mcCacheIncr_(mcKey_('cnt', license.licenseId), 21600);
  var seenKey = mcKey_('seen', license.licenseId);
  if (mcCacheGet_(seenKey)) return;
  mcCachePut_(seenKey, { t: Date.now() }, 600);
  mcCacheRemove_(mcKey_('cnt', license.licenseId));
  try {
    var now = mcNowIso_();
    mcStore_().touchLicense(license.licenseId, cnt || 1, now, String(request.installationId));
    mcStore_().updateInstallation(license.licenseId, String(request.installationId), { lastSeenAt: now, appVersion: String(request.appVersion || '') });
  } catch (e) { /* отметка не должна ломать ответ */ }
}
