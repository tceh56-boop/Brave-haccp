/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
// «ЦЕХ Финансы и Экономика», этап 5 — деньги (MonChef_V75_Cash.gs): счета, движения, загрузка банковской выписки
//   (1С и CSV) без дублей, разнесение по статьям ДДС и правила, переводы, Cash Flow, долги поставщикам, сводка руководителя.
//   Настоящий код .gs, имитация таблиц.
// Запуск: node tests/finance_stage5.test.js
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
vm.runInContext(['_toBaseUnitServer_', '_parseDate_', '_parseDateStr_', 'getSalesStats', '_mcFinClosedForJournalRow_'].map(x => fn(code, x)).join('\n'), ctx);
vm.runInContext(fn(legacy, '_mcSaleDuplicate_'), ctx);
['MonChef_V64_EconomyFlow.gs', 'MonChef_V64_Finance.gs', 'MonChef_V72_FinRegistry.gs', 'MonChef_V73_PnL.gs', 'MonChef_V74_Labor.gs', 'MonChef_V75_Cash.gs'].forEach(f => vm.runInContext(fs.readFileSync(path.join(app, f), 'utf8'), ctx, { filename: f }));
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
const ACC = '40702810900000012345';
const doc = (no, date, sum, dir, who, inn, purpose) => ['СекцияДокумент=Платежное поручение', 'Номер=' + no, 'Дата=' + date, 'Сумма=' + sum,
  'ПлательщикСчет=' + (dir === 'OUT' ? ACC : '40702810000000099999'), 'Плательщик1=' + (dir === 'OUT' ? 'ООО Цех' : who), 'ПлательщикИНН=' + (dir === 'OUT' ? '6600000000' : inn),
  'ПолучательСчет=' + (dir === 'IN' ? ACC : '40702810000000088888'), 'Получатель1=' + (dir === 'IN' ? 'ООО Цех' : who), 'ПолучательИНН=' + (dir === 'IN' ? '6600000000' : inn),
  (dir === 'IN' ? 'ДатаПоступило=' : 'ДатаСписано=') + date, 'НазначениеПлатежа=' + purpose, 'КонецДокумента'].join('\r\n');
const stmt = (from, to, open, close, docs) => ['1CClientBankExchange', 'ВерсияФормата=1.03', 'Кодировка=Windows', 'ДатаНачала=' + from, 'ДатаКонца=' + to, 'РасчСчет=' + ACC,
  'СекцияРасчСчет', 'ДатаНачала=' + from, 'ДатаКонца=' + to, 'РасчСчет=' + ACC, 'НачальныйОстаток=' + open, 'КонечныйОстаток=' + close, 'КонецРасчСчет'].concat(docs).concat(['КонецФайла']).join('\r\n');
const D1 = [doc('101', '03.11.2026', '5000.00', 'OUT', 'ООО Мясо', '7701234567', 'Оплата по накл. 11 за мясо'),
  doc('7', '04.11.2026', '12500.50', 'IN', 'ПАО Банк', '7700000001', 'Возмещение по операциям с банковскими картами за 03.11.2026'),
  doc('102', '05.11.2026', '350.00', 'OUT', 'ПАО Банк', '7700000001', 'Комиссия за обслуживание счета'),
  doc('103', '06.11.2026', '2000.00', 'OUT', 'ИП Сидоров', '660011223344', 'Оплата за ремонт вытяжки')];
const S1 = stmt('01.11.2026', '06.11.2026', '10000.00', '15150.50', D1);
const moves = () => C._v75Moves_();
function cash() { base(); }

console.log('finance_stage5:');

t('Выписка 1С: счёт заводится с остатком из выписки, статьи по поставщику и назначению, неизвестное — «Не разнесено», остаток сходится', () => {
  cash();
  const r = ok(R('v75ImportStatement', { text: S1, fileName: 'kl_to_1c.txt' }));
  assert(r.accountCreated); assert.strictEqual(r.format, '1C'); assert.strictEqual(r.added, 4); assert.strictEqual(r.uncategorized, 1);
  assert(r.check.ok, JSON.stringify(r.check)); assert.strictEqual(r.check.computedClosing, 15150.5);
  const M = moves(), by = no => M.find(m => m.doc === no);
  assert.strictEqual(by('101').category, 'Оплата поставщикам продуктов'); assert.strictEqual(by('101').dir, 'OUT');
  assert.strictEqual(by('7').category, 'Выручка: эквайринг (карты)'); assert.strictEqual(by('7').dir, 'IN'); assert.strictEqual(by('7').amount, 12500.5);
  assert.strictEqual(by('102').category, 'Банковская комиссия'); assert.strictEqual(by('103').category, 'Не разнесено');
});

