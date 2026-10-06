// Этап M8 в браузере: вкладка «QR-меню» у менеджера и страница меню у гостя (390 px).
// Запуск: node replica/tests/shots_m8.js
const path = require('path'), fs = require('fs'), vm = require('vm');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const { ctx: G, sheets } = require('./harness.js');
const GAS = path.join(__dirname, '../../gas'), OUT = path.join(__dirname, '../clone-screens');
G.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', 'SS');
G.initializeDatabase();
G.insertRow_('ORGANIZATIONS', { organization_id: 'ORG-1', название: 'Кафе', статус: 'активна' });
G.insertRow_('LOCATIONS', { location_id: 'LOC-1', organization_id: 'ORG-1', название: 'Кафе «Печка»', статус: 'активна' });
G.insertRow_('USERS', { user_id: 'USR-M', organization_id: 'ORG-1', location_ids: 'LOC-1', имя: 'Ольга', роль: 'МЕНЕДЖЕР', статус: 'активен', pin_hash: G.hashPin_('482915', 's'), pin_salt: 's', failed_attempts: 0, lockout_count: 0 });
[['CAT-1', 'Супы'], ['CAT-2', 'Горячее'], ['CAT-3', 'Напитки']].forEach(c => G.insertRow_('CATEGORIES', { category_id: c[0], название: c[1], тип: 'блюдо' }));
[['DISH-1', 'Борщ с говядиной', 'CAT-1', 350, 300, 'сельдерей, говядина', '160 ккал'], ['DISH-2', 'Солянка мясная', 'CAT-1', 390, 300, 'горчица', ''],
 ['DISH-3', 'Котлета по-киевски', 'CAT-2', 480, 250, 'глютен, яйцо, молоко', '420 ккал'], ['DISH-4', 'Морс клюквенный', 'CAT-3', 150, 300, '', '']].forEach((d, i) => {
  G.insertRow_('DISHES', { dish_id: d[0], organization_id: 'ORG-1', название: d[1], категория_id: d[2], цена_продажи: d[3], выход: d[4], статус: 'активно' });
  G.insertRow_('TTK_VERSIONS', { ttk_version_id: 'TTKV-' + i, dish_id: d[0], organization_id: 'ORG-1', version: 1, status: 'утверждена', аллергенная_информация: d[5], пищевая_ценность: d[6] });
});
let tok = G.processOperation('LOGIN', { userId: 'USR-M', pin: '482915' }).data.token;
const sel = G.processOperation('SELECT_LOCATION', { locationId: 'LOC-1' }, tok); if (sel.ok && sel.data.token) tok = sel.data.token;
const api = (a, d) => { const r = G.processOperation(a, d || {}, tok); if (!r.ok) throw new Error(a + ': ' + r.error); return r.data; };
const hall = api('POS_SAVE_HALL', { название: 'Зал' });
const t5 = api('POS_SAVE_TABLE', { hallId: hall.hall_id, название: '5' });
api('POS_SAVE_TABLE', { hallId: hall.hall_id, название: '6' });
const g = api('POS_SAVE_MODIFIER_GROUP', { название: 'Порция', мин: 1, макс: 1 });
api('POS_SAVE_MODIFIER', { groupId: g.group_id, название: 'Обычная', цена_delta: 0 });
api('POS_SAVE_MODIFIER', { groupId: g.group_id, название: 'Большая', цена_delta: 120 });
api('POS_LINK_DISH_MODIFIERS', { dishId: 'DISH-1', groupIds: [g.group_id] });
api('POS_OPEN_SHIFT', { cashStart: 0 });
const URL_OK = 'https://script.google.com/macros/s/AKfycbx_Demo/exec';

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const errors = [];
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
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
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await p.evaluate(() => navTo('pos')); await wait(500);
  await p.click('#posTabs >> text=QR-меню'); await wait(400);
  await p.fill('#qrUrl', URL_OK); await p.click('#posQrPanel >> text=Сохранить'); await wait(400);
  await p.click('text=Опубликовать меню сейчас'); await wait(400);
  const status = await p.textContent('#qrStatus');
  const tableLinks = await p.$$eval('#qrTables a', a => a.map(x => x.getAttribute('href')));
  await p.screenshot({ path: OUT + '/M8-qrmenu-settings-1280.png' });

  // Гость: публичный проект qrmenu/Code.gs читает тот же лист PUBLIC_MENU.
  const out = {};
  const Q = { console, JSON, Math, Date, String, Number, Object, Array, RegExp, Error,
    SpreadsheetApp: { openById: () => ({ getSheetByName: n => sheets[n] || null }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'SS' }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    Utilities: { formatDate: d => d.toISOString().slice(5, 16).replace('T', ' ') },
    HtmlService: { createHtmlOutput: h => { out.html = h; const o = { setTitle: () => o, addMetaTag: () => o }; return o; } } };
  vm.createContext(Q);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../qrmenu/Code.gs'), 'utf8'), Q);
  const link = new URL(tableLinks[0]);
  Q.doGet({ parameter: { m: link.searchParams.get('m'), t: link.searchParams.get('t') } });
  const guest = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await guest.setContent(out.html); await guest.waitForTimeout(200);
  await guest.screenshot({ path: OUT + '/M8-qrmenu-guest-390.png', fullPage: true });
  const guestText = await guest.textContent('body');
  await browser.close();

  const result = {
    'опубликовано, 4 блюда': /блюд в меню: 4/.test(status),
    'ссылки на 2 стола с ключом точки': tableLinks.length === 2 && tableLinks.every(h => h.startsWith(URL_OK + '?m=')),
    'гость видит заведение, стол 5, аллергены и варианты': /Кафе «Печка»/.test(guestText) && /Стол 5/.test(guestText) && /глютен/.test(guestText) && /Большая/.test(guestText),
    'ошибок в браузере нет': errors.length === 0
  };
  console.log(result, errors);
  process.exit(Object.values(result).every(Boolean) ? 0 : 1);
})();
