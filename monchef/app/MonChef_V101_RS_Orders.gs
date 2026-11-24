/**
 * MON CHEF V101 — Restaurant Service: блокнот официанта — заказ, позиции, курсы, отправка на производство (этап 3).
 *
 * Собственность Слепцова Дениса Владимировича.
 * Разработчик кода — Слепцов Денис Владимирович.
 *
 * Заказ (OrderID) открывается на стол: гостей, официант, бронь, комментарий. На столе — один открытый заказ
 * (несколько счетов внутри заказа — разделение счёта). Открытие по брони переносит предзаказ в заказ один раз.
 * Позиция — блюдо из каталога «Блюда» (код), цена — из «Цены_Меню» на сегодня (цена фиксируется в позиции),
 * версия ТТК — действующая на момент отправки. Справочников блюд, цен и ТТК модуль не заводит.
 * Весовое блюдо — цена за «100 г», «кг», «мл»…: сумма = цена × вес / база; фактический вес вносится после
 * взвешивания, сумма пересчитывается по той же цене. Масса в штуки и объём в массу не переводятся.
 * Курсы настраиваются (по умолчанию 4). Курс ждёт команды официанта: задания его позиций приходят на кухню
 * со статусом «ожидает курса» и не начинаются, пока официант не нажмёт «Следующий курс». Позиция без курса — сразу.
 * Отправка: проверка всех позиций (блюдо в каталоге, цена не изменилась, вес у весовых, STOP/GO, действующая ТТК);
 * хотя бы одна не прошла — не уходит ничего, официант видит причины. Задания кухни и бара создаются из одного
 * заказа по цеху блюда (цех «Бар» — бар). Повтор отправки с тем же ключом ничего не дублирует.
 * Склад на этом этапе не трогается: списание — в момент производства (этапы 4 и 7).
 */
var MC_RS_COURSES_DEFAULT_ = [{ n: 1, name: 'Холодные закуски' }, { n: 2, name: 'Горячие закуски' }, { n: 3, name: 'Основные блюда' }, { n: 4, name: 'Десерты' }];
var MC_RS_IT_RU_ = { DRAFT: 'не отправлено', SENT: 'на кухне', WAIT_COURSE: 'ждёт курса', COOKING: 'готовится', READY: 'готово', SERVED: 'подано', CANCELLED: 'отменено', PROBLEM: 'проблема' };
var MC_RS_ORD_RU_ = { OPEN: 'открыт', CLOSED: 'закрыт', CANCELLED: 'отменён' };
var MC_RS_DEPT_RU_ = { KITCHEN: 'кухня', BAR: 'бар' };

/* ---------------- справочники ---------------- */
function _rsCourses_() {
  try { var x = JSON.parse(PropertiesService.getScriptProperties().getProperty('MC_RS_COURSES') || 'null'); if (Array.isArray(x) && x.length) return x; } catch (e) {}
  return MC_RS_COURSES_DEFAULT_;
}
/** Курсы предприятия: [{n, name}], от 1 до 9 курсов. Право hall_manage. */
function rsCoursesSave(json, token) {
  return _rsMutate_(token, 'hall_manage', 'RS_COURSES_SAVE', json, function (c) {
    var l = Array.isArray(c.d.courses) ? c.d.courses : [];
    if (!l.length || l.length > 9) return { fail: ['VALIDATION', 'Курсов — от 1 до 9'] };
    var out = l.map(function (x, i) { return { n: i + 1, name: _rsS_(x && x.name).slice(0, 40) }; });
    if (out.some(function (x) { return !x.name; })) return { fail: ['VALIDATION', 'У каждого курса — название'] };
    var before = _rsCourses_(); PropertiesService.getScriptProperties().setProperty('MC_RS_COURSES', JSON.stringify(out));
    return { data: out, audit: { action: 'RS_COURSES_SAVED', entity: 'Курсы', id: '', before: before, after: out } };
  });
}
/** Цена из «Цены_Меню»: действующая на дату, без банкетного договора. */
function _rsPriceIdx_(day) {
  var sh = _book_().getSheetByName('Цены_Меню'), out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  var v = sh.getDataRange().getValues(), h = v[0].map(String), c = function (n) { return h.indexOf(n); };
  var D = function (x) { return _rsDay_(x); };
  for (var i = 1; i < v.length; i++) {
    var r = v[i], code = _rsS_(r[c('DishCode')]); if (!code) continue;
    if (String(r[c('Status')] || 'ACTIVE') !== 'ACTIVE' || _rsS_(r[c('EventID')])) continue;
    var f = D(r[c('DateFrom')]), t = D(r[c('DateTo')]);
    if ((f && f > day) || (t && t < day)) continue;
    var price = _rsNum_(r[c('Price')]); if (!(price > 0)) continue;
    var cur = out[code];
    if (cur && cur.from > (f || '')) continue;
    out[code] = { id: String(r[c('PriceID')]), kop: Math.round(price * 100), unitText: _rsS_(r[c('Unit')]) || 'порц.', from: f || '' };
  }
  Object.keys(out).forEach(function (k) { var u = _rsPriceUnit_(out[k].unitText); out[k].unit = u; });
  return out;
}
/** «порц.», «шт», «100 г», «кг», «150 мл», «л» → {weighted, base (г или мл), dim, sale}. Не распознано — null. */
function _rsPriceUnit_(t) {
  var m = /^(\d+(?:[.,]\d+)?)?\s*(порц\.?|порция|порции|шт\.?|г|гр|кг|мл|л)$/i.exec(_rsS_(t).toLowerCase());
  if (!m) return null;
  var n = m[1] ? parseFloat(m[1].replace(',', '.')) : 1, u = m[2].replace('.', '');
  if (/^порц/.test(u)) return { weighted: false, sale: 'порц' };
  if (u === 'шт') return { weighted: false, sale: 'шт' };
  if (u === 'г' || u === 'гр') return { weighted: true, base: n, dim: 'г' };
  if (u === 'кг') return { weighted: true, base: n * 1000, dim: 'г' };
  if (u === 'мл') return { weighted: true, base: n, dim: 'мл' };
  return { weighted: true, base: n * 1000, dim: 'мл' };
}
/** Действующие версии ТТК: {код: номер} (одно чтение листа). */
function _rsTtkIdx_() {
  var out = {}; try {
    var v = _ttkVersionsSheet_().getDataRange().getValues();
    for (var i = 1; i < v.length; i++) if (v[i][2] === 'действующая') out[String(v[i][0])] = parseInt(v[i][1], 10) || 0;
  } catch (e) {}
  return out;
}
/** STOP/GO позиции в подразделении (лист «СтопГО_V1» — этап 4). Нет листа или записи — GO. */
function _rsStopIdx_() {
  var out = {};
  try {
    var sh = _book_().getSheetByName(MC_RS_SH_.STOPGO); if (!sh || sh.getLastRow() < 2) return out;
    var v = sh.getDataRange().getValues(), h = v[0].map(String);
    for (var i = 1; i < v.length; i++) { var o = {}; h.forEach(function (k, j) { o[k] = v[i][j]; }); if (String(o['Актуально']) === 'false' || o['Актуально'] === false) continue; out[String(o.DishCode) + '|' + String(o['Подразделение'])] = { status: String(o['Статус'] || 'GO'), left: _rsNum_(o['Остаток']) }; }
  } catch (e) {}
  return out;
}
function _rsStopOf_(idx, code, dept) { return idx[code + '|' + dept] || { status: 'GO' }; }

