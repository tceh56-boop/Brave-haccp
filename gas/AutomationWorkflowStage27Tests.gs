function runAutomationWorkflowStage27StaticTests_(){
  var out=[];function ok(n,c,d){out.push({name:n,status:c?'OK':'FAIL',detail:d||''});}
  ok('SCHEMA',Array.isArray(CONFIG.SCHEMA.AUTOMATION_WORKFLOWS)&&CONFIG.SCHEMA.AUTOMATION_WORKFLOWS.length===12&&Array.isArray(CONFIG.SCHEMA.AUTOMATION_WORKFLOW_STEPS)&&CONFIG.SCHEMA.AUTOMATION_WORKFLOW_STEPS.length===16,'workflow schemas registered');
  ok('SHEETS',CONFIG.SHEETS.AUTOMATION_WORKFLOWS==='AUTOMATION_WORKFLOWS'&&CONFIG.SHEETS.AUTOMATION_WORKFLOW_STEPS==='AUTOMATION_WORKFLOW_STEPS','workflow sheets registered');
  ok('PREFIX',CONFIG.ID_PREFIXES.AUTOMATION_WORKFLOWS==='AWF'&&CONFIG.ID_PREFIXES.AUTOMATION_WORKFLOW_STEPS==='AWFS','workflow prefixes registered');
  ok('API_READ',CONFIG.ACTION_MODULE.GET_AUTOMATION_WORKFLOWS==='dashboard','workflow read permission');
  ok('API_WRITE',CONFIG.ACTION_MODULE.CREATE_AUTOMATION_WORKFLOW==='automation_approve'&&CONFIG.ACTION_MODULE.COMPLETE_AUTOMATION_WORKFLOW_STEP==='automation_approve','workflow write permission');
  ok('SLA_API',CONFIG.ACTION_MODULE.RUN_AUTOMATION_WORKFLOW_SLA==='dashboard','SLA trigger permission');
  ok('TRIGGER',getExpectedTriggerHandlers_().indexOf('automationWorkflowSlaStage27Trigger_')>=0,'SLA trigger registered');
  ok('IDEMPOTENCY',typeof _awfScope_==='function'&&typeof _awfDecision_==='function','scope helpers available');
  ok('APPROVAL_BRIDGE',String(completeAutomationWorkflowStep_).indexOf('approveAutomationDecision_')>=0,'approval step delegates to Stage25');
  ok('NO_DIRECT_MONEY',String(completeAutomationWorkflowStep_).indexOf('createPurchaseRequest_')===-1,'workflow does not bypass Stage25 purchase approval');
  ok('BOUNDED',AWF_BATCH_LIMIT_===50,'bounded SLA batch');
  return out;
}
