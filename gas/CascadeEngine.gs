// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — CascadeEngine.gs (P0.2, ТЗ §4-6)
 * "Одна бизнес-операция = один cascade_id, у операции есть статус жизненного цикла."
 *
 * v2 (до этого раунда) уже писал необязательный cascade_id НА записях AUDIT_LOG
 * (Audit.gs::newCascadeId_/auditLog_) — это было меткой на чужих строках, а не самой
 * операцией как сущностью. P0.2 добавляет саму сущность (таблица CASCADES) со статусом:
 *   PENDING → PROCESSING → SUCCESS | FAILED | RECOVERY_REQUIRED
 * processOperation() (API.gs) вызывает createCascade_() РОВНО ОДИН РАЗ в начале каждого
 * мутирующего действия, кладёт cascade_id в session.cascade_id — дальше он доступен
 * везде, куда уже прокидывается session (после P0.1 это почти все мутирующие функции),
 * и не требует менять сигнатуру каждой функции ещё раз. auditLog_ вызовы внутри
 * обработчика, которые получают session, могут передать session.cascade_id последним
 * параметром — тогда "что именно изменилось из-за этой операции" ищется одним фильтром
 * getAuditByCascade_(cascadeId), без сборки цепочки по времени вручную.
 *
 * ЧЕСТНО (см. финальный отчёт P0.2) — что этот файл РЕАЛЬНО делает, а что нет:
 * - РЕАЛЬНО: у каждой мутирующей операции есть cascade_id, статус, время начала/
 *   завершения, и (через AUDIT_LOG.cascade_id) список того, что она затронула.
 * - РЕАЛЬНО: при ошибке cascade помечается FAILED с текстом ошибки — видно, что
 *   что-то не завершилось, и что именно.
 * - НЕ РЕАЛИЗОВАНО: настоящий compensating rollback (отмена уже записанных строк).
 *   Google Sheets/Apps Script не дают реальных транзакций (ТЗ §6 сам это
 *   констатирует) — если обработчик упал ПОСЛЕ части записей (например, склад уже
 *   списан, а WRITE_OFFS ещё не вставлен), эти частичные записи НЕ откатываются
 *   автоматически. cascadeFail_ помечает cascade как FAILED, но не более того.
 *   cascadeMarkForRecovery_ существует, чтобы явно посадить операцию в
 *   RECOVERY_REQUIRED, когда КОНКРЕТНЫЙ обработчик знает, что он оставил частичные
 *   данные — но ни один обработчик пока не вызывает его (это осталось бы честной
 *   работой на P0.3+: разметить в каждом модуле те несколько точек, где частичная
 *   запись реально возможна).
 */

/**
 * Один раз в начале мутирующей операции (см. API.gs::processOperation). session может
 * быть null (например, LOGIN) — тогда org/location/user пишутся пустыми, это нормально.
 */
function createCascade_(session, action, operationId) {
  var cascadeId = newCascadeId_(); // сам генератор уже существовал в Audit.gs (v2)
  insertRow_('CASCADES', {
    cascade_id: cascadeId,
    operation_id: operationId || '',
    action: action || '',
    organization_id: session ? (session.organization_id || '') : '',
    location_id: session ? (session.location_id || '') : '',
    user_id: session ? (session.user_id || '') : '',
    статус: 'PROCESSING',
    шагов: 0,
    ошибка: '',
    начато: nowIso_(),
    event_id: '',
    failure_class: '',
    recovery_id: '',
    начато: nowIso_(),
    завершено: '',
    обновлено: nowIso_()
  });
  return cascadeId;
}

/**
 * Отмечает ещё один шаг каскада — сам детальный след "что именно" уже есть в
 * AUDIT_LOG (фильтр по cascade_id, см. getAuditByCascade_ в Audit.gs); здесь только
 * счётчик, чтобы быстро видеть "сколько всего действий вызвала эта операция" без
 * отдельного запроса к аудиту.
 */
function cascadeStep_(cascadeId, stepName) {
  if (!cascadeId) return;
  var row = findOne_('CASCADES', 'cascade_id', cascadeId);
  if (!row) return;
  updateRow_('CASCADES', row, { шагов: (Number(row.шагов) || 0) + 1, обновлено: nowIso_() });
}

function cascadeSuccess_(cascadeId) {
  finishCascade_(cascadeId, 'SUCCESS', '');
}

