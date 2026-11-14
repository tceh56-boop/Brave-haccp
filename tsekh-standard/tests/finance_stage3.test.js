/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
// «ЦЕХ Финансы и Экономика», этап 3 — управленческий P&L и CEO Dashboard (MonChef_V73_PnL.gs) из дневных итогов:
//   строки P&L сходятся с расчётом по журналу; расходы по статьям; сравнение с прошлым периодом; ориентиры и сигналы;
//   честные предупреждения (нет ФОТ, дни без разбивки); экран «Экономика». Настоящий код .gs, имитация таблиц.
// Запуск: node tests/finance_stage3.test.js
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
['MonChef_V64_EconomyFlow.gs', 'MonChef_V64_Finance.gs', 'MonChef_V72_FinRegistry.gs', 'MonChef_V73_PnL.gs'].forEach(f => vm.runInContext(fs.readFileSync(path.join(app, f), 'utf8'), ctx, { filename: f }));
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

const EXP = (rows) => table('Финансы_Расходы', C.MC_V64F.EXP[1], rows.map(([id, d, cat, sum]) => [id, d, '', '', cat, sum, 'док', '', '', 'ACTIVE', new Date(), 'Бухгалтер', 'OPX']));
const line = (P, code) => P.lines.find(l => l.code === code);
function setup(withLabor) {
  base();
  EXP([['EXP1', new Date(2026, 10, 10), 'Аренда', 1000], ['EXP2', new Date(2026, 10, 11), 'Амортизация оборудования', 50], ['EXP3', new Date(2026, 9, 10), 'Аренда', 1000]]
    .concat(withLabor ? [['EXP4', new Date(2026, 10, 10), 'Фонд оплаты труда', 300]] : []));
  table('Акты_Списания', ['Акт', 'Дата', 'Причина (код)', 'Причина', 'Комментарий', 'Строк', 'Сумма, ₽', 'Составил', 'Роль', 'Строки акта (JSON)', 'Списано со склада (JSON)', 'OperationID'],
    [['АС-1', new Date(2026, 10, 11, 12), 'STAFF', 'Питание персонала', '', 1, 400, 'Шеф', 'Шеф-повар', '[]', JSON.stringify([{ name: 'Говядина', qty: 1, unit: 'кг', price: 400, sum: 400, batches: [{ batchId: 'B1', qty: 1, unit: 'кг' }] }]), 'OP-A']]);
  sync();
}

console.log('finance_stage3:');

t('P&L: строки сходятся с расчётом по журналу, расходы — по статьям, итоги считаются сверху вниз', () => {
  setup(true);
  const P = J(C.v73GetPnL('tok', '2026-11-01', '2026-11-30')), T = C._v64Totals_(lines('2026-11-01', '2026-11-30'));
  assert.strictEqual(line(P, 'REVENUE').amount, T.revenue); assert.strictEqual(line(P, 'COGS').amount, T.cogs);
  assert.strictEqual(line(P, 'GROSS').amount, T.grossContribution); assert.strictEqual(line(P, 'WASTE').amount, 400);
  assert.strictEqual(line(P, 'AFTER_LOSSES').amount, T.contributionAfterLosses);
  assert.strictEqual(line(P, 'LABOR').amount, 300); assert.strictEqual(line(P, 'OPEX:Аренда').amount, 1000); assert.strictEqual(line(P, 'DEPRECIATION').amount, 50);
  assert.strictEqual(line(P, 'OPEX').amount + line(P, 'LABOR').amount + line(P, 'DEPRECIATION').amount, T.expenses, 'все расходы журнала разнесены по строкам');
  assert.strictEqual(line(P, 'EBITDA').amount, C._v64R2_(T.contributionAfterLosses - 300 - 1000));
  assert.strictEqual(line(P, 'OPERATING').amount, C._v64R2_(line(P, 'EBITDA').amount - 50));
  assert.strictEqual(line(P, 'REVENUE').pct, 100);
  assert.strictEqual(P.ratios.foodCostPct.value, Math.round(T.cogs / T.revenue * 1000) / 10);
  assert.strictEqual(P.ratios.laborPct.value, Math.round(300 / T.revenue * 1000) / 10);
  assert(!P.warnings.some(w => w.code === 'NO_LABOR'));
});

t('Сравнение с предыдущим периодом той же длины', () => {
  setup(true);
  const P = J(C.v73GetPnL('tok', '2026-11-01', '2026-11-30'));
  assert.strictEqual(P.prevFrom, '2026-10-02'); assert.strictEqual(P.prevTo, '2026-10-31'); assert.strictEqual(P.days, 30);
  const r = line(P, 'REVENUE'); assert.strictEqual(r.prev, 600); assert.strictEqual(r.delta, C._v64R2_(r.amount - 600));
  assert.strictEqual(line(P, 'OPEX:Аренда').prev, 1000); assert.strictEqual(line(P, 'OPEX:Аренда').delta, 0);
  const p2 = J(C.v73GetPnL('tok', '2026-11-10', '2026-11-11')); assert.strictEqual(p2.prevFrom, '2026-11-08'); assert.strictEqual(p2.prevTo, '2026-11-09');
});

