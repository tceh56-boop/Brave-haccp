// Безопасность шлюза на настоящем zzz_MonChef_Gate.gs: аноним, служебные функции, права роли, технический доступ,
// fail-closed проверки тарифа и допуска, подделка расписания, двойное нажатие. Запуск: node tests/gate_security.test.js
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert'), { make } = require('./gas_mock');
const G = make('owner@example.com');
let activeEmail = '';   // анонимный посетитель веб-приложения: активного пользователя нет
G.Session = { getActiveUser: () => ({ getEmail: () => activeEmail }), getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }), getScriptTimeZone: () => 'Europe/Moscow' };
const sessions = { cook: { user_id: 'E1', name: 'Повар Тест', role: 'Повар горячего цеха', perms: { journals: true } }, chef: { user_id: 'E2', name: 'Шеф Тест', role: 'Шеф-повар', perms: { journals: true, ttk_edit: true } },
  tech: { user_id: 'TECH', name: 'Технический доступ', role: '', dev: true, perms: {} } };
const calls = [], denied = [];
let planGate = (n, need, mut) => '', compliance = () => '';
Object.assign(G, {
  _getSession_: t => sessions[t] || null, _mcRbHasExact_: (s, need) => String(need).split('|').some(k => s.perms[k]), _mcRbAuditDenied_: (s, n, need) => denied.push(n + ':' + need),
  _mcRbDenyJson_: (m, c) => JSON.stringify({ success: false, error: { code: c || 'FORBIDDEN', message: m } }), getRolePermissions: () => ({}),
  _createOperation_: () => ({ id: 'OP' }), _audit_: () => {}, _closeOperation_: () => {}, _withLock_: f => f(), _log_: () => {},
  _tsPlanGate_: (...a) => planGate(...a), _mcComplianceGate_: (...a) => compliance(...a)
});
const ok = n => function () { calls.push(n); return JSON.stringify({ success: true, data: n }); };
['addJournalEntry', 'createDish', 'buildV25ProductionSchedule', 'uiMe', 'loginWithPin', 'getAuditDashboard', 'archiveMonChefMonthly', 'installAllTriggers', 'setupSystemFromEditor', 'doPost'].forEach(n => { G[n] = ok(n); });
const ctx = vm.createContext(G);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app', 'zzz_MonChef_Gate.gs'), 'utf8'), ctx, { filename: 'zzz_MonChef_Gate.gs' });
const J = s => JSON.parse(s), T = tok => ({ __mct: tok }), code = r => (J(r).error || {}).code;
let pass = 0; const t = (name, fn) => { calls.length = 0; fn(); pass++; console.log('  ✓ ' + name); };

