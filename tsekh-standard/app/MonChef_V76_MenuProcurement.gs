// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
/**
 * ЦЕХ Стандарт V76 — «ЦЕХ Финансы и Экономика», этап 6: меню-инжиниринг, закупки, прогноз.
 *
 * Новых первичных данных модуль не вводит. Источники:
 *   продажи по блюдам — дневные итоги этапа 2 (Фин_Итоги_Блюдо_День: продано, выручка, себестоимость по партиям FEFO);
 *   цены закупки — партии (Склад_Партии + паспорт Приёмка_Партии: поставщик, цена, дата);
 *   состав блюд — действующие ТТК (листы «Блюда» / «Состав»), раскладка до сырья — тем же правилом, что потребность банкета
 *   (_serverExplodeInto_: п/ф раскладывается по выходу своей карточки, сырьё — по брутто);
 *   остатки и минимальный запас — Склад_Остатки; заявки и заказы — лист V21 «Закупки_V21».
 *
 * Меню-инжиниринг — метод Kasavana–Smith: популярность = доля блюда в проданных порциях против 70 % средней доли
 * (0,7 / число блюд); доходность = валовой вклад на порцию против среднего вклада на порцию по меню (взвешенно).
 *   «Звезда» — популярно и выгодно; «Рабочая лошадка» — популярно, вклад ниже среднего; «Загадка» — выгодно, но мало продаж;
 *   «Собака» — мало продаж и низкий вклад.
 * Закупки — доля поставщиков, динамика цены продукта (последняя против предыдущей и против средней за 90 дней до периода),
 *   более дешёвый поставщик того же продукта, влияние роста цены на себестоимость порции каждого блюда.
 * Прогноз — среднее продаж каждого блюда по дню недели за последние N недель (только рабочие дни — дни с выручкой);
 *   потребность в сырье по ТТК; к заказу = потребность + мин. запас − остаток − уже заказано (заявки V21 OPEN/ORDERED).
 *   Заявки создаются в тот же лист «Закупки_V21», дальше — обычный путь V21: заказ поставщику → приёмка. Повторная заявка
 *   на тот же продукт в тот же прогноз не создаётся.
 *
 * Рост цены — от 1 копейки за кг / л / шт (решение 14.11.2026); ориентир priceRisePct (v73SetTargets) может поднять порог в процентах, по умолчанию 0.
 * Сразу при приёмке партии с ценой выше предыдущей закупки (_createBatch_ → _v76OnPurchase_) пересчитывается себестоимость порции
 * каждого блюда с этим продуктом в ТТК (по последним ценам закупки), событие пишется в «Фин_Себестоимость_События»,
 * шеф-повар и директор получают уведомление.
 * Управленческий анализ, бухгалтерский учёт не заменяет. Точка = предприятие.
 */
var MC_V76_CLASS_RU = { STAR: 'Звезда', PLOWHORSE: 'Рабочая лошадка', PUZZLE: 'Загадка', DOG: 'Собака' };
var MC_V76_ADVICE = {
  STAR: 'Сохранить: заметное место в меню, стабильная рецептура и выход порции.',
  PLOWHORSE: 'Популярно, но зарабатывает мало: поднять цену небольшими шагами, проверить выход и порцию, заменить дорогой ингредиент.',
  PUZZLE: 'Выгодно, но продаётся мало: выделить в меню, рекомендовать в зале, проверить название, описание и цену.',
  DOG: 'Кандидат на вывод из меню или замену; оставить, только если блюдо нужно для ассортимента.'
};
var MC_V76_FLAG_RU = { NO_COST: 'себестоимость не посчитана (нет списания по партиям)', MARGIN_BELOW_TARGET: 'маржа ниже ориентира', COST_ABOVE_NORM: 'фактическая себестоимость выше нормативной по ТТК более чем на 10 %',
  NO_TTK: 'нет техкарты', NO_MENU_PRICE: 'нет действующей цены меню' };
var MC_V76_REQ_DAYS = 14;   // заявки V21 OPEN/ORDERED за столько дней считаются «уже заказано»

