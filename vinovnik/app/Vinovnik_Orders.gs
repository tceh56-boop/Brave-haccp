/**
 * VINOVNIK — блокнот официанта, курсы подачи, очереди кухни и бара, закрытие счёта.
 *
 * Строка заказа: позиция меню, количество, курс подачи, вес (выход порции; для позиций «по весу» — фактический вес),
 * номер гостя за столом и комментарий («без лука», «прожарка medium»). Курс 0 («сразу») и курсы до поданного
 * уходят на кухню или бар сразу; остальные ждут команды официанта «Подать курс N».
 * Статусы строки: ждёт курса → готовится → готово (повар или бармен) → подано (официант); отмена — с причиной,
 * после отправки — только с правом «Зал полностью».
 * Закрытие счёта: каждая позиция проводится обычной продажей MON CHEF (mcSaleAdd: журнал продаж J36,
 * списание склада по ТТК и партиям FEFO, прослеживаемость «партия → продажа», экономика V64). Скидка
 * распределяется по позициям пропорционально сумме. Стоп-лист: позицию в стопе добавить нельзя, лимит уменьшается.
 */

function _vnOrderObj_(o) {
  return { id: String(o['Заказ']), date: _vnDayOf_(o['Дата']), table: String(o['Стол']), guests: Number(o['Гостей']) || 0, waiter: String(o['Официант'] || ''),
    booking: String(o['Бронь'] || ''), opened: o['Открыт'] instanceof Date ? _vnHm_(o['Открыт']) : '', openedAt: o['Открыт'] instanceof Date ? o['Открыт'].getTime() : 0,
    status: String(o['Статус'] || 'OPEN'), fired: Number(o['Подан курс']) || 1, closed: o['Закрыт'] instanceof Date ? _vnHm_(o['Закрыт']) : '',
    sum: Number(o['Сумма, ₽']) || 0, discountPct: Number(o['Скидка, %']) || 0, discount: Number(o['Скидка, ₽']) || 0, total: Number(o['К оплате, ₽']) || 0,
    payment: String(o['Оплата'] || ''), check: String(o['Чек'] || ''), note: String(o['Комментарий'] || ''), cost: Number(o['Себестоимость, ₽']) || 0, _r: o._r };
}
function _vnLineObj_(l) {
  var st = String(l['Статус'] || 'HOLD'), t = function (x) { return x instanceof Date ? x.getTime() : 0; };
  return { id: String(l['Строка']), order: String(l['Заказ']), table: String(l['Стол']), seat: String(l['Гость'] || ''), code: String(l['Код']), name: String(l['Позиция']),
    station: String(l['Станция'] || 'Кухня'), qty: Number(l['Кол-во']) || 0, weight: Number(l['Вес']) || 0, weightUnit: String(l['Ед. веса'] || 'г'), course: Number(l['Курс']) || 0,
    comment: String(l['Комментарий'] || ''), price: Number(l['Цена, ₽']) || 0, sum: Number(l['Сумма, ₽']) || 0, status: st, statusRu: MC_VN_LINE_ST_[st] || st,
    waiter: String(l['Официант'] || ''), createdAt: t(l['Создано']), sentAt: t(l['Отправлено']), readyAt: t(l['Готово']), servedAt: t(l['Подано']),
    cook: String(l['Кто готовил'] || ''), voidReason: String(l['Отмена: причина'] || ''), sale: String(l['Продажа'] || ''), _r: l._r };
}
function _vnOrders_(f) { return _vnRows_('ORD').map(_vnOrderObj_).filter(f || function () { return true; }); }
function _vnLinesOf_(ids) { var set = {}; (ids || []).forEach(function (i) { set[i] = true; }); return _vnRows_('LINES').map(_vnLineObj_).filter(function (l) { return !ids || set[l.order]; }); }
function _vnCourseRu_(c) { for (var i = 0; i < MC_VN_COURSES_.length; i++) if (MC_VN_COURSES_[i][0] === c) return MC_VN_COURSES_[i][1]; return 'Курс ' + c; }
function _vnOrderFull_(o, lines) {
  var L = (lines || _vnLinesOf_([o.id])).filter(function (l) { return l.order === o.id; });
  var live = L.filter(function (l) { return l.status !== 'VOID'; });
  o.lines = L.map(function (l) { var x = {}; Object.keys(l).forEach(function (k) { if (k !== '_r') x[k] = l[k]; }); x.courseRu = _vnCourseRu_(l.course); return x; });
  o.counts = { hold: 0, sent: 0, ready: 0, served: 0, void: 0 };
  L.forEach(function (l) { o.counts[{ HOLD: 'hold', SENT: 'sent', READY: 'ready', SERVED: 'served', VOID: 'void' }[l.status] || 'hold']++; });
  o.sumNow = _vnR2_(live.reduce(function (a, l) { return a + l.sum; }, 0));
  var held = live.filter(function (l) { return l.status === 'HOLD'; }).map(function (l) { return l.course; });
  o.nextCourse = held.length ? Math.min.apply(null, held) : null;
  delete o._r;
  return o;
}
/** Открытый заказ стола или новый. Стол — из плана зала; официант — вошедший (менеджер может назначить другого). */
function _vnOpenOrder_(op, d) {
  var table = _vnS_(d.table, 12); if (!table) _vnFail_('Выберите стол');
  if (!_vnTables_().some(function (t) { return t.table === table; })) _vnFail_('Стола ' + table + ' нет в плане зала');
  var ex = _vnOrders_(function (o) { return o.status === 'OPEN' && o.table === table; })[0];
  if (ex) return { id: ex.id, table: table, existed: true, waiter: ex.waiter };
  var waiter = _vnWho_(op);
  if (d.waiter && d.waiter !== waiter) {
    if (!_vnHas_(op, 'hall_manage')) _vnFail_('Назначить заказ другому официанту может администратор зала');
    var e = null; try { e = JSON.parse(getEmployees()).filter(function (x) { return x.name === d.waiter && x.active !== false; })[0]; } catch (er) {}
    if (!e) _vnFail_('Официант — из списка сотрудников');
    waiter = e.name;
  }
  var guests = parseInt(d.guests, 10); if (!(guests >= 1)) guests = 1;
  var id = _vnId_('ЗК');
  _vnAppend_('ORD', { 'Заказ': id, 'Дата': _vnToday_(), 'Стол': table, 'Гостей': guests, 'Официант': waiter, 'Бронь': _vnS_(d.booking, 40), 'Открыт': new Date(), 'Статус': 'OPEN', 'Подан курс': 1,
    'Комментарий': _vnS_(d.note, 200) });
  _audit_(op, 'VN_ORDER_OPEN', 'Заказ', id, null, { стол: table, гостей: guests, официант: waiter, бронь: d.booking || '' });
  return { id: id, table: table, existed: false, waiter: waiter };
}
function _vnOwnOrder_(op, o) {
  if (!o) throw new Error('NOT_FOUND: заказ не найден');
  if (o.waiter !== _vnWho_(op) && !_vnHas_(op, 'hall_manage')) throw new Error('FORBIDDEN: это заказ официанта ' + o.waiter + ' — изменить его может он или администратор зала');
  return o;
}
function _vnOrderById_(id) { return _vnOrders_(function (o) { return o.id === String(id || ''); })[0] || null; }

