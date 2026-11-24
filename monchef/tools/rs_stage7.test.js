// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
// Restaurant Service, этап 7: полный цикл (ТЗ §20) — бронь → предзаказ → стол → заказ → курсы → кухня и бар → склад →
// выдача → подано → счёт → оплата → журнал продаж → Z-отчёт → экономика → аудит. Сценарий §16.10. Запуск: node monchef/tools/rs_stage7.test.js
const assert = require('assert');
const { boot } = require('./gasemu');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e)); } }
const J = s => (typeof s === 'string' ? JSON.parse(s) : s);
let seq = 0; const key = () => 'st7-key-' + (++seq);

const E = boot({ now: '2026-11-25T08:00:00Z' }), C = E.ctx, ss = E.ss;
E.props[C.MC_MED_GATE_PROP_] = 'off';
const emp = ss.insertSheet('Сотрудники');
emp.appendRow(['Фамилия', 'Имя', 'Отчество', 'Должность', 'Роль', 'ДР', 'Телефон', 'Адрес', 'ПИН-код', '', '', '', 'Активен']);
[['Директорова', 'Анна', 'Директор', '1111'], ['Админов', 'Пётр', 'Администратор', '2222'], ['Официантов', 'Иван', 'Официант', '3333'], ['Шефов', 'Марк', 'Шеф-повар', '7777'], ['Барменов', 'Лев', 'Бармен', '8888']]
  .forEach(r => emp.appendRow([r[0], r[1], '', r[2], r[2], '', '', '', r[3], '', '', '', true]));
const ds = ss.insertSheet('Блюда');
ds.appendRow(['Код', 'Название', 'Категория', 'Выход', '', 'Технология', '', '', 'Цех', '', '', '', 'Выход, г/мл/шт', 'Ед. выхода']);
[['D001', 'Стейк рибай', 'Горячее', 'Горячий цех', 300, 'г'], ['D002', 'Салат с тунцом', 'Салаты', 'Холодный цех', 220, 'г'], ['B010', 'Дайкири', 'Коктейли', 'Бар', 85, 'мл']]
  .forEach(r => ds.appendRow([r[0], r[1], r[2], r[4], '', '', '', '', r[3], '', '', '', r[4], r[5]]));
const so = ss.insertSheet('Состав'); so.appendRow(['Код', 'Продукт', '', '', 'Брутто', 'Нетто', 'Выход', 'Ед.']);
[['D001', 'Говядина рибай', 300, 300, 'г'], ['D002', 'Тунец', 80, 80, 'г'], ['D002', 'Салат микс', 60, 60, 'г'], ['B010', 'Ром белый', 50, 50, 'мл'], ['B010', 'Сок лайма', 20, 20, 'мл']]
  .forEach(r => so.appendRow([r[0], r[1], '', '', r[2], r[3], r[3], r[4]]));
const pr = ss.insertSheet('Цены_Меню'); pr.appendRow(['PriceID', 'DishCode', 'DishName', 'Price', 'Unit', 'Source', 'EventID', 'DateFrom', 'DateTo', 'Status']);
[['P1', 'D001', 1500, '100 г'], ['P2', 'D002', 790, 'порц.'], ['P3', 'B010', 650, 'порц.']].forEach(r => pr.appendRow([r[0], r[1], '', r[2], r[3], 'MENU', '', '2026-11-01', '', 'ACTIVE']));
const tv = ss.insertSheet('ТТК_Версии'); tv.appendRow(['Код блюда', 'Версия', 'Статус']); ['D001', 'D002', 'B010'].forEach(c => tv.appendRow([c, 1, 'действующая']));
C._withLock_(() => C._incomeWithBatches_([{ name: 'Говядина рибай', qty: 3000, unit: 'г', price: 2.5 }, { name: 'Тунец', qty: 1000, unit: 'г', price: 1.5 }, { name: 'Салат микс', qty: 1000, unit: 'г', price: 0.5 },
  { name: 'Ром белый', qty: 700, unit: 'мл', price: 2 }, { name: 'Сок лайма', qty: 300, unit: 'мл', price: 1 }], 'Поставщик', '', null));
