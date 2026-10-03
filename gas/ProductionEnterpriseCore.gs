/**
 * ЦЕХ — ProductionEnterpriseCore.gs
 * Единый операционный контур: диспетчер производства, фактический выход,
 * полуфабрикаты, recall, HACCP-доказательства, фактическая себестоимость,
 * планирование, цифровой паспорт batch и инспекционный пакет ППК.
 *
 * Важный принцип: нормативы задаются в ТТК/картах разбора/ППК, а фактические
 * значения вводятся ответственным сотрудником и сохраняются как evidence.
 */

var PE_STATUSES = ['ПЛАН','В_РАБОТЕ','ГОТОВО','ОТКЛОНЕНИЕ','ОТМЕНЁН'];

function _peOrg_(session){ return session.organization_id; }
function _peRows_(table,p){ return findRows_(table,p||function(){return true;}); }
function _peOwned_(session,row,ref){ if(!row) throw new Error('Объект не найден: '+ref); assertOwnedByOrg_(session,row,ref); return row; }
function _peNum_(v,d){ var n=Number(v); return isNaN(n)?(d||0):n; }

/* ---------- 1. ДИСПЕТЧЕР ПРОИЗВОДСТВА ---------- */
function getProductionDispatcher_(session,data){
  var loc=data&&data.locationId||session.location_id;
  var tasks=_peRows_('PRODUCTION',function(r){return r.location_id===loc && (!data.status||r.статус===data.status);});
  var breakdown=_peRows_('BREAKDOWN_TASKS',function(r){return r.location_id===loc && (!data.status||r.статус===data.status);});
  var due=[];
  tasks.forEach(function(t){ due.push({type:'PRODUCTION',id:t.production_id,title:'Производство '+t.parent_id,status:t.статус,qty:_peNum_(t.количество),workshop_id:t.workshop_id,cascade_id:t.cascade_id||''}); });
  breakdown.forEach(function(t){ due.push({type:'BREAKDOWN',id:t.task_id,title:t.task_title||t.название,status:t.статус,qty:_peNum_(t.planned_qty),workshop_id:t.workshop_id,cascade_id:t.cascade_id||'',act_id:t.act_id}); });
  var counts={}; due.forEach(function(x){counts[x.status]=(counts[x.status]||0)+1;});
  return {location_id:loc,generated_at:nowIso_(),counts:counts,tasks:due,queue:due.filter(function(x){return x.status!=='ГОТОВО'&&x.status!=='ОТМЕНЁН';})};
}

function dispatchProductionTask_(data,session){
  var t=findOne_('PRODUCTION','production_id',data.productionId); _peOwned_(session,t,'PRODUCTION:'+data.productionId);
  if(['план','в_работе'].indexOf(t.статус)<0) throw new Error('Задачу можно назначить только до завершения.');
  updateRow_('PRODUCTION',t,{workshop_id:data.workshopId||t.workshop_id||'',user_id:data.userId||t.user_id||''});
  auditLog_(session.user_id,'Задача производства назначена','PRODUCTION:'+t.production_id,t.workshop_id+' / '+t.user_id,(data.workshopId||'')+' / '+(data.userId||''),'success',session.cascade_id||'');
  return findOne_('PRODUCTION','production_id',t.production_id);
}

