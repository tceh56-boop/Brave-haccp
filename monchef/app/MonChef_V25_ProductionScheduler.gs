/**
 * MON CHEF V25 — BACKWARD PRODUCTION SCHEDULER
 *
 * Обратный расчёт от времени банкета: банкет -> готовое блюдо -> П/Ф -> сырьё.
 * V25 не подставляет фактические операции: он создаёт плановые задачи и сроки.
 */
var MC_V25_PLAN='Производство_План_V25';
var MC_V25_CFG='Времена_ТТК_V25';

function _mcV25Ensure_(name,headers){
  var sh=_book_().getSheetByName(name);
  if(!sh){sh=_book_().insertSheet(name);sh.appendRow(headers);sh.setFrozenRows(1);}
  return sh;
}
function _mcV25Plan_(){return _mcV25Ensure_(MC_V25_PLAN,['ScheduleID','PlanID','BanquetID','BanquetDateTime','TaskDate','StartTime','DueTime','Level','TaskType','TTKCode','Name','Qty','Unit','Workshop','ParentTaskID','Source','Status','CreatedAt','CreatedBy']);}
function _mcV25Cfg_(){return _mcV25Ensure_(MC_V25_CFG,['TTKCode','TTKName','TaskType','DurationMin','BufferMin','PickMin','Workshop','Active','UpdatedAt','UpdatedBy']);}
function _mcV25Num_(x){return Number(String(x==null?'':x).replace(',','.'))||0;}
function _mcV25Date_(d){return Utilities.formatDate(new Date(d),_mcTz_(),'yyyy-MM-dd');}
function _mcV25Time_(d){return Utilities.formatDate(new Date(d),_mcTz_(),'HH:mm');}
function _mcV25CfgMap_(){
  var sh=_mcV25Cfg_(),v=sh.getDataRange().getValues(),m={};
  for(var i=1;i<v.length;i++)if(v[i][0])m[String(v[i][0])]={code:String(v[i][0]),name:String(v[i][1]||''),taskType:String(v[i][2]||'DISH'),duration:Number(v[i][3])||30,buffer:Number(v[i][4])||10,pick:Number(v[i][5])||30,workshop:String(v[i][6]||''),active:String(v[i][7]||'Y')!=='N'};
  return m;
}
function _mcV25EnsureDefaults_(idx,actor){
  var sh=_mcV25Cfg_(), m=_mcV25CfgMap_(), rows=[];
  Object.keys(idx.dishByCode).forEach(function(code){if(m[code])return;var d=idx.dishByCode[code], semi=/п\/ф|п-ф/i.test(String(d.name||''));rows.push([code,d.name,semi?'SEMI':'DISH',semi?60:30,10,30,'', 'Y',new Date(),actor||'SYSTEM']);});
  if(rows.length)sh.getRange(sh.getLastRow()+1,1,rows.length,10).setValues(rows);
  return _mcV25CfgMap_();
}
function _mcV25DateTime_(date,time){
  var s=String(date||'').slice(0,10), t=String(time||'').slice(0,5)||'16:00';
  var d=new Date(s+'T'+t+':00'); if(isNaN(d.getTime())) d=new Date(s+'T16:00:00'); return d;
}
function _mcV25Walk_(code,qty,due,idx,cfg,nodes,root,banquetId,parentTaskId,level,path){
  var d=idx.dishByCode[code]; if(!d)return null;
  var c=cfg[code]||{duration:30,buffer:10,pick:30,workshop:'',taskType:level?'SEMI':'DISH'};
  var start=new Date(due.getTime()-c.duration*60000), id='V25T-'+Utilities.getUuid();
  var node={id:id,code:code,name:d.name,qty:qty,unit:'порц.',taskType:level?'SEMI':'DISH',level:level,start:start,due:new Date(due),workshop:c.workshop||'',parentTaskId:parentTaskId||'',banquetId:String(banquetId||''),banquetDateTime:_mcV25DateTime_(root.banquetDate,root.banquetTime),root:root};
  if(level>0){node.unit='г';}
  nodes.push(node);
  var ing=d.ing||[];
  // закладка ТТК — на выход карты: блюдо — на порции карты, п/ф — на его выход в граммах
  var factor=level>0?qty/(_mcV25Num_(d.yieldBase)||_mcV25Num_(d.yield)||1):qty/(_mcV25Num_(d.portions)||1);
  ing.forEach(function(x){
    var name=String(x[0]||'').trim(), amount=_mcV25Num_(x[1])*factor, unit=x[2]||'г'; if(!name||amount<=0)return;
    var sub=idx.dishByNormName[_normNameServer_(name)];
    if(sub && sub.ing && sub.ing.length && path.indexOf(sub.code)<0){
      var childDue=new Date(start.getTime()-c.buffer*60000);
      var child=_mcV25Walk_(sub.code,amount,childDue,idx,cfg,nodes,root,banquetId,id,level+1,path.concat(sub.code));
      if(child)child.unit=unit;
    } else {
      nodes.push({id:'V25R-'+Utilities.getUuid(),code:'',name:name,qty:amount,unit:unit,taskType:'RAW_PICK',level:level+1,start:new Date(start.getTime()-c.pick*60000),due:new Date(start.getTime()),workshop:'СКЛАД',parentTaskId:id,banquetId:String(banquetId||''),root:root});
    }
  });
  return node;
}
function _mcV25CollectRoots_(fromDate,token){
  var pack=_mcV14Build_(fromDate,token,false), roots=[];
  (pack.production||[]).filter(function(t){return String(t.taskType||'DISH')==='DISH';}).forEach(function(t){
    var banquetTime=t.dueTime||'16:00', banquetDate=t.banquetDate||t.productionDate;
    roots.push({code:t.code,name:t.name,qty:_mcV25Num_(t.qty),banquetId:(t.banquets||[]).join(','),banquetDate:banquetDate,banquetTime:banquetTime,productionDate:t.productionDate});
  });
  return {pack:pack,roots:roots};
}
function buildV25ProductionSchedule(fromDate,token){
  try{
    _requireAuth_(token,'kanban');
    var pack=_mcV25CollectRoots_(fromDate,token), idx=_buildDishIndexes_(), actor=_mcV20Actor_(token), cfg=_mcV25EnsureDefaults_(idx,actor), nodes=[];
    pack.roots.forEach(function(r){var banquet=_mcV25DateTime_(r.banquetDate,r.banquetTime), rootDue=new Date(banquet.getTime()-30*60000);_mcV25Walk_(r.code,r.qty,rootDue,idx,cfg,nodes,r,r.banquetId, '',0,[r.code]);});
    var tasks=nodes.filter(function(n){return n.taskType!=='RAW_PICK';}), picks=nodes.filter(function(n){return n.taskType==='RAW_PICK';});
    var grouped={}; tasks.forEach(function(n){var key=n.code+'|'+_mcV25Date_(n.start)+'|'+_mcV25Time_(n.due);if(!grouped[key])grouped[key]={id:'V25G-'+Utilities.getUuid(),code:n.code,name:n.name,qty:0,unit:n.unit,taskType:n.taskType,level:n.level,start:n.start,due:n.due,workshop:n.workshop,banquets:[],banquetDateTimes:[],parentTaskIds:[]};var g=grouped[key];g.qty+=n.qty;(n.banquetId||'').split(',').filter(Boolean).forEach(function(b){if(g.banquets.indexOf(b)<0)g.banquets.push(b);});if(n.parentTaskId&&g.parentTaskIds.indexOf(n.parentTaskId)<0)g.parentTaskIds.push(n.parentTaskId);if(n.banquetDateTime){var bt=n.banquetDateTime.getTime();if(g.banquetDateTimes.indexOf(bt)<0)g.banquetDateTimes.push(bt);}});
    var groupedTasks=Object.keys(grouped).map(function(k){return grouped[k];});
    picks.sort(function(a,b){return a.due-b.due;});
    var earliestPick={};picks.forEach(function(p){var k=_prodKey_(p.name)+'|'+p.unit;if(!earliestPick[k]||p.due<earliestPick[k].due)earliestPick[k]=p;});
    var rawPick=Object.keys(earliestPick).map(function(k){var p=earliestPick[k], total=picks.filter(function(x){return _prodKey_(x.name)+'|'+x.unit===k;}).reduce(function(s,x){return s+x.qty;},0);return {id:'V25P-'+Utilities.getUuid(),name:p.name,qty:total,unit:p.unit,taskType:'RAW_PICK',level:p.level,start:p.start,due:p.due,workshop:'СКЛАД',banquets:Array.from(new Set(picks.filter(function(x){return _prodKey_(x.name)+'|'+x.unit===k;}).map(function(x){return x.banquetId;}).join(',').split(',').filter(Boolean)))};});
    groupedTasks.sort(function(a,b){return a.start-b.start||a.level-b.level;}); rawPick.sort(function(a,b){return a.start-b.start;});
    return _ok_({planId:pack.pack.planId,weekFrom:pack.pack.weekFrom,weekTo:pack.pack.weekTo,roots:pack.roots,tasks:groupedTasks,rawPick:rawPick,generatedAt:new Date()});
  }catch(e){return _failFrom_(e);}
}
function publishV25ProductionSchedule(fromDate,token){
  try{
    _requireAuth_(token,'kanban'); var r0=buildV25ProductionSchedule(fromDate,token),r=_mcV22Parse_(r0);if(!(r.ok||r.success))return r0;var d=r.data, sh=_mcV25Plan_(), now=new Date(), actor=_mcV20Actor_(token), rows=[];
    (d.tasks||[]).concat(d.rawPick||[]).forEach(function(t){rows.push([t.id,d.planId,(t.banquets||[]).join(','),t.banquetDateTimes&&t.banquetDateTimes.length?new Date(Math.min.apply(null,t.banquetDateTimes)):'',_mcV25Date_(t.start),_mcV25Time_(t.start),_mcV25Time_(t.due),t.level,t.taskType,t.code,t.name,t.qty,t.unit,t.workshop,t.parentTaskIds?t.parentTaskIds.join(','):'','V25_SCHEDULE','PLANNED',now,actor]);});
    if(rows.length)sh.getRange(sh.getLastRow()+1,1,rows.length,19).setValues(rows);
    return _ok_({planId:d.planId,count:rows.length,tasks:d.tasks,rawPick:d.rawPick});
  }catch(e){return _failFrom_(e);}
}
function getV25Schedule(fromDate,token){
  try{_requireAuth_(token,'kanban');var sh=_mcV25Plan_(),v=sh.getDataRange().getValues(),from=_mcV25Date_(_mcV14Monday_(new Date(fromDate||new Date()))),to=new Date(from+'T00:00:00');to.setDate(to.getDate()+6);var toS=_mcV25Date_(to),out=[];for(var i=1;i<v.length;i++){var d=String(v[i][4]||'').slice(0,10);if(d>=from&&d<=toS)out.push({id:v[i][0],planId:v[i][1],banquetId:v[i][2],taskDate:d,start:v[i][5],due:v[i][6],level:v[i][7],taskType:v[i][8],code:v[i][9],name:v[i][10],qty:_mcV25Num_(v[i][11]),unit:v[i][12],workshop:v[i][13],status:v[i][16]});}return _ok_({weekFrom:from,weekTo:toS,rows:out});
  }catch(e){return _failFrom_(e);}
}
function seedV25TTKTimes(token){try{_requireAuth_(token,'kanban');var idx=_buildDishIndexes_(),actor=_mcV20Actor_(token);_mcV25EnsureDefaults_(idx,actor);return _ok_({count:Object.keys(idx.dishByCode).length});}catch(e){return _failFrom_(e);}}
