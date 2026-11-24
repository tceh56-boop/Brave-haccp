/**
 * MON CHEF V101 — Restaurant Service: продажи, экономика, сверка с кассой (ТЗ Restaurant Service 1.0, §11–12, §16.10, этап 7).
 *
 * Собственность Слепцова Дениса Владимировича.
 * Разработчик кода — Слепцов Денис Владимирович.
 *
 * Три события не смешиваются: производство (склад списан при «Готово», этап 6), подача («Подано»), оплата (счёт
 *   подтверждён по кассе). Внутренний заказ сам по себе продажей не считается.
 * Проведение продаж — при закрытии заказа (всё оплачено, всё подано или отменено): каждая доля оплаченного счёта —
 *   строка журнала продаж J36 «Ж_Продажи» (дата и время оплаты, блюдо, количество доли, цена и сумма после скидки
 *   и сервисного сбора, распределённых без потери копеек; продавец — официант). Номер продажи SL-…; партии, списанные
 *   производством этой позиции, привязываются к продаже (TRACE_LINKS «РЕАЛИЗОВАНА_В» и строка «Продажи_Списание_V71»
 *   в доле) — экономика V64 считает себестоимость по фактическим партиям. СКЛАД ПОВТОРНО НЕ СПИСЫВАЕТСЯ.
 *   Повтор: строка с меткой «RS-ALLOC <доля>» уже есть — не пишется второй раз.
 * Возврат по счёту (документ с причиной): сторно выручки «сторно CN-…» в J36, исходные строки помечаются «отменена CN-…»
 *   (как V95: прогноз, формы ОП и сверка Z их не считают); продукты на склад не возвращаются — блюдо приготовлено.
 *   Отмена продажи V95 для продаж зала запрещена (возврат на склад израсходованных продуктов был бы ошибкой).
 * Сверка смены: оплаченные счета (по способам), проведённое в J36, Z-отчёт кассы V94 за дату, расход производства и его
 *   себестоимость, food cost, расхождения: оплачено, но не проведено; подано, но не оплачено; нехватка при списании;
 *   отмены после начала приготовления; частичный расход без акта; Z-отчёт не загружен или не сходится.
 */

/* ---------------- распределение скидки и сбора по строкам счёта ---------------- */
function _rsDistribute_(lines, totalKop) {
  var base = lines.reduce(function (a, l) { return a + l.kop; }, 0), out = {}, used = 0, rest = [];
  if (!lines.length) return out;
  lines.forEach(function (l, i) { var exact = base > 0 ? totalKop * l.kop / base : totalKop / lines.length, fl = Math.floor(exact + 1e-9); out[l.allocId] = fl; used += fl; rest.push({ k: l.allocId, f: exact - fl, i: i }); });
  rest.sort(function (a, b) { return b.f - a.f || a.i - b.i; });
  for (var k = 0; used < totalKop && k < rest.length; k++, used++) out[rest[k].k]++;
  return out;
}
function _rsJ36_() {
  var j = _mcJById_('J36'), sh = _book_().getSheetByName(j.sheetName) || _createJournalSheet_(j), n = j.columns.length;
  return { j: j, sh: sh, n: n, src: function () { return sh.getLastRow() > 1 ? sh.getRange(2, n + 4, sh.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0] || ''); }) : []; } };
}
function _rsSaleId_(at) { return 'SL-' + Utilities.formatDate(at, _mcTz_(), 'yyyyMMdd') + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase(); }

/**
 * Провести оплаченные счета заказа в журнал продаж. Вызывается под блокировкой из закрытия заказа.
 * Возвращает {sales:[{saleId, bill, dish, qty, sumKop}], rows: строки «Проведено в J36» по счетам}.
 */
