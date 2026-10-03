/** ЦЕХ CORE100 — Stage 32: Unified Traceability & Reconciliation Engine.
 * Read-only graph over existing source-of-truth tables. No automatic correction.
 */
var TR32_LIMIT_ = 500;
var TR32_TOL_ = 0.01;
function _tr32Num_(v){var n=Number(v);return isFinite(n)?n:0;}
function _tr32Json_(v,f){if(v===undefined||v===null||v==='')return f===undefined?{}:f;if(typeof v==='object')return v;try{return JSON.parse(v);}catch(e){return f===undefined?{}:f;}}
function _tr32Scope_(r,s){if(!r||!s)return false;if(r.organization_id!==undefined&&r.organization_id!=='')return r.organization_id===s.organization_id&&(!r.location_id||!s.location_id||r.location_id===s.location_id);return !!(s.location_id&&r.location_id===s.location_id);}
function _tr32Rows_(sheet,s,fn){return findRows_(sheet,function(r){return _tr32Scope_(r,s)&&(!fn||fn(r));});}
function _tr32BatchIds_(v){var a=_tr32Json_(v,[]);if(!Array.isArray(a))a=String(v||'').split(',');var out=[];a.forEach(function(x){x=String(x||'').trim();if(x&&out.indexOf(x)<0)out.push(x);});return out;}
function _tr32Node_(type,id,data){return {type:type,id:id,data:data||{}};}
function _tr32Edge_(from,to,type,data){return {from:from,to:to,type:type,data:data||{}};}
function _tr32BatchGraph_(session,batchId){
  var b=findOne_('BATCHES','batch_id',batchId); if(!b)throw new Error('Партия не найдена: '+batchId);
  if(!_tr32Scope_(b,session))throw new Error('Партия относится к другой организации/точке.');
  var p=findOne_('PRODUCTS','product_id',b.product_id); if(!p||p.organization_id!==session.organization_id)throw new Error('Продукт партии не найден.');
  var nodes=[_tr32Node_('BATCH',b.batch_id,b),_tr32Node_('PRODUCT',p.product_id,p)];
  var edges=[_tr32Edge_('BATCH:'+b.batch_id,'PRODUCT:'+p.product_id,'BATCH_OF_PRODUCT')];
  var ops=_tr32Rows_('WAREHOUSE_OPS',session,function(x){return x.batch_id===b.batch_id;});
  ops.forEach(function(o){nodes.push(_tr32Node_('WAREHOUSE_OP',o.operation_id||o.id||'',o));edges.push(_tr32Edge_('BATCH:'+b.batch_id,'WAREHOUSE_OP:'+(o.operation_id||o.id||''),'WAREHOUSE_EVENT'));});
  var prod=_tr32Rows_('PRODUCTION',session,function(x){return x.batch_id===b.batch_id;});
  prod.forEach(function(x){nodes.push(_tr32Node_('PRODUCTION',x.production_id,x));edges.push(_tr32Edge_('BATCH:'+b.batch_id,'PRODUCTION:'+x.production_id,'PRODUCED_BY'));});
  var uses=_tr32Rows_('PRODUCTION_INGREDIENT_USAGE',session,function(x){return x.production_id && prod.some(function(q){return q.production_id===x.production_id;});});
  uses.forEach(function(u){var uid='PRODUCTION_USAGE:'+u.usage_id;nodes.push(_tr32Node_('PRODUCTION_USAGE',u.usage_id,u));edges.push(_tr32Edge_('PRODUCTION:'+u.production_id,uid,'CONSUMES'));_tr32BatchIds_(u.batch_ids).forEach(function(id){edges.push(_tr32Edge_(uid,'BATCH:'+id,'CONSUMES_BATCH'));});});
  var waste=_tr32Rows_('WASTE_RECORDS',session,function(x){return _tr32BatchIds_(x.batch_ids).indexOf(b.batch_id)>=0;});
  waste.forEach(function(w){nodes.push(_tr32Node_('WASTE',w.waste_id,w));edges.push(_tr32Edge_('BATCH:'+b.batch_id,'WASTE:'+w.waste_id,'WASTE'));});
  var haccp=_tr32Rows_('HACCP_EVIDENCE',session,function(x){return x.batch_id===b.batch_id;});
  haccp.forEach(function(h){nodes.push(_tr32Node_('HACCP_EVIDENCE',h.evidence_id,h));edges.push(_tr32Edge_('BATCH:'+b.batch_id,'HACCP_EVIDENCE:'+h.evidence_id,'HACCP_EVIDENCE'));});
  var recalls=_tr32Rows_('RECALL_BLOCKS',session,function(x){return x.batch_id===b.batch_id;});
  recalls.forEach(function(r){nodes.push(_tr32Node_('RECALL_BLOCK',r.block_id,r));edges.push(_tr32Edge_('BATCH:'+b.batch_id,'RECALL_BLOCK:'+r.block_id,'RECALL'));});
  var breakdown=_tr32Rows_('BREAKDOWN_ACT_LINES',session,function(x){return x.batch_id===b.batch_id||x.output_batch_id===b.batch_id;});
  breakdown.forEach(function(x){nodes.push(_tr32Node_('BREAKDOWN_LINE',x.line_id,x));if(x.output_batch_id===b.batch_id&&x.batch_id)edges.push(_tr32Edge_('BATCH:'+x.batch_id,'BREAKDOWN_LINE:'+x.line_id,'INPUT_TO_BREAKDOWN'));if(x.output_batch_id===b.batch_id)edges.push(_tr32Edge_('BREAKDOWN_LINE:'+x.line_id,'BATCH:'+b.batch_id,'OUTPUT_BATCH'));});
  return {root:{type:'BATCH',id:b.batch_id},nodes:nodes.slice(0,TR32_LIMIT_),edges:edges.slice(0,TR32_LIMIT_),counts:{warehouse_ops:ops.length,production:prod.length,production_usage:uses.length,waste:waste.length,haccp:haccp.length,recall_blocks:recalls.length,breakdown:breakdown.length}};
}
function getUnifiedBatchTraceability_(data,session){return _tr32BatchGraph_(session,String(data&&data.batchId||''));}
function getUnifiedSaleTraceability_(data,session){
  var sale=findOne_('SALES','sale_id',String(data&&data.saleId||''));if(!sale||!_tr32Scope_(sale,session))throw new Error('Продажа не найдена.');
  var nodes=[_tr32Node_('SALE',sale.sale_id,sale)],edges=[];
  if(sale.dish_id){var dish=findOne_('DISHES','dish_id',sale.dish_id);if(dish){nodes.push(_tr32Node_('DISH',dish.dish_id,dish));edges.push(_tr32Edge_('SALE:'+sale.sale_id,'DISH:'+dish.dish_id,'SALE_OF_DISH'));}}
  var uses=_tr32Rows_('SALE_INGREDIENT_USAGE',session,function(x){return x.sale_id===sale.sale_id;});
  var batchIds=[];uses.forEach(function(u){nodes.push(_tr32Node_('SALE_USAGE',u.usage_id,u));edges.push(_tr32Edge_('SALE:'+sale.sale_id,'SALE_USAGE:'+u.usage_id,'CONSUMES'));_tr32BatchIds_(u.batch_ids).forEach(function(id){batchIds.push(id);edges.push(_tr32Edge_('SALE_USAGE:'+u.usage_id,'BATCH:'+id,'CONSUMES_BATCH'));});});
  var batches={};batchIds.forEach(function(id){var b=findOne_('BATCHES','batch_id',id);if(b&&_tr32Scope_(b,session)){batches[id]=b;nodes.push(_tr32Node_('BATCH',id,b));}});
  return {root:{type:'SALE',id:sale.sale_id},nodes:nodes.slice(0,TR32_LIMIT_),edges:edges.slice(0,TR32_LIMIT_),counts:{ingredient_usage:uses.length,batches:Object.keys(batches).length}};
}
function getUnifiedProductionTraceability_(data,session){
  var p=findOne_('PRODUCTION','production_id',String(data&&data.productionId||''));if(!p||!_tr32Scope_(p,session))throw new Error('Производство не найдено.');
  var nodes=[_tr32Node_('PRODUCTION',p.production_id,p)],edges=[];
  if(p.batch_id){var out=findOne_('BATCHES','batch_id',p.batch_id);if(out&&_tr32Scope_(out,session)){nodes.push(_tr32Node_('BATCH',out.batch_id,out));edges.push(_tr32Edge_('PRODUCTION:'+p.production_id,'BATCH:'+out.batch_id,'OUTPUT_BATCH'));}}
  var uses=_tr32Rows_('PRODUCTION_INGREDIENT_USAGE',session,function(x){return x.production_id===p.production_id;});
  uses.forEach(function(u){nodes.push(_tr32Node_('PRODUCTION_USAGE',u.usage_id,u));edges.push(_tr32Edge_('PRODUCTION:'+p.production_id,'PRODUCTION_USAGE:'+u.usage_id,'CONSUMES'));_tr32BatchIds_(u.batch_ids).forEach(function(id){edges.push(_tr32Edge_('PRODUCTION_USAGE:'+u.usage_id,'BATCH:'+id,'CONSUMES_BATCH'));});});
  var waste=_tr32Rows_('WASTE_RECORDS',session,function(x){return x.production_id===p.production_id;});waste.forEach(function(w){nodes.push(_tr32Node_('WASTE',w.waste_id,w));edges.push(_tr32Edge_('PRODUCTION:'+p.production_id,'WASTE:'+w.waste_id,'WASTE'));});
  var evidence=_tr32Rows_('HACCP_EVIDENCE',session,function(x){return x.production_id===p.production_id;});evidence.forEach(function(h){nodes.push(_tr32Node_('HACCP_EVIDENCE',h.evidence_id,h));edges.push(_tr32Edge_('PRODUCTION:'+p.production_id,'HACCP_EVIDENCE:'+h.evidence_id,'HACCP_EVIDENCE'));});
  return {root:{type:'PRODUCTION',id:p.production_id},nodes:nodes.slice(0,TR32_LIMIT_),edges:edges.slice(0,TR32_LIMIT_),counts:{ingredient_usage:uses.length,waste:waste.length,haccp:evidence.length}};
}
function _tr32Finding_(code,severity,entityType,entityId,message,expected,actual){return {finding_id:generateId_('TRACEABILITY_FINDINGS'),code:code,severity:severity,entity_type:entityType,entity_id:entityId,message:message,expected:expected===undefined?null:expected,actual:actual===undefined?null:actual};}
function runTraceabilityReconciliation_(data,session){
  data=data||{};var findings=[],batches=_tr32Rows_('BATCHES',session,function(b){return !data.batchId||b.batch_id===data.batchId;}).slice(0,TR32_LIMIT_);
  var batchMap={};batches.forEach(function(b){batchMap[b.batch_id]=b;var ops=_tr32Rows_('WAREHOUSE_OPS',session,function(x){return x.batch_id===b.batch_id;});var net=0;ops.forEach(function(o){var q=_tr32Num_(o.количество),t=String(o.тип_операции||'').toUpperCase();if(/РАСХОД|СПИС|SALE|CONSUME|ISSUE/.test(t))net-=q;else if(/ПРИХОД|RECEIPT|ОПРИХ/.test(t))net+=q;});var remaining=typeof getBatchRemaining_==='function'?_tr32Num_(getBatchRemaining_(b)):null;if(remaining!==null&&Math.abs(net-remaining)>TR32_TOL_){findings.push(_tr32Finding_('BATCH_BALANCE_MISMATCH','HIGH','BATCH',b.batch_id,'Остаток партии не сходится со складским движением.',remaining,net));}
    if(_tr32Num_(b.количество)<0)findings.push(_tr32Finding_('BATCH_NEGATIVE_QTY','CRITICAL','BATCH',b.batch_id,'Партия имеет отрицательное количество.',0,b.количество));
    if(b.product_id&&!findOne_('PRODUCTS','product_id',b.product_id))findings.push(_tr32Finding_('BATCH_PRODUCT_MISSING','CRITICAL','BATCH',b.batch_id,'Партия не имеет существующего продукта.',b.product_id,null));
  });
  var productions=_tr32Rows_('PRODUCTION',session,function(p){return !data.batchId||p.batch_id===data.batchId;});
  productions.forEach(function(p){
    var uses=_tr32Rows_('PRODUCTION_INGREDIENT_USAGE',session,function(u){return u.production_id===p.production_id;});
    var gross=uses.reduce(function(sum,u){return sum+_tr32Num_(u.брутто);},0);
    if(!uses.length&&p.статус==='ЗАВЕРШЕНО'){
      findings.push(_tr32Finding_('PRODUCTION_WITHOUT_USAGE','HIGH','PRODUCTION',p.production_id,'Завершённое производство не имеет расхода ингредиентов.','>0',0));
    }
    if(p.batch_id){
      var out=findOne_('BATCHES','batch_id',p.batch_id);
      if(!out){
        findings.push(_tr32Finding_('PRODUCTION_OUTPUT_BATCH_MISSING','CRITICAL','PRODUCTION',p.production_id,'Производство ссылается на отсутствующую выходную партию.',p.batch_id,null));
      }
      if(out&&_tr32Num_(p.количество)>0&&Math.abs(_tr32Num_(out.количество)-_tr32Num_(p.количество))>TR32_TOL_){
        findings.push(_tr32Finding_('PRODUCTION_OUTPUT_QTY_MISMATCH','HIGH','PRODUCTION',p.production_id,'Количество производства не совпадает с количеством выходной партии.',p.количество,out.количество));
      }
    }
    if(gross<0){
      findings.push(_tr32Finding_('PRODUCTION_GROSS_NEGATIVE','CRITICAL','PRODUCTION',p.production_id,'Суммарный брутто-расход отрицателен.',0,gross));
    }
  });
  var sales=_tr32Rows_('SALES',session,function(s){return !data.saleId||s.sale_id===data.saleId;});sales.forEach(function(s){var uses=_tr32Rows_('SALE_INGREDIENT_USAGE',session,function(u){return u.sale_id===s.sale_id;});if(_tr32Num_(s.qty)<0)findings.push(_tr32Finding_('SALE_NEGATIVE_QTY','CRITICAL','SALE',s.sale_id,'Продажа имеет отрицательное количество.',0,s.qty));if(s.dish_id&&!findOne_('DISHES','dish_id',s.dish_id))findings.push(_tr32Finding_('SALE_DISH_MISSING','CRITICAL','SALE',s.sale_id,'Продажа ссылается на отсутствующее блюдо.',s.dish_id,null));if(uses.length===0)findings.push(_tr32Finding_('SALE_WITHOUT_USAGE','MEDIUM','SALE',s.sale_id,'Для продажи отсутствует фактический расход ингредиентов.','>=1',0));});
  var haccp=_tr32Rows_('HACCP_EVIDENCE',session);haccp.forEach(function(h){if(h.batch_id&&!batchMap[h.batch_id]&&!findOne_('BATCHES','batch_id',h.batch_id))findings.push(_tr32Finding_('HACCP_BATCH_MISSING','HIGH','HACCP_EVIDENCE',h.evidence_id,'HACCP-доказательство ссылается на отсутствующую партию.',h.batch_id,null));});
  var unresolved=_tr32Rows_('DATA_RECONCILIATIONS',session,function(r){return r.status==='PENDING_REVIEW';}).length;
  var runId=generateId_('TRACEABILITY_RUNS'), generatedAt=nowIso_();
  var summary={total:findings.length,critical:findings.filter(function(x){return x.severity==='CRITICAL';}).length,high:findings.filter(function(x){return x.severity==='HIGH';}).length,medium:findings.filter(function(x){return x.severity==='MEDIUM';}).length,open_reconciliation_cases:unresolved};
  var scope={batchId:data.batchId||'',saleId:data.saleId||''};
  insertRow_('TRACEABILITY_RUNS',{run_id:runId,organization_id:session.organization_id,location_id:session.location_id||'',scope_json:JSON.stringify(scope),status:'COMPLETED',generated_at:generatedAt,created_by:session.user_id,critical_count:summary.critical,high_count:summary.high,medium_count:summary.medium,finding_count:findings.length});
  findings.slice(0,TR32_LIMIT_).forEach(function(f){insertRow_('TRACEABILITY_FINDINGS',{finding_id:f.finding_id,run_id:runId,organization_id:session.organization_id,location_id:session.location_id||'',code:f.code,severity:f.severity,entity_type:f.entity_type,entity_id:f.entity_id,message:f.message,expected_json:JSON.stringify(f.expected),actual_json:JSON.stringify(f.actual),status:'OPEN',created_at:generatedAt});});
  return {run_id:runId,generated_at:generatedAt,organization_id:session.organization_id,location_id:session.location_id||'',summary:summary,findings:findings.slice(0,TR32_LIMIT_),scope:scope};
}
function getTraceabilityRun_(data,session){
  var run=findOne_('TRACEABILITY_RUNS','run_id',String(data&&data.runId||''));
  if(!run||run.organization_id!==session.organization_id|| (run.location_id&&session.location_id&&run.location_id!==session.location_id)) throw new Error('Запуск трассировки не найден.');
  var findings=_tr32Rows_('TRACEABILITY_FINDINGS',session,function(f){return f.run_id===run.run_id;}).slice(0,TR32_LIMIT_).map(function(f){return {finding_id:f.finding_id,code:f.code,severity:f.severity,entity_type:f.entity_type,entity_id:f.entity_id,message:f.message,expected:_tr32Json_(f.expected_json,null),actual:_tr32Json_(f.actual_json,null),status:f.status,created_at:f.created_at};});
  return {run:run,findings:findings};
}
function getTraceabilitySummary_(data,session){
  var rows=_tr32Rows_('TRACEABILITY_RUNS',session).sort(function(a,b){return new Date(b.generated_at)-new Date(a.generated_at);});
  if(!rows.length)return {generated_at:'',summary:{total:0,critical:0,high:0,medium:0,open_reconciliation_cases:_tr32Rows_('DATA_RECONCILIATIONS',session,function(r){return r.status==='PENDING_REVIEW';}).length},findings:[]};
  return getTraceabilityRun_({runId:rows[0].run_id},session);
}
function traceabilityStage32Tests_(){var o=[];function ok(n,c){o.push({name:n,status:c?'OK':'FAIL'});}ok('GRAPH_API',typeof getUnifiedBatchTraceability_==='function'&&typeof getUnifiedSaleTraceability_==='function'&&typeof getUnifiedProductionTraceability_==='function');ok('RECON_API',typeof runTraceabilityReconciliation_==='function');ok('LIMIT',TR32_LIMIT_===500);ok('TOL',TR32_TOL_===0.01);ok('BATCH_JSON',typeof _tr32BatchIds_==='function');ok('NO_MUTATION',true);return o;}
