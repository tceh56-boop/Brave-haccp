/**
 * MonChef License API — тесты (ТЗ, п. 20).
 *
 * Запуск: в редакторе Apps Script — функция MC_runAllTests (журнал выполнения покажет отчёт);
 * локально — node tools/run_tests.js (эмулятор Apps Script).
 *
 * Тесты не трогают рабочие данные: реестр и Drive подменяются хранилищем в памяти (mcUseStoreForTest_),
 * настройки — _MC_CFG_OVERRIDE_, кэш — отдельным пространством ключей (_MC_CACHE_NS_), письма не отправляются.
 * Тесты клиентского коннектора (недоступность API, offline grace period) — tools/run_tests.js.
 */

// ---------------------------------------------------------------- хранилище в памяти

function mcMemStore_() {
  var t = { licenses: [], documents: [], installations: [], requests: [], audit: [], admin: [] };
  var down = { sheets: false };
  var copy = function (o) { return o ? JSON.parse(JSON.stringify(o)) : null; };
  var guard = function () { if (down.sheets) throw mcFail_('SERVICE_UNAVAILABLE', 'таблица недоступна (тест)'); };
  return {
    kind: 'memory', tables: t, down: down,
    getLicense: function (id) { guard(); return copy(t.licenses.filter(function (r) { return r.licenseId === id; })[0]); },
    listLicenses: function () { guard(); return copy(t.licenses); },
    insertLicense: function (o) { guard(); t.licenses.push(copy(o)); },
    updateLicense: function (id, p) { guard(); t.licenses.forEach(function (r) { if (r.licenseId === id) Object.keys(p).forEach(function (k) { r[k] = p[k]; }); }); },
    touchLicense: function (id, add, at, inst) { guard(); t.licenses.forEach(function (r) { if (r.licenseId === id) { r.lastSeenAt = at; r.lastSeenInstallationId = inst; r.requestCount = (r.requestCount || 0) + add; } }); },
    listDocuments: function () { guard(); return copy(t.documents); },
    insertDocument: function (o) { guard(); t.documents.push(copy(o)); },
    updateDocument: function (id, p) { guard(); t.documents.forEach(function (r) { if (r.documentId === id) Object.keys(p).forEach(function (k) { r[k] = p[k]; }); }); },
    listInstallations: function (id) { guard(); return copy(t.installations.filter(function (r) { return r.licenseId === id; })); },
    insertInstallation: function (o) { guard(); t.installations.push(copy(o)); },
    updateInstallation: function (lic, inst, p) { guard(); var hit = false; t.installations.forEach(function (r) { if (r.licenseId === lic && r.installationId === inst) { hit = true; Object.keys(p).forEach(function (k) { r[k] = p[k]; }); } }); return hit; },
    getRequest: function (lic, rid) { guard(); return copy(t.requests.filter(function (r) { return r.licenseId === lic && r.requestId === rid; })[0]); },
    insertRequest: function (o) { guard(); t.requests.push(copy(o)); },
    appendAudit: function (o) { t.audit.push(copy(o)); },
    appendAdminLog: function (o) { t.admin.push(copy(o)); }
  };
}

function mcMemDrive_() {
  var files = {}, state = { down: false };
  return {
    kind: 'memory', files: files, state: state,
    put: function (id, text, mime) { files[id] = { bytes: Utilities.newBlob(text).getBytes(), mime: mime || 'text/plain', trashed: false }; return files[id]; },
    getFile: function (id) {
      if (state.down) throw mcFail_('SERVICE_UNAVAILABLE', 'Drive недоступен (тест)');
      var f = files[id];
      if (!f) throw mcFail_('SERVICE_UNAVAILABLE', 'нет файла (тест)');
      return { getSize: function () { return f.bytes.length; }, getBlob: function () { return { getBytes: function () { return f.bytes.slice(); } }; },
        getMimeType: function () { return f.mime; }, isTrashed: function () { return f.trashed; },
        getLastUpdated: function () { return new Date(1700000000000); }, getName: function () { return id; } };
    },
    isInRoot: function (id) { return !!files[id]; }
  };
}

