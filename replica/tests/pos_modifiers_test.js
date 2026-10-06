// Этап M3: модификаторы. Запуск: node replica/tests/pos_modifiers_test.js
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
mk('USR-D', 'ДИРЕКТОР', '482915'); mk('USR-K', 'КАССИР', '739164');
function login(u, p) { const d = api('LOGIN', { userId: u, pin: p }); return d.requires_location ? (api('SELECT_LOCATION', { locationId: 'LOC-1' }, d.token).token || d.token) : d.token; }
const tD = login('USR-D', '482915'), tK = login('USR-K', '739164');

const cheese = api('CREATE_PRODUCT', { название: 'Сыр', единица: 'кг', цена: 800 }, tD);
const cheeseId = cheese.product_id || (cheese.product && cheese.product.product_id);
api('RECEIVE_GOODS', { productId: cheeseId, qty: 2, price: 800, expiryDate: '2099-01-01', productionDate: '2026-10-01' }, tD);
const bacon = api('CREATE_PRODUCT', { название: 'Бекон', единица: 'кг', цена: 1200 }, tD);
const baconId = bacon.product_id || (bacon.product && bacon.product.product_id);
G.insertRow_('DISHES', { dish_id: 'DISH-P', organization_id: 'ORG-1', название: 'Пицца', цена_продажи: 500, статус: 'активно' });
G.insertRow_('DISHES', { dish_id: 'DISH-T', organization_id: 'ORG-1', название: 'Чай', цена_продажи: 100, статус: 'активно' });

