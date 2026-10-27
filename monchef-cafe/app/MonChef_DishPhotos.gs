/**
 * MON CHEF — фото блюд: сопоставление с ТТК (после этапа 10.8).
 *
 * Раньше фото находилось только по имени файла в корне папки «Фото блюд»: имя = код блюда, название
 * или имя файла ТТК, дословно. Меню с Диска (папка «МЕНЮ» с разделами, имена с граммовками и пометками
 * «нов», «заказ от…») система не видела.
 * Теперь:
 *   • папка «Фото блюд» просматривается со всеми подпапками;
 *   • блюдо подбирается по названию без граммовок, пометок, скобок, ё/е; сокращения ТТК («Тел.вырезка»,
 *     «зелен фасолью») сравниваются по началу слова;
 *   • связь «блюдо → фото» подтверждает человек (уверенные пары — одной кнопкой, сомнительные — выбором
 *     из 3 блюд) и хранится в листе «Фото_Блюд»; файлы не переименовываются и не переносятся;
 *   • большое фото для карточки уменьшается (копия в «Фото блюд / _для карточки»), оригинал не меняется;
 *   • getPhoto отдаёт только фото блюд (раньше — любой файл Диска владельца по ID).
 * Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович
 */
var MC_DP_SHEET_ = 'Фото_Блюд';
var MC_DP_HEAD_ = ['Код блюда', 'Блюдо', 'FileID', 'Файл', 'Папка', 'Способ', 'Кто', 'Когда', 'Активно', 'Для карточки FileID', 'Размер, КБ'];
var MC_DP_PREVIEW_DIR_ = '_для карточки';
var MC_DP_BIG_ = 700 * 1024;          // больше — для карточки делается уменьшенная копия
var MC_DP_PREVIEW_PX_ = 1280;
var MC_DP_OK_ = /^image\/(jpeg|jpg|pjpeg|png|webp|gif)$/i;
var MC_DP_STOP_ = ['для', 'под', 'при', 'без', 'над', 'или', 'шт', 'гр', 'кг', 'мл', 'порц', 'порций', 'банкет', 'банк', 'нов', 'новый', 'заказ', 'минимальный'];

function _dpSheet_() {
  var ss = _book_(), sh = ss.getSheetByName(MC_DP_SHEET_);
  if (!sh) { sh = ss.insertSheet(MC_DP_SHEET_); sh.appendRow(MC_DP_HEAD_); sh.setFrozenRows(1); }
  return sh;
}
function _dpRows_() {
  var sh = _book_().getSheetByName(MC_DP_SHEET_); if (!sh) return [];
  return sh.getDataRange().getValues().slice(1).map(function (r, i) {
    return { row: i + 2, code: String(r[0] || ''), name: String(r[1] || ''), fileId: String(r[2] || ''), file: String(r[3] || ''), folder: String(r[4] || ''), how: String(r[5] || ''),
      who: String(r[6] || ''), at: r[7], active: r[8] === true || String(r[8]).toUpperCase() === 'TRUE', preview: String(r[9] || ''), kb: Number(r[10]) || 0 };
  }).filter(function (x) { return x.code && x.fileId; });
}
/** Действующие связи: код блюда → {fileId, preview}. Кэш 5 минут, сбрасывается при каждой привязке. */
function _dpLinked_() {
  var cache = null; try { cache = CacheService.getScriptCache(); var hit = cache.get('mc_dp_links'); if (hit) return JSON.parse(hit); } catch (e) {}
  var map = {}; _dpRows_().forEach(function (x) { if (x.active) map[x.code] = { fileId: x.fileId, preview: x.preview }; });
  try { if (cache) cache.put('mc_dp_links', JSON.stringify(map), 300); } catch (e) {}
  return map;
}
/** Сбросить кэш связей после привязки. Список файлов папки от привязки не меняется; tree — в папку добавлен файл
    (фото из карточки): экран перечитает папку с Диска. */
