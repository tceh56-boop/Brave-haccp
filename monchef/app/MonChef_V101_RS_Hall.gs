/**
 * MON CHEF V101 — Restaurant Service: залы и столы (ТЗ Restaurant Service 1.0, модуль «Зал», этап 2).
 *
 * Собственность Слепцова Дениса Владимировича.
 * Разработчик кода — Слепцов Денис Владимирович.
 *
 * Зал принадлежит площадке (SiteID из «Площадки_V97»), стол — залу. Столы и залы не удаляются: «в архиве».
 * Нельзя отправить в архив зал или стол, на который есть предстоящие бронирования.
 * Номер стола уникален в зале. «Можно объединять с» — взаимно: связь пишется у обоих столов.
 * Схема зала — координаты X, Y в клетках сетки зала (Ширина × Высота); система их не придумывает — расставляет администратор.
 * Состояние стола на выбранное время: свободен / скоро бронь (до 2 ч) / забронирован / гости за столом.
 * Стол с открытым заказом (этап 3) — «занят заказом»: гостей, официант, сумма, готовые и ожидающие блюда.
 */
var MC_RS_SOON_MIN_ = 120;
var MC_RS_SHAPES_ = ['round', 'square', 'rect'];
/** Код стола для QR гостевого меню: 12 знаков без похожих букв. Не секрет — заявка гостя всё равно ждёт подтверждения официанта. */
function _rsQrCode_() { var a = 'abcdefghjkmnpqrstuvwxyz23456789', u = Utilities.getUuid().replace(/-/g, ''), out = ''; for (var i = 0; i < 12; i++) out += a[parseInt(u.substr(i * 2, 2), 16) % a.length]; return out; }

function _rsHallObj_(r) {
  return { id: String(r.HallID), siteId: String(r.SiteID), name: String(r['Название'] || ''), order: parseInt(r['Порядок'], 10) || 0,
    width: parseInt(r['Ширина'], 10) || 12, height: parseInt(r['Высота'], 10) || 8, status: String(r['Статус'] || 'ACTIVE'), version: parseInt(r.Version, 10) || 1 };
}
function _rsTableObj_(r) {
  return { id: String(r.TableID), hallId: String(r.HallID), siteId: String(r.SiteID), number: String(r['Номер']), seatsMin: parseInt(r['Мест мин'], 10) || 1,
    seatsMax: parseInt(r['Мест макс'], 10) || 1, x: parseInt(r.X, 10) || 0, y: parseInt(r.Y, 10) || 0, shape: String(r['Форма'] || 'square'),
    combine: _rsJ_(r['Можно объединять с'], []) || [], status: String(r['Статус'] || 'ACTIVE'), version: parseInt(r.Version, 10) || 1, qr: String(r['QR-код'] || '') };
}

/** Схема зала на дату и время: залы, столы, бронирования дня, состояние столов. */
function rsHallData(json, token) {
  return _rsRead_(token, 'hall_view|booking|hall_manage', function (s) {
    var d = _rsJ_(json, {}) || {}, siteId = _rsSite_(d.siteId), day = _rsDay_(d.date) || _rsToday_(), hm = _rsHm_(d.time) || _rsNowHm_();
    var manage = _mcRbHasExact_(s, 'hall_manage');
    var halls = _rsRows_(MC_RS_SH_.HALLS).map(_rsHallObj_).filter(function (h) { return h.siteId === siteId && (manage || h.status === 'ACTIVE'); })
      .sort(function (a, b) { return a.order - b.order || (a.name < b.name ? -1 : 1); });
    var hallIds = halls.map(function (h) { return h.id; });
    var tables = _rsRows_(MC_RS_SH_.TABLES).map(_rsTableObj_).filter(function (t) { return hallIds.indexOf(t.hallId) >= 0 && (manage || t.status === 'ACTIVE'); });
    var at = _rsAbsMin_(day, hm);
    var bookings = _rsBookingsBetween_(siteId, at - 24 * 60, at + 24 * 60).filter(function (b) { return b.date === day || (b.startAbs <= at && b.endAbs > at); });
    var orders = day === _rsToday_() && typeof _rsActiveOrders_ === 'function' ? _rsActiveOrders_(siteId) : {};
    tables.forEach(function (t) {
      var mine = bookings.filter(function (b) { return b.tables.indexOf(t.id) >= 0 && MC_RS_BK_BLOCK_.indexOf(b.status) >= 0; });
      var now = mine.filter(function (b) { return b.startAbs <= at && b.endAbs > at; })[0];
      var next = mine.filter(function (b) { return b.startAbs > at; }).sort(function (a, b) { return a.startAbs - b.startAbs; })[0];
      t.state = now ? (now.status === 'SEATED' || now.status === 'ARRIVED' ? 'seated' : 'booked') : (next && next.startAbs - at <= MC_RS_SOON_MIN_ ? 'soon' : 'free');
      t.booking = now ? _rsBkShort_(now) : null;
      t.next = next ? _rsBkShort_(next) : null;
      var ord = orders[t.id];
      if (ord) { t.state = 'order'; t.order = { id: ord.id, guests: ord.guests, waiter: ord.waiter, waiterId: ord.waiterId, totalKop: ord.totalKop, ready: ord.ready, waiting: ord.waiting, draft: ord.draft, mine: ord.waiterId === String(s.user_id || '') }; }
    });
    return { sites: _rsSites_(), siteId: siteId, date: day, time: hm, halls: halls, tables: tables, bookings: bookings.map(function (b) { return _rsBkPublic_(b, s); }),
      can: { booking: _mcRbHasExact_(s, 'booking'), manage: manage, order: _mcRbHasExact_(s, 'order_edit|order_all'), orderAll: _mcRbHasExact_(s, 'order_all'), send: _mcRbHasExact_(s, 'order_send|order_all'),
        split: _mcRbHasExact_(s, 'bill_split|order_all'), discount: _mcRbHasExact_(s, 'discount'), pay: _mcRbHasExact_(s, 'payment_confirm'), stopgo: _mcRbHasExact_(s, 'stopgo_view|stopgo_kitchen|stopgo_bar'), shift: _mcRbHasExact_(s, 'finance_view|order_all|payment_confirm|cash_view') }, me: String(s.user_id || '') };
  });
}
function _rsBkShort_(b) { return { id: b.id, guest: b.guest, guests: b.guests, start: b.start, end: b.end, status: b.status }; }

