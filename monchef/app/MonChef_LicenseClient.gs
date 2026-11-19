/**
 * MON CHEF — подключение к сервису лицензирования MonChef License API (клиентская часть).
 *
 * Что делает: проверяет лицензию, узнаёт версию нормативной базы, загружает разрешённые лицензией
 * документы в папку Google Диска этой установки и показывает статус лицензии директору (Настройки → Лицензия).
 * Запросы выполняет только сервер Apps Script (UrlFetchApp). Адрес API и токен в HTML не попадают
 * и браузеру не отдаются.
 *
 * Какие данные уходят в License API: licenseId, clientId, installationId, токен установки, версия приложения,
 * название операции, documentId/модуль. Данные сотрудников, журналов, документов кухни, IP-адреса не передаются.
 * Об обращениях к сервису лицензирования клиент уведомлён в договоре и в инструкции (ДОК «Лицензия»).
 *
 * Без связи с API ничего не блокируется: записи, журналы и уже загруженные документы остаются доступны.
 * Режимы:
 *   OK         — последняя проверка успешна;
 *   GRACE      — API недоступен, с последней успешной проверки прошло меньше MC_OFFLINE_GRACE_DAYS дней;
 *   LIMITED    — API недоступен дольше льготного срока: работает последняя загруженная версия базы,
 *                обновления не загружаются, директору показывается предупреждение;
 *   BLOCKED    — сервис ответил, что лицензия истекла / отозвана / ключ не подходит: новые документы
 *                не загружаются, уже загруженные и все данные кухни остаются;
 *   NOT_CONFIGURED — подключение не настроено (система работает как раньше).
 * Повторы ограничены: после сбоя следующая попытка через 5 мин, 15 мин, 1 ч, затем раз в 6 ч.
 *
 * Script Properties клиента: MC_LICENSE_API_URL, MC_LICENSE_ID, MC_CLIENT_ID, MC_INSTALLATION_ID,
 * MC_CLIENT_TOKEN, MC_APP_VERSION; служебные: MC_OFFLINE_GRACE_DAYS, MC_LICENSE_STATE,
 * MC_LICENSE_LIBRARY_FOLDER_ID.
 */

var MC_LIC_STATE_PROP_ = 'MC_LICENSE_STATE';
var MC_LIC_INDEX_SHEET_ = 'Лицензия_Нормативная_база';
var MC_LIC_INDEX_HEAD_ = ['documentId', 'Название', 'Модуль', 'Категория', 'Официальный источник', 'Версия', 'SHA-256',
  'Файл (ID на Диске установки)', 'Загружен', 'Статус'];
var MC_LIC_BACKOFF_MIN_ = [5, 15, 60, 360];
var MC_LIC_DEFAULT_GRACE_DAYS_ = 7;
var MC_LIC_SYNC_MAX_DOCS_ = 25;            // за один запуск — не больше документов (лимит времени Apps Script)
var MC_LIC_SYNC_BUDGET_MS_ = 240000;       // и не дольше 4 минут
var MC_LIC_HARD_CODES_ = ['AUTH_FAILED', 'LICENSE_NOT_FOUND', 'CLIENT_MISMATCH', 'INVALID_TOKEN', 'LICENSE_EXPIRED',
  'LICENSE_INACTIVE', 'INSTALLATION_NOT_ALLOWED'];
