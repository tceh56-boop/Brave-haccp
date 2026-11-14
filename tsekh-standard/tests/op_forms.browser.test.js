// Экран «Формы документов (ОП)»: перечень ОП-1…ОП-25 с форматами, период для ведомостей, расчёт остатка на конец в строке,
// печать перечня. Список форм берётся из настоящего TS_OpForms.gs.
// Запуск: node tests/op_forms.browser.test.js
const { chromium } = require('playwright'), path = require('path'), fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = vm.createContext({}); vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app', 'TS_OpForms.gs'), 'utf8'), ctx);
const forms = vm.runInContext(`Object.keys(TS_OP_FORMS_).map(function (k) { var f = TS_OP_FORMS_[k]; return { key: k, code: f.code, title: f.title, okud: f.okud, format: f.format,
  formatLabel: TS_OP_FORMATS_[f.format].label, help: f.help, params: f.params, paramLabels: f.paramLabels || {}, cols: f.cols, source: f.source, period: !!f.period, calc: f.calc || null,
  names: _tsOpNames_(f), qtyOptional: !!f.qtyOptional }; })`, ctx);
const LIST = { forms, org: { line: 'ООО «Тест»', okpo: '12345678', division: 'Столовая', director: 'Петров', missing: [] }, products: [{ name: 'Тарелка мелкая', unit: 'шт' }], dishes: ['Борщ'], divisions: ['Столовая'], issued: [] };
(async () => {
  const b = await chromium.launch(), p = await (await b.newContext()).newPage(), errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(LIST => {
    window.__calls = []; window.__printed = []; window.confirm = () => true;
    const D = { uiMe: () => ({ ok: true, name: 'Директор Тест', role: 'Директор', sections: ['home'], dev: true, modules: {} }), getAppUrl: () => '', uiData: () => ({ ok: true, kpis: [], tabs: [] }),
      tsGetPlanInfo: () => JSON.stringify({ success: true, data: { plan: 'pro', planName: 'Pro', status: 'ACTIVE', mode: 'full', features: { journals: true, economics: true }, plans: [], featureNames: {}, lockedSections: {} } }),
      tsOpList: () => JSON.stringify({ success: true, data: LIST }),
      tsOpPrice: () => JSON.stringify({ success: true, data: { code: '', unit: 'шт', okei: '796', price: 150, salePrice: 0, source: 'учётная — средняя цена склада', noPrice: false } }),
      tsOpCatalog: () => JSON.stringify({ success: true, data: { html: '<h3>ПЕРЕЧЕНЬ ФОРМ</h3>' } }) };
    function mk(s) { s = s || {}; return new Proxy({}, { get(t, k) {
      if (k === 'withSuccessHandler') return f => mk(Object.assign({}, s, { ok: f })); if (k === 'withFailureHandler') return f => mk(Object.assign({}, s, { fl: f })); if (k === 'withUserObject') return u => mk(Object.assign({}, s, { uo: u }));
      return (...a) => setTimeout(() => { window.__calls.push(k + ':' + JSON.stringify(a)); try { (s.ok || (() => {}))(D[k] ? D[k](...a) : { ok: true, data: [] }, s.uo); } catch (e) { (s.fl || (() => {}))(e, s.uo); } }, 5); } }); }
    window.google = { script: { run: mk() } };
  }, LIST);
  await p.goto('file://' + path.join(__dirname, '..', 'app', 'Console.html'));
  await p.evaluate(() => { localStorage.setItem('mc_token', 'x'); TOKEN = 'x'; start(null); }); await p.waitForTimeout(400);
  await p.evaluate(() => { window.tsPrint = (h, n) => window.__printed.push(n + ':' + h); openView('tsOpForms'); }); await p.waitForTimeout(500);
  const txt = async () => (await p.textContent('#vbody')).replace(/\s+/g, ' ');
  let t = await txt();
  assert(t.includes('Перечень форм первичной учётной документации'), 'перечень на экране');
  ['ОП-1', 'ОП-13', 'ОП-19', 'ОП-25', 'Калькуляционная карточка', 'А3 альбомный', '2 листа А4 альбомных (разворот)'].forEach(s => assert(t.includes(s), 'перечень: ' + s));
  assert.strictEqual(await p.$$eval('#tsOpForm option', o => o.length), 25, 'в выборе формы все 25');
  // ведомость ОП-9: период датами, остаток на конец считается в строке
  await p.selectOption('#tsOpForm', 'OP9'); await p.waitForTimeout(200);
  assert.strictEqual(await p.getAttribute('#mvf_from', 'type'), 'date'); assert.strictEqual(await p.getAttribute('#mvf_to', 'type'), 'date');
  assert((await txt()).includes('А4 альбомный'));
  await p.click('button[data-mv="add"]'); await p.waitForTimeout(100);
  const set = async (k, v) => { await p.fill('input[data-op="0|' + k + '"]', String(v)); await p.dispatchEvent('input[data-op="0|' + k + '"]', 'change'); await p.waitForTimeout(80); };
  await set('name', 'Тарелка мелкая'); await p.waitForTimeout(100);
  assert(/tsOpPrice:\["x","OP9","Тарелка мелкая"/.test(await p.evaluate(() => window.__calls.join('\n'))), 'цена со склада запрошена');
  await set('open', 100); await set('in', 20); await set('out', 5);
  const row = await p.evaluate(() => TS_OP.rows[0]);
  assert.strictEqual(row.qty, 115); assert.strictEqual(row.price, 150); assert.strictEqual(row.sum, 17250);
  assert((await txt()).includes('17 250,00'), 'сумма остатка в итогах');
  // ОП-1: поле количества порций
  await p.selectOption('#tsOpForm', 'OP1'); await p.waitForTimeout(200);
  assert.strictEqual(await p.getAttribute('#mvf_portions', 'type'), 'number'); assert.strictEqual(await p.getAttribute('#mvf_dish', 'list'), 'tsOpNames2');
  // печать перечня
  await p.click('button[data-mv="catalog"]'); await p.waitForTimeout(200);
  assert(/^Перечень форм ОП:/.test((await p.evaluate(() => window.__printed))[0] || ''), 'перечень печатается');
  assert.deepStrictEqual(errs, []);
  await b.close(); console.log('Экран форм ОП (браузер): проверки пройдены');
})().catch(e => { console.error(e); process.exit(1); });
