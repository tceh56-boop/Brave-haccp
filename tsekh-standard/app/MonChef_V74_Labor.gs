// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
/**
 * ЦЕХ Стандарт V74 — «ЦЕХ Финансы и Экономика», этап 4: управленческий Labor Cost (ставка × часы + премии).
 *
 * Решение 14.11.2026: ФОТ — управленческий Labor Cost, не расчёт зарплаты и не бухгалтерия.
 *
 * Первичные записи (одно заполнение — одна операция):
 *  • смена «Моя смена» (MonChef_Смены, V19) — начало и конец смены уже записывает сам сотрудник; часы = конец − начало.
 *    Смены в табель не копируются: экономика читает их напрямую;
 *  • ФОТ_Табель — часы, которых нет в сменах (сотрудник не отмечает смену), и исправления часов смены.
 *    Ручная запись на дату, где у сотрудника уже есть смена, не принимается — исправляется сама смена (без дублей).
 *    Исправление не стирает запись: прежняя получает статус CANCELLED с причиной, новая ссылается на неё (ReplacesID);
 *  • ФОТ_Ставки — ставка в час сотрудника (или роли — для всех сотрудников роли без своей ставки) с даты.
 *    Новая ставка закрывает прежнюю днём раньше; прошлые ставки не переписываются;
 *  • ФОТ_Премии — премии и удержания: черновик автора → подтверждение другим сотрудником с правом закрытия периода.
 *
 * Стоимость: часы × ставка, действующая на дату смены, + подтверждённые премии − удержания. Нет ставки → сумма 0 и
 * признак «нет ставки» (показатель не подменяется). Строки идут в журнал V64 (этап «Труд»), оттуда — в реестр операций,
 * дневные итоги, P&L и сводку руководителя. Записи в закрытом финансовом периоде не принимаются.
 */
var MC_V74 = {
  RATE: ['ФОТ_Ставки', ['RateID', 'Employee', 'Role', 'RatePerHour', 'DateFrom', 'DateTo', 'Status', 'CreatedAt', 'CreatedBy', 'Comment', 'CancelReason', 'OperationID']],
  TS: ['ФОТ_Табель', ['EntryID', 'Date', 'Employee', 'Role', 'Hours', 'Kind', 'ShiftID', 'ReplacesID', 'Status', 'Reason', 'CreatedAt', 'CreatedBy', 'CancelledAt', 'CancelledBy', 'CancelReason', 'OperationID']],
  BON: ['ФОТ_Премии', ['BonusID', 'Date', 'Employee', 'Type', 'Amount', 'Reason', 'Status', 'CreatedAt', 'CreatedBy', 'DecidedAt', 'DecidedBy', 'DecisionComment', 'OperationID']]
};
var MC_V74_SHIFTS = 'MonChef_Смены';
var MC_V74_LONG_H = 16;
var MC_V74_KIND_RU = { MANUAL: 'вручную', SHIFT_FIX: 'исправление смены', SHIFT: 'смена' };
var MC_V74_BONUS_RU = { BONUS: 'премия', PENALTY: 'удержание' };

/* ---------------- служебное ---------------- */
function _v74Sh_(k) { return _v64Sheet_(MC_V74[k][0], MC_V74[k][1]); }
function _v74Append_(k, o) { var h = MC_V74[k][1]; _v74Sh_(k).appendRow(h.map(function (c) { return o[c] === undefined || o[c] === null ? '' : o[c]; })); _V64_TAB_ = {}; }
function _v74Find_(k, id) {
  var sh = _v74Sh_(k), h = MC_V74[k][1], v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(id)) { var o = {}; h.forEach(function (c, j) { o[c] = v[i][j]; }); return { sh: sh, row: i + 1, o: o, h: h }; }
  return null;
}
function _v74Set_(f, o) { Object.keys(o).forEach(function (c) { var j = f.h.indexOf(c); if (j >= 0) f.sh.getRange(f.row, j + 1).setValue(o[c]); }); _V64_TAB_ = {}; }
function _v74Norm_(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
function _v74Day_(x) { var d = _v64Date_(x); return d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()) : null; }
function _v74Closed_(d) { var p = null; try { p = _v64ClosedPeriodOf_(d); } catch (e) {} return p ? 'Дата ' + _v64Day_(d) + ' в закрытом финансовом периоде ' + (p.id || '') + ' — исправление только корректировкой' : ''; }
function _v74Hours_(x) { var h = Number(String(x === undefined || x === null ? '' : x).replace(',', '.')); return isFinite(h) ? Math.round(h * 100) / 100 : NaN; }

