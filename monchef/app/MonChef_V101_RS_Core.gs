/**
 * MON CHEF V101 — Restaurant Service: ядро (листы, ID, идемпотентность, журнал транзакций, события обслуживания).
 *
 * Собственность Слепцова Дениса Владимировича.
 * Разработчик кода — Слепцов Денис Владимирович.
 *
 * Общие механизмы зала, бронирования, заказов, кухни и бара (ТЗ Restaurant Service 1.0, §10, §15):
 *  • листы с колонками CreatedAt…Version; строки не удаляются — статус и история;
 *  • ID вида ПРЕФИКС-ГГГГММДД-XXXXXXXX;
 *  • IdempotencyKey: устройство присылает ключ на каждое действие; повтор с тем же ключом возвращает
 *    сохранённый ответ и ничего не записывает (лист «Идемпотентность_V1», не кэш — переживает обрыв связи);
 *  • журнал транзакций: план записи (полные строки) сохраняется ДО записи; запись по листам; отметка COMMITTED.
 *    Незавершённую транзакцию (PENDING) rsTxRecover доводит до конца по сохранённому плану — повтор строки
 *    с тем же ID её не дублирует, а более новую версию строки не затирает;
 *  • оптимистичная блокировка: изменение передаёт Version, которую видел пользователь; не совпала — CONFLICT;
 *  • события обслуживания — только дописываются (СобытияОбслуживания_V1), плюс общий аудит с цепочкой хешей.
 * Модуль не подменяет чужие функции: вызывает _withLock_, _createOperation_, _audit_, _requireAuth_ ядра.
 */

/* Функции, которые вызывают страницы, регистрируются в шлюзе здесь (zzz_MonChef_Gate.gs читает MC_GATE_EXT_). */
var MC_GATE_EXT_ = (typeof MC_GATE_EXT_ !== 'undefined' && MC_GATE_EXT_) || {};

var MC_RS_STD_ = ['CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy', 'Version', 'OperationID'];
var MC_RS_SH_ = {
  HALLS: 'Залы_V1', TABLES: 'Столы_V1', BOOKINGS: 'Бронирования_V1', PREORDERS: 'Предзаказы_V1',
  EVENTS: 'СобытияОбслуживания_V1', IDEM: 'Идемпотентность_V1', TX: 'ЖурналТранзакций_RS',
  ORDERS: 'ЗаказыЗала_V1', GUESTS: 'ГостиЗаказа_V1', COURSES: 'КурсыЗаказа_V1', ITEMS: 'ПозицииЗаказа_V1', QUEUE: 'ОчередьПроизводства_V1',
  BILLS: 'СчетаВнутренние_V1', ALLOC: 'РаспределениеСчета_V1',
  MENU_PUB: 'МенюПубликация_V1', MEDIA: 'МедиаМеню_V1', MENU_SNAP: 'МенюСнимок_V1', GUEST_REQ: 'ГостевыеЗаявки_V1',
  STOPGO: 'СтопГО_V1'
};
var MC_RS_HEAD_ = {};
MC_RS_HEAD_[MC_RS_SH_.HALLS] = ['HallID', 'SiteID', 'Название', 'Порядок', 'Ширина', 'Высота', 'Статус'].concat(MC_RS_STD_);
MC_RS_HEAD_[MC_RS_SH_.TABLES] = ['TableID', 'HallID', 'SiteID', 'Номер', 'Мест мин', 'Мест макс', 'X', 'Y', 'Форма', 'Можно объединять с', 'Статус'].concat(MC_RS_STD_).concat(['QR-код']);   // QR-код — этап 5, в конце
MC_RS_HEAD_[MC_RS_SH_.BOOKINGS] = ['BookingID', 'SiteID', 'HallID', 'Столы', 'Гость', 'Телефон', 'Дата', 'Начало', 'Длительность, мин', 'Окончание',
  'Гостей', 'Пожелания', 'Комментарий', 'Менеджер', 'PreorderID', 'Статус', 'Причина', 'OrderID', 'IdempotencyKey'].concat(MC_RS_STD_).concat(['Банкет']);   // этап 9 — в конце
