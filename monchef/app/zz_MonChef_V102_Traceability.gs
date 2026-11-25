/**
 * MON CHEF V102 — сквозная прослеживаемость полуфабриката (MC-018).
 *
 * Собственность Слепцова Дениса Владимировича.
 * Разработчик кода — Слепцов Денис Владимирович.
 *
 * Цепочка: сырьё → выпуск п/ф (производство, TRACE «РАСХОДОВАНА_НА» / «ВЫПУЩЕНА_ПАРТИЯ») → партия п/ф (место, срок, основание срока) →
 *   хранение → использование в блюде (заказ зала: «РЕАЛИЗОВАНА_В» позиции заказа; продажа V71; банкет) → списание (акт, отходы).
 *  • В расход (производство и продажа) не идут: просроченные, заблокированные (карантин, отзыв, блокировка) и п/ф собственного
 *    производства без утверждённого срока годности (MC-025) — система не угадывает, годен ли такой п/ф.
 *  • Срок партии п/ф связан с основанием: правило (валидация V91 / таблица сроков / срок в карте), версия ТТК, кто утвердил основание,
 *    когда выпущено (лист «Сроки_Партий_V102»). Паспорт п/ф (V91) — черновик и срок партии не меняет; правило валидации действует
 *    только после утверждения, ввода и при той же версии ТТК (V91).
 *  • v102TraceSemi(batchId) — вся цепочка партии п/ф: из какого сырья, где применена, что списано, основание срока.
 */
