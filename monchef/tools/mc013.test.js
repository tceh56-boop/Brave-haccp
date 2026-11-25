// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
// MC-013: сквозная сверка экономики на контрольном блюде. Запуск: node monchef/tools/mc013.test.js
const assert = require('assert');
const { boot } = require('./gasemu');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e)); } }
const E = boot({ now: '2026-11-25T08:00:00Z' }), C = E.ctx, ss = E.ss; E.props[C.MC_MED_GATE_PROP_] = 'off';
const emp = ss.insertSheet('Сотрудники'); emp.appendRow(['Фамилия', 'Имя', 'Отчество', 'Должность', 'Роль', 'ДР', 'Телефон', 'Адрес', 'ПИН-код', '', '', '', 'Активен']);
[['Директорова', 'Анна', 'Директор', '1111'], ['Админов', 'Пётр', 'Администратор', '2222'], ['Официантов', 'Иван', 'Официант', '3333'], ['Шефов', 'Марк', 'Шеф-повар', '7777'], ['Холодов', 'Ян', 'Повар холодного цеха', '4444'], ['Барменов', 'Лев', 'Бармен', '8888']].forEach(r => emp.appendRow([r[0], r[1], '', r[2], r[2], '', '', '', r[3], '', '', '', true]));
const ds = ss.insertSheet('Блюда'); ds.appendRow(['Код', 'Название', 'Категория', 'Выход', '', 'Технология', '', '', 'Цех', '', '', '', 'Выход, г/мл/шт', 'Ед. выхода']);
ds.appendRow(['D002', 'Салат с тунцом', 'Салаты', 220, '', '', '', '', 'Холодный цех', '', '', '', 220, 'г']);
const so = ss.insertSheet('Состав'); so.appendRow(['Код', 'Продукт', '', '', 'Брутто', 'Нетто', 'Выход', 'Ед.']); [['D002', 'Тунец', 80], ['D002', 'Салат микс', 60]].forEach(r => so.appendRow([r[0], r[1], '', '', r[2], r[2], r[2], 'г']));
const pr = ss.insertSheet('Цены_Меню'); pr.appendRow(['PriceID', 'DishCode', 'DishName', 'Price', 'Unit', 'Source', 'EventID', 'DateFrom', 'DateTo', 'Status']); pr.appendRow(['P2', 'D002', '', 790, 'порц.', 'MENU', '', '2026-11-01', '', 'ACTIVE']);
const tv = ss.insertSheet('ТТК_Версии'); tv.appendRow(['Код блюда', 'Версия', 'Статус']); tv.appendRow(['D002', 1, 'действующая']);
C._withLock_(() => C._incomeWithBatches_([{ name: 'Тунец', qty: 200, unit: 'г', price: 1.5, expiry: '2026-11-28' }, { name: 'Салат микс', qty: 1000, unit: 'г', price: 0.5, expiry: '2026-11-29' }], 'Поставщик', '', null)); E.setNow('2026-11-25T08:05:00Z');
C._withLock_(() => C._incomeWithBatches_([{ name: 'Тунец', qty: 1000, unit: 'г', price: 2.0, expiry: '2026-12-05' }], 'Поставщик', '', null)); E.setNow('2026-11-25T08:10:00Z');
(() => { const sh = ss.getSheetByName('Склад_Партии'), n = sh.getLastRow(); for (let i = 2; i <= n; i++) sh.getRange(i, 11).setValue('active'); })();
const J = s => JSON.parse(s), tok = p => J(C.loginWithPin(p, 'd' + p)).token, DIR = tok('1111'), ADM = tok('2222'), WAI = tok('3333'), CHEF = tok('7777'), COOK = tok('4444'), BARM = tok('8888');
let k = 0; const key = () => 'econ-key-' + (++k); const drop = () => { C._mcRcDrop_(); C._BOOK_CACHE_ = null; };
const call = (fn, t, d) => { drop(); const r = J(C[fn](JSON.stringify(d), t)); if (!r.success) throw new Error(fn + JSON.stringify(r)); return r.data; };
const hall = call('rsHallSave', ADM, { idem: key(), name: 'Зал', width: 4, height: 4 }), t1 = call('rsTableSave', ADM, { idem: key(), hallId: hall.id, number: '1', x: 0, y: 0, seatsMax: 4 });
function rsSale(qty, tblNo) {
  const t = call('rsTableSave', ADM, { idem: key(), hallId: hall.id, number: String(10 + tblNo), x: tblNo, y: 1, seatsMax: 4 });
  const o = call('rsOrderOpen', WAI, { idem: key(), tableId: t.id, guests: 2 }).orderId;
  call('rsItemAdd', WAI, { idem: key(), orderId: o, items: [{ code: 'D002', qty: qty }] }); call('rsOrderSend', WAI, { idem: key(), orderId: o, mode: 'all' });
  let tk = call('rsKdsData', CHEF, { dept: 'KITCHEN' }).tickets.find(x => x.orderId === o && x.status === 'NEW'); tk = call('rsTicketAct', CHEF, { idem: key(), ticketId: tk.id, version: tk.version, action: 'start' }).ticket; call('rsTicketAct', CHEF, { idem: key(), ticketId: tk.id, version: tk.version, action: 'ready' });
  let od = call('rsOrderGet', WAI, { id: o }); call('rsItemServe', WAI, { idem: key(), orderId: o, itemIds: od.items.map(x => x.id) }); call('rsBillSplit', WAI, { idem: key(), orderId: o, mode: 'one' });
  const b = call('rsOrderGet', ADM, { id: o }).bills[0]; call('rsBillPay', ADM, { idem: key(), billId: b.id, version: b.version, method: 'CARD', receipt: 'R' + tblNo, amountKop: b.totalKop });
  call('rsOrderClose', WAI, { idem: key(), orderId: o, version: call('rsOrderGet', ADM, { id: o }).version }); return { o, bill: b.id };
}