function _dpDropCache_(tree) { try { CacheService.getScriptCache().remove('mc_dp_links'); if (tree) CacheService.getScriptCache().remove('mc_dp_tree_full'); } catch (e) {} try { if (typeof uiDropPhotoCache_ === 'function') uiDropPhotoCache_(); } catch (e) {} }
/** Фото блюда для карточки и списков: сначала подтверждённая связь, потом прежний поиск по имени файла. */
function _dpPhotoOf_(code, name, file, pmap) {
  var l = _dpLinked_()[String(code || '')]; if (l) return l.fileId;
  pmap = pmap || (typeof _uiPhotoMap_ === 'function' ? _uiPhotoMap_() : {});
  return pmap[_dpNorm_(code)] || pmap[_dpNorm_(name)] || (file ? pmap[_dpNorm_(file)] : '') || '';
}

/* ---------- сравнение названий ---------- */
/** Как прежний поиск фото по имени файла (norm в Code.gs): регистр, расширение, пробелы. Своя копия — norm
    вызывается и со страниц, поэтому шлюз требует для неё вход; модулю фото это не нужно. */
function _dpNorm_(s) { return String(s || '').toLowerCase().replace(/\.(xls|xlsx|jpg|jpeg|png|webp)$/i, '').replace(/\s+/g, ' ').trim(); }
/** «Дорада с овощами Мон Шер 300гр нов (1).JPG» → «дорада с овощами мон шер». */
function _dpClean_(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\.[a-z0-9]{2,5}$/i, ' ')
    .replace(/№\s*(\d+)/g, ' nr$1 ')   // номер набора («Детский сэт №2») — часть названия
    .replace(/\([^)]*\)?/g, ' ').replace(/(^|[^а-яa-z])п\s*\/\s*ф(?=[^а-яa-z]|$)/g, ' ')
    .replace(/(^|[^а-яa-z])нов\d*(?=[^а-яa-z]|$)/g, ' ').replace(/нов(?=\d)/g, ' ')
    .replace(/(^|[^a-z0-9])\d+[\d\s.,\/xх×]*\s*(гр|гп|г|кг|шт|л|мл|см)?(?=[^а-яa-z]|$)/g, ' ')
    .replace(/[«»"'`.,;:!?№#*_+=\-\/\\]/g, ' ').replace(/\s+/g, ' ').trim();
}
function _dpWords_(s) { return _dpClean_(s).split(' ').filter(function (w) { return w.length >= 3 && MC_DP_STOP_.indexOf(w) < 0; }); }
/** Насколько совпадают слова (a — из имени фото, b — из названия блюда), 0…1: одинаковые или общие первые
    5 букв (падежи) — 1; слово блюда — начало слова фото (сокращение ТТК «тел» → «телячья», от 3 букв) — 1;
    слово фото — начало слова блюда: от 5 букв — 1, из 3–4 букв — 0,5 («морс» — ещё не «морское»). */
function _dpHit_(a, b) {
  if (a === b) return 1;
  if (b.length >= 3 && b.length < a.length && a.indexOf(b) === 0) return 1;
  if (a.length >= 3 && a.length < b.length && b.indexOf(a) === 0) return a.length >= 5 ? 1 : 0.5;
  return a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5) ? 1 : 0;
}
/** Склеить соседние слова, если вместе они — слово другого названия («фуа гра» = «фуагра»). */
function _dpJoin_(ws, other) {
  var out = [];
  for (var i = 0; i < ws.length; i++) { if (i + 1 < ws.length && other.indexOf(ws[i] + ws[i + 1]) >= 0) { out.push(ws[i] + ws[i + 1]); i++; } else out.push(ws[i]); }
  return out;
}
/** Общие слова меню («ассорти», «салат», «соус»…) весят меньше: одно общее слово не делает блюда похожими. */
var MC_DP_GENERIC_ = ['ассор', 'салат', 'соус', 'плато', 'сэт', 'сет', 'суп', 'хлеб', 'закус', 'десер', 'блюдо', 'мини', 'домаш', 'свежи', 'свежа'];
function _dpW_(w) { return MC_DP_GENERIC_.some(function (g) { return w.indexOf(g) === 0; }) ? 0.35 : 1; }
/** Сходство 0…1 (взвешенный Дайс по словам). */
function _dpScore_(pw, dw) {
  if (!pw.length || !dw.length) return 0;
  var p2 = _dpJoin_(pw, dw), d2 = _dpJoin_(dw, pw); pw = p2; dw = d2;
  var used = {}, m = 0, tp = 0, td = 0;
  pw.forEach(function (a) {
    tp += _dpW_(a); var best = 0, bj = -1;
    for (var j = 0; j < dw.length; j++) if (!used[j]) { var h = _dpHit_(a, dw[j]); if (h > best) { best = h; bj = j; if (h === 1) break; } }
    if (bj >= 0) { used[bj] = 1; m += best * Math.min(_dpW_(a), _dpW_(dw[bj])); }
  });
  dw.forEach(function (w) { td += _dpW_(w); });
  return Math.round(2 * m / (tp + td) * 100) / 100;
}
function _dpDishes_() {
  var sh = _book_().getSheetByName('Блюда'), v = sh ? sh.getDataRange().getValues() : [], arch = typeof _ttkArchived_ === 'function' ? _ttkArchived_() : {};
  var out = [];
  for (var i = 1; i < v.length; i++) {
    var code = String(v[i][0] || '').trim(), name = String(v[i][1] || '').trim(); if (!code || !name || arch[code]) continue;
    out.push({ code: code, name: name, file: String(v[i][6] || ''), semi: /п\s*\/\s*ф/i.test(name), words: _dpWords_(name), clean: _dpClean_(name) });
  }
  return out;
}

