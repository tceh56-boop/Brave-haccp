/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
// «ЦЕХ Финансы и Экономика», этап 1 — исправления экономического ядра V64:
//   акты списания, списания вручную и по сроку, ревизии попадают в экономику по цене партий; единое правило цены расхода;
//   постоянный ID продажи и перенос старых снимков; исправления журнала продаж; один расчёт выручки; закрытый период;
//   защита от повторной записи продажи. Настоящий код .gs, имитация таблиц.
// Запуск: node tests/finance_stage1.test.js
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
  _bkHex_: b => b.map(x => ((x < 0 ? x + 256 : x).toString(16)).padStart(2, '0')).join(''), _mcTimeStr_: x => String(x), MC_RB_TECH_: 'тех', JOURNALS: [] });
G.Utilities.formatDate = (d, tz, f) => { const x = new Date(d), p = v => String(v).padStart(2, '0'); return f.replace('yyyy', x.getFullYear()).replace('MM', p(x.getMonth() + 1)).replace('dd', p(x.getDate())).replace('HH', p(x.getHours())).replace('mm', p(x.getMinutes())).replace('ss', p(x.getSeconds())); };
const ctx = vm.createContext(G);
const code = fs.readFileSync(path.join(app, 'Code.gs'), 'utf8'), legacy = fs.readFileSync(path.join(app, 'MonChef_LegacyBack.gs'), 'utf8');
const fn = (src, name) => { const i = src.indexOf('function ' + name + '('); assert(i >= 0, name); let d = 0, j = src.indexOf('{', i); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(i, j + 1); };
vm.runInContext(['_toBaseUnitServer_', '_parseDate_', '_parseDateStr_', 'getSalesStats', '_mcFinClosedForJournalRow_'].map(x => fn(code, x)).join('\n'), ctx);
vm.runInContext(fn(legacy, '_mcSaleDuplicate_'), ctx);
['MonChef_V64_EconomyFlow.gs', 'MonChef_V64_Finance.gs'].forEach(f => vm.runInContext(fs.readFileSync(path.join(app, f), 'utf8'), ctx, { filename: f }));
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
const lines = (from, to) => C._v64Build_(C._v64Range_(from || '2026-11-01', to || '2026-11-30')).lines;

console.log('finance_stage1:');

t('Акт списания (питание персонала) попадает в потери по цене списанных партий; остаток без партии — по средней цене с признаком', () => {
  reset();
  const done = [{ name: 'Говядина', qty: 3, unit: 'кг', price: 500, sum: 1500, batches: [{ batchId: 'B1', qty: 1, unit: 'кг' }, { batchId: 'B2', qty: 1.5, unit: 'кг' }] }];
  table('Акты_Списания', ['Акт', 'Дата', 'Причина (код)', 'Причина', 'Комментарий', 'Строк', 'Сумма, ₽', 'Составил', 'Роль', 'Строки акта (JSON)', 'Списано со склада (JSON)', 'OperationID'],
    [['АС-20261110-001', new Date(2026, 10, 10, 12), 'STAFF', 'Питание персонала', 'обед', 1, 1500, 'Шеф', 'Шеф-повар', '[]', JSON.stringify(done), 'OP-A']]);
  const L = lines().filter(l => l.source === 'Акты_Списания');
  assert.strictEqual(L.length, 3);
  eq(L.map(l => l.amount), [400, 900, 250]);   // 1 кг × 400, 1,5 кг × 600, 0,5 кг × 500 (средняя)
  assert(L.every(l => l.stage === 'WASTE' && l.dir === 'OUT' && l.reason === 'STAFF'));
  eq(L[2].flags, ['NO_BATCH', 'AVG_PRICE']); assert.strictEqual(L[2].trace, 'REVIEW');
  const T = C._v64Totals_(lines());
  assert.strictEqual(T.wasteCost, 1550); assert.strictEqual(T.wasteByReason.STAFF, 1550);
});

