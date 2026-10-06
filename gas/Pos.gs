// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Pos.gs
 * Модуль «Касса» (этап M1, см. replica/architecture.md): смены, заказы «с собой», оплата.
 *
 * Поток: открыть смену → заказ → позиции → оплата → по строке заказа создаётся продажа
 * в SALES (источник 'касса') через createSale_ — те же валидация/аудит, что у ручного
 * ввода и синка кассы. Списание сырья по ТТК идёт НЕ в момент оплаты, а фоновой задачей
 * posFulfillPendingSalesTrigger_ (15-минутный диспетчер): оплата у гостя не должна
 * падать из-за отсутствующей ТТК или минуса на складе. Ошибка исполнения → задача шеф-повару.
 *
 * Фискализации нет (решение владельца на этом этапе): чек пробивает текущая ККТ заведения.
 * Суммы всегда считаются здесь, из DISHES.цена_продажи; клиентские суммы игнорируются.
 * Оплаченный заказ не меняется — история не переписывается (как WRITE_OFFS/AUDIT_LOG).
 */

var POS_ORDER_STATUSES_ = ['открыт', 'пречек', 'оплачен', 'отменён', 'возврат'];
var POS_PAYMENT_METHODS_ = ['нал', 'карта', 'прочее'];
var POS_SALE_SOURCE_ = 'касса';
var POS_FULFILL_BATCH_LIMIT_ = 30;

function _posOpenShift_(session) {
  var rows = findRows_('POS_SHIFTS', function (r) {
    return r.organization_id === session.organization_id && r.location_id === session.location_id && r.статус === 'открыта';
  });
  return rows.length ? rows[0] : null;
}

function _posRequireOpenShift_(session) {
  var shift = _posOpenShift_(session);
  if (!shift) throw new Error('Смена не открыта. Откройте смену, чтобы принимать заказы.');
  return shift;
}

function _posShiftDate_(shift) {
  return Utilities.formatDate(new Date(shift.открыта), Session.getScriptTimeZone() || 'Etc/UTC', 'yyyy-MM-dd');
}

/** Заказ этой точки и организации, иначе ошибка (защита от подмены order_id чужим). */
function _posOrder_(orderId, session) {
  var order = findOne_('POS_ORDERS', 'order_id', orderId);
  assertOwnedByOrg_(session, order, 'POS_ORDERS:' + orderId);
  if (order.location_id !== session.location_id) throw new Error('Заказ относится к другой точке.');
  return order;
}

function _posAssertEditable_(order, version) {
  if (order.статус !== 'открыт') throw new Error('Заказ уже ' + order.статус + ' — изменить его нельзя.');
  if (version !== undefined && version !== null && version !== '' && Number(version) !== Number(order.version)) {
    throw new Error('Заказ изменён на другом устройстве. Обновите экран.');
  }
}

function _posActiveLines_(orderId) {
  return findRows_('POS_ORDER_LINES', function (l) { return l.order_id === orderId && l.статус !== 'отменена'; });
}

/** Пересчитывает сумму заказа по активным строкам и поднимает version. */
function _posTouchOrder_(order) {
  var total = 0;
  _posActiveLines_(order.order_id).forEach(function (l) { total += Number(l.сумма) || 0; });
  total = round2_(total);
  var skidka = Number(order.скидка) || 0;
  var patch = { сумма: total, итого: round2_(Math.max(0, total - skidka)), version: (Number(order.version) || 0) + 1, обновлено: nowIso_() };
  updateRow_('POS_ORDERS', order, patch);
  return findOne_('POS_ORDERS', 'order_id', order.order_id);
}

function _posOrderView_(order) {
  return { order: order, lines: _posActiveLines_(order.order_id) };
}

// ---------- Смена ----------

function posOpenShift_(data, session) {
  return withLock_(function () {
    if (_posOpenShift_(session)) throw new Error('Смена на этой точке уже открыта.');
    var cashStart = Number(data.cashStart) || 0;
    if (cashStart < 0) throw new Error('Наличные на начало не могут быть отрицательными.');
    var shift = {
      shift_id: generateId_('POS_SHIFTS'),
      organization_id: session.organization_id,
      location_id: session.location_id,
      кассир_id: session.user_id,
      открыта: nowIso_(),
      нал_начало: round2_(cashStart),
      заказов: 0, итог_нал: 0, итог_карта: 0, итог_прочее: 0, возвратов_сумма: 0,
      статус: 'открыта',
      cascade_id: session.cascade_id || ''
    };
    insertRow_('POS_SHIFTS', shift);
    auditLog_(session.user_id, 'Открыта смена кассы', 'POS_SHIFTS:' + shift.shift_id, null, 'нал ' + shift.нал_начало, 'success', session.cascade_id || '');
    return posGetShift_(session);
  });
}

