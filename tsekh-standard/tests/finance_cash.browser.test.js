/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
// «Экономика» → «Деньги» (этап 5 «Финансы»): счета, Cash Flow, загрузка выписки, разнесение, касса, долги — кнопки вызывают сервер.
// Запуск: node tests/finance_cash.browser.test.js
const { chromium } = require('playwright'), path = require('path'), assert = require('assert');
(async () => {
  const b = await chromium.launch(), p = await (await b.newContext()).newPage(), errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => {
    window.__calls = []; window.prompt = () => 'ошибка ввода'; window.confirm = () => true;
    const st = { mode: 'READY_TO_WORK', enterpriseType: 'RESTAURANT', types: { RESTAURANT: 'Ресторан' }, org: { name: 'Тест', inn: '', address: '', responsible: '', complete: false }, timezone: 'Europe/Moscow', employees: 1, dishes: 1,
      workshops: [], objects: [], summary: { created: 1, requiresDecision: 0, numericObjects: 0, blockers: 0 } };
    const C = { from: '2026-11-01', to: '2026-11-30', totals: { opening: 10000, inflow: 12500.5, outflow: 7350, net: 5150.5, closing: 15150.5, uncategorized: 1 },
      accounts: [{ id: 'ACC-1', name: 'Р/с …2345', typeRu: 'банк', bankAccount: '40702810900000012345', opening: 10000, inflow: 12500.5, outflow: 7350, closing: 15150.5 }],
      activities: [{ activityRu: 'Операционная деятельность', inflow: 12500.5, outflow: 5350, net: 7150.5 }],
      flow: [{ activityRu: 'Операционная деятельность', category: 'Выручка: эквайринг (карты)', inflow: 12500.5, outflow: 0, net: 12500.5, count: 1 }],
      moves: [{ id: 'MOV-1', date: '2026-11-06', account: 'Р/с …2345', dirRu: 'выплата', amount: 2000, category: 'Не разнесено', counterparty: 'ИП Сидоров', purpose: 'ремонт вытяжки', source: 'выписка' }],
      uncategorized: [{ id: 'MOV-1', date: '2026-11-06', dirRu: 'выплата', amount: 2000, counterparty: 'ИП Сидоров', inn: '660011223344', purpose: 'ремонт вытяжки' }],
      payables: [{ supplier: 'ООО Мясо', invoiced: 10000, paid: 5000, debt: 5000, oldestDate: '2026-11-02', oldestDays: 12 }], imports: [], rules: [],
      revenueVsCash: { revenue: 1050, cashRevenue: 12500.5, diff: -11450.5 }, warnings: [{ level: 'gold', code: 'UNCATEGORIZED', text: 'Не разнесено по статьям: 1' }],
      categories: [{ category: 'Выручка: наличные', dir: 'IN' }, { category: 'Прочие расходы', dir: 'OUT' }, { category: 'Не разнесено', dir: '' }], note: 'Управленческий учёт денег' };
    const D = { uiMe: () => ({ ok: true, name: 'Директор Тест', role: 'Директор', sections: ['home'], dev: true, modules: {} }), getAppUrl: () => '', uiData: () => ({ ok: true, kpis: [], tabs: [] }),
      tsGetPlanInfo: () => JSON.stringify({ success: true, data: { plan: 'pro', planName: 'Pro', status: 'ACTIVE', mode: 'full', features: { journals: true }, plans: [], featureNames: {}, lockedSections: {} } }),
      ts2Wizard: () => JSON.stringify({ success: true, data: st }), v75GetCash: () => JSON.stringify({ success: true, data: C }),
      v75ImportStatement: () => JSON.stringify({ success: true, data: { account: 'Р/с …2345', accountCreated: false, added: 3, duplicates: 1, closedSkipped: 0, uncategorized: 1, check: { ok: true } } }),
      v75SetCategory: () => JSON.stringify({ success: true, data: { alsoApplied: 2 } }), v75AddMove: () => JSON.stringify({ success: true, data: { moveId: 'MOV-2' } }),
      v75SaveAccount: () => JSON.stringify({ success: true, data: { accountId: 'ACC-2' } }), v75CancelMove: () => JSON.stringify({ success: true, data: {} }) };
    function mk(s) { s = s || {}; return new Proxy({}, { get(t, k) {
      if (k === 'withSuccessHandler') return f => mk(Object.assign({}, s, { ok: f })); if (k === 'withFailureHandler') return f => mk(Object.assign({}, s, { fl: f })); if (k === 'withUserObject') return u => mk(Object.assign({}, s, { uo: u }));
      return (...a) => setTimeout(() => { window.__calls.push(k + ':' + JSON.stringify(a)); try { (s.ok || (() => {}))(D[k] ? D[k](...a) : { ok: true, data: [] }, s.uo); } catch (e) { (s.fl || (() => {}))(e, s.uo); } }, 5); } }); }
    window.google = { script: { run: mk() } };
  });
  await p.goto('file://' + path.join(__dirname, '..', 'app', 'Console.html'));
  await p.evaluate(() => { localStorage.setItem('mc_token', 'x'); TOKEN = 'x'; start(null); }); await p.waitForTimeout(400);
  await p.evaluate(() => { openView('finance', 'cash'); }); await p.waitForTimeout(500);
  const calls = () => p.evaluate(() => window.__calls.join('\n'));
  const txt = (await p.textContent('#vbody')).replace(/\s+/g, ' ');
  ['Остаток на конец', 'Р/с …2345', 'Загрузить банковскую выписку', 'Cash Flow по статьям', 'Выручка: эквайринг', 'Не разнесено', 'ИП Сидоров', 'Долги поставщикам', 'ООО Мясо', 'разница'].forEach(s => assert(txt.includes(s), 'на экране: ' + s));
  await p.setInputFiles('#mvf_sfile', { name: 'kl_to_1c.txt', mimeType: 'text/plain', buffer: Buffer.from('1CClientBankExchange\r\nРасчСчет=40702810900000012345\r\n', 'utf8') });
  await p.click('button[data-mv="cashImport"]'); await p.waitForTimeout(400);
  const imp = (await calls()).split('\n').find(l => l.startsWith('v75ImportStatement:')), arg = imp && JSON.parse(JSON.parse(imp.slice('v75ImportStatement:'.length))[0]);
  assert(arg && /^1CClientBankExchange/.test(arg.text) && arg.text.includes('РасчСчет=40702810900000012345') && arg.fileName === 'kl_to_1c.txt', 'файл выписки уходит на сервер текстом');
  await p.click('button[data-mv="cashPick"][data-a="MOV-1"]'); await p.waitForTimeout(100);
  assert.strictEqual(await p.inputValue('#mvf_cmove'), 'MOV-1', '«Разнести» подставляет движение');
  await p.selectOption('#mvf_ccat', 'Прочие расходы'); await p.click('button[data-mv="cashCat"]'); await p.waitForTimeout(300);
  assert(/v75SetCategory:\["\{\\"moveId\\":\\"MOV-1\\",\\"category\\":\\"Прочие расходы\\",\\"remember\\":true\}/.test(await calls()), 'разнесение с правилом');
  await p.selectOption('#mvf_macc', 'ACC-1'); await p.fill('#mvf_mdate', '2026-11-10'); await p.fill('#mvf_mamount', '4000');
  await p.click('button[data-mv="cashMove"]'); await p.waitForTimeout(300); assert(/v75AddMove:\["\{\\"accountId\\":\\"ACC-1\\"/.test(await calls()), 'движение вручную');
  await p.click('button[data-mv="cashCancel"][data-a="MOV-1"]'); await p.waitForTimeout(300); assert(/v75CancelMove:\["\{\\"moveId\\":\\"MOV-1\\",\\"reason\\":\\"ошибка ввода\\"\}/.test(await calls()), 'отмена движения');
  assert.strictEqual(errs.length, 0, 'ошибки страницы: ' + errs.join('; '));
  await b.close(); console.log('OK: Экономика → Деньги — счета, Cash Flow, выписка, разнесение, касса, долги: кнопки вызывают сервер');
})().catch(e => { console.error(e); process.exit(1); });