var MC_LIC_MESSAGES_ = {
  AUTH_FAILED: 'Ключ лицензии не подходит. Обратитесь в MonChef: нужен новый ключ установки.',
  LICENSE_NOT_FOUND: 'Лицензия не найдена. Обратитесь в MonChef.',
  CLIENT_MISMATCH: 'Лицензия выдана другому клиенту. Обратитесь в MonChef.',
  INVALID_TOKEN: 'Ключ установки не подходит. Обратитесь в MonChef: нужен новый ключ.',
  LICENSE_EXPIRED: 'Срок лицензии истёк. Обновления нормативной базы не загружаются; данные кухни и загруженные документы сохранены.',
  LICENSE_INACTIVE: 'Лицензия приостановлена или отозвана. Обновления не загружаются; данные кухни и загруженные документы сохранены.',
  INSTALLATION_NOT_ALLOWED: 'Эта установка не зарегистрирована в лицензии (превышен лимит установок). Обратитесь в MonChef.',
  MODULE_NOT_ALLOWED: 'Модуль не входит в лицензию.',
  DOCUMENT_NOT_ALLOWED: 'Документ не входит в лицензию.',
  DOCUMENT_NOT_FOUND: 'Документ снят с публикации.',
  DOCUMENT_TOO_LARGE: 'Документ слишком большой для загрузки через сервис — запросите копию у MonChef.',
  DOCUMENT_INTEGRITY_FAILED: 'Документ временно недоступен (проверка целостности).',
  RATE_LIMIT_EXCEEDED: 'Сервис лицензирования просит повторить позже.',
  API_UNAVAILABLE: 'Сервис лицензирования недоступен. Работа продолжается с последней загруженной версией базы.',
  OFFLINE_BACKOFF: 'Сервис был недоступен — следующая попытка позже.',
  NOT_CONFIGURED: 'Подключение к сервису лицензирования не настроено.'
};
var MC_LIC_MODE_TEXT_ = {
  OK: 'Лицензия действует', GRACE: 'Нет связи с сервисом — льготный период', LIMITED: 'Ограниченный режим: база не обновляется',
  BLOCKED: 'Лицензия не действует', NOT_CONFIGURED: 'Не настроено'
};

// ---------------------------------------------------------------- настройки и состояние

function _mcLicProps_() {
  var p = PropertiesService.getScriptProperties(), all = p.getProperties() || {};
  if (!all.MC_INSTALLATION_ID) {
    all.MC_INSTALLATION_ID = 'INSTALL-' + Utilities.getUuid().toUpperCase();
    p.setProperty('MC_INSTALLATION_ID', all.MC_INSTALLATION_ID);
  }
  return {
    url: String(all.MC_LICENSE_API_URL || ''), licenseId: String(all.MC_LICENSE_ID || ''), clientId: String(all.MC_CLIENT_ID || ''),
    installationId: String(all.MC_INSTALLATION_ID), token: String(all.MC_CLIENT_TOKEN || ''),
    appVersion: String(all.MC_APP_VERSION || '1.0.0'),
    graceDays: parseInt(all.MC_OFFLINE_GRACE_DAYS, 10) || 0, folderId: String(all.MC_LICENSE_LIBRARY_FOLDER_ID || '')
  };
}
function _mcLicConfigured_(c) { return !!(c.url && c.licenseId && c.clientId && c.token); }

function _mcLicState_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(MC_LIC_STATE_PROP_) || '{}') || {}; } catch (e) { return {}; }
}
function _mcLicSaveState_(st) {
  try { PropertiesService.getScriptProperties().setProperty(MC_LIC_STATE_PROP_, JSON.stringify(st)); } catch (e) {}
}

function _mcLicRequestId_(c) {
  var ts = Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHHmmss');
  return (c.clientId + '-' + ts + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10)).slice(0, 120);
}

// ---------------------------------------------------------------- вызов API

/**
 * Один вызов License API. Сетевая ошибка или ответ не в формате API — API_UNAVAILABLE.
 * Временную ошибку повторяет один раз с тем же requestId (сервис вернёт сохранённый ответ),
 * дальше — пауза до следующей попытки (MC_LIC_BACKOFF_MIN_), бесконечных повторов нет.
 */
function _mcLicCall_(action, extra, opt) {
  opt = opt || {};
  var c = _mcLicProps_();
  if (!_mcLicConfigured_(c)) return { ok: false, error: 'NOT_CONFIGURED', local: true, retryable: false };
  var st = _mcLicState_(), now = Date.now();
  if (st.nextTryAt && st.nextTryAt > now && !opt.force) return { ok: false, error: 'OFFLINE_BACKOFF', local: true, retryable: true };

  var body = { requestId: _mcLicRequestId_(c), licenseId: c.licenseId, clientId: c.clientId, installationId: c.installationId,
    clientToken: c.token, action: action, appVersion: c.appVersion };
  Object.keys(extra || {}).forEach(function (k) { if (extra[k]) body[k] = String(extra[k]); });

  var res = null;
  for (var attempt = 0; attempt < 2; attempt++) {
    res = _mcLicFetch_(c.url, body);
    if (res.ok || !res.retryable || res.error === 'RATE_LIMIT_EXCEEDED') break;
    if (attempt === 0) Utilities.sleep(1500);
  }
  st = _mcLicState_();
  if (res.error === 'API_UNAVAILABLE' || (res.retryable && !res.ok)) {
    st.failures = (st.failures || 0) + 1;
    st.nextTryAt = Date.now() + MC_LIC_BACKOFF_MIN_[Math.min(st.failures, MC_LIC_BACKOFF_MIN_.length) - 1] * 60000;
  } else { st.failures = 0; st.nextTryAt = 0; }
  _mcLicSaveState_(st);
  return res;
}

