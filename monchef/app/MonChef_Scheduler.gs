/**
 * MON CHEF — единый планировщик автозапусков.
 *
 * Google разрешает не больше 20 триггеров на проект, а модули системы вместе
 * ставят 26. Здесь все расписания собраны в два триггера-диспетчера:
 *   monChefFrequentTick — раз в 5 минут, задачи с интервалом 5–30 минут;
 *   monChefHourlyTick   — раз в час, ежечасные, ежедневные, еженедельные и
 *                         ежемесячные задачи.
 * Расписание каждой задачи то же, что ставил её собственный установщик.
 * Задача, не успевшая выполниться (лимит времени, ошибка), выполнится
 * на следующем тике: срок считается по времени последнего успешного запуска.
 *
 * Установка: выполнить installAllTriggers() один раз. Функция снимает ВСЕ
 * триггеры проекта (включая поставленные старыми установщиками) и ставит два.
 */

var MC_SCHEDULE = [
  // каждые N минут
  { fn: 'runMonChefMyTasksCycleSystem', everyMin: 5 },
  { fn: 'runMonChefProductionHaccpBridgeCycleSystem', everyMin: 5 },
  { fn: 'runMonChefShiftCycleSystem', everyMin: 5 },
  { fn: 'checkPendingOverdue', everyMin: 15 },
  { fn: 'mcShiftClosingTick', everyMin: 30 },
  { fn: 'mcNotifyTick', everyMin: 15 },
  { fn: 'runMonChefHaccpControlCenterCycleSystem', everyMin: 15 },
  { fn: 'runMonChefHaccpControlCycleSystem', everyMin: 15 },
  { fn: 'runMonChefFullControlCycleSystem', everyMin: 30 },
  // ежечасно
  { fn: 'runMonChefControlCycleSystem', everyMin: 60 },
  { fn: 'mcSwitchWatchSystem', everyMin: 60 },
  { fn: 'archiveMonChefMonthly', everyMin: 60 },
  { fn: 'autoCreateChecklistEntries', everyMin: 60 },
  { fn: 'autoFillJournalsFromEvents', everyMin: 60 },
  { fn: 'v43AutomationTick', everyMin: 60 },
  { fn: 'mcBatchExpiryWatchSystem', everyMin: 60 },
  { fn: 'mcMercurySyncPendingSystem', everyMin: 30 },
  { fn: 'mcProcessingWatchSystem', everyMin: 30 },
  { fn: 'mcVsdOverdueWatchSystem', everyMin: 30 },
  // ежедневно в указанный час (часовой пояс проекта)
  { fn: 'generateJournalPending', hour: 5 },
  { fn: 'syncTTKScheduled', hour: 5 },
  { fn: 'autoHealthJournal', hour: 6 },
  { fn: 'autoRotationJournal', hour: 6 },
  { fn: 'medBooksDailyCheck', hour: 7 },
  { fn: 'autoFillMorningJournals', hour: 8 },
  { fn: 'runMonChefWeeklyDispatcherCycleSystem', hour: 10 },
  { fn: 'runMonChefWeeklyPlanningCycleSystem', hour: 12 },
  { fn: 'autoFillEveningJournals', hour: 18 },
  { fn: 'autoFillCloseShiftChecklist', hour: 22 },
  // этап 10.8: autoLampRun / autoLampSessions сняты — работа ламп только по отметке человека
  { fn: 'refreshJournalsOnDrive', hour: 3 },
  // еженедельно (понедельник) и ежемесячно (1-е число)
  { fn: 'autoRecalcMinStock', weekDay: 1, hour: 6 },
  { fn: 'autoGenerateWeeklyCleaning', weekDay: 1, hour: 6 },
  { fn: 'autoGenerateGeneralCleaning', monthDay: 1, hour: 6 },
  { fn: 'autoVerificationSample', monthDay: 1, hour: 7 }
];

var MC_GLOBAL_ = this;
var MC_TICK_BUDGET_MS = 4.5 * 60 * 1000; // запас до 6-минутного лимита Google

function installAllTriggers() {
  var removed = 0, props0 = null;
  try { props0 = mcCleanupScriptProperties(); } catch (e) { props0 = { error: String(e) }; }   // старые служебные свойства — в словари (см. ниже)
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); removed++; });
  ScriptApp.newTrigger('monChefFrequentTick').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('monChefHourlyTick').timeBased().everyHours(1).create();
  // ручные правки листов-доказательств → журнал аудита (MonChef_Integrity.gs)
  var editAudit = typeof mcInstallEditAudit === 'function' && mcInstallEditAudit();
  var missing = MC_SCHEDULE.filter(function (j) { return typeof MC_GLOBAL_[j.fn] !== 'function'; })
    .map(function (j) { return j.fn; });
  var res = { ok: true, removedTriggers: removed, installedTriggers: editAudit ? 3 : 2, editAudit: !!editAudit, jobs: MC_SCHEDULE.length, missingJobs: missing, scriptProperties: props0 };
  Logger.log(JSON.stringify(res));
  return res;
}

