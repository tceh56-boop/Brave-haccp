// Волна 3, M10 в браузере: повар проходит тест (390), шеф видит матрицу (1280).
// Запуск: node replica/tests/shots_training.js
const path = require('path');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const { ctx: G } = require('./harness.js');
const GAS = path.join(__dirname, '../../gas'), OUT = path.join(__dirname, '../clone-screens');
G.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', 'SS');
G.initializeDatabase();
G.insertRow_('ORGANIZATIONS', { organization_id: 'ORG-1', название: 'Кафе', статус: 'активна' });
G.insertRow_('LOCATIONS', { location_id: 'LOC-1', organization_id: 'ORG-1', название: 'Кафе «Печка»', статус: 'активна' });
function mk(id, name, role, pin) { G.insertRow_('USERS', { user_id: id, organization_id: 'ORG-1', location_ids: 'LOC-1', имя: name, роль: role, статус: 'активен', pin_hash: G.hashPin_(pin, 's' + id), pin_salt: 's' + id, failed_attempts: 0, lockout_count: 0 }); }
mk('USR-C', 'Анна', 'ШЕФ-ПОВАР', '482915'); mk('USR-D', 'Олег', 'ДИРЕКТОР', '739164'); mk('USR-P', 'Игорь', 'ПОВАР', '927364'); mk('USR-P2', 'Пётр', 'ПОВАР', '531846'); mk('USR-T', 'Вера', 'ТЕХНОЛОГ_HACCP', '284617');
function login(u, p) { let t = G.processOperation('LOGIN', { userId: u, pin: p }).data.token; const s = G.processOperation('SELECT_LOCATION', { locationId: 'LOC-1' }, t); return s.ok && s.data.token ? s.data.token : t; }
const tC = login('USR-C', '482915'), tP = login('USR-P', '927364'), tD = login('USR-D', '739164'), tT = login('USR-T', '284617'), tP2 = login('USR-P2', '531846');
const api = (a, d, t) => { const r = G.processOperation(a, d || {}, t || tD); if (!r.ok) throw new Error(a + ': ' + r.error); return r.data; };

const prod = n => { const p = api('CREATE_PRODUCT', { название: n, единица: 'кг', цена: 100 }); return p.product_id || p.product.product_id; };
const [beet, cabbage, meat, cucumber, bread, egg, potato] = ['Свёкла', 'Капуста', 'Говядина', 'Огурцы солёные', 'Сухари', 'Яйцо', 'Картофель'].map(prod);
function dishWithTtk(name, lines, storage, shelf) {
  const d = api('CREATE_DISH', { название: name, выход: 300, цена_продажи: 350 });
  lines.forEach(l => api('ADD_RECIPE_LINE', { parentType: 'DISH', parentId: d.dish_id, ingredientId: l[0], брутто: l[1], нетто: l[2], единица: 'кг' }));
  const v = api('CREATE_TTK_VERSION', { dishId: d.dish_id, технология: 'Мясо отварить, овощи нашинковать, свёклу тушить отдельно, соединить и довести до кипения', условия_хранения: storage, срок_реализации: shelf, аллергенная_информация: name === 'Котлета' ? 'глютен, яйцо' : '' });
  api('SUBMIT_TTK_FOR_APPROVAL', { ttkVersionId: v.ttk_version_id });
  api('APPROVE_TTK_VERSION', { ttkVersionId: v.ttk_version_id }, tT);
  return d.dish_id;
}
const borsch = dishWithTtk('Борщ', [[beet, 0.08, 0.064], [cabbage, 0.06, 0.048], [meat, 0.1, 0.074], [potato, 0.05, 0.04]], '+2..+6 °C', '24 ч');
const solyanka = dishWithTtk('Солянка', [[meat, 0.12, 0.09], [cucumber, 0.04, 0.035]], '+2..+6 °C', '48 ч');
const cutlet = dishWithTtk('Котлета', [[meat, 0.15, 0.11], [bread, 0.02, 0.02], [egg, 0.01, 0.01]], '0..+4 °C', '12 ч');
const pass = (tok, dish) => { api('TRAINING_ACK', { dishId: dish }, tok); const q = api('TRAINING_START_QUIZ', { dishId: dish }, tok); const a = JSON.parse(G.findOne_('TRAINING_ATTEMPTS', 'attempt_id', q.attempt_id).вопросы_json).map(x => x.верный); api('TRAINING_SUBMIT_QUIZ', { attemptId: q.attempt_id, answers: a }, tok); };
pass(tP2, solyanka); pass(tP2, cutlet); api('TRAINING_ACK', { dishId: borsch }, tP2); pass(tC, borsch);

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const errors = [];
  async function open(tok, w, h) {
    const p = await browser.newPage({ viewport: { width: w, height: h } });
    p.on('pageerror', e => errors.push(e.message));
    await p.exposeFunction('__gasApi', (a, d, t) => JSON.parse(JSON.stringify(G.processOperation(a, d, t))));
    await p.addInitScript(t => {
      localStorage.setItem('tsekh_token', t);
      function r() { let ok = () => {}, fail = () => {}; const x = new Proxy({}, { get(_, k) {
        if (k === 'withSuccessHandler') return f => { ok = f; return x; };
        if (k === 'withFailureHandler') return f => { fail = f; return x; };
        if (k === 'withUserObject') return () => x;
        if (k === 'api') return (a, d, tk) => { window.__gasApi(a, d, tk).then(ok, fail); };
        return () => {}; } }); return x; }
      window.google = { script: { get run() { return r(); } } };
    }, tok);
    await p.goto('file://' + GAS + '/Index.html'); await p.waitForTimeout(700);
    await p.evaluate(() => navTo('training')); await p.waitForTimeout(600);
    return p;
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const cook = await open(tP, 390, 844);
  const chefHidden = await cook.$eval('#trChef', e => e.classList.contains('hidden'));
  await cook.click('#trMine .tr-row:has-text("Борщ") >> button:text-is("Открыть")'); await wait(400);
  await cook.screenshot({ path: OUT + '/M10-ttk-card-390.png', fullPage: true });
  await cook.click('#trCard >> button:text-is("Ознакомлен")'); await wait(500);
  await cook.click('#trCard >> button:text-is("Пройти тест")'); await wait(500);
  const attempt = G.findRows_('TRAINING_ATTEMPTS', a => a.user_id === 'USR-P' && a.результат === 'начат')[0];
  const right = JSON.parse(attempt.вопросы_json).map(x => x.верный);
  for (let i = 0; i < right.length; i++) await cook.check(`input[name="trq${i}"][value="${right[i]}"]`);
  await cook.click('#trQuiz >> button:text-is("Проверить")'); await wait(500);
  const result = await cook.textContent('#trResult');
  await cook.locator('#trQuiz').screenshot({ path: OUT + '/M10-quiz-passed-390.png' });
  const summary = await cook.textContent('#trSummary');

  const chef = await open(tC, 1280, 900);
  const matrix = await chef.textContent('#trMatrix');
  await chef.locator('#trChef .card').first().screenshot({ path: OUT + '/M10-matrix-1280.png' });
  await browser.close();

  const res = {
    'повар не видит матрицу': chefHidden,
    'тест сдан': /Сдано/.test(result),
    'у повара 1 из 3': /1 из 3/.test(summary),
    'матрица: Пётр аттестован по 2 блюдам, покрытие': /Пётр/.test(matrix) && /2\/3/.test(matrix) && /Покрытие аттестацией/.test(matrix),
    'ошибок в браузере нет': errors.length === 0
  };
  console.log(res, errors);
  process.exit(Object.values(res).every(Boolean) ? 0 : 1);
})();
