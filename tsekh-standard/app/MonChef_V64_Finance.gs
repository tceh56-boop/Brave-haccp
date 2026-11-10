/**
 * ЦЕХ Стандарт V64 — детализированный финансовый блок (ТЗ «Итоговая структура…», §14.1–14.11, §21).
 *
 * Листы: Финансы_Операции (доставка, доп. расходы, скидки партии, скидки и возвраты продаж), Финансы_Расходы (управленческие),
 * Финансы_Распределение (правила с версией, периодом и утверждением), Финансы_Снимки, Финансы_Корректировки,
 * Финансы_ЗакрытиеПериода, Цены_Меню, Упаковка_Нормы, Тарифы_Труда.
 *
 * Правила: цена продажи вводится (меню, договор банкета, факт продажи) и не выводится из себестоимости; доставка и доп. расходы
 * входят в стоимость партии только по выбранному режиму распределения; управленческие расходы — отдельным слоем и по
 * утверждённому правилу. Закрытый период не меняется задним числом: изменения — только корректировкой с причиной, автором
 * и подтверждающим (другим сотрудником).
 */
var MC_V64F = {
  OPS: ['Финансы_Операции', ['FinOpID', 'Date', 'Type', 'DocumentRef', 'BatchID', 'EventID', 'DishName', 'Amount', 'VATIncluded', 'VATRate', 'AllocationMode', 'Comment', 'Status', 'CreatedAt', 'CreatedBy', 'OperationID']],
  EXP: ['Финансы_Расходы', ['ExpenseID', 'Date', 'PeriodFrom', 'PeriodTo', 'Category', 'Amount', 'Document', 'Workshop', 'Comment', 'Status', 'CreatedAt', 'CreatedBy', 'OperationID']],
  RULE: ['Финансы_Распределение', ['RuleID', 'Version', 'Category', 'Base', 'Shares', 'DateFrom', 'DateTo', 'Status', 'ApprovedBy', 'ApprovedAt', 'CreatedAt', 'CreatedBy', 'Comment', 'OperationID']],
  SNAP: ['Финансы_Снимки', MC_V64_SNAP_HEAD],
  CORR: ['Финансы_Корректировки', ['CorrectionID', 'PeriodID', 'ObjectType', 'ObjectID', 'Direction', 'Amount', 'Reason', 'Author', 'CreatedAt', 'ConfirmedBy', 'ConfirmedAt', 'Status', 'Decision', 'DeviationID', 'OperationID']],
  CLOSE: ['Финансы_ЗакрытиеПериода', ['PeriodID', 'DateFrom', 'DateTo', 'Status', 'ClosedAt', 'ClosedBy', 'Revenue', 'COGS', 'GrossContribution', 'MarginPct', 'WasteCost', 'Expenses',
    'MissingPrice', 'MissingSalePrice', 'IncompleteTrace', 'IssuesAccepted', 'Reason', 'SnapshotID', 'Hash', 'Note', 'OperationID']],
  PRICE: ['Цены_Меню', ['PriceID', 'DishCode', 'DishName', 'Price', 'Unit', 'Source', 'EventID', 'DateFrom', 'DateTo', 'Status', 'CreatedAt', 'CreatedBy', 'Comment', 'OperationID']],
  PACK: ['Упаковка_Нормы', ['NormID', 'DishCode', 'DishName', 'Kind', 'Item', 'QtyPerPortion', 'Unit', 'UnitPrice', 'DateFrom', 'DateTo', 'Status', 'CreatedAt', 'CreatedBy', 'OperationID']],
  LABOR: ['Тарифы_Труда', ['RateID', 'Kind', 'Role', 'Workshop', 'DishCode', 'DishName', 'RatePerHour', 'MinutesPerPortion', 'AmountPerPortion', 'DateFrom', 'DateTo', 'Status', 'CreatedAt', 'CreatedBy', 'Comment', 'OperationID']]
};
var MC_V64_EXP_CATS = ['Фонд оплаты труда', 'Коммунальные услуги', 'Аренда', 'Амортизация оборудования', 'Уборка и санитария', 'Упаковка и расходные материалы', 'Доставка',
  'Банковская комиссия', 'Маркетинг', 'Лабораторный контроль (ППК)', 'Разработка и подтверждение ТУ', 'Прочие расходы'];
var MC_V64_BASES = { WORKSHOP_HOURS: 'по часам работы цеха', EMPLOYEE_HOURS: 'по фактическим часам сотрудников', OUTPUT_VOLUME: 'по объёму выпуска (продано порций)',
  RAW_COST: 'по стоимости сырья', REVENUE: 'по выручке', MANUAL_BUDGET: 'вручную по утверждённому бюджету' };
var MC_V64_OP_TYPES = { DELIVERY: 'Доставка партии', EXTRA_COST: 'Допустимые дополнительные расходы партии', DISCOUNT: 'Скидка поставщика', SUPPLIER_RETURN_MONEY: 'Возврат денег поставщиком',
  SALE_DISCOUNT: 'Скидка по продаже', REFUND: 'Возврат денег покупателю', LAB_COST: 'Лабораторное исследование партии' };
var MC_V64_ALLOC_MODES = { NONE: 'не учитывать в себестоимости продукта', WEIGHT: 'распределить по весу', VALUE: 'распределить по стоимости', LINES: 'распределить по строкам документа', BATCH: 'на указанную партию' };

function _v64fSh_(k) { return _v64Sheet_(MC_V64F[k][0], MC_V64F[k][1]); }
function setupV64Economy(token) {
  try { _requireAuth_(token, 'finance_view'); Object.keys(MC_V64F).forEach(_v64fSh_); _v64Sheet_(MC_V64.LEDGER, MC_V64_HEAD);
    return _ok_({ initialized: true, sheets: Object.keys(MC_V64F).map(function (k) { return MC_V64F[k][0]; }).concat([MC_V64.LEDGER]) }, 'V64_SETUP'); } catch (e) { return _failFrom_(e); }
}
function _v64Who_(op) { var s = op && op.session; return s ? (s.dev ? MC_RB_TECH_ : (s.fullName || s.name || s.user_id || '')) : ''; }
function _v64Json_(x) { return typeof x === 'string' ? JSON.parse(x || '{}') : (x || {}); }
function _v64Id_(p) { return p + '-' + Utilities.formatDate(new Date(), _mcTz_(), 'yyyyMMdd') + '-' + Utilities.getUuid().slice(0, 6).toUpperCase(); }
/** Записать строку по заголовку листа. */
function _v64Append_(k, obj) { var sh = _v64fSh_(k), h = MC_V64F[k][1]; sh.appendRow(h.map(function (c) { return obj[c] === undefined || obj[c] === null ? '' : obj[c]; })); _V64_TAB_ = {}; }
function _v64Find_(k, idCol, id) {
  var sh = _v64fSh_(k), h = MC_V64F[k][1], v = sh.getDataRange().getValues(), c = h.indexOf(idCol);
  for (var i = 1; i < v.length; i++) if (String(v[i][c]) === String(id)) { var o = {}; h.forEach(function (x, j) { o[x] = v[i][j]; }); return { sh: sh, row: i + 1, o: o, h: h }; }
  return null;
}
function _v64Set_(f, col, val) { f.sh.getRange(f.row, f.h.indexOf(col) + 1).setValue(val); f.o[col] = val; _V64_TAB_ = {}; }
function _v64Fail_(op, code, msg) { _endOp_(op, 'FAILED'); return _fail_(code, msg, op.id); }

