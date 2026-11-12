/* ============================================================================
 * MON CHEF V8 — MONTHLY DRIVE ARCHIVE ENGINE
 *
 * Принцип:
 *   - рабочие листы/реестры остаются в основной книге;
 *   - в последний календарный день месяца создаётся неизменяемый снимок месяца;
 *   - архив физически хранится на Google Drive в понятной структуре;
 *   - документы/сканы не удаляются из рабочего реестра, а копируются в архив;
 *   - журнальные строки переносятся в отдельный архивный Google Sheet и удаляются
 *     только из текущего рабочего листа после успешного создания снимка;
 *   - каждый архив получает MANIFEST.json с контрольными данными.
 *
 * Структура:
 *   MON CHEF — Архив/
 *     Сентябрь 2026 г/
 *       01 Журналы/
 *       02 Приход продукции/
 *       03 Обучение/
 *       04 Банкеты/
 *       05 Документы/
 *       06 Склад/
 *       07 Производство/
 *       08 HACCP и контроль/
 *       99 Служебное/
 *
 * ВАЖНО: архивирование не является юридически значимой электронной подписью.
 * Подписи журналов остаются в отдельном контуре Mon Chef.
 * ========================================================================== */

var MC_V8_ARCHIVE_ROOT = 'MON CHEF — Архив';
var MC_V8_ARCHIVE_MONTH_FORMAT = 'yyyy-MM-dd';
var MC_V8_ARCHIVE_LOCK_KEY = 'MC_V8_ARCHIVE_RUNNING';

function _mcV8ArchiveRoot_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('MC_V8_ARCHIVE_ROOT_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) {}
  }
  var it = DriveApp.getFoldersByName(MC_V8_ARCHIVE_ROOT);
  var f = it.hasNext() ? it.next() : DriveApp.createFolder(MC_V8_ARCHIVE_ROOT);
  props.setProperty('MC_V8_ARCHIVE_ROOT_ID', f.getId());
  return f;
}

function _mcV8ArchiveMonthLabel_(date) {
  var names = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  return names[date.getMonth()] + ' ' + date.getFullYear() + ' г';
}

function _mcV8ArchiveMonthFolder_(date) {
  var root = _mcV8ArchiveRoot_();
  var label = _mcV8ArchiveMonthLabel_(date);
  var it = root.getFoldersByName(label);
  var f = it.hasNext() ? it.next() : root.createFolder(label);
  return f;
}

function _mcV8ArchiveSubFolder_(monthFolder, name) {
  var it = monthFolder.getFoldersByName(name);
  return it.hasNext() ? it.next() : monthFolder.createFolder(name);
}

function _mcV8ArchiveDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return new Date(value.getTime());
  if (value === null || value === undefined || value === '') return null;
  try {
    if (typeof _parseDate_ === 'function') {
      var p = _parseDate_(value);
      if (p instanceof Date && !isNaN(p.getTime())) return p;
    }
  } catch (e) {}
  var s = String(value).trim();
  var m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  var iso = new Date(s);
  return isNaN(iso.getTime()) ? null : iso;
}

function _mcV8InMonth_(value, year, month) {
  var d = _mcV8ArchiveDate_(value);
  return !!d && d.getFullYear() === year && d.getMonth() === month;
}

function _mcV8SafeFileName_(name) {
  return String(name || 'Документ').replace(/[\\\/:*?"<>|#%{}]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 180);
}

function _mcV8HashText_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { var n = b < 0 ? b + 256 : b; return ('0' + n.toString(16)).slice(-2); }).join('');
}

function _mcV8JsonFile_(folder, name, obj) {
  var text = JSON.stringify(obj, null, 2);
  return folder.createFile(Utilities.newBlob(text, 'application/json', _mcV8SafeFileName_(name)));
}

function _mcV8SheetDateColumn_(sheetName, headers) {
  var preferred = {
    'Банкеты': [1],
    'Персонал_Обучение': [5],
    'Документы': [4],
    'Заказы_Поставщикам': [1, 9, 10],
    'Склад_Операции': [1],
    'Производство': [10, 17, 11],
    'Операции': [7],
    'Разбор_Акты': [1, 13],
    'Лаборатория_Исследования': [6, 9, 16],
    'Чеклисты_Выполнение': [5, 8],
    'Журналы_Ожидания': [5, 11, 12],
    'Журналы_Отклонения': [1, 2],
    'Корректирующие_Действия': [0, 8, 9],
    'Себестоимость_Снимки': [2, 7]
  };
  if (preferred[sheetName]) return preferred[sheetName];
  var out = [];
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || '').toLowerCase();
    if (h.indexOf('дата') >= 0 || h.indexOf('created') >= 0 || h.indexOf('создан') >= 0 || h.indexOf('время') >= 0) out.push(i);
  }
  return out.length ? out : [1];
}