function _mcLicFetch_(url, body) {
  try {
    var r = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify(body),
      muteHttpExceptions: true, followRedirects: true });
    var code = r.getResponseCode(), text = r.getContentText();
    if (code !== 200) return { ok: false, error: 'API_UNAVAILABLE', retryable: true, local: true };
    var obj = JSON.parse(text);
    if (!obj || typeof obj.ok !== 'boolean') return { ok: false, error: 'API_UNAVAILABLE', retryable: true, local: true };
    return obj;
  } catch (e) {
    return { ok: false, error: 'API_UNAVAILABLE', retryable: true, local: true };
  }
}

// ---------------------------------------------------------------- функции из ТЗ

/** Проверка лицензии. Обновляет сохранённое состояние, возвращает статус для экрана. */
function mcLicenseCheck_() {
  var r = _mcLicCall_('CHECK_LICENSE', {});
  var st = _mcLicState_(), now = Date.now();
  if (r.error !== 'OFFLINE_BACKOFF' && r.error !== 'NOT_CONFIGURED') st.lastCheckAt = now;
  if (r.ok) {
    st.lastOkAt = now; st.lastResult = 'OK'; st.serverError = ''; st.status = r.result.status;
    st.validFrom = r.result.validFrom; st.validUntil = r.result.validUntil; st.licenseId = r.result.licenseId;
    st.remoteLibraryVersion = r.result.libraryVersion; st.apiVersion = r.result.apiVersion;
    if (r.result.offlineGraceDays) st.graceDays = r.result.offlineGraceDays;
    _mcLicSaveState_(st);
  } else {
    if (r.error !== 'OFFLINE_BACKOFF' && r.error !== 'NOT_CONFIGURED') _mcLicSaveState_(st);
    mcHandleLicenseError_(r);
  }
  return _mcLicView_();
}

/** Версия нормативной базы и доступные модули. null — нет ответа (см. состояние). */
function mcGetLibraryVersion_() {
  var r = _mcLicCall_('GET_LIBRARY_VERSION', {});
  if (!r.ok) { mcHandleLicenseError_(r); return null; }
  var st = _mcLicState_(); st.remoteLibraryVersion = r.result.libraryVersion; st.modules = r.result.modules || []; _mcLicSaveState_(st);
  return r.result;
}

/** Список разрешённых документов модуля. Без связи — последний загруженный список из реестра установки. */
function mcListNormativeDocuments_(moduleName) {
  var r = _mcLicCall_('LIST_DOCUMENTS', { module: String(moduleName || '').toUpperCase() });
  if (r.ok) return { ok: true, online: true, documents: r.result.documents || [], libraryVersion: r.result.libraryVersion };
  var h = mcHandleLicenseError_(r);
  var idx = _mcLicIndex_(), mod = String(moduleName || '').toUpperCase();
  var local = Object.keys(idx).map(function (k) { return idx[k]; }).filter(function (d) { return d.module === mod; });
  return { ok: false, online: false, error: h.code, message: h.message, documents: local };
}

/**
 * Документ по documentId: { ok, meta, blob }. Содержимое сверяется с SHA-256 из ответа;
 * при расхождении документ не принимается.
 */
function mcGetNormativeDocument_(documentId) {
  var r = _mcLicCall_('GET_DOCUMENT', { documentId: documentId });
  if (!r.ok) { var h = mcHandleLicenseError_(r); return { ok: false, error: h.code, message: h.message }; }
  var res = r.result, bytes = Utilities.base64Decode(res.contentBase64 || '');
  var hex = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function (b) { var v = (b & 0xff).toString(16); return v.length < 2 ? '0' + v : v; }).join('');
  if (hex !== String(res.sha256 || '').toLowerCase()) return { ok: false, error: 'DOCUMENT_INTEGRITY_FAILED', message: MC_LIC_MESSAGES_.DOCUMENT_INTEGRITY_FAILED };
  var meta = {}; Object.keys(res).forEach(function (k) { if (k !== 'contentBase64') meta[k] = res[k]; });
  return { ok: true, meta: meta, blob: Utilities.newBlob(bytes, res.mimeType || 'application/octet-stream', res.fileName || documentId) };
}

