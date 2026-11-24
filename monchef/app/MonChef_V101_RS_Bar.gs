/**
 * MON CHEF V101 — Restaurant Service: бар и списание по факту приготовления (ТЗ Restaurant Service 1.0, модули 6–7, этап 6).
 *
 * Собственность Слепцова Дениса Владимировича.
 * Разработчик кода — Слепцов Денис Владимирович.
 *
 * Бар — производственное подразделение внутри общей архитектуры, без своего склада и своих ТТК:
 *  • барные рецептуры — обычные ТТК MON CHEF (листы «Блюда», «Состав», «ТТК_Версии») с цехом «Бар»; группы
 *    (коктейли, кофе, сиропы, кордиалы…) — категория блюда. Экран рецептур показывает то, что есть в ТТК: состав,
 *    количества, единицы, потери (брутто → нетто), выход, технологию, условия и срок хранения и версию — только из
 *    утверждённой версии; оборудование в ТТК не ведётся — «не указано». Себестоимость — только с правом «costs».
 *  • барные заготовки — полуфабрикаты цеха «Бар»: план → начать → выпустить через существующее производство
 *    MON CHEF (planProduction / startProduction / completeProduction): списание сырья по партиям FEFO, партия заготовки,
 *    обязательные ККТ, бракераж, срок годности — по правилам сроков MON CHEF (система срок не придумывает).
 *  • напиток: бармен видит рецепт на карточке задания; «Готовить» — проверка наличия партий (без списания);
 *    «Готово» — списание ингредиентов по действующей ТТК движком V71 (готовые допущенные партии → п/ф → сырьё, FEFO),
 *    себестоимость по партиям, связь партия → позиция заказа. Тот же механизм — для кухни.
 * Повтор не списывает второй раз: складская операция подписана «Производство заказа <задание>»; найдена — не повторяется.
 * Нехватка не досписывается «из воздуха»: остаток уменьшается только на списанное, недостача видна в задании.
 */
var MC_RS_BAR_SHOP_ = 'Бар';

/* ---------------- списание при производстве ---------------- */
function _rsConsumeSrc_(ticketId) { return 'Производство заказа ' + ticketId; }
/** Уже списано по этому заданию? (подпись складской операции) */
function _rsConsumed_(ticketId) {
  try { var src = _rsConsumeSrc_(ticketId), v = _stockOpsSheet_().getDataRange().getValues(); for (var i = v.length - 1; i >= 1; i--) if (String(v[i][8]) === src) return true; } catch (e) {}
  return false;
}
/** Порций к списанию: весовое блюдо — фактический (или плановый) вес / выход ТТК той же единицы. */
function _rsPortions_(tk, item, dish) {
  var q = _rsNum_(tk['Кол-во']) || 1;
  if (item && (item['Весовая'] === true || String(item['Весовая']) === 'true') && dish && dish.yieldBase > 0) {
    var a = item['Вес факт'] !== '' && item['Вес факт'] !== undefined ? _rsNum_(item['Вес факт']) : _rsNum_(item['Вес план']);
    if (a > 0 && String(item['Ед. веса']) === String(dish.yieldUnit)) q = a / dish.yieldBase;
  }
  return q;   // без округления: V71 округляет количество вниз до 0,1 — 1,133333 × 300 дало бы 339,9 г вместо 340
}
/**
 * Списать ингредиенты задания по действующей ТТК (dry — только проверить). Возвращает
 * {status: FULL | PARTIAL | NO_TTK | ALREADY, lines, short, unreleased, costKop, portions}.
 */
