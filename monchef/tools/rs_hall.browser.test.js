// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
// Restaurant Service, этап 2: страница «Зал и бронирование» в браузере (Playwright) поверх стенда-эмулятора.
// google.script.run страницы вызывает функции эмулятора (через шлюз, с ключом входа). Запуск: node monchef/tools/rs_hall.browser.test.js [папка для снимков]
const assert = require('assert');
const { chromium } = require('playwright');
const { boot } = require('./gasemu');

const shots = process.argv[2] || '';
const E = boot({ now: '2026-11-25T08:00:00Z' }), C = E.ctx, ss = E.ss;
const emp = ss.insertSheet('Сотрудники');
emp.appendRow(['Фамилия', 'Имя', 'Отчество', 'Должность', 'Роль', 'ДР', 'Телефон', 'Адрес', 'ПИН-код', '', '', '', 'Активен']);
emp.appendRow(['Админов', 'Пётр', '', 'Администратор зала', 'Администратор', '', '', '', '2222', '', '', '', true]);
const ds = ss.insertSheet('Блюда');
ds.appendRow(['Код', 'Название', 'Категория', 'Выход', '', '', '', '', 'Цех', '', '', '', 'Выход, г/мл/шт', 'Ед. выхода']);
ds.appendRow(['D001', 'Стейк рибай', 'Горячее', '350', '', '', '', '', 'Горячий цех', '', '', '', 350, 'г']);
ds.appendRow(['B001', 'Негрони', 'Коктейли', '120', '', '', '', '', 'Бар', '', '', '', 120, 'мл']);
const TOK = JSON.parse(C.loginWithPin('2222', 'dev-browser')).token;
const J = s => JSON.parse(s);
let n = 0; const k = () => 'browser-seed-' + (++n);
const hall = J(C.rsHallSave(JSON.stringify({ idem: k(), name: 'Основной зал', width: 8, height: 5 }), TOK)).data;
const tb = [['12', 1, 1, 4], ['13', 3, 1, 4], ['14', 5, 1, 2], ['15', 1, 3, 6]].map(r => J(C.rsTableSave(JSON.stringify({ idem: k(), hallId: hall.id, number: r[0], x: r[1], y: r[2], seatsMax: r[3] }), TOK)).data);
J(C.rsBookingCreate(JSON.stringify({ idem: k(), tables: [tb[0].id], guest: 'Смирнов', phone: '+7 900 111-22-33', date: '2026-11-25', start: '13:30', duration: 120, guests: 3, status: 'CONFIRMED' }), TOK));
J(C.rsBookingCreate(JSON.stringify({ idem: k(), tables: [tb[1].id], guest: 'Иванова', date: '2026-11-25', start: '12:30', duration: 120, guests: 2, status: 'CONFIRMED' }), TOK));

(async () => {
  const html = C.doGet({ parameter: { hall: '1', token: TOK } }).getContent();
  const browser = await chromium.launch();
  const errors = [];
  for (const vp of [{ name: 'phone', width: 390, height: 844 }, { name: 'tablet', width: 1024, height: 768 }]) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, timezoneId: 'Asia/Yekaterinburg', deviceScaleFactor: shots ? 2 : 1 });
    page.on('pageerror', e => errors.push(vp.name + ': ' + e.message));
    await page.exposeFunction('__srv', (fn, args) => {
      if (typeof C[fn] !== 'function') return JSON.stringify({ success: false, error: { message: 'нет функции ' + fn } });
      const r = C[fn].apply(null, args); return typeof r === 'string' ? r : JSON.stringify(r);
    });
    await page.addInitScript(() => {
      const runner = st => new Proxy({}, { get: (_, key) => {
        if (key === 'withSuccessHandler') return f => runner(Object.assign({}, st, { ok: f }));
        if (key === 'withFailureHandler') return f => runner(Object.assign({}, st, { fail: f }));
        if (key === 'withUserObject') return () => runner(st);
        return (...args) => { window.__srv(key, args).then(r => st.ok && st.ok(r), e => st.fail && st.fail(e)); };
      } });
      window.google = { script: { run: runner({}) } };
      const D = Date; const fixed = new D('2026-11-25T08:00:00Z').getTime();
      window.Date = class extends D { constructor(...a) { if (!a.length) super(fixed); else super(...a); } static now() { return fixed; } };
    });
    await page.route('http://monchef.test/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
    await page.goto('http://monchef.test/exec?hall=1');
    await page.waitForSelector('.tbl', { timeout: 10000 });
    const states = await page.$$eval('.tbl', els => els.map(e => e.className));
    assert.strictEqual(states.length, 4, 'на схеме 4 стола');
    assert.ok(states.some(c => /s-soon/.test(c)), 'стол 12 — «скоро бронь»');
    assert.ok(states.some(c => /s-booked/.test(c)), 'стол 13 — «забронирован»');
    const sw = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    if (shots) await page.screenshot({ path: shots + '/hall-' + vp.name + '-plan.png', fullPage: true });
    // новая бронь с предзаказом через форму
    await page.click('text=+ Новая бронь');
    await page.waitForSelector('#f_tables label');
    await page.fill('#f_guest', 'Тестов ' + vp.name);
    await page.fill('#f_start', vp.name === 'phone' ? '19:00' : '21:00');
    await page.fill('#f_guests', '4');
    await page.waitForTimeout(200);
    await page.check('#f_tables label:has-text("№ 15") input');
    await page.waitForFunction(() => window.S && S.dishes);
    await page.fill('#f_dq', 'стейк');
    await page.click('#f_dl .bk');
    if (shots) await page.screenshot({ path: shots + '/hall-' + vp.name + '-booking.png', fullPage: true });
    await page.click('#f_save');
    await page.waitForSelector('.msg.ok', { timeout: 10000 });
    await page.click('.tabs button:has-text("Брони")');
    await page.waitForSelector('.bk .nm');
    const names = await page.$$eval('.bk .nm', e => e.map(x => x.textContent));
    assert.ok(names.includes('Тестов ' + vp.name), 'новая бронь в списке: ' + names.join(', '));
    if (shots) await page.screenshot({ path: shots + '/hall-' + vp.name + '-list.png', fullPage: true });
    await page.click('.seg button:has-text("Месяц")');
    await page.waitForSelector('.month .d');
    assert.ok(sw, vp.name + ': нет горизонтальной прокрутки страницы');
    console.log('  ✓ ' + vp.name + ' ' + vp.width + '×' + vp.height + ': схема, форма брони с предзаказом, список, месяц');
    await page.close();
  }
  await browser.close();
  assert.deepStrictEqual(errors, [], 'ошибки JavaScript на странице');
  const po = ss.getSheetByName('Предзаказы_V1').getLastRow() - 1;
  assert.strictEqual(po, 2, 'два предзаказа из формы');
  console.log('Итого: браузерная проверка пройдена');
})().catch(e => { console.error('✗', e.message); process.exit(1); });
