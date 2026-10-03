// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Inventory.gs
 * Инвентаризация по участкам, несколько поваров одновременно (ТЗ §6/§31).
 * Каждый повар пишет только строки своего участка (INVENTORY_LINES) — они все
 * ссылаются на один inventory_id, поэтому "объединение" не требует отдельного шага:
 * closeInventory_ просто читает все накопленные строки этой инвентаризации.
 * Пользователь вводит ТОЛЬКО факт_количество — всё остальное считает система.
 */

/**
 * Раунд 12 (P0.5, §46) — НАЙДЕНО: startInventory_ не получал session вообще (только
 * locationId/userId, уже взятые из session.* вызывающим API.gs-обработчиком) — не дыра
 * в доступе (locationId тут всегда СВОЙ, не клиентский параметр), но из-за этого не было
 * возможности проставить cascade_id и собственный auditLog_-вызов ни разу не передавал
 * его (7-й параметр отсутствовал целиком, а не был пустой строкой по инерции). Добавлен
 * необязательный session — обратная совместимость сохранена (session отсутствует → как
 * раньше, пустой cascade_id).
 */
function startInventory_(locationId, userId, session) {
  var inv = {
    inventory_id: generateId_('INVENTORIES'),
    location_id: locationId,
    статус: 'по_участкам',
    создано: nowIso_(),
    закрыто: '',
    cascade_id: session ? (session.cascade_id || '') : ''
  };
  insertRow_('INVENTORIES', inv);
  auditLog_(userId, 'Начата инвентаризация', 'INVENTORIES:' + inv.inventory_id, null, null, 'success', session ? session.cascade_id : '');
  return inv;
}

/**
 * Повар вводит только фактическое количество — системный остаток и отклонение считаются здесь.
 * P0.2 (ТЗ §18) — обёрнуто в withLock_: несколько поваров одновременно (сам сценарий,
 * ради которого писался этот файл, см. докстринг наверху) читают systemQty и пишут
 * строку — без общего лока два одновременных submit по одному и тому же продукту могли
 * бы прочитать один и тот же "остаток на момент чтения" до того, как первый допишет
 * свою строку, что не искажает сам факт (каждая строка — это независимое наблюдение),
 * но искажает systemQty/отклонение, если между чтением и записью успела пройти ЕЩЁ
 * одна операция склада (приход/списание) от третьего процесса — лочим для консистентности.
 */
function submitInventoryLine_(inventoryId, productId, participok, factQty, userId, session) {
  return withLock_(function () {
    var inv = findOne_('INVENTORIES', 'inventory_id', inventoryId);
    assertOwnedByLocation_(session, inv, 'INVENTORIES:' + inventoryId); // ТЗ P0.1
    var product = getProductById_(productId);
    if (session) assertOwnedByOrg_(session, product, 'PRODUCTS:' + productId); // ТЗ P0.1

    var systemQty = getStockLevel_(productId, inv.location_id);
    var price = product ? Number(product.текущая_цена) || 0 : 0;
    var deviation = Number(factQty) - systemQty;

    var line = {
      line_id: generateId_('INVENTORY_LINES'),
      inventory_id: inventoryId,
      product_id: productId,
      участок: participok || '',
      user_id: userId || '',
      факт_количество: Number(factQty),
      системный_остаток: round2_(systemQty),
      отклонение: round2_(deviation),
      сумма_отклонения: round2_(deviation * price),
      // Раунд 12 (P0.5, §46) — "факт" (корень всей цепочки инвентаризации) до этого
      // раунда был орфанной записью, хотя session доступен прямо здесь.
      cascade_id: session ? (session.cascade_id || '') : ''
    };
    insertRow_('INVENTORY_LINES', line);
    return line;
  });
}

/** Сводный акт по всем участкам этой инвентаризации — то, что получает шеф. */
function getInventorySummary_(inventoryId, session) {
  if (session) assertOwnedByLocation_(session, findOne_('INVENTORIES', 'inventory_id', inventoryId), 'INVENTORIES:' + inventoryId); // ТЗ P0.1
  var lines = findRows_('INVENTORY_LINES', function (r) { return r.inventory_id === inventoryId; });
  var недостачи = lines.filter(function (l) { return l.отклонение < 0; });
  var излишки = lines.filter(function (l) { return l.отклонение > 0; });
  return {
    строки: lines,
    участков: lines.reduce(function (set, l) { set[l.участок] = true; return set; }, {}),
    сумма_недостачи: round2_(недостачи.reduce(function (s, l) { return s + Math.abs(l.сумма_отклонения); }, 0)),
    сумма_излишков: round2_(излишки.reduce(function (s, l) { return s + l.сумма_отклонения; }, 0)),
    процент_отклонения_позиций: lines.length ? round2_((недостачи.length + излишки.length) / lines.length * 100) : 0
  };
}

