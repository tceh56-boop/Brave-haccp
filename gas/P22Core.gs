// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * TSEKH P22 CORE HARDENING
 * Центральная оркестрация: PRIMARY OPERATION -> EVENT -> CASCADE -> DERIVED STATE.
 * Не заменяет существующие предметные контуры; координирует их и проверяет целостность.
 */
var P22_EVENT_TYPES = ['PRIMARY_OPERATION_RECORDED'];
var P22_RECOVERY_STATUSES = ['OPEN','RETRY_PENDING','RETRYING','RECOVERED','FAILED','MANUAL_ACTION_REQUIRED','CLOSED'];
var P22_OPERATION_STATUSES = ['CREATED','PROCESSING','COMPLETED','PARTIALLY_COMPLETED','FAILED','RECOVERY_REQUIRED','CANCELLED'];

function p22WithLock_(fn) { return withLock_(fn); }

function p22EnsurePrimaryEvent_(action, data, session, operationId, cascadeId, result) {
  var org = session ? session.organization_id : '';
  var loc = session ? session.location_id : '';
  var key = 'primary|' + operationId;
  var existing = findRows_('EVENTS', function(r){ return r.idempotency_key === key && r.organization_id === org && r.location_id === loc && r.type === 'PRIMARY_OPERATION_RECORDED'; })[0];
  if (existing) return existing;
  return emitEvent_({
    organizationId: org,
    locationId: loc,
    type: 'PRIMARY_OPERATION_RECORDED',
    source: 'processOperation',
    entityType: 'OPERATION',
    entityId: operationId,
    operationId: operationId,
    idempotencyKey: key,
    payload: { action: action, data: data || {}, cascade_id: cascadeId, result_hash: p22Hash_(JSON.stringify(result || {})) }
  });
}

function p22Hash_(value) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value || ''));
  return bytes.map(function(b){ var n=b<0?b+256:b; return ('0'+n.toString(16)).slice(-2); }).join('');
}

function p22ProcessPrimaryEvent_(event, session, context) {
  if (!event) return {status:'SKIPPED'};
  var payload = {};
  try { payload = JSON.parse(event.payload_json || '{}'); } catch(e) { logP22Error_(e,{module:'P22',functionName:'p22ProcessPrimaryEvent_',eventId:event.event_id,errorCode:'EVENT_PAYLOAD_INVALID',retryable:false}); throw new Error('EVENT_PAYLOAD_INVALID: ' + event.event_id); }
  var action = payload.action || '';
  var data = payload.data || {};
  var steps = [];
  // Existing contours remain the calculation owners. This layer invokes only their canonical APIs.
  if (['UPDATE_PRODUCT_PRICE','ADD_RECIPE_LINE','UPDATE_RECIPE','UPDATE_DISH'].indexOf(action) !== -1 && data.productId) {
    steps.push({name:'COSTING_PRODUCT', result: recalcFoodCostForProduct_(data.productId)});
  }
  if (['RECEIVE_GOODS','RECEIVE_GOODS_BATCH','CREATE_SALE','IMPORT_SALES_COMMIT','CREATE_WRITEOFF','CREATE_ADJUSTMENT_FROM_INVENTORY','CLOSE_INVENTORY','UPDATE_PRODUCT_PRICE','ADD_RECIPE_LINE','UPDATE_RECIPE','UPDATE_DISH','ADVANCE_PRODUCTION'].indexOf(action) !== -1) {
    if (session && session.organization_id && typeof recalcEconomics_ === 'function') {
      var alreadyEconomics=findRows_('CALCULATIONS',function(r){return r.cascade_id===session.cascade_id&&r.тип_расчёта==='экономика_сводная';});
      if (!alreadyEconomics.length) steps.push({name:'ECONOMICS', result: recalcEconomics_(session.organization_id, session.location_id, session.cascade_id)});
      else steps.push({name:'ECONOMICS', result:'ALREADY_CALCULATED_BY_SOURCE_CONTOUR'});
    }
  }
  steps.push({name:'AUDIT_LINK', result:{operation_id:event.operation_id || event.entity_id, event_id:event.event_id, cascade_id:context.cascadeId}});
  return {status:'COMPLETED', steps:steps};
}

