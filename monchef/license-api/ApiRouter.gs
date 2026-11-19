/**
 * MonChef License API — единственная точка входа для клиентов: doPost(e).
 *
 * Порядок (ТЗ, п. 16):
 *   1) разобрать JSON;  2) размер и обязательные поля;  3) найти лицензию;  4) лицензия и токен;
 *   5) частота запросов;  6) идемпотентность requestId;  7) разрешённый обработчик;  8) аудит;  9) JSON без секретов.
 *
 * Административные функции (MC_*) через doPost недоступны: обработчики — только MC_HANDLERS_.
 * В ответ не попадают stack trace, имена функций, ID таблиц и папок, OAuth-токены, тексты исключений Google.
 */

var MC_HANDLERS_ = {
  CHECK_LICENSE: function (req, lic) {
    var info = mcLibraryInfo_();
    return { ok: true, result: { licenseId: lic.licenseId, clientId: lic.clientId, status: lic.status,
      validFrom: lic.validFrom, validUntil: lic.validUntil, apiVersion: mcCfg_('MC_API_VERSION'),
      libraryVersion: info.libraryVersion, offlineGraceDays: mcCfgInt_('MC_OFFLINE_GRACE_DAYS', 7) } };
  },

  GET_LIBRARY_VERSION: function (req, lic) {
    var info = mcLibraryInfo_();
    return { ok: true, result: { libraryVersion: info.libraryVersion, publishedAt: info.publishedAt, modules: mcLicenseModules_(lic) } };
  },

  LIST_DOCUMENTS: function (req, lic) {
    if (!isModuleAllowed_(lic, req.module)) {
      notifySuspiciousEvent_({ type: 'FORBIDDEN_MODULE', licenseId: lic.licenseId, clientId: lic.clientId, installationId: req.installationId, module: req.module });
      return { ok: false, code: 'MODULE_NOT_ALLOWED' };
    }
    return { ok: true, result: { module: req.module, libraryVersion: mcLibraryInfo_().libraryVersion,
      documents: listDocumentsForLicense_(lic, req.module) } };
  },

  GET_DOCUMENT: function (req, lic) {
    var r = readDocumentForLicense_(lic, req.documentId);
    if (!r.ok && (r.code === 'MODULE_NOT_ALLOWED' || r.code === 'DOCUMENT_NOT_ALLOWED')) {
      notifySuspiciousEvent_({ type: r.code === 'MODULE_NOT_ALLOWED' ? 'FORBIDDEN_MODULE' : 'FORBIDDEN_DOCUMENT', licenseId: lic.licenseId,
        clientId: lic.clientId, installationId: req.installationId, documentId: req.documentId, module: r.doc ? r.doc.module : '' });
    }
    return r.ok ? r : { ok: false, code: r.code };
  }
};

function doPost(e) {
  var body = '', len = 0;
  try { if (e && e.postData) { body = e.postData.contents || ''; len = e.postData.length || 0; } } catch (x) {}
  return mcJsonOut_(MC_handleRequest_(body, len));
}

/** GET не обслуживается: ничего о сервисе не сообщается. */
function doGet() {
  return mcJsonOut_(mcErrorResp_('', 'METHOD_NOT_ALLOWED'));
}

function mcJsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function mcSuccessResp_(requestId, result) {
  return { ok: true, requestId: requestId || '', result: result || {}, serverTime: mcNowIso_() };
}

function mcErrorResp_(requestId, code) {
  var ext = mcExternalCode_(code), e = MC_ERRORS_[ext] || MC_ERRORS_.INTERNAL_ERROR;
  return { ok: false, requestId: requestId || '', error: ext, message: e[0], retryable: !!e[1], serverTime: mcNowIso_() };
}

