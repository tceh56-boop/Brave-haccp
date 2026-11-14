/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
// «ЦЕХ Финансы и Экономика», этап 4 — управленческий Labor Cost (MonChef_V74_Labor.gs): ставка × часы + премии.
//   смены читаются напрямую, табель — только без смены и исправления; история ставок; премии с подтверждением;
//   без дублей и без записей в закрытом периоде; Labor Cost в P&L и сводке руководителя. Настоящий код .gs, имитация таблиц.
// Запуск: node tests/finance_stage4.test.js
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert'), { make } = require('./gas_mock');
const app = path.join(__dirname, '..', 'app'), G = make('owner@example.com');
const eq = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
let n = 0; const t = (name, f) => { f(); n++; console.log('  ✓ ' + name); };

const sheets = {};
function sheet(name) {
  const s = { data: [], getName: () => name, getLastRow: () => s.data.length, getLastColumn: () => s.data.reduce((m, r) => Math.max(m, r.length), 0), setFrozenRows() {},
    appendRow(r) { s.data.push(r.slice()); }, clearContents() { s.data = []; return s; },
    getDataRange() { return s.getRange(1, 1, Math.max(1, s.data.length), Math.max(1, s.getLastColumn())); },
    getRange(r, c, nr = 1, nc = 1) { return {
      setValues(v) { v.forEach((row, i) => { s.data[r - 1 + i] = s.data[r - 1 + i] || []; row.forEach((x, j) => { s.data[r - 1 + i][c - 1 + j] = x; }); }); return this; },
      getValues() { const o = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(((s.data[r - 1 + i] || [])[c - 1 + j]) ?? ''); o.push(row); } return o; },
      setValue(v) { s.data[r - 1] = s.data[r - 1] || []; s.data[r - 1][c - 1] = v; return this; }, getValue() { return ((s.data[r - 1] || [])[c - 1]) ?? ''; },
      setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; } }; } };
  return s;
}
const book = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = sheet(n)) };
const table = (name, head, rows) => { const s = book.getSheetByName(name) || book.insertSheet(name); s.data = [head.slice()].concat(rows.map(r => r.slice())); return s; };
let session = { user_id: 'E1', name: 'Директор Иванова', fullName: 'Директор Иванова', role: 'Директор' };
const avg = { 'говядина': 500, 'молоко': 80 };   // средняя цена остатка за кг / л
Object.assign(G, { _book_: () => book, _mcTz_: () => 'Europe/Moscow', _withLock_: f => f(), _log_: () => {},
  _ok_: (d, id) => JSON.stringify({ success: true, data: d, operation_id: id }), _fail_: (c, m) => JSON.stringify({ success: false, error: { code: c, message: m } }),
  _failFrom_: e => JSON.stringify({ success: false, error: { message: String(e.message || e) } }), _requireAuth_: () => session, _beginOp_: () => ({ id: 'OP1', session }), _endOp_: () => {}, _audit_: () => {},
  _currentAvgPrice_: (name, unit) => { const p = avg[String(name).toLowerCase()] || 0; return /^(г|мл)$/.test(unit) ? p / 1000 : p; },
  _defaultTenant_: () => ({ organization_id: 'ORG-1', location_id: 'LOC-1' }), _createOperation_: () => ({ id: 'OPS' }),
  _bkHex_: b => b.map(x => ((x < 0 ? x + 256 : x).toString(16)).padStart(2, '0')).join(''), _mcTimeStr_: x => String(x), MC_RB_TECH_: 'тех', JOURNALS: [] });
G.Utilities.formatDate = (d, tz, f) => { const x = new Date(d), p = v => String(v).padStart(2, '0'); return f.replace('yyyy', x.getFullYear()).replace('MM', p(x.getMonth() + 1)).replace('dd', p(x.getDate())).replace('HH', p(x.getHours())).replace('mm', p(x.getMinutes())).replace('ss', p(x.getSeconds())); };
const ctx = vm.createContext(G);
const code = fs.readFileSync(path.join(app, 'Code.gs'), 'utf8'), legacy = fs.readFileSync(path.join(app, 'MonChef_LegacyBack.gs'), 'utf8');
const fn = (src, name) => { const i = src.indexOf('function ' + name + '('); assert(i >= 0, name); let d = 0, j = src.indexOf('{', i); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(i, j + 1); };
vm.runInContext(['_toBaseUnitServer_', '_parseDate_', '_parseDateStr_', 'getSalesStats', '_mcFinClosedForJournalRow_'].map(x => fn(code, x)).join('\n'), ctx);
vm.runInContext(fn(legacy, '_mcSaleDuplicate_'), ctx);
['MonChef_V64_EconomyFlow.gs', 'MonChef_V64_Finance.gs', 'MonChef_V72_FinRegistry.gs', 'MonChef_V73_PnL.gs', 'MonChef_V74_Labor.gs'].forEach(f => vm.runInContext(fs.readFileSync(path.join(app, f), 'utf8'), ctx, { filename: f }));
const C = ctx, J = s => { const r = JSON.parse(s); if (!r.success) throw new Error(r.error.message); return r.data; };

