// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Deploy.gs (подготовка к деплою и UAT, после P22.3)
 *
 * Зачем файл нужен:
 *  1. Функции миграций (migrateP22Schema_, migrateP22_3EmployeeSafetySchema_) заканчиваются на "_" —
 *     в Apps Script такие функции ПРИВАТНЫЕ и не видны в списке «Выполнить» редактора. Здесь для них
 *     публичные обёртки без нижнего подчёркивания.
 *  2. deployPreflight() — read-only проверка окружения перед UAT/Go-Live (ничего не пишет и не удаляет).
 *  3. safetyDeadlinesTrigger_() — планировщик просрочки инструктажей и истечения допусков к
 *     оборудованию. Раньше processSafetyDeadlines_ вызывалась только вручную через API, а
 *     expireEmployeeEquipmentPermissions_ не вызывалась нигде.
 *  4. seedUatData() — тестовые данные для UAT. Работает ТОЛЬКО если Script Property ENVIRONMENT = UAT/TEST.
 *
 * Файл НЕ добавляет doGet/doPost и не создаёт новых таблиц.
 */

var DEPLOY_ALLOWED_SEED_ENVIRONMENTS_ = ['UAT', 'TEST'];
var UAT_ORG_NAME_ = 'UAT ЦЕХ';

/** Единый список обработчиков триггеров — используют installTriggers() и deployPreflight(). */
function getExpectedTriggerHandlers_() {
  return ['dailyBackupTrigger_', 'dailyAutoJournalTrigger_', 'journalReminderTrigger_',
    'overdueJournalTrigger_', 'expiryCheckTrigger_', 'criticalStockTrigger_', 'labScheduleTrigger_',
    'declarationExpiryTrigger_', 'safetyDeadlinesTrigger_', 'managementEconomicsTrigger_', 'demandPlanningTrigger_', 'financeStage22Trigger_', 'controlTowerStage23Trigger_', 'runAutomationDecisionTrigger_', 'eventAutomationStage26Trigger_', 'automationWorkflowSlaStage27Trigger_', 'periodClosingStage33Trigger_', 'capaStage37Trigger_', 'complianceMatrixStage38Trigger_', 'complianceCockpitStage39Trigger_', 'enterpriseBoardPackStage40Trigger_', 'kpiTargetsStage41Trigger_', 'enterpriseExecutionStage42to50Trigger_', 'digitalFactoryStage51to60Trigger_', 'digitalIntelligenceStage61to70Trigger_', 'autonomousPlanningStage71to80Trigger_', 'autonomousOperationsStage81to90Trigger_', 'core100FinalStage91to100Trigger_'];
}

/**
 * Публичная обёртка над миграциями. Идемпотентна: initializeDatabase не трогает существующие
 * листы, миграции только ДОБАВЛЯЮТ недостающие колонки в конец и не переписывают данные.
 */
function runAllMigrations() {
  var report = {};
  report.initialize = initializeDatabase();
  report.p22 = migrateP22Schema_();
  report.p22_3 = migrateP22_3EmployeeSafetySchema_();
  report.batchProductionDate = migrateBatchProductionDateSchema_();
  Logger.log('runAllMigrations: готово. Запустите deployPreflight() для проверки.');
  return report;
}

/** Планировщик: просрочка инструктажей + истечение допусков. Только помечает и уведомляет, ничего не блокирует само. */
function safetyDeadlinesTrigger_() {
  try {
    getOrganizations_(null).forEach(function (org) {
      try {
        withLock_(function () {
          var session = {
            user_id: 'system', organization_id: org.organization_id, location_id: '',
            'роль': 'ADMIN', allowed_locations: [], cascade_id: '', operation_id: ''
          };
          processSafetyDeadlines_(org.organization_id);
          expireEmployeeEquipmentPermissions_(session);
        });
      } catch (orgErr) {
        logSystemError_('safetyDeadlinesTrigger_', null, 'safety_deadlines', orgErr, { organization_id: org.organization_id });
      }
    });
  } catch (err) {
    logSystemError_('safetyDeadlinesTrigger_', null, 'safety_deadlines', err);
  }
}

/**
 * Read-only проверка готовности. Возвращает {ok, environment, checks:[{name,status,detail}]},
 * status: PASS | WARN | FAIL. ok=false, если есть хотя бы один FAIL.
 */
