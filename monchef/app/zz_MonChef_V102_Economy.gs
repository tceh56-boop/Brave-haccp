/**
 * MON CHEF V102 — сквозная сверка экономики (MC-013).
 *
 * Собственность Слепцова Дениса Владимировича.
 * Разработчик кода — Слепцов Денис Владимирович.
 *
 * Сверка не пересчитывает экономику своей формулой — она сопоставляет независимые первичные записи с журналом V64 и показывает
 * расхождения с источником каждой цифры:
 *   1) выручка: сумма журнала продаж J36 за период ↔ выручка V64 (отменённые продажи V95 и возвраты по счёту зала — со знаком минус);
 *   2) себестоимость каждой продажи: стоимость партий, записанная в момент продажи («Продажи_Списание_V71») ↔ себестоимость продажи в V64
 *      (расхождение — цена партии изменилась после продажи: доп. расходы поставки, скидка поставщика, исправление прихода);
 *   3) зал: оплаченные счета ↔ продажи зала в J36 (оплачено, но заказ не закрыт — не проведено; возврат — сторно);
 *   4) полнота: продажи без цены, партии без цены закупки, расход без партии, недостача при продаже, себестоимость по нормативу.
 * Право — finance_view; без него финансовые поля не показываются нигде (проверено тестом по ролям).
 */