t('Списание вручную и по сроку: с партиями из связей — по цене партии; старые записи без партий — по журналу склада с признаком', () => {
  reset();
  table('Склад_Операции', ['ID', 'Дата', 'Тип', 'Продукт', 'Кол-во', 'Ед.изм', 'Цена за ед.', 'Сумма', 'Источник', 'Комментарий', 'Создано'], [
    ['OPa', new Date(2026, 10, 3), 'Списание', 'Говядина', 2, 'кг', 500, 1000, 'Вручную', 'порча (до этапа 1)', ''],
    ['OPb', new Date(2026, 10, 4), 'Списание', 'Говядина', 2, 'кг', 400, 800, 'Вручную', 'порча', ''],
    ['OPc', new Date(2026, 10, 5), 'Списание', 'Молоко', 3, 'л', 70, 210, 'Срок годности истёк', 'Партия M1', ''],
    ['OPd', new Date(2026, 10, 5), 'Списание', 'Говядина', 1, 'кг', 400, 400, 'Партия B1', 'брак', ''],   // путь партии — через события, здесь не дублируется
    ['OPe', new Date(2026, 10, 5), 'Расход', 'Говядина', 1, 'кг', 400, 400, 'Вручную', '', '']]);
  table('TRACE_LINKS', HTL, [['T1', 'BATCH', 'B2', 'СПИСАНА_ВРУЧНУЮ', 'STOCK_OP', 'OPb', 'OPb', '', '', 'Вручную', 2, 'кг', 'ACTIVE', '']]);
  const L = lines().filter(l => l.source === 'Склад_Операции' || l.objType === 'STOCK_OP');
  assert.strictEqual(L.length, 3);
  const a = L.find(l => l.objId === 'OPa'), b = L.find(l => l.objId === 'OPb'), c = L.find(l => l.objId === 'OPc');
  assert.strictEqual(a.amount, 1000); eq(a.flags, ['NO_BATCH', 'AVG_PRICE']); assert.strictEqual(a.reason, 'MANUAL');
  assert.strictEqual(b.amount, 1200); assert.strictEqual(b.batch, 'B2'); assert.strictEqual(b.trace, 'PASS');   // 2 кг × 600 по партии, а не 800 по журналу
  assert.strictEqual(c.amount, 210); assert.strictEqual(c.batch, 'M1'); assert.strictEqual(c.reason, 'EXPIRED');
});

t('Ревизия: недостача и излишек — этап «Инвентаризация» по цене партии; найденный излишек без партии не считается закупкой', () => {
  reset();
  table('Ревизии_Корректировки_V49', ['AdjustmentID', 'RevisionID', 'LineID', 'BatchID', 'Product', 'Unit', 'BeforeQty', 'AfterQty', 'DeltaQty', 'AdjustmentType', 'NewBatchID', 'FactID', 'CreatedAt', 'CreatedBy', 'Reason'], [
    ['ADJ1', 'REV1', 'L1', 'B2', 'Говядина', 'кг', 10, 9.5, -0.5, 'SHORTAGE', '', '', new Date(2026, 10, 20), 'Шеф', 'усушка'],
    ['ADJ2', 'REV1', 'L2', 'F1', 'Молоко', 'л', 0, 2, 2, 'EXCESS', 'F1', '', new Date(2026, 10, 20), 'Шеф', 'нашли'],
    ['ADJ3', 'REV1', 'L3', 'M1', 'Молоко', 'л', 20, 20, 0, 'MATCH', '', '', new Date(2026, 10, 20), 'Шеф', '']]);
  const all = lines(), L = all.filter(l => l.stage === 'INVENTORY');
  assert.strictEqual(L.length, 2);
  assert.strictEqual(L[0].dir, 'OUT'); assert.strictEqual(L[0].amount, 300);
  assert.strictEqual(L[1].dir, 'IN'); assert.strictEqual(L[1].amount, 160); assert(L[1].flags.includes('AVG_PRICE'));   // 2 л × 80 (средняя)
  assert(!all.some(l => l.stage === 'PURCHASE' && l.batch === 'F1'), 'излишек ревизии — не закупка');
  const T = C._v64Totals_(all);
  assert.strictEqual(T.inventoryShortage, 300); assert.strictEqual(T.inventorySurplus, 160);
  assert.strictEqual(T.contributionAfterLosses, C._v64R2_(T.grossContribution - T.wasteCost - T.defrostLoss - T.returnsCost - 300 + 160));
});

t('Единое правило цены расхода: по партиям, средняя — только для части без партии или без цены', () => {
  reset();
  let r = C._mcCostOfConsumed_('Говядина', 2, 'кг', [{ batchId: 'B1', qty: 1, unit: 'кг', price: 400 }, { batchId: 'B2', qty: 1000, unit: 'г', price: 0.6 }]);
  assert.strictEqual(r.total, 1000); assert.strictEqual(r.priceSource, 'BATCH'); assert.strictEqual(r.price, 500);
  r = C._mcCostOfConsumed_('Говядина', 2, 'кг', [{ batchId: 'B1', qty: 1, unit: 'кг', price: 400 }]);
  assert.strictEqual(r.total, 900); assert.strictEqual(r.priceSource, 'BATCH+AVG');
  r = C._mcCostOfConsumed_('Говядина', 1, 'кг', []);
  assert.strictEqual(r.total, 500); assert.strictEqual(r.priceSource, 'AVG');
});

