/**
 * VINOVNIK — электронное меню для гостей по QR-коду: отдельная публичная страница без входа в систему.
 *
 * Адрес: <адрес веб-приложения>?menu=1 (общий QR) или ?menu=1&t=<стол> (QR на столе). Страница получает только
 * то, что видит гость: позиции «для гостей» с ценой, выходом, описанием, тегами, фото и видео; стоп — «нет в наличии»
 * (или скрыто — настройка), go — «рекомендуем сегодня». Себестоимость, остатки, сотрудники и заказы не передаются.
 * Лента — как в Instagram (истории по разделам, карточки с каруселью фото и видео) и режим Reels (видео на весь
 * экран, листание вверх). Заявка на бронь с этой страницы приходит администратору как «заявка гостя».
 */

function _vnGuestData_(table) {
  var S = _vnSettings_(), SG = _vnStopMap_(), items = [];
  _vnMenu_().forEach(function (m) {
    if (!m.guest || !(m.price > 0)) return;
    var sg = SG[m.code], soldOut = !!(sg && sg.status === 'STOP');
    if (soldOut && S.hideStop) return;
    items.push({ c: m.code, n: m.name, s: m.section, p: m.price, bw: m.byWeight, per: m.per, y: m.yield, yu: m.yieldUnit, d: m.desc, t: m.tags,
      md: (m.media || []).map(function (x) { return { type: x.type, src: x.src, embed: x.embed || '' }; }), out: soldOut, go: !!(sg && sg.status === 'GO') });
  });
  var sections = []; items.forEach(function (i) { if (sections.indexOf(i.s) < 0) sections.push(i.s); });
  var tables = _vnTables_().map(function (t) { return t.table; });
  return { name: S.name, sub: S.subtitle, phone: S.phone, address: S.address, open: S.open, close: S.close, booking: S.guestBooking, bookMin: S.bookDur,
    table: table && tables.indexOf(String(table)) >= 0 ? String(table) : '', items: items, sections: sections, logo: typeof VN_LOGO_ === 'string' ? VN_LOGO_ : '', today: _vnToday_() };
}
/** Страница гостя (doGet → ?menu=1). */
function _vnGuestPage_(params) {
  var data = null;
  try { data = _vnGuestData_(params && params.t); } catch (e) { data = { name: 'VINOVNIK', items: [], sections: [], error: 'Меню временно недоступно. Спросите официанта.' }; try { _log_('WARN', 'меню гостя: ' + e); } catch (x) {} }
  var t = HtmlService.createTemplateFromFile('GuestMenu');
  t.dataJson = JSON.stringify(data).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, function (c) { return c === '\u2028' ? '\\u2028' : '\\u2029'; });
  return t.evaluate().setTitle((data.name || 'VINOVNIK') + ' — меню').addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Заявка на бронь со страницы гостя: {name, phone, date, time, guests, note, table, hp}. Без входа: проверка и ограничение частоты. */
function vnGuestBook(json, did) {
  var d = _vnJ_(json), S = _vnSettings_(), fail = function (m) { return JSON.stringify({ ok: false, error: m }); };
  if (!S.guestBooking) return fail('Бронирование с сайта отключено — позвоните нам' + (S.phone ? ': ' + S.phone : ''));
  if (d.hp) return JSON.stringify({ ok: true, id: '', message: 'Заявка принята' });   // поле-ловушка для роботов
  var name = _vnS_(d.name, 60), phone = _vnS_(d.phone, 24), digits = phone.replace(/\D/g, ''), day = _vnDayOf_(d.date), from = _vnTime_(d.time), guests = parseInt(d.guests, 10);
  if (!name) return fail('Как к вам обращаться?');
  if (digits.length < 10 || digits.length > 15) return fail('Телефон — чтобы мы подтвердили бронь');
  if (!day || day < _vnToday_()) return fail('Выберите дату — сегодня или позже');
  var lim = new Date(_mcNow_().getTime() + 60 * 864e5); if (day > _vnYmd_(lim)) return fail('Бронь — не дальше чем на 60 дней вперёд');
  if (!from) return fail('Укажите время');
  var o = _vnMin_(S.open), c = _vnMin_(S.close), t = _vnMin_(from); if (c <= o) c += 1440; var tt = t < o ? t + 1440 : t;
  if (tt < o || tt > c - 30) return fail('Мы принимаем гостей с ' + S.open + ' до ' + S.close);
  if (day === _vnToday_() && t < _vnMin_(_vnHm_(_mcNow_()))) return fail('Это время сегодня уже прошло');
  if (!(guests >= 1 && guests <= 30)) return fail('Гостей — от 1 до 30; для банкета позвоните нам');
  var cache = null; try { cache = CacheService.getScriptCache(); } catch (e) {}
  var key = 'vn_gb_' + String(did || 'anon').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40), key2 = 'vn_gb_all_' + Utilities.formatDate(new Date(), _mcTz_(), 'yyyyMMddHH');
  if (cache) {
    var n1 = parseInt(cache.get(key) || '0', 10), n2 = parseInt(cache.get(key2) || '0', 10);
    if (n1 >= 3) return fail('Заявки уже отправлены — мы перезвоним. Если срочно, позвоните нам' + (S.phone ? ': ' + S.phone : ''));
    if (n2 >= 60) return fail('Сейчас много заявок — позвоните нам' + (S.phone ? ': ' + S.phone : ''));
  }
  var id = _withLock_(function () {
    var dup = _vnBookings_(day).filter(function (b) { return b.status === 'REQUEST' && b.phone.replace(/\D/g, '') === digits && b.from === from; })[0];
    if (dup) return dup.id;
    var nid = _vnId_('БР'), table = _vnS_(d.table, 12);
    _vnAppend_('BOOK', { ID: nid, 'Дата': day, 'С': from, 'До': _vnAddMin_(from, S.bookDur), 'Гость': name, 'Телефон': phone, 'Гостей': guests, 'Столы': '', 'Статус': 'REQUEST',
      'Источник': 'QR-меню' + (table ? ' (стол ' + table + ')' : ''), 'Комментарий': _vnS_(d.note, 300), 'Создал': 'гость', 'Создано': new Date() });
    try { var op = _createOperation_('VN_GUEST_BOOK', null, nid); _audit_(op, 'VN_GUEST_BOOK', 'Бронь', nid, null, { дата: day, время: from, гостей: guests, источник: 'QR-меню' }); _closeOperation_(op.id, 'COMPLETED'); } catch (e) {}
    return nid;
  });
  if (cache) { try { cache.put(key, String((parseInt(cache.get(key) || '0', 10) || 0) + 1), 600); cache.put(key2, String((parseInt(cache.get(key2) || '0', 10) || 0) + 1), 3600); } catch (e) {} }
  return JSON.stringify({ ok: true, id: id, message: 'Заявка принята. Мы позвоним по номеру ' + phone + ', чтобы подтвердить бронь.' });
}
