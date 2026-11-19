/**
 * MonChef License API — административные функции владельца.
 *
 * Запускаются только из редактора Apps Script владельцем проекта (Выполнить → функция).
 * Через doPost они недоступны: роутер вызывает только MC_HANDLERS_. Дополнительно каждая функция
 * проверяет, что её запускает владелец (mcRequireOwner_): в веб-приложении от имени владельца
 * для анонимного клиента активный пользователь пуст — вызов будет отклонён.
 *
 * Функции с параметрами вызываются из функций-примеров внизу файла (MC_ADMIN_*): владелец
 * правит значения в примере и запускает его. Токен показывается один раз в журнале выполнения.
 */

function mcRequireOwner_() {
  var a = '', e = '';
  try { a = String(Session.getActiveUser().getEmail() || ''); e = String(Session.getEffectiveUser().getEmail() || ''); } catch (x) {}
  if (!a || a !== e) throw new Error('Административные функции License API запускает только владелец проекта из редактора.');
}

/** Создать (или проверить) таблицу MONCHEF_LICENSE_REGISTRY, листы, закрытую папку, настройки, «перец», триггер. */
function MC_setupLicenseRegistry() {
  mcRequireOwner_();
  var props = PropertiesService.getScriptProperties(), report = [];
  var id = props.getProperty('MC_LICENSE_REGISTRY_SHEET_ID'), ss;
  if (id) { ss = SpreadsheetApp.openById(id); report.push('Реестр найден: ' + ss.getName()); }
  else {
    ss = SpreadsheetApp.create('MONCHEF_LICENSE_REGISTRY');
    props.setProperty('MC_LICENSE_REGISTRY_SHEET_ID', ss.getId());
    report.push('Создана таблица MONCHEF_LICENSE_REGISTRY');
  }
  mcResetProps_();
  var spec = [['MC_LICENSE_SHEET_NAME', MC_LICENSE_HEADERS_], ['MC_DOCUMENTS_SHEET_NAME', MC_DOCUMENT_HEADERS_],
    ['MC_API_AUDIT_SHEET_NAME', MC_AUDIT_HEADERS_], ['MC_REQUESTS_SHEET_NAME', MC_REQUEST_HEADERS_],
    ['MC_INSTALLATIONS_SHEET_NAME', MC_INSTALLATION_HEADERS_], ['MC_ADMIN_LOG_SHEET_NAME', MC_ADMIN_LOG_HEADERS_]];
  spec.forEach(function (s) {
    var name = mcCfg_(s[0]), sh = ss.getSheetByName(name);
    if (!sh) { sh = ss.insertSheet(name); report.push('Создан лист ' + name); }
    var cur = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
    // заголовки только дописываются в конец — существующие данные не сдвигаются
    var missing = s[1].filter(function (h) { return cur.indexOf(h) < 0; });
    if (missing.length) {
      sh.getRange(1, cur.filter(String).length + 1, 1, missing.length).setValues([missing]);
      report.push(name + ': добавлены столбцы ' + missing.join(', '));
    }
    sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  var first = ss.getSheetByName('Sheet1') || ss.getSheetByName('Лист1');
  if (first && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);

  if (!props.getProperty('MC_NORMATIVE_ROOT_FOLDER_ID')) {
    var folder = DriveApp.createFolder('MONCHEF_NORMATIVE_BASE (закрытая)');
    props.setProperty('MC_NORMATIVE_ROOT_FOLDER_ID', folder.getId());
    report.push('Создана закрытая папка нормативной базы');
  }
  if (!props.getProperty('MC_TOKEN_PEPPER')) {
    props.setProperty('MC_TOKEN_PEPPER', Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      Utilities.getUuid() + Utilities.getUuid() + Date.now(), Utilities.Charset.UTF_8)));
    report.push('Создан секрет MC_TOKEN_PEPPER (не меняйте: все выданные токены перестанут подходить)');
  }
  if (!props.getProperty('MC_ADMIN_EMAIL')) {
    props.setProperty('MC_ADMIN_EMAIL', Session.getEffectiveUser().getEmail());
    report.push('MC_ADMIN_EMAIL = адрес владельца проекта');
  }
  Object.keys(MC_CFG_DEFAULTS_).forEach(function (k) {
    if (props.getProperty(k) === null && MC_CFG_DEFAULTS_[k] !== '') props.setProperty(k, MC_CFG_DEFAULTS_[k]);
  });
  mcResetProps_();

  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'MC_checkLibraryIntegrity'; });
  if (!has) { ScriptApp.newTrigger('MC_checkLibraryIntegrity').timeBased().everyDays(1).atHour(3).create(); report.push('Ежедневная проверка целостности — 03:00'); }

  writeAdminLog_('SETUP', '', '', report.join('; '));
  Logger.log(report.join('\n'));
  return report;
}