function monChefFrequentTick() { return _mcRunDue_(function (j) { return j.everyMin && j.everyMin < 60; }); }
function monChefHourlyTick() { return _mcRunDue_(function (j) { return !j.everyMin || j.everyMin >= 60; }); }

// Состояние планировщика: что и когда последний раз выполнялось.
function getSchedulerStatus() {
  var props = PropertiesService.getScriptProperties();
  return MC_SCHEDULE.map(function (j) {
    return { fn: j.fn, schedule: _mcDescribe_(j), lastRun: _mcPropMapGet_('MC_JOB_LAST', j.fn) || props.getProperty('MC_JOB_LAST_' + j.fn) || '',
      lastError: _mcPropMapGet_('MC_JOB_ERR', j.fn) || props.getProperty('MC_JOB_ERR_' + j.fn) || '' };
  });
}

function _mcRunDue_(filter) {
  var started = Date.now(), now = new Date(), props = PropertiesService.getScriptProperties();
  var ran = [], failed = [], deferred = [];
  // раз в день — уборка служебных свойств (на случай, если их создал прежний код развёртывания)
  try { var dayKey = Utilities.formatDate(now, typeof _mcTz_ === 'function' ? _mcTz_() : 'Asia/Yekaterinburg', 'yyyyMMdd');
    if (props.getProperty('MC_PROPS_CLEAN_DAY') !== dayKey) { mcCleanupScriptProperties(); props.setProperty('MC_PROPS_CLEAN_DAY', dayKey); } } catch (e) {}
  MC_SCHEDULE.filter(filter).forEach(function (j) {
    if (!_mcIsDue_(j, now, _mcPropMapGet_('MC_JOB_LAST', j.fn) || props.getProperty('MC_JOB_LAST_' + j.fn))) return;
    if (Date.now() - started > MC_TICK_BUDGET_MS) { deferred.push(j.fn); return; }
    var f = MC_GLOBAL_[j.fn];
    if (typeof f !== 'function') { failed.push(j.fn + ': функция не найдена'); return; }
    try {
      f();
      _mcPropMapSet_('MC_JOB_LAST', j.fn, String(Date.now()));
      _mcPropMapSet_('MC_JOB_ERR', j.fn, null);
      ran.push(j.fn);
    } catch (e) {
      _mcPropMapSet_('MC_JOB_ERR', j.fn, new Date().toISOString() + ' ' + String(e).slice(0, 160));
      failed.push(j.fn + ': ' + e);
    }
  });
  return { ok: !failed.length, ran: ran, failed: failed, deferred: deferred };
}

function _mcIsDue_(j, now, lastRaw) {
  var last = lastRaw ? new Date(Number(lastRaw)) : null;
  if (j.everyMin) return !last || now.getTime() - last.getTime() >= (j.everyMin - 1) * 60000;
  var tz = _mcTz_();
  var hour = Number(Utilities.formatDate(now, tz, 'H'));
  var day = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  if (hour < j.hour) return false;
  if (j.weekDay && Number(Utilities.formatDate(now, tz, 'u')) !== j.weekDay) return false;
  if (j.monthDay && Number(Utilities.formatDate(now, tz, 'd')) !== j.monthDay) return false;
  return !last || Utilities.formatDate(last, tz, 'yyyy-MM-dd') !== day;
}

function _mcDescribe_(j) {
  if (j.everyMin) return 'каждые ' + j.everyMin + ' мин';
  if (j.weekDay) return 'по понедельникам с ' + j.hour + ':00';
  if (j.monthDay) return j.monthDay + '-го числа с ' + j.hour + ':00';
  return 'ежедневно с ' + j.hour + ':00';
}

/* ---------- Свойства скрипта: служебное состояние — в нескольких свойствах-словарях ----------
   Редактор Apps Script показывает свойства скрипта только для чтения, если их больше 50. Раньше система сама создавала
   по свойству на каждую задачу расписания (MC_JOB_LAST_…, MC_JOB_ERR_…, 34 задачи), на каждый день (OP_SEQ_ГГГГММДД),
   на каждую просроченную накладную (MC_VT_ESC_…) и на каждый месяц архива (MC_V8_ARCHIVE_DONE_…) — и через несколько
   недель владелец не мог добавить свои свойства (почта, смена, организация). Теперь это по одному свойству на вид. */