/** Ставки: действующая на дату — своя ставка сотрудника, иначе ставка роли. */
function _v74Rates_() {
  var t = _v64Tab_(MC_V74.RATE[0]), out = [];
  if (!t.exists) return out;
  t.rows.forEach(function (r) {
    if (String(_v64G_(t, r, 'Status', 'ACTIVE')) !== 'ACTIVE') return;
    out.push({ id: String(_v64G_(t, r, 'RateID')), employee: _v74Norm_(_v64G_(t, r, 'Employee')), role: _v74Norm_(_v64G_(t, r, 'Role')), rate: _v64Num_(_v64G_(t, r, 'RatePerHour')),
      from: _v74Day_(_v64G_(t, r, 'DateFrom')), to: _v74Day_(_v64G_(t, r, 'DateTo')) });
  });
  return out;
}
function _v74RateFor_(rates, employee, role, date) {
  var d = _v74Day_(date), e = _v74Norm_(employee), ro = _v74Norm_(role);
  var ok = function (x) { return (!x.from || !d || x.from <= d) && (!x.to || !d || x.to >= d); };
  var pick = function (list) { return list.filter(ok).sort(function (a, b) { return (b.from ? b.from.getTime() : 0) - (a.from ? a.from.getTime() : 0); })[0] || null; };
  var own = e ? pick(rates.filter(function (x) { return x.employee && x.employee === e; })) : null;
  if (own) return { rate: own.rate, source: 'сотрудник', rateId: own.id };
  var byRole = ro ? pick(rates.filter(function (x) { return !x.employee && x.role === ro; })) : null;
  return byRole ? { rate: byRole.rate, source: 'роль', rateId: byRole.id } : null;
}
/** Смены V19: закрытые — с часами; открытые — отдельно (в стоимость не входят, пока смена не закрыта). */
function _v74Shifts_() {
  var t = _v64Tab_(MC_V74_SHIFTS), out = [];
  if (!t.exists) return out;
  t.rows.forEach(function (r) {
    var s = _v64Date_(_v64G_(t, r, 'StartedAt')), e = _v64Date_(_v64G_(t, r, 'EndedAt')), st = String(_v64G_(t, r, 'Status'));
    out.push({ id: String(_v64G_(t, r, 'ShiftID')), date: _v74Day_(_v64G_(t, r, 'Date')) || (s ? _v74Day_(s) : null), employee: String(_v64G_(t, r, 'Employee')), role: String(_v64G_(t, r, 'Role')),
      started: s, ended: e, status: st, hours: st === 'CLOSED' && s && e && e > s ? Math.round((e - s) / 36000) / 100 : null });
  });
  return out;
}
function _v74TsRows_() {
  var t = _v64Tab_(MC_V74.TS[0]), out = [];
  if (!t.exists) return out;
  t.rows.forEach(function (r) {
    out.push({ id: String(_v64G_(t, r, 'EntryID')), date: _v74Day_(_v64G_(t, r, 'Date')), employee: String(_v64G_(t, r, 'Employee')), role: String(_v64G_(t, r, 'Role')),
      hours: _v64Num_(_v64G_(t, r, 'Hours')), kind: String(_v64G_(t, r, 'Kind', 'MANUAL')), shiftId: String(_v64G_(t, r, 'ShiftID')), replaces: String(_v64G_(t, r, 'ReplacesID')),
      status: String(_v64G_(t, r, 'Status', 'ACTIVE')), reason: String(_v64G_(t, r, 'Reason')), author: String(_v64G_(t, r, 'CreatedBy')), cancelReason: String(_v64G_(t, r, 'CancelReason')) });
  });
  return out;
}
function _v74Bonuses_() {
  var t = _v64Tab_(MC_V74.BON[0]), out = [];
  if (!t.exists) return out;
  t.rows.forEach(function (r) {
    out.push({ id: String(_v64G_(t, r, 'BonusID')), date: _v74Day_(_v64G_(t, r, 'Date')), employee: String(_v64G_(t, r, 'Employee')), type: String(_v64G_(t, r, 'Type', 'BONUS')),
      amount: _v64Num_(_v64G_(t, r, 'Amount')), reason: String(_v64G_(t, r, 'Reason')), status: String(_v64G_(t, r, 'Status', 'DRAFT')), author: String(_v64G_(t, r, 'CreatedBy')),
      decidedBy: String(_v64G_(t, r, 'DecidedBy')), comment: String(_v64G_(t, r, 'DecisionComment')) });
  });
  return out;
}

