/**
 * MON CHEF V78 — структура папок на Google Диске: где какие документы лежат.
 *
 * Как устроено (по образцу папки ТТК: папка = раздел, подпапка = категория, файлы читаются системой):
 *   корень — «Mon Chef — Документы» (прежняя общая папка, свойство DOCS_FOLDER_ID);
 *   внутри — пронумерованные разделы MC_V78_DIRS_ (ТТК, нормативы, документы предприятия, ППК, поставщики, лаборатория,
 *   журналы, отчёты, персонал, банкеты, фото, архив …). Создаются шагом миграции 15 («установка») и при первом обращении.
 *   Реестр — лист «Папки_Системы» и свойства MC_FOLDER_<ключ>; модули, у которых было своё свойство папки (MC_PPK_FOLDER_ID и
 *   др.), получают тот же ID — их код не меняется. Папки, заданные в коде постоянными ID (ТТК, фото, бланки, накладные), берутся
 *   из реестра: на новом предприятии прежние ID недоступны — создаётся своя папка; у вас прежние папки остаются.
 *   Уже существующие папки (прежние названия в корне Диска) регистрируются как есть; «Собрать в общую папку» переносит их внутрь
 *   (ID и содержимое не меняются) — только по кнопке.
 *   Чтение: «Обновить список файлов» обходит разделы (до 3 уровней) и пишет лист «Папки_Файлы»: файл, раздел, путь, тип,
 *   размер, дата, внесён ли он в реестр документов. Экран «Папки и документы» показывает разделы и файлы; персонал — только
 *   с правом на медкнижки и сотрудников.
 */
