// ЦЕХ — TtkDriveCore.gs
// Карты ТТК из папки Google Диска: обход папки с подпапками, разбор файлов, обнаружение
// новых, изменённых и удалённых карт. Перенос из МонШеф (Code.gs _walkTTK_, MonChef_FileFormats.gs,
// MonChef_TtkHistory.gs) с изменённым правилом: МонШеф вводил изменённую карту в действие сам,
// здесь всё идёт через проверку технологом в импорте ТТК (TtkImportCore.gs):
//   новая карта       → строка импорта (как из архива);
//   изменённая карта  → строка импорта «изменена» с разницей «было → стало»; подтверждение
//                       приводит рецептуру к карте и создаёт новую версию ТТК/техкарты ПФ —
//                       черновиком, утверждает технолог;
//   удалённый файл    → отметка в реестре файлов; блюдо, рецептура и ТТК не трогаются.
// Защита (как в МонШеф): если в папке нашлось меньше половины прежних карт, удалённые не
// отмечаются — вероятнее, папка недоступна или переименована.
//
// Форматы: XML-таблица FastReport (.xls архива) читается напрямую; Google Таблица — как есть;
// .xlsx/.xls (двоичный)/.ods — конвертация Диском в Таблицу; Word/ODT/RTF/PDF — в Документ
// (PDF — с распознаванием текста Диском); .csv и .txt — как текст. Временные копии — в служебной
// папке, сразу в корзину. Неизменённый файл (та же дата изменения) повторно не читается.
// Лимит Apps Script — 6 минут: за прогон — не больше TTK_DRIVE_CONVERT_LIMIT конвертаций и
// TTK_DRIVE_TIME_BUDGET_MS времени; остальное — следующим прогоном (ручным или ежедневным).

var TTK_DRIVE_TIME_BUDGET_MS = 270000;
var TTK_DRIVE_CONVERT_LIMIT = 20;
var TTK_DRIVE_GUARD_MIN = 20;
var TTK_DRIVE_MIME = {
  GSHEET: 'application/vnd.google-apps.spreadsheet', GDOC: 'application/vnd.google-apps.document', GFOLDER: 'application/vnd.google-apps.folder',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', XLSM: 'application/vnd.ms-excel.sheet.macroenabled.12',
  XLS: 'application/vnd.ms-excel', ODS: 'application/vnd.oasis.opendocument.spreadsheet', CSV: 'text/csv',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ODT: 'application/vnd.oasis.opendocument.text',
  RTF: 'application/rtf', PDF: 'application/pdf', TXT: 'text/plain'
};
var TTK_DRIVE_KIND_RU = { xls: 'Excel (.xls)', sheet: 'Google Таблица', toSheet: 'Excel/ODS', csv: 'CSV', doc: 'Google Документ', toDoc: 'Word/ODT/RTF', pdf: 'PDF', txt: 'текст' };

/** Вид файла: xls (XML FastReport или двоичный), sheet, toSheet, csv, doc, toDoc, pdf, txt — или '' (не карта). */
function ttkDriveFileKind_(mime, name) {
  var mt = String(mime || ''), n = String(name || '').toLowerCase();
  if (/^~\$/.test(n) || /^реестр ттк/.test(n)) return '';
  if (mt === TTK_DRIVE_MIME.GSHEET) return 'sheet';
  if (mt === TTK_DRIVE_MIME.GDOC) return 'doc';
  if (/\.xls$/.test(n) || mt === TTK_DRIVE_MIME.XLS) return 'xls';
  if (mt === TTK_DRIVE_MIME.XLSX || mt === TTK_DRIVE_MIME.XLSM || mt === TTK_DRIVE_MIME.ODS || /\.(xlsx|xlsm|ods)$/.test(n)) return 'toSheet';
  if (mt === TTK_DRIVE_MIME.CSV || /\.csv$/.test(n)) return 'csv';
  if (mt === TTK_DRIVE_MIME.DOCX || mt === TTK_DRIVE_MIME.ODT || mt === TTK_DRIVE_MIME.RTF || /\.(docx|odt|rtf|doc)$/.test(n)) return 'toDoc';
  if (mt === TTK_DRIVE_MIME.PDF || /\.pdf$/.test(n)) return 'pdf';
  if (mt === TTK_DRIVE_MIME.TXT || /\.txt$/.test(n)) return 'txt';
  return '';
}

