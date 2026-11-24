/**
 * MON CHEF V101 — Restaurant Service: бронирование гостей и предзаказ (ТЗ Restaurant Service 1.0, модуль 2, этап 2).
 *
 * Собственность Слепцова Дениса Владимировича.
 * Разработчик кода — Слепцов Денис Владимирович.
 *
 * Бронирование: дата, начало, продолжительность (окончание считается), гости, зал, один или несколько столов.
 * Статусы: NEW → CONFIRMED → ARRIVED → SEATED → CLOSED; WAITING (лист ожидания), CANCELLED, NO_SHOW.
 * Проверки — только на сервере и под общей блокировкой (два сотрудника не забронируют один стол на одно время):
 *   пересечение интервалов [начало; окончание) по каждому столу среди броней NEW / CONFIRMED / ARRIVED / SEATED;
 *   вместимость (сумма «Мест макс» ≥ гостей); зал и столы действуют; несколько столов — только связанные «можно объединять».
 * WAITING — лист ожидания: столы не держит; при подтверждении проходит все проверки.
 * Предзаказ — НЕ продажа: не списывает склад, не создаёт производственных операций и записей журнала продаж.
 * Подтверждённые предзаказы видны в прогнозе потребности кухни и бара (по блюдам и дням).
 * Преобразование предзаказа в заказ — на этапе 3 («Открыть заказ по бронированию»), один раз (ConvertedOrderID).
 * Телефон гостя — персональные данные (152-ФЗ): виден праву «booking»; остальным — последние 2 цифры.
 */
