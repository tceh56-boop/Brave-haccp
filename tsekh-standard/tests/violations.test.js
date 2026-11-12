/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
// Мастер-промт 4.0, этап 6: единый контур нарушений — «Журналы_Отклонения» + «Корректирующие_Действия»: исключения экрана «Сейчас», санитария V43, задачи ППК;
// жизненный цикл «открыто → ожидает проверки → устранено / открыто повторно», проверка другим сотрудником. Настоящий код, имитация таблиц.
// Запуск: node tests/violations.test.js
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert'), { make } = require('./gas_mock');
const app = path.join(__dirname, '..', 'app'), G = make('owner@example.com');
let n = 0; const t = (name, f) => { f(); n++; console.log('  ✓ ' + name); };
const sheets = {}; let writes = 0;
function sheet(name) { const s = { data: [], getName: () => name, getLastRow: () => s.data.length, getLastColumn: () => s.data.reduce((m, r) => Math.max(m, r.length), 0), setFrozenRows() {}, appendRow(r) { s.data.push(r.slice()); },
  getMaxRows: () => 1000, clearContents() { s.data = []; return s; }, deleteRows() {}, getSheetId: () => 1, getMaxColumns: () => 26, getDataRange() { return s.getRange(1, 1, Math.max(1, s.data.length), Math.max(1, s.getLastColumn())); },
  getRange(r, c, nr = 1, nc = 1) { return { setValues(v) { writes++; v.forEach((row, i) => { s.data[r - 1 + i] = s.data[r - 1 + i] || []; row.forEach((x, j) => { s.data[r - 1 + i][c - 1 + j] = x; }); }); return this; },
    getValues() { const o = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(((s.data[r - 1 + i] || [])[c - 1 + j]) ?? ''); o.push(row); } return o; },
    setValue(v) { writes++; s.data[r - 1] = s.data[r - 1] || []; s.data[r - 1][c - 1] = v; return this; }, getValue() { return ((s.data[r - 1] || [])[c - 1]) ?? ''; },
    setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; }, setNumberFormat() { return this; } }; } }; return s; }
const book = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = sheet(n)) };
const table = (name, head, rows) => { const s = book.getSheetByName(name) || book.insertSheet(name); s.data = [head.slice()].concat(rows.map(r => r.slice())); return s; };
let session = { user_id: 'E1', name: 'Шеф Петров', role: 'Шеф-повар' };
const audits = [];
Object.assign(G, { _book_: () => book, _mcTz_: () => 'Europe/Moscow', _withLock_: f => f(), _log_: () => {}, mcGateSession_: () => session,
  _ok_: d => JSON.stringify({ success: true, data: d }), _fail_: (c, m) => JSON.stringify({ success: false, error: { code: c, message: m } }), _failFrom_: e => JSON.stringify({ success: false, error: { message: String(e.message || e) } }),
  _requireAuth_: () => session, _beginOp_: () => ({ id: 'OP', session }), _endOp_: () => {}, _audit_: () => {}, _mcSessionFullName_: s => s && s.name || '', _getSession_: () => session, _parseDate_: x => new Date(x),
  _mcOrg_: () => ({ name: 'Кафе', responsibleName: 'Петрова' }), _mcOrgCompleteness_: () => ({ complete: true, missing: [] }), _mcRbEmpState_: () => ({}), _dishWorkshopMap_: () => ({}), JOURNALS: [], MC_RB_ROLES_: [] });
G.Utilities.formatDate = (d, tz, f) => { const x = new Date(d), p = v => String(v).padStart(2, '0'); return f.replace('yyyy', x.getFullYear()).replace('MM', p(x.getMonth() + 1)).replace('dd', p(x.getDate())).replace("'T'", 'T').replace('HH', p(x.getHours())).replace('mm', p(x.getMinutes())).replace('ss', p(x.getSeconds())); };
const ctx = vm.createContext(G);
['TS2_Schema.gs', 'TS2_Core.gs', 'TS2_Reconcile.gs', 'TS2_Generate.gs', 'TS_TtkProcess.gs', 'MonChef_V30_ComplianceHaccpCore.gs', 'MonChef_V64_EconomyFlow.gs', 'MonChef_V64_Finance.gs', 'MonChef_V65_PPK.gs', 'TS_HaccpLink.gs', 'TS2_Ready.gs', 'TS_Sensors.gs', 'TS_ChecklistGen.gs', 'MonChef_V43_SANITATION_CHECKLIST_BRIDGE.gs', 'TS_Violations.gs'].forEach(f => {
  const file = fs.readdirSync(app).find(x => x === f) || fs.readdirSync(app).find(x => x.startsWith(f.replace(/_[A-Z_]+\.gs$/, '')) && x.endsWith('.gs'));
  vm.runInContext(fs.readFileSync(path.join(app, file), 'utf8'), ctx, { filename: file });
});
const C = ctx; vm.runInContext("var MC_WASTE_MAX_DAYS_ = { 'пищевые': 1, 'ТКО': 3 };", ctx); C._ts2Ent_ = () => 'ENT-A'; C._ts2Audit_ = (...a) => audits.push(a); C._ts2EnsureSchema_ = () => {}; C._TS2_SH_ = {};
vm.runInContext('_TS2_SH_ = {};', ctx);

