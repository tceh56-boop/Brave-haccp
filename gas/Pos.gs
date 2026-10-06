// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Pos.gs
 * Модуль «Касса» (replica/architecture.md): M1 — смены, заказы «с собой», оплата;
 * M2 — залы и столы, официант (свои столы, отправка на кухню, пречек), очередь кухни;
 * M3 — модификаторы: группы с мин/макс, надбавка к цене, расход продукта со склада;
 * M4 — стоп-лист: ручной и авто по годному остатку и утверждённой ТТК.
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

/** Официант работает только со своими заказами; кассир и менеджер — с любыми заказами точки. */
function _posAssertWaiterOwns_(order, session) {
  if (session.роль === 'ОФИЦИАНТ' && order.официант_id && order.официант_id !== session.user_id) {
    throw new Error('Этот стол обслуживает другой официант.');
  }
}

/** Стол этой точки, активный. */
function _posTable_(tableId, session) {
  var table = findOne_('POS_TABLES', 'table_id', tableId);
  assertOwnedByOrg_(session, table, 'POS_TABLES:' + tableId);
  if (table.location_id !== session.location_id) throw new Error('Стол относится к другой точке.');
  if (table.статус === 'архив') throw new Error('Стол «' + table.название + '» в архиве.');
  return table;
}