/** Открыть стол: {table, guests, booking?, waiter?, note?}. Повторное открытие занятого стола возвращает его заказ. */
function vnOrderOpen(json, token) {
  return _vnRun_(token, 'hall|hall_manage', 'VN_ORDER_OPEN', true, function (op) {
    var d = _vnJ_(json);
    return _withLock_(function () { var r = _vnOpenOrder_(op, d); return _vnOrderFull_(_vnOrderById_(r.id)); });
  });
}

/** Добавить позиции: {order | table+guests, lines:[{code, qty, weight?, course?, seat?, comment?}]}. Ответ — заказ целиком. */
function vnOrderAdd(json, token) {
  return _vnRun_(token, 'hall|hall_manage', 'VN_ORDER_ADD', true, function (op) {
    var d = _vnJ_(json), L = (Array.isArray(d.lines) ? d.lines : []).filter(function (x) { return x && x.code; });
    if (!L.length) _vnFail_('Добавьте хотя бы одну позицию');
    if (L.length > 60) _vnFail_('Не больше 60 строк за раз');
    return _withLock_(function () {
      var o = d.order ? _vnOrderById_(d.order) : null;
      if (!o) { var r = _vnOpenOrder_(op, d); o = _vnOrderById_(r.id); }
      _vnOwnOrder_(op, o);
      if (o.status !== 'OPEN') _vnFail_('Заказ ' + o.id + ' уже закрыт');
      var M = {}; _vnMenu_().forEach(function (m) { M[m.code] = m; });
      var SG = _vnStopMap_(), now = new Date(), who = _vnWho_(op), out = [], limits = [], need = {};
      // сначала проверка всех строк (всё или ничего), потом запись
      var plan = L.map(function (x) {
        var m = M[String(x.code)]; if (!m) _vnFail_('Позиции ' + x.code + ' нет в меню');
        var qty = _vnN_(x.qty); if (!(qty > 0 && qty <= 99)) _vnFail_('«' + m.name + '»: количество от 1');
        if (!m.byWeight && Math.abs(qty * 2 - Math.round(qty * 2)) > 1e-9) _vnFail_('«' + m.name + '»: количество — целое или половина');
        var course = x.course === '' || x.course === undefined || x.course === null ? (m.station === 'Бар' ? 0 : 1) : parseInt(x.course, 10);
        if (!(course >= 0 && course <= 5)) _vnFail_('Курс подачи — от 0 («сразу») до 5');
        var weight = _vnN_(x.weight); if (!(weight > 0)) weight = m.yield || 0;
        if (m.byWeight && !(weight > 0)) _vnFail_('«' + m.name + '» продаётся по весу — укажите вес');
        if (weight > 20000) _vnFail_('«' + m.name + '»: вес не больше 20 кг');
        var price = m.byWeight ? _vnR2_(m.price * weight / (m.per || 100)) : m.price;
        var sg = SG[m.code];
        if (sg && sg.status === 'STOP') _vnFail_('«' + m.name + '» в стопе: ' + sg.reason);
        need[m.code] = (need[m.code] || 0) + qty;
        if (sg && sg.status === 'LIMIT' && sg.left !== null && need[m.code] > sg.left) _vnFail_('«' + m.name + '»: осталось ' + sg.left + ' порц. (лимит)');
        return { m: m, qty: qty, course: course, weight: weight, price: price, seat: _vnS_(x.seat, 6), comment: _vnS_(x.comment, 200) };
      });
      plan.forEach(function (p) {
        var st = p.course === 0 || p.course <= o.fired ? 'SENT' : 'HOLD', id = _vnId_('СТР');
        _vnAppend_('LINES', { 'Строка': id, 'Заказ': o.id, 'Стол': o.table, 'Гость': p.seat, 'Код': p.m.code, 'Позиция': p.m.name, 'Станция': p.m.station, 'Кол-во': p.qty,
          'Вес': p.weight || '', 'Ед. веса': p.m.yieldUnit || 'г', 'Курс': p.course, 'Комментарий': p.comment, 'Цена, ₽': p.price, 'Сумма, ₽': _vnR2_(p.price * p.qty),
          'Статус': st, 'Создано': now, 'Официант': who, 'Отправлено': st === 'SENT' ? now : '' });
        var lim = _vnStopTake_(op, p.m.code, p.qty); if (lim) limits.push({ code: p.m.code, name: p.m.name, left: lim.left, stopped: !!lim.stopped });
        out.push({ id: id, name: p.m.name, status: st });
      });
      _audit_(op, 'VN_ORDER_ADD', 'Заказ', o.id, null, { стол: o.table, позиции: plan.map(function (p) { return p.m.name + ' × ' + p.qty + (p.weight ? ' (' + p.weight + ' ' + (p.m.yieldUnit || 'г') + ')' : '') + ', курс ' + p.course + (p.comment ? ', «' + p.comment + '»' : ''); }) });
      var full = _vnOrderFull_(_vnOrderById_(o.id));
      full.added = out; full.limits = limits;
      full.sent = out.filter(function (x) { return x.status === 'SENT'; }).length; full.held = out.length - full.sent;
      return full;
    });
  });
}