/** Сводка по смене (X-отчёт): считается из оплат, а не из кэшированных полей. */
function _posShiftTotals_(shift) {
  var totals = { нал: 0, карта: 0, прочее: 0 };
  findRows_('POS_PAYMENTS', function (p) { return p.shift_id === shift.shift_id; }).forEach(function (p) {
    totals[p.способ] = round2_((totals[p.способ] || 0) + (Number(p.сумма) || 0));
  });
  var orders = findRows_('POS_ORDERS', function (o) { return o.shift_id === shift.shift_id; });
  var paid = orders.filter(function (o) { return o.статус === 'оплачен'; });
  var revenue = round2_(totals.нал + totals.карта + totals.прочее);
  return {
    нал: totals.нал, карта: totals.карта, прочее: totals.прочее, выручка: revenue,
    заказов: paid.length,
    открытых_заказов: orders.filter(function (o) { return o.статус === 'открыт' || o.статус === 'пречек'; }).length,
    средний_чек: paid.length ? round2_(revenue / paid.length) : 0,
    нал_ожидается: round2_((Number(shift.нал_начало) || 0) + totals.нал)
  };
}

function posGetShift_(session) {
  var shift = _posOpenShift_(session);
  if (!shift) return { shift: null };
  return { shift: shift, totals: _posShiftTotals_(shift) };
}

function posCloseShift_(data, session) {
  return withLock_(function () {
    var shift = _posRequireOpenShift_(session);
    var t = _posShiftTotals_(shift);
    if (t.открытых_заказов) throw new Error('Есть неоплаченные заказы (' + t.открытых_заказов + '). Оплатите или отмените их перед закрытием смены.');
    if (data.cashFact === undefined || data.cashFact === null || data.cashFact === '' || isNaN(Number(data.cashFact))) {
      throw new Error('Укажите фактическую сумму наличных в кассе.');
    }
    var cashFact = round2_(Number(data.cashFact));
    updateRow_('POS_SHIFTS', shift, {
      закрыта: nowIso_(), нал_конец_факт: cashFact,
      итог_нал: t.нал, итог_карта: t.карта, итог_прочее: t.прочее, заказов: t.заказов,
      статус: 'закрыта'
    });
    var diff = round2_(cashFact - t.нал_ожидается);
    auditLog_(session.user_id, 'Закрыта смена кассы', 'POS_SHIFTS:' + shift.shift_id, 'открыта',
      'выручка ' + t.выручка + ', расхождение нал ' + diff, 'success', session.cascade_id || '');
    return { shift: findOne_('POS_SHIFTS', 'shift_id', shift.shift_id), totals: t, расхождение_нал: diff };
  });
}

// ---------- Меню ----------

function posGetMenu_(session) {
  var cats = {};
  getAllRows_('CATEGORIES').forEach(function (c) { cats[c.category_id] = c.название; });
  var dishes = getDishes_(session.organization_id).filter(function (d) {
    return d.статус !== 'архив' && Number(d.цена_продажи) > 0;
  }).map(function (d) {
    return { dish_id: d.dish_id, название: d.название, цена: round2_(Number(d.цена_продажи)), категория_id: d.категория_id || '', категория: cats[d.категория_id] || 'Без категории' };
  });
  dishes.sort(function (a, b) { return a.категория === b.категория ? String(a.название).localeCompare(String(b.название), 'ru') : String(a.категория).localeCompare(String(b.категория), 'ru'); });
  var categories = [];
  dishes.forEach(function (d) { if (categories.indexOf(d.категория) === -1) categories.push(d.категория); });
  return { categories: categories, dishes: dishes };
}

// ---------- Заказ ----------

function posCreateOrder_(data, session) {
  return withLock_(function () {
    var shift = _posRequireOpenShift_(session);
    var number = findRows_('POS_ORDERS', function (o) { return o.shift_id === shift.shift_id; }).length + 1;
    var order = {
      order_id: generateId_('POS_ORDERS'),
      organization_id: session.organization_id,
      location_id: session.location_id,
      shift_id: shift.shift_id,
      table_id: '',
      официант_id: session.user_id,
      номер: number,
      гостей: Math.max(0, Math.floor(Number(data.guests) || 0)),
      статус: 'открыт',
      сумма: 0, скидка: 0, итого: 0,
      комментарий: String(data.comment || '').slice(0, 300),
      version: 1,
      создано: nowIso_(), обновлено: nowIso_(),
      cascade_id: session.cascade_id || ''
    };
    insertRow_('POS_ORDERS', order);
    return _posOrderView_(order);
  });
}

