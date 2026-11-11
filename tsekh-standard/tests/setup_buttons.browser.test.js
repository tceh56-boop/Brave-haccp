// Кнопки экрана «Настройка и готовность» вызывают сервер (раньше обработчики обращались к this и не работали).
// Запуск: node tests/setup_buttons.browser.test.js
const { chromium } = require('playwright'), path = require('path'), assert = require('assert');
(async () => {
  const b = await chromium.launch(), p = await (await b.newContext()).newPage(), errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => {
    window.__calls = []; window.open = () => ({ location: '', close() {}, document: { write() {}, close() {} } });
    const st = { mode: 'READY_TO_WORK', enterpriseType: 'RESTAURANT', types: { RESTAURANT: 'Ресторан' }, org: { name: 'Тест', inn: '', address: '', responsible: '', complete: false }, timezone: 'Europe/Moscow', employees: 1, dishes: 1,
      workshops: [{ workshopId: 'WS-1', name: 'Горячий цех', status: 'ACTIVE', notApplicableReason: '' }], objects: [], summary: { created: 1, requiresDecision: 1, numericObjects: 0, blockers: 0 } };
    const D = { uiMe: () => ({ ok: true, name: 'Директор Тест', role: 'Директор', sections: ['home'], dev: false, modules: {} }), getAppUrl: () => '', uiData: () => ({ ok: true, kpis: [], tabs: [] }),
      tsGetPlanInfo: () => JSON.stringify({ success: true, data: { plan: 'pro', planName: 'Pro', status: 'ACTIVE', mode: 'full', features: { journals: true }, plans: [], featureNames: {}, lockedSections: {} } }),
      ts2Wizard: () => JSON.stringify({ success: true, data: st }), ts2WizardSave: () => JSON.stringify({ success: true, data: st }), ts2Sensors: () => JSON.stringify({ success: true, data: { url: '', devices: [{ deviceId: 'SNS-1', object: 'Холодильник', objectId: 'OBJ-1', status: 'ACTIVE', inputMode: 'MANUAL', lastValue: 4.2, silentMin: 2, rssi: -60, offset: 0, calibratedAt: '', calDueDays: 90 }], calibrations: [] } }),
      ts2SensorCalibrate: () => JSON.stringify({ success: true, data: { result: 'OK', offsetAfter: 0.3, difference: 0.3 } }), ts2ObjectInputMode: () => JSON.stringify({ success: true, data: { inputMode: 'SENSOR' } }),
      ts2ApprovalQueue: () => JSON.stringify({ success: true, data: { queue: [], documents: [{ documentId: 'SDOC-1', templateId: 'TPL-001', title: 'Положение', status: 'ACTIVE', fileId: 'F1' }] } }),
      ts2SystemDoc: () => JSON.stringify({ success: true, data: { url: 'https://docs.google.com/document/d/F1', changed: false, gaps: [] } }) };
    function mk(s) { s = s || {}; return new Proxy({}, { get(t, k) {
      if (k === 'withSuccessHandler') return f => mk(Object.assign({}, s, { ok: f })); if (k === 'withFailureHandler') return f => mk(Object.assign({}, s, { fl: f })); if (k === 'withUserObject') return u => mk(Object.assign({}, s, { uo: u }));
      return (...a) => setTimeout(() => { window.__calls.push(k + ':' + JSON.stringify(a.slice(1, 3))); try { (s.ok || (() => {}))(D[k] ? D[k](...a) : { ok: true, data: [] }, s.uo); } catch (e) { (s.fl || (() => {}))(e, s.uo); } }, 5); } }); }
    window.google = { script: { run: mk() } };
  });
  await p.goto('file://' + path.join(__dirname, '..', 'app', 'Console.html'));
  await p.evaluate(() => { localStorage.setItem('mc_token', 'x'); TOKEN = 'x'; start(null); }); await p.waitForTimeout(400);
  await p.evaluate(() => openView('tsSetup')); await p.waitForTimeout(400);
  const calls = () => p.evaluate(() => window.__calls.join('\n'));
  for (const [step, btn, re] of [[1, 'save1', /ts2WizardSave:\[1,/], [2, 'save2', /ts2WizardSave:\[2,/], [3, 'save3', /ts2WizardSave:\[3,/], [6, 'save6', /ts2WizardSave:\[6,/]]) {
    await p.click(`button[data-mv="go"][data-a="${step}"]`); await p.waitForTimeout(200);
    await p.click(`button[data-mv="${btn}"]`); await p.waitForTimeout(300);
    assert(re.test(await calls()), 'шаг ' + step + ': сохранение вызывает сервер');
  }
  await p.click('button[data-mv="sdoc"]'); await p.waitForTimeout(300); assert(/ts2SystemDoc:\["SDOC-1",false\]/.test(await calls()), '«Открыть» документ');
  await p.click('button[data-mv="sdocr"]'); await p.waitForTimeout(300); assert(/ts2SystemDoc:\["SDOC-1",true\]/.test(await calls()), '«Обновить» документ');
  await p.click('button[data-mv="go"][data-a="4"]'); await p.waitForTimeout(400);
  await p.click('button[data-mv="snsAuto"]'); await p.waitForTimeout(300); assert(/ts2ObjectInputMode:\["OBJ-1","SENSOR"\]/.test(await calls()), '«Ввод: датчик»');
  await p.click('button[data-mv="snsCal"]'); await p.waitForTimeout(200);
  await p.fill('#mvf_calref', '4.5'); await p.fill('#mvf_calthm', 'Testo 104');
  await p.click('button[data-mv="snsCalSave"]'); await p.waitForTimeout(300); assert(/ts2SensorCalibrate:\["SNS-1","4.5"\]/.test(await calls()), '«Сверить» → сохранение сверки');
  assert.strictEqual(errs.length, 0, 'ошибки страницы: ' + errs.join('; '));
  await b.close(); console.log('OK: кнопки мастера, системных документов, ввода и сверки датчика вызывают сервер');
})().catch(e => { console.error(e); process.exit(1); });