/** «Подать курс N»: позиции, ждущие курса до N включительно, уходят на кухню и бар. {order, course}. */
function vnOrderFire(json, token) {
  return _vnRun_(token, 'hall|hall_manage', 'VN_ORDER_FIRE', true, function (op) {
    var d = _vnJ_(json), c = parseInt(d.course, 10); if (!(c >= 1 && c <= 5)) _vnFail_('Курс — от 1 до 5');
    return _withLock_(function () {
      var o = _vnOwnOrder_(op, _vnOrderById_(d.order)); if (o.status !== 'OPEN') _vnFail_('Заказ закрыт');
      var now = new Date(), n = 0;
      _vnLinesOf_([o.id]).forEach(function (l) { if (l.status === 'HOLD' && l.course <= c) { _vnSet_('LINES', l._r, { 'Статус': 'SENT', 'Отправлено': now }); n++; } });
      if (c > o.fired) _vnSet_('ORD', o._r, { 'Подан курс': c });
      if (!n) _vnFail_('Позиций курса ' + c + ' нет — всё уже отправлено');
      _audit_(op, 'VN_ORDER_FIRE', 'Заказ', o.id, null, { стол: o.table, курс: c, позиций: n });
      var full = _vnOrderFull_(_vnOrderById_(o.id)); full.fired = n; return full;
    });
  });
}

