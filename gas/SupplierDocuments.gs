// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — SupplierDocuments.gs
 * Раунд 8 — ТЗ §10/§13. Хранение ФАЙЛОВ документов (декларации/сертификаты/вет.
 * документы/договоры) через Google Drive — НЕ внутри строк таблицы (ТЗ §10 прямым
 * текстом). В проекте до этого раунда не было ни одного файлового аплоада вообще
 * (единственное использование DriveApp — Backup.gs::makeCopy для бэкапа самой
 * таблицы) — это первая точка входа файлов от пользователя, поэтому загрузка
 * реализована максимально консервативно: только известные типы (ТЗ §10: PDF/JPG/
 * JPEG/PNG), хэш содержимого считается тем же способом, что уже используется в
 * проекте для PIN (Users.gs::hashPin_ — Utilities.computeDigest SHA-256), и хранится
 * ОТДЕЛЬНО от самого файла, чтобы можно было обнаружить повторную загрузку того же
 * документа без повторного скачивания файла.
 */

var SUPPLIER_DOCUMENT_ALLOWED_MIME = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png'
};
var SUPPLIER_DOCUMENT_TYPES = ['DECLARATION', 'CERTIFICATE', 'VETERINARY', 'CONTRACT', 'OTHER'];
var SUPPLIER_DOCUMENTS_ROOT_FOLDER_NAME = 'ЦЕХ — Документы';

function _computeFileHash_(bytes) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  return digest.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function _getOrCreateDriveFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}

function _getOrganizationDocsFolder_(organizationId) {
  var root = _getOrCreateDriveFolder_(DriveApp.getRootFolder(), SUPPLIER_DOCUMENTS_ROOT_FOLDER_NAME);
  return _getOrCreateDriveFolder_(root, organizationId);
}

/**
 * base64Data — БЕЗ префикса "data:...;base64," (срезать на фронтенде перед отправкой).
 * Возвращает метаданные файла — НЕ сам файл (ТЗ §10 "не хранить большие файлы внутри строк").
 */
function _storeDocumentBlob_(base64Data, fileName, mimeType, organizationId) {
  if (!SUPPLIER_DOCUMENT_ALLOWED_MIME[mimeType]) {
    throw new Error('Недопустимый тип файла: "' + mimeType + '". Разрешено: PDF, JPG, JPEG, PNG (ТЗ §10).');
  }
  if (!base64Data) throw new Error('Файл не передан.');
  var bytes;
  try {
    bytes = Utilities.base64Decode(base64Data);
  } catch (e) {
    throw new Error('Не удалось декодировать файл (повреждённый base64).');
  }
  var maxBytes = 20 * 1024 * 1024; // 20 МБ — разумный предел для декларации/фото документа
  if (bytes.length > maxBytes) throw new Error('Файл слишком большой (максимум 20 МБ).');

  var hash = _computeFileHash_(bytes);
  var blob = Utilities.newBlob(bytes, mimeType, fileName || ('document.' + SUPPLIER_DOCUMENT_ALLOWED_MIME[mimeType]));
  var folder = _getOrganizationDocsFolder_(organizationId);
  var file = folder.createFile(blob);
  return {
    file_id: file.getId(),
    file_name: fileName || file.getName(),
    mime_type: mimeType,
    file_size: bytes.length,
    document_hash: hash,
    url: file.getUrl ? file.getUrl() : ''
  };
}