/* ---------------- служебное ---------------- */
function _v76Iso_(d) { return _v64Day_(d); }
function _v76AddDays_(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function _v76Base_(unit) { try { return _toBaseUnitServer_(1, unit); } catch (e) { return { qty: 1, unit: String(unit || '') }; } }
/** Единица показа цены: г → кг, мл → л, остальное как есть. factor — сколько базовых единиц в единице показа. */
function _v76Std_(unit) { var b = _v76Base_(unit).unit; return b === 'г' ? { unit: 'кг', base: 'г', factor: 1000 } : b === 'мл' ? { unit: 'л', base: 'мл', factor: 1000 } : { unit: b || 'шт', base: b || 'шт', factor: 1 }; }
/** Цена за единицу партии → цена за базовую единицу (₽/г, ₽/мл, ₽/шт). */
function _v76PerBase_(price, unit) { var b = _v76Base_(unit); return b.qty > 0 ? price / b.qty : price; }
function _v76Pk_(name, unit) { return _v64Key_(name) + '|' + _v76Base_(unit).unit; }
function _v76Pct_(a, b) { return b > 0 ? Math.round((a - b) / b * 1000) / 10 : null; }

/** Индексы ТТК (по коду, по имени, нечёткие) — один раз на вызов. */
function _v76Idx_() { try { return _buildDishIndexes_(); } catch (e) { return { dishByCode: {}, dishByNormName: {}, dishByLooseName: {} }; } }
function _v76FindDish_(idx, name) {
  var d = idx.dishByCode[name]; if (d) return d;
  try { return _findSubDish_(name, idx.dishByNormName, idx.dishByLooseName); } catch (e) {}
  var k = _v64Key_(name); return Object.keys(idx.dishByCode).map(function (c) { return idx.dishByCode[c]; }).filter(function (x) { return _v64Key_(x.name) === k; })[0] || null;
}
/** Сырьё на mult порций блюда: { «ключ|базовая ед.»: {name, base, qty в базовых единицах} }. */
function _v76Explode_(idx, dish, mult, memo) {
  var key = dish.code + '', per = memo && memo[key];
  if (!per) {
    var acc = {};
    try { _serverExplodeInto_(dish.ing, 1, acc, [dish.code], 0, idx.dishByCode, idx.dishByNormName, null, null, idx.dishByLooseName); }
    catch (e) { (dish.ing || []).forEach(function (x) { var k0 = x[0] + '|' + x[2]; acc[k0] = (acc[k0] || 0) + (Number(x[1]) || 0); }); }
    per = {};
    Object.keys(acc).forEach(function (k) {
      var i = k.lastIndexOf('|'), name = k.slice(0, i), unit = k.slice(i + 1), b = _v76Base_(unit), pk = _v64Key_(name) + '|' + b.unit;
      var x = per[pk] || (per[pk] = { name: name, base: b.unit, qty: 0 }); x.qty += acc[k] * b.qty;
    });
    if (memo) memo[key] = per;
  }
  var out = {}; Object.keys(per).forEach(function (k) { out[k] = { name: per[k].name, base: per[k].base, qty: per[k].qty * mult }; });
  return out;
}

/** Закупки (партии с ценой, без выпусков, разделки и излишков ревизии), по дате. */
function _v76Purchases_() {
  var B = _v64Batches_(), out = [];
  Object.keys(B).forEach(function (id) {
    var b = B[id]; if (_v64Produced_(b) || _v64ProcessedChild_(b) || _v64Found_(b) || !(b.price > 0) || !(b.qty > 0)) return;
    var d = (b.pass && b.pass.docDate) || b.received; if (!d) return;
    var std = _v76Std_(b.unit), pb = _v76PerBase_(b.price, b.unit), bq = b.qty * _v76Base_(b.unit).qty;
    out.push({ batchId: id, date: d, day: _v76Iso_(d), product: b.product, key: _v76Pk_(b.product, b.unit), base: std.base, stdUnit: std.unit, factor: std.factor,
      supplier: (b.pass && b.pass.supplier) || b.supplierId || '—', invoice: (b.pass && b.pass.invoice) || b.doc || '', qtyBase: bq, priceBase: pb, amount: _v64R2_(b.qty * b.price) });
  });
  return out.sort(function (a, b) { return a.date - b.date || (a.batchId < b.batchId ? -1 : 1); });
}
function _v76Wavg_(list) { var q = 0, s = 0; list.forEach(function (p) { q += p.qtyBase; s += p.qtyBase * p.priceBase; }); return q > 0 ? s / q : null; }

/** Рост цены: не меньше 1 копейки за единицу показа (кг / л / шт) и не меньше ориентира priceRisePct в процентах. */
function _v76IsRise_(priceBase, refBase, factor, T) {
  if (refBase === null || refBase === undefined || !(refBase > 0)) return false;
  var d = Math.round((priceBase - refBase) * factor * 100);   // в копейках за кг / л / шт
  return d >= 1 && (priceBase - refBase) / refBase * 100 >= (T.priceRisePct || 0) - 1e-9;
}
/** Динамика цен по продуктам на дату rg.to. */
function _v76PriceStats_(P, rg, T) {
  var by = {}; P.forEach(function (p) { if (p.date <= rg.to) (by[p.key] = by[p.key] || []).push(p); });
  var from90 = _v76AddDays_(rg.from, -90), to90 = _v76AddDays_(rg.to, -90), out = [];
  Object.keys(by).forEach(function (k) {
    var L = by[k], last = L[L.length - 1], f = last.factor, inP = L.filter(function (p) { return p.date >= rg.from; });
    // «предыдущая» — последняя закупка раньше дня последней (в тот же день могут быть две партии)
    var prev = null; for (var i = L.length - 2; i >= 0; i--) if (L[i].day < last.day) { prev = L[i]; break; }
    var before = L.filter(function (p) { return p.date >= from90 && p.date < rg.from; }), baseAvg = _v76Wavg_(before);
    var recent = L.filter(function (p) { return p.date >= to90; }), best = null;
    recent.forEach(function (p) { if (!best || p.priceBase < best.priceBase) best = p; });
    var x = { key: k, product: last.product, unit: last.stdUnit, base: last.base, factor: f,
      lastPrice: _v64R2_(last.priceBase * f), lastDate: last.day, lastSupplier: last.supplier, lastPriceBase: last.priceBase,
      prevPrice: prev ? _v64R2_(prev.priceBase * f) : null, prevDate: prev ? prev.day : '', prevSupplier: prev ? prev.supplier : '',
      changePct: prev ? _v76Pct_(last.priceBase, prev.priceBase) : null,
      avg90: baseAvg === null ? null : _v64R2_(baseAvg * f), vsAvg90Pct: baseAvg === null ? null : _v76Pct_(last.priceBase, baseAvg),
      periodQty: _v64R3_(inP.reduce(function (s, p) { return s + p.qtyBase; }, 0) / f), periodAmount: _v64R2_(inP.reduce(function (s, p) { return s + p.amount; }, 0)),
      periodAvg: inP.length ? _v64R2_(_v76Wavg_(inP) * f) : null, purchases: inP.length,
      minPrice: inP.length ? _v64R2_(Math.min.apply(null, inP.map(function (p) { return p.priceBase; })) * f) : null,
      maxPrice: inP.length ? _v64R2_(Math.max.apply(null, inP.map(function (p) { return p.priceBase; })) * f) : null,
      bestSupplier: '', bestPrice: null, saving: 0, flags: [] };
    // ориентир сравнения для влияния на блюда: средняя за 90 дней до периода, иначе предыдущая закупка
    var ref = baseAvg !== null ? baseAvg : prev ? prev.priceBase : null;
    x.refPriceBase = ref; x.deltaBase = ref === null ? 0 : last.priceBase - ref;
    if (_v76IsRise_(last.priceBase, prev ? prev.priceBase : null, f, T) || _v76IsRise_(last.priceBase, baseAvg, f, T)) x.flags.push('PRICE_UP');
    if (best && best.supplier !== last.supplier && best.priceBase < last.priceBase * 0.97) {
      x.bestSupplier = best.supplier; x.bestPrice = _v64R2_(best.priceBase * f); x.bestDate = best.day;
      x.saving = _v64R2_(inP.reduce(function (s, p) { return s + p.qtyBase * Math.max(0, p.priceBase - best.priceBase); }, 0));
      x.flags.push('CHEAPER_SUPPLIER');
    }
    out.push(x);
  });
  return out;
}

/* ---------------- меню-инжиниринг ---------------- */
function _v76Menu_(rg, T) {
  var S = _v72Sum_(rg.fromIso, rg.toIso), sold = S.dishes.filter(function (d) { return d.qty > 0; }), idx = _v76Idx_();
  var prices = []; try { prices = _v64MenuPrices_(); } catch (e) {}
  var Q = sold.reduce(function (a, d) { return a + d.qty; }, 0), G = sold.reduce(function (a, d) { return a + d.gross; }, 0), N = sold.length;
  var popTh = N ? 70 / N : 0, avgCm = Q > 0 ? G / Q : 0, today = new Date();
  var items = sold.map(function (d) {
    var mix = Q > 0 ? d.qty / Q * 100 : 0, cm = d.gross / d.qty, hiPop = mix >= popTh, hiCm = cm >= avgCm;
    var cls = hiPop ? (hiCm ? 'STAR' : 'PLOWHORSE') : (hiCm ? 'PUZZLE' : 'DOG');
    var ttk = _v76FindDish_(idx, d.code || d.dish) || _v76FindDish_(idx, d.dish), mp = null, norm = null, flags = [];
    try { mp = _v64PriceFor_(prices, d.dish, '', today); } catch (e) {}
    if (ttk) { try { norm = _v64NormCost_(ttk.code).cost; } catch (e) {} } else flags.push('NO_TTK');
    var costPer = d.cost / d.qty, pricePer = d.revenue / d.qty;
    if (!(d.cost > 0)) flags.push('NO_COST');
    if (d.marginPct !== null && d.marginPct < T.minDishMarginPct) flags.push('MARGIN_BELOW_TARGET');
    if (norm > 0 && costPer > norm * 1.1) flags.push('COST_ABOVE_NORM');
    if (!mp) flags.push('NO_MENU_PRICE');
    return { dish: d.dish, code: (ttk && ttk.code) || d.code || '', category: (ttk && ttk.cat) || '', qty: d.qty, mixPct: Math.round(mix * 10) / 10,
      revenue: d.revenue, cost: d.cost, gross: d.gross, marginPct: d.marginPct, foodCostPct: d.revenue > 0 ? Math.round(d.cost / d.revenue * 1000) / 10 : null,
      avgPrice: _v64R2_(pricePer), costPerPortion: _v64R2_(costPer), cmPerPortion: _v64R2_(cm), menuPrice: mp ? mp.price : null,
      normCost: norm, normFoodCostPct: norm > 0 && mp ? Math.round(norm / mp.price * 1000) / 10 : null,
      cls: cls, clsRu: MC_V76_CLASS_RU[cls], advice: MC_V76_ADVICE[cls], flags: flags, flagsRu: flags.map(function (f) { return MC_V76_FLAG_RU[f] || f; }) };
  }).sort(function (a, b) { return ['STAR', 'PLOWHORSE', 'PUZZLE', 'DOG'].indexOf(a.cls) - ['STAR', 'PLOWHORSE', 'PUZZLE', 'DOG'].indexOf(b.cls) || b.gross - a.gross; });
  // блюда из меню без продаж за период
  var soldKeys = {}; sold.forEach(function (d) { soldKeys[_v64Key_(d.dish)] = 1; });
  var seen = {}, unsold = [], names = {};
  try { var pt = _v64Tab_('Цены_Меню'); pt.rows.forEach(function (r) { var nm = String(_v64G_(pt, r, 'DishName')); if (nm) names[_v64Key_(nm)] = nm; }); } catch (e) {}
  prices.forEach(function (p) { if (p.event || !(p.price > 0) || soldKeys[p.key] || seen[p.key]) return; if (p.to && p.to < rg.from) return; seen[p.key] = 1;
    var t = _v76FindDish_(idx, p.code || p.key); unsold.push({ dish: t ? t.name : names[p.key] || p.key, code: p.code || (t && t.code) || '', menuPrice: p.price }); });
  var classes = ['STAR', 'PLOWHORSE', 'PUZZLE', 'DOG'].map(function (c) { var L = items.filter(function (x) { return x.cls === c; });
    return { cls: c, clsRu: MC_V76_CLASS_RU[c], dishes: L.length, qty: _v64R3_(L.reduce(function (a, x) { return a + x.qty; }, 0)), revenue: _v64R2_(L.reduce(function (a, x) { return a + x.revenue; }, 0)),
      gross: _v64R2_(L.reduce(function (a, x) { return a + x.gross; }, 0)), advice: MC_V76_ADVICE[c] }; });
  return { items: items, classes: classes, unsold: unsold, totals: { dishes: N, qty: _v64R3_(Q), gross: _v64R2_(G), revenue: _v64R2_(sold.reduce(function (a, d) { return a + d.revenue; }, 0)) },
    thresholds: { popularityPct: Math.round(popTh * 10) / 10, avgCmPerPortion: _v64R2_(avgCm) }, S: S };
}

/* ---------------- закупки ---------------- */
function _v76Procurement_(rg, T) {
  var P = _v76Purchases_(), inP = P.filter(function (p) { return p.date >= rg.from && p.date <= rg.to; }), total = inP.reduce(function (s, p) { return s + p.amount; }, 0);
  var sup = {}; inP.forEach(function (p) { var x = sup[p.supplier] || (sup[p.supplier] = { supplier: p.supplier, amount: 0, batches: 0, products: {} }); x.amount += p.amount; x.batches++; x.products[p.key] = 1; });
  var suppliers = Object.keys(sup).map(function (k) { var x = sup[k]; return { supplier: x.supplier, amount: _v64R2_(x.amount), sharePct: total > 0 ? Math.round(x.amount / total * 1000) / 10 : null, batches: x.batches, products: Object.keys(x.products).length }; })
    .sort(function (a, b) { return b.amount - a.amount; });
  var stats = _v76PriceStats_(P, rg, T), inPeriod = stats.filter(function (s) { return s.purchases > 0; }).sort(function (a, b) { return b.periodAmount - a.periodAmount; });
  var rises = stats.filter(function (s) { return s.flags.indexOf('PRICE_UP') >= 0; }).sort(function (a, b) { return Math.max(b.changePct || 0, b.vsAvg90Pct || 0) - Math.max(a.changePct || 0, a.vsAvg90Pct || 0); });
  var cheaper = stats.filter(function (s) { return s.flags.indexOf('CHEAPER_SUPPLIER') >= 0; }).sort(function (a, b) { return b.saving - a.saving; });
  // влияние изменения цен на себестоимость порции: по составу ТТК, раскладка до сырья
  var moved = {}; stats.forEach(function (s) { if (s.deltaBase && s.refPriceBase !== null) moved[s.key] = s; });
  var impact = [];
  if (Object.keys(moved).length) {
    var idx = _v76Idx_(), memo = {}, prices = []; try { prices = _v64MenuPrices_(); } catch (e) {}
    Object.keys(idx.dishByCode).forEach(function (c) {
      var d = idx.dishByCode[c]; if (d.semi || !(d.ing || []).length) return;
      var need = _v76Explode_(idx, d, 1, memo), delta = 0, drivers = [];
      Object.keys(need).forEach(function (k) { var s = moved[k]; if (!s) return; var dd = need[k].qty * s.deltaBase; if (Math.abs(dd) < 0.005) return; delta += dd; drivers.push(s.product + ' ' + (dd > 0 ? '+' : '') + _v64R2_(dd) + ' ₽'); });
      if (Math.abs(delta) < 0.01) return;
      var mp = null; try { mp = _v64PriceFor_(prices, d.name, '', new Date()); } catch (e) {}
      var norm = null; try { norm = _v64NormCost_(d.code).cost; } catch (e) {}
      impact.push({ dish: d.name, code: d.code, deltaPerPortion: _v64R2_(delta), drivers: drivers.join('; '), menuPrice: mp ? mp.price : null, normCost: norm,
        foodCostPct: norm > 0 && mp ? Math.round(norm / mp.price * 1000) / 10 : null, deltaPctOfPrice: mp ? Math.round(delta / mp.price * 1000) / 10 : null });
    });
    impact.sort(function (a, b) { return b.deltaPerPortion - a.deltaPerPortion; });
  }
  var rows = function (L) { return L.map(function (s) { var o = {}; Object.keys(s).forEach(function (k) { if (['refPriceBase', 'deltaBase', 'lastPriceBase', 'factor'].indexOf(k) < 0) o[k] = s[k]; }); o.flagsRu = s.flags.map(function (f) { return f === 'PRICE_UP' ? 'рост цены' : 'есть дешевле у другого поставщика'; }); return o; }); };
  var costEvents = []; try { costEvents = _v76CostEvents_(rg); } catch (e) {}
  return { costEvents: costEvents, totals: { amount: _v64R2_(total), batches: inP.length, suppliers: suppliers.length, products: inPeriod.length, priceRises: rises.length, possibleSaving: _v64R2_(cheaper.reduce(function (s, x) { return s + x.saving; }, 0)) },
    suppliers: suppliers, products: rows(inPeriod), rises: rows(rises), cheaper: rows(cheaper), impact: impact,
    purchases: inP.slice().reverse().slice(0, 300).map(function (p) { return { date: p.day, product: p.product, supplier: p.supplier, invoice: p.invoice, batchId: p.batchId, qty: _v64R3_(p.qtyBase / p.factor), unit: p.stdUnit, price: _v64R2_(p.priceBase * p.factor), amount: p.amount }; }) };
}

/* ---------------- прогноз ---------------- */
/** Остатки и мин. запас по ключу «продукт|базовая ед.» в базовых единицах. */
function _v76Stock_() {
  var out = {}; try {
    var v = _stockBalanceSheet_().getDataRange().getValues();
    for (var i = 1; i < v.length; i++) { if (!v[i][0]) continue; var u = String(v[i][1] || 'г'), b = _v76Base_(u), k = _v64Key_(v[i][0]) + '|' + b.unit, x = out[k] || (out[k] = { onHand: 0, min: 0, unit: u });
      x.onHand += (_v64Num_(v[i][2])) * b.qty; x.min += (_v64Num_(v[i][3])) * b.qty; }
  } catch (e) {}
  return out;
}
/** Уже заказано: заявки V21 OPEN/ORDERED, созданные за последние MC_V76_REQ_DAYS дней или на неделю не раньше этого срока, в базовых единицах. */
function _v76Ordered_(asOf) {
  var out = {}, since = _v76AddDays_(asOf, -MC_V76_REQ_DAYS);
  try { var v = _mcV21Purchase_().getDataRange().getValues();
    for (var i = 1; i < v.length; i++) { var st = String(v[i][7]); if (!v[i][0] || (st !== 'OPEN' && st !== 'ORDERED')) continue; var at = _v64Date_(v[i][9]), wk = _v64Date_(v[i][2]); if (at && at < since && !(wk && wk >= since)) continue;   // старая заявка не держит потребность, заявка на будущую неделю — держит
      var b = _v76Base_(v[i][4]), k = _v64Key_(v[i][3]) + '|' + b.unit; out[k] = (out[k] || 0) + _v64Num_(v[i][5]) * b.qty; } } catch (e) {}
  return out;
}
function _v76Forecast_(opts) {
  var asOf = _v64Date_(opts.asOf) || new Date(); asOf = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  var horizon = Math.max(1, Math.min(31, Math.round(_v64Num_(opts.days) || 7))), weeks = Math.max(1, Math.min(26, Math.round(_v64Num_(opts.weeks) || 8)));
  var hFrom = _v76AddDays_(asOf, -weeks * 7), hTo = _v76AddDays_(asOf, -1), fromIso = _v76Iso_(hFrom), toIso = _v76Iso_(hTo);
  // рабочие дни истории — дни с выручкой
  var work = {}, wdCount = [0, 0, 0, 0, 0, 0, 0], revByWd = [0, 0, 0, 0, 0, 0, 0];
  _v72Read_('DAY').rows.forEach(function (r) { var d = _v72DayStr_(r.Day); if (d < fromIso || d > toIso || !(_v64Num_(r.revenue) > 0)) return; if (work[d]) return; work[d] = 1;
    var wd = _v64Date_(d).getDay(); wdCount[wd]++; revByWd[wd] += _v64Num_(r.revenue); });
  var nWork = Object.keys(work).length;
  var dish = {};
  _v72Read_('DISH').rows.forEach(function (r) { var d = _v72DayStr_(r.Day); if (!work[d]) return; var wd = _v64Date_(d).getDay();
    var x = dish[r.Dish] || (dish[r.Dish] = { dish: String(r.Dish), code: String(r.DishCode || ''), qtyByWd: [0, 0, 0, 0, 0, 0, 0], qty: 0, revenue: 0, cost: 0 });
    x.qtyByWd[wd] += _v64Num_(r.Qty); x.qty += _v64Num_(r.Qty); x.revenue += _v64Num_(r.Revenue); x.cost += _v64Num_(r.Cost); });
  var prices = []; try { prices = _v64MenuPrices_(); } catch (e) {}
  var days = []; for (var i = 0; i < horizon; i++) days.push(_v76AddDays_(asOf, i));
  var perDay = days.map(function (d) { return { day: _v76Iso_(d), weekday: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][d.getDay()], portions: 0, revenue: 0, cost: 0, basis: wdCount[d.getDay()] ? 'по ' + wdCount[d.getDay()] + ' таким же дням недели' : nWork ? 'среднее рабочего дня (такого дня недели в истории нет)' : 'нет истории' }; });
  var dishes = Object.keys(dish).map(function (k) {
    var x = dish[k], ppp = x.qty > 0 ? x.revenue / x.qty : 0, cpp = x.qty > 0 ? x.cost / x.qty : 0, total = 0;
    days.forEach(function (d, j) { var wd = d.getDay(), q = wdCount[wd] ? x.qtyByWd[wd] / wdCount[wd] : nWork ? x.qty / nWork : 0;
      var mp = null; try { mp = _v64PriceFor_(prices, x.dish, '', d); } catch (e) {}
      perDay[j].portions += q; perDay[j].revenue += q * (mp ? mp.price : ppp); perDay[j].cost += q * cpp; total += q; });
    return { dish: x.dish, code: x.code, histQty: _v64R3_(x.qty), perWorkDay: nWork ? _v64R2_(x.qty / nWork) : 0, forecastQty: Math.round(total * 10) / 10, avgPrice: _v64R2_(ppp) };
  }).filter(function (x) { return x.forecastQty > 0; }).sort(function (a, b) { return b.forecastQty - a.forecastQty; });
  perDay.forEach(function (p) { p.portions = Math.round(p.portions * 10) / 10; p.revenue = _v64R2_(p.revenue); p.cost = _v64R2_(p.cost); p.foodCostPct = p.revenue > 0 ? Math.round(p.cost / p.revenue * 1000) / 10 : null; });
  // потребность в сырье по ТТК
  var idx = _v76Idx_(), memo = {}, need = {}, noTtk = [];
  dishes.forEach(function (x) { var t = _v76FindDish_(idx, x.code || x.dish) || _v76FindDish_(idx, x.dish); if (!t || !(t.ing || []).length) { noTtk.push(x.dish); return; }
    var n = _v76Explode_(idx, t, x.forecastQty, memo); Object.keys(n).forEach(function (k) { var y = need[k] || (need[k] = { name: n[k].name, base: n[k].base, qty: 0, dishes: [] }); y.qty += n[k].qty; y.dishes.push(x.dish); }); });
  var stock = _v76Stock_(), ordered = _v76Ordered_(asOf), last = {};
  _v76Purchases_().forEach(function (p) { last[p.key] = p; });
  var items = Object.keys(need).map(function (k) {
    var n = need[k], s = stock[k] || { onHand: 0, min: 0, unit: '' }, std = _v76Std_(n.base), f = std.factor, o = ordered[k] || 0, lp = last[k] || null;
    var toOrder = Math.max(0, n.qty + s.min - s.onHand - o);
    return { key: k, product: n.name, unit: std.unit, need: _v64R3_(n.qty / f), onHand: _v64R3_(s.onHand / f), minStock: _v64R3_(s.min / f), ordered: _v64R3_(o / f), toOrder: _v64R3_(toOrder / f),
      supplier: lp ? lp.supplier : '', lastPrice: lp ? _v64R2_(lp.priceBase * f) : null, estAmount: lp ? _v64R2_(toOrder * lp.priceBase) : null, dishes: n.dishes.slice(0, 5).join(', '), noStockRow: !stock[k] };
  }).sort(function (a, b) { return (b.toOrder > 0) - (a.toOrder > 0) || (b.estAmount || 0) - (a.estAmount || 0) || (a.product < b.product ? -1 : 1); });
  var tot = function (k) { return _v64R2_(perDay.reduce(function (s, p) { return s + p[k]; }, 0)); };
  return { asOf: _v76Iso_(asOf), from: _v76Iso_(days[0]), to: _v76Iso_(days[days.length - 1]), days: horizon, weeks: weeks, historyFrom: fromIso, historyTo: toIso, workDays: nWork,
    perDay: perDay, dishes: dishes, items: items, toOrder: items.filter(function (x) { return x.toOrder > 0; }), noTtk: noTtk,
    totals: { revenue: tot('revenue'), cost: tot('cost'), portions: Math.round(perDay.reduce(function (s, p) { return s + p.portions; }, 0) * 10) / 10,
      foodCostPct: tot('revenue') > 0 ? Math.round(tot('cost') / tot('revenue') * 1000) / 10 : null, orderAmount: _v64R2_(items.reduce(function (s, x) { return s + (x.toOrder > 0 && x.estAmount ? x.estAmount : 0); }, 0)),
      orderLines: items.filter(function (x) { return x.toOrder > 0; }).length } };
}
/** Для сводки руководителя: рост цен закупки за период. */
function _v76Brief_(fromIso, toIso) {
  var T = _v73Targets_(), rg = _v64Range_(fromIso, toIso), st = _v76PriceStats_(_v76Purchases_(), rg, T).filter(function (s) { return s.purchases > 0; });
  return { rises: st.filter(function (s) { return s.flags.indexOf('PRICE_UP') >= 0; }).sort(function (a, b) { return Math.max(b.changePct || 0, b.vsAvg90Pct || 0) - Math.max(a.changePct || 0, a.vsAvg90Pct || 0); }),
    saving: _v64R2_(st.reduce(function (s, x) { return s + (x.saving || 0); }, 0)), threshold: T.priceRisePct, costEvents: (function () { try { return _v76CostEvents_(rg); } catch (e) { return []; } })() };
}

