// Этап M5: возвраты, итоги смены в «Экономику», отчёт по сотрудникам, миграция колонок.
// Запуск: node replica/tests/pos_refund_report_test.js
const assert = require('assert');
const { ctx: G, sheets } = require('./harness.js');
let failures = 0;
function step(name, fn) {
  try { const r = fn(); console.log('OK   ', name); return r; }
  catch (e) { failures++; console.log('FAIL ', name, '—', e && e.message); }
}
function api(a, d, t) { const r = G.processOperation(a, d || {}, t); if (!r.ok) throw new Error(a + ': ' + r.error); return r.data; }
function apiErr(a, d, t) { const r = G.processOperation(a, d || {}, t); assert(!r.ok, a + ' должен был вернуть ошибку'); return r.error; }

G.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', 'SS');
G.initializeDatabase();
G.insertRow_('ORGANIZATIONS', { organization_id: 'ORG-1', название: 'Кафе', статус: 'активна' });
G.insertRow_('LOCATIONS', { location_id: 'LOC-1', organization_id: 'ORG-1', название: 'Точка', статус: 'активна' });
function mk(id, name, role, pin) { const s = 's' + id; G.insertRow_('USERS', { user_id: id, organization_id: 'ORG-1', location_ids: 'LOC-1', имя: name, роль: role, статус: 'активен', pin_hash: G.hashPin_(pin, s), pin_salt: s, failed_attempts: 0, lockout_count: 0 }); }
mk('USR-M', 'Ольга', 'МЕНЕДЖЕР', '482915'); mk('USR-K', 'Анна', 'КАССИР', '739164'); mk('USR-W', 'Игорь', 'ОФИЦИАНТ', '615283');
G.insertRow_('DISHES', { dish_id: 'DISH-1', organization_id: 'ORG-1', название: 'Борщ', цена_продажи: 350, себестоимость: 90, статус: 'активно' });
G.insertRow_('DISHES', { dish_id: 'DISH-2', organization_id: 'ORG-1', название: 'Морс', цена_продажи: 120, себестоимость: 20, статус: 'активно' });
function login(u, p) { const d = api('LOGIN', { userId: u, pin: p }); return d.requires_location ? (api('SELECT_LOCATION', { locationId: 'LOC-1' }, d.token).token || d.token) : d.token; }
const tM = login('USR-M', '482915'), tK = login('USR-K', '739164'), tW = login('USR-W', '615283');

const hall = api('POS_SAVE_HALL', { название: 'Зал' }, tM);
const t1 = api('POS_SAVE_TABLE', { hallId: hall.hall_id, название: '1' }, tM);
api('POS_OPEN_SHIFT', { cashStart: 1000 }, tK);
function sell(token, lines, payments, tableId, opId) {
  let v = api('POS_CREATE_ORDER', tableId ? { tableId, guests: 2 } : {}, token);
  lines.forEach(([dish, qty]) => { v = api('POS_ADD_LINE', { orderId: v.order.order_id, dishId: dish, qty, version: v.order.version }, token); });
  return api('POS_PAY', { orderId: v.order.order_id, version: v.order.version, operationId: opId, payments }, tK);
}
// Заказ 1: официант Игорь, стол 1 — 2 борща + 2 морса = 940, смешанная оплата 500 нал + 440 карта.
const o1 = step('смешанная оплата: наличные + карта', () => {
  const r = sell(tW, [['DISH-1', 2], ['DISH-2', 2]], [{ способ: 'нал', сумма: 500 }, { способ: 'карта', сумма: 440 }], t1.table_id, 'P1');
  assert.equal(r.order.итого, 940); assert.equal(r.payments.length, 2); assert.equal(r.сдача, 0);
  return r.order;
});
// Заказ 2: кассир Анна, с собой — 1 борщ, наличные 400 (сдача 50).
const o2 = step('оплата кассира с собой', () => sell(tK, [['DISH-1', 1]], [{ способ: 'нал', сумма: 400 }], null, 'P2').order);