/** Ядро обработки (doPost и тесты). Никогда не бросает исключение. */
function MC_handleRequest_(body, declaredLength) {
  var t0 = Date.now(), createdAt = mcNowIso_();
  var audit = { requestId: '', licenseId: '', clientId: '', installationId: '', action: '', documentId: '', module: '', appVersion: '', result: 'ERROR', errorCode: '' };
  var resp, req = null, begun = false;
  try {
    // 1–2. JSON, размер, поля
    var v = validateRequest_(body, declaredLength);
    if (!v.ok) {
      audit.requestId = v.requestId || ''; audit.errorCode = v.code + (v.field ? ':' + String(v.field).slice(0, 40) : '');
      return (resp = mcErrorResp_(v.requestId, v.code));
    }
    req = v.req;
    ['requestId', 'licenseId', 'clientId', 'installationId', 'action', 'documentId', 'module', 'appVersion'].forEach(function (k) { audit[k] = req[k]; });

    // 3–4. лицензия, токен, статус, срок, установка
    var lic = getLicense_(req.licenseId);
    var chk = checkLicense_(lic, req);
    if (!chk.ok) {
      audit.errorCode = chk.code;
      if (chk.code !== 'BUSY') mcNoteFailure_(req, chk.code);
      return (resp = mcErrorResp_(req.requestId, chk.code));
    }
    mcNoteAuthSuccess_(req);

    // 5. частота
    if (!rateLimitOk_(req.licenseId, req.action)) {
      audit.errorCode = 'RATE_LIMIT_EXCEEDED';
      return (resp = mcErrorResp_(req.requestId, 'RATE_LIMIT_EXCEEDED'));
    }

    // 6. идемпотентность
    var idem = beginRequest_(req);
    if (idem.state === 'MISMATCH') { audit.errorCode = 'REQUEST_ID_PAYLOAD_MISMATCH'; return (resp = mcErrorResp_(req.requestId, 'REQUEST_ID_PAYLOAD_MISMATCH')); }
    if (idem.state === 'PROCESSING') { audit.errorCode = 'PROCESSING'; return (resp = mcErrorResp_(req.requestId, 'PROCESSING')); }
    if (idem.state === 'BUSY') { audit.errorCode = 'BUSY'; return (resp = mcErrorResp_(req.requestId, 'BUSY')); }
    if (idem.state === 'DONE') {
      var saved = null;
      try { saved = JSON.parse(idem.response); } catch (x) {}
      if (saved && !(saved.result && saved.result.contentOmitted) && !saved.contentOmitted) {
        saved.replayed = true;
        audit.result = 'REPLAY'; audit.errorCode = saved.ok ? '' : saved.error;
        return (resp = saved);
      }
      // сохранённый ответ без содержимого документа: выполнить чтение заново (только чтение, те же проверки)
      var again = MC_HANDLERS_[req.action](req, lic);
      resp = again.ok ? mcSuccessResp_(req.requestId, again.result) : mcErrorResp_(req.requestId, again.code);
      resp.replayed = true;
      audit.result = 'REPLAY'; audit.errorCode = again.ok ? '' : again.code;
      return resp;
    }
    begun = true;

    // 7. обработчик
    var out = MC_HANDLERS_[req.action](req, lic);
    resp = out.ok ? mcSuccessResp_(req.requestId, out.result) : mcErrorResp_(req.requestId, out.code);
    audit.result = out.ok ? 'OK' : 'ERROR'; audit.errorCode = out.ok ? '' : out.code;
    if (!out.ok) mcNoteFailure_(req, out.code);
    finishRequest_(req, resp, createdAt);
    begun = false;
    touchLicense_(lic, req);
    return resp;
  } catch (err) {
    var code = err && err.mcCode && MC_ERRORS_[err.mcCode] ? err.mcCode : 'INTERNAL_ERROR';
    if (code !== 'SERVICE_UNAVAILABLE' && code !== 'INTERNAL_ERROR') code = 'INTERNAL_ERROR';
    try { console.error('MC_handleRequest_: ' + (err && err.message ? err.message : err)); } catch (x) {}   // только журнал выполнения владельца
    audit.errorCode = code;
    resp = mcErrorResp_(audit.requestId, code);
    return resp;
  } finally {
    if (begun && req) { try { abortRequest_(req); } catch (x) {} }
    audit.durationMs = Date.now() - t0;
    writeAudit_(audit);
  }
}