/** ТЗ §13 — общий журнал документов поставщика/продукта/партии (сертификаты, вет.документы, договоры, копии деклараций). */
function uploadSupplierDocument_(data, userId, session) {
  return withLock_(function () {
    if (!data.organizationId) throw new Error('organizationId обязателен.');
    if (SUPPLIER_DOCUMENT_TYPES.indexOf(data.docType) === -1) {
      throw new Error('Недопустимый тип документа: "' + data.docType + '". Разрешено: ' + SUPPLIER_DOCUMENT_TYPES.join(', ') + '.');
    }
    if (data.supplierId && session) assertOwnedByOrg_(session, getSupplierById_(data.supplierId), 'SUPPLIERS:' + data.supplierId);
    if (data.productId && session) assertOwnedByOrg_(session, getProductById_(data.productId), 'PRODUCTS:' + data.productId);

    var stored = _storeDocumentBlob_(data.base64Data, data.fileName, data.mimeType, data.organizationId);
    var doc = {
      doc_id: generateId_('SUPPLIER_DOCUMENTS'),
      organization_id: data.organizationId,
      supplier_id: data.supplierId || '',
      product_id: data.productId || '',
      declaration_id: data.declarationId || '',
      doc_type: data.docType,
      file_id: stored.file_id,
      file_name: stored.file_name,
      mime_type: stored.mime_type,
      file_size: stored.file_size,
      document_hash: stored.document_hash,
      uploaded_at: nowIso_(),
      uploaded_by: userId || ''
    };
    insertRow_('SUPPLIER_DOCUMENTS', doc);
    auditLog_(userId, 'Загружен документ (' + data.docType + ')', 'SUPPLIER_DOCUMENTS:' + doc.doc_id, null, stored.file_name, 'success', session ? session.cascade_id : '');
    return doc;
  });
}

function getSupplierDocuments_(organizationId, filters) {
  filters = filters || {};
  return findRows_('SUPPLIER_DOCUMENTS', function (r) {
    if (r.organization_id !== organizationId) return false;
    if (filters.supplierId && r.supplier_id !== filters.supplierId) return false;
    if (filters.productId && r.product_id !== filters.productId) return false;
    if (filters.declarationId && r.declaration_id !== filters.declarationId) return false;
    if (filters.docType && r.doc_type !== filters.docType) return false;
    return true;
  }).sort(function (a, b) { return new Date(b.uploaded_at) - new Date(a.uploaded_at); });
}

/**
 * ТЗ §10 — загрузка файла НЕПОСРЕДСТВЕННО для декларации: пишет и в DECLARATIONS
 * (file_id/document_url/document_hash — поля уже есть на самой декларации), и в
 * общий журнал SUPPLIER_DOCUMENTS (doc_type='DECLARATION', declaration_id заполнен) —
 * так документ виден и с карточки декларации, и в общем списке документов продукта/
 * поставщика, без двух копий файла (Drive-файл создаётся один раз).
 */
function uploadDeclarationFile_(declarationId, base64Data, fileName, mimeType, userId, session) {
  return withLock_(function () {
    var decl = findOne_('DECLARATIONS', 'declaration_id', declarationId);
    if (!decl) throw new Error('Декларация не найдена: ' + declarationId);
    if (session) assertOwnedByOrg_(session, decl, 'DECLARATIONS:' + declarationId);

    var stored = _storeDocumentBlob_(base64Data, fileName, mimeType, decl.organization_id);
    updateRow_('DECLARATIONS', decl, {
      file_id: stored.file_id, document_url: stored.url, document_hash: stored.document_hash, updated_at: nowIso_()
    });
    insertRow_('SUPPLIER_DOCUMENTS', {
      doc_id: generateId_('SUPPLIER_DOCUMENTS'),
      organization_id: decl.organization_id,
      supplier_id: decl.supplier_id || '',
      product_id: decl.product_id || '',
      declaration_id: declarationId,
      doc_type: 'DECLARATION',
      file_id: stored.file_id, file_name: stored.file_name, mime_type: stored.mime_type, file_size: stored.file_size, document_hash: stored.document_hash,
      uploaded_at: nowIso_(), uploaded_by: userId || ''
    });
    auditLog_(userId, 'Загружен файл декларации', 'DECLARATIONS:' + declarationId, null, stored.file_name, 'success', session ? session.cascade_id : '');
    return getDeclarationById_(declarationId);
  });
}