/* ---------------- заказ: чтение ---------------- */
function _rsIt_(r) {
  return { id: String(r.OrderItemID), orderId: String(r.OrderID), courseId: String(r.CourseID || ''), course: parseInt(r['Курс'], 10) || 0, guestId: String(r.GuestID || ''),
    guest: parseInt(r['Гость'], 10) || 0, code: String(r.DishCode), ttk: parseInt(r.TTKVersion, 10) || 0, name: String(r['Название']), dept: String(r['Подразделение']),
    shop: String(r['Цех'] || ''), qty: _rsNum_(r['Кол-во']) || 0, unit: String(r['Ед. продажи'] || 'порц'), weighted: r['Весовая'] === true || String(r['Весовая']) === 'true',
    planAmount: r['Вес план'] === '' ? null : _rsNum_(r['Вес план']), factAmount: r['Вес факт'] === '' ? null : _rsNum_(r['Вес факт']), amountUnit: String(r['Ед. веса'] || ''),
    priceKop: parseInt(r['Цена, коп'], 10) || 0, priceFor: String(r['Цена за'] || ''), priceId: String(r.PriceID || ''),
    planKop: parseInt(r['Сумма план, коп'], 10) || 0, factKop: r['Сумма факт, коп'] === '' ? null : parseInt(r['Сумма факт, коп'], 10),
    modifiers: _rsJ_(r['Модификаторы'], []) || [], comment: String(r['Комментарий'] || ''), status: String(r['Статус'] || 'DRAFT'), statusRu: MC_RS_IT_RU_[r['Статус']] || r['Статус'],
    sentAt: _rsIsDate_(r['Отправлено']) ? Utilities.formatDate(r['Отправлено'], _mcTz_(), 'HH:mm') : String(r['Отправлено'] || ''),
    ticketId: String(r.TicketID || ''), cancelReason: String(r['Причина отмены'] || ''), version: parseInt(r.Version, 10) || 1,
    servedAt: _rsIsDate_(r['Подано']) ? Utilities.formatDate(r['Подано'], _mcTz_(), 'HH:mm') : '', servedBy: String(r['Подал'] || ''),
    consumption: _rsJ_(r['Расход при отмене'], null), replaces: String(r['Замена для'] || '') };
}
/** Сумма позиции, коп: по факту веса, если внесён; иначе план. */
function _rsItKop_(it) { return it.factKop !== null && it.factKop !== undefined && !isNaN(it.factKop) ? it.factKop : it.planKop; }
function _rsAmountKop_(priceKop, u, qty, amount) { return u && u.weighted ? Math.round(priceKop * amount / u.base) : Math.round(priceKop * qty); }
function _rsOrd_(r) {
  return { id: String(r.OrderID), siteId: String(r.SiteID), hallId: String(r.HallID), tableId: String(r.TableID), bookingId: String(r.BookingID || ''), guests: parseInt(r['Гостей'], 10) || 0,
    waiter: String(r['Официант'] || ''), waiterId: String(r.WaiterID || ''), openedAt: _rsIsDate_(r['Открыт']) ? Utilities.formatDate(r['Открыт'], _mcTz_(), 'dd.MM HH:mm') : String(r['Открыт'] || ''),
    comment: String(r['Комментарий'] || ''), status: String(r['Статус'] || 'OPEN'), statusRu: MC_RS_ORD_RU_[r['Статус']] || r['Статус'], reason: String(r['Причина'] || ''), version: parseInt(r.Version, 10) || 1 };
}
function _rsOrderRow_(id) { return _rsRows_(MC_RS_SH_.ORDERS).filter(function (r) { return String(r.OrderID) === String(id); })[0] || null; }
function _rsCanOrder_(s, o) { return _mcRbHasExact_(s, 'order_all') || (String(o.WaiterID || o.waiterId || '') === String(s.user_id || '')); }
/** Открытые заказы площадки по столам (для схемы зала). */
function _rsActiveOrders_(siteId) {
  var items = {}; _rsRows_(MC_RS_SH_.ITEMS).forEach(function (r) { var o = String(r.OrderID); (items[o] = items[o] || []).push(_rsIt_(r)); });
  var out = {};
  _rsRows_(MC_RS_SH_.ORDERS).forEach(function (r) {
    if (String(r['Статус']) !== 'OPEN' || (siteId && String(r.SiteID) !== siteId)) return;
    var o = _rsOrd_(r), its = (items[o.id] || []).filter(function (x) { return x.status !== 'CANCELLED'; });
    o.totalKop = its.reduce(function (s, x) { return s + _rsItKop_(x); }, 0);
    o.ready = its.filter(function (x) { return x.status === 'READY'; }).length;
    o.waiting = its.filter(function (x) { return ['SENT', 'WAIT_COURSE', 'COOKING'].indexOf(x.status) >= 0; }).length;
    o.draft = its.filter(function (x) { return x.status === 'DRAFT'; }).length;
    out[o.tableId] = o;
  });
  return out;
}
/** Полный заказ: шапка, гости, курсы, позиции, задания, счета с суммами. */
function _rsOrderFull_(id, s) {
  var r = _rsOrderRow_(id); if (!r) throw new Error('NOT_FOUND: заказ не найден');
  var o = _rsOrd_(r);
  o.guestsList = _rsRows_(MC_RS_SH_.GUESTS).filter(function (g) { return String(g.OrderID) === o.id; }).map(function (g) { return { id: String(g.GuestID), n: parseInt(g['Номер'], 10) || 0, label: String(g['Метка'] || '') }; }).sort(function (a, b) { return a.n - b.n; });
  o.courses = _rsRows_(MC_RS_SH_.COURSES).filter(function (c) { return String(c.OrderID) === o.id; }).map(function (c) { return { id: String(c.CourseID), n: parseInt(c['Номер'], 10) || 0, name: String(c['Название']), status: String(c['Статус']), version: parseInt(c.Version, 10) || 1 }; }).sort(function (a, b) { return a.n - b.n; });
  o.items = _rsRows_(MC_RS_SH_.ITEMS).filter(function (x) { return String(x.OrderID) === o.id; }).map(_rsIt_);
  var tks = {}; _rsRows_(MC_RS_SH_.QUEUE).forEach(function (q) { if (String(q.OrderID) === o.id) tks[String(q.TicketID)] = q; });
  o.items.forEach(function (it) { var q = tks[it.ticketId]; if (!q) return; it.ticketStatus = String(q['Статус']); it.problem = String(q['Проблема'] || ''); it.cancelRequest = String(q['Запрос отмены'] || ''); it.readyAt = _rsIsDate_(q['Готово']) ? Utilities.formatDate(q['Готово'], _mcTz_(), 'HH:mm') : ''; });
  var tidx = _rsTablesIdx_(); o.table = tidx[o.tableId] ? tidx[o.tableId].number : '';
  o.totalKop = o.items.filter(function (x) { return x.status !== 'CANCELLED'; }).reduce(function (a, x) { return a + _rsItKop_(x); }, 0);
  if (typeof _rsBillsOf_ === 'function') { var b = _rsBillsOf_(o); o.bills = b.bills; o.unallocated = b.unallocated; o.paidKop = b.paidKop; }
  o.can = { edit: !!s && _rsCanOrder_(s, r) && _mcRbHasExact_(s, 'order_edit|order_all'), send: !!s && _rsCanOrder_(s, r) && _mcRbHasExact_(s, 'order_send|order_all'),
    all: !!s && _mcRbHasExact_(s, 'order_all'), split: !!s && _rsCanOrder_(s, r) && _mcRbHasExact_(s, 'bill_split|order_all'), discount: !!s && _mcRbHasExact_(s, 'discount'), pay: !!s && _mcRbHasExact_(s, 'payment_confirm') };
  return o;
}
function rsOrderGet(json, token) {
  return _rsRead_(token, 'hall_view|order_edit|order_all', function (s) {
    var d = _rsJ_(json, {}) || {}, r = _rsOrderRow_(d.id); if (!r) throw new Error('NOT_FOUND: заказ не найден');
    return _rsOrderFull_(d.id, s);
  });
}
/** Открытые заказы: мои (по умолчанию для официанта) или все площадки. {siteId, all} */
function rsOrderList(json, token) {
  return _rsRead_(token, 'hall_view|order_edit|order_all', function (s) {
    var d = _rsJ_(json, {}) || {}, siteId = _rsSite_(d.siteId), m = _rsActiveOrders_(siteId), tidx = _rsTablesIdx_();
    var all = d.all && _mcRbHasExact_(s, 'order_all|hall_view');
    return Object.keys(m).map(function (k) { var o = m[k]; o.table = tidx[o.tableId] ? tidx[o.tableId].number : ''; return o; })
      .filter(function (o) { return all || o.waiterId === String(s.user_id || ''); });
  });
}

