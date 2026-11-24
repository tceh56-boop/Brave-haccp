/**
 * MON CHEF V101 — Restaurant Service: Stop/Go — доступность блюд и напитков (ТЗ Restaurant Service 1.0, модуль 4, этап 4).
 *
 * Собственность Слепцова Дениса Владимировича.
 * Разработчик кода — Слепцов Денис Владимирович.
 *
 * Статусы: GO — доступно; STOP — временно недоступно; LIMITED — ограниченное количество (остаток уменьшается при отправке
 *   заказа на производство; закончился — STOP «лимит исчерпан»); REVIEW — нужна проверка ответственного.
 * Кухня и бар независимы: запись — по паре «блюдо — подразделение» (KITCHEN / BAR).
 * Лист «СтопГО_V1»: строки не удаляются; действующая запись по паре — «Актуально», прежняя становится неактуальной.
 * STOP: новые заказы блюда блокируются (добавление и отправка), гостевая витрина показывает «сейчас нет», официанту и
 *   руководителям — уведомление, событие — в аудите. Принятые заказы не удаляются: повар решает, можно ли их выполнить;
 *   «нельзя» — их задания и позиции получают статус «проблема», официант согласует замену с гостем (rsItemReplace).
 * GO: подтверждение готовности, причина восстановления, кто и когда; «на проверке» снимает только ответственный (stopgo_approve).
 */
var MC_RS_STOP_REASONS_ = ['Закончилось сырьё', 'Закончилась заготовка', 'Неисправность оборудования', 'Производственная проблема', 'Проблема качества', 'Временное ограничение'];
var MC_RS_STOP_RU_ = { GO: 'доступно', STOP: 'STOP', LIMITED: 'ограничено', REVIEW: 'на проверке' };

function _rsStopRows_() { return _rsRows_(MC_RS_SH_.STOPGO); }
function _rsStopCur_(rows, code, dept) { return rows.filter(function (r) { return String(r.DishCode) === code && String(r['Подразделение']) === dept && (r['Актуально'] === true || String(r['Актуально']) === 'true'); })[0] || null; }
function _rsStopObj_(r) {
  var hm = function (x) { return _rsIsDate_(x) ? Utilities.formatDate(x, _mcTz_(), 'dd.MM HH:mm') : ''; };
  return { id: String(r.StopID), code: String(r.DishCode), name: String(r['Название'] || ''), dept: String(r['Подразделение']), status: String(r['Статус']), statusRu: MC_RS_STOP_RU_[r['Статус']] || r['Статус'],
    left: r['Остаток'] === '' ? null : _rsNum_(r['Остаток']), reason: String(r['Причина'] || ''), comment: String(r['Комментарий'] || ''), by: String(r['Ответственный'] || ''), since: hm(r['С']),
    restoredBy: String(r['Восстановил'] || ''), restoredAt: hm(r['Восстановлено']), restoreReason: String(r['Причина восстановления'] || ''), current: r['Актуально'] === true || String(r['Актуально']) === 'true', version: parseInt(r.Version, 10) || 1 };
}
function _rsStopNeed_(dept) { return dept === 'BAR' ? 'stopgo_bar' : 'stopgo_kitchen'; }
/** Список: действующие ограничения, история (последние 100), блюда для выбора. {dept} */
function rsStopList(json, token) {
  return _rsRead_(token, 'stopgo_view|stopgo_kitchen|stopgo_bar|kitchen_queue|bar_queue|order_edit', function (s) {
    var d = _rsJ_(json, {}) || {}, dept = d.dept === 'BAR' ? 'BAR' : d.dept === 'KITCHEN' ? 'KITCHEN' : '', rows = _rsStopRows_().map(_rsStopObj_);
    var cur = rows.filter(function (r) { return r.current && r.status !== 'GO' && (!dept || r.dept === dept); });
    var dishes = _rsDishes_();
    return { dept: dept, current: cur, history: rows.filter(function (r) { return !dept || r.dept === dept; }).slice(-100).reverse(), reasons: MC_RS_STOP_REASONS_,
      dishes: Object.keys(dishes).map(function (k) { return { code: k, name: dishes[k].name, category: dishes[k].category, dept: dishes[k].dept }; }).filter(function (x) { return !dept || x.dept === dept; }),
      can: { kitchen: _mcRbHasExact_(s, 'stopgo_kitchen'), bar: _mcRbHasExact_(s, 'stopgo_bar'), approve: _mcRbHasExact_(s, 'stopgo_approve') } };
  });
}
/** Затронутые принятые задания: не готовы и не отменены. */
function _rsStopAffected_(code, dept) {
  return _rsRows_(MC_RS_SH_.QUEUE).filter(function (q) { return String(q.DishCode) === code && String(q['Подразделение']) === dept && ['NEW', 'WAIT_COURSE', 'ACCEPTED', 'COOKING', 'PROBLEM'].indexOf(String(q['Статус'])) >= 0; });
}
/**
 * Поставить STOP / LIMITED / REVIEW. {idem, code, dept, status, left, reason, comment, affected: KEEP | PROBLEM}
 * affected=PROBLEM — принятые, но не начатые задания этого блюда кухня выполнить не может: «проблема», официант согласует замену.
 */
