// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
// Restaurant Service, этап 3: блокнот официанта — заказ, курсы, весовые позиции, счета, отправка. Сценарии ТЗ §16: 1, 2, 3, 4, 9.
// Запуск: node monchef/tools/rs_stage3.test.js
const assert = require('assert');
const { boot } = require('./gasemu');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e)); } }
const J = s => (typeof s === 'string' ? JSON.parse(s) : s);
let seq = 0; const key = () => 'st3-key-' + (++seq);

const E = boot({ now: '2026-11-25T08:00:00Z' }), C = E.ctx, ss = E.ss;
const emp = ss.insertSheet('Сотрудники');
emp.appendRow(['Фамилия', 'Имя', 'Отчество', 'Должность', 'Роль', 'ДР', 'Телефон', 'Адрес', 'ПИН-код', '', '', '', 'Активен']);
emp.appendRow(['Админов', 'Пётр', '', 'Администратор зала', 'Администратор', '', '', '', '2222', '', '', '', true]);
emp.appendRow(['Официантов', 'Иван', '', 'Официант', 'Официант', '', '', '', '3333', '', '', '', true]);
emp.appendRow(['Официантова', 'Мария', '', 'Официант', 'Официант', '', '', '', '5555', '', '', '', true]);
const ds = ss.insertSheet('Блюда');
ds.appendRow(['Код', 'Название', 'Категория', 'Выход', '', '', '', '', 'Цех', '', '', '', 'Выход, г/мл/шт', 'Ед. выхода']);
[['D001', 'Стейк рибай', 'Горячее', 'Горячий цех', 300, 'г'], ['D002', 'Сырная тарелка', 'Закуски', 'Холодный цех', 250, 'г'], ['D003', 'Цезарь', 'Салаты', 'Холодный цех', 220, 'г'],
 ['D004', 'Тирамису', 'Десерты', 'Кондитерский цех', 1, 'шт'], ['D005', 'Борщ', 'Супы', 'Горячий цех', 300, 'г'], ['B001', 'Негрони', 'Коктейли', 'Бар', 120, 'мл'], ['B002', 'Капучино', 'Кофе', 'Бар', 250, 'мл'],
 ['D009', 'Без ТТК', 'Горячее', 'Горячий цех', 1, 'шт'], ['D010', 'Креветки', 'Горячее', 'Горячий цех', '', '']]
  .forEach(r => ds.appendRow([r[0], r[1], r[2], '', '', '', '', '', r[3], '', '', '', r[4], r[5]]));
const pr = ss.insertSheet('Цены_Меню');
pr.appendRow(['PriceID', 'DishCode', 'DishName', 'Price', 'Unit', 'Source', 'EventID', 'DateFrom', 'DateTo', 'Status', 'CreatedAt', 'CreatedBy', 'Comment', 'OperationID']);
[['P1', 'D001', 1500, '100 г'], ['P2', 'D002', 890, 'порц.'], ['P3', 'D003', 650, 'порц.'], ['P4', 'D004', 450, 'шт'], ['P5', 'D005', 390, 'порц.'], ['P6', 'B001', 700, 'порц.'], ['P7', 'B002', 250, 'порц.'], ['P9', 'D009', 100, 'порц.'], ['P10', 'D010', 3200, 'кг']]
  .forEach(r => pr.appendRow([r[0], r[1], '', r[2], r[3], 'MENU', '', new Date('2026-11-01'), '', 'ACTIVE', '', '', '', '']));
const tv = ss.insertSheet('ТТК_Версии');
tv.appendRow(['Код блюда', 'Версия', 'Статус', 'Название', 'Выход', 'Технология', 'Состав(JSON)', 'operation_id', 'Автор', 'Создано']);
['D001', 'D002', 'D003', 'D004', 'D005', 'B001', 'B002'].forEach(c => tv.appendRow([c, 2, 'действующая', '', '', '', '[]', '', '', '']));
tv.appendRow(['D001', 3, 'черновик', '', '', '', '[]', '', '', '']);

