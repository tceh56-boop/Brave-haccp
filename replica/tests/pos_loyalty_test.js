// Этап M6: гости и бонусы. Запуск: node replica/tests/pos_loyalty_test.js
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
function mk(id, name, role, pin) { const s = 's' + id; G.insertRow_('USERS', { user_id: id, organization_id: 'ORG-1', location_ids: 'LOC-1', имя: name, роль: role, статус: 'активен', pin_hash: G.hashPin_(pin, s), pin_salt: s, failed_attempts: 0, lockout_count: 0 }); }
mk('USR-M', 'Ольга', 'МЕНЕДЖЕР', '482915'); mk('USR-K', 'Анна', 'КАССИР', '739164');
G.insertRow_('DISHES', { dish_id: 'DISH-1', organization_id: 'ORG-1', название: 'Борщ', цена_продажи: 350, себестоимость: 90, статус: 'активно' });
G.insertRow_('DISHES', { dish_id: 'DISH-2', organization_id: 'ORG-1', название: 'Морс', цена_продажи: 150, себестоимость: 20, статус: 'активно' });
function login(u, p) { const d = api('LOGIN', { userId: u, pin: p }); return d.requires_location ? (api('SELECT_LOCATION', { locationId: 'LOC-1' }, d.token).token || d.token) : d.token; }
const tM = login('USR-M', '482915'), tK = login('USR-K', '739164');
api('POS_OPEN_SHIFT', { cashStart: 0 }, tK);
function order(lines, token) {
  let v = api('POS_CREATE_ORDER', {}, token || tK);
  lines.forEach(([d, q]) => { v = api('POS_ADD_LINE', { orderId: v.order.order_id, dishId: d, qty: q, version: v.order.version }, token || tK); });
  return v;
}

