// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Economics.gs
 * Сводная экономика и Dashboard (ТЗ §11-12). Всё здесь — производные показатели,
 * читаемые из первичных листов (WAREHOUSE_OPS/WRITE_OFFS/DISHES/…), а не вводимые
 * руками (ТЗ §11: "не хранить вручную введённые итоговые показатели").
 * CALCULATIONS используется только как КЭШ последнего расчёта для истории/графиков —
 * повторный вызов recalcEconomics_ всегда пересчитывает из первичных данных заново.
 */

function _todayRows_(rows, dateField) {
  var todayStr = new Date().toDateString();
  return rows.filter(function (r) { return new Date(r[dateField]).toDateString() === todayStr; });
}

/**
 * P0.7 — НАЙДЕНА И ИСПРАВЛЕНА КРИТИЧЕСКАЯ УТЕЧКА МЕЖДУ ОРГАНИЗАЦИЯМИ: до этого раунда
 * функция принимала ТОЛЬКО locationId, а средний_food_cost/средняя_маржа/стоимость_склада
 * считались по `findRows_('DISHES', ...)`/`findRows_('PRODUCTS', ...)` БЕЗ фильтра по
 * organization_id вообще — то есть по ВСЕМ блюдам и ВСЕМ продуктам ВСЕХ организаций в
 * системе разом. Средний food cost на дашборде организации А был на самом деле средним
 * по блюдам А, Б, В… всех арендаторов сразу; стоимость склада (при вызове без конкретной
 * точки — см. GET_ECONOMICS/UPDATE_PRODUCT_PRICE/CREATE_WRITEOFF ниже) суммировала
 * складскую стоимость ЧУЖИХ организаций в один общий показатель. Это тот же класс дыры,
 * что и все P0.1-подмены ID, только не через клиентский параметр, а через отсутствие
 * фильтра там, где он был очевидно нужен — GET_PRODUCTS/getProducts_ в этом же файле
 * (см. критические_остатки выше) org-фильтр применяет, а этот расчёт — нет. Теперь
 * organization_id обязателен и фильтрует обе выборки.
 */
/**
 * Раунд 12 (P0.5, §46) — добавлен необязательный cascadeId: до этого раунда каждая
 * CALCULATIONS-строка была орфанной записью — не было способа найти одним фильтром
 * "какой именно пересчёт экономики породила ЭТА операция списания/смены цены". Читающие
 * вызовы (GET_ECONOMICS/GET_DASHBOARD) не мутируют и законно не имеют cascade — параметр
 * необязателен именно для них, а не оставлен пустым по недосмотру.
 */
function recalcEconomics_(organizationId, locationId, cascadeId) {
  var writeoffs = getWriteOffs_(locationId, null);
  var todayWriteoffs = _todayRows_(writeoffs, 'дата');
  var writeoffSum = todayWriteoffs.reduce(function (s, w) { return s + Number(w.сумма); }, 0);

  var dishes = findRows_('DISHES', function (r) { return r.organization_id === organizationId && r.статус !== 'архив'; });
  var avgFoodCost = dishes.length
    ? round2_(dishes.reduce(function (s, d) { return s + Number(d.food_cost || 0); }, 0) / dishes.length)
    : 0;
  var avgMargin = dishes.length ? round2_(100 - avgFoodCost) : 0;

  var products = findRows_('PRODUCTS', function (r) { return r.organization_id === organizationId && r.активность === 'да'; });
  var stockValue = 0;
  products.forEach(function (p) {
    var locs = locationId ? [locationId] : uniqueLocationsForProduct_(p.product_id);
    locs.forEach(function (loc) { stockValue += getStockLevel_(p.product_id, loc) * Number(p.текущая_цена || 0); });
  });

  var snapshot = {
    объект_тип: 'LOCATION',
    // P0.7 — было "locationId || 'ВСЕ'": для двух РАЗНЫХ организаций, каждая из которых
    // хоть раз вызывает расчёт "по всей организации" (locationId не задан), обе получали
    // бы CALCULATIONS-строку с ОДИНАКОВЫМ объект_id='ВСЕ', неотличимую по организации —
    // латентная ловушка на будущее (докстринг файла явно обещает, что CALCULATIONS будет
    // читаться как история/график). Сейчас это ничем не читается обратно (см. отчёт
    // раунда), но раз organizationId уже есть параметром — закрываю и это заодно, а не
    // оставляю мину для того, кто первым напишет чтение истории.
    объект_id: locationId || organizationId || 'ВСЕ',
    списания_сегодня: round2_(writeoffSum),
    средний_food_cost: avgFoodCost,
    средняя_маржа: avgMargin,
    стоимость_склада: round2_(stockValue),
    дата_расчёта: nowIso_()
  };

  insertRow_('CALCULATIONS', {
    calculation_id: generateId_('CALCULATIONS'),
    объект_тип: snapshot.объект_тип,
    объект_id: snapshot.объект_id,
    тип_расчёта: 'экономика_сводная',
    значение: JSON.stringify(snapshot),
    дата_расчёта: snapshot.дата_расчёта,
    cascade_id: cascadeId || ''
  });

  return snapshot;
}

