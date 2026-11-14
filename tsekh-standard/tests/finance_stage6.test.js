/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
// «ЦЕХ Финансы и Экономика», этап 6 — меню-инжиниринг, закупки, прогноз (MonChef_V76_MenuProcurement.gs):
//   матрица Kasavana–Smith, цены поставщиков и рост цен, влияние на себестоимость блюда по ТТК, прогноз по дням недели,
//   потребность по ТТК с остатком и уже заказанным, заявки в лист V21 без повторов, сигналы сводки руководителя.
//   Настоящий код .gs, имитация таблиц.
// Запуск: node tests/finance_stage6.test.js
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
  _mdSuppliers_: () => [{ name: 'ООО Мясо', inn: '7701234567' }, { name: 'Молзавод', inn: '5001112223' }], _defaultTenant_: () => ({ organization_id: 'ORG-1', location_id: 'LOC-1' }), _createOperation_: () => ({ id: 'OPS' }),
  _bkHex_: b => b.map(x => ((x < 0 ? x + 256 : x).toString(16)).padStart(2, '0')).join(''), _mcTimeStr_: x => String(x), MC_RB_TECH_: 'тех', JOURNALS: [] });
G.Utilities.formatDate = (d, tz, f) => { const x = new Date(d), p = v => String(v).padStart(2, '0'); return f.replace('yyyy', x.getFullYear()).replace('MM', p(x.getMonth() + 1)).replace('dd', p(x.getDate())).replace('HH', p(x.getHours())).replace('mm', p(x.getMinutes())).replace('ss', p(x.getSeconds())); };
const ctx = vm.createContext(G);
const code = fs.readFileSync(path.join(app, 'Code.gs'), 'utf8'), legacy = fs.readFileSync(path.join(app, 'MonChef_LegacyBack.gs'), 'utf8');
const fn = (src, name) => { const i = src.indexOf('function ' + name + '('); assert(i >= 0, name); let d = 0, j = src.indexOf('{', i); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(i, j + 1); };
vm.runInContext(['_toBaseUnitServer_', '_parseDate_', '_parseDateStr_', 'getSalesStats', '_mcFinClosedForJournalRow_', '_serverExplodeInto_', '_findSubDish_', '_subYield_', '_cleanProdName_', '_prodKey_',
  '_looseNameServer_', '_normNameServer_', '_unitsCompatible_', '_isPfName_'].map(x => fn(code, x)).join('\n'), ctx);
vm.runInContext(fn(legacy, '_mcSaleDuplicate_'), ctx);
['MonChef_V64_EconomyFlow.gs', 'MonChef_V64_Finance.gs', 'MonChef_V72_FinRegistry.gs', 'MonChef_V73_PnL.gs', 'MonChef_V74_Labor.gs', 'MonChef_V75_Cash.gs', 'MonChef_V21_ProcurementReceiving.gs', 'MonChef_V76_MenuProcurement.gs'].forEach(f => vm.runInContext(fs.readFileSync(path.join(app, f), 'utf8'), ctx, { filename: f }));
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



const R = (fn, o) => JSON.parse(C[fn](JSON.stringify(o), 'tok'));
const ok = r => { assert(r.success, JSON.stringify(r)); return r.data; };
const near = (a, b, m) => assert(Math.abs(a - b) < 0.011, (m || '') + ': ' + a + ' ≠ ' + b);

// ---------- техкарты: Борщ (с бульоном п/ф), Плов, Салат; Компот — без ТТК ----------
const ttk = (code, name, ing, extra) => Object.assign({ code, name, cat: 'Горячее', ing: ing.map(x => [x[0], x[1], x[2], x[1], x[1]]), yieldBase: 0, yieldUnit: 'г', portions: 1, semi: false }, extra || {});
const DISHES = [ttk('T1', 'Борщ', [['Говядина', 100, 'г'], ['Свёкла', 150, 'г'], ['Бульон п/ф', 200, 'мл']]), ttk('T2', 'Плов', [['Говядина', 150, 'г'], ['Рис', 100, 'г']]),
  ttk('T3', 'Салат', [['Свёкла', 200, 'г']], { cat: 'Салаты' }), ttk('P1', 'Бульон п/ф', [['Говядина', 300, 'г'], ['Лук', 100, 'г']], { semi: true, yieldBase: 1000, yieldUnit: 'мл' })];
