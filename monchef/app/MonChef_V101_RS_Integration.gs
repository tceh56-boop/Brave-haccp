/**
 * MON CHEF V101 — Restaurant Service, этап 9: связи с остальными модулями MON CHEF.
 *
 * Собственность Слепцова Дениса Владимировича.
 * Разработчик кода — Слепцов Денис Владимирович.
 *
 * 1. Банкеты ↔ брони зала. Банкет (раздел «Банкеты»), у которого «Место» — название зала, становится бронью этого зала
 *    на все его действующие столы (лист «Бронирования_V1», колонка «Банкет» = номер банкета). Дальше работает обычная
 *    проверка пересечений броней: стол, занятый банкетом, не забронировать, и наоборот. Если банкет лёг поверх уже
 *    принятых броней — бронь банкета всё равно записывается (банкет согласован в своём разделе), а администратору
 *    и директору приходит уведомление со списком пересечений; в «Зал → Брони» они видны красным.
 *    Банкет без подходящего зала можно привязать вручную: «Зал → Брони → Банкеты → Привязать к залу» (столы, время).
 *    Ручная привязка сохраняется при следующих правках банкета; дата, время, гости и отмена всегда берутся из банкета.
 *    Время банкета: «18:00» → 5 часов; «18:00–23:00» → по времени; без времени — весь день (10:00–22:00).
 */

var MC_RS_BANQ_MIN_ = 300;           // длительность банкета, если в банкете указано только начало
var MC_RS_BANQ_DAY_ = ['10:00', 720]; // банкет без времени — весь день

function _rsNorm_(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim(); }
/** Зал по полю «Место» банкета: совпадение названия целиком или словами (самое длинное название). */
function _rsBanqHall_(place, halls) {
  var p = ' ' + _rsNorm_(place) + ' ', best = null, bl = 0;
  if (!p.trim()) return null;
  halls.forEach(function (h) {
    if (h.status !== 'ACTIVE') return;
    var n = _rsNorm_(h.name); if (n.length < 2) return;
    if (p.indexOf(' ' + n + ' ') >= 0 && n.length > bl) { best = h; bl = n.length; }
  });
  return best;
}
/** Время банкета: «18:00», «18.00», «18:00–23:00», «с 18 до 23» → {start, duration}. */
function _rsBanqTime_(t) {
  var m = String(t || '').match(/(\d{1,2})(?:[:.](\d{2}))?/g) || [];
  var hm = m.map(function (x) { var q = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(x); return q && +q[1] < 24 ? ('0' + q[1]).slice(-2) + ':' + (q[2] || '00') : ''; }).filter(Boolean);
  if (!hm.length || !/\d/.test(String(t || ''))) return { start: MC_RS_BANQ_DAY_[0], duration: MC_RS_BANQ_DAY_[1], allDay: true };
  var a = _rsAbsMin_('2000-01-01', hm[0]), b = hm[1] ? _rsAbsMin_('2000-01-01', hm[1]) : NaN;
  var dur = !isNaN(b) ? (b > a ? b - a : b + 1440 - a) : MC_RS_BANQ_MIN_;
  return { start: hm[0], duration: Math.max(30, Math.min(dur, 1440)) };
}
function _rsBanqCancelled_(e) { return !e || /отмен|cancel/i.test(String(e.status || '')); }
function _rsBanqList_() { try { return JSON.parse(getEvents()) || []; } catch (e) { return []; } }