const saleRow = (no, date, time, dish, qty, price, sum, entered, src) => [no, date, time, dish, qty, price, sum, 'Кассир Орлова', 'Администратор', '', 'Кассир Орлова', 'Администратор', entered, src || 'вручную', 'E2'];
t('Продажа: постоянный ID не зависит от номера строки; SL-номер — главный; старый снимок «J36-строка» переносится', () => {
  reset();
  table('Ж_Продажи', HJ, [saleRow(1, '10.11.2026', '12:00', 'Борщ', 2, 300, 600, '10.11.2026 12:01:00'), saleRow(2, '10.11.2026', '13:00', 'Плов', 1, 450, 450, '10.11.2026 13:01:00', 'вручную · SL-20261110-ABCDEF12')]);
  const ids1 = C._mcSaleRows_().map(s => s.id);
  assert(/^J36-[0-9A-F]{12}$/.test(ids1[0])); assert.strictEqual(ids1[1], 'SL-20261110-ABCDEF12');
  sheets['Ж_Продажи'].data.splice(1, 0, saleRow(0, '09.11.2026', '10:00', 'Чай', 1, 50, 50, '09.11.2026 10:00:30'));   // строка выше — номера строк сдвинулись
  C._v64Drop_();
  const rows2 = C._mcSaleRows_();
  eq(rows2.slice(1).map(s => s.id), ids1); assert.strictEqual(rows2[1].legacyId, 'J36-3');
  // снимок, сделанный до этапа 1 по номеру строки, находится и переносится на постоянный ID
  reset();
  table('Ж_Продажи', HJ, [saleRow(1, '10.11.2026', '12:00', 'Борщ', 2, 300, 600, '10.11.2026 12:01:00')]);
  table('Финансы_Снимки', C.MC_V64_SNAP_HEAD, [['SNAP-SALE-old', 'SALE_COST_SNAPSHOT', 'J36-2', '', '', 0, 2, 'порц.', 0, '{}', 'h', new Date(), 'Шеф', 'OP0']]);
  const id = C._mcSaleRows_()[0].id, made = C._v64Snapshots_(lines(), { id: 'OP2', session });
  const snap = sheets['Финансы_Снимки'].data.find(r => r[2] === id);
  assert(snap, 'снимок перенесён на постоянный ID'); assert(JSON.parse(snap[9]).migratedFrom === 'SNAP-SALE-old'); assert(made >= 1); assert.strictEqual(sheets['Финансы_Снимки'].data.filter(r => r[2] === id).length, 1, 'одна запись снимка продажи');
});

t('Утверждённое исправление журнала продаж меняет выручку в экономике и в статистике одинаково', () => {
  reset();
  table('Ж_Продажи', HJ, [saleRow(1, '10.11.2026', '12:00', 'Борщ', 2, 300, 600, '10.11.2026 12:01:00'), saleRow(2, '11.11.2026', '12:00', 'Плов', 1, 450, '', '11.11.2026 12:01:00')]);
  table('Корректировки', HCORR, [['C1', 'J36', 'Журнал продаж', '', '', 2, '[]', JSON.stringify({ 'Количество': 3 }), 'ошибка', 'E1', 'X', 'Y', new Date(), 'APPROVED', '', '', '', ''],
    ['C2', 'J36', 'Журнал продаж', '', '', 3, '[]', JSON.stringify({ 'Количество': 9 }), 'ошибка', 'E1', 'X', 'Y', new Date(), 'OPEN', '', '', '', '']]);
  const S = lines().filter(l => l.stage === 'SALE' && l.dir === 'IN');
  eq(S.map(l => l.amount), [900, 450]);   // 3 × 300 по исправлению; открытое исправление не действует
  assert(S[0].flags.includes('JOURNAL_CORRECTED'));
  const st = JSON.parse(C.getSalesStats('01.11.2026', '30.11.2026'));
  assert.strictEqual(st.totalSum, 1350); assert.strictEqual(st.count, 2);
  assert.strictEqual(st.totalSum, C._v64Totals_(lines()).revenue, 'один расчёт выручки');
});

