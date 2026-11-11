/**
 * Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович
 * ЦЕХ Стандарт 2.0 — ядро контура предприятия: схема, ID, настройки, реестр Диска, аудит с цепочкой хешей,
 * резервные копии перед массовыми операциями (ТЗ 2.0 §4, §5.2, §7, §14).
 *
 * Все функции идемпотентны: повторный запуск не создаёт дублей листов, папок, счётчиков и записей.
 */

/* ------------------------------------------------------------------ таблицы */
function _ts2Def_(name) { var d = TS2_ENTERPRISE_SCHEMA_[name]; if (!d) throw new Error('VALIDATION: неизвестный лист схемы 2.0: ' + name); return d; }
var _TS2_SH_ = {};
/** Лист схемы 2.0: создаётся при первом обращении; недостающие колонки дописываются в конец (старые не трогаются). */
function _ts2Sheet_(name) {
  if (_TS2_SH_[name]) return _TS2_SH_[name];
  var d = _ts2Def_(name), ss = _book_(), sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, d.head.length).setValues([d.head]).setFontWeight('bold').setBackground('#1d150d').setFontColor('#d4af37');
    sh.setFrozenRows(1);
    // в журналах с хешами значения хранятся текстом: таблица не должна превращать строки в даты и числа
    if (['AUDIT_CHAIN', 'AUTO_RECORDS', 'FILES', 'TTK_SOURCE_FACTS'].indexOf(name) >= 0) sh.getRange(1, 1, sh.getMaxRows(), Math.max(d.head.length, sh.getMaxColumns())).setNumberFormat('@');
  } else {
    var w = Math.max(1, sh.getLastColumn()), cur = sh.getRange(1, 1, 1, w).getValues()[0].map(String);
    var miss = d.head.filter(function (h) { return cur.indexOf(h) < 0; });
    if (miss.length) sh.getRange(1, w + 1, 1, miss.length).setValues([miss]).setFontWeight('bold');
  }
  _TS2_SH_[name] = sh;
  return sh;
}
function _ts2Head_(sh) { return sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(String); }
function _ts2Val_(v) { return v instanceof Date ? v.toISOString() : v; }
/** Все строки листа как объекты {_row, …}. filter — необязательная функция отбора. */
function _ts2Rows_(name, filter) {
  var sh = _ts2Sheet_(name), last = sh.getLastRow();
  if (last < 2) return [];
  var h = _ts2Head_(sh), v = sh.getRange(2, 1, last - 1, h.length).getValues(), out = [];
  for (var i = 0; i < v.length; i++) {
    if (v[i][0] === '' || v[i][0] === null) continue;
    var o = { _row: i + 2 }; for (var j = 0; j < h.length; j++) o[h[j]] = _ts2Val_(v[i][j]);
    if (!filter || filter(o)) out.push(o);
  }
  return out;
}
/** Строки, у которых в колонке key ровно val. Поиск — TextFinder на стороне Таблиц: читаются только найденные строки
 *  (лист автозаписей за год — десятки тысяч строк; полное чтение на каждое событие было бы секундами). */