/* ---------------- открыть стол ---------------- */
/** {idem, tableId, guests, waiterId?, bookingId?, comment} */
function rsOrderOpen(json, token) {
  return _rsMutate_(token, 'order_edit|order_all', 'RS_ORDER_OPEN', json, function (c) {
    var d = c.d, s = c.s, tidx = _rsTablesIdx_(), t = tidx[_rsS_(d.tableId)];
    if (!t || t.status !== 'ACTIVE') return { fail: ['VALIDATION', 'Стол не найден'] };
    var halls = _rsHallsIdx_(); if (!halls[t.hallId] || halls[t.hallId].status !== 'ACTIVE') return { fail: ['VALIDATION', 'Зал стола в архиве'] };
    var guests = parseInt(d.guests, 10); if (!(guests >= 1 && guests <= 60)) return { fail: ['VALIDATION', 'Гостей — от 1 до 60'] };
    var open = _rsActiveOrders_(t.siteId)[t.id];
    if (open) return { fail: ['CONFLICT', 'На столе № ' + t.number + ' уже открыт заказ (официант ' + open.waiter + ')'] };
    var waiter = { id: String(s.user_id || ''), name: _rsWho_(s) };
    if (d.waiterId && String(d.waiterId) !== waiter.id) {
      if (!_mcRbHasExact_(s, 'order_all')) return { fail: ['FORBIDDEN', 'Назначить другого официанта может администратор'] };
      var e = null; try { e = JSON.parse(getEmployees()).filter(function (x) { return String(x.id) === String(d.waiterId) && x.active !== false; })[0]; } catch (er) {}
      if (!e) return { fail: ['VALIDATION', 'Официант не найден'] };
      waiter = { id: String(e.id), name: e.name || e.fullName || '' };
    }
    var id = _rsId_('ORD'), plan = [], day = _rsToday_();
    var o = { OrderID: id, SiteID: t.siteId, HallID: t.hallId, TableID: t.id, BookingID: '', 'Гостей': guests, 'Официант': waiter.name, WaiterID: waiter.id, 'Открыт': new Date(),
      'Комментарий': _rsS_(d.comment).slice(0, 300), 'Статус': 'OPEN', IdempotencyKey: d.idem };
    var items = [], bkInfo = null;
    if (d.bookingId) {
      var bkr = _rsRows_(MC_RS_SH_.BOOKINGS).filter(function (x) { return String(x.BookingID) === String(d.bookingId); })[0];
      if (!bkr) return { fail: ['NOT_FOUND', 'Бронь не найдена'] };
      var bk = _rsBkObj_(bkr);
      if (bk.orderId) return { fail: ['CONFLICT', 'По этой брони заказ уже открыт: ' + bk.orderId] };
      if (['NEW', 'CONFIRMED', 'ARRIVED', 'SEATED'].indexOf(bk.status) < 0) return { fail: ['VALIDATION', 'Бронь ' + MC_RS_BK_RU_[bk.status] + ' — открыть заказ по ней нельзя'] };
      if (bk.tables.indexOf(t.id) < 0) return { fail: ['VALIDATION', 'Бронь на другой стол (№ ' + bk.tables.map(function (x) { return tidx[x] ? tidx[x].number : '?'; }).join(', ') + ')'] };
      if (bk.date !== day) return { fail: ['VALIDATION', 'Бронь на ' + bk.date.split('-').reverse().join('.') + ', а не на сегодня'] };
      o.BookingID = bk.id; bkInfo = bk;
      var b2 = _rsCopy_(bkr); delete b2._row; b2['Статус'] = 'SEATED'; b2.OrderID = id; _rsStamp_(b2, s, c.op, false);
      plan.push({ sheet: MC_RS_SH_.BOOKINGS, row: b2 });
      if (bk.preorderId) {
        var pr = _rsRows_(MC_RS_SH_.PREORDERS).filter(function (x) { return String(x.PreorderID) === bk.preorderId; })[0];
        if (pr && ['DRAFT', 'CONFIRMED'].indexOf(String(pr['Статус'])) >= 0) {
          items = _rsJ_(pr['Позиции'], []) || [];
          var p2 = _rsCopy_(pr); delete p2._row; p2['Статус'] = 'CONVERTED'; p2.ConvertedOrderID = id; p2.ConvertedAt = new Date(); _rsStamp_(p2, s, c.op, false);
          plan.push({ sheet: MC_RS_SH_.PREORDERS, row: p2 });
        }
      }
    }
    _rsStamp_(o, s, c.op, true); plan.unshift({ sheet: MC_RS_SH_.ORDERS, row: o });
    for (var g = 1; g <= guests; g++) plan.push({ sheet: MC_RS_SH_.GUESTS, row: _rsStamp_({ GuestID: id + '-G' + g, OrderID: id, 'Номер': g, 'Метка': '' }, s, c.op, true) });
    _rsCourses_().forEach(function (cr) { plan.push({ sheet: MC_RS_SH_.COURSES, row: _rsStamp_({ CourseID: id + '-C' + cr.n, OrderID: id, 'Номер': cr.n, 'Название': cr.name, 'Статус': 'WAIT' }, s, c.op, true) }); });
    var made = [], skipped = [];
    if (items.length) {
      var dishes = _rsDishes_(), prices = _rsPriceIdx_(day);
      items.forEach(function (it, i) {
        var dish = dishes[it.code]; if (!dish) { skipped.push((it.name || it.code) + ' — нет в каталоге'); return; }
        var row = _rsItemRow_(id, dish, prices[it.code], { qty: it.qty, amount: it.amount, course: it.course, guest: it.guest, comment: it.comment, modifiers: [] }, guests, 'PREORDER ' + (bkInfo ? bkInfo.preorderId : ''), i);
        made.push(row); plan.push({ sheet: MC_RS_SH_.ITEMS, row: _rsStamp_(row, s, c.op, true) });
      });
    }
    plan.push({ sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, s, 'ORDER', id, { booking: o.BookingID, order: id }, 'ORDER_OPENED', null, { table: t.number, guests: guests, waiter: waiter.name, booking: o.BookingID, preorderItems: made.length, skipped: skipped }) });
    return { data: { orderId: id, table: t.number, fromPreorder: made.length, skipped: skipped }, plan: plan,
      audit: { action: 'RS_ORDER_OPENED', entity: MC_RS_SH_.ORDERS, id: id, after: { table: t.number, guests: guests, waiter: waiter.name, booking: o.BookingID, preorderItems: made.length } } };
  });
}
/** Строка позиции заказа (статус DRAFT). Без цены — позиция есть, отправка её не пропустит. */
function _rsItemRow_(orderId, dish, price, x, guests, source, seq) {
  var u = price ? price.unit : null, qty = x.qty === undefined || x.qty === null || x.qty === '' ? 1 : _rsNum_(x.qty), amount = x.amount === null || x.amount === undefined || x.amount === '' ? null : _rsNum_(x.amount);
  var weighted = !!(u && u.weighted);
  if (weighted) { qty = 1; if (amount === null && dish.yield && /^(г|мл)$/.test(dish.yunit)) amount = dish.yield; }
  var course = parseInt(x.course, 10) || 0, guest = parseInt(x.guest, 10) || 0;
  if (guest > guests) guest = 0;
  var plan = price && u && (!weighted || amount > 0) ? _rsAmountKop_(price.kop, u, qty, amount) : 0;
  return { OrderItemID: orderId + '-I' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase(), OrderID: orderId, CourseID: course ? orderId + '-C' + course : '', 'Курс': course || '',
    GuestID: guest ? orderId + '-G' + guest : '', 'Гость': guest || '', DishCode: dish.code, TTKVersion: '', 'Название': dish.name, 'Подразделение': dish.dept, 'Цех': dish.shop,
    'Кол-во': qty, 'Ед. продажи': weighted ? u.dim : (u ? u.sale : 'порц'), 'Весовая': weighted, 'Вес план': amount === null ? '' : amount, 'Вес факт': '',
    'Ед. веса': weighted ? u.dim : (dish.yunit || ''), 'Цена, коп': price ? price.kop : '', 'Цена за': price ? price.unitText : '', PriceID: price ? price.id : '',
    'Сумма план, коп': plan, 'Сумма факт, коп': '', 'Модификаторы': JSON.stringify((x.modifiers || []).map(function (m) { return _rsS_(m).slice(0, 60); }).filter(Boolean).slice(0, 10)),
    'Комментарий': _rsS_(x.comment).slice(0, 200), 'Статус': 'DRAFT', 'Отправлено': '', TicketID: '', 'Причина отмены': '', 'Источник': source || '' };
}
function _rsLoadOrder_(c, need) {
  var r = _rsOrderRow_(c.d.orderId); if (!r) return { fail: ['NOT_FOUND', 'Заказ не найден'] };
  if (String(r['Статус']) !== 'OPEN') return { fail: ['VALIDATION', 'Заказ ' + (MC_RS_ORD_RU_[r['Статус']] || r['Статус'])] };
  if (!_rsCanOrder_(c.s, r)) return { fail: ['FORBIDDEN', 'Это заказ официанта ' + r['Официант'] + '. Изменить может он или администратор'] };
  return { row: r, o: _rsOrd_(r) };
}