/* ---------- 2. ФАКТИЧЕСКИЙ ВЫХОД И ОТКЛОНЕНИЯ ---------- */
function recordProductionYieldDeviation_(data,session){
  var production=findOne_('PRODUCTION','production_id',data.productionId); _peOwned_(session,production,'PRODUCTION:'+data.productionId);
  var planned=_peNum_(data.plannedQty); var actual=_peNum_(data.actualQty);
  if(planned<=0||actual<0) throw new Error('Некорректный план/факт выхода.');
  var deviation=round2_(actual-planned); var pct=planned?round2_(deviation/planned*100):0;
  var warning=_peNum_(_policy29Value_('production','yield_deviation_warning_pct',session),5);
  var critical=_peNum_(_policy29Value_('production','yield_deviation_critical_pct',session),10);
  var threshold=data.thresholdPct!==undefined?_peNum_(data.thresholdPct):warning;
  var level=Math.abs(pct)>=critical?'КРИТИЧЕСКОЕ':(Math.abs(pct)>=threshold?'ПРЕДУПРЕЖДЕНИЕ':'НОРМА');
  var row={deviation_id:generateId_('PRODUCTION_YIELD_DEVIATIONS'),organization_id:session.organization_id,location_id:production.location_id,production_id:production.production_id,act_id:data.actId||'',stage_id:data.stageId||'',product_id:data.productId||'',planned_qty:planned,actual_qty:actual,deviation_qty:deviation,deviation_pct:pct,threshold_pct:threshold,level:level,reason:data.reason||'',corrective_action_id:'',status:level==='НОРМА'?'CLOSED':'OPEN',created_at:nowIso_(),created_by:session.user_id,cascade_id:session.cascade_id||''};
  insertRow_('PRODUCTION_YIELD_DEVIATIONS',row);
  if(level!=='НОРМА'){
    var action={action_id:generateId_('CORRECTIVE_ACTIONS'),deviation_id:'',pending_id:'',описание:'Отклонение выхода производства '+production.production_id+': план '+planned+', факт '+actual+', отклонение '+pct+'%. Причина: '+(data.reason||'не указана'),source_document:'Внутренняя процедура контроля выхода',ответственный_роль:data.responsibleRole||'ШЕФ-ПОВАР',ответственный_id:data.responsibleId||'',статус:'ожидание',результат:'',дата:nowIso_()};
    insertRow_('CORRECTIVE_ACTIONS',action);
    updateRow_('PRODUCTION_YIELD_DEVIATIONS',findOne_('PRODUCTION_YIELD_DEVIATIONS','deviation_id',row.deviation_id),{corrective_action_id:action.action_id});
    try{_createTaskForCorrectiveAction_(session.organization_id,production.location_id,action.action_id,'Отклонение выхода: '+production.production_id,action.описание,action.ответственный_роль,session.user_id);}catch(e){}
  }
  return findOne_('PRODUCTION_YIELD_DEVIATIONS','deviation_id',row.deviation_id);
}

function getProductionYieldDeviations_(session,data){
  return _peRows_('PRODUCTION_YIELD_DEVIATIONS',function(r){return r.organization_id===session.organization_id && (!data||!data.locationId||r.location_id===data.locationId) && (!data||!data.status||r.status===data.status);});
}

/* ---------- 3. ПОЛУФАБРИКАТЫ ---------- */
function getSemiFinishedPassport_(session,data){
  var pf=getSemiFinishedById_(data.pfId); _peOwned_(session,pf,'SEMI_FINISHED:'+data.pfId);
  var batches=_peRows_('BATCHES',function(b){return b.product_id===data.pfId && b.location_id===session.location_id;});
  var recipes=_peRows_('RECIPES',function(r){return r.parent_id===data.pfId;});
  var breakdownLines=_peRows_('BREAKDOWN_ACT_LINES',function(l){return l.output_id===data.pfId;});
  return {semi_finished:pf,batches:batches.map(function(b){return {batch:b,remaining:getBatchRemaining_(b)};}),recipe:recipes,origins:breakdownLines};
}