/* ---------------- закрытые периоды ---------------- */
function _v64Periods_() {
  var t = _v64Tab_(MC_V64F.CLOSE[0]), out = [];
  t.rows.forEach(function (r) { out.push({ id: String(_v64G_(t, r, 'PeriodID')), from: _v64Date_(_v64G_(t, r, 'DateFrom')), to: _v64Date_(_v64G_(t, r, 'DateTo')), status: String(_v64G_(t, r, 'Status')),
    closedAt: _v64G_(t, r, 'ClosedAt'), closedBy: String(_v64G_(t, r, 'ClosedBy')), revenue: _v64Num_(_v64G_(t, r, 'Revenue')), cogs: _v64Num_(_v64G_(t, r, 'COGS')),
    gross: _v64Num_(_v64G_(t, r, 'GrossContribution')), margin: _v64G_(t, r, 'MarginPct'), hash: String(_v64G_(t, r, 'Hash')), snapshot: String(_v64G_(t, r, 'SnapshotID')) }); });
  return out.map(function (p) { var q = JSON.parse(JSON.stringify(p)); q.from = p.from ? _v64Day_(p.from) : ''; q.to = p.to ? _v64Day_(p.to) : ''; q.closedAt = p.closedAt ? String(p.closedAt) : ''; return q; });
}
/** Закрытый период, в который попадает дата (null — период открыт). */
function _v64ClosedPeriodOf_(d) {
  var dd = _v64Date_(d); if (!dd) return null;
  var day = new Date(dd.getFullYear(), dd.getMonth(), dd.getDate());
  var t = _v64Tab_(MC_V64F.CLOSE[0]);
  for (var i = 0; i < t.rows.length; i++) { var r = t.rows[i]; if (String(_v64G_(t, r, 'Status')) !== 'CLOSED') continue;
    var f = _v64Date_(_v64G_(t, r, 'DateFrom')), to = _v64Date_(_v64G_(t, r, 'DateTo'));
    if (f && to && day >= new Date(f.getFullYear(), f.getMonth(), f.getDate()) && day <= new Date(to.getFullYear(), to.getMonth(), to.getDate())) return { id: String(_v64G_(t, r, 'PeriodID')), from: _v64Day_(f), to: _v64Day_(to) }; }
  return null;
}
/** Для других модулей: изменение с датой в закрытом периоде запрещено (бросает VALIDATION). */
function _v64AssertOpen_(d, what) {
  var p = null; try { _V64_TAB_ = {}; p = _v64ClosedPeriodOf_(d); } catch (e) { p = null; }
  if (p) throw new Error('VALIDATION: финансовый период ' + p.from + ' — ' + p.to + ' закрыт (' + p.id + '): ' + (what || 'изменение') + ' задним числом запрещено — оформите корректировку в «Экономике»');
}
function _v64ClosedIn_(rg) { return _v64Periods_().filter(function (p) { return p.status === 'CLOSED' && p.from <= rg.toIso && p.to >= rg.fromIso; }); }
/** Строки в закрытом периоде, у которых снимок разошёлся с расчётом, — CLOSED_PERIOD_CHANGED. */
function _v64MarkClosed_(lines, rg) {
  lines.forEach(function (l) { if (l.flags.indexOf('CHANGED_AFTER_SNAPSHOT') >= 0 && _v64ClosedPeriodOf_(l.date)) { l.flags.push('CLOSED_PERIOD_CHANGED'); l.trace = 'REVIEW'; } });
}

