/**
 * VINOVNIK — зал ресторана поверх MON CHEF: столы и бронирование, электронное меню для гостей, стоп/go-лист.
 * Блокнот официанта и очереди кухни и бара — Vinovnik_Orders.gs; «Моя смена» по зонам и раздел «Зал» —
 * Vinovnik_Shift.gs; страница меню для гостей по QR-коду — Vinovnik_Guest.gs и GuestMenu.html.
 *
 * Файлы Vinovnik_* загружаются после модулей MON CHEF (порядок установщика — по имени) и до шлюза
 * zzz_MonChef_Gate.gs: права, роли, разделы и функции регистрируются здесь, шлюз подхватывает список MC_VN_GATE_.
 *
 * Контур зала:
 *   бронь (телефон, QR-заявка гостя, вживую) → гости пришли → заказ стола (блокнот официанта: кол-во, курс,
 *   вес, гость, комментарий) → кухня и бар получают позиции по курсам → «готово» → «подано» → закрытие счёта →
 *   каждая позиция — продажа MON CHEF (журнал J36, списание склада по партиям FEFO, экономика V64).
 * Стоп/go-лист: стоп — позиции нет (вручную или по складу), лимит — осталось N порций (списывается заказами),
 * go — предложить в первую очередь (вручную или по партиям с подходящим сроком, go-лист V88).
 */

var MC_VN_ = {
  TABLES: 'VN_Столы', BOOK: 'VN_Брони', MENU: 'VN_Меню', STOP: 'VN_СтопGo', ORD: 'VN_Заказы', LINES: 'VN_Заказ_Строки'
};
var MC_VN_HEAD_ = {
  TABLES: ['Стол', 'Зал', 'Мест', 'Активен', 'Комментарий', 'Обновлено', 'Кто'],
  BOOK: ['ID', 'Дата', 'С', 'До', 'Гость', 'Телефон', 'Гостей', 'Столы', 'Статус', 'Источник', 'Депозит, ₽', 'Повод', 'Комментарий',
    'Создал', 'Создано', 'Изменил', 'Изменено', 'Заказ', 'Причина'],
  MENU: ['Код', 'Позиция', 'Вид', 'Раздел', 'Станция', 'Цена, ₽', 'Выход', 'Ед. выхода', 'По весу', 'Цена за, г', 'Описание', 'Теги',
    'Медиа (JSON)', 'Порядок', 'Для гостей', 'Обновлено', 'Кто'],
  STOP: ['ID', 'Код', 'Позиция', 'Станция', 'Статус', 'Остаток, порц.', 'Причина', 'Кто', 'С', 'До', 'Активен', 'Снял', 'Снято'],
  ORD: ['Заказ', 'Дата', 'Стол', 'Гостей', 'Официант', 'Бронь', 'Открыт', 'Статус', 'Подан курс', 'Закрыт', 'Сумма, ₽', 'Скидка, %',
    'Скидка, ₽', 'К оплате, ₽', 'Оплата', 'Чек', 'Комментарий', 'Продажи (JSON)', 'Закрыл', 'Себестоимость, ₽'],
  LINES: ['Строка', 'Заказ', 'Стол', 'Гость', 'Код', 'Позиция', 'Станция', 'Кол-во', 'Вес', 'Ед. веса', 'Курс', 'Комментарий',
    'Цена, ₽', 'Сумма, ₽', 'Статус', 'Создано', 'Официант', 'Отправлено', 'Готово', 'Подано', 'Кто готовил', 'Отмена: причина', 'Продажа']
};
var MC_VN_BOOK_ST_ = { REQUEST: 'заявка гостя', CONFIRMED: 'подтверждена', SEATED: 'гости в зале', DONE: 'завершена', NOSHOW: 'не пришли', CANCELLED: 'отменена' };
var MC_VN_LINE_ST_ = { HOLD: 'ждёт курса', SENT: 'готовится', READY: 'готово — подать', SERVED: 'подано', VOID: 'отменено' };
var MC_VN_STOP_ST_ = { STOP: 'стоп', LIMIT: 'лимит', GO: 'go' };
var MC_VN_STATIONS_ = { KITCHEN: 'Кухня', BAR: 'Бар' };
var MC_VN_COURSES_ = [[0, 'Сразу'], [1, 'Курс 1 — закуски, салаты'], [2, 'Курс 2 — супы, горячие закуски'], [3, 'Курс 3 — горячее'], [4, 'Курс 4 — десерт'], [5, 'По команде гостя']];
var MC_VN_PAY_ = [['CARD', 'Карта'], ['CASH', 'Наличные'], ['SBP', 'СБП'], ['MIXED', 'Смешанная'], ['STAFF', 'Персонал / за счёт заведения']];
var MC_VN_BAR_RE_ = /напит|бар|коктейл|вин[оа]|игрист|шампан|пиво|сидр|виски|коньяк|водк|ром\b|джин|текил|ликёр|ликер|настойк|кофе|чай|сок|лимонад|морс|вода|смузи|молочн.*коктейл|какао|эспрессо|капучино|латте/i;

/** Функции зала для шлюза (zzz_MonChef_Gate.gs): [право, записывает?, запрещено техническому входу?]. */
var MC_VN_GATE_ = {
  vnHallData: ['hall|hall_manage|booking|bar|stoplist|guestmenu|kanban|prod_manage', false],
  vnTableSave: ['hall_manage', true],
  vnBookingSave: ['booking|hall_manage', true, true],
  vnBookingStatus: ['booking|hall_manage|hall', true, true],
  vnMenuData: ['guestmenu|hall|hall_manage|stoplist|bar|kanban|prod_manage', false],
  vnMenuSave: ['guestmenu', true],
  vnMenuSync: ['guestmenu', true],
  vnMediaAdd: ['guestmenu', true],
  vnMediaUpload: ['guestmenu', true],
  vnMediaRemove: ['guestmenu', true],
  vnStopSave: ['stoplist|hall_manage', true],
  vnStopClear: ['stoplist|hall_manage', true],
  vnStopSuggest: ['stoplist|hall_manage|guestmenu', false],
  vnOrderOpen: ['hall|hall_manage', true, true],
  vnOrderAdd: ['hall|hall_manage', true, true],
  vnOrderFire: ['hall|hall_manage', true, true],
  vnLineStatus: ['hall|hall_manage|bar|kanban|prod_manage', true, true],
  vnOrderClose: ['hall|hall_manage', true, true],
  vnOrderCancel: ['hall_manage', true, true],
  vnOrderData: ['hall|hall_manage', false],
  vnQueueData: ['kanban|prod_manage|bar|hall_manage', false],
  vnShiftData: ['*', false],
  vnQrData: ['guestmenu|hall_manage', false],
  vnSettings: ['guestmenu|hall_manage', true]
};
/** Публичные функции (страница гостя, без входа). Проверяют ввод и ограничивают частоту сами. */
var MC_VN_PUBLIC_ = ['vnGuestBook'];

