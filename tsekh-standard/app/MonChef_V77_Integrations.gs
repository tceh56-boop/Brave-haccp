// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
/**
 * ЦЕХ Стандарт V77 — интеграция с учётными системами (iiko, R-Keeper, 1С), этап 1: общая основа и загрузка продаж из файла.
 *
 * Продажа из кассы проводится тем же путём, что ручная продажа (журнал продаж J36 → списание склада по партиям V71 → экономика,
 * реестр операций, P&L): _mcSaleWrite_ из MonChef_LegacyBack.gs. Отдельного учёта продаж нет.
 *
 * Первичные записи:
 *  • Инт_Сопоставление — позиция кассы (код или название) → блюдо по ТТК, товар со склада или «не учитывать» (обслуживание, доставка…),
 *    с коэффициентом (сколько единиц ЦЕХ в одной единице кассы). Точное совпадение названия с ТТК/складом сопоставляется само;
 *    остальное не угадывается — строки ждут сопоставления;
 *  • Инт_Продажи — каждая строка продажи из кассы, одна строка — одна запись, ключ ExtKey: повторная загрузка того же или
 *    пересекающегося отчёта ничего не задваивает. Статус: проведена (SaleID), ждёт сопоставления, не учитывается, закрытый период, ошибка;
 *  • Инт_Загрузки — каждая загрузка: система, файл или API, период, сколько проведено, повторов, ждут сопоставления.
 *
 * После сопоставления позиции все её ждущие строки проводятся сразу. Возвраты (количество ≤ 0) не проводятся — оформляются вручную.
 * Записи в закрытом финансовом периоде и в подписанном журнале продаж не проводятся (статус «закрытый период»).
 * Источник продаж — общий (_v77Ingest_): файл и API iiko (MonChef_V77_Iiko.gs). Один день одной системы — один источник: если день уже
 *   загружен файлом, API его не дублирует, и наоборот (строки считаются повторами, в ответе — otherSourceDays).
 */
var MC_V77 = {
  MAP: ['Инт_Сопоставление', ['MapID', 'System', 'ExtID', 'ExtName', 'Kind', 'Target', 'Unit', 'Factor', 'Status', 'Auto', 'CreatedAt', 'CreatedBy', 'OperationID']],
  SALE: ['Инт_Продажи', ['ExtKey', 'ImportID', 'System', 'Date', 'Time', 'CheckNo', 'ExtID', 'ExtName', 'Qty', 'Price', 'Sum', 'Waiter', 'Status', 'SaleID', 'Note', 'UpdatedAt', 'OperationID']],
  IMP: ['Инт_Загрузки', ['ImportID', 'System', 'Source', 'FileName', 'PeriodFrom', 'PeriodTo', 'Lines', 'Recorded', 'Duplicates', 'Pending', 'Skipped', 'ClosedSkipped', 'Errors', 'At', 'By', 'OperationID']]
};
var MC_V77_SYSTEMS = { iiko: 'iiko', rkeeper: 'R-Keeper', '1c': '1С', other: 'Другая касса' };
var MC_V77_STATUS_RU = { RECORDED: 'проведена', PENDING: 'ждёт сопоставления', SKIPPED: 'не учитывается', CLOSED: 'закрытый период', ERROR: 'ошибка' };
var MC_V77_KIND_RU = { DISH: 'блюдо по ТТК', GOODS: 'товар со склада', SKIP: 'не учитывать' };

/** Названия колонок отчётов касс (iiko OLAP, R-Keeper, общие выгрузки). Первое точное совпадение по порядку, затем начало названия. */
var MC_V77_COLS = {
  date: ['учетный день', 'дата', 'дата чека', 'дата закрытия', 'дата открытия', 'дата закрытия заказа', 'день', 'open date', 'date'],
  time: ['время', 'время закрытия', 'время чека', 'время открытия', 'время закрытия заказа', 'time'],
  check: ['номер чека', '№ чека', 'чек', 'номер заказа', '№ заказа', 'заказ', 'check', 'order'],
  extId: ['код блюда', 'код', 'артикул', 'код товара', 'id блюда', 'id', 'code'],
  name: ['блюдо', 'наименование', 'наименование блюда', 'блюдо/товар', 'товар', 'позиция', 'название', 'dish', 'item'],
  qty: ['количество блюд', 'количество', 'кол-во', 'кол-во блюд', 'кол.', 'qty', 'quantity'],
  price: ['цена', 'цена блюда', 'цена продажи', 'price'],
  sum: ['сумма со скидкой', 'сумма после скидки', 'сумма с учетом скидки', 'выручка', 'сумма', 'стоимость', 'сумма без скидки', 'sum', 'amount'],
  waiter: ['официант', 'кассир', 'продавец', 'официант заказа', 'waiter', 'cashier']
};

