// Этап M2: зал и столы, официант, кухня. Запуск: node replica/tests/pos_floor_test.js
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
function mk(id, role, pin) { const s = 's' + id; G.insertRow_('USERS', { user_id: id, organization_id: 'ORG-1', location_ids: 'LOC-1', имя: role + ' ' + id, роль: role, статус: 'активен', pin_hash: G.hashPin_(pin, s), pin_salt: s, failed_attempts: 0, lockout_count: 0 }); }
mk('USR-M', 'МЕНЕДЖЕР', '482915'); mk('USR-K', 'КАССИР', '739164'); mk('USR-W1', 'ОФИЦИАНТ', '615283'); mk('USR-W2', 'ОФИЦИАНТ', '927364'); mk('USR-C', 'ПОВАР', '351846');
G.insertRow_('DISHES', { dish_id: 'DISH-1', organization_id: 'ORG-1', название: 'Борщ', цена_продажи: 350, статус: 'активно' });
G.insertRow_('DISHES', { dish_id: 'DISH-2', organization_id: 'ORG-1', название: 'Морс', цена_продажи: 120, статус: 'активно' });
function login(u, p) { const d = api('LOGIN', { userId: u, pin: p }); return d.requires_location ? (api('SELECT_LOCATION', { locationId: 'LOC-1' }, d.token).token || d.token) : d.token; }
const tM = login('USR-M', '482915'), tK = login('USR-K', '739164'), tW1 = login('USR-W1', '615283'), tW2 = login('USR-W2', '927364'), tC = login('USR-C', '351846');

let hall, t1, t2, t3;
step('менеджер создаёт зал и столы', () => {
  hall = api('POS_SAVE_HALL', { название: 'Основной зал' }, tM);
  t1 = api('POS_SAVE_TABLE', { hallId: hall.hall_id, название: '1', мест: 4 }, tM);
  t2 = api('POS_SAVE_TABLE', { hallId: hall.hall_id, название: '2', мест: 2 }, tM);
  t3 = api('POS_SAVE_TABLE', { hallId: hall.hall_id, название: '10', мест: 6 }, tM);
  assert(/уже есть/.test(apiErr('POS_SAVE_TABLE', { hallId: hall.hall_id, название: '1' }, tM)));
});
step('официант не может настраивать зал', () => { assert(/Недостаточно прав/.test(apiErr('POS_SAVE_HALL', { название: 'X' }, tW1))); });
step('схема зала: столы по порядку, все свободны', () => {
  const f = api('POS_GET_FLOOR', {}, tW1);
  assert.deepEqual(f.halls[0].tables.map(t => t.название), ['1', '2', '10']);
  assert(f.halls[0].tables.every(t => t.статус === 'свободен'));
  assert.equal(f.shift_open, false);
});
step('официант не открывает смену', () => { assert(/Недостаточно прав/.test(apiErr('POS_OPEN_SHIFT', { cashStart: 0 }, tW1))); });
api('POS_OPEN_SHIFT', { cashStart: 0 }, tK);
step('официант не видит выручку смены', () => { const s = api('POS_GET_SHIFT', {}, tW1); assert(s.shift && s.totals === null); });
step('официант без стола заказ не создаёт', () => { assert(/Выберите стол/.test(apiErr('POS_CREATE_ORDER', {}, tW1))); });

