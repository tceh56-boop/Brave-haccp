// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Events.gs
 * Секондарные фичи, раунд 2 (после TASKS, раздел 27 CHANGELOG) — Event Bus
 * (Архитектура v4 §2, Открытое решение A — принято: отдельная таблица EVENTS,
 * а не расширение AUDIT_LOG).
 *
 * Почему отдельная таблица, а не AUDIT_LOG (уже есть, пишет почти то же самое):
 * у них разные читатели и разная семантика.
 *   - AUDIT_LOG — для ЧЕЛОВЕКА: "что произошло, когда, было→стало". Immutable,
 *     человекочитаемый (auditLog_, Utils.gs), не требует статуса обработки.
 *   - EVENTS — для МАШИН-подписчиков (будущий Telegram-канал уведомлений, будущие
 *     исходящие интеграции — §12 порядка, пункт 6, ещё не реализован): нужен статус
 *     доставки (status), idempotency_key (защита от дублей при повторной обработке),
 *     retry_count. Смешивать их означало бы добавить в AUDIT_LOG поля, не нужные
 *     99% его сегодняшних читателей (людям, листающим историю), и испортить уже
 *     стабильную простую структуру аудита.
 *
 * Event Bus НЕ заменяет processOperation() — он подписан на его результаты:
 * emitEvent_() вызывается ИЗНУТРИ уже существующих обработчиков (по одному вызову
 * в конце нужного места), не образует отдельный путь мутации данных. Ни одного
 * подписчика (consumer/poller) в этом раунде НЕТ — это следующий пункт порядка §12
 * (Интеграции, адаптеры + честные заглушки), которому EVENTS нужен как готовая
 * инфраструктура ДО него, а не наоборот. См. раздел "ЧТО НЕ РЕАЛИЗОВАНО" в
 * CHANGELOG за честным списком того, что сюда НЕ входит в этом раунде.
 *
 * ТЗ v4 §2 перечисляет 13 типов событий — все занесены в EVENT_TYPES как разрешённый
 * словарь, но ЧЕСТНО: реальный источник (существующий обработчик, который сегодня
 * действительно к этому приводит) подключён только для 7 из 13 — см. комментарии на
 * местах вызова emitEvent_ по всему проекту и раздел CHANGELOG за полным разбором,
 * почему остальные 6 не подключены (не выдумка недостающей логики, а её отсутствие:
 * либо соответствующего модуля ещё нет в реальном бэкенде, либо нет надёжного
 * признака различить событие без новой, отдельно согласуемой логики).
 */

var EVENT_TYPES = ['PRIMARY_OPERATION_RECORDED', 'SALE_CREATED', 'RECEIPT_CREATED', 'PRODUCTION_CREATED', 'WRITE_OFF_CREATED',
  'STOCK_CHANGED', 'TEMPERATURE_RECORDED', 'DEVIATION_CREATED', 'TASK_CREATED', 'TASK_OVERDUE',
  'LAB_RESULT_FAILED', 'CLEANING_COMPLETED', 'CHEMICAL_USED', 'EXPIRY_WARNING',
  'SAFETY_INSTRUCTION_CREATED','SAFETY_INSTRUCTION_APPROVED','SAFETY_INSTRUCTION_ASSIGNED','SAFETY_INSTRUCTION_OPENED',
  'SAFETY_BRIEFING_STARTED','SAFETY_TEST_STARTED','SAFETY_TEST_COMPLETED','SAFETY_TEST_PASSED','SAFETY_TEST_FAILED',
  'SAFETY_CONFIRMATION_CREATED','SAFETY_BRIEFING_EXPIRED','SAFETY_BRIEFING_REASSIGNED',
  'EMPLOYEE_CREATED','EMPLOYEE_UPDATED','EMPLOYEE_TRANSFERRED','POSITION_CHANGED','WORKSHOP_CHANGED','EQUIPMENT_ASSIGNED','EQUIPMENT_CHANGED','ACCESS_GRANTED','ACCESS_EXPIRED','ACCESS_REVOKED','TRAINING_OVERDUE'];