/* ---------------- публичные функции ---------------- */
/** Меню-инжиниринг за период (Kasavana–Smith) с рекомендациями. */
function v76GetMenuEngineering(token, fromDate, toDate) {
  try {
    _requireAuth_(token, 'finance_view');
    _v73Fresh_();
    var rg = _v64Range_(fromDate, toDate), T = _v73Targets_(), M = _v76Menu_(rg, T), w = [];
    if (M.S.stale) w.push({ level: 'gold', text: 'Итоги давно не сверялись — нажмите «Обновить» в сводке.' });
    var noCost = M.items.filter(function (x) { return x.flags.indexOf('NO_COST') >= 0; });
    if (noCost.length) w.push({ level: 'red', text: 'Блюд без себестоимости: ' + noCost.length + ' (' + noCost.slice(0, 3).map(function (x) { return x.dish; }).join(', ') + ') — их вклад завышен, классы условны.' });
    if (M.totals.dishes && M.totals.dishes < 4) w.push({ level: 'gold', text: 'Продано меньше 4 блюд — матрица мало что говорит, возьмите период длиннее.' });
    if (M.S.totals.missingSalePrice) w.push({ level: 'gold', text: 'Продаж без цены: ' + M.S.totals.missingSalePrice + ' — их выручка не учтена.' });
    return _ok_({ from: rg.fromIso, to: rg.toIso, items: M.items, classes: M.classes, unsold: M.unsold, totals: M.totals, thresholds: M.thresholds, targets: T, warnings: w,
      note: 'Матрица Kasavana–Smith: популярность — доля в проданных порциях против 70 % средней доли; доходность — валовой вклад на порцию против среднего по меню. Продажи и себестоимость — из дневных итогов (партии FEFO).' });
  } catch (e) { return _failFrom_(e); }
}
/** Закупки за период: поставщики, цены продуктов, рост цен, дешевле у другого поставщика, влияние на блюда. */
function v76GetProcurement(token, fromDate, toDate) {
  try {
    _requireAuth_(token, 'finance_view');
    var rg = _v64Range_(fromDate, toDate), T = _v73Targets_(), R = _v76Procurement_(rg, T);
    return _ok_(Object.assign({ from: rg.fromIso, to: rg.toIso, threshold: T.priceRisePct,
      note: 'Цены — по партиям приёмки (Склад_Партии и паспорт приёмки), приведены к кг / л / шт. Рост цены — от 1 копейки за кг / л / шт' + (T.priceRisePct ? ' и от ' + T.priceRisePct + ' %' : '') + ' к предыдущей закупке или к средней за 90 дней до периода. Влияние на блюдо — по действующей ТТК (сырьё по брутто).' }, R));
  } catch (e) { return _failFrom_(e); }
}
/** Прогноз продаж и потребности в продуктах. json: {days: 7, weeks: 8, asOf?}. */
function v76GetForecast(json, token) {
  try {
    _requireAuth_(token, 'finance_view');
    var F = _v76Forecast_(_v64Json_(json)), w = [];
    if (!F.workDays) w.push({ level: 'red', text: 'В истории нет дней с продажами — прогноз пустой. Вносите продажи (вручную или файлом) и обновите итоги.' });
    else if (F.workDays < 21) w.push({ level: 'gold', text: 'Истории мало: ' + F.workDays + ' рабочих дней. Прогноз грубый, станет точнее через несколько недель.' });
    if (F.noTtk.length) w.push({ level: 'gold', text: 'Нет техкарты, потребность не посчитана: ' + F.noTtk.slice(0, 5).join(', ') + (F.noTtk.length > 5 ? ' и ещё ' + (F.noTtk.length - 5) : '') });
    var noRow = F.toOrder.filter(function (x) { return x.noStockRow; });
    if (noRow.length) w.push({ level: 'gold', text: 'Нет строки остатка на складе (остаток считается нулём): ' + noRow.slice(0, 5).map(function (x) { return x.product; }).join(', ') });
    F.warnings = w;
    F.note = 'Прогноз — среднее продаж каждого блюда по дню недели за ' + F.weeks + ' нед. (только дни с выручкой); выручка — по действующей цене меню, иначе по средней цене продажи. К заказу = потребность по ТТК + мин. запас − остаток − уже заказано (заявки за ' + MC_V76_REQ_DAYS + ' дней).';
    return _ok_(F);
  } catch (e) { return _failFrom_(e); }
}
/**
 * Создать заявки на закупку по прогнозу в лист V21 «Закупки_V21» (дальше — обычный путь: заказ поставщику → приёмка).
 * json: {days, weeks, asOf?, products?: [ключи], qty?: {ключ: количество в ед. показа}}. Повторно та же позиция того же прогноза не создаётся.
 */
