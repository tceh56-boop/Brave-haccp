/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
// «Санитария и чек-листы»: связи на проверке и нарушения — кнопки вызывают сервер (Мастер-промт 4.0, этап 1).
// Запуск: node tests/sanitation_review.browser.test.js
const { chromium } = require('playwright'), path = require('path'), assert = require('assert');
(async () => {
  const b = await chromium.launch(), p = await (await b.newContext()).newPage(), errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => {
    window.__calls = []; window.open = () => ({ location: '', close() {}, document: { write() {}, close() {} } });
    const st = { mode: 'READY_TO_WORK', enterpriseType: 'RESTAURANT', types: { RESTAURANT: 'Ресторан' }, org: { name: 'Тест', inn: '', address: '', responsible: '', complete: false }, timezone: 'Europe/Moscow', employees: 1, dishes: 1,
      workshops: [{ workshopId: 'WS-1', name: 'Горячий цех', status: 'ACTIVE', notApplicableReason: '' }], objects: [], summary: { created: 1, requiresDecision: 1, numericObjects: 0, blockers: 0 } };
    const D = { uiMe: () => ({ ok: true, name: 'Директор Тест', role: 'Директор', sections: ['home'], dev: true, modules: {} }), getAppUrl: () => '', uiData: () => ({ ok: true, kpis: [], tabs: [] }),
      tsGetPlanInfo: () => JSON.stringify({ success: true, data: { plan: 'pro', planName: 'Pro', status: 'ACTIVE', mode: 'full', features: { journals: true }, plans: [], featureNames: {}, lockedSections: {} } }),
      ts2Wizard: () => JSON.stringify({ success: true, data: st }), v43GetDashboard: () => ({ openTasks: 1 }), v43GetMyTasks: () => [], v43GetLinks: () => [{ linkId: 'L1', text: 'Дезинфекция столов', disinfectantId: 'D1', regimeId: 'RG-1', method: 'PRODUCT_NAME', confidence: 0.82, status: 'REVIEW' }], v43GetDeviations: () => [{ alertId: 'A1', at: '2026-11-11T10:00', message: 'Концентрация 0.3', status: 'OPEN' }, { alertId: 'A2', at: '2026-11-11T11:00', message: 'x', status: 'VERIFY_REQUIRED' }], v43ReviewLink: () => ({ ok: true }), v43ResolveDeviation: () => ({ ok: true }), v43VerifyDeviation: () => ({ ok: true }), ts2WizardSave: () => JSON.stringify({ success: true, data: st }), ts2Sensors: () => JSON.stringify({ success: true, data: { url: '', devices: [{ deviceId: 'SNS-1', object: 'Холодильник', objectId: 'OBJ-1', status: 'ACTIVE', inputMode: 'MANUAL', lastValue: 4.2, silentMin: 2, rssi: -60, offset: 0, calibratedAt: '', calDueDays: 90 }], calibrations: [] } }),
      ts2SensorCalibrate: () => JSON.stringify({ success: true, data: { result: 'OK', offsetAfter: 0.3, difference: 0.3 } }), ts2ObjectInputMode: () => JSON.stringify({ success: true, data: { inputMode: 'SENSOR' } }),
      ts2ApprovalQueue: () => JSON.stringify({ success: true, data: { queue: [], documents: [{ documentId: 'SDOC-1', templateId: 'TPL-001', title: 'Положение', status: 'ACTIVE', fileId: 'F1' }] } }),
      ts2SystemDoc: () => JSON.stringify({ success: true, data: { url: 'https://docs.google.com/document/d/F1', changed: false, gaps: [] } }) };
    function mk(s) { s = s || {}; return new Proxy({}, { get(t, k) {
      if (k === 'withSuccessHandler') return f => mk(Object.assign({}, s, { ok: f })); if (k === 'withFailureHandler') return f => mk(Object.assign({}, s, { fl: f })); if (k === 'withUserObject') return u => mk(Object.assign({}, s, { uo: u }));
      return (...a) => setTimeout(() => { window.__calls.push(k + ':' + JSON.stringify(a)); try { (s.ok || (() => {}))(D[k] ? D[k](...a) : { ok: true, data: [] }, s.uo); } catch (e) { (s.fl || (() => {}))(e, s.uo); } }, 5); } }); }
    window.google = { script: { run: mk() } };
  });
  await p.goto('file://' + path.join(__dirname, '..', 'app', 'Console.html'));
  await p.evaluate(() => { localStorage.setItem('mc_token', 'x'); TOKEN = 'x'; start(null); }); await p.waitForTimeout(400);
  await p.evaluate(() => { window.prompt = () => 'раствор переготовлен'; openView('sanitationauto'); }); await p.waitForTimeout(500);
  const calls = () => p.evaluate(() => window.__calls.join('\n'));
  const txt = await p.textContent('#vbody'); assert(/Связи на проверке · 1/.test(txt) && /Нарушения санитарии · 2/.test(txt), 'списки показаны');
  await p.click('button[data-mv="lok"][data-a="L1"]'); await p.waitForTimeout(300); assert(/v43ReviewLink:\["L1","APPROVED"/.test(await calls()), 'утвердить связь');
  await p.click('button[data-mv="fix"][data-a="A1"]'); await p.waitForTimeout(300); assert(/v43ResolveDeviation:\["A1","раствор переготовлен"/.test(await calls()), 'устранено');
  await p.click('button[data-mv="vok"][data-a="A2"]'); await p.waitForTimeout(300); assert(/v43VerifyDeviation:\["A2",true/.test(await calls()), 'подтвердить');
  assert.strictEqual(errs.length, 0, 'ошибки страницы: ' + errs.join('; '));
  await b.close(); console.log('OK: санитария — связи на проверке и нарушения: кнопки вызывают сервер');
})().catch(e => { console.error(e); process.exit(1); });
