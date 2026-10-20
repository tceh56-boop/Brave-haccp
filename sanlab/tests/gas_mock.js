/* Имитация сервисов Google Apps Script для проверки SheetsStore.gs / GoogleIntegrations.gs / Setup.gs в Node. */
var crypto = require('crypto');
module.exports = function () {
  var ids = 0, nid = function (p) { return p + (++ids); };
  var props = {}, cache = {}, current = { email: '' }, files = {}, folders = {}, events = {}, failCal = { n: 0 }, mail = [];
  var stats = { setValues: 0, reads: 0 };

  function Range(sh, r, c, nr, nc) {
    var self = {
      getValues: function () { stats.reads++; var out = []; for (var i = 0; i < nr; i++) { var row = []; for (var j = 0; j < nc; j++) { var v = (sh._d[r - 1 + i] || [])[c - 1 + j]; row.push(v === undefined ? '' : v); } out.push(row); } return out; },
      setValues: function (vals) {
        stats.setValues++;
        if (vals.length !== nr || vals[0].length !== nc) throw new Error('setValues: размер не совпадает ' + vals.length + 'x' + vals[0].length + ' vs ' + nr + 'x' + nc);
        for (var i = 0; i < nr; i++) { sh._d[r - 1 + i] = sh._d[r - 1 + i] || []; for (var j = 0; j < nc; j++) { var v = vals[i][j]; if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) throw new Error('ISO-строка записана в ячейку вместо даты: ' + v); sh._d[r - 1 + i][c - 1 + j] = v instanceof Date ? new Date(v.getTime()) : v; } }
        return self;
      }
    };
    ['setFontWeight', 'setBackground', 'setFontColor', 'setNote', 'setNumberFormat'].forEach(function (m) { self[m] = function () { return self; }; });
    return self;
  }
  function Sheet(name) {
    var sh = { _d: [], _name: name, _prot: [] };
    sh.getName = function () { return name; };
    sh.getLastRow = function () { var n = 0; for (var i = 0; i < sh._d.length; i++) if (sh._d[i] && sh._d[i].some(function (v) { return v !== '' && v !== undefined && v !== null; })) n = i + 1; return n; };
    sh.getLastColumn = function () { var m = 0; sh._d.forEach(function (r) { if (r) for (var j = r.length - 1; j >= 0; j--) if (r[j] !== '' && r[j] !== undefined) { m = Math.max(m, j + 1); break; } }); return m; };
    sh.getRange = function (r, c, nr, nc) { return Range(sh, r, c, nr || 1, nc || 1); };
    sh.setFrozenRows = function () { };
    sh.getMaxRows = function () { return 1000; };
    sh.getProtections = function () { return sh._prot; };
    sh.protect = function () { var p = { setDescription: function () { return p; }, removeEditors: function () { return p; }, getEditors: function () { return []; }, canDomainEdit: function () { return false; }, setDomainEdit: function () { return p; } }; sh._prot.push(p); return p; };
    return sh;
  }
  function Spreadsheet(id) {
    var sheets = [Sheet('Sheet1')];
    var ss = {
      getId: function () { return id; }, getUrl: function () { return 'https://docs/' + id; }, setSpreadsheetTimeZone: function () { },
      getSheetByName: function (n) { return sheets.filter(function (s) { return s._name === n; })[0] || null; },
      insertSheet: function (n) { var s = Sheet(n); sheets.push(s); return s; },
      getSheets: function () { return sheets.slice(); }, deleteSheet: function (s) { sheets.splice(sheets.indexOf(s), 1); }
    };
    return ss;
  }
  var spreadsheets = {};
  function Blob(bytes, mime, name) {
    var b = { _b: Buffer.from(bytes), _m: mime, _n: name };
    b.getBytes = function () { return Array.prototype.slice.call(b._b); };
    b.getContentType = function () { return b._m; };
    b.getAs = function (m) { return Blob(Buffer.concat([Buffer.from('%PDF-1.4 '), b._b]), m, b._n); };
    b.setName = function (n) { b._n = n; return b; };
    return b;
  }
  function File(blob, parent) {
    var id = nid('file'), f = { _blob: blob, _parent: parent, _name: blob._n, _created: new Date(Date.now() + ids) };
    f.getId = function () { return id; }; f.getUrl = function () { return 'https://drive/' + id; }; f.getName = function () { return f._name; }; f.setName = function (n) { f._name = n; return f; };
    f.getSize = function () { return blob._b.length; }; f.getMimeType = function () { return blob._m; };
    f.getBlob = function () { return blob; }; f.getThumbnail = function () { return /^image/.test(blob._m) ? blob : null; };
    f.makeCopy = function (n, folder) {
      var c = File(Blob(blob._b, blob._m, n), folder);
      if (spreadsheets[id]) {
        var src = spreadsheets[id].ss, dst = Spreadsheet(c.getId());
        dst.getSheets().forEach(function (s) { dst.deleteSheet(s); });
        src.getSheets().forEach(function (s) { var t = dst.insertSheet(s._name); t._d = s._d.map(function (r) { return (r || []).map(function (v) { return v instanceof Date ? new Date(v.getTime()) : v; }); }); });
        spreadsheets[c.getId()] = { ss: dst };
      }
      return c;
    };
    f.getDateCreated = function () { return f._created; }; f.setTrashed = function () { delete files[id]; };
    files[id] = f; return f;
  }
  function Folder(name, parent) {
    var id = nid('fld'), kids = [], fl = {};
    fl.getId = function () { return id; }; fl.getName = function () { return name; }; fl.getUrl = function () { return 'https://drive/' + id; };
    fl.createFolder = function (n) { var k = Folder(n, fl); kids.push(k); return k; };
    fl.getFoldersByName = function (n) { var m = kids.filter(function (k) { return k.getName() === n; }); var i = 0; return { hasNext: function () { return i < m.length; }, next: function () { return m[i++]; } }; };
    fl.createFile = function (blob) { return File(blob, fl); };
    fl.addFile = function () { }; fl.removeFile = function () { };
    fl.getFiles = function () { var m = Object.keys(files).map(function (k) { return files[k]; }).filter(function (f) { return f._parent === fl; }); var i = 0; return { hasNext: function () { return i < m.length; }, next: function () { return m[i++]; } }; };
    folders[id] = fl; return fl;
  }
  var rootFolder = Folder('root');
  function Event(title, start, end, opts) {
    var id = nid('ev'), e = { _t: title, _s: start, _e: end, _d: (opts || {}).description || '', _guests: [] };
    e.getId = function () { return id; }; e.setTitle = function (t) { e._t = t; }; e.setTime = function (s, en) { e._s = s; e._e = en; };
    e.setLocation = function () { }; e.setDescription = function (d) { e._d = d; }; e.getDescription = function () { return e._d; };
    e.getGuestByEmail = function (m) { return e._guests.indexOf(m) >= 0 ? {} : null; }; e.addGuest = function (m) { e._guests.push(m); };
    e.deleteEvent = function () { delete events[id]; };
    events[id] = e; return e;
  }
  var cal = {
    createEvent: function (t, s, e, o) { if (failCal.n > 0) { failCal.n--; throw new Error('Calendar: Service invoked too many times'); } return Event(t, s, e, o); },
    getEventById: function (id) { if (failCal.n > 0) { failCal.n--; throw new Error('Calendar unavailable'); } return events[id] || null; },
    getEvents: function (a, b, o) { return Object.keys(events).map(function (k) { return events[k]; }).filter(function (e) { return e._s >= a && e._s <= b && (!o || !o.search || e._d.indexOf(o.search) >= 0); }); }
  };

  var g = {
    PropertiesService: { getScriptProperties: function () { return { getProperty: function (k) { return props[k] === undefined ? null : props[k]; }, setProperty: function (k, v) { props[k] = String(v); } }; } },
    CacheService: { getScriptCache: function () { return { get: function (k) { var c = cache[k]; return c && c.exp > Date.now() ? c.v : null; }, put: function (k, v, s) { cache[k] = { v: String(v), exp: Date.now() + s * 1000 }; } }; } },
    LockService: { getScriptLock: function () { var held = false; return { hasLock: function () { return held; }, waitLock: function () { held = true; }, tryLock: function () { held = true; return true; }, releaseLock: function () { held = false; } }; } },
    SpreadsheetApp: {
      openById: function (id) { var s = spreadsheets[id]; if (!s) throw new Error('Нет таблицы ' + id); return s.ss; },
      create: function (name) { var f = File(Blob('', 'application/vnd.google-apps.spreadsheet', name), rootFolder); var ss = Spreadsheet(f.getId()); spreadsheets[f.getId()] = { ss: ss }; return ss; },
      flush: function () { }, ProtectionType: { SHEET: 'SHEET' }
    },
    DriveApp: { createFolder: function (n) { return rootFolder.createFolder(n); }, getFolderById: function (id) { if (!folders[id]) throw new Error('Нет папки ' + id); return folders[id]; }, getFileById: function (id) { if (!files[id]) throw new Error('Нет файла ' + id); return files[id]; }, getRootFolder: function () { return rootFolder; } },
    Utilities: {
      newBlob: function (data, mime, name) { return Blob(typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data.map(function (b) { return b & 255; })), mime, name); },
      base64Decode: function (s) { return Array.prototype.slice.call(Buffer.from(s, 'base64')).map(function (b) { return b > 127 ? b - 256 : b; }); },
      base64Encode: function (bytes) { return Buffer.from(bytes.map(function (b) { return b & 255; })).toString('base64'); },
      computeDigest: function (alg, s) { return Array.prototype.slice.call(crypto.createHash('sha256').update(s, 'utf8').digest()).map(function (b) { return b > 127 ? b - 256 : b; }); },
      DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
      getUuid: function () { return crypto.randomUUID(); },
      formatDate: function (d) { return d.toISOString().slice(0, 16).replace('T', '_').replace(':', ''); }
    },
    Session: { getActiveUser: function () { return { getEmail: function () { return current.email; } }; }, getEffectiveUser: function () { return { getEmail: function () { return 'denis.owner@sanlab.ru'; } }; } },
    CalendarApp: { getDefaultCalendar: function () { return cal; }, getCalendarById: function () { return cal; } },
    MailApp: { getRemainingDailyQuota: function () { return 100; }, sendEmail: function (o) { mail.push(o); } },
    ScriptApp: { getProjectTriggers: function () { return []; }, deleteTrigger: function () { }, newTrigger: function () { var t = { timeBased: function () { return t; }, everyDays: function () { return t; }, atHour: function () { return t; }, inTimezone: function () { return t; }, everyMinutes: function () { return t; }, create: function () { return t; } }; return t; } },
    Logger: { log: function () { } },
    HtmlService: {}
  };
  g.__mock = { current: current, events: events, failCal: failCal, mail: mail, stats: stats, props: props, spreadsheets: spreadsheets, files: files };
  return g;
};
