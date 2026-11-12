/**
 * ЦЕХ Стандарт V70 — база нормативов и сроков годности на Google Диске.
 *
 * Папка на Диске (свойство MC_NORMS_FOLDER_ID) — источник:
 *  1) документов реестра «Нормативы_V33»: файлы распознаются по имени и SHA-256, ссылка на файл ставится в реестр,
 *     одинаковые файлы помечаются дублями, нераспознанные ждут ручной классификации;
 *  2) норм, выписанных из этих документов дословно (MonChef_V70_NormData.gs: пункт, страница PDF, цитата, SHA-256 файла);
 *  3) сроков годности предприятия — из таблицы Google или CSV в той же папке (колонки — см. MC_V70_TABLE_COLS_).
 *
 * Норма применяется только после проверки ответственным за ХАССП (APPROVED). Если файл в папке изменился или пропал —
 * норма уходит на проверку (REVIEW / NO_FILE) и перестаёт применяться. Система норм не придумывает: чего нет в документах
 * и таблице — того нет в подсказках.
 *
 * Где применяются утверждённые нормы:
 *  - входной контроль: пределы температуры по группе продукта и термическому состоянию (вместо прежних 0…+6 без источника);
 *  - приёмка: «годен до» сырья по таблице сроков (раньше матрицы продуктов);
 *  - этикетки заданий кухни и выпуск: срок блюда/п/ф по таблице сроков, если в карте ТТК срока нет (раньше категории);
 *  - срок после вскрытия: правила V38, созданные из утверждённых строк таблицы;
 *  - ППК: разделы «Входной контроль», «Технологические процессы», «Готовая продукция», «Хранение», «Лаборатория».
 */
var MC_V70 = { FILES: 'Нормативы_Файлы_V70', NORMS: 'Нормативы_Значения_V70' };
var MC_V70_H = {
  FILES: ['FileID', 'Name', 'MimeType', 'Size', 'SHA256', 'DocID', 'Recognition', 'DuplicateOf', 'Modified', 'URL', 'CheckedAt', 'Note'],
  NORMS: ['NormID', 'DocID', 'Ref', 'Page', 'Domain', 'Object', 'Applies', 'Parameter', 'Min', 'Max', 'Unit', 'Quote', 'SourceFile', 'SourceFileID', 'SourceURL',
    'ExtractedSHA256', 'CurrentSHA256', 'ApprovedSHA256', 'Origin', 'Kind', 'Mode', 'Hours', 'AfterOpenHours', 'Status', 'Comment', 'DecidedBy', 'DecidedAt', 'AppliedTo', 'UpdatedAt']
};
var MC_V70_PROP_ = 'MC_NORMS_FOLDER_ID';
var MC_V70_DOMAIN_RU_ = { PRODUCT_TEMP: 'Температура продукта', SERVING_TEMP: 'Температура при реализации', HOLDING_TIME: 'Время хранения и реализации',
  PACKING_TEMP: 'Температура при фасовке', COOLING: 'Охлаждение', ROOM_TEMP: 'Температура помещения', LABEL: 'Маркировка', SHELF_RULE: 'Сроки годности: правило',
  SHELF_LIFE: 'Срок годности (таблица предприятия)', MICRO: 'Микробиология', JOURNAL: 'Журналы' };
var MC_V70_STATUS_RU_ = { DRAFT: 'на проверке', APPROVED: 'утверждена', REJECTED: 'отклонена', REVIEW: 'проверить: файл изменился', NO_FILE: 'нет файла в папке', REMOVED: 'строки нет в таблице' };
var MC_V70_REC_RU_ = { RECOGNIZED: 'распознан', DUPLICATE: 'дубль', UNKNOWN: 'не распознан', MANUAL: 'указан вручную', TABLE: 'таблица сроков', ARCHIVE: 'архив — не читается' };
/** Колонки таблицы сроков на Диске (заголовок первой строки; регистр и порядок не важны). */
var MC_V70_TABLE_COLS_ = {
  name: /^(продукт|блюдо|наименование|объект|продукт.*блюдо|ттк)/i, kind: /^(тип|вид)/i, mode: /^(режим|условия)/i,
  tmin: /(температура|t).*(от|мин)/i, tmax: /(температура|t).*(до|макс)/i, hours: /срок.*(ч|час)/i, days: /срок.*(сут|дн)/i,
  afterOpen: /вскрыт/i, source: /^(источник|основание|документ)/i
};

