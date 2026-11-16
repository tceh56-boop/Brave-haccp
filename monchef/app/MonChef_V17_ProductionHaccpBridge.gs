/**
 * MON CHEF V17 — PRODUCTION ↔ HACCP BRIDGE
 *
 * Производство становится источником событий для HACCP.
 * Система не подставляет измерения: она создаёт конкретную контрольную задачу
 * только по факту реального производственного события и правилам ТТК.
 *
 * Поток:
 * Производство START/COMPLETE -> партия -> контрольная задача -> напоминание
 * -> фактический показатель -> FACT/HACCP -> отклонение/корректирующее действие.
 */
var MC_V17_TTK_CONTROLS = 'HACCP_ТТК_Контроли';
var MC_V17_PROD_EVENTS = 'HACCP_Производственные_События';

function _mcV17Sheet_(name, headers) {
  var ss = _book_(), sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(headers); sh.setFrozenRows(1); }
  return sh;
}
function _mcV17TtkControlsSheet_() {
  return _mcV17Sheet_(MC_V17_TTK_CONTROLS, [
    'TTKID','CoolingRequired','CoolingMinutes','ReheatRequired','ReheatMinutes',
    'BrakerageRequired','BrakerageDeadlineMinutes','Responsible','Enabled','Notes','CreatedAt','UpdatedAt'
  ]);
}
function _mcV17EventsSheet_() {
  return _mcV17Sheet_(MC_V17_PROD_EVENTS, [
    'EventID','ProductionID','EventType','TTKID','TTKName','BatchID','EventAt','Employee',
    'SourceStatus','CreatedAt','Processed','Details'
  ]);
}
function _mcV17ControlTaskExists_(controlId, objectId) {
  var sh = _mcV16TasksSheet_(), v = sh.getDataRange().getValues();
  for (var i=1;i<v.length;i++) if (String(v[i][1])===String(controlId) && String(v[i][2])===String(objectId) && String(v[i][7])!=='ВЫПОЛНЕНО') return true;
  return false;
}
function _mcV17TtkRule_(ttkId) {
  var v=_mcV17TtkControlsSheet_().getDataRange().getValues();
  for(var i=1;i<v.length;i++) if(String(v[i][0])===String(ttkId) && v[i][8]!==false) return {
    ttkId:String(v[i][0]), cooling: v[i][1]===true, coolingMin:Number(v[i][2]||0),
    reheat:v[i][3]===true, reheatMin:Number(v[i][4]||0), brakerage:v[i][5]===true,
    brakerageMin:Number(v[i][6]||60), responsible:String(v[i][7]||'Шеф-повар')
  };
  return null;
}
function seedMonChefProductionHaccpRules(token) {
  try {
    if(token) _requireAuth_(token,'journals');
    var sh=_mcV17TtkControlsSheet_();
    return JSON.stringify({ok:true,rows:Math.max(0,sh.getLastRow()-1),message:'Справочник контроля ТТК готов. Правила включаются только для явно настроенных ТТК.'});
  } catch(e){return JSON.stringify({ok:false,error:String(e)});}
}
function upsertProductionHaccpRule(json, token) {
  try {
    _requireAuth_(token,'journals');
    var d=JSON.parse(json||'{}'); if(!d.ttkId) return _fail_('VALIDATION','Укажите TTKID');
    var sh=_mcV17TtkControlsSheet_(),v=sh.getDataRange().getValues(),row=-1;
    for(var i=1;i<v.length;i++) if(String(v[i][0])===String(d.ttkId)){row=i+1;break;}
    var now=new Date(), vals=[String(d.ttkId),d.coolingRequired===true,Number(d.coolingMinutes||0),d.reheatRequired===true,Number(d.reheatMinutes||0),d.brakerageRequired===true,Number(d.brakerageDeadlineMinutes||60),d.responsible||'Шеф-повар',d.enabled!==false,d.notes||''];
    if(row<0) sh.appendRow(vals.concat([now,now])); else sh.getRange(row,1,1,12).setValues([vals.concat([v[row-1][10]||now,now])]);
    return _ok_({ttkId:d.ttkId});
  } catch(e){return _failFrom_(e);}
}
function getProductionHaccpRules(token) {
  try {
    _requireAuth_(token,null); var v=_mcV17TtkControlsSheet_().getDataRange().getValues(),out=[];
    for(var i=1;i<v.length;i++) if(v[i][0]) out.push({ttkId:v[i][0],coolingRequired:v[i][1]===true,coolingMinutes:Number(v[i][2]||0),reheatRequired:v[i][3]===true,reheatMinutes:Number(v[i][4]||0),brakerageRequired:v[i][5]===true,brakerageDeadlineMinutes:Number(v[i][6]||60),responsible:v[i][7]||'',enabled:v[i][8]!==false,notes:v[i][9]||''});
    return _ok_(out);
  } catch(e){return _failFrom_(e);}
}
function _mcV17AppendTask_(controlId, equipmentId, equipmentName, dueDate, dueTime, deadline, unit, sourceDetails) {
  var sh=_mcV16TasksSheet_(), id='HTP'+Date.now()+Math.floor(Math.random()*1000);
  sh.appendRow([id,controlId,equipmentId,equipmentName,dueDate,dueTime,deadline,'ОЖИДАЕТ','',unit||'','', '', '', 'NEW',new Date(),new Date()]);
  _mcV17EventsSheet_().appendRow(['HEP'+Date.now()+Math.floor(Math.random()*1000),sourceDetails.productionId||'',sourceDetails.eventType||'PRODUCTION',sourceDetails.ttkId||'',sourceDetails.ttkName||'',sourceDetails.batchId||'',sourceDetails.eventAt||new Date(),sourceDetails.employee||'',sourceDetails.status||'',new Date(),true,JSON.stringify({taskId:id,controlId:controlId})]);
  return id;
}
function _mcV17ProcessProduction_() {
  var psh=_productionSheet_(), pv=psh.getDataRange().getValues(), evs=_mcV17EventsSheet_(), ev=evs.getDataRange().getValues(), seen={};
  for(var i=1;i<ev.length;i++) if(ev[i][0]) seen[String(ev[i][1])+'|'+String(ev[i][2])+'|'+String(ev[i][5])] = true;
  var added=0, now=new Date();
  for(var r=1;r<pv.length;r++){
    if(!pv[r][0]) continue;
    var pid=String(pv[r][PROD_COL_.id]), status=String(pv[r][PROD_COL_.status]||''), ttk=String(pv[r][PROD_COL_.code]||''), name=String(pv[r][PROD_COL_.name]||''), batch=String(pv[r][PROD_COL_.batch]||''), emp=String(pv[r][PROD_COL_.emp]||'');
    if(status!=='COMPLETED' || !batch) continue;
    var key=pid+'|COMPLETE|'+batch; if(seen[key]) continue;
    var rule=_mcV17TtkRule_(ttk);
    if(!rule) { evs.appendRow(['HEP'+Date.now()+Math.floor(Math.random()*1000),pid,'COMPLETE',ttk,name,batch,pv[r][PROD_COL_.finish]||now,emp,status,now,true,JSON.stringify({reason:'NO_TTK_HACCP_RULE'} )]); continue; }
    var finish=pv[r][PROD_COL_.finish] instanceof Date?pv[r][PROD_COL_.finish]:now;
    var date=Utilities.formatDate(finish,_mcTz_(),'yyyy-MM-dd');
    if(rule.brakerage){
      var due=new Date(finish.getTime()), dl=new Date(due.getTime()+rule.brakerageMin*60000);
      var hm=Utilities.formatDate(due,_mcTz_(),'HH:mm'), dhm=Utilities.formatDate(dl,_mcTz_(),'HH:mm');
      if(!_mcV17ControlTaskExists_('HC-PROD-BRAKERAGE',batch)) {_mcV17AppendTask_('HC-PROD-BRAKERAGE',batch,'Бракераж: '+name,date,hm,dhm,'', {productionId:pid,eventType:'BRAKERAGE_REQUIRED',ttkId:ttk,ttkName:name,batchId:batch,eventAt:finish,employee:emp,status:status});added++;}
    }
    if(rule.cooling){
      var cd=new Date(finish.getTime()+rule.coolingMin*60000), cdl=new Date(cd.getTime()+60*60000);
      var cdate=Utilities.formatDate(cd,_mcTz_(),'yyyy-MM-dd'), chm=Utilities.formatDate(cd,_mcTz_(),'HH:mm'), cdhm=Utilities.formatDate(cdl,_mcTz_(),'HH:mm');
      if(!_mcV17ControlTaskExists_('HC-PROD-COOLING',batch)) {_mcV17AppendTask_('HC-PROD-COOLING',batch,'Контроль охлаждения: '+name,cdate,chm,cdhm,'°C',{productionId:pid,eventType:'COOLING_CONTROL',ttkId:ttk,ttkName:name,batchId:batch,eventAt:cd,employee:emp,status:status});added++;}
    }
    if(rule.reheat){
      var rd=new Date(finish.getTime()+rule.reheatMin*60000), rdl=new Date(rd.getTime()+60*60000);
      var rdate=Utilities.formatDate(rd,_mcTz_(),'yyyy-MM-dd'), rhm=Utilities.formatDate(rd,_mcTz_(),'HH:mm'), rdhm=Utilities.formatDate(rdl,_mcTz_(),'HH:mm');
      if(!_mcV17ControlTaskExists_('HC-PROD-REHEAT',batch)) {_mcV17AppendTask_('HC-PROD-REHEAT',batch,'Контроль разогрева: '+name,rdate,rhm,rdhm,'°C',{productionId:pid,eventType:'REHEAT_CONTROL',ttkId:ttk,ttkName:name,batchId:batch,eventAt:rd,employee:emp,status:status});added++;}
    }
    seen[key]=true;
  }
  return added;
}
function getProductionHaccpDashboard(token) {
  try {
    _requireAuth_(token,null); _mcV17ProcessProduction_(); var sh=_mcV16TasksSheet_(),v=sh.getDataRange().getValues(),out=[];
    for(var i=1;i<v.length;i++) if(v[i][0] && String(v[i][1]).indexOf('HC-PROD-')===0) out.push({id:v[i][0],controlId:v[i][1],batchId:v[i][2],object:v[i][3],date:v[i][4],due:v[i][5],deadline:v[i][6],status:v[i][7],fact:v[i][8],employee:v[i][10],answeredAt:v[i][11],deviationId:v[i][12]});
    return _ok_({total:out.length,pending:out.filter(function(x){return x.status!=='ВЫПОЛНЕНО';}).length,tasks:out.slice(-200).reverse()});
  } catch(e){return _failFrom_(e);}
}
function runMonChefProductionHaccpBridgeCycle(token) {
  try { if(token)_requireAuth_(token,'journals'); var added=_mcV17ProcessProduction_(); return JSON.stringify({ok:true,data:{tasksAdded:added,checkedAt:new Date()}}); }
  catch(e){return JSON.stringify({ok:false,error:String(e)});}
}
function runMonChefProductionHaccpBridgeCycleSystem(){return runMonChefProductionHaccpBridgeCycle(null);}
function installMonChefProductionHaccpBridgeTrigger(token) {
  try {
    _requireAuth_(token,'audit_create');
    ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction()==='runMonChefProductionHaccpBridgeCycleSystem')ScriptApp.deleteTrigger(t);});
    ScriptApp.newTrigger('runMonChefProductionHaccpBridgeCycleSystem').timeBased().everyMinutes(5).create();
    return JSON.stringify({ok:true,message:'Производственные HACCP-контроли будут проверяться каждые 5 минут.'});
  } catch(e){return JSON.stringify({ok:false,error:String(e)});}
}
