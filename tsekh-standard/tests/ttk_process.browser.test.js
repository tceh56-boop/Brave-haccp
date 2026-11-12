/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
// «Процессы ТТК»: модель, операции на проверку, замечания — кнопки вызывают сервер (Мастер-промт 4.0, этап 2).
// Запуск: node tests/ttk_process.browser.test.js
const { chromium } = require('playwright'), path = require('path'), assert = require('assert');
(async () => {
  const b = await chromium.launch(), p = await (await b.newContext()).newPage(), errs = []; p.on('pageerror', e => errs.push(String(e)));
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
  await p.evaluate(() => openView('tsTtkProc')); await p.waitForTimeout(500);
  const calls = () => p.evaluate(() => window.__calls.join('\n'));
  let txt = await p.textContent('#vbody'); assert(/Действующих ТТК/.test(txt) && /Жарка/.test(txt), 'модель показана: ' + txt.slice(0, 200));
  await p.click('button[data-mv="tab"][data-a="review"]'); await p.waitForTimeout(200);
  await p.click('button[data-mv="ok"][data-a="TPM-000001"]'); await p.waitForTimeout(300); assert(/ttkProcReview:\["x","TPM-000001","CONFIRMED"/.test(await calls()), 'подтвердить операцию');
  await p.click('button[data-mv="tab"][data-a="review"]'); await p.waitForTimeout(200);
  await p.click('button[data-mv="ai"][data-a="TPM-000001"]'); await p.waitForTimeout(300); assert(/ttkProcAiSuggest/.test(await calls()), 'подсказка AI');
  await p.click('button[data-mv="tab"][data-a="issues"]'); await p.waitForTimeout(200);
  txt = await p.textContent('#vbody'); assert(/нет охлаждения/.test(txt), 'замечания показаны');
  await p.evaluate(() => { window.prompt = (q) => /Обоснование|Доказательство/.test(q) ? 'журнал' : 'ОППУ термощуп'; });
  await p.click('button[data-mv="tab"][data-a="haccp"]'); await p.waitForTimeout(400);
  txt = await p.textContent('#vbody'); assert(/Выживание патогенов/.test(txt) && /Пробелы для ППК/.test(txt), 'опасности ХАССП показаны');
  await p.click('button[data-mv="hzYes"][data-a="HZ-1"]'); await p.waitForTimeout(500); assert(/haccpHazardDecide:\["x","HZ-1","да","ОППУ термощуп","журнал"\]/.test(await calls()), 'решение «значима» с мерой и доказательством');
  await p.click('button[data-mv="hzSync"]'); await p.waitForTimeout(400); assert(/haccpLinkSync/.test(await calls()), 'связать с ТТК');
  await p.click('button[data-mv="run"]'); await p.waitForTimeout(300); assert(/ttkProcAnalyze:\["x",""\]/.test(await calls()), 'анализ всех ТТК');
  await p.evaluate(() => { window.confirm = () => true; openView('ppkbuilder'); }); await p.waitForTimeout(400);
  txt = await p.textContent('#vbody'); assert(/Раздел заменён/.test(txt) && /единственный генератор ППК/.test(txt), 'конструктор ППК закрыт: ' + txt.slice(0, 150));
  await p.click('button[data-mv="imp"]'); await p.waitForTimeout(400); assert(/ppkLegacyImport:\["x"\]/.test(await calls()), 'перенос в ХАССП');
  await p.evaluate(() => openView('ttkppk')); await p.waitForTimeout(400); assert(/Раздел заменён/.test(await p.textContent('#vbody')), 'ТТК → ППК закрыт');
  await p.evaluate(() => openView('tsChecklists')); await p.waitForTimeout(400);
  txt = await p.textContent('#vbody'); assert(/ППК 2026/.test(txt) && /Нет периодичности · 1/.test(txt) && /Протокол лаборатории/.test(txt) && /медицинских допусков/.test(txt), 'чек-листы ППК: ' + txt.slice(0, 200));
  await p.click('button[data-mv="build"]'); await p.waitForTimeout(300); assert(/clgBuild:\["x"\]/.test(await calls()), 'обновить чек-листы');
  await p.evaluate(() => { window.prompt = () => '2'; openView('tsNow'); }); await p.waitForTimeout(500);
  txt = await p.textContent('#vbody'); assert(/Выполнено: смывы взяты/.test(txt) && /повторное исследование/.test(txt), 'чек-лист в задаче на экране «Сейчас»: ' + txt.slice(0, 300));
  txt = await p.textContent('#vbody'); assert(/Ожидают проверки — подтвердите устранение · 1/.test(txt) && /Повар Иванова/.test(txt) && /критическое/.test(txt), 'ожидают проверки: ' + txt.slice(0, 400));
  await p.click('button[data-mv="vok"][data-a="DV-9"]'); await p.waitForTimeout(400); assert(/vioVerify:\["x","DV-9",true,""\]/.test(await calls()), 'подтвердить устранение');
  await p.evaluate(() => openView('tsNow')); await p.waitForTimeout(500);
  await p.click('button[data-mv="no"][data-a="EXP-1"]'); await p.waitForTimeout(400);
  assert(/ts2Confirm:\["x","EXP-1",false,"Не выполнен пункт 2: Протокол лаборатории получен и приложен"/.test(await calls()), '«Нет» с номером пункта: ' + (await calls()).split('\n').filter(x => /ts2Confirm/.test(x)));
  assert.strictEqual(errs.length, 0, 'ошибки страницы: ' + errs.join('; '));
  await b.close(); console.log('OK: процессы ТТК — модель, проверка операций, замечания, опасности ХАССП, прежние разделы ППК, чек-листы ППК, проверка устранения нарушений');
})().catch(e => { console.error(e); process.exit(1); });
