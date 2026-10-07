// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — FoodCostControl.gs (волна 3, M11): контроль фуд-коста и «Используй сегодня».
 *
 * Фуд-кост: цель в SETTINGS (foodcost.цель_процент, по умолчанию 30). Себестоимость блюда
 * берётся по текущим ценам (calcRecipeCost_), сравнивается с ценой продажи и с моментом
 * утверждения ТТК. Для блюд выше цели — рекомендованная цена (до 10 ₽ вверх) и продукты,
 * подорожавшие за 30 дней. После прихода или ручной смены цены затронутые блюда
 * проверяются сразу: превышение → уведомление и одна задача шефу на уровень себестоимости.
 *
 * «Используй сегодня»: партии со сроком годности до конца завтрашнего дня и блюда/ПФ,
 * в которые они идут, — чтобы продать или переработать, а не списать.
 */

var FC_DEFAULT_TARGET_ = 30;
var FC_REALERT_STEP_PCT_ = 2; // новое предупреждение, если себестоимость выросла ещё на 2 %

function _fcPct_(n) { return String(Math.round(n * 10) / 10).replace('.', ',') + ' %'; }
function _fcRub_(n) { return String(round2_(n)).replace('.', ',') + ' ₽'; }
function _fcNum_(v) { var n = Number(v); return isFinite(n) ? n : 0; }

function fcGetSettings_(session) {
  var row = _posSettingRow_(session.organization_id, 'foodcost.цель_процент');
  var v = row && row.значение !== '' ? Number(row.значение) : FC_DEFAULT_TARGET_;
  return { цель_процент: isFinite(v) && v > 0 ? v : FC_DEFAULT_TARGET_ };
}

function fcSaveSettings_(data, session) {
  return withLock_(function () {
    var t = Number(data.цель_процент);
    if (!isFinite(t) || t < 5 || t > 90) throw new Error('Цель фуд-коста — от 5 до 90 %.');
    var row = _posSettingRow_(session.organization_id, 'foodcost.цель_процент');
    if (row) updateRow_('SETTINGS', row, { значение: String(round2_(t)) });
    else insertRow_('SETTINGS', { organization_id: session.organization_id, location_id: '', ключ: 'foodcost.цель_процент', значение: String(round2_(t)) });
    auditLog_(session.user_id, 'Цель фуд-коста', 'SETTINGS:foodcost', row ? row.значение : null, String(round2_(t)), 'success', session.cascade_id || '');
    return fcGetSettings_(session);
  });
}

/** Рекомендованная цена: себестоимость / цель, вверх до 10 ₽. */
function _fcRecommended_(cost, target) {
  return cost > 0 ? Math.ceil(cost / (target / 100) / 10) * 10 : 0;
}

/** Продукты блюда (и его ПФ) — для поиска подорожаний. */
function _fcDishProducts_(dishId) {
  var out = {};
  (function walk(type, id, depth) {
    if (depth > 5) return;
    getRecipeLines_(type, id).forEach(function (l) {
      if (String(l.product_id).indexOf('PF-') === 0) walk('PF', l.product_id, depth + 1);
      else out[l.product_id] = true;
    });
  })('DISH', dishId, 0);
  return Object.keys(out);
}

/** Подорожания продукта за 30 дней: самая ранняя старая цена → текущая. */
function _fcPriceRises_(productIds, organizationId) {
  var since = new Date(Date.now() - 30 * 86400000).toISOString();
  return productIds.map(function (pid) {
    var p = getProductById_(pid);
    if (!p) return null;
    var hist = findRows_('PRICE_HISTORY', function (r) {
      return r.product_id === pid && r.organization_id === organizationId && String(r.effective_at) >= since && _fcNum_(r.old_price) > 0;
    }).sort(function (a, b) { return String(a.effective_at).localeCompare(String(b.effective_at)); });
    if (!hist.length) return null;
    var was = _fcNum_(hist[0].old_price), now = _fcNum_(p.текущая_цена);
    if (!(now > was)) return null;
    return { product_id: pid, название: p.название, было: round2_(was), стало: round2_(now), рост_pct: round2_((now - was) / was * 100) };
  }).filter(Boolean).sort(function (a, b) { return b.рост_pct - a.рост_pct; });
}

