/**
 * MonChef License API — доступ к реестру (Google Таблица владельца), к закрытой папке Drive и к кэшу.
 *
 * Сервисы работают через mcStore_() и mcDrive_(), а не напрямую с SpreadsheetApp/DriveApp:
 * так тесты (Tests.gs) подставляют хранилище в памяти и «недоступный Drive», не трогая реальные данные.
 *
 * Производительность:
 *  • строка лицензии ищется TextFinder по одному столбцу, а не чтением всего листа;
 *  • строка читается и пишется одним вызовом getValues/setValues;
 *  • реестр документов читается одним пакетом и кэшируется (DocumentService).
 */

var _MC_STORE_ = null, _MC_DRIVE_ = null;

function mcStore_() { if (!_MC_STORE_) _MC_STORE_ = mcSheetStore_(); return _MC_STORE_; }
function mcDrive_() { if (!_MC_DRIVE_) _MC_DRIVE_ = mcDriveAdapter_(); return _MC_DRIVE_; }
/** Только для тестов. */
function mcUseStoreForTest_(store, drive) { _MC_STORE_ = store; _MC_DRIVE_ = drive; }

// ---------------------------------------------------------------- кэш

var _MC_CACHE_NS_ = '';         // в тестах — отдельное пространство ключей, чтобы не задеть рабочий кэш API
function mcCache_() { return CacheService.getScriptCache(); }
function mcCacheGet_(key) {
  try { var v = mcCache_().get(_MC_CACHE_NS_ + key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
}
function mcCachePut_(key, obj, seconds) {
  try {
    var s = JSON.stringify(obj);
    if (s.length > 95000) return false;               // предел значения CacheService — 100 КБ
    mcCache_().put(_MC_CACHE_NS_ + key, s, Math.max(1, Math.min(21600, seconds || 300)));
    return true;
  } catch (e) { return false; }
}
function mcCacheRemove_(key) { try { mcCache_().remove(_MC_CACHE_NS_ + key); } catch (e) {} }
/** Счётчик в кэше (приблизительный: без блокировки, для лимитов и порогов этого достаточно). */
function mcCacheIncr_(key, seconds) {
  try {
    var c = mcCache_(), k = _MC_CACHE_NS_ + key, n = parseInt(c.get(k) || '0', 10) || 0;
    n++; c.put(k, String(n), Math.max(1, Math.min(21600, seconds)));
    return n;
  } catch (e) { return 0; }
}

// ---------------------------------------------------------------- Google Таблица

/** Защита от формул: значение из запроса клиента не должно стать формулой в таблице владельца. */
function mcSafeCell_(v) {
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
  return v;
}

function mcSheetStore_() {
  var book = null, sheets = {}, heads = {};

  function ss() {
    if (!book) {
      var id = mcCfg_('MC_LICENSE_REGISTRY_SHEET_ID');
      if (!id) throw mcFail_('SERVICE_UNAVAILABLE', 'MC_LICENSE_REGISTRY_SHEET_ID не задан — выполните MC_setupLicenseRegistry()');
      try { book = SpreadsheetApp.openById(id); } catch (e) { throw mcFail_('SERVICE_UNAVAILABLE', 'реестр недоступен: ' + e); }
    }
    return book;
  }
  function sheet(nameKey) {
    if (sheets[nameKey]) return sheets[nameKey];
    var sh = ss().getSheetByName(mcCfg_(nameKey));
    if (!sh) throw mcFail_('SERVICE_UNAVAILABLE', 'нет листа ' + mcCfg_(nameKey));
    sheets[nameKey] = sh;
    return sh;
  }
  function head(nameKey) {
    if (heads[nameKey]) return heads[nameKey];
    var sh = sheet(nameKey), n = sh.getLastColumn();
    var h = n ? sh.getRange(1, 1, 1, n).getValues()[0].map(function (x) { return String(x).trim(); }) : [];
    heads[nameKey] = h;
    return h;
  }
  function toObj(h, row) { var o = {}; h.forEach(function (k, i) { if (k) o[k] = row[i]; }); return o; }
  function toRow(h, obj) { return h.map(function (k) { return obj[k] === undefined || obj[k] === null ? '' : mcSafeCell_(obj[k]); }); }

  /** Номера строк, где в колонке col точно равно value (TextFinder — без чтения листа целиком). */
  function findRows(nameKey, col, value) {
    var sh = sheet(nameKey), h = head(nameKey), ci = h.indexOf(col), last = sh.getLastRow();
    if (ci < 0 || last < 2 || !value) return [];
    var rng = sh.getRange(2, ci + 1, last - 1, 1);
    if (typeof rng.createTextFinder === 'function') {
      return rng.createTextFinder(String(value)).matchEntireCell(true).matchCase(true).findAll()
        .map(function (r) { return r.getRow(); });
    }
    var vals = rng.getValues(), out = [];
    for (var i = 0; i < vals.length; i++) if (String(vals[i][0]) === String(value)) out.push(i + 2);
    return out;
  }
  function readRow(nameKey, row) {
    var h = head(nameKey);
    var o = toObj(h, sheet(nameKey).getRange(row, 1, 1, h.length).getValues()[0]);
    o._row = row;
    return o;
  }
  function patchRow(nameKey, row, patch) {
    var h = head(nameKey), rng = sheet(nameKey).getRange(row, 1, 1, h.length), vals = rng.getValues()[0];
    Object.keys(patch).forEach(function (k) { var i = h.indexOf(k); if (i >= 0) vals[i] = patch[k] === undefined || patch[k] === null ? '' : mcSafeCell_(patch[k]); });
    rng.setValues([vals]);
  }
  function append(nameKey, obj) { var h = head(nameKey); sheet(nameKey).appendRow(toRow(h, obj)); }
  function readAll(nameKey) {
    var sh = sheet(nameKey), h = head(nameKey), last = sh.getLastRow();
    if (last < 2) return [];
    return sh.getRange(2, 1, last - 1, h.length).getValues().map(function (r, i) { var o = toObj(h, r); o._row = i + 2; return o; });
  }

  return {
    kind: 'sheets',
    getLicense: function (licenseId) { var rows = findRows('MC_LICENSE_SHEET_NAME', 'licenseId', licenseId); return rows.length ? readRow('MC_LICENSE_SHEET_NAME', rows[0]) : null; },
    listLicenses: function () { return readAll('MC_LICENSE_SHEET_NAME'); },
    insertLicense: function (obj) { append('MC_LICENSE_SHEET_NAME', obj); },
    updateLicense: function (licenseId, patch) {
      var rows = findRows('MC_LICENSE_SHEET_NAME', 'licenseId', licenseId);
      if (!rows.length) throw mcFail_('LICENSE_NOT_FOUND', 'нет лицензии ' + licenseId);
      patchRow('MC_LICENSE_SHEET_NAME', rows[0], patch);
    },
    /** Счётчики обращений: читаем текущее значение requestCount и прибавляем накопленное в кэше. */
    touchLicense: function (licenseId, addCount, seenAt, installationId) {
      var rows = findRows('MC_LICENSE_SHEET_NAME', 'licenseId', licenseId);
      if (!rows.length) return;
      var cur = readRow('MC_LICENSE_SHEET_NAME', rows[0]);
      patchRow('MC_LICENSE_SHEET_NAME', rows[0], { lastSeenAt: seenAt, lastSeenInstallationId: installationId,
        requestCount: (parseInt(cur.requestCount, 10) || 0) + addCount });
    },
    listDocuments: function () { return readAll('MC_DOCUMENTS_SHEET_NAME'); },
    insertDocument: function (obj) { append('MC_DOCUMENTS_SHEET_NAME', obj); },
    updateDocument: function (documentId, patch) {
      var rows = findRows('MC_DOCUMENTS_SHEET_NAME', 'documentId', documentId);
      if (!rows.length) throw mcFail_('DOCUMENT_NOT_FOUND', 'нет документа ' + documentId);
      patchRow('MC_DOCUMENTS_SHEET_NAME', rows[0], patch);
    },
    listInstallations: function (licenseId) {
      return findRows('MC_INSTALLATIONS_SHEET_NAME', 'licenseId', licenseId).map(function (r) { return readRow('MC_INSTALLATIONS_SHEET_NAME', r); });
    },
    insertInstallation: function (obj) { append('MC_INSTALLATIONS_SHEET_NAME', obj); },
    updateInstallation: function (licenseId, installationId, patch) {
      var rows = findRows('MC_INSTALLATIONS_SHEET_NAME', 'installationId', installationId);
      for (var i = 0; i < rows.length; i++) {
        var r = readRow('MC_INSTALLATIONS_SHEET_NAME', rows[i]);
        if (String(r.licenseId) === String(licenseId)) { patchRow('MC_INSTALLATIONS_SHEET_NAME', rows[i], patch); return true; }
      }
      return false;
    },
    getRequest: function (licenseId, requestId) {
      var rows = findRows('MC_REQUESTS_SHEET_NAME', 'requestId', requestId);
      for (var i = 0; i < rows.length; i++) {
        var r = readRow('MC_REQUESTS_SHEET_NAME', rows[i]);
        if (String(r.licenseId) === String(licenseId)) return r;
      }
      return null;
    },
    insertRequest: function (obj) { append('MC_REQUESTS_SHEET_NAME', obj); },
    appendAudit: function (obj) { append('MC_API_AUDIT_SHEET_NAME', obj); },
    appendAdminLog: function (obj) { append('MC_ADMIN_LOG_SHEET_NAME', obj); }
  };
}

// ---------------------------------------------------------------- Google Drive

/**
 * Файлы читаются от имени владельца API. Права доступа к файлам API не меняет никогда:
 * ни setSharing, ни addViewer здесь нет и быть не должно.
 */
function mcDriveAdapter_() {
  return {
    kind: 'drive',
    getFile: function (fileId) {
      try { return DriveApp.getFileById(fileId); } catch (e) { throw mcFail_('SERVICE_UNAVAILABLE', 'Drive: ' + e); }
    },
    /** Лежит ли файл внутри закрытой папки нормативной базы (проверка при регистрации и в проверке целостности). */
    isInRoot: function (fileId) {
      var root = mcCfg_('MC_NORMATIVE_ROOT_FOLDER_ID');
      if (!root) return false;
      var seen = {}, queue = [], f = DriveApp.getFileById(fileId), it = f.getParents();
      while (it.hasNext()) queue.push(it.next());
      for (var depth = 0; queue.length && depth < 200; depth++) {
        var folder = queue.shift(), id = folder.getId();
        if (id === root) return true;
        if (seen[id]) continue;
        seen[id] = true;
        var p = folder.getParents();
        while (p.hasNext()) queue.push(p.next());
      }
      return false;
    }
  };
}
