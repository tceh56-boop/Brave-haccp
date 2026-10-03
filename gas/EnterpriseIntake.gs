/**
 * ЦЕХ — единое действие "Сканировать накладную".
 * Сквозной оркестратор: документ -> OCR -> строки -> сопоставление -> HACCP/ППК -> приёмка -> партия -> цена -> FoodCost -> аудит.
 * Реальный OCR подключается через runSupplierInvoiceOcr_. Для тестов доступен dryRun.
 */
var INVOICE_INTAKE_STATUS = { DRAFT:'DRAFT', READY:'READY', BLOCKED:'BLOCKED', POSTED:'POSTED', PARTIAL:'PARTIAL' };

function scanAndReceiveInvoice_(data, session) {
  data = data || {};
  // Stage 11: SCAN_AND_RECEIVE_INVOICE is now preview-only. Real posting requires CONFIRM_INVOICE_RECEIPT.
  if (!data.dryRun) return createInvoiceIntakeDraft_(data, session);
  if (!session || !session.organization_id || !session.location_id) throw new Error('Не удалось определить организацию и точку приёмки.');
  if (!data.base64Image && !data.mockInvoice) throw new Error('Загрузите фото или PDF накладной.');

  var cascadeId = session.cascade_id || '';
  var result = { status:'', cascade_id:cascadeId, document:null, lines:[], haccp:null, receipt:null, price:null, warnings:[], errors:[] };
  var invoice = data.mockInvoice || runSupplierInvoiceOcr_(data.base64Image, data.mimeType || 'image/jpeg', session);
  result.document = invoice.document || {};
  var lines = invoice.lines || [];
  if (!lines.length) throw new Error('В накладной не найдены товарные строки.');

  lines.forEach(function(line, idx) {
    try {
      var match = matchInvoiceLineToProduct_(line, session);
      line.line_no = line.line_no || idx + 1;
      line.match = match;
      if (!match.product_id) {
        result.errors.push({line:line.line_no, error:'Товар не найден однозначно', candidates:match.candidates || []});
        return;
      }
      var h = evaluateHaccpReceiptGate_(match.product_id, session.location_id, line, session);
      line.haccp = h;
      if (h.blocked) {
        result.errors.push({line:line.line_no, error:'Приёмка заблокирована ХАССП/ППК', reasons:h.reasons});
        return;
      }
      result.lines.push(line);
      (h.warnings || []).forEach(function(w){ result.warnings.push({line:line.line_no, warning:w}); });
    } catch (e) {
      result.errors.push({line:line.line_no || idx + 1, error:String(e && e.message || e)});
    }
  });

  if (data.dryRun) {
    result.status = result.errors.length ? (result.lines.length ? INVOICE_INTAKE_STATUS.PARTIAL : INVOICE_INTAKE_STATUS.BLOCKED) : INVOICE_INTAKE_STATUS.READY;
    result.preview = buildInvoicePostingPreview_(result.lines, session);
    return result;
  }

  if (result.errors.length && !data.allowPartial) {
    result.status = INVOICE_INTAKE_STATUS.BLOCKED;
    throw new Error('Накладная не проведена: ' + result.errors.map(function(e){return 'строка '+e.line+': '+e.error;}).join('; '));
  }
  if (!result.lines.length) throw new Error('Нет строк, которые можно безопасно принять.');

  var posted = receiveGoodsBatch_(result.lines.map(function(line){
    return { productId:line.match.product_id, qty:Number(line.qty), price:Number(line.price), expiryDate:line.expiryDate || '', productionDate:line.productionDate || '', docRefs:{supplierId:invoice.document.supplier_id || '', declarationId:line.declarationId || '', certificateId:line.certificateId || '', veterinaryDocumentId:line.veterinaryDocumentId || ''} };
  }), session.location_id, session.user_id, session);

  result.receipt = posted;
  result.price = recalcInvoicePriceCascade_(result.lines, session);
  result.status = posted.ошибок ? INVOICE_INTAKE_STATUS.PARTIAL : INVOICE_INTAKE_STATUS.POSTED;
  auditLog_(session.user_id, 'Сквозная приёмка накладной', 'INVOICE_INTAKE:' + (invoice.document.invoice_id || result.cascade_id), null, JSON.stringify({status:result.status, lines:result.lines.length}), 'success', session.cascade_id || '');
  return result;
}

function matchInvoiceLineToProduct_(line, session) {
  var product = null, candidates = [];
  if (line.barcode) product = findProductByBarcode_(session.organization_id, String(line.barcode));
  if (!product && line.article) {
    var article = String(line.article).toLowerCase();
    candidates = getProducts_(session.organization_id).filter(function(p){ return String(p.штрихкод || '').toLowerCase() === article || String(p.артикул || '').toLowerCase() === article; });
    if (candidates.length === 1) product = candidates[0];
  }
  if (!product && line.name) {
    var n = normalizeProductName_(line.name);
    candidates = candidates.concat(getProducts_(session.organization_id).filter(function(p){ return normalizeProductName_(p.название) === n; }));
    if (candidates.length === 1) product = candidates[0];
  }
  return {product_id:product ? product.product_id : '', product:product || null, candidates:candidates.slice(0,10)};
}

function evaluateHaccpReceiptGate_(productId, locationId, line, session) {
  var out = {blocked:false,warnings:[],reasons:[],controls:[]};
  var product = getProductById_(productId);
  if (!product) { out.blocked=true; out.reasons.push('Продукт не найден'); return out; }
  if (line.expiryDate && String(line.expiryDate) < new Date().toISOString().slice(0,10)) { out.blocked=true; out.reasons.push('Срок годности партии истёк'); }
  if (!line.productionDate) out.warnings.push('Не распознана дата производства — требуется ручная проверка партии.');
  if (!line.expiryDate) out.warnings.push('Не распознан срок годности — требуется ручная проверка партии.');
  if (typeof getPpkReceiptControls_ === 'function') {
    var controls = getPpkReceiptControls_(session.organization_id, locationId, productId);
    out.controls = controls;
    controls.forEach(function(c){ if(c.blocked) { out.blocked=true; out.reasons.push(c.reason); } else if(c.warning) out.warnings.push(c.warning); });
  }
  return out;
}

function buildInvoicePostingPreview_(lines, session) {
  return lines.map(function(l){ return {line_no:l.line_no, product_id:l.match.product_id, name:l.name, qty:Number(l.qty), price:Number(l.price), amount:round2_(Number(l.qty)*Number(l.price)), productionDate:l.productionDate||'', expiryDate:l.expiryDate||'', haccp:l.haccp}; });
}

function recalcInvoicePriceCascade_(lines, session) {
  var affected = {};
  lines.forEach(function(l){ if(l.match && l.match.product_id) affected[l.match.product_id] = true; });
  var products = Object.keys(affected).map(function(id){
    var p = getProductById_(id); if (!p) return null;
    var stock = getStockLevel_(id, session.location_id);
    var avg = _getCurrentProductAveragePrice_(p);
    if (avg !== null && !isNaN(avg)) updateRow_('PRODUCTS', p, {текущая_цена:avg, обновлено:nowIso_()});
    var fc = recalcFoodCostForProduct_(id);
    return {product_id:id, stock:stock, weighted_avg_price:avg, food_cost:fc};
  }).filter(Boolean);
  return products;
}

function _getCurrentProductAveragePrice_(product){ var v=Number(product.текущая_цена); return isFinite(v)?round2_(v):null; }