// ---------------------------------------------------------------- лицензии

/**
 * Регистрация лицензии. opts: { licenseId?, clientId, customerName, customerEmail, plan, status ('ACTIVE'|'TEST'),
 *   validFrom 'yyyy-MM-dd', validUntil 'yyyy-MM-dd', allowedModules 'NORM_BASE,TEMPLATES' | '*',
 *   allowedDocuments 'NORM-0001,NORM-0002' | '*', maxInstallations (по умолчанию 1), notes }.
 * Возвращает { licenseId, clientToken }. Токен показывается ОДИН раз; в реестре — только хеш.
 * Передавайте токен клиенту не обычной почтой: лично, в менеджере паролей, по защищённому каналу.
 */
function MC_registerLicense(opts) {
  mcRequireOwner_();
  opts = opts || {};
  if (!opts.clientId || !MC_PATTERNS_.clientId.test(String(opts.clientId))) throw new Error('clientId обязателен (латиница, цифры, дефис)');
  var status = String(opts.status || 'ACTIVE').toUpperCase();
  if (status !== 'ACTIVE' && status !== 'TEST') throw new Error('Новая лицензия: status ACTIVE или TEST');
  if (!mcDay_(opts.validFrom) || !mcDay_(opts.validUntil)) throw new Error('validFrom и validUntil обязательны (yyyy-MM-dd)');
  if (mcDay_(opts.validUntil) < mcDay_(opts.validFrom)) throw new Error('validUntil раньше validFrom');
  var store = mcStore_(), licenseId = String(opts.licenseId || mcNextLicenseId_(store));
  if (!MC_PATTERNS_.licenseId.test(licenseId)) throw new Error('licenseId: латиница, цифры, дефис');
  if (store.getLicense(licenseId)) throw new Error('Лицензия ' + licenseId + ' уже есть');

  var token = generateClientToken_(), now = mcNowIso_();
  store.insertLicense({ licenseId: licenseId, clientId: String(opts.clientId), customerName: String(opts.customerName || ''),
    customerEmail: String(opts.customerEmail || ''), clientTokenHash: hashToken_(token), status: status,
    validFrom: mcDay_(opts.validFrom), validUntil: mcDay_(opts.validUntil),
    allowedModules: mcList_(opts.allowedModules || (status === 'TEST' ? 'TEST' : '')).join(','),
    allowedDocuments: mcList_(opts.allowedDocuments || '').join(','),
    maxInstallations: Math.max(1, parseInt(opts.maxInstallations, 10) || 1), currentInstallations: 0,
    lastSeenAt: '', lastSeenInstallationId: '', requestCount: 0, notes: String(opts.notes || ''),
    createdAt: now, updatedAt: now, plan: String(opts.plan || (status === 'TEST' ? 'TEST' : 'STANDARD')).toUpperCase() });
  mcDropLicenseCache_(licenseId);
  writeAdminLog_('LICENSE_REGISTERED', licenseId, '', 'clientId=' + opts.clientId + ', status=' + status + ', до ' + mcDay_(opts.validUntil));
  Logger.log('Лицензия ' + licenseId + ' зарегистрирована.\nТокен установки (показывается один раз, в реестре не хранится):\n' + token);
  return { licenseId: licenseId, clientToken: token };
}

