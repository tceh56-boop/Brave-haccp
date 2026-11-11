/**
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
function _ts2Find_(name, key, val) { var r = _ts2Rows_(name, function (o) { return String(o[key]) === String(val); }); return r[0] || null; }
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
  var e = _ts2Cfg_('ENTERPRISE_ID', '');
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
  var rows = _ts2Rows_('AUDIT_CHAIN'), prev = '', bad = [];
  rows.forEach(function (r) {
    var h = _ts2Sha_(prev + '|' + TS2_ENTERPRISE_SCHEMA_.AUDIT_CHAIN.head.slice(0, 17).map(function (k) { return k === 'prevHash' ? prev : String(r[k]); }).join('|'));
    if (String(r.prevHash) !== prev || String(r.hash) !== h) bad.push(r.auditId);
    prev = String(r.hash);
  });
  return { records: rows.length, broken: bad };
}

/* ------------------------------------------------------------------ Диск предприятия (ТЗ 2.0 §5.2) */
var TS2_DRIVE_TREE_ = [
  ['ROOT', null, '{ENT} — {NAME}'], ['SYS', 'ROOT', '00_Система'], ['SYS_EXPORTS', 'SYS', 'exports'], ['SYS_IMPORT_REPORTS', 'SYS', 'import_reports'],
  ['SYS_RECON_REPORTS', 'SYS', 'reconciliation_reports'], ['SYS_BACKUPS', 'SYS', 'backups'], ['ORG', 'ROOT', '01_Организация'], ['TTK', 'ROOT', '02_ТТК_и_Меню'],
  ['PRODUCTS', 'ROOT', '03_Продукты_и_Поставщики'], ['PRODUCTION', 'ROOT', '04_Производство'], ['STOCK', 'ROOT', '05_Склад_и_Партии'], ['HACCP', 'ROOT', '06_ХАССП_и_ППК'],
  ['OT', 'ROOT', '07_Охрана_труда'], ['CONTRACTS', 'ROOT', '08_Договоры'], ['STAFF', 'ROOT', '09_Персонал'], ['LAB', 'ROOT', '10_Лаборатория'],
  ['EQUIPMENT', 'ROOT', '11_Оборудование'], ['JOURNALS', 'ROOT', '12_Журналы'], ['PHOTO', 'ROOT', '13_Фото'], ['BACKUPS', 'ROOT', '14_Резервные_копии'],
  ['ARCHIVE', 'ROOT', '99_Архив'], ['GEN_TU', 'HACCP', 'ТУ'], ['GEN_STO', 'HACCP', 'СТО'], ['GEN_PPK', 'HACCP', 'ППК'], ['INBOX', 'ROOT', '00_Входящие_документы']
];
function _ts2FolderOk_(id) { try { var f = DriveApp.getFolderById(id); return !f.isTrashed() ? f : null; } catch (e) { return null; } }
/** Папка по логическому коду: lookup-or-create, ID — в DRIVE_REGISTRY. Повторный вызов не создаёт вторую папку. */
function _ts2Folder_(code) {
  var reg = _ts2Find_('DRIVE_REGISTRY', 'logicalCode', code), f = reg && reg.googleId ? _ts2FolderOk_(reg.googleId) : null;
  if (f) return f;
  var spec = TS2_DRIVE_TREE_.filter(function (t) { return t[0] === code; })[0];
  if (!spec) throw new Error('VALIDATION: неизвестная папка ' + code);
  var name = spec[2].replace('{ENT}', _ts2Ent_()).replace('{NAME}', String(_ts2Cfg_('ENTERPRISE_NAME', '') || (typeof _mcOrg_ === 'function' && _mcOrg_().name) || 'Предприятие'));
  var parent = spec[1] ? _ts2Folder_(spec[1]) : null;
  if (!parent) {
    var pid = PropertiesService.getScriptProperties().getProperty('TS2_ROOT_PARENT_ID');
    parent = pid ? _ts2FolderOk_(pid) : null;
  }
  var it = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  f = it.hasNext() ? it.next() : (parent ? parent.createFolder(name) : DriveApp.createFolder(name));
  var row = { resourceId: reg ? reg.resourceId : _ts2Id_('DRIVE_REGISTRY'), enterpriseId: _ts2Ent_(), resourceType: 'FOLDER', logicalCode: code, name: name, googleId: f.getId(),
    parentGoogleId: parent ? parent.getId() : '', url: f.getUrl(), status: 'ACTIVE', lastCheckedAt: new Date(), hash: '' };
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
