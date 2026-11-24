// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
// Restaurant Service, этап 4: экран кухни (планшет) — принять, готовить, готово; Stop/Go; официант (телефон) — «Подано».
// Запуск: node monchef/tools/rs_kds.browser.test.js [папка для снимков]
const assert = require('assert');
const { chromium } = require('playwright');
const { boot } = require('./gasemu');
const shots = process.argv[2] || '';

const E = boot({ now: '2026-11-25T08:00:00Z' }), C = E.ctx, ss = E.ss;
E.props[C.MC_MED_GATE_PROP_] = 'off';
const emp = ss.insertSheet('Сотрудники');
emp.appendRow(['Фамилия', 'Имя', 'Отчество', 'Должность', 'Роль', 'ДР', 'Телефон', 'Адрес', 'ПИН-код', '', '', '', 'Активен']);
[['Админов', 'Пётр', 'Администратор', '2222'], ['Официантов', 'Иван', 'Официант', '3333'], ['Шефов', 'Марк', 'Шеф-повар', '7777']].forEach(r => emp.appendRow([r[0], r[1], '', r[2], r[2], '', '', '', r[3], '', '', '', true]));
const ds = ss.insertSheet('Блюда');
ds.appendRow(['Код', 'Название', 'Категория', 'Выход', '', '', '', '', 'Цех', '', '', '', 'Выход, г/мл/шт', 'Ед. выхода']);
[['D001', 'Стейк рибай', 'Горячее', 'Горячий цех'], ['D002', 'Сырная тарелка', 'Закуски', 'Холодный цех'], ['D005', 'Борщ', 'Супы', 'Горячий цех'], ['D007', 'Тирамису', 'Десерты', 'Кондитерский цех']]
  .forEach(r => ds.appendRow([r[0], r[1], r[2], '', '', '', '', '', r[3], '', '', '', 300, 'г']));
const pr = ss.insertSheet('Цены_Меню'); pr.appendRow(['PriceID', 'DishCode', 'DishName', 'Price', 'Unit', 'Source', 'EventID', 'DateFrom', 'DateTo', 'Status']);
['D001', 'D002', 'D005', 'D007'].forEach((c, i) => pr.appendRow(['P' + i, c, '', 600 + i * 50, 'порц.', 'MENU', '', '2026-11-01', '', 'ACTIVE']));
const tv = ss.insertSheet('ТТК_Версии'); tv.appendRow(['Код блюда', 'Версия', 'Статус']); ['D001', 'D002', 'D005', 'D007'].forEach(c => tv.appendRow([c, 1, 'действующая']));
const tok = pin => JSON.parse(C.loginWithPin(pin, 'dev-' + pin)).token;
const ADM = tok('2222'), WAI = tok('3333'), CHEF = tok('7777');
let n = 0; const k = () => 'kdsb-key-' + (++n), J = s => JSON.parse(s);
const hall = J(C.rsHallSave(JSON.stringify({ idem: k(), name: 'Зал', width: 6, height: 4 }), ADM)).data;
const t12 = J(C.rsTableSave(JSON.stringify({ idem: k(), hallId: hall.id, number: '12', x: 1, y: 1, seatsMax: 4 }), ADM)).data;
const t7 = J(C.rsTableSave(JSON.stringify({ idem: k(), hallId: hall.id, number: '7', x: 3, y: 1, seatsMax: 4 }), ADM)).data;
const o12 = J(C.rsOrderOpen(JSON.stringify({ idem: k(), tableId: t12.id, guests: 2 }), WAI)).data.orderId;
J(C.rsItemAdd(JSON.stringify({ idem: k(), orderId: o12, items: [{ code: 'D001', comment: 'medium rare' }, { code: 'D002', course: 1 }, { code: 'D005', course: 2 }] }), WAI));
assert.ok(J(C.rsOrderSend(JSON.stringify({ idem: k(), orderId: o12, mode: 'all' }), WAI)).success);
const o7 = J(C.rsOrderOpen(JSON.stringify({ idem: k(), tableId: t7.id, guests: 3 }), WAI)).data.orderId;
J(C.rsItemAdd(JSON.stringify({ idem: k(), orderId: o7, items: [{ code: 'D007', qty: 3 }, { code: 'D001', qty: 2 }] }), WAI));
J(C.rsOrderSend(JSON.stringify({ idem: k(), orderId: o7, mode: 'all' }), WAI));

