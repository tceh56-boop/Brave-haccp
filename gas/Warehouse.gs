// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Warehouse.gs
 * Склад как журнал движения (ТЗ §9): остаток НЕ вводится вручную, а вычисляется
 * из WAREHOUSE_OPS + партий FIFO/FEFO (паттерн Mon Cher, модуль E3).
 *
 * Формула ТЗ §9:
 *   ОСТАТОК = НАЧ.ОСТАТОК + ПРИХОД + ПРОИЗВОДСТВО + ВОЗВРАТЫ − РАСХОД − СПИСАНИЯ − ПЕРЕМЕЩЕНИЯ
 * Здесь она реализована через партии: остаток = сумма непотраченных остатков BATCHES.
 */

var OP_TYPES = {
  RECEIPT: 'приход', PRODUCTION: 'производство', RETURN: 'возврат',
  ISSUE: 'расход', WRITEOFF: 'списание', TRANSFER: 'перемещение',
  // P0.3, новое — сторона ПРИБЫТИЯ перемещения (transferStock_ ниже). Отдельно от
  // RECEIPT, чтобы не путать с настоящей закупкой в отчётах, и НЕ входит в
  // CONSUMING_OPS — иначе она вычиталась бы из остатка ТОЙ ЖЕ партии, которую сама же
  // создаёт (та же логика, что и у обычного прихода: создание партии само по себе не
  // расход).
  TRANSFER_IN: 'перемещение_приход',
  INVENTORY: 'инвентаризация', ADJUSTMENT: 'корректировка'
};
// P0.8 — НАЙДЕНО ПРИ ИНТЕГРАЦИОННОМ ТЕСТЕ: OP_TYPES.PRODUCTION отсутствовал в этом
// списке. consumeStock_ (вызывается _completeProduction_ из Production.gs при
// переводе задачи в "готово") ЧЕСТНО писал операцию в WAREHOUSE_OPS с типом
// 'производство' — но getBatchRemaining_ ниже считает потраченное количество партии
// ИМЕННО фильтром по CONSUMING_OPS, и производство в этот фильтр не входило. Партия
// физически никогда не уменьшалась: остаток сырья после завершения производства
// оставался прежним, сколько бы порций ни готовили — "фантомный" неисчерпаемый
// склад для производства конкретно (расход/списание/перемещение считались верно).
// Ни один тест до P0.8 не проверял РЕАЛЬНОЕ изменение остатка после ADVANCE_PRODUCTION
// до "готово" (только успешность самого перехода и корректность блокировки при
// нехватке — а "нехватка" тоже никогда не наступала бы повторно, т.к. остаток не
// расходовался) — поэтому баг не проявлялся ни в одном прежнем прогоне.
var CONSUMING_OPS = [OP_TYPES.ISSUE, OP_TYPES.WRITEOFF, OP_TYPES.TRANSFER, OP_TYPES.PRODUCTION];

/**
 * P0.3 (ТЗ §8) — каждая складская проводка теперь несёт organization_id/location_id/
 * product_id/batch_id/количество/цена/сумма/user_id/дата (уже было) ПЛЮС cascade_id и
 * api_operation_id (session необязателен — есть внутренние вызовы без него, тогда оба
 * поля просто пустые, как и раньше).
 */
function _recordOp_(organizationId, locationId, productId, opType, qty, price, batchId, userId, session) {
  var op = {
    operation_id: generateId_('WAREHOUSE_OPS'),
    organization_id: organizationId || '',
    location_id: locationId,
    product_id: productId,
    тип_операции: opType,
    количество: qty,
    цена: price,
    сумма: round2_(qty * price),
    batch_id: batchId || '',
    user_id: userId || '',
    дата: nowIso_(),
    cascade_id: session ? (session.cascade_id || '') : '',
    api_operation_id: session ? (session.operation_id || '') : ''
  };
  insertRow_('WAREHOUSE_OPS', op);
  // Секондарные фичи, раунд 2 (Архитектура v4 §2, Events.gs) — STOCK_CHANGED.
  // _recordOp_ — единая точка ЛЮБОГО движения склада (приход/производство/расход/
  // списание/перемещение/инвентаризация/корректировка, см. OP_TYPES выше) — тот же
  // принцип единого шлюза, что уже применён к processOperation()/consumeStock_.
  // Более специфичные типы события (RECEIPT_CREATED/WRITE_OFF_CREATED/...) публикуются
  // ОТДЕЛЬНО, из вызывающих функций — оба события полезны разным подписчикам.
  _emitEventSafe_({ organizationId: organizationId, locationId: locationId, type: 'STOCK_CHANGED', source: 'backend', entityType: 'WAREHOUSE_OPS', entityId: op.operation_id, operationId: session && session.operation_id ? session.operation_id : '', payload: { productId: productId, opType: opType, qty: qty, batchId: batchId || '' } });
  return op;
}

