/**
 * MON CHEF V101 — Restaurant Service: внутренние счета и разделение счёта (этап 3).
 *
 * Собственность Слепцова Дениса Владимировича.
 * Разработчик кода — Слепцов Денис Владимирович.
 *
 * Внутренний счёт MON CHEF — НЕ фискальный чек. Позиция заказа не копируется: счёт ссылается на неё долей
 * (числитель / знаменатель). Сумма доли считается в копейках; копейки, которые не делятся ровно, отдаются долям
 * с наибольшим остатком — сумма долей всегда равна сумме позиции (без двойного начисления и без потери копейки).
 * Варианты: один счёт; поровну на N; по гостям (позиции без гостя — в счёт «Общее»); вручную — доли каждой позиции.
 * «Частичное разделение количества» — доля (например, 2 из 3 бокалов = 2/3). Объединение счетов — доли сливаются.
 * Скидка и сервисный сбор — вручную (процент или сумма) с причиной, право «discount»; автоматических правил нет.
 * Оплата: касса MON CHEF не подключена — оплату подтверждает сотрудник с правом «payment_confirm» (способ, № чека);
 * сверка с Z-отчётом кассы (V94) и проводка в журнал продаж и экономику — этап 7. Оплаченный счёт не меняется.
 */
var MC_RS_BILL_RU_ = { OPEN: 'не оплачен', PAID: 'оплачен', VOID: 'пересоздан', MERGED: 'объединён' };
var MC_RS_PAY_ = { CASH: 'наличные', CARD: 'карта', OTHER: 'другое' };