// ---------- модель предприятия ----------
const HB = ['BatchID', 'Продукт', 'Ед', 'Кол-во', 'Принято', 'Годен до', 'Цена', 'Источник', 'Использовано', 'Остаток', 'Статус', 'x', 'y', 'Документ', 'a', 'b', 'c', 'ProductID', 'SupplierID'];
const batch = (id, product, unit, qty, price, received, source) => [id, product, unit, qty, received, '2026-12-31', price, source || 'Приёмка', 0, qty, 'active', '', '', 'Н-1', '', '', '', '', ''];
const HP = ['BatchID', 'Поставщик', 'Накладная', 'DocumentID накладной', 'Дата накладной', 'Стоимость', 'Цена за ед.', 'Ед.', 'Кол-во', 'Принял', 'OperationID', 'ParentBatchID', 'ВСД'];
const HJ = ['№', 'Дата', 'Время', 'Блюдо', 'Количество', 'Цена', 'Сумма', 'ФИО продавца', 'Должность', 'Подпись', 'Запись внёс', 'Должность внёсшего', 'Внесено', 'Источник записи', 'ID сотрудника'];
const HTL = ['LinkID', 'FromType', 'FromID', 'Relation', 'ToType', 'ToID', 'FactID', 'DateTime', 'Actor', 'Source', 'Weight', 'Unit', 'Status', 'Hash'];
const HCORR = ['CorrectionID', 'JournalID', 'JournalName', 'PeriodFrom', 'PeriodTo', 'RowNumber', 'OriginalData', 'CorrectedData', 'Reason', 'CreatedByUserID', 'CreatedByName', 'CreatedByRole', 'CreatedAt', 'Status', 'DecidedBy', 'DecidedByRole', 'DecidedAt', 'DecisionComment'];
function reset() {
  Object.keys(sheets).forEach(k => delete sheets[k]); C._v64Drop_();
  table('Склад_Партии', HB, [batch('B1', 'Говядина', 'кг', 10, 400, '2026-11-01'), batch('B2', 'Говядина', 'кг', 10, 600, '2026-11-02'), batch('M1', 'Молоко', 'л', 20, 70, '2026-11-01'),
    batch('F1', 'Молоко', 'л', 2, 0, '2026-11-05', 'REVISION_FOUND')]);
  table('Приёмка_Партии', HP, [['B1', 'ООО Мясо', '11', '', '2026-11-01', 4000, 400, 'кг', 10, 'Петров', 'OP-B1', '', ''], ['B2', 'ООО Мясо', '12', '', '2026-11-02', 6000, 600, 'кг', 10, 'Петров', 'OP-B2', '', ''],
    ['M1', 'Молзавод', '7', '', '2026-11-01', 1400, 70, 'л', 20, 'Петров', 'OP-M1', '', '']]);
  table('TRACE_LINKS', HTL, []);
}
const saleRow = (no, date, time, dish, qty, price, sum, entered, src) => [no, date, time, dish, qty, price, sum, 'Кассир Орлова', 'Администратор', '', 'Кассир Орлова', 'Администратор', entered, src || 'вручную', 'E2'];
const lines = (from, to) => C._v64Build_(C._v64Range_(from || '2026-11-01', to || '2026-11-30')).lines;


const sync = o => C._v72SyncCore_(o || {}, null);
const reg = () => C._v72Read_('REG').rows, hist = () => C._v72Read_('HIST').rows, days = () => C._v72Read_('DAY').rows;
const dayRow = d => days().find(r => C._v72DayStr_(r.Day) === d);
const sales = () => table('Ж_Продажи', HJ, [
  saleRow(1, '10.10.2026', '12:00', 'Борщ', 2, 300, 600, '10.10.2026 12:01:00', 'вручную · SL-20261010-AAAAAAAA'),
  saleRow(2, '10.11.2026', '12:00', 'Борщ', 2, 300, 600, '10.11.2026 12:01:00', 'вручную · SL-20261110-AAAAAAAA'),
  saleRow(3, '11.11.2026', '13:00', 'Плов', 1, 450, 450, '11.11.2026 13:01:00', 'вручную · SL-20261111-BBBBBBBB')]);
