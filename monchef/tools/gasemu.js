// Эмулятор Google Apps Script для стенда MON CHEF: все .gs в одном контексте, таблица в памяти.
const fs = require('fs'), vm = require('vm'), crypto = require('crypto');
const path = require('path');
const G = path.resolve(__dirname, '../app') + '/';

function makeSheet(name) {
  const sh = { name, data: [], frozen: 0 };
  const width = () => sh.data.reduce((m, r) => Math.max(m, r.length), 0);
  const cell = (r, c) => (sh.data[r] && sh.data[r][c] !== undefined ? sh.data[r][c] : '');
  const range = (row, col, nr, nc) => {
    nr = nr || 1; nc = nc || 1;
    const R = {
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(row - 1 + i, col - 1 + j))),
      getValue: () => cell(row - 1, col - 1),
      setValues: v => { v.forEach((rv, i) => { const r = row - 1 + i; while (sh.data.length <= r) sh.data.push([]); rv.forEach((x, j) => { sh.data[r][col - 1 + j] = x; }); }); return R; },
      setValue: v => R.setValues([[v]]),
      getDisplayValues: () => R.getValues().map(r => r.map(String)),
      clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (sh.data[row - 1 + i]) sh.data[row - 1 + i][col - 1 + j] = ''; return R; },
      getNumRows: () => nr, getNumColumns: () => nc, getRow: () => row, getColumn: () => col
    };
    ['setFontWeight', 'setBackground', 'setFontColor', 'setNumberFormat', 'setWrap', 'setHorizontalAlignment', 'setNote', 'protect', 'setDataValidation'].forEach(k => { R[k] = () => R; });
    return R;
  };
  Object.assign(sh, {
    getName: () => name, getSheetName: () => name,
    getLastRow: () => { for (let i = sh.data.length - 1; i >= 0; i--) if ((sh.data[i] || []).some(x => x !== '' && x !== null && x !== undefined)) return i + 1; return 0; },
    getLastColumn: () => width(), getMaxRows: () => Math.max(1000, sh.data.length), getMaxColumns: () => Math.max(26, width()),
    getDataRange: () => range(1, 1, Math.max(1, sh.getLastRow()), Math.max(1, width())),
    getRange: (a, b, c, d) => { if (typeof a === 'string') { const m = /^([A-Z]+)(\d+)$/.exec(a); const col = m[1].split('').reduce((s, ch) => s * 26 + ch.charCodeAt(0) - 64, 0); return range(+m[2], col, 1, 1); } return range(a, b, c, d); },
    appendRow: r => { const n = sh.getLastRow(); sh.data[n] = r.slice(); sh.data.length = Math.max(sh.data.length, n + 1); return sh; },
    setFrozenRows: n => { sh.frozen = n; }, getFrozenRows: () => sh.frozen, clear: () => { sh.data = []; return sh; }, clearContents: () => { sh.data = []; return sh; },
    deleteRow: r => { sh.data.splice(r - 1, 1); }, deleteRows: (r, n) => { sh.data.splice(r - 1, n); }, insertColumnAfter: () => sh, autoResizeColumns: () => sh, hideSheet: () => sh,
    getParent: () => null, getSheetId: () => name.length
  });
  return sh;
}

function makeSpreadsheet() {
  const sheets = {};
  const ss = {
    getId: () => 'SS-TEST', getUrl: () => 'https://docs.google.com/spreadsheets/d/SS-TEST', getName: () => 'MON CHEF стенд',
    getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = makeSheet(n)), deleteSheet: s => { delete sheets[s.name]; },
    getSheets: () => Object.values(sheets), sheets
  };
  return ss;
}