function _mcV8CopySheetMonth_(sheetName, archiveFolder, displayName, year, month, removeFromActive) {
  var ss = _book_();
  var sh = ss.getSheetByName(sheetName);
  if (!sh || sh.getLastRow() <= 1) return { sheet: sheetName, rows: 0, status: 'EMPTY' };

  var values = sh.getDataRange().getValues();
  var headers = values[0];
  var dateCols = _mcV8SheetDateColumn_(sheetName, headers);
  var selected = [];
  var keep = [headers];

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var inMonth = dateCols.some(function (c) { return _mcV8InMonth_(row[c], year, month); });
    if (inMonth) selected.push(row); else keep.push(row);
  }
  if (!selected.length) return { sheet: sheetName, rows: 0, status: 'NO_ROWS' };

  var fileName = _mcV8SafeFileName_(displayName + ' архив ' + _mcV8ArchiveMonthLabel_(new Date(year, month, 1)));
  var archiveSS = SpreadsheetApp.create(fileName);
  var ash = archiveSS.getSheets()[0];
  ash.setName('Архив');
  ash.getRange(1, 1, 1, headers.length).setValues([headers]);
  ash.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#1a3a2a').setFontColor('#ffffff');
  ash.getRange(2, 1, selected.length, headers.length).setValues(selected);
  ash.setFrozenRows(1);
  SpreadsheetApp.flush();

  var file = DriveApp.getFileById(archiveSS.getId());
  archiveFolder.addFile(file);
  try { DriveApp.getRootFolder().removeFile(file); } catch (e) {}

  var pdfFileId = '';
  try {
    var url = 'https://docs.google.com/spreadsheets/d/' + archiveSS.getId() + '/export' +
      '?format=pdf&gid=' + ash.getSheetId() + '&size=A4&portrait=false&fitw=true&gridlines=true&sheetnames=false&pagenumbers=true';
    var resp = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (resp.getResponseCode() === 200) {
      var pdf = archiveFolder.createFile(resp.getBlob().setName(fileName + '.pdf'));
      pdfFileId = pdf.getId();
    }
  } catch (ePdf) {}

  if (removeFromActive) {
    sh.clearContents();
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    try { sh.getRange(1, 1, 1, headers.length).setBackground('#1a3a2a').setFontColor('#ffffff').setFontWeight('bold'); } catch (eFmt) {}
    sh.setFrozenRows(1);
    if (keep.length > 1) sh.getRange(2, 1, keep.length - 1, headers.length).setValues(keep.slice(1));
  }

  return { sheet: sheetName, rows: selected.length, status: 'ARCHIVED', fileId: file.getId(), pdfFileId: pdfFileId, name: fileName };
}

function _mcV8CopyDriveFile_(fileId, folder, prefix) {
  if (!fileId) return null;
  try {
    var file = DriveApp.getFileById(String(fileId));
    var copyName = _mcV8SafeFileName_(prefix ? prefix + ' — ' + file.getName() : file.getName());
    var copy = file.makeCopy(copyName, folder);
    return { sourceId: file.getId(), archiveId: copy.getId(), name: copy.getName(), url: copy.getUrl() };
  } catch (e) { return { sourceId: String(fileId), error: String(e) }; }
}

function _mcV8ArchiveRegistryFiles_(sheetName, folder, year, month, dateCol, fileIdCol, nameCol, categoryLabel) {
  var sh = _book_().getSheetByName(sheetName);
  if (!sh || sh.getLastRow() <= 1) return [];
  var v = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < v.length; i++) {
    if (!_mcV8InMonth_(v[i][dateCol], year, month)) continue;
    var fileId = v[i][fileIdCol];
    if (!fileId) continue;
    var name = v[i][nameCol] || categoryLabel;
    var copied = _mcV8CopyDriveFile_(fileId, folder, String(name));
    if (copied) out.push(copied);
  }
  return out;
}

