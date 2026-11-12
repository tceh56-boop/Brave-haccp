/**
 * MON CHEF — разделы режима проверки (ТЗ §34–§37, §65), дополнено по образцу Mon Cher (Audit.gs).
 *
 * Только чтение по временному ключу проверяющего (_requireAuditAccess_), каждое открытие — в
 * журнал доступа проверки (AUDIT_ACCESS_LOG). Персональные данные — минимум (§65): по персоналу
 * видно только «допущен / не допущен» и срок, без диагнозов, адресов и телефонов.
 *
 *   getAuditBatches        — партии склада: вход в прослеживаемость
 *   getAuditDeviations     — отклонения и корректирующие действия по ним
 *   getAuditTemperatures   — единый реестр температур
 *   getAuditStaff          — допуск персонала (без медицинских подробностей)
 *   getAuditEquipment      — оборудование и поверка
 *   getAuditDocumentFile   — скачивание документа: только если в сессии выдано право «download»
 *   getAuditAccessLog      — для администратора: что смотрел проверяющий
 *   createAuditSessionEx   — выдача доступа с выбором прав; скачивание выдаёт только администратор
 */
function _mcAuditLog_(s, action, type, id, docId, journalId, result) {
  try { _mcAuditAccessSheet_().appendRow([_mcUuid_(), s.sessionId, new Date(), action, s.inspectorName, type || '', id || '', docId || '', journalId || '', result || 'OK']); } catch (e) {}
}
function _mcAuditD_(x) {
  if (!x) return '';
  if (x instanceof Date) return Utilities.formatDate(x, _mcTz_(), 'dd.MM.yyyy HH:mm');
  return String(x);
}

function getAuditBatches(rawToken, limit) {
  try {
    var s = _requireAuditAccess_(rawToken, 'traceability');
    var sh = _stockBatchesSheet_(), v = sh.getDataRange().getValues(), out = [], lim = Math.max(1, Math.min(Number(limit) || 300, 2000));
    var st = { active: 'допущена', quarantine: 'карантин', recheck: 'повторный контроль', blocked: 'брак', consumed: 'израсходована' };
    for (var i = v.length - 1; i >= 1 && out.length < lim; i--) {
      var r = v[i]; if (!r[0]) continue;
      out.push({ batchId: r[0], product: r[1], unit: r[2], qty: r[3], received: _mcAuditD_(r[4]), expiry: _mcAuditD_(r[5]), source: r[7], remain: r[9], status: st[r[10]] || r[10] || '' });
    }
    _mcAuditLog_(s, 'AUDIT_OPEN_BATCHES', 'BATCH', '', '', '', 'OK');
    return coreOk({ batches: out });
  } catch (e) { return coreErr('AUDIT_BATCHES_ERROR', String(e)); }
}

function getAuditDeviations(rawToken) {
  try {
    var s = _requireAuditAccess_(rawToken, 'haccp');
    var dv = _devSheet_().getDataRange().getValues(), cv = _corrSheet_().getDataRange().getValues(), acts = {};
    for (var k = 1; k < cv.length; k++) if (cv[k][0]) (acts[cv[k][1]] = acts[cv[k][1]] || []).push({ id: cv[k][0], action: cv[k][2], who: cv[k][3], due: _mcAuditD_(cv[k][4]), status: cv[k][5], evidence: cv[k][6] ? 'есть' : 'нет', at: _mcAuditD_(cv[k][8]) });
    var out = [];
    for (var i = dv.length - 1; i >= 1; i--) {
      var r = dv[i]; if (!r[0]) continue;
      var jn = r[2]; try { jn = _journalName_(r[2]); } catch (e) {}
      out.push({ id: r[0], journal: jn, object: r[3], fact: r[4], value: r[5], critical: r[6] === true || r[6] === 'да', status: r[7], foundBy: r[10], at: _mcAuditD_(r[11]), resolved: _mcAuditD_(r[12]), actions: acts[r[0]] || [] });
    }
    _mcAuditLog_(s, 'AUDIT_OPEN_DEVIATIONS', 'DEVIATION', '', '', '', 'OK');
    return coreOk({ deviations: out, open: out.filter(function (x) { return !/закрыт|устранен/i.test(String(x.status)); }).length });
  } catch (e) { return coreErr('AUDIT_DEVIATIONS_ERROR', String(e)); }
}

