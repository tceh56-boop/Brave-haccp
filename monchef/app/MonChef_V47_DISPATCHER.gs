/**
 * MON CHEF V47 — Unified banquet production dispatcher.
 * One operational view: banquet -> dish/PF -> production -> batch -> reserve -> issue -> deficit.
 * V25 is planning source, V27 production is factual source, V46 is allocation/issue source, V44 is task source.
 * This module does not create a second stock or production truth.
 */
const V47_DISP = {
  SNAP: 'Диспетчер_Банкеты_V47',
  AUDIT: 'Диспетчер_Банкеты_Аудит_V47'
};
const V47_HEADERS = {
  SNAP: ['SnapshotID','At','ProductionID','TaskID','BanquetID','BanquetDate','DishCode','ProductName','PlannedQty','ProductionActual','ReservedQty','IssuedQty','UnallocatedProduction','UnissuedReserve','ProductionStatus','TaskStatus','BatchID','Unit','Workshop','TTKCode','Source'],
  AUDIT: ['AuditID','At','Action','ProductionID','TaskID','BanquetID','Result','Message']
};
function _v47Sheet_(name,headers){var ss=_book_(),sh=ss.getSheetByName(name);if(!sh)sh=ss.insertSheet(name);if(sh.getLastRow()===0){sh.appendRow(headers);sh.setFrozenRows(1);}return sh;}
function _v47Rows_(name){var sh=_book_().getSheetByName(name);if(!sh||sh.getLastRow()<2)return[];var v=sh.getDataRange().getValues(),h=v[0];return v.slice(1).filter(function(r){return r.some(function(x){return x!=='';});}).map(function(r){var o={};h.forEach(function(k,i){o[k]=r[i];});return o;});}
function _v47Id_(p){return 'V47-'+p+'-'+Utilities.getUuid().slice(0,8).toUpperCase();}
function _v47Audit_(action,pid,tid,bid,result,msg){_v47Sheet_(V47_DISP.AUDIT,V47_HEADERS.AUDIT).appendRow([_v47Id_('AUD'),new Date(),action,pid||'',tid||'',bid||'',result||'',msg||'']);}
function setupV47Dispatcher(){Object.keys(V47_HEADERS).forEach(function(k){_v47Sheet_(V47_DISP[k],V47_HEADERS[k]);});try{setupV46BanquetAllocation();}catch(e){}try{setupV45ProductionBridge();}catch(e2){}try{setupV44TaskCenter();}catch(e3){}return{ok:true,sheets:V47_DISP};}
function _v47TaskForProduction_(pid){try{return _v44Rows_(V44_TASK.TASK).find(function(t){return String(t.ProductionID||'')===String(pid)&&String(t.SourceType)==='PRODUCTION_SCHEDULE';})||null;}catch(e){return null;}}
function _v47ProductionRows_(){try{return _v45ProductionRows_();}catch(e){return[];}}
function _v47Allocations_(){try{return _v46Rows_(V46_ALLOC.ALLOC);}catch(e){return[];}}
function v47RefreshDispatcher(fromDate,toDate,token){
  setupV47Dispatcher();
  var report={syncTasks:null,bind:null,allocation:null,status:null,snapshot:0};
  try{report.syncTasks=v44SyncProductionTasks(fromDate,token);}catch(e){report.syncTasks={ok:false,error:String(e)};}
  try{report.bind=v45AutoBindProductionTasks(fromDate,token);}catch(e2){report.bind={ok:false,error:String(e2)};}
  try{report.allocation=v46SeedFromProduction([],token);}catch(e3){report.allocation={ok:false,error:String(e3)};}
  try{report.status=v45RefreshProductionTaskStatuses(token);}catch(e4){report.status={ok:false,error:String(e4)};}
  report.snapshot=v47BuildSnapshot(fromDate,toDate,token).rows;
  _v47Audit_('REFRESH','','','','OK','Обновлены задачи, связи production_id, распределения и статусы');
  return report;
}
function _v47Date_(x){if(x instanceof Date&&!isNaN(x.getTime()))return x;var d=x?new Date(x):null;return d&&!isNaN(d.getTime())?d:null;}
function _v47InWindow_(date,from,to){var d=_v47Date_(date);if(!d)return true;var f=from?_v47Date_(from):null,t=to?_v47Date_(to):null;if(f){f.setHours(0,0,0,0);if(d<f)return false;}if(t){t.setHours(23,59,59,999);if(d>t)return false;}return true;}
function v47BuildSnapshot(fromDate,toDate,token){
  setupV47Dispatcher();
  var prods=_v47ProductionRows_(),allocs=_v47Allocations_(),rows=[],now=new Date();
  prods.forEach(function(p){
    var a=allocs.filter(function(x){return String(x.ProductionID)===String(p.id);});
    var task=_v47TaskForProduction_(p.id);
    if(!a.length){if(_v47InWindow_(null,fromDate,toDate))rows.push({snapshotId:_v47Id_('S'),at:now,productionId:p.id,taskId:task?task.TaskID:'',banquetId:'',banquetDate:'',dishCode:p.code,productName:p.name,plannedQty:p.planned,productionActual:p.actual,reservedQty:0,issuedQty:0,unallocatedProduction:p.planned,unissuedReserve:0,productionStatus:p.status,taskStatus:task?task.Status:'',batchId:p.batch,unit:p.unit,workshop:p.workshop,ttkCode:p.code,source:'PRODUCTION'});return;}
    var reservedTotal=a.reduce(function(s,x){return s+(Number(x.ReservedQty)||0);},0);
    a.forEach(function(x){if(!_v47InWindow_(x.BanquetDate,fromDate,toDate))return;rows.push({snapshotId:_v47Id_('S'),at:now,productionId:p.id,taskId:task?task.TaskID:'',banquetId:x.BanquetID,banquetDate:x.BanquetDate,dishCode:x.DishCode||p.code,productName:x.ProductName||p.name,plannedQty:Number(x.PlannedQty)||0,productionActual:p.actual,reservedQty:Number(x.ReservedQty)||0,issuedQty:Number(x.IssuedQty)||0,unallocatedProduction:Math.max(0,(Number(p.planned)||0)-reservedTotal),unissuedReserve:Math.max(0,(Number(x.ReservedQty)||0)-(Number(x.IssuedQty)||0)),productionStatus:p.status,taskStatus:task?task.Status:'',batchId:x.BatchID||p.batch,unit:x.Unit||p.unit,workshop:p.workshop,ttkCode:p.code,source:x.Source||'V46'});});
  });
  return{ok:true,rows:rows};
}
function v47PublishSnapshot(fromDate,toDate,token){
  setupV47Dispatcher();var built=v47BuildSnapshot(fromDate,toDate,token),sh=_v47Sheet_(V47_DISP.SNAP,V47_HEADERS.SNAP),h=V47_HEADERS.SNAP;
  if(built.rows.length){sh.getRange(sh.getLastRow()+1,1,built.rows.length,h.length).setValues(built.rows.map(function(r){return h.map(function(k){return r[k.charAt(0).toLowerCase()+k.slice(1)]!==undefined?r[k.charAt(0).toLowerCase()+k.slice(1)]:'';});}));}
  return{ok:true,rows:built.rows.length,at:new Date()};
}
function v47GetDashboard(fromDate,toDate,token){
  setupV47Dispatcher();var s=v47BuildSnapshot(fromDate,toDate,token).rows,byBanquet={},byProd={};
  s.forEach(function(r){if(r.banquetId){var k=String(r.banquetId);if(!byBanquet[k])byBanquet[k]={banquetId:k,banquetDate:r.banquetDate,lines:0,planned:0,reserved:0,issued:0,deficit:0};var b=byBanquet[k];b.lines++;b.planned+=r.plannedQty;b.reserved+=r.reservedQty;b.issued+=r.issuedQty;b.deficit+=Math.max(0,r.plannedQty-r.issuedQty);}var pk=String(r.productionId);if(!byProd[pk])byProd[pk]={productionId:pk,productName:r.productName,planned:r.productionActual==null?0:0,productionPlan:0,actual:r.productionActual,reserved:0,issued:0,unallocated:r.unallocatedProduction,status:r.productionStatus,taskStatus:r.taskStatus};var p=byProd[pk];p.productionPlan=Math.max(p.productionPlan,Number(r.plannedQty)||0,Number(r.unallocatedProduction||0)+Number(r.reservedQty||0));p.reserved+=r.reservedQty;p.issued+=r.issuedQty;});
  var unissued=s.reduce(function(n,r){return n+Math.max(0,r.unissuedReserve);},0),unallocated=s.reduce(function(n,r){return n+Math.max(0,r.unallocatedProduction);},0),critical=s.filter(function(r){return r.banquetId&&r.productionStatus!=='COMPLETED'&&r.plannedQty>r.issuedQty;}).length;
  return{ok:true,totals:{lines:s.length,banquets:Object.keys(byBanquet).length,productions:Object.keys(byProd).length,reserved:s.reduce(function(n,r){return n+r.reservedQty;},0),issued:s.reduce(function(n,r){return n+r.issuedQty;},0),unissuedReserve:unissued,unallocatedProduction:unallocated,critical:critical},banquets:Object.keys(byBanquet).map(function(k){return byBanquet[k];}),productions:Object.keys(byProd).map(function(k){return byProd[k];}),rows:s};
}
function v47GetBanquetView(banquetId,fromDate,toDate,token){var d=v47GetDashboard(fromDate,toDate,token),rows=d.rows.filter(function(r){return String(r.banquetId)===String(banquetId);});return{ok:true,banquetId:banquetId,rows:rows,summary:{planned:rows.reduce(function(n,r){return n+r.plannedQty;},0),reserved:rows.reduce(function(n,r){return n+r.reservedQty;},0),issued:rows.reduce(function(n,r){return n+r.issuedQty;},0),deficit:rows.reduce(function(n,r){return n+Math.max(0,r.plannedQty-r.issuedQty);},0)}};}