function _rsConsume_(tk, item, dry) {
  if (!dry && _rsConsumed_(String(tk.TicketID))) return { status: 'ALREADY', lines: [], short: [], unreleased: [], costKop: 0 };
  var idx = _buildDishIndexes_(), dish = idx.dishByCode[String(tk.DishCode)];
  if (!dish || !dish.ing || !dish.ing.length) return { status: 'NO_TTK', lines: [], short: [], unreleased: [], costKop: 0, note: 'в ТТК нет состава — списать нечего' };
  var portions = _rsPortions_(tk, item, dish), runQty = portions, runIdx = idx, runDish = dish;
  if (Math.abs(portions - Math.round(portions)) > 1e-9) {
    // дробные порции (весовое блюдо): V71 округляет остаток порций до тысячных — состав пересчитывается на фактический вес, списывается 1 «порция»
    runDish = {}; Object.keys(dish).forEach(function (k) { runDish[k] = dish[k]; });
    runDish.ing = (dish.ing || []).map(function (x) { return [x[0], (Number(x[1]) || 0) * portions, x[2], (Number(x[3]) || 0) * portions, (Number(x[4]) || 0) * portions]; });
    var byCode = {}; Object.keys(idx.dishByCode).forEach(function (k) { byCode[k] = idx.dishByCode[k]; }); byCode[String(dish.code)] = runDish;
    runIdx = { dishByCode: byCode, dishByNormName: idx.dishByNormName, dishByLooseName: idx.dishByLooseName }; runQty = 1;
  }
  var r = _v71Run_({ kind: 'DISH', name: String(dish.name), code: String(dish.code), dish: runDish, unit: 'порц.' }, runQty,
    { at: new Date(), dry: !!dry, src: _rsConsumeSrc_(tk.TicketID), note: 'Заказ ' + tk.OrderID + ', стол ' + tk['Стол'], site: String(tk.SiteID || ''), idx: runIdx });
  if (!dry && typeof _mcCreateTraceLink_ === 'function') {
    var agg = {}; r.lines.forEach(function (l) { agg[l.batchId] = (agg[l.batchId] || 0) + l.qty; });
    Object.keys(agg).forEach(function (bid) { try { _mcCreateTraceLink_('BATCH', bid, 'РЕАЛИЗОВАНА_В', 'ORDER_ITEM', String(tk.OrderItemID), { dateTime: new Date(), source: String(tk.TicketID), weight: Math.round(agg[bid] * 1000) / 1000 }); } catch (e) {} });
  }
  return { status: r.status, portions: portions, costKop: Math.round((r.cost || 0) * 100), lines: r.lines, short: r.short, unreleased: r.unreleased };
}
function _rsConsumeText_(c) {
  if (!c) return '';
  if (c.status === 'NO_TTK') return 'не списано: в ТТК нет состава';
  if (!c.short || !c.short.length) return '';
  return 'не хватило: ' + c.short.map(function (s) { return s.product + ' ' + (Math.round(s.qty * 1000) / 1000) + ' ' + s.unit; }).join(', ');
}

/* ---------------- рецептуры ---------------- */
/** Рецепт для карточки задания: состав на порцию (названия, количество, единица), технология, выход. */
function _rsRecipeIdx_(codes) {
  var out = {}; if (!codes.length) return out;
  var idx = null; try { idx = _buildDishIndexes_(); } catch (e) { return out; }
  var tech = {}; try { var sh = _book_().getSheetByName('Блюда'), v = sh.getDataRange().getValues(); for (var i = 1; i < v.length; i++) tech[String(v[i][0])] = String(v[i][5] || ''); } catch (e) {}
  codes.forEach(function (code) {
    var d = idx.dishByCode[code]; if (!d) return;
    out[code] = { ing: (d.ing || []).map(function (x) { return { name: String(x[0]), qty: Math.round((Number(x[3] || x[1]) || 0) * 100) / 100, unit: String(x[2] || '') }; }),
      tech: tech[code] || '', yield: d.yieldBase || null, yunit: d.yieldUnit || '' };
  });
  return out;
}
/** Рецептуры бара: блюда и заготовки цеха «Бар» — по действующей версии ТТК. Себестоимость — только с правом costs. */
function rsBarRecipes(json, token) {
  return _rsRead_(token, 'bar_queue|bar_manage|shop_bar', function (s) {
    var idx = _buildDishIndexes_(), ws = {}; try { ws = _dishWorkshopMap_(); } catch (e) {}
    var ver = {}; try { var v = _ttkVersionsSheet_().getDataRange().getValues(); for (var i = 1; i < v.length; i++) if (v[i][2] === 'действующая') ver[String(v[i][0])] = { n: parseInt(v[i][1], 10) || 0, storage: String(v[i][10] || ''), term: String(v[i][11] || '') }; } catch (e) {}
    var rec = null, codes = Object.keys(idx.dishByCode).filter(function (k) { return String(ws[k] || '') === MC_RS_BAR_SHOP_; });
    rec = _rsRecipeIdx_(codes);
    var costs = _mcRbHasExact_(s, 'costs');
    return { costs: costs, recipes: codes.map(function (k) {
      var d = idx.dishByCode[k], r = rec[k] || { ing: [], tech: '' }, vv = ver[k] || null;
      var ing = (d.ing || []).map(function (x) { var b = Number(x[1]) || 0, n = Number(x[3]) || b; return { name: String(x[0]), brutto: Math.round(b * 100) / 100, netto: Math.round(n * 100) / 100, unit: String(x[2] || ''), lossPct: b > 0 && n < b ? Math.round((1 - n / b) * 1000) / 10 : 0 }; });
      var o = { code: k, name: String(d.name), category: String(d.cat || ''), semi: !!d.semi, ing: ing, tech: r.tech, yield: d.yieldBase || null, yunit: d.yieldUnit || '',
        version: vv ? vv.n : 0, approved: !!vv, storage: vv ? vv.storage : '', term: vv ? vv.term : '', equipment: 'не указано в ТТК' };
      if (costs) { try { var nc = _v64NormCost_(k); o.costPerPortion = Math.round((nc.perUnit !== undefined ? nc.perUnit : nc.cost) * 100) / 100; o.costMissing = nc.missing; } catch (e) {} }
      return o;
    }).sort(function (a, b) { return (a.semi ? 1 : 0) - (b.semi ? 1 : 0) || (a.category < b.category ? -1 : a.category > b.category ? 1 : (a.name < b.name ? -1 : 1)); }) };
  });
}