/* ---------- 4. RECALL / БЛОКИРОВКА ---------- */
function createRecallCase_(data,session){
  return withLock_(function(){
    if(!data.batchId && !data.productId) throw new Error('Укажите batchId или productId.');
    var batch=data.batchId?findOne_('BATCHES','batch_id',data.batchId):null;
    if(batch) _peOwned_(session,findOne_('PRODUCTS','product_id',batch.product_id),'PRODUCTS:'+batch.product_id);
    var row={recall_id:generateId_('RECALL_CASES'),organization_id:session.organization_id,location_id:batch?batch.location_id:session.location_id,batch_id:batch?batch.batch_id:'',product_id:batch?batch.product_id:data.productId,reason:data.reason||'',severity:data.severity||'HIGH',status:'OPEN',opened_at:nowIso_(),opened_by:session.user_id,closed_at:'',closed_by:'',cascade_id:session.cascade_id||''};
    insertRow_('RECALL_CASES',row);
    var targets=_peRows_('BATCHES',function(b){return b.organization_id===undefined?b.product_id===row.product_id:(b.product_id===row.product_id&&(!row.batch_id||b.batch_id===row.batch_id));});
    var blocks=[];
    targets.forEach(function(b){
      if(b.статус==='ЗАБЛОКИРОВАНА') return;
      updateRow_('BATCHES',b,{статус:'ЗАБЛОКИРОВАНА'});
      var block={block_id:generateId_('RECALL_BLOCKS'),recall_id:row.recall_id,organization_id:session.organization_id,location_id:b.location_id,batch_id:b.batch_id,product_id:b.product_id,remaining_qty:getBatchRemaining_(b),reason:row.reason,status:'BLOCKED',created_at:nowIso_(),created_by:session.user_id,cascade_id:session.cascade_id||''};
      insertRow_('RECALL_BLOCKS',block); blocks.push(block);
    });
    auditLog_(session.user_id,'Партии заблокированы по recall','RECALL_CASES:'+row.recall_id,'','BLOCKED','success',session.cascade_id||'');
    return {case:row,blocks:blocks};
  });
}

function closeRecallCase_(recallId,session){
  var r=findOne_('RECALL_CASES','recall_id',recallId); _peOwned_(session,r,'RECALL_CASES:'+recallId);
  if(r.status==='CLOSED') return r;
  var blocks=_peRows_('RECALL_BLOCKS',function(b){return b.recall_id===recallId;});
  blocks.forEach(function(bl){var batch=findOne_('BATCHES','batch_id',bl.batch_id);if(batch&&batch.статус==='ЗАБЛОКИРОВАНА') updateRow_('BATCHES',batch,{статус:'активна'});updateRow_('RECALL_BLOCKS',bl,{status:'RELEASED'});});
  updateRow_('RECALL_CASES',r,{status:'CLOSED',closed_at:nowIso_(),closed_by:session.user_id});
  return findOne_('RECALL_CASES','recall_id',recallId);
}
function getRecallCase_(session,data){var r=findOne_('RECALL_CASES','recall_id',data.recallId);_peOwned_(session,r,'RECALL_CASES:'+data.recallId);return {case:r,blocks:_peRows_('RECALL_BLOCKS',function(b){return b.recall_id===r.recall_id;})};}

/* ---------- 5. АВТОМАТИЧЕСКИЕ HACCP-ДОКАЗАТЕЛЬСТВА ---------- */
function recordHaccpEvidence_(data,session){
  var ppk=typeof getCurrentPpk_==='function'?getCurrentPpk_(session.organization_id):null;
  var row={evidence_id:generateId_('HACCP_EVIDENCE'),organization_id:session.organization_id,ppk_id:data.ppkId||(ppk?ppk.ppk_id:''),control_id:data.controlId||'',journal_id:data.journalId||'',deviation_id:data.deviationId||'',batch_id:data.batchId||'',production_id:data.productionId||'',result:data.result||'PASS',evidence_json:JSON.stringify(data.evidence!==undefined?data.evidence:(data.evidenceJson!==undefined?data.evidenceJson:{})),created_at:nowIso_(),created_by:session.user_id};
  insertRow_('HACCP_EVIDENCE',row); return row;
}
function autoHaccpEvidenceForProduction_(production,session,extra){
  if(!production) return null;
  return recordHaccpEvidence_({productionId:production.production_id,batchId:production.batch_id||'',result:extra&&extra.result||'PASS',controlId:extra&&extra.controlId||'',evidence:{event:'PRODUCTION_COMPLETED',parent_type:production.parent_type,parent_id:production.parent_id,qty:production.количество,cascade_id:session.cascade_id||''}},session);
}
function autoHaccpEvidenceForBreakdown_(act,session){return recordHaccpEvidence_({batchId:act.batch_id,result:'PASS',evidence:{event:'BREAKDOWN_COMPLETED',act_id:act.act_id,input_qty:act.input_qty,thawed_qty:act.thawed_qty,trim_waste:act.trim_waste,thermal_loss:act.thermal_loss,other_waste:act.other_waste,usable_qty:act.usable_qty,cascade_id:session.cascade_id||''}},session);}
function getHaccpEvidence_(session,data){return _peRows_('HACCP_EVIDENCE',function(e){return e.organization_id===session.organization_id&&(!data||!data.batchId||e.batch_id===data.batchId)&&(!data||!data.productionId||e.production_id===data.productionId);});}

