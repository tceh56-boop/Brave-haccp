/**
 * MonChef License API — реестр нормативных документов и выдача файлов.
 *
 * Клиент знает только documentId. fileId, ID папки и ссылки Google Drive наружу не выдаются.
 * Документ выдаётся, только если:
 *   status = ACTIVE, category ≠ INTERNAL, модуль разрешён лицензии, документ разрешён лицензии
 *   (allowedDocuments содержит documentId или '*'), тариф лицензии входит в allowedPlans,
 *   размер ≤ MC_MAX_DOCUMENT_BYTES, хеш файла совпадает с sha256 в реестре.
 * Пустые allowedDocuments / allowedPlans = ничего не разрешено (запрещено всё, что не разрешено явно).
 */

function mcNormDocument_(r) {
  return {
    documentId: String(r.documentId || '').trim(),
    fileId: String(r.fileId || '').trim(),
    title: String(r.title || ''),
    description: String(r.description || ''),
    module: String(r.module || '').trim().toUpperCase(),
    version: String(r.version || ''),
    status: String(r.status || '').trim().toUpperCase(),
    mimeType: String(r.mimeType || ''),
    sha256: String(r.sha256 || '').trim().toLowerCase(),
    sizeBytes: parseInt(r.sizeBytes, 10) || 0,
    allowedPlans: mcList_(r.allowedPlans).map(function (x) { return x.toUpperCase(); }),
    publishedAt: mcIso_(r.publishedAt),
    updatedAt: mcIso_(r.updatedAt),
    isOfficialSource: mcBool_(r.isOfficialSource),
    sourceUrl: String(r.sourceUrl || ''),
    category: String(r.category || '').trim().toUpperCase()
  };
}

/** Все документы реестра одним пакетом; кэш 5 минут (сбрасывается при изменении реестра). */
function getAllDocuments_() {
  var hit = mcCacheGet_('docs_all');
  if (hit) return hit;
  var list = mcStore_().listDocuments().map(mcNormDocument_).filter(function (d) { return d.documentId; });
  mcCachePut_('docs_all', list, 300);
  return list;
}
function mcDropDocumentCache_() { mcCacheRemove_('docs_all'); mcCacheRemove_('lib_info'); }

function getDocument_(documentId) {
  var all = getAllDocuments_();
  for (var i = 0; i < all.length; i++) if (all[i].documentId === documentId) return all[i];
  return null;
}

/** Документ существует для внешнего мира: опубликован и не внутренний. */
function mcDocPublic_(doc) {
  return !!doc && doc.status === 'ACTIVE' && doc.category !== 'INTERNAL' && MC_DOC_CATEGORIES_.indexOf(doc.category) >= 0;
}

/**
 * Код отказа для документа или '' если разрешён. Модуль проверяется отдельно (isModuleAllowed_).
 * TEST-лицензия получает только документы с тарифом TEST в allowedPlans ('*' для неё не считается).
 */
function documentDenyCode_(license, doc) {
  if (!mcDocPublic_(doc)) return 'DOCUMENT_NOT_FOUND';
  if (!isModuleAllowed_(license, doc.module)) return 'MODULE_NOT_ALLOWED';
  var docOk = license.allowedDocuments.indexOf('*') >= 0 || license.allowedDocuments.indexOf(doc.documentId) >= 0;
  if (!docOk) return 'DOCUMENT_NOT_ALLOWED';
  var planOk = license.status === 'TEST'
    ? doc.allowedPlans.indexOf('TEST') >= 0
    : (doc.allowedPlans.indexOf('*') >= 0 || (!!license.plan && doc.allowedPlans.indexOf(license.plan) >= 0));
  if (!planOk) return 'DOCUMENT_NOT_ALLOWED';
  return '';
}

/** Публичные метаданные документа — только эти поля уходят клиенту. */
function mcDocPublicMeta_(doc) {
  return { documentId: doc.documentId, title: doc.title, description: doc.description, module: doc.module,
    version: doc.version, category: doc.category, isOfficialSource: doc.isOfficialSource,
    sourceUrl: doc.isOfficialSource ? doc.sourceUrl : '', sha256: doc.sha256, mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes, updatedAt: doc.updatedAt };
}

function listDocumentsForLicense_(license, module) {
  module = String(module || '').toUpperCase();
  return getAllDocuments_().filter(function (d) { return d.module === module && !documentDenyCode_(license, d); })
    .map(mcDocPublicMeta_);
}

/** Модули, в которых у лицензии есть хотя бы один доступный документ. */
function mcLicenseModules_(license) {
  var seen = {};
  getAllDocuments_().forEach(function (d) { if (!documentDenyCode_(license, d)) seen[d.module] = true; });
  return Object.keys(seen).sort();
}