function _v77Sh_(k) { return _v64Sheet_(MC_V77[k][0], MC_V77[k][1]); }
function _v77Read_(k) {
  var sh = _v77Sh_(k), head = MC_V77[k][1], n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, head.length).getValues().map(function (r, i) { var o = { _row: i + 2 }; head.forEach(function (h, j) { o[h] = r[j]; }); return o; });
}
function _v77Row_(k, o) { return MC_V77[k][1].map(function (h) { var x = o[h]; return x === undefined || x === null ? '' : x; }); }
function _v77Append_(k, rows) { if (!rows.length) return; var sh = _v77Sh_(k); sh.getRange(sh.getLastRow() + 1, 1, rows.length, MC_V77[k][1].length).setValues(rows); }
function _v77Sys_(s) { s = String(s || '').toLowerCase().replace(/[\s\-_]/g, ''); if (s === 'rk' || s === 'rkeeper' || s === 'ркипер') s = 'rkeeper'; if (s === '1с') s = '1c'; return MC_V77_SYSTEMS[s] ? s : ''; }
function _v77R2_(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function _v77R3_(x) { return Math.round((Number(x) || 0) * 1000) / 1000; }
function _v77Norm_(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[ \s]+/g, ' ').trim(); }
function _v77Hash_(x) { return _v64Hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(x), Utilities.Charset.UTF_8)).slice(0, 20); }
function _v77Num_(x) {
  if (typeof x === 'number') return x;
  var s = String(x === undefined || x === null ? '' : x).replace(/[ \s]/g, '').replace(/[₽р]\.?$/i, '').replace(',', '.');
  if (!s) return NaN;
  return /^-?\d+(\.\d+)?$/.test(s) ? parseFloat(s) : NaN;
}
function _v77Pad_(n) { return ('0' + n).slice(-2); }
/** Дата из отчёта: Date, «дд.мм.гггг[ чч:мм]», «гггг-мм-дд[ чч:мм]», «дд.мм.гг». → {day: Date (полночь), time: 'ЧЧ:ММ' | ''} или null. */
function _v77When_(x) {
  if (Object.prototype.toString.call(x) === '[object Date]' && !isNaN(x.getTime())) {
    var hm = x.getHours() || x.getMinutes() ? _v77Pad_(x.getHours()) + ':' + _v77Pad_(x.getMinutes()) : '';
    return { day: new Date(x.getFullYear(), x.getMonth(), x.getDate()), time: hm };
  }
  if (typeof x === 'number' && x > 20000 && x < 80000) {   // дата Excel (число дней с 30.12.1899, дробь — время)
    var u = new Date(Math.round((x - 25569) * 86400000)), um = u.getUTCHours() * 60 + u.getUTCMinutes();
    return { day: new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()), time: um ? _v77Pad_(u.getUTCHours()) + ':' + _v77Pad_(u.getUTCMinutes()) : '' };
  }
  var s = String(x || '').trim(), m, y, mo, d, t = '';
  if ((m = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4}|\d{2})(?:[ T,]+(\d{1,2}):(\d{2}))?/.exec(s))) { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; if (m[4]) t = _v77Pad_(+m[4]) + ':' + m[5]; }
  else if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2}))?/.exec(s))) { y = +m[1]; mo = +m[2]; d = +m[3]; if (m[4]) t = _v77Pad_(+m[4]) + ':' + m[5]; }
  else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { day: new Date(y, mo - 1, d), time: t };
}
function _v77Time_(x) {
  if (Object.prototype.toString.call(x) === '[object Date]') return _v77Pad_(x.getHours()) + ':' + _v77Pad_(x.getMinutes());
  if (typeof x === 'number' && x >= 0 && x < 1) { var mm = Math.round(x * 1440) % 1440; return _v77Pad_(Math.floor(mm / 60)) + ':' + _v77Pad_(mm % 60); }   // время Excel
  var m = /^\s*(\d{1,2}):(\d{2})/.exec(String(x || '')); return m && +m[1] < 24 ? _v77Pad_(+m[1]) + ':' + m[2] : '';
}
function _v77DayIso_(d) { return d.getFullYear() + '-' + _v77Pad_(d.getMonth() + 1) + '-' + _v77Pad_(d.getDate()); }
function _v77DayRu_(d) { return _v77Pad_(d.getDate()) + '.' + _v77Pad_(d.getMonth() + 1) + '.' + d.getFullYear(); }