/* ---------------- позиции ---------------- */
/** Добавить блюда. {idem, orderId, items:[{code, qty, amount, course, guest, modifiers[], comment}]} */
function rsItemAdd(json, token) {
  return _rsMutate_(token, 'order_edit|order_all', 'RS_ITEM_ADD', json, function (c) {
    var L = _rsLoadOrder_(c); if (L.fail) return L;
    var list = Array.isArray(c.d.items) ? c.d.items : []; if (!list.length || list.length > 50) return { fail: ['VALIDATION', 'Блюд за раз — от 1 до 50'] };
    var dishes = _rsDishes_(), prices = _rsPriceIdx_(_rsToday_()), stops = _rsStopIdx_(), courses = _rsCourses_().length, plan = [], made = [];
    for (var i = 0; i < list.length; i++) {
      var x = list[i] || {}, dish = dishes[_rsS_(x.code)];
      if (!dish) return { fail: ['VALIDATION', 'Блюдо не найдено в каталоге (код ' + (x.code || '—') + ')'] };
      var st = _rsStopOf_(stops, dish.code, dish.dept);
      if (st.status === 'STOP') return { fail: ['VALIDATION', '«' + dish.name + '» — STOP: временно недоступно'] };
      if (st.status === 'REVIEW') return { fail: ['VALIDATION', '«' + dish.name + '» — на проверке у ответственного, пока недоступно'] };
      var price = prices[dish.code];
      if (!price) return { fail: ['VALIDATION', '«' + dish.name + '»: нет цены в «Ценах меню» на сегодня — цену вносит экономист'] };
      if (!price.unit) return { fail: ['VALIDATION', '«' + dish.name + '»: единица цены «' + price.unitText + '» не распознана (порц., шт, 100 г, кг, мл, л)'] };
      var qty = _rsNum_(x.qty === undefined ? 1 : x.qty);
      if (!price.unit.weighted && !(qty > 0 && qty <= 99 && Math.round(qty) === qty)) return { fail: ['VALIDATION', '«' + dish.name + '»: количество — целое от 1 до 99'] };
      if (price.unit.weighted) { var a = x.amount === undefined || x.amount === '' ? (dish.yield && dish.yunit === price.unit.dim ? dish.yield : NaN) : _rsNum_(x.amount);
        if (!(a > 0 && a <= 20000)) return { fail: ['VALIDATION', '«' + dish.name + '»: весовое блюдо — укажите вес или объём, ' + price.unit.dim] }; x.amount = a; }
      var crs = parseInt(x.course, 10) || 0; if (crs < 0 || crs > courses) return { fail: ['VALIDATION', 'Курс — от 1 до ' + courses + ' или без курса'] };
      var g = parseInt(x.guest, 10) || 0; if (g < 0 || g > L.o.guests) return { fail: ['VALIDATION', 'Гость — от 1 до ' + L.o.guests + ' или общий'] };
      if (st.status === 'LIMITED' && st.left >= 0 && qty > st.left) return { fail: ['VALIDATION', '«' + dish.name + '» — осталось ' + st.left] };
      x.qty = price.unit.weighted ? 1 : qty;
      var row = _rsStamp_(_rsItemRow_(L.o.id, dish, price, x, L.o.guests, 'ORDER', i), c.s, c.op, true);
      made.push(_rsIt_(row)); plan.push({ sheet: MC_RS_SH_.ITEMS, row: row });
    }
    plan.push({ sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'ORDER', L.o.id, { booking: L.o.bookingId, order: L.o.id }, 'ITEMS_ADDED', null, made.map(function (m) { return { id: m.id, code: m.code, qty: m.qty, amount: m.planAmount, course: m.course, guest: m.guest, priceKop: m.priceKop }; })) });
    return { data: { items: made }, plan: plan, audit: { action: 'RS_ITEMS_ADDED', entity: MC_RS_SH_.ITEMS, id: L.o.id, after: { count: made.length } } };
  });
}
function _rsLoadItem_(c) {
  var r = _rsRows_(MC_RS_SH_.ITEMS).filter(function (x) { return String(x.OrderItemID) === String(c.d.itemId); })[0];
  if (!r) return { fail: ['NOT_FOUND', 'Позиция не найдена'] };
  c.d.orderId = r.OrderID; var L = _rsLoadOrder_(c); if (L.fail) return L;
  _rsCheckVersion_(r, c.d.version);
  return { row: r, it: _rsIt_(r), o: L.o };
}
/** Изменить неотправленную позицию: кол-во, вес, курс, гость, модификаторы, комментарий; reprice — взять текущую цену. */
function rsItemUpdate(json, token) {
  return _rsMutate_(token, 'order_edit|order_all', 'RS_ITEM_UPDATE', json, function (c) {
    var L = _rsLoadItem_(c); if (L.fail) return L;
    var d = c.d, it = L.it;
    if (it.status !== 'DRAFT') {   // после отправки меняется только гость (для счёта)
      if (Object.keys(d).some(function (k) { return ['qty', 'amount', 'course', 'modifiers', 'comment', 'reprice'].indexOf(k) >= 0; })) return { fail: ['VALIDATION', 'Позиция уже на кухне: меняется только гость. Иначе — отмена и новая позиция'] };
    }
    if (typeof _rsItemPaid_ === 'function' && _rsItemPaid_(it.id)) return { fail: ['VALIDATION', 'Позиция в оплаченном счёте — изменить нельзя'] };
    var dish = _rsDishes_()[it.code]; if (!dish) return { fail: ['VALIDATION', 'Блюдо больше не в каталоге — отмените позицию'] };
    var price = d.reprice ? _rsPriceIdx_(_rsToday_())[it.code] : (it.priceId ? { id: it.priceId, kop: it.priceKop, unitText: it.priceFor, unit: _rsPriceUnit_(it.priceFor) } : null);
    if (d.reprice && !price) return { fail: ['VALIDATION', 'Нет цены на сегодня'] };
    var x = { qty: d.qty !== undefined ? d.qty : it.qty, amount: d.amount !== undefined ? d.amount : it.planAmount, course: d.course !== undefined ? d.course : it.course,
      guest: d.guest !== undefined ? d.guest : it.guest, modifiers: d.modifiers !== undefined ? d.modifiers : it.modifiers, comment: d.comment !== undefined ? d.comment : it.comment };
    var u = price && price.unit;
    if (u && !u.weighted && !(x.qty > 0 && x.qty <= 99 && Math.round(x.qty) === +x.qty)) return { fail: ['VALIDATION', 'Количество — целое от 1 до 99'] };
    if (u && u.weighted && !(_rsNum_(x.amount) > 0)) return { fail: ['VALIDATION', 'Укажите вес или объём'] };
    var g = parseInt(x.guest, 10) || 0; if (g < 0 || g > L.o.guests) return { fail: ['VALIDATION', 'Гость — от 1 до ' + L.o.guests] };
    var crs = parseInt(x.course, 10) || 0; if (crs < 0 || crs > _rsCourses_().length) return { fail: ['VALIDATION', 'Нет такого курса'] };
    var row = _rsCopy_(L.row); delete row._row;
    var fresh = _rsItemRow_(it.orderId, dish, price, x, L.o.guests, row['Источник'], 0);
    ['CourseID', 'Курс', 'GuestID', 'Гость', 'Кол-во', 'Ед. продажи', 'Весовая', 'Вес план', 'Ед. веса', 'Цена, коп', 'Цена за', 'PriceID', 'Сумма план, коп', 'Модификаторы', 'Комментарий']
      .forEach(function (k) { if (it.status === 'DRAFT' || k === 'GuestID' || k === 'Гость') row[k] = fresh[k]; });
    if (it.factAmount !== null && it.weighted && price) row['Сумма факт, коп'] = _rsAmountKop_(price.kop, u, 1, it.factAmount);
    _rsStamp_(row, c.s, c.op, false);
    var after = _rsIt_(row);
    return { data: { item: after }, plan: [{ sheet: MC_RS_SH_.ITEMS, row: row }, { sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'ITEM', it.id, { order: it.orderId }, 'ITEM_UPDATED',
      { qty: it.qty, amount: it.planAmount, course: it.course, guest: it.guest, priceKop: it.priceKop }, { qty: after.qty, amount: after.planAmount, course: after.course, guest: after.guest, priceKop: after.priceKop }) }],
      audit: { action: 'RS_ITEM_UPDATED', entity: MC_RS_SH_.ITEMS, id: it.id } };
  });
}
/** Фактический вес весового блюда (после взвешивания). Сумма — по цене позиции. {idem, itemId, version, amount} */
function rsItemWeight(json, token) {
  return _rsMutate_(token, 'order_edit|order_all', 'RS_ITEM_WEIGHT', json, function (c) {
    var L = _rsLoadItem_(c); if (L.fail) return L;
    var it = L.it, a = _rsNum_(c.d.amount);
    if (!it.weighted) return { fail: ['VALIDATION', 'Позиция не весовая'] };
    if (it.status === 'CANCELLED') return { fail: ['VALIDATION', 'Позиция отменена'] };
    if (!(a > 0 && a <= 20000)) return { fail: ['VALIDATION', 'Фактический вес — положительное число, ' + it.amountUnit] };
    if (typeof _rsItemPaid_ === 'function' && _rsItemPaid_(it.id)) return { fail: ['VALIDATION', 'Позиция в оплаченном счёте'] };
    var u = _rsPriceUnit_(it.priceFor); if (!u) return { fail: ['VALIDATION', 'Единица цены не распознана'] };
    var row = _rsCopy_(L.row); delete row._row;
    row['Вес факт'] = a; row['Сумма факт, коп'] = _rsAmountKop_(it.priceKop, u, 1, a); _rsStamp_(row, c.s, c.op, false);
    var after = _rsIt_(row);
    return { data: { item: after }, plan: [{ sheet: MC_RS_SH_.ITEMS, row: row }, { sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'ITEM', it.id, { order: it.orderId }, 'ITEM_WEIGHED',
      { planAmount: it.planAmount, planKop: it.planKop }, { factAmount: a, factKop: after.factKop, priceKop: it.priceKop, priceFor: it.priceFor }) }],
      audit: { action: 'RS_ITEM_WEIGHED', entity: MC_RS_SH_.ITEMS, id: it.id, before: { amount: it.planAmount, kop: it.planKop }, after: { amount: a, kop: after.factKop } } };
  });
}
/** Отменить позицию. Не отправлена — сразу; на кухне, но не начата (NEW / ждёт курса) — с причиной, задание отменяется, расхода нет.
 *  Кухня уже готовит — отмена через кухню с фиксацией расхода (этап 4). {idem, itemId, version, reason} */
