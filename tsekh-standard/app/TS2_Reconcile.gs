/**
 * ЦЕХ Стандарт 2.0 — сверка и адаптация (ТЗ 2.0 §6.12, §7.10–7.14, §10.4–10.5, §15.3).
 *   правило → проблема (RECONCILIATION_ISSUES) → предложение (CHANGE_PROPOSALS) → согласование (APPROVALS)
 *   → резервная копия → применение порциями под блокировкой → аудит → проверка инвариантов → откат при необходимости.
 * Существующие листы читаются адаптерами и меняются только по согласованному предложению.
 */
var TS2_SEVERITY_ = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'];

/* ------------------------------------------------------------------ адаптеры существующих листов */
function _ts2Legacy_(sheet) {
  var sh = _book_().getSheetByName(sheet); if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getRange(1, 1, sh.getLastRow(), Math.max(1, sh.getLastColumn())).getValues(), h = v[0].map(String), out = [];
  for (var i = 1; i < v.length; i++) { if (v[i].every(function (x) { return x === '' || x === null; })) continue; var o = { _row: i + 1, _v: v[i] }; h.forEach(function (k, j) { o[k] = v[i][j]; }); out.push(o); }
  return out;
}
function _ts2Dishes_() {
  var comp = {}; _ts2Legacy_('Состав').forEach(function (r) { var c = String(r._v[0]); (comp[c] = comp[c] || []).push({ name: String(r._v[1]), unit: String(r._v[2] || ''), qty: Number(r._v[3]) || 0, base: Number(r._v[4]) || 0, netto: Number(r._v[5]) || 0 }); });
  return _ts2Legacy_('Блюда').map(function (r) {
    return { code: String(r._v[0]), name: String(r._v[1]), category: String(r._v[2] || ''), yield: r._v[3], method: String(r._v[5] || ''), workshop: String(r._v[8] || ''), shelfHours: r._v[9], _row: r._row, comp: comp[String(r._v[0])] || [] };
  }).filter(function (d) { return d.code && d.name; });
}
function _ts2Employees_() {
  return _ts2Legacy_('Сотрудники').map(function (r) { return { name: [r._v[0], r._v[1], r._v[2]].filter(Boolean).join(' '), position: String(r._v[3] || ''), role: String(r._v[4] || ''), active: r._v[12] !== false }; })
    .filter(function (e) { return e.name && e.active; });
}

