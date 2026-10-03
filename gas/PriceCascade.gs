// ЦЕХ — PriceCascade.gs
// Коммерческий ценовой каскад: история цен, плановая цена, фактическая стоимость и трассировка.

function _assertNonNegativePrice_(price, fieldName) {
  var n = Number(price);
  if (!isFinite(n) || n < 0) throw new Error((fieldName || 'Цена') + ' должна быть числом не меньше нуля.');
  return round2_(n);
}

function recordPriceHistory_(data) {
  var row = {
    price_history_id: generateId_('PRICE_HISTORY'),
    organization_id: data.organization_id || '', product_id: data.product_id || '',
    price_type: data.price_type || 'CURRENT', old_price: Number(data.old_price || 0),
    new_price: Number(data.new_price || 0), source: data.source || 'MANUAL',
    batch_id: data.batch_id || '', supplier_id: data.supplier_id || '',
    effective_at: data.effective_at || nowIso_(), user_id: data.user_id || '',
    cascade_id: data.cascade_id || '', reason: data.reason || '',
    metadata_json: JSON.stringify(data.metadata || {})
  };
  insertRow_('PRICE_HISTORY', row);
  return row;
}

function getPriceHistory_(productId, session, limit) {
  var p = getProductById_(productId);
  if (!p) throw new Error('Продукт не найден: ' + productId);
  if (session) assertOwnedByOrg_(session, p, 'PRODUCTS:' + productId);
  var rows = findRows_('PRICE_HISTORY', function(r){ return r.product_id === productId && r.organization_id === p.organization_id; });
  rows.sort(function(a,b){ return String(b.effective_at).localeCompare(String(a.effective_at)); });
  return rows.slice(0, Math.max(1, Number(limit) || 100));
}

function getPriceCascade_(productId, session) {
  var p = getProductById_(productId);
  if (!p) throw new Error('Продукт не найден: ' + productId);
  if (session) assertOwnedByOrg_(session, p, 'PRODUCTS:' + productId);
  var parents = findParentsUsingIngredient_(productId);
  var affected = [];
  parents.forEach(function(parent){
    affected = affected.concat(recalcParentCost_(parent.type, parent.id, {}, 0));
  });
  return {
    product_id: productId,
    product_name: p.название,
    current_price: Number(p.текущая_цена || 0),
    parents: affected,
    generated_at: nowIso_()
  };
}
