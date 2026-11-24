// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
// Restaurant Service, этап 6: экран бармена (планшет) — задание с рецептом, «Готово» со списанием, рецептуры, выпуск заготовки.
// Запуск: node monchef/tools/rs_bar.browser.test.js [папка для снимков]
const assert = require('assert');
const { chromium } = require('playwright');
const { boot } = require('./gasemu');
const shots = process.argv[2] || '';

const E = boot({ now: '2026-11-25T08:00:00Z' }), C = E.ctx, ss = E.ss;
E.props[C.MC_MED_GATE_PROP_] = 'off';
const emp = ss.insertSheet('Сотрудники');
emp.appendRow(['Фамилия', 'Имя', 'Отчество', 'Должность', 'Роль', 'ДР', 'Телефон', 'Адрес', 'ПИН-код', '', '', '', 'Активен']);
[['Админов', 'Пётр', 'Администратор', '2222'], ['Официантов', 'Иван', 'Официант', '3333'], ['Барменов', 'Лев', 'Бармен', '8888']].forEach(r => emp.appendRow([r[0], r[1], '', r[2], r[2], '', '', '', r[3], '', '', '', true]));
const ds = ss.insertSheet('Блюда');
ds.appendRow(['Код', 'Название', 'Категория', 'Выход', '', 'Технология', '', '', 'Цех', '', '', '', 'Выход, г/мл/шт', 'Ед. выхода']);
[['B010', 'Дайкири', 'Коктейли', 85, 'мл', 'Шейк со льдом, двойной стрейн в охлаждённое купе'], ['PF20', 'Сироп сахарный п/ф', 'Сиропы', 1000, 'мл', 'Сахар растворить в горячей воде 1:1']]
  .forEach(r => ds.appendRow([r[0], r[1], r[2], r[3], '', r[5], '', '', 'Бар', '', '', '', r[3], r[4]]));
const so = ss.insertSheet('Состав'); so.appendRow(['Код', 'Продукт', '', '', 'Брутто', 'Нетто', 'Выход', 'Ед.']);
[['B010', 'Ром белый', 50, 50, 'мл'], ['B010', 'Сок лайма', 25, 20, 'мл'], ['B010', 'Сироп сахарный п/ф', 15, 15, 'мл'], ['PF20', 'Сахар', 500, 500, 'г'], ['PF20', 'Вода питьевая', 500, 500, 'мл']]
  .forEach(r => so.appendRow([r[0], r[1], '', '', r[2], r[3], r[3], r[4]]));