/* ------------------------------------------------------------------ правила (машинная форма — RECONCILIATION_RULES_2.0.json) */
var TS2_RULES_ = [
  { ruleId: 'R-001', ruleCode: 'TTK_MISSING_YIELD', domain: 'ТТК', severity: 'BLOCKER', name: 'У ТТК нет выхода', requiresHumanApproval: true },
  { ruleId: 'R-002', ruleCode: 'TTK_NO_COMPOSITION', domain: 'ТТК', severity: 'BLOCKER', name: 'У ТТК нет состава', requiresHumanApproval: true },
  { ruleId: 'R-003', ruleCode: 'TTK_NO_SHELF_SOURCE', domain: 'ТТК', severity: 'MAJOR', name: 'Срок реализации не задан или указан без основания', requiresHumanApproval: true },
  { ruleId: 'R-004', ruleCode: 'DUPLICATE_TTK', domain: 'ТТК', severity: 'MAJOR', name: 'Дубликат ТТК (то же название или тот же состав)', requiresHumanApproval: true },
  { ruleId: 'R-005', ruleCode: 'PRODUCT_UNIT_CONFLICT', domain: 'Продукты и единицы', severity: 'MAJOR', name: 'Один продукт в несовместимых единицах', requiresHumanApproval: true },
  { ruleId: 'R-006', ruleCode: 'EMPLOYEE_WITHOUT_MED_DOC', domain: 'Сотрудники и роли', severity: 'CRITICAL', name: 'У сотрудника нет действующего медицинского допуска', requiresHumanApproval: true },
  { ruleId: 'R-007', ruleCode: 'ROLE_WITHOUT_INSTRUCTION', domain: 'Охрана труда', severity: 'MINOR', name: 'Должность без должностной инструкции', requiresHumanApproval: true },
  { ruleId: 'R-008', ruleCode: 'CONTRACT_EXPIRING', domain: 'Договоры', severity: 'MAJOR', name: 'Договор истекает в ближайшие 30 дней', requiresHumanApproval: false },
  { ruleId: 'R-009', ruleCode: 'DOC_EXPIRED', domain: 'Документы и сроки', severity: 'CRITICAL', name: 'Документ или договор истёк', requiresHumanApproval: false },
  { ruleId: 'R-010', ruleCode: 'CCP_WITHOUT_JOURNAL', domain: 'ХАССП', severity: 'MAJOR', name: 'ККТ не связана с журналом', requiresHumanApproval: true },
  { ruleId: 'R-011', ruleCode: 'ORG_REQUISITES_MISSING', domain: 'Организация', severity: 'CRITICAL', name: 'Не заполнены реквизиты организации', requiresHumanApproval: false },
  { ruleId: 'R-012', ruleCode: 'DIRECTOR_MISSING', domain: 'Сотрудники и роли', severity: 'BLOCKER', name: 'Не назначен директор', requiresHumanApproval: false },
  { ruleId: 'R-013', ruleCode: 'HACCP_RESPONSIBLE_MISSING', domain: 'ХАССП', severity: 'BLOCKER', name: 'Не назначен ответственный за ХАССП', requiresHumanApproval: false },
  { ruleId: 'R-014', ruleCode: 'NORM_NOT_VERIFIED', domain: 'Документы и сроки', severity: 'MINOR', name: 'Норматив не сверен с первоисточником', requiresHumanApproval: false },
  { ruleId: 'R-015', ruleCode: 'SYSTEM_DOC_NOT_APPROVED', domain: 'ППК', severity: 'MAJOR', name: 'Локальный документ ждёт утверждения предприятия', requiresHumanApproval: true },
  { ruleId: 'R-016', ruleCode: 'NORM_EXPIRING', domain: 'Документы и сроки', severity: 'MAJOR', name: 'Срок действия норматива заканчивается в ближайшие 120 дней', requiresHumanApproval: false },
  { ruleId: 'R-017', ruleCode: 'NORM_EXPIRED', domain: 'Документы и сроки', severity: 'CRITICAL', name: 'Срок действия норматива истёк, а он отмечен как действующий', requiresHumanApproval: false },
  { ruleId: 'R-018', ruleCode: 'THERMOMETER_MERCURY', domain: 'Оборудование', severity: 'CRITICAL', name: 'Ртутный термометр в реестре (СанПиН 2.3/2.4.4282-26, п. 48)', requiresHumanApproval: false },
  { ruleId: 'R-019', ruleCode: 'STORE_CLIMATE_OBJECT_MISSING', domain: 'ХАССП', severity: 'MINOR', name: 'Нет объекта замера температуры и влажности склада (п. 35, 40)', requiresHumanApproval: false },
  { ruleId: 'R-020', ruleCode: 'SENSOR_SILENT', domain: 'ХАССП', severity: 'MAJOR', name: 'Датчик температуры не присылает показания больше часа', requiresHumanApproval: false },
  { ruleId: 'R-021', ruleCode: 'SENSOR_CALIBRATION_DUE', domain: 'Оборудование', severity: 'MINOR', name: 'Датчик не сверялся с поверенным термометром больше 3 месяцев', requiresHumanApproval: false }
];
function _ts2Rule_(code) { return TS2_RULES_.filter(function (r) { return r.ruleCode === code; })[0]; }

