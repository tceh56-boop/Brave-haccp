/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
/**
 * ЦЕХ Стандарт — санитарный аудит 360° (Мастер-промт 4.0, этап 7).
 *
 * Отдельного механизма оценки не создаётся: аудит 360° — это существующий внутренний контрольный лист готовности
 * (MonChef_Readiness.gs, пункты R01–R20: нормативы, ППК, ККТ, температуры, приёмка, бракераж, пробы, медкнижки,
 * лаборатория, санитария, оборудование, прослеживаемость, аудит, копии, вода, отходы, вредители, документы, целостность),
 * дополненный пунктами R21–R28 по цепочке «ТТК → процессы → ХАССП → ППК → чек-листы → исполнение → нарушения».
 * Каждый пункт ссылается на факты (ID записей), а не на отметки. Это внутренний контрольный лист, а не заключение надзорного органа.
 */
function _a360Rows_(name) { try { return _ts2Rows_(name); } catch (e) { return []; } }
function _a360Day_(d) { var x = d instanceof Date ? d : (typeof _v64Date_ === 'function' ? _v64Date_(d) : new Date(d)); return x && !isNaN(x.getTime()) ? x : null; }

/** Пункты цепочки 4.0 для контрольного листа готовности. */
function _a360Items_() {
  var out = [], now = Date.now(), day = 86400000;
  var it = function (id, area, req, status, o) { out.push(_rdItem_(id, area, req, status, o)); };
  // R21 ТТК: действующие карты проанализированы, данных для контроля достаточно
  var reg = []; try { reg = _ttkpRegistry_().filter(function (d) { return d.status === 'ACTIVE'; }); } catch (e) {}
  var map = _a360Rows_('TTK_PROCESS_MAP').filter(function (r) { return r.reviewStatus !== 'SUPERSEDED'; }), analyzed = {}; map.forEach(function (r) { analyzed[r.ttkId] = 1; });
  var notAn = reg.filter(function (d) { return !analyzed[d.code]; }), iss = _a360Rows_('TTK_PROCESS_ISSUES').filter(function (i) { return i.status === 'OPEN' && !/^\[черновик\]/.test(String(i.message)); });
  var rev = map.filter(function (r) { return r.reviewStatus === 'REVIEW_REQUIRED'; });
  it('R21', 'ТТК', 'Действующие ТТК проанализированы: операции определены, режимы и сроки указаны в картах',
    !reg.length ? 'NOT_APPLICABLE' : notAn.length === reg.length ? 'MISSING_EVIDENCE' : notAn.length || iss.length || rev.length ? 'REVIEW' : 'PASS',
    { blocking: false, risk: 'средний', evidence: (iss.length ? iss.map(function (i) { return i.issueId; }) : map.map(function (r) { return r.id; })).slice(0, 10),
      detail: 'ТТК действующих: ' + reg.length + ', не проанализировано: ' + notAn.length + ', «требуется заполнение ТТК»: ' + iss.length + ', операций на проверку: ' + rev.length,
      action: 'Процессы ТТК → «Проанализировать все ТТК», дополните карты по замечаниям', go: { module: 'tsTtkProc' } });
  // R22 анализ опасностей по операциям ТТК: решён, значимые под контролем
  var model = []; try { model = _ttkpActiveModel_(); } catch (e) {}
  var risk = _a360Rows_('PPK_HACCP_RISK_MAP'), cov = {}; risk.forEach(function (r) { cov[r.processCode] = 1; });
  var unc = model.filter(function (m) { return !cov[m.processCode]; }), und = risk.filter(function (r) { return r.status === 'NEEDS_DECISION'; }), noc = risk.filter(function (r) { return r.status === 'NO_CONTROL'; }), obs = risk.filter(function (r) { return r.status === 'OBSOLETE'; });
  it('R22', 'HACCP', 'Для каждой операции действующих ТТК проведён анализ опасностей; значимые опасности под ККТ или мерой с доказательством',
    !model.length ? 'NOT_APPLICABLE' : unc.length === model.length ? 'MISSING_EVIDENCE' : unc.length || und.length || noc.length ? 'FAIL' : obs.length ? 'REVIEW' : 'PASS',
    { evidence: (noc.length ? noc : und.length ? und : risk).map(function (r) { return r.v30HazardId; }).slice(0, 10),
      detail: 'операций: ' + model.length + ', без анализа: ' + unc.length + ', без решения: ' + und.length + ', значимых без меры: ' + noc.length + ', пересмотреть: ' + obs.length,
      action: 'Процессы ТТК → «Опасности ХАССП»: свяжите с ТТК и примите решения', go: { module: 'tsTtkProc' } });
  // R23 действующая ППК проходит проверку полноты
  var ppk = null, chk = null; try { ppk = _v65Objs_('PPK').filter(function (x) { return String(x.Status) === 'ACTIVE'; }).pop() || null; if (ppk) chk = _v65Check_(ppk.PPKID); } catch (e) {}
  var bad = chk ? chk.checks.filter(function (c) { return c.status !== 'PASS'; }) : [];
  it('R23', 'ППК', 'Действующая ППК полна: зоны, опасности, ККТ, лаборатория, ответственные, документы, связь с ТТК, разделы',
    !ppk ? 'FAIL' : bad.length ? 'FAIL' : 'PASS',
    { evidence: ppk ? [ppk.PPKID].concat(bad.map(function (c) { return c.code; })) : [], detail: !ppk ? 'действующей ППК нет' : bad.length ? bad.map(function (c) { return c.title + ' (' + c.count + ')'; }).join('; ') : 'все проверки пройдены',
      action: 'ППК → сформируйте и устраните замечания проверки полноты', go: { module: 'ppk' } });
  // R24 у каждого мероприятия ППК есть способ исполнения
  var tpl = _a360Rows_('CHECKLIST_TEMPLATES').filter(function (t) { return t.status === 'ACTIVE'; }), nos = tpl.filter(function (t) { return t.executionMode === 'NO_SCHEDULE'; });
  it('R24', 'ППК', 'Каждое мероприятие ППК исполняется: задачей с чек-листом, по событию, существующим разделом или контролем сроков',
    !ppk ? 'NOT_APPLICABLE' : !tpl.length ? 'MISSING_EVIDENCE' : nos.length ? 'REVIEW' : 'PASS',
    { blocking: false, risk: 'средний', evidence: (nos.length ? nos : tpl).map(function (t) { return t.templateId; }).slice(0, 10), detail: 'мероприятий: ' + tpl.length + ', без периодичности: ' + nos.length,
      action: 'Чек-листы ППК → «Обновить чек-листы»; задайте периодичность в ППК', go: { module: 'tsChecklists' } });
  // R25 график ППК за 30 дней выполнен (факт по каждому пункту)
  var sch = []; try { sch = ppk ? _v65Objs_('SCH').filter(function (s) { return String(s.PPKID) === String(ppk.PPKID); }) : []; } catch (e) {}
  var past = sch.filter(function (s) { var d = _a360Day_(s.DueDate); return d && d.getTime() < now - day && d.getTime() > now - 31 * day && /PLANNED|DONE|MISSED|DEVIATION/.test(String(s.Status)); });
  var done = past.filter(function (s) { return String(s.Status) === 'DONE'; }), miss = past.filter(function (s) { return /PLANNED|MISSED/.test(String(s.Status)); }), devs = past.filter(function (s) { return String(s.Status) === 'DEVIATION'; });
  it('R25', 'ППК', 'График ППК за 30 дней выполнен: по каждому пункту есть факт; пропусков нет',
    !ppk ? 'NOT_APPLICABLE' : !past.length ? 'MISSING_EVIDENCE' : miss.length ? 'FAIL' : devs.length ? 'REVIEW' : 'PASS',
    { blocking: false, risk: 'высокий', evidence: (miss.length ? miss.map(function (s) { return s.ScheduleID; }) : done.map(function (s) { return s.FactID || s.ScheduleID; })).slice(0, 10),
      detail: 'пунктов со сроком: ' + past.length + ', выполнено: ' + done.length + ', не выполнено: ' + miss.length + ', с отклонением: ' + devs.length + (past.length ? ' (' + Math.round(done.length * 100 / past.length) + '%)' : ''),
      action: 'Экран «Сейчас»: задачи ППК; пропуски разберите как нарушения', go: { module: 'tsNow' } });
  // R26 задачи смены за 7 дней не пропускаются
  var ex = []; try { ex = _ts2Tail_('JOURNAL_EXPECTATIONS', 5000, function (e) { var d = _a360Day_(e.dueAt); return d && d.getTime() > now - 7 * day && d.getTime() < now; }); } catch (e) {}
  var exMiss = ex.filter(function (e) { return e.status === 'MISSED'; }), exDone = ex.filter(function (e) { return /DONE|FAILED/.test(e.status); });
  it('R26', 'Исполнение', 'Задачи смены за 7 дней выполнены: замеры, подтверждения, задачи ППК — без пропусков',
    !ex.length ? 'MISSING_EVIDENCE' : exMiss.length ? 'FAIL' : 'PASS',
    { blocking: false, risk: 'высокий', evidence: (exMiss.length ? exMiss.map(function (e) { return e.expectationId; }) : exDone.map(function (e) { return e.factId || e.expectationId; })).slice(0, 10),
      detail: 'задач: ' + ex.length + ', выполнено: ' + exDone.length + ', пропущено: ' + exMiss.length, action: 'Экран «Сейчас»', go: { module: 'tsNow' } });
  // R27 нарушения отрабатываются в срок и проверяются
  var dv = []; try { dv = _devSheet_().getDataRange().getValues().slice(1).filter(function (r) { return r[0]; }); } catch (e) {}
  var open = dv.filter(function (r) { return !/устран|закрыт|отмен|closed|cancel/i.test(String(r[7])); });
  var stale = open.filter(function (r) { var d = _a360Day_(r[11]); return d && d.getTime() < now - 3 * day; }), reop = open.filter(function (r) { return /повторно/.test(String(r[7])); }), wait = open.filter(function (r) { return /ожидает проверки/.test(String(r[7])); });
  it('R27', 'Нарушения', 'Нарушения устраняются в течение 3 суток, устранение подтверждено другим сотрудником',
    !dv.length ? 'PASS' : stale.length || reop.length ? 'FAIL' : wait.length ? 'REVIEW' : 'PASS',
    { blocking: false, risk: 'высокий', evidence: (stale.length ? stale : reop.length ? reop : wait.length ? wait : dv.slice(-3)).map(function (r) { return r[0]; }).slice(0, 10),
      detail: 'открыто: ' + open.length + ', дольше 3 суток: ' + stale.length + ', открыто повторно: ' + reop.length + ', ждут проверки: ' + wait.length + (typeof _vioMode_ === 'function' && _vioMode_() === 'SELF' ? '; включена самопроверка (решение директора)' : ''),
      action: 'Экран «Сейчас»: отклонения и «Ожидают проверки»', go: { module: 'tsNow' } });
  // R28 источники нарушений сведены в единый реестр
  var srcs = {}; dv.forEach(function (r) { var k = String(r[1] || '').split(':')[0]; if (/^(TS2|V43|V42|V44)$/.test(k)) srcs[k] = (srcs[k] || 0) + 1; });
  var lost = [];
  [['Санитария_АвтоАлерты_V43', 'V43', /.*/], ['Санитария_Алерты_V42', 'V42', /CONCENTRATION|EXPIRED/], ['Задачи_Алерты_V44', 'V44', /FAILED/]].forEach(function (s) {
    var sh = _book_().getSheetByName(s[0]); if (!sh || sh.getLastRow() < 2) return;
    sh.getDataRange().getValues().slice(1).forEach(function (r) { if (r[0] && s[2].test(String(r[1])) && !/CLOSED|RESOLVED/.test(String(r[6])) && !dv.some(function (x) { return String(x[1]) === s[1] + ':' + r[0] || String(x[1]) === s[1] + ':' + r[1] + ':' + r[2]; })) lost.push(s[1] + ':' + r[0]); });
  });
  it('R28', 'Нарушения', 'Все открытые нарушения модулей (санитария, растворы, задачи, экран «Сейчас») — в едином реестре',
    lost.length ? 'REVIEW' : 'PASS', { blocking: false, risk: 'средний', evidence: lost.slice(0, 10), detail: lost.length ? 'не в реестре (созданы до перехода): ' + lost.length : 'источники в реестре: ' + (Object.keys(srcs).map(function (k) { return k + ' ' + srcs[k]; }).join(', ') || '—'),
      action: 'Аудит 360° → «Перенести нарушения в реестр»', go: { module: 'tsAudit360' } });
  return out;
}