C._buildDishIndexes_ = () => { const byCode = {}, byNorm = {}, byLoose = {}; DISHES.forEach(d => { byCode[d.code] = d; byNorm[C._normNameServer_(d.name)] = d; byLoose[C._looseNameServer_(d.name)] = d; }); return { dishByCode: byCode, dishByNormName: byNorm, dishByLooseName: byLoose }; };
C._stockBalanceSheet_ = () => book.getSheetByName('Склад_Остатки') || table('Склад_Остатки', ['Продукт', 'Ед.изм', 'Остаток', 'Мин.запас', 'Сред.цена', 'Цена послед.закупки', 'Обновлено'], []);
const HPRICE = ['PriceID', 'DishCode', 'DishName', 'Price', 'Unit', 'Source', 'EventID', 'DateFrom', 'DateTo', 'Status', 'CreatedAt', 'CreatedBy', 'Comment', 'OperationID'];
const HDAY = C.MC_V72.DAY[1], HDISH = C.MC_V72.DISH[1];
const dayRow6 = (day, revenue, cogs) => HDAY.map(h => h === 'Day' ? day : h === 'LocationID' ? 'LOC-1' : h === 'revenue' ? revenue : h === 'cogs' ? cogs : /ByReason|ByCategory/.test(h) ? '{}' : h === 'Frozen' ? false : 0);
const dishRow = (day, dish, qty, revenue, cost) => [day, 'LOC-1', dish, '', qty, revenue, cost, '', 'R'];
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const notes = []; let bno = 0;
C._notify_ = (type, sev, title, text, role, key) => { if (notes.some(n => n.key === key)) return null; notes.push({ type, sev, title, text, role, key }); return 'NT' + notes.length; };
C._stockBatchesSheet_ = () => sheets['Склад_Партии']; C._nextBatchId_ = () => 'NB' + (++bno);
vm.runInContext(fn(code, '_createBatch_'), ctx);
const fresh = () => G.PropertiesService.getScriptProperties().setProperty('MC_V72_LAST', JSON.stringify({ at: new Date().toISOString(), runId: 'T' }));

function world() {
  reset(); fresh();
  // закупки: говядина 400 (сентябрь и октябрь, ООО Мясо) → 480 (ООО Мясо) → 450 (Фермер); рис в граммах; свёкла без изменений
  table('Склад_Партии', HB, [batch('G0', 'Говядина', 'кг', 10, 400, '2026-09-15'), batch('G1', 'Говядина', 'кг', 10, 400, '2026-10-20'), batch('G2', 'Говядина', 'кг', 10, 480, '2026-11-05'),
    batch('G3', 'Говядина', 'кг', 5, 450, '2026-11-10'), batch('R1', 'Рис', 'г', 5000, 0.1, '2026-11-03'), batch('S1', 'Свёкла', 'кг', 20, 50, '2026-10-25'), batch('S2', 'Свёкла', 'кг', 20, 50, '2026-11-06'),
    batch('PF1', 'Бульон п/ф', 'мл', 5000, 0.2, '2026-11-07', 'Производство PR-1'), batch('F9', 'Говядина', 'кг', 1, 0, '2026-11-08', 'REVISION_FOUND')]);
  const pass = (id, sup, d, sum, price, unit, qty) => [id, sup, 'Н-' + id, '', d, sum, price, unit, qty, 'Петров', 'OP-' + id, '', ''];
  table('Приёмка_Партии', HP, [pass('G0', 'ООО Мясо', '2026-09-15', 4000, 400, 'кг', 10), pass('G1', 'ООО Мясо', '2026-10-20', 4000, 400, 'кг', 10), pass('G2', 'ООО Мясо', '2026-11-05', 4800, 480, 'кг', 10),
    pass('G3', 'Фермер', '2026-11-10', 2250, 450, 'кг', 5), pass('R1', 'Овощи и крупы', '2026-11-03', 500, 0.1, 'г', 5000), pass('S1', 'Овощи и крупы', '2026-10-25', 1000, 50, 'кг', 20),
    pass('S2', 'Овощи и крупы', '2026-11-06', 1000, 50, 'кг', 20)]);
  table('Цены_Меню', HPRICE, [['MP1', 'T1', 'Борщ', 300, 'порц.', 'MENU', '', '2026-01-01', '', 'ACTIVE'], ['MP2', 'T2', 'Плов', 450, 'порц.', 'MENU', '', '2026-01-01', '', 'ACTIVE'],
    ['MP3', 'T3', 'Салат', 300, 'порц.', 'MENU', '', '2026-01-01', '', 'ACTIVE'], ['MP4', '', 'Окрошка', 350, 'порц.', 'MENU', '', '2026-01-01', '', 'ACTIVE']]);
  // продажи ноября одним днём — для матрицы
  table('Фин_Итоги_День', HDAY, [dayRow6('2026-11-12', 70000, 26200)]);
  table('Фин_Итоги_Блюдо_День', HDISH, [dishRow('2026-11-12', 'Борщ', 100, 30000, 9000), dishRow('2026-11-12', 'Плов', 80, 36000, 16000), dishRow('2026-11-12', 'Салат', 10, 3000, 600), dishRow('2026-11-12', 'Компот', 10, 1000, 600)]);
  avg['говядина'] = 450; avg['свёкла'] = 50; avg['рис'] = 100; avg['лук'] = 40;
  C._V76_RUN_ = null; notes.length = 0;
}