var MC_V78_REG_ = 'Папки_Системы', MC_V78_FILES_ = 'Папки_Файлы';
var MC_V78_REG_HEAD_ = ['Ключ', 'Раздел', 'Что лежит', 'Родитель', 'FolderID', 'Источник', 'На своём месте', 'Файлов', 'Подпапок', 'Обновлено', 'Изменил'];
var MC_V78_FILES_HEAD_ = ['Ключ', 'Путь', 'Файл', 'FileID', 'Тип', 'Размер, КБ', 'Изменён', 'Ссылка', 'В реестре документов'];
// [ключ, название, что лежит, родитель, прежнее: { prop, const, name }]
var MC_V78_DIRS_ = [
  ['ttk', '01 ТТК', 'Технологические карты: подпапка — категория блюд, файл — карточка. Система читает их при синхронизации ТТК.', '', { prop: 'MC_TTK_FOLDER_ID', konst: 'TTK_FOLDER_ID' }],
  ['norms', '02 Нормативы', 'СанПиН, ТР ТС, ГОСТ и другие нормативные документы — «База нормативов».', '', { prop: 'MC_NORMS_FOLDER_ID' }],
  ['company', '03 Документы предприятия', 'Договоры, свидетельства, лицензии, охрана труда, реквизиты — по подпапкам.', '', {}],
  ['org', 'Реквизиты и логотип', 'Логотип и файлы реквизитов организации.', 'company', { prop: 'MC_ORG_FOLDER_ID' }],
  ['contracts', 'Договоры', 'Договоры с поставщиками, 3-Д, вывоз отходов, лаборатория.', 'company', {}],
  ['licenses', 'Свидетельства и лицензии', 'Регистрационные документы, уведомления, разрешения.', 'company', {}],
  ['labor', 'Охрана труда', 'Инструкции и приказы по охране труда (категория реестра «Охрана труда»).', 'company', {}],
  ['ttkdocs', 'ТТК — документы', 'Утверждённые ТТК в PDF (категория реестра «ТТК»).', 'company', {}],
  ['ppk', '04 ППК и ХАССП', 'Программа производственного контроля, план ХАССП, порядок отзыва, порядок действий при ЧС.', '', { prop: 'MC_PPK_FOLDER_ID' }],
  ['tu', '05 Технические условия', 'ТУ на собственную продукцию.', '', { prop: 'MC_TU_FOLDER_ID' }],
  ['suppliers', '06 Поставщики и сырьё', 'Документы по приёмке сырья.', '', {}],
  ['invoices', 'Накладные', 'Фото и сканы накладных и чеков приёмки.', 'suppliers', { konst: 'INVOICES_FOLDER_ID', name: 'Накладные' }],
  ['supply', 'Сертификаты и декларации', 'Декларации, сертификаты, удостоверения качества на сырьё.', 'suppliers', { name: 'Документы на сырьё Mon Chef' }],
  ['lab', '07 Лаборатория', 'Протоколы лабораторных исследований.', '', { prop: 'MC_LAB_FOLDER_ID' }],
  ['journals', '08 Журналы', 'Журналы по месяцам.', '', { prop: 'MC_JF_DRIVE_ROOT_ID', name: 'MON CHEF — Журналы' }],
  ['journalsCat', 'По категориям', 'Выгрузки журналов по категориям и их архив.', 'journals', { name: 'Журналы Mon Cher' }],
  ['signed', 'Подписанные журналы', 'Журналы с подписями.', 'journals', { prop: 'MC_SIGNED_FOLDER_ID' }],
  ['reports', '09 Отчёты', 'PDF-отчёты системы: отзыв, этикетки поверки, отчёты о ЧС и др.', '', { prop: 'MC_REPORTS_FOLDER_ID' }],
  ['opforms', '10 Документы ОП', 'Унифицированные формы ОП-3 … ОП-23.', '', { prop: 'MC_V72_FOLDER_ID' }],
  ['staff', '11 Персонал', 'Медкнижки, удостоверения, обучение. Персональные данные — доступ ограничен.', '', {}],
  ['banquets', '12 Банкеты', 'Бланки заявок банкетов: фото и сканы.', '', { konst: 'BLANKS_FOLDER_ID', name: 'Бланки заявок' }],
  ['photos', '13 Фото блюд', 'Фотографии блюд для ТТК и меню.', '', { prop: 'MC_PHOTO_FOLDER_ID', konst: 'PHOTO_FOLDER_ID' }],
  ['archive', '14 Архив', 'Архив записей по месяцам.', '', { prop: 'MC_V8_ARCHIVE_ROOT_ID', name: 'MON CHEF — Архив' }],
  ['packages', '15 Пакеты для проверки', 'Комплекты документов для проверяющих.', '', { prop: 'MC_INSPECTION_PACKAGE_FOLDER_ID', name: 'Mon Chef — Пакеты проверки' }],
  ['backups', '16 Резервные копии', 'Копии рабочей таблицы.', '', { name: 'Бэкапы Mon Chef' }],
  ['exports', '17 Выгрузки', 'Выгрузки таблиц.', '', { name: 'Выгрузки Mon Cher' }],
  ['tmp', '99 Служебное', 'Временные копии для распознавания — можно очищать.', '', { prop: 'MC_TMP_FOLDER_ID' }]
];
// категория реестра документов → раздел
var MC_V78_DOCCAT_ = { 'ТТК': 'ttkdocs', 'Охрана труда': 'labor', 'Журналы': 'journals', 'ППК': 'ppk', 'Декларации': 'supply' };
var MC_V78_VIEW_ = 'documents|haccp|system', MC_V78_SETUP_ = 'system|archive|documents', MC_V78_ADMIN_ = 'system|archive', MC_V78_STAFF_ = 'personnel|medical_view|system';

// Папки, заданные в коде постоянными ID, — из реестра. Apps Script выполняет общий код файлов при каждом вызове,
// поэтому подстановка срабатывает до любого обработчика (одно чтение свойств).
function _v78ApplyIds_() {
  try {
    var p = PropertiesService.getScriptProperties().getProperties();
    if (p.MC_FOLDER_ttk) TTK_FOLDER_ID = p.MC_FOLDER_ttk;
    if (p.MC_FOLDER_photos) PHOTO_FOLDER_ID = p.MC_FOLDER_photos;
    if (p.MC_FOLDER_banquets) BLANKS_FOLDER_ID = p.MC_FOLDER_banquets;
    if (p.MC_FOLDER_invoices) INVOICES_FOLDER_ID = p.MC_FOLDER_invoices;
  } catch (e) {}
}
_v78ApplyIds_();