/* ---------------- заготовки бара — через производство MON CHEF ---------------- */
function _rsBarPfs_() {
  var idx = _buildDishIndexes_(), ws = {}; try { ws = _dishWorkshopMap_(); } catch (e) {}
  return Object.keys(idx.dishByCode).filter(function (k) { var d = idx.dishByCode[k]; return d.semi && String(ws[k] || '') === MC_RS_BAR_SHOP_ && d.ing && d.ing.length; })
    .map(function (k) { var d = idx.dishByCode[k]; return { code: k, name: String(d.name), yunit: d.yieldUnit || 'г', yield: d.yieldBase || null }; });
}
/** Заготовки бара: что можно произвести и задания производства цеха «Бар». */
function rsBarPreps(json, token) {
  return _rsRead_(token, 'bar_queue|bar_manage|shop_bar', function (s) {
    var orders = []; try { _productionSheet_().getDataRange().getValues().slice(1).forEach(function (r) { if (r[0] && String(r[PROD_COL_.ws]) === MC_RS_BAR_SHOP_) orders.push(_prodRowToObj_(r)); }); } catch (e) {}
    var costs = _mcRbHasExact_(s, 'costs');
    orders.forEach(function (o) { if (!costs) delete o.cost; delete o.allocations; });
    var act = orders.filter(function (o) { return ['PLANNED', 'IN_PROGRESS'].indexOf(o.status) >= 0; }), done = orders.filter(function (o) { return ['PLANNED', 'IN_PROGRESS'].indexOf(o.status) < 0; }).slice(-20);
    return { pfs: _rsBarPfs_(), orders: act.reverse().concat(done.reverse()), can: { plan: _mcRbHasExact_(s, 'kanban|prod_manage'), produce: _mcRbHasExact_(s, 'kanban|prod_manage') } };
  });
}
function _rsBarPfOk_(code) { return _rsBarPfs_().some(function (p) { return p.code === code; }); }
function _rsBarOrderOk_(id) { try { var v = _productionSheet_().getDataRange().getValues(); for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(id)) return String(v[i][PROD_COL_.ws]) === MC_RS_BAR_SHOP_; } catch (e) {} return false; }
/** Запланировать заготовку бара. {code, qty, unit, comment} */
function rsBarPrepPlan(json, token) {
  try {
    var s = _requireAuth_(token, null); if (!_mcRbHasExact_(s, 'bar_queue|bar_manage|shop_bar')) return _mcRbDenyJson_('Заготовки бара — бармен или менеджер бара');
    var d = _rsJ_(json, {}) || {}; if (!_rsBarPfOk_(_rsS_(d.code))) return _fail_('VALIDATION', 'Это не заготовка бара (полуфабрикат цеха «Бар» с составом в ТТК)');
    return planProduction(_rsS_(d.code), d.qty, _rsS_(d.unit), '[]', _rsS_(d.comment).slice(0, 200) || 'заготовка бара', token);
  } catch (e) { return _failFrom_(e); }
}
/** Начать заготовку бара. {id} */
function rsBarPrepStart(json, token) {
  try {
    var s = _requireAuth_(token, null); if (!_mcRbHasExact_(s, 'bar_queue|bar_manage|shop_bar')) return _mcRbDenyJson_('Заготовки бара — бармен или менеджер бара');
    var d = _rsJ_(json, {}) || {}; if (!_rsBarOrderOk_(d.id)) return _fail_('VALIDATION', 'Это не задание цеха «Бар»');
    return startProduction(String(d.id), token);
  } catch (e) { return _failFrom_(e); }
}
/** Выпустить заготовку: фактический выход; срок — по правилам сроков MON CHEF (или срок с документа). {id, qty, expiry} */
function rsBarPrepComplete(json, token) {
  try {
    var s = _requireAuth_(token, null); if (!_mcRbHasExact_(s, 'bar_queue|bar_manage|shop_bar')) return _mcRbDenyJson_('Заготовки бара — бармен или менеджер бара');
    var d = _rsJ_(json, {}) || {}; if (!_rsBarOrderOk_(d.id)) return _fail_('VALIDATION', 'Это не задание цеха «Бар»');
    return completeProduction(String(d.id), d.qty, d.expiry || '', token);
  } catch (e) { return _failFrom_(e); }
}

var MC_GATE_EXT_ = (typeof MC_GATE_EXT_ !== 'undefined' && MC_GATE_EXT_) || {};
MC_GATE_EXT_.rsBarRecipes = { need: 'bar_queue|bar_manage|shop_bar' };
MC_GATE_EXT_.rsBarPreps = { need: 'bar_queue|bar_manage|shop_bar' };
MC_GATE_EXT_.rsBarPrepPlan = { need: 'bar_queue|bar_manage|shop_bar', mut: true };
MC_GATE_EXT_.rsBarPrepStart = { need: 'bar_queue|bar_manage|shop_bar', mut: true };
MC_GATE_EXT_.rsBarPrepComplete = { need: 'bar_queue|bar_manage|shop_bar', mut: true };
