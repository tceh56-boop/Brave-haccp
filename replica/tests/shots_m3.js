// Этап M3 в браузере: настройка модификаторов, выбор при заказе, кухня. Скриншоты M3-*.png.
// Запуск: node replica/tests/shots_m3.js
const path = require('path');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const { ctx: G } = require('./harness.js');
const GAS = path.join(__dirname, '../../gas'), OUT = path.join(__dirname, '../clone-screens');
G.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', 'SS');
G.initializeDatabase();
G.insertRow_('ORGANIZATIONS', { organization_id: 'ORG-1', название: 'Кафе', статус: 'активна' });
G.insertRow_('LOCATIONS', { location_id: 'LOC-1', organization_id: 'ORG-1', название: 'Точка', статус: 'активна' });
function mk(id, name, role) { G.insertRow_('USERS', { user_id: id, organization_id: 'ORG-1', location_ids: 'LOC-1', имя: name, роль: role, статус: 'активен', pin_hash: G.hashPin_('482915', 's' + id), pin_salt: 's' + id, failed_attempts: 0, lockout_count: 0 }); }
mk('USR-M', 'Ольга', 'МЕНЕДЖЕР'); mk('USR-K', 'Анна', 'КАССИР'); mk('USR-C', 'Сергей', 'ШЕФ-ПОВАР');
G.insertRow_('CATEGORIES', { category_id: 'CAT-1', название: 'Пицца', тип: 'блюдо' });
G.insertRow_('DISHES', { dish_id: 'DISH-P', organization_id: 'ORG-1', название: 'Маргарита', категория_id: 'CAT-1', цена_продажи: 520, статус: 'активно' });
G.insertRow_('DISHES', { dish_id: 'DISH-Q', organization_id: 'ORG-1', название: 'Четыре сыра', категория_id: 'CAT-1', цена_продажи: 640, статус: 'активно' });
G.insertRow_('PRODUCTS', { product_id: 'PROD-CH', organization_id: 'ORG-1', название: 'Моцарелла', единица: 'кг', активность: 'да' });
function token(u) { let t = G.processOperation('LOGIN', { userId: u, pin: '482915' }).data.token; const s = G.processOperation('SELECT_LOCATION', { locationId: 'LOC-1' }, t); return (s.ok && s.data.token) || t; }
const tok = { M: token('USR-M'), K: token('USR-K'), C: token('USR-C') };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const errors = [];
  async function page(who, w, h) {
    const p = await browser.newPage({ viewport: { width: w, height: h } });
    p.on('pageerror', e => errors.push(who + ': ' + e.message));
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

  // Менеджер: смена, группы, варианты, привязка к «Маргарите».
  const m = await page('M', 1440, 900);
  await m.evaluate(() => navTo('pos')); await wait(400);
  await m.fill('#posCashStart', '0'); await m.click('text=Открыть смену'); await wait(500);
  await m.click('#posTabs >> text=Модификаторы'); await wait(400);
  async function group(name, min, max) { await m.fill('#posMgName', name); await m.fill('#posMgMin', String(min)); await m.fill('#posMgMax', String(max)); await m.click('text=Добавить группу'); await wait(250); }
  await group('Размер', 1, 1); await group('Добавки', 0, 2); await group('Пожелания', 0, 0);
  async function mod(groupName, name, delta, product, qty) {
    await m.selectOption('#posModGroup', { label: groupName });
    await m.fill('#posModName', name); await m.fill('#posModDelta', String(delta));
    if (product) { await m.selectOption('#posModProduct', { label: product }); await m.fill('#posModQty', String(qty)); } else await m.selectOption('#posModProduct', '');
    await m.click('text=Добавить модификатор'); await wait(250);
  }
  await mod('Размер', '25 см', -100); await mod('Размер', '30 см', 0); await mod('Размер', '35 см', 150);
  await mod('Добавки', 'Двойной сыр', 90, 'Моцарелла, кг', 0.05); await mod('Добавки', 'Халапеньо', 60); await mod('Добавки', 'Оливки', 60);
  await mod('Пожелания', 'Без лука', 0); await mod('Пожелания', 'Острее', 0);
  await m.selectOption('#posModDish', { label: 'Маргарита' }); await wait(150);
  for (const g of ['Размер', 'Добавки', 'Пожелания']) await m.check('#posModDishGroups label:has-text("' + g + '") input');
  await m.click('text=Сохранить для блюда'); await wait(400);
  await m.screenshot({ path: OUT + '/M3-modifiers-settings-1440.png', fullPage: true });

  // Кассир на планшете: «Маргарита» → окно выбора.
  const k = await page('K', 1024, 768);
  await k.evaluate(() => navTo('pos')); await wait(600);
  await k.click('text=Маргарита'); await wait(300);
  const addDisabledBefore = await k.isDisabled('#posModAdd');
  await k.click('.pos-mod-opt:has-text("35 см")'); await k.click('.pos-mod-opt:has-text("Двойной сыр")'); await k.click('.pos-mod-opt:has-text("Халапеньо")');
  const olivesDisabled = await k.isDisabled('.pos-mod-opt:has-text("Оливки") input');
  await k.click('.pos-mod-opt:has-text("Без лука")'); await wait(150);
  const total = await k.textContent('#posModTotal');
  await k.screenshot({ path: OUT + '/M3-modifier-sheet-1024.png' });
  await k.click('#posModAdd'); await wait(500);
  await k.click('text=Четыре сыра'); await wait(400);
  await k.screenshot({ path: OUT + '/M3-ticket-1024.png' });
  const lines = G.findRows_('POS_ORDER_LINES', () => true);

  // На кухню через стол не идёт (заказ с собой) — отправим через API и посмотрим экран шефа.
  const order = G.findRows_('POS_ORDERS', () => true)[0];
  G.processOperation('POS_SEND_TO_KITCHEN', { orderId: order.order_id, version: G.findOne_('POS_ORDERS', 'order_id', order.order_id).version }, tok.K);
  const c = await page('C', 1280, 800);
  await c.evaluate(() => navTo('kitchen')); await wait(500);
  await c.screenshot({ path: OUT + '/M3-kitchen-1280.png' });
  await browser.close();

  const pizza = lines.find(l => l.dish_id === 'DISH-P');
  const result = {
    'без размера кнопка «Добавить» неактивна': addDisabledBefore,
    'после 2 добавок третья недоступна': olivesDisabled,
    'итог в окне 820 ₽ (520+150+90+60)': /820/.test(total),
    'строка пиццы с ценой 820 и 4 модификаторами': !!pizza && pizza.цена === 820 && JSON.parse(pizza.модификаторы_json).length === 4,
    'блюдо без модификаторов добавлено сразу': lines.some(l => l.dish_id === 'DISH-Q' && !l.модификаторы_json),
    'ошибок в браузере нет': errors.length === 0
  };
  console.log(result, errors);
  process.exit(Object.values(result).every(Boolean) ? 0 : 1);
})();