function v76CreateOrderRequests(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'procurement|stock', 'V76_ORDER', 'Закупки', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), F = _v76Forecast_(d), pick = d.products && d.products.length ? d.products : null, qty = d.qty || {};
    var planId = 'FC-' + F.from.replace(/-/g, '') + '-' + F.days, actor = _v64Who_(op), created = [], skipped = [];
    var res = _withLock_(function () {
      var sh = _mcV21Purchase_(), v = sh.getDataRange().getValues(), known = {}, now = new Date();
      for (var i = 1; i < v.length; i++) if (String(v[i][1]) === planId && String(v[i][7]) !== 'CANCELLED') known[_v64Key_(v[i][3]) + '|' + _v76Base_(v[i][4]).unit] = 1;
      F.toOrder.forEach(function (x) {
        if (pick && pick.indexOf(x.key) < 0) return;
        if (known[x.key]) { skipped.push({ product: x.product, reason: 'уже есть в заявке ' + planId }); return; }
        var q = qty[x.key] !== undefined && qty[x.key] !== '' ? _v64Num_(qty[x.key]) : x.toOrder;
        if (!(q > 0)) { skipped.push({ product: x.product, reason: 'количество 0' }); return; }
        var id = 'REQ-' + Date.now() + '-' + Utilities.getUuid().slice(0, 4).toUpperCase();
        sh.appendRow([id, planId, F.from, x.product, x.unit, _v64R3_(q), x.supplier || 'НЕ НАЗНАЧЕН', 'OPEN', '', now, actor, now]);
        known[x.key] = 1; created.push({ requestId: id, product: x.product, unit: x.unit, qty: _v64R3_(q), supplier: x.supplier || 'НЕ НАЗНАЧЕН' });
      });
      return { planId: planId, created: created, skipped: skipped };
    });
    _audit_(op, 'V76_ORDER', 'Закупки_V21', planId, null, { created: created.length, skipped: skipped.length, from: F.from, to: F.to }); _endOp_(op);
    res.note = created.length ? 'Заявки созданы (' + created.length + '). Заказы поставщикам — кнопкой «Заказы поставщикам» или в разделе закупок.' : 'Новых заявок нет.';
    return _ok_(res, op.id);
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- подорожание при приёмке: пересчёт себестоимости блюд и уведомление ---------------- */
var MC_V76_EV = ['Фин_Себестоимость_События', ['EventID', 'At', 'BatchID', 'Product', 'Unit', 'Supplier', 'PrevPrice', 'NewPrice', 'ChangePct', 'PrevDate', 'PrevSupplier',
  'Dish', 'DishCode', 'NeedPerPortion', 'DeltaPerPortion', 'CostBefore', 'CostAfter', 'MenuPrice', 'FoodCostBefore', 'FoodCostAfter', 'NotificationID']];
