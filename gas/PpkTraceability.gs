/** Traceability read model over existing BATCHES/WAREHOUSE_OPS/PRODUCTION. */
function getPpkTraceabilityByProduct_(session,data){
  var c=_ppkCtx_(session,data.locationId), product=assertOwnedByOrg_(session,getProductById_(data.productId),'PRODUCTS:'+data.productId);
  var batches=findRows_('BATCHES',function(b){return b.product_id===product.product_id&&b.location_id===c.locationId;});
  return batches.map(function(b){return getPpkTraceability_(session,{locationId:c.locationId,batchId:b.batch_id});});
}
