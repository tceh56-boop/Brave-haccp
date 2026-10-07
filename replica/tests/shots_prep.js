// Волна 3, M9 в браузере: заготовочный лист у шефа (1280) и у повара (390).
// Запуск: node replica/tests/shots_prep.js
const path = require('path');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const { ctx: G } = require('./harness.js');
const GAS = path.join(__dirname, '../../gas'), OUT = path.join(__dirname, '../clone-screens');
G.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', 'SS');
G.initializeDatabase();
G.insertRow_('ORGANIZATIONS', { organization_id: 'ORG-1', название: 'Кафе', статус: 'активна' });
G.insertRow_('LOCATIONS', { location_id: 'LOC-1', organization_id: 'ORG-1', название: 'Кафе «Печка»', статус: 'активна' });
function mk(id, name, role, pin) { G.insertRow_('USERS', { user_id: id, organization_id: 'ORG-1', location_ids: 'LOC-1', имя: name, роль: role, статус: 'активен', pin_hash: G.hashPin_(pin, 's' + id), pin_salt: 's' + id, failed_attempts: 0, lockout_count: 0 }); }
mk('USR-C', 'Анна', 'ШЕФ-ПОВАР', '482915'); mk('USR-D', 'Олег', 'ДИРЕКТОР', '739164'); mk('USR-P', 'Игорь', 'ПОВАР', '927364');
function login(u, p) { let t = G.processOperation('LOGIN', { userId: u, pin: p }).data.token; const s = G.processOperation('SELECT_LOCATION', { locationId: 'LOC-1' }, t); return s.ok && s.data.token ? s.data.token : t; }
const tC = login('USR-C', '482915'), tP = login('USR-P', '927364'), tD = login('USR-D', '739164');
const api = (a, d, t) => { const r = G.processOperation(a, d || {}, t || tD); if (!r.ok) throw new Error(a + ': ' + r.error); return r.data; };
const D = G.todayDateStr_(), day = n => G._dpAddDays_(D, n);
const prod = (name, price) => { const p = api('CREATE_PRODUCT', { название: name, единица: 'кг', цена: price }); const id = p.product_id || p.product.product_id; api('RECEIVE_GOODS', { productId: id, qty: 20, price, expiryDate: '2099-01-01', productionDate: D }); return id; };
const bones = prod('Кости говяжьи', 120), onion = prod('Лук', 40), beet = prod('Свёкла', 50);
const pf = (name, unit, lines) => { const x = api('CREATE_SEMI_FINISHED', { название: name, выход: 1, единица: unit, срокХраненияЧасов: 48 }); lines.forEach(l => api('ADD_RECIPE_LINE', { parentType: 'PF', parentId: x.pf_id, ingredientId: l[0], брутто: l[1], нетто: l[1], единица: 'кг' })); return x.pf_id; };
const broth = pf('Бульон говяжий', 'л', [[bones, 0.5]]), fried = pf('Пассеровка луковая', 'кг', [[onion, 1.2]]), beetPf = pf('Свёкла тушёная', 'кг', [[beet, 1.15]]);
const dish = (name, lines) => { const d = api('CREATE_DISH', { название: name, выход: 300, цена_продажи: 350 }); lines.forEach(l => api('ADD_RECIPE_LINE', { parentType: 'DISH', parentId: d.dish_id, ingredientId: l[0], брутто: l[1], нетто: l[1], единица: l[2] })); return d.dish_id; };
const borsch = dish('Борщ', [[broth, 300, 'мл'], [fried, 30, 'г'], [beetPf, 60, 'г']]), solyanka = dish('Солянка', [[broth, 300, 'мл'], [fried, 25, 'г']]);
const sale = (id, d, q) => G.insertRow_('SALES', { sale_id: 'S-' + Math.random(), organization_id: 'ORG-1', location_id: 'LOC-1', dish_id: id, qty: q, сумма: q * 350, дата: d, источник: 'тест' });
[[-7, 42, 18], [-14, 38, 22], [-21, 40, 20], [-28, 36, 16], [-3, 25, 10]].forEach(r => { sale(borsch, day(r[0]), r[1]); sale(solyanka, day(r[0]), r[2]); });
api('PREP_SAVE_PAR', { pfId: broth, норма: 3 }, tC); api('PREP_SAVE_PAR', { pfId: fried, норма: 0.5 }, tC);
G.insertRow_('BATCHES', { batch_id: 'B-1', product_id: beetPf, location_id: 'LOC-1', количество: 1.5, срок_годности: '2099-01-01', статус: 'активна' });

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
    await p.evaluate(() => navTo('prep')); await p.waitForTimeout(500);
    return p;
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const chef = await open(tC, 1280, 900);
  const preview = await chef.textContent('#prepInfo');
  await chef.click('#prepParsCard summary'); await wait(300);
  await chef.screenshot({ path: OUT + '/M9-prep-preview-1280.png', fullPage: true });
  await chef.click('#prepBuildBtn'); await wait(500);
  const built = await chef.textContent('#prepInfo');
  const dateShown = await chef.inputValue('#prepDate');

  const cook = await open(tP, 390, 844);
  const parsHidden = await cook.$eval('#prepParsCard', e => getComputedStyle(e).display === 'none');
  const firstName = await cook.textContent('#prepList .prep-row .prep-name');
  await cook.click('#prepList .prep-row >> button:text-is("Сделано")'); await wait(600);
  const doneBadge = await cook.textContent('#prepList');
  await cook.screenshot({ path: OUT + '/M9-prep-cook-390.png', fullPage: true });
  await browser.close();

  const result = {
    'шеф видит предварительный расчёт': /Предварительный расчёт/.test(preview),
    'дата — с сервера': dateShown === D,
    'лист сформирован': /Лист сформирован/.test(built),
    'бульон первым (больше всего к заготовке)': firstName === 'Бульон говяжий',
    'повар не видит нормы': parsHidden,
    'повар отметил «Сделано»': /Сделано: /.test(doneBadge),
    'ошибок в браузере нет': errors.length === 0
  };
  console.log(result, errors);
  process.exit(Object.values(result).every(Boolean) ? 0 : 1);
})();