MC_RS_HEAD_[MC_RS_SH_.PREORDERS] = ['PreorderID', 'BookingID', 'Позиции', 'Статус', 'ConvertedOrderID', 'ConvertedAt'].concat(MC_RS_STD_);
MC_RS_HEAD_[MC_RS_SH_.ORDERS] = ['OrderID', 'SiteID', 'HallID', 'TableID', 'BookingID', 'Гостей', 'Официант', 'WaiterID', 'Открыт', 'Комментарий', 'Статус', 'Причина', 'Закрыт',
  'IdempotencyKey'].concat(MC_RS_STD_);
MC_RS_HEAD_[MC_RS_SH_.GUESTS] = ['GuestID', 'OrderID', 'Номер', 'Метка'].concat(MC_RS_STD_);
MC_RS_HEAD_[MC_RS_SH_.COURSES] = ['CourseID', 'OrderID', 'Номер', 'Название', 'Статус', 'Отправлен', 'Отправил'].concat(MC_RS_STD_);
MC_RS_HEAD_[MC_RS_SH_.ITEMS] = ['OrderItemID', 'OrderID', 'CourseID', 'Курс', 'GuestID', 'Гость', 'DishCode', 'TTKVersion', 'Название', 'Подразделение', 'Цех',
  'Кол-во', 'Ед. продажи', 'Весовая', 'Вес план', 'Вес факт', 'Ед. веса', 'Цена, коп', 'Цена за', 'PriceID', 'Сумма план, коп', 'Сумма факт, коп',
  'Модификаторы', 'Комментарий', 'Статус', 'Отправлено', 'TicketID', 'Причина отмены', 'Источник'].concat(MC_RS_STD_).concat(['Расход при отмене', 'Подано', 'Подал', 'Замена для']);   // этап 4 — в конце
MC_RS_HEAD_[MC_RS_SH_.QUEUE] = ['TicketID', 'OrderItemID', 'OrderID', 'TableID', 'Стол', 'SiteID', 'Подразделение', 'Цех', 'DishCode', 'TTKVersion', 'Название', 'Кол-во',
  'Вес', 'Курс', 'Модификаторы', 'Комментарий', 'Приоритет', 'Статус', 'Принял', 'Принято', 'Готовить начал', 'Готово', 'Выдано', 'Исполнитель',
  'Списано по партиям', 'Себестоимость, коп', 'Проблема'].concat(MC_RS_STD_).concat(['Запрос отмены', 'Выдал', 'Результат выдачи']);   // этап 4 — в конце
MC_RS_HEAD_[MC_RS_SH_.BILLS] = ['BillID', 'OrderID', 'Название', 'Гость', 'Скидка вид', 'Скидка значение', 'Скидка, коп', 'Причина скидки', 'Сбор вид', 'Сбор значение',
  'Сбор, коп', 'Причина сбора', 'Итого, коп', 'Статус', 'Способ оплаты', 'Чек', 'Подтвердил', 'Подтверждено', 'Объединён в', 'Комментарий'].concat(MC_RS_STD_).concat(['Проведено в J36', 'Возврат']);   // этап 7 — в конце