/** Строки журнала V64 этапа «Труд» (вызывается из _v64Build_). push сам отбирает строки периода. */
function _v74LaborLines_(push) {
  var rates = _v74Rates_(), ts = _v74TsRows_().filter(function (x) { return x.status === 'ACTIVE'; }), fixed = {};
  ts.forEach(function (x) { if (x.shiftId) fixed[x.shiftId] = true; });
  var line = function (o, hours, rateInfo) {
    var flags = [];
    if (!rateInfo) flags.push('NO_RATE');
    if (hours > MC_V74_LONG_H) flags.push('LONG_SHIFT');
    var rate = rateInfo ? rateInfo.rate : 0;
    push(Object.assign({ stage: 'LABOR', dir: 'OUT', qty: hours, unit: 'ч', price: rate, amount: _v64R2_(hours * rate), trace: 'NOT_APPLICABLE', flags: flags,
      note: rateInfo ? 'ставка ' + rate + ' ₽/ч (' + rateInfo.source + ')' : 'нет ставки сотрудника или роли — стоимость не посчитана' }, o));
  };
  _v74Shifts_().forEach(function (s) {
    if (s.hours === null || fixed[s.id] || !s.date) return;
    line({ date: s.date, objType: 'SHIFT', objId: s.id, product: s.employee, employee: s.employee, role: s.role, source: MC_V74_SHIFTS, ref: s.id }, s.hours, _v74RateFor_(rates, s.employee, s.role, s.date));
  });
  ts.forEach(function (x) {
    if (!x.date) return;
    line({ date: x.date, objType: 'TIMESHEET', objId: x.id, product: x.employee, employee: x.employee, role: x.role, source: MC_V74.TS[0], ref: x.shiftId || x.id }, x.hours, _v74RateFor_(rates, x.employee, x.role, x.date));
  });
  _v74Bonuses_().forEach(function (b) {
    if (b.status !== 'APPROVED' || !b.date) return;
    var a = _v64R2_(b.type === 'PENALTY' ? -Math.abs(b.amount) : Math.abs(b.amount));
    push({ date: b.date, stage: 'LABOR', dir: 'OUT', objType: 'BONUS', objId: b.id, product: b.employee, employee: b.employee, qty: '', unit: '', price: '', amount: a, source: MC_V74.BON[0], ref: b.id,
      reason: b.type, trace: 'NOT_APPLICABLE', flags: [], note: (MC_V74_BONUS_RU[b.type] || b.type) + ': ' + b.reason + (b.decidedBy ? ' · подтвердил ' + b.decidedBy : '') });
  });
}