const ok = r => { r = J(r); assert.ok(r && (r.success || r.ok), JSON.stringify(r).slice(0, 300)); return r.data; };
const ECO = () => { drop(); return ok(C.v64GetDishEconomics('D002', '2026-11-01', '2026-11-30', DIR)); };
const step = (e, n) => e.steps.find(x => x.n === n).amount;
console.log('MC-013 · сквозная сверка экономики (контрольное блюдо «Салат с тунцом»)');
console.log('  ручной расчёт: тунец — партия А 200 г по 1,50, партия Б 1000 г по 2,00 (FEFO: сначала А); салат 0,50/г; 80 г тунца + 60 г салата на порцию;');
console.log('  упаковка 10 ₽/порц.; труд 6 мин × 600 ₽/ч = 60 ₽/порц.; цена 790 ₽');
drop(); ok(C.v64SavePackagingNorm(JSON.stringify({ dishCode: 'D002', kind: 'Упаковка', item: 'Салфетка', qtyPerPortion: 1, unitPrice: 10, dateFrom: '2026-11-01' }), DIR));
drop(); ok(C.v64SaveLaborRate(JSON.stringify({ kind: 'RATE', workshop: 'Холодный цех', ratePerHour: 600, dateFrom: '2026-11-01' }), DIR));
drop(); ok(C.v64SaveLaborRate(JSON.stringify({ kind: 'DISH_MINUTES', dishCode: 'D002', minutesPerPortion: 6, dateFrom: '2026-11-01' }), DIR));
let s1, s2, ms;
t('продажи в зале 2 + 3 порции и ручная продажа 1: себестоимость по партиям FEFO = 300 + 550 + 190 = 1040 ₽, выручка 4740 ₽, упаковка 60 ₽', () => {
  s1 = rsSale(2, 1); E.setNow('2026-11-25T09:00:00Z'); s2 = rsSale(3, 2); E.setNow('2026-11-25T10:00:00Z');
  drop(); ms = ok(C.mcSaleAdd(JSON.stringify({ dish: 'Салат с тунцом', qty: 1, price: 790 }), DIR)); assert.strictEqual(ms.stock.cost, 190);
  const e = ECO(); assert.strictEqual(step(e, 12), 1040); assert.strictEqual(step(e, 13), 4740); assert.strictEqual(step(e, 9), 60); assert.strictEqual(step(e, 15), 3640);
  assert.strictEqual(e.card.ingredients, 173.33); assert.ok(/поданных порций: 6/.test(e.card.ingredientsSource)); assert.strictEqual(e.card.directLabor, 60); assert.strictEqual(e.card.packaging, 10);
  assert.strictEqual(e.card.productCost, 243.33); assert.strictEqual(e.card.grossContribution, 546.67);
});
t('отменённая продажа (V95) исключена из выручки, себестоимости и упаковки; возврат по счёту зала уменьшает выручку, себестоимость и упаковка поданного остаются', () => {
  E.setNow('2026-11-25T11:00:00Z'); drop(); ok(C.v95SaleCancel(JSON.stringify({ saleId: ms.saleId, reason: 'пробита ошибочно', confirm: true }), DIR));
  E.setNow('2026-11-25T11:10:00Z'); drop(); const sr = ok(C.rsShiftReport(JSON.stringify({ date: '2026-11-25' }), DIR)); const bb = sr.closed.find(x => x.id === s2.o).bills[0];
  drop(); ok(C.rsBillRefund(JSON.stringify({ idem: key(), billId: bb.id, version: bb.version, reason: 'гостю не понравилось' }), DIR));
  const e = ECO(); assert.strictEqual(step(e, 13), 1580, 'выручка 4740 − 790 (отмена) − 2370 (возврат)'); assert.strictEqual(step(e, 12), 850, 'себестоимость 300 + 550'); assert.strictEqual(step(e, 9), 50, 'упаковка 5 поданных');
  assert.strictEqual(step(e, 15), 680); assert.strictEqual(e.servedQty, 5); assert.strictEqual(e.card.ingredients, 170);
  const ref = e.steps.find(x => x.n === 13).lines.find(l => (l.flags || []).indexOf('SALE_REFUND') >= 0 || /возврат по счёту/.test(l.note || '')); assert.ok(ref, 'строка возврата помечена');
});
t('управленческие расходы — отдельным слоем: аренда 1000 ₽ по утверждённому правилу «по выручке» целиком на единственное блюдо', () => {
  drop(); ok(C.v64SaveExpense(JSON.stringify({ category: C.MC_V64_EXP_CATS[0], amount: 1000, document: 'договор аренды № 5', date: '2026-11-25', periodFrom: '2026-11-01', periodTo: '2026-11-30' }), DIR));
  drop(); const r = ok(C.v64SaveAllocationRule(JSON.stringify({ category: C.MC_V64_EXP_CATS[0], base: 'REVENUE', dateFrom: '2026-11-01' }), DIR));
  drop(); ok(C.v64ApproveAllocationRule(r.ruleId, DIR));
  const e = ECO(); assert.strictEqual(step(e, 16), 1000); assert.strictEqual(step(e, 15), 680, 'валовой вклад не меняется — расходы отдельным слоем');
});
t('сверка экономики: журнал продаж = экономика, зал оплачено = проведено, себестоимость в момент продажи = в экономике; отмена и возврат учтены', () => {
  drop(); const c = ok(C.v102EconomyCheck(JSON.stringify({ from: '2026-11-01', to: '2026-11-30' }), DIR));
  assert.strictEqual(c.revenue.journal, 1580); assert.strictEqual(c.revenue.economy, 1580); assert.ok(c.ok, JSON.stringify(c.issues));
  assert.strictEqual(c.cancelled, 1); assert.strictEqual(c.refunds, 1); assert.ok(c.sales.every(x => x.diff === null || x.diff === 0), JSON.stringify(c.sales));
  assert.strictEqual(c.hall.paidKop, 395000); assert.strictEqual(c.hall.postedKop, 395000); assert.strictEqual(c.hall.refundsKop, -237000);
});
t('цена партии исправлена после продажи — сверка показывает расхождение с номером строки и причиной', () => {
  drop(); const sh = ss.getSheetByName('Склад_Партии'), v = sh.getDataRange().getValues(), h = v[0].map(String), pc = h.findIndex(x => /цена/i.test(x));
  const i = v.findIndex(r => r[1] === 'Тунец' && Number(r[pc]) === 1.5); sh.getRange(i + 1, pc + 1).setValue(1.6);
  drop(); const c = ok(C.v102EconomyCheck(JSON.stringify({ from: '2026-11-01', to: '2026-11-30' }), DIR));
  const w = c.issues.filter(x => x.kind === 'COST'); assert.ok(w.length >= 1 && /цена партии изменилась после продажи/.test(w[0].text), JSON.stringify(c.issues));
});
t('права: повар, бармен и официант не получают экономику и сверку; в их экранах нет себестоимости и маржи', () => {
  drop(); assert.ok(J(C.v64GetDishEconomics('D002', '2026-11-01', '2026-11-30', CHEF)).success, 'шеф-повар видит экономику (ТЗ §19)');
  [COOK, BARM, WAI].forEach(tk => { drop(); assert.ok(!J(C.v64GetDishEconomics('D002', '2026-11-01', '2026-11-30', tk)).success); drop(); assert.ok(!J(C.v102EconomyCheck('{}', tk)).success); });
  const leak = (x, path) => { if (x && typeof x === 'object') Object.keys(x).forEach(k => { if (/cost|себестоим|margin|foodcost|unitprice|закупочн/i.test(k) && typeof x[k] === 'number' && x[k] !== 0) throw new Error('финансовое поле ' + path + '.' + k); leak(x[k], path + '.' + k); }); };
  drop(); leak(J(C.rsMenuForOrder('{}', WAI)), 'rsMenuForOrder');
  drop(); leak(J(C.rsKdsData(JSON.stringify({ dept: 'KITCHEN' }), COOK)), 'rsKdsData');
  drop(); leak(J(C.rsBarRecipes('{}', BARM)), 'rsBarRecipes');
  drop(); leak(J(C.rsHallData(JSON.stringify({ date: '2026-11-25' }), WAI)), 'rsHallData');
  drop(); const sr = J(C.rsShiftReport(JSON.stringify({ date: '2026-11-25' }), ADM)).data; assert.ok(!sr.cost && sr.foodCostPct === undefined, 'администратор без права на финансы — без себестоимости');
  ['home', 'production', 'menu', 'stock'].forEach(sec => { drop(); try { leak(C.uiData(COOK, sec, {}), 'uiData.' + sec); } catch (e) { if (/финансовое поле/.test(e.message)) throw e; } });
});

console.log('\nИтого: ' + pass + ' пройдено, ' + fail + ' не пройдено');
process.exit(fail ? 1 : 0);