// функции реестра нарушений — из настоящего Code.gs
{ const code = fs.readFileSync(path.join(app, 'Code.gs'), 'utf8');
  const fn = name => { const i = code.indexOf('function ' + name + '('); let d = 0, j = code.indexOf('{', i); for (; j < code.length; j++) { if (code[j] === '{') d++; else if (code[j] === '}' && --d === 0) break; } return code.slice(i, j + 1); };
  vm.runInContext(['_devSheet_', '_corrSheet_', 'recordCorrectiveAction', 'resolveCriticalIncident', '_incSheet_'].map(fn).join('\n'), ctx); }
const j34 = []; C._addCorrectiveAction_ = (...a) => j34.push(a);
const J = s => { const r = JSON.parse(s); if (!r.success) throw new Error(r.error.message); return r.data; };
const HB = ['Код', 'Название', 'Категория', 'Выход', 'Ед', 'Технология', 'Фото', 'Цена', 'Цех', 'Срок, ч'];
const dish = (code, name, tech, shelf) => [code, name, 'Горячее', 250, 'г', tech, '', '', 'Горячий', shelf || ''];
const HS = ['Код', 'Продукт', 'Ед', 'Брутто', 'База', 'Нетто'];
const reset = (dishes, comp) => { Object.keys(sheets).forEach(k => delete sheets[k]); vm.runInContext('_TS2_SH_ = {};', ctx); table('Блюда', HB, dishes); table('Состав', HS, comp); table('ID_COUNTERS', ['counterCode', 'prefix', 'year', 'lastNumber', 'updatedAt', 'updatedBy'], []); };
const live = () => C._ts2Rows_('TTK_PROCESS_MAP').filter(r => r.reviewStatus !== 'SUPERSEDED');
const issues = code => C._ts2Rows_('TTK_PROCESS_ISSUES').filter(i => i.status === 'OPEN' && (!code || i.ttkId === code)).map(i => i.code);

const DEV = () => sheets['Журналы_Отклонения'].data.slice(1), CA = () => sheets['Корректирующие_Действия'].data.slice(1);
const AR = id => C._ts2Rows_('AUTO_RECORDS').find(r => r.autoRecordId === id);
const as = (name, role) => { session = { user_id: name, name, fullName: name, role }; };
const ivanova = () => as('Повар Иванова', 'Повар'), petrov = () => as('Шеф Петров', 'Шеф-повар');
const F = s => { const r = JSON.parse(s); return r.success ? null : r.error.message; };
const fresh = () => { reset([dish('A1', 'Говядина', 'Жарить.')], []); C._ts2SetProf_('mode', 'READY_TO_WORK'); C._devSheet_(); C._corrSheet_(); j34.length = 0; ivanova(); };

