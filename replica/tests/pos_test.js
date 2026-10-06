const assert = require('assert');
const { ctx, sheets } = require('./harness.js');
const G = ctx;
let failures = 0;
function step(name, fn) {
  try { const r = fn(); console.log('OK   ', name); return r; }
  catch (e) { failures++; console.log('FAIL ', name, '—', e && e.message); }
}
function api(action, data, token) {
  const r = G.processOperation(action, data || {}, token);
  if (!r.ok) throw new Error(action + ': ' + r.error);
  return r.data;
}
function apiErr(action, data, token) {
  const r = G.processOperation(action, data || {}, token);
  assert(!r.ok, action + ' должен был вернуть ошибку');
  return r.error;
}

G.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', 'SS');
step('initializeDatabase создаёт листы кассы', () => {
  G.initializeDatabase();
  ['POS_SHIFTS', 'POS_ORDERS', 'POS_ORDER_LINES', 'POS_PAYMENTS'].forEach(n => assert(sheets[n], 'нет листа ' + n));
});

// Организация, точка, пользователи.
const org = { organization_id: 'ORG-1', название: 'Тест', статус: 'активна', создано: G.nowIso_() };
G.insertRow_('ORGANIZATIONS', org);
G.insertRow_('LOCATIONS', { location_id: 'LOC-1', organization_id: 'ORG-1', название: 'Точка 1', статус: 'активна', создано: G.nowIso_() });
function mkUser(id, role, pin) {
  const salt = 'salt' + id;
  G.insertRow_('USERS', { user_id: id, organization_id: 'ORG-1', location_ids: 'LOC-1', имя: role, роль: role, статус: 'активен', pin_hash: G.hashPin_(pin, salt), pin_salt: salt, failed_attempts: 0, lockout_count: 0, создано: G.nowIso_() });
}
mkUser('USR-K', 'КАССИР', '482915'); mkUser('USR-M', 'МЕНЕДЖЕР', '739164'); mkUser('USR-P', 'ПОВАР', '615283');
G.insertRow_('CATEGORIES', { category_id: 'CAT-1', название: 'Горячее', тип: 'блюдо' });
G.insertRow_('DISHES', { dish_id: 'DISH-1', organization_id: 'ORG-1', название: 'Борщ', категория_id: 'CAT-1', цена_продажи: 350, себестоимость: 90, статус: 'активно', version: 1 });
G.insertRow_('DISHES', { dish_id: 'DISH-2', organization_id: 'ORG-1', название: 'Морс', категория_id: '', цена_продажи: 120.5, себестоимость: 20, статус: 'активно', version: 1 });
G.insertRow_('DISHES', { dish_id: 'DISH-3', organization_id: 'ORG-1', название: 'Без цены', цена_продажи: 0, статус: 'активно' });
G.insertRow_('DISHES', { dish_id: 'DISH-X', organization_id: 'ORG-2', название: 'Чужое', цена_продажи: 10, статус: 'активно' });

function login(userId, pin) {
  const d = api('LOGIN', { userId, pin });
  let token = d.token;
  if (d.requires_location) token = api('SELECT_LOCATION', { locationId: 'LOC-1' }, token).token || token;
  return token;
}
const tK = step('вход кассира', () => login('USR-K', '482915'));
const tM = step('вход менеджера', () => login('USR-M', '739164'));
const tP = step('вход повара', () => login('USR-P', '615283'));

step('повар не имеет доступа к кассе', () => { assert(/Недостаточно прав/.test(apiErr('POS_GET_SHIFT', {}, tP))); });
step('нет смены → заказ не создаётся', () => { assert(/Смена не открыта/.test(apiErr('POS_CREATE_ORDER', {}, tK))); });
step('открытие смены', () => { const d = api('POS_OPEN_SHIFT', { cashStart: 1000 }, tK); assert.equal(d.shift.статус, 'открыта'); });
step('вторую смену открыть нельзя', () => { assert(/уже открыта/.test(apiErr('POS_OPEN_SHIFT', {}, tK))); });

step('меню: только блюда своей организации с ценой', () => {
  const m = api('POS_GET_MENU', {}, tK);
  const ids = m.dishes.map(d => d.dish_id).sort();
  assert.deepEqual(ids, ['DISH-1', 'DISH-2']);
  assert(m.categories.includes('Горячее') && m.categories.includes('Без категории'));
});