function _ts2FindAll_(name, key, val, filter) {
  var sh = _ts2Sheet_(name), last = sh.getLastRow(); if (last < 2) return [];
  var h = _ts2Head_(sh), c = h.indexOf(key), out = [];
  if (c < 0) return [];
  var col = sh.getRange(2, c + 1, last - 1, 1);
  if (typeof col.createTextFinder !== 'function') return _ts2Rows_(name, function (o) { return String(o[key]) === String(val) && (!filter || filter(o)); });
  if (String(val) === '') return _ts2Rows_(name, function (o) { return String(o[key]) === '' && (!filter || filter(o)); });
  col.createTextFinder(String(val)).matchEntireCell(true).matchCase(true).findAll().forEach(function (cell) {
    var row = cell.getRow(), v = sh.getRange(row, 1, 1, h.length).getValues()[0];
    if (v[0] === '' || v[0] === null || String(_ts2Val_(v[c])) !== String(val)) return;
    var o = { _row: row }; for (var j = 0; j < h.length; j++) o[h[j]] = _ts2Val_(v[j]);
    if (!filter || filter(o)) out.push(o);
  });
  return out.sort(function (a, b) { return a._row - b._row; });
}
function _ts2Find_(name, key, val) { return _ts2FindAll_(name, key, val)[0] || null; }
/** Последние n строк листа (листы событий дописываются по времени — «сегодня» всегда в конце). */
function _ts2Tail_(name, n, filter) {
  var sh = _ts2Sheet_(name), last = sh.getLastRow(); if (last < 2) return [];
  var from = Math.max(2, last - n + 1), h = _ts2Head_(sh), v = sh.getRange(from, 1, last - from + 1, h.length).getValues(), out = [];
  for (var i = 0; i < v.length; i++) { if (v[i][0] === '' || v[i][0] === null) continue; var o = { _row: from + i }; for (var j = 0; j < h.length; j++) o[h[j]] = _ts2Val_(v[i][j]); if (!filter || filter(o)) out.push(o); }
  return out;
}
function _ts2Cell_(v) { return v === undefined || v === null ? '' : (typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v); }
function _ts2Insert_(name, obj) {
  var sh = _ts2Sheet_(name), h = _ts2Head_(sh);
  sh.appendRow(h.map(function (k) { return _ts2Cell_(obj[k]); }));
  return obj;
}
function _ts2InsertMany_(name, list) {
  if (!list.length) return;
  var sh = _ts2Sheet_(name), h = _ts2Head_(sh);
  sh.getRange(sh.getLastRow() + 1, 1, list.length, h.length).setValues(list.map(function (o) { return h.map(function (k) { return _ts2Cell_(o[k]); }); }));
}
function _ts2Update_(name, key, val, patch) {
  var sh = _ts2Sheet_(name), cur = _ts2Find_(name, key, val);
  if (!cur) throw new Error('NOT_FOUND: ' + name + ' ' + val);
  var h = _ts2Head_(sh);
  Object.keys(patch).forEach(function (k) { if (h.indexOf(k) >= 0) cur[k] = patch[k]; });
  sh.getRange(cur._row, 1, 1, h.length).setValues([h.map(function (k) { return _ts2Cell_(cur[k]); })]);
  return cur;
}
function _ts2Json_(s, dflt) { if (s && typeof s === 'object') return s; try { return s ? JSON.parse(s) : dflt; } catch (e) { return dflt; } }
function _ts2Now_() { return new Date(); }
// время события: при отправке из офлайн-очереди — время на устройстве (_mcNow_, MonChef_Offline.gs), иначе текущее
function _ts2Iso_(d) { return Utilities.formatDate(d || (typeof _mcNow_ === 'function' ? _mcNow_() : new Date()), _mcTz_(), "yyyy-MM-dd'T'HH:mm:ss"); }
function _ts2Sha_(text) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  return b.map(function (x) { return ('0' + (x & 255).toString(16)).slice(-2); }).join('');
}
function _ts2ShaBytes_(bytes) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  return b.map(function (x) { return ('0' + (x & 255).toString(16)).slice(-2); }).join('');
}

/* ------------------------------------------------------------------ кто действует */
function _ts2Actor_() {
  var s = null; try { s = typeof mcGateSession_ === 'function' ? mcGateSession_() : null; } catch (e) {}
  if (s) return { type: s.dev ? 'TECH' : 'USER', id: String(s.user_id || s.name || ''), name: String(s.name || s.fullName || ''), role: String(s.role || '') };
  return { type: 'SYSTEM', id: 'SYSTEM', name: 'Система ЦЕХ Стандарт', role: 'SYSTEM' };
}

