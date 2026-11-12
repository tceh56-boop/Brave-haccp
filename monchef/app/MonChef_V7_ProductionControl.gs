/**
 * MON CHEF V7 — Production Control & One-Shot Operational Control
 *
 * Цель: довести контур до состояния «операция -> факт -> трасса -> ККТ ->
 * отклонение -> корректирующее действие -> подпись -> пакет проверки».
 * Все контрольные пределы берутся из уже настроенных карт/расписаний; код не
 * придумывает фактические измерения и не подменяет подпись сотрудника.
 */
var MC_V7_CONTROL_LOG = 'V7_CONTROL_EVENTS';

function _mcV7ControlSheet_(){
  return _mcFullEnsureSheet_(MC_V7_CONTROL_LOG,[
    'EventID','ControlType','ObjectType','ObjectID','BatchID','Severity','Status','Message','FactID','CreatedAt','CreatedBy','Hash'
  ]);
}
function _mcV7ControlEvent_(type,objType,objId,batchId,severity,status,message,factId,actor){
  var id='V7-'+Utilities.getUuid(), now=new Date();
  var name=actor?_mcSessionFullName_(actor):'SYSTEM';
  var hash=_mcHashText_(JSON.stringify([id,type,objType,objId,batchId,severity,status,message,factId,String(now)]));
  _mcV7ControlSheet_().appendRow([id,type||'',objType||'',objId||'',batchId||'',severity||'INFO',status||'OK',message||'',factId||'',now,name,hash]);
  return id;
}

function _mcV7ProductionRows_(){
  var sh=_productionSheet_(), v=sh.getDataRange().getValues(), out=[];
  for(var i=1;i<v.length;i++) if(v[i][0]) out.push({row:i+1,id:v[i][0],operationId:v[i][1],name:v[i][2],code:v[i][3],ttkVersion:v[i][4],planned:Number(v[i][5])||0,actual:v[i][6]===''?null:Number(v[i][6]),unit:v[i][7],employee:v[i][9],start:v[i][10],finish:v[i][11],status:v[i][12],batch:v[i][14],comment:v[i][16]});
  return out;
}

function _mcV7JournalRows_(journalId){
  var j=(JOURNALS||[]).filter(function(x){return x.id===journalId;})[0]; if(!j) return [];
  var sh=_book_().getSheetByName(j.sheetName); if(!sh) return [];
  var v=sh.getDataRange().getValues(), out=[];
  for(var i=1;i<v.length;i++) if(v[i].some(function(x){return x!==''&&x!=null;})) out.push({row:i+1,values:v[i]});
  return out;
}
function _mcV7JournalHasBatch_(journalId,batchId){
  if(!batchId) return false;
  var j=(JOURNALS||[]).filter(function(x){return x.id===journalId;})[0]; if(!j) return false;
  var sh=_book_().getSheetByName(j.sheetName); if(!sh) return false;
  var v=sh.getDataRange().getDisplayValues(), cols=j.columns||[], bi=-1;
  for(var c=0;c<cols.length;c++) if(/партия/i.test(String(cols[c]))) {bi=c;break;}
  if(bi<0) return false;
  for(var r=1;r<v.length;r++) if(String(v[r][bi])===String(batchId)) return true;
  return false;
}

function syncMonChefProductionTrace(token){
  try{
    var actor=token?_requireAuth_(token,'kanban'):null, added=0;
    var rows=_mcV7ProductionRows_();
    rows.forEach(function(p){
      if(p.batch){
        var before=_mcTraceSheet_().getLastRow();
        _mcCreateTraceLink_('PRODUCTION',String(p.id),'ВЫПУСК','BATCH',String(p.batch),{dateTime:p.finish||p.start||new Date(),actor:p.employee||'',source:'Производство'});
        if(p.code) _mcCreateTraceLink_('PRODUCTION',String(p.id),'ПО_ТТК','TTK',String(p.code),{dateTime:p.finish||p.start||new Date(),actor:p.employee||'',source:'Производство'});
        if(p.operationId) _mcCreateTraceLink_('OPERATION',String(p.operationId),'ВЫПОЛНИЛА','PRODUCTION',String(p.id),{dateTime:p.finish||p.start||new Date(),actor:p.employee||'',source:'Операции'});
        added += Math.max(0,_mcTraceSheet_().getLastRow()-before);
      }
    });
    return coreOk({productionRows:rows.length,linksAdded:added});
  }catch(e){return coreErr('V7_TRACE_SYNC_ERROR',String(e));}
}

function getProductionTrace(productionId,token){
  try{_requireAuth_(token,'kanban'); if(!productionId)return coreErr('PRODUCTION_REQUIRED','Укажите производство');
    return coreOk({root:{type:'PRODUCTION',id:String(productionId)},forward:_mcTraceGraph_('PRODUCTION',productionId,'forward',16),reverse:_mcTraceGraph_('PRODUCTION',productionId,'reverse',16)});
  }catch(e){return coreErr('V7_PRODUCTION_TRACE_ERROR',String(e));}
}

