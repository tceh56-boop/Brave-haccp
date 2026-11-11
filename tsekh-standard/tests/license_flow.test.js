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
const Cl = load('app', ['TS_Subscription.gs', 'TS_Support.gs'], G);
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
assert.strictEqual(JSON.parse(A.doPost({ parameter: Object.assign({ hook: 'payment', t: hookTok }, n), postData: { contents: '' } }).text).result, 'duplicate', 'повторное уведомление (тот же хеш события) не обрабатывается второй раз');
// ---- управляющий контур 2.0
const L = A.readAll('Licenses');
assert(L.every(l => !/^TS-/.test(l['License Key'])) && L.some(l => /\*\*\*\*/.test(l['Маска ключа'])), 'ключ лицензии в таблице не хранится в открытом виде');
assert(!JSON.stringify(A.readAll('Organizations')).includes(licenseKey), 'в карточке клиента — только маска ключа');
const nonce = 'n'.repeat(20), chk = p => JSON.parse(A.doPost({ parameter: {}, postData: { contents: JSON.stringify(Object.assign({ action: 'license.check', key: licenseKey, version: '2.2.0' }, p)) } }).text);
const first = chk({ nonce }); assert(first.ok && /^ENT-/.test(first.license.enterpriseId) && first.license.features.includes('ai'), 'ответ содержит enterpriseId и возможности: ' + JSON.stringify(first.license));
assert(/REPLAY/.test(chk({ nonce }).error), 'повтор nonce отклоняется');
assert(!chk({ nonce: 'short' }).ok, 'короткий nonce не принимается');
// льготный период: подписка кончилась вчера → GRACE (работа сохраняется), через 4 дня → EXPIRED
const orgId = created.data.id, lic = A.readAll('Licenses').find(l => l.OrgID === orgId && l['Статус'] === 'ACTIVE');
A.update('Licenses', lic['License Key'], { 'Дата окончания': new Date(Date.now() - 864e5) });
assert.strictEqual(chk({ nonce: 'g'.repeat(20) }).license.status, 'GRACE', 'льготный период');
A.update('Licenses', lic['License Key'], { 'Дата окончания': new Date(Date.now() - 4 * 864e5) });
assert.strictEqual(chk({ nonce: 'e'.repeat(20) }).license.status, 'EXPIRED', 'после льготного периода — истекла');
A.update('Licenses', lic['License Key'], { 'Дата окончания': new Date(Date.now() + 90 * 864e5) });
// подписанные запросы клиента: обращение в поддержку, запрос доступа и согласие, повтор подписи отклоняется
const ts = Date.now(), sig = require('crypto').createHmac('sha256', secret).update(licenseKey + '|' + ts).digest('hex');
const api = p => JSON.parse(A.doPost({ parameter: {}, postData: { contents: JSON.stringify(p) } }).text);
assert(api({ action: 'support.request', key: licenseKey, ts, sig, subject: 'Не печатается этикетка' }).ok, 'обращение клиента');
assert(!api({ action: 'support.request', key: licenseKey, ts, sig, subject: 'повтор' }).ok, 'повтор подписи отклонён');
assert(A.readAll('MASTER_DOCUMENT_TEMPLATES').length === 26 && A.readAll('MASTER_RULES').length === 19, 'эталоны 2.0 заполнены при установке');
assert.strictEqual(A.adminSeedMasters(T).data.added, 0, 'повторно — без дублей');
const sr = A.adminSupportSessionRequest(T, orgId, 'Проверить настройки печати', 30); assert(sr.ok);
const seen = chk({ nonce: 's'.repeat(20) }); assert.strictEqual(seen.license.supportRequests.length, 1, 'клиент видит запрос доступа');
const ts2 = ts + 1, sig2 = require('crypto').createHmac('sha256', secret).update(licenseKey + '|' + ts2).digest('hex');
const cons = api({ action: 'support.consent', key: licenseKey, ts: ts2, sig: sig2, sessionId: sr.data.sessionId, allow: true, by: 'Директор' });
assert(cons.ok && cons.status === 'GRANTED' && A.readAll('CONSENTS').length === 1, 'согласие клиента записано');
// релиз: пилот → задания обновления ждут резервную копию клиента
const rel = A.adminReleaseCreate(T, { version: '2.2.0', notes: 'ЦЕХ Стандарт 2.2' }); assert(rel.ok);
assert.strictEqual(A.readAll('APP_RELEASES')[0].status, 'PILOT', 'новый релиз — в пилотном канале');
assert(A.adminReleasePromote(T, rel.data.releaseId, 'STABLE').ok);
// диагностика по согласию: запрос → клиент разрешил (ключ уходит в админ-панель) → чтение сводки → отзыв
A.UrlFetchApp = { fetch: url => { const m = /[?&]diag=([^&]+)/.exec(url); const r = m ? Cl._tsDiagPage_(decodeURIComponent(m[1])) : { text: '{}' }; return { getResponseCode: () => 200, getContentText: () => r.text }; } };
const sr2 = A.adminSupportSessionRequest(T, orgId, 'Ошибка печати этикеток', 30); assert(sr2.ok);
Cl._tsLicense_(true);
assert.strictEqual(A.adminSupportDiagnostics(T, sr2.data.sessionId).ok, false, 'до согласия диагностики нет');
const c2 = JSON.parse(Cl.tsSupportConsent('tok', sr2.data.sessionId, true)); assert(c2.success && c2.data.status === 'GRANTED', JSON.stringify(c2));
assert(!JSON.stringify(A.readAll('SUPPORT_SESSIONS')).includes(A.PropertiesService.getScriptProperties().getProperty('DIAG_' + sr2.data.sessionId)), 'ключ диагностики не лежит в таблице');
const dg = A.adminSupportDiagnostics(T, sr2.data.sessionId); assert(dg.ok && dg.data.ok && dg.data.version, 'диагностика читается: ' + JSON.stringify(dg));
assert(!/client@example|Кафе Тест/.test(JSON.stringify(dg.data)), 'в диагностике нет персональных данных и названия клиента');
assert.strictEqual(JSON.parse(Cl._tsDiagPage_('чужой-ключ').text).ok, false, 'чужой ключ не принимается');
assert(JSON.parse(Cl.tsSupportRevoke('tok')).success);
assert.strictEqual(A.readAll('SUPPORT_SESSIONS').find(x => x.sessionId === sr2.data.sessionId).status, 'REVOKED', 'отзыв дошёл до админ-панели');
assert.strictEqual(A.adminSupportDiagnostics(T, sr2.data.sessionId).ok, false, 'после отзыва диагностики нет');
// статистика и технические ошибки уходят после проверки лицензии, без персональных данных
Cl._tsTechEvent_('EXCEPTION', 'createDish', 'Ошибка для client@example.com 79991234567');
G.PropertiesService.getScriptProperties().deleteProperty('TS_USAGE_SENT_AT'); Cl._tsLicense_(true);
assert(A.readAll('AGGREGATED_USAGE').length >= 1, 'обезличенная статистика получена');
const te = A.readAll('TECH_EVENTS'); assert(te.length >= 1 && !/client@example|79991234567/.test(JSON.stringify(te)), 'тех. ошибка получена, почта и номер вырезаны: ' + JSON.stringify(te));
console.log('OK: контур 2.0 — хеш ключа, nonce, льготный период, поддержка с согласием, эталоны, релизы');
console.log('OK: лицензия, подпись, тарифы, режим только чтения, продление, роли, оплата ЮMoney — все проверки пройдены');
