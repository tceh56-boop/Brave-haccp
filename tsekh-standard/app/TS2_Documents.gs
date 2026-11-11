/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
/**
 * ЦЕХ Стандарт 2.0 — конвейер документов (ТЗ 2.0 §10):
 *   приём файла → SHA-256 → реестр FILES/DOCUMENTS/DOCUMENT_VERSIONS → классификация → IMPORT_JOB →
 *   распознавание (текст отдельным артефактом, исходник не меняется) → нормализация полей {value, raw, confidence, method,
 *   sourcePage, requiresReview} → проверка → READY_FOR_REVIEW → решение по строкам → применение после backup.
 * Импорт не меняет рабочие данные без подтверждения. Повторная загрузка того же файла (тот же SHA-256) дубля не создаёт.
 */
var TS2_DOC_TYPES_ = ['TTK', 'CONTRACT', 'PPK', 'INSTRUCTION', 'CERTIFICATE', 'INVOICE', 'LABEL', 'NORM', 'ACT', 'OTHER'];
var TS2_CLASSIFY_ = [
  ['TTK', /ттк|технико|технологич\w* карт|тк[\s_№-]*\d|рецептур|калькуляц/i], ['CONTRACT', /договор|контракт|соглашени/i], ['PPK', /ппк|производственн\w* контрол/i],
  ['INSTRUCTION', /инструкц|должностн|положени|регламент/i], ['CERTIFICATE', /декларац|сертификат|удостоверени|протокол испыт/i],
  ['INVOICE', /накладн|счёт|счет-фактур|упд|торг-12/i], ['LABEL', /этикет|маркиров/i], ['NORM', /санпин|гост|тр тс|тр еаэс|приказ|постановлени|сп \d/i], ['ACT', /\bакт\b|акт_|акт /i]
];
var TS2_CONF_ = { AUTO: 0.95, QUICK: 0.80, REVIEW: 0.50 };   // ТЗ 2.2 §8.1 (настраивается: GENERATION_CONFIG)

function _ts2Classify_(name, text) {
  var s = String(name || '') + ' ' + String(text || '').slice(0, 3000);
  for (var i = 0; i < TS2_CLASSIFY_.length; i++) if (TS2_CLASSIFY_[i][1].test(s)) return TS2_CLASSIFY_[i][0];
  return 'OTHER';
}
function _ts2Field_(value, raw, confidence, method, page) {
  return { value: value, raw: raw === undefined ? value : raw, confidence: Math.round(confidence * 100) / 100, method: method, sourcePage: page || 1,
    requiresReview: confidence < Number(_ts2Cfg_('GENERATION_AUTO_THRESHOLD', TS2_CONF_.AUTO)) };
}

