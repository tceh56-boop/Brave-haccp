// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
/**
 * ЦЕХ Стандарт V77 — интеграция с iiko, этап 2б: техкарты и приходные накладные (сверка, без перезаписи данных ЦЕХ).
 *
 * Техкарты: GET /resto/api/v2/assemblyCharts/getAll (действующие на дату) + номенклатура /v2/entities/products/list и единицы
 *   /v2/entities/list?rootType=MeasureUnit. Каждая техкарта iiko сверяется с ТТК ЦЕХ (блюдо — по сопоставлению кассы или точному
 *   названию): нет в ТТК, ингредиент только в iiko или только в ЦЕХ, брутто на порцию расходится больше чем на 5 %.
 *   ТТК ЦЕХ не меняются: ТТК — документ ХАССП с согласованием, а техкарта iiko — подсказка, что поправить.
 * Приходные накладные: GET /resto/api/documents/export/incomingInvoice (XML) + поставщики /resto/api/suppliers (XML).
 *   Накладные сохраняются в «Инт_Накладные_iiko» (одна строка — позиция, без дублей по id документа и позиции) и сверяются с приёмкой
 *   ЦЕХ («Приёмка_Партии») по номеру накладной и поставщику: приёмки нет — сигнал «товар пришёл по iiko, но не принят в ЦЕХ»
 *   (входной контроль, партии, сроки годности). Партии автоматически не создаются: приёмка — это входной контроль человеком.
 * XmlService в облачной версии нет, поэтому XML iiko разбирается простым разбором по тегам (структура плоская).
 */
var MC_V77_INV = ['Инт_Накладные_iiko', ['Key', 'DocID', 'DocNumber', 'IncomingNumber', 'Date', 'Supplier', 'SupplierINN', 'Status', 'ProductID', 'Product', 'Article', 'Qty', 'Unit', 'Price', 'Sum', 'LoadedAt', 'OperationID']];
var MC_V77_CHART_TOL = 0.05;

/* ---------------- разбор XML iiko ---------------- */
function _v77XmlDec_(s) { return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(+n); }).replace(/&amp;/g, '&').trim(); }
/** Содержимое всех элементов <tag>…</tag> (элементы с этим именем не вложены друг в друга). */
function _v77XmlAll_(xml, tag) {
  var re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'g'), out = [], m;
  while ((m = re.exec(String(xml || '')))) out.push(m[1]);
  return out;
}
/** Значение простого дочернего элемента (без вложенного блока items). */
function _v77XmlVal_(block, tag) {
  var b = String(block || '').replace(/<items(?:\s[^>]*)?>[\s\S]*?<\/items>/g, '');
  var m = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>').exec(b);
  return m ? _v77XmlDec_(m[1]) : '';
}

/* ---------------- справочники iiko ---------------- */
function _v77IikoRefs_(call) {
  var prods = call('get', '/v2/entities/products/list?includeDeleted=false'), units = {}, byId = {};
  try { (call('get', '/v2/entities/list?rootType=MeasureUnit&includeDeleted=false') || []).forEach(function (u) { units[u.id] = String(u.name || ''); }); } catch (e) {}
  (Array.isArray(prods) ? prods : []).forEach(function (p) { byId[p.id] = { id: p.id, name: String(p.name || ''), code: String(p.code || p.num || ''), type: String(p.type || ''), unit: units[p.mainUnit] || '' }; });
  return byId;
}
/** Единица iiko → единица ЦЕХ и множитель к базовой (г, мл, шт). */
function _v77IikoUnit_(u) {
  var s = _v77Norm_(u).replace(/\./g, '');
  if (s === 'кг' || s === 'kg') return 'кг'; if (s === 'г' || s === 'гр' || s === 'g') return 'г';
  if (s === 'л' || s === 'l') return 'л'; if (s === 'мл' || s === 'ml') return 'мл';
  if (/^(шт|порц|pcs|порция)/.test(s)) return 'шт';
  return s || 'кг';
}

