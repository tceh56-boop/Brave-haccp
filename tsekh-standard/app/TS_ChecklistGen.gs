/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
/**
 * ЦЕХ Стандарт — генератор чек-листов из ППК (Мастер-промт 4.0, этап 5).
 *
 * План — график действующей ППК V65 (ППК_График); исполнение — единый контур задач JOURNAL_EXPECTATIONS (экран «Сейчас»).
 * Новых параллельных чек-листов и задач не создаётся. Каждое мероприятие ППК получает способ исполнения:
 *  - COVERED — уже исполняется существующим контуром (замеры температур, допуск смены, санитария V43/цеха, растворы V43):
 *    задача не дублируется, в шаблоне указано, кем исполняется;
 *  - EVENT — по событию (приёмка, выпуск партии, выработка): исполняется записью события, не ежедневной задачей;
 *  - DATE — контроль сроков (поверка, медкнижки): правила сроков R-006/R-009 и реестры;
 *  - TASK — задача на экране «Сейчас» по графику ППК, с чек-листом пунктов; результат возвращается в график ППК;
 *  - NO_SCHEDULE — периодичность не задана: пробел, задача не создаётся (придумывать периодичность нельзя).
 * Лабораторные мероприятия ППК заменяют общую ежемесячную задачу «Лабораторный план» (TS2_SCHEDULES_ LAB_PLAN).
 */
var CLG_DEFAULT_TIME_ = '10:00';

function _clgItems_(a) {
  var it = ['Выполнено: ' + a.Parameter + (a.Object ? ' — ' + a.Object : '')];
  if (String(a.Method || '').trim()) it.push('Способ: ' + a.Method);
  if (String(a.Normative || '').trim()) it.push('Соответствует: ' + a.Normative);
  var ev = String(a.EvidenceType || '');
  if (ev === 'LAB_PROTOCOL') it.push('Протокол лаборатории получен и приложен'); else if (ev === 'DOCUMENT') it.push('Документ или акт получен и приложен');
  else if (ev === 'CHECKLIST') it.push('Отметки чек-листа заполнены'); else if (String(a.JournalID || '').trim()) it.push('Запись в журнале ' + a.JournalID);
  return it;
}
/** Способ исполнения мероприятия: {mode, coveredBy}. */
function _clgClassify_(a) {
  var f = String(a.Frequency || '').trim(), p = String(a.Parameter || ''), o = String(a.Object || '');
  if (/^Температура хранения$/.test(p)) return { mode: 'COVERED', coveredBy: 'Замеры температур (экран «Сейчас»: холодильники, морозильники, помещения)' };
  if (/допуск к работе/i.test(p)) return { mode: 'COVERED', coveredBy: 'Контроль медицинских допусков смены (экран «Сейчас»)' };
  if (/^Санитарная обработка/.test(p)) return { mode: 'COVERED', coveredBy: 'Санитария: задачи по санитарным планам и санитарная обработка рабочих мест' };
  if (/Концентрация рабочего раствора/i.test(p)) return { mode: 'COVERED', coveredBy: 'Санитария: контроль рабочих растворов при приготовлении' };
  if (!f) return { mode: 'NO_SCHEDULE', coveredBy: '' };
  if (_v65Interval_(f)) return { mode: 'TASK', coveredBy: '' };
  if (/по сроку/i.test(f)) return { mode: 'DATE', coveredBy: /медицин|медкниж/i.test(p + o) ? 'Контроль медицинских допусков (правило R-006)' : 'Контроль сроков документов и поверок (правило R-009, реестр оборудования)' };
  if (/приёмк|приемк/i.test(f + p)) return { mode: 'EVENT', coveredBy: 'Входной контроль при приёмке' };
  if (/парти|выработ|выпуск/i.test(f)) return { mode: 'EVENT', coveredBy: 'Выпуск продукции (бракераж, ККТ по событию)' };
  return { mode: 'EVENT', coveredBy: 'По событию: ' + f };
}
function _clgActivePpk_() { var a = _v65Objs_('PPK').filter(function (x) { return String(x.Status) === 'ACTIVE'; }); return a.length ? a[a.length - 1] : null; }

