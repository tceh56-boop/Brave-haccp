// Логотип и анимация входа: кадры экрана загрузки, вход, шапка, меню. Запуск: node replica/tests/shots_logo.js
const path = require('path'), fs = require('fs');
fs.mkdirSync(path.join(__dirname, '.frames'), { recursive: true });
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const { ctx: G } = require('./harness.js');
const GAS = path.join(__dirname, '../../gas'), OUT = path.join(__dirname, '../clone-screens');
G.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', 'SS');
G.initializeDatabase();
G.insertRow_('ORGANIZATIONS', { organization_id: 'ORG-1', название: 'Кафе', статус: 'активна' });
G.insertRow_('LOCATIONS', { location_id: 'LOC-1', organization_id: 'ORG-1', название: 'Точка', статус: 'активна' });
G.insertRow_('USERS', { user_id: 'USR-D', organization_id: 'ORG-1', location_ids: 'LOC-1', имя: 'Денис', роль: 'ДИРЕКТОР', статус: 'активен', pin_hash: G.hashPin_('482915', 's'), pin_salt: 's', failed_attempts: 0, lockout_count: 0 });

async function open(browser, w, h, token) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.exposeFunction('__gasApi', (a, d, t) => JSON.parse(JSON.stringify(G.processOperation(a, d, t))));
  await p.addInitScript(t => {
    if (t) localStorage.setItem('tsekh_token', t);
    function r() { let ok = () => {}, fail = () => {}; const x = new Proxy({}, { get(_, k) {
      if (k === 'withSuccessHandler') return f => { ok = f; return x; };
      if (k === 'withFailureHandler') return f => { fail = f; return x; };
      if (k === 'withUserObject') return () => x;
      if (k === 'api') return (a, d, tk) => { window.__gasApi(a, d, tk).then(ok, fail); };
      return () => {}; } }); return x; }
    window.google = { script: { get run() { return r(); } } };
  }, token || '');
  p._errors = errors;
  return p;
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  // Кадры анимации входа (390 px).
  const p = await open(browser, 390, 520);
  await p.goto('file://' + GAS + '/Index.html');
  const bootVisibleEarly = await p.evaluate(() => !document.getElementById('bootScreen').classList.contains('hidden'));
  const bootColor = await p.$eval('#bootScreen .cehLogo', e => getComputedStyle(e).color);
  const frames = [];
  for (let i = 0; i < 18; i++) { const f = path.join(__dirname, '.frames/f' + String(i).padStart(2, '0') + '.png'); await p.screenshot({ path: f }); frames.push(f); await p.waitForTimeout(70); }
  await p.waitForTimeout(900);
  const bootGone = await p.evaluate(() => document.getElementById('bootScreen').classList.contains('hidden'));
  const noPlate = await p.evaluate(() => !document.querySelector('.cehPlate') && !document.querySelector('.cehWordmark'));
  const loginColor = await p.$eval('#loginScreen .cehLogo', e => getComputedStyle(e).color);
  await p.screenshot({ path: OUT + '/LOGO-login-390.png' });
  // Шапка и меню после входа.
  let t = G.processOperation('LOGIN', { userId: 'USR-D', pin: '482915' }).data;
  const tok = t.requires_location ? G.processOperation('SELECT_LOCATION', { locationId: 'LOC-1' }, t.token).data.token : t.token;
  const a = await open(browser, 390, 300, tok);
  await a.goto('file://' + GAS + '/Index.html'); await a.waitForTimeout(1600);
  const header = await a.$eval('header .logo .cehLogo', e => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), color: getComputedStyle(e).color }; });
  await a.screenshot({ path: OUT + '/LOGO-header-390.png' });
  await a.evaluate(() => toggleMenu()); await a.waitForTimeout(400);
  await a.screenshot({ path: OUT + '/LOGO-menu-390.png' });
  // Уменьшение движения: экран загрузки исчезает сразу, без анимации.
  const ctxR = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 520 } });
  const r = await ctxR.newPage();
  await r.addInitScript(() => { window.google = { script: { get run() { const x = new Proxy({}, { get(_, k) { return k === 'api' ? () => {} : () => x; } }); return x; } } }; });
  await r.goto('file://' + GAS + '/Index.html'); await r.waitForTimeout(150);
  const reducedGone = await r.evaluate(() => { const b = document.getElementById('bootScreen'); return getComputedStyle(b.querySelector('.cehTs')).animationName; });
  await browser.close();
  console.log(JSON.stringify({ frames: frames.length }));
  const res = {
    'загрузка видна в начале': bootVisibleEarly,
    'на загрузке логотип жёлтый': bootColor === 'rgb(245, 166, 35)',
    'загрузка исчезла после анимации': bootGone,
    'нет белой подложки и старого знака': noPlate,
    'на входе логотип коричневый (цвет экрана)': loginColor === 'rgb(59, 42, 32)' || /rgb\(/.test(loginColor),
    'в шапке логотип 56×22, жёлтый': header.w === 56 && header.h === 22 && header.color !== 'rgb(0, 0, 0)',
    'при «уменьшении движения» анимации нет': reducedGone === 'none',
    'ошибок в браузере нет': p._errors.length === 0 && a._errors.length === 0
  };
  console.log(res, header, loginColor);
  process.exit(Object.values(res).every(Boolean) ? 0 : 1);
})();