function posAddLine_(data, session) {
  return withLock_(function () {
    var order = _posOrder_(data.orderId, session);
    _posAssertEditable_(order, data.version);
    var dish = findOne_('DISHES', 'dish_id', data.dishId);
    assertOwnedByOrg_(session, dish, 'DISHES:' + data.dishId);
    if (dish.статус === 'архив') throw new Error('Блюдо в архиве и не продаётся.');
    var price = Number(dish.цена_продажи);
    if (!(price > 0)) throw new Error('У блюда «' + dish.название + '» не указана цена продажи.');
    var qty = Number(data.qty || 1);
    if (!(qty > 0) || qty > 999) throw new Error('Количество должно быть от 1 до 999.');

    // Та же позиция без модификаторов — увеличиваем количество, а не плодим строки.
    var same = _posActiveLines_(order.order_id).filter(function (l) { return l.dish_id === dish.dish_id && !l.модификаторы_json && l.статус === 'новая'; })[0];
    if (same) {
      var newQty = Number(same.qty) + qty;
      updateRow_('POS_ORDER_LINES', same, { qty: newQty, сумма: round2_(newQty * Number(same.цена)) });
    } else {
      insertRow_('POS_ORDER_LINES', {
        line_id: generateId_('POS_ORDER_LINES'),
        order_id: order.order_id,
        organization_id: session.organization_id,
        dish_id: dish.dish_id,
        название_снимок: dish.название,
        qty: qty,
        цена: round2_(price),
        модификаторы_json: '',
        сумма: round2_(price * qty),
        статус: 'новая',
        создано: nowIso_()
      });
    }
    return _posOrderView_(_posTouchOrder_(order));
  });
}

function posUpdateLine_(data, session) {
  return withLock_(function () {
    var line = findOne_('POS_ORDER_LINES', 'line_id', data.lineId);
    assertOwnedByOrg_(session, line, 'POS_ORDER_LINES:' + data.lineId);
    var order = _posOrder_(line.order_id, session);
    _posAssertEditable_(order, data.version);
    if (line.статус === 'отменена') throw new Error('Позиция уже удалена.');
    var qty = Number(data.qty);
    if (qty === 0) {
      if (line.статус !== 'новая') throw new Error('Позиция уже отправлена на кухню — удалить её может менеджер отменой.');
      updateRow_('POS_ORDER_LINES', line, { статус: 'отменена' });
    } else {
      if (!(qty > 0) || qty > 999) throw new Error('Количество должно быть от 1 до 999.');
      updateRow_('POS_ORDER_LINES', line, { qty: qty, сумма: round2_(qty * Number(line.цена)) });
    }
    return _posOrderView_(_posTouchOrder_(order));
  });
}

function posGetOrder_(data, session) {
  return _posOrderView_(_posOrder_(data.orderId, session));
}

function posGetOrders_(data, session) {
  var shift = _posOpenShift_(session);
  var shiftId = data.shiftId || (shift && shift.shift_id) || '';
  if (!shiftId) return [];
  return findRows_('POS_ORDERS', function (o) {
    return o.organization_id === session.organization_id && o.location_id === session.location_id && o.shift_id === shiftId &&
      (!data.status || o.статус === data.status);
  }).sort(function (a, b) { return Number(b.номер) - Number(a.номер); });
}

// ---------- Оплата ----------

/**
 * payments: [{способ:'нал'|'карта'|'прочее', сумма}]. Безналичные части не могут превышать
 * итог; переплата допустима только наличными (сдача). В POS_PAYMENTS пишется зачтённая
 * сумма (наличные за вычетом сдачи), поэтому сумма оплат = итог заказа.
 * Повтор с тем же operationId защищён на уровне processOperation (Idempotency.gs).
 */