/** Шаблоны чек-листов по действующей ППК. Идемпотентно; шаблоны прежних версий → SUPERSEDED. */
function _clgBuild_() {
  return _withLock_(function () {
    var p = _clgActivePpk_(), ent = _ts2Ent_(), now = _ts2Iso_(), want = {}, res = { ppkId: p ? p.PPKID : '', TASK: 0, EVENT: 0, COVERED: 0, DATE: 0, NO_SCHEDULE: 0, superseded: 0 };
    if (p) _v65Objs_('ACT').filter(function (a) { return String(a.PPKID) === String(p.PPKID) && _v65On_(a.Active); }).forEach(function (a) {
      var c = _clgClassify_(a), tm = /в\s*(\d{1,2}):(\d{2})/.exec(String(a.Frequency || '')), key = p.PPKID + '|' + a.ControlPlanID;
      want[key] = { organizationId: ent, ppkId: p.PPKID, ppkVersion: p.Version, controlPlanId: a.ControlPlanID, title: (a.Object ? a.Object + ': ' : '') + a.Parameter, items: JSON.stringify(_clgItems_(a)),
        journalCode: a.JournalID || '', responsibleRole: a.ResponsibleRole || 'Ответственный за ХАССП', frequency: a.Frequency || '', dueTime: tm ? ('0' + tm[1]).slice(-2) + ':' + tm[2] : CLG_DEFAULT_TIME_,
        executionMode: c.mode, coveredBy: c.coveredBy, evidenceType: a.EvidenceType || '', correctiveAction: a.CorrectiveAction || '', status: 'ACTIVE', rowKey: key, updatedAt: now };
      res[c.mode]++;
    });
    var T = _ttkpTable_('CHECKLIST_TEMPLATES'), seen = {}, ins = [];
    T.rows.forEach(function (r) {
      var w = want[r.rowKey];
      if (w) { seen[r.rowKey] = 1; var patch = {}; Object.keys(w).forEach(function (k) { if (k !== 'updatedAt') patch[k] = w[k]; }); T.set(r, patch, now); }
      else if (r.status !== 'SUPERSEDED') { T.set(r, { status: 'SUPERSEDED' }, now); res.superseded++; }
    });
    T.flush();
    Object.keys(want).forEach(function (k) { if (!seen[k]) ins.push(want[k]); });
    var ids = _ttkpIds_('CHECKLIST_TEMPLATES', ins.length); ins.forEach(function (w, i) { w.templateId = ids[i]; });
    if (ins.length) _ts2InsertMany_('CHECKLIST_TEMPLATES', ins);
    return res;
  });
}
function _clgTemplates_(filter) { try { return _ts2Rows_('CHECKLIST_TEMPLATES', function (t) { return t.status === 'ACTIVE' && (!filter || filter(t)); }); } catch (e) { return []; } }
/** Шаблон TASK действующей ППК для мероприятия (для запрета ручной отметки в графике). */
function _clgTaskFor_(ppkId, controlPlanId) { return _clgTemplates_(function (t) { return t.executionMode === 'TASK' && String(t.ppkId) === String(ppkId) && String(t.controlPlanId) === String(controlPlanId); })[0] || null; }
/** Общие задачи TS2_SCHEDULES_, которые заменяет действующая ППК (лабораторный план — конкретными исследованиями ППК). */
function _clgSupersededSchedules_() {
  var t = _clgTemplates_(function (x) { return x.executionMode === 'TASK' && /^LAB:/.test(String(x.journalCode)); });
  return t.length ? { LAB_PLAN: true } : {};
}

/** Задачи дня по графику ППК → JOURNAL_EXPECTATIONS (вызывается из _ts2GenerateDay_). Повтор не создаёт дублей.
 *  График ППК продлевается сам, если до его конца меньше недели (раньше строился один раз на 31 день при вводе ППК). */
