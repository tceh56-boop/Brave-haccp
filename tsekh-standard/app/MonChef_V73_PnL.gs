// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
/**
 * ЦЕХ Стандарт V73 — «ЦЕХ Финансы и Экономика», этап 3: управленческий P&L и CEO Dashboard.
 *
 * Источник — только дневные итоги этапа 2 (Фин_Итоги_День, Фин_Итоги_Блюдо_День): экран не пересобирает журнал
 * и не вводит своих данных. Каждая строка P&L — сумма тех же первичных операций, что и в «Экономике потока» V64:
 *   выручка − себестоимость продуктов − упаковка = валовая прибыль;
 *   − списания и брак − дефрост − возвраты − инвентаризация (недостача − излишек) = вклад после потерь;
 *   − ФОТ (статья «Фонд оплаты труда»; табель и Labor Cost — этап 4) − прочие управленческие расходы по статьям
 *   − корректировки закрытых периодов = EBITDA; − амортизация = операционная прибыль.
 * Сравнение — с предыдущим периодом той же длины. Показатели без данных не подменяются: если, например,
 * ФОТ не внесён, строка равна нулю и в «Сигналах» есть предупреждение.
 *
 * Ориентиры (food cost, labor cost, prime cost, потери, маржа блюда) — настройка предприятия (v73SetTargets);
 * значения по умолчанию — типовые для общепита, их стоит заменить своими.
 * Точка = предприятие (решение 14.11.2026). Управленческий учёт, бухгалтерский не заменяет.
 */
var MC_V73_LABOR_CAT = 'Фонд оплаты труда';
var MC_V73_DEPR_CAT = 'Амортизация оборудования';
var MC_V73_TARGETS_DEFAULT = { foodCostPct: 32, laborPct: 30, primeCostPct: 62, lossPct: 3, minDishMarginPct: 60, priceRisePct: 10 };
var MC_V73_TARGET_RU = { foodCostPct: 'Food cost, % выручки (не выше)', laborPct: 'Labor cost, % выручки (не выше)', primeCostPct: 'Prime cost, % выручки (не выше)',
  lossPct: 'Потери, % выручки (не выше)', minDishMarginPct: 'Маржа блюда, % (не ниже)', priceRisePct: 'Рост цены закупки для сигнала, %' };