/** Статус строк: {ids:[], status: READY|SERVED|VOID|SENT, reason?}. Готово — кухня (по своим) и бар (по своим). */
function vnLineStatus(json, token) {
  return _vnRun_(token, 'hall|hall_manage|bar|kanban|prod_manage', 'VN_LINE_STATUS', true, function (op) {
    var d = _vnJ_(json), st = String(d.status || ''), ids = (d.ids || [d.id]).map(String).filter(Boolean);
    if (['READY', 'SERVED', 'VOID', 'SENT'].indexOf(st) < 0) _vnFail_('Неизвестный статус позиции');
    if (!ids.length) _vnFail_('Не выбраны позиции');
    var reason = _vnS_(d.reason, 160);
    return _withLock_(function () {
      var set = {}; ids.forEach(function (i) { set[i] = true; });
      var L = _vnRows_('LINES').map(_vnLineObj_).filter(function (l) { return set[l.id]; });
      if (L.length !== ids.length) throw new Error('NOT_FOUND: часть позиций не найдена — обновите экран');
      var O = {}, now = new Date(), who = _vnWho_(op), done = [];
      L.forEach(function (l) {
        var o = O[l.order] = O[l.order] || _vnOrderById_(l.order);
        if (!o || o.status !== 'OPEN') _vnFail_('Заказ стола ' + l.table + ' уже закрыт');
        if (st === 'READY') {
          var perm = l.station === 'Бар' ? 'bar|hall_manage' : 'kanban|prod_manage|hall_manage';
          if (!_vnHas_(op, perm)) throw new Error('FORBIDDEN: отметить «готово» по ' + (l.station === 'Бар' ? 'бару' : 'кухне') + ' может ' + (l.station === 'Бар' ? 'бармен' : 'повар'));
          if (l.status !== 'SENT') _vnFail_('«' + l.name + '» — ' + l.statusRu + ': готовым отмечается то, что готовится');
          _vnSet_('LINES', l._r, { 'Статус': 'READY', 'Готово': now, 'Кто готовил': who });
        } else if (st === 'SERVED') {
          if (!_vnHas_(op, 'hall|hall_manage')) throw new Error('FORBIDDEN: «подано» отмечает официант');
          if (l.status !== 'READY' && l.status !== 'SENT') _vnFail_('«' + l.name + '» — ' + l.statusRu);
          _vnSet_('LINES', l._r, { 'Статус': 'SERVED', 'Подано': now, 'Готово': l.readyAt ? new Date(l.readyAt) : now });
        } else if (st === 'SENT') {   // «вернуть в работу»: отметили готовым по ошибке
          if (l.status !== 'READY') _vnFail_('Вернуть в работу можно готовую позицию');
          var perm2 = l.station === 'Бар' ? 'bar|hall_manage' : 'kanban|prod_manage|hall_manage';
          if (!_vnHas_(op, perm2)) throw new Error('FORBIDDEN: вернуть в работу может ' + (l.station === 'Бар' ? 'бармен' : 'повар'));
          _vnSet_('LINES', l._r, { 'Статус': 'SENT', 'Готово': '', 'Кто готовил': '' });
        } else {
          if (l.status === 'VOID') _vnFail_('«' + l.name + '» уже отменена');
          if (!reason) _vnFail_('Причина отмены «' + l.name + '» — обязательно');
          if (l.status !== 'HOLD' && !_vnHas_(op, 'hall_manage')) throw new Error('FORBIDDEN: «' + l.name + '» уже ' + l.statusRu + ' — отменить может администратор зала (продукты уже в работе)');
          if (l.status === 'HOLD') _vnOwnOrder_(op, o);
          _vnSet_('LINES', l._r, { 'Статус': 'VOID', 'Отмена: причина': reason + ' (' + who + (l.status !== 'HOLD' ? ', после отправки: ' + l.statusRu : '') + ')' });
        }
        done.push(l.name);
      });
      _audit_(op, 'VN_LINE_' + st, 'Заказ', Object.keys(O).join(','), null, { позиции: done, причина: reason });
      return { status: st, count: done.length, orders: Object.keys(O).map(function (k) { return _vnOrderFull_(_vnOrderById_(k)); }) };
    });
  });
}

