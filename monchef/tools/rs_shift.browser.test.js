// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
// Restaurant Service, этап 7: вкладка «Смена» у директора — оплата, журнал продаж, Z-отчёт, food cost, возврат по счёту.
// Запуск: node monchef/tools/rs_shift.browser.test.js [папка для снимков]
const assert = require('assert');
const { chromium } = require('playwright');
const { boot } = require('./gasemu');
const shots = process.argv[2] || '';

const E = boot({ now: '2026-11-25T08:00:00Z' }), C = E.ctx, ss = E.ss;
E.props[C.MC_MED_GATE_PROP_] = 'off';
const emp = ss.insertSheet('Сотрудники');
emp.appendRow(['Фамилия', 'Имя', 'Отчество', 'Должность', 'Роль', 'ДР', 'Телефон', 'Адрес', 'ПИН-код', '', '', '', 'Активен']);
[['Директорова', 'Анна', 'Директор', '1111'], ['Админов', 'Пётр', 'Администратор', '2222'], ['Официантов', 'Иван', 'Официант', '3333'], ['Шефов', 'Марк', 'Шеф-повар', '7777']]
  .forEach(r => emp.appendRow([r[0], r[1], '', r[2], r[2], '', '', '', r[3], '', '', '', true]));
const ds = ss.insertSheet('Блюда');
ds.appendRow(['Код', 'Название', 'Категория', 'Выход', '', 'Технология', '', '', 'Цех', '', '', '', 'Выход, г/мл/шт', 'Ед. выхода']);
ds.appendRow(['D002', 'Салат с тунцом', 'Салаты', 220, '', '', '', '', 'Холодный цех', '', '', '', 220, 'г']);
const so = ss.insertSheet('Состав'); so.appendRow(['Код', 'Продукт', '', '', 'Брутто', 'Нетто', 'Выход', 'Ед.']);
[['D002', 'Тунец', 80, 80, 'г'], ['D002', 'Салат микс', 60, 60, 'г']].forEach(r => so.appendRow([r[0], r[1], '', '', r[2], r[3], r[3], r[4]]));
const pr = ss.insertSheet('Цены_Меню'); pr.appendRow(['PriceID', 'DishCode', 'DishName', 'Price', 'Unit', 'Source', 'EventID', 'DateFrom', 'DateTo', 'Status']);
pr.appendRow(['P2', 'D002', '', 790, 'порц.', 'MENU', '', '2026-11-01', '', 'ACTIVE']);
const tv = ss.insertSheet('ТТК_Версии'); tv.appendRow(['Код блюда', 'Версия', 'Статус']); tv.appendRow(['D002', 1, 'действующая']);
C._withLock_(() => C._incomeWithBatches_([{ name: 'Тунец', qty: 1000, unit: 'г', price: 1.5 }, { name: 'Салат микс', qty: 1000, unit: 'г', price: 0.5 }], 'Поставщик', '', null));
(() => { const sh = ss.getSheetByName('Склад_Партии'), n = sh.getLastRow(); for (let i = 2; i <= n; i++) sh.getRange(i, 11).setValue('active'); })();
const J = s => JSON.parse(s), tok = pin => J(C.loginWithPin(pin, 'dev-' + pin)).token;
const DIR = tok('1111'), ADM = tok('2222'), WAI = tok('3333'), CHEF = tok('7777');
let n = 0; const k = () => 'shift-key-' + (++n);
const call = (fn, t, d) => { C._mcRcDrop_(); C._BOOK_CACHE_ = null; const r = J(C[fn](JSON.stringify(d), t)); assert.ok(r.success === true || r.ok === true, fn + ': ' + JSON.stringify(r).slice(0, 300)); return r.data; };
const hall = call('rsHallSave', ADM, { idem: k(), name: 'Зал', width: 6, height: 4 });
const t7 = call('rsTableSave', ADM, { idem: k(), hallId: hall.id, number: '7', x: 1, y: 1, seatsMax: 4 });
const o = call('rsOrderOpen', WAI, { idem: k(), tableId: t7.id, guests: 2 }).orderId;
call('rsItemAdd', WAI, { idem: k(), orderId: o, items: [{ code: 'D002', qty: 2 }] });
call('rsOrderSend', WAI, { idem: k(), orderId: o, mode: 'all' });
call('rsKdsData', CHEF, { dept: 'KITCHEN' }).tickets.forEach(tk => { const a = call('rsTicketAct', CHEF, { idem: k(), ticketId: tk.id, version: tk.version, action: 'start' }); call('rsTicketAct', CHEF, { idem: k(), ticketId: tk.id, version: a.version !== undefined ? a.version : tk.version + 1, action: 'ready' }); });
let od = call('rsOrderGet', WAI, { id: o });
call('rsItemServe', WAI, { idem: k(), orderId: o, itemIds: od.items.map(x => x.id) });
call('rsBillSplit', WAI, { idem: k(), orderId: o, mode: 'one' });
const b = call('rsOrderGet', ADM, { id: o }).bills[0];
call('rsBillPay', ADM, { idem: k(), billId: b.id, version: b.version, method: 'CARD', receipt: '77', amountKop: b.totalKop });
od = call('rsOrderGet', ADM, { id: o });
call('rsOrderClose', WAI, { idem: k(), orderId: o, version: od.version });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, timezoneId: 'Asia/Yekaterinburg', deviceScaleFactor: shots ? 2 : 1 });
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept('гость отказался, блюдо остыло'));
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
  const html = C.doGet({ parameter: { hall: '1', token: DIR } }).getContent();
  await page.route('http://monchef.test/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto('http://monchef.test/exec'); await page.addStyleTag({ content: '#mcxScreen{display:none!important}' });
  await page.waitForSelector('#tabs button:has-text("Смена")');
  await page.click('#tabs button:has-text("Смена")');
  await page.waitForSelector('text=Проведено в журнал продаж из зала');
  const txt = await page.textContent('#view');
  assert.ok(/1\s?580/.test(txt), 'оплачено 1 580 ₽: ' + txt.slice(0, 400));
  assert.ok(/Food cost/.test(txt), 'директор видит food cost');
  assert.ok(/Z-отчёт кассы/.test(txt) && /не загружен/.test(txt), 'Z-отчёт не загружен — видно');
  if (shots) await page.screenshot({ path: shots + '/shift.png', fullPage: true });
  await page.click('button:has-text("Возврат по счёту")');
  await page.waitForSelector('.msg:has-text("Возврат оформлен")');
  await page.waitForSelector('.chip:has-text("возврат")');
  const j = ss.getSheetByName('Ж_Продажи').getDataRange().getValues(), h = j[0];
  const sum = j.slice(1).reduce((a, r) => a + Number(r[h.indexOf('Сумма')]), 0); assert.strictEqual(Math.round(sum * 100), 0, 'сторно обнуляет продажу');
  assert.deepStrictEqual(errs, []);
  await browser.close();
  console.log('  ✓ директор (планшет): вкладка «Смена» — оплата, журнал продаж, Z-отчёт, food cost; возврат по счёту — сторно в журнале');
  console.log('Итого: браузерная проверка смены пройдена');
})().catch(e => { console.error('✗', e.message); process.exit(1); });
