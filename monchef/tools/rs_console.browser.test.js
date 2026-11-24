// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
// Restaurant Service внутри главного окна MON CHEF: переходы без перезагрузки, изоляция экранов, «Назад», остановка автообновления,
// «На весь экран» для кухни, старые адреса ?hall=1 / ?kds=1, гостевое меню — отдельно. Запуск: node monchef/tools/rs_console.browser.test.js [папка для снимков]
const assert = require('assert');
const { chromium } = require('playwright');
const { boot } = require('./gasemu');
const shots = process.argv[2] || '';
let pass = 0;
const ok = name => { pass++; console.log('  ✓ ' + name); };

const E = boot({ now: '2026-11-25T08:00:00Z' }), C = E.ctx, ss = E.ss;
E.props[C.MC_MED_GATE_PROP_] = 'off';
const emp = ss.insertSheet('Сотрудники');
emp.appendRow(['Фамилия', 'Имя', 'Отчество', 'Должность', 'Роль', 'ДР', 'Телефон', 'Адрес', 'ПИН-код', '', '', '', 'Активен']);
[['Директорова', 'Анна', 'Директор', '1111'], ['Официантов', 'Иван', 'Официант', '3333'], ['Шефов', 'Марк', 'Шеф-повар', '7777']]
  .forEach(r => emp.appendRow([r[0], r[1], '', r[2], r[2], '', '', '', r[3], '', '', '', true]));
const ds = ss.insertSheet('Блюда');
ds.appendRow(['Код', 'Название', 'Категория', 'Выход', '', 'Технология', '', '', 'Цех', '', '', '', 'Выход, г/мл/шт', 'Ед. выхода']);
ds.appendRow(['D002', 'Салат с тунцом', 'Салаты', 220, '', '', '', '', 'Холодный цех', '', '', '', 220, 'г']);
const pr = ss.insertSheet('Цены_Меню'); pr.appendRow(['PriceID', 'DishCode', 'DishName', 'Price', 'Unit', 'Source', 'EventID', 'DateFrom', 'DateTo', 'Status']);
pr.appendRow(['P2', 'D002', '', 790, 'порц.', 'MENU', '', '2026-11-01', '', 'ACTIVE']);
const tv = ss.insertSheet('ТТК_Версии'); tv.appendRow(['Код блюда', 'Версия', 'Статус']); tv.appendRow(['D002', 1, 'действующая']);
const J = s => (typeof s === 'string' ? JSON.parse(s) : s), tok = pin => J(C.loginWithPin(pin, 'dev-' + pin)).token;
const DIR = tok('1111'), WAI = tok('3333'), CHEF = tok('7777');
let n = 0; const k = () => 'cons-key-' + (++n);
const call = (fn, t, d) => { C._mcRcDrop_(); C._BOOK_CACHE_ = null; const r = J(C[fn](JSON.stringify(d), t)); assert.ok(r.success === true || r.ok === true, fn + ': ' + JSON.stringify(r).slice(0, 300)); return r.data; };
const hall = call('rsHallSave', DIR, { idem: k(), name: 'Зал', width: 6, height: 4 });
const t7 = call('rsTableSave', DIR, { idem: k(), hallId: hall.id, number: '7', x: 1, y: 1, seatsMax: 4 });
const o = call('rsOrderOpen', WAI, { idem: k(), tableId: t7.id, guests: 2 }).orderId;
call('rsItemAdd', WAI, { idem: k(), orderId: o, items: [{ code: 'D002', qty: 1 }] });
call('rsOrderSend', WAI, { idem: k(), orderId: o, mode: 'all' });

console.log('Restaurant Service в главном окне');
// сервер: разметка экрана — только по праву на экран
(() => {
  C._mcRcDrop_();
  const a = J(C.rsViewSource(JSON.stringify({ name: 'kds' }), CHEF)); assert.ok(a.success && /<body/.test(a.data.src) && a.data.map.rsKdsData === 1, 'кухня получает экран кухни');
  const b = J(C.rsViewSource(JSON.stringify({ name: 'roles' }), CHEF)); assert.ok(!b.success, 'повару редактор ролей не отдаётся');
  const c = J(C.rsViewSource(JSON.stringify({ name: 'Code' }), DIR)); assert.ok(!c.success, 'произвольный файл не отдаётся');
  ok('сервер: экран отдаётся только по праву на него, другие файлы — нет');
})();
(() => {
  ['hall', 'kds', 'menuedit', 'roles'].forEach(m => { const out = C.doGet({ parameter: { [m]: '1', token: DIR } }); assert.strictEqual(out.getTitle(), 'MON CHEF', m); assert.ok(out.getContent().includes('OPENV="' + m + '"'), m + ': главное окно сразу на экране'); });
  const g = C.doGet({ parameter: { menu: '1' } }); assert.notStrictEqual(g.getTitle(), 'MON CHEF'); assert.ok(!/id="app"/.test(g.getContent()), 'гостевое меню без главного окна');
  ok('старые адреса ?hall=1, ?kds=1, ?menuedit=1, ?roles=1 — главное окно на экране; ?menu=1 — отдельная страница гостя');
})();