/** Заказы: {order?} — один; иначе открытые (официанту — свои, администратору — все) и закрытые сегодня. */
function vnOrderData(json, token) {
  return _vnRun_(token, 'hall|hall_manage', 'VN_ORDER_VIEW', false, function (op) {
    var d = _vnJ_(json), me = _vnWho_(op), all = _vnHas_(op, 'hall_manage') || d.all === true && _vnHas_(op, 'hall_manage');
    if (d.order) { var o = _vnOrderById_(d.order); if (!o) throw new Error('NOT_FOUND: заказ не найден'); return { order: _vnOrderFull_(o), me: me, canManage: _vnHas_(op, 'hall_manage') }; }
    var today = _vnToday_(), O = _vnOrders_(function (o) { return (o.status === 'OPEN' || o.date === today) && (all || o.waiter === me); });
    var L = _vnLinesOf_(O.map(function (o) { return o.id; }));
    return { orders: O.map(function (o) { return _vnOrderFull_(o, L); }), me: me, canManage: _vnHas_(op, 'hall_manage'), pay: MC_VN_PAY_, courses: MC_VN_COURSES_ };
  });
}

/** Очередь кухни или бара: {station: 'Кухня'|'Бар'}. Готовится — по времени отправки; готовое — последние 30 минут (ждёт официанта). */
function vnQueueData(json, token) {
  return _vnRun_(token, 'kanban|prod_manage|bar|hall_manage', 'VN_QUEUE_VIEW', false, function (op) {
    var d = _vnJ_(json), station = d.station === 'Бар' ? 'Бар' : 'Кухня';
    if (station === 'Бар' && !_vnHas_(op, 'bar|hall_manage')) throw new Error('FORBIDDEN: очередь бара — бармену');
    if (station === 'Кухня' && !_vnHas_(op, 'kanban|prod_manage|hall_manage')) throw new Error('FORBIDDEN: очередь кухни — поварам');
    return _vnQueue_(station);
  });
}
function _vnQueue_(station) {
  var O = {}; _vnOrders_(function (o) { return o.status === 'OPEN'; }).forEach(function (o) { O[o.id] = o; });
  var now = Date.now(), S = _vnSettings_(), norm = S.serviceTime * 60000, T = {};
  _vnLinesOf_(Object.keys(O)).forEach(function (l) {
    if (l.station !== station) return;
    if (!(l.status === 'SENT' || (l.status === 'READY' && now - l.readyAt < 30 * 60000) || l.status === 'HOLD')) return;
    var k = l.order + '|' + l.course, t = T[k] = T[k] || { key: k, order: l.order, table: l.table, waiter: O[l.order].waiter, guests: O[l.order].guests, course: l.course, courseRu: _vnCourseRu_(l.course), lines: [], sentAt: 0, held: false };
    t.lines.push({ id: l.id, name: l.name, qty: l.qty, weight: l.weight, weightUnit: l.weightUnit, seat: l.seat, comment: l.comment, status: l.status, statusRu: l.statusRu,
      mins: l.sentAt ? Math.floor((now - l.sentAt) / 60000) : 0, cook: l.cook });
    if (l.status === 'SENT' && (!t.sentAt || l.sentAt < t.sentAt)) t.sentAt = l.sentAt;
    if (l.status === 'HOLD') t.held = true;
  });
  var tickets = Object.keys(T).map(function (k) {
    var t = T[k], cooking = t.lines.filter(function (l) { return l.status === 'SENT'; }).length, ready = t.lines.filter(function (l) { return l.status === 'READY'; }).length;
    t.state = cooking ? 'cooking' : ready ? 'ready' : 'held'; t.mins = t.sentAt ? Math.floor((now - t.sentAt) / 60000) : 0; t.late = !!(cooking && t.sentAt && now - t.sentAt > norm);
    return t;
  }).sort(function (a, b) { var r = { cooking: 0, ready: 1, held: 2 }; return (r[a.state] - r[b.state]) || (a.sentAt - b.sentAt) || (a.course - b.course); });
  var stop = _vnStopMap_(), items = Object.keys(stop).map(function (k) { return stop[k]; }).filter(function (s) { return s.station === station || !s.station; })
    .map(function (s) { return { code: s.code, name: s.name, status: s.status, statusRu: MC_VN_STOP_ST_[s.status], left: s.left, reason: s.reason }; });
  return { station: station, norm: S.serviceTime, tickets: tickets, stop: items,
    counts: { cooking: tickets.filter(function (t) { return t.state === 'cooking'; }).length, late: tickets.filter(function (t) { return t.late; }).length, ready: tickets.filter(function (t) { return t.state === 'ready'; }).length, held: tickets.filter(function (t) { return t.state === 'held'; }).length } };
}

