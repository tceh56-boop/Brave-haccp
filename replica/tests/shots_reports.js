// Дашборд руководителя на главной (Stage 20, перенесено). Запуск: node replica/tests/shots_reports.js
const path = require('path');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const { ctx: G } = require('./harness.js');
const GAS = path.join(__dirname, '../../gas'), OUT = path.join(__dirname, '../clone-screens');
G.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', 'SS');
G.initializeDatabase();
G.insertRow_('ORGANIZATIONS', { organization_id: 'ORG-1', название: 'Кафе', статус: 'активна' });
G.insertRow_('LOCATIONS', { location_id: 'LOC-1', organization_id: 'ORG-1', название: 'Точка', статус: 'активна' });
['USR-D:ДИРЕКТОР', 'USR-K:КАССИР'].forEach(x => { const [id, role] = x.split(':'); G.insertRow_('USERS', { user_id: id, organization_id: 'ORG-1', location_ids: 'LOC-1', имя: role === 'ДИРЕКТОР' ? 'Денис' : 'Анна', роль: role, статус: 'активен', pin_hash: G.hashPin_('482915', 's' + id), pin_salt: 's' + id, failed_attempts: 0, lockout_count: 0 }); });
G.insertRow_('DISHES', { dish_id: 'DISH-1', organization_id: 'ORG-1', название: 'Борщ', цена_продажи: 350, себестоимость: 100, статус: 'активно' });
const tok = u => { let t = G.processOperation('LOGIN', { userId: u, pin: '482915' }).data.token; const s = G.processOperation('SELECT_LOCATION', { locationId: 'LOC-1' }, t); return (s.ok && s.data.token) || t; };
const tD = tok('USR-D'), tK = tok('USR-K');
const api = (a, d, t) => { const r = G.processOperation(a, d || {}, t); if (!r.ok) throw new Error(a + ': ' + r.error); return r.data; };
api('POS_OPEN_SHIFT', { cashStart: 0 }, tK);
for (let i = 0; i < 4; i++) { let v = api('POS_CREATE_ORDER', {}, tK); v = api('POS_ADD_LINE', { orderId: v.order.order_id, dishId: 'DISH-1', qty: i + 1, version: v.order.version }, tK); api('POS_PAY', { orderId: v.order.order_id, version: v.order.version, operationId: 'R' + i, payments: [{ способ: 'карта', сумма: 350 * (i + 1) }] }, tK); }
api('POS_SET_STOP', { dishId: 'DISH-1', reason: 'Закончилась свёкла' }, tD);
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const errors = [];
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  p.on('pageerror', e => errors.push(e.message));
  await p.exposeFunction('__gasApi', (a, d, t) => JSON.parse(JSON.stringify(G.processOperation(a, d, t))));
  await p.addInitScript(t => { localStorage.setItem('tsekh_token', t);
    function r() { let ok = () => {}, fail = () => {}; const x = new Proxy({}, { get(_, k) {
      if (k === 'withSuccessHandler') return f => { ok = f; return x; }; if (k === 'withFailureHandler') return f => { fail = f; return x; };
      if (k === 'withUserObject') return () => x; if (k === 'api') return (a, d, tk) => { window.__gasApi(a, d, tk).then(ok, fail); }; return () => {}; } }); return x; }
    window.google = { script: { get run() { return r(); } } }; }, tD);
  await p.goto('file://' + GAS + '/Index.html'); await p.waitForTimeout(900);
  await p.click('#executiveDashboardCard summary'); await p.waitForTimeout(500);
  await p.locator('#executiveDashboardCard').screenshot({ path: OUT + '/R20-executive-dashboard-1280.png' });
  const revenue = await p.textContent('#exRevenue'), avg = await p.textContent('#exAvgCheck'), alerts = await p.textContent('#executiveAlerts'), cat = await p.textContent('#managementReportsList');
  await browser.close();
  const result = { 'выручка 3 500 ₽': /3\s?500/.test(revenue), 'средний чек 875 ₽': /875/.test(avg), 'сигнал о стоп-листе': /стоп-листе: 1/.test(alerts), 'каталог с кассой': /Касса: выручка по сотрудникам/.test(cat), 'ошибок в браузере нет': errors.length === 0 };
  console.log(result, errors); process.exit(Object.values(result).every(Boolean) ? 0 : 1);
})();
