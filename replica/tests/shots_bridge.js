// Мост к УТМ в браузере: ключ моста, очередь со статусами ЕГАИС и ошибкой, входящие ТТН (1280).
// Запуск: node replica/tests/shots_bridge.js
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

// Бутылки 1 и 2 вскрыты: первая «в УТМ», вторая отклонена ЕГАИС; входящая ТТН — через операцию моста.
const key = api('ALCO_BRIDGE_CREATE', { название: 'Компьютер администратора' }).key;
api('ALCO_OPEN', { mark: m68(1) }, tK); api('ALCO_OPEN', { mark: m68(2) }, tK);
const bridgeOp = (op, extra) => { const r = G.processOperation('ALCO_BRIDGE', Object.assign({ bridgeKey: key, op }, extra)); if (!r.ok) throw new Error(r.error); return r.data; };
const docs = bridgeOp('pull', {}).docs;
bridgeOp('report', { results: docs.map((d, i) => ({ docId: d.doc_id, ok: true, replyId: 'reply-' + i })) });
bridgeOp('ticket', { tickets: [{ replyId: 'reply-1', accepted: false, comment: 'Марка не числится на регистре 2' }] });
bridgeOp('inbox', { docs: [{ utm_id: 'u1', тип: 'ТТН', номер: 'ТТН-0815', дата: D, поставщик: 'ООО «Алкосклад»', позиции: [
  { название: 'Водка «Пшеничная» 0,5', алкокод: '0300123456789012345', количество: 12, цена: 310 }, { название: 'Коньяк «Арарат» 5*', алкокод: '0300987654321', количество: 6, цена: 1250 }] }] });

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const errors = [];
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
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
  }, tM);
  await p.goto('file://' + GAS + '/Index.html'); await p.waitForTimeout(1300);
  await p.evaluate(() => navTo('alco')); await p.waitForTimeout(600);
  const banner = await p.textContent('#alcoBanner');
  await p.click('#alcoTabs >> text=К отправке'); await p.waitForTimeout(500);
  const outbox = await p.textContent('#alcoOutbox');
  await p.screenshot({ path: OUT + '/BRIDGE-outbox-1280.png', fullPage: true });
  await p.click('#alcoOutbox button:text-is("Повторить")'); await p.waitForTimeout(500);
  const afterRetry = await p.textContent('#alcoOutbox');
  await p.click('#alcoTabs >> text=Входящие ТТН'); await p.waitForTimeout(500);
  await p.click('#alcoInbox summary'); await p.waitForTimeout(200);
  const inbox = await p.textContent('#alcoInbox');
  await p.screenshot({ path: OUT + '/BRIDGE-inbox-1280.png', fullPage: true });
  await p.click('#alcoTabs >> text=Лицензия и карточки'); await p.waitForTimeout(500);
  await p.fill('#alcoBridgeName', 'Компьютер администратора');
  await p.click('text=Выдать ключ моста'); await p.waitForTimeout(500);
  const newKey = await p.textContent('#alcoKeyText');
  await p.locator('[data-alco-panel="setup"] .card').first().screenshot({ path: OUT + '/BRIDGE-key-1280.png' });
  await browser.close();
  const res = {
    'баннер: ошибка ЕГАИС и мост на связи': /Ошибки ЕГАИС: 1/.test(banner) && /Мост к УТМ на связи/.test(banner),
    'очередь: «в УТМ, ждёт квитанцию» и причина отказа': /в УТМ, ждёт квитанцию/.test(outbox) && /ЕГАИС отклонила: Марка не числится на регистре 2/.test(outbox),
    '«Повторить» вернул документ в очередь': !/ЕГАИС отклонила/.test(afterRetry),
    'входящая ТТН с позициями': /ТТН № ТТН-0815/.test(inbox) && /Коньяк «Арарат» 5\*/.test(inbox),
    'новый ключ показан один раз': /^tsb\.ALCB-[0-9A-F]+\.[0-9a-f]{64}$/.test(newKey.trim()) && newKey.trim() !== key,
    'ошибок в браузере нет': errors.length === 0
  };
  console.log(res, errors, banner);
  process.exit(Object.values(res).every(Boolean) ? 0 : 1);
})();
