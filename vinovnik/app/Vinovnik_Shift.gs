/**
 * VINOVNIK — «Моя смена» по зонам (зал, кухня, бар), раздел «Зал» главного окна и плитки главной.
 *
 * Каждая зона — свой экран со своим доступом:
 *   • Зал (право «Зал»): мои столы и заказы, что готово к подаче, какой курс подать следующим, брони на ближайшие
 *     часы, стоп/go-лист;
 *   • Кухня (повара, право «Производство»): очередь кухни по столам и курсам, с комментариями, весом и временем;
 *   • Бар (право «Бар»): очередь бара и стоп-лист бара.
 * В каждой зоне — сводка общей «Моей смены» MON CHEF (журналы, здоровье, бракераж…) со ссылкой на неё.
 */

var MC_VN_ZONES_ = [['hall', 'Зал', 'hall|hall_manage|booking'], ['kitchen', 'Кухня', 'kanban|prod_manage'], ['bar', 'Бар', 'bar|hall_manage']];
function _vnZones_(s) { return MC_VN_ZONES_.filter(function (z) { return s && !s.dev && _mcRbHasExact_(s, z[2]); }).map(function (z) { return { id: z[0], label: z[1] }; }); }
function _vnShiftCommon_(s, token) {
  try { if (typeof _v87CountCached_ === 'function' && typeof _v87ModOk_ === 'function' && _v87ModOk_(s, 'myshift')) { var n = _v87CountCached_({ s: s, token: token, me: _author_(token).фио }); return { open: n.open || 0, overdue: n.overdue || 0 }; } } catch (e) {}
  return null;
}
function _vnStopList_() {
  var m = _vnStopMap_(); return Object.keys(m).map(function (k) { var x = m[k]; return { code: x.code, name: x.name, station: x.station, status: x.status, statusRu: MC_VN_STOP_ST_[x.status], left: x.left, reason: x.reason, until: x.until, by: x.by }; })
    .sort(function (a, b) { var r = { STOP: 0, LIMIT: 1, GO: 2 }; return (r[a.status] - r[b.status]) || a.name.localeCompare(b.name); });
}