async function open(browser, html, vp, calls) {
  const page = await browser.newPage({ viewport: vp, timezoneId: 'Asia/Yekaterinburg', deviceScaleFactor: shots ? 2 : 1 });
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept());
  await page.exposeFunction('__srv', (fn, args) => { calls.push(fn); C._mcRcDrop_(); C._BOOK_CACHE_ = null; const r = C[fn].apply(null, args); return r === undefined ? null : r; });
  await page.addInitScript(() => {
    const runner = st => new Proxy({}, { get: (_, key) => {
      if (key === 'withSuccessHandler') return f => runner(Object.assign({}, st, { ok: f }));
      if (key === 'withFailureHandler') return f => runner(Object.assign({}, st, { fail: f }));
      if (key === 'withUserObject') return () => runner(st);
      return (...args) => { window.__srv(key, args).then(r => st.ok && st.ok(r), e => st.fail && st.fail(e)); };
    } });
    window.google = { script: { run: runner({}) } };
  });
  await page.route('http://monchef.test/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto('http://monchef.test/exec'); await page.addStyleTag({ content: '#mcxScreen{display:none!important}' });
  return { page, errs };
}

(async () => {
  const browser = await chromium.launch();
  // 1) директор: главное окно → «Зал» → «Зал и бронирование» — без перезагрузки страницы
  const calls = [];
  const { page, errs } = await open(browser, C.doGet({ parameter: { token: DIR } }).getContent(), { width: 1280, height: 800 }, calls);
  await page.waitForSelector('#nav button[data-s="hall"]');
  await page.evaluate(() => { window.__mark = 'same-page'; });
  await page.click('#nav button[data-s="hall"]');
  await page.click('#content button:has-text("Зал и бронирование")');
  await page.waitForSelector('#rshost .tbl');
  assert.strictEqual(await page.evaluate(() => window.__mark), 'same-page', 'переход без перезагрузки');
  assert.ok(await page.isVisible('#nav'), 'меню главного окна на месте');
  assert.strictEqual(await page.textContent('.mvhead h1'), 'Зал и бронирование');
  assert.strictEqual(await page.evaluate(() => typeof window.S + '/' + typeof window.pickT + '/' + /d\.title/.test(String(window.render))), 'undefined/undefined/true', 'функции экрана не попали в главное окно');
  if (shots) await page.screenshot({ path: shots + '/console-hall.png' });
  ok('директор: «Зал» → «Зал и бронирование» — экран внутри главного окна, без перезагрузки; функции экрана изолированы');
  // 2) «Назад» — экран снят (таймеры остановлены), раздел на месте; другой экран — редактор ролей, гостевое меню
  await page.click('.mvback'); await page.waitForSelector('#content .kpis, #content .head');
  assert.strictEqual(await page.evaluate(() => RSV.cur), null);
  await page.evaluate(() => openView('roles')); await page.waitForSelector('#rshost select, #rshost .card');
  await page.evaluate(() => openView('menuedit')); await page.waitForSelector('#rshost .tabs button');
  ok('«Назад» и переход между экранами: прежний экран снимается');
  assert.deepStrictEqual(errs, [], 'ошибки страницы: ' + errs.join('; '));
  await page.close();

  // 3) повар: старый адрес ?kds=1 → главное окно на экране кухни; автообновление; «На весь экран»; уход — автообновление остановлено
  const kc = [];
  const kd = await open(browser, C.doGet({ parameter: { kds: '1', token: CHEF } }).getContent(), { width: 1024, height: 768 }, kc);
  await kd.page.waitForSelector('#rshost .tk');
  assert.ok(await kd.page.isVisible('#nav'));
  await kd.page.click('.mvhead button:has-text("На весь экран")');
  assert.ok(await kd.page.evaluate(() => document.body.classList.contains('rskiosk')) && !(await kd.page.isVisible('.side')) && await kd.page.isVisible('#rskx'), 'полноэкранный режим кухни');
  if (shots) await kd.page.screenshot({ path: shots + '/console-kds-full.png' });
  await kd.page.waitForTimeout(11000);
  const polled = kc.filter(f => f === 'rsGen' || f === 'rsKdsData').length; assert.ok(polled >= 2, 'автообновление кухни работает: ' + polled);
  await kd.page.click('#rskx'); assert.ok(await kd.page.isVisible('.side'), 'выход из полноэкранного');
  await kd.page.click('.mvback'); await kd.page.waitForTimeout(300);
  const after = kc.length; await kd.page.waitForTimeout(11000);
  assert.strictEqual(kc.slice(after).filter(f => f === 'rsGen' || f === 'rsKdsData').length, 0, 'после ухода с экрана кухня не опрашивается');
  assert.deepStrictEqual(kd.errs, []);
  ok('повар: ?kds=1 → главное окно на экране кухни; «На весь экран» и выход; автообновление останавливается при уходе с экрана');
  await browser.close();
  console.log('Итого: ' + pass + ' пройдено, 0 не пройдено');
})().catch(e => { console.error('✗', e.message); process.exit(1); });
