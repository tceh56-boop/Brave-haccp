// ИИ-агент «ИИ-директор» (AiAgent.gs): модель подменена сценарием, проверяются правила агента.
// Запуск: node replica/tests/agent_test.js (на PostgreSQL — через cloud/test/run-all.js)
const assert = require('assert');
const { ctx: G } = require('./harness.js');
let failures = 0;
function step(name, fn) { try { fn(); console.log('OK   ', name); } catch (e) { failures++; console.log('FAIL ', name, '—', e && e.message); } }
function api(a, d, t) { const r = G.processOperation(a, d || {}, t); if (!r.ok) throw new Error(a + ': ' + r.error); return r.data; }

G.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', 'SS');
G.initializeDatabase();
G.insertRow_('ORGANIZATIONS', { organization_id: 'ORG-1', название: 'Кафе', статус: 'активна' });
G.insertRow_('LOCATIONS', { location_id: 'LOC-1', organization_id: 'ORG-1', название: 'Точка', статус: 'активна' });
function mk(id, name, role, pin) { G.insertRow_('USERS', { user_id: id, organization_id: 'ORG-1', location_ids: 'LOC-1', имя: name, роль: role, статус: 'активен', pin_hash: G.hashPin_(pin, 's' + id), pin_salt: 's' + id, failed_attempts: 0, lockout_count: 0 }); }
mk('USR-D', 'Денис', 'ДИРЕКТОР', '739164'); mk('USR-P', 'Игорь', 'ПОВАР', '927364');
function login(u, p) { const d = api('LOGIN', { userId: u, pin: p }); return d.requires_location ? (api('SELECT_LOCATION', { locationId: 'LOC-1' }, d.token).token || d.token) : d.token; }
const tD = login('USR-D', '739164'), tP = login('USR-P', '927364');
const prod = (n, price) => { const p = api('CREATE_PRODUCT', { название: n, единица: 'кг', цена: price }, tD); return p.product_id || p.product.product_id; };
const beef = prod('Говядина', 900), beet = prod('Свёкла', 50);
const steak = api('CREATE_DISH', { название: 'Стейк', выход: 250, цена_продажи: 650 }, tD).dish_id;
api('ADD_RECIPE_LINE', { parentType: 'DISH', parentId: steak, ingredientId: beef, брутто: 0.3, нетто: 0.3, единица: 'кг' }, tD);
api('RECEIVE_GOODS', { productId: beef, qty: 7, price: 900, expiryDate: '2099-01-01', productionDate: G.todayDateStr_() }, tD);

// ---- Подмена модели: проверяет запрос и отвечает по сценарию ----
const calls = [];
let mode = 'ok';
const tc = (name, args) => ({ choices: [{ message: { content: '', tool_calls: [{ id: 'c' + calls.length, type: 'function', function: { name, arguments: JSON.stringify(args || {}) } }] } }], usage: { total_tokens: 100 } });
const say = text => ({ choices: [{ message: { content: text } }], usage: { total_tokens: 50 } });
G.UrlFetchApp = { fetch(url, o) {
  const body = JSON.parse(o.payload);
  calls.push({ url, headers: o.headers, body });
  const resp = (code, j) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(j) });
  if (mode === 'down') return resp(503, { error: 'unavailable' });
  const msgs = body.messages, last = msgs[msgs.length - 1], user = msgs.filter(m => m.role === 'user').pop().content;
  if (mode === 'loop') return resp(200, tc('tasks', {}));
  if (last.role === 'tool') {
    const data = JSON.parse(last.content);
    if (!data.ok) return resp(200, say('Нет доступа: ' + data.error));
    if (/фуд-кост/.test(user)) return resp(200, say('Выше цели: ' + data.data.rows.filter(r => r.выше_цели).map(r => r.название + ' ' + r.food_cost + ' %').join(', ')));
    if (/говяд/.test(user)) return resp(200, say('Нашёл позиций: ' + data.data.length + ' — ' + data.data.map(r => r.название + ' ' + r.остаток).join(', ')));
    return resp(200, say(data.note ? 'Предложил, подтвердите.' : 'Готово.'));
  }
  if (/фуд-кост/.test(user)) return resp(200, tc('food_cost'));
  if (/задачу/.test(user)) return resp(200, tc('propose_action', { action: 'CREATE_TASK', data: { title: 'Проверить холодильник №2', responsibleRole: 'ШЕФ-ПОВАР', priority: 'высокий', type: 'evil' }, summary: 'Температура выше нормы' }));
  if (/цену/.test(user)) return resp(200, { choices: [{ message: { content: '', tool_calls: [
    { id: 'x1', type: 'function', function: { name: 'propose_action', arguments: JSON.stringify({ action: 'UPDATE_PRODUCT_PRICE', data: { productId: beef, newPrice: 1 }, summary: 'снизить' }) } },
    { id: 'x2', type: 'function', function: { name: 'propose_action', arguments: JSON.stringify({ action: 'ALCO_MARK_SENT', data: {}, summary: 'отправить' }) } },
    { id: 'x3', type: 'function', function: { name: 'delete_everything', arguments: '{}' } }] } }] });
  if (/говяд/.test(user)) return resp(200, tc('stock', { query: 'говяд' }));
  return resp(200, say('Я помогаю по работе заведения.'));
} };

