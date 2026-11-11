// Экран «Сейчас» без связи (браузер, Playwright): отметка «Да» уходит в очередь устройства и не теряется,
// после восстановления связи отправляется через mcReplayOffline. Запуск: node tests/now_offline.browser.test.js
const { chromium } = require('playwright'), path = require('path'), assert = require('assert');
(async () => {
  const b = await chromium.launch(), ctx = await b.newContext(), p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => {
    window.__net = true; window.__calls = [];
    const tasks = [{ id: 'EXP-1', title: 'Открытие смены', due: '09:00', overdue: false, mode: 'CONFIRM' }, { id: 'EXP-2', title: 'Санобработка', due: '15:00', overdue: false, mode: 'CONFIRM' }];
    const D = { uiMe: () => ({ ok: true, name: 'Повар Тест', role: 'Повар горячего цеха', sections: ['home'], dev: false, modules: {} }), getAppUrl: () => '', uiData: () => ({ ok: true, kpis: [], tabs: [] }),
      tsGetPlanInfo: () => JSON.stringify({ success: true, data: { plan: 'pro', planName: 'Pro', status: 'ACTIVE', mode: 'full', features: { journals: true }, plans: [], featureNames: {}, lockedSections: {} } }),
      ts2Now: () => JSON.stringify({ success: true, data: { mode: 'READY_TO_WORK', tasks: tasks.filter(t => !t.closed) } }),
      ts2Exceptions: () => JSON.stringify({ success: true, data: { exceptions: [], overdue: [], autoToday: 0 } }),
      ts2Confirm: (tok, id) => { tasks.find(t => t.id === id).closed = true; return JSON.stringify({ success: true, data: { id, result: 'CONFIRMED_BY_OPERATOR' } }); },
      mcReplayOffline: (fn, args, ts, id) => { const a = JSON.parse(args); window.__replayed = { fn, a, ts }; return D[fn](...a); } };
    // как в Apps Script: google.script.run — обычное свойство, with*Handler возвращают новый объект вызова
    function mk(st) { st = st || {}; return new Proxy({}, { get(t, k) {
      if (k === 'withSuccessHandler') return f => mk(Object.assign({}, st, { ok: f })); if (k === 'withFailureHandler') return f => mk(Object.assign({}, st, { fl: f })); if (k === 'withUserObject') return u => mk(Object.assign({}, st, { uo: u }));
      return (...a) => setTimeout(() => { window.__calls.push(k); const ok = st.ok || (() => {}), fl = st.fl || (() => {});
        if (!window.__net && !/^(uiMe|getAppUrl)$/.test(k)) return fl(new Error('NetworkError when attempting to fetch resource.'), st.uo);
        try { ok(D[k] ? D[k](...a) : { ok: true, data: [] }, st.uo); } catch (e) { fl(e, st.uo); } }, 5); } }); }
    window.google = { script: { run: mk() } };
  });
  await p.goto('file://' + path.join(__dirname, '..', 'app', 'Console.html'));
  await p.evaluate(() => { localStorage.setItem('mc_token', 'x'); TOKEN = 'x'; start(null); });
  await p.waitForTimeout(500);
  await p.evaluate(() => openView('tsNow')); await p.waitForTimeout(400);
  assert.strictEqual(await p.locator('button[data-mv="yes"]').count(), 2, 'две задачи');
  // связь пропала
  await p.evaluate(() => { window.__net = false; });
  await p.click('button[data-mv="yes"][data-a="EXP-1"]'); await p.waitForTimeout(500);
  const q = await p.evaluate(() => JSON.parse(localStorage.getItem('mc_offline_q') || '[]'));
  assert.strictEqual(q.length, 1, 'отметка в очереди устройства'); assert.strictEqual(q[0].fn, 'ts2Confirm');
  assert(!JSON.stringify(q).includes('"x"'), 'ключ сессии в очередь не записан');
  const msg = await p.textContent('#vmsg'); assert(/сохранена на устройстве/.test(msg), msg);
  assert.strictEqual(await p.locator('button[data-a="EXP-1"]').count(), 0, 'отмеченная задача скрыта — повторно не нажать');
  assert(/Нет связи: 1/.test(await p.textContent('#content')), 'видно, что отметка ждёт отправки');
  // связь вернулась
  await p.evaluate(() => { window.__net = true; window.dispatchEvent(new Event('online')); }); await p.waitForTimeout(1500);
  const rep = await p.evaluate(() => window.__replayed);
  assert(rep && rep.fn === 'ts2Confirm' && rep.a[1] === 'EXP-1' && rep.a[0] === 'x', 'отправлено через mcReplayOffline с сессией: ' + JSON.stringify(rep));
  assert(rep.ts && Date.now() - new Date(rep.ts) < 60000, 'передано время отметки на устройстве');
  assert.strictEqual(await p.evaluate(() => JSON.parse(localStorage.getItem('mc_offline_q') || '[]').length), 0, 'очередь пуста');
  assert.strictEqual(errs.length, 0, 'ошибки страницы: ' + errs.join('; '));
  await b.close(); console.log('OK: «Сейчас» без связи — очередь, без повторных нажатий, отправка с временем устройства');
})().catch(e => { console.error(e); process.exit(1); });