function base() {
  reset(); sales();
  table('Продажи_Списание_V71', ['SaleID', 'Ед.', 'Не хватило (JSON)'], [['SL-20261110-AAAAAAAA', 'порц.', '[]']]);
  table('TRACE_LINKS', HTL, [['T1', 'BATCH', 'B1', 'РЕАЛИЗОВАНА_В', 'SALE', 'SL-20261110-AAAAAAAA', '', '', '', '', 0.3, 'кг', 'ACTIVE', '']]);
  G.PropertiesService.getScriptProperties().deleteProperty && G.PropertiesService.getScriptProperties().deleteProperty('MC_V72_LAST');
}


const HS = ['ShiftID', 'Date', 'Employee', 'Role', 'StartedAt', 'EndedAt', 'Status', 'CreatedAt', 'UpdatedAt', 'Notes'];
const shift = (id, day, emp, role, h1, h2, st) => [id, day, emp, role, new Date(2026, 10, +day.slice(8), h1), h2 === null ? '' : new Date(2026, 10, +day.slice(8), h2), st || 'CLOSED', '', '', ''];
const R = (fn, o) => JSON.parse(C[fn](JSON.stringify(o), 'tok'));
const ok = r => { assert(r.success, JSON.stringify(r)); return r.data; };
const as = name => { session = { user_id: name, name, fullName: name, role: 'Директор' }; };
const labor = (f, t) => lines(f || '2026-11-01', t || '2026-11-30').filter(l => l.stage === 'LABOR');
function staff() {
  base(); as('Директор Иванова');
  table('MonChef_Смены', HS, [shift('SH1', '2026-11-10', 'Повар Петров', 'Повар', 9, 17), shift('SH2', '2026-11-11', 'Повар Петров', 'Повар', 9, 21),
    shift('SH3', '2026-11-10', 'Мойщица Сидорова', 'Мойщица', 8, 16), shift('SH4', '2026-11-10', 'Бармен Козлов', 'Бармен', 18, 23),
    shift('SH5', '2026-11-12', 'Повар Петров', 'Повар', 9, null, 'OPEN')]);
  ok(R('v74SaveRate', { employee: 'Повар Петров', ratePerHour: 300, dateFrom: '2026-11-01' }));
  ok(R('v74SaveRate', { role: 'Мойщица', ratePerHour: 200, dateFrom: '2026-11-01' }));
}

console.log('finance_stage4:');

t('Смена × ставка: своя ставка, ставка роли, нет ставки — 0 с признаком; открытая смена не считается', () => {
  staff();
  const L = labor(), by = id => L.find(l => l.objId === id);
  assert.strictEqual(by('SH1').qty, 8); assert.strictEqual(by('SH1').amount, 2400);
  assert.strictEqual(by('SH2').amount, 3600);
  assert.strictEqual(by('SH3').amount, 1600, 'ставка роли «Мойщица»');
  assert.strictEqual(by('SH4').amount, 0); eq(by('SH4').flags, ['NO_RATE']);
  assert(!by('SH5'), 'открытая смена без часов');
  const T = C._v64Totals_(lines('2026-11-01', '2026-11-30'));
  assert.strictEqual(T.labor, 7600); assert.strictEqual(T.laborHours, 33); assert.strictEqual(T.laborNoRate, 1);
});

t('История ставок: новая ставка закрывает прежнюю, прошлые смены — по прежней; та же дата — отказ; закрытый период — отказ', () => {
  staff();
  const r = ok(R('v74SaveRate', { employee: 'Повар Петров', ratePerHour: 350, dateFrom: '2026-11-11' }));
  assert.strictEqual(r.closedPrevious.length, 1);
  const L = labor(); assert.strictEqual(L.find(l => l.objId === 'SH1').amount, 2400); assert.strictEqual(L.find(l => l.objId === 'SH2').amount, 4200);
  assert.strictEqual(R('v74SaveRate', { employee: 'Повар Петров', ratePerHour: 400, dateFrom: '2026-11-11' }).error.code, 'DUPLICATE');
  table('Финансы_ЗакрытиеПериода', C.MC_V64F.CLOSE[1], [['PER-1', new Date(2026, 9, 1), new Date(2026, 9, 31), 'CLOSED']]); C._v64Drop_();
  assert.strictEqual(R('v74SaveRate', { role: 'Повар', ratePerHour: 250, dateFrom: '2026-10-15' }).error.code, 'CLOSED_PERIOD');
});

