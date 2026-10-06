// Локальный стенд: все gas/*.gs в одном контексте Node с имитацией сервисов Apps Script.
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const GAS = process.argv[2] || require('path').join(__dirname, '../../gas');

function makeSheet(name) {
  const data = [];
  const sh = {
    name, data,
    getDataRange() { return { getValues: () => data.map(r => r.slice()), getA1Notation: () => data.length ? 'A1:Z' + data.length : 'A1' }; },
    appendRow(row) { data.push(row.slice()); },
    getRange(r, c, nr, nc) {
      if (typeof r === 'string') return { getValue: () => (data[0] || [])[0] || '' };
      nr = nr || 1; nc = nc || 1;
      return {
        getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = data[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(o); } return out; },
        setValues(v) { for (let i = 0; i < v.length; i++) { data[r - 1 + i] = data[r - 1 + i] || []; for (let j = 0; j < v[i].length; j++) data[r - 1 + i][c - 1 + j] = v[i][j]; } },
        getValue() { return (data[r - 1] || [])[c - 1]; }, setValue(v) { data[r - 1] = data[r - 1] || []; data[r - 1][c - 1] = v; },
        setFontWeight() { return this; }, setBackground() { return this; }
      };
    },
    setFrozenRows() {}, getLastRow() { return data.length; }, getLastColumn() { return (data[0] || []).length; },
    getName() { return name; }, deleteRows() {}, clear() { data.length = 0; }
  };
  return sh;
}
const sheets = {};
const ss = {
  getSheetByName: n => sheets[n] || null,
  insertSheet: n => (sheets[n] = makeSheet(n)),
  getSheets: () => Object.values(sheets), getId: () => 'SS', deleteSheet() {}
};
const props = {};
const cacheStore = {};
const ctx = {
  console, JSON, Math, Date, Object, Array, String, Number, Boolean, RegExp, Error, isNaN, parseFloat, parseInt, encodeURIComponent,
  SpreadsheetApp: { openById: () => ss, getActiveSpreadsheet: () => ss, flush() {} },
  CacheService: { getScriptCache: () => ({ get: k => (k in cacheStore ? cacheStore[k] : null), put: (k, v) => { cacheStore[k] = v; }, remove: k => { delete cacheStore[k]; }, removeAll: ks => ks.forEach(k => delete cacheStore[k]), getAll: () => ({}), putAll() {} }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {}, hasLock: () => true }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; }, getProperties: () => props, deleteProperty: k => { delete props[k]; }, setProperties() {} }) },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    formatDate: (d, tz, f) => { const x = new Date(d.getTime() + 3 * 3600e3).toISOString(); return f === 'yyyy-MM-dd' ? x.slice(0, 10) : f === 'H' ? String(Number(x.slice(11, 13))) : x; },
    computeDigest: (a, s) => Array.from(crypto.createHash('sha256').update(String(s)).digest()).map(b => b > 127 ? b - 256 : b),
    computeHmacSha256Signature: (v, k) => Array.from(crypto.createHmac('sha256', String(k)).update(String(v)).digest()).map(b => b > 127 ? b - 256 : b),
    DigestAlgorithm: { SHA_256: 'sha256', MD5: 'md5' }, Charset: { UTF_8: 'utf8' },
    base64Encode: x => Buffer.from(x).toString('base64'), sleep() {}, newBlob: x => ({ getBytes: () => Buffer.from(String(x)) })
  },
  Session: { getScriptTimeZone: () => 'Europe/Moscow', getActiveUser: () => ({ getEmail: () => 'test@local' }) },
  Logger: { log() {} },
  MailApp: { sendEmail() {} }, UrlFetchApp: { fetch() { throw new Error('no network in harness'); } },
  ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create() {} }), everyHours: () => ({ create() {} }), create() {} }) }) },
  HtmlService: { createHtmlOutputFromFile: () => ({ setTitle() { return this; }, addMetaTag() { return this; }, setXFrameOptionsMode() { return this; } }), XFrameOptionsMode: {} },
  ContentService: { createTextOutput: x => ({ setMimeType() { return this; }, x }), MimeType: { JSON: 'json' } },
  DriveApp: {}, GmailApp: {}
};
ctx.globalThis = ctx;
vm.createContext(ctx);
const files = fs.readdirSync(GAS).filter(f => f.endsWith('.gs')).sort();
let src = files.map(f => '// ==== ' + f + '\n' + fs.readFileSync(path.join(GAS, f), 'utf8')).join('\n;\n');
// var-объявления верхнего уровня должны попасть в контекст, поэтому выполняем одним скриптом.
vm.runInContext(src, ctx, { filename: 'gas-bundle.js' });
module.exports = { ctx, sheets };