function _v70Sh_(k) {
  var n = MC_V70[k], h = MC_V70_H[k], sh = _book_().getSheetByName(n);
  if (!sh) { sh = _book_().insertSheet(n); sh.getRange(1, 1, 1, h.length).setValues([h]); sh.setFrozenRows(1); }
  return sh;
}
function _v70Objs_(k) {
  var sh = _book_().getSheetByName(MC_V70[k]); if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getValues(), h = v[0];
  return v.slice(1).map(function (r, i) { var o = { _row: i + 2 }; h.forEach(function (c, j) { o[c] = r[j]; }); return o; });
}
function _v70Write_(k, objs) {
  var sh = _v70Sh_(k), h = MC_V70_H[k];
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, h.length).clearContent();
  if (objs.length) sh.getRange(2, 1, objs.length, h.length).setValues(objs.map(function (o) { return h.map(function (c) { return o[c] === undefined || o[c] === null ? '' : o[c]; }); }));
}
function _v70Num_(x) { if (x === '' || x === null || x === undefined) return null; var n = Number(String(x).replace(',', '.').replace(/[−–]/, '-')); return isFinite(n) ? n : null; }
function _v70Norm_(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').replace(/\s+/g, ' ').trim(); }
function _v70Hex_(bytes) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function (b) { b = b < 0 ? b + 256 : b; return (b < 16 ? '0' : '') + b.toString(16); }).join(''); }
function _v70Who_(op) { var s = op && op.session; return s ? (s.dev ? MC_RB_TECH_ : (s.fullName || s.name || s.user_id || '')) : ''; }
function _v70Fail_(op, code, msg) { _endOp_(op, 'FAILED'); return _fail_(code, msg, op.id); }
function _v70FolderId_() { try { return String(PropertiesService.getScriptProperties().getProperty(MC_V70_PROP_) || ''); } catch (e) { return ''; } }
function _v70ValueText_(n) {
  var mn = _v70Num_(n.Min), mx = _v70Num_(n.Max), u = n.Unit || '';
  if (mn !== null && mx !== null) return 'от ' + mn + ' до ' + mx + ' ' + u;
  if (mn !== null) return 'не менее ' + mn + ' ' + u;
  if (mx !== null) return (u === 'ч' || u === 'г' ? '' : 'не выше ') + mx + ' ' + u;
  return '';
}
function _v70DocNum_(docId) { var c = (typeof MC_V70_CATALOG_ !== 'undefined' ? MC_V70_CATALOG_ : []).filter(function (x) { return x.id === docId; })[0]; return c ? c.number : docId; }
function _v70Source_(n) { return n.Origin === 'TABLE' ? 'таблица «' + n.SourceFile + '», ' + n.Ref + (n.Applies ? ' (' + n.Applies + ')' : '') : _v70DocNum_(n.DocID) + ', ' + n.Ref + (n.Page ? ', стр. ' + n.Page : ''); }

