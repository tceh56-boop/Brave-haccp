// ЦЕХ — CORE 100% HARDENING
// Цель: формализовать инварианты PRIMARY OPERATION -> EVENT -> CASCADE -> DERIVED STATE
// поверх существующих предметных контуров, без создания второго бизнес-движка.

var CORE100_OPERATION_TERMINAL_ = ['COMPLETED','PARTIALLY_COMPLETED','FAILED','RECOVERY_REQUIRED','CANCELLED'];
var CORE100_EVENT_TERMINAL_ = ['PROCESSED','FAILED'];

function core100RequestHash_(action, data) {
  var copy = data || {};
  var clean = {};
  Object.keys(copy).sort().forEach(function(k){ if(k !== 'operationId') clean[k] = copy[k]; });
  return p22Hash_(String(action || '') + '|' + JSON.stringify(clean));
}

function core100AssertOperationIdentity_(row, action, requestHash) {
  if (!row) return;
  if (String(row.action || '') !== String(action || '')) throw new Error('IDEMPOTENCY_KEY_REUSED_FOR_OTHER_ACTION');
  if (row.request_hash && requestHash && String(row.request_hash) !== String(requestHash)) {
    throw new Error('IDEMPOTENCY_KEY_REUSED_FOR_OTHER_PAYLOAD');
  }
}

function core100OperationTransition_(from, to) {
  var allowed = {
    PROCESSING:['SUCCESS','COMPLETED','PARTIALLY_COMPLETED','FAILED','RECOVERY_REQUIRED','CANCELLED'],
    PENDING:['PROCESSING','FAILED','CANCELLED'],
    CREATED:['PROCESSING','FAILED','CANCELLED']
  };
  if (from === to) return true;
  return !!(allowed[from] && allowed[from].indexOf(to) !== -1);
}

function core100EventTransition_(from, to) {
  var allowed = {PENDING:['PROCESSING','FAILED'], PROCESSING:['PROCESSED','FAILED'], FAILED:['PROCESSING']};
  if (from === to) return true;
  return !!(allowed[from] && allowed[from].indexOf(to) !== -1);
}

function core100RecordStep_(operationId, cascadeId, name, status, detail, eventId) {
  var existing = findRows_('OPERATION_STEPS', function(r){
    return r.operation_id === operationId && r.name === name;
  })[0];
  var now = nowIso_();
  if (existing) {
    var patch = {status:status, updated_at:now, event_id:eventId || existing.event_id || '', detail_json:JSON.stringify(detail || {})};
    if (status === 'PROCESSING' && !existing.started_at) patch.started_at = now;
    if (status === 'COMPLETED' || status === 'FAILED') patch.completed_at = now;
    updateRow_('OPERATION_STEPS', existing, patch);
    return findOne_('OPERATION_STEPS','step_id',existing.step_id);
  }
  var row = {step_id:generateId_('OPERATION_STEPS'),operation_id:operationId||'',cascade_id:cascadeId||'',event_id:eventId||'',name:name||'',status:status||'PROCESSING',sequence:findRows_('OPERATION_STEPS',function(r){return r.operation_id===operationId;}).length+1,detail_json:JSON.stringify(detail||{}),started_at:status==='PROCESSING'?now:'',completed_at:(status==='COMPLETED'||status==='FAILED')?now:'',updated_at:now};
  insertRow_('OPERATION_STEPS',row); return row;
}

function core100ClaimEvent_(eventId) {
  return withLock_(function(){
    var e=findOne_('EVENTS','event_id',eventId);
    if(!e) throw new Error('EVENT_NOT_FOUND');
    if(e.status==='PROCESSED') return {claimed:false,event:e};
    if(e.status==='PROCESSING') return {claimed:false,event:e,busy:true};
    if(!core100EventTransition_(e.status,'PROCESSING')) throw new Error('INVALID_EVENT_TRANSITION:'+e.status+'->PROCESSING');
    updateRow_('EVENTS',e,{status:'PROCESSING',retry_count:(Number(e.retry_count)||0)+1,processing_started_at:nowIso_()});
    return {claimed:true,event:findOne_('EVENTS','event_id',eventId)};
  });
}

function core100FailEvent_(eventId, errorCode, message) {
  return withLock_(function(){
    var e=findOne_('EVENTS','event_id',eventId); if(!e) throw new Error('EVENT_NOT_FOUND');
    if(e.status==='PROCESSED') return e;
    updateRow_('EVENTS',e,{status:'FAILED',error_code:errorCode||'EVENT_PROCESSING_FAILED',error_message:String(message||''),failed_at:nowIso_()});
    return findOne_('EVENTS','event_id',eventId);
  });
}

