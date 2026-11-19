// Стенд MonChef License API: эмулятор Apps Script в Node.js.
//   node tools/run_tests.js            — тесты API (Tests.gs) + сквозные тесты клиентского коннектора
//   node tools/run_tests.js --report F — дополнительно записать отчёт в файл F (Markdown)
// Клиент (monchef/app/MonChef_LicenseClient.gs) и API работают в разных контекстах, как два проекта;
// UrlFetchApp клиента передаёт запрос в doPost API (или «падает» — для проверки офлайн-режима).
'use strict';
const fs = require('fs'), vm = require('vm'), crypto = require('crypto'), path = require('path');
const API_DIR = path.resolve(__dirname, '..');
const CLIENT_FILE = path.resolve(__dirname, '../../app/MonChef_LicenseClient.gs');
const TZ = 'Asia/Yekaterinburg';

const signed = buf => Array.from(buf, b => (b > 127 ? b - 256 : b));
const toBuf = v => Buffer.isBuffer(v) ? v : Array.isArray(v) ? Buffer.from(v.map(b => b & 0xff)) : Buffer.from(String(v), 'utf8');

function fmtDate(d, tz, fmt) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).forEach(x => { p[x.type] = x.value; });
  return fmt.replace(/yyyy|MM|dd|HH|mm|ss/g, t => ({ yyyy: p.year, MM: p.month, dd: p.day, HH: p.hour, mm: p.minute, ss: p.second })[t]);
}

function makeEnv(state) {
  // state: { now: () => ms } — общее «время» для проверки офлайн-режима
  const cache = new Map(), props = {}, mail = [], triggers = [];
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (!a.length) super(state.now()); else super(...a); }
    static now() { return state.now(); }
  }
  const blob = (bytes, type, name) => {
    const b = { bytes: toBuf(bytes || ''), type: type || '', name: name || '' };
    return Object.assign(b, { getBytes: () => signed(b.bytes), getDataAsString: () => b.bytes.toString('utf8'), getContentType: () => b.type,
      setName: n => { b.name = n; return b; }, getName: () => b.name });
  };
  const ctx = {
    console, JSON, Math, Object, Array, String, Number, Boolean, RegExp, Error, Intl, parseInt, parseFloat, isFinite, isNaN, Date: FakeDate,
    Logger: { log: () => {} },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256', MD5: 'md5' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, v) => signed(crypto.createHash(alg).update(toBuf(v)).digest()),
      computeHmacSha256Signature: (v, k) => signed(crypto.createHmac('sha256', toBuf(k)).update(toBuf(v)).digest()),
      base64Encode: v => toBuf(v).toString('base64'),
      base64EncodeWebSafe: v => toBuf(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64Decode: s => signed(Buffer.from(String(s), 'base64')),
      newBlob: (d, t, n) => blob(d, t, n),
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, tz, f) => fmtDate(d, tz, f),
      sleep: () => {}
    },
    CacheService: { getScriptCache: () => ({
      get: k => { const e = cache.get(k); if (!e) return null; if (e.exp < state.now()) { cache.delete(k); return null; } return e.v; },
      put: (k, v, s) => { if (String(k).length > 250) throw new Error('key too long'); if (String(v).length > 100000) throw new Error('value too large'); cache.set(k, { v: String(v), exp: state.now() + (s || 600) * 1000 }); },
      remove: k => { cache.delete(k); }, removeAll: ks => ks.forEach(k => cache.delete(k)) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; },
      getProperties: () => Object.assign({}, props) }) },
    Session: { getScriptTimeZone: () => TZ, getActiveUser: () => ({ getEmail: () => '' }), getEffectiveUser: () => ({ getEmail: () => 'owner@example.invalid' }) },
    MailApp: { sendEmail: m => mail.push(m) },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: t => ({ text: t, setMimeType() { return this; }, getContent() { return this.text; } }) },
    ScriptApp: { getProjectTriggers: () => triggers, newTrigger: fn => ({ timeBased: () => ({ everyDays: () => ({ atHour: () => ({ create: () => triggers.push({ getHandlerFunction: () => fn }) }) }) }) }) },
    _env: { cache, props, mail, triggers }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  return ctx;
}

