// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * Среда выполнения ЦЕХ в облаке: все gas/*.gs в одном контексте Node с заменителями сервисов
 * Apps Script. Данные — PostgreSQL (store.js), запросы — синхронно через поток (syncpg.js).
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const { createSyncPg } = require('./syncpg');
const { createStore } = require('./store');

const TZ = process.env.TSEKH_TZ || 'Europe/Moscow';

/** Utilities.formatDate: yyyy yy MM dd HH H mm ss SSS и 'литералы' — по часовому поясу. */
function formatDate(d, tz, fmt) {
  const date = d instanceof Date ? d : new Date(d);
  const parts = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: tz || TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).forEach(p => { parts[p.type] = p.value; });
  const map = { yyyy: parts.year, yy: parts.year.slice(2), MM: parts.month, dd: parts.day, HH: parts.hour, H: String(Number(parts.hour)), mm: parts.minute, ss: parts.second,
    SSS: String(date.getUTCMilliseconds()).padStart(3, '0') };
  return String(fmt).replace(/'([^']*)'|yyyy|yy|MM|dd|HH|H|mm|ss|SSS/g, (m, lit) => lit !== undefined ? lit : map[m]);
}

function toSignedBytes(buf) { return Array.from(buf).map(b => b > 127 ? b - 256 : b); }
function toBuffer(x) { if (Buffer.isBuffer(x)) return x; if (Array.isArray(x)) return Buffer.from(x.map(b => b & 255)); return Buffer.from(String(x), 'utf8'); }

function makeBlob(data, contentType, name) {
  let bytes = toBuffer(data && data.getBytes ? data.getBytes() : data);
  const blob = {
    getBytes: () => toSignedBytes(bytes), getDataAsString: () => bytes.toString('utf8'), getContentType: () => contentType || 'application/octet-stream',
    getName: () => name || '', setName(n) { name = n; return blob; }, setContentType(t) { contentType = t; return blob; },
    getAs() { throw new Error('Преобразование в PDF в облачной версии пока недоступно — используйте печать из браузера.'); }
  };
  return blob;
}