/* ---------- 6. ФАКТИЧЕСКАЯ СЕБЕСТОИМОСТЬ ПО ЦЕПОЧКЕ ---------- */
function getActualCostTrace_(session,data){
  var cost=0, nodes=[];
  if(data.saleId){
    _peRows_('SALE_INGREDIENT_USAGE',function(x){return x.sale_id===data.saleId;}).forEach(function(x){cost+=_peNum_(x.стоимость_брутто);nodes.push({type:'SALE_INGREDIENT',id:x.usage_id,cost:_peNum_(x.стоимость_брутто),product_id:x.product_id});});
  }
  if(data.productionId){
    _peRows_('PRODUCTION_INGREDIENT_USAGE',function(x){return x.production_id===data.productionId;}).forEach(function(x){cost+=_peNum_(x.стоимость_брутто);nodes.push({type:'PRODUCTION_INGREDIENT',id:x.usage_id,cost:_peNum_(x.стоимость_брутто),product_id:x.product_id});});
  }
  if(data.breakdownActId){
    _peRows_('BREAKDOWN_ACT_LINES',function(x){return x.act_id===data.breakdownActId;}).forEach(function(x){var c=_peNum_(x.amount);cost+=c;nodes.push({type:'BREAKDOWN_OUTPUT',id:x.line_id,cost:c,product_id:x.output_id});});
  }
  var sale=data.saleId?findOne_('SALES','sale_id',data.saleId):null;
  return {cost:round2_(cost),revenue:sale?_peNum_(sale.сумма):0,food_cost:sale&&_peNum_(sale.сумма)>0?round2_(cost/_peNum_(sale.сумма)*100):0,nodes:nodes};
}

function getBatchCostTrace_(session,data){
  var batch=findOne_('BATCHES','batch_id',data.batchId); _peOwned_(session,findOne_('PRODUCTS','product_id',batch.product_id),'PRODUCTS:'+batch.product_id);
  var nodes=[], total=0;
  var breakdown=findOne_('BREAKDOWN_ACT_LINES','output_batch_id',batch.batch_id);
  if(breakdown){
    total=_peNum_(breakdown.amount); nodes.push({type:'BREAKDOWN_OUTPUT',line_id:breakdown.line_id,act_id:breakdown.act_id,input_batch_id:breakdown.batch_id,cost:total});
    var inputBatch=findOne_('BATCHES','batch_id',breakdown.batch_id);
    if(inputBatch){ nodes.push({type:'INPUT_BATCH',batch_id:inputBatch.batch_id,cost:_peNum_(inputBatch.количество)*_peNum_(inputBatch.цена_прихода)}); }
  }
  var production=findOne_('PRODUCTION','batch_id',batch.batch_id);
  if(production){
    var uses=_peRows_('PRODUCTION_INGREDIENT_USAGE',function(x){return x.production_id===production.production_id;});
    total=uses.reduce(function(s,x){return s+_peNum_(x.стоимость_брутто);},0);
    nodes.push({type:'PRODUCTION',production_id:production.production_id,cost:round2_(total),ingredients:uses.map(function(x){return {product_id:x.product_id,batch_ids:x.batch_ids,gross:x.брутто,cost:x.стоимость_брутто};})});
  }
  if(!production&&!breakdown){
    var receipts=_peRows_('WAREHOUSE_OPS',function(x){return x.batch_id===batch.batch_id&&x.тип_операции===OP_TYPES.RECEIPT;});
    total=receipts.reduce(function(s,x){return s+_peNum_(x.сумма);},0);
    nodes.push({type:'RECEIPT',operations:receipts,cost:round2_(total)});
  }
  var qty=_peNum_(batch.количество);
  return {batch:batch,total_cost:round2_(total),unit_cost:qty>0?round2_(total/qty):0,nodes:nodes};
}

