// Волна 3, M11: контроль фуд-коста и «Используй сегодня». Запуск: node replica/tests/foodcost_test.js
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
mk('USR-D', 'ДИРЕКТОР', '739164'); mk('USR-C', 'ШЕФ-ПОВАР', '482915'); mk('USR-P', 'ПОВАР', '927364'); mk('USR-S', 'КЛАДОВЩИК', '531846'); mk('USR-T', 'ТЕХНОЛОГ_HACCP', '284617');
function login(u, p) { const d = api('LOGIN', { userId: u, pin: p }); return d.requires_location ? (api('SELECT_LOCATION', { locationId: 'LOC-1' }, d.token).token || d.token) : d.token; }
const tD = login('USR-D', '739164'), tC = login('USR-C', '482915'), tP = login('USR-P', '927364'), tS = login('USR-S', '531846'), tT = login('USR-T', '284617');

const today = G.todayDateStr_(), day = n => G._dpAddDays_(today, n);
const prod = (n, price) => { const p = api('CREATE_PRODUCT', { название: n, единица: 'кг', цена: price }, tD); return p.product_id || p.product.product_id; };
const beef = prod('Говядина', 600), beet = prod('Свёкла', 50), cabbage = prod('Капуста', 40);
const dish = (name, price, lines) => { const d = api('CREATE_DISH', { название: name, выход: 300, цена_продажи: price }, tD); lines.forEach(l => api('ADD_RECIPE_LINE', { parentType: 'DISH', parentId: d.dish_id, ingredientId: l[0], брутто: l[1], нетто: l[1], единица: 'кг' }, tD)); return d.dish_id; };
const mince = api('CREATE_SEMI_FINISHED', { название: 'Фарш говяжий', выход: 1, единица: 'кг', срокХраненияЧасов: 12 }, tD).pf_id;
api('ADD_RECIPE_LINE', { parentType: 'PF', parentId: mince, ingredientId: beef, брутто: 1, нетто: 1, единица: 'кг' }, tD);
const borsch = dish('Борщ', 350, [[beef, 0.1], [beet, 0.08], [cabbage, 0.06]]); // 66,4 ₽ → 19 %
const steak = dish('Стейк', 450, [[beef, 0.25]]);                               // 150 ₽ → 33,3 %
const cutlet = dish('Котлета', 300, [[mince, 0.15]]);                            // 90 ₽ → 30 % (ровно цель — не выше)