const login = pin => J(C.loginWithPin(pin, 'dev-' + pin)).token;
const ADM = login('2222'), WAI = login('3333'), WAI2 = login('5555');
// каждый вызов — новое выполнение Apps Script: кэш чтения таблицы живёт одно выполнение
const call = (fn, tok, d) => { C._mcRcDrop_(); C._BOOK_CACHE_ = null; return J(C[fn](JSON.stringify(d || {}), tok)); };
const ok = r => { assert.strictEqual(r.success, true, JSON.stringify(r)); return r.data; };
const err = (r, code) => { assert.notStrictEqual(r.success, true, 'ожидался отказ: ' + JSON.stringify(r)); if (code) assert.strictEqual(r.error && r.error.code, code, JSON.stringify(r)); return r; };
const hall = ok(call('rsHallSave', ADM, { idem: key(), name: 'Основной зал', width: 10, height: 6 }));
const T = {}; ['10', '11', '12', '14'].forEach((n, i) => { T[n] = ok(call('rsTableSave', ADM, { idem: key(), hallId: hall.id, number: n, seatsMax: 6, x: i * 2, y: 1 })); });
const get = (tok, id) => ok(call('rsOrderGet', tok, { id }));

console.log('Restaurant Service — этап 3');
let o12;
t('сценарий 1: стол 12, четыре блюда, отправка — один OrderID, 4 позиции, задания по цехам, кухня видит стол', () => {
  o12 = ok(call('rsOrderOpen', WAI, { idem: key(), tableId: T['12'].id, guests: 2 })).orderId;
  ok(call('rsItemAdd', WAI, { idem: key(), orderId: o12, items: [{ code: 'D002' }, { code: 'D003' }, { code: 'D005' }, { code: 'B001', qty: 2 }] }));
  const s = ok(call('rsOrderSend', WAI, { idem: key(), orderId: o12, mode: 'all' }));
  assert.strictEqual(s.sent, 4); assert.strictEqual(s.kitchen, 3); assert.strictEqual(s.bar, 1);
  const q = ss.getSheetByName('ОчередьПроизводства_V1').getDataRange().getValues(), h = q[0];
  const rows = q.slice(1).filter(r => r[h.indexOf('OrderID')] === o12);
  assert.strictEqual(rows.length, 4);
  assert.ok(rows.every(r => r[h.indexOf('Стол')] === '12'));
  assert.deepStrictEqual(rows.map(r => r[h.indexOf('Цех')]).sort(), ['Бар', 'Горячий цех', 'Холодный цех', 'Холодный цех']);
  assert.ok(rows.every(r => r[h.indexOf('TTKVersion')] === 2), 'действующая версия ТТК, а не черновик');
  const o = get(WAI, o12); assert.strictEqual(o.items.length, 4); assert.ok(o.items.every(x => x.status === 'SENT'));
  assert.strictEqual(o.totalKop, 89000 + 65000 + 39000 + 140000);
  const plan = ok(call('rsHallData', WAI, { date: '2026-11-25', time: '13:00' })).tables.find(x => x.id === T['12'].id);
  assert.strictEqual(plan.state, 'order'); assert.strictEqual(plan.order.waiting, 4);
});
t('один открытый заказ на стол', () => { err(call('rsOrderOpen', WAI2, { idem: key(), tableId: T['12'].id, guests: 2 }), 'CONFLICT'); });
t('сценарий 9: повтор отправки с тем же ключом после обрыва — дублей нет', () => {
  const k = key();
  ok(call('rsItemAdd', WAI, { idem: key(), orderId: o12, items: [{ code: 'B002' }] }));
  const a = ok(call('rsOrderSend', WAI, { idem: k, orderId: o12, mode: 'all' }));
  err(call('rsHallSave', ADM, { idem: key(), name: '' }));   // другое действие между повторами — кэш шлюза не перехватывает
  ok(call('rsHallData', WAI, {}));
  call('rsItemAdd', WAI, { idem: key(), orderId: o12, items: [] });
  const b = ok(call('rsOrderSend', WAI, { idem: k, orderId: o12, mode: 'all' }));
  assert.deepStrictEqual(a, b);
  const q = ss.getSheetByName('ОчередьПроизводства_V1').getDataRange().getValues().slice(1).filter(r => r[2] === o12);
  assert.strictEqual(q.length, 5);
  err(call('rsOrderSend', WAI, { idem: key(), orderId: o12, mode: 'all' }), 'VALIDATION');   // новый ключ — отправлять нечего
});
t('чужой заказ: другой официант не меняет; администратор — может', () => {
  err(call('rsItemAdd', WAI2, { idem: key(), orderId: o12, items: [{ code: 'D004' }] }), 'FORBIDDEN');
  ok(call('rsItemAdd', ADM, { idem: key(), orderId: o12, items: [{ code: 'D004' }] }));
});

