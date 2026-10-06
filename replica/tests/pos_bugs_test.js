// Регрессия по найденным ошибкам (replica/bugs.md). Запуск: node replica/tests/pos_bugs_test.js
const assert = require('assert');
const { ctx: G } = require('./harness.js');
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
function mk(id, role, pin) { const s = 's' + id; G.insertRow_('USERS', { user_id: id, organization_id: 'ORG-1', location_ids: 'LOC-1', имя: role, роль: role, статус: 'активен', pin_hash: G.hashPin_(pin, s), pin_salt: s, failed_attempts: 0, lockout_count: 0 }); }
mk('USR-M', 'МЕНЕДЖЕР', '482915'); mk('USR-K', 'КАССИР', '739164'); mk('USR-W', 'ОФИЦИАНТ', '615283'); mk('USR-C', 'ПОВАР', '927364');
G.insertRow_('DISHES', { dish_id: 'DISH-1', organization_id: 'ORG-1', название: 'Борщ', цена_продажи: 350, статус: 'активно' });
function login(u, p) { const d = api('LOGIN', { userId: u, pin: p }); return d.requires_location ? (api('SELECT_LOCATION', { locationId: 'LOC-1' }, d.token).token || d.token) : d.token; }
const tM = login('USR-M', '482915'), tK = login('USR-K', '739164'), tW = login('USR-W', '615283'), tC = login('USR-C', '927364');
api('POS_OPEN_SHIFT', { cashStart: 0 }, tK);
const hall = api('POS_SAVE_HALL', { название: 'Зал' }, tM);
const t1 = api('POS_SAVE_TABLE', { hallId: hall.hall_id, название: '1' }, tM);

step('B1: заказ «с собой» после оплаты попадает на экран кухни', () => {
  let v = api('POS_CREATE_ORDER', {}, tK);
  v = api('POS_ADD_LINE', { orderId: v.order.order_id, dishId: 'DISH-1', qty: 2, version: v.order.version }, tK);
  api('POS_PAY', { orderId: v.order.order_id, version: v.order.version, operationId: 'B1', payments: [{ способ: 'карта', сумма: 700 }] }, tK);
  const q = api('POS_GET_KITCHEN_QUEUE', {}, tC);
  assert(q.some(x => x.order_id === v.order.order_id && x.стол === 'с собой' && x.статус === 'на_кухне'), 'в очереди кухни нет заказа с собой');
});
step('B2: пустой заказ на столе не блокирует закрытие смены кассиром', () => {
  api('POS_CREATE_ORDER', { tableId: t1.table_id }, tW); // официант открыл стол и ничего не добавил
  api('POS_CLOSE_SHIFT', { cashFact: 0 }, tK);
  assert.equal(G.findRows_('POS_ORDERS', o => o.table_id === t1.table_id)[0].статус, 'отменён');
  api('POS_OPEN_SHIFT', { cashStart: 0 }, tK);
});
step('B2: официант сам убирает свой пустой заказ, но не заказ с позициями', () => {
  const v = api('POS_CREATE_ORDER', { tableId: t1.table_id }, tW);
  api('POS_DISCARD_EMPTY_ORDER', { orderId: v.order.order_id }, tW);
  assert.equal(api('POS_GET_FLOOR', {}, tW).halls[0].tables[0].статус, 'свободен');
  let v2 = api('POS_CREATE_ORDER', { tableId: t1.table_id }, tW);
  v2 = api('POS_ADD_LINE', { orderId: v2.order.order_id, dishId: 'DISH-1', version: v2.order.version }, tW);
  assert(/есть позиции/.test(apiErr('POS_DISCARD_EMPTY_ORDER', { orderId: v2.order.order_id }, tW)));
  api('POS_CANCEL_ORDER', { orderId: v2.order.order_id, reason: 'тест' }, tM);
});
step('B3: касса работает, когда лист заказов больше лимита кэша (100 КБ)', () => {
  // ~900 оплаченных заказов дают POS_ORDERS и POS_ORDER_LINES больше 100 КБ.
  for (let i = 0; i < 900; i++) {
    G.insertRow_('POS_ORDERS', { order_id: 'PORD-BULK' + i, organization_id: 'ORG-1', location_id: 'LOC-1', shift_id: 'PSH-OLD', table_id: '', официант_id: 'USR-K',
      номер: i + 1, гостей: 0, статус: 'оплачен', сумма: 350, скидка: 0, итого: 350, комментарий: 'архивный заказ для проверки объёма', version: 2,
      создано: G.nowIso_(), обновлено: G.nowIso_(), оплачен: G.nowIso_(), cascade_id: 'CSC-' + i });
  }
  const v = api('POS_CREATE_ORDER', {}, tK);
  assert(v.order.order_id);
  assert(Array.isArray(api('POS_GET_ORDERS', {}, tK)));
});
console.log(failures ? '\n' + failures + ' FAILED' : '\nALL PASSED');
process.exit(failures ? 1 : 0);
