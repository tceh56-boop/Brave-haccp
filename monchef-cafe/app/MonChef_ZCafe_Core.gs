/**
 * MON CHEF · КАФЕ — режим системы для кафе (без банкетов).
 *
 * В кафе нет банкетов: спрос задают ежедневные продажи. Поэтому вместо контура
 * «банкет → меню → потребность → производство → выдача» работает контур
 *   продажа (ручной ввод по каждой позиции) → списание по ТТК по партиям (FEFO)
 *   → журналы (продаж J36, история партий, прослеживаемость) → остатки п/ф и сырья
 *   → нормы остатков и прогноз → задачи (приготовить п/ф, закупить, использовать/списать партию).
 *
 * Продажа:
 *   • строка — блюдо меню (по ТТК) или товар со склада (напиток, покупной десерт);
 *   • блюдо раскладывается по ТТК так же, как акт списания: готовые п/ф со склада — первыми,
 *     недостающее — до сырья; партии уменьшаются по FEFO, просроченные не берутся;
 *   • продажа уже случилась — поэтому её не отклоняют из-за нехватки: взятое по партиям
 *     списывается, нехватка пишется в «Кафе_Расхождения» (её разбирают — аудит и задачи это видят);
 *   • себестоимость — по средней цене остатка, как в остальной системе; цену продажи — из прайса;
 *   • каждая списанная партия получает событие «Продажа» в истории партии (Партии_События, цепочка хешей)
 *     и связь прослеживаемости «партия → продажа» (видна в карточке партии, раздел «Реализация»);
 *   • строка пишется в журнал продаж J36 (Ж_Продажи) с автором и источником «кафе».
 *
 * Задачи по остаткам (единый центр задач, источник «остатки»):
 *   • расход в день — из фактического расхода склада и из продаж (берётся большее);
 *   • норма: минимум и цель в днях расхода (п/ф — 1 и 2 дня, сырьё — 2 и 5) или вручную;
 *   • п/ф ниже минимума → «Приготовить п/ф» (с проверкой сырья по ТТК п/ф);
 *     сырьё ниже минимума → «Закупить»; партия истекает сегодня/завтра → «Использовать в первую очередь»;
 *     просроченная партия с остатком → «Списать»;
 *   • задача закрывается сама, когда остаток восстановлен; пересчёт — после продаж и раз в час.
 *
 * Режим кафе включён в этой сборке. Свойство скрипта MC_CAFE_MODE=0 возвращает банкетный режим.
 */

var MC_CF_PRICE_ = 'Кафе_Прайс';
var MC_CF_PRICE_HEAD_ = ['Код блюда', 'Блюдо', 'Категория', 'Цена, ₽', 'В продаже', 'Обновлено', 'Кто'];
var MC_CF_SALES_ = 'Кафе_Продажи';
var MC_CF_SALES_HEAD_ = ['SaleID', 'Документ', 'Дата', 'Время', 'Смена', 'Чек', 'Вид', 'Код блюда', 'Позиция', 'Кол-во', 'Ед.', 'Цена, ₽', 'Скидка, ₽',
  'Сумма, ₽', 'Оплата', 'Себестоимость, ₽', 'Маржа, ₽', 'Продавец', 'Внёс', 'Статус', 'Нехватка, ₽', 'Списано (JSON)', 'Нехватка (JSON)', 'OperationID', 'Создано', 'Сторно: причина'];
var MC_CF_GAP_ = 'Кафе_Расхождения';
var MC_CF_GAP_HEAD_ = ['ID', 'Дата', 'SaleID', 'Позиция продажи', 'Продукт', 'Не хватило', 'Ед.', 'Цена, ₽', 'Сумма, ₽', 'Статус', 'Решение', 'Кто решил', 'Когда'];
var MC_CF_NORM_ = 'Кафе_Нормы_Остатков';
var MC_CF_NORM_HEAD_ = ['Позиция', 'Тип', 'Ед.', 'Мин. остаток', 'Целевой остаток', 'Комментарий', 'Кто', 'Обновлено'];
var MC_CF_PAY_ = [['CASH', 'Наличные'], ['CARD', 'Карта'], ['SBP', 'СБП / перевод'], ['MIXED', 'Смешанная'], ['STAFF', 'Персонал (без оплаты)']];
var MC_CF_SRC_ = 'CAFE_STOCK';
var MC_CF_SALE_ST_RU_ = { POSTED: 'проведена', CANCELLED: 'сторно' };

/* --------------------------------------------------------------- режим и регистрация ---- */

function _cafeOn_() {
  try { return String(PropertiesService.getScriptProperties().getProperty('MC_CAFE_MODE') || '1') !== '0'; } catch (e) { return true; }
}
function _cafeProp_(key, dflt) {
  var v = NaN; try { v = parseFloat(PropertiesService.getScriptProperties().getProperty(key)); } catch (e) {}
  return isFinite(v) && v >= 0 ? v : dflt;
}

/** Функции кафе для единого шлюза (zzz_MonChef_Gate.gs подхватывает этот список). */
var MC_CAFE_GATE_ = {
  // функция: [право, записывает?, запрещено техническому входу?]
  mcCafeData: ['sales|costs|stock_view|finance', false],
  mcCafeSalePost: ['sales', true, true],
  mcCafeSaleCancel: ['sales', true, true],
  mcCafePriceSave: ['sales|finance', true],
  mcCafeGapResolve: ['stock|sales', true],
  mcCafePlanData: ['stock_view|plan|kanban|sales|prod_manage', false],
  mcCafeTasksRebuild: ['stock_view|plan|kanban|prod_manage|stock|sales', true],
  mcCafeNormSave: ['stock|plan_edit|prod_manage', true],
  mcCafeEconData: ['finance|costs', false],
  mcCafeExpenseAdd: ['finance', true],
  mcCafeExpenseCancel: ['finance', true],
  mcCafeArticleSave: ['finance', true],
  mcCafeAuditData: ['ent_audit|audit_view', false],
  mcCafeAuditRun: ['ent_audit', true]
};
var MC_CAFE_TRIGGERS_ = ['cafeAutoTasksSystem', 'cafeAutoAuditSystem'];

// Права, роли, разделы и экраны кафе (файл идёт после MonChef_Rbac.gs, MonChef_UI*.gs и MonChef_Scheduler.gs)
(function () {
  if (typeof MC_RB_PERMS_ === 'undefined') return;
  var has = function (k) { return MC_RB_PERMS_.some(function (x) { return x[0] === k; }); };
  if (!has('sales')) MC_RB_PERMS_.push(['sales', 'Продажи кафе — ввод по позициям, сторно, прайс', 'Продажи']);
  if (!has('finance')) MC_RB_PERMS_.push(['finance', 'Экономика: статьи расходов, расходы, прибыль и убытки', 'Экономика']);
  if (!has('ent_audit')) MC_RB_PERMS_.push(['ent_audit', 'Аудит предприятия — запуск и разбор', 'Проверка']);
  var give = function (role, list) { var m = MC_RB_MATRIX_[role]; if (!m) return; list.forEach(function (k) { if (m.indexOf(k) < 0) m.push(k); }); };
  give('Директор', ['sales', 'finance', 'ent_audit', 'plan', 'stock_view']);
  give('Администратор', ['sales', 'stock_view']);
  give('Шеф-повар', ['sales', 'ent_audit']);
  give('Су-шеф', ['sales', 'ent_audit']);
  give('Ответственный за ХАССП', ['ent_audit']);
  MC_RB_SECTIONS_.cafesales = 'sales|costs';
  MC_RB_SECTIONS_.cafeplan = 'plan|stock_view|kanban|prod_manage|sales';
  MC_RB_SECTIONS_.economics = 'finance|costs';
  MC_RB_SECTIONS_.entaudit = 'ent_audit|audit_view';
  var mods = { cafesale: 'sales', cafeprices: 'sales|costs|finance', cafenorms: 'stock_view|plan|kanban|prod_manage', cafegaps: 'stock|sales|stock_view',
    cafeexpenses: 'finance', cafepnl: 'finance|costs', cafeaudit: 'ent_audit|audit_view' };
  var ru = { cafesale: 'Продажи: ввод', cafeprices: 'Прайс кафе', cafenorms: 'Нормы остатков и задачи', cafegaps: 'Расхождения при продажах',
    cafeexpenses: 'Расходы', cafepnl: 'Прибыль и убытки', cafeaudit: 'Аудит предприятия' };
  Object.keys(mods).forEach(function (k) { MC_RB_MODULES_[k] = mods[k]; if (typeof MC_RB_MODULE_RU_ !== 'undefined') MC_RB_MODULE_RU_[k] = ru[k]; });
  if (typeof MC_RB_JOURNAL_ROLES_ !== 'undefined' && MC_RB_JOURNAL_ROLES_.J36 && MC_RB_JOURNAL_ROLES_.J36.indexOf('SS') < 0) MC_RB_JOURNAL_ROLES_.J36 += ' SS';
  if (typeof UI_SECTIONS !== 'undefined') ['cafesales', 'cafeplan', 'economics', 'entaudit'].forEach(function (k) { if (UI_SECTIONS.indexOf(k) < 0) UI_SECTIONS.push(k); });
  if (typeof MC_SCHEDULE !== 'undefined') {
    MC_SCHEDULE.push({ fn: 'cafeAutoTasksSystem', everyMin: 60 });
    MC_SCHEDULE.push({ fn: 'cafeAutoAuditSystem', weekDay: 1, hour: 7 });
  }
  if (typeof MC_BL_EVT_RU_ !== 'undefined') MC_BL_EVT_RU_.SALE_USE = 'Продажа (списание по ТТК)';
})();