t('Исключение экрана «Сейчас» → нарушение в едином реестре; «Устранено» → «ожидает проверки»; подтверждает только другой сотрудник', () => {
  fresh();
  const r = C._ts2Exception_('TEMP_OUT', 'Холодильник 2: 9 °C (норма 2…6)', 'OBJ-2');
  const d = DEV().find(x => x[1] === 'TS2:' + r.autoRecordId); assert(d && d[7] === 'открыто' && /9 °C/.test(d[4]), 'нарушение в реестре');
  assert.strictEqual(J(C.ts2Exceptions('tok')).exceptions.length, 1);
  const res = J(C.ts2ResolveException('tok', r.autoRecordId, 'Перенесли продукты, вызвали мастера'));
  assert.strictEqual(res.status, 'ожидает проверки'); assert.strictEqual(DEV().find(x => x[0] === d[0])[7], 'ожидает проверки');
  assert.strictEqual(AR(r.autoRecordId).status, 'VERIFY_REQUIRED'); assert.strictEqual(J(C.ts2Exceptions('tok')).exceptions.length, 0, 'на экране — не в «отклонениях», а в «ожидают проверки»');
  assert(CA().some(c => c[1] === d[0] && c[5] === 'выполнено' && c[7] === 'Повар Иванова') && j34.length === 1, 'действие и журнал J34');
  const v = J(C.vioList('tok')).items.find(x => x.id === d[0]); assert(v.status === 'ожидает проверки' && v.corrector === 'Повар Иванова');
  assert(/другой сотрудник/.test(F(C.vioVerify('tok', d[0], true, ''))), 'тот же сотрудник не подтверждает');
  petrov(); J(C.vioVerify('tok', d[0], true, ''));
  assert.strictEqual(DEV().find(x => x[0] === d[0])[7], 'устранено'); assert(!!DEV().find(x => x[0] === d[0])[12], 'дата устранения');
  assert.strictEqual(AR(r.autoRecordId).status, 'RESOLVED');
});
t('Не подтверждено → «открыто повторно» (источник снова открыт); новое действие → снова проверка', () => {
  fresh(); const r = C._ts2Exception_('TASK_NO', 'Уборка — «Нет»', 'EXP-X'); const id = DEV()[0][0];
  J(C.ts2ResolveException('tok', r.autoRecordId, 'Убрали')); petrov();
  assert(/что не устранено/.test(F(C.vioVerify('tok', id, false, ''))), 'причина обязательна');
  J(C.vioVerify('tok', id, false, 'Под столом грязно'));
  assert.strictEqual(DEV()[0][7], 'открыто повторно'); assert.strictEqual(AR(r.autoRecordId).status, 'OPEN');
  assert(/не устранено|Проверка устранения: не подтверждено/.test(CA().map(c => c[2]).join('|')));
  ivanova(); J(C.vioCorrect('tok', id, 'Убрали под столом', 'фото')); petrov(); J(C.vioVerify('tok', id, true, ''));
  assert.strictEqual(DEV()[0][7], 'устранено');
  assert(/уже закрыто/.test(F(C.vioCorrect('tok', id, 'ещё', ''))), 'закрытое не исправляется');
});
t('Санитария V43: нарушение в едином реестре; устранение и проверка V43 идут через общий цикл, статус V43 синхронен', () => {
  fresh(); C.setupV43SanitationChecklist && C.setupV43SanitationChecklist();
  const aid = C.v43CreateAlert_('SANITATION_FAILED', 'TASK-1', 'HIGH', 'Концентрация 0.3% вне режима', 'TASK-1');
  const d = DEV().find(x => x[1] === 'V43:' + aid); assert(d && d[2] === 'Санитария');
  const r1 = C.v43ResolveDeviation(aid, 'Раствор переготовлен', 'tok'); assert.strictEqual(r1.status, 'VERIFY_REQUIRED');
  const al = () => C._v43Rows_(vm.runInContext('V43_SAN.ALERT', ctx)).find(a => a.AlertID === aid);
  assert(al().Status === 'VERIFY_REQUIRED' && /Устранено: Раствор переготовлен \(Повар Иванова/.test(al().Message));
  assert.throws(() => C.v43VerifyDeviation(aid, true, '', 'tok'), /другой сотрудник/);
  petrov(); const r2 = C.v43VerifyDeviation(aid, true, 'проверил тест-полоской', 'tok');
  assert(r2.status === 'CLOSED' && al().Status === 'CLOSED' && DEV().find(x => x[0] === d[0])[7] === 'устранено');
});
t('«Нет» по задаче ППК → нарушение со ссылкой в графике ППК (DeviationID)', () => {
  fresh();
  C._v65Sh_('SCH'); sheets['ППК_График'].data.push(['SCH-1', 'PPK-1', 'CP-1', 'день', new Date(), '', 'PLANNED', '', '', '', '']);
  C._ts2Insert_('JOURNAL_EXPECTATIONS', { expectationId: 'EXP-P1', enterpriseId: 'ENT-A', journalCode: 'LAB:L1', eventRuleId: 'PPK-CP-1', objectType: 'PPK_SCHEDULE', objectId: 'SCH-1', dueAt: C._ts2Iso_(), responsibleRole: 'Повар', status: 'OPEN', confirmationMode: 'CONFIRM', title: 'ППК: Смывы', idempotencyKey: 'k1' });
  C._ts2Confirm_('EXP-P1', false, 'Не выполнен пункт 2: протокол', '');
  const s = C._v65Objs_('SCH').find(x => x.ScheduleID === 'SCH-1'); assert.strictEqual(s.Status, 'DEVIATION');
  const d = DEV().find(x => x[0] === s.DeviationID); assert(d && d[3] === 'ППК: Смывы' && d[2] === 'LAB:L1' && /протокол/.test(d[4]), 'нарушение связано с пунктом графика');
});
t('Журнальное нарушение (recordCorrectiveAction): ожидает проверки; критическое подтверждает только ответственный за ХАССП; режим «самопроверка» — только для некритических', () => {
  fresh();
  sheets['Журналы_Отклонения'].data.push(['DV-1', '', 'J01', 'Холодильник 1', 't° 9', 9, false, 'открыто', '', '', 'Повар Иванова', new Date(), '', ''], ['DV-2', '', 'J03', 'Котлеты', 'ККТ не достигнута', 60, true, 'открыто', '', '', 'Повар Иванова', new Date(), '', '']);
  const r = J(C.recordCorrectiveAction(JSON.stringify({ devId: 'DV-1', действие: 'Продукты перенесены' }), 'tok'));
  assert(r.статус === 'ожидает проверки' && r.закрыто === false && /другой сотрудник/.test(r.примечание));
  J(C.recordCorrectiveAction(JSON.stringify({ devId: 'DV-2', действие: 'Дожарили до 75' }), 'tok'));
  as('Су-шеф Сидоров', 'Су-шеф'); C._mcRbHas_ = (s, p) => s.role === 'Ответственный за ХАССП';
  assert(/ответственный за ХАССП/.test(F(C.vioVerify('tok', 'DV-2', true, ''))), 'критическое — только ХАССП');
  J(C.vioVerify('tok', 'DV-1', true, '')); assert.strictEqual(DEV().find(x => x[0] === 'DV-1')[7], 'устранено');
  as('Анна ХАССП', 'Ответственный за ХАССП'); J(C.vioVerify('tok', 'DV-2', true, 'замер 78 °C')); assert.strictEqual(DEV().find(x => x[0] === 'DV-2')[7], 'устранено');
  delete C._mcRbHas_;
  J(C.vioSetVerifyMode('tok', 'SELF')); ivanova();
  sheets['Журналы_Отклонения'].data.push(['DV-3', '', 'J01', 'Ларь', 't° -10', -10, false, 'открыто', '', '', 'x', new Date(), '', ''], ['DV-4', '', 'J03', 'Суп', 'ККТ', 50, true, 'открыто', '', '', 'x', new Date(), '', '']);
  assert.strictEqual(J(C.recordCorrectiveAction(JSON.stringify({ devId: 'DV-3', действие: 'Разморозка остановлена' }), 'tok')).статус, 'устранено', 'самопроверка: некритическое закрывается сразу');
  assert.strictEqual(J(C.recordCorrectiveAction(JSON.stringify({ devId: 'DV-4', действие: 'Доварили' }), 'tok')).статус, 'ожидает проверки', 'критическое — всегда проверка');
  assert(audits.some(a => a[0] === 'VIOLATION_VERIFY_MODE'));
  assert(/режим/i.test(F(C.vioSetVerifyMode('tok', 'ANY'))));
});
t('Замер холодильника из старого реестра: нарушение уже записал модуль температур — связывается, дубля нет', () => {
  fresh(); sheets['Журналы_Отклонения'].data.push(['DV-T', '', 'J01', 'Холодильник 1', 'Температура вне диапазона', 9, false, 'открыто', '', '', 'Повар Иванова', new Date(), '', '']);
  const r = C._ts2Exception_('TEMP_OUT', 'Холодильник 1: 9 °C', 'EXP-F', { deviationId: 'DV-T' });
  assert.strictEqual(DEV().length, 1, 'нет дубля'); assert.strictEqual(DEV()[0][1], 'TS2:' + r.autoRecordId, 'связь с исключением экрана');
  J(C.ts2ResolveException('tok', r.autoRecordId, 'Перенесли')); assert.strictEqual(DEV()[0][7], 'ожидает проверки');
});
console.log('violations: ' + n + ' сценариев пройдено');
