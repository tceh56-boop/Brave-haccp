/**
 * MON CHEF · КАФЕ — экономика предприятия.
 *
 * Статьи расходов (справочник с группой, типом «постоянные/переменные» и планом на месяц),
 * журнал расходов (с документом-основанием и сторно вместо удаления) и отчёт о прибылях и убытках
 * за любой период. Отчёт ничего не придумывает — собирается из первичных записей системы:
 *   выручка и себестоимость продаж    — «Кафе_Продажи» (себестоимость — по средней цене остатка на момент продажи);
 *   потери от сторно                   — себестоимость отменённых продаж (блюдо приготовлено, выручки нет);
 *   списания                           — «Акты_Списания» (по причинам) и списание просроченных партий из журнала склада;
 *   расходы                            — «Кафе_Расходы» по статьям и группам;
 *   закупки (для справки о деньгах)    — приходы журнала склада; в прибыль не идут — в прибыль идёт себестоимость.
 * Плюс: food cost, средний чек, точка безубыточности, план-факт по статьям, выручка по дням,
 * меню-инжиниринг (звёзды, лошадки, загадки, собаки) и ABC по выручке.
 */

var MC_CF_ART_ = 'Кафе_Статьи_Расходов';
var MC_CF_ART_HEAD_ = ['Код', 'Статья', 'Группа', 'Тип', 'План в месяц, ₽', 'Активна', 'Обновлено', 'Кто'];
var MC_CF_EXP_ = 'Кафе_Расходы';
var MC_CF_EXP_HEAD_ = ['ID', 'Дата', 'Период', 'Код статьи', 'Статья', 'Группа', 'Сумма, ₽', 'Оплата', 'Контрагент', 'Документ', 'Комментарий', 'Внёс', 'Статус', 'Создано', 'OperationID', 'Сторно: причина'];
var MC_CF_GROUPS_ = ['Персонал', 'Помещение', 'Коммунальные услуги', 'Оборудование и обслуживание', 'Санитария и ХАССП', 'Расходные материалы', 'Маркетинг', 'Банк и эквайринг',
  'Налоги и сборы', 'Административные', 'Прочие'];
// [код, статья, группа, тип]
var MC_CF_ART_SEED_ = [
  ['FOT', 'Заработная плата', 'Персонал', 'постоянные'], ['FOT_TAX', 'Страховые взносы с ФОТ', 'Персонал', 'постоянные'], ['STAFF_MED', 'Медосмотры и санминимум', 'Персонал', 'постоянные'],
  ['RENT', 'Аренда помещения', 'Помещение', 'постоянные'], ['UTIL_EL', 'Электроэнергия', 'Коммунальные услуги', 'переменные'], ['UTIL_WATER', 'Вода и канализация', 'Коммунальные услуги', 'переменные'],
  ['UTIL_HEAT', 'Отопление', 'Коммунальные услуги', 'постоянные'], ['WASTE', 'Вывоз отходов', 'Санитария и ХАССП', 'постоянные'], ['PEST', 'Дезинсекция и дератизация', 'Санитария и ХАССП', 'постоянные'],
  ['LAB', 'Лабораторные исследования (ППК)', 'Санитария и ХАССП', 'постоянные'], ['DETERG', 'Моющие и дезсредства', 'Санитария и ХАССП', 'переменные'],
  ['PACK', 'Упаковка и одноразовая посуда', 'Расходные материалы', 'переменные'], ['SMALLWARE', 'Инвентарь и посуда', 'Расходные материалы', 'переменные'],
  ['REPAIR', 'Ремонт и обслуживание оборудования', 'Оборудование и обслуживание', 'переменные'], ['METRO', 'Поверка приборов', 'Оборудование и обслуживание', 'постоянные'],
  ['IT', 'Связь, интернет, касса и программы', 'Административные', 'постоянные'], ['ACC', 'Бухгалтерия и юристы', 'Административные', 'постоянные'],
  ['MKT', 'Реклама и продвижение', 'Маркетинг', 'переменные'], ['DELIV', 'Агрегаторы доставки (комиссия)', 'Маркетинг', 'переменные'],
  ['ACQ', 'Эквайринг и банковское обслуживание', 'Банк и эквайринг', 'переменные'], ['TAX', 'Налоги (УСН/патент и др.)', 'Налоги и сборы', 'переменные'],
  ['FEES', 'Лицензии, ЕГАИС, маркировка', 'Налоги и сборы', 'постоянные'], ['OTHER', 'Прочие расходы', 'Прочие', 'переменные']
];

