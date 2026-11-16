/**
 * MON CHEF V20 — WEEKLY PRODUCTION DISPATCHER
 *
 * Диспетчер следующей рабочей недели:
 * банкеты -> ТТК -> потребность -> остатки -> дефицит -> закупка -> П/Ф -> производство.
 *
 * V20 не заменяет V14: использует существующий расчёт V14 как канонический слой
 * и добавляет диспетчерское представление, публикацию плана и контроль готовности.
 */
var MC_V20_WEEK_REG = 'Недельные_Планы';
var MC_V20_PURCHASE = 'План_Закупок';

function _mcV20Sheet_(name, headers){
  var ss=_book_(), sh=ss.getSheetByName(name);
  if(!sh){sh=ss.insertSheet(name);sh.appendRow(headers);sh.setFrozenRows(1);}
  return sh;
}
function _mcV20WeekReg_(){return _mcV20Sheet_(MC_V20_WEEK_REG,['PlanID','WeekFrom','WeekTo','Status','Banquets','ProductionTasks','PurchaseLines','Shortages','CreatedAt','CreatedBy','PublishedAt','PublishedBy']);}
function _mcV20Purchase_(){return _mcV20Sheet_(MC_V20_PURCHASE,['PlanID','WeekFrom','Product','Unit','Required','OnHand','MinStock','Shortage','Status','CreatedAt','UpdatedAt']);}
function _mcV20Monday_(d){return _mcV14Monday_(d||new Date());}
function _mcV20Date_(d){return Utilities.formatDate(new Date(d),_mcTz_(),'yyyy-MM-dd');}
function _mcV20Actor_(token){try{return _mcSessionFullName_(token?_requireAuth_(token,'kanban'):null)||'';}catch(e){return '';}}

function _mcV20GroupDays_(plan){
  var days={};
  for(var i=0;i<7;i++){var d=new Date(plan.weekFrom+'T00:00:00');d.setDate(d.getDate()+i);var ds=_mcV20Date_(d);days[ds]={date:ds,banquets:0,production:0,purchaseShortages:0,items:[]};}
  (plan.events||[]).forEach(function(e){if(days[e.date]){days[e.date].banquets++;days[e.date].items.push({type:'BANQUET',name:e.format||e.name||'Банкет',time:e.time||'',id:e.id});}});
  (plan.production||[]).forEach(function(t){var ds=String(t.productionDate||'').slice(0,10);if(days[ds]){days[ds].production++;days[ds].items.push({type:t.taskType||'DISH',name:t.name,qty:t.qty,unit:t.unit,due:t.dueTime||'',banquets:t.banquets||[]});}});
  (plan.purchase||[]).forEach(function(p){if(Number(p.shortage||0)>0){var ds=plan.weekFrom;if(days[ds])days[ds].purchaseShortages++;}});
  return Object.keys(days).sort().map(function(k){return days[k];});
}

function _mcV20Readiness_(plan){
  var purchase=(plan.purchase||[]), production=(plan.production||[]), shortages=(plan.shortages||[]), pf=(plan.pfShortages||[]);
  var purchaseLines=purchase.filter(function(x){return Number(x.shortage||0)>0;}).length;
  var semiLines=pf.filter(function(x){return Number(x.shortage||0)>0;}).length;
  var critical=[];
  if(!(plan.events||[]).length)critical.push({type:'NO_BANQUETS',text:'На неделю не найдено подтверждённых банкетов.'});
  if(purchaseLines)critical.push({type:'PURCHASE_SHORTAGE',text:'Есть позиции сырья, которые необходимо закупить.',count:purchaseLines});
  if(semiLines)critical.push({type:'SEMI_SHORTAGE',text:'Есть дефицит полуфабрикатов, требуется производство.',count:semiLines});
  return {ready:critical.length===0,banquets:(plan.events||[]).length,productionTasks:production.length,purchaseLines:purchaseLines,semiShortages:semiLines,critical:critical};
}

function getWeeklyDispatcher(date,token){
  try{
    _requireAuth_(token,'kanban');
    var monday=_mcV20Monday_(new Date(date||new Date())), plan=_mcV14Build_(_mcV20Date_(monday),token,false);
    var reg=_mcV20WeekReg_().getDataRange().getValues(), status='DRAFT', planId='';
    for(var i=reg.length-1;i>=1;i--){if(String(reg[i][1])===plan.weekFrom&&String(reg[i][2])===plan.weekTo){planId=String(reg[i][0]);status=String(reg[i][3]||'DRAFT');break;}}
    return _ok_({planId:planId,weekFrom:plan.weekFrom,weekTo:plan.weekTo,status:status,days:_mcV20GroupDays_(plan),readiness:_mcV20Readiness_(plan),plan:plan});
  }catch(e){return _failFrom_(e);}
}