function rsItemCancel(json, token) {
  return _rsMutate_(token, 'order_edit|order_all', 'RS_ITEM_CANCEL', json, function (c) {
    var L = _rsLoadItem_(c); if (L.fail) return L;
    var it = L.it, reason = _rsS_(c.d.reason).slice(0, 300), plan = [];
    if (it.status === 'CANCELLED') return { fail: ['VALIDATION', 'Позиция уже отменена'] };
    if (typeof _rsItemPaid_ === 'function' && _rsItemPaid_(it.id)) return { fail: ['VALIDATION', 'Позиция в оплаченном счёте — отмена через возврат'] };
    if (it.status !== 'DRAFT') {
      if (!reason) return { fail: ['VALIDATION', 'Позиция уже отправлена — укажите причину отмены'] };
      var tk = _rsRows_(MC_RS_SH_.QUEUE).filter(function (q) { return String(q.TicketID) === it.ticketId; })[0];
      if (tk && ['ACCEPTED', 'COOKING', 'READY', 'PROBLEM'].indexOf(String(tk['Статус'])) >= 0) {   // этап 4: кухня уже приняла — запрос отмены кухне
        var rq = _rsCopy_(tk); rq['Запрос отмены'] = reason + ' — ' + _rsWho_(c.s); _rsStamp_(rq, c.s, c.op, false);
        try { _notify_('RS_CANCEL_REQ', 'warning', 'Запрос отмены: стол № ' + tk['Стол'], tk['Название'] + ' — ' + reason, 'Шеф-повар', 'RS_CRQ_' + tk.TicketID, c.op); } catch (e) {}
        return { data: { item: it, requested: true, note: 'Кухня уже приняла позицию: отмену подтвердит кухня и укажет расход' }, plan: [{ sheet: MC_RS_SH_.QUEUE, row: rq },
          { sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'ITEM', it.id, { order: it.orderId }, 'ITEM_CANCEL_REQUESTED', { status: it.status }, { reason: reason }) }],
          audit: { action: 'RS_ITEM_CANCEL_REQUESTED', entity: MC_RS_SH_.QUEUE, id: String(tk.TicketID), after: { reason: reason } } };
      }
      if (!tk || ['NEW', 'WAIT_COURSE'].indexOf(String(tk['Статус'])) < 0)
        return { fail: ['VALIDATION', 'Позицию уже выдали или отменили'] };
      var t2 = _rsCopy_(tk); delete t2._row; t2['Статус'] = 'CANCELLED'; t2['Проблема'] = 'отмена официантом: ' + reason; _rsStamp_(t2, c.s, c.op, false);
      plan.push({ sheet: MC_RS_SH_.QUEUE, row: t2 });
    }
    var row = _rsCopy_(L.row); delete row._row; row['Статус'] = 'CANCELLED'; row['Причина отмены'] = reason || 'не отправлялась'; _rsStamp_(row, c.s, c.op, false);
    plan.unshift({ sheet: MC_RS_SH_.ITEMS, row: row });
    plan.push({ sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'ITEM', it.id, { order: it.orderId }, 'ITEM_CANCELLED', { status: it.status }, { status: 'CANCELLED', reason: reason, consumption: 'нет: приготовление не начиналось' }) });
    return { data: { item: _rsIt_(row) }, plan: plan, audit: { action: 'RS_ITEM_CANCELLED', entity: MC_RS_SH_.ITEMS, id: it.id, before: { status: it.status }, after: { status: 'CANCELLED', reason: reason } } };
  });
}

/* ---------------- отправка, курсы ---------------- */
/**
 * Отправить на производство. {idem, orderId, mode:'all'|'course'|'items', course, itemIds[], holdNext:true|false}
 *  all — все неотправленные; первый ждущий курс запускается, следующие ждут команды (holdNext=false — запустить все);
 *  course — позиции курса n, курс запускается; items — выбранные позиции, их курсы не запускаются (кроме уже запущенных).
 */
