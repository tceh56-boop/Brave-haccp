/** Stage 25 static contract tests. */
function runAutomationDecisionStage25Tests(){
  var out=[]; function ok(n,c,d){out.push({name:n,status:c?'OK':'FAIL',detail:d||''});}
  ok('SCHEMA',Array.isArray(CONFIG.SCHEMA.AUTOMATION_DECISIONS)&&CONFIG.SCHEMA.AUTOMATION_DECISIONS.indexOf('decision_id')>=0,'AUTOMATION_DECISIONS schema');
  ok('SHEET',CONFIG.SHEETS.AUTOMATION_DECISIONS==='AUTOMATION_DECISIONS','sheet registered');
  ok('ID_PREFIX',CONFIG.ID_PREFIXES.AUTOMATION_DECISIONS==='AUTO','ID prefix registered');
  ok('API_GET',!!ACTION_HANDLERS.GET_AUTOMATION_DECISIONS,'GET registered');
  ok('API_RUN',!!ACTION_HANDLERS.RUN_AUTOMATION_DECISIONS,'RUN registered');
  ok('API_APPROVE',!!ACTION_HANDLERS.APPROVE_AUTOMATION_DECISION,'APPROVE registered');
  ok('API_REJECT',!!ACTION_HANDLERS.REJECT_AUTOMATION_DECISION,'REJECT registered');
  ok('RBAC_GET',CONFIG.ACTION_MODULE.GET_AUTOMATION_DECISIONS==='dashboard','GET uses dashboard');
  ok('RBAC_APPROVE',CONFIG.ACTION_MODULE.APPROVE_AUTOMATION_DECISION==='economics','approval uses economics');
  ok('TRIGGER',getExpectedTriggerHandlers_().indexOf('runAutomationDecisionTrigger_')>=0,'trigger registered');
  ok('SAFE_ACTIONS',_ad25ActionAllowed_('CREATE_TASK')&&_ad25ActionAllowed_('CREATE_PURCHASE_REQUEST')&&!_ad25ActionAllowed_('RECORD_CASH_TRANSACTION'),'only whitelisted actions');
  return out;
}
