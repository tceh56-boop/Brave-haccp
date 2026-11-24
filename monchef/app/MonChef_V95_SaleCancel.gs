/**
 * MON CHEF V95 — отмена ошибочной продажи с возвратом продуктов на склад.
 *
 * Раньше ошибочную продажу можно было исправить только ревизией. Теперь:
 *   • запись журнала продаж (J36) не правится и не удаляется — добавляется строка СТОРНО (количество и сумма со знаком минус,
 *     дата и время исходной продажи), у исходной строки в служебном столбце «Источник записи» — пометка «отменена CN-…»;
 *   • партии, списанные этой продажей (V71, «Продажи_Списание_V71» — «Списано по партиям»), получают количество обратно:
 *     остаток растёт, «использовано» уменьшается, израсходованная партия снова «active»; движение склада — «Корректировка»
 *     со знаком плюс (как корректировка накладной), событие партии CORRECTION, связь SALE —ВОЗВРАТ_НА_СКЛАД→ BATCH;
 *   • количество НЕ возвращается автоматически, если после продажи партию уже исправили или убрали: проведена ревизия по партии
 *     (V49), партия списана или возвращена поставщику, партии нет на складе. Такие строки показываются отдельно с причиной —
 *     остаток проверяют ревизией; система ничего не досписывает и не добавляет «из воздуха»;
 *   • чего не хватило при продаже (V71 «Не хватило») — не списывалось, возвращать нечего;
 *   • экономика (V64): строка сторно снимает выручку и себестоимость по возвращённым партиям; прогноз (V93), заготовки (V88),
 *     формы ОП (V72) и сверка Z-отчёта (V94) не учитывают отменённую продажу и её сторно.
 * Кто отменяет: роли журнала продаж (директор, администратор, шеф-повар) — продажу сегодняшнего дня; продажу прошлого дня —
 *   только право «finance_edit» (директор, бухгалтер). Закрытый финансовый период и закрытый журнал — отказ. Продажа банкета
 *   отменяется не здесь, а закрытием банкета (возврат / брак). Причина обязательна, подтверждение — галочкой.
 * Отмена частичная («пробили 3 вместо 2») не делается: отмените продажу и внесите заново с верным количеством.
 */
var MC_V95_ = 'Продажи_Отмены_V95';
var MC_V95_HEAD_ = ['CancelID', 'SaleID', 'Строка журнала', 'Строка сторно', 'Дата продажи', 'Время', 'Что продано', 'Кол-во', 'Ед.', 'Сумма, ₽', 'Причина',
  'Возвращено по партиям (JSON)', 'Не возвращено (JSON)', 'Себестоимость возврата, ₽', 'Статус', 'Отменил', 'Должность', 'Отменено', 'OperationID'];
var MC_V95_BLOCK_EV_ = { BATCH_WASTE: 'партия списана', BATCH_RETURN: 'партия возвращена поставщику', PROCESSING_WASTE: 'отходы обработки по партии' };
var MC_V95_ST_RU_ = { quarantine: 'карантин', recheck: 'повторная проверка', blocked: 'заблокирована', expired: 'срок истёк', defrost: 'дефрост', hold: 'ждёт решения по сроку' };