/* ---------------- техкарты ---------------- */
/** Сверка техкарт iiko с ТТК ЦЕХ на дату (по умолчанию сегодня). Только чтение. */
function v77IikoCharts(json, token) {
  try {
    _requireAuth_(token, 'finance_view|catalog|ttk_edit');
    var d = _v64Json_(json), cfg = _v77IikoCfg_();
    if (!cfg || !cfg.passHash) return _fail_('VALIDATION', 'Сначала настройте подключение к iiko');
    var w = d.date ? _v77When_(d.date) : null, day = w ? w.day : _mcNow_(), iso = _v77DayIso_(day);
    var R;
    try {
      R = _v77IikoSession_(cfg, function (call) {
        var refs = _v77IikoRefs_(call), ch = call('get', '/v2/assemblyCharts/getAll?dateFrom=' + iso + '&dateTo=' + iso + '&includeDeletedProducts=false&includePreparedCharts=false');
        return { refs: refs, charts: (ch && ch.assemblyCharts) || [] };
      });
    } catch (e) { return _fail_('IIKO', String(e.message || e)); }
    return _ok_(_v77ChartsCompare_(R.refs, R.charts, iso));
  } catch (e) { return _failFrom_(e); }
}
function _v77ChartsCompare_(refs, charts, iso) {
  var idx = _buildDishIndexes_(), maps = _v77Maps_('iiko'), out = [], tot = { charts: 0, same: 0, diff: 0, missing: 0 };
  charts.forEach(function (c) {
    var p = refs[c.assembledProductId]; if (!p || (p.type && p.type !== 'DISH')) return;
    tot.charts++;
    var amount = Number(c.assembledAmount) || 1, mp = _v77FindMap_(maps, 'iiko', { extId: p.code, name: p.name }), dish = null;
    if (mp && mp.kind === 'DISH') dish = idx.dishByNormName[_normNameServer_(mp.target)] || null;
    if (!dish) dish = idx.dishByNormName[_normNameServer_(p.name)] || null;
    if (dish && dish.semi) dish = null;
    var iiko = {};
    (c.items || []).forEach(function (it) {
      var q = refs[it.productId] || { name: String(it.productId), unit: '' }, u = _v77IikoUnit_(q.unit), brutto = (Number(it.amountIn) || 0) / amount;
      var k = _v77Norm_(q.name); iiko[k] = { name: q.name, base: _toBaseUnitServer_(brutto, u), unit: u, brutto: _v77R3_(brutto) };
    });
    var row = { dish: p.name, code: p.code, cehDish: dish ? String(dish.name) : '', items: Object.keys(iiko).length, issues: [] };
    if (!dish) { row.issues.push('нет в ТТК ЦЕХ'); tot.missing++; out.push(row); return; }
    var ceh = {};
    (dish.ing || []).forEach(function (g) { ceh[_v77Norm_(g[0])] = { name: String(g[0]), base: _toBaseUnitServer_(Number(g[1]) || 0, g[2]), unit: g[2] }; });
    Object.keys(iiko).forEach(function (k) {
      var a = iiko[k], b = ceh[k];
      if (!b) { row.issues.push('только в iiko: ' + a.name + ' ' + String(a.brutto).replace('.', ',') + ' ' + a.unit); return; }
      if (a.base.unit !== b.base.unit) { row.issues.push(a.name + ': разные единицы (iiko ' + a.unit + ', ЦЕХ ' + b.unit + ')'); return; }
      var diff = b.base.qty ? (a.base.qty - b.base.qty) / b.base.qty : (a.base.qty ? 1 : 0);
      if (Math.abs(diff) > MC_V77_CHART_TOL) row.issues.push(a.name + ': брутто iiko ' + _v77R2_(a.base.qty) + ' ' + a.base.unit + ', ЦЕХ ' + _v77R2_(b.base.qty) + ' ' + b.base.unit + ' (' + (diff > 0 ? '+' : '') + Math.round(diff * 100) + ' %)');
    });
    Object.keys(ceh).forEach(function (k) { if (!iiko[k]) row.issues.push('только в ЦЕХ: ' + ceh[k].name); });
    if (row.issues.length) tot.diff++; else tot.same++;
    out.push(row);
  });
  out.sort(function (a, b) { return (b.issues.length ? 1 : 0) - (a.issues.length ? 1 : 0) || a.dish.localeCompare(b.dish, 'ru'); });
  return { date: iso, totals: tot, charts: out, tolerancePct: MC_V77_CHART_TOL * 100,
    note: 'Брутто на одну порцию. Совпадение в пределах ' + MC_V77_CHART_TOL * 100 + ' %. ТТК ЦЕХ не меняются — исправляйте карту в ЦЕХ или в iiko, чтобы списание совпадало.' };
}