function getBatchFullTrace(batchId,token){
  try{_requireAuth_(token,'journals'); if(!batchId)return coreErr('BATCH_REQUIRED','Укажите партию');
    var stock=null; try{var a=JSON.parse(getStockBatches(false));stock=a.filter(function(x){return String(x.id)===String(batchId);})[0]||null;}catch(ignore){}
    return coreOk({batch:stock,forward:_mcTraceGraph_('BATCH',batchId,'forward',20),reverse:_mcTraceGraph_('BATCH',batchId,'reverse',20)});
  }catch(e){return coreErr('V7_BATCH_TRACE_ERROR',String(e));}
}

function _mcV7OpenDeviation_(type,objId,batchId,message,critical,actor){
  var f={factType:type,objectType:batchId?'BATCH':'CONTROL',objectId:objId||batchId||'',operationType:'CONTROL_CYCLE',dateTime:new Date(),value:'',unit:'',result:'ОТКЛОНЕНИЕ',source:'V7_CONTROL',batchId:batchId||'',critical:!!critical,description:message,skipRules:true};
  var fr=_mcCreateFactInternal_(f,actor);
  var ev=_mcEvaluateFactRulesV5_(Object.assign({},f,fr),actor,type);
  if(ev && ev.actions && ev.actions.length) _mcRecordRuleEvent_(Object.assign({},f,fr),type,ev,actor);
  return {factId:fr.factId,deviationId:ev.deviationId||'',correctiveActionId:ev.correctiveActionId||'',blockId:ev.blockId||''};
}

function runMonChefProductionControlCycle(token){
  try{
    var actor=token?_requireAuth_(token,'journals'):null;
    generateJournalPending();
    checkPendingOverdue();
    syncMonChefProductionTrace(token||null);
    var rows=_mcV7ProductionRows_(), checked=0, gaps=[], duplicates={};
    rows.forEach(function(p){
      if(p.status!=='COMPLETED'||!p.batch) return;
      checked++;
      var cct=null; try{cct=_cctFor_(p.code);}catch(ignore){}
      if(!cct) return;
      var req=[]; if(cct.тепловая)req.push('J22'); if(cct.охлаждение)req.push('J23'); if(cct.разогрев)req.push('J24');
      req.forEach(function(jid){
        if(_mcV7JournalHasBatch_(jid,p.batch)) return;
        var key=jid+'|'+p.batch;
        if(duplicates[key])return; duplicates[key]=true;
        var msg='После выпуска партии '+p.batch+' по ТТК '+p.code+' отсутствует подтверждение '+((JOURNALS||[]).filter(function(x){return x.id===jid;})[0]||{name:jid}).name+'.';
        var critical=true, handled=false;
        try{handled=_mcV7ControlAlready_(key);}catch(ignore2){}
        if(!handled){
          var ids=_mcV7OpenDeviation_('MISSING_CCP_CONFIRMATION',p.id,p.batch,msg,critical,actor);
          _mcV7ControlEvent_('MISSING_CCP_CONFIRMATION','BATCH',p.batch,p.batch,'CRITICAL','APPLIED',msg,ids.factId,actor);
          gaps.push({productionId:p.id,batchId:p.batch,journalId:jid,message:msg,ids:ids});
        }
      });
    });
    return coreOk({checkedProductions:checked,gaps:gaps,runAt:new Date()});
  }catch(e){return coreErr('V7_PRODUCTION_CONTROL_ERROR',String(e));}
}
function _mcV7ControlAlready_(key){
  var v=_mcV7ControlSheet_().getDataRange().getValues();
  for(var i=1;i<v.length;i++) if(String(v[i][1])==='MISSING_CCP_CONFIRMATION' && String(v[i][3])===String(key) && String(v[i][6])==='APPLIED') return true;
  // compatibility: key can be journal|batch; search message is safer than inventing a new schema
  for(var j=1;j<v.length;j++) if(String(v[j][1])==='MISSING_CCP_CONFIRMATION' && String(v[j][7]).indexOf(String(key).split('|')[1])>=0 && String(v[j][6])==='APPLIED') return true;
  return false;
}