/**
 * Разбор ошибки сервиса: что показать директору и что запомнить.
 * Окончательные отказы (ключ, срок, отзыв, установка) переводят в режим BLOCKED, временные — нет.
 */
function mcHandleLicenseError_(response) {
  var code = String(response && response.error || 'API_UNAVAILABLE');
  var msg = MC_LIC_MESSAGES_[code] || (response && response.message) || 'Ошибка сервиса лицензирования';
  if (code === 'NOT_CONFIGURED' || code === 'OFFLINE_BACKOFF') return { code: code, message: msg, mode: _mcLicMode_(_mcLicState_()) };
  var st = _mcLicState_();
  if (MC_LIC_HARD_CODES_.indexOf(code) >= 0) { st.serverError = code; st.lastResult = 'DENIED'; }
  else if (code === 'API_UNAVAILABLE' || (response && response.retryable)) { st.lastResult = 'UNAVAILABLE'; }
  st.lastError = code; st.lastErrorAt = Date.now();
  _mcLicSaveState_(st);
  try { if (typeof _log_ === 'function') _log_('WARN', 'Лицензия: ' + code); } catch (e) {}
  return { code: code, message: msg, mode: _mcLicMode_(st) };
}

// ---------------------------------------------------------------- режим и статус

function _mcLicGraceDays_(st) {
  var c = _mcLicProps_();
  return c.graceDays || st.graceDays || MC_LIC_DEFAULT_GRACE_DAYS_;
}

function _mcLicMode_(st) {
  if (!_mcLicConfigured_(_mcLicProps_())) return 'NOT_CONFIGURED';
  if (st.lastResult === 'DENIED' && st.serverError) return 'BLOCKED';
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'UTC', 'yyyy-MM-dd');
  if (st.lastResult === 'OK' && (!st.validUntil || today <= st.validUntil)) return 'OK';
  if (!st.lastOkAt) return 'LIMITED';
  var graceUntil = st.lastOkAt + _mcLicGraceDays_(st) * 86400000;
  if (Date.now() <= graceUntil && (!st.validUntil || today <= st.validUntil)) return 'GRACE';
  return 'LIMITED';
}

/** Можно ли загружать обновления базы прямо сейчас. */
function _mcLicCanSync_(mode) { return mode === 'OK'; }

function _mcLicFmt_(ms) {
  if (!ms) return '';
  try { return Utilities.formatDate(new Date(ms), Session.getScriptTimeZone() || 'UTC', 'dd.MM.yyyy HH:mm'); } catch (e) { return ''; }
}

function _mcLicView_() {
  var c = _mcLicProps_(), st = _mcLicState_(), mode = _mcLicMode_(st), idx = _mcLicIndex_();
  var grace = _mcLicGraceDays_(st);
  var msg = mode === 'BLOCKED' ? (MC_LIC_MESSAGES_[st.serverError] || '') :
    mode === 'GRACE' ? 'Нет связи с сервисом лицензирования. Льготный период до ' + _mcLicFmt_(st.lastOkAt + grace * 86400000) + '.' :
    mode === 'LIMITED' ? 'Нет подтверждения лицензии дольше ' + grace + ' дн. Работает последняя загруженная версия базы; данные кухни не затронуты.' :
    mode === 'NOT_CONFIGURED' ? MC_LIC_MESSAGES_.NOT_CONFIGURED : '';
  return {
    ok: true, configured: _mcLicConfigured_(c), mode: mode, modeText: MC_LIC_MODE_TEXT_[mode] || mode, message: msg,
    licenseId: c.licenseId, clientId: c.clientId, installationId: c.installationId,
    status: st.status || '', validFrom: st.validFrom || '', validUntil: st.validUntil || '',
    lastOkAt: _mcLicFmt_(st.lastOkAt), lastCheckAt: _mcLicFmt_(st.lastCheckAt), lastError: st.lastError || '',
    graceDays: grace, remoteLibraryVersion: st.remoteLibraryVersion || '', localLibraryVersion: st.localLibraryVersion || '',
    lastSyncAt: _mcLicFmt_(st.lastSyncAt), documents: Object.keys(idx).length,
    nextTryAt: st.nextTryAt && st.nextTryAt > Date.now() ? _mcLicFmt_(st.nextTryAt) : ''
  };
}

// ---------------------------------------------------------------- загрузка базы

