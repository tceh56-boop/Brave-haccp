// Волна 3, M10: ознакомление с ТТК и аттестация. Запуск: node replica/tests/training_test.js
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
mk('USR-D', 'Олег', 'ДИРЕКТОР', '739164'); mk('USR-T', 'Вера', 'ТЕХНОЛОГ_HACCP', '284617'); mk('USR-C', 'Анна', 'ШЕФ-ПОВАР', '482915');
mk('USR-P1', 'Игорь', 'ПОВАР', '927364'); mk('USR-P2', 'Пётр', 'ПОВАР', '531846'); mk('USR-K', 'Ксения', 'КАССИР', '615283');
function login(u, p) { const d = api('LOGIN', { userId: u, pin: p }); return d.requires_location ? (api('SELECT_LOCATION', { locationId: 'LOC-1' }, d.token).token || d.token) : d.token; }
const tD = login('USR-D', '739164'), tT = login('USR-T', '284617'), tC = login('USR-C', '482915'), tP1 = login('USR-P1', '927364'), tP2 = login('USR-P2', '531846'), tK = login('USR-K', '615283');

const prod = n => { const p = api('CREATE_PRODUCT', { название: n, единица: 'кг', цена: 100 }, tD); return p.product_id || p.product.product_id; };
const [beet, cabbage, meat, cucumber, bread, egg] = ['Свёкла', 'Капуста', 'Говядина', 'Огурцы солёные', 'Сухари', 'Яйцо'].map(prod);
function dishWithTtk(name, lines, storage, shelf) {
  const d = api('CREATE_DISH', { название: name, выход: 300, цена_продажи: 350 }, tD);
  lines.forEach(l => api('ADD_RECIPE_LINE', { parentType: 'DISH', parentId: d.dish_id, ingredientId: l[0], брутто: l[1], нетто: l[1], единица: 'кг' }, tD));
  approve(d.dish_id, storage, shelf);
  return d.dish_id;
}
function approve(dishId, storage, shelf) {
  const v = api('CREATE_TTK_VERSION', { dishId, технология: 'Подготовить продукты, варить до готовности, подавать горячим', условия_хранения: storage, срок_реализации: shelf }, tD);
  api('SUBMIT_TTK_FOR_APPROVAL', { ttkVersionId: v.ttk_version_id }, tD);
  api('APPROVE_TTK_VERSION', { ttkVersionId: v.ttk_version_id }, tT);
  return v.ttk_version_id;
}
const borsch = dishWithTtk('Борщ', [[beet, 0.08], [cabbage, 0.06], [meat, 0.1]], '+2..+6 °C', '24 ч');
const solyanka = dishWithTtk('Солянка', [[meat, 0.12], [cucumber, 0.04]], '+2..+6 °C', '48 ч');
const cutlet = dishWithTtk('Котлета', [[meat, 0.15], [bread, 0.02], [egg, 0.01]], '0..+4 °C', '12 ч');
const correct = attemptId => JSON.parse(G.findOne_('TRAINING_ATTEMPTS', 'attempt_id', attemptId).вопросы_json).map(q => q.верный);

