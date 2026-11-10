// Сквозной тест: админ-панель выпускает лицензию → система клиента проверяет ключ → тариф и шлюз.
// Запуск: node tests/license_flow.test.js
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert'), { make } = require('./gas_mock');
const root = path.join(__dirname, '..');
function load(dir, files, g) { const ctx = vm.createContext(g); files.forEach(f => vm.runInContext(fs.readFileSync(path.join(root, dir, f), 'utf8'), ctx, { filename: f })); return ctx; }

// --- админ-панель
const A = load('admin', fs.readdirSync(path.join(root, 'admin')).filter(f => f.endsWith('.gs')).sort(), make('owner@example.com'));
const setupMsg = A.setupAdmin();
const pwd = /Временный пароль: (\S+)/.exec(setupMsg)[1];
assert.strictEqual(A.adminLogin('owner@example.com', 'wrong').ok, false, 'неверный пароль не пускает');
const login = A.adminLogin('owner@example.com', pwd); assert(login.ok, 'вход владельца');
const T = login.data.token;
const created = A.adminClientSave(T, { name: 'Кафе Тест', email: 'cafe@example.com', plan: 'basic_pro', months: 2 });
assert(created.ok && created.data.licenseKey && created.data.secret, 'клиент + лицензия: ' + JSON.stringify(created));
const { licenseKey, secret } = created.data;
const dash = A.adminDashboard(T); assert(dash.ok && dash.data.m.total === 1 && dash.data.m.mrr === 3000, 'MRR = 3000: ' + JSON.stringify(dash.data && dash.data.m));

// --- система клиента (только модуль подписки + нужные помощники ядра)
const G = make('client@example.com');
G.UrlFetchApp = { fetch: (url, opt) => { const r = A.doPost({ parameter: {}, postData: { contents: opt.payload } }); return { getResponseCode: () => 200, getContentText: () => r.text }; } };
Object.assign(G, { _log_: () => {}, _book_: () => ({ getSheets: () => [], getSheetByName: () => null, getId: () => 'X' }), _mcTz_: () => 'Europe/Moscow',
  _ok_: d => JSON.stringify({ success: true, data: d }), _fail_: (c, m) => JSON.stringify({ success: false, error: { code: c, message: m } }), _failFrom_: e => JSON.stringify({ success: false, error: { message: String(e.message || e) } }),
  _requireAuth_: () => ({ name: 'Директор', dev: false }), _mcRbHas_: () => true, _audit_: () => {}, _defaultTenant_: () => 't' });