/* ---------------- справочники экономики ---------------- */
function v64GetFinanceSettings(token) {
  try {
    _requireAuth_(token, 'finance_view');
    var read = function (k) { var t = _v64Tab_(MC_V64F[k][0]); return t.rows.map(function (r) { var o = {}; MC_V64F[k][1].forEach(function (c) { var v = _v64G_(t, r, c); o[c] = Object.prototype.toString.call(v) === '[object Date]' ? Utilities.formatDate(v, _mcTz_(), 'yyyy-MM-dd') : v; }); return o; }); };
    _V64_TAB_ = {};
    return _ok_({ menuPrices: read('PRICE'), packaging: read('PACK'), labor: read('LABOR'), expenses: read('EXP'), rules: read('RULE'), operations: read('OPS'), corrections: read('CORR'), periods: _v64Periods_(),
      categories: MC_V64_EXP_CATS, bases: MC_V64_BASES, opTypes: MC_V64_OP_TYPES, allocModes: MC_V64_ALLOC_MODES });
  } catch (e) { return _failFrom_(e); }
}
function _v64Dish_(d) {
  var x = _v64DishOf_(String(d.dishCode || d.dishName || '').trim());
  if (!x) throw new Error('VALIDATION: блюдо «' + (d.dishCode || d.dishName || '') + '» не найдено в ТТК');
  return x;
}
function _v64DateArg_(x, dflt, label) {
  if (x === undefined || x === null || x === '') return dflt === undefined ? null : dflt;
  var d = _v64Date_(x); if (!d) throw new Error('VALIDATION: ' + label + ' — дата не распознана');
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Цена меню или договора банкета. Новая цена меню закрывает прежнюю (DateTo = день до начала новой). */
function v64SaveMenuPrice(json, token) {
  var op = null; try { op = _beginOp_(token, 'finance_edit', 'V64_MENU_PRICE', 'Экономика', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), dish = _v64Dish_(d), price = _v64Num_(d.price), src = String(d.source || (d.eventId ? 'CONTRACT' : 'MENU')).toUpperCase();
    if (!(price > 0)) return _v64Fail_(op, 'VALIDATION', 'Цена продажи — больше нуля (цена вводится из меню, договора или факта продажи)');
    if (src === 'CONTRACT' && !d.eventId) return _v64Fail_(op, 'VALIDATION', 'Цена по договору — укажите банкет');
    var from = _v64DateArg_(d.dateFrom, new Date(), 'Дата начала'), to = _v64DateArg_(d.dateTo, null, 'Дата окончания');
    _v64AssertOpen_(from, 'цена продажи');
    return _withLock_(function () {
      var sh = _v64fSh_('PRICE'), h = MC_V64F.PRICE[1], v = sh.getDataRange().getValues(), closed = 0;
      for (var i = 1; i < v.length; i++) {
        if (String(v[i][h.indexOf('Status')]) !== 'ACTIVE' || String(v[i][h.indexOf('DishCode')]) !== String(dish.code) || String(v[i][h.indexOf('EventID')] || '') !== String(d.eventId || '')) continue;
        var f0 = _v64Date_(v[i][h.indexOf('DateFrom')]), t0 = _v64Date_(v[i][h.indexOf('DateTo')]);
        if (f0 && f0 >= from) { sh.getRange(i + 1, h.indexOf('Status') + 1).setValue('ARCHIVED'); closed++; continue; }
        if (!t0 || t0 >= from) { sh.getRange(i + 1, h.indexOf('DateTo') + 1).setValue(new Date(from.getTime() - 86400000)); closed++; }
      }
      var id = _v64Id_('PRICE');
      _v64Append_('PRICE', { PriceID: id, DishCode: dish.code, DishName: dish.name, Price: price, Unit: d.unit || 'порц.', Source: src, EventID: d.eventId || '', DateFrom: from, DateTo: to || '',
        Status: 'ACTIVE', CreatedAt: new Date(), CreatedBy: _v64Who_(op), Comment: d.comment || '', OperationID: op.id });
      _audit_(op, 'V64_MENU_PRICE', 'Цены_Меню', id, null, { dish: dish.name, price: price, source: src, event: d.eventId || '', from: _v64Day_(from), closedPrev: closed });
      _endOp_(op); return _ok_({ priceId: id, dish: dish.name, price: price, closedPrevious: closed }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Норма упаковки / комплектующих / маркировки на порцию. */
function v64SavePackagingNorm(json, token) {
  var op = null; try { op = _beginOp_(token, 'finance_edit', 'V64_PACK_NORM', 'Экономика', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), dish = _v64Dish_(d), kind = String(d.kind || 'Упаковка'), item = String(d.item || '').trim(), qty = _v64Num_(d.qtyPerPortion), price = d.unitPrice === '' || d.unitPrice === undefined ? '' : _v64Num_(d.unitPrice);
    if (['Упаковка', 'Комплектующие', 'Маркировка'].indexOf(kind) < 0) return _v64Fail_(op, 'VALIDATION', 'Вид: Упаковка, Комплектующие или Маркировка');
    if (!item) return _v64Fail_(op, 'VALIDATION', 'Укажите позицию упаковки (номенклатура)');
    if (!(qty > 0)) return _v64Fail_(op, 'VALIDATION', 'Количество на порцию — больше нуля');
    if (price !== '' && price < 0) return _v64Fail_(op, 'VALIDATION', 'Цена не может быть отрицательной');
    var from = _v64DateArg_(d.dateFrom, new Date(), 'Дата начала'); _v64AssertOpen_(from, 'норма упаковки');
    return _withLock_(function () {
      var sh = _v64fSh_('PACK'), h = MC_V64F.PACK[1], v = sh.getDataRange().getValues(), closed = 0;
      for (var i = 1; i < v.length; i++) if (String(v[i][h.indexOf('Status')]) === 'ACTIVE' && String(v[i][h.indexOf('DishCode')]) === String(dish.code) && _v64Key_(v[i][h.indexOf('Item')]) === _v64Key_(item)) {
        sh.getRange(i + 1, h.indexOf('Status') + 1).setValue('ARCHIVED'); sh.getRange(i + 1, h.indexOf('DateTo') + 1).setValue(new Date(from.getTime() - 86400000)); closed++; }
      var id = _v64Id_('PACK');
      _v64Append_('PACK', { NormID: id, DishCode: dish.code, DishName: dish.name, Kind: kind, Item: item, QtyPerPortion: qty, Unit: d.unit || 'шт', UnitPrice: price, DateFrom: from, DateTo: '',
        Status: 'ACTIVE', CreatedAt: new Date(), CreatedBy: _v64Who_(op), OperationID: op.id });
      _audit_(op, 'V64_PACK_NORM', 'Упаковка_Нормы', id, null, { dish: dish.name, kind: kind, item: item, qty: qty, price: price });
      _endOp_(op); return _ok_({ normId: id, replaced: closed, note: price === '' ? 'Цена не указана — берётся средняя цена склада на момент расчёта' : '' }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Тарифы труда: RATE — ставка в час по роли/цеху; DISH_MINUTES — минуты прямого труда на порцию; DISH_VARIABLE — переменные производственные расходы на порцию. */
function v64SaveLaborRate(json, token) {
  var op = null; try { op = _beginOp_(token, 'finance_edit', 'V64_LABOR', 'Экономика', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), kind = String(d.kind || 'RATE').toUpperCase(), row = { Kind: kind, Role: d.role || '', Workshop: d.workshop || '', DishCode: '', DishName: '', RatePerHour: '', MinutesPerPortion: '', AmountPerPortion: '' };
    if (kind === 'RATE') { var r0 = _v64Num_(d.ratePerHour); if (!(r0 > 0)) return _v64Fail_(op, 'VALIDATION', 'Ставка в час — больше нуля'); if (!d.role && !d.workshop) return _v64Fail_(op, 'VALIDATION', 'Укажите роль или цех'); row.RatePerHour = r0; }
    else if (kind === 'DISH_MINUTES' || kind === 'DISH_VARIABLE') {
      var dish = _v64Dish_(d); row.DishCode = dish.code; row.DishName = dish.name;
      if (kind === 'DISH_MINUTES') { var m = _v64Num_(d.minutesPerPortion); if (!(m > 0)) return _v64Fail_(op, 'VALIDATION', 'Минуты на порцию — больше нуля'); row.MinutesPerPortion = m; }
      else { var a = _v64Num_(d.amountPerPortion); if (!(a > 0)) return _v64Fail_(op, 'VALIDATION', 'Сумма на порцию — больше нуля'); row.AmountPerPortion = a; }
    } else return _v64Fail_(op, 'VALIDATION', 'Вид: RATE, DISH_MINUTES или DISH_VARIABLE');
    var from = _v64DateArg_(d.dateFrom, new Date(), 'Дата начала'); _v64AssertOpen_(from, 'тариф труда');
    return _withLock_(function () {
      var id = _v64Id_('RATE'); row.RateID = id; row.DateFrom = from; row.DateTo = _v64DateArg_(d.dateTo, '', 'Дата окончания'); row.Status = 'ACTIVE'; row.CreatedAt = new Date(); row.CreatedBy = _v64Who_(op); row.Comment = d.comment || ''; row.OperationID = op.id;
      _v64Append_('LABOR', row); _audit_(op, 'V64_LABOR', 'Тарифы_Труда', id, null, row); _endOp_(op); return _ok_({ rateId: id }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Управленческий расход — отдельным документом, не смешивается с себестоимостью продукта. */
function v64SaveExpense(json, token) {
  var op = null; try { op = _beginOp_(token, 'finance_edit', 'V64_EXPENSE', 'Экономика', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), cat = String(d.category || ''), amount = _v64Num_(d.amount);
    if (MC_V64_EXP_CATS.indexOf(cat) < 0) return _v64Fail_(op, 'VALIDATION', 'Статья расхода: ' + MC_V64_EXP_CATS.join(', '));
    if (!(amount > 0)) return _v64Fail_(op, 'VALIDATION', 'Сумма — больше нуля');
    if (!String(d.document || '').trim()) return _v64Fail_(op, 'VALIDATION', 'Укажите документ-основание расхода');
    var date = _v64DateArg_(d.date, new Date(), 'Дата'); _v64AssertOpen_(date, 'управленческий расход');
    var pf = _v64DateArg_(d.periodFrom, date, 'Период с'), pt = _v64DateArg_(d.periodTo, date, 'Период по');
    return _withLock_(function () {
      var id = _v64Id_('EXP');
      _v64Append_('EXP', { ExpenseID: id, Date: date, PeriodFrom: pf, PeriodTo: pt, Category: cat, Amount: _v64R2_(amount), Document: d.document, Workshop: d.workshop || '', Comment: d.comment || '',
        Status: 'ACTIVE', CreatedAt: new Date(), CreatedBy: _v64Who_(op), OperationID: op.id });
      _audit_(op, 'V64_EXPENSE', 'Финансы_Расходы', id, null, { category: cat, amount: amount, document: d.document }); _endOp_(op); return _ok_({ expenseId: id }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Правило распределения расходов: версия, период, база; вступает в силу после утверждения. */
function v64SaveAllocationRule(json, token) {
  var op = null; try { op = _beginOp_(token, 'finance_edit', 'V64_RULE', 'Экономика', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), cat = String(d.category || ''), base = String(d.base || '').toUpperCase(), shares = d.shares || null;
    if (MC_V64_EXP_CATS.indexOf(cat) < 0) return _v64Fail_(op, 'VALIDATION', 'Статья расхода: ' + MC_V64_EXP_CATS.join(', '));
    if (!MC_V64_BASES[base]) return _v64Fail_(op, 'VALIDATION', 'База распределения: ' + Object.keys(MC_V64_BASES).map(function (k) { return MC_V64_BASES[k]; }).join(', '));
    if (/WORKSHOP_HOURS|EMPLOYEE_HOURS|MANUAL_BUDGET/.test(base)) {
      if (typeof shares === 'string') { try { shares = JSON.parse(shares); } catch (e) { return _v64Fail_(op, 'VALIDATION', 'Доли — JSON {"Горячий цех": 120, …}'); } }
      if (!shares || typeof shares !== 'object' || !Object.keys(shares).length || Object.keys(shares).some(function (k) { return !(Number(shares[k]) > 0); }))
        return _v64Fail_(op, 'VALIDATION', 'Для этой базы укажите доли: часы по цехам / сотрудникам или проценты бюджета (числа больше нуля)');
      if (base === 'MANUAL_BUDGET' && Object.keys(shares).reduce(function (a, k) { return a + Number(shares[k]); }, 0) > 100.0001) return _v64Fail_(op, 'VALIDATION', 'Бюджет: сумма долей не больше 100 %');
    }
    var from = _v64DateArg_(d.dateFrom, null, 'Действует с'), to = _v64DateArg_(d.dateTo, '', 'Действует по');
    if (!from) return _v64Fail_(op, 'VALIDATION', 'Укажите дату начала действия правила');
    if (to && to < from) return _v64Fail_(op, 'VALIDATION', 'Дата окончания раньше начала');
    return _withLock_(function () {
      var t = _v64Tab_(MC_V64F.RULE[0]), ver = 1; t.rows.forEach(function (r) { if (String(_v64G_(t, r, 'Category')) === cat) ver = Math.max(ver, _v64Num_(_v64G_(t, r, 'Version')) + 1); });
      var id = _v64Id_('RULE');
      _v64Append_('RULE', { RuleID: id, Version: ver, Category: cat, Base: base, Shares: shares ? JSON.stringify(shares) : '', DateFrom: from, DateTo: to || '', Status: 'DRAFT', ApprovedBy: '', ApprovedAt: '',
        CreatedAt: new Date(), CreatedBy: _v64Who_(op), Comment: d.comment || '', OperationID: op.id });
      _audit_(op, 'V64_RULE', 'Финансы_Распределение', id, null, { category: cat, base: base, version: ver }); _endOp_(op);
      return _ok_({ ruleId: id, version: ver, status: 'DRAFT', note: 'Правило вступит в силу после утверждения (право «закрытие периода»).' }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function v64ApproveAllocationRule(ruleId, token) {
  var op = null; try { op = _beginOp_(token, 'finance_close', 'V64_RULE_APPROVE', 'Экономика', ruleId, null); } catch (e) { return _failFrom_(e); }
  try {
    return _withLock_(function () {
      var f = _v64Find_('RULE', 'RuleID', ruleId); if (!f) return _v64Fail_(op, 'NOT_FOUND', 'Правило не найдено');
      if (String(f.o.Status) !== 'DRAFT') return _v64Fail_(op, 'VALIDATION', 'Утвердить можно только черновик (сейчас «' + f.o.Status + '»)');
      var from = _v64Date_(f.o.DateFrom), sh = f.sh, h = f.h, v = sh.getDataRange().getValues(), archived = 0;
      for (var i = 1; i < v.length; i++) if (i + 1 !== f.row && String(v[i][h.indexOf('Category')]) === String(f.o.Category) && String(v[i][h.indexOf('Status')]) === 'APPROVED') {
        var t0 = _v64Date_(v[i][h.indexOf('DateTo')]);
        if (!t0 || t0 >= from) { sh.getRange(i + 1, h.indexOf('DateTo') + 1).setValue(new Date(from.getTime() - 86400000)); sh.getRange(i + 1, h.indexOf('Status') + 1).setValue('ARCHIVED'); archived++; }
      }
      _v64Set_(f, 'Status', 'APPROVED'); _v64Set_(f, 'ApprovedBy', _v64Who_(op)); _v64Set_(f, 'ApprovedAt', new Date());
      _audit_(op, 'V64_RULE_APPROVE', 'Финансы_Распределение', ruleId, 'DRAFT', { status: 'APPROVED', archivedPrevious: archived }); _endOp_(op);
      return _ok_({ ruleId: ruleId, status: 'APPROVED', archivedPrevious: archived }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Финансовая операция: доставка, доп. расходы, скидка поставщика (с режимом распределения), скидка или возврат по продаже. */
function v64SaveFinOperation(json, token) {
  var op = null; try { op = _beginOp_(token, 'finance_edit', 'V64_FIN_OP', 'Экономика', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), type = String(d.type || '').toUpperCase(), amount = _v64Num_(d.amount), mode = String(d.allocationMode || (d.batchId ? 'BATCH' : 'NONE')).toUpperCase();
    if (!MC_V64_OP_TYPES[type]) return _v64Fail_(op, 'VALIDATION', 'Вид операции: ' + Object.keys(MC_V64_OP_TYPES).join(', '));
    if (!(amount > 0)) return _v64Fail_(op, 'VALIDATION', 'Сумма — больше нуля');
    if (!MC_V64_ALLOC_MODES[mode]) return _v64Fail_(op, 'VALIDATION', 'Режим: ' + Object.keys(MC_V64_ALLOC_MODES).join(', '));
    var purchase = /DELIVERY|EXTRA_COST|DISCOUNT|SUPPLIER_RETURN_MONEY|LAB_COST/.test(type) && type !== 'SALE_DISCOUNT';
    if (purchase && mode !== 'NONE' && !d.batchId && !d.documentRef) return _v64Fail_(op, 'VALIDATION', 'Укажите партию или накладную, на которую распределяется сумма');
    if (purchase && mode === 'BATCH' && !d.batchId) return _v64Fail_(op, 'VALIDATION', 'Режим «на партию» — укажите партию');
    if (d.batchId && !_bcFind_(d.batchId)) return _v64Fail_(op, 'NOT_FOUND', 'Партия ' + d.batchId + ' не найдена');
    if (!purchase && !d.eventId && !d.dishName) return _v64Fail_(op, 'VALIDATION', 'Скидка или возврат по продаже — укажите банкет или блюдо');
    var date = _v64DateArg_(d.date, new Date(), 'Дата'); _v64AssertOpen_(date, 'финансовая операция');
    if (d.batchId) { var bb = _bcFind_(d.batchId); _v64AssertOpen_(bb && bb.v[4], 'стоимость партии ' + d.batchId); }
    return _withLock_(function () {
      var id = _v64Id_('FOP');
      _v64Append_('OPS', { FinOpID: id, Date: date, Type: type, DocumentRef: d.documentRef || '', BatchID: d.batchId || '', EventID: d.eventId || '', DishName: d.dishName || '', Amount: _v64R2_(amount),
        VATIncluded: d.vatIncluded === undefined ? '' : !!d.vatIncluded, VATRate: d.vatRate === undefined ? '' : d.vatRate, AllocationMode: purchase ? mode : '', Comment: d.comment || '', Status: 'ACTIVE',
        CreatedAt: new Date(), CreatedBy: _v64Who_(op), OperationID: op.id });
      _audit_(op, 'V64_FIN_OP', 'Финансы_Операции', id, null, { type: type, amount: amount, mode: mode, batch: d.batchId || '', doc: d.documentRef || '' }); _endOp_(op);
      return _ok_({ finOpId: id, note: purchase && mode === 'NONE' ? 'Сумма не включается в себестоимость продукта — учитывается в управленческом слое' : '' }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Отменить свою запись справочника экономики (цена, норма, тариф, расход, операция) — строка остаётся со статусом CANCELLED. */
function v64CancelRecord(json, token) {
  var op = null; try { op = _beginOp_(token, 'finance_edit', 'V64_CANCEL', 'Экономика', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), map = { PRICE: 'PriceID', PACK: 'NormID', LABOR: 'RateID', EXP: 'ExpenseID', OPS: 'FinOpID' }, k = String(d.kind || '').toUpperCase();
    if (!map[k]) return _v64Fail_(op, 'VALIDATION', 'Вид записи: PRICE, PACK, LABOR, EXP, OPS');
    if (!String(d.reason || '').trim()) return _v64Fail_(op, 'VALIDATION', 'Укажите причину отмены');
    return _withLock_(function () {
      var f = _v64Find_(k, map[k], d.id); if (!f) return _v64Fail_(op, 'NOT_FOUND', 'Запись не найдена');
      if (String(f.o.Status) === 'CANCELLED') return _v64Fail_(op, 'VALIDATION', 'Запись уже отменена');
      _v64AssertOpen_(f.o.Date || f.o.DateFrom, 'отмена записи');
      _v64Set_(f, 'Status', 'CANCELLED');
      _audit_(op, 'V64_CANCEL', MC_V64F[k][0], d.id, f.o, { status: 'CANCELLED', reason: d.reason }); _endOp_(op); return _ok_({ id: d.id, status: 'CANCELLED' }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- закрытие периода и корректировки ---------------- */
/** Закрыть период: пересборка журнала, итоги, PERIOD_CLOSE_SNAPSHOT. Позиции без цены — только с подтверждением причины. */
function v64ClosePeriod(json, token) {
  var op = null; try { op = _beginOp_(token, 'finance_close', 'V64_CLOSE', 'Экономика', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), rg = _v64Range_(d.from, d.to);
    if (rg.to > new Date()) return _v64Fail_(op, 'VALIDATION', 'Закрыть можно только прошедший период (дата «по» не позже сегодняшней)');
    return _withLock_(function () {
      _V64_TAB_ = {};
      var clash = _v64Periods_().filter(function (p) { return p.status === 'CLOSED' && p.from <= rg.toIso && p.to >= rg.fromIso; });
      if (clash.length) return _v64Fail_(op, 'VALIDATION', 'Период пересекается с закрытым ' + clash[0].from + ' — ' + clash[0].to + ' (' + clash[0].id + ')');
      var res = _v64Build_(rg), t = _v64Totals_(res.lines), issues = t.missingPrice + t.missingSalePrice + t.missingEvidence;
      if (issues && !(d.acceptIssues === true || d.acceptIssues === 'true')) {
        _endOp_(op, 'FAILED');
        return JSON.stringify({ success: false, error: { code: 'PERIOD_HAS_ISSUES', message: 'В периоде есть записи без цены закупки (' + t.missingPrice + '), без цены продажи (' + t.missingSalePrice +
          '), без доказательств (' + t.missingEvidence + '). Исправьте их или закройте с подтверждением и причиной.', operation_id: op.id }, data: { totals: t } });
      }
      if (issues && !String(d.reason || '').trim()) return _v64Fail_(op, 'VALIDATION', 'Закрытие с проблемными записями — укажите причину');
      _v64Snapshots_(res.lines, op);
      var core = res.lines.map(function (l) { var o = _v64LineOut_(l); return [o.date, o.stage, o.dir, o.objectId, o.batch, o.qty, o.amount, o.flags.join(',')]; });
      var hash = _bkHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(core), Utilities.Charset.UTF_8));
      var pid = 'PER-' + rg.fromIso.replace(/-/g, '') + '-' + rg.toIso.replace(/-/g, '');
      var snap = _v64SnapRow_('PERIOD_CLOSE_SNAPSHOT', pid, t.cogsWithPackaging, '', '', { totals: t, lines: core.length, linesHash: hash }, op, rg);
      var sh = _v64fSh_('SNAP'); sh.appendRow(snap);
      _v64Append_('CLOSE', { PeriodID: pid, DateFrom: rg.from, DateTo: rg.to, Status: 'CLOSED', ClosedAt: new Date(), ClosedBy: _v64Who_(op), Revenue: t.revenue, COGS: t.cogsWithPackaging,
        GrossContribution: t.grossContribution, MarginPct: t.marginPct === null ? '' : t.marginPct, WasteCost: t.wasteCost, Expenses: t.expenses, MissingPrice: t.missingPrice, MissingSalePrice: t.missingSalePrice,
        IncompleteTrace: t.review + t.missingEvidence, IssuesAccepted: issues ? true : false, Reason: d.reason || '', SnapshotID: snap[0], Hash: hash, Note: d.note || '', OperationID: op.id });
      _audit_(op, 'V64_CLOSE', 'Финансы_ЗакрытиеПериода', pid, null, { from: rg.fromIso, to: rg.toIso, revenue: t.revenue, gross: t.grossContribution, hash: hash, issuesAccepted: issues });
      _endOp_(op);
      return _ok_({ periodId: pid, from: rg.fromIso, to: rg.toIso, totals: t, snapshotId: snap[0], hash: hash,
        note: 'Период закрыт: историческая себестоимость не меняется; исправления — корректировкой с подтверждением.' }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Корректировка закрытого периода: создаёт автор с причиной; действует после подтверждения другим сотрудником с правом закрытия. */
function v64CreateCorrection(json, token) {
  var op = null; try { op = _beginOp_(token, 'finance_edit|finance_close', 'V64_CORR', 'Экономика', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), amount = _v64Num_(d.amount), reason = String(d.reason || '').trim();
    var per = _v64Periods_().filter(function (p) { return p.id === String(d.periodId || ''); })[0];
    if (!per || per.status !== 'CLOSED') return _v64Fail_(op, 'VALIDATION', 'Корректировка оформляется к закрытому периоду — укажите его');
    if (!amount) return _v64Fail_(op, 'VALIDATION', 'Сумма корректировки — не ноль (со знаком)');
    if (reason.length < 5) return _v64Fail_(op, 'VALIDATION', 'Укажите причину корректировки');
    if (!d.objectType || !d.objectId) return _v64Fail_(op, 'VALIDATION', 'Укажите объект корректировки (партия, выпуск, банкет, продажа)');
    return _withLock_(function () {
      var id = _v64Id_('CORR');
      _v64Append_('CORR', { CorrectionID: id, PeriodID: per.id, ObjectType: d.objectType, ObjectID: d.objectId, Direction: amount > 0 ? 'OUT' : 'IN', Amount: _v64R2_(amount), Reason: reason,
        Author: _v64Who_(op), CreatedAt: new Date(), ConfirmedBy: '', ConfirmedAt: '', Status: 'PENDING', Decision: '', DeviationID: d.deviationId || '', OperationID: op.id });
      _audit_(op, 'V64_CORR', 'Финансы_Корректировки', id, null, { period: per.id, object: d.objectType + ' ' + d.objectId, amount: amount, reason: reason }); _endOp_(op);
      return _ok_({ correctionId: id, status: 'PENDING', note: 'Корректировка вступит в силу после подтверждения другим сотрудником с правом закрытия периода.' }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function v64ConfirmCorrection(json, token) {
  var op = null; try { op = _beginOp_(token, 'finance_close', 'V64_CORR_CONFIRM', 'Экономика', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), approve = d.decision !== 'REJECT';
    return _withLock_(function () {
      var f = _v64Find_('CORR', 'CorrectionID', d.correctionId); if (!f) return _v64Fail_(op, 'NOT_FOUND', 'Корректировка не найдена');
      if (String(f.o.Status) !== 'PENDING') return _v64Fail_(op, 'VALIDATION', 'Корректировка уже рассмотрена («' + f.o.Status + '»)');
      if (String(f.o.Author) === _v64Who_(op)) return _v64Fail_(op, 'FORBIDDEN', 'Подтверждает другой сотрудник: автор не может подтвердить свою корректировку');
      if (!approve && !String(d.comment || '').trim()) return _v64Fail_(op, 'VALIDATION', 'Отклонение — укажите причину');
      _v64Set_(f, 'Status', approve ? 'CONFIRMED' : 'REJECTED'); _v64Set_(f, 'ConfirmedBy', _v64Who_(op)); _v64Set_(f, 'ConfirmedAt', new Date()); _v64Set_(f, 'Decision', d.comment || (approve ? 'подтверждено' : ''));
      _audit_(op, 'V64_CORR_CONFIRM', 'Финансы_Корректировки', d.correctionId, 'PENDING', { status: approve ? 'CONFIRMED' : 'REJECTED', comment: d.comment || '' }); _endOp_(op);
      return _ok_({ correctionId: d.correctionId, status: approve ? 'CONFIRMED' : 'REJECTED' }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- управленческие расходы: распределение (отдельный слой) ---------------- */
function _v64Allocate_(rg, lines) {
  lines = lines || _v64Build_(rg).lines;
  var D = _v64Dishes_(), dish = {};
  lines.forEach(function (l) {
    var k = l.stage === 'PACKAGING' ? l.dish : l.product; if (!k) return;
    if (!(l.stage === 'SALE' || l.stage === 'PACKAGING') || l.objType === 'FIN_OPERATION') return;
    var x = dish[k] || (dish[k] = { dish: k, revenue: 0, productCost: 0, qty: 0, workshop: (function () { var d = _v64DishOf_(k); return d ? (D.ws[d.code] || 'Без цеха') : 'Без цеха'; })(), allocated: 0, byCategory: {} });
    if (l.stage === 'SALE' && l.dir === 'IN') { x.revenue += Number(l.amount) || 0; x.qty += Number(l.qty) || 0; } else x.productCost += Number(l.amount) || 0;
  });
  var exp = {}; lines.forEach(function (l) { if (l.stage !== 'EXPENSE') return; var c = l.objType === 'EXPENSE' ? l.product : 'Доставка'; exp[c] = (exp[c] || 0) + (Number(l.amount) || 0); });
  var rt = _v64Tab_(MC_V64F.RULE[0]), rules = {};
  rt.rows.forEach(function (r) { if (String(_v64G_(rt, r, 'Status')) !== 'APPROVED') return; var f = _v64Date_(_v64G_(rt, r, 'DateFrom')), to = _v64Date_(_v64G_(rt, r, 'DateTo'));
    if (f && f > rg.to) return; if (to && to < rg.from) return; var c = String(_v64G_(rt, r, 'Category')), v = _v64Num_(_v64G_(rt, r, 'Version'));
    if (!rules[c] || rules[c].version < v) { var sh = null; try { sh = JSON.parse(String(_v64G_(rt, r, 'Shares') || 'null')); } catch (e) {} rules[c] = { id: String(_v64G_(rt, r, 'RuleID')), version: v, base: String(_v64G_(rt, r, 'Base')), shares: sh }; } });
  var list = Object.keys(dish).map(function (k) { return dish[k]; }), cats = [];
  var spread = function (amount, items, wf) { var W = items.reduce(function (a, x) { return a + Math.max(0, wf(x)); }, 0); if (!(W > 0)) return amount; items.forEach(function (x) { x._add = (x._add || 0) + amount * Math.max(0, wf(x)) / W; }); return 0; };
  Object.keys(exp).forEach(function (c) {
    var amount = exp[c], rule = rules[c], un = amount;
    list.forEach(function (x) { x._add = 0; });
    if (rule) {
      if (rule.base === 'REVENUE') un = spread(amount, list, function (x) { return x.revenue; });
      else if (rule.base === 'RAW_COST') un = spread(amount, list, function (x) { return x.productCost; });
      else if (rule.base === 'OUTPUT_VOLUME') un = spread(amount, list, function (x) { return x.qty; });
      else if (rule.base === 'WORKSHOP_HOURS' || rule.base === 'EMPLOYEE_HOURS') {
        var S = rule.shares || {}, H = Object.keys(S).reduce(function (a, k) { return a + Number(S[k]); }, 0); un = 0;
        Object.keys(S).forEach(function (w) { var part = amount * Number(S[w]) / H, items = list.filter(function (x) { return x.workshop === w; }); un += items.length ? spread(part, items, function (x) { return x.revenue || x.qty; }) : part; });
      } else if (rule.base === 'MANUAL_BUDGET') {
        var B = rule.shares || {}; un = amount;
        Object.keys(B).forEach(function (k) { var part = amount * Number(B[k]) / 100, items = list.filter(function (x) { return x.dish === k || _v64Key_(x.dish) === _v64Key_(k) || x.workshop === k || (_v64DishOf_(x.dish) || {}).code === k; });
          if (items.length) { var rest = spread(part, items, function (x) { return x.revenue || x.qty || 1; }); un -= part - rest; } });
      }
    }
    list.forEach(function (x) { if (x._add) { x.allocated += x._add; x.byCategory[c] = _v64R2_((x.byCategory[c] || 0) + x._add); } });
    cats.push({ category: c, amount: _v64R2_(amount), rule: rule ? rule.id + ' v' + rule.version : '', base: rule ? (MC_V64_BASES[rule.base] || rule.base) : '', allocated: _v64R2_(amount - un), unallocated: _v64R2_(un),
      note: rule ? '' : 'нет утверждённого правила распределения — расход не распределён' });
  });
  list.forEach(function (x) { delete x._add; x.revenue = _v64R2_(x.revenue); x.productCost = _v64R2_(x.productCost); x.allocated = _v64R2_(x.allocated); x.qty = _v64R3_(x.qty);
    x.gross = _v64R2_(x.revenue - x.productCost); x.fullCost = _v64R2_(x.productCost + x.allocated); x.afterAllocation = _v64R2_(x.revenue - x.fullCost); });
  return { byDish: list.sort(function (a, b) { return b.revenue - a.revenue; }), byCategory: cats, unallocated: _v64R2_(cats.reduce(function (a, c) { return a + c.unallocated; }, 0)) };
}
function v64AllocateExpenses(fromDate, toDate, token) {
  try { _requireAuth_(token, 'finance_view'); var rg = _v64Range_(fromDate, toDate), r = _v64Allocate_(rg); r.from = rg.fromIso; r.to = rg.toIso;
    r.note = 'Управленческие расходы распределены отдельным слоем и не меняют продуктовую себестоимость.'; return _ok_(r); } catch (e) { return _failFrom_(e); }
}

/* ---------------- карточка блюда: §14.1 и порядок расчёта §21 ---------------- */
function _v64LaborFor_(dish) {
  var t = _v64Tab_(MC_V64F.LABOR[0]), D = _v64Dishes_(), ws = D.ws[dish.code] || '', now = new Date(), minutes = 0, variable = 0, rate = 0, rateSrc = '';
  t.rows.forEach(function (r) {
    if (String(_v64G_(t, r, 'Status')) !== 'ACTIVE') return; var to = _v64Date_(_v64G_(t, r, 'DateTo')), from = _v64Date_(_v64G_(t, r, 'DateFrom')); if ((to && to < now) || (from && from > now)) return;
    var k = String(_v64G_(t, r, 'Kind'));
    if (k === 'DISH_MINUTES' && String(_v64G_(t, r, 'DishCode')) === String(dish.code)) minutes = _v64Num_(_v64G_(t, r, 'MinutesPerPortion'));
    if (k === 'DISH_VARIABLE' && String(_v64G_(t, r, 'DishCode')) === String(dish.code)) variable = _v64Num_(_v64G_(t, r, 'AmountPerPortion'));
    if (k === 'RATE') { var w = String(_v64G_(t, r, 'Workshop')); if ((w && w === ws) || (!w && !rate)) { rate = _v64Num_(_v64G_(t, r, 'RatePerHour')); rateSrc = w || String(_v64G_(t, r, 'Role')); } }
  });
  return { minutes: minutes, rate: rate, rateSource: rateSrc, labor: _v64R2_(minutes / 60 * rate), variable: _v64R2_(variable), missing: minutes > 0 && !(rate > 0) ? 'нет ставки труда для цеха «' + (ws || 'без цеха') + '»' : '' };
}
function v64GetDishEconomics(dishCode, fromDate, toDate, token) {
  try {
    _requireAuth_(token, 'finance_view');
    var dish = _v64DishOf_(String(dishCode || '').trim()); if (!dish) return _fail_('NOT_FOUND', 'Блюдо не найдено в ТТК');
    var rg = _v64Range_(fromDate, toDate), res = _v64Build_(rg), L = res.lines, key = _v64Key_(dish.name), norm = _v64NormCost_(dish.code);
    var sum = function (arr) { return _v64R2_(arr.reduce(function (a, l) { return a + (Number(l.amount) || 0); }, 0)); };
    var prodD = Object.keys(res.production).map(function (k) { var p = res.production[k]; p.id = k; return p; }).filter(function (p) { return _v64Key_(p.name) === key && _v64In_(p.date, rg); });
    var dishBatches = {}; prodD.forEach(function (p) { if (p.batch) dishBatches[p.batch] = true; });
    var inD = L.filter(function (l) { return l.dir === 'OUT' && l.production && prodD.some(function (p) { return p.id === l.production; }); });
    var semiIn = inD.filter(function (l) { return l.batch && res.batches[l.batch] && _v64Produced_(res.batches[l.batch]) && /п\s*[\/\-]\s*ф/i.test(String(l.product) + ' ' + res.batches[l.batch].source) || (l.batch && Object.keys(res.production).some(function (k) { return res.production[k].batch === l.batch && res.production[k].stage === 'SEMI'; })); });
    var rawIn = inD.filter(function (l) { return semiIn.indexOf(l) < 0; });
    var semiProd = Object.keys(res.production).map(function (k) { var p = res.production[k]; p.id = k; return p; }).filter(function (p) { return semiIn.some(function (l) { return l.batch === p.batch; }); });
    var inS = L.filter(function (l) { return l.dir === 'OUT' && l.production && semiProd.some(function (p) { return p.id === l.production; }); });
    var rawBatches = {}; rawIn.concat(inS).forEach(function (l) { if (l.batch) rawBatches[l.batch] = true; });
    var procOut = L.filter(function (l) { return l.stage === 'PROCESSING' && l.dir === 'IN' && rawBatches[l.batch]; }), procAct = {}; procOut.forEach(function (l) { procAct[l.ref] = true; });
    var procW = L.filter(function (l) { return l.stage === 'PROCESSING' && l.dir === 'INFO' && procAct[l.ref]; });
    var defrost = L.filter(function (l) { return l.stage === 'DEFROST' && l.dir === 'OUT' && (rawBatches[l.batch] || procOut.some(function (p) { return p.parent === l.batch; })); });
    var purchases = Object.keys(rawBatches).map(function (b) { var x = res.batches[b]; return x && !_v64Produced_(x) ? { batch: b, product: x.product, unit: x.unit, price: x.price, effectivePrice: Math.round(_v64EffPrice_(x) * 10000) / 10000, supplier: x.pass ? x.pass.supplier : '', missingPrice: !(x.price > 0) } : null; }).filter(Boolean);
    var losses = L.filter(function (l) { return l.dir === 'INFO' && l.production && (prodD.some(function (p) { return p.id === l.production; }) || semiProd.some(function (p) { return p.id === l.production; })); });
    var mine = function (l) { return _v64Key_(l.product) === key || dishBatches[l.batch]; };
    var pack = L.filter(function (l) { return l.stage === 'PACKAGING' && _v64Key_(l.dish) === key; });
    var issue = L.filter(function (l) { return l.stage === 'ISSUE' && l.dir === 'OUT' && mine(l); });
    var served = L.filter(function (l) { return l.stage === 'SALE' && l.dir === 'OUT' && mine(l); });
    var revenue = L.filter(function (l) { return l.stage === 'SALE' && l.dir === 'IN' && mine(l); });
    var waste = L.filter(function (l) { return (l.stage === 'WASTE' || (l.stage === 'RETURN' && l.dir !== 'INFO')) && mine(l); });
    var alloc = _v64Allocate_(rg, L), mineAlloc = alloc.byDish.filter(function (x) { return _v64Key_(x.dish) === key; })[0];
    var outD = L.filter(function (l) { return (l.stage === 'DISH') && l.dir === 'IN' && prodD.some(function (p) { return p.id === l.production; }); });
    var outS = L.filter(function (l) { return l.stage === 'SEMI' && l.dir === 'IN' && semiProd.some(function (p) { return p.id === l.production; }); });
    var R = sum(revenue), S = sum(served), P = sum(pack), soldQty = revenue.reduce(function (a, l) { return a + (Number(l.qty) || 0); }, 0);
    var steps = [
      { n: 1, title: 'Цена партии сырья по приёмке', amount: null, items: purchases },
      { n: 2, title: 'Стоимость фактического расхода по FEFO', amount: sum(rawIn.concat(inS)), lines: rawIn.concat(inS).map(_v64LineOut_) },
      { n: 3, title: 'Потери дефроста', amount: sum(defrost), lines: defrost.map(_v64LineOut_) },
      { n: 4, title: 'Стоимость зачистки и разделки (отходы, перенесённые на выход)', amount: _v64R2_(procW.reduce(function (a, l) { return a + (Number(l.wasteValue) || 0); }, 0)), lines: procOut.concat(procW).map(_v64LineOut_) },
      { n: 5, title: 'Стоимость выхода п/ф', amount: sum(outS), lines: outS.map(_v64LineOut_) },
      { n: 6, title: 'Стоимость п/ф, указанного в ТТК блюда', amount: sum(semiIn), lines: semiIn.map(_v64LineOut_) },
      { n: 7, title: 'Стоимость прямого сырья блюда', amount: sum(rawIn), lines: rawIn.map(_v64LineOut_) },
      { n: 8, title: 'Стоимость технологических потерь (выход меньше плана)', amount: _v64R2_(losses.reduce(function (a, l) { return a + (Number(l.wasteValue) || 0); }, 0)), lines: losses.map(_v64LineOut_) },
      { n: 9, title: 'Стоимость упаковки', amount: P, lines: pack.map(_v64LineOut_) },
      { n: 10, title: 'Стоимость фактического выпуска блюда', amount: sum(outD), lines: outD.map(_v64LineOut_) },
      { n: 11, title: 'Стоимость выдачи по BatchID', amount: sum(issue), lines: issue.map(_v64LineOut_) },
      { n: 12, title: 'Себестоимость фактически обслуженного количества', amount: S, lines: served.map(_v64LineOut_) },
      { n: 13, title: 'Выручка по подтверждённой продаже', amount: R, lines: revenue.map(_v64LineOut_) },
      { n: 14, title: 'Возвраты, списания и брак', amount: sum(waste), lines: waste.map(_v64LineOut_) },
      { n: 15, title: 'Валовой вклад и маржинальность', amount: _v64R2_(R - S - P), marginPct: R > 0 ? Math.round((R - S - P) / R * 1000) / 10 : null },
      { n: 16, title: 'Управленческие расходы — отдельным слоем', amount: mineAlloc ? mineAlloc.allocated : 0, detail: mineAlloc ? mineAlloc.byCategory : {}, afterAllocation: mineAlloc ? mineAlloc.afterAllocation : null }
    ];
    // карточка на порцию (§14.1): цена продажи − ингредиенты и п/ф − потери − упаковка − прямой труд − переменные = валовой вклад
    var prices = _v64MenuPrices_(), mp = _v64PriceFor_(prices, dish.name, '', new Date()), lastSale = revenue.filter(function (l) { return l.price > 0; }).slice(-1)[0];
    var price = mp ? mp.price : (lastSale ? lastSale.price : 0), priceSrc = mp ? (mp.source === 'CONTRACT' ? 'договор' : 'меню') : (lastSale ? 'последняя продажа' : '');
    var producedQty = prodD.reduce(function (a, p) { return a + (p.fact || 0); }, 0), actualIng = producedQty > 0 ? _v64R2_(sum(inD) / producedQty) : null;
    var lossPer = producedQty > 0 ? _v64R2_(steps[7].amount / producedQty) : 0;
    var packPer = (_v64PackNorms_()[key] || []).reduce(function (a, n) { return a + n.qty * n.price; }, 0), lab = _v64LaborFor_(dish);
    var ing = actualIng !== null ? actualIng : norm.cost;
    var card = { salePrice: price, salePriceSource: priceSrc, ingredients: ing, ingredientsSource: actualIng !== null ? 'фактическая (партии за период)' : 'нормативная (ТТК и текущие цены)',
      normativeIngredients: norm.cost, technologicalLosses: lossPer, packaging: _v64R2_(packPer), directLabor: lab.labor, laborMinutes: lab.minutes, laborRate: lab.rate, variableCosts: lab.variable };
    card.productCost = _v64R2_(card.ingredients + card.technologicalLosses + card.packaging + card.directLabor + card.variableCosts);
    card.grossContribution = price > 0 ? _v64R2_(price - card.productCost) : null;
    card.marginPct = price > 0 ? Math.round(card.grossContribution / price * 1000) / 10 : null;
    card.status = price > 0 ? (norm.missing.length ? 'MISSING_PRICE' : 'PASS') : 'MISSING_SALE_PRICE';
    card.deviationFromNormative = actualIng !== null && norm.cost > 0 ? _v64R2_(actualIng - norm.cost) : null;
    card.warnings = [].concat(norm.missing.length ? ['нет цены закупки: ' + norm.missing.join(', ')] : [], price > 0 ? [] : ['нет цены продажи — введите цену меню или договора (не рассчитывается от себестоимости)'], lab.missing ? [lab.missing] : []);
    return _ok_({ code: dish.code, name: dish.name, from: rg.fromIso, to: rg.toIso, card: card, normative: norm, producedQty: _v64R3_(producedQty), soldQty: _v64R3_(soldQty), steps: steps,
      note: 'П/ф в ТТК блюда — отдельный ингредиент по цене своей партии, его состав не раскрывается. Полная управленческая себестоимость — шаг 16, отдельно от продуктовой.' });
  } catch (e) { return _failFrom_(e); }
}

/* ---------------- снимок себестоимости ТТК ---------------- */
function _v64TtkSnapshot_(code, version, op) {
  _V64_TAB_ = {}; _V64_DISH_ = null;
  var n = _v64NormCost_(code); if (!n.lines.length) return null;
  var row = _v64SnapRow_('TTK_COST_SNAPSHOT', String(code) + '@v' + (version || ''), n.cost, 1, 'порц.', { lines: n.lines, missing: n.missing, perUnit: n.perUnit || '' }, op, null);
  _v64fSh_('SNAP').appendRow(row); _V64_TAB_ = {};
  return row[0];
}
function v64SnapshotTtk(code, token) {
  var op = null; try { op = _beginOp_(token, 'finance_view', 'V64_TTK_SNAPSHOT', 'Экономика', code, null); } catch (e) { return _failFrom_(e); }
  try { var d = _v64DishOf_(String(code || '')); if (!d) return _v64Fail_(op, 'NOT_FOUND', 'ТТК не найдена');
    var v = 0; try { v = _effectiveTTKVersion_(d.code); } catch (e) {}
    var id = _withLock_(function () { return _v64TtkSnapshot_(d.code, v, op); });
    _audit_(op, 'V64_TTK_SNAPSHOT', 'Финансы_Снимки', id, null, { code: d.code, version: v }); _endOp_(op);
    return _ok_({ snapshotId: id, code: d.code, version: v, normative: _v64NormCost_(d.code) }, op.id);
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
