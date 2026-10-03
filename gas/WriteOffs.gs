// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — WriteOffs.gs
 * Сквозной сценарий ТЗ §5 ("повар списал 2 кг курицы") — одна кнопка запускает
 * ВСЮ цепочку. Это и есть демонстрация главного принципа ТЗ: "одно заполнение →
 * вся система автоматически пересчиталась". Каждый шаг цепочки помечен ниже
 * номером пункта из ТЗ §5, чтобы было видно прямое соответствие спецификации.
 */

function createWriteOff_(params) {
  // params: { productId, locationId, qty, reasonId, userId, session }
  return withLock_(function () {
    var product = getProductById_(params.productId);
    if (!product) throw new Error('Продукт не найден: ' + params.productId);
    if (params.session) assertOwnedByOrg_(params.session, product, 'PRODUCTS:' + params.productId); // ТЗ P0.1
    if (Number(params.qty) <= 0) throw new Error('Количество списания должно быть больше нуля.');

    // 1-2. Создать операцию списания + уменьшить складской остаток (FIFO, Warehouse.gs)
    var consumption = consumeStock_(params.productId, params.locationId, Number(params.qty), OP_TYPES.WRITEOFF, params.userId, params.session);

    // 3-4. Стоимость списания уже посчитана по факту партий (не по текущей цене!) — Warehouse.gs
    var writeoff = {
      writeoff_id: generateId_('WRITE_OFFS'),
      location_id: params.locationId,
      product_id: params.productId,
      количество: Number(params.qty),
      reason_id: params.reasonId || '',
      сумма: consumption.сумма,
      user_id: params.userId || '',
      дата: nowIso_(),
      // Раунд 12 (P0.5, §46) — НАЙДЕНО: схема WRITE_OFFS уже имела колонки cascade_id/
      // api_operation_id (тем же способом, что и WAREHOUSE_OPS), но эта запись их ни разу
      // не заполняла, хотя params.session доступен прямо здесь — orphan-запись без всякой
      // причины, не архитектурное ограничение.
      cascade_id: params.session ? (params.session.cascade_id || '') : '',
      api_operation_id: params.session ? (params.session.operation_id || '') : ''
    };
    insertRow_('WRITE_OFFS', writeoff);

    // 5-6. Обновить экономику и Food Cost. Списание не меняет цену продукта, но меняет
    // агрегаты (сумму списаний за период) — пересчитываем сводную экономику точки.
    // P0.7 — organization_id теперь обязателен (см. Economics.gs::recalcEconomics_).
    var economics = recalcEconomics_(product.organization_id, params.locationId, params.session ? params.session.cascade_id : '');

    // 7. Показатели директора обновлены через recalcEconomics_ (Dashboard читает CALCULATIONS)

    // 8. Запись в журнал списаний (если причина связана с браком/санитарией)
    var reason = findOne_('WRITEOFF_REASONS', 'reason_id', params.reasonId);
    if (reason && /брак|санитар|просроч/i.test(reason.название || '')) {
      addJournalEntry_(params.locationId, 'Списания', reason.название + ': ' + product.название + ' ' + params.qty + ' ' + product.единица, params.userId, product.organization_id, '', '', params.session ? params.session.cascade_id : '');
    }

    // 9. AUDIT_LOG
    auditLog_(params.userId, 'Списание', 'WRITE_OFFS:' + writeoff.writeoff_id,
      null, params.qty + ' ' + product.единица + ' ' + product.название, 'success', params.session ? params.session.cascade_id : '');
    // Секондарные фичи, раунд 2 (Архитектура v4 §2, Events.gs) — WRITE_OFF_CREATED.
    _emitEventSafe_({ organizationId: product.organization_id, locationId: params.locationId, type: 'WRITE_OFF_CREATED', source: 'backend', entityType: 'WRITE_OFFS', entityId: writeoff.writeoff_id, operationId: params.session && params.session.operation_id ? params.session.operation_id : '', payload: { productId: params.productId, qty: Number(params.qty), reasonId: params.reasonId || '' } });

    // 10. Акт списания — печатная форма формируется на фронтенде из этих же данных (window.print),
    // здесь достаточно того, что writeoff_id уже есть и на него можно сослаться.

    // 11-12. Проверка минимального остатка → предупреждение
    var belowMin = checkMinStockAndNotify_(product, params.locationId, params.session ? params.session.cascade_id : '');

    // 13. Если остаток ниже нормы — рекомендация на закупку (авто-заявка с дедупом)
    var purchaseSuggestion = null;
    if (belowMin) {
      purchaseSuggestion = suggestPurchase_(params.productId, params.locationId, params.userId, params.session);
    }

    // 14-16. Dashboard/шеф/бухгалтер читают актуальные данные напрямую из CALCULATIONS/WAREHOUSE_OPS —
    // отдельного "толкания" данных не нужно, они уже обновлены выше.

    return {
      writeoff_id: writeoff.writeoff_id,
      сумма: consumption.сумма,
      остаток_после: consumption.остаток_после,
      экономика: economics,
      предупреждение_остаток: belowMin,
      заявка_на_закупку: purchaseSuggestion
    };
  });
}

function getWriteOffs_(locationId, sinceDate) {
  return findRows_('WRITE_OFFS', function (r) {
    return (!locationId || r.location_id === locationId) && (!sinceDate || new Date(r.дата) >= new Date(sinceDate));
  });
}

function createWriteoffReason_(name) {
  var reason = { reason_id: generateId_('WRITEOFF_REASONS'), название: name };
  insertRow_('WRITEOFF_REASONS', reason);
  return reason;
}