MC_RS_HEAD_[MC_RS_SH_.ALLOC] = ['AllocID', 'BillID', 'OrderID', 'OrderItemID', 'Доля числитель', 'Доля знаменатель', 'Статус'].concat(MC_RS_STD_);
MC_RS_HEAD_[MC_RS_SH_.MENU_PUB] = ['DishCode', 'Категория', 'Описание', 'Порядок', 'Статус', 'Опубликовал', 'Опубликовано'].concat(MC_RS_STD_);
MC_RS_HEAD_[MC_RS_SH_.MEDIA] = ['MediaID', 'DishCode', 'Тип', 'FileID', 'Файл', 'MIME', 'Размер', 'SHA-256', 'Обложка', 'Порядок', 'Статус', 'Загрузил', 'Загружено'].concat(MC_RS_STD_);
MC_RS_HEAD_[MC_RS_SH_.MENU_SNAP] = ['DishCode', 'Снимок', 'Опубликовано'].concat(MC_RS_STD_);
MC_RS_HEAD_[MC_RS_SH_.GUEST_REQ] = ['RequestID', 'SiteID', 'TableID', 'Стол', 'Позиции', 'Комментарий', 'Статус', 'OrderID', 'Решил', 'Решено', 'Причина', 'Создано', 'IdempotencyKey'].concat(MC_RS_STD_);
MC_RS_HEAD_[MC_RS_SH_.STOPGO] = ['StopID', 'DishCode', 'Название', 'Подразделение', 'Статус', 'Остаток', 'Причина', 'Комментарий', 'Ответственный', 'С', 'Восстановил', 'Восстановлено',
  'Причина восстановления', 'Актуально'].concat(MC_RS_STD_);
MC_RS_HEAD_[MC_RS_SH_.EVENTS] = ['EventID', 'Время', 'ObjectType', 'ObjectID', 'BookingID', 'OrderID', 'Событие', 'Было', 'Стало', 'Сотрудник', 'EmployeeID', 'OperationID'];
MC_RS_HEAD_[MC_RS_SH_.IDEM] = ['IdempotencyKey', 'Функция', 'EmployeeID', 'Создано', 'Статус', 'Ответ', 'OperationID'];
MC_RS_HEAD_[MC_RS_SH_.TX] = ['TxID', 'OperationID', 'Тип', 'План', 'Шагов', 'Выполнено', 'Статус', 'Ошибка', 'Начато', 'Завершено'];
/** Колонки, которые хранятся текстом (иначе таблица превращает «2026-11-25» и «19:00» в дату и время). */
var MC_RS_TEXT_COLS_ = ['Дата', 'Начало', 'Окончание', 'Телефон', 'Номер', 'IdempotencyKey', 'Стол', 'Чек', 'QR-код', 'DishCode'];
var MC_RS_TX_STALE_MIN_ = 6;   // предел выполнения Apps Script — 6 минут: PENDING старше этого уже никто не допишет

