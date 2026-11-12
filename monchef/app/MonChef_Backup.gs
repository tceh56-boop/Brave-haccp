/**
 * MON CHEF — резервное копирование с манифестом и учение по восстановлению.
 *
 * mcCreateBackup      — копия таблицы в папку «Бэкапы Mon Chef» + манифест:
 *                       по каждому листу число строк/столбцов и SHA-256 содержимого,
 *                       общий хеш манифеста, время, оператор.
 * mcRestoreDrill      — учение: копия открывается как отдельная таблица, хеши
 *                       каждого листа пересчитываются и сверяются с манифестом.
 *                       Рабочие данные не трогаются. Итог RESTORE_DRILL_OK / _FAIL.
 * mcRestoreSheet      — восстановление одного листа из копии (только администратор,
 *                       подтверждение словом «ВОССТАНОВИТЬ»; перед этим автоматически
 *                       делается страховочная копия).
 * Журнал: лист «Резерв_Восстановление».
 */
var MC_BK_SHEET_ = 'Резерв_Восстановление';
var MC_BK_HEAD_ = ['ID', 'Время', 'Оператор', 'Тип', 'Файл копии', 'Хеш манифеста', 'Листов', 'Строк', 'Результат', 'Манифест/детали (JSON)'];

function _bkHex_(bytes) { return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join(''); }
function _bkHash_(text) { return _bkHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8)); }
function _bkSheetInfo_(sh) {
  var r = sh.getLastRow(), c = sh.getLastColumn(), vals = r && c ? sh.getRange(1, 1, r, c).getValues() : [];
  var norm = JSON.stringify(vals.map(function (row) { return row.map(function (x) { return x instanceof Date ? x.toISOString() : x; }); }));
  return { name: sh.getName(), rows: r, cols: c, hash: _bkHash_(norm) };
}
function _bkManifest_(book) {
  var sheets = book.getSheets().filter(function (s) { return s.getName() !== MC_BK_SHEET_; }).map(_bkSheetInfo_);
  sheets.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  return { sheets: sheets, hash: _bkHash_(JSON.stringify(sheets)) };
}
function _bkAdmin_(token, perm) {
  var s = _requireAuth_(token, perm || 'archive');
  if (!_mcRbHasExact_(s, 'archive|system')) throw new Error('FORBIDDEN: резервное копирование — директорратор или руководитель');
  return s;
}
function _bkFind_(id) {
  var sh = _bcSheet_(MC_BK_SHEET_, MC_BK_HEAD_), v = sh.getDataRange().getValues();
  for (var i = v.length - 1; i >= 1; i--) if (String(v[i][0]) === String(id)) return v[i];
  return null;
}

function mcCreateBackup(token) {
  try {
    var s = _bkAdmin_(token);
    return _withLock_(function () {
      var book = _book_(), man = _bkManifest_(book), stamp = Utilities.formatDate(new Date(), _mcTz_(), 'yyyy-MM-dd HH-mm');
      var folder = null;
      try { var it = DriveApp.getFoldersByName('Бэкапы Mon Chef'); folder = it.hasNext() ? it.next() : DriveApp.createFolder('Бэкапы Mon Chef'); } catch (e) {}
      var src = DriveApp.getFileById(book.getId ? book.getId() : SHEET_ID);
      var copy = folder ? src.makeCopy('BACKUP Mon Chef ' + stamp, folder) : src.makeCopy('BACKUP Mon Chef ' + stamp);
      var id = 'BK-' + Date.now(), rows = man.sheets.reduce(function (a, x) { return a + x.rows; }, 0);
      _bcSheet_(MC_BK_SHEET_, MC_BK_HEAD_).appendRow([id, new Date(), s.name || '', 'BACKUP', copy.getId(), man.hash, man.sheets.length, rows, 'CREATED', JSON.stringify(man.sheets).slice(0, 48000)]);
      try { _audit_({ id: '', session: s }, 'BACKUP_CREATE', 'Резерв', id, null, { file: copy.getId(), hash: man.hash, sheets: man.sheets.length }); } catch (e) {}
      return _ok_({ backupId: id, fileId: copy.getId(), url: copy.getUrl(), manifestHash: man.hash, sheets: man.sheets.length, rows: rows });
    });
  } catch (e) { return _failFrom_(e); }
}

