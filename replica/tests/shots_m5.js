// Этап M5 в браузере: смешанная оплата, возврат, отчёт по сотрудникам, закрытие смены.
// Запуск: node replica/tests/shots_m5.js
const path = require('path');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const { ctx: G } = require('./harness.js');
const GAS = path.join(__dirname, '../../gas'), OUT = path.join(__dirname, '../clone-screens');
G.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', 'SS');
G.initializeDatabase();
G.insertRow_('ORGANIZATIONS', { organization_id: 'ORG-1', название: 'Кафе', статус: 'активна' });
G.insertRow_('LOCATIONS', { location_id: 'LOC-1', organization_id: 'ORG-1', название: 'Точка', статус: 'активна' });
function mk(id, name, role) { G.insertRow_('USERS', { user_id: id, organization_id: 'ORG-1', location_ids: 'LOC-1', имя: name, роль: role, статус: 'активен', pin_hash: G.hashPin_('482915', 's' + id), pin_salt: 's' + id, failed_attempts: 0, lockout_count: 0 }); }
mk('USR-M', 'Ольга', 'МЕНЕДЖЕР'); mk('USR-W', 'Игорь', 'ОФИЦИАНТ'); mk('USR-W2', 'Мария', 'ОФИЦИАНТ');
G.insertRow_('CATEGORIES', { category_id: 'CAT-1', название: 'Кухня', тип: 'блюдо' });
[['DISH-1', 'Борщ', 350], ['DISH-2', 'Морс', 120], ['DISH-3', 'Котлета', 480]].forEach(d => G.insertRow_('DISHES', { dish_id: d[0], organization_id: 'ORG-1', название: d[1], категория_id: 'CAT-1', цена_продажи: d[2], статус: 'активно' }));
function token(u) { let t = G.processOperation('LOGIN', { userId: u, pin: '482915' }).data.token; const s = G.processOperation('SELECT_LOCATION', { locationId: 'LOC-1' }, t); return (s.ok && s.data.token) || t; }
const tok = { M: token('USR-M'), W: token('USR-W'), W2: token('USR-W2') };
function api(a, d, t) { const r = G.processOperation(a, d || {}, t); if (!r.ok) throw new Error(a + ': ' + r.error); return r.data; }
const hall = api('POS_SAVE_HALL', { название: 'Зал' }, tok.M);
const t1 = api('POS_SAVE_TABLE', { hallId: hall.hall_id, название: '1' }, tok.M);
const t2 = api('POS_SAVE_TABLE', { hallId: hall.hall_id, название: '2' }, tok.M);
api('POS_OPEN_SHIFT', { cashStart: 2000 }, tok.M);
function waiterOrder(token, tableId, lines) {
  let v = api('POS_CREATE_ORDER', { tableId, guests: 2 }, token);
  lines.forEach(([d, q]) => { v = api('POS_ADD_LINE', { orderId: v.order.order_id, dishId: d, qty: q, version: v.order.version }, token); });
  return api('POS_PRECHECK', { orderId: v.order.order_id, version: v.order.version }, token).order;
}
waiterOrder(tok.W, t1.table_id, [['DISH-1', 2], ['DISH-2', 2]]);       // 940
const o2 = waiterOrder(tok.W2, t2.table_id, [['DISH-3', 1], ['DISH-2', 1]]); // 600
api('POS_PAY', { orderId: o2.order_id, version: o2.version, operationId: 'X', payments: [{ способ: 'карта', сумма: 600 }] }, tok.M);

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
  }, tok.M);
  await p.goto('file://' + GAS + '/Index.html'); await p.waitForTimeout(700);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await p.evaluate(() => navTo('pos')); await wait(500);

  // Стол 1 → смешанная оплата 300 нал + 640 карта.
  await p.click('#posTabs >> text=Зал'); await wait(400);
  await p.click('.pos-table >> text=1'); await wait(400);
  await p.click('#posPayBlock >> text=Нал + карта'); await wait(150);
  await p.fill('#posMixCash', '300'); await p.dispatchEvent('#posMixCash', 'input'); await wait(100);
  const mixCard = await p.inputValue('#posMixCard');
  await p.screenshot({ path: OUT + '/M5-mixed-payment-1280.png' });
  await p.click('#posPayBtn'); await wait(600);

  // Частичный возврат: только морс, наличными.
  await p.click('#posOrderActions >> text=Возврат'); await wait(300);
  await p.uncheck('#posRefundLines label:has-text("Борщ") input');
  await p.click('#posRefundBlock >> text=Наличными'); await p.fill('#posRefundReason', 'Морс оказался тёплым');
  await p.screenshot({ path: OUT + '/M5-refund-1280.png' });
  await p.click('#posRefundBtn'); await wait(600);
  await p.screenshot({ path: OUT + '/M5-refund-done-1280.png' });

  // Отчёт по сотрудникам.
  await p.click('#posTabs >> text=Отчёт'); await wait(700);
  await p.screenshot({ path: OUT + '/M5-staff-report-1280.png', fullPage: true });

  // Закрытие смены.
  await p.click('text=Закрыть смену'); await wait(400);
  await p.screenshot({ path: OUT + '/M5-close-shift-1280.png' });
  const expected = await p.inputValue('#posCashFact');
  p.on('dialog', d => d.accept());
  await p.click('#posCloseCard >> text=Закрыть смену'); await wait(600);
  await browser.close();

  const pays = G.findRows_('POS_PAYMENTS', () => true);
  const cash = G.findRows_('CASH_TRANSACTIONS', () => true);
  const result = {
    'смешанная: карта дополнилась до 640': mixCard === '640',
    'оплата 300 нал + 640 карта записана': pays.some(x => x.способ === 'нал' && x.сумма === 300) && pays.some(x => x.способ === 'карта' && x.сумма === 640),
    'возврат морса −240 наличными': pays.some(x => x.тип === 'возврат' && x.сумма === -240 && x.способ === 'нал'),
    'наличных к закрытию 2060 (2000 + 300 − 240)': expected === '2060',
    'итоги ушли в «Экономику» (нал 60, карта 1240)': cash.length === 2 && cash.some(c => c.amount === 60) && cash.some(c => c.amount === 1240),
    'ошибок в браузере нет': errors.length === 0
  };
  console.log(result, errors);
  process.exit(Object.values(result).every(Boolean) ? 0 : 1);
})();
