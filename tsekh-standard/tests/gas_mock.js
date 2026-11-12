// Минимальная имитация сервисов Apps Script для автотестов в Node (без сети).
const crypto = require('crypto');
function mkSheet(name) {
  const s = { name, data: [], getName: () => name,
    getLastRow: () => s.data.length,
    getRange(r, c, nr = 1, nc = 1) {
      return {
        setValues(v) { for (let i = 0; i < v.length; i++) { s.data[r - 1 + i] = s.data[r - 1 + i] || []; for (let j = 0; j < v[i].length; j++) s.data[r - 1 + i][c - 1 + j] = v[i][j]; } return this; },
        getValues() { const o = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(((s.data[r - 1 + i] || [])[c - 1 + j]) ?? ''); o.push(row); } return o; },
        setValue(v) { s.data[r - 1] = s.data[r - 1] || []; s.data[r - 1][c - 1] = v; return this; },
        setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; }, clearContent() { for (let i = 0; i < nr; i++) s.data[r - 1 + i] = []; return this; }
      };
    },
    getDataRange() { const w = Math.max(1, ...s.data.map(r => r.length)); return s.getRange(1, 1, Math.max(1, s.data.length), w); },
    appendRow(row) { s.data.push(row.slice()); }, setFrozenRows() {}, deleteRow(r) { s.data.splice(r - 1, 1); }
  };
  return s;
}
function mkBook(id) { const sheets = {}; return { getId: () => id, getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = mkSheet(n)), getSheets: () => Object.values(sheets), deleteSheet: s => delete sheets[s.name] }; }
function props() { const m = {}; return { getProperty: k => (k in m ? m[k] : null), setProperty: (k, v) => { m[k] = String(v); }, deleteProperty: k => { delete m[k]; }, setProperties: (o, deleteOthers) => { if (deleteOthers) Object.keys(m).forEach(k => { delete m[k]; }); Object.keys(o).forEach(k => { m[k] = String(o[k]); }); }, getProperties: () => Object.assign({}, m), _m: m }; }
function cache() { const m = {}; return { get: k => m[k] ?? null, put: (k, v) => { m[k] = v; }, remove: k => { delete m[k]; } }; }
const toBytes = buf => [...buf].map(b => (b > 127 ? b - 256 : b));
function make(email) {
  const books = {}; const P = props(), C = cache();
  const g = {
    console, Logger: { log: () => {} },
    PropertiesService: { getScriptProperties: () => P },
    CacheService: { getScriptCache: () => C },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    SpreadsheetApp: { create: n => { const id = 'SS' + Object.keys(books).length; return (books[id] = mkBook(id)); }, openById: id => books[id], flush() {} },
    Session: { getEffectiveUser: () => ({ getEmail: () => email }), getActiveUser: () => ({ getEmail: () => email }), getScriptTimeZone: () => 'Europe/Moscow' },
    DriveApp: { getFileById: () => ({ moveTo() {}, makeCopy: () => ({ getId: () => 'copy', getSize: () => 1, getUrl: () => 'u' }) }), createFolder: () => ({ getId: () => 'F', getFoldersByName: () => ({ hasNext: () => false }), createFolder: () => ({}) }), getFolderById: () => { throw new Error('x'); } },
    MailApp: { sendEmail() {}, getRemainingDailyQuota: () => 100 },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/ADMIN/exec' }), getScriptId: () => 'SCRIPT', getOAuthToken: () => 't', getProjectTriggers: () => [] },
    ContentService: { createTextOutput: t => ({ text: t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      computeDigest: (alg, s) => toBytes(crypto.createHash(alg === 'SHA_1' ? 'sha1' : alg === 'MD5' ? 'md5' : 'sha256').update(String(s), 'utf8').digest()),
      computeHmacSha256Signature: (s, k) => toBytes(crypto.createHmac('sha256', String(k)).update(String(s), 'utf8').digest()),
      DigestAlgorithm: { SHA_256: 'SHA_256', SHA_1: 'SHA_1', MD5: 'MD5' }, Charset: { UTF_8: 'utf8' },
      base64Encode: s => Buffer.from(s).toString('base64'), base64EncodeWebSafe: b => Buffer.from(Array.isArray(b) ? b.map(x => x & 255) : String(b)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'), formatDate: (d, tz, f) => { const x = new Date(d); const p = n => String(n).padStart(2, '0');
        return f.replace('yyyy', x.getFullYear()).replace('yy', String(x.getFullYear()).slice(2)).replace('MM', p(x.getMonth() + 1)).replace('dd', p(x.getDate())).replace('HH', p(x.getHours())).replace('mm', p(x.getMinutes())).replace('ss', p(x.getSeconds())); },
      sleep() {}
    }
  };
  return g;
}
module.exports = { make };
