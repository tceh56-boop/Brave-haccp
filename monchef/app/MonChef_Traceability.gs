/**
 * MON CHEF — движок прослеживаемости (ТЗ §24, §45). Функции с именами из ТЗ поверх единого
 * графа связей (V5: лист связей, _mcTraceGraph_), куда пишут приёмка, производство, отбор FEFO,
 * пробы, выдача на банкет, реализация, факты ККТ. Здесь только чтение и понятная человеку сводка.
 *
 *   getBatchTraceability(batchId)        — партия: откуда пришла и куда ушла, сводка по ТЗ §24
 *   getReverseTraceability(batchId)      — обратный поиск: из чего сделана партия
 *   getRawMaterialTraceability(product)  — все партии сырья продукта и их путь
 *   getDishTraceability(code)            — блюдо/п-ф: выпуски по карте и сырьё каждого выпуска
 *   getProductionChain(productionId)     — цепочка выпуска: сырьё → производство → партия → ККТ
 */
var MC_TRACE_RU_ = { BATCH: 'партия', PRODUCTION: 'производство', TTK: 'ТТК', CCP: 'ККТ', FACT: 'факт', SALE: 'реализация', BANQUET: 'банкет',
  DAILY_SAMPLE: 'суточная проба', SUPPLIER_DOCUMENT: 'документ поставщика', EQUIPMENT: 'оборудование', JOURNAL: 'журнал', DISH: 'блюдо',
  LOCATION: 'место хранения', OPENING: 'вскрытие', USE: 'использование', WASTE: 'списание', ORIGINAL_LABEL: 'оригинальная этикетка', RECEIPT_PHOTO: 'фото при приёмке', SUPPLIER: 'возврат поставщику', VSD: 'ВСД «Меркурий»' };

function _mcTraceSummary_(batchId) {
  var fwd = _mcTraceGraph_('BATCH', batchId, 'forward', 16), rev = _mcTraceGraph_('BATCH', batchId, 'reverse', 16);
  var pick = function (list, type) { var seen = {}; return list.filter(function (x) { var k = x.nextType + '|' + x.nextId; if (x.nextType !== type || seen[k]) return false; seen[k] = true; return true; })
    .map(function (x) { return { id: x.nextId, relation: x.link.relation, at: x.link.dateTime, actor: x.link.actor, qty: x.link.weight, unit: x.link.unit }; }); };
  var batch = null, stock = null;
  try { var v = _stockBatchesSheet_().getDataRange().getValues(); for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(batchId)) { stock = v[i]; break; } } catch (e) {}
  if (stock) batch = { id: stock[0], product: stock[1], unit: stock[2], qty: stock[3], received: stock[4], expiry: stock[5], source: stock[7], remain: stock[9], status: stock[10],
    location: stock[14] || '', productId: stock[17] || '', supplierId: stock[18] || '' };
  return {
    batch: batch,
    whereFrom: { vsd: (function () { try { return _mvForBatch_(batchId).map(function (v) { return { id: v.id, number: v.number, uuid: v.uuid, status: v.status, statusRu: v.statusRu, cancelledAt: v.cancelledAt, cancelledBy: v.cancelledBy, supplier: v.supplier, invoice: v.invoice, qty: v.qty, unit: v.unit }; }); } catch (e) { return []; } })(),
      suppliersDocs: pick(rev.concat(fwd), 'SUPPLIER_DOCUMENT'), originalLabels: pick(rev, 'ORIGINAL_LABEL'), receiptPhotos: pick(rev, 'RECEIPT_PHOTO'), parentBatches: pick(rev, 'BATCH'), productions: pick(rev, 'PRODUCTION') },
    movements: fwd.filter(function (x) { return x.depth === 1 && x.nextType === 'LOCATION'; }).map(function (x) { return { location: x.nextId, relation: x.link.relation, at: x.link.dateTime, actor: x.link.actor }; }),
    openings: pick(fwd, 'OPENING'), uses: pick(fwd, 'USE'), wastes: pick(fwd, 'WASTE'), returns: pick(fwd, 'SUPPLIER'),
    storedAt: batch && batch.location ? batch.location : '',
    usedIn: { productions: pick(fwd, 'PRODUCTION'), producedBatches: pick(fwd, 'BATCH'), ttk: pick(fwd, 'TTK') },
    ccp: pick(fwd, 'CCP').concat(pick(rev, 'CCP')), samples: pick(fwd, 'DAILY_SAMPLE'),
    shipped: { banquets: pick(fwd, 'BANQUET'), sales: pick(fwd, 'SALE') },
    edges: { forward: fwd.length, reverse: rev.length }
  };
}

function getBatchTraceability(batchId, token) {
  try { _requireAuth_(token, 'journals'); if (!batchId) return coreErr('BATCH_REQUIRED', 'Укажите партию'); return coreOk(_mcTraceSummary_(String(batchId))); }
  catch (e) { return coreErr('TRACE_BATCH_ERROR', String(e)); }
}
function getReverseTraceability(batchId, token) { return getReverseTrace(batchId, token); }
function getProductionChain(productionId, token) { return getProductionTrace(productionId, token); }

function getRawMaterialTraceability(product, token) {
  try {
    _requireAuth_(token, 'journals');
    var key = _prodKey_(product || ''); if (!key) return coreErr('PRODUCT_REQUIRED', 'Укажите продукт');
    var v = _stockBatchesSheet_().getDataRange().getValues(), out = [];
    for (var i = v.length - 1; i >= 1 && out.length < 30; i--) if (v[i][0] && _prodKey_(v[i][1]) === key) out.push(_mcTraceSummary_(String(v[i][0])));
    return coreOk({ product: product, batches: out });
  } catch (e) { return coreErr('TRACE_RAW_ERROR', String(e)); }
}

function getDishTraceability(code, token) {
  try {
    _requireAuth_(token, 'journals');
    var idx = _buildDishIndexes_(), d = idx.dishByCode[code] || _findSubDish_(String(code || ''), idx.dishByNormName, idx.dishByLooseName);
    if (!d) return coreErr('DISH_NOT_FOUND', 'Блюдо не найдено');
    var pv = _productionSheet_().getDataRange().getValues(), out = [];
    for (var i = pv.length - 1; i >= 1 && out.length < 20; i--) {
      if (String(pv[i][PROD_COL_.code]) !== String(d.code)) continue;
      var o = _prodRowToObj_(pv[i]), chain = [];
      try { chain = _mcTraceGraph_('PRODUCTION', o.id, 'reverse', 6).filter(function (x) { return x.nextType === 'BATCH'; }).map(function (x) { return { batchId: x.nextId, relation: x.link.relation, qty: x.link.weight, unit: x.link.unit }; }); } catch (e) {}
      // обратная прослеживаемость до ветеринарного документа: сырьё → ВСД → поставщик → накладная
      chain.forEach(function (c) { try { c.vsd = _mvForBatch_(c.batchId).map(function (v) { return { number: v.number, uuid: v.uuid, status: v.statusRu, supplier: v.supplier, invoice: v.invoice, cancelledAt: v.cancelledAt }; }); } catch (e) { c.vsd = []; } });
      out.push({ productionId: o.id, status: o.status, start: o.start, finish: o.finish, employee: o.employee, ttkVersion: o.ttk_version, batch: o.batch, rawBatches: chain });
    }
    return coreOk({ code: d.code, name: d.name, productions: out });
  } catch (e) { return coreErr('TRACE_DISH_ERROR', String(e)); }
}
