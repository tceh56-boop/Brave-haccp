/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
/**
 * ЦЕХ Стандарт — ежемесячный архив журналов событий 2.x и их вырезание из рабочей таблицы.
 *
 * Рабочая таблица не начинается заново каждый месяц: в ней живут справочники, ТТК, склад и партии,
 * которые переходят из месяца в месяц, а веб-приложение привязано к одной таблице. Растут журналы событий —
 * их и выносим:
 *   1. архив месяца (вместе с ежемесячным архивом ЦЕХ Стандарт, archiveMonChefMonthly): одна таблица
 *      «ЦЕХ Стандарт — журналы событий — <Месяц ГГГГ г>» в папке месяца, вкладка на журнал, манифест с числом строк,
 *      SHA-256 и граничными хешами цепочек;
 *   2. вырезание через месяц: строки месяца M удаляются из рабочих листов при архивации месяца M+1 —
 *      только после сверки с архивом (число строк и SHA-256) и резервной копии; в рабочей таблице остаются
 *      текущий и прошлый месяц;
 *   3. не вырезаются: открытые задачи, неустранённые отклонения, записи «ждёт подтверждения».
 * Цепочка аудита: при вырезании запоминается якорь (prevHash первой оставшейся записи) — проверка начинается с него,
 * а продолжение цепочки до якоря подтверждается архивом месяца.
 */
var TS2_ARCH_SHEETS_ = [
  ['AUTO_RECORDS', 'createdAt', 'Автозаписи журналов', function (r) { return !(r.recordType === 'DEVIATION' && r.status === 'OPEN') && r.result !== 'PENDING_CONFIRMATION'; }],
  ['JOURNAL_EXPECTATIONS', 'dueAt', 'Задачи журналов', function (r) { return r.status !== 'OPEN'; }],
  ['MANUAL_MEASUREMENTS', 'recordedAt', 'Замеры', function () { return true; }],
  ['AUDIT_CHAIN', 'createdAt', 'Журнал аудита', function () { return true; }]
];
var TS2_ARCH_PROP_ = 'TS2_ARCHIVE_MONTHS';

function _ts2MonthKey_(y, m) { return y + '-' + ('0' + (m + 1)).slice(-2); }
function _ts2InMonthIso_(v, key) { return String(v instanceof Date ? _ts2Iso_(v) : v || '').slice(0, 7) === key; }
function _ts2ArchState_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(TS2_ARCH_PROP_) || '{}'); } catch (e) { return {}; } }
function _ts2ArchSave_(st) { PropertiesService.getScriptProperties().setProperty(TS2_ARCH_PROP_, JSON.stringify(st)); }
function _ts2RowsHash_(head, rows) { return _ts2Sha_(JSON.stringify([head].concat(rows.map(function (r) { return r.map(function (v) { return v instanceof Date ? _ts2Iso_(v) : String(v === null || v === undefined ? '' : v); }); })))); }