/** Выполнить все правила; вернуть список {rule, entityType, entityId, field, current, expected, message, action, ownerRole, proposal?}. */
function _ts2Evaluate_() {
  var out = [], add = function (code, et, eid, field, cur, exp, msg, action, role, proposal) { out.push({ rule: _ts2Rule_(code), entityType: et, entityId: eid, field: field || '', current: cur, expected: exp, message: msg, action: action, ownerRole: role, proposal: proposal || null }); };
  var dishes = _ts2Dishes_(), today = Utilities.formatDate(new Date(), _mcTz_(), 'yyyy-MM-dd');
  var byName = {}, byComp = {};
  dishes.forEach(function (d) {
    var y = Number(String(d.yield).replace(',', '.'));
    if (!(y > 0)) {
      var sumNet = d.comp.reduce(function (s, c) { return s + (c.netto || c.base || 0); }, 0);
      add('TTK_MISSING_YIELD', 'DISH', d.code, 'Выход', d.yield, 'выход в граммах', 'ТТК «' + d.name + '»: не указан выход', sumNet ? 'Проверить предложение: выход = сумма нетто по составу (' + Math.round(sumNet) + ' г)' : 'Указать выход по ТТК', 'Шеф-повар',
        sumNet ? { operationType: 'UPDATE', entityType: 'DISH', entityId: d.code, target: { sheet: 'Блюда', row: d._row, col: 4 }, before: d.yield, after: Math.round(sumNet), reason: 'Выход не указан; предложено как сумма нетто по составу ТТК', risk: 'MEDIUM' } : null);
    }
    if (!d.comp.length) add('TTK_NO_COMPOSITION', 'DISH', d.code, 'Состав', '', 'не менее одной строки', 'ТТК «' + d.name + '»: нет состава', 'Внести состав по ТТК', 'Шеф-повар');
    if (!(Number(d.shelfHours) > 0)) add('TTK_NO_SHELF_SOURCE', 'DISH', d.code, 'Срок реализации (ч)', d.shelfHours, 'часы по ТТК или таблице сроков', 'ТТК «' + d.name + '»: срок реализации не задан', 'Задать срок в карте блюда или в утверждённой таблице сроков', 'Шеф-повар');
    var n = _ts2NormName_(d.name); (byName[n] = byName[n] || []).push(d);
    if (d.comp.length) { var k = d.comp.map(function (c) { return _ts2NormName_(c.name) + ':' + c.qty; }).sort().join('|'); (byComp[k] = byComp[k] || []).push(d); }
  });
  var dupSeen = {};
  [byName, byComp].forEach(function (m, idx) {
    Object.keys(m).forEach(function (k) {
      var g = m[k]; if (g.length < 2) return;
      g.slice(1).forEach(function (d) {
        if (dupSeen[d.code]) return; dupSeen[d.code] = true;
        add('DUPLICATE_TTK', 'DISH', d.code, idx ? 'Состав' : 'Название', d.name, 'одна карта', 'ТТК «' + d.name + '» (' + d.code + ') дублирует ' + g[0].code + (idx ? ' по составу' : ' по названию'), 'Объединить, оставить отдельно или убрать в архив', 'Шеф-повар',
          { operationType: 'ARCHIVE', entityType: 'DISH', entityId: d.code, before: { status: 'ACTIVE' }, after: { status: 'ARCHIVED', duplicateOf: g[0].code }, reason: 'Дубликат ' + g[0].code, risk: 'HIGH' });
      });
    });
  });
  var units = {};
  dishes.forEach(function (d) { d.comp.forEach(function (c) { var n = _ts2NormName_(c.name), u = String(c.unit || '').toLowerCase(); var cls = /шт/.test(u) ? 'шт' : /л|мл/.test(u) ? 'объём' : /кг|г/.test(u) ? 'масса' : u; (units[n] = units[n] || {})[cls] = d.code; }); });
  Object.keys(units).forEach(function (n) { var cls = Object.keys(units[n]); if (cls.length > 1) add('PRODUCT_UNIT_CONFLICT', 'PRODUCT', n, 'Единица', cls.join(', '), 'одна единица или правило пересчёта', 'Продукт «' + n + '» в ТТК в разных единицах: ' + cls.join(', '), 'Задать единицу продукта и правило пересчёта (Склад → Продукты)', 'Шеф-повар'); });
  var emps = _ts2Employees_(), roles = {};
  emps.forEach(function (e) {
    var allowed = null; try { allowed = typeof mcMedBookAllowed === 'function' ? mcMedBookAllowed(e.name) : null; } catch (x) {}
    if (allowed !== true && !/^(Директор|Администратор)$/.test(e.role)) add('EMPLOYEE_WITHOUT_MED_DOC', 'EMPLOYEE', e.name, 'Медкнижка', allowed === false ? 'просрочена' : 'нет', 'действующий допуск', e.name + ': нет действующего медицинского допуска', 'Внести медкнижку (Персонал → Медкнижки)', 'Директор');
    roles[e.role || e.position] = true;
  });
  if (!emps.some(function (e) { return e.role === 'Директор'; })) add('DIRECTOR_MISSING', 'ROLE', 'Директор', 'Роль', '', 'назначен', 'Не назначен директор', 'Технический доступ: Персонал → Сотрудники → роль «Директор»', 'Технический доступ');
  if (!emps.some(function (e) { return e.role === 'Ответственный за ХАССП'; })) add('HACCP_RESPONSIBLE_MISSING', 'ROLE', 'Ответственный за ХАССП', 'Роль', '', 'назначен', 'Не назначен ответственный за ХАССП', 'Директор: назначить роль', 'Директор');
  var jobs = _ts2Legacy_('ЦС_Должностные').map(function (r) { return _ts2NormName_(r['Должность']); });
  Object.keys(roles).filter(Boolean).forEach(function (role) {
    var n = _ts2NormName_(role); if (/директор|техническ/.test(n)) return;
    var has = jobs.some(function (j) { return j.indexOf(n.split(' ')[0]) >= 0 || n.indexOf(j.split(' ')[0]) >= 0; });
    if (!has) add('ROLE_WITHOUT_INSTRUCTION', 'ROLE', role, 'Должностная инструкция', '', 'утверждённая', 'Для роли «' + role + '» нет должностной инструкции', 'Создать из шаблона ЦЕХ Стандарт и утвердить', 'Директор',
      { operationType: 'GENERATE_TEMPLATE', entityType: 'JOB_DESCRIPTION', entityId: role, before: null, after: { 'Должность': role, 'Основание': 'шаблон ЦЕХ Стандарт; требует утверждения работодателем' }, reason: 'Нет инструкции для роли', risk: 'LOW' });
  });
  _ts2Legacy_('ЦС_Договоры').forEach(function (c) {
    var end = c['Окончание'] instanceof Date ? Utilities.formatDate(c['Окончание'], _mcTz_(), 'yyyy-MM-dd') : String(c['Окончание'] || '');
    if (!end || String(c['Статус']) === 'РАСТОРГНУТ') return;
    if (end < today && String(c['Автопролонгация']) !== 'да') add('DOC_EXPIRED', 'CONTRACT', c.ID, 'Окончание', end, '≥ ' + today, 'Договор ' + c['Номер'] + ' (' + c['Контрагент'] + ') истёк', 'Продлить или закрыть договор', 'Директор');
    else if (end >= today && end <= _tsIsoPlusMonths_(today, 1)) add('CONTRACT_EXPIRING', 'CONTRACT', c.ID, 'Окончание', end, '', 'Договор ' + c['Номер'] + ' (' + c['Контрагент'] + ') истекает ' + end, 'Продлить договор', 'Директор');
  });
  _ts2Rows_('DOCUMENTS').forEach(function (d) { var v = String(d.validTo || '').slice(0, 10); if (v && v < today && d.status !== 'ARCHIVED' && d.status !== 'EXPIRED') add('DOC_EXPIRED', 'DOCUMENT', d.documentId, 'validTo', v, '≥ ' + today, 'Документ «' + d.title + '» истёк', 'Загрузить действующую версию', 'Директор'); });
  _ts2Rows_('HACCP_CONTROLS_V2').forEach(function (k) { if (String(k.isCcp) === 'true' && !k.journalCode) add('CCP_WITHOUT_JOURNAL', 'CCP', k.controlId, 'journalCode', '', 'код журнала', 'ККТ «' + k.name + '» не связана с журналом', 'Связать ККТ с журналом', 'Ответственный за ХАССП'); });
  try { var o = _mcOrg_(), c = _mcOrgCompleteness_(o); if (!c.complete) add('ORG_REQUISITES_MISSING', 'ORGANIZATION', 'ORG', 'Реквизиты', c.missing.join(', '), 'заполнены', 'Не заполнены реквизиты: ' + c.missing.join(', '), 'Настройки → Организация', 'Директор'); } catch (e) {}
  _ts2Legacy_('Оборудование_Реестр').forEach(function (q) {
    if (/ртут/i.test([q['Наименование'], q['Модель']].join(' ')) && !/INACTIVE|ARCHIVED|СПИСАН/i.test(String(q['Статус'] || '')))
      add('THERMOMETER_MERCURY', 'EQUIPMENT', q['EquipmentID'], 'Наименование', q['Наименование'], 'не ртутный', 'Ртутный термометр «' + q['Наименование'] + '» запрещён (СанПиН 2.3/2.4.4282-26, п. 48)', 'Замените на электронный или спиртовой термометр и выведите ртутный из реестра', 'Ответственный за ХАССП');
  });
  if (_ts2Prof_('mode', '') && !_ts2Rows_('MEASUREMENT_OBJECTS', function (o) { return o.status === 'ACTIVE' && o.objectType === 'ROOM'; }).length)
    add('STORE_CLIMATE_OBJECT_MISSING', 'MEASUREMENT_OBJECT', 'ROOM', 'objectType', '', 'ROOM', 'Нет объекта замера температуры и влажности склада: ежедневная регистрация обязательна (СанПиН 2.3/2.4.4282-26, п. 35, 40)', 'Настройка и готовность → шаг 4 → тип «Помещение» для каждого склада', 'Ответственный за ХАССП');
  if (typeof _tsSnsState_ === 'function' && _book_().getSheetByName('SENSOR_DEVICES')) _ts2Rows_('SENSOR_DEVICES', function (d) { return d.status === 'ACTIVE'; }).forEach(function (d) {
    var s = _tsSnsState_(d, new Date());
    if (s.silentMin !== null && s.silentMin >= TS_SNS_SILENT_MIN_) add('SENSOR_SILENT', 'SENSOR', d.deviceId, 'lastSeenAt', d.lastSeenAt || 'нет показаний', '≤ ' + TS_SNS_SILENT_MIN_ + ' мин', 'Датчик «' + d.name + '» молчит ' + s.silentText, 'Проверьте питание платы и Wi-Fi; пока датчик молчит, замер делает повар', 'Ответственный за ХАССП');
    if (s.calDueDays !== null && s.calDueDays <= 0) add('SENSOR_CALIBRATION_DUE', 'SENSOR', d.deviceId, 'calibratedAt', d.calibratedAt || 'не сверялся', 'раз в ' + TS_SNS_CAL_DAYS_ + ' дн.', 'Датчик «' + d.name + '»: пора сверить с поверенным термометром', 'Настройка и готовность → шаг 4 → Датчики → «Сверить»', 'Ответственный за ХАССП');
  });
  _ts2Legacy_('ЦС_Нормативы').forEach(function (n) {
    var vt = n['Действует до'] instanceof Date ? Utilities.formatDate(n['Действует до'], _mcTz_(), 'yyyy-MM-dd') : String(n['Действует до'] || '').slice(0, 10);
    if (!vt || String(n['Статус']) !== 'ДЕЙСТВУЕТ') return;
    if (vt <= today) add('NORM_EXPIRED', 'NORM', n['Код'], 'Действует до', vt, '> ' + today, n['Документ'] + ': срок действия истёк ' + vt, 'Найдите документ, который его заменил, внесите в реестр и отметьте старый «УТРАТИЛ СИЛУ»', 'Ответственный за ХАССП');
    else if (vt <= _tsIsoPlusMonths_(today, 4)) add('NORM_EXPIRING', 'NORM', n['Код'], 'Действует до', vt, '', n['Документ'] + ': действует до ' + vt, 'Заранее проверьте, утверждён ли документ на замену', 'Ответственный за ХАССП');
  });
  _ts2Legacy_('ЦС_Нормативы').forEach(function (n) { if (String(n['Статус']) === 'ПРОВЕРИТЬ') add('NORM_NOT_VERIFIED', 'NORM', n['Код'], 'Статус', 'ПРОВЕРИТЬ', 'ДЕЙСТВУЕТ', n['Документ'] + ': не сверен с первоисточником', 'Сверить и отметить «Действует»', 'Ответственный за ХАССП'); });
  _ts2Rows_('SYSTEM_DOCUMENTS').forEach(function (d) { if (String(d.requiresLocalApproval) === 'true' && d.localApprovalStatus !== 'APPROVED') add('SYSTEM_DOC_NOT_APPROVED', 'SYSTEM_DOCUMENT', d.documentId, 'localApprovalStatus', d.localApprovalStatus, 'APPROVED', '«' + d.title + '» подготовлен системой и ждёт утверждения предприятия', 'Открыть очередь утверждения и подтвердить', 'Директор'); });
  return out;
}