function _rsGcd_(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { var t = a % b; a = b; b = t; } return a || 1; }
/** Доли позиции → копейки (наибольший остаток). shares: [{key, num, den}], totalKop. */
function _rsSplitKop_(totalKop, shares) {
  var res = {}, used = 0, rest = [];
  shares.forEach(function (s, i) { var exact = totalKop * s.num / s.den, fl = Math.floor(exact + 1e-9); res[s.key] = fl; used += fl; rest.push({ key: s.key, frac: exact - fl, i: i }); });
  var full = shares.reduce(function (a, s) { return a + s.num / s.den; }, 0), target = Math.round(totalKop * full);
  rest.sort(function (a, b) { return b.frac - a.frac || a.i - b.i; });
  for (var k = 0; used < target && k < rest.length; k++, used++) res[rest[k].key]++;
  return res;
}
/** Сумма дробей = 1? (точно, без плавающей точки) */
function _rsFracSum_(list) {
  var n = 0, d = 1;
  list.forEach(function (x) { var nn = n * x.den + x.num * d, dd = d * x.den, g = _rsGcd_(nn, dd); n = nn / g; d = dd / g; });
  return { num: n, den: d };
}
function _rsBillObj_(r) {
  return { id: String(r.BillID), orderId: String(r.OrderID), name: String(r['Название'] || ''), guest: parseInt(r['Гость'], 10) || 0,
    discountType: String(r['Скидка вид'] || ''), discountValue: _rsNum_(r['Скидка значение']) || 0, discountReason: String(r['Причина скидки'] || ''),
    serviceType: String(r['Сбор вид'] || ''), serviceValue: _rsNum_(r['Сбор значение']) || 0, serviceReason: String(r['Причина сбора'] || ''),
    status: String(r['Статус'] || 'OPEN'), statusRu: MC_RS_BILL_RU_[r['Статус']] || r['Статус'], paidKop: parseInt(r['Итого, коп'], 10) || 0,
    method: String(r['Способ оплаты'] || ''), receipt: String(r['Чек'] || ''), confirmedBy: String(r['Подтвердил'] || ''),
    confirmedAt: _rsIsDate_(r['Подтверждено']) ? Utilities.formatDate(r['Подтверждено'], _mcTz_(), 'dd.MM HH:mm') : String(r['Подтверждено'] || ''), version: parseInt(r.Version, 10) || 1 };
}
function _rsAdj_(type, value, base) { if (type === 'PERCENT') return Math.round(base * value / 100); if (type === 'SUM') return Math.round(value * 100); return 0; }
/** Счета заказа с суммами. o — заказ из _rsOrderFull_ (с items). */
function _rsBillsOf_(o) {
  var bills = _rsRows_(MC_RS_SH_.BILLS).filter(function (b) { return String(b.OrderID) === o.id && ['OPEN', 'PAID'].indexOf(String(b['Статус'])) >= 0; }).map(_rsBillObj_);
  var allocs = _rsRows_(MC_RS_SH_.ALLOC).filter(function (a) { return String(a.OrderID) === o.id && String(a['Статус']) === 'ACTIVE'; });
  var live = {}; o.items.forEach(function (it) { if (it.status !== 'CANCELLED') live[it.id] = it; });
  var byItem = {}; allocs.forEach(function (a) { if (!live[a.OrderItemID]) return; (byItem[a.OrderItemID] = byItem[a.OrderItemID] || []).push(a); });
  var lines = {}; bills.forEach(function (b) { lines[b.id] = []; b.subtotalKop = 0; });
  var unallocated = [];
  Object.keys(live).forEach(function (iid) {
    var it = live[iid], al = byItem[iid] || [], tot = _rsItKop_(it);
    var sh = al.filter(function (a) { return lines[a.BillID]; }).map(function (a) { return { key: String(a.AllocID), bill: String(a.BillID), num: parseInt(a['Доля числитель'], 10), den: parseInt(a['Доля знаменатель'], 10) }; });
    var f = _rsFracSum_(sh); if (f.num < f.den) unallocated.push({ itemId: iid, name: it.name, rest: { num: f.den - f.num, den: f.den } });
    var kop = _rsSplitKop_(tot, sh);
    sh.forEach(function (s) { lines[s.bill].push({ allocId: s.key, itemId: iid, name: it.name, qty: it.qty, guest: it.guest, num: s.num, den: s.den, kop: kop[s.key] }); });
  });
  var paidKop = 0;
  bills.forEach(function (b) {
    b.lines = lines[b.id]; b.subtotalKop = b.lines.reduce(function (a, l) { return a + l.kop; }, 0);
    b.discountKop = Math.min(b.subtotalKop, _rsAdj_(b.discountType, b.discountValue, b.subtotalKop));
    b.serviceKop = _rsAdj_(b.serviceType, b.serviceValue, b.subtotalKop - b.discountKop);
    b.totalKop = b.subtotalKop - b.discountKop + b.serviceKop;
    if (b.status === 'PAID') { b.totalKop = b.paidKop; paidKop += b.paidKop; }
  });
  return { bills: bills, unallocated: unallocated, paidKop: paidKop };
}
/** Позиция в оплаченном счёте? */
function _rsItemPaid_(itemId) {
  var paid = {}; _rsRows_(MC_RS_SH_.BILLS).forEach(function (b) { if (String(b['Статус']) === 'PAID') paid[String(b.BillID)] = 1; });
  return _rsRows_(MC_RS_SH_.ALLOC).some(function (a) { return String(a.OrderItemID) === String(itemId) && String(a['Статус']) === 'ACTIVE' && paid[String(a.BillID)]; });
}

/**
 * Разделить счёт (счета пересоздаются; прежние — «пересоздан», история сохраняется). Нельзя, если есть оплаченный счёт.
 * {idem, orderId, mode:'one'|'equal'|'guests'|'manual', parts, bills:[{name, guest, items:[{itemId, num, den}]}]}
 */
