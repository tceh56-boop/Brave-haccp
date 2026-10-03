// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Production.gs
 * Канбан-доска производства (паттерн Mon Cher C1): план → в_работе → готово.
 * Завершение задачи на "готово" списывает ингредиенты по рецепту (Warehouse.gs FIFO)
 * и, если это полуфабрикат, приходует его как новую партию — тем самым ПФ реально
 * появляется на складе и его можно списывать/использовать так же, как обычный продукт.
 */

var PRODUCTION_STATUSES = ['план', 'в_работе', 'готово', 'отменено'];

/**
 * P0.4 — ИСПРАВЛЕНА НАЙДЕННАЯ ПРИ АУДИТЕ ОШИБКА ДВОЙНОГО СПИСАНИЯ: раньше
 * PRODUCTION_STATUSES.indexOf(newStatus) !== -1 разрешал ЛЮБОЙ переход между статусами
 * без проверки, "куда именно ОТКУДА" — включая регресс 'готово' → 'план'. Условие
 * списания сырья в _completeProduction_ было "newStatus==='готово' && oldStatus!=='готово'"
 * — то есть достаточно было один раз отвести задачу НАЗАД в 'план' (ничего при этом не
 * возвращая на склад), а потом снова перевести в 'готово' — списание и приход партии ПФ
 * срабатывали ПОВТОРНО, второй раз списывая уже списанное сырьё и создавая вторую
 * партию ПФ из воздуха. Теперь — явный список разрешённых переходов: 'готово' и
 * 'отменено' — терминальные состояния, из них нельзя перейти НИКУДА (в том числе одно
 * в другое). 'отменено' — новое, чтобы ошибочно созданную задачу можно было закрыть БЕЗ
 * необходимости доводить её до 'готово' (которое запускает реальное списание).
 */
var PRODUCTION_TRANSITIONS = {
  'план': ['в_работе', 'готово', 'отменено'],
  'в_работе': ['готово', 'отменено'],
  'готово': [],
  'отменено': []
};

function createProductionTask_(locationId, parentType, parentId, qty, userId, workshopId, session) {
  return withLock_(function () { // P0.2 (ТЗ §18) — производственная мутация
    // ТЗ P0.1 — parentId (блюдо/ПФ) приходит от клиента: без этой проверки задачу
    // производства можно было создать на рецепт чужой организации.
    if (session) {
      var parent = parentType === 'PF' ? getSemiFinishedById_(parentId) : findOne_('DISHES', 'dish_id', parentId);
      assertOwnedByOrg_(session, parent, parentType + ':' + parentId);
      if (typeof checkTtkProductionGate_ === 'function') {
        var ttkGate = checkTtkProductionGate_(parentType, parentId, session);
        if (!ttkGate.allowed) throw new Error('Производство заблокировано: ' + ttkGate.reason);
      }
    }
    var task = {
      production_id: generateId_('PRODUCTION'),
      location_id: locationId,
      workshop_id: workshopId || '',
      parent_type: parentType,
      parent_id: parentId,
      количество: Number(qty),
      batch_id: '',
      статус: 'план',
      user_id: userId || '',
      дата: nowIso_(),
      // Раунд 12 (P0.5, §46) — до этого раунда орфанная запись, хотя session доступен здесь.
      cascade_id: session ? (session.cascade_id || '') : ''
    };
    insertRow_('PRODUCTION', task);
    // Секондарные фичи, раунд 2 (Архитектура v4 §2, Events.gs) — PRODUCTION_CREATED.
    _emitEventSafe_({ organizationId: session ? session.organization_id : (parent ? parent.organization_id : ''), locationId: locationId, type: 'PRODUCTION_CREATED', source: 'backend', entityType: 'PRODUCTION', entityId: task.production_id, operationId: session && session.operation_id ? session.operation_id : '', payload: { parentType: parentType, parentId: parentId, qty: Number(qty) } });
    return task;
  });
}

function getProductionTasks_(locationId, status) {
  return findRows_('PRODUCTION', function (r) {
    return (!locationId || r.location_id === locationId) && (!status || r.статус === status);
  });
}