/* ---------- папка «Фото блюд» со всеми подпапками ---------- */
/** Список файлов папки. После привязки экран перечитывает его из кэша (10 минут), «Проверить папку снова» — с Диска. */
function _dpTree_(fresh) {
  if (!fresh) try { var hit = CacheService.getScriptCache().get('mc_dp_tree_full'); if (hit) return JSON.parse(hit); } catch (e) {}
  var out = [], q = [{ f: DriveApp.getFolderById(PHOTO_FOLDER_ID), path: '', depth: 0 }];
  while (q.length) {
    var it = q.shift(), files = it.f.getFiles();
    while (files.hasNext()) {
      var f = files.next(); if (f.isTrashed && f.isTrashed()) continue;
      out.push({ id: f.getId(), name: f.getName(), mime: String(f.getMimeType() || ''), size: Number(f.getSize()) || 0, folder: it.path });
    }
    if (it.depth >= 6) continue;
    var subs = it.f.getFolders();
    while (subs.hasNext()) { var s = subs.next(); if (s.getName() === MC_DP_PREVIEW_DIR_) continue; q.push({ f: s, path: (it.path ? it.path + ' / ' : '') + s.getName(), depth: it.depth + 1 }); }
  }
  try { CacheService.getScriptCache().put('mc_dp_tree', JSON.stringify(out.map(function (x) { return x.id; })), 21600); } catch (e) {}
  try { CacheService.getScriptCache().put('mc_dp_tree_full', JSON.stringify(out), 600); } catch (e) {}   // больше 100 КБ — не кэшируется, читается с Диска
  return out;
}
/** Файл лежит в «Фото блюд» (с подпапками) или записан в реестре фото — только такие отдаёт getPhoto. */
function _dpAllowed_(fileId) {
  fileId = String(fileId || ''); if (!fileId) return false;
  try { var ids = CacheService.getScriptCache().get('mc_dp_tree'); if (ids && JSON.parse(ids).indexOf(fileId) >= 0) return true; } catch (e) {}
  try { var pm = typeof _uiPhotoMap_ === 'function' ? _uiPhotoMap_() : {}; for (var k in pm) if (pm[k] === fileId) return true; } catch (e) {}   // корень папки (кэш 5 мин)
  if (_dpRows_().some(function (x) { return x.fileId === fileId || x.preview === fileId; })) return true;
  try {   // подняться по папкам-родителям до «Фото блюд» (не глубже 8 уровней)
    var frontier = [], seen = {}, p0 = DriveApp.getFileById(fileId).getParents();
    while (p0.hasNext()) frontier.push(p0.next());
    for (var d = 0; d < 8 && frontier.length; d++) {
      var next = [];
      for (var i = 0; i < frontier.length; i++) {
        var id = frontier[i].getId(); if (id === PHOTO_FOLDER_ID) return true;
        if (seen[id]) continue; seen[id] = 1;
        var pp = frontier[i].getParents(); while (pp.hasNext()) next.push(pp.next());
      }
      frontier = next;
    }
  } catch (e) {}
  return false;
}