/**
 * P0.5 (ТЗ §11/§30) — средневзвешенная себестоимость. Этот раунд закрывает место,
 * отмеченное ещё в receiveGoods_ ниже как "простая политика; средневзвешенная —
 * расширение того же места" — согласовано с Денисом до начала раунда.
 *
 * "Скользящая" средневзвешенная (moving average), а не периодическая: в системе нет
 * понятия "закрытие периода" (ТЗ §11 — всё производное, ничего не копится вручную), так
 * что пересчёт на КАЖДОМ приходе — единственный способ, согласующийся с остальной
 * архитектурой ("одно заполнение → автоматический пересчёт").
 *   новая_средняя = (остаток_ДО × старая_средняя + приход_кол-во × цена_прихода) / (остаток_ДО + приход_кол-во)
 * Остаток берётся ПО ВСЕЙ ОРГАНИЗАЦИИ (все точки), а не только точки этого прихода —
 * PRODUCTS.текущая_цена одна на продукт для ВСЕЙ организации (рецепты/ТТК не привязаны
 * к точке, см. Recipes.gs::getIngredientUnitPrice_), поэтому средняя обязана отражать
 * весь остаток продукта в организации, а не долю на одной точке — иначе один и тот же
 * продукт получал бы разную "текущую цену" в зависимости от того, с какой точки пришла
 * последняя накладная.
 *
 * ВАЖНО: это НЕ трогает BATCHES.цена_прихода — там остаётся РЕАЛЬНАЯ цена конкретной
 * партии (нужна для точного списания/себестоимости проданного через consumeStock_'s
 * распределение по партиям, ТЗ §8). Средневзвешенная в PRODUCTS.текущая_цена — это
 * ПЛАНОВАЯ/расчётная цена для рецептов и Food Cost, отдельная задача от фактического
 * учёта прихода по партиям — обе цифры нужны одновременно, это не дублирование.
 */
function _weightedAvgPriceAfterReceipt_(product, addQty, addPrice) {
  var locs = uniqueLocationsForProduct_(product.product_id);
  var existingQty = locs.reduce(function (s, loc) { return s + getStockLevel_(product.product_id, loc); }, 0);
  var existingAvg = Number(product.текущая_цена) || 0;
  var totalQty = existingQty + addQty;
  if (totalQty <= 0) return addPrice; // защита от деления на 0 — практически недостижимо, т.к. addQty > 0 всегда проверяется до вызова
  return round2_((existingQty * existingAvg + addQty * addPrice) / totalQty);
}

/**
 * Приход товара — создаёт партию FIFO и обновляет текущую (средневзвешенную, см. P0.5
 * выше) цену продукта (ТЗ §30).
 * session необязателен только для внутренних вызовов, где productId уже проверен на уровне
 * вызывающей функции (например, createAdjustmentFromInventoryLine_ — строка инвентаризации
 * уже привязана к проверенной точке); для прямого вызова из API.gs session ОБЯЗАТЕЛЕН —
 * без него нельзя было (ТЗ P0.1) исключить приход товара чужой организации на свою точку.
 */
/**
 * Раунд 8 (ТЗ §14/§15) — docRefs {declarationId, certificateId, veterinaryDocumentId}
 * необязателен (обратная совместимость — существующие вызовы без него продолжают
 * работать). Если передан, ссылки сохраняются В ПАРТИЮ (BATCHES.declaration_id и т.д.,
 * ТЗ §14 "какими документами подтверждается конкретная партия"). Перед приходом
 * выполняется checkReceiptCompliance_ (ТЗ §15) — при режиме BLOCKING и статусе RED
 * приход НЕ проводится (бросает ошибку ДО insertRow_, ничего не записывается); при
 * WARNING — приход проходит, а результат проверки возвращается вызывающему для показа
 * предупреждения (ТЗ §19 "предупредить... режим настраиваемый").
 */