/** Реестр загруженных документов установки (лист книги MON CHEF). */
function _mcLicIndexSheet_(create) {
  if (typeof _book_ !== 'function') return null;
  var ss = _book_(), sh = ss.getSheetByName(MC_LIC_INDEX_SHEET_);
  if (!sh && create) {
    sh = ss.insertSheet(MC_LIC_INDEX_SHEET_);
    sh.getRange(1, 1, 1, MC_LIC_INDEX_HEAD_.length).setValues([MC_LIC_INDEX_HEAD_]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
function _mcLicIndex_() {
  var out = {};
  try {
    var sh = _mcLicIndexSheet_(false);
    if (!sh || sh.getLastRow() < 2) return out;
    sh.getRange(2, 1, sh.getLastRow() - 1, MC_LIC_INDEX_HEAD_.length).getValues().forEach(function (r, i) {
      if (!r[0]) return;
      out[String(r[0])] = { documentId: String(r[0]), title: String(r[1]), module: String(r[2]), category: String(r[3]),
        isOfficialSource: r[4] === true || r[4] === 'TRUE' || r[4] === 'да', version: String(r[5]), sha256: String(r[6]),
        fileId: String(r[7]), syncedAt: r[8], status: String(r[9]), _row: i + 2 };
    });
  } catch (e) {}
  return out;
}
function _mcLicIndexPut_(rec) {
  var sh = _mcLicIndexSheet_(true);
  if (!sh) return;
  var row = [rec.documentId, rec.title, rec.module, rec.category, rec.isOfficialSource ? 'да' : 'нет', rec.version, rec.sha256,
    rec.fileId, rec.syncedAt, rec.status];
  if (rec._row) sh.getRange(rec._row, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
}

function _mcLicFolder_() {
  var c = _mcLicProps_();
  if (c.folderId) { try { return DriveApp.getFolderById(c.folderId); } catch (e) {} }
  var parent = null;
  try { if (typeof _book_ === 'function') { var it = DriveApp.getFileById(_book_().getId()).getParents(); if (it.hasNext()) parent = it.next(); } } catch (e) {}
  var f = (parent || DriveApp.getRootFolder()).createFolder('MonChef — нормативная база (по лицензии)');
  PropertiesService.getScriptProperties().setProperty('MC_LICENSE_LIBRARY_FOLDER_ID', f.getId());
  return f;
}

/**
 * Синхронизация разрешённых документов: только в режиме OK. Загружаются новые и изменившиеся
 * (по SHA-256) документы. Ничего не удаляется: старая версия файла остаётся на Диске, документ,
 * снятый с публикации, помечается в реестре «Снят с публикации».
 */
function mcLicenseSyncLibrary_() {
  var t0 = Date.now(), st = _mcLicState_(), mode = _mcLicMode_(st), report = { mode: mode, loaded: 0, unchanged: 0, skipped: [], removed: 0 };
  if (!_mcLicCanSync_(mode)) return report;
  var lib = mcGetLibraryVersion_();
  if (!lib) return report;
  var idx = _mcLicIndex_(), seen = {}, folder = null;
  for (var m = 0; m < (lib.modules || []).length; m++) {
    var list = mcListNormativeDocuments_(lib.modules[m]);
    if (!list.ok) { report.skipped.push(lib.modules[m] + ': ' + list.error); continue; }
    for (var i = 0; i < list.documents.length; i++) {
      var d = list.documents[i], cur = idx[d.documentId];
      seen[d.documentId] = true;
      if (cur && cur.sha256 === d.sha256 && cur.status === 'Загружен') { report.unchanged++; continue; }
      if (report.loaded >= MC_LIC_SYNC_MAX_DOCS_ || Date.now() - t0 > MC_LIC_SYNC_BUDGET_MS_) { report.skipped.push(d.documentId + ': в следующий запуск'); continue; }
      var g = mcGetNormativeDocument_(d.documentId);
      if (!g.ok) { report.skipped.push(d.documentId + ': ' + g.error); continue; }
      folder = folder || _mcLicFolder_();
      var file = folder.createFile(g.blob.setName(d.documentId + ' — ' + String(d.title).slice(0, 80) + ' (v' + d.version + ')' + (/\.[a-z0-9]+$/i.exec(g.meta.fileName || '') || [''])[0]));
      _mcLicIndexPut_({ documentId: d.documentId, title: d.title, module: d.module, category: d.category, isOfficialSource: d.isOfficialSource,
        version: d.version, sha256: d.sha256, fileId: file.getId(), syncedAt: new Date(), status: 'Загружен', _row: cur ? cur._row : 0 });
      report.loaded++;
    }
  }
  Object.keys(idx).forEach(function (id) {
    if (!seen[id] && idx[id].status === 'Загружен' && report.skipped.length === 0) {
      var rec = idx[id]; rec.status = 'Снят с публикации'; _mcLicIndexPut_(rec); report.removed++;
    }
  });
  st = _mcLicState_();
  st.lastSyncAt = Date.now();
  if (!report.skipped.length) st.localLibraryVersion = lib.libraryVersion;
  _mcLicSaveState_(st);
  return report;
}

// ---------------------------------------------------------------- для интерфейса и расписания

/** Статус лицензии для директора (Настройки). Сеть не используется — показывается сохранённое состояние. */
function mcLicenseStatus(token) {
  return JSON.stringify(_mcLicView_());
}

/** «Проверить сейчас»: проверка лицензии и загрузка обновлений базы. */
function mcLicenseRefresh(token) {
  var view = mcLicenseCheck_();
  var sync = view.mode === 'OK' ? mcLicenseSyncLibrary_() : null;
  var out = _mcLicView_(); out.sync = sync;
  return JSON.stringify(out);
}

/** Ежедневная проверка по расписанию (ставится mcLicenseConfigure). */
function mcLicenseDailyCheck(e) {
  var view = mcLicenseCheck_();
  if (view.mode === 'OK') mcLicenseSyncLibrary_();
  return JSON.stringify(_mcLicView_());
}

/**
 * Настройка подключения (технический доступ): json = { url, licenseId, clientId, clientToken, appVersion }.
 * Токен сохраняется в Script Properties этой установки и обратно не показывается.
 */
function mcLicenseConfigure(json, token) {
  var o;
  try { o = typeof json === 'string' ? JSON.parse(json) : (json || {}); } catch (e) { return JSON.stringify({ ok: false, error: 'Некорректные данные' }); }
  var p = PropertiesService.getScriptProperties();
  if (o.url) {
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(String(o.url))) return JSON.stringify({ ok: false, error: 'Адрес API: https://script.google.com/macros/s/…/exec' });
    p.setProperty('MC_LICENSE_API_URL', String(o.url));
  }
  if (o.licenseId) p.setProperty('MC_LICENSE_ID', String(o.licenseId).trim());
  if (o.clientId) p.setProperty('MC_CLIENT_ID', String(o.clientId).trim());
  if (o.clientToken) p.setProperty('MC_CLIENT_TOKEN', String(o.clientToken).trim());
  if (o.appVersion) p.setProperty('MC_APP_VERSION', String(o.appVersion).trim());
  var st = _mcLicState_(); st.nextTryAt = 0; st.failures = 0; st.serverError = ''; st.lastResult = ''; _mcLicSaveState_(st);
  try {
    if (!ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'mcLicenseDailyCheck'; }))
      ScriptApp.newTrigger('mcLicenseDailyCheck').timeBased().everyDays(1).atHour(4).create();
  } catch (e) {}
  return mcLicenseRefresh(token);
}

/** Строки для вкладки «Лицензия» раздела «Настройки». */
function _mcLicUiRows_() {
  var v = _mcLicView_();
  var rows = [
    { k: 'Состояние', v: v.modeText, s: v.mode === 'OK' ? 'Норма' : v.mode === 'NOT_CONFIGURED' ? '' : v.mode === 'GRACE' ? 'Внимание' : 'Отклонение' },
    { k: 'Лицензия', v: v.licenseId || '—', s: '' },
    { k: 'Срок действия', v: v.validUntil ? (v.validFrom ? v.validFrom + ' — ' : 'до ') + v.validUntil : '—', s: '' },
    { k: 'Последняя успешная проверка', v: v.lastOkAt || '—', s: '' },
    { k: 'Льготный период без связи', v: v.graceDays + ' дн.', s: '' },
    { k: 'Версия нормативной базы', v: (v.localLibraryVersion || '—') + (v.remoteLibraryVersion && v.remoteLibraryVersion !== v.localLibraryVersion ? ' (доступна ' + v.remoteLibraryVersion + ')' : ''), s: '' },
    { k: 'Загружено документов', v: String(v.documents), s: '' }
  ];
  if (v.message) rows.push({ k: 'Пояснение', v: v.message, s: '' });
  return rows;
}