const Cl = load('app', ['TS_Subscription.gs'], G);
// без ключа — пробный период pro_max
assert.strictEqual(Cl._tsLicense_(true).status, 'TRIAL');
// подключение лицензии
const act = JSON.parse(Cl.tsActivateLicense('tok', licenseKey, 'https://script.google.com/macros/s/ADMIN/exec', secret));
assert(act.success && act.data.plan === 'basic_pro' && act.data.status === 'ACTIVE', 'активация: ' + JSON.stringify(act));
// шлюз тарифа: журналы можно, лаборатория и партии — нет
assert.strictEqual(Cl._tsPlanGate_('addJournalEntry', 'journals', true, []), '', 'журналы в Basic Pro');
assert(/Pro/.test(Cl._tsPlanGate_('v67SaveLabPlan', 'lab_edit|lab', true, [])), 'лаборатория закрыта');
assert(/Pro/.test(Cl._tsPlanGate_('uiData', '*', false, ['t', 'lab'])), 'раздел лаборатории закрыт');
assert.strictEqual(Cl._tsPlanGate_('v38GetDashboard', 'haccp_view', false, []), '', 'сроки годности — в базовом составе');
assert(/AI/.test(Cl._tsPlanGate_('tsAiAsk', '*', true, [])), 'AI только в Pro Max');
// подделка ответа: неверный секрет → ключ не подтверждается
G.PropertiesService.getScriptProperties().setProperty('TS_LICENSE_SECRET', 'WRONG');
G.PropertiesService.getScriptProperties().deleteProperty('TS_LICENSE_STATE');
const bad = Cl._tsLicense_(true); assert.strictEqual(bad.status, 'UNVERIFIED', 'подпись с чужим секретом не принимается');
G.PropertiesService.getScriptProperties().setProperty('TS_LICENSE_SECRET', secret);
// блокировка клиента в админ-панели → только чтение у клиента
assert(A.adminClientBlock(T, created.data.id, true).ok);
const blocked = Cl._tsLicense_(true); assert.strictEqual(blocked.mode, 'readonly', 'блокировка → только чтение');
assert(Cl._tsPlanGate_('addJournalEntry', 'journals', true, []), 'запись запрещена'); assert.strictEqual(Cl._tsPlanGate_('getJournalEntries', 'journals', false, []), '', 'чтение разрешено');
// продление и смена тарифа
assert(A.adminClientBlock(T, created.data.id, false).ok);
assert(A.adminSubscriptionChangePlan(T, created.data.id, 'pro_max').ok);
assert.strictEqual(Cl._tsLicense_(true).plan, 'pro_max', 'смена тарифа доходит до клиента');
const ren = A.adminSubscriptionRenew(T, created.data.id, 3, true); assert(ren.ok, 'ручное продление');
const subs = A.adminSubscriptions(T, {}); assert(subs.ok && subs.data[0].daysLeft > 120, 'продлено на 3 мес. сверх 2: ' + JSON.stringify(subs.data[0]));
// роли: Support не может менять клиентов
const u = A.adminUserCreate(T, { email: 'sup@example.com', name: 'Поддержка', role: 'SUPPORT' }); assert(u.ok);
const Ts = A.adminLogin('sup@example.com', u.data.password).data.token;
assert.strictEqual(A.adminClientSave(Ts, { name: 'X', email: 'x@x.ru', plan: 'basic' }).code, 'FORBIDDEN', 'Support не создаёт клиентов');
assert(A.adminClients(Ts, {}).ok, 'Support видит клиентов');
// оплата через ЮMoney: счёт → уведомление с верной подписью → платёж оплачен, подписка продлена
const AP = A.PropertiesService.getScriptProperties();
AP.setProperty('YOOMONEY_WALLET', '4100000000000'); AP.setProperty('YOOMONEY_NOTIFY_SECRET', 'nsecret');
assert(A.adminSettingsSave(T, { provider: 'yoomoney' }).ok);
const before = A.adminSubscriptions(T, {}).data[0].daysLeft;
const inv = A.adminInvoiceCreate(T, created.data.id, 'MONTHLY', 1); assert(inv.ok && /yoomoney\.ru\/quickpay/.test(inv.data.url), 'ссылка ЮMoney');
const n = { notification_type: 'p2p-incoming', operation_id: '123', amount: '6930.00', withdraw_amount: '7000.00', currency: '643', datetime: '2026-11-10T10:00:00Z', sender: '', codepro: 'false', label: inv.data.invoice };
const crypto = require('crypto');
n.sha1_hash = crypto.createHash('sha1').update([n.notification_type, n.operation_id, n.amount, n.currency, n.datetime, n.sender, n.codepro, 'nsecret', n.label].join('&')).digest('hex');
const hookTok = AP.getProperty('WEBHOOK_TOKEN');
assert.strictEqual(JSON.parse(A.doPost({ parameter: Object.assign({ hook: 'payment', t: 'bad' }, n), postData: { contents: '' } }).text).ok, false, 'неверный токен webhook');
const fake = Object.assign({}, n, { sha1_hash: 'deadbeef' });
assert.strictEqual(JSON.parse(A.doPost({ parameter: Object.assign({ hook: 'payment', t: hookTok }, fake), postData: { contents: '' } }).text).result, 'bad signature', 'подделка уведомления');
assert.strictEqual(JSON.parse(A.doPost({ parameter: Object.assign({ hook: 'payment', t: hookTok }, n), postData: { contents: '' } }).text).result, 'paid', 'оплата принята');
assert.strictEqual(A.adminSubscriptions(T, {}).data[0].daysLeft - before >= 28, true, 'подписка продлена на месяц');
assert.strictEqual(JSON.parse(A.doPost({ parameter: Object.assign({ hook: 'payment', t: hookTok }, n), postData: { contents: '' } }).text).result, 'already paid', 'повторное уведомление не продлевает второй раз');
console.log('OK: лицензия, подпись, тарифы, режим только чтения, продление, роли, оплата ЮMoney — все проверки пройдены');