function receiveGoods_(productId, locationId, qty, price, expiryDate, userId, session, docRefs, productionDate) {
  return withLock_(function () {
    var product = getProductById_(productId);
    if (!product) throw new Error('Продукт не найден: ' + productId);
    if (session) assertOwnedByOrg_(session, product, 'PRODUCTS:' + productId); // ТЗ P0.1
    if (Number(qty) <= 0) throw new Error('Количество прихода должно быть больше нуля.');

    var compliance = null;
    if (session) {
      compliance = checkReceiptCompliance_(product.organization_id, productId, docRefs && docRefs.supplierId, session);
      if (compliance.заблокировано) {
        throw new Error('Приход заблокирован проверкой соответствия (режим BLOCKING): ' + compliance.причины.join(' '));
      }
    }

    // P0.5 — считаем СРЕДНЕВЗВЕШЕННУЮ цену ДО того, как новая партия появится в BATCHES:
    // getStockLevel_ (через uniqueLocationsForProduct_) обязан увидеть остаток ТАКИМ, КАК
    // ОН БЫЛ до этого прихода — иначе новая партия попала бы в подсчёт остатка дважды
    // (один раз как "остаток_ДО", второй раз как сам приход).
    var newAvgPrice = _weightedAvgPriceAfterReceipt_(product, Number(qty), Number(price));

    var batch = {
      batch_id: generateId_('BATCHES'),
      product_id: productId,
      location_id: locationId,
      количество: Number(qty),
      цена_прихода: Number(price),
      дата_прихода: nowIso_(),
      // Дата производства относится к физической партии, а не к карточке продукта.
      // Храним отдельно от даты прихода: товар мог быть произведён раньше и принят сегодня.
      дата_производства: productionDate || '',
      срок_годности: expiryDate || '',
      статус: 'активна',
      declaration_id: (docRefs && docRefs.declarationId) || '',
      certificate_id: (docRefs && docRefs.certificateId) || '',
      veterinary_document_id: (docRefs && docRefs.veterinaryDocumentId) || '',
      // Раунд 12 (P0.5, §46) — партия до этого раунда была орфанной записью, хотя
      // session доступен прямо здесь (когда он есть — см. докстринг выше про
      // необязательность session для внутренних вызовов вроде createAdjustmentFromInventoryLine_).
      cascade_id: session ? (session.cascade_id || '') : '',
      source_batch_id: '',
      marking_type: 'PRODUCT_BATCH'
    };
    insertRow_('BATCHES', batch);
    _recordOp_(product.organization_id, locationId, productId, OP_TYPES.RECEIPT, Number(qty), Number(price), batch.batch_id, userId, session);
    if (session && typeof createBatchMarking_ === 'function') createBatchMarking_({batchId: batch.batch_id, markingType: 'PRODUCT_BATCH', source: 'RECEIPT'}, session);

    var previousPrice = Number(product.текущая_цена || 0);
    updateRow_('PRODUCTS', product, { текущая_цена: newAvgPrice, обновлено: nowIso_() });
    recordPriceHistory_({organization_id: product.organization_id, product_id: productId, price_type:'WEIGHTED_AVG', old_price:previousPrice, new_price:newAvgPrice, source:'RECEIPT', batch_id:batch.batch_id, supplier_id:product.поставщик_id, user_id:userId, cascade_id:session ? session.cascade_id : '', reason:'Пересчёт средневзвешенной цены после прихода'});
    var cascade = recalcFoodCostForProduct_(productId);

    auditLog_(userId, 'Приход товара', 'PRODUCTS:' + productId, null, qty + ' x ' + price, 'success', session ? session.cascade_id : '');
    // Секондарные фичи, раунд 2 (Архитектура v4 §2, Events.gs) — RECEIPT_CREATED.
    _emitEventSafe_({ organizationId: product.organization_id, locationId: locationId, type: 'RECEIPT_CREATED', source: 'backend', entityType: 'BATCHES', entityId: batch.batch_id, payload: { productId: productId, qty: Number(qty), price: Number(price) } });
    var breakdown = null;
    if (session && typeof generateBreakdownFromReceipt_ === 'function') {
      try { breakdown = generateBreakdownFromReceipt_(batch.batch_id, session); }
      catch (breakdownErr) { auditLog_(userId, 'Не удалось автоматически создать задачи разбора сырья', 'BATCHES:' + batch.batch_id, '', String(breakdownErr.message || breakdownErr), 'warning', session.cascade_id || ''); breakdown = { error: String(breakdownErr.message || breakdownErr) }; }
    }
    return { batch_id: batch.batch_id, остаток: getStockLevel_(productId, locationId), пересчитано: cascade, соответствие: compliance, breakdown: breakdown };
  });
}