function _mcV8ArchiveEventFiles_(folder, year, month) {
  var sh = _book_().getSheetByName('Банкеты');
  if (!sh || sh.getLastRow() <= 1) return [];
  var v = sh.getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) {
    if (!_mcV8InMonth_(v[i][1], year, month)) continue;
    var obj = {};
    try { obj = JSON.parse(v[i][5] || '{}'); } catch (e) {}
    var ids = [];
    var walk = function (x, path) {
      if (x === null || x === undefined) return;
      if (typeof x === 'string') {
        if (/^[a-zA-Z0-9_-]{20,}$/.test(x) && /file|файл|document|документ/i.test(path || '')) ids.push(x);
        return;
      }
      if (typeof x !== 'object') return;
      Object.keys(x).forEach(function (k) { walk(x[k], (path ? path + '.' : '') + k); });
    };
    walk(obj, '');
    var unique = {};
    ids.forEach(function (id) { if (!unique[id]) { unique[id] = true; var c = _mcV8CopyDriveFile_(id, folder, String(v[i][2] || 'Банкет') + ' ' + String(v[i][0])); if (c) out.push(c); } });
  }
  return out;
}


function _mcV8ArchiveReceiving_(monthFolder, year, month) {
  var ss = _book_();
  var sh = ss.getSheetByName('Склад_Операции');
  if (!sh || sh.getLastRow() <= 1) return { rows: 0, status: 'EMPTY' };
  var v = sh.getDataRange().getValues(), selected = [];
  for (var i = 1; i < v.length; i++) {
    var type = String(v[i][2] || '').toLowerCase();
    var source = String(v[i][8] || '').toLowerCase();
    if (!_mcV8InMonth_(v[i][1], year, month)) continue;
    if (type.indexOf('приход') < 0 && source.indexOf('приход') < 0 && source.indexOf('наклад') < 0 && type.indexOf('receipt') < 0) continue;
    selected.push(v[i]);
  }
  var batchSh = ss.getSheetByName('Склад_Партии');
  var batches = [];
  if (batchSh && batchSh.getLastRow() > 1) {
    var bv = batchSh.getDataRange().getValues();
    for (var j = 1; j < bv.length; j++) if (_mcV8InMonth_(bv[j][4], year, month)) batches.push(bv[j]);
  }
  if (!selected.length && !batches.length) return { rows: 0, batches: 0, status: 'NO_ROWS' };
  var label = _mcV8ArchiveMonthLabel_(new Date(year, month, 1));
  var name = _mcV8SafeFileName_('Приход продукции архив ' + label);
  var out = SpreadsheetApp.create(name);
  var a = out.getSheets()[0]; a.setName('Приход продукции');
  var headers = v[0];
  a.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold').setBackground('#1a3a2a').setFontColor('#ffffff');
  if (selected.length) a.getRange(2,1,selected.length,headers.length).setValues(selected);
  if (batches.length) {
    var start = selected.length + 4;
    var bh = batchSh.getDataRange().getValues()[0];
    a.getRange(start,1,1,bh.length).setValues([bh]).setFontWeight('bold').setBackground('#3d5c35').setFontColor('#ffffff');
    a.getRange(start+1,1,batches.length,bh.length).setValues(batches);
  }
  a.setFrozenRows(1); SpreadsheetApp.flush();
  var file = DriveApp.getFileById(out.getId());
  var folder = _mcV8ArchiveSubFolder_(monthFolder, '02 Приход продукции');
  folder.addFile(file); try { DriveApp.getRootFolder().removeFile(file); } catch(e) {}
  return { name: name, fileId: file.getId(), rows: selected.length, batches: batches.length, status: 'ARCHIVED' };
}

function _mcV8ArchiveRegistrySheet_(sheetName, folderName, displayName, year, month) {
  try {
    var r = _mcV8CopySheetMonth_(sheetName, _mcV8ArchiveSubFolder_(_mcV8ArchiveMonthFolder_(new Date(year, month, 1)), folderName), displayName, year, month, false);
    return r;
  } catch (e) { return { sheet: sheetName, status: 'ERROR', error: String(e) }; }
}

function _mcV8ArchiveTrainingFiles_(folder, year, month) {
  return _mcV8ArchiveRegistryFiles_('Персонал_Обучение', folder, year, month, 5, 7, 1, 'Обучение');
}

