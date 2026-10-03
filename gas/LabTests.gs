// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — LabTests.gs
 * Секондарные фичи, раунд 3 (после TASKS и EVENTS, см. TSEKH_v2_CHANGELOG.md разделы
 * 27-28) — Лабораторный модуль v2 (Архитектура v4 §8, §12 п.3).
 *
 * ЧЕСТНО: до этого раунда реального бэкенда у "Лаборатории" НЕ существовало вообще —
 * модуль был только клиентским мок-демо (demo/demo.html, DB.labTests/DB.labTypes/
 * DB.labCct), без единой строки в Google Таблице и без единого серверного файла. Этот
 * раунд строит РЕАЛЬНЫЙ бэкенд с нуля, ОПИРАЯСЬ на структуру данных демо (те же по
 * смыслу поля: target/targetType/targetName/type/lab/protocol/sampleDate/resultDate/
 * nextDate/result/conclusion/resp/params), но не просто копируя её — ТЗ v4 §8 явно
 * требует три добавления сверх демо:
 *
 *   1. Связи ProductID/LotID/ProductionID/RecipeID/HazardID/CCPID — новые опциональные
 *      поля на LAB_TESTS (product_id/lot_id/production_id/recipe_id/hazard_id/ccp_id).
 *      ЧЕСТНО: hazard_id/ccp_id принимаются и сохраняются, но НЕ проверяются на
 *      принадлежность организации — таблиц HAZARDS/CCP не существует, это следующий
 *      раунд (§12 п.5, Нормативная база/HACCP Engine). product_id/lot_id(=BATCHES.
 *      batch_id)/production_id/recipe_id/workshop_id/definition_id — таблицы уже
 *      существуют, поэтому ПРОВЕРЯЮТСЯ на принадлежность организации/точки (ТЗ P0.1),
 *      тем же приёмом, что и остальной проект (assertOwnedByOrg_/assertOwnedByLocation_).
 *   2. LabSchedule (LAB_TEST_DEFINITIONS ниже) — план периодических исследований,
 *      по образцу JOURNAL_DEFINITIONS, но НАМЕРЕННО без полноценного движка слотов
 *      (regenerateJournalSlots_/AUTO_JOURNAL_PENDING) — см. докстринг SCHEMA.
 *      LAB_TEST_DEFINITIONS в Config.gs за обоснованием этого упрощения.
 *   3. Обязательный повторный отбор при FAIL — createLabTest_ ниже, при провале
 *      результата и наличии definitionId с дни_на_повтор_при_fail > 0, сдвигает
 *      следующая_дата этого расписания на "сегодня + N дней" (ЧЕСТНО: работает
 *      ТОЛЬКО когда проваленный тест связан с definitionId — то есть был плановым;
 *      для полностью разового теста без расписания планировать повтор не от чего).
 *
 * Демо создавало при FAIL локальную задачу с type:'corrective' — архитектурный
 * документ v4 §6/§30 явно перечисляет 'lab' как отдельный тип задачи в словаре TASKS —
 * здесь используется 'lab', а не 'corrective' (спецификация текущего раунда важнее
 * случайного более раннего выбора демо-прототипа).
 *
 * LAB_RESULT_FAILED — восьмой из тринадцати типов Event Bus (Events.gs), явно отмеченный
 * НЕ подключённым в CHANGELOG раздела 28 ("нет модуля-источника") — теперь подключён.
 */

// Периодичность LAB_TEST_DEFINITIONS хранится в днях (числом), а не текстовой категорией,
// как у JOURNAL_DEFINITIONS.периодичность — лабораторный контроль низкочастотный
// (неделя/месяц/квартал), не "N раз за смену". Типы исследований — СОЗНАТЕЛЬНО свободный
// текст (не хардкоженный словарь), тем же приёмом, что и JOURNALS.тип_журнала — демо-список
// DB.labTypes ("Микробиология", "Физико-химические показатели" и т.п.) остаётся ориентиром
// для фронтенда-подсказки, а не серверным ограничением (ТЗ §27 — нормативная база не
// хардкодится).
var LAB_TEST_RESULTS = ['pass', 'fail', 'pending'];