/* ---------------- папка ---------------- */
function setupV70NormBase(token) {
  try { _requireAuth_(token, 'haccp|haccp_view|system'); _v70Sh_('FILES'); _v70Sh_('NORMS'); return _ok_({ initialized: true, sheets: [MC_V70.FILES, MC_V70.NORMS] }, 'V70_SETUP'); } catch (e) { return _failFrom_(e); }
}
function v70SetFolder(linkOrId, token) {
  var op = null; try { op = _beginOp_(token, 'haccp|system', 'V70_FOLDER', 'Нормативы', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var s = String(linkOrId || '').trim(), m = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(s) || /[?&]id=([A-Za-z0-9_-]{10,})/.exec(s), id = m ? m[1] : (/^[A-Za-z0-9_-]{10,}$/.test(s) ? s : '');
    if (!id) return _v70Fail_(op, 'VALIDATION', 'Вставьте ссылку на папку Google Диска (…/drive/folders/…) или её ID');
    var f; try { f = DriveApp.getFolderById(id); } catch (e) { return _v70Fail_(op, 'NOT_FOUND', 'Папка не открывается от имени владельца системы — проверьте ссылку и доступ'); }
    var old = _v70FolderId_(); PropertiesService.getScriptProperties().setProperty(MC_V70_PROP_, id);
    _audit_(op, 'V70_FOLDER', 'Свойства', MC_V70_PROP_, old, { id: id, name: f.getName() }); _endOp_(op);
    return _ok_({ folderId: id, name: f.getName(), url: f.getUrl ? f.getUrl() : 'https://drive.google.com/drive/folders/' + id }, op.id);
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- распознавание ---------------- */
function _v70Recognize_(name, sha) {
  var cat = typeof MC_V70_CATALOG_ !== 'undefined' ? MC_V70_CATALOG_ : [];
  var byHash = cat.filter(function (c) { return (c.sha || []).indexOf(sha) >= 0; })[0];
  if (byHash) return byHash;
  var nm = String(name || '').replace(/_/g, ' ');
  return cat.filter(function (c) { try { return new RegExp(c.re, 'i').test(nm); } catch (e) { return false; } })[0] || null;
}
function _v70TableRows_(f) {
  var mime = f.getMimeType(), rows = null;
  if (mime === 'application/vnd.google-apps.spreadsheet') { try { var b = SpreadsheetApp.openById(f.getId()), sh = b.getSheets()[0]; rows = sh.getDataRange().getValues(); } catch (e) { rows = null; } }
  else if (/csv/i.test(mime) || /\.csv$/i.test(f.getName())) { try { rows = Utilities.parseCsv(f.getBlob().getDataAsString('UTF-8')); } catch (e) { rows = null; } }
  if (!rows || rows.length < 1) return null;
  var head = rows[0].map(function (x) { return String(x || '').trim(); }), col = {};
  Object.keys(MC_V70_TABLE_COLS_).forEach(function (k) { head.forEach(function (h, i) { if (col[k] === undefined && MC_V70_TABLE_COLS_[k].test(h)) col[k] = i; }); });
  if (col.name === undefined || (col.hours === undefined && col.days === undefined && col.afterOpen === undefined)) return null;
  return { col: col, head: head, rows: rows.slice(1) };
}
function _v70Kind_(t, name) {
  var s = _v70Norm_(t + ' ' + name);
  if (/категор/.test(_v70Norm_(t))) return 'CATEGORY';
  if (/сырь|продукт|товар/.test(_v70Norm_(t))) return 'RAW';
  if (/п ф|полуфабрикат/.test(s)) return 'SEMI';
  if (/блюд|ттк/.test(_v70Norm_(t))) return 'DISH';
  return t ? 'DISH' : 'RAW';
}
function _v70Mode_(t, mn, mx) {
  var s = _v70Norm_(t);
  if (/мороз|заморож/.test(s)) return 'freezer';
  if (/комнат|сух|склад/.test(s)) return 'room';
  if (/холод/.test(s)) return 'fridge';
  if (mx !== null && mx <= -1) return 'freezer';
  if (mx !== null && mx <= 8) return 'fridge';
  if (mn !== null || mx !== null) return 'room';
  return 'fridge';
}

/* ---------------- синхронизация ---------------- */
function v70Sync(token) {
  var op = null; try { op = _beginOp_(token, 'haccp|system', 'V70_SYNC', 'Нормативы', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var fid = _v70FolderId_(); if (!fid) return _v70Fail_(op, 'VALIDATION', 'Укажите папку базы нормативов на Диске');
    var folder; try { folder = DriveApp.getFolderById(fid); } catch (e) { return _v70Fail_(op, 'NOT_FOUND', 'Папка базы нормативов не открывается — проверьте доступ владельца системы'); }
    return _withLock_(function () {
      var now = new Date(), prevFiles = {}; _v70Objs_('FILES').forEach(function (f) { prevFiles[f.FileID] = f; });
      var files = [], it = folder.getFiles(), tables = [];
      while (it.hasNext()) {
        var f = it.next(); if (f.isTrashed && f.isTrashed()) continue;
        var mime = f.getMimeType(), size = f.getSize ? f.getSize() : 0, sha = '', tbl = null;
        if (mime === 'application/vnd.google-apps.spreadsheet' || /csv/i.test(mime) || /\.csv$/i.test(f.getName())) {
          tbl = _v70TableRows_(f); if (tbl) sha = _v70Hex_(Utilities.newBlob(JSON.stringify(tbl.rows)).getBytes());
        } else if (!/^application\/vnd\.google-apps/.test(mime) && size <= 30 * 1024 * 1024) { try { sha = _v70Hex_(f.getBlob().getBytes()); } catch (e) { sha = ''; } }
        var o = { FileID: f.getId(), Name: f.getName(), MimeType: mime, Size: size, SHA256: sha, DocID: '', Recognition: 'UNKNOWN', DuplicateOf: '',
          Modified: f.getLastUpdated ? f.getLastUpdated() : '', URL: f.getUrl ? f.getUrl() : '', CheckedAt: now, Note: '' };
        if (tbl) { o.Recognition = 'TABLE'; o.Note = 'строк: ' + tbl.rows.length; tables.push({ file: o, tbl: tbl }); }
        else {
          var c = _v70Recognize_(o.Name, sha), prev = prevFiles[o.FileID];
          if (c) { o.DocID = c.id; o.Recognition = /\.zip$/i.test(o.Name) ? 'ARCHIVE' : 'RECOGNIZED'; }
          else if (prev && prev.Recognition === 'MANUAL' && prev.DocID) { o.DocID = prev.DocID; o.Recognition = 'MANUAL'; }
        }
        files.push(o);
      }
      // одинаковые файлы (SHA-256): основной — распознанный, с коротким именем
      var bySha = {};
      files.filter(function (x) { return x.SHA256 && x.Recognition !== 'TABLE'; }).forEach(function (x) { (bySha[x.SHA256] = bySha[x.SHA256] || []).push(x); });
      Object.keys(bySha).forEach(function (h) {
        var g = bySha[h]; if (g.length < 2) return;
        g.sort(function (a, b) { return (b.DocID ? 1 : 0) - (a.DocID ? 1 : 0) || a.Name.length - b.Name.length || (a.Name < b.Name ? -1 : 1); });
        g.slice(1).forEach(function (d) { d.DuplicateOf = g[0].FileID; d.DocID = d.DocID || g[0].DocID; d.Recognition = 'DUPLICATE'; d.Note = 'та же копия, что «' + g[0].Name + '»'; });
      });
      _v70Write_('FILES', files);
      var primary = {}; files.forEach(function (x) { if (x.DocID && (x.Recognition === 'RECOGNIZED' || x.Recognition === 'MANUAL') && !primary[x.DocID]) primary[x.DocID] = x; });
      files.forEach(function (x) { if (x.DocID && x.Recognition === 'ARCHIVE' && !primary[x.DocID]) primary[x.DocID] = x; });
      var reg = _v70Registry_(primary, op);
      var nr = _v70SyncNorms_(files, tables, op);
      var sum = { folder: folder.getName(), files: files.length, recognized: files.filter(function (x) { return x.Recognition === 'RECOGNIZED' || x.Recognition === 'MANUAL'; }).length,
        duplicates: files.filter(function (x) { return x.Recognition === 'DUPLICATE'; }).length, unknown: files.filter(function (x) { return x.Recognition === 'UNKNOWN'; }).map(function (x) { return x.Name; }),
        archives: files.filter(function (x) { return x.Recognition === 'ARCHIVE'; }).length, tables: tables.length, docsAdded: reg.added, docsLinked: reg.linked,
        normsNew: nr.added, normsReview: nr.review, normsNoFile: nr.noFile, tableRows: nr.tableRows, tableRejected: nr.tableRejected };
      _audit_(op, 'V70_SYNC', MC_V70.FILES, fid, null, sum); _endOp_(op);
      return _ok_(sum, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Реестр «Нормативы_V33»: ссылка на файл в папке; документов нет — добавить из каталога. Статусы существующих строк не меняются. */
function _v70Registry_(primary, op) {
  if (typeof _v33Init_ === 'function') _v33Init_();
  var sh = _book_().getSheetByName('Нормативы_V33'), v = sh.getDataRange().getValues(), idx = {}, added = 0, linked = 0;
  for (var i = 1; i < v.length; i++) idx[String(v[i][0])] = i + 1;
  Object.keys(primary).forEach(function (docId) {
    var f = primary[docId], note = 'Файл на Диске: ' + f.Name;
    if (idx[docId]) {
      var r = idx[docId], oldNote = String(sh.getRange(r, 10).getValue() || '').replace(/\s*Файл на Диске: .*$/, '');
      sh.getRange(r, 9).setValue(f.URL); sh.getRange(r, 10).setValue((oldNote ? oldNote + ' ' : '') + note); linked++;
    } else {
      var c = (MC_V70_CATALOG_ || []).filter(function (x) { return x.id === docId; })[0];
      if (!c && f.Recognition === 'MANUAL') { var m = _v70Manual_(docId); if (m) c = m; }
      if (!c) return;
      sh.appendRow([c.id, c.cls, c.status, c.number, c.title, c.from || '', c.to || '', !!c.mandatory, f.URL, (c.note ? c.note + '. ' : '') + note]); added++; linked++;
    }
  });
  return { added: added, linked: linked };
}
function _v70Manual_(docId) {
  try { var p = JSON.parse(PropertiesService.getScriptProperties().getProperty('MC_NORMS_MANUAL_DOCS') || '{}'); return p[docId] || null; } catch (e) { return null; }
}
/** Нормы: выписанные из документов (каталог) и строки таблиц сроков. */
function _v70SyncNorms_(files, tables, op) {
  var now = new Date(), old = {}, out = [], added = 0, review = 0, noFile = 0, tableRows = 0, tableRejected = [];
  _v70Objs_('NORMS').forEach(function (n) { old[n.NormID] = n; });
  var byDoc = {}; files.forEach(function (f) { if (f.DocID) (byDoc[f.DocID] = byDoc[f.DocID] || []).push(f); });
  var keep = function (o, prev) {
    if (prev) ['Status', 'Comment', 'DecidedBy', 'DecidedAt', 'ApprovedSHA256', 'AppliedTo'].forEach(function (k) { o[k] = prev[k]; });
    else { o.Status = 'DRAFT'; added++; }
    var base = o.ApprovedSHA256 || o.ExtractedSHA256;
    if (o.Status === 'REJECTED') return o;
    if (!o.CurrentSHA256) { if (o.Status !== 'NO_FILE') { if (o.Status === 'APPROVED') _v70Revoke_(o); o.Status = 'NO_FILE'; } noFile++; }
    else if (base && o.CurrentSHA256 !== base) { if (o.Status !== 'REVIEW') { if (o.Status === 'APPROVED') _v70Revoke_(o); o.Status = 'REVIEW'; } review++; }
    else if (o.Status === 'NO_FILE' || o.Status === 'REVIEW' || o.Status === 'REMOVED') o.Status = 'DRAFT';
    return o;
  };
  (typeof MC_V70_SEED_ !== 'undefined' ? MC_V70_SEED_ : []).forEach(function (s) {
    var fs = (byDoc[s.doc] || []).filter(function (f) { return f.Recognition !== 'ARCHIVE'; }), exact = fs.filter(function (f) { return f.SHA256 === s.sha256; })[0], f = exact || fs.filter(function (x) { return x.Recognition !== 'DUPLICATE'; })[0] || fs[0];
    out.push(keep({ NormID: s.id, DocID: s.doc, Ref: s.ref, Page: s.page, Domain: s.domain, Object: s.object, Applies: s.applies, Parameter: s.parameter, Min: s.min === null ? '' : s.min,
      Max: s.max === null ? '' : s.max, Unit: s.unit, Quote: s.quote, SourceFile: f ? f.Name : s.file, SourceFileID: f ? f.FileID : '', SourceURL: f ? f.URL : '', ExtractedSHA256: s.sha256,
      CurrentSHA256: f ? f.SHA256 : '', Origin: 'DOC', Kind: '', Mode: '', Hours: '', AfterOpenHours: '', UpdatedAt: now }, old[s.id]));
  });
  var seen = {};
  tables.forEach(function (t) {
    var c = t.tbl.col, fileKey = t.file.FileID.slice(-8);
    t.tbl.rows.forEach(function (r, i) {
      var name = String(r[c.name] || '').trim(); if (!name) return;
      var src = c.source !== undefined ? String(r[c.source] || '').trim() : '', hours = c.hours !== undefined ? _v70Num_(r[c.hours]) : null;
      if (hours === null && c.days !== undefined && _v70Num_(r[c.days]) !== null) hours = _v70Num_(r[c.days]) * 24;
      var ao = c.afterOpen !== undefined ? _v70Num_(r[c.afterOpen]) : null, mn = c.tmin !== undefined ? _v70Num_(r[c.tmin]) : null, mx = c.tmax !== undefined ? _v70Num_(r[c.tmax]) : null;
      var why = !src ? 'нет источника (колонка «Источник»)' : (hours === null && ao === null ? 'нет срока' : ((hours !== null && hours <= 0) || (ao !== null && ao <= 0) ? 'срок должен быть больше нуля' : (mn !== null && mx !== null && mn > mx ? 'температура «от» больше «до»' : '')));
      if (why) { tableRejected.push(t.file.Name + ', строка ' + (i + 2) + ': ' + why); return; }
      var kindTxt = c.kind !== undefined ? String(r[c.kind] || '') : '', modeTxt = c.mode !== undefined ? String(r[c.mode] || '') : '';
      var id = 'T-' + fileKey + '-' + (i + 2), quote = t.tbl.head.map(function (h, j) { return h + ': ' + (r[j] === undefined ? '' : r[j]); }).filter(function (x) { return !/: $/.test(x); }).join('; ');
      seen[id] = true; tableRows++;
      out.push(keep({ NormID: id, DocID: '', Ref: 'строка ' + (i + 2), Page: '', Domain: 'SHELF_LIFE', Object: name, Applies: src, Parameter: 'Срок годности' + (ao !== null ? ' / после вскрытия' : ''),
        Min: mn === null ? '' : mn, Max: mx === null ? '' : mx, Unit: '°C', Quote: quote, SourceFile: t.file.Name, SourceFileID: t.file.FileID, SourceURL: t.file.URL,
        ExtractedSHA256: _v70Hex_(Utilities.newBlob(quote).getBytes()), CurrentSHA256: _v70Hex_(Utilities.newBlob(quote).getBytes()), Origin: 'TABLE', Kind: _v70Kind_(kindTxt, name),
        Mode: _v70Mode_(modeTxt, mn, mx), Hours: hours === null ? '' : hours, AfterOpenHours: ao === null ? '' : ao, UpdatedAt: now }, old[id] && old[id].Quote === quote ? old[id] : (old[id] ? (function () { var p = JSON.parse(JSON.stringify(old[id])); if (p.Status === 'APPROVED') { _v70Revoke_(old[id]); } p.Status = 'DRAFT'; p.ApprovedSHA256 = ''; p.Comment = 'строка таблицы изменена — проверьте заново'; return p; })() : null)));
    });
  });
  Object.keys(old).forEach(function (k) {
    if (old[k].Origin !== 'TABLE' || seen[k]) return;
    var p = old[k]; if (p.Status === 'APPROVED') _v70Revoke_(p); p.Status = 'REMOVED'; p.UpdatedAt = now; out.push(p);
  });
  _v70Write_('NORMS', out);
  return { added: added, review: review, noFile: noFile, tableRows: tableRows, tableRejected: tableRejected };
}

/* ---------------- проверка и утверждение ---------------- */
function v70DecideNorm(json, token) {
  var op = null; try { op = _beginOp_(token, 'haccp|haccp_approve', 'V70_DECIDE', 'Нормативы', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), dec = String(d.decision || '').toUpperCase(), cm = String(d.comment || '').trim();
    if (['APPROVE', 'REJECT'].indexOf(dec) < 0) return _v70Fail_(op, 'VALIDATION', 'Решение: APPROVE или REJECT');
    return _withLock_(function () {
      var all = _v70Objs_('NORMS'), n = all.filter(function (x) { return String(x.NormID) === String(d.normId); })[0];
      if (!n) return _v70Fail_(op, 'NOT_FOUND', 'Норма не найдена — синхронизируйте папку');
      if (dec === 'REJECT' && !cm) return _v70Fail_(op, 'VALIDATION', 'Укажите, почему норма отклонена');
      if (dec === 'APPROVE') {
        if (['NO_FILE', 'REMOVED'].indexOf(n.Status) >= 0) return _v70Fail_(op, 'VALIDATION', 'Файла или строки с этой нормой больше нет в папке — утвердить нельзя');
        if (n.Status === 'APPROVED') return _v70Fail_(op, 'VALIDATION', 'Норма уже утверждена');
        if (n.Status === 'REVIEW' && !cm) return _v70Fail_(op, 'VALIDATION', 'Файл в папке изменился: укажите, что норма сверена с новым файлом');
      }
      var prev = n.Status, sh = _v70Sh_('NORMS'), h = MC_V70_H.NORMS, set = function (k, val) { sh.getRange(n._row, h.indexOf(k) + 1).setValue(val); n[k] = val; };
      set('Status', dec === 'APPROVE' ? 'APPROVED' : 'REJECTED'); set('Comment', cm); set('DecidedBy', _v70Who_(op)); set('DecidedAt', new Date());
      if (dec === 'APPROVE') { set('ApprovedSHA256', n.CurrentSHA256); set('AppliedTo', _v70Apply_(n)); } else { _v70Revoke_(n); set('AppliedTo', ''); }
      _audit_(op, 'V70_' + dec, MC_V70.NORMS, n.NormID, prev, { status: n.Status, comment: cm, sha: n.CurrentSHA256 }); _endOp_(op);
      return _ok_({ normId: n.NormID, status: n.Status, appliedTo: n.AppliedTo }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Где применяется утверждённая норма; строки таблицы сроков дополнительно становятся правилами V38. */
function _v70Apply_(n) {
  var where = { PRODUCT_TEMP: 'входной контроль: пределы температуры', SERVING_TEMP: 'ППК: готовая продукция', HOLDING_TIME: 'ППК: готовая продукция', PACKING_TEMP: 'ППК: технологические процессы',
    COOLING: 'ППК: технологические процессы', ROOM_TEMP: 'ППК: технологические процессы', LABEL: 'ППК: готовая продукция', SHELF_RULE: 'ППК: хранение', MICRO: 'ППК: лаборатория', JOURNAL: 'ППК: хранение' }[n.Domain] || '';
  if (n.Domain !== 'SHELF_LIFE') return where;
  var parts = [];
  if (n.Kind === 'RAW') parts.push('приёмка: «годен до»');
  else parts.push('этикетки и выпуск: срок, если в ТТК нет');
  if (_v70Num_(n.AfterOpenHours) !== null) parts.push('срок после вскрытия');
  try {
    if (typeof _v38Init_ === 'function') {
      _v38Init_(); var sh = _book_().getSheetByName(MC_V38.RULE), v = sh.getDataRange().getValues(), id = 'V70-' + n.NormID, row = 0;
      for (var i = 1; i < v.length; i++) if (String(v[i][0]) === id) row = i + 1;
      var hrs = _v70Num_(n.Hours), ao = _v70Num_(n.AfterOpenHours), mn = _v70Num_(n.Min), mx = _v70Num_(n.Max);
      var r = [id, 800, '', n.Kind === 'CATEGORY' ? n.Object : '', '', n.Kind === 'CATEGORY' ? '' : n.Object, n.Mode || '', mn === null ? '' : mn, mx === null ? '' : mx, hrs === null ? '' : hrs, hrs === null ? '' : hrs,
        false, '', '', '', false, ao === null ? '' : ao, 'База нормативов на Диске', n.SourceFile + ', ' + n.Ref + ': ' + n.Applies, new Date(), 'APPROVED', 'утверждено в «Нормативы: база на Диске»', new Date(), new Date()];
      if (row) sh.getRange(row, 1, 1, r.length).setValues([r]); else sh.appendRow(r);
      parts.push('правило сроков ' + id);
    }
  } catch (e) {}
  return parts.join('; ');
}
function _v70Revoke_(n) {
  try {
    if (n.Domain !== 'SHELF_LIFE' || typeof MC_V38 === 'undefined') return;
    var sh = _book_().getSheetByName(MC_V38.RULE); if (!sh) return;
    var v = sh.getDataRange().getValues(), id = 'V70-' + n.NormID;
    for (var i = 1; i < v.length; i++) if (String(v[i][0]) === id) { sh.getRange(i + 1, 21).setValue('REVOKED'); sh.getRange(i + 1, 24).setValue(new Date()); }
  } catch (e) {}
}
function _v70Approved_(domain) { return _v70Objs_('NORMS').filter(function (n) { return n.Status === 'APPROVED' && (!domain || n.Domain === domain); }); }

/** Неизвестный файл папки → документ реестра (из каталога или новый с номером и названием). */
function v70ClassifyFile(json, token) {
  var op = null; try { op = _beginOp_(token, 'haccp|system', 'V70_CLASSIFY', 'Нормативы', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    return _withLock_(function () {
      var f = _v70Objs_('FILES').filter(function (x) { return String(x.FileID) === String(d.fileId); })[0];
      if (!f) return _v70Fail_(op, 'NOT_FOUND', 'Файл не найден — синхронизируйте папку');
      var docId = String(d.docId || '').trim();
      if (!docId) {
        var num = String(d.number || '').trim(), title = String(d.title || '').trim();
        if (!num || !title) return _v70Fail_(op, 'VALIDATION', 'Укажите документ из списка или номер и название нового документа');
        docId = 'USR_' + _v70Norm_(num).toUpperCase().replace(/\s+/g, '_').slice(0, 40);
        var p = {}; try { p = JSON.parse(PropertiesService.getScriptProperties().getProperty('MC_NORMS_MANUAL_DOCS') || '{}'); } catch (e) {}
        p[docId] = { id: docId, number: num, title: title, cls: String(d.cls || 'OTHER'), status: String(d.status || 'ACTIVE'), mandatory: d.mandatory === true, from: String(d.from || ''), to: String(d.to || ''), note: 'классифицирован вручную' };
        PropertiesService.getScriptProperties().setProperty('MC_NORMS_MANUAL_DOCS', JSON.stringify(p));
      } else if (!(MC_V70_CATALOG_ || []).some(function (c) { return c.id === docId; }) && !_v70Manual_(docId)) return _v70Fail_(op, 'VALIDATION', 'Документа нет в каталоге');
      var sh = _v70Sh_('FILES'), h = MC_V70_H.FILES;
      sh.getRange(f._row, h.indexOf('DocID') + 1).setValue(docId); sh.getRange(f._row, h.indexOf('Recognition') + 1).setValue('MANUAL');
      _audit_(op, 'V70_CLASSIFY', MC_V70.FILES, f.FileID, f.DocID, { docId: docId }); _endOp_(op);
      return _ok_({ fileId: f.FileID, docId: docId, note: 'Синхронизируйте папку — документ появится в реестре со ссылкой на файл' }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- чтение ---------------- */
function v70GetBase(token) {
  try {
    _requireAuth_(token, 'haccp|haccp_view|haccp_approve|ppk_view|lab_view|audit_view|system');
    var fid = _v70FolderId_(), folder = null; if (fid) { try { var f = DriveApp.getFolderById(fid); folder = { id: fid, name: f.getName(), url: 'https://drive.google.com/drive/folders/' + fid }; } catch (e) { folder = { id: fid, name: '', url: '', error: 'папка не открывается' }; } }
    var files = _v70Objs_('FILES').map(function (x) { return { fileId: x.FileID, name: x.Name, size: x.Size, docId: x.DocID, doc: x.DocID ? _v70DocNum_(x.DocID) : '', recognition: x.Recognition, recognitionRu: MC_V70_REC_RU_[x.Recognition] || x.Recognition, duplicateOf: x.DuplicateOf, url: x.URL, note: x.Note, sha: String(x.SHA256 || '').slice(0, 12) }; });
    var norms = _v70Objs_('NORMS').map(function (n) { return { id: n.NormID, doc: n.DocID ? _v70DocNum_(n.DocID) : '', ref: n.Ref, page: n.Page, domain: n.Domain, domainRu: MC_V70_DOMAIN_RU_[n.Domain] || n.Domain, object: n.Object, applies: n.Applies,
      parameter: n.Parameter, value: n.Domain === 'SHELF_LIFE' ? [(n.Hours !== '' ? n.Hours + ' ч' : ''), (n.AfterOpenHours !== '' ? 'после вскрытия ' + n.AfterOpenHours + ' ч' : ''), (_v70ValueText_(n) ? 'хранение ' + _v70ValueText_(n) : '')].filter(String).join('; ') : _v70ValueText_(n),
      quote: n.Quote, file: n.SourceFile, url: n.SourceURL, origin: n.Origin, kind: n.Kind, status: n.Status, statusRu: MC_V70_STATUS_RU_[n.Status] || n.Status, comment: n.Comment, decidedBy: n.DecidedBy, appliedTo: n.AppliedTo, source: _v70Source_(n) }; });
    var cnt = function (st) { return norms.filter(function (n) { return n.status === st; }).length; };
    return _ok_({ folder: folder, files: files, norms: norms, catalog: (MC_V70_CATALOG_ || []).map(function (c) { return { id: c.id, number: c.number, title: c.title }; }),
      counts: { files: files.length, unknown: files.filter(function (x) { return x.recognition === 'UNKNOWN'; }).length, duplicates: files.filter(function (x) { return x.recognition === 'DUPLICATE'; }).length,
        draft: cnt('DRAFT'), approved: cnt('APPROVED'), review: cnt('REVIEW') + cnt('NO_FILE'), rejected: cnt('REJECTED') },
      tableColumns: ['Продукт / блюдо', 'Тип (сырьё / п/ф / блюдо / категория)', 'Режим (холодильник / морозильник / комнатная)', 'Температура от, °C', 'Температура до, °C', 'Срок годности, ч (или сут)', 'После вскрытия, ч', 'Источник'] });
  } catch (e) { return _failFrom_(e); }
}

/* ---------------- применение: входной контроль ---------------- */
var MC_V70_POULTRY_RE_ = /кур(ин|иц|а\b|ы\b|у\b)|цыпл|бройлер|птиц|индей|индюш|утк|утин|утят|гус(ь|ин|я)|перепел/i;
var MC_V70_MEAT_RE_ = /говя|свин|бара|телят|конин|ягнят|оленин|мяс|вырезк|окорок|корейк|грудинк|шейк|лопатк|антрекот|ребр|стейк|филе-миньон|субпрод|печень|печён|язык|почк|сердц/i;
var MC_V70_SEMI_RE_ = /фарш|котлет|биточ|тефтел|фрикадел|пельмен|манты|полуфабрикат|п\/ф|шашлык|голубц|зраз|наггет|бургер|рубленн|маринован/i;
/** Пределы температуры для входного контроля по утверждённым нормам: охлаждённое и замороженное отдельно; состояние — по названию. */
function _v70IncomingFor_(product) {
  var name = String(product || ''), ap = {};
  try { _v70Approved_('PRODUCT_TEMP').forEach(function (n) { ap[n.NormID] = n; }); } catch (e) { return null; }
  if (!Object.keys(ap).length) return null;
  var poultry = MC_V70_POULTRY_RE_.test(name), meat = !poultry && MC_V70_MEAT_RE_.test(name), semi = MC_V70_SEMI_RE_.test(name);
  if (!poultry && !meat && !(semi && /фарш|котлет|пельмен|шашлык/i.test(name))) return null;
  if (!poultry && !meat) meat = true;   // «фарш», «котлеты» без вида мяса — мясные полуфабрикаты ТР ТС 034
  var ids;
  if (poultry) {
    if (/механическ.*обвалк|\bмом\b/i.test(name)) ids = ['N-TREAES051-MOM-CH', 'N-TREAES051-MEAT-FR'];
    else if (/сыровял|сырокопч/i.test(name)) ids = ['N-TREAES051-RAWSMOKED-CH', 'N-TREAES051-OTHER-FR'];
    else if (/колбас|сосис|сардел|ветчин|рулет|копч|варен|запеч|кулинар/i.test(name)) ids = ['N-TREAES051-OTHER-CH', 'N-TREAES051-OTHER-FR'];
    else if (semi) ids = ['N-TREAES051-SEMI-CH', 'N-TREAES051-SEMI-FR'];
    else ids = ['N-TREAES051-MEAT-CH', 'N-TREAES051-MEAT-FR'];
  } else {
    if (semi) ids = ['N-TRTS034-SEMI-CH', 'N-TRTS034-SEMI-FR'];
    else if (/колбас|сосис|сардел|ветчин|бекон|копч|варен|запеч|кулинар|паштет/i.test(name)) ids = ['', 'N-TRTS034-PROD-FR'];
    else if (/субпрод|печень|печён|язык|почк|сердц/i.test(name)) ids = ['N-TRTS034-OFFAL-CH', ''];
    else ids = ['N-TRTS034-MEAT-CH', 'N-TRTS034-MEAT-FR'];
  }
  var pick = function (id) { var n = ap[id]; return n ? { id: n.NormID, min: _v70Num_(n.Min), max: _v70Num_(n.Max), label: n.Object + ': ' + _v70ValueText_(n), source: _v70Source_(n) } : null; };
  var ch = pick(ids[0]), fr = pick(ids[1]); if (!ch && !fr) return null;
  var st = /заморож|морожен|с\/м|быстрозамор|(^|[\s(])зам(\.|\s|$)/i.test(name) ? 'FROZEN' : (/охлажд|охл\./i.test(name) ? 'CHILLED' : '');
  return { group: poultry ? 'мясо птицы' : 'мясо', state: st, chilled: ch, frozen: fr, use: st === 'FROZEN' ? fr : (st === 'CHILLED' ? ch : null) };
}
function v70SuggestIncoming(product, token) {
  try { _requireAuth_(token, 'receiving|stock|haccp|haccp_view'); return _ok_({ product: String(product || ''), norm: _v70IncomingFor_(product) }); } catch (e) { return _failFrom_(e); }
}
// список входного контроля (Контроль партий) — с пределами из базы для каждой партии
(function () {
  if (typeof _bcControlList_ !== 'function') return;
  var orig = _bcControlList_;
  _bcControlList_ = function () {
    var out = orig.apply(this, arguments);
    try { ['quarantine', 'recheck'].forEach(function (k) { (out[k] || []).forEach(function (it) { it.norm = _v70IncomingFor_(it.product); }); }); } catch (e) {}
    return out;
  };
})();

/* ---------------- применение: сроки годности ---------------- */
function _v70ShelfRows_(kinds) { try { return _v70Approved_('SHELF_LIFE').filter(function (n) { return kinds.indexOf(n.Kind) >= 0; }); } catch (e) { return []; } }
function _v70Match_(rows, name, code, cat) {
  var nm = _v70Norm_(name), best = null, score = 0;
  rows.forEach(function (n) {
    var o = _v70Norm_(n.Object), s = 0;
    if (code && String(n.Object).trim() === String(code)) s = 1000;
    else if (o && o === nm) s = 900;
    else if (n.Kind === 'CATEGORY' && cat && o === _v70Norm_(cat)) s = 500;
    else if (o && n.Kind !== 'CATEGORY' && (' ' + nm + ' ').indexOf(' ' + o + ' ') >= 0) s = 600 + o.length;
    if (s > score) { score = s; best = n; }
  });
  return best;
}
/** Срок блюда / п/ф по утверждённой таблице сроков (для этикеток, если в карте ТТК срока нет). */
function _v70ShelfFor_(code) {
  try {
    var rows = _v70ShelfRows_(['DISH', 'SEMI', 'CATEGORY']).filter(function (n) { return _v70Num_(n.Hours) > 0; }); if (!rows.length) return null;
    var idx = _buildDishIndexes_(), d = idx.dishByCode[code]; if (!d) return null;
    var n = _v70Match_(rows, d.name, code, d.cat); if (!n) return null;
    return { hours: _v70Num_(n.Hours), src: 'база нормативов: «' + n.Object + '» — ' + _v70Source_(n), normId: n.NormID };
  } catch (e) { return null; }
}
/** Один раз читает таблицу сроков и возвращает (код, название, категория) → {hours, src} — для списков блюд. */
function _v70ShelfMatcher_() {
  var rows = _v70ShelfRows_(['DISH', 'SEMI', 'CATEGORY']).filter(function (n) { return _v70Num_(n.Hours) > 0; }); if (!rows.length) return null;
  return function (code, name, cat) { var n = _v70Match_(rows, name, code, cat); return n ? { hours: _v70Num_(n.Hours), src: 'база нормативов: «' + n.Object + '» — ' + _v70Source_(n) } : null; };
}
/** «Годен до» сырья при приёмке: утверждённая строка таблицы сроков раньше матрицы продуктов. */
(function () {
  if (typeof _mcRcvSuggestOne_ !== 'function') return;
  var orig = _mcRcvSuggestOne_;
  _mcRcvSuggestOne_ = function (name, from, x) {
    var rows = _v70ShelfRows_(['RAW']).filter(function (n) { return _v70Num_(n.Hours) > 0 && _v70Match_([n], name) ; });
    if (!rows.length) return x && x.db ? orig.apply(this, arguments) : { name: String(name || ''), found: false, modes: {}, mode: '' };
    var out = { name: String(name || ''), found: true, matched: 'база нормативов', method: 'таблица сроков на Диске', storage: '', modes: {}, mode: '', base: true, sources: [] };
    rows.forEach(function (n) {
      var h = _v70Num_(n.Hours), sh = h % 24 === 0 ? { n: h / 24, unit: 'd' } : { n: h, unit: 'h' }, u = _mcRcvUntil_(from, sh), m = n.Mode || 'fridge';
      if (out.modes[m]) return;
      out.modes[m] = { text: (sh.unit === 'd' ? sh.n + ' сут' : h + ' ч') + (_v70ValueText_(n) ? ' при ' + _v70ValueText_(n) : '') + ' — ' + _v70Source_(n), until: _mcRcvIso_(u.date, u.withTime), label: _mcRcvFmt_(u.date, u.withTime), withTime: u.withTime, hours: u.hours };
      out.sources.push(_v70Source_(n)); out.matched = '«' + n.Object + '» (база нормативов)';
    });
    out.mode = _mcRcvDefaultMode_('', name, out.modes);
    return out;
  };
})();

/* ---------------- применение: ППК ---------------- */
(function () {
  if (typeof _v65SectionText_ !== 'function') return;
  var orig = _v65SectionText_;
  var MAP = { INCOMING: ['PRODUCT_TEMP'], PROCESS: ['COOLING', 'PACKING_TEMP', 'ROOM_TEMP'], FINISHED: ['SERVING_TEMP', 'HOLDING_TIME', 'LABEL'], STORAGE: ['JOURNAL', 'SHELF_RULE'], LAB: ['MICRO'] };
  _v65SectionText_ = function (code, D, ppk, acts) {
    var t = orig.apply(this, arguments);
    try {
      var doms = MAP[code]; if (!doms) return t;
      var ns = _v70Objs_('NORMS').filter(function (n) { return n.Status === 'APPROVED' && doms.indexOf(n.Domain) >= 0; });
      var shelf = code === 'STORAGE' ? _v70Approved_('SHELF_LIFE').length : 0;
      if (!ns.length && !shelf) return t;
      t += '\n\nНормы из базы нормативов (утверждены ответственным за ХАССП):\n' + ns.map(function (n, i) { return (i + 1) + '. ' + n.Object + ' — ' + n.Parameter.toLowerCase() + (_v70ValueText_(n) ? ': ' + _v70ValueText_(n) : '') + ' (' + _v70Source_(n) + ')'; }).join('\n');
      if (shelf) t += (ns.length ? '\n' : '') + 'Сроки годности продукции предприятия — по утверждённой таблице сроков на Диске: ' + shelf + ' строк.';
    } catch (e) {}
    return t;
  };
})();