/**
 * P0.6 (ТЗ §6, статус PARTIAL из явного списка "PENDING/PROCESSING/SUCCESS/PARTIAL/
 * FAILED/RECOVERY_REQUIRED") — НАЙДЕНО: несколько обработчиков (receiveGoodsBatch_,
 * importProductsCommit_, importSalesCommit_ — ВСЕ трое по конструкции "одна плохая
 * строка не портит уже принятые", см. их докстринги) МОГУТ завершиться без
 * исключения, даже если часть строк реально не прошла — processOperation() при этом
 * раньше безусловно звал cascadeSuccess_, то есть технический SUCCESS не отличался от
 * "приняли 0 из 50 строк накладной, у всех ошибка". Это ровно то, против чего
 * предостерегает п.1 ТЗ P0.6 ("не заявлять... если частично изменились") — только в
 * обратную сторону: не отчёт об успехе выглядит как провал, а провал (по существу)
 * молча выглядит как чистый успех. Единообразный признак — все трое возвращают
 * результат с массивом result.ошибки (см. processOperation ниже); если он непуст,
 * cascade помечается PARTIAL вместо SUCCESS. Ответ клиенту (envelope.ok) НЕ меняется —
 * "частичный успех" для этих действий и ЕСТЬ штатный успешный ответ по архитектуре
 * (ошибки уже перечислены в самом result.ошибки) — PARTIAL здесь только для
 * cascade-трассировки/аудита, не влияет на то, что видит вызывающий немедленно.
 */
function cascadePartial_(cascadeId) {
  finishCascade_(cascadeId, 'PARTIAL', '');
}

function cascadeFail_(cascadeId, errorMessage) {
  finishCascade_(cascadeId, 'FAILED', String(errorMessage || ''));
}

/**
 * Явная посадка операции в "требует ручного разбора" — для случаев, когда обработчик
 * ЗНАЕТ, что часть записей уже сделана, а продолжить/откатить автоматически нельзя.
 * Не вызывается автоматически нигде в этом раунде (см. предупреждение выше файла) —
 * инфраструктура готова, конкретные точки вызова — задача следующего этапа.
 */
function cascadeMarkForRecovery_(cascadeId, note) {
  finishCascade_(cascadeId, 'RECOVERY_REQUIRED', String(note || ''));
}

function finishCascade_(cascadeId, status, errorMessage) {
  if (!cascadeId) return;
  var row = findOne_('CASCADES', 'cascade_id', cascadeId);
  if (!row) return;
  var terminal=['SUCCESS','PARTIAL','FAILED','RECOVERY_REQUIRED','RECOVERED'];
  if (terminal.indexOf(row.статус)!==-1 && row.статус!==status) throw new Error('INVALID_CASCADE_TRANSITION:'+row.статус+'->'+status);
  updateRow_('CASCADES', row, { статус: status, ошибка: errorMessage || '', завершено: nowIso_(), обновлено: nowIso_() });
}

function getCascade_(cascadeId) {
  var row = findOne_('CASCADES', 'cascade_id', cascadeId);
  if (!row) return null;
  return { cascade: row, шаги: getAuditByCascade_(cascadeId) };
}