var MC_PROPS_MAX_ = 8500;   // предел значения свойства у Google — 9 КБ
function _mcPropMapRead_(name) { try { var v = PropertiesService.getScriptProperties().getProperty(name); var o = v ? JSON.parse(v) : {}; return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
function _mcPropMapGet_(name, key) { var m = _mcPropMapRead_(name); return m[key] === undefined ? '' : m[key]; }
/** value === null — удалить ключ. Перечитывает свойство перед записью (между тиками), не растёт больше предела: старые ключи уходят первыми. */
function _mcPropMapSet_(name, key, value) {
  var p = PropertiesService.getScriptProperties(), m = _mcPropMapRead_(name);
  if (value === null || value === undefined) { if (!(key in m)) return; delete m[key]; } else m[key] = value;
  var keys = Object.keys(m), s = JSON.stringify(m);
  while (s.length > MC_PROPS_MAX_ && keys.length) { delete m[keys.shift()]; s = JSON.stringify(m); }
  if (Object.keys(m).length) p.setProperty(name, s); else p.deleteProperty(name);
}
function _mcPropHash_(s) {
  try { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(s), Utilities.Charset.UTF_8)).slice(0, 12); } catch (e) { return String(s).slice(0, 40); }
}
/** Уборка свойств скрипта: старые служебные свойства переносятся в словари и удаляются. Свойства владельца
 *  (почта, смена, организация, «Меркурий», ключи распознавания) не трогаются. Можно выполнить из редактора:
 *  выбрать mcCleanupScriptProperties → «Выполнить»; итог — в журнале выполнения. Запускается и сама: installAllTriggers и раз в день. */
function mcCleanupScriptProperties() {
  var p = PropertiesService.getScriptProperties(), all = p.getProperties(), before = Object.keys(all).length, removed = { OP_SEQ: 0, MC_JOB: 0, MC_VT_ESC: 0, MC_V8_ARCHIVE_DONE: 0 };
  var tz = typeof _mcTz_ === 'function' ? _mcTz_() : 'Asia/Yekaterinburg', today = Utilities.formatDate(new Date(), tz, 'yyyyMMdd');
  var last = _mcPropMapRead_('MC_JOB_LAST'), err = _mcPropMapRead_('MC_JOB_ERR'), esc = _mcPropMapRead_('MC_VT_ESC'), arc = _mcPropMapRead_('MC_V8_ARCHIVE_DONE');
  var seq = String(all['OP_SEQ'] || ''), sm = /^(\d{8}):(\d+)$/.exec(seq), seqToday = sm && sm[1] === today ? parseInt(sm[2], 10) : 0, del = [];
  Object.keys(all).forEach(function (k) {
    var v = all[k], m;
    if ((m = /^OP_SEQ_(\d{8})$/.exec(k))) { if (m[1] === today) seqToday = Math.max(seqToday, parseInt(v, 10) || 0); del.push(k); removed.OP_SEQ++; }
    else if ((m = /^MC_JOB_LAST_(.+)$/.exec(k))) { if (!last[m[1]] || Number(v) > Number(last[m[1]])) last[m[1]] = String(v); del.push(k); removed.MC_JOB++; }
    else if ((m = /^MC_JOB_ERR_(.+)$/.exec(k))) { if (!err[m[1]]) err[m[1]] = String(v).slice(0, 180); del.push(k); removed.MC_JOB++; }
    else if ((m = /^MC_VT_ESC_(.+)$/.exec(k))) { esc[_mcPropHash_(m[1])] = String(v); del.push(k); removed.MC_VT_ESC++; }
    else if ((m = /^MC_V8_ARCHIVE_DONE_(.+)$/.exec(k))) { arc[m[1]] = '1'; del.push(k); removed.MC_V8_ARCHIVE_DONE++; }
  });
  if (seqToday) p.setProperty('OP_SEQ', today + ':' + seqToday);
  var put = function (name, m) { var keys = Object.keys(m), s = JSON.stringify(m); while (s.length > MC_PROPS_MAX_ && keys.length) { delete m[keys.shift()]; s = JSON.stringify(m); } if (Object.keys(m).length) p.setProperty(name, s); };
  put('MC_JOB_LAST', last); put('MC_JOB_ERR', err); put('MC_VT_ESC', esc); put('MC_V8_ARCHIVE_DONE', arc);
  del.forEach(function (k) { p.deleteProperty(k); });
  var after = Object.keys(p.getProperties()).length, res = { before: before, after: after, removed: removed, editableInEditor: after <= 50 };
  try { Logger.log('Свойства скрипта: было ' + before + ', стало ' + after + (after <= 50 ? ' — в редакторе снова можно добавлять свойства.' : ' — всё ещё больше 50: посмотрите, какие свойства лишние.') + ' ' + JSON.stringify(removed)); } catch (e) {}
  return res;
}
