// Этап M4 в браузере: стоп-лист у повара, стоп в меню кассы. Скриншоты M4-*.png.
// Запуск: node replica/tests/shots_m4.js
const path = require('path');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const { ctx: G } = require('./harness.js');
const GAS = path.join(__dirname, '../../gas'), OUT = path.join(__dirname, '../clone-screens');
G.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', 'SS');
G.initializeDatabase();
G.insertRow_('ORGANIZATIONS', { organization_id: 'ORG-1', название: 'Кафе', статус: 'активна' });
G.insertRow_('LOCATIONS', { location_id: 'LOC-1', organization_id: 'ORG-1', название: 'Точка', статус: 'активна' });
function mk(id, name, role) { G.insertRow_('USERS', { user_id: id, organization_id: 'ORG-1', location_ids: 'LOC-1', имя: name, роль: role, статус: 'активен', pin_hash: G.hashPin_('482915', 's' + id), pin_salt: 's' + id, failed_attempts: 0, lockout_count: 0 }); }
mk('USR-D', 'Денис', 'ДИРЕКТОР'); mk('USR-T', 'Технолог', 'ТЕХНОЛОГ_HACCP'); mk('USR-K', 'Анна', 'КАССИР'); mk('USR-P', 'Сергей', 'ПОВАР');
function token(u) { let t = G.processOperation('LOGIN', { userId: u, pin: '482915' }).data.token; const s = G.processOperation('SELECT_LOCATION', { locationId: 'LOC-1' }, t); return (s.ok && s.data.token) || t; }
const tok = { D: token('USR-D'), T: token('USR-T'), K: token('USR-K'), P: token('USR-P') };
function api(a, d, t) { const r = G.processOperation(a, d || {}, t); if (!r.ok) throw new Error(a + ': ' + r.error); return r.data; }

G.insertRow_('CATEGORIES', { category_id: 'CAT-1', название: 'Кухня', тип: 'блюдо' });
function dishWithTtk(name, price, productName, gross, stock) {
  const pr = api('CREATE_PRODUCT', { название: productName, единица: 'кг', цена: 100 }, tok.D);
  const pid = pr.product_id || (pr.product && pr.product.product_id);
  api('RECEIVE_GOODS', { productId: pid, qty: stock, price: 100, expiryDate: '2099-01-01', productionDate: '2026-10-01' }, tok.D);
  const d = api('CREATE_DISH', { название: name, выход: 300, цена_продажи: price, категория_id: 'CAT-1' }, tok.D);
  api('ADD_RECIPE_LINE', { parentType: 'DISH', parentId: d.dish_id, ingredientId: pid, брутто: gross, нетто: gross, единица: 'кг' }, tok.D);
  const v = api('CREATE_TTK_VERSION', { dishId: d.dish_id, технология: 'Приготовить по технологии заведения', условия_хранения: '+2..+6 °C', срок_реализации: '24 ч' }, tok.D);
  api('SUBMIT_TTK_FOR_APPROVAL', { ttkVersionId: v.ttk_version_id }, tok.D);
  api('APPROVE_TTK_VERSION', { ttkVersionId: v.ttk_version_id }, tok.T);
  return d;
}
const borsch = dishWithTtk('Борщ', 350, 'Свёкла', 0.2, 0.5);
dishWithTtk('Пельмени', 420, 'Фарш', 0.15, 0.5);
dishWithTtk('Сырники', 290, 'Творог', 0.12, 5);
api('CREATE_DISH', { название: 'Чай', выход: 200, цена_продажи: 100, категория_id: 'CAT-1' }, tok.D);

// Смена, продажа двух борщей, фоновое списание + пересчёт стоп-листа.
api('POS_OPEN_SHIFT', { cashStart: 0 }, tok.K);
let o = api('POS_CREATE_ORDER', {}, tok.K).order;
o = api('POS_ADD_LINE', { orderId: o.order_id, dishId: borsch.dish_id, qty: 2, version: o.version }, tok.K).order;
api('POS_PAY', { orderId: o.order_id, version: o.version, operationId: 'P1', payments: [{ способ: 'карта', сумма: 700 }] }, tok.K);
G.posFulfillPendingSalesTrigger_();

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

  // Повар: стоп-лист, ручной стоп чая, пересчёт.
  const c = await page('P', 1280, 900);
  const cookMenu = await c.$$eval('#sideMenu button.menuItem:not(.hidden)', bs => bs.map(b => b.textContent.trim()));
  await c.evaluate(() => navTo('stoplist')); await wait(500);
  await c.selectOption('#stopDish', { label: 'Чай' }); await c.fill('#stopReason', 'Сломался кипятильник');
  await c.click('#view-stoplist button:has-text("Поставить в стоп")'); await wait(400);
  await c.click('text=Пересчитать по остаткам'); await wait(500);
  await c.screenshot({ path: OUT + '/M4-stoplist-1280.png', fullPage: true });
  const stopRows = await c.$$eval('#stopList .stop-row', r => r.length);

  // Кассир: меню с борщом и чаем на стопе.
  const k = await page('K', 1024, 768);
  await k.evaluate(() => navTo('pos')); await wait(600);
  await k.screenshot({ path: OUT + '/M4-cashier-menu-1024.png' });
  const borschDisabled = await k.isDisabled('.pos-dish:has-text("Борщ")');
  const teaDisabled = await k.isDisabled('.pos-dish:has-text("Чай")');
  const syrDisabled = await k.isDisabled('.pos-dish:has-text("Сырники")');
  await browser.close();

  const result = {
    'у повара есть пункт «Стоп-лист»': cookMenu.includes('Стоп-лист'),
    'в стопе 2 блюда (борщ — авто, чай — вручную)': stopRows === 2,
    'на кассе борщ и чай недоступны': borschDisabled && teaDisabled,
    'сырники в продаже': !syrDisabled,
    'ошибок в браузере нет': errors.length === 0
  };
  console.log(result, errors);
  process.exit(Object.values(result).every(Boolean) ? 0 : 1);
})();