function createWeeklyDispatcherPlan(date,token){
  try{
    _requireAuth_(token,'kanban');
    var monday=_mcV20Monday_(new Date(date||new Date())), from=_mcV20Date_(monday);
    var result=_mcV14Build_(from,token,true), now=new Date(), actor=_mcV20Actor_(token);
    var sh=_mcV20WeekReg_(), v=sh.getDataRange().getValues(), row=-1, planId=result.planId;
    for(var i=1;i<v.length;i++)if(String(v[i][1])===result.weekFrom&&String(v[i][2])===result.weekTo&&String(v[i][3])!=='CLOSED'){row=i+1;planId=String(v[i][0]);break;}
    var vals=[planId,result.weekFrom,result.weekTo,'DRAFT',(result.events||[]).length,(result.production||[]).length,(result.purchase||[]).filter(function(x){return Number(x.shortage||0)>0;}).length,(result.shortages||[]).length,now,actor,'',''];
    if(row<0)sh.appendRow(vals);else sh.getRange(row,1,1,12).setValues([vals]);
    _mcV20SyncPurchase_(result,planId);
    return _ok_({planId:planId,weekFrom:result.weekFrom,weekTo:result.weekTo,status:'DRAFT',readiness:_mcV20Readiness_(result),days:_mcV20GroupDays_(result)});
  }catch(e){return _failFrom_(e);}
}

function _mcV20SyncPurchase_(plan,planId){
  var sh=_mcV20Purchase_(), v=sh.getDataRange().getValues();
  for(var i=v.length-1;i>=1;i--)if(String(v[i][0])===String(planId))sh.deleteRow(i+1);
  var rows=[]; (plan.purchase||[]).forEach(function(p){rows.push([planId,plan.weekFrom,p.name,p.unit,p.required,p.stock,p.minQty||0,p.shortage,p.shortage>0?'НУЖНО_ЗАКУПИТЬ':'ДОСТАТОЧНО',new Date(),new Date()]);});
  if(rows.length)sh.getRange(sh.getLastRow()+1,1,rows.length,11).setValues(rows);
}

function publishWeeklyDispatcherPlan(planId,token){
  try{
    _requireAuth_(token,'kanban'); if(!planId)return _fail_('VALIDATION','Не указан PlanID');
    var sh=_mcV20WeekReg_(),v=sh.getDataRange().getValues(),row=-1;
    for(var i=1;i<v.length;i++)if(String(v[i][0])===String(planId)){row=i+1;break;}
    if(row<0)return _fail_('NOT_FOUND','Недельный план не найден');
    if(String(v[row-1][3])==='CLOSED')return _fail_('CONFLICT','План уже закрыт');
    var now=new Date(),actor=_mcV20Actor_(token);sh.getRange(row,4).setValue('PUBLISHED');sh.getRange(row,11).setValue(now);sh.getRange(row,12).setValue(actor);
    return _ok_({planId:planId,status:'PUBLISHED',publishedAt:now,publishedBy:actor});
  }catch(e){return _failFrom_(e);}
}

function getWeeklyPurchasePlan(planId,token){
  try{
    _requireAuth_(token,'kanban'); var v=_mcV20Purchase_().getDataRange().getValues(),out=[];
    for(var i=1;i<v.length;i++)if(!planId||String(v[i][0])===String(planId))out.push({planId:v[i][0],weekFrom:v[i][1],product:v[i][2],unit:v[i][3],required:Number(v[i][4]||0),onHand:Number(v[i][5]||0),minStock:Number(v[i][6]||0),shortage:Number(v[i][7]||0),status:v[i][8]||''});
    return _ok_(out);
  }catch(e){return _failFrom_(e);}
}

function runMonChefWeeklyDispatcherCycle(token){
  try{
    if(token)_requireAuth_(token,'audit_create');
    var d=new Date(),m=_mcV20Monday_(d);m.setDate(m.getDate()+7),from=_mcV20Date_(m);
    var result=_mcV14Build_(from,token||null,true), now=new Date(), sh=_mcV20WeekReg_(), actor=_mcV20Actor_(token), planId=result.planId;
    sh.appendRow([planId,result.weekFrom,result.weekTo,'DRAFT',(result.events||[]).length,(result.production||[]).length,(result.purchase||[]).filter(function(x){return Number(x.shortage||0)>0;}).length,(result.shortages||[]).length,now,actor,'','']);
    _mcV20SyncPurchase_(result,planId);
    return JSON.stringify({ok:true,data:{planId:planId,weekFrom:result.weekFrom,weekTo:result.weekTo,readiness:_mcV20Readiness_(result)}});
  }catch(e){return JSON.stringify({ok:false,error:String(e)});}
}
function runMonChefWeeklyDispatcherCycleSystem(){return runMonChefWeeklyDispatcherCycle(null);}
function installMonChefWeeklyDispatcherTrigger(token){
  try{
    _requireAuth_(token,'audit_create');ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction()==='runMonChefWeeklyDispatcherCycleSystem')ScriptApp.deleteTrigger(t);});
    ScriptApp.newTrigger('runMonChefWeeklyDispatcherCycleSystem').timeBased().everyDays(1).atHour(10).create();
    return _ok_({message:'Ежедневный расчёт следующей недели установлен.'});
  }catch(e){return _failFrom_(e);}
}
