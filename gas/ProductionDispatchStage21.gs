/**
 * ЦЕХ — Stage 21: FEFO + Production Dispatcher.
 *
 * Рекомендательный слой: строит выполнимую очередь производства на дату,
 * проверяет доступность годного сырья по FEFO и оценивает загрузку цехов.
 * Никаких складских списаний/закупок при расчёте нет.
 */
function _pdNum_(v,d){var n=Number(v);return isNaN(n)?(d||0):n;}
function _pdDate_(v){return String(v||'').slice(0,10);}
function _pdOwnedLocation_(session,row,ref){if(!row)throw new Error('Объект не найден: '+ref);assertOwnedByLocation_(session,row,ref);return row;}

function _pdRecipeNeed_(dishId, qty){
  var need={};
  function add(pid,q,unit){if(!pid||q<=0)return;if(!need[pid])need[pid]={qty:0,unit:unit||''};need[pid].qty+=q;}
  getRecipeLines_('DISH',dishId).forEach(function(l){
    var q=_pdNum_(l.брутто)*qty;
    if(String(l.product_id).indexOf('PF-')===0){
      var pf=getSemiFinishedById_(l.product_id), y=pf?_pdNum_(pf.выход,1):1;
      getRecipeLines_('PF',l.product_id).forEach(function(pl){add(pl.product_id,_pdNum_(pl.брутто)*(q/(y||1)),pl.единица);});
    } else add(l.product_id,q,l.единица);
  });
  return need;
}

function _pdFefoAllocate_(productId,locationId,qty){
  var batches=getActiveBatchesFifo_(productId,locationId).filter(function(x){return !_isBatchExpired_(x.batch)&&x.remaining>0.0001;});
  var left=qty, rows=[];
  batches.forEach(function(x){if(left<=0.0001)return;var take=Math.min(left,x.remaining);rows.push({batch_id:x.batch.batch_id,qty:round2_(take),expiry:_pdDate_(x.batch.срок_годности),price:_pdNum_(x.batch.цена_прихода)});left-=take;});
  return {requested:round2_(qty),allocated:round2_(qty-left),shortage:round2_(Math.max(0,left)),batches:rows};
}

function setProductionDispatchConfig_(data,session){
  var loc=data.locationId||session.location_id;
  if(loc!==session.location_id)throw new Error('Нельзя менять конфигурацию другой точки.');
  var workshopId=data.workshopId||'';
  var existing=findRows_('PRODUCTION_DISPATCH_CONFIG',function(r){return r.organization_id===session.organization_id&&r.location_id===loc&&r.workshop_id===workshopId;})[0];
  var row=existing||{config_id:generateId_('PRODUCTION_DISPATCH_CONFIG'),organization_id:session.organization_id,location_id:loc,workshop_id:workshopId};
  var patch={capacity_qty_per_hour:Math.max(0,_pdNum_(data.capacityQtyPerHour)),working_hours_per_day:Math.max(0,_pdNum_(data.workingHoursPerDay,8)),active:data.active!==false,updated_at:nowIso_(),updated_by:session.user_id};
  if(existing)updateRow_('PRODUCTION_DISPATCH_CONFIG',existing,patch);else{Object.keys(patch).forEach(function(k){row[k]=patch[k];});insertRow_('PRODUCTION_DISPATCH_CONFIG',row);}
  auditLog_(session.user_id,'Изменена производственная мощность','PRODUCTION_DISPATCH_CONFIG:'+row.config_id,'',JSON.stringify(patch),'success',session.cascade_id||'');
  return findOne_('PRODUCTION_DISPATCH_CONFIG','config_id',row.config_id);
}

function _pdCapacity_(session,loc,workshopId){
  var cfg=findRows_('PRODUCTION_DISPATCH_CONFIG',function(r){return r.organization_id===session.organization_id&&r.location_id===loc&&r.workshop_id===workshopId&&String(r.active)!=='false';})[0];
  if(!cfg)return {capacityHours:8,qtyPerHour:0,source:'DEFAULT'};
  return {capacityHours:_pdNum_(cfg.working_hours_per_day,8),qtyPerHour:_pdNum_(cfg.capacity_qty_per_hour),source:'CONFIG'};
}

