/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
// Мастер-промт 4.0, этап 1: исправления дефектов V65 (ППК) и V43 (санитарные чек-листы) на настоящем коде.
// Запуск: node tests/ppk_stage1.test.js
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert'), { make } = require('./gas_mock');
const app = path.join(__dirname, '..', 'app'), G = make('owner@example.com');
let n = 0; const t = (name, f) => { f(); n++; console.log('  ✓ ' + name); };
const THROWS = (f, re) => { let e = null; try { f(); } catch (x) { e = x; } assert(e && re.test(e.message), 'ожидалась ошибка ' + re + ', получено: ' + (e ? e.message : 'нет')); };
// таблица
const sheets = {};
function sheet(name) { const s = { data: [], getName: () => name, getLastRow: () => s.data.length, getLastColumn: () => Math.max(0, ...s.data.map(r => r.length)), setFrozenRows() {}, appendRow(r) { s.data.push(r.slice()); },
  getDataRange() { const w = Math.max(1, ...s.data.map(r => r.length)); return s.getRange(1, 1, Math.max(1, s.data.length), w); },
  getRange(r, c, nr = 1, nc = 1) { return { setValues(v) { v.forEach((row, i) => { s.data[r - 1 + i] = s.data[r - 1 + i] || []; row.forEach((x, j) => { s.data[r - 1 + i][c - 1 + j] = x; }); }); return this; },
    getValues() { const o = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(((s.data[r - 1 + i] || [])[c - 1 + j]) ?? ''); o.push(row); } return o; },
    setValue(v) { s.data[r - 1] = s.data[r - 1] || []; s.data[r - 1][c - 1] = v; return this; }, getValue() { return ((s.data[r - 1] || [])[c - 1]) ?? ''; },
    clearContent() { for (let i = 0; i < nr; i++) if (s.data[r - 1 + i]) for (let j = 0; j < nc; j++) s.data[r - 1 + i][c - 1 + j] = ''; return this; }, setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; } }; } }; return s; }
const book = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = sheet(n)) };
const table = (name, head, rows) => { const s = book.getSheetByName(name) || book.insertSheet(name); s.data = [head.slice()].concat(rows.map(r => r.slice())); return s; };
let session = { user_id: 'E1', name: 'Повар Иванова', fullName: 'Повар Иванова', role: 'Повар' };
const audits = [];
Object.assign(G, { _book_: () => book, _mcTz_: () => 'Europe/Moscow', _withLock_: f => f(), _log_: () => {}, mcGateSession_: () => session, MC_RB_TECH_: 'Технический доступ',
  _ok_: (d, id) => JSON.stringify({ success: true, data: d }), _fail_: (c, m) => JSON.stringify({ success: false, error: { code: c, message: m } }), _failFrom_: e => JSON.stringify({ success: false, error: { message: String(e.message || e) } }),
  _requireAuth_: () => session, _beginOp_: () => ({ id: 'OP', session }), _endOp_: () => {}, _audit_: (...a) => audits.push(a),
  _mcOrg_: () => ({ name: 'Кафе', responsibleName: 'Петрова' }), _mcOrgCompleteness_: () => ({ complete: true, missing: [] }), _mcRbEmpState_: () => ({}), _dishWorkshopMap_: () => ({}), JOURNALS: [{ id: 'J07', name: 'Журнал уборки', sheetName: 'J07' }], MC_RB_ROLES_: [],
  _mcSessionFullName_: s => s && s.name || '' });
G.Utilities.formatDate = (d, tz, f) => { const x = new Date(d), p = v => String(v).padStart(2, '0'); return f.replace('yyyy', x.getFullYear()).replace('MM', p(x.getMonth() + 1)).replace('dd', p(x.getDate())).replace('HH', p(x.getHours())).replace('mm', p(x.getMinutes())); };
const ctx = vm.createContext(G);
['MonChef_V64_EconomyFlow.gs', 'MonChef_V64_Finance.gs', 'MonChef_V65_PPK.gs', 'MonChef_V43_SANITATION_CHECKLIST_BRIDGE.gs'].forEach(f => vm.runInContext(fs.readFileSync(path.join(app, f), 'utf8'), ctx, { filename: f }));
const C = ctx, J = s => { const r = JSON.parse(s); if (!r.success) throw new Error(r.error.message); return r.data; };
const day = d => { const x = new Date(Date.now() + d * 864e5); return new Date(x.getFullYear(), x.getMonth(), x.getDate()); };

