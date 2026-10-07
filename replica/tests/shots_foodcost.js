// Волна 3, M11 в браузере: фуд-кост у директора (1280), «Используй сегодня» у повара (390).
// Запуск: node replica/tests/shots_foodcost.js
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
const prod = (n, price) => { const p = api('CREATE_PRODUCT', { название: n, единица: 'кг', цена: price }); return p.product_id || p.product.product_id; };
const beef = prod('Говядина', 600), beet = prod('Свёкла', 50), cabbage = prod('Капуста', 40), cream = prod('Сливки 33 %', 420), salmon = prod('Лосось', 1500);
const dish = (name, price, lines) => { const d = api('CREATE_DISH', { название: name, выход: 300, цена_продажи: price }); lines.forEach(l => api('ADD_RECIPE_LINE', { parentType: 'DISH', parentId: d.dish_id, ingredientId: l[0], брутто: l[1], нетто: l[1], единица: 'кг' })); return d.dish_id; };
const mince = api('CREATE_SEMI_FINISHED', { название: 'Фарш говяжий', выход: 1, единица: 'кг', срокХраненияЧасов: 12 }).pf_id;
api('ADD_RECIPE_LINE', { parentType: 'PF', parentId: mince, ingredientId: beef, брутто: 1, нетто: 1, единица: 'кг' });
dish('Борщ', 350, [[beef, 0.1], [beet, 0.08], [cabbage, 0.06]]);
dish('Стейк рибай', 950, [[beef, 0.35]]);
dish('Котлета домашняя', 320, [[mince, 0.15]]);
dish('Паста с лососем', 590, [[salmon, 0.1], [cream, 0.08]]);
api('RECEIVE_GOODS', { productId: beef, qty: 10, price: 880, expiryDate: '2099-01-01', productionDate: D });
api('RECEIVE_GOODS', { productId: cream, qty: 2, price: 420, expiryDate: D, productionDate: day(-5) });
api('RECEIVE_GOODS', { productId: beet, qty: 3, price: 50, expiryDate: day(1), productionDate: D });

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const errors = [];
  async function open(tok, w, h, view) {
    const p = await browser.newPage({ viewport: { width: w, height: h } });
    p.on('pageerror', e => errors.push(e.message));
    p.on('dialog', d => d.accept());
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
    await p.evaluate(v => navTo(v), view); await p.waitForTimeout(600);
    return p;
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const dir = await open(tD, 1280, 900, 'foodcost');
  const over = await dir.textContent('#fcOver');
  const first = await dir.textContent('#fcList .fc-row b');
  const why = await dir.textContent('#fcList');
  await dir.screenshot({ path: OUT + '/M11-foodcost-1280.png', fullPage: true });
  await dir.click('#fcList .fc-row >> button:has-text("Установить")'); await wait(700);
  const overAfter = await dir.textContent('#fcOver');
  const info = await dir.textContent('#fcInfo');

  const chef = await open(tC, 1280, 900, 'foodcost');
  const chefNoSettings = await chef.$eval('#fcSettings', e => e.classList.contains('hidden'));
  const cook = await open(tP, 390, 844, 'prep');
  const cookMenuHasFc = await cook.$eval('#sideMenu button[data-view="foodcost"]', e => !e.classList.contains('hidden'));
  const ut = await cook.textContent('#useTodayList');
  await cook.locator('#useTodayCard').screenshot({ path: OUT + '/M11-use-today-390.png' });
  await browser.close();

  const res = {
    'выше цели 3 из 4': /^3 из 4$/.test(over.trim()),
    'первым — самый высокий фуд-кост': first === 'Котлета домашняя',
    'причина: говядина подорожала': /Говядина 600 ₽ → 880 ₽/.test(why),
    'цена установлена — выше цели 2': /^2 из 4$/.test(overAfter.trim()),
    'шеф не меняет цель': chefNoSettings,
    'у повара нет пункта «Фуд-кост»': !cookMenuHasFc,
    'используй сегодня: сливки в пасту': /Сливки 33 %/.test(ut) && /Паста с лососем — до 25 порц/.test(ut) && /срок сегодня/.test(ut),
    'ошибок в браузере нет': errors.length === 0
  };
  console.log(res, errors, info);
  process.exit(Object.values(res).every(Boolean) ? 0 : 1);
})();