/* ---------- 7. ПЛАНИРОВАНИЕ ПРОИЗВОДСТВА ---------- */
function createProductionPlan_(data,session){
  return withLock_(function(){
    var plan={plan_id:generateId_('PRODUCTION_PLANS'),organization_id:session.organization_id,location_id:session.location_id,workshop_id:data.workshopId||'',plan_date:data.planDate||todayDateStr_(),status:'DRAFT',created_at:nowIso_(),created_by:session.user_id,approved_at:'',approved_by:''};
    insertRow_('PRODUCTION_PLANS',plan);
    (data.items||[]).forEach(function(i){
      var dish=findOne_('DISHES','dish_id',i.dishId); _peOwned_(session,dish,'DISHES:'+i.dishId);
      var qty=_peNum_(i.qty); if(qty<=0) throw new Error('Количество позиции плана должно быть > 0.');
      insertRow_('PRODUCTION_PLAN_LINES',{line_id:generateId_('PRODUCTION_PLAN_LINES'),plan_id:plan.plan_id,organization_id:session.organization_id,dish_id:dish.dish_id,qty:qty,unit:i.unit||'шт',priority:i.priority||0,status:'PLANNED',production_id:'',created_at:nowIso_()});
    });
    return getProductionPlan_(plan.plan_id,session);
  });
}
function getProductionPlan_(planId,session){var p=findOne_('PRODUCTION_PLANS','plan_id',planId);_peOwned_(session,p,'PRODUCTION_PLANS:'+planId);return {plan:p,lines:_peRows_('PRODUCTION_PLAN_LINES',function(x){return x.plan_id===planId;})};}
function approveProductionPlan_(planId,session){return withLock_(function(){var p=findOne_('PRODUCTION_PLANS','plan_id',planId);_peOwned_(session,p,'PRODUCTION_PLANS:'+planId);if(p.status!=='DRAFT')throw new Error('План уже обработан.');var lines=_peRows_('PRODUCTION_PLAN_LINES',function(x){return x.plan_id===planId;});if(!lines.length)throw new Error('План пуст.');var created=[];lines.forEach(function(l){var t=createProductionTask_(p.location_id,'DISH',l.dish_id,l.qty,session.user_id,p.workshop_id,session);updateRow_('PRODUCTION_PLAN_LINES',l,{status:'TASK_CREATED',production_id:t.production_id});created.push(t);});updateRow_('PRODUCTION_PLANS',p,{status:'RELEASED',approved_at:nowIso_(),approved_by:session.user_id});return {plan:findOne_('PRODUCTION_PLANS','plan_id',planId),tasks:created};});}

/* ---------- 8. МОБИЛЬНЫЙ КОНТУР ---------- */
function getMobileProductionBoard_(session,data){
  var d=getProductionDispatcher_(session,data||{});
  return {mode:'mobile',location_id:d.location_id,now:nowIso_(),queue:d.queue.slice(0,50),actions:['START_TASK','COMPLETE_TASK','CONFIRM_YIELD','CAPTURE_HACCP_EVIDENCE','SCAN_BATCH']};
}

/* ---------- 9. ЦИФРОВОЙ ПАСПОРТ BATCH ---------- */
function getBatchPassport_(session,data){
  var b=findOne_('BATCHES','batch_id',data.batchId);_peOwned_(session,findOne_('PRODUCTS','product_id',b.product_id),'PRODUCTS:'+b.product_id);
  var ops=_peRows_('WAREHOUSE_OPS',function(x){return x.batch_id===b.batch_id;});
  var waste=_peRows_('WASTE_RECORDS',function(x){try{return JSON.parse(x.batch_ids||'[]').indexOf(b.batch_id)>=0;}catch(e){return false;}});
  var evidence=_peRows_('HACCP_EVIDENCE',function(x){return x.batch_id===b.batch_id;});
  var recall=_peRows_('RECALL_BLOCKS',function(x){return x.batch_id===b.batch_id;});
  var breakdown=_peRows_('BREAKDOWN_ACT_LINES',function(x){return x.output_batch_id===b.batch_id||x.batch_id===b.batch_id;});
  var remaining=getBatchRemaining_(b);
  return {batch:b,remaining:remaining,warehouse_ops:ops,waste:waste,haccp_evidence:evidence,recall_blocks:recall,breakdown:breakdown,trace:{cascade_ids:Array.from(new Set(ops.map(function(x){return x.cascade_id;}).concat([b.cascade_id]).filter(Boolean)))}};
}

