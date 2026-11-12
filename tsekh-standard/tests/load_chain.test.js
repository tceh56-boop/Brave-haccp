/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
// Мастер-промт 4.0, этап 9: нагрузка — 300 ТТК, год графика ППК, 5000 задач смены, 2000 нарушений. Считаются обращения к таблице
// (чтение/запись диапазонов) и прочитанные ячейки по каждой операции: в Apps Script время определяют они. Запуск: node tests/load_chain.test.js
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert'), { make } = require('./gas_mock');
const app = path.join(__dirname, '..', 'app'), G = make('owner@example.com');
let n = 0; const t = (name, f) => { f(); n++; console.log('  ✓ ' + name); };
const sheets = {}; const IO = { r: 0, w: 0, cells: 0 }; let writes = 0;
function sheet(name) { const s = { data: [], getName: () => name, getLastRow: () => s.data.length, getLastColumn: () => s.data.reduce((m, r) => Math.max(m, r.length), 0), setFrozenRows() {}, appendRow(r) { s.data.push(r.slice()); },
  getMaxRows: () => 1000, clearContents() { s.data = []; return s; }, deleteRows() {}, getSheetId: () => 1, getMaxColumns: () => 26, getDataRange() { return s.getRange(1, 1, Math.max(1, s.data.length), Math.max(1, s.getLastColumn())); },
  getRange(r, c, nr = 1, nc = 1) { return { setValues(v) { writes++; IO.w++; v.forEach((row, i) => { s.data[r - 1 + i] = s.data[r - 1 + i] || []; row.forEach((x, j) => { s.data[r - 1 + i][c - 1 + j] = x; }); }); return this; },
    getValues() { IO.r++; IO.cells += nr * nc; const o = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(((s.data[r - 1 + i] || [])[c - 1 + j]) ?? ''); o.push(row); } return o; },
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

const day = () => C._ts2Today_();
const as = (name, role) => { session = { user_id: name, name, fullName: name, role }; };
const M = {};
const meter = (name, f) => { IO.r = IO.w = IO.cells = 0; const t0 = Date.now(); const r = f(); M[name] = { reads: IO.r, writes: IO.w, cells: IO.cells, ms: Date.now() - t0 }; return r; };
const TECH = i => 'Нарезать. ' + (i % 3 ? 'Жарить 6 мин при 180 °C.' : 'Варить 20 мин при 100 °C. Охладить до +4 °C за 2 ч. Хранить при +2…+4 °C. Срок реализации 24 ч.') + ' Подают горячим.';

t('Нагрузка: 300 ТТК, год графика, 5000 задач, 2000 нарушений — число обращений к таблице не растёт с объёмом данных', () => {
  const D = [], S = []; for (let i = 0; i < 300; i++) { D.push(dish('L' + i, 'Блюдо ' + i, TECH(i), i % 3 ? '' : 24)); if (i % 10 === 1) S.push(['L' + i, 'Блюдо ' + (i - 1) + ' п/ф', 'кг', 0.1, 0, 0.1]); }
  reset(D, S); C._ts2SetProf_('mode', 'READY_TO_WORK'); C._v30Init_(); C._devSheet_(); C._corrSheet_(); as('Анна ХАССП', 'Ответственный за ХАССП');
  table('Лаборатория_План', ['PlanID', 'ObjectName', 'Indicator', 'Method', 'FrequencyDays', 'ResponsibleRole', 'Normative', 'Active'], [['L1', 'Смывы', 'БГКП', 'ГОСТ', 1, 'Ответственный за ХАССП', '', true]]);
  meter('Анализ 300 ТТК (первый)', () => C._ttkpAnalyze_(null));
  meter('Анализ 300 ТТК (повтор)', () => C._ttkpAnalyze_(null));
  meter('Связь ТТК → ХАССП', () => C._hzlSync_());
  C._v30Rows_('HACCP_Опасности_V30').forEach(h => C.haccpHazardDecide('tok', h[0], 'да', 'ОППУ', 'журнал'));
  const ppkId = J(C.v65CreatePpk(JSON.stringify({ name: 'ППК', dateFrom: day() }), 'tok')).ppkId;
  meter('Формирование ППК', () => J(C.v65Generate(ppkId, 'tok')));
  const p = C._v65Get_(ppkId); C._v65SetCell_('PPK', p._row, 'Status', 'APPROVED'); J(C.v65Activate(ppkId, 'tok'));
  // год графика (ежедневное лабораторное исследование): строки на 365 дней назад
  const sch = sheets['ППК_График'], cp = C._v65Objs_('ACT').find(a => a.PPKID === ppkId && /БГКП/.test(a.Parameter)).ControlPlanID;
  for (let d = 1; d <= 365; d++) sch.data.push(['SCH-Y' + d, ppkId, cp, 'день', new Date(Date.now() - d * 864e5), '', d % 20 ? 'DONE' : 'MISSED', 'AR-' + d, '', new Date(), 'x']);
  // 5000 задач смены и 2000 нарушений
  const ex = []; for (let i = 0; i < 5000; i++) ex.push({ expectationId: 'EXP-L' + i, enterpriseId: 'ENT-A', dueAt: C._ts2Iso_(new Date(Date.now() - (i % 30) * 864e5 - 3600e3)), status: i % 50 ? 'DONE' : 'MISSED', factId: 'AR-' + i, title: 't', idempotencyKey: 'k' + i });
  C._ts2InsertMany_('JOURNAL_EXPECTATIONS', ex);
  for (let i = 0; i < 2000; i++) sheets['Журналы_Отклонения'].data.push(['DV-L' + i, '', 'J01', 'Объект ' + i, 'нарушение', '', false, i % 100 === 0 ? 'ожидает проверки' : i % 100 === 50 ? 'открыто' : 'устранено', '', '', 'x', new Date(Date.now() - (i % 60) * 864e5), '', '']);
  meter('Проверка полноты ППК', () => C._v65Check_(ppkId));
  meter('Задачи дня (экран «Сейчас»)', () => C._ts2NowTasks_());
  meter('Аудит 360°: пункты R21–R28', () => C._a360Items_());
  meter('Контрольный лист R01–R28 целиком', () => C._mcReadinessCompute_());
  meter('Список нарушений', () => J(C.vioList('tok')));
  as('Повар Иванова', 'Повар'); meter('Устранение одного нарушения', () => J(C.vioCorrect('tok', 'DV-L150', 'сделано', '')));
  meter('Карточка записи-доказательства', () => J(C.a360Evidence('tok', 'DV-L100')));
  console.log('\n  Операция | чтений диапазонов | записей | ячеек прочитано | мс (модель)');
  Object.keys(M).forEach(k => console.log('  ' + k + ' | ' + M[k].reads + ' | ' + M[k].writes + ' | ' + M[k].cells + ' | ' + M[k].ms));
  // пороги: число обращений — не от числа строк (пакетное чтение), иначе в Apps Script — минуты
  assert(M['Анализ 300 ТТК (повтор)'].writes <= 2, 'повтор анализа без записи');
  assert(M['Аудит 360°: пункты R21–R28'].reads < 120, 'аудит 360°: ' + M['Аудит 360°: пункты R21–R28'].reads + ' чтений');
  assert(M['Контрольный лист R01–R28 целиком'].reads < 250, 'контрольный лист: ' + M['Контрольный лист R01–R28 целиком'].reads);
  assert(M['Устранение одного нарушения'].reads < 20 && M['Список нарушений'].reads < 20);
  global.__M = M;
});
console.log('load_chain: ' + n + ' сценариев пройдено');