/** «Моя смена» зоны: {zone: hall|kitchen|bar}. Без зоны — первая доступная. */
function vnShiftData(json, token) {
  var op = null;
  try { op = _beginOp_(token, null, 'VN_SHIFT_VIEW', 'Зал', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _vnJ_(json), s = op.session, Z = _vnZones_(s);
    if (s.dev) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', 'Технический вход своей смены не имеет — войдите по ПИН сотрудника', op.id); }
    if (!Z.length) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', 'У вашей роли нет смены в зале, на кухне или в баре', op.id); }
    var zone = Z.filter(function (z) { return z.id === d.zone; })[0] || Z[0], me = _vnWho_(op), out = { zone: zone.id, zoneRu: zone.label, zones: Z, me: me, position: s.role || '',
      now: _vnHm_(_mcNow_()), day: Utilities.formatDate(_mcNow_(), _mcTz_(), 'dd.MM.yyyy'), common: _vnShiftCommon_(s, token), settings: _vnSettings_() };
    if (zone.id === 'hall') {
      var all = _mcRbHasExact_(s, 'hall_manage'), today = _vnToday_(), canOrders = _mcRbHasExact_(s, 'hall|hall_manage');
      var O = canOrders ? _vnOrders_(function (o) { return o.status === 'OPEN' && (all || o.waiter === me); }) : [];
      var L = _vnLinesOf_(O.map(function (o) { return o.id; }));
      out.orders = O.map(function (o) { return _vnOrderFull_(o, L); });
      out.toServe = []; out.orders.forEach(function (o) { o.lines.forEach(function (l) { if (l.status === 'READY') out.toServe.push({ id: l.id, order: o.id, table: o.table, name: l.name, qty: l.qty, seat: l.seat, comment: l.comment, waitMin: l.readyAt ? Math.floor((Date.now() - l.readyAt) / 60000) : 0 }); }); });
      var nowMin = _vnMin_(out.now);
      out.bookings = _vnBookings_(today).filter(function (b) { return _vnActiveBook_(b) && (b.status === 'SEATED' || _vnMin_(b.from) >= nowMin - 30); }).slice(0, 30).map(function (b) { delete b._r; return b; });
      out.requests = _vnBookings_().filter(function (b) { return b.status === 'REQUEST' && b.date >= today; }).length;
      out.tables = _vnFloor_(today, out.now);
      out.stop = _vnStopList_();
      out.can = { manage: all, booking: _mcRbHasExact_(s, 'booking|hall_manage'), orders: canOrders, stop: _mcRbHasExact_(s, 'stoplist|hall_manage') };
      out.summary = { orders: out.orders.length, toServe: out.toServe.length, held: out.orders.filter(function (o) { return o.nextCourse !== null; }).length, bookings: out.bookings.length, stop: out.stop.filter(function (x) { return x.status === 'STOP'; }).length, go: out.stop.filter(function (x) { return x.status === 'GO'; }).length };
    } else {
      var q = _vnQueue_(zone.id === 'bar' ? 'Бар' : 'Кухня');
      out.queue = q; out.stop = q.stop; out.can = { stop: _mcRbHasExact_(s, 'stoplist|hall_manage') };
      out.summary = q.counts;
    }
    _endOp_(op);
    return _ok_(out, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** План зала на время: стол → свободен / бронь скоро (в ближайшие 2 часа) / гости (открыт заказ). */
function _vnFloor_(day, hm) {
  var T = _vnTables_(), B = _vnBookings_(day).filter(function (b) { return b.status === 'CONFIRMED' || b.status === 'SEATED'; }), now = _vnMin_(hm || _vnHm_(_mcNow_()));
  var open = {}; _vnOrders_(function (o) { return o.status === 'OPEN'; }).forEach(function (o) { open[o.table] = o; });
  return T.map(function (t) {
    var o = open[t.table], mine = B.filter(function (b) { return b.tables.indexOf(t.table) >= 0; });
    var next = mine.filter(function (b) { return b.status === 'CONFIRMED' && _vnMin_(b.to) > now; }).sort(function (a, b) { return a.from.localeCompare(b.from); })[0] || null;
    var state = o ? 'busy' : next && _vnMin_(next.from) - now <= 120 ? 'soon' : 'free';
    return { table: t.table, zone: t.zone, seats: t.seats, state: state, stateRu: { busy: 'гости', soon: 'бронь скоро', free: 'свободен' }[state],
      order: o ? { id: o.id, waiter: o.waiter, guests: o.guests, opened: o.opened } : null,
      next: next ? { id: next.id, from: next.from, to: next.to, guest: next.guest, guests: next.guests } : null,
      bookings: mine.map(function (b) { return { id: b.id, from: b.from, to: b.to, guest: b.guest, guests: b.guests, status: b.status }; }) };
  });
}

/** Данные зала: {date?, what?: ['floor','bookings','orders','stop']}. Состав — по правам. */
function vnHallData(json, token) {
  return _vnRun_(token, 'hall|hall_manage|booking|bar|stoplist|guestmenu|kanban|prod_manage', 'VN_HALL_VIEW', false, function (op) {
    var d = _vnJ_(json), day = _vnDayOf_(d.date) || _vnToday_(), s = op.session, out = { date: day, today: _vnToday_(), settings: _vnSettings_(), me: _vnWho_(op) };
    var can = { booking: _vnHas_(op, 'booking|hall_manage'), manage: _vnHas_(op, 'hall_manage'), orders: _vnHas_(op, 'hall|hall_manage'), stop: _vnHas_(op, 'stoplist|hall_manage'), menu: _vnHas_(op, 'guestmenu') };
    out.can = can;
    out.tables = _vnFloor_(day, day === _vnToday_() ? _vnHm_(_mcNow_()) : (d.time && _vnTime_(d.time)) || '12:00');
    if (_vnHas_(op, 'booking|hall_manage|hall')) {
      out.bookings = _vnBookings_(day).map(function (b) { delete b._r; return b; });
      out.requests = _vnBookings_().filter(function (b) { return b.status === 'REQUEST' && b.date >= _vnToday_(); }).map(function (b) { delete b._r; return b; });
      if (d.from && can.booking) out.free = _vnFreeTables_(day, _vnTime_(d.from), _vnTime_(d.to) || _vnAddMin_(_vnTime_(d.from), out.settings.bookDur), parseInt(d.guests, 10) || 1, d.except);
    }
    out.stop = _vnStopList_();
    out.statuses = MC_VN_BOOK_ST_;
    return out;
  });
}

/** QR-коды меню: адрес страницы гостя и столы. */
function vnQrData(token) {
  return _vnRun_(token, 'guestmenu|hall_manage', 'VN_QR', false, function () {
    var url = ''; try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { url = ''; }
    return { url: url, menuUrl: url ? url + '?menu=1' : '', tables: _vnTables_(), settings: _vnSettings_() };
  });
}

/* --------------------------------------------------------------- раздел «Зал» главного окна ---- */
(function () {
  if (typeof _UI_BUILDERS_ !== 'object') return;
  _UI_BUILDERS_.hall = function (token, opts, s) {
    var today = _vnToday_(), B = _vnBookings_(today), act = B.filter(_vnActiveBook_), O = _vnOrders_(function (o) { return o.date === today || o.status === 'OPEN'; });
    var closed = O.filter(function (o) { return o.status === 'CLOSED' && o.date === today; }), openO = O.filter(function (o) { return o.status === 'OPEN'; });
    var rev = _vnR2_(closed.reduce(function (a, o) { return a + o.total; }, 0)), guests = closed.reduce(function (a, o) { return a + o.guests; }, 0);
    var req = _vnBookings_().filter(function (b) { return b.status === 'REQUEST' && b.date >= today; }), SL = _vnStopList_();
    var has = function (p) { return _mcRbHasExact_(s, p); }, A = [];
    if (has('hall|hall_manage')) A.push({ label: 'Моя смена — Зал', module: 'vnhall' }, { label: 'Блокнот официанта', module: 'vnorder' });
    if (has('booking|hall_manage|hall')) A.push({ label: 'Бронирование столов', module: 'vnbook' });
    if (has('hall|hall_manage|booking')) A.push({ label: 'План зала', module: 'vnfloor' });
    if (has('kanban|prod_manage')) A.push({ label: 'Моя смена — Кухня', module: 'vnkitchen' });
    if (has('bar|hall_manage')) A.push({ label: 'Моя смена — Бар', module: 'vnbar' });
    A.push({ label: 'Стоп/go-лист', module: 'vnstop' });
    if (has('guestmenu')) A.push({ label: 'Электронное меню', module: 'vnmenu' });
    if (has('guestmenu|hall_manage')) A.push({ label: 'QR-коды меню', module: 'vnqr' });
    var money = has('hall_manage|finance_view');
    var kpis = [{ label: 'Брони сегодня', value: act.length, hint: act.reduce(function (a, b) { return a + b.guests; }, 0) + ' гостей', go: { module: 'vnbook' } },
      { label: 'Заявки гостей', value: req.length, tone: req.length ? 'gold' : 'green', hint: req.length ? 'подтвердите' : 'нет новых', go: { module: 'vnbook' } },
      { label: 'Столы с гостями', value: openO.length, go: { module: 'vnfloor' } },
      { label: 'В стопе', value: SL.filter(function (x) { return x.status === 'STOP'; }).length, tone: SL.some(function (x) { return x.status === 'STOP'; }) ? 'red' : 'green', hint: 'go: ' + SL.filter(function (x) { return x.status === 'GO'; }).length, go: { module: 'vnstop' } }];
    if (money) kpis.push({ label: 'Выручка зала сегодня, ₽', value: rev }, { label: 'Средний чек, ₽', value: closed.length ? _vnR2_(rev / closed.length) : '—', hint: guests ? 'на гостя ' + _vnR2_(rev / guests) + ' ₽' : '' });
    return {
      title: 'Зал', subtitle: 'Брони, столы, заказы официантов, кухня и бар по курсам, стоп/go-лист и электронное меню для гостей. Закрытый счёт — продажа MON CHEF: журнал J36 и списание склада по партиям.',
      kpis: kpis,
      tabs: [
        { title: 'Брони сегодня', columns: [_uiCol_('from', 'С'), _uiCol_('to', 'До'), _uiCol_('guest', 'Гость'), _uiCol_('guests', 'Гостей', 'num'), _uiCol_('tablesTxt', 'Столы'), _uiCol_('statusRu', 'Статус', 'status'), _uiCol_('note', 'Комментарий')],
          rows: B.map(function (b) { return { from: b.from, to: b.to, guest: b.guest, guests: b.guests, tablesTxt: b.tables.join(', '), statusRu: b.statusRu, note: [b.occasion, b.note].filter(Boolean).join(' · ') }; }) },
        { title: 'Заявки гостей', columns: [_uiCol_('date', 'Дата'), _uiCol_('from', 'Время'), _uiCol_('guest', 'Гость'), _uiCol_('phone', 'Телефон'), _uiCol_('guests', 'Гостей', 'num'), _uiCol_('note', 'Комментарий')],
          rows: req.map(function (b) { return { date: b.date.split('-').reverse().join('.'), from: b.from, guest: b.guest, phone: b.phone, guests: b.guests, note: b.note }; }) },
        { title: 'Открытые столы', columns: [_uiCol_('table', 'Стол'), _uiCol_('waiter', 'Официант'), _uiCol_('guests', 'Гостей', 'num'), _uiCol_('opened', 'Открыт')], rows: openO.map(function (o) { return { table: o.table, waiter: o.waiter, guests: o.guests, opened: o.opened }; }) },
        { title: 'Стоп/go-лист', columns: [_uiCol_('name', 'Позиция'), _uiCol_('statusRu', 'Отметка', 'status'), _uiCol_('left', 'Осталось', 'num'), _uiCol_('reason', 'Причина'), _uiCol_('until', 'До'), _uiCol_('by', 'Кто')], rows: SL },
        { title: 'Закрытые счета', columns: [_uiCol_('table', 'Стол'), _uiCol_('waiter', 'Официант'), _uiCol_('guests', 'Гостей', 'num'), _uiCol_('closed', 'Закрыт'), _uiCol_('total', 'К оплате, ₽', 'num'), _uiCol_('payment', 'Оплата')],
          rows: money ? closed.map(function (o) { return { table: o.table, waiter: o.waiter, guests: o.guests, closed: o.closed, total: o.total, payment: (MC_VN_PAY_.filter(function (p) { return p[0] === o.payment; })[0] || ['', o.payment])[1] }; }) : [] }
      ],
      actions: A
    };
  };
  // главная: плитка своей зоны первой (официант, бармен, хостес — их смена в зале; повар — очередь кухни)
  var orig = _UI_BUILDERS_.home; if (typeof orig !== 'function') return;
  _UI_BUILDERS_.home = function (token, opts, s) {
    var r = orig(token, opts, s) || {};
    try {
      if (s && !s.dev) {
        var Z = _vnZones_(s), K = [], A = [];
        Z.forEach(function (z) {
          if (z.id === 'hall' && _mcRbHasExact_(s, 'hall|hall_manage')) {
            var me = _author_(token).фио, all = _mcRbHasExact_(s, 'hall_manage'), O = _vnOrders_(function (o) { return o.status === 'OPEN' && (all || o.waiter === me); });
            var L = _vnLinesOf_(O.map(function (o) { return o.id; })), ready = L.filter(function (l) { return l.status === 'READY'; }).length;
            K.push({ label: 'Зал: мои столы', value: O.length, hint: ready ? 'готово к подаче: ' + ready : 'готового к подаче нет', tone: ready ? 'gold' : 'green', go: { module: 'vnhall' } });
            A.push({ label: 'Моя смена — Зал', module: 'vnhall' }, { label: 'Блокнот официанта', module: 'vnorder' });
          } else if (z.id === 'hall') {
            var rq = _vnBookings_().filter(function (b) { return b.status === 'REQUEST' && b.date >= _vnToday_(); }).length;
            K.push({ label: 'Брони: заявки гостей', value: rq, tone: rq ? 'gold' : 'green', go: { module: 'vnbook' } });
            A.push({ label: 'Бронирование столов', module: 'vnbook' });
          } else {
            var q = _vnQueue_(z.id === 'bar' ? 'Бар' : 'Кухня');
            K.push({ label: z.label + ': заказы', value: q.counts.cooking, hint: q.counts.late ? 'дольше нормы: ' + q.counts.late : 'в работе', tone: q.counts.late ? 'red' : q.counts.cooking ? 'gold' : 'green', go: { module: z.id === 'bar' ? 'vnbar' : 'vnkitchen' } });
            A.push({ label: 'Моя смена — ' + z.label, module: z.id === 'bar' ? 'vnbar' : 'vnkitchen' });
          }
        });
        if (K.length) {
          r.kpis = K.concat(r.kpis || []);
          var mods = {}; A.forEach(function (a) { mods[a.module] = true; });
          r.actions = A.concat((r.actions || []).filter(function (a) { return !(a && mods[a.module]); }));
        }
      }
    } catch (e) {}
    return r;
  };
})();