t('Табель без дублей: нельзя внести часы поверх смены; вторая запись за день — только с подтверждением; не в будущее, не в закрытый период', () => {
  staff();
  assert.strictEqual(R('v74AddHours', { date: '2026-11-10', employee: 'повар  петров', hours: 8 }).error.code, 'DUPLICATE');
  const e = ok(R('v74AddHours', { date: '2026-11-10', employee: 'Кассир Орлова', role: 'Мойщица', hours: 6 }));
  assert.strictEqual(R('v74AddHours', { date: '2026-11-10', employee: 'Кассир Орлова', hours: 4 }).error.code, 'DUPLICATE');
  ok(R('v74AddHours', { date: '2026-11-10', employee: 'Кассир Орлова', role: 'Мойщица', hours: 4, allowSecond: true }));
  assert.strictEqual(R('v74AddHours', { date: '2030-01-01', employee: 'Кассир Орлова', hours: 4 }).success, false);
  assert.strictEqual(R('v74AddHours', { date: '2026-11-10', employee: 'Кассир Орлова', hours: 30 }).success, false);
  table('Финансы_ЗакрытиеПериода', C.MC_V64F.CLOSE[1], [['PER-1', new Date(2026, 9, 1), new Date(2026, 9, 31), 'CLOSED']]); C._v64Drop_();
  assert.strictEqual(R('v74AddHours', { date: '2026-10-20', employee: 'Кассир Орлова', hours: 4 }).error.code, 'CLOSED_PERIOD');
  const L = labor().filter(l => l.objType === 'TIMESHEET'); assert.strictEqual(L.length, 2); assert.strictEqual(L.find(l => l.objId === e.entryId).amount, 1200);
});

t('Исправление часов: смена заменяется записью-исправлением, повторное исправление отменяет прежнее; история сохраняется', () => {
  staff();
  ok(R('v74CorrectHours', { shiftId: 'SH2', hours: 10, reason: 'забыл закрыть смену' }));
  let L = labor(); assert(!L.find(l => l.objId === 'SH2'));
  let fix = L.filter(l => l.objType === 'TIMESHEET'); assert.strictEqual(fix.length, 1); assert.strictEqual(fix[0].amount, 3000); assert.strictEqual(fix[0].ref, 'SH2');
  ok(R('v74CorrectHours', { shiftId: 'SH2', hours: 11, reason: 'уточнили' }));
  L = labor(); fix = L.filter(l => l.objType === 'TIMESHEET'); assert.strictEqual(fix.length, 1); assert.strictEqual(fix[0].qty, 11);
  const ts = sheets['ФОТ_Табель'].data.slice(1), st = C.MC_V74.TS[1].indexOf('Status'), rp = C.MC_V74.TS[1].indexOf('ReplacesID');
  eq(ts.map(r => r[st]), ['CANCELLED', 'ACTIVE']); assert.strictEqual(ts[1][rp], ts[0][0]);
  ok(R('v74CorrectHours', { shiftId: 'SH5', hours: 7, reason: 'смена не закрыта' }));
  assert.strictEqual(labor().find(l => l.ref === 'SH5').amount, 2100, 'незакрытая смена учтена после исправления');
  assert.strictEqual(R('v74CorrectHours', { shiftId: 'SH1', hours: 7 }).success, false, 'без причины нельзя');
});