/** Создать или изменить зал. {idem, id?, version?, siteId, name, order, width, height, status} */
function rsHallSave(json, token) {
  return _rsMutate_(token, 'hall_manage', 'RS_HALL_SAVE', json, function (c) {
    var d = c.d, rows = _rsRows_(MC_RS_SH_.HALLS), cur = d.id ? rows.filter(function (r) { return String(r.HallID) === String(d.id); })[0] : null;
    if (d.id && !cur) return { fail: ['NOT_FOUND', 'Зал не найден'] };
    if (cur) _rsCheckVersion_(cur, d.version);
    var name = _rsS_(d.name).slice(0, 60), siteId = cur ? String(cur.SiteID) : _rsSite_(d.siteId);
    if (!name) return { fail: ['VALIDATION', 'Укажите название зала'] };
    if (rows.some(function (r) { return String(r.SiteID) === siteId && String(r['Статус']) !== 'ARCHIVED' && String(r.HallID) !== String(d.id || '') && _rsS_(r['Название']).toLowerCase() === name.toLowerCase(); }))
      return { fail: ['VALIDATION', 'Зал «' + name + '» уже есть на этой площадке'] };
    var w = parseInt(d.width, 10) || 12, h = parseInt(d.height, 10) || 8, st = d.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE';
    if (w < 4 || w > 40 || h < 4 || h > 40) return { fail: ['VALIDATION', 'Размер сетки зала — от 4 до 40 клеток'] };
    if (st === 'ARCHIVED' && cur && String(cur['Статус']) !== 'ARCHIVED') {
      var fut = _rsBookingsBetween_(siteId, _rsAbsMin_(_rsToday_(), _rsNowHm_()), Infinity).filter(function (b) { return b.hallId === String(cur.HallID) && MC_RS_BK_BLOCK_.indexOf(b.status) >= 0; });
      if (fut.length) return { fail: ['VALIDATION', 'В зале есть предстоящие бронирования (' + fut.length + ') — сначала перенесите или отмените их'] };
    }
    var o = cur ? _rsCopy_(cur) : { HallID: _rsId_('HALL'), SiteID: siteId };
    var before = cur ? _rsHallObj_(cur) : null;
    o['Название'] = name; o['Порядок'] = parseInt(d.order, 10) || 0; o['Ширина'] = w; o['Высота'] = h; o['Статус'] = st;
    _rsStamp_(o, c.s, c.op, !cur); delete o._row;
    var after = _rsHallObj_(o);
    return { data: after, plan: [{ sheet: MC_RS_SH_.HALLS, row: o }, { sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'HALL', o.HallID, null, cur ? 'HALL_UPDATED' : 'HALL_CREATED', before, after) }],
      audit: { action: cur ? 'RS_HALL_UPDATED' : 'RS_HALL_CREATED', entity: MC_RS_SH_.HALLS, id: o.HallID, before: before, after: after } };
  });
}