function deployPreflight() {
  var checks = [];
  function add(name, status, detail) { checks.push({ name: name, status: status, detail: detail || '' }); }
  var props = PropertiesService.getScriptProperties();
  var environment = props.getProperty('ENVIRONMENT') || '';
  var ss = null;

  add('ENVIRONMENT', environment ? 'PASS' : 'WARN',
    environment ? environment : 'Script Property ENVIRONMENT не задана (ожидается UAT или PROD).');

  try {
    ss = getDatabase_();
    add('SPREADSHEET_ID', 'PASS', 'Таблица открыта: ' + ss.getName());
  } catch (err) {
    add('SPREADSHEET_ID', 'FAIL', String((err && err.message) || err));
  }

  try {
    add('TIMEZONE', 'PASS', 'Часовой пояс скрипта: ' + Session.getScriptTimeZone() +
      ' (влияет на слоты журналов, сроки и часы триггеров — сверьте с точкой).');
  } catch (tzErr) {
    add('TIMEZONE', 'WARN', String(tzErr.message || tzErr));
  }

  if (ss) {
    var missingSheets = [], driftColumns = [], total = 0;
    Object.keys(CONFIG.SHEETS).forEach(function (key) {
      var expected = CONFIG.SCHEMA[key];
      if (!expected) return;
      total++;
      var sheet = ss.getSheetByName(CONFIG.SHEETS[key]);
      if (!sheet) { missingSheets.push(CONFIG.SHEETS[key]); return; }
      var last = Math.max(1, sheet.getLastColumn());
      var headers = sheet.getRange(1, 1, 1, last).getValues()[0];
      var missing = expected.filter(function (h) { return headers.indexOf(h) === -1; });
      if (missing.length) driftColumns.push(CONFIG.SHEETS[key] + ': ' + missing.join(', '));
    });
    add('SHEETS', missingSheets.length ? 'FAIL' : 'PASS',
      missingSheets.length ? 'Нет листов (' + missingSheets.length + '): ' + missingSheets.slice(0, 10).join(', ') + ' — запустите runAllMigrations().'
        : 'Все ' + total + ' листов на месте.');
    add('SCHEMA_COLUMNS', driftColumns.length ? 'FAIL' : 'PASS',
      driftColumns.length ? 'Не хватает колонок: ' + driftColumns.slice(0, 5).join(' | ') + ' — запустите runAllMigrations().' : 'Заголовки соответствуют CONFIG.SCHEMA.');

    if (!missingSheets.length) {
      try {
        var orgs = getOrganizations_(null);
        add('ORGANIZATION', orgs.length ? 'PASS' : 'FAIL', orgs.length ? 'Организаций: ' + orgs.length : 'Нет ни одной организации.');
        var admins = findRows_('USERS', function (u) { return u['роль'] === 'ADMIN' && u['статус'] === 'активен'; });
        add('ADMIN_USER', admins.length ? 'PASS' : 'FAIL', admins.length ? 'Активных ADMIN: ' + admins.length : 'Нет активного ADMIN — войти будет некому.');
      } catch (dataErr) {
        add('ORGANIZATION', 'FAIL', String(dataErr.message || dataErr));
      }
    }
  }

  var expected = getExpectedTriggerHandlers_();
  var dispatchers = getInstalledTriggerHandlers_();
  try {
    var installed = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
    var absent = dispatchers.filter(function (h) { return installed.indexOf(h) === -1; });
    add('TRIGGERS', absent.length ? 'FAIL' : 'PASS',
      absent.length ? 'Не установлены: ' + absent.join(', ') + ' — запустите installTriggers().' : 'Все ' + dispatchers.length + ' триггеров-диспетчеров установлены.');
  } catch (trgErr) {
    add('TRIGGERS', 'FAIL', String(trgErr.message || trgErr));
  }

  var scheduled = [];
  Object.keys(TRIGGER_SCHEDULE_).forEach(function (k) { scheduled = scheduled.concat(TRIGGER_SCHEDULE_[k]); });
  scheduled = scheduled.concat(Object.keys(DAILY_TRIGGER_HOURS_));
  var unscheduled = expected.filter(function (h) { return scheduled.indexOf(h) === -1; });
  add('TRIGGER_SCHEDULE', unscheduled.length ? 'FAIL' : 'PASS',
    unscheduled.length ? 'Нет в расписании диспетчеров: ' + unscheduled.join(', ') : 'Все ' + expected.length + ' задач распределены по диспетчерам.');

  var missingFns = expected.concat(dispatchers).filter(function (h) { return typeof globalThis[h] !== 'function'; });
  add('TRIGGER_HANDLERS_EXIST', missingFns.length ? 'FAIL' : 'PASS',
    missingFns.length ? 'Нет функций-обработчиков: ' + missingFns.join(', ') : 'Функции-обработчики найдены.');

  add('OCR_YANDEX', (props.getProperty('YANDEX_OCR_API_KEY') && props.getProperty('YANDEX_FOLDER_ID')) ? 'PASS' : 'WARN',
    'Ключи YANDEX_OCR_API_KEY / YANDEX_FOLDER_ID: без них OCR накладных/деклараций выключен (остальное работает).');

  var ok = !checks.some(function (c) { return c.status === 'FAIL'; });
  checks.forEach(function (c) { Logger.log('[' + c.status + '] ' + c.name + ' — ' + c.detail); });
  Logger.log('deployPreflight: ' + (ok ? 'ГОТОВО (нет FAIL)' : 'ЕСТЬ FAIL — деплой/UAT не начинать'));
  return { ok: ok, environment: environment, checks: checks };
}