t('Премии и удержания: черновик не входит; автор не подтверждает; подтверждённое — входит, удержание со знаком минус', () => {
  staff();
  const b = ok(R('v74AddBonus', { date: '2026-11-10', employee: 'Повар Петров', type: 'BONUS', amount: 1000, reason: 'банкет' }));
  const p = ok(R('v74AddBonus', { date: '2026-11-11', employee: 'Повар Петров', type: 'PENALTY', amount: 300, reason: 'опоздание' }));
  assert.strictEqual(R('v74AddBonus', { date: '2026-11-10', employee: 'Повар Петров', type: 'BONUS', amount: 1000, reason: 'банкет' }).error.code, 'DUPLICATE');
  assert(!labor().some(l => l.objType === 'BONUS'));
  assert.strictEqual(R('v74DecideBonus', { bonusId: b.bonusId }).error.code, 'FORBIDDEN');
  as('Управляющий Смирнов');
  ok(R('v74DecideBonus', { bonusId: b.bonusId })); ok(R('v74DecideBonus', { bonusId: p.bonusId }));
  assert.strictEqual(R('v74DecideBonus', { bonusId: b.bonusId }).success, false, 'повторное решение');
  const B = labor().filter(l => l.objType === 'BONUS'); eq(B.map(l => l.amount).sort((a, b) => a - b), [-300, 1000]);
  const T = C._v64Totals_(lines('2026-11-01', '2026-11-30')); assert.strictEqual(T.laborBonus, 700); assert.strictEqual(T.labor, 8300);
  const q = ok(R('v74AddBonus', { date: '2026-11-11', employee: 'Мойщица Сидорова', type: 'BONUS', amount: 500, reason: 'x' }));
  as('Директор Иванова'); assert.strictEqual(R('v74DecideBonus', { bonusId: q.bonusId, decision: 'REJECT' }).success, false, 'отказ — с причиной');
});

t('Labor Cost в реестре, дневных итогах, P&L и сводке руководителя; предупреждения без подмены', () => {
  staff();
  const b = ok(R('v74AddBonus', { date: '2026-11-10', employee: 'Повар Петров', type: 'BONUS', amount: 1000, reason: 'банкет' }));
  as('Управляющий Смирнов'); ok(R('v74DecideBonus', { bonusId: b.bonusId }));
  table('Финансы_Расходы', C.MC_V64F.EXP[1], [['EXP9', new Date(2026, 10, 10), '', '', 'Фонд оплаты труда', 500, 'ведомость', '', '', 'ACTIVE', new Date(), 'Бухгалтер', 'OPX']]);
  sync();
  const keys = reg().map(x => x.RegKey); assert(keys.includes('SHIFT|SH1') && keys.includes('BONUS|' + b.bonusId));
  assert.strictEqual(dayRow('2026-11-10').labor, 5000); assert.strictEqual(dayRow('2026-11-10').laborHours, 21);   // 2400 + 1600 + 0 (нет ставки) + премия 1000
  const P = J(C.v73GetPnL('tok', '2026-11-01', '2026-11-30')), ln = c => P.lines.find(l => l.code === c);
  assert.strictEqual(ln('LABOR_TIMESHEET').amount, 7600); assert.strictEqual(ln('LABOR_BONUS').amount, 1000); assert.strictEqual(ln('LABOR_EXPENSE').amount, 500);
  assert.strictEqual(ln('LABOR').amount, 9100);
  assert.strictEqual(ln('EBITDA').amount, C._v64R2_(ln('AFTER_LOSSES').amount - 9100 - ln('OPEX').amount));
  assert(P.warnings.some(w => w.code === 'LABOR_NO_RATE')); assert(P.warnings.some(w => w.code === 'LABOR_DOUBLE')); assert(!P.warnings.some(w => w.code === 'NO_LABOR'));
  const D = J(C.v73GetCeoDashboard('tok', '2026-11-01', '2026-11-30'));
  assert.strictEqual(D.kpis.find(k => k.code === 'LABOR_HOURS').value, 33);
  assert.strictEqual(D.kpis.find(k => k.code === 'REVENUE_PER_HOUR').value, C._v64R2_(ln('REVENUE').amount / 33));
});

t('Экран ФОТ за период: по сотрудникам, проблемы (нет ставки, длинная и незакрытая смена, ожидает подтверждения)', () => {
  staff();
  table('MonChef_Смены', HS, sheets['MonChef_Смены'].data.slice(1).concat([shift('SH6', '2026-11-13', 'Повар Петров', 'Повар', 6, 23)]));
  ok(R('v74AddBonus', { date: '2026-11-10', employee: 'Повар Петров', type: 'BONUS', amount: 1000, reason: 'банкет' }));
  const d = J(C.v74GetLabor('tok', '2026-11-01', '2026-11-30'));
  const p = d.byEmployee.find(x => x.employee === 'Повар Петров');
  assert.strictEqual(p.hours, 37); assert.strictEqual(p.base, 11100); assert.strictEqual(p.bonus, 0, 'черновик премии не входит');
  eq(d.problems.map(x => x.code).sort(), ['BONUS_DRAFT', 'LONG_SHIFT', 'NO_RATE', 'OPEN_SHIFT']);
  assert.strictEqual(d.totals.noRate, 1); assert.strictEqual(d.rates.length, 2);
});

console.log('finance_stage4: ' + n + ' сценариев пройдено');
