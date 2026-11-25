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

/*
 * 2. Предзаказы → закупки и план производства. Подтверждённые предзаказы броней недели входят в недельный оперативный план
 *    MON CHEF (V14) как отдельный источник спроса («PREORDER»): сырьё — в закупку (заявки поставщикам V21 строятся из плана),
 *    нехватка п/ф — в задания производства и канбан. Сами блюда предзаказа заданиями «изготовить заранее» не становятся:
 *    их готовят по заказу на экране кухни и бара (этапы 3–6). Склад предзаказ не резервирует и не списывает.
 */
/** Порции позиции предзаказа: порц/шт — количество; г/кг/мл/л — вес ÷ выход блюда. */
function _rsPoPortions_(it, dish) {
  var u = String(it.unit || 'порц').toLowerCase().replace(/\./g, ''), q = Number(it.qty) || 0;
  if (/^(г|кг|мл|л)$/.test(u)) { var base = q * (u === 'кг' || u === 'л' ? 1000 : 1), y = Number(dish && dish.yield) || 0; return y > 0 ? base / y : 0; }
  return q;
}
/** Спрос подтверждённых предзаказов за период [from; to] (даты YYYY-MM-DD) в форме банкета для планирования: {id, date, time, format, items[{code, qty}], source}. */
function _rsPreorderDemand_(from, to) {
  var pos = {}, out = [], idx = null;
  try { idx = _buildDishIndexes_(); } catch (e) { idx = { dishByCode: {} }; }
  _rsRows_(MC_RS_SH_.PREORDERS).forEach(function (r) { pos[String(r.PreorderID)] = _rsPoObj_(r); });
  _rsRows_(MC_RS_SH_.BOOKINGS).map(_rsBkObj_).forEach(function (bk) {
    if (bk.date < from || bk.date > to || ['NEW', 'CONFIRMED', 'ARRIVED', 'SEATED'].indexOf(bk.status) < 0) return;
    var po = pos[bk.preorderId]; if (!po || po.status !== 'CONFIRMED') return;
    var items = po.items.map(function (it) { return { code: it.code, name: it.name, qty: Math.round(_rsPoPortions_(it, idx.dishByCode[it.code]) * 1000) / 1000 }; }).filter(function (x) { return x.qty > 0; });
    if (items.length) out.push({ id: 'PO:' + po.id, date: bk.date, time: bk.start, format: 'Предзаказ: ' + bk.guest, name: 'Предзаказ: ' + bk.guest, guests: bk.guests, items: items, status: 'Подтверждён', source: 'PREORDER', bookingId: bk.id });
  });
  return out;
}

/*
 * 3. Stop/Go по остаткам. Система проверяет, хватит ли партий на СЛЕДУЮЩУЮ порцию (тем же движком V71 без списания, что и
 *    при «Готовить»): после каждого «Готово» — для этого блюда, раз в час и по кнопке — для всего меню (блюда с ценой на сегодня).
 *    Не хватает — ПРЕДЛОЖЕНИЕ «поставить STOP» на экране Stop/Go (и уведомление шеф-повару / менеджеру бара). Ставит STOP
 *    человек одним нажатием: причина «Закончилось сырьё», принятые заказы сохраняются. Сам STOP система не ставит —
 *    остаток мог не дойти до учёта (приход не оформлен), решение за кухней. Сырьё снова есть, а блюдо на STOP «Закончилось
 *    сырьё» — предложение вернуть GO (GO — как обычно, с проверкой «продукты есть, оборудование работает, качество в норме»).
 *    Предложение, ставшее неактуальным (приход, ревизия), закрывается само.
 */
MC_RS_SH_.STOPSUG = 'СтопГО_Предложения_V1';
MC_RS_HEAD_[MC_RS_SH_.STOPSUG] = ['SuggID', 'DishCode', 'Название', 'Подразделение', 'Предложение', 'Нехватка', 'Статус', 'Создано', 'Решил', 'Решено', 'Комментарий'].concat(MC_RS_STD_);
var MC_RS_SUG_RU_ = { STOP: 'поставить STOP', GO: 'вернуть GO' };