/* ------------------------------------------------------------------ ID (ТЗ 2.0 §4.2, §7.3) */
/** Новый ID вида PREFIX-YYYY-000001 (или PREFIX-000001). Под общей блокировкой; счётчик в ID_COUNTERS. */
function _ts2Id_(sheetOrPrefix, yearly) {
  var d = TS2_ENTERPRISE_SCHEMA_[sheetOrPrefix], prefix = d ? d.prefix : sheetOrPrefix;
  if (d) yearly = !!d.yearly;
  if (!prefix) throw new Error('VALIDATION: у листа ' + sheetOrPrefix + ' нет префикса ID');
  var year = yearly ? Utilities.formatDate(new Date(), _mcTz_(), 'yyyy') : '';
  return _withLock_(function () {
    var code = prefix + (year ? '-' + year : ''), sh = _ts2Sheet_('ID_COUNTERS'), cur = _ts2Find_('ID_COUNTERS', 'counterCode', code), n;
    if (cur) { n = Number(cur.lastNumber || 0) + 1; sh.getRange(cur._row, 4, 1, 3).setValues([[n, new Date(), _ts2Actor_().name]]); }
    else { n = 1; sh.appendRow([code, prefix, year, n, new Date(), _ts2Actor_().name]); }
    return code + '-' + ('00000' + n).slice(-6);
  });
}

/* ------------------------------------------------------------------ настройки (ТЗ 2.0 §7.2) */
var TS2_REQUIRED_CONFIG_ = ['ENTERPRISE_ID', 'ORGANIZATION_ID', 'PRIMARY_LOCATION_ID', 'ENTERPRISE_NAME', 'TIMEZONE', 'CURRENCY', 'DEFAULT_LANGUAGE', 'TRIAL_START',
  'TS_LICENSE_KEY', 'TS_LICENSE_SECRET', 'TS_ADMIN_URL', 'MC_NOTIFY_EMAIL', 'MC_IDLE_MIN'];
var TS2_SECRET_KEYS_ = ['TS_LICENSE_KEY', 'TS_LICENSE_SECRET', 'YANDEX_API_KEY'];
function _ts2Cfg_(key, dflt) {
  if (TS2_SECRET_KEYS_.indexOf(key) >= 0) return PropertiesService.getScriptProperties().getProperty(key) || dflt;
  var r = _ts2Find_('SYSTEM_CONFIG', 'key', key);
  if (r && r.value !== '') return r.valueType === 'JSON' ? _ts2Json_(r.value, dflt) : r.value;
  var p = PropertiesService.getScriptProperties().getProperty(key);
  return p !== null && p !== undefined ? p : dflt;
}
function _ts2SetCfg_(key, value, source) {
  var secret = TS2_SECRET_KEYS_.indexOf(key) >= 0, type = typeof value === 'object' ? 'JSON' : typeof value === 'number' ? 'NUMBER' : typeof value === 'boolean' ? 'BOOLEAN' : 'STRING';
  if (secret) PropertiesService.getScriptProperties().setProperty(key, String(value));
  var row = { key: key, value: secret ? '' : (type === 'JSON' ? JSON.stringify(value) : String(value)), valueType: type, scope: 'ENTERPRISE', isSecret: secret,
    source: source || 'CLIENT', status: 'ACTIVE', updatedAt: new Date(), updatedBy: _ts2Actor_().name };
  if (_ts2Find_('SYSTEM_CONFIG', 'key', key)) _ts2Update_('SYSTEM_CONFIG', 'key', key, row); else _ts2Insert_('SYSTEM_CONFIG', row);
}
/** enterpriseId: из настроек; если ещё нет — из лицензии; иначе временный LOCAL (до подключения к управляющему контуру). */
function _ts2Ent_() {
  // В tenant-режиме предприятие задаёт конфигурация, внедрённая CONTROL (её нельзя подменить правкой таблицы).
  // Таблица с другим ENTERPRISE_ID — чужая или скопированная: работа останавливается.
  if (TS_TENANT_CONFIG_ && TS_TENANT_CONFIG_.mode === '1' && TS_TENANT_CONFIG_.enterpriseId) {
    var inj = String(TS_TENANT_CONFIG_.enterpriseId), inSheet = String(_ts2Cfg_('ENTERPRISE_ID', '') || '');
    if (inSheet && inSheet !== inj) throw new Error('TENANT_BOUNDARY: таблица принадлежит предприятию ' + inSheet + ', а проект настроен на ' + inj);
    return inj;
  }
  var e = _ts2Cfg_('ENTERPRISE_ID', '');
  if (!e && TS_TENANT_CONFIG_ && TS_TENANT_CONFIG_.enterpriseId) e = TS_TENANT_CONFIG_.enterpriseId;
  if (e) return String(e);
  try { var st = JSON.parse(PropertiesService.getScriptProperties().getProperty('TS_LICENSE_STATE') || 'null'); if (st && st.enterpriseId) return st.enterpriseId; } catch (x) {}
  return 'ENT-LOCAL';
}