// Роли, права, разделы и экраны зала (файл идёт после MonChef_Rbac.gs, MonChef_UI*.gs и MonChef_Compliance.gs)
(function () {
  if (typeof MC_RB_PERMS_ === 'undefined') return;
  var has = function (k) { return MC_RB_PERMS_.some(function (x) { return x[0] === k; }); };
  [['hall', 'Зал: свои столы и заказы (блокнот официанта), подача курсов, закрытие счёта', 'Зал'],
   ['hall_manage', 'Зал полностью: все заказы, отмена позиций после отправки, столы, скидки', 'Зал'],
   ['booking', 'Бронирование столов: создание, подтверждение заявок гостей, рассадка', 'Зал'],
   ['bar', 'Бар: очередь бара, отметка «готово»', 'Зал'],
   ['stoplist', 'Стоп/go-лист: ставить и снимать позиции', 'Зал'],
   ['guestmenu', 'Электронное меню для гостей: позиции, цены, фото и видео, QR-коды', 'Зал']]
    .forEach(function (p) { if (!has(p[0])) MC_RB_PERMS_.push(p); });
  ['Официант', 'Бармен', 'Хостес'].forEach(function (r) { if (MC_RB_ROLES_.indexOf(r) < 0) MC_RB_ROLES_.push(r); });
  MC_RB_MATRIX_['Официант'] = MC_RB_MATRIX_['Официант'] || ['hall', 'catalog'];
  MC_RB_MATRIX_['Бармен'] = MC_RB_MATRIX_['Бармен'] || ['bar', 'hall', 'stoplist', 'catalog', 'stock_view'];
  MC_RB_MATRIX_['Хостес'] = MC_RB_MATRIX_['Хостес'] || ['booking'];
  var give = function (role, list) { var m = MC_RB_MATRIX_[role]; if (!m) return; list.forEach(function (k) { if (m.indexOf(k) < 0) m.push(k); }); };
  give('Директор', ['hall', 'hall_manage', 'booking', 'bar', 'stoplist', 'guestmenu']);
  give('Администратор', ['hall', 'hall_manage', 'booking', 'bar', 'stoplist', 'guestmenu', 'catalog']);
  give('Шеф-повар', ['stoplist', 'guestmenu']);
  give('Су-шеф', ['stoplist', 'guestmenu']);
  // санитарные требования к персоналу, который работает с пищей: официант подаёт, бармен готовит напитки
  if (typeof MC_FOOD_ROLES_ !== 'undefined') ['Официант', 'Бармен'].forEach(function (r) { if (MC_FOOD_ROLES_.indexOf(r) < 0) MC_FOOD_ROLES_.push(r); });
  if (typeof MC_GATE_MED_PERMS_ !== 'undefined') ['hall', 'bar'].forEach(function (k) { if (MC_GATE_MED_PERMS_.indexOf(k) < 0) MC_GATE_MED_PERMS_.push(k); });
  if (typeof MC_RB_GRANTABLE_ !== 'undefined') { MC_RB_GRANTABLE_.booking = ['Официант', 'Бармен']; MC_RB_GRANTABLE_.stoplist = ['Повар холодного цеха', 'Повар горячего цеха', 'Кондитер']; MC_RB_GRANTABLE_.hall_manage = ['Официант']; }
  MC_RB_SECTIONS_.hall = 'hall|hall_manage|booking|bar|stoplist|guestmenu';
  var mods = { vnhall: 'hall|hall_manage', vnkitchen: 'kanban|prod_manage', vnbar: 'bar|hall_manage', vnbook: 'booking|hall_manage|hall', vnfloor: 'hall|hall_manage|booking',
    vnorder: 'hall|hall_manage', vnstop: 'stoplist|hall_manage|hall|bar|kanban|prod_manage', vnmenu: 'guestmenu', vnqr: 'guestmenu|hall_manage' };
  var ru = { vnhall: 'Моя смена — Зал', vnkitchen: 'Моя смена — Кухня', vnbar: 'Моя смена — Бар', vnbook: 'Бронирование столов', vnfloor: 'План зала',
    vnorder: 'Блокнот официанта', vnstop: 'Стоп/go-лист', vnmenu: 'Электронное меню', vnqr: 'QR-коды меню' };
  Object.keys(mods).forEach(function (k) { MC_RB_MODULES_[k] = mods[k]; if (typeof MC_RB_MODULE_RU_ !== 'undefined') MC_RB_MODULE_RU_[k] = ru[k]; });
  // журнал продаж J36: строку закрытого счёта пишет официант (право «Зал»)
  if (typeof MC_RB_JOURNAL_ROLES_ !== 'undefined' && MC_RB_JOURNAL_ROLES_.J36 && MC_RB_JOURNAL_ROLES_.J36.indexOf('+hall') < 0) MC_RB_JOURNAL_ROLES_.J36 += ' +hall';
  if (typeof UI_SECTIONS !== 'undefined' && UI_SECTIONS.indexOf('hall') < 0) UI_SECTIONS.splice(1, 0, 'hall');
  if (typeof MC_UI_VIEWS_ !== 'undefined') MC_UI_VIEWS_ = MC_UI_VIEWS_.concat(Object.keys(mods).filter(function (v) { return MC_UI_VIEWS_.indexOf(v) < 0; }));
})();

/* --------------------------------------------------------------- общие помощники ---- */