function p22RunOrchestration_(action, data, session, operationId, cascadeId, result) {
  var event=null;
  try {
    event=p22EnsurePrimaryEvent_(action, data, session, operationId, cascadeId, result);
    if (typeof core100RecordStep_==='function') core100RecordStep_(operationId,cascadeId,'PRIMARY_EVENT','COMPLETED',{event_id:event.event_id},event.event_id);
    var orchestration=(typeof core100ProcessEvent_==='function')
      ? core100ProcessEvent_(event,session,{cascadeId:cascadeId})
      : (function(){var r=p22ProcessPrimaryEvent_(event,session,{cascadeId:cascadeId});markEventProcessed_(event.event_id);return {status:'COMPLETED',event:event,result:r};})();
    var p21links=(typeof p21LinkActualJournals_==='function')?p21LinkActualJournals_(event,session):[];
    orchestration.p21_journal_links=p21links;
    cascadeStep_(cascadeId,'EVENT_ORCHESTRATOR');
    return {status:'COMPLETED',event:orchestration.event||event,orchestration:orchestration};
  } catch(err) {
    // Первичная операция уже завершена. Ошибка здесь относится ТОЛЬКО к derived state.
    // Не бросаем её в processOperation: вместо ложного FAILED создаём recovery.
    var rec=null;
    try { rec=(typeof p22RecoveryCreate_==='function')?p22RecoveryCreate_(operationId,event?event.event_id:'',cascadeId,session,classifyErrorCode_(err),String(err&&err.message||err),true):null; } catch(re){ logP22Error_(re,{module:'P22',functionName:'p22RunOrchestration_',operationId:operationId,errorCode:'RECOVERY_CREATE_FAILED',retryable:false}); }
    if(event && typeof updateRow_==='function') {
      try { var ev=findOne_('EVENTS','event_id',event.event_id); if(ev && ev.status!=='FAILED') updateRow_('EVENTS',ev,{status:'FAILED',error_code:classifyErrorCode_(err),error_message:String(err&&err.message||err),failed_at:nowIso_()}); } catch(ignore) {}
    }
    if(rec && event) { try { var cr=findOne_('CASCADES','cascade_id',cascadeId); if(cr) updateRow_('CASCADES',cr,{event_id:event.event_id,recovery_id:rec.recovery_id,failure_class:'DERIVED_STATE',ошибка:String(err&&err.message||err),обновлено:nowIso_()}); } catch(ignore2) {} }
    logP22Error_(err,{module:'P22',functionName:'p22RunOrchestration_',operationId:operationId,eventId:event?event.event_id:'',organizationId:session?session.organization_id:'',locationId:session?session.location_id:'',userId:session?session.user_id:'',errorCode:classifyErrorCode_(err),retryable:true,recoveryStatus:'OPEN'});
    return {status:'RECOVERY_REQUIRED',event:event,message:String(err&&err.message||err),recovery:rec};
  }
}
/** Canonical event coverage report; legacy events remain visible as derived signals. */
function getP22Coverage_(organizationId, locationId) {
  var events = findRows_('EVENTS', function(r){ return r.organization_id===organizationId && (!locationId || r.location_id===locationId); });
  var operations = findRows_('OPERATIONS', function(r){ return r.organization_id===organizationId; });
  var byAction = {};
  operations.forEach(function(o){
    if (!byAction[o.action]) byAction[o.action]={action:o.action,operations:0,primary_events:0,processed:0,failed:0};
    byAction[o.action].operations++;
  });
  events.filter(function(e){return e.type==='PRIMARY_OPERATION_RECORDED';}).forEach(function(e){
    var p={}; try{p=JSON.parse(e.payload_json||'{}');}catch(x){ if(typeof logSystemError_==='function') logSystemError_('getP22Coverage_', null, 'invalid_event_payload', x); }
    var a=p.action||''; if(!byAction[a]) byAction[a]={action:a,operations:0,primary_events:0,processed:0,failed:0};
    byAction[a].primary_events++; if(e.status==='PROCESSED')byAction[a].processed++; else byAction[a].failed++;
  });
  return Object.keys(byAction).sort().map(function(k){var x=byAction[k];return {
    event_type:'PRIMARY_OPERATION_RECORDED', source_module:'processOperation', source_function:'p22RunOrchestration_',
    journal_type:'P21/derived', coverage_status:(x.operations===x.primary_events?'COVERED':'GAP'),
    dedup_status:x.primary_events<=x.operations?'OK':'DUPLICATE', audit_status:'LINKED', error_status:x.failed?'ERROR':'OK',
    action:x.action, operations:x.operations, primary_events:x.primary_events
  };});
}