/* ------------------------------------------------------------------ приём файлов */
/** files: [{name, dataUrl}] → FILES/DOCUMENTS/DOCUMENT_VERSIONS + IMPORT_JOB. Дубли по SHA-256 не создаются. */
function _ts2Intake_(files, sourceType, docTypeHint) {
  var job = { importJobId: _ts2Id_('IMPORT_JOBS'), enterpriseId: _ts2Ent_(), sourceType: sourceType || 'UPLOAD', sourceFolderId: '', fileCount: 0, rowCount: 0, status: 'CREATED',
    stage: 'CREATED', profileId: '', startedAt: _ts2Iso_(), completedAt: '', startedBy: _ts2Actor_().name, errorCount: 0, warningCount: 0, reportFileId: '' };
  var inbox = _ts2Folder_('INBOX'), out = [];
  (files || []).forEach(function (f) {
    var m = /^data:([^;]+);base64,(.+)$/.exec(String(f.dataUrl || ''));
    if (!m) { job.errorCount++; return; }
    var bytes = Utilities.base64Decode(m[2]), sha = _ts2ShaBytes_(bytes);
    var known = _ts2Find_('FILES', 'sha256', sha);
    if (known) { out.push({ fileId: known.fileId, documentId: known.documentId, duplicate: true, name: f.name }); job.warningCount++; return; }
    var gf = inbox.createFile(Utilities.newBlob(bytes, m[1], String(f.name || 'документ')));
    var type = docTypeHint && TS2_DOC_TYPES_.indexOf(docTypeHint) >= 0 ? docTypeHint : _ts2Classify_(f.name, '');
    var fileId = _ts2Id_('FILES'), docId = _ts2Id_('DOCUMENTS'), verId = _ts2Id_('DOCUMENT_VERSIONS');
    _ts2Insert_('FILES', { fileId: fileId, enterpriseId: _ts2Ent_(), googleFileId: gf.getId(), googleUrl: gf.getUrl(), fileName: f.name, mimeType: m[1], sizeBytes: bytes.length, sha256: sha,
      parentFolderId: inbox.getId(), entityType: 'DOCUMENT', entityId: docId, documentId: docId, source: sourceType || 'UPLOAD', uploadedBy: _ts2Actor_().name, uploadedAt: _ts2Iso_(),
      lastSeenAt: _ts2Iso_(), status: 'UPLOADED', isOriginal: true, isPreview: false });
    _ts2Insert_('DOCUMENTS', { documentId: docId, enterpriseId: _ts2Ent_(), documentType: type, title: String(f.name || '').replace(/\.[^.]+$/, ''), number: '', documentDate: '', validFrom: '', validTo: '',
      counterpartyId: '', entityType: '', entityId: '', currentVersionId: verId, status: 'UPLOADED', sourceFileId: fileId, ownerEmployeeId: '', createdAt: _ts2Iso_(), updatedAt: _ts2Iso_() });
    _ts2Insert_('DOCUMENT_VERSIONS', { documentVersionId: verId, documentId: docId, versionNumber: 1, fileId: fileId, extractedTextFileId: '', extractedDataJsonFileId: '', sha256: sha, parser: '',
      parserVersion: '', confidence: '', status: 'UPLOADED', changeSummary: 'исходный файл', createdAt: _ts2Iso_(), createdBy: _ts2Actor_().name, approvedAt: '', approvedBy: '' });
    _ts2Insert_('IMPORT_ITEMS', { importItemId: _ts2Id_('IMPORT_ITEMS'), importJobId: job.importJobId, fileId: fileId, rowNumber: 0, sourceObjectType: type, sourceObjectName: f.name,
      rawDataJson: '', normalizedDataJson: '', matchedEntityType: '', matchedEntityId: '', confidence: '', status: 'QUEUED', issuesJson: '', reviewedBy: '', reviewedAt: '' });
    job.fileCount++;
    out.push({ fileId: fileId, documentId: docId, type: type, name: f.name });
  });
  job.status = job.fileCount ? 'QUEUED' : 'CANCELLED'; job.stage = job.status;
  _ts2Insert_('IMPORT_JOBS', job);
  _ts2Audit_('IMPORT_CREATE', 'IMPORT_JOB', job.importJobId, undefined, { files: out.length }, '');
  return { importJobId: job.importJobId, files: out };
}

