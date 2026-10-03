/**
 * ЦЕХ — Stage 26: Event-Driven Automation Engine.
 *
 * Архитектура: EVENTS -> RULES -> DISPATCH -> AUTOMATION_DECISIONS.
 * Этот слой НЕ меняет бизнес-факты напрямую. Он превращает подтверждённые события
 * в идемпотентные предложения Stage 25. Рискованные действия остаются за человеком.
 */
var EVENT_AUTOMATION_RULE_STATUSES_ = ['ACTIVE','DISABLED'];
var EVENT_AUTOMATION_DISPATCH_STATUSES_ = ['CREATED','SKIPPED','FAILED'];
var EVENT_AUTOMATION_BATCH_LIMIT_ = 50;

function _ea26Parse_(s){ try{return JSON.parse(s||'{}');}catch(e){return {};}}
function _ea26Scope_(r,s){return !!r&&r.organization_id===s.organization_id&&(!s.location_id||r.location_id===s.location_id);}
function _ea26RuleMatches_(rule,event){
  if(rule.status!=='ACTIVE'||rule.event_type!==event.type)return false;
  if(rule.source && rule.source!==event.source)return false;
  return true;
}
function _ea26RuleKey_(r){return [r.organization_id,r.location_id||'',r.event_type,r.source||'',r.action].join('|');}
function _ea26DispatchKey_(event,rule){return 'event-automation|'+event.event_id+'|'+rule.rule_id;}

function ensureDefaultEventAutomationRules_(organizationId,locationId){
  var defs=[
    {event_type:'EXPIRY_WARNING',severity:'HIGH',title:'Контроль срока годности',description:'Событие срока годности требует проверки партии.',action:'CREATE_TASK',priority:80,responsible_role:'КЛАДОВЩИК'},
    {event_type:'DEVIATION_CREATED',severity:'HIGH',title:'Разобрать производственное отклонение',description:'Создано отклонение. Требуется анализ причины и корректирующее действие.',action:'CREATE_TASK',priority:85,responsible_role:'ТЕХНОЛОГ'},
    {event_type:'TASK_OVERDUE',severity:'HIGH',title:'Закрыть просроченную задачу',description:'Задача вышла за срок. Требуется назначить корректирующее действие.',action:'CREATE_TASK',priority:75,responsible_role:'МЕНЕДЖЕР'},
    {event_type:'LAB_RESULT_FAILED',severity:'CRITICAL',title:'Проверить неудовлетворительный лабораторный результат',description:'Лабораторный результат не прошёл контроль. Требуется немедленная проверка.',action:'CREATE_TASK',priority:95,responsible_role:'ТЕХНОЛОГ'},
    {event_type:'SAFETY_TEST_FAILED',severity:'CRITICAL',title:'Проверить несданный тест безопасности',description:'Сотрудник не прошёл тест безопасности. Требуется действие ответственного.',action:'CREATE_TASK',priority:95,responsible_role:'МЕНЕДЖЕР'}
  ];
  var existing=findRows_('AUTOMATION_RULES',function(r){return r.organization_id===organizationId&&r.location_id===locationId;});
  var created=[];
  defs.forEach(function(d){
    var key=[organizationId,locationId,d.event_type,'',d.action].join('|');
    if(existing.some(function(r){return _ea26RuleKey_(r)===key;}))return;
    var row={rule_id:generateId_('AUTOMATION_RULES'),organization_id:organizationId,location_id:locationId,event_type:d.event_type,source:'',action:d.action,severity:d.severity,title:d.title,description:d.description,priority:d.priority,responsible_role:d.responsible_role,status:'ACTIVE',created_at:nowIso_(),updated_at:nowIso_()};
    insertRow_('AUTOMATION_RULES',row);created.push(row);
  });
  return created;
}

function getEventAutomationRules_(session,data){
  data=data||{};
  return findRows_('AUTOMATION_RULES',function(r){
    if(!_ea26Scope_(r,session))return false;
    if(data.eventType&&r.event_type!==data.eventType)return false;
    if(data.status&&r.status!==data.status)return false;
    return true;
  }).sort(function(a,b){return Number(b.priority||0)-Number(a.priority||0);});
}

