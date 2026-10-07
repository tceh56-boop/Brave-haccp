// M12 в браузере: кассир вскрывает бутылку сканером (390), менеджер — очередь и журнал (1280).
// Запуск: node replica/tests/shots_alco.js
const path = require('path');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const { ctx: G } = require('./harness.js');
const GAS = path.join(__dirname, '../../gas'), OUT = path.join(__dirname, '../clone-screens');
G.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', 'SS');
G.initializeDatabase();
G.insertRow_('ORGANIZATIONS', { organization_id: 'ORG-1', название: 'Кафе', статус: 'активна' });
G.insertRow_('LOCATIONS', { location_id: 'LOC-1', organization_id: 'ORG-1', название: 'Кафе «Печка»', статус: 'активна' });
function mk(id, name, role, pin) { G.insertRow_('USERS', { user_id: id, organization_id: 'ORG-1', location_ids: 'LOC-1', имя: name, роль: role, статус: 'активен', pin_hash: G.hashPin_(pin, 's' + id), pin_salt: 's' + id, failed_attempts: 0, lockout_count: 0 }); }
mk('USR-D', 'Олег', 'ДИРЕКТОР', '739164'); mk('USR-M', 'Ольга', 'МЕНЕДЖЕР', '615283'); mk('USR-K', 'Ксения', 'КАССИР', '284617');
function login(u, p) { let t = G.processOperation('LOGIN', { userId: u, pin: p }).data.token; const s = G.processOperation('SELECT_LOCATION', { locationId: 'LOC-1' }, t); return s.ok && s.data.token ? s.data.token : t; }
const tD = login('USR-D', '739164'), tM = login('USR-M', '615283'), tK = login('USR-K', '284617');
const api = (a, d, t) => { const r = G.processOperation(a, d || {}, t || tD); if (!r.ok) throw new Error(a + ': ' + r.error); return r.data; };
const D = G.todayDateStr_(), day = n => G._dpAddDays_(D, n);
const prod = (n, price) => { const p = api('CREATE_PRODUCT', { название: n, единица: 'л', цена: price }); return p.product_id || p.product.product_id; };
const vodka = prod('Водка «Пшеничная» 0,5', 600), cognac = prod('Коньяк «Арарат» 5*', 2400), beer = prod('Пиво светлое разливное', 180);
api('ALCO_SAVE_PRODUCT', { productId: vodka, категория: 'крепкий', объём_тары_л: 0.5, крепость: 40, код_вида: '200', алкокод: '0300123456789012345', производитель: 'ООО «Пример»' });
api('ALCO_SAVE_PRODUCT', { productId: cognac, категория: 'крепкий', объём_тары_л: 0.5, крепость: 40, код_вида: '230' });
api('ALCO_SAVE_PRODUCT', { productId: beer, категория: 'пиво_разлив', объём_тары_л: 30, крепость: 4.5, код_вида: '261' });
api('ALCO_SAVE_LICENSE', { номер: '77РПА0012345', выдана: day(-300), действует_до: day(25), орган: 'Департамент торговли и услуг г. Москвы' });
const dish = (n, price, pid, ml) => { const d = api('CREATE_DISH', { название: n, выход: ml, цена_продажи: price }); api('ADD_RECIPE_LINE', { parentType: 'DISH', parentId: d.dish_id, ingredientId: pid, брутто: ml, нетто: ml, единица: 'мл' }); return d.dish_id; };
const shot = dish('Водка 50 мл', 250, vodka, 50), cog = dish('Коньяк 50 мл', 600, cognac, 50), pint = dish('Пиво 0,5', 300, beer, 500);
api('RECEIVE_GOODS', { productId: vodka, qty: 3, price: 600, expiryDate: '2099-01-01', productionDate: D });
api('RECEIVE_GOODS', { productId: beer, qty: 30, price: 180, expiryDate: day(60), productionDate: D });
const m68 = i => ('22N' + String(i).padStart(5, '0')).padEnd(68, 'A');
const batches = api('ALCO_GET_BATCHES');
api('ALCO_RECEIVE_MARKS', { batchId: batches.find(b => /Водка/.test(b.название)).batch_id, marks: [1, 2, 3, 4].map(m68), ттн: 'ТТН-0001' });
const keg = '0104607012345678215Ab3Cd9\u001d93XyZ1';
api('ALCO_RECEIVE_MARKS', { batchId: batches.find(b => /Пиво/.test(b.название)).batch_id, marks: [keg] });
api('ALCO_OPEN', { mark: keg }, tK);
const sale = (id, q) => G.insertRow_('SALES', { sale_id: 'S-' + Math.random(), organization_id: 'ORG-1', location_id: 'LOC-1', dish_id: id, qty: q, сумма: q * 300, дата: D, источник: 'касса' });
sale(shot, 6); sale(pint, 14); sale(cog, 2);

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const errors = [];
  async function open(tok, w, h) {
    const p = await browser.newPage({ viewport: { width: w, height: h }, acceptDownloads: true });
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
    await p.evaluate(() => navTo('alco')); await p.waitForTimeout(600);
    return p;
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const cash = await open(tK, 390, 844);
  const tabsHidden = await cash.$$eval('#alcoTabs button[data-module-gate="alco"]', bs => bs.every(b => b.classList.contains('hidden')));
  const focused = await cash.evaluate(() => document.activeElement && document.activeElement.id);
  await cash.keyboard.type(m68(1)); await cash.keyboard.press('Enter'); await wait(500);
  const ok = await cash.textContent('#alcoOpenResult');
  await cash.keyboard.type(m68(1)); await cash.keyboard.press('Enter'); await wait(500);
  const dup = await cash.textContent('#alcoOpenResult');
  await cash.keyboard.type(m68(2)); await cash.keyboard.press('Enter'); await wait(500);
  await cash.screenshot({ path: OUT + '/M12-open-390.png', fullPage: true });
  const today = await cash.textContent('#alcoOpenedToday');

  const man = await open(tM, 1280, 900);
  await man.click('#alcoTabs >> text=К отправке'); await wait(400);
  await man.screenshot({ path: OUT + '/M12-outbox-1280.png', fullPage: true });
  const dl = man.waitForEvent('download');
  await man.click('[data-alco-panel="outbox"] >> text=Скачать CSV');
  const csv = require('fs').readFileSync(await (await dl).path(), 'utf8');
  await man.fill('#alcoReceipt', 'ACT-2026-0042'); await man.click('text=Отметить отправленными'); await wait(500);
  const sent = await man.textContent('#alcoOutbox');
  await man.click('#alcoTabs >> text=Журнал продаж'); await wait(500);
  const check = await man.textContent('#alcoCheck');
  await man.screenshot({ path: OUT + '/M12-journal-1280.png', fullPage: true });
  await man.click('#alcoTabs >> text=Лицензия и карточки'); await wait(500);
  await man.screenshot({ path: OUT + '/M12-setup-1280.png', fullPage: true });
  const banner = await man.textContent('#alcoBanner');
  await browser.close();

  const res = {
    'кассир видит только вскрытие': tabsHidden,
    'поле скана в фокусе': focused === 'alcoScan',
    'скан → вскрыто': /Вскрыто: Водка/.test(ok),
    'повторный скан — понятный отказ': /Не вскрыто/.test(dup) && /уже вскрыта/.test(dup),
    'вскрыто сегодня: 2 бутылки и кега': (today.match(/ЕГАИС/g) || []).length === 2 && /кега/.test(today),
    'CSV для отправки с маркой': /Вскрытие тары;ЕГАИС/.test(csv) && csv.includes(m68(1)),
    'отмечено отправленным': /Всё отправлено/.test(sent),
    'сверка: коньяк продан без вскрытия': /Коньяк/.test(check),
    'баннер: лицензия, 25 дней': /Осталось 25 дн/.test(banner),
    'ошибок в браузере нет': errors.length === 0
  };
  console.log(res, errors);
  process.exit(Object.values(res).every(Boolean) ? 0 : 1);
})();