/** Версия библиотеки: меняется при публикации, снятии и обновлении хеша документа. */
function mcLibraryInfo_() {
  return { libraryVersion: mcCfg_('MC_LIBRARY_VERSION') || '0', publishedAt: mcCfg_('MC_LIBRARY_PUBLISHED_AT') || '' };
}
function mcBumpLibraryVersion_() {
  var now = new Date();
  mcSetProp_('MC_LIBRARY_VERSION', Utilities.formatDate(now, 'UTC', 'yyyy.MM.dd.HHmmss'));
  mcSetProp_('MC_LIBRARY_PUBLISHED_AT', now.toISOString());
  mcDropDocumentCache_();
}

// ---------------------------------------------------------------- целостность

/**
 * Сверка SHA-256 файла с ожидаемым. Возвращает { ok, actual, sizeBytes }.
 * Для файлов больше MC_HASH_ON_REQUEST_MAX_BYTES результат сверки кэшируется на 6 ч
 * (по fileId, ожидаемому хешу и времени изменения файла); полная проверка — MC_checkLibraryIntegrity().
 */
function verifyDocumentHash_(fileId, expectedHash, opt) {
  opt = opt || {};
  var file = opt.file || mcDrive_().getFile(fileId);
  var size = file.getSize(), updated = '';
  try { updated = String(file.getLastUpdated().getTime()); } catch (e) {}
  var big = size > mcCfgInt_('MC_HASH_ON_REQUEST_MAX_BYTES', 1048576);
  var key = mcKey_('hv', fileId + '|' + expectedHash + '|' + updated);
  if (big && !opt.force) { var hit = mcCacheGet_(key); if (hit && hit.ok) return { ok: true, actual: expectedHash, sizeBytes: size, cached: true }; }
  var bytes = opt.bytes || file.getBlob().getBytes();
  var actual = mcSha256Hex_(bytes);
  var ok = !!expectedHash && constantTimeEqual_(actual, String(expectedHash).toLowerCase());
  if (ok && big) mcCachePut_(key, { ok: true }, 21600);
  return { ok: ok, actual: actual, sizeBytes: bytes.length };
}

/** Блокировка документа при несовпадении хеша: статус BLOCKED, уведомление владельцу. */
function mcBlockDocumentForIntegrity_(doc, actual, license) {
  try {
    mcStore_().updateDocument(doc.documentId, { status: 'BLOCKED', updatedAt: mcNowIso_() });
    mcDropDocumentCache_();
  } catch (e) {}
  writeAdminLog_('DOCUMENT_BLOCKED_HASH', '', doc.documentId, 'ожидался ' + doc.sha256.slice(0, 16) + '…, получен ' + String(actual).slice(0, 16) + '…');
  notifySuspiciousEvent_({ type: 'HASH_MISMATCH', licenseId: license ? license.licenseId : '', documentId: doc.documentId,
    details: 'SHA-256 файла не совпадает с реестром; документ заблокирован (status = BLOCKED)' });
}

/**
 * Выдача содержимого документа (порядок по ТЗ, п. 8): найти → статус → модуль → набор документов →
 * размер → файл из закрытой папки → хеш → содержимое. Публичный доступ к файлу не добавляется.
 */
function readDocumentForLicense_(license, documentId) {
  var doc = getDocument_(documentId);
  if (!mcDocPublic_(doc)) return { ok: false, code: 'DOCUMENT_NOT_FOUND' };
  var deny = documentDenyCode_(license, doc);
  if (deny) return { ok: false, code: deny, doc: doc };
  var max = mcCfgInt_('MC_MAX_DOCUMENT_BYTES', 5242880);
  if (doc.sizeBytes > max) return { ok: false, code: 'DOCUMENT_TOO_LARGE' };

  var file;
  try {
    file = mcDrive_().getFile(doc.fileId);
    if (file.isTrashed && file.isTrashed()) return { ok: false, code: 'DOCUMENT_NOT_FOUND' };
  } catch (e) { return { ok: false, code: 'SERVICE_UNAVAILABLE' }; }
  if (file.getSize() > max) return { ok: false, code: 'DOCUMENT_TOO_LARGE' };

  var bytes;
  try { bytes = file.getBlob().getBytes(); } catch (e) { return { ok: false, code: 'SERVICE_UNAVAILABLE' }; }
  var v = verifyDocumentHash_(doc.fileId, doc.sha256, { file: file, bytes: bytes });
  if (!v.ok) { mcBlockDocumentForIntegrity_(doc, v.actual, license); return { ok: false, code: 'DOCUMENT_INTEGRITY_FAILED' }; }

  var meta = mcDocPublicMeta_(doc);
  meta.sizeBytes = bytes.length;
  meta.fileName = doc.documentId + mcExtFor_(doc.mimeType);
  meta.contentBase64 = Utilities.base64Encode(bytes);
  return { ok: true, result: meta };
}

function mcExtFor_(mime) {
  var map = { 'application/pdf': '.pdf', 'text/plain': '.txt', 'text/csv': '.csv', 'text/markdown': '.md',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx', 'application/json': '.json' };
  return map[String(mime)] || '';
}