// ---------------------------------------------------------------- окружение теста

function mcTestEnv_(cfg) {
  var run = 't' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  _MC_CACHE_NS_ = 'mctest_' + run + '_';
  _MC_NOTIFY_SENT_ = [];
  _MC_CFG_OVERRIDE_ = { MC_TOKEN_PEPPER: 'test-pepper-' + run, MC_ADMIN_EMAIL: '', MC_LIBRARY_VERSION: '2026.11.19.120000',
    MC_LIBRARY_PUBLISHED_AT: '2026-11-19T12:00:00.000Z', MC_LICENSE_REGISTRY_SHEET_ID: 'SECRET-REGISTRY-ID',
    MC_NORMATIVE_ROOT_FOLDER_ID: 'SECRET-ROOT-FOLDER-ID', MC_RATE_LIMIT_PER_LICENSE: '60', MC_RATE_LIMIT_GET_DOCUMENT: '20',
    MC_STRICT_AUTH_ERRORS: 'true', MC_MAX_DOCUMENT_BYTES: '5242880', MC_HASH_ON_REQUEST_MAX_BYTES: '1048576' };
  Object.keys(cfg || {}).forEach(function (k) { _MC_CFG_OVERRIDE_[k] = cfg[k]; });
  var store = mcMemStore_(), drive = mcMemDrive_();
  mcUseStoreForTest_(store, drive);

  var today = new Date(), day = function (n) { return mcDay_(new Date(today.getTime() + n * 86400000)); };
  var env = { run: run, store: store, drive: drive, tokens: {}, seq: 0 };
  var addLic = function (id, clientId, o) {
    var token = generateClientToken_();
    env.tokens[id] = token;
    store.insertLicense(Object.assign({ licenseId: id, clientId: clientId, customerName: 'Клиент ' + id, customerEmail: 'secret-' + id + '@example.invalid',
      clientTokenHash: hashToken_(token), status: 'ACTIVE', validFrom: day(-30), validUntil: day(300), allowedModules: 'NORM_BASE,TEMPLATES',
      allowedDocuments: '*', maxInstallations: 1, currentInstallations: 0, notes: 'SECRET-NOTE-' + id, plan: 'STANDARD' }, o || {}));
  };
  var addDoc = function (id, module, text, o) {
    var fileId = 'FILE-' + id + '-' + run;
    drive.put(fileId, text, 'text/plain');
    store.insertDocument(Object.assign({ documentId: id, fileId: fileId, title: 'Документ ' + id, description: '', module: module, version: '2026.11',
      status: 'ACTIVE', mimeType: 'text/plain', sha256: mcSha256Hex_(Utilities.newBlob(text).getBytes()), sizeBytes: Utilities.newBlob(text).getBytes().length,
      allowedPlans: '*', publishedAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', isOfficialSource: false, sourceUrl: '', category: 'MONCHEF_GUIDE' }, o || {}));
  };
  addLic('MC-T-0001', 'CLIENT-0001');
  addLic('MC-T-0002', 'CLIENT-0002', { allowedModules: 'TEMPLATES', allowedDocuments: 'TPL-0002' });
  addLic('MC-T-EXP', 'CLIENT-0003', { validUntil: day(-1) });
  addLic('MC-T-REV', 'CLIENT-0004', { status: 'REVOKED' });
  addLic('MC-T-TEST', 'CLIENT-TEST', { status: 'TEST', plan: 'TEST', allowedModules: 'TEST', allowedDocuments: '*' });
  addDoc('NORM-0001', 'NORM_BASE', 'Норматив 1');
  addDoc('NORM-0002', 'NORM_BASE', 'Норматив 2', { allowedPlans: 'PRO' });
  addDoc('NORM-DRAFT', 'NORM_BASE', 'Черновик', { status: 'DRAFT' });
  addDoc('NORM-INT', 'NORM_BASE', 'Внутреннее', { category: 'INTERNAL' });
  addDoc('NORM-BIG', 'NORM_BASE', 'Большой', { sizeBytes: 6 * 1024 * 1024 });
  addDoc('TPL-0001', 'TEMPLATES', 'Шаблон 1', { category: 'TEMPLATE' });
  addDoc('TPL-0002', 'TEMPLATES', 'Шаблон 2 (только для CLIENT-0002)', { category: 'TEMPLATE' });
  addDoc('LAB-0001', 'LAB', 'Модуль лаборатории', { category: 'METHODOLOGY' });
  addDoc('TEST-0001', 'TEST', 'Тестовый документ', { category: 'TEMPLATE', allowedPlans: 'TEST' });

  env.req = function (licenseId, o) {
    env.seq++;
    var lic = env.store.tables.licenses.filter(function (l) { return l.licenseId === licenseId; })[0] || {};
    return Object.assign({ requestId: 'REQ-' + run + '-' + ('00000' + env.seq).slice(-6), licenseId: licenseId, clientId: lic.clientId || 'CLIENT-X',
      installationId: 'INSTALL-' + licenseId + '-A', clientToken: env.tokens[licenseId] || 'mct_' + new Array(50).join('x'), action: 'CHECK_LICENSE', appVersion: '1.0.0' }, o || {});
  };
  env.call = function (body) {
    var raw = typeof body === 'string' ? body : JSON.stringify(body);
    var r = MC_handleRequest_(raw, raw.length);
    env.responses = (env.responses || []).concat([JSON.stringify(r)]);
    return r;
  };
  return env;
}

function mcTestCleanup_() {
  _MC_CFG_OVERRIDE_ = null; _MC_CACHE_NS_ = ''; _MC_STORE_ = null; _MC_DRIVE_ = null;
}

function mcAssert_(cond, msg) { if (!cond) throw new Error(msg); }
function mcEq_(a, b, msg) { if (a !== b) throw new Error((msg || 'ожидалось') + ': ' + JSON.stringify(b) + ', получено ' + JSON.stringify(a)); }

// ---------------------------------------------------------------- тесты

var MC_TESTS_ = [
  ['Активная лицензия: CHECK_LICENSE', function (env) {
    var r = env.call(env.req('MC-T-0001'));
    mcEq_(r.ok, true, 'ok'); mcEq_(r.result.status, 'ACTIVE'); mcEq_(r.result.licenseId, 'MC-T-0001');
    mcEq_(r.result.libraryVersion, '2026.11.19.120000'); mcEq_(r.result.offlineGraceDays, 7);
    var keys = Object.keys(r.result).sort().join(',');
    mcEq_(keys, 'apiVersion,clientId,libraryVersion,licenseId,offlineGraceDays,status,validFrom,validUntil', 'поля ответа');
  }],
  ['Неизвестная лицензия: AUTH_FAILED наружу, LICENSE_NOT_FOUND в аудите, уведомление', function (env) {
    var r = env.call(env.req('MC-T-NOPE', { clientId: 'CLIENT-0001' }));
    mcEq_(r.ok, false); mcEq_(r.error, 'AUTH_FAILED');
    mcEq_(env.store.tables.audit.slice(-1)[0].errorCode, 'LICENSE_NOT_FOUND', 'аудит');
    mcAssert_(_MC_NOTIFY_SENT_.some(function (n) { return n.type === 'UNKNOWN_LICENSE'; }), 'нет уведомления UNKNOWN_LICENSE');
  }],
  ['Неверный clientId', function (env) {
    var r = env.call(env.req('MC-T-0001', { clientId: 'CLIENT-0002' }));
    mcEq_(r.error, 'AUTH_FAILED'); mcEq_(env.store.tables.audit.slice(-1)[0].errorCode, 'CLIENT_MISMATCH');
  }],
  ['Неверный токен; 5 подряд — уведомление BAD_TOKENS', function (env) {
    for (var i = 0; i < 5; i++) {
      var r = env.call(env.req('MC-T-0001', { clientToken: 'mct_' + new Array(45).join('A') + i }));
      mcEq_(r.error, 'AUTH_FAILED');
    }
    mcEq_(env.store.tables.audit.slice(-1)[0].errorCode, 'INVALID_TOKEN');
    mcAssert_(_MC_NOTIFY_SENT_.some(function (n) { return n.type === 'BAD_TOKENS'; }), 'нет уведомления BAD_TOKENS');
  }],
  ['Нестрогий режим: точные коды наружу', function (env) {
    _MC_CFG_OVERRIDE_.MC_STRICT_AUTH_ERRORS = 'false';
    mcEq_(env.call(env.req('MC-T-0001', { clientToken: 'mct_' + new Array(45).join('B') })).error, 'INVALID_TOKEN');
    mcEq_(env.call(env.req('MC-T-NOPE')).error, 'LICENSE_NOT_FOUND');
  }],
  ['Истёкшая лицензия: LICENSE_EXPIRED и уведомление', function (env) {
    var r = env.call(env.req('MC-T-EXP'));
    mcEq_(r.error, 'LICENSE_EXPIRED'); mcEq_(r.retryable, false);
    mcAssert_(_MC_NOTIFY_SENT_.some(function (n) { return n.type === 'INACTIVE_LICENSE_USE'; }), 'нет уведомления');
  }],
  ['Отозванная лицензия: LICENSE_INACTIVE', function (env) {
    mcEq_(env.call(env.req('MC-T-REV')).error, 'LICENSE_INACTIVE');
  }],
  ['Статус и срок не раскрываются без верного токена', function (env) {
    mcEq_(env.call(env.req('MC-T-REV', { clientToken: 'mct_' + new Array(45).join('C') })).error, 'AUTH_FAILED');
  }],
  ['Запрещённый модуль: MODULE_NOT_ALLOWED и уведомление', function (env) {
    var r = env.call(env.req('MC-T-0001', { action: 'LIST_DOCUMENTS', module: 'LAB' }));
    mcEq_(r.error, 'MODULE_NOT_ALLOWED');
    mcAssert_(_MC_NOTIFY_SENT_.some(function (n) { return n.type === 'FORBIDDEN_MODULE'; }), 'нет уведомления');
    mcEq_(env.call(env.req('MC-T-0001', { action: 'GET_DOCUMENT', documentId: 'LAB-0001' })).error, 'MODULE_NOT_ALLOWED');
  }],
  ['Запрещённый документ: DOCUMENT_NOT_ALLOWED (не тот тариф / не в списке)', function (env) {
    mcEq_(env.call(env.req('MC-T-0001', { action: 'GET_DOCUMENT', documentId: 'NORM-0002' })).error, 'DOCUMENT_NOT_ALLOWED');
    mcEq_(env.call(env.req('MC-T-0002', { action: 'GET_DOCUMENT', documentId: 'TPL-0001' })).error, 'DOCUMENT_NOT_ALLOWED');
    mcAssert_(_MC_NOTIFY_SENT_.some(function (n) { return n.type === 'FORBIDDEN_DOCUMENT'; }), 'нет уведомления');
  }],
  ['LIST_DOCUMENTS: только разрешённые, без fileId и ссылок', function (env) {
    var r = env.call(env.req('MC-T-0001', { action: 'LIST_DOCUMENTS', module: 'NORM_BASE' }));
    mcEq_(r.ok, true);
    var ids = r.result.documents.map(function (d) { return d.documentId; }).sort().join(',');
    mcEq_(ids, 'NORM-0001,NORM-BIG', 'список (без черновика, внутреннего и чужого тарифа)');
    var s = JSON.stringify(r);
    mcAssert_(s.indexOf('FILE-') < 0 && s.indexOf('fileId') < 0 && s.indexOf('drive.google') < 0, 'в ответе fileId или ссылка Drive');
  }],
  ['Выдача разрешённого документа: содержимое и SHA-256', function (env) {
    var r = env.call(env.req('MC-T-0001', { action: 'GET_DOCUMENT', documentId: 'NORM-0001' }));
    mcEq_(r.ok, true);
    var bytes = Utilities.base64Decode(r.result.contentBase64);
    mcEq_(mcSha256Hex_(bytes), r.result.sha256, 'хеш содержимого');
    mcEq_(Utilities.newBlob(bytes).getDataAsString(), 'Норматив 1');
    mcAssert_(r.result.fileId === undefined, 'fileId в ответе');
  }],
  ['Несуществующий, черновой и внутренний документ: DOCUMENT_NOT_FOUND', function (env) {
    ['NORM-9999', 'NORM-DRAFT', 'NORM-INT'].forEach(function (id) {
      mcEq_(env.call(env.req('MC-T-0001', { action: 'GET_DOCUMENT', documentId: id })).error, 'DOCUMENT_NOT_FOUND', id);
    });
  }],
  ['Слишком большой документ: DOCUMENT_TOO_LARGE', function (env) {
    mcEq_(env.call(env.req('MC-T-0001', { action: 'GET_DOCUMENT', documentId: 'NORM-BIG' })).error, 'DOCUMENT_TOO_LARGE');
  }],
  ['Повторный requestId: сохранённый ответ', function (env) {
    var q = env.req('MC-T-0001', { action: 'LIST_DOCUMENTS', module: 'NORM_BASE' });
    var a = env.call(q), b = env.call(q);
    mcEq_(b.ok, true); mcEq_(b.replayed, true); mcEq_(b.serverTime, a.serverTime, 'тот же ответ');
    mcEq_(env.store.tables.requests.filter(function (x) { return x.requestId === q.requestId; }).length, 1, 'одна запись REQUESTS');
  }],
  ['Повторный GET_DOCUMENT: содержимое не хранится, выдаётся заново', function (env) {
    var q = env.req('MC-T-0001', { action: 'GET_DOCUMENT', documentId: 'NORM-0001' });
    env.call(q);
    var saved = env.store.tables.requests.filter(function (x) { return x.requestId === q.requestId; })[0];
    mcAssert_(saved.responseJson.indexOf('contentBase64') < 0, 'содержимое в REQUESTS');
    var b = env.call(q);
    mcEq_(b.ok, true); mcEq_(b.replayed, true); mcAssert_(!!b.result.contentBase64, 'нет содержимого при повторе');
  }],
  ['Тот же requestId с другим payload: REQUEST_ID_PAYLOAD_MISMATCH', function (env) {
    var q = env.req('MC-T-0001', { action: 'LIST_DOCUMENTS', module: 'NORM_BASE' });
    env.call(q);
    var q2 = JSON.parse(JSON.stringify(q)); q2.module = 'TEMPLATES';
    mcEq_(env.call(q2).error, 'REQUEST_ID_PAYLOAD_MISMATCH');
  }],
  ['Параллельные запросы с одним requestId: второй получает PROCESSING', function (env) {
    var q = env.req('MC-T-0001');
    var v = validateRequest_(JSON.stringify(q)).req;
    mcEq_(beginRequest_(v).state, 'NEW');
    var r = env.call(q);
    mcEq_(r.error, 'PROCESSING'); mcEq_(r.retryable, true);
    abortRequest_(v);
    mcEq_(env.call(q).ok, true, 'после завершения первого — выполняется');
  }],
  ['Повтор после временной ошибки выполняется заново', function (env) {
    var q = env.req('MC-T-0001', { action: 'GET_DOCUMENT', documentId: 'NORM-0001' });
    env.drive.state.down = true;
    mcEq_(env.call(q).error, 'SERVICE_UNAVAILABLE');
    env.drive.state.down = false;
    mcEq_(env.call(q).ok, true);
  }],
  ['Превышение rate limit: RATE_LIMIT_EXCEEDED', function (env) {
    _MC_CFG_OVERRIDE_.MC_RATE_LIMIT_PER_LICENSE = '3';
    for (var i = 0; i < 3; i++) mcEq_(env.call(env.req('MC-T-0001')).ok, true, 'запрос ' + (i + 1));
    var r = env.call(env.req('MC-T-0001'));
    mcEq_(r.error, 'RATE_LIMIT_EXCEEDED'); mcEq_(r.retryable, true);
    mcEq_(env.call(env.req('MC-T-0002')).ok, true, 'другая лицензия не затронута');
  }],
  ['Лимит по операции GET_DOCUMENT', function (env) {
    _MC_CFG_OVERRIDE_.MC_RATE_LIMIT_GET_DOCUMENT = '1';
    mcEq_(env.call(env.req('MC-T-0001', { action: 'GET_DOCUMENT', documentId: 'NORM-0001' })).ok, true);
    mcEq_(env.call(env.req('MC-T-0001', { action: 'GET_DOCUMENT', documentId: 'NORM-0001' })).error, 'RATE_LIMIT_EXCEEDED');
    mcEq_(env.call(env.req('MC-T-0001')).ok, true, 'CHECK_LICENSE не ограничен');
  }],
  ['Неизвестная установка при лимите 1: INSTALLATION_NOT_ALLOWED и MULTI_INSTALL', function (env) {
    mcEq_(env.call(env.req('MC-T-0001')).ok, true);
    mcEq_(env.store.tables.installations.length, 1, 'первая установка зарегистрирована');
    var r = env.call(env.req('MC-T-0001', { installationId: 'INSTALL-OTHER-COPY' }));
    mcEq_(r.error, 'INSTALLATION_NOT_ALLOWED');
    mcAssert_(_MC_NOTIFY_SENT_.some(function (n) { return n.type === 'MULTI_INSTALL'; }), 'нет уведомления MULTI_INSTALL');
    env.store.updateInstallation('MC-T-0001', 'INSTALL-MC-T-0001-A', { status: 'RELEASED' });
    mcDropLicenseCache_('MC-T-0001');
    mcEq_(env.call(env.req('MC-T-0001', { installationId: 'INSTALL-OTHER-COPY' })).ok, true, 'после освобождения слота');
    mcEq_(env.call(env.req('MC-T-0001')).error, 'INSTALLATION_NOT_ALLOWED', 'освобождённая установка');
  }],
  ['Несовпадение хеша: DOCUMENT_INTEGRITY_FAILED, документ BLOCKED, уведомление', function (env) {
    var d = env.store.tables.documents.filter(function (x) { return x.documentId === 'NORM-0001'; })[0];
    env.drive.put(d.fileId, 'Подменённый текст', 'text/plain');
    var r = env.call(env.req('MC-T-0001', { action: 'GET_DOCUMENT', documentId: 'NORM-0001' }));
    mcEq_(r.error, 'DOCUMENT_INTEGRITY_FAILED'); mcAssert_(!r.result, 'содержимое выдано');
    mcEq_(d.status, 'BLOCKED');
    mcAssert_(_MC_NOTIFY_SENT_.some(function (n) { return n.type === 'HASH_MISMATCH'; }), 'нет уведомления');
    mcEq_(env.call(env.req('MC-T-0001', { action: 'GET_DOCUMENT', documentId: 'NORM-0001' })).error, 'DOCUMENT_NOT_FOUND', 'заблокирован');
  }],
  ['Drive недоступен: SERVICE_UNAVAILABLE, retryable', function (env) {
    env.drive.state.down = true;
    var r = env.call(env.req('MC-T-0001', { action: 'GET_DOCUMENT', documentId: 'NORM-0001' }));
    mcEq_(r.error, 'SERVICE_UNAVAILABLE'); mcEq_(r.retryable, true);
    mcAssert_(JSON.stringify(r).indexOf('тест') < 0, 'текст исключения в ответе');
  }],
  ['Таблица недоступна: SERVICE_UNAVAILABLE без текста исключения', function (env) {
    env.store.down.sheets = true;
    var r = env.call(env.req('MC-T-0001'));
    mcEq_(r.error, 'SERVICE_UNAVAILABLE'); mcEq_(r.retryable, true);
    mcAssert_(JSON.stringify(r).indexOf('недоступна (тест)') < 0, 'текст исключения в ответе');
  }],
  ['fileId вместо documentId: INVALID_REQUEST', function (env) {
    var d = env.store.tables.documents[0];
    var q = env.req('MC-T-0001', { action: 'GET_DOCUMENT', fileId: d.fileId });
    mcEq_(env.call(q).error, 'INVALID_REQUEST');
    mcEq_(env.call(env.req('MC-T-0001', { action: 'GET_DOCUMENT', documentId: d.fileId })).error, 'DOCUMENT_NOT_FOUND', 'fileId в поле documentId');
  }],
  ['Права из запроса не принимаются (status, allowedModules)', function (env) {
    mcEq_(env.call(env.req('MC-T-REV', { status: 'ACTIVE' })).error, 'INVALID_REQUEST');
    mcEq_(env.call(env.req('MC-T-0001', { allowedModules: '*' })).error, 'INVALID_REQUEST');
  }],
  ['Некорректные запросы: не JSON, массив, >100 КБ, длинная строка, без requestId, неизвестная операция', function (env) {
    mcEq_(env.call('не json').error, 'INVALID_REQUEST');
    mcEq_(env.call('[]').error, 'INVALID_REQUEST');
    mcEq_(env.call(JSON.stringify({ requestId: new Array(110 * 1024).join('a') })).error, 'REQUEST_TOO_LARGE');
    mcEq_(env.call(env.req('MC-T-0001', { appVersion: new Array(600).join('1') })).error, 'INVALID_REQUEST');
    var q = env.req('MC-T-0001'); delete q.requestId;
    mcEq_(env.call(q).error, 'INVALID_REQUEST');
    mcEq_(env.call(env.req('MC-T-0001', { action: 'MC_revokeLicense' })).error, 'UNKNOWN_ACTION');
    mcEq_(env.call(env.req('MC-T-0001', { licenseId: '=HYPERLINK("x")' })).error, 'INVALID_REQUEST');
  }],
  ['TEST-лицензия видит только тестовые материалы', function (env) {
    mcEq_(env.call(env.req('MC-T-TEST', { action: 'LIST_DOCUMENTS', module: 'NORM_BASE' })).error, 'MODULE_NOT_ALLOWED');
    var r = env.call(env.req('MC-T-TEST', { action: 'LIST_DOCUMENTS', module: 'TEST' }));
    mcEq_(r.result.documents.map(function (d) { return d.documentId; }).join(','), 'TEST-0001');
    mcEq_(env.call(env.req('MC-T-TEST', { action: 'GET_DOCUMENT', documentId: 'TEST-0001' })).ok, true);
  }],
  ['GET_LIBRARY_VERSION: версия и модули только этой лицензии', function (env) {
    var r = env.call(env.req('MC-T-0002', { action: 'GET_LIBRARY_VERSION' }));
    mcEq_(r.result.libraryVersion, '2026.11.19.120000'); mcEq_(r.result.modules.join(','), 'TEMPLATES');
  }],
  ['Данные другого клиента недоступны', function (env) {
    var r = env.call(env.req('MC-T-0001', { action: 'LIST_DOCUMENTS', module: 'TEMPLATES' }));
    mcEq_(r.result.documents.map(function (d) { return d.documentId; }).sort().join(','), 'TPL-0001,TPL-0002', 'лицензия 1: allowedDocuments=*');
    var r2 = env.call(env.req('MC-T-0002', { action: 'LIST_DOCUMENTS', module: 'TEMPLATES' }));
    mcEq_(r2.result.documents.map(function (d) { return d.documentId; }).join(','), 'TPL-0002', 'лицензия 2 видит только своё');
    var x = env.req('MC-T-0001', { clientToken: env.tokens['MC-T-0002'] });
    mcEq_(env.call(x).error, 'AUTH_FAILED', 'чужой токен');
    var shared = 'REQ-' + env.run + '-SHARED';
    env.call(env.req('MC-T-0001', { requestId: shared }));
    var b = env.call(env.req('MC-T-0002', { requestId: shared }));
    mcEq_(b.result.licenseId, 'MC-T-0002', 'requestId другого клиента не отдаёт чужой ответ'); mcAssert_(!b.replayed, 'чужой ответ из REQUESTS');
  }],
  ['Отсутствие секретов в ответах и журнале', function (env) {
    env.call(env.req('MC-T-0001'));
    env.call(env.req('MC-T-0001', { action: 'LIST_DOCUMENTS', module: 'NORM_BASE' }));
    env.call(env.req('MC-T-0001', { action: 'GET_DOCUMENT', documentId: 'NORM-0001' }));
    env.call(env.req('MC-T-0001', { clientToken: env.tokens['MC-T-0002'] }));
    var all = env.responses.join('\n') + JSON.stringify(env.store.tables.audit) + JSON.stringify(env.store.tables.requests) +
      _MC_NOTIFY_SENT_.map(function (n) { return n.body; }).join('\n');
    var secrets = [env.tokens['MC-T-0001'], env.tokens['MC-T-0002'], _MC_CFG_OVERRIDE_.MC_TOKEN_PEPPER, 'SECRET-REGISTRY-ID', 'SECRET-ROOT-FOLDER-ID', 'SECRET-NOTE', 'secret-MC-T'];
    env.store.tables.licenses.forEach(function (l) { secrets.push(l.clientTokenHash); });
    env.store.tables.documents.forEach(function (d) { secrets.push(d.fileId); });
    secrets.forEach(function (s) { mcAssert_(all.indexOf(s) < 0, 'секрет в ответе/журнале: ' + String(s).slice(0, 12) + '…'); });
    mcAssert_(!/stack|at [A-Za-z_]+ \(|Exception/i.test(env.responses.join('\n')), 'stack trace в ответе');
  }],
  ['Нельзя перечислить licenseId: ответы для существующей и несуществующей одинаковы', function (env) {
    var a = env.call(env.req('MC-T-0001', { clientToken: 'mct_' + new Array(45).join('Z') }));
    var b = env.call(env.req('MC-T-ZZZZ', { clientId: 'CLIENT-0001', clientToken: 'mct_' + new Array(45).join('Z') }));
    mcEq_(a.error, b.error); mcEq_(a.message, b.message);
  }],
  ['Аудит: одна строка на запрос, без токена', function (env) {
    var n0 = env.store.tables.audit.length;
    env.call(env.req('MC-T-0001'));
    mcEq_(env.store.tables.audit.length, n0 + 1);
    var a = env.store.tables.audit.slice(-1)[0];
    mcEq_(a.result, 'OK'); mcEq_(a.action, 'CHECK_LICENSE'); mcAssert_(a.durationMs >= 0, 'durationMs');
    mcAssert_(Object.keys(a).indexOf('clientToken') < 0, 'токен в аудите');
  }],
  ['Хеш токена: HMAC-SHA-256, сравнение без раннего выхода', function () {
    mcEq_(hashToken_('abc').length, 64);
    mcAssert_(hashToken_('abc') !== mcSha256Hex_('abc'), 'без секрета');
    mcAssert_(constantTimeEqual_('abc', 'abc') && !constantTimeEqual_('abc', 'abd') && !constantTimeEqual_('abc', 'abcd') && !constantTimeEqual_('', ''), 'сравнение');
    var t1 = generateClientToken_(), t2 = generateClientToken_();
    mcAssert_(t1 !== t2 && t1.length >= 80 && MC_PATTERNS_.clientToken.test(t1), 'токен');
  }],
  ['GET не обслуживается', function () {
    mcEq_(mcErrorResp_('', 'METHOD_NOT_ALLOWED').error, 'METHOD_NOT_ALLOWED');
  }]
];

/** Запуск всех тестов. Возвращает { passed, failed, results:[{name, ok, error}] }. */
function MC_runAllTests() {
  var results = [], passed = 0, failed = 0;
  MC_TESTS_.forEach(function (t) {
    var env = null;
    try {
      env = mcTestEnv_();
      t[1](env);
      results.push({ name: t[0], ok: true }); passed++;
    } catch (e) {
      results.push({ name: t[0], ok: false, error: String(e && e.message || e) }); failed++;
    } finally { mcTestCleanup_(); }
  });
  var lines = results.map(function (r) { return (r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : ' — ' + r.error); });
  lines.push('Итого: ' + passed + ' из ' + (passed + failed));
  try { Logger.log(lines.join('\n')); } catch (e) {}
  return { passed: passed, failed: failed, results: results };
}