/* ------------------------------------------------------------------ V65 */
t('V65 _v65Check_: ККТ не требуются, если анализ опасностей обосновывает их отсутствие; без обоснования — замечания по каждой опасности', () => {
  table('HACCP_Процессы_V30', ['ProcessID', 'Code', 'Name', 'Status'], [['P1', 'THERMAL', 'Варка', 'ACTIVE']]);
  const HH = ['HazardID', 'ProcessID', 'Category', 'Hazard', 'Cause', 'PreventiveMeasure', 'Severity', 'Likelihood', 'Risk', 'Significant', 'ExistingControl', 'Evidence', 'Status'];
  table('HACCP_Опасности_V30', HH, [['H1', 'P1', 'B', 'Выживание микрофлоры', '', 'варка до готовности', '', '', '', 'нет', '', '', 'ACTIVE'], ['H2', 'P1', 'P', 'Посторонние примеси', '', 'визуальный контроль', '', '', '', 'да', 'ОППУ: сито и визуальный контроль', 'анализ опасностей от 01.11', 'ACTIVE']]);
  C._v65Sh_('PPK'); C._v65Sh_('ACT'); C._v65Sh_('SEC');
  const ccp = C._v65Check_('PPK-X').checks.find(x => x.code === 'CCP'); assert.strictEqual(ccp.status, 'PASS', JSON.stringify(ccp)); assert(/обосновано/.test(ccp.title));
  table('HACCP_Опасности_V30', HH, [['H1', 'P1', 'B', 'Выживание микрофлоры', '', '', '', '', '', '', '', '', 'ACTIVE'], ['H2', 'P1', 'P', 'Посторонние примеси', '', '', '', '', '', 'да', '', '', 'ACTIVE']]);
  const c2 = C._v65Check_('PPK-X').checks.find(x => x.code === 'CCP');
  assert(c2.status === 'REVIEW' && c2.issues.some(i => /не решено, значима ли/.test(i)) && c2.issues.some(i => /нужна мера управления/.test(i)), JSON.stringify(c2));
  table('HACCP_Опасности_V30', HH, []); table('HACCP_Процессы_V30', ['ProcessID'], []);
  assert(/анализ опасностей не документирован/.test(C._v65Check_('PPK-X').checks.find(x => x.code === 'CCP').issues.join()), 'без анализа — по-прежнему замечание');
});
t('V65 мероприятия: санитарные планы используются (конкретные операции с режимом); контроль растворов — только если есть дезсредства', () => {
  const D = { ccp: [], mon: [], ctl: [], zones: [{ AreaID: 'Z1', AreaName: 'Горячий цех', Frequency: 'ежедневно' }, { AreaID: 'Z2', AreaName: 'Склад', Frequency: 'еженедельно' }],
    sanPlans: [{ AreaID: 'Z1', TaskName: 'Дезинфекция столов', RegimeID: 'RG-1', AssignedTo: 'Повар', Status: 'OPEN' }, { AreaID: 'Z1', TaskName: 'Дезинфекция столов', RegimeID: 'RG-1', Status: 'DONE' }],
    lab: [], wplan: [], wsrc: [], pest: [], eq: [], places: [], dis: [] };
  const acts = C._v65AutoActivities_('PPK-1', D, { DateFrom: '', DateTo: '' });
  assert(acts.some(a => a[3] === 'Z1' && /Дезинфекция столов \(режим RG-1\)/.test(a[5])), 'операция из санитарного плана');
  assert.strictEqual(acts.filter(a => a[3] === 'Z1').length, 1, 'по зоне с планом — без дубля общей «обработки зоны»');
  assert(acts.some(a => a[3] === 'Z2' && a[5] === 'Санитарная обработка зоны'), 'зона без плана — общее мероприятие');
  assert(!acts.some(a => /Концентрация рабочего раствора/.test(a[5])), 'дезсредств нет — контроля растворов нет');
  D.dis = [{ DisinfectantID: 'D1' }]; assert(C._v65AutoActivities_('PPK-1', D, {}).some(a => /Концентрация рабочего раствора/.test(a[5])));
});
t('V65 график: событийные мероприятия — строка-правило без даты, без дублей; отметить её «выполнено» нельзя', () => {
  const PH = C.MC_V65.PPK[1], AH = C.MC_V65.ACT[1];
  table('ППК_V30', PH, [['PPK-1', 'ППК', '1', day(-10), '', 'ACTIVE']]);
  const act = (id, f) => AH.map(h => ({ ControlPlanID: id, PPKID: 'PPK-1', Object: 'Объект ' + id, Parameter: 'п', Frequency: f, ResponsibleRole: 'Шеф-повар', Active: true })[h] ?? '');
  table('ППК_Мероприятия', AH, [act('CP-D', 'ежедневно'), act('CP-E', 'при каждой приёмке'), act('CP-N', '')]);
  table('ППК_График', C.MC_V65.SCH[1], []);
  const r = C._v65BuildSchedule_('PPK-1', day(0), day(6)), sch = C._v65Objs_('SCH');
  assert.strictEqual(sch.filter(s => s.ControlPlanID === 'CP-E').length, 1); assert.strictEqual(sch.find(s => s.ControlPlanID === 'CP-E').Status, 'EVENT_RULE');
  assert.strictEqual(sch.filter(s => s.ControlPlanID === 'CP-D').length, 7); assert(!sch.some(s => s.ControlPlanID === 'CP-N'), 'без периодичности — не придумываем');
  assert.strictEqual(C._v65BuildSchedule_('PPK-1', day(0), day(6)).created, 0, 'повтор — без дублей');
  const ev = sch.find(s => s.ControlPlanID === 'CP-E'); assert(/Событийное мероприятие/.test(JSON.parse(C.v65CompleteScheduleItem(JSON.stringify({ scheduleId: ev.ScheduleID, evidence: 'J-1' }), 't')).error.message));
});
t('V65 ввод новой версии: будущие задачи прежней (архивной) версии отменяются, выполненные остаются; отменённые не видны в графике', () => {
  const sch = C._v65Objs_('SCH'), done = sch.find(s => s.ControlPlanID === 'CP-D'); C._v65SetCell_('SCH', done._row, 'Status', 'DONE');
  const PH = C.MC_V65.PPK[1], s = sheets['ППК_V30']; s.appendRow(PH.map(h => ({ PPKID: 'PPK-2', Name: 'ППК v2', Version: '2', DateFrom: day(1), Status: 'APPROVED' })[h] ?? ''));
  table('ППК_Согласование', C.MC_V65.APR[1], []);
  const r = J(C.v65Activate('PPK-2', 't')); assert.deepStrictEqual(JSON.parse(JSON.stringify(r.archived)), ['PPK-1']);
  const after = C._v65Objs_('SCH').filter(x => x.PPKID === 'PPK-1');
  assert(after.filter(x => x.Status === 'CANCELLED').length >= 6, 'будущие задачи и правило события отменены');
  assert.strictEqual(after.find(x => x.ScheduleID === done.ScheduleID).Status, 'DONE', 'выполненная история сохранена');
  assert(!C._v65ScheduleState_('PPK-1', '', '').some(x => x.status === 'CANCELLED'));
});

