// Облачная версия в браузере: настоящий HTTP-сервер + PostgreSQL, вход по PIN через экранную клавиатуру.
// Запуск: DATABASE_URL=postgres://... node cloud/test/e2e_browser.js
const path = require('path');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const { createRuntime } = require('../src/runtime');
const { createServer } = require('../src/server');

(async () => {
  const rt = createRuntime({ logger: () => {} });
  rt.store.wipeAll();
  const director = rt.ctx.setupProduction().director;
  const srv = createServer(rt, { cronSecret: 'x' });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const OUT = path.join(__dirname, '../../replica/clone-screens');

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [], failed = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (r.url().endsWith('/api') && r.status() !== 200) failed.push(r.status()); });
  const apiCalls = [];
  page.on('request', r => { if (r.url().endsWith('/api')) apiCalls.push(JSON.parse(r.postData() || '{}').action); });

  await page.goto(base); await page.waitForTimeout(800);
  const tiles = await page.$$eval('#userPicker .userTile', t => t.map(x => x.textContent));
  await page.click('#userPicker .userTile'); await page.waitForTimeout(200);
  for (const d of String(director.pin)) await page.click(`#keypad button:text-is("${d}")`);
  await page.screenshot({ path: OUT + '/CLOUD-login-390.png' });
  await page.click('#keypad button:text-is("Войти")'); await page.waitForTimeout(1200);
  if (await page.isVisible('#locationScreen')) { await page.click('#locationList button'); await page.waitForTimeout(1000); }
  const inApp = await page.isVisible('#app');
  const userName = await page.textContent('header').catch(() => '');
  await page.evaluate(() => navTo('alco')); await page.waitForTimeout(700);
  const alco = await page.textContent('#alcoBanner');
  await page.evaluate(() => navTo('foodcost')); await page.waitForTimeout(700);
  const fc = await page.textContent('#fcTarget');
  await page.evaluate(() => navTo('pos')); await page.waitForTimeout(900);
  await page.screenshot({ path: OUT + '/CLOUD-pos-390.png', fullPage: false });
  // Документ поставщика: загрузка через /api, ссылка tsekhFileHref → новая вкладка с файлом (токен — в заголовке).
  const fileInfo = await page.evaluate(async () => {
    const r = await fetch('api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'UPLOAD_SUPPLIER_DOCUMENT',
      data: { docType: 'CERTIFICATE', base64Data: btoa('%PDF-1.4 test'), fileName: 'cert.pdf', mimeType: 'application/pdf' }, token: localStorage.getItem('tsekh_token') }) }).then(x => x.json());
    if (!r.ok) return { error: r.error };
    const a = document.createElement('a'); a.href = tsekhFileHref(r.data.file_id); a.textContent = 'cert'; a.id = 'testFileLink'; document.body.appendChild(a);
    return { href: a.getAttribute('href') };
  });
  const dialogs = []; page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
  const [popup] = await Promise.all([page.waitForEvent('popup', { timeout: 5000 }).catch(() => null), page.click('#testFileLink')]);
  if (popup) await popup.waitForTimeout(500);
  const popupUrl = popup ? popup.url() : '';
  // Перезагрузка: сессия из localStorage проверяется сервером (GET_SESSION) — снова в приложении.
  await page.reload(); await page.waitForTimeout(1200);
  const stillIn = await page.isVisible('#app');
  await browser.close();
  srv.close(); rt.close();

  const res = {
    'экран входа получил сотрудников по HTTP': tiles.length === 1 && /Директор/.test(tiles[0]),
    'вход по PIN с экранной клавиатуры': inApp && /Директор/.test(userName),
    'алкоголь: нет лицензии (данные с сервера)': /Нет действующей лицензии/.test(alco),
    'фуд-кост: цель 30 %': /30/.test(fc),
    'после перезагрузки сессия сохранилась': stillIn,
    'все ответы /api — 200': failed.length === 0,
    'запросы шли через /api': ['GET_USERS_FOR_LOGIN', 'LOGIN', 'ALCO_GET_OVERVIEW', 'FC_GET_OVERVIEW', 'GET_SESSION'].every(a => apiCalls.includes(a)),
    'ссылка на документ — files/<id>, открылась файлом без ошибок': /^files\/[0-9a-f-]{36}$/.test(fileInfo.href || '') && /^blob:/.test(popupUrl) && dialogs.length === 0,
    'ошибок в браузере нет': errors.length === 0
  };
  console.log(res, errors, fileInfo.error || '');
  process.exit(Object.values(res).every(Boolean) ? 0 : 1);
})();