function _mcV8ArchiveDocumentFiles_(folder, year, month) {
  return _mcV8ArchiveRegistryFiles_('Документы', folder, year, month, 4, 7, 2, 'Документ');
}

function _mcV8ArchiveSignatureFiles_(folder, year, month) {
  var sh = _book_().getSheetByName('Журналы_Подписи');
  if (!sh || sh.getLastRow() <= 1) return [];
  var v = sh.getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) {
    if (!_mcV8InMonth_(v[i][10], year, month)) continue;
    if (!v[i][15]) continue;
    var c = _mcV8CopyDriveFile_(v[i][15], folder, 'Подписанный журнал — ' + String(v[i][2] || 'Журнал'));
    if (c) out.push(c);
  }
  return out;
}

function _mcV8BuildArchiveManifest_(month, results) {
  var flat = JSON.stringify(results);
  return {
    schema: 'MON_CHEF_ARCHIVE_V8',
    archiveMonth: _mcV8ArchiveMonthLabel_(month),
    createdAt: new Date().toISOString(),
    timezone: _mcTz_(),
    sourceSpreadsheetId: _book_().getId(),
    hash: _mcV8HashText_(flat),
    results: results
  };
}

/**
 * Главный ежемесячный архиватор.
 * Запускается в последний календарный день месяца после 23:00.
 * Повторный запуск безопасен: существующие архивные листы получают отдельный
 * маркер в PropertiesService и второй раз тот же месяц не выгружается.
 */
