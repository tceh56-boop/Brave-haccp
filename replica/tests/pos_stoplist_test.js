// Этап M4: стоп-лист. Запуск: node replica/tests/pos_stoplist_test.js
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
mk('USR-D', 'ДИРЕКТОР', '482915'); mk('USR-T', 'ТЕХНОЛОГ_HACCP', '739164'); mk('USR-K', 'КАССИР', '615283'); mk('USR-P', 'ПОВАР', '927364');
function login(u, p) { const d = api('LOGIN', { userId: u, pin: p }); return d.requires_location ? (api('SELECT_LOCATION', { locationId: 'LOC-1' }, d.token).token || d.token) : d.token; }
const tD = login('USR-D', '482915'), tT = login('USR-T', '739164'), tK = login('USR-K', '615283'), tP = login('USR-P', '927364');

// Борщ по ТТК: 0,2 кг свёклы на порцию. На складе 0,5 кг → 2 порции.
const beet = api('CREATE_PRODUCT', { название: 'Свёкла', единица: 'кг', цена: 50 }, tD);
const beetId = beet.product_id || (beet.product && beet.product.product_id);
api('RECEIVE_GOODS', { productId: beetId, qty: 0.5, price: 50, expiryDate: '2099-01-01', productionDate: '2026-10-01' }, tD);
const dish = api('CREATE_DISH', { название: 'Борщ', выход: 300, цена_продажи: 350 }, tD);
api('ADD_RECIPE_LINE', { parentType: 'DISH', parentId: dish.dish_id, ingredientId: beetId, брутто: 0.2, нетто: 0.16, единица: 'кг' }, tD);
const v = api('CREATE_TTK_VERSION', { dishId: dish.dish_id, технология: 'Свёклу очистить, нарезать соломкой, варить 40 минут', условия_хранения: '+2..+6 °C', срок_реализации: '24 ч' }, tD);
api('SUBMIT_TTK_FOR_APPROVAL', { ttkVersionId: v.ttk_version_id }, tD);
api('APPROVE_TTK_VERSION', { ttkVersionId: v.ttk_version_id }, tT);
const tea = api('CREATE_DISH', { название: 'Чай', выход: 200, цена_продажи: 100 }, tD); // без ТТК