/** Бронь банкета по данным банкета. cur — действующая бронь банкета (если есть), hall/tables — куда. */
function _rsBanqRow_(e, cur, siteId, hallId, tables, tm, who) {
  var day = _rsDay_(e.date), a = _rsAbsMin_(day, tm.start);
  var f = { siteId: siteId, hallId: hallId, tables: tables, guest: ('Банкет: ' + String(e.format || e.name || 'Банкет')).slice(0, 80), phone: '',
    date: day, start: tm.start, duration: tm.duration, startAbs: a, endAbs: a + tm.duration, guests: Math.max(1, parseInt(e.guests, 10) || 1),
    wishes: '', comment: ('Банкет ' + e.id + (e.contact ? ' · контакт: ' + e.contact : '')).slice(0, 500), manager: cur ? cur['Менеджер'] : who };
  var st = cur && ['ARRIVED', 'SEATED', 'CLOSED'].indexOf(String(cur['Статус'])) >= 0 ? String(cur['Статус']) : 'CONFIRMED';
  var o = cur ? _rsCopy_(cur) : { BookingID: _rsId_('BK'), IdempotencyKey: 'BANQ-' + e.id };
  delete o._row; _rsBkRow_(o, f, st); o['Банкет'] = String(e.id);
  return o;
}
var MC_RS_BANQ_KEYS_ = ['HallID', 'Столы', 'Гость', 'Дата', 'Начало', 'Длительность, мин', 'Гостей', 'Комментарий', 'Статус'];
function _rsBanqSame_(a, b) { return MC_RS_BANQ_KEYS_.every(function (k) { return String(_rsIsDate_(a[k]) ? _rsDay_(a[k]) : a[k]) === String(_rsIsDate_(b[k]) ? _rsDay_(b[k]) : b[k]); }); }

/**
 * Синхронизация банкета с бронями зала. Зовут saveEvent и deleteEvent (Code.gs) после записи банкета; e === null — банкет удалён.
 * Возвращает {bookingId, conflicts[]} или {linked:false}.
 */
function _rsBanquetSync_(eventId, e, op) {
  var s = op && op.session, who = _rsWho_(s);
  var res = _withLock_(function () {
    var rows = _rsRows_(MC_RS_SH_.BOOKINGS), cur = rows.filter(function (r) { return String(r['Банкет']) === String(eventId) && MC_RS_BK_FINAL_.indexOf(String(r['Статус'])) < 0; })[0];
    var plan = [], eop = op || { id: _rsId_('OP') };
    if (_rsBanqCancelled_(e)) {
      if (!cur) return { linked: false };
      var c = _rsCopy_(cur); delete c._row; c['Статус'] = 'CANCELLED'; c['Причина'] = e ? 'Банкет отменён' : 'Банкет удалён'; _rsStamp_(c, s, eop, false);
      plan.push({ sheet: MC_RS_SH_.BOOKINGS, row: c }, { sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(eop, s, 'BOOKING', c.BookingID, { booking: c.BookingID }, 'BANQUET_RELEASED', { status: cur['Статус'] }, { status: 'CANCELLED', banquet: eventId }) });
      _rsTxApply_(eop, 'RS_BANQUET_SYNC', plan);
      return { bookingId: c.BookingID, released: true, conflicts: [] };
    }
    if (!_rsDay_(e.date)) return { linked: false };
    var halls = _rsRows_(MC_RS_SH_.HALLS).map(_rsHallObj_), tidx = _rsTablesIdx_(), hall = _rsBanqHall_(e.place, halls), tables, siteId, hallId;
    if (hall && (!cur || String(cur.HallID) !== hall.id)) {   // зал по «Месту»: все действующие столы зала
      tables = Object.keys(tidx).filter(function (t) { return tidx[t].hallId === hall.id && tidx[t].status === 'ACTIVE'; });
      siteId = hall.siteId; hallId = hall.id;
    } else if (cur) { tables = _rsJ_(cur['Столы'], []) || []; siteId = String(cur.SiteID); hallId = String(cur.HallID); }   // ручная привязка сохраняется
    else return { linked: false };
    if (!tables.length) return { linked: false };
    var tm = cur && !hall ? { start: _rsBanqTime_(e.time).allDay && _rsHm_(cur['Начало']) ? _rsHm_(cur['Начало']) : _rsBanqTime_(e.time).start,
      duration: _rsBanqTime_(e.time).allDay ? (parseInt(cur['Длительность, мин'], 10) || MC_RS_BANQ_DAY_[1]) : _rsBanqTime_(e.time).duration } : _rsBanqTime_(e.time);
    var o = _rsBanqRow_(e, cur, siteId, hallId, tables, tm, who);
    var b = _rsBkObj_(o), all = _rsBookingsBetween_(siteId, b.startAbs - 1440, b.endAbs + 1440);
    var conflicts = _rsBkConflicts_(all, tables, b.startAbs, b.endAbs, b.id).map(function (x) {
      return { id: x.id, guest: x.guest, date: x.date, start: x.start, end: x.end, tables: x.tables.filter(function (t) { return tables.indexOf(t) >= 0; }).map(function (t) { return tidx[t] ? tidx[t].number : t; }) };
    });
    if (cur && _rsBanqSame_(cur, o)) return { bookingId: b.id, conflicts: conflicts, unchanged: true };
    _rsStamp_(o, s, eop, !cur);
    plan.push({ sheet: MC_RS_SH_.BOOKINGS, row: o }, { sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(eop, s, 'BOOKING', b.id, { booking: b.id }, cur ? 'BANQUET_UPDATED' : 'BANQUET_LINKED', null,
      { banquet: eventId, date: b.date, start: b.start, end: b.end, tables: tables.length, conflicts: conflicts.length }) });
    _rsTxApply_(eop, 'RS_BANQUET_SYNC', plan);
    if (conflicts.length) {
      var txt = conflicts.map(function (x) { return x.guest + ' ' + x.date.split('-').reverse().join('.') + ' ' + x.start + '–' + x.end + ', стол ' + x.tables.join(', '); }).join('; ');
      ['Администратор', 'Директор'].forEach(function (role) {
        try { _notify_('RS_BANQUET', 'warning', 'Банкет «' + String(e.format || 'Банкет') + '» ' + b.date.split('-').reverse().join('.') + ' пересекается с бронями зала', txt + '. Перенесите брони или банкет.', role, 'RS_BQ_' + eventId + '_' + b.date + '_' + role, eop); } catch (x) {}
      });
    }
    return { bookingId: b.id, conflicts: conflicts };
  });
  try { if (op && typeof _audit_ === 'function' && res && res.bookingId && !res.unchanged) _audit_(op, 'RS_BANQUET_SYNC', MC_RS_SH_.BOOKINGS, res.bookingId, null, { banquet: eventId, released: !!res.released, conflicts: (res.conflicts || []).length }); } catch (x) {}
  return res;
}