function _fcDishRow_(dish, target) {
  var price = _fcNum_(dish.цена_продажи);
  var cost = round2_(calcRecipeCost_('DISH', dish.dish_id));
  var fc = price > 0 ? round2_(cost / price * 100) : 0;
  var ttk = typeof _ttkCurrent_ === 'function' ? _ttkCurrent_(dish.dish_id) : null;
  var ttkCost = ttk && ttk.cost_snapshot !== '' && ttk.cost_snapshot !== undefined ? _fcNum_(ttk.cost_snapshot) : null;
  return { dish_id: dish.dish_id, название: dish.название, цена: price, себестоимость: cost, food_cost: fc,
    маржа: round2_(price - cost), выше_цели: price > 0 && fc > target,
    рекомендованная_цена: price > 0 && fc > target ? _fcRecommended_(cost, target) : null,
    себестоимость_по_ттк: ttkCost, рост_с_ттк_pct: ttkCost ? round2_((cost - ttkCost) / ttkCost * 100) : null };
}

/** Обзор: все активные блюда с ценой; сначала выше цели. */
function fcGetOverview_(session) {
  var target = fcGetSettings_(session).цель_процент;
  var rows = findRows_('DISHES', function (d) { return d.organization_id === session.organization_id && d.статус !== 'архив' && _fcNum_(d.цена_продажи) > 0; })
    .map(function (d) { return _fcDishRow_(d, target); });
  rows.forEach(function (r) { if (r.выше_цели) r.подорожания = _fcPriceRises_(_fcDishProducts_(r.dish_id), session.organization_id).slice(0, 3); });
  rows.sort(function (a, b) { return (b.выше_цели - a.выше_цели) || (b.food_cost - a.food_cost); });
  var revenueW = 0, costW = 0;
  rows.forEach(function (r) { revenueW += r.цена; costW += r.себестоимость; });
  return { цель_процент: target, блюд: rows.length, выше_цели: rows.filter(function (r) { return r.выше_цели; }).length,
    средний_food_cost: revenueW ? round2_(costW / revenueW * 100) : 0, rows: rows };
}

/** Блюда, в которые продукт входит напрямую или через ПФ (любой глубины). */
function _fcAffectedDishes_(productId) {
  var dishes = {}, seen = {}, queue = [productId];
  while (queue.length) {
    var id = queue.shift();
    if (seen[id]) continue;
    seen[id] = true;
    findRows_('RECIPES', function (r) { return r.product_id === id; }).forEach(function (r) {
      if (r.parent_type === 'DISH') dishes[r.parent_id] = true;
      else if (r.parent_type === 'PF') queue.push(r.parent_id);
    });
  }
  return Object.keys(dishes);
}

/** Проверка блюд: выше цели → уведомление и задача шефу (повторно — только при новом росте). */
function fcCheckAlerts_(session, dishIds) {
  var target = fcGetSettings_(session).цель_процент, created = [];
  var dishes = findRows_('DISHES', function (d) {
    return d.organization_id === session.organization_id && d.статус !== 'архив' && _fcNum_(d.цена_продажи) > 0 && (!dishIds || dishIds.indexOf(d.dish_id) !== -1);
  });
  dishes.forEach(function (d) {
    var r = _fcDishRow_(d, target);
    var open = findRows_('FOODCOST_ALERTS', function (a) { return a.organization_id === session.organization_id && a.dish_id === d.dish_id && a.статус === 'открыт'; });
    if (!r.выше_цели) {
      open.forEach(function (a) { updateRow_('FOODCOST_ALERTS', a, { статус: 'снят', снято: nowIso_() }); });
      return;
    }
    var last = open.sort(function (a, b) { return _fcNum_(b.себестоимость) - _fcNum_(a.себестоимость); })[0];
    if (last && r.себестоимость <= _fcNum_(last.себестоимость) * (1 + FC_REALERT_STEP_PCT_ / 100)) return;
    var rises = _fcPriceRises_(_fcDishProducts_(d.dish_id), session.organization_id).slice(0, 3);
    var why = rises.length ? ' Подорожало: ' + rises.map(function (x) { return x.название + ' ' + _fcRub_(x.было).replace(' ₽', '') + ' → ' + _fcRub_(x.стало) + ' (+' + _fcPct_(x.рост_pct) + ')'; }).join('; ') + '.' : '';
    var text = 'Фуд-кост «' + d.название + '» ' + _fcPct_(r.food_cost) + ' при цели ' + _fcPct_(target) + ': себестоимость ' + _fcRub_(r.себестоимость) + ', цена ' + _fcRub_(r.цена) + '. Цена для цели — ' + _fcRub_(r.рекомендованная_цена) + '.' + why;
    var task = createTask_({ organizationId: session.organization_id, locationId: session.location_id || '', type: 'ai',
      title: 'Фуд-кост «' + d.название + '» ' + _fcPct_(r.food_cost) + ' (цель ' + _fcPct_(target) + ')', description: text,
      responsibleRole: 'ШЕФ-ПОВАР', priority: 'высокий', sourceEntityId: d.dish_id, userId: session.user_id, session: session });
    try { notify_(session.organization_id, session.location_id || '', CONFIG.NOTIFICATION_TYPES.FOODCOST_DEVIATION, text, 'foodcost|' + d.dish_id + '|' + r.себестоимость, session.cascade_id || ''); } catch (e) { Logger.log('fc notify: ' + e.message); }
    open.forEach(function (a) { updateRow_('FOODCOST_ALERTS', a, { статус: 'заменён', снято: nowIso_() }); });
    var row = { alert_id: generateId_('FOODCOST_ALERTS'), organization_id: session.organization_id, dish_id: d.dish_id, себестоимость: r.себестоимость,
      food_cost: r.food_cost, цель: target, рекомендованная_цена: r.рекомендованная_цена, task_id: task.task_id, статус: 'открыт', создано: nowIso_(), снято: '' };
    insertRow_('FOODCOST_ALERTS', row);
    created.push(row);
  });
  return { проверено: dishes.length, предупреждений: created.length, alerts: created };
}