// ---------------------------------------------------------------------------------------------
// UAT seed
// ---------------------------------------------------------------------------------------------

function _uatRandomPin_() {
  var hex = Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  return String(parseInt(hex, 16) % 900000 + 100000);
}

/** Создаёт пользователя с случайным 6-значным PIN; при коллизии/отказе по PIN пробует новый. */
function _uatCreateUser_(base) {
  var lastErr = null;
  for (var i = 0; i < 8; i++) {
    var pin = _uatRandomPin_();
    try {
      var data = {};
      Object.keys(base).forEach(function (k) { data[k] = base[k]; });
      data.pin = pin;
      var user = createUser_(data);
      return { user: user, pin: pin };
    } catch (err) {
      lastErr = err;
      if (!/PIN|пин/i.test(String(err.message || err))) throw err;
    }
  }
  throw lastErr;
}

/**
 * Тестовые данные для UAT: организация «UAT ЦЕХ», точка, 10 пользователей (по одному на каждую роль +
 * второй повар), должность, 2 цеха, оборудование, ТЕСТОВАЯ инструкция/тест/требование безопасности.
 *
 * Гарантии:
 *  - выполняется только при ENVIRONMENT = UAT или TEST (иначе исключение, ничего не создаётся);
 *  - идемпотентна: при повторном запуске ничего не дублирует и PIN повторно НЕ показывает;
 *  - PIN случайные, выводятся один раз в журнал выполнения (Logger) и возвращаются вызывающему.
 *    Нигде больше в открытом виде не сохраняются;
 *  - инструкция помечена «[UAT]» и «не нормативный документ» — система не придумывает нормативку.
 */