/**
 * Приход целой накладной за один вызов — построчный проход по receiveGoods_ (та же
 * логика, тот же аудит на каждую строку, тот же каскад Food Cost). Нужен для
 * сканера/вставки накладной (demo.html): вместо N кликов «Оприходовать» — один вызов
 * на весь список строк. Одна ошибочная строка не должна портить уже принятые —
 * поэтому каждая строка оборачивается отдельно, а ошибки собираются, не прерывая цикл.
 */
function receiveGoodsBatch_(lines, locationId, userId, session) {
  var results = [];
  var errors = [];
  (lines || []).forEach(function (line, i) {
    try {
      var r = receiveGoods_(line.productId, locationId, line.qty, line.price, line.expiryDate, userId, session, line.docRefs, line.productionDate);
      results.push({ line: i, productId: line.productId, ok: true, результат: r });
    } catch (e) {
      errors.push({ line: i, productId: line.productId, ok: false, ошибка: e.message });
    }
  });
  return { принято: results.length, ошибок: errors.length, результаты: results, ошибки: errors };
}

/** Списанный/потреблённый остаток по конкретной партии — считается из WAREHOUSE_OPS, не хранится отдельно. */
function getBatchRemaining_(batch) {
  var consumed = findRows_('WAREHOUSE_OPS', function (op) {
    return op.batch_id === batch.batch_id && CONSUMING_OPS.indexOf(op.тип_операции) !== -1;
  }).reduce(function (sum, op) { return sum + Number(op.количество); }, 0);
  return Number(batch.количество) - consumed;
}

/**
 * P0.3 — ИСПРАВЛЕНА НАЙДЕННАЯ ПРИ АУДИТЕ НЕТРАНЗИТИВНОСТЬ СОРТИРОВКИ (была отмечена в
 * отчёте P0.1 как "эвристика", теперь разобрана и исправлена по существу). Старый
 * компаратор сравнивал КАЖДУЮ ПАРУ партий отдельно: если у ОБЕИХ задан срок годности —
 * по сроку, иначе — по дате прихода. Для трёх и более партий с РАЗНЫМ набором того, есть
 * ли у них срок годности, такое правило не гарантирует транзитивность (A перед B, B перед
 * C не обязательно значит A перед C) — а JS Array.sort() не даёт корректного результата
 * для нетранзитивного компаратора (поведение специфично для движка). Новый порядок —
 * честный единый total order в два уровня, транзитивный по построению:
 *   1) партии С заданным сроком годности — раньше партий БЕЗ него (у партии без
 *      подтверждённого срока годности нет объективной причины считать её "более
 *      срочной", чем у партии, чей срок уже известен и приближается — FEFO именно про
 *      это: расходовать в первую очередь то, что реально портится к известной дате);
 *   2) внутри каждой из этих двух групп — обычный FIFO по дате прихода (для группы со
 *      сроком годности это доп. критерий при СОВПАДАЮЩЕМ сроке, не единственный).
 * Меняет порядок ТОЛЬКО в смешанном случае (часть партий со сроком, часть без) — раньше
 * там порядок мог получиться непредсказуемым; теперь он детерминирован.
 */
function getActiveBatchesFifo_(productId, locationId) {
  return findRows_('BATCHES', function (b) {
    return b.product_id === productId && b.location_id === locationId && b.статус === 'активна';
  })
    .map(function (b) { return { batch: b, remaining: getBatchRemaining_(b) }; })
    .filter(function (b) { return b.remaining > 0.0001; })
    .sort(function (a, b) {
      var aHas = !!a.batch.срок_годности, bHas = !!b.batch.срок_годности;
      if (aHas !== bHas) return aHas ? -1 : 1; // партии со сроком годности — раньше партий без него
      if (aHas) { // обе со сроком — FEFO, при равенстве сроков — по дате прихода
        var byExpiry = new Date(a.batch.срок_годности) - new Date(b.batch.срок_годности);
        if (byExpiry !== 0) return byExpiry;
      }
      var byReceipt = new Date(a.batch.дата_прихода) - new Date(b.batch.дата_прихода);
      if (byReceipt !== 0) return byReceipt;
      // Дата производства НЕ заменяет FIFO по дате прихода: она физический атрибут партии.
      // Используем её только как стабильный tie-breaker при одинаковой дате прихода.
      if (a.batch.дата_производства && b.batch.дата_производства) {
        var byProduction = new Date(a.batch.дата_производства) - new Date(b.batch.дата_производства);
        if (byProduction !== 0) return byProduction;
      } else if (a.batch.дата_производства !== b.batch.дата_производства) {
        return a.batch.дата_производства ? -1 : 1;
      }
      return String(a.batch.batch_id).localeCompare(String(b.batch.batch_id));
    });
}