function posPay_(data, session) {
  return withLock_(function () {
    var order = _posOrder_(data.orderId, session);
    if (order.статус === 'оплачен') throw new Error('Заказ уже оплачен.');
    _posAssertEditable_(order, data.version);
    var shift = _posRequireOpenShift_(session);
    if (order.shift_id !== shift.shift_id) throw new Error('Заказ из прошлой смены — отмените его и создайте заново.');
    var lines = _posActiveLines_(order.order_id);
    if (!lines.length) throw new Error('В заказе нет позиций.');
    var total = round2_(Number(order.итого) || 0);

    var sums = { нал: 0, карта: 0, прочее: 0 };
    (data.payments || []).forEach(function (p) {
      if (POS_PAYMENT_METHODS_.indexOf(p.способ) === -1) throw new Error('Неизвестный способ оплаты: ' + p.способ);
      var amount = Number(p.сумма);
      if (isNaN(amount) || amount < 0) throw new Error('Некорректная сумма оплаты.');
      sums[p.способ] = round2_(sums[p.способ] + amount);
    });
    var nonCash = round2_(sums.карта + sums.прочее);
    if (nonCash > total) throw new Error('Безналичная оплата больше суммы заказа.');
    var paid = round2_(nonCash + sums.нал);
    if (paid < total) throw new Error('Не хватает ' + round2_(total - paid) + ' ₽ до суммы заказа.');
    var change = round2_(paid - total);
    var cashApplied = round2_(sums.нал - change);

    var now = nowIso_();
    var payRows = [];
    [['нал', cashApplied], ['карта', sums.карта], ['прочее', sums.прочее]].forEach(function (pair) {
      if (pair[1] <= 0) return;
      var row = {
        payment_id: generateId_('POS_PAYMENTS'), order_id: order.order_id,
        organization_id: session.organization_id, location_id: session.location_id, shift_id: shift.shift_id,
        способ: pair[0], сумма: pair[1], operation_id: session.operation_id || data.operationId || '',
        создано: now, user_id: session.user_id
      };
      insertRow_('POS_PAYMENTS', row);
      payRows.push(row);
    });

    // Продажа по каждой позиции. Цена — фактическая цена строки (снимок на момент заказа).
    var saleDate = _posShiftDate_(shift);
    lines.forEach(function (l) {
      var sale = createSale_({
        dishId: l.dish_id, qty: Number(l.qty), цена_продажи: Number(l.цена), дата: saleDate,
        locationId: session.location_id, источник: POS_SALE_SOURCE_, внешний_id: l.line_id
      }, session.user_id, session);
      updateRow_('POS_ORDER_LINES', l, { sale_ids: sale.sale_id });
    });

    updateRow_('POS_ORDERS', order, { статус: 'оплачен', оплачен: now, version: (Number(order.version) || 0) + 1, обновлено: now });
    auditLog_(session.user_id, 'Оплачен заказ кассы', 'POS_ORDERS:' + order.order_id, 'открыт',
      'итого ' + total + (change ? ', сдача ' + change : ''), 'success', session.cascade_id || '');
    return { order: findOne_('POS_ORDERS', 'order_id', order.order_id), payments: payRows, сдача: change };
  });
}

function posCancelOrder_(data, session) {
  return withLock_(function () {
    var order = _posOrder_(data.orderId, session);
    if (order.статус !== 'открыт' && order.статус !== 'пречек') throw new Error('Отменить можно только неоплаченный заказ.');
    var reason = String(data.reason || '').trim();
    var hasLines = _posActiveLines_(order.order_id).length > 0;
    if (hasLines && !reason) throw new Error('Укажите причину отмены.');
    updateRow_('POS_ORDERS', order, { статус: 'отменён', комментарий: reason ? String((order.комментарий ? order.комментарий + ' | ' : '') + 'Отмена: ' + reason).slice(0, 300) : order.комментарий, version: (Number(order.version) || 0) + 1, обновлено: nowIso_() });
    auditLog_(session.user_id, 'Отменён заказ кассы', 'POS_ORDERS:' + order.order_id, order.статус, reason || 'пустой заказ', 'success', session.cascade_id || '');
    return { order: findOne_('POS_ORDERS', 'order_id', order.order_id) };
  });
}

// ---------- Списание по ТТК (фон) ----------

/**
 * Исполняет оплаченные на кассе продажи по ТТК. Вызывается диспетчером tick15m_
 * (служебная сессия по каждой точке — тот же приём, что у eventAutomationStage26Trigger_)
 * и вручную из UI через POS_FULFILL_PENDING. Задача шеф-повару создаётся один раз —
 * на переходе продажи в 'ошибка_исполнения', а не на каждой повторной попытке.
 */