// ---------- LAB_TEST_DEFINITIONS ("LabSchedule", ТЗ v4 §8 п.2) ----------

/**
 * organizationId приходит от вызывающего кода уже проверенным (session на уровне API.gs),
 * тем же приёмом, что и createJournalDefinition_ (Journals.gs) — location_id/workshop_id/
 * target (если указана конкретная связь) проверяются отдельно, потому что это ссылки,
 * которые клиент может подменить чужим id (ТЗ P0.1).
 */
function createLabTestDefinition_(data, actorUserId, session) {
  if (!data.organization_id || !data.тип_исследования) {
    throw new Error('Тип исследования обязателен для расписания лабораторного контроля (createLabTestDefinition_).');
  }
  if (session) {
    if (data.location_id) {
      assertOwnedByOrg_(session, findOne_('LOCATIONS', 'location_id', data.location_id), 'LOCATIONS:' + data.location_id);
      // Внешний P0-аудит, п.3 — та же ТОЧЕЧНАЯ (не только организационная) проверка, что
      // и в Notifications.gs::updateNotificationSetting_ — см. assertLocationAllowed_.
      assertLocationAllowed_(session, data.location_id, 'LOCATIONS:' + data.location_id);
    }
    if (data.workshop_id) {
      var ws = findOne_('WORKSHOPS', 'workshop_id', data.workshop_id);
      assertOwnedByOrg_(session, ws ? findOne_('LOCATIONS', 'location_id', ws.location_id) : null, 'WORKSHOPS:' + data.workshop_id);
    }
    _assertLabTargetOwned_(session, data.target_type, data.target_id);
  }
  var periodDays = Number(data.периодичность_дней);
  if (!(periodDays > 0)) periodDays = 7; // ТЗ §27 — недельный контроль как разумное умолчание, администратор меняет под себя
  var def = {
    definition_id: generateId_('LAB_TEST_DEFINITIONS'),
    organization_id: data.organization_id,
    location_id: data.location_id || '',
    workshop_id: data.workshop_id || '',
    target_type: data.target_type || '',
    target_id: data.target_id || '',
    target_name: data.target_name || '',
    тип_исследования: data.тип_исследования,
    периодичность_дней: periodDays,
    роль_ответственная: data.роль_ответственная || '',
    ответственный_id: data.ответственный_id || '',
    дни_на_повтор_при_fail: data.дни_на_повтор_при_fail === undefined ? '' : Number(data.дни_на_повтор_при_fail) || 0,
    source_document: data.source_document || '',
    следующая_дата: data.следующая_дата || todayDateStr_(),
    статус: 'активен'
  };
  insertRow_('LAB_TEST_DEFINITIONS', def);
  detectAndRequestPpkReview_(def.organization_id,def.location_id,'LAB_PROGRAM_CHANGED','LAB_TEST_DEFINITIONS',def.definition_id,actorUserId,session,'Изменена программа лабораторного контроля.');
  auditLog_(actorUserId, 'Создано расписание лаб. исследований', 'LAB_TEST_DEFINITIONS:' + def.definition_id, null, def.тип_исследования, 'success', session ? session.cascade_id : '');
  return def;
}

function getLabTestDefinitions_(organizationId, locationId) {
  return findRows_('LAB_TEST_DEFINITIONS', function (r) {
    return r.organization_id === organizationId && (!locationId || !r.location_id || r.location_id === locationId) && r.статус !== 'архив';
  });
}

/**
 * Внешний P0-аудит, п.3 (mass assignment + горизонтальный доступ, продолжение раунда 12) —
 * та же защита, что у updateJournalDefinition_: organization_id/location_id/workshop_id
 * из клиентского patch теперь игнорируются (их можно задать только при создании — там
 * они уже проверяются, см. createLabTestDefinition_), и добавлена проверка
 * assertLocationAllowed_ — иначе сотрудник одной точки мог изменить (не только
 * создать) расписание лаб. исследований, относящееся к соседней точке той же
 * организации.
 */