(() => { const sh = ss.getSheetByName('Склад_Партии'), n = sh.getLastRow(); for (let i = 2; i <= n; i++) sh.getRange(i, 11).setValue('active'); })();

const login = pin => J(C.loginWithPin(pin, 'dev-' + pin)).token;
const DIR = login('1111'), ADM = login('2222'), WAI = login('3333'), CHEF = login('7777'), BAR = login('8888');
const call = (fn, tok, d) => { C._mcRcDrop_(); C._BOOK_CACHE_ = null; return J(C[fn](JSON.stringify(d || {}), tok)); };
const ok = r => { assert.ok(r.success === true || r.ok === true, JSON.stringify(r).slice(0, 400)); return r.data !== undefined ? r.data : r; };
const err = (r, code) => { assert.ok(!(r.success === true || r.ok === true), 'ожидался отказ: ' + JSON.stringify(r).slice(0, 300)); if (code) assert.strictEqual(r.error && r.error.code, code, JSON.stringify(r)); return r; };
const left = name => { C._mcRcDrop_(); C._BOOK_CACHE_ = null; return ss.getSheetByName('Склад_Партии').getDataRange().getValues().slice(1).filter(r => r[1] === name).reduce((a, r) => a + (Number(r[9]) || 0), 0); };
const j36 = () => { C._mcRcDrop_(); C._BOOK_CACHE_ = null; const sh = ss.getSheetByName('Ж_Продажи'); if (!sh) return []; const v = sh.getDataRange().getValues(), h = v[0]; return v.slice(1).map(r => { const o = {}; h.forEach((k, i) => o[k] = r[i]); return o; }); };
const hall = ok(call('rsHallSave', ADM, { idem: key(), name: 'Зал', width: 6, height: 4 }));
const T7 = ok(call('rsTableSave', ADM, { idem: key(), hallId: hall.id, number: '7', x: 1, y: 1, seatsMax: 4 }));
const T8 = ok(call('rsTableSave', ADM, { idem: key(), hallId: hall.id, number: '8', x: 3, y: 1, seatsMax: 4 }));
const act = (tok, dept, name, a) => { const tk = ok(call('rsKdsData', tok, { dept })).tickets.find(x => x.name === name && ['CANCELLED', 'ISSUED', 'READY'].indexOf(x.status) < 0); return ok(call('rsTicketAct', tok, { idem: key(), ticketId: tk.id, version: tk.version, action: a })); };