/* ---------------- служебное ---------------- */
function _v73Targets_() {
  var t = JSON.parse(JSON.stringify(MC_V73_TARGETS_DEFAULT)), own = {};
  try { own = JSON.parse(PropertiesService.getScriptProperties().getProperty('MC_V73_TARGETS') || '{}') || {}; } catch (e) {}
  Object.keys(t).forEach(function (k) { if (own[k] !== undefined && own[k] !== '' && isFinite(Number(own[k]))) t[k] = Number(own[k]); });
  t.custom = Object.keys(own).length > 0;
  return t;
}
function _v73Pct_(a, b) { return b > 0 ? Math.round(a / b * 1000) / 10 : null; }
function _v73Iso_(d) { return Utilities.formatDate(d, _mcTz_(), 'yyyy-MM-dd'); }
function _v73D_(iso) { var p = String(iso).split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
/** Предыдущий период той же длины, вплотную перед текущим. */
function _v73Prev_(fromIso, toIso) {
  var f = _v73D_(fromIso), t = _v73D_(toIso), n = Math.round((t - f) / 86400000) + 1;
  var pt = new Date(f.getFullYear(), f.getMonth(), f.getDate() - 1), pf = new Date(f.getFullYear(), f.getMonth(), f.getDate() - n);
  return { fromIso: _v73Iso_(pf), toIso: _v73Iso_(pt), days: n };
}
/** Итоги давно не сверялись (или ни разу) — сверить сейчас, чтобы экран не показал устаревшие цифры. */
function _v73Fresh_() {
  var last = _v72Last_(), age = last && last.at ? (Date.now() - new Date(last.at).getTime()) / 60000 : null;
  if (age !== null && age <= MC_V72_STALE_MIN) return null;
  try { return _v72SyncCore_({}, null); } catch (e) { try { _log_('WARN', 'V73: сверка перед отчётом не выполнена: ' + e); } catch (e2) {} return null; }
}

/** P&L из сводки _v72Sum_: строки и коэффициенты. */
function _v73Build_(S) {
  var t = S.totals, ec = JSON.parse(JSON.stringify(S.expByCategory || {})), R = t.revenue || 0;
  var laborExp = _v64R2_(ec[MC_V73_LABOR_CAT] || 0), laborBonus = _v64R2_(t.laborBonus || 0), laborBase = _v64R2_((t.labor || 0) - laborBonus);
  var labor = _v64R2_(laborExp + laborBase + laborBonus), depr = _v64R2_(ec[MC_V73_DEPR_CAT] || 0); delete ec[MC_V73_LABOR_CAT]; delete ec[MC_V73_DEPR_CAT];
  var cats = MC_V64_EXP_CATS.filter(function (c) { return c !== MC_V73_LABOR_CAT && c !== MC_V73_DEPR_CAT; });
  Object.keys(ec).forEach(function (c) { if (cats.indexOf(c) < 0) cats.push(c); });
  var opex = _v64R2_(cats.reduce(function (a, c) { return a + (ec[c] || 0); }, 0));
  var inv = _v64R2_(t.inventoryShortage - t.inventorySurplus), losses = _v64R2_(t.wasteCost + t.defrostLoss + t.returnsCost + inv);
  var ebitda = _v64R2_(t.contributionAfterLosses - labor - opex - t.corrections), op = _v64R2_(ebitda - depr);
  var L = [];
  var add = function (code, title, amount, kind, level) { L.push({ code: code, title: title, amount: _v64R2_(amount), kind: kind, level: level || 0, pct: _v73Pct_(amount, R) }); };
  add('REVENUE', 'Выручка', R, 'income');
  add('COGS', 'Себестоимость продуктов (по партиям FEFO)', t.cogs, 'cost', 1);
  add('PACKAGING', 'Упаковка', t.packaging, 'cost', 1);
  add('GROSS', 'Валовая прибыль', t.grossContribution, 'total');
  add('WASTE', 'Списания и брак', t.wasteCost, 'cost', 1);
  add('DEFROST', 'Потери дефроста', t.defrostLoss, 'cost', 1);
  add('RETURNS', 'Возвраты', t.returnsCost, 'cost', 1);
  add('INVENTORY', 'Инвентаризация: недостача − излишек', inv, 'cost', 1);
  add('AFTER_LOSSES', 'Вклад после потерь', t.contributionAfterLosses, 'total');
  add('LABOR', 'ФОТ (Labor Cost), всего', labor, 'subtotal', 1);
  if (laborBase || t.laborHours) add('LABOR_TIMESHEET', 'по сменам и табелю: ставка × часы (' + _v64R2_(t.laborHours || 0) + ' ч)', laborBase, 'cost', 2);
  if (laborBonus) add('LABOR_BONUS', 'премии − удержания (подтверждённые)', laborBonus, 'cost', 2);
  if (laborExp) add('LABOR_EXPENSE', 'расход «Фонд оплаты труда»', laborExp, 'cost', 2);
  cats.forEach(function (c) { if (ec[c]) add('OPEX:' + c, c, ec[c], 'cost', 1); });
  add('OPEX', 'Прочие управленческие расходы, всего', opex, 'subtotal', 1);
  if (t.corrections) add('CORRECTIONS', 'Корректировки закрытых периодов', t.corrections, 'cost', 1);
  add('EBITDA', 'EBITDA (до амортизации)', ebitda, 'total');
  add('DEPRECIATION', 'Амортизация оборудования', depr, 'cost', 1);
  add('OPERATING', 'Операционная прибыль', op, 'total');
  var ratios = { foodCostPct: _v73Pct_(t.cogs, R), packagingPct: _v73Pct_(t.packaging, R), laborPct: _v73Pct_(labor, R), primeCostPct: _v73Pct_(t.cogs + t.packaging + labor, R),
    lossPct: _v73Pct_(losses, R), grossMarginPct: t.marginPct, ebitdaPct: _v73Pct_(ebitda, R), operatingMarginPct: _v73Pct_(op, R) };
  return { lines: L, ratios: ratios, figures: { revenue: R, cogs: t.cogs, packaging: t.packaging, gross: t.grossContribution, losses: losses, labor: labor, opex: opex, corrections: t.corrections,
    ebitda: ebitda, depreciation: depr, operating: op, afterLosses: t.contributionAfterLosses, laborTimesheet: _v64R2_(laborBase + laborBonus), laborExpense: laborExp,
    laborHours: _v64R2_(t.laborHours || 0), revenuePerLaborHour: t.laborHours > 0 ? _v64R2_(R / t.laborHours) : null }, totals: t };
}
function _v73Delta_(cur, prev) {
  if (cur === null || cur === undefined || prev === null || prev === undefined) return { prev: prev === undefined ? null : prev, delta: null, deltaPct: null };
  return { prev: prev, delta: _v64R2_(cur - prev), deltaPct: prev !== 0 ? Math.round((cur - prev) / Math.abs(prev) * 1000) / 10 : null };
}
/** Предупреждения о качестве данных — цифры показываются, но с честной пометкой, что в них не попало. */
function _v73Quality_(S, P) {
  var t = S.totals, w = [];
  if (t.missingSalePrice) w.push({ level: 'red', code: 'MISSING_SALE_PRICE', text: 'Продаж без цены: ' + t.missingSalePrice + ' — выручка занижена. Внесите цену меню.' });
  if (t.missingPrice) w.push({ level: 'red', code: 'MISSING_PRICE', text: 'Записей без цены закупки: ' + t.missingPrice + ' — себестоимость занижена.' });
  if (t.revenue > 0 && !P.figures.labor) w.push({ level: 'gold', code: 'NO_LABOR', text: 'ФОТ за период не внесён: Labor cost и prime cost неполные. Закрывайте смены, вносите часы в табель и ставки (Экономика → ФОТ).' });
  if (t.laborNoRate) w.push({ level: 'red', code: 'LABOR_NO_RATE', text: 'Смен и записей табеля без ставки: ' + t.laborNoRate + ' — Labor cost занижен. Внесите ставку сотрудника или роли.' });
  if (P.figures.laborTimesheet && P.figures.laborExpense) w.push({ level: 'gold', code: 'LABOR_DOUBLE', text: 'ФОТ есть и в табеле, и в расходе «Фонд оплаты труда» — проверьте, что расход не повторяет табель (например, только оклады и налоги).' });
  if (S.expByCategory && S.expByCategory['Без разбивки по статьям']) w.push({ level: 'gold', code: 'EXP_NO_SPLIT', text: 'Часть расходов посчитана до разбивки по статьям — нажмите «Обновить» с полным пересчётом.' });
  if (S.stale) w.push({ level: 'gold', code: 'STALE', text: S.lastSync ? 'Итоги сверялись ' + S.minutesSinceSync + ' мин назад — нажмите «Обновить».' : 'Итоги ещё не сверялись — нажмите «Обновить».' });
  if (S.lastSync && S.lastSync.closedChanged) w.push({ level: 'gold', code: 'CLOSED_CHANGED', text: 'Есть изменения операций в закрытых периодах: ' + S.lastSync.closedChanged + ' — нужна корректировка (реестр операций).' });
  if (t.review + t.missingEvidence) w.push({ level: 'gold', code: 'TRACE', text: 'Записей с неполной прослеживаемостью: ' + (t.review + t.missingEvidence) + '.' });
  return w;
}

/* ---------------- публичные функции ---------------- */
/** Управленческий P&L за период с сравнением с предыдущим периодом той же длины. */
function v73GetPnL(token, fromDate, toDate) {
  try {
    _requireAuth_(token, 'finance_view');
    _v73Fresh_();
    var rg = _v64Range_(fromDate, toDate), pr = _v73Prev_(rg.fromIso, rg.toIso);
    var S = _v72Sum_(rg.fromIso, rg.toIso), SP = _v72Sum_(pr.fromIso, pr.toIso), P = _v73Build_(S), PP = _v73Build_(SP);
    var prevBy = {}; PP.lines.forEach(function (l) { prevBy[l.code] = l; });
    var lines = P.lines.map(function (l) { var p = prevBy[l.code]; return Object.assign(l, _v73Delta_(l.amount, p ? p.amount : 0), { prevPct: p ? p.pct : null }); });
    PP.lines.forEach(function (l) { if (!P.lines.some(function (x) { return x.code === l.code; })) lines.push(Object.assign({}, l, { amount: 0, pct: null }, _v73Delta_(0, l.amount), { prevPct: l.pct })); });
    var ratios = {}; Object.keys(P.ratios).forEach(function (k) { ratios[k] = Object.assign({ value: P.ratios[k] }, _v73Delta_(P.ratios[k], PP.ratios[k])); });
    return _ok_({ from: rg.fromIso, to: rg.toIso, prevFrom: pr.fromIso, prevTo: pr.toIso, days: pr.days, lines: lines, ratios: ratios, figures: P.figures,
      warnings: _v73Quality_(S, P), lastSync: S.lastSync, frozenDays: S.frozenDays,
      note: 'Управленческий P&L из дневных итогов реестра операций. Не заменяет бухгалтерскую отчётность.' });
  } catch (e) { return _failFrom_(e); }
}
/** CEO Dashboard: ключевые показатели с динамикой, по дням, блюда, потери по причинам, сигналы. */
function v73GetCeoDashboard(token, fromDate, toDate) {
  try {
    _requireAuth_(token, 'finance_view');
    _v73Fresh_();
    var rg = _v64Range_(fromDate, toDate), pr = _v73Prev_(rg.fromIso, rg.toIso), T = _v73Targets_();
    var S = _v72Sum_(rg.fromIso, rg.toIso), SP = _v72Sum_(pr.fromIso, pr.toIso), P = _v73Build_(S), PP = _v73Build_(SP), f = P.figures, pf = PP.figures;
    var qty = S.dishes.reduce(function (a, d) { return a + d.qty; }, 0), pqty = SP.dishes.reduce(function (a, d) { return a + d.qty; }, 0);
    // tone: good / bad / '' — по ориентиру (для %) или по направлению изменения (для сумм)
    var k = function (code, title, unit, v, pv, opts) {
      opts = opts || {}; var x = Object.assign({ code: code, title: title, unit: unit, value: v }, _v73Delta_(v, pv)), tone = '';
      if (opts.max !== undefined && v !== null) tone = v > opts.max ? 'bad' : 'good';
      else if (opts.min !== undefined && v !== null) tone = v < opts.min ? 'bad' : 'good';
      else if (x.delta) tone = (x.delta > 0) === (opts.lowerBetter ? false : true) ? 'good' : 'bad';
      x.tone = tone; if (opts.max !== undefined) x.target = opts.max; if (opts.min !== undefined) x.target = opts.min; return x;
    };
    var kpis = [
      k('REVENUE', 'Выручка', '₽', f.revenue, pf.revenue),
      k('GROSS', 'Валовая прибыль', '₽', f.gross, pf.gross),
      k('GROSS_MARGIN', 'Валовая маржа', '%', P.ratios.grossMarginPct, PP.ratios.grossMarginPct),
      k('FOOD_COST', 'Food cost', '%', P.ratios.foodCostPct, PP.ratios.foodCostPct, { max: T.foodCostPct }),
      k('LABOR_COST', 'Labor cost', '%', P.ratios.laborPct, PP.ratios.laborPct, f.labor ? { max: T.laborPct } : {}),
      k('PRIME_COST', 'Prime cost', '%', P.ratios.primeCostPct, PP.ratios.primeCostPct, f.labor ? { max: T.primeCostPct } : {}),
      k('LOSSES', 'Потери', '₽', f.losses, pf.losses, { lowerBetter: true }),
      k('LOSS_PCT', 'Потери', '%', P.ratios.lossPct, PP.ratios.lossPct, { max: T.lossPct }),
      k('EBITDA', 'EBITDA', '₽', f.ebitda, pf.ebitda),
      k('OPERATING', 'Операционная прибыль', '₽', f.operating, pf.operating),
      k('PORTIONS', 'Продано порций', 'шт.', _v64R3_(qty), _v64R3_(pqty)),
      k('LABOR_HOURS', 'Часы труда', 'ч', f.laborHours, pf.laborHours, { lowerBetter: true }),
      k('REVENUE_PER_HOUR', 'Выручка на час труда', '₽', f.revenuePerLaborHour, pf.revenuePerLaborHour)
    ];
    var signals = _v73Quality_(S, P);
    var over = function (code, v, max, text) { if (v !== null && v > max) signals.unshift({ level: 'red', code: code, text: text + ': ' + v + '% при ориентире ' + max + '%' }); };
    over('FOOD_COST_HIGH', P.ratios.foodCostPct, T.foodCostPct, 'Food cost выше ориентира');
    if (f.labor) { over('LABOR_HIGH', P.ratios.laborPct, T.laborPct, 'Labor cost выше ориентира'); over('PRIME_HIGH', P.ratios.primeCostPct, T.primeCostPct, 'Prime cost выше ориентира'); }
    over('LOSS_HIGH', P.ratios.lossPct, T.lossPct, 'Потери выше ориентира');
    var weak = S.dishes.filter(function (d) { return d.revenue > 0 && d.marginPct !== null && d.marginPct < T.minDishMarginPct; }).sort(function (a, b) { return a.marginPct - b.marginPct; });
    if (weak.length) signals.push({ level: weak[0].marginPct < 0 ? 'red' : 'gold', code: 'WEAK_DISHES', text: 'Блюд с маржой ниже ' + T.minDishMarginPct + '%: ' + weak.length + ' (хуже всех — ' + weak[0].dish + ', ' + weak[0].marginPct + '%)' });
    // этап 5: деньги — остаток на конец периода, неразнесённые движения, долги поставщикам
    var cash = null; try { cash = typeof _v75Brief_ === 'function' ? _v75Brief_(rg.toIso) : null; } catch (e) {}
    if (cash) {
      kpis.push({ code: 'CASH_BALANCE', title: 'Деньги на конец периода', unit: '₽', value: cash.balance, prev: null, delta: null, deltaPct: null, tone: cash.balance < 0 ? 'bad' : '' });
      kpis.push({ code: 'SUPPLIER_DEBT', title: 'Долг поставщикам', unit: '₽', value: cash.debt, prev: null, delta: null, deltaPct: null, tone: cash.overdue30.length ? 'bad' : '' });
      cash.negative.forEach(function (a) { signals.push({ level: 'red', code: 'CASH_NEGATIVE', text: 'Отрицательный остаток «' + a.name + '»: ' + a.balance + ' ₽' }); });
      if (cash.uncategorized) signals.push({ level: 'gold', code: 'CASH_UNCATEGORIZED', text: 'Движений денег не разнесено по статьям: ' + cash.uncategorized });
      if (cash.overdue30.length) signals.push({ level: 'gold', code: 'SUPPLIER_DEBT_OLD', text: 'Неоплаченные накладные старше 30 дней: ' + cash.overdue30.map(function (p) { return p.supplier + ' ' + p.debt + ' ₽'; }).slice(0, 3).join('; ') });
    }
    // этап 6: рост цен закупки за период и возможная экономия у другого поставщика
    var buy = null; try { buy = typeof _v76Brief_ === 'function' ? _v76Brief_(rg.fromIso, rg.toIso) : null; } catch (e) {}
    if (buy && buy.rises.length) signals.push({ level: 'gold', code: 'PRICE_UP', text: 'Рост цены закупки от ' + buy.threshold + '%: ' + buy.rises.slice(0, 3).map(function (x) { var c = Math.max(x.changePct || 0, x.vsAvg90Pct || 0); return x.product + ' +' + c + '% (' + x.lastPrice + ' ₽/' + x.unit + ')'; }).join('; ') + (buy.rises.length > 3 ? ' и ещё ' + (buy.rises.length - 3) : '') + '. Экономика → Закупки.' });
    if (buy && buy.saving >= 1) signals.push({ level: 'gold', code: 'CHEAPER_SUPPLIER', text: 'Те же продукты были дешевле у другого поставщика: возможная экономия за период ' + buy.saving + ' ₽. Экономика → Закупки.' });
    var lossDays = S.byDay.filter(function (d) { return d.revenue > 0 && d.gross < 0; });
    if (lossDays.length) signals.push({ level: 'red', code: 'NEGATIVE_DAYS', text: 'Дней с отрицательной валовой прибылью: ' + lossDays.length + ' (' + lossDays.slice(0, 3).map(function (d) { return d.day; }).join(', ') + ')' });
    if (pf.revenue > 0 && f.revenue < pf.revenue * 0.9) signals.push({ level: 'gold', code: 'REVENUE_DOWN', text: 'Выручка ниже прошлого периода на ' + Math.round((1 - f.revenue / pf.revenue) * 1000) / 10 + '%' });
    var reasons = Object.keys(S.totals.wasteByReason).map(function (c) { return { code: c, title: MC_V64_WASTE_REASON_RU[c] || (c === 'BANQUET' ? 'Брак и остаток банкета' : c), amount: S.totals.wasteByReason[c] }; })
      .sort(function (a, b) { return b.amount - a.amount; });
    return _ok_({ from: rg.fromIso, to: rg.toIso, prevFrom: pr.fromIso, prevTo: pr.toIso, kpis: kpis, byDay: S.byDay, topDishes: S.dishes.slice(0, 10), weakDishes: weak.slice(0, 10),
      lossesByReason: reasons, signals: signals, targets: T, lastSync: S.lastSync, minutesSinceSync: S.minutesSinceSync, stale: S.stale,
      note: 'Показатели из дневных итогов реестра операций; ориентиры — настройка предприятия.' });
  } catch (e) { return _failFrom_(e); }
}
function v73GetTargets(token) {
  try { _requireAuth_(token, 'finance_view'); return _ok_({ targets: _v73Targets_(), defaults: MC_V73_TARGETS_DEFAULT, titles: MC_V73_TARGET_RU }); } catch (e) { return _failFrom_(e); }
}
/** Изменить ориентиры. json: {foodCostPct, laborPct, primeCostPct, lossPct, minDishMarginPct}; пустое значение — вернуть по умолчанию. */
function v73SetTargets(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'finance_edit', 'V73_TARGETS', 'Экономика', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), before = _v73Targets_(), own = {};
    try { own = JSON.parse(PropertiesService.getScriptProperties().getProperty('MC_V73_TARGETS') || '{}') || {}; } catch (e) {}
    var bad = [];
    Object.keys(MC_V73_TARGETS_DEFAULT).forEach(function (k) {
      if (!(k in d)) return;
      if (d[k] === '' || d[k] === null) { delete own[k]; return; }
      var v = Number(String(d[k]).replace(',', '.')); if (!isFinite(v) || v < 0 || v > 100) { bad.push(MC_V73_TARGET_RU[k]); return; }
      own[k] = v;
    });
    if (bad.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Ориентир должен быть числом от 0 до 100: ' + bad.join('; ')); }
    _withLock_(function () { PropertiesService.getScriptProperties().setProperty('MC_V73_TARGETS', JSON.stringify(own)); });
    var after = _v73Targets_();
    _audit_(op, 'V73_TARGETS', 'Ориентиры экономики', 'MC_V73_TARGETS', before, after); _endOp_(op);
    return _ok_({ targets: after }, op.id);
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