function mcNextLicenseId_(store) {
  var year = Utilities.formatDate(new Date(), mcTz_(), 'yyyy'), max = 0;
  store.listLicenses().forEach(function (l) {
    var m = new RegExp('^MC-' + year + '-(\\d+)$').exec(String(l.licenseId));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'MC-' + year + '-' + ('000' + (max + 1)).slice(-4);
}

function mcSetLicenseStatus_(licenseId, status, reason, logAction) {
  mcRequireOwner_();
  if (!mcStore_().getLicense(licenseId)) throw new Error('Нет лицензии ' + licenseId);
  mcStore_().updateLicense(licenseId, { status: status, updatedAt: mcNowIso_() });
  mcDropLicenseCache_(licenseId);
  writeAdminLog_(logAction, licenseId, '', 'status=' + status + (reason ? '; причина: ' + reason : ''));
  return { licenseId: licenseId, status: status };
}

/** Отзыв: доступ закрывается сразу (кэш лицензии сбрасывается). Данные клиента в его MonChef не трогаются. */
function MC_revokeLicense(licenseId, reason) { return mcSetLicenseStatus_(licenseId, 'REVOKED', reason, 'LICENSE_REVOKED'); }
function MC_suspendLicense(licenseId, reason) { return mcSetLicenseStatus_(licenseId, 'SUSPENDED', reason, 'LICENSE_SUSPENDED'); }
function MC_reactivateLicense(licenseId, reason) { return mcSetLicenseStatus_(licenseId, 'ACTIVE', reason, 'LICENSE_REACTIVATED'); }

/** Продление срока лицензии. */
function MC_extendLicense(licenseId, validUntil, reason) {
  mcRequireOwner_();
  if (!mcDay_(validUntil)) throw new Error('validUntil: yyyy-MM-dd');
  if (!mcStore_().getLicense(licenseId)) throw new Error('Нет лицензии ' + licenseId);
  mcStore_().updateLicense(licenseId, { validUntil: mcDay_(validUntil), updatedAt: mcNowIso_() });
  mcDropLicenseCache_(licenseId);
  writeAdminLog_('LICENSE_EXTENDED', licenseId, '', 'до ' + mcDay_(validUntil) + (reason ? '; ' + reason : ''));
  return { licenseId: licenseId, validUntil: mcDay_(validUntil) };
}

/** Замена токена: старый перестаёт действовать сразу. Новый показывается один раз. */
function MC_rotateClientToken(licenseId, reason) {
  mcRequireOwner_();
  if (!mcStore_().getLicense(licenseId)) throw new Error('Нет лицензии ' + licenseId);
  var token = generateClientToken_();
  mcStore_().updateLicense(licenseId, { clientTokenHash: hashToken_(token), updatedAt: mcNowIso_() });
  mcDropLicenseCache_(licenseId);
  writeAdminLog_('TOKEN_ROTATED', licenseId, '', reason ? 'причина: ' + reason : 'замена токена');
  Logger.log('Новый токен для ' + licenseId + ' (показывается один раз):\n' + token);
  return { licenseId: licenseId, clientToken: token };
}

/** Освободить слот установки (клиент переустановил MonChef). Старая установка больше не пройдёт проверку. */
function MC_releaseInstallation(licenseId, installationId, reason) {
  mcRequireOwner_();
  return mcSetInstallationStatus_(licenseId, installationId, 'RELEASED', reason);
}
/** Заблокировать установку (например, обнаружена копия). */
function MC_blockInstallation(licenseId, installationId, reason) {
  mcRequireOwner_();
  return mcSetInstallationStatus_(licenseId, installationId, 'BLOCKED', reason);
}
function mcSetInstallationStatus_(licenseId, installationId, status, reason) {
  if (!mcStore_().updateInstallation(licenseId, installationId, { status: status })) throw new Error('Установка не найдена');
  var active = mcStore_().listInstallations(licenseId).filter(function (r) { return String(r.status).toUpperCase() === 'ACTIVE'; }).length;
  mcStore_().updateLicense(licenseId, { currentInstallations: active, updatedAt: mcNowIso_() });
  mcDropLicenseCache_(licenseId);
  writeAdminLog_('INSTALLATION_' + status, licenseId, '', 'installationId=' + installationId + (reason ? '; ' + reason : ''));
  return { licenseId: licenseId, installationId: installationId, status: status, activeInstallations: active };
}

// ---------------------------------------------------------------- документы

/**
 * Регистрация документа (статус DRAFT, клиентам не виден до MC_publishDocument).
 * opts: { documentId, fileId, title, description, module, version, category, allowedPlans ('*' | 'STANDARD,PRO' | 'TEST'),
 *   isOfficialSource (true для официальных текстов), sourceUrl (официальный источник) }.
 * Файл должен лежать в закрытой папке нормативной базы и не быть файлом Google Docs/Sheets.
 */
function MC_registerDocument(opts) {
  mcRequireOwner_();
  opts = opts || {};
  var id = String(opts.documentId || '');
  if (!MC_PATTERNS_.documentId.test(id)) throw new Error('documentId: латиница, цифры, дефис (например NORM-0001)');
  if (getDocumentRaw_(id)) throw new Error('Документ ' + id + ' уже есть');
  var category = String(opts.category || '').toUpperCase();
  if (MC_DOC_CATEGORIES_.indexOf(category) < 0) throw new Error('category: ' + MC_DOC_CATEGORIES_.join(', '));
  if (category === 'OFFICIAL' && !opts.sourceUrl) throw new Error('Для официального текста укажите sourceUrl — официальный источник');
  var module = String(opts.module || '').toUpperCase();
  if (!MC_PATTERNS_.module.test(module)) throw new Error('module: латиница, цифры, _');
  if (!mcDrive_().isInRoot(opts.fileId)) throw new Error('Файл не лежит в закрытой папке нормативной базы');
  var file = mcDrive_().getFile(opts.fileId), mime = file.getMimeType();
  if (/^application\/vnd\.google-apps\./.test(mime)) throw new Error('Файлы Google Документов/Таблиц не выдаются: сохраните PDF/DOCX в папку');
  var bytes = file.getBlob().getBytes(), now = mcNowIso_();
  mcStore_().insertDocument({ documentId: id, fileId: String(opts.fileId), title: String(opts.title || file.getName()),
    description: String(opts.description || ''), module: module, version: String(opts.version || Utilities.formatDate(new Date(), mcTz_(), 'yyyy.MM')),
    status: 'DRAFT', mimeType: mime, sha256: mcSha256Hex_(bytes), sizeBytes: bytes.length,
    allowedPlans: mcList_(opts.allowedPlans || '').join(','), publishedAt: '', updatedAt: now,
    isOfficialSource: category === 'OFFICIAL' || mcBool_(opts.isOfficialSource), sourceUrl: String(opts.sourceUrl || ''), category: category });
  mcDropDocumentCache_();
  writeAdminLog_('DOCUMENT_REGISTERED', '', id, 'module=' + module + ', category=' + category + ', ' + bytes.length + ' байт');
  return { documentId: id, status: 'DRAFT', sizeBytes: bytes.length };
}

function getDocumentRaw_(id) {
  var rows = mcStore_().listDocuments().filter(function (r) { return String(r.documentId) === String(id); });
  return rows.length ? rows[0] : null;
}

/** Публикация: перед публикацией хеш сверяется заново; при расхождении — отказ. */
function MC_publishDocument(documentId) {
  mcRequireOwner_();
  var raw = getDocumentRaw_(documentId);
  if (!raw) throw new Error('Нет документа ' + documentId);
  var doc = mcNormDocument_(raw);
  if (doc.category === 'INTERNAL') throw new Error('Внутренние материалы (INTERNAL) не публикуются');
  var v = verifyDocumentHash_(doc.fileId, doc.sha256, { force: true });
  if (!v.ok) throw new Error('Хеш файла не совпадает с реестром — выполните MC_refreshDocumentHash после проверки файла');
  var now = mcNowIso_();
  mcStore_().updateDocument(documentId, { status: 'ACTIVE', publishedAt: now, updatedAt: now });
  mcBumpLibraryVersion_();
  writeAdminLog_('DOCUMENT_PUBLISHED', '', documentId, 'версия библиотеки ' + mcCfg_('MC_LIBRARY_VERSION'));
  return { documentId: documentId, status: 'ACTIVE', libraryVersion: mcCfg_('MC_LIBRARY_VERSION') };
}

function MC_unpublishDocument(documentId, reason) {
  mcRequireOwner_();
  if (!getDocumentRaw_(documentId)) throw new Error('Нет документа ' + documentId);
  mcStore_().updateDocument(documentId, { status: 'ARCHIVED', updatedAt: mcNowIso_() });
  mcBumpLibraryVersion_();
  writeAdminLog_('DOCUMENT_UNPUBLISHED', '', documentId, reason || '');
  return { documentId: documentId, status: 'ARCHIVED' };
}

/**
 * Пересчитать SHA-256 и размер после осознанной замены файла. Статус не меняется,
 * кроме BLOCKED → DRAFT (после проверки файла документ публикуется заново MC_publishDocument).
 */
function MC_refreshDocumentHash(documentId, newVersion) {
  mcRequireOwner_();
  var raw = getDocumentRaw_(documentId);
  if (!raw) throw new Error('Нет документа ' + documentId);
  var doc = mcNormDocument_(raw), file = mcDrive_().getFile(doc.fileId), bytes = file.getBlob().getBytes();
  var patch = { sha256: mcSha256Hex_(bytes), sizeBytes: bytes.length, mimeType: file.getMimeType(), updatedAt: mcNowIso_() };
  if (newVersion) patch.version = String(newVersion);
  if (doc.status === 'BLOCKED') patch.status = 'DRAFT';
  mcStore_().updateDocument(documentId, patch);
  if (doc.status === 'ACTIVE') mcBumpLibraryVersion_(); else mcDropDocumentCache_();
  writeAdminLog_('DOCUMENT_HASH_REFRESHED', '', documentId, 'sha256=' + patch.sha256.slice(0, 16) + '…, ' + bytes.length + ' байт');
  return { documentId: documentId, sha256: patch.sha256, sizeBytes: bytes.length, status: patch.status || doc.status };
}

/**
 * Проверка целостности всех опубликованных документов (ежедневно в 03:00 и вручную).
 * Несовпадение хеша или файл вне закрытой папки → документ BLOCKED и уведомление владельцу.
 */
function MC_checkLibraryIntegrity() {
  var report = { checked: 0, ok: 0, blocked: [], errors: [] };
  getAllDocuments_().filter(function (d) { return d.status === 'ACTIVE'; }).forEach(function (d) {
    report.checked++;
    try {
      if (!mcDrive_().isInRoot(d.fileId)) {
        mcBlockDocumentForIntegrity_(d, 'вне закрытой папки', null);
        report.blocked.push(d.documentId);
        return;
      }
      var v = verifyDocumentHash_(d.fileId, d.sha256, { force: true });
      if (v.ok) report.ok++;
      else { mcBlockDocumentForIntegrity_(d, v.actual, null); report.blocked.push(d.documentId); }
    } catch (e) { report.errors.push(d.documentId); }
  });
  writeAdminLog_('INTEGRITY_CHECK', '', '', 'проверено ' + report.checked + ', в порядке ' + report.ok +
    (report.blocked.length ? ', заблокировано: ' + report.blocked.join(', ') : '') + (report.errors.length ? ', ошибки чтения: ' + report.errors.join(', ') : ''));
  try { Logger.log(JSON.stringify(report)); } catch (e) {}
  return report;
}

/** Сбросить кэш лицензий и документов (после ручной правки таблицы реестра). */
function MC_clearCaches() {
  mcRequireOwner_();
  mcDropDocumentCache_();
  mcStore_().listLicenses().forEach(function (l) { mcDropLicenseCache_(String(l.licenseId)); });
  writeAdminLog_('CACHE_CLEARED', '', '', '');
  return true;
}

// ---------------------------------------------------------------- тестовая лицензия и тестовый документ

/**
 * Тестовый комплект: текстовый файл в закрытой папке (модуль TEST), документ TEST-0001 (опубликован)
 * и лицензия со статусом TEST на 30 дней. Токен — в журнале выполнения, один раз.
 */
function MC_createTestFixtures() {
  mcRequireOwner_();
  var folder = DriveApp.getFolderById(mcCfg_('MC_NORMATIVE_ROOT_FOLDER_ID'));
  var docId = 'TEST-0001';
  if (!getDocumentRaw_(docId)) {
    var f = folder.createFile('MonChef_test_document.txt', 'MonChef License API — тестовый документ.\nНе является нормативным материалом.\n', 'text/plain');
    MC_registerDocument({ documentId: docId, fileId: f.getId(), title: 'Тестовый документ License API', description: 'Проверка выдачи документа',
      module: 'TEST', version: '1', category: 'TEMPLATE', allowedPlans: 'TEST' });
    MC_publishDocument(docId);
  }
  var today = new Date(), until = new Date(today.getTime() + 30 * 86400000);
  var lic = MC_registerLicense({ clientId: 'CLIENT-TEST', customerName: 'Тестовый клиент', status: 'TEST', plan: 'TEST',
    validFrom: mcDay_(today), validUntil: mcDay_(until), allowedModules: 'TEST', allowedDocuments: docId, maxInstallations: 1,
    notes: 'Тестовая лицензия (MC_createTestFixtures)' });
  return { licenseId: lic.licenseId, clientId: 'CLIENT-TEST', documentId: docId, clientToken: lic.clientToken };
}

// ---------------------------------------------------------------- примеры для запуска из редактора

/** Пример: выдать лицензию. Поправьте значения и запустите. */
function MC_ADMIN_registerLicenseExample() {
  return MC_registerLicense({ clientId: 'CLIENT-0001', customerName: 'ООО «Пример»', customerEmail: '',
    plan: 'STANDARD', validFrom: '2026-11-20', validUntil: '2027-11-19',
    allowedModules: 'NORM_BASE,TEMPLATES', allowedDocuments: '*', maxInstallations: 1, notes: 'Договор № … от …' });
}

/** Пример: зарегистрировать документ, лежащий в закрытой папке. */
function MC_ADMIN_registerDocumentExample() {
  return MC_registerDocument({ documentId: 'NORM-0001', fileId: 'ВСТАВЬТЕ_ID_ФАЙЛА', title: 'Название документа',
    description: '', module: 'NORM_BASE', version: '2026.11', category: 'MONCHEF_GUIDE', allowedPlans: '*' });
}