/* ---------------- приходные накладные ---------------- */
function _v77InvSh_() { return _v64Sheet_(MC_V77_INV[0], MC_V77_INV[1]); }
/** Загрузить приходные накладные iiko за период и сверить с приёмкой ЦЕХ. json: {from, to} (по умолчанию последние 7 дней). */
function v77IikoInvoices(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'finance_edit|receiving|procurement', 'V77_IIKO_INV', 'Интеграции', 'iiko', null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), cfg = _v77IikoCfg_();
    if (!cfg || !cfg.passHash) return _v64Fail_(op, 'VALIDATION', 'Сначала настройте подключение к iiko');
    var now = _mcNow_(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var from = d.from ? (_v77When_(d.from) || {}).day : new Date(today.getTime() - 6 * 86400000), to = d.to ? (_v77When_(d.to) || {}).day : today;
    if (!from || !to || from > to) return _v64Fail_(op, 'VALIDATION', 'Период не распознан');
    if ((to - from) / 86400000 + 1 > MC_V77_IIKO_MAX_DAYS) return _v64Fail_(op, 'VALIDATION', 'За один раз — не больше ' + MC_V77_IIKO_MAX_DAYS + ' дней');
    var R;
    try {
      R = _v77IikoSession_(cfg, function (call) {
        var refs = _v77IikoRefs_(call), sup = {};
        var sx = call('get', '/suppliers');
        _v77XmlAll_(sx, 'employee').forEach(function (b) { sup[_v77XmlVal_(b, 'id')] = { name: _v77XmlVal_(b, 'name'), inn: _v77XmlVal_(b, 'taxpayerIdNumber') }; });
        var x = call('get', '/documents/export/incomingInvoice?from=' + _v77DayIso_(from) + '&to=' + _v77DayIso_(to));
        return { refs: refs, sup: sup, docs: _v77XmlAll_(x, 'document') };
      });
    } catch (e) { _endOp_(op, 'FAILED'); return _fail_('IIKO', String(e.message || e), op.id); }
    return _withLock_(function () {
      var sh = _v77InvSh_(), have = {}, n = sh.getLastRow(), H = MC_V77_INV[1], now2 = new Date(), rows = [], docs = 0, skipped = 0;
      if (n > 1) sh.getRange(2, 1, n - 1, 1).getValues().forEach(function (r) { have[String(r[0])] = true; });
      R.docs.forEach(function (doc) {
        var status = _v77XmlVal_(doc, 'status');
        if (status && status !== 'PROCESSED') { skipped++; return; }   // черновики и удалённые не сверяются
        docs++;
        var id = _v77XmlVal_(doc, 'id'), s = R.sup[_v77XmlVal_(doc, 'supplier')] || { name: '', inn: '' }, w = _v77When_(_v77XmlVal_(doc, 'incomingDate') || _v77XmlVal_(doc, 'dateIncoming'));
        _v77XmlAll_(doc, 'item').forEach(function (it, i) {
          var key = 'iiko:' + id + ':' + (_v77XmlVal_(it, 'num') || i + 1);
          if (have[key]) return; have[key] = true;
          var p = R.refs[_v77XmlVal_(it, 'product')] || { name: _v77XmlVal_(it, 'product'), unit: '' };
          var o = { Key: key, DocID: id, DocNumber: _v77XmlVal_(doc, 'documentNumber'), IncomingNumber: _v77XmlVal_(doc, 'incomingDocumentNumber'), Date: w ? _v77DayIso_(w.day) : '',
            Supplier: s.name, SupplierINN: s.inn, Status: status || 'PROCESSED', ProductID: _v77XmlVal_(it, 'product'), Product: p.name, Article: _v77XmlVal_(it, 'productArticle'),
            Qty: _v77Num_(_v77XmlVal_(it, 'actualAmount') || _v77XmlVal_(it, 'amount')), Unit: _v77IikoUnit_(p.unit), Price: _v77Num_(_v77XmlVal_(it, 'price')), Sum: _v77Num_(_v77XmlVal_(it, 'sum')), LoadedAt: now2, OperationID: op.id };
          rows.push(H.map(function (h) { var v = o[h]; return v === undefined || v === null || (typeof v === 'number' && isNaN(v)) ? '' : v; }));
        });
      });
      if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, H.length).setValues(rows);
      var rec = _v77InvRecon_(_v77DayIso_(from), _v77DayIso_(to));
      _audit_(op, 'V77_IIKO_INV', MC_V77_INV[0], 'iiko', null, { период: _v77DayIso_(from) + ' — ' + _v77DayIso_(to), накладных: docs, новых_позиций: rows.length, без_приёмки: rec.notReceived.length });
      _endOp_(op);
      rec.loaded = { documents: docs, newLines: rows.length, skippedDrafts: skipped };
      return _ok_(rec, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function _v77InvNo_(s) { return String(s || '').toLowerCase().replace(/[^0-9a-zа-я]/g, '').replace(/^0+/, ''); }
/** Сверка накладных iiko (или поступлений 1С — sheetName) за период с приёмкой ЦЕХ по номеру накладной (входящему или внутреннему) и поставщику. */
function _v77InvRecon_(fromIso, toIso, sheetName) {
  var inv = {}, sh = _book_().getSheetByName(sheetName || MC_V77_INV[0]);
  if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, MC_V77_INV[1].length).getValues().forEach(function (r) {
    var o = {}; MC_V77_INV[1].forEach(function (h, j) { o[h] = r[j]; });
    var day = _v72DayStr_(o.Date); if (day < fromIso || day > toIso) return;
    var x = inv[o.DocID] || (inv[o.DocID] = { docId: String(o.DocID), number: String(o.IncomingNumber || o.DocNumber || ''), docNumber: String(o.DocNumber || ''), date: day, supplier: String(o.Supplier || ''), inn: String(o.SupplierINN || ''), lines: 0, sum: 0 });
    x.lines++; x.sum = _v77R2_(x.sum + (Number(o.Sum) || 0));
  });
  var rec = {}, ps = _book_().getSheetByName('Приёмка_Партии');
  if (ps && ps.getLastRow() > 1) {
    var v = ps.getDataRange().getValues(), h = v[0].map(function (c) { return String(c || '').trim(); }), cn = h.indexOf('Накладная'), cs = h.indexOf('Поставщик'), cc = h.indexOf('Стоимость');
    for (var i = 1; i < v.length; i++) { var k = _v77InvNo_(v[i][cn]); if (!k) continue; var y = rec[k] || (rec[k] = { suppliers: {}, sum: 0 }); y.suppliers[_v77Norm_(v[i][cs])] = true; y.sum += Number(v[i][cc]) || 0; }
  }
  var list = Object.keys(inv).map(function (k) { return inv[k]; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  var matched = [], notReceived = [];
  list.forEach(function (x) {
    var y = rec[_v77InvNo_(x.number)] || rec[_v77InvNo_(x.docNumber)];
    if (y && (!x.supplier || y.suppliers[_v77Norm_(x.supplier)] || Object.keys(y.suppliers).some(function (s) { return !s; }))) { x.cehSum = _v77R2_(y.sum); x.diff = _v77R2_(y.sum - x.sum); matched.push(x); }
    else notReceived.push(x);
  });
  return { from: fromIso, to: toIso, invoices: list.length, matched: matched, notReceived: notReceived,
    note: 'Накладная iiko без приёмки в ЦЕХ — товар пришёл, но не прошёл входной контроль: нет партии, срока годности и прослеживаемости. Сверка по номеру накладной и поставщику.' };
}