function _rsPostSales_(c, full) {
  var J = _rsJ36_(), posted = J.src(), mark = function (a) { return 'RS-ALLOC ' + a + ' '; };
  var items = {}; full.items.forEach(function (it) { items[it.id] = it; });
  var tks = {}; _rsRows_(MC_RS_SH_.QUEUE).forEach(function (q) { if (String(q.OrderID) === full.id) tks[String(q.TicketID)] = q; });
  var site = null; try { var S = _v97Sites_(); site = S.filter(function (x) { return x.id === full.siteId; })[0] || S.filter(function (x) { return x.id === 'SITE-MAIN'; })[0] || null; } catch (e) {}
  var out = { sales: [], bills: {} };
  (full.bills || []).filter(function (b) { return b.status === 'PAID'; }).forEach(function (b) {
    var row = _rsRows_(MC_RS_SH_.BILLS).filter(function (x) { return String(x.BillID) === b.id; })[0];
    var at = row && _rsIsDate_(row['Подтверждено']) ? row['Подтверждено'] : new Date(), tz = _mcTz_();
    var date = Utilities.formatDate(at, tz, 'dd.MM.yyyy'), time = Utilities.formatDate(at, tz, 'HH:mm');
    try { if (typeof _v64AssertOpen_ === 'function') _v64AssertOpen_(new Date(at.getFullYear(), at.getMonth(), at.getDate()), 'продажа'); } catch (e) { throw new Error('VALIDATION: ' + String(e.message || e).replace(/^[A-Z_]+:\s*/, '')); }
    _mcAssertJournalPeriodOpen_('J36', date);
    var adj = _rsDistribute_(b.lines, b.totalKop), ids = [];
    b.lines.forEach(function (l) {
      if (posted.some(function (s) { return s.indexOf(mark(l.allocId)) >= 0; })) { ids.push('уже'); return; }
      var it = items[l.itemId]; if (!it) return;
      var share = l.num / l.den, qty = Math.round(it.qty * share * 1000) / 1000, sum = (adj[l.allocId] || 0) / 100, price = qty > 0 ? Math.round(sum / qty * 100) / 100 : sum;
      var sid = _rsSaleId_(at), src = 'зал · заказ ' + full.id + ' · счёт ' + b.id + ' · ' + mark(l.allocId) + '· ' + sid + (b.receipt ? ' · чек ' + b.receipt : '') + ' · ' + ({ CASH: 'наличные', CARD: 'карта', OTHER: 'другое' }[b.method] || '');
      var line = J.j.columns.map(function (col) {
        switch (col) {
          case '№': return Math.max(0, J.sh.getLastRow() - 1) + 1;
          case 'Дата': return date; case 'Время': return time; case 'Блюдо': return it.name; case 'Количество': return qty; case 'Цена': return price; case 'Сумма': return sum;
          case 'ФИО продавца': return full.waiter; case 'Должность': return 'Официант'; default: return '';
        }
      });
      _mcJournalAppendTo_(J.sh, c.op, src, line);
      try { if (typeof _mcMirrorRow_ === 'function') _mcMirrorRow_('J36', J.sh.getLastRow()); } catch (e) {}
      try { if (site && typeof _v97SaleTag_ === 'function') _v97SaleTag_(sid, site, 'HALL'); } catch (e) {}
      // себестоимость: партии, списанные производством позиции (этап 6) — в доле продажи
      var tk = tks[it.ticketId], cons = tk ? _rsJ_(tk['Списано по партиям'], null) : null, scale = share;
      if (cons && cons.lines && cons.lines.length) {
        var lines2 = cons.lines.map(function (x) { var o = {}; Object.keys(x).forEach(function (k) { o[k] = x[k]; }); o.qty = Math.round(x.qty * scale * 1000) / 1000; o.cost = Math.round(x.cost * scale * 100) / 100; return o; });
        var short2 = (cons.short || []).map(function (x) { var o = {}; Object.keys(x).forEach(function (k) { o[k] = x[k]; }); o.qty = Math.round(x.qty * scale * 1000) / 1000; o.est = Math.round((x.est || 0) * scale * 100) / 100; return o; });
        var cost = Math.round(lines2.reduce(function (a, x) { return a + x.cost; }, 0) * 100) / 100, est = Math.round(short2.reduce(function (a, x) { return a + (x.est || 0); }, 0) * 100) / 100;
        _v71Commit_(sid, { item: { kind: 'DISH', name: it.name, code: it.code, unit: 'порц.' }, qty: qty, lines: lines2, short: short2, unreleased: [], cost: cost, est: est, status: short2.length ? 'PARTIAL' : 'FULL' },
          { at: at, seller: full.waiter, author: _rsWho_(c.s), opId: c.op.id });
      }
      try { if (typeof _mcCreateFactInternal_ === 'function') _mcCreateFactInternal_({ factType: 'SALE', objectType: 'SALE', objectId: sid, operationType: 'SALE', dateTime: at, value: sum, unit: 'RUB', result: 'RECORDED',
        source: 'J36', employeeName: full.waiter, description: 'Продажа зала ' + it.name + ' × ' + qty + ' (заказ ' + full.id + ')', skipRules: true }, c.s); } catch (e) {}
      ids.push(sid); out.sales.push({ saleId: sid, bill: b.id, dish: it.name, qty: qty, sumKop: adj[l.allocId] || 0, withCost: !!(cons && cons.lines && cons.lines.length) });
    });
    out.bills[b.id] = ids;
  });
  return out;
}