function _v78Dir_(key) { for (var i = 0; i < MC_V78_DIRS_.length; i++) if (MC_V78_DIRS_[i][0] === key) return MC_V78_DIRS_[i]; return null; }
function _v78Props_() { return PropertiesService.getScriptProperties(); }
function _v78Open_(id) { if (!id) return null; try { var f = DriveApp.getFolderById(String(id)); return f && !(f.isTrashed && f.isTrashed()) ? f : null; } catch (e) { return null; } }
function _v78Konst_(name) { try { return { TTK_FOLDER_ID: TTK_FOLDER_ID, PHOTO_FOLDER_ID: PHOTO_FOLDER_ID, BLANKS_FOLDER_ID: BLANKS_FOLDER_ID, INVOICES_FOLDER_ID: INVOICES_FOLDER_ID }[name] || ''; } catch (e) { return ''; } }
function _v78ByName_(name) { if (!name) return null; try { var it = DriveApp.getFoldersByName(name); while (it.hasNext()) { var f = it.next(); if (!(f.isTrashed && f.isTrashed())) return f; } } catch (e) {} return null; }
/** Записать папку раздела: своё свойство и прежнее свойство модуля (тогда код модуля берёт ту же папку). */
function _v78Register_(key, f, source) {
  var d = _v78Dir_(key), p = _v78Props_(), id = f.getId();
  p.setProperty('MC_FOLDER_' + key, id);
  if (d && d[4].prop) p.setProperty(d[4].prop, id);
  if (key === 'opforms') { try { p.setProperty(MC_V72.FOLDER_PROP, id); } catch (e) {} }
  if (key === 'ttk') TTK_FOLDER_ID = id; else if (key === 'photos') PHOTO_FOLDER_ID = id; else if (key === 'banquets') BLANKS_FOLDER_ID = id; else if (key === 'invoices') INVOICES_FOLDER_ID = id;
  try { p.setProperty('MC_FOLDER_SRC_' + key, source || ''); } catch (e) {}
  return f;
}
function _v78Root_() { return _docsFolder_(); }
function _v78Empty_(f) { try { return !f.getFiles().hasNext() && !f.getFolders().hasNext(); } catch (e) { return false; } }
/**
 * Папка раздела: 1) реестр; 2) прежняя папка (свойство модуля, постоянный ID в коде, прежнее название); 3) создать в структуре.
 * create === false — только найти (без создания).
 */
function _mcFolder_(key, create) {
  var d = _v78Dir_(key); if (!d) throw new Error('Неизвестный раздел папок: ' + key);
  var p = _v78Props_(), f = _v78Open_(p.getProperty('MC_FOLDER_' + key));
  if (f) return f;
  var L = d[4] || {};
  var fromKonst = false;
  f = (L.prop && _v78Open_(p.getProperty(L.prop))) || null;
  if (!f && L.konst) { f = _v78Open_(_v78Konst_(L.konst)); fromKonst = !!f; }
  if (!f && L.name) f = _v78ByName_(L.name);
  if (f) {
    // пустая папка, которую система только что завела под прежним названием в корне Диска, — сразу в структуру
    // (папки с файлами и папки, заданные предприятием, не трогаем: их переносит кнопка «Собрать в общую папку»)
    if (!fromKonst && key !== 'norms' && _v78Empty_(f) && !_v78Inside_(f, _v78Root_())) {
      try { var par = d[3] ? _mcFolder_(d[3]) : _v78Root_(); f.moveTo(par); f.setName(d[1]); return _v78Register_(key, f, 'создана системой'); } catch (e) {}
    }
    return _v78Register_(key, f, 'прежняя папка');
  }
  if (create === false) return null;
  var parent = d[3] ? _mcFolder_(d[3]) : _v78Root_(), it = parent.getFoldersByName(d[1]);
  f = it.hasNext() ? it.next() : parent.createFolder(d[1]);
  try { f.setDescription && f.setDescription('MON CHEF: ' + d[2]); } catch (e) {}
  return _v78Register_(key, f, 'создана системой');
}
/** То же, но при сбое — прежнее поведение (папка по названию в корне Диска). */
function _mcFolderLegacy_(key, legacyName) {
  try { return _mcFolder_(key); } catch (e) { var it = DriveApp.getFoldersByName(legacyName); return it.hasNext() ? it.next() : DriveApp.createFolder(legacyName); }
}
function _mcDocFolderFor_(category) { var k = MC_V78_DOCCAT_[category]; try { return k ? _mcFolder_(k) : _v78Root_(); } catch (e) { return _v78Root_(); } }
function _mcFolderSafe_(key) { try { return _mcFolder_(key); } catch (e) { return null; } }