let o1;
step('официант 1 открывает стол 1 и добавляет блюда', () => {
  o1 = api('POS_CREATE_ORDER', { tableId: t1.table_id, guests: 3 }, tW1);
  assert.equal(o1.table.название, '1');
  let v = api('POS_ADD_LINE', { orderId: o1.order.order_id, dishId: 'DISH-1', qty: 2, version: o1.order.version }, tW1);
  v = api('POS_ADD_LINE', { orderId: o1.order.order_id, dishId: 'DISH-2', qty: 3, version: v.order.version }, tW1);
  o1 = v; assert.equal(v.order.итого, 1060);
});
step('второй заказ на занятый стол не создаётся', () => { assert(/уже есть открытый заказ/.test(apiErr('POS_CREATE_ORDER', { tableId: t1.table_id }, tW2))); });
step('официант 2 не видит и не меняет чужой стол', () => {
  assert(/другой официант/.test(apiErr('POS_GET_ORDER', { orderId: o1.order.order_id }, tW2)));
  assert(/другой официант/.test(apiErr('POS_ADD_LINE', { orderId: o1.order.order_id, dishId: 'DISH-1', version: o1.order.version }, tW2)));
  assert.equal(api('POS_GET_ORDERS', {}, tW2).length, 0);
});
step('отправка на кухню', () => {
  const v = api('POS_SEND_TO_KITCHEN', { orderId: o1.order.order_id, version: o1.order.version }, tW1);
  assert(v.lines.every(l => l.статус === 'на_кухне' && l.на_кухню_в));
  assert(/Новых позиций/.test(apiErr('POS_SEND_TO_KITCHEN', { orderId: o1.order.order_id, version: v.order.version }, tW1)));
  o1 = v;
});
step('позицию на кухне изменить нельзя', () => {
  assert(/уже на кухне/.test(apiErr('POS_UPDATE_LINE', { lineId: o1.lines[0].line_id, qty: 1, version: o1.order.version }, tW1)));
});
step('дозаказ: новая позиция отдельной строкой', () => {
  const v = api('POS_ADD_LINE', { orderId: o1.order.order_id, dishId: 'DISH-1', qty: 1, version: o1.order.version }, tW1);
  assert.equal(v.lines.length, 3); assert.equal(v.lines.filter(l => l.статус === 'новая').length, 1);
  o1 = api('POS_SEND_TO_KITCHEN', { orderId: o1.order.order_id, version: v.order.version }, tW1);
});
step('кухня: официант не видит очередь, повар видит и отмечает готовность', () => {
  assert(/Недостаточно прав/.test(apiErr('POS_GET_KITCHEN_QUEUE', {}, tW1)));
  const q = api('POS_GET_KITCHEN_QUEUE', {}, tC);
  assert.equal(q.length, 3); assert(q.every(x => x.стол === '1' && x.статус === 'на_кухне'));
  api('POS_MARK_LINE_READY', { lineId: q[0].line_id }, tC);
  assert(/не в очереди/.test(apiErr('POS_MARK_LINE_READY', { lineId: q[0].line_id }, tC)));
  const q2 = api('POS_GET_KITCHEN_QUEUE', {}, tC);
  assert.equal(q2.filter(x => x.статус === 'готово').length, 1);
});
step('схема зала показывает занятость, официанта и позиции', () => {
  const t = api('POS_GET_FLOOR', {}, tW2).halls[0].tables.find(x => x.table_id === t1.table_id);
  assert.equal(t.статус, 'занят'); assert.equal(t.официант, 'ОФИЦИАНТ USR-W1'); assert.equal(t.мой, false);
  assert.deepEqual(t.позиции, { новых: 0, на_кухне: 2, готово: 1 });
});
step('перенос заказа: на занятый стол нельзя, на свободный можно', () => {
  const o2 = api('POS_CREATE_ORDER', { tableId: t2.table_id }, tW2);
  assert(/занят/.test(apiErr('POS_MOVE_ORDER', { orderId: o1.order.order_id, tableId: t2.table_id }, tW1)));
  const v = api('POS_MOVE_ORDER', { orderId: o1.order.order_id, tableId: t3.table_id }, tW1);
  assert.equal(v.table.название, '10'); o1 = v;
  api('POS_CANCEL_ORDER', { orderId: o2.order.order_id }, tM);
});
step('официант не принимает оплату', () => { assert(/Недостаточно прав/.test(apiErr('POS_PAY', { orderId: o1.order.order_id, payments: [{ способ: 'нал', сумма: 2000 }] }, tW1))); });
step('пречек блокирует заказ для официанта', () => {
  o1 = api('POS_PRECHECK', { orderId: o1.order.order_id, version: o1.order.version }, tW1);
  assert.equal(o1.order.статус, 'пречек');
  assert(/уже пречек/.test(apiErr('POS_ADD_LINE', { orderId: o1.order.order_id, dishId: 'DISH-2', version: o1.order.version }, tW1)));
  assert.equal(api('POS_GET_FLOOR', {}, tK).halls[0].tables.find(x => x.table_id === t3.table_id).статус, 'пречек');
});
step('менеджер снимает пречек, официант ставит снова', () => {
  const v = api('POS_REOPEN_ORDER', { orderId: o1.order.order_id }, tM);
  assert.equal(v.order.статус, 'открыт');
  o1 = api('POS_PRECHECK', { orderId: o1.order.order_id, version: v.order.version }, tW1);
});
step('кассир оплачивает заказ на пречеке, стол освобождается', () => {
  const r = api('POS_PAY', { orderId: o1.order.order_id, version: o1.order.version, operationId: 'PAY-T10', payments: [{ способ: 'карта', сумма: o1.order.итого }] }, tK);
  assert.equal(r.order.статус, 'оплачен'); assert.equal(r.order.итого, 1410);
  assert.equal(api('POS_GET_FLOOR', {}, tK).halls[0].tables.find(x => x.table_id === t3.table_id).статус, 'свободен');
  assert.equal(G.findRows_('SALES', s => s.источник === 'касса').length, 3);
});
step('стол с открытым заказом нельзя убрать в архив', () => {
  api('POS_CREATE_ORDER', { tableId: t1.table_id }, tW1);
  assert(/открытый заказ/.test(apiErr('POS_SAVE_TABLE', { tableId: t1.table_id, hallId: hall.hall_id, название: '1', статус: 'архив' }, tM)));
});
step('runPosTests_ — все проверки OK', () => {
  const bad = G.runPosTests_().filter(t => t.status !== 'OK'); assert.equal(bad.length, 0, JSON.stringify(bad));
});
console.log(failures ? '\n' + failures + ' FAILED' : '\nALL PASSED');
process.exit(failures ? 1 : 0);
