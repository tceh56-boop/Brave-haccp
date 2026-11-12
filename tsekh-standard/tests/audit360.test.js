/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
// Мастер-промт 4.0, этап 7: санитарный аудит 360° — контрольный лист готовности R01–R28 (R21–R28 — цепочка ТТК → ХАССП → ППК → чек-листы → исполнение → нарушения),
// перенос нарушений V42/V44 в единый реестр. Настоящий код, имитация таблиц.
// Запуск: node tests/audit360.test.js
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
['TS2_Schema.gs', 'TS2_Core.gs', 'TS2_Reconcile.gs', 'TS2_Generate.gs', 'TS_TtkProcess.gs', 'MonChef_V30_ComplianceHaccpCore.gs', 'MonChef_V64_EconomyFlow.gs', 'MonChef_V64_Finance.gs', 'MonChef_V65_PPK.gs', 'TS_HaccpLink.gs', 'TS2_Ready.gs', 'TS_Sensors.gs', 'TS_ChecklistGen.gs', 'MonChef_V43_SANITATION_CHECKLIST_BRIDGE.gs', 'TS_Violations.gs', 'MonChef_V42_SANITATION_ENGINE.gs', 'TS_Audit360.gs', 'MonChef_Readiness.gs'].forEach(f => {
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

const day = () => C._ts2Today_(), DEV = () => sheets['Журналы_Отклонения'].data.slice(1);
const item = id => C._a360Items_().find(x => x.id === id);
const fresh = (dishes) => { reset(dishes || [], []); C._ts2SetProf_('mode', 'READY_TO_WORK'); C._v30Init_(); C._devSheet_(); C._corrSheet_(); session = { user_id: 'E1', name: 'Шеф Петров', fullName: 'Шеф Петров', role: 'Шеф-повар' }; };
const TECH = 'Мясо нарезать. Жарить 6 мин при 180 °C. Охладить до +4 °C за 2 ч. Хранить при +2…+4 °C. Срок реализации 24 ч.';
function activePpk() {
  const id = J(C.v65CreatePpk(JSON.stringify({ name: 'ППК', dateFrom: day() }), 'tok')).ppkId; J(C.v65Generate(id, 'tok'));
  const p = C._v65Get_(id); C._v65SetCell_('PPK', p._row, 'Status', 'APPROVED'); J(C.v65Activate(id, 'tok')); return id;
}

t('Пустое предприятие: цепочка не придумывает выполнение — «не применимо» / «нет ППК»', () => {
  fresh();
  assert.strictEqual(item('R21').status, 'NOT_APPLICABLE'); assert.strictEqual(item('R22').status, 'NOT_APPLICABLE');
  assert(item('R23').status === 'FAIL' && /действующей ППК нет/.test(item('R23').detail) && item('R23').blocking);
  assert.strictEqual(item('R25').status, 'NOT_APPLICABLE'); assert.strictEqual(item('R26').status, 'MISSING_EVIDENCE');
});
t('ТТК и ХАССП: неанализированные карты — нет доказательств; нерешённые опасности — нарушение (блокирует); после решений — выполнено; доказательства — ID записей', () => {
  fresh([dish('A1', 'Говядина', TECH, 24)]);
  assert.strictEqual(item('R21').status, 'MISSING_EVIDENCE');
  C._ttkpAnalyze_(null); assert.strictEqual(item('R21').status, 'PASS', item('R21').detail);
  assert.strictEqual(item('R22').status, 'MISSING_EVIDENCE', 'операции без анализа опасностей');
  C._hzlSync_(); const r22 = item('R22'); assert(r22.status === 'FAIL' && r22.blocking && /без решения: [1-9]/.test(r22.detail));
  assert(r22.evidence.every(id => C._v30Rows_('HACCP_Опасности_V30').some(h => h[0] === id)), 'доказательства — ID опасностей V30');
  C._v30Rows_('HACCP_Опасности_V30').forEach(h => J(C.haccpHazardDecide('tok', h[0], 'да', 'ОППУ', 'журнал')));
  assert.strictEqual(item('R22').status, 'PASS', item('R22').detail);
  sheets['Блюда'].data[1][5] = 'Жарить.'; C._ttkpAnalyze_(null);
  assert.strictEqual(item('R21').status, 'REVIEW', 'карта без режимов → «требуется заполнение ТТК»'); assert(item('R21').evidence.every(id => /^TPI-/.test(id)));
});
t('ППК: полнота по проверке V65, способ исполнения мероприятий, выполнение графика по фактам', () => {
  fresh([dish('A1', 'Говядина', TECH, 24)]); C._ttkpAnalyze_(null); C._hzlSync_();
  const id = activePpk();
  const r23 = item('R23'); assert(r23.status === 'FAIL' && r23.evidence[0] === id && /HAZARDS|ZONES|ORG|SECTIONS|LAB|CCP|TTK_HACCP/.test(r23.evidence.join()), 'замечания проверки ППК: ' + r23.detail);
  assert.strictEqual(item('R24').status, 'PASS', item('R24').detail);
  assert.strictEqual(item('R25').status, 'MISSING_EVIDENCE', 'срок пунктов графика ещё не наступил');
  const sch = C._v65Objs_('SCH').filter(s => s.PPKID === id && s.DueDate);
  const old = new Date(Date.now() - 3 * 864e5);
  C._v65SetCell_('SCH', sch[0]._row, 'DueDate', old);
  assert.strictEqual(item('R25').status, 'FAIL'); assert.deepStrictEqual([...item('R25').evidence], [sch[0].ScheduleID]);
  C._v65SetCell_('SCH', sch[0]._row, 'Status', 'DONE'); C._v65SetCell_('SCH', sch[0]._row, 'FactID', 'AR-1');
  const r25 = item('R25'); assert(r25.status === 'PASS' && r25.evidence[0] === 'AR-1' && /100%/.test(r25.detail), r25.detail);
  sheets['ППК_Мероприятия'].data.push(C.MC_V65.ACT[1].map(h => ({ ControlPlanID: 'CP-M', PPKID: id, Object: 'Вентиляция', Parameter: 'Чистка', Frequency: '', Active: true })[h] ?? '')); C._clgBuild_();
  assert.strictEqual(item('R24').status, 'REVIEW');
});
t('Исполнение и нарушения: пропуски задач смены, нарушения дольше 3 суток и открытые повторно — нарушение; ждущие проверки — требует проверки', () => {
  fresh();
  const dt = new Date(Date.now() - 2 * 864e5), iso = C._ts2Iso_(dt);
  C._ts2InsertMany_('JOURNAL_EXPECTATIONS', [{ expectationId: 'EXP-1', enterpriseId: 'ENT-A', dueAt: iso, status: 'DONE', factId: 'AR-5', title: 'a', idempotencyKey: 'a' }, { expectationId: 'EXP-2', enterpriseId: 'ENT-A', dueAt: iso, status: 'MISSED', title: 'b', idempotencyKey: 'b' }]);
  assert(item('R26').status === 'FAIL' && item('R26').evidence[0] === 'EXP-2');
  C._ts2Update_('JOURNAL_EXPECTATIONS', 'expectationId', 'EXP-2', { status: 'DONE', factId: 'AR-6' }); assert(item('R26').status === 'PASS' && item('R26').evidence.includes('AR-6'));
  assert.strictEqual(item('R27').status, 'PASS', 'нарушений нет');
  sheets['Журналы_Отклонения'].data.push(['DV-W', '', 'J01', 'x', 'y', '', false, 'ожидает проверки', '', '', 'a', new Date(), '', '']);
  assert.strictEqual(item('R27').status, 'REVIEW');
  sheets['Журналы_Отклонения'].data.push(['DV-O', '', 'J01', 'x', 'y', '', false, 'открыто', '', '', 'a', new Date(Date.now() - 5 * 864e5), '', '']);
  assert(item('R27').status === 'FAIL' && item('R27').evidence[0] === 'DV-O' && /дольше 3 суток: 1/.test(item('R27').detail));
  sheets['Журналы_Отклонения'].data.push(['DV-X', '', 'J01', 'x', 'y', '', false, 'устранено', '', '', 'a', new Date(Date.now() - 9 * 864e5), '', '']);
  assert(!item('R27').evidence.includes('DV-X'), 'закрытые не считаются');
});
t('Нарушения V42/V44: новые — сразу в реестре (складские сигналы — нет, повторный сигнал — одна запись); старые — перенос по кнопке без дублей; закрытие синхронизирует модуль', () => {
  fresh(); C.setupV42Sanitation();
  C.v42CreateAlert_('LOW_STOCK', 'ST-1', 'MEDIUM', 'Остаток ниже минимального', '', 'ST-1');
  C.v42CreateAlert_('SOLUTION_EXPIRED', 'SOL-1', 'HIGH', 'Рабочий раствор просрочен', '', ''); C.v42CreateAlert_('SOLUTION_EXPIRED', 'SOL-1', 'HIGH', 'Рабочий раствор просрочен', '', '');
  assert.strictEqual(DEV().length, 1, 'складской сигнал не нарушение; повторный сигнал — одна запись'); assert.strictEqual(DEV()[0][1], 'V42:SOLUTION_EXPIRED:SOL-1');
  // сигналы, созданные до перехода (напрямую в листе модуля)
  sheets['Санитария_Алерты_V42'].data.push(['ALT-OLD', 'CONCENTRATION_DEVIATION', 'SOL-2', new Date(), 'CRITICAL', 'Концентрация вне режима', 'OPEN', '', '', new Date(), '']);
  table('Задачи_Алерты_V44', ['AlertID', 'AlertType', 'ObjectID', 'DateTime', 'Severity', 'Message', 'Status', 'CreatedAt', 'ResolvedAt'], [['A44', 'TASK_FAILED', 'T-1', new Date(), 'HIGH', 'Задача не выполнена', 'OPEN', new Date(), '']]);
  const r28 = item('R28'); assert(r28.status === 'REVIEW' && r28.evidence.includes('V42:ALT-OLD') && r28.evidence.includes('V44:A44'), JSON.stringify(r28.evidence));
  assert.strictEqual(J(C.a360MigrateViolations('tok')).migrated, 2); assert.strictEqual(J(C.a360MigrateViolations('tok')).migrated, 0, 'повтор без дублей');
  assert.strictEqual(item('R28').status, 'PASS'); assert(DEV().find(r => r[1] === 'V42:ALT-OLD')[6] === true, 'критическое');
  // закрытие в реестре → сигналы модуля закрыты (все повторы)
  const dv = DEV().find(r => r[1] === 'V42:SOLUTION_EXPIRED:SOL-1')[0];
  J(C.vioCorrect('tok', dv, 'Раствор утилизирован, приготовлен новый', '')); session = { user_id: 'E2', name: 'Анна', fullName: 'Анна', role: 'Ответственный за ХАССП' }; J(C.vioVerify('tok', dv, true, ''));
  assert(sheets['Санитария_Алерты_V42'].data.slice(1).filter(r => r[1] === 'SOLUTION_EXPIRED').every(r => r[6] === 'CLOSED' && r[10]), 'оба сигнала V42 закрыты');
});
t('Контрольный лист готовности содержит R21–R28; акт аудита 360° — процент выполнения, области, доказательства, оговорка', () => {
  fresh([dish('A1', 'Говядина', TECH, 24)]); C._ttkpAnalyze_(null); C._hzlSync_();
  C._bcSheet_ = C._bcSheet_ || ((n, h) => C._book_().getSheetByName(n) || (() => { const s = C._book_().insertSheet(n); s.appendRow(h); return s; })());
  const r = C._mcReadinessCompute_(); const ids = r.items.map(x => x.id);
  ['R21', 'R22', 'R23', 'R24', 'R25', 'R26', 'R27', 'R28'].forEach(id => assert(ids.includes(id), id));
  assert.strictEqual(r.overall, 'NOT_READY', 'без ППК — не готово');
  const a = J(C.a360Run('tok')); assert(a.runId && /^RDY-/.test(a.runId), 'прогон сохранён');
  assert(/Акт внутреннего санитарного аудита 360°/.test(a.html) && /Не является заключением надзорного органа/.test(a.html) && /R22/.test(a.html) && typeof a.score === 'number');
  assert(sheets['Готовность_Проверки'].data.length === 2, 'прогон записан в «Готовность_Проверки»');
});
console.log('audit360: ' + n + ' сценариев пройдено');