function advanceProductionStatus_(productionId, newStatus, session) {
  if (PRODUCTION_STATUSES.indexOf(newStatus) === -1) throw new Error('Недопустимый статус: ' + newStatus);
  var userId = session.user_id;
  return withLock_(function () {
    var task = findOne_('PRODUCTION', 'production_id', productionId);
    assertOwnedByLocation_(session, task, 'PRODUCTION:' + productionId); // ТЗ P0.1
    var oldStatus = task.статус;
    if (typeof assertNoBlockingIncidentForProduction_ === 'function') assertNoBlockingIncidentForProduction_(productionId, session);

    // P0.4 — явная проверка перехода (см. PRODUCTION_TRANSITIONS выше): защита от
    // повторного списания через регресс статуса и от бессмысленных переходов из
    // терминальных состояний.
    if (oldStatus === newStatus) {
      // Повторный вызов с тем же статусом — не ошибка (идемпотентно), но и списание
      // повторно не запускаем.
      auditLog_(userId, 'Смена статуса производства (без изменений)', 'PRODUCTION:' + productionId, oldStatus, newStatus, 'success', session.cascade_id);
      return { production_id: productionId, статус: newStatus };
    }
    var allowed = PRODUCTION_TRANSITIONS[oldStatus] || [];
    if (allowed.indexOf(newStatus) === -1) {
      throw new Error('Недопустимый переход статуса производства: "' + oldStatus + '" → "' + newStatus + '".');
    }

    if (newStatus === 'готово') {
      var result = _completeProduction_(task, userId, session);
      updateRow_('PRODUCTION', task, { статус: newStatus, batch_id: result.batch_id || '' });
    } else {
      updateRow_('PRODUCTION', task, { статус: newStatus });
    }

    auditLog_(userId, 'Смена статуса производства', 'PRODUCTION:' + productionId, oldStatus, newStatus, 'success', session.cascade_id);
    if (newStatus === 'готово' && typeof autoHaccpEvidenceForProduction_ === 'function') { try { autoHaccpEvidenceForProduction_(findOne_('PRODUCTION','production_id',productionId), session); } catch(e) {} }
    return { production_id: productionId, статус: newStatus };
  });
}

/**
 * Списывает ингредиенты по рецепту родителя (масштабируя на qty/выход) и приходует ПФ
 * на склад.
 *
 * P0.4 — ИСПРАВЛЕНА НАЙДЕННАЯ ПРИ АУДИТЕ ОШИБКА ЧАСТИЧНОГО СПИСАНИЯ: рецепт может
 * содержать НЕСКОЛЬКО ингредиентов; раньше функция проверяла остаток и сразу же
 * списывала каждую строку ПО ОЧЕРЕДИ в одном проходе — если ингредиента №3 из 5 не
 * хватало, ингредиенты №1 и №2 к этому моменту уже были СПИСАНЫ со склада, а вся
 * операция всё равно завершалась ошибкой (и статус задачи не менялся) — склад
 * оставался в частично изменённом состоянии, никак не отражённом в самой задаче
 * производства. Google Sheets не даёт настоящих транзакций (ТЗ §6) — правильный ответ
 * здесь не откат постфактум, а ПРОВЕРКА ДО ЛЮБОЙ ЗАПИСИ: два прохода — сначала
 * проверяем ВСЕ строки рецепта (ничего не списывая), и только если хватает всего и
 * сразу — списываем по-настоящему вторым проходом. Проверка использует
 * getUsableStockLevel_ (P0.4, Warehouse.gs) — то же самое "годное количество без
 * просрочки", что реально применит consumeStock_, а не общий остаток (который включал
 * бы просрочку и создавал бы ложное "хватает").
 */
