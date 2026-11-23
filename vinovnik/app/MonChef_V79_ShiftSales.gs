/**
 * MonChef V79 — продажи за смену одним подтверждением (17.11.2026).
 *
 * Вместо ввода каждой продажи в зал: в конце смены
 *  • загружается документ о продажах (отчёт кассы по позициям: CSV, Excel/ODS, Google Таблица, PDF с таблицей, текст), или
 *  • вносится список блюд с количествами.
 * Система сопоставляет позиции с ТТК и складом (и запоминает сопоставления «название в кассе → блюдо»), показывает,
 * что спишется со склада, вычитает уже внесённые вручную за эту дату продажи. В журнал ничего не пишется,
 * пока человек не подтвердит весь список (confirm: true). Каждая позиция проводится обычной продажей (mcSaleAdd):
 * журнал продаж J36, списание склада по партиям (V71), аудит. Количества и цены берутся только из документа
 * или из списка, внесённого человеком; нет цены — из «Цен меню», иначе её вводит человек. Ничего не подставляется.
 */
var MC_V79_SHEET_ = 'Продажи_Смена_V79';
var MC_V79_HEAD_ = ['ImportID', 'Дата смены', 'Время', 'Источник', 'Вычитать внесённое вручную', 'Файл', 'FileID', 'SHA-256', 'Позиций', 'Внесено', 'Пропущено', 'Сумма', 'Статус', 'Загрузил', 'Загружено', 'Подтвердил', 'Подтверждено', 'Строки (JSON)', 'Не учтено (JSON)', 'OperationID'];
var MC_V79_MAP_ = 'Продажи_Соответствия_V79';
var MC_V79_MAP_HEAD_ = ['Ключ', 'Название в документе', 'Решение', 'Блюдо / товар', 'Ед.', 'Изменил', 'Изменено'];
var MC_V79_NEED_ = 'banquets|journals';
var MC_V79_STATUS_RU_ = { DRAFT: 'черновик', POSTING: 'вносится', POSTED: 'внесено', PARTIAL: 'внесено не всё', CANCELLED: 'отменён' };
var MC_V79_DIR_ = 'Продажи за смену';

