/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
// Мастер-промт 4.0, этап 5: чек-листы из действующей ППК V65 → задачи экрана «Сейчас» (JOURNAL_EXPECTATIONS) → итог в графике ППК. Настоящий код, имитация таблиц.
// Запуск: node tests/checklist_gen.test.js
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
['TS2_Schema.gs', 'TS2_Core.gs', 'TS2_Reconcile.gs', 'TS2_Generate.gs', 'TS_TtkProcess.gs', 'MonChef_V30_ComplianceHaccpCore.gs', 'MonChef_V64_EconomyFlow.gs', 'MonChef_V64_Finance.gs', 'MonChef_V65_PPK.gs', 'TS_HaccpLink.gs', 'TS2_Ready.gs', 'TS_Sensors.gs', 'TS_ChecklistGen.gs'].forEach(f => {
  const file = fs.readdirSync(app).find(x => x === f) || fs.readdirSync(app).find(x => x.startsWith(f.replace(/_[A-Z_]+\.gs$/, '')) && x.endsWith('.gs'));
  vm.runInContext(fs.readFileSync(path.join(app, file), 'utf8'), ctx, { filename: file });
});
const C = ctx; vm.runInContext("var MC_WASTE_MAX_DAYS_ = { 'пищевые': 1, 'ТКО': 3 };", ctx); C._ts2Ent_ = () => 'ENT-A'; C._ts2Audit_ = (...a) => audits.push(a); C._ts2EnsureSchema_ = () => {}; C._TS2_SH_ = {};
vm.runInContext('_TS2_SH_ = {};', ctx);
const J = s => { const r = JSON.parse(s); if (!r.success) throw new Error(r.error.message); return r.data; };
const HB = ['Код', 'Название', 'Категория', 'Выход', 'Ед', 'Технология', 'Фото', 'Цена', 'Цех', 'Срок, ч'];
const dish = (code, name, tech, shelf) => [code, name, 'Горячее', 250, 'г', tech, '', '', 'Горячий', shelf || ''];
const HS = ['Код', 'Продукт', 'Ед', 'Брутто', 'База', 'Нетто'];
const reset = (dishes, comp) => { Object.keys(sheets).forEach(k => delete sheets[k]); vm.runInContext('_TS2_SH_ = {};', ctx); table('Блюда', HB, dishes); table('Состав', HS, comp); table('ID_COUNTERS', ['counterCode', 'prefix', 'year', 'lastNumber', 'updatedAt', 'updatedBy'], []); };
const live = () => C._ts2Rows_('TTK_PROCESS_MAP').filter(r => r.reviewStatus !== 'SUPERSEDED');
const issues = code => C._ts2Rows_('TTK_PROCESS_ISSUES').filter(i => i.status === 'OPEN' && (!code || i.ttkId === code)).map(i => i.code);

const day = () => C._ts2Today_();
const exp = () => C._ts2Rows_('JOURNAL_EXPECTATIONS');
const sch = () => C._v65Objs_('SCH');
const tpl = () => C._ts2Rows_('CHECKLIST_TEMPLATES');
// действующая ППК с мероприятиями разных видов — через настоящий V65 (создать → сформировать → ввести)
function activePpk(extra) {
  reset([dish('A1', 'Говядина жареная', 'Жарить 6 мин при 180 °C. Подают горячим.')], []);
  C._v30Init_(); C._ts2SetProf_('mode', 'READY_TO_WORK');
  table('Лаборатория_План', ['PlanID', 'ObjectName', 'Indicator', 'Method', 'FrequencyDays', 'ResponsibleRole', 'Normative', 'Active'], [['L1', 'Смывы с рук', 'БГКП', 'ГОСТ 31747', 1, 'Ответственный за ХАССП', 'не допускается', true]]);
  const id = J(C.v65CreatePpk(JSON.stringify({ name: 'ППК', dateFrom: day() }), 'tok')).ppkId;
  J(C.v65Generate(id, 'tok'));
  (extra || []).forEach(r => sheets['ППК_Мероприятия'].data.push(r));
  const p = C._v65Get_(id); C._v65SetCell_('PPK', p._row, 'Status', 'APPROVED');
  J(C.v65Activate(id, 'tok'));
  return id;
}
const actRow = (id, ppk, obj, par, freq, ev, journal) => C.MC_V65.ACT[1].map(h => ({ ControlPlanID: id, PPKID: ppk, Object: obj, Parameter: par, Frequency: freq, Method: 'осмотр', ResponsibleRole: 'Ответственный за ХАССП', JournalID: journal || '', EvidenceType: ev || 'DOCUMENT', CorrectiveAction: 'повторная обработка', Active: true })[h] ?? '');