let o10;
t('сценарий 2: три курса — отправлен первый, второй и третий ждут; «Следующий курс» запускает второй', () => {
  o10 = ok(call('rsOrderOpen', WAI, { idem: key(), tableId: T['10'].id, guests: 3 })).orderId;
  ok(call('rsItemAdd', WAI, { idem: key(), orderId: o10, items: [{ code: 'D002', course: 1 }, { code: 'D005', course: 2 }, { code: 'D003', course: 3 }, { code: 'D004', course: 3 }] }));
  const s = ok(call('rsOrderSend', WAI, { idem: key(), orderId: o10, mode: 'all' }));
  assert.deepStrictEqual(s.firedCourses, [1]); assert.strictEqual(s.waiting, 3);
  const st = () => { const q = ss.getSheetByName('ОчередьПроизводства_V1').getDataRange().getValues(), h = q[0]; return q.slice(1).filter(r => r[2] === o10).map(r => r[h.indexOf('Курс')] + ':' + r[h.indexOf('Статус')]).sort(); };
  assert.deepStrictEqual(st(), ['1:NEW', '2:WAIT_COURSE', '3:WAIT_COURSE', '3:WAIT_COURSE']);
  ok(call('rsCourseFire', WAI, { idem: key(), orderId: o10, course: 2 }));
  assert.deepStrictEqual(st(), ['1:NEW', '2:NEW', '3:WAIT_COURSE', '3:WAIT_COURSE']);
  err(call('rsCourseFire', WAI, { idem: key(), orderId: o10, course: 2 }), 'VALIDATION');
  ok(call('rsCourseHold', WAI, { idem: key(), orderId: o10, course: 2 }));
  assert.deepStrictEqual(st(), ['1:NEW', '2:WAIT_COURSE', '3:WAIT_COURSE', '3:WAIT_COURSE']);
  const o = get(WAI, o10); assert.strictEqual(o.items.filter(x => x.status === 'WAIT_COURSE').length, 3);
});
t('отправка только одного курса и выбранных позиций', () => {
  ok(call('rsItemAdd', WAI, { idem: key(), orderId: o10, items: [{ code: 'B002' }, { code: 'B001', course: 4 }] }));
  const o = get(WAI, o10), cap = o.items.find(x => x.code === 'B002' && x.status === 'DRAFT');
  const s = ok(call('rsOrderSend', WAI, { idem: key(), orderId: o10, mode: 'items', itemIds: [cap.id] }));
  assert.strictEqual(s.sent, 1); assert.strictEqual(s.waiting, 0);
  const s2 = ok(call('rsOrderSend', WAI, { idem: key(), orderId: o10, mode: 'course', course: 4 }));
  assert.deepStrictEqual(s2.firedCourses, [4]);
});