/**
 * P0.6 (ТЗ §6, "атомарность/recovery") — эвристика "эта операция уже что-то реально
 * записала до того, как упала". Google Sheets не даёт настоящих транзакций (см.
 * докстринг файла выше) — узнать со стопроцентной точностью, остались ли частичные
 * данные, можно только просканировав ВСЕ таблицы, куда P0.5 проставил cascade_id
 * (BATCHES/PRODUCTION/PURCHASE_REQUESTS/INVENTORIES/INVENTORY_LINES/JOURNALS/
 * CALCULATIONS/NOTIFICATIONS/WAREHOUSE_OPS/WRITE_OFFS/AUDIT_LOG) — а это тяжёлая
 * операция на каждый упавший вызов. Вместо этого проверяются ДВЕ таблицы, которые
 * по факту прикрывают именно те сценарии, что ТЗ P0.6 явно называет "особенно
 * проверить": RECEIVE_GOODS_BATCH/ADVANCE_PRODUCTION/CREATE_WRITEOFF/TRANSFER_STOCK
 * всегда пишут в WAREHOUSE_OPS ПЕРВЫМ шагом складского движения (через _recordOp_,
 * Warehouse.gs) — раньше, чем что-либо в этих функциях могло бы упасть; почти все
 * остальные мутирующие обработчики (createPurchaseRequest_/startInventory_/
 * importProductsCommit_/importSalesCommit_/createRule_/... ) вызывают auditLog_ с тем
 * же cascade_id на раннем шаге. ЧЕСТНО: это не гарантия для абсолютно каждого
 * обработчика — есть отдельные узкие окна (например, между двумя соседними
 * updateRow_ без промежуточного auditLog_/_recordOp_), которые эта эвристика не
 * поймает и они останутся размечены как обычный FAILED, а не RECOVERY_REQUIRED; там,
 * где такие окна были НАЙДЕНЫ этим раундом (createTechCard_/createRule_/
 * approvePpkVersion_/closeInventory_), они устранены не эвристикой, а безопасной
 * перестановкой порядка записи (см. соответствующие докстринги в FoodCost.gs/
 * Rules.gs/Ppk.gs/Inventory.gs) — так, чтобы сбой посередине не оставлял дыру
 * покрытия вообще, без необходимости что-то детектировать постфактум.
 *
 * НАЙДЕНО И ИСПРАВЛЕНО ПРИ НАПИСАНИИ ТЕСТОВ ЭТОГО ЖЕ РАУНДА: AUDIT_LOG пишется не
 * только при успешной мутации — _denyScope_ (Auth.gs, ТЗ P0.1) намеренно логирует
 * КАЖДУЮ попытку подмены чужого ID (результат 'forbidden_scope'), передавая тот же
 * session.cascade_id, чтобы попытку было видно тем же фильтром — это осталось от
 * дизайна P0.2 и само по себе правильно для безопасности, но первая версия этой
 * функции считала наличие ЛЮБОЙ строки AUDIT_LOG (в т.ч. эту) доказательством
 * "что-то реально записалось", из-за чего обычный отказ FORBIDDEN_SCOPE (где НИЧЕГО
 * не мутировало, только сам факт отказа залогирован) ошибочно помечался
 * RECOVERY_REQUIRED вместо FAILED. Тот же риск — для строк с результатом 'forbidden'
 * (API.gs::processOperation, отказ по модулю прав) и login-провалов ('forbidden' в
 * Auth.gs). Поэтому здесь считаются только строки с результатом 'success' —
 * действительно подтверждающие, что запись данных произошла, а не просто попытка.
 */
function _cascadeHasPartialWrites_(cascadeId) {
  if (!cascadeId) return false;
  var auditRows = getAuditByCascade_(cascadeId).filter(function (r) { return r.результат === 'success'; });
  if (auditRows.length > 0) return true;
  var stockOps = findRows_('WAREHOUSE_OPS', function (r) { return r.cascade_id === cascadeId; });
  return stockOps.length > 0;
}

/**
 * P0.6 (ТЗ §6, "3. Иметь механизм восстановления") — раньше CASCADES/getCascade_
 * существовали, но не были подключены НИ К ОДНОМУ действию в API.gs вообще (та же
 * категория пробела, что уже находилась у createTechCard_ в P0.4 — функция построена,
 * но физически недостижима с фронтенда/через API). "Механизм восстановления" здесь —
 * честно, по масштабу этого раунда (см. докстринг файла) — это ВОЗМОЖНОСТЬ УВИДЕТЬ,
 * какие операции требуют ручного разбора, а не автоматическая компенсирующая отмена
 * (которая всё ещё НЕ реализована). ДИРЕКТОР/ADMIN получают список таких cascade —
 * дальше решение и правка данных остаются на человеке, как и для любой другой находки
 * в Sheets без настоящих транзакций.
 */
/**
 * P0.6, ТЗ P0.1 — обёртка над getCascade_ для прямого вызова из API.gs (GET_CASCADE):
 * даже при том, что cascade_id — непубличный UUID (Utilities.getUuid()) и подобрать
 * чужой практически невозможно, "сложно угадать" не заменяет проверку принадлежности
 * (та же дисциплина, что применяется везде в проекте к batch_id/production_id/etc,
 * тоже сгенерированным непоследовательным ID) — CASCADES несёт organization_id с
 * самого P0.2, поэтому проверяется прямо здесь. Объект без organization_id (не
 * должно случаться для мутирующих действий, но assertOwnedByOrg_ пропускает такие
 * записи, как и везде в проекте) не блокируется.
 */
function getCascadeForSession_(cascadeId, session) {
  var result = getCascade_(cascadeId);
  if (!result) return null;
  assertOwnedByOrg_(session, result.cascade, 'CASCADES:' + cascadeId);
  return result;
}

function getCascadesByStatus_(organizationId, status) {
  var rows = findRows_('CASCADES', function (r) {
    return (!organizationId || r.organization_id === organizationId) && (!status || r.статус === status);
  });
  rows.sort(function (a, b) { return new Date(b.начато) - new Date(a.начато); });
  return rows;
}
