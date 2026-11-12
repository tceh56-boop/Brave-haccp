/**
 * MON CHEF — реестр документов (ТЗ §27, §44). Функции с именами из ТЗ поверх листа «Документы»
 * (файлы на Диске) и реестра DOCUMENT_REGISTRY (хеш, версия, статус, связь с прежней версией).
 *
 * Статусы (§27): DRAFT «проект», APPROVED «утверждён», ACTIVE «действующий»,
 * SUPERSEDED «заменён», ARCHIVED «в архиве». Документ не удаляется (§61) — только архив.
 *
 *   registerDocument(json)                 — загрузить файл или создать текстовый документ и внести в реестр
 *   updateDocumentVersion(documentId,json) — новая версия: новая строка, прежняя → «заменён»
 *   getDocument(documentId)                — карточка документа
 *   getDocumentHistory(documentId)         — все версии (цепочка через SourceDocumentID)
 *   verifyDocument(documentId)             — пересчёт хеша файла и сверка с реестром (VALID/INVALID)
 *   archiveDocument(documentId, reason)    — в архив с причиной
 *   getInspectionDocuments(rawToken)       — для проверяющего (уже есть, режим проверки)
 */
var MC_DOC_ST_RU_ = { DRAFT: 'проект', APPROVED: 'утверждён', ACTIVE: 'действующий', SUPERSEDED: 'заменён', ARCHIVED: 'в архиве' };
var MC_DOC_COL_ = { id: 0, type: 1, cat: 2, name: 3, ver: 4, from: 5, to: 6, status: 7, file: 8, hash: 9, signed: 10, signedBy: 11, signedAt: 12, journal: 13, haccp: 14, ttk: 15, created: 16, by: 17, source: 18 };

function _mcDocFind_(id) {
  var sh = _mcDocRegistrySheet_(), v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(id)) return { sh: sh, row: i + 1, r: v[i], all: v };
  return null;
}
function _mcDocObj_(r) {
  var C = MC_DOC_COL_, st = String(r[C.status] || '');
  return { documentId: r[C.id], type: r[C.type], category: r[C.cat], name: r[C.name], version: r[C.ver], dateFrom: r[C.from], dateTo: r[C.to], status: st, statusRu: MC_DOC_ST_RU_[st] || st,
    fileId: r[C.file], hash: r[C.hash], signed: r[C.signed] === true, signedBy: r[C.signedBy], signedAt: r[C.signedAt], relatedJournal: r[C.journal], relatedHaccp: r[C.haccp],
    relatedTtk: r[C.ttk], createdAt: r[C.created], createdBy: r[C.by], sourceDocumentId: r[C.source] || '' };
}

function registerDocument(json, token) {
  var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
  var r = JSON.parse(d.файл ? uploadDocument(JSON.stringify(d), token) : createDocument(JSON.stringify(d), token));
  if (!r || r.success === false || r.error) return JSON.stringify(r);
  try { syncDocumentRegistry(token); } catch (e) {}
  var f = _mcDocFind_(r.data.id);
  if (f) {
    var C = MC_DOC_COL_;
    f.sh.getRange(f.row, C.type + 1).setValue(d.тип || d.категория || 'DOCUMENT');
    f.sh.getRange(f.row, C.ver + 1).setValue(String(d.версия || '1'));
    if (d.статус && MC_DOC_ST_RU_[d.статус]) f.sh.getRange(f.row, C.status + 1).setValue(d.статус);
    if (d.журнал) f.sh.getRange(f.row, C.journal + 1).setValue(d.журнал);
    if (d.haccp) f.sh.getRange(f.row, C.haccp + 1).setValue(d.haccp);
    if (d.ттк) f.sh.getRange(f.row, C.ttk + 1).setValue(d.ттк);
    if (d.источник) f.sh.getRange(f.row, C.source + 1).setValue(d.источник);
    f = _mcDocFind_(r.data.id);
  }
  return coreOk(f ? _mcDocObj_(f.r) : { documentId: r.data.id });
}

