// Снимки новых разделов админ-панели (контур 2.0) на проверочных данных: node tools/admin_shots.js <папка результата>
const { chromium } = require('playwright'), fs = require('fs'), path = require('path');
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const root = path.join(__dirname, '..', 'admin');
let html = fs.readFileSync(path.join(root, 'Index.html'), 'utf8').replace(/<\?!=\s*include\('Logo'\);?\s*\?>/g, '');
const tmp = path.join(OUT, 'admin_index.html'); fs.writeFileSync(tmp, html);
const fake = () => {
  const D = {
    adminMe: () => ({ ok: true, data: { email: 'owner@test', name: 'Владелец Тест', role: 'SUPER_ADMIN', roleName: 'Super Admin', can: ['*'] } }),
    adminDashboard: () => ({ ok: true, data: { m: {}, series: [], tariffs: [{ code: 'basic', name: 'Basic', features: [] }, { code: 'basic_pro', name: 'Basic Pro', features: [] }, { code: 'pro', name: 'Pro', features: [] }, { code: 'pro_max', name: 'Pro Max', features: [] }] } }),
    adminControlOverview: () => ({ ok: true, data: { steps: [['DRIVE_ROOT', 'Папка предприятия на Диске'], ['SPREADSHEET', 'Таблица предприятия'], ['SCRIPT_PROJECT', 'Проект Apps Script'], ['DEPLOYMENT', 'Развёртывание'], ['LICENSE', 'Лицензия'], ['DONE', 'Готово']],
      enterprises: [{ orgId: 'ORG-1', enterpriseId: 'ENT-0001', name: 'Кафе Тест', plan: 'pro_max', status: 'ACTIVE', version: '2.2.0', channel: 'pilot', onboarding: 'DONE', mode: 'READY_TO_WORK', readiness: 'READY 10/10', licenseMasked: 'TS-AB12-****-**34' },
        { orgId: 'ORG-2', enterpriseId: 'ENT-0002', name: 'Столовая Тест', plan: 'basic_pro', status: 'ACTIVE', version: '2.1.0', channel: 'stable', onboarding: 'SCRIPT_PROJECT: FAILED', mode: '', readiness: '', licenseMasked: 'TS-CD34-****-**56' }] } }),
    adminReleases: () => ({ ok: true, data: { releases: [{ releaseId: 'REL-1', version: '2.2.0', status: 'PILOT', notes: 'Режим «Готов к работе», ТТК → ТУ/СТО/ППК', createdAt: '2026-11-11T08:00:00Z', createdBy: 'owner@test' }],
      jobs: [{ version: '2.2.0', orgId: 'ORG-1', status: 'BACKUP_CONFIRMED', previousVersion: '2.1.0', backupConfirmedAt: '2026-11-11T09:10:00Z', errorMessage: '' }, { version: '2.2.0', orgId: 'ORG-2', status: 'BACKUP_REQUESTED', previousVersion: '2.1.0', backupConfirmedAt: '', errorMessage: '' }] } }),
    adminSupport: () => ({ ok: true, data: { tickets: [{ ticketId: 'TCK-1', createdAt: '2026-11-11T07:30:00Z', orgId: 'ORG-1', subject: 'Не печатается этикетка', text: 'После обновления этикетки печатаются пустыми', status: 'OPEN' }],
      sessions: [{ sessionId: 'SUP-1', requestedAt: '2026-11-11T08:00:00Z', orgId: 'ORG-1', reason: 'Проверить настройки печати', status: 'GRANTED', consentBy: 'Директорова Тест (Директор)', expiresAt: '2026-11-11T09:00:00Z' }],
      consents: [{ consentType: 'SUPPORT_ACCESS', orgId: 'ORG-1', grantedBy: 'Директорова Тест (Директор)', grantedAt: '2026-11-11T08:05:00Z', expiresAt: '2026-11-11T09:00:00Z' }], events: [{ at: '2026-11-11T08:20:00Z', orgId: 'ORG-1', level: 'ERROR', code: 'EXCEPTION', message: 'printLabel: Ошибка шаблона этикетки' }] } }),
    adminDataRequests: () => ({ ok: true, data: [{ requestId: 'DRQ-1', requestedAt: '2026-11-10T10:00:00Z', orgId: 'ORG-2', requestType: 'EXPORT', status: 'OPEN', comment: 'Выгрузка перед сменой бухгалтерии' }] }),
    adminMasters: () => ({ ok: true, data: { templates: [{ templateId: 'TPL-001', title: 'Положение о системе производственного контроля', approvalMode: 'AUTO_GENERATED', version: '2.1.0' }], rules: [{ ruleId: 'R-001', ruleCode: 'TTK_MISSING_YIELD', domain: 'ТТК', severity: 'BLOCKER' }],
      events: [{ eventRuleId: 'EVR-RELEASE-THERMAL-001', eventType: 'PRODUCTION_RELEASE', journalCode: 'J-KKT-THERMAL', measurementMode: 'SENSOR_OR_DERIVED_OR_PENDING' }], hazards: [{ hazardCode: 'MH-B-THERMAL', operation: 'THERMAL', hazardType: 'B', description: 'Выживание патогенов' }],
      seeds: [], features: [{ featureCode: 'journals', name: 'Журналы и режим «Готов к работе»', minPlan: 'basic_pro' }], usage: [{ date: '2026-11-11', orgId: 'ORG-1', metricsJson: '{"ttk":148,"staff":12,"autoRecords":420,"mode":"READY_TO_WORK"}', version: '2.2.0' }] } })
  };
  function mk() { let ok = () => {}, fl = () => {}; const o = new Proxy({}, { get(t, k) {
    if (k === 'withSuccessHandler') return f => { ok = f; return o; }; if (k === 'withFailureHandler') return f => { fl = f; return o; }; if (k === 'withUserObject') return () => o;
    return (...a) => setTimeout(() => { try { ok(D[k] ? D[k](...a) : { ok: true, data: [] }); } catch (e) { fl(e); } }, 10); } }); return o; }
  window.google = { script: { get run() { return mk(); } } };
  try { sessionStorage.setItem('tsa_token', 'x'); } catch (e) {}
};
(async () => {
  const b = await chromium.launch(), p = await (await b.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1, locale: 'ru-RU' })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e.stack || e).split('\n').slice(0, 3).join(' / '))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.addInitScript(fake); await p.goto('file://' + tmp); await p.waitForTimeout(800);
  for (const s of ['ent', 'releases', 'support', 'datareq', 'masters']) { await p.evaluate(x => go(x), s); await p.waitForTimeout(500); await p.screenshot({ path: path.join(OUT, 'admin_' + s + '.png'), fullPage: true }); }
  await p.evaluate(() => go('support')); await p.waitForTimeout(400);
  const ph = await p.evaluate(() => [...document.querySelectorAll('button')].map(b => b.textContent).join('|'));
  console.log('кнопки поддержки:', ph.slice(0, 300)); console.log('ошибки страницы:', errs.length ? errs.join('\n') : 'нет');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