/**
 * Закрывает инвентаризацию. НЕ создаёт автоматически корректирующие списания —
 * финансовые корректировки требуют подтверждения человека (ТЗ §22: "AI/система не
 * должны менять критические финансовые данные без подтверждения пользователя").
 * Готовый акт передаётся отдельным вызовом createAdjustmentFromInventoryLine_.
 */
function closeInventory_(inventoryId, session) {
  return withLock_(function () { // P0.2 (ТЗ §18) — защита от двойного закрытия одной и той же инвентаризации
    var inv = findOne_('INVENTORIES', 'inventory_id', inventoryId);
    assertOwnedByLocation_(session, inv, 'INVENTORIES:' + inventoryId); // ТЗ P0.1
    var userId = session.user_id;
    // P0.6 (ТЗ §6, атомарность/восстановление) — ПОРЯДОК ЗАПИСЕЙ НАРОЧНО ПЕРЕСТАВЛЕН:
    // раньше инвентаризация сначала помечалась 'закрыта', и только потом писалась
    // запись в журнал — сбой ПОСЛЕ пометки, но ДО addJournalEntry_ (например, из-за
    // временной ошибки Sheets API, нет настоящих транзакций, ТЗ §6) оставлял бы
    // инвентаризацию в "закрыта" без соответствующей журнальной записи, а повторный
    // вызов closeInventory_ уже не сработал бы штатно (не было явной защиты от
    // повторного закрытия, но и штатного пути "дозакрыть" тоже не было). Теперь акт
    // (summary) считается и запись в журнал пишется ПЕРВОЙ — при сбое здесь
    // инвентаризация остаётся в статусе 'по_участкам' (как будто закрытие не
    // начиналось) и closeInventory_ можно безопасно вызвать повторно.
    var summary = getInventorySummary_(inventoryId);
    addJournalEntry_(inv.location_id, 'Инвентаризация', 'Закрыта инвентаризация ' + inventoryId + ': недостача ' + summary.сумма_недостачи + ' ₽, излишки ' + summary.сумма_излишков + ' ₽', userId, '', '', '', session ? session.cascade_id : '');
    updateRow_('INVENTORIES', inv, { статус: 'закрыта', закрыто: nowIso_() });
    auditLog_(userId, 'Закрыта инвентаризация', 'INVENTORIES:' + inventoryId, null, JSON.stringify(summary), 'success', session ? session.cascade_id : '');
    return summary;
  });
}

/**
 * Явное, отдельно подтверждаемое действие — превращает отклонение конкретной строки в
 * реальное списание/приход. P0.2 (ТЗ §18): обёрнуто в withLock_, хотя внутри и
 * createWriteOff_, и receiveGoods_ УЖЕ сами берут лок — это безопасно только благодаря
 * реентерабельности withLock_ (Database.gs, P0.2), иначе внутренний releaseLock()
 * снял бы общую защиту раньше завершения этой функции.
 */
function createAdjustmentFromInventoryLine_(lineId, session) {
  return withLock_(function () {
    var line = findOne_('INVENTORY_LINES', 'line_id', lineId);
    if (!line) throw new Error('Строка инвентаризации не найдена: ' + lineId);
    var inv = findOne_('INVENTORIES', 'inventory_id', line.inventory_id);
    assertOwnedByLocation_(session, inv, 'INVENTORIES:' + line.inventory_id); // ТЗ P0.1 (строка наследует точку инвентаризации)
    var userId = session.user_id;

    if (line.отклонение < 0) {
      return createWriteOff_({
        productId: line.product_id, locationId: inv.location_id,
        qty: Math.abs(line.отклонение), reasonId: '', userId: userId, session: session
      });
    } else if (line.отклонение > 0) {
      var product = getProductById_(line.product_id);
      return receiveGoods_(line.product_id, inv.location_id, line.отклонение, product ? product.текущая_цена : 0, '', userId, session);
    }
    return { изменений: 'нет' };
  });
}
