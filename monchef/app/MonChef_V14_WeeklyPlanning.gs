/**
 * MON CHEF V14 — НЕДЕЛЬНЫЙ ОПЕРАЦИОННЫЙ ПЛАН
 *
 * Цель: в субботу/любой день одним действием пересчитать следующую неделю:
 * банкеты -> блюда -> П/Ф/сырьё -> закупка -> производственные задачи -> дефициты.
 * HACCP, журналы, OCR, склад и traceability остаются отдельными слоями и не удаляются.
 */
var MC_V14_SHEET_PLAN = 'Недельный_План';
var MC_V14_SHEET_PROD = 'План_Производства';

function _mcV14Sheet_(name, headers){
  var ss=_book_(), sh=ss.getSheetByName(name);
  if(!sh){sh=ss.insertSheet(name);sh.appendRow(headers);sh.setFrozenRows(1);}
  return sh;
}
function _mcV14PlanSheet_(){return _mcV14Sheet_(MC_V14_SHEET_PLAN,['PlanID','WeekFrom','WeekTo','Type','ObjectID','Date','Name','Qty','Unit','Need','Stock','Shortage','Status','Source','CreatedAt','CreatedBy']);}
function _mcV14ProdSheet_(){return _mcV14Sheet_(MC_V14_SHEET_PROD,['TaskID','ProductionDate','BanquetDate','DishCode','DishName','Qty','Unit','Workshop','BanquetIDs','DueTime','Status','Source','CreatedAt','UpdatedAt','TaskType']);}
function _mcV14Date_(d){return Utilities.formatDate(new Date(d),_mcTz_(),'yyyy-MM-dd');}
function _mcV14Monday_(d){var x=new Date(d);x.setHours(0,0,0,0);var day=(x.getDay()+6)%7;x.setDate(x.getDate()-day);return x;}
function _mcV14Key_(name,unit){return _prodKey_(name)+'|'+String(unit||'г');}
function _mcV14ToBase_(qty,unit){var u=String(unit||'г').toLowerCase();if(u==='кг')return {qty:Number(qty||0)*1000,unit:'г'};if(u==='л')return {qty:Number(qty||0)*1000,unit:'мл'};return {qty:Number(qty||0),unit:u||'г'};}
function _mcV14FromBase_(qty,unit){var u=unit, q=Number(qty||0);if(u==='г'&&Math.abs(q)>=1000)return {qty:Math.round(q/10)/100,unit:'кг'};if(u==='мл'&&Math.abs(q)>=1000)return {qty:Math.round(q/10)/100,unit:'л'};return {qty:Math.round(q*100)/100,unit:u};}

