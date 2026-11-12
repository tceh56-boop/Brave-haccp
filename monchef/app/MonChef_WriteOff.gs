/**
 * MON CHEF — списание по акту и приход полуфабрикатов (после этапа «полная инструкция»).
 *
 * Списание по акту: питание персонала, порча, истёк срок, проработка, представительские, недостача, прочее.
 *   • строка акта — продукт со склада или блюдо / полуфабрикат по ТТК (блюдо раскладывается до продуктов,
 *     готовые п/ф со склада берутся первыми — так же, как резерв банкета);
 *   • сначала расчёт (ничего не меняется), потом проведение: всё или ничего — если чего-то не хватает
 *     по допущенным партиям, акт не проводится и экран показывает, чего именно;
 *   • партии уменьшаются по FEFO; для питания персонала, проработки и представительских просроченные
 *     партии не берутся — их списывают только как порчу, истёкший срок, недостачу или «прочее»;
 *   • себестоимость — средняя цена остатка на момент списания (как в журнале склада), цену человек не вводит;
 *   • акт — лист «Акты_Списания», операции — журнал склада («Списание», источник «Акт …»), партии —
 *     связь прослеживаемости «списана по акту», в аудите — что списано и на сколько.
 *
 * Остаток полуфабриката на начало: партия п/ф, изготовленного до учёта в системе, без списания сырья.
 *   Себестоимость — расчёт по ТТК по средним ценам (помечена как расчёт); срок — только с этикетки
 *   или документа, система его не подставляет. Изготовление п/ф со списанием сырья — stockAddSemiProduct.
 */
var MC_WO_SHEET_ = 'Акты_Списания';
var MC_WO_HEAD_ = ['Акт', 'Дата', 'Причина (код)', 'Причина', 'Комментарий', 'Строк', 'Сумма, ₽', 'Составил', 'Роль',
  'Строки акта (JSON)', 'Списано со склада (JSON)', 'OperationID'];
// [код, название, можно ли брать просроченные партии]
var MC_WO_REASONS_ = [
  ['STAFF', 'Питание персонала', false],
  ['SPOIL', 'Порча, брак', true],
  ['EXPIRED', 'Истёк срок годности', true],
  ['TASTING', 'Проработка блюд, дегустация', false],
  ['HOSPITALITY', 'Представительские расходы', false],
  ['SHORTAGE', 'Недостача по инвентаризации', true],
  ['OTHER', 'Прочее (с пояснением)', true]
];

function _woSheet_() { return _bcSheet_(MC_WO_SHEET_, MC_WO_HEAD_); }
function _woReason_(code) { for (var i = 0; i < MC_WO_REASONS_.length; i++) if (MC_WO_REASONS_[i][0] === code) return MC_WO_REASONS_[i]; return null; }
function _woR2_(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function _woR3_(x) { return Math.round((Number(x) || 0) * 1000) / 1000; }

/** Допущенные партии с остатком одним проходом: [{k (ключ названия), pid (ProductID), u (базовая ед.), q, expired}]. */
function _woBatches_() {
  var v = _stockBatchesSheet_().getDataRange().getValues(), out = [];
  var t0 = new Date(); t0 = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate());
  for (var i = 1; i < v.length; i++) {
    var r = v[i]; if (!r[0] || String(r[10] || 'active') !== 'active') continue;
    var rem = parseFloat(r[9]) || 0; if (rem <= 0) continue;
    var b = _toBaseUnitServer_(rem, r[2] || 'г'), ex = _parseDate_(r[5]);
    out.push({ k: _prodKey_(r[1]), pid: String(r[17] || ''), u: b.unit, q: b.qty, expired: !!(ex && ex.getTime && ex.getTime() < t0.getTime()) });
  }
  return out;
}
/** Остаток продукта по партиям {ok — без просроченных, all} в базовой единице: по названию или по ProductID — как берёт FEFO. */
function _woAvail_(batches, name, baseUnit, pid) {
  var k = _prodKey_(name), a = { ok: 0, all: 0 };
  batches.forEach(function (b) {
    if (b.u !== baseUnit || (b.k !== k && !(pid && b.pid === pid))) return;
    a.all += b.q; if (!b.expired) a.ok += b.q;
  });
  return a;
}

