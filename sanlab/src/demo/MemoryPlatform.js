/**
 * San.Lab — MemoryPlatform.js
 * Хранилище в памяти и имитация Google-сервисов для демо и автотестов.
 * Реализует тот же интерфейс, что SheetsStore.gs и GoogleIntegrations.gs.
 */

var Store = (function () {
  var T = {}, seq = {}, journal = null;
  function tbl(name) {
    if (!T[name]) { if (!SCHEMA[name]) throw new Error('Нет таблицы ' + name); T[name] = { rows: [], idx: {} }; }
    return T[name];
  }
  function copy(o) { var r = {}; for (var k in o) if (o.hasOwnProperty(k)) r[k] = o[k]; return r; }
  return {
    all: function (name) { return tbl(name).rows.map(copy); },
    get: function (name, id) { var r = tbl(name).idx[id]; return r ? copy(r) : null; },
    insert: function (name, obj) {
      var t = tbl(name), key = SCHEMA[name][0], row = copy(obj);
      if (t.idx[row[key]]) throw new Error('Дубликат ключа ' + row[key]);
      t.rows.push(row); t.idx[row[key]] = row;
      if (journal) journal.push(function () { t.rows.splice(t.rows.indexOf(row), 1); delete t.idx[row[key]]; });
      return copy(row);
    },
    update: function (name, id, patch) {
      var t = tbl(name), row = t.idx[id];
      if (!row) throw new Error('Нет записи ' + id);
      var before = copy(row);
      for (var k in patch) if (patch.hasOwnProperty(k)) row[k] = patch[k];
      if (journal) journal.push(function () { for (var k2 in row) delete row[k2]; for (var k3 in before) row[k3] = before[k3]; });
      return copy(row);
    },
    nextSeq: function (prefix) {
      var before = seq[prefix] || 0;
      seq[prefix] = before + 1;
      return seq[prefix];
    },
    beginBatch: function () { journal = []; },
    commitBatch: function () { journal = null; },
    rollbackBatch: function () { if (journal) { for (var i = journal.length - 1; i >= 0; i--) journal[i](); } journal = null; },
    dump: function () { var o = {}; for (var k in T) o[k] = T[k].rows; return { tables: o, seq: seq }; },
    load: function (d) {
      T = {}; seq = d.seq || {};
      for (var k in d.tables) { var t = tbl(k); d.tables[k].forEach(function (r) { t.rows.push(r); t.idx[r[SCHEMA[k][0]]] = r; }); }
    },
    reset: function () { T = {}; seq = {}; journal = null; },
    stats: function () { var o = {}; for (var k in T) o[k] = T[k].rows.length; return o; }
  };
})();

var Integr = (function () {
  var files = {}, events = {}, cache = {}, outbox = [], n = 0, failCal = 0, nowOverride = null, folders = {};
  function hashStr(s) {
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < s.length; i++) { h1 ^= s.charCodeAt(i); h1 = Math.imul(h1, 16777619) >>> 0; h2 = Math.imul(h2 ^ s.charCodeAt(i), 2654435761) >>> 0; }
    return ('00000000' + h1.toString(16)).slice(-8) + ('00000000' + h2.toString(16)).slice(-8);
  }
  return {
    now: function () { return nowOverride || new Date().toISOString(); },
    setNow: function (iso) { nowOverride = iso; },
    currentEmail: function (token) { return token || ''; },
    withLock: function (fn) { return fn(); },
    hash: function (s) { return 'demo$' + hashStr(String(s)); },
    cacheGet: function (k) { var c = cache[k]; return c && c.exp > Date.now() ? c.v : null; },
    cachePut: function (k, v, sec) { cache[k] = { v: v, exp: Date.now() + sec * 1000 }; },
    ensureFolder: function (path) { var id = 'FLD-' + path.join('/'); folders[id] = true; return id; },
    saveFile: function (folderId, name, mime, b64) { n++; var id = 'DRV' + n; files[id] = { name: name, mime: mime, base64: b64, folder: folderId }; return { fileId: id, size: Math.floor(b64.length * 3 / 4) }; },
    readFile: function (id, thumb) { var f = files[id]; if (!f) throw new Error('Файл не найден в хранилище'); return { mime: f.mime, base64: f.base64, name: f.name }; },
    makePdf: function (folderId, name, html) {
      n++; var id = 'DRV' + n;
      var b64 = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(html))) : Buffer.from(html, 'utf8').toString('base64');
      files[id] = { name: name, mime: 'text/html', base64: b64, folder: folderId, html: true };
      return { fileId: id, size: html.length };
    },
    failNextCalendar: function () { failCal++; },
    calendarUpsert: function (eventId, p) {
      if (failCal > 0) { failCal--; throw new Error('Calendar API: Service invoked too many times (имитация)'); }
      if (eventId && events[eventId]) { events[eventId] = p; return eventId; }
      for (var k in events) if (events.hasOwnProperty(k) && events[k].tag === p.tag && !events[k].cancelled) { events[k] = p; return k; }
      n++; var id = 'EV' + n; events[id] = p; return id;
    },
    calendarCancel: function (eventId) { if (events[eventId]) events[eventId].cancelled = true; },
    sendMail: function (to, subject, body) { outbox.push({ to: to, subject: subject, body: body }); },
    _events: function () { return events; },
    _outbox: function () { return outbox; },
    _files: function () { return files; },
    dump: function () { return { files: files, events: events, n: n }; },
    load: function (d) { files = d.files || {}; events = d.events || {}; n = d.n || 0; },
    reset: function () { files = {}; events = {}; cache = {}; outbox = []; n = 0; failCal = 0; }
  };
})();