function load(ctx, files) {
  files.forEach(f => vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: path.basename(f) }));
}

const results = [];
const check = (name, fn) => {
  try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, error: e.message }); }
};
const eq = (a, b, m) => { if (a !== b) throw new Error((m || 'ожидалось') + ': ' + JSON.stringify(b) + ', получено ' + JSON.stringify(a)); };
const ok = (c, m) => { if (!c) throw new Error(m); };

// ------------------------------------------------------------------ 1. тесты API (Tests.gs)
const clock = { t: Date.now(), now() { return this.t; } };
const apiFiles = ['Config.gs', 'RegistryStore.gs', 'LicenseService.gs', 'DocumentService.gs', 'AuditService.gs', 'SecurityService.gs',
  'NotificationService.gs', 'ApiRouter.gs', 'Setup.gs', 'Tests.gs'].map(f => path.join(API_DIR, f));
const api = makeEnv(clock);
load(api, apiFiles);
const rep = api.MC_runAllTests();
rep.results.forEach(r => results.push({ name: 'API: ' + r.name, ok: r.ok, error: r.error }));
ok(api._env.mail.length === 0, 'тесты отправили письмо');

// ------------------------------------------------------------------ 2. сквозные тесты: клиент → API
// API с реестром в памяти (как в Tests.gs) и одной лицензией для клиента
const env = api.mcTestEnv_({ MC_OFFLINE_GRACE_DAYS: '7' });
const cfgOverride = api._MC_CFG_OVERRIDE_;
const client = makeEnv(clock);
const net = { down: false, calls: 0, http: 200 };
client.UrlFetchApp = { fetch: (url, opt) => {
  net.calls++;
  if (net.down) throw new Error('Address unavailable: ' + url);
  if (net.http !== 200) return { getResponseCode: () => net.http, getContentText: () => '<html>error</html>' };
  api._MC_CFG_OVERRIDE_ = cfgOverride;          // API-контекст тот же, что в mcTestEnv_
  const out = api.doPost({ postData: { contents: opt.payload, length: Buffer.byteLength(opt.payload) } });
  return { getResponseCode: () => 200, getContentText: () => out.getContent() };
} };
// лист книги MON CHEF и Диск установки — в памяти
const book = { sheets: {} };
const mkSheet = name => { const sh = { data: [] }; return Object.assign(sh, {
  getLastRow: () => sh.data.length, getRange: (r, c, nr, nc) => ({
    getValues: () => Array.from({ length: nr || 1 }, (_, i) => Array.from({ length: nc || 1 }, (_, j) => (sh.data[r - 1 + i] || [])[c - 1 + j] ?? '')),
    setValues: v => { v.forEach((row, i) => { sh.data[r - 1 + i] = sh.data[r - 1 + i] || []; row.forEach((x, j) => { sh.data[r - 1 + i][c - 1 + j] = x; }); }); return { setFontWeight: () => {} }; } }),
  appendRow: row => sh.data.push(row.slice()), setFrozenRows: () => {} }); };
client._book_ = () => ({ getId: () => 'BOOK', getSheetByName: n => book.sheets[n] || null, insertSheet: n => (book.sheets[n] = mkSheet(n)) });
const drive = { files: [] };
const folder = { getId: () => 'FOLDER-CLIENT', createFile: b => { drive.files.push(b); return { getId: () => 'CF-' + drive.files.length }; } };
client.DriveApp = { getFolderById: () => folder, getFileById: () => ({ getParents: () => ({ hasNext: () => false }) }), getRootFolder: () => ({ createFolder: () => folder }) };
load(client, [CLIENT_FILE]);
const P = client.PropertiesService.getScriptProperties();
const setClient = () => {
  P.setProperty('MC_LICENSE_API_URL', 'https://script.google.com/macros/s/TEST/exec');
  P.setProperty('MC_LICENSE_ID', 'MC-T-0001'); P.setProperty('MC_CLIENT_ID', 'CLIENT-0001');
  P.setProperty('MC_CLIENT_TOKEN', env.tokens['MC-T-0001']); P.setProperty('MC_APP_VERSION', '1.0.0');
};
const view = () => JSON.parse(client.mcLicenseStatus('t'));
const DAY = 86400000;