console.log('Restaurant Service — этап 7 (полный цикл)');
let bk, o7, bills;
t('бронь на сегодня с предзаказом; прогноз — блюда и сырьё по ТТК (кухня и бар), склад не тронут', () => {
  bk = ok(call('rsBookingCreate', ADM, { idem: key(), tables: [T7.id], guest: 'Смирновы', date: '2026-11-25', start: '13:30', duration: 120, guests: 2, status: 'CONFIRMED',
    preorder: { items: [{ code: 'B010', qty: 2, course: 1 }] } })).booking;
  const po = ok(call('rsBookingList', ADM, { from: '2026-11-25' })).bookings[0].preorder;
  ok(call('rsPreorderSave', ADM, { idem: key(), bookingId: bk.id, version: po.version, confirm: true, items: po.items }));
  const f = ok(call('rsPreorderForecast', ADM, { from: '2026-11-25' }));
  const rum = f.ingredients.find(x => x.product === 'Ром белый'); assert.strictEqual(rum.qty, 100); assert.strictEqual(rum.dept, 'BAR');
  assert.strictEqual(left('Ром белый'), 700);
});
t('посадка по брони → заказ (предзаказ перенесён), курсы, весовой стейк, отправка', () => {
  o7 = ok(call('rsOrderOpen', WAI, { idem: key(), tableId: T7.id, guests: 2, bookingId: bk.id })).orderId;
  ok(call('rsItemAdd', WAI, { idem: key(), orderId: o7, items: [{ code: 'D002', guest: 2, course: 1 }, { code: 'D001', guest: 1, course: 2, amount: 300 }] }));
  const s = ok(call('rsOrderSend', WAI, { idem: key(), orderId: o7, mode: 'all' })); assert.strictEqual(s.waiting, 1, 'стейк ждёт курса');
});
t('производство: бар и кухня — «Готово» списывает по ТТК; стейк после команды «Следующий курс», факт 340 г', () => {
  act(BAR, 'BAR', 'Дайкири', 'start'); act(BAR, 'BAR', 'Дайкири', 'ready');
  act(CHEF, 'KITCHEN', 'Салат с тунцом', 'start'); act(CHEF, 'KITCHEN', 'Салат с тунцом', 'ready');
  assert.strictEqual(700 - left('Ром белый'), 100); assert.strictEqual(1000 - left('Тунец'), 80);
  ok(call('rsCourseFire', WAI, { idem: key(), orderId: o7, course: 2 }));
  const st = ok(call('rsOrderGet', WAI, { id: o7 })).items.find(x => x.code === 'D001');
  ok(call('rsItemWeight', WAI, { idem: key(), itemId: st.id, version: st.version, amount: 340 }));
  act(CHEF, 'KITCHEN', 'Стейк рибай', 'start'); act(CHEF, 'KITCHEN', 'Стейк рибай', 'ready');
  assert.strictEqual(3000 - left('Говядина рибай'), 340, 'списано по фактическому весу (340 г = 1,133 порции × 300 г)');
});
t('подача; разделение: гость 1 — стейк, гость 2 — салат, коктейли пополам; скидка 10 % на счёт гостя 2', () => {
  const o = ok(call('rsOrderGet', WAI, { id: o7 }));
  ok(call('rsItemServe', WAI, { idem: key(), orderId: o7, itemIds: o.items.filter(x => x.status === 'READY').map(x => x.id) }));
  const st = o.items.find(x => x.code === 'D001'), sal = o.items.find(x => x.code === 'D002'), dk = o.items.find(x => x.code === 'B010');
  ok(call('rsBillSplit', WAI, { idem: key(), orderId: o7, mode: 'manual', bills: [{ name: 'Гость 1', items: [{ itemId: st.id, num: 1, den: 1 }, { itemId: dk.id, num: 1, den: 2 }] },
    { name: 'Гость 2', items: [{ itemId: sal.id, num: 1, den: 1 }, { itemId: dk.id, num: 1, den: 2 }] }] }));
  bills = ok(call('rsOrderGet', ADM, { id: o7 })).bills;
  ok(call('rsBillAdjust', ADM, { idem: key(), billId: bills[1].id, version: bills[1].version, discountType: 'PERCENT', discountValue: 10, discountReason: 'день рождения' }));
  bills = ok(call('rsOrderGet', ADM, { id: o7 })).bills;
  assert.strictEqual(bills[0].totalKop, 510000 + 65000); assert.strictEqual(bills[1].totalKop, Math.round((79000 + 65000) * 0.9));
});
t('сценарий 10: внутренний заказ — не продажа: до оплаты и закрытия журнал продаж пуст', () => {
  assert.strictEqual(j36().length, 0);
  const r = ok(call('rsShiftReport', DIR, { date: '2026-11-25' })); assert.strictEqual(r.paid.kop, 0); assert.strictEqual(r.journal.hallKop, 0);
});
t('оплата подтверждена по кассе; пока заказ не закрыт — «оплачено, но не проведено»', () => {
  ok(call('rsBillPay', ADM, { idem: key(), billId: bills[0].id, version: bills[0].version, method: 'CARD', receipt: '1001', amountKop: bills[0].totalKop }));
  ok(call('rsBillPay', ADM, { idem: key(), billId: bills[1].id, version: bills[1].version, method: 'CASH', amountKop: bills[1].totalKop }));
  const r = ok(call('rsShiftReport', DIR, { date: '2026-11-25' }));
  assert.strictEqual(r.paid.kop, 575000 + 129600); assert.strictEqual(r.journal.hallKop, 0);
  assert.ok(r.issues.some(x => /не проведена в журнал/.test(x.text)));
});
let sales;
t('закрытие заказа: доли счетов — строки журнала продаж; сумма = оплате; склад повторно не списан; бронь закрыта', () => {
  const before = left('Ром белый');
  const o = ok(call('rsOrderGet', ADM, { id: o7 }));
  sales = ok(call('rsOrderClose', WAI, { idem: key(), orderId: o7, version: o.version }));
  assert.strictEqual(sales.sales, 4, '4 доли: стейк, ½ дайкири, салат, ½ дайкири');
  const rows = j36(); assert.strictEqual(rows.length, 4);
  const sum = Math.round(rows.reduce((a, r) => a + Number(r['Сумма']), 0) * 100); assert.strictEqual(sum, 575000 + 129600);
  const dq = rows.filter(r => r['Блюдо'] === 'Дайкири').map(r => r['Количество']); assert.deepStrictEqual(dq, [1, 1]);
  assert.ok(rows.every(r => /RS-ALLOC/.test(r['Источник записи']) && /SL-\d{8}-/.test(r['Источник записи'])));
  assert.strictEqual(left('Ром белый'), before, 'проведение продажи склад не трогает');
  assert.strictEqual(ok(call('rsBookingList', ADM, { from: '2026-11-25' })).bookings[0].status, 'CLOSED');
});
t('экономика V64: выручка из журнала, себестоимость — по фактическим партиям производства', () => {
  C._mcRcDrop_(); C._BOOK_CACHE_ = null;
  const L = C._v64Build_(null).lines.filter(l => l.stage === 'SALE');
  const rev = L.filter(l => l.dir === 'IN').reduce((a, l) => a + l.amount, 0), cost = L.filter(l => l.dir === 'OUT').reduce((a, l) => a + l.amount, 0);
  assert.strictEqual(Math.round(rev * 100), 704600);
  assert.ok(L.filter(l => l.dir === 'OUT').every(l => l.source === 'TRACE_LINKS'), 'себестоимость по партиям, не норматив: ' + JSON.stringify(L.filter(l => l.dir === 'OUT').map(l => l.source)));
  const exp = 340 * 2.5 + 80 * 1.5 + 60 * 0.5 + 100 * 2 + 40 * 1;
  assert.strictEqual(Math.round(cost * 100), Math.round(exp * 100), 'себестоимость ' + cost + ' ≠ ' + exp);
});
t('Z-отчёт кассы за смену сходится с журналом; отчёт смены: food cost, расхождений по кассе нет', () => {
  const H = ['ZID', 'Дата смены', 'Закрыта', 'Смена №', 'РН ККТ', 'ЗН ККТ', 'ФН', 'ФД', 'ФП', 'ИНН', 'Чеков', 'Приход', 'Наличными', 'Безналичными', 'Возврат прихода', 'Расход', 'Возврат расхода', 'Выручка', 'LocationID', 'Источник', 'Файл', 'FileID', 'SHA-256', 'Распознано (JSON)', 'Сверка (JSON)', 'Статус'];
  const z = ss.insertSheet('Касса_Z_Отчёты_V94'); z.appendRow(H); const v = { ZID: 'Z1', 'Дата смены': '2026-11-25', 'Приход': 7046, 'Выручка': 7046, 'Статус': 'POSTED' }; z.appendRow(H.map(h => (h in v ? v[h] : '')));
  const r = ok(call('rsShiftReport', DIR, { date: '2026-11-25' }));
  assert.strictEqual(r.z.status, 'MATCH'); assert.strictEqual(r.journal.hallKop, 704600);
  assert.ok(r.foodCostPct > 0 && r.foodCostPct < 30, 'food cost ' + r.foodCostPct);
  assert.ok(!r.issues.some(x => x.severity === 'error'), JSON.stringify(r.issues));
  assert.deepStrictEqual(Object.keys(r.paid.byMethod).sort(), ['CARD', 'CASH']);
  err(call('rsShiftReport', WAI, { date: '2026-11-25' }), 'FORBIDDEN');   // официанту отчёт смены недоступен
});
t('V95 не отменяет продажу зала (продукты израсходованы); возврат по счёту — сторно без возврата на склад; Z сверяется по нетто', () => {
  const r0 = j36()[0], sid = /SL-\d{8}-[0-9A-F]{8}/.exec(r0['Источник записи'])[0];
  const v95 = J(C.v95SaleCancel(JSON.stringify({ saleId: sid, reason: 'проверка запрета', confirm: true }), DIR));
  assert.ok(!(v95.success || v95.ok), JSON.stringify(v95)); assert.ok(/Возвратом по счёту/.test(JSON.stringify(v95)));
  const beef = left('Говядина рибай');
  const rf = ok(call('rsBillRefund', DIR, { idem: key(), billId: bills[1].id, version: ok(call('rsShiftReport', DIR, { date: '2026-11-25' })).closed[0].bills.find(b => b.id === bills[1].id).version, reason: 'гостю не понравился салат' }));
  assert.strictEqual(rf.sum, 1296); assert.strictEqual(left('Говядина рибай'), beef);
  const rows = j36(); assert.strictEqual(rows.length, 6); assert.strictEqual(rows.filter(r => Number(r['Сумма']) < 0).length, 2);
  const r = ok(call('rsShiftReport', DIR, { date: '2026-11-25' }));
  assert.strictEqual(r.refunds.kop, 129600);
  assert.strictEqual(r.z.status, 'MISMATCH', 'касса пробила 7046, журнал нетто 5750 — пока возврат не проведён кассой');
  err(call('rsBillRefund', DIR, { idem: key(), billId: bills[1].id, reason: 'повтор возврата' }), 'VALIDATION');
});
t('расход без продажи: отмена после начала приготовления видна в смене с себестоимостью', () => {
  const o8 = ok(call('rsOrderOpen', WAI, { idem: key(), tableId: T8.id, guests: 1 })).orderId;
  ok(call('rsItemAdd', WAI, { idem: key(), orderId: o8, items: [{ code: 'D002' }] })); ok(call('rsOrderSend', WAI, { idem: key(), orderId: o8, mode: 'all' }));
  act(CHEF, 'KITCHEN', 'Салат с тунцом', 'start');
  const tk = ok(call('rsKdsData', CHEF, { dept: 'KITCHEN' })).tickets.find(x => x.orderId === o8);
  ok(call('rsTicketCancel', CHEF, { idem: key(), ticketId: tk.id, version: tk.version, reason: 'уронили', consumption: 'FULL' }));
  const r = ok(call('rsShiftReport', DIR, { date: '2026-11-25' }));
  assert.ok(r.cancelLoss.some(x => x.dish === 'Салат с тунцом' && x.costKop > 0)); assert.ok(r.cost.lossKop > 0);
  const w = ok(call('rsShiftReport', ADM, { date: '2026-11-25' })); assert.ok(!('cost' in w) && !('foodCostPct' in w), 'администратору без права себестоимости — без сумм себестоимости');
});
t('аудит: вся цепочка в истории заказа и журнале аудита', () => {
  const ev = ss.getSheetByName('СобытияОбслуживания_V1').getDataRange().getValues().filter(r => r[5] === o7).map(r => r[6]);
  ['ORDER_OPENED', 'ORDER_SENT', 'COURSE_FIRED', 'TICKET_READY', 'ITEMS_SERVED', 'BILLS_SPLIT', 'BILL_PAID', 'ORDER_CLOSED', 'BILL_REFUNDED'].forEach(e => assert.ok(ev.includes(e), e));
  const a = ss.getSheetByName('Audit_Log').getDataRange().getValues().map(r => r[7]); ['RS_ORDER_CLOSED', 'RS_BILL_REFUNDED', 'RS_BOOKING_CREATED'].forEach(x => assert.ok(a.includes(x), x));
});

console.log(`\nИтого: ${pass} пройдено, ${fail} не пройдено`);
process.exit(fail ? 1 : 0);
