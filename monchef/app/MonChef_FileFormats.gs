/**
 * MON CHEF — чтение файлов разных форматов (карты ТТК в папке ttk).
 *
 * Раньше синхронизация разбирала только .xls FastReport (XML). Теперь читаются:
 *   Google Таблицы; .xlsx, .xlsm, .ods, двоичный .xls — через конвертацию Диском в Таблицу;
 *   .csv; Google Документы, .docx, .odt, .rtf — через конвертацию в Документ (таблицы и абзацы);
 *   .pdf — конвертация Диском в Документ с распознаванием текста (OCR); .txt.
 * Всё сводится к таблице строк и разбирается тем же разборщиком карточки, что и FastReport
 * (_parseCardRows_): колонки по заголовкам «брутто / нетто / вес готового / на 1 порцию».
 * Временные копии создаются в служебной папке и сразу удаляются в корзину.
 * Результат разбора кэшируется по ID файла и дате изменения (лист «ТТК_Разбор_Форматов»):
 * неизменённый файл повторно не конвертируется. За один прогон — не больше MC_TTK_CONVERT_LIMIT_
 * новых конвертаций (лимит времени Apps Script 6 минут); остальные — в следующий прогон.
 */
var MC_TTK_CONVERT_LIMIT_ = 25;
var MC_TTK_FMT_SHEET_ = 'ТТК_Разбор_Форматов', MC_TTK_FMT_HEAD_ = ['FileID', 'Файл', 'Изменён', 'Формат', 'Результат', 'Карточка (JSON)', 'Разобран'];
var MC_MIME_ = {
  GSHEET: 'application/vnd.google-apps.spreadsheet', GDOC: 'application/vnd.google-apps.document',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', XLSM: 'application/vnd.ms-excel.sheet.macroenabled.12',
  XLS: 'application/vnd.ms-excel', ODS: 'application/vnd.oasis.opendocument.spreadsheet', CSV: 'text/csv',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ODT: 'application/vnd.oasis.opendocument.text',
  RTF: 'application/rtf', PDF: 'application/pdf', TXT: 'text/plain'
};

/** Вид файла для разбора: sheet (Таблица), toSheet, csv, doc (Документ), toDoc, pdf, txt — или '' (не читаем). */
function _mcFileKind_(file) {
  var mt = String(file.getMimeType() || ''), n = String(file.getName() || '').toLowerCase();
  if (mt === MC_MIME_.GSHEET) return 'sheet';
  if (mt === MC_MIME_.GDOC) return 'doc';
  if (mt === MC_MIME_.XLSX || mt === MC_MIME_.XLSM || mt === MC_MIME_.ODS || /\.(xlsx|xlsm|ods)$/.test(n)) return 'toSheet';
  if (mt === MC_MIME_.CSV || /\.csv$/.test(n)) return 'csv';
  if (mt === MC_MIME_.DOCX || mt === MC_MIME_.ODT || mt === MC_MIME_.RTF || /\.(docx|odt|rtf|doc)$/.test(n)) return 'toDoc';
  if (mt === MC_MIME_.PDF || /\.pdf$/.test(n)) return 'pdf';
  if (mt === MC_MIME_.TXT || /\.txt$/.test(n)) return 'txt';
  return '';
}
var MC_FMT_RU_ = { sheet: 'Google Таблица', toSheet: 'Excel/ODS', csv: 'CSV', doc: 'Google Документ', toDoc: 'Word/ODT/RTF', pdf: 'PDF', txt: 'текст', xls: '.xls (двоичный)' };