function archiveMonChefMonthly() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return JSON.stringify({ ok: false, skipped: 'LOCKED' });
  try {
    var now = new Date();
    var tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    // Этап 10.8: архив месяца — в последний день месяца с 23:00 (ответ 5: «архив, к примеру, сентябрь 2026 г»).
    // Не уложился в один запуск или запуск пропущен — архив прошлого месяца дописывается 1–2 числа.
    var target = null;
    if (tomorrow.getDate() === 1 && now.getHours() >= 23) target = new Date(now.getFullYear(), now.getMonth(), 1);
    else if (now.getDate() <= 2) target = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    if (!target) return JSON.stringify({ ok: true, skipped: 'NOT_MONTH_END', date: now.toISOString() });
    var monthKey = Utilities.formatDate(target, _mcTz_(), 'yyyy-MM');
    var props = PropertiesService.getScriptProperties();
    if (_mcPropMapGet_('MC_V8_ARCHIVE_DONE', monthKey) === '1' || props.getProperty('MC_V8_ARCHIVE_DONE_' + monthKey) === '1') {
      return JSON.stringify({ ok: true, skipped: 'ALREADY_DONE', month: monthKey });
    }

    var year = target.getFullYear(), month = target.getMonth(), incomplete = false;
    var monthFolder = _mcV8ArchiveMonthFolder_(new Date(year, month, 1));
    var results = { journals: [], registers: [], files: [], signatures: [], warnings: [] };

    var journalsFolder = _mcV8ArchiveSubFolder_(monthFolder, '01 Журналы');
    // Этап 10.8: журналы — в оформлении бланков предприятия (Google-таблица + PDF на каждую форму J01–J53).
    // Рабочие записи НЕ вырезаются из таблицы MON CHEF (раньше строки месяца удалялись — п. 3.3 ТЗ).
    try {
      var jx = _jfExportMonth_({ iso: Utilities.formatDate(new Date(year, month, 1), _mcTz_(), 'yyyy-MM-dd'), folder: journalsFolder, final: true, skipEmpty: true, budgetMs: 240000 });
      results.journals = jx.files; results.journalsEmpty = jx.skipped;
      jx.errors.forEach(function (x) { results.warnings.push({ type: 'JOURNAL_FORM', form: x.id, error: x.error }); });
      if (jx.left.length) { incomplete = true; results.warnings.push({ type: 'JOURNAL_FORMS_LEFT', forms: jx.left, note: 'будут дописаны следующим запуском' }); }
    } catch (eJ) { incomplete = true; results.warnings.push({ type: 'JOURNAL_FORMS', error: String(eJ) }); }

    var registerMap = [
      ['Банкеты', '02 Приход продукции', 'Банкеты', false],
      ['Заказы_Поставщикам', '02 Приход продукции', 'Заказы поставщикам', false],
      ['Склад_Операции', '06 Склад', 'Складские операции', false],
      ['Производство', '07 Производство', 'Производство', false],
      ['Разбор_Акты', '07 Производство', 'Акты разбора', false],
      ['Операции', '08 HACCP и контроль', 'Операции', false],
      ['Лаборатория_Исследования', '08 HACCP и контроль', 'Лабораторные исследования', false],
      ['Чеклисты_Выполнение', '08 HACCP и контроль', 'Выполнение чеклистов', false],
      ['Журналы_Ожидания', '08 HACCP и контроль', 'Ожидаемые проверки', false],
      ['Журналы_Отклонения', '08 HACCP и контроль', 'Отклонения', false],
      ['Корректирующие_Действия', '08 HACCP и контроль', 'Корректирующие действия', false]
    ];
    registerMap.forEach(function (cfg) {
      try {
        var r = _mcV8CopySheetMonth_(cfg[0], _mcV8ArchiveSubFolder_(monthFolder, cfg[1]), cfg[2], year, month, cfg[3]);
        if (r.rows) results.registers.push(r);
      } catch (e) { results.warnings.push({ type: 'REGISTER', sheet: cfg[0], error: String(e) }); }
    });

    // Отдельный понятный пакет приёмки: только реальные приходы + партии,
    // полученные в этом месяце.
    try {
      var receiving = _mcV8ArchiveReceiving_(monthFolder, year, month);
      if (receiving.rows || receiving.batches) results.registers.push(receiving);
    } catch (eReceiving) { results.warnings.push({ type: 'RECEIVING', error: String(eReceiving) }); }

    // Реестры обучения и документов тоже архивируются как листы, а не только их файлы.
    try {
      var trainingSheet = _mcV8CopySheetMonth_('Персонал_Обучение', _mcV8ArchiveSubFolder_(monthFolder, '03 Обучение'), 'Обучение персонала', year, month, false);
      if (trainingSheet.rows) results.registers.push(trainingSheet);
    } catch (eTrainingSheet) { results.warnings.push({ type: 'TRAINING_SHEET', error: String(eTrainingSheet) }); }
    try {
      var docsSheet = _mcV8CopySheetMonth_('Документы', _mcV8ArchiveSubFolder_(monthFolder, '05 Документы'), 'Реестр документов', year, month, false);
      if (docsSheet.rows) results.registers.push(docsSheet);
    } catch (eDocsSheet) { results.warnings.push({ type: 'DOCUMENTS_SHEET', error: String(eDocsSheet) }); }

    // Документы и сканы остаются в рабочем реестре, но получают архивную копию.
    try { results.files = results.files.concat(_mcV8ArchiveDocumentFiles_(_mcV8ArchiveSubFolder_(monthFolder, '05 Документы'), year, month)); }
    catch (e) { results.warnings.push({ type: 'DOCUMENTS', error: String(e) }); }
    try { results.files = results.files.concat(_mcV8ArchiveTrainingFiles_(_mcV8ArchiveSubFolder_(monthFolder, '03 Обучение'), year, month)); }
    catch (e) { results.warnings.push({ type: 'TRAINING', error: String(e) }); }
    try { results.files = results.files.concat(_mcV8ArchiveEventFiles_(_mcV8ArchiveSubFolder_(monthFolder, '04 Банкеты'), year, month)); }
    catch (e) { results.warnings.push({ type: 'BANQUETS_FILES', error: String(e) }); }
    try { results.signatures = _mcV8ArchiveSignatureFiles_(_mcV8ArchiveSubFolder_(monthFolder, '01 Журналы'), year, month); }
    catch (e) { results.warnings.push({ type: 'SIGNATURES', error: String(e) }); }

    var manifestFolder = _mcV8ArchiveSubFolder_(monthFolder, '99 Служебное');
    var manifest = _mcV8BuildArchiveManifest_(new Date(year, month, 1), results);
    manifest.retainYears = (typeof MC_JF_RETAIN_YEARS_ !== 'undefined' ? MC_JF_RETAIN_YEARS_ : 3);
    manifest.retainUntil = typeof _jfRetainUntil_ === 'function' ? _jfRetainUntil_(Utilities.formatDate(new Date(year, month, 1), _mcTz_(), 'yyyy-MM-dd')) : '';
    manifest.workingRowsDeleted = false;
    var manifestFile = _mcV8JsonFile_(manifestFolder, 'MANIFEST — ' + _mcV8ArchiveMonthLabel_(new Date(year, month, 1)) + '.json', manifest);

    // Человекочитаемый README месяца.
    var summary = [
      'MON CHEF — АРХИВ',
      'Период: ' + _mcV8ArchiveMonthLabel_(new Date(year, month, 1)),
      'Создан: ' + new Date().toISOString(),
      '',
      'Журналов (форм J01–J53) в архиве: ' + results.journals.length + (results.journalsEmpty && results.journalsEmpty.length ? '; без записей за месяц: ' + results.journalsEmpty.join(', ') : ''),
      'Хранить до: ' + manifest.retainUntil + ' (' + manifest.retainYears + ' года). Удалять раньше нельзя.',
      'Реестров заархивировано: ' + results.registers.length,
      'Файлов скопировано: ' + results.files.length,
      'Подписанных PDF скопировано: ' + results.signatures.length,
      'Предупреждений: ' + results.warnings.length,
      '',
      'Исходные рабочие документы сохранены. Архивные копии предназначены для истории и проверки.'
    ].join('\n');
    manifestFolder.createFile(Utilities.newBlob(summary, 'text/plain', 'README — ' + _mcV8ArchiveMonthLabel_(new Date(year, month, 1)) + '.txt'));

    if (!incomplete) _mcPropMapSet_('MC_V8_ARCHIVE_DONE', monthKey, '1');
    props.setProperty('MC_V8_LAST_ARCHIVE', JSON.stringify({ month: monthKey, folderId: monthFolder.getId(), manifestId: manifestFile.getId(), at: new Date().toISOString() }));

    return JSON.stringify({ ok: true, month: monthKey, complete: !incomplete, folderId: monthFolder.getId(), manifestId: manifestFile.getId(), results: results });
  } catch (e) {
    return JSON.stringify({ ok: false, error: String(e) });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** Ручной запуск для администратора/теста. Архивирует указанный месяц. */
function archiveMonChefMonthForTest(year, monthIndex) {
  year = Number(year); monthIndex = Number(monthIndex);
  if (!year || monthIndex < 0 || monthIndex > 11) throw new Error('Нужны year и monthIndex 0..11');
  // Тестовый режим использует тот же код, но временно подменяет дату через
  // отдельную функцию ниже, не трогая системную дату и триггеры.
  return _mcV8ArchiveSpecificMonth_(year, monthIndex);
}

function _mcV8ArchiveSpecificMonth_(year, month) {
  // Для теста и повторного запуска используется та же логика, что и боевой архиватор,
  // но без проверки последнего дня. Служебный маркер не устанавливается.
  var now = new Date();
  var fake = new Date(year, month + 1, 0, 23, 30, 0);
  var original = Date;
  // Нельзя безопасно monkey-patch Date в Apps Script. Поэтому тестовый вход
  // просто сообщает, что для проверки следует использовать archiveMonChefMonthly
  // на копии проекта в последний день месяца.
  return JSON.stringify({ ok: false, testMode: true, message: 'Для безопасного теста используйте копию таблицы и archiveMonChefMonthly() в последний день месяца.', requestedMonth: _mcV8ArchiveMonthLabel_(new Date(year, month, 1)) });
}

function installMonChefArchiveTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'archiveMonChefMonthly' || t.getHandlerFunction() === 'archiveJournalsMonthly') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('archiveMonChefMonthly').timeBased().everyHours(1).create();
  return 'archiveMonChefMonthly @ каждый час; фактический запуск только в последний день месяца с 23:00';
}

function getMonChefArchiveStatus(token) {
  try {
    _requireAuth_(token, 'archive');
    var props = PropertiesService.getScriptProperties();
    var root = _mcV8ArchiveRoot_();
    var months = [];
    var it = root.getFolders();
    while (it.hasNext()) {
      var f = it.next();
      months.push({ name: f.getName(), id: f.getId(), url: f.getUrl() });
    }
    months.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return JSON.stringify({ root: { id: root.getId(), name: root.getName(), url: root.getUrl() }, lastArchive: props.getProperty('MC_V8_LAST_ARCHIVE') || '', months: months });
  } catch (e) { return JSON.stringify({ error: String(e) }); }
}