/** Создать или изменить стол. {idem, id?, version?, hallId, number, seatsMin, seatsMax, x, y, shape, combine:[TableID], status} */
function rsTableSave(json, token) {
  return _rsMutate_(token, 'hall_manage', 'RS_TABLE_SAVE', json, function (c) {
    var d = c.d, rows = _rsRows_(MC_RS_SH_.TABLES), cur = d.id ? rows.filter(function (r) { return String(r.TableID) === String(d.id); })[0] : null;
    if (d.id && !cur) return { fail: ['NOT_FOUND', 'Стол не найден'] };
    if (cur) _rsCheckVersion_(cur, d.version);
    var hallId = cur ? String(cur.HallID) : _rsS_(d.hallId);
    var hall = _rsRows_(MC_RS_SH_.HALLS).filter(function (r) { return String(r.HallID) === hallId; })[0];
    if (!hall) return { fail: ['VALIDATION', 'Выберите зал'] };
    if (String(hall['Статус']) === 'ARCHIVED') return { fail: ['VALIDATION', 'Зал в архиве'] };
    var num = _rsS_(d.number).slice(0, 10), mn = parseInt(d.seatsMin, 10) || 1, mx = parseInt(d.seatsMax, 10);
    if (!num) return { fail: ['VALIDATION', 'Укажите номер стола'] };
    if (!(mx >= 1 && mx <= 60)) return { fail: ['VALIDATION', 'Мест за столом — от 1 до 60'] };
    if (mn < 1 || mn > mx) return { fail: ['VALIDATION', 'Минимум мест — от 1 до максимума'] };
    var st = d.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE', id = cur ? String(cur.TableID) : _rsId_('TBL');
    if (st === 'ACTIVE' && rows.some(function (r) { return String(r.HallID) === hallId && String(r['Статус']) !== 'ARCHIVED' && String(r.TableID) !== id && _rsS_(r['Номер']).toLowerCase() === num.toLowerCase(); }))
      return { fail: ['VALIDATION', 'Стол № ' + num + ' в этом зале уже есть'] };
    var x = parseInt(d.x, 10) || 0, y = parseInt(d.y, 10) || 0, w = parseInt(hall['Ширина'], 10) || 12, h = parseInt(hall['Высота'], 10) || 8;
    if (x < 0 || y < 0 || x >= w || y >= h) return { fail: ['VALIDATION', 'Место стола — внутри сетки зала (' + w + ' × ' + h + ')'] };
    var shape = MC_RS_SHAPES_.indexOf(d.shape) >= 0 ? d.shape : 'square';
    var comb = (Array.isArray(d.combine) ? d.combine : []).map(String).filter(function (t, i, a) { return t !== id && a.indexOf(t) === i; });
    var bad = comb.filter(function (t) { return !rows.some(function (r) { return String(r.TableID) === t && String(r.HallID) === hallId && String(r['Статус']) !== 'ARCHIVED'; }); });
    if (bad.length) return { fail: ['VALIDATION', 'Объединять можно только со столами этого зала'] };
    if (st === 'ARCHIVED' && cur && String(cur['Статус']) !== 'ARCHIVED') {
      var fut = _rsBookingsBetween_(String(cur.SiteID), _rsAbsMin_(_rsToday_(), _rsNowHm_()), Infinity).filter(function (b) { return b.tables.indexOf(id) >= 0 && MC_RS_BK_BLOCK_.indexOf(b.status) >= 0; });
      if (fut.length) return { fail: ['VALIDATION', 'На стол есть предстоящие бронирования (' + fut.length + ') — сначала перенесите их'] };
      comb = [];
    }
    var o = cur ? _rsCopy_(cur) : { TableID: id, HallID: hallId, SiteID: String(hall.SiteID) };
    var before = cur ? _rsTableObj_(cur) : null, oldComb = before ? before.combine : [];
    o['Номер'] = num; o['Мест мин'] = mn; o['Мест макс'] = mx; o.X = x; o.Y = y; o['Форма'] = shape; o['Можно объединять с'] = JSON.stringify(comb); o['Статус'] = st;
    if (!o['QR-код']) o['QR-код'] = _rsQrCode_();   // код стола для гостевого меню (этап 5)
    _rsStamp_(o, c.s, c.op, !cur); delete o._row;
    var plan = [{ sheet: MC_RS_SH_.TABLES, row: o }];
    // объединение — взаимное: у добавленных столов дописать этот, у убранных — убрать
    rows.forEach(function (r) {
      var tid = String(r.TableID); if (tid === id) return;
      var has = comb.indexOf(tid) >= 0, had = oldComb.indexOf(tid) >= 0, lst = _rsJ_(r['Можно объединять с'], []) || [], i = lst.indexOf(id);
      if (has && i < 0) lst.push(id); else if (!has && had && i >= 0) lst.splice(i, 1); else return;
      var t = _rsCopy_(r); t['Можно объединять с'] = JSON.stringify(lst); _rsStamp_(t, c.s, c.op, false); delete t._row;
      plan.push({ sheet: MC_RS_SH_.TABLES, row: t });
    });
    var after = _rsTableObj_(o);
    plan.push({ sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'TABLE', id, null, cur ? 'TABLE_UPDATED' : 'TABLE_CREATED', before, after) });
    return { data: after, plan: plan, audit: { action: cur ? 'RS_TABLE_UPDATED' : 'RS_TABLE_CREATED', entity: MC_RS_SH_.TABLES, id: id, before: before, after: after } };
  });
}

var MC_GATE_EXT_ = (typeof MC_GATE_EXT_ !== 'undefined' && MC_GATE_EXT_) || {};
MC_GATE_EXT_.rsHallData = { need: 'hall_view|booking|hall_manage' };
MC_GATE_EXT_.rsHallSave = { need: 'hall_manage', mut: true };
MC_GATE_EXT_.rsTableSave = { need: 'hall_manage', mut: true };