/* ---------------- листы ---------------- */
function _rsSheet_(name) {
  var ss = _book_(), sh = ss.getSheetByName(name), head = MC_RS_HEAD_[name];
  if (!head) throw new Error('INTERNAL: неизвестный лист ' + name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head]);
    sh.setFrozenRows(1);
    try { sh.getRange(1, 1, 1, head.length).setFontWeight('bold'); } catch (e) {}
    head.forEach(function (h, i) { if (MC_RS_TEXT_COLS_.indexOf(h) >= 0) { try { sh.getRange(2, i + 1, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('@'); } catch (e) {} } });
  } else if (sh.getLastColumn() < head.length) {   // колонки, добавленные в конец в новых версиях: дописать заголовок, данные не сдвигаются
    var n0 = sh.getLastColumn(), cur = sh.getRange(1, 1, 1, n0).getValues()[0].map(String);
    if (cur.join('|') !== head.slice(0, n0).join('|')) throw new Error('INTERNAL: заголовки листа «' + name + '» не совпадают с ожидаемыми — лист изменён вручную, данные не трогаю');
    sh.getRange(1, n0 + 1, 1, head.length - n0).setValues([head.slice(n0)]);
  }
  return sh;
}
/** Копия строки листа для записи: даты остаются датами (копия через JSON превращала их в текст), служебный _row убирается. */
function _rsCopy_(r) {
  var o = {}; Object.keys(r || {}).forEach(function (k) { if (k === '_row') return; var v = r[k]; o[k] = _rsIsDate_(v) ? new Date(v.getTime()) : (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v); });
  return o;
}
/** Все строки листа одним чтением: [{колонка: значение, _row}]. */
function _rsRows_(name) {
  var sh = _rsSheet_(name), head = MC_RS_HEAD_[name], n = sh.getLastRow();
  if (n < 2) return [];
  var v = sh.getRange(2, 1, n - 1, head.length).getValues(), out = [];
  for (var i = 0; i < v.length; i++) {
    if (v[i][0] === '' || v[i][0] === null) continue;
    var o = { _row: i + 2 };
    for (var j = 0; j < head.length; j++) o[head[j]] = v[i][j];
    out.push(o);
  }
  return out;
}
function _rsRowArr_(name, o) { return MC_RS_HEAD_[name].map(function (h) { var x = o[h]; return x === undefined || x === null ? '' : x; }); }
/** Запись строки по ID (первая колонка): есть — перезаписать, нет — дописать. Возвращает номер строки. */
function _rsUpsert_(name, o, rowsCache) {
  var sh = _rsSheet_(name), head = MC_RS_HEAD_[name], id = String(o[head[0]]);
  var rows = rowsCache || _rsRows_(name), row = 0;
  for (var i = rows.length - 1; i >= 0; i--) if (String(rows[i][head[0]]) === id) { row = rows[i]._row; break; }
  if (!row) row = Math.max(sh.getLastRow(), 1) + 1;
  sh.getRange(row, 1, 1, head.length).setValues([_rsRowArr_(name, o)]);
  if (rowsCache) { var found = false; rowsCache.forEach(function (r) { if (r._row === row) { found = true; head.forEach(function (h) { r[h] = o[h]; }); } }); if (!found) { var c = { _row: row }; head.forEach(function (h) { c[h] = o[h]; }); rowsCache.push(c); } }
  return row;
}

/* ---------------- значения ---------------- */
/** Дата из ячейки (проверка не через instanceof: объект может прийти из другого контекста выполнения). */
function _rsIsDate_(v) { return Object.prototype.toString.call(v) === '[object Date]'; }
function _rsS_(x) { return String(x === undefined || x === null ? '' : x).replace(/\s+/g, ' ').trim(); }
function _rsJ_(x, d) { if (x && typeof x === 'object') return x; try { return JSON.parse(x); } catch (e) { return d; } }
function _rsNum_(x) { var n = typeof x === 'number' ? x : parseFloat(String(x === undefined || x === null ? '' : x).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : NaN; }
/** Дата → «гггг-мм-дд» (строка, Date из таблицы, «дд.мм.гггг»). Пусто — ''. */
function _rsDay_(v) {
  if (v === undefined || v === null || v === '') return '';
  if (_rsIsDate_(v)) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, _mcTz_(), 'yyyy-MM-dd');
  var s = String(v).trim(), m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return s;
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  return m ? m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : '';
}
/** Время → «ЧЧ:ММ» (строка или время из таблицы). */
function _rsHm_(v) {
  if (v === undefined || v === null || v === '') return '';
  if (_rsIsDate_(v)) return typeof _mcTimeStr_ === 'function' ? _mcTimeStr_(v) : Utilities.formatDate(v, _mcTz_(), 'HH:mm');
  var m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(v));
  return m && +m[1] < 24 && +m[2] < 60 ? ('0' + m[1]).slice(-2) + ':' + m[2] : '';
}
/** Минуты от 2000-01-01 по календарю предприятия (без часовых поясов: дата и время уже местные). */
function _rsAbsMin_(day, hm) {
  var d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day), t = /^(\d{2}):(\d{2})$/.exec(hm);
  if (!d || !t) return NaN;
  return Math.round(Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]) / 60000);
}
function _rsFromAbs_(min) { var x = new Date(min * 60000), p = function (n) { return ('0' + n).slice(-2); }; return { day: x.getUTCFullYear() + '-' + p(x.getUTCMonth() + 1) + '-' + p(x.getUTCDate()), hm: p(x.getUTCHours()) + ':' + p(x.getUTCMinutes()) }; }
function _rsToday_() { return Utilities.formatDate(typeof _mcNow_ === 'function' ? _mcNow_() : new Date(), _mcTz_(), 'yyyy-MM-dd'); }
function _rsNowHm_() { return Utilities.formatDate(typeof _mcNow_ === 'function' ? _mcNow_() : new Date(), _mcTz_(), 'HH:mm'); }