check('Клиент: без настройки — NOT_CONFIGURED, к API не обращается', () => {
  const v = JSON.parse(client.mcLicenseRefresh('t'));
  eq(v.mode, 'NOT_CONFIGURED'); eq(net.calls, 0, 'вызовов API');
  ok(/^INSTALL-/.test(P.getProperty('MC_INSTALLATION_ID')), 'installationId создан');
});
check('Клиент: проверка лицензии и загрузка разрешённых документов', () => {
  setClient();
  P.setProperty('MC_INSTALLATION_ID', 'INSTALL-MC-T-0001-A');
  const v = JSON.parse(client.mcLicenseRefresh('t'));
  eq(v.mode, 'OK'); eq(v.status, 'ACTIVE'); eq(v.graceDays, 7);
  eq(v.sync.loaded, 3, 'загружено (NORM-0001, TPL-0001, TPL-0002; NORM-BIG пропущен)');
  ok(v.sync.skipped.some(s => /NORM-BIG: DOCUMENT_TOO_LARGE/.test(s)), 'большой документ пропущен');
  eq(drive.files.length, 3, 'файлов на Диске установки');
  eq(v.localLibraryVersion, '', 'версия не отмечена, пока есть пропуски');
});
check('Клиент: повторная синхронизация не загружает неизменённые документы', () => {
  const before = drive.files.length;
  const v = JSON.parse(client.mcLicenseRefresh('t'));
  eq(drive.files.length, before, 'новых файлов'); eq(v.sync.unchanged, 3);
});
check('Клиент: токен и адрес API не попадают в ответ интерфейсу', () => {
  const s = client.mcLicenseStatus('t') + client._mcLicUiRows_().map(r => r.v).join('|');
  ok(s.indexOf(env.tokens['MC-T-0001']) < 0, 'токен'); ok(s.indexOf('script.google.com') < 0, 'адрес API');
});
check('Клиент: API недоступен — GRACE, данные не удаляются, повторы с паузой', () => {
  net.down = true; const calls = net.calls, files = drive.files.length;
  clock.t += 2 * DAY;
  let v = JSON.parse(client.mcLicenseRefresh('t'));
  eq(v.mode, 'GRACE'); eq(net.calls - calls, 2, 'одна попытка + один повтор');
  v = JSON.parse(client.mcLicenseRefresh('t'));
  eq(net.calls - calls, 2, 'во время паузы API не вызывается'); ok(!!v.nextTryAt, 'время следующей попытки');
  eq(drive.files.length, files, 'файлы на месте'); eq(v.documents, 3, 'реестр документов на месте');
  const list = client.mcListNormativeDocuments_('NORM_BASE');
  eq(list.online, false); eq(list.documents.map(d => d.documentId).join(','), 'NORM-0001', 'список из последней загрузки');
});
check('Клиент: паузы растут 5 → 15 → 60 → 360 минут', () => {
  const gaps = [];
  for (let i = 0; i < 4; i++) {
    const st = JSON.parse(P.getProperty('MC_LICENSE_STATE'));
    clock.t = Math.max(clock.t, st.nextTryAt) + 1000;
    client.mcLicenseCheck_();
    const st2 = JSON.parse(P.getProperty('MC_LICENSE_STATE'));
    gaps.push(Math.round((st2.nextTryAt - clock.t) / 60000));
  }
  eq(gaps.join(','), '15,60,360,360');
});
check('Клиент: offline grace period истёк — LIMITED, данные кухни и документы остаются', () => {
  clock.t += 8 * DAY;
  const v = view();
  eq(v.mode, 'LIMITED'); ok(/последняя загруженная версия/.test(v.message), 'пояснение'); eq(v.documents, 3);
  const r = client.mcLicenseSyncLibrary_(); eq(r.loaded, 0, 'в ограниченном режиме обновления не загружаются');
});
check('Клиент: связь вернулась — режим OK', () => {
  net.down = false;
  const st = JSON.parse(P.getProperty('MC_LICENSE_STATE')); clock.t = Math.max(clock.t, st.nextTryAt) + 1000;
  eq(JSON.parse(client.mcLicenseRefresh('t')).mode, 'OK');
});
check('Клиент: ответ не JSON / HTTP 500 — как недоступность', () => {
  net.http = 500;
  const st = JSON.parse(P.getProperty('MC_LICENSE_STATE')); clock.t = Math.max(clock.t, st.nextTryAt || 0) + 1000;
  eq(client.mcLicenseCheck_().mode, 'GRACE'); net.http = 200;
});
check('Клиент: лицензия отозвана — BLOCKED, загруженное сохраняется', () => {
  env.store.updateLicense('MC-T-0001', { status: 'REVOKED' }); api.mcDropLicenseCache_('MC-T-0001');
  const st = JSON.parse(P.getProperty('MC_LICENSE_STATE')); clock.t = Math.max(clock.t, st.nextTryAt || 0) + 1000;
  const v = JSON.parse(client.mcLicenseRefresh('t'));
  eq(v.mode, 'BLOCKED'); eq(v.lastError, 'LICENSE_INACTIVE'); eq(v.documents, 3); eq(v.sync, null);
});
check('Клиент: ключ заменён владельцем — старый не подходит (AUTH_FAILED → BLOCKED)', () => {
  env.store.updateLicense('MC-T-0001', { status: 'ACTIVE', clientTokenHash: api.hashToken_('mct_' + 'N'.repeat(60)) }); api.mcDropLicenseCache_('MC-T-0001');
  const v = JSON.parse(client.mcLicenseRefresh('t'));
  eq(v.mode, 'BLOCKED'); eq(v.lastError, 'AUTH_FAILED');
  P.setProperty('MC_CLIENT_TOKEN', 'mct_' + 'N'.repeat(60));
  eq(JSON.parse(client.mcLicenseRefresh('t')).mode, 'OK', 'с новым ключом');
});
check('Клиент: подменённый ответ (хеш не совпал) не сохраняется', () => {
  const real = client.UrlFetchApp.fetch;
  client.UrlFetchApp.fetch = (u, o) => { const r = real(u, o); const t = JSON.parse(r.getContentText());
    if (t.result && t.result.contentBase64) t.result.contentBase64 = Buffer.from('подмена').toString('base64');
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify(t) }; };
  const g = client.mcGetNormativeDocument_('NORM-0001');
  client.UrlFetchApp.fetch = real;
  eq(g.ok, false); eq(g.error, 'DOCUMENT_INTEGRITY_FAILED');
});
api.mcTestCleanup_();

// ------------------------------------------------------------------ отчёт
const passed = results.filter(r => r.ok).length;
const lines = results.map(r => (r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : ' — ' + r.error));
console.log(lines.join('\n'));
console.log(`\nИтого: ${passed} из ${results.length}`);
const ri = process.argv.indexOf('--report');
if (ri > 0) {
  const md = ['# Отчёт о тестах MonChef License API', '', `Дата: ${new Date().toISOString().slice(0, 10)}. Запуск: \`node monchef/license-api/tools/run_tests.js\` (эмулятор Apps Script, Node ${process.version}).`, '',
    `Итого: **${passed} из ${results.length}** пройдено.`, '', '| # | Тест | Результат |', '|---|---|---|']
    .concat(results.map((r, i) => `| ${i + 1} | ${r.name.replace(/\|/g, '/')} | ${r.ok ? 'PASS' : 'FAIL: ' + r.error.replace(/\|/g, '/')} |`));
  fs.writeFileSync(process.argv[ri + 1], md.join('\n') + '\n');
}
process.exit(passed === results.length ? 0 : 1);
