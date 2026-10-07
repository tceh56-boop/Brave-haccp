// Волна 3, M9: заготовочный лист смены. Запуск: node replica/tests/prep_test.js
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
mk('USR-C', 'ШЕФ-ПОВАР', '482915'); mk('USR-P', 'ПОВАР', '927364'); mk('USR-K', 'КАССИР', '615283'); mk('USR-D', 'ДИРЕКТОР', '739164');
function login(u, p) { const d = api('LOGIN', { userId: u, pin: p }); return d.requires_location ? (api('SELECT_LOCATION', { locationId: 'LOC-1' }, d.token).token || d.token) : d.token; }
const tC = login('USR-C', '482915'), tP = login('USR-P', '927364'), tK = login('USR-K', '615283'), tD = login('USR-D', '739164');

const D = G.todayDateStr_();
const day = n => G._dpAddDays_(D, n);
// Кости → бульон (0,5 кг на 1 л). Борщ: 300 мл бульона на порцию. Суп дня: тоже 300 мл.
const bones = api('CREATE_PRODUCT', { название: 'Кости говяжьи', единица: 'кг', цена: 120 }, tD);
const bonesId = bones.product_id || (bones.product && bones.product.product_id);
const broth = api('CREATE_SEMI_FINISHED', { название: 'Бульон говяжий', выход: 1, единица: 'л', срокХраненияЧасов: 48 }, tD);
api('ADD_RECIPE_LINE', { parentType: 'PF', parentId: broth.pf_id, ingredientId: bonesId, брутто: 0.5, нетто: 0.5, единица: 'кг' }, tD);
const borsch = api('CREATE_DISH', { название: 'Борщ', выход: 300, цена_продажи: 350 }, tD);
api('ADD_RECIPE_LINE', { parentType: 'DISH', parentId: borsch.dish_id, ingredientId: broth.pf_id, брутто: 300, нетто: 300, единица: 'мл' }, tD);
const soup = api('CREATE_DISH', { название: 'Суп дня', выход: 300, цена_продажи: 290 }, tD);
api('ADD_RECIPE_LINE', { parentType: 'DISH', parentId: soup.dish_id, ingredientId: broth.pf_id, брутто: 300, нетто: 300, единица: 'мл' }, tD);
const sale = (dishId, d, qty) => G.insertRow_('SALES', { sale_id: 'S-' + Math.random(), organization_id: 'ORG-1', location_id: 'LOC-1', dish_id: dishId, qty, сумма: qty * 100, дата: d, источник: 'тест' });
// Борщ в тот же день недели: 10, 10, 6, 6 → 8 порций; в другие дни — много, но они не в счёт.
sale(borsch.dish_id, day(-7), 10); sale(borsch.dish_id, day(-14), 10); sale(borsch.dish_id, day(-21), 6); sale(borsch.dish_id, day(-28), 6);
sale(borsch.dish_id, day(-2), 40); sale(borsch.dish_id, day(-29), 99); // -29 — вне окна 4 недель
// Суп дня — только в другие дни: 28 порций за 28 дней → 1 в день.
sale(soup.dish_id, day(-1), 28);
// Годный остаток бульона 0,4 л и просроченная партия 5 л — она не считается.
G.insertRow_('BATCHES', { batch_id: 'B-OK', product_id: broth.pf_id, location_id: 'LOC-1', количество: 0.4, срок_годности: '2099-01-01', статус: 'активна' });
G.insertRow_('BATCHES', { batch_id: 'B-OLD', product_id: broth.pf_id, location_id: 'LOC-1', количество: 5, срок_годности: '2020-01-01', статус: 'активна' });