function updateLabTestDefinition_(definitionId, patch, session) {
  return withLock_(function () { // P0.2 — расписание влияет на последующие эскалации, та же защита, что у updateJournalDefinition_
    var def = findOne_('LAB_TEST_DEFINITIONS', 'definition_id', definitionId);
    assertOwnedByOrg_(session, def, 'LAB_TEST_DEFINITIONS:' + definitionId); // ТЗ P0.1
    if (def && def.location_id) assertLocationAllowed_(session, def.location_id, 'LAB_TEST_DEFINITIONS:' + definitionId);
    var safePatch = _stripProtectedFields_(patch, ['organization_id', 'location_id', 'workshop_id']);
    updateRow_('LAB_TEST_DEFINITIONS', def, safePatch);
    auditLog_(session.user_id, 'Изменено расписание лаб. исследований', 'LAB_TEST_DEFINITIONS:' + definitionId, null, JSON.stringify(safePatch), 'success', session.cascade_id);
    return findOne_('LAB_TEST_DEFINITIONS', 'definition_id', definitionId);
  });
}

// ---------- LAB_TESTS (сама запись исследования, ТЗ v4 §8 п.1+п.3) ----------

/**
 * params: { organizationId, locationId, workshopId, definitionId, targetType, targetId,
 *   targetName, productId, lotId, productionId, recipeId, hazardId, ccpId, testType,
 *   lab, protocol, sampleDate, resultDate, nextDate, result, conclusion,
 *   responsibleRole, responsibleId, params (массив {param,norm,fact,unit,pass}),
 *   userId, session }
 *
 * Авто-результат: если params (массив параметров) передан и непуст — результат
 * ВСЕГДА пересчитывается из него (совпадает с demo.html::saveLabTest — result = 'fail',
 * если хоть один параметр не прошёл, иначе 'pass'), клиентский result игнорируется.
 * Если массива нет — используется переданный result (или 'pending' по умолчанию).
 */
function createLabTest_(params) {
  return withLock_(function () {
    if (params.session) {
      if (params.workshopId) {
        var ws = findOne_('WORKSHOPS', 'workshop_id', params.workshopId);
        assertOwnedByOrg_(params.session, ws ? findOne_('LOCATIONS', 'location_id', ws.location_id) : null, 'WORKSHOPS:' + params.workshopId);
      }
      if (params.definitionId) {
        assertOwnedByOrg_(params.session, findOne_('LAB_TEST_DEFINITIONS', 'definition_id', params.definitionId), 'LAB_TEST_DEFINITIONS:' + params.definitionId);
      }
      if (params.responsibleId) {
        assertOwnedByOrg_(params.session, findOne_('USERS', 'user_id', params.responsibleId), 'USERS:' + params.responsibleId);
      }
      _assertLabTargetOwned_(params.session, params.targetType, params.targetId);
      if (params.productId) {
        assertOwnedByOrg_(params.session, getProductById_(params.productId), 'PRODUCTS:' + params.productId);
      }
      if (params.lotId) {
        assertOwnedByLocation_(params.session, findOne_('BATCHES', 'batch_id', params.lotId), 'BATCHES:' + params.lotId);
      }
      if (params.productionId) {
        assertOwnedByLocation_(params.session, findOne_('PRODUCTION', 'production_id', params.productionId), 'PRODUCTION:' + params.productionId);
      }
      if (params.recipeId) {
        var line = findOne_('RECIPES', 'recipe_id', params.recipeId);
        assertOwnedByOrg_(params.session, line ? _recipeParentOrg_(line.parent_type, line.parent_id) : null, 'RECIPES:' + params.recipeId);
      }
      // hazardId/ccpId — см. докстринг файла: сознательно не проверяются, таблиц ещё нет.
    }

    var paramsList = params.params || [];
    var result = params.result || 'pending';
    if (paramsList.length) {
      result = paramsList.some(function (p) { return p.pass === false; }) ? 'fail' : 'pass';
    }
    if (LAB_TEST_RESULTS.indexOf(result) === -1) {
      throw new Error('Недопустимый результат исследования: "' + result + '". Разрешено: ' + LAB_TEST_RESULTS.join(', ') + '.');
    }

    var test = {
      test_id: generateId_('LAB_TESTS'),
      organization_id: params.organizationId,
      location_id: params.locationId || '',
      workshop_id: params.workshopId || '',
      definition_id: params.definitionId || '',
      target_type: params.targetType || '',
      target_id: params.targetId || '',
      target_name: params.targetName || '',
      product_id: params.productId || '',
      lot_id: params.lotId || '',
      production_id: params.productionId || '',
      recipe_id: params.recipeId || '',
      hazard_id: params.hazardId || '',
      ccp_id: params.ccpId || '',
      тип_исследования: params.testType || '',
      лаборатория: params.lab || '',
      протокол: params.protocol || '',
      дата_отбора: params.sampleDate || todayDateStr_(),
      дата_результата: params.resultDate || '',
      следующая_дата: params.nextDate || '',
      результат: result,
      заключение: params.conclusion || '',
      ответственный_роль: params.responsibleRole || '',
      ответственный_id: params.responsibleId || '',
      параметры_json: JSON.stringify(paramsList),
      user_id: params.userId || '',
      создано: nowIso_()
    };
    insertRow_('LAB_TESTS', test);
    auditLog_(params.userId, 'Создано лабораторное исследование', 'LAB_TESTS:' + test.test_id, null,
      test.тип_исследования + ': ' + result, 'success', params.session ? params.session.cascade_id : '');

    if (result === 'fail') {
      _onLabTestFailed_(test);
    }

    return test;
  });
}

