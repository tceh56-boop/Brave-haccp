/**
 * ЦЕХ Стандарт Admin — управляющий контур 2.0 (ТЗ 2.0 §6, §10–§13, §16–§18).
 *   • подготовка предприятия (provisioning): папка, таблица, проект скрипта, развёртывание — по шагам, идемпотентно;
 *   • релизы с пилотным каналом и задания обновления: сначала резервная копия у клиента, затем код;
 *   • поддержка: обращения клиента, сессии технического доступа только с согласия предприятия (CONSENTS);
 *   • агрегированная статистика без персональных данных, технические события, запросы на выгрузку/удаление данных;
 *   • эталонные справочники (шаблоны документов, правила событий, пакеты настройки, правила сверки, опасности);
 *   • идемпотентность платёжных уведомлений (WEBHOOK_EVENTS по хешу события).
 * Управляющий контур не хранит рабочие данные предприятия (ТТК, журналы, сотрудников) — только служебные сведения.
 */

/* ------------------------------------------------------------------ эталоны (заполняются при первой настройке) */
var MASTER_SEED_VERSION_ = '2.1.0';
var MASTER_TEMPLATES_ = [
  ['TPL-001', 'Положение о системе производственного контроля', 'PPK', 'AUTO_GENERATED'], ['TPL-002', 'Программа производственного контроля', 'PPK', 'AUTO_GENERATED'],
  ['TPL-003', 'План ХАССП', 'PPK', 'AUTO_GENERATED'], ['TPL-004', 'Реестр опасностей', 'PPK', 'AUTO_GENERATED'], ['TPL-005', 'Реестр ККТ', 'PPK', 'AUTO_GENERATED'],
  ['TPL-006', 'Матрица ответственности', 'ACT', 'AUTO_GENERATED'], ['TPL-007', 'Типовые журналы контроля', 'OTHER', 'PROVIDER_TEMPLATE'], ['TPL-008', 'Чек-листы открытия и закрытия смены', 'OTHER', 'PROVIDER_TEMPLATE'],
  ['TPL-009', 'Инструкция по приёмке сырья', 'INSTRUCTION', 'PROVIDER_TEMPLATE'], ['TPL-010', 'Инструкция по хранению', 'INSTRUCTION', 'PROVIDER_TEMPLATE'], ['TPL-011', 'Инструкция по маркировке', 'INSTRUCTION', 'PROVIDER_TEMPLATE'],
  ['TPL-012', 'Инструкция по обработке сырья', 'INSTRUCTION', 'PROVIDER_TEMPLATE'], ['TPL-013', 'Инструкция по выпуску продукции', 'INSTRUCTION', 'PROVIDER_TEMPLATE'], ['TPL-014', 'Инструкция по уборке и санобработке', 'INSTRUCTION', 'PROVIDER_TEMPLATE'],
  ['TPL-015', 'Инструкция по обращению с отходами', 'INSTRUCTION', 'PROVIDER_TEMPLATE'], ['TPL-016', 'Инструкция по действиям при отклонении', 'INSTRUCTION', 'PROVIDER_TEMPLATE'], ['TPL-017', 'Должностные инструкции', 'INSTRUCTION', 'AUTO_GENERATED'],
  ['TPL-018', 'Инструкции по охране труда', 'INSTRUCTION', 'AUTO_GENERATED'], ['TPL-019', 'Акт списания', 'ACT', 'PROVIDER_TEMPLATE'], ['TPL-020', 'Акт несоответствия', 'ACT', 'PROVIDER_TEMPLATE'],
  ['TPL-021', 'Корректирующее действие', 'ACT', 'PROVIDER_TEMPLATE'], ['TPL-022', 'Внутреннее расследование', 'ACT', 'PROVIDER_TEMPLATE'], ['TPL-023', 'Реестр оборудования', 'OTHER', 'PROVIDER_TEMPLATE'],
  ['TPL-024', 'Реестр договоров', 'OTHER', 'PROVIDER_TEMPLATE'], ['TPL-025', 'Реестр нормативов', 'NORM', 'PROVIDER_TEMPLATE']
];
var MASTER_RULES_ = [['R-001', 'TTK_MISSING_YIELD', 'ТТК', 'BLOCKER'], ['R-002', 'TTK_NO_COMPOSITION', 'ТТК', 'BLOCKER'], ['R-003', 'TTK_NO_SHELF_SOURCE', 'ТТК', 'MAJOR'], ['R-004', 'DUPLICATE_TTK', 'ТТК', 'MAJOR'],
  ['R-005', 'PRODUCT_UNIT_CONFLICT', 'Продукты', 'MAJOR'], ['R-006', 'EMPLOYEE_WITHOUT_MED_DOC', 'Персонал', 'CRITICAL'], ['R-007', 'ROLE_WITHOUT_INSTRUCTION', 'Охрана труда', 'MINOR'], ['R-008', 'CONTRACT_EXPIRING', 'Договоры', 'MAJOR'],
  ['R-009', 'DOC_EXPIRED', 'Документы', 'CRITICAL'], ['R-010', 'CCP_WITHOUT_JOURNAL', 'ХАССП', 'MAJOR'], ['R-011', 'ORG_REQUISITES_MISSING', 'Организация', 'CRITICAL'], ['R-012', 'DIRECTOR_MISSING', 'Персонал', 'BLOCKER'],
  ['R-013', 'HACCP_RESPONSIBLE_MISSING', 'ХАССП', 'BLOCKER'], ['R-014', 'NORM_NOT_VERIFIED', 'Нормативы', 'MINOR'], ['R-015', 'SYSTEM_DOC_NOT_APPROVED', 'Документы', 'MAJOR'],
  ['R-016', 'NORM_EXPIRING', 'Нормативы', 'MAJOR'], ['R-017', 'NORM_EXPIRED', 'Нормативы', 'CRITICAL']];