function updateDocumentVersion(documentId, json, token) {
  try {
    _requireAuth_(token, 'journals');
    var old = _mcDocFind_(documentId); if (!old) return coreErr('DOCUMENT_NOT_FOUND', 'Документ не найден');
    var C = MC_DOC_COL_;
    if (String(old.r[C.status]) === 'SUPERSEDED' || String(old.r[C.status]) === 'ARCHIVED') return coreErr('NOT_CURRENT', 'Новую версию выпускают от действующей версии');
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    d.категория = d.категория || old.r[C.cat]; d.название = d.название || old.r[C.name];
    d.версия = String((parseInt(old.r[C.ver], 10) || 1) + 1); d.источник = String(documentId);
    var r = JSON.parse(registerDocument(d, token)); if (!r || r.success === false) return JSON.stringify(r);
    old.sh.getRange(old.row, C.status + 1).setValue('SUPERSEDED');
    try { _audit_({ session: _getSession_(token), tenant: _defaultTenant_(), id: r.data.documentId, type: 'DOC_VERSION' }, 'DOC_VERSION', 'Документы', String(documentId), old.r[C.ver], { newDocumentId: r.data.documentId, version: d.версия }); } catch (e) {}
    return coreOk({ previous: String(documentId), current: r.data });
  } catch (e) { return coreErr('DOCUMENT_VERSION_ERROR', String(e)); }
}

function getDocument(documentId, token) {
  try { _requireAuth_(token, 'journals'); var f = _mcDocFind_(documentId); return f ? coreOk(_mcDocObj_(f.r)) : coreErr('DOCUMENT_NOT_FOUND', 'Документ не найден'); }
  catch (e) { return coreErr('DOCUMENT_ERROR', String(e)); }
}

function getDocumentHistory(documentId, token) {
  try {
    _requireAuth_(token, 'journals');
    var f = _mcDocFind_(documentId); if (!f) return coreErr('DOCUMENT_NOT_FOUND', 'Документ не найден');
    var C = MC_DOC_COL_, all = f.all.slice(1).filter(function (r) { return r[0]; }), byId = {}, next = {};
    all.forEach(function (r) { byId[String(r[C.id])] = r; if (r[C.source]) next[String(r[C.source])] = String(r[C.id]); });
    var root = String(documentId), guard = 0;
    while (byId[root] && byId[root][C.source] && byId[String(byId[root][C.source])] && guard++ < 50) root = String(byId[root][C.source]);
    var chain = [], cur = root; guard = 0;
    while (cur && byId[cur] && guard++ < 50) { chain.push(_mcDocObj_(byId[cur])); cur = next[cur]; }
    return coreOk({ documentId: String(documentId), versions: chain });
  } catch (e) { return coreErr('DOCUMENT_HISTORY_ERROR', String(e)); }
}

function verifyDocument(documentId, token) {
  try {
    _requireAuth_(token, 'journals');
    var f = _mcDocFind_(documentId); if (!f) return coreErr('DOCUMENT_NOT_FOUND', 'Документ не найден');
    var C = MC_DOC_COL_, actual = _mcDocumentHash_(f.r[C.file], JSON.stringify(f.r)), valid = actual === String(f.r[C.hash] || '');
    try { _audit_({ session: _getSession_(token), tenant: _defaultTenant_(), id: String(documentId), type: 'VERIFY_DOCUMENT' }, 'VERIFY_DOCUMENT', 'Документы', String(documentId), null, { result: valid ? 'VALID' : 'INVALID' }); } catch (e) {}
    return coreOk({ documentId: String(documentId), name: f.r[C.name], version: f.r[C.ver], result: valid ? 'VALID' : 'INVALID', storedHash: f.r[C.hash], calculatedHash: actual });
  } catch (e) { return coreErr('DOCUMENT_VERIFY_ERROR', String(e)); }
}

function archiveDocument(documentId, reason, token) {
  try {
    var s = _requireAuth_(token, 'journals');
    if (!String(reason || '').trim()) return coreErr('VALIDATION', 'Укажите причину переноса в архив');
    var f = _mcDocFind_(documentId); if (!f) return coreErr('DOCUMENT_NOT_FOUND', 'Документ не найден');
    var C = MC_DOC_COL_, was = f.r[C.status];
    if (String(was) === 'ARCHIVED') return coreOk({ documentId: String(documentId), status: 'ARCHIVED', idempotent: true });
    f.sh.getRange(f.row, C.status + 1).setValue('ARCHIVED');
    try { _audit_({ session: s, tenant: _defaultTenant_(), id: String(documentId), type: 'ARCHIVE_DOCUMENT' }, 'ARCHIVE_DOCUMENT', 'Документы', String(documentId), was, { status: 'ARCHIVED', reason: String(reason) }); } catch (e) {}
    return coreOk({ documentId: String(documentId), status: 'ARCHIVED', note: 'Документ не удалён — перенесён в архив (ТЗ §61)' });
  } catch (e) { return coreErr('DOCUMENT_ARCHIVE_ERROR', String(e)); }
}