/* ------------------------------------------------------------------ распознавание */
/** Текст файла. Google Drive делает распознавание PDF и изображений при копировании в Google Документ. Результат — отдельный файл. */
function _ts2ExtractText_(fileRow) {
  if (!fileRow || !fileRow.googleFileId) throw new Error('VALIDATION: у документа отсутствует Google Drive ID');
  _tsTenantAssertFileWithin_(fileRow.googleFileId, 'INBOX');
  var mime = String(fileRow.mimeType), id = fileRow.googleFileId, token = ScriptApp.getOAuthToken();
  if (/^text\/|csv/.test(mime)) return { text: DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8'), parser: 'TEXT', confidence: 1 };
  var target = /sheet|excel|spreadsheetml/.test(mime) ? 'application/vnd.google-apps.spreadsheet' : 'application/vnd.google-apps.document';
  var r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '/copy?ocrLanguage=ru&fields=id', { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token }, payload: JSON.stringify({ mimeType: target, name: fileRow.fileName + ' (распознано)', parents: [_ts2Folder_('SYS_IMPORT_REPORTS').getId()] }) });
  if (r.getResponseCode() >= 300) throw new Error('распознавание: Drive ответил HTTP ' + r.getResponseCode());
  var gid = JSON.parse(r.getContentText()).id, text = '';
  if (target === 'application/vnd.google-apps.spreadsheet') {
    var ss = SpreadsheetApp.openById(gid); text = ss.getSheets().map(function (s) { return s.getDataRange().getValues().map(function (row) { return row.join('\t'); }).join('\n'); }).join('\n\f\n');
  } else text = DocumentApp.openById(gid).getBody().getText();
  var ocr = /pdf|image/.test(mime);
  return { text: text, parser: ocr ? 'DRIVE_OCR' : 'DRIVE_CONVERT', confidence: ocr ? 0.85 : 0.97, convertedId: gid };
}