/* ------------------------------------------------------------------ аудит с цепочкой хешей (ТЗ 2.0 §7.16) */
function _ts2Audit_(action, entityType, entityId, before, after, reason, result, operationId) {
  var a = _ts2Actor_(), p = PropertiesService.getScriptProperties();
  return _withLock_(function () {
    var prev = p.getProperty('TS2_AUDIT_LAST_HASH') || '';
    var row = { auditId: _ts2Id_('AUDIT_CHAIN'), operationId: operationId || '', enterpriseId: _ts2Ent_(), actorType: a.type, actorId: a.id, actorName: a.name, actorRole: a.role,
      action: action, entityType: entityType || '', entityId: entityId || '', beforeJson: before === undefined ? '' : JSON.stringify(before).slice(0, 20000),
      afterJson: after === undefined ? '' : JSON.stringify(after).slice(0, 20000), reason: reason || '', source: 'TS2', result: result || 'OK', createdAt: _ts2Iso_(), prevHash: prev };
    row.hash = _ts2Sha_(prev + '|' + TS2_ENTERPRISE_SCHEMA_.AUDIT_CHAIN.head.slice(0, 17).map(function (k) { return String(row[k]); }).join('|'));
    _ts2Insert_('AUDIT_CHAIN', row);
    p.setProperty('TS2_AUDIT_LAST_HASH', row.hash);
    return row.auditId;
  });
}
/** Проверка цепочки аудита: каждая запись ссылается на хеш предыдущей и сама не изменена. */
function _ts2VerifyAudit_() {
  // после вырезания старых месяцев цепочка начинается с якоря; её продолжение до якоря — в архивах месяцев (TS2_Archive.gs)
  var rows = _ts2Rows_('AUDIT_CHAIN'), prev = PropertiesService.getScriptProperties().getProperty('TS2_AUDIT_ANCHOR') || '', bad = [];
  rows.forEach(function (r) {
    var h = _ts2Sha_(prev + '|' + TS2_ENTERPRISE_SCHEMA_.AUDIT_CHAIN.head.slice(0, 17).map(function (k) { return k === 'prevHash' ? prev : String(r[k]); }).join('|'));
    if (String(r.prevHash) !== prev || String(r.hash) !== h) bad.push(r.auditId);
    prev = String(r.hash);
  });
  return { records: rows.length, broken: bad };
}