function rsStopSet(json, token) {
  var d0 = _rsJ_(json, {}) || {}, dept0 = d0.dept === 'BAR' ? 'BAR' : 'KITCHEN';
  return _rsMutate_(token, _rsStopNeed_(dept0), 'RS_STOP_SET', json, function (c) {
    var d = c.d, dept = dept0, code = _rsS_(d.code), dish = _rsDishes_()[code], st = String(d.status || '').toUpperCase();
    if (!dish) return { fail: ['VALIDATION', 'Блюдо или напиток не найдены в каталоге'] };
    if (['STOP', 'LIMITED', 'REVIEW'].indexOf(st) < 0) return { fail: ['VALIDATION', 'Статус: STOP, ограничено или на проверке'] };
    var reason = _rsS_(d.reason); if (MC_RS_STOP_REASONS_.indexOf(reason) < 0) return { fail: ['VALIDATION', 'Причина: ' + MC_RS_STOP_REASONS_.join(', ')] };
    var left = '';
    if (st === 'LIMITED') { left = parseInt(d.left, 10); if (!(left >= 1 && left <= 999)) return { fail: ['VALIDATION', 'Остаток — целое от 1 до 999'] }; }
    var rows = _rsStopRows_(), cur = _rsStopCur_(rows, code, dept), plan = [], now = new Date(), who = _rsWho_(c.s);
    if (cur) { var o = _rsCopy_(cur); o['Актуально'] = false; _rsStamp_(o, c.s, c.op, false); plan.push({ sheet: MC_RS_SH_.STOPGO, row: o }); }
    var row = _rsStamp_({ StopID: _rsId_('STOP'), DishCode: code, 'Название': dish.name, 'Подразделение': dept, 'Статус': st, 'Остаток': left, 'Причина': reason, 'Комментарий': _rsS_(d.comment).slice(0, 300),
      'Ответственный': who, 'С': now, 'Актуально': true }, c.s, c.op, true);
    plan.push({ sheet: MC_RS_SH_.STOPGO, row: row });
    var aff = _rsStopAffected_(code, dept), marked = [];
    if (st !== 'LIMITED' && d.affected === 'PROBLEM') {
      var items = _rsRows_(MC_RS_SH_.ITEMS);
      aff.forEach(function (q) {
        if (q['Готовить начал'] || ['NEW', 'WAIT_COURSE', 'ACCEPTED'].indexOf(String(q['Статус'])) < 0) return;   // начатое кухня доводит или отменяет с расходом
        var t = _rsCopy_(q); t['Статус'] = 'PROBLEM'; t['Проблема'] = MC_RS_STOP_RU_[st] + ': ' + reason + ' — нужна замена'; _rsStamp_(t, c.s, c.op, false); plan.push({ sheet: MC_RS_SH_.QUEUE, row: t });
        var it = items.filter(function (x) { return String(x.OrderItemID) === String(q.OrderItemID); })[0];
        if (it && ['SERVED', 'CANCELLED'].indexOf(String(it['Статус'])) < 0) { var i2 = _rsCopy_(it); i2['Статус'] = 'PROBLEM'; _rsStamp_(i2, c.s, c.op, false); plan.push({ sheet: MC_RS_SH_.ITEMS, row: i2 }); }
        marked.push({ ticket: String(q.TicketID), table: String(q['Стол']), order: String(q.OrderID) });
      });
    }
    var after = { code: code, name: dish.name, dept: dept, status: st, left: left, reason: reason, affected: aff.length, needReplace: marked };
    plan.push({ sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'STOPGO', code, null, 'STOPGO_' + st, cur ? { status: String(cur['Статус']), left: cur['Остаток'] } : { status: 'GO' }, after) });
    try {
      _notify_('RS_STOP', 'warning', MC_RS_STOP_RU_[st] + ': ' + dish.name + (dept === 'BAR' ? ' (бар)' : ''), reason + (left ? ', осталось ' + left : '') + (marked.length ? '. Нужна замена: столы ' + marked.map(function (m) { return m.table; }).join(', ') : ''), 'Официант', 'RS_STOP_' + row.StopID, c.op);
      _notify_('RS_STOP', 'info', MC_RS_STOP_RU_[st] + ': ' + dish.name, reason + ' — ' + who, 'Директор', 'RS_STOPD_' + row.StopID, c.op);
    } catch (e) {}
    try { _rsPubCacheDrop_(); } catch (e) {}
    return { data: after, plan: plan, audit: { action: 'RS_STOPGO_' + st, entity: MC_RS_SH_.STOPGO, id: code + '|' + dept, after: after } };
  });
}
/** Вернуть GO. {idem, code, dept, reason, confirm:true} — «на проверке» снимает только stopgo_approve. */
function rsStopGo(json, token) {
  var d0 = _rsJ_(json, {}) || {}, dept0 = d0.dept === 'BAR' ? 'BAR' : 'KITCHEN';
  return _rsMutate_(token, _rsStopNeed_(dept0) + '|stopgo_approve', 'RS_STOP_GO', json, function (c) {
    var d = c.d, dept = dept0, code = _rsS_(d.code), rows = _rsStopRows_(), cur = _rsStopCur_(rows, code, dept);
    if (!cur || String(cur['Статус']) === 'GO') return { fail: ['VALIDATION', 'Ограничения нет — блюдо и так доступно'] };
    if (String(cur['Статус']) === 'REVIEW' && !_mcRbHasExact_(c.s, 'stopgo_approve')) return { fail: ['FORBIDDEN', '«На проверке» снимает ответственный (шеф-повар, су-шеф)'] };
    if (!_mcRbHasExact_(c.s, _rsStopNeed_(dept) + '|stopgo_approve')) return { fail: ['FORBIDDEN', 'Нет права на Stop/Go этого подразделения'] };
    if (d.confirm !== true) return { fail: ['VALIDATION', 'Подтвердите, что блюдо можно готовить: продукты есть, оборудование работает, качество проверено'] };
    var reason = _rsS_(d.reason).slice(0, 300); if (!reason) return { fail: ['VALIDATION', 'Укажите причину восстановления (например: «поставка принята»)'] };
    var now = new Date(), who = _rsWho_(c.s), o = _rsCopy_(cur);
    o['Актуально'] = false; o['Восстановил'] = who; o['Восстановлено'] = now; o['Причина восстановления'] = reason; _rsStamp_(o, c.s, c.op, false);
    var go = _rsStamp_({ StopID: _rsId_('STOP'), DishCode: code, 'Название': String(cur['Название']), 'Подразделение': dept, 'Статус': 'GO', 'Остаток': '', 'Причина': '', 'Комментарий': reason,
      'Ответственный': who, 'С': now, 'Восстановил': who, 'Восстановлено': now, 'Причина восстановления': reason, 'Актуально': true }, c.s, c.op, true);
    var after = { code: code, dept: dept, status: 'GO', reason: reason, by: who };
    try { _notify_('RS_GO', 'info', 'GO: ' + cur['Название'] + (dept === 'BAR' ? ' (бар)' : '') + ' — снова доступно', reason, 'Официант', 'RS_GO_' + go.StopID, c.op); } catch (e) {}
    try { _rsPubCacheDrop_(); } catch (e) {}
    return { data: after, plan: [{ sheet: MC_RS_SH_.STOPGO, row: o }, { sheet: MC_RS_SH_.STOPGO, row: go }, { sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'STOPGO', code, null, 'STOPGO_GO', { status: String(cur['Статус']) }, after) }],
      audit: { action: 'RS_STOPGO_GO', entity: MC_RS_SH_.STOPGO, id: code + '|' + dept, before: { status: String(cur['Статус']) }, after: after } };
  });
}
/** Для отправки заказа: уменьшить остаток LIMITED; закончился — STOP «лимит исчерпан». Строки плана (без записи). */
function _rsStopConsumePlan_(c, sent) {
  var need = {}; sent.forEach(function (x) { var k = x.code + '|' + x.dept; need[k] = (need[k] || 0) + x.qty; });
  var rows = _rsStopRows_(), plan = [], now = new Date();
  Object.keys(need).forEach(function (k) {
    var p = k.split('|'), cur = _rsStopCur_(rows, p[0], p[1]); if (!cur || String(cur['Статус']) !== 'LIMITED') return;
    var left = Math.max(0, _rsNum_(cur['Остаток']) - need[k]), o = _rsCopy_(cur);
    if (left > 0) { o['Остаток'] = left; _rsStamp_(o, c.s, c.op, false); plan.push({ sheet: MC_RS_SH_.STOPGO, row: o }); return; }
    o['Остаток'] = 0; o['Актуально'] = false; _rsStamp_(o, c.s, c.op, false); plan.push({ sheet: MC_RS_SH_.STOPGO, row: o });
    plan.push({ sheet: MC_RS_SH_.STOPGO, row: _rsStamp_({ StopID: _rsId_('STOP'), DishCode: p[0], 'Название': String(cur['Название']), 'Подразделение': p[1], 'Статус': 'STOP', 'Остаток': 0,
      'Причина': String(cur['Причина']), 'Комментарий': 'лимит исчерпан', 'Ответственный': 'MON CHEF — лимит', 'С': now, 'Актуально': true }, c.s, c.op, true) });
    try { _notify_('RS_STOP', 'warning', 'STOP: ' + cur['Название'] + ' — лимит исчерпан', 'Новые заказы блюда не принимаются', 'Официант', 'RS_LIM_' + cur.StopID, c.op); } catch (e) {}
  });
  return plan;
}

var MC_GATE_EXT_ = (typeof MC_GATE_EXT_ !== 'undefined' && MC_GATE_EXT_) || {};
MC_GATE_EXT_.rsStopList = { need: 'stopgo_view|stopgo_kitchen|stopgo_bar|kitchen_queue|bar_queue|order_edit' };
MC_GATE_EXT_.rsStopSet = { need: 'stopgo_kitchen|stopgo_bar', mut: true };
MC_GATE_EXT_.rsStopGo = { need: 'stopgo_kitchen|stopgo_bar|stopgo_approve', mut: true };
