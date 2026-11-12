/**
 * MON CHEF V6 — Operational Automation
 *
 * Автоматический контроль срока годности:
 * активная партия с истёкшим сроком получает FACT -> Rule Engine -> отклонение /
 * корректирующее действие -> адресную блокировку. Партия не списывается молча.
 * Повторный цикл не плодит события, пока на партии уже есть активная блокировка.
 */
var MC_CONTROL_LOG_SHEET = 'CONTROL_CYCLE';

function _mcControlLogSheet_() {
  return _mcFullEnsureSheet_(MC_CONTROL_LOG_SHEET, [
    'EventID','ControlType','ObjectType','ObjectID','BatchID','FactID','CreatedAt','CreatedBy','Status','Message'
  ]);
}

function _mcControlAlreadyHandled_(batchId, controlType) {
  var sh = _mcControlLogSheet_(), v = sh.getDataRange().getValues();
  for (var i=1;i<v.length;i++) {
    if (String(v[i][1])===String(controlType) && String(v[i][4])===String(batchId) && String(v[i][8])==='OK') return true;
  }
  return false;
}

function _mcRecordControlEvent_(type, objectType, objectId, batchId, factId, actor, status, message) {
  _mcControlLogSheet_().appendRow([
    'CTL-'+Utilities.getUuid(), type || '', objectType || '', objectId || '', batchId || '',
    factId || '', new Date(), actor ? _mcSessionFullName_(actor) : 'SYSTEM', status || 'OK', message || ''
  ]);
}

function runMonChefControlCycle(token) {
  try {
    var actor = token ? _requireAuth_(token, 'journals') : null;
    var sh = _stockBatchesSheet_(), v = sh.getDataRange().getValues();
    var scanned=0, handled=0, skipped=0, errors=[];
    var now = new Date();
    for (var i=1;i<v.length;i++) {
      var row=v[i], batchId=String(row[0]||''), remain=parseFloat(row[9])||0, status=String(row[10]||'active');
      if (!batchId || remain<=0 || status!=='active') continue;
      var expiry=row[5];
      if (!expiry) continue;
      var exp = expiry instanceof Date ? expiry : new Date(expiry);
      if (isNaN(exp.getTime()) || exp >= now) continue;
      scanned++;
      if (typeof _mcIsObjectBlocked_==='function' && _mcIsObjectBlocked_('BATCH',batchId)) { skipped++; continue; }
      if (_mcControlAlreadyHandled_(batchId,'SHELF_LIFE_EXPIRED')) { skipped++; continue; }
      try {
        var fact = {
          factType:'SHELF_LIFE_EXPIRED', objectType:'BATCH', objectId:batchId,
          operationType:'AUTOMATED_CONTROL', dateTime:now, value:remain, unit:row[2]||'',
          result:'ОТКЛОНЕНИЕ', source:'CONTROL_CYCLE', batchId:batchId,
          critical:true, shelfLifeExpired:true,
          description:'Истёк срок годности партии '+batchId+'; остаток '+remain+' '+(row[2]||'')
        };
        var created = _mcCreateFactInternal_(fact, actor);
        _mcRecordControlEvent_('SHELF_LIFE_EXPIRED','BATCH',batchId,batchId,created.factId,actor,'OK',fact.description);
        handled++;
      } catch (e) {
        errors.push(batchId+': '+String(e));
        try { _mcRecordControlEvent_('SHELF_LIFE_EXPIRED','BATCH',batchId,batchId,'',actor,'ERROR',String(e)); } catch(ignore) {}
      }
    }
    return coreOk({scanned:scanned,handled:handled,skipped:skipped,errors:errors.slice(0,50),runAt:now,actor:actor?_mcSessionFullName_(actor):'SYSTEM'});
  } catch(e) { return coreErr('CONTROL_CYCLE_ERROR',String(e)); }
}

function runMonChefControlCycleSystem() {
  return runMonChefControlCycle(null);
}

function installMonChefControlTrigger(token, everyMinutes) {
  try {
    var s=_requireAuth_(token,'audit_create');
    var mins=Number(everyMinutes)||60;
    mins=Math.max(15,Math.min(mins,360));
    ScriptApp.getProjectTriggers().forEach(function(t){
      if(t.getHandlerFunction()==='runMonChefControlCycleSystem') ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger('runMonChefControlCycleSystem').timeBased().everyMinutes(mins).create();
    return coreOk({installed:true,everyMinutes:mins,installedBy:_mcSessionFullName_(s)});
  } catch(e) { return coreErr('CONTROL_TRIGGER_ERROR',String(e)); }
}

function removeMonChefControlTrigger(token) {
  try {
    var s=_requireAuth_(token,'audit_create');
    var removed=0;
    ScriptApp.getProjectTriggers().forEach(function(t){
      if(t.getHandlerFunction()==='runMonChefControlCycleSystem'){ScriptApp.deleteTrigger(t);removed++;}
    });
    return coreOk({removed:removed,removedBy:_mcSessionFullName_(s)});
  } catch(e) { return coreErr('CONTROL_TRIGGER_REMOVE_ERROR',String(e)); }
}