function _mcTmpFolder_() {
  var p = PropertiesService.getScriptProperties(), id = p.getProperty('MC_TMP_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var f = _docsFolder_().createFolder('Служебное — временные копии для разбора'); p.setProperty('MC_TMP_FOLDER_ID', f.getId()); return f;
}
function _mcDriveFetch_(method, url, payload) {
  var o = { method: method, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
  if (payload) { o.contentType = 'application/json'; o.payload = JSON.stringify(payload); }
  var r = UrlFetchApp.fetch(url, o);
  if (r.getResponseCode() >= 300) throw new Error('Google Диск ответил ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
  return r;
}
/** Копия файла с конвертацией в формат Google (Таблица/Документ). PDF → Документ распознаётся Диском (OCR). */
function _mcDriveConvert_(fileId, targetMime) {
  var r = _mcDriveFetch_('post', 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '/copy?fields=id&ocrLanguage=ru&supportsAllDrives=true',
    { mimeType: targetMime, name: 'mc-разбор-' + Date.now(), parents: [_mcTmpFolder_().getId()] });
  return JSON.parse(r.getContentText()).id;
}
function _mcTrash_(id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {} }

function _mcHtmlText_(s) {
  return String(s || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
/** HTML документа → строки: строка таблицы → ячейки; абзац вне таблицы → одна ячейка. */
function _mcHtmlToGrid_(html) {
  var body = String(html || ''), m = body.match(/<body[\s\S]*<\/body>/i); if (m) body = m[0];
  var tokens = body.match(/<tr[\s\S]*?<\/tr>|<p[\s\S]*?<\/p>|<h\d[\s\S]*?<\/h\d>|<li[\s\S]*?<\/li>/gi) || [], grid = [];
  tokens.forEach(function (t) {
    if (/^<tr/i.test(t)) grid.push((t.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map(_mcHtmlText_));
    else { var x = _mcHtmlText_(t); if (x) grid.push([x]); }
  });
  return grid;
}
/** Строки простого текста → ячейки по табуляции или двум и более пробелам (так текст раскладывает PDF). */
function _mcTextToGrid_(text) {
  return String(text || '').split(/\r?\n/).map(function (l) { return l.replace(/ /g, ' ').trim(); }).filter(Boolean)
    .map(function (l) { return l.split(/\t| {2,}/).map(function (x) { return x.trim(); }); });
}
function _mcExportGoogle_(id, mime) {
  return _mcDriveFetch_('get', 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '/export?mimeType=' + encodeURIComponent(mime)).getContentText();
}
/** Файл → таблица строк (массив массивов строк). */
function _mcGridFromFile_(file, kind) {
  var id = file.getId(), tmp = '';
  try {
    if (kind === 'sheet') return SpreadsheetApp.openById(id).getSheets()[0].getDataRange().getDisplayValues();
    if (kind === 'toSheet' || kind === 'xls') { tmp = _mcDriveConvert_(id, MC_MIME_.GSHEET); return SpreadsheetApp.openById(tmp).getSheets()[0].getDataRange().getDisplayValues(); }
    if (kind === 'csv') { var t = file.getBlob().getDataAsString('UTF-8'), d = (t.split(';').length > t.split(',').length) ? ';' : ','; return Utilities.parseCsv(t, d); }
    if (kind === 'txt') return _mcTextToGrid_(file.getBlob().getDataAsString('UTF-8'));
    if (kind === 'doc') return _mcHtmlToGrid_(_mcExportGoogle_(id, 'text/html'));
    if (kind === 'toDoc' || kind === 'pdf') {
      tmp = _mcDriveConvert_(id, MC_MIME_.GDOC);
      var html = _mcExportGoogle_(tmp, 'text/html'), g = _mcHtmlToGrid_(html);
      // PDF без таблиц: распознанный текст идёт абзацами — делим строки по большим пробелам
      if (kind === 'pdf' && !/<tr/i.test(html)) g = _mcTextToGrid_(_mcExportGoogle_(tmp, 'text/plain'));
      return g;
    }
    return [];
  } finally { if (tmp) _mcTrash_(tmp); }
}
var MC_CARD_LABELS_ = /^(Наименование блюда|Наименование изделия|Выход[^:]{0,40}|Технология приготовления)\s*[:\-–]\s*(.+)$/i;
/** Таблица строк → ячейки {col: {text, num}} для _parseCardRows_. «Метка: значение» в одной ячейке делится на две. */
function _mcGridToRowCells_(grid) {
  return (grid || []).map(function (row) {
    var cells = {}, col = 0;
    (row || []).forEach(function (v) {
      col++;
      var t = String(v === null || v === undefined ? '' : v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
      if (!t) return;
      var lm = MC_CARD_LABELS_.exec(t);
      if (lm) { cells[col] = { text: lm[1], num: false }; col++; cells[col] = { text: lm[2].trim(), num: false }; return; }
      var nt = t.replace(/\s/g, '').replace(',', '.');
      var isNum = /^-?\d+(\.\d+)?$/.test(nt);
      cells[col] = { text: isNum ? nt : t, num: isNum };
    });
    return cells;
  });
}
function _mcTtkFmtSheet_() { return _bcSheet_(MC_TTK_FMT_SHEET_, MC_TTK_FMT_HEAD_); }
/** Карточка из файла любого поддерживаемого формата (с кэшем). Возвращает {card} | {error} | {deferred}. */
function _mcCardFromFile_(file, kind, budget) {
  var id = file.getId(), upd = 0; try { upd = file.getLastUpdated().getTime(); } catch (e) {}
  var sh = _mcTtkFmtSheet_(), v = sh.getDataRange().getValues(), row = -1;
  for (var i = 1; i < v.length; i++) if (String(v[i][0]) === id) { row = i + 1; if (Number(v[i][2]) === upd) { if (v[i][4] === 'OK') return { card: JSON.parse(v[i][5]) }; return { error: String(v[i][4]) }; } break; }
  if (budget && budget.left <= 0) return { deferred: true };
  if (budget) budget.left--;
  var res, card = null;
  try {
    card = _parseCardRows_(_mcGridToRowCells_(_mcGridFromFile_(file, kind)));
    res = card.ingredients.length ? 'OK' : 'нет таблицы состава (строки «№ · продукт · ед. · брутто/нетто»)';
  } catch (e) { res = 'ошибка: ' + String(e && e.message || e).slice(0, 200); card = null; }
  var out = [id, file.getName(), upd, MC_FMT_RU_[kind] || kind, res, res === 'OK' ? JSON.stringify(card) : '', new Date()];
  if (row > 0) sh.getRange(row, 1, 1, out.length).setValues([out]); else sh.appendRow(out);
  return res === 'OK' ? { card: card } : { error: res };
}