console.log('Финансы, этап 6: меню-инжиниринг, закупки, прогноз');

t('меню-инжиниринг: классы Kasavana–Smith, пороги, признаки, блюда меню без продаж', () => {
  world();
  const d = ok(JSON.parse(C.v76GetMenuEngineering('tok', '2026-11-01', '2026-11-30')));
  eq(d.thresholds, { popularityPct: 17.5, avgCmPerPortion: 219 });
  const by = {}; d.items.forEach(x => { by[x.dish] = x; });
  eq([by['Плов'].cls, by['Борщ'].cls, by['Салат'].cls, by['Компот'].cls], ['STAR', 'PLOWHORSE', 'PUZZLE', 'DOG']);
  eq(d.items.map(x => x.dish), ['Плов', 'Борщ', 'Салат', 'Компот'], 'порядок: звёзды, лошадки, загадки, собаки');
  eq([by['Борщ'].mixPct, by['Борщ'].cmPerPortion, by['Борщ'].foodCostPct, by['Борщ'].menuPrice], [50, 210, 30, 300]);
  assert(by['Плов'].flags.includes('MARGIN_BELOW_TARGET'), 'маржа плова 55,6 % ниже ориентира 60 %');
  assert(by['Компот'].flags.includes('NO_TTK') && by['Компот'].flags.includes('NO_MENU_PRICE'));
  // норматив по ТТК: борщ = 100 г говядины + 150 г свёклы + 200 мл бульона (бульон — п/ф по своей цене 0,2 ₽/мл → считается через склад)
  assert(by['Борщ'].normCost > 0, 'нормативная себестоимость по ТТК посчитана');
  eq(d.unsold.map(x => x.dish), ['Окрошка']);
  eq(d.classes.map(c => [c.cls, c.dishes]), [['STAR', 1], ['PLOWHORSE', 1], ['PUZZLE', 1], ['DOG', 1]]);
  eq(d.totals, { dishes: 4, qty: 200, gross: 43800, revenue: 70000 });
});

t('закупки: поставщики, рост цены к предыдущей и к средней за 90 дней, дешевле у другого поставщика', () => {
  world();
  const d = ok(JSON.parse(C.v76GetProcurement('tok', '2026-11-01', '2026-11-30')));
  eq(d.totals.amount, 8550, 'выпуск п/ф и излишек ревизии — не закупка');
  eq(d.suppliers.map(s => [s.supplier, s.amount, s.sharePct]), [['ООО Мясо', 4800, 56.1], ['Фермер', 2250, 26.3], ['Овощи и крупы', 1500, 17.5]]);
  const beef = d.products.find(p => p.product === 'Говядина'), rice = d.products.find(p => p.product === 'Рис');
  eq([beef.unit, beef.lastPrice, beef.lastSupplier, beef.prevPrice, beef.changePct, beef.avg90, beef.vsAvg90Pct, beef.periodQty, beef.periodAmount], ['кг', 450, 'Фермер', 480, -6.2, 400, 12.5, 15, 7050]);
  eq([rice.unit, rice.lastPrice, rice.periodQty], ['кг', 100, 5], 'граммы приведены к кг');
  eq(d.rises.map(x => x.product), ['Говядина'], 'рост 12,5 % к средней за 90 дней — выше порога 10 %');
  eq([d.cheaper[0].product, d.cheaper[0].bestSupplier, d.cheaper[0].bestPrice, d.cheaper[0].saving], ['Говядина', 'ООО Мясо', 400, 1050]);
  eq(d.totals.possibleSaving, 1050);
});