t('Повторная и пересекающаяся выписка: повторы пропускаются, добавляются только новые операции', () => {
  cash(); ok(R('v75ImportStatement', { text: S1 }));
  let r = ok(R('v75ImportStatement', { text: S1 })); assert.strictEqual(r.added, 0); assert.strictEqual(r.duplicates, 4); assert(r.check.ok);
  const S2 = stmt('05.11.2026', '07.11.2026', '15500.50', '14650.50', [D1[2], D1[3], doc('104', '07.11.2026', '500.00', 'OUT', 'ООО Мясо', '7701234567', 'Оплата по накл. 12')]);
  r = ok(R('v75ImportStatement', { text: S2 })); assert.strictEqual(r.added, 1); assert.strictEqual(r.duplicates, 2); assert(r.check.ok, JSON.stringify(r.check));
  assert.strictEqual(moves().length, 5); assert.strictEqual(sheets['ДС_Импорт'].data.length, 4);
});

t('CSV из интернет-банка: колонки «Приход / Расход» и сумма со знаком; без даты или суммы — в ошибках', () => {
  cash();
  const a = ok(R('v75SaveAccount', { name: 'Тинькофф', type: 'BANK', bankAccount: '40702810100000000001', openingBalance: 1000, openingDate: '2026-11-01' }));
  let r = ok(R('v75ImportStatement', { accountId: a.accountId, fileName: 'op.csv', text: 'Дата операции;Приход;Расход;Контрагент;ИНН контрагента;Назначение платежа;Номер\n10.11.2026;3 000,00;;ООО Банкет;6601010101;Оплата банкета по договору 5;1\n11.11.2026;;800,00;ООО Мясо;7701234567;Оплата накладной 12;2\n;;;;;;' }));
  assert.strictEqual(r.added, 2); assert.strictEqual(r.errors.length, 1);
  assert.strictEqual(moves().find(m => m.doc === '2').category, 'Оплата поставщикам продуктов');
  r = ok(R('v75ImportStatement', { accountId: a.accountId, text: 'Дата,Сумма,Описание\n12.11.2026,-150.5,Комиссия банка за перевод\n12.11.2026,200,Прочее поступление' }));
  assert.strictEqual(r.added, 2); const m = moves().filter(x => x.date && x.date.getDate() === 12);
  eq(m.map(x => x.dir).sort(), ['IN', 'OUT']); assert.strictEqual(m.find(x => x.dir === 'OUT').category, 'Банковская комиссия');
  assert.strictEqual(R('v75ImportStatement', { text: 'Дата,Сумма\n12.11.2026,100' }).success, false, 'CSV без номера счёта — нужно выбрать счёт');
});

t('Касса вручную: поступление, повтор — отказ, перевод (инкассация) — две записи и не входит в поступления; отмена перевода — обе', () => {
  cash(); ok(R('v75ImportStatement', { text: S1 }));
  const k = ok(R('v75SaveAccount', { name: 'Касса', type: 'CASH', openingBalance: 0, openingDate: '2026-11-01' }));
  assert.strictEqual(R('v75SaveAccount', { name: 'касса', type: 'CASH', openingBalance: 0, openingDate: '2026-11-01' }).error.code, 'DUPLICATE');
  ok(R('v75AddMove', { accountId: k.accountId, date: '2026-11-10', direction: 'IN', amount: 4000, category: 'Выручка: наличные', purpose: 'выручка за день' }));
  assert.strictEqual(R('v75AddMove', { accountId: k.accountId, date: '2026-11-10', direction: 'IN', amount: 4000, category: 'Выручка: наличные', purpose: 'выручка за день' }).error.code, 'DUPLICATE');
  assert.strictEqual(R('v75AddMove', { accountId: k.accountId, date: '2026-11-10', direction: 'OUT', amount: 10, category: 'Выручка: наличные' }).success, false, 'статья не для выплат');
  const bank = C._v75Accounts_().find(a => a.type === 'BANK');
  const tr = ok(R('v75AddMove', { accountId: k.accountId, toAccountId: bank.id, date: '2026-11-11', amount: 3000 }));
  const c = J(C.v75GetCash('tok', '2026-11-01', '2026-11-30')), kk = c.accounts.find(a => a.name === 'Касса');
  assert.strictEqual(kk.closing, 1000); assert.strictEqual(c.accounts.find(a => a.type === 'BANK').closing, 18150.5);
  assert.strictEqual(c.totals.inflow, 16500.5, 'перевод не входит в поступления'); assert.strictEqual(c.totals.closing, 19150.5);
  assert(c.flow.some(f => f.activity === 'TRANSFER' && f.inflow === 3000 && f.outflow === 3000));
  ok(R('v75CancelMove', { moveId: tr.moves[0], reason: 'ошибка' }));
  assert.strictEqual(moves().filter(m => m.transfer && m.status === 'CANCELLED').length, 2);
});

