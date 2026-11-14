/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
// «Экономика» → «ФОТ» (этап 4 «Финансы»): Labor Cost, проблемы, ставки, часы, исправления, премии — кнопки вызывают сервер.
// Запуск: node tests/finance_labor.browser.test.js
const { chromium } = require('playwright'), path = require('path'), assert = require('assert');
(async () => {
  const b = await chromium.launch(), p = await (await b.newContext()).newPage(), errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => {
    window.__calls = []; window.prompt = () => 'ошибка ввода'; window.confirm = () => true;
    const st = { mode: 'READY_TO_WORK', enterpriseType: 'RESTAURANT', types: { RESTAURANT: 'Ресторан' }, org: { name: 'Тест', inn: '', address: '', responsible: '', complete: false }, timezone: 'Europe/Moscow', employees: 1, dishes: 1,
      workshops: [], objects: [], summary: { created: 1, requiresDecision: 0, numericObjects: 0, blockers: 0 } };
    const L = { from: '2026-11-01', to: '2026-11-30', totals: { total: 8300, hours: 33, base: 7600, bonus: 1000, penalty: 300, noRate: 1 },
      byEmployee: [{ employee: 'Повар Петров', role: 'Повар', shifts: 2, hours: 20, rate: '300', base: 6000, bonus: 1000, penalty: 300, total: 6700 }],
      problems: [{ code: 'NO_RATE', date: '2026-11-10', employee: 'Бармен Козлов', ref: 'SH4', text: 'Нет ставки — внесите ставку сотрудника или роли «Бармен»' }],
      rates: [{ id: 'RATE-1', employee: 'Повар Петров', role: '', rate: 300, from: '2026-11-01', to: '', status: 'ACTIVE' }],
      entries: [{ date: '2026-11-10', kind: 'смена', id: 'SH1', employee: 'Повар Петров', hours: 8, rate: 300, amount: 2400, flagsRu: [] }, { date: '2026-11-11', kind: 'вручную', id: 'TS-1', employee: 'Кассир Орлова', hours: 6, rate: 200, amount: 1200, flagsRu: [] }],
      timesheet: [], bonuses: [{ id: 'BON-1', date: '2026-11-10', employee: 'Повар Петров', typeRu: 'премия', amount: 1000, reason: 'банкет', author: 'Шеф', status: 'DRAFT', decidedBy: '' }], note: 'Управленческий Labor Cost' };
    const D = { uiMe: () => ({ ok: true, name: 'Директор Тест', role: 'Директор', sections: ['home'], dev: true, modules: {} }), getAppUrl: () => '', uiData: () => ({ ok: true, kpis: [], tabs: [] }),
      tsGetPlanInfo: () => JSON.stringify({ success: true, data: { plan: 'pro', planName: 'Pro', status: 'ACTIVE', mode: 'full', features: { journals: true }, plans: [], featureNames: {}, lockedSections: {} } }),
      ts2Wizard: () => JSON.stringify({ success: true, data: st }), v74GetLabor: () => JSON.stringify({ success: true, data: L }),
      v74SaveRate: () => JSON.stringify({ success: true, data: { rateId: 'RATE-2', closedPrevious: [] } }), v74AddHours: () => JSON.stringify({ success: true, data: { entryId: 'TS-2' } }),
      v74CorrectHours: () => JSON.stringify({ success: true, data: { entryId: 'TS-3' } }), v74CancelRecord: () => JSON.stringify({ success: true, data: {} }),
      v74AddBonus: () => JSON.stringify({ success: true, data: { bonusId: 'BON-2', note: 'ждёт подтверждения' } }), v74DecideBonus: () => JSON.stringify({ success: true, data: { status: 'APPROVED' } }) };
    function mk(s) { s = s || {}; return new Proxy({}, { get(t, k) {
      if (k === 'withSuccessHandler') return f => mk(Object.assign({}, s, { ok: f })); if (k === 'withFailureHandler') return f => mk(Object.assign({}, s, { fl: f })); if (k === 'withUserObject') return u => mk(Object.assign({}, s, { uo: u }));
      return (...a) => setTimeout(() => { window.__calls.push(k + ':' + JSON.stringify(a)); try { (s.ok || (() => {}))(D[k] ? D[k](...a) : { ok: true, data: [] }, s.uo); } catch (e) { (s.fl || (() => {}))(e, s.uo); } }, 5); } }); }
    window.google = { script: { run: mk() } };
  });
  await p.goto('file://' + path.join(__dirname, '..', 'app', 'Console.html'));
  await p.evaluate(() => { localStorage.setItem('mc_token', 'x'); TOKEN = 'x'; start(null); }); await p.waitForTimeout(400);
  await p.evaluate(() => { openView('finance', 'pay'); }); await p.waitForTimeout(500);
  const calls = () => p.evaluate(() => window.__calls.join('\n'));
  const txt = (await p.textContent('#vbody')).replace(/\s+/g, ' ');
  ['Labor Cost', 'Повар Петров', 'Нет ставки', 'Ставка в час', 'Часы без смены', 'Исправить часы', 'Премии и удержания', 'банкет'].forEach(s => assert(txt.includes(s), 'на экране: ' + s));
  await p.fill('#mvf_pemp', 'Повар Петров'); await p.fill('#mvf_prate', '350'); await p.fill('#mvf_pfrom', '2026-11-11');
  await p.click('button[data-mv="payRate"]'); await p.waitForTimeout(300);
  assert(/v74SaveRate:\["\{\\"employee\\":\\"Повар Петров\\",\\"role\\":\\"\\",\\"ratePerHour\\":\\"350\\"/.test(await calls()), 'ставка уходит на сервер');
  await p.fill('#mvf_hdate', '2026-11-12'); await p.fill('#mvf_hemp', 'Кассир Орлова'); await p.fill('#mvf_hours', '5');
  await p.click('button[data-mv="payHours"]'); await p.waitForTimeout(300); assert(/v74AddHours:/.test(await calls()), 'часы');
  await p.fill('#mvf_fid', 'SH1'); await p.fill('#mvf_fhours', '9'); await p.fill('#mvf_freason', 'не закрыл смену');
  await p.click('button[data-mv="payFix"]'); await p.waitForTimeout(300); assert(/v74CorrectHours:\["\{\\"hours\\":\\"9\\",\\"reason\\":\\"не закрыл смену\\",\\"shiftId\\":\\"SH1\\"\}/.test(await calls()), 'исправление смены');
  await p.click('button[data-mv="payOk"][data-a="BON-1"]'); await p.waitForTimeout(300); assert(/v74DecideBonus:\["\{\\"bonusId\\":\\"BON-1\\",\\"decision\\":\\"APPROVE\\"\}/.test(await calls()), 'подтвердить премию');
  await p.click('button[data-mv="payCancel"][data-a="TS|TS-1"]'); await p.waitForTimeout(300); assert(/v74CancelRecord:\["\{\\"kind\\":\\"TS\\",\\"id\\":\\"TS-1\\",\\"reason\\":\\"ошибка ввода\\"\}/.test(await calls()), 'отмена записи табеля');
  assert.strictEqual(errs.length, 0, 'ошибки страницы: ' + errs.join('; '));
  await b.close(); console.log('OK: Экономика → ФОТ — сводка, проблемы, ставки, часы, исправления, премии: кнопки вызывают сервер');
})().catch(e => { console.error(e); process.exit(1); });
