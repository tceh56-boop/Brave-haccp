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
    adminNorms: () => { const d = n => { const x = new Date(Date.now() + n * 864e5); return x.toISOString().slice(0, 10); };
      return { ok: true, data: { version: '2026-11-11.1794412567084', today: d(0), statuses: ['ДЕЙСТВУЕТ', 'УТРАТИЛ СИЛУ', 'ПРОВЕРИТЬ'], thresholds: [180, 90, 30, 14, 7, 1, 0], alertTo: 'owner@test',
        norms: [{ code: 'PB-01', group: 'Пожарная безопасность', document: 'Постановление Правительства РФ от 16.09.2020 № 1479', title: 'Правила противопожарного режима в Российской Федерации', status: 'ДЕЙСТВУЕТ', validTo: '2026-12-31', daysLeft: 50, changedAt: '2026-11-11T08:00:00Z', changedBy: 'выпуск 2026-11-11.3', link: 'https://base.garant.ru/74680206/' },
          { code: 'SV-01', group: 'Услуги общепита', document: 'Постановление Правительства РФ от 21.09.2020 № 1515', title: 'Правила оказания услуг общественного питания', status: 'ДЕЙСТВУЕТ', validTo: '2027-01-01', daysLeft: 51, changedAt: '2026-11-11T08:00:00Z', changedBy: 'выпуск 2026-11-11.3' },
          { code: 'MO-01', group: 'Медосмотры', document: 'Приказ Минздрава России от 28.01.2021 № 29н', title: 'Порядок медосмотров', status: 'ДЕЙСТВУЕТ', validTo: d(1), daysLeft: 1, changedAt: '2026-11-11T08:00:00Z', changedBy: 'owner@test' },
          { code: 'GS-09', group: 'ГОСТ', document: 'ГОСТ Р 51705.1-2001', title: 'Управление качеством пищевых продуктов на основе принципов ХАССП', status: 'УТРАТИЛ СИЛУ', validTo: '', daysLeft: null, replacedBy: 'ГОСТ Р 51705.1-2024', changedAt: '2026-11-11T08:00:00Z', changedBy: 'owner@test' },
          { code: 'SN-08', group: 'СанПиН', document: 'СП 1.1.1058-01', title: 'Производственный контроль', status: 'ПРОВЕРИТЬ', validTo: '', daysLeft: null, changedAt: '2026-11-11T08:00:00Z', changedBy: 'выпуск 2026-11-11.3' },
          { code: 'SN-06', group: 'СанПиН', document: 'СанПиН 2.3/2.4.4282-26', title: 'Требования к организации общественного питания', status: 'ДЕЙСТВУЕТ', validTo: '2032-09-01', daysLeft: 2121, changedAt: '2026-11-11T08:00:00Z', changedBy: 'выпуск 2026-11-11.3' }],
        alerts: [{ alertId: 'ALR-1', at: '2026-11-11T09:00:00Z', kind: 'NORM_EXPIRING', objectId: 'PB-01', text: 'Постановление Правительства РФ от 16.09.2020 № 1479: действует до 31.12.2026, осталось 50 дн.' },
          { alertId: 'ALR-2', at: '2026-11-11T09:00:00Z', kind: 'NORM_REPEALED', objectId: 'GS-09', text: 'ГОСТ Р 51705.1-2001 утратил силу, заменён: ГОСТ Р 51705.1-2024. Клиенты получат изменение в течение суток.' }],
        clients: [{ orgId: 'ORG-1', name: 'Кафе Тест', normsVersion: '2026-11-11.1794412567084', normsExpired: 0, updatedAt: '2026-11-11T07:00:00Z', upToDate: true }, { orgId: 'ORG-2', name: 'Ресторан «Север»', normsVersion: '2026-11-10.1', normsExpired: 1, updatedAt: '2026-11-10T07:00:00Z', upToDate: false }] } }; },
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
  for (const s of ['norms', 'ent', 'releases', 'support', 'datareq', 'masters']) { await p.evaluate(x => go(x), s); await p.waitForTimeout(500); await p.screenshot({ path: path.join(OUT, 'admin_' + s + '.png'), fullPage: true }); }
  await p.evaluate(() => go('support')); await p.waitForTimeout(400);
  const ph = await p.evaluate(() => [...document.querySelectorAll('button')].map(b => b.textContent).join('|'));
  console.log('кнопки поддержки:', ph.slice(0, 300)); console.log('ошибки страницы:', errs.length ? errs.join('\n') : 'нет');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