function rsBillSplit(json, token) {
  return _rsMutate_(token, 'bill_split|order_all', 'RS_BILL_SPLIT', json, function (c) {
    var L = _rsLoadOrder_(c); if (L.fail) return L;
    var d = c.d, mode = ['one', 'equal', 'guests', 'manual'].indexOf(d.mode) >= 0 ? d.mode : 'one';
    var full = _rsOrderFull_(L.o.id, c.s), live = full.items.filter(function (x) { return x.status !== 'CANCELLED'; });
    if ((full.bills || []).some(function (b) { return b.status === 'PAID'; })) return { fail: ['VALIDATION', 'Есть оплаченный счёт — разделение заново невозможно. Неоплаченные позиции распределите вручную в оставшиеся счета'] };
    if (!live.length) return { fail: ['VALIDATION', 'В заказе нет позиций'] };
    var spec = [];
    if (mode === 'one') spec = [{ name: 'Счёт', guest: 0, items: live.map(function (it) { return { itemId: it.id, num: 1, den: 1 }; }) }];
    else if (mode === 'equal') {
      var n = parseInt(d.parts, 10); if (!(n >= 2 && n <= 30)) return { fail: ['VALIDATION', 'Поровну — на 2…30 частей'] };
      for (var k = 1; k <= n; k++) spec.push({ name: 'Часть ' + k + ' из ' + n, guest: 0, items: live.map(function (it) { return { itemId: it.id, num: 1, den: n }; }) });
    } else if (mode === 'guests') {
      var gs = {}; live.forEach(function (it) { (gs[it.guest] = gs[it.guest] || []).push({ itemId: it.id, num: 1, den: 1 }); });
      Object.keys(gs).map(Number).sort(function (a, b) { return (a || 99) - (b || 99); }).forEach(function (g) { spec.push({ name: g ? 'Гость ' + g : 'Общее', guest: g, items: gs[g] }); });
    } else {
      if (!Array.isArray(d.bills) || !d.bills.length || d.bills.length > 30) return { fail: ['VALIDATION', 'Счетов — от 1 до 30'] };
      spec = d.bills.map(function (b, i) { return { name: _rsS_(b.name).slice(0, 40) || 'Счёт ' + (i + 1), guest: parseInt(b.guest, 10) || 0, items: Array.isArray(b.items) ? b.items : [] }; });
    }
    // проверка долей: каждая живая позиция распределена ровно на 1
    var liveIdx = {}; live.forEach(function (it) { liveIdx[it.id] = it; });
    var per = {};
    for (var i = 0; i < spec.length; i++) for (var j = 0; j < spec[i].items.length; j++) {
      var x = spec[i].items[j], num = parseInt(x.num, 10), den = parseInt(x.den, 10);
      if (!liveIdx[x.itemId]) return { fail: ['VALIDATION', 'Позиция не найдена или отменена'] };
      if (!(num >= 1 && den >= 1 && num <= den && den <= 1000)) return { fail: ['VALIDATION', '«' + liveIdx[x.itemId].name + '»: доля — от 1/1000 до 1'] };
      (per[x.itemId] = per[x.itemId] || []).push({ num: num, den: den });
    }
    var bad = live.filter(function (it) { var f = _rsFracSum_(per[it.id] || []); return !(f.num === f.den && f.den > 0 && (per[it.id] || []).length); });
    if (bad.length) return { fail: ['VALIDATION', 'Позиции распределены не полностью или больше чем на 100 %: ' + bad.map(function (b) { return '«' + b.name + '»'; }).join(', ')] };
    var plan = [];
    _rsRows_(MC_RS_SH_.BILLS).forEach(function (b) { if (String(b.OrderID) !== L.o.id || String(b['Статус']) !== 'OPEN') return; var x = _rsCopy_(b); delete x._row; x['Статус'] = 'VOID'; _rsStamp_(x, c.s, c.op, false); plan.push({ sheet: MC_RS_SH_.BILLS, row: x }); });
    _rsRows_(MC_RS_SH_.ALLOC).forEach(function (a) { if (String(a.OrderID) !== L.o.id || String(a['Статус']) !== 'ACTIVE') return; var x = _rsCopy_(a); delete x._row; x['Статус'] = 'VOID'; _rsStamp_(x, c.s, c.op, false); plan.push({ sheet: MC_RS_SH_.ALLOC, row: x }); });
    var made = [];
    spec.forEach(function (b) {
      var id = _rsId_('BILL'); made.push(id);
      plan.push({ sheet: MC_RS_SH_.BILLS, row: _rsStamp_({ BillID: id, OrderID: L.o.id, 'Название': b.name, 'Гость': b.guest || '', 'Статус': 'OPEN' }, c.s, c.op, true) });
      b.items.forEach(function (x) { var g = _rsGcd_(+x.num, +x.den);
        plan.push({ sheet: MC_RS_SH_.ALLOC, row: _rsStamp_({ AllocID: _rsId_('AL'), BillID: id, OrderID: L.o.id, OrderItemID: x.itemId, 'Доля числитель': x.num / g, 'Доля знаменатель': x.den / g, 'Статус': 'ACTIVE' }, c.s, c.op, true) }); });
    });
    plan.push({ sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'ORDER', L.o.id, { order: L.o.id }, 'BILLS_SPLIT', null, { mode: mode, bills: spec.map(function (b) { return { name: b.name, items: b.items }; }) }) });
    return { data: { bills: made, mode: mode }, plan: plan, audit: { action: 'RS_BILL_SPLIT', entity: MC_RS_SH_.BILLS, id: L.o.id, after: { mode: mode, bills: made.length } } };
  });
}
/** Добавить нераспределённые позиции (новые после разделения) в счёт целиком или долей. {idem, orderId, billId, items:[{itemId, num, den}]} */
function rsBillAssign(json, token) {
  return _rsMutate_(token, 'bill_split|order_all', 'RS_BILL_ASSIGN', json, function (c) {
    var L = _rsLoadOrder_(c); if (L.fail) return L;
    var full = _rsOrderFull_(L.o.id, c.s), bill = (full.bills || []).filter(function (b) { return b.id === c.d.billId; })[0];
    if (!bill || bill.status !== 'OPEN') return { fail: ['VALIDATION', 'Счёт не найден или уже оплачен'] };
    var un = {}; (full.unallocated || []).forEach(function (u) { un[u.itemId] = u; });
    var plan = [], list = Array.isArray(c.d.items) ? c.d.items : [];
    for (var i = 0; i < list.length; i++) {
      var x = list[i], u = un[x.itemId]; if (!u) return { fail: ['VALIDATION', 'Позиция уже распределена полностью'] };
      var num = parseInt(x.num, 10) || u.rest.num, den = parseInt(x.den, 10) || u.rest.den;
      if (num * u.rest.den > u.rest.num * den || !(num >= 1 && den >= 1)) return { fail: ['VALIDATION', '«' + u.name + '»: доля больше нераспределённого остатка'] };
      var g = _rsGcd_(num, den);
      plan.push({ sheet: MC_RS_SH_.ALLOC, row: _rsStamp_({ AllocID: _rsId_('AL'), BillID: bill.id, OrderID: L.o.id, OrderItemID: x.itemId, 'Доля числитель': num / g, 'Доля знаменатель': den / g, 'Статус': 'ACTIVE' }, c.s, c.op, true) });
    }
    if (!plan.length) return { fail: ['VALIDATION', 'Выберите позиции'] };
    plan.push({ sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'BILL', bill.id, { order: L.o.id }, 'BILL_ASSIGNED', null, { items: list }) });
    return { data: { billId: bill.id, added: plan.length - 1 }, plan: plan, audit: { action: 'RS_BILL_ASSIGNED', entity: MC_RS_SH_.ALLOC, id: bill.id } };
  });
}
/** Объединить неоплаченные счета в первый. {idem, orderId, billIds[]} */
function rsBillMerge(json, token) {
  return _rsMutate_(token, 'bill_split|order_all', 'RS_BILL_MERGE', json, function (c) {
    var L = _rsLoadOrder_(c); if (L.fail) return L;
    var ids = (Array.isArray(c.d.billIds) ? c.d.billIds : []).map(String).filter(function (x, i, a) { return a.indexOf(x) === i; });
    if (ids.length < 2) return { fail: ['VALIDATION', 'Выберите не меньше двух счетов'] };
    var rows = _rsRows_(MC_RS_SH_.BILLS).filter(function (b) { return ids.indexOf(String(b.BillID)) >= 0 && String(b.OrderID) === L.o.id; });
    if (rows.length !== ids.length || rows.some(function (b) { return String(b['Статус']) !== 'OPEN'; })) return { fail: ['VALIDATION', 'Объединяются только неоплаченные счета этого заказа'] };
    var target = ids[0], plan = [], agg = {};
    _rsRows_(MC_RS_SH_.ALLOC).forEach(function (a) {
      if (String(a['Статус']) !== 'ACTIVE' || ids.indexOf(String(a.BillID)) < 0) return;
      var x = _rsCopy_(a); delete x._row; x['Статус'] = 'VOID'; _rsStamp_(x, c.s, c.op, false); plan.push({ sheet: MC_RS_SH_.ALLOC, row: x });
      (agg[a.OrderItemID] = agg[a.OrderItemID] || []).push({ num: parseInt(a['Доля числитель'], 10), den: parseInt(a['Доля знаменатель'], 10) });
    });
    Object.keys(agg).forEach(function (iid) { var f = _rsFracSum_(agg[iid]);
      plan.push({ sheet: MC_RS_SH_.ALLOC, row: _rsStamp_({ AllocID: _rsId_('AL'), BillID: target, OrderID: L.o.id, OrderItemID: iid, 'Доля числитель': f.num, 'Доля знаменатель': f.den, 'Статус': 'ACTIVE' }, c.s, c.op, true) }); });
    rows.forEach(function (b) { if (String(b.BillID) === target) return; var x = _rsCopy_(b); delete x._row; x['Статус'] = 'MERGED'; x['Объединён в'] = target; _rsStamp_(x, c.s, c.op, false); plan.push({ sheet: MC_RS_SH_.BILLS, row: x }); });
    plan.push({ sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'BILL', target, { order: L.o.id }, 'BILLS_MERGED', { bills: ids }, { into: target }) });
    return { data: { billId: target }, plan: plan, audit: { action: 'RS_BILL_MERGED', entity: MC_RS_SH_.BILLS, id: target, before: { bills: ids } } };
  });
}
/** Скидка и сервисный сбор счёта — вручную, с причиной. type: NONE | PERCENT | SUM. {idem, billId, version, discountType, discountValue, discountReason, serviceType, serviceValue, serviceReason} */
function rsBillAdjust(json, token) {
  return _rsMutate_(token, 'discount', 'RS_BILL_ADJUST', json, function (c) {
    var d = c.d, r = _rsRows_(MC_RS_SH_.BILLS).filter(function (b) { return String(b.BillID) === String(d.billId); })[0];
    if (!r) return { fail: ['NOT_FOUND', 'Счёт не найден'] };
    c.d.orderId = r.OrderID; var L = _rsLoadOrder_(c); if (L.fail && L.fail[0] !== 'FORBIDDEN') return L;
    _rsCheckVersion_(r, d.version);
    if (String(r['Статус']) !== 'OPEN') return { fail: ['VALIDATION', 'Счёт оплачен — скидка не меняется'] };
    var chk = function (t, v, why, what, maxPct) {
      t = String(t || 'NONE').toUpperCase(); if (t === 'NONE') return { t: '', v: '', why: '' };
      if (['PERCENT', 'SUM'].indexOf(t) < 0) throw new Error('VALIDATION: ' + what + ' — процент или сумма');
      var n = _rsNum_(v); if (!(n > 0) || (t === 'PERCENT' && n > maxPct)) throw new Error('VALIDATION: ' + what + ' — ' + (t === 'PERCENT' ? 'от 0 до ' + maxPct + ' %' : 'больше нуля'));
      var w = _rsS_(why).slice(0, 200); if (!w) throw new Error('VALIDATION: ' + what + ' — укажите причину');
      return { t: t, v: n, why: w };
    };
    var ds = chk(d.discountType, d.discountValue, d.discountReason, 'скидка', 100), sv = chk(d.serviceType, d.serviceValue, d.serviceReason, 'сервисный сбор', 30);
    var before = _rsBillObj_(r), x = _rsCopy_(r); delete x._row;
    x['Скидка вид'] = ds.t; x['Скидка значение'] = ds.v; x['Причина скидки'] = ds.why; x['Сбор вид'] = sv.t; x['Сбор значение'] = sv.v; x['Причина сбора'] = sv.why;
    _rsStamp_(x, c.s, c.op, false);
    var after = { discount: ds, service: sv };
    return { data: { billId: x.BillID }, plan: [{ sheet: MC_RS_SH_.BILLS, row: x }, { sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'BILL', x.BillID, { order: String(r.OrderID) }, 'BILL_ADJUSTED',
      { discount: [before.discountType, before.discountValue, before.discountReason], service: [before.serviceType, before.serviceValue, before.serviceReason] }, after) }],
      audit: { action: 'RS_BILL_ADJUSTED', entity: MC_RS_SH_.BILLS, id: x.BillID, after: after } };
  });
}
/** Подтвердить оплату счёта (по кассе). {idem, billId, version, method:CASH|CARD|OTHER, receipt, amountKop (сверка с экраном), comment} */
function rsBillPay(json, token) {
  return _rsMutate_(token, 'payment_confirm', 'RS_BILL_PAY', json, function (c) {
    var d = c.d, r = _rsRows_(MC_RS_SH_.BILLS).filter(function (b) { return String(b.BillID) === String(d.billId); })[0];
    if (!r) return { fail: ['NOT_FOUND', 'Счёт не найден'] };
    _rsCheckVersion_(r, d.version);
    if (String(r['Статус']) !== 'OPEN') return { fail: ['VALIDATION', 'Счёт ' + (MC_RS_BILL_RU_[r['Статус']] || r['Статус'])] };
    var o = _rsOrderRow_(r.OrderID); if (!o || String(o['Статус']) !== 'OPEN') return { fail: ['VALIDATION', 'Заказ не открыт'] };
    var full = _rsOrderFull_(String(r.OrderID), c.s), bill = full.bills.filter(function (b) { return b.id === String(r.BillID); })[0];
    if (!bill.lines.length) return { fail: ['VALIDATION', 'В счёте нет позиций'] };
    var idx = {}; full.items.forEach(function (it) { idx[it.id] = it; });
    var notSent = bill.lines.filter(function (l) { return idx[l.itemId].status === 'DRAFT'; }), noWeight = bill.lines.filter(function (l) { return idx[l.itemId].weighted && idx[l.itemId].factAmount === null; });
    if (notSent.length) return { fail: ['VALIDATION', 'В счёте неотправленные позиции: ' + notSent.map(function (l) { return '«' + l.name + '»'; }).join(', ')] };
    if (noWeight.length) return { fail: ['VALIDATION', 'Внесите фактический вес: ' + noWeight.map(function (l) { return '«' + l.name + '»'; }).join(', ')] };
    if (d.amountKop !== undefined && parseInt(d.amountKop, 10) !== bill.totalKop) return { fail: ['CONFLICT', 'Сумма счёта изменилась: ' + (bill.totalKop / 100).toFixed(2) + ' ₽ — обновите экран'] };
    var m = String(d.method || '').toUpperCase(); if (!MC_RS_PAY_[m]) return { fail: ['VALIDATION', 'Способ оплаты: наличные, карта или другое'] };
    var rc = _rsS_(d.receipt).slice(0, 40); if (m !== 'CASH' && !rc) return { fail: ['VALIDATION', 'Укажите номер чека или операции'] };
    var x = _rsCopy_(r); delete x._row;
    x['Статус'] = 'PAID'; x['Итого, коп'] = bill.totalKop; x['Способ оплаты'] = m; x['Чек'] = rc; x['Подтвердил'] = _rsWho_(c.s); x['Подтверждено'] = new Date(); x['Комментарий'] = _rsS_(d.comment).slice(0, 200);
    _rsStamp_(x, c.s, c.op, false);
    var after = { totalKop: bill.totalKop, subtotalKop: bill.subtotalKop, discountKop: bill.discountKop, serviceKop: bill.serviceKop, method: m, receipt: rc, lines: bill.lines.map(function (l) { return [l.itemId, l.num + '/' + l.den, l.kop]; }) };
    return { data: { billId: x.BillID, totalKop: bill.totalKop, note: 'Внутренний счёт — не фискальный чек. Сверка с Z-отчётом кассы — по дате смены.' },
      plan: [{ sheet: MC_RS_SH_.BILLS, row: x }, { sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'BILL', x.BillID, { order: String(r.OrderID) }, 'BILL_PAID', { status: 'OPEN' }, after) }],
      audit: { action: 'RS_BILL_PAID', entity: MC_RS_SH_.BILLS, id: x.BillID, after: { totalKop: bill.totalKop, method: m, receipt: rc } } };
  });
}

var MC_GATE_EXT_ = (typeof MC_GATE_EXT_ !== 'undefined' && MC_GATE_EXT_) || {};
MC_GATE_EXT_.rsBillSplit = { need: 'bill_split|order_all', mut: true };
MC_GATE_EXT_.rsBillAssign = { need: 'bill_split|order_all', mut: true };
MC_GATE_EXT_.rsBillMerge = { need: 'bill_split|order_all', mut: true };
MC_GATE_EXT_.rsBillAdjust = { need: 'discount', mut: true };
MC_GATE_EXT_.rsBillPay = { need: 'payment_confirm', mut: true };
