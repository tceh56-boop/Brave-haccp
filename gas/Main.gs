// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Main.gs
 * ЕДИНСТВЕННЫЙ doGet()/doPost() проекта (ТЗ §34). Весь роутинг — через processOperation()
 * в API.gs. doGet отдаёт фронтенд (Index.html); doPost — единственный канал для действий,
 * меняющих данные. Если в будущем какой-то модуль искушает добавить ещё один doGet/doPost —
 * это ошибка архитектуры, а не новая фича.
 */

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('ЦЕХ')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var result = processOperation(body.action, body.data, body.token);
    return jsonResponse_(result);
  } catch (err) {
    logSystemError_('doPost', null, 'doPost', err);
    return jsonResponse_(userError_('Не удалось обработать запрос. Данные не изменены. Повторите операцию.'));
  }
}

/**
 * google.script.run-обёртка для фронтенда, развёрнутого как HtmlService (а не отдельный
 * fetch на /exec) — так iframe-песочница Apps Script не упирается в CORS. doPost остаётся
 * для внешних интеграций (мобильное приложение, вебхуки), если понадобятся позже.
 */
function api(action, data, token) {
  return processOperation(action, data, token);
}

/**
 * Устанавливает все триггеры проекта. Идемпотентна — сначала удаляет свои же старые
 * триггеры по имени функции, потом создаёт заново (паттерн installTriggers из Brave HACCP).
 * v2: добавлены триггеры напоминаний/просрочки/сроков годности/критического остатка (ТЗ §21/§27) —
 * все они ТОЛЬКО напоминают/помечают, ни один не придумывает данные за человека.
 */
function installTriggers() {
  // Лимит Apps Script — 20 триггеров на проект, задач 28. Поэтому ставим 6 диспетчеров
  // (TriggerScheduler.gs), каждый вызывает свои задачи с прежним расписанием.
  // Удаляем и свои диспетчеры, и старые триггеры отдельных задач от предыдущих версий.
  var handlers = getInstalledTriggerHandlers_().concat(getExpectedTriggerHandlers_());
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (handlers.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tick15m_').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('tickHourly_').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('tick2hA_').timeBased().everyHours(2).create();
  ScriptApp.newTrigger('tick2hB_').timeBased().everyHours(2).create();
  ScriptApp.newTrigger('tick4h_').timeBased().everyHours(4).create();
  ScriptApp.newTrigger('tick6h_').timeBased().everyHours(6).create();
  return 'Установлено триггеров-диспетчеров: ' + getInstalledTriggerHandlers_().length +
    ' (задач по расписанию: ' + getExpectedTriggerHandlers_().length + ').';
}

/** Генерирует авто-журналы для всех активных точек на основе их SETTINGS (рабочие часы/кол-во слотов). */
function dailyAutoJournalTrigger_() {
  try {
    getLocations_(null).forEach(function (loc) {
      generateJournalSlotsForLocation_(loc);
    });
  } catch (err) {
    logSystemError_('dailyAutoJournalTrigger_', null, 'auto_journal', err);
  }
}

/** ТЗ §21 п. "напоминание, если запись не сделана вовремя" — не создаёт значение, только уведомляет. */
function journalReminderTrigger_() {
  try {
    remindPendingJournals_();
  } catch (err) {
    logSystemError_('journalReminderTrigger_', null, 'journal_reminder', err);
  }
}

/** ТЗ §21 п. "просроченный журнал — эскалация". */
function overdueJournalTrigger_() {
  try {
    escalateOverdueJournals_();
  } catch (err) {
    logSystemError_('overdueJournalTrigger_', null, 'journal_overdue', err);
  }
}

/** ТЗ §33 — проверка сроков годности партий, уведомление, НЕ автосписание. */
function expiryCheckTrigger_() {
  try {
    checkExpiringBatches_();
  } catch (err) {
    logSystemError_('expiryCheckTrigger_', null, 'expiry_check', err);
  }
}

/** Раунд 8 (ТЗ §18) — ежедневная проверка истечения деклараций, см. Declarations.gs::checkDeclarationExpiries_. */
function declarationExpiryTrigger_() {
  try {
    checkDeclarationExpiries_();
  } catch (err) {
    logSystemError_('declarationExpiryTrigger_', null, 'declaration_expiry_check', err);
  }
}

/** Периодическая проверка критических остатков по всем продуктам/точкам (в дополнение к проверке "по факту операции"). */
function criticalStockTrigger_() {
  try {
    getProducts_(null).forEach(function (p) {
      getLocations_(p.organization_id).forEach(function (loc) {
        checkMinStockAndNotify_(p, loc.location_id);
      });
    });
  } catch (err) {
    logSystemError_('criticalStockTrigger_', null, 'critical_stock', err);
  }
}

/** Секондарные фичи, раунд 3 (Архитектура v4 §8 п.2-3) — просроченные плановые лаб. исследования: создаёт задачу отбора, уведомляет, сдвигает расписание. */
function labScheduleTrigger_() {
  try {
    checkOverdueLabTests_();
  } catch (err) {
    logSystemError_('labScheduleTrigger_', null, 'lab_schedule', err);
  }
}

/**
 * v2 — ИСПРАВЛЕНА ОШИБКА: раньше locationId принимался параметром, но НИКОГДА не
 * использовался в поиске — настройка ЛЮБОЙ точки возвращалась для запроса ЛЮБОЙ другой
 * точки (полностью нескоупированное чтение). Теперь ищем сначала настройку, привязанную
 * именно к этой точке (organization_id+location_id+ключ), и только если её нет — общую
 * настройку организации (location_id пустой) как запасной вариант. Настройка чужой
 * организации никогда не возвращается.
 */
function _getLocationSetting_(locationId, key, organizationId) {
  var loc = locationId ? findOne_('LOCATIONS', 'location_id', locationId) : null;
  var orgId = organizationId || (loc ? loc.organization_id : null);
  var scoped = findRows_('SETTINGS', function (r) {
    return r.organization_id === orgId && r.location_id === locationId && r.ключ === key;
  })[0];
  if (scoped) return scoped.значение;
  var orgWide = findRows_('SETTINGS', function (r) {
    return r.organization_id === orgId && (!r.location_id) && r.ключ === key;
  })[0];
  return orgWide ? orgWide.значение : null;
}

function capaStage37Trigger_(){try{getOrganizations_(null).forEach(function(org){try{runCapaSla_({user_id:'system',organization_id:org.organization_id,location_id:'',role:'ADMIN',allowed_locations:[],cascade_id:'',operation_id:''},300);}catch(e){logSystemError_('capaStage37Trigger_',null,'capa_sla',e,{organization_id:org.organization_id});}});}catch(err){logSystemError_('capaStage37Trigger_',null,'capa_sla',err);}}

function complianceMatrixStage38Trigger_(){try{getOrganizations_(null).forEach(function(org){try{runComplianceMatrix_({}, {user_id:'system',organization_id:org.organization_id,location_id:'',role:'ADMIN',allowed_locations:[],cascade_id:'',operation_id:''});}catch(e){logSystemError_('complianceMatrixStage38Trigger_',null,'compliance_matrix',e,{organization_id:org.organization_id});}});}catch(err){logSystemError_('complianceMatrixStage38Trigger_',null,'compliance_matrix',err);}}