/* ---------------- ID ---------------- */
function _rsId_(prefix) {
  return prefix + '-' + Utilities.formatDate(new Date(), _mcTz_(), 'yyyyMMdd') + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
}
function _rsIdemKey_(k) {
  var s = String(k || '').trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(s)) throw new Error('VALIDATION: нет ключа операции (обновите страницу и повторите)');
  return s;
}

/* ---------------- площадки ---------------- */
/** Площадки предприятия: Площадки_V97 или одна основная. */
function _rsSites_() {
  var out = [];
  try {
    var sh = _book_().getSheetByName('Площадки_V97');
    if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach(function (r) {
      if (r[0] && String(r[3] || 'ACTIVE') !== 'ARCHIVED') out.push({ id: String(r[0]), name: String(r[1] || r[0]) });
    });
  } catch (e) {}
  if (!out.some(function (s) { return s.id === 'SITE-MAIN'; })) out.unshift({ id: 'SITE-MAIN', name: 'Основная площадка' });
  return out;
}
function _rsSite_(x) {
  var id = _rsS_(x) || 'SITE-MAIN', ok = _rsSites_().some(function (s) { return s.id === id; });
  if (!ok) throw new Error('VALIDATION: площадка не найдена');
  return id;
}

/* ---------------- операция, автор ---------------- */
function _rsWho_(s) { return s ? (s.dev ? (typeof MC_RB_TECH_ !== 'undefined' ? MC_RB_TECH_ : 'Технический доступ') : (s.name || s.fullName || s.user_id || '')) : 'system'; }
function _rsStamp_(o, s, op, isNew) {
  var now = new Date();
  if (isNew) { o.CreatedAt = now; o.CreatedBy = _rsWho_(s); o.Version = 1; }
  else o.Version = (parseInt(o.Version, 10) || 0) + 1;
  o.UpdatedAt = now; o.UpdatedBy = _rsWho_(s); o.OperationID = (op && op.id) || '';
  return o;
}
function _rsCheckVersion_(row, v) {
  if (v === undefined || v === null || v === '') return;   // версия не передана — изменение по последнему состоянию (вызов сервера)
  if (String(parseInt(v, 10)) !== String(parseInt(row.Version, 10) || 0))
    throw new Error('CONFLICT: запись уже изменил другой сотрудник (' + _rsS_(row.UpdatedBy) + ') — обновите экран и повторите');
}
function _rsFail_(e, op) {
  var s = String(e && e.message ? e.message : e);
  if (/^CONFLICT:/.test(s)) { if (op) _endOp_(op, 'FAILED'); return _fail_('CONFLICT', s.replace(/^CONFLICT:\s*/, ''), op && op.id); }
  if (op) _endOp_(op, 'FAILED');
  return _failFrom_(e, op && op.id);
}

/* ---------------- события ---------------- */
function _rsEventRow_(op, s, objType, objId, ids, event, before, after) {
  return { EventID: _rsId_('EV'), 'Время': new Date(), ObjectType: objType, ObjectID: objId, BookingID: (ids && ids.booking) || '', OrderID: (ids && ids.order) || '',
    'Событие': event, 'Было': before ? JSON.stringify(before).slice(0, 45000) : '', 'Стало': after ? JSON.stringify(after).slice(0, 45000) : '',
    'Сотрудник': _rsWho_(s), EmployeeID: s ? String(s.user_id || '') : '', OperationID: (op && op.id) || '' };
}

