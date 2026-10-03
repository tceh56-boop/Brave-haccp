/** Stage 24 static/regression contract checks. Read-only. */
function runStage24Regression_(){
  var checks=[];
  function ok(name,condition,detail){checks.push({name:name,status:condition?'OK':'FAIL',detail:detail||''});}
  ok('COPILOT_HANDLER',typeof getOperationsCopilot_==='function','getOperationsCopilot_ доступен');
  ok('API_ACTION',!!ACTION_HANDLERS.AI_COPILOT,'AI_COPILOT зарегистрирован в API');
  ok('RBAC_ACTION',CONFIG.ACTION_MODULE.AI_COPILOT==='ai','AI_COPILOT использует существующий ai module');
  ok('NO_MUTATION_PATH',String(getOperationsCopilot_).indexOf('insertRow_')===-1 && String(getOperationsCopilot_).indexOf('updateRow_')===-1,'Copilot не содержит прямых mutation-вызовов');
  ok('SOURCE_OBJECTS',String(getOperationsCopilot_).indexOf('sources')!==-1,'Ответ содержит источники фактов');
  ok('CONTROL_TOWER_REUSE',String(getOperationsCopilot_).indexOf('getControlTower_')!==-1,'Использует единый Control Tower');
  ok('ROUND_NUM_HELPER',typeof _ai24num_==='function','Числовой helper доступен');
  return {ok:checks.every(function(x){return x.status==='OK';}),checks:checks};
}