function getMonChefOperationalDashboard(token){
  try{
    _requireAuth_(token,'journals');
    var prod=_mcV7ProductionRows_(), active=prod.filter(function(x){return x.status==='IN_PROGRESS'||x.status==='PLANNED';}).length;
    var completed=prod.filter(function(x){return x.status==='COMPLETED';}).length;
    var blocks=JSON.parse(getBlocks(token)).data||[]; var activeBlocks=blocks.filter(function(x){return x.status==='ACTIVE';});
    var dev=[]; try{var dv=_devSheet_().getDataRange().getValues();for(var i=1;i<dv.length;i++)if(dv[i][0]&&String(dv[i][7])!=='устранено'&&String(dv[i][7])!=='закрыто')dev.push({id:dv[i][0],journal:dv[i][2],object:dv[i][3],fact:dv[i][4],critical:dv[i][6],status:dv[i][7]});}catch(ignore){}
    var pending=[]; try{var pv=_pendSheet_().getDataRange().getValues();for(var p=1;p<pv.length;p++)if(pv[p][0]&&pv[p][8]!=='выполнено')pending.push({id:pv[p][0],journal:pv[p][2],object:pv[p][3],question:pv[p][4],deadline:pv[p][7],status:pv[p][8],critical:pv[p][22]===true});}catch(ignore2){}
    var recovery=[]; try{recovery=JSON.parse(getRecoveryQueue(token)).data||[];}catch(ignore3){}
    return coreOk({production:{total:prod.length,active:active,completed:completed},activeBlocks:activeBlocks,openDeviations:dev.slice(-200).reverse(),pending:pending.slice(-200).reverse(),recovery:recovery,generatedAt:new Date()});
  }catch(e){return coreErr('V7_DASHBOARD_ERROR',String(e));}
}

function getJournalSigningCoverageV7(periodFrom,periodTo,token){
  try{_requireAuth_(token,'journals');
    var from=periodFrom||Utilities.formatDate(new Date(new Date().getTime()-86400000*30),_mcTz_(),'yyyy-MM-dd');
    var to=periodTo||Utilities.formatDate(new Date(),_mcTz_(),'yyyy-MM-dd');
    var raw=getJournalSigningStatus(from,to,token), d=typeof raw==='string'?JSON.parse(raw):raw;
    return coreOk(d.data||d);
  }catch(e){return coreErr('V7_SIGNING_COVERAGE_ERROR',String(e));}
}

function getV7ControlEvents(token){
  try{_requireAuth_(token,'journals');var v=_mcV7ControlSheet_().getDataRange().getValues(),o=[];for(var i=1;i<v.length;i++)if(v[i][0])o.push({eventId:v[i][0],controlType:v[i][1],objectType:v[i][2],objectId:v[i][3],batchId:v[i][4],severity:v[i][5],status:v[i][6],message:v[i][7],factId:v[i][8],createdAt:v[i][9],createdBy:v[i][10],hash:v[i][11]});return coreOk(o.slice(-1000).reverse());}catch(e){return coreErr('V7_CONTROL_EVENTS_ERROR',String(e));}
}

function runMonChefFullControlCycle(token){
  try{
    var a=runMonChefControlCycle(token||null); var b=runMonChefProductionControlCycle(token||null); var c=checkPendingOverdue();
    return coreOk({expiry:a,production:b,pending:c,runAt:new Date()});
  }catch(e){return coreErr('V7_FULL_CONTROL_CYCLE_ERROR',String(e));}
}
function runMonChefFullControlCycleSystem(){return runMonChefFullControlCycle(null);}
function installMonChefFullControlTrigger(token,everyMinutes){
  try{var s=_requireAuth_(token,'audit_create'),mins=Math.max(15,Math.min(360,Number(everyMinutes)||30));
    ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction()==='runMonChefFullControlCycleSystem')ScriptApp.deleteTrigger(t);});
    ScriptApp.newTrigger('runMonChefFullControlCycleSystem').timeBased().everyMinutes(mins).create();
    return coreOk({installed:true,everyMinutes:mins,installedBy:_mcSessionFullName_(s)});
  }catch(e){return coreErr('V7_TRIGGER_ERROR',String(e));}
}
function removeMonChefFullControlTrigger(token){
  try{_requireAuth_(token,'audit_create');var n=0;ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction()==='runMonChefFullControlCycleSystem'){ScriptApp.deleteTrigger(t);n++;}});return coreOk({removed:n});}catch(e){return coreErr('V7_TRIGGER_REMOVE_ERROR',String(e));}
}

function getAuditOperationalState(rawToken){
  try{var s=_requireAuditAccess_(rawToken,'read');
    var prod=_mcV7ProductionRows_().slice(-200).reverse();
    var blocks=JSON.parse(getAuditRuleState(rawToken)).data||{};
    var pending=[];try{var pv=_pendSheet_().getDataRange().getValues();for(var i=1;i<pv.length;i++)if(pv[i][0]&&pv[i][8]!=='выполнено')pending.push({id:pv[i][0],journal:pv[i][2],object:pv[i][3],question:pv[i][4],status:pv[i][8],deadline:pv[i][7],critical:pv[i][22]===true});}catch(ignore){}
    return coreOk({sessionId:s.sessionId,production:prod,pending:pending.slice(-200).reverse(),blocks:blocks.blocks||[]});
  }catch(e){return coreErr('AUDIT_OPERATIONAL_STATE_ERROR',String(e));}
}