step('права: кассир не видит заготовки, повар не меняет нормы', () => {
  assert(/Недостаточно прав/.test(apiErr('PREP_GET_LIST', {}, tK)));
  assert(/Недостаточно прав/.test(apiErr('PREP_SAVE_PAR', { pfId: broth.pf_id, норма: 1 }, tP)));
});
step('норма: проверка и сохранение шефом', () => {
  assert(/не меньше нуля/.test(apiErr('PREP_SAVE_PAR', { pfId: broth.pf_id, норма: -1 }, tC)));
  api('PREP_SAVE_PAR', { pfId: broth.pf_id, норма: 1 }, tC);
  const pars = api('PREP_GET_PARS', {}, tC);
  assert.deepEqual(pars.map(p => [p.название, p.норма]), [['Бульон говяжий', 1]]);
});
let list;
step('прогноз: борщ по дню недели (8 порций), суп по среднему (1) → бульон 2,7 л; к заготовке 2,7 + 1 − 0,4 = 3,3', () => {
  list = api('PREP_GET_LIST', {}, tP);
  assert.equal(list.сформирован, false);
  const r = list.rows[0];
  assert.deepEqual([r.название, r.прогноз, r.норма, r.остаток, r.к_заготовке, r.единица], ['Бульон говяжий', 2.7, 1, 0.4, 3.3, 'л']);
});
step('неверная дата — понятная ошибка', () => {
  assert(/ГГГГ-ММ-ДД/.test(apiErr('PREP_GET_LIST', { date: '07.10' }, tP)));
});
let row;
step('повар формирует лист — строка сохранена', () => {
  list = api('PREP_BUILD_LIST', {}, tP);
  assert.equal(list.сформирован, true); assert.equal(list.создано, 1);
  row = list.rows[0]; assert.equal(row.статус, 'к_заготовке');
});
step('сырья не хватает — ничего не списано, задача производства отменена, строка не отмечена', () => {
  api('RECEIVE_GOODS', { productId: bonesId, qty: 1, price: 120, expiryDate: '2099-01-01', productionDate: D }, tD);
  const e = apiErr('PREP_MARK_DONE', { prepId: row.prep_id, qty: 3.3 }, tP);
  assert(/Недостаточно ингредиента/.test(e), e);
  assert.equal(G.getUsableStockLevel_(bonesId, 'LOC-1'), 1);
  const prod = G.findRows_('PRODUCTION', p => p.parent_id === broth.pf_id);
  assert.deepEqual(prod.map(p => p.статус), ['отменено']);
  assert.equal(api('PREP_GET_LIST', {}, tP).rows[0].статус, 'к_заготовке');
});
step('сделано: кости списаны (1,65 кг), партия бульона 3,3 л с маркировкой', () => {
  api('RECEIVE_GOODS', { productId: bonesId, qty: 1, price: 120, expiryDate: '2099-01-01', productionDate: D }, tD);
  const r = api('PREP_MARK_DONE', { prepId: row.prep_id, qty: 3.3 }, tP);
  assert.equal(r.статус, 'готово'); assert(r.batch_id);
  assert.equal(Math.round(G.getUsableStockLevel_(bonesId, 'LOC-1') * 100) / 100, 0.35);
  const b = G.findOne_('BATCHES', 'batch_id', r.batch_id);
  assert.equal(Number(b.количество), 3.3); assert(b.срок_годности, 'срок годности из карточки ПФ');
  assert.equal(G.findRows_('MARKINGS', m => m.batch_id === r.batch_id).length, 1);
});
step('повторная отметка запрещена; пересчёт листа не трогает сделанное', () => {
  assert(/уже отмечена/.test(apiErr('PREP_MARK_DONE', { prepId: row.prep_id, qty: 1 }, tP)));
  const l = api('PREP_BUILD_LIST', {}, tC);
  assert.deepEqual([l.rows[0].статус, l.rows[0].сделано, l.обновлено], ['сделано', 3.3, 0]);
});
step('завтра: остаток учитывает новую партию → заготовка не нужна сверх нормы', () => {
  const l = api('PREP_GET_LIST', { date: day(1) }, tC);
  const r = l.rows[0];
  // завтра — другой день недели: борщ по среднему (32+40)/28, суп 1 → бульон ≈ 1,07 л; остаток 3,7 л
  assert.equal(r.остаток, 3.7); assert.equal(r.к_заготовке, 0);
});
step('пропустить и вернуть строку', () => {
  G.insertRow_('SEMI_FINISHED', { pf_id: 'PF-ZZ', organization_id: 'ORG-1', название: 'Соус', выход: 1, единица: 'кг' });
  api('PREP_SAVE_PAR', { pfId: 'PF-ZZ', норма: 2 }, tC);
  const l = api('PREP_BUILD_LIST', {}, tC);
  const sauce = l.rows.find(x => x.pf_id === 'PF-ZZ');
  assert.equal(sauce.к_заготовке, 2);
  assert.equal(api('PREP_SKIP', { prepId: sauce.prep_id }, tP).статус, 'пропущено');
  assert.equal(api('PREP_SKIP', { prepId: sauce.prep_id }, tP).статус, 'к_заготовке');
});
step('самопроверка в Apps Script (runPosTests_) видит листы и действия заготовок', () => {
  const bad = G.runPosTests_().filter(x => x.status !== 'OK' && /PREP/.test(x.name));
  assert.deepEqual(bad, []);
});
console.log(failures ? '\n' + failures + ' FAILED' : '\nALL PASSED');
process.exit(failures ? 1 : 0);