let o11, steak;
t('сценарий 3: стейк — план 300 г, факт 340 г, пересчёт по цене за 100 г', () => {
  o11 = ok(call('rsOrderOpen', WAI, { idem: key(), tableId: T['11'].id, guests: 4 })).orderId;
  const r = ok(call('rsItemAdd', WAI, { idem: key(), orderId: o11, items: [{ code: 'D001', amount: 300, guest: 1 }] }));
  steak = r.items[0];
  assert.strictEqual(steak.weighted, true); assert.strictEqual(steak.unit, 'г'); assert.strictEqual(steak.planKop, 450000);
  const w = ok(call('rsItemWeight', WAI, { idem: key(), itemId: steak.id, version: steak.version, amount: 340 })).item;
  assert.strictEqual(w.factAmount, 340); assert.strictEqual(w.factKop, 510000); assert.strictEqual(w.planAmount, 300);
  steak = w;
});
t('весовое блюдо без веса — отказ; цена за кг считается так же', () => {
  err(call('rsItemAdd', WAI, { idem: key(), orderId: o11, items: [{ code: 'D010' }] }), 'VALIDATION');
  const it = ok(call('rsItemAdd', WAI, { idem: key(), orderId: o11, items: [{ code: 'D010', amount: 250 }] })).items[0];
  assert.strictEqual(it.planKop, 80000);
  ok(call('rsItemCancel', WAI, { idem: key(), itemId: it.id, version: it.version }));
});
t('отправка проверяет ТТК, цену и STOP — при ошибке не уходит ничего', () => {
  const a = ok(call('rsItemAdd', WAI, { idem: key(), orderId: o11, items: [{ code: 'D009' }, { code: 'D002', guest: 2 }] })).items;
  let r = err(call('rsOrderSend', WAI, { idem: key(), orderId: o11, mode: 'all' }), 'VALIDATION');
  assert.ok(/нет действующей ТТК/.test(r.error.message), r.error.message);
  assert.ok(get(WAI, o11).items.filter(x => x.status !== 'CANCELLED').every(x => x.status === 'DRAFT'), 'ничего не ушло');
  ok(call('rsItemCancel', WAI, { idem: key(), itemId: a[0].id, version: a[0].version }));
  // цена сыра изменилась после добавления
  pr.appendRow(['P2b', 'D002', '', 990, 'порц.', 'MENU', '', new Date('2026-11-20'), '', 'ACTIVE', '', '', '', '']);
  r = err(call('rsOrderSend', WAI, { idem: key(), orderId: o11, mode: 'all' }), 'VALIDATION');
  assert.ok(/цена изменилась/.test(r.error.message), r.error.message);
  const it = get(WAI, o11).items.find(x => x.code === 'D002');
  const up = ok(call('rsItemUpdate', WAI, { idem: key(), itemId: it.id, version: it.version, reprice: true })).item;
  assert.strictEqual(up.priceKop, 99000);
  // STOP: лист этапа 4
  const sg = C._rsSheet_('СтопГО_V1'), H = C.MC_RS_HEAD_['СтопГО_V1'], v = { StopID: 'S1', DishCode: 'D004', 'Подразделение': 'KITCHEN', 'Статус': 'STOP', 'Актуально': true, Version: 1 };
  sg.appendRow(H.map(h => (h in v ? v[h] : '')));
  err(call('rsItemAdd', WAI, { idem: key(), orderId: o11, items: [{ code: 'D004' }] }), 'VALIDATION');
  sg.getRange(2, H.indexOf('Статус') + 1).setValue('GO');
  ok(call('rsOrderSend', WAI, { idem: key(), orderId: o11, mode: 'all' }));
});

