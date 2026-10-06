// Этап M7 в браузере: ссылка на чаевые, QR в заказе и на пречеке. Скриншоты M7-*.png.
// Картинку QR (quickchart.io) тест подменяет заглушкой и проверяет, какая ссылка в неё зашита.
// Запуск: node replica/tests/shots_m7.js
const path = require('path');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const { ctx: G } = require('./harness.js');
const GAS = path.join(__dirname, '../../gas'), OUT = path.join(__dirname, '../clone-screens');
G.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', 'SS');
G.initializeDatabase();
G.insertRow_('ORGANIZATIONS', { organization_id: 'ORG-1', название: 'Кафе', статус: 'активна' });
G.insertRow_('LOCATIONS', { location_id: 'LOC-1', organization_id: 'ORG-1', название: 'Точка', статус: 'активна' });
function mk(id, name, role) { G.insertRow_('USERS', { user_id: id, organization_id: 'ORG-1', location_ids: 'LOC-1', имя: name, роль: role, статус: 'активен', pin_hash: G.hashPin_('482915', 's' + id), pin_salt: 's' + id, failed_attempts: 0, lockout_count: 0 }); }
mk('USR-W', 'Игорь', 'ОФИЦИАНТ'); mk('USR-K', 'Анна', 'КАССИР'); mk('USR-M', 'Ольга', 'МЕНЕДЖЕР');
G.insertRow_('CATEGORIES', { category_id: 'CAT-1', название: 'Кухня', тип: 'блюдо' });
[['DISH-1', 'Борщ', 350], ['DISH-2', 'Морс', 150]].forEach(d => G.insertRow_('DISHES', { dish_id: d[0], organization_id: 'ORG-1', название: d[1], категория_id: 'CAT-1', цена_продажи: d[2], статус: 'активно' }));
function token(u) { let t = G.processOperation('LOGIN', { userId: u, pin: '482915' }).data.token; const s = G.processOperation('SELECT_LOCATION', { locationId: 'LOC-1' }, t); return (s.ok && s.data.token) || t; }
const tok = { W: token('USR-W'), K: token('USR-K'), M: token('USR-M') };
const hall = G.processOperation('POS_SAVE_HALL', { название: 'Зал' }, tok.M).data;
G.processOperation('POS_SAVE_TABLE', { hallId: hall.hall_id, название: '3' }, tok.M);
G.processOperation('POS_OPEN_SHIFT', { cashStart: 0 }, tok.K);
const TIP = 'https://pay.cloudtips.ru/p/igor-123';
const PLACEHOLDER = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#fff"/>' +
  [0, 1, 2].map(i => { const x = [10, 130, 10][i], y = [10, 10, 130][i]; return '<rect x="' + x + '" y="' + y + '" width="60" height="60" fill="#000"/><rect x="' + (x + 10) + '" y="' + (y + 10) + '" width="40" height="40" fill="#fff"/><rect x="' + (x + 20) + '" y="' + (y + 20) + '" width="20" height="20" fill="#000"/>'; }).join('') +
  '<text x="100" y="110" font-size="14" text-anchor="middle" font-family="Arial">QR</text></svg>';

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const errors = [], qrRequests = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('**/quickchart.io/**', r => { qrRequests.push(decodeURIComponent(new URL(r.request().url()).searchParams.get('text') || '')); r.fulfill({ status: 200, contentType: 'image/svg+xml', body: PLACEHOLDER }); });
  const p = await ctx.newPage();
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
  }, tok.W);
  await p.goto('file://' + GAS + '/Index.html'); await p.waitForTimeout(700);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await p.evaluate(() => navTo('pos')); await wait(500);

  // Официант задаёт свою ссылку.
  await p.click('#posTabs >> text=Чаевые'); await wait(400);
  const rowsVisible = await p.$$eval('#tipList .tip-row', r => r.length);
  await p.fill('#tip-USR-W', 'http://bad'); await p.click('#tipList >> text=Сохранить'); await wait(300);
  const badErr = await p.textContent('#tipErr');
  await p.fill('#tip-USR-W', TIP); await p.click('#tipList >> text=Сохранить'); await wait(300);
  await p.screenshot({ path: OUT + '/M7-tip-settings-390.png' });

  // Стол 3: заказ, пречек, QR в заказе.
  await p.click('#posTabs >> text=Зал'); await wait(400);
  await p.click('.pos-table >> text=3'); await wait(400);
  await p.click('.pos-dish:has-text("Борщ")'); await wait(250); await p.click('.pos-dish:has-text("Морс")'); await wait(250);
  await p.click('#posOrderActions button:text-is("Пречек")'); await wait(500);
  const tipShown = await p.isVisible('.pos-tip img');
  await p.locator('#posTipBlock').scrollIntoViewIfNeeded();
  await p.screenshot({ path: OUT + '/M7-precheck-qr-390.png' });

  // Печать пречека — отдельное окно.
  const [popup] = await Promise.all([ctx.waitForEvent('page'), p.click('#posOrderActions button:text-is("Печать пречека")')]);
  await popup.waitForTimeout(300);
  const precheckHtml = await popup.content();
  const precheckText = await popup.textContent('body');
  await popup.close();
  // Снимок отрисовываем на обычной странице: у окна, созданного document.write, скриншот ждёт шрифты бесконечно.
  const view = await ctx.newPage();
  await view.setViewportSize({ width: 320, height: 640 });
  await view.setContent(precheckHtml.replace(/<script>[\s\S]*?<\/script>/g, ''));
  await view.waitForTimeout(300);
  await view.screenshot({ path: OUT + '/M7-precheck-print.png', fullPage: true });
  await browser.close();

  const result = {
    'официант видит только себя': rowsVisible === 1,
    'http-ссылка отклонена': /https:\/\//.test(badErr),
    'QR показан на пречеке': tipShown,
    'в QR зашита ссылка официанта': qrRequests.length > 0 && qrRequests.every(t => t === TIP),
    'на пречеке позиции, итог и «не кассовый чек»': /Борщ/.test(precheckText) && /500/.test(precheckText) && /не кассовый чек/.test(precheckText) && /Оставить чаевые: Игорь/.test(precheckText),
    'ошибок в браузере нет': errors.length === 0
  };
  console.log(result, errors);
  process.exit(Object.values(result).every(Boolean) ? 0 : 1);
})();