/** Нарушения V42/V44, созданные до перехода на единый реестр, — в реестр (идемпотентно). */
function _a360MigrateViolations_() {
  var n = 0;
  _a360Legacy_().forEach(function (x) { var before = _vioBySource_(x.source); if (before) return; _vioOpen_(x); n++; });
  return n;
}
function _a360Legacy_() {
  var out = [], rows = function (name) { var sh = _book_().getSheetByName(name); return sh && sh.getLastRow() > 1 ? sh.getDataRange().getValues().slice(1) : []; };
  rows('Санитария_АвтоАлерты_V43').forEach(function (r) { if (r[0] && !/CLOSED|RESOLVED/.test(String(r[6]))) out.push({ source: 'V43:' + r[0], journal: 'Санитария', object: String(r[2] || ''), text: String(r[5] || ''), critical: /CRIT/i.test(String(r[4])), who: 'перенос' }); });
  rows('Санитария_Алерты_V42').forEach(function (r) { if (r[0] && /CONCENTRATION|EXPIRED/.test(String(r[1])) && !/CLOSED|RESOLVED/.test(String(r[6]))) out.push({ source: /CONCENTRATION/.test(String(r[1])) ? 'V42:' + r[0] : 'V42:' + r[1] + ':' + r[2], journal: 'Дезсредства', object: String(r[2] || ''), text: String(r[5] || ''), critical: /CRIT/i.test(String(r[4])), who: 'перенос' }); });
  rows('Задачи_Алерты_V44').forEach(function (r) { if (r[0] && /FAILED/.test(String(r[1])) && !/CLOSED|RESOLVED/.test(String(r[6]))) out.push({ source: 'V44:' + r[0], journal: 'Задачи', object: String(r[2] || ''), text: String(r[5] || ''), critical: /CRIT/i.test(String(r[4])), who: 'перенос' }); });
  return out;
}

