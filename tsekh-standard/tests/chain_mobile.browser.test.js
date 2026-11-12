/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
// Мастер-промт 4.0, этап 8: цепочка контроля на телефоне (390 px) — без горизонтальной прокрутки, переходы между разделами,
// запись-доказательство из аудита 360°, единый список нарушений. Запуск: node tests/chain_mobile.browser.test.js
const { chromium } = require('playwright'), path = require('path'), assert = require('assert');
(async () => {
  const b = await chromium.launch(), p = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage(), errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => {
    window.__calls = []; window.open = () => ({ location: '', close() {}, document: { write() {}, close() {} } });
    const st = { mode: 'READY_TO_WORK', enterpriseType: 'RESTAURANT', types: { RESTAURANT: 'Ресторан' }, org: { name: 'Тест', inn: '', address: '', responsible: '', complete: false }, timezone: 'Europe/Moscow', employees: 1, dishes: 1,
      workshops: [{ workshopId: 'WS-1', name: 'Горячий цех', status: 'ACTIVE', notApplicableReason: '' }], objects: [], summary: { created: 1, requiresDecision: 1, numericObjects: 0, blockers: 0 } };
    const D = { uiMe: () => ({ ok: true, name: 'Директор Тест', role: 'Директор', sections: ['home'], dev: true, modules: {} }), getAppUrl: () => '', uiData: () => ({ ok: true, kpis: [], tabs: [] }),
      tsGetPlanInfo: () => JSON.stringify({ success: true, data: { plan: 'pro', planName: 'Pro', status: 'ACTIVE', mode: 'full', features: { journals: true, ppk: true }, plans: [], featureNames: {}, lockedSections: {} } }),
      ts2Wizard: () => JSON.stringify({ success: true, data: st }), v43GetDashboard: () => ({ openTasks: 1 }), v43GetMyTasks: () => [], v43GetLinks: () => [{ linkId: 'L1', text: 'Дезинфекция столов', disinfectantId: 'D1', regimeId: 'RG-1', method: 'PRODUCT_NAME', confidence: 0.82, status: 'REVIEW' }], v43GetDeviations: () => [{ alertId: 'A1', at: '2026-11-11T10:00', message: 'Концентрация 0.3', status: 'OPEN' }, { alertId: 'A2', at: '2026-11-11T11:00', message: 'x', status: 'VERIFY_REQUIRED' }], v43ReviewLink: () => ({ ok: true }), v43ResolveDeviation: () => ({ ok: true }), v43VerifyDeviation: () => ({ ok: true }), ts2WizardSave: () => JSON.stringify({ success: true, data: st }), ts2Sensors: () => JSON.stringify({ success: true, data: { url: '', devices: [{ deviceId: 'SNS-1', object: 'Холодильник', objectId: 'OBJ-1', status: 'ACTIVE', inputMode: 'MANUAL', lastValue: 4.2, silentMin: 2, rssi: -60, offset: 0, calibratedAt: '', calDueDays: 90 }], calibrations: [] } }),
      ttkProcOverview: () => JSON.stringify({ success: true, data: { ttk: { ACTIVE: 3, DRAFT: 1 }, analyzed: 3, model: [{ processCode: 'FRY', name: 'Жарка', ttkCount: 2, reviewRequired: 1 }], review: [{ id: 'TPM-000001', ttkId: 'M1', process: 'Жарка', text: 'Обжарить или запечь', parent: '', confidence: 0.6, method: 'DICTIONARY', note: '' }],
        issues: [{ ttkId: 'T2', code: 'NO_COOLING_STAGE', message: 'После тепловой обработки продукт хранится, но этап охлаждения не описан' }], issuesTotal: 1, dictionary: [], dictVersion: 'x' } }),
      haccpLinkMap: () => JSON.stringify({ success: true, data: { counts: { NEEDS_DECISION: 1 }, gaps: ['значимая опасность «x»: нет ККТ/ОППУ и доказательства'], rows: [{ processName: 'Жарка', ttkCount: 2, hazard: 'Выживание патогенов', controlMeasure: '', journalId: 'J-KKT-THERMAL', status: 'NEEDS_DECISION', v30HazardId: 'HZ-1', controlType: '' }] } }),
      haccpHazardDecide: () => JSON.stringify({ success: true, data: { needDecision: 0 } }), haccpLinkSync: () => JSON.stringify({ success: true, data: { processesAdded: 1, hazardsProposed: 2, needDecision: 2 } }),
      ppkLegacyState: () => JSON.stringify({ success: true, data: { v35: { processes: 2, hazards: 3, controls: 1 }, v37: { controls: 2 }, importedToV30: 0 } }),
      ppkLegacyImport: () => JSON.stringify({ success: true, data: { processes: 2, hazards: 3, controls: 3, needBinding: 1 } }),
      clgTemplates: () => JSON.stringify({ success: true, data: { ppk: { id: 'PPK-1', name: 'ППК 2026', version: 2 }, templates: [
        { id: 'CLT-1', title: 'Смывы с рук: Лабораторное исследование: БГКП', items: ['Выполнено: Лабораторное исследование', 'Протокол лаборатории получен и приложен'], mode: 'TASK', coveredBy: '', frequency: 'раз в 30 дней', time: '10:00', role: 'Ответственный за ХАССП', journal: 'LAB:L1' },
        { id: 'CLT-2', title: 'Вентиляция: Чистка фильтров', items: ['Выполнено: Чистка фильтров'], mode: 'NO_SCHEDULE', coveredBy: '', frequency: '', time: '10:00', role: 'Директор', journal: '' },
        { id: 'CLT-3', title: 'Персонал: допуск', items: ['x'], mode: 'COVERED', coveredBy: 'Контроль медицинских допусков смены (экран «Сейчас»)', frequency: 'ежедневно', time: '10:00', role: 'Шеф-повар', journal: '' }] } }),
      clgBuild: () => JSON.stringify({ success: true, data: { ppkId: 'PPK-1', TASK: 1, EVENT: 2, COVERED: 1, DATE: 1, NO_SCHEDULE: 1 } }),
      ts2Exceptions: () => JSON.stringify({ success: true, data: { exceptions: [], autoCount: 0 } }),
      ts2Now: () => JSON.stringify({ success: true, data: { mode: 'READY_TO_WORK', tasks: [{ id: 'EXP-1', title: 'ППК: Смывы с рук: БГКП', due: '10:00', overdue: false, checklist: ['Выполнено: смывы взяты', 'Протокол лаборатории получен и приложен'], onFail: 'повторное исследование' }] } }),
      vioList: () => JSON.stringify({ success: true, data: { mode: 'SECOND_PERSON', items: [{ id: 'DV-9', object: 'Холодильник 2', text: 't° 9 °C', status: 'ожидает проверки', corrector: 'Повар Иванова', at: '2026-11-12T10:00', critical: true }, { id: 'DV-8', object: 'x', text: 'y', status: 'открыто', at: '' }] } }),
      vioVerify: () => JSON.stringify({ success: true, data: { status: 'устранено' } }),
      a360Run: () => JSON.stringify({ success: true, data: { overall: 'NOT_READY', score: 64, runId: 'RDY-1', note: 'Готовность по внутреннему контрольному листу. Не является заключением надзорного органа.', html: '<h2>Акт</h2>',
        counts: { PASS: 9, FAIL: 3, REVIEW: 2, MISSING_EVIDENCE: 1, NOT_APPLICABLE: 1 }, items: [
          { id: 'R22', area: 'HACCP', requirement: 'Анализ опасностей по операциям ТТК', status: 'FAIL', blocking: true, detail: 'без решения: 2', evidence: ['HZ-PROC-TTK-FRY-MH-B-THERMAL'], correctiveAction: 'Примите решения', go: { module: 'tsTtkProc' } },
          { id: 'R01', area: 'Нормативы', requirement: 'СанПиН', status: 'PASS', blocking: true, detail: '', evidence: ['N-1'], correctiveAction: '' },
          { id: 'R27', area: 'Нарушения', requirement: 'Нарушения устраняются', status: 'REVIEW', blocking: false, detail: 'ждут проверки: 1', evidence: ['DV-9'], correctiveAction: 'Проверьте', go: { module: 'tsNow' } }] } }),
      a360MigrateViolations: () => JSON.stringify({ success: true, data: { migrated: 2 } }),
      a360Evidence: (tok, id) => JSON.stringify({ success: true, data: { id, kind: 'Опасность (анализ опасностей ХАССП)', sheet: 'HACCP_Опасности_V30', module: 'tsTtkProc', fields: [['HazardID', id], ['Hazard', 'Выживание патогенов при недостаточной прожарке очень длинным текстом без пробелов_____________________________'], ['Status', 'PROPOSED']], related: [] } }),
      v65GetPpkList: () => JSON.stringify({ success: true, data: { items: [{ ppkId: 'PPK-1', name: 'Программа производственного контроля', version: 2, from: '12.11.2026', to: '', status: 'ACTIVE', statusRu: 'Действует', approvedBy: 'Директор' }] } }),
      vioCorrect: () => JSON.stringify({ success: true, data: { status: 'ожидает проверки' } }), vioSetVerifyMode: () => JSON.stringify({ success: true, data: { mode: 'SELF' } }),
      ts2Confirm: () => JSON.stringify({ success: true, data: { result: 'FAIL' } }),
      ttkProcAnalyze: () => JSON.stringify({ success: true, data: { analyzed: 3, added: ['a'], removed: [], openIssues: 1 } }), ttkProcReview: () => JSON.stringify({ success: true, data: { status: 'CONFIRMED' } }),
      ttkProcAiSuggest: () => JSON.stringify({ success: true, data: { suggested: 'FRY', note: 'Предложение не утверждено' } }),
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
  const calls = () => p.evaluate(() => window.__calls.join('\n'));
  const overflow = () => p.evaluate(() => { const W = document.documentElement.clientWidth, bad = []; document.querySelectorAll('#vbody *, #mdlBox *').forEach(e => { const b = e.getBoundingClientRect(); if (b.width && b.right > W + 1 && !e.closest('.tw') && getComputedStyle(e).position !== 'fixed') bad.push(e.tagName + '.' + e.className); }); return { sw: document.documentElement.scrollWidth, W, bad: bad.slice(0, 5) }; });
  for (const v of ['tsTtkProc', 'tsChecklists', 'tsNow', 'tsViolations', 'tsAudit360', 'ppkbuilder', 'ttkppk', 'ppk']) {
    await p.evaluate(v => { window.confirm = () => true; window.prompt = () => 'x'; openView(v); }, v); await p.waitForTimeout(450);
    const r = await overflow(); assert(r.sw <= r.W && !r.bad.length, v + ': горизонтальная прокрутка на телефоне ' + JSON.stringify(r));
  }
  // полоса цепочки: текущий шаг отмечен, переход «Опасности ХАССП» открывает нужную вкладку
  await p.evaluate(() => openView('tsChecklists')); await p.waitForTimeout(400);
  assert.strictEqual(await p.locator('nav.tschain [aria-current="step"]').textContent(), 'Чек-листы');
  await p.click('nav.tschain button:has-text("Опасности ХАССП")'); await p.waitForTimeout(600);
  assert(/Операция → опасность → мера → журнал/.test(await p.textContent('#vbody')) && /Опасности ХАССП/.test(await p.locator('nav.tschain [aria-current="step"]').textContent()), 'переход в опасности ХАССП');
  // аудит 360°: ID доказательства — ссылка на запись
  await p.evaluate(() => openView('tsAudit360')); await p.waitForTimeout(500);
  await p.click('#vbody .cards a:has-text("HZ-PROC-TTK-FRY-MH-B-THERMAL")'); await p.waitForTimeout(400);
  const mdl = await p.textContent('#mdlBox'); assert(/Опасность \(анализ опасностей ХАССП\)/.test(mdl) && /PROPOSED/.test(mdl), 'запись открыта: ' + mdl.slice(0, 200));
  const ro = await overflow(); assert(ro.sw <= ro.W && !ro.bad.length, 'карточка записи на телефоне: ' + JSON.stringify(ro));
  await p.click('#mdlBox button:has-text("Открыть раздел")'); await p.waitForTimeout(600);
  assert(/Операция → опасность → мера → журнал/.test(await p.textContent('#vbody')), '«Открыть раздел» ведёт к опасности');
  // нарушения: устранение и проверка
  await p.evaluate(() => openView('tsViolations')); await p.waitForTimeout(400);
  const vt = await p.textContent('#vbody'); assert(/Ждут проверки/.test(vt) && /экран «Сейчас»|журналы/.test(vt) || /Холодильник 2/.test(vt), vt.slice(0, 300));
  await p.click('#vbody .cards button[data-mv="fix"][data-a="DV-8"]'); await p.waitForTimeout(400); assert(/vioCorrect:\["x","DV-8","x","x"\]/.test(await calls()), 'устранение');
  await p.click('#vbody .cards button[data-mv="vok"][data-a="DV-9"]'); await p.waitForTimeout(400); assert(/vioVerify:\["x","DV-9",true/.test(await calls()), 'подтверждение');
  await p.selectOption('#mvf_vmode', 'SELF'); await p.click('button[data-mv="mode"]'); await p.waitForTimeout(400); assert(/vioSetVerifyMode:\["x","SELF"\]/.test(await calls()), 'режим проверки — для директора');
  assert.strictEqual(errs.length, 0, 'ошибки страницы: ' + errs.join('; '));
  await b.close(); console.log('OK: цепочка контроля на телефоне — без прокрутки, переходы, запись-доказательство, нарушения');
})().catch(e => { console.error(e); process.exit(1); });