t('сценарий 4: 4 гостя — 1-й свои, 2-й и 3-й делят позицию, 4-й остаток; сумма без двойного начисления', () => {
  const add = ok(call('rsItemAdd', WAI, { idem: key(), orderId: o11, items: [{ code: 'D003', guest: 1 }, { code: 'B001', qty: 1 }, { code: 'D005', guest: 4 }, { code: 'B002', qty: 3, guest: 4 }] })).items;
  ok(call('rsOrderSend', WAI, { idem: key(), orderId: o11, mode: 'all' }));
  const o = get(WAI, o11), live = o.items.filter(x => x.status !== 'CANCELLED');
  const shared = live.find(x => x.code === 'B001'), cheese = live.find(x => x.code === 'D002');
  const g1 = live.filter(x => x.guest === 1), g4 = live.filter(x => x.guest === 4);
  const bills = [
    { name: 'Гость 1', items: g1.map(x => ({ itemId: x.id, num: 1, den: 1 })) },
    { name: 'Гость 2', items: [{ itemId: shared.id, num: 1, den: 2 }] },
    { name: 'Гость 3', items: [{ itemId: shared.id, num: 1, den: 2 }] },
    { name: 'Гость 4', items: g4.map(x => ({ itemId: x.id, num: 1, den: 1 })).concat([{ itemId: cheese.id, num: 1, den: 1 }]) }];
  // неполное распределение — отказ
  err(call('rsBillSplit', WAI, { idem: key(), orderId: o11, mode: 'manual', bills: bills.slice(0, 3) }), 'VALIDATION');
  // сверх 100 % — отказ
  err(call('rsBillSplit', WAI, { idem: key(), orderId: o11, mode: 'manual', bills: bills.concat([{ name: 'лишний', items: [{ itemId: shared.id, num: 1, den: 3 }] }]) }), 'VALIDATION');
  ok(call('rsBillSplit', WAI, { idem: key(), orderId: o11, mode: 'manual', bills }));
  const o2 = get(WAI, o11), sum = o2.bills.reduce((a, b) => a + b.totalKop, 0);
  assert.strictEqual(sum, o2.totalKop, 'сумма счетов = сумма заказа');
  assert.strictEqual(o2.bills[1].totalKop, 35000); assert.strictEqual(o2.bills[2].totalKop, 35000);
  assert.strictEqual(o2.bills[0].totalKop, 510000 + 65000, 'стейк по факту 340 г + цезарь');
  assert.strictEqual(o2.unallocated.length, 0);
  const n = ss.getSheetByName('ПозицииЗаказа_V1').getDataRange().getValues().slice(1).filter(r => r[1] === o11 && r[6] === 'B001' && r[24] !== 'CANCELLED').length;
  assert.strictEqual(n, 1, 'исходная позиция одна, не дублирована');
});
t('поровну на 3: 1240,00 ₽ = 413,33 + 413,33 + 413,34 — копейки не теряются', () => {
  const oT = ok(call('rsOrderOpen', WAI2, { idem: key(), tableId: T['14'].id, guests: 3 })).orderId;
  ok(call('rsItemAdd', WAI2, { idem: key(), orderId: oT, items: [{ code: 'D002' }, { code: 'B002' }] }));
  ok(call('rsOrderSend', WAI2, { idem: key(), orderId: oT, mode: 'all' }));
  ok(call('rsBillSplit', WAI2, { idem: key(), orderId: oT, mode: 'equal', parts: 3 }));
  const o = get(WAI2, oT), parts = o.bills.map(b => b.totalKop).sort();
  assert.strictEqual(parts.reduce((a, b) => a + b, 0), 124000); assert.deepStrictEqual(parts, [41333, 41333, 41334]);
  ok(call('rsBillSplit', WAI2, { idem: key(), orderId: oT, mode: 'one' }));
  const o2 = get(WAI2, oT); assert.strictEqual(o2.bills.length, 1); assert.strictEqual(o2.bills[0].totalKop, 124000);
});
t('разделение 1/3 без остатка копеек: 100,00 ₽ на 3 = 33,34 + 33,33 + 33,33', () => {
  assert.deepStrictEqual(Object.values(C._rsSplitKop_(10000, [{ key: 'a', num: 1, den: 3 }, { key: 'b', num: 1, den: 3 }, { key: 'c', num: 1, den: 3 }])).sort(), [3333, 3333, 3334]);
});
t('скидка — только с правом и причиной; оплата — только с правом; оплаченный счёт не меняется', () => {
  const o = get(WAI, o11), b2 = o.bills[1];
  err(call('rsBillAdjust', WAI, { idem: key(), billId: b2.id, version: b2.version, discountType: 'PERCENT', discountValue: 10, discountReason: 'постоянный гость' }));
  err(call('rsBillAdjust', ADM, { idem: key(), billId: b2.id, version: b2.version, discountType: 'PERCENT', discountValue: 10 }), 'VALIDATION');
  ok(call('rsBillAdjust', ADM, { idem: key(), billId: b2.id, version: b2.version, discountType: 'PERCENT', discountValue: 10, discountReason: 'постоянный гость' }));
  const b = get(ADM, o11).bills[1]; assert.strictEqual(b.discountKop, 3500); assert.strictEqual(b.totalKop, 31500);
  err(call('rsBillPay', WAI, { idem: key(), billId: b.id, version: b.version, method: 'CASH' }));
  err(call('rsBillPay', ADM, { idem: key(), billId: b.id, version: b.version, method: 'CARD' }), 'VALIDATION');
  ok(call('rsBillPay', ADM, { idem: key(), billId: b.id, version: b.version, method: 'CARD', receipt: '0042', amountKop: 31500 }));
  err(call('rsBillSplit', WAI, { idem: key(), orderId: o11, mode: 'one' }), 'VALIDATION');
  const shared = get(ADM, o11).items.find(x => x.code === 'B001');
  err(call('rsItemCancel', ADM, { idem: key(), itemId: shared.id, version: shared.version, reason: 'ошибка' }), 'VALIDATION');
});
t('отмена отправленной позиции до приготовления — с причиной, задание отменено, расхода нет', () => {
  const it = ok(call('rsItemAdd', WAI, { idem: key(), orderId: o12, items: [{ code: 'D005' }] })).items[0];
  ok(call('rsOrderSend', WAI, { idem: key(), orderId: o12, mode: 'items', itemIds: [it.id] }));
  const cur = get(WAI, o12).items.find(x => x.id === it.id);
  err(call('rsItemCancel', WAI, { idem: key(), itemId: it.id, version: cur.version }), 'VALIDATION');
  ok(call('rsItemCancel', WAI, { idem: key(), itemId: it.id, version: cur.version, reason: 'гость передумал' }));
  const q = ss.getSheetByName('ОчередьПроизводства_V1').getDataRange().getValues(), h = q[0], tk = q.find(r => r[1] === it.id);
  assert.strictEqual(tk[h.indexOf('Статус')], 'CANCELLED');
  ['Склад_Операции', 'Продажи_Списание_V71'].forEach(n => { const sh = ss.getSheetByName(n); assert.ok(!sh || sh.getLastRow() <= 1, n); });
});
t('открытие по брони: предзаказ переносится один раз, бронь — «стол занят»', () => {
  const bk = ok(call('rsBookingCreate', ADM, { idem: key(), tables: [T['14'].id], guest: 'Смирнов', date: '2026-11-25', start: '19:00', duration: 120, guests: 2, status: 'CONFIRMED',
    preorder: { items: [{ code: 'D001', qty: 1, amount: 350, course: 3 }, { code: 'B001', qty: 2, course: 1 }] } })).booking;
  // стол 14 занят заказом — сначала закрываем его (оплачен целиком)
  const busy = ok(call('rsOrderList', ADM, { all: true })).find(x => x.tableId === T['14'].id);
  const ob = get(ADM, busy.id);
  ok(call('rsBillPay', ADM, { idem: key(), billId: ob.bills[0].id, version: ob.bills[0].version, method: 'CASH' }));
  err(call('rsOrderClose', ADM, { idem: key(), orderId: busy.id, version: ob.version }), 'VALIDATION');   // блюда ещё на кухне
  ok(call('rsOrderClose', ADM, { idem: key(), orderId: busy.id, version: ob.version, force: true }));
  const r = ok(call('rsOrderOpen', WAI, { idem: key(), tableId: T['14'].id, guests: 2, bookingId: bk.id }));
  assert.strictEqual(r.fromPreorder, 2);
  const o = get(WAI, r.orderId), steak2 = o.items.find(x => x.code === 'D001');
  assert.strictEqual(steak2.planAmount, 350); assert.strictEqual(steak2.planKop, 525000); assert.strictEqual(steak2.course, 3);
  const l = ok(call('rsBookingList', ADM, { from: '2026-11-25' })).bookings.find(x => x.id === bk.id);
  assert.strictEqual(l.status, 'SEATED'); assert.strictEqual(l.orderId, r.orderId); assert.strictEqual(l.preorder.status, 'CONVERTED');
  err(call('rsOrderOpen', WAI, { idem: key(), tableId: T['10'].id, guests: 2, bookingId: bk.id }));
});
t('закрытие: неоплаченный счёт не даёт закрыть; история и аудит заказа', () => {
  const o = get(ADM, o11);
  err(call('rsOrderClose', ADM, { idem: key(), orderId: o11, version: o.version, force: true }), 'VALIDATION');
  const ev = ss.getSheetByName('СобытияОбслуживания_V1').getDataRange().getValues().filter(r => r[5] === o11).map(r => r[6]);
  ['ORDER_OPENED', 'ITEMS_ADDED', 'ITEM_WEIGHED', 'ORDER_SENT', 'BILLS_SPLIT', 'BILL_ADJUSTED', 'BILL_PAID'].forEach(e => assert.ok(ev.includes(e), e));
  const a = ss.getSheetByName('Audit_Log').getDataRange().getValues().map(r => r[7]);
  ['RS_ORDER_OPENED', 'RS_ORDER_SENT', 'RS_BILL_PAID'].forEach(x => assert.ok(a.includes(x), x));
});
t('склад не тронут; в журнал продаж попадают только оплаченные счета закрытого заказа (этап 7)', () => {
  ['Склад_Операции', 'Продажи_Списание_V71'].forEach(n => { const sh = ss.getSheetByName(n); assert.ok(!sh || sh.getLastRow() <= 1, n); });
  const j = ss.getSheetByName('Ж_Продажи'), v = j ? j.getDataRange().getValues() : [[]], src = v[0].indexOf('Источник записи');
  assert.ok(v.length > 1, 'закрытый оплаченный заказ проведён'); assert.ok(v.slice(1).every(r => /RS-ALLOC/.test(r[src])), 'только строки зала');
});

console.log(`\nИтого: ${pass} пройдено, ${fail} не пройдено`);
process.exit(fail ? 1 : 0);