/** ТЗ P0.3 §10 — партия считается просроченной, если срок годности задан и уже прошёл. Без заданного срока — не просрочена (система не придумывает срок, которого никто не подтвердил). */
function _isBatchExpired_(batch) {
  if (!batch || !batch.срок_годности) return false;
  var t = new Date(batch.срок_годности).getTime();
  return !isNaN(t) && t < Date.now();
}

function getStockLevel_(productId, locationId) {
  return getActiveBatchesFifo_(productId, locationId).reduce(function (sum, b) { return sum + b.remaining; }, 0);
}

/**
 * P0.4 — остаток, который РЕАЛЬНО можно израсходовать в производстве/расходе/
 * перемещении (просроченные партии исключены — та же логика, что применяет
 * consumeStock_ для этих типов операций, см. P0.3). getStockLevel_ выше по-прежнему
 * показывает ПОЛНЫЙ физический остаток (включая просрочку — она физически есть на
 * складе, пока её не списали) — используется для отображения; эта функция — для
 * ПРОВЕРКИ хватит ли реально годного количества ПЕРЕД тем, как что-то производить.
 */
function getUsableStockLevel_(productId, locationId) {
  return getActiveBatchesFifo_(productId, locationId)
    .filter(function (b) { return !_isBatchExpired_(b.batch); })
    .reduce(function (sum, b) { return sum + b.remaining; }, 0);
}

/**
 * ТЗ §33/§21 — проверка партий с истекающим сроком. Только УВЕДОМЛЯЕТ, никогда не
 * списывает и не продлевает срок сама (это решение человека). Партии без срока годности
 * (срок_годности пусто) намеренно пропускаются — система не придумывает срок, которого
 * никто не подтвердил (см. SemiFinished.gs::_resolveShelfLife_).
 */
function checkExpiringBatches_(hoursThreshold) {
  var threshold = hoursThreshold || 24;
  var now = Date.now();
  var batches = findRows_('BATCHES', function (b) { return b.статус === 'активна' && b.срок_годности; });
  batches.forEach(function (b) {
    if (getBatchRemaining_(b) <= 0.0001) return;
    var expiresAt = new Date(b.срок_годности).getTime();
    if (isNaN(expiresAt)) return;
    var hoursLeft = (expiresAt - now) / 3600000;
    if (hoursLeft > threshold) return;
    var product = getProductById_(b.product_id) || getSemiFinishedById_(b.product_id);
    var name = product ? (product.название || b.product_id) : b.product_id;
    var loc = findOne_('LOCATIONS', 'location_id', b.location_id);
    var msg = hoursLeft < 0
      ? 'Партия "' + name + '" (№' + (b.партия_номер || b.batch_id) + ') просрочена.'
      : 'Партия "' + name + '" (№' + (b.партия_номер || b.batch_id) + ') истекает через ' + Math.max(0, Math.round(hoursLeft)) + ' ч.';
    notify_(loc ? loc.organization_id : '', b.location_id, CONFIG.NOTIFICATION_TYPES.EXPIRING_BATCH, msg, 'expiring_batch|' + b.batch_id);
    // Секондарные фичи, раунд 2 (Архитектура v4 §2, Events.gs) — EXPIRY_WARNING.
    // idempotencyKey с датой (не только batch_id) — этот триггер запускается ежедневно
    // (Main.gs::expiryCheckTrigger_), одна и та же ещё не списанная партия иначе
    // публиковала бы НОВОЕ событие КАЖДЫЙ день до самого списания; один раз в день —
    // достаточно и не спамит будущего подписчика тем же фактом.
    _emitEventSafe_({ organizationId: loc ? loc.organization_id : '', locationId: b.location_id, type: 'EXPIRY_WARNING', source: 'backend', entityType: 'BATCHES', entityId: b.batch_id, payload: { productId: b.product_id, hoursLeft: Math.round(hoursLeft) }, idempotencyKey: 'expiry|' + b.batch_id + '|' + todayDateStr_() });
  });
}

