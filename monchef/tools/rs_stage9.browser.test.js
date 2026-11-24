// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
// Restaurant Service, этап 9 в браузере (главное окно): банкеты в «Зал → Брони». Запуск: node monchef/tools/rs_stage9.browser.test.js [папка для снимков]
const assert = require('assert');
const { chromium } = require('playwright');
const { boot } = require('./gasemu');
const shots = process.argv[2] || '';
let pass = 0; const ok1 = n => { pass++; console.log('  ✓ ' + n); };
const E = boot({ now: '2026-11-25T08:00:00Z' }), C = E.ctx, ss = E.ss;
E.props[C.MC_MED_GATE_PROP_] = 'off';
const emp = ss.insertSheet('Сотрудники');
emp.appendRow(['Фамилия', 'Имя', 'Отчество', 'Должность', 'Роль', 'ДР', 'Телефон', 'Адрес', 'ПИН-код', '', '', '', 'Активен']);
[['Директорова', 'Анна', 'Директор', '1111'], ['Админов', 'Пётр', 'Администратор', '2222']].forEach(r => emp.appendRow([r[0], r[1], '', r[2], r[2], '', '', '', r[3], '', '', '', true]));
const J = s => (typeof s === 'string' ? JSON.parse(s) : s), tok = pin => J(C.loginWithPin(pin, 'dev-' + pin)).token;
const DIR = tok('1111'), ADM = tok('2222'); let n = 0; const k = () => 'b9-key-' + (++n);
const drop = () => { C._mcRcDrop_(); C._BOOK_CACHE_ = null; };
const call = (fn, t, d) => { drop(); const r = J(C[fn](JSON.stringify(d), t)); assert.ok(r.success, fn + ': ' + JSON.stringify(r).slice(0, 200)); return r.data; };
const hall = call('rsHallSave', ADM, { idem: k(), name: 'Основной зал', width: 8, height: 5 });
const T = ['1', '2', '3'].map((x, i) => call('rsTableSave', ADM, { idem: k(), hallId: hall.id, number: x, x: i * 2, y: 1, seatsMax: 6 }));
call('rsBookingCreate', ADM, { idem: k(), tables: [T[0].id], guest: 'Смирнов', date: '2026-11-25', start: '19:00', duration: 120, guests: 2, status: 'CONFIRMED' });
drop(); const e1 = C.saveEvent(JSON.stringify({ date: '2026-11-25', time: '18:00–23:00', format: 'Юбилей', place: 'Основной зал', guests: 30, items: [], status: 'Подтверждён' }), DIR);
drop(); const e2 = C.saveEvent(JSON.stringify({ date: '2026-11-25', time: '12:00', format: 'Фуршет', place: 'выездной', guests: 10, items: [], status: 'Подтверждён' }), DIR);

async function open(browser, html, vp) {
  const page = await browser.newPage({ viewport: vp, timezoneId: 'Asia/Yekaterinburg', deviceScaleFactor: shots ? 2 : 1 });
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept());
  await page.exposeFunction('__srv', (fn, args) => { drop(); const r = C[fn].apply(null, args); return r === undefined ? null : r; });
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
console.log('Этап 9 в браузере');
(async () => {
  const browser = await chromium.launch();
  const { page, errs } = await open(browser, C.doGet({ parameter: { hall: '1', token: ADM } }).getContent(), { width: 1280, height: 860 });
  await page.waitForSelector('#rshost .tbl');
  await page.fill('#rshost #date', '2026-11-25');
  await page.click('#rshost .tabs button:has-text("Брони")');
  await page.waitForSelector('#rshost #bqv .card');
  const txt = await page.textContent('#rshost #bqv');
  assert.ok(/Юбилей/.test(txt) && /Зал «Основной зал», стол 1, 2, 3/.test(txt) && /Пересекается с бронями: Смирнов/.test(txt), txt);
  assert.ok(/Фуршет/.test(txt) && /Не привязан к залу/.test(txt));
  assert.ok(await page.isVisible('#rshost .bk .chip:has-text("банкет")'), 'бронь банкета помечена');
  if (shots) await page.screenshot({ path: shots + '/stage9-banquets.png', fullPage: true });
  ok1('«Зал → Брони»: банкеты с залом и столами, пересечение с бронью, банкет без зала, метка «банкет»');
  await page.click('#rshost #bqv button:has-text("Привязать к залу")');
  await page.waitForSelector('#rshost #bq_ts .bq_t');
  await page.uncheck('#rshost #bq_ts .bq_t >> nth=0');
  await page.click('#rshost #bq_go');
  await page.waitForSelector('#rshost .msg.ok:has-text("Банкет привязан")');
  drop(); const b = C._rsRows_('Бронирования_V1').filter(r => String(r['Банкет']) === e2 && r['Статус'] === 'CONFIRMED')[0];
  assert.deepStrictEqual(JSON.parse(b['Столы']).sort(), [T[1].id, T[2].id].sort());
  ok1('привязка банкета без зала к двум столам из окна');
  assert.deepStrictEqual(errs, []);
  await browser.close();
  console.log('Итого: ' + pass + ' пройдено, 0 не пройдено');
})().catch(e => { console.error('✗', e.message); process.exit(1); });
