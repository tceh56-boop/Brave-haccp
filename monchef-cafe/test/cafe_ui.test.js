/**
 * Экраны MON CHEF · Кафе в настоящем браузере (Chromium, Playwright): node test/cafe_ui.test.js [папка для снимков]
 * Console.html открывается как есть; google.script.run — мост в мок-сервер (тот же, что в cafe_e2e.test.js,
 * с данными сквозного сценария). Ключ входа добавляется так же, как на сервере (служебный аргумент {__mct}).
 */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const { chromium } = require('playwright');
const shotsDir = process.argv[2] || '';
const S = require('./cafe_e2e.test.js');
const g = S.g;

(async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'Console.html'), 'utf8');
  const browser = await chromium.launch();
  let passed = 0;
  const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ✓ ' + m); };
  async function session(token, who) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
    await page.exposeFunction('__gas', (fn, argsJson) => {
      const args = JSON.parse(argsJson);
      if (typeof g[fn] !== 'function') return JSON.stringify({ e: 'нет функции ' + fn });
      try { const r = g[fn].apply(null, args.concat([{ __mct: token, __mcn: args.length }])); return JSON.stringify({ v: r === undefined ? null : r }); }
      catch (e) { return JSON.stringify({ e: String(e && e.message || e) }); }
    });
    await page.route('**/*', r => r.request().url().startsWith('http://cafe.test/') ? r.continue() : r.abort());
    await page.addInitScript(tok => {
      try { localStorage.setItem('mc_token', tok); sessionStorage.setItem('mc_intro', '1'); } catch (e) {}
      const mk = st => new Proxy({}, { get: (_, k) => {
        if (k === 'withSuccessHandler') return f => mk(Object.assign({}, st, { ok: f }));
        if (k === 'withFailureHandler') return f => mk(Object.assign({}, st, { fail: f }));
        if (k === 'withUserObject') return () => mk(st);
        return function () { const a = [].slice.call(arguments); window.__gas(k, JSON.stringify(a)).then(s => { const r = JSON.parse(s); if (r.e) { if (st.fail) st.fail(new Error(r.e)); } else if (st.ok) st.ok(r.v); }); };
      } });
      window.google = { script: { run: mk({}), host: { close() {} } } };
    }, token);
    await page.route('http://cafe.test/', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
    await page.goto('http://cafe.test/');
    await page.waitForFunction(() => document.querySelector('#nav button'), null, { timeout: 15000 });
    const nav = await page.$$eval('#nav button', b => b.map(x => x.textContent.trim()));
    console.log(who + ': меню — ' + nav.join(' · '));
    return { page, errors, nav };
  }
  const waitBody = (page, re) => page.waitForFunction(r => new RegExp(r, 'i').test(document.getElementById('content').innerText), re.source, { timeout: 15000 });
  const shot = async (page, name) => { if (shotsDir) await page.screenshot({ path: path.join(shotsDir, name + '.png'), fullPage: true }); };

  // Директор
  let { page, errors, nav } = await session(S.tokens.dir, 'Директор');
  ok(nav.indexOf('Банкеты') < 0 && nav.indexOf('Продажи') >= 0 && nav.indexOf('Экономика') >= 0 && nav.indexOf('Аудит предприятия') >= 0, 'меню кафе: без банкетов; продажи, экономика, аудит');
  await waitBody(page, /Выручка сегодня/); ok(true, 'главная: плитка «Выручка сегодня»'); await shot(page, '01_home');
  for (const [sec, re] of [['cafesales', /Позиции за месяц/], ['cafeplan', /Остатки и нормы/], ['economics', /Прибыли и убытки/], ['entaudit', /Находки/]]) {
    await page.evaluate(s => openSec(s), sec); await waitBody(page, re); ok(true, 'раздел ' + sec); await shot(page, '02_' + sec);
  }
  for (const [v, re] of [['cafesale', /Позиции меню/], ['cafeprices', /Сохранить прайс/], ['cafegaps', /Расхождени/], ['cafenorms', /Прогноз на завтра/], ['cafeexpenses', /Статьи расходов/], ['cafepnl', /Меню-инжиниринг/], ['cafeaudit', /Разделы/]]) {
    await page.evaluate(x => openView(x), v); await waitBody(page, re); ok(true, 'экран ' + v); await shot(page, '03_' + v);
  }
  // расход через форму
  await page.evaluate(() => openView('cafeexpenses')); await waitBody(page, /Новый расход/);
  await page.selectOption('#mvf_ea', 'UTIL_EL'); await page.fill('#mvf_es', '12345'); await page.fill('#mvf_edoc', 'счёт 77');
  await page.click('button[data-mv="add"]'); await page.waitForFunction(() => /Расход РХ-/.test(document.getElementById('vmsg').textContent), null, { timeout: 15000 });
  ok(true, 'расход внесён через форму: ' + await page.textContent('#vmsg'));
  // аудит из экрана
  await page.evaluate(() => openView('cafeaudit')); await waitBody(page, /Провести аудит/);
  await page.click('button[data-mv="run"]'); await page.waitForFunction(() => /Аудит проведён/.test(document.getElementById('vmsg').textContent), null, { timeout: 20000 });
  ok(true, 'аудит из экрана: ' + await page.textContent('#vmsg')); await shot(page, '04_audit_run');
  ok(errors.length === 0, 'ошибок JavaScript нет' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await page.close();

  // Администратор: продажа через форму ввода по позициям
  ({ page, errors, nav } = await session(S.tokens.adm, 'Администратор'));
  ok(nav.indexOf('Продажи') >= 0 && nav.indexOf('Экономика') < 0, 'администратор: продажи есть, экономики нет');
  await page.evaluate(() => openView('cafesale')); await waitBody(page, /Позиции меню/);
  await page.fill('.cfq[data-c="D1"]', '2');
  await page.fill('#mvf_cxn', 'Вода питьевая 0,5'); await page.fill('#mvf_cxq', '1'); await page.fill('#mvf_cxp', '80'); await page.click('button[data-mv="addx"]');
  const total = await page.textContent('#cftotal');
  ok(/Позиций: 2/.test(total) && /980/.test(total.replace(/\s/g, '')), 'итог формы считается на лету: ' + total);
  await shot(page, '05_sale_form');
  await page.click('button[data-mv="post"]');
  await page.waitForFunction(() => /Проведено ПР-/.test(document.getElementById('vmsg').textContent), null, { timeout: 20000 });
  ok(true, 'продажа проведена из формы: ' + await page.textContent('#vmsg'));
  await waitBody(page, /Паста с томатным соусом/); await shot(page, '06_sale_done');
  ok(errors.length === 0, 'ошибок JavaScript нет' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await page.close();

  // Повар: план по остаткам, без продаж и экономики
  ({ page, errors, nav } = await session(S.tokens.cook, 'Повар'));
  ok(nav.indexOf('План по остаткам') >= 0 && nav.indexOf('Продажи') < 0 && nav.indexOf('Экономика') < 0, 'повар: план по остаткам есть, продаж и экономики нет');
  await page.evaluate(() => openView('cafenorms')); await waitBody(page, /Задачи по остаткам/); ok(true, 'повар видит задачи по остаткам');
  // мобильная ширина
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => openSec('cafeplan')); await waitBody(page, /План по остаткам/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overflow <= 1, 'телефон (390 px): без горизонтальной прокрутки страницы (' + overflow + ')'); await shot(page, '07_mobile_plan');
  ok(errors.length === 0, 'ошибок JavaScript нет' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log('\nИнтерфейс: проверок пройдено ' + passed);
})().catch(e => { console.error(e); process.exit(1); });
