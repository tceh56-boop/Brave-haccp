/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
// «Экономика» → «Меню», «Закупки», «Прогноз» (этап 6 «Финансы»): матрица меню, цены поставщиков, прогноз и заявки — кнопки вызывают сервер.
// Запуск: node tests/finance_menu.browser.test.js
const { chromium } = require('playwright'), path = require('path'), assert = require('assert');
(async () => {
  const b = await chromium.launch(), p = await (await b.newContext()).newPage(), errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => {
    window.__calls = []; window.confirm = () => true;
    const st = { mode: 'READY_TO_WORK', enterpriseType: 'RESTAURANT', types: { RESTAURANT: 'Ресторан' }, org: { name: 'Тест', inn: '', address: '', responsible: '', complete: false }, timezone: 'Europe/Moscow', employees: 1, dishes: 1,
      workshops: [], objects: [], summary: { created: 1, requiresDecision: 0, numericObjects: 0, blockers: 0 } };
    const M = { from: '2026-11-01', to: '2026-11-30', thresholds: { popularityPct: 17.5, avgCmPerPortion: 219 }, totals: { dishes: 2, qty: 180, gross: 41000, revenue: 66000 }, warnings: [{ level: 'gold', text: 'Продаж без цены: 1' }],
      classes: [{ cls: 'STAR', clsRu: 'Звезда', dishes: 1, qty: 80, revenue: 36000, gross: 20000, advice: 'Сохранить' }, { cls: 'PLOWHORSE', clsRu: 'Рабочая лошадка', dishes: 1, qty: 100, revenue: 30000, gross: 21000, advice: 'Поднять цену' },
        { cls: 'PUZZLE', clsRu: 'Загадка', dishes: 0, qty: 0, revenue: 0, gross: 0, advice: '' }, { cls: 'DOG', clsRu: 'Собака', dishes: 0, qty: 0, revenue: 0, gross: 0, advice: '' }],
      items: [{ dish: 'Плов', cls: 'STAR', clsRu: 'Звезда', qty: 80, mixPct: 44.4, avgPrice: 450, costPerPortion: 200, normCost: 190, cmPerPortion: 250, gross: 20000, foodCostPct: 44.4, marginPct: 55.6, flagsRu: ['маржа ниже ориентира'] },
        { dish: 'Борщ', cls: 'PLOWHORSE', clsRu: 'Рабочая лошадка', qty: 100, mixPct: 55.6, avgPrice: 300, costPerPortion: 90, normCost: 85, cmPerPortion: 210, gross: 21000, foodCostPct: 30, marginPct: 70, flagsRu: [] }],
      unsold: [{ dish: 'Окрошка', code: '', menuPrice: 350 }], note: 'Матрица Kasavana–Smith' };
    const P = { from: '2026-11-01', to: '2026-11-30', threshold: 0, costEvents: [{ at: '2026-11-14 14:05', product: 'Говядина', prevPrice: 450, newPrice: 460, unit: 'кг', changePct: 2.2, supplier: 'Фермер', dish: 'Борщ', deltaPerPortion: 1.6, costBefore: 80.3, costAfter: 81.9, foodCostAfter: 27.3 }], totals: { amount: 8550, batches: 5, suppliers: 3, products: 3, priceRises: 1, possibleSaving: 1050 },
      rises: [{ product: 'Говядина', unit: 'кг', lastPrice: 450, lastDate: '2026-11-10', lastSupplier: 'Фермер', prevPrice: 480, changePct: -6.2, avg90: 400, vsAvg90Pct: 12.5, flagsRu: ['рост цены'] }],
      impact: [{ dish: 'Борщ', deltaPerPortion: 8, deltaPctOfPrice: 2.7, normCost: 85, menuPrice: 300, foodCostPct: 28.3, drivers: 'Говядина +8 ₽' }],
      cheaper: [{ product: 'Говядина', unit: 'кг', lastSupplier: 'Фермер', lastPrice: 450, bestSupplier: 'ООО Мясо', bestPrice: 400, bestDate: '2026-10-20', saving: 1050 }],
      suppliers: [{ supplier: 'ООО Мясо', amount: 4800, sharePct: 56.1, batches: 1, products: 1 }], products: [], purchases: [{ date: '2026-11-10', product: 'Говядина', supplier: 'Фермер', invoice: 'Н-1', qty: 5, unit: 'кг', price: 450, amount: 2250 }], note: 'Цены по партиям' };
    const F = { asOf: '2026-11-30', from: '2026-11-30', to: '2026-12-06', days: 7, weeks: 8, historyFrom: '2026-10-05', historyTo: '2026-11-29', workDays: 50,
      totals: { revenue: 39750, cost: 14200, portions: 115, foodCostPct: 35.7, orderLines: 1, orderAmount: 5422.5 }, warnings: [{ level: 'gold', text: 'Нет техкарты, потребность не посчитана: Компот' }],
      perDay: [{ day: '2026-11-30', weekday: 'пн', portions: 15, revenue: 5250, cost: 1900, foodCostPct: 36.2, basis: 'по 8 таким же дням недели' }],
      dishes: [{ dish: 'Борщ', forecastQty: 80, perWorkDay: 11.4, histQty: 570, avgPrice: 300 }],
      toOrder: [{ key: 'говядина|г', product: 'Говядина', unit: 'кг', need: 18.05, onHand: 5, minStock: 2, ordered: 3, toOrder: 12.05, supplier: 'Фермер', lastPrice: 450, estAmount: 5422.5 }],
      items: [{ product: 'Говядина', unit: 'кг', need: 18.05, onHand: 5, toOrder: 12.05, dishes: 'Борщ, Плов' }], noTtk: ['Компот'], note: 'Прогноз по дням недели' };
    const D = { uiMe: () => ({ ok: true, name: 'Директор Тест', role: 'Директор', sections: ['home'], dev: true, modules: {} }), getAppUrl: () => '', uiData: () => ({ ok: true, kpis: [], tabs: [] }),
      tsGetPlanInfo: () => JSON.stringify({ success: true, data: { plan: 'pro', planName: 'Pro', status: 'ACTIVE', mode: 'full', features: { journals: true }, plans: [], featureNames: {}, lockedSections: {} } }),
      ts2Wizard: () => JSON.stringify({ success: true, data: st }), v76GetMenuEngineering: () => JSON.stringify({ success: true, data: M }), v76GetProcurement: () => JSON.stringify({ success: true, data: P }),
      v76GetForecast: () => JSON.stringify({ success: true, data: F }),
      v76CreateOrderRequests: () => JSON.stringify({ success: true, data: { planId: 'FC-20261130-7', created: [{ requestId: 'REQ-9', product: 'Говядина', qty: 12.05, unit: 'кг', supplier: 'Фермер' }], skipped: [], note: 'Заявки созданы (1).' } }),
      createSupplierOrdersFromWeeklyPlan: () => JSON.stringify({ success: true, data: { planId: 'FC-20261130-7', orders: [{ supplier: 'Фермер', orderId: 'ORD-9', lines: 1 }] } }) };
    function mk(s) { s = s || {}; return new Proxy({}, { get(t, k) {
      if (k === 'withSuccessHandler') return f => mk(Object.assign({}, s, { ok: f })); if (k === 'withFailureHandler') return f => mk(Object.assign({}, s, { fl: f })); if (k === 'withUserObject') return u => mk(Object.assign({}, s, { uo: u }));
      return (...a) => setTimeout(() => { window.__calls.push(k + ':' + JSON.stringify(a)); try { (s.ok || (() => {}))(D[k] ? D[k](...a) : { ok: true, data: [] }, s.uo); } catch (e) { (s.fl || (() => {}))(e, s.uo); } }, 5); } }); }
    window.google = { script: { run: mk() } };
  });
  await p.goto('file://' + path.join(__dirname, '..', 'app', 'Console.html'));
  await p.evaluate(() => { localStorage.setItem('mc_token', 'x'); TOKEN = 'x'; start(null); }); await p.waitForTimeout(400);
  const calls = () => p.evaluate(() => window.__calls.join('\n')), txt = async () => (await p.textContent('#vbody')).replace(/\s+/g, ' ');
  await p.evaluate(() => { openView('finance', 'menu'); }); await p.waitForTimeout(500);
  let t = await txt();
  ['Звезда', 'Рабочая лошадка', 'Что делать с каждой группой', 'Плов', 'маржа ниже ориентира', 'В меню, но не продавалось', 'Окрошка', 'Порог популярности', 'Продаж без цены'].forEach(s => assert(t.includes(s), 'меню: ' + s));
  await p.fill('#mvf_from', '2026-10-01'); await p.click('button[data-mv="menuPeriod"]'); await p.waitForTimeout(400);
  assert(/v76GetMenuEngineering:\["","2026-10-01"/.test(await calls()), 'период меню уходит на сервер');
  await p.evaluate(() => { openView('finance', 'buy'); }); await p.waitForTimeout(500);
  t = await txt();
  ['Подорожание при приёмке', '81.9', 'Подорожало продуктов', 'Рост цен', 'Говядина', 'Как рост цен меняет себестоимость блюд', 'Говядина +8', 'Дешевле у другого поставщика', 'ООО Мясо', 'Возможная экономия', 'Поставщики', 'Партии'].forEach(s => assert(t.includes(s), 'закупки: ' + s));
  await p.evaluate(() => { openView('finance', 'fc'); }); await p.waitForTimeout(500);
  t = await txt();
  ['К заказу', 'Говядина', 'Уже заказано', 'По дням', 'по 8 таким же дням недели', 'Нет техкарты', 'Вся потребность'].forEach(s => assert(t.includes(s), 'прогноз: ' + s));
  assert(/v76GetForecast:\["\{\\"days\\":7,\\"weeks\\":8\}"\]/.test(await calls()), 'прогноз по умолчанию: 7 дней, 8 недель');
  await p.fill('#mvf_fdays', '14'); await p.fill('#mvf_fweeks', '4'); await p.click('button[data-mv="fcRun"]'); await p.waitForTimeout(400);
  assert(/v76GetForecast:\["\{\\"days\\":\\"14\\",\\"weeks\\":\\"4\\"\}"\]/.test(await calls()), 'свои дни и недели');
  await p.click('button[data-mv="fcOrder"]'); await p.waitForTimeout(400);
  assert(/v76CreateOrderRequests:\["\{\\"days\\":\\"14\\",\\"weeks\\":\\"4\\",\\"asOf\\":\\"2026-11-30\\"\}"\]/.test(await calls()), 'заявки по тому же прогнозу');
  assert((await txt()).includes('REQ-9'), 'созданные заявки показаны');
  await p.click('button[data-mv="fcSup"]'); await p.waitForTimeout(400);
  assert(/createSupplierOrdersFromWeeklyPlan:\["FC-20261130-7","2026-11-30"/.test(await calls()), 'заказы поставщикам по заявкам прогноза');
  assert.strictEqual(errs.length, 0, 'ошибки страницы: ' + errs.join('; '));
  await b.close(); console.log('OK: Экономика → Меню, Закупки, Прогноз — матрица, цены, влияние на блюда, прогноз, заявки: кнопки вызывают сервер');
})().catch(e => { console.error(e); process.exit(1); });