/** Строка журнала продаж — отменённая продажа или её сторно (для читателей журнала: прогноз, заготовки, формы ОП, сверка Z). */
function _v95IsVoid_(src) { return /(?:отменена|сторно)\s+CN-\d{8}-[0-9A-F]{8}/i.test(String(src || '')); }
function _v95R2_(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function _v95R3_(x) { return Math.round((Number(x) || 0) * 1000) / 1000; }
function _v95Fmt_(q) { return String(_v95R3_(q)).replace('.', ','); }
function _v95Ts_(x) { if (x instanceof Date) return x.getTime(); var d = x ? _parseDate_(x) : null; return d && d.getTime ? d.getTime() : null; }

/** Журнал продаж: строки и номера столбцов. */
function _v95J_() {
  var j = _mcJById_('J36'), sh = _book_().getSheetByName(j.sheetName), n = j.columns.length;
  return { j: j, sh: sh, n: n, v: sh && sh.getLastRow() > 1 ? sh.getDataRange().getValues() : [[]], c: function (name) { return j.columns.indexOf(name); } };
}
/** Найти продажу: {saleId} или {row} (номер строки листа журнала). */
function _v95Find_(J, d) {
  var sid = String(d.saleId || '').trim(), row = parseInt(d.row, 10), n = J.n;
  for (var i = 1; i < J.v.length; i++) {
    var r = J.v[i], src = String(r[n + 3] || '');
    if (sid ? (src.indexOf(sid) >= 0 && !/сторно\s+CN-/i.test(src)) : i + 1 === row) {
      var m = /\b(SL-\d{8}-[0-9A-F]{8})\b/.exec(src), seller = String(r[J.c('ФИО продавца')] || '');
      return { i: i, row: i + 1, r: r, src: src, saleId: m ? m[1] : '', dish: String(r[J.c('Блюдо')] || ''), qty: Number(r[J.c('Количество')]) || 0,
        price: Number(r[J.c('Цена')]) || 0, sum: r[J.c('Сумма')] === '' ? null : Number(r[J.c('Сумма')]), seller: seller, position: String(r[J.c('Должность')] || ''),
        date: _lbDateStr_(r[J.c('Дата')]), time: _lbTimeStr_(r[J.c('Время')]), day: _v71Day_(r[J.c('Дата')]), enteredAt: _v95Ts_(r[n + 2]),
        banquet: /Выдача банкета/i.test(seller) || /банкет/i.test(src), storno: /сторно\s+CN-/i.test(src), cancelled: (/отменена\s+(CN-\d{8}-[0-9A-F]{8})/i.exec(src) || [])[1] || '' };
    }
  }
  return null;
}
/** Что вернётся на склад: по строкам «Списано по партиям» продажи (V71). */
function _v95Plan_(f) {
  var out = { lines: [], back: [], keep: [], short: [], cost: 0, stockNote: '' };
  if (!f.saleId) { out.stockNote = 'склад этой продажей не списывался (запись до обновления V71) — возвращать нечего'; return out; }
  var w = _v92Rows_(MC_V71.SHEET).filter(function (x) { return String(x.SaleID) === f.saleId; })[0];
  if (!w) { out.stockNote = 'списания склада по продаже ' + f.saleId + ' нет — возвращать нечего'; return out; }
  out.unit = String(w['Ед.'] || '');
  var lines = [], sf = []; try { lines = JSON.parse(String(w['Списано по партиям (JSON)'] || '[]')); } catch (e) {} try { sf = JSON.parse(String(w['Не хватило (JSON)'] || '[]')); } catch (e) {}
  out.short = sf.map(function (s) { return { product: String(s.product || ''), qty: s.qty, unit: String(s.unit || ''), text: String(s.product || '') + ' — ' + _v95Fmt_(s.qty) + ' ' + String(s.unit || '') + ': не хватило при продаже, не списывалось — возвращать нечего' }; });
  if (!lines.length) { out.stockNote = String(w['Статус']) === 'ERROR' ? 'склад по продаже не списан (ошибка списания) — возвращать нечего' : 'с партий ничего не списано — возвращать нечего'; return out; }
  var saleAt = _v95Ts_(w['Создано']) || f.enteredAt || 0, agg = {}, order = [];
  lines.forEach(function (l) {
    var k = String(l.batchId); if (!agg[k]) { agg[k] = { batchId: k, product: String(l.product || ''), unit: String(l.unit || ''), qty: 0, price: Number(l.price) || 0, cost: 0, from: l.from }; order.push(k); }
    agg[k].qty += Number(l.qty) || 0; agg[k].cost += Number(l.cost) || 0;
  });
  var adj = {}; try { _v92Rows_(V49_REV.ADJ).forEach(function (a) { var t = _v95Ts_(a.CreatedAt); if (t && t > saleAt) (adj[String(a.BatchID)] = adj[String(a.BatchID)] || []).push(a); }); } catch (e) {}
  try { if (typeof _mcWbFlush_ === 'function') _mcWbFlush_(MC_BL_EV_); } catch (e) {}
  var today = _v71Day_(new Date());
  order.forEach(function (k) {
    var a = agg[k], b = _bcFind_(k), x = { batchId: k, product: a.product, qty: _v95R3_(a.qty), unit: a.unit, price: a.price, cost: _v95R2_(a.cost), from: a.from };
    x.text = a.product + ' — ' + _v95Fmt_(a.qty) + ' ' + a.unit + ' (партия ' + k + ')';
    var why = '';
    if (!b) why = 'партии нет в «Склад_Партии»';
    else if (String(b.v[10]) === 'returned') why = 'партия возвращена поставщику';
    else if (adj[k]) { var ad = adj[k][adj[k].length - 1]; why = 'после продажи по партии проведена ревизия ' + String(ad.RevisionID || '') + ' — остаток уже исправлен ревизией'; }
    else {
      var ev = []; try { ev = _mcBlEvents_(k).filter(function (e) { var t = _v95Ts_(e.at); return t && t > saleAt && MC_V95_BLOCK_EV_[e.type]; }); } catch (e) {}
      if (ev.length) why = 'после продажи: ' + MC_V95_BLOCK_EV_[ev[ev.length - 1].type] + ' — фактический остаток проверьте ревизией';
    }
    if (why) { x.reason = why; x.text += ': ' + why; out.keep.push(x); return; }
    var st = String(b.v[10] || 'active'), exp = b.v[5] ? _v71Day_(b.v[5]) : null, notes = [];
    if (MC_V95_ST_RU_[st]) notes.push('партия в статусе «' + MC_V95_ST_RU_[st] + '» — вернётся в том же статусе');
    if (exp && exp < today) notes.push('срок годности истёк ' + exp.split('-').reverse().join('.') + ' — партия не продаётся, оформите списание');
    x.status = st; x.note = notes.join('; '); if (x.note) x.text += ' — ' + x.note;
    out.back.push(x); out.cost += x.cost;
  });
  out.cost = _v95R2_(out.cost); out.lines = out.back.concat(out.keep);
  return out;
}
/** Может ли сессия отменить эту продажу: null — да, иначе текст отказа. */
function _v95Deny_(s, f) {
  if (!f) return 'Продажа не найдена';
  if (f.storno) return 'Это строка сторно — её не отменяют';
  if (f.cancelled) return 'Продажа уже отменена (' + f.cancelled + ')';
  if (f.banquet) return 'Продажа банкета отменяется закрытием банкета (возврат, брак), а не здесь';
  if (/\bRS-ALLOC\s/.test(f.src)) return 'Продажа зала (заказ стола): блюдо приготовлено, продукты израсходованы — возврат оформляется «Возвратом по счёту» в заказе, без возврата на склад';   // V101
  if (!(f.qty > 0)) return 'В строке нет количества — отменять нечего';
  var fin = _mcRbHasExact_(s, 'finance_edit');
  if (!fin && !_mcRbJournalAllowed_(s, 'J36')) return 'Отменяют продажу: ' + _mcRbJournalRoles_('J36').join(', ') + '; продажу прошлого дня — директор или бухгалтер.';
  if (f.day && f.day < _v71Day_(new Date()) && !fin) return 'Продажу прошлого дня (' + f.date + ') отменяет директор или бухгалтер (право «finance_edit»)';
  return null;
}
/** Z-отчёт за дату продажи: записан ли, сверка до и после отмены. */
function _v95Z_(f, minus) {
  if (typeof _v94ZRecon_ !== 'function' || typeof MC_V94_Z_ === 'undefined' || !f.day) return null;
  var z = _v92Rows_(MC_V94_Z_).filter(function (r) { return String(r['Статус']) === 'POSTED' && _v93Iso_(r['Дата смены']) === f.day; })[0];
  if (!z) return null;
  var net = Number(z['Выручка']), rc = _v94ZRecon_(f.day, isFinite(net) ? net : null, _v94ZTol_());
  var after = minus && rc.diff !== null ? _v95R2_(rc.diff + (f.sum || 0)) : rc.diff;
  return { id: String(z.ZID), shift: String(z['Смена №'] || ''), row: z._row, before: rc, diffAfter: after };
}
function _v95View_(f, plan, z, money) {
  var w = [];
  if (plan.stockNote) w.push(plan.stockNote);
  if (plan.keep.length) w.push('не вернётся автоматически: ' + plan.keep.length + ' партия(-и) — см. причину; остаток проверьте ревизией');
  if (z) w.push('Z-отчёт смены № ' + z.shift + ' за ' + f.date + ' записан — сверка с журналом будет пересчитана' + (money && z.diffAfter !== null ? ' (расхождение после отмены: ' + _v95Fmt_(z.diffAfter) + ' ₽)' : ''));
  return { saleId: f.saleId, row: f.row, date: f.date, time: f.time, dish: f.dish, qty: f.qty, price: money ? f.price : null, sum: money ? f.sum : null, seller: f.seller,
    back: plan.back.map(function (x) { return { batchId: x.batchId, product: x.product, qty: x.qty, unit: x.unit, text: x.text, cost: money ? x.cost : null }; }),
    keep: plan.keep.map(function (x) { return { batchId: x.batchId, product: x.product, qty: x.qty, unit: x.unit, reason: x.reason, text: x.text }; }),
    short: plan.short.map(function (x) { return x.text; }), cost: money ? plan.cost : null, warnings: w };
}

/** Предпросмотр отмены: что вернётся на склад, что нет и почему. {saleId} или {row}. Ничего не записывает. */
function v95SaleCancelPreview(json, token) {
  var s; try { s = _requireAuth_(token, 'banquets|journals|finance_edit'); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {}, J = _v95J_(), f = _v95Find_(J, d), deny = _v95Deny_(s, f);
    if (!f) return _fail_('NOT_FOUND', 'Продажа не найдена');
    var money = _mcRbHasExact_(s, 'revenue_view|finance_view|finance_edit|cash_view') || _mcRbJournalAllowed_(s, 'J36');
    return _ok_({ sale: _v95View_(f, _v95Plan_(f), _v95Z_(f, true), money), canCancel: !deny && !s.dev, deny: s.dev ? 'Технический доступ продажи не отменяет' : deny });
  } catch (e) { return _failFrom_(e); }
}

/** Отменить продажу: {saleId | row, reason, confirm: true}. Сторно в журнале, возврат партий на склад, аудит. */
function v95SaleCancel(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'banquets|journals|finance_edit', 'SALE_CANCEL', 'Журнал продаж', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var s = op.session, d = _mcBlJson_(json) || {}, reason = String(d.reason || '').trim();
    if (s.dev) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', 'Технический доступ продажи не отменяет', op.id); }
    if (reason.length < 5) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите причину отмены (не короче 5 символов)', op.id); }
    if (d.confirm !== true) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Подтвердите отмену галочкой', op.id); }
    return _withLock_(function () {
      var J = _v95J_(), f = _v95Find_(J, d), deny = _v95Deny_(s, f);
      if (!f) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Продажа не найдена', op.id); }
      if (deny) { _endOp_(op, 'FAILED'); return _fail_(f.cancelled ? 'ALREADY_CANCELLED' : /отменяет|Отменяют/.test(deny) ? 'FORBIDDEN' : 'VALIDATION', deny, op.id); }
      var d0 = _mcDateOnly_(f.r[J.c('Дата')]);
      if (typeof _v64AssertOpen_ === 'function') _v64AssertOpen_(d0, 'отменять продажу');   // закрытый финансовый период (ТЗ §14.11)
      _mcAssertJournalPeriodOpen_('J36', f.date);
      var plan = _v95Plan_(f), who = _author_(op), now = new Date(), cid = 'CN-' + Utilities.formatDate(now, _mcTz_(), 'yyyyMMdd') + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
      // 1. партии: количество обратно
      plan.back.forEach(function (x) {
        var b = _bcFind_(x.batchId); if (!b) return;
        var rest = Number(b.v[9]) || 0, used = Number(b.v[8]) || 0, st = String(b.v[10] || 'active'), nr = _v95R3_(rest + x.qty), nu = Math.max(0, _v95R3_(used - x.qty));
        b.sh.getRange(b.row, 9).setValue(nu); b.sh.getRange(b.row, 10).setValue(nr); b.v[8] = nu; b.v[9] = nr;
        if (st === 'consumed' && nr > 0.001) _bcSetStatus_(b, 'active');
        var price = Number(b.v[6]) || x.price || 0;
        _stockOpsSheet_().appendRow(['OP' + Date.now() + Math.floor(Math.random() * 1000), now, 'Корректировка', _cleanProdName_(x.product), x.qty, x.unit || 'г', _v95R2_(price), _v95R2_(price * x.qty),
          'Отмена продажи ' + (f.saleId || 'строка ' + f.row), cid + ' · ' + reason.slice(0, 150), now]);
        _applyStockDelta_(x.product, x.unit || 'г', x.qty, 0);
        try { _mcBlEvent_(op, x.batchId, 'CORRECTION', { qty: x.qty, unit: x.unit, reason: 'Отмена продажи ' + f.saleId + ': ' + reason, doc: cid, corrects: f.saleId, before: { remain: rest, status: st }, after: { remain: nr, status: String(b.v[10]) } }); } catch (e) {}
        try { if (typeof _mcCreateTraceLink_ === 'function') _mcCreateTraceLink_('SALE', f.saleId, 'ВОЗВРАТ_НА_СКЛАД', 'BATCH', x.batchId, { dateTime: now, actor: who.фио, source: cid, weight: x.qty, unit: x.unit }); } catch (e) {}
        x.restAfter = nr;
      });
      // 2. журнал продаж: сторно (исходная строка не меняется, кроме пометки в служебном столбце)
      var sh = J.sh, row = J.j.columns.map(function (col) {
        switch (col) {
          case '№': return Math.max(0, sh.getLastRow() - 1) + 1;
          case 'Дата': return f.date; case 'Время': return f.time; case 'Блюдо': return f.dish; case 'Количество': return -f.qty; case 'Цена': return f.price;
          case 'Сумма': return f.sum === null ? -_v95R2_(f.qty * f.price) : -f.sum; case 'ФИО продавца': return f.seller; case 'Должность': return f.position; default: return '';
        }
      });
      _mcJournalAppendTo_(sh, op, 'сторно ' + cid + ' к ' + (f.saleId || 'строке ' + f.row) + ' · ' + reason.slice(0, 120), row);
      var stRow = sh.getLastRow();
      sh.getRange(f.row, J.n + 4).setValue(f.src + ' · отменена ' + cid);
      try { if (typeof _v97CopyTags_ === 'function') _v97CopyTags_(sh, J.n, f.row, stRow); } catch (e) {}   // V97: площадка и канал
      try { if (typeof _mcMirrorRow_ === 'function') _mcMirrorRow_('J36', stRow); } catch (e) {}
      if (f.saleId && typeof _mcCreateTraceLink_ === 'function') { try { _mcCreateTraceLink_('SALE', f.saleId, 'ОТМЕНЕНА', 'SALE_CANCEL', cid, { dateTime: now, actor: who.фио, source: 'J36' }); } catch (e) {} }
      // 3. лист отмен
      _v93Write_(MC_V95_, MC_V95_HEAD_, { CancelID: cid, SaleID: f.saleId, 'Строка журнала': f.row, 'Строка сторно': stRow, 'Дата продажи': f.date, 'Время': f.time, 'Что продано': f.dish, 'Кол-во': f.qty,
        'Ед.': plan.unit || '', 'Сумма, ₽': f.sum === null ? '' : f.sum, 'Причина': reason, 'Возвращено по партиям (JSON)': JSON.stringify(plan.back), 'Не возвращено (JSON)': JSON.stringify(plan.keep),
        'Себестоимость возврата, ₽': plan.cost, 'Статус': 'DONE', 'Отменил': who.фио, 'Должность': who.должность, 'Отменено': now, OperationID: op.id });
      // 4. сверка Z-отчёта за дату — пересчёт
      var z = null;
      try {
        var zz = _v95Z_(f, false);
        if (zz) { var zr = _v92Rows_(MC_V94_Z_).filter(function (r) { return r._row === zz.row; })[0]; if (zr) { zr['Сверка (JSON)'] = JSON.stringify(zz.before); _v93Write_(MC_V94_Z_, MC_V94_Z_HEAD_, zr); } z = { shift: zz.shift, status: zz.before.status, diff: zz.before.diff }; }
      } catch (e) {}
      _audit_(op, 'SALE_CANCEL', 'Журнал продаж', f.saleId || ('J36 строка ' + f.row), { блюдо: f.dish, количество: f.qty, сумма: f.sum, дата: f.date, время: f.time, продавец: f.seller },
        { отмена: cid, причина: reason, сторно_строка: stRow, возвращено: plan.back.map(function (x) { return x.text; }), не_возвращено: plan.keep.map(function (x) { return x.text; }), себестоимость_возврата: plan.cost, z: z });
      _endOp_(op);
      return _ok_({ cancelId: cid, saleId: f.saleId, dish: f.dish, qty: f.qty, sum: f.sum, date: f.date, stornoRow: stRow,
        back: plan.back.map(function (x) { return { batchId: x.batchId, product: x.product, qty: x.qty, unit: x.unit, restAfter: x.restAfter, text: x.text }; }),
        keep: plan.keep.map(function (x) { return { batchId: x.batchId, reason: x.reason, text: x.text }; }), stockNote: plan.stockNote, z: z }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Отмены для экономики (V64): CancelID → возвращённые партии. */
function _v95Cancels_() {
  var m = {}; try { _v92Rows_(MC_V95_).forEach(function (r) { var b = []; try { b = JSON.parse(String(r['Возвращено по партиям (JSON)'] || '[]')); } catch (e) {} m[String(r.CancelID)] = { saleId: String(r.SaleID || ''), back: b, row: r['Строка журнала'] }; }); } catch (e) {}
  return m;
}

// Экран «Журнал продаж»: у последних записей — отменена / сторно, можно ли отменить.
(function () {
  if (typeof mcSaleData !== 'function') return;
  var orig = mcSaleData;
  mcSaleData = function (token) {
    var res = orig(token), o; try { o = JSON.parse(res); } catch (e) { return res; }
    if (!o || !(o.ok || o.success) || !o.data) return res;
    try {
      var s = _requireAuth_(token), J = _v95J_(), n = J.n, today = _v71Day_(new Date()), fin = _mcRbHasExact_(s, 'finance_edit'), jr = _mcRbJournalAllowed_(s, 'J36'), k = 0;
      for (var i = J.v.length - 1; i >= 1 && k < (o.data.recent || []).length; i--) {
        var r = J.v[i]; if (!r[J.c('Блюдо')] && !r[J.c('Сумма')]) continue;
        var rc = o.data.recent[k++], src = String(r[n + 3] || ''), seller = String(r[J.c('ФИО продавца')] || '');
        rc.row = i + 1;
        rc.storno = /сторно\s+CN-/i.test(src);
        rc.cancelled = (/отменена\s+(CN-\d{8}-[0-9A-F]{8})/i.exec(src) || [])[1] || '';
        if (rc.storno) { rc.saleId = ''; delete rc.stock; rc.source = 'сторно' + ((/(CN-\d{8}-[0-9A-F]{8})/.exec(src) || [])[1] ? ' ' + /(CN-\d{8}-[0-9A-F]{8})/.exec(src)[1] : ''); }
        if (rc.cancelled) rc.source = String(rc.source || '').replace(/\s*·\s*отменена\s+CN-\S+/i, '');
        var day = _v71Day_(r[J.c('Дата')]), banq = /Выдача банкета/i.test(seller) || /банкет/i.test(src);
        rc.canCancel = !s.dev && !rc.storno && !rc.cancelled && !banq && (Number(r[J.c('Количество')]) || 0) > 0 && (fin || (jr && day === today));
      }
      o.data.canCancelAny = !s.dev && (fin || jr);
    } catch (e) {}
    return JSON.stringify(o);
  };
})();
