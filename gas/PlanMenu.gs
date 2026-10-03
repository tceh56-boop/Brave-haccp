// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — PlanMenu.gs («План-меню», новый модуль)
 * Планирование банкетов/мероприятий — намеренно названо «План-меню» (не "Банкеты") по
 * прямому указанию заказчика. Логика: создаётся мероприятие с числом гостей → в него
 * добавляются блюда меню с нормой порций на гостя → система считает порции ИТОГО, а
 * затем — по тем же рецептурам (Recipes.gs), что и обычное производство — сколько сырья
 * нужно на всё мероприятие, и сверяет это с текущим остатком на точке (ТЗ, принцип
 * "одно заполнение → пересчёт всей системы": ввели гостей и блюда — получили полную
 * потребность в продуктах и видимую нехватку, без ручного пересчёта на калькуляторе).
 *
 * Явно НЕ автоматизировано: система не создаёт закупку сама при каждом пересчёте —
 * расчёт потребности можно смотреть сколько угодно раз (это просто вывод чисел), а
 * реальная заявка на закупку нехватающего создаётся отдельным явным действием
 * (generatePlanMenuPurchaseRequests_), чтобы не плодить заявки на каждый чих.
 */

function createPlanMenuEvent_(data, userId) {
  if (!data.organization_id || !data.location_id) throw new Error('createPlanMenuEvent_: organization_id и location_id обязательны.');
  if (!data.название) throw new Error('Укажите название мероприятия.');
  var guests = Number(data.гостей);
  if (!guests || guests <= 0) throw new Error('Укажите число гостей больше нуля.');
  var event = {
    event_id: generateId_('PLAN_MENU_EVENTS'),
    organization_id: data.organization_id,
    location_id: data.location_id,
    название: data.название,
    дата: data.дата || '',
    время: data.время || '',
    гостей: guests,
    статус: 'план',
    ответственный_id: data.ответственный_id || userId || '',
    создано: nowIso_()
  };
  insertRow_('PLAN_MENU_EVENTS', event);
  auditLog_(userId, 'Создано мероприятие План-меню', 'PLAN_MENU_EVENTS:' + event.event_id, null, event.название + ' / ' + guests + ' гостей', 'success');
  return event;
}

function getPlanMenuEvents_(locationId) {
  return findRows_('PLAN_MENU_EVENTS', function (r) { return !locationId || r.location_id === locationId; })
    .sort(function (a, b) { return new Date(b.создано) - new Date(a.создано); });
}

function getPlanMenuEventById_(eventId) {
  return findOne_('PLAN_MENU_EVENTS', 'event_id', eventId);
}

/** Добавляет блюдо в меню мероприятия: порций_итого пересчитывается сразу при добавлении/изменении гостей. */
function addPlanMenuItem_(eventId, dishId, порцийНаГостя, userId, session) {
  var event = getPlanMenuEventById_(eventId);
  if (session) assertOwnedByOrgAndLocation_(session, event, 'PLAN_MENU_EVENTS:' + eventId); // ТЗ P0.1
  else if (!event) throw new Error('Мероприятие не найдено: ' + eventId);
  if (session) assertOwnedByOrg_(session, findOne_('DISHES', 'dish_id', dishId), 'DISHES:' + dishId); // ТЗ P0.1 — блюдо тоже может быть чужим
  var perGuest = Number(порцийНаГостя) || 1;
  var item = {
    item_id: generateId_('PLAN_MENU_ITEMS'),
    event_id: eventId,
    dish_id: dishId,
    порций_на_гостя: perGuest,
    порций_итого: Math.ceil(perGuest * Number(event.гостей))
  };
  insertRow_('PLAN_MENU_ITEMS', item);
  auditLog_(userId, 'Добавлено блюдо в План-меню', 'PLAN_MENU_EVENTS:' + eventId, null, dishId + ' x' + item.порций_итого, 'success');
  return item;
}

function getPlanMenuItems_(eventId, session) {
  // РАУНД 10: раньше не было способа вернуть список позиций меню мероприятия клиенту —
  // функция вызывалась только внутри других функций этого файла. Добавлен необязательный
  // session для того же паттерна проверки владения, что и у соседних функций этого файла,
  // чтобы GET_PLAN_MENU_ITEMS (API.gs) не отдавал позиции чужого мероприятия.
  var event = getPlanMenuEventById_(eventId);
  if (session) assertOwnedByOrgAndLocation_(session, event, 'PLAN_MENU_EVENTS:' + eventId); // ТЗ P0.1
  else if (!event) throw new Error('Мероприятие не найдено: ' + eventId);
  return findRows_('PLAN_MENU_ITEMS', function (r) { return r.event_id === eventId; });
}

/**
 * Смена числа гостей мероприятия ПЕРЕСЧИТЫВАЕТ порции у всех уже добавленных блюд —
 * это и есть "одно заполнение → пересчёт всей системы" для План-меню.
 */
