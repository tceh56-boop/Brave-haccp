// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Purchasing.gs
 * Заявки поставщику (ТЗ §10). Ключевое требование ТЗ: "не создавать повторную заявку,
 * если аналогичная уже существует" — реализовано через дедуп-ключ location_id+product_id,
 * проверяемый среди заявок в статусе, отличном от "закрыта"/"отменена".
 */

var OPEN_REQUEST_STATUSES = ['новая', 'в обработке', 'отправлена'];

function _dedupKey_(locationId, productId) {
  return locationId + '_' + productId;
}

function findOpenPurchaseRequest_(locationId, productId) {
  var key = _dedupKey_(locationId, productId);
  return findRows_('PURCHASE_REQUESTS', function (r) {
    return r.дедуп_ключ === key && OPEN_REQUEST_STATUSES.indexOf(r.статус) !== -1;
  })[0] || null;
}

/**
 * Создаёт заявку, либо возвращает уже существующую открытую заявку на этот же продукт/точку
 * (не плодит дубликаты — прямое требование ТЗ §10 и §5 п.13).
 */
function createPurchaseRequest_(locationId, productId, qty, userId, session) {
  return withLock_(function () {
    var existing = findOpenPurchaseRequest_(locationId, productId);
    if (existing) {
      return { request_id: existing.request_id, создана: false, причина: 'Уже есть открытая заявка на этот продукт.' };
    }
    var product = getProductById_(productId);
    if (!product) throw new Error('Продукт не найден: ' + productId);
    if (session) assertOwnedByOrg_(session, product, 'PRODUCTS:' + productId); // ТЗ P0.1

    var req = {
      request_id: generateId_('PURCHASE_REQUESTS'),
      location_id: locationId,
      product_id: productId,
      количество: Number(qty),
      supplier_id: product.поставщик_id || '',
      статус: 'новая',
      user_id: userId || '',
      дата: nowIso_(),
      дедуп_ключ: _dedupKey_(locationId, productId),
      // Раунд 12 (P0.5, §46) — до этого раунда орфанная запись, хотя session бывает
      // доступен (когда вызывается синхронно из CREATE_WRITEOFF, см. suggestPurchase_ ниже).
      cascade_id: session ? (session.cascade_id || '') : ''
    };
    insertRow_('PURCHASE_REQUESTS', req);
    // Раунд 12 (P0.5, §46) — НАЙДЕНО: этот auditLog_ единственный во всём проекте
    // среди вызовов с доступным session, который НИ РАЗУ не передавал 7-й параметр
    // (cascadeId) — не архитектурное ограничение, просто не был передан.
    auditLog_(userId, 'Заявка на закупку', 'PURCHASE_REQUESTS:' + req.request_id, null, qty + ' ' + product.единица, 'success', session ? session.cascade_id : '');
    return { request_id: req.request_id, создана: true };
  });
}

/**
 * Авто-рекомендация количества: до минимального остатка + средний расход за 7 дней
 * (упрощённо: до мин.остатка x2).
 * Раунд 12 (P0.5, §46) — НАЙДЕНО, НЕЗАВИСИМО ОТ cascade_id: эта функция никогда не
 * принимала session и поэтому НИКОГДА не пробрасывала его в createPurchaseRequest_ —
 * даже на пути CREATE_WRITEOFF → suggestPurchase_, где реальный session существует у
 * вызывающего (WriteOffs.gs). Из-за этого createPurchaseRequest_'s P0.1-проверка
 * `if (session) assertOwnedByOrg_(...)` молча пропускалась на ЭТОМ конкретном пути —
 * не эксплуатируемо сегодня (productId сюда попадает уже из проверенного списания той
 * же организации, не от клиента напрямую), но хрупко: при любом будущем повторном
 * использовании этой функции с клиентским productId проверка снова пропускалась бы
 * молча. Добавлен параметр session, реально прокидывается из WriteOffs.gs.
 */
function suggestPurchase_(productId, locationId, userId, session) {
  var product = getProductById_(productId);
  if (!product) return null;
  var currentStock = getStockLevel_(productId, locationId);
  var targetQty = Math.max(Number(product.мин_остаток) * 2 - currentStock, Number(product.мин_остаток));
  if (targetQty <= 0) return null;
  return createPurchaseRequest_(locationId, productId, round2_(targetQty), userId, session);
}

function getPurchaseRequests_(locationId) {
  return findRows_('PURCHASE_REQUESTS', function (r) { return !locationId || r.location_id === locationId; });
}

function updatePurchaseRequestStatus_(requestId, status, session) {
  return withLock_(function () { // P0.2 (ТЗ §18) — документ-мутация
    var req = findOne_('PURCHASE_REQUESTS', 'request_id', requestId);
    assertOwnedByLocation_(session, req, 'PURCHASE_REQUESTS:' + requestId); // ТЗ P0.1
    updateRow_('PURCHASE_REQUESTS', req, { статус: status });
    auditLog_(session.user_id, 'Статус заявки изменён', 'PURCHASE_REQUESTS:' + requestId, req.статус, status, 'success', session.cascade_id);
    return true;
  });
}