function _cfArtSheet_() {
  var sh = _cfSheet_(MC_CF_ART_, MC_CF_ART_HEAD_);
  if (sh.getLastRow() < 2) {
    var now = new Date();
    sh.getRange(2, 1, MC_CF_ART_SEED_.length, MC_CF_ART_HEAD_.length).setValues(MC_CF_ART_SEED_.map(function (a) { return [a[0], a[1], a[2], a[3], '', 'да', now, 'Система']; }));
  }
  return sh;
}
function _cfArticles_() {
  var v = _cfArtSheet_().getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) {
    var r = v[i]; if (!r[0]) continue;
    out.push({ code: String(r[0]), name: String(r[1] || ''), group: String(r[2] || 'Прочие'), type: String(r[3] || 'переменные'), plan: _cfR2_(r[4]), active: String(r[5] || 'да') !== 'нет', row: i + 1 });
  }
  return out;
}
function _cfExpenses_(per) {
  var v = _cfSheet_(MC_CF_EXP_, MC_CF_EXP_HEAD_).getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) {
    var r = v[i]; if (!r[0]) continue;
    var d = _cfDay_(r[1]); if (per && !_cfIn_(d, per)) continue;
    out.push({ row: i + 1, id: String(r[0]), date: d, period: String(r[2] || ''), code: String(r[3] || ''), article: String(r[4] || ''), group: String(r[5] || ''), sum: Number(r[6]) || 0,
      payment: String(r[7] || ''), counterparty: String(r[8] || ''), doc: String(r[9] || ''), comment: String(r[10] || ''), author: String(r[11] || ''), status: String(r[12] || 'POSTED'), cancelReason: String(r[15] || '') });
  }
  return out;
}