function getP22CoverageReport_(session, data) { return getP22Coverage_(session.organization_id, resolveLocationScope_(session, data && data.locationId)); }

/** Read-only final gate: MUST NOT mutate business data. */
function getP22FinalGate_(session, data) {
  var checks=[];
  function check(id, ok, detail){checks.push({id:id,ok:!!ok,detail:detail||''});}
  var schemaOk=true; Object.keys(CONFIG.SCHEMA).forEach(function(k){if(!CONFIG.SCHEMA[k] || !CONFIG.SHEETS[k])schemaOk=false;});
  check('EVENT_ORCHESTRATOR', typeof p22RunOrchestration_==='function');
  check('EVENT_BUS', typeof emitEvent_==='function');
  check('CASCADE_ENGINE', typeof createCascade_==='function');
  check('IDEMPOTENCY', typeof claimOperation_==='function');
  var core100=(typeof getCore100InvariantReport_==='function')?getCore100InvariantReport_(session):{status:'NOT_READY',checks:[],blockers:['CORE100_MISSING']};
  check('CORE100_INVARIANTS', core100.status==='READY', core100);
  check('LOCKING', typeof withLock_==='function');
  check('RECOVERY', typeof p22RetryRecovery_==='function');
  check('ERROR_SERVICE', typeof logP22Error_==='function');
  var coverage=(typeof getP21CoverageReport_==='function')?getP21CoverageReport_(session,data||{}):getP22Coverage_(session.organization_id,session.location_id); check('P21_COVERAGE', coverage.every(function(x){return ['COVERED','NOT_REQUIRED','NO_EVENTS'].indexOf(x.coverage_status)!==-1; }), coverage);
  check('COSTING_ENGINE', typeof recalcFoodCostForProduct_==='function');
  check('WAREHOUSE', typeof _recordOp_==='function');
  check('FIFO_FEFO', typeof getAvailableBatches_==='function' || typeof getWarehouse_==='function');
  check('PRODUCTION', typeof advanceProductionStatus_==='function');
  check('SALES', typeof createSale_==='function');
  check('WRITEOFF', typeof createWriteOff_==='function');
  check('FINANCE', typeof recalcEconomics_==='function');
  check('P_AND_L', typeof recalcEconomics_==='function');
  check('CASH_FLOW', typeof recalcEconomics_==='function');
  check('HACCP', typeof addJournalEntry_==='function');
  check('AUDIT', typeof auditLog_==='function');
  check('MULTI_TENANT', typeof assertOwnedByOrg_==='function');
  check('RBAC', typeof userCanAccessModule_==='function');
  check('API_CONTRACT', typeof userSuccess_==='function' && typeof userError_==='function');
  check('DRIVE', typeof DriveApp!=='undefined');
  check('BACKUP', typeof createBackup_==='function');
  check('OCR', typeof runOcr_==='function' || typeof processOcr_==='function');
  check('E2E', typeof runP22E2EContract_==='function');
  check('CONCURRENCY', typeof runP22ConcurrencyContract_==='function');
  check('SECURITY', typeof runP22SecurityContract_==='function');
  check('DASHBOARD', typeof getDashboard_==='function');
  var safetyGate=(typeof getSafetyFinalGate_==='function')?getSafetyFinalGate_(session):{ready:false,failures:['SAFETY_MODULE_MISSING']};
  check('SAFETY_DOCUMENT_STORAGE', !!safetyGate.checks.document_storage);
  check('SAFETY_VERSIONING', !!safetyGate.checks.versioning);
  check('SAFETY_ASSIGNMENT_MATRIX', !!safetyGate.checks.assignment && !!safetyGate.checks.role_matrix && !!safetyGate.checks.employee_matrix);
  check('SAFETY_BRIEFING_TEST_CONFIRMATION', !!safetyGate.checks.briefing && !!safetyGate.checks.test_engine && !!safetyGate.checks.confirmation);
  check('SAFETY_AUDIT_EVENTS', !!safetyGate.checks.audit && !!safetyGate.checks.events);
  check('SAFETY_SECURITY_TENANCY', !!safetyGate.checks.security && !!safetyGate.checks.multi_tenant_isolation);
  check('SAFETY_MOBILE_REPORTS', !!safetyGate.checks.mobile_flow && !!safetyGate.checks.reports);
  check('SAFETY_E2E', !!safetyGate.checks.e2e);
  check('EMPLOYEE_POSITION_WORKSHOP_EQUIPMENT', typeof createPosition_==='function' && typeof updateEmployeeProfile_==='function' && typeof transferEmployee_==='function');
  check('EMPLOYEE_EQUIPMENT_PERMISSIONS', typeof getEmployeeEquipmentPermissions_==='function');
  check('EMPLOYEE_READINESS', typeof getEmployeeReadiness_==='function');
  check('CONFIG_SCHEMA', schemaOk);
  var failed=checks.filter(function(x){return !x.ok;});
  return {status:failed.length?'NOT_READY':'READY',checks:checks,blockers:failed.map(function(x){return x.id;}),read_only:true,generated_at:nowIso_()};
}