/** Точки, где у продукта вообще есть движение — чтобы не суммировать остаток по всем точкам организации без нужды. */
function uniqueLocationsForProduct_(productId) {
  var ops = findRows_('WAREHOUSE_OPS', function (r) { return r.product_id === productId; });
  var set = {};
  ops.forEach(function (o) { set[o.location_id] = true; });
  return Object.keys(set);
}

/**
 * Данные для главного экрана (ТЗ §12) — один вызов вместо десятка отдельных запросов с
 * фронтенда.
 *
 * P0.7 — НАЙДЕНА И ИСПРАВЛЕНА ТА ЖЕ УТЕЧКА МЕЖДУ ОРГАНИЗАЦИЯМИ, ЧТО И В recalcEconomics_
 * ВЫШЕ, только для org-wide вызова (locationId не задан — например, до выбора точки).
 * getProductionTasks_/getPurchaseRequests_/getNotifications_ при пустом locationId
 * возвращают ВСЕ строки СВОЕЙ таблицы БЕЗ фильтра вообще (штатное и корректное поведение
 * для остальных вызывающих — у них session.location_id всегда задан, см. API.gs) — но
 * здесь, при org-wide дашборде, это означало счётчики "открытых задач"/"заявок",
 * посчитанные по ВСЕМ организациям сразу, и, хуже того, ТЕКСТ последних 10 уведомлений
 * (уведомления: unreadNotifications.slice(0, 10)) — реальное содержимое, включая чужие
 * организации, а не просто число.
 */
function getDashboard_(organizationId, locationId) {
  var economics = recalcEconomics_(organizationId, locationId);
  var products = getProducts_(organizationId);
  var criticalStock = products.filter(function (p) {
    return locationId ? getStockLevel_(p.product_id, locationId) < Number(p.мин_остаток) : false;
  });

  // Точки СВОЕЙ организации — нужны, только чтобы сузить org-wide выборку ниже; при
  // конкретной точке (locationId задан) не используется вовсе.
  var orgLocationIds = locationId ? null : getLocations_(organizationId).map(function (l) { return l.location_id; });
  function inOrgScope_(rowLocationId) {
    return locationId ? rowLocationId === locationId : orgLocationIds.indexOf(rowLocationId) !== -1;
  }

  var openTasks = getProductionTasks_(locationId, null).filter(function (t) { return t.статус !== 'готово' && inOrgScope_(t.location_id); });
  var pendingJournals = locationId ? getPendingAutoJournals_(locationId) : [];
  var openPurchaseRequests = getPurchaseRequests_(locationId).filter(function (r) { return OPEN_REQUEST_STATUSES.indexOf(r.статус) !== -1 && inOrgScope_(r.location_id); });
  var unreadNotifications = getNotifications_(locationId, true).filter(function (n) { return locationId ? true : n.organization_id === organizationId; });

  return {
    экономика: economics,
    критические_остатки: criticalStock.map(function (p) { return { product_id: p.product_id, название: p.название, остаток: round2_(getStockLevel_(p.product_id, locationId)), мин_остаток: p.мин_остаток }; }),
    задачи_производства_открытые: openTasks.length,
    журналы_ожидают: pendingJournals.length,
    заявки_на_закупку_открытые: openPurchaseRequests.length,
    уведомления_непрочитанные: unreadNotifications.length,
    уведомления: unreadNotifications.slice(0, 10)
  };
}

/**
 * Раунд 11 — НАЙДЕНО ПРИ АУДИТЕ (честно указано в отчёте раунда 10, п. "история/график
 * экономики во времени"): CALCULATIONS накапливает строку-снимок ПРИ КАЖДОМ вызове
 * recalcEconomics_/getDashboard_ (докстринг файла: "используется только как КЭШ
 * последнего расчёта для истории/графиков") с самого раннего раунда — но ни одной
 * функции, читающей эти накопленные строки обратно, в проекте не было НИ РАЗУ. Данные
 * копились молча и были недоступны. Здесь — первое чтение: история снимков по
 * organizationId/(опционально)locationId за период, для графика на фронтенде.
 * P0.7 (тот же принцип, что и в recalcEconomics_ выше) — объект_id снимка это либо
 * locationId, либо organizationId (при org-wide вызове), поэтому фильтр по
 * organizationId здесь опирается на то, что объект_id — глобально уникальный ID
 * (LOC.../ORG...), а не на отдельное поле organization_id в самой таблице CALCULATIONS
 * (в её схеме такого поля нет — ТЗ §... фиксированная схема с раунда 1, менять её
 * задним числом ради одного нового чтения — лишний риск, объект_id уже достаточен).
 */
function getCalculationsHistory_(organizationId, locationId, dateFrom, dateTo) {
  var targetId = locationId || organizationId;
  var rows = findRows_('CALCULATIONS', function (r) {
    if (r.тип_расчёта !== 'экономика_сводная') return false;
    if (r.объект_id !== targetId) return false;
    if (dateFrom && String(r.дата_расчёта) < dateFrom) return false;
    if (dateTo && String(r.дата_расчёта) > dateTo + 'T23:59:59') return false;
    return true;
  });
  return rows
    .map(function (r) { return JSON.parse(r.значение || '{}'); })
    .sort(function (a, b) { return new Date(a.дата_расчёта) - new Date(b.дата_расчёта); });
}