/** Архив месяца: таблица с вкладкой на каждый журнал. Повторный запуск не создаёт второй файл. */
function _ts2ArchiveMonth_(y, m, folder) {
  var key = _ts2MonthKey_(y, m), st = _ts2ArchState_();
  if (typeof _tsTenantMode_ === 'function' && _tsTenantMode_()) folder = _ts2Folder_('ARCHIVE');
  if (st[key] && st[key].fileId) {
    if (typeof _tsTenantMode_ === 'function' && _tsTenantMode_()) _tsTenantAssertFileWithin_(st[key].fileId, 'ARCHIVE');
    return st[key];
  }
  var label = typeof _mcV8ArchiveMonthLabel_ === 'function' ? _mcV8ArchiveMonthLabel_(new Date(y, m, 1)) : key;
  var ss = SpreadsheetApp.create('ЦЕХ Стандарт — журналы событий — ' + label), first = true, info = { month: key, label: label, sheets: {}, createdAt: _ts2Iso_() };
  TS2_ARCH_SHEETS_.forEach(function (d) {
    var sh = _book_().getSheetByName(d[0]); if (!sh || sh.getLastRow() < 2) return;
    var v = sh.getRange(1, 1, sh.getLastRow(), Math.max(1, sh.getLastColumn())).getValues(), head = v[0], c = head.indexOf(d[1]);
    var rows = v.slice(1).filter(function (r) { return r[0] !== '' && c >= 0 && _ts2InMonthIso_(r[c], key); });
    var tab = first ? ss.getSheets()[0] : ss.insertSheet(d[2]); if (first) tab.setName(d[2]); first = false;
    tab.getRange(1, 1, 1, head.length).setValues([head]);
    if (rows.length) tab.getRange(2, 1, rows.length, head.length).setValues(rows);
    var hc = head.indexOf('hash'), pc = head.indexOf('prevHash');
    info.sheets[d[0]] = { tab: d[2], rows: rows.length, sha256: _ts2RowsHash_(head, rows), firstId: rows.length ? String(rows[0][0]) : '', lastId: rows.length ? String(rows[rows.length - 1][0]) : '',
      firstPrevHash: rows.length && pc >= 0 ? String(rows[0][pc]) : '', lastHash: rows.length && hc >= 0 ? String(rows[rows.length - 1][hc]) : '' };
  });
  var file = DriveApp.getFileById(ss.getId());
  if (folder) {
    try { file.moveTo(folder); } catch (moveError) { try { file.setTrashed(true); } catch (trashError) {} throw new Error('ARCHIVE_MOVE_FAILED: не удалось переместить архив в папку предприятия: ' + String(moveError.message || moveError)); }
  }
  if (typeof _tsTenantMode_ === 'function' && _tsTenantMode_()) _tsTenantAssertFileWithin_(ss.getId(), 'ARCHIVE');
  info.fileId = ss.getId(); info.url = 'https://docs.google.com/spreadsheets/d/' + ss.getId();
  if (folder) { try { folder.createFile(Utilities.newBlob(JSON.stringify(info, null, 1), 'application/json', 'MANIFEST журналы событий — ' + label + '.json')); } catch (e) {} }
  _ts2Insert_('BACKUP_CATALOG', { backupId: _ts2Id_('BACKUP_CATALOG'), enterpriseId: _ts2Ent_(), backupType: 'MONTH_ARCHIVE', scope: 'журналы событий ' + label, fileId: info.fileId, fileUrl: info.url,
    createdAt: _ts2Iso_(), createdBy: _ts2Actor_().name, sizeBytes: '', sha256: _ts2Sha_(JSON.stringify(info.sheets)), schemaVersion: TS2_SCHEMA_VERSION, status: 'OK', restoreTestedAt: '', restoreResult: '' });
  st[key] = info; _ts2ArchSave_(st);
  _ts2Audit_('MONTH_ARCHIVE', 'ARCHIVE', key, undefined, { fileId: info.fileId, sheets: info.sheets }, label);
  return info;
}