t('аноним не вызывает функции интерфейса', () => { assert.strictEqual(code(ctx.createDish('{}', T(''))), 'AUTH_REQUIRED'); assert.strictEqual(calls.length, 0); });
t('чужой или выдуманный ключ сессии не работает', () => { assert.strictEqual(code(ctx.addJournalEntry('{}', T('forged'))), 'AUTH_REQUIRED'); });
t('аноним не вызывает служебные функции (установка, триггеры)', () => { assert.strictEqual(code(ctx.installAllTriggers()), 'AUTH_REQUIRED'); assert.strictEqual(code(ctx.setupSystemFromEditor()), 'AUTH_REQUIRED'); assert.strictEqual(calls.length, 0); });
t('сотрудник не вызывает служебные функции', () => { const r = J(ctx.installAllTriggers(T('chef'))); assert.strictEqual(r.success, false); assert.strictEqual(calls.length, 0); });
t('подделанный вызов «по расписанию» с выдуманным triggerUid отклоняется', () => { assert.strictEqual(code(ctx.archiveMonChefMonthly({ triggerUid: '123' })), 'AUTH_REQUIRED'); assert.strictEqual(calls.length, 0); });
t('владелец проекта (из редактора) проходит к служебной функции', () => { activeEmail = 'owner@example.com'; assert(J(ctx.installAllTriggers()).success); activeEmail = ''; });
t('право роли: повар не создаёт ТТК, шеф-повар создаёт', () => { assert.strictEqual(J(ctx.createDish('{}', T('cook'))).success, false); assert(denied.some(d => /createDish/.test(d))); assert(J(ctx.createDish('{}', T('chef'))).success); });
t('технический доступ не делает записей ХАССП', () => { assert.strictEqual(code(ctx.addJournalEntry('{}', T('tech'))), 'TECH_NO_HACCP_RECORDS'); });
t('тариф: функция вне тарифа — PLAN_LIMIT', () => { planGate = () => '«Журналы» входят в тариф Basic Pro и выше'; assert.strictEqual(code(ctx.addJournalEntry('{"a":1}', T('cook'))), 'PLAN_LIMIT'); planGate = () => ''; });
t('fail-closed: проверка тарифа упала — отказ, а не пропуск', () => { planGate = () => { throw new Error('сбой'); }; assert.strictEqual(code(ctx.addJournalEntry('{"a":2}', T('cook'))), 'PLAN_CHECK_UNAVAILABLE'); planGate = () => undefined; assert.strictEqual(code(ctx.addJournalEntry('{"a":3}', T('cook'))), 'PLAN_CHECK_UNAVAILABLE'); planGate = () => ''; assert.strictEqual(calls.length, 0); });
t('fail-closed: проверка медицинского допуска упала — запись запрещена', () => { compliance = () => { throw new Error('сбой'); }; assert.strictEqual(code(ctx.addJournalEntry('{"a":4}', T('cook'))), 'COMPLIANCE_CHECK_UNAVAILABLE'); compliance = () => 'Нет медицинского допуска'; assert.strictEqual(code(ctx.addJournalEntry('{"a":5}', T('cook'))), 'MEDICAL_ADMISSION'); compliance = () => ''; assert.strictEqual(calls.length, 0); });
t('двойное нажатие: тот же вызов того же сотрудника не выполняется второй раз', () => { const a = ctx.addJournalEntry('{"x":9}', T('cook')), b = ctx.addJournalEntry('{"x":9}', T('cook')); assert(J(a).success && J(b).success); assert.strictEqual(calls.length, 1); });
t('публичные функции работают без входа, портал проверяющего пропускается к своей проверке ключа', () => { assert(J(ctx.loginWithPin()).success); assert(J(ctx.getAuditDashboard('raw')).success); });
t('вход датчиков doPost не требует сессии (ключ устройства проверяет TS_Sensors)', () => { assert(J(ctx.doPost({ postData: { contents: '{}' } })).success); assert.strictEqual(calls.length, 1); });
// P1-2: веб-приложение выполняется от имени открывшего его Google-аккаунта (USER_ACCESSING)
let accessing = false, accessingThrows = false; const allowedAcc = ['director@cafe-a.example', 'chef@cafe-a.example'];
G._tsExecAccessing_ = () => { if (accessingThrows) throw new Error('сбой'); return accessing; };
G._tsIdentity_ = () => activeEmail; G._tsIdentityAllowed_ = () => allowedAcc.includes(activeEmail);
const asUser = (email, f) => { activeEmail = email; G.Session.getEffectiveUser = () => ({ getEmail: () => email }); try { return f(); } finally { activeEmail = ''; G.Session.getEffectiveUser = () => ({ getEmail: () => 'owner@example.com' }); } };
t('USER_ACCESSING: «владелец» без сессии больше не доверенный — активный и эффективный пользователь совпадают у всех', () => {
  accessing = true; try {
    assert.strictEqual(code(asUser('director@cafe-a.example', () => ctx.installAllTriggers())), 'AUTH_REQUIRED', 'служебная функция без сессии');
    assert.strictEqual(code(asUser('director@cafe-a.example', () => ctx.createDish('{}'))), 'AUTH_REQUIRED', 'функция интерфейса без сессии'); assert.strictEqual(calls.length, 0);
  } finally { accessing = false; }
});
t('USER_ACCESSING: Google-аккаунт не из предприятия не проходит даже с действующей сессией ПИН', () => {
  accessing = true; try { assert.strictEqual(code(asUser('stranger@other.example', () => ctx.createDish('{}', T('chef')))), 'IDENTITY_DENIED'); assert.strictEqual(calls.length, 0);
    assert.strictEqual(code(asUser('', () => ctx.loginWithPin('1234'))), 'IDENTITY_DENIED', 'даже вход по ПИН — только аккаунтам предприятия');
    assert(J(asUser('chef@cafe-a.example', () => ctx.createDish('{}', T('chef')))).success, 'аккаунт предприятия + сессия ПИН — работает');
  } finally { accessing = false; }
});
t('USER_ACCESSING: расписание (настоящий triggerUid) работает, даже если getActiveUser() в триггере пуст; поддельный — нет', () => {
  accessing = true; const pt = G.ScriptApp.getProjectTriggers; G.ScriptApp.getProjectTriggers = () => [{ getUniqueId: () => 'TRG-1' }];
  try { assert(J(asUser('', () => ctx.archiveMonChefMonthly({ triggerUid: 'TRG-1' }))).success); assert.strictEqual(code(asUser('', () => ctx.archiveMonChefMonthly({ triggerUid: 'FAKE' }))), 'IDENTITY_DENIED'); }
  finally { accessing = false; G.ScriptApp.getProjectTriggers = pt; }
});
t('USER_ACCESSING: сбой проверки аккаунта — отказ (fail-closed); вход датчиков (служебное развёртывание) не затронут', () => {
  accessingThrows = true; try { assert.strictEqual(code(asUser('chef@cafe-a.example', () => ctx.createDish('{}', T('chef')))), 'IDENTITY_CHECK_UNAVAILABLE'); } finally { accessingThrows = false; }
  accessing = true; try { assert(J(ctx.doPost({ postData: { contents: '{}' } })).success); } finally { accessing = false; }
});
console.log('Шлюз: ' + pass + ' проверок безопасности пройдено');