function seedUatData() {
  var env = PropertiesService.getScriptProperties().getProperty('ENVIRONMENT');
  if (DEPLOY_ALLOWED_SEED_ENVIRONMENTS_.indexOf(env) === -1) {
    throw new Error('seedUatData отклонена: Script Property ENVIRONMENT = "' + (env || '') +
      '". Тестовые данные разрешено создавать только при ENVIRONMENT = UAT или TEST.');
  }
  var existing = findRows_('ORGANIZATIONS', function (o) { return o['название'] === UAT_ORG_NAME_ && o['статус'] !== 'удалена'; });
  if (existing.length) {
    Logger.log('seedUatData: организация «' + UAT_ORG_NAME_ + '» уже существует — ничего не создано, PIN повторно не выводятся.');
    return { ok: true, already_seeded: true, organization_id: existing[0].organization_id };
  }

  var org = createOrganization_({ 'название': UAT_ORG_NAME_ });
  var loc = createLocation_({ organization_id: org.organization_id, 'название': 'UAT Точка 1' });
  var credentials = [];
  var byRole = {};

  function makeUser(name, role, extra) {
    var base = { organization_id: org.organization_id, location_ids: [loc.location_id], 'имя': name, 'роль': role, actorUserId: '' };
    Object.keys(extra || {}).forEach(function (k) { base[k] = extra[k]; });
    var res = _uatCreateUser_(base);
    credentials.push({ role: role, name: name, user_id: res.user.user_id, pin: res.pin });
    byRole[name] = res.user;
    return res.user;
  }

  var director = makeUser('UAT Директор', 'ДИРЕКТОР');
  var session = {
    user_id: director.user_id, organization_id: org.organization_id, location_id: loc.location_id,
    'роль': 'ДИРЕКТОР', allowed_locations: [loc.location_id], cascade_id: '', operation_id: ''
  };

  var position = createPosition_({ name: 'ПОВАР', code: 'COOK' }, session);
  var hot = createWorkshop_({ organization_id: org.organization_id, location_id: loc.location_id, 'название': 'Горячий цех', 'тип': 'ГОРЯЧИЙ' }, director.user_id, session);
  var cold = createWorkshop_({ organization_id: org.organization_id, location_id: loc.location_id, 'название': 'Холодный цех', 'тип': 'ХОЛОДНЫЙ' }, director.user_id, session);
  var fryer = createEquipment_({ location_id: loc.location_id, workshop_id: hot.workshop_id, 'название': 'Фритюрница (UAT)', 'тип': 'фритюрница', risk_level: 'HIGH' }, director.user_id, session);
  createEquipment_({ location_id: loc.location_id, workshop_id: cold.workshop_id, 'название': 'Слайсер (UAT)', 'тип': 'слайсер', risk_level: 'MEDIUM' }, director.user_id, session);

  var doc = createSafetyDocument_({
    title: '[UAT] Тестовая инструкция по фритюрнице (не нормативный документ)', documentNumber: 'UAT-OT-001',
    documentType: 'ОХРАНА ТРУДА', version: '1.0', locationId: loc.location_id, workshopId: hot.workshop_id, source: 'LOCAL'
  }, session);
  approveSafetyDocument_(doc.document_id, session);
  activateSafetyDocument_(doc.document_id, session);
  var test = createSafetyTest_({ instructionId: doc.document_id, briefingType: 'ПЕРВИЧНЫЙ', passThreshold: 100, title: '[UAT] Тест по фритюрнице' }, session);
  addSafetyQuestion_({ testId: test.test_id, questionText: '[UAT] Можно ли использовать оборудование с повреждённым кабелем?', answerType: 'YES_NO', correctAnswer: 'НЕТ', source: 'LOCAL' }, session);
  addSafetyQuestion_({ testId: test.test_id, questionText: '[UAT] Можно ли лить воду в горячее масло?', answerType: 'YES_NO', correctAnswer: 'НЕТ', source: 'LOCAL' }, session);
  approveSafetyTest_(test.test_id, session);
  activateSafetyTest_(test.test_id, session);
  createSafetyRequirement_({
    locationId: loc.location_id, workshopId: hot.workshop_id, equipmentId: fryer.equipment_id, role: 'ПОВАР',
    documentId: doc.document_id, briefingType: 'ПЕРВИЧНЫЙ', required: true, methods: ['DOCUMENT_REVIEW', 'TEST', 'ACKNOWLEDGEMENT'],
    blockOperation: true, blockRuleCode: 'USE_FRYER', source: 'LOCAL'
  }, session);

  // Сотрудники создаются ПОСЛЕ требования — автоматический resolver сразу назначит инструктаж первому повару.
  makeUser('UAT Админ', 'ADMIN');
  makeUser('UAT Шеф-повар', 'ШЕФ-ПОВАР');
  makeUser('UAT Повар 1 (горячий цех)', 'ПОВАР', { position_id: position.position_id, workshop_id: hot.workshop_id, actorUserId: director.user_id, session: session });
  makeUser('UAT Повар 2 (холодный цех)', 'ПОВАР', { position_id: position.position_id, workshop_id: cold.workshop_id, actorUserId: director.user_id, session: session });
  makeUser('UAT Кладовщик', 'КЛАДОВЩИК');
  makeUser('UAT Технолог HACCP', 'ТЕХНОЛОГ_HACCP');
  makeUser('UAT Бухгалтер', 'БУХГАЛТЕР');
  makeUser('UAT Калькулятор', 'КАЛЬКУЛЯТОР');
  makeUser('UAT Менеджер', 'МЕНЕДЖЕР');
  makeUser('UAT Лаборант', 'ЛАБОРАНТ');

  Logger.log('=== UAT: PIN выведены ОДИН раз. Сохраните в защищённом месте и смените после UAT ===');
  credentials.forEach(function (c) { Logger.log(c.role + ' | ' + c.name + ' | PIN ' + c.pin); });
  return { ok: true, already_seeded: false, organization_id: org.organization_id, location_id: loc.location_id, credentials: credentials };
}