var MC_RS_BK_ST_ = ['NEW', 'CONFIRMED', 'WAITING', 'ARRIVED', 'SEATED', 'CLOSED', 'CANCELLED', 'NO_SHOW'];
var MC_RS_BK_BLOCK_ = ['NEW', 'CONFIRMED', 'ARRIVED', 'SEATED'];        // держат стол
var MC_RS_BK_FINAL_ = ['CLOSED', 'CANCELLED', 'NO_SHOW'];
var MC_RS_BK_RU_ = { NEW: 'новое', CONFIRMED: 'подтверждено', WAITING: 'ожидание', ARRIVED: 'гость пришёл', SEATED: 'стол занят', CLOSED: 'закрыто', CANCELLED: 'отменено', NO_SHOW: 'не пришёл' };
var MC_RS_BK_NEXT_ = {
  NEW: ['CONFIRMED', 'WAITING', 'ARRIVED', 'SEATED', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['ARRIVED', 'SEATED', 'CANCELLED', 'NO_SHOW', 'WAITING'],
  WAITING: ['CONFIRMED', 'CANCELLED'],
  ARRIVED: ['SEATED', 'CANCELLED'],
  SEATED: ['CLOSED'],
  CLOSED: [], CANCELLED: [], NO_SHOW: []
};
var MC_RS_PO_ST_ = { DRAFT: 'черновик', CONFIRMED: 'подтверждён', CONVERTED: 'перенесён в заказ', CANCELLED: 'отменён' };
var MC_RS_UNITS_ = { 'порц': 'порц', 'порция': 'порц', 'шт': 'шт', 'г': 'г', 'кг': 'кг', 'мл': 'мл', 'л': 'л' };

/* ---------------- чтение ---------------- */
function _rsBkObj_(r) {
  var day = _rsDay_(r['Дата']), st = _rsHm_(r['Начало']), dur = parseInt(r['Длительность, мин'], 10) || 0, a = _rsAbsMin_(day, st);
  var end = isNaN(a) ? { day: day, hm: '' } : _rsFromAbs_(a + dur);
  return { id: String(r.BookingID), siteId: String(r.SiteID), hallId: String(r.HallID || ''), tables: _rsJ_(r['Столы'], []) || [], guest: String(r['Гость'] || ''),
    phone: String(r['Телефон'] || ''), date: day, start: st, duration: dur, end: end.hm, endDate: end.day, startAbs: a, endAbs: a + dur,
    guests: parseInt(r['Гостей'], 10) || 0, wishes: String(r['Пожелания'] || ''), comment: String(r['Комментарий'] || ''), manager: String(r['Менеджер'] || ''),
    preorderId: String(r.PreorderID || ''), status: String(r['Статус'] || 'NEW'), reason: String(r['Причина'] || ''), orderId: String(r.OrderID || ''),
    version: parseInt(r.Version, 10) || 1, createdBy: String(r.CreatedBy || '') };
}
function _rsBookingsBetween_(siteId, fromAbs, toAbs) {
  return _rsRows_(MC_RS_SH_.BOOKINGS).map(_rsBkObj_).filter(function (b) { return (!siteId || b.siteId === siteId) && !isNaN(b.startAbs) && b.endAbs > fromAbs && b.startAbs < toAbs; });
}
function _rsMaskPhone_(p) { var dg = String(p || '').replace(/\D/g, ''); return dg ? '•••' + dg.slice(-2) : ''; }
function _rsBkPublic_(b, s) {
  var o = {}; Object.keys(b).forEach(function (k) { if (k !== 'startAbs' && k !== 'endAbs') o[k] = b[k]; });
  o.statusRu = MC_RS_BK_RU_[b.status] || b.status;
  if (!_mcRbHasExact_(s, 'booking')) o.phone = _rsMaskPhone_(b.phone);
  return o;
}
function _rsTablesIdx_() { var m = {}; _rsRows_(MC_RS_SH_.TABLES).forEach(function (r) { m[String(r.TableID)] = _rsTableObj_(r); }); return m; }
function _rsHallsIdx_() { var m = {}; _rsRows_(MC_RS_SH_.HALLS).forEach(function (r) { m[String(r.HallID)] = _rsHallObj_(r); }); return m; }

/** Пересечения по столам: брони, которые держат стол и пересекаются с [a; b). */
function _rsBkConflicts_(all, tableIds, a, b, excludeId) {
  return all.filter(function (x) {
    return x.id !== excludeId && MC_RS_BK_BLOCK_.indexOf(x.status) >= 0 && x.startAbs < b && x.endAbs > a && x.tables.some(function (t) { return tableIds.indexOf(t) >= 0; });
  });
}
/** Столы связаны объединением (граф «можно объединять с» связный). */
function _rsTablesJoinable_(ids, idx) {
  if (ids.length < 2) return true;
  var seen = {}, stack = [ids[0]];
  while (stack.length) { var t = stack.pop(); if (seen[t]) continue; seen[t] = 1; (idx[t].combine || []).forEach(function (n) { if (ids.indexOf(n) >= 0 && !seen[n]) stack.push(n); }); }
  return ids.every(function (t) { return seen[t]; });
}

/* ---------------- проверка брони ---------------- */
/** Нормализует поля брони и проверяет зал, столы, вместимость, пересечения. Возвращает {f: поля, err}. */
function _rsBkCheck_(d, cur, status) {
  var f = {};
  f.siteId = cur ? cur.siteId : _rsSite_(d.siteId);
  f.guest = _rsS_(d.guest !== undefined ? d.guest : cur && cur.guest).slice(0, 80);
  if (!f.guest) return { err: 'Укажите имя гостя' };
  var ph = _rsS_(d.phone !== undefined ? d.phone : cur && cur.phone);
  if (ph && !/^\+?[\d\s()\-]{5,20}$/.test(ph)) return { err: 'Телефон — цифры, можно «+», пробелы, скобки и дефис' };
  f.phone = ph;
  f.date = _rsDay_(d.date !== undefined ? d.date : cur && cur.date);
  f.start = _rsHm_(d.start !== undefined ? d.start : cur && cur.start);
  if (!f.date || !f.start) return { err: 'Укажите дату и время начала' };
  f.duration = parseInt(d.duration !== undefined ? d.duration : cur && cur.duration, 10);
  if (!(f.duration >= 15 && f.duration <= 720)) return { err: 'Продолжительность — от 15 минут до 12 часов' };
  f.guests = parseInt(d.guests !== undefined ? d.guests : cur && cur.guests, 10);
  if (!(f.guests >= 1 && f.guests <= 500)) return { err: 'Количество гостей — от 1 до 500' };
  f.wishes = _rsS_(d.wishes !== undefined ? d.wishes : cur && cur.wishes).slice(0, 500);
  f.comment = _rsS_(d.comment !== undefined ? d.comment : cur && cur.comment).slice(0, 500);
  f.manager = _rsS_(d.manager !== undefined ? d.manager : cur && cur.manager).slice(0, 80);
  f.startAbs = _rsAbsMin_(f.date, f.start); f.endAbs = f.startAbs + f.duration;
  var tableIds = (d.tables !== undefined ? d.tables : (cur ? cur.tables : [])) || [];
  if (!Array.isArray(tableIds)) return { err: 'Столы — список' };
  tableIds = tableIds.map(String).filter(function (t, i, a) { return t && a.indexOf(t) === i; });
  f.tables = tableIds; f.hallId = '';
  var holds = MC_RS_BK_BLOCK_.indexOf(status) >= 0;
  if (!tableIds.length) { if (holds) return { err: 'Выберите стол (без стола — только лист ожидания)' }; return { f: f }; }
  var idx = _rsTablesIdx_(), halls = _rsHallsIdx_(), seats = 0;
  for (var i = 0; i < tableIds.length; i++) {
    var t = idx[tableIds[i]];
    if (!t || t.siteId !== f.siteId) return { err: 'Стол не найден на этой площадке' };
    if (t.status !== 'ACTIVE') return { err: 'Стол № ' + t.number + ' в архиве' };
    if (!halls[t.hallId] || halls[t.hallId].status !== 'ACTIVE') return { err: 'Зал стола № ' + t.number + ' в архиве' };
    if (f.hallId && f.hallId !== t.hallId) return { err: 'Столы одной брони — в одном зале' };
    f.hallId = t.hallId; seats += t.seatsMax;
  }
  if (!_rsTablesJoinable_(tableIds, idx)) return { err: 'Эти столы не объединяются (настройка зала: «можно объединять с»)' };
  if (holds && seats < f.guests) return { err: 'Гостей ' + f.guests + ', а мест за выбранными столами — ' + seats + '. Добавьте стол или уменьшите число гостей' };
  if (holds) {
    var all = _rsBookingsBetween_(f.siteId, f.startAbs - 24 * 60, f.endAbs + 24 * 60);
    var cf = _rsBkConflicts_(all, tableIds, f.startAbs, f.endAbs, cur ? cur.id : '');
    if (cf.length) {
      var c0 = cf[0], nums = c0.tables.filter(function (t) { return tableIds.indexOf(t) >= 0; }).map(function (t) { return idx[t] ? idx[t].number : t; });
      return { err: 'Стол № ' + nums.join(', ') + ' уже забронирован: ' + c0.date + ' ' + c0.start + '–' + c0.end + ' (' + c0.guest + ', ' + (MC_RS_BK_RU_[c0.status] || c0.status) + ')', conflict: true };
    }
  }
  return { f: f };
}
function _rsBkRow_(o, f, status) {
  o.SiteID = f.siteId; o.HallID = f.hallId; o['Столы'] = JSON.stringify(f.tables); o['Гость'] = f.guest; o['Телефон'] = f.phone; o['Дата'] = f.date; o['Начало'] = f.start;
  o['Длительность, мин'] = f.duration; o['Окончание'] = _rsFromAbs_(f.endAbs).hm; o['Гостей'] = f.guests; o['Пожелания'] = f.wishes; o['Комментарий'] = f.comment;
  o['Менеджер'] = f.manager; o['Статус'] = status; return o;
}

/* ---------------- предзаказ ---------------- */
/** Каталог блюд для предзаказа и заказа: только действующие блюда листа «Блюда» (без себестоимости и состава). */
function _rsDishes_() {
  var sh = _book_().getSheetByName('Блюда'), out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  var w = Math.min(sh.getLastColumn(), 14), v = sh.getRange(2, 1, sh.getLastRow() - 1, w).getValues();
  v.forEach(function (r) {
    var code = _rsS_(r[0]), name = _rsS_(r[1]); if (!code || !name) return;
    var shop = _rsS_(r[8]);
    out[code] = { code: code, name: name, category: _rsS_(r[2]), shop: shop, dept: /бар/i.test(shop) ? 'BAR' : 'KITCHEN',
      yield: w > 12 ? _rsNum_(r[12]) : NaN, yunit: w > 13 ? _rsS_(r[13]) : '' };
    if (isNaN(out[code].yield)) out[code].yield = null;
  });
  return out;
}
function rsDishCatalog(json, token) {
  return _rsRead_(token, 'booking|hall_view|catalog', function () {
    var m = _rsDishes_(); return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return a.category < b.category ? -1 : a.category > b.category ? 1 : (a.name < b.name ? -1 : 1); });
  });
}
/** Позиции предзаказа: блюдо из каталога, количество, единица, вес/объём, курс, гость, комментарий. */
function _rsPoItems_(items) {
  if (!Array.isArray(items)) return { err: 'Позиции предзаказа — список' };
  if (items.length > 200) return { err: 'Не больше 200 позиций' };
  var dishes = _rsDishes_(), out = [];
  for (var i = 0; i < items.length; i++) {
    var x = items[i] || {}, code = _rsS_(x.code), dish = dishes[code];
    if (!dish) return { err: 'Позиция ' + (i + 1) + ': блюдо не найдено в каталоге (код ' + (code || '—') + ')' };
    var qty = _rsNum_(x.qty); if (!(qty > 0 && qty <= 999)) return { err: '«' + dish.name + '»: количество — от 0 до 999' };
    var unit = MC_RS_UNITS_[_rsS_(x.unit).toLowerCase()] || 'порц';
    if ((unit === 'порц' || unit === 'шт') && Math.round(qty) !== qty) return { err: '«' + dish.name + '»: в порциях и штуках — целое число' };
    var amt = x.amount === undefined || x.amount === '' || x.amount === null ? null : _rsNum_(x.amount);
    if (amt !== null && !(amt > 0 && amt <= 100000)) return { err: '«' + dish.name + '»: вес или объём — положительное число' };
    var course = parseInt(x.course, 10) || 0; if (course < 0 || course > 9) return { err: '«' + dish.name + '»: курс — от 1 до 9' };
    out.push({ code: code, name: dish.name, dept: dish.dept, qty: qty, unit: unit, amount: amt, amountUnit: amt !== null ? (_rsS_(x.amountUnit) || dish.yunit || '') : '',
      course: course || null, guest: parseInt(x.guest, 10) || null, comment: _rsS_(x.comment).slice(0, 200) });
  }
  return { items: out };
}
function _rsPoObj_(r) {
  return r ? { id: String(r.PreorderID), bookingId: String(r.BookingID), items: _rsJ_(r['Позиции'], []) || [], status: String(r['Статус'] || 'DRAFT'),
    statusRu: MC_RS_PO_ST_[r['Статус']] || r['Статус'], orderId: String(r.ConvertedOrderID || ''), version: parseInt(r.Version, 10) || 1 } : null;
}

