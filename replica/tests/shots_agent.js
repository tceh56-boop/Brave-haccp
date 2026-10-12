// ИИ-директор в браузере: вопрос → ответ с данными → предложение → «Выполнить» (390).
// Запуск: node replica/tests/shots_agent.js
const path = require('path');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const { ctx: G } = require('./harness.js');
const GAS = path.join(__dirname, '../../gas'), OUT = path.join(__dirname, '../clone-screens');
G.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', 'SS');
G.initializeDatabase();
G.insertRow_('ORGANIZATIONS', { organization_id: 'ORG-1', название: 'Кафе', статус: 'активна' });
G.insertRow_('LOCATIONS', { location_id: 'LOC-1', organization_id: 'ORG-1', название: 'Кафе «Печка»', статус: 'активна' });
function mk(id, name, role, pin) { G.insertRow_('USERS', { user_id: id, organization_id: 'ORG-1', location_ids: 'LOC-1', имя: name, роль: role, статус: 'активен', pin_hash: G.hashPin_(pin, 's' + id), pin_salt: 's' + id, failed_attempts: 0, lockout_count: 0 }); }
mk('USR-D', 'Денис', 'ДИРЕКТОР', '739164');
let tok = G.processOperation('LOGIN', { userId: 'USR-D', pin: '739164' }).data.token;
const sel = G.processOperation('SELECT_LOCATION', { locationId: 'LOC-1' }, tok); if (sel.ok && sel.data.token) tok = sel.data.token;
const api = (a, d) => { const r = G.processOperation(a, d || {}, tok); if (!r.ok) throw new Error(a + ': ' + r.error); return r.data; };
const p = api('CREATE_PRODUCT', { название: 'Говядина', единица: 'кг', цена: 600 }); const beef = p.product_id || p.product.product_id;
const steak = api('CREATE_DISH', { название: 'Стейк рибай', выход: 250, цена_продажи: 950 }).dish_id;
api('ADD_RECIPE_LINE', { parentType: 'DISH', parentId: steak, ingredientId: beef, брутто: 0.35, нетто: 0.35, единица: 'кг' });
api('RECEIVE_GOODS', { productId: beef, qty: 10, price: 880, expiryDate: '2099-01-01', productionDate: G.todayDateStr_() });
G.PropertiesService.getScriptProperties().setProperty('YANDEX_AI_API_KEY', 'k'); G.PropertiesService.getScriptProperties().setProperty('YANDEX_FOLDER_ID', 'f');
// Подменённая модель: фуд-кост → ответ с цифрами + предложение задачи шефу.
G.UrlFetchApp = { fetch(url, o) {
  const b = JSON.parse(o.payload), last = b.messages[b.messages.length - 1];
  const r = j => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(j) });
  if (last.role === 'user') return r({ choices: [{ message: { content: '', tool_calls: [{ id: 'a', type: 'function', function: { name: 'food_cost', arguments: '{}' } }] } }] });
  const tools = b.messages.filter(m => m.role === 'tool');
  if (tools.length === 1) {
    const d = JSON.parse(last.content).data.rows[0];
    return r({ choices: [{ message: { content: '', tool_calls: [{ id: 'b', type: 'function', function: { name: 'propose_action', arguments: JSON.stringify({ action: 'CREATE_TASK',
      data: { title: 'Пересмотреть цену «' + d.название + '»: фуд-кост ' + d.food_cost + ' %', responsibleRole: 'ШЕФ-ПОВАР', priority: 'высокий' }, summary: 'Говядина подорожала, блюдо выше цели' }) } }] } }] });
  }
  const d = JSON.parse(tools[0].content).data.rows[0];
  return r({ choices: [{ message: { content: 'Фуд-кост «' + d.название + '» — ' + String(d.food_cost).replace('.', ',') + ' % при цели 30 %: говядина подорожала с 600 до 880 ₽/кг. Цена для цели — ' + d.рекомендованная_цена + ' ₽. Предлагаю поставить задачу шефу.' } }] });
} };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const errors = [];
  const pg = await browser.newPage({ viewport: { width: 390, height: 844 } });
  pg.on('pageerror', e => errors.push(e.message));
  await pg.exposeFunction('__gasApi', (a, d, t) => JSON.parse(JSON.stringify(G.processOperation(a, d, t))));
  await pg.addInitScript(t => {
    localStorage.setItem('tsekh_token', t);
    function r() { let ok = () => {}, fail = () => {}; const x = new Proxy({}, { get(_, k) {
      if (k === 'withSuccessHandler') return f => { ok = f; return x; };
      if (k === 'withFailureHandler') return f => { fail = f; return x; };
      if (k === 'withUserObject') return () => x;
      if (k === 'api') return (a, d, tk) => { window.__gasApi(a, d, tk).then(ok, fail); };
      return () => {}; } }); return x; }
    window.google = { script: { get run() { return r(); } } };
  }, tok);
  await pg.goto('file://' + GAS + '/Index.html'); await pg.waitForTimeout(1300);
  await pg.evaluate(() => navTo('ai')); await pg.waitForTimeout(400);
  await pg.fill('#aiChatInput', 'Почему вырос фуд-кост?'); await pg.press('#aiChatInput', 'Enter'); await pg.waitForTimeout(700);
  const answer = await pg.textContent('#aiChatLog');
  await pg.click('#aiChatLog button:text-is("Выполнить")'); await pg.waitForTimeout(500);
  const done = await pg.textContent('#aiChatLog');
  const tasks = G.findRows_('TASKS', t => /Пересмотреть цену/.test(t.title)).length;
  await pg.locator('#view-ai').screenshot({ path: OUT + '/AI-agent-390.png' });
  await pg.fill('#aiChatInput', 'спасибо'); await pg.press('#aiChatInput', 'Enter'); await pg.waitForTimeout(600);
  const btnAfter = await pg.$eval('#aiProp0', b => ({ disabled: b.disabled, text: b.textContent }));
  await browser.close();
  const res = {
    'ответ с цифрами из ЦЕХ': /Стейк рибай/.test(answer) && /32,42 %/.test(answer) && /1030 ₽/.test(answer),
    'карточка предложения': /Создать задачу/.test(answer) && /ШЕФ-ПОВАР/.test(answer),
    'видно, откуда данные': /Данные: фуд-кост/.test(answer),
    'выполнено кнопкой — задача создана один раз': /Готово\./.test(done) && tasks === 1,
    'после нового сообщения кнопка остаётся «Выполнено»': btnAfter.disabled && btnAfter.text === 'Выполнено',
    'ошибок в браузере нет': errors.length === 0
  };
  console.log(res, errors);
  process.exit(Object.values(res).every(Boolean) ? 0 : 1);
})();