function _v102EcoJ36_(rg) {
  var sh = _book_().getSheetByName('Ж_Продажи'); if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getValues(), h = v[0].map(String), c = function (n) { return h.indexOf(n); }, out = [];
  for (var i = 1; i < v.length; i++) {
    var d = _v64Date_(v[i][c('Дата')]); if (!d || !_v64In_(d, rg)) continue;
    var src = String(v[i][c('Источник записи')] || ''), sid = (/\b(SL-\d{8}-[0-9A-F]{8})\b/.exec(src) || [])[1] || '';
    out.push({ row: i + 1, date: d, dish: String(v[i][c('Блюдо')] || ''), qty: _v64Num_(v[i][c('Количество')]), sum: _v64Num_(v[i][c('Сумма')]), src: src, saleId: sid, hall: /RS-ALLOC|возврат по счёту/.test(src),
      kind: /сторно\s+CN-/.test(src) ? (/возврат по счёту/.test(src) ? 'REFUND' : 'CANCEL') : /отменена\s+CN-/.test(src) ? 'CANCELLED_ORIGINAL' : 'SALE' });
  }
  return out;
}
function _v102EcoV71_() {
  var sh = _book_().getSheetByName(typeof MC_V71 !== 'undefined' ? MC_V71.SHEET : 'Продажи_Списание_V71'), m = {}; if (!sh || sh.getLastRow() < 2) return m;
  sh.getDataRange().getValues().slice(1).forEach(function (r) { if (r[0]) m[String(r[0])] = { cost: _v64Num_(r[11]), est: _v64Num_(r[12]), status: String(r[13] || '') }; });
  return m;
}
/** Сверка экономики за период: {from, to}. */
function v102EconomyCheck(json, token) {
  try {
    var s = _requireAuth_(token, 'finance_view'), d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    var rg = _v64Range_(d.from, d.to), res = _v64Build_(rg), L = res.lines, J = _v102EcoJ36_(rg), W = _v102EcoV71_(), issues = [], R2 = _v64R2_;
    // 1) выручка
    var jRev = R2(J.reduce(function (a, x) { return a + x.sum; }, 0));
    var vRev = R2(L.filter(function (l) { return l.stage === 'SALE' && l.dir === 'IN' && l.objType === 'SALE'; }).reduce(function (a, l) { return a + (Number(l.amount) || 0); }, 0));
    if (Math.abs(jRev - vRev) > 0.009) issues.push({ kind: 'REVENUE', severity: 'error', text: 'Выручка: журнал продаж ' + jRev + ' ₽, экономика ' + vRev + ' ₽ — разница ' + R2(jRev - vRev) + ' ₽ (продажа без цены или с неверной суммой)', ref: 'Ж_Продажи' });
    // 2) себестоимость каждой продажи: в момент продажи ↔ экономика
    var bySale = {}; L.forEach(function (l) { if (l.stage === 'SALE' && l.dir === 'OUT' && l.objType === 'SALE' && (l.flags || []).indexOf('SALE_CANCELLED') < 0) bySale[l.objId] = (bySale[l.objId] || 0) + (Number(l.amount) || 0); });
    var saleRows = [];
    J.forEach(function (x) {
      if (x.kind !== 'SALE' && x.kind !== 'CANCELLED_ORIGINAL') return;
      var w = x.saleId ? W[x.saleId] : null, v64 = R2(bySale['J36-' + x.row] || 0), at = w ? R2(w.cost + w.est) : null;
      var row = { row: x.row, date: _v64Day_(x.date), dish: x.dish, qty: x.qty, revenue: R2(x.sum), costAtSale: at, costEconomy: v64, diff: at === null ? null : R2(v64 - at), hall: x.hall, cancelled: x.kind === 'CANCELLED_ORIGINAL' };
      saleRows.push(row);
      if (at !== null && Math.abs(row.diff) > 0.009) issues.push({ kind: 'COST', severity: 'warning', text: 'Продажа строка ' + x.row + ' «' + x.dish + '»: себестоимость в момент продажи ' + at + ' ₽, сейчас ' + v64 + ' ₽ — цена партии изменилась после продажи (доп. расходы, скидка, исправление прихода)', ref: 'J36-' + x.row });
      if (!x.saleId && !x.hall && x.kind === 'SALE') issues.push({ kind: 'NO_STOCK_LINK', severity: 'info', text: 'Продажа строка ' + x.row + ' «' + x.dish + '» без списания по партиям — себестоимость по нормативу ТТК', ref: 'J36-' + x.row });
    });
    // 3) зал: оплачено ↔ проведено
    var hall = null;
    try {
      var bills = _rsRows_(MC_RS_SH_.BILLS), orders = {}; _rsRows_(MC_RS_SH_.ORDERS).forEach(function (o) { orders[String(o.OrderID)] = o; });
      var paid = 0, unposted = [];
      bills.forEach(function (b) { var pd = _v64Date_(b['Подтверждено']); if (!pd || !_v64In_(pd, rg) || ['PAID', 'REFUNDED'].indexOf(String(b['Статус'])) < 0) return;
        var k = parseInt(b['Итого, коп'], 10) || 0; paid += k; var o = orders[String(b.OrderID)];
        if (!o || String(o['Статус']) !== 'CLOSED') unposted.push({ bill: String(b.BillID), order: String(b.OrderID), sumKop: k }); });
      var posted = Math.round(J.filter(function (x) { return x.hall && x.kind !== 'REFUND'; }).reduce(function (a, x) { return a + x.sum; }, 0) * 100);
      var refunds = Math.round(J.filter(function (x) { return x.kind === 'REFUND'; }).reduce(function (a, x) { return a + x.sum; }, 0) * 100);
      var unp = unposted.reduce(function (a, x) { return a + x.sumKop; }, 0);
      hall = { paidKop: paid, postedKop: posted, refundsKop: refunds, unpostedKop: unp, unposted: unposted };
      if (paid - unp !== posted) issues.push({ kind: 'HALL', severity: 'error', text: 'Зал: оплачено по закрытым заказам ' + (paid - unp) / 100 + ' ₽, проведено в журнал ' + posted / 100 + ' ₽', ref: 'СчетаВнутренние_V1' });
      if (unposted.length) issues.push({ kind: 'HALL_UNPOSTED', severity: 'warning', text: 'Оплачено, но заказ не закрыт — продажа не проведена: ' + unposted.length + ' счёт(ов) на ' + unp / 100 + ' ₽', ref: 'ЗаказыЗала_V1' });
    } catch (e) {}
    // 4) полнота данных
    var F = {}; L.forEach(function (l) { (l.flags || []).forEach(function (f) { F[f] = (F[f] || 0) + 1; }); });
    ['MISSING_PRICE', 'MISSING_SALE_PRICE', 'NO_BATCH', 'SALE_STOCK_SHORT', 'NORMATIVE_COST', 'NO_UNIT_MATCH'].forEach(function (f) {
      if (F[f]) issues.push({ kind: 'DATA', severity: f === 'NORMATIVE_COST' ? 'info' : 'warning', text: (MC_V64_FLAG_RU[f] || f) + ': ' + F[f] + ' строк(и) — показатели по ним неполные', ref: f });
    });
    var cancelled = J.filter(function (x) { return x.kind === 'CANCEL'; }), refundsRows = J.filter(function (x) { return x.kind === 'REFUND'; });
    return _ok_({ from: rg.fromIso, to: rg.toIso, revenue: { journal: jRev, economy: vRev }, sales: saleRows, hall: hall, flags: F, cancelled: cancelled.length, refunds: refundsRows.length,
      issues: issues, ok: !issues.some(function (x) { return x.severity === 'error'; }),
      note: 'Сверка сопоставляет первичные записи (журнал продаж, списание при продаже, счета зала) с экономикой V64. Отменённые продажи (V95) исключены из выручки и себестоимости; возврат по счёту зала уменьшает выручку, себестоимость поданного блюда остаётся.' });
  } catch (e) { return _failFrom_(e); }
}
MC_GATE_EXT_.v102EconomyCheck = { need: 'finance_view' };
