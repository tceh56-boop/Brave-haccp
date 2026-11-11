// Реестр нормативов в админ-панели → системы клиентов: отсчёт сроков, уведомления, отмена документа, перенос к клиенту.
// Запуск: node tests/norms_live.test.js
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert'), { make } = require('./gas_mock');
const root = path.join(__dirname, '..');
function load(dir, files, g) { const ctx = vm.createContext(g); files.forEach(f => vm.runInContext(fs.readFileSync(path.join(root, dir, f), 'utf8'), ctx, { filename: f })); return ctx; }
const iso = d => { const x = new Date(Date.now() + d * 864e5); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
let n = 0; const t = (name, f) => { f(); n++; console.log('  ✓ ' + name); };

// --- админ-панель
const GA = make('owner@example.com'), mails = [];
GA.MailApp = { sendEmail: o => mails.push(o), getRemainingDailyQuota: () => 100 };
const A = load('admin', fs.readdirSync(path.join(root, 'admin')).filter(f => f.endsWith('.gs')).sort(), GA);
const pwd = /Временный пароль: (\S+)/.exec(A.setupAdmin())[1], T = A.adminLogin('owner@example.com', pwd).data.token;
const cl = A.adminClientSave(T, { name: 'Кафе Тест', email: 'cafe@example.com', plan: 'pro', months: 2 }).data;
const N = () => { const r = A.adminNorms(T); assert(r.ok, JSON.stringify(r)); return r.data; };

// --- система клиента
const G = make('client@example.com'), sheets = {};
const sheet = () => { const s = { data: [], getLastRow: () => s.data.length, getDataRange: () => ({ getValues: () => s.data.map(r => r.slice()) }),
  getRange: (r, c, nr = 1, nc = 1) => ({ setValues(v) { v.forEach((row, i) => { s.data[r - 1 + i] = s.data[r - 1 + i] || []; row.forEach((x, j) => { s.data[r - 1 + i][c - 1 + j] = x; }); }); return this; },
    setValue(x) { s.data[r - 1] = s.data[r - 1] || []; s.data[r - 1][c - 1] = x; return this; }, clearContent() { return this; }, getValues() { return [[]]; } }) }; return s; };
G.UrlFetchApp = { fetch: (url, opt) => { const r = A.doPost({ parameter: {}, postData: { contents: opt.payload } }); return { getResponseCode: () => 200, getContentText: () => r.text }; } };
G.Utilities.formatDate = (d, tz, f) => { const x = new Date(d), p = v => String(v).padStart(2, '0'); return f.replace('yyyy', x.getFullYear()).replace('MM', p(x.getMonth() + 1)).replace('dd', p(x.getDate())); };
Object.assign(G, { _log_: () => {}, _book_: () => ({ getSheets: () => [], getSheetByName: () => null, getId: () => 'X' }), _mcTz_: () => 'Europe/Moscow', _withLock_: f => f(),
  _ok_: d => JSON.stringify({ success: true, data: d }), _fail_: (c, m) => JSON.stringify({ success: false, error: { code: c, message: m } }), _failFrom_: e => JSON.stringify({ success: false, error: { message: String(e.message || e) } }),
  _requireAuth_: () => ({ name: 'Директор', dev: false }), _mcRbHas_: () => true, _audit_: () => {}, _defaultTenant_: () => 't', mcGateSession_: () => null,
  _bcSheet_: (nm, head) => { if (!sheets[nm]) { sheets[nm] = sheet(); sheets[nm].data.push(head.slice()); } return sheets[nm]; } });
const C = load('app', ['TS_Subscription.gs', 'TS_Support.gs', 'TS_LaborSafety.gs'], G);
assert(JSON.parse(C.tsActivateLicense('tok', cl.licenseKey, 'https://script.google.com/macros/s/ADMIN/exec', cl.secret)).success);
const head = C.TS_LS_SHEETS_.norms.head;
const rows = () => sheets['ЦС_Нормативы'].data.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]]))), row = c => rows().find(r => r['Код'] === c);
// реестр предприятия из выпуска; одну строку предприятие проверило само
C.TS_LS_NORMS_.forEach(() => {}); sheets['ЦС_Нормативы'] = sheet(); sheets['ЦС_Нормативы'].data.push(head.slice());
G.PropertiesService.getScriptProperties().setProperty('TS_LS_SEEDED', '1'); C._tsLsNormsMigrate_();
const tr = sheets['ЦС_Нормативы'].data.findIndex(r => r[0] === 'TR-01'); sheets['ЦС_Нормативы'].data[tr][head.indexOf('Проверил')] = 'Иванова (ответственный)';