t('Ввод ППК → шаблоны чек-листов: способ исполнения каждого мероприятия; дубли существующих контуров не создаются', () => {
  const id = activePpk();
  const T = tpl().filter(x => x.status === 'ACTIVE'); assert(T.length > 5, 'шаблоны построены при вводе ППК: ' + T.length);
  const by = m => T.filter(x => x.executionMode === m).map(x => x.title);
  assert(by('TASK').some(x => /Верификация выполнения ППК/.test(x)), 'верификация ППК — задача');
  assert(by('TASK').some(x => /Лабораторное исследование: БГКП/.test(x)), 'лабораторное исследование — задача');
  assert(by('COVERED').some(x => /допуск к работе/.test(x)), 'допуск смены уже исполняется — не дублируется');
  assert(by('EVENT').some(x => /Входной контроль/.test(x)) && by('EVENT').some(x => /Бракераж/.test(x)), 'приёмка и бракераж — по событию');
  assert(by('DATE').some(x => /Медицинские осмотры/.test(x)), 'медосмотры — контроль сроков');
  const v = T.find(x => /Верификация выполнения ППК/.test(x.title)); const items = JSON.parse(v.items);
  assert(items[0].startsWith('Выполнено: Верификация') && items.some(i => /Способ: /.test(i)), 'пункты чек-листа: ' + v.items);
  assert(T.every(x => x.ppkId === id));
});
t('Задачи дня: по графику ППК → экран «Сейчас» с чек-листом; общий «Лабораторный план» заменён исследованиями ППК; повтор без дублей', () => {
  activePpk();
  const n = C._ts2GenerateDay_(day()); assert(n > 0);
  const ppkTasks = exp().filter(e => /^PPK-/.test(e.eventRuleId));
  assert(ppkTasks.some(e => /БГКП/.test(e.title)), 'ежедневное лабораторное исследование — задача сегодня');
  assert(ppkTasks.every(e => e.objectType === 'PPK_SCHEDULE' && sch().some(s => s.ScheduleID === e.objectId)), 'задача связана с пунктом графика ППК');
  assert(!exp().some(e => e.eventRuleId === 'SCHED-LAB_PLAN'), 'общая задача «Лабораторный план» не дублирует ППК');
  const before = exp().length; C._ts2GenerateDay_(day()); assert.strictEqual(exp().length, before, 'повтор без дублей');
  const now = C._ts2NowTasks_().find(x => /БГКП/.test(x.title));
  assert(now && now.checklist && now.checklist.some(i => /Протокол лаборатории/.test(i)) && /повторн|блокировка/.test(now.onFail || ''), 'чек-лист и действие при несоответствии на экране');
});
t('«Да» / «Нет» на экране «Сейчас» → пункт графика ППК DONE / DEVIATION со ссылкой на факт; ручная отметка такого пункта в графике запрещена', () => {
  const id = activePpk(); C._ts2GenerateDay_(day());
  const [a, b] = exp().filter(e => /^PPK-/.test(e.eventRuleId));
  C._ts2Confirm_(a.expectationId, true, '', '');
  const sa = sch().find(s => s.ScheduleID === a.objectId); assert.strictEqual(sa.Status, 'DONE'); assert(/^AR|^ARC|-/.test(String(sa.FactID)) && sa.FactID, 'факт: ' + sa.FactID);
  if (b) { C._ts2Confirm_(b.expectationId, false, 'Не выполнен пункт 2', ''); assert.strictEqual(sch().find(s => s.ScheduleID === b.objectId).Status, 'DEVIATION'); }
  const other = sch().find(s => s.PPKID === id && s.Status === 'PLANNED' && C._clgTaskFor_(id, s.ControlPlanID));
  const r = JSON.parse(C.v65CompleteScheduleItem(JSON.stringify({ scheduleId: other.ScheduleID, evidence: 'журнал' }), 'tok'));
  assert(!r.success && /экране «Сейчас»/.test(r.error.message), JSON.stringify(r));
});
t('Пропущенная задача ППК → пункт графика MISSED; мероприятие без периодичности — пробел, задача не придумывается', () => {
  const id = activePpk([]);
  sheets['ППК_Мероприятия'].data.push(actRow('CP-M-1', id, 'Вентиляция', 'Чистка фильтров', '', 'DOCUMENT'));
  C._clgBuild_();
  assert(tpl().some(x => x.controlPlanId === 'CP-M-1' && x.executionMode === 'NO_SCHEDULE'));
  const old = new Date(Date.now() - 4 * 864e5), oday = C.Utilities.formatDate(old, 'x', 'yyyy-MM-dd');
  const s0 = sch().find(s => s.PPKID === id && s.Status === 'PLANNED' && C._clgTaskFor_(id, s.ControlPlanID));
  C._v65SetCell_('SCH', s0._row, 'DueDate', old);
  C._ts2GenerateDay_(oday);
  const e = exp().find(x => x.objectId === s0.ScheduleID); assert(e, 'задача на прошедший день');
  C.PropertiesService.getScriptProperties().deleteProperty && C.PropertiesService.getScriptProperties().deleteProperty('TS2_MISSED_DAY');
  C._ts2ExpireMissed_(day());
  assert.strictEqual(exp().find(x => x.objectId === s0.ScheduleID).status, 'MISSED'); assert.strictEqual(sch().find(s => s.ScheduleID === s0.ScheduleID).Status, 'MISSED');
});
t('Новая версия ППК: шаблоны прежней — SUPERSEDED; без действующей ППК задач ППК нет; график продлевается сам', () => {
  const id = activePpk();
  const last = () => sch().filter(s => s.PPKID === id && s.DueDate).map(s => C._v64Day_(C._v64Date_(s.DueDate))).sort().pop();
  sch().filter(s => s.PPKID === id && C._v64Date_(s.DueDate) && C._v64Day_(C._v64Date_(s.DueDate)) > C.Utilities.formatDate(new Date(Date.now() + 3 * 864e5), 'x', 'yyyy-MM-dd')).forEach(s => C._v65SetCell_('SCH', s._row, 'Status', 'CANCELLED'));
  sheets['ППК_График'].data = sheets['ППК_График'].data.filter((r, i) => i === 0 || r[6] !== 'CANCELLED');
  const before = last(); C._ts2GenerateDay_(day()); assert(last() > before, 'график продлён: ' + before + ' → ' + last());
  const p = C._v65Get_(id); C._v65SetCell_('PPK', p._row, 'Status', 'ARCHIVED'); const r = C._clgBuild_();
  assert(r.superseded > 0 && !tpl().some(x => x.status === 'ACTIVE'), 'шаблоны архивной ППК сняты');
  assert.strictEqual(C._clgDay_(day(), {}).length, 0, 'без действующей ППК задач ППК нет');
  assert(C._ts2GenerateDay_(day()) >= 0 && !Object.keys(C._clgSupersededSchedules_()).length, 'общий «Лабораторный план» возвращается');
});
console.log('checklist_gen: ' + n + ' сценариев пройдено');