function updatePlanMenuGuests_(eventId, newGuestCount, userId, session) {
  var event = getPlanMenuEventById_(eventId);
  if (session) assertOwnedByOrgAndLocation_(session, event, 'PLAN_MENU_EVENTS:' + eventId); // ТЗ P0.1
  else if (!event) throw new Error('Мероприятие не найдено: ' + eventId);
  var guests = Number(newGuestCount);
  if (!guests || guests <= 0) throw new Error('Число гостей должно быть больше нуля.');
  updateRow_('PLAN_MENU_EVENTS', event, { гостей: guests });
  getPlanMenuItems_(eventId).forEach(function (item) {
    updateRow_('PLAN_MENU_ITEMS', item, { порций_итого: Math.ceil(Number(item.порций_на_гостя) * guests) });
  });
  auditLog_(userId, 'Изменено число гостей План-меню', 'PLAN_MENU_EVENTS:' + eventId, event.гостей, guests, 'success');
  return { event_id: eventId, гостей: guests, позиций_пересчитано: getPlanMenuItems_(eventId).length };
}

/**
 * Считает суммарную потребность в сырье по всем блюдам мероприятия (используя ТЕ ЖЕ
 * рецептуры, что и обычное производство/себестоимость — Recipes.gs::getRecipeLines_/
 * normalizeQty_), сравнивает с текущим остатком точки и возвращает нехватку по каждому
 * ингредиенту. Чисто расчётная функция — ничего не пишет и не меняет.
 */
function calcPlanMenuNeeds_(eventId, session) {
  var event = getPlanMenuEventById_(eventId);
  if (session) assertOwnedByOrgAndLocation_(session, event, 'PLAN_MENU_EVENTS:' + eventId); // ТЗ P0.1
  else if (!event) throw new Error('Мероприятие не найдено: ' + eventId);
  var items = getPlanMenuItems_(eventId);
  var needed = {}; // product_id -> { qty, единица }

  function addNeed_(productId, qty, unit) {
    if (!needed[productId]) needed[productId] = { qty: 0, единица: unit };
    needed[productId].qty += qty;
  }

  items.forEach(function (item) {
    var lines = getRecipeLines_('DISH', item.dish_id);
    lines.forEach(function (line) {
      var qtyBase = normalizeQty_(Number(line.брутто) || 0, line.единица) * Number(item.порций_итого);
      if (String(line.product_id).indexOf('PF-') === 0) {
        // ПФ разворачиваем на один уровень в его собственное сырьё, чтобы потребность была в закупаемых продуктах
        var pfLines = getRecipeLines_('PF', line.product_id);
        var pf = getSemiFinishedById_(line.product_id);
        var pfYield = pf && pf.выход > 0 ? Number(pf.выход) : 1;
        var pfBatches = qtyBase / pfYield;
        pfLines.forEach(function (pfLine) {
          var pfQty = normalizeQty_(Number(pfLine.брутто) || 0, pfLine.единица) * pfBatches;
          addNeed_(pfLine.product_id, pfQty, pfLine.единица === 'г' || pfLine.единица === 'мл' ? (pfLine.единица === 'г' ? 'кг' : 'л') : pfLine.единица);
        });
      } else {
        addNeed_(line.product_id, qtyBase, line.единица === 'г' || line.единица === 'мл' ? (line.единица === 'г' ? 'кг' : 'л') : line.единица);
      }
    });
  });

  var report = Object.keys(needed).map(function (productId) {
    var product = getProductById_(productId);
    var available = getStockLevel_(productId, event.location_id);
    var need = needed[productId].qty;
    return {
      product_id: productId,
      название: product ? product.название : productId,
      единица: needed[productId].единица,
      нужно: round2_(need),
      в_наличии: round2_(available),
      нехватка: round2_(Math.max(0, need - available))
    };
  }).sort(function (a, b) { return b.нехватка - a.нехватка; });

  return { event_id: eventId, гостей: event.гостей, позиций_меню: items.length, потребность: report, есть_нехватка: report.some(function (r) { return r.нехватка > 0.0001; }) };
}

/** Явное действие: создать заявки на закупку по всем нехваткам расчёта (не выполняется автоматически). */
function generatePlanMenuPurchaseRequests_(eventId, userId, session) {
  var needs = calcPlanMenuNeeds_(eventId, session); // ТЗ P0.1 — проверка принадлежности мероприятия уже здесь
  var event = getPlanMenuEventById_(eventId);
  var created = [];
  needs.потребность.forEach(function (row) {
    if (row.нехватка > 0.0001) {
      created.push(createPurchaseRequest_(event.location_id, row.product_id, row.нехватка, userId, session));
    }
  });
  auditLog_(userId, 'Созданы заявки под План-меню', 'PLAN_MENU_EVENTS:' + eventId, null, created.length + ' заявок', 'success');
  return { создано_заявок: created.length, заявки: created };
}