function createRuntime(options) {
  const opts = options || {};
  const gasDir = opts.gasDir || path.join(__dirname, '../../gas');
  const db = createSyncPg(opts.connectionString || process.env.DATABASE_URL);
  const store = createStore(db);
  if (opts.migrate !== false) store.migrate();
  const log = opts.logger || ((...a) => console.log('[ЦЕХ]', ...a));

  const ctx = {
    console, JSON, Math, Date, Object, Array, String, Number, Boolean, RegExp, Error, TypeError, RangeError, Intl, Symbol, Map, Set, WeakMap, Promise,
    isNaN, isFinite, parseFloat, parseInt, encodeURIComponent, decodeURIComponent, encodeURI, decodeURI, escape, unescape,
    SpreadsheetApp: { openById: () => store.spreadsheet, getActiveSpreadsheet: () => store.spreadsheet, flush() {} },
    CacheService: { getScriptCache: () => store.cache, getUserCache: () => store.cache, getDocumentCache: () => store.cache },
    LockService: { getScriptLock: () => store.lock, getDocumentLock: () => store.lock, getUserLock: () => store.lock },
    PropertiesService: { getScriptProperties: () => store.properties, getDocumentProperties: () => store.properties },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate,
      computeDigest: (alg, s) => toSignedBytes(crypto.createHash(alg === 'md5' ? 'md5' : alg === 'sha1' ? 'sha1' : 'sha256').update(toBuffer(s)).digest()),
      computeHmacSha256Signature: (v, k) => toSignedBytes(crypto.createHmac('sha256', toBuffer(k)).update(toBuffer(v)).digest()),
      DigestAlgorithm: { SHA_256: 'sha256', MD5: 'md5', SHA_1: 'sha1' }, Charset: { UTF_8: 'utf8' },
      base64Encode: x => toBuffer(x).toString('base64'), base64EncodeWebSafe: x => toBuffer(x).toString('base64url'),
      base64Decode: s => toSignedBytes(Buffer.from(String(s), 'base64')), base64DecodeWebSafe: s => toSignedBytes(Buffer.from(String(s), 'base64url')),
      newBlob: makeBlob,
      sleep: ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(Number(ms) || 0, 10000))
    },
    Session: { getScriptTimeZone: () => TZ, getActiveUser: () => ({ getEmail: () => '' }), getEffectiveUser: () => ({ getEmail: () => '' }) },
    Logger: { log: (...a) => log(...a) },
    MailApp: { sendEmail(to, subject, body) { const o = typeof to === 'object' ? to : { to, subject, body }; store.queueMail(o.to, o.subject, o.body || o.htmlBody || ''); } },
    GmailApp: { sendEmail(to, subject, body) { store.queueMail(to, subject, body); } },
    UrlFetchApp: {
      fetch(url, o) {
        o = o || {};
        const headers = Object.assign({}, o.headers || {});
        if (o.contentType && !Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) headers['Content-Type'] = o.contentType;
        let payload = o.payload;
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) payload = new URLSearchParams(payload).toString();
        const r = db.fetch(String(url), { method: o.method || 'get', headers, payload });
        if (r.status >= 400 && !o.muteHttpExceptions) throw new Error('Запрос к ' + String(url).split('?')[0] + ' вернул ошибку ' + r.status + '.');
        const body = Buffer.from(r.body, 'base64');
        return { getResponseCode: () => r.status, getContentText: () => body.toString('utf8'), getHeaders: () => r.headers,
          getAllHeaders: () => r.headers, getBlob: () => makeBlob(body, r.headers['content-type']) };
      }
    },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => { const b = { timeBased: () => b, everyMinutes: () => b, everyHours: () => b, everyDays: () => b, atHour: () => b, onWeekDay: () => b, create: () => ({}) }; return b; } },
    HtmlService: { createHtmlOutputFromFile: () => { const o = { setTitle: () => o, addMetaTag: () => o, setXFrameOptionsMode: () => o }; return o; }, XFrameOptionsMode: { DEFAULT: 'DEFAULT', ALLOWALL: 'ALLOWALL' } },
    ContentService: { createTextOutput: x => { const o = { x, setMimeType: () => o, getContent: () => x }; return o; }, MimeType: { JSON: 'json', TEXT: 'text' } },
    MimeType: { PDF: 'application/pdf', CSV: 'text/csv', PLAIN_TEXT: 'text/plain', HTML: 'text/html', JSON: 'application/json' },
    DriveApp: new Proxy({}, { get: () => () => { throw new Error('Хранение файлов (Google Диск) в облачной версии подключается следующим этапом — Yandex Object Storage.'); } })
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const files = fs.readdirSync(gasDir).filter(f => f.endsWith('.gs')).sort();
  const src = files.map(f => '// ==== ' + f + '\n' + fs.readFileSync(path.join(gasDir, f), 'utf8')).join('\n;\n');
  vm.runInContext(src, ctx, { filename: 'gas-bundle.js' });

  // Резервные копии в облаке делает Managed PostgreSQL (автоматические бэкапы и восстановление
  // на момент времени), копия Google-таблицы на Диск не нужна и невозможна.
  ctx.dailyBackupTrigger_ = function () { log('Резервное копирование — средствами Managed PostgreSQL.'); return { skipped: 'managed_postgresql' }; };

  // В облаке «таблица» — это база; ID нужен только чтобы getDatabase_() не просил настройку.
  if (!store.properties.getProperty('SPREADSHEET_ID')) store.properties.setProperty('SPREADSHEET_ID', 'pg');

  return {
    ctx, store, db, files,
    /** Одна операция из интерфейса или API — с чистым кэшем запроса и снятой блокировкой в конце. */
    runOperation(action, data, token) {
      store.resetRequestState();
      try { return ctx.processOperation(action, data, token); }
      finally { store.resetRequestState(); }
    },
    /** Фоновые задачи по расписанию (аналог триггеров Apps Script). */
    runTick(name) {
      const allowed = Object.keys(ctx.TRIGGER_SCHEDULE_ || {});
      if (allowed.indexOf(name) === -1 && name !== 'tickHourly_') throw new Error('Неизвестная фоновая задача: ' + name);
      store.resetRequestState();
      try { ctx[name](); return { ok: true, tick: name }; }
      finally { store.resetRequestState(); }
    },
    close() { db.close(); }
  };
}

module.exports = { createRuntime, formatDate };