/* ------------------------------------------------------------------ Диск предприятия (ТЗ 2.0 §5.2) */
// Injected by CONTROL during provisioning; points to the customer-owned Drive root.
var TS2_TENANT_ROOT_ID = '';
// Заполняется CONTROL при каждом provisioning/release; не содержит секретов.
var TS_TENANT_CONFIG_ = { mode: '', rootFolderId: '', spreadsheetId: '', enterpriseId: '', ownerEmail: '' };
var TS2_DRIVE_TREE_ = [
  ['ROOT', null, '{ENT} — {NAME}'], ['SYS', 'ROOT', '00_Система'], ['SYS_EXPORTS', 'SYS', 'exports'], ['SYS_IMPORT_REPORTS', 'SYS', 'import_reports'],
  ['SYS_RECON_REPORTS', 'SYS', 'reconciliation_reports'], ['SYS_BACKUPS', 'SYS', 'backups'], ['ORG', 'ROOT', '01_Организация'], ['TTK', 'ROOT', '02_ТТК_и_Меню'],
  ['PRODUCTS', 'ROOT', '03_Продукты_и_Поставщики'], ['PRODUCTION', 'ROOT', '04_Производство'], ['STOCK', 'ROOT', '05_Склад_и_Партии'], ['HACCP', 'ROOT', '06_ХАССП_и_ППК'],
  ['OT', 'ROOT', '07_Охрана_труда'], ['CONTRACTS', 'ROOT', '08_Договоры'], ['STAFF', 'ROOT', '09_Персонал'], ['LAB', 'ROOT', '10_Лаборатория'],
  ['EQUIPMENT', 'ROOT', '11_Оборудование'], ['JOURNALS', 'ROOT', '12_Журналы'], ['PHOTO', 'ROOT', '13_Фото'], ['BACKUPS', 'ROOT', '14_Резервные_копии'],
  ['ARCHIVE', 'ROOT', '99_Архив'], ['GEN_TU', 'HACCP', 'ТУ'], ['GEN_STO', 'HACCP', 'СТО'], ['GEN_PPK', 'HACCP', 'ППК'], ['INBOX', 'ROOT', '00_Входящие_документы'],
  ['BLANKS', 'INBOX', 'Бланки заявок'], ['INVOICES', 'PRODUCTS', 'Накладные'], ['TTK_SOURCE', 'TTK', 'Исходные файлы'], ['TTK_BANQUET', 'TTK', 'Банкетные ТТК']
];
function _ts2FolderOk_(id) { try { var f = DriveApp.getFolderById(id); return !f.isTrashed() ? f : null; } catch (e) { return null; } }
function _tsTenantMode_() { return String((TS_TENANT_CONFIG_ && TS_TENANT_CONFIG_.mode) || PropertiesService.getScriptProperties().getProperty('TS_TENANT_MODE') || '') === '1'; }
function _tsTenantRootId_() {
  var p = PropertiesService.getScriptProperties();
  return String((TS_TENANT_CONFIG_ && TS_TENANT_CONFIG_.rootFolderId) || p.getProperty('TS_TENANT_ROOT_ID') || p.getProperty('TS2_ROOT_PARENT_ID') || TS2_TENANT_ROOT_ID || '').trim();
}
function _tsTenantSpreadsheetId_() {
  var p = PropertiesService.getScriptProperties(), id = String((TS_TENANT_CONFIG_ && TS_TENANT_CONFIG_.spreadsheetId) || p.getProperty('TS_TENANT_SHEET_ID') || '').trim();
  if (id) return id;
  if (_tsTenantMode_()) throw new Error('TENANT_STORAGE_NOT_CONFIGURED: TS_TENANT_SHEET_ID отсутствует; доступ к общей базе запрещён');
  return String(typeof SHEET_ID !== 'undefined' ? SHEET_ID : '').trim();
}
/** ID логической папки. В tenant-режиме запрещён fallback на глобальные папки поставщика. */
function _tsTenantFolderId_(code, legacyId) {
  if (_tsTenantMode_()) return _ts2Folder_(code).getId();
  var f = null;
  try { f = _ts2Folder_(code); } catch (e) {}
  return f ? f.getId() : String(legacyId || '');
}
/** Проверка, что папка/файл действительно находится внутри логической папки текущего клиента. */
function _tsTenantIsWithin_(itemId, rootCode, isFile) {
  if (!_tsTenantMode_()) return true;
  var root = _ts2Folder_(rootCode), rootId = root.getId(), item;
  try { item = isFile ? DriveApp.getFileById(String(itemId)) : DriveApp.getFolderById(String(itemId)); }
  catch (e) { return false; }
  if (item.isTrashed && item.isTrashed()) return false;
  var frontier = [], seen = {}, parents = item.getParents();
  while (parents.hasNext()) frontier.push(parents.next());
  for (var depth = 0; depth < 16 && frontier.length; depth++) {
    var next = [];
    for (var i = 0; i < frontier.length; i++) {
      var f = frontier[i], id = f.getId();
      if (id === rootId) return true;
      if (seen[id]) continue; seen[id] = true;
      var pp = f.getParents(); while (pp.hasNext()) next.push(pp.next());
    }
    frontier = next;
  }
  return String(itemId) === rootId && !isFile;
}
function _tsTenantAssertFolderWithin_(folderId, rootCode) {
  if (!_tsTenantIsWithin_(folderId, rootCode, false)) throw new Error('TENANT_BOUNDARY: выбранная папка находится вне дерева предприятия');
  return true;
}
function _tsTenantAssertFileWithin_(fileId, rootCode) {
  if (!_tsTenantIsWithin_(fileId, rootCode, true)) throw new Error('TENANT_BOUNDARY: выбранный файл находится вне дерева предприятия');
  return true;
}
/** Папка по логическому коду: lookup-or-create в пределах клиентского корня. */
function _ts2Folder_(code) {
  var ent = _ts2Ent_(), tenantMode = _tsTenantMode_();
  var reg = _ts2Find_('DRIVE_REGISTRY', 'logicalCode', code);
  if (reg && reg.enterpriseId && String(reg.enterpriseId) !== String(ent)) throw new Error('TENANT_BOUNDARY: DRIVE_REGISTRY принадлежит другому предприятию');
  var rootId = _tsTenantRootId_();
  if (code === 'ROOT') {
    if (!rootId && tenantMode) throw new Error('TENANT_STORAGE_NOT_CONFIGURED: не задан корень клиентского Google Drive');
    var root = rootId ? _ts2FolderOk_(rootId) : null;
    if (rootId && !root) throw new Error('TENANT_STORAGE_UNAVAILABLE: корневая папка клиента недоступна или удалена');
    if (!root) {
      var legacyRoot = reg && reg.googleId ? _ts2FolderOk_(reg.googleId) : null;
      if (legacyRoot) root = legacyRoot;
      else if (!tenantMode) root = DriveApp.createFolder(ent + ' — ' + String(_ts2Cfg_('ENTERPRISE_NAME', 'Предприятие')));
      else throw new Error('TENANT_STORAGE_NOT_CONFIGURED: создание корня на диске поставщика запрещено');
    }
    var rootRow = { resourceId: reg ? reg.resourceId : _ts2Id_('DRIVE_REGISTRY'), enterpriseId: ent, resourceType: 'FOLDER', logicalCode: 'ROOT', name: root.getName(), googleId: root.getId(), parentGoogleId: '', url: root.getUrl(), status: 'ACTIVE', lastCheckedAt: new Date(), hash: '' };
    if (reg) _ts2Update_('DRIVE_REGISTRY', 'logicalCode', 'ROOT', rootRow); else _ts2Insert_('DRIVE_REGISTRY', rootRow);
    return root;
  }
  var f = reg && reg.googleId ? _ts2FolderOk_(reg.googleId) : null;
  var spec = TS2_DRIVE_TREE_.filter(function (t) { return t[0] === code; })[0];
  if (!spec) throw new Error('VALIDATION: неизвестная папка ' + code);
  var name = spec[2].replace('{ENT}', ent).replace('{NAME}', String(_ts2Cfg_('ENTERPRISE_NAME', '') || (typeof _mcOrg_ === 'function' && _mcOrg_().name) || 'Предприятие'));
  var parent = spec[1] ? _ts2Folder_(spec[1]) : null;
  if (f) {
    if (tenantMode && parent && reg.parentGoogleId && String(reg.parentGoogleId) !== String(parent.getId())) throw new Error('TENANT_BOUNDARY: папка ' + code + ' зарегистрирована вне ожидаемого родителя');
    if (tenantMode && parent) {
      var ps = f.getParents(), hasParent = false; while (ps.hasNext()) if (ps.next().getId() === parent.getId()) hasParent = true;
      if (!hasParent) throw new Error('TENANT_BOUNDARY: папка ' + code + ' находится вне дерева предприятия');
    }
    return f;
  }
  if (tenantMode && !parent) throw new Error('TENANT_BOUNDARY: дочерняя папка без родителя запрещена');
  var it = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  f = it.hasNext() ? it.next() : (parent ? parent.createFolder(name) : DriveApp.createFolder(name));
  var row = { resourceId: reg ? reg.resourceId : _ts2Id_('DRIVE_REGISTRY'), enterpriseId: ent, resourceType: 'FOLDER', logicalCode: code, name: name, googleId: f.getId(), parentGoogleId: parent ? parent.getId() : '', url: f.getUrl(), status: 'ACTIVE', lastCheckedAt: new Date(), hash: '' };
  if (reg) _ts2Update_('DRIVE_REGISTRY', 'logicalCode', code, row); else _ts2Insert_('DRIVE_REGISTRY', row);
  return f;
}
function _ts2EnsureDriveTree_() {
  var out = [];
  TS2_DRIVE_TREE_.forEach(function (t) { var f = _ts2Folder_(t[0]); out.push({ code: t[0], id: f.getId() }); });
  return out;
}