/* ---------------- API ---------------- */
/** Брони за период (не больше 62 дней). {siteId, from, to} */
function rsBookingList(json, token) {
  return _rsRead_(token, 'hall_view|booking', function (s) {
    var d = _rsJ_(json, {}) || {}, siteId = _rsSite_(d.siteId), from = _rsDay_(d.from) || _rsToday_(), to = _rsDay_(d.to) || from;
    var a = _rsAbsMin_(from, '00:00'), b = _rsAbsMin_(to, '00:00') + 24 * 60;
    if (b <= a) return { bookings: [], from: from, to: to };
    if (b - a > 62 * 24 * 60) throw new Error('VALIDATION: период — не больше 62 дней');
    var pos = {}; _rsRows_(MC_RS_SH_.PREORDERS).forEach(function (r) { pos[String(r.PreorderID)] = _rsPoObj_(r); });
    var tidx = _rsTablesIdx_();
    var list = _rsBookingsBetween_(siteId, a, b).sort(function (x, y) { return x.startAbs - y.startAbs; }).map(function (bk) {
      var o = _rsBkPublic_(bk, s); o.tableNumbers = bk.tables.map(function (t) { return tidx[t] ? tidx[t].number : '?'; }); o.preorder = pos[bk.preorderId] || null; return o;
    });
    return { bookings: list, from: from, to: to, siteId: siteId, sites: _rsSites_() };
  });
}
/** Свободные столы на интервал. {siteId, date, start, duration, guests, excludeId} */
function rsBookingAvailability(json, token) {
  return _rsRead_(token, 'hall_view|booking', function () {
    var d = _rsJ_(json, {}) || {}, siteId = _rsSite_(d.siteId), day = _rsDay_(d.date), hm = _rsHm_(d.start), dur = parseInt(d.duration, 10) || 120;
    if (!day || !hm) throw new Error('VALIDATION: укажите дату и время');
    var a = _rsAbsMin_(day, hm), b = a + dur, all = _rsBookingsBetween_(siteId, a - 24 * 60, b + 24 * 60), halls = _rsHallsIdx_();
    return Object.keys(_rsTablesIdx_()).map(function (k) { return _rsTablesIdx_()[k]; }).filter(function (t) {
      return t.siteId === siteId && t.status === 'ACTIVE' && halls[t.hallId] && halls[t.hallId].status === 'ACTIVE';
    }).map(function (t) {
      var cf = _rsBkConflicts_(all, [t.id], a, b, String(d.excludeId || ''));
      return { id: t.id, hallId: t.hallId, hall: halls[t.hallId].name, number: t.number, seatsMin: t.seatsMin, seatsMax: t.seatsMax, combine: t.combine,
        free: !cf.length, busy: cf.map(function (c) { return c.start + '–' + c.end + ' ' + c.guest; }) };
    });
  });
}
/** Создать бронь (и предзаказ). {idem, siteId, tables[], guest, phone, date, start, duration, guests, wishes, comment, manager, status:'NEW'|'CONFIRMED'|'WAITING', preorder:{items}} */
function rsBookingCreate(json, token) {
  return _rsMutate_(token, 'booking', 'RS_BOOKING_CREATE', json, function (c) {
    var d = c.d, status = ['NEW', 'CONFIRMED', 'WAITING'].indexOf(d.status) >= 0 ? d.status : 'NEW';
    var chk = _rsBkCheck_(d, null, status); if (chk.err) return { fail: [chk.conflict ? 'CONFLICT' : 'VALIDATION', chk.err] };
    var f = chk.f; if (!f.manager) f.manager = _rsWho_(c.s);
    if (f.endAbs <= _rsAbsMin_(_rsToday_(), _rsNowHm_())) return { fail: ['VALIDATION', 'Время брони уже прошло'] };
    var id = _rsId_('BK'), o = _rsBkRow_({ BookingID: id, IdempotencyKey: c.d.idem }, f, status), plan = [], po = null;
    if (d.preorder && Array.isArray(d.preorder.items) && d.preorder.items.length) {
      var pi = _rsPoItems_(d.preorder.items); if (pi.err) return { fail: ['VALIDATION', pi.err] };
      po = _rsStamp_({ PreorderID: _rsId_('PO'), BookingID: id, 'Позиции': JSON.stringify(pi.items), 'Статус': 'DRAFT' }, c.s, c.op, true);
      o.PreorderID = po.PreorderID; plan.push({ sheet: MC_RS_SH_.PREORDERS, row: po });
    }
    _rsStamp_(o, c.s, c.op, true);
    plan.unshift({ sheet: MC_RS_SH_.BOOKINGS, row: o });
    var after = _rsBkObj_(o);
    plan.push({ sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'BOOKING', id, { booking: id }, 'BOOKING_CREATED', null, { status: status, tables: f.tables, date: f.date, start: f.start, duration: f.duration, guests: f.guests, preorder: po ? po.PreorderID : '' }) });
    return { data: { booking: _rsBkPublic_(after, c.s), preorder: _rsPoObj_(po) }, plan: plan,
      audit: { action: 'RS_BOOKING_CREATED', entity: MC_RS_SH_.BOOKINGS, id: id, after: { status: status, tables: f.tables, date: f.date, start: f.start, duration: f.duration, guests: f.guests } } };
  });
}
/** Изменить бронь (время, столы, гостей, данные гостя). {idem, id, version, …поля} */
function rsBookingUpdate(json, token) {
  return _rsMutate_(token, 'booking', 'RS_BOOKING_UPDATE', json, function (c) {
    var d = c.d, rows = _rsRows_(MC_RS_SH_.BOOKINGS), r = rows.filter(function (x) { return String(x.BookingID) === String(d.id); })[0];
    if (!r) return { fail: ['NOT_FOUND', 'Бронь не найдена'] };
    _rsCheckVersion_(r, d.version);
    var cur = _rsBkObj_(r);
    if (MC_RS_BK_FINAL_.indexOf(cur.status) >= 0) return { fail: ['VALIDATION', 'Бронь ' + MC_RS_BK_RU_[cur.status] + ' — изменить нельзя'] };
    if (cur.status === 'SEATED' && (d.tables !== undefined || d.date !== undefined || d.start !== undefined)) return { fail: ['VALIDATION', 'Гости уже за столом: стол и время меняются переносом заказа (этап 3)'] };
    var chk = _rsBkCheck_(d, cur, cur.status); if (chk.err) return { fail: [chk.conflict ? 'CONFLICT' : 'VALIDATION', chk.err] };
    var o = _rsCopy_(r); delete o._row;
    _rsBkRow_(o, chk.f, cur.status); _rsStamp_(o, c.s, c.op, false);
    var after = _rsBkObj_(o), diff = {}, was = {};
    ['tables', 'guest', 'phone', 'date', 'start', 'duration', 'guests', 'wishes', 'comment', 'manager'].forEach(function (k) { if (JSON.stringify(cur[k]) !== JSON.stringify(after[k])) { was[k] = k === 'phone' ? _rsMaskPhone_(cur[k]) : cur[k]; diff[k] = k === 'phone' ? _rsMaskPhone_(after[k]) : after[k]; } });
    if (!Object.keys(diff).length) return { data: { booking: _rsBkPublic_(cur, c.s), unchanged: true } };
    return { data: { booking: _rsBkPublic_(after, c.s) }, plan: [{ sheet: MC_RS_SH_.BOOKINGS, row: o }, { sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'BOOKING', cur.id, { booking: cur.id }, 'BOOKING_UPDATED', was, diff) }],
      audit: { action: 'RS_BOOKING_UPDATED', entity: MC_RS_SH_.BOOKINGS, id: cur.id, before: was, after: diff } };
  });
}
/** Статус брони. {idem, id, version, status, reason} — отмена и «не пришёл» — с причиной. */
function rsBookingStatus(json, token) {
  return _rsMutate_(token, 'booking', 'RS_BOOKING_STATUS', json, function (c) {
    var d = c.d, rows = _rsRows_(MC_RS_SH_.BOOKINGS), r = rows.filter(function (x) { return String(x.BookingID) === String(d.id); })[0];
    if (!r) return { fail: ['NOT_FOUND', 'Бронь не найдена'] };
    _rsCheckVersion_(r, d.version);
    var cur = _rsBkObj_(r), to = String(d.status || '');
    if (MC_RS_BK_ST_.indexOf(to) < 0) return { fail: ['VALIDATION', 'Неизвестный статус'] };
    if ((MC_RS_BK_NEXT_[cur.status] || []).indexOf(to) < 0) return { fail: ['VALIDATION', 'Из статуса «' + MC_RS_BK_RU_[cur.status] + '» нельзя перейти в «' + MC_RS_BK_RU_[to] + '»'] };
    var reason = _rsS_(d.reason).slice(0, 300);
    if ((to === 'CANCELLED' || to === 'NO_SHOW') && !reason) return { fail: ['VALIDATION', 'Укажите причину'] };
    if (to === 'NO_SHOW' && cur.startAbs > _rsAbsMin_(_rsToday_(), _rsNowHm_())) return { fail: ['VALIDATION', '«Не пришёл» — только после времени начала брони'] };
    if (MC_RS_BK_BLOCK_.indexOf(to) >= 0 && MC_RS_BK_BLOCK_.indexOf(cur.status) < 0) {   // из листа ожидания — столы снова проверяются
      var chk = _rsBkCheck_({}, cur, to); if (chk.err) return { fail: [chk.conflict ? 'CONFLICT' : 'VALIDATION', chk.err] };
    }
    var o = _rsCopy_(r); delete o._row;
    o['Статус'] = to; if (reason) o['Причина'] = reason; _rsStamp_(o, c.s, c.op, false);
    var plan = [{ sheet: MC_RS_SH_.BOOKINGS, row: o }];
    if ((to === 'CANCELLED' || to === 'NO_SHOW') && cur.preorderId) {
      var pr = _rsRows_(MC_RS_SH_.PREORDERS).filter(function (x) { return String(x.PreorderID) === cur.preorderId; })[0];
      if (pr && String(pr['Статус']) !== 'CONVERTED') { var p = _rsCopy_(pr); delete p._row; p['Статус'] = 'CANCELLED'; _rsStamp_(p, c.s, c.op, false); plan.push({ sheet: MC_RS_SH_.PREORDERS, row: p }); }
    }
    plan.push({ sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'BOOKING', cur.id, { booking: cur.id, order: cur.orderId }, 'BOOKING_' + to, { status: cur.status }, { status: to, reason: reason }) });
    return { data: { booking: _rsBkPublic_(_rsBkObj_(o), c.s) }, plan: plan,
      audit: { action: 'RS_BOOKING_STATUS', entity: MC_RS_SH_.BOOKINGS, id: cur.id, before: { status: cur.status }, after: { status: to, reason: reason } } };
  });
}
/** Сохранить предзаказ брони. {idem, bookingId, version (предзаказа), items[], confirm:true|false} */
function rsPreorderSave(json, token) {
  return _rsMutate_(token, 'booking', 'RS_PREORDER_SAVE', json, function (c) {
    var d = c.d, bk = _rsRows_(MC_RS_SH_.BOOKINGS).filter(function (x) { return String(x.BookingID) === String(d.bookingId); })[0];
    if (!bk) return { fail: ['NOT_FOUND', 'Бронь не найдена'] };
    var b = _rsBkObj_(bk);
    if (MC_RS_BK_FINAL_.indexOf(b.status) >= 0 || b.status === 'SEATED') return { fail: ['VALIDATION', 'Бронь ' + MC_RS_BK_RU_[b.status] + ' — предзаказ не меняется'] };
    var pr = b.preorderId ? _rsRows_(MC_RS_SH_.PREORDERS).filter(function (x) { return String(x.PreorderID) === b.preorderId; })[0] : null;
    if (pr) { _rsCheckVersion_(pr, d.version); if (String(pr['Статус']) === 'CONVERTED') return { fail: ['VALIDATION', 'Предзаказ уже перенесён в заказ ' + pr.ConvertedOrderID] }; }
    var pi = _rsPoItems_(d.items || []); if (pi.err) return { fail: ['VALIDATION', pi.err] };
    var st = d.confirm ? 'CONFIRMED' : 'DRAFT';
    if (st === 'CONFIRMED' && !pi.items.length) return { fail: ['VALIDATION', 'Пустой предзаказ подтвердить нельзя'] };
    var before = _rsPoObj_(pr), p = pr ? _rsCopy_(pr) : { PreorderID: _rsId_('PO'), BookingID: b.id };
    delete p._row; p['Позиции'] = JSON.stringify(pi.items); p['Статус'] = st; _rsStamp_(p, c.s, c.op, !pr);
    var plan = [{ sheet: MC_RS_SH_.PREORDERS, row: p }];
    if (!pr) { var o = _rsCopy_(bk); delete o._row; o.PreorderID = p.PreorderID; _rsStamp_(o, c.s, c.op, false); plan.push({ sheet: MC_RS_SH_.BOOKINGS, row: o }); }
    var after = _rsPoObj_(p);
    plan.push({ sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'PREORDER', p.PreorderID, { booking: b.id }, 'PREORDER_' + st, before && { status: before.status, items: before.items }, { status: st, items: pi.items }) });
    return { data: { preorder: after }, plan: plan, audit: { action: 'RS_PREORDER_' + st, entity: MC_RS_SH_.PREORDERS, id: p.PreorderID, after: { booking: b.id, items: pi.items.length } } };
  });
}
/** Прогноз потребности по подтверждённым предзаказам: блюда по дням и подразделениям (кухня / бар). Склад не резервируется. */
function rsPreorderForecast(json, token) {
  return _rsRead_(token, 'hall_view|booking|plan', function () {
    var d = _rsJ_(json, {}) || {}, siteId = _rsSite_(d.siteId), from = _rsDay_(d.from) || _rsToday_(), to = _rsDay_(d.to) || from;
    var a = _rsAbsMin_(from, '00:00'), b = _rsAbsMin_(to, '00:00') + 24 * 60;
    if (b - a > 31 * 24 * 60 || b <= a) throw new Error('VALIDATION: период — от 1 до 31 дня');
    var pos = {}; _rsRows_(MC_RS_SH_.PREORDERS).forEach(function (r) { pos[String(r.PreorderID)] = _rsPoObj_(r); });
    var agg = {}, bookings = 0;
    _rsBookingsBetween_(siteId, a, b).forEach(function (bk) {
      if (['NEW', 'CONFIRMED', 'ARRIVED'].indexOf(bk.status) < 0 || bk.startAbs < a) return;
      var po = pos[bk.preorderId]; if (!po || po.status !== 'CONFIRMED') return;
      bookings++;
      po.items.forEach(function (it) {
        var k = bk.date + '|' + it.code + '|' + it.unit + '|' + (it.amount || '');
        var x = agg[k] || (agg[k] = { date: bk.date, code: it.code, name: it.name, dept: it.dept, unit: it.unit, amount: it.amount, amountUnit: it.amountUnit, qty: 0, bookings: [] });
        x.qty += it.qty; if (x.bookings.indexOf(bk.id) < 0) x.bookings.push(bk.id);
      });
    });
    var rows = Object.keys(agg).map(function (k) { return agg[k]; }).sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : (x.dept < y.dept ? -1 : x.name < y.name ? -1 : 1); });
    // этап 7: потребность в сырье по ТТК (п/ф раскрываются до сырья, как в планировании MON CHEF) — по кухне и бару
    var need = {}; try { var idx = _buildDishIndexes_();
      rows.forEach(function (x) {
        var acc = _pfRawRequirement_(x.code, x.qty, 'порц.', idx, null, null) || {};
        Object.keys(acc).forEach(function (k) { var sep = k.lastIndexOf('|'), nm = k.slice(0, sep), un = k.slice(sep + 1), kk = x.dept + '|' + nm + '|' + un;
          var o = need[kk] || (need[kk] = { dept: x.dept, product: nm, unit: un, qty: 0, dates: [] }); o.qty += acc[k]; if (o.dates.indexOf(x.date) < 0) o.dates.push(x.date); });
      }); } catch (e) {}
    var ingredients = Object.keys(need).map(function (k) { var o = need[k]; o.qty = Math.round(o.qty * 1000) / 1000; return o; }).sort(function (a, b) { return a.dept < b.dept ? -1 : a.dept > b.dept ? 1 : (a.product < b.product ? -1 : 1); });
    return { from: from, to: to, siteId: siteId, bookings: bookings, rows: rows, ingredients: ingredients,
      note: 'Подтверждённые предзаказы. Склад не резервируется и не списывается: предзаказ — не продажа. Сырьё — по действующим ТТК (брутто).' };
  });
}
/** История брони: события обслуживания по BookingID. */
function rsBookingHistory(json, token) {
  return _rsRead_(token, 'booking', function () {
    var d = _rsJ_(json, {}) || {}, id = _rsS_(d.id);
    return _rsRows_(MC_RS_SH_.EVENTS).filter(function (e) { return String(e.BookingID) === id; }).map(function (e) {
      return { at: _rsIsDate_(e['Время']) ? Utilities.formatDate(e['Время'], _mcTz_(), 'dd.MM.yyyy HH:mm') : String(e['Время']), event: String(e['Событие']),
        before: _rsJ_(e['Было'], null), after: _rsJ_(e['Стало'], null), who: String(e['Сотрудник']) };
    });
  });
}

var MC_GATE_EXT_ = (typeof MC_GATE_EXT_ !== 'undefined' && MC_GATE_EXT_) || {};
MC_GATE_EXT_.rsDishCatalog = { need: 'booking|hall_view|catalog' };
MC_GATE_EXT_.rsBookingList = { need: 'hall_view|booking' };
MC_GATE_EXT_.rsBookingAvailability = { need: 'hall_view|booking' };
MC_GATE_EXT_.rsBookingHistory = { need: 'booking' };
MC_GATE_EXT_.rsPreorderForecast = { need: 'hall_view|booking|plan' };
MC_GATE_EXT_.rsBookingCreate = { need: 'booking', mut: true };
MC_GATE_EXT_.rsBookingUpdate = { need: 'booking', mut: true };
MC_GATE_EXT_.rsBookingStatus = { need: 'booking', mut: true };
MC_GATE_EXT_.rsPreorderSave = { need: 'booking', mut: true };