t('Разнесение: статья и «запомнить» — правило по ИНН, такие же неразнесённые разносятся, следующая выписка — по правилу', () => {
  cash(); ok(R('v75ImportStatement', { text: S1 }));
  const S3 = stmt('07.11.2026', '08.11.2026', '15150.50', '14150.50', [doc('105', '08.11.2026', '1000.00', 'OUT', 'ИП Сидоров', '660011223344', 'Оплата по счёту 7')]);
  ok(R('v75ImportStatement', { text: S3 }));
  const un = moves().filter(m => m.category === 'Не разнесено'); assert.strictEqual(un.length, 2);
  assert.strictEqual(R('v75SetCategory', { moveId: un[0].id, category: 'Выручка: наличные' }).success, false, 'статья для поступлений');
  const r = ok(R('v75SetCategory', { moveId: un[0].id, category: 'Прочие расходы', remember: true }));
  assert.strictEqual(r.alsoApplied, 1); assert(r.ruleId);
  assert.strictEqual(moves().filter(m => m.category === 'Не разнесено').length, 0);
  const S4 = stmt('09.11.2026', '09.11.2026', '14150.50', '13650.50', [doc('106', '09.11.2026', '500.00', 'OUT', 'ИП Сидоров', '660011223344', 'Оплата')]);
  assert.strictEqual(ok(R('v75ImportStatement', { text: S4 })).uncategorized, 0);
  assert.strictEqual(moves().find(m => m.doc === '106').category, 'Прочие расходы');
});

t('Cash Flow: по видам деятельности, выручка по продажам против поступлений, закрытый период не принимает движения', () => {
  cash(); ok(R('v75ImportStatement', { text: S1 })); sync();
  const c = J(C.v75GetCash('tok', '2026-11-01', '2026-11-30'));
  assert.strictEqual(c.totals.opening, 10000); assert.strictEqual(c.totals.inflow, 12500.5); assert.strictEqual(c.totals.outflow, 7350); assert.strictEqual(c.totals.closing, 15150.5);
  const oper = c.activities.find(a => a.activity === 'OPER'); assert.strictEqual(oper.inflow, 12500.5); assert.strictEqual(oper.outflow, 5350);
  assert(c.activities.some(a => a.activity === 'NONE' && a.outflow === 2000));
  assert.strictEqual(c.revenueVsCash.revenue, 1050); assert.strictEqual(c.revenueVsCash.cashRevenue, 12500.5);
  assert(c.warnings.some(w => w.code === 'UNCATEGORIZED'));
  table('Финансы_ЗакрытиеПериода', C.MC_V64F.CLOSE[1], [['PER-1', new Date(2026, 9, 1), new Date(2026, 9, 31), 'CLOSED']]); C._v64Drop_();
  const r = ok(R('v75ImportStatement', { text: stmt('30.10.2026', '10.11.2026', '0', '0', [doc('90', '30.10.2026', '100.00', 'OUT', 'X', '', 'старый платёж'), doc('91', '10.11.2026', '100.00', 'OUT', 'X', '', 'новый платёж')]) }));
  assert.strictEqual(r.closedSkipped, 1); assert.strictEqual(r.added, 1);
  const bank = C._v75Accounts_()[0];
  assert.strictEqual(R('v75AddMove', { accountId: bank.id, date: '2026-10-15', direction: 'OUT', amount: 10, category: 'Аренда' }).error.code, 'CLOSED_PERIOD');
});

t('Долги поставщикам: накладные приёмки − оплаты, оплата гасит самые старые накладные', () => {
  cash(); ok(R('v75ImportStatement', { text: S1 }));
  const c = J(C.v75GetCash('tok', '2026-11-01', '2026-11-30')), meat = c.payables.find(p => p.supplier === 'ООО Мясо'), milk = c.payables.find(p => p.supplier === 'Молзавод');
  assert.strictEqual(meat.invoiced, 10000); assert.strictEqual(meat.paid, 5000); assert.strictEqual(meat.debt, 5000);
  eq(meat.unpaid.map(u => [u.invoice, u.rest]), [['12', 5000]]);
  assert.strictEqual(milk.debt, 1400); assert.strictEqual(milk.paid, 0);
});

t('Реестр, дневные итоги и сводка руководителя: движения денег, остаток, долг поставщикам, сигналы', () => {
  cash(); ok(R('v75ImportStatement', { text: S1 })); sync();
  const keys = reg().map(x => x.RegKey); assert.strictEqual(keys.filter(k => /^CASH\|/.test(k)).length, 4);
  assert.strictEqual(dayRow('2026-11-04').cashIn, 12500.5); assert.strictEqual(dayRow('2026-11-03').cashOut, 5000); assert.strictEqual(dayRow('2026-11-06').cashUncat, 1);
  const D = J(C.v73GetCeoDashboard('tok', '2026-11-01', '2026-11-30'));
  assert.strictEqual(D.kpis.find(k => k.code === 'CASH_BALANCE').value, 15150.5);
  assert.strictEqual(D.kpis.find(k => k.code === 'SUPPLIER_DEBT').value, 6400);
  assert(D.signals.some(s => s.code === 'CASH_UNCATEGORIZED'));
  const P = J(C.v73GetPnL('tok', '2026-11-01', '2026-11-30')), T = C._v64Totals_(lines('2026-11-01', '2026-11-30'));
  assert.strictEqual(P.lines.find(l => l.code === 'REVENUE').amount, T.revenue, 'деньги не меняют P&L');
  assert(!P.lines.some(l => /Банковская комиссия/.test(l.title)), 'комиссия из выписки — не расход P&L без управленческого расхода');
});

console.log('finance_stage5: ' + n + ' сценариев пройдено');