/**
 * ТЗ v4 §8 п.3 — при провале: (1) корректирующая задача в TASKS (type:'lab', см.
 * докстринг файла про выбор 'lab' вместо демо-версии 'corrective'), (2) уведомление
 * (провал_лабораторного_теста, та же маршрутизация, что и у настоящего критического
 * отклонения журнала — ХАССП-значимое событие), (3) LAB_RESULT_FAILED в Event Bus,
 * (4) если тест был плановым (definitionId указан) и в расписании настроен
 * дни_на_повтор_при_fail > 0 — принудительно сдвигает следующая_дата этого расписания
 * на "сегодня + N дней", вытесняя обычный периодический график повтором.
 *
 * Как и _createTaskForCorrectiveAction_ (Tasks.gs) — обёрнуто в try/catch на каждый
 * шаг: провал витрины (задача/уведомление/событие/переназначение) не должен откатывать
 * или ломать уже состоявшееся создание самой записи LAB_TESTS.
 */
function _onLabTestFailed_(test) {
  try {
    createTask_({
      organizationId: test.organization_id,
      locationId: test.location_id,
      type: 'lab',
      title: 'Повторный отбор пробы: ' + (test.target_name || test.тип_исследования),
      description: 'Провален результат лабораторного исследования "' + test.тип_исследования + '"' +
        (test.заключение ? (' — ' + test.заключение) : '') + '.',
      responsibleRole: test.ответственный_роль || 'ШЕФ-ПОВАР',
      priority: 'высокий',
      sourceEntityId: test.test_id,
      userId: test.user_id
    });
  } catch (err) {
    logSystemError_('_onLabTestFailed_', test.user_id, 'lab_task_bridge', err);
  }

  try {
    notify_(test.organization_id, test.location_id, CONFIG.NOTIFICATION_TYPES.LAB_RESULT_FAILED,
      'Провален лабораторный тест "' + test.тип_исследования + '"' + (test.target_name ? (' (' + test.target_name + ')') : '') + '.',
      'lab_fail|' + test.test_id);
  } catch (err) {
    logSystemError_('_onLabTestFailed_', test.user_id, 'lab_notify', err);
  }

  _emitEventSafe_({
    organizationId: test.organization_id, locationId: test.location_id, type: 'LAB_RESULT_FAILED',
    source: 'backend', entityType: 'LAB_TESTS', entityId: test.test_id,
    payload: { testType: test.тип_исследования, targetName: test.target_name, definitionId: test.definition_id }
  });

  if (test.definition_id) {
    try {
      var def = findOne_('LAB_TEST_DEFINITIONS', 'definition_id', test.definition_id);
      var retestDays = def ? Number(def.дни_на_повтор_при_fail) : 0;
      if (def && retestDays > 0) {
        updateRow_('LAB_TEST_DEFINITIONS', def, { следующая_дата: _addDaysToDateStr_(todayDateStr_(), retestDays) });
      }
    } catch (err) {
      logSystemError_('_onLabTestFailed_', test.user_id, 'lab_retest_reschedule', err);
    }
  }
}