function _v79Sheet_() { return _bcSheet_(MC_V79_SHEET_, MC_V79_HEAD_); }
function _v79MapSheet_() { return _bcSheet_(MC_V79_MAP_, MC_V79_MAP_HEAD_); }
function _v79Rows_(sh, head) {
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues().map(function (r, i) { var o = { _row: i + 2 }; head.forEach(function (h, j) { o[h] = r[j]; }); return o; });
}
function _v79Key_(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/["'«»“”„]/g, '').replace(/[^0-9a-zа-я%.,/ ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function _v79Num_(x) {
  if (typeof x === 'number') return x;
  var s = String(x === null || x === undefined ? '' : x).replace(/[\s  ]/g, '').replace(/[₽рруб.]+$/i, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return parseFloat(s);
}
function _v79R2_(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function _v79R3_(x) { return Math.round((Number(x) || 0) * 1000) / 1000; }
function _v79Day_(x) { return typeof _v71Day_ === 'function' ? _v71Day_(x) : Utilities.formatDate(x instanceof Date ? x : _mcDateOnly_(x), _mcTz_(), 'yyyy-MM-dd'); }
/** Время смены ЧЧ:ММ: в листе хранится текстом; если таблица превратила его во время — читаем часы и минуты. */
function _v79Hm_(v) {
  if (v instanceof Date) return ('0' + v.getHours()).slice(-2) + ':' + ('0' + v.getMinutes()).slice(-2);
  var m = /^\s*(\d{1,2}):(\d{2})/.exec(String(v || '')); return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : '';
}
function _v79Ru_(day) { var p = String(day || '').split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : String(day || ''); }
function _v79Allowed_(op) {
  if (op.session && op.session.dev) return 'Технический доступ продажи не вносит';
  if (typeof _mcRbJournalAllowed_ === 'function' && !_mcRbJournalAllowed_(op.session, 'J36')) return 'Журнал продаж ведут: ' + _mcRbJournalRoles_('J36').join(', ') + '.';
  return '';
}
function _v79Fail_(op, code, msg) { _endOp_(op, 'FAILED'); return _fail_(code, msg, op.id); }

/* ---------------- документ → таблица строк ---------------- */
/** Текст CSV/TXT: UTF-8, иначе Windows-1251 (выгрузки касс на Windows). */
function _v79Text_(blob) {
  var s = blob.getDataAsString('UTF-8');
  if (/�/.test(s)) { try { s = blob.getDataAsString('windows-1251'); } catch (e) {} }
  return s.replace(/^﻿/, '');
}
function _v79Grid_(file) {
  var kind = typeof _mcFileKind_ === 'function' ? _mcFileKind_(file) : '';
  if (kind === 'csv' || kind === 'txt') {
    var t = _v79Text_(file.getBlob()), first = (t.split(/\r?\n/).filter(function (l) { return l.trim(); })[0] || '');
    if (kind === 'txt' && !/[;\t]/.test(first)) return _mcTextToGrid_(t);
    var d = [';', '\t', ','].map(function (c) { return [c, first.split(c).length]; }).sort(function (a, b) { return b[1] - a[1]; })[0][0];
    return Utilities.parseCsv(t, d);
  }
  if (!kind) throw new Error('Формат файла не читается. Нужен отчёт о продажах по позициям: CSV, Excel, Google Таблица, PDF с таблицей или текст.');
  return _mcGridFromFile_(file, kind);
}
var MC_V79_COLS_ = {
  name: /(наименован|номенклатур|товар|блюдо|позици|название|продукц)/i,
  qty: /(кол-?во|количеств|^кол\.?$|^qty|порц)/i,
  price: /цена/i,
  sum: /(сумма|стоимость|итого|выручка|к оплате)/i
};
/** Заголовок таблицы и строки продаж. {lines:[{raw, qty, price, sum, row}], ignored:[{row, text, reason}], head} или {error}. */
function _v79Table_(grid) {
  var hi = -1, col = null;
  for (var r = 0; r < Math.min(grid.length, 40) && hi < 0; r++) {
    var cells = (grid[r] || []).map(function (c) { return String(c || '').trim(); });
    var find = function (re, not) { for (var j = 0; j < cells.length; j++) if (re.test(cells[j]) && !(not && not.test(cells[j]))) return j; return -1; };
    var n = find(MC_V79_COLS_.name), q = find(MC_V79_COLS_.qty, /сумм|цена/i);
    if (n >= 0 && q >= 0 && n !== q) {
      var sums = []; cells.forEach(function (c, j) { if (MC_V79_COLS_.sum.test(c) && j !== n && j !== q) sums.push(j); });
      var best = sums.filter(function (j) { return /(со скидк|к оплате|итого|выручка)/i.test(cells[j]); })[0];
      if (best === undefined) best = sums.filter(function (j) { return !/(без|скидк|себест)/i.test(cells[j]); })[0];
      hi = r; col = { name: n, qty: q, price: find(MC_V79_COLS_.price, /без|себест|закуп/i), sum: best === undefined ? -1 : best, head: cells };
    }
  }
  if (hi < 0) return { error: 'Не нашёл в документе столбцы «Наименование» и «Количество». Загрузите отчёт о продажах по позициям (товарам, блюдам).' };
  var lines = [], ignored = [];
  for (var i = hi + 1; i < grid.length; i++) {
    var row = grid[i] || [], raw = String(row[col.name] || '').replace(/\s+/g, ' ').trim();
    if (!raw) continue;
    if (/^(итого|всего|итог|total|сумма)(?![а-яёa-z])/i.test(raw)) { ignored.push({ row: i + 1, text: raw, reason: 'строка итогов' }); continue; }
    var qty = _v79Num_(row[col.qty]), price = col.price >= 0 ? _v79Num_(row[col.price]) : NaN, sum = col.sum >= 0 ? _v79Num_(row[col.sum]) : NaN;
    if (isNaN(qty)) { ignored.push({ row: i + 1, text: raw, reason: 'количество не число: «' + String(row[col.qty] || '') + '»' }); continue; }
    if (qty <= 0) { ignored.push({ row: i + 1, text: raw, reason: qty < 0 ? 'возврат (количество ' + qty + ') — не учитывается, оформите отменой продажи' : 'количество 0' }); continue; }
    lines.push({ raw: raw, qty: qty, price: isNaN(price) ? null : price, sum: isNaN(sum) ? null : sum, row: i + 1 });
  }
  // одинаковые позиции (несколько чеков) — в одну строку
  var by = {}, out = [];
  lines.forEach(function (l) {
    var k = _v79Key_(l.raw), x = by[k];
    if (!x) { x = by[k] = { raw: l.raw, qty: 0, price: l.price, sum: l.sum === null ? null : 0, rows: [] }; out.push(x); }
    x.qty = _v79R3_(x.qty + l.qty); x.rows.push(l.row);
    if (x.sum !== null) x.sum = l.sum === null ? null : _v79R2_(x.sum + l.sum);
    if (x.price === null && l.price !== null) x.price = l.price;
  });
  out.forEach(function (x) { if (x.sum !== null && x.qty > 0) x.price = _v79R2_(x.sum / x.qty); });
  return { lines: out, ignored: ignored, head: col.head };
}

/* ---------------- сопоставление, уже внесённое, склад ---------------- */
function _v79Maps_() {
  var m = {};
  _v79Rows_(_book_().getSheetByName(MC_V79_MAP_), MC_V79_MAP_HEAD_).forEach(function (r) { m[String(r['Ключ'])] = { decision: String(r['Решение']), target: String(r['Блюдо / товар'] || ''), unit: String(r['Ед.'] || '') }; });
  return m;
}
function _v79Resolve_(decision, target, unit, idx) {
  if (decision === 'SKIP') return { kind: 'SKIP', name: '' };
  var R = _v71Resolve_(target, decision === 'GOODS' ? 'goods' : 'dish', unit || '', idx);
  return R.error ? { kind: 'NONE', reason: R.error } : { kind: R.kind, name: R.name, code: R.code || '', unit: R.unit, R: R };
}
/** Позиция документа → блюдо по ТТК, товар со склада, «не списывать» или «не сопоставлено». */
function _v79Match_(l, maps, idx) {
  if (l.decision) { var o = _v79Resolve_(l.decision, l.target, l.unit, idx); o.via = 'выбрано'; return o; }
  var m = maps[_v79Key_(l.raw)];
  if (m) { var x = _v79Resolve_(m.decision, m.target, m.unit, idx); x.via = 'запомнено'; if (x.kind !== 'NONE') return x; }
  var d = _v71Resolve_(l.raw, 'dish', '', idx); if (!d.error) return { kind: 'DISH', name: d.name, code: d.code, unit: d.unit, R: d, via: 'ТТК' };
  var g = _v71Resolve_(l.raw, 'goods', '', idx); if (!g.error) return { kind: 'GOODS', name: g.name, code: '', unit: g.unit, R: g, via: 'склад' };
  return { kind: 'NONE', via: '', reason: 'нет в ТТК и на складе — выберите блюдо, товар или «не списывать»' };
}
/** Продажи за день, внесённые вручную (не документами V79) и ещё не учтённые другим документом: ключ блюда → [{saleId, qty}]. */
function _v79Pool_(day, exceptImport) {
  var sh = _book_().getSheetByName(MC_V71.SHEET), pool = {}, made = {}, used = {};
  _v79Rows_(_book_().getSheetByName(MC_V79_SHEET_), MC_V79_HEAD_).forEach(function (r) {
    var L = []; try { L = JSON.parse(r['Строки (JSON)'] || '[]'); } catch (e) {}
    var other = String(r.ImportID) !== String(exceptImport || '') && /^(POSTED|PARTIAL|POSTING)$/.test(String(r['Статус']));
    L.forEach(function (l) {
      if (l.saleId) made[l.saleId] = true;
      var mine = String(r.ImportID) === String(exceptImport || '') && (l.saleId || l.coveredBy);
      if ((other || mine) && l.absorbed) Object.keys(l.absorbed).forEach(function (sid) { used[sid] = (used[sid] || 0) + (Number(l.absorbed[sid]) || 0); });
    });
  });
  if (!sh || sh.getLastRow() < 2) return pool;
  sh.getRange(2, 1, sh.getLastRow() - 1, MC_V71_HEAD.length).getValues().forEach(function (r) {
    var sid = String(r[0] || ''); if (!sid || made[sid] || _v79Day_(r[1]) !== day) return;
    var left = _v79R3_((Number(r[6]) || 0) - (used[sid] || 0)); if (!(left > 0)) return;
    (pool[_v79Key_(r[3])] = pool[_v79Key_(r[3])] || []).push({ saleId: sid, qty: left, time: String(r[2] || '') });
  });
  return pool;
}
function _v79MenuPrice_(name, day) {
  try { if (typeof _v64MenuPrices_ !== 'function') return null; var p = _v64PriceFor_(_v64MenuPrices_(), name, '', _mcDateOnly_(day)); return p ? p.price : null; } catch (e) { return null; }
}
/** Черновик для экрана: позиции с сопоставлением, уже внесённым, «к внесению», ценой и тем, что спишется. */
function _v79View_(rec, opt) {
  opt = opt || {};
  var L = []; try { L = JSON.parse(rec['Строки (JSON)'] || '[]'); } catch (e) {}
  var ign = []; try { ign = JSON.parse(rec['Не учтено (JSON)'] || '[]'); } catch (e) {}
  var day = _v79Day_(rec['Дата смены']), time = _v79Hm_(rec['Время']), status = String(rec['Статус']);
  var sub = String(rec['Вычитать внесённое вручную'] || 'да') !== 'нет';
  var idx = _buildDishIndexes_(), maps = _v79Maps_(), pool = /^(DRAFT|PARTIAL|POSTING)$/.test(status) && sub ? _v79Pool_(day, rec.ImportID) : {};
  var at = time ? _v71At_(day, time) : (day === _v79Day_(_mcNow_()) ? _mcNow_() : _v71At_(day, '23:00')), total = 0;
  var lines = L.map(function (l, i) {
    var m = l.saleId ? { kind: l.kind || 'DISH', name: l.name || l.raw, via: 'внесено' } : _v79Match_(l, maps, idx);
    var al = 0, absorbed = {};
    if (l.saleId) al = _v79R3_(l.qty - (l.posted || 0));
    else if (m.kind === 'DISH' || m.kind === 'GOODS') {
      (pool[_v79Key_(m.name)] || []).forEach(function (p) { var take = _v79R3_(Math.min(p.qty, l.qty - al)); if (take > 0) { al = _v79R3_(al + take); p.qty = _v79R3_(p.qty - take); absorbed[p.saleId] = take; } });
    }
    var add = l.saleId ? l.posted : (m.kind === 'DISH' || m.kind === 'GOODS' ? _v79R3_(Math.max(0, l.qty - al)) : 0);
    var price = l.priceSet !== undefined && l.priceSet !== null ? l.priceSet : l.price, priceFrom = l.priceSet !== undefined && l.priceSet !== null ? 'введена' : (l.price !== null && l.price !== undefined ? 'из документа' : '');
    if ((price === null || price === undefined) && m.kind === 'DISH') { var mp = _v79MenuPrice_(m.name, day); if (mp !== null) { price = mp; priceFrom = 'из «Цен меню»'; } }
    var sum = add > 0 && price !== null && price !== undefined ? (add === l.qty && l.sum !== null && l.sum !== undefined && priceFrom === 'из документа' ? l.sum : _v79R2_(add * price)) : 0;
    var stock = null;
    if (!l.saleId && opt.stock !== false && add > 0 && m.R) {
      try { var b = _v71Brief_(_v71Run_(m.R, add, { dry: true, at: at })); stock = { status: b.status, statusRu: b.statusRu, short: b.short.map(function (s) { return s.text; }), unreleased: b.unreleased.length }; }
      catch (e) { stock = { status: 'ERROR', statusRu: 'склад не проверен', short: [String(e && e.message || e)] }; }
    }
    if (add > 0) total += sum;
    return { i: i, raw: l.raw, qty: l.qty, docPrice: l.price, price: price === undefined ? null : price, priceFrom: priceFrom, sum: sum, kind: m.kind, name: m.name || '', code: m.code || '', unit: m.unit || '', via: m.via || '',
      reason: m.reason || '', already: al, absorbed: absorbed, add: add, stock: stock, saleId: l.saleId || '', error: l.error || '', rows: l.rows || [] };
  });
  var need = lines.filter(function (x) { return x.kind === 'NONE'; }).map(function (x) { return x.raw; });
  var noPrice = lines.filter(function (x) { return !x.saleId && x.add > 0 && (x.price === null || !(x.price >= 0)); }).map(function (x) { return x.name || x.raw; });
  return { id: String(rec.ImportID), day: day, dayRu: _v79Ru_(day), time: time, subtract: sub, source: String(rec['Источник']), file: String(rec['Файл'] || ''), fileId: String(rec.FileID || ''),
    url: rec.FileID ? 'https://drive.google.com/file/d/' + rec.FileID + '/view' : '', status: status, statusRu: MC_V79_STATUS_RU_[status] || status, by: String(rec['Загрузил'] || ''),
    postedBy: String(rec['Подтвердил'] || ''), lines: lines, ignored: ign, needMatch: need, needPrice: noPrice, total: _v79R2_(total),
    toPost: lines.filter(function (x) { return !x.saleId && x.add > 0; }).length, already: lines.reduce(function (a, x) { return a + (x.already > 0 ? 1 : 0); }, 0) };
}
function _v79Find_(id) {
  var r = _v79Rows_(_v79Sheet_(), MC_V79_HEAD_).filter(function (x) { return String(x.ImportID) === String(id); })[0];
  return r || null;
}
function _v79Write_(rec, patch) {
  var sh = _v79Sheet_();
  Object.keys(patch).forEach(function (k) { var c = MC_V79_HEAD_.indexOf(k); if (c >= 0) { sh.getRange(rec._row, c + 1).setValue(patch[k]); rec[k] = patch[k]; } });
}
function _v79Folder_() {
  var root = (typeof _mcFolderSafe_ === 'function' ? _mcFolderSafe_('reports') : null) || _docsFolder_();
  var it = root.getFoldersByName(MC_V79_DIR_); return it.hasNext() ? it.next() : root.createFolder(MC_V79_DIR_);
}
function _v79NewId_() { return 'SH-' + Utilities.formatDate(new Date(), _mcTz_(), 'yyyyMMdd-HHmmss') + '-' + Utilities.getUuid().slice(0, 4).toUpperCase(); }
function _v79TimeErr_(day, time) {
  if (!time) return '';
  var m = /^(\d{1,2}):(\d{2})$/.exec(time); if (!m || +m[1] > 23 || +m[2] > 59) return 'Время — ЧЧ:ММ';
  if (day === _v79Day_(_mcNow_())) { var n = _mcNow_(); if (+m[1] * 60 + +m[2] > n.getHours() * 60 + n.getMinutes() + 5) return 'Время ' + time + ' сегодня ещё не наступило'; }
  return '';
}
function _v79DayArg_(d, op) {
  var now = _mcNow_(), day = d ? _v79Day_(d) : _v79Day_(now);
  if (!day) return { error: 'Дата смены не распознана' };
  if (day > _v79Day_(now)) return { error: 'Дата смены позже сегодняшней' };
  return { day: day };
}

/* ---------------- публичные функции ---------------- */
/** Экран «Продажи за смену»: блюда меню, товары, черновики и внесённые документы, продажи сегодня. */
function v79Data(token) {
  var op = null;
  try { op = _beginOp_(token, MC_V79_NEED_, 'SHIFT_SALES_VIEW', 'Продажи', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var idx = _buildDishIndexes_(), today = _v79Day_(_mcNow_()), prices = typeof _v64MenuPrices_ === 'function' ? _v64MenuPrices_() : [];
    var week = {}, todayN = 0, todaySum = 0, sh = _book_().getSheetByName(MC_V71.SHEET), from = _v79Day_(new Date(_mcNow_().getTime() - 7 * 864e5));
    if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, MC_V71_HEAD.length).getValues().forEach(function (r) {
      var d = _v79Day_(r[1]); if (!r[0] || !d) return;
      if (d >= from) { var k = _v79Key_(r[3]); week[k] = (week[k] || 0) + (Number(r[6]) || 0); }
      if (d === today) todayN++;
    });
    try { var j = _book_().getSheetByName(_mcJById_('J36').sheetName); if (j && j.getLastRow() > 1) { var v = j.getDataRange().getValues(), h = v[0], cd = h.indexOf('Дата'), cs = h.indexOf('Сумма');
      for (var i = 1; i < v.length; i++) if (_v79Day_(v[i][cd]) === today) todaySum += Number(v[i][cs]) || 0; } } catch (e) {}
    var dishes = Object.keys(idx.dishByCode).map(function (c) { return idx.dishByCode[c]; }).filter(function (d) { return d && !d.semi; }).map(function (d) {
      var p = typeof _v64PriceFor_ === 'function' ? _v64PriceFor_(prices, d.name, '', _mcNow_()) : null;
      return { name: String(d.name), code: String(d.code), price: p ? p.price : null, week: _v79R3_(week[_v79Key_(d.name)] || 0) };
    }).sort(function (a, b) { return b.week - a.week || a.name.localeCompare(b.name, 'ru'); });
    var goods = []; try { goods = _v71GoodsList_(idx); } catch (e) {}
    var recs = _v79Rows_(_book_().getSheetByName(MC_V79_SHEET_), MC_V79_HEAD_).reverse().slice(0, 40).map(function (r) {
      return { id: String(r.ImportID), day: _v79Day_(r['Дата смены']), dayRu: _v79Ru_(_v79Day_(r['Дата смены'])), source: String(r['Источник']), file: String(r['Файл'] || ''),
        url: r.FileID ? 'https://drive.google.com/file/d/' + r.FileID + '/view' : '', lines: Number(r['Позиций']) || 0, posted: Number(r['Внесено']) || 0, skipped: Number(r['Пропущено']) || 0,
        sum: Number(r['Сумма']) || 0, status: String(r['Статус']), statusRu: MC_V79_STATUS_RU_[String(r['Статус'])] || String(r['Статус']), by: String(r['Загрузил'] || ''), postedBy: String(r['Подтвердил'] || '') };
    });
    var deny = _v79Allowed_(op);
    _endOp_(op);
    return _ok_({ today: today, todayRu: _v79Ru_(today), canAdd: !deny, deny: deny, dishes: dishes, goods: goods, imports: recs, maps: Object.keys(_v79Maps_()).length,
      todaySales: { count: todayN, sum: _v79R2_(todaySum) }, drafts: recs.filter(function (r) { return r.status === 'DRAFT' || r.status === 'PARTIAL'; }).length }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Загрузить документ о продажах: {data (data:URL base64) | fileId, fileName, date?, time?} → черновик. */
function v79Parse(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V79_NEED_, 'SHIFT_SALES_PARSE', 'Продажи', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var deny = _v79Allowed_(op); if (deny) return _v79Fail_(op, 'FORBIDDEN', deny);
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), D = _v79DayArg_(d.date); if (D.error) return _v79Fail_(op, 'VALIDATION', D.error);
    var time = String(d.time || '').trim(), te = _v79TimeErr_(D.day, time); if (te) return _v79Fail_(op, 'VALIDATION', te);
    var file = null;
    if (d.fileId) { try { file = DriveApp.getFileById(String(d.fileId).replace(/^.*\/d\/([^/]+).*$/, '$1')); } catch (e) { return _v79Fail_(op, 'NOT_FOUND', 'Файл на Диске не найден или нет доступа'); } }
    else {
      var m = /^data:([^;]*);base64,(.*)$/.exec(String(d.data || '')); if (!m) return _v79Fail_(op, 'VALIDATION', 'Выберите файл с продажами');
      var name = String(d.fileName || 'продажи').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 120);
      file = _v79Folder_().createFile(Utilities.newBlob(Utilities.base64Decode(m[2]), m[1] || 'application/octet-stream', _v79Ru_(D.day) + ' — ' + name));
    }
    var sha = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, file.getBlob().getBytes()).map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
    var dup = _v79Rows_(_v79Sheet_(), MC_V79_HEAD_).filter(function (r) { return String(r['SHA-256']) === sha && /^(POSTED|PARTIAL|POSTING)$/.test(String(r['Статус'])); })[0];
    if (dup) return _v79Fail_(op, 'CONFLICT', 'Этот документ уже внесён: смена ' + _v79Ru_(_v79Day_(dup['Дата смены'])) + ', ' + dup.ImportID + ' (' + (MC_V79_STATUS_RU_[String(dup['Статус'])] || dup['Статус']) + ')');
    var grid; try { grid = _v79Grid_(file); } catch (e) { return _v79Fail_(op, 'VALIDATION', String(e && e.message || e)); }
    var T = _v79Table_(grid || []); if (T.error) return _v79Fail_(op, 'VALIDATION', T.error);
    if (!T.lines.length) return _v79Fail_(op, 'VALIDATION', 'В документе нет строк продаж с количеством больше нуля' + (T.ignored.length ? ' (не учтено: ' + T.ignored.length + ')' : ''));
    var id = _v79NewId_(), who = _author_(op).фио;
    _withLock_(function () {
      _v79Sheet_().appendRow([id, D.day, time ? "'" + time : '', 'FILE', d.subtract === false ? 'нет' : 'да', file.getName(), file.getId(), sha, T.lines.length, 0, 0, 0, 'DRAFT', who, new Date(), '', '', JSON.stringify(T.lines), JSON.stringify(T.ignored), op.id]);
    });
    _audit_(op, 'SHIFT_SALES_PARSE', 'Продажи за смену', id, null, { файл: file.getName(), позиций: T.lines.length, не_учтено: T.ignored.length, дата: D.day });
    var view = _v79View_(_v79Find_(id));
    _endOp_(op);
    return _ok_(view, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Внести списком: {date?, time?, lines:[{dish, kind?: 'dish'|'goods', unit?, qty, price?}]} → черновик. */
function v79List(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V79_NEED_, 'SHIFT_SALES_LIST', 'Продажи', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var deny = _v79Allowed_(op); if (deny) return _v79Fail_(op, 'FORBIDDEN', deny);
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), D = _v79DayArg_(d.date); if (D.error) return _v79Fail_(op, 'VALIDATION', D.error);
    var time = String(d.time || '').trim(), te = _v79TimeErr_(D.day, time); if (te) return _v79Fail_(op, 'VALIDATION', te);
    var by = {}, L = [];
    (Array.isArray(d.lines) ? d.lines : []).forEach(function (x) {
      var name = String(x && x.dish || '').trim(), q = _v79Num_(x && x.qty); if (!name || !(q > 0)) return;
      var pr = x.price === '' || x.price === undefined || x.price === null ? null : _v79Num_(x.price), goods = String(x.kind || '').toLowerCase() === 'goods';
      var k = (goods ? 'g|' : 'd|') + _v79Key_(name);
      if (by[k]) { by[k].qty = _v79R3_(by[k].qty + q); return; }
      L.push(by[k] = { raw: name, qty: q, price: pr === null || isNaN(pr) ? null : pr, sum: null, decision: goods ? 'GOODS' : 'DISH', target: name, unit: String(x.unit || '') });
    });
    if (!L.length) return _v79Fail_(op, 'VALIDATION', 'Укажите количество хотя бы у одного блюда');
    var id = _v79NewId_(), who = _author_(op).фио;
    _withLock_(function () { _v79Sheet_().appendRow([id, D.day, time ? "'" + time : '', 'LIST', d.subtract === false ? 'нет' : 'да', '', '', '', L.length, 0, 0, 0, 'DRAFT', who, new Date(), '', '', JSON.stringify(L), '[]', op.id]); });
    _audit_(op, 'SHIFT_SALES_LIST', 'Продажи за смену', id, null, { позиций: L.length, дата: D.day });
    var view = _v79View_(_v79Find_(id));
    _endOp_(op);
    return _ok_(view, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Черновик или внесённый документ — для экрана. */
function v79Draft(id, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V79_NEED_, 'SHIFT_SALES_VIEW', 'Продажи', String(id || ''), null); } catch (e) { return _failFrom_(e); }
  try {
    var rec = _v79Find_(id); if (!rec) return _v79Fail_(op, 'NOT_FOUND', 'Документ не найден');
    var view = _v79View_(rec); _endOp_(op); return _ok_(view, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Позиция черновика: {id, i, decision: 'DISH'|'GOODS'|'SKIP', target?, unit?, price?, remember?}. remember — запомнить для следующих документов. */
function v79SetLine(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V79_NEED_, 'SHIFT_SALES_LINE', 'Продажи', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var deny = _v79Allowed_(op); if (deny) return _v79Fail_(op, 'FORBIDDEN', deny);
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), rec = _v79Find_(d.id);
    if (!rec) return _v79Fail_(op, 'NOT_FOUND', 'Документ не найден');
    if (String(rec['Статус']) !== 'DRAFT') return _v79Fail_(op, 'CONFLICT', 'Документ уже ' + (MC_V79_STATUS_RU_[String(rec['Статус'])] || rec['Статус']) + ' — менять нельзя');
    var who = _author_(op).фио;
    if (d.subtract !== undefined && (d.i === undefined || d.i === null || d.i === '')) {
      _v79Write_(rec, { 'Вычитать внесённое вручную': d.subtract ? 'да' : 'нет' });
      _audit_(op, 'SHIFT_SALES_LINE', 'Продажи за смену', String(rec.ImportID), null, { вычитать_внесённое_вручную: !!d.subtract });
      var v0 = _v79View_(rec); _endOp_(op); return _ok_(v0, op.id);
    }
    var L = JSON.parse(rec['Строки (JSON)'] || '[]'), l = L[Number(d.i)]; if (!l) return _v79Fail_(op, 'NOT_FOUND', 'Позиция не найдена');
    if (d.decision) {
      var dec = String(d.decision); if (!/^(DISH|GOODS|SKIP)$/.test(dec)) return _v79Fail_(op, 'VALIDATION', 'Решение: блюдо, товар или «не списывать»');
      if (dec !== 'SKIP') { var chk = _v79Resolve_(dec, String(d.target || ''), String(d.unit || ''), _buildDishIndexes_()); if (chk.kind === 'NONE') return _v79Fail_(op, 'VALIDATION', chk.reason); d.target = chk.name; }
      l.decision = dec; l.target = dec === 'SKIP' ? '' : String(d.target); l.unit = String(d.unit || '');
      if (d.remember) _withLock_(function () {
        var sh = _v79MapSheet_(), k = _v79Key_(l.raw), rows = _v79Rows_(sh, MC_V79_MAP_HEAD_).filter(function (r) { return String(r['Ключ']) === k; });
        var val = [k, l.raw, dec, l.target, l.unit, who, new Date()];
        if (rows.length) sh.getRange(rows[0]._row, 1, 1, val.length).setValues([val]); else sh.appendRow(val);
      });
    }
    if (d.price !== undefined) { var p = d.price === '' || d.price === null ? null : _v79Num_(d.price); if (p !== null && !(p >= 0)) return _v79Fail_(op, 'VALIDATION', 'Цена — число'); l.priceSet = p; }
    _v79Write_(rec, { 'Строки (JSON)': JSON.stringify(L) });
    _audit_(op, 'SHIFT_SALES_LINE', 'Продажи за смену', String(rec.ImportID), null, { позиция: l.raw, решение: l.decision || '', что: l.target || '', цена: l.priceSet === undefined ? '' : l.priceSet, запомнить: !!d.remember });
    var view = _v79View_(rec); _endOp_(op); return _ok_(view, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Подтвердить весь список: {id, confirm: true}. Каждая позиция «к внесению» — обычная продажа (журнал J36, списание склада V71). */
function v79Post(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V79_NEED_, 'SHIFT_SALES_POST', 'Продажи', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var deny = _v79Allowed_(op); if (deny) return _v79Fail_(op, 'FORBIDDEN', deny);
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), rec = _v79Find_(d.id);
    if (!rec) return _v79Fail_(op, 'NOT_FOUND', 'Документ не найден');
    var st = String(rec['Статус']);
    if (!/^(DRAFT|PARTIAL)$/.test(st)) return _v79Fail_(op, 'CONFLICT', 'Документ уже ' + (MC_V79_STATUS_RU_[st] || st));
    var view = _v79View_(rec, { stock: false });
    if (view.needMatch.length) return _v79Fail_(op, 'VALIDATION', 'Сопоставьте позиции (блюдо, товар или «не списывать»): ' + view.needMatch.join('; '));
    if (view.needPrice.length) return _v79Fail_(op, 'VALIDATION', 'Укажите цену: ' + view.needPrice.join('; '));
    if (!view.toPost) return _v79Fail_(op, 'VALIDATION', 'Вносить нечего: все позиции уже внесены или пропущены');
    if (d.confirm !== true) return _v79Fail_(op, 'VALIDATION', 'Подтвердите весь список: ' + view.toPost + ' позиций на ' + view.total + ' ₽');
    var busy = false;
    _withLock_(function () { var r2 = _v79Find_(d.id); if (!/^(DRAFT|PARTIAL)$/.test(String(r2['Статус']))) busy = true; else _v79Write_(r2, { 'Статус': 'POSTING' }); });
    if (busy) return _v79Fail_(op, 'CONFLICT', 'Документ уже вносится');
    rec = _v79Find_(d.id);
    var L = JSON.parse(rec['Строки (JSON)'] || '[]'), done = 0, failed = [], sum = 0, skipped = 0, n = 0;
    var dayRu = view.dayRu, time = view.time;
    view = _v79View_(rec, { stock: false });
    view.lines.forEach(function (x) {
      var l = L[x.i];
      if (l.saleId) { done++; sum += Number(l.postedSum) || 0; return; }
      if (!(x.add > 0)) { if (x.already > 0) { l.absorbed = x.absorbed; l.coveredBy = 'внесено вручную'; } skipped++; return; }
      var r = {};
      try { r = JSON.parse(mcSaleAdd(JSON.stringify({ dish: x.name, kind: x.kind === 'GOODS' ? 'goods' : 'dish', unit: x.kind === 'GOODS' ? x.unit : '', qty: x.add, price: x.price, sum: x.sum,
        date: dayRu, time: time || undefined, check: String(rec.ImportID) }), token) || '{}'); } catch (e) { r = { error: String(e && e.message || e) }; }
      if (r && (r.ok || r.success) && r.data) {
        l.saleId = r.data.saleId || ('J36 ' + r.data.date + ' ' + r.data.time); l.posted = x.add; l.postedSum = r.data.sum; l.kind = x.kind; l.name = x.name; l.error = ''; l.absorbed = x.absorbed;
        l.stock = r.data.stock ? r.data.stock.statusRu : ''; done++; sum += Number(r.data.sum) || 0;
      } else { l.error = (r && r.error && (r.error.message || r.error)) || 'не записано'; failed.push(x.name + ': ' + l.error); }
      if (++n % 10 === 0) _v79Write_(rec, { 'Строки (JSON)': JSON.stringify(L) });
    });
    var status = failed.length ? 'PARTIAL' : 'POSTED', who = _author_(op).фио;
    _v79Write_(rec, { 'Строки (JSON)': JSON.stringify(L), 'Статус': status, 'Внесено': done, 'Пропущено': skipped, 'Сумма': _v79R2_(sum), 'Подтвердил': who, 'Подтверждено': new Date() });
    _audit_(op, 'SHIFT_SALES_POST', 'Продажи за смену', String(rec.ImportID), null, { внесено: done, пропущено: skipped, сумма: _v79R2_(sum), ошибки: failed, дата: view.day, источник: view.source });
    var out = _v79View_(rec, { stock: false }); out.posted = done; out.failed = failed; out.sumPosted = _v79R2_(sum);
    _endOp_(op);
    return _ok_(out, op.id);
  } catch (e) {
    try { var rr = _v79Find_(JSON.parse(json || '{}').id); if (rr && String(rr['Статус']) === 'POSTING') _v79Write_(rr, { 'Статус': 'PARTIAL' }); } catch (e2) {}
    if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id);
  }
}
/** Отменить черновик: {id}. Внесённое не отменяется — для этого «отмена продажи». */
function v79Cancel(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V79_NEED_, 'SHIFT_SALES_CANCEL', 'Продажи', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var deny = _v79Allowed_(op); if (deny) return _v79Fail_(op, 'FORBIDDEN', deny);
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), rec = _v79Find_(d.id);
    if (!rec) return _v79Fail_(op, 'NOT_FOUND', 'Документ не найден');
    if (String(rec['Статус']) !== 'DRAFT') return _v79Fail_(op, 'CONFLICT', 'Отменить можно только черновик');
    _v79Write_(rec, { 'Статус': 'CANCELLED' });
    _audit_(op, 'SHIFT_SALES_CANCEL', 'Продажи за смену', String(rec.ImportID), null, {});
    _endOp_(op); return _ok_({ id: String(rec.ImportID), status: 'CANCELLED' }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- главное окно и банкеты: кнопка «Продажи за смену» ---------------- */
(function () {
  if (typeof _UI_BUILDERS_ !== 'object') return;
  var add = function (sec, first) {
    var orig = _UI_BUILDERS_[sec]; if (typeof orig !== 'function') return;
    _UI_BUILDERS_[sec] = function (token, opts, s) {
      var r = orig(token, opts, s) || {};
      try {
        if (!s || (!s.dev && _mcRbJournalAllowed_(s, 'J36') && _mcRbHasExact_(s, MC_V79_NEED_))) {
          var drafts = _v79Rows_(_book_().getSheetByName(MC_V79_SHEET_), MC_V79_HEAD_).filter(function (x) { return /^(DRAFT|PARTIAL)$/.test(String(x['Статус'])); }).length;
          var btn = { label: 'Продажи за смену' + (drafts ? ': черновик ' + drafts : ''), module: 'shiftsales' };
          r.actions = first ? [btn].concat(r.actions || []) : (r.actions || []).concat([btn]);
        }
      } catch (e) {}
      return r;
    };
  };
  add('banquets', false); add('home', false);
})();
try { if (MC_UI_VIEWS_.indexOf('shiftsales') < 0) MC_UI_VIEWS_ = MC_UI_VIEWS_.concat(['shiftsales']); } catch (e) {}
// Экран «Продажи за смену» видят только те, кто ведёт журнал продаж (J36: директор, администратор, шеф-повар), — повару с правом «журналы» он не нужен.
try {
  var _v79o_access_ = _mcRbAccess_;
  _mcRbAccess_ = function (s) {
    var r = _v79o_access_(s);
    try { if (r && r.modules && r.modules.shiftsales && s && !s.dev && !_mcRbJournalAllowed_(s, 'J36')) delete r.modules.shiftsales; } catch (e) {}
    return r;
  };
} catch (e) {}