t('влияние цены на себестоимость блюда: по ТТК с раскладкой п/ф до сырья', () => {
  world();
  const d = ok(JSON.parse(C.v76GetProcurement('tok', '2026-11-01', '2026-11-30')));
  // говядина +50 ₽/кг к средней: борщ = 100 г + 200 мл бульона × 300 г / 1000 мл = 160 г → +8 ₽; плов 150 г → +7,5 ₽
  eq(d.impact.map(x => [x.dish, x.deltaPerPortion]), [['Борщ', 8], ['Плов', 7.5]]);
  eq([d.impact[0].menuPrice, d.impact[0].deltaPctOfPrice], [300, 2.7]);
  assert(/Говядина \+8/.test(d.impact[0].drivers));
});

t('порог роста цены: по умолчанию от 1 копейки, процент — ориентир предприятия (v73SetTargets)', () => {
  world();
  ok(R('v73SetTargets', { priceRisePct: 15 }));
  let d = ok(JSON.parse(C.v76GetProcurement('tok', '2026-11-01', '2026-11-30')));
  eq([d.threshold, d.rises.length], [15, 0]);
  ok(R('v73SetTargets', { priceRisePct: '' }));
  d = ok(JSON.parse(C.v76GetProcurement('tok', '2026-11-01', '2026-11-30')));
  eq([d.threshold, d.rises.length], [0, 1], 'по умолчанию — от 1 копейки');
});

function forecastWorld() {
  world();
  // две недели истории 16–29.11: борщ 10 порций в день, в субботу 20; плов 5
  const days = [], dishes = [];
  for (let i = 16; i <= 29; i++) { const dt = new Date(2026, 10, i), s = iso(dt), b = dt.getDay() === 6 ? 20 : 10;
    days.push(dayRow6(s, b * 300 + 5 * 450, b * 90 + 5 * 200)); dishes.push(dishRow(s, 'Борщ', b, b * 300, b * 90), dishRow(s, 'Плов', 5, 2250, 1000)); }
  table('Фин_Итоги_День', HDAY, days); table('Фин_Итоги_Блюдо_День', HDISH, dishes);
  table('Склад_Остатки', ['Продукт', 'Ед.изм', 'Остаток', 'Мин.запас', 'Сред.цена', 'Цена послед.закупки', 'Обновлено'], [['Говядина', 'кг', 5, 2, 450, 450, ''], ['Свёкла', 'кг', 20, 0, 50, 50, ''], ['Лук', 'кг', 0.5, 0, 40, 40, '']]);
  // уже заказано 3 кг говядины (заявка V21 двухдневной давности) и старая заявка месячной давности — не считается
  table('Закупки_V21', ['RequestID', 'PlanID', 'WeekFrom', 'Product', 'Unit', 'Qty', 'Supplier', 'Status', 'OrderID', 'CreatedAt', 'CreatedBy', 'UpdatedAt'],
    [['REQ-1', 'W-1', '2026-11-30', 'Говядина', 'кг', 3, 'Фермер', 'ORDERED', 'ORD-1', new Date(2026, 10, 28), 'Шеф', ''], ['REQ-0', 'W-0', '2026-10-26', 'Говядина', 'кг', 50, 'Фермер', 'ORDERED', 'ORD-0', new Date(2026, 9, 28), 'Шеф', '']]);
}