/* ---------------- чтение ---------------- */
/** Labor Cost за период: по сотрудникам, записи, проблемы, ставки, премии. */
function v74GetLabor(token, fromDate, toDate) {
  try {
    _requireAuth_(token, 'finance_view');
    _v64Drop_();
    var rg = _v64Range_(fromDate, toDate), L = [];
    _v74LaborLines_(function (o) { if (_v64In_(o.date, rg)) L.push(o); });
    var emp = {}, tot = { hours: 0, base: 0, bonus: 0, penalty: 0, total: 0, noRate: 0, longShifts: 0 };
    L.forEach(function (l) {
      var k = _v74Norm_(l.employee), x = emp[k] || (emp[k] = { employee: l.employee, roles: {}, hours: 0, base: 0, bonus: 0, penalty: 0, total: 0, shifts: 0, rates: {}, noRate: 0 });
      if (l.role) x.roles[l.role] = 1;
      if (l.objType === 'BONUS') { if (l.amount < 0) x.penalty += -l.amount; else x.bonus += l.amount; }
      else { x.hours += l.qty; x.base += l.amount; x.shifts++; if (l.price) x.rates[l.price] = 1; if (l.flags.indexOf('NO_RATE') >= 0) x.noRate++; if (l.flags.indexOf('LONG_SHIFT') >= 0) tot.longShifts++; }
      x.total += l.amount;
    });
    var byEmployee = Object.keys(emp).map(function (k) {
      var x = emp[k]; ['hours', 'base', 'bonus', 'penalty', 'total'].forEach(function (f) { x[f] = _v64R2_(x[f]); tot[f] += x[f]; });
      tot.noRate += x.noRate; x.role = Object.keys(x.roles).join(', '); x.rate = Object.keys(x.rates).join(' / '); delete x.roles; delete x.rates; return x;
    }).sort(function (a, b) { return b.total - a.total; });
    Object.keys(tot).forEach(function (f) { tot[f] = _v64R2_(tot[f]); });
    var today = _v74Day_(new Date()), problems = [];
    L.forEach(function (l) {
      if (l.flags.indexOf('NO_RATE') >= 0) problems.push({ code: 'NO_RATE', date: _v64Day_(l.date), employee: l.employee, ref: l.objId, text: 'Нет ставки — внесите ставку сотрудника или роли «' + (l.role || '—') + '»' });
      if (l.flags.indexOf('LONG_SHIFT') >= 0) problems.push({ code: 'LONG_SHIFT', date: _v64Day_(l.date), employee: l.employee, ref: l.objId, text: 'Смена ' + l.qty + ' ч — проверьте, не забыли ли закрыть смену вовремя' });
    });
    _v74Shifts_().forEach(function (s) {
      if (s.status === 'OPEN' && s.date && s.date < today && _v64In_(s.date, rg)) problems.push({ code: 'OPEN_SHIFT', date: _v64Day_(s.date), employee: s.employee, ref: s.id, text: 'Смена не закрыта — часы не учтены. Исправьте часы смены.' });
    });
    var bon = _v74Bonuses_().filter(function (b) { return b.date && _v64In_(b.date, rg); });
    bon.filter(function (b) { return b.status === 'DRAFT'; }).forEach(function (b) { problems.push({ code: 'BONUS_DRAFT', date: _v64Day_(b.date), employee: b.employee, ref: b.id, text: (MC_V74_BONUS_RU[b.type] || b.type) + ' ' + b.amount + ' ₽ ждёт подтверждения' }); });
    var rows = L.map(function (l) { return { date: _v64Day_(l.date), kind: l.objType === 'BONUS' ? (MC_V74_BONUS_RU[l.reason] || l.reason) : (MC_V74_KIND_RU[l.objType === 'SHIFT' ? 'SHIFT' : 'MANUAL']), id: l.objId, employee: l.employee, role: l.role || '',
      hours: l.qty, rate: l.price, amount: l.amount, flags: l.flags, flagsRu: l.flags.map(function (f) { return MC_V64_FLAG_RU[f] || f; }), note: l.note }; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var RT = _v64Tab_(MC_V74.RATE[0]), rateRows = RT.rows.map(function (r) { var t = RT; return { id: String(_v64G_(t, r, 'RateID')), employee: String(_v64G_(t, r, 'Employee')), role: String(_v64G_(t, r, 'Role')),
      rate: _v64Num_(_v64G_(t, r, 'RatePerHour')), from: _v64G_(t, r, 'DateFrom') ? _v64Day_(_v64Date_(_v64G_(t, r, 'DateFrom'))) : '', to: _v64G_(t, r, 'DateTo') ? _v64Day_(_v64Date_(_v64G_(t, r, 'DateTo'))) : '',
      status: String(_v64G_(t, r, 'Status', 'ACTIVE')), comment: String(_v64G_(t, r, 'Comment')) }; });
    var tsRows = _v74TsRows_().filter(function (x) { return x.date && _v64In_(x.date, rg); }).map(function (x) { return Object.assign({}, x, { date: _v64Day_(x.date), kindRu: MC_V74_KIND_RU[x.kind] || x.kind }); });
    return _ok_({ from: rg.fromIso, to: rg.toIso, totals: tot, byEmployee: byEmployee, entries: rows, problems: problems, rates: rateRows, timesheet: tsRows,
      bonuses: bon.map(function (b) { return Object.assign({}, b, { date: _v64Day_(b.date), typeRu: MC_V74_BONUS_RU[b.type] || b.type }); }),
      note: 'Управленческий Labor Cost: ставка × часы + подтверждённые премии − удержания. Не расчёт заработной платы.' });
  } catch (e) { return _failFrom_(e); }
}

/* ---------------- запись ---------------- */
/** Ставка в час с даты. json: {employee | role, ratePerHour, dateFrom, comment}. Прежняя ставка закрывается днём раньше. */
function v74SaveRate(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'finance_edit', 'V74_RATE', 'Экономика', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), emp = String(d.employee || '').trim(), role = String(d.role || '').trim(), rate = _v74Hours_(d.ratePerHour), from = _v74Day_(d.dateFrom) || _v74Day_(new Date());
    if (!emp && !role) return _v64Fail_(op, 'VALIDATION', 'Укажите сотрудника или роль');
    if (!(rate > 0)) return _v64Fail_(op, 'VALIDATION', 'Ставка в час должна быть больше нуля');
    var cl = _v74Closed_(from); if (cl) return _v64Fail_(op, 'CLOSED_PERIOD', cl);
    return _withLock_(function () {
      _V64_TAB_ = {};
      var sh = _v74Sh_('RATE'), h = MC_V74.RATE[1], v = sh.getDataRange().getValues(), c = function (n) { return h.indexOf(n); }, closedPrev = [];
      for (var i = 1; i < v.length; i++) {
        if (String(v[i][c('Status')] || 'ACTIVE') !== 'ACTIVE') continue;
        var same = emp ? _v74Norm_(v[i][c('Employee')]) === _v74Norm_(emp) : (!String(v[i][c('Employee')]).trim() && _v74Norm_(v[i][c('Role')]) === _v74Norm_(role));
        if (!same) continue;
        var f = _v74Day_(v[i][c('DateFrom')]), t = _v74Day_(v[i][c('DateTo')]);
        if (f && f.getTime() === from.getTime()) return _v64Fail_(op, 'DUPLICATE', 'Ставка с ' + _v64Day_(from) + ' уже есть (' + v[i][0] + ') — отмените её или выберите другую дату');
        if (f && f > from) return _v64Fail_(op, 'VALIDATION', 'Есть более поздняя ставка с ' + _v64Day_(f) + ' — новая ставка задним числом её не заменит; отмените её');
        if (!t || t >= from) { var prev = new Date(from.getFullYear(), from.getMonth(), from.getDate() - 1); sh.getRange(i + 1, c('DateTo') + 1).setValue(prev); closedPrev.push(String(v[i][0])); }
      }
      var id = _v64Id_('RATE');
      _v74Append_('RATE', { RateID: id, Employee: emp, Role: role, RatePerHour: rate, DateFrom: from, DateTo: '', Status: 'ACTIVE', CreatedAt: new Date(), CreatedBy: _v64Who_(op), Comment: d.comment || '', OperationID: op.id });
      _audit_(op, 'V74_RATE', MC_V74.RATE[0], id, closedPrev.length ? { closed: closedPrev } : null, { employee: emp, role: role, rate: rate, from: _v64Day_(from) });
      _endOp_(op);
      return _ok_({ rateId: id, closedPrevious: closedPrev }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Часы без смены. json: {date, employee, role, hours, reason, allowSecond}. */
function v74AddHours(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'finance_edit', 'V74_HOURS', 'Экономика', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), date = _v74Day_(d.date), emp = String(d.employee || '').trim(), hours = _v74Hours_(d.hours);
    if (!date) return _v64Fail_(op, 'VALIDATION', 'Укажите дату');
    if (!emp) return _v64Fail_(op, 'VALIDATION', 'Укажите сотрудника');
    if (!(hours > 0 && hours <= 24)) return _v64Fail_(op, 'VALIDATION', 'Часы — от 0 до 24');
    if (date > _v74Day_(new Date())) return _v64Fail_(op, 'VALIDATION', 'Часы за будущую дату не вносятся');
    var cl = _v74Closed_(date); if (cl) return _v64Fail_(op, 'CLOSED_PERIOD', cl);
    return _withLock_(function () {
      _V64_TAB_ = {};
      var e = _v74Norm_(emp), sh = _v74Shifts_().filter(function (s) { return s.date && s.date.getTime() === date.getTime() && _v74Norm_(s.employee) === e; });
      if (sh.length) return _v64Fail_(op, 'DUPLICATE', 'У сотрудника на ' + _v64Day_(date) + ' есть смена ' + sh[0].id + ' — исправьте часы смены, а не вносите их второй раз');
      var dup = _v74TsRows_().filter(function (x) { return x.status === 'ACTIVE' && x.date && x.date.getTime() === date.getTime() && _v74Norm_(x.employee) === e; });
      if (dup.length && !(d.allowSecond === true || d.allowSecond === 'true'))
        return _v64Fail_(op, 'DUPLICATE', 'Часы сотрудника на ' + _v64Day_(date) + ' уже внесены (' + dup[0].id + ', ' + dup[0].hours + ' ч). Исправьте запись или подтвердите вторую смену за день.');
      var id = _v64Id_('TS');
      _v74Append_('TS', { EntryID: id, Date: date, Employee: emp, Role: d.role || '', Hours: hours, Kind: 'MANUAL', Status: 'ACTIVE', Reason: d.reason || '', CreatedAt: new Date(), CreatedBy: _v64Who_(op), OperationID: op.id });
      _audit_(op, 'V74_HOURS', MC_V74.TS[0], id, null, { date: _v64Day_(date), employee: emp, hours: hours });
      _endOp_(op);
      return _ok_({ entryId: id }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Исправить часы смены или записи табеля. json: {shiftId | entryId, hours, reason}. Прежняя запись остаётся с причиной. */
function v74CorrectHours(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'finance_edit', 'V74_HOURS_FIX', 'Экономика', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), hours = _v74Hours_(d.hours), reason = String(d.reason || '').trim();
    if (!(hours >= 0 && hours <= 24)) return _v64Fail_(op, 'VALIDATION', 'Часы — от 0 до 24');
    if (!reason) return _v64Fail_(op, 'VALIDATION', 'Укажите причину исправления');
    return _withLock_(function () {
      _V64_TAB_ = {};
      var who = _v64Who_(op), now = new Date(), base, before;
      if (d.shiftId) {
        var s = _v74Shifts_().filter(function (x) { return x.id === String(d.shiftId); })[0];
        if (!s) return _v64Fail_(op, 'NOT_FOUND', 'Смена не найдена');
        base = { Date: s.date, Employee: s.employee, Role: s.role, ShiftID: s.id };
        var prevFix = _v74TsRows_().filter(function (x) { return x.status === 'ACTIVE' && x.shiftId === s.id; })[0];
        before = prevFix ? { entryId: prevFix.id, hours: prevFix.hours } : { shiftId: s.id, hours: s.hours, status: s.status };
        var cl = _v74Closed_(s.date); if (cl) return _v64Fail_(op, 'CLOSED_PERIOD', cl);
        if (prevFix) _v74Set_(_v74Find_('TS', prevFix.id), { Status: 'CANCELLED', CancelledAt: now, CancelledBy: who, CancelReason: 'заменено исправлением: ' + reason });
        base.ReplacesID = prevFix ? prevFix.id : '';
      } else {
        var f = _v74Find_('TS', d.entryId);
        if (!f || String(f.o.Status) !== 'ACTIVE') return _v64Fail_(op, 'NOT_FOUND', 'Действующая запись табеля не найдена');
        var cl2 = _v74Closed_(f.o.Date); if (cl2) return _v64Fail_(op, 'CLOSED_PERIOD', cl2);
        before = { entryId: f.o.EntryID, hours: f.o.Hours };
        base = { Date: f.o.Date, Employee: f.o.Employee, Role: f.o.Role, ShiftID: f.o.ShiftID, ReplacesID: f.o.EntryID };
        _v74Set_(f, { Status: 'CANCELLED', CancelledAt: now, CancelledBy: who, CancelReason: 'заменено исправлением: ' + reason });
      }
      var id = _v64Id_('TS');
      _v74Append_('TS', Object.assign(base, { EntryID: id, Hours: hours, Kind: base.ShiftID ? 'SHIFT_FIX' : 'MANUAL', Status: 'ACTIVE', Reason: reason, CreatedAt: now, CreatedBy: who, OperationID: op.id }));
      _audit_(op, 'V74_HOURS_FIX', MC_V74.TS[0], id, before, { hours: hours, reason: reason });
      _endOp_(op);
      return _ok_({ entryId: id, replaced: before }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Отменить запись табеля или ставку. json: {kind: 'TS' | 'RATE', id, reason}. */
function v74CancelRecord(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'finance_edit', 'V74_CANCEL', 'Экономика', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), k = String(d.kind || 'TS').toUpperCase(), reason = String(d.reason || '').trim();
    if (k !== 'TS' && k !== 'RATE') return _v64Fail_(op, 'VALIDATION', 'Вид записи: TS или RATE');
    if (!reason) return _v64Fail_(op, 'VALIDATION', 'Укажите причину отмены');
    return _withLock_(function () {
      _V64_TAB_ = {};
      var f = _v74Find_(k, d.id);
      if (!f || String(f.o.Status || 'ACTIVE') !== 'ACTIVE') return _v64Fail_(op, 'NOT_FOUND', 'Действующая запись не найдена');
      var cl = _v74Closed_(k === 'TS' ? f.o.Date : f.o.DateFrom); if (cl) return _v64Fail_(op, 'CLOSED_PERIOD', cl);
      _v74Set_(f, k === 'TS' ? { Status: 'CANCELLED', CancelledAt: new Date(), CancelledBy: _v64Who_(op), CancelReason: reason } : { Status: 'CANCELLED', CancelReason: reason });
      _audit_(op, 'V74_CANCEL', MC_V74[k][0], String(d.id), { status: 'ACTIVE' }, { status: 'CANCELLED', reason: reason });
      _endOp_(op);
      return _ok_({ id: String(d.id), status: 'CANCELLED' }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Премия или удержание — черновик. json: {date, employee, type: BONUS|PENALTY, amount, reason, requestId}. */
function v74AddBonus(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'finance_edit', 'V74_BONUS', 'Экономика', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), date = _v74Day_(d.date) || _v74Day_(new Date()), emp = String(d.employee || '').trim(), type = String(d.type || 'BONUS').toUpperCase(), amount = _v74Hours_(d.amount), reason = String(d.reason || '').trim();
    if (!emp) return _v64Fail_(op, 'VALIDATION', 'Укажите сотрудника');
    if (!MC_V74_BONUS_RU[type]) return _v64Fail_(op, 'VALIDATION', 'Вид: BONUS (премия) или PENALTY (удержание)');
    if (!(amount > 0)) return _v64Fail_(op, 'VALIDATION', 'Сумма должна быть больше нуля');
    if (!reason) return _v64Fail_(op, 'VALIDATION', 'Укажите основание');
    var cl = _v74Closed_(date); if (cl) return _v64Fail_(op, 'CLOSED_PERIOD', cl);
    return _withLock_(function () {
      _V64_TAB_ = {};
      var e = _v74Norm_(emp), dup = _v74Bonuses_().filter(function (b) { return b.status !== 'REJECTED' && b.date && b.date.getTime() === date.getTime() && _v74Norm_(b.employee) === e && b.type === type && b.amount === amount && _v74Norm_(b.reason) === _v74Norm_(reason); });
      if (dup.length) return _v64Fail_(op, 'DUPLICATE', 'Такая запись уже есть: ' + dup[0].id + ' (' + dup[0].status + ')');
      var id = _v64Id_('BON');
      _v74Append_('BON', { BonusID: id, Date: date, Employee: emp, Type: type, Amount: amount, Reason: reason, Status: 'DRAFT', CreatedAt: new Date(), CreatedBy: _v64Who_(op), OperationID: op.id });
      _audit_(op, 'V74_BONUS', MC_V74.BON[0], id, null, { date: _v64Day_(date), employee: emp, type: type, amount: amount, reason: reason });
      _endOp_(op);
      return _ok_({ bonusId: id, status: 'DRAFT', note: 'Премия или удержание войдёт в Labor Cost после подтверждения другим сотрудником с правом закрытия периода.' }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Подтвердить или отклонить премию/удержание. json: {bonusId, decision: APPROVE|REJECT, comment}. Подтверждает не автор. */
function v74DecideBonus(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'finance_close', 'V74_BONUS_DECIDE', 'Экономика', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), dec = String(d.decision || 'APPROVE').toUpperCase();
    if (dec !== 'APPROVE' && dec !== 'REJECT') return _v64Fail_(op, 'VALIDATION', 'Решение: APPROVE или REJECT');
    if (dec === 'REJECT' && !String(d.comment || '').trim()) return _v64Fail_(op, 'VALIDATION', 'Укажите, почему отклонено');
    return _withLock_(function () {
      _V64_TAB_ = {};
      var f = _v74Find_('BON', d.bonusId);
      if (!f) return _v64Fail_(op, 'NOT_FOUND', 'Запись не найдена');
      if (String(f.o.Status) !== 'DRAFT') return _v64Fail_(op, 'VALIDATION', 'Решение уже принято: ' + f.o.Status);
      var who = _v64Who_(op);
      if (_v74Norm_(who) === _v74Norm_(f.o.CreatedBy)) return _v64Fail_(op, 'FORBIDDEN', 'Подтверждает другой сотрудник, не автор записи');
      var cl = dec === 'APPROVE' ? _v74Closed_(f.o.Date) : ''; if (cl) return _v64Fail_(op, 'CLOSED_PERIOD', cl);
      var st = dec === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      _v74Set_(f, { Status: st, DecidedAt: new Date(), DecidedBy: who, DecisionComment: d.comment || '' });
      _audit_(op, 'V74_BONUS_DECIDE', MC_V74.BON[0], String(d.bonusId), { status: 'DRAFT' }, { status: st, comment: d.comment || '' });
      _endOp_(op);
      return _ok_({ bonusId: String(d.bonusId), status: st }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