function posFulfillPendingSales_(session, limit) {
  var pending = findRows_('SALES', function (s) {
    return s.organization_id === session.organization_id && s.location_id === session.location_id &&
      s.источник === POS_SALE_SOURCE_ && (!s.исполнение_статус || s.исполнение_статус === 'ошибка_исполнения');
  }).slice(0, limit || POS_FULFILL_BATCH_LIMIT_);
  var result = { done: 0, failed: 0, errors: [] };
  pending.forEach(function (sale) {
    var wasFailed = sale.исполнение_статус === 'ошибка_исполнения';
    try {
      fulfillSaleByTtk_(sale.sale_id, session);
      result.done++;
    } catch (e) {
      result.failed++;
      var msg = String((e && e.message) || e);
      var fresh = findOne_('SALES', 'sale_id', sale.sale_id);
      if (fresh && fresh.исполнение_статус !== 'ошибка_исполнения') {
        updateRow_('SALES', fresh, { исполнение_статус: 'ошибка_исполнения', ошибка_исполнения: msg });
      }
      result.errors.push({ sale_id: sale.sale_id, error: msg });
      if (!wasFailed) {
        try {
          var dish = findOne_('DISHES', 'dish_id', sale.dish_id);
          createTask_({
            organizationId: session.organization_id, locationId: session.location_id, type: 'production',
            title: 'Касса: не списано по ТТК — ' + (dish ? dish.название : sale.dish_id),
            description: 'Продажа ' + sale.sale_id + ' (' + sale.qty + ' шт.) оплачена, но сырьё не списано: ' + msg +
              ' Исправьте ТТК или остатки — система повторит списание автоматически.',
            responsibleRole: 'ШЕФ-ПОВАР', priority: 'высокий', sourceEntityId: sale.sale_id,
            userId: session.user_id
          });
        } catch (taskErr) { logSystemError_('posFulfillPendingSales_', session.user_id, 'pos', taskErr, { sale_id: sale.sale_id }); }
      }
    }
  });
  return result;
}

function posFulfillPendingSalesTrigger_() {
  try {
    getOrganizations_(null).forEach(function (org) {
      (getLocations_(org.organization_id) || []).forEach(function (loc) {
        try {
          var s = { user_id: 'system', organization_id: org.organization_id, location_id: loc.location_id, role: 'ADMIN', 'роль': 'ADMIN', allowed_locations: [loc.location_id], cascade_id: '', operation_id: '' };
          posFulfillPendingSales_(s, POS_FULFILL_BATCH_LIMIT_);
        } catch (e) { logSystemError_('posFulfillPendingSalesTrigger_', org.organization_id, 'pos', e); }
      });
    });
  } catch (err) { logSystemError_('posFulfillPendingSalesTrigger_', null, 'pos', err); }
}

// ---------- Самопроверка (как run*Tests_ у других модулей) ----------

function runPosTests_() {
  var out = []; function ok(n, c, d) { out.push({ name: n, status: c ? 'OK' : 'FAIL', detail: d || '' }); }
  ['POS_SHIFTS', 'POS_ORDERS', 'POS_ORDER_LINES', 'POS_PAYMENTS'].forEach(function (k) {
    ok('SCHEMA_' + k, Array.isArray(CONFIG.SCHEMA[k]) && CONFIG.SHEETS[k] === k && !!CONFIG.ID_PREFIXES[k], 'sheet, schema, id prefix');
  });
  ['POS_GET_MENU', 'POS_OPEN_SHIFT', 'POS_GET_SHIFT', 'POS_CLOSE_SHIFT', 'POS_CREATE_ORDER', 'POS_ADD_LINE', 'POS_UPDATE_LINE',
    'POS_GET_ORDER', 'POS_GET_ORDERS', 'POS_PAY', 'POS_CANCEL_ORDER', 'POS_FULFILL_PENDING'].forEach(function (a) {
    ok('ACTION_' + a, typeof ACTION_HANDLERS[a] === 'function' && !!CONFIG.ACTION_MODULE[a], 'handler + module');
  });
  ok('ROLES', CONFIG.ROLE_LIST.indexOf('КАССИР') !== -1 && CONFIG.ROLE_LIST.indexOf('ОФИЦИАНТ') !== -1, 'new roles registered');
  ok('SCHEDULER', TRIGGER_SCHEDULE_.tick15m_.indexOf('posFulfillPendingSalesTrigger_') !== -1, 'fulfillment job in 15m tick');
  ok('FULFILLMENT', typeof fulfillSaleByTtk_ === 'function' && typeof createSale_ === 'function', 'sales pipeline available');
  return out;
}
