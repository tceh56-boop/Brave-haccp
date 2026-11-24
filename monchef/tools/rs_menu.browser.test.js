// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
// Restaurant Service, этап 5: гостевое меню (Reels) на телефоне и компьютере, заявка гостя, редактор меню, редактор ролей — в браузере.
// Запуск: node monchef/tools/rs_menu.browser.test.js [папка для снимков]
const assert = require('assert');
const { chromium } = require('playwright');
const { boot } = require('./gasemu');
const shots = process.argv[2] || '';

async function pngOf(browser, css, w, h) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  await p.setContent('<body style="margin:0"><div style="width:' + w + 'px;height:' + h + 'px;' + css + '"></div>');
  const b = await p.screenshot(); await p.close(); return b;
}
function env() {
  const E = boot({ now: '2026-11-25T08:00:00Z' }), C = E.ctx, ss = E.ss, files = {}, folders = {}; let n = 0;
  const mk = name => { const id = 'F' + (++n), f = { kids: {} };
    f.api = { getId: () => id, createFolder: x => { const k = mk(x); f.kids[x] = k; return k.api; }, getFoldersByName: x => { let u = false; return { hasNext: () => !u && !!f.kids[x], next: () => { u = true; return f.kids[x].api; } }; },
      createFile: b => { const id2 = 'FILE' + (++n); files[id2] = { bytes: Buffer.from(b.getBytes().map(v => (v < 0 ? v + 256 : v))), mime: b.getContentType() }; return { getId: () => id2 }; } };
    folders[id] = f; return f; };
  C.DriveApp = { createFolder: x => mk(x).api, getFolderById: id => folders[id].api,
    getFileById: id => ({ getBlob: () => ({ getBytes: () => Array.from(files[id].bytes), getContentType: () => files[id].mime }), setTrashed: () => {} }) };
  const emp = ss.insertSheet('Сотрудники');
  emp.appendRow(['Фамилия', 'Имя', 'Отчество', 'Должность', 'Роль', 'ДР', 'Телефон', 'Адрес', 'ПИН-код', '', '', '', 'Активен']);
  emp.appendRow(['Директорова', 'Анна', '', 'Директор', 'Директор', '', '', '', '1111', '', '', '', true]);
  const ds = ss.insertSheet('Блюда');
  ds.appendRow(['Код', 'Название', 'Категория', 'Выход', '', '', '', '', 'Цех', '', '', '', 'Выход, г/мл/шт', 'Ед. выхода']);
  [['D002', 'Сырная тарелка', 'Закуски', 'Холодный цех', 250, 'г'], ['D003', 'Тартар из говядины', 'Закуски', 'Холодный цех', 180, 'г'], ['B001', 'Негрони', 'Коктейли', 'Бар', 120, 'мл']]
    .forEach(r => ds.appendRow([r[0], r[1], r[2], r[4], '', '', '', '', r[3], '', '', '', r[4], r[5]]));
  const so = ss.insertSheet('Состав'); so.appendRow(['Код', 'Продукт', '', '', 'Брутто', 'Нетто', 'Выход', 'Ед.']);
  [['D002', 'Сыр пармезан'], ['D002', 'Мёд'], ['D002', 'Грецкий орех'], ['D003', 'Говядина вырезка'], ['D003', 'Каперсы'], ['B001', 'Джин'], ['B001', 'Кампари'], ['B001', 'Вермут красный']].forEach(r => so.appendRow([r[0], r[1], '', '', 50, 50, 50, 'г']));
  const pr = ss.insertSheet('Цены_Меню'); pr.appendRow(['PriceID', 'DishCode', 'DishName', 'Price', 'Unit', 'Source', 'EventID', 'DateFrom', 'DateTo', 'Status']);
  [['P2', 'D002', 890], ['P3', 'D003', 760], ['P6', 'B001', 700]].forEach(r => pr.appendRow([r[0], r[1], '', r[2], 'порц.', 'MENU', '', '2026-11-01', '', 'ACTIVE']));
  C.calculateKBZHU = c => JSON.stringify(c === 'D002' ? { perPortion: { kcal: 612, protein: 38.5, fat: 41.2, carbs: 18.4 }, hasMissingData: false } : { hasMissingData: true });
  const DIR = JSON.parse(C.loginWithPin('1111', 'dev-d')).token;
  return { E, C, ss, DIR };
}
async function open(browser, C, html, vp, url) {
  const page = await browser.newPage({ viewport: vp, timezoneId: 'Asia/Yekaterinburg', deviceScaleFactor: shots ? 2 : 1, hasTouch: vp.width < 600, isMobile: vp.width < 600 });
  page.__errors = []; page.on('pageerror', e => page.__errors.push(e.message)); page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'проверка' : undefined));
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
  await page.route('http://monchef.test/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto('http://monchef.test/exec' + url); await page.addStyleTag({ content: '#mcxScreen{display:none!important}' });
  return page;
}