/** Вырезать месяц из рабочих листов: сверка с архивом → резервная копия → удаление закрытых строк месяца. */
function _ts2RotateMonth_(y, m) {
  var key = _ts2MonthKey_(y, m), st = _ts2ArchState_(), info = st[key];
  if (!info || !info.fileId) throw new Error('VALIDATION: архива за ' + key + ' нет — вырезать нельзя');
  if (info.rotatedAt) return { month: key, skipped: 'уже вырезано ' + info.rotatedAt };
  // 1. сверка: архивный файл читается заново и сравнивается с манифестом
  if (typeof _tsTenantMode_ === 'function' && _tsTenantMode_()) _tsTenantAssertFileWithin_(info.fileId, 'ARCHIVE');
  var arc = SpreadsheetApp.openById(info.fileId), bad = [];
  Object.keys(info.sheets).forEach(function (name) {
    var s = info.sheets[name], tab = arc.getSheetByName(s.tab); if (!tab) { bad.push(name + ': нет вкладки'); return; }
    var v = tab.getRange(1, 1, Math.max(1, tab.getLastRow()), Math.max(1, tab.getLastColumn())).getValues(), rows = v.slice(1).filter(function (r) { return r[0] !== ''; });
    if (rows.length !== s.rows || _ts2RowsHash_(v[0], rows) !== s.sha256) bad.push(name + ': архив не совпадает с манифестом');
  });
  if (bad.length) { _ts2Audit_('MONTH_ROTATE', 'ARCHIVE', key, undefined, { problems: bad }, 'вырезание отменено', 'FAILED'); throw new Error('VALIDATION: ' + bad.join('; ')); }
  var backupId = _ts2Backup_('PRE_ROTATION', 'вырезание ' + key);
  var removed = {};
  _withLock_(function () {
    TS2_ARCH_SHEETS_.forEach(function (d) {
      var s = info.sheets[d[0]], sh = _book_().getSheetByName(d[0]); if (!s || !sh || sh.getLastRow() < 2) return;
      var w = sh.getLastColumn(), v = sh.getRange(1, 1, sh.getLastRow(), w).getValues(), head = v[0], c = head.indexOf(d[1]), keep = [], n = 0;
      var archived = {}; // вырезаем только то, что попало в архив (по ID первой колонки)
      var tab = arc.getSheetByName(s.tab); tab.getRange(2, 1, Math.max(1, tab.getLastRow() - 1), 1).getValues().forEach(function (r) { if (r[0] !== '') archived[String(r[0])] = true; });
      v.slice(1).forEach(function (r) {
        var o = {}; head.forEach(function (h, j) { o[h] = r[j] instanceof Date ? _ts2Iso_(r[j]) : r[j]; });
        if (r[0] !== '' && _ts2InMonthIso_(r[c], key) && archived[String(r[0])] && d[3](o)) n++; else keep.push(r);
      });
      if (!n) { removed[d[0]] = 0; return; }
      if (d[0] === 'AUDIT_CHAIN' && keep.length) PropertiesService.getScriptProperties().setProperty('TS2_AUDIT_ANCHOR', String(keep[0][head.indexOf('prevHash')] || ''));
      if (d[0] === 'AUDIT_CHAIN' && !keep.length) PropertiesService.getScriptProperties().setProperty('TS2_AUDIT_ANCHOR', PropertiesService.getScriptProperties().getProperty('TS2_AUDIT_LAST_HASH') || '');
      sh.getRange(2, 1, v.length - 1, w).clearContent();
      if (keep.length) sh.getRange(2, 1, keep.length, w).setValues(keep);
      if (sh.getMaxRows && sh.deleteRows && sh.getMaxRows() > keep.length + 50) { try { sh.deleteRows(keep.length + 2, sh.getMaxRows() - keep.length - 51); } catch (e) {} }
      removed[d[0]] = n;
    });
    try { _TS2_SH_ = {}; } catch (e) {}
  });
  info.rotatedAt = _ts2Iso_(); info.removed = removed; info.backupId = backupId; st[key] = info; _ts2ArchSave_(st);
  _ts2Audit_('MONTH_ROTATE', 'ARCHIVE', key, undefined, { removed: removed, archive: info.fileId, backupId: backupId }, 'журналы месяца вынесены в архив');
  return { month: key, removed: removed, archive: info.url, backupId: backupId };
}

/** Шаг ежемесячного архива: архив месяца M и вырезание месяца M−1 (в рабочей таблице остаются 2 месяца). */
function _ts2MonthlyStep_(y, m, folder) {
  var out = { archive: null, rotate: null };
  try { out.archive = _ts2ArchiveMonth_(y, m, folder); } catch (e) { out.archiveError = String(e.message || e); }
  try { var p = new Date(y, m - 1, 1), pk = _ts2MonthKey_(p.getFullYear(), p.getMonth()); if (_ts2ArchState_()[pk]) out.rotate = _ts2RotateMonth_(p.getFullYear(), p.getMonth()); }
  catch (e) { out.rotateError = String(e.message || e); }
  return out;
}
function ts2Archives(token) {
  try { _requireAuth_(token); var st = _ts2ArchState_(); return _ok_(Object.keys(st).sort().reverse().map(function (k) { var i = st[k]; return { month: k, label: i.label, url: i.url, rows: i.sheets, rotatedAt: i.rotatedAt || '', removed: i.removed || {} }; })); }
  catch (e) { return _failFrom_(e); }
}