/**
 * Списывает qty со склада по FIFO/FEFO, распределяя по партиям. Возвращает суммарную
 * стоимость списанного (по ценам ФАКТИЧЕСКИХ партий, не по текущей цене продукта —
 * это и есть корректная себестоимость списания при колеблющихся закупочных ценах).
 * Используется списаниями, производством и перемещениями — единая точка расхода склада.
 *
 * P0.3 (ТЗ §10 — "блокировать использование просроченных партий"): раньше эта функция
 * молча включала ПРОСРОЧЕННЫЕ партии в обычный FIFO/FEFO подбор — производство блюда
 * могло списать сырьё с уже истёкшим сроком годности, и никто бы не узнал. Теперь:
 *   - для OP_TYPES.WRITEOFF (списание) — просроченные партии РАЗРЕШЕНЫ (это и есть
 *     правильный способ списать испорченное/просроченное — не блокировать сам акт
 *     списания, а FEFO-порядок и так уже ставит их первыми в очередь);
 *   - для любого другого типа (производство, расход, перемещение) — просроченные партии
 *     ИСКЛЮЧАЮТСЯ из подбора; если без них остатка не хватает, но formально "физически"
 *     на складе количество есть — ошибка так и говорит: часть остатка просрочена и
 *     заблокирована, сначала спишите её отдельно, а не тихая нехватка "как будто товара
 *     физически нет".
 */
function consumeStock_(productId, locationId, qty, opType, userId, session) {
  var product = getProductById_(productId);
  if (!product) throw new Error('Продукт не найден: ' + productId);
  if (session) assertOwnedByOrg_(session, product, 'PRODUCTS:' + productId); // ТЗ P0.1
  var remainingToConsume = Number(qty);
  if (remainingToConsume <= 0) throw new Error('Количество должно быть больше нуля.');

  var allBatches = getActiveBatchesFifo_(productId, locationId);
  if (session && typeof assertNoBlockingIncidentForBatch_ === 'function') {
    allBatches.forEach(function(x){ assertNoBlockingIncidentForBatch_(x.batch.batch_id, session); });
  }
  var allowExpired = opType === OP_TYPES.WRITEOFF;
  var batches = allowExpired ? allBatches : allBatches.filter(function (b) { return !_isBatchExpired_(b.batch); });

  var available = batches.reduce(function (s, b) { return s + b.remaining; }, 0);
  if (available + 0.0001 < remainingToConsume) {
    var totalIncludingExpired = allBatches.reduce(function (s, b) { return s + b.remaining; }, 0);
    var blockedByExpiry = round2_(totalIncludingExpired - available);
    if (!allowExpired && blockedByExpiry > 0.0001 && totalIncludingExpired + 0.0001 >= remainingToConsume) {
      throw new Error('Недостаточно ГОДНОГО остатка: ' + blockedByExpiry + ' ' + product.единица + ' на складе относится к партиям с истёкшим сроком годности и не может быть использовано в производстве/расходе — сначала спишите просроченное отдельно (списание). Годного остатка: ' + round2_(available) + ' ' + product.единица + ', запрошено ' + qty + '.');
    }
    throw new Error('Недостаточно остатка: доступно ' + round2_(available) + ' ' + product.единица + ', запрошено ' + qty + '.');
  }

  var totalCost = 0;
  var распределение = [];
  for (var i = 0; i < batches.length && remainingToConsume > 0.0001; i++) {
    var take = Math.min(batches[i].remaining, remainingToConsume);
    _recordOp_(product.organization_id, locationId, productId, opType, take, batches[i].batch.цена_прихода, batches[i].batch.batch_id, userId, session);
    totalCost += take * batches[i].batch.цена_прихода;
    распределение.push({ batch_id: batches[i].batch.batch_id, количество: round2_(take), цена: batches[i].batch.цена_прихода });
    remainingToConsume -= take;
  }

  return { сумма: round2_(totalCost), остаток_после: getStockLevel_(productId, locationId), распределение: распределение };
}