function _mcV14Events_(from,to){
  var sh=_eventsSheet_(),v=sh.getDataRange().getValues(),out=[];
  for(var i=1;i<v.length;i++){
    if(!v[i][0])continue;
    var ds=v[i][1] instanceof Date?_mcV14Date_(v[i][1]):String(v[i][1]||'').slice(0,10);
    if(ds<from||ds>to)continue;
    var e={};try{e=JSON.parse(v[i][5]||'{}')}catch(ignore){e={};}
    e.id=String(v[i][0]);e.date=ds;if(!e.items)e.items=[];out.push(e);
  }
  return out.filter(function(e){return String(e.status||'Подтверждён').toLowerCase()!=='отменён'&&String(e.status||'').toLowerCase()!=='отменен';});
}
function _mcV14Stock_(){
  var raw=JSON.parse(getStockBalances()||'[]'),m={};
  raw.forEach(function(s){var b=_mcV14ToBase_(s.qty,s.unit);var k=_mcV14Key_(s.name,b.unit);if(!m[k])m[k]={name:s.name,unit:b.unit,qty:0,minQty:0,isSemi:!!s.isSemi};m[k].qty+=b.qty;m[k].minQty=Math.max(m[k].minQty,_mcV14ToBase_(s.minQty,s.unit).qty);m[k].isSemi=m[k].isSemi||!!s.isSemi;});
  return m;
}
function _mcV14SemiMap_(idx){
  var m={};Object.keys(idx.dishByCode).forEach(function(c){var d=idx.dishByCode[c];if(/п\/ф|п-ф/i.test(String(d.name||'')))m[_prodKey_(d.name)]=d;});return m;
}
function _mcV14CollectDish_(d,qty,state,idx,seen){
  if(!d||!d.ing)return;
  seen=seen||{};var marker=d.code+'|'+qty;if(seen[marker])return;seen[marker]=1;
  (d.ing||[]).forEach(function(i){var name=String(i[0]||'').trim(), amt=(Number(i[1])||0)*qty, unit=i[2]||'г';if(!name||!amt)return;
    var sub=idx.dishByNormName[_normNameServer_(name)];
    if(sub&&/п\/ф|п-ф/i.test(String(sub.name||''))){
      var b=_mcV14ToBase_(amt,unit),k=_mcV14Key_(sub.name,b.unit);state.pf[k]=(state.pf[k]||0)+b.qty;state.pfMeta[k]={name:sub.name,unit:b.unit,code:sub.code,yield:Number(sub.yield)||0};
      return;
    }
    var b2=_mcV14ToBase_(amt,unit),k2=_mcV14Key_(name,b2.unit);state.raw[k2]=(state.raw[k2]||0)+b2.qty;state.rawMeta[k2]={name:name,unit:b2.unit};
  });
}
function _mcV14Build_(fromDate,token,write){
  if(token)_requireAuth_(token,'kanban');
  var monday=_mcV14Monday_(new Date(fromDate||new Date())),from=_mcV14Date_(monday),toD=new Date(monday);toD.setDate(toD.getDate()+6);var to=_mcV14Date_(toD);
  var events=_mcV14Events_(from,to),idx=_buildDishIndexes_(),stock=_mcV14Stock_(),state={raw:{},pf:{},rawMeta:{},pfMeta:{}},dishDays={};
  events.forEach(function(e){var prodDate=new Date(e.date+'T00:00:00');prodDate.setDate(prodDate.getDate()-1);var pd=_mcV14Date_(prodDate);(e.items||[]).forEach(function(it){var d=idx.dishByCode[it.code];var q=Number(it.qty)||0;if(!d||!q)return;var dk=pd+'|'+d.code;if(!dishDays[dk])dishDays[dk]={date:pd,banquetDate:e.date,code:d.code,name:d.name,qty:0,workshop:(_dishWorkshopMap_()[d.code]||''),banquets:[],dueTime:e.time||''};dishDays[dk].qty+=q;if(dishDays[dk].banquets.indexOf(e.id)<0)dishDays[dk].banquets.push(e.id);_mcV14CollectDish_(d,q,state,idx,{});});});
  var purchase=[],shortages=[],pfShort=[];
  Object.keys(state.pf).forEach(function(k){var req=state.pf[k],s=stock[k]||{qty:0,minQty:0},short=Math.max(0,req+Number(s.minQty||0)-Number(s.qty||0));var meta=state.pfMeta[k];if(short>0)pfShort.push({name:meta.name,code:meta.code,required:req,stock:s.qty||0,shortage:short,unit:meta.unit,yield:meta.yield});});
  // ПФ, который будет произведён для закрытия дефицита, превращаем в потребность сырья.
  pfShort.forEach(function(p){var d=idx.dishByCode[p.code];if(!d||!p.yield)return;var factor=p.shortage/p.yield;_mcV14CollectDish_(d,factor,state,idx,{});});
  Object.keys(state.raw).forEach(function(k){var req=state.raw[k],s=stock[k]||{qty:0,minQty:0},short=Math.max(0,req+Number(s.minQty||0)-Number(s.qty||0));var meta=state.rawMeta[k];purchase.push({name:meta.name,unit:meta.unit,required:req,stock:s.qty||0,minQty:s.minQty||0,shortage:short,status:short>0?'НУЖНО_ЗАКУПИТЬ':'ДОСТАТОЧНО'});if(short>0)shortages.push(purchase[purchase.length-1]);});
  purchase.sort(function(a,b){return a.name.localeCompare(b.name,'ru');});
  var production=Object.keys(dishDays).map(function(k){var x=dishDays[k];return {productionDate:x.date,banquetDate:x.banquetDate,code:x.code,name:x.name,qty:x.qty,unit:'порц.',workshop:x.workshop,banquets:x.banquets,dueTime:x.dueTime,status:'todo',taskType:'DISH'};});
  pfShort.forEach(function(p){var first=from, related=[];events.forEach(function(e){(e.items||[]).forEach(function(it){var d=idx.dishByCode[it.code];if(!d)return;(d.ing||[]).forEach(function(i){var sub=idx.dishByNormName[_normNameServer_(String(i[0]||''))];if(sub&&String(sub.code)===String(p.code)){var dd=new Date(e.date+'T00:00:00');dd.setDate(dd.getDate()-1);var ds=_mcV14Date_(dd);if(ds<first)first=ds;if(related.indexOf(e.id)<0)related.push(e.id);}});});});var disp=_mcV14FromBase_(p.shortage,p.unit);production.push({productionDate:first,banquetDate:first,code:p.code,name:p.name,qty:disp.qty,unit:disp.unit,workshop:'П/Ф',banquets:related,dueTime:'',status:'todo',taskType:'SEMI'});});
  production.sort(function(a,b){return (a.productionDate+a.taskType+a.name).localeCompare(b.productionDate+b.taskType+b.name,'ru');});
  var planId='WP'+Date.now();
  if(write){
    var ps=_mcV14PlanSheet_(), now=new Date(), actor='';try{actor=_mcSessionFullName_(token?_requireAuth_(token,'kanban'):null)||'';}catch(ignore){}
    var rows=[];events.forEach(function(e){rows.push([planId,from,to,'BANQUET',e.id,e.date,e.format||e.name||'Банкет','', '', '', '', '', 'CONFIRMED','EVENTS',now,actor]);});
    purchase.forEach(function(p){rows.push([planId,from,to,'PURCHASE','',from,p.name,p.required,p.unit,p.required,p.stock,p.shortage,p.status,'TTK+STOCK',now,actor]);});
    pfShort.forEach(function(p){rows.push([planId,from,to,'SEMI_SHORTAGE','',from,p.name,p.required,p.unit,p.required,p.stock,p.shortage,p.shortage>0?'НУЖНО_ПРОИЗВЕСТИ':'OK','TTK+STOCK',now,actor]);});
    if(rows.length)ps.getRange(ps.getLastRow()+1,1,rows.length,16).setValues(rows);
    var psh=_mcV14ProdSheet_(), existing=psh.getDataRange().getValues();
    for(var i=existing.length-1;i>=1;i--){if(existing[i][1]&&String(existing[i][1])>=from&&String(existing[i][1])<=to&&String(existing[i][10])!=='done')psh.deleteRow(i+1);}
    production.forEach(function(t){psh.appendRow(['PT'+Date.now()+Math.floor(Math.random()*1000),t.productionDate,t.banquetDate,t.code,t.name,t.qty,t.unit,t.workshop,t.banquets.join(','),t.dueTime,'todo','WEEKLY_PLAN',now,now,t.taskType||'DISH']);});
    // Дублируем сводные производственные задачи в существующую доску Канбан.
    // Выполненные задачи не удаляем: история остаётся неизменной.
    var kb=_kanbanSheet_(), kv=kb.getDataRange().getValues();
    for(var k=kv.length-1;k>=1;k--){
      var sourceId=String(kv[k][1]||'');
      var kd=kv[k][2] instanceof Date?_mcV14Date_(kv[k][2]):String(kv[k][2]||'').slice(0,10);
      if(sourceId.indexOf('WEEKLY:'+planId+'|')===0 && String(kv[k][9]||'')!=='done')kb.deleteRow(k+1);
    }
    production.forEach(function(t){
      var taskId=_nextTaskId_();
      var source='WEEKLY:'+planId+'|'+t.productionDate+'|'+t.code+'|'+t.taskType;
      kb.appendRow([taskId,source,t.productionDate,'План недели',t.code,t.name,t.qty,0,
        (t.taskType==='SEMI'?'Изготовить П/Ф «':'Изготовить «')+t.name+'» — '+t.qty+' '+t.unit,'todo','',now,now,t.dueTime||'',t.workshop||'']);
    });
    return {planId:planId,weekFrom:from,weekTo:to,events:events,production:production,purchase:purchase,pfShortages:pfShort,shortages:shortages,generatedAt:now};
  }
  return {planId:planId,weekFrom:from,weekTo:to,events:events,production:production,purchase:purchase,pfShortages:pfShort,shortages:shortages,generatedAt:new Date()};
}
function getWeeklyOperationalPlan(fromDate,token){try{return JSON.stringify({ok:true,data:_mcV14Build_(fromDate,token,false)});}catch(e){return JSON.stringify({ok:false,error:String(e)});}}
function rebuildWeeklyOperationalPlan(fromDate,token){try{return JSON.stringify({ok:true,data:_mcV14Build_(fromDate,token,true)});}catch(e){return JSON.stringify({ok:false,error:String(e)});}}
function runMonChefWeeklyPlanningCycle(token){try{if(token)_requireAuth_(token,'audit_create');var d=new Date();var m=_mcV14Monday_(d);m.setDate(m.getDate()+7);return rebuildWeeklyOperationalPlan(_mcV14Date_(m),token||null);}catch(e){return JSON.stringify({ok:false,error:String(e)});}}
function runMonChefWeeklyPlanningCycleSystem(){return runMonChefWeeklyPlanningCycle(null);}
function installMonChefWeeklyPlanningTrigger(token){try{_requireAuth_(token,'audit_create');ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction()==='runMonChefWeeklyPlanningCycleSystem')ScriptApp.deleteTrigger(t);});ScriptApp.newTrigger('runMonChefWeeklyPlanningCycleSystem').timeBased().everyDays(1).atHour(12).create();return JSON.stringify({ok:true,message:'Ежедневная проверка установлена; пересчёт выполняется для следующей недели.'});}catch(e){return JSON.stringify({ok:false,error:String(e)});}}
