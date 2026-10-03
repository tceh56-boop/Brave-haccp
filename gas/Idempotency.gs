// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Idempotency.gs (P0.2, ТЗ §7)
 * "Повторная отправка одной и той же операции не должна создавать дубликаты."
 *
 * Механизм — классический idempotency key: клиент присылает data.operationId (один
 * и тот же при повторе сетевого запроса после обрыва/таймаута); если сервер такой
 * operation_id уже видел и успел ДОВЕСТИ ДО КОНЦА, он не выполняет обработчик снова —
 * а отдаёт СОХРАНЁННЫЙ результат первого выполнения. Так повторный клик/двойная
 * отправка формы/повтор после разрыва связи не создают вторую накладную/списание/etc.
 *
 * Честно (см. финальный отчёт P0.2): это только СЕРВЕРНАЯ половина идемпотентности.
 * Она полностью защищает от дублирования, ЕСЛИ клиент передаёт один и тот же
 * operationId при повторе. Сам фронтенд (Index.html/demo.html) в этом раунде НЕ
 * дописан генерировать/переиспользовать operationId при повторной отправке —
 * это отдельная, следующая интеграционная задача. Если клиент не прислал operationId,
 * processOperation() генерирует новый на каждый вызов (newOperationId_()) — операция
 * выполняется как обычно, просто без защиты от дублирования конкретно этого вызова.
 */

/** Новый operation_id — используется, когда клиент не передал свой (data.operationId). */
function newOperationId_() {
  return 'OPX-' + Utilities.getUuid();
}

/**
 * Пытается "застолбить" operationId за текущим вызовом.
 * Возвращает { cached: null } — можно (пере)выполнять обработчик;
 * либо { cached: <готовый envelope> } — обработчик уже УСПЕШНО довёл операцию до конца
 * с этим operationId раньше — повторно НЕ запускается, отдаём тот же результат
 * (это и есть защита от дублирования, ТЗ §7).
 * Если операция с этим же operationId ещё выполняется ПРЯМО СЕЙЧАС (параллельный
 * повторный запрос, ещё не успевший завершиться) — бросает DUPLICATE_OPERATION,
 * не давая второй копии стартовать одновременно с первой.
 *
 * Важно про статус FAILED: он НЕ кэшируется как терминальный результат. Если бы прошлая
 * попытка с этим же operationId провалилась (например, ровно из-за LOCK_TIMEOUT — как
 * раз тот случай, ради которого клиент и обязан повторить запрос с ТЕМ ЖЕ operationId),
 * а claimOperation_ тут же отдавал бы закэшированную ошибку навсегда — повтор был бы
 * бессмысленным, операция никогда не смогла бы реально выполниться. Поэтому FAILED
 * трактуется как "ничего не подтверждено выполненным" — операция перезаявляется
 * (статус возвращается в PROCESSING) и обработчик выполняется заново.
 *
 * Вся проверка-и-вставка — под общим локом (withLock_), иначе два параллельных
 * запроса с одним operationId оба могли бы увидеть "ещё не было" и оба выполниться.
 */
function claimOperation_(operationId, action, session, requestHash) {
  return withLock_(function () {
    var candidates = findRows_('OPERATIONS', function(r){ return r.operation_id === operationId; });
    var existing = candidates.filter(function(r){ return r.organization_id === (session ? session.organization_id : ''); })[0];
    if (!existing && candidates.length) throw new Error('IDEMPOTENCY_KEY_REUSED_ACROSS_TENANTS');
    if (existing) {
      if (typeof core100AssertOperationIdentity_ === 'function') core100AssertOperationIdentity_(existing, action, requestHash);
      if (['SUCCESS','COMPLETED','PARTIALLY_COMPLETED'].indexOf(existing.статус) !== -1) {
        var cached;
        try {
          cached = existing.результат_json ? JSON.parse(existing.результат_json) : null;
        } catch (e) {
          cached = null;
        }
        if (!cached) cached = userSuccess_(null);
        return { cached: cached };
      }
      if (existing.статус === 'FAILED') {
        // Прошлая попытка не завершилась успехом — ничего дублировать, безопасно
        // выполнить обработчик заново с тем же operation_id.
        updateRow_('OPERATIONS', existing, { статус: 'PROCESSING', обновлено: nowIso_(), начато: nowIso_(), error_code: '' });
        return { cached: null };
      }
      // PENDING/PROCESSING — эта же операция уже выполняется (не завершилась) —
      // не запускаем обработчик второй раз параллельно с первым.
      throw new Error('DUPLICATE_OPERATION: Операция с этим operationId уже выполняется. Дождитесь результата исходного запроса, не отправляйте повторно.');
    }
    insertRow_('OPERATIONS', {
      operation_id: operationId,
      action: action,
      user_id: session ? session.user_id : '',
      organization_id: session ? session.organization_id : '',
      cascade_id: '',
      статус: 'PROCESSING',
      результат_json: '',
      request_hash: requestHash || '',
      event_id: '',
      error_code: '',
      создано: nowIso_(),
      обновлено: nowIso_(),
      начато: nowIso_(),
      завершено: ''
    });
    return { cached: null };
  });
}

/** Фиксирует итог операции (успех/ошибка) и сохраняет готовый ответ для будущих повторов с тем же operationId. */
function completeOperation_(operationId, status, envelope) {
  var row = findOne_('OPERATIONS', 'operation_id', operationId);
  if (!row) return; // GET-операции (только чтение) claimOperation_ не вызывают — завершать нечего
  if (typeof core100OperationTransition_ === 'function' && !core100OperationTransition_(row.статус, status)) throw new Error('INVALID_OPERATION_TRANSITION:'+row.статус+'->'+status);
  updateRow_('OPERATIONS', row, {
    статус: status,
    результат_json: JSON.stringify(envelope),
    cascade_id: envelope && envelope.cascade_id ? envelope.cascade_id : '',
    event_id: envelope && envelope.event_id ? envelope.event_id : '',
    error_code: envelope && envelope.error_code ? envelope.error_code : '',
    обновлено: nowIso_(),
    завершено: nowIso_()
  });
}