/** Статья расходов: добавить или изменить. json: {code?, name, group, type, plan, active} */
function mcCafeArticleSave(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'finance', 'CAFE_ARTICLE_SAVE', 'Статьи расходов', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {}, name = String(d.name || '').trim(), group = String(d.group || 'Прочие'), type = d.type === 'постоянные' ? 'постоянные' : 'переменные', plan = _cfNum_(d.plan);
    if (!name) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите название статьи', op.id); }
    if (MC_CF_GROUPS_.indexOf(group) < 0) group = 'Прочие';
    return _withLock_(function () {
      var sh = _cfArtSheet_(), arts = _cfArticles_(), code = String(d.code || '').trim(), cur = code ? arts.filter(function (a) { return a.code === code; })[0] : null, a = _author_(op);
      if (!cur && arts.some(function (x) { return x.name.toLowerCase() === name.toLowerCase(); })) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Статья «' + name + '» уже есть', op.id); }
      if (!cur) { var n = 1; while (arts.some(function (x) { return x.code === 'ST' + ('00' + n).slice(-3); })) n++; code = 'ST' + ('00' + n).slice(-3); }
      var row = [code, name, group, type, plan >= 0 ? _cfR2_(plan) : '', d.active === false ? 'нет' : 'да', new Date(), a.фио];
      if (cur) sh.getRange(cur.row, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
      _audit_(op, 'CAFE_ARTICLE_SAVE', 'Статьи расходов', code, cur ? { статья: cur.name, группа: cur.group, тип: cur.type, план: cur.plan, активна: cur.active } : null,
        { статья: name, группа: group, тип: type, план: plan >= 0 ? plan : '', активна: d.active !== false });
      _endOp_(op);
      return _ok_({ code: code, name: name }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Расход. json: {date, code, sum, payment, counterparty, doc, comment} */
function mcCafeExpenseAdd(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'finance', 'CAFE_EXPENSE_ADD', 'Расходы', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {}, sum = _cfNum_(d.sum), day = d.date ? _cfDay_(d.date) : _cfDay_(_mcNow_());
    if (!day) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Дата не распознана', op.id); }
    if (!(sum > 0)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Сумма больше нуля', op.id); }
    return _withLock_(function () {
      var art = _cfArticles_().filter(function (a) { return a.code === String(d.code || ''); })[0];
      if (!art) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Выберите статью расходов', op.id); }
      if (art.code === 'OTHER' && !String(d.comment || '').trim()) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Для «Прочих расходов» напишите, что это', op.id); }
      var sh = _cfSheet_(MC_CF_EXP_, MC_CF_EXP_HEAD_), ymd = Utilities.formatDate(day, _mcTz_(), 'yyyyMMdd'), v = sh.getDataRange().getValues(), n = 0, a = _author_(op);
      for (var i = 1; i < v.length; i++) if (String(v[i][0]).indexOf('РХ-' + ymd + '-') === 0) n++;
      var id = 'РХ-' + ymd + '-' + ('00' + (n + 1)).slice(-3);
      sh.appendRow([id, _cfRu_(day), Utilities.formatDate(day, _mcTz_(), 'yyyy-MM'), art.code, art.name, art.group, _cfR2_(sum), String(d.payment || ''), String(d.counterparty || ''),
        String(d.doc || ''), String(d.comment || ''), a.фио, 'POSTED', new Date(), op.id, '']);
      _audit_(op, 'CAFE_EXPENSE_ADD', 'Расходы', id, null, { статья: art.name, сумма: _cfR2_(sum), дата: _cfRu_(day), документ: d.doc || '', контрагент: d.counterparty || '' });
      _endOp_(op);
      return _ok_({ id: id, article: art.name, sum: _cfR2_(sum), noDoc: !String(d.doc || '').trim() }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Сторно расхода (вместо удаления; запись остаётся в журнале). */
function mcCafeExpenseCancel(id, reason, token) {
  var op = null;
  try { op = _beginOp_(token, 'finance', 'CAFE_EXPENSE_CANCEL', 'Расходы', id, null); } catch (e) { return _failFrom_(e); }
  try {
    reason = String(reason || '').trim();
    if (!reason) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите причину сторно', op.id); }
    return _withLock_(function () {
      var x = _cfExpenses_(null).filter(function (e) { return e.id === String(id); })[0];
      if (!x) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Расход не найден', op.id); }
      if (x.status === 'CANCELLED') { _endOp_(op); return _ok_({ id: x.id, idempotent: true }, op.id); }
      var sh = _cfSheet_(MC_CF_EXP_, MC_CF_EXP_HEAD_), a = _author_(op);
      sh.getRange(x.row, 13).setValue('CANCELLED');
      sh.getRange(x.row, 16).setValue(reason + ' · ' + a.фио + ' · ' + Utilities.formatDate(new Date(), _mcTz_(), 'dd.MM.yyyy HH:mm'));
      _audit_(op, 'CAFE_EXPENSE_CANCEL', 'Расходы', x.id, { статус: 'POSTED', сумма: x.sum }, { статус: 'CANCELLED', причина: reason });
      _endOp_(op);
      return _ok_({ id: x.id, sum: x.sum }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Списания за период: акты по причинам + списание просроченных партий из журнала склада. */
function _cfWriteOffs_(per) {
  var out = { total: 0, byReason: {}, expired: 0 };
  try {
    var sh = _book_().getSheetByName('Акты_Списания');
    if (sh && sh.getLastRow() > 1) {
      var v = sh.getDataRange().getValues();
      for (var i = 1; i < v.length; i++) {
        var r = v[i]; if (!r[0] || !_cfIn_(_cfDay_(r[1]), per)) continue;
        var s = Number(r[6]) || 0, k = String(r[3] || 'Прочее');
        out.byReason[k] = _cfR2_((out.byReason[k] || 0) + s); out.total += s;
      }
    }
  } catch (e) {}
  try {
    var ov = _stockOpsSheet_().getDataRange().getValues();
    for (var j = 1; j < ov.length; j++) {
      var o = ov[j]; if (!o[0] || String(o[2]) !== 'Списание' || /^Акт /.test(String(o[8] || ''))) continue;   // акты уже учтены выше
      if (!_cfIn_(_cfDay_(o[1]), per)) continue;
      var sm = Number(o[7]) || 0, kk = /срок/i.test(String(o[8] || '') + String(o[9] || '')) ? 'Истёк срок годности (партии)' : 'Списание со склада';
      out.byReason[kk] = _cfR2_((out.byReason[kk] || 0) + sm); out.total += sm; if (/срок/i.test(kk)) out.expired += sm;
    }
  } catch (e) {}
  out.total = _cfR2_(out.total); out.expired = _cfR2_(out.expired);
  return out;
}
/** Закупки за период (приходы склада), ₽ — справочно. */
function _cfPurchases_(per) {
  var total = 0;
  try {
    var ov = _stockOpsSheet_().getDataRange().getValues();
    for (var j = 1; j < ov.length; j++) { var o = ov[j]; if (o[0] && String(o[2]) === 'Приход' && !/^Производство|Остаток на начало|Изготовлено/.test(String(o[8] || '')) && _cfIn_(_cfDay_(o[1]), per)) total += Number(o[7]) || 0; }
  } catch (e) {}
  return _cfR2_(total);
}

/** Сборка P&L и аналитики за период. */
function _cfPnl_(per) {
  var sales = _cfSalesRows_(per), posted = sales.filter(function (r) { return r.status !== 'CANCELLED'; }), cancelled = sales.filter(function (r) { return r.status === 'CANCELLED'; });
  var rev = 0, cogs = 0, disc = 0, checks = {}, byDay = {}, byPay = {}, dish = {}, shortSum = 0;
  posted.forEach(function (r) {
    rev += r.sum; cogs += r.cost; disc += r.discount; shortSum += r.shortSum; checks[r.check ? r.doc + '|' + r.check : r.doc] = 1;
    var dk = _cfYmd_(r.date); byDay[dk] = byDay[dk] || { date: dk, rev: 0, cost: 0, lines: 0 }; byDay[dk].rev += r.sum; byDay[dk].cost += r.cost; byDay[dk].lines++;
    byPay[r.payment] = (byPay[r.payment] || 0) + r.sum;
    var k = r.kind + '|' + (r.code || r.name); dish[k] = dish[k] || { name: r.name, qty: 0, rev: 0, cost: 0 }; dish[k].qty += r.qty; dish[k].rev += r.sum; dish[k].cost += r.cost;
  });
  var lossCancel = cancelled.reduce(function (a, r) { return a + r.cost; }, 0), cancelRev = cancelled.reduce(function (a, r) { return a + r.sum; }, 0);
  var wo = _cfWriteOffs_(per), arts = _cfArticles_(), artBy = {}; arts.forEach(function (a) { artBy[a.code] = a; });
  var exps = _cfExpenses_(per).filter(function (e) { return e.status !== 'CANCELLED'; }), byArt = {}, byGroup = {}, opex = 0, fixed = 0;
  exps.forEach(function (e) {
    opex += e.sum; byArt[e.code] = (byArt[e.code] || 0) + e.sum; byGroup[e.group] = (byGroup[e.group] || 0) + e.sum;
    if ((artBy[e.code] || {}).type === 'постоянные') fixed += e.sum;
  });
  var gross = rev - cogs, op = gross - lossCancel - wo.total - opex;
  var gm = rev > 0 ? gross / rev : 0, nChecks = Object.keys(checks).length;
  // план-факт: план статьи в месяц, пропорционально дням периода
  var planVsFact = arts.filter(function (a) { return a.plan > 0 || byArt[a.code]; }).map(function (a) {
    var plan = 0, d = new Date(per.from.getTime());
    while (d.getTime() <= per.to.getTime()) { var dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); plan += a.plan / dim; d = new Date(d.getTime() + 864e5); }
    var fact = byArt[a.code] || 0;
    return { code: a.code, article: a.name, group: a.group, type: a.type, plan: _cfR2_(plan), fact: _cfR2_(fact), diff: _cfR2_(fact - plan), pct: plan > 0 ? Math.round(fact / plan * 1000) / 10 : null };
  }).sort(function (a, b) { return b.fact - a.fact; });
  // постоянные расходы для точки безубыточности: факт или план (если факта по постоянной статье ещё нет)
  var fixedForBe = 0; planVsFact.forEach(function (p) { if (p.type === 'постоянные') fixedForBe += Math.max(p.fact, p.plan); });
  // меню-инжиниринг (Kasavana–Smith) и ABC
  var items = Object.keys(dish).map(function (k) { var x = dish[k]; return { name: x.name, qty: _cfR3_(x.qty), rev: _cfR2_(x.rev), cost: _cfR2_(x.cost), margin: _cfR2_(x.rev - x.cost),
    unitMargin: x.qty > 0 ? _cfR2_((x.rev - x.cost) / x.qty) : 0, fc: x.rev > 0 ? Math.round(x.cost / x.rev * 1000) / 10 : null }; });
  var totQty = items.reduce(function (a, x) { return a + x.qty; }, 0), totMargin = items.reduce(function (a, x) { return a + x.margin; }, 0);
  var popTh = items.length ? 0.7 / items.length : 0, mTh = totQty > 0 ? totMargin / totQty : 0;
  items.forEach(function (x) {
    var hiPop = totQty > 0 && x.qty / totQty >= popTh, hiM = x.unitMargin >= mTh;
    x.mix = totQty > 0 ? Math.round(x.qty / totQty * 1000) / 10 : 0;
    x.cls = hiPop && hiM ? 'Звезда' : hiPop ? 'Рабочая лошадка' : hiM ? 'Загадка' : 'Собака';
    x.advice = { 'Звезда': 'держать качество и место в меню', 'Рабочая лошадка': 'поднять цену или снизить себестоимость (ТТК, выход)', 'Загадка': 'продвигать: подача, рекомендации, место в меню', 'Собака': 'убрать или переработать' }[x.cls];
  });
  items.sort(function (a, b) { return b.rev - a.rev; });
  // ABC: класс по накопленной доле выручки ДО позиции — первая позиция всегда A, даже если она одна даёт 90 %
  var cum = 0; items.forEach(function (x) { var before = rev > 0 ? cum / rev : 1; x.abc = before < 0.8 ? 'A' : before < 0.95 ? 'B' : 'C'; cum += x.rev; });
  var days = Object.keys(byDay).sort().map(function (k) { var x = byDay[k]; return { date: k, rev: _cfR2_(x.rev), cost: _cfR2_(x.cost), lines: x.lines, fc: x.rev > 0 ? Math.round(x.cost / x.rev * 1000) / 10 : null }; });
  var payName = function (k) { return (MC_CF_PAY_.filter(function (x) { return x[0] === k; })[0] || [0, k || '—'])[1]; };
  return {
    period: { from: per.fromIso, to: per.toIso, days: per.days },
    revenue: _cfR2_(rev), discounts: _cfR2_(disc), cogs: _cfR2_(cogs), gross: _cfR2_(gross), grossPct: Math.round(gm * 1000) / 10, foodCost: rev > 0 ? Math.round(cogs / rev * 1000) / 10 : null,
    lossCancel: _cfR2_(lossCancel), cancelRevenue: _cfR2_(cancelRev), cancelCount: cancelled.length, writeOffs: wo, opex: _cfR2_(opex), fixedOpex: _cfR2_(fixed), operating: _cfR2_(op),
    margin: rev > 0 ? Math.round(op / rev * 1000) / 10 : null, checks: nChecks, avgCheck: nChecks ? _cfR2_(rev / nChecks) : 0, lines: posted.length, perDay: _cfR2_(rev / Math.max(1, per.days)),
    breakEven: gm > 0 ? _cfR2_(fixedForBe / gm) : null, fixedForBe: _cfR2_(fixedForBe), shortSum: _cfR2_(shortSum), purchases: _cfPurchases_(per),
    byGroup: Object.keys(byGroup).map(function (g) { return { group: g, sum: _cfR2_(byGroup[g]), pct: rev > 0 ? Math.round(byGroup[g] / rev * 1000) / 10 : null }; }).sort(function (a, b) { return b.sum - a.sum; }),
    byPay: Object.keys(byPay).map(function (k) { return { name: payName(k), sum: _cfR2_(byPay[k]) }; }),
    planVsFact: planVsFact, days: days, menu: items, expenses: exps
  };
}

/** Экран экономики: статьи, расходы и отчёт за период. json: {from, to} */
function mcCafeEconData(json, token) {
  var s;
  try { s = _requireAuth_(token); } catch (e) { return _failFrom_(e); }
  try {
    var p = _mcBlJson_(json) || {}, per = _cfPeriod_(p), pnl = _cfPnl_(per), fin = _mcRbHasExact_(s, 'finance');
    var all = _cfExpenses_(per).reverse().map(function (e) { return { id: e.id, date: _cfRu_(e.date), article: e.article, group: e.group, sum: e.sum, payment: e.payment, counterparty: e.counterparty,
      doc: e.doc, comment: e.comment, author: e.author, status: e.status, cancelReason: e.cancelReason }; });
    delete pnl.expenses; pnl.lines = _cfPnlLines_(pnl);
    return _ok_({ pnl: pnl, articles: _cfArticles_(), groups: MC_CF_GROUPS_, expenses: fin ? all : [], canEdit: fin, fcTarget: _cafeProp_('MC_CAFE_FC_TARGET', 35) });
  } catch (e) { return _failFrom_(e); }
}

_UI_BUILDERS_.economics = function (token, opts, s) {
  var per = _cfPeriod_({}), p = _cfPnl_(per), fcT = _cafeProp_('MC_CAFE_FC_TARGET', 35);
  var r = function (x) { return x === null || x === undefined ? '—' : x; };
  return {
    title: 'Экономика', subtitle: 'Месяц с 1-го числа по сегодня. Выручка и себестоимость — из продаж, списания — из актов и журнала склада, расходы — по статьям.',
    kpis: [{ label: 'Выручка', value: p.revenue + ' ₽', hint: p.checks + ' чек., ср. чек ' + p.avgCheck + ' ₽', tone: 'wine' },
      { label: 'Food cost', value: r(p.foodCost) + (p.foodCost === null ? '' : ' %'), hint: 'цель ≤ ' + fcT + ' %', tone: p.foodCost !== null && p.foodCost > fcT ? 'red' : 'green' },
      { label: 'Расходы', value: p.opex + ' ₽', hint: 'списания ' + p.writeOffs.total + ' ₽' },
      { label: 'Операционная прибыль', value: p.operating + ' ₽', hint: p.margin === null ? '' : 'рентабельность ' + p.margin + ' %', tone: p.operating < 0 ? 'red' : 'green' }],
    tabs: [
      { title: 'Прибыли и убытки', columns: [_uiCol_('line', 'Статья'), _uiCol_('sum', 'Сумма, ₽', 'num'), _uiCol_('pct', '% выручки', 'num')], rows: _cfPnlLines_(p) },
      { title: 'План-факт расходов', columns: [_uiCol_('article', 'Статья'), _uiCol_('group', 'Группа'), _uiCol_('plan', 'План, ₽', 'num'), _uiCol_('fact', 'Факт, ₽', 'num'), _uiCol_('diff', 'Откл., ₽', 'num'), _uiCol_('pct', 'Исполнение, %', 'num')], rows: p.planVsFact },
      { title: 'Меню-инжиниринг', columns: [_uiCol_('name', 'Позиция'), _uiCol_('qty', 'Продано', 'num'), _uiCol_('rev', 'Выручка, ₽', 'num'), _uiCol_('fc', 'Food cost, %', 'num'), _uiCol_('unitMargin', 'Маржа/шт, ₽', 'num'), _uiCol_('abc', 'ABC'), _uiCol_('cls', 'Класс', 'status'), _uiCol_('advice', 'Что делать')], rows: p.menu },
      { title: 'По дням', columns: [_uiCol_('date', 'Дата', 'date'), _uiCol_('rev', 'Выручка, ₽', 'num'), _uiCol_('cost', 'Себестоимость, ₽', 'num'), _uiCol_('fc', 'Food cost, %', 'num'), _uiCol_('lines', 'Позиций', 'num')], rows: p.days.slice().reverse() }
    ],
    actions: [{ label: '+ Расход', module: 'cafeexpenses' }, { label: 'Отчёт за период', module: 'cafepnl' }, { label: 'Прайс', module: 'cafeprices' }]
  };
};
function _cfPnlLines_(p) {
  var pc = function (x) { return p.revenue > 0 ? Math.round(x / p.revenue * 1000) / 10 : ''; }, L = [];
  L.push({ line: 'Выручка', sum: p.revenue, pct: p.revenue > 0 ? 100 : '' });
  if (p.discounts) L.push({ line: '   в т. ч. скидки (уже вычтены)', sum: p.discounts, pct: pc(p.discounts) });
  L.push({ line: 'Себестоимость продаж (по ТТК)', sum: -p.cogs, pct: pc(p.cogs) });
  L.push({ line: 'Валовая прибыль', sum: p.gross, pct: pc(p.gross) });
  if (p.lossCancel) L.push({ line: 'Потери от сторно (' + p.cancelCount + ')', sum: -p.lossCancel, pct: pc(p.lossCancel) });
  Object.keys(p.writeOffs.byReason).forEach(function (k) { L.push({ line: 'Списания: ' + k, sum: -p.writeOffs.byReason[k], pct: pc(p.writeOffs.byReason[k]) }); });
  p.byGroup.forEach(function (g) { L.push({ line: 'Расходы: ' + g.group, sum: -g.sum, pct: g.pct }); });
  L.push({ line: 'Операционная прибыль', sum: p.operating, pct: pc(p.operating) });
  L.push({ line: 'Справочно: закупки (приходы склада)', sum: p.purchases, pct: pc(p.purchases) });
  if (p.breakEven !== null) L.push({ line: 'Справочно: точка безубыточности (выручка за период)', sum: p.breakEven, pct: '' });
  return L;
}