function getLabTests_(organizationId, locationId, filters) {
  filters = filters || {};
  return findRows_('LAB_TESTS', function (r) {
    if (r.organization_id !== organizationId) return false;
    if (locationId && r.location_id !== locationId) return false;
    if (filters.result && r.результат !== filters.result) return false;
    if (filters.definitionId && r.definition_id !== filters.definitionId) return false;
    return true;
  }).sort(function (a, b) { return new Date(b.создано) - new Date(a.создано); });
}

/**
 * Триггер (Main.gs::labScheduleTrigger_, по образцу escalateOverdueJournals_). ЧЕСТНО
 * упрощённая версия по сравнению с журнальной эскалацией — см. докстринг
 * SCHEMA.LAB_TEST_DEFINITIONS (Config.gs): нет отдельной таблицы "ожидающих" слотов,
 * поэтому дедуп повторного срабатывания в тот же период устроен так: как только
 * расписание найдено просроченным — сразу же создаётся задача на отбор пробы И
 * следующая_дата сдвигается вперёд (сегодня + периодичность_дней), поэтому то же
 * расписание не сработает снова до наступления нового срока.
 */
function checkOverdueLabTests_() {
  var today = todayDateStr_();
  var overdue = findRows_('LAB_TEST_DEFINITIONS', function (r) {
    return r.статус === 'активен' && r.следующая_дата && r.следующая_дата < today;
  });
  overdue.forEach(function (def) {
    var periodDays = Number(def.периодичность_дней) || 7;
    updateRow_('LAB_TEST_DEFINITIONS', def, { следующая_дата: _addDaysToDateStr_(today, periodDays) });

    try {
      createTask_({
        organizationId: def.organization_id,
        locationId: def.location_id,
        type: 'lab',
        title: 'Требуется отбор пробы: ' + (def.target_name || def.тип_исследования),
        description: 'Плановое лабораторное исследование "' + def.тип_исследования + '" — срок отбора наступил (' + def.следующая_дата + ' было запланировано).',
        responsibleRole: def.роль_ответственная || 'ШЕФ-ПОВАР',
        responsibleId: def.ответственный_id,
        priority: 'обычный',
        sourceEntityId: def.definition_id,
        userId: null
      });
    } catch (err) {
      logSystemError_('checkOverdueLabTests_', null, 'lab_overdue_task', err);
    }

    notify_(def.organization_id, def.location_id, CONFIG.NOTIFICATION_TYPES.LAB_TEST_OVERDUE,
      'Просрочен плановый отбор пробы "' + def.тип_исследования + '".',
      'lab_overdue|' + def.definition_id + '|' + today);
    auditLog_(null, 'Просрочено плановое лаб. исследование', 'LAB_TEST_DEFINITIONS:' + def.definition_id, null, today, 'warning');
  });
}

// ---------- Хелперы ----------

/** target_type/target_id — мягко типизированная ссылка (унаследовано от demo.html): сегодня
 * проверяем принадлежность организации только для двух известных проекту типов ('product'/
 * 'dish'), остальные значения target_type пропускаются без проверки — расширяемо под
 * будущие типы целей без изменения сигнатуры функции. */
function _assertLabTargetOwned_(session, targetType, targetId) {
  if (!targetId) return;
  if (targetType === 'product') {
    assertOwnedByOrg_(session, getProductById_(targetId), 'PRODUCTS:' + targetId);
  } else if (targetType === 'dish') {
    assertOwnedByOrg_(session, findOne_('DISHES', 'dish_id', targetId), 'DISHES:' + targetId);
  }
}

function _addDaysToDateStr_(dateStr, days) {
  var d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + Number(days));
  return Utilities.formatDate(d, Session.getScriptTimeZone() || 'Etc/UTC', 'yyyy-MM-dd');
}