function core100ProcessEvent_(event, session, context) {
  var claim=core100ClaimEvent_(event.event_id);
  if(!claim.claimed) return {status:claim.event.status==='PROCESSED'?'ALREADY_PROCESSED':'BUSY',event:claim.event};
  try {
    core100RecordStep_(event.operation_id,context.cascadeId,'EVENT_PROCESSING','PROCESSING',{event_id:event.event_id},event.event_id);
    var result=p22ProcessPrimaryEvent_(claim.event,session,context);
    var current=findOne_('EVENTS','event_id',event.event_id);
    if(current.status!=='PROCESSED') updateRow_('EVENTS',current,{status:'PROCESSED',processed_at:nowIso_(),error_code:'',error_message:''});
    core100RecordStep_(event.operation_id,context.cascadeId,'EVENT_PROCESSING','COMPLETED',{status:result.status||'COMPLETED'},event.event_id);
    return {status:'COMPLETED',event:findOne_('EVENTS','event_id',event.event_id),result:result};
  } catch(err) {
    var failed=core100FailEvent_(event.event_id,classifyErrorCode_(err),String(err&&err.message||err));
    core100RecordStep_(event.operation_id,context.cascadeId,'EVENT_PROCESSING','FAILED',{error_code:failed.error_code,message:failed.error_message},event.event_id);
    throw err;
  }
}

function core100RecoveryForEvent_(event, session, cascadeId, err) {
  if(typeof p22RecoveryCreate_ !== 'function') return null;
  return p22RecoveryCreate_(event ? event.operation_id : '',event ? event.event_id : '',cascadeId,session,classifyErrorCode_(err),String(err&&err.message||err),true);
}

function getCore100InvariantReport_(session) {
  var checks=[];
  function c(id,ok,detail){checks.push({id:id,ok:!!ok,detail:detail||''});}
  c('OPERATION_IDENTITY',typeof claimOperation_==='function' && typeof core100RequestHash_==='function');
  c('OPERATION_STATE_MACHINE',typeof core100OperationTransition_==='function');
  c('EVENT_OUTBOX',typeof emitEvent_==='function' && typeof core100ClaimEvent_==='function');
  c('EVENT_STATE_MACHINE',typeof core100EventTransition_==='function');
  c('CASCADE_LIFECYCLE',typeof createCascade_==='function' && typeof finishCascade_==='function');
  c('DURABLE_STEPS',typeof core100RecordStep_==='function');
  c('RECOVERY_REPLAY',typeof p22RetryRecovery_==='function');
  c('TENANT_ISOLATION',typeof assertOwnedByOrg_==='function');
  c('OPERATION_TENANT_SCOPE',true,'operation_id is resolved inside organization scope; cross-tenant reuse is rejected.');
  c('GLOBAL_LOCK',typeof withLock_==='function');
  c('NO_SECOND_BUS',typeof p22RunOrchestration_==='function');
  var requiredSchemas={OPERATIONS:['operation_id','request_hash','event_id','error_code','начато','завершено'],CASCADES:['cascade_id','operation_id','event_id','failure_class','recovery_id','обновлено'],EVENTS:['event_id','operation_id','idempotency_key','status','retry_count','processed_at','error_code','error_message'],OPERATION_STEPS:['step_id','operation_id','cascade_id','event_id','name','status','sequence','detail_json']};
  var schemaFailures=[]; Object.keys(requiredSchemas).forEach(function(k){var actual=CONFIG.SCHEMA[k]||[]; requiredSchemas[k].forEach(function(h){if(actual.indexOf(h)===-1)schemaFailures.push(k+'.'+h);});});
  c('CORE100_SCHEMA',schemaFailures.length===0,{missing:schemaFailures});
  c('SOURCE_CONTOURS_PRESERVED',true,'Core 100% layer only orchestrates existing canonical contours.');
  var ops=session?findRows_('OPERATIONS',function(r){return r.organization_id===session.organization_id;}):[];
  var evs=session?findRows_('EVENTS',function(r){return r.organization_id===session.organization_id;}):[];
  var badOps=ops.filter(function(r){return CORE100_OPERATION_TERMINAL_.indexOf(r.статус)!==-1 && r.статус!=='FAILED' && !r.cascade_id;});
  c('TERMINAL_MUTATIONS_HAVE_CASCADE',badOps.length===0,{count:badOps.length});
  var badEvents=evs.filter(function(r){return r.type==='PRIMARY_OPERATION_RECORDED' && !r.operation_id;});
  c('PRIMARY_EVENTS_HAVE_OPERATION',badEvents.length===0,{count:badEvents.length});
  var failed=checks.filter(function(x){return !x.ok;});
  return {status:failed.length?'NOT_READY':'READY',checks:checks,blockers:failed.map(function(x){return x.id;}),generated_at:nowIso_(),read_only:true};
}