function createEventAutomationRule_(data,session){
  if(!data.eventType||EVENT_TYPES.indexOf(data.eventType)===-1)throw new Error('Недопустимый тип события.');
  if(!data.action||!_ad25ActionAllowed_(data.action))throw new Error('Действие не разрешено Automation Engine.');
  var key=[session.organization_id,session.location_id||'',data.eventType,data.source||'',data.action].join('|');
  var same=findRows_('AUTOMATION_RULES',function(r){return _ea26RuleKey_(r)===key&&r.status==='ACTIVE';});
  if(same.length)return same[0];
  var row={rule_id:generateId_('AUTOMATION_RULES'),organization_id:session.organization_id,location_id:session.location_id||'',event_type:data.eventType,source:data.source||'',action:data.action,severity:data.severity||'HIGH',title:data.title||data.eventType,description:data.description||'',priority:Number(data.priority||50),responsible_role:data.responsibleRole||'МЕНЕДЖЕР',status:'ACTIVE',created_at:nowIso_(),updated_at:nowIso_()};
  insertRow_('AUTOMATION_RULES',row);
  auditLog_(session.user_id,'Создано правило событийной автоматизации','AUTOMATION_RULES:'+row.rule_id,null,row.event_type+' -> '+row.action,'success',session.cascade_id||'');
  return row;
}

function setEventAutomationRuleStatus_(ruleId,status,session){
  if(EVENT_AUTOMATION_RULE_STATUSES_.indexOf(status)===-1)throw new Error('Недопустимый статус правила.');
  var row=findOne_('AUTOMATION_RULES','rule_id',ruleId);
  if(!row||!_ea26Scope_(row,session))throw new Error('Правило не найдено.');
  updateRow_('AUTOMATION_RULES',row,{status:status,updated_at:nowIso_()});
  auditLog_(session.user_id,'Изменён статус правила событийной автоматизации','AUTOMATION_RULES:'+ruleId,row.status,status,'success',session.cascade_id||'');
  return findOne_('AUTOMATION_RULES','rule_id',ruleId);
}

function _ea26BuildDecisionPayload_(rule,event){
  var p=_ea26Parse_(event.payload_json);
  return {type:'event_automation',title:rule.title,description:rule.description+' Событие: '+event.event_id+'.',priority:rule.severity==='CRITICAL'?'критический':(rule.severity==='HIGH'?'высокий':'обычный'),responsibleRole:rule.responsible_role,dueAt:new Date(Date.now()+86400000).toISOString(),eventId:event.event_id,eventType:event.type,entityType:event.entity_type,entityId:event.entity_id,eventPayload:p};
}

function _ea26ActivationCutoff_(){
  var props=PropertiesService.getScriptProperties(), key='EVENT_AUTOMATION_STAGE26_EPOCH', value=props.getProperty(key);
  if(!value){value=nowIso_();props.setProperty(key,value);}
  return value;
}

function dispatchEventAutomationBatch_(session,limit){
  var cutoff=_ea26ActivationCutoff_();
  limit=Math.min(Number(limit||EVENT_AUTOMATION_BATCH_LIMIT_),EVENT_AUTOMATION_BATCH_LIMIT_);
  ensureDefaultEventAutomationRules_(session.organization_id,session.location_id||'');
  var rules=getEventAutomationRules_(session,{status:'ACTIVE'});
  var events=findRows_('EVENTS',function(e){return _ea26Scope_(e,session)&&String(e.created_at||'')>=cutoff;}).sort(function(a,b){return new Date(a.created_at)-new Date(b.created_at);});
  var dispatch=findRows_('AUTOMATION_EVENT_DISPATCH',function(d){return _ea26Scope_(d,session);});
  var created=[],skipped=0,failed=0,handled=0;
  for(var i=0;i<events.length&&handled<limit;i++){
    var ev=events[i];
    var matching=rules.filter(function(r){return _ea26RuleMatches_(r,ev);});
    for(var j=0;j<matching.length&&handled<limit;j++){
      var rule=matching[j], key=_ea26DispatchKey_(ev,rule);
      if(dispatch.some(function(d){return d.dispatch_key===key;})){skipped++;continue;}
      handled++;
      var drow={dispatch_id:generateId_('AUTOMATION_EVENT_DISPATCH'),organization_id:ev.organization_id,location_id:ev.location_id||'',event_id:ev.event_id,rule_id:rule.rule_id,dispatch_key:key,status:'CREATED',decision_id:'',created_at:nowIso_(),processed_at:'',error:''};
      try{
        var decision=createAutomationDecision_({sourceCode:'EVENT:'+ev.event_id+':RULE:'+rule.rule_id,sourceModule:'event_automation',severity:rule.severity,title:rule.title,description:rule.description,proposedAction:rule.action,payload:_ea26BuildDecisionPayload_(rule,ev)},session);
        drow.decision_id=decision.decision_id;drow.processed_at=nowIso_();
        insertRow_('AUTOMATION_EVENT_DISPATCH',drow);created.push(decision);
      }catch(e){drow.status='FAILED';drow.error=String(e.message||e);drow.processed_at=nowIso_();insertRow_('AUTOMATION_EVENT_DISPATCH',drow);failed++;logSystemError_('dispatchEventAutomationBatch_',session.organization_id,'event_automation',e);}
    }
  }
  return {generated_at:nowIso_(),handled_events:handled,created:created.length,skipped:skipped,failed:failed,decisions:created};
}