/* ---------------- возврат по счёту ---------------- */
/** Возврат по оплаченному счёту закрытого заказа: сторно выручки в J36 с причиной, без возврата на склад. {idem, billId, version, reason} */
function rsBillRefund(json, token) {
  return _rsMutate_(token, 'finance_edit|order_all', 'RS_BILL_REFUND', json, function (c) {
    var d = c.d, r = _rsRows_(MC_RS_SH_.BILLS).filter(function (b) { return String(b.BillID) === String(d.billId); })[0];
    if (!r) return { fail: ['NOT_FOUND', 'Счёт не найден'] };
    _rsCheckVersion_(r, d.version);
    if (String(r['Статус']) !== 'PAID') return { fail: ['VALIDATION', 'Возврат — только по оплаченному счёту'] };
    var reason = _rsS_(d.reason).slice(0, 300); if (reason.length < 5) return { fail: ['VALIDATION', 'Укажите причину возврата (не короче 5 символов)'] };
    var J = _rsJ36_(), v = J.sh.getDataRange().getValues(), n = J.n, now = new Date(), tz = _mcTz_(), cid = 'CN-' + Utilities.formatDate(now, tz, 'yyyyMMdd') + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
    var rows = []; for (var i = 1; i < v.length; i++) { var src = String(v[i][n + 3] || ''); if (src.indexOf('· счёт ' + r.BillID + ' ·') >= 0 && /RS-ALLOC/.test(src) && !/отменена\s+CN-|сторно\s+CN-/i.test(src)) rows.push(i); }
    if (!rows.length) return { fail: ['VALIDATION', 'Счёт ещё не проведён в журнал продаж (заказ не закрыт) — до закрытия заказа исправьте счёт, оплату отмените через кассу'] };
    var date = Utilities.formatDate(now, tz, 'dd.MM.yyyy'), time = Utilities.formatDate(now, tz, 'HH:mm'), total = 0, col = function (k) { return J.j.columns.indexOf(k); };
    try { if (typeof _v64AssertOpen_ === 'function') _v64AssertOpen_(new Date(now.getFullYear(), now.getMonth(), now.getDate()), 'возврат'); } catch (e) { return { fail: ['VALIDATION', String(e.message || e).replace(/^[A-Z_]+:\s*/, '')] }; }
    rows.forEach(function (i) {
      var src = String(v[i][n + 3] || ''), sm = /\b(SL-\d{8}-[0-9A-F]{8})\b/.exec(src), q = Number(v[i][col('Количество')]) || 0, s = Number(v[i][col('Сумма')]) || 0;
      J.sh.getRange(i + 1, n + 4).setValue(src + ' · отменена ' + cid);
      var line = J.j.columns.map(function (k, x) { if (k === '№') return Math.max(0, J.sh.getLastRow() - 1) + 1; if (k === 'Дата') return date; if (k === 'Время') return time; if (k === 'Количество') return -q; if (k === 'Сумма') return -s; return v[i][x]; });
      _mcJournalAppendTo_(J.sh, c.op, 'сторно ' + cid + ' · возврат по счёту ' + r.BillID + ' · ' + (sm ? sm[1] : '') + ' · ' + reason, line);
      try { if (typeof _v97CopyTags_ === 'function') _v97CopyTags_(J.sh, n, i + 1, J.sh.getLastRow()); } catch (e) {}
      total += s;
    });
    var b2 = _rsCopy_(r); b2['Статус'] = 'REFUNDED'; b2['Возврат'] = JSON.stringify({ doc: cid, reason: reason, sum: Math.round(total * 100) / 100, by: _rsWho_(c.s), at: Utilities.formatDate(now, tz, 'dd.MM.yyyy HH:mm') }); _rsStamp_(b2, c.s, c.op, false);
    var after = { doc: cid, rows: rows.length, sum: Math.round(total * 100) / 100, reason: reason, stock: 'продукты не возвращаются — блюда приготовлены' };
    return { data: after, plan: [{ sheet: MC_RS_SH_.BILLS, row: b2 }, { sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'BILL', String(r.BillID), { order: String(r.OrderID) }, 'BILL_REFUNDED', { status: 'PAID' }, after) }],
      audit: { action: 'RS_BILL_REFUNDED', entity: 'Ж_Продажи', id: String(r.BillID), after: after } };
  });
}