(async () => {
  const browser = await chromium.launch();
  const { C, ss, DIR } = env();
  let k = 0; const key = () => 'br5-key-' + (++k);
  const J = s => JSON.parse(s), up = (code, bytes, mime) => {
    const st = J(C.rsMediaUploadStart(JSON.stringify({ code, name: code + '.png', mime, size: bytes.length }), DIR)).data;
    for (let i = 0; i < st.parts; i++) J(C.rsMediaUploadPart(JSON.stringify({ uploadId: st.uploadId, index: i, data: bytes.slice(i * st.chunk, (i + 1) * st.chunk).toString('base64') }), DIR));
    return J(C.rsMediaUploadFinish(JSON.stringify({ idem: key(), uploadId: st.uploadId }), DIR)).data.media;
  };
  up('D002', await pngOf(browser, 'background:radial-gradient(circle at 40% 35%,#f6d98b,#c98a2e 45%,#3a2412)', 360, 640), 'image/png');
  up('D003', await pngOf(browser, 'background:linear-gradient(160deg,#7a1f1f,#2b0d0d 70%)', 360, 640), 'image/png');
  up('B001', await pngOf(browser, 'background:radial-gradient(circle at 50% 60%,#e2492f,#5a0d12 60%,#120406)', 360, 640), 'image/png');
  ['D002', 'D003', 'B001'].forEach((c, i) => { const r = J(C.rsMenuSave(JSON.stringify({ idem: key(), code: c, description: ['Пармезан, мёд и грецкий орех', 'Рубленая вырезка с каперсами', 'Классика: джин, кампари, вермут'][i], order: i, action: 'publish' }), DIR)); assert.ok(r.success, JSON.stringify(r)); });
  const hall = J(C.rsHallSave(JSON.stringify({ idem: key(), name: 'Зал', width: 6, height: 4 }), DIR)).data;
  J(C.rsTableSave(JSON.stringify({ idem: key(), hallId: hall.id, number: '7', x: 1, y: 1, seatsMax: 4 }), DIR));
  J(C.rsMenuSettings(JSON.stringify({ idem: key(), guestOrder: true, title: 'MON CHEF' }), DIR));
  const qr = J(C.rsHallData('{}', DIR)).data.tables[0].qr;
  const guestHtml = C.doGet({ parameter: { menu: '1' } }).getContent();
  assert.ok(!/mcback|__MC_TOKEN/.test(guestHtml), 'гостевая страница без служебной обвязки и ключа');

  // телефон: лента, медиа через приложение, подробности, заявка официанту
  const ph = await open(browser, C, guestHtml, { width: 390, height: 844 }, '?menu=1&t=' + qr);
  await ph.waitForSelector('.reel');
  await ph.waitForSelector('.reel img', { timeout: 15000 });
  assert.strictEqual(await ph.$$eval('.reel', e => e.length), 3);
  assert.ok(/^blob:/.test(await ph.$eval('.reel img', i => i.src)), 'картинка собрана из частей, не ссылка на Drive');
  if (shots) await ph.screenshot({ path: shots + '/menu-phone-reel.png' });
  await ph.click('.reel[data-id="D002"] .btn.ghost');
  await ph.waitForSelector('.kb');
  const det = await ph.textContent('#sheet');
  assert.ok(/Сыр пармезан, Мёд, Грецкий орех/.test(det) && /612/.test(det), 'состав без граммовок и КБЖУ');
  if (shots) await ph.screenshot({ path: shots + '/menu-phone-details.png' });
  await ph.click('#sheet .btn.gold');
  await ph.click('#cartBtn');
  await ph.click('#send');
  await ph.waitForSelector('#cmsg .msg.ok');
  if (shots) await ph.screenshot({ path: shots + '/menu-phone-cart.png' });
  assert.strictEqual(ss.getSheetByName('ГостевыеЗаявки_V1').getLastRow(), 2, 'одна заявка');
  assert.deepStrictEqual(ph.__errors, []);
  // компьютер: каталог
  const pc = await open(browser, C, guestHtml, { width: 1280, height: 800 }, '?menu=1');
  await pc.waitForSelector('.reel img', { timeout: 15000 });
  const cols = await pc.$eval('.feed', f => getComputedStyle(f).gridTemplateColumns.split(' ').length);
  assert.ok(cols >= 3, 'каталог в несколько колонок: ' + cols);
  assert.strictEqual(await pc.$$eval('.feed .btn.gold', e => e.length), 0, 'по общей ссылке — только просмотр');
  if (shots) await pc.screenshot({ path: shots + '/menu-desktop.png' });
  assert.deepStrictEqual(pc.__errors, []);
  // редактор меню
  const edHtml = C.doGet({ parameter: { menuedit: '1', token: DIR } }).getContent();
  const ed = await open(browser, C, edHtml, { width: 1024, height: 768 }, '?menuedit=1');
  await ed.waitForSelector('.card .row');
  await ed.click('.card .row:has-text("Сырная тарелка")');
  await ed.waitForSelector('#e_desc');
  await ed.click('button:has-text("Предпросмотр")');
  await ed.waitForSelector('.phone img', { timeout: 15000 });
  if (shots) await ed.screenshot({ path: shots + '/menu-editor.png', fullPage: true });
  await ed.click('.tabs button:has-text("QR-коды")');
  await ed.waitForSelector('.qr svg');
  assert.strictEqual(await ed.$$eval('.qr', e => e.length), 2, 'общий QR и QR стола 7');
  assert.deepStrictEqual(ed.__errors, []);
  // редактор ролей
  const rlHtml = C.doGet({ parameter: { roles: '1', token: DIR } }).getContent();
  const rl = await open(browser, C, rlHtml, { width: 390, height: 844 }, '?roles=1');
  await rl.waitForSelector('.perm');
  await rl.selectOption('select', 'Официант');
  await rl.check('.perm:has-text("Бронирование — создание") input');
  await rl.fill('#why', 'официант принимает брони по телефону');
  await rl.click('button:has-text("Сохранить изменения (1)")');
  await rl.waitForSelector('.msg.ok');
  if (shots) await rl.screenshot({ path: shots + '/roles-phone.png' });
  assert.ok(C.MC_RB_MATRIX_['Официант'].includes('booking'), 'право применено');
  assert.deepStrictEqual(rl.__errors, []);
  await browser.close();
  console.log('  ✓ телефон: лента Reels, картинки через приложение, подробности (состав, КБЖУ), заявка официанту\n  ✓ компьютер: каталог, только просмотр\n  ✓ редактор меню: предпросмотр, QR-коды\n  ✓ редактор ролей: право официанту, причина, применено');
  console.log('Итого: браузерная проверка меню и ролей пройдена');
})().catch(e => { console.error('✗', e.message); process.exit(1); });