/** Ключ пути без расширения: связывает файл Диска с картой, импортированной раньше из архива (.xlsx). */
function _tdPathKey_(p) { return String(p || '').replace(/\.[a-z0-9]{2,4}$/i, '').toLowerCase(); }

function _tdHash_(s) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(s), Utilities.Charset.UTF_8);
  return b.map(function (x) { var h = (x < 0 ? x + 256 : x).toString(16); return h.length === 1 ? '0' + h : h; }).join('');
}

/** Отпечаток содержания карты: строки, технология, выход из карты (числом: «200» и «200.0» — одно).
 *  Название не входит — его правит технолог. */
function ttkCardDriveFingerprint_(card) {
  return _tdHash_(JSON.stringify({
    l: (card.lines || []).map(function (l) { return [_tiNorm_(l.name), l.unit, l.brutto, l.netto]; }),
    t: String(card.technology || '').replace(/\s+/g, ' ').trim(), y: _tcParseYield_(card.yield_raw)
  }));
}

// ---------- источник: папка организации ----------

function _tdSource_(organizationId) {
  return findRows_('TTK_DRIVE_SOURCES', function (s) { return s.organization_id === organizationId && s.active !== false && s.active !== 'FALSE'; })[0] || null;
}

/** Ссылка или ID папки → ID. */
function _tdFolderId_(v) {
  var s = String(v || '').trim(), m = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(s) || /[?&]id=([A-Za-z0-9_-]{10,})/.exec(s);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{10,}$/.test(s)) return s;
  throw new Error('Укажите ссылку на папку Google Диска или её ID.');
}

function setTtkDriveSource_(data, session) {
  return withLock_(function () {
    var id = _tdFolderId_(data.folder), folder;
    try { folder = DriveApp.getFolderById(id); folder.getName(); } catch (e) { throw new Error('Папка недоступна: проверьте ссылку и доступ владельца скрипта к папке.'); }
    var cur = _tdSource_(session.organization_id);
    if (cur && cur.folder_id === id) return _tdSourceView_(cur);
    if (cur) updateRow_('TTK_DRIVE_SOURCES', cur, { active: false });
    var row = { source_id: generateId_('TTK_DRIVE_SOURCES'), organization_id: session.organization_id, folder_id: id, folder_name: folder.getName(), active: true,
      last_sync_at: '', last_status: '', last_result_json: '', created_by: session.user_id, created_at: nowIso_() };
    insertRow_('TTK_DRIVE_SOURCES', row);
    auditLog_(session.user_id, 'Папка ТТК на Google Диске', 'TTK_DRIVE_SOURCES:' + row.source_id, cur ? cur.folder_id : '', id, 'success', session.cascade_id || '');
    return _tdSourceView_(row);
  });
}

function _tdSourceView_(s) {
  if (!s) return null;
  var res = {}; try { res = JSON.parse(s.last_result_json || '{}'); } catch (e) { res = {}; }
  return { source_id: s.source_id, folder_id: s.folder_id, folder_name: s.folder_name, last_sync_at: String(s.last_sync_at || ''), last_status: s.last_status || '', last_result: res };
}

/** Состояние синхронизации: папка, последний прогон, файлы с ошибками/удалённые, дерево папок. */
function getTtkDriveStatus_(session) {
  var s = _tdSource_(session.organization_id);
  if (!s) return { source: null, files: { total: 0 } };
  var files = findRows_('TTK_DRIVE_FILES', function (f) { return f.source_id === s.source_id; });
  var cnt = { total: files.length, ok: 0, error: 0, deferred: 0, removed: 0 }, problems = [];
  files.forEach(function (f) {
    if (f.sync_state === 'REMOVED') { cnt.removed++; problems.push({ file_id: f.file_id, path: f.path, state: 'REMOVED', note: 'Файл удалён из папки ' + String(f.removed_at || '').slice(0, 10) + (f.entity_id ? ' — карта в системе осталась' : '') }); }
    else if (f.parse_status === 'ERROR') { cnt.error++; problems.push({ file_id: f.file_id, path: f.path, state: 'ERROR', note: f.parse_error }); }
    else if (f.parse_status === 'DEFERRED') { cnt.deferred++; }
    else cnt.ok++;
  });
  return { source: _tdSourceView_(s), files: cnt, problems: problems.slice(0, 200) };
}

// ---------- чтение папки и файлов ----------