function p22RecoveryCreate_(operationId,eventId,cascadeId,session,errorCode,message,retryable) {
  var row={recovery_id:generateId_('P22_RECOVERY'),organization_id:session?session.organization_id:'',location_id:session?session.location_id:'',operation_id:operationId||'',event_id:eventId||'',cascade_id:cascadeId||'',status:'OPEN',error_code:errorCode||'INTERNAL_ERROR',message:String(message||''),retryable:!!retryable,attempt:0,created_at:nowIso_(),updated_at:nowIso_(),resolved_at:'',resolved_by:''};
  insertRow_('P22_RECOVERY',row); return row;
}
function p22RetryRecovery_(session,data) {
  return p22WithLock_(function(){
    var r=findOne_('P22_RECOVERY','recovery_id',data.recoveryId);
    assertOwnedByOrg_(session,r,'P22_RECOVERY:'+data.recoveryId);
    if(['OPEN','RETRY_PENDING','FAILED'].indexOf(r.status)===-1) throw new Error('RECOVERY_NOT_RETRYABLE');
    var op=findOne_('OPERATIONS','operation_id',r.operation_id); if(!op) throw new Error('Операция восстановления не найдена.');
    var event=r.event_id?findOne_('EVENTS','event_id',r.event_id):null;
    updateRow_('P22_RECOVERY',r,{status:'RETRYING',attempt:(Number(r.attempt)||0)+1,updated_at:nowIso_()});
    if(!event) {
      updateRow_('P22_RECOVERY',r,{status:'MANUAL_ACTION_REQUIRED',message:'Первичное событие отсутствует; безопасный автоматический replay невозможен.',updated_at:nowIso_()});
      throw new Error('RECOVERY_PRIMARY_EVENT_MISSING');
    }
    try {
      var out=core100ProcessEvent_(event,session,{cascadeId:r.cascade_id});
      var rr=findOne_('P22_RECOVERY','recovery_id',r.recovery_id);
      updateRow_('P22_RECOVERY',rr,{status:'RECOVERED',updated_at:nowIso_(),resolved_at:nowIso_(),resolved_by:session.user_id});
      var c=findOne_('CASCADES','cascade_id',r.cascade_id); if(c) updateRow_('CASCADES',c,{статус:'SUCCESS',ошибка:'',recovery_id:r.recovery_id,обновлено:nowIso_(),завершено:nowIso_()});
      var o=findOne_('OPERATIONS','operation_id',r.operation_id); if(o && o.статус==='RECOVERY_REQUIRED') updateRow_('OPERATIONS',o,{статус:'COMPLETED',error_code:'',обновлено:nowIso_(),завершено:nowIso_()});
      auditLog_(session.user_id,'Повторная обработка derived state','P22_RECOVERY:'+r.recovery_id,'RETRYING','RECOVERED','success',session.cascade_id);
      return findOne_('P22_RECOVERY','recovery_id',r.recovery_id);
    } catch(err) {
      var rf=findOne_('P22_RECOVERY','recovery_id',r.recovery_id);
      if(rf) updateRow_('P22_RECOVERY',rf,{status:'FAILED',message:String(err&&err.message||err),updated_at:nowIso_()});
      throw err;
    }
  });
}
function getP22Recovery_(session,data){return findRows_('P22_RECOVERY',function(r){return r.organization_id===session.organization_id&&(!data||!data.status||r.status===data.status)&&(!data||!data.locationId||r.location_id===resolveLocationScope_(session,data.locationId));});}