/* ---------------- журнал транзакций ---------------- */
/**
 * Записать план (массив {sheet, row}) как одну транзакцию: план → PENDING → строки → COMMITTED.
 * Вызывать под _withLock_. Строки — полные (все колонки), запись по ID — повтор не дублирует.
 */
function _rsTxApply_(op, type, plan) {
  var tx = { TxID: _rsId_('TX'), OperationID: (op && op.id) || '', 'Тип': type, 'План': JSON.stringify(plan), 'Шагов': plan.length, 'Выполнено': 0,
    'Статус': 'PENDING', 'Ошибка': '', 'Начато': new Date(), 'Завершено': '' };
  if (tx['План'].length > 49000) throw new Error('VALIDATION: слишком большая операция — разбейте на части');
  var txRows = _rsRows_(MC_RS_SH_.TX);
  _rsUpsert_(MC_RS_SH_.TX, tx, txRows);
  _rsTxRun_(plan, false);
  tx['Выполнено'] = plan.length; tx['Статус'] = 'COMMITTED'; tx['Завершено'] = new Date();
  _rsUpsert_(MC_RS_SH_.TX, tx, txRows);
  try { if (typeof _mcGenBump_ === 'function') _mcGenBump_(); } catch (e) {}
  return tx.TxID;
}
function _rsTxRun_(plan, recovering) {
  var caches = {};
  plan.forEach(function (st) {
    var name = st.sheet, row = st.row, rows = caches[name] || (caches[name] = _rsRows_(name)), idc = MC_RS_HEAD_[name][0];
    if (recovering && row.Version !== undefined) {
      var cur = rows.filter(function (r) { return String(r[idc]) === String(row[idc]); })[0];
      if (cur && (parseInt(cur.Version, 10) || 0) > (parseInt(row.Version, 10) || 0)) return;   // строку уже изменили позже — не затираем
    }
    if (recovering) { ['CreatedAt', 'UpdatedAt', 'Время', 'Начато', 'Завершено'].forEach(function (k) { if (typeof row[k] === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(row[k])) row[k] = new Date(row[k]); }); }
    _rsUpsert_(name, row, rows);
  });
}
/** Довести незавершённые транзакции (PENDING старше 6 мин; force — все PENDING). Право: system или hall_manage. */
function rsTxRecover(json, token) {
  var op = null;
  try {
    op = _beginOp_(token, null, 'RS_TX_RECOVER', 'ЖурналТранзакций_RS', '', null);
    if (!_mcRbHasExact_(op.session, 'system|hall_manage')) { _endOp_(op, 'FAILED'); return _mcRbDenyJson_('Досдача операций — администратор зала или технический доступ.'); }
    var d = _rsJ_(json, {}) || {};
    var res = _withLock_(function () {
      var rows = _rsRows_(MC_RS_SH_.TX), lim = Date.now() - MC_RS_TX_STALE_MIN_ * 60000, done = [], failed = [];
      rows.forEach(function (t) {
        if (String(t['Статус']) !== 'PENDING') return;
        var at = _rsIsDate_(t['Начато']) ? t['Начато'].getTime() : Date.parse(t['Начато']);
        if (!d.force && at > lim) return;
        try { _rsTxRun_(_rsJ_(t['План'], []), true); t['Статус'] = 'RECOVERED'; t['Выполнено'] = t['Шагов']; t['Завершено'] = new Date(); done.push(t.TxID); }
        catch (e) { t['Ошибка'] = String(e.message || e).slice(0, 500); failed.push(t.TxID); }
        var o = {}; MC_RS_HEAD_[MC_RS_SH_.TX].forEach(function (h) { o[h] = t[h]; }); _rsUpsert_(MC_RS_SH_.TX, o, rows);
      });
      return { recovered: done, failed: failed };
    });
    _audit_(op, 'RS_TX_RECOVER', 'ЖурналТранзакций_RS', '', null, res); _endOp_(op);
    return _ok_(res, op.id);
  } catch (e) { return _rsFail_(e, op); }
}

