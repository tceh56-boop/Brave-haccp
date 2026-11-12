/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
// Мастер-промт 4.0, этап 9: сквозной сценарий одной модели предприятия — ТТК (с п/ф) → процессы → ХАССП → ППК → чек-листы →
// «Сейчас» → нарушение → устранение → проверка → аудит 360°. Каждый шаг читает результат предыдущего. Настоящий код, имитация таблиц.
// Запуск: node tests/e2e_chain.test.js
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
const as = (name, role) => { session = { user_id: name, name, fullName: name, role }; };
const item = id => C._a360Items_().find(x => x.id === id);

t('Сквозной сценарий: от ТТК до акта аудита 360°', () => {
  // 0. Предприятие: две ТТК, блюдо с полуфабрикатом, лабораторный план
  reset([dish('B1', 'Бефстроганов', 'Говядину нарезать соломкой. Обжарить 5 мин при 180 °C до 75 °C в толще. Соединить с соусом. Подают горячим.'),
         dish('S1', 'Соус демиглас', 'Кости запечь 40 мин при 200 °C. Варить 8 часов. Охладить до +4 °C за 2 ч. Разлить в гастроёмкости. Хранить при +2…+4 °C. Срок реализации 48 ч.', 48)],
        [['B1', 'Говядина', 'кг', 0.2, 0, 0.2], ['B1', 'Соус демиглас п/ф', 'кг', 0.05, 0, 0.05]]);
  C._ts2SetProf_('mode', 'READY_TO_WORK'); C._v30Init_(); C._devSheet_(); C._corrSheet_(); as('Шеф Петров', 'Шеф-повар');
  table('Лаборатория_План', ['PlanID', 'ObjectName', 'Indicator', 'Method', 'FrequencyDays', 'ResponsibleRole', 'Normative', 'Active'], [['L1', 'Смывы с рук', 'БГКП', 'ГОСТ 31747', 1, 'Ответственный за ХАССП', 'не допускается', true]]);
  assert.strictEqual(item('R21').status, 'MISSING_EVIDENCE', 'до анализа — нет доказательств');
  // 1. ТТК → процессы (этап 2): операции п/ф входят в блюдо
  const an = C._ttkpAnalyze_(null); assert.strictEqual(an.analyzed, 2);
  const procB1 = C._ttkpProcessesOf_('B1').map(r => r.processCode); ['CUT', 'FRY', 'BAKE', 'BOIL', 'COOL'].forEach(c => assert(procB1.includes(c), 'B1 ← ' + c + ': ' + procB1));
  // 2. процессы → ХАССП (этап 3): предложения, решения человека
  const hz = C._hzlSync_(); assert(hz.hazardsProposed >= 5 && hz.needDecision >= 5);
  assert.strictEqual(item('R22').status, 'FAIL');
  as('Анна ХАССП', 'Ответственный за ХАССП');
  C._v30Rows_('HACCP_Опасности_V30').forEach(h => J(C.haccpHazardDecide('tok', h[0], /прожарке|тепловой|охлажден/.test(h[3]) ? 'да' : 'нет', /прожарке|тепловой|охлажден/.test(h[3]) ? 'ОППУ: термощуп, журнал' : '', /прожарке|тепловой|охлажден/.test(h[3]) ? 'журнал бракеража' : 'контроль по ППУ (санитарный режим)')));
  assert.strictEqual(item('R22').status, 'PASS', item('R22').detail);
  // 3. ППК (этап 4): формирование из карты рисков, ввод
  const ppkId = J(C.v65CreatePpk(JSON.stringify({ name: 'ППК 2026', dateFrom: day() }), 'tok')).ppkId; J(C.v65Generate(ppkId, 'tok'));
  const acts = C._v65Objs_('ACT').filter(a => a.PPKID === ppkId);
  assert(acts.some(a => /^Мера управления/.test(a.Parameter) && a.ProcessID === 'PROC-TTK-FRY' && a.JournalID === 'J-KKT-THERMAL'), 'мероприятие по жарке из карты рисков');
  assert(acts.some(a => /^Мера управления/.test(a.Parameter) && /COOL/.test(a.ProcessID)) || acts.some(a => /охлажд/.test(a.Parameter)), 'мероприятие по охлаждению п/ф');
  assert(/Связь с технико-технологическими картами/.test(C._v65Objs_('SEC').find(x => x.PPKID === ppkId && x.SectionCode === 'HACCP').Text));
  const p = C._v65Get_(ppkId); C._v65SetCell_('PPK', p._row, 'Status', 'APPROVED'); J(C.v65Activate(ppkId, 'tok'));
  // 4. чек-листы (этап 5) → задачи дня
  const tpl = C._ts2Rows_('CHECKLIST_TEMPLATES').filter(x => x.status === 'ACTIVE');
  assert(tpl.some(x => x.executionMode === 'TASK' && /БГКП/.test(x.title)) && tpl.some(x => x.executionMode === 'EVENT' && /Мера управления/.test(x.title)), 'лаборатория — задача, мера по выработке — по событию');
  C._ts2GenerateDay_(day()); const now = C._ts2NowTasks_(); const lab = now.find(x => /БГКП/.test(x.title));
  assert(lab && lab.checklist.length >= 2, 'задача с чек-листом на экране «Сейчас»');
  // 5. «Нет» → нарушение (этап 6) → устранение → проверка другим сотрудником
  as('Повар Иванова', 'Повар'); C._ts2Confirm_(lab.id, false, 'Не выполнен пункт 2: протокол не получен', '');
  const sch = C._v65Objs_('SCH').find(s => s.ScheduleID === C._ts2Find_('JOURNAL_EXPECTATIONS', 'expectationId', lab.id).objectId);
  assert.strictEqual(sch.Status, 'DEVIATION'); const dv = DEV().find(r => r[0] === sch.DeviationID); assert(dv && dv[7] === 'открыто', 'нарушение в едином реестре и в графике ППК');
  assert(J(C.vioList('tok')).items.some(v => v.id === dv[0]));
  J(C.vioCorrect('tok', dv[0], 'Протокол запрошен в лаборатории и приложен', 'протокол № 15'));
  assert(/другой сотрудник/.test(JSON.parse(C.vioVerify('tok', dv[0], true, '')).error.message));
  as('Анна ХАССП', 'Ответственный за ХАССП'); J(C.vioVerify('tok', dv[0], true, 'протокол проверен'));
  assert.strictEqual(DEV().find(r => r[0] === dv[0])[7], 'устранено');
  const ar = C._ts2Rows_('AUTO_RECORDS').find(r => 'TS2:' + r.autoRecordId === dv[1]); assert.strictEqual(ar.status, 'RESOLVED', 'источник закрыт вместе с реестром');
  // 6. аудит 360° (этапы 7–8): итог по фактам, доказательства открываются
  const r = C._mcReadinessCompute_(), ids = {}; r.items.forEach(x => { ids[x.id] = x; });
  assert.strictEqual(ids.R22.status, 'PASS'); assert.strictEqual(ids.R24.status, 'PASS'); assert.strictEqual(ids.R27.status, 'PASS', ids.R27.detail);
  assert(['PASS', 'REVIEW'].includes(ids.R21.status), ids.R21.detail);
  const a = J(C.a360Run('tok')); assert(/Акт внутреннего санитарного аудита 360°/.test(a.html));
  const ev = J(C.a360Evidence('tok', dv[0])); assert(ev.related.some(x => /Протокол запрошен/.test(x[1])) && ev.related.some(x => /Проверка устранения: подтверждено/.test(x[1])), 'история нарушения видна из аудита');
  // 7. изменение ТТК после ввода ППК: новая операция → ХАССП → пункт R22 снова требует решения
  sheets['Блюда'].data[1][5] += ' Вакуумировать и заморозить до -18 °C.'; C._ttkpAnalyze_(null);
  assert.strictEqual(item('R22').status, 'FAIL', 'новая операция без анализа опасностей — нарушение');
  assert(/без анализа: [1-9]/.test(item('R22').detail), item('R22').detail);
});
console.log('e2e_chain: ' + n + ' сценариев пройдено');