t('админ-панель: эталон реестра из выпуска, версия, отсчёт дней по каждому действующему документу', () => {
  const d = N(); assert.strictEqual(d.norms.length, C.TS_LS_NORMS_.length); assert(d.version);
  const pb = d.norms.find(x => x.code === 'PB-01'); assert.strictEqual(pb.validTo, '2026-12-31'); assert.strictEqual(pb.daysLeft, Math.ceil((new Date('2026-12-31') - new Date(iso(0))) / 864e5));
  assert.strictEqual(d.norms.find(x => x.code === 'SN-01').daysLeft, null, 'у утратившего силу отсчёта нет');
});
t('уведомления о сроке: порог 30 дней — запись и письмо один раз; истёкший — «укажите замену»', () => {
  mails.length = 0;
  assert(A.adminNormSave(T, Object.assign({}, N().norms.find(x => x.code === 'PB-01'), { validTo: iso(20) })).ok);
  assert(A.adminNormSave(T, Object.assign({}, N().norms.find(x => x.code === 'MO-01'), { validTo: iso(-2) })).ok);
  const al = N().alerts; assert(al.some(a => a.objectId === 'PB-01' && a.kind === 'NORM_EXPIRING' && /осталось 20 дн/.test(a.text)), JSON.stringify(al));
  assert(al.some(a => a.objectId === 'MO-01' && a.kind === 'NORM_EXPIRED' && /укажите замену/.test(a.text)));
  const m = mails.length; assert(m >= 2 && mails.every(x => /owner@example\.com/.test(x.to)), 'письма администраторам');
  N(); A.normsCheck_(); assert.strictEqual(mails.length, m, 'повторная проверка не дублирует уведомления');
});
let ver1;
t('документ утратил силу: без «чем заменён» — нельзя; уведомление, новая версия реестра', () => {
  ver1 = N().version;
  const sn2 = N().norms.find(x => x.code === 'SN-02');
  assert(/чем заменён/.test(A.adminNormSave(T, Object.assign({}, sn2, { status: 'УТРАТИЛ СИЛУ', replacedBy: '' })).error));
  const r = A.adminNormSave(T, Object.assign({}, sn2, { status: 'УТРАТИЛ СИЛУ', replacedBy: 'СП 2.1.9999-26' })); assert(r.ok && /ДЕЙСТВУЕТ → УТРАТИЛ СИЛУ/.test(r.data.what));
  const d = N(); assert.notStrictEqual(d.version, ver1); assert(d.alerts.some(a => a.kind === 'NORM_REPEALED' && a.objectId === 'SN-02' && /СП 2\.1\.9999-26/.test(a.text)));
  assert(mails.some(x => /утратил силу/.test(x.subject)));
  // администратор просит предприятия перепроверить TR-01 и добавляет новый документ
  assert(A.adminNormSave(T, Object.assign({}, d.norms.find(x => x.code === 'TR-01'), { status: 'ПРОВЕРИТЬ' })).ok);
  assert(A.adminNormSave(T, { code: 'SN-10', group: 'СанПиН', document: 'СанПиН 9.9.9999-26', title: 'Новый документ', status: 'ДЕЙСТВУЕТ', validTo: iso(400) }).ok);
  assert(/две буквы и номер/.test(A.adminNormSave(T, { code: 'плохой', document: 'x', status: 'ДЕЙСТВУЕТ' }).error));
});
t('клиент получает реестр при проверке лицензии: отменённый — «УТРАТИЛ СИЛУ», новый срок, новый документ; отметки предприятия сохранены', () => {
  const pp = G.PropertiesService.getScriptProperties();
  C._tsAfterCheck_();   // как после ежедневной проверки лицензии
  assert.strictEqual(row('SN-02')['Статус'], 'УТРАТИЛ СИЛУ'); assert(/СП 2\.1\.9999-26/.test(row('SN-02')['Что требует']), 'причина и замена у клиента');
  assert.strictEqual(String(row('PB-01')['Действует до']).slice(0, 10), iso(20), 'новый срок от поставщика');
  assert(row('SN-10') && row('SN-10')['Статус'] === 'ДЕЙСТВУЕТ', 'новый документ добавлен');
  assert.strictEqual(row('TR-01')['Статус'], 'ДЕЙСТВУЕТ', 'проверенное предприятием не сбрасывается поставщиком'); assert.strictEqual(row('TR-01')['Проверил'], 'Иванова (ответственный)');
  assert.strictEqual(row('TR-02')['Статус'], 'ДЕЙСТВУЕТ');
  assert.strictEqual(pp.getProperty('TS_LS_REMOTE_VER'), N().version);
  const again = C._tsLsNormsRemote_(true); assert.strictEqual(again.changed, 0, 'та же версия — без изменений');
});
t('админ-панель видит версию реестра и истёкшие документы у клиента', () => {
  const G2 = G.PropertiesService.getScriptProperties(); G2.deleteProperty('TS_USAGE_SENT_AT');
  C._tsAfterCheck_();
  const c = N().clients.find(x => x.name === 'Кафе Тест'); assert(c && c.upToDate, JSON.stringify(N().clients));
  assert.strictEqual(c.normsExpired, 1, 'у клиента 1 действующий документ с истёкшим сроком (MO-01)');
  assert(A.adminNormSave(T, Object.assign({}, N().norms.find(x => x.code === 'SN-10'), { validTo: iso(500) })).ok);
  assert(!N().clients.find(x => x.name === 'Кафе Тест').upToDate, 'после правки клиент — на прежней версии до следующей проверки');
});
t('кнопка «Обновить реестр» у клиента; закрытие уведомления', () => {
  const r = JSON.parse(C.tsLsNormsSync('tok')); assert(r.success && r.data.changed === 1, JSON.stringify(r));
  assert.strictEqual(String(row('SN-10')['Действует до']).slice(0, 10), iso(500));
  const a = N().alerts[0]; assert(A.adminAlertClose(T, a.alertId).ok); assert(!N().alerts.some(x => x.alertId === a.alertId));
});
console.log('Реестр нормативов в реальном времени: ' + n + ' сценариев пройдено');