// модули, которые искали папку только по названию или постоянному ID, — через реестр
try { _exportFolder_ = function () { return _mcFolderLegacy_('exports', 'Выгрузки Mon Cher'); }; } catch (e) {}
try { _blanksFolder_ = function () { return _mcFolderLegacy_('banquets', 'Бланки заявок'); }; } catch (e) {}
try { _invoicesFolder_ = function () { return _mcFolderLegacy_('invoices', 'Накладные'); }; } catch (e) {}
try { _journalsRootFolder_ = function () { return _mcFolderLegacy_('journalsCat', JOURNALS_ROOT_FOLDER_NAME); }; } catch (e) {}
// модули со своим свойством папки: без свойства — тоже через реестр (на новой установке папка сразу в структуре, а не в корне Диска)
// архив (V8) выполняется после этого файла и берёт папку по своему свойству MC_V8_ARCHIVE_ROOT_ID — его пишет реестр
try { var _v78o_packages = _mcPackageFolder_; _mcPackageFolder_ = function () { try { return _mcFolder_('packages'); } catch (e) { return _v78o_packages(); } }; } catch (e) {}
try { var _v78o_journals = _jfDriveRoot_; _jfDriveRoot_ = function () { try { return _mcFolder_('journals'); } catch (e) { return _v78o_journals(); } }; } catch (e) {}
try { var _v78o_tmp = _mcTmpFolder_; _mcTmpFolder_ = function () { try { return _mcFolder_('tmp'); } catch (e) { return _v78o_tmp(); } }; } catch (e) {}
try { var _v78o_org = _mcOrgFolder_; _mcOrgFolder_ = function () { try { return _mcFolder_('org'); } catch (e) { return _v78o_org(); } }; } catch (e) {}
try { var _v78o_reports = _mcReportsFolder_; _mcReportsFolder_ = function () { try { return _mcFolder_('reports'); } catch (e) { return _v78o_reports(); } }; } catch (e) {}
try { var _v78o_signed = _mcSignedFolder_; _mcSignedFolder_ = function () { try { return _mcFolder_('signed'); } catch (e) { return _v78o_signed(); } }; } catch (e) {}
try { var _v78o_ppk = _v65Folder_; _v65Folder_ = function () { try { return _mcFolder_('ppk'); } catch (e) { return _v78o_ppk(); } }; } catch (e) {}
try { var _v78o_tu = _v66Folder_; _v66Folder_ = function () { try { return _mcFolder_('tu'); } catch (e) { return _v78o_tu(); } }; } catch (e) {}
try { var _v78o_opforms = _v72Folder_; _v72Folder_ = function () { try { return _mcFolder_('opforms'); } catch (e) { return _v78o_opforms(); } }; } catch (e) {}

