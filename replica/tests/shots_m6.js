// Этап M6 в браузере: гость в заказе, списание бонусов, вкладка «Гости». Скриншоты M6-*.png.
// Запуск: node replica/tests/shots_m6.js
const path = require('path');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const { ctx: G } = require('./harness.js');
const GAS = path.join(__dirname, '../../gas'), OUT = path.join(__dirname, '../clone-screens');
G.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', 'SS');
G.initializeDatabase();
G.insertRow_('ORGANIZATIONS', { organization_id: 'ORG-1', название: 'Кафе', статус: 'активна' });
G.insertRow_('LOCATIONS', { location_id: 'LOC-1', organization_id: 'ORG-1', название: 'Точка', статус: 'активна' });
function mk(id, name, role) { G.insertRow_('USERS', { user_id: id, organization_id: 'ORG-1', location_ids: 'LOC-1', имя: name, роль: role, статус: 'активен', pin_hash: G.hashPin_('482915', 's' + id), pin_salt: 's' + id, failed_attempts: 0, lockout_count: 0 }); }
mk('USR-K', 'Анна', 'КАССИР'); mk('USR-M', 'Ольга', 'МЕНЕДЖЕР');
G.insertRow_('CATEGORIES', { category_id: 'CAT-1', название: 'Кухня', тип: 'блюдо' });
[['DISH-1', 'Борщ', 350], ['DISH-2', 'Морс', 150], ['DISH-3', 'Котлета', 480]].forEach(d => G.insertRow_('DISHES', { dish_id: d[0], organization_id: 'ORG-1', название: d[1], категория_id: 'CAT-1', цена_продажи: d[2], статус: 'активно' }));
function token(u) { let t = G.processOperation('LOGIN', { userId: u, pin: '482915' }).data.token; const s = G.processOperation('SELECT_LOCATION', { locationId: 'LOC-1' }, t); return (s.ok && s.data.token) || t; }
const tok = { K: token('USR-K'), M: token('USR-M') };
G.processOperation('POS_OPEN_SHIFT', { cashStart: 0 }, tok.K);

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const errors = [];
  async function page(who, w, h) {
    const p = await browser.newPage({ viewport: { width: w, height: h } });
    p.on('pageerror', e => errors.push(who + ': ' + e.message));
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
    }, tok[who]);
    await p.goto('file://' + GAS + '/Index.html'); await p.waitForTimeout(700);
    return p;
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const k = await page('K', 1280, 900);
  await k.evaluate(() => navTo('pos')); await wait(600);

  // Заказ 1: борщ ×3 + котлета ×2 = 2010 ₽; новый гость.
  for (const d of ['Борщ', 'Борщ', 'Борщ', 'Котлета', 'Котлета']) { await k.click('.pos-dish:has-text("' + d + '")'); await wait(200); }
  await k.click('#posOrderActions >> text=Гость'); await wait(200);
  await k.fill('#posGuestPhone', '8 912 345-67-89'); await k.click('#posGuestBlock >> text=Найти'); await wait(300);
  await k.fill('#posGuestName', 'Иван');
  await k.screenshot({ path: OUT + '/M6-new-guest-1280.png' });
  await k.click('#posGuestBlock >> text=Завести гостя'); await wait(300);
  const noConsentErr = await k.textContent('#posErr');
  await k.check('#posGuestConsent'); await k.click('#posGuestBlock >> text=Завести гостя'); await wait(500);
  await k.click('#posPayBlock >> text=Карта'); await k.click('#posPayBtn'); await wait(600);
  const msg1 = await k.textContent('#posPayResult');

  // Заказ 2: морс ×4 + котлета = 1080; гость по 4 цифрам; списать максимум.
  await k.click('text=Следующий заказ'); await wait(200);
  for (const d of ['Морс', 'Морс', 'Морс', 'Морс', 'Котлета']) { await k.click('.pos-dish:has-text("' + d + '")'); await wait(200); }
  await k.click('#posOrderActions >> text=Гость'); await wait(200);
  await k.fill('#posGuestPhone', '6789'); await k.click('#posGuestBlock >> text=Найти'); await wait(300);
  await k.click('#posGuestResults >> text=Выбрать'); await wait(500);
  await k.click('#posBonusBlock >> text=Максимум'); await wait(200);
  const toPay = await k.textContent('#posTotal');
  await k.screenshot({ path: OUT + '/M6-pay-with-bonus-1280.png' });
  await k.click('#posPayBtn'); await wait(600);
  const msg2 = await k.textContent('#posPayResult');

  // Менеджер: вкладка «Гости».
  const m = await page('M', 1280, 900);
  await m.evaluate(() => navTo('pos')); await wait(500);
  await m.click('#posTabs >> text=Гости'); await wait(500);
  await m.click('#guestsList >> text=Открыть'); await wait(400);
  await m.screenshot({ path: OUT + '/M6-guests-admin-1280.png', fullPage: true });
  await browser.close();

  const guest = G.findRows_('GUESTS', () => true)[0];
  const result = {
    'без согласия гость не заводится': /согласие/.test(noConsentErr),
    'гость заведён, телефон нормализован': guest && guest.телефон === '+79123456789',
    'заказ 1: начислено 100 бонусов (5% от 2010)': /начислено 100/.test(msg1),
    'заказ 2: можно списать 100 → к оплате 980 ₽': /980/.test(toPay),
    'заказ 2: списано 100, начислено 49': /списано 100, начислено 49/.test(msg2),
    'баланс гостя 49': guest && guest.бонусы === 49,
    'ошибок в браузере нет': errors.length === 0
  };
  console.log(result, errors);
  process.exit(Object.values(result).every(Boolean) ? 0 : 1);
})();