function createProductionDispatchPlan_(data,session){
  return withLock_(function(){
    var loc=data.locationId||session.location_id;if(loc!==session.location_id)throw new Error('Нельзя строить план другой точки.');
    var date=data.planDate||todayDateStr_();
    var sourcePlan=data.productionPlanId?findOne_('PRODUCTION_PLANS','plan_id',data.productionPlanId):null;
    if(sourcePlan)_pdOwnedLocation_(session,sourcePlan,'PRODUCTION_PLANS:'+data.productionPlanId);
    var tasks=findRows_('PRODUCTION',function(t){return t.location_id===loc&&['план','в_работе'].indexOf(t.статус)>=0;});
    if(data.productionIds&&data.productionIds.length)tasks=tasks.filter(function(t){return data.productionIds.indexOf(t.production_id)>=0;});
    var rows=[], totalHours=0, capacityHours=0;
    tasks.forEach(function(t){
      var dishId=t.parent_type==='DISH'?t.parent_id:'';
      var need=dishId?_pdRecipeNeed_(dishId,_pdNum_(t.количество)):{};
      var shortages=0;
      Object.keys(need).forEach(function(pid){shortages+=_pdFefoAllocate_(pid,loc,need[pid].qty).shortage;});
      var cap=_pdCapacity_(session,loc,t.workshop_id||'');
      var hours=cap.qtyPerHour>0?_pdNum_(t.количество)/cap.qtyPerHour:0;
      capacityHours+=cap.capacityHours;totalHours+=hours;
      rows.push({task:t,dishId:dishId,qty:_pdNum_(t.количество),hours:round2_(hours),fefoReady:shortages<=0.0001,shortage:round2_(shortages),priority:_pdNum_(t.priority,100)});
    });
    rows.sort(function(a,b){if(a.fefoReady!==b.fefoReady)return a.fefoReady?-1:1;if(a.priority!==b.priority)return a.priority-b.priority;return a.hours-b.hours;});
    var plan={dispatch_plan_id:generateId_('PRODUCTION_DISPATCH_PLANS'),organization_id:session.organization_id,location_id:loc,plan_date:date,status:'DRAFT',capacity_hours:round2_(capacityHours),planned_hours:round2_(totalHours),utilization_pct:capacityHours?round2_(totalHours/capacityHours*100):0,created_at:nowIso_(),created_by:session.user_id,approved_at:'',approved_by:''};
    insertRow_('PRODUCTION_DISPATCH_PLANS',plan);
    rows.forEach(function(x,i){insertRow_('PRODUCTION_DISPATCH_LINES',{line_id:generateId_('PRODUCTION_DISPATCH_LINES'),dispatch_plan_id:plan.dispatch_plan_id,organization_id:session.organization_id,location_id:loc,production_id:x.task.production_id,dish_id:x.dishId,qty:x.qty,priority:x.priority,workshop_id:x.task.workshop_id||'',planned_hours:x.hours,sequence_no:i+1,status:x.fefoReady?'READY':'WAITING_MATERIAL',fefo_ready:x.fefoReady,fefo_shortage_qty:x.shortage,created_at:nowIso_()});});
    auditLog_(session.user_id,'Создан диспетчерский план производства','PRODUCTION_DISPATCH_PLANS:'+plan.dispatch_plan_id,'',JSON.stringify({tasks:rows.length,utilization:plan.utilization_pct}),'success',session.cascade_id||'');
    return getProductionDispatchPlan_( {dispatchPlanId:plan.dispatch_plan_id}, session);
  });
}

function getProductionDispatchPlan_(data,session){
  var p=findOne_('PRODUCTION_DISPATCH_PLANS','dispatch_plan_id',data.dispatchPlanId);_pdOwnedLocation_(session,p,'PRODUCTION_DISPATCH_PLANS:'+data.dispatchPlanId);
  var lines=findRows_('PRODUCTION_DISPATCH_LINES',function(r){return r.dispatch_plan_id===p.dispatch_plan_id&&r.location_id===session.location_id;});
  return {plan:p,lines:lines,summary:{total:lines.length,ready:lines.filter(function(x){return x.fefo_ready===true||String(x.fefo_ready)==='true';}).length,waiting_material:lines.filter(function(x){return x.status==='WAITING_MATERIAL';}).length}};
}

function approveProductionDispatchPlan_(planId,session){
  return withLock_(function(){
    var b=getProductionDispatchPlan_({dispatchPlanId:planId},session);if(b.plan.status==='APPROVED')return b.plan;
    var blocked=b.lines.filter(function(x){return x.status==='WAITING_MATERIAL';});
    if(blocked.length)throw new Error('План нельзя утвердить: '+blocked.length+' производственных заданий не обеспечены годным сырьём.');
    updateRow_('PRODUCTION_DISPATCH_PLANS',b.plan,{status:'APPROVED',approved_at:nowIso_(),approved_by:session.user_id});
    b.lines.forEach(function(l){var t=findOne_('PRODUCTION','production_id',l.production_id);if(t&&t.статус==='план')updateRow_('PRODUCTION',t,{workshop_id:l.workshop_id||t.workshop_id});updateRow_('PRODUCTION_DISPATCH_LINES',l,{status:'DISPATCHED'});});
    auditLog_(session.user_id,'Утверждён диспетчерский план производства','PRODUCTION_DISPATCH_PLANS:'+planId,'DRAFT','APPROVED','success',session.cascade_id||'');
    return getProductionDispatchPlan_({dispatchPlanId:planId},session);
  });
}