/* ------------------------------------------------------------------ резервные копии (ТЗ 2.0 §14) */
/** Резервная копия таблицы + манифест (листы, заголовки, число строк, хеш значений, версия схемы). Возвращает backupId. */
function _ts2Backup_(backupType, scope) {
  var ss = _book_(), src = DriveApp.getFileById(ss.getId()), folder = _ts2Folder_('SYS_BACKUPS');
  var id = _ts2Id_('BACKUP_CATALOG'), stamp = Utilities.formatDate(new Date(), _mcTz_(), 'yyyy-MM-dd_HH-mm-ss');
  var copy = src.makeCopy(id + ' ' + backupType + ' ' + stamp, folder);
  var manifest = { backupId: id, backupType: backupType, scope: scope || '', createdAt: _ts2Iso_(), schemaVersion: TS2_SCHEMA_VERSION, appVersion: typeof TS_VERSION !== 'undefined' ? TS_VERSION : '',
    spreadsheetId: ss.getId(), copyId: copy.getId(), sheets: ss.getSheets().map(function (s) {
      var lr = s.getLastRow(), lc = s.getLastColumn(), head = lc ? s.getRange(1, 1, 1, lc).getValues()[0] : [];
      var hash = lr && lc && lr * lc < 200000 ? _ts2Sha_(JSON.stringify(s.getRange(1, 1, lr, lc).getValues())) : '';
      return { name: s.getName(), rows: lr, cols: lc, head: head, sha256: hash };
    }), settings: _ts2Rows_('SYSTEM_CONFIG').map(function (r) { return { key: r.key, value: r.isSecret === true || r.isSecret === 'TRUE' ? '***' : r.value }; }) };
  var mf = folder.createFile(Utilities.newBlob(JSON.stringify(manifest, null, 1), 'application/json', id + '_manifest.json'));
  _ts2Insert_('BACKUP_CATALOG', { backupId: id, enterpriseId: _ts2Ent_(), backupType: backupType, scope: scope || '', fileId: copy.getId(), fileUrl: copy.getUrl(),
    createdAt: _ts2Iso_(), createdBy: _ts2Actor_().name, sizeBytes: copy.getSize(), sha256: _ts2Sha_(JSON.stringify(manifest.sheets)), schemaVersion: TS2_SCHEMA_VERSION, status: 'OK',
    restoreTestedAt: '', restoreResult: 'manifest: ' + mf.getId() });
  _ts2Audit_('BACKUP_CREATE', 'BACKUP', id, undefined, { type: backupType, scope: scope, fileId: copy.getId() }, backupType);
  return id;
}