/* ------------------------------------------------------------------ нормализация */
var TS2_UNITS_ = { 'г': 'г', 'гр': 'г', 'грамм': 'г', 'кг': 'кг', 'мл': 'мл', 'л': 'л', 'шт': 'шт', 'штук': 'шт', 'порц': 'порц' };
function _ts2Num_(s) { var m = /-?\d+(?:[.,]\d+)?/.exec(String(s || '')); return m ? parseFloat(m[0].replace(',', '.')) : null; }
function _ts2NormName_(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"']/g, '').replace(/\s+/g, ' ').trim(); }
/** Поля ТТК из текста (ТЗ 2.2 §2). Каждое поле — с исходным значением, уверенностью и способом. */
function _ts2ParseTtkText_(text, baseConf) {
  var lines = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean), f = {};
  var page = 1, pageOf = {};
  String(text || '').split('\f').forEach(function (chunk, i) { chunk.split(/\r?\n/).forEach(function (l) { pageOf[l.trim()] = i + 1; }); });
  var nameLine = lines.filter(function (l) { return /наименование|блюд[оа]|изделие/i.test(l) && l.length < 160; })[0] || lines[0] || '';
  var name = nameLine.replace(/^.*?(наименование( блюда| изделия)?|блюдо)\s*[:—-]?\s*/i, '').replace(/[«»"]/g, '').trim();
  f.name = _ts2Field_(name, nameLine, name ? baseConf * 0.95 : 0.3, 'TEXT_RULES', pageOf[nameLine]);
  var code = /(?:ТТК|ТК)\s*(?:№|N)?\s*([\w-]+)/i.exec(text); f.code = _ts2Field_(code ? code[1] : '', code ? code[0] : '', code ? baseConf : 0.2, 'TEXT_RULES');
  var yl = lines.filter(function (l) { return /выход/i.test(l); })[0]; var y = yl ? _ts2Num_(yl.replace(/^.*?выход/i, '')) : null;
  f.yield = _ts2Field_(y, yl || '', y ? baseConf * 0.95 : 0.2, 'TEXT_RULES', pageOf[yl]);
  var ing = [];
  lines.forEach(function (l) {
    var m = /^(?:\d+[.)]\s*)?([А-Яа-яЁё][А-Яа-яЁё0-9 ,.%()\-\/«»]{1,70}?)\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)(?:\s*(г|кг|мл|л|шт))?\s*$/.exec(l.replace(/\t/g, ' '));
    if (m && !/выход|итого|всего/i.test(m[1])) ing.push({ name: m[1].trim(), brutto: parseFloat(m[2].replace(',', '.')), netto: parseFloat(m[3].replace(',', '.')), unit: TS2_UNITS_[m[4] || 'г'] || 'г', raw: l });
  });
  f.ingredients = _ts2Field_(ing, ing.map(function (i) { return i.raw; }).join('\n'), ing.length ? baseConf * 0.9 : 0.2, 'TABLE_RULES');
  var ti = text.search(/технолог\w* (процесс|приготовлени)|технология/i), te = text.search(/требования к оформлен|органолептич|срок\w* (годности|хранения|реализац)|показатели/i);
  var tech = ti >= 0 ? text.slice(ti, te > ti ? te : ti + 3000).replace(/^.*?\n/, '').trim() : '';
  f.technology = _ts2Field_(tech, tech.slice(0, 300), tech ? baseConf * 0.9 : 0.2, 'TEXT_RULES');
  var sl = /срок\w*\s+(годности|хранения|реализации)[^\d]{0,40}(\d+(?:[.,]\d+)?)\s*(час|ч\b|сут|дн|мин)/i.exec(text);
  var hours = sl ? _ts2Num_(sl[2]) * (/сут|дн/i.test(sl[3]) ? 24 : /мин/i.test(sl[3]) ? 1 / 60 : 1) : null;
  f.shelfLifeHours = _ts2Field_(hours, sl ? sl[0] : '', sl ? baseConf * 0.9 : 0, 'TEXT_RULES');
  var st = /(?:хран\w+|при температуре)[^.\n]{0,40}?(?:от\s*)?([+-]?\d+)\s*(?:°\s*С?|град)?\s*(?:до|…|\.\.\.|-|–)\s*([+-]?\d+)\s*°?\s*С/i.exec(text);
  f.storage = _ts2Field_(st ? { min: Number(st[1]), max: Number(st[2]) } : null, st ? st[0] : '', st ? baseConf * 0.85 : 0, 'TEXT_RULES');
  var temps = []; var re = /(?:температур\w*|t)\s*(?:в толще|внутри)?[^.\n]{0,30}?(не ниже|не менее|до|≥|>=|не выше|≤)?\s*([+-]?\d{1,3})\s*°\s*С/gi, mm;
  while ((mm = re.exec(text))) temps.push({ op: mm[1] || '', value: Number(mm[2]), text: mm[0] });
  f.temperatures = _ts2Field_(temps, temps.map(function (t) { return t.text; }).join('; '), temps.length ? baseConf * 0.85 : 0, 'TEXT_RULES');
  var cat = /категори\w*\s*[:—-]\s*([^\n]{2,40})/i.exec(text); f.category = _ts2Field_(cat ? cat[1].trim() : '', cat ? cat[0] : '', cat ? baseConf : 0.3, 'TEXT_RULES');
  return f;
}
function _ts2ParseContractText_(text, baseConf) {
  var f = {}, num = /договор\w*\s*(?:№|N)\s*([\w\/-]+)/i.exec(text), date = /от\s*«?(\d{1,2})»?[.\s]*([а-я]+|\d{1,2})[.\s]*(\d{4})/i.exec(text);
  var inn = /ИНН\s*:?\s*(\d{10}|\d{12})/.exec(text), org = /(ООО|ИП|АО|ПАО|ЗАО)\s*«?([^»\n,]{2,60})»?/.exec(text), to = /(?:действует|срок действия)[^\n]{0,60}?до\s*«?(\d{1,2})»?[.\s]*(\d{1,2}|[а-я]+)[.\s]*(\d{4})/i.exec(text);
  f.number = _ts2Field_(num ? num[1] : '', num ? num[0] : '', num ? baseConf : 0.2, 'TEXT_RULES');
  f.date = _ts2Field_(date ? date[0].replace(/^от\s*/, '') : '', date ? date[0] : '', date ? baseConf * 0.9 : 0.2, 'TEXT_RULES');
  f.counterpartyInn = _ts2Field_(inn ? inn[1] : '', inn ? inn[0] : '', inn ? baseConf : 0.2, 'TEXT_RULES');
  f.counterparty = _ts2Field_(org ? org[1] + ' «' + org[2].trim() + '»' : '', org ? org[0] : '', org ? baseConf * 0.85 : 0.2, 'TEXT_RULES');
  f.validTo = _ts2Field_(to ? to[0].replace(/^.*до\s*/i, '') : '', to ? to[0] : '', to ? baseConf * 0.8 : 0.1, 'TEXT_RULES');
  return f;
}
function _ts2MinConf_(fields, keys) { return keys.reduce(function (m, k) { return Math.min(m, fields[k] ? Number(fields[k].confidence) : 0); }, 1); }

