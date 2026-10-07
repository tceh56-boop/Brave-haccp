// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Alco.gs (M12): алкоголь в общепите — лицензия, марки, вскрытие тары, журнал продаж.
 *
 * Этап 1 — учёт в ЦЕХ без прямой связи с ЕГАИС:
 *  - карточка алкоголя на продукт склада (единица — литры): алкокод, код вида, ёмкость, крепость;
 *    пиво (разлив и тара) маркируется в «Честном знаке», остальное — акцизные марки ЕГАИС;
 *  - лицензия точки: напоминания за 90/30/7 дней; без действующей лицензии касса не добавляет
 *    в заказ блюда с алкоголем;
 *  - приём марок к партии прихода (не больше бутылок, чем в партии), без дублей;
 *  - вскрытие тары сканером: бутылка/кега «вскрыта», документ встаёт в очередь ALCO_OUTBOX
 *    (вскрытие — ЕГАИС, подключение кеги — «Честный знак») со сроком отправки — сегодня;
 *  - журнал продаж по кассе (литры по ТТК) и сверка «продано больше, чем вскрыто».
 * Очередь отправляется вручную (отметка «отправлено» с номером квитанции); следующий этап —
 * мост к УТМ, который будет забирать ту же очередь.
 */

var ALCO_CATEGORIES_ = ['крепкий', 'вино', 'слабоалкогольный', 'пиво_разлив', 'пиво_тара'];
var ALCO_LICENSE_WARN_DAYS_ = [90, 30, 7, 0];

