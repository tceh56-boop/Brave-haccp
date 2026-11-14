/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
// «ЦЕХ Финансы и Экономика», этап 2 — реестр первичных операций и дневные итоги (MonChef_V72_FinRegistry.gs):
//   одна операция — одна запись; повторная сверка ничего не пишет; изменение → версия и история; удаление → REMOVED;
//   пересчёт только затронутых дней; закрытый период заморожен; сводка из дневных итогов = расчёт по журналу.
//   Настоящий код .gs, имитация таблиц.
// Запуск: node tests/finance_stage2.test.js
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
['MonChef_V64_EconomyFlow.gs', 'MonChef_V64_Finance.gs', 'MonChef_V72_FinRegistry.gs'].forEach(f => vm.runInContext(fs.readFileSync(path.join(app, f), 'utf8'), ctx, { filename: f }));
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

console.log('finance_stage2:');

t('Первая сверка: по записи реестра на каждую первичную операцию, дневные итоги по всем дням', () => {
  base();
  const r = sync();
  const R = reg(), keys = R.map(x => x.RegKey);
  assert(keys.includes('SALE|SL-20261110-AAAAAAAA') && keys.includes('SALE|SL-20261111-BBBBBBBB') && keys.includes('PURCHASE|B1'));
  assert.strictEqual(new Set(keys).size, keys.length, 'ключи уникальны');
  assert.strictEqual(r.created, R.length); assert(R.every(x => x.Status === 'ACTIVE' && Number(x.Version) === 1 && x.OrgID === 'ORG-1' && x.LocationID === 'LOC-1'));
  assert.strictEqual(R.find(x => x.RegKey === 'SALE|SL-20261110-AAAAAAAA').Amount, 600, 'сумма продажи — выручка, без себестоимости');
  assert.strictEqual(hist().filter(h => h.Action === 'CREATED').length, R.length);
  assert.strictEqual(dayRow('2026-11-10').revenue, 600); assert.strictEqual(dayRow('2026-11-11').revenue, 450);
  assert.strictEqual(dayRow('2026-11-10').cogs, 120, '0,3 кг × 400 по партии');
  const D = C._v72Read_('DISH').rows.find(x => x.Dish === 'Борщ' && C._v72DayStr_(x.Day) === '2026-11-10');
  assert.strictEqual(D.Qty, 2); assert.strictEqual(D.Revenue, 600); assert.strictEqual(D.Cost, 120);
});

t('Повторная сверка без изменений ничего не пишет: ни реестр, ни историю, ни итоги', () => {
  base(); sync();
  const R0 = JSON.stringify(sheets['Фин_Реестр'].data), H0 = hist().length, D0 = JSON.stringify(sheets['Фин_Итоги_День'].data);
  const r = sync();
  assert.strictEqual(r.created + r.changed + r.removed, 0); assert.strictEqual(r.days, 0);
  assert.strictEqual(JSON.stringify(sheets['Фин_Реестр'].data), R0); assert.strictEqual(hist().length, H0);
  assert.strictEqual(JSON.stringify(sheets['Фин_Итоги_День'].data), D0);
});

t('Изменение продажи: версия 2, строка истории «было → стало», пересчитан только её день', () => {
  base(); sync();
  const run10 = dayRow('2026-11-10').RunID;
  sheets['Ж_Продажи'].data[3][4] = 2; sheets['Ж_Продажи'].data[3][6] = 900;   // Плов 11.11: 1 → 2 порции
  const r = sync();
  assert.strictEqual(r.changed, 1); assert.strictEqual(r.created, 0); assert.strictEqual(r.days, 1);
  const x = reg().find(z => z.RegKey === 'SALE|SL-20261111-BBBBBBBB');
  assert.strictEqual(Number(x.Version), 2); assert.strictEqual(x.Amount, 900);
  const h = hist().filter(z => z.RegKey === x.RegKey && z.Action === 'CHANGED');
  assert.strictEqual(h.length, 1); assert.strictEqual(h[0].AmountBefore, 450); assert.strictEqual(h[0].AmountAfter, 900);
  assert.strictEqual(dayRow('2026-11-11').revenue, 900); assert.strictEqual(dayRow('2026-11-10').RunID, run10, 'другой день не пересчитывался');
  const oh = JSON.parse(C.v72GetOperationHistory(x.RegKey, 'tok')).data;
  eq(oh.history.map(z => z.action), ['CREATED', 'CHANGED']);
});