step('права: кассир без доступа; повар не видит матрицу и вопросы с ответами', () => {
  assert(/Недостаточно прав/.test(apiErr('TRAINING_GET_MY', {}, tK)));
  assert(/Недостаточно прав/.test(apiErr('TRAINING_GET_MATRIX', {}, tP1)));
  assert(/Недостаточно прав/.test(apiErr('TRAINING_GET_QUESTIONS', { dishId: borsch }, tP1)));
});
step('повар видит 3 блюда с утверждённой ТТК, всё «не ознакомлен»', () => {
  const r = api('TRAINING_GET_MY', {}, tP1);
  assert.deepEqual(r.rows.map(x => [x.название, x.статус]), [['Борщ', 'не_ознакомлен'], ['Котлета', 'не_ознакомлен'], ['Солянка', 'не_ознакомлен']]);
});
step('тест без ознакомления не начинается', () => {
  assert(/Сначала ознакомьтесь/.test(apiErr('TRAINING_START_QUIZ', { dishId: borsch }, tP1)));
});
let card;
step('карточка ТТК: состав по версии, хранение, срок', () => {
  card = api('TRAINING_GET_CARD', { dishId: borsch }, tP1);
  assert.deepEqual(card.состав.map(c => c.название), ['Свёкла', 'Капуста', 'Говядина']);
  assert.equal(card.условия_хранения, '+2..+6 °C'); assert.equal(card.срок_реализации, '24 ч'); assert.equal(card.version, 1);
});
step('ознакомление фиксирует версию; повтор не создаёт дубль', () => {
  assert.equal(api('TRAINING_ACK', { dishId: borsch, ttkVersionId: card.ttk_version_id }, tP1).уже, false);
  assert.equal(api('TRAINING_ACK', { dishId: borsch }, tP1).уже, true);
  assert.equal(G.findRows_('TTK_ACKS', a => a.user_id === 'USR-P1').length, 1);
});
let quiz;
step('тест: вопросы из ТТК, верные ответы клиенту не уходят', () => {
  quiz = api('TRAINING_START_QUIZ', { dishId: borsch }, tP1);
  assert(quiz.вопросы.length >= 4, 'вопросов ' + quiz.вопросы.length);
  assert(!JSON.stringify(quiz).includes('верный'));
  const storage = quiz.вопросы.find(q => /Условия хранения/.test(q.вопрос));
  assert(storage.варианты.includes('+2..+6 °C') && storage.варианты.filter(o => o === '+2..+6 °C').length === 1, 'без дублей правильного ответа');
  quiz.вопросы.forEach(q => assert(q.варианты.length >= 3, q.вопрос));
});
step('ответы не на все вопросы — ошибка; все верные — сдано, статус «аттестован»', () => {
  assert(/Ответьте на все/.test(apiErr('TRAINING_SUBMIT_QUIZ', { attemptId: quiz.attempt_id, answers: [0] }, tP1)));
  const r = api('TRAINING_SUBMIT_QUIZ', { attemptId: quiz.attempt_id, answers: correct(quiz.attempt_id) }, tP1);
  assert.deepEqual([r.сдано, r.процент, r.ошибки.length], [true, 100, 0]);
  assert.equal(api('TRAINING_GET_MY', {}, tP1).rows.find(x => x.dish_id === borsch).статус, 'аттестован');
  assert(/уже завершён/.test(apiErr('TRAINING_SUBMIT_QUIZ', { attemptId: quiz.attempt_id, answers: correct(quiz.attempt_id) }, tP1)));
});
step('чужой тест сдать нельзя', () => {
  api('TRAINING_ACK', { dishId: cutlet }, tP1);
  const q = api('TRAINING_START_QUIZ', { dishId: cutlet }, tP1);
  assert(/другого сотрудника/.test(apiErr('TRAINING_SUBMIT_QUIZ', { attemptId: q.attempt_id, answers: correct(q.attempt_id) }, tP2)));
});
step('ошибки: не сдано, показан верный ответ', () => {
  api('TRAINING_ACK', { dishId: solyanka }, tP2);
  const q = api('TRAINING_START_QUIZ', { dishId: solyanka }, tP2);
  const wrong = correct(q.attempt_id).map(c => (c + 1) % 3);
  const r = api('TRAINING_SUBMIT_QUIZ', { attemptId: q.attempt_id, answers: wrong }, tP2);
  assert.equal(r.сдано, false); assert.equal(r.ошибки.length, q.вопросы.length); assert(r.ошибки[0].верно);
  assert.equal(api('TRAINING_GET_MY', {}, tP2).rows.find(x => x.dish_id === solyanka).статус, 'ознакомлен');
});
step('новая версия ТТК: ознакомление «устарело», поварам одна задача', () => {
  const v2 = approve(borsch, '+2..+6 °C', '18 ч');
  assert.equal(api('TRAINING_GET_MY', {}, tP1).rows[0].статус, 'устарело');
  let tasks = G.findRows_('TASKS', t => t.source_entity_id === v2);
  assert.deepEqual(tasks.map(t => [t.type, t.responsible_role]), [['briefing', 'ПОВАР']]);
  assert(/Борщ» v2/.test(tasks[0].title));
  G.trainingOnTtkApproved_(v2, { organization_id: 'ORG-1', location_id: 'LOC-1', user_id: 'USR-T' });
  assert.equal(G.findRows_('TASKS', t => t.source_entity_id === v2).length, 1);
});
step('вопрос шефа: проверка, сохранение и попадание в тест', () => {
  assert(/минимум 3 разных/.test(apiErr('TRAINING_SAVE_QUESTION', { dishId: cutlet, вопрос: 'Чем панируем?', варианты: ['Сухари', 'Сухари', 'Мука'], верный: 0 }, tC)));
  assert(/Отметьте верный/.test(apiErr('TRAINING_SAVE_QUESTION', { dishId: cutlet, вопрос: 'Чем панируем?', варианты: ['Сухари', 'Мука', 'Кунжут'], верный: 5 }, tC)));
  api('TRAINING_SAVE_QUESTION', { dishId: cutlet, вопрос: 'Чем панируем котлету?', варианты: ['Сухари', 'Мука', 'Кунжут'], верный: 0 }, tC);
  assert.equal(api('TRAINING_GET_QUESTIONS', { dishId: cutlet }, tC).length, 1);
  const q = api('TRAINING_START_QUIZ', { dishId: cutlet }, tP1);
  assert(q.вопросы.some(x => x.вопрос === 'Чем панируем котлету?'));
});
step('матрица: повара и шеф × блюда, покрытие', () => {
  const m = api('TRAINING_GET_MATRIX', {}, tC);
  assert.deepEqual(m.блюда.map(b => [b.название, b.version]), [['Борщ', 2], ['Котлета', 1], ['Солянка', 1]]);
  assert.deepEqual(m.сотрудники.map(s => s.имя), ['Анна', 'Игорь', 'Пётр']);
  const igor = m.сотрудники.find(s => s.имя === 'Игорь');
  assert.deepEqual(igor.статусы, ['устарело', 'ознакомлен', 'не_ознакомлен']);
  assert.equal(m.покрытие_pct, 0);
  assert.equal(api('TRAINING_GET_MATRIX', {}, tT).сотрудники.length, 3, 'технолог HACCP тоже видит');
});
step('самопроверка (runPosTests_) видит листы и действия обучения', () => {
  assert.deepEqual(G.runPosTests_().filter(x => x.status !== 'OK' && /TRAIN|TTK_ACK/.test(x.name)), []);
});
console.log(failures ? '\n' + failures + ' FAILED' : '\nALL PASSED');
process.exit(failures ? 1 : 0);
