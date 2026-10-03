// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — DemandPlanning.gs
 * Stage 20: Demand & Procurement Engine.
 *
 * Принцип: прогноз — рекомендация, а не молчаливая мутация склада.
 * Продажи -> прогноз блюд -> потребность сырья по рецептурам -> FEFO-остаток
 * -> открытые закупки -> чистая потребность. Создание production plan / purchase
 * requests выполняется отдельным явным действием пользователя.
 */

function _dpDate_(v) { return String(v || '').slice(0, 10); }
function _dpNum_(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
function _dpDays_(from, to) {
  var a = new Date(from + 'T00:00:00Z').getTime(), b = new Date(to + 'T00:00:00Z').getTime();
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}
function _dpAddDays_(date, days) {
  var d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

/** FEFO-доступный остаток: только активные, не просроченные и не заблокированные партии. */
function _dpFefoStock_(productId, locationId, asOfDate) {
  var rows = findRows_('BATCHES', function (b) {
    if (b.product_id !== productId || b.location_id !== locationId) return false;
    if (String(b.статус || '').toUpperCase().indexOf('БЛОК') !== -1) return false;
    var expiry = _dpDate_(b.срок_годности);
    if (expiry && expiry < asOfDate) return false;
    return _dpNum_(b.количество) > 0;
  }).map(function (b) {
    return { batch_id: b.batch_id, qty: Math.max(0, _dpNum_(typeof getBatchRemaining_ === 'function' ? getBatchRemaining_(b) : b.количество)), expiry: _dpDate_(b.срок_годности), price: _dpNum_(b.цена_прихода) };
  }).filter(function (x) { return x.qty > 0; }).sort(function (a, b) {
    if (!a.expiry) return 1; if (!b.expiry) return -1; return a.expiry.localeCompare(b.expiry);
  });
  return { qty: round2_(rows.reduce(function (s, x) { return s + x.qty; }, 0)), batches: rows };
}

function _dpOpenPurchaseQty_(locationId, productId) {
  var statuses = ['новая', 'в обработке', 'отправлена'];
  return round2_(findRows_('PURCHASE_REQUESTS', function (r) {
    return r.location_id === locationId && r.product_id === productId && statuses.indexOf(String(r.статус)) !== -1;
  }).reduce(function (s, r) { return s + _dpNum_(r.количество); }, 0));
}

function _dpDishForecast_(organizationId, locationId, from, to, horizonDays, safetyPct) {
  var sales = getSales_(organizationId, locationId, from, to);
  var byDish = {};
  sales.forEach(function (s) {
    if (!byDish[s.dish_id]) byDish[s.dish_id] = { dish_id: s.dish_id, sold: 0, revenue: 0 };
    byDish[s.dish_id].sold += _dpNum_(s.qty);
    byDish[s.dish_id].revenue += _dpNum_(s.сумма);
  });
  var days = _dpDays_(from, to);
  return Object.keys(byDish).map(function (id) {
    var dish = findOne_('DISHES', 'dish_id', id);
    var avg = byDish[id].sold / days;
    var forecast = avg * horizonDays * (1 + safetyPct / 100);
    return {
      dish_id: id,
      название: dish ? dish.название : id,
      исторические_продажи: round2_(byDish[id].sold),
      средние_продажи_в_день: round2_(avg),
      прогноз_порций: round2_(forecast),
      выручка_истории: round2_(byDish[id].revenue)
    };
  }).sort(function (a, b) { return b.прогноз_порций - a.прогноз_порций; });
}

function _dpAddIngredientNeed_(needs, productId, qty, unit) {
  if (!productId || qty <= 0) return;
  if (!needs[productId]) needs[productId] = { qty: 0, unit: unit || '' };
  needs[productId].qty += qty;
}

/** Разворачивает рецепт блюда на закупаемое сырьё; ПФ — один уровень глубины, как в План-меню. */
function _dpExpandDish_(dishId, portions, needs) {
  getRecipeLines_('DISH', dishId).forEach(function (line) {
    var qty = normalizeQty_(_dpNum_(line.брутто), line.единица) * portions;
    if (String(line.product_id).indexOf('PF-') === 0) {
      var pf = getSemiFinishedById_(line.product_id);
      var yieldQty = pf && _dpNum_(pf.выход) > 0 ? _dpNum_(pf.выход) : 1;
      var pfLines = getRecipeLines_('PF', line.product_id);
      pfLines.forEach(function (pfLine) {
        var base = normalizeQty_(_dpNum_(pfLine.брутто), pfLine.единица) * (qty / yieldQty);
        _dpAddIngredientNeed_(needs, pfLine.product_id, base, pfLine.единица);
      });
    } else {
      _dpAddIngredientNeed_(needs, line.product_id, qty, line.единица);
    }
  });
}

function calculateDemandPlan_(data, session) {
  var from = data.dateFrom || _dpAddDays_(todayDateStr_(), -13);
  var to = data.dateTo || todayDateStr_();
  var horizon = Math.max(1, Number(data.horizonDays || 1));
  var safetyPct = Math.max(0, Number(data.safetyStockPct || 0));
  var locationId = data.locationId || session.location_id;
  if (locationId && session.location_id && locationId !== session.location_id) throw new Error('Нельзя строить план для другой точки.');

  var forecasts = _dpDishForecast_(session.organization_id, locationId, from, to, horizon, safetyPct);
  var needs = {};
  forecasts.forEach(function (f) { _dpExpandDish_(f.dish_id, f.прогноз_порций, needs); });

  var products = Object.keys(needs).map(function (productId) {
    var p = getProductById_(productId);
    if (!p || p.organization_id !== session.organization_id) throw new Error('Продукт рецептуры не принадлежит организации: ' + productId);
    var stock = _dpFefoStock_(productId, locationId, to);
    var openPurchase = _dpOpenPurchaseQty_(locationId, productId);
    var minStock = _dpNum_(p.мин_остаток);
    var grossNeed = needs[productId].qty;
    var net = Math.max(0, grossNeed + minStock - stock.qty - openPurchase);
    return {
      product_id: productId, название: p.название, единица: p.единица || needs[productId].unit,
      потребность: round2_(grossNeed), fefo_остаток: stock.qty, минимальный_остаток: round2_(minStock),
      открытые_закупки: openPurchase, чистая_потребность: round2_(net),
      поставщик_id: p.поставщик_id || '', закупочная_цена: _dpNum_(p.текущая_цена),
      ориентировочная_закупка: round2_(net * _dpNum_(p.текущая_цена)),
      fefo_партии: stock.batches.slice(0, 5)
    };
  }).sort(function (a, b) { return b.чистая_потребность - a.чистая_потребность; });

  return {
    параметры: { с: from, по: to, горизонт_дней: horizon, страховой_запас_pct: safetyPct, location_id: locationId },
    блюда: forecasts,
    продукты: products,
    итоги: {
      блюд: forecasts.length,
      продуктов: products.length,
      к_закупке: products.filter(function (x) { return x.чистая_потребность > 0; }).length,
      ориентировочная_сумма_закупки: round2_(products.reduce(function (s, x) { return s + x.ориентировочная_закупка; }, 0))
    }
  };
}

function createDemandPlan_(data, session) {
  return withLock_(function () {
    var calc = calculateDemandPlan_(data || {}, session);
    var plan = {
      plan_id: generateId_('DEMAND_PLANS'), organization_id: session.organization_id,
      location_id: calc.параметры.location_id, date_from: calc.параметры.с, date_to: calc.параметры.по,
      horizon_days: calc.параметры.горизонт_дней, safety_stock_pct: calc.параметры.страховой_запас_pct,
      status: 'DRAFT', created_at: nowIso_(), created_by: session.user_id, approved_at: '', approved_by: ''
    };
    insertRow_('DEMAND_PLANS', plan);
    calc.блюда.forEach(function (x) {
      insertRow_('DEMAND_PLAN_DISH_LINES', { line_id: generateId_('DEMAND_PLAN_DISH_LINES'), plan_id: plan.plan_id, organization_id: session.organization_id, location_id: plan.location_id, dish_id: x.dish_id, forecast_qty: x.прогноз_порций, historical_qty: x.исторические_продажи, avg_daily_qty: x.средние_продажи_в_день, status: 'PLANNED', production_id: '', created_at: nowIso_() });
    });
    calc.продукты.forEach(function (x) {
      insertRow_('DEMAND_PLAN_PRODUCT_LINES', { line_id: generateId_('DEMAND_PLAN_PRODUCT_LINES'), plan_id: plan.plan_id, organization_id: session.organization_id, location_id: plan.location_id, product_id: x.product_id, demand_qty: x.потребность, fefo_stock_qty: x.fefo_остаток, open_purchase_qty: x.открытые_закупки, net_purchase_qty: x.чистая_потребность, estimated_cost: x.ориентировочная_закупка, supplier_id: x.поставщик_id, status: x.чистая_потребность > 0 ? 'RECOMMENDED' : 'COVERED', purchase_request_id: '', created_at: nowIso_() });
    });
    auditLog_(session.user_id, 'Создан план спроса и закупок', 'DEMAND_PLANS:' + plan.plan_id, null, JSON.stringify(calc.итоги), 'success', session.cascade_id || '');
    return getDemandPlan_(plan.plan_id, session);
  });
}

function getDemandPlan_(planId, session) {
  var plan = findOne_('DEMAND_PLANS', 'plan_id', planId);
  _peOwned_(session, plan, 'DEMAND_PLANS:' + planId);
  return {
    plan: plan,
    dishes: findRows_('DEMAND_PLAN_DISH_LINES', function (r) { return r.plan_id === planId; }),
    products: findRows_('DEMAND_PLAN_PRODUCT_LINES', function (r) { return r.plan_id === planId; })
  };
}

/** Явное подтверждение: создаёт только недостающие заявки, не дублируя открытые. */
function releaseDemandPurchases_(planId, session) {
  return withLock_(function () {
    var bundle = getDemandPlan_(planId, session);
    if (bundle.plan.status === 'CANCELLED') throw new Error('План отменён.');
    var created = [];
    bundle.products.forEach(function (line) {
      if (_dpNum_(line.net_purchase_qty) <= 0 || line.purchase_request_id) return;
      var result = createPurchaseRequest_(bundle.plan.location_id, line.product_id, line.net_purchase_qty, session.user_id, session);
      if (result && result.request_id) {
        updateRow_('DEMAND_PLAN_PRODUCT_LINES', line, { purchase_request_id: result.request_id, status: result.создана === false ? 'ALREADY_OPEN' : 'PURCHASE_REQUEST_CREATED' });
        created.push(result);
      }
    });
    updateRow_('DEMAND_PLANS', bundle.plan, { status: 'PURCHASES_RELEASED', approved_at: nowIso_(), approved_by: session.user_id });
    auditLog_(session.user_id, 'План спроса передан в закупку', 'DEMAND_PLANS:' + planId, null, created.length + ' заявок', 'success', session.cascade_id || '');
    return getDemandPlan_(planId, session);
  });
}

/** Явное подтверждение: создаёт production plan по прогнозу блюд. */
function releaseDemandProduction_(planId, session) {
  return withLock_(function () {
    var bundle = getDemandPlan_(planId, session);
    var items = bundle.dishes.filter(function (x) { return _dpNum_(x.forecast_qty) > 0 && !x.production_id; }).map(function (x) { return { dishId: x.dish_id, qty: x.forecast_qty, unit: 'шт', priority: 0 }; });
    if (!items.length) return { plan: bundle.plan, production: null, message: 'Нет новых позиций для производства.' };
    var production = createProductionPlan_({ planDate: bundle.plan.date_from, workshopId: '', items: items }, session);
    updateRow_('DEMAND_PLANS', bundle.plan, { status: 'PRODUCTION_PLAN_CREATED', approved_at: nowIso_(), approved_by: session.user_id });
    var lines = bundle.dishes;
    (production.lines || []).forEach(function (pl) {
      var src = lines.filter(function (x) { return x.dish_id === pl.dish_id && !x.production_id; })[0];
      if (src) updateRow_('DEMAND_PLAN_DISH_LINES', src, { production_id: pl.production_id });
    });
    auditLog_(session.user_id, 'Создан производственный план из прогноза', 'DEMAND_PLANS:' + planId, null, production.plan.plan_id, 'success', session.cascade_id || '');
    return { plan: getDemandPlan_(planId, session), production: production };
  });
}

/** Ежедневный read-only сигнал: создаёт уведомления только при наличии чистой потребности. */
function demandPlanningTrigger_() {
  try {
    getOrganizations_(null).forEach(function (org) {
      getLocations_(org.organization_id).forEach(function (loc) {
        var calc = calculateDemandPlan_({ locationId: loc.location_id, horizonDays: 1, safetyStockPct: 0 }, { organization_id: org.organization_id, location_id: loc.location_id });
        var count = calc.продукты.filter(function (x) { return x.чистая_потребность > 0; }).length;
        if (count > 0) notify_(org.organization_id, loc.location_id, 'DEMAND_PLANNING', 'Есть потребность в закупке по ' + count + ' позициям. Ориентировочная сумма: ' + calc.итоги.ориентировочная_сумма_закупки, 'demand|' + todayDateStr_() + '|' + loc.location_id);
      });
    });
  } catch (err) { logSystemError_('demandPlanningTrigger_', null, 'demand_planning', err); }
}