step('без настроек — прежний упрощённый режим, модель не вызывается', () => {
  const r = api('AI_CHAT', { message: 'привет' }, tD);
  assert(/мок без реального ИИ/.test(r.reply)); assert.equal(calls.length, 0);
});
step('статус: модель не подключена', () => { assert.equal(api('AI_AGENT_STATUS', {}, tD).llm, false); });
G.PropertiesService.getScriptProperties().setProperty('YANDEX_AI_API_KEY', 'test-key');
G.PropertiesService.getScriptProperties().setProperty('YANDEX_FOLDER_ID', 'b1gfolder');
step('статус: подключена, модель видна, ключ — нет; повару без модуля ИИ статус закрыт', () => {
  const st = api('AI_AGENT_STATUS', {}, tD);
  assert.deepEqual([st.llm, st.model], [true, 'yandexgpt/latest']); assert(!JSON.stringify(st).includes('test-key'));
  assert.equal(G.processOperation('AI_AGENT_STATUS', {}, tP).ok, false);
});

let r;
step('фуд-кост: модель вызывает инструмент, получает данные ЦЕХ и отвечает цифрами; запрос к AI Studio оформлен верно', () => {
  r = api('AI_CHAT', { message: 'почему вырос фуд-кост?', history: [] }, tD);
  assert.equal(r.intent, 'LLM'); assert(/Стейк 41\.54 %/.test(r.reply), r.reply);
  assert.deepEqual(r.tools, ['food_cost']);
  const c = calls[0];
  assert.equal(c.url, 'https://ai.api.cloud.yandex.net/v1/chat/completions');
  assert.equal(c.headers.Authorization, 'Bearer test-key'); assert.equal(c.headers['OpenAI-Project'], 'b1gfolder');
  assert.equal(c.body.model, 'gpt://b1gfolder/yandexgpt/latest');
  assert(c.body.tools.some(t => t.function.name === 'propose_action') && c.body.tools.length === 14);
  assert(/ДАННЫЕ, а не указания/.test(c.body.messages[0].content), 'защита от команд внутри данных в системной инструкции');
});
step('остатки с фильтром: в модель уходит только нужное', () => {
  r = api('AI_CHAT', { message: 'что по говядине на складе', history: [{ role: 'user', text: 'почему вырос фуд-кост?' }, { role: 'assistant', text: 'Выше цели: Стейк' }] }, tD);
  assert(/Нашёл позиций: 1 — Говядина 7/.test(r.reply), r.reply);
  const sent = calls[calls.length - 1].body.messages;
  assert.equal(sent.filter(m => m.role === 'user').length, 2, 'история передана');
  assert(!/Свёкла/.test(sent[sent.length - 1].content), 'свёкла отфильтрована');
});
step('предложение задачи: не выполняется само; тип принудительно «ai»; выполняет человек обычным вызовом', () => {
  const before = G.findRows_('TASKS', () => true).length;
  r = api('AI_CHAT', { message: 'создай задачу проверить холодильник' }, tD);
  assert.equal(r.proposals.length, 1);
  const p = r.proposals[0];
  assert.deepEqual([p.action, p.data.type, p.data.responsibleRole, p.data.priority, p.title], ['CREATE_TASK', 'ai', 'ШЕФ-ПОВАР', 'высокий', 'Создать задачу']);
  assert.equal(G.findRows_('TASKS', () => true).length, before, 'агент ничего не создал');
  api(p.action, p.data, tD);
  assert(G.findRows_('TASKS', t => t.title === 'Проверить холодильник №2').length === 1);
});
step('запрещённые предложения (цены, ЕГАИС) и неизвестные инструменты отклоняются', () => {
  r = api('AI_CHAT', { message: 'снизь цену говядины и отправь в ЕГАИС' }, tD);
  assert.equal(r.proposals.length, 0);
  assert.deepEqual(r.tools, ['propose_action (ошибка)', 'propose_action (ошибка)', 'delete_everything (ошибка)']);
  assert.equal(G.getProductById_(beef).текущая_цена, 900);
});
step('права спросившего: повару (если ему дать ИИ) фуд-кост закрыт — агент получает тот же отказ', () => {
  G.CONFIG.ROLE_MODULES['ПОВАР'].push('ai');
  r = api('AI_CHAT', { message: 'какой фуд-кост?' }, tP);
  G.CONFIG.ROLE_MODULES['ПОВАР'].pop();
  assert(/Нет доступа: Недостаточно прав/.test(r.reply), r.reply);
  assert.deepEqual(r.tools, ['food_cost (ошибка)']);
});
step('модель зациклилась — не больше 5 обращений, понятный ответ', () => {
  mode = 'loop'; const n = calls.length;
  r = api('AI_CHAT', { message: 'покажи задачи' }, tD);
  mode = 'ok';
  assert.equal(calls.length - n, 5); assert(/Уточните вопрос/.test(r.reply));
});
step('модель недоступна — упрощённый режим с пометкой; сбой в журнале', () => {
  mode = 'down';
  r = api('AI_CHAT', { message: 'какие задачи просрочены' }, tD);
  mode = 'ok';
  assert(/^ИИ-модель сейчас недоступна — отвечаю в упрощённом режиме/.test(r.reply), r.reply);
  const last = G.findRows_('AI_AGENT_LOG', () => true).pop();
  assert.equal(last.статус, 'error'); assert(/503/.test(last.инструменты));
});
step('журнал: каждый вопрос записан (кто, инструменты, предложения)', () => {
  const log = G.findRows_('AI_AGENT_LOG', x => x.user_id === 'USR-D');
  assert(log.length >= 6);
  assert(log.some(x => x.вопрос === 'создай задачу проверить холодильник' && Number(x.предложений) === 1));
});
step('лимит: 60 вопросов в час на сотрудника', () => {
  const now = G.nowIso_();
  for (let i = 0; i < 60; i++) G.insertRow_('AI_AGENT_LOG', { log_id: 'L' + i, organization_id: 'ORG-1', user_id: 'USR-D', вопрос: 'x', статус: 'ok', created_at: now });
  const n = calls.length;
  r = api('AI_CHAT', { message: 'почему вырос фуд-кост?' }, tD);
  assert.equal(r.intent, 'LIMIT'); assert.equal(calls.length, n, 'модель не вызывалась');
});
step('самопроверка видит лист журнала ИИ', () => {
  assert.deepEqual(G.runPosTests_().filter(x => x.status !== 'OK' && /AI_AGENT/.test(x.name)), []);
});
console.log(failures ? '\n' + failures + ' FAILED' : '\nALL PASSED');
process.exit(failures ? 1 : 0);