/** Хватит ли партий на одну порцию: {code: {short: [{product, qty, unit}], noTtk}}. Один снимок склада на всю серию. */
function _rsStockGap_(codes) {
  var idx = _buildDishIndexes_(), out = {}, sn = { v: _stockBatchesSheet_().getDataRange().getValues(), res: _v71Reserved_(), blocked: _v71Blocked_() };
  codes.forEach(function (code) {
    var dish = idx.dishByCode[code];
    if (!dish || !dish.ing || !dish.ing.length) { out[code] = { short: [], noTtk: true }; return; }
    try {
      var r = _v71Run_({ kind: 'DISH', name: String(dish.name), code: String(dish.code), dish: dish, unit: 'порц.' }, 1, { at: new Date(), dry: true, snap: sn, idx: idx });
      out[code] = { short: (r.short || []).map(function (x) { return { product: x.product, qty: Math.round(x.qty * 1000) / 1000, unit: x.unit }; }) };
    } catch (e) { out[code] = { short: [], error: String(e && e.message || e) }; }
  });
  return out;
}
function _rsSugObj_(r) {
  return { id: String(r.SuggID), code: String(r.DishCode), name: String(r['Название'] || ''), dept: String(r['Подразделение']), kind: String(r['Предложение']), kindRu: MC_RS_SUG_RU_[r['Предложение']] || r['Предложение'],
    short: _rsJ_(r['Нехватка'], []) || [], status: String(r['Статус']), at: _rsIsDate_(r['Создано']) ? Utilities.formatDate(r['Создано'], _mcTz_(), 'dd.MM HH:mm') : '', version: parseInt(r.Version, 10) || 1 };
}
/**
 * Проверка остатков и предложения Stop/Go. codes — блюда (null — всё меню на сегодня). s, op — кто запустил (null — расписание).
 * Возвращает {checked, opened[], closed[]}.
 */