t('Удалённая первичная запись → статус REMOVED и история; день пересчитан; возврат записи → RESTORED', () => {
  base(); sync();
  const row = sheets['Ж_Продажи'].data.splice(3, 1)[0];
  let r = sync();
  assert.strictEqual(r.removed, 1);
  const x = reg().find(z => z.RegKey === 'SALE|SL-20261111-BBBBBBBB');
  assert.strictEqual(x.Status, 'REMOVED'); assert.strictEqual(dayRow('2026-11-11').revenue, 0);
  sheets['Ж_Продажи'].data.push(row); r = sync();
  assert.strictEqual(r.changed, 1); assert.strictEqual(reg().find(z => z.RegKey === x.RegKey).Status, 'ACTIVE');
  eq(hist().filter(z => z.RegKey === x.RegKey).map(z => z.Action), ['CREATED', 'REMOVED', 'RESTORED']);
  assert.strictEqual(dayRow('2026-11-11').revenue, 450);
});

t('Закрытие периода замораживает его дни; изменение в закрытом дне — в истории с признаком, итоги дня не меняются', () => {
  base(); sync();
  const res = JSON.parse(C.v64ClosePeriod(JSON.stringify({ from: '2026-10-01', to: '2026-10-31', acceptIssues: true, reason: 'тест' }), 'tok'));
  assert(res.success, JSON.stringify(res));
  assert.strictEqual(String(dayRow('2026-10-10').Frozen), 'true');
  assert.strictEqual(String(dayRow('2026-11-10').Frozen), 'false');
  sheets['Ж_Продажи'].data[1][4] = 5; sheets['Ж_Продажи'].data[1][6] = 1500;   // правка задним числом в закрытом октябре
  const r = sync();
  assert.strictEqual(r.changed, 1); assert.strictEqual(r.closedChanged, 1);
  assert.strictEqual(dayRow('2026-10-10').revenue, 600, 'итоги закрытого дня не меняются');
  const h = hist().filter(z => z.RegKey === 'SALE|SL-20261010-AAAAAAAA' && z.Action === 'CHANGED')[0];
  assert.strictEqual(String(h.ClosedPeriod), 'true');
  assert.strictEqual(String(reg().find(z => z.RegKey === 'SALE|SL-20261010-AAAAAAAA').ClosedChanged), 'true');
  // полный пересчёт тоже не трогает замороженные дни
  sync({ full: true }); assert.strictEqual(dayRow('2026-10-10').revenue, 600);
});

t('Сводка за период из дневных итогов совпадает с расчётом по журналу; свежесть сверки', () => {
  base();
  table('Ревизии_Корректировки_V49', ['AdjustmentID', 'RevisionID', 'LineID', 'BatchID', 'Product', 'Unit', 'BeforeQty', 'AfterQty', 'DeltaQty', 'AdjustmentType', 'NewBatchID', 'FactID', 'CreatedAt', 'CreatedBy', 'Reason'],
    [['ADJ1', 'REV1', 'L1', 'B2', 'Говядина', 'кг', 10, 9.5, -0.5, 'SHORTAGE', '', '', new Date(2026, 10, 12), 'Шеф', '']]);
  sync();
  const s = J(C.v72GetSummary('tok', '2026-11-01', '2026-11-30')), T = C._v64Totals_(lines('2026-11-01', '2026-11-30'));
  ['revenue', 'cogs', 'cogsWithPackaging', 'grossContribution', 'marginPct', 'wasteCost', 'inventoryShortage', 'contributionAfterLosses', 'purchases', 'missingSalePrice'].forEach(k =>
    assert.strictEqual(s.totals[k], T[k], k));
  eq(s.byDay.map(d => d.day), ['2026-11-01', '2026-11-02', '2026-11-10', '2026-11-11', '2026-11-12']); assert.strictEqual(s.dishes[0].dish, 'Борщ');
  assert.strictEqual(s.stale, false); assert(s.lastSync && s.lastSync.runId);
  const g = J(C.v72GetRegistry(JSON.stringify({ type: 'SALE' }), 'tok'));
  assert(g.items.length >= 2 && g.items.every(x => x.type === 'SALE') && g.total === g.items.length);
});

console.log('finance_stage2: ' + n + ' сценариев пройдено');
