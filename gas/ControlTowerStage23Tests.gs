/** Stage 23 static/regression contract checks. Read-only. */
function runStage23Regression_(){
  var checks=[];
  function ok(name,condition,detail){checks.push({name:name,status:condition?'OK':'FAIL',detail:detail||''});}
  ok('CONTROL_TOWER_HANDLER',typeof getControlTower_==='function','getControlTower_ доступен');
  ok('CONTROL_TOWER_TRIGGER',typeof controlTowerStage23Trigger_==='function','controlTowerStage23Trigger_ доступен');
  ok('API_ACTION',!!ACTION_HANDLERS.GET_CONTROL_TOWER,'GET_CONTROL_TOWER зарегистрирован в API');
  ok('RBAC_ACTION',CONFIG.ACTION_MODULE.GET_CONTROL_TOWER==='dashboard','GET_CONTROL_TOWER использует dashboard module');
  ok('NOTIFICATION_TYPE',CONFIG.NOTIFICATION_TYPES.CONTROL_TOWER==='CONTROL_TOWER','Тип уведомления зарегистрирован');
  ok('TRIGGER_EXPECTED',getExpectedTriggerHandlers_().indexOf('controlTowerStage23Trigger_')!==-1,'Триггер входит в единый контракт Deploy');
  ok('MAIN_TRIGGER_HANDLER_COUNT',getExpectedTriggerHandlers_().length===15,'Всего ожидается 15 триггерных обработчиков');
  return {ok:checks.every(function(x){return x.status==='OK';}),checks:checks};
}