/* ------------------------------------------------------------------ установка схемы */
/** Создать/проверить все листы схемы 2.0, обязательные параметры, дерево Диска. Повторный запуск безопасен. */
function _ts2EnsureSchema_(withDrive) {
  var created = 0, verified = 0, ss = _book_();
  Object.keys(TS2_ENTERPRISE_SCHEMA_).forEach(function (n) { if (ss.getSheetByName(n)) verified++; else created++; _ts2Sheet_(n); });
  if (!_ts2Find_('SYSTEM_CONFIG', 'key', 'ENTERPRISE_ID')) {
    var p = PropertiesService.getScriptProperties();
    var defaults = { ENTERPRISE_ID: _ts2Ent_(), ORGANIZATION_ID: '', PRIMARY_LOCATION_ID: '', ENTERPRISE_NAME: (typeof _mcOrg_ === 'function' && _mcOrg_().name) || '',
      TIMEZONE: _mcTz_(), CURRENCY: 'RUB', DEFAULT_LANGUAGE: 'ru', TRIAL_START: p.getProperty('TS_TRIAL_START') || String(Date.now()),
      TS_ADMIN_URL: p.getProperty('TS_ADMIN_URL') || '', MC_NOTIFY_EMAIL: p.getProperty('MC_NOTIFY_EMAIL') || '', MC_IDLE_MIN: p.getProperty('MC_IDLE_MIN') || '15' };
    Object.keys(defaults).forEach(function (k) { _ts2SetCfg_(k, defaults[k], 'DEFAULT'); });
    ['TS_LICENSE_KEY', 'TS_LICENSE_SECRET'].forEach(function (k) { if (!_ts2Find_('SYSTEM_CONFIG', 'key', k)) _ts2Insert_('SYSTEM_CONFIG', { key: k, value: '', valueType: 'STRING', scope: 'ENTERPRISE', isSecret: true, source: 'DEFAULT', status: 'ACTIVE', updatedAt: new Date(), updatedBy: 'SYSTEM' }); });
  }
  var cur = _ts2Rows_('SCHEMA_VERSION').pop();
  if (!cur || cur.version !== TS2_SCHEMA_VERSION || created) _ts2Insert_('SCHEMA_VERSION', { version: TS2_SCHEMA_VERSION, appliedAt: new Date(), appliedBy: _ts2Actor_().name, sheetsCreated: created, sheetsVerified: verified, notes: 'ЦЕХ Стандарт 2.0–2.2' });
  try {   // защита журнала аудита от ручной правки: только владелец (предупреждение для остальных)
    var a = ss.getSheetByName('AUDIT_CHAIN'); if (a && !a.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) a.protect().setDescription('ЦЕХ Стандарт: журнал аудита только дописывается').setWarningOnly(true);
  } catch (e) {}
  var drive = withDrive === false ? [] : _ts2EnsureDriveTree_();
  return { schemaVersion: TS2_SCHEMA_VERSION, sheetsCreated: created, sheetsVerified: verified, folders: drive.length };
}