function rsOrderSend(json, token) {
  return _rsMutate_(token, 'order_send|order_all', 'RS_ORDER_SEND', json, function (c) {
    var L = _rsLoadOrder_(c); if (L.fail) return L;
    var d = c.d, mode = ['all', 'course', 'items'].indexOf(d.mode) >= 0 ? d.mode : 'all', o = L.o;
    var itemRows = _rsRows_(MC_RS_SH_.ITEMS).filter(function (r) { return String(r.OrderID) === o.id; });
    var courseRows = _rsRows_(MC_RS_SH_.COURSES).filter(function (r) { return String(r.OrderID) === o.id; });
    var drafts = itemRows.filter(function (r) { return String(r['Статус']) === 'DRAFT'; });
    var pick = mode === 'all' ? drafts : mode === 'course' ? drafts.filter(function (r) { return (parseInt(r['Курс'], 10) || 0) === parseInt(d.course, 10); })
      : drafts.filter(function (r) { return (d.itemIds || []).indexOf(String(r.OrderItemID)) >= 0; });
    if (!pick.length) return { fail: ['VALIDATION', 'Нечего отправлять: неотправленных позиций ' + (mode === 'course' ? 'в этом курсе ' : '') + 'нет'] };
    // проверки ТЗ §3.7 — все позиции, отказ целиком
    var dishes = _rsDishes_(), prices = _rsPriceIdx_(_rsToday_()), stops = _rsStopIdx_(), ttk = _rsTtkIdx_(), errs = [];
    pick.forEach(function (r) {
      var it = _rsIt_(r), dish = dishes[it.code], p = prices[it.code], st = _rsStopOf_(stops, it.code, it.dept);
      if (!dish) errs.push('«' + it.name + '» — нет в каталоге');
      else if (!p || !it.priceId) errs.push('«' + it.name + '» — нет цены на сегодня');
      else if (p.id !== it.priceId || p.kop !== it.priceKop) errs.push('«' + it.name + '» — цена изменилась (' + (it.priceKop / 100) + ' → ' + (p.kop / 100) + ' ₽): обновите позицию');
      else if (it.weighted && !(it.planAmount > 0)) errs.push('«' + it.name + '» — не указан вес');
      else if (st.status === 'STOP') errs.push('«' + it.name + '» — STOP (' + MC_RS_DEPT_RU_[it.dept] + ')');
      else if (st.status === 'LIMITED' && st.left >= 0 && it.qty > st.left) errs.push('«' + it.name + '» — осталось ' + st.left);
      else if (st.status === 'REVIEW') errs.push('«' + it.name + '» — на проверке у ответственного');
      else if (!ttk[it.code]) errs.push('«' + it.name + '» — нет действующей ТТК (утвердите версию)');
    });
    if (errs.length) return { fail: ['VALIDATION', 'Не отправлено ничего. ' + errs.join('; ')] };
    // курсы: какие запускаются
    var waitCourses = courseRows.filter(function (r) { return String(r['Статус']) === 'WAIT'; }).map(function (r) { return parseInt(r['Номер'], 10); }).sort(function (a, b) { return a - b; });
    var pickCourses = pick.map(function (r) { return parseInt(r['Курс'], 10) || 0; }).filter(function (n) { return n > 0; });
    var fire = [];
    if (mode === 'course') fire = [parseInt(d.course, 10)];
    else if (mode === 'all') {
      var firstPending = waitCourses.filter(function (n) { return pickCourses.indexOf(n) >= 0; })[0];
      var anyFired = courseRows.some(function (r) { return String(r['Статус']) === 'FIRED'; });
      if (d.holdNext === false) fire = waitCourses.filter(function (n) { return pickCourses.indexOf(n) >= 0; });
      else if (firstPending && !anyFired) fire = [firstPending];
    }
    var fired = {}; courseRows.forEach(function (r) { fired[parseInt(r['Номер'], 10)] = String(r['Статус']) === 'FIRED' || fire.indexOf(parseInt(r['Номер'], 10)) >= 0; });
    var plan = [], now = new Date(), tidx = _rsTablesIdx_(), tableNo = tidx[o.tableId] ? tidx[o.tableId].number : '', sent = [];
    courseRows.forEach(function (r) {
      if (fire.indexOf(parseInt(r['Номер'], 10)) < 0 || String(r['Статус']) === 'FIRED') return;
      var x = _rsCopy_(r); delete x._row; x['Статус'] = 'FIRED'; x['Отправлен'] = now; x['Отправил'] = _rsWho_(c.s); _rsStamp_(x, c.s, c.op, false);
      plan.push({ sheet: MC_RS_SH_.COURSES, row: x });
    });
    pick.forEach(function (r) {
      var it = _rsIt_(r), go = !it.course || fired[it.course];
      var tk = _rsStamp_({ TicketID: it.id.replace(/-I/, '-T'), OrderItemID: it.id, OrderID: o.id, TableID: o.tableId, 'Стол': tableNo, SiteID: o.siteId, 'Подразделение': it.dept, 'Цех': it.shop,
        DishCode: it.code, TTKVersion: ttk[it.code], 'Название': it.name, 'Кол-во': it.qty, 'Вес': it.planAmount === null ? '' : it.planAmount + ' ' + it.amountUnit, 'Курс': it.course || '',
        'Модификаторы': JSON.stringify(it.modifiers), 'Комментарий': it.comment, 'Приоритет': 0, 'Статус': go ? 'NEW' : 'WAIT_COURSE' }, c.s, c.op, true);
      var x = _rsCopy_(r); delete x._row; x['Статус'] = go ? 'SENT' : 'WAIT_COURSE'; x['Отправлено'] = now; x.TicketID = tk.TicketID; x.TTKVersion = ttk[it.code]; _rsStamp_(x, c.s, c.op, false);
      plan.push({ sheet: MC_RS_SH_.ITEMS, row: x }, { sheet: MC_RS_SH_.QUEUE, row: tk });
      sent.push({ item: it.id, ticket: tk.TicketID, dish: it.name, qty: it.qty, dept: it.dept, course: it.course, ttk: ttk[it.code], status: tk['Статус'] });
    });
    if (typeof _rsStopConsumePlan_ === 'function') plan = plan.concat(_rsStopConsumePlan_(c, pick.map(function (r) { return { code: String(r.DishCode), dept: String(r['Подразделение']), qty: _rsNum_(r['Кол-во']) || 1 }; })));   // LIMITED: остаток
    plan.push({ sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'ORDER', o.id, { booking: o.bookingId, order: o.id }, 'ORDER_SENT', null, { mode: mode, fired: fire, items: sent }) });
    var kitchen = sent.filter(function (x) { return x.dept === 'KITCHEN'; }).length, bar = sent.length - kitchen;
    return { data: { sent: sent.length, kitchen: kitchen, bar: bar, waiting: sent.filter(function (x) { return x.status === 'WAIT_COURSE'; }).length, firedCourses: fire }, plan: plan,
      audit: { action: 'RS_ORDER_SENT', entity: MC_RS_SH_.ORDERS, id: o.id, after: { mode: mode, items: sent.length, kitchen: kitchen, bar: bar, fired: fire } } };
  });
}
/** «Следующий курс»: запустить курс n — задания «ждёт курса» становятся новыми. {idem, orderId, course} */
function rsCourseFire(json, token) {
  return _rsMutate_(token, 'order_send|order_all', 'RS_COURSE_FIRE', json, function (c) {
    var L = _rsLoadOrder_(c); if (L.fail) return L;
    var n = parseInt(c.d.course, 10), cr = _rsRows_(MC_RS_SH_.COURSES).filter(function (r) { return String(r.OrderID) === L.o.id && parseInt(r['Номер'], 10) === n; })[0];
    if (!cr) return { fail: ['VALIDATION', 'Нет такого курса'] };
    if (String(cr['Статус']) === 'FIRED') return { fail: ['VALIDATION', 'Курс уже запущен'] };
    var now = new Date(), plan = [], x = _rsCopy_(cr); delete x._row; x['Статус'] = 'FIRED'; x['Отправлен'] = now; x['Отправил'] = _rsWho_(c.s); _rsStamp_(x, c.s, c.op, false);
    plan.push({ sheet: MC_RS_SH_.COURSES, row: x });
    var moved = 0;
    _rsRows_(MC_RS_SH_.QUEUE).forEach(function (q) {
      if (String(q.OrderID) !== L.o.id || parseInt(q['Курс'], 10) !== n || String(q['Статус']) !== 'WAIT_COURSE') return;
      var t = _rsCopy_(q); delete t._row; t['Статус'] = 'NEW'; _rsStamp_(t, c.s, c.op, false); plan.push({ sheet: MC_RS_SH_.QUEUE, row: t }); moved++;
    });
    _rsRows_(MC_RS_SH_.ITEMS).forEach(function (r) {
      if (String(r.OrderID) !== L.o.id || parseInt(r['Курс'], 10) !== n || String(r['Статус']) !== 'WAIT_COURSE') return;
      var t = _rsCopy_(r); delete t._row; t['Статус'] = 'SENT'; _rsStamp_(t, c.s, c.op, false); plan.push({ sheet: MC_RS_SH_.ITEMS, row: t });
    });
    plan.push({ sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'COURSE', x.CourseID, { order: L.o.id }, 'COURSE_FIRED', { status: 'WAIT' }, { status: 'FIRED', tickets: moved }) });
    return { data: { course: n, tickets: moved }, plan: plan, audit: { action: 'RS_COURSE_FIRED', entity: MC_RS_SH_.COURSES, id: x.CourseID, after: { tickets: moved } } };
  });
}
/** «Отложить курс»: курс снова ждёт команды, если кухня его задания ещё не приняла. {idem, orderId, course} */
function rsCourseHold(json, token) {
  return _rsMutate_(token, 'order_send|order_all', 'RS_COURSE_HOLD', json, function (c) {
    var L = _rsLoadOrder_(c); if (L.fail) return L;
    var n = parseInt(c.d.course, 10), cr = _rsRows_(MC_RS_SH_.COURSES).filter(function (r) { return String(r.OrderID) === L.o.id && parseInt(r['Номер'], 10) === n; })[0];
    if (!cr) return { fail: ['VALIDATION', 'Нет такого курса'] };
    if (String(cr['Статус']) !== 'FIRED') return { fail: ['VALIDATION', 'Курс и так ждёт команды'] };
    var q = _rsRows_(MC_RS_SH_.QUEUE).filter(function (t) { return String(t.OrderID) === L.o.id && parseInt(t['Курс'], 10) === n && String(t['Статус']) !== 'CANCELLED'; });
    if (q.some(function (t) { return String(t['Статус']) !== 'NEW'; })) return { fail: ['VALIDATION', 'Кухня уже начала этот курс — отложить нельзя'] };
    var plan = [], x = _rsCopy_(cr); delete x._row; x['Статус'] = 'WAIT'; _rsStamp_(x, c.s, c.op, false); plan.push({ sheet: MC_RS_SH_.COURSES, row: x });
    q.forEach(function (t0) { var t = _rsCopy_(t0); delete t._row; t['Статус'] = 'WAIT_COURSE'; _rsStamp_(t, c.s, c.op, false); plan.push({ sheet: MC_RS_SH_.QUEUE, row: t }); });
    _rsRows_(MC_RS_SH_.ITEMS).forEach(function (r) {
      if (String(r.OrderID) !== L.o.id || parseInt(r['Курс'], 10) !== n || String(r['Статус']) !== 'SENT') return;
      var t = _rsCopy_(r); delete t._row; t['Статус'] = 'WAIT_COURSE'; _rsStamp_(t, c.s, c.op, false); plan.push({ sheet: MC_RS_SH_.ITEMS, row: t });
    });
    plan.push({ sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'COURSE', x.CourseID, { order: L.o.id }, 'COURSE_HELD', { status: 'FIRED' }, { status: 'WAIT', tickets: q.length }) });
    return { data: { course: n, tickets: q.length }, plan: plan, audit: { action: 'RS_COURSE_HELD', entity: MC_RS_SH_.COURSES, id: x.CourseID } };
  });
}