/** Открытый (или на пречеке) заказ на столе, если есть. На столе не больше одного такого заказа. */
function _posTableOrder_(tableId, session) {
  return findRows_('POS_ORDERS', function (o) {
    return o.location_id === session.location_id && o.table_id === tableId && (o.статус === 'открыт' || o.статус === 'пречек');
  })[0] || null;
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
  var table = order.table_id ? findOne_('POS_TABLES', 'table_id', order.table_id) : null;
  return { order: order, lines: _posActiveLines_(order.order_id), table: table ? { table_id: table.table_id, название: table.название } : null };
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
  if (session.роль === 'ОФИЦИАНТ') return { shift: { shift_id: shift.shift_id, открыта: shift.открыта, статус: shift.статус }, totals: null };
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
  var stops = {};
  _posActiveStops_(session).forEach(function (s) { if (!stops[s.dish_id] || s.источник === 'ручной') stops[s.dish_id] = s; });
  var dishes = getDishes_(session.organization_id).filter(function (d) {
    return d.статус !== 'архив' && Number(d.цена_продажи) > 0;
  }).map(function (d) {
    return { dish_id: d.dish_id, название: d.название, цена: round2_(Number(d.цена_продажи)), категория_id: d.категория_id || '', категория: cats[d.категория_id] || 'Без категории',
      modifier_groups: _posDishModifierGroups_(d.dish_id, session.organization_id),
      стоп: stops[d.dish_id] ? { причина: stops[d.dish_id].причина, источник: stops[d.dish_id].источник } : null };
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
    var tableId = '';
    if (data.tableId) {
      var table = _posTable_(data.tableId, session);
      var busy = _posTableOrder_(table.table_id, session);
      if (busy) throw new Error('На столе «' + table.название + '» уже есть открытый заказ №' + busy.номер + '.');
      tableId = table.table_id;
    } else if (session.роль === 'ОФИЦИАНТ') {
      throw new Error('Выберите стол.');
    }
    var number = findRows_('POS_ORDERS', function (o) { return o.shift_id === shift.shift_id; }).length + 1;
    var order = {
      order_id: generateId_('POS_ORDERS'),
      organization_id: session.organization_id,
      location_id: session.location_id,
      shift_id: shift.shift_id,
      table_id: tableId,
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

// ---------- Модификаторы (этап M3) ----------

/** Группы модификаторов блюда с активными модификаторами, в порядке привязки. */
function _posDishModifierGroups_(dishId, organizationId) {
  var links = findRows_('DISH_MODIFIER_LINKS', function (l) { return l.dish_id === dishId && l.organization_id === organizationId && l.статус !== 'архив'; })
    .sort(function (a, b) { return (Number(a.порядок) || 0) - (Number(b.порядок) || 0); });
  if (!links.length) return [];
  var groups = {}, mods = {};
  findRows_('MODIFIER_GROUPS', function (g) { return g.organization_id === organizationId && g.статус !== 'архив'; }).forEach(function (g) { groups[g.group_id] = g; });
  findRows_('MODIFIERS', function (m) { return m.organization_id === organizationId && m.статус !== 'архив'; }).forEach(function (m) { (mods[m.group_id] = mods[m.group_id] || []).push(m); });
  return links.filter(function (l) { return groups[l.group_id] && (mods[l.group_id] || []).length; }).map(function (l) {
    var g = groups[l.group_id];
    return {
      group_id: g.group_id, название: g.название, мин: Number(g.мин) || 0, макс: Number(g.макс) || 0,
      modifiers: mods[g.group_id].sort(function (a, b) { return (Number(a.порядок) || 0) - (Number(b.порядок) || 0); }).map(function (m) {
        return { modifier_id: m.modifier_id, название: m.название, цена_delta: round2_(Number(m.цена_delta) || 0) };
      })
    };
  });
}

/**
 * Проверяет выбор модификаторов для блюда: каждый модификатор — из группы, привязанной к блюду;
 * в каждой группе выбрано от «мин» до «макс» (макс 0 — без ограничения). Возвращает снимок
 * выбранных модификаторов (для строки заказа и списания) и суммарную надбавку к цене.
 */
function _posResolveModifiers_(dish, modifierIds, session) {
  if (!Array.isArray(modifierIds)) throw new Error('Некорректный список модификаторов.');
  var groups = _posDishModifierGroups_(dish.dish_id, session.organization_id);
  var byId = {}, counts = {};
  groups.forEach(function (g) { counts[g.group_id] = 0; });
  modifierIds.forEach(function (id) {
    if (byId[id]) throw new Error('Модификатор выбран дважды.');
    var m = findOne_('MODIFIERS', 'modifier_id', id);
    if (!m || m.organization_id !== session.organization_id || m.статус === 'архив' || !(m.group_id in counts)) {
      throw new Error('Модификатор недоступен для блюда «' + dish.название + '».');
    }
    byId[id] = m; counts[m.group_id]++;
  });
  groups.forEach(function (g) {
    var n = counts[g.group_id];
    // Сообщение начинается с русской буквы — иначе humanizeError_ (API.gs) заменит его общей ошибкой.
    if (n < g.мин) throw new Error('Группа «' + g.название + '»: выберите ' + (g.мин === 1 ? 'вариант' : 'не меньше ' + g.мин) + '.');
    if (g.макс > 0 && n > g.макс) throw new Error('Группа «' + g.название + '»: можно выбрать не больше ' + g.макс + '.');
  });
  var delta = 0, list = [];
  groups.forEach(function (g) {
    modifierIds.forEach(function (id) {
      var m = byId[id];
      if (m.group_id !== g.group_id) return;
      delta += Number(m.цена_delta) || 0;
      list.push({ modifier_id: m.modifier_id, group_id: m.group_id, название: m.название, цена_delta: round2_(Number(m.цена_delta) || 0),
        product_id: m.product_id || '', расход_qty: Number(m.расход_qty) || 0, единица: m.единица || '' });
    });
  });
  return { delta: round2_(delta), list: list };
}

function posGetModifiers_(session) {
  var groups = findRows_('MODIFIER_GROUPS', function (g) { return g.organization_id === session.organization_id && g.статус !== 'архив'; });
  var mods = findRows_('MODIFIERS', function (m) { return m.organization_id === session.organization_id && m.статус !== 'архив'; });
  var links = findRows_('DISH_MODIFIER_LINKS', function (l) { return l.organization_id === session.organization_id && l.статус !== 'архив'; });
  return {
    groups: groups.map(function (g) {
      return { group_id: g.group_id, название: g.название, мин: Number(g.мин) || 0, макс: Number(g.макс) || 0,
        modifiers: mods.filter(function (m) { return m.group_id === g.group_id; }).sort(function (a, b) { return (Number(a.порядок) || 0) - (Number(b.порядок) || 0); }) };
    }),
    links: links.map(function (l) { return { dish_id: l.dish_id, group_id: l.group_id, порядок: l.порядок }; }),
    // Короткие справочники для формы настройки: у менеджера нет модулей products/recipes,
    // поэтому отдаём здесь только то, что нужно для выбора (без цен закупки и рецептур).
    dishes: getDishes_(session.organization_id).filter(function (d) { return d.статус !== 'архив'; })
      .map(function (d) { return { dish_id: d.dish_id, название: d.название }; }),
    products: getProducts_(session.organization_id).filter(function (p) { return p.статус !== 'архив'; })
      .map(function (p) { return { product_id: p.product_id, название: p.название, единица: p.единица || '' }; })
  };
}

function posSaveModifierGroup_(data, session) {
  return withLock_(function () {
    var name = String(data.название || '').trim();
    if (!name) throw new Error('Укажите название группы.');
    var min = Math.max(0, Math.floor(Number(data.мин) || 0)), max = Math.max(0, Math.floor(Number(data.макс) || 0));
    if (max > 0 && min > max) throw new Error('Минимум не может быть больше максимума.');
    var patch = { название: name.slice(0, 60), мин: min, макс: max, статус: data.статус === 'архив' ? 'архив' : 'активна' };
    if (data.groupId) {
      var g = findOne_('MODIFIER_GROUPS', 'group_id', data.groupId);
      assertOwnedByOrg_(session, g, 'MODIFIER_GROUPS:' + data.groupId);
      updateRow_('MODIFIER_GROUPS', g, patch);
      return findOne_('MODIFIER_GROUPS', 'group_id', g.group_id);
    }
    var row = Object.assign({ group_id: generateId_('MODIFIER_GROUPS'), organization_id: session.organization_id, создано: nowIso_() }, patch);
    insertRow_('MODIFIER_GROUPS', row);
    auditLog_(session.user_id, 'Создана группа модификаторов', 'MODIFIER_GROUPS:' + row.group_id, null, row.название, 'success', session.cascade_id || '');
    return row;
  });
}

function posSaveModifier_(data, session) {
  return withLock_(function () {
    var name = String(data.название || '').trim();
    if (!name) throw new Error('Укажите название модификатора.');
    var group = findOne_('MODIFIER_GROUPS', 'group_id', data.groupId);
    assertOwnedByOrg_(session, group, 'MODIFIER_GROUPS:' + data.groupId);
    var delta = Number(data.цена_delta || 0);
    if (isNaN(delta)) throw new Error('Некорректная надбавка к цене.');
    var productId = data.productId || '', qty = Number(data.расход_qty || 0), unit = '';
    if (productId) {
      var product = getProductById_(productId);
      assertOwnedByOrg_(session, product, 'PRODUCTS:' + productId);
      if (!(qty > 0)) throw new Error('Укажите расход продукта на одну порцию.');
      unit = product.единица || '';
    } else { qty = 0; }
    var patch = { group_id: group.group_id, название: name.slice(0, 60), цена_delta: round2_(delta), product_id: productId, расход_qty: qty, единица: unit,
      порядок: Number(data.порядок) || 0, статус: data.статус === 'архив' ? 'архив' : 'активен' };
    if (data.modifierId) {
      var m = findOne_('MODIFIERS', 'modifier_id', data.modifierId);
      assertOwnedByOrg_(session, m, 'MODIFIERS:' + data.modifierId);
      updateRow_('MODIFIERS', m, patch);
      return findOne_('MODIFIERS', 'modifier_id', m.modifier_id);
    }
    var row = Object.assign({ modifier_id: generateId_('MODIFIERS'), organization_id: session.organization_id, создано: nowIso_() }, patch);
    insertRow_('MODIFIERS', row);
    return row;
  });
}

/** Задаёт полный список групп модификаторов блюда (порядок — как в groupIds). */
function posLinkDishModifiers_(data, session) {
  return withLock_(function () {
    var dish = findOne_('DISHES', 'dish_id', data.dishId);
    assertOwnedByOrg_(session, dish, 'DISHES:' + data.dishId);
    var ids = Array.isArray(data.groupIds) ? data.groupIds : [];
    ids.forEach(function (id) {
      var g = findOne_('MODIFIER_GROUPS', 'group_id', id);
      assertOwnedByOrg_(session, g, 'MODIFIER_GROUPS:' + id);
    });
    var existing = {};
    findRows_('DISH_MODIFIER_LINKS', function (l) { return l.dish_id === dish.dish_id && l.organization_id === session.organization_id; })
      .forEach(function (l) { existing[l.group_id] = l; });
    Object.keys(existing).forEach(function (gid) {
      if (ids.indexOf(gid) === -1 && existing[gid].статус !== 'архив') updateRow_('DISH_MODIFIER_LINKS', existing[gid], { статус: 'архив' });
    });
    ids.forEach(function (id, i) {
      if (existing[id]) { updateRow_('DISH_MODIFIER_LINKS', existing[id], { порядок: i, статус: 'активна' }); return; }
      insertRow_('DISH_MODIFIER_LINKS', { link_id: generateId_('DISH_MODIFIER_LINKS'), organization_id: session.organization_id, dish_id: dish.dish_id, group_id: id, порядок: i, статус: 'активна' });
    });
    auditLog_(session.user_id, 'Модификаторы блюда', 'DISHES:' + dish.dish_id, null, ids.join(','), 'success', session.cascade_id || '');
    return _posDishModifierGroups_(dish.dish_id, session.organization_id);
  });
}

function posAddLine_(data, session) {
  return withLock_(function () {
    var order = _posOrder_(data.orderId, session);
    _posAssertWaiterOwns_(order, session);
    _posAssertEditable_(order, data.version);
    var dish = findOne_('DISHES', 'dish_id', data.dishId);
    assertOwnedByOrg_(session, dish, 'DISHES:' + data.dishId);
    if (dish.статус === 'архив') throw new Error('Блюдо в архиве и не продаётся.');
    var stop = _posActiveStops_(session).filter(function (s) { return s.dish_id === dish.dish_id; })[0];
    if (stop) throw new Error('Блюдо «' + dish.название + '» в стоп-листе: ' + stop.причина);
    var basePrice = Number(dish.цена_продажи);
    if (!(basePrice > 0)) throw new Error('У блюда «' + dish.название + '» не указана цена продажи.');
    var qty = Number(data.qty || 1);
    if (!(qty > 0) || qty > 999) throw new Error('Количество должно быть от 1 до 999.');
    var mods = _posResolveModifiers_(dish, data.modifierIds || [], session);
    var price = round2_(basePrice + mods.delta);
    if (price < 0) throw new Error('С выбранными модификаторами цена получается отрицательной.');
    var modsJson = mods.list.length ? JSON.stringify(mods.list) : '';

    // Та же позиция с тем же набором модификаторов — увеличиваем количество, а не плодим строки.
    var same = _posActiveLines_(order.order_id).filter(function (l) { return l.dish_id === dish.dish_id && String(l.модификаторы_json || '') === modsJson && l.статус === 'новая'; })[0];
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
        цена: price,
        модификаторы_json: modsJson,
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
    _posAssertWaiterOwns_(order, session);
    _posAssertEditable_(order, data.version);
    if (line.статус === 'отменена') throw new Error('Позиция уже удалена.');
    if (line.статус !== 'новая') throw new Error('Позиция уже на кухне — изменить её нельзя. Добавьте новую или попросите менеджера отменить заказ.');
    var qty = Number(data.qty);
    if (qty === 0) {
      updateRow_('POS_ORDER_LINES', line, { статус: 'отменена' });
    } else {
      if (!(qty > 0) || qty > 999) throw new Error('Количество должно быть от 1 до 999.');
      updateRow_('POS_ORDER_LINES', line, { qty: qty, сумма: round2_(qty * Number(line.цена)) });
    }
    return _posOrderView_(_posTouchOrder_(order));
  });
}

function posGetOrder_(data, session) {
  var order = _posOrder_(data.orderId, session);
  _posAssertWaiterOwns_(order, session);
  return _posOrderView_(order);
}

function posGetOrders_(data, session) {
  var shift = _posOpenShift_(session);
  var shiftId = data.shiftId || (shift && shift.shift_id) || '';
  if (!shiftId) return [];
  return findRows_('POS_ORDERS', function (o) {
    return o.organization_id === session.organization_id && o.location_id === session.location_id && o.shift_id === shiftId &&
      (!data.status || o.статус === data.status) &&
      (session.роль !== 'ОФИЦИАНТ' || o.официант_id === session.user_id);
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
    if (order.статус !== 'открыт' && order.статус !== 'пречек') throw new Error('Заказ ' + order.статус + ' — оплатить его нельзя.');
    if (data.version !== undefined && data.version !== null && data.version !== '' && Number(data.version) !== Number(order.version)) {
      throw new Error('Заказ изменён на другом устройстве. Обновите экран.');
    }
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
      // Продукты модификаторов («двойной сыр») — отдельной очередью на списание.
      var mods = [];
      try { mods = l.модификаторы_json ? JSON.parse(l.модификаторы_json) : []; } catch (e) { mods = []; }
      mods.forEach(function (m) {
        if (!m.product_id || !(Number(m.расход_qty) > 0)) return;
        insertRow_('POS_MODIFIER_USAGE', {
          usage_id: generateId_('POS_MODIFIER_USAGE'), organization_id: session.organization_id, location_id: session.location_id,
          order_id: order.order_id, line_id: l.line_id, sale_id: sale.sale_id, modifier_id: m.modifier_id, product_id: m.product_id,
          qty: round2_(Number(m.расход_qty) * Number(l.qty)), единица: m.единица || '', статус: 'ожидает', создано: now,
          cascade_id: session.cascade_id || ''
        });
      });
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

// ---------- Зал, официант, кухня (этап M2) ----------

function posSaveHall_(data, session) {
  return withLock_(function () {
    var name = String(data.название || '').trim();
    if (!name) throw new Error('Укажите название зала.');
    if (data.hallId) {
      var hall = findOne_('POS_HALLS', 'hall_id', data.hallId);
      assertOwnedByOrg_(session, hall, 'POS_HALLS:' + data.hallId);
      if (hall.location_id !== session.location_id) throw new Error('Зал относится к другой точке.');
      updateRow_('POS_HALLS', hall, { название: name.slice(0, 60), порядок: Number(data.порядок) || hall.порядок || 0, статус: data.статус === 'архив' ? 'архив' : 'активен' });
      return findOne_('POS_HALLS', 'hall_id', hall.hall_id);
    }
    var row = { hall_id: generateId_('POS_HALLS'), organization_id: session.organization_id, location_id: session.location_id,
      название: name.slice(0, 60), порядок: Number(data.порядок) || 0, статус: 'активен', создано: nowIso_() };
    insertRow_('POS_HALLS', row);
    return row;
  });
}

function posSaveTable_(data, session) {
  return withLock_(function () {
    var name = String(data.название || '').trim();
    if (!name) throw new Error('Укажите номер или название стола.');
    var hall = findOne_('POS_HALLS', 'hall_id', data.hallId);
    assertOwnedByOrg_(session, hall, 'POS_HALLS:' + data.hallId);
    if (hall.location_id !== session.location_id) throw new Error('Зал относится к другой точке.');
    var seats = Math.max(0, Math.floor(Number(data.мест) || 0));
    var dup = findRows_('POS_TABLES', function (t) {
      return t.location_id === session.location_id && t.статус !== 'архив' && String(t.название).toLowerCase() === name.toLowerCase() && t.table_id !== data.tableId;
    });
    if (dup.length) throw new Error('Стол «' + name + '» в этой точке уже есть.');
    if (data.tableId) {
      var table = findOne_('POS_TABLES', 'table_id', data.tableId);
      assertOwnedByOrg_(session, table, 'POS_TABLES:' + data.tableId);
      if (data.статус === 'архив' && _posTableOrder_(table.table_id, session)) throw new Error('На столе открытый заказ — убрать стол сейчас нельзя.');
      updateRow_('POS_TABLES', table, { hall_id: hall.hall_id, название: name.slice(0, 30), мест: seats, порядок: Number(data.порядок) || table.порядок || 0, статус: data.статус === 'архив' ? 'архив' : 'активен' });
      return findOne_('POS_TABLES', 'table_id', table.table_id);
    }
    var row = { table_id: generateId_('POS_TABLES'), organization_id: session.organization_id, location_id: session.location_id,
      hall_id: hall.hall_id, название: name.slice(0, 30), мест: seats, порядок: Number(data.порядок) || 0, статус: 'активен', создано: nowIso_() };
    insertRow_('POS_TABLES', row);
    return row;
  });
}

/**
 * Схема зала: залы → столы со статусом (свободен | занят | пречек), суммой, официантом,
 * временем с открытия и счётчиками позиций на кухне / готовых к выдаче.
 */
function posGetFloor_(session) {
  var halls = findRows_('POS_HALLS', function (h) { return h.location_id === session.location_id && h.organization_id === session.organization_id && h.статус !== 'архив'; });
  var tables = findRows_('POS_TABLES', function (t) { return t.location_id === session.location_id && t.organization_id === session.organization_id && t.статус !== 'архив'; });
  var openOrders = {};
  findRows_('POS_ORDERS', function (o) { return o.location_id === session.location_id && o.table_id && (o.статус === 'открыт' || o.статус === 'пречек'); })
    .forEach(function (o) { openOrders[o.table_id] = o; });
  var names = {};
  getAllRows_('USERS').forEach(function (u) { if (u.organization_id === session.organization_id) names[u.user_id] = u.имя; });
  var byOrder = {};
  var ids = Object.keys(openOrders).map(function (k) { return openOrders[k].order_id; });
  if (ids.length) {
    findRows_('POS_ORDER_LINES', function (l) { return ids.indexOf(l.order_id) !== -1 && l.статус !== 'отменена'; }).forEach(function (l) {
      var c = byOrder[l.order_id] || (byOrder[l.order_id] = { новых: 0, на_кухне: 0, готово: 0 });
      if (l.статус === 'новая') c.новых++; else if (l.статус === 'на_кухне') c.на_кухне++; else if (l.статус === 'готово') c.готово++;
    });
  }
  var bySort = function (a, b) { return (Number(a.порядок) || 0) - (Number(b.порядок) || 0) || String(a.название).localeCompare(String(b.название), 'ru', { numeric: true }); };
  halls.sort(bySort); tables.sort(bySort);
  return {
    shift_open: !!_posOpenShift_(session),
    halls: halls.map(function (h) {
      return {
        hall_id: h.hall_id, название: h.название, порядок: h.порядок,
        tables: tables.filter(function (t) { return t.hall_id === h.hall_id; }).map(function (t) {
          var o = openOrders[t.table_id];
          var c = o ? (byOrder[o.order_id] || { новых: 0, на_кухне: 0, готово: 0 }) : null;
          return {
            table_id: t.table_id, название: t.название, мест: t.мест,
            статус: !o ? 'свободен' : (o.статус === 'пречек' ? 'пречек' : 'занят'),
            order_id: o ? o.order_id : '', номер: o ? o.номер : '', итого: o ? o.итого : 0,
            официант_id: o ? o.официант_id : '', официант: o ? (names[o.официант_id] || '') : '',
            мой: !!(o && o.официант_id === session.user_id),
            открыт_в: o ? o.создано : '', позиции: c
          };
        })
      };
    })
  };
}

function posSendToKitchen_(data, session) {
  return withLock_(function () {
    var order = _posOrder_(data.orderId, session);
    _posAssertWaiterOwns_(order, session);
    _posAssertEditable_(order, data.version);
    var fresh = _posActiveLines_(order.order_id).filter(function (l) { return l.статус === 'новая'; });
    if (!fresh.length) throw new Error('Новых позиций для кухни нет.');
    var now = nowIso_();
    fresh.forEach(function (l) { updateRow_('POS_ORDER_LINES', l, { статус: 'на_кухне', на_кухню_в: now }); });
    auditLog_(session.user_id, 'Заказ отправлен на кухню', 'POS_ORDERS:' + order.order_id, null, fresh.length + ' поз.', 'success', session.cascade_id || '');
    return _posOrderView_(_posTouchOrder_(order));
  });
}

/** Пречек: заказ закрыт для официанта, ждёт оплаты на кассе. Неотправленные позиции уходят на кухню. */
function posPrecheck_(data, session) {
  return withLock_(function () {
    var order = _posOrder_(data.orderId, session);
    _posAssertWaiterOwns_(order, session);
    _posAssertEditable_(order, data.version);
    var lines = _posActiveLines_(order.order_id);
    if (!lines.length) throw new Error('В заказе нет позиций.');
    var now = nowIso_();
    lines.filter(function (l) { return l.статус === 'новая'; }).forEach(function (l) { updateRow_('POS_ORDER_LINES', l, { статус: 'на_кухне', на_кухню_в: now }); });
    updateRow_('POS_ORDERS', order, { статус: 'пречек', version: (Number(order.version) || 0) + 1, обновлено: now });
    auditLog_(session.user_id, 'Пречек', 'POS_ORDERS:' + order.order_id, 'открыт', 'итого ' + order.итого, 'success', session.cascade_id || '');
    return _posOrderView_(findOne_('POS_ORDERS', 'order_id', order.order_id));
  });
}

function posReopenOrder_(data, session) {
  return withLock_(function () {
    var order = _posOrder_(data.orderId, session);
    if (order.статус !== 'пречек') throw new Error('Вернуть в работу можно только заказ на пречеке.');
    updateRow_('POS_ORDERS', order, { статус: 'открыт', version: (Number(order.version) || 0) + 1, обновлено: nowIso_() });
    auditLog_(session.user_id, 'Пречек снят', 'POS_ORDERS:' + order.order_id, 'пречек', 'открыт', 'success', session.cascade_id || '');
    return _posOrderView_(findOne_('POS_ORDERS', 'order_id', order.order_id));
  });
}

function posMoveOrder_(data, session) {
  return withLock_(function () {
    var order = _posOrder_(data.orderId, session);
    _posAssertWaiterOwns_(order, session);
    if (order.статус !== 'открыт' && order.статус !== 'пречек') throw new Error('Перенести можно только неоплаченный заказ.');
    var table = _posTable_(data.tableId, session);
    if (table.table_id === order.table_id) return _posOrderView_(order);
    var busy = _posTableOrder_(table.table_id, session);
    if (busy) throw new Error('Стол «' + table.название + '» занят (заказ №' + busy.номер + ').');
    var from = order.table_id;
    updateRow_('POS_ORDERS', order, { table_id: table.table_id, version: (Number(order.version) || 0) + 1, обновлено: nowIso_() });
    auditLog_(session.user_id, 'Заказ перенесён', 'POS_ORDERS:' + order.order_id, from || 'с собой', table.название, 'success', session.cascade_id || '');
    return _posOrderView_(findOne_('POS_ORDERS', 'order_id', order.order_id));
  });
}

/** Очередь кухни: позиции «на кухне» и недавно готовые (за 15 минут), старые сверху. */
function posGetKitchenQueue_(session) {
  var orders = {};
  findRows_('POS_ORDERS', function (o) { return o.location_id === session.location_id && o.organization_id === session.organization_id && (o.статус === 'открыт' || o.статус === 'пречек' || o.статус === 'оплачен'); })
    .forEach(function (o) { orders[o.order_id] = o; });
  var tables = {};
  findRows_('POS_TABLES', function (t) { return t.location_id === session.location_id; }).forEach(function (t) { tables[t.table_id] = t.название; });
  var since = Date.now() - 15 * 60 * 1000;
  var lines = findRows_('POS_ORDER_LINES', function (l) {
    if (!orders[l.order_id]) return false;
    if (l.статус === 'на_кухне') return true;
    return l.статус === 'готово' && new Date(l.готово_в).getTime() >= since;
  });
  lines.sort(function (a, b) { return String(a.на_кухню_в).localeCompare(String(b.на_кухню_в)); });
  return lines.map(function (l) {
    var o = orders[l.order_id];
    return { line_id: l.line_id, order_id: l.order_id, номер: o.номер, стол: o.table_id ? (tables[o.table_id] || '') : 'с собой',
      название: l.название_снимок, qty: l.qty, модификаторы_json: l.модификаторы_json, статус: l.статус, на_кухню_в: l.на_кухню_в, готово_в: l.готово_в };
  });
}

function posMarkLineReady_(data, session) {
  return withLock_(function () {
    var line = findOne_('POS_ORDER_LINES', 'line_id', data.lineId);
    assertOwnedByOrg_(session, line, 'POS_ORDER_LINES:' + data.lineId);
    var order = _posOrder_(line.order_id, session);
    if (line.статус !== 'на_кухне') throw new Error('Позиция не в очереди кухни.');
    updateRow_('POS_ORDER_LINES', line, { статус: 'готово', готово_в: nowIso_() });
    return { line_id: line.line_id, order_id: order.order_id, статус: 'готово' };
  });
}

// ---------- Стоп-лист (этап M4) ----------

var POS_LOW_PORTIONS_ = 5; // «осталось мало» — предупреждение в меню кассы

function _posActiveStops_(session) {
  return findRows_('STOP_LIST', function (s) {
    return s.organization_id === session.organization_id && s.location_id === session.location_id && !s.снято;
  });
}

/**
 * Сколько порций блюда можно приготовить из ГОДНОГО остатка точки по утверждённой ТТК
 * (брутто на порцию — та же функция, что и при списании продажи). null — посчитать нельзя
 * (нет утверждённой ТТК или рецептуры): такое блюдо автоматически не стопится.
 */
function _posDishPortions_(dish, session) {
  var ttk, recipe;
  try {
    ttk = getCurrentTtk_(dish.dish_id, session);
    if (!ttk) return null;
    recipe = getRecipeLines_('DISH', dish.dish_id, session);
    if (!recipe.length) return null;
  } catch (e) { return null; }
  var lines = _saleGrossNetLines_(recipe, 1);
  if (!lines.length) return null;
  var portions = Infinity, short = null;
  lines.forEach(function (l) {
    var have = getUsableStockLevel_(l.product_id, session.location_id);
    var n = Math.floor((have + 1e-9) / l.gross);
    if (n < portions) { portions = n; short = { name: l.name, have: round2_(have), need: round2_(l.gross), unit: l.единица }; }
  });
  return { portions: portions === Infinity ? null : portions, short: short };
}

/**
 * Пересчёт авто-стопов по остаткам: блюдо без хотя бы одной порции — в стоп с причиной
 * (какого сырья не хватает), появилась порция — авто-стоп снимается. Ручные стопы не трогает.
 */
function posRecalcStopList_(session) {
  return withLock_(function () {
    var active = {};
    _posActiveStops_(session).forEach(function (s) { (active[s.dish_id] = active[s.dish_id] || []).push(s); });
    var result = { stopped: [], lifted: [], low: [], no_ttk: 0 };
    getDishes_(session.organization_id).filter(function (d) { return d.статус !== 'архив' && Number(d.цена_продажи) > 0; }).forEach(function (d) {
      var calc = _posDishPortions_(d, session);
      if (!calc || calc.portions === null) { result.no_ttk++; return; }
      var auto = (active[d.dish_id] || []).filter(function (s) { return s.источник === 'авто_остатки'; })[0];
      if (calc.portions < 1) {
        if (!auto) {
          var sh = calc.short;
          var row = { stop_id: generateId_('STOP_LIST'), organization_id: session.organization_id, location_id: session.location_id, dish_id: d.dish_id,
            причина: 'Не хватает: ' + sh.name + ' (есть ' + sh.have + ' ' + (sh.unit || '') + ', нужно ' + sh.need + ' ' + (sh.unit || '') + ' на порцию)',
            источник: 'авто_остатки', создано: nowIso_(), user_id: session.user_id };
          insertRow_('STOP_LIST', row);
          result.stopped.push({ dish_id: d.dish_id, название: d.название, причина: row.причина });
        }
      } else {
        if (auto) {
          updateRow_('STOP_LIST', auto, { снято: nowIso_(), снял_id: session.user_id });
          result.lifted.push({ dish_id: d.dish_id, название: d.название });
        }
        if (calc.portions < POS_LOW_PORTIONS_) result.low.push({ dish_id: d.dish_id, название: d.название, порций: calc.portions });
      }
    });
    if (result.stopped.length || result.lifted.length) {
      auditLog_(session.user_id, 'Пересчёт стоп-листа', 'STOP_LIST:' + session.location_id, null,
        'в стоп ' + result.stopped.length + ', снято ' + result.lifted.length, 'success', session.cascade_id || '');
    }
    return result;
  });
}

function posGetStopList_(session) {
  var dishes = {};
  getDishes_(session.organization_id).forEach(function (d) { dishes[d.dish_id] = d.название; });
  var names = {};
  getAllRows_('USERS').forEach(function (u) { if (u.organization_id === session.organization_id) names[u.user_id] = u.имя; });
  var stops = _posActiveStops_(session).map(function (s) {
    return { stop_id: s.stop_id, dish_id: s.dish_id, название: dishes[s.dish_id] || s.dish_id, причина: s.причина, источник: s.источник,
      создано: s.создано, кто: s.user_id === 'system' ? 'автоматически' : (names[s.user_id] || '') };
  }).sort(function (a, b) { return String(b.создано).localeCompare(String(a.создано)); });
  // Список блюд для ручного стопа: у повара нет доступа к меню кассы (модуль pos).
  var menu = getDishes_(session.organization_id).filter(function (d) { return d.статус !== 'архив' && Number(d.цена_продажи) > 0; })
    .map(function (d) { return { dish_id: d.dish_id, название: d.название }; })
    .sort(function (a, b) { return String(a.название).localeCompare(String(b.название), 'ru'); });
  return { stops: stops, dishes: menu };
}

function posSetStop_(data, session) {
  return withLock_(function () {
    var dish = findOne_('DISHES', 'dish_id', data.dishId);
    assertOwnedByOrg_(session, dish, 'DISHES:' + data.dishId);
    var reason = String(data.reason || '').trim();
    if (!reason) throw new Error('Укажите причину стопа.');
    var manual = _posActiveStops_(session).filter(function (s) { return s.dish_id === dish.dish_id && s.источник === 'ручной'; })[0];
    if (manual) throw new Error('Блюдо «' + dish.название + '» уже в стоп-листе.');
    var row = { stop_id: generateId_('STOP_LIST'), organization_id: session.organization_id, location_id: session.location_id, dish_id: dish.dish_id,
      причина: reason.slice(0, 200), источник: 'ручной', создано: nowIso_(), user_id: session.user_id };
    insertRow_('STOP_LIST', row);
    auditLog_(session.user_id, 'Блюдо в стоп-листе', 'DISHES:' + dish.dish_id, null, row.причина, 'success', session.cascade_id || '');
    return row;
  });
}

/** Снимает стоп. Авто-стоп при нехватке сырья вернётся при следующем пересчёте — это честно. */
function posClearStop_(data, session) {
  return withLock_(function () {
    var stop = findOne_('STOP_LIST', 'stop_id', data.stopId);
    assertOwnedByOrg_(session, stop, 'STOP_LIST:' + data.stopId);
    if (stop.location_id !== session.location_id) throw new Error('Стоп относится к другой точке.');
    if (stop.снято) throw new Error('Стоп уже снят.');
    updateRow_('STOP_LIST', stop, { снято: nowIso_(), снял_id: session.user_id });
    auditLog_(session.user_id, 'Стоп снят', 'DISHES:' + stop.dish_id, stop.причина, 'снято', 'success', session.cascade_id || '');
    return { stop_id: stop.stop_id, снято: true };
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

/** Списывает продукты модификаторов оплаченных позиций. Задача кладовщику/шефу — один раз на ошибку. */
function posFulfillModifierUsage_(session, limit) {
  var pending = findRows_('POS_MODIFIER_USAGE', function (u) {
    return u.organization_id === session.organization_id && u.location_id === session.location_id && (u.статус === 'ожидает' || u.статус === 'ошибка');
  }).slice(0, limit || POS_FULFILL_BATCH_LIMIT_);
  var result = { done: 0, failed: 0 };
  pending.forEach(function (u) {
    var wasFailed = u.статус === 'ошибка';
    try {
      withLock_(function () {
        consumeStock_(u.product_id, u.location_id, Number(u.qty), OP_TYPES.ISSUE, session.user_id, session);
        updateRow_('POS_MODIFIER_USAGE', findOne_('POS_MODIFIER_USAGE', 'usage_id', u.usage_id), { статус: 'списано', списано_в: nowIso_(), ошибка: '' });
      });
      result.done++;
    } catch (e) {
      result.failed++;
      var msg = String((e && e.message) || e);
      updateRow_('POS_MODIFIER_USAGE', findOne_('POS_MODIFIER_USAGE', 'usage_id', u.usage_id), { статус: 'ошибка', ошибка: msg });
      if (!wasFailed) {
        try {
          var product = getProductById_(u.product_id);
          createTask_({
            organizationId: session.organization_id, locationId: session.location_id, type: 'production',
            title: 'Касса: не списан продукт модификатора — ' + (product ? product.название : u.product_id),
            description: 'Расход ' + u.qty + ' ' + (u.единица || '') + ' по продаже ' + u.sale_id + ' не списан: ' + msg + ' Система повторит списание автоматически.',
            responsibleRole: 'ШЕФ-ПОВАР', priority: 'высокий', sourceEntityId: u.usage_id, userId: session.user_id
          });
        } catch (taskErr) { logSystemError_('posFulfillModifierUsage_', session.user_id, 'pos', taskErr, { usage_id: u.usage_id }); }
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
          posFulfillModifierUsage_(s, POS_FULFILL_BATCH_LIMIT_);
          // Стоп-лист пересчитываем только на работающей точке (открыта смена) — экономим время тика.
          if (_posOpenShift_(s)) posRecalcStopList_(s);
        } catch (e) { logSystemError_('posFulfillPendingSalesTrigger_', org.organization_id, 'pos', e); }
      });
    });
  } catch (err) { logSystemError_('posFulfillPendingSalesTrigger_', null, 'pos', err); }
}

// ---------- Самопроверка (как run*Tests_ у других модулей) ----------

function runPosTests_() {
  var out = []; function ok(n, c, d) { out.push({ name: n, status: c ? 'OK' : 'FAIL', detail: d || '' }); }
  ['POS_SHIFTS', 'POS_ORDERS', 'POS_ORDER_LINES', 'POS_PAYMENTS', 'POS_HALLS', 'POS_TABLES',
    'MODIFIER_GROUPS', 'MODIFIERS', 'DISH_MODIFIER_LINKS', 'POS_MODIFIER_USAGE', 'STOP_LIST'].forEach(function (k) {
    ok('SCHEMA_' + k, Array.isArray(CONFIG.SCHEMA[k]) && CONFIG.SHEETS[k] === k && !!CONFIG.ID_PREFIXES[k], 'sheet, schema, id prefix');
  });
  ['POS_GET_MENU', 'POS_OPEN_SHIFT', 'POS_GET_SHIFT', 'POS_CLOSE_SHIFT', 'POS_CREATE_ORDER', 'POS_ADD_LINE', 'POS_UPDATE_LINE',
    'POS_GET_ORDER', 'POS_GET_ORDERS', 'POS_PAY', 'POS_CANCEL_ORDER', 'POS_FULFILL_PENDING',
    'POS_GET_FLOOR', 'POS_SEND_TO_KITCHEN', 'POS_PRECHECK', 'POS_MOVE_ORDER', 'POS_REOPEN_ORDER', 'POS_SAVE_HALL', 'POS_SAVE_TABLE',
    'POS_GET_KITCHEN_QUEUE', 'POS_MARK_LINE_READY',
    'POS_GET_MODIFIERS', 'POS_SAVE_MODIFIER_GROUP', 'POS_SAVE_MODIFIER', 'POS_LINK_DISH_MODIFIERS',
    'POS_GET_STOP_LIST', 'POS_SET_STOP', 'POS_CLEAR_STOP', 'POS_RECALC_STOP_LIST'].forEach(function (a) {
    ok('ACTION_' + a, typeof ACTION_HANDLERS[a] === 'function' && !!CONFIG.ACTION_MODULE[a], 'handler + module');
  });
  ok('ROLES', CONFIG.ROLE_LIST.indexOf('КАССИР') !== -1 && CONFIG.ROLE_LIST.indexOf('ОФИЦИАНТ') !== -1, 'new roles registered');
  ok('SCHEDULER', TRIGGER_SCHEDULE_.tick15m_.indexOf('posFulfillPendingSalesTrigger_') !== -1, 'fulfillment job in 15m tick');
  ok('FULFILLMENT', typeof fulfillSaleByTtk_ === 'function' && typeof createSale_ === 'function', 'sales pipeline available');
  return out;
}
