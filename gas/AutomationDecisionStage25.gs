/**
 * ЦЕХ — Stage 25: Automation & Decision Engine.
 *
 * Безопасный контур: сигнал -> предложение -> согласование -> действие -> аудит.
 * Автоматически создаются только предложения. Денежные, складские, производственные
 * и compliance-изменения требуют явного APPROVE_AUTOMATION_DECISION.
 */
var AUTOMATION_DECISION_STATUSES_ = ['PENDING','APPROVED','REJECTED','EXPIRED','EXECUTED','FAILED'];
var AUTOMATION_DECISION_TTL_HOURS_ = 24;

function _ad25Scope_(r,s){return !!r && r.organization_id===s.organization_id && (!s.location_id || !r.location_id || r.location_id===s.location_id);}
function _ad25ActionAllowed_(action){return ['CREATE_TASK','CREATE_PURCHASE_REQUEST'].indexOf(action)!==-1;}
function _ad25Decision_(row){
  return {decision_id:row.decision_id,organization_id:row.organization_id,location_id:row.location_id,
    source_code:row.source_code,source_module:row.source_module,severity:row.severity,
    title:row.title,description:row.description,proposed_action:row.proposed_action,
    payload:JSON.parse(row.payload_json||'{}'),status:row.status,created_at:row.created_at,
    expires_at:row.expires_at,approved_at:row.approved_at,approved_by:row.approved_by,
    executed_at:row.executed_at,error:row.error||''};
}
function _ad25Expiry_(r){ return String(r.expires_at||'') && String(r.expires_at) < nowIso_(); }
function _ad25FindOpen_(org,loc,sourceCode){
  return findRows_('AUTOMATION_DECISIONS',function(r){
    return r.organization_id===org && r.location_id===loc && r.source_code===sourceCode &&
      ['PENDING','APPROVED'].indexOf(r.status)!==-1 && !_ad25Expiry_(r);
  });
}

function createAutomationDecision_(p,session){
  if(!_ad25ActionAllowed_(p.proposedAction)) throw new Error('Действие не разрешено Automation Engine.');
  if(!p.title) throw new Error('У решения отсутствует title.');
  var existing=_ad25FindOpen_(session.organization_id,session.location_id,p.sourceCode||'');
  if(existing.length) return _ad25Decision_(existing[0]);
  var expires=new Date(Date.now()+AUTOMATION_DECISION_TTL_HOURS_*3600000).toISOString();
  var row={decision_id:generateId_('AUTOMATION_DECISIONS'),organization_id:session.organization_id,
    location_id:session.location_id||'',source_code:p.sourceCode||'',source_module:p.sourceModule||'automation',
    severity:p.severity||'MEDIUM',title:p.title,description:p.description||'',proposed_action:p.proposedAction,
    payload_json:JSON.stringify(p.payload||{}),status:'PENDING',created_at:nowIso_(),expires_at:expires,
    approved_at:'',approved_by:'',executed_at:'',error:''};
  insertRow_('AUTOMATION_DECISIONS',row);
  auditLog_(session.user_id,'Создано предложение автоматизации','AUTOMATION_DECISIONS:'+row.decision_id,null,row.title,'success',session.cascade_id||'');
  return _ad25Decision_(row);
}

function getAutomationDecisions_(session,data){
  data=data||{};
  var rows=findRows_('AUTOMATION_DECISIONS',function(r){
    if(!_ad25Scope_(r,session)) return false;
    if(data.status && r.status!==data.status) return false;
    return true;
  });
  return rows.sort(function(a,b){return String(b.created_at).localeCompare(String(a.created_at));}).slice(0,Number(data.limit)||50).map(_ad25Decision_);
}

function buildAutomationDecisions_(session){
  var ct=getControlTower_({locationId:session.location_id,dateFrom:todayDateStr_(),dateTo:todayDateStr_(),forecastDays:30,demandHorizonDays:1},session);
  var created=[];
  (ct.actions||[]).forEach(function(a){
    if(['CRITICAL','HIGH'].indexOf(a.severity)===-1) return;
    var proposed='CREATE_TASK';
    var payload={type:'ai',title:a.title,description:a.action+' Значение: '+a.value,priority:a.severity==='CRITICAL'?'критический':'высокий',responsibleRole:a.code.indexOf('HACCP')>=0?'ШЕФ-ПОВАР':a.code.indexOf('CASH')>=0?'ДИРЕКТОР':'МЕНЕДЖЕР',dueAt:new Date(Date.now()+86400000).toISOString()};
    created.push(createAutomationDecision_({sourceCode:a.code,sourceModule:a.source,severity:a.severity,title:a.title,description:a.action,proposedAction:proposed,payload:payload},session));
  });
  return {generated_at:nowIso_(),created:created.length,decisions:created};
}