/** Распознать и нормализовать работу импорта. Состояние сохраняется по строкам: прерванная работа продолжается с места остановки. */
function _ts2ProcessImport_(jobId) {
  var job = _ts2Find_('IMPORT_JOBS', 'importJobId', jobId); if (!job) throw new Error('NOT_FOUND: импорт не найден');
  if (['APPLIED', 'CANCELLED'].indexOf(job.status) >= 0) return job;
  _ts2Update_('IMPORT_JOBS', 'importJobId', jobId, { status: 'PARSING', stage: 'PARSING' });
  var items = _ts2Rows_('IMPORT_ITEMS', function (i) { return i.importJobId === jobId && (i.status === 'QUEUED' || i.status === 'ERROR'); }), errors = 0, warnings = 0, rows = 0;
  items.forEach(function (it) {
    try {
      var fr = _ts2Find_('FILES', 'fileId', it.fileId), ex = _ts2ExtractText_(fr);
      var txt = _ts2Folder_('SYS_IMPORT_REPORTS').createFile(Utilities.newBlob(ex.text, 'text/plain', fr.fileName + '.txt'));
      var type = it.sourceObjectType === 'OTHER' ? _ts2Classify_(fr.fileName, ex.text) : it.sourceObjectType;
      var fields = type === 'TTK' ? _ts2ParseTtkText_(ex.text, ex.confidence) : type === 'CONTRACT' ? _ts2ParseContractText_(ex.text, ex.confidence) : { title: _ts2Field_(fr.fileName, fr.fileName, 1, 'FILE_NAME') };
      var keys = type === 'TTK' ? ['name', 'yield', 'ingredients', 'technology'] : type === 'CONTRACT' ? ['number', 'counterparty'] : ['title'];
      var conf = _ts2MinConf_(fields, keys), issues = [];
      Object.keys(fields).forEach(function (k) { var x = fields[k]; if (x.confidence < TS2_CONF_.REVIEW) issues.push({ field: k, status: 'NOT_RECOGNIZED' }); else if (x.requiresReview) issues.push({ field: k, status: 'REQUIRES_REVIEW', confidence: x.confidence }); });
      if (issues.length) warnings++;
      var match = type === 'TTK' ? _ts2MatchTtk_(fields.name.value) : null;
      var json = _ts2Folder_('SYS_IMPORT_REPORTS').createFile(Utilities.newBlob(JSON.stringify(fields, null, 1), 'application/json', fr.fileName + '.json'));
      _ts2Update_('DOCUMENT_VERSIONS', 'documentVersionId', _ts2Find_('DOCUMENTS', 'documentId', fr.documentId).currentVersionId,
        { extractedTextFileId: txt.getId(), extractedDataJsonFileId: json.getId(), parser: ex.parser, parserVersion: '2.2', confidence: conf, status: 'PARSED' });
      _ts2Update_('DOCUMENTS', 'documentId', fr.documentId, { documentType: type, status: 'PARSED', updatedAt: _ts2Iso_(), number: fields.number ? fields.number.value : '' });
      _ts2Update_('IMPORT_ITEMS', 'importItemId', it.importItemId, { sourceObjectType: type, rawDataJson: JSON.stringify({ text: ex.text.slice(0, 40000) }), normalizedDataJson: JSON.stringify(fields),
        matchedEntityType: match ? 'DISH' : '', matchedEntityId: match ? match.code : '', confidence: conf, status: 'READY_FOR_REVIEW', issuesJson: JSON.stringify(issues) });
      rows++;
    } catch (e) {
      errors++;
      _ts2Update_('IMPORT_ITEMS', 'importItemId', it.importItemId, { status: 'ERROR', issuesJson: JSON.stringify([{ error: String(e.message || e) }]) });
    }
  });
  var st = errors && !rows ? 'FAILED' : 'READY_FOR_REVIEW';
  _ts2Update_('IMPORT_JOBS', 'importJobId', jobId, { status: st, stage: st, rowCount: Number(job.rowCount || 0) + rows, errorCount: Number(job.errorCount || 0) + errors, warningCount: Number(job.warningCount || 0) + warnings });
  _ts2Audit_('IMPORT_PARSE', 'IMPORT_JOB', jobId, undefined, { rows: rows, errors: errors, warnings: warnings }, '');
  return _ts2Find_('IMPORT_JOBS', 'importJobId', jobId);
}
function _ts2MatchTtk_(name) {
  var n = _ts2NormName_(name); if (!n) return null;
  var sh = _book_().getSheetByName('Блюда'); if (!sh || sh.getLastRow() < 2) return null;
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  for (var i = 0; i < v.length; i++) if (_ts2NormName_(v[i][1]) === n) return { code: String(v[i][0]), name: v[i][1] };
  return null;
}