/* ---------------- чтение файла отчёта ---------------- */

/** CSV/TSV → строки. Разделитель — «;», табуляция или «,» (по первым строкам), кавычки по RFC 4180. */
function _v77ParseCsv_(text) {
  text = String(text || '').replace(/^﻿/, '');
  var head = text.split(/\r?\n/).slice(0, 15).join('\n'), cnt = function (c) { return head.split(c).length - 1; };
  var sep = cnt('\t') > cnt(';') && cnt('\t') > cnt(',') ? '\t' : (cnt(';') >= cnt(',') ? ';' : ',');
  var rows = [], row = [], cell = '', q = false;
  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"' && cell === '') { q = true; continue; }
    if (ch === sep) { row.push(cell); cell = ''; continue; }
    if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function _v77HeadNorm_(s) { return _v77Norm_(s).replace(/[,(].*$/, '').replace(/\s*[:.]$/, '').trim(); }
/** Ищет строку заголовка (в первых 40 строках) и колонки. cols — явное указание {поле: 'Название колонки'}. → {row, map: {поле: индекс}, names} или null. */
function _v77Columns_(rows, cols) {
  cols = cols || {};
  for (var r = 0; r < Math.min(rows.length, 40); r++) {
    var cells = (rows[r] || []).map(function (c) { return _v77HeadNorm_(c); }), map = {}, used = {};
    Object.keys(MC_V77_COLS).forEach(function (f) {
      var pick = -1;
      if (cols[f]) pick = cells.indexOf(_v77HeadNorm_(cols[f]));
      if (pick < 0) MC_V77_COLS[f].some(function (syn) { var i = cells.indexOf(syn); if (i >= 0 && !used[i]) { pick = i; return true; } return false; });
      if (pick < 0) MC_V77_COLS[f].some(function (syn) { for (var i = 0; i < cells.length; i++) if (!used[i] && cells[i] && cells[i].indexOf(syn) === 0) { pick = i; return true; } return false; });
      if (pick >= 0) { map[f] = pick; used[pick] = true; }
    });
    if (map.name !== undefined && map.qty !== undefined && (map.sum !== undefined || map.price !== undefined)) {
      var names = {}; Object.keys(map).forEach(function (f) { names[f] = String(rows[r][map[f]] || '').trim(); });
      return { row: r, map: map, names: names };
    }
  }
  return null;
}
/** Строки отчёта → строки продаж {day, time, check, extId, name, qty, price, sum, waiter}. defDate — дата, если в отчёте её нет. */
function _v77Lines_(rows, cols, defDate) {
  var C = _v77Columns_(rows, cols);
  if (!C) throw new Error('не найдена строка заголовка: нужны колонки «Блюдо» (или «Наименование»), «Количество» и «Сумма» (или «Цена»)');
  var def = defDate ? _v77When_(defDate) : null, out = [], errors = [], m = C.map;
  if (m.date === undefined && !def) throw new Error('в отчёте нет колонки с датой — укажите дату продаж');
  var g = function (r, f) { return m[f] === undefined ? '' : r[m[f]]; };
  for (var i = C.row + 1; i < rows.length; i++) {
    var r = rows[i] || [], name = String(g(r, 'name') || '').trim();
    if (!name || /^(итого|всего|total)/i.test(name) || /^(итого|всего|total)/i.test(String(r[0] || '').trim())) continue;
    var qty = _v77Num_(g(r, 'qty')), price = _v77Num_(g(r, 'price')), sum = _v77Num_(g(r, 'sum'));
    if (isNaN(qty)) { errors.push('строка ' + (i + 1) + ': количество «' + g(r, 'qty') + '» не число'); continue; }
    if (isNaN(sum) && isNaN(price)) { errors.push('строка ' + (i + 1) + ': нет суммы и цены'); continue; }
    if (isNaN(sum)) sum = _v77R2_(qty * price);
    if (isNaN(price)) price = qty ? _v77R2_(sum / qty) : 0;
    var w = m.date !== undefined ? _v77When_(g(r, 'date')) : def;
    if (!w) { errors.push('строка ' + (i + 1) + ': дата «' + g(r, 'date') + '» не распознана'); continue; }
    out.push({ day: w.day, time: _v77Time_(g(r, 'time')) || w.time || '', check: String(g(r, 'check') || '').trim(), extId: String(g(r, 'extId') || '').trim(), name: name,
      qty: qty, price: price, sum: sum, waiter: String(g(r, 'waiter') || '').trim(), row: i + 1 });
  }
  return { lines: out, errors: errors, columns: C.names };
}

/* ---------------- сопоставление ---------------- */
function _v77MapKey_(extId, name) { return extId ? 'id:' + String(extId).trim() : 'name:' + _v77Norm_(name); }
function _v77Maps_(system) {
  var by = {};
  _v77Read_('MAP').forEach(function (x) {
    if (String(x.Status) !== 'ACTIVE' || (system && String(x.System) !== system)) return;
    var o = { id: String(x.MapID), system: String(x.System), extId: String(x.ExtID || ''), name: String(x.ExtName || ''), kind: String(x.Kind), target: String(x.Target || ''),
      unit: String(x.Unit || ''), factor: Number(x.Factor) || 1, auto: !!x.Auto, row: x._row };
    by[o.system + '|' + _v77MapKey_(o.extId, o.name)] = o;
    if (o.extId) by[o.system + '|' + _v77MapKey_('', o.name)] = by[o.system + '|' + _v77MapKey_('', o.name)] || o;
  });
  return by;
}
function _v77FindMap_(maps, system, l) { return maps[system + '|' + _v77MapKey_(l.extId, l.name)] || maps[system + '|' + _v77MapKey_('', l.name)] || null; }
/** Точное совпадение названия с блюдом ТТК или товаром склада — не угадывание; иначе null. */
function _v77AutoMatch_(name, idx) {
  var R = _v71Resolve_(name, 'dish', null, idx);
  if (!R.error) return { kind: 'DISH', target: R.name, unit: '' };
  var G = null; try { G = _v71Resolve_(name, 'goods', null, idx); } catch (e) { G = null; }
  if (G && !G.error) return { kind: 'GOODS', target: G.name, unit: G.unit };
  return null;
}

/* ---------------- проведение ---------------- */
function _v77Key_(system, l, occ) {
  if (l.extLineId) return system + ':' + String(l.extLineId);
  return system + ':' + _v77Hash_([_v77DayIso_(l.day), l.time || '', l.check || '', l.extId || _v77Norm_(l.name), _v77R3_(l.qty), _v77R2_(l.sum)]) + '#' + occ;
}
/** Провести одну строку: сопоставление → журнал продаж и склад. ctx: {op, system, maps, idx, sh, j, newMaps[]}. → {status, saleId, note}. */
function _v77Post_(ctx, l) {
  if (!(l.qty > 0)) return { status: 'SKIPPED', note: 'возврат или нулевое количество — не проводится, оформите вручную' };
  var mp = _v77FindMap_(ctx.maps, ctx.system, l);
  if (!mp) {
    var a = _v77AutoMatch_(l.name, ctx.idx);
    if (!a) return { status: 'PENDING', note: 'нет в ТТК и на складе под таким названием — сопоставьте позицию' };
    mp = { id: _v64Id_('MAP'), system: ctx.system, extId: l.extId || '', name: l.name, kind: a.kind, target: a.target, unit: a.unit, factor: 1, auto: true };
    ctx.maps[ctx.system + '|' + _v77MapKey_(mp.extId, mp.name)] = mp;
    if (mp.extId) ctx.maps[ctx.system + '|' + _v77MapKey_('', mp.name)] = mp;
    ctx.newMaps.push(_v77Row_('MAP', { MapID: mp.id, System: ctx.system, ExtID: mp.extId, ExtName: mp.name, Kind: mp.kind, Target: mp.target, Unit: mp.unit, Factor: 1, Status: 'ACTIVE', Auto: 'точное совпадение названия',
      CreatedAt: new Date(), CreatedBy: _v64Who_(ctx.op), OperationID: ctx.op.id }));
  }
  if (mp.kind === 'SKIP') return { status: 'SKIPPED', note: 'позиция «не учитывать» (не блюдо и не товар)' };
  var item = _v71Resolve_(mp.target, mp.kind === 'GOODS' ? 'goods' : 'dish', mp.unit || null, ctx.idx);
  if (item.error) return { status: 'PENDING', note: 'сопоставление «' + mp.target + '» не подходит: ' + item.error };
  var date = _v77DayRu_(l.day);
  try { if (typeof _v64AssertOpen_ === 'function') _v64AssertOpen_(l.day, 'продажа'); _mcAssertJournalPeriodOpen_('J36', date); }
  catch (e) { return { status: 'CLOSED', note: String(e.message || e).replace(/^[A-Z_]+:\s*/, '') }; }
  var qty = _v77R3_(l.qty * (mp.factor || 1)), sum = _v77R2_(l.sum), price = qty ? _v77R2_(sum / qty) : 0, label = MC_V77_SYSTEMS[ctx.system];
  var w = _mcSaleWrite_(ctx.op, ctx.sh, ctx.j, { date: date, time: l.time || '12:00', dish: item.name, qty: qty, price: price, sum: sum,
    seller: { name: l.waiter || ('Касса ' + label), position: '' }, item: item, unitLbl: item.kind === 'GOODS' ? item.unit : 'порц.', idx: ctx.idx,
    source: 'загрузка ' + label + (l.check ? ' · чек ' + l.check : ''), ext: l.key, check: l.check || '', how: 'загрузка ' + label });
  var st = w.stock;
  return { status: 'RECORDED', saleId: w.saleId, note: st && st.status !== 'FULL' ? (st.statusRu + (st.short && st.short.length ? ': не хватило ' + st.short.map(function (s) { return s.product; }).join(', ') : '')) : '' };
}
function _v77Ctx_(op, system) {
  var j = _mcJById_('J36');
  return { op: op, system: system, maps: _v77Maps_(system), idx: _buildDishIndexes_(), j: j, sh: _book_().getSheetByName(j.sheetName) || _createJournalSheet_(j), newMaps: [] };
}

/**
 * Общий вход для всех источников продаж (файл, API). Вызывать под блокировкой.
 * lines: [{day: Date, time, check, extId, extLineId?, name, qty, price, sum, waiter}]. meta: {source 'FILE'|'API', fileName}.
 */
function _v77Ingest_(op, system, lines, meta) {
  meta = meta || {};
  // один день — один источник (файл или API): отчёт по чекам из файла и сгруппированный OLAP из API дают разные ключи одних и тех же продаж
  var src = meta.source === 'API' ? 'API' : 'FILE', impSrc = {}, daySrc = {}, have = {};
  _v77Read_('IMP').forEach(function (x) { impSrc[String(x.ImportID)] = String(x.Source) === 'API' ? 'API' : 'FILE'; });
  _v77Read_('SALE').forEach(function (x) { have[String(x.ExtKey)] = true; if (String(x.System) === system) daySrc[_v72DayStr_(x.Date)] = impSrc[String(x.ImportID)] || 'FILE'; });
  var ctx = _v77Ctx_(op, system), impId = _v64Id_('INT'), now = new Date(), occ = {}, cnt = { RECORDED: 0, PENDING: 0, SKIPPED: 0, CLOSED: 0, ERROR: 0 }, dups = 0, other = {}, from = null, to = null, pending = {};
  lines.forEach(function (l) {
    var base = _v77Key_(system, l, 0); occ[base] = (occ[base] || 0) + 1;
    l.key = l.extLineId ? base : base.replace(/#0$/, '#' + occ[base]);
    if (have[l.key]) { dups++; return; }
    var dIso = _v77DayIso_(l.day);
    if (daySrc[dIso] && daySrc[dIso] !== src) { other[dIso] = (other[dIso] || 0) + 1; return; }
    daySrc[dIso] = src;
    have[l.key] = true;
    if (!from || l.day < from) from = l.day; if (!to || l.day > to) to = l.day;
    var res;
    try { res = _v77Post_(ctx, l); } catch (e) { res = { status: 'ERROR', note: String(e.message || e) }; }
    cnt[res.status]++;
    if (res.status === 'PENDING') { var pk = _v77MapKey_(l.extId, l.name); pending[pk] = pending[pk] || { extId: l.extId, name: l.name, lines: 0, sum: 0 }; pending[pk].lines++; pending[pk].sum = _v77R2_(pending[pk].sum + l.sum); }
    _v77Append_('SALE', [_v77Row_('SALE', { ExtKey: l.key, ImportID: impId, System: system, Date: _v77DayIso_(l.day), Time: l.time, CheckNo: l.check, ExtID: l.extId, ExtName: l.name, Qty: l.qty, Price: l.price, Sum: l.sum,
      Waiter: l.waiter, Status: res.status, SaleID: res.saleId || '', Note: res.note || '', UpdatedAt: now, OperationID: op.id })]);
  });
  _v77Append_('MAP', ctx.newMaps);
  var errors = (meta.errors || []).length + cnt.ERROR;
  _v77Append_('IMP', [_v77Row_('IMP', { ImportID: impId, System: system, Source: meta.source || 'FILE', FileName: meta.fileName || '', PeriodFrom: from ? _v77DayIso_(from) : '', PeriodTo: to ? _v77DayIso_(to) : '',
    Lines: lines.length, Recorded: cnt.RECORDED, Duplicates: dups + Object.keys(other).reduce(function (a, k) { return a + other[k]; }, 0), Pending: cnt.PENDING, Skipped: cnt.SKIPPED, ClosedSkipped: cnt.CLOSED, Errors: errors, At: now, By: _v64Who_(op), OperationID: op.id })]);
  _audit_(op, 'V77_IMPORT', MC_V77.IMP[0], impId, null, { система: MC_V77_SYSTEMS[system], файл: meta.fileName || '', строк: lines.length, проведено: cnt.RECORDED, повторов: dups, ждут: cnt.PENDING });
  return { importId: impId, system: system, systemRu: MC_V77_SYSTEMS[system], lines: lines.length, recorded: cnt.RECORDED, duplicates: dups, pending: cnt.PENDING, skipped: cnt.SKIPPED, closedSkipped: cnt.CLOSED,
    errors: cnt.ERROR, autoMapped: ctx.newMaps.length, otherSource: Object.keys(other).reduce(function (a, k) { return a + other[k]; }, 0),
    otherSourceDays: Object.keys(other).sort().map(function (k) { return { day: k, lines: other[k], loadedBy: src === 'API' ? 'файлом' : 'по API' }; }), from: from ? _v77DayIso_(from) : '', to: to ? _v77DayIso_(to) : '',
    pendingItems: Object.keys(pending).map(function (k) { return pending[k]; }) };
}

/* ---------------- вызовы экрана ---------------- */

/** Загрузить продажи из отчёта кассы. json: {system, text (CSV) | rows (из Excel), fileName, date? (если в отчёте нет даты), cols?, dry?}. dry — только показать, что найдено. */
function v77ImportSales(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'finance_edit', 'V77_IMPORT', 'Интеграции', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), system = _v77Sys_(d.system);
    if (!system) return _v64Fail_(op, 'VALIDATION', 'Выберите учётную систему: iiko, R-Keeper, 1С или другая касса');
    var rows = Array.isArray(d.rows) ? d.rows : _v77ParseCsv_(d.text);
    if (!rows.length) return _v64Fail_(op, 'VALIDATION', 'Файл пустой');
    var P; try { P = _v77Lines_(rows, d.cols, d.date); } catch (pe) { return _v64Fail_(op, 'VALIDATION', 'Не удалось прочитать отчёт: ' + (pe.message || pe)); }
    if (!P.lines.length) return _v64Fail_(op, 'VALIDATION', 'В отчёте нет строк продаж' + (P.errors.length ? ': ' + P.errors.slice(0, 3).join('; ') : ''));
    if (d.dry) {
      var idx = _buildDishIndexes_(), maps = _v77Maps_(system), names = {}, days = P.lines.map(function (l) { return _v77DayIso_(l.day); }).sort();
      P.lines.forEach(function (l) { if (!(l.qty > 0)) return; var k = _v77MapKey_(l.extId, l.name); if (names[k]) { names[k].lines++; return; }
        var mp = _v77FindMap_(maps, system, l), a = mp ? null : _v77AutoMatch_(l.name, idx);
        names[k] = { extId: l.extId, name: l.name, lines: 1, match: mp ? (MC_V77_KIND_RU[mp.kind] + (mp.target ? ': ' + mp.target : '')) : a ? MC_V77_KIND_RU[a.kind] + ': ' + a.target + ' (по названию)' : '' }; });
      var list = Object.keys(names).map(function (k) { return names[k]; });
      _endOp_(op);
      return _ok_({ dry: true, columns: P.columns, lines: P.lines.length, from: days[0], to: days[days.length - 1], errors: P.errors.slice(0, 20),
        sum: _v77R2_(P.lines.reduce(function (a, l) { return a + l.sum; }, 0)), items: list.length, unmatched: list.filter(function (x) { return !x.match; }), sample: P.lines.slice(0, 5).map(function (l) { return { date: _v77DayIso_(l.day), time: l.time, check: l.check, name: l.name, qty: l.qty, sum: l.sum }; }) }, op.id);
    }
    return _withLock_(function () {
      var res = _v77Ingest_(op, system, P.lines, { source: 'FILE', fileName: String(d.fileName || ''), errors: P.errors });
      res.parseErrors = P.errors.slice(0, 20); res.columns = P.columns;
      _endOp_(op);
      return _ok_(res, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Сопоставить позицию кассы и провести её ждущие строки. json: {system, extId?, name, kind: DISH|GOODS|SKIP, target?, unit?, factor?}. */
function v77SaveMapping(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'finance_edit', 'V77_MAP', 'Интеграции', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), system = _v77Sys_(d.system), kind = String(d.kind || '').toUpperCase(), name = String(d.name || '').trim(), extId = String(d.extId || '').trim();
    if (!system) return _v64Fail_(op, 'VALIDATION', 'Не указана учётная система');
    if (!name && !extId) return _v64Fail_(op, 'VALIDATION', 'Не указана позиция кассы');
    if (!MC_V77_KIND_RU[kind]) return _v64Fail_(op, 'VALIDATION', 'Выберите: блюдо по ТТК, товар со склада или «не учитывать»');
    var factor = d.factor === undefined || d.factor === '' ? 1 : _v77Num_(d.factor);
    if (!(factor > 0)) return _v64Fail_(op, 'VALIDATION', 'Коэффициент — число больше нуля');
    var target = '', unit = '';
    if (kind !== 'SKIP') {
      var R = _v71Resolve_(String(d.target || ''), kind === 'GOODS' ? 'goods' : 'dish', d.unit || null);
      if (R.error) return _v64Fail_(op, 'VALIDATION', R.error);
      target = R.name; unit = kind === 'GOODS' ? R.unit : '';
    }
    return _withLock_(function () {
      var key = _v77MapKey_(extId, name), sh = _v77Sh_('MAP');
      _v77Read_('MAP').forEach(function (x) {   // прежнее сопоставление той же позиции — в архив (история остаётся)
        if (String(x.Status) === 'ACTIVE' && String(x.System) === system && (_v77MapKey_(String(x.ExtID || ''), String(x.ExtName || '')) === key || (!extId && _v77Norm_(x.ExtName) === _v77Norm_(name) && !x.ExtID)))
          sh.getRange(x._row, MC_V77.MAP[1].indexOf('Status') + 1).setValue('ARCHIVED');
      });
      var id = _v64Id_('MAP');
      _v77Append_('MAP', [_v77Row_('MAP', { MapID: id, System: system, ExtID: extId, ExtName: name, Kind: kind, Target: target, Unit: unit, Factor: factor, Status: 'ACTIVE', Auto: '', CreatedAt: new Date(), CreatedBy: _v64Who_(op), OperationID: op.id })]);
      var ap = _v77ApplyPending_(op, system, function (l) { return (extId && l.extId === extId) || _v77Norm_(l.name) === _v77Norm_(name); });
      _audit_(op, 'V77_MAP', MC_V77.MAP[0], id, null, { система: MC_V77_SYSTEMS[system], позиция: name || extId, вид: MC_V77_KIND_RU[kind], цель: target, коэффициент: factor, проведено: ap.recorded });
      _endOp_(op);
      return _ok_({ mapId: id, kind: kind, target: target, applied: ap.applied, recorded: ap.recorded, skipped: ap.skipped, stillPending: ap.pending, closed: ap.closed }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Провести ждущие строки (после сопоставления). match(l) — какие строки. Под блокировкой. */
function _v77ApplyPending_(op, system, match) {
  var ctx = _v77Ctx_(op, system), sh = _v77Sh_('SALE'), H = MC_V77.SALE[1], out = { applied: 0, recorded: 0, skipped: 0, pending: 0, closed: 0 };
  _v77Read_('SALE').forEach(function (x) {
    if (String(x.System) !== system || String(x.Status) !== 'PENDING') return;
    var w = _v77When_(x.Date), l = { key: String(x.ExtKey), day: w ? w.day : null, time: _v77Time_(x.Time), check: String(x.CheckNo || ''), extId: String(x.ExtID || ''), name: String(x.ExtName || ''),
      qty: Number(x.Qty) || 0, price: Number(x.Price) || 0, sum: Number(x.Sum) || 0, waiter: String(x.Waiter || '') };
    if (!l.day || !match(l)) return;
    var res; try { res = _v77Post_(ctx, l); } catch (e) { res = { status: 'ERROR', note: String(e.message || e) }; }
    out.applied++; if (res.status === 'RECORDED') out.recorded++; else if (res.status === 'SKIPPED') out.skipped++; else if (res.status === 'CLOSED') out.closed++; else if (res.status === 'PENDING') out.pending++;
    sh.getRange(x._row, H.indexOf('Status') + 1, 1, 5).setValues([[res.status, res.saleId || '', res.note || '', new Date(), op.id]]);
  });
  _v77Append_('MAP', ctx.newMaps);
  return out;
}

/** Экран «Кассы и 1С»: загрузки, позиции без сопоставления, сопоставления, справочники для выбора. */
function v77GetIntegrations(token) {
  try {
    _requireAuth_(token, 'finance_view');
    var sales = _v77Read_('SALE'), pend = {}, st = { RECORDED: 0, PENDING: 0, SKIPPED: 0, CLOSED: 0, ERROR: 0 };
    sales.forEach(function (x) {
      var s = String(x.Status); st[s] = (st[s] || 0) + 1;
      if (s !== 'PENDING') return;
      var k = String(x.System) + '|' + _v77MapKey_(String(x.ExtID || ''), String(x.ExtName || ''));
      var p = pend[k] || (pend[k] = { system: String(x.System), systemRu: MC_V77_SYSTEMS[String(x.System)] || String(x.System), extId: String(x.ExtID || ''), name: String(x.ExtName || ''), lines: 0, qty: 0, sum: 0, note: String(x.Note || '') });
      p.lines++; p.qty = _v77R3_(p.qty + (Number(x.Qty) || 0)); p.sum = _v77R2_(p.sum + (Number(x.Sum) || 0));
    });
    var maps = _v77Read_('MAP').filter(function (x) { return String(x.Status) === 'ACTIVE'; }).map(function (x) {
      return { id: String(x.MapID), system: String(x.System), systemRu: MC_V77_SYSTEMS[String(x.System)] || String(x.System), extId: String(x.ExtID || ''), name: String(x.ExtName || ''), kind: String(x.Kind),
        kindRu: MC_V77_KIND_RU[String(x.Kind)] || String(x.Kind), target: String(x.Target || ''), unit: String(x.Unit || ''), factor: Number(x.Factor) || 1, auto: String(x.Auto || '') };
    }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); });
    var imports = _v77Read_('IMP').reverse().slice(0, 30).map(function (x) {
      return { id: String(x.ImportID), systemRu: MC_V77_SYSTEMS[String(x.System)] || String(x.System), source: String(x.Source) === 'API' ? 'API' : 'файл', fileName: String(x.FileName || ''),
        from: x.PeriodFrom ? _v72DayStr_(x.PeriodFrom) : '', to: x.PeriodTo ? _v72DayStr_(x.PeriodTo) : '', lines: Number(x.Lines) || 0, recorded: Number(x.Recorded) || 0, duplicates: Number(x.Duplicates) || 0,
        pending: Number(x.Pending) || 0, skipped: Number(x.Skipped) || 0, closed: Number(x.ClosedSkipped) || 0, errors: Number(x.Errors) || 0, at: x.At instanceof Date ? Utilities.formatDate(x.At, _mcTz_(), 'dd.MM.yyyy HH:mm') : String(x.At || ''), by: String(x.By || '') };
    });
    var problems = sales.filter(function (x) { return String(x.Status) === 'ERROR' || (String(x.Status) === 'RECORDED' && x.Note); }).slice(-50).reverse().map(function (x) {
      return { date: _v72DayStr_(x.Date), check: String(x.CheckNo || ''), name: String(x.ExtName || ''), qty: Number(x.Qty) || 0, statusRu: MC_V77_STATUS_RU[String(x.Status)] || String(x.Status), saleId: String(x.SaleID || ''), note: String(x.Note || '') };
    });
    var idx = _buildDishIndexes_(), dishes = Object.keys(idx.dishByCode).map(function (c) { return idx.dishByCode[c]; }).filter(function (d) { return !d.semi; }).map(function (d) { return String(d.name); })
      .sort(function (a, b) { return a.localeCompare(b, 'ru'); });
    var goods = []; try { goods = _v71GoodsList_(idx).map(function (g) { return { name: g.name, unit: g.unit }; }); } catch (e) {}
    return _ok_({ iiko: typeof _v77IikoPublic_ === 'function' ? _v77IikoPublic_(_v77IikoCfg_()) : null, onec: typeof _v77OneCPublic_ === 'function' ? _v77OneCPublic_(_v77OneCCfg_()) : null, systems: Object.keys(MC_V77_SYSTEMS).map(function (k) { return { id: k, name: MC_V77_SYSTEMS[k] }; }), counts: st,
      pending: Object.keys(pend).map(function (k) { return pend[k]; }).sort(function (a, b) { return b.sum - a.sum; }), mappings: maps, imports: imports, problems: problems, dishes: dishes, goods: goods,
      note: 'Продажи из кассы проводятся как обычные продажи: журнал продаж, списание склада по партиям, экономика. Повторная загрузка того же отчёта ничего не задваивает. ' +
        'Позиция без сопоставления не списывается наугад — она ждёт, пока вы укажете блюдо по ТТК или товар; после этого её продажи проводятся сразу. Возвраты оформляются вручную.' });
  } catch (e) { return _failFrom_(e); }
}