/* ---------------- сверка смены ---------------- */
/**
 * Отчёт смены и сверка. {date: гггг-мм-дд, siteId}
 * Право: finance_view, order_all или payment_confirm (без себестоимости — если нет costs / finance_view).
 */
function rsShiftReport(json, token) {
  return _rsRead_(token, 'finance_view|order_all|payment_confirm|cash_view', function (s) {
    var d = _rsJ_(json, {}) || {}, day = _rsDay_(d.date) || _rsToday_(), siteId = _rsSite_(d.siteId), money = _mcRbHasExact_(s, 'costs|finance_view');
    var inDay = function (x) { return _rsIsDate_(x) && Utilities.formatDate(x, _mcTz_(), 'yyyy-MM-dd') === day; };
    var orders = _rsRows_(MC_RS_SH_.ORDERS).filter(function (o) { return String(o.SiteID) === siteId; }), oIds = {}; orders.forEach(function (o) { oIds[String(o.OrderID)] = o; });
    var bills = _rsRows_(MC_RS_SH_.BILLS).filter(function (b) { return oIds[String(b.OrderID)]; });
    var paid = bills.filter(function (b) { return ['PAID', 'REFUNDED'].indexOf(String(b['Статус'])) >= 0 && inDay(b['Подтверждено']); });
    var byMethod = {}, paidKop = 0; paid.forEach(function (b) { var k = String(b['Способ оплаты'] || 'OTHER'), v = parseInt(b['Итого, коп'], 10) || 0; byMethod[k] = (byMethod[k] || 0) + v; paidKop += v; });
    var refunds = bills.filter(function (b) { var r = _rsJ_(b['Возврат'], null); return r && r.at && r.at.slice(0, 10) === day.split('-').reverse().join('.'); }), refundKop = refunds.reduce(function (a, b) { return a + Math.round((_rsJ_(b['Возврат'], {}).sum || 0) * 100); }, 0);
    // J36: проведено из зала и всего за день
    var J = _rsJ36_(), v = J.sh.getLastRow() > 1 ? J.sh.getDataRange().getValues() : [], n = J.n, ci = function (k) { return J.j.columns.indexOf(k); }, rsKop = 0, allKop = 0;
    for (var i = 1; i < v.length; i++) {
      if (_rsDay_(v[i][ci('Дата')]) !== day) continue;
      var src = String(v[i][n + 3] || ''), sm = Math.round((Number(v[i][ci('Сумма')]) || 0) * 100);
      allKop += sm; if (/RS-ALLOC|возврат по счёту/.test(src)) rsKop += sm;
    }
    // Z-отчёт кассы (V94)
    var z = null; try { var zr = _v94ZRows_().filter(function (r) { return _rsDay_(r['Дата смены']) === day && String(r['Статус']) === 'POSTED'; }); if (zr.length) { var net = zr.reduce(function (a, r) { return a + (Number(r['Выручка']) || 0); }, 0); z = _v94ZRecon_(day, Math.round(net * 100) / 100, _v94ZTol_()); z.reports = zr.length; } } catch (e) {}
    // производство за день: себестоимость, нехватка, отмены с расходом
    var items = _rsRows_(MC_RS_SH_.ITEMS).filter(function (r) { return oIds[String(r.OrderID)]; }), q = _rsRows_(MC_RS_SH_.QUEUE).filter(function (t) { return oIds[String(t.OrderID)] && inDay(t['Готово']); });
    var prodKop = 0, shorts = [], soldCostKop = 0;
    q.forEach(function (t) { prodKop += parseInt(t['Себестоимость, коп'], 10) || 0; var cs = _rsJ_(t['Списано по партиям'], null); if (cs && cs.short && cs.short.length) shorts.push({ table: String(t['Стол']), dish: String(t['Название']), short: cs.short.map(function (x) { return x.product + ' ' + (Math.round(x.qty * 1000) / 1000) + ' ' + x.unit; }) }); });
    var cancelLoss = [], partialNoAct = [];
    items.forEach(function (it) {
      var c0 = _rsJ_(it['Расход при отмене'], null); if (String(it['Статус']) !== 'CANCELLED' || !c0 || c0.mode === 'NONE' || !inDay(it.UpdatedAt)) return;
      var tk = _rsRows_(MC_RS_SH_.QUEUE).filter(function (t) { return String(t.TicketID) === String(it.TicketID); })[0];
      cancelLoss.push({ dish: String(it['Название']), mode: c0.mode, reason: String(it['Причина отмены'] || ''), costKop: tk ? parseInt(tk['Себестоимость, коп'], 10) || 0 : 0 });
      if (c0.mode === 'PARTIAL' && !c0.posted) partialNoAct.push({ dish: String(it['Название']), note: c0.note || '' });
    });
    // себестоимость проданного (проведённого) за день — по партиям строк V71 этих продаж
    var soldIds = {}; for (var k = 1; k < v.length; k++) { if (_rsDay_(v[k][ci('Дата')]) !== day) continue; var src2 = String(v[k][n + 3] || ''), m2 = /RS-ALLOC .*?\b(SL-\d{8}-[0-9A-F]{8})\b/.exec(src2); if (m2 && !/отменена\s+CN-/.test(src2)) soldIds[m2[1]] = 1; }
    try { var w2 = _book_().getSheetByName('Продажи_Списание_V71'); if (w2 && w2.getLastRow() > 1) w2.getDataRange().getValues().slice(1).forEach(function (r) { if (soldIds[String(r[0])]) soldCostKop += Math.round((Number(r[11]) || 0) * 100); }); } catch (e) {}
    // открытые заказы: оплачено, но не проведено; подано, но не оплачено
    var issues = [], add = function (sev, text) { issues.push({ severity: sev, text: text }); };
    orders.filter(function (o) { return String(o['Статус']) === 'OPEN'; }).forEach(function (o) {
      var its = items.filter(function (it) { return String(it.OrderID) === String(o.OrderID) && String(it['Статус']) !== 'CANCELLED'; });
      var pb = bills.filter(function (b) { return String(b.OrderID) === String(o.OrderID) && String(b['Статус']) === 'PAID'; });
      var served = its.filter(function (it) { return String(it['Статус']) === 'SERVED'; }).length;
      if (pb.length) add('warning', 'Стол заказа ' + String(o.OrderID).slice(-8) + ': счёт оплачен, заказ не закрыт — продажа не проведена в журнал');
      if (served && !pb.length) add('info', 'Заказ ' + String(o.OrderID).slice(-8) + ': подано ' + served + ' поз., оплаты ещё нет');
    });
    shorts.forEach(function (x) { add('warning', 'Стол ' + x.table + ', «' + x.dish + '»: при списании не хватило ' + x.short.join(', ') + ' — проверьте остатки (ревизия)'); });
    partialNoAct.forEach(function (x) { add('warning', '«' + x.dish + '»: частичный расход при отмене (' + x.note + ') — оформите акт списания'); });
    var postedKop = rsKop;
    if (paidKop - refundKop !== postedKop) add('warning', 'Оплачено по счетам за день ' + (paidKop - refundKop) / 100 + ' ₽, проведено в журнал из зала ' + postedKop / 100 + ' ₽ — разница ' + (paidKop - refundKop - postedKop) / 100 + ' ₽ (незакрытые заказы)');
    if (!z) add(paidKop ? 'warning' : 'info', 'Z-отчёт кассы за ' + day.split('-').reverse().join('.') + ' не загружен — сверка с кассой не выполнена (раздел «Касса: Z-отчёты»)');
    else if (z.status === 'MISMATCH') add('error', 'Z-отчёт ' + z.z + ' ₽ ≠ журнал продаж ' + z.journalTotal + ' ₽ — расхождение ' + z.diff + ' ₽');
    var out = { date: day, siteId: siteId, orders: { opened: orders.filter(function (o) { return inDay(o['Открыт']); }).length, closed: orders.filter(function (o) { return String(o['Статус']) === 'CLOSED' && inDay(o.UpdatedAt); }).length,
        open: orders.filter(function (o) { return String(o['Статус']) === 'OPEN'; }).length },
      paid: { kop: paidKop, byMethod: byMethod, bills: paid.length }, refunds: { kop: refundKop, bills: refunds.length }, journal: { hallKop: postedKop, allKop: allKop }, z: z,
      closed: orders.filter(function (o) { return String(o['Статус']) === 'CLOSED' && inDay(o.UpdatedAt); }).map(function (o) {
        var tidx = _rsTablesIdx_(), t = tidx[String(o.TableID)];
        return { id: String(o.OrderID), table: t ? t.number : '', waiter: String(o['Официант'] || ''), bills: bills.filter(function (b) { return String(b.OrderID) === String(o.OrderID) && ['PAID', 'REFUNDED'].indexOf(String(b['Статус'])) >= 0; })
          .map(function (b) { return { id: String(b.BillID), name: String(b['Название'] || ''), totalKop: parseInt(b['Итого, коп'], 10) || 0, status: String(b['Статус']), method: String(b['Способ оплаты'] || ''), version: parseInt(b.Version, 10) || 1 }; }) };
      }),
      can: { refund: _mcRbHasExact_(s, 'finance_edit|order_all') },
      cancelLoss: cancelLoss.map(function (x) { var o = { dish: x.dish, mode: x.mode, reason: x.reason }; if (money) o.costKop = x.costKop; return o; }), issues: issues,
      note: 'Продажа — только оплаченный и проведённый счёт. Внутренний счёт MON CHEF — не фискальный чек.' };
    if (money) { out.cost = { producedKop: prodKop, soldKop: soldCostKop, lossKop: cancelLoss.reduce(function (a, x) { return a + x.costKop; }, 0) }; out.foodCostPct = postedKop > 0 ? Math.round(soldCostKop / postedKop * 1000) / 10 : null; }
    return out;
  });
}

var MC_GATE_EXT_ = (typeof MC_GATE_EXT_ !== 'undefined' && MC_GATE_EXT_) || {};
MC_GATE_EXT_.rsBillRefund = { need: 'finance_edit|order_all', mut: true };
MC_GATE_EXT_.rsShiftReport = { need: 'finance_view|order_all|payment_confirm|cash_view' };