var _V76_RUN_ = null;   // кэш одного выполнения: индексы ТТК, раскладка блюд, последние цены, партии этого выполнения
function _v76Run_() {
  if (_V76_RUN_) return _V76_RUN_;
  var P = _v76Purchases_(), last = {};
  P.forEach(function (p) { last[p.key] = p; });
  return (_V76_RUN_ = { idx: _v76Idx_(), memo: {}, P: P, last: last, fresh: [] });
}
/**
 * Себестоимость порции блюда по последним ценам закупки: { cost, missing[] }.
 * Сырьё — по ТТК (п/ф раскладываются до сырья); нет закупки — средняя цена склада.
 */
function _v76DishCostByLast_(R, d) {
  var need = _v76Explode_(R.idx, d, 1, R.memo), cost = 0, missing = [];
  Object.keys(need).forEach(function (k) { var p = R.last[k], pb = p ? p.priceBase : 0;
    if (!(pb > 0)) { try { pb = _currentAvgPrice_(need[k].name, need[k].base) || 0; } catch (e) { pb = 0; } }
    if (!(pb > 0)) missing.push(need[k].name); cost += need[k].qty * pb; });
  return { cost: cost, missing: missing, need: need };
}
/**
 * Хук приёмки (_createBatch_): новая закупочная партия. Если цена выше предыдущей закупки этого продукта хотя бы на 1 копейку
 * за кг / л / шт — пересчитать себестоимость блюд с этим продуктом, записать событие и уведомить. Ошибка здесь приёмку не отменяет.
 * price — цена за единицу партии (unit — единица партии).
 */