/* --------------------------------------------------------------- закрытие счёта → продажи MON CHEF ---- */

// Продажа MON CHEF (mcSaleAdd) требует права журнала продаж; на время закрытия счёта официант с правом «Зал»
// проводит продажи своего стола — только внутри vnOrderClose (флаг _VN_SALE_), больше нигде.
var _VN_SALE_ = false;
(function () {
  if (typeof _mcRbHas_ !== 'function') return;
  var orig = _mcRbHas_;
  _mcRbHas_ = function (s, spec) {
    if (_VN_SALE_ && spec === 'banquets|journals' && s && !s.dev && _mcRbHasExact_(s, 'hall|hall_manage')) return true;
    return orig.apply(this, arguments);
  };
})();

/** Закрыть счёт: {order, payment, discountPct?, check?, force?}. force — закрыть, хотя часть позиций не подана. */
function vnOrderClose(json, token) {
  var op = null;
  try { op = _vnOp_(token, 'hall|hall_manage', 'VN_ORDER_CLOSE', null, true); } catch (e) { return _failFrom_(e); }
  try {
    var d = _vnJ_(json), pay = String(d.payment || ''), pct = _vnN_(d.discountPct || 0);
    if (!MC_VN_PAY_.some(function (p) { return p[0] === pay; })) throw new Error('VALIDATION: выберите способ оплаты');
    if (!(pct >= 0 && pct <= 100)) throw new Error('VALIDATION: скидка — от 0 до 100 %');
    if (pct > 0 && !_vnHas_(op, 'hall_manage')) throw new Error('FORBIDDEN: скидку даёт администратор зала');
    var res = _withLock_(function () {
      var o = _vnOwnOrder_(op, _vnOrderById_(d.order));
      if (o.status !== 'OPEN') throw new Error('VALIDATION: заказ ' + o.id + ' уже закрыт');
      var L = _vnLinesOf_([o.id]), live = L.filter(function (l) { return l.status !== 'VOID'; });
      if (!live.length) throw new Error('VALIDATION: в заказе нет позиций — отмените заказ, а не закрывайте');
      var open = live.filter(function (l) { return l.status !== 'SERVED'; });
      if (open.length && !d.force) return { needForce: true, notServed: open.map(function (l) { return l.name + ' — ' + l.statusRu; }) };
      var M = {}; _vnMenu_().forEach(function (m) { M[m.code] = m; });
      var sum = _vnR2_(live.reduce(function (a, l) { return a + l.sum; }, 0)), disc = _vnR2_(sum * pct / 100), left = disc, sales = [], errors = [], cost = 0, now = new Date();
      var who = _vnWho_(op);
      live.forEach(function (l, i) {
        var m = M[l.code] || { kind: 'DISH', yield: l.weight, yieldUnit: l.weightUnit, byWeight: false };
        var ld = i === live.length - 1 ? left : _vnR2_(disc * (sum ? l.sum / sum : 0)); left = _vnR2_(left - ld);
        var lsum = _vnR2_(l.sum - ld), qty, unit = '', kind = m.kind === 'GOODS' ? 'goods' : 'dish';
        if (kind === 'goods') { unit = m.yieldUnit || 'шт'; qty = unit === 'шт' ? l.qty : _vnR2_(l.qty * (l.weight || m.yield || 1)); }
        else qty = m.byWeight && m.yield > 0 ? Math.round(l.qty * l.weight / m.yield * 1000) / 1000 : l.qty;
        var r = null;
        _VN_SALE_ = true;
        try { r = JSON.parse(mcSaleAdd(JSON.stringify({ dish: l.name, kind: kind, unit: unit, qty: qty, price: qty ? Math.round(lsum / qty * 10000) / 10000 : 0, sum: lsum,
          seller: o.waiter, check: o.id + (d.check ? ' / ' + _vnS_(d.check, 30) : '') }), token)); }
        catch (e) { r = { success: false, error: { message: String(e.message || e) } }; }
        finally { _VN_SALE_ = false; }
        if (r && r.success) {
          var sd = r.data || {}; cost += Number(sd.stock && sd.stock.cost) || 0;
          _vnSet_('LINES', l._r, { 'Продажа': sd.saleId || 'J36' });
          sales.push({ line: l.id, name: l.name, qty: qty, sum: lsum, saleId: sd.saleId || '', stock: sd.stock ? sd.stock.statusRu : '', short: sd.stock ? (sd.stock.short || []).map(function (s) { return s.text; }) : [] });
        } else errors.push(l.name + ': ' + (r && r.error && r.error.message || 'продажа не записана'));
      });
      var total = _vnR2_(sum - disc);
      _vnSet_('ORD', o._r, { 'Статус': errors.length && !sales.length ? 'OPEN' : 'CLOSED', 'Закрыт': errors.length && !sales.length ? '' : now, 'Сумма, ₽': sum, 'Скидка, %': pct, 'Скидка, ₽': disc, 'К оплате, ₽': total,
        'Оплата': pay, 'Чек': _vnS_(d.check, 30), 'Продажи (JSON)': JSON.stringify(sales).slice(0, 45000), 'Закрыл': who, 'Себестоимость, ₽': _vnR2_(cost) });
      if (o.booking && sales.length) { var b = _vnBookings_().filter(function (x) { return x.id === o.booking; })[0]; if (b && b.status === 'SEATED') _vnSet_('BOOK', b._r, { 'Статус': 'DONE', 'Изменено': now, 'Изменил': who }); }
      _audit_(op, 'VN_ORDER_CLOSE', 'Заказ', o.id, null, { стол: o.table, сумма: sum, скидка: disc, оплата: pay, продаж: sales.length, ошибок: errors, не_подано: open.length });
      return { id: o.id, table: o.table, sum: sum, discount: disc, total: total, payment: pay, cost: _vnR2_(cost), sales: sales, errors: errors, notServed: open.length };
    });
    _endOp_(op, res.errors && res.errors.length && !(res.sales || []).length ? 'FAILED' : 'COMPLETED');
    return _ok_(res, op.id);
  } catch (e) { _VN_SALE_ = false; if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Отменить заказ целиком (гости ушли до заказа, ошибка стола): {order, reason}. Проведённых продаж не бывает — заказ открыт. */
function vnOrderCancel(json, token) {
  return _vnRun_(token, 'hall_manage', 'VN_ORDER_CANCEL', true, function (op) {
    var d = _vnJ_(json), reason = _vnS_(d.reason, 160); if (!reason) _vnFail_('Причина отмены заказа — обязательно');
    return _withLock_(function () {
      var o = _vnOrderById_(d.order); if (!o) throw new Error('NOT_FOUND: заказ не найден'); if (o.status !== 'OPEN') _vnFail_('Заказ уже ' + (o.status === 'CLOSED' ? 'закрыт' : 'отменён'));
      var n = 0; _vnLinesOf_([o.id]).forEach(function (l) { if (l.status !== 'VOID') { _vnSet_('LINES', l._r, { 'Статус': 'VOID', 'Отмена: причина': 'заказ отменён: ' + reason }); n++; } });
      _vnSet_('ORD', o._r, { 'Статус': 'CANCELLED', 'Закрыт': new Date(), 'Комментарий': (o.note ? o.note + ' · ' : '') + 'отменён: ' + reason, 'Закрыл': _vnWho_(op) });
      _audit_(op, 'VN_ORDER_CANCEL', 'Заказ', o.id, null, { стол: o.table, позиций: n, причина: reason });
      return { id: o.id, voided: n };
    });
  });
}
