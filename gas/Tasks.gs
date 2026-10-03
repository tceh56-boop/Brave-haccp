// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Tasks.gs
 * Секондарные фичи, раунд 1 (после закрытия P0.1-P0.8, см. TSEKH_v2_CHANGELOG.md
 * раздел 26.7) — единая таблица задач (Архитектура v4 §6, ТЗ v4 §30, Открытое
 * решение B из §9 — принято как есть: единая TASKS вместо трёх разных механизмов).
 *
 * TASKS НЕ заменяет существующие источники (журналы, отклонения, будущая
 * лаборатория/химия/ППК остаются как есть — это записи о факте со своими
 * специфичными полями). TASKS — единая точка, куда все они ПИШУТ при создании
 * задачи, вместо разрозненных списков. Сегодня единственный реальный писатель —
 * CORRECTIVE_ACTIONS (Journals.gs, оба места создания: критическое отклонение
 * введённого значения и просрочка неснятого измерения) — см. _createTaskForCorrectiveAction_
 * внизу файла и её вызовы из Journals.gs.
 *
 * ТЗ v4 §30 перечисляет 12 типов задач: journal/corrective/cleaning/chemical/lab/
 * maintenance/briefing/production/purchase/haccp/integration/ai. Все 12 занесены в
 * TASK_TYPES ниже как разрешённый словарь (валидация типа при создании), но
 * ЧЕСТНО: реальный автоматический писатель в этом раунде есть только у 'corrective'
 * — у остальных 11 типов пока нет ни одного модуля-источника в реальном бэкенде
 * (лаборатория/химия/ППК существуют только как демо в demo.html, интеграции не
 * подключены). CREATE_TASK (ручное создание) при этом работает для ЛЮБОГО типа из
 * словаря уже сейчас — это осознанно полезно само по себе (например, вручную
 * поставить 'maintenance'/'briefing' задачу до появления автоматического источника),
 * не вводит в заблуждение о статусе остальных модулей.
 */

var TASK_TYPES = ['journal', 'corrective', 'cleaning', 'chemical', 'lab', 'maintenance', 'briefing', 'production', 'purchase', 'haccp', 'integration', 'ai'];
var TASK_STATUSES = ['открыта', 'выполнено'];

/**
 * Создаёт задачу. organizationId/locationId ВСЕГДА приходят от вызывающего кода
 * уже проверенными (из session на уровне API.gs — тем же способом, что и
 * createProductionTask_/createWriteOff_ — или из внутреннего кода Journals.gs,
 * где они берутся из уже принадлежащей организации сущности), а не от клиента
 * напрямую — здесь их проверять уже не на что (ТЗ P0.1 закрывается на уровне
 * вызывающего, не дублируется здесь тем же приёмом, что и у остальных create-
 * функций проекта, см. Production.gs::createProductionTask_).
 *
 * responsibleId (если указан) — ссылка на USERS, которую клиент МОЖЕТ подменить
 * чужим id; проверяем её принадлежность организации отдельно (ТЗ P0.1), тем же
 * приёмом, что и addRecipeLine_ проверяет ingredientId.
 */
function createTask_(params) {
  // params: { organizationId, locationId, type, title, description, responsibleRole,
  //           responsibleId, priority, dueAt, sourceEntityId, userId, session }
  return withLock_(function () {
    if (TASK_TYPES.indexOf(params.type) === -1) {
      throw new Error('Недопустимый тип задачи: "' + params.type + '". Разрешено: ' + TASK_TYPES.join(', ') + '.');
    }
    if (!params.title) throw new Error('У задачи должен быть заголовок (title).');
    if (params.responsibleId && params.session) {
      var responsibleUser = findOne_('USERS', 'user_id', params.responsibleId);
      assertOwnedByOrg_(params.session, responsibleUser, 'USERS:' + params.responsibleId); // ТЗ P0.1
    }
    var task = {
      task_id: generateId_('TASKS'),
      organization_id: params.organizationId,
      location_id: params.locationId || '',
      type: params.type,
      title: params.title,
      description: params.description || '',
      responsible_role: params.responsibleRole || '',
      responsible_id: params.responsibleId || '',
      priority: params.priority || 'обычный',
      created_at: nowIso_(),
      due_at: params.dueAt || '',
      status: 'открыта',
      source_event_id: '', // Event Bus (Архитектура v4 §2) — следующий раунд, поле зарезервировано
      source_entity_id: params.sourceEntityId || '',
      completed_at: '',
      completed_by: ''
    };
    insertRow_('TASKS', task);
    auditLog_(params.userId, 'Создана задача', 'TASKS:' + task.task_id, null, params.type + ': ' + params.title, 'success', params.session ? params.session.cascade_id : '');
    // Секондарные фичи, раунд 2 (Архитектура v4 §2, Events.gs) — TASK_CREATED.
    _emitEventSafe_({ organizationId: params.organizationId, locationId: params.locationId, type: 'TASK_CREATED', source: 'backend', entityType: 'TASKS', entityId: task.task_id, payload: { taskType: params.type, title: params.title } });
    return task;
  });
}