function getAuditTemperatures(rawToken, days) {
  try {
    var s = _requireAuditAccess_(rawToken, 'haccp');
    var since = Date.now() - Math.max(1, Math.min(Number(days) || 31, 400)) * 86400000, out = [];
    var v = _tSheet_().getDataRange().getValues();
    for (var i = v.length - 1; i >= 1; i--) {
      var r = v[i]; if (!r[0]) continue;
      var t = r[10] instanceof Date ? r[10].getTime() : new Date(r[10]).getTime();
      if (isFinite(t) && t < since) continue;
      out.push({ id: r[0], type: r[1], object: r[2], min: r[5], max: r[6], value: r[7], unit: r[8], who: r[9], at: _mcAuditD_(r[10]), result: r[11], deviation: r[13], batch: r[14], action: r[17], decision: r[18], status: r[19] });
    }
    _mcAuditLog_(s, 'AUDIT_OPEN_TEMPERATURES', 'TEMPERATURE', '', '', '', 'OK');
    return coreOk({ measurements: out, deviations: out.filter(function (x) { return /DEVIATION|ОТКЛОН/i.test(String(x.result)); }).length });
  } catch (e) { return coreErr('AUDIT_TEMPERATURES_ERROR', String(e)); }
}

/** Персонал: только допуск. ТЗ §65 — без диагнозов, телефонов, адресов, дат рождения. */
function getAuditStaff(rawToken) {
  try {
    var s = _requireAuditAccess_(rawToken, 'read');
    var emps = []; try { emps = JSON.parse(getEmployeesFull_()).filter(function (e) { return e.active !== false && (e.fullName || e.name); }); } catch (e) {}
    var ru = { ADMITTED: 'допущен', EXPIRED: 'не допущен — срок медосмотра/аттестации истёк', BLOCKED: 'не допущен', LIMITED: 'допущен с ограничениями' };
    var out = emps.map(function (e) {
      var nm = e.fullName || e.name, a = { status: 'BLOCKED', reason: '' };
      try { a = _mcAdmissionByName_(nm); } catch (x) {}
      return { name: nm, position: e.position || '', admission: ru[a.status] || a.status, ok: a.status === 'ADMITTED' || a.status === 'LIMITED',
        validTo: a.item ? [a.item.examNext, a.item.attNext].filter(Boolean).sort()[0] || '' : '' };
    });
    _mcAuditLog_(s, 'AUDIT_OPEN_STAFF', 'STAFF', '', '', '', 'OK');
    return coreOk({ staff: out, note: 'Показан только допуск к работе (ТЗ §65). Медицинские сведения в режиме проверки не выводятся.' });
  } catch (e) { return coreErr('AUDIT_STAFF_ERROR', String(e)); }
}

function getAuditEquipment(rawToken) {
  try {
    var s = _requireAuditAccess_(rawToken, 'read');
    var list = []; try { list = _mcEqList_(); } catch (e) {}
    var out = list.map(function (e) { return { id: e.id, name: e.name, place: e.location || '', measuring: e.measuring ? 'да' : 'нет', verified: e.calibrated || '', next: e.nextCalibration || '', status: e.effective === 'ACTIVE' ? 'годен' : ('не годен: ' + (e.reason || e.status || '')) }; });
    _mcAuditLog_(s, 'AUDIT_OPEN_EQUIPMENT', 'EQUIPMENT', '', '', '', 'OK');
    return coreOk({ equipment: out });
  } catch (e) { return coreErr('AUDIT_EQUIPMENT_ERROR', String(e)); }
}

/** Скачивание файла документа — отдельное право сессии (ТЗ §36). */
function getAuditDocumentFile(rawToken, documentId) {
  var s;
  try { s = _requireAuditAccess_(rawToken, 'documents'); } catch (e) { return coreErr('AUDIT_ACCESS_DENIED', String(e)); }
  if (!s.permissions || s.permissions.download !== true) { _mcAuditLog_(s, 'AUDIT_DOWNLOAD', 'DOCUMENT', documentId, documentId, '', 'DENIED'); return coreErr('AUDIT_FORBIDDEN', 'Скачивание документов в этой сессии проверки не разрешено'); }
  try {
    var v = _mcDocRegistrySheet_().getDataRange().getValues(), row = null;
    for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(documentId)) { row = v[i]; break; }
    if (!row || !row[8]) return coreErr('DOCUMENT_NOT_FOUND', 'У документа нет файла');
    var f = DriveApp.getFileById(row[8]), b = f.getBlob();
    if (b.getBytes().length > 20 * 1024 * 1024) return coreErr('TOO_LARGE', 'Файл больше 20 МБ — запросите его у предприятия');
    var hash = _mcHashText_(Utilities.base64Encode(b.getBytes()));
    _mcAuditLog_(s, 'AUDIT_DOWNLOAD', 'DOCUMENT', documentId, documentId, '', 'OK');
    return coreOk({ name: f.getName(), mime: b.getContentType(), base64: Utilities.base64Encode(b.getBytes()), hash: hash, registryHash: row[9] || '', integrity: row[9] ? (row[9] === hash ? 'VALID' : 'CHANGED') : 'NO_HASH' });
  } catch (e) { return coreErr('AUDIT_DOWNLOAD_ERROR', String(e)); }
}