/** Применить подтверждённые строки импорта (backup PRE_IMPORT перед изменением рабочих данных). */
function _ts2ApplyImport_(jobId, token) {
  var job = _ts2Find_('IMPORT_JOBS', 'importJobId', jobId); if (!job) throw new Error('NOT_FOUND: импорт не найден');
  if (job.status !== 'READY_FOR_REVIEW' && job.status !== 'APPROVED' && job.status !== 'PARTIAL') throw new Error('VALIDATION: импорт в статусе ' + job.status + ' — сначала распознавание и проверка');
  var items = _ts2Rows_('IMPORT_ITEMS', function (i) { return i.importJobId === jobId && i.status === 'APPROVED'; });
  if (!items.length) throw new Error('VALIDATION: нет подтверждённых строк');
  var backupId = _ts2Backup_('PRE_IMPORT', jobId), applied = 0, failed = 0;
  items.forEach(function (it) {
    var f = _ts2Json_(it.normalizedDataJson, {}), res = null;
    try {
      if (it.sourceObjectType === 'TTK') {
        if (it.matchedEntityId) { res = { linked: it.matchedEntityId }; }
        else {
          var ing = (f.ingredients && f.ingredients.value || []).map(function (x) { return { name: x.name, qty: x.brutto || x.netto, unit: x.unit || 'г' }; });
          var r = _ts2J_(createDish(JSON.stringify({ name: f.name.value, yield: f.yield && f.yield.value, method: f.technology && f.technology.value, ingredients: ing }), token));
          if (r && (r.success === false || r.ok === false)) throw new Error(r.error && r.error.message || 'ТТК не создана');
          res = r && r.data || r;
        }
      } else if (it.sourceObjectType === 'CONTRACT') {
        var c = _ts2J_(tsContractSave(token, { 'Номер': f.number.value || 'б/н', 'Дата': '', 'Контрагент': f.counterparty.value || '—', 'ИНН': f.counterpartyInn.value || '', 'Вид': 'Прочее', 'Комментарий': 'импорт ' + jobId }));
        if (c && c.success === false) throw new Error(c.error && c.error.message);
        res = c && c.data;
      } else res = { registered: true };
      _ts2Update_('IMPORT_ITEMS', 'importItemId', it.importItemId, { status: 'APPLIED', matchedEntityId: it.matchedEntityId || (res && (res.code || res.id)) || '' });
      _ts2Insert_('MIGRATION_MAP', { migrationMapId: _ts2Id_('MIGRATION_MAP'), enterpriseId: _ts2Ent_(), sourceSystem: 'IMPORT', sourceSheet: jobId, sourceKey: it.importItemId, sourceRow: it.rowNumber,
        legacyValue: it.sourceObjectName, entityType: it.sourceObjectType, entityId: (res && (res.code || res.id || res.linked)) || '', mappingMethod: it.matchedEntityId ? 'MATCH_BY_NAME' : 'CREATED',
        confidence: it.confidence, status: 'APPLIED', reviewedBy: it.reviewedBy, reviewedAt: it.reviewedAt, notes: '' });
      applied++;
    } catch (e) { failed++; _ts2Update_('IMPORT_ITEMS', 'importItemId', it.importItemId, { status: 'ERROR', issuesJson: JSON.stringify([{ error: String(e.message || e) }]) }); }
  });
  var st = failed ? (applied ? 'PARTIAL' : 'FAILED') : 'APPLIED';
  _ts2Update_('IMPORT_JOBS', 'importJobId', jobId, { status: st, stage: st, completedAt: _ts2Iso_() });
  _ts2Audit_('IMPORT_APPLY', 'IMPORT_JOB', jobId, undefined, { applied: applied, failed: failed, backupId: backupId }, '', st);
  return { status: st, applied: applied, failed: failed, backupId: backupId };
}
function _ts2J_(r) { if (typeof r === 'string') { try { return JSON.parse(r); } catch (e) { return { raw: r }; } } return r; }