function boot(opts) {
  opts = opts || {};
  const ss = makeSpreadsheet(), props = { SPREADSHEET_ID: 'SS-TEST', ENVIRONMENT: 'TEST' }, cache = new Map(), logs = [];
  let now = opts.now ? new Date(opts.now).getTime() : null;
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { if (!a.length && now) super(now); else super(...a); } static now() { return now || RealDate.now(); } }
  const propStore = { getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); return propStore; }, deleteProperty: k => { delete props[k]; return propStore; }, getProperties: () => Object.assign({}, props), setProperties: o => { Object.assign(props, o); return propStore; }, getKeys: () => Object.keys(props) };
  const cacheStore = { get: k => (cache.has(k) ? cache.get(k) : null), put: (k, v) => { cache.set(k, v); }, remove: k => { cache.delete(k); }, removeAll: ks => ks.forEach(k => cache.delete(k)), getAll: ks => { const o = {}; ks.forEach(k => { if (cache.has(k)) o[k] = cache.get(k); }); return o; }, putAll: o => Object.keys(o).forEach(k => cache.set(k, o[k])) };
  const blob = (bytes, type, name) => { const b = { bytes: Buffer.from(bytes || ''), type: type || '', name: name || '' };
    return Object.assign(b, { getBytes: () => Array.from(b.bytes), getDataAsString: () => b.bytes.toString('utf8'), getContentType: () => b.type, setName: n => { b.name = n; return b; }, getName: () => b.name, getAs: () => { throw new Error('Конвертация в PDF доступна только в Apps Script'); }, copyBlob: () => blob(b.bytes, b.type, b.name), setContentType: t => { b.type = t; return b; } }); };
  const htmlOut = html => { const o = { html, title: '', getContent: () => o.html, setContent: h => { o.html = h; return o; }, append: h => { o.html += h; return o; }, getTitle: () => o.title, setTitle: t => { o.title = t; return o; },
    addMetaTag: () => o, setXFrameOptionsMode: () => o, setSandboxMode: () => o, setFaviconUrl: () => o, setWidth: () => o, setHeight: () => o, getBlob: () => blob(o.html, 'text/html') }; return o; };
  const ctx = {
    console, JSON, Math, Number, String, Object, Array, Boolean, RegExp, Error, TypeError, isNaN, isFinite, parseInt, parseFloat, Infinity, NaN, encodeURIComponent, decodeURIComponent, escape, unescape, Date: FakeDate,
    SpreadsheetApp: { openById: () => ss, getActiveSpreadsheet: () => ss, flush: () => {} },
    PropertiesService: { getScriptProperties: () => propStore, getUserProperties: () => propStore, getDocumentProperties: () => propStore },
    CacheService: { getScriptCache: () => cacheStore, getUserCache: () => cacheStore },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {}, hasLock: () => true }), getUserLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(), sleep: () => {}, DigestAlgorithm: { SHA_256: 'sha256', MD5: 'md5', SHA_1: 'sha1' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash(alg).update(typeof s === 'string' ? Buffer.from(s, 'utf8') : Buffer.from(s)).digest()).map(x => (x > 127 ? x - 256 : x)),
      computeHmacSha256Signature: (v, k) => Array.from(crypto.createHmac('sha256', k).update(v).digest()).map(x => (x > 127 ? x - 256 : x)),
      base64Encode: b => Buffer.from(typeof b === 'string' ? Buffer.from(b, 'utf8') : Buffer.from(b.map ? b.map(x => (x < 0 ? x + 256 : x)) : b)).toString('base64'),
      base64Decode: s => Array.from(Buffer.from(s, 'base64')).map(x => (x > 127 ? x - 256 : x)),
      base64EncodeWebSafe: b => Buffer.from(typeof b === 'string' ? b : b.map(x => (x < 0 ? x + 256 : x))).toString('base64url'),
      newBlob: (d, t, n) => blob(typeof d === 'string' ? Buffer.from(d, 'utf8') : Buffer.from((d || []).map(x => (x < 0 ? x + 256 : x))), t, n),
      formatDate: (d, tz, f) => { const x = new RealDate(new RealDate(d).getTime() + 5 * 3600e3); const p = n => String(n).padStart(2, '0'); return f.replace('yyyy', x.getUTCFullYear()).replace('MM', p(x.getUTCMonth() + 1)).replace('dd', p(x.getUTCDate())).replace('HH', p(x.getUTCHours())).replace('mm', p(x.getUTCMinutes())).replace('ss', p(x.getUTCSeconds())); },
      parseCsv: s => s.split(/\r?\n/).filter(Boolean).map(l => l.split(','))
    },
    Session: { getScriptTimeZone: () => 'Asia/Yekaterinburg', getActiveUser: () => ({ getEmail: () => 'test@example.com' }), getEffectiveUser: () => ({ getEmail: () => 'test@example.com' }) },
    Logger: { log: (...a) => { logs.push(a.join(' ')); } },
    MimeType: { PDF: 'application/pdf', JPEG: 'image/jpeg', PNG: 'image/png', HTML: 'text/html', PLAIN_TEXT: 'text/plain', CSV: 'text/csv', GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet', MICROSOFT_EXCEL: 'application/vnd.ms-excel' },
    UrlFetchApp: { fetch: () => { throw new Error('Внешние сервисы на стенде отключены'); }, fetchAll: () => { throw new Error('Внешние сервисы на стенде отключены'); } },
    MailApp: { sendEmail: () => {}, getRemainingDailyQuota: () => 100 },
    ScriptApp: { newTrigger: () => { const t = { timeBased: () => t, everyHours: () => t, everyMinutes: () => t, everyDays: () => t, atHour: () => t, nearMinute: () => t, onWeekDay: () => t, create: () => ({}) }; return t; }, getProjectTriggers: () => [], deleteTrigger: () => {}, getOAuthToken: () => 'token', WeekDay: {} },
    DriveApp: { getRootFolder: () => { throw new Error('Drive на стенде отключён'); }, getFolderById: () => { throw new Error('Drive на стенде отключён'); }, getFileById: () => { throw new Error('Drive на стенде отключён'); }, createFolder: () => { throw new Error('Drive на стенде отключён'); } },
    HtmlService: { createHtmlOutputFromFile: f => htmlOut(fs.readFileSync(G + f + (f.endsWith('.html') ? '' : '.html'), 'utf8')), createHtmlOutput: h => htmlOut(h || ''), createTemplateFromFile: f => { const t = { evaluate: () => htmlOut(fs.readFileSync(G + f + '.html', 'utf8')) }; return t; }, XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' }, SandboxMode: {} }, ContentService: { createTextOutput: () => ({ setMimeType: () => ({}) }), MimeType: {} }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const files = fs.readdirSync(G).filter(f => f.endsWith('.gs')).sort((a, b) => (a === 'Code.gs' ? -1 : b === 'Code.gs' ? 1 : a.localeCompare(b)));
  files.forEach(f => vm.runInContext(fs.readFileSync(G + f, 'utf8'), ctx, { filename: f }));
  return { ctx, ss, props, logs, setNow: t => { now = t ? new RealDate(t).getTime() : null; } };
}
module.exports = { boot };