let order;
step('создать заказ и добавить позиции', () => {
  order = api('POS_CREATE_ORDER', {}, tK).order;
  assert.equal(order.номер, 1);
  let v = api('POS_ADD_LINE', { orderId: order.order_id, dishId: 'DISH-1', qty: 1, version: order.version }, tK);
  v = api('POS_ADD_LINE', { orderId: order.order_id, dishId: 'DISH-1', qty: 1, version: v.order.version }, tK);
  v = api('POS_ADD_LINE', { orderId: order.order_id, dishId: 'DISH-2', qty: 1, version: v.order.version }, tK);
  assert.equal(v.lines.length, 2, 'одинаковые блюда объединяются в одну строку');
  assert.equal(v.order.итого, 820.5);
  order = v.order;
});
step('чужое блюдо добавить нельзя', () => { apiErr('POS_ADD_LINE', { orderId: order.order_id, dishId: 'DISH-X', version: order.version }, tK); });
step('блюдо без цены добавить нельзя', () => { assert(/цена продажи/.test(apiErr('POS_ADD_LINE', { orderId: order.order_id, dishId: 'DISH-3', version: order.version }, tK))); });
step('устаревшая версия заказа отклоняется', () => { assert(/другом устройстве/.test(apiErr('POS_ADD_LINE', { orderId: order.order_id, dishId: 'DISH-1', version: 1 }, tK))); });
step('изменить количество и удалить строку', () => {
  const lines = api('POS_GET_ORDER', { orderId: order.order_id }, tK).lines;
  const mors = lines.find(l => l.dish_id === 'DISH-2');
  let v = api('POS_UPDATE_LINE', { lineId: mors.line_id, qty: 3, version: order.version }, tK);
  assert.equal(v.order.итого, 700 + 361.5);
  v = api('POS_UPDATE_LINE', { lineId: mors.line_id, qty: 0, version: v.order.version }, tK);
  assert.equal(v.lines.length, 1); assert.equal(v.order.итого, 700);
  order = v.order;
});
step('недостаточная оплата отклоняется', () => { assert(/Не хватает/.test(apiErr('POS_PAY', { orderId: order.order_id, version: order.version, payments: [{ способ: 'нал', сумма: 500 }] }, tK))); });
step('безнал больше суммы отклоняется', () => { assert(/больше суммы/.test(apiErr('POS_PAY', { orderId: order.order_id, version: order.version, payments: [{ способ: 'карта', сумма: 900 }] }, tK))); });

let paid;
const opId = 'POSPAY-TEST-1';
step('оплата наличными со сдачей', () => {
  paid = api('POS_PAY', { orderId: order.order_id, version: order.version, operationId: opId, payments: [{ способ: 'нал', сумма: 1000 }] }, tK);
  assert.equal(paid.order.статус, 'оплачен'); assert.equal(paid.сдача, 300);
  assert.equal(paid.payments.length, 1); assert.equal(paid.payments[0].сумма, 700);
});
step('повтор оплаты с тем же operationId не создаёт вторую оплату', () => {
  const again = G.processOperation('POS_PAY', { orderId: order.order_id, version: order.version, operationId: opId, payments: [{ способ: 'нал', сумма: 1000 }] }, tK);
  const pays = G.findRows_('POS_PAYMENTS', p => p.order_id === order.order_id);
  assert.equal(pays.length, 1, 'оплат: ' + pays.length + ' (ответ повтора: ' + JSON.stringify(again).slice(0, 120) + ')');
});
step('оплата создала продажу в SALES (источник касса)', () => {
  const sales = G.findRows_('SALES', s => s.источник === 'касса');
  assert.equal(sales.length, 1); assert.equal(sales[0].qty, 2); assert.equal(sales[0].сумма, 700); assert.equal(sales[0].location_id, 'LOC-1');
});
step('оплаченный заказ изменить нельзя', () => { apiErr('POS_ADD_LINE', { orderId: order.order_id, dishId: 'DISH-1', version: paid.order.version }, tK); });

step('кассир не может отменять заказы', () => {
  const o2 = api('POS_CREATE_ORDER', {}, tK).order;
  assert(/Недостаточно прав/.test(apiErr('POS_CANCEL_ORDER', { orderId: o2.order_id }, tK)));
  api('POS_CANCEL_ORDER', { orderId: o2.order_id }, tM);
});
step('смену нельзя закрыть с открытым заказом', () => {
  const o3 = api('POS_CREATE_ORDER', {}, tK).order;
  api('POS_ADD_LINE', { orderId: o3.order_id, dishId: 'DISH-2', version: o3.version }, tK);
  assert(/неоплаченные/.test(apiErr('POS_CLOSE_SHIFT', { cashFact: 1700 }, tK)));
  const v = api('POS_GET_ORDER', { orderId: o3.order_id }, tK);
  api('POS_PAY', { orderId: o3.order_id, version: v.order.version, operationId: 'POSPAY-TEST-2', payments: [{ способ: 'карта', сумма: 120.5 }] }, tK);
});

step('фоновое списание: нет ТТК → ошибка исполнения и одна задача шеф-повару', () => {
  G.posFulfillPendingSalesTrigger_();
  G.posFulfillPendingSalesTrigger_();
  const sales = G.findRows_('SALES', s => s.источник === 'касса');
  sales.forEach(s => assert.equal(s.исполнение_статус, 'ошибка_исполнения'));
  const tasks = G.findRows_('TASKS', t => /Касса: не списано по ТТК/.test(t.title));
  assert.equal(tasks.length, sales.length, 'задач: ' + tasks.length + ', продаж: ' + sales.length);
});

step('X-отчёт и закрытие смены с расхождением', () => {
  const x = api('POS_GET_SHIFT', {}, tK).totals;
  assert.equal(x.нал, 700); assert.equal(x.карта, 120.5); assert.equal(x.заказов, 2); assert.equal(x.нал_ожидается, 1700);
  const r = api('POS_CLOSE_SHIFT', { cashFact: 1650 }, tK);
  assert.equal(r.расхождение_нал, -50); assert.equal(r.shift.статус, 'закрыта');
});

step('runPosTests_ — все проверки OK', () => {
  const bad = G.runPosTests_().filter(t => t.status !== 'OK');
  assert.equal(bad.length, 0, JSON.stringify(bad));
});

console.log(failures ? '\n' + failures + ' FAILED' : '\nALL PASSED');
process.exit(failures ? 1 : 0);