/** Запуск сверки: проблемы без дублей (то же правило + объект — одна открытая проблема), исправленные закрываются системой. */
function _ts2RunReconciliation_(scope) {
  _ts2EnsureSchema_(false);
  var runId = _ts2Id_('RECONCILIATION_RUNS'), found = _ts2Evaluate_(), now = _ts2Iso_();
  var open = _ts2Rows_('RECONCILIATION_ISSUES', function (i) { return i.status === 'OPEN' || i.status === 'IN_PROGRESS'; }), key = function (r, e) { return r + '|' + e; }, seen = {};
  var newIssues = [], newProps = [], counts = { BLOCKER: 0, CRITICAL: 0, MAJOR: 0, MINOR: 0, INFO: 0 };
  var openByKey = {}; open.forEach(function (i) { openByKey[key(i.ruleId, i.entityId)] = i; });
  found.forEach(function (f) {
    var k = key(f.rule.ruleId, f.entityId); if (seen[k]) return; seen[k] = true; counts[f.rule.severity]++;
    if (openByKey[k]) { _ts2Update_('RECONCILIATION_ISSUES', 'issueId', openByKey[k].issueId, { reconciliationRunId: runId, currentValue: _ts2Cell_(f.current) }); return; }
    var issueId = _ts2Id_('RECONCILIATION_ISSUES');
    newIssues.push({ issueId: issueId, reconciliationRunId: runId, enterpriseId: _ts2Ent_(), ruleId: f.rule.ruleId, severity: f.rule.severity, entityType: f.entityType, entityId: f.entityId,
      sourceDocumentId: '', fieldName: f.field, currentValue: _ts2Cell_(f.current), expectedValue: _ts2Cell_(f.expected), message: f.message, suggestedAction: f.action, status: 'OPEN',
      ownerRole: f.ownerRole, assignedTo: '', dueAt: '', resolvedAt: '', resolvedBy: '', resolutionComment: '', evidenceFileId: '' });
    if (f.proposal) newProps.push({ changeProposalId: _ts2Id_('CHANGE_PROPOSALS'), issueId: issueId, enterpriseId: _ts2Ent_(), entityType: f.proposal.entityType, entityId: f.proposal.entityId,
      operationType: f.proposal.operationType, beforeJson: JSON.stringify({ value: f.proposal.before, target: f.proposal.target || null }), afterJson: JSON.stringify({ value: f.proposal.after, target: f.proposal.target || null }),
      reason: f.proposal.reason, basisDocumentId: '', riskLevel: f.proposal.risk, requiresBackup: true, requiresApproval: true, status: 'PROPOSED', createdAt: now, createdBy: 'Система ЦЕХ Стандарт',
      approvedAt: '', approvedBy: '', appliedAt: '', appliedBy: '', rollbackAvailable: false, rollbackDataFileId: '' });
  });
  open.forEach(function (i) { if (!seen[key(i.ruleId, i.entityId)]) _ts2Update_('RECONCILIATION_ISSUES', 'issueId', i.issueId, { status: 'RESOLVED', resolvedAt: now, resolvedBy: 'Система ЦЕХ Стандарт', resolutionComment: 'При повторной сверке условие выполнено' }); });
  _ts2InsertMany_('RECONCILIATION_ISSUES', newIssues); _ts2InsertMany_('CHANGE_PROPOSALS', newProps);
  var total = Object.keys(seen).length, rules = TS2_RULES_.length;
  _ts2Insert_('RECONCILIATION_RUNS', { reconciliationRunId: runId, enterpriseId: _ts2Ent_(), profileId: 'DEFAULT-2.0', scope: scope || 'ALL', sourceSnapshot: JSON.stringify({ dishes: _ts2Dishes_().length, employees: _ts2Employees_().length }),
    startedAt: now, completedAt: _ts2Iso_(), status: 'COMPLETED', passCount: Math.max(0, rules - TS2_RULES_.filter(function (r) { return found.some(function (f) { return f.rule === r; }); }).length),
    reviewCount: counts.MAJOR + counts.MINOR, failCount: counts.BLOCKER + counts.CRITICAL, missingCount: 0, notApplicableCount: 0, reportFileId: '', createdBy: _ts2Actor_().name });
  _ts2Audit_('RECONCILIATION_RUN', 'RECONCILIATION_RUN', runId, undefined, { issues: total, created: newIssues.length, proposals: newProps.length, counts: counts }, '');
  return { runId: runId, issues: total, created: newIssues.length, proposals: newProps.length, counts: counts };
}