/** organizationId обязателен и всегда фильтруется (ТЗ P0.1/П0.7 — см. CHANGELOG раздел 25 про цену молчаливого пропуска этого фильтра); locationId — опционально (пусто = вся организация, тот же принцип, что у getDashboard_/recalcEconomics_). */
function getTasks_(organizationId, locationId, filters) {
  filters = filters || {};
  return findRows_('TASKS', function (r) {
    if (r.organization_id !== organizationId) return false;
    if (locationId && r.location_id !== locationId) return false;
    if (filters.type && r.type !== filters.type) return false;
    if (filters.status && r.status !== filters.status) return false;
    return true;
  }).sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
}

function completeTask_(taskId, result, userId, session) {
  return withLock_(function () {
    var task = findOne_('TASKS', 'task_id', taskId);
    if (!task) throw new Error('Задача не найдена: ' + taskId);
    if (session) assertOwnedByOrgAndLocation_(session, task, 'TASKS:' + taskId); // ТЗ P0.1
    updateRow_('TASKS', task, {
      status: 'выполнено',
      completed_at: nowIso_(),
      completed_by: userId || ''
    });
    auditLog_(userId, 'Задача выполнена', 'TASKS:' + taskId, null, result || '', 'success', session ? session.cascade_id : '');
    return { task_id: taskId, status: 'выполнено' };
  });
}

/**
 * Внутренний хелпер — единственный сегодня реальный писатель в TASKS помимо
 * ручного CREATE_TASK. Вызывается из Journals.gs в обоих местах создания
 * CORRECTIVE_ACTIONS (критическое отклонение и просрочка). Не проходит через
 * withLock_ верхнего уровня отдельно — createTask_ сама реентерабельна (П0.2,
 * withLock_ — вложенные вызовы не виснут), а оба места вызова УЖЕ либо внутри
 * своего withLock_ (submitJournalValue_), либо не нуждаются в нём отдельно
 * (escalateOverdueJournals_ — триггер, без пользовательской сессии).
 *
 * organizationId/locationId берутся из уже доверенного источника вызывающей
 * функции (JOURNAL_DEFINITIONS/AUTO_JOURNAL_PENDING), не от клиента — здесь
 * дополнительная проверка scope не нужна (см. docstring createTask_ выше).
 */
function _createTaskForCorrectiveAction_(organizationId, locationId, actionId, title, description, responsibleRole, userId) {
  try {
    return createTask_({
      organizationId: organizationId,
      locationId: locationId,
      type: 'corrective',
      title: title,
      description: description,
      responsibleRole: responsibleRole,
      priority: 'высокий',
      sourceEntityId: actionId,
      userId: userId
    });
  } catch (err) {
    // Создание задачи в TASKS — дополнительная витрина поверх уже созданного и
    // полноценно работающего CORRECTIVE_ACTIONS (ТЗ P0.6, работает независимо от
    // TASKS с момента появления). Сбой здесь не должен откатывать или ломать уже
    // состоявшееся создание корректирующего действия/уведомления — логируем и
    // продолжаем, а не бросаем исключение наружу.
    logSystemError_('_createTaskForCorrectiveAction_', userId, 'tasks_bridge', err);
    return null;
  }
}