/* ------------------------------------------------------------------ V43 */
const H43 = vm.runInContext('V43_HEADERS', ctx), S43 = vm.runInContext('V43_SAN', ctx), LH = H43.LINK;
G.getChecklists = () => JSON.stringify([{ id: 'CL1', active: true, schedule: 'daily_1x', time: '09:00', role: 'Повар', items: [{ id: 'I1', text: 'Дезинфекция столов', dis: 'Хлорамин', conc: '0.5%' }, { id: 'I2', text: 'Мытьё полов', dis: 'Хлорамин' }] }]);
table('Дезсредства_V41', ['DisinfectantID', 'ProductName', 'ApprovalStatus', 'AllowedForCatering'], [['D1', 'Хлорамин', 'APPROVED', 'YES']]);
table('Дезсредства_Режимы_V41', ['RegimeID', 'DisinfectantID', 'ConcentrationRaw', 'ObjectScope', 'ApprovalStatus'], [['RG-1', 'D1', '0.5%', 'столы', 'APPROVED']]);
t('V43 связи: автосопоставление не утверждает (REVIEW); решения людей сохраняются; прежние авто-«APPROVED» возвращаются на проверку', () => {
  C.setupV43SanitationChecklist(); table(S43.LINK, LH, [['L-OLD', 'CL1', 'I2', 'Мытьё полов', 'D1', 'RG-1', 'PRODUCT_NAME', 0.82, 'APPROVED', true, 'Автосопоставление; проверить при утверждении', new Date()]]);
  const r = C.v43BuildChecklistLinks(); const links = C.v43GetLinks();
  assert(r.review === 2 && links.every(l => l.status === 'REVIEW'), JSON.stringify(links));
  assert.strictEqual(C.v43GenerateTasks(new Date().toISOString(), '').created, 0, 'без утверждения задач нет');
  session = { user_id: 'E9', name: 'Ответственный Петрова', fullName: 'Ответственный Петрова', role: 'Ответственный за ХАССП' };
  const l1 = links.find(l => l.itemId === 'I1'); C.v43ReviewLink(l1.linkId, 'APPROVED', 'режим сверен с инструкцией', '');
  assert.strictEqual(C.v43BuildChecklistLinks().kept, 1, 'решение человека сохранено при повторном сопоставлении');
  const l1b = C.v43GetLinks().find(l => l.itemId === 'I1'); assert(l1b.status === 'APPROVED' && /Проверил: Ответственный Петрова/.test(l1b.notes));
  THROWS(() => C.v43ReviewLink(l1.linkId, 'OK', '', ''), /APPROVED или REJECTED/);
});
let task;
t('V43 исполнение: концентрация — числом (галочка не заменяет); вне режима — отклонение; исполнитель из сессии; повтор — идемпотентно', () => {
  table(S43.TASK, H43.TASK, []); const d = new Date(); d.setHours(0, 0, 0, 0);
  C.v43GenerateTasks(d.toISOString(), ''); const tasks = C._v43Rows_(S43.TASK); assert(tasks.length >= 1 && tasks.every(x => x.ItemID === 'I1'), 'задачи только по утверждённой связи');
  task = tasks[0]; session = { user_id: 'E1', name: 'Повар Иванова', fullName: 'Повар Иванова', role: 'Повар' };
  THROWS(() => C.v43CompleteChecklistItem({ taskId: task.TaskID, status: 'DONE', employeeId: 'ПОДДЕЛКА' }, ''), /введите измеренное значение/);
  const r = C.v43CompleteChecklistItem({ taskId: task.TaskID, status: 'DONE', measuredConcentration: '0,3', employeeId: 'ПОДДЕЛКА' }, '');
  assert(r.executed && r.result === 'DEVIATION' && r.deviationId, 'вне режима 0.5% — отклонение: ' + JSON.stringify(r));
  const tr = C._v43Rows_(S43.TASK).find(x => x.TaskID === task.TaskID); assert(tr.Status === 'DONE' && tr.CompletedBy === 'Повар Иванова', 'задача выполнена (исполнение), исполнитель из сессии');
  const ex = C._v43Rows_(S43.EXEC).pop(); assert(ex.Result === 'DEVIATION' && ex.EmployeeID === 'Повар Иванова' && Number(ex.MeasuredConcentration) === 0.3);
  assert(C.v43CompleteChecklistItem({ taskId: task.TaskID, status: 'DONE', measuredConcentration: '0.5' }, '').idempotent);
});
t('V43 нарушение: устранение отдельно от исполнения → «ожидает проверки»; подтверждает другой сотрудник; не подтверждено — снова открыто', () => {
  const dev = C.v43GetDeviations()[0]; assert(dev && dev.status === 'OPEN');
  THROWS(() => C.v43ResolveDeviation(dev.alertId, '', ''), /корректирующее действие/);
  assert.strictEqual(C.v43ResolveDeviation(dev.alertId, 'раствор приготовлен заново, концентрация 0.5%', '').status, 'VERIFY_REQUIRED');
  THROWS(() => C.v43VerifyDeviation(dev.alertId, true, '', ''), /другой сотрудник/);
  session = { user_id: 'E9', name: 'Ответственный Петрова', fullName: 'Ответственный Петрова', role: 'Ответственный за ХАССП' };
  assert.strictEqual(C.v43VerifyDeviation(dev.alertId, false, 'тест-полоска 0.3%', '').status, 'REOPENED');
  session = { user_id: 'E1', name: 'Повар Иванова', fullName: 'Повар Иванова', role: 'Повар' }; C.v43ResolveDeviation(dev.alertId, 'повторно приготовлен', '');
  session = { user_id: 'E9', name: 'Ответственный Петрова', fullName: 'Ответственный Петрова', role: 'Ответственный за ХАССП' };
  assert.strictEqual(C.v43VerifyDeviation(dev.alertId, true, 'тест-полоска 0.5%', '').status, 'CLOSED'); assert(!C.v43GetDeviations().some(x => x.alertId === dev.alertId));
});
t('V43 просрочка: одно уведомление на задачу при повторных запусках по расписанию', () => {
  const sh = sheets[S43.TASK]; const h = H43.TASK;
  sh.appendRow(h.map(k => ({ TaskID: 'T-OVD', ChecklistID: 'CL1', ItemID: 'I1', DueAt: vm.runInContext('new Date(Date.now() - 3 * 3600e3)', ctx), Status: 'OPEN' })[k] ?? ''));
  assert.strictEqual(C.v43BuildOverdueAlerts().created, 1); assert.strictEqual(C.v43BuildOverdueAlerts().created, 0); assert.strictEqual(C.v43BuildOverdueAlerts().created, 0);
  assert.strictEqual(C._v43Rows_(S43.ALERT).filter(a => a.AlertType === 'SANITATION_OVERDUE' && a.TaskID === 'T-OVD').length, 1);
});
console.log('ППК и санитарные чек-листы, этап 1: ' + n + ' сценариев пройдено');