t('прогноз: по дням недели, выручка по цене меню, потребность по ТТК, к заказу с остатком, мин. запасом и уже заказанным', () => {
  forecastWorld();
  const d = ok(R('v76GetForecast', { asOf: '2026-11-30', days: 7, weeks: 2 }));
  eq([d.from, d.to, d.historyFrom, d.historyTo, d.workDays], ['2026-11-30', '2026-12-06', '2026-11-16', '2026-11-29', 14]);
  eq(d.dishes.map(x => [x.dish, x.forecastQty]), [['Борщ', 80], ['Плов', 35]], 'суббота — по субботам');
  eq([d.totals.revenue, d.totals.portions], [80 * 300 + 35 * 450, 115]);
  eq(d.perDay.find(p => p.weekday === 'сб').portions, 25);
  const it = {}; d.items.forEach(x => { it[x.product] = x; });
  // говядина: борщ 160 г × 80 + плов 150 г × 35 = 18,05 кг; + мин. 2 − остаток 5 − заказано 3 = 12,05 кг × 450 ₽
  eq([it['Говядина'].need, it['Говядина'].onHand, it['Говядина'].minStock, it['Говядина'].ordered, it['Говядина'].toOrder, it['Говядина'].supplier, it['Говядина'].estAmount],
    [18.05, 5, 2, 3, 12.05, 'Фермер', 5422.5]);
  eq([it['Свёкла'].need, it['Свёкла'].toOrder], [12, 0], 'свёклы хватает');
  eq([it['Лук'].need, it['Лук'].toOrder], [1.6, 1.1], 'лук — через бульон п/ф: 20 г на борщ');
  eq([it['Рис'].need, it['Рис'].toOrder, it['Рис'].noStockRow], [3.5, 3.5, true]);
  eq(d.toOrder.map(x => x.product).sort(), ['Говядина', 'Лук', 'Рис']);
  assert(d.warnings.some(w => /Нет строки остатка/.test(w.text) && /Рис/.test(w.text)));
  assert(d.warnings.some(w => /Истории мало/.test(w.text)));
});

t('заявки по прогнозу: в лист V21, без повторов, дальше обычный путь заказа', () => {
  forecastWorld();
  const r = ok(R('v76CreateOrderRequests', { asOf: '2026-11-30', days: 7, weeks: 2 }));
  eq(r.planId, 'FC-20261130-7');
  eq(r.created.map(x => [x.product, x.qty, x.unit, x.supplier]).sort(), [['Говядина', 12.05, 'кг', 'Фермер'], ['Лук', 1.1, 'кг', 'НЕ НАЗНАЧЕН'], ['Рис', 3.5, 'кг', 'Овощи и крупы']]);
  const rows = sheets['Закупки_V21'].data.slice(1).filter(x => x[1] === 'FC-20261130-7');
  eq(rows.map(x => x[7]), ['OPEN', 'OPEN', 'OPEN']);
  // повторный запуск: новые заявки уже «заказано» → заказывать нечего, дублей нет
  const r2 = ok(R('v76CreateOrderRequests', { asOf: '2026-11-30', days: 7, weeks: 2 }));
  eq(r2.created.length, 0);
  eq(sheets['Закупки_V21'].data.slice(1).filter(x => x[1] === 'FC-20261130-7').length, 3);
  const f = ok(R('v76GetForecast', { asOf: '2026-11-30', days: 7, weeks: 2 }));
  eq(f.toOrder.length, 0, 'после заявок к заказу ничего');
  // выбор позиций и своё количество
  table('Закупки_V21', ['RequestID', 'PlanID', 'WeekFrom', 'Product', 'Unit', 'Qty', 'Supplier', 'Status', 'OrderID', 'CreatedAt', 'CreatedBy', 'UpdatedAt'], []);
  const r3 = ok(R('v76CreateOrderRequests', { asOf: '2026-11-30', days: 7, weeks: 2, products: ['говядина|г'], qty: { 'говядина|г': 20 } }));
  eq(r3.created.map(x => [x.product, x.qty]), [['Говядина', 20]]);
});

t('прогноз без истории — пустой, с честным предупреждением', () => {
  world(); table('Фин_Итоги_День', HDAY, []); table('Фин_Итоги_Блюдо_День', HDISH, []);
  const d = ok(R('v76GetForecast', { asOf: '2026-11-30' }));
  eq([d.workDays, d.dishes.length, d.totals.revenue, d.toOrder.length], [0, 0, 0, 0]);
  assert(d.warnings.some(w => /нет дней с продажами/.test(w.text)));
});

t('сводка руководителя: сигналы роста цен и возможной экономии', () => {
  world();
  const d = ok(JSON.parse(C.v73GetCeoDashboard('tok', '2026-11-01', '2026-11-30')));
  const up = d.signals.find(s => s.code === 'PRICE_UP'), ch = d.signals.find(s => s.code === 'CHEAPER_SUPPLIER');
  assert(up && /Говядина \+12\.5%/.test(up.text), JSON.stringify(d.signals));
  assert(ch && /1050/.test(ch.text));
  eq(d.targets.priceRisePct, 0);
});