/* ---------- 10. ИНСПЕКЦИОННЫЙ ПАКЕТ ППК ---------- */
function generateInspectionPacket_(session,data){
  var ppk=typeof getCurrentPpk_==='function'?getCurrentPpk_(session.organization_id):null;
  if(!ppk) throw new Error('Нет текущей ППК для формирования инспекционного пакета.');
  var locationId=data&&data.locationId||session.location_id;
  var docs=_peRows_('PPK_DOCUMENTS',function(x){return x.organization_id===session.organization_id&&x.ppk_id===ppk.ppk_id;});
  var journals=_peRows_('JOURNALS',function(x){return x.organization_id===session.organization_id&&(!locationId||x.location_id===locationId);});
  var evidence=_peRows_('HACCP_EVIDENCE',function(x){return x.organization_id===session.organization_id;});
  var deviations=_peRows_('JOURNAL_DEVIATIONS',function(x){var j=findOne_('JOURNALS','journal_id',x.journal_id);return j&&j.organization_id===session.organization_id;});
  var corrective=_peRows_('CORRECTIVE_ACTIONS',function(x){return x.organization_id===session.organization_id;});
  var sanitation=_peRows_('SANITARY_TASKS',function(x){return x.organization_id===session.organization_id&&(!locationId||x.location_id===locationId);});
  var hazards=_peRows_('HAZARD_ANALYSIS',function(x){return x.ppk_id===ppk.ppk_id;});
  var controls=_peRows_('PPK_CONTROLS',function(x){return x.ppk_id===ppk.ppk_id;});
  var limits=_peRows_('PPK_CRITICAL_LIMITS',function(x){return x.ppk_id===ppk.ppk_id;});
  var verification=_peRows_('PPK_VERIFICATION',function(x){return x.ppk_id===ppk.ppk_id;});
  var packet={packet_id:generateId_('PPK_INSPECTION_PACKETS'),organization_id:session.organization_id,location_id:locationId,ppk_id:ppk.ppk_id,generated_at:nowIso_(),generated_by:session.user_id,sections:{ppk:ppk,documents:docs,hazards:hazards,controls:controls,critical_limits:limits,verification:verification,journals:journals,evidence:evidence,deviations:deviations,corrective_actions:corrective,sanitation:sanitation}};
  insertRow_('PPK_INSPECTION_PACKETS',{packet_id:packet.packet_id,organization_id:session.organization_id,location_id:locationId,ppk_id:ppk.ppk_id,status:'GENERATED',generated_at:packet.generated_at,generated_by:session.user_id,sections_json:JSON.stringify(packet.sections)});
  return packet;
}

function getInspectionPacket_(session,data){var p=findOne_('PPK_INSPECTION_PACKETS','packet_id',data.packetId);_peOwned_(session,p,'PPK_INSPECTION_PACKETS:'+data.packetId);return {packet:p,sections:JSON.parse(p.sections_json||'{}')};}

/* ---------- общий readiness ---------- */
function getProductionEnterpriseDashboard_(session,data){
  return {dispatcher:getProductionDispatcher_(session,data||{}),yield_deviations:getProductionYieldDeviations_(session,{status:'OPEN'}),recalls:_peRows_('RECALL_CASES',function(r){return r.organization_id===session.organization_id&&r.status==='OPEN';}),haccp_evidence_count:_peRows_('HACCP_EVIDENCE',function(r){return r.organization_id===session.organization_id;}).length};
}