var MASTER_EVENTS_ = [['EVR-RECEIVING-001', 'RECEIVING_CONFIRMED', 'INCOMING_CONTROL', 'J-RECEIVING', 'MEASURE_IF_REQUIRED'], ['EVR-BATCH-OPEN-001', 'BATCH_OPENED', 'BATCH_OPENING', 'J-MARKING', 'NONE'],
  ['EVR-RELEASE-THERMAL-001', 'PRODUCTION_RELEASE', 'HACCP_FACT', 'J-KKT-THERMAL', 'SENSOR_OR_DERIVED_OR_PENDING'], ['EVR-RELEASE-MARKING-001', 'PRODUCTION_RELEASE', 'MARKING', 'J-MARKING', 'NONE'],
  ['EVR-HALL-SAMPLE-001', 'RELEASE_TO_HALL', 'DAILY_SAMPLE', 'J-SAMPLES', 'CONFIRMATION'], ['EVR-SANITATION-001', 'SANITATION_CONFIRMED', 'SANITATION', 'J-SANITATION', 'CONFIRMATION'],
  ['EVR-COOLING-001', 'COOLING_FINISHED', 'HACCP_FACT', 'J-COOLING', 'SENSOR_OR_DERIVED_OR_PENDING'], ['EVR-REHEAT-001', 'REHEAT_FINISHED', 'HACCP_FACT', 'J-REHEAT', 'SENSOR_OR_DERIVED_OR_PENDING']];
var MASTER_HAZ_ = [['MH-B-THERMAL', 'THERMAL', 'B', 'Выживание патогенов при недостаточной тепловой обработке'], ['MH-B-COOLING', 'COOLING', 'B', 'Рост микрофлоры при медленном охлаждении'],
  ['MH-B-REHEAT', 'REHEAT', 'B', 'Выживание микрофлоры при недостаточном разогреве'], ['MH-B-DEFROST', 'DEFROST', 'B', 'Рост микрофлоры при нарушении режима размораживания'],
  ['MH-P-METAL', 'MECHANICAL', 'P', 'Металлические и посторонние примеси'], ['MH-B-CROSS', 'MECHANICAL', 'B', 'Перекрёстное загрязнение через инвентарь'], ['MH-C-OIL', 'FRYING', 'C', 'Продукты окисления фритюрного жира'],
  ['MH-B-RECONT', 'ASSEMBLY', 'B', 'Повторное обсеменение готовой продукции'], ['MH-A-CROSS', 'ASSEMBLY', 'A', 'Перекрёстный контакт с аллергенами'], ['MH-B-STORAGE', 'STORAGE', 'B', 'Рост микрофлоры при нарушении хранения']];
var MASTER_IMPORT_PROFILES_ = [['IMP-TTK', 'TTK', ['name', 'yield', 'composition', 'technology', 'shelfLife', 'storage'], 0.8], ['IMP-CONTRACT', 'CONTRACT', ['number', 'date', 'counterparty', 'inn', 'validTo', 'subject'], 0.8],
  ['IMP-CERT', 'CERTIFICATE', ['number', 'date', 'product', 'validTo'], 0.8], ['IMP-LAB', 'LAB_PROTOCOL', ['number', 'date', 'lab', 'indicators'], 0.85]];
/** Заполнить эталонные листы (повторный запуск ничего не дублирует). */
function seedControlMasters_() {
  return withLock(function () {
    var n = 0, have = function (sh, k, v) { return !!findBy(sh, k, v); };
    MASTER_TEMPLATES_.forEach(function (t) { if (!have('MASTER_DOCUMENT_TEMPLATES', 'templateId', t[0])) { n++; insert('MASTER_DOCUMENT_TEMPLATES', { templateId: t[0], title: t[1], documentType: t[2], approvalMode: t[3], defaultStatus: t[3] === 'AUTO_GENERATED' ? 'AUTO_PREPARED' : 'ACTIVE_TEMPLATE', requiresLocalApproval: t[3] === 'AUTO_GENERATED', approverRole: t[3] === 'AUTO_GENERATED' ? 'Директор' : '', version: MASTER_SEED_VERSION_, status: 'PUBLISHED' }); } });
    MASTER_RULES_.forEach(function (r) { if (!have('MASTER_RULES', 'ruleId', r[0])) { n++; insert('MASTER_RULES', { ruleId: r[0], ruleCode: r[1], domain: r[2], severity: r[3], name: r[1], requiresHumanApproval: r[3] !== 'CRITICAL', version: '2.0.0', status: 'PUBLISHED' }); } });
    MASTER_EVENTS_.forEach(function (r) { if (!have('MASTER_EVENT_RULES', 'eventRuleId', r[0])) { n++; insert('MASTER_EVENT_RULES', { eventRuleId: r[0], eventType: r[1], createsRecordType: r[2], journalCode: r[3], measurementMode: r[4], title: r[0], version: 1, status: 'PUBLISHED' }); } });
    MASTER_HAZ_.forEach(function (h) { if (!have('MASTER_HAZARDS', 'hazardCode', h[0])) { n++; insert('MASTER_HAZARDS', { hazardCode: h[0], operation: h[1], hazardType: h[2], description: h[3], version: '2.2.0', status: 'PUBLISHED' }); } });
    MASTER_IMPORT_PROFILES_.forEach(function (p) { if (!have('IMPORT_PROFILES', 'profileId', p[0])) { n++; insert('IMPORT_PROFILES', { profileId: p[0], documentType: p[1], fieldsJson: JSON.stringify(p[2]), minConfidence: p[3], version: '2.0.0', status: 'PUBLISHED' }); } });
    if (!have('RECONCILIATION_PROFILES', 'profileId', 'RCP-DEFAULT')) { n++; insert('RECONCILIATION_PROFILES', { profileId: 'RCP-DEFAULT', name: 'Стандартная сверка', ruleIds: MASTER_RULES_.map(function (r) { return r[0]; }).join(','), version: '2.0.0', status: 'PUBLISHED' }); }
    if (!have('MASTER_SEED_PACKAGES', 'packageId', 'SEED-' + MASTER_SEED_VERSION_)) { n++; insert('MASTER_SEED_PACKAGES', { packageId: 'SEED-' + MASTER_SEED_VERSION_, version: MASTER_SEED_VERSION_, enterpriseType: '*',
      templatesJson: JSON.stringify(MASTER_TEMPLATES_.map(function (t) { return t[0]; })), rulesJson: JSON.stringify(MASTER_EVENTS_.map(function (r) { return r[0]; })), zonesJson: JSON.stringify(['HOT', 'COLD', 'CONF', 'RAW_STORE', 'CHILL', 'FREEZE', 'DISPATCH', 'WASTE', 'SANIT']), status: 'PUBLISHED', createdAt: new Date() }); }
    var names = { ttk: 'Загрузка ТТК', shelf_life: 'Сроки реализации', kbju: 'КБЖУ', storage: 'Сроки хранения', costing: 'Себестоимость', receiving: 'Приёмка', labeling: 'Маркировка', economics: 'Экономика', labor_safety: 'Нормативы и охрана труда', core: 'Базовые функции',
      journals: 'Журналы и режим «Готов к работе»', ppk: 'ППК и генерация СТО/ППК из ТТК', batches: 'Партии', lab: 'Лабораторные исследования и ТУ', contracts: 'Договоры', ai: 'AI-ассистент', ttk_library: 'База отработанных ТТК' };
    Object.keys(PLAN_FEATURES_).forEach(function (plan) { PLAN_FEATURES_[plan].forEach(function (f) { if (!have('FEATURE_CATALOG', 'featureCode', f)) { n++; insert('FEATURE_CATALOG', { featureCode: f, name: names[f] || f, minPlan: plan, description: '', limitsJson: '{}', status: 'ACTIVE' }); } }); });
    return n;
  });
}