/* ---------------- стол, официант, закрытие ---------------- */
/** Перенос на другой стол или другому официанту (право order_all). {idem, orderId, version, tableId?, waiterId?, guests?} */
function rsOrderUpdate(json, token) {
  return _rsMutate_(token, 'order_edit|order_all', 'RS_ORDER_UPDATE', json, function (c) {
    var L = _rsLoadOrder_(c); if (L.fail) return L;
    _rsCheckVersion_(L.row, c.d.version);
    var d = c.d, o = L.o, row = _rsCopy_(L.row), before = { table: o.tableId, waiter: o.waiter, guests: o.guests }, plan = []; delete row._row;
    if ((d.tableId && d.tableId !== o.tableId) || (d.waiterId && d.waiterId !== o.waiterId)) { if (!_mcRbHasExact_(c.s, 'order_all')) return { fail: ['FORBIDDEN', 'Перенос стола и смена официанта — администратор'] }; }
    if (d.tableId && d.tableId !== o.tableId) {
      var t = _rsTablesIdx_()[d.tableId]; if (!t || t.status !== 'ACTIVE' || t.siteId !== o.siteId) return { fail: ['VALIDATION', 'Стол не найден'] };
      if (_rsActiveOrders_(o.siteId)[t.id]) return { fail: ['CONFLICT', 'На столе № ' + t.number + ' открыт другой заказ'] };
      row.TableID = t.id; row.HallID = t.hallId;
      _rsRows_(MC_RS_SH_.QUEUE).forEach(function (q) { if (String(q.OrderID) !== o.id || ['READY', 'ISSUED', 'CANCELLED'].indexOf(String(q['Статус'])) >= 0) return;
        var x = _rsCopy_(q); delete x._row; x.TableID = t.id; x['Стол'] = t.number; _rsStamp_(x, c.s, c.op, false); plan.push({ sheet: MC_RS_SH_.QUEUE, row: x }); });
    }
    if (d.waiterId && d.waiterId !== o.waiterId) {
      var e = null; try { e = JSON.parse(getEmployees()).filter(function (x) { return String(x.id) === String(d.waiterId) && x.active !== false; })[0]; } catch (er) {}
      if (!e) return { fail: ['VALIDATION', 'Официант не найден'] };
      row.WaiterID = String(e.id); row['Официант'] = e.name || e.fullName || '';
    }
    if (d.guests !== undefined) {
      var g = parseInt(d.guests, 10); if (!(g >= 1 && g <= 60)) return { fail: ['VALIDATION', 'Гостей — от 1 до 60'] };
      if (g < o.guests && _rsRows_(MC_RS_SH_.ITEMS).some(function (r) { return String(r.OrderID) === o.id && String(r['Статус']) !== 'CANCELLED' && (parseInt(r['Гость'], 10) || 0) > g; }))
        return { fail: ['VALIDATION', 'У гостей с номером больше ' + g + ' есть позиции — сначала перенесите их'] };
      for (var k = o.guests + 1; k <= g; k++) plan.push({ sheet: MC_RS_SH_.GUESTS, row: _rsStamp_({ GuestID: o.id + '-G' + k, OrderID: o.id, 'Номер': k, 'Метка': '' }, c.s, c.op, true) });
      row['Гостей'] = g;
    }
    if (d.comment !== undefined) row['Комментарий'] = _rsS_(d.comment).slice(0, 300);
    _rsStamp_(row, c.s, c.op, false); plan.unshift({ sheet: MC_RS_SH_.ORDERS, row: row });
    var after = { table: row.TableID, waiter: row['Официант'], guests: row['Гостей'] };
    plan.push({ sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'ORDER', o.id, { booking: o.bookingId, order: o.id }, 'ORDER_UPDATED', before, after) });
    return { data: { order: _rsOrd_(row) }, plan: plan, audit: { action: 'RS_ORDER_UPDATED', entity: MC_RS_SH_.ORDERS, id: o.id, before: before, after: after } };
  });
}
/** Закрыть заказ: всё распределено по счетам и оплачено, ничего не готовится. Бронь — «закрыто». {idem, orderId, version} */
function rsOrderClose(json, token) {
  return _rsMutate_(token, 'order_edit|order_all', 'RS_ORDER_CLOSE', json, function (c) {
    var L = _rsLoadOrder_(c); if (L.fail) return L;
    _rsCheckVersion_(L.row, c.d.version);
    var full = _rsOrderFull_(L.o.id, c.s), live = full.items.filter(function (x) { return x.status !== 'CANCELLED'; });
    if (live.some(function (x) { return x.status === 'DRAFT'; })) return { fail: ['VALIDATION', 'Есть неотправленные позиции — отправьте или отмените'] };
    if (live.some(function (x) { return ['SENT', 'WAIT_COURSE', 'COOKING', 'READY', 'PROBLEM'].indexOf(x.status) >= 0; }) && !(c.d.force && _mcRbHasExact_(c.s, 'order_all')))
      return { fail: ['VALIDATION', 'Есть позиции на кухне, с проблемой или не поданные гостю (закрыть принудительно может администратор)'] };
    if (live.some(function (x) { return x.weighted && x.factAmount === null; })) return { fail: ['VALIDATION', 'Внесите фактический вес весовых блюд'] };
    if (live.length) {
      if (full.unallocated && full.unallocated.length) return { fail: ['VALIDATION', 'Не все позиции распределены по счетам'] };
      if ((full.bills || []).some(function (b) { return b.status === 'OPEN'; })) return { fail: ['VALIDATION', 'Есть неоплаченные счета'] };
    }
    // этап 7: оплаченные счета → журнал продаж J36 (склад не списывается повторно — списан производством)
    var posting = typeof _rsPostSales_ === 'function' ? _rsPostSales_(c, full) : { sales: [], bills: {} };
    var row = _rsCopy_(L.row); delete row._row; row['Статус'] = 'CLOSED'; row['Закрыт'] = new Date(); _rsStamp_(row, c.s, c.op, false);
    var plan = [{ sheet: MC_RS_SH_.ORDERS, row: row }];
    _rsRows_(MC_RS_SH_.BILLS).forEach(function (b) { var ids = posting.bills[String(b.BillID)]; if (!ids) return; var x = _rsCopy_(b); x['Проведено в J36'] = JSON.stringify(ids); _rsStamp_(x, c.s, c.op, false); plan.push({ sheet: MC_RS_SH_.BILLS, row: x }); });
    if (L.o.bookingId) {
      var b = _rsRows_(MC_RS_SH_.BOOKINGS).filter(function (x) { return String(x.BookingID) === L.o.bookingId; })[0];
      if (b && String(b['Статус']) === 'SEATED') { var b2 = _rsCopy_(b); delete b2._row; b2['Статус'] = 'CLOSED'; _rsStamp_(b2, c.s, c.op, false); plan.push({ sheet: MC_RS_SH_.BOOKINGS, row: b2 }); }
    }
    plan.push({ sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'ORDER', L.o.id, { booking: L.o.bookingId, order: L.o.id }, 'ORDER_CLOSED', { status: 'OPEN' }, { status: 'CLOSED', totalKop: full.totalKop, paidKop: full.paidKop }) });
    return { data: { orderId: L.o.id, totalKop: full.totalKop, paidKop: full.paidKop, sales: posting.sales.length }, plan: plan,
      audit: { action: 'RS_ORDER_CLOSED', entity: MC_RS_SH_.ORDERS, id: L.o.id, after: { totalKop: full.totalKop, paidKop: full.paidKop, sales: posting.sales.map(function (x) { return x.saleId; }) } } };
  });
}
/** Отменить заказ (ошибочно открыт): только если ничего не ушло на кухню. Право order_all. {idem, orderId, version, reason} */
function rsOrderCancel(json, token) {
  return _rsMutate_(token, 'order_all', 'RS_ORDER_CANCEL', json, function (c) {
    var L = _rsLoadOrder_(c); if (L.fail) return L;
    _rsCheckVersion_(L.row, c.d.version);
    var reason = _rsS_(c.d.reason).slice(0, 300); if (!reason) return { fail: ['VALIDATION', 'Укажите причину'] };
    var items = _rsRows_(MC_RS_SH_.ITEMS).filter(function (r) { return String(r.OrderID) === L.o.id && String(r['Статус']) !== 'CANCELLED'; });
    if (items.some(function (r) { return String(r['Статус']) !== 'DRAFT'; })) return { fail: ['VALIDATION', 'Позиции уже на кухне — отмените их по одной (с причиной), затем заказ'] };
    var plan = [], row = _rsCopy_(L.row); delete row._row; row['Статус'] = 'CANCELLED'; row['Причина'] = reason; row['Закрыт'] = new Date(); _rsStamp_(row, c.s, c.op, false);
    plan.push({ sheet: MC_RS_SH_.ORDERS, row: row });
    items.forEach(function (r) { var x = _rsCopy_(r); delete x._row; x['Статус'] = 'CANCELLED'; x['Причина отмены'] = 'заказ отменён: ' + reason; _rsStamp_(x, c.s, c.op, false); plan.push({ sheet: MC_RS_SH_.ITEMS, row: x }); });
    if (L.o.bookingId) {
      var b = _rsRows_(MC_RS_SH_.BOOKINGS).filter(function (x) { return String(x.BookingID) === L.o.bookingId; })[0];
      if (b) { var b2 = _rsCopy_(b); delete b2._row; b2.OrderID = ''; if (String(b2['Статус']) === 'SEATED') b2['Статус'] = 'ARRIVED'; _rsStamp_(b2, c.s, c.op, false); plan.push({ sheet: MC_RS_SH_.BOOKINGS, row: b2 }); }
    }
    plan.push({ sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'ORDER', L.o.id, { booking: L.o.bookingId, order: L.o.id }, 'ORDER_CANCELLED', { status: 'OPEN' }, { status: 'CANCELLED', reason: reason }) });
    return { data: { orderId: L.o.id }, plan: plan, audit: { action: 'RS_ORDER_CANCELLED', entity: MC_RS_SH_.ORDERS, id: L.o.id, after: { reason: reason } } };
  });
}
/** Каталог для официанта: блюда с ценой на сегодня и STOP/GO (без себестоимости). */
function rsMenuForOrder(json, token) {
  return _rsRead_(token, 'order_edit|order_all|hall_view', function () {
    var dishes = _rsDishes_(), prices = _rsPriceIdx_(_rsToday_()), stops = _rsStopIdx_();
    return { courses: _rsCourses_(), dishes: Object.keys(dishes).map(function (k) {
      var d = dishes[k], p = prices[k], st = _rsStopOf_(stops, k, d.dept);
      return { code: k, name: d.name, category: d.category, dept: d.dept, yield: d.yield, yunit: d.yunit, priceKop: p ? p.kop : null, priceFor: p ? p.unitText : '',
        weighted: !!(p && p.unit && p.unit.weighted), weightUnit: p && p.unit && p.unit.weighted ? p.unit.dim : '', stop: st.status, left: st.status === 'LIMITED' ? st.left : null };
    }).sort(function (a, b) { return a.category < b.category ? -1 : a.category > b.category ? 1 : (a.name < b.name ? -1 : 1); }) };
  });
}