/* ------------------------------------------------------------------ согласование и применение */
var TS2_APPROVAL_PERM_ = { DISH: 'ttk_approve', JOB_DESCRIPTION: 'personnel|org_edit', ROLE: 'grants', CONFIG: 'org_edit' };
function _ts2Approve_(proposalId, approve, comment) {
  var p = _ts2Find_('CHANGE_PROPOSALS', 'changeProposalId', proposalId); if (!p) throw new Error('NOT_FOUND: предложение не найдено');
  if (p.status !== 'PROPOSED') throw new Error('VALIDATION: предложение уже в статусе ' + p.status);
  var s = typeof mcGateSession_ === 'function' ? mcGateSession_() : null, need = TS2_APPROVAL_PERM_[p.entityType] || 'org_edit';
  if (s && !s.dev && !String(need).split('|').some(function (k) { return _mcRbHas_(s, k); })) throw new Error('FORBIDDEN: согласовать изменение «' + p.entityType + '» может роль с правом ' + need);
  var a = _ts2Actor_(), now = _ts2Iso_();
  _ts2Insert_('APPROVALS', { approvalId: _ts2Id_('APPROVALS'), changeProposalId: proposalId, enterpriseId: _ts2Ent_(), approvalType: p.operationType, requestedFromRole: need, requestedFromEmployeeId: '',
    requestedAt: p.createdAt, status: approve ? 'APPROVED' : 'REJECTED', approvedBy: approve ? a.name : '', approvedAt: approve ? now : '', rejectedBy: approve ? '' : a.name, rejectedAt: approve ? '' : now, comment: comment || '' });
  _ts2Update_('CHANGE_PROPOSALS', 'changeProposalId', proposalId, { status: approve ? 'APPROVED' : 'REJECTED', approvedAt: approve ? now : '', approvedBy: approve ? a.name : '' });
  _ts2Audit_(approve ? 'PROPOSAL_APPROVE' : 'PROPOSAL_REJECT', 'CHANGE_PROPOSAL', proposalId, { status: 'PROPOSED' }, { status: approve ? 'APPROVED' : 'REJECTED' }, comment);
  return { proposalId: proposalId, status: approve ? 'APPROVED' : 'REJECTED' };
}
/** Применить согласованные предложения: backup → блокировка → порции → аудит → инварианты. */
function _ts2ApplyProposals_(ids, token) {
  var list = (ids && ids.length ? ids : _ts2Rows_('CHANGE_PROPOSALS', function (p) { return p.status === 'APPROVED'; }).map(function (p) { return p.changeProposalId; }))
    .map(function (id) { return _ts2Find_('CHANGE_PROPOSALS', 'changeProposalId', id); }).filter(function (p) { return p && p.status === 'APPROVED'; });
  if (!list.length) throw new Error('VALIDATION: нет согласованных предложений для применения');
  var backupId = _ts2Backup_('PRE_RECONCILIATION_APPLY', list.map(function (p) { return p.changeProposalId; }).join(',')), done = [], failed = [];
  list.forEach(function (p) {
    try {
      var before = _ts2Json_(p.beforeJson, {}), after = _ts2Json_(p.afterJson, {}), rb = { proposalId: p.changeProposalId, before: before, operationType: p.operationType };
      _withLock_(function () {
        if (p.operationType === 'UPDATE' && after.target && after.target.sheet) {
          var sh = _book_().getSheetByName(after.target.sheet), cell = sh.getRange(after.target.row, after.target.col);
          rb.actualBefore = cell.getValue(); cell.setValue(after.value);
          if (String(sh.getRange(after.target.row, after.target.col).getValue()) !== String(after.value)) throw new Error('инвариант: значение не записалось');
        } else if (p.operationType === 'ARCHIVE' && p.entityType === 'DISH') {
          var r = _ts2J_(typeof mcTtkArchive === 'function' ? mcTtkArchive(JSON.stringify({ code: p.entityId, reason: 'Дубликат ' + (after.value && after.value.duplicateOf || '') + ' (сверка ' + p.changeProposalId + ')' }), token) : null);
          if (!r || r.success === false || r.ok === false) throw new Error('архивирование ТТК: ' + (r && r.error && (r.error.message || r.error) || 'функция недоступна'));
        } else if (p.operationType === 'GENERATE_TEMPLATE' && p.entityType === 'JOB_DESCRIPTION') {
          var g = _ts2J_(tsLsSaveDoc(token, 'jobs', { 'Должность': p.entityId, 'Основание': after.value['Основание'], 'Требования': 'Шаблон ЦЕХ Стандарт: дополните требования по профстандарту.', 'Обязанности': 'Шаблон: дополните обязанности.' }));
          if (g && g.success === false) throw new Error(g.error && g.error.message); rb.createdCode = g && g.data && g.data.code;
        } else throw new Error('операция ' + p.operationType + ' для ' + p.entityType + ' не поддерживается');
      });
      var rbf = _ts2Folder_('SYS_RECON_REPORTS').createFile(Utilities.newBlob(JSON.stringify(rb, null, 1), 'application/json', p.changeProposalId + '_rollback.json'));
      _ts2Update_('CHANGE_PROPOSALS', 'changeProposalId', p.changeProposalId, { status: 'APPLIED', appliedAt: _ts2Iso_(), appliedBy: _ts2Actor_().name, rollbackAvailable: p.operationType === 'UPDATE', rollbackDataFileId: rbf.getId() });
      if (p.issueId) _ts2Update_('RECONCILIATION_ISSUES', 'issueId', p.issueId, { status: 'RESOLVED', resolvedAt: _ts2Iso_(), resolvedBy: _ts2Actor_().name, resolutionComment: 'Применено предложение ' + p.changeProposalId });
      _ts2Audit_('PROPOSAL_APPLY', p.entityType, p.entityId, before, after, p.reason, 'OK');
      done.push(p.changeProposalId);
    } catch (e) {
      _ts2Update_('CHANGE_PROPOSALS', 'changeProposalId', p.changeProposalId, { status: 'FAILED' });
      _ts2Audit_('PROPOSAL_APPLY', p.entityType, p.entityId, undefined, undefined, String(e.message || e), 'FAILED');
      failed.push({ id: p.changeProposalId, error: String(e.message || e) });
    }
  });
  return { backupId: backupId, applied: done, failed: failed, partial: !!(done.length && failed.length) };
}
function _ts2Rollback_(proposalId) {
  var p = _ts2Find_('CHANGE_PROPOSALS', 'changeProposalId', proposalId); if (!p) throw new Error('NOT_FOUND: предложение не найдено');
  if (p.status !== 'APPLIED' || String(p.rollbackAvailable) !== 'true') throw new Error('VALIDATION: откат недоступен для этого предложения');
  var rb = _ts2Json_(DriveApp.getFileById(p.rollbackDataFileId).getBlob().getDataAsString(), {}), after = _ts2Json_(p.afterJson, {});
  _ts2Backup_('PRE_RESTORE', proposalId);
  _withLock_(function () { _book_().getSheetByName(after.target.sheet).getRange(after.target.row, after.target.col).setValue(rb.actualBefore === undefined ? '' : rb.actualBefore); });
  _ts2Update_('CHANGE_PROPOSALS', 'changeProposalId', proposalId, { status: 'ROLLED_BACK', rollbackAvailable: false });
  if (p.issueId) _ts2Update_('RECONCILIATION_ISSUES', 'issueId', p.issueId, { status: 'OPEN', resolutionComment: 'Изменение откатано' });
  _ts2Audit_('PROPOSAL_ROLLBACK', p.entityType, p.entityId, after, { value: rb.actualBefore }, 'откат', 'OK');
  return { proposalId: proposalId, status: 'ROLLED_BACK' };
}