/** Банкеты периода и их связь с залом: {from, to} (по умолчанию — 31 день от сегодня). */
function rsBanquetList(json, token) {
  return _rsRead_(token, 'hall_view|booking|hall_manage', function (s) {
    var d = _rsJ_(json, {}) || {}, from = _rsDay_(d.from) || _rsToday_(), to = _rsDay_(d.to) || _rsFromAbs_(_rsAbsMin_(from, '00:00') + 31 * 1440).day;
    var halls = _rsRows_(MC_RS_SH_.HALLS).map(_rsHallObj_), hidx = {}, tidx = _rsTablesIdx_();
    halls.forEach(function (h) { hidx[h.id] = h; });
    var bks = _rsRows_(MC_RS_SH_.BOOKINGS).map(_rsBkObj_), act = bks.filter(function (b) { return MC_RS_BK_FINAL_.indexOf(b.status) < 0; });
    var out = _rsBanqList_().filter(function (e) { var day = _rsDay_(e.date); return day && day >= from && day <= to && !_rsBanqCancelled_(e); }).map(function (e) {
      var bk = act.filter(function (b) { return b.eventId === String(e.id); })[0], tm = _rsBanqTime_(e.time), cf = [];
      if (bk) cf = _rsBkConflicts_(act, bk.tables, bk.startAbs, bk.endAbs, bk.id).map(function (x) { return { guest: x.guest, start: x.start, end: x.end, tables: x.tables.filter(function (t) { return bk.tables.indexOf(t) >= 0; }).map(function (t) { return tidx[t] ? tidx[t].number : t; }) }; });
      return { id: String(e.id), date: _rsDay_(e.date), time: String(e.time || ''), start: tm.start, duration: tm.duration, allDay: !!tm.allDay, format: String(e.format || e.name || 'Банкет'),
        guests: parseInt(e.guests, 10) || 0, place: String(e.place || ''), suggestedHall: (_rsBanqHall_(e.place, halls) || {}).id || '',
        booking: bk ? { id: bk.id, version: bk.version, hallId: bk.hallId, hall: hidx[bk.hallId] ? hidx[bk.hallId].name : '', tables: bk.tables, tableNumbers: bk.tables.map(function (t) { return tidx[t] ? tidx[t].number : t; }),
          start: bk.start, end: bk.end, status: bk.status } : null, conflicts: cf };
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.start < b.start ? -1 : 1; });
    return { from: from, to: to, banquets: out, can: { link: _mcRbHasExact_(s, 'booking') } };
  });
}