async function open(browser, html, vp) {
  const page = await browser.newPage({ viewport: vp, timezoneId: 'Asia/Yekaterinburg', deviceScaleFactor: shots ? 2 : 1 });
  page.__err = []; page.on('pageerror', e => page.__err.push(e.message)); page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'проверка' : undefined));
  await page.exposeFunction('__srv', (fn, args) => { C._mcRcDrop_(); C._BOOK_CACHE_ = null; const r = C[fn].apply(null, args); return r === undefined ? null : r; });
  await page.addInitScript(() => {
    const runner = st => new Proxy({}, { get: (_, key) => {
      if (key === 'withSuccessHandler') return f => runner(Object.assign({}, st, { ok: f }));
      if (key === 'withFailureHandler') return f => runner(Object.assign({}, st, { fail: f }));
      if (key === 'withUserObject') return () => runner(st);
      return (...args) => { window.__srv(key, args).then(r => st.ok && st.ok(r), e => st.fail && st.fail(e)); };
    } });
    window.google = { script: { run: runner({}) } };
    const D = Date, fixed = new D('2026-11-25T08:00:00Z').getTime();
    window.Date = class extends D { constructor(...a) { if (!a.length) super(fixed); else super(...a); } static now() { return fixed; } };
  });
  await page.route('http://monchef.test/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto('http://monchef.test/exec'); await page.addStyleTag({ content: '#mcxScreen{display:none!important}' });
  return page;
}
(async () => {
  const browser = await chromium.launch();
  // кухня — планшет
  const kd = await open(browser, C.doGet({ parameter: { kds: '1', token: CHEF } }).getContent(), { width: 1024, height: 768 });
  await kd.waitForSelector('.tk');
  assert.strictEqual(await kd.$$eval('.tk', e => e.length), 5);
  assert.ok(/medium rare/.test(await kd.textContent('.tk:has-text("Стол 12"):has-text("Стейк")')));
  assert.ok(await kd.$('.tk.WAIT_COURSE:has-text("Борщ")'), 'борщ ждёт курса');
  if (shots) await kd.screenshot({ path: shots + '/kds-tablet.png', fullPage: true });
  const steak = '.tk:has-text("Стол 12"):has-text("Стейк")';
  await kd.click(steak + ' button:has-text("Принять")'); await kd.waitForSelector(steak + ' button:has-text("Готовить")');
  await kd.click(steak + ' button:has-text("Готовить")'); await kd.waitForSelector(steak + ' button:has-text("Готово")');
  await kd.click(steak + ' button:has-text("Готово")'); await kd.waitForSelector(steak + ' button:has-text("Выдано")');
  // Stop/Go
  await kd.click('.tabs button:has-text("Stop/Go")');
  await kd.click('button:has-text("Поставить STOP")');
  await kd.fill('#s_q', 'тирам'); await kd.click('#s_l div:has-text("Тирамису")');
  await kd.selectOption('#s_r', 'Закончилась заготовка');
  await kd.fill('#s_c', 'маскарпоне кончился');
  await kd.click('.sheet button:has-text("Подтвердить")');
  await kd.waitForSelector('.card:has-text("Тирамису")');
  if (shots) await kd.screenshot({ path: shots + '/kds-stopgo.png', fullPage: true });
  assert.deepStrictEqual(kd.__err, []);
  // официант — телефон: «готово» и «Подано»
  const ha = await open(browser, C.doGet({ parameter: { hall: '1', token: WAI } }).getContent(), { width: 390, height: 844 });
  await ha.waitForSelector('.tbl');
  assert.ok(/готово: 1/.test(await ha.textContent('.tbl:has-text("12")')), 'на схеме видно готовое');
  await ha.click('.tabs button:has-text("Мои заказы")'); await ha.click('.card:has-text("Стол № 12")');
  await ha.waitForSelector('button:has-text("Подано")');
  if (shots) await ha.screenshot({ path: shots + '/waiter-ready.png', fullPage: true });
  await ha.click('button:has-text("Подано")');
  await ha.waitForSelector('.msg.ok:has-text("Подано")');
  assert.ok(/подано/.test(await ha.textContent('.sheet')));
  await ha.click('.sheet button:has-text("Закрыть")');
  await ha.click('.tabs button:has-text("Stop/Go")');
  await ha.waitForSelector('.card:has-text("Тирамису")');
  assert.deepStrictEqual(ha.__err, []);
  await browser.close();
  console.log('  ✓ кухня (планшет): 5 заданий, ждущий курс, принять → готовить → готово, STOP с причиной\n  ✓ официант (телефон): «готово» на схеме, «Подано», Stop/Go виден залу');
  console.log('Итого: браузерная проверка кухни пройдена');
})().catch(e => { console.error('✗', e.message); process.exit(1); });