function mcRestoreDrill(backupId, token) {
  try {
    var s = _bkAdmin_(token), b = _bkFind_(backupId);
    if (!b || String(b[3]) !== 'BACKUP') return _fail_('NOT_FOUND', 'Резервная копия не найдена');
    var expected = JSON.parse(b[9] || '[]'), problems = [];
    var copy = SpreadsheetApp.openById(String(b[4])), got = {};
    copy.getSheets().forEach(function (sh) { if (sh.getName() !== MC_BK_SHEET_) { var x = _bkSheetInfo_(sh); got[x.name] = x; } });
    expected.forEach(function (e) {
      var g = got[e.name];
      if (!g) problems.push('нет листа «' + e.name + '»');
      else if (g.hash !== e.hash) problems.push('лист «' + e.name + '»: содержимое не совпадает (' + g.rows + '×' + g.cols + ' вместо ' + e.rows + '×' + e.cols + ')');
    });
    var ok = !problems.length && expected.length > 0;
    var id = 'RD-' + Date.now();
    _bcSheet_(MC_BK_SHEET_, MC_BK_HEAD_).appendRow([id, new Date(), s.name || '', ok ? 'RESTORE_DRILL_OK' : 'RESTORE_DRILL_FAIL', String(b[4]), b[5], expected.length, '',
      ok ? 'копия читается, все ' + expected.length + ' листов совпадают с манифестом' : problems.length + ' расхождений', JSON.stringify({ backupId: backupId, problems: problems.slice(0, 50) })]);
    try { _audit_({ id: '', session: s }, 'RESTORE_DRILL', 'Резерв', backupId, null, { ok: ok, problems: problems.length }); } catch (e) {}
    return _ok_({ drillId: id, backupId: backupId, ok: ok, sheetsChecked: expected.length, problems: problems });
  } catch (e) { return _failFrom_(e); }
}

function mcRestoreSheet(backupId, sheetName, confirmWord, token) {
  try {
    var s = _bkAdmin_(token, 'archive');
    if (!s.dev) return _fail_('FORBIDDEN', 'Восстановление листа — только технический доступ');
    if (String(confirmWord) !== 'ВОССТАНОВИТЬ') return _fail_('VALIDATION', 'Для восстановления введите слово ВОССТАНОВИТЬ');
    var b = _bkFind_(backupId); if (!b || String(b[3]) !== 'BACKUP') return _fail_('NOT_FOUND', 'Резервная копия не найдена');
    if (sheetName === MC_BK_SHEET_ || sheetName === 'Audit_Log') return _fail_('FORBIDDEN', 'Журнал аудита и журнал резервирования не восстанавливаются поверх');
    var safety = JSON.parse(mcCreateBackup(token));
    if (!safety.success && !safety.ok) return _fail_('BACKUP_FAILED', 'Страховочная копия не создана — восстановление отменено');
    return _withLock_(function () {
      var src = SpreadsheetApp.openById(String(b[4])).getSheetByName(sheetName);
      if (!src) return _fail_('NOT_FOUND', 'В копии нет листа «' + sheetName + '»');
      var vals = src.getLastRow() ? src.getRange(1, 1, src.getLastRow(), src.getLastColumn()).getValues() : [];
      var dst = _book_().getSheetByName(sheetName) || _book_().insertSheet(sheetName);
      dst.clearContents();
      if (vals.length) dst.getRange(1, 1, vals.length, vals[0].length).setValues(vals);
      var id = 'RS-' + Date.now();
      _bcSheet_(MC_BK_SHEET_, MC_BK_HEAD_).appendRow([id, new Date(), s.name || '', 'RESTORE_SHEET', String(b[4]), _bkSheetInfo_(dst).hash, 1, vals.length, 'восстановлен лист «' + sheetName + '»', JSON.stringify({ backupId: backupId, safetyBackup: safety.data && safety.data.backupId })]);
      try { _audit_({ id: '', session: s }, 'RESTORE_SHEET', 'Резерв', sheetName, null, { backupId: backupId, rows: vals.length }); } catch (e) {}
      return _ok_({ restoreId: id, sheet: sheetName, rows: vals.length, safetyBackup: safety.data && safety.data.backupId });
    });
  } catch (e) { return _failFrom_(e); }
}

function mcGetBackups(token) {
  try { _bkAdmin_(token); var v = _bcSheet_(MC_BK_SHEET_, MC_BK_HEAD_).getDataRange().getValues().slice(1).reverse().slice(0, 50);
    return _ok_(v.map(function (r) { return { id: r[0], at: _bcDate_(r[1]), who: r[2], type: r[3], file: r[4], hash: String(r[5]).slice(0, 16), sheets: r[6], rows: r[7], result: r[8] }; })); }
  catch (e) { return _failFrom_(e); }
}
