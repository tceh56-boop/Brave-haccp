/**
 * San.Lab — SheetsStore.gs
 * Хранилище на Google Sheets (файл SANITARY_ERP_DB). Одна строка — одна сущность; связи по ID.
 * Строка 1 — технические имена колонок (стабильны), подписи — в заметках к заголовкам.
 * Запись пакетная: изменения копятся в памяти выполнения и пишутся одним setValues при commitBatch.
 * Если операция упала — rollbackBatch, в таблицу ничего не попадает.
 */

var Store = (function () {
  var ss = null, T = {}, pendingInsert = {}, dirty = {}, batch = false;

  function db() {
    if (ss) return ss;
    var id = PropertiesService.getScriptProperties().getProperty('DB_ID');
    if (!id) throw new Error('База не создана. Запустите setup() из редактора Apps Script.');
    ss = SpreadsheetApp.openById(id);
    return ss;
  }
  function sheet(name) {
    var sh = db().getSheetByName(name);
    if (!sh) throw new Error('Нет листа ' + name + '. Запустите setup().');
    return sh;
  }
  function toCell(col, v) {
    if (v === null || v === undefined) return '';
    if (isDateColumn(col) && typeof v === 'string' && v) { var d = new Date(v); return isNaN(d.getTime()) ? v : d; }
    return v;
  }
  function fromCell(v) {
    if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString();
    return v;
  }
  function load(name) {
    if (T[name]) return T[name];
    var sh = sheet(name), cols = SCHEMA[name];
    var last = sh.getLastRow(), rows = [], idx = {};
    var header = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
    var map = cols.map(function (c) { return header.indexOf(c); });
    for (var m = 0; m < map.length; m++) if (map[m] < 0) throw new Error('В листе ' + name + ' нет колонки ' + cols[m] + '. Запустите setup() для обновления схемы.');
    if (last > 1) {
      var data = sh.getRange(2, 1, last - 1, header.length).getValues();
      for (var i = 0; i < data.length; i++) {
        var o = {};
        for (var j = 0; j < cols.length; j++) o[cols[j]] = fromCell(data[i][map[j]]);
        if (o[cols[0]] === '' || o[cols[0]] === null) continue;
        o.__row = i + 2;
        rows.push(o); idx[o[cols[0]]] = o;
      }
    }
    var pend = pendingInsert[name] || [];
    for (var q = 0; q < pend.length; q++) { rows.push(pend[q]); idx[pend[q][cols[0]]] = pend[q]; }
    T[name] = { rows: rows, idx: idx, map: map, width: header.length };
    return T[name];
  }
  function clean(o) { var r = {}; for (var k in o) if (o.hasOwnProperty(k) && k !== '__row') r[k] = o[k]; return r; }
  function rowValues(name, o, width, map) {
    var cols = SCHEMA[name], arr = [];
    for (var w = 0; w < width; w++) arr.push('');
    for (var j = 0; j < cols.length; j++) arr[map[j]] = toCell(cols[j], o[cols[j]]);
    return arr;
  }

  /* Идемпотентность запросов — в кэше скрипта (6 часов), без роста листа */
  var reqCache = function () { return CacheService.getScriptCache(); };

  var api = {
    all: function (name) { return load(name).rows.map(clean); },
    get: function (name, id) {
      if (name === 'Requests') { var c = reqCache().get('req_' + id); return c ? JSON.parse(c) : null; }
      var r = load(name).idx[id]; return r ? clean(r) : null;
    },
    insert: function (name, obj) {
      if (name === 'Requests') { var js = JSON.stringify(obj); if (js.length < 95000) reqCache().put('req_' + obj.request_id, js, 21600); return obj; }
      var key = SCHEMA[name][0], row = clean(obj);
      if (!T[name] && name !== 'AuditLog' && name !== 'SystemErrors') load(name);
      if (T[name]) {
        if (T[name].idx[row[key]]) throw new Error('Дубликат ключа ' + row[key]);
        T[name].rows.push(row); T[name].idx[row[key]] = row;
      }
      (pendingInsert[name] = pendingInsert[name] || []).push(row);
      if (!batch) api.commitBatch();
      return clean(row);
    },
    update: function (name, id, patch) {
      var t = load(name), row = t.idx[id];
      if (!row) throw new Error('Нет записи ' + id + ' в ' + name);
      for (var k in patch) if (patch.hasOwnProperty(k)) row[k] = patch[k];
      if (row.__row) { dirty[name] = dirty[name] || {}; dirty[name][id] = row; }
      if (!batch) api.commitBatch();
      return clean(row);
    },
    nextSeq: function (prefix) {
      var lock = LockService.getScriptLock(), had = lock.hasLock();
      if (!had) lock.waitLock(20000);
      try {
        var props = PropertiesService.getScriptProperties();
        var n = Number(props.getProperty('SEQ_' + prefix) || 0) + 1;
        props.setProperty('SEQ_' + prefix, String(n));
        return n;
      } finally { if (!had) lock.releaseLock(); }
    },
    beginBatch: function () { batch = true; },
    commitBatch: function () {
      var name;
      for (name in dirty) {
        if (!dirty.hasOwnProperty(name)) continue;
        var t = load(name), sh = sheet(name);
        for (var id in dirty[name]) {
          var r = dirty[name][id];
          sh.getRange(r.__row, 1, 1, t.width).setValues([rowValues(name, r, t.width, t.map)]);
        }
      }
      for (name in pendingInsert) {
        if (!pendingInsert.hasOwnProperty(name) || !pendingInsert[name].length) continue;
        var sh2 = sheet(name);
        var header = sh2.getRange(1, 1, 1, sh2.getLastColumn()).getValues()[0];
        var map = SCHEMA[name].map(function (c) { return header.indexOf(c); });
        var start = sh2.getLastRow() + 1;
        var values = pendingInsert[name].map(function (o) { return rowValues(name, o, header.length, map); });
        sh2.getRange(start, 1, values.length, header.length).setValues(values);
        if (T[name]) for (var i = 0; i < pendingInsert[name].length; i++) {
          var key = SCHEMA[name][0], o = T[name].idx[pendingInsert[name][i][key]];
          if (o) o.__row = start + i;
        }
      }
      dirty = {}; pendingInsert = {}; batch = false;
      SpreadsheetApp.flush();
    },
    rollbackBatch: function () { T = {}; dirty = {}; pendingInsert = {}; batch = false; },
    /* Для резервного копирования и setup */
    spreadsheet: function () { return db(); },
    resetCache: function () { T = {}; ss = null; }
  };
  return api;
})();