/* ---------------- идемпотентность ---------------- */
/**
 * Выполнить действие один раз на ключ. fn() → строка ответа (_ok_/_fail_). Вызывать под _withLock_.
 * Сохраняется только успешный ответ: после отказа (проверка, конфликт) тот же ключ можно повторить.
 */
function _rsOnce_(key, fnName, s, op, fn) {
  var rows = _rsRows_(MC_RS_SH_.IDEM);
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i].IdempotencyKey) !== key) continue;
    if (String(rows[i]['Функция']) !== fnName || String(rows[i].EmployeeID) !== String(s.user_id || ''))
      throw new Error('VALIDATION: ключ операции уже использован другим действием');
    return { replay: true, res: String(rows[i]['Ответ']) };
  }
  var res = fn();
  var ok = false; try { ok = JSON.parse(res).success === true; } catch (e) {}
  if (ok) _rsUpsert_(MC_RS_SH_.IDEM, { IdempotencyKey: key, 'Функция': fnName, EmployeeID: String(s.user_id || ''), 'Создано': new Date(), 'Статус': 'DONE',
    'Ответ': res.length < 45000 ? res : _ok_({ replayTruncated: true }, op && op.id), OperationID: (op && op.id) || '' }, rows);
  return { replay: false, res: res };
}
/**
 * Общая обёртка записывающих функций зала: вход и право → операция → блокировка → ключ → действие → аудит.
 * body(ctx) возвращает {data, plan, audit:{action, entity, id, before, after}}; план пишется транзакцией.
 */
function _rsMutate_(token, need, type, json, body, opts) {
  var op = null;
  try {
    var s = _requireAuth_(token, null);
    if (!_mcRbHasExact_(s, need)) { try { _mcRbAuditDenied_(s, type, need, ''); } catch (e) {} return _mcRbDenyJson_('Действие недоступно для роли «' + (s.role || '—') + '» (нужно право: ' + need.split('|').join(' или ') + ').'); }
    var d = _rsJ_(json, null);
    if (!d || typeof d !== 'object') return _fail_('VALIDATION', 'Нет данных');
    var key = (opts && opts.noKey) ? '' : _rsIdemKey_(d.idem);
    op = _createOperation_(type, s, key);
    var out = _withLock_(function () {
      var run = function () {
        var r = body({ s: s, op: op, d: d });
        if (r && r.fail) return _fail_(r.fail[0], r.fail[1], op.id);
        if (r.plan && r.plan.length) _rsTxApply_(op, type, r.plan);
        if (r.audit) _audit_(op, r.audit.action || type, r.audit.entity || '', r.audit.id || '', r.audit.before || null, r.audit.after || null);
        return _ok_(r.data, op.id);
      };
      if (!key) return { replay: false, res: run() };
      return _rsOnce_(key, type, s, op, run);
    });
    var failed = false; try { failed = JSON.parse(out.res).success !== true; } catch (e) {}
    _endOp_(op, out.replay ? 'DUPLICATE' : (failed ? 'FAILED' : 'COMPLETED'));
    return out.res;
  } catch (e) { return _rsFail_(e, op); }
}
/** Чтение: вход и право, без операции и блокировки. */
function _rsRead_(token, need, fn) {
  try {
    var s = _requireAuth_(token, null);
    if (!_mcRbHasExact_(s, need)) return _mcRbDenyJson_('Просмотр недоступен для роли «' + (s.role || '—') + '» (нужно право: ' + need.split('|').join(' или ') + ').');
    return _ok_(fn(s));
  } catch (e) { return _rsFail_(e, null); }
}

MC_GATE_EXT_.rsTxRecover = { need: 'system|hall_manage', mut: true };