/* ------------------------------------------------------------------ идемпотентность платёжных уведомлений */
/** Возвращает true, если это уведомление уже обрабатывалось (повтор провайдера). Хеш — от сырого содержимого. */
function webhookSeen_(e, provider) {
  var raw = JSON.stringify(e && e.parameter || {}) + '|' + String(e && e.postData && e.postData.contents || ''), h = sha256(raw);
  return withLock(function () {
    if (findBy('WEBHOOK_EVENTS', 'rawEventHash', h)) return { seen: true, hash: h };
    insert('WEBHOOK_EVENTS', { rawEventHash: h, provider: provider || '', receivedAt: new Date(), result: 'RECEIVED', invoice: (e.parameter || {}).label || '', externalId: (e.parameter || {}).operation_id || '' });
    return { seen: false, hash: h };
  });
}
function webhookResult_(h, result) { try { withLock(function () { update('WEBHOOK_EVENTS', h, { result: String(result).slice(0, 100) }); }); } catch (e) {} }

/* ------------------------------------------------------------------ подготовка предприятия (provisioning) */
var PROVISION_STEPS_ = [['DRIVE_ROOT', 'Папка предприятия на Диске'], ['SPREADSHEET', 'Таблица предприятия'], ['SCRIPT_PROJECT', 'Проект Apps Script с кодом эталона'], ['DEPLOYMENT', 'Развёртывание веб-приложения'], ['LICENSE', 'Лицензия'], ['DONE', 'Готово к первому входу']];
function scriptApi_(method, path, body) {
  var r = UrlFetchApp.fetch('https://script.googleapis.com/v1/projects' + path, { method: method, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, contentType: 'application/json', muteHttpExceptions: true, payload: body ? JSON.stringify(body) : undefined });
  if (r.getResponseCode() >= 300) throw new Error('Apps Script API HTTP ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
  return JSON.parse(r.getContentText() || '{}');
}
function stepDone_(orgId, code) { return readAll('ENTERPRISE_ONBOARDING').some(function (s) { return s.orgId === orgId && s.stepCode === code && s.status === 'DONE'; }); }
function stepMark_(o, code, status, result, err, who) {
  insert('ENTERPRISE_ONBOARDING', { stepId: newId('ONB'), enterpriseId: enterpriseIdOf_(o), orgId: o['ID'], stepCode: code, status: status, startedAt: new Date(), completedAt: status === 'DONE' ? new Date() : '', resultJson: JSON.stringify(result || {}).slice(0, 2000), errorMessage: err || '', by: who || '' });
}
function resource_(o, type, googleId, url, note) {
  if (readAll('ENTERPRISE_RESOURCES').some(function (r) { return r.orgId === o['ID'] && r.resourceType === type && r.googleId === googleId; })) return;
  insert('ENTERPRISE_RESOURCES', { resourceId: newId('RES'), enterpriseId: enterpriseIdOf_(o), orgId: o['ID'], resourceType: type, googleId: googleId, url: url || '', status: 'ACTIVE', createdAt: new Date(), checkedAt: new Date(), note: note || '' });
}
/** Пройти шаги подготовки; уже выполненные пропускаются. Повторный вызов продолжает с первого невыполненного шага. */
function provisionOrg_(s, orgId) {
  var o = findBy('Organizations', 'ID', orgId); if (!o) throw new Error('NOT_FOUND: клиент не найден');
  var ent = enterpriseIdOf_(o), out = [], who = s ? s.email : 'система', P = PropertiesService.getScriptProperties();
  var run = function (code, fn) {
    if (stepDone_(orgId, code)) { out.push({ step: code, status: 'SKIPPED (уже выполнен)' }); return true; }
    try { var r = fn(); withLock(function () { stepMark_(o, code, 'DONE', r, '', who); }); out.push({ step: code, status: 'DONE', result: r }); o = findBy('Organizations', 'ID', orgId); return true; }
    catch (e) { withLock(function () { stepMark_(o, code, 'FAILED', null, String(e.message || e), who); }); out.push({ step: code, status: 'FAILED', error: String(e.message || e) }); return false; }
  };
  var folderName = ent + ' — ' + o['Название'], folder = null;
  var ok1 = run('DRIVE_ROOT', function () {
    var it = DriveApp.getFoldersByName(folderName); folder = it.hasNext() ? it.next() : DriveApp.createFolder(folderName);
    resource_(o, 'DRIVE_ROOT', folder.getId(), folder.getUrl(), folderName); return { folderId: folder.getId() };
  });
  if (!ok1) return out;
  if (!folder) { var r0 = readAll('ENTERPRISE_RESOURCES').filter(function (r) { return r.orgId === orgId && r.resourceType === 'DRIVE_ROOT'; })[0]; folder = r0 ? DriveApp.getFolderById(r0.googleId) : null; }
  var ok2 = run('SPREADSHEET', function () {
    if (o['Google Drive ID']) { resource_(o, 'SPREADSHEET', o['Google Drive ID'], 'https://docs.google.com/spreadsheets/d/' + o['Google Drive ID'], 'указана вручную'); return { spreadsheetId: o['Google Drive ID'], existing: true }; }
    var ss = SpreadsheetApp.create('ЦЕХ Стандарт — ' + o['Название']); DriveApp.getFileById(ss.getId()).moveTo(folder);
    withLock(function () { update('Organizations', orgId, { 'Google Drive ID': ss.getId() }); });
    resource_(o, 'SPREADSHEET', ss.getId(), ss.getUrl(), ''); return { spreadsheetId: ss.getId() };
  });
  if (!ok2) return out;
  var master = P.getProperty('MASTER_SCRIPT_ID');
  var ok3 = run('SCRIPT_PROJECT', function () {
    if (!master) throw new Error('не задано свойство MASTER_SCRIPT_ID (проект-эталон)');
    var sid = o['Script ID'];
    if (!sid) { var pr = scriptApi_('post', '', { title: 'ЦЕХ Стандарт — ' + o['Название'], parentId: o['Google Drive ID'] }); sid = pr.scriptId; withLock(function () { update('Organizations', orgId, { 'Script ID': sid }); }); }
    var content = scriptApi_('get', '/' + master + '/content');
    var files = content.files.map(function (f) { return f.name === 'Code' ? { name: f.name, type: f.type, source: f.source.replace(/var\s+SHEET_ID\s*=\s*'[^']*'/, "var SHEET_ID        = '" + o['Google Drive ID'] + "'") } : f; });
    scriptApi_('put', '/' + sid + '/content', { files: files });
    resource_(o, 'SCRIPT_PROJECT', sid, 'https://script.google.com/d/' + sid + '/edit', ''); return { scriptId: sid };
  });
  if (!ok3) return out;
  var ok4 = run('DEPLOYMENT', function () {
    if (o['App URL']) return { appUrl: o['App URL'], existing: true };
    var sid = o['Script ID'], ver = scriptApi_('post', '/' + sid + '/versions', { description: 'ЦЕХ Стандарт — первая установка' });
    var dep = scriptApi_('post', '/' + sid + '/deployments', { versionNumber: ver.versionNumber, manifestFileName: 'appsscript', description: 'ЦЕХ Стандарт' });
    var url = ((dep.entryPoints || []).filter(function (e) { return e.entryPointType === 'WEB_APP'; })[0] || {}).webApp; url = url && url.url || '';
    withLock(function () { update('Organizations', orgId, { 'App URL': url }); });
    resource_(o, 'DEPLOYMENT', dep.deploymentId || '', url, 'версия ' + ver.versionNumber); return { deploymentId: dep.deploymentId, appUrl: url, note: 'Первый запуск авторизует владелец таблицы (окно разрешений Google).' };
  });
  if (!ok4) return out;
  run('LICENSE', function () { return { masked: o['License Key'] || 'выпускается при создании клиента' }; });
  run('DONE', function () { return { at: isoDay() }; });
  return out;
}

/* ------------------------------------------------------------------ релизы и обновления */
function latestRelease_(channel) {
  var rel = readAll('APP_RELEASES').filter(function (r) { return r.status === 'STABLE' || (channel === 'pilot' && r.status === 'PILOT'); });
  if (!rel.length) { var u = readAll('Updates').filter(function (x) { return x['Статус'] === 'PUBLISHED'; }).reverse()[0]; return u ? { version: u['Версия'], notes: u['Описание'] } : null; }
  return rel.sort(function (a, b) { return verCmp_(a.version, b.version); }).pop();
}
function verCmp_(a, b) { a = String(a).split('.').map(Number); b = String(b).split('.').map(Number); for (var i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0); } return 0; }
/** Клиент сообщил о свежей резервной копии → задания обновления этого клиента переходят в «копия подтверждена». */
function confirmUpdateBackups_(orgId, at) {
  readAll('UPDATE_JOBS').filter(function (j) { return j.orgId === orgId && j.status === 'BACKUP_REQUESTED' && new Date(at) >= new Date(j.backupRequestedAt); }).forEach(function (j) {
    update('UPDATE_JOBS', j.jobId, { status: 'BACKUP_CONFIRMED', backupConfirmedAt: new Date(at) });
    insert('UPDATE_RESULTS', { resultId: newId('UPR'), jobId: j.jobId, orgId: orgId, step: 'BACKUP', status: 'OK', at: new Date(), details: 'резервная копия клиента получена' });
  });
}
function updateOneOrg_(o, content, version) {
  var files = content.files.map(function (f) { return f.name === 'Code' && o['Google Drive ID'] ? { name: f.name, type: f.type, source: f.source.replace(/var\s+SHEET_ID\s*=\s*'[^']+'/, "var SHEET_ID        = '" + o['Google Drive ID'] + "'") } : f; });
  scriptApi_('put', '/' + o['Script ID'] + '/content', { files: files });
  var ver = scriptApi_('post', '/' + o['Script ID'] + '/versions', { description: 'ЦЕХ Стандарт ' + version });
  var dep = (/\/macros\/s\/([\w-]+)\/exec/.exec(String(o['App URL'] || '')) || [])[1];
  if (dep) scriptApi_('put', '/' + o['Script ID'] + '/deployments/' + dep, { deploymentConfig: { scriptId: o['Script ID'], versionNumber: ver.versionNumber, manifestFileName: 'appsscript', description: 'ЦЕХ Стандарт ' + version } });
  return { versionNumber: ver.versionNumber, deployment: dep || '' };
}

/* ------------------------------------------------------------------ поддержка и согласия */
function supportRequestsFor_(orgId) {
  return readAll('SUPPORT_SESSIONS').filter(function (x) { return x.orgId === orgId && x.status === 'REQUESTED'; }).map(function (x) { return { sessionId: x.sessionId, reason: x.reason, scope: x.scope, minutes: x.minutes, requestedBy: x.requestedBy }; });
}

/* ------------------------------------------------------------------ API для систем клиентов (вызывается из API.gs) */
function apiControl_(p) {
  var org = verifyClient_(p); if (!org) return { ok: false, error: 'Подпись запроса не принята' };
  var ent = enterpriseIdOf_(org);
  if (p.action === 'release.check') { var ch = org['Канал обновлений'] === 'pilot' ? 'pilot' : 'stable', r = latestRelease_(ch); return { ok: true, channel: ch, release: r ? { version: r.version, notes: r.notes || '', schemaVersion: r.schemaVersion || '' } : null }; }
  if (p.action === 'support.request') {
    var t = { ticketId: newId('TCK'), enterpriseId: ent, orgId: org['ID'], subject: String(p.subject || 'Обращение').slice(0, 200), text: String(p.text || '').slice(0, 4000), status: 'OPEN', createdAt: new Date(), createdBy: String(p.author || '').slice(0, 100), assignedTo: '', resolvedAt: '', resolution: '' };
    withLock(function () { insert('SUPPORT_TICKETS', t); }); logEvent('SUPPORT', 'клиент', org['ID'], 'Обращение: ' + t.subject); return { ok: true, ticketId: t.ticketId };
  }
  if (p.action === 'support.consent') {
    var se = findBy('SUPPORT_SESSIONS', 'sessionId', p.sessionId); if (!se || se.orgId !== org['ID']) return { ok: false, error: 'Запрос доступа не найден' };
    if (p.revoke === true) {   // предприятие отозвало доступ досрочно
      if (se.status !== 'GRANTED') return { ok: true, status: se.status };
      withLock(function () { update('SUPPORT_SESSIONS', se.sessionId, { status: 'REVOKED', closedAt: new Date() });
        readAll('CONSENTS').filter(function (c) { return c.objectId === se.sessionId && !c.revokedAt; }).forEach(function (c) { update('CONSENTS', c.consentId, { revokedAt: new Date() }); }); });
      PropertiesService.getScriptProperties().deleteProperty('DIAG_' + se.sessionId);
      logEvent('SUPPORT', 'клиент', org['ID'], 'Доступ поддержки отозван предприятием'); return { ok: true, status: 'REVOKED' };
    }
    if (se.status !== 'REQUESTED') return { ok: false, error: 'Запрос доступа уже рассмотрен' };
    var allow = p.allow === true, exp = new Date(Date.now() + Math.min(480, Number(se.minutes) || 60) * 60000);
    withLock(function () {
      update('SUPPORT_SESSIONS', se.sessionId, { status: allow ? 'GRANTED' : 'DENIED', consentBy: String(p.by || '').slice(0, 100), consentAt: new Date(), expiresAt: allow ? exp : '' });
      insert('CONSENTS', { consentId: newId('CNS'), enterpriseId: ent, orgId: org['ID'], consentType: 'SUPPORT_ACCESS', objectId: se.sessionId, grantedBy: String(p.by || '').slice(0, 100), grantedAt: new Date(), expiresAt: allow ? exp : '', revokedAt: allow ? '' : new Date(), evidence: 'подписанный запрос клиента' });
    });
    if (allow && p.diagKey) PropertiesService.getScriptProperties().setProperty('DIAG_' + se.sessionId, String(p.diagKey).slice(0, 200));   // ключ — только в свойствах скрипта
    logEvent('SUPPORT', 'клиент', org['ID'], 'Доступ поддержки ' + (allow ? 'разрешён до ' + fmtDate(exp, 'dd.MM.yyyy HH:mm') : 'отклонён'));
    return { ok: true, status: allow ? 'GRANTED' : 'DENIED', expiresAt: allow ? exp.getTime() : 0 };
  }
  if (p.action === 'usage.report') {
    var m = p.metrics || {}, clean = {}; ['sheets', 'rows', 'ttk', 'staff', 'autoRecords', 'expectationsOpen', 'exceptionsOpen', 'readiness', 'schemaVersion', 'mode'].forEach(function (k) { if (m[k] !== undefined) clean[k] = typeof m[k] === 'number' ? m[k] : String(m[k]).slice(0, 40); });
    withLock(function () {
      insert('AGGREGATED_USAGE', { usageId: newId('USG'), enterpriseId: ent, orgId: org['ID'], date: isoDay(), metricsJson: JSON.stringify(clean), version: String(p.version || '') });
      var ap = findBy('ENTERPRISE_AUTOMATION_PROFILES', 'enterpriseId', ent), row = { enterpriseId: ent, orgId: org['ID'], mode: clean.mode || '', seedVersion: m.seedVersion || '', enterpriseType: m.enterpriseType || '', readiness: clean.readiness || '', updatedAt: new Date() };
      if (ap) update('ENTERPRISE_AUTOMATION_PROFILES', ent, row); else insert('ENTERPRISE_AUTOMATION_PROFILES', row);
    });
    return { ok: true };
  }
  if (p.action === 'tech.event') { withLock(function () { insert('TECH_EVENTS', { eventId: newId('TEV'), enterpriseId: ent, orgId: org['ID'], level: String(p.level || 'ERROR').slice(0, 10), code: String(p.code || '').slice(0, 60), message: String(p.message || '').slice(0, 500), version: String(p.version || ''), at: new Date() }); }); return { ok: true }; }
  if (p.action === 'reconciliation.template') return { ok: true, rules: readAll('MASTER_RULES').filter(function (r) { return r.status === 'PUBLISHED'; }), profiles: readAll('IMPORT_PROFILES'), reconciliation: readAll('RECONCILIATION_PROFILES') };
  if (p.action === 'seed.package') {
    var pk = readAll('MASTER_SEED_PACKAGES').filter(function (x) { return x.status === 'PUBLISHED'; }).sort(function (a, b) { return verCmp_(a.version, b.version); }).pop();
    return { ok: true, package: pk || null, templates: readAll('MASTER_DOCUMENT_TEMPLATES'), eventRules: readAll('MASTER_EVENT_RULES'), hazards: readAll('MASTER_HAZARDS') };
  }
  return { ok: false, error: 'unknown action' };
}

/* ------------------------------------------------------------------ экраны админ-панели */
function adminControlOverview(token) {
  try {
    requireRole(token, 'clients.view');
    var orgs = readAll('Organizations').filter(function (o) { return o['Статус'] !== 'DELETED'; }), onb = readAll('ENTERPRISE_ONBOARDING'), prof = readAll('ENTERPRISE_AUTOMATION_PROFILES');
    return ok({ enterprises: orgs.map(function (o) {
      var steps = onb.filter(function (s) { return s.orgId === o['ID']; }), last = steps[steps.length - 1] || {}, ap = prof.filter(function (x) { return x.orgId === o['ID']; })[0] || {};
      return { orgId: o['ID'], enterpriseId: o['EnterpriseID'] || '', name: o['Название'], plan: o['Тариф'], status: o['Статус'], version: o['Версия'], channel: o['Канал обновлений'] || 'stable',
        onboarding: stepDone_(o['ID'], 'DONE') ? 'DONE' : (last.stepCode ? last.stepCode + ': ' + last.status : 'NOT_STARTED'), mode: ap.mode || '', readiness: ap.readiness || '', licenseMasked: o['License Key'] };
    }), steps: PROVISION_STEPS_ });
  } catch (e) { return fail(e); }
}
function adminProvision(token, orgId) {
  try { var s = requireRole(token, 'provision'); var r = provisionOrg_(s, orgId); logEvent('PROVISION', s.email, orgId, r.map(function (x) { return x.step + ':' + x.status; }).join(', ')); return ok(r); }
  catch (e) { return fail(e); }
}
function adminOnboarding(token, orgId) { try { requireRole(token, 'clients.view'); return ok({ steps: readAll('ENTERPRISE_ONBOARDING').filter(function (s) { return s.orgId === orgId; }), resources: readAll('ENTERPRISE_RESOURCES').filter(function (r) { return r.orgId === orgId; }) }); } catch (e) { return fail(e); } }
function adminSetChannel(token, orgId, channel) {
  try {
    var s = requireRole(token, 'releases'); if (['stable', 'pilot'].indexOf(channel) < 0) throw new Error('VALIDATION: канал stable или pilot');
    withLock(function () { update('Organizations', orgId, { 'Канал обновлений': channel }); }); logEvent('UPDATE', s.email, orgId, 'Канал обновлений: ' + channel); return ok(true);
  } catch (e) { return fail(e); }
}
function adminReleases(token) { try { requireRole(token, 'dashboard'); return ok({ releases: readAll('APP_RELEASES').reverse(), jobs: readAll('UPDATE_JOBS').reverse().slice(0, 300) }); } catch (e) { return fail(e); } }
/** Новый релиз выходит в пилотный канал; в стабильный — только после promote. */
function adminReleaseCreate(token, r) {
  try {
    var s = requireRole(token, 'releases'); r = r || {}; req(r, ['version', 'notes']);
    if (!/^\d+\.\d+\.\d+$/.test(r.version)) throw new Error('VALIDATION: версия вида 2.2.0');
    if (readAll('APP_RELEASES').some(function (x) { return x.version === r.version; })) throw new Error('VALIDATION: такая версия уже есть');
    var id = newId('REL');
    withLock(function () { insert('APP_RELEASES', { releaseId: id, version: r.version, channel: 'pilot', status: 'PILOT', notes: r.notes, schemaVersion: r.schemaVersion || '', createdAt: new Date(), createdBy: s.email, promotedAt: '', promotedBy: '', masterScriptId: PropertiesService.getScriptProperties().getProperty('MASTER_SCRIPT_ID') || '', rollbackOf: r.rollbackOf || '' }); });
    logEvent('UPDATE', s.email, r.version, 'Релиз в пилотном канале'); return ok({ releaseId: id });
  } catch (e) { return fail(e); }
}
function adminReleasePromote(token, releaseId, status) {
  try {
    var s = requireRole(token, 'releases'); status = status || 'STABLE'; if (['STABLE', 'WITHDRAWN'].indexOf(status) < 0) throw new Error('VALIDATION: STABLE или WITHDRAWN');
    var r = findBy('APP_RELEASES', 'releaseId', releaseId); if (!r) throw new Error('NOT_FOUND: релиз не найден');
    if (status === 'STABLE') { var pilots = readAll('UPDATE_JOBS').filter(function (j) { return j.releaseId === releaseId; }); if (pilots.some(function (j) { return j.status === 'FAILED'; })) throw new Error('VALIDATION: у пилотных обновлений есть ошибки — разберите их до перевода в стабильный канал'); }
    withLock(function () { update('APP_RELEASES', releaseId, { status: status, channel: status === 'STABLE' ? 'stable' : r.channel, promotedAt: new Date(), promotedBy: s.email }); if (status === 'STABLE') setSetting('CURRENT_VERSION', r.version, 'Текущая версия клиентской системы'); });
    logEvent('UPDATE', s.email, r.version, 'Релиз: ' + status); return ok(true);
  } catch (e) { return fail(e); }
}
/** Задания обновления: клиенту ставится команда «резервная копия»; код обновляется только после её подтверждения. */
function adminUpdateJobsCreate(token, releaseId, orgIds) {
  try {
    var s = requireRole(token, 'releases'), r = findBy('APP_RELEASES', 'releaseId', releaseId); if (!r) throw new Error('NOT_FOUND: релиз не найден');
    if (r.status === 'WITHDRAWN') throw new Error('VALIDATION: релиз отозван');
    var orgs = readAll('Organizations').filter(function (o) { return o['Статус'] === 'ACTIVE' && o['Script ID'] && (orgIds && orgIds.length ? orgIds.indexOf(o['ID']) >= 0 : (r.status === 'PILOT' ? o['Канал обновлений'] === 'pilot' : true)); });
    var made = 0;
    withLock(function () {
      orgs.forEach(function (o) {
        if (readAll('UPDATE_JOBS').some(function (j) { return j.orgId === o['ID'] && j.releaseId === releaseId && ['DONE', 'FAILED', 'CANCELLED'].indexOf(j.status) < 0; })) return;
        insert('UPDATE_JOBS', { jobId: newId('UPJ'), releaseId: releaseId, version: r.version, enterpriseId: enterpriseIdOf_(o), orgId: o['ID'], status: 'BACKUP_REQUESTED', createdAt: new Date(), createdBy: s.email, backupRequestedAt: new Date(), backupConfirmedAt: '', startedAt: '', completedAt: '', errorMessage: '', previousVersion: o['Версия'] || '' });
        queueCommand_(o['ID'], 'backup'); made++;
      });
    });
    logEvent('UPDATE', s.email, r.version, 'Заданий обновления: ' + made + ' (ожидают резервной копии клиента)'); return ok({ created: made });
  } catch (e) { return fail(e); }
}
/** Выполнить задания с подтверждённой копией. force=true (только Super Admin) — без подтверждения копии. */
function adminUpdateJobsRun(token, releaseId, force) {
  try {
    var s = requireRole(token, 'releases'), r = findBy('APP_RELEASES', 'releaseId', releaseId); if (!r) throw new Error('NOT_FOUND: релиз не найден');
    if (force && s.role !== 'SUPER_ADMIN') throw new Error('FORBIDDEN: запуск без резервной копии — только Super Admin');
    var master = PropertiesService.getScriptProperties().getProperty('MASTER_SCRIPT_ID'); if (!master) throw new Error('VALIDATION: не задано свойство MASTER_SCRIPT_ID');
    var content = scriptApi_('get', '/' + master + '/content'), res = [];
    readAll('UPDATE_JOBS').filter(function (j) { return j.releaseId === releaseId && (j.status === 'BACKUP_CONFIRMED' || (force && j.status === 'BACKUP_REQUESTED')); }).forEach(function (j) {
      var o = findBy('Organizations', 'ID', j.orgId);
      withLock(function () { update('UPDATE_JOBS', j.jobId, { status: 'RUNNING', startedAt: new Date() }); });
      try {
        var x = updateOneOrg_(o, content, r.version);
        withLock(function () { update('UPDATE_JOBS', j.jobId, { status: 'DONE', completedAt: new Date() }); insert('UPDATE_RESULTS', { resultId: newId('UPR'), jobId: j.jobId, orgId: j.orgId, step: 'CODE', status: 'OK', at: new Date(), details: JSON.stringify(x) }); });
        res.push({ org: o['Название'], ok: true });
      } catch (e) {
        withLock(function () { update('UPDATE_JOBS', j.jobId, { status: 'FAILED', completedAt: new Date(), errorMessage: String(e.message || e).slice(0, 300) }); insert('UPDATE_RESULTS', { resultId: newId('UPR'), jobId: j.jobId, orgId: j.orgId, step: 'CODE', status: 'FAILED', at: new Date(), details: String(e.message || e).slice(0, 300) }); });
        res.push({ org: o['Название'], ok: false, error: String(e.message || e) });
      }
    });
    logEvent('UPDATE', s.email, r.version, 'Выполнено заданий: ' + res.filter(function (x) { return x.ok; }).length + ' из ' + res.length);
    return ok(res);
  } catch (e) { return fail(e); }
}
function adminSupport(token) { try { requireRole(token, 'support'); return ok({ tickets: readAll('SUPPORT_TICKETS').reverse(), sessions: readAll('SUPPORT_SESSIONS').reverse(), consents: readAll('CONSENTS').reverse().slice(0, 200), events: readAll('TECH_EVENTS').reverse().slice(0, 200) }); } catch (e) { return fail(e); } }
/** Запрос технического доступа: клиент увидит его при следующей проверке лицензии и решит сам. */
function adminSupportSessionRequest(token, orgId, reason, minutes, ticketId) {
  try {
    var s = requireRole(token, 'support'), o = findBy('Organizations', 'ID', orgId); if (!o) throw new Error('NOT_FOUND: клиент не найден');
    if (!String(reason || '').trim()) throw new Error('VALIDATION: укажите причину доступа');
    var id = newId('SUP');
    withLock(function () { insert('SUPPORT_SESSIONS', { sessionId: id, enterpriseId: enterpriseIdOf_(o), orgId: orgId, ticketId: ticketId || '', reason: reason, scope: 'READ_DIAGNOSTICS', minutes: Math.min(480, Number(minutes) || 60), status: 'REQUESTED', requestedBy: s.email, requestedAt: new Date(), consentBy: '', consentAt: '', expiresAt: '', closedAt: '' }); });
    logEvent('SUPPORT', s.email, orgId, 'Запрошен доступ поддержки: ' + reason); return ok({ sessionId: id });
  } catch (e) { return fail(e); }
}
/** Диагностика системы клиента по разрешённой сессии: только чтение, без персональных данных; каждое чтение — в аудите клиента. */
function adminSupportDiagnostics(token, sessionId) {
  try {
    var s = requireRole(token, 'support'), se = findBy('SUPPORT_SESSIONS', 'sessionId', sessionId); if (!se) throw new Error('NOT_FOUND: сессия не найдена');
    if (se.status !== 'GRANTED' || !se.expiresAt || new Date(se.expiresAt) < new Date()) throw new Error('VALIDATION: доступ не разрешён клиентом или срок истёк');
    var key = PropertiesService.getScriptProperties().getProperty('DIAG_' + sessionId), o = findBy('Organizations', 'ID', se.orgId);
    if (!key) throw new Error('VALIDATION: клиент не передал ключ диагностики (обновите систему клиента)');
    if (!o || !o['App URL']) throw new Error('VALIDATION: у клиента не указан адрес системы (App URL)');
    var r = UrlFetchApp.fetch(String(o['App URL']) + (String(o['App URL']).indexOf('?') >= 0 ? '&' : '?') + 'diag=' + encodeURIComponent(key), { muteHttpExceptions: true, followRedirects: true });
    var d = {}; try { d = JSON.parse(r.getContentText()); } catch (e) { d = { ok: false, error: 'ответ не JSON (HTTP ' + r.getResponseCode() + ')' }; }
    logEvent('SUPPORT', s.email, se.orgId, 'Чтение диагностики по сессии ' + sessionId + ': ' + (d.ok ? 'OK' : d.error));
    return ok(d);
  } catch (e) { return fail(e); }
}
function adminSupportClose(token, kind, id, resolution) {
  try {
    var s = requireRole(token, 'support');
    withLock(function () { if (kind === 'ticket') update('SUPPORT_TICKETS', id, { status: 'RESOLVED', resolvedAt: new Date(), resolution: resolution || '', assignedTo: s.email }); else update('SUPPORT_SESSIONS', id, { status: 'CLOSED', closedAt: new Date() }); });
    if (kind !== 'ticket') PropertiesService.getScriptProperties().deleteProperty('DIAG_' + id);
    logEvent('SUPPORT', s.email, id, 'Закрыто: ' + (resolution || '')); return ok(true);
  } catch (e) { return fail(e); }
}
function adminDataRequests(token) { try { requireRole(token, 'data_requests'); return ok(readAll('DATA_REQUESTS').reverse()); } catch (e) { return fail(e); } }
/** Запрос по данным предприятия (152-ФЗ / договор): выгрузка, удаление, передача. Исполнение — командой клиенту и вручную; здесь учёт и сроки. */
function adminDataRequestSave(token, r) {
  try {
    var s = requireRole(token, 'data_requests'); r = r || {};
    if (r.requestId) { withLock(function () { update('DATA_REQUESTS', r.requestId, { status: r.status, comment: r.comment || '', completedAt: r.status === 'DONE' ? new Date() : '', resultFileId: r.resultFileId || '' }); }); return ok(true); }
    req(r, ['orgId', 'requestType']); if (['EXPORT', 'DELETE', 'TRANSFER', 'RECTIFY'].indexOf(r.requestType) < 0) throw new Error('VALIDATION: тип EXPORT, DELETE, TRANSFER или RECTIFY');
    var o = findBy('Organizations', 'ID', r.orgId); if (!o) throw new Error('NOT_FOUND: клиент не найден');
    var id = newId('DRQ'); withLock(function () { insert('DATA_REQUESTS', { requestId: id, enterpriseId: enterpriseIdOf_(o), orgId: r.orgId, requestType: r.requestType, status: 'OPEN', requestedAt: new Date(), requestedBy: s.email, completedAt: '', resultFileId: '', comment: r.comment || '' }); });
    logEvent('DATA', s.email, r.orgId, 'Запрос по данным: ' + r.requestType); return ok({ requestId: id });
  } catch (e) { return fail(e); }
}
function adminMasters(token) {
  try { requireRole(token, 'dashboard'); return ok({ templates: readAll('MASTER_DOCUMENT_TEMPLATES'), rules: readAll('MASTER_RULES'), events: readAll('MASTER_EVENT_RULES'), hazards: readAll('MASTER_HAZARDS'), seeds: readAll('MASTER_SEED_PACKAGES'), features: readAll('FEATURE_CATALOG'), usage: readAll('AGGREGATED_USAGE').reverse().slice(0, 200) }); }
  catch (e) { return fail(e); }
}
function adminSeedMasters(token) { try { var s = requireRole(token, 'settings.view'); var n = seedControlMasters_(); logEvent('CHANGE', s.email, 'masters', 'Эталоны: добавлено ' + n); return ok({ added: n }); } catch (e) { return fail(e); } }