t('сквозной путь: продажа → дневные итоги → меню-инжиниринг (себестоимость по партиям)', () => {
  base(); C._v72SyncCore_({}, null);
  const d = ok(JSON.parse(C.v76GetMenuEngineering('tok', '2026-11-01', '2026-11-30')));
  const b = d.items.find(x => x.dish === 'Борщ');
  eq([b.qty, b.revenue, b.cost], [2, 600, 120], 'себестоимость — 0,3 кг партии B1 по 400 ₽');
});

t('приёмка дороже прежней: себестоимость блюд пересчитана сразу, событие записано, шеф и директор уведомлены', () => {
  world();
  // говядина: прежняя закупка 450 ₽/кг (Фермер, 10.11) → новая 460 ₽/кг; партия в граммах, как пишет приход
  const id = C._createBatch_('Говядина', 'г', 2000, new Date(2026, 10, 14), '2026-11-20', 0.46, 'Приход (Фермер)', { supplier: 'Фермер' });
  eq(notes.length, 1);
  assert(/Подорожание: Говядина 450 → 460 ₽\/кг \(\+10 ₽, \+2\.2%\)/.test(notes[0].title), notes[0].title);
  assert(/Борщ \+1\.6 ₽ \(80\.3 → 81\.9 ₽, food cost 26\.8 → 27\.3%\)/.test(notes[0].text), notes[0].text);
  assert(/Плов \+1\.5 ₽/.test(notes[0].text) && notes[0].role === 'Шеф-повар' && notes[0].key === 'cost_up|' + id);
  const ev = C._v76CostEvents_(C._v64Range_('2026-11-01', '2026-12-31'));
  eq(ev.map(e => [e.product, e.prevPrice, e.newPrice, e.dish, e.deltaPerPortion, e.costBefore, e.costAfter]), [['Говядина', 450, 460, 'Плов', 1.5, 77.5, 79], ['Говядина', 450, 460, 'Борщ', 1.6, 80.3, 81.9]]);
  // та же цена ещё раз — не подорожание; выпуск своего п/ф — не закупка
  C._createBatch_('Говядина', 'г', 1000, new Date(2026, 10, 14), '', 0.46, 'Приход (Фермер)', { supplier: 'Фермер' });
  C._createBatch_('Говядина', 'г', 1000, new Date(2026, 10, 14), '', 0.9, 'Производство PR-9', {});
  eq(notes.length, 1);
  // экран «Закупки» и сводка руководителя видят событие
  const d = ok(JSON.parse(C.v76GetProcurement('tok', '2026-11-01', '2026-12-31')));
  eq(d.costEvents.length, 2);
  const ceo = ok(JSON.parse(C.v73GetCeoDashboard('tok', '2026-11-01', '2026-12-31')));
  assert(ceo.signals.some(s => s.code === 'COST_UP' && /Борщ \+1\.6 ₽\/порц\./.test(s.text)), JSON.stringify(ceo.signals));
});

t('порог — 1 копейка за кг: +1 коп. — подорожание, меньше — нет; ориентир в процентах поднимает порог', () => {
  world();
  assert(C._v76OnPurchase_('X1', 'Говядина', 'кг', 450.004, 1, 'Фермер', {}) === null, 'меньше копейки — не подорожание');
  const r = C._v76OnPurchase_('X2', 'Говядина', 'кг', 450.014, 1, 'Фермер', {});
  assert(r && r.newPrice === 450.01 && r.dishes.length === 2 && r.dishes[0].delta === 0.0016, JSON.stringify(r));
  world(); ok(R('v73SetTargets', { priceRisePct: 5 }));
  assert(C._v76OnPurchase_('X3', 'Говядина', 'кг', 470, 1, 'Фермер', {}) === null, '+4,4 % при ориентире 5 % — без уведомления');
  assert(C._v76OnPurchase_('X4', 'Говядина', 'кг', 500, 1, 'Фермер', {}) !== null, '+6,4 % к 470 — уведомление');
  ok(R('v73SetTargets', { priceRisePct: '' }));
});

t('ошибка пересчёта не мешает приёмке', () => {
  world(); const keep = C._v76OnPurchase_; C._v76OnPurchase_ = () => { throw new Error('сбой'); };
  const id = C._createBatch_('Говядина', 'г', 1000, new Date(2026, 10, 14), '', 0.5, 'Приход', {});
  C._v76OnPurchase_ = keep;
  assert(sheets['Склад_Партии'].data.some(r => r[0] === id), 'партия создана');
});

console.log('Все проверки этапа 6 пройдены: ' + n);
