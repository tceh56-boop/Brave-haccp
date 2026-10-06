// Этап M7: чаевые. Запуск: node replica/tests/pos_tips_test.js
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
function mk(id, name, role, pin, org) { const s = 's' + id; G.insertRow_('USERS', { user_id: id, organization_id: org || 'ORG-1', location_ids: 'LOC-1', имя: name, роль: role, статус: 'активен', pin_hash: G.hashPin_(pin, s), pin_salt: s, failed_attempts: 0, lockout_count: 0 }); }
mk('USR-M', 'Ольга', 'МЕНЕДЖЕР', '482915'); mk('USR-W', 'Игорь', 'ОФИЦИАНТ', '615283'); mk('USR-W2', 'Мария', 'ОФИЦИАНТ', '927364'); mk('USR-K', 'Анна', 'КАССИР', '739164');
mk('USR-X', 'Чужой', 'ОФИЦИАНТ', '351846', 'ORG-2');
G.insertRow_('DISHES', { dish_id: 'DISH-1', organization_id: 'ORG-1', название: 'Борщ', цена_продажи: 350, статус: 'активно' });
function login(u, p) { const d = api('LOGIN', { userId: u, pin: p }); return d.requires_location ? (api('SELECT_LOCATION', { locationId: 'LOC-1' }, d.token).token || d.token) : d.token; }
const tM = login('USR-M', '482915'), tW = login('USR-W', '615283'), tW2 = login('USR-W2', '927364'), tK = login('USR-K', '739164');

step('ссылка проверяется: только https, без пробелов', () => {
  assert(/https:\/\//.test(apiErr('POS_SAVE_TIP_LINK', { ссылка: 'http://tips.example.ru/igor' }, tW)));
  assert(/https:\/\//.test(apiErr('POS_SAVE_TIP_LINK', { ссылка: 'https://tips example.ru' }, tW)));
  assert(/https:\/\//.test(apiErr('POS_SAVE_TIP_LINK', { ссылка: 'javascript:alert(1)' }, tW)));
});
step('официант сохраняет свою ссылку; сервис — домен', () => {
  const r = api('POS_SAVE_TIP_LINK', { ссылка: 'https://pay.cloudtips.ru/p/abc123' }, tW);
  assert.equal(r.сервис, 'pay.cloudtips.ru');
});
step('официант не меняет чужую ссылку и видит только себя', () => {
  assert(/менеджер/.test(apiErr('POS_SAVE_TIP_LINK', { userId: 'USR-W2', ссылка: 'https://x.ru/y' }, tW)));
  const list = api('POS_GET_TIP_LINKS', {}, tW);
  assert.deepEqual(list.map(x => x.имя), ['Игорь']);
});
step('менеджер видит официантов и кассиров и задаёт ссылку Марии; чужая организация — нельзя', () => {
  api('POS_SAVE_TIP_LINK', { userId: 'USR-W2', ссылка: 'https://netmonet.co/tip/777' }, tM);
  const list = api('POS_GET_TIP_LINKS', {}, tM);
  assert.deepEqual(list.map(x => x.имя).sort(), ['Анна', 'Игорь', 'Мария', 'Ольга'].sort());
  assert.equal(list.find(x => x.имя === 'Мария').сервис, 'netmonet.co');
  apiErr('POS_SAVE_TIP_LINK', { userId: 'USR-X', ссылка: 'https://x.ru/y' }, tM);
});
step('в заказе — ссылка того, кто ведёт заказ; без ссылки — пусто', () => {
  api('POS_OPEN_SHIFT', { cashStart: 0 }, tK);
  const hall = api('POS_SAVE_HALL', { название: 'Зал' }, tM);
  const t1 = api('POS_SAVE_TABLE', { hallId: hall.hall_id, название: '1' }, tM);
  let v = api('POS_CREATE_ORDER', { tableId: t1.table_id }, tW);
  v = api('POS_ADD_LINE', { orderId: v.order.order_id, dishId: 'DISH-1', version: v.order.version }, tW);
  v = api('POS_PRECHECK', { orderId: v.order.order_id, version: v.order.version }, tW);
  assert.deepEqual([v.tip.имя, v.tip.ссылка], ['Игорь', 'https://pay.cloudtips.ru/p/abc123']);
  const k = api('POS_CREATE_ORDER', {}, tK);
  assert.equal(k.tip, null);
});
step('пустая ссылка удаляет QR из заказов', () => {
  api('POS_SAVE_TIP_LINK', { ссылка: '' }, tW);
  const o = G.findRows_('POS_ORDERS', x => x.официант_id === 'USR-W')[0];
  assert.equal(api('POS_GET_ORDER', { orderId: o.order_id }, tW).tip, null);
});
step('runPosTests_ — все проверки OK', () => {
  const bad = G.runPosTests_().filter(t => t.status !== 'OK'); assert.equal(bad.length, 0, JSON.stringify(bad));
});
console.log(failures ? '\n' + failures + ' FAILED' : '\nALL PASSED');
process.exit(failures ? 1 : 0);