/* ------------------------------------------------------------------ миграция (ТЗ 2.0 §15.3) */
var TS2_MIGRATE_ = [['Блюда', 'DISH', 'DISH'], ['Сотрудники', 'EMPLOYEE', 'EMP'], ['Поставщики', 'SUPPLIER', 'SUP'], ['ЦС_Договоры', 'CONTRACT', 'CTR'], ['Документы', 'DOCUMENT', 'DOCL'], ['Склад_Партии', 'BATCH', 'BATCHL']];
function _ts2MigrationAnalyze_() {
  var mapped = {}; _ts2Rows_('MIGRATION_MAP', function (m) { return m.sourceSystem === 'LEGACY'; }).forEach(function (m) { mapped[m.sourceSheet + '|' + m.sourceKey] = m; });
  return TS2_MIGRATE_.map(function (t) {
    var rows = _ts2Legacy_(t[0]), keys = {}, dup = 0, empty = 0, done = 0;
    rows.forEach(function (r) { var k = String(r._v[0] || ''); if (!k) { empty++; return; } if (keys[k]) dup++; keys[k] = true; if (mapped[t[0] + '|' + k]) done++; });
    return { sheet: t[0], entityType: t[1], rows: rows.length, mapped: done, toMap: Object.keys(keys).length - done, duplicateKeys: dup, emptyKeys: empty };
  });
}
function _ts2MigrationPreview_(limit) {
  var mapped = {}; _ts2Rows_('MIGRATION_MAP', function (m) { return m.sourceSystem === 'LEGACY'; }).forEach(function (m) { mapped[m.sourceSheet + '|' + m.sourceKey] = true; });
  var out = [];
  TS2_MIGRATE_.forEach(function (t) { var seen = {}; _ts2Legacy_(t[0]).forEach(function (r) { var k = String(r._v[0] || ''); if (!k || mapped[t[0] + '|' + k] || out.length >= (limit || 500)) return;
    out.push({ sheet: t[0], key: k, row: r._row, legacyValue: String(r._v[1] || '').slice(0, 80), entityType: t[1], conflict: seen[k] ? 'DUPLICATE_KEY' : '' }); seen[k] = true; }); });
  return out;
}
function _ts2MigrationExecute_() {
  var backupId = _ts2Backup_('PRE_UPDATE', 'migration'), items = _ts2MigrationPreview_(100000).filter(function (x) { return !x.conflict; }), rows = [];
  items.forEach(function (x) {
    var pfx = TS2_MIGRATE_.filter(function (t) { return t[0] === x.sheet; })[0][2];
    rows.push({ migrationMapId: _ts2Id_('MIGRATION_MAP'), enterpriseId: _ts2Ent_(), sourceSystem: 'LEGACY', sourceSheet: x.sheet, sourceKey: x.key, sourceRow: x.row, legacyValue: x.legacyValue,
      entityType: x.entityType, entityId: _ts2Id_(pfx, false), mappingMethod: 'LEGACY_KEY', confidence: 1, status: 'MAPPED', reviewedBy: _ts2Actor_().name, reviewedAt: _ts2Iso_(), notes: 'лист не изменён' });
  });
  _ts2InsertMany_('MIGRATION_MAP', rows);
  _ts2Audit_('MIGRATION_EXECUTE', 'MIGRATION', backupId, undefined, { mapped: rows.length }, 'legacy → canonical IDs');
  return { backupId: backupId, mapped: rows.length, skippedConflicts: _ts2MigrationPreview_(100000).filter(function (x) { return x.conflict; }).length };
}