step('права: повар, кладовщик и технолог не видят фуд-кост; шеф видит, но цель меняет директор', () => {
  [tP, tS, tT].forEach(t => assert(/Недостаточно прав/.test(apiErr('FC_GET_OVERVIEW', {}, t))));
  assert(/Недостаточно прав/.test(apiErr('FC_SAVE_SETTINGS', { цель_процент: 28 }, tC)));
  assert(/от 5 до 90/.test(apiErr('FC_SAVE_SETTINGS', { цель_процент: 3 }, tD)));
});
let ov;
step('обзор: цель 30 % по умолчанию; стейк выше цели, цена для цели 500 ₽; котлета ровно на цели', () => {
  ov = api('FC_GET_OVERVIEW', {}, tC);
  assert.equal(ov.цель_процент, 30);
  assert.deepEqual(ov.rows.map(r => [r.название, r.себестоимость, r.food_cost, r.выше_цели, r.рекомендованная_цена]),
    [['Стейк', 150, 33.33, true, 500], ['Котлета', 90, 30, false, null], ['Борщ', 66.4, 18.97, false, null]]);
  assert.equal(ov.выше_цели, 1);
});
step('проверка: одно предупреждение и задача шефу; повторная проверка не дублирует', () => {
  const r = api('FC_CHECK_ALERTS', {}, tC);
  assert.equal(r.предупреждений, 1);
  const task = G.findOne_('TASKS', 'task_id', r.alerts[0].task_id);
  assert.equal(task.responsible_role, 'ШЕФ-ПОВАР'); assert(/Стейк/.test(task.title) && /500 ₽/.test(task.description));
  assert.equal(api('FC_CHECK_ALERTS', {}, tC).предупреждений, 0);
});
step('приход говядины по 900 ₽: сразу предупреждения по стейку (рост) и котлете (через фарш), с причиной', () => {
  api('RECEIVE_GOODS', { productId: beef, qty: 10, price: 900, expiryDate: '2099-01-01', productionDate: today }, tD);
  const open = G.findRows_('FOODCOST_ALERTS', a => a.статус === 'открыт');
  const byDish = Object.fromEntries(open.map(a => [a.dish_id, a]));
  assert.deepEqual(Object.keys(byDish).sort(), [cutlet, steak].sort());
  assert.equal(Number(byDish[steak].food_cost), 50); assert.equal(Number(byDish[cutlet].food_cost), 45);
  assert.equal(G.findRows_('FOODCOST_ALERTS', a => a.dish_id === steak && a.статус === 'заменён').length, 1);
  const t = G.findOne_('TASKS', 'task_id', byDish[cutlet].task_id);
  assert(/Говядина 600 → 900 ₽ \(\+50 %\)/.test(t.description), t.description);
  assert.equal(G.findRows_('FOODCOST_ALERTS', a => a.dish_id === borsch).length, 0, 'борщ 27,5 % — ниже цели');
});
step('обзор показывает подорожание и рост с момента ТТК не ломается без ТТК', () => {
  ov = api('FC_GET_OVERVIEW', {}, tC);
  const c = ov.rows.find(r => r.название === 'Котлета');
  assert.deepEqual(c.подорожания.map(p => [p.название, p.было, p.стало]), [['Говядина', 600, 900]]);
  assert.equal(c.рост_с_ттк_pct, null);
});
step('новая цена стейка снимает предупреждение при проверке', () => {
  api('UPDATE_DISH', { dishId: steak, patch: { цена_продажи: 800 } }, tD);
  api('FC_CHECK_ALERTS', {}, tC);
  assert.deepEqual(G.findRows_('FOODCOST_ALERTS', a => a.dish_id === steak && a.статус === 'открыт'), []);
  assert.equal(G.findRows_('FOODCOST_ALERTS', a => a.dish_id === steak && a.статус === 'снят').length, 1);
});
step('цель 50 % директором: котлета (45 %) уже не выше цели', () => {
  api('FC_SAVE_SETTINGS', { цель_процент: 50 }, tD);
  assert.equal(api('FC_GET_SETTINGS', {}, tC).цель_процент, 50);
  assert.equal(api('FC_GET_OVERVIEW', {}, tC).выше_цели, 0);
  api('FC_SAVE_SETTINGS', { цель_процент: 30 }, tD);
});
step('«Используй сегодня»: партии до конца завтра, блюда по марже, заготовки; просрочка и дальние сроки не входят', () => {
  api('RECEIVE_GOODS', { productId: beet, qty: 5, price: 50, expiryDate: today, productionDate: day(-3) }, tD);
  api('RECEIVE_GOODS', { productId: cabbage, qty: 4, price: 40, expiryDate: day(5), productionDate: today }, tD);
  api('RECEIVE_GOODS', { productId: beef, qty: 1, price: 900, expiryDate: day(1), productionDate: today }, tD);
  G.insertRow_('BATCHES', { batch_id: 'B-OLD', product_id: cabbage, location_id: 'LOC-1', количество: 3, срок_годности: day(-1), статус: 'активна', цена_прихода: 40 });
  const r = api('FC_USE_TODAY', {}, tP);
  assert.deepEqual(r.rows.map(x => [x.название, x.количество, x.сегодня]), [['Свёкла', 5, true], ['Говядина', 1, false]]);
  assert.deepEqual(r.rows[0].блюда.map(b => [b.название, b.порций]), [['Борщ', 62]]);
  const beefRow = r.rows[1];
  assert.deepEqual(beefRow.блюда.map(b => [b.название, b.порций]), [['Стейк', 4], ['Борщ', 10]]);
  assert.deepEqual(beefRow.заготовки.map(p => p.название), ['Фарш говяжий']);
  assert.equal(r.под_риском_руб, 250 + 900);
});
step('кладовщик без доступа к «Используй сегодня» (нет модуля production)', () => {
  assert(/Недостаточно прав/.test(apiErr('FC_USE_TODAY', {}, tS)));
});
step('самопроверка (runPosTests_) видит лист и действия фуд-коста', () => {
  assert.deepEqual(G.runPosTests_().filter(x => x.status !== 'OK' && /FC_|FOODCOST/.test(x.name)), []);
});
console.log(failures ? '\n' + failures + ' FAILED' : '\nALL PASSED');
process.exit(failures ? 1 : 0);