function _v78Sh_(name, head) {
  var sh = _bcSheet_(name, head);
  if (String(sh.getRange(1, head.length).getValue() || '') !== head[head.length - 1]) sh.getRange(1, 1, 1, head.length).setValues([head]);
  return sh;
}
function _v78Inside_(f, root) {
  try { var cur = f, n = 0; while (cur && n < 8) { var it = cur.getParents(); if (!it.hasNext()) return false; cur = it.next(); if (cur.getId() === root.getId()) return true; n++; } } catch (e) {}
  return false;
}
function _v78Parent_(f) { try { var it = f.getParents(); return it.hasNext() ? it.next().getId() : ''; } catch (e) { return ''; } }
/** Раздел на своём месте: лежит прямо в общей папке или в своём родительском разделе. */
function _v78OnPlace_(key, f) { var d = _v78Dir_(key), par = d[3] ? _mcFolder_(d[3], false) : _v78Root_(); return !!(par && _v78Parent_(f) === par.getId()); }
function _v78Who_(token) { try { var s = _getSession_(token); return String((s && (s.fullName || s.name)) || ''); } catch (e) { return ''; } }
/** Создать (или найти) все разделы; записать лист реестра. */
function _v78SetupCore_(who) {
  var root = _v78Root_(), out = { root: { id: root.getId(), name: root.getName(), url: root.getUrl() }, created: [], found: [], outside: [] };
  MC_V78_DIRS_.forEach(function (d) {
    var had = _v78Open_(_v78Props_().getProperty('MC_FOLDER_' + d[0])), f = _mcFolder_(d[0]), src = _v78Props_().getProperty('MC_FOLDER_SRC_' + d[0]) || '';
    if (!had && src === 'создана системой') out.created.push(d[1]); else out.found.push(d[1]);
    if (!_v78OnPlace_(d[0], f)) out.outside.push(d[1]);
  });
  _v78WriteReg_(who);
  return out;
}
function _v78WriteReg_(who) {
  var root = _v78Root_(), sh = _v78Sh_(MC_V78_REG_, MC_V78_REG_HEAD_), old = {}, v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (v[i][0]) old[String(v[i][0])] = v[i];
  var now = new Date(), rows = MC_V78_DIRS_.map(function (d) {
    var f = _mcFolder_(d[0], false), o = old[d[0]] || [];
    return [d[0], d[1], d[2], d[3] ? _v78Dir_(d[3])[1] : '', f ? f.getId() : '', _v78Props_().getProperty('MC_FOLDER_SRC_' + d[0]) || '', f ? (_v78OnPlace_(d[0], f) ? 'да' : 'нет') : '',
      o[7] === undefined ? '' : o[7], o[8] === undefined ? '' : o[8], now, who || ''];
  });
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, MC_V78_REG_HEAD_.length).clearContent();
  sh.getRange(2, 1, rows.length, MC_V78_REG_HEAD_.length).setValues(rows);
}
function v78Setup(token) {
  var op = null;
  try { op = _beginOp_(token, MC_V78_SETUP_, 'FOLDERS_SETUP', 'Папки', null, null); } catch (e) { return _failFrom_(e); }
  try {
    return _withLock_(function () {
      var r = _v78SetupCore_(_v78Who_(token));
      _audit_(op, 'FOLDERS_SETUP', 'Папки', r.root.id, null, { created: r.created.length, found: r.found.length, outside: r.outside });
      _endOp_(op); return _ok_(r, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Обойти разделы и записать список файлов (до 3 уровней, до 400 файлов на раздел). */
function v78Sync(token) {
  var op = null;
  try { op = _beginOp_(token, MC_V78_SETUP_, 'FOLDERS_SYNC', 'Папки', null, null); } catch (e) { return _failFrom_(e); }
  try {
    return _withLock_(function () {
      var reg = {};   // файлы, внесённые в реестр документов (лист «Документы», колонка «Файл (ID)»)
      try { var dv = _docsSheet_().getDataRange().getValues(), fc = (dv[0] || []).indexOf('Файл (ID)'); if (fc < 0) fc = 7; for (var i = 1; i < dv.length; i++) if (dv[i][fc]) reg[String(dv[i][fc])] = 1; } catch (e) {}
      var rows = [], counts = {}, children = {};
      MC_V78_DIRS_.forEach(function (d) { if (d[3]) (children[d[3]] = children[d[3]] || []).push(d[0]); });
      var childIds = {}; MC_V78_DIRS_.forEach(function (d) { var f = d[3] ? _mcFolder_(d[0], false) : null; if (f) childIds[f.getId()] = 1; });
      MC_V78_DIRS_.forEach(function (d) {
        var f = _mcFolder_(d[0], false), n = 0, subs = 0; if (!f) { counts[d[0]] = [0, 0]; return; }
        var walk = function (folder, path, depth) {
          var fi = folder.getFiles();
          while (fi.hasNext() && n < 400) { var x = fi.next(); if (x.isTrashed && x.isTrashed()) continue; n++;
            rows.push([d[0], path, x.getName(), x.getId(), x.getMimeType ? x.getMimeType() : '', x.getSize ? Math.round(x.getSize() / 102.4) / 10 : '', x.getLastUpdated ? x.getLastUpdated() : '', x.getUrl(), reg[x.getId()] ? 'да' : '']); }
          if (depth >= 3) return;
          var fo = folder.getFolders();
          while (fo.hasNext()) { var s = fo.next(); if (childIds[s.getId()]) continue; subs++; walk(s, path ? path + ' / ' + s.getName() : s.getName(), depth + 1); }
        };
        walk(f, '', 1); counts[d[0]] = [n, subs];
      });
      var sh = _v78Sh_(MC_V78_FILES_, MC_V78_FILES_HEAD_);
      if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, MC_V78_FILES_HEAD_.length).clearContent();
      if (rows.length) sh.getRange(2, 1, rows.length, MC_V78_FILES_HEAD_.length).setValues(rows);
      _v78WriteReg_(_v78Who_(token));
      var rs = _v78Sh_(MC_V78_REG_, MC_V78_REG_HEAD_), rv = rs.getDataRange().getValues();
      for (var i = 1; i < rv.length; i++) { var c = counts[String(rv[i][0])]; if (c) rs.getRange(i + 1, 8, 1, 2).setValues([[c[0], c[1]]]); }
      _audit_(op, 'FOLDERS_SYNC', 'Папки', 'Папки_Файлы', null, { files: rows.length });
      _endOp_(op); return _ok_({ files: rows.length, at: Utilities.formatDate(new Date(), _mcTz_(), 'dd.MM.yyyy HH:mm') }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function v78Data(token) {
  var op = null;
  try { op = _beginOp_(token, MC_V78_VIEW_, 'FOLDERS_VIEW', 'Папки', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var root = null; try { root = _v78Open_(_v78Props_().getProperty('DOCS_FOLDER_ID')); } catch (e) {}
    var sh = _v78Sh_(MC_V78_REG_, MC_V78_REG_HEAD_), v = sh.getDataRange().getValues(), reg = {};
    for (var i = 1; i < v.length; i++) if (v[i][0]) reg[String(v[i][0])] = v[i];
    var dirs = MC_V78_DIRS_.map(function (d) {
      var r = reg[d[0]] || [], id = String(r[4] || _v78Props_().getProperty('MC_FOLDER_' + d[0]) || '');
      return { key: d[0], name: d[1], what: d[2], parent: d[3], level: d[3] ? 1 : 0, id: id, url: id ? 'https://drive.google.com/drive/folders/' + id : '', source: String(r[5] || ''),
        inside: String(r[6] || ''), files: r[7] === '' || r[7] === undefined ? null : Number(r[7]), subs: r[8] === '' || r[8] === undefined ? null : Number(r[8]), private: d[0] === 'staff' };
    });
    var fs = _v78Sh_(MC_V78_FILES_, MC_V78_FILES_HEAD_), synced = fs.getLastRow() > 1 || dirs.some(function (x) { return x.files !== null; });
    _endOp_(op);
    return _ok_({ root: root ? { id: root.getId(), name: root.getName(), url: root.getUrl() } : null, dirs: dirs, ready: dirs.every(function (x) { return !!x.id; }),
      outside: dirs.filter(function (x) { return x.id && x.inside === 'нет'; }).length, synced: synced, updated: v.length > 1 && v[1][9] ? Utilities.formatDate(new Date(v[1][9]), _mcTz_(), 'dd.MM.yyyy HH:mm') : '' }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function v78Files(key, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V78_VIEW_, 'FOLDERS_FILES', 'Папки', key, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v78Dir_(String(key)); if (!d) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Раздел не найден', op.id); }
    if (d[0] === 'staff' && !_mcRbHasExact_(op.session, MC_V78_STAFF_)) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', 'Папка «Персонал» — персональные данные: смотреть может директор или ответственный за сотрудников', op.id); }
    var v = _v78Sh_(MC_V78_FILES_, MC_V78_FILES_HEAD_).getDataRange().getValues(), out = [];
    for (var i = 1; i < v.length; i++) if (String(v[i][0]) === d[0]) out.push({ path: String(v[i][1] || ''), name: String(v[i][2] || ''), id: String(v[i][3] || ''), type: String(v[i][4] || ''),
      kb: v[i][5], updated: v[i][6] ? Utilities.formatDate(new Date(v[i][6]), _mcTz_(), 'dd.MM.yyyy') : '', url: String(v[i][7] || ''), registered: String(v[i][8] || '') === 'да' });
    _endOp_(op); return _ok_({ key: d[0], name: d[1], what: d[2], files: out }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Указать свою папку для раздела (ссылка или ID): например, папку ТТК предприятия или базу нормативов. */
function v78SetFolder(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V78_ADMIN_, 'FOLDERS_SET', 'Папки', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), dir = _v78Dir_(String(d.key || ''));
    if (!dir) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Выберите раздел', op.id); }
    var m = /folders\/([A-Za-z0-9_-]{10,})/.exec(String(d.folder || '')) || /^([A-Za-z0-9_-]{10,})$/.exec(String(d.folder || '').trim()), f = m ? _v78Open_(m[1]) : null;
    if (!f) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Папка не найдена или нет доступа — вставьте ссылку на папку Google Диска', op.id); }
    return _withLock_(function () {
      var before = _v78Props_().getProperty('MC_FOLDER_' + dir[0]) || '';
      _v78Register_(dir[0], f, 'указана вручную'); _v78WriteReg_(_v78Who_(token));
      _audit_(op, 'FOLDERS_SET', 'Папки', dir[0], { id: before }, { id: f.getId(), name: f.getName() });
      _endOp_(op); return _ok_({ key: dir[0], id: f.getId(), name: f.getName() }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Разложить прежние папки по своим разделам (ID, доступ и файлы не меняются); системные — переименовать в названия разделов. */
function v78Gather(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V78_ADMIN_, 'FOLDERS_GATHER', 'Папки', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    if (d.confirm !== true) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Подтвердите перенос папок', op.id); }
    return _withLock_(function () {
      var root = _v78Root_(), me = ''; try { me = Session.getEffectiveUser().getEmail(); } catch (e) {}
      var moved = [], skipped = [], keep = { ttk: 1, photos: 1, norms: 1 };   // папки, которые ведёт предприятие, — без переименования
      MC_V78_DIRS_.forEach(function (x) {
        var f = _mcFolder_(x[0], false); if (!f || _v78OnPlace_(x[0], f)) return;
        var owner = ''; try { owner = f.getOwner().getEmail(); } catch (e) {}
        if (me && owner && owner !== me) { skipped.push(x[1] + ': владелец другой (' + owner + ')'); return; }
        var parent = x[3] ? _mcFolder_(x[3]) : root, old = f.getName();
        f.moveTo(parent);
        if (!keep[x[0]] && old !== x[1] && (_v78Props_().getProperty('MC_FOLDER_SRC_' + x[0]) || '') !== 'указана вручную') f.setName(x[1]);
        moved.push(old + ' → ' + (x[3] ? _v78Dir_(x[3])[1] + ' / ' : '') + f.getName());
      });
      _v78WriteReg_(_v78Who_(token));
      _audit_(op, 'FOLDERS_GATHER', 'Папки', root.getId(), null, { moved: moved, skipped: skipped });
      _endOp_(op); return _ok_({ moved: moved, skipped: skipped }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- главное окно ---------------- */
(function () {
  if (typeof _UI_BUILDERS_ !== 'object') return;
  ['documents', 'settings'].forEach(function (sec) {
    var orig = _UI_BUILDERS_[sec]; if (typeof orig !== 'function') return;
    _UI_BUILDERS_[sec] = function (token, opts, s) { var r = orig(token, opts, s) || {}; r.actions = [{ label: 'Папки и документы на Диске', module: 'folders' }].concat(r.actions || []); return r; };
  });
})();
try { if (MC_UI_VIEWS_.indexOf('folders') < 0) MC_UI_VIEWS_ = MC_UI_VIEWS_.concat(['folders']); } catch (e) {}