let guest;
step('правила по умолчанию: 5% кешбэк, списание до 30%', () => {
  assert.deepEqual(api('POS_GET_LOYALTY_SETTINGS', {}, tK), { включено: true, кешбэк_процент: 5, макс_списание_процент: 30 });
});
step('без согласия на ПД гость не создаётся; кривой телефон — ошибка', () => {
  assert(/согласие/.test(apiErr('POS_SAVE_GUEST', { имя: 'Иван', телефон: '89123456789' }, tK)));
  assert(/формате/.test(apiErr('POS_SAVE_GUEST', { имя: 'Иван', телефон: '123', consent: true }, tK)));
});
step('кассир заводит гостя; телефон нормализуется, кассир видит только 4 цифры', () => {
  guest = api('POS_SAVE_GUEST', { имя: 'Иван', телефон: '8 (912) 345-67-89', consent: true }, tK);
  assert.equal(guest.телефон, '••• 6789');
  assert.equal(G.findOne_('GUESTS', 'guest_id', guest.guest_id).телефон, '+79123456789');
  assert(/уже есть/.test(apiErr('POS_SAVE_GUEST', { имя: 'Дубль', телефон: '+7 912 345 67 89', consent: true }, tK)));
});
step('поиск: по полному номеру и по последним цифрам; менеджер видит номер целиком', () => {
  assert.equal(api('POS_FIND_GUEST', { phone: '9123456789' }, tK)[0].guest_id, guest.guest_id);
  assert.equal(api('POS_FIND_GUEST', { phone: '6789' }, tK).length, 1);
  assert.equal(api('POS_FIND_GUEST', { phone: '6789' }, tM)[0].телефон, '+79123456789');
  assert(/4 цифр/.test(apiErr('POS_FIND_GUEST', { phone: '67' }, tK)));
});
step('кассир не правит карточку и не видит список гостей', () => {
  assert(/менеджер/.test(apiErr('POS_SAVE_GUEST', { guestId: guest.guest_id, имя: 'Пётр' }, tK)));
  assert(/Недостаточно прав/.test(apiErr('POS_GET_GUESTS', {}, tK)));
});
let o1;
step('заказ 1 (850 ₽) с гостем: списать бонусы без баланса нельзя, начислено 5% = 42', () => {
  const v = order([['DISH-1', 2], ['DISH-2', 1]]);
  const a = api('POS_ATTACH_GUEST', { orderId: v.order.order_id, guestId: guest.guest_id }, tK);
  assert.equal(a.guest.имя, 'Иван'); assert.equal(a.guest.можно_списать, 0);
  assert(/не больше 0/.test(apiErr('POS_PAY', { orderId: v.order.order_id, version: a.order.version, bonus: 10, payments: [{ способ: 'карта', сумма: 840 }] }, tK)));
  const r = api('POS_PAY', { orderId: v.order.order_id, version: a.order.version, operationId: 'L1', payments: [{ способ: 'карта', сумма: 850 }] }, tK);
  assert.equal(r.бонусы_начислено, 42); assert.equal(r.guest.бонусы, 42);
  o1 = r.order;
});
step('менеджер начисляет 300 бонусов вручную с причиной', () => {
  assert(/причину/.test(apiErr('POS_ADJUST_BONUS', { guestId: guest.guest_id, delta: 300 }, tM)));
  const g = api('POS_ADJUST_BONUS', { guestId: guest.guest_id, delta: 300, reason: 'Компенсация за ожидание' }, tM);
  assert.equal(g.бонусы, 342); assert.equal(g.история[0].тип, 'корректировка');
});
let o2;
step('заказ 2 (1000 ₽): можно списать 300 (30%), списываем 300 → платит 700, начислено 35', () => {
  const v = order([['DISH-1', 2], ['DISH-2', 2]]);
  const a = api('POS_ATTACH_GUEST', { orderId: v.order.order_id, guestId: guest.guest_id }, tK);
  assert.equal(a.guest.можно_списать, 300);
  assert(/не больше 300/.test(apiErr('POS_PAY', { orderId: v.order.order_id, version: a.order.version, bonus: 301, payments: [{ способ: 'нал', сумма: 1000 }] }, tK)));
  assert(/Не хватает/.test(apiErr('POS_PAY', { orderId: v.order.order_id, version: a.order.version, bonus: 300, payments: [{ способ: 'нал', сумма: 600 }] }, tK)));
  const r = api('POS_PAY', { orderId: v.order.order_id, version: a.order.version, bonus: 300, operationId: 'L2', payments: [{ способ: 'нал', сумма: 700 }] }, tK);
  assert.equal(r.order.итого, 700); assert.equal(r.order.скидка, 300); assert.equal(r.бонусы_списано, 300); assert.equal(r.бонусы_начислено, 35);
  assert.equal(r.guest.бонусы, 342 - 300 + 35);
  o2 = r.order;
});
step('продажи записаны по ценам со скидкой (выручка 700, а не 1000)', () => {
  const sales = G.findRows_('SALES', s => s.внешний_id && G.findOne_('POS_ORDER_LINES', 'line_id', s.внешний_id) && G.findOne_('POS_ORDER_LINES', 'line_id', s.внешний_id).order_id === o2.order_id);
  assert.equal(Math.round(sales.reduce((a, s) => a + s.сумма, 0)), 700);
});
step('частичный возврат морсов (300 из 1000): деньги 210, гостю вернули 90 бонусов, отменили 10', () => {
  const lines = api('POS_GET_ORDER', { orderId: o2.order_id }, tM).lines;
  const mors = lines.find(l => l.dish_id === 'DISH-2');
  const before = api('POS_GET_GUEST', { guestId: guest.guest_id }, tM).бонусы;
  const r = api('POS_REFUND', { orderId: o2.order_id, lineIds: [mors.line_id], reason: 'Тёплый морс', method: 'нал', operationId: 'LR1' }, tM);
  assert.equal(r.возврат, 210);
  const after = api('POS_GET_GUEST', { guestId: guest.guest_id }, tM);
  assert.equal(after.бонусы, before + 90 - 10);
  assert.deepEqual(after.история.slice(0, 2).map(t => t.тип).sort(), ['возврат_списания', 'отмена_начисления']);
});
step('полный остаток возврата: деньги 490, бонусы — остаток без потерь на округлении', () => {
  const before = api('POS_GET_GUEST', { guestId: guest.guest_id }, tM).бонусы;
  const r = api('POS_REFUND', { orderId: o2.order_id, reason: 'Гость ушёл', method: 'нал', operationId: 'LR2' }, tM);
  assert.equal(r.возврат, 490); assert.equal(r.order.статус, 'возврат');
  assert.equal(api('POS_GET_GUEST', { guestId: guest.guest_id }, tM).бонусы, before + 210 - 25);
  const tx = G.findRows_('BONUS_TXNS', t => t.order_id === o2.order_id);
  assert.equal(tx.filter(t => t.тип === 'возврат_списания').reduce((a, t) => a + t.сумма, 0), 300);
  assert.equal(tx.filter(t => t.тип === 'отмена_начисления').reduce((a, t) => a + t.сумма, 0), -35);
});
step('баланс = сумма проводок', () => {
  const sum = G.findRows_('BONUS_TXNS', t => t.guest_id === guest.guest_id).reduce((a, t) => a + t.сумма, 0);
  assert.equal(sum, api('POS_GET_GUEST', { guestId: guest.guest_id }, tM).бонусы);
});
step('отмена начисления не уводит баланс в минус, если бонусы уже потрачены', () => {
  const g2 = api('POS_SAVE_GUEST', { имя: 'Мария', телефон: '+79990001122', consent: true }, tK);
  const v = order([['DISH-1', 2]]);
  const a = api('POS_ATTACH_GUEST', { orderId: v.order.order_id, guestId: g2.guest_id }, tK);
  api('POS_PAY', { orderId: v.order.order_id, version: a.order.version, operationId: 'L3', payments: [{ способ: 'карта', сумма: 700 }] }, tK); // +35
  api('POS_ADJUST_BONUS', { guestId: g2.guest_id, delta: -30, reason: 'Потрачены в другой точке' }, tM);
  api('POS_REFUND', { orderId: v.order.order_id, reason: 'Отказ', method: 'карта', operationId: 'L3R' }, tM);
  const g = api('POS_GET_GUEST', { guestId: g2.guest_id }, tM);
  assert.equal(g.бонусы, 0);
  assert(/не хватило 30/.test(g.история.find(t => t.тип === 'отмена_начисления').причина));
});
step('правила программы: кассир не меняет, менеджер меняет; выключенная программа не начисляет', () => {
  assert(/Недостаточно прав/.test(apiErr('POS_SAVE_LOYALTY_SETTINGS', { включено: true, кешбэк_процент: 10, макс_списание_процент: 50 }, tK)));
  assert(/от 0 до 50/.test(apiErr('POS_SAVE_LOYALTY_SETTINGS', { включено: true, кешбэк_процент: 70, макс_списание_процент: 50 }, tM)));
  api('POS_SAVE_LOYALTY_SETTINGS', { включено: false, кешбэк_процент: 10, макс_списание_процент: 50 }, tM);
  const v = order([['DISH-2', 1]]);
  const a = api('POS_ATTACH_GUEST', { orderId: v.order.order_id, guestId: guest.guest_id }, tK);
  assert.equal(a.guest.можно_списать, 0);
  const r = api('POS_PAY', { orderId: v.order.order_id, version: a.order.version, operationId: 'L4', payments: [{ способ: 'карта', сумма: 150 }] }, tK);
  assert.equal(r.бонусы_начислено, 0);
  api('POS_SAVE_LOYALTY_SETTINGS', { включено: true, кешбэк_процент: 5, макс_списание_процент: 30 }, tM);
});
step('обезличивание по запросу гостя: имя и телефон стёрты, гость не находится и не привязывается', () => {
  api('POS_ANONYMIZE_GUEST', { guestId: guest.guest_id }, tM);
  const row = G.findOne_('GUESTS', 'guest_id', guest.guest_id);
  assert.equal(row.телефон, ''); assert.equal(row.имя, 'Гость удалён');
  assert.equal(api('POS_FIND_GUEST', { phone: '9123456789' }, tK).length, 0);
  const v = order([['DISH-2', 1]]);
  assert(/обезличена/.test(apiErr('POS_ATTACH_GUEST', { orderId: v.order.order_id, guestId: guest.guest_id }, tK)));
  assert(G.findRows_('BONUS_TXNS', t => t.guest_id === guest.guest_id).length > 0, 'проводки сохраняются');
});
step('список гостей у менеджера и поиск по имени', () => {
  const list = api('POS_GET_GUESTS', { query: 'мар' }, tM);
  assert.equal(list.length, 1); assert.equal(list[0].имя, 'Мария');
});
step('runPosTests_ — все проверки OK', () => {
  const bad = G.runPosTests_().filter(t => t.status !== 'OK'); assert.equal(bad.length, 0, JSON.stringify(bad));
});
console.log(failures ? '\n' + failures + ' FAILED' : '\nALL PASSED');
process.exit(failures ? 1 : 0);
