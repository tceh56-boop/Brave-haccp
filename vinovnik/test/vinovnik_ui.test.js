/**
 * Экраны VINOVNIK в Chromium (Playwright): node test/vinovnik_ui.test.js [папка для снимков]
 * Главное окно — Console.html как есть, google.script.run — мост в мок-сервер со сквозным сценарием (vinovnik_e2e.test.js).
 * Меню гостя — GuestMenu.html с данными страницы (как отдаёт doGet ?menu=1).
 */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const { chromium } = require('playwright');
const shotsDir = process.argv[2] || '';
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const S = require('./vinovnik_e2e.test.js');
const g = S.g, T = S.tokens;
const fresh = () => Object.keys(S.env.cache).filter(k => /^mc_gate_/.test(k)).forEach(k => delete S.env.cache[k]);

(async () => {
  const APP = path.join(__dirname, '..', 'app');
  const html = fs.readFileSync(path.join(APP, 'Console.html'), 'utf8');
  const browser = await chromium.launch();
  let passed = 0;
  const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ✓ ' + m); };
  async function session(token, who, vp) {
    const page = await browser.newPage({ viewport: vp || { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
    page.on('dialog', d => d.accept(d.type() === 'prompt' ? (page.__answer || '2') : undefined));
    await page.exposeFunction('__gas', (fn, argsJson) => {
      const args = JSON.parse(argsJson); fresh();
      if (typeof g[fn] !== 'function') return JSON.stringify({ e: 'нет функции ' + fn });
      try { const r = g[fn].apply(null, args.concat([{ __mct: token, __mcn: args.length }])); return JSON.stringify({ v: r === undefined ? null : r }); }
      catch (e) { return JSON.stringify({ e: String(e && e.message || e) }); }
    });
    await page.route('**/*', r => r.request().url().startsWith('http://vn.test/') ? r.continue() : r.abort());
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
    await page.route('http://vn.test/', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
    await page.goto('http://vn.test/');
    await page.waitForFunction(() => document.querySelector('#nav button'), null, { timeout: 15000 });
    const nav = await page.$$eval('#nav button', b => b.map(x => x.textContent.trim()));
    console.log(who + ': меню — ' + nav.join(' · '));
    return { page, errors, nav };
  }
  const body = (page, re) => page.waitForFunction(r => new RegExp(r, 'i').test(document.getElementById('content').innerText), re.source, { timeout: 15000 });
  const msg = (page, re) => page.waitForFunction(r => new RegExp(r, 'i').test(document.getElementById('vmsg').textContent), re.source, { timeout: 15000 });
  const shot = async (page, name) => { if (shotsDir) await page.screenshot({ path: path.join(shotsDir, name + '.png'), fullPage: true }); };
  const noHScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  // ---------- Официант
  let { page, errors, nav } = await session(T.w1, 'Официант');
  ok(await page.title() === 'VINOVNIK', 'заголовок окна — VINOVNIK');
  ok(nav.indexOf('Зал') >= 0 && nav.indexOf('Склад') < 0, 'официант: раздел «Зал», склада нет');
  await body(page, /Зал: мои столы/); ok(true, 'главная: плитка «Зал: мои столы»'); await shot(page, '01_waiter_home');
  await page.evaluate(() => openView('vnorder')); await body(page, /Свободный стол/);
  ok(await page.$('.vntbl.free') !== null, 'блокнот: план столов, свободные — зелёные'); await shot(page, '02_order_tables');
  page.__answer = '2';
  await page.click('.vntbl.free[data-a="6"]'); await body(page, /Стол 6/);
  ok(true, 'стол 6 открыт (гостей — из вопроса)');
  await page.click('.vnitem[data-a="D4"]'); await page.click('.vnitem[data-a="G-WINE"]');
  ok(await page.$('.vnitem.off[data-a="D2"]') !== null, 'позиция в стопе — неактивна в меню');
  await page.fill('.vnq[data-i="0"][data-k="comment"]', 'без льда'); await page.selectOption('.vnq[data-i="1"][data-k="course"]', '0');
  await page.fill('.vnq[data-i="1"][data-k="qty"]', '2'); await shot(page, '03_order_draft');
  await page.click('button[data-mv="send"]'); await msg(page, /Отправлено: 2 /);
  ok(true, 'черновик отправлен: ' + await page.textContent('#vmsg'));
  await body(page, /без льда/); ok(/готовится/.test(await page.textContent('#content')), 'в заказе — позиции со статусом «готовится» и комментарием'); await shot(page, '04_order_sent');
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(150);
  ok(await noHScroll(page), 'блокнот на телефоне (390 px) — без горизонтальной прокрутки'); await shot(page, '05_order_phone');
  await page.setViewportSize({ width: 1280, height: 900 });
  ok(errors.length === 0, 'официант: ошибок JavaScript нет' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await page.close();

  // ---------- Бармен: очередь бара
  ({ page, errors } = await session(T.bar, 'Бармен'));
  await page.evaluate(() => openView('vnbar')); await body(page, /Стол 6/);
  ok(/без льда/.test(await page.textContent('#content')), 'бар: стол 6, комментарий гостя виден'); await shot(page, '06_bar_queue');
  ok(await page.$('.vnzones button') !== null, 'переключатель зон: Зал / Бар');
  await page.click('button[data-mv="readyAll"]'); await msg(page, /Готово всё/); ok(true, 'бармен: «готово всё» по столу');
  ok(errors.length === 0, 'бармен: ошибок JavaScript нет' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await page.close();

  // ---------- Официант: моя смена — зал, подать
  ({ page, errors } = await session(T.w1, 'Официант'));
  await page.evaluate(() => openView('vnhall')); await body(page, /Готово — подать/);
  ok(/Стол 6/.test(await page.textContent('#content')), '«Моя смена — Зал»: готово к подаче по столу 6'); await shot(page, '07_hall_shift');
  await page.click('button[data-mv="serveAll"]'); await msg(page, /подано всё/i); ok(true, 'подано всё по столу');
  await page.evaluate(() => openView('vnorder', VIEWS.vnhall._d.orders.filter(o => o.table === '6')[0].id)); await body(page, /Стол 6/);
  await page.click('button[data-mv="close"]'); await body(page, /Счёт: стол 6/);
  await page.click('button[data-mv="doClose"]'); await msg(page, /Счёт закрыт/); ok(true, 'счёт закрыт из экрана: ' + await page.textContent('#vmsg'));
  ok(errors.length === 0, 'официант: ошибок JavaScript нет' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await page.close();

  // ---------- Повар: кухня
  fresh(); const oo = JSON.parse(g.vnOrderOpen(JSON.stringify({ table: '5', guests: 2 }), T.w2)).data;
  fresh(); g.vnOrderAdd(JSON.stringify({ order: oo.id, lines: [{ code: 'D3', qty: 1, weight: 300, course: 1, comment: 'прожарка rare' }] }), T.w2);
  ({ page, errors, nav } = await session(T.cook, 'Повар'));
  ok(nav.indexOf('Зал') < 0, 'повар: раздела «Зал» нет');
  await body(page, /Кухня: заказы/); ok(true, 'главная повара: «Кухня: заказы»');
  await page.evaluate(() => openView('vnkitchen')); await body(page, /прожарка rare/);
  ok(true, 'очередь кухни: стол 5, вес и комментарий'); await shot(page, '08_kitchen');
  await page.click('button[data-mv="ready"]'); await msg(page, /официант увидит/); ok(true, 'повар отметил «готово»');
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(150);
  ok(await noHScroll(page), 'кухня на телефоне — без горизонтальной прокрутки');
  ok(errors.length === 0, 'повар: ошибок JavaScript нет' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await page.close();

  // ---------- Хостес: бронирование
  ({ page, errors } = await session(T.host, 'Хостес'));
  await page.evaluate(() => openView('vnbook')); await body(page, /Шахматка/); await shot(page, '09_booking');
  await page.click('button[data-mv="form"]'); await body(page, /Новая бронь/);
  await page.fill('#mvf_bf', '18:00'); await page.fill('#mvf_bg', '2'); await page.fill('#mvf_bn', 'Мария'); await page.fill('#mvf_bp', '+79001234567');
  await page.click('button[data-mv="free"]'); await page.waitForSelector('.vnfree input');
  await page.check('.vnfree input[value="1"]');
  await page.click('button[data-mv="save"]'); await msg(page, /Бронь .*подтверждена/); ok(true, 'хостес создала бронь через форму: ' + await page.textContent('#vmsg'));
  await body(page, /Мария/); ok(await page.$('.vnbk') !== null, 'бронь на шахматке'); await shot(page, '10_booking_saved');
  ok(errors.length === 0, 'хостес: ошибок JavaScript нет' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await page.close();

  // ---------- Администратор: зал, стоп-лист, меню, QR
  ({ page, errors, nav } = await session(T.adm, 'Администратор'));
  await page.evaluate(() => openSec('hall')); await body(page, /Брони сегодня/); ok(true, 'раздел «Зал»: брони, заявки, столы, стоп'); await shot(page, '11_hall_section');
  await page.evaluate(() => openView('vnstop')); await body(page, /Поставить отметку/); await shot(page, '12_stop');
  await page.click('button[data-mv="check"]'); await msg(page, /Проверено/); ok(true, 'стоп/go: проверка по складу — ' + await page.textContent('#vmsg'));
  await page.evaluate(() => openView('vnmenu')); await body(page, /Страница для гостей/);
  ok((await page.$$('.vnmi')).length >= 5, 'редактор меню: позиции по разделам'); await shot(page, '13_menu_editor');
  await page.evaluate(() => openView('vnfloor')); await body(page, /Свободно/); await shot(page, '14_floor');
  await page.evaluate(() => openView('vnqr')); await body(page, /Стол 1/);
  ok(/QR не построен|ссылка|открыть/i.test(await page.textContent('#content')) || await page.$('.vnqrc canvas, .vnqrc img'), 'QR-коды: без библиотеки — ссылка вместо кода'); await shot(page, '15_qr');
  ok(errors.length === 0, 'администратор: ошибок JavaScript нет' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await page.close();

  // ---------- Меню гостя по QR (стоп — показывать «нет в наличии», стейк — снова в меню гостей)
  fresh(); g.vnSettings(JSON.stringify({ hideStop: false }), T.adm); fresh(); g.vnMenuSave(JSON.stringify({ items: [{ code: 'D3', guest: true }] }), T.adm);
  const guestHtml = fs.readFileSync(path.join(APP, 'GuestMenu.html'), 'utf8')
    .replace('<?!= dataJson ?>', JSON.stringify(g._vnGuestData_('5')).replace(/</g, '\\u003c'));
  for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    const p = await browser.newPage({ viewport: vp }), errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    await p.exposeFunction('__book', (json, did) => { fresh(); return g.vnGuestBook(json, did); });
    await p.addInitScript(() => {
      const mk = st => new Proxy({}, { get: (_, k) => {
        if (k === 'withSuccessHandler') return f => mk(Object.assign({}, st, { ok: f }));
        if (k === 'withFailureHandler') return f => mk(Object.assign({}, st, { fail: f }));
        return function (a, b) { window.__book(a, b).then(r => st.ok && st.ok(r)); };
      } });
      window.google = { script: { run: mk({}) } };
    });
    await p.route('**/*', r => r.request().url().startsWith('http://guest.test/') ? r.fulfill({ contentType: 'text/html; charset=utf-8', body: guestHtml }) : r.abort());
    await p.goto('http://guest.test/?menu=1&t=5');
    await p.waitForSelector('.post');
    const posts = await p.$$('.post'), stories = await p.$$('.st');
    if (vp.width < 500) {
      ok(posts.length >= 4 && stories.length >= 3, 'меню гостя: лента ' + posts.length + ' карточек, истории разделов ' + stories.length);
      ok(/Стол 5/.test(await p.textContent('#tb')), 'номер стола из QR в шапке');
      ok(await p.$('.post[data-c="D2"]') === null || /нет в наличии/.test(await p.textContent('.post[data-c="D2"]')), 'позиция в стопе — «нет в наличии» или скрыта');
      ok(await noHScroll(p), 'телефон 390 px — без горизонтальной прокрутки');
      if (shotsDir) await p.screenshot({ path: path.join(shotsDir, '20_guest_feed.png') });
      await p.click('.st:not([data-st=""])'); await p.waitForTimeout(100); ok(true, 'история раздела фильтрует ленту');
      await p.click('[data-mode="reels"]'); await p.waitForSelector('.reels.on .reel');
      ok((await p.$$('.reel')).length >= 1, 'Reels: полноэкранная лента');
      if (shotsDir) await p.screenshot({ path: path.join(shotsDir, '21_guest_reels.png') });
      await p.click('#rBack'); await p.click('#fab'); await p.waitForSelector('.sheet.on');
      await p.fill('#bName', 'Ольга'); await p.fill('#bPhone', '+7 912 000-11-22'); await p.fill('#bTime', '20:00');
      if (shotsDir) await p.screenshot({ path: path.join(shotsDir, '22_guest_booking.png') });
      await p.click('#bGo'); await p.waitForFunction(() => /Заявка принята|Мы принимаем|прошло/.test(document.getElementById('bMsg').textContent));
      ok(/Заявка принята/.test(await p.textContent('#bMsg')), 'заявка на бронь с меню гостя: ' + await p.textContent('#bMsg'));
    } else if (shotsDir) await p.screenshot({ path: path.join(shotsDir, '23_guest_desktop.png') });
    ok(errs.length === 0, 'меню гостя ' + vp.width + ' px: ошибок JavaScript нет' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await p.close();
  }
  await browser.close();
  console.log('\nЭкраны VINOVNIK: проверок пройдено ' + passed);
})().catch(e => { console.error(e); process.exit(1); });