var MC_GATE_EXT_ = (typeof MC_GATE_EXT_ !== 'undefined' && MC_GATE_EXT_) || {};
MC_GATE_EXT_.rsCoursesSave = { need: 'hall_manage', mut: true };
MC_GATE_EXT_.rsOrderGet = { need: 'hall_view|order_edit|order_all' };
MC_GATE_EXT_.rsOrderList = { need: 'hall_view|order_edit|order_all' };
MC_GATE_EXT_.rsMenuForOrder = { need: 'order_edit|order_all|hall_view' };
MC_GATE_EXT_.rsOrderOpen = { need: 'order_edit|order_all', mut: true };
MC_GATE_EXT_.rsItemAdd = { need: 'order_edit|order_all', mut: true };
MC_GATE_EXT_.rsItemUpdate = { need: 'order_edit|order_all', mut: true };
MC_GATE_EXT_.rsItemWeight = { need: 'order_edit|order_all', mut: true };
MC_GATE_EXT_.rsItemCancel = { need: 'order_edit|order_all', mut: true };
MC_GATE_EXT_.rsOrderSend = { need: 'order_send|order_all', mut: true };
MC_GATE_EXT_.rsCourseFire = { need: 'order_send|order_all', mut: true };
MC_GATE_EXT_.rsCourseHold = { need: 'order_send|order_all', mut: true };
MC_GATE_EXT_.rsOrderUpdate = { need: 'order_edit|order_all', mut: true };
MC_GATE_EXT_.rsOrderClose = { need: 'order_edit|order_all', mut: true };
MC_GATE_EXT_.rsOrderCancel = { need: 'order_all', mut: true };
