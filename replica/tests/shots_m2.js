// Этап M2 в браузере: настройка зала, официант, кухня, касса. Скриншоты в replica/clone-screens.
// Запуск: node replica/tests/shots_m2.js
const path = require('path');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const { ctx: G } = require('./harness.js');
const GAS = path.join(__dirname, '../../gas'), OUT = path.join(__dirname, '../clone-screens');
G.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', 'SS');
G.initializeDatabase();
G.insertRow_('ORGANIZATIONS', { organization_id: 'ORG-1', название: 'Кафе', статус: 'активна' });
G.insertRow_('LOCATIONS', { location_id: 'LOC-1', organization_id: 'ORG-1', название: 'Точка', статус: 'активна' });
function mk(id, name, role) { G.insertRow_('USERS', { user_id: id, organization_id: 'ORG-1', location_ids: 'LOC-1', имя: name, роль: role, статус: 'активен', pin_hash: G.hashPin_('482915', 's' + id), pin_salt: 's' + id, failed_attempts: 0, lockout_count: 0 }); }
mk('USR-M', 'Ольга', 'МЕНЕДЖЕР'); mk('USR-W', 'Игорь', 'ОФИЦИАНТ'); mk('USR-W2', 'Мария', 'ОФИЦИАНТ'); mk('USR-C', 'Сергей', 'ПОВАР');
[['CAT-1', 'Супы'], ['CAT-2', 'Горячее'], ['CAT-3', 'Напитки']].forEach(c => G.insertRow_('CATEGORIES', { category_id: c[0], название: c[1], тип: 'блюдо' }));
[['Борщ с говядиной', 350, 'CAT-1'], ['Солянка мясная', 390, 'CAT-1'], ['Котлета по-киевски', 480, 'CAT-2'], ['Морс клюквенный', 120, 'CAT-3']].forEach((d, i) =>
  G.insertRow_('DISHES', { dish_id: 'DISH-' + i, organization_id: 'ORG-1', название: d[0], категория_id: d[2], цена_продажи: d[1], статус: 'активно' }));
function token(u) { let t = G.processOperation('LOGIN', { userId: u, pin: '482915' }).data.token; const s = G.processOperation('SELECT_LOCATION', { locationId: 'LOC-1' }, t); return (s.ok && s.data.token) || t; }
const tok = { M: token('USR-M'), W: token('USR-W'), W2: token('USR-W2'), C: token('USR-C') };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const errors = [];
  async function page(who, w, h) {
    const p = await browser.newPage({ viewport: { width: w, height: h } });
    p.on('pageerror', e => errors.push(who + ': ' + e.message));
    p.on('dialog', d => d.accept(d.message().indexOf('перенести') !== -1 ? '3' : undefined));
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
    }, tok[who]);
    await p.goto('file://' + GAS + '/Index.html');
    await p.waitForTimeout(700);
    return p;
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));

  // 1. Менеджер: открывает смену, настраивает зал.
  const m = await page('M', 1440, 900);
  await m.evaluate(() => navTo('pos')); await wait(400);
  await m.fill('#posCashStart', '3000'); await m.click('text=Открыть смену'); await wait(500);
  await m.click('#posTabs >> text=Настройка зала'); await wait(300);
  await m.fill('#posHallName', 'Основной зал'); await m.click('text=Добавить зал'); await wait(300);
  for (const n of ['1', '2', '3', '4', '5', '6']) { await m.fill('#posTableName', n); await m.click('text=Добавить стол'); await wait(150); }
  await m.screenshot({ path: OUT + '/M2-hall-settings-1440.png' });

  // 2. Официант на телефоне: зал → стол 2 → блюда → на кухню.
  const w = await page('W', 390, 844);
  await w.evaluate(() => navTo('pos')); await wait(500);
  await w.click('.pos-table >> text=2'); await wait(400);
  await w.click('#posCats >> text=Супы'); await wait(150);
  await w.click('text=Борщ с говядиной'); await wait(250); await w.click('text=Борщ с говядиной'); await wait(250);
  await w.click('#posCats >> text=Напитки'); await wait(150); await w.click('text=Морс клюквенный'); await wait(250);
  await w.screenshot({ path: OUT + '/M2-waiter-order-390.png', fullPage: true });
  await w.click('#posOrderActions >> text=На кухню'); await wait(400);

  // Второй официант занимает стол 5 (чужой стол на схеме у первого).
  G.processOperation('POS_CREATE_ORDER', { tableId: G.findRows_('POS_TABLES', t => t.название === '5')[0].table_id }, tok.W2);

  // 3. Повар: очередь кухни, отмечает борщ готовым.
  const c = await page('C', 1280, 800);
  await c.evaluate(() => navTo('kitchen')); await wait(500);
  await c.screenshot({ path: OUT + '/M2-kitchen-1280.png' });
  await c.click('.kitchen-line >> text=Готово'); await wait(400);

  // 4. Официант: схема зала, затем пречек.
  await w.click('#posTabs >> text=Зал'); await wait(500);
  await w.screenshot({ path: OUT + '/M2-waiter-floor-390.png' });
  await w.click('.pos-table >> text=2'); await wait(400);
  await w.click('#posOrderActions >> text=Пречек'); await wait(400);
  const waiterHasPay = await w.isVisible('#posPayBtn');

  // 5. Менеджер: зал на компьютере, оплата стола 2.
  await m.click('#posTabs >> text=Зал'); await wait(500);
  await m.screenshot({ path: OUT + '/M2-floor-1440.png' });
  await m.click('.pos-table >> text=2'); await wait(400);
  await m.click('#posPayBlock >> text=Карта'); await m.click('#posPayBtn'); await wait(600);
  await m.screenshot({ path: OUT + '/M2-paid-precheck-1440.png' });
  const order = G.findRows_('POS_ORDERS', o => o.table_id && o.статус === 'оплачен')[0];

  await browser.close();
  const result = {
    'у официанта нет кнопки оплаты': !waiterHasPay,
    'заказ стола 2 оплачен': !!order && order.итого === 820,
    'ошибок в браузере нет': errors.length === 0
  };
  console.log(result, errors);
  process.exit(Object.values(result).every(Boolean) ? 0 : 1);
})();