/** Вызывается после прихода и ручной смены цены (API.gs) — проверяет только затронутые блюда. */
function fcAfterPriceChange_(productId, session) {
  var ids = _fcAffectedDishes_(productId);
  return ids.length ? fcCheckAlerts_(session, ids) : { проверено: 0, предупреждений: 0, alerts: [] };
}

// ---------- «Используй сегодня» ----------

function fcUseToday_(session) {
  var today = todayDateStr_(), tomorrow = _dpAddDays_(today, 1);
  var byItem = {};
  findRows_('BATCHES', function (b) {
    if (b.location_id !== session.location_id || String(b.статус || '').toUpperCase().indexOf('БЛОК') !== -1) return false;
    var exp = String(b.срок_годности || '').slice(0, 10);
    return exp && exp >= today && exp <= tomorrow;
  }).forEach(function (b) {
    var left = _fcNum_(getBatchRemaining_(b));
    if (left <= 0) return;
    var item = byItem[b.product_id] || (byItem[b.product_id] = { id: b.product_id, количество: 0, срок: String(b.срок_годности).slice(0, 10) });
    item.количество += left;
    if (String(b.срок_годности).slice(0, 10) < item.срок) item.срок = String(b.срок_годности).slice(0, 10);
  });
  var target = fcGetSettings_(session).цель_процент;
  var rows = Object.keys(byItem).map(function (id) {
    var it = byItem[id], isPf = id.indexOf('PF-') === 0;
    var obj = isPf ? getSemiFinishedById_(id) : getProductById_(id);
    if (!obj || obj.organization_id !== session.organization_id) return null;
    var uses = findRows_('RECIPES', function (r) { return r.product_id === id; });
    var dishes = uses.filter(function (r) { return r.parent_type === 'DISH'; }).map(function (r) {
      var d = findOne_('DISHES', 'dish_id', r.parent_id);
      if (!d || d.статус === 'архив' || d.organization_id !== session.organization_id) return null;
      var per = normalizeQty_(_fcNum_(r.брутто), r.единица);
      var row = _fcDishRow_(d, target);
      return { dish_id: d.dish_id, название: d.название, порций: per > 0 ? Math.floor(it.количество / per + 1e-9) : 0, маржа: row.маржа };
    }).filter(function (x) { return x && x.порций > 0; }).sort(function (a, b) { return b.маржа - a.маржа; });
    var pfs = uses.filter(function (r) { return r.parent_type === 'PF'; }).map(function (r) {
      var pf = getSemiFinishedById_(r.parent_id);
      return pf && pf.organization_id === session.organization_id ? { pf_id: pf.pf_id, название: pf.название, срок_хранения_часов: pf.срок_хранения_часов } : null;
    }).filter(Boolean);
    return { id: id, название: obj.название, тип: isPf ? 'ПФ' : 'продукт', единица: isPf ? (obj.единица || 'кг') : (obj.единица || ''), количество: round2_(it.количество),
      срок: it.срок, сегодня: it.срок === today, стоимость: round2_(it.количество * getIngredientUnitPrice_(id)),
      блюда: dishes.map(function (x) { return { dish_id: x.dish_id, название: x.название, порций: x.порций }; }), заготовки: pfs };
  }).filter(Boolean).sort(function (a, b) { return a.срок.localeCompare(b.срок) || b.стоимость - a.стоимость; });
  return { сегодня: today, завтра: tomorrow, под_риском_руб: round2_(rows.reduce(function (s, r) { return s + r.стоимость; }, 0)), rows: rows };
}