function _alcoNum_(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function _alcoDate_(v, name) {
  var d = String(v || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('Укажите ' + name + ' в формате ГГГГ-ММ-ДД.');
  return d;
}
/** Дата события по часовому поясу скрипта (вскрытие хранится в UTC: 00:30 МСК — ещё «вчера» по UTC). */
function _alcoLocalDay_(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso).slice(0, 10) : Utilities.formatDate(d, Session.getScriptTimeZone() || 'Etc/UTC', 'yyyy-MM-dd');
}
function _alcoDays_(from, to) { return Math.round((new Date(to + 'T12:00:00Z') - new Date(from + 'T12:00:00Z')) / 86400000); }

/** Карточки организации по product_id. Нет листа (система не обновлена) — считаем, что алкоголя нет. */
function _alcoCards_(organizationId) {
  var out = {};
  var rows;
  try { rows = findRows_('ALCO_PRODUCTS', function (r) { return r.organization_id === organizationId && r.статус !== 'архив'; }); }
  catch (e) { return out; }
  rows.forEach(function (r) { out[r.product_id] = r; });
  return out;
}

// ---------- Лицензия ----------

function _alcoLicense_(session, date) {
  date = date || todayDateStr_();
  return findRows_('ALCO_LICENSES', function (l) {
    return l.organization_id === session.organization_id && l.location_id === session.location_id && l.статус === 'действует' &&
      String(l.выдана).slice(0, 10) <= date && String(l.действует_до).slice(0, 10) >= date;
  })[0] || null;
}

function alcoSaveLicense_(data, session) {
  return withLock_(function () {
    if (!session.location_id) throw new Error('Выберите точку: лицензия выдаётся на адрес.');
    var number = String(data.номер || '').trim();
    if (number.length < 3) throw new Error('Укажите номер лицензии.');
    var from = _alcoDate_(data.выдана, 'дату выдачи'), to = _alcoDate_(data.действует_до, 'срок действия');
    if (to <= from) throw new Error('Срок действия должен быть позже даты выдачи.');
    findRows_('ALCO_LICENSES', function (l) { return l.organization_id === session.organization_id && l.location_id === session.location_id && l.статус === 'действует'; })
      .forEach(function (l) { updateRow_('ALCO_LICENSES', l, { статус: 'заменена' }); });
    var row = { license_id: generateId_('ALCO_LICENSES'), organization_id: session.organization_id, location_id: session.location_id, номер: number.slice(0, 60),
      вид: String(data.вид || 'Розничная продажа алкогольной продукции при оказании услуг общественного питания').slice(0, 200),
      выдана: from, действует_до: to, орган: String(data.орган || '').trim().slice(0, 200), статус: 'действует', создано: nowIso_(), user_id: session.user_id };
    insertRow_('ALCO_LICENSES', row);
    auditLog_(session.user_id, 'Алкогольная лицензия', 'ALCO_LICENSES:' + row.license_id, null, number + ' до ' + to, 'success', session.cascade_id || '');
    return row;
  });
}

/** Касса: блюдо с алкоголем (напрямую или через ПФ) без действующей лицензии не продаётся. */
function _alcoAssertSaleAllowed_(dish, session) {
  var cards = _alcoCards_(session.organization_id);
  if (!Object.keys(cards).length) return;
  var hasAlco = false;
  (function walk(type, id, depth) {
    if (hasAlco || depth > 3) return;
    getRecipeLines_(type, id).forEach(function (l) {
      if (cards[l.product_id]) hasAlco = true;
      else if (String(l.product_id).indexOf('PF-') === 0) walk('PF', l.product_id, depth + 1);
    });
  })('DISH', dish.dish_id, 0);
  if (hasAlco && !_alcoLicense_(session)) throw new Error('Продажа алкоголя запрещена: на точке нет действующей алкогольной лицензии («' + dish.название + '»).');
}

// ---------- Карточки ----------

function alcoSaveProduct_(data, session) {
  return withLock_(function () {
    var p = getProductById_(data.productId);
    assertOwnedByOrg_(session, p, 'PRODUCTS:' + data.productId);
    if (p.единица !== 'л') throw new Error('Алкоголь учитывается в литрах: у продукта «' + p.название + '» единица «' + p.единица + '», нужна «л».');
    var cat = String(data.категория || '');
    if (ALCO_CATEGORIES_.indexOf(cat) === -1) throw new Error('Выберите категорию: ' + ALCO_CATEGORIES_.join(', ') + '.');
    var vol = _alcoNum_(data.объём_тары_л), abv = _alcoNum_(data.крепость);
    if (!(vol > 0 && vol <= 100)) throw new Error('Ёмкость тары — от 0,01 до 100 л.');
    if (!(abv >= 0.5 && abv <= 96)) throw new Error('Крепость — от 0,5 до 96 %.');
    var kind = String(data.код_вида || '').trim();
    if (!/^\d{3}$/.test(kind)) throw new Error('Код вида продукции — 3 цифры (например, 200 — водка).');
    var alcocode = String(data.алкокод || '').trim();
    if (alcocode && !/^\d{1,19}$/.test(alcocode)) throw new Error('Алкокод — только цифры, до 19 знаков.');
    var fields = { алкокод: alcocode, код_вида: kind, категория: cat, объём_тары_л: round2_(vol), крепость: round2_(abv),
      производитель: String(data.производитель || '').trim().slice(0, 200), маркировка: cat.indexOf('пиво') === 0 ? 'ЧЗ' : 'ЕГАИС', статус: 'активна', обновлено: nowIso_() };
    var cur = _alcoCards_(session.organization_id)[p.product_id];
    if (cur) updateRow_('ALCO_PRODUCTS', cur, fields);
    else { fields.alco_id = generateId_('ALCO_PRODUCTS'); fields.organization_id = session.organization_id; fields.product_id = p.product_id; insertRow_('ALCO_PRODUCTS', fields); }
    return Object.assign({ product_id: p.product_id, название: p.название }, fields);
  });
}

function alcoGetProducts_(session) {
  var cards = _alcoCards_(session.organization_id);
  return findRows_('PRODUCTS', function (p) { return p.organization_id === session.organization_id && p.единица === 'л'; }).map(function (p) {
    var c = cards[p.product_id];
    return { product_id: p.product_id, название: p.название, карточка: c ? { алкокод: c.алкокод, код_вида: c.код_вида, категория: c.категория, объём_тары_л: _alcoNum_(c.объём_тары_л),
      крепость: _alcoNum_(c.крепость), производитель: c.производитель, маркировка: c.маркировка } : null };
  }).sort(function (a, b) { return (!!b.карточка - !!a.карточка) || String(a.название).localeCompare(String(b.название)); });
}

// ---------- Марки ----------

/** Акцизная марка ЕГАИС: PDF417, 68 или 150 символов [0-9A-Z]. Код «Честного знака»: 01 + GTIN(14) + 21 + серийный. */
function _alcoParseMark_(raw, system) {
  var s = String(raw || '').replace(/[\r\n]/g, '').trim();
  if (system === 'ЧЗ') {
    var key = s.split('\u001d')[0].replace(/\s/g, '');
    if (!/^01\d{14}21/.test(key) || key.length < 23) throw new Error('Это не код «Честного знака» (ожидается 01 + GTIN + 21 + серийный номер).');
    return { марка: s, ключ: key.slice(0, 40) };
  }
  var up = s.toUpperCase();
  if (!/^[0-9A-Z]{68}$/.test(up) && !/^[0-9A-Z]{150}$/.test(up)) throw new Error('Это не акцизная марка: ожидается 68 или 150 символов (цифры и латинские буквы), отсканировано ' + up.length + '.');
  return { марка: up, ключ: up };
}

function _alcoMarkByKey_(organizationId, key) {
  return findRows_('ALCO_MARKS', function (m) { return m.organization_id === organizationId && m.ключ === key; })[0] || null;
}

function alcoReceiveMarks_(data, session) {
  return withLock_(function () {
    var batch = findOne_('BATCHES', 'batch_id', data.batchId);
    if (!batch || batch.location_id !== session.location_id) throw new Error('Партия не найдена на этой точке.');
    var card = _alcoCards_(session.organization_id)[batch.product_id];
    if (!card) throw new Error('У продукта партии нет карточки алкоголя — заполните её в разделе «Алкоголь».');
    var marks = (data.marks || []).map(function (m) { return String(m || '').trim(); }).filter(Boolean);
    if (!marks.length) throw new Error('Отсканируйте хотя бы одну марку.');
    var vol = _alcoNum_(card.объём_тары_л);
    var capacity = Math.floor(_alcoNum_(batch.количество) / vol + 1e-6);
    var already = findRows_('ALCO_MARKS', function (m) { return m.batch_id === batch.batch_id; }).length;
    if (already + marks.length > capacity) throw new Error('В партии ' + capacity + ' шт. по ' + vol + ' л, уже принято ' + already + ' — нельзя принять ещё ' + marks.length + '.');
    var parsed = [], seen = {};
    marks.forEach(function (raw, i) {
      var p;
      try { p = _alcoParseMark_(raw, card.маркировка); } catch (e) { throw new Error('Марка №' + (i + 1) + ': ' + e.message); }
      if (seen[p.ключ]) throw new Error('Марка №' + (i + 1) + ' отсканирована дважды.');
      if (_alcoMarkByKey_(session.organization_id, p.ключ)) throw new Error('Марка №' + (i + 1) + ' уже есть в системе — повторный приём одной бутылки невозможен.');
      seen[p.ключ] = true; parsed.push(p);
    });
    var now = nowIso_();
    parsed.forEach(function (p) {
      insertRow_('ALCO_MARKS', { mark_id: generateId_('ALCO_MARKS'), organization_id: session.organization_id, location_id: session.location_id, product_id: batch.product_id,
        марка: p.марка, ключ: p.ключ, система: card.маркировка, batch_id: batch.batch_id, объём_л: vol, статус: 'на_складе', принята: now, принял_id: session.user_id,
        вскрыта: '', вскрыл_id: '', ттн: String(data.ттн || '').trim().slice(0, 60) });
    });
    auditLog_(session.user_id, 'Приняты алкогольные марки', 'BATCHES:' + batch.batch_id, null, String(parsed.length), 'success', session.cascade_id || '');
    return { принято: parsed.length, всего_в_партии: already + parsed.length, ёмкость_партии: capacity };
  });
}

/** Вскрытие тары по скану марки (бутылка) или кода кеги. */
function alcoOpen_(data, session) {
  return withLock_(function () {
    var raw = String(data.mark || '').trim();
    if (!raw) throw new Error('Отсканируйте марку.');
    var mark = null;
    ['ЕГАИС', 'ЧЗ'].some(function (sys) {
      try { mark = _alcoMarkByKey_(session.organization_id, _alcoParseMark_(raw, sys).ключ); } catch (e) { mark = null; }
      return !!mark;
    });
    if (!mark) throw new Error('Марка не найдена: её не принимали при приходе. Примите марки партии в разделе «Алкоголь».');
    if (mark.location_id !== session.location_id) throw new Error('Эта бутылка числится на другой точке.');
    var p = getProductById_(mark.product_id);
    var name = p ? p.название : mark.product_id;
    if (mark.статус === 'вскрыта') throw new Error('Бутылка «' + name + '» уже вскрыта ' + String(mark.вскрыта).slice(0, 16).replace('T', ' ') + '.');
    if (mark.статус !== 'на_складе') throw new Error('Марка в статусе «' + mark.статус + '» — вскрыть нельзя.');
    var card = _alcoCards_(session.organization_id)[mark.product_id] || {};
    var now = nowIso_(), today = todayDateStr_();
    updateRow_('ALCO_MARKS', mark, { статус: 'вскрыта', вскрыта: now, вскрыл_id: session.user_id });
    var keg = mark.система === 'ЧЗ';
    var doc = { doc_id: generateId_('ALCO_OUTBOX'), organization_id: session.organization_id, location_id: session.location_id,
      тип: keg ? 'подключение_кеги' : 'вскрытие_тары', система: mark.система, mark_id: mark.mark_id, product_id: mark.product_id,
      алкокод: card.алкокод || '', объём_л: _alcoNum_(mark.объём_л), дата: today, срок_отправки: today, статус: 'к_отправке',
      отправлено: '', номер_квитанции: '', user_id: session.user_id, создано: now };
    insertRow_('ALCO_OUTBOX', doc);
    auditLog_(session.user_id, keg ? 'Подключение кеги' : 'Вскрытие тары', 'ALCO_MARKS:' + mark.mark_id, 'на_складе', 'вскрыта', 'success', session.cascade_id || '');
    return { mark_id: mark.mark_id, название: name, объём_л: doc.объём_л, тип: doc.тип, система: doc.система, doc_id: doc.doc_id,
      напоминание: keg ? 'Отметьте подключение кеги в «Честном знаке» сегодня.' : 'Передайте вскрытие в ЕГАИС сегодня.' };
  });
}

function alcoGetMarks_(data, session) {
  var st = data && data.статус, today = data && data.сегодня ? todayDateStr_() : '';
  var names = {};
  return findRows_('ALCO_MARKS', function (m) { return m.organization_id === session.organization_id && m.location_id === session.location_id && (!st || m.статус === st) && (!today || _alcoLocalDay_(m.вскрыта) === today); })
    .map(function (m) {
      if (!names[m.product_id]) { var p = getProductById_(m.product_id); names[m.product_id] = p ? p.название : m.product_id; }
      return { mark_id: m.mark_id, название: names[m.product_id], product_id: m.product_id, система: m.система, марка_кратко: String(m.ключ).slice(0, 8) + '…' + String(m.ключ).slice(-6),
        объём_л: _alcoNum_(m.объём_л), статус: m.статус, принята: m.принята, вскрыта: m.вскрыта, batch_id: m.batch_id };
    }).sort(function (a, b) { return String(b.вскрыта || b.принята).localeCompare(String(a.вскрыта || a.принята)); });
}

// ---------- Очередь отправки ----------

function alcoGetOutbox_(data, session) {
  var st = (data && data.статус) || 'к_отправке', today = todayDateStr_();
  return findRows_('ALCO_OUTBOX', function (d) { return d.organization_id === session.organization_id && d.location_id === session.location_id && (st === 'все' || d.статус === st); })
    .map(function (d) {
      var p = getProductById_(d.product_id), m = findOne_('ALCO_MARKS', 'mark_id', d.mark_id);
      return { doc_id: d.doc_id, тип: d.тип, система: d.система, название: p ? p.название : d.product_id, алкокод: d.алкокод, объём_л: _alcoNum_(d.объём_л),
        марка: m ? m.марка : '', дата: String(d.дата).slice(0, 10), срок_отправки: String(d.срок_отправки).slice(0, 10), статус: d.статус,
        просрочено: d.статус === 'к_отправке' && String(d.срок_отправки).slice(0, 10) < today, номер_квитанции: d.номер_квитанции, отправлено: d.отправлено };
    }).sort(function (a, b) { return a.дата.localeCompare(b.дата); });
}

function alcoMarkSent_(data, session) {
  return withLock_(function () {
    var ids = data.docIds || [];
    if (!ids.length) throw new Error('Выберите документы.');
    var receipt = String(data.квитанция || '').trim();
    if (receipt.length < 3) throw new Error('Укажите номер квитанции или документа из ЕГАИС / «Честного знака».');
    var n = 0;
    ids.forEach(function (id) {
      var d = findOne_('ALCO_OUTBOX', 'doc_id', id);
      assertOwnedByOrg_(session, d, 'ALCO_OUTBOX:' + id);
      if (d.location_id !== session.location_id) throw new Error('Документ другой точки.');
      if (d.статус === 'отправлено') return;
      updateRow_('ALCO_OUTBOX', d, { статус: 'отправлено', отправлено: nowIso_(), номер_квитанции: receipt.slice(0, 80) });
      n++;
    });
    auditLog_(session.user_id, 'Алкоголь: отправлено вручную', 'ALCO_OUTBOX', null, n + ' / ' + receipt, 'success', session.cascade_id || '');
    return { отмечено: n };
  });
}

// ---------- Журнал продаж и сверка ----------

/** Литры алкоголя на одну порцию блюда: { product_id: литров } (с учётом ПФ). */
function _alcoDishLiters_(dishId, cards, cache) {
  if (cache[dishId]) return cache[dishId];
  var out = {};
  (function walk(type, id, mult, depth) {
    if (depth > 3) return;
    getRecipeLines_(type, id).forEach(function (l) {
      var q = normalizeQty_(_alcoNum_(l.брутто), l.единица) * mult;
      if (cards[l.product_id]) out[l.product_id] = (out[l.product_id] || 0) + q;
      else if (String(l.product_id).indexOf('PF-') === 0) walk('PF', l.product_id, q, depth + 1);
    });
  })('DISH', dishId, 1, 0);
  cache[dishId] = out;
  return out;
}

/** Журнал: по дням и продуктам — продано по кассе (л, возвраты вычитаются) и вскрыто (л). */
function alcoGetJournal_(data, session) {
  var to = data.dateTo ? _alcoDate_(data.dateTo, 'дату') : todayDateStr_();
  var from = data.dateFrom ? _alcoDate_(data.dateFrom, 'дату') : to;
  if (from > to) throw new Error('Начало периода позже конца.');
  if (_alcoDays_(from, to) > 92) throw new Error('Период — не больше 3 месяцев.');
  var cards = _alcoCards_(session.organization_id), cache = {}, rows = {};
  function row(day, pid) {
    var k = day + '|' + pid;
    if (!rows[k]) { var p = getProductById_(pid), c = cards[pid]; rows[k] = { дата: day, product_id: pid, название: p ? p.название : pid, код_вида: c.код_вида, алкокод: c.алкокод,
      объём_тары_л: _alcoNum_(c.объём_тары_л), крепость: _alcoNum_(c.крепость), продано_л: 0, вскрыто_л: 0, вскрыто_шт: 0 }; }
    return rows[k];
  }
  getSales_(session.organization_id, session.location_id, from, to).forEach(function (s) {
    var day = String(s.дата).slice(0, 10);
    if (day < from || day > to || !s.dish_id) return;
    var liters = _alcoDishLiters_(s.dish_id, cards, cache);
    Object.keys(liters).forEach(function (pid) { row(day, pid).продано_л += liters[pid] * _alcoNum_(s.qty); });
  });
  findRows_('ALCO_MARKS', function (m) {
    var d = _alcoLocalDay_(m.вскрыта);
    return m.organization_id === session.organization_id && m.location_id === session.location_id && d && d >= from && d <= to;
  }).forEach(function (m) {
    if (!cards[m.product_id]) return;
    var r = row(_alcoLocalDay_(m.вскрыта), m.product_id);
    r.вскрыто_л += _alcoNum_(m.объём_л); r.вскрыто_шт++;
  });
  var list = Object.keys(rows).map(function (k) { var r = rows[k]; r.продано_л = Math.round(r.продано_л * 1000) / 1000; r.вскрыто_л = round2_(r.вскрыто_л); return r; })
    .sort(function (a, b) { return a.дата.localeCompare(b.дата) || String(a.название).localeCompare(String(b.название)); });
  var totals = {};
  list.forEach(function (r) {
    var t = totals[r.product_id] || (totals[r.product_id] = { product_id: r.product_id, название: r.название, продано_л: 0, вскрыто_л: 0 });
    t.продано_л += r.продано_л; t.вскрыто_л += r.вскрыто_л;
  });
  var check = Object.keys(totals).map(function (k) {
    var t = totals[k]; t.продано_л = Math.round(t.продано_л * 1000) / 1000; t.вскрыто_л = round2_(t.вскрыто_л);
    t.продано_больше = t.продано_л > t.вскрыто_л + 1e-6;
    return t;
  });
  return { from: from, to: to, rows: list, сверка: check, лицензия: _alcoLicense_(session, to) };
}

// ---------- Обзор и фоновые напоминания ----------

function alcoGetOverview_(session) {
  var today = todayDateStr_();
  var lic = _alcoLicense_(session, today);
  var marks = findRows_('ALCO_MARKS', function (m) { return m.organization_id === session.organization_id && m.location_id === session.location_id; });
  var outbox = alcoGetOutbox_({ статус: 'к_отправке' }, session);
  return {
    лицензия: lic ? { номер: lic.номер, действует_до: String(lic.действует_до).slice(0, 10), осталось_дней: _alcoDays_(today, String(lic.действует_до).slice(0, 10)) } : null,
    на_складе: marks.filter(function (m) { return m.статус === 'на_складе'; }).length,
    вскрыто_сегодня: marks.filter(function (m) { return _alcoLocalDay_(m.вскрыта) === today; }).length,
    к_отправке: outbox.length, просрочено: outbox.filter(function (d) { return d.просрочено; }).length,
    карточек: Object.keys(_alcoCards_(session.organization_id)).length
  };
}

function _alcoSystemSession_(organizationId, locationId) {
  return { user_id: 'system', organization_id: organizationId, location_id: locationId, role: 'ADMIN', роль: 'ADMIN', allowed_locations: [locationId], cascade_id: '', operation_id: '' };
}

/** Уведомление один раз: такое же сообщение по точке уже есть — не повторяем. */
function _alcoNotifyOnce_(organizationId, locationId, message, key) {
  var type = CONFIG.NOTIFICATION_TYPES.ALCO;
  var dup = findRows_('NOTIFICATIONS', function (n) { return n.organization_id === organizationId && n.location_id === locationId && n.тип === type && n.сообщение === message; });
  if (dup.length) return false;
  notify_(organizationId, locationId, type, message, key, '');
  return true;
}

/** Ежедневно: лицензии, истекающие через 90/30/7/0 дней, и неотправленные вскрытия прошлых дней. */
function alcoDailyTrigger_() {
  var today = todayDateStr_(), out = { лицензии: 0, просрочки: 0 };
  var rows;
  try { rows = findRows_('ALCO_LICENSES', function (l) { return l.статус === 'действует'; }); } catch (e) { return out; }
  rows.forEach(function (l) {
    var left = _alcoDays_(today, String(l.действует_до).slice(0, 10));
    var step = ALCO_LICENSE_WARN_DAYS_.filter(function (d) { return left <= d; }).pop();
    if (step === undefined) return;
    var msg = left < 0 ? 'Алкогольная лицензия № ' + l.номер + ' истекла ' + String(l.действует_до).slice(0, 10) + ' — продажа алкоголя на точке заблокирована.'
      : 'Алкогольная лицензия № ' + l.номер + ' истекает ' + String(l.действует_до).slice(0, 10) + (step ? ' — осталось меньше ' + step + ' дн.' : ' — сегодня последний день.') + ' Подайте документы на продление.';
    if (_alcoNotifyOnce_(l.organization_id, l.location_id, msg, 'alco_license|' + l.license_id + '|' + (left < 0 ? 'expired' : step))) out.лицензии++;
  });
  var late = {};
  findRows_('ALCO_OUTBOX', function (d) { return d.статус === 'к_отправке' && String(d.срок_отправки).slice(0, 10) < today; }).forEach(function (d) {
    var k = d.organization_id + '|' + d.location_id; late[k] = (late[k] || 0) + 1;
  });
  Object.keys(late).forEach(function (k) {
    var p = k.split('|');
    var msg = 'На ' + today + ' не отправлено в ЕГАИС / «Честный знак» после срока: ' + late[k] + ' док. (вскрытие тары, подключение кег). Отправьте и отметьте в разделе «Алкоголь».';
    if (_alcoNotifyOnce_(p[0], p[1], msg, 'alco_late|' + k + '|' + today)) out.просрочки++;
  });
  return out;
}

/** Партии алкоголя на точке для приёма марок: сколько бутылок и сколько марок уже принято. */
function alcoGetBatches_(session) {
  var cards = _alcoCards_(session.organization_id);
  var counts = {};
  findRows_('ALCO_MARKS', function (m) { return m.organization_id === session.organization_id && m.location_id === session.location_id; })
    .forEach(function (m) { counts[m.batch_id] = (counts[m.batch_id] || 0) + 1; });
  return findRows_('BATCHES', function (b) { return b.location_id === session.location_id && cards[b.product_id] && _alcoNum_(b.количество) > 0; }).map(function (b) {
    var c = cards[b.product_id], p = getProductById_(b.product_id), vol = _alcoNum_(c.объём_тары_л);
    var cap = Math.floor(_alcoNum_(b.количество) / vol + 1e-6);
    return { batch_id: b.batch_id, название: p ? p.название : b.product_id, дата_прихода: String(b.дата_прихода || '').slice(0, 10), литров: _alcoNum_(b.количество),
      бутылок: cap, принято_марок: counts[b.batch_id] || 0, маркировка: c.маркировка };
  }).filter(function (x) { return x.принято_марок < x.бутылок; }).sort(function (a, b) { return String(b.дата_прихода).localeCompare(String(a.дата_прихода)); });
}