function _rsStopWatch_(codes, s, op) {
  var dishes = _rsDishes_();
  if (!codes) { var pi = {}; try { pi = _rsPriceIdx_(_rsToday_()); } catch (e) { pi = {}; } codes = Object.keys(pi).filter(function (c) { return dishes[c]; }); }
  codes = codes.filter(function (c, i, a) { return dishes[c] && a.indexOf(c) === i; });
  if (!codes.length) return { checked: 0, opened: [], closed: [] };
  var gap = _rsStockGap_(codes), eop = op || { id: _rsId_('OP') }, opened = [], closed = [];
  _withLock_(function () {
    var stops = _rsStopRows_(), sugs = _rsRows_(MC_RS_SH_.STOPSUG), plan = [], now = new Date();
    var open = function (code, dept, kind) { return sugs.filter(function (r) { return String(r.DishCode) === code && String(r['Подразделение']) === dept && String(r['Предложение']) === kind && String(r['Статус']) === 'OPEN'; })[0]; };
    var close = function (r, why) { var o = _rsCopy_(r); delete o._row; o['Статус'] = 'CLOSED'; o['Решено'] = now; o['Решил'] = 'система'; o['Комментарий'] = why; _rsStamp_(o, s, eop, false); plan.push({ sheet: MC_RS_SH_.STOPSUG, row: o }); closed.push(_rsSugObj_(o)); };
    codes.forEach(function (code) {
      var g = gap[code]; if (!g || g.noTtk || g.error) return;
      var dept = dishes[code].dept === 'BAR' ? 'BAR' : 'KITCHEN', cur = _rsStopCur_(stops, code, dept), st = cur ? String(cur['Статус']) : 'GO', lack = g.short.length > 0;
      var sStop = open(code, dept, 'STOP'), sGo = open(code, dept, 'GO');
      if (lack && (st === 'GO' || st === 'LIMITED') && !sStop) {
        var row = _rsStamp_({ SuggID: _rsId_('SUG'), DishCode: code, 'Название': dishes[code].name, 'Подразделение': dept, 'Предложение': 'STOP', 'Нехватка': JSON.stringify(g.short), 'Статус': 'OPEN', 'Создано': now }, s, eop, true);
        plan.push({ sheet: MC_RS_SH_.STOPSUG, row: row }); opened.push(_rsSugObj_(row));
        try { _notify_('RS_STOP_SUGGEST', 'warning', 'Не хватит на следующую порцию: ' + dishes[code].name + (dept === 'BAR' ? ' (бар)' : ''), 'Нет: ' + g.short.map(function (x) { return x.product + ' ' + x.qty + ' ' + x.unit; }).join(', ') + '. Поставьте STOP на экране «Кухня и бар → Stop/Go» или оформите приход.', dept === 'BAR' ? 'Менеджер бара' : 'Шеф-повар', 'RS_SUG_' + row.SuggID, eop); } catch (e) {}
      }
      if (!lack && sStop) close(sStop, 'сырьё есть');
      if (lack && sGo) close(sGo, 'сырья снова нет');
      if (!lack && st === 'STOP' && String(cur['Причина']) === 'Закончилось сырьё' && !sGo) {
        var rg = _rsStamp_({ SuggID: _rsId_('SUG'), DishCode: code, 'Название': dishes[code].name, 'Подразделение': dept, 'Предложение': 'GO', 'Нехватка': '[]', 'Статус': 'OPEN', 'Создано': now }, s, eop, true);
        plan.push({ sheet: MC_RS_SH_.STOPSUG, row: rg }); opened.push(_rsSugObj_(rg));
        try { _notify_('RS_GO_SUGGEST', 'info', 'Сырьё есть: ' + dishes[code].name + ' можно вернуть в GO', 'Проверьте и верните GO на экране «Кухня и бар → Stop/Go».', dept === 'BAR' ? 'Менеджер бара' : 'Шеф-повар', 'RS_SUG_' + rg.SuggID, eop); } catch (e) {}
      }
    });
    if (plan.length) _rsTxApply_(eop, 'RS_STOP_WATCH', plan);
  });
  return { checked: codes.length, opened: opened, closed: closed };
}
/** Предложения Stop/Go (открытые) для экрана: {dept}. */
function rsStopSuggestions(json, token) {
  return _rsRead_(token, 'stopgo_view|stopgo_kitchen|stopgo_bar|stopgo_approve|kitchen_queue|bar_queue', function () {
    var d = _rsJ_(json, {}) || {}, dept = d.dept === 'BAR' ? 'BAR' : d.dept === 'KITCHEN' ? 'KITCHEN' : '';
    return { suggestions: _rsRows_(MC_RS_SH_.STOPSUG).map(_rsSugObj_).filter(function (x) { return x.status === 'OPEN' && (!dept || x.dept === dept); }) };
  });
}
/** Проверить остатки сейчас (всё меню на сегодня). */
function rsStopWatchRun(json, token) {
  var s; try { s = _requireAuth_(token, null); } catch (e) { return _failFrom_(e); }
  if (!_mcRbHasExact_(s, 'stopgo_kitchen|stopgo_bar|stopgo_approve')) return _mcRbDenyJson_('Проверка остатков — кухне и бару (Stop/Go).');
  try { var r = _rsStopWatch_(null, s, null); return _ok_(r); } catch (e) { return _rsFail_(e, null); }
}
/** Решение по предложению: {idem, id, version, accept, affected: KEEP|PROBLEM}. STOP — ставится с причиной «Закончилось сырьё»; GO — только отклонить (GO возвращается обычной кнопкой). */
function rsStopSuggestDecide(json, token) {
  var d = _rsJ_(json, {}) || {}, row = _rsRows_(MC_RS_SH_.STOPSUG).filter(function (r) { return String(r.SuggID) === String(d.id); })[0];
  if (!row) return _fail_('NOT_FOUND', 'Предложение не найдено');
  var sg = _rsSugObj_(row), stopRes = null;
  if (d.accept && sg.kind === 'STOP') {
    stopRes = JSON.parse(rsStopSet(JSON.stringify({ idem: String(d.idem || '') + '-stop', code: sg.code, dept: sg.dept, status: 'STOP', reason: 'Закончилось сырьё',
      comment: 'По остаткам: нет ' + sg.short.map(function (x) { return x.product + ' ' + x.qty + ' ' + x.unit; }).join(', '), affected: d.affected === 'PROBLEM' ? 'PROBLEM' : 'KEEP' }), token));
    if (!stopRes.success) return JSON.stringify(stopRes);
  }
  return _rsMutate_(token, _rsStopNeed_(sg.dept) + '|stopgo_approve', 'RS_STOP_SUGGEST', json, function (c) {
    var r = _rsRows_(MC_RS_SH_.STOPSUG).filter(function (x) { return String(x.SuggID) === sg.id; })[0];
    if (String(r['Статус']) !== 'OPEN') return { fail: ['VALIDATION', 'Предложение уже закрыто'] };
    var o = _rsCopy_(r); delete o._row; o['Статус'] = c.d.accept && sg.kind === 'STOP' ? 'APPLIED' : 'DISMISSED'; o['Решено'] = new Date(); o['Решил'] = _rsWho_(c.s);
    o['Комментарий'] = _rsS_(c.d.comment).slice(0, 300); _rsStamp_(o, c.s, c.op, false);
    return { data: { status: o['Статус'], stop: stopRes ? stopRes.data : null }, plan: [{ sheet: MC_RS_SH_.STOPSUG, row: o }],
      audit: { action: 'RS_STOP_SUGGEST_' + o['Статус'], entity: MC_RS_SH_.STOPSUG, id: sg.id, after: { code: sg.code, dept: sg.dept, kind: sg.kind, status: o['Статус'] } } };
  });
}
/** Расписание: раз в час — проверка всего меню. */
function rsStopWatchTick_() { try { return _rsStopWatch_(null, null, null); } catch (e) { try { _log_('WARN', 'Stop/Go по остаткам: ' + e); } catch (x) {} return null; } }
(function () { try { if (!MC_SCHEDULE.some(function (j) { return j.fn === 'rsStopWatchTick_'; })) MC_SCHEDULE.push({ fn: 'rsStopWatchTick_', everyMin: 60 }); } catch (e) {} })();

MC_GATE_EXT_.rsStopSuggestions = { need: 'stopgo_view|stopgo_kitchen|stopgo_bar|stopgo_approve|kitchen_queue|bar_queue' };
MC_GATE_EXT_.rsStopWatchRun = { need: 'stopgo_kitchen|stopgo_bar|stopgo_approve' };   // повтор безопасен: открытые предложения не дублируются
MC_GATE_EXT_.rsStopSuggestDecide = { need: 'stopgo_kitchen|stopgo_bar|stopgo_approve', mut: true };