step('кассир не ведёт стоп-лист', () => {
  assert(/Недостаточно прав/.test(apiErr('POS_SET_STOP', { dishId: tea.dish_id, reason: 'x' }, tK)));
  assert(/Недостаточно прав/.test(apiErr('POS_RECALC_STOP_LIST', {}, tK)));
});
step('пересчёт: 2 порции — не стоп, но «осталось мало»; блюдо без ТТК не трогается', () => {
  const r = api('POS_RECALC_STOP_LIST', {}, tD);
  assert.equal(r.stopped.length, 0); assert.equal(r.no_ttk, 1);
  assert.deepEqual(r.low.map(x => [x.название, x.порций]), [['Борщ', 2]]);
});
api('POS_OPEN_SHIFT', { cashStart: 0 }, tK);
step('продали 2 борща → после списания сырья пересчёт ставит авто-стоп с причиной', () => {
  let o = api('POS_CREATE_ORDER', {}, tK).order;
  o = api('POS_ADD_LINE', { orderId: o.order_id, dishId: dish.dish_id, qty: 2, version: o.version }, tK).order;
  api('POS_PAY', { orderId: o.order_id, version: o.version, operationId: 'S1', payments: [{ способ: 'карта', сумма: 700 }] }, tK);
  G.posFulfillPendingSalesTrigger_(); // списание + пересчёт (смена открыта)
  assert(Math.abs(G.getUsableStockLevel_(beetId, 'LOC-1') - 0.1) < 1e-9);
  const list = api('POS_GET_STOP_LIST', {}, tP).stops;
  assert.equal(list.length, 1); assert.equal(list[0].источник, 'авто_остатки');
  assert(/Не хватает: Свёкла \(есть 0.1 кг, нужно 0.2 кг на порцию\)/.test(list[0].причина), list[0].причина);
  assert.equal(list[0].кто, 'автоматически');
});
step('касса: блюдо помечено стопом в меню и не добавляется', () => {
  const m = api('POS_GET_MENU', {}, tK).dishes.find(d => d.dish_id === dish.dish_id);
  assert(m.стоп && m.стоп.источник === 'авто_остатки');
  const o = api('POS_CREATE_ORDER', {}, tK).order;
  assert(/в стоп-листе: Не хватает: Свёкла/.test(apiErr('POS_ADD_LINE', { orderId: o.order_id, dishId: dish.dish_id, version: o.version }, tK)));
  api('POS_CANCEL_ORDER', { orderId: o.order_id }, tD);
});
step('повторный пересчёт не дублирует авто-стоп', () => {
  api('POS_RECALC_STOP_LIST', {}, tD);
  assert.equal(api('POS_GET_STOP_LIST', {}, tD).stops.length, 1);
});
step('приход свёклы → пересчёт снимает авто-стоп', () => {
  api('RECEIVE_GOODS', { productId: beetId, qty: 3, price: 50, expiryDate: '2099-01-01', productionDate: '2026-10-05' }, tD);
  const r = api('POS_RECALC_STOP_LIST', {}, tD);
  assert.deepEqual(r.lifted.map(x => x.название), ['Борщ']);
  assert.equal(api('POS_GET_STOP_LIST', {}, tD).stops.length, 0);
  assert.equal(api('POS_GET_MENU', {}, tK).dishes.find(d => d.dish_id === dish.dish_id).стоп, null);
});
let manual;
step('повар ставит ручной стоп с причиной; без причины нельзя; дубль нельзя', () => {
  assert(/Укажите причину/.test(apiErr('POS_SET_STOP', { dishId: tea.dish_id }, tP)));
  manual = api('POS_SET_STOP', { dishId: tea.dish_id, reason: 'Сломался чайник' }, tP);
  assert(/уже в стоп-листе/.test(apiErr('POS_SET_STOP', { dishId: tea.dish_id, reason: 'ещё раз' }, tP)));
  const o = api('POS_CREATE_ORDER', {}, tK).order;
  assert(/Сломался чайник/.test(apiErr('POS_ADD_LINE', { orderId: o.order_id, dishId: tea.dish_id, version: o.version }, tK)));
  api('POS_CANCEL_ORDER', { orderId: o.order_id }, tD);
});
step('пересчёт по остаткам не снимает ручной стоп', () => {
  api('POS_RECALC_STOP_LIST', {}, tD);
  const list = api('POS_GET_STOP_LIST', {}, tD).stops;
  assert.equal(list.length, 1); assert.equal(list[0].источник, 'ручной'); assert.equal(list[0].кто, 'ПОВАР');
});
step('снятие стопа: строка остаётся в истории со временем и автором', () => {
  api('POS_CLEAR_STOP', { stopId: manual.stop_id }, tP);
  assert(/уже снят/.test(apiErr('POS_CLEAR_STOP', { stopId: manual.stop_id }, tP)));
  const row = G.findOne_('STOP_LIST', 'stop_id', manual.stop_id);
  assert(row.снято && row.снял_id === 'USR-P');
  assert.equal(G.findRows_('STOP_LIST', () => true).length, 2);
});
step('фоновый пересчёт не идёт на точке без открытой смены', () => {
  api('POS_CLOSE_SHIFT', { cashFact: 0 }, tK);
  const before = G.findRows_('STOP_LIST', () => true).length;
  // Списываем всю свёклу напрямую, затем тик: смены нет — авто-стоп не ставится.
  G.consumeStock_(beetId, 'LOC-1', G.getUsableStockLevel_(beetId, 'LOC-1'), G.OP_TYPES.ISSUE, 'USR-D', null);
  G.posFulfillPendingSalesTrigger_();
  assert.equal(G.findRows_('STOP_LIST', () => true).length, before);
});
step('runPosTests_ — все проверки OK', () => {
  const bad = G.runPosTests_().filter(t => t.status !== 'OK'); assert.equal(bad.length, 0, JSON.stringify(bad));
});
console.log(failures ? '\n' + failures + ' FAILED' : '\nALL PASSED');
process.exit(failures ? 1 : 0);