/** Привязать банкет к залу вручную: {idem, eventId, tables[], start?, duration?, force?}. tables [] — отвязать. Пересечения — только с force. */
function rsBanquetLink(json, token) {
  return _rsMutate_(token, 'booking', 'RS_BANQUET_LINK', json, function (c) {
    var d = c.d, e = _rsBanqList_().filter(function (x) { return String(x.id) === String(d.eventId); })[0];
    if (!e || _rsBanqCancelled_(e)) return { fail: ['NOT_FOUND', 'Банкет не найден или отменён'] };
    var rows = _rsRows_(MC_RS_SH_.BOOKINGS), cur = rows.filter(function (r) { return String(r['Банкет']) === String(e.id) && MC_RS_BK_FINAL_.indexOf(String(r['Статус'])) < 0; })[0];
    var tables = (Array.isArray(d.tables) ? d.tables : []).map(String).filter(function (t, i, a) { return t && a.indexOf(t) === i; });
    if (!tables.length) {
      if (!cur) return { data: { unlinked: true } };
      var u = _rsCopy_(cur); delete u._row; u['Статус'] = 'CANCELLED'; u['Причина'] = 'Банкет отвязан от зала'; _rsStamp_(u, c.s, c.op, false);
      return { data: { unlinked: true }, plan: [{ sheet: MC_RS_SH_.BOOKINGS, row: u }, { sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'BOOKING', u.BookingID, { booking: u.BookingID }, 'BANQUET_UNLINKED', null, { banquet: e.id }) }],
        audit: { action: 'RS_BANQUET_UNLINKED', entity: MC_RS_SH_.BOOKINGS, id: u.BookingID, after: { banquet: e.id } } };
    }
    var tidx = _rsTablesIdx_(), hidx = _rsHallsIdx_(), hallId = '';
    for (var i = 0; i < tables.length; i++) {
      var t = tidx[tables[i]]; if (!t || t.status !== 'ACTIVE') return { fail: ['VALIDATION', 'Стол не найден или в архиве'] };
      if (!hidx[t.hallId] || hidx[t.hallId].status !== 'ACTIVE') return { fail: ['VALIDATION', 'Зал стола № ' + t.number + ' в архиве'] };
      if (hallId && hallId !== t.hallId) return { fail: ['VALIDATION', 'Столы банкета — в одном зале'] }; hallId = t.hallId;
    }
    var tm = _rsBanqTime_(e.time), st = _rsHm_(d.start), dur = parseInt(d.duration, 10);
    if (st) tm = { start: st, duration: dur >= 30 && dur <= 1440 ? dur : tm.duration };
    var o = _rsBanqRow_(e, cur, tidx[tables[0]].siteId, hallId, tables, tm, _rsWho_(c.s)), b = _rsBkObj_(o);
    var all = _rsBookingsBetween_(b.siteId, b.startAbs - 1440, b.endAbs + 1440), cf = _rsBkConflicts_(all, tables, b.startAbs, b.endAbs, b.id);
    if (cf.length && !d.force) return { fail: ['CONFLICT', 'Пересекается с бронями: ' + cf.map(function (x) { return x.guest + ' ' + x.start + '–' + x.end + ', стол ' + x.tables.filter(function (t) { return tables.indexOf(t) >= 0; }).map(function (t) { return tidx[t] ? tidx[t].number : t; }).join(', '); }).join('; ') + '. Перенесите брони или привяжите банкет «несмотря на пересечения»'] };
    _rsStamp_(o, c.s, c.op, !cur);
    return { data: { bookingId: b.id, conflicts: cf.length }, plan: [{ sheet: MC_RS_SH_.BOOKINGS, row: o }, { sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'BOOKING', b.id, { booking: b.id }, 'BANQUET_LINKED', null, { banquet: e.id, tables: tables.length, start: b.start, end: b.end, conflicts: cf.length, manual: true }) }],
      audit: { action: 'RS_BANQUET_LINKED', entity: MC_RS_SH_.BOOKINGS, id: b.id, after: { banquet: e.id, tables: tables, start: b.start, duration: b.duration, conflicts: cf.length } } };
  });
}

MC_GATE_EXT_.rsBanquetList = { need: 'hall_view|booking|hall_manage' };
MC_GATE_EXT_.rsBanquetLink = { need: 'booking', mut: true };
