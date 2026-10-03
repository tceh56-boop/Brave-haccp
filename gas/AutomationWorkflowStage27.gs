/**
 * ЦЕХ — Stage 27: Automation Workflow Engine.
 *
 * Workflow не заменяет Stage 25/26. Он оркестрирует согласованное решение:
 * DECISION -> WORKFLOW -> STEPS -> SLA/ESCALATION -> RESULT.
 * Рискованные бизнес-действия по-прежнему выполняются только через Stage 25 approval.
 */
var AWF_STATUSES_ = ['OPEN','WAITING_APPROVAL','IN_PROGRESS','COMPLETED','ESCALATED','FAILED','CANCELLED'];
var AWF_STEP_STATUSES_ = ['PENDING','IN_PROGRESS','COMPLETED','OVERDUE','FAILED'];
var AWF_STEP_TYPES_ = ['APPROVAL','ACTION','CONTROL'];
var AWF_BATCH_LIMIT_ = 50;

function _awfScope_(r,s){return !!r&&r.organization_id===s.organization_id&&(!s.location_id||!r.location_id||r.location_id===s.location_id);}
function _awfJson_(s){try{return JSON.parse(s||'{}');}catch(e){return {};}}
function _awfDecision_(id,s){var r=findOne_('AUTOMATION_DECISIONS','decision_id',id);if(!r||!_ad25Scope_(r,s))throw new Error('Решение автоматизации не найдено.');return r;}
function _awfStep_(r){return {step_id:r.step_id,workflow_id:r.workflow_id,step_no:Number(r.step_no),step_type:r.step_type,title:r.title,status:r.status,owner_role:r.owner_role,owner_id:r.owner_id,due_at:r.due_at,started_at:r.started_at,completed_at:r.completed_at,attempts:Number(r.attempts||0),last_error:r.last_error||'',result:_awfJson_(r.result_json)};}
function _awfWorkflow_(r,s){
  var steps=findRows_('AUTOMATION_WORKFLOW_STEPS',function(x){return x.workflow_id===r.workflow_id&&_awfScope_(x,s);}).sort(function(a,b){return Number(a.step_no)-Number(b.step_no);});
  return {workflow_id:r.workflow_id,organization_id:r.organization_id,location_id:r.location_id,decision_id:r.decision_id,status:r.status,current_step:Number(r.current_step||0),owner_role:r.owner_role,owner_id:r.owner_id,sla_due_at:r.sla_due_at,created_at:r.created_at,updated_at:r.updated_at,completed_at:r.completed_at,last_error:r.last_error||'',steps:steps.map(_awfStep_)};
}
function createAutomationWorkflow_(data,session){
  if(!data.decisionId)throw new Error('decisionId обязателен.');
  var d=_awfDecision_(data.decisionId,session);
  if(d.status!=='PENDING')throw new Error('Workflow можно создать только для PENDING решения.');
  var existing=findRows_('AUTOMATION_WORKFLOWS',function(r){return r.decision_id===d.decision_id&&_awfScope_(r,session)&&['OPEN','WAITING_APPROVAL','IN_PROGRESS','ESCALATED'].indexOf(r.status)>=0;});
  if(existing.length)return _awfWorkflow_(existing[0],session);
  var now=nowIso_(), sla=new Date(Date.now()+Number(data.slaHours||24)*3600000).toISOString();
  var ownerRole=data.ownerRole||'МЕНЕДЖЕР';
  var wf={workflow_id:generateId_('AUTOMATION_WORKFLOWS'),organization_id:session.organization_id,location_id:session.location_id||'',decision_id:d.decision_id,status:'WAITING_APPROVAL',current_step:1,owner_role:ownerRole,owner_id:data.ownerId||'',sla_due_at:sla,created_at:now,updated_at:now,completed_at:'',last_error:''};
  insertRow_('AUTOMATION_WORKFLOWS',wf);
  var steps=[
    {n:1,type:'APPROVAL',title:'Согласовать автоматизированное действие',role:'ДИРЕКТОР',hours:Math.min(Number(data.approvalSlaHours||4),72)},
    {n:2,type:'ACTION',title:d.title,role:ownerRole,hours:Math.min(Number(data.actionSlaHours||12),168)},
    {n:3,type:'CONTROL',title:'Проверить результат и закрыть workflow',role:data.controlRole||'МЕНЕДЖЕР',hours:Math.min(Number(data.controlSlaHours||8),72)}
  ];
  steps.forEach(function(x){var due=new Date(Date.now()+x.hours*3600000).toISOString();insertRow_('AUTOMATION_WORKFLOW_STEPS',{step_id:generateId_('AUTOMATION_WORKFLOW_STEPS'),workflow_id:wf.workflow_id,organization_id:wf.organization_id,location_id:wf.location_id,step_no:x.n,step_type:x.type,title:x.title,status:x.n===1&&d.status==='PENDING'?'PENDING':'PENDING',owner_role:x.role,owner_id:'',due_at:due,started_at:'',completed_at:'',attempts:0,last_error:'',result_json:''});});
  auditLog_(session.user_id,'Создан automation workflow','AUTOMATION_WORKFLOWS:'+wf.workflow_id,null,d.decision_id,'success',session.cascade_id||'');
  return _awfWorkflow_(wf,session);
}
function getAutomationWorkflows_(session,data){
  data=data||{};var rows=findRows_('AUTOMATION_WORKFLOWS',function(r){return _awfScope_(r,session)&&(!data.status||r.status===data.status);});
  rows.sort(function(a,b){return String(b.updated_at).localeCompare(String(a.updated_at));});
  return rows.slice(0,Number(data.limit)||50).map(function(r){return _awfWorkflow_(r,session);});
}
function completeAutomationWorkflowStep_(stepId,result,session){
  return withLock_(function(){
    var step=findOne_('AUTOMATION_WORKFLOW_STEPS','step_id',stepId);if(!step||!_awfScope_(step,session))throw new Error('Шаг workflow не найден.');
    var wf=findOne_('AUTOMATION_WORKFLOWS','workflow_id',step.workflow_id);if(!wf||!_awfScope_(wf,session))throw new Error('Workflow не найден.');
    if(step.status==='COMPLETED')return _awfWorkflow_(wf,session);
    if(['OPEN','WAITING_APPROVAL','IN_PROGRESS','ESCALATED'].indexOf(wf.status)===-1)throw new Error('Workflow закрыт.');
    var stepResult=result||{};
    if(step.step_type==='APPROVAL'){
      var approved=approveAutomationDecision_(wf.decision_id,session);
      stepResult={approved:true,decisionId:wf.decision_id,result:approved.result||null};
    }
    updateRow_('AUTOMATION_WORKFLOW_STEPS',step,{status:'COMPLETED',completed_at:nowIso_(),attempts:Number(step.attempts||0)+1,result_json:JSON.stringify(stepResult)});
    var next=Number(step.step_no)+1, all=findRows_('AUTOMATION_WORKFLOW_STEPS',function(x){return x.workflow_id===wf.workflow_id;});
    var nextStep=all.filter(function(x){return Number(x.step_no)===next;})[0];
    if(nextStep){updateRow_('AUTOMATION_WORKFLOW_STEPS',nextStep,{status:'IN_PROGRESS',started_at:nowIso_()});updateRow_('AUTOMATION_WORKFLOWS',wf,{status:'IN_PROGRESS',current_step:next,updated_at:nowIso_()});}
    else updateRow_('AUTOMATION_WORKFLOWS',wf,{status:'COMPLETED',current_step:Number(step.step_no),updated_at:nowIso_(),completed_at:nowIso_()});
    auditLog_(session.user_id,'Завершён шаг automation workflow','AUTOMATION_WORKFLOW_STEPS:'+stepId,null,JSON.stringify(result||{}),'success',session.cascade_id||'');
    wf=findOne_('AUTOMATION_WORKFLOWS','workflow_id',wf.workflow_id);return _awfWorkflow_(wf,session);
  });
}
function runAutomationWorkflowSla_(session,limit){
  limit=Math.min(Number(limit||AWF_BATCH_LIMIT_),AWF_BATCH_LIMIT_);var now=nowIso_();
  var wfs=findRows_('AUTOMATION_WORKFLOWS',function(r){return _awfScope_(r,session)&&['OPEN','WAITING_APPROVAL','IN_PROGRESS','ESCALATED'].indexOf(r.status)>=0;});
  var escalated=0,overdue=0,checked=0;
  for(var i=0;i<wfs.length&&checked<limit;i++){checked++;var wf=wfs[i];var steps=findRows_('AUTOMATION_WORKFLOW_STEPS',function(x){return x.workflow_id===wf.workflow_id&&['PENDING','IN_PROGRESS'].indexOf(x.status)>=0;}).sort(function(a,b){return Number(a.step_no)-Number(b.step_no);});
    steps.forEach(function(st){if(String(st.due_at||'')<now){updateRow_('AUTOMATION_WORKFLOW_STEPS',st,{status:'OVERDUE',attempts:Number(st.attempts||0)+1,last_error:'SLA просрочен',});overdue++;}});
    if(String(wf.sla_due_at||'')<now&&wf.status!=='COMPLETED'){updateRow_('AUTOMATION_WORKFLOWS',wf,{status:'ESCALATED',updated_at:now,last_error:'SLA workflow просрочен'});escalated++;}
  }
  return {checked:checked,overdue_steps:overdue,escalated:escalated,at:now};
}
function automationWorkflowSlaStage27Trigger_(){
  try{getOrganizations_(null).forEach(function(org){(getLocations_(org.organization_id)||[]).forEach(function(loc){try{var s={user_id:'system',organization_id:org.organization_id,location_id:loc.location_id,role:'ADMIN','роль':'ADMIN',allowed_locations:[loc.location_id],cascade_id:'',operation_id:''};var r=withLock_(function(){return runAutomationWorkflowSla_(s,AWF_BATCH_LIMIT_);});if(r.escalated)notify_(org.organization_id,loc.location_id,'AUTOMATION_WORKFLOW','Эскалировано workflow: '+r.escalated,'awf27|'+loc.location_id+'|'+todayDateStr_());}catch(e){logSystemError_('automationWorkflowSlaStage27Trigger_',org.organization_id,'automation_workflow',e);}});});}catch(e){logSystemError_('automationWorkflowSlaStage27Trigger_',null,'automation_workflow',e);}
}
function runAutomationWorkflowStage27Tests_(){
  var out=[];function ok(n,c,d){out.push({name:n,status:c?'OK':'FAIL',detail:d||''});}
  ok('SCHEMA',Array.isArray(CONFIG.SCHEMA.AUTOMATION_WORKFLOWS)&&Array.isArray(CONFIG.SCHEMA.AUTOMATION_WORKFLOW_STEPS),'workflow schemas');
  ok('SHEETS',CONFIG.SHEETS.AUTOMATION_WORKFLOWS==='AUTOMATION_WORKFLOWS'&&CONFIG.SHEETS.AUTOMATION_WORKFLOW_STEPS==='AUTOMATION_WORKFLOW_STEPS','workflow sheets');
  ok('IDS',CONFIG.ID_PREFIXES.AUTOMATION_WORKFLOWS==='AWF'&&CONFIG.ID_PREFIXES.AUTOMATION_WORKFLOW_STEPS==='AWFS','workflow ids');
  ok('API',typeof createAutomationWorkflow_==='function'&&typeof completeAutomationWorkflowStep_==='function'&&typeof runAutomationWorkflowSla_==='function','workflow functions');
  ok('TRIGGER',getExpectedTriggerHandlers_().indexOf('automationWorkflowSlaStage27Trigger_')>=0,'trigger registered');
  ok('LIMIT',AWF_BATCH_LIMIT_===50,'batch bounded');
  ok('STATUSES',AWF_STATUSES_.indexOf('ESCALATED')>=0&&AWF_STEP_STATUSES_.indexOf('OVERDUE')>=0,'sla statuses');
  ok('RBAC',CONFIG.ACTION_MODULE.GET_AUTOMATION_WORKFLOWS==='dashboard'&&CONFIG.ACTION_MODULE.CREATE_AUTOMATION_WORKFLOW==='automation_approve','rbac contract');
  return out;
}