function _v76OnPurchase_(batchId, name, unit, price, qty, source, extra) {
  extra = extra || {};
  var src = String(source || '');
  if (!(Number(price) > 0) || src === 'REVISION_FOUND' || /^(Производство|Выпуск|Зачистка|Разбор)\s/.test(src)) return null;
  var R = _v76Run_(), key = _v76Pk_(name, unit), std = _v76Std_(unit), pb = _v76PerBase_(Number(price), unit), now = new Date(), T = _v73Targets_();
  // предыдущая закупка: последняя партия этого продукта раньше этой (в том числе принятая в этом же выполнении)
  var prev = null;
  R.P.concat(R.fresh).forEach(function (p) { if (p.key === key && p.batchId !== batchId && (!prev || p.date >= prev.date)) prev = p; });
  var mine = { batchId: String(batchId), date: now, day: _v76Iso_(now), product: String(name), key: key, base: std.base, stdUnit: std.unit, factor: std.factor,
    supplier: String(extra.supplier || src || '—'), qtyBase: Number(qty) * _v76Base_(unit).qty, priceBase: pb, amount: _v64R2_(Number(qty) * Number(price)) };
  R.fresh.push(mine);
  if (!prev || !_v76IsRise_(pb, prev.priceBase, std.factor, T)) { R.last[key] = mine; return null; }
  // себестоимость блюд до и после — по последним ценам закупки, меняется только этот продукт
  var before = Object.assign({}, R.last); before[key] = prev; var after = Object.assign({}, R.last); after[key] = mine; R.last = after;
  var prices = []; try { prices = _v64MenuPrices_(); } catch (e) {}
  var dishes = [];
  Object.keys(R.idx.dishByCode).forEach(function (c) {
    var d = R.idx.dishByCode[c]; if (d.semi || !(d.ing || []).length) return;
    var need = _v76Explode_(R.idx, d, 1, R.memo); if (!need[key]) return;
    var cb = _v76DishCostByLast_({ idx: R.idx, memo: R.memo, last: before }, d).cost, ca = _v76DishCostByLast_({ idx: R.idx, memo: R.memo, last: after }, d).cost;
    var delta = need[key].qty * (pb - prev.priceBase); if (!(delta > 0)) return;
    var mp = null; try { mp = _v64PriceFor_(prices, d.name, '', now); } catch (e) {}
    dishes.push({ dish: d.name, code: d.code, need: _v64R3_(need[key].qty), delta: delta >= 0.01 ? _v64R2_(delta) : Math.round(delta * 10000) / 10000,   // меньше копейки — до сотых копейки, чтобы не показать «+0»
      before: _v64R2_(cb), after: _v64R2_(ca), menuPrice: mp ? mp.price : null,
      fcBefore: mp ? Math.round(cb / mp.price * 1000) / 10 : null, fcAfter: mp ? Math.round(ca / mp.price * 1000) / 10 : null });
  });
  dishes.sort(function (a, b) { return b.delta - a.delta; });
  var f = std.factor, np = _v64R2_(pb * f), op = _v64R2_(prev.priceBase * f), pct = Math.round((pb - prev.priceBase) / prev.priceBase * 1000) / 10, evId = 'CE-' + Utilities.getUuid().slice(0, 8).toUpperCase();
  var title = 'Подорожание: ' + mine.product + ' ' + op + ' → ' + np + ' ₽/' + std.unit + ' (+' + _v64R2_(np - op) + ' ₽, +' + pct + '%)';
  var text = 'Партия ' + batchId + (mine.supplier && mine.supplier !== '—' ? ', ' + mine.supplier : '') + '; прежняя цена ' + op + ' ₽ от ' + prev.day + (prev.supplier && prev.supplier !== '—' ? ' (' + prev.supplier + ')' : '') + '. ' +
    (dishes.length ? 'Себестоимость порции выросла: ' + dishes.slice(0, 5).map(function (x) { return x.dish + ' +' + x.delta + ' ₽ (' + x.before + ' → ' + x.after + ' ₽' + (x.fcAfter !== null ? ', food cost ' + x.fcBefore + ' → ' + x.fcAfter + '%' : '') + ')'; }).join('; ') +
      (dishes.length > 5 ? '; ещё блюд: ' + (dishes.length - 5) : '') + '. Экономика → Закупки.' : 'В действующих ТТК продукт не используется.');
  var nid = null; try { nid = _notify_('cost_up', 'warning', title, text, 'Шеф-повар', 'cost_up|' + batchId, null); } catch (e) {}
  var sh = _v64Sheet_(MC_V76_EV[0], MC_V76_EV[1]), H = MC_V76_EV[1], row = function (o) { return H.map(function (h) { return o[h] === undefined || o[h] === null ? '' : o[h]; }); };
  var base = { EventID: evId, At: now, BatchID: String(batchId), Product: mine.product, Unit: std.unit, Supplier: mine.supplier, PrevPrice: op, NewPrice: np, ChangePct: pct, PrevDate: prev.day, PrevSupplier: prev.supplier, NotificationID: nid || '' };
  (dishes.length ? dishes : [null]).forEach(function (x) { sh.appendRow(row(x ? Object.assign({}, base, { Dish: x.dish, DishCode: x.code, NeedPerPortion: x.need, DeltaPerPortion: x.delta, CostBefore: x.before, CostAfter: x.after,
    MenuPrice: x.menuPrice, FoodCostBefore: x.fcBefore, FoodCostAfter: x.fcAfter }) : base)); });
  _V64_TAB_ = {};
  return { eventId: evId, product: mine.product, prevPrice: op, newPrice: np, changePct: pct, dishes: dishes, notificationId: nid };
}
/** События подорожания за период (для экрана «Закупки» и сводки руководителя). */
function _v76CostEvents_(rg) {
  var t = _v64Tab_(MC_V76_EV[0]), out = [];
  t.rows.forEach(function (r) { var at = _v64Date_(_v64G_(t, r, 'At')); if (!at || !_v64In_(at, rg)) return; var o = { at: Utilities.formatDate(at, _mcTz_(), 'yyyy-MM-dd HH:mm') };
    MC_V76_EV[1].forEach(function (h) { if (h !== 'At') o[h.charAt(0).toLowerCase() + h.slice(1)] = _v64G_(t, r, h); }); out.push(o); });
  return out.reverse();
}