/**
 * P0.3 (ТЗ §8 — "перемещение" как один из типов складских операций) — раньше
 * OP_TYPES.TRANSFER существовал в коде как константа, но ни одной функции, которая бы
 * реально перемещала остаток между точками, не было вообще (найдено при аудите).
 *
 * Перемещает qty товара с ТЕКУЩЕЙ точки сессии (fromLocationId = session.location_id,
 * НЕ принимается от клиента — ТЗ P0.1: откуда списывается должно быть тем, где реально
 * находится вызывающий, а не тем, что он укажет) на toLocationId (принимается от
 * клиента, но обязана принадлежать ТОЙ ЖЕ организации — иначе FORBIDDEN_SCOPE).
 *
 * Списание с исходной точки идёт через тот же consumeStock_(..., OP_TYPES.TRANSFER, ...)
 * — то есть просроченные партии ТУДА не попадают (перемещать просрочку в другую точку
 * не решает проблему, только прячет её — если нужно избавиться от просроченного,
 * это списание, а не перемещение). Каждая партия-источник, из которой реально взято
 * количество (consumeStock_ возвращает "распределение" по партиям), порождает НА
 * ЦЕЛЕВОЙ точке СВОЮ новую партию с ТЕМИ ЖЕ ценой прихода и сроком годности, что и
 * партия-источник — физический товар не получает новый срок годности только от того,
 * что физически переехал в другой холодильник.
 */
function transferStock_(productId, fromLocationId, toLocationId, qty, userId, session) {
  return withLock_(function () {
    if (!toLocationId) throw new Error('Укажите точку назначения перемещения.');
    if (toLocationId === fromLocationId) throw new Error('Точка назначения совпадает с текущей точкой — перемещать некуда.');
    var product = getProductById_(productId);
    if (!product) throw new Error('Продукт не найден: ' + productId);
    if (session) assertOwnedByOrg_(session, product, 'PRODUCTS:' + productId); // ТЗ P0.1

    var toLocation = findOne_('LOCATIONS', 'location_id', toLocationId);
    if (session) assertOwnedByOrg_(session, toLocation, 'LOCATIONS:' + toLocationId); // ТЗ P0.1 — точка назначения обязана быть точкой ТОЙ ЖЕ организации

    var consumption = consumeStock_(productId, fromLocationId, Number(qty), OP_TYPES.TRANSFER, userId, session);

    var createdBatches = [];
    consumption.распределение.forEach(function (part) {
      var sourceBatch = findOne_('BATCHES', 'batch_id', part.batch_id);
      var newBatchId = generateId_('BATCHES');
      var newBatch = {
        batch_id: newBatchId,
        product_id: productId,
        location_id: toLocationId,
        workshop_id: '',
        количество: part.количество,
        цена_прихода: part.цена,
        дата_прихода: nowIso_(), // на НОВОЙ точке партия числится с даты фактического перемещения
        дата_производства: sourceBatch ? (sourceBatch.дата_производства || '') : '', // физическая партия сохраняет дату производства
        срок_годности: sourceBatch ? (sourceBatch.срок_годности || '') : '', // срок годности НЕ переустанавливается — это тот же физический товар
        статус: 'активна',
        партия_номер: generateBatchNumber_(newBatchId),
        ответственный_id: userId || '',
        // Раунд 12 (P0.6, §47) — НАЙДЕНО: пропущено в P0.5 (§46), потому что
        // TRANSFER_STOCK не входил в 4 названных документом сценария того раунда —
        // партия на ЦЕЛЕВОЙ точке перемещения была орфанной записью, хотя session
        // доступен прямо здесь (списание на исходной точке через consumeStock_ уже
        // несло cascade_id и до этого раунда).
        cascade_id: session ? (session.cascade_id || '') : ''
      };
      insertRow_('BATCHES', newBatch);
      _recordOp_(product.organization_id, toLocationId, productId, OP_TYPES.TRANSFER_IN, part.количество, part.цена, newBatch.batch_id, userId, session);
      createdBatches.push(newBatch.batch_id);
    });

    auditLog_(userId, 'Перемещение товара', 'PRODUCTS:' + productId,
      fromLocationId + ' → ' + toLocationId, qty + ' ' + product.единица, 'success', session ? session.cascade_id : '');

    return {
      сумма: consumption.сумма,
      остаток_на_исходной: consumption.остаток_после,
      остаток_на_целевой: getStockLevel_(productId, toLocationId),
      новые_партии: createdBatches
    };
  });
}
