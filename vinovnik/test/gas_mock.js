/**
 * Мок-окружение Google Apps Script для проверки MON CHEF · Кафе в Node.
 * Таблица — в памяти; кэш, свойства, блокировка — простые заглушки. Загружает .gs файлы
 * проекта в том же порядке, что установщик (Code.gs первым, затем по имени), в один контекст.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');

function deepStub(name) {
  const f = function () { return deepStub(name + '()'); };
  return new Proxy(f, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'toString' || k === 'valueOf') return () => '';
      if (k === 'then') return undefined;
      return deepStub(name + '.' + String(k));
    },
    apply() { return deepStub(name + '()'); }
  });
}
function chain(obj) {
  return new Proxy(obj, { get(t, k) { if (k in t) return t[k]; if (typeof k === 'symbol') return undefined; return function () { return chain(t); }; } });
}

function colToN(s) { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
function parseA1(a1) {
  const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i.exec(String(a1).replace(/\$/g, ''));
  if (!m) throw new Error('A1 not supported: ' + a1);
  const r = +m[2], c = colToN(m[1]); if (!m[3]) return [r, c, 1, 1];
  return [r, c, +m[4] - r + 1, colToN(m[3]) - c + 1];
}

class Sheet {
  constructor(book, name) { this.book = book; this.name = name; this.data = []; this.id = Math.floor(Math.random() * 1e9); }
  _w() { return this.data.reduce((a, r) => Math.max(a, r.length), 0); }
  _ensure(r, c) { while (this.data.length < r) this.data.push([]); for (let i = 0; i < r; i++) while (this.data[i].length < c) this.data[i].push(''); }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getSheetId() { return this.id; }
  getIndex() { return this.book.sheets.indexOf(this) + 1; }
  getLastRow() { for (let i = this.data.length - 1; i >= 0; i--) if (this.data[i].some(x => x !== '' && x !== null && x !== undefined)) return i + 1; return 0; }
  getLastColumn() { let w = 0; this.data.forEach(r => { for (let j = r.length - 1; j >= 0; j--) if (r[j] !== '' && r[j] !== null && r[j] !== undefined) { w = Math.max(w, j + 1); break; } }); return w; }
  getMaxRows() { return Math.max(1000, this.data.length); }
  getMaxColumns() { return Math.max(26, this._w()); }
  appendRow(row) { const lr = this.getLastRow(); this.data.splice(lr, 0, row.map(x => x === undefined || x === null ? '' : x)); this.data.length = Math.max(this.data.length, lr + 1); this.data = this.data.slice(0, lr + 1).concat(this.data.slice(lr + 1)); return this; }
  getRange(a, b, c, d) {
    let r, col, nr, nc;
    if (typeof a === 'string') [r, col, nr, nc] = parseA1(a); else { r = a; col = b; nr = c === undefined ? 1 : c; nc = d === undefined ? 1 : d; }
    return new Range(this, r, col, nr, nc);
  }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  insertRowsAfter(after, n) { this._ensure(after, 0); const blank = []; for (let i = 0; i < n; i++) blank.push([]); this.data.splice(after, 0, ...blank); return this; }
  insertRowBefore(i) { return this.insertRowsAfter(i - 1, 1); }
  insertRowAfter(i) { return this.insertRowsAfter(i, 1); }
  deleteRow(i) { this.data.splice(i - 1, 1); return this; }
  deleteRows(i, n) { this.data.splice(i - 1, n); return this; }
  clear() { this.data = []; return this; }
  clearContents() { this.data = []; return this; }
  getFrozenRows() { return 1; }
  getFrozenColumns() { return 0; }
  isSheetHidden() { return false; }
  getParent() { return this.book; }
}
['setFrozenRows', 'setFrozenColumns', 'hideSheet', 'showSheet', 'setColumnWidth', 'setColumnWidths', 'autoResizeColumns', 'autoResizeColumn', 'setTabColor', 'activate', 'setRowHeight', 'setConditionalFormatRules', 'insertColumnAfter', 'insertColumnsAfter', 'setHiddenGridlines', 'clearFormats', 'clearNotes']
  .forEach(m => { Sheet.prototype[m] = function () { return this; }; });
Sheet.prototype.protect = function () { return chain({}); };
Sheet.prototype.getProtections = function () { return []; };
Sheet.prototype.getConditionalFormatRules = function () { return []; };

class Range {
  constructor(sh, r, c, nr, nc) { this.sh = sh; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const src = this.sh.data[this.r - 1 + i] || [], row = []; for (let j = 0; j < this.nc; j++) { const x = src[this.c - 1 + j]; row.push(x === undefined || x === null ? '' : x); } out.push(row); } return out; }
  getDisplayValues() { return this.getValues().map(r => r.map(x => String(x))); }
  getValue() { return this.getValues()[0][0]; }
  getDisplayValue() { return String(this.getValue()); }
  setValues(v) { if (!Array.isArray(v) || v.length !== this.nr || v.some(r => r.length !== this.nc)) throw new Error('setValues: размер не совпадает ' + this.nr + 'x' + this.nc + ' vs ' + v.length + 'x' + (v[0] || []).length);
    this.sh._ensure(this.r + this.nr - 1, this.c + this.nc - 1); for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sh.data[this.r - 1 + i][this.c - 1 + j] = v[i][j] === undefined || v[i][j] === null ? '' : v[i][j]; return this; }
  setValue(x) { this.sh._ensure(this.r, this.c); this.sh.data[this.r - 1][this.c - 1] = x === undefined || x === null ? '' : x; return this; }
  getRow() { return this.r; } getColumn() { return this.c; } getNumRows() { return this.nr; } getNumColumns() { return this.nc; } getLastRow() { return this.r + this.nr - 1; } getLastColumn() { return this.c + this.nc - 1; }
  getSheet() { return this.sh; }
  clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) { const row = this.sh.data[this.r - 1 + i]; if (row) row[this.c - 1 + j] = ''; } return this; }
  getFormulas() { return this.getValues().map(r => r.map(() => '')); }
  getNotes() { return this.getValues().map(r => r.map(() => '')); }
  getBackgrounds() { return this.getValues().map(r => r.map(() => '#ffffff')); }
}
['setFontWeight', 'setNumberFormat', 'setBackground', 'setFontColor', 'setWrap', 'setHorizontalAlignment', 'setVerticalAlignment', 'setNote', 'setFormula', 'setBorder', 'setDataValidation', 'merge', 'setFontSize', 'setBackgrounds', 'setFontWeights', 'clearFormat', 'setNumberFormats', 'setFontStyle', 'setFormulas', 'clear', 'clearDataValidations', 'activate', 'setWrapStrategy', 'setNotes', 'protect', 'sort', 'setFontFamily', 'setFontLine', 'removeCheckboxes', 'insertCheckboxes']
  .forEach(m => { Range.prototype[m] = function () { return this; }; });

class Book {
  constructor() { this.sheets = []; this.id = 'BOOK'; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { if (this.getSheetByName(n)) throw new Error('Лист уже есть: ' + n); const s = new Sheet(this, n || ('Лист' + (this.sheets.length + 1))); this.sheets.push(s); return s; }
  getSheets() { return this.sheets.slice(); }
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
  getId() { return this.id; } getUrl() { return 'https://docs.google.com/spreadsheets/d/BOOK'; } getName() { return 'Mock book'; }
  getSpreadsheetTimeZone() { return 'Asia/Yekaterinburg'; }
  toast() {} setActiveSheet(s) { return s; } getActiveSheet() { return this.sheets[0]; } addEditor() { return this; } getOwner() { return { getEmail: () => 'owner@test' }; }
  getRangeByName() { return null; } setNamedRange() {} getNamedRanges() { return []; } getProtections() { return []; } getEditors() { return []; } copy() { return this; }
}

function pad(n, w) { return String(n).padStart(w || 2, '0'); }
function tzParts(date, tz) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'Asia/Yekaterinburg', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' });
  const o = {}; f.formatToParts(date).forEach(p => { o[p.type] = p.value; }); return o;
}
function formatDate(date, tz, fmt) {
  if (!(date instanceof Date) || isNaN(date.getTime())) throw new Error('formatDate: не дата ' + date);
  const p = tzParts(date, tz);
  const map = { yyyy: p.year, yy: p.year.slice(2), MM: p.month, dd: p.day, HH: p.hour, mm: p.minute, ss: p.second, SSS: pad(date.getMilliseconds(), 3), EEE: p.weekday, Z: '+0500', XXX: '+05:00' };
  let out = '', i = 0;
  while (i < fmt.length) {
    if (fmt[i] === "'") { const j = fmt.indexOf("'", i + 1); out += fmt.slice(i + 1, j < 0 ? fmt.length : j); i = j < 0 ? fmt.length : j + 1; continue; }
    const tok = ['yyyy', 'SSS', 'EEE', 'XXX', 'yy', 'MM', 'dd', 'HH', 'mm', 'ss', 'Z'].find(t => fmt.startsWith(t, i));
    if (tok) { out += map[tok]; i += tok.length; } else { out += fmt[i]; i++; }
  }
  return out;
}
function toSigned(buf) { return Array.from(buf).map(b => b > 127 ? b - 256 : b); }
function toBuf(x) { return Array.isArray(x) ? Buffer.from(x.map(b => b < 0 ? b + 256 : b)) : Buffer.from(String(x), 'utf8'); }

function makeContext(opts) {
  opts = opts || {};
  const book = new Book(), props = Object.assign({}, opts.props || {}), cache = {}, logs = [];
  const ctx = {
    console: { log: (...a) => { logs.push(a.join(' ')); if (opts.verbose) console.log(...a); }, error: (...a) => logs.push('ERR ' + a.join(' ')), warn: (...a) => logs.push('WARN ' + a.join(' ')), info: (...a) => logs.push(a.join(' ')) },
    Logger: { log: (...a) => logs.push(a.join(' ')) },
    SpreadsheetApp: { openById: () => book, getActive: () => book, getActiveSpreadsheet: () => book, flush: () => {}, create: () => book, openByUrl: () => book,
      newDataValidation: () => chain({ build: () => ({}) }), BorderStyle: {}, WrapStrategy: {}, ProtectionType: { SHEET: 'SHEET', RANGE: 'RANGE' }, newConditionalFormatRule: () => chain({ build: () => ({}) }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null,
      setProperty(k, v) { props[k] = String(v); return this; }, deleteProperty(k) { delete props[k]; return this; },
      getProperties: () => Object.assign({}, props), setProperties(o) { Object.assign(props, o); return this; }, getKeys: () => Object.keys(props) }),
      getUserProperties: () => ({ getProperty: () => null, setProperty() { return this; }, getProperties: () => ({}), deleteProperty() { return this; } }) },
    CacheService: { getScriptCache: () => ({
      get: k => Object.prototype.hasOwnProperty.call(cache, k) ? cache[k] : null, put: (k, v) => { cache[k] = String(v); }, remove: k => { delete cache[k]; },
      removeAll: ks => ks.forEach(k => delete cache[k]), getAll: ks => { const o = {}; ks.forEach(k => { if (k in cache) o[k] = cache[k]; }); return o; }, putAll: o => Object.assign(cache, o) }),
      getUserCache() { return this.getScriptCache(); }, getDocumentCache() { return this.getScriptCache(); } },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {}, hasLock: () => true }), getDocumentLock() { return this.getScriptLock(); }, getUserLock() { return this.getScriptLock(); } },
    Session: { getScriptTimeZone: () => 'Asia/Yekaterinburg', getActiveUser: () => ({ getEmail: () => '' }), getEffectiveUser: () => ({ getEmail: () => 'owner@test' }), getTemporaryActiveUserKey: () => 'k' },
    Utilities: {
      formatDate, getUuid: () => crypto.randomUUID(), sleep() {},
      DigestAlgorithm: { SHA_256: 'sha256', MD5: 'md5', SHA_1: 'sha1', SHA_512: 'sha512' }, Charset: { UTF_8: 'utf8' }, MacAlgorithm: { HMAC_SHA_256: 'sha256' },
      computeDigest: (alg, s) => toSigned(crypto.createHash(alg).update(toBuf(s)).digest()),
      computeHmacSha256Signature: (s, k) => toSigned(crypto.createHmac('sha256', toBuf(k)).update(toBuf(s)).digest()),
      computeHmacSignature: (alg, s, k) => toSigned(crypto.createHmac(alg, toBuf(k)).update(toBuf(s)).digest()),
      base64Encode: x => toBuf(x).toString('base64'), base64EncodeWebSafe: x => toBuf(x).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64Decode: s => toSigned(Buffer.from(s, 'base64')), base64DecodeWebSafe: s => toSigned(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      newBlob: (d, t, n) => chain({ getDataAsString: () => String(d), getBytes: () => toSigned(toBuf(d)), getName: () => n || '', getContentType: () => t || '', setName() { return this; } }),
      jsonStringify: JSON.stringify, jsonParse: JSON.parse, parseCsv: s => String(s).split('\n').map(l => l.split(',')), zip: () => deepStub('zip'), unzip: () => [], gzip: x => x, ungzip: x => x
    },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }), getProjectTriggers: () => [], newTrigger: () => chain({ create: () => ({ getUniqueId: () => 't1' }) }),
      deleteTrigger() {}, getScriptId: () => 'SCRIPT', getOAuthToken: () => 'tok', AuthMode: {}, WeekDay: {}, EventType: {} },
    HtmlService: { createHtmlOutputFromFile: n => chain({ _n: n, getContent: () => '', getTitle: () => n }), createHtmlOutput: h => chain({ getContent: () => String(h || ''), getTitle: () => '' }),
      createTemplateFromFile: n => chain({ evaluate: () => chain({ getContent: () => '' }) }), XFrameOptionsMode: {}, SandboxMode: {} },
    ContentService: { createTextOutput: s => chain({ getContent: () => s }), MimeType: {} },
    DriveApp: deepStub('DriveApp'), MailApp: deepStub('MailApp'), GmailApp: deepStub('GmailApp'), UrlFetchApp: deepStub('UrlFetchApp'), DocumentApp: deepStub('DocumentApp'),
    Drive: deepStub('Drive'), CalendarApp: deepStub('CalendarApp'), FormApp: deepStub('FormApp'), SlidesApp: deepStub('SlidesApp'), XmlService: deepStub('XmlService'), Charts: deepStub('Charts'),
    setTimeout, clearTimeout, Intl, Date, Math, JSON, Promise
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  return { ctx, book, props, cache, logs };
}

function projectFiles(dir) {
  const names = fs.readdirSync(dir).filter(n => /\.gs$/.test(n) && !/^Code_V\d+\.gs$/.test(n) && n !== 'MonChef_V55_63_PRODUCTION_RELEASE.gs').sort();
  return ['Code.gs'].concat(names.filter(n => n !== 'Code.gs'));
}
function load(dir, opts) {
  const env = makeContext(opts);
  for (const n of projectFiles(dir)) {
    const src = fs.readFileSync(path.join(dir, n), 'utf8');
    try { vm.runInContext(src, env.ctx, { filename: n }); }
    catch (e) { throw new Error('Загрузка ' + n + ': ' + (e && e.stack || e)); }
  }
  return env;
}
module.exports = { load, makeContext, projectFiles, formatDate };
