// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
// Restaurant Service, этап 3: блокнот официанта в браузере (Playwright) поверх стенда-эмулятора.
// Открыть стол → добавить блюдо и весовое блюдо → отправить на кухню → счёт «каждый за себя».
// Запуск: node monchef/tools/rs_order.browser.test.js [папка для снимков]
const assert = require('assert');
const { chromium } = require('playwright');
const { boot } = require('./gasemu');

const shots = process.argv[2] || '';
function seed() {
  const E = boot({ now: '2026-11-25T08:00:00Z' }), C = E.ctx, ss = E.ss;
  const emp = ss.insertSheet('Сотрудники');
  emp.appendRow(['Фамилия', 'Имя', 'Отчество', 'Должность', 'Роль', 'ДР', 'Телефон', 'Адрес', 'ПИН-код', '', '', '', 'Активен']);
  emp.appendRow(['Админов', 'Пётр', '', 'Администратор', 'Администратор', '', '', '', '2222', '', '', '', true]);
  emp.appendRow(['Официантов', 'Иван', '', 'Официант', 'Официант', '', '', '', '3333', '', '', '', true]);
  const ds = ss.insertSheet('Блюда');
  ds.appendRow(['Код', 'Название', 'Категория', 'Выход', '', '', '', '', 'Цех', '', '', '', 'Выход, г/мл/шт', 'Ед. выхода']);
  [['D001', 'Стейк рибай', 'Горячее', 'Горячий цех', 300, 'г'], ['D002', 'Сырная тарелка', 'Закуски', 'Холодный цех', 250, 'г'], ['B002', 'Капучино', 'Кофе', 'Бар', 250, 'мл']]
    .forEach(r => ds.appendRow([r[0], r[1], r[2], '', '', '', '', '', r[3], '', '', '', r[4], r[5]]));
  const pr = ss.insertSheet('Цены_Меню');
  pr.appendRow(['PriceID', 'DishCode', 'DishName', 'Price', 'Unit', 'Source', 'EventID', 'DateFrom', 'DateTo', 'Status']);
  [['P1', 'D001', 1500, '100 г'], ['P2', 'D002', 890, 'порц.'], ['P3', 'B002', 250, 'порц.']].forEach(r => pr.appendRow([r[0], r[1], '', r[2], r[3], 'MENU', '', '2026-11-01', '', 'ACTIVE']));
  const tv = ss.insertSheet('ТТК_Версии');
  tv.appendRow(['Код блюда', 'Версия', 'Статус']); ['D001', 'D002', 'B002'].forEach(c => tv.appendRow([c, 1, 'действующая']));
  const ADM = JSON.parse(C.loginWithPin('2222', 'dev-a')).token, WAI = JSON.parse(C.loginWithPin('3333', 'dev-w')).token;
  let n = 0; const k = () => 'seed-key-' + (++n);
  const hall = JSON.parse(C.rsHallSave(JSON.stringify({ idem: k(), name: 'Основной зал', width: 8, height: 5 }), ADM)).data;
  ['10', '11', '12', '14'].forEach((num, i) => C.rsTableSave(JSON.stringify({ idem: k(), hallId: hall.id, number: num, x: i * 2, y: 1, seatsMax: 4 }), ADM));
  return { C, ss, WAI };
}

(async () => {
  const browser = await chromium.launch(), errors = [];
  for (const vp of [{ name: 'phone', width: 390, height: 844 }, { name: 'tablet', width: 1024, height: 768 }]) {
    const { C, ss, WAI } = seed();
    const html = C.doGet({ parameter: { hall: '1', token: WAI } }).getContent();
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, timezoneId: 'Asia/Yekaterinburg', deviceScaleFactor: shots ? 2 : 1 });
    page.on('pageerror', e => errors.push(vp.name + ': ' + e.message));
    const answers = [];
    page.on('dialog', d => (d.type() === 'confirm' ? d.accept() : d.accept(answers.length ? answers.shift() : '')));
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
    await page.goto('http://monchef.test/exec?hall=1'); await page.addStyleTag({ content: '#mcxScreen{display:none!important}' });
    await page.waitForSelector('.tbl');
    await page.click('.tbl:has-text("12")');
    await page.fill('#o_guests', '2');
    await page.click('#o_open');
    await page.waitForSelector('h2:has-text("Стол № 12")');
    await page.click('.seg button:has-text("+ Добавить блюдо")');
    await page.waitForSelector('#m_list .bk');
    await page.selectOption('#m_g', '1');
    answers.push('1', '');                         // количество, комментарий
    await page.click('#m_list .bk:has-text("Сырная тарелка")');
    await page.waitForSelector('.msg.ok:has-text("Сырная")');
    await page.click('.seg button:has-text("+ Добавить блюдо")');
    await page.waitForSelector('#m_list .bk');
    await page.selectOption('#m_g', '2');
    answers.push('300', 'medium rare');           // вес, комментарий
    await page.click('#m_list .bk:has-text("Стейк")');
    await page.waitForSelector('.msg.ok:has-text("Стейк")');
    await page.click('.seg button:has-text("Позиции")');
    await page.waitForSelector('button:has-text("Отправить на кухню")');
    if (shots) await page.screenshot({ path: shots + '/order-' + vp.name + '-items.png', fullPage: true });
    await page.click('button:has-text("Отправить на кухню")');
    await page.waitForSelector('.msg.ok:has-text("Отправлено: 2")');
    answers.push('340');
    await page.click('button:has-text("Фактический вес")');
    await page.waitForSelector('.msg.ok:has-text("Вес внесён")');
    await page.click('.seg button:has-text("Счёт")');
    await page.click('button:has-text("Каждый за себя")');
    await page.waitForSelector('.msg.ok:has-text("Счёт сформирован")');
    const totals = await page.$$eval('.sheet .card .nm[style*="font-size:18px"]', e => e.map(x => x.textContent));
    assert.deepStrictEqual(totals, ['890 ₽', '5 100 ₽'], 'гость 1 — сыр, гость 2 — стейк 340 г: ' + totals);
    if (shots) await page.screenshot({ path: shots + '/order-' + vp.name + '-bill.png', fullPage: true });
    const q = ss.getSheetByName('ОчередьПроизводства_V1').getDataRange().getValues().slice(1);
    assert.strictEqual(q.length, 2, 'два задания производства');
    const sw = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    assert.ok(sw, 'нет горизонтальной прокрутки страницы');
    await page.click('.sheet button:has-text("Закрыть")');
    await page.waitForSelector('.tbl.s-order');
    if (shots) await page.screenshot({ path: shots + '/order-' + vp.name + '-plan.png', fullPage: true });
    console.log('  ✓ ' + vp.name + ': открыт стол, 2 блюда (весовое 300 → 340 г), отправка, счёт по гостям, стол «занят заказом»');
    await page.close();
  }
  await browser.close();
  assert.deepStrictEqual(errors, [], 'ошибки JavaScript');
  console.log('Итого: браузерная проверка блокнота официанта пройдена');
})().catch(e => { console.error('✗', e.message); process.exit(1); });