function _tdListFolder_(folder, path, out, deadline) {
  var info = { path: path.join(' / '), files: 0, skipped: 0 };
  out.folders.push(info);
  var it = folder.getFiles();
  while (it.hasNext()) {
    if (Date.now() > deadline) { out.truncated = true; return; }
    var f = it.next(), name = f.getName(), kind = ttkDriveFileKind_(f.getMimeType(), name);
    if (!kind) { info.skipped++; continue; }
    out.files.push({ id: f.getId(), name: name, mime: f.getMimeType(), kind: kind, modified: f.getLastUpdated().getTime(), path: path.concat([name]).join('/'), file: f });
    info.files++;
  }
  var subs = folder.getFolders(), list = [];
  while (subs.hasNext()) list.push(subs.next());
  list.sort(function (a, b) { return a.getName().localeCompare(b.getName(), 'ru', { numeric: true }); });
  for (var i = 0; i < list.length && !out.truncated; i++) _tdListFolder_(list[i], path.concat([list[i].getName()]), out, deadline);
}

function _tdDrive_(method, url, payload) {
  var o = { method: method, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
  if (payload) { o.contentType = 'application/json'; o.payload = JSON.stringify(payload); }
  var r = UrlFetchApp.fetch(url, o);
  if (r.getResponseCode() >= 300) throw new Error('Google Диск ответил ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
  return r;
}

function _tdTmpFolderId_() {
  var p = PropertiesService.getScriptProperties(), id = p.getProperty('TTK_DRIVE_TMP_FOLDER_ID');
  if (id) { try { DriveApp.getFolderById(id).getName(); return id; } catch (e) {} }
  id = DriveApp.createFolder('ЦЕХ — временные копии для разбора ТТК').getId(); p.setProperty('TTK_DRIVE_TMP_FOLDER_ID', id); return id;
}

/** Копия файла с конвертацией в Google Таблицу/Документ (PDF → Документ с распознаванием текста). */
function _tdConvert_(fileId, targetMime) {
  var r = _tdDrive_('post', 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '/copy?fields=id&ocrLanguage=ru&supportsAllDrives=true',
    { mimeType: targetMime, name: 'ЦЕХ-разбор-' + Date.now(), parents: [_tdTmpFolderId_()] });
  return JSON.parse(r.getContentText()).id;
}

function _tdExport_(id, mime) {
  return _tdDrive_('get', 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '/export?mimeType=' + encodeURIComponent(mime)).getContentText();
}

function _tdHtmlText_(s) {
  return String(s || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

/** HTML документа → таблица: строка таблицы → ячейки; абзац вне таблицы → одна ячейка. */
function ttkHtmlGrid_(html) {
  var body = String(html || ''), m = /<body[\s\S]*<\/body>/i.exec(body); if (m) body = m[0];
  var tokens = body.match(/<tr[\s\S]*?<\/tr>|<p[\s\S]*?<\/p>|<h\d[\s\S]*?<\/h\d>|<li[\s\S]*?<\/li>/gi) || [], grid = [];
  tokens.forEach(function (t) {
    if (/^<tr/i.test(t)) grid.push((t.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map(_tdHtmlText_));
    else { var x = _tdHtmlText_(t); if (x) grid.push([x]); }
  });
  return grid;
}

/** Простой текст (так раскладывается PDF) → ячейки по табуляции или двум и более пробелам. */
function ttkTextGrid_(text) {
  return String(text || '').split(/\r?\n/).map(function (l) { return l.replace(/ /g, ' ').trim(); }).filter(Boolean)
    .map(function (l) { return l.split(/\t| {2,}/).map(function (x) { return x.trim(); }); });
}

/** Файл → таблица ячеек. {deferred:true}, если лимит конвертаций этого прогона исчерпан. */
function _tdGrid_(f, budget) {
  var kind = f.kind;
  if (kind === 'xls' || kind === 'csv' || kind === 'txt') {
    var text = f.file.getBlob().getDataAsString('UTF-8');
    if (kind === 'xls' && /<Workbook|<Row\b/i.test(text.slice(0, 5000))) return ttkXmlSpreadsheetGrid_(text);
    if (kind === 'csv') return Utilities.parseCsv(text, text.split(';').length > text.split(',').length ? ';' : ',');
    if (kind === 'txt') return ttkTextGrid_(text);
    kind = 'toSheet'; // двоичный .xls или .xlsx под именем .xls
  }
  if (kind === 'sheet') return SpreadsheetApp.openById(f.id).getSheets()[0].getDataRange().getValues();
  if (kind === 'doc') return ttkHtmlGrid_(_tdExport_(f.id, 'text/html'));
  if (budget.left <= 0) return { deferred: true };
  budget.left--;
  var tmp = '';
  try {
    if (kind === 'toSheet') { tmp = _tdConvert_(f.id, TTK_DRIVE_MIME.GSHEET); return SpreadsheetApp.openById(tmp).getSheets()[0].getDataRange().getValues(); }
    tmp = _tdConvert_(f.id, TTK_DRIVE_MIME.GDOC);
    var html = _tdExport_(tmp, 'text/html');
    return kind === 'pdf' && !/<tr/i.test(html) ? ttkTextGrid_(_tdExport_(tmp, 'text/plain')) : ttkHtmlGrid_(html);
  } finally { if (tmp) { try { DriveApp.getFileById(tmp).setTrashed(true); } catch (e) {} } }
}

// ---------- синхронизация ----------

/** Карты, уже подтверждённые в импорте: по пути файла (без расширения) → объект и отпечаток. */
function _tdBaseline_(organizationId) {
  var byPath = {};
  findRows_('TTK_IMPORT_ROWS', function (r) { return r.organization_id === organizationId && r.status === 'CONFIRMED' && r.entity_id; }).forEach(function (r) {
    var card = _tiJson_(r.card_json, {});
    byPath[_tdPathKey_(r.source_path)] = { entity_id: r.entity_id, entity_type: r.kind, fingerprint: ttkCardDriveFingerprint_(card), row_id: r.row_id };
  });
  return byPath;
}

/** Состояние вернувшегося в папку файла — по решению технолога о его последней строке импорта. */
function _tdStateOfRow_(r) {
  var row = r.import_row_id ? findOne_('TTK_IMPORT_ROWS', 'row_id', r.import_row_id) : null;
  if (!row) return r.entity_id ? 'SYNCED' : 'NEW';
  return row.status === 'CONFIRMED' ? 'SYNCED' : row.status === 'SKIPPED' ? 'SKIPPED' : (row.change_kind || 'NEW');
}

function _tdUpsertFile_(reg, f, src, patch) {
  var r = reg[f.id];
  var base = { path: f.path, name: f.name, mime: f.mime, kind: f.kind, modified_at: f.modified, last_seen_at: nowIso_(), removed_at: '', sync_state: patch.sync_state || (r ? r.sync_state : 'NEW') };
  Object.keys(patch).forEach(function (k) { base[k] = patch[k]; });
  if (r) { updateRow_('TTK_DRIVE_FILES', r, base); return r; }
  r = { file_id: f.id, organization_id: src.organization_id, source_id: src.source_id, first_seen_at: nowIso_(), parse_status: '', parse_error: '', card_name: '', fingerprint: '', import_row_id: '', entity_type: '', entity_id: '' };
  Object.keys(base).forEach(function (k) { r[k] = base[k]; });
  insertRow_('TTK_DRIVE_FILES', r); reg[f.id] = r;
  return r;
}

/**
 * Синхронизация папки: новые и изменённые карты → импорт на проверку технологу.
 * Повторный вызов продолжает с места остановки (обработанные файлы помечены датой изменения).
 */
function syncTtkDrive_(data, session) {
  var src = _tdSource_(session.organization_id);
  if (!src) throw new Error('Не указана папка ТТК на Google Диске.');
  var started = Date.now(), deadline = started + Math.min(Number(data && data.timeBudgetMs) || TTK_DRIVE_TIME_BUDGET_MS, TTK_DRIVE_TIME_BUDGET_MS);
  var root;
  try { root = DriveApp.getFolderById(src.folder_id); root.getName(); } catch (e) { throw new Error('Папка «' + src.folder_name + '» недоступна: ' + (e.message || e)); }
  var list = { folders: [], files: [], truncated: false };
  _tdListFolder_(root, [], list, deadline - 60000);
  var reg = {};
  findRows_('TTK_DRIVE_FILES', function (r) { return r.source_id === src.source_id; }).forEach(function (r) { reg[r.file_id] = r; });
  var baseline = _tdBaseline_(session.organization_id);
  var budget = { left: TTK_DRIVE_CONVERT_LIMIT };
  var res = { files: list.files.length, folders: list.folders.length, new: 0, changed: 0, unchanged: 0, linked: 0, errors: 0, deferred: 0, removed: 0, guard: '', import_id: '', complete: false };
  var pending = [];
  list.files.forEach(function (f) {
    var r = reg[f.id];
    if (Date.now() > deadline) { res.deferred++; return; }
    if (r && Number(r.modified_at) === f.modified && r.parse_status && r.parse_status !== 'DEFERRED' && r.sync_state !== 'REMOVED') { res.unchanged++; return; }
    var grid;
    try { grid = _tdGrid_(f, budget); } catch (e) { _tdUpsertFile_(reg, f, src, { parse_status: 'ERROR', parse_error: String(e.message || e).slice(0, 300) }); res.errors++; return; }
    if (grid && grid.deferred) { _tdUpsertFile_(reg, f, src, { parse_status: 'DEFERRED', parse_error: '', modified_at: '' }); res.deferred++; return; }
    var card = parseTtkCardGrid_(grid, f.path);
    if (!card.lines.length) { _tdUpsertFile_(reg, f, src, { parse_status: 'ERROR', parse_error: card.issues[0] || 'нет строк сырья', card_name: card.name }); res.errors++; return; }
    var fp = ttkCardDriveFingerprint_(card);
    if (r && r.fingerprint === fp) {
      // Содержание то же (файл пересохранён или вернулся в папку): только дата и состояние.
      _tdUpsertFile_(reg, f, src, { parse_status: 'OK', parse_error: '', sync_state: r.sync_state === 'REMOVED' ? _tdStateOfRow_(r) : r.sync_state });
      res.unchanged++; return;
    }
    var known = r && r.entity_id ? { entity_id: r.entity_id, entity_type: r.entity_type, fingerprint: r.fingerprint } : baseline[_tdPathKey_(f.path)];
    if (!r && known && known.fingerprint === fp) {
      // Карта уже импортирована из архива и с тех пор не менялась: только связываем файл с объектом.
      _tdUpsertFile_(reg, f, src, { parse_status: 'OK', parse_error: '', card_name: card.name, fingerprint: fp, entity_type: known.entity_type, entity_id: known.entity_id, import_row_id: known.row_id, sync_state: 'SYNCED' });
      res.linked++; return;
    }
    // Прежняя версия файла ещё ждёт проверки — она устарела, проверять нужно новую.
    var prev = r && r.import_row_id ? findOne_('TTK_IMPORT_ROWS', 'row_id', r.import_row_id) : null;
    if (prev && ['PREVIEW', 'DUPLICATE', 'ERROR'].indexOf(prev.status) !== -1) updateRow_('TTK_IMPORT_ROWS', prev, { status: 'SKIPPED', result_json: JSON.stringify({ reason: 'Файл изменён ещё раз — проверьте новую версию карты.' }), decided_by: session.user_id, decided_at: nowIso_() });
    var kind = known && known.entity_id ? 'CHANGED' : 'NEW';
    card.drive = { file_id: f.id, change_kind: kind, entity_id: known ? known.entity_id : '', entity_type: known ? known.entity_type : '' };
    if (kind === 'CHANGED') card.drive.diff = diffTtkCardWithEntity_(card, known.entity_type, known.entity_id, session);
    pending.push({ f: f, card: card, fp: fp });
  });
  // Удалённые файлы — только после полного обхода и если папка не «опустела» подозрительно.
  if (!list.truncated) {
    var seen = {}; list.files.forEach(function (f) { seen[f.id] = true; });
    var active = Object.keys(reg).map(function (k) { return reg[k]; }).filter(function (r) { return r.sync_state !== 'REMOVED'; });
    var gone = active.filter(function (r) { return !seen[r.file_id]; });
    if (gone.length && active.length > TTK_DRIVE_GUARD_MIN && list.files.length < active.length * 0.5) {
      res.guard = 'В папке найдено ' + list.files.length + ' карт вместо ' + active.length + ' — удалённые не отмечены. Проверьте папку и доступ к ней.';
    } else gone.forEach(function (r) { updateRow_('TTK_DRIVE_FILES', r, { sync_state: 'REMOVED', removed_at: nowIso_() }); res.removed++; });
  }
  if (pending.length) {
    var allNames = pending.map(function (p) { return p.card.name; }), ref = {};
    pending.forEach(function (p) { (p.card.lines || []).forEach(function (l) { if (l.is_portion_ref || l.is_pf) ref[l.name] = 1; }); });
    // Пока в пакете этой папки есть непроверенные карты, новые добавляются в него же: ссылки блюд
    // на ПФ из архива разрешаются внутри одного пакета.
    var open = findRows_('TTK_IMPORT_BATCHES', function (b) { return b.organization_id === session.organization_id && b.source_type === 'DRIVE' && b.source_id === src.source_id; }).pop();
    var importId = open && findRows_('TTK_IMPORT_ROWS', function (x) { return x.import_id === open.import_id && x.status === 'PREVIEW'; }).length ? open.import_id : '';
    for (var i = 0; i < pending.length; i += TTK_IMPORT_CHUNK_MAX) {
      var chunk = pending.slice(i, i + TTK_IMPORT_CHUNK_MAX);
      var pr = previewTtkImport_({ importId: importId, sourceName: 'Google Диск: ' + src.folder_name + ' · ' + nowIso_().slice(0, 16).replace('T', ' '), sourceType: 'DRIVE', sourceId: src.source_id,
        cards: chunk.map(function (p) { return p.card; }), allNames: allNames, refNames: Object.keys(ref) }, session);
      importId = pr.import_id;
      chunk.forEach(function (p, j) {
        _tdUpsertFile_(reg, p.f, src, { parse_status: 'OK', parse_error: '', card_name: p.card.name, fingerprint: p.fp, import_row_id: pr.row_ids[j], sync_state: p.card.drive.change_kind,
          entity_type: p.card.drive.entity_type || '', entity_id: p.card.drive.entity_id || '' });
        if (p.card.drive.change_kind === 'CHANGED') res.changed++; else res.new++;
      });
    }
    res.import_id = importId;
  }
  res.complete = !list.truncated && !res.deferred;
  res.folders_tree = list.folders.map(function (x) { return { path: x.path, files: x.files, skipped: x.skipped }; }).slice(0, 300);
  res.duration_s = Math.round((Date.now() - started) / 1000);
  updateRow_('TTK_DRIVE_SOURCES', src, { last_sync_at: nowIso_(), last_status: res.complete ? 'OK' : 'PARTIAL', last_result_json: JSON.stringify(res) });
  auditLog_(session.user_id, 'Синхронизация ТТК с Google Диском', 'TTK_DRIVE_SOURCES:' + src.source_id, '', JSON.stringify({ new: res.new, changed: res.changed, removed: res.removed, errors: res.errors, deferred: res.deferred }), 'success', session.cascade_id || '');
  return res;
}

/** Ежедневная синхронизация всех организаций с указанной папкой (из TriggerScheduler). */
function ttkDriveSyncTrigger_() {
  findRows_('TTK_DRIVE_SOURCES', function (s) { return s.active === true || s.active === 'TRUE'; }).forEach(function (s) {
    try { syncTtkDrive_({ timeBudgetMs: 150000 }, { organization_id: s.organization_id, user_id: 'SYSTEM:ttk_drive_sync', location_id: '', cascade_id: '' }); }
    catch (e) { if (typeof logSystemError_ === 'function') logSystemError_('ttkDriveSyncTrigger_', null, 'ttk_drive', e, { source_id: s.source_id }); }
  });
}

// ---------- изменение карты: разница и применение ----------

function _tdCurrentState_(type, id, session) {
  var isPf = type === 'PF', ent = isPf ? getSemiFinishedById_(id) : findOne_('DISHES', 'dish_id', id);
  if (!ent) return null;
  var lines = getRecipeLines_(isPf ? 'PF' : 'DISH', id).map(function (l) {
    var ing = String(l.product_id).indexOf('PF-') === 0 ? getSemiFinishedById_(l.product_id) : getProductById_(l.product_id);
    return { name: ing ? ing.название : l.product_id, unit: l.единица, brutto: Number(l.брутто) || 0, netto: Number(l.нетто) || 0 };
  });
  var tech = '';
  if (isPf) {
    var pc = findRows_('PF_TECH_CARDS', function (c) { return c.pf_id === id && c.status !== 'архив'; }).sort(function (a, b) { return Number(b.version) - Number(a.version); })[0];
    tech = pc ? pc.технология : '';
  } else {
    var tv = findRows_('TTK_VERSIONS', function (v) { return v.dish_id === id && v.status !== 'архив'; }).sort(function (a, b) { return Number(b.version) - Number(a.version); })[0];
    tech = tv ? tv.технология : '';
  }
  return { name: ent.название, yield_g: isPf ? Math.round(Number(ent.выход) * 1000 * 10) / 10 : Number(ent.выход), technology: tech || '', lines: lines };
}

function _tdQty_(x) { return x ? (x.brutto === null || x.brutto === undefined ? '—' : x.brutto + ' ' + x.unit) + (x.netto && x.netto !== x.brutto ? ' (нетто ' + x.netto + ')' : '') : '—'; }

/** Разница «было → стало» двух состояний карты: [{field, label, before, after}]. */
function ttkStateDiff_(a, b) {
  var out = [], add = function (field, label, x, y) { out.push({ field: field, label: label, before: x === '' || x === null || x === undefined ? '—' : String(x), after: y === '' || y === null || y === undefined ? '—' : String(y) }); };
  var eq = function (x, y) { return Math.abs((Number(x) || 0) - (Number(y) || 0)) < 1e-9; };
  if (a.name !== undefined && b.name !== undefined && _tiNorm_(a.name) !== _tiNorm_(b.name)) add('name', 'Название', a.name, b.name);
  if (b.yield_g && !eq(a.yield_g, b.yield_g)) add('yield', 'Выход, г', a.yield_g, b.yield_g);
  var ta = String(a.technology || '').replace(/\s+/g, ' ').trim(), tb = String(b.technology || '').replace(/\s+/g, ' ').trim();
  if (tb && ta !== tb) add('technology', 'Технология', ta, tb);
  ['storage', 'shelf', 'serving'].forEach(function (k) {
    var lab = { storage: 'Условия хранения', shelf: 'Срок реализации', serving: 'Подача' }[k];
    if (a[k] !== undefined && b[k] !== undefined && String(a[k] || '') !== String(b[k] || '')) add(k, lab, a[k], b[k]);
  });
  var ia = {}, ib = {};
  (a.lines || []).forEach(function (l) { ia[_tiNorm_(l.name)] = l; });
  (b.lines || []).forEach(function (l) { ib[_tiNorm_(l.name)] = l; });
  Object.keys(ib).forEach(function (k) {
    var x = ia[k], y = ib[k];
    if (!x) { add('ingredient', y.name + ' — добавлен', '—', _tdQty_(y)); return; }
    if (String(x.unit) !== String(y.unit)) add('ingredient', y.name + ' — единица', x.unit, y.unit);
    if (!eq(x.brutto, y.brutto)) add('ingredient', y.name + ' — брутто', x.brutto + ' ' + x.unit, y.brutto + ' ' + y.unit);
    if (y.netto !== null && y.netto !== undefined && !eq(x.netto, y.netto)) add('ingredient', y.name + ' — нетто', x.netto + ' ' + x.unit, y.netto + ' ' + y.unit);
  });
  Object.keys(ia).forEach(function (k) { if (!ib[k]) add('ingredient', ia[k].name + ' — удалён', _tdQty_(ia[k]), '—'); });
  return out;
}

/** Что изменится в блюде/ПФ, если принять карту из файла. */
function diffTtkCardWithEntity_(card, type, id, session) {
  var cur = _tdCurrentState_(type, id, session);
  if (!cur) return [{ field: 'entity', label: 'Объект в системе', before: 'не найден', after: card.name }];
  return ttkStateDiff_(cur, { name: card.name, yield_g: card.yield_g, technology: card.technology,
    lines: (card.lines || []).map(function (l) { return { name: l.name, unit: l.unit === 'порция' ? 'шт' : l.unit, brutto: Number(l.brutto) > 0 ? Number(l.brutto) : Number(l.netto), netto: Number(l.netto) > 0 ? Number(l.netto) : Number(l.brutto) }; }) });
}

/**
 * Привести рецептуру блюда/ПФ к целевому составу [{ingredientId, qty, net, unit, loss}]:
 * совпадающие ингредиенты обновляются, новые добавляются, лишние снимаются с рецептуры
 * (строка остаётся в листе с parent_type REMOVED — история не теряется).
 */
function applyRecipeTarget_(type, id, target, session) {
  var parentType = type === 'PF' ? 'PF' : 'DISH';
  var cur = getRecipeLines_(parentType, id, session), used = {}, out = { updated: 0, added: 0, removed: 0 };
  target.forEach(function (t) {
    var line = cur.filter(function (l) { return l.product_id === t.ingredientId && !used[l.recipe_id]; })[0];
    if (line) {
      used[line.recipe_id] = true;
      if (Number(line.брутто) !== Number(t.qty) || Number(line.нетто) !== Number(t.net) || String(line.единица) !== String(t.unit) || Number(line.потери_процент || 0) !== Number(t.loss)) {
        updateRecipeLine_(line.recipe_id, { брутто: t.qty, нетто: t.net, единица: t.unit, потери_процент: t.loss }, session); out.updated++;
      }
    } else { addRecipeLine_(parentType, id, t.ingredientId, t.qty, t.net, t.unit, t.loss, session); out.added++; }
  });
  cur.forEach(function (l) {
    if (used[l.recipe_id]) return;
    updateRow_('RECIPES', l, { parent_type: 'REMOVED', parent_id: parentType + ':' + id });
    out.removed++;
  });
  if (out.removed && typeof recalcParentCost_ === 'function') recalcParentCost_(parentType, id);
  return out;
}

/** Подтверждение изменённой карты: рецептура, выход, новая версия ТТК / техкарты ПФ (черновик). */
function applyTtkCardChange_(r, card, target, steps, entityId, session) {
  var isPf = r.kind === 'PF', out = { recipe: applyRecipeTarget_(r.kind, entityId, target, session) };
  var y = Number(r.yield_g);
  if (y > 0) {
    if (isPf) { var pf = getSemiFinishedById_(entityId); if (Math.abs(Number(pf.выход) - y / 1000) > 1e-9) updateRow_('SEMI_FINISHED', pf, { выход: y / 1000, обновлено: nowIso_() }); }
    else updateDish_(entityId, { выход: y }, session);
  }
  var tech = String(card.technology || '').trim(), src = 'Файл: ' + (r.source_path || r.name);
  if (tech.length < 10) { out.note = 'В карте нет текста технологии — версия ' + (isPf ? 'техкарты' : 'ТТК') + ' не создана.'; return out; }
  if (isPf) {
    var cards = findRows_('PF_TECH_CARDS', function (c) { return c.pf_id === entityId; }).sort(function (a, b) { return Number(b.version) - Number(a.version); });
    var draft = cards.filter(function (c) { return c.status === 'черновик'; })[0], appr = cards.filter(function (c) { return c.status === 'утверждена'; })[0] || {};
    var pfRow = savePfTechDraft_({ pfId: entityId, pfTechId: draft ? draft.pf_tech_id : '', источник: src, технология: tech, steps: steps,
      условия_хранения: (draft || appr).условия_хранения || PF_TECH_PLACEHOLDER, срок_хранения_часов: (draft || appr).срок_хранения_часов || '' }, session);
    out.pf_tech_id = pfRow.pf_tech_id; out.version = pfRow.version;
  } else {
    var versions = findRows_('TTK_VERSIONS', function (v) { return v.dish_id === entityId; }).sort(function (a, b) { return Number(b.version) - Number(a.version); });
    var last = versions[0], cur = versions.filter(function (v) { return v.status === 'утверждена'; })[0] || last || {};
    var fields = { источник: src, технология: tech, условия_хранения: cur.условия_хранения || TTK_FILL_PLACEHOLDER, срок_реализации: cur.срок_реализации || TTK_FILL_PLACEHOLDER,
      технологическиеЭтапы: steps, режим_подачи: r.serving_mode || cur.режим_подачи || '' };
    var row;
    if (last && last.status === 'черновик') row = updateTtkDraft_(last.ttk_version_id, fields, session);
    else { fields.dishId = entityId; fields.область_применения = cur.область_применения || r.name; row = createTtkVersion_(fields, session); }
    out.ttk_version_id = row.ttk_version_id; out.version = row.version;
  }
  auditLog_(session.user_id, 'Карта ТТК обновлена из файла', (isPf ? 'SEMI_FINISHED:' : 'DISHES:') + entityId, '', JSON.stringify(out), 'success', session.cascade_id || '');
  return out;
}

/** Решение технолога по строке импорта из Диска → состояние файла в реестре. */
function markTtkDriveFileDecision_(row, state) {
  if (!row || !row.drive_file_id) return;
  var f = findOne_('TTK_DRIVE_FILES', 'file_id', row.drive_file_id);
  if (!f || f.organization_id !== row.organization_id || f.import_row_id !== row.row_id) return;
  var patch = { sync_state: state };
  if (state === 'SYNCED') { patch.entity_id = row.entity_id; patch.entity_type = row.kind; }
  updateRow_('TTK_DRIVE_FILES', f, patch);
}

function migrateTtkDriveSchema_() {
  var changed = [];
  ['TTK_DRIVE_SOURCES', 'TTK_DRIVE_FILES', 'TTK_IMPORT_ROWS', 'TTK_IMPORT_BATCHES'].forEach(function (k) { changed = changed.concat(ensureSchemaColumns_(k) || []); });
  return { ok: true, changed: changed };
}