/**
 * Раскладка строк акта до продуктов склада. lines: [{kind:'product'|'dish', name, code?, qty, unit}].
 * Возвращает { req: {«имя|ед.»: qty}, pf: {«имя|ед.»: qty} (готовые п/ф со склада), errors: [], lines: [нормализованные] }.
 */
function _woExpand_(lines, idx) {
  var req = {}, pf = {}, errors = [], norm = [], pfStock = null;
  (lines || []).forEach(function (l, i) {
    var n = i + 1, kind = l.kind === 'dish' ? 'dish' : 'product', q = parseFloat(String(l.qty).replace(',', '.'));
    if (!(q > 0)) { errors.push('Строка ' + n + ': укажите количество больше нуля'); return; }
    if (kind === 'product') {
      var nm = _cleanProdName_(l.name || ''), u = String(l.unit || 'г');
      if (!nm) { errors.push('Строка ' + n + ': укажите продукт'); return; }
      var k = nm + '|' + u; req[k] = (req[k] || 0) + q;
      norm.push({ kind: kind, name: nm, qty: q, unit: u });
      return;
    }
    var d = (l.code && idx.dishByCode[l.code]) || null;
    if (!d && l.name) d = _findPfDish_(l.name, idx) || idx.dishByNormName[_normNameServer_(l.name)] || null;
    if (!d) { errors.push('Строка ' + n + ': блюдо «' + (l.name || l.code || '') + '» не найдено в ТТК'); return; }
    if (!d.ing || !d.ing.length) { errors.push('Строка ' + n + ': в ТТК «' + d.name + '» нет состава — спишите продукты строками «продукт»'); return; }
    if (!pfStock) pfStock = _loadPfStockMap_();
    var acc = {}, used = {};
    if (d.semi) {
      // полуфабрикат: сначала его готовые партии на складе, недостающее — по его ТТК до сырья
      var b = _toBaseUnitServer_(q, l.unit || 'г');
      _serverExplodeInto_([[d.name, b.qty, b.unit, b.qty]], 1, acc, [], 0, idx.dishByCode, idx.dishByNormName, pfStock, used, idx.dishByLooseName);
      norm.push({ kind: kind, code: d.code, name: d.name, qty: q, unit: l.unit || 'г', semi: true });
    } else {
      // блюдо: состав ТТК на одну порцию × порции; готовые п/ф со склада — первыми (как резерв банкета)
      _serverExplodeInto_(d.ing, q, acc, [d.code], 0, idx.dishByCode, idx.dishByNormName, pfStock, used, idx.dishByLooseName);
      norm.push({ kind: kind, code: d.code, name: d.name, qty: q, unit: 'порц.', semi: false });
    }
    Object.keys(acc).forEach(function (k) { req[k] = (req[k] || 0) + acc[k]; });
    Object.keys(used).forEach(function (k) { pf[k] = (pf[k] || 0) + used[k]; });
  });
  return { req: req, pf: pf, errors: errors, lines: norm };
}

/** Строки к списанию с ценой, суммой и нехваткой по допущенным партиям. */
function _woPlan_(exp, allowExpired) {
  var batches = _woBatches_(), rows = [], total = 0, short = [], noPrice = [], pidOf = {};
  try { pidOf = _ttkPidByProdKey_(); } catch (e) {}
  function add(map, fromPf) {
    Object.keys(map).forEach(function (k) {
      var sep = k.lastIndexOf('|'), nm = k.slice(0, sep), un = k.slice(sep + 1), q = map[k];
      if (!(q > 0.0001)) return;
      var b = _toBaseUnitServer_(q, un), a = _woAvail_(batches, nm, b.unit, pidOf[_prodKey_(nm)] || '');
      var have = allowExpired ? a.all : a.ok;
      var price = _currentAvgPrice_(nm, un) || 0, sum = price * q;
      total += sum;
      var row = { name: nm, qty: _woR3_(q), unit: un, price: _woR2_(price), sum: _woR2_(sum), pf: !!fromPf };
      if (b.qty > have + 0.0005) {
        row.short = _woR3_((b.qty - have) / (_toBaseUnitServer_(1, un).qty || 1));
        if (!allowExpired && a.all > a.ok + 0.0005 && b.qty <= a.all + 0.0005) row.expiredOnly = true;
        short.push(row);
      }
      if (!(price > 0)) noPrice.push(nm);
      rows.push(row);
    });
  }
  add(exp.pf, true); add(exp.req, false);
  rows.sort(function (x, y) { return x.name.localeCompare(y.name, 'ru'); });
  return { rows: rows, total: _woR2_(total), shortages: short, noPrice: noPrice };
}