let size, extra, note, m = {};
step('кассир не настраивает модификаторы', () => { assert(/Недостаточно прав/.test(apiErr('POS_SAVE_MODIFIER_GROUP', { название: 'X' }, tK))); });
step('директор создаёт группы и модификаторы', () => {
  size = api('POS_SAVE_MODIFIER_GROUP', { название: 'Размер', мин: 1, макс: 1 }, tD);
  extra = api('POS_SAVE_MODIFIER_GROUP', { название: 'Добавки', мин: 0, макс: 2 }, tD);
  note = api('POS_SAVE_MODIFIER_GROUP', { название: 'Пожелания', мин: 0, макс: 0 }, tD);
  assert(/Минимум не может/.test(apiErr('POS_SAVE_MODIFIER_GROUP', { название: 'Z', мин: 3, макс: 1 }, tD)));
  m.s25 = api('POS_SAVE_MODIFIER', { groupId: size.group_id, название: '25 см', цена_delta: -100 }, tD);
  m.s30 = api('POS_SAVE_MODIFIER', { groupId: size.group_id, название: '30 см', цена_delta: 0 }, tD);
  m.cheese = api('POS_SAVE_MODIFIER', { groupId: extra.group_id, название: 'Двойной сыр', цена_delta: 90, productId: cheeseId, расход_qty: 0.05 }, tD);
  m.bacon = api('POS_SAVE_MODIFIER', { groupId: extra.group_id, название: 'Бекон', цена_delta: 120, productId: baconId, расход_qty: 0.04 }, tD);
  m.olive = api('POS_SAVE_MODIFIER', { groupId: extra.group_id, название: 'Оливки', цена_delta: 60 }, tD);
  m.noOnion = api('POS_SAVE_MODIFIER', { groupId: note.group_id, название: 'Без лука', цена_delta: 0 }, tD);
  assert.equal(m.cheese.единица, 'кг');
  assert(/расход продукта/.test(apiErr('POS_SAVE_MODIFIER', { groupId: extra.group_id, название: 'Y', productId: cheeseId }, tD)));
});
step('привязка групп к блюду и меню кассы', () => {
  api('POS_LINK_DISH_MODIFIERS', { dishId: 'DISH-P', groupIds: [size.group_id, extra.group_id, note.group_id] }, tD);
  const p = api('POS_GET_MENU', {}, tK).dishes.find(d => d.dish_id === 'DISH-P');
  assert.deepEqual(p.modifier_groups.map(g => g.название), ['Размер', 'Добавки', 'Пожелания']);
  assert.equal(p.modifier_groups[1].modifiers.length, 3);
  assert.equal(api('POS_GET_MENU', {}, tK).dishes.find(d => d.dish_id === 'DISH-T').modifier_groups.length, 0);
});
api('POS_OPEN_SHIFT', { cashStart: 0 }, tK);
let o = api('POS_CREATE_ORDER', {}, tK).order;
step('обязательная группа не выбрана → ошибка', () => { assert(/Группа «Размер»: выберите вариант/.test(apiErr('POS_ADD_LINE', { orderId: o.order_id, dishId: 'DISH-P', modifierIds: [], version: o.version }, tK))); });
step('больше максимума → ошибка', () => { assert(/не больше 2/.test(apiErr('POS_ADD_LINE', { orderId: o.order_id, dishId: 'DISH-P', modifierIds: [m.s30.modifier_id, m.cheese.modifier_id, m.bacon.modifier_id, m.olive.modifier_id], version: o.version }, tK))); });
step('модификатор не этого блюда → ошибка', () => { assert(/недоступен/.test(apiErr('POS_ADD_LINE', { orderId: o.order_id, dishId: 'DISH-T', modifierIds: [m.cheese.modifier_id], version: o.version }, tK))); });
step('цена с модификаторами и снимок в строке', () => {
  const v = api('POS_ADD_LINE', { orderId: o.order_id, dishId: 'DISH-P', modifierIds: [m.s25.modifier_id, m.cheese.modifier_id, m.noOnion.modifier_id], version: o.version }, tK);
  assert.equal(v.lines[0].цена, 490); // 500 − 100 + 90
  const snap = JSON.parse(v.lines[0].модификаторы_json);
  assert.deepEqual(snap.map(x => x.название), ['25 см', 'Двойной сыр', 'Без лука']);
  o = v.order;
});
step('тот же набор модификаторов — та же строка, другой — новая', () => {
  let v = api('POS_ADD_LINE', { orderId: o.order_id, dishId: 'DISH-P', modifierIds: [m.cheese.modifier_id, m.noOnion.modifier_id, m.s25.modifier_id], version: o.version }, tK);
  assert.equal(v.lines.length, 1); assert.equal(v.lines[0].qty, 2);
  v = api('POS_ADD_LINE', { orderId: o.order_id, dishId: 'DISH-P', modifierIds: [m.s30.modifier_id, m.bacon.modifier_id], version: v.order.version }, tK);
  assert.equal(v.lines.length, 2); assert.equal(v.order.итого, 490 * 2 + 620);
  o = v.order;
});
step('оплата создаёт очередь списания продуктов модификаторов', () => {
  api('POS_PAY', { orderId: o.order_id, version: o.version, operationId: 'M3-PAY', payments: [{ способ: 'карта', сумма: o.итого }] }, tK);
  const u = G.findRows_('POS_MODIFIER_USAGE', x => x.order_id === o.order_id);
  assert.equal(u.length, 2);
  const c = u.find(x => x.product_id === cheeseId); assert.equal(c.qty, 0.1); assert.equal(c.статус, 'ожидает');
});
step('фоновое списание: сыр списан, бекона нет на складе → ошибка и одна задача', () => {
  const before = G.getStockLevel_(cheeseId, 'LOC-1');
  G.posFulfillPendingSalesTrigger_(); G.posFulfillPendingSalesTrigger_();
  const after = G.getStockLevel_(cheeseId, 'LOC-1');
  assert.equal(Math.round((before - after) * 1000) / 1000, 0.1, 'сыр: ' + before + ' → ' + after);
  const u = G.findRows_('POS_MODIFIER_USAGE', x => x.order_id === o.order_id);
  assert.equal(u.find(x => x.product_id === cheeseId).статус, 'списано');
  assert.equal(u.find(x => x.product_id === baconId).статус, 'ошибка');
  assert.equal(G.findRows_('TASKS', t => /модификатора — Бекон/.test(t.title)).length, 1);
});
step('после прихода бекона повторное списание проходит', () => {
  api('RECEIVE_GOODS', { productId: baconId, qty: 1, price: 1200, expiryDate: '2099-01-01', productionDate: '2026-10-01' }, tD);
  G.posFulfillPendingSalesTrigger_();
  assert.equal(G.findRows_('POS_MODIFIER_USAGE', x => x.product_id === baconId)[0].статус, 'списано');
});
step('отвязка группы: строка не удаляется, а уходит в архив', () => {
  api('POS_LINK_DISH_MODIFIERS', { dishId: 'DISH-P', groupIds: [size.group_id] }, tD);
  const p = api('POS_GET_MENU', {}, tK).dishes.find(d => d.dish_id === 'DISH-P');
  assert.deepEqual(p.modifier_groups.map(g => g.название), ['Размер']);
  assert.equal(G.findRows_('DISH_MODIFIER_LINKS', l => l.dish_id === 'DISH-P').length, 3);
  api('POS_LINK_DISH_MODIFIERS', { dishId: 'DISH-P', groupIds: [extra.group_id, size.group_id] }, tD);
  const p2 = api('POS_GET_MENU', {}, tK).dishes.find(d => d.dish_id === 'DISH-P');
  assert.deepEqual(p2.modifier_groups.map(g => g.название), ['Добавки', 'Размер']);
});
step('runPosTests_ — все проверки OK', () => {
  const bad = G.runPosTests_().filter(t => t.status !== 'OK'); assert.equal(bad.length, 0, JSON.stringify(bad));
});
console.log(failures ? '\n' + failures + ' FAILED' : '\nALL PASSED');
process.exit(failures ? 1 : 0);