/** Журнал доступа проверки — для администратора (ТЗ §37). */
function getAuditAccessLog(sessionId, limit, token) {
  try {
    _requireAuth_(token, 'audit_create');
    var v = _mcAuditAccessSheet_().getDataRange().getValues(), out = [], lim = Math.max(1, Math.min(Number(limit) || 300, 3000));
    for (var i = v.length - 1; i >= 1 && out.length < lim; i--) {
      if (!v[i][0] || (sessionId && String(v[i][1]) !== String(sessionId))) continue;
      out.push({ at: _mcAuditD_(v[i][2]), session: v[i][1], action: v[i][3], inspector: v[i][4], type: v[i][5], object: v[i][6], document: v[i][7], journal: v[i][8] ? _journalName_(v[i][8]) : '', result: v[i][9] });
    }
    return coreOk({ log: out });
  } catch (e) { return coreErr('AUDIT_LOG_ERROR', String(e)); }
}

/**
 * Выдача доступа проверяющему с выбором прав. params: { inspectorName, authority, basis, objectId, ttlHours (1|4|8|24),
 * download (true/false) }. Право скачивания может выдать только администратор (выдать больше, чем имеешь, нельзя).
 */
function createAuditSessionEx(paramsJson, token) {
  var p = {}; try { p = typeof paramsJson === 'string' ? JSON.parse(paramsJson || '{}') : (paramsJson || {}); } catch (e) {}
  var s; try { s = _requireAuth_(token, 'audit_create'); } catch (e) { return coreErr('FORBIDDEN', String(e)); }
  var admin = s.dev === true || _mcRbHasExact_(s, 'haccp_approve');   // этап 10.7: директор или технический доступ
  if (p.download === true && !admin) return coreErr('FORBIDDEN', 'Право скачивания документов выдаёт только директор');
  var ttl = [1, 4, 8, 24].indexOf(Number(p.ttlHours)) >= 0 ? Number(p.ttlHours) : 4;
  var r = JSON.parse(createAuditSession(p.inspectorName || '', p.authority || '', p.basis || '', p.objectId || '', ttl, token));
  if (!r || r.success === false || !r.data) return JSON.stringify(r);
  if (p.download === true) {
    try {
      var sh = _mcAuditSessionSheet_(), v = sh.getDataRange().getValues();
      for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(r.data.sessionId)) {
        var perm = JSON.parse(v[i][8] || '{}'); perm.download = true; sh.getRange(i + 1, 9).setValue(JSON.stringify(perm)); r.data.permissions = perm; break;
      }
      _audit_({ session: s, tenant: _defaultTenant_(), id: r.data.sessionId, type: 'AUDIT_DOWNLOAD_GRANT' }, 'AUDIT_DOWNLOAD_GRANT', 'Проверка', r.data.sessionId, null, { download: true });
    } catch (e) {}
  }
  return JSON.stringify(r);
}

/* Имена функций ТЗ §42 поверх рабочих: */
/** Партия для проверяющего: сводка прослеживаемости (где хранилась, где использована, ККТ, выдача). */
function getAuditBatch(rawToken, batchId) {
  try {
    var s = _requireAuditAccess_(rawToken, 'traceability');
    if (!batchId) return coreErr('BATCH_REQUIRED', 'Укажите партию');
    var r = _mcTraceSummary_(String(batchId));
    _mcAuditLog_(s, 'AUDIT_OPEN_BATCH', 'BATCH', batchId, '', '', 'OK');
    return coreOk(r);
  } catch (e) { return coreErr('AUDIT_BATCH_ERROR', String(e)); }
}
function verifyAuditDocument(rawToken, documentId) { return verifyInspectionDocument(rawToken, documentId); }
/** Запись в журнал доступа проверки (ТЗ §37). Вызывается кодом сервера; из браузера — только администратор (шлюз). */
function logAuditAccess(sessionInfo, action, objectType, objectId, documentId, journalId, result) {
  _mcAuditLog_(sessionInfo || {}, action, objectType, objectId, documentId, journalId, result);
  return true;
}