/* ------------------------------------------------------------------ API */
function ts2Status(token) {
  try {
    _requireAuth_(token);
    var ss = _book_(), have = Object.keys(TS2_ENTERPRISE_SCHEMA_).filter(function (n) { return !!ss.getSheetByName(n); });
    var sv = have.indexOf('SCHEMA_VERSION') >= 0 ? (_ts2Rows_('SCHEMA_VERSION').pop() || {}) : {};
    var prof = have.indexOf('AUTOMATION_PROFILE') >= 0 ? _ts2Rows_('AUTOMATION_PROFILE').reduce(function (m, r) { m[r.key] = r.value; return m; }, {}) : {};
    return _ok_({ enterpriseId: _ts2Ent_(), schemaVersion: sv.version || '', installed: have.length, total: Object.keys(TS2_ENTERPRISE_SCHEMA_).length, mode: prof.mode || '', enterpriseType: prof.enterpriseType || '',
      legacy: TS2_LEGACY_MAP_.map(function (m) { return { sheet: m[0], entity: m[1], exists: !!ss.getSheetByName(m[0]) }; }) });
  } catch (e) { return _failFrom_(e); }
}
function ts2InstallSchema(token) {
  try { _requireAuth_(token); var r = _ts2EnsureSchema_(true); _ts2Audit_('SCHEMA_INSTALL', 'SCHEMA', TS2_SCHEMA_VERSION, undefined, r, ''); return _ok_(r); }
  catch (e) { return _failFrom_(e); }
}
function ts2VerifyAudit(token) { try { _requireAuth_(token); return _ok_(_ts2VerifyAudit_()); } catch (e) { return _failFrom_(e); } }
function ts2Backups(token) { try { _requireAuth_(token); return _ok_(_ts2Rows_('BACKUP_CATALOG').reverse()); } catch (e) { return _failFrom_(e); } }
function ts2CreateBackup(token) { try { _requireAuth_(token); return _ok_({ backupId: _ts2Backup_('MANUAL', 'enterprise') }); } catch (e) { return _failFrom_(e); } }