var EVENT_STATUSES = ['PENDING', 'PROCESSED'];

/**
 * Создаёт событие. organizationId/locationId/entityType/entityId — от уже доверенного
 * вызывающего кода (тем же принципом, что и createTask_/_recordOp_ — см. их докстринги),
 * не от клиента напрямую.
 *
 * idempotencyKey (опционально) — если событие с таким же (organizationId, type,
 * idempotencyKey) уже существует, НЕ создаёт дубликат, а возвращает уже существующую
 * запись (тот же приём, что NOTIFICATION_LOG.event_key и OPERATIONS.operation_id).
 * Нужен там, где один и тот же бизнес-факт МОГ БЫ попытаться попасть в шину дважды
 * (например, при повторной обработке идемпотентной операции, П0.2).
 */
function emitEvent_(params) {
  // params: { organizationId, locationId, type, source, entityType, entityId, payload, idempotencyKey }
  if (EVENT_TYPES.indexOf(params.type) === -1) {
    throw new Error('Недопустимый тип события: "' + params.type + '". Разрешено: ' + EVENT_TYPES.join(', ') + '.');
  }
  if (params.idempotencyKey) {
    var existing = findRows_('EVENTS', function (r) {
      return r.organization_id === params.organizationId && r.location_id === (params.locationId || '') && r.type === params.type && r.idempotency_key === params.idempotencyKey;
    })[0];
    if (existing) return existing;
  }
  var event = {
    event_id: generateId_('EVENTS'),
    organization_id: params.organizationId || '',
    location_id: params.locationId || '',
    workshop_id: params.workshopId || '',
    type: params.type,
    source: params.source || 'system',
    entity_type: params.entityType || '',
    entity_id: params.entityId || '',
    operation_id: params.operationId || '',
    payload_json: JSON.stringify(params.payload || {}),
    idempotency_key: params.idempotencyKey || '',
    status: 'PENDING',
    retry_count: 0,
    created_at: nowIso_(),
    processed_at: '',
    error_code: '',
    error_message: ''
  };
  insertRow_('EVENTS', event);
  return event;
}

/**
 * "Безопасная" обёртка для вызова из уже критического пути другой операции — тем же
 * приёмом, что и _createTaskForCorrectiveAction_ (Tasks.gs): сбой публикации события
 * НЕ должен откатывать или ломать уже состоявшуюся основную операцию (приход/
 * производство/списание и т.д.), потому что Event Bus — дополнительная витрина поверх
 * уже полностью рабочей системы, а не критический путь. Используется на всех местах
 * вызова emitEvent_ из ACTION_HANDLERS-цепочек; прямой emitEvent_ (бросающий) остаётся
 * для внутреннего/тестового кода, которому нужно реальное исключение при ошибке.
 */
function _emitEventSafe_(params) {
  try {
    return emitEvent_(params);
  } catch (err) {
    logSystemError_('_emitEventSafe_', null, 'event_bus', err);
    return null;
  }
}

/** Для будущих подписчиков (§12, следующий пункт — Интеграции) и для тестов. organizationId обязателен, фильтруется всегда (та же дисциплина, что и getTasks_ — см. Tasks.gs/CHANGELOG раздел 25 про цену пропуска этого фильтра). */
function getEvents_(organizationId, filters) {
  filters = filters || {};
  return findRows_('EVENTS', function (r) {
    if (r.organization_id !== organizationId) return false;
    if (filters.type && r.type !== filters.type) return false;
    if (filters.status && r.status !== filters.status) return false;
    return true;
  }).sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); }); // старые первыми — очередь, не лента
}

/** Отмечает событие обработанным. Без session — вызывается будущим подписчиком (внутренний процесс, не клиентом через API), как и escalateOverdueJournals_/dailyAutoJournalTrigger_. */
function markEventProcessed_(eventId) {
  var event = findOne_('EVENTS', 'event_id', eventId);
  if (!event) throw new Error('Событие не найдено: ' + eventId);
  updateRow_('EVENTS', event, { status: 'PROCESSED', processed_at: nowIso_() });
  return { event_id: eventId, status: 'PROCESSED' };
}