/* ------------------------------------------------------------------ API */
function ts2Upload(token, files, docType) {
  try { _requireAuth_(token); _ts2EnsureSchema_(false); var r = _ts2Intake_(files, 'UPLOAD', docType); return _ok_(r); } catch (e) { return _failFrom_(e); }
}
function ts2ProcessImport(token, jobId) { try { _requireAuth_(token); return _ok_(_ts2ProcessImport_(jobId)); } catch (e) { return _failFrom_(e); } }
function ts2Imports(token) {
  try {
    _requireAuth_(token); _ts2EnsureSchema_(false);
    var jobs = _ts2Rows_('IMPORT_JOBS').reverse().slice(0, 50), items = _ts2Rows_('IMPORT_ITEMS');
    return _ok_(jobs.map(function (j) { j.items = items.filter(function (i) { return i.importJobId === j.importJobId; }).map(function (i) { delete i.rawDataJson; return i; }); return j; }));
  } catch (e) { return _failFrom_(e); }
}
/** Решение по строке импорта: APPROVED / REJECTED; editedFields — исправленные значения полей (исходное сохраняется в raw). */
function ts2ReviewImportItem(token, itemId, decision, editedFields) {
  try {
    _requireAuth_(token);
    if (['APPROVED', 'REJECTED'].indexOf(decision) < 0) return _fail_('VALIDATION', 'Решение: APPROVED или REJECTED');
    var it = _ts2Find_('IMPORT_ITEMS', 'importItemId', itemId); if (!it) return _fail_('NOT_FOUND', 'Строка импорта не найдена');
    var f = _ts2Json_(it.normalizedDataJson, {});
    Object.keys(editedFields || {}).forEach(function (k) { if (f[k]) { f[k] = { value: editedFields[k], raw: f[k].raw, confidence: 1, method: 'USER_EDIT', sourcePage: f[k].sourcePage, requiresReview: false }; } });
    _ts2Update_('IMPORT_ITEMS', 'importItemId', itemId, { status: decision, normalizedDataJson: JSON.stringify(f), reviewedBy: _ts2Actor_().name, reviewedAt: _ts2Iso_() });
    _ts2Audit_('IMPORT_REVIEW', 'IMPORT_ITEM', itemId, { status: it.status }, { status: decision, edited: Object.keys(editedFields || {}) }, '');
    return _ok_({ itemId: itemId, status: decision });
  } catch (e) { return _failFrom_(e); }
}
function ts2ApplyImport(token, jobId) { try { _requireAuth_(token); return _ok_(_ts2ApplyImport_(jobId, token)); } catch (e) { return _failFrom_(e); } }
function ts2Documents(token) {
  try { _requireAuth_(token); _ts2EnsureSchema_(false); return _ok_({ documents: _ts2Rows_('DOCUMENTS').reverse().slice(0, 300), files: _ts2Rows_('FILES').length }); } catch (e) { return _failFrom_(e); }
}