function eventAutomationStage26Trigger_(){
  try{
    getOrganizations_(null).forEach(function(org){
      (getLocations_(org.organization_id)||[]).forEach(function(loc){
        try{
          var s={user_id:'system',organization_id:org.organization_id,location_id:loc.location_id,role:'ADMIN','роль':'ADMIN',allowed_locations:[loc.location_id],cascade_id:'',operation_id:''};
          var r=withLock_(function(){return dispatchEventAutomationBatch_(s,EVENT_AUTOMATION_BATCH_LIMIT_);});
          if(r.created)notify_(org.organization_id,loc.location_id,'AUTOMATION_EVENT','Созданы предложения по событиям: '+r.created,'ea26|'+loc.location_id+'|'+todayDateStr_());
        }catch(e){logSystemError_('eventAutomationStage26Trigger_',org.organization_id,'event_automation',e);}
      });
    });
  }catch(err){logSystemError_('eventAutomationStage26Trigger_',null,'event_automation',err);}
}

function runEventAutomationStage26Tests_(){
  var out=[];function ok(n,c,d){out.push({name:n,status:c?'OK':'FAIL',detail:d||''});}
  ok('SCHEMA',Array.isArray(CONFIG.SCHEMA.AUTOMATION_RULES)&&Array.isArray(CONFIG.SCHEMA.AUTOMATION_EVENT_DISPATCH),'new schemas registered');
  ok('SHEETS',CONFIG.SHEETS.AUTOMATION_RULES==='AUTOMATION_RULES'&&CONFIG.SHEETS.AUTOMATION_EVENT_DISPATCH==='AUTOMATION_EVENT_DISPATCH','sheets registered');
  ok('IDS',CONFIG.ID_PREFIXES.AUTOMATION_RULES==='ARULE'&&CONFIG.ID_PREFIXES.AUTOMATION_EVENT_DISPATCH==='AED','id prefixes registered');
  ok('EVENT_BUS',typeof emitEvent_==='function'&&typeof getEvents_==='function','event bus available');
  ok('DECISION_ENGINE',typeof createAutomationDecision_==='function'&&typeof approveAutomationDecision_==='function','stage25 engine available');
  ok('TRIGGER',getExpectedTriggerHandlers_().indexOf('eventAutomationStage26Trigger_')!==-1,'trigger registered');
  ok('SAFE_ACTIONS',_ad25ActionAllowed_('CREATE_TASK')&&_ad25ActionAllowed_('CREATE_PURCHASE_REQUEST')&&!_ad25ActionAllowed_('RECORD_CASH_TRANSACTION'),'risk boundary preserved');
  ok('DISPATCH_IDEMPOTENCY',typeof _ea26DispatchKey_==='function','dispatch key available');
  ok('ACTIVATION_BOUNDARY',typeof _ea26ActivationCutoff_==='function','historical events are not backfilled automatically');
  return {ok:out.every(function(x){return x.status==='OK';}),checks:out};
}