function _woParse_(json) {
  var d = _mcBlJson_(json) || {}, rs = _woReason_(String(d.reason || ''));
  return { d: d, reason: rs, comment: String(d.comment || '').trim(), lines: Array.isArray(d.lines) ? d.lines : [] };
}
function _woCheck_(p) {
  if (!p.reason) return 'Выберите причину списания';
  if (!p.lines.length) return 'Добавьте хотя бы одну строку';
  if (p.reason[0] === 'OTHER' && !p.comment) return 'Для причины «Прочее» напишите пояснение';
  return '';
}

/** Справочники экрана: причины, продукты со склада (остаток по допущенным партиям, средняя цена), блюда и п/ф ТТК, последние акты. */
function mcWriteOffData(token) {
  var s;
  try { s = _requireAuth_(token); } catch (e) { return _failFrom_(e); }
  try {
    var batches = _woBatches_(), products = [], pidOf = {};
    try { pidOf = _ttkPidByProdKey_(); } catch (e) {}
    JSON.parse(getStockBalances()).forEach(function (b) {
      var base = _toBaseUnitServer_(1, b.unit || 'г'), a = _woAvail_(batches, b.name, base.unit, pidOf[_prodKey_(b.name)] || '');
      products.push({ name: b.name, unit: b.unit || 'г', qty: _woR3_(b.qty), ok: _woR3_(a.ok / (base.qty || 1)), all: _woR3_(a.all / (base.qty || 1)), price: _woR2_(b.avgPrice), semi: !!b.isSemi });
    });
    var idx = _buildDishIndexes_(), dishes = [];
    Object.keys(idx.dishByCode).forEach(function (c) { var x = idx.dishByCode[c]; if (x && x.ing && x.ing.length) dishes.push({ code: c, name: x.name, semi: !!x.semi }); });
    dishes.sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); });
    return _ok_({ reasons: MC_WO_REASONS_.map(function (r) { return { code: r[0], name: r[1], expiredOk: r[2] }; }),
      products: products, dishes: dishes, acts: _woActs_(40), month: _woMonth_() });
  } catch (e) { return _failFrom_(e); }
}

/** Расчёт акта без изменений: продукты к списанию, цены, суммы, нехватка. */
function mcWriteOffPreview(json, token) {
  try { _requireAuth_(token); } catch (e) { return _failFrom_(e); }
  try {
    var p = _woParse_(json), err = _woCheck_(p);
    if (err) return _fail_('VALIDATION', err);
    var exp = _woExpand_(p.lines, _buildDishIndexes_());
    if (exp.errors.length) return _fail_('VALIDATION', exp.errors.join('; '));
    var plan = _woPlan_(exp, p.reason[2]);
    return _ok_({ reason: p.reason[1], lines: exp.lines, rows: plan.rows, total: plan.total, shortages: plan.shortages, noPrice: plan.noPrice });
  } catch (e) { return _failFrom_(e); }
}