function _vnSheet_(key) {
  var name = MC_VN_[key], head = MC_VN_HEAD_[key], sh = _bcSheet_(name, head);
  try { var w = sh.getLastColumn(); if (w > 0 && w < head.length) sh.getRange(1, w + 1, 1, head.length - w).setValues([head.slice(w)]).setFontWeight('bold'); } catch (e) {}
  return sh;
}
/** Строки листа как объекты {_r: номер строки, <заголовок>: значение}. */
function _vnRows_(key) {
  var sh = _vnSheet_(key), head = MC_VN_HEAD_[key], n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, head.length).getValues().map(function (r, i) {
    var o = { _r: i + 2 }; head.forEach(function (h, j) { o[h] = r[j]; }); return o;
  }).filter(function (o) { return String(o[head[0]] || '') !== ''; });
}
function _vnAppend_(key, obj) {
  var sh = _vnSheet_(key), head = MC_VN_HEAD_[key];
  sh.appendRow(head.map(function (h) { var v = obj[h]; return v === undefined || v === null ? '' : v; }));
  return sh.getLastRow();
}
function _vnSet_(key, row, obj) {
  var sh = _vnSheet_(key), head = MC_VN_HEAD_[key];
  Object.keys(obj).forEach(function (h) { var j = head.indexOf(h); if (j >= 0) sh.getRange(row, j + 1).setValue(obj[h] === undefined || obj[h] === null ? '' : obj[h]); });
}
function _vnJ_(x) { if (x && typeof x === 'object') return x; try { return JSON.parse(String(x || '{}')) || {}; } catch (e) { return {}; } }
function _vnS_(x, max) { return String(x === null || x === undefined ? '' : x).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max || 300); }
function _vnN_(x) { var n = parseFloat(String(x === null || x === undefined ? '' : x).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : NaN; }
function _vnR2_(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function _vnYmd_(d) { return Utilities.formatDate(d, _mcTz_(), 'yyyy-MM-dd'); }
function _vnToday_() { return _vnYmd_(_mcNow_()); }
function _vnHm_(d) { return Utilities.formatDate(d, _mcTz_(), 'HH:mm'); }
function _vnDayOf_(x) {
  if (x instanceof Date && !isNaN(x.getTime())) return _vnYmd_(x);
  var s = String(x || '').trim(), m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return m[0];
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s); if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return '';
}
function _vnTime_(x) {
  if (x instanceof Date && !isNaN(x.getTime())) return _vnHm_(x);
  var m = /^\s*(\d{1,2})[:.](\d{2})/.exec(String(x || '')); if (!m || +m[1] > 23 || +m[2] > 59) return '';
  return ('0' + m[1]).slice(-2) + ':' + m[2];
}
function _vnMin_(hm) { var m = /^(\d{2}):(\d{2})$/.exec(String(hm || '')); return m ? +m[1] * 60 + +m[2] : null; }
function _vnId_(p) { return p + '-' + Utilities.formatDate(new Date(), _mcTz_(), 'yyMMdd') + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase(); }
function _vnWho_(op) { try { return _author_(op).фио || ''; } catch (e) { return ''; } }
function _vnProp_(k, d) { try { var v = PropertiesService.getScriptProperties().getProperty(k); return v === null || v === undefined || v === '' ? d : v; } catch (e) { return d; } }
function _vnBool_(x) { return x === true || /^(true|да|1|yes|on)$/i.test(String(x || '').trim()); }
function _vnSettings_() {
  return { name: _vnProp_('VN_NAME', 'VINOVNIK'), subtitle: _vnProp_('VN_SUBTITLE', 'NOVITSKY'), bookDur: parseInt(_vnProp_('VN_BOOK_MIN', '120'), 10) || 120,
    guestBooking: _vnProp_('VN_GUEST_BOOKING', '1') !== '0', hideStop: _vnProp_('VN_HIDE_STOP', '0') === '1', open: _vnProp_('VN_OPEN', '12:00'), close: _vnProp_('VN_CLOSE', '23:00'),
    phone: _vnProp_('VN_PHONE', ''), address: _vnProp_('VN_ADDRESS', ''), serviceTime: parseInt(_vnProp_('VN_COOK_MIN', '20'), 10) || 20 };
}
/** Операция с правом; техническому входу записи зала не делать (шлюз тоже проверяет). */
function _vnOp_(token, perm, type, entityId, write) {
  var op = _beginOp_(token, perm, type, 'Зал', entityId || null, null);
  if (write && op.session && op.session.dev) { _endOp_(op, 'FAILED'); throw new Error('FORBIDDEN: технический вход записи зала не делает — войдите по ПИН сотрудника'); }
  return op;
}
function _vnHas_(op, perm) { return !!(op && op.session && _mcRbHasExact_(op.session, perm)); }
function _vnRun_(token, perm, type, write, fn) {
  var op = null;
  try { op = _vnOp_(token, perm, type, null, write); } catch (e) { return _failFrom_(e); }
  try { var res = fn(op); _endOp_(op); return _ok_(res, op.id); }
  catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function _vnFail_(msg) { throw new Error('VALIDATION: ' + msg); }

/* --------------------------------------------------------------- столы ---- */

function _vnTables_() {
  return _vnRows_('TABLES').filter(function (t) { return t['Активен'] !== false && String(t['Активен']).toLowerCase() !== 'нет'; })
    .map(function (t) { return { table: String(t['Стол']), zone: String(t['Зал'] || 'Зал'), seats: Number(t['Мест']) || 2, note: String(t['Комментарий'] || '') }; })
    .sort(function (a, b) { return a.zone.localeCompare(b.zone) || (parseFloat(a.table) - parseFloat(b.table)) || a.table.localeCompare(b.table); });
}
/** Стол: {table, zone, seats, note, active}. Новый — добавляется, существующий — обновляется. */
function vnTableSave(json, token) {
  return _vnRun_(token, 'hall_manage', 'VN_TABLE', true, function (op) {
    var d = _vnJ_(json), L = Array.isArray(d.tables) ? d.tables : [d], out = [];
    return _withLock_(function () {
      var rows = _vnRows_('TABLES');
      L.forEach(function (t) {
        var no = _vnS_(t.table, 12); if (!no) _vnFail_('Укажите номер стола');
        var seats = parseInt(t.seats, 10); if (!(seats >= 1 && seats <= 50)) _vnFail_('Стол ' + no + ': мест от 1 до 50');
        var rec = { 'Стол': no, 'Зал': _vnS_(t.zone, 40) || 'Зал', 'Мест': seats, 'Активен': t.active === false ? 'нет' : 'да', 'Комментарий': _vnS_(t.note, 120), 'Обновлено': new Date(), 'Кто': _vnWho_(op) };
        var ex = rows.filter(function (r) { return String(r['Стол']) === no; })[0];
        if (ex) _vnSet_('TABLES', ex._r, rec); else _vnAppend_('TABLES', rec);
        out.push(no);
      });
      _audit_(op, 'VN_TABLE', 'Зал', out.join(','), null, { столы: out });
      return { saved: out, tables: _vnTables_() };
    });
  });
}

/* --------------------------------------------------------------- бронирование ---- */

function _vnBookObj_(b) {
  var st = String(b['Статус'] || 'CONFIRMED');
  return { id: String(b.ID), date: _vnDayOf_(b['Дата']), from: _vnTime_(b['С']), to: _vnTime_(b['До']), guest: String(b['Гость'] || ''), phone: String(b['Телефон'] || ''),
    guests: Number(b['Гостей']) || 0, tables: String(b['Столы'] || '').split(/[,;\s]+/).filter(Boolean), status: st, statusRu: MC_VN_BOOK_ST_[st] || st,
    source: String(b['Источник'] || ''), deposit: Number(b['Депозит, ₽']) || 0, occasion: String(b['Повод'] || ''), note: String(b['Комментарий'] || ''),
    by: String(b['Создал'] || ''), order: String(b['Заказ'] || ''), reason: String(b['Причина'] || ''), _r: b._r };
}
function _vnBookings_(day) {
  return _vnRows_('BOOK').map(_vnBookObj_).filter(function (b) { return !day || b.date === day; })
    .sort(function (a, b) { return (a.date + a.from).localeCompare(b.date + b.from); });
}
function _vnActiveBook_(b) { return b.status === 'CONFIRMED' || b.status === 'SEATED' || b.status === 'REQUEST'; }
/** Пересечение брони с другими на тех же столах (заявки гостей без стола не мешают). */
function _vnConflicts_(B, day, from, to, tables, exceptId) {
  var a0 = _vnMin_(from), a1 = _vnMin_(to); if (a1 <= a0) a1 += 24 * 60;
  return B.filter(function (b) {
    if (b.id === exceptId || b.date !== day || !(b.status === 'CONFIRMED' || b.status === 'SEATED')) return false;
    if (!b.tables.some(function (t) { return tables.indexOf(t) >= 0; })) return false;
    var b0 = _vnMin_(b.from), b1 = _vnMin_(b.to); if (b1 <= b0) b1 += 24 * 60;
    return a0 < b1 && b0 < a1;
  });
}
/** Свободные столы на время: подходящие по местам — первыми. */
function _vnFreeTables_(day, from, to, guests, exceptId) {
  var B = _vnBookings_(day), T = _vnTables_();
  return T.filter(function (t) { return !_vnConflicts_(B, day, from, to, [t.table], exceptId).length; })
    .map(function (t) { t.fits = t.seats >= (guests || 1); return t; })
    .sort(function (a, b) { return (b.fits - a.fits) || (a.seats - b.seats); });
}
function _vnAddMin_(hm, min) { var m = _vnMin_(hm) + min; m = ((m % 1440) + 1440) % 1440; return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); }

/** Бронь: {id?, date, from, to?|minutes?, guest, phone, guests, tables[], source, deposit, occasion, note, status?}. */
function vnBookingSave(json, token) {
  return _vnRun_(token, 'booking|hall_manage', 'VN_BOOKING', true, function (op) {
    var d = _vnJ_(json), S = _vnSettings_();
    var day = _vnDayOf_(d.date), from = _vnTime_(d.from); if (!day) _vnFail_('Укажите дату брони'); if (!from) _vnFail_('Время — ЧЧ:ММ');
    if (day < _vnToday_() && !d.id) _vnFail_('Дата брони уже прошла');
    var to = _vnTime_(d.to) || _vnAddMin_(from, parseInt(d.minutes, 10) > 0 ? parseInt(d.minutes, 10) : S.bookDur);
    var guest = _vnS_(d.guest, 80), phone = _vnS_(d.phone, 30), guests = parseInt(d.guests, 10);
    if (!guest) _vnFail_('Как зовут гостя'); if (!/\d{5,}/.test(phone.replace(/\D/g, ''))) _vnFail_('Телефон гостя — для подтверждения и связи');
    if (!(guests >= 1 && guests <= 200)) _vnFail_('Гостей — от 1');
    var tables = (Array.isArray(d.tables) ? d.tables : String(d.tables || '').split(/[,;\s]+/)).map(function (x) { return _vnS_(x, 12); }).filter(Boolean);
    var T = _vnTables_(), known = T.map(function (t) { return t.table; });
    tables.forEach(function (t) { if (known.indexOf(t) < 0) _vnFail_('Стола ' + t + ' нет в плане зала'); });
    var status = d.status && MC_VN_BOOK_ST_[d.status] ? d.status : (tables.length ? 'CONFIRMED' : 'REQUEST');
    if (status === 'CONFIRMED' && !tables.length) _vnFail_('Выберите стол — подтверждённая бронь занимает стол');
    var seats = T.filter(function (t) { return tables.indexOf(t.table) >= 0; }).reduce(function (a, t) { return a + t.seats; }, 0);
    return _withLock_(function () {
      var B = _vnBookings_(), ex = d.id ? B.filter(function (b) { return b.id === String(d.id); })[0] : null;
      if (d.id && !ex) throw new Error('NOT_FOUND: бронь ' + d.id + ' не найдена');
      if (status === 'CONFIRMED' || status === 'SEATED') {
        var c = _vnConflicts_(B, day, from, to, tables, ex && ex.id);
        if (c.length) _vnFail_('Стол занят: ' + c.map(function (b) { return 'бронь ' + b.from + '–' + b.to + ' (' + b.guest + ', стол ' + b.tables.join(', ') + ')'; }).join('; ') + '. Выберите другой стол или время.');
      }
      var rec = { 'Дата': day, 'С': from, 'До': to, 'Гость': guest, 'Телефон': phone, 'Гостей': guests, 'Столы': tables.join(', '), 'Статус': status,
        'Источник': _vnS_(d.source, 30) || 'телефон', 'Депозит, ₽': _vnN_(d.deposit) > 0 ? _vnR2_(_vnN_(d.deposit)) : '', 'Повод': _vnS_(d.occasion, 80), 'Комментарий': _vnS_(d.note, 300),
        'Изменил': _vnWho_(op), 'Изменено': new Date() };
      var id;
      if (ex) { id = ex.id; _vnSet_('BOOK', ex._r, rec); }
      else { id = _vnId_('БР'); rec.ID = id; rec['Создал'] = _vnWho_(op); rec['Создано'] = new Date(); _vnAppend_('BOOK', rec); }
      _audit_(op, ex ? 'VN_BOOKING_EDIT' : 'VN_BOOKING', 'Бронь', id, ex ? { статус: ex.status, столы: ex.tables.join(',') } : null, { дата: day, время: from + '–' + to, гостей: guests, столы: tables.join(','), статус: status });
      return { id: id, status: status, statusRu: MC_VN_BOOK_ST_[status], seatsWarn: tables.length && seats < guests ? 'Мест за столами ' + seats + ', гостей ' + guests + ' — добавьте стол' : '' };
    });
  });
}
/** Статус брони: {id, status: CONFIRMED|SEATED|DONE|NOSHOW|CANCELLED, reason, tables?, waiter?}. «Гости пришли» открывает заказ стола. */
function vnBookingStatus(json, token) {
  return _vnRun_(token, 'booking|hall_manage|hall', 'VN_BOOKING_STATUS', true, function (op) {
    var d = _vnJ_(json), st = String(d.status || '');
    if (!MC_VN_BOOK_ST_[st] || st === 'REQUEST') _vnFail_('Неизвестный статус брони');
    if (!_vnHas_(op, 'booking|hall_manage') && st !== 'SEATED') throw new Error('FORBIDDEN: официант отмечает только «гости пришли»');
    if ((st === 'CANCELLED' || st === 'NOSHOW') && !_vnS_(d.reason)) _vnFail_('Укажите причину');
    return _withLock_(function () {
      var B = _vnBookings_(), b = B.filter(function (x) { return x.id === String(d.id); })[0];
      if (!b) throw new Error('NOT_FOUND: бронь не найдена');
      var tables = d.tables ? (Array.isArray(d.tables) ? d.tables : String(d.tables).split(/[,;\s]+/)).map(function (x) { return _vnS_(x, 12); }).filter(Boolean) : b.tables;
      if ((st === 'CONFIRMED' || st === 'SEATED') && !tables.length) _vnFail_('Выберите стол для брони');
      if (st === 'CONFIRMED' || st === 'SEATED') {
        var c = _vnConflicts_(B, b.date, b.from, b.to, tables, b.id);
        if (c.length) _vnFail_('Стол занят: ' + c.map(function (x) { return x.from + '–' + x.to + ' ' + x.guest; }).join('; '));
      }
      var rec = { 'Статус': st, 'Столы': tables.join(', '), 'Изменил': _vnWho_(op), 'Изменено': new Date() };
      if (d.reason) rec['Причина'] = _vnS_(d.reason, 200);
      var order = null;
      if (st === 'SEATED') {
        order = _vnOpenOrder_(op, { table: tables[0], guests: b.guests, booking: b.id, waiter: d.waiter });
        rec['Заказ'] = order.id;
      }
      _vnSet_('BOOK', b._r, rec);
      _audit_(op, 'VN_BOOKING_' + st, 'Бронь', b.id, { статус: b.status }, { статус: st, причина: d.reason || '', заказ: order ? order.id : '' });
      return { id: b.id, status: st, statusRu: MC_VN_BOOK_ST_[st], order: order };
    });
  });
}

/* --------------------------------------------------------------- меню зала и гостей ---- */

function _vnMenuObj_(m) {
  var media = []; try { media = JSON.parse(String(m['Медиа (JSON)'] || '[]')) || []; } catch (e) { media = []; }
  return { code: String(m['Код']), name: String(m['Позиция'] || ''), kind: String(m['Вид'] || 'DISH'), section: String(m['Раздел'] || 'Меню'),
    station: String(m['Станция'] || 'Кухня'), price: Number(m['Цена, ₽']) || 0, yield: Number(m['Выход']) || 0, yieldUnit: String(m['Ед. выхода'] || 'г'),
    byWeight: _vnBool_(m['По весу']), per: Number(m['Цена за, г']) || 100, desc: String(m['Описание'] || ''), tags: String(m['Теги'] || '').split(/\s*,\s*/).filter(Boolean),
    media: media, order: Number(m['Порядок']) || 999, guest: m['Для гостей'] === '' ? true : _vnBool_(m['Для гостей']), _r: m._r };
}
function _vnMenu_() {
  return _vnRows_('MENU').map(_vnMenuObj_).sort(function (a, b) { return a.section.localeCompare(b.section) || (a.order - b.order) || a.name.localeCompare(b.name); });
}
function _vnStationOf_(name, cat) { return MC_VN_BAR_RE_.test(String(cat || '')) || (!cat && MC_VN_BAR_RE_.test(String(name || ''))) ? 'Бар' : 'Кухня'; }
/** Последняя цена продажи по журналу (если прайса нет) — тот же источник, что go-лист V88. */
function _vnLastPrices_() { try { return typeof _v88LastPrice_ === 'function' ? _v88LastPrice_() : {}; } catch (e) { return {}; } }

/** Электронное меню: позиции, разделы, станции, стоп/go. Для редактора — и блюда ТТК, которых нет в меню. */
function vnMenuData(token) {
  return _vnRun_(token, 'guestmenu|hall|hall_manage|stoplist|bar|kanban|prod_manage', 'VN_MENU_VIEW', false, function (op) {
    var M = _vnMenu_(), SG = _vnStopMap_(), canEdit = _vnHas_(op, 'guestmenu'), add = [];
    if (canEdit) {
      var have = {}; M.forEach(function (m) { have[m.code] = true; });
      var idx = _buildDishIndexes_(), lp = _vnLastPrices_();
      Object.keys(idx.dishByCode).forEach(function (c) {
        var d = idx.dishByCode[c]; if (d.semi || have[c]) return;
        var p = lp[_normNameServer_(d.name)];
        add.push({ code: String(c), name: String(d.name), section: String(d.cat || 'Меню'), station: _vnStationOf_(d.name, d.cat), yield: d.yieldBase || d.yield || 0, yieldUnit: d.yieldUnit || 'г', price: p ? p.price : 0 });
      });
    }
    return { items: M.map(function (m) { var s = SG[m.code]; m.stop = s ? { status: s.status, statusRu: MC_VN_STOP_ST_[s.status], left: s.left, reason: s.reason } : null; delete m._r; return m; }),
      sections: M.reduce(function (a, m) { if (a.indexOf(m.section) < 0) a.push(m.section); return a; }, []), notInMenu: add, canEdit: canEdit, settings: _vnSettings_(),
      courses: MC_VN_COURSES_, stations: ['Кухня', 'Бар'] };
  });
}
/** Сохранить позиции меню: {items:[{code, name?, kind?, section, station, price, yield, yieldUnit, byWeight, per, desc, tags, order, guest}]}. */
function vnMenuSave(json, token) {
  return _vnRun_(token, 'guestmenu', 'VN_MENU_SAVE', true, function (op) {
    var d = _vnJ_(json), L = Array.isArray(d.items) ? d.items : [];
    if (!L.length) _vnFail_('Нет позиций для сохранения');
    return _withLock_(function () {
      var M = {}; _vnMenu_().forEach(function (m) { M[m.code] = m; });
      var idx = null, saved = 0, added = 0;
      L.forEach(function (x) {
        var code = _vnS_(x.code, 40), ex = M[code];
        if (!code) _vnFail_('У позиции нет кода');
        var price = _vnN_(x.price); if (x.price !== undefined && !(price >= 0)) _vnFail_('Цена «' + (x.name || code) + '» — число');
        var rec = {};
        if (!ex) {
          idx = idx || _buildDishIndexes_();
          var dish = idx.dishByCode[code], kind = x.kind === 'GOODS' || !dish ? 'GOODS' : 'DISH', name = _vnS_(x.name, 120) || (dish && dish.name) || '';
          if (!name) _vnFail_('Укажите название позиции ' + code);
          if (dish && dish.semi) _vnFail_('«' + dish.name + '» — полуфабрикат: в меню гостей не выводится');
          if (kind === 'GOODS' && typeof _v71Resolve_ === 'function') { var g = _v71Resolve_(name, 'goods', ''); if (g.error) _vnFail_(g.error); name = g.name; }
          rec = { 'Код': code, 'Позиция': name, 'Вид': kind, 'Раздел': _vnS_(x.section, 60) || (dish && dish.cat) || 'Меню', 'Станция': x.station === 'Бар' || x.station === 'Кухня' ? x.station : _vnStationOf_(name, dish && dish.cat),
            'Цена, ₽': price >= 0 ? _vnR2_(price) : 0, 'Выход': _vnN_(x.yield) > 0 ? _vnN_(x.yield) : (dish ? (dish.yieldBase || dish.yield || '') : ''), 'Ед. выхода': _vnS_(x.yieldUnit, 6) || (dish && dish.yieldUnit) || (kind === 'GOODS' ? 'шт' : 'г'),
            'По весу': _vnBool_(x.byWeight) ? 'да' : 'нет', 'Цена за, г': _vnN_(x.per) > 0 ? _vnN_(x.per) : 100, 'Описание': _vnS_(x.desc, 600), 'Теги': (Array.isArray(x.tags) ? x.tags.join(', ') : _vnS_(x.tags, 120)),
            'Медиа (JSON)': '[]', 'Порядок': parseInt(x.order, 10) || 999, 'Для гостей': x.guest === false ? 'нет' : 'да', 'Обновлено': new Date(), 'Кто': _vnWho_(op) };
          _vnAppend_('MENU', rec); added++;
        } else {
          if (x.section !== undefined) rec['Раздел'] = _vnS_(x.section, 60) || ex.section;
          if (x.station === 'Бар' || x.station === 'Кухня') rec['Станция'] = x.station;
          if (price >= 0) rec['Цена, ₽'] = _vnR2_(price);
          if (x.yield !== undefined && _vnN_(x.yield) > 0) rec['Выход'] = _vnN_(x.yield);
          if (x.yieldUnit) rec['Ед. выхода'] = _vnS_(x.yieldUnit, 6);
          if (x.byWeight !== undefined) rec['По весу'] = _vnBool_(x.byWeight) ? 'да' : 'нет';
          if (x.per !== undefined && _vnN_(x.per) > 0) rec['Цена за, г'] = _vnN_(x.per);
          if (x.desc !== undefined) rec['Описание'] = _vnS_(x.desc, 600);
          if (x.tags !== undefined) rec['Теги'] = Array.isArray(x.tags) ? x.tags.join(', ') : _vnS_(x.tags, 120);
          if (x.order !== undefined) rec['Порядок'] = parseInt(x.order, 10) || 999;
          if (x.guest !== undefined) rec['Для гостей'] = x.guest === false ? 'нет' : 'да';
          if (x.name && ex.kind === 'GOODS') rec['Позиция'] = _vnS_(x.name, 120);
          rec['Обновлено'] = new Date(); rec['Кто'] = _vnWho_(op);
          _vnSet_('MENU', ex._r, rec); saved++;
        }
      });
      _audit_(op, 'VN_MENU_SAVE', 'Меню', '', null, { добавлено: added, изменено: saved });
      return { added: added, saved: saved };
    });
  });
}
/** Добавить в меню блюда ТТК (не п/ф) по кодам или все, которых в меню нет: {codes:[]|all:true}. Цена — последняя цена продажи. */
function vnMenuSync(json, token) {
  return _vnRun_(token, 'guestmenu', 'VN_MENU_SYNC', true, function (op) {
    var d = _vnJ_(json), idx = _buildDishIndexes_(), lp = _vnLastPrices_();
    return _withLock_(function () {
      var have = {}; _vnMenu_().forEach(function (m) { have[m.code] = true; });
      var codes = d.all ? Object.keys(idx.dishByCode) : (d.codes || []).map(String), n = 0, ord = 100;
      codes.forEach(function (c) {
        var dish = idx.dishByCode[c]; if (!dish || dish.semi || have[c]) return;
        var p = lp[_normNameServer_(dish.name)];
        _vnAppend_('MENU', { 'Код': String(c), 'Позиция': String(dish.name), 'Вид': 'DISH', 'Раздел': String(dish.cat || 'Меню'), 'Станция': _vnStationOf_(dish.name, dish.cat),
          'Цена, ₽': p ? p.price : 0, 'Выход': dish.yieldBase || dish.yield || '', 'Ед. выхода': dish.yieldUnit || 'г', 'По весу': 'нет', 'Цена за, г': 100, 'Описание': '', 'Теги': '',
          'Медиа (JSON)': '[]', 'Порядок': ord++, 'Для гостей': 'да', 'Обновлено': new Date(), 'Кто': _vnWho_(op) });
        have[c] = true; n++;
      });
      _audit_(op, 'VN_MENU_SYNC', 'Меню', '', null, { добавлено: n });
      return { added: n };
    });
  });
}

/* --------------------------------------------------------------- фото и видео позиций ---- */

/** Ссылка → медиа для ленты: фото, видео-файл или встраиваемый плеер (Google Диск, YouTube, Rutube, VK). */
function _vnMediaOf_(url, type) {
  var u = _vnS_(url, 600), m;
  if (!/^https:\/\//i.test(u)) return null;
  if ((m = /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([A-Za-z0-9_-]{20,})/.exec(u)) || (m = /docs\.google\.com\/uc\?.*id=([A-Za-z0-9_-]{20,})/.exec(u))) {
    return type === 'video' ? { type: 'embed', src: 'https://drive.google.com/file/d/' + m[1] + '/preview', fileId: m[1], kind: 'drive' } : { type: 'photo', src: 'https://lh3.googleusercontent.com/d/' + m[1] + '=w1080', fileId: m[1], kind: 'drive' };
  }
  if ((m = /(?:youtu\.be\/|youtube\.com\/(?:shorts\/|watch\?v=|embed\/))([A-Za-z0-9_-]{6,})/.exec(u))) return { type: 'embed', src: 'https://www.youtube.com/embed/' + m[1] + '?autoplay=1&mute=1&loop=1&playlist=' + m[1] + '&controls=0&playsinline=1&rel=0', kind: 'youtube' };
  if ((m = /rutube\.ru\/(?:video|shorts)\/([a-f0-9]{20,})/i.exec(u))) return { type: 'embed', src: 'https://rutube.ru/play/embed/' + m[1], kind: 'rutube' };
  if ((m = /vk\.com\/video(-?\d+)_(\d+)/.exec(u)) || (m = /vkvideo\.ru\/video(-?\d+)_(\d+)/.exec(u))) return { type: 'embed', src: 'https://vk.com/video_ext.php?oid=' + m[1] + '&id=' + m[2] + '&autoplay=1', kind: 'vk' };
  if (/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(u) || type === 'video') return { type: 'video', src: u, kind: 'file' };
  if (/\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i.test(u) || type === 'photo' || !type) return { type: 'photo', src: u, kind: 'url' };
  return null;
}
function _vnMenuItem_(code) {
  var m = _vnMenu_().filter(function (x) { return x.code === String(code); })[0];
  if (!m) throw new Error('NOT_FOUND: позиции ' + code + ' нет в электронном меню');
  return m;
}
function _vnMediaSave_(op, m, media, act) {
  _vnSet_('MENU', m._r, { 'Медиа (JSON)': JSON.stringify(media), 'Обновлено': new Date(), 'Кто': _vnWho_(op) });
  _audit_(op, act, 'Меню', m.code, null, { позиция: m.name, медиа: media.length });
  return { code: m.code, media: media };
}
/** Фото или видео по ссылке: {code, url, type?: photo|video, cover?: true}. Обложка — первая в ленте. */
function vnMediaAdd(json, token) {
  return _vnRun_(token, 'guestmenu', 'VN_MEDIA_ADD', true, function (op) {
    var d = _vnJ_(json), x = _vnMediaOf_(d.url, d.type);
    if (!x) _vnFail_('Ссылка не распознана: нужна https-ссылка на фото, видео (mp4), Google Диск, YouTube, Rutube или VK');
    return _withLock_(function () {
      var m = _vnMenuItem_(d.code), media = m.media.slice();
      if (media.some(function (y) { return y.src === x.src; })) _vnFail_('Это медиа уже есть у позиции');
      if (media.length >= 12) _vnFail_('У позиции не больше 12 фото и видео');
      x.url = _vnS_(d.url, 600);
      if (x.fileId) { var sh = _vnShare_(x.fileId); if (sh) x.warn = sh; }
      if (d.cover) media.unshift(x); else media.push(x);
      return _vnMediaSave_(op, m, media, 'VN_MEDIA_ADD');
    });
  });
}
/** Открыть файл Диска для просмотра по ссылке (гость видит без входа). Возвращает предупреждение или ''. */
function _vnShare_(fileId) {
  try { DriveApp.getFileById(fileId).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); return ''; }
  catch (e) { return 'Доступ по ссылке не открыт (' + String(e.message || e).slice(0, 120) + '): гости увидят файл, только если владелец откроет его вручную.'; }
}
function _vnMediaFolder_() {
  var id = _vnProp_('VN_MEDIA_FOLDER_ID', ''), f = null;
  if (id) { try { f = DriveApp.getFolderById(id); if (f.isTrashed && f.isTrashed()) f = null; } catch (e) { f = null; } }
  if (!f) {
    var root = null; try { root = _docsFolder_(); } catch (e) { root = null; }
    f = root ? root.createFolder('VINOVNIK — меню для гостей (фото и видео)') : DriveApp.createFolder('VINOVNIK — меню для гостей (фото и видео)');
    try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
    PropertiesService.getScriptProperties().setProperty('VN_MEDIA_FOLDER_ID', f.getId());
  }
  return f;
}
/** Загрузка файла с телефона или компьютера: {code, name, mime, b64, cover?}. До 40 МБ (ограничение вызова Apps Script). */
function vnMediaUpload(json, token) {
  return _vnRun_(token, 'guestmenu', 'VN_MEDIA_UPLOAD', true, function (op) {
    var d = _vnJ_(json), mime = _vnS_(d.mime, 60).toLowerCase();
    var video = /^video\/(mp4|webm|quicktime|x-m4v)$/.test(mime), photo = /^image\/(jpeg|png|webp|gif|heic|heif)$/.test(mime);
    if (!video && !photo) _vnFail_('Подходят фото (jpg, png, webp, heic) и видео (mp4, mov, webm)');
    var b64 = String(d.b64 || '').replace(/^data:[^,]*,/, ''); if (!b64) _vnFail_('Файл пустой');
    if (b64.length > 40 * 1024 * 1024 * 4 / 3) _vnFail_('Файл больше 40 МБ — сожмите видео или загрузите его на Диск и добавьте ссылкой');
    var m = _vnMenuItem_(d.code);
    var blob = Utilities.newBlob(Utilities.base64Decode(b64), mime, (m.code + ' ' + _vnS_(d.name, 80)).replace(/[\\\/:*?"<>|]/g, '_'));
    var file = _vnMediaFolder_().createFile(blob), warn = _vnShare_(file.getId());
    return _withLock_(function () {
      m = _vnMenuItem_(d.code);
      var x = video ? { type: 'video', src: 'https://drive.google.com/uc?export=download&id=' + file.getId(), embed: 'https://drive.google.com/file/d/' + file.getId() + '/preview', fileId: file.getId(), kind: 'drive' }
        : { type: 'photo', src: 'https://lh3.googleusercontent.com/d/' + file.getId() + '=w1080', fileId: file.getId(), kind: 'drive' };
      if (warn) x.warn = warn;
      var media = m.media.slice(); if (d.cover) media.unshift(x); else media.push(x);
      var r = _vnMediaSave_(op, m, media, 'VN_MEDIA_UPLOAD'); r.warn = warn; r.fileId = file.getId();
      return r;
    });
  });
}
/** Убрать медиа или сделать обложкой: {code, index, cover?: true}. Файл на Диске не удаляется. */
function vnMediaRemove(json, token) {
  return _vnRun_(token, 'guestmenu', 'VN_MEDIA_EDIT', true, function (op) {
    var d = _vnJ_(json);
    return _withLock_(function () {
      var m = _vnMenuItem_(d.code), media = m.media.slice(), i = parseInt(d.index, 10);
      if (!(i >= 0 && i < media.length)) _vnFail_('Нет такого медиа');
      var x = media.splice(i, 1)[0]; if (d.cover) media.unshift(x);
      return _vnMediaSave_(op, m, media, d.cover ? 'VN_MEDIA_COVER' : 'VN_MEDIA_REMOVE');
    });
  });
}

/* --------------------------------------------------------------- стоп/go-лист ---- */

function _vnStopActive_(s, now) {
  if (String(s['Активен']) === 'нет' || s['Активен'] === false) return false;
  var until = s['До']; if (until instanceof Date && !isNaN(until.getTime()) && until.getTime() < now.getTime()) return false;
  return true;
}
/** Действующие отметки: код → {status, left, reason, by, since, until, id}. Одна на позицию (последняя). */
function _vnStopMap_() {
  var now = _mcNow_(), out = {};
  _vnRows_('STOP').forEach(function (s) {
    if (!_vnStopActive_(s, now)) return;
    var left = s['Остаток, порц.'] === '' ? null : Number(s['Остаток, порц.']);
    out[String(s['Код'])] = { id: String(s.ID), code: String(s['Код']), name: String(s['Позиция']), station: String(s['Станция'] || ''), status: String(s['Статус']),
      left: left, reason: String(s['Причина'] || ''), by: String(s['Кто'] || ''), since: s['С'] instanceof Date ? _vnHm_(s['С']) : '', until: s['До'] instanceof Date ? Utilities.formatDate(s['До'], _mcTz_(), 'dd.MM HH:mm') : '', _r: s._r };
  });
  return out;
}
function _vnEndOfDay_() { var n = _mcNow_(); return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 23, 59, 59); }
/** Поставить отметку: {code, status: STOP|LIMIT|GO, left?, reason, until?: 'day'|'none'|ISO}. Прежняя отметка позиции снимается. */
function vnStopSave(json, token) {
  return _vnRun_(token, 'stoplist|hall_manage', 'VN_STOP', true, function (op) {
    var d = _vnJ_(json), L = Array.isArray(d.items) ? d.items : [d];
    return _withLock_(function () {
      var M = {}; _vnMenu_().forEach(function (m) { M[m.code] = m; });
      var cur = _vnStopMap_(), out = [];
      L.forEach(function (x) {
        var st = String(x.status || '').toUpperCase(), m = M[String(x.code)];
        if (!MC_VN_STOP_ST_[st]) _vnFail_('Статус — стоп, лимит или go');
        if (!m) _vnFail_('Позиции ' + x.code + ' нет в меню');
        var left = null; if (st === 'LIMIT') { left = parseInt(x.left, 10); if (!(left >= 1 && left <= 999)) _vnFail_('Лимит «' + m.name + '» — сколько порций осталось (от 1)'); }
        var reason = _vnS_(x.reason, 160); if (st !== 'GO' && !reason) _vnFail_('Почему «' + m.name + '» в стопе — причину видят официанты');
        var until = x.until === 'none' ? '' : x.until && x.until !== 'day' ? new Date(x.until) : _vnEndOfDay_();
        if (until instanceof Date && isNaN(until.getTime())) until = _vnEndOfDay_();
        if (cur[m.code]) _vnSet_('STOP', cur[m.code]._r, { 'Активен': 'нет', 'Снял': _vnWho_(op), 'Снято': new Date() });
        var id = _vnId_('СТ');
        _vnAppend_('STOP', { ID: id, 'Код': m.code, 'Позиция': m.name, 'Станция': m.station, 'Статус': st, 'Остаток, порц.': left === null ? '' : left, 'Причина': reason || (st === 'GO' ? 'предложить гостям' : ''),
          'Кто': _vnWho_(op), 'С': new Date(), 'До': until, 'Активен': 'да' });
        out.push({ code: m.code, name: m.name, status: st, statusRu: MC_VN_STOP_ST_[st], left: left });
      });
      _audit_(op, 'VN_STOP', 'Стоп/go-лист', '', null, { позиции: out.map(function (o) { return o.name + ': ' + o.statusRu + (o.left ? ' ' + o.left : ''); }) });
      return { items: out };
    });
  });
}
/** Снять отметку с позиций: {codes:[]}. */
function vnStopClear(json, token) {
  return _vnRun_(token, 'stoplist|hall_manage', 'VN_STOP_CLEAR', true, function (op) {
    var d = _vnJ_(json), codes = (d.codes || [d.code]).map(String);
    return _withLock_(function () {
      var cur = _vnStopMap_(), n = 0;
      codes.forEach(function (c) { if (cur[c]) { _vnSet_('STOP', cur[c]._r, { 'Активен': 'нет', 'Снял': _vnWho_(op), 'Снято': new Date() }); n++; } });
      _audit_(op, 'VN_STOP_CLEAR', 'Стоп/go-лист', codes.join(','), null, { снято: n });
      return { cleared: n };
    });
  });
}
/** Лимит уменьшается с каждой отправленной порцией; кончился — позиция уходит в стоп сама. */
function _vnStopTake_(op, code, qty) {
  var cur = _vnStopMap_()[String(code)]; if (!cur || cur.status !== 'LIMIT' || cur.left === null) return null;
  var left = Math.max(0, cur.left - qty);
  if (left > 0) { _vnSet_('STOP', cur._r, { 'Остаток, порц.': left }); return { left: left }; }
  _vnSet_('STOP', cur._r, { 'Остаток, порц.': 0, 'Активен': 'нет', 'Снял': 'система (лимит исчерпан)', 'Снято': new Date() });
  _vnAppend_('STOP', { ID: _vnId_('СТ'), 'Код': cur.code, 'Позиция': cur.name, 'Станция': cur.station, 'Статус': 'STOP', 'Остаток, порц.': '', 'Причина': 'лимит исчерпан (' + cur.reason + ')',
    'Кто': 'система', 'С': new Date(), 'До': _vnEndOfDay_(), 'Активен': 'да' });
  return { left: 0, stopped: true };
}
/** Предложения по складу: позиции, которые нельзя приготовить (стоп) или мало (лимит), и go по срокам годности (V88). */
function _vnSuggest_() {
  var M = _vnMenu_(), cur = _vnStopMap_(), stop = [], go = [], idx = _buildDishIndexes_();
  M.forEach(function (m) {
    if (cur[m.code] && cur[m.code].status === 'STOP') return;
    try {
      var item = m.kind === 'GOODS' ? _v71Resolve_(m.name, 'goods', m.yieldUnit === 'шт' ? 'шт' : m.yieldUnit, idx) : _v71Resolve_(m.name, 'dish', '', idx);
      if (item.error) { if (m.kind === 'GOODS') stop.push({ code: m.code, name: m.name, status: 'STOP', reason: 'нет на складе' }); return; }
      var one = m.kind === 'GOODS' ? (m.yieldUnit === 'шт' ? 1 : (m.yield || 1)) : 1;
      var b1 = _v71Brief_(_v71Run_(item, one, { dry: true, at: new Date() }));
      if (b1.status !== 'FULL') { stop.push({ code: m.code, name: m.name, status: 'STOP', reason: 'не хватает: ' + (b1.short || []).map(function (s) { return s.text || s; }).join('; ').slice(0, 140) }); return; }
      var b5 = _v71Brief_(_v71Run_(item, one * 5, { dry: true, at: new Date() }));
      if (b5.status !== 'FULL') {
        var lo = 1, hi = 5; while (hi - lo > 1) { var mid = Math.floor((lo + hi) / 2); if (_v71Brief_(_v71Run_(item, one * mid, { dry: true, at: new Date() })).status === 'FULL') lo = mid; else hi = mid; }
        if (!(cur[m.code] && cur[m.code].status === 'LIMIT')) stop.push({ code: m.code, name: m.name, status: 'LIMIT', left: lo, reason: 'по складу хватит на ' + lo + ' порц.' });
      }
    } catch (e) {}
  });
  try {
    if (typeof _v88Expiring_ === 'function' && typeof _v88GoRows_ === 'function') {
      var byName = {}; M.forEach(function (m) { byName[_normNameServer_(m.name)] = m; });
      var seen = {};
      _v88GoRows_(_v88Expiring_(typeof _v88ExpDays_ === 'function' ? _v88ExpDays_() : 3)).forEach(function (r) {
        var m = byName[_normNameServer_(r.dish)]; if (!m || seen[m.code] || (cur[m.code] && (cur[m.code].status === 'GO' || cur[m.code].status === 'STOP'))) return;
        seen[m.code] = true;
        go.push({ code: m.code, name: m.name, status: 'GO', reason: 'срок: ' + r.product + ' годен до ' + r.expiryText + ', из остатка ' + r.portions + ' порц.' });
      });
    }
  } catch (e) {}
  return { stop: stop, go: go };
}
function vnStopSuggest(token) {
  return _vnRun_(token, 'stoplist|hall_manage|guestmenu', 'VN_STOP_SUGGEST', false, function () { return _vnSuggest_(); });
}

/* --------------------------------------------------------------- настройки ---- */

/** {name, subtitle, bookMin, guestBooking, hideStop, open, close, phone, address, cookMin}. */
function vnSettings(json, token) {
  return _vnRun_(token, 'guestmenu|hall_manage', 'VN_SETTINGS', true, function (op) {
    var d = _vnJ_(json), P = PropertiesService.getScriptProperties(), set = {};
    if (d.name !== undefined) set.VN_NAME = _vnS_(d.name, 60) || 'VINOVNIK';
    if (d.subtitle !== undefined) set.VN_SUBTITLE = _vnS_(d.subtitle, 60);
    if (d.bookMin !== undefined) { var b = parseInt(d.bookMin, 10); if (!(b >= 30 && b <= 720)) _vnFail_('Длительность брони — от 30 до 720 минут'); set.VN_BOOK_MIN = String(b); }
    if (d.cookMin !== undefined) { var c = parseInt(d.cookMin, 10); if (!(c >= 3 && c <= 120)) _vnFail_('Норма приготовления — от 3 до 120 минут'); set.VN_COOK_MIN = String(c); }
    if (d.guestBooking !== undefined) set.VN_GUEST_BOOKING = d.guestBooking ? '1' : '0';
    if (d.hideStop !== undefined) set.VN_HIDE_STOP = d.hideStop ? '1' : '0';
    if (d.open !== undefined) { if (!_vnTime_(d.open)) _vnFail_('Открытие — ЧЧ:ММ'); set.VN_OPEN = _vnTime_(d.open); }
    if (d.close !== undefined) { if (!_vnTime_(d.close)) _vnFail_('Закрытие — ЧЧ:ММ'); set.VN_CLOSE = _vnTime_(d.close); }
    if (d.phone !== undefined) set.VN_PHONE = _vnS_(d.phone, 30);
    if (d.address !== undefined) set.VN_ADDRESS = _vnS_(d.address, 160);
    Object.keys(set).forEach(function (k) { P.setProperty(k, set[k]); });
    _audit_(op, 'VN_SETTINGS', 'Зал', '', null, set);
    return _vnSettings_();
  });
}