/* ------------------------------------------------------------------ API */
function ts2RunReconciliation(token) { try { _requireAuth_(token); return _ok_(_ts2RunReconciliation_('ALL')); } catch (e) { return _failFrom_(e); } }
function ts2Reconciliation(token) {
  try {
    _requireAuth_(token); _ts2EnsureSchema_(false);
    var issues = _ts2Rows_('RECONCILIATION_ISSUES', function (i) { return i.status === 'OPEN' || i.status === 'IN_PROGRESS'; });
    issues.sort(function (a, b) { return TS2_SEVERITY_.indexOf(a.severity) - TS2_SEVERITY_.indexOf(b.severity); });
    return _ok_({ runs: _ts2Rows_('RECONCILIATION_RUNS').reverse().slice(0, 10), issues: issues, proposals: _ts2Rows_('CHANGE_PROPOSALS').reverse().slice(0, 200), rules: TS2_RULES_ });
  } catch (e) { return _failFrom_(e); }
}
function ts2ApproveProposal(token, id, approve, comment) { try { _requireAuth_(token); return _ok_(_ts2Approve_(id, approve === true || approve === 'true', comment)); } catch (e) { return _failFrom_(e); } }
function ts2ApplyProposals(token, ids) { try { _requireAuth_(token); return _ok_(_ts2ApplyProposals_(ids, token)); } catch (e) { return _failFrom_(e); } }
function ts2RollbackProposal(token, id) { try { _requireAuth_(token); return _ok_(_ts2Rollback_(id)); } catch (e) { return _failFrom_(e); } }
function ts2MigrationAnalyze(token) { try { _requireAuth_(token); _ts2EnsureSchema_(false); return _ok_(_ts2MigrationAnalyze_()); } catch (e) { return _failFrom_(e); } }
function ts2MigrationPreview(token) { try { _requireAuth_(token); return _ok_(_ts2MigrationPreview_(300)); } catch (e) { return _failFrom_(e); } }
function ts2MigrationExecute(token, confirm) {
  try { _requireAuth_(token); if (confirm !== 'ВЫПОЛНИТЬ') return _fail_('VALIDATION', 'Для выполнения миграции введите слово ВЫПОЛНИТЬ'); return _ok_(_ts2MigrationExecute_()); }
  catch (e) { return _failFrom_(e); }
}