/* ---------- подбор ---------- */
/**
 * Разложить фото по группам:
 *   sure — уверенная пара (код в имени, совпадение названия или сходство ≥ 0,8 с отрывом ≥ 0,15 от второго блюда);
 *   doubt — есть похожие блюда (сходство ≥ 0,4): выбор из 3;
 *   dup — несколько фото подходят одному блюду: выбрать одно;
 *   none — пары нет (напитки, услуги, блюда без ТТК) — можно выбрать блюдо вручную;
 *   bad — формат не показывается в браузере (HEIC, AVIF, TIFF…);
 *   linked — уже привязано.
 */
function _dpMatch_(files, dishes, links) {
  var byCode = {}, byNorm = {}, linkedFile = {};
  dishes.forEach(function (d) { byCode[d.code.toLowerCase()] = d; byNorm[_dpNorm_(d.name)] = d; if (d.file) byNorm[_dpNorm_(d.file)] = d; });
  Object.keys(links).forEach(function (k) { linkedFile[links[k].fileId] = k; });
  var dishName = {}; dishes.forEach(function (d) { dishName[d.code] = d.name; });
  var res = { sure: [], doubt: [], dup: [], none: [], bad: [], linked: [] };
  var items = files.map(function (f) {
    var base = { fileId: f.id, file: f.name, folder: f.folder, kb: Math.round(f.size / 1024), mime: f.mime };
    if (linkedFile[f.id]) { base.code = linkedFile[f.id]; base.dish = dishName[base.code] || base.code; base.group = 'linked'; return base; }
    if (!MC_DP_OK_.test(f.mime)) { base.group = 'bad'; base.why = (f.name.match(/\.([a-z0-9]+)$/i) || ['', f.mime])[1].toUpperCase() + ' не показывается в браузере — сохраните в JPG'; return base; }
    var stem = String(f.name).replace(/\.[a-z0-9]{2,5}$/i, '').trim(), d0 = byCode[stem.toLowerCase()] || byNorm[_dpNorm_(f.name)];
    if (d0) { base.cands = [{ code: d0.code, name: d0.name, score: 1 }]; base.group = 'sure'; base.how = byCode[stem.toLowerCase()] ? 'по коду' : 'по названию'; return base; }
    var pw = _dpWords_(f.name), pc = _dpClean_(f.name), sc = [];
    dishes.forEach(function (d) {
      var s = pc && pc === d.clean ? 1 : _dpScore_(pw, d.words);
      if (d.semi) s = Math.max(0, s - 0.1);   // фото — обычно готового блюда, а не п/ф
      if (s >= 0.4) sc.push({ code: d.code, name: d.name, score: Math.round(s * 100) / 100 });
    });
    sc.sort(function (a, b) { return b.score - a.score || a.name.length - b.name.length; });
    base.cands = sc.slice(0, 3);
    if (!sc.length) { base.group = 'none'; return base; }
    base.group = sc[0].score >= 0.8 && (sc.length < 2 || sc[0].score - sc[1].score >= 0.15) ? 'sure' : 'doubt';
    base.how = 'по сходству названия';
    return base;
  });
  // одно блюдо — несколько фото (уверенных или лучших сомнительных): выбрать одно
  var byDish = {};
  items.forEach(function (x) { if ((x.group === 'sure' || x.group === 'doubt') && x.cands && x.cands[0] && x.cands[0].score >= 0.6) (byDish[x.cands[0].code] = byDish[x.cands[0].code] || []).push(x); });
  Object.keys(byDish).forEach(function (code) {
    var xs = byDish[code]; if (xs.length < 2 || !xs.some(function (x) { return x.group === 'sure'; })) return;
    res.dup.push({ code: code, dish: dishName[code] || code, current: links[code] ? links[code].fileId : '', photos: xs.map(function (x) { x.group = 'dup'; return { fileId: x.fileId, file: x.file, folder: x.folder, kb: x.kb, score: x.cands[0].score }; }) });
  });
  items.forEach(function (x) {
    if (x.group === 'dup') return;
    if ((x.group === 'sure' || x.group === 'doubt') && links[x.cands[0].code]) x.replaces = true;   // у блюда уже есть другое фото
    res[x.group].push(x);
  });
  return res;
}
/** Проверить папку и подобрать блюда. Права — как у загрузки фото в карточке. */
function mcDishPhotoScan(token, fresh) {
  try {
    _requireAuth_(token, 'ttk_edit');
    var t0 = Date.now(), files = _dpTree_(fresh === true || fresh === 'true' || fresh === 1), dishes = _dpDishes_(), links = _dpLinked_();
    var r = _dpMatch_(files, dishes, links), withPhoto = {};
    Object.keys(links).forEach(function (k) { withPhoto[k] = 1; });
    var pmap = typeof _uiPhotoMap_ === 'function' ? _uiPhotoMap_() : {};
    dishes.forEach(function (d) { if (!withPhoto[d.code] && (pmap[_dpNorm_(d.code)] || pmap[_dpNorm_(d.name)] || (d.file && pmap[_dpNorm_(d.file)]))) withPhoto[d.code] = 1; });
    return _ok_({ groups: r, stats: { files: files.length, dishes: dishes.length, withPhoto: Object.keys(withPhoto).length, sure: r.sure.length, doubt: r.doubt.length, dup: r.dup.length, none: r.none.length, bad: r.bad.length, linked: r.linked.length, ms: Date.now() - t0 },
      dishes: dishes.map(function (d) { return { code: d.code, name: d.name }; }) });
  } catch (e) { return _failFrom_(e); }
}
/** Подтвердить связи: [{code, fileId}] — до 300 за раз. Прежняя связь блюда снимается (остаётся в листе как неактивная). */
function mcDishPhotoLink(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'ttk_edit', 'DISH_PHOTO_LINK', 'ТТК', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var list = typeof json === 'string' ? JSON.parse(json || '[]') : (json || []); if (!Array.isArray(list)) list = [list];
    list = list.filter(function (x) { return x && x.code && x.fileId; }).slice(0, 300);
    if (!list.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Нет пар «блюдо — фото»', op.id); }
    var dishes = {}; _dpDishes_().forEach(function (d) { dishes[d.code] = d; });
    var bad = list.filter(function (x) { return !dishes[x.code]; }).map(function (x) { return x.code; });
    if (bad.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Нет таких блюд (или карта в архиве): ' + bad.slice(0, 5).join(', '), op.id); }
    var meta = {}, notAllowed = [];
    list.forEach(function (x) {
      if (!_dpAllowed_(x.fileId)) { notAllowed.push(x.fileId); return; }
      try { var f = DriveApp.getFileById(x.fileId), mime = String(f.getMimeType() || ''); if (!MC_DP_OK_.test(mime)) { notAllowed.push(f.getName() + ' (' + mime + ')'); return; }
        var p = f.getParents(); meta[x.fileId] = { name: f.getName(), folder: p.hasNext() ? p.next().getName() : '', kb: Math.round((Number(f.getSize()) || 0) / 1024) }; } catch (e) { notAllowed.push(x.fileId); }
    });
    if (notAllowed.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Это не фото из папки «Фото блюд» или формат не показывается: ' + notAllowed.slice(0, 5).join(', '), op.id); }
    var who = _author_(op).фио, now = new Date(), done = [];
    _withLock_(function () {
      var sh = _dpSheet_(), rows = _dpRows_();
      list.forEach(function (x) {
        rows.filter(function (r) { return r.code === x.code && r.active; }).forEach(function (r) { if (r.fileId !== x.fileId) sh.getRange(r.row, 9).setValue(false); });
        if (rows.some(function (r) { return r.code === x.code && r.active && r.fileId === x.fileId; })) return;   // уже привязано
        var m = meta[x.fileId];
        sh.appendRow([x.code, dishes[x.code].name, x.fileId, m.name, m.folder, String(x.how || 'подтверждено'), who, now, true, '', m.kb]);
        done.push({ code: x.code, dish: dishes[x.code].name, file: m.name });
      });
    });
    _dpDropCache_();
    _audit_(op, 'DISH_PHOTO_LINK', 'ТТК', done.length === 1 ? done[0].code : '', null, { linked: done.length, items: done.slice(0, 40) });
    _endOp_(op);
    return _ok_({ linked: done.length, items: done }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Снять фото с блюда (файл на Диске остаётся). */
function mcDishPhotoUnlink(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'ttk_edit', 'DISH_PHOTO_UNLINK', 'ТТК', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), code = String(d.code || ''), n = 0;
    _withLock_(function () { var sh = _dpSheet_(); _dpRows_().forEach(function (r) { if (r.code === code && r.active) { sh.getRange(r.row, 9).setValue(false); n++; } }); });
    _dpDropCache_();
    _audit_(op, 'DISH_PHOTO_UNLINK', 'ТТК', code, null, { removed: n });
    _endOp_(op);
    return _ok_({ code: code, removed: n }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Миниатюры для экрана сопоставления: до 24 фото за вызов, только из папки фото блюд. */
function mcDishPhotoThumbs(json, token) {
  try {
    _requireAuth_(token, 'ttk_edit');
    var ids = (typeof json === 'string' ? JSON.parse(json || '[]') : (json || [])).slice(0, 24), out = {};
    ids.forEach(function (id) { if (!_dpAllowed_(id)) return; var u = _dpResized_(id, 240); if (u) out[id] = u; });
    return _ok_(out);
  } catch (e) { return _failFrom_(e); }
}
/** Уменьшенная копия через миниатюру Диска (=sNNN); не получилось — DriveApp.getThumbnail(); иначе пусто. */
function _dpResized_(fileId, px) {
  try {
    var tok = ScriptApp.getOAuthToken(), h = { headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true };
    var meta = JSON.parse(UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?fields=thumbnailLink', h).getContentText() || '{}');
    if (meta.thumbnailLink) {
      var r = UrlFetchApp.fetch(String(meta.thumbnailLink).replace(/=s\d+(-[a-z0-9-]+)?$/i, '') + '=s' + px, h);
      if (r.getResponseCode() === 200) { var b = r.getBlob(); return 'data:' + (b.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(b.getBytes()); }
    }
  } catch (e) {}
  if (px <= 400) try { var t = DriveApp.getFileById(fileId).getThumbnail(); if (t) return 'data:' + (t.getContentType() || 'image/png') + ';base64,' + Utilities.base64Encode(t.getBytes()); } catch (e) {}
  return '';
}
/** Фото для карточки: у большого (> 700 КБ) делается и запоминается уменьшенная копия; оригинал не меняется. */
function _dpForCard_(fileId) {
  var row = _dpRows_().filter(function (x) { return x.fileId === fileId && x.active; })[0];
  if (!row) return fileId;   // копия делается только для подтверждённой связи — иначе плодились бы копии при каждом открытии
  if (row.preview) return row.preview;
  var f = DriveApp.getFileById(fileId); if ((Number(f.getSize()) || 0) <= MC_DP_BIG_) return fileId;
  var u = _dpResized_(fileId, MC_DP_PREVIEW_PX_); if (!u) return fileId;
  try {
    var m = u.match(/^data:([^;]+);base64,(.*)$/), root = DriveApp.getFolderById(PHOTO_FOLDER_ID), it = root.getFoldersByName(MC_DP_PREVIEW_DIR_), dir = it.hasNext() ? it.next() : root.createFolder(MC_DP_PREVIEW_DIR_);
    var pf = dir.createFile(Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], 'для карточки ' + f.getName().replace(/\.[a-z0-9]+$/i, '') + '.jpg'));
    var use = pf.getId();
    _withLock_(function () {   // двое открыли одно фото одновременно — остаётся одна копия
      var cur = _dpRows_().filter(function (x) { return x.row === row.row; })[0];
      if (cur && cur.preview) { use = cur.preview; try { pf.setTrashed(true); } catch (e) {} } else _dpSheet_().getRange(row.row, 10).setValue(use);
    });
    _dpDropCache_();
    return use;
  } catch (e) { return fileId; }
}