function _completeProduction_(task, userId, session) {
  if (typeof getCriticalIncidents_ === 'function') {
    var blockers = getCriticalIncidents_(session, {entityType:'PRODUCTION', entityId:task.production_id}).filter(function(r){ return ['ОТКРЫТ','НА_РАССМОТРЕНИИ'].indexOf(r.status)!==-1 && ['КРИТИЧЕСКОЕ','БЛОКИРОВКА'].indexOf(r.severity)!==-1; });
    if (blockers.length) throw new Error('Производство заблокировано критической ситуацией: ' + blockers[0].название);
  }
  var lines = getRecipeLines_(task.parent_type, task.parent_id);
  var scale = Number(task.количество); // рецепт задан на 1 выход/1 порцию — масштабируем на количество задачи
  var ttk = typeof _productionWasteTtk_ === 'function' ? _productionWasteTtk_(task, session) : null;

  var needed = lines.map(function (line) {
    var grossPerUnit = Number(line.брутто) || 0;
    var netPerUnit = typeof _recipeNetPerUnit_ === 'function' ? _recipeNetPerUnit_(line) : (Number(line.нетто) || grossPerUnit);
    if (typeof _assertGrossNet_ === 'function') {
      var ingredient = String(line.product_id).indexOf('PF-') === 0 ? getSemiFinishedById_(line.product_id) : getProductById_(line.product_id);
      _assertGrossNet_(grossPerUnit, netPerUnit, ingredient ? ingredient.название : line.product_id);
    }
    return { line: line, qty: normalizeQty_(grossPerUnit, line.единица) * scale, gross: grossPerUnit * scale, net: netPerUnit * scale };
  }).filter(function (n) { return n.qty > 0; });

  // Проход 1 — только проверка, ничего не меняет на складе.
  needed.forEach(function (n) {
    var available = getUsableStockLevel_(n.line.product_id, task.location_id);
    if (available + 0.0001 < n.qty) {
      var product = getProductById_(n.line.product_id);
      throw new Error('Недостаточно ингредиента "' + (product ? product.название : n.line.product_id) + '" для производства (нужно ' + round2_(n.qty) + ', годного остатка ' + round2_(available) + '). Ничего не списано.');
    }
  });

  // Проход 2 — все строки прошли проверку, теперь реально списываем.
  var usageResults = [];
  needed.forEach(function (n) {
    var consumption = consumeStock_(n.line.product_id, task.location_id, n.qty, OP_TYPES.PRODUCTION, userId, session);
    if (typeof _recordProductionIngredientUsage_ === 'function') {
      usageResults.push(_recordProductionIngredientUsage_(task, n.line, consumption, n.gross, n.net, session, ttk));
    }
  });

  var batchId = '';
  var требуетПодтверждения = false;
  // Любой выпуск продукции получает собственную партию и маркировку:
  // полуфабрикат — из карточки ПФ, блюдо — из утверждённой ТТК.
  var parentObj = task.parent_type === 'PF' ? getSemiFinishedById_(task.parent_id) : findOne_('DISHES', 'dish_id', task.parent_id);
  var unitCost = parentObj ? Number(parentObj.себестоимость) || 0 : 0;
  var shelfLife = { срок_годности: '', требует_подтверждения: true, сообщение: 'Срок реализации/хранения не настроен.' };
  var storage = parentObj && parentObj.условия_хранения ? parentObj.условия_хранения : '';
  var ttkVersionId = '';
  if (task.parent_type === 'PF') {
    shelfLife = _resolveShelfLife_(parentObj);
  } else {
    var ttk = typeof getCurrentTtk_ === 'function' ? getCurrentTtk_(task.parent_id, session) : null;
    ttkVersionId = ttk ? ttk.ttk_version_id : '';
    if (ttk) {
      storage = ttk.условия_хранения || '';
      var parsed = _parseShelfLifeTextHours_(ttk.срок_реализации);
      if (parsed) {
        shelfLife = { срок_годности: new Date(Date.now() + parsed * 3600000).toISOString(), требует_подтверждения: false, сообщение: '' };
      } else {
        shelfLife = { срок_годности: '', требует_подтверждения: true, сообщение: 'Срок реализации ТТК не удалось однозначно преобразовать в дату. Требуется подтверждение ответственного лица.' };
      }
    }
  }
  var newBatchId = generateId_('BATCHES');
  var batch = {
    batch_id: newBatchId,
    product_id: task.parent_id,
    location_id: task.location_id,
    workshop_id: task.workshop_id || (parentObj ? parentObj.workshop_id : '') || '',
    количество: scale,
    цена_прихода: unitCost,
    дата_прихода: nowIso_(),
    дата_производства: nowIso_(),
    срок_годности: shelfLife.срок_годности,
    статус: 'активна',
    партия_номер: generateBatchNumber_(newBatchId),
    ответственный_id: userId || '',
    cascade_id: session ? (session.cascade_id || '') : '',
    source_batch_id: '',
    marking_type: task.parent_type === 'PF' ? 'SEMI_FINISHED' : 'DISH'
  };
  insertRow_('BATCHES', batch);
  batchId = batch.batch_id;
  требуетПодтверждения = shelfLife.требует_подтверждения;
  if (typeof createBatchMarking_ === 'function') {
    createBatchMarking_({ batchId: batchId, markingType: task.parent_type === 'PF' ? 'SEMI_FINISHED' : 'DISH', ttkVersionId: ttkVersionId, productionId: task.production_id, storage: storage, shelfLifeConfirmed: !требуетПодтверждения }, session);
  }
  if (требуетПодтверждения) {
    notify_(parentObj ? parentObj.organization_id : session.organization_id, task.location_id, CONFIG.NOTIFICATION_TYPES.EXPIRING_BATCH,
      'Партия "' + (parentObj ? parentObj.название : task.parent_id) + '" (№' + batch.партия_номер + ') выпущена БЕЗ автоматически рассчитанного срока годности. ' + shelfLife.сообщение,
      'shelf_life_missing|' + batchId, session ? session.cascade_id : '');
  }
  return { batch_id: batchId, требует_подтверждения_срока: требуетПодтверждения, ingredient_usage: usageResults, waste: usageResults.map(function(x){return x.waste;}).filter(Boolean) };
}
