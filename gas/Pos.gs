// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Pos.gs
 * Модуль «Касса» (replica/architecture.md): M1 — смены, заказы «с собой», оплата;
 * M2 — залы и столы, официант (свои столы, отправка на кухню, пречек), очередь кухни;
 * M3 — модификаторы: группы с мин/макс, надбавка к цене, расход продукта со склада;
 * M4 — стоп-лист: ручной и авто по годному остатку и утверждённой ТТК;
 * M5 — возвраты (сторно в SALES), отчёт по сотрудникам, итоги смены в «Экономику»;
 * M6 — гости и бонусы (кешбэк, списание как скидка, пропорциональный пересчёт при возврате);
 * M7 — чаевые: ссылка сотрудника на внешний сервис, QR на пречеке (деньги ЦЕХ не принимает);
 * M8 — QR-меню: снимок меню точки в PUBLIC_MENU для отдельного публичного проекта qrmenu/.
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

function _posOrderView_(order, session) {
  var table = order.table_id ? findOne_('POS_TABLES', 'table_id', order.table_id) : null;
  var view = { order: order, lines: _posActiveLines_(order.order_id), table: table ? { table_id: table.table_id, название: table.название } : null, guest: null, tip: null };
  // Чаевые: ссылка того, кто ведёт заказ (официант / кассир «с собой»).
  var tl = order.официант_id ? _posTipLink_(order.официант_id, order.organization_id) : null;
  if (tl) { var w = findOne_('USERS', 'user_id', order.официант_id); view.tip = { имя: w ? w.имя : '', ссылка: tl.ссылка, сервис: tl.сервис }; }
  if (order.guest_id) {
    var g = findOne_('GUESTS', 'guest_id', order.guest_id);
    if (g && g.статус !== 'обезличен') {
      var s = session || { роль: '', organization_id: order.organization_id };
      view.guest = _posGuestView_(g, s);
      view.guest.можно_списать = _posMaxBonus_(order, g, posGetLoyaltySettings_({ organization_id: order.organization_id }));
    }
  }
  return view;
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
/** Итоги смены по строкам оплат: нал/карта/прочее — нетто (возвраты — отрицательные строки). */
function _posShiftTotals_(shift) {
  var totals = { нал: 0, карта: 0, прочее: 0 }, gross = 0, refunds = 0;
  findRows_('POS_PAYMENTS', function (p) { return p.shift_id === shift.shift_id; }).forEach(function (p) {
    var sum = Number(p.сумма) || 0;
    totals[p.способ] = round2_((totals[p.способ] || 0) + sum);
    if (sum < 0) refunds = round2_(refunds - sum); else gross = round2_(gross + sum);
  });
  var orders = findRows_('POS_ORDERS', function (o) { return o.shift_id === shift.shift_id; });
  var sold = orders.filter(function (o) { return o.статус === 'оплачен' || o.статус === 'возврат'; });
  return {
    нал: totals.нал, карта: totals.карта, прочее: totals.прочее,
    выручка: round2_(totals.нал + totals.карта + totals.прочее), продажи: gross, возвраты: refunds,
    заказов: sold.length,
    открытых_заказов: orders.filter(function (o) { return o.статус === 'открыт' || o.статус === 'пречек'; }).length,
    средний_чек: sold.length ? round2_(gross / sold.length) : 0,
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
    // Пустые заказы (стол открыли, ничего не добавили) не держат смену: отменяются автоматически.
    findRows_('POS_ORDERS', function (o) { return o.shift_id === shift.shift_id && (o.статус === 'открыт' || o.статус === 'пречек'); }).forEach(function (o) {
      if (!_posActiveLines_(o.order_id).length) {
        updateRow_('POS_ORDERS', o, { статус: 'отменён', комментарий: 'Пустой заказ — отменён при закрытии смены', version: (Number(o.version) || 0) + 1, обновлено: nowIso_() });
      }
    });
    var t = _posShiftTotals_(shift);
    if (t.открытых_заказов) throw new Error('Есть неоплаченные заказы (' + t.открытых_заказов + '). Оплатите или отмените их перед закрытием смены.');
    if (data.cashFact === undefined || data.cashFact === null || data.cashFact === '' || isNaN(Number(data.cashFact))) {
      throw new Error('Укажите фактическую сумму наличных в кассе.');
    }
    var cashFact = round2_(Number(data.cashFact));
    // Итоги смены — в движение денег «Экономики» (FinanceStage22): по одной строке на способ
    // оплаты, нетто после возвратов. Сначала деньги, потом статус смены: если запись не прошла
    // (например, закрытый период), смена останется открытой, а не «закрытой без денег».
    var day = _posShiftDate_(shift), cashIds = [];
    [['нал', 'наличные'], ['карта', 'карта'], ['прочее', 'прочие оплаты']].forEach(function (m) {
      var net = t[m[0]];
      if (!net) return;
      var row = recordCashTransaction_({ amount: Math.abs(net), type: net > 0 ? 'INFLOW' : 'OUTFLOW', date: day, locationId: shift.location_id,
        category: net > 0 ? 'Выручка кассы' : 'Возвраты кассы',
        description: 'Смена ' + shift.shift_id + ' от ' + day + ': ' + m[1] + (t.возвраты ? ' (с учётом возвратов ' + t.возвраты + ' ₽)' : '') }, session);
      cashIds.push(row.cash_id);
    });
    updateRow_('POS_SHIFTS', shift, {
      закрыта: nowIso_(), нал_конец_факт: cashFact,
      итог_нал: t.нал, итог_карта: t.карта, итог_прочее: t.прочее, заказов: t.заказов,
      возвратов_сумма: t.возвраты, cash_ids: cashIds.join(','),
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
    return _posOrderView_(order, session);
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
    return _posOrderView_(_posTouchOrder_(order), session);
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
    return _posOrderView_(_posTouchOrder_(order), session);
  });
}

function posGetOrder_(data, session) {
  var order = _posOrder_(data.orderId, session);
  _posAssertWaiterOwns_(order, session);
  return _posOrderView_(order, session);
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
    var gross = round2_(Number(order.сумма) || 0);

    // Бонусы гостя — скидка на заказ (не способ оплаты): в продажи и чек идут цены со скидкой.
    var settings = posGetLoyaltySettings_(session);
    var guest = order.guest_id ? findOne_('GUESTS', 'guest_id', order.guest_id) : null;
    if (guest && guest.статус === 'обезличен') guest = null;
    var bonus = Math.floor(Number(data.bonus) || 0);
    if (bonus < 0) throw new Error('Некорректное количество бонусов.');
    if (bonus && !guest) throw new Error('Чтобы списать бонусы, укажите гостя.');
    if (bonus) {
      var maxBonus = _posMaxBonus_(order, guest, settings);
      if (bonus > maxBonus) throw new Error('Можно списать не больше ' + maxBonus + ' бонусов.');
    }
    var total = round2_(Math.max(0, gross - bonus));
    var k = gross > 0 ? total / gross : 1;

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
        создано: now, user_id: session.user_id, тип: 'оплата'
      };
      insertRow_('POS_PAYMENTS', row);
      payRows.push(row);
    });

    // Продажа по каждой позиции. Цена — фактическая цена строки (снимок на момент заказа).
    var saleDate = _posShiftDate_(shift);
    // Не отправленные на кухню позиции (заказ «с собой», касса без официанта) уходят на кухню при оплате.
    lines.forEach(function (l) {
      if (l.статус === 'новая') updateRow_('POS_ORDER_LINES', l, { статус: 'на_кухне', на_кухню_в: now });
    });
    lines = _posActiveLines_(order.order_id);
    lines.forEach(function (l) {
      var sale = createSale_({
        dishId: l.dish_id, qty: Number(l.qty), цена_продажи: round2_(Number(l.цена) * k), дата: saleDate,
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

    // Бонусы: списание (скидка) и начисление кешбэка от суммы, оплаченной деньгами.
    var accrued = 0;
    if (guest) {
      if (bonus) _posBonusTxn_(guest, 'списание', -bonus, order.order_id, 'Оплата заказа №' + order.номер, session);
      if (settings.включено && settings.кешбэк_процент > 0) {
        accrued = Math.floor(total * settings.кешбэк_процент / 100);
        if (accrued) _posBonusTxn_(guest, 'начисление', accrued, order.order_id, 'Кешбэк ' + settings.кешбэк_процент + '% с заказа №' + order.номер, session);
      }
      var gf = findOne_('GUESTS', 'guest_id', guest.guest_id);
      updateRow_('GUESTS', gf, { визитов: (Number(gf.визитов) || 0) + 1, всего_оплачено: round2_((Number(gf.всего_оплачено) || 0) + total), последний_визит: now });
    }

    updateRow_('POS_ORDERS', order, { статус: 'оплачен', оплачен: now, скидка: bonus, итого: total, бонусы_списано: bonus, бонусы_начислено: accrued,
      version: (Number(order.version) || 0) + 1, обновлено: now });
    auditLog_(session.user_id, 'Оплачен заказ кассы', 'POS_ORDERS:' + order.order_id, 'открыт',
      'итого ' + total + (bonus ? ', бонусами ' + bonus : '') + (change ? ', сдача ' + change : ''), 'success', session.cascade_id || '');
    return { order: findOne_('POS_ORDERS', 'order_id', order.order_id), payments: payRows, сдача: change, бонусы_списано: bonus, бонусы_начислено: accrued,
      guest: guest ? _posGuestView_(findOne_('GUESTS', 'guest_id', guest.guest_id), session) : null };
  });
}

/** Убрать пустой заказ (без позиций): официант — свой, кассир и менеджмент — любой. */
function posDiscardEmptyOrder_(data, session) {
  return withLock_(function () {
    var order = _posOrder_(data.orderId, session);
    _posAssertWaiterOwns_(order, session);
    if (order.статус !== 'открыт' && order.статус !== 'пречек') throw new Error('Заказ уже ' + order.статус + '.');
    if (_posActiveLines_(order.order_id).length) throw new Error('В заказе есть позиции — отменить его может менеджер.');
    updateRow_('POS_ORDERS', order, { статус: 'отменён', комментарий: 'Пустой заказ убран', version: (Number(order.version) || 0) + 1, обновлено: nowIso_() });
    return { order: findOne_('POS_ORDERS', 'order_id', order.order_id) };
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
    return _posOrderView_(_posTouchOrder_(order), session);
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
    return _posOrderView_(findOne_('POS_ORDERS', 'order_id', order.order_id), session);
  });
}

function posReopenOrder_(data, session) {
  return withLock_(function () {
    var order = _posOrder_(data.orderId, session);
    if (order.статус !== 'пречек') throw new Error('Вернуть в работу можно только заказ на пречеке.');
    updateRow_('POS_ORDERS', order, { статус: 'открыт', version: (Number(order.version) || 0) + 1, обновлено: nowIso_() });
    auditLog_(session.user_id, 'Пречек снят', 'POS_ORDERS:' + order.order_id, 'пречек', 'открыт', 'success', session.cascade_id || '');
    return _posOrderView_(findOne_('POS_ORDERS', 'order_id', order.order_id), session);
  });
}

function posMoveOrder_(data, session) {
  return withLock_(function () {
    var order = _posOrder_(data.orderId, session);
    _posAssertWaiterOwns_(order, session);
    if (order.статус !== 'открыт' && order.статус !== 'пречек') throw new Error('Перенести можно только неоплаченный заказ.');
    var table = _posTable_(data.tableId, session);
    if (table.table_id === order.table_id) return _posOrderView_(order, session);
    var busy = _posTableOrder_(table.table_id, session);
    if (busy) throw new Error('Стол «' + table.название + '» занят (заказ №' + busy.номер + ').');
    var from = order.table_id;
    updateRow_('POS_ORDERS', order, { table_id: table.table_id, version: (Number(order.version) || 0) + 1, обновлено: nowIso_() });
    auditLog_(session.user_id, 'Заказ перенесён', 'POS_ORDERS:' + order.order_id, from || 'с собой', table.название, 'success', session.cascade_id || '');
    return _posOrderView_(findOne_('POS_ORDERS', 'order_id', order.order_id), session);
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

// ---------- Гости и бонусы (этап M6) ----------

var POS_LOYALTY_DEFAULTS_ = { включено: true, кешбэк_процент: 5, макс_списание_процент: 30 };

function _posSettingRow_(organizationId, key) {
  return findRows_('SETTINGS', function (r) { return r.organization_id === organizationId && !r.location_id && r.ключ === key; })[0] || null;
}

function posGetLoyaltySettings_(session) {
  var out = {};
  Object.keys(POS_LOYALTY_DEFAULTS_).forEach(function (k) {
    var row = _posSettingRow_(session.organization_id, 'loyalty.' + k);
    var def = POS_LOYALTY_DEFAULTS_[k];
    if (!row || row.значение === '' || row.значение === null) { out[k] = def; return; }
    out[k] = typeof def === 'boolean' ? (row.значение === true || String(row.значение) === 'true' || String(row.значение) === 'да') : Number(row.значение);
  });
  return out;
}

function posSaveLoyaltySettings_(data, session) {
  return withLock_(function () {
    var cb = Number(data.кешбэк_процент), mx = Number(data.макс_списание_процент);
    if (isNaN(cb) || cb < 0 || cb > 50) throw new Error('Кешбэк — от 0 до 50%.');
    if (isNaN(mx) || mx < 0 || mx > 100) throw new Error('Списание бонусами — от 0 до 100% чека.');
    var vals = { включено: !!data.включено, кешбэк_процент: round2_(cb), макс_списание_процент: round2_(mx) };
    Object.keys(vals).forEach(function (k) {
      var row = _posSettingRow_(session.organization_id, 'loyalty.' + k);
      if (row) updateRow_('SETTINGS', row, { значение: String(vals[k]) });
      else insertRow_('SETTINGS', { organization_id: session.organization_id, location_id: '', ключ: 'loyalty.' + k, значение: String(vals[k]) });
    });
    auditLog_(session.user_id, 'Правила бонусной программы', 'SETTINGS:loyalty', null, JSON.stringify(vals), 'success', session.cascade_id || '');
    return posGetLoyaltySettings_(session);
  });
}

/** +7XXXXXXXXXX из «8 (912) 345-67-89», «+7 912…», «9123456789». Иначе ошибка. */
function _posNormPhone_(raw) {
  var d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10) d = '7' + d;
  if (d.length === 11 && d.charAt(0) === '8') d = '7' + d.slice(1);
  if (d.length !== 11 || d.charAt(0) !== '7') throw new Error('Телефон нужен в формате +7 XXX XXX-XX-XX.');
  return '+' + d;
}

/** Полный телефон гостя видят только роли с pos_admin; остальным — последние 4 цифры. */
function _posCanSeePd_(session) {
  var mods = CONFIG.ROLE_MODULES[session.роль];
  return mods === 'all' || (Array.isArray(mods) && mods.indexOf('pos_admin') !== -1);
}

function _posGuestView_(g, session) {
  if (!g) return null;
  var full = _posCanSeePd_(session);
  return {
    guest_id: g.guest_id, имя: g.имя, телефон: full ? g.телефон : (g.телефон ? '••• ' + String(g.телефон).slice(-4) : ''),
    день_рождения: full ? g.день_рождения : '', бонусы: round2_(Number(g.бонусы) || 0), визитов: Number(g.визитов) || 0,
    всего_оплачено: full ? round2_(Number(g.всего_оплачено) || 0) : undefined, последний_визит: g.последний_визит, статус: g.статус
  };
}

function _posGuest_(guestId, session) {
  var g = findOne_('GUESTS', 'guest_id', guestId);
  assertOwnedByOrg_(session, g, 'GUESTS:' + guestId);
  if (g.статус === 'обезличен') throw new Error('Карточка гостя обезличена по его запросу.');
  return g;
}

/** Проводка по бонусам и обновление кэша баланса (вызывать внутри withLock_). */
function _posBonusTxn_(guest, type, amount, orderId, reason, session) {
  amount = round2_(amount);
  if (!amount) return null;
  var fresh = findOne_('GUESTS', 'guest_id', guest.guest_id);
  var balance = round2_((Number(fresh.бонусы) || 0) + amount);
  if (balance < 0) throw new Error('Недостаточно бонусов: на счёте ' + round2_(Number(fresh.бонусы) || 0) + '.');
  var row = { txn_id: generateId_('BONUS_TXNS'), organization_id: session.organization_id, guest_id: guest.guest_id, order_id: orderId || '',
    тип: type, сумма: amount, остаток_после: balance, создано: nowIso_(), user_id: session.user_id, причина: String(reason || '').slice(0, 200) };
  insertRow_('BONUS_TXNS', row);
  updateRow_('GUESTS', fresh, { бонусы: balance });
  return row;
}

function posFindGuest_(data, session) {
  var q = String(data.phone || '').replace(/\D/g, '');
  if (q.length < 4) throw new Error('Введите не меньше 4 цифр телефона.');
  var exact = null;
  try { exact = _posNormPhone_(q); } catch (e) { exact = null; }
  return findRows_('GUESTS', function (g) {
    if (g.organization_id !== session.organization_id || g.статус === 'обезличен') return false;
    return exact ? g.телефон === exact : String(g.телефон).slice(-q.length) === q;
  }).slice(0, 10).map(function (g) { return _posGuestView_(g, session); });
}

function posSaveGuest_(data, session) {
  return withLock_(function () {
    var name = String(data.имя || '').trim().slice(0, 60);
    if (data.guestId) {
      if (!_posCanSeePd_(session)) throw new Error('Изменять карточку гостя может менеджер.');
      var g = _posGuest_(data.guestId, session);
      var patch = {};
      if (name) patch.имя = name;
      if (data.телефон) {
        var p = _posNormPhone_(data.телефон);
        var dupe = findRows_('GUESTS', function (x) { return x.organization_id === session.organization_id && x.телефон === p && x.guest_id !== g.guest_id; })[0];
        if (dupe) throw new Error('Гость с таким телефоном уже есть.');
        patch.телефон = p;
      }
      if (data.день_рождения !== undefined) patch.день_рождения = String(data.день_рождения || '').slice(0, 10);
      if (data.комментарий !== undefined) patch.комментарий = String(data.комментарий || '').slice(0, 300);
      updateRow_('GUESTS', g, patch);
      return _posGuestView_(findOne_('GUESTS', 'guest_id', g.guest_id), session);
    }
    if (data.consent !== true) throw new Error('Нужно согласие гостя на обработку персональных данных.');
    var phone = _posNormPhone_(data.телефон);
    if (!name) throw new Error('Укажите имя гостя.');
    var exists = findRows_('GUESTS', function (x) { return x.organization_id === session.organization_id && x.телефон === phone && x.статус !== 'обезличен'; })[0];
    if (exists) throw new Error('Гость с таким телефоном уже есть: ' + exists.имя + '.');
    var row = { guest_id: generateId_('GUESTS'), organization_id: session.organization_id, телефон: phone, имя: name,
      день_рождения: String(data.день_рождения || '').slice(0, 10), согласие_пд: nowIso_(), бонусы: 0, всего_оплачено: 0, визитов: 0,
      последний_визит: '', статус: 'активен', создано: nowIso_(), комментарий: '', user_id: session.user_id };
    insertRow_('GUESTS', row);
    auditLog_(session.user_id, 'Новый гость (согласие на ПД получено)', 'GUESTS:' + row.guest_id, null, row.имя, 'success', session.cascade_id || '');
    return _posGuestView_(row, session);
  });
}

function posAttachGuest_(data, session) {
  return withLock_(function () {
    var order = _posOrder_(data.orderId, session);
    _posAssertWaiterOwns_(order, session);
    if (order.статус !== 'открыт' && order.статус !== 'пречек') throw new Error('Гостя можно указать только в неоплаченном заказе.');
    var guestId = '';
    if (data.guestId) guestId = _posGuest_(data.guestId, session).guest_id;
    updateRow_('POS_ORDERS', order, { guest_id: guestId, version: (Number(order.version) || 0) + 1, обновлено: nowIso_() });
    return _posOrderView_(findOne_('POS_ORDERS', 'order_id', order.order_id), session);
  });
}

function posGetGuest_(data, session) {
  var g = _posGuest_(data.guestId, session);
  var view = _posGuestView_(g, session);
  if (_posCanSeePd_(session)) {
    view.история = findRows_('BONUS_TXNS', function (t) { return t.guest_id === g.guest_id; })
      // Новые сверху; при одинаковом времени — по порядку записи в листе (__row), иначе «списание» и
      // «начисление» одной оплаты меняются местами и остаток читается неверно.
      .sort(function (a, b) { return String(b.создано).localeCompare(String(a.создано)) || (b.__row - a.__row); }).slice(0, 50);
    view.согласие_пд = g.согласие_пд; view.комментарий = g.комментарий;
  }
  return view;
}

function posGetGuests_(data, session) {
  var q = String(data.query || '').toLowerCase().trim(), digits = q.replace(/\D/g, '');
  return findRows_('GUESTS', function (g) {
    if (g.organization_id !== session.organization_id || g.статус === 'обезличен') return false;
    if (!q) return true;
    return String(g.имя).toLowerCase().indexOf(q) !== -1 || (digits.length >= 3 && String(g.телефон).indexOf(digits) !== -1);
  }).sort(function (a, b) { return String(b.последний_визит || b.создано).localeCompare(String(a.последний_визит || a.создано)); })
    .slice(0, 200).map(function (g) { return _posGuestView_(g, session); });
}

function posAdjustBonus_(data, session) {
  return withLock_(function () {
    var g = _posGuest_(data.guestId, session);
    var delta = Number(data.delta);
    if (!delta || isNaN(delta)) throw new Error('Укажите, сколько бонусов добавить или списать.');
    var reason = String(data.reason || '').trim();
    if (!reason) throw new Error('Укажите причину корректировки.');
    _posBonusTxn_(g, 'корректировка', delta, '', reason, session);
    auditLog_(session.user_id, 'Корректировка бонусов', 'GUESTS:' + g.guest_id, null, delta + ': ' + reason, 'success', session.cascade_id || '');
    return posGetGuest_({ guestId: g.guest_id }, session);
  });
}

/** Удаление по запросу гостя (152-ФЗ): имя и телефон стираются, проводки остаются обезличенными. */
function posAnonymizeGuest_(data, session) {
  return withLock_(function () {
    var g = _posGuest_(data.guestId, session);
    updateRow_('GUESTS', g, { телефон: '', имя: 'Гость удалён', день_рождения: '', комментарий: '', статус: 'обезличен' });
    auditLog_(session.user_id, 'Гость обезличен по запросу', 'GUESTS:' + g.guest_id, null, null, 'success', session.cascade_id || '');
    return { guest_id: g.guest_id, статус: 'обезличен' };
  });
}

/** Сколько бонусов можно списать в этом заказе: не больше баланса и не больше N% суммы. */
function _posMaxBonus_(order, guest, settings) {
  if (!guest || !settings.включено) return 0;
  var cap = Math.floor((Number(order.сумма) || 0) * settings.макс_списание_процент / 100);
  return Math.max(0, Math.min(Math.floor(Number(guest.бонусы) || 0), cap));
}

// ---------- Чаевые (этап M7) ----------

/** https-ссылка без пробелов, до 300 символов. Сервис — домен ссылки (для подсказки в интерфейсе). */
function _posTipUrl_(raw) {
  var url = String(raw || '').trim();
  if (!url) return '';
  if (!/^https:\/\/[^\s\/]+\.[^\s\/]+(\/\S*)?$/i.test(url)) throw new Error('Ссылка на чаевые должна начинаться с https:// и не содержать пробелов.');
  if (url.length > 300) throw new Error('Слишком длинная ссылка на чаевые.');
  return url;
}

function _posTipLink_(userId, organizationId) {
  return findRows_('POS_TIP_LINKS', function (t) { return t.user_id === userId && t.organization_id === organizationId && t.ссылка; })[0] || null;
}

/** Менеджмент видит всех сотрудников точки; остальные — только себя. */
function posGetTipLinks_(session) {
  var admin = _posCanSeePd_(session);
  var links = {};
  findRows_('POS_TIP_LINKS', function (t) { return t.organization_id === session.organization_id; }).forEach(function (t) { links[t.user_id] = t; });
  return getAllRows_('USERS').filter(function (u) {
    if (u.organization_id !== session.organization_id || u.статус !== 'активен') return false;
    if (!admin) return u.user_id === session.user_id;
    return ['ОФИЦИАНТ', 'КАССИР', 'МЕНЕДЖЕР'].indexOf(u.роль) !== -1 || !!links[u.user_id];
  }).map(function (u) {
    var l = links[u.user_id];
    return { user_id: u.user_id, имя: u.имя, роль: u.роль, ссылка: l ? l.ссылка : '', сервис: l ? l.сервис : '', обновлено: l ? l.обновлено : '' };
  }).sort(function (a, b) { return String(a.имя).localeCompare(String(b.имя), 'ru'); });
}

function posSaveTipLink_(data, session) {
  return withLock_(function () {
    var userId = data.userId || session.user_id;
    if (userId !== session.user_id && !_posCanSeePd_(session)) throw new Error('Чужую ссылку на чаевые может изменить менеджер.');
    var user = findOne_('USERS', 'user_id', userId);
    assertOwnedByOrg_(session, user, 'USERS:' + userId);
    var url = _posTipUrl_(data.ссылка);
    var service = url ? url.replace(/^https:\/\//i, '').split('/')[0].toLowerCase() : '';
    var row = findRows_('POS_TIP_LINKS', function (t) { return t.user_id === userId && t.organization_id === session.organization_id; })[0];
    var patch = { ссылка: url, сервис: service, обновлено: nowIso_(), обновил_id: session.user_id };
    if (row) updateRow_('POS_TIP_LINKS', row, patch);
    else insertRow_('POS_TIP_LINKS', Object.assign({ tip_id: generateId_('POS_TIP_LINKS'), user_id: userId, organization_id: session.organization_id }, patch));
    auditLog_(session.user_id, 'Ссылка на чаевые', 'USERS:' + userId, null, url ? service : 'удалена', 'success', session.cascade_id || '');
    return { user_id: userId, имя: user.имя, ссылка: url, сервис: service };
  });
}

// ---------- QR-меню (этап M8) ----------

/**
 * Снимок меню точки для гостей: только то, что видно в зале — название, категория, цена,
 * выход, аллергены и пищевая ценность из утверждённой ТТК, варианты модификаторов.
 * Не попадают: блюда в стоп-листе и без цены, себестоимость, поставщики, сотрудники.
 */
function _posPublicMenuData_(organizationId, locationId) {
  var s = { organization_id: organizationId, location_id: locationId, роль: '' };
  var loc = findOne_('LOCATIONS', 'location_id', locationId);
  var stops = {};
  _posActiveStops_(s).forEach(function (x) { stops[x.dish_id] = true; });
  var cats = {};
  getAllRows_('CATEGORIES').forEach(function (c) { cats[c.category_id] = c.название; });
  var dishes = getDishes_(organizationId).filter(function (d) {
    return d.статус !== 'архив' && Number(d.цена_продажи) > 0 && !stops[d.dish_id];
  }).map(function (d) {
    var ttk = null;
    try { ttk = _ttkCurrent_(d.dish_id); } catch (e) { ttk = null; }
    return {
      id: d.dish_id, название: String(d.название), категория: cats[d.категория_id] || 'Другое', цена: round2_(Number(d.цена_продажи)),
      выход: Number(d.выход) || '', аллергены: ttk ? String(ttk.аллергенная_информация || '') : '', пищевая_ценность: ttk ? String(ttk.пищевая_ценность || '') : '',
      варианты: _posDishModifierGroups_(d.dish_id, organizationId).map(function (g) {
        return { группа: g.название, список: g.modifiers.map(function (m) { return { название: m.название, цена_delta: m.цена_delta }; }) };
      })
    };
  }).sort(function (a, b) { return a.категория === b.категория ? a.название.localeCompare(b.название, 'ru') : a.категория.localeCompare(b.категория, 'ru'); });
  var tables = {};
  findRows_('POS_TABLES', function (t) { return t.location_id === locationId && t.статус !== 'архив'; }).forEach(function (t) { tables[t.table_id] = String(t.название); });
  return { заведение: loc ? String(loc.название) : '', обновлено: nowIso_(), блюда: dishes, столы: tables };
}

function _posPublicMenuRow_(organizationId, locationId) {
  return findRows_('PUBLIC_MENU', function (r) { return r.organization_id === organizationId && r.location_id === locationId; })[0] || null;
}

/** Пересобирает снимок точки. Токен создаётся один раз и не меняется (иначе напечатанные QR перестанут работать). */
function _posPublishMenu_(organizationId, locationId) {
  var json = JSON.stringify(_posPublicMenuData_(organizationId, locationId));
  if (json.length > 45000) throw new Error('Меню слишком большое для одной ячейки таблицы — сократите описания или число блюд.');
  var row = _posPublicMenuRow_(organizationId, locationId);
  if (row) { updateRow_('PUBLIC_MENU', row, { json: json, обновлено: nowIso_() }); return findOne_('PUBLIC_MENU', 'menu_id', row.menu_id); }
  var created = { menu_id: generateId_('PUBLIC_MENU'), organization_id: organizationId, location_id: locationId,
    token: Utilities.getUuid().replace(/-/g, ''), json: json, обновлено: nowIso_(), включено: true };
  insertRow_('PUBLIC_MENU', created);
  return created;
}

function _posQrMenuUrl_(organizationId) {
  var row = _posSettingRow_(organizationId, 'qrmenu.url');
  return row ? String(row.значение || '') : '';
}

function posGetQrMenu_(session) {
  var row = _posPublicMenuRow_(session.organization_id, session.location_id);
  var url = _posQrMenuUrl_(session.organization_id);
  var data = null;
  try { data = row ? JSON.parse(row.json) : null; } catch (e) { data = null; }
  var tables = findRows_('POS_TABLES', function (t) { return t.location_id === session.location_id && t.organization_id === session.organization_id && t.статус !== 'архив'; })
    .map(function (t) { return { table_id: t.table_id, название: t.название, ссылка: url && row ? url + '?m=' + row.token + '&t=' + encodeURIComponent(t.table_id) : '' }; });
  return {
    url: url, включено: row ? row.включено !== false && String(row.включено) !== 'false' : false, опубликовано: row ? row.обновлено : '',
    ссылка_меню: url && row ? url + '?m=' + row.token : '', блюд: data ? data.блюда.length : 0, столы: tables
  };
}

function posPublishQrMenu_(session) {
  return withLock_(function () {
    _posPublishMenu_(session.organization_id, session.location_id);
    auditLog_(session.user_id, 'QR-меню опубликовано', 'PUBLIC_MENU:' + session.location_id, null, null, 'success', session.cascade_id || '');
    return posGetQrMenu_(session);
  });
}

/** Адрес развёрнутого публичного проекта qrmenu/ (…/exec) и включение меню точки. */
function posSaveQrMenuSettings_(data, session) {
  return withLock_(function () {
    var url = String(data.url || '').trim();
    if (url && !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)) {
      throw new Error('Вставьте адрес веб-приложения QR-меню вида https://script.google.com/macros/s/…/exec');
    }
    var row = _posSettingRow_(session.organization_id, 'qrmenu.url');
    if (row) updateRow_('SETTINGS', row, { значение: url });
    else insertRow_('SETTINGS', { organization_id: session.organization_id, location_id: '', ключ: 'qrmenu.url', значение: url });
    var menu = _posPublicMenuRow_(session.organization_id, session.location_id) || _posPublishMenu_(session.organization_id, session.location_id);
    if (data.включено !== undefined) updateRow_('PUBLIC_MENU', findOne_('PUBLIC_MENU', 'menu_id', menu.menu_id), { включено: !!data.включено });
    return posGetQrMenu_(session);
  });
}

/** Фон: обновить снимки всех точек, где меню уже опубликовано. */
function posRefreshPublicMenus_() {
  findRows_('PUBLIC_MENU', function () { return true; }).forEach(function (r) {
    try { withLock_(function () { _posPublishMenu_(r.organization_id, r.location_id); }); }
    catch (e) { logSystemError_('posRefreshPublicMenus_', r.organization_id, 'pos', e); }
  });
}

// ---------- Возвраты и отчёты (этап M5) ----------

/**
 * Возврат оплаченного заказа — полностью или по позициям. Деньги: строка POS_PAYMENTS с
 * отрицательной суммой в ТЕКУЩЕЙ смене (наличные выдаются из сегодняшней кассы). Выручка:
 * сторно-строка SALES с отрицательными qty и суммой (P&L «Экономики» складывает суммы).
 * Себестоимость не сторнируется: блюдо приготовлено, сырьё потрачено — это убыток, а не
 * возврат на склад. Оплаченный заказ не переписывается: строки получают статус «возврат».
 */
function posRefund_(data, session) {
  return withLock_(function () {
    var order = _posOrder_(data.orderId, session);
    if (order.статус !== 'оплачен') throw new Error(order.статус === 'возврат' ? 'По заказу уже сделан полный возврат.' : 'Вернуть можно только оплаченный заказ.');
    var reason = String(data.reason || '').trim();
    if (!reason) throw new Error('Укажите причину возврата.');
    var method = data.method || '';
    if (POS_PAYMENT_METHODS_.indexOf(method) === -1) throw new Error('Выберите, как вернуть деньги: наличными, на карту или другое.');
    var shift = _posRequireOpenShift_(session);
    var lines = findRows_('POS_ORDER_LINES', function (l) { return l.order_id === order.order_id && l.статус !== 'отменена' && l.статус !== 'возврат'; });
    var want = Array.isArray(data.lineIds) && data.lineIds.length ? data.lineIds : lines.map(function (l) { return l.line_id; });
    var picked = lines.filter(function (l) { return want.indexOf(l.line_id) !== -1; });
    if (picked.length !== want.length) throw new Error('Часть позиций уже возвращена или не относится к заказу.');
    if (!picked.length) throw new Error('Нет позиций для возврата.');
    // С учётом скидки бонусами: возвращаем долю оплаченного деньгами.
    var grossAll = Number(order.сумма) || 0, paidTotal = Number(order.итого) || 0;
    var kk = grossAll > 0 ? paidTotal / grossAll : 1;
    var pickedGross = 0;
    picked.forEach(function (l) { pickedGross += Number(l.сумма) || 0; });
    var isLast = picked.length === lines.length;
    var amount = isLast ? round2_(paidTotal - (Number(order.возвращено) || 0)) : round2_(pickedGross * kk);
    // Безнал нельзя вернуть больше, чем им было оплачено по этому заказу.
    if (method !== 'нал') {
      var paidBy = 0;
      findRows_('POS_PAYMENTS', function (p) { return p.order_id === order.order_id && p.способ === method; }).forEach(function (p) { paidBy += Number(p.сумма) || 0; });
      if (round2_(paidBy) < amount) throw new Error('Способом «' + method + '» по заказу оплачено ' + round2_(paidBy) + ' ₽ — вернуть ' + amount + ' ₽ этим способом нельзя.');
    }
    var now = nowIso_();
    var saleDate = _posShiftDate_(shift);
    picked.forEach(function (l) {
      var qty = Number(l.qty), price = round2_(Number(l.цена) * kk);
      insertRow_('SALES', {
        sale_id: generateId_('SALES'), organization_id: session.organization_id, location_id: session.location_id,
        dish_id: l.dish_id, qty: -qty, цена_продажи: round2_(price), сумма: round2_(-price * qty), себестоимость_на_момент: 0,
        источник: POS_SALE_SOURCE_ + '_возврат', внешний_id: l.line_id + '-R', дата: saleDate, user_id: session.user_id,
        создано: now, исполнение_статус: 'не_требуется', cascade_id: session.cascade_id || ''
      });
      updateRow_('POS_ORDER_LINES', l, { статус: 'возврат', возврат_в: now });
    });
    var pay = { payment_id: generateId_('POS_PAYMENTS'), order_id: order.order_id, organization_id: session.organization_id,
      location_id: session.location_id, shift_id: shift.shift_id, способ: method, сумма: -amount,
      operation_id: session.operation_id || data.operationId || '', создано: now, user_id: session.user_id, тип: 'возврат', причина: reason.slice(0, 200) };
    insertRow_('POS_PAYMENTS', pay);
    var refunded = round2_((Number(order.возвращено) || 0) + amount);
    var full = refunded >= round2_(Number(order.итого) || 0);
    // Бонусы: гостю возвращается доля списанных, начисленные за возвращённое — отменяются
    // (не ниже нуля: если гость уже потратил, недостающее пишется в причину проводки).
    if (order.guest_id) {
      var g = findOne_('GUESTS', 'guest_id', order.guest_id);
      if (g && g.статус !== 'обезличен') {
        var done = { возврат_списания: 0, отмена_начисления: 0 };
        findRows_('BONUS_TXNS', function (t) { return t.order_id === order.order_id && (t.тип in done); }).forEach(function (t) { done[t.тип] += Math.abs(Number(t.сумма) || 0); });
        var share = grossAll > 0 ? pickedGross / grossAll : 1;
        var spent = Number(order.бонусы_списано) || 0, acc = Number(order.бонусы_начислено) || 0;
        var back = isLast ? spent - done.возврат_списания : Math.floor(spent * share);
        var cancel = isLast ? acc - done.отмена_начисления : Math.floor(acc * share);
        if (back > 0) _posBonusTxn_(g, 'возврат_списания', back, order.order_id, 'Возврат по заказу №' + order.номер, session);
        if (cancel > 0) {
          var bal = Number(findOne_('GUESTS', 'guest_id', g.guest_id).бонусы) || 0;
          var can = Math.min(cancel, Math.floor(bal));
          if (can > 0) _posBonusTxn_(g, 'отмена_начисления', -can, order.order_id, 'Возврат по заказу №' + order.номер + (can < cancel ? ' (не хватило ' + (cancel - can) + ' — бонусы уже потрачены)' : ''), session);
        }
        updateRow_('GUESTS', findOne_('GUESTS', 'guest_id', g.guest_id), { всего_оплачено: round2_(Math.max(0, (Number(g.всего_оплачено) || 0) - amount)) });
      }
    }
    updateRow_('POS_ORDERS', order, { возвращено: refunded, статус: full ? 'возврат' : 'оплачен', version: (Number(order.version) || 0) + 1, обновлено: now });
    auditLog_(session.user_id, full ? 'Полный возврат заказа' : 'Частичный возврат заказа', 'POS_ORDERS:' + order.order_id, 'оплачен',
      amount + ' ₽, ' + method + ': ' + reason, 'success', session.cascade_id || '');
    return { order: findOne_('POS_ORDERS', 'order_id', order.order_id), lines: findRows_('POS_ORDER_LINES', function (l) { return l.order_id === order.order_id; }),
      возврат: amount, payment: pay };
  });
}

/** Смены точки за период (для отчётов и возвратов по прошлым сменам). */
function posGetShifts_(data, session) {
  var from = data.dateFrom || '', to = data.dateTo || '';
  return findRows_('POS_SHIFTS', function (s) {
    if (s.organization_id !== session.organization_id || s.location_id !== session.location_id) return false;
    var d = _posShiftDate_(s);
    return (!from || d >= from) && (!to || d <= to);
  }).sort(function (a, b) { return String(b.открыта).localeCompare(String(a.открыта)); }).map(function (s) {
    return { shift_id: s.shift_id, дата: _posShiftDate_(s), открыта: s.открыта, закрыта: s.закрыта, статус: s.статус, totals: _posShiftTotals_(s) };
  });
}

/**
 * Отчёт по сотрудникам за период: официант (кто вёл заказ) — заказы, продажи, средний чек;
 * кассир (кто принял деньги) — сколько принял по способам и сколько вернул.
 */
function posGetStaffReport_(data, session) {
  var from = data.dateFrom || todayDateStr_(), to = data.dateTo || from;
  var shifts = {};
  findRows_('POS_SHIFTS', function (s) { return s.organization_id === session.organization_id && s.location_id === session.location_id; })
    .forEach(function (s) { var d = _posShiftDate_(s); if (d >= from && d <= to) shifts[s.shift_id] = s; });
  var names = {}, roles = {};
  getAllRows_('USERS').forEach(function (u) { if (u.organization_id === session.organization_id) { names[u.user_id] = u.имя; roles[u.user_id] = u.роль; } });
  var waiters = {}, cashiers = {};
  findRows_('POS_ORDERS', function (o) { return shifts[o.shift_id] && (o.статус === 'оплачен' || o.статус === 'возврат'); }).forEach(function (o) {
    var w = waiters[o.официант_id] || (waiters[o.официант_id] = { user_id: o.официант_id, имя: names[o.официант_id] || o.официант_id, роль: roles[o.официант_id] || '', заказов: 0, продажи: 0, возвраты: 0, гостей: 0 });
    w.заказов++; w.продажи = round2_(w.продажи + (Number(o.итого) || 0)); w.возвраты = round2_(w.возвраты + (Number(o.возвращено) || 0)); w.гостей += Number(o.гостей) || 0;
  });
  findRows_('POS_PAYMENTS', function (p) { return shifts[p.shift_id]; }).forEach(function (p) {
    var c = cashiers[p.user_id] || (cashiers[p.user_id] = { user_id: p.user_id, имя: names[p.user_id] || p.user_id, роль: roles[p.user_id] || '', нал: 0, карта: 0, прочее: 0, возвраты: 0, чеков: 0 });
    var sum = Number(p.сумма) || 0;
    if (sum < 0) c.возвраты = round2_(c.возвраты - sum); else c.чеков++;
    c[p.способ] = round2_((c[p.способ] || 0) + sum);
  });
  var waiterList = Object.keys(waiters).map(function (k) { var w = waiters[k]; w.нетто = round2_(w.продажи - w.возвраты); w.средний_чек = w.заказов ? round2_(w.продажи / w.заказов) : 0; return w; })
    .sort(function (a, b) { return b.нетто - a.нетто; });
  var cashierList = Object.keys(cashiers).map(function (k) { var c = cashiers[k]; c.итого = round2_(c.нал + c.карта + c.прочее); return c; })
    .sort(function (a, b) { return b.итого - a.итого; });
  var total = { заказов: 0, продажи: 0, возвраты: 0 };
  waiterList.forEach(function (w) { total.заказов += w.заказов; total.продажи = round2_(total.продажи + w.продажи); total.возвраты = round2_(total.возвраты + w.возвраты); });
  total.нетто = round2_(total.продажи - total.возвраты);
  total.средний_чек = total.заказов ? round2_(total.продажи / total.заказов) : 0;
  return { from: from, to: to, смен: Object.keys(shifts).length, итого: total, официанты: waiterList, кассиры: cashierList };
}

/** Дописывает в существующие листы кассы колонки, добавленные в схему позже (только в конец). */
function migratePosSchema_() {
  var out = {};
  ['POS_SHIFTS', 'POS_ORDERS', 'POS_ORDER_LINES', 'POS_PAYMENTS', 'POS_HALLS', 'POS_TABLES', 'MODIFIER_GROUPS', 'MODIFIERS',
    'DISH_MODIFIER_LINKS', 'POS_MODIFIER_USAGE', 'STOP_LIST', 'GUESTS', 'BONUS_TXNS', 'POS_TIP_LINKS', 'PUBLIC_MENU', 'PREP_PARS', 'PREP_LISTS', 'TTK_ACKS', 'TRAINING_QUESTIONS', 'TRAINING_ATTEMPTS', 'FOODCOST_ALERTS'].forEach(function (k) {
    try { out[k] = ensureSchemaColumns_(k); } catch (e) { out[k] = 'нет листа — запустите initializeDatabase()'; }
  });
  return out;
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
  try { posRefreshPublicMenus_(); } catch (menuErr) { logSystemError_('posFulfillPendingSalesTrigger_', null, 'pos', menuErr); }
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
    'MODIFIER_GROUPS', 'MODIFIERS', 'DISH_MODIFIER_LINKS', 'POS_MODIFIER_USAGE', 'STOP_LIST', 'GUESTS', 'BONUS_TXNS', 'POS_TIP_LINKS', 'PUBLIC_MENU', 'PREP_PARS', 'PREP_LISTS', 'TTK_ACKS', 'TRAINING_QUESTIONS', 'TRAINING_ATTEMPTS', 'FOODCOST_ALERTS'].forEach(function (k) {
    ok('SCHEMA_' + k, Array.isArray(CONFIG.SCHEMA[k]) && CONFIG.SHEETS[k] === k && !!CONFIG.ID_PREFIXES[k], 'sheet, schema, id prefix');
  });
  ['POS_GET_MENU', 'POS_OPEN_SHIFT', 'POS_GET_SHIFT', 'POS_CLOSE_SHIFT', 'POS_CREATE_ORDER', 'POS_ADD_LINE', 'POS_UPDATE_LINE',
    'POS_GET_ORDER', 'POS_GET_ORDERS', 'POS_PAY', 'POS_CANCEL_ORDER', 'POS_FULFILL_PENDING',
    'POS_GET_FLOOR', 'POS_SEND_TO_KITCHEN', 'POS_PRECHECK', 'POS_MOVE_ORDER', 'POS_REOPEN_ORDER', 'POS_SAVE_HALL', 'POS_SAVE_TABLE',
    'POS_GET_KITCHEN_QUEUE', 'POS_MARK_LINE_READY',
    'POS_GET_MODIFIERS', 'POS_SAVE_MODIFIER_GROUP', 'POS_SAVE_MODIFIER', 'POS_LINK_DISH_MODIFIERS',
    'POS_GET_STOP_LIST', 'POS_SET_STOP', 'POS_CLEAR_STOP', 'POS_RECALC_STOP_LIST',
    'PREP_GET_LIST', 'PREP_BUILD_LIST', 'PREP_MARK_DONE', 'PREP_SKIP', 'PREP_GET_PARS', 'PREP_SAVE_PAR',
    'TRAINING_GET_MY', 'TRAINING_GET_CARD', 'TRAINING_ACK', 'TRAINING_START_QUIZ', 'TRAINING_SUBMIT_QUIZ', 'TRAINING_GET_MATRIX', 'TRAINING_GET_QUESTIONS', 'TRAINING_SAVE_QUESTION',
    'FC_GET_OVERVIEW', 'FC_CHECK_ALERTS', 'FC_GET_SETTINGS', 'FC_SAVE_SETTINGS', 'FC_USE_TODAY',
    'POS_REFUND', 'POS_GET_STAFF_REPORT', 'POS_GET_SHIFTS',
    'POS_FIND_GUEST', 'POS_SAVE_GUEST', 'POS_ATTACH_GUEST', 'POS_GET_GUEST', 'POS_GET_GUESTS', 'POS_ADJUST_BONUS',
    'POS_ANONYMIZE_GUEST', 'POS_GET_LOYALTY_SETTINGS', 'POS_SAVE_LOYALTY_SETTINGS', 'POS_GET_TIP_LINKS', 'POS_SAVE_TIP_LINK',
    'POS_GET_QRMENU', 'POS_PUBLISH_QRMENU', 'POS_SAVE_QRMENU_SETTINGS', 'POS_DISCARD_EMPTY_ORDER'].forEach(function (a) {
    ok('ACTION_' + a, typeof ACTION_HANDLERS[a] === 'function' && !!CONFIG.ACTION_MODULE[a], 'handler + module');
  });
  ok('ROLES', CONFIG.ROLE_LIST.indexOf('КАССИР') !== -1 && CONFIG.ROLE_LIST.indexOf('ОФИЦИАНТ') !== -1, 'new roles registered');
  ok('SCHEDULER', TRIGGER_SCHEDULE_.tick15m_.indexOf('posFulfillPendingSalesTrigger_') !== -1, 'fulfillment job in 15m tick');
  ok('FULFILLMENT', typeof fulfillSaleByTtk_ === 'function' && typeof createSale_ === 'function', 'sales pipeline available');
  ok('ECONOMICS', typeof recordCashTransaction_ === 'function', 'cash transactions for shift totals');
  // Заголовки листов должны совпадать со схемой по порядку: insertRow_ пишет в порядке схемы.
  // Если FAIL — запустите migratePosSchema_() (дописывает недостающие колонки в конец).
  ['POS_SHIFTS', 'POS_ORDERS', 'POS_ORDER_LINES', 'POS_PAYMENTS'].forEach(function (k) {
    try {
      var head = getSheet_(k).getRange(1, 1, 1, CONFIG.SCHEMA[k].length).getValues()[0];
      ok('COLUMNS_' + k, CONFIG.SCHEMA[k].every(function (h, i) { return head[i] === h; }), 'sheet headers match schema order');
    } catch (e) { ok('COLUMNS_' + k, false, String(e.message || e)); }
  });
  return out;
}