var MC_V102_BEXP_ = 'Сроки_Партий_V102', MC_V102_BEXP_HEAD_ = ['BatchID', 'Код ТТК', 'Версия ТТК', 'Срок годности', 'Основание', 'Источник правила', 'Утвердил основание', 'Выпуск', 'Выпустил', 'ProductionID', 'Записано'];
/** Партия собственного производства без срока годности: в расход не идёт. r — строка «Склад_Партии». */
function _v102OwnNoExpiry_(r) { return !r[5] && /^(Производство|Выпуск)/.test(String(r[7] || '')); }
function _v102BexpSheet_() { var sh = _book_().getSheetByName(MC_V102_BEXP_); if (!sh) { sh = _book_().insertSheet(MC_V102_BEXP_); sh.appendRow(MC_V102_BEXP_HEAD_); } return sh; }
function _v102ShelfDetail_(code) {
  var a = _v102ApprovedShelf_(code); if (!a) return null;
  var by = '', ref = a.ref || '';
  try { var r = _v91ActiveRule_(code); if (r && !r.stale && /валидация/.test(a.source)) { var st = _v91Study_(r.studyId); by = st ? String(st.AuthorizedBy || st.ApprovedBy || st.ReviewBy || '') : ''; ref = 'валидация ' + r.studyId + ' / правило ' + r.ruleId; } } catch (e) {}
  if (!by) { var c = _v102ShelfApprovedCard_(code); if (c && /карта/.test(a.source)) { by = String(c['Решил'] || ''); ref = String(c['Основание'] || ''); } }
  return { hours: a.hours, source: a.source, ref: ref, approvedBy: by };
}
(function (g) {
  var o = g.completeProduction; if (typeof o !== 'function') return;
  g.completeProduction = function (id, actualQty, expiry, token) {
    var res = o.apply(this, arguments);
    try {
      var j = typeof res === 'string' ? JSON.parse(res) : res; if (!(j && (j.success || j.ok) && j.data && j.data.batch)) return res;
      var f = _findProduction_(_productionSheet_(), id), code = f ? String(f.data[PROD_COL_.code]) : '', ver = 0; try { ver = _effectiveTTKVersion_(code); } catch (e) {}
      var det = code ? _v102ShelfDetail_(code) : null, s = null; try { s = _getSession_(token); } catch (e) {}
      _v102BexpSheet_().appendRow([String(j.data.batch), code, ver || '', j.data.expiry || '', j.data.expiryBasis || (det ? det.source : 'утверждённого срока нет'), det ? det.ref : '', det ? det.approvedBy : '',
        new Date(), s ? (s.fullName || s.name || '') : '', String(id), new Date()]);
    } catch (e) { try { _log_('WARN', 'основание срока партии: ' + e); } catch (x) {} }
    return res;
  };
})(this);
/** Цепочка партии п/ф: {batchId}. Право — просмотр склада или ХАССП. */
function v102TraceSemi(json, token) {
  try {
    _requireAuth_(token, 'stock_view|stock|haccp|haccp_view|recall');
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), bid = String(d.batchId || '');
    var bv = _stockBatchesSheet_().getDataRange().getValues(), row = bv.filter(function (r) { return String(r[0]) === bid; })[0];
    if (!row) return _fail_('NOT_FOUND', 'Партия не найдена');
    var fmt = function (x) { var dd = x instanceof Date ? x : _parseDate_(x); return dd && dd.getTime ? Utilities.formatDate(dd, _mcTz_(), 'dd.MM.yyyy') : String(x || ''); };
    var tl = _mcTraceSheet_().getDataRange().getValues(), links = tl.slice(1).filter(function (r) { return r[0] && String(r[12]) !== 'REVOKED'; });
    var prodIn = links.filter(function (r) { return String(r[4]) === 'BATCH' && String(r[5]) === bid && /ВЫПУЩЕНА|ВЫПУСК/.test(String(r[3])); }).map(function (r) { return String(r[2]); });
    var raw = []; prodIn.forEach(function (pid) { links.forEach(function (r) { if (String(r[1]) === 'BATCH' && String(r[5]) === pid && /РАСХОДОВАНА_НА|ИЗРАСХОДОВАНА_В/.test(String(r[3]))) raw.push({ batchId: String(r[2]), qty: r[10], unit: String(r[11] || ''), production: pid }); }); });
    var bmap = {}; bv.slice(1).forEach(function (r) { bmap[String(r[0])] = r; });
    raw.forEach(function (x) { var b = bmap[x.batchId]; x.product = b ? String(b[1]) : ''; x.expiry = b ? fmt(b[5]) : ''; x.source = b ? String(b[7] || '') : ''; });
    var used = links.filter(function (r) { return String(r[1]) === 'BATCH' && String(r[2]) === bid; }).map(function (r) {
      var o = { rel: String(r[3]), toType: String(r[4]), toId: String(r[5]), at: fmt(r[7]), qty: r[10], unit: String(r[11] || '') };
      if (o.toType === 'ORDER_ITEM' && typeof _rsRecallInfo_ === 'function') { var ri = _rsRecallInfo_(o.toId); if (ri) { o.to = ri.to; o.dish = ri.what; } }
      return o; });
    var basis = null; try { var bs = _book_().getSheetByName(MC_V102_BEXP_); if (bs) { var bb = bs.getDataRange().getValues(), h = bb[0]; bb.slice(1).forEach(function (r) { if (String(r[0]) === bid) { basis = {}; h.forEach(function (k, i) { basis[k] = r[i] instanceof Date ? fmt(r[i]) : r[i]; }); } }); } } catch (e) {}
    var blocked = false; try { blocked = !!_v71Blocked_()[bid]; } catch (e) {}
    var exp = row[5] ? (row[5] instanceof Date ? row[5] : _parseDate_(row[5])) : null, today = new Date(); today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var usable = String(row[10] || 'active') === 'active' && !blocked && !!exp && exp >= today && (parseFloat(row[9]) || 0) > 0;
    return _ok_({ batch: { id: bid, product: String(row[1]), qty: row[3], left: row[9], unit: String(row[2]), expiry: fmt(row[5]), status: String(row[10] || 'active'), source: String(row[7] || ''), blocked: blocked },
      usable: usable, why: usable ? '' : !exp ? 'нет утверждённого срока годности' : exp < today ? 'срок истёк' : blocked ? 'партия заблокирована' : String(row[10]) !== 'active' ? 'статус «' + row[10] + '»' : 'остатка нет',
      expiryBasis: basis, raw: raw, used: used });
  } catch (e) { return _failFrom_(e); }
}
MC_GATE_EXT_.v102TraceSemi = { need: 'stock_view|stock|haccp|haccp_view|recall' };