/** Centralized structured error record. */
function logP22Error_(err,ctx) {
  ctx=ctx||{}; var row={error_id:generateId_('P22_ERRORS'),timestamp:nowIso_(),severity:ctx.severity||'ERROR',module:ctx.module||'',function:ctx.functionName||'',operation_id:ctx.operationId||'',event_id:ctx.eventId||'',organization_id:ctx.organizationId||'',location_id:ctx.locationId||'',workshop_id:ctx.workshopId||'',user_id:ctx.userId||'',entity_type:ctx.entityType||'',entity_id:ctx.entityId||'',error_code:ctx.errorCode||'INTERNAL_ERROR',message:String(err&&err.message||err||''),stack:String(err&&err.stack||''),payload_hash:ctx.payloadHash||'',retryable:ctx.retryable===true,recovery_status:ctx.recoveryStatus||''};
  try { insertRow_('P22_ERRORS',row); } catch(e) { Logger.log('P22_ERRORS write failed: '+e); }
  return row;
}
function p22ErrorService_(err,ctx){return logP22Error_(err,ctx);}

/** Deployment checks are read-only. */
function healthCheck(){
  var checks=[]; function c(id,ok,detail){checks.push({id:id,ok:!!ok,detail:detail||''});}
  c('DATABASE',typeof getDatabase_==='function'); c('CONFIG',typeof CONFIG==='object'); c('API',typeof processOperation==='function');
  c('ENTRYPOINT_GET',typeof doGet==='function'); c('ENTRYPOINT_POST',typeof doPost==='function'); c('LOCK',typeof withLock_==='function');
  return {ok:checks.every(function(x){return x.ok;}),checks:checks,timestamp:nowIso_()};
}
function productionReadinessCheck(){return {health:healthCheck(),final_gate:'call getP22FinalGate_ with authenticated session; this function is intentionally read-only',irreversible_actions:false};}
function deploymentChecklist(){return ['Script deployment','Web app / doGet / doPost','OAuth scopes','PropertiesService secrets','Drive access','Sheets access','triggers','quotas/timeouts','backup','logging','recovery','multi-tenant','RBAC','API contract','UI'].map(function(x){return {item:x,status:'CHECK_REQUIRED'};});}
function initializeProductionEnvironment(){return {status:'CHECK_ONLY',message:'Инициализация не выполняет необратимых действий. Используйте deploymentChecklist/productionReadinessCheck перед ручным deployment.',irreversible_actions:false};}

/** Contract helpers: deterministic, side-effect free checks over supplied state. */
function runP22E2EContract_(fixture){
  fixture=fixture||{}; var a=fixture.receipt||{}, p=fixture.production||{}, s=fixture.sale||{};
  var checks=[
    {id:'RECEIPT_VALUE',ok:Math.abs((Number(a.qty)||0)*(Number(a.price)||0)-(Number(a.value)||0))<0.001},
    {id:'STOCK_AFTER_PRODUCTION',ok:Math.abs((Number(a.qty)||0)-(Number(p.consumed)||0)-(Number(p.remaining)||0))<0.001},
    {id:'SALE_REVENUE',ok:Math.abs((Number(s.qty)||0)*(Number(s.price)||0)-(Number(s.revenue)||0))<0.001},
    {id:'GROSS_PROFIT',ok:Math.abs((Number(s.revenue)||0)-(Number(s.cogs)||0)-(Number(s.grossProfit)||0))<0.001}
  ]; return {ok:checks.every(function(x){return x.ok;}),checks:checks};
}
function runP22ConcurrencyContract_(fixture){
  fixture=fixture||{}; return {ok:Number(fixture.operations||0)===1&&Number(fixture.events||0)===1&&Number(fixture.batches||0)===1&&Number(fixture.movements||0)===1&&Number(fixture.journalLinks||0)===1,expected:{operations:1,events:1,batches:1,movements:1,journalLinks:1},actual:fixture};
}
function runP22SecurityContract_(fixture){
  fixture=fixture||{}; return {ok:[fixture.crossOrgBlocked,fixture.crossLocationBlocked,fixture.roleBlocked,fixture.auditDeleteBlocked].every(function(x){return x===true;}),checks:fixture};
}