const pr = ss.insertSheet('Цены_Меню'); pr.appendRow(['PriceID', 'DishCode', 'DishName', 'Price', 'Unit', 'Source', 'EventID', 'DateFrom', 'DateTo', 'Status']); pr.appendRow(['P1', 'B010', '', 650, 'порц.', 'MENU', '', '2026-11-01', '', 'ACTIVE']);
const tv = ss.insertSheet('ТТК_Версии'); tv.appendRow(['Код блюда', 'Версия', 'Статус']); ['B010', 'PF20'].forEach(c => tv.appendRow([c, 1, 'действующая']));
C._withLock_(() => C._incomeWithBatches_([{ name: 'Ром белый', qty: 700, unit: 'мл', price: 2 }, { name: 'Сок лайма', qty: 300, unit: 'мл', price: 1 }, { name: 'Сахар', qty: 2000, unit: 'г', price: 0.1 }, { name: 'Вода питьевая', qty: 5000, unit: 'мл', price: 0.01 }], 'Поставщик', '', null));
(() => { const sh = ss.getSheetByName('Склад_Партии'), n = sh.getLastRow(); for (let i = 2; i <= n; i++) sh.getRange(i, 11).setValue('active'); })();
const tok = pin => JSON.parse(C.loginWithPin(pin, 'dev-' + pin)).token;
const ADM = tok('2222'), WAI = tok('3333'), BAR = tok('8888');
let n = 0; const k = () => 'barb-key-' + (++n), J = s => JSON.parse(s);
const hall = J(C.rsHallSave(JSON.stringify({ idem: k(), name: 'Зал', width: 6, height: 4 }), ADM)).data;
const t5 = J(C.rsTableSave(JSON.stringify({ idem: k(), hallId: hall.id, number: '5', x: 1, y: 1, seatsMax: 4 }), ADM)).data;
const o = J(C.rsOrderOpen(JSON.stringify({ idem: k(), tableId: t5.id, guests: 2 }), WAI)).data.orderId;
J(C.rsItemAdd(JSON.stringify({ idem: k(), orderId: o, items: [{ code: 'B010', qty: 2, comment: 'без сахара по краю' }] }), WAI));
J(C.rsOrderSend(JSON.stringify({ idem: k(), orderId: o, mode: 'all' }), WAI));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, timezoneId: 'Asia/Yekaterinburg', deviceScaleFactor: shots ? 2 : 1 });
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept());
  await page.exposeFunction('__srv', (fn, args) => { C._mcRcDrop_(); C._BOOK_CACHE_ = null; const r = C[fn].apply(null, args); return r === undefined ? null : r; });
  await page.addInitScript(() => {
    const runner = st => new Proxy({}, { get: (_, key) => {
      if (key === 'withSuccessHandler') return f => runner(Object.assign({}, st, { ok: f }));
      if (key === 'withFailureHandler') return f => runner(Object.assign({}, st, { fail: f }));
      if (key === 'withUserObject') return () => runner(st);
      return (...args) => { window.__srv(key, args).then(r => st.ok && st.ok(r), e => st.fail && st.fail(e)); };
    } });
    window.google = { script: { run: runner({}) } };
  });
  const html = C.doGet({ parameter: { kds: '1', token: BAR } }).getContent();
  await page.route('http://monchef.test/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto('http://monchef.test/exec'); await page.addStyleTag({ content: '#mcxScreen{display:none!important}' });
  await page.waitForSelector('.tk');
  const tabs = await page.$$eval('.tabs button', e => e.map(x => x.textContent));
  assert.deepStrictEqual(tabs, ['Бар', 'Stop/Go', 'Рецептуры бара', 'Заготовки бара'], 'у бармена — только бар: ' + tabs);
  await page.click('.tk details summary');
  assert.ok(/Ром белый — 50 мл/.test(await page.textContent('.tk')), 'рецепт на карточке');
  if (shots) await page.screenshot({ path: shots + '/bar-ticket.png', fullPage: true });
  await page.click('.tk button:has-text("Готовить")'); await page.waitForSelector('.tk button:has-text("Готово")');
  await page.click('.tk button:has-text("Готово")'); await page.waitForSelector('.msg:has-text("ингредиенты списаны")');
  await page.click('.tabs button:has-text("Рецептуры бара")'); await page.waitForSelector('.card:has-text("Дайкири")');
  assert.ok(!/Себестоимость/.test(await page.textContent('#view')), 'бармен не видит себестоимость');
  if (shots) await page.screenshot({ path: shots + '/bar-recipes.png', fullPage: true });
  await page.click('.tabs button:has-text("Заготовки бара")'); await page.waitForSelector('#pp_c');
  await page.fill('#pp_q', '1000'); await page.click('button:has-text("Запланировать")');
  await page.waitForSelector('button:has-text("Начать")'); await page.click('button:has-text("Начать")');
  await page.waitForSelector('.msg.ok:has-text("в работе")');
  await page.click('button:has-text("Выпустить")'); await page.click('#pd_go');
  await page.waitForSelector('.msg.ok:has-text("Заготовка выпущена")');
  if (shots) await page.screenshot({ path: shots + '/bar-preps.png', fullPage: true });
  const b = ss.getSheetByName('Склад_Партии').getDataRange().getValues(); assert.ok(b.some(r => r[1] === 'Сироп сахарный' && r[9] === 1000), 'партия сиропа');
  assert.deepStrictEqual(errs, []);
  await browser.close();
  console.log('  ✓ бармен (планшет): только бар, рецепт на карточке, «Готово» со списанием, рецептуры без себестоимости, заготовка выпущена партией');
  console.log('Итого: браузерная проверка бара пройдена');
})().catch(e => { console.error('✗', e.message); process.exit(1); });