/** Акт внутреннего санитарного аудита 360° (печать): итог, области, пункты, доказательства. */
function _a360Report_(r, org) {
  var esc = function (s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var ST = { PASS: 'выполнено', FAIL: 'нарушение', REVIEW: 'требует проверки', MISSING_EVIDENCE: 'нет доказательств', NOT_APPLICABLE: 'не применимо' };
  var OV = { READY: 'готово к проверке', READY_WITH_WARNINGS: 'готово с замечаниями', NOT_READY: 'не готово к проверке' };
  var areas = {}; r.items.forEach(function (x) { var a = areas[x.area] = areas[x.area] || { pass: 0, total: 0 }; if (x.status !== 'NOT_APPLICABLE') { a.total++; if (x.status === 'PASS') a.pass++; } });
  var applicable = r.items.filter(function (x) { return x.status !== 'NOT_APPLICABLE'; }), score = applicable.length ? Math.round(r.counts.PASS * 100 / applicable.length) : 0;
  var h = '<h2>Акт внутреннего санитарного аудита 360°</h2><p>' + esc(org || '') + '<br>Дата: ' + esc(String(r.at).slice(0, 16).replace('T', ' ')) + (r.runId ? ' · прогон ' + esc(r.runId) : '') + '</p>' +
    '<p><b>Итог: ' + esc(OV[r.overall] || r.overall) + '</b> · выполнено ' + r.counts.PASS + ' из ' + applicable.length + ' применимых пунктов (' + score + '%) · нарушений ' + r.counts.FAIL + ' · требует проверки ' + r.counts.REVIEW + ' · без доказательств ' + r.counts.MISSING_EVIDENCE + '</p>' +
    '<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-size:12px"><tr><th>Область</th><th>Выполнено</th></tr>' +
    Object.keys(areas).map(function (a) { return '<tr><td>' + esc(a) + '</td><td>' + areas[a].pass + ' / ' + areas[a].total + '</td></tr>'; }).join('') + '</table><br>' +
    '<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-size:12px"><tr><th>№</th><th>Область</th><th>Требование</th><th>Результат</th><th>Подробно</th><th>Доказательства (ID записей)</th><th>Что сделать</th></tr>' +
    r.items.map(function (x) { return '<tr><td>' + esc(x.id) + '</td><td>' + esc(x.area) + '</td><td>' + esc(x.requirement) + '</td><td><b>' + esc(ST[x.status] || x.status) + '</b>' + (x.blocking && /FAIL|MISSING/.test(x.status) ? ' (блокирует)' : '') + '</td><td>' + esc(x.detail) + '</td><td>' + esc((x.evidence || []).join(', ')) + '</td><td>' + esc(x.status === 'PASS' ? '' : x.correctiveAction) + '</td></tr>'; }).join('') +
    '</table><p style="font-size:11px">' + esc(r.note) + ' Каждый пункт рассчитан по записям таблицы предприятия; ID записей позволяют открыть первичный факт.</p><p>Аудит провёл: ____________________ &nbsp; Дата: __________</p>';
  return { html: h, score: score };
}

/* ------------------------------------------------------------------ API */
function a360Run(token) {
  try {
    var s = _requireAuth_(token, 'audit_create|audit_view|haccp_view|haccp|haccp_approve|ppk_view|ppk_edit'); var r = _mcReadinessRecord_(s);
    var org = ''; try { var o = typeof _mcOrg_ === 'function' ? _mcOrg_() : null; org = o ? o.name : ''; } catch (e) {}
    var rep = _a360Report_(r, org); r.score = rep.score; r.html = rep.html;
    return _ok_(r);
  } catch (e) { return _failFrom_(e); }
}
function a360MigrateViolations(token) {
  try { _requireAuth_(token, 'haccp|haccp_approve'); return _withLock_(function () { var n = _a360MigrateViolations_(); try { _ts2Audit_('VIOLATION_MIGRATE', 'VIOLATION', 'V42/V43/V44', undefined, { migrated: n }, 'нарушения модулей → единый реестр'); } catch (e) {} return _ok_({ migrated: n }); }); } catch (e) { return _failFrom_(e); }
}

/* ------------------------------------------------------------------ этап 8: запись-доказательство по ID */
// [проверка ID, лист, что это, раздел, колонка ключа (для листов TS2 — имя поля)]
var A360_EV_ = [
  [/^TPI-/, 'TTK_PROCESS_ISSUES', 'Замечание к ТТК («Требуется заполнение ТТК»)', 'tsTtkProc', 'issueId'],
  [/^TPM-/, 'TTK_PROCESS_MAP', 'Операция ТТК (анализ процессов)', 'tsTtkProc', 'id'],
  [/^PHR-/, 'PPK_HACCP_RISK_MAP', 'Связь операции ТТК с опасностью', 'tsTtkProc', 'riskId'],
  [/^CLT-/, 'CHECKLIST_TEMPLATES', 'Чек-лист мероприятия ППК', 'tsChecklists', 'templateId'],
  [/^EXP-/, 'JOURNAL_EXPECTATIONS', 'Задача смены (экран «Сейчас»)', 'tsNow', 'expectationId'],
  [/^(AR|ARC|AUR)-/, 'AUTO_RECORDS', 'Запись журнала (факт)', 'tsNow', 'autoRecordId'],
  [/^(HZ-|V35-H)/, 'HACCP_Опасности_V30', 'Опасность (анализ опасностей ХАССП)', 'tsTtkProc', 0],
  [/^(PROC-|P0|V35-P|V37-UNBOUND)/, 'HACCP_Процессы_V30', 'Процесс ХАССП', 'compliance', 0],
  [/^(CCP-|V35-C|V37-K)/, 'HACCP_ТочкиКонтроля_V30', 'ККТ / мера управления', 'compliance', 0],
  [/^SCH-/, 'ППК_График', 'Пункт графика ППК', 'ppk', 0],
  [/^PPK-/, 'ППК_V30', 'Программа производственного контроля', 'ppk', 0],
  [/^DV/, 'Журналы_Отклонения', 'Нарушение (единый реестр)', 'tsViolations', 0],
  [/^RDY-/, 'Готовность_Проверки', 'Прогон контрольного листа', 'tsAudit360', 0]
];
// подписи полей и значений для карточки записи (листы TS2 и V30/V65 ведутся с английскими заголовками)
var A360_FIELD_RU_ = { issueId: 'ID замечания', id: 'ID', organizationId: 'Предприятие', locationId: 'Площадка', enterpriseId: 'Предприятие', ttkId: 'ТТК', ttkVersion: 'Версия ТТК', code: 'Код', message: 'Сообщение', status: 'Статус',
  issueKey: 'Ключ', createdAt: 'Создано', resolvedAt: 'Решено', updatedAt: 'Изменено', processId: 'Операция (ID)', processCode: 'Операция', sourceStepId: 'Шаг', sourceText: 'Текст карты', operationSequence: 'Порядок',
  parentTtkId: 'Из полуфабриката', confidence: 'Уверенность', detectionMethod: 'Как определено', reviewStatus: 'Проверка', reviewNote: 'Заметка', rowKey: 'Ключ строки', riskId: 'ID связи', processName: 'Операция',
  v30ProcessId: 'Процесс ХАССП', hazardCode: 'Код опасности', hazardCategory: 'Вид опасности', hazard: 'Опасность', v30HazardId: 'Опасность (ID)', ttkCount: 'ТТК', ttkSample: 'Примеры ТТК', significant: 'Значима',
  controlType: 'Вид контроля', controlId: 'ККТ (ID)', controlMeasure: 'Мера', evidence: 'Доказательство', journalId: 'Журнал', statusNote: 'Пояснение', templateId: 'ID чек-листа', ppkId: 'ППК', ppkVersion: 'Версия ППК',
  controlPlanId: 'Мероприятие', title: 'Название', items: 'Пункты', journalCode: 'Журнал', responsibleRole: 'Ответственный', frequency: 'Периодичность', dueTime: 'Время', executionMode: 'Способ исполнения',
  coveredBy: 'Кем исполняется', evidenceType: 'Вид доказательства', correctiveAction: 'Корректирующее действие', expectationId: 'ID задачи', eventRuleId: 'Правило', objectType: 'Вид объекта', objectId: 'Объект',
  productionId: 'Выпуск', batchId: 'Партия', dueAt: 'Срок', confirmationMode: 'Как подтверждается', measurementRequired: 'Нужен замер', completedAt: 'Выполнено', completedBy: 'Кто выполнил', factId: 'Факт',
  idempotencyKey: 'Ключ', autoRecordId: 'ID записи', eventType: 'Событие', sourceType: 'Источник', sourceId: 'ID источника', recordType: 'Вид записи', kktId: 'ККТ', result: 'Результат', measurementMode: 'Способ замера',
  value: 'Значение', unit: 'Ед.', confirmedByEmployee: 'Сотрудник', confirmedAt: 'Подтверждено', ruleVersion: 'Правило',
  HazardID: 'ID опасности', ProcessID: 'Процесс', Category: 'Вид', Hazard: 'Опасность', Cause: 'Причина', PreventiveMeasure: 'Предупреждающая мера', Severity: 'Тяжесть', Likelihood: 'Вероятность', Risk: 'Риск',
  Significant: 'Значима', ExistingControl: 'Мера управления', Evidence: 'Доказательство', Status: 'Статус', CreatedAt: 'Создано', CreatedBy: 'Кем', Code: 'Код', Name: 'Название', Sequence: 'Порядок', Input: 'Вход', Output: 'Выход',
  Responsible: 'Ответственный', Version: 'Версия', ApprovedAt: 'Утверждено', ApprovedBy: 'Утвердил', Notes: 'Примечание', ControlID: 'ID контроля', Type: 'Тип', ControlPoint: 'Точка контроля', CriticalLimit: 'Критический предел',
  LimitUnit: 'Ед.', MonitoringMethod: 'Мониторинг', Frequency: 'Периодичность', CorrectiveAction: 'Корректирующее действие', VerificationMethod: 'Верификация', RecordSource: 'Запись', ScheduleID: 'ID пункта графика',
  PPKID: 'ППК', ControlPlanID: 'Мероприятие', Period: 'Период', DueDate: 'Срок', AssignedTo: 'Исполнитель', FactID: 'Факт', DeviationID: 'Нарушение', CompletedAt: 'Выполнено', CompletedBy: 'Кто выполнил',
  DateFrom: 'Действует с', DateTo: 'Действует по' };
var A360_VALUE_RU_ = { PROPOSED: 'предложено системой', ACTIVE: 'действует', DRAFT: 'черновик', ARCHIVED: 'в архиве', OPEN: 'открыто', RESOLVED: 'устранено', VERIFY_REQUIRED: 'ожидает проверки', DONE: 'выполнено',
  MISSED: 'пропущено', FAILED: 'не выполнено («Нет»)', PLANNED: 'запланировано', DEVIATION: 'с отклонением', DETECTED: 'определено', REVIEW_REQUIRED: 'на проверку', CONFIRMED: 'подтверждено', REJECTED: 'отклонено',
  SUPERSEDED: 'устарело', NEEDS_DECISION: 'ждёт решения', NO_CONTROL: 'нет меры', CONTROLLED: 'под контролем', NOT_SIGNIFICANT: 'не значима', OBSOLETE: 'пересмотреть', TASK: 'задача на экране «Сейчас»',
  EVENT: 'по событию', COVERED: 'уже исполняется', DATE: 'контроль сроков', NO_SCHEDULE: 'нет периодичности', CONFIRM: 'Да / Нет', MEASURE: 'замер', true: 'да', false: 'нет' };
function _a360Evidence_(id) {
  id = String(id || '').trim(); if (!id) throw new Error('VALIDATION: нет ID записи');
  var fmt = function (v) { return v instanceof Date ? Utilities.formatDate(v, _mcTz_(), 'dd.MM.yyyy HH:mm') : v; };
  for (var i = 0; i < A360_EV_.length; i++) {
    var e = A360_EV_[i]; if (!e[0].test(id)) continue;
    var fields = null;
    if (typeof e[4] === 'string') { var r = null; try { r = _ts2Find_(e[1], e[4], id); } catch (x) {} if (r) { fields = []; Object.keys(r).forEach(function (k) { if (k !== '_row' && r[k] !== '' && r[k] !== null && r[k] !== undefined) fields.push([k, fmt(r[k])]); }); } }
    else { var sh = _book_().getSheetByName(e[1]); if (sh && sh.getLastRow() > 1) { var v = sh.getDataRange().getValues(); for (var j = 1; j < v.length; j++) if (String(v[j][0]) === id) { fields = []; v[0].forEach(function (h, k) { if (v[j][k] !== '' && v[j][k] !== null) fields.push([String(h), fmt(v[j][k])]); }); break; } } }
    if (!fields) continue;
    fields = fields.map(function (f) { var v = f[1]; return [A360_FIELD_RU_[f[0]] || f[0], A360_VALUE_RU_.hasOwnProperty(String(v)) ? A360_VALUE_RU_[String(v)] : v]; });
    var out = { id: id, kind: e[2], sheet: e[1], module: e[3], fields: fields.slice(0, 40), related: [] };
    if (e[1] === 'Журналы_Отклонения') { try { _corrSheet_().getDataRange().getValues().slice(1).forEach(function (c) { if (String(c[1]) === id) out.related.push([fmt(c[8]), String(c[2]), String(c[7] || ''), String(c[5] || '')]); }); } catch (x) {} }
    return out;
  }
  throw new Error('NOT_FOUND: запись ' + id + ' не найдена');
}
function a360Evidence(token, id) {
  try { _requireAuth_(token, 'audit_create|audit_view|haccp_view|haccp|haccp_approve|ppk_view|ppk_edit'); return _ok_(_a360Evidence_(id)); } catch (e) { return _failFrom_(e); }
}