/** Провести акт списания. json: {reason, comment, lines:[{kind, name, code, qty, unit}]} */
function mcWriteOffAct(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock', 'WRITE_OFF_ACT', 'Склад', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var p = _woParse_(json), err = _woCheck_(p);
    if (err) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', err, op.id); }
    return _withLock_(function () {
      var exp = _woExpand_(p.lines, _buildDishIndexes_());
      if (exp.errors.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', exp.errors.join('; '), op.id); }
      var allowExp = p.reason[2], plan = _woPlan_(exp, allowExp);
      if (plan.shortages.length) {
        _endOp_(op, 'FAILED');
        return _fail_('STOCK_SHORTAGE', 'Не хватает по допущенным партиям: ' + plan.shortages.map(function (r) {
          return r.name + ' — ' + r.short + ' ' + r.unit + (r.expiredOnly ? ' (есть только просроченное: его списывают как порчу или истёкший срок)' : ''); }).join('; ') +
          '. Партии в карантине и браке так не списываются. Акт не проведён.', op.id);
      }
      var sh = _woSheet_(), now = new Date(), ymd = Utilities.formatDate(now, _mcTz_(), 'yyyyMMdd'), n = 1;
      var v = sh.getDataRange().getValues();
      for (var i = 1; i < v.length; i++) if (String(v[i][0]).indexOf('АС-' + ymd + '-') === 0) n++;
      var actId = 'АС-' + ymd + '-' + ('00' + n).slice(-3), src = 'Акт ' + actId;
      var note = p.reason[1] + (p.comment ? ' · ' + p.comment : '');
      var pidOf = {}; try { pidOf = _ttkPidByProdKey_(); } catch (e) {}
      var who = _author_(op), done = [], total = 0;
      plan.rows.forEach(function (r) {
        var price = _currentAvgPrice_(r.name, r.unit) || 0;
        _logStockOp_('Списание', r.name, r.qty, r.unit, price, src, note);
        var got = _fifoConsume_(r.name, r.unit, r.qty, { allowExpired: allowExp, productId: pidOf[_prodKey_(r.name)] || '' });
        got.forEach(function (g) {
          try { if (typeof _mcCreateTraceLink_ === 'function' && g.batchId) _mcCreateTraceLink_('BATCH', String(g.batchId), 'СПИСАНА_ПО_АКТУ', 'WRITEOFF_ACT', actId,
            { dateTime: now, actor: who.фио, source: src, weight: g.qty, unit: g.unit }); } catch (te) {}
        });
        total += price * r.qty;
        done.push({ name: r.name, qty: r.qty, unit: r.unit, price: _woR2_(price), sum: _woR2_(price * r.qty), pf: r.pf, batches: got.map(function (g) { return { batchId: g.batchId, qty: g.qty, unit: g.unit }; }) });
      });
      sh.appendRow([actId, now, p.reason[0], p.reason[1], p.comment, exp.lines.length, _woR2_(total), who.фио, who.роль,
        JSON.stringify(exp.lines), JSON.stringify(done), op.id]);
      _audit_(op, 'WRITE_OFF_ACT', 'Акт списания', actId, null, { reason: p.reason[1], comment: p.comment, lines: exp.lines.length, products: done.length, total: _woR2_(total) });
      _endOp_(op);
      return _ok_({ actId: actId, date: _mcRbFmt_(now), reason: p.reason[1], comment: p.comment, author: who.фио, role: who.роль,
        lines: exp.lines, rows: done, total: _woR2_(total), noPrice: plan.noPrice }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

function _woActs_(limit) {
  var v = _woSheet_().getDataRange().getValues(), out = [];
  for (var i = v.length - 1; i >= 1 && out.length < (limit || 40); i--) {
    var r = v[i]; if (!r[0]) continue;
    var lines = [], rows = [];
    try { lines = JSON.parse(String(r[9] || '[]')); } catch (e) {}
    try { rows = JSON.parse(String(r[10] || '[]')); } catch (e) {}
    out.push({ actId: String(r[0]), date: r[1] instanceof Date ? _mcRbFmt_(r[1]) : String(r[1] || ''), reasonCode: String(r[2] || ''), reason: String(r[3] || ''),
      comment: String(r[4] || ''), lineCount: Number(r[5]) || lines.length, total: _woR2_(r[6]), author: String(r[7] || ''), role: String(r[8] || ''), lines: lines, rows: rows });
  }
  return out;
}
/** Итоги текущего месяца по причинам. */
function _woMonth_() {
  var v = _woSheet_().getDataRange().getValues(), now = new Date(), ym = Utilities.formatDate(now, _mcTz_(), 'yyyy-MM'), by = {}, total = 0, acts = 0;
  for (var i = 1; i < v.length; i++) {
    var r = v[i]; if (!r[0] || !(r[1] instanceof Date) || Utilities.formatDate(r[1], _mcTz_(), 'yyyy-MM') !== ym) continue;
    acts++; total += Number(r[6]) || 0; by[String(r[3] || '')] = _woR2_((by[String(r[3] || '')] || 0) + (Number(r[6]) || 0));
  }
  return { month: Utilities.formatDate(now, _mcTz_(), 'MM.yyyy'), acts: acts, total: _woR2_(total), byReason: by };
}

/* ======================= Приход полуфабрикатов ======================= */

/** Справочник экрана «Приход п/ф»: п/ф из ТТК (есть ли состав, назначены ли ККТ) и последние приходы п/ф. */
function mcPfIncomeData(token) {
  try { _requireAuth_(token); } catch (e) { return _failFrom_(e); }
  try {
    var idx = _buildDishIndexes_(), ccp = {};
    try {
      var tsh = _book_().getSheetByName(MC_TCCP_SHEET_), tv = tsh ? tsh.getDataRange().getValues() : [], last = {};
      for (var i = 1; i < tv.length; i++) last[String(tv[i][0]) + '|' + String(tv[i][1])] = String(tv[i][2]);
      Object.keys(last).forEach(function (k) { if (last[k] === 'ACTIVE') ccp[k.split('|')[0]] = true; });
    } catch (e) {}
    var pfs = JSON.parse(getSemiProducts()).map(function (p) {
      var d = idx.dishByCode[p.code] || {};
      return { code: p.code, name: p.name, unit: p.unit, hasIng: !!(d.ing && d.ing.length), ccp: !!ccp[p.code] };
    });
    var bv = _stockBatchesSheet_().getDataRange().getValues(), recent = [];
    for (var j = bv.length - 1; j >= 1 && recent.length < 25; j--) {
      var r = bv[j], src = String(r[7] || '');   // [ID, продукт, ед., кол-во, получено, срок, цена, источник, использовано, остаток, статус, …]
      if (!r[0] || !/^(Производство PR|Остаток на начало|Изготовлено поваром)/.test(src)) continue;
      recent.push({ batchId: String(r[0]), name: String(r[1] || ''), qty: _woR3_(r[3]), remain: _woR3_(r[9]), unit: String(r[2] || ''),
        date: r[4] instanceof Date ? _mcRbFmt_(r[4]) : String(r[4] || ''), expiry: r[5] instanceof Date ? Utilities.formatDate(r[5], _mcTz_(), 'dd.MM.yyyy') : String(r[5] || ''),
        source: /^Остаток/.test(src) ? 'остаток на начало' : 'изготовлено', status: String(r[10] || '') });
    }
    return _ok_({ pfs: pfs, recent: recent });
  } catch (e) { return _failFrom_(e); }
}

/**
 * Остаток п/ф на начало: партия без списания сырья. json: {name, qty, unit, expiry, made, comment}
 * Себестоимость — расчёт по ТТК по средним ценам остатков (если в ТТК есть состав), иначе 0 — и это видно.
 */
function mcPfOpeningBalance(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock', 'PF_OPENING_BALANCE', 'Склад', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {}, q = parseFloat(String(d.qty).replace(',', '.')), unit = String(d.unit || 'г');
    if (!d.name || !(q > 0)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите полуфабрикат и количество', op.id); }
    var exp = d.expiry ? _lblDate_(d.expiry) : '', made = d.made ? _lblDate_(d.made) : '';
    if (d.expiry && !exp) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Срок годности не распознаётся как дата', op.id); }
    if (d.made && !made) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Дата изготовления не распознаётся как дата', op.id); }
    return _withLock_(function () {
      var idx = _buildDishIndexes_(), pf = _findPfDish_(d.name, idx), name = pf ? pf.name : _cleanProdName_(d.name);
      var cost = 0, costNote = 'нет ТТК с составом — без себестоимости';
      if (pf && pf.ing && pf.ing.length) {
        var acc = _pfRawRequirement_(pf.code, q, unit, idx, null, null) || {};
        Object.keys(acc).forEach(function (k) { var sep = k.lastIndexOf('|'); cost += (_currentAvgPrice_(k.slice(0, sep), k.slice(sep + 1)) || 0) * acc[k]; });
        costNote = 'расчёт по ТТК по средним ценам остатков';
      }
      var unitPrice = q > 0 ? cost / q : 0, src = 'Остаток на начало (без списания сырья)';
      var r = _incomeWithBatches_([{ name: name, qty: q, unit: unit, price: unitPrice, expiry: exp, manufactured: made, docRef: 'Остаток на начало' }], src, String(d.comment || ''), op, true);
      var bid = (r.batchIds || [])[0] || '';
      _audit_(op, 'PF_OPENING_BALANCE', 'Партия', bid, null, { pf: name, qty: q, unit: unit, cost: _woR2_(cost), costNote: costNote, expiry: exp ? String(exp) : '', made: made ? String(made) : '' });
      _endOp_(op);
      return _ok_({ batch: bid, name: name, qty: q, unit: unit, cost: _woR2_(cost), unitCost: _woR2_(unitPrice), costNote: costNote,
        noExpiry: !exp, warning: exp ? '' : 'Срок годности не указан: на этикетке будет «срок не указан». Укажите срок с этикетки или документа в карточке партии.' }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