function _clgDay_(day, keys) {
  var p = _clgActivePpk_(); if (!p) return [];
  var tasks = {}; _clgTemplates_(function (t) { return t.executionMode === 'TASK' && String(t.ppkId) === String(p.PPKID); }).forEach(function (t) { tasks[t.controlPlanId] = t; });
  if (!Object.keys(tasks).length) return [];
  var sch = _v65Objs_('SCH').filter(function (s) { return String(s.PPKID) === String(p.PPKID); }), last = '';
  sch.forEach(function (s) { var d = _v64Date_(s.DueDate); if (d) { var k = _v64Day_(d); if (k > last) last = k; } });
  var weekAhead = Utilities.formatDate(new Date(new Date(day + 'T12:00:00').getTime() + 7 * 86400000), _mcTz_(), 'yyyy-MM-dd');
  if (last < weekAhead) { try { _v65BuildSchedule_(p.PPKID, new Date(day + 'T00:00:00'), new Date(new Date(day + 'T12:00:00').getTime() + 31 * 86400000)); sch = _v65Objs_('SCH').filter(function (s) { return String(s.PPKID) === String(p.PPKID); }); } catch (e) {} }
  var ent = _ts2Ent_(), rows = [];
  sch.forEach(function (s) {
    var t = tasks[s.ControlPlanID], d = _v64Date_(s.DueDate); if (!t || !d || String(s.Status) !== 'PLANNED' || _v64Day_(d) !== day) return;
    var key = [ent, day, 'PPK', s.ScheduleID].join('|'); if (keys[key]) return; keys[key] = true;
    rows.push({ enterpriseId: ent, journalCode: t.journalCode, eventRuleId: 'PPK-' + t.controlPlanId, objectType: 'PPK_SCHEDULE', objectId: s.ScheduleID, productionId: '', batchId: '',
      dueAt: day + 'T' + (t.dueTime || CLG_DEFAULT_TIME_) + ':00', responsibleRole: t.responsibleRole, status: 'OPEN', confirmationMode: 'CONFIRM', measurementRequired: false,
      completedAt: '', completedBy: '', factId: '', title: 'ППК: ' + t.title, idempotencyKey: key });
  });
  return rows;
}
/** Пункты чек-листа для задач экрана «Сейчас». */
function _clgItemsByRule_() { var m = {}; _clgTemplates_(function (t) { return t.executionMode === 'TASK'; }).forEach(function (t) { m['PPK-' + t.controlPlanId] = { items: _ts2Json_(t.items, []), ca: t.correctiveAction }; }); return m; }
/** Задача ППК закрыта (Да / Нет / пропущена) → пункт графика ППК получает тот же итог и ссылку на факт. */
function _clgOnClosed_(e, status, factId, who) {
  if (!/^PPK-/.test(String(e.eventRuleId)) || e.objectType !== 'PPK_SCHEDULE') return;
  try {
    var s = _v65Objs_('SCH').filter(function (x) { return x.ScheduleID === e.objectId; })[0]; if (!s || String(s.Status) !== 'PLANNED') return;
    _v65SetCell_('SCH', s._row, 'Status', status === 'DONE' ? 'DONE' : status === 'MISSED' ? 'MISSED' : 'DEVIATION');
    _v65SetCell_('SCH', s._row, 'FactID', factId || e.expectationId); _v65SetCell_('SCH', s._row, 'CompletedAt', new Date()); _v65SetCell_('SCH', s._row, 'CompletedBy', who || '');
  } catch (x) { try { _log_('WARN', 'график ППК: ' + x.message); } catch (y) {} }
}

/* ------------------------------------------------------------------ API */
function clgBuild(token) {
  try { _requireAuth_(token, 'ppk_edit|haccp|haccp_approve'); _ts2EnsureSchema_(false); var r = _clgBuild_(); _ts2Audit_('CHECKLIST_BUILD', 'PPK', r.ppkId || '—', undefined, r, 'чек-листы из действующей ППК'); return _ok_(r); } catch (e) { return _failFrom_(e); }
}
function clgTemplates(token) {
  try {
    _requireAuth_(token, 'ppk_view|ppk_edit|haccp|haccp_view|checklists|sanitation'); _ts2EnsureSchema_(false);
    var p = _clgActivePpk_(), list = _clgTemplates_().map(function (t) { return { id: t.templateId, title: t.title, items: _ts2Json_(t.items, []), mode: t.executionMode, coveredBy: t.coveredBy, frequency: t.frequency, time: t.dueTime, role: t.responsibleRole, journal: t.journalCode, ppkId: t.ppkId }; });
    return _ok_({ ppk: p ? { id: p.PPKID, name: p.Name, version: p.Version } : null, templates: list });
  } catch (e) { return _failFrom_(e); }
}