step('кассир не делает возвраты', () => { assert(/Недостаточно прав/.test(apiErr('POS_REFUND', { orderId: o1.order_id, reason: 'x', method: 'нал' }, tK))); });
step('возврат без причины и без способа — ошибка', () => {
  assert(/причину/.test(apiErr('POS_REFUND', { orderId: o1.order_id, method: 'нал' }, tM)));
  assert(/как вернуть/.test(apiErr('POS_REFUND', { orderId: o1.order_id, reason: 'Холодный' }, tM)));
});
let mors;
step('частичный возврат: 2 морса на карту', () => {
  const lines = api('POS_GET_ORDER', { orderId: o1.order_id }, tM).lines;
  mors = lines.find(l => l.dish_id === 'DISH-2');
  const r = api('POS_REFUND', { orderId: o1.order_id, lineIds: [mors.line_id], reason: 'Гость не заказывал', method: 'карта', operationId: 'R1' }, tM);
  assert.equal(r.возврат, 240); assert.equal(r.order.статус, 'оплачен'); assert.equal(r.order.возвращено, 240);
  assert.equal(r.lines.find(l => l.line_id === mors.line_id).статус, 'возврат');
});
step('ту же позицию дважды вернуть нельзя', () => {
  assert(/уже возвращена/.test(apiErr('POS_REFUND', { orderId: o1.order_id, lineIds: [mors.line_id], reason: 'ещё', method: 'нал' }, tM)));
});
step('безнал больше оплаченного этим способом вернуть нельзя', () => {
  // По карте оплачено 440, уже возвращено 240 на карту — но правило проверяет оплату, не остаток: борщи 700 > 440.
  assert(/вернуть 700 ₽ этим способом нельзя/.test(apiErr('POS_REFUND', { orderId: o1.order_id, reason: 'Холодный', method: 'карта' }, tM)));
});
step('полный остаток наличными → заказ в статусе «возврат»', () => {
  const r = api('POS_REFUND', { orderId: o1.order_id, reason: 'Холодный борщ', method: 'нал', operationId: 'R2' }, tM);
  assert.equal(r.возврат, 700); assert.equal(r.order.статус, 'возврат'); assert.equal(r.order.возвращено, 940);
  assert(/полный возврат/.test(apiErr('POS_REFUND', { orderId: o1.order_id, reason: 'x', method: 'нал' }, tM)));
});
step('сторно в SALES: выручка уменьшается, себестоимость остаётся', () => {
  const st = G.findRows_('SALES', s => s.источник === 'касса_возврат');
  assert.equal(st.length, 2);
  assert.equal(st.reduce((a, s) => a + s.сумма, 0), -940);
  assert(st.every(s => s.себестоимость_на_момент === 0 && s.исполнение_статус === 'не_требуется'));
  const all = G.findRows_('SALES', s => s.organization_id === 'ORG-1');
  assert.equal(all.reduce((a, s) => a + s.сумма, 0), 350); // 940 + 350 − 940
});
step('фоновое списание не трогает сторно-строки', () => {
  G.posFulfillPendingSalesTrigger_();
  assert(G.findRows_('SALES', s => s.источник === 'касса_возврат').every(s => s.исполнение_статус === 'не_требуется'));
});
step('X-отчёт: продажи, возвраты, нетто по способам, наличные в кассе', () => {
  const t = api('POS_GET_SHIFT', {}, tK).totals;
  assert.equal(t.продажи, 1290); assert.equal(t.возвраты, 940); assert.equal(t.выручка, 350);
  assert.equal(t.нал, 500 + 350 - 700); assert.equal(t.карта, 440 - 240);
  assert.equal(t.нал_ожидается, 1000 + 150); assert.equal(t.заказов, 2); assert.equal(t.средний_чек, 645);
});
step('отчёт по сотрудникам: официант и кассир', () => {
  const r = api('POS_GET_STAFF_REPORT', {}, tM);
  const igor = r.официанты.find(w => w.имя === 'Игорь'), anna = r.официанты.find(w => w.имя === 'Анна');
  assert.deepEqual([igor.заказов, igor.продажи, igor.возвраты, igor.нетто, igor.гостей], [1, 940, 940, 0, 2]);
  assert.deepEqual([anna.заказов, anna.продажи, anna.нетто], [1, 350, 350]);
  const annaCash = r.кассиры.find(c => c.имя === 'Анна'), olga = r.кассиры.find(c => c.имя === 'Ольга');
  assert.deepEqual([annaCash.нал, annaCash.карта, annaCash.чеков], [850, 440, 3]);
  assert.deepEqual([olga.возвраты, olga.нал, olga.карта], [940, -700, -240]);
  assert.deepEqual([r.итого.заказов, r.итого.продажи, r.итого.возвраты, r.итого.нетто], [2, 1290, 940, 350]);
  assert(/Недостаточно прав/.test(apiErr('POS_GET_STAFF_REPORT', {}, tK)));
});
step('закрытие смены передаёт итоги в «Экономику» (движение денег)', () => {
  const r = api('POS_CLOSE_SHIFT', { cashFact: 1150 }, tK);
  assert.equal(r.расхождение_нал, 0);
  const cash = G.findRows_('CASH_TRANSACTIONS', c => c.organization_id === 'ORG-1');
  const byCat = cash.map(c => [c.type, c.category, c.amount]).sort();
  // Нетто: наличные 500 + 350 − 700 = 150, карта 440 − 240 = 200 — два поступления.
  assert.deepEqual(byCat, [['INFLOW', 'Выручка кассы', 150], ['INFLOW', 'Выручка кассы', 200]]);
  assert.equal(r.shift.cash_ids.split(',').length, 2); assert.equal(r.shift.возвратов_сумма, 940);
});
step('список смен за период', () => {
  const s = api('POS_GET_SHIFTS', {}, tM);
  assert.equal(s.length, 1); assert.equal(s[0].статус, 'закрыта'); assert.equal(s[0].totals.выручка, 350);
});
step('возврат без открытой смены невозможен', () => {
  assert(/Смена не открыта/.test(apiErr('POS_REFUND', { orderId: o2.order_id, reason: 'x', method: 'нал' }, tM)));
});
step('смена, где только возврат, уходит в «Экономику» выплатой', () => {
  api('POS_OPEN_SHIFT', { cashStart: 500 }, tK);
  api('POS_REFUND', { orderId: o2.order_id, reason: 'Пересолен', method: 'нал', operationId: 'R3' }, tM);
  const r = api('POS_CLOSE_SHIFT', { cashFact: 150 }, tK);
  assert.equal(r.totals.нал, -350); assert.equal(r.расхождение_нал, 0);
  const out = G.findRows_('CASH_TRANSACTIONS', c => c.type === 'OUTFLOW');
  assert.equal(out.length, 1); assert.equal(out[0].amount, 350); assert.equal(out[0].category, 'Возвраты кассы');
});
step('migratePosSchema_ дописывает колонки старого листа в конец', () => {
  const sh = sheets.POS_PAYMENTS;
  sh.data[0] = sh.data[0].slice(0, 10); // как будто лист создан на этапе M1, без «тип» и «причина»
  const added = G.migratePosSchema_().POS_PAYMENTS;
  assert.deepEqual(added, ['тип', 'причина']);
  assert.deepEqual(sh.data[0].slice(10), ['тип', 'причина']);
});
step('runPosTests_ — все проверки OK (включая сверку колонок)', () => {
  const bad = G.runPosTests_().filter(t => t.status !== 'OK'); assert.equal(bad.length, 0, JSON.stringify(bad));
});
console.log(failures ? '\n' + failures + ' FAILED' : '\nALL PASSED');
process.exit(failures ? 1 : 0);
