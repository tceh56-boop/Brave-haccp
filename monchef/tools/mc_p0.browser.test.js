// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
// MC-023/024 в браузере: директор утверждает точку контроля; официант видит действующую ППК. Запуск: node monchef/tools/mc_p0.browser.test.js [папка для снимков]
const assert = require('assert');
const { chromium } = require('playwright');
const { boot } = require('./gasemu');
const shots = process.argv[2] || '';
let pass = 0; const ok1 = n => { pass++; console.log('  ✓ ' + n); };
const E = boot({ now: '2026-11-25T08:00:00Z' }), C = E.ctx, ss = E.ss;
E.props[C.MC_MED_GATE_PROP_] = 'off';
const emp = ss.insertSheet('Сотрудники');
emp.appendRow(['Фамилия', 'Имя', 'Отчество', 'Должность', 'Роль', 'ДР', 'Телефон', 'Адрес', 'ПИН-код', '', '', '', 'Активен']);
[['Директорова', 'Анна', 'Директор', '1111'], ['Хасапов', 'Ким', 'Ответственный за ХАССП', '5555'], ['Официантов', 'Иван', 'Официант', '3333']].forEach(r => emp.appendRow([r[0], r[1], '', r[2], r[2], '', '', '', r[3], '', '', '', true]));
const J = s => (typeof s === 'string' ? JSON.parse(s) : s), tok = pin => J(C.loginWithPin(pin, 'dev-' + pin)).token;
const DIR = tok('1111'), H1 = tok('5555'), WAI = tok('3333');
const drop = () => { C._mcRcDrop_(); C._BOOK_CACHE_ = null; };
drop(); C._v30Init_();
const PROC = J(C.v30SaveProcess(JSON.stringify({ name: 'Тепловая обработка' }), H1)).data.id; drop();
const CID = J(C.v30SaveControl(JSON.stringify({ processId: PROC, type: 'CCP', controlPoint: 'Температура в толще', criticalLimit: '≥ 75', limitUnit: '°C' }), H1)).data.id; drop();
C._v102CtlMissing_ = r => (String(r[0]) === CID ? [] : ['всё']);   // полнота проверена в mc_p0.test.js; здесь — экран
// действующая ППК
drop(); C._v65Sh_('PPK'); C._v102PpkPrep_();
(() => { const H = C.MC_V65.PPK[1], o = {}; H.forEach(c => o[c] = ''); Object.assign(o, { PPKID: 'PPK-1', Name: 'ППК ресторана', Version: 2, DateFrom: new Date('2026-11-20'), Status: 'ACTIVE', ApprovedBy: 'Директорова Анна, Директор', ApprovedAt: new Date('2026-11-19'), Author: 'Хасапов Ким', AgreedBy: 'Контролёва Ия', Basis: 'пересмотр: охлаждение' });
  ss.getSheetByName('ППК_V30').appendRow(H.map(c => o[c])); C._v65Sh_('SEC').appendRow(['SEC-1', 'PPK-1', 'HACCP', 'ХАССП и ККТ', 1, 'ККТ: температура в толще ≥ 75 °C', 'ХАССП', 'EDITED', 1, '', new Date(), 'Хасапов']); })();
async function open(browser, html, vp) {
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: shots ? 2 : 1 });
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept('проверено'));
  await page.exposeFunction('__srv', (fn, args) => { drop(); const r = C[fn].apply(null, args); return r === undefined ? null : r; });
  await page.addInitScript(() => { const runner = st => new Proxy({}, { get: (_, key) => { if (key === 'withSuccessHandler') return f => runner(Object.assign({}, st, { ok: f })); if (key === 'withFailureHandler') return f => runner(Object.assign({}, st, { fail: f })); if (key === 'withUserObject') return () => runner(st);
    return (...args) => { window.__srv(key, args).then(r => st.ok && st.ok(r), e => st.fail && st.fail(e)); }; } }); window.google = { script: { run: runner({}) } }; });
  await page.route('http://monchef.test/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto('http://monchef.test/exec'); await page.addStyleTag({ content: '#mcxScreen{display:none!important}' });
  return { page, errs };
}
console.log('MC-023/024 в браузере');
(async () => {
  const browser = await chromium.launch();
  const d = await open(browser, C.doGet({ parameter: { compliance: '1', token: DIR } }).getContent(), { width: 1280, height: 900 });
  await d.page.waitForSelector('text=Утверждение ККТ и контрольных точек');
  assert.ok(/проект — не действует/.test(await d.page.textContent('#vbody')));
  if (shots) await d.page.screenshot({ path: shots + '/mc024-approve.png', fullPage: true });
  await d.page.click('#vbody button:has-text("Утвердить")'); await d.page.waitForSelector('#vmsg:has-text("Точка утверждена")');
  drop(); assert.strictEqual(C._v30Rows_(C.MC_V30.CCP).find(r => String(r[0]) === CID)[13], 'ACTIVE');
  assert.deepStrictEqual(d.errs, []);
  ok1('директор: экран «ХАССП: процессы и ККТ» — карточка утверждения, «Утвердить» → точка действует');
  const w = await open(browser, C.doGet({ parameter: { token: WAI } }).getContent(), { width: 390, height: 844 });
  await w.page.waitForSelector('#content button:has-text("Действующая ППК")'); await w.page.click('#content button:has-text("Действующая ППК")');
  await w.page.waitForSelector('text=ККТ: температура в толще ≥ 75 °C');
  assert.ok(/версия 2/.test(await w.page.textContent('#vbody')) && /Директорова Анна/.test(await w.page.textContent('#vbody')));
  if (shots) await w.page.screenshot({ path: shots + '/mc023-active.png', fullPage: true });
  assert.deepStrictEqual(w.errs, []);
  ok1('официант: главная → «Действующая ППК» — версия, кто утвердил, разделы (только чтение)');
  await browser.close();
  console.log('Итого: ' + pass + ' пройдено, 0 не пройдено');
})().catch(e => { console.error('✗', e.message); process.exit(1); });