t('Нет ФОТ — строка 0 и предупреждение, без подмены; Labor/Prime cost без оценки по ориентиру', () => {
  setup(false);
  const P = J(C.v73GetPnL('tok', '2026-11-01', '2026-11-30'));
  assert.strictEqual(line(P, 'LABOR').amount, 0); assert(P.warnings.some(w => w.code === 'NO_LABOR'));
  const D = J(C.v73GetCeoDashboard('tok', '2026-11-01', '2026-11-30')), lab = D.kpis.find(k => k.code === 'LABOR_COST');
  assert.strictEqual(lab.value, 0); assert.strictEqual(lab.tone, ''); assert(!D.signals.some(s => s.code === 'LABOR_HIGH'));
});

t('CEO Dashboard: показатели с динамикой, блюда, потери по причинам; ориентиры меняются и дают сигналы', () => {
  setup(true);
  let D = J(C.v73GetCeoDashboard('tok', '2026-11-01', '2026-11-30'));
  const rev = D.kpis.find(k => k.code === 'REVENUE'); assert.strictEqual(rev.prev, 600); assert(rev.value > 0);
  assert.strictEqual(D.topDishes[0].dish, 'Борщ'); eq(D.lossesByReason.map(r => r.code), ['STAFF']);
  assert.strictEqual(D.targets.foodCostPct, 32); assert.strictEqual(D.targets.custom, false);
  const fc = D.kpis.find(k => k.code === 'FOOD_COST').value;
  let r = JSON.parse(C.v73SetTargets(JSON.stringify({ foodCostPct: 1, minDishMarginPct: 99 }), 'tok')); assert(r.success, JSON.stringify(r));
  D = J(C.v73GetCeoDashboard('tok', '2026-11-01', '2026-11-30'));
  if (fc > 1) { assert(D.signals.some(s => s.code === 'FOOD_COST_HIGH')); assert.strictEqual(D.kpis.find(k => k.code === 'FOOD_COST').tone, 'bad'); }
  assert(D.signals.some(s => s.code === 'WEAK_DISHES') && D.weakDishes.length >= 1);
  r = JSON.parse(C.v73SetTargets(JSON.stringify({ foodCostPct: 'abc' }), 'tok')); assert.strictEqual(r.success, false);
  C.v73SetTargets(JSON.stringify({ foodCostPct: '', minDishMarginPct: '' }), 'tok');
  assert.strictEqual(J(C.v73GetTargets('tok')).targets.foodCostPct, 32);
});

t('День, посчитанный до этапа 3 (без разбивки расходов), — сумма не теряется, есть подсказка; полный пересчёт разбивает', () => {
  setup(true);
  const sh = sheets['Фин_Итоги_День'], c = C.MC_V72.DAY[1].indexOf('ExpByCategory');
  sh.data.forEach((row, i) => { if (i) row[c] = ''; });
  let P = J(C.v73GetPnL('tok', '2026-11-01', '2026-11-30'));
  assert.strictEqual(line(P, 'OPEX:Без разбивки по статьям').amount, 1350); assert(P.warnings.some(w => w.code === 'EXP_NO_SPLIT'));
  sync({ full: true });
  P = J(C.v73GetPnL('tok', '2026-11-01', '2026-11-30'));
  assert(!line(P, 'OPEX:Без разбивки по статьям')); assert.strictEqual(line(P, 'LABOR').amount, 300);
});

t('Отчёт без сверки: при первом открытии итоги сверяются сами', () => {
  base(); EXP([['EXP1', new Date(2026, 10, 10), 'Аренда', 1000]]);
  const P = J(C.v73GetPnL('tok', '2026-11-01', '2026-11-30'));
  assert.strictEqual(line(P, 'OPEX:Аренда').amount, 1000); assert(P.lastSync && P.lastSync.runId);
});

t('Экран «Экономика»: показатели руководителя, вкладки P&L, «Сигналы», «По дням» и прежние вкладки V64', () => {
  setup(true);
  const ui = fs.readFileSync(path.join(app, 'MonChef_UI.gs'), 'utf8');
  Object.assign(G, { UI_SECTIONS: [], _UI_BUILDERS_: {} });
  vm.runInContext(['_uiJ_', '_uiCol_'].map(x => fn(ui, x)).join('\n'), ctx);
  vm.runInContext(fs.readFileSync(path.join(app, 'MonChef_V69_UI.gs'), 'utf8'), ctx);
  const s = C._UI_BUILDERS_.finance('tok', { from: '2026-11-01', to: '2026-11-30' }, session);
  eq(s.tabs.slice(0, 4).map(x => x.title), ['P&L', 'Сигналы', 'По дням', 'Блюда']);
  assert(s.kpis.some(k => /^Выручка/.test(k.label) && /прошлый период: 600/.test(k.hint)));
  assert(s.kpis.some(k => /Без цены закупки/.test(k.label)), 'показатели качества данных остались');
  assert(s.tabs[0].rows.some(r => r.title === '— ФОТ (Labor Cost), всего' && r.amount === 300));
});

console.log('finance_stage3: ' + n + ' сценариев пройдено');