function runAutomationDecisionTrigger_(){
  try{
    getOrganizations_(null).forEach(function(org){
      (getLocations_(org.organization_id)||[]).forEach(function(loc){
        try{
          var s={user_id:'system',organization_id:org.organization_id,location_id:loc.location_id,role:'ADMIN','роль':'ADMIN',allowed_locations:[loc.location_id],cascade_id:'',operation_id:''};
          var r=buildAutomationDecisions_(s);
          if(r.created) notify_(org.organization_id,loc.location_id,'AUTOMATION_DECISION','Созданы предложения автоматизации: '+r.created,'ad25|'+loc.location_id+'|'+todayDateStr_());
        }catch(e){logSystemError_('runAutomationDecisionTrigger_',org.organization_id,'automation_decision',e);}
      });
    });
  }catch(err){logSystemError_('runAutomationDecisionTrigger_',null,'automation_decision',err);}
}

function approveAutomationDecision_(decisionId,session){
  return withLock_(function(){
    var row=findOne_('AUTOMATION_DECISIONS','decision_id',decisionId);
    if(!row || !_ad25Scope_(row,session)) throw new Error('Предложение автоматизации не найдено.');
    if(_ad25Expiry_(row)){updateRow_('AUTOMATION_DECISIONS',row,{status:'EXPIRED'});throw new Error('Предложение автоматизации истекло.');}
    if(row.status==='EXECUTED') return _ad25Decision_(row);
    if(row.status!=='PENDING') throw new Error('Предложение нельзя согласовать в статусе '+row.status+'.');
    var payload=JSON.parse(row.payload_json||'{}');
    var result;
    try{
      if(row.proposed_action==='CREATE_TASK') result=createTask_({organizationId:session.organization_id,locationId:session.location_id,type:payload.type,title:payload.title,description:payload.description,responsibleRole:payload.responsibleRole,responsibleId:payload.responsibleId||'',priority:payload.priority,dueAt:payload.dueAt,userId:session.user_id,session:session,sourceEntityId:row.decision_id});
      else if(row.proposed_action==='CREATE_PURCHASE_REQUEST') result=createPurchaseRequest_(session.location_id,payload.productId,payload.qty,session.user_id,session);
      else throw new Error('Неразрешённое действие предложения.');
      updateRow_('AUTOMATION_DECISIONS',row,{status:'EXECUTED',approved_at:nowIso_(),approved_by:session.user_id,executed_at:nowIso_(),error:''});
      auditLog_(session.user_id,'Исполнено согласованное предложение автоматизации','AUTOMATION_DECISIONS:'+decisionId,null,row.proposed_action,'success',session.cascade_id||'');
      row=findOne_('AUTOMATION_DECISIONS','decision_id',decisionId);
      var out=_ad25Decision_(row); out.result=result; return out;
    }catch(e){
      updateRow_('AUTOMATION_DECISIONS',row,{status:'FAILED',approved_at:nowIso_(),approved_by:session.user_id,error:String(e.message||e)});
      throw e;
    }
  });
}

function rejectAutomationDecision_(decisionId,session,reason){
  return withLock_(function(){
    var row=findOne_('AUTOMATION_DECISIONS','decision_id',decisionId);
    if(!row || !_ad25Scope_(row,session)) throw new Error('Предложение автоматизации не найдено.');
    if(row.status!=='PENDING') throw new Error('Отклонить можно только PENDING.');
    updateRow_('AUTOMATION_DECISIONS',row,{status:'REJECTED',approved_at:nowIso_(),approved_by:session.user_id,error:String(reason||'Отклонено пользователем.')});
    row=findOne_('AUTOMATION_DECISIONS','decision_id',decisionId);
    return _ad25Decision_(row);
  });
}