t('Закрытый период: сегодня не закрывается; исправление журнала продаж в закрытом периоде запрещено', () => {
  reset();
  const today = C._v64Day_(new Date());
  let r = JSON.parse(C.v64ClosePeriod(JSON.stringify({ from: today, to: today }), 'tok'));
  assert.strictEqual(r.success, false); assert(/до сегодняшнего дня/.test(r.error.message));
  table('Финансы_ЗакрытиеПериода', C.MC_V64F.CLOSE[1], [['PER-1', new Date(2026, 9, 1), new Date(2026, 9, 31), 'CLOSED']]);
  C._v64Drop_();
  const j = { id: 'J36', columns: HJ.slice(0, 10) };
  assert(/закрыт/.test(C._mcFinClosedForJournalRow_(j, [1, '15.10.2026', '12:00', 'Борщ', 1, 300, 300])));
  assert.strictEqual(C._mcFinClosedForJournalRow_(j, [1, '15.11.2026', '12:00', 'Борщ', 1, 300, 300]), '');
  assert.strictEqual(C._mcFinClosedForJournalRow_({ id: 'J1', columns: ['Дата'] }, ['15.10.2026']), '', 'другие журналы не затрагиваются');
});

t('Повтор ручной продажи: тот же запрос — та же запись; такая же продажа за 2 минуты — предупреждение', () => {
  reset();
  const p2 = n => String(n).padStart(2, '0'), now = new Date(), ent = p2(now.getDate()) + '.' + p2(now.getMonth() + 1) + '.' + now.getFullYear() + ' ' + p2(now.getHours()) + ':' + p2(now.getMinutes()) + ':' + p2(now.getSeconds());
  const day = p2(now.getDate()) + '.' + p2(now.getMonth() + 1) + '.' + now.getFullYear();
  const sh = table('Ж_Продажи', HJ, [saleRow(1, day, '12:00', 'Борщ', 2, 300, 600, ent, 'вручную · SL-20261114-AAAAAAAA · req:rq1')]);
  const j = { columns: HJ.slice(0, 10) }, p = { date: day, time: '12:00', dish: 'Борщ', qty: 2, price: 300, seller: 'Кассир Орлова' };
  const same = C._mcSaleDuplicate_(sh, j, 'rq1', p);
  assert(same.same); assert.strictEqual(same.saleId, 'SL-20261114-AAAAAAAA'); assert.strictEqual(same.row, 2);
  const sim = C._mcSaleDuplicate_(sh, j, 'rq2', p);
  assert(sim.similar && !sim.same);
  assert.strictEqual(C._mcSaleDuplicate_(sh, j, 'rq2', Object.assign({}, p, { qty: 3 })), null, 'другое количество — новая продажа');
  sh.data[1][12] = '01.01.2026 10:00:00';
  assert.strictEqual(C._mcSaleDuplicate_(sh, j, 'rq3', p), null, 'давно внесённая — не повтор');
});

t('Сводка руководителя и отчёт о потерях собираются с новыми этапами без ошибок', () => {
  reset();
  table('Ж_Продажи', HJ, [saleRow(1, '10.11.2026', '12:00', 'Борщ', 2, 300, 600, '10.11.2026 12:01:00'), saleRow(2, '10.11.2026', '13:00', 'Плов', 1, '', '', '10.11.2026 13:01:00', 'вручную · SL-20261110-ABCDEF12')]);
  table('Продажи_Списание_V71', ['SaleID', 'Ед.', 'Не хватило (JSON)'], [['SL-20261110-ABCDEF12', 'порц.', '[]']]);
  table('TRACE_LINKS', HTL, [['T9', 'BATCH', 'B1', 'РЕАЛИЗОВАНА_В', 'SALE', 'SL-20261110-ABCDEF12', '', '', '', '', 0.3, 'кг', 'ACTIVE', '']]);
  table('Ревизии_Корректировки_V49', ['AdjustmentID', 'RevisionID', 'LineID', 'BatchID', 'Product', 'Unit', 'BeforeQty', 'AfterQty', 'DeltaQty', 'AdjustmentType', 'NewBatchID', 'FactID', 'CreatedAt', 'CreatedBy', 'Reason'],
    [['ADJ1', 'REV1', 'L1', 'B2', 'Говядина', 'кг', 10, 9.5, -0.5, 'SHORTAGE', '', '', new Date(2026, 10, 20), 'Шеф', '']]);
  const d = J(C.v64GetDashboard('tok', '2026-11-01', '2026-11-30'));
  assert.strictEqual(d.totals.revenue, 600); assert.strictEqual(d.totals.inventoryShortage, 300); assert.strictEqual(d.totals.missingSalePrice, 1);
  const sale = lines().find(l => l.stage === 'SALE' && l.dir === 'OUT' && l.batch === 'B1');
  assert.strictEqual(sale.objId, 'SL-20261110-ABCDEF12'); assert.strictEqual(sale.amount, 120);
});

console.log('finance_stage1: ' + n + ' сценариев пройдено');
