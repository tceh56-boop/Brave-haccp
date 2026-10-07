/**
 * ЦЕХ — TriggerScheduler.gs
 *
 * Apps Script разрешает не больше 20 триггеров на проект, а обработчиков задач 28.
 * Поэтому installTriggers() ставит 6 триггеров-диспетчеров, а каждый диспетчер по очереди
 * вызывает свои задачи. Расписание задач прежнее:
 *  - 15 мин / 1 ч / 2 ч / 4 ч / 6 ч — задача запускается в диспетчере с тем же интервалом;
 *  - ежедневные — проверяются каждый час и запускаются один раз в сутки, начиная с часа
 *    из таблицы (время скрипта). Дата последнего запуска хранится в Script Properties,
 *    поэтому сдвиг срабатывания триггера на соседний час не приводит к пропуску или дублю.
 * Каждая задача обёрнута в try/catch: падение одной не останавливает остальные.
 */

var TRIGGER_SCHEDULE_ = {
  tick15m_: ['journalReminderTrigger_', 'eventAutomationStage26Trigger_', 'automationWorkflowSlaStage27Trigger_', 'posFulfillPendingSalesTrigger_'],
  tickHourly_: ['dailyAutoJournalTrigger_', 'overdueJournalTrigger_'],
  tick2hA_: ['criticalStockTrigger_', 'controlTowerStage23Trigger_', 'runAutomationDecisionTrigger_'],
  tick2hB_: ['enterpriseExecutionStage42to50Trigger_', 'digitalFactoryStage51to60Trigger_', 'autonomousOperationsStage81to90Trigger_'],
  tick4h_: ['digitalIntelligenceStage61to70Trigger_', 'autonomousPlanningStage71to80Trigger_'],
  tick6h_: ['safetyDeadlinesTrigger_', 'capaStage37Trigger_', 'core100FinalStage91to100Trigger_']
};

/** Ежедневные задачи: час запуска (время скрипта). Выполняются из tickHourly_. */
var DAILY_TRIGGER_HOURS_ = {
  periodClosingStage33Trigger_: 2,
  dailyBackupTrigger_: 3,
  complianceMatrixStage38Trigger_: 3,
  complianceCockpitStage39Trigger_: 4,
  enterpriseBoardPackStage40Trigger_: 5,
  labScheduleTrigger_: 6,
  kpiTargetsStage41Trigger_: 6,
  expiryCheckTrigger_: 7,
  declarationExpiryTrigger_: 8,
  alcoDailyTrigger_: 9, // M12: лицензия, неотправленные вскрытия
  managementEconomicsTrigger_: 9,
  demandPlanningTrigger_: 10,
  financeStage22Trigger_: 11
};

/** Запас до лимита 6 минут на одно выполнение: после него оставшиеся задачи переносятся на следующий тик. */
var TRIGGER_TIME_BUDGET_MS_ = 5 * 60 * 1000;

/** Триггеры, которые реально ставит installTriggers(). */
function getInstalledTriggerHandlers_() {
  return Object.keys(TRIGGER_SCHEDULE_);
}

function tick15m_() { runScheduledJobs_('tick15m_', TRIGGER_SCHEDULE_.tick15m_); }
function tick2hA_() { runScheduledJobs_('tick2hA_', TRIGGER_SCHEDULE_.tick2hA_); }
function tick2hB_() { runScheduledJobs_('tick2hB_', TRIGGER_SCHEDULE_.tick2hB_); }
function tick4h_() { runScheduledJobs_('tick4h_', TRIGGER_SCHEDULE_.tick4h_); }
function tick6h_() { runScheduledJobs_('tick6h_', TRIGGER_SCHEDULE_.tick6h_); }

function tickHourly_() {
  var startedAt = Date.now();
  runScheduledJobs_('tickHourly_', TRIGGER_SCHEDULE_.tickHourly_, startedAt);
  runDueDailyJobs_(startedAt);
}

function runScheduledJobs_(tickName, jobs, startedAt) {
  startedAt = startedAt || Date.now();
  for (var i = 0; i < jobs.length; i++) {
    if (Date.now() - startedAt > TRIGGER_TIME_BUDGET_MS_) {
      logSystemError_(tickName, null, 'trigger_scheduler', new Error('Не хватило времени, пропущены: ' + jobs.slice(i).join(', ')));
      return false;
    }
    runScheduledJob_(tickName, jobs[i]);
  }
  return true;
}

function runScheduledJob_(tickName, job) {
  try {
    var fn = globalThis[job];
    if (typeof fn !== 'function') throw new Error('Нет функции-обработчика ' + job);
    fn();
  } catch (err) {
    logSystemError_(job, null, 'trigger_scheduler', err, { tick: tickName });
  }
}

function runDueDailyJobs_(startedAt) {
  var tz = Session.getScriptTimeZone();
  var now = new Date();
  var today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var hour = Number(Utilities.formatDate(now, tz, 'H'));
  var props = PropertiesService.getScriptProperties();
  Object.keys(DAILY_TRIGGER_HOURS_).forEach(function (job) {
    if (hour < DAILY_TRIGGER_HOURS_[job]) return;
    var key = 'DAILY_JOB_LAST_RUN_' + job;
    if (props.getProperty(key) === today) return;
    if (Date.now() - startedAt > TRIGGER_TIME_BUDGET_MS_) return; // догонит следующий час
    props.setProperty(key, today);
    runScheduledJob_('tickHourly_', job);
  });
}