/* --------------------------------------------------------------- общие помощники ---- */

function _cfSheet_(name, head) {
  var sh = _bcSheet_(name, head);
  // лист создан прежней версией с меньшим числом колонок — дописать недостающие заголовки
  try {
    var w = sh.getLastColumn();
    if (w > 0 && w < head.length) sh.getRange(1, w + 1, 1, head.length - w).setValues([head.slice(w)]).setFontWeight('bold');
  } catch (e) {}
  return sh;
}
function _cfNum_(x) { var n = parseFloat(String(x === null || x === undefined ? '' : x).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : NaN; }
function _cfR2_(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function _cfR3_(x) { return Math.round((Number(x) || 0) * 1000) / 1000; }
function _cfYmd_(d) { return Utilities.formatDate(d, _mcTz_(), 'yyyy-MM-dd'); }
function _cfRu_(d) { return d instanceof Date && !isNaN(d.getTime()) ? Utilities.formatDate(d, _mcTz_(), 'dd.MM.yyyy') : String(d || ''); }
function _cfDay_(x) {
  if (x instanceof Date && !isNaN(x.getTime())) return new Date(x.getFullYear(), x.getMonth(), x.getDate());
  var s = String(x || '').trim(), m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return _mcDateOnly_(s);
}
/** Период {from, to} (yyyy-MM-dd); по умолчанию — с 1-го числа месяца по сегодня. */
function _cfPeriod_(p) {
  p = p || {};
  var now = _mcNow_(), t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var from = _cfDay_(p.from) || new Date(t.getFullYear(), t.getMonth(), 1), to = _cfDay_(p.to) || t;
  if (from > to) { var x = from; from = to; to = x; }
  var days = Math.round((to.getTime() - from.getTime()) / 864e5) + 1;
  return { from: from, to: to, toEnd: new Date(to.getTime() + 864e5 - 1), days: days, fromIso: _cfYmd_(from), toIso: _cfYmd_(to) };
}
function _cfIn_(d, per) { return d instanceof Date && d.getTime() >= per.from.getTime() && d.getTime() <= per.toEnd.getTime(); }
/** Перевод количества из единицы from в единицу to (через базовую: г, мл, шт). */
function _cfConv_(qty, from, to) {
  var a = _toBaseUnitServer_(qty, from || 'г'), b = _toBaseUnitServer_(1, to || 'г');
  return a.unit === b.unit ? a.qty / (b.qty || 1) : NaN;
}
/** Удобная единица для показа количества в базовой единице. */
function _cfNice_(qtyBase, baseUnit) {
  if (baseUnit === 'г' && Math.abs(qtyBase) >= 1000) return { qty: _cfR3_(qtyBase / 1000), unit: 'кг' };
  if (baseUnit === 'мл' && Math.abs(qtyBase) >= 1000) return { qty: _cfR3_(qtyBase / 1000), unit: 'л' };
  return { qty: _cfR3_(qtyBase), unit: baseUnit };
}
function _cfSemiKeys_() {
  var keys = {};
  try { JSON.parse(getSemiProducts()).forEach(function (p) { keys[_prodKey_(p.name)] = p; }); } catch (e) {}
  return keys;
}
function _cfEmployees_() {
  try { return JSON.parse(getEmployees()).filter(function (e) { return e.active !== false; }).map(function (e) { return { name: e.name, position: e.position || '' }; }); } catch (e) { return []; }
}

/* --------------------------------------------------------------- прайс ---- */

/** Прайс: { код → {code, name, cat, price, active} }. */
function _cfPrices_() {
  var v = _cfSheet_(MC_CF_PRICE_, MC_CF_PRICE_HEAD_).getDataRange().getValues(), out = {};
  for (var i = 1; i < v.length; i++) {
    var r = v[i]; if (!r[0]) continue;
    out[String(r[0])] = { code: String(r[0]), name: String(r[1] || ''), cat: String(r[2] || ''), price: _cfR2_(r[3]), active: String(r[4] || 'да') !== 'нет', row: i + 1 };
  }
  return out;
}
function _cfPriceUpsert_(code, name, cat, price, active, who) {
  var sh = _cfSheet_(MC_CF_PRICE_, MC_CF_PRICE_HEAD_), pr = _cfPrices_(), cur = pr[String(code)], now = new Date();
  var row = [String(code), name, cat || '', _cfR2_(price), active === false ? 'нет' : 'да', now, who || ''];
  if (cur) sh.getRange(cur.row, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
}

/** Сохранить прайс. json: {items:[{code, price, active}]} */
function mcCafePriceSave(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'sales|finance', 'CAFE_PRICE_SAVE', 'Прайс кафе', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {}, items = Array.isArray(d.items) ? d.items : [];
    if (!items.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Нет позиций для сохранения', op.id); }
    return _withLock_(function () {
      var idx = _buildDishIndexes_(), pr = _cfPrices_(), who = _author_(op).фио, changed = [];
      items.forEach(function (it) {
        var code = String(it.code || ''), dish = idx.dishByCode[code];
        if (!dish || dish.semi) return;
        var price = _cfNum_(it.price), cur = pr[code];
        if (!(price >= 0)) return;
        var active = it.active !== false;
        if (cur && cur.price === _cfR2_(price) && cur.active === active) return;
        _cfPriceUpsert_(code, dish.name, dish.cat, price, active, who);
        changed.push({ code: code, name: dish.name, было: cur ? cur.price : '', стало: _cfR2_(price), вПродаже: active });
      });
      _audit_(op, 'CAFE_PRICE_SAVE', 'Прайс кафе', '', null, { изменено: changed.length, позиции: changed.slice(0, 50) });
      _endOp_(op);
      return _ok_({ changed: changed.length }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* --------------------------------------------------------------- продажи ---- */

function _cfSalesRows_(per) {
  var v = _cfSheet_(MC_CF_SALES_, MC_CF_SALES_HEAD_).getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) {
    var r = v[i]; if (!r[0]) continue;
    var d = _cfDay_(r[2]); if (per && !_cfIn_(d, per)) continue;
    out.push({ row: i + 1, saleId: String(r[0]), doc: String(r[1] || ''), date: d, time: String(r[3] || ''), shift: String(r[4] || ''), check: String(r[5] || ''),
      kind: String(r[6] || 'dish'), code: String(r[7] || ''), name: String(r[8] || ''), qty: Number(r[9]) || 0, unit: String(r[10] || 'порц.'),
      price: Number(r[11]) || 0, discount: Number(r[12]) || 0, sum: Number(r[13]) || 0, payment: String(r[14] || ''), cost: Number(r[15]) || 0,
      margin: Number(r[16]) || 0, seller: String(r[17] || ''), author: String(r[18] || ''), status: String(r[19] || 'POSTED'), shortSum: Number(r[20]) || 0,
      created: r[24], cancelReason: String(r[25] || '') });
  }
  return out;
}

/** Справочники экрана продаж: меню с ценами, товары со склада, продавцы, продажи дня, итоги смены. */
function mcCafeData(json, token) {
  var s;
  try { s = _requireAuth_(token); } catch (e) { return _failFrom_(e); }
  try {
    var p = _mcBlJson_(json) || {}, idx = _buildDishIndexes_(), pr = _cfPrices_(), money = _mcRbHasExact_(s, 'costs|finance|sales');
    var menu = [];
    Object.keys(idx.dishByCode).forEach(function (c) {
      var d = idx.dishByCode[c]; if (!d || d.semi) return;
      var x = pr[c];
      menu.push({ code: c, name: d.name, cat: x && x.cat || d.cat || '', price: x ? x.price : null, active: x ? x.active : false, inPrice: !!x, hasTtk: !!(d.ing && d.ing.length) });
    });
    menu.sort(function (a, b) { return (a.cat + a.name).localeCompare(b.cat + b.name, 'ru'); });
    // себестоимость порции по ТТК — только для прайса (тяжело для всего меню на каждом открытии)
    if (p.withCost && money) {
      _withPriceSnapshot_(function () {
        menu.forEach(function (m) { var c = _cfDishCost_(m.code, idx); m.cost = c.cost; m.costNote = c.note; m.fc = m.price > 0 ? Math.round(c.cost / m.price * 1000) / 10 : null; });
      });
    }
    var semi = _cfSemiKeys_(), products = [];
    JSON.parse(getStockBalances()).forEach(function (b) { if (!semi[_prodKey_(b.name)] && b.qty > 0) products.push({ name: b.name, unit: b.unit || 'шт', qty: _cfR3_(b.qty) }); });
    var day = _cfDay_(p.date) || _cfDay_(_mcNow_()), per = { from: day, toEnd: new Date(day.getTime() + 864e5 - 1) };
    var rows = _cfSalesRows_(per).reverse(), tot = { sum: 0, cost: 0, lines: 0, checks: {}, cancelled: 0, byPay: {} };
    rows.forEach(function (r) {
      if (r.status === 'CANCELLED') { tot.cancelled++; return; }
      tot.sum += r.sum; tot.cost += r.cost; tot.lines++; tot.checks[r.check || r.doc] = 1;
      tot.byPay[r.payment] = _cfR2_((tot.byPay[r.payment] || 0) + r.sum);
    });
    var checks = Object.keys(tot.checks).length;
    return _ok_({
      menu: menu, products: products, employees: _cfEmployees_(), me: _author_(token).фио, payments: MC_CF_PAY_.map(function (x) { return { code: x[0], name: x[1] }; }),
      date: _cfYmd_(day), money: money, canPost: !s.dev && _mcRbHasExact_(s, 'sales'), canPrice: _mcRbHasExact_(s, 'sales|finance'),
      sales: rows.slice(0, 300).map(function (r) {
        return { saleId: r.saleId, doc: r.doc, time: r.time, check: r.check, name: r.name, qty: r.qty, unit: r.unit, price: r.price, discount: r.discount, sum: r.sum,
          payment: (MC_CF_PAY_.filter(function (x) { return x[0] === r.payment; })[0] || [0, r.payment])[1], cost: money ? r.cost : null, margin: money ? r.margin : null,
          seller: r.seller, status: r.status, statusRu: MC_CF_SALE_ST_RU_[r.status] || r.status, shortSum: money ? r.shortSum : null, cancelReason: r.cancelReason };
      }),
      totals: { sum: _cfR2_(tot.sum), cost: money ? _cfR2_(tot.cost) : null, lines: tot.lines, checks: checks, avgCheck: checks ? _cfR2_(tot.sum / checks) : 0,
        foodCost: money && tot.sum > 0 ? Math.round(tot.cost / tot.sum * 1000) / 10 : null, cancelled: tot.cancelled,
        byPay: Object.keys(tot.byPay).map(function (k) { return { name: (MC_CF_PAY_.filter(function (x) { return x[0] === k; })[0] || [0, k])[1], sum: tot.byPay[k] }; }) },
      openGaps: _cfGapsOpen_().length,
      gaps: p.gaps ? _cfGapsOpen_().reverse().slice(0, 300).map(function (g) { return { id: g.id, at: g.at instanceof Date ? Utilities.formatDate(g.at, _mcTz_(), 'dd.MM.yyyy HH:mm') : '', saleId: g.saleId,
        sale: g.sale, product: g.product, qty: g.qty, unit: g.unit, sum: money ? g.sum : null }; }) : null,
      canResolve: _mcRbHasExact_(s, 'stock|sales')
    });
  } catch (e) { return _failFrom_(e); }
}

/** Себестоимость одной порции по ТТК по средним ценам остатков (готовые п/ф не учитываются — полная раскладка до сырья). */
function _cfDishCost_(code, idx) {
  var d = idx.dishByCode[code];
  if (!d || !d.ing || !d.ing.length) return { cost: 0, note: 'нет состава ТТК' };
  var acc = {};
  _serverExplodeInto_(d.ing, 1, acc, [code], 0, idx.dishByCode, idx.dishByNormName, null, null, idx.dishByLooseName);
  var cost = 0, noPrice = 0;
  Object.keys(acc).forEach(function (k) { var sep = k.lastIndexOf('|'), pz = _currentAvgPrice_(k.slice(0, sep), k.slice(sep + 1)) || 0; if (!(pz > 0)) noPrice++; cost += pz * acc[k]; });
  return { cost: _cfR2_(cost), note: noPrice ? 'нет цены у ' + noPrice + ' продукт.' : '' };
}

/** Разбор документа продажи. */
function _cfParseSale_(d, idx, pr) {
  var errors = [], lines = [];
  (Array.isArray(d.lines) ? d.lines : []).forEach(function (l, i) {
    var n = i + 1, kind = l.kind === 'product' ? 'product' : 'dish', q = _cfNum_(l.qty), price = _cfNum_(l.price), disc = _cfNum_(l.discount);
    if (!(q > 0)) return;   // пустые строки формы смены пропускаются
    if (!(disc >= 0)) disc = 0;
    if (kind === 'dish') {
      var dish = (l.code && idx.dishByCode[l.code]) || (l.name ? (idx.dishByNormName[_normNameServer_(l.name)] || null) : null);
      if (!dish || dish.semi) { errors.push('Строка ' + n + ': блюдо «' + (l.name || l.code || '') + '» не найдено в меню (ТТК)'); return; }
      if (!(price >= 0)) price = pr[dish.code] ? pr[dish.code].price : NaN;
      if (!(price >= 0)) { errors.push('Строка ' + n + ': у «' + dish.name + '» нет цены — укажите цену или внесите её в прайс'); return; }
      lines.push({ kind: kind, code: dish.code, name: dish.name, cat: dish.cat, qty: q, unit: 'порц.', price: price, discount: disc, hasTtk: !!(dish.ing && dish.ing.length), newPrice: !pr[dish.code] });
    } else {
      var nm = _cleanProdName_(l.name || '');
      if (!nm) { errors.push('Строка ' + n + ': укажите товар'); return; }
      if (!(price >= 0)) { errors.push('Строка ' + n + ': укажите цену продажи «' + nm + '»'); return; }
      lines.push({ kind: kind, code: '', name: nm, qty: q, unit: String(l.unit || 'шт'), price: price, discount: disc, hasTtk: true });
    }
  });
  if (!lines.length && !errors.length) errors.push('Укажите количество хотя бы у одной позиции');
  return { lines: lines, errors: errors };
}

/**
 * Провести продажи. json: {date?, time?, shift?, check?, payment, seller?, lines:[{kind:'dish'|'product', code?, name?, qty, price?, discount?, unit?}]}
 * Ручной ввод по каждой позиции: одна строка — одна позиция меню (количество за чек или за смену).
 */
function mcCafeSalePost(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'sales', 'CAFE_SALE', 'Продажи', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {}, pad = function (n) { return ('0' + n).slice(-2); }, now = _mcNow_();
    var day = d.date ? _cfDay_(d.date) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (!day) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Дата не распознана', op.id); }
    if (day.getTime() > new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Дата продажи позже сегодняшней', op.id); }
    var time = pad(now.getHours()) + ':' + pad(now.getMinutes());
    if (d.time) { var tm = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(d.time)); if (!tm || +tm[1] > 23 || +tm[2] > 59) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Время — ЧЧ:ММ', op.id); } time = pad(+tm[1]) + ':' + tm[2]; }
    var pay = String(d.payment || 'CARD'); if (!MC_CF_PAY_.some(function (x) { return x[0] === pay; })) pay = 'CARD';
    var a = _author_(op), seller = a.фио;
    if (d.seller && d.seller !== a.фио) {
      if (!_cfEmployees_().some(function (x) { return x.name === d.seller; })) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Продавец — из списка сотрудников', op.id); }
      seller = String(d.seller);
    }
    var dateRu = _cfRu_(day);
    try { _mcAssertJournalPeriodOpen_('J36', dateRu); } catch (pe) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', String(pe.message || pe).replace(/^[A-Z_]+:\s*/, ''), op.id); }
    var res = _withLock_(function () {
      var idx = _buildDishIndexes_(), pr = _cfPrices_(), parsed = _cfParseSale_(d, idx, pr);
      if (parsed.errors.length) return { fail: parsed.errors.join('; ') };
      var shV = _cfSheet_(MC_CF_SALES_, MC_CF_SALES_HEAD_), ymd = Utilities.formatDate(day, _mcTz_(), 'yyyyMMdd'), vv = shV.getDataRange().getValues(), n = 0;
      for (var i = 1; i < vv.length; i++) if (String(vv[i][1]).indexOf('ПР-' + ymd + '-') === 0) { var k = parseInt(String(vv[i][1]).split('-')[2], 10) || 0; if (k > n) n = k; }
      var docId = 'ПР-' + ymd + '-' + ('000' + (n + 1)).slice(-4), pidOf = {};
      try { pidOf = _ttkPidByProdKey_(); } catch (e) {}
      var out = { docId: docId, lines: [], sum: 0, cost: 0, shortSum: 0, shortages: [], noTtk: [], batches: 0 };
      parsed.lines.forEach(function (l, li) {
        var saleId = docId + '-' + (li + 1), sum = _cfR2_(l.qty * l.price - l.discount), cost = 0, shortSum = 0, taken = [], short = [];
        if (sum < 0) sum = 0;
        if (l.kind === 'dish' && !l.hasTtk) out.noTtk.push(l.name);
        if (l.hasTtk) {
          var exp = _woExpand_([{ kind: l.kind, code: l.code, name: l.name, qty: l.qty, unit: l.unit }], idx);
          if (!exp.errors.length) {
            var plan = _woPlan_(exp, false);
            plan.rows.forEach(function (r) {
              var price = _currentAvgPrice_(r.name, r.unit) || 0, got = _fifoConsume_(r.name, r.unit, r.qty, { productId: pidOf[_prodKey_(r.name)] || '' }), gotQty = 0;
              got.forEach(function (g) {
                var q = _cfConv_(g.qty, g.unit, r.unit); if (isFinite(q)) gotQty += q;
                taken.push({ product: r.name, batchId: g.batchId, qty: g.qty, unit: g.unit });
                try { _mcCreateTraceLink_('BATCH', String(g.batchId), 'РЕАЛИЗОВАНА', 'SALE', saleId, { dateTime: new Date(), actor: a.фио, source: 'Продажа ' + docId, weight: g.qty, unit: g.unit }); } catch (te) {}
                try { _mcBlEvent_(op, g.batchId, 'SALE_USE', { qty: g.qty, unit: g.unit, reason: 'Продажа: ' + l.name + ' × ' + l.qty, doc: saleId, to: 'Продажа' }); } catch (be) {}
              });
              gotQty = _cfR3_(gotQty);
              if (gotQty > 0) _logStockOp_('Расход', r.name, gotQty, r.unit, price, 'Продажа ' + docId, l.name + ' × ' + l.qty);
              cost += price * r.qty;   // себестоимость — по полной потребности ТТК: продукт израсходован, даже если не был учтён
              var miss = _cfR3_(r.qty - gotQty);
              if (miss > 0.0005 * Math.max(1, r.qty)) {
                short.push({ product: r.name, qty: miss, unit: r.unit, price: _cfR2_(price), sum: _cfR2_(price * miss) });
                shortSum += price * miss;
              }
            });
          } else out.noTtk.push(l.name + ' (' + exp.errors.join('; ') + ')');
        }
        cost = _cfR2_(cost); shortSum = _cfR2_(shortSum);
        shV.appendRow([saleId, docId, dateRu, time, String(d.shift || ''), String(d.check || ''), l.kind, l.code, l.name, l.qty, l.unit, _cfR2_(l.price), _cfR2_(l.discount),
          sum, pay, cost, _cfR2_(sum - cost), seller, a.фио, 'POSTED', shortSum, JSON.stringify(taken).slice(0, 45000), JSON.stringify(short).slice(0, 20000), op.id, new Date(), '']);
        if (short.length) {
          var gsh = _cfSheet_(MC_CF_GAP_, MC_CF_GAP_HEAD_);
          short.forEach(function (x, xi) { gsh.appendRow(['РС-' + saleId + '-' + (xi + 1), new Date(), saleId, l.name + ' × ' + l.qty, x.product, x.qty, x.unit, x.price, x.sum, 'OPEN', '', '', '']); out.shortages.push(x); });
        }
        if (l.kind === 'dish' && l.newPrice) { try { _cfPriceUpsert_(l.code, l.name, l.cat, l.price, true, a.фио); } catch (e) {} }
        out.lines.push({ saleId: saleId, name: l.name, qty: l.qty, price: _cfR2_(l.price), sum: sum, cost: cost, margin: _cfR2_(sum - cost), shortSum: shortSum });
        out.sum += sum; out.cost += cost; out.shortSum += shortSum; out.batches += taken.length;
        _cfJ36_(op, dateRu, time, l, sum, seller, docId, d.check);
      });
      out.sum = _cfR2_(out.sum); out.cost = _cfR2_(out.cost); out.shortSum = _cfR2_(out.shortSum);
      _audit_(op, 'CAFE_SALE', 'Продажи', docId, null, { позиций: out.lines.length, сумма: out.sum, себестоимость: out.cost, нехватка: out.shortSum, партий: out.batches, оплата: pay, продавец: seller, дата: dateRu });
      try { if (typeof _mcCreateFactInternal_ === 'function') _mcCreateFactInternal_({ factType: 'SALE', objectType: 'SALE', objectId: docId, operationType: 'SALE', dateTime: new Date(),
        value: out.sum, unit: 'RUB', result: 'RECORDED', source: 'CAFE', employeeName: seller, description: 'Продажи кафе ' + docId + ': ' + out.lines.length + ' поз.', skipRules: true }, op.session); } catch (fe) {}
      return out;
    });
    if (res.fail) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', res.fail, op.id); }
    _endOp_(op);
    // остатки изменились — задачи по остаткам пересобираются сразу (ошибка пересчёта продажу не отменяет)
    var tasks = null;
    if (d.rebuildTasks !== false) { try { tasks = _withLock_(function () { return _cfBuildTasks_({ by: a.фио }); }); } catch (te) { try { _log_('WARN', 'кафе: задачи по остаткам — ' + te, op.id); } catch (x) {} } }
    res.date = dateRu; res.time = time; res.payment = pay; res.seller = seller;
    res.tasks = tasks ? { created: tasks.created, closed: tasks.closed, open: tasks.open } : null;
    return _ok_(res, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Строка журнала продаж J36 (Ж_Продажи) — с автором, источником «кафе» и номером документа. */
function _cfJ36_(op, dateRu, time, l, sum, seller, docId, check) {
  try {
    var j = _mcJById_('J36'); if (!j) return;
    var sh = _book_().getSheetByName(j.sheetName) || _createJournalSheet_(j), pos = '';
    try { var e = _cfEmployees_().filter(function (x) { return x.name === seller; })[0]; pos = e ? e.position : ''; } catch (x) {}
    var row = j.columns.map(function (col) {
      switch (col) {
        case '№': return Math.max(0, sh.getLastRow() - 1) + 1;
        case 'Дата': return dateRu; case 'Время': return time; case 'Блюдо': return l.name; case 'Количество': return l.qty; case 'Цена': return _cfR2_(l.price); case 'Сумма': return sum;
        case 'ФИО продавца': return seller; case 'Должность': return pos; default: return '';
      }
    });
    _mcJournalAppendTo_(sh, op, 'кафе · ' + docId + (check ? ' · чек ' + check : ''), row);
  } catch (e) { try { _log_('WARN', 'кафе: J36 — ' + e, op && op.id); } catch (x) {} }
}

/**
 * Сторно продажи (ошибка ввода, возврат гостя). Выручка снимается; продукты на склад не возвращаются —
 * блюдо уже приготовлено, его себестоимость уходит в потери («сторно» в экономике). Нужна причина.
 */
function mcCafeSaleCancel(saleId, reason, token) {
  var op = null;
  try { op = _beginOp_(token, 'sales', 'CAFE_SALE_CANCEL', 'Продажи', saleId, null); } catch (e) { return _failFrom_(e); }
  try {
    reason = String(reason || '').trim();
    if (!reason) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите причину сторно', op.id); }
    return _withLock_(function () {
      var rows = _cfSalesRows_(null), r = rows.filter(function (x) { return x.saleId === String(saleId); })[0];
      if (!r) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Продажа не найдена', op.id); }
      if (r.status === 'CANCELLED') { _endOp_(op); return _ok_({ saleId: r.saleId, idempotent: true }, op.id); }
      var sh = _cfSheet_(MC_CF_SALES_, MC_CF_SALES_HEAD_), a = _author_(op);
      sh.getRange(r.row, 20).setValue('CANCELLED');
      sh.getRange(r.row, 26).setValue(reason + ' · ' + a.фио + ' · ' + Utilities.formatDate(new Date(), _mcTz_(), 'dd.MM.yyyy HH:mm'));
      _cfJ36_(op, _cfRu_(_cfDay_(_mcNow_())), Utilities.formatDate(_mcNow_(), _mcTz_(), 'HH:mm'), { name: r.name + ' (сторно ' + r.saleId + ')', qty: -r.qty, price: r.price }, -r.sum, a.фио, r.doc, '');
      _audit_(op, 'CAFE_SALE_CANCEL', 'Продажи', r.saleId, { статус: 'POSTED', сумма: r.sum }, { статус: 'CANCELLED', причина: reason, себестоимостьВПотери: r.cost });
      _endOp_(op);
      return _ok_({ saleId: r.saleId, name: r.name, sum: r.sum, cost: r.cost }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* --------------------------------------------------------------- расхождения ---- */

function _cfGapsAll_() {
  var v = _cfSheet_(MC_CF_GAP_, MC_CF_GAP_HEAD_).getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) {
    var r = v[i]; if (!r[0]) continue;
    out.push({ row: i + 1, id: String(r[0]), at: r[1], saleId: String(r[2] || ''), sale: String(r[3] || ''), product: String(r[4] || ''), qty: Number(r[5]) || 0, unit: String(r[6] || ''),
      price: Number(r[7]) || 0, sum: Number(r[8]) || 0, status: String(r[9] || 'OPEN'), decision: String(r[10] || ''), by: String(r[11] || ''), when: r[12] });
  }
  return out;
}
function _cfGapsOpen_() { return _cfGapsAll_().filter(function (g) { return g.status === 'OPEN'; }); }

/**
 * Решение по расхождению: json {ids:[…], decision:'INCOME_LATE'|'SHORTAGE'|'TTK_ERROR'|'OTHER', comment}
 *   INCOME_LATE — товар был, приход не внесён (внесите приход — остаток выровняется);
 *   SHORTAGE — недостача: продукт израсходован сверх учёта (идёт в аудит);
 *   TTK_ERROR — неверная ТТК (поправьте карту).
 */
function mcCafeGapResolve(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock|sales', 'CAFE_GAP_RESOLVE', 'Расхождения', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {}, ids = Array.isArray(d.ids) ? d.ids.map(String) : [], dec = { INCOME_LATE: 'приход не был внесён', SHORTAGE: 'недостача', TTK_ERROR: 'ошибка ТТК', OTHER: 'прочее' }[String(d.decision || '')];
    if (!ids.length || !dec) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Выберите расхождения и решение', op.id); }
    if (d.decision === 'OTHER' && !String(d.comment || '').trim()) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Для «прочее» напишите пояснение', op.id); }
    return _withLock_(function () {
      var sh = _cfSheet_(MC_CF_GAP_, MC_CF_GAP_HEAD_), a = _author_(op), n = 0, sum = 0;
      _cfGapsAll_().forEach(function (g) {
        if (ids.indexOf(g.id) < 0 || g.status !== 'OPEN') return;
        sh.getRange(g.row, 10, 1, 4).setValues([[d.decision === 'SHORTAGE' ? 'SHORTAGE' : 'RESOLVED', dec + (d.comment ? ' · ' + String(d.comment) : ''), a.фио, new Date()]]);
        n++; sum += g.sum;
      });
      _audit_(op, 'CAFE_GAP_RESOLVE', 'Расхождения', ids.join(',').slice(0, 300), null, { решение: dec, комментарий: d.comment || '', строк: n, сумма: _cfR2_(sum) });
      _endOp_(op);
      return _ok_({ resolved: n, sum: _cfR2_(sum) }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* --------------------------------------------------------------- нормы, прогноз, задачи ---- */

function _cfNormsManual_() {
  var v = _cfSheet_(MC_CF_NORM_, MC_CF_NORM_HEAD_).getDataRange().getValues(), out = {};
  for (var i = 1; i < v.length; i++) {
    var r = v[i]; if (!r[0]) continue;
    var unit = String(r[2] || 'г'), b = _toBaseUnitServer_(1, unit), mn = _cfNum_(r[3]), tg = _cfNum_(r[4]);
    out[_prodKey_(r[0]) + '|' + b.unit] = { name: String(r[0]), type: String(r[1] || ''), unit: unit, min: isFinite(mn) ? mn * b.qty : null, target: isFinite(tg) ? tg * b.qty : null,
      comment: String(r[5] || ''), row: i + 1 };
  }
  return out;
}

/**
 * Прогноз расхода по продажам: средние продажи блюд в день за days дней (по дню недели, если данных хватает),
 * разложенные по ТТК. Возвращает { pf: {«ключ|база»: в день}, raw: {…}, dishes: [{code, name, perDay, tomorrow}] }.
 */
function _cfForecast_(idx, days) {
  days = days || 14;
  var now = _mcNow_(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()), from = new Date(t0.getTime() - days * 864e5);
  var per = { from: from, toEnd: new Date(t0.getTime() - 1) }, by = {}, byWd = {}, tomorrowWd = new Date(t0.getTime() + 864e5).getDay(), wdCount = 0;
  for (var k = 1; k <= days; k++) if (new Date(t0.getTime() - k * 864e5).getDay() === tomorrowWd) wdCount++;
  _cfSalesRows_(per).forEach(function (r) {
    if (r.status === 'CANCELLED' || r.kind !== 'dish' || !r.code) return;
    by[r.code] = (by[r.code] || 0) + r.qty;
    if (r.date.getDay() === tomorrowWd) byWd[r.code] = (byWd[r.code] || 0) + r.qty;
  });
  var pf = {}, raw = {}, dishes = [];
  Object.keys(by).forEach(function (code) {
    var d = idx.dishByCode[code]; if (!d) return;
    var perDay = by[code] / days, tomorrow = wdCount >= 2 && byWd[code] ? byWd[code] / wdCount : perDay;
    dishes.push({ code: code, name: d.name, perDay: _cfR2_(perDay), tomorrow: _cfR2_(tomorrow) });
    if (!d.ing || !d.ing.length) return;
    var acc = {}, trace = [];
    _serverExplodeInto_(d.ing, perDay, acc, [code], 0, idx.dishByCode, idx.dishByNormName, null, null, idx.dishByLooseName, trace);
    trace.forEach(function (x) { var b = _toBaseUnitServer_(x.need, x.unit), kk = _prodKey_(x.name) + '|' + b.unit; pf[kk] = (pf[kk] || 0) + b.qty; });
    Object.keys(acc).forEach(function (x) { var sep = x.lastIndexOf('|'), b = _toBaseUnitServer_(acc[x], x.slice(sep + 1)), kk = _prodKey_(x.slice(0, sep)) + '|' + b.unit; raw[kk] = (raw[kk] || 0) + b.qty; });
  });
  dishes.sort(function (a, b) { return b.perDay - a.perDay; });
  return { pf: pf, raw: raw, dishes: dishes, days: days };
}

/**
 * Состояние запасов: по каждой позиции склада и каждому п/ф — остаток по допущенным партиям, расход в день,
 * норма (минимум и цель), на сколько дней хватит, статус. Базовые единицы (г, мл, шт).
 */
function _cfStockState_(opts) {
  opts = opts || {};
  var idx = opts.idx || _buildDishIndexes_(), days = _cafeProp_('MC_CAFE_RATE_DAYS', 14);
  var cfg = { pfMin: _cafeProp_('MC_CAFE_PF_MIN_DAYS', 1), pfTarget: _cafeProp_('MC_CAFE_PF_TARGET_DAYS', 2), rawMin: _cafeProp_('MC_CAFE_RAW_MIN_DAYS', 2), rawTarget: _cafeProp_('MC_CAFE_RAW_TARGET_DAYS', 5) };
  var turn = {}; try { turn = _turnoverByProduct_(days); } catch (e) {}
  var fc = _cfForecast_(idx, days), manual = _cfNormsManual_(), semi = _cfSemiKeys_(), items = {};
  var add = function (name, unit) {
    var nm = _cleanProdName_(name), b = _toBaseUnitServer_(1, unit || 'г'), key = _prodKey_(nm) + '|' + b.unit;
    if (!nm) return null;
    if (!items[key]) items[key] = { key: key, name: nm, base: b.unit, type: semi[_prodKey_(nm)] ? 'ПФ' : 'Сырьё', have: 0, haveAll: 0, expSoon: [], expired: [], noExpiry: 0 };
    return items[key];
  };
  JSON.parse(getStockBalances()).forEach(function (b) { add(b.name, b.unit); });
  Object.keys(semi).forEach(function (k) { add(semi[k].name, semi[k].unit); });
  Object.keys(manual).forEach(function (k) { add(manual[k].name, manual[k].unit); });
  // остаток и сроки — по партиям (FEFO берёт только допущенные и непросроченные)
  var now = _mcNow_(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()), t2 = new Date(t0.getTime() + 2 * 864e5);
  var bv = _stockBatchesSheet_().getDataRange().getValues();
  for (var i = 1; i < bv.length; i++) {
    var r = bv[i]; if (!r[0] || String(r[10] || 'active') !== 'active') continue;
    var rem = parseFloat(r[9]) || 0; if (rem <= 0) continue;
    var it = add(r[1], r[2] || 'г'); if (!it) continue;
    var q = _toBaseUnitServer_(rem, r[2] || 'г').qty, ex = _parseDate_(r[5]);
    it.haveAll += q;
    if (ex && ex.getTime && ex.getTime() < t0.getTime()) { it.expired.push({ batchId: String(r[0]), qty: q, expiry: _cfRu_(ex) }); continue; }
    it.have += q;
    if (!ex || !ex.getTime) it.noExpiry++;
    else if (ex.getTime() < t2.getTime()) it.expSoon.push({ batchId: String(r[0]), qty: q, expiry: _cfRu_(ex), today: ex.getTime() < t0.getTime() + 864e5 });
  }
  var out = [];
  Object.keys(items).forEach(function (key) {
    var it = items[key], t = turn[key], rateT = t ? t.qty / days : 0, rateF = (it.type === 'ПФ' ? fc.pf[key] : fc.raw[key]) || 0;
    it.rate = Math.max(rateT, rateF); it.rateSrc = rateF > rateT ? 'продажи' : rateT > 0 ? 'расход склада' : '';
    var m = manual[key], md = it.type === 'ПФ' ? cfg.pfMin : cfg.rawMin, td = it.type === 'ПФ' ? cfg.pfTarget : cfg.rawTarget;
    it.min = m && m.min !== null ? m.min : it.rate * md;
    it.target = m && m.target !== null ? Math.max(m.target, it.min) : Math.max(it.rate * td, it.min);
    it.mode = m && (m.min !== null || m.target !== null) ? 'вручную' : 'авто';
    it.cover = it.rate > 0 ? it.have / it.rate : null;
    it.status = it.min > 0 && it.have <= 0 ? 'нет в наличии' : it.min > 0 && it.have < it.min ? 'ниже минимума' : it.have > 0 && it.target > 0 && it.have > it.target * 3 && it.rate > 0 ? 'излишек' : it.min > 0 ? 'в норме' : 'без расхода';
    out.push(it);
  });
  out.sort(function (a, b) { var o = { 'нет в наличии': 0, 'ниже минимума': 1, 'излишек': 3, 'в норме': 2, 'без расхода': 4 }; return (o[a.status] - o[b.status]) || a.name.localeCompare(b.name, 'ru'); });
  return { items: out, cfg: cfg, days: days, forecast: fc, idx: idx };
}

/**
 * Пересобрать задачи по остаткам. Задача на позицию и день (ключ источника), открытая задача,
 * условие которой ушло (остаток восстановлен, партия использована), закрывается системой.
 */
function _cfBuildTasks_(opts) {
  opts = opts || {};
  if (typeof setupV44TaskCenter === 'function') setupV44TaskCenter();
  var st = _cfStockState_(), idx = st.idx, now = _mcNow_(), ymd = Utilities.formatDate(now, _mcTz_(), 'yyyyMMdd'), live = {}, created = 0, updated = 0;
  var batchesForAvail = _woBatches_();
  var upsert = function (key, t) {
    live[key] = true;
    var sid = key + '|' + ymd, before = _v44TaskBySource_(MC_CF_SRC_, sid);
    t.sourceType = MC_CF_SRC_; t.sourceId = sid; t.createdBy = 'Система (остатки)';
    _v44UpsertTask_(t);
    if (before) updated++; else created++;
  };
  var due = function (hours) { return new Date(now.getTime() + Math.max(0.5, Math.min(hours, 24)) * 3600000); };
  var nice = function (q, base) { var x = _cfNice_(q, base); return vfmt(x.qty) + ' ' + x.unit; };
  function vfmt(n) { return String(_cfR3_(n)).replace('.', ','); }
  var buy = {};
  st.items.forEach(function (it) {
    // 1. ниже минимума
    if (it.min > 0 && it.have < it.min) {
      var need = Math.max(it.target - it.have, it.min - it.have), cover = it.cover === null ? 0 : it.cover;
      var prio = it.have <= 0 ? 'CRITICAL' : cover < 0.5 ? 'HIGH' : 'NORMAL', descr = 'Остаток ' + nice(it.have, it.base) + ', минимум ' + nice(it.min, it.base) + ', цель ' + nice(it.target, it.base) +
        (it.rate > 0 ? '; расход ~' + nice(it.rate, it.base) + ' в день (' + it.rateSrc + '), хватит на ' + (cover * 24 < 48 ? Math.round(cover * 24) + ' ч' : Math.round(cover * 10) / 10 + ' дн.') : '') + '. Норма: ' + it.mode + '.';
      var n2 = _cfNice_(need, it.base);
      if (it.type === 'ПФ') {
        var pf = _findPfDish_(it.name, idx), rawShort = [];
        if (pf && pf.ing && pf.ing.length) {
          var acc = _pfRawRequirement_(pf.code, need, it.base, idx, null, null) || {}, pidOf = {};
          try { pidOf = _ttkPidByProdKey_(); } catch (e) {}
          Object.keys(acc).forEach(function (k) {
            var sep = k.lastIndexOf('|'), nm = k.slice(0, sep), b = _toBaseUnitServer_(acc[k], k.slice(sep + 1)), av = _woAvail_(batchesForAvail, nm, b.unit, pidOf[_prodKey_(nm)] || '');
            if (b.qty > av.ok + 0.0005) {
              rawShort.push(nm + ' — не хватает ' + nice(b.qty - av.ok, b.unit));
              var bk = _prodKey_(nm) + '|' + b.unit; buy[bk] = buy[bk] || { name: _cleanProdName_(nm), base: b.unit, qty: 0, for: [] }; buy[bk].qty += b.qty - av.ok; buy[bk].for.push(it.name);
            }
          });
        }
        upsert('PF|' + it.key, { title: 'Приготовить п/ф: ' + it.name + ' — ' + vfmt(n2.qty) + ' ' + n2.unit, description: descr + (pf ? '' : ' Карта ТТК п/ф не найдена — состав не проверен.') +
          (rawShort.length ? ' Сырья не хватает: ' + rawShort.join('; ') + '.' : ''), taskType: 'PRODUCTION', dueAt: due(prio === 'CRITICAL' ? 1 : cover * 24 / 2), priority: rawShort.length && prio === 'NORMAL' ? 'HIGH' : prio,
          role: 'Повар', ttkCode: pf ? pf.code : '', qty: n2.qty, unit: n2.unit, workshop: 'Полуфабрикаты', notes: 'Изготовление — экран «Приход п/ф» (сырьё спишется по ТТК).' });
      } else {
        upsert('BUY|' + it.key, { title: 'Закупить: ' + it.name + ' — ' + vfmt(n2.qty) + ' ' + n2.unit, description: descr, taskType: 'PROCUREMENT', dueAt: due(prio === 'CRITICAL' ? 2 : cover * 24 / 2),
          priority: prio, role: 'Шеф-повар', qty: n2.qty, unit: n2.unit, notes: 'Заказ поставщику — «Закупки»; приход — «Приёмка».' });
        delete buy[it.key];
      }
    }
    // 2. партии истекают сегодня/завтра — использовать в первую очередь
    it.expSoon.forEach(function (b) {
      upsert('FEFO|' + b.batchId, { title: 'Использовать в первую очередь: ' + it.name + ' — партия ' + b.batchId + ' (до ' + b.expiry + ')', description: 'Остаток партии ' + nice(b.qty, it.base) +
        (it.rate > 0 ? '; расход ~' + nice(it.rate, it.base) + ' в день' + (it.rate < b.qty ? ' — до конца срока не уйдёт: переработайте или предложите в меню дня' : '') : '; расхода нет — переработайте или предложите в меню дня') + '.',
        taskType: 'STOCK_FEFO', dueAt: due(b.today ? 2 : 12), priority: b.today ? 'HIGH' : 'NORMAL', role: 'Шеф-повар', qty: _cfNice_(b.qty, it.base).qty, unit: _cfNice_(b.qty, it.base).unit });
    });
    // 3. просроченные партии с остатком — списать
    it.expired.forEach(function (b) {
      upsert('EXP|' + b.batchId, { title: 'Списать просроченную партию: ' + it.name + ' — ' + b.batchId + ' (срок ' + b.expiry + ')', description: 'Остаток ' + nice(b.qty, it.base) +
        '. В продажу и производство партия не идёт (FEFO её пропускает). Списание — «Списание по акту» → «Истёк срок годности».', taskType: 'WRITE_OFF', dueAt: due(1), priority: 'HIGH', role: 'Шеф-повар',
        qty: _cfNice_(b.qty, it.base).qty, unit: _cfNice_(b.qty, it.base).unit });
    });
  });
  // 4. сырьё для п/ф, которого не хватает (не попало в «ниже минимума»)
  Object.keys(buy).forEach(function (k) {
    var b = buy[k], n2 = _cfNice_(b.qty, b.base);
    upsert('BUY|' + k, { title: 'Закупить: ' + b.name + ' — ' + String(n2.qty).replace('.', ',') + ' ' + n2.unit, description: 'Нужно для п/ф: ' + b.for.filter(function (x, i, a) { return a.indexOf(x) === i; }).join(', ') + '.',
      taskType: 'PROCUREMENT', dueAt: due(4), priority: 'HIGH', role: 'Шеф-повар', qty: n2.qty, unit: n2.unit });
  });
  // 5. закрыть задачи, условие которых ушло
  var sh = _v44Sheet_(V44_TASK.TASK, V44_HEADERS.TASK), h = V44_HEADERS.TASK, closed = 0, open = 0;
  _v44Rows_(V44_TASK.TASK).forEach(function (t) {
    if (String(t.SourceType) !== MC_CF_SRC_ || ['PLANNED', 'READY', 'IN_PROGRESS', 'OVERDUE'].indexOf(String(t.Status)) < 0) return;
    var sid = String(t.SourceID || ''), key = sid.slice(0, sid.lastIndexOf('|')), day = sid.slice(sid.lastIndexOf('|') + 1);
    if (live[key] && day === ymd) { open++; return; }
    _v44WriteByHeader_(sh, h, t._rowNo, { Status: 'DONE', CompletedAt: now, CompletedBy: live[key] ? 'Система: заменена задачей на сегодня' : 'Система: остаток восстановлен / партия использована' });
    closed++;
  });
  return { created: created, updated: updated, closed: closed, open: open, at: _cfRu_(now) + ' ' + Utilities.formatDate(now, _mcTz_(), 'HH:mm') };
}

/** Пересобрать задачи по остаткам (кнопка). */
function mcCafeTasksRebuild(token) {
  var op = null;
  try { op = _beginOp_(token, 'stock_view|plan|kanban|prod_manage|stock|sales', 'CAFE_TASKS_REBUILD', 'Задачи', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var r = _withLock_(function () { return _cfBuildTasks_({ by: _author_(op).фио }); });
    _audit_(op, 'CAFE_TASKS_REBUILD', 'Задачи', '', null, r);
    _endOp_(op);
    return _ok_(r, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Расписание: раз в час (единый планировщик). */
function cafeAutoTasksSystem() {
  if (!_cafeOn_()) return 'off';
  var r = _withLock_(function () { return _cfBuildTasks_({ by: 'Система' }); });
  try { _log_('INFO', 'кафе: задачи по остаткам — новых ' + r.created + ', закрыто ' + r.closed); } catch (e) {}
  return r;
}

/** Экран «Нормы остатков и задачи»: состояние запасов, прогноз на завтра, открытые задачи по остаткам. */
function mcCafePlanData(token) {
  var s;
  try { s = _requireAuth_(token); } catch (e) { return _failFrom_(e); }
  try {
    var st = _cfStockState_(), items = st.items.map(function (it) {
      var f = function (q) { var x = _cfNice_(q, it.base); return { qty: x.qty, unit: x.unit }; };
      return { key: it.key, name: it.name, type: it.type, base: it.base, have: f(it.have), rate: it.rate > 0 ? f(it.rate) : null, rateSrc: it.rateSrc, min: f(it.min), target: f(it.target), mode: it.mode,
        cover: it.cover === null ? null : Math.round(it.cover * 10) / 10, status: it.status, expSoon: it.expSoon.length, expired: it.expired.length, noExpiry: it.noExpiry };
    });
    var tasks = []; try {
      setupV44TaskCenter();
      _v44Rows_(V44_TASK.TASK).forEach(function (t) {
        if (String(t.SourceType) !== MC_CF_SRC_ || ['PLANNED', 'READY', 'IN_PROGRESS', 'OVERDUE'].indexOf(String(t.Status)) < 0) return;
        tasks.push({ taskId: String(t.TaskID), title: String(t.Title || ''), description: String(t.Description || ''), type: String(t.TaskType || ''), priority: String(t.Priority || 'NORMAL'),
          due: t.DueAt instanceof Date ? Utilities.formatDate(t.DueAt, _mcTz_(), 'dd.MM HH:mm') : '', status: String(t.Status) });
      });
    } catch (e) {}
    var po = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 }; tasks.sort(function (a, b) { return (po[a.priority] || 2) - (po[b.priority] || 2); });
    // прогноз на завтра: блюда и п/ф (по продажам за период)
    var fc = st.forecast, idx = st.idx, pfNeed = [];
    var tomorrowPf = {};
    fc.dishes.forEach(function (d) {
      var dish = idx.dishByCode[d.code]; if (!dish || !dish.ing || !dish.ing.length) return;
      var acc = {}, trace = [];
      _serverExplodeInto_(dish.ing, d.tomorrow, acc, [d.code], 0, idx.dishByCode, idx.dishByNormName, null, null, idx.dishByLooseName, trace);
      trace.filter(function (x) { return x.depth === 0; }).forEach(function (x) { var b = _toBaseUnitServer_(x.need, x.unit), k = _prodKey_(x.name) + '|' + b.unit; tomorrowPf[k] = tomorrowPf[k] || { name: _cleanProdName_(x.name), base: b.unit, qty: 0 }; tomorrowPf[k].qty += b.qty; });
    });
    var haveBy = {}; st.items.forEach(function (it) { haveBy[it.key] = it; });
    Object.keys(tomorrowPf).forEach(function (k) {
      var x = tomorrowPf[k], h = haveBy[k] ? haveBy[k].have : 0, n = _cfNice_(x.qty, x.base), hv = _cfNice_(h, x.base), gap = x.qty - h;
      pfNeed.push({ name: x.name, need: n.qty + ' ' + n.unit, have: hv.qty + ' ' + hv.unit, gap: gap > 0 ? (_cfNice_(gap, x.base).qty + ' ' + _cfNice_(gap, x.base).unit) : '', short: gap > 0 });
    });
    pfNeed.sort(function (a, b) { return (b.short - a.short) || a.name.localeCompare(b.name, 'ru'); });
    return _ok_({ items: items, tasks: tasks, cfg: st.cfg, days: st.days, forecast: fc.dishes.slice(0, 60), pfTomorrow: pfNeed,
      canEdit: _mcRbHasExact_(s, 'stock|plan_edit|prod_manage'), canRebuild: _mcRbHasExact_(s, 'stock_view|plan|kanban|prod_manage|stock|sales') });
  } catch (e) { return _failFrom_(e); }
}

/** Норма остатка вручную. json: {name, type, unit, min, target, comment, clear?} — clear возвращает норму «авто». */
function mcCafeNormSave(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock|plan_edit|prod_manage', 'CAFE_NORM_SAVE', 'Нормы остатков', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {}, name = _cleanProdName_(d.name || ''), unit = String(d.unit || 'г'), mn = _cfNum_(d.min), tg = _cfNum_(d.target);
    if (!name) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите позицию', op.id); }
    if (!d.clear && !(mn >= 0) && !(tg >= 0)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите минимум и/или цель', op.id); }
    if (mn >= 0 && tg >= 0 && tg < mn) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Цель не может быть меньше минимума', op.id); }
    return _withLock_(function () {
      var sh = _cfSheet_(MC_CF_NORM_, MC_CF_NORM_HEAD_), m = _cfNormsManual_(), key = _prodKey_(name) + '|' + _toBaseUnitServer_(1, unit).unit, cur = m[key], a = _author_(op);
      if (d.clear) { if (cur) sh.deleteRow(cur.row); }
      else {
        var row = [name, String(d.type || ''), unit, mn >= 0 ? mn : '', tg >= 0 ? tg : '', String(d.comment || ''), a.фио, new Date()];
        if (cur) sh.getRange(cur.row, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
      }
      _audit_(op, 'CAFE_NORM_SAVE', 'Нормы остатков', name, cur ? { min: cur.min, target: cur.target } : null, d.clear ? { режим: 'авто' } : { min: mn, target: tg, unit: unit });
      var t = null; try { t = _cfBuildTasks_({ by: a.фио }); } catch (e) {}
      _endOp_(op);
      return _ok_({ name: name, mode: d.clear ? 'авто' : 'вручную', tasks: t }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* --------------------------------------------------------------- разделы интерфейса ---- */

_UI_BUILDERS_.cafesales = function (token, opts, s) {
  var per = _cfPeriod_({}), now = _mcNow_(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var all = _cfSalesRows_(per), money = !s || _mcRbHasExact_(s, 'costs|finance|sales');
  var posted = all.filter(function (r) { return r.status !== 'CANCELLED'; }), today = posted.filter(function (r) { return r.date.getTime() === t0.getTime(); });
  var sum = function (a, k) { return _cfR2_(a.reduce(function (x, r) { return x + (r[k] || 0); }, 0)); };
  var checks = function (a) { var o = {}; a.forEach(function (r) { o[r.check || r.doc] = 1; }); return Object.keys(o).length; };
  var byDish = {}; posted.forEach(function (r) { var k = r.name; byDish[k] = byDish[k] || { name: r.name, qty: 0, sum: 0, cost: 0 }; byDish[k].qty += r.qty; byDish[k].sum += r.sum; byDish[k].cost += r.cost; });
  var top = Object.keys(byDish).map(function (k) { var x = byDish[k]; return { name: x.name, qty: _cfR3_(x.qty), sum: _cfR2_(x.sum), margin: _cfR2_(x.sum - x.cost), fc: x.sum > 0 ? Math.round(x.cost / x.sum * 1000) / 10 : '' }; })
    .sort(function (a, b) { return b.sum - a.sum; });
  var gaps = _cfGapsOpen_(), rev = sum(posted, 'sum'), cost = sum(posted, 'cost');
  return {
    title: 'Продажи', subtitle: 'Ручной ввод по каждой позиции меню. Продажа списывает продукты по ТТК с партий (FEFO), пишет журнал продаж и историю партий.',
    kpis: [{ label: 'Выручка сегодня', value: sum(today, 'sum') + ' ₽', hint: checks(today) + ' чек.', tone: 'wine' },
      { label: 'Выручка за месяц', value: rev + ' ₽', hint: posted.length + ' поз.' },
      money ? { label: 'Food cost месяца', value: rev > 0 ? Math.round(cost / rev * 1000) / 10 + ' %' : '—', tone: rev > 0 && cost / rev > _cafeProp_('MC_CAFE_FC_TARGET', 35) / 100 ? 'red' : 'green' } : null,
      { label: 'Расхождения', value: gaps.length, hint: 'не хватило на складе', tone: gaps.length ? 'red' : 'green' }].filter(Boolean),
    tabs: [
      { title: 'Сегодня', columns: [_uiCol_('time', 'Время'), _uiCol_('doc', 'Документ'), _uiCol_('name', 'Позиция'), _uiCol_('qty', 'Кол-во', 'num'), _uiCol_('sum', 'Сумма, ₽', 'num'), _uiCol_('seller', 'Продавец'), _uiCol_('st', 'Статус', 'status')],
        rows: _cfSalesRows_({ from: t0, toEnd: new Date(t0.getTime() + 864e5 - 1) }).reverse().map(function (r) { return { time: r.time, doc: r.doc, name: r.name, qty: r.qty, sum: r.sum, seller: r.seller, st: MC_CF_SALE_ST_RU_[r.status] || r.status }; }) },
      { title: 'Позиции за месяц', columns: [_uiCol_('name', 'Позиция'), _uiCol_('qty', 'Продано', 'num'), _uiCol_('sum', 'Выручка, ₽', 'num'), _uiCol_('margin', 'Маржа, ₽', 'num'), _uiCol_('fc', 'Food cost, %', 'num')], rows: top },
      { title: 'Расхождения', columns: [_uiCol_('at', 'Когда'), _uiCol_('sale', 'Продажа'), _uiCol_('product', 'Продукт'), _uiCol_('qty', 'Не хватило', 'num'), _uiCol_('unit', 'Ед.'), _uiCol_('sum', 'Сумма, ₽', 'num')],
        rows: gaps.slice(-200).reverse().map(function (g) { return { at: g.at instanceof Date ? Utilities.formatDate(g.at, _mcTz_(), 'dd.MM HH:mm') : '', sale: g.sale, product: g.product, qty: g.qty, unit: g.unit, sum: g.sum }; }) }
    ],
    actions: [{ label: '+ Ввести продажи', module: 'cafesale' }, { label: 'Прайс', module: 'cafeprices' }, { label: 'Расхождения', module: 'cafegaps' }, { label: 'Журнал продаж', module: 'sales' }]
  };
};

_UI_BUILDERS_.cafeplan = function (token, opts, s) {
  var st = _cfStockState_(), low = st.items.filter(function (x) { return x.status === 'ниже минимума' || x.status === 'нет в наличии'; });
  var tasks = []; try { setupV44TaskCenter(); tasks = _v44Rows_(V44_TASK.TASK).filter(function (t) { return String(t.SourceType) === MC_CF_SRC_ && ['PLANNED', 'READY', 'IN_PROGRESS', 'OVERDUE'].indexOf(String(t.Status)) >= 0; }); } catch (e) {}
  var f = function (it, q) { var x = _cfNice_(q, it.base); return x.qty + ' ' + x.unit; };
  var pri = { CRITICAL: 'критический', HIGH: 'высокий', NORMAL: 'обычный', LOW: 'низкий' };
  return {
    title: 'План по остаткам', subtitle: 'Задачи кухни строятся из остатков п/ф и сырья: расход в день (продажи и склад), минимум и цель. Задача закрывается сама, когда остаток восстановлен.',
    kpis: [{ label: 'П/ф ниже минимума', value: low.filter(function (x) { return x.type === 'ПФ'; }).length, tone: 'red' },
      { label: 'Сырьё ниже минимума', value: low.filter(function (x) { return x.type !== 'ПФ'; }).length, tone: 'gold' },
      { label: 'Задач по остаткам', value: tasks.length, hint: 'открыто' },
      { label: 'Истекают за 2 дня', value: st.items.reduce(function (a, x) { return a + x.expSoon.length; }, 0), tone: 'gold' }],
    tabs: [
      { title: 'Задачи', columns: [_uiCol_('pr', 'Приоритет', 'status'), _uiCol_('title', 'Задача'), _uiCol_('due', 'Срок'), _uiCol_('descr', 'Почему')],
        rows: tasks.map(function (t) { return { pr: pri[String(t.Priority)] || String(t.Priority), title: String(t.Title), due: t.DueAt instanceof Date ? Utilities.formatDate(t.DueAt, _mcTz_(), 'dd.MM HH:mm') : '', descr: String(t.Description || '') }; })
          .sort(function (a, b) { var o = { 'критический': 0, 'высокий': 1, 'обычный': 2, 'низкий': 3 }; return (o[a.pr] || 2) - (o[b.pr] || 2); }) },
      { title: 'Остатки и нормы', columns: [_uiCol_('name', 'Позиция'), _uiCol_('type', 'Тип'), _uiCol_('have', 'Остаток'), _uiCol_('rate', 'Расход/день'), _uiCol_('min', 'Минимум'), _uiCol_('target', 'Цель'), _uiCol_('cover', 'Хватит, дн.', 'num'), _uiCol_('status', 'Статус', 'status')],
        rows: st.items.filter(function (x) { return x.have > 0 || x.min > 0; }).map(function (it) { return { name: it.name, type: it.type, have: f(it, it.have), rate: it.rate > 0 ? f(it, it.rate) : '—', min: f(it, it.min), target: f(it, it.target), cover: it.cover === null ? '' : Math.round(it.cover * 10) / 10, status: it.status }; }) }
    ],
    actions: [{ label: 'Нормы и прогноз', module: 'cafenorms' }, { label: 'Задачи', module: 'tasks' }, { label: 'Приход п/ф', module: 'pfincome' }, { label: 'Списание по акту', module: 'writeoff' }]
  };
};

// Главная в режиме кафе: вместо банкетов — продажи дня и задачи по остаткам
(function () {
  if (typeof _UI_BUILDERS_ === 'undefined' || !_UI_BUILDERS_.home || _UI_BUILDERS_.home.__cafe) return;
  var orig = _UI_BUILDERS_.home;
  _UI_BUILDERS_.home = function (token, opts, s) {
    var r = orig.apply(this, arguments);
    if (!_cafeOn_()) return r;
    try {
      r.kpis = (r.kpis || []).filter(function (k) { return k.label !== 'Банкеты'; });
      r.tabs = (r.tabs || []).filter(function (t) { return t.title !== 'Ближайшие банкеты'; });
      var can = function (sec) { return !s || _mcRbSectionAllowed_(s, sec); };
      if (can('cafesales')) {
        var now = _mcNow_(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        var rows = _cfSalesRows_({ from: t0, toEnd: new Date(t0.getTime() + 864e5 - 1) }).filter(function (x) { return x.status !== 'CANCELLED'; });
        var sum = _cfR2_(rows.reduce(function (a, x) { return a + x.sum; }, 0));
        r.kpis.unshift({ label: 'Выручка сегодня', value: sum + ' ₽', hint: rows.length + ' поз.', tone: 'wine', go: { sec: 'cafesales', tab: 0 } });
        var by = {}; rows.forEach(function (x) { by[x.name] = (by[x.name] || 0) + x.qty; });
        r.tabs.push({ title: 'Продано сегодня', columns: [_uiCol_('name', 'Позиция'), _uiCol_('qty', 'Кол-во', 'num')],
          rows: Object.keys(by).map(function (k) { return { name: k, qty: _cfR3_(by[k]), _go: { sec: 'cafesales', tab: 0 } }; }).sort(function (a, b) { return b.qty - a.qty; }).slice(0, 10) });
      }
      if (can('cafeplan')) {
        var open = 0, crit = 0;
        try { _v44Rows_(V44_TASK.TASK).forEach(function (t) { if (String(t.SourceType) === MC_CF_SRC_ && ['PLANNED', 'READY', 'IN_PROGRESS', 'OVERDUE'].indexOf(String(t.Status)) >= 0) { open++; if (/CRITICAL|HIGH/.test(String(t.Priority))) crit++; } }); } catch (e) {}
        r.kpis.splice(1, 0, { label: 'Задачи по остаткам', value: open, hint: crit ? crit + ' срочных' : 'открыто', tone: crit ? 'red' : open ? 'gold' : 'green', go: { sec: 'cafeplan', tab: 0 } });
      }
      r.actions = [{ label: '+ Продажи', module: 'cafesale' }].concat(r.actions || []);
    } catch (e) { try { _log_('WARN', 'кафе: главная — ' + e); } catch (x) {} }
    return r;
  };
  _UI_BUILDERS_.home.__cafe = true;
})();
