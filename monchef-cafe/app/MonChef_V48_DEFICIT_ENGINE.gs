/**
 * MON CHEF V48 — Deficit Engine.
 * Explains banquet deficit and turns the root cause into one idempotent V44 task.
 * V47 remains the operational snapshot; V44 remains the task source.
 */
const V48_DEF = {
  GAP: 'Дефициты_Банкеты_V48',
  AUDIT: 'Дефициты_Аудит_V48'
};
const V48_HEADERS = {
  GAP: ['GapID','At','BanquetID','BanquetDate','ProductionID','TaskID','ProductName','TTKCode','RequiredQty','ProducedQty','ReservedQty','IssuedQty','DeficitQty','ReasonCode','ReasonText','Severity','Status','Source','UpdatedAt','Notes'],
  AUDIT: ['AuditID','At','Action','GapID','TaskID','ProductionID','BanquetID','Result','Message']
};
function _v48Sheet_(name,headers){var ss=_book_(),sh=ss.getSheetByName(name);if(!sh)sh=ss.insertSheet(name);if(sh.getLastRow()===0){sh.appendRow(headers);sh.setFrozenRows(1);}return sh;}
function _v48Rows_(name){var sh=_book_().getSheetByName(name);if(!sh||sh.getLastRow()<2)return[];var v=sh.getDataRange().getValues(),h=v[0];return v.slice(1).filter(function(r){return r.some(function(x){return x!=='';});}).map(function(r){var o={};h.forEach(function(k,i){o[k]=r[i];});return o;});}
function _v48Id_(p){return 'V48-'+p+'-'+Utilities.getUuid().slice(0,8).toUpperCase();}
function _v48Audit_(action,gapId,taskId,pid,bid,result,msg){_v48Sheet_(V48_DEF.AUDIT,V48_HEADERS.AUDIT).appendRow([_v48Id_('AUD'),new Date(),action,gapId||'',taskId||'',pid||'',bid||'',result||'',msg||'']);}
function setupV48DeficitEngine(){Object.keys(V48_HEADERS).forEach(function(k){_v48Sheet_(V48_DEF[k],V48_HEADERS[k]);});try{setupV47Dispatcher();}catch(e){}try{setupV44TaskCenter();}catch(e2){}return{ok:true,sheets:V48_DEF};}
function _v48ExistingTask_(sourceId){try{return _v44TaskBySource_('DISPATCH_DEFICIT',sourceId);}catch(e){return null;}}
function _v48Severity_(qty,required,reason){var ratio=required>0?qty/required:1;if(reason==='NO_PRODUCTION'||ratio>=0.75)return'CRITICAL';if(ratio>=0.35)return'HIGH';return'NORMAL';}
function _v48Reason_(r){
  var required=Number(r.plannedQty)||0, produced=Number(r.productionActual)||0, reserved=Number(r.reservedQty)||0, issued=Number(r.issuedQty)||0;
  if(required<=issued+0.0001)return null;
  if(!String(r.productionId||''))return{code:'NO_PRODUCTION',text:'Нет связанного производственного задания',qty:required-issued};
  if(String(r.productionStatus||'')==='CANCELLED')return{code:'PRODUCTION_CANCELLED',text:'Производственное задание отменено',qty:required-issued};
  if(produced<=0 && String(r.productionStatus||'')!=='COMPLETED')return{code:'PRODUCTION_NOT_STARTED',text:'Производство не начато или фактический выпуск отсутствует',qty:required-issued};
  if(produced+0.0001<required && String(r.productionStatus||'')!=='COMPLETED')return{code:'PRODUCTION_INCOMPLETE',text:'Фактический выпуск меньше требуемого количества',qty:Math.max(0,required-produced)};
  if(reserved+0.0001<required)return{code:'RESERVE_MISSING',text:'Произведённое количество не зарезервировано за банкетом',qty:Math.max(0,required-reserved)};
  if(issued+0.0001<reserved)return{code:'ISSUE_PENDING',text:'Резерв есть, но выдача на банкет не выполнена',qty:Math.max(0,reserved-issued)};
  if(produced+0.0001<required)return{code:'PRODUCTION_SHORTAGE',text:'Фактического выпуска недостаточно',qty:Math.max(0,required-produced)};
  return{code:'FULFILLMENT_GAP',text:'Требуется ручная проверка цепочки исполнения',qty:Math.max(0,required-issued)};
}
function _v48TaskPayload_(r,reason,gapId){
  var titles={NO_PRODUCTION:'Запустить производство: ',PRODUCTION_CANCELLED:'Разобрать отменённое производство: ',PRODUCTION_NOT_STARTED:'Запустить производство: ',PRODUCTION_INCOMPLETE:'Довыпустить производство: ',PRODUCTION_SHORTAGE:'Довыпустить производство: ',RESERVE_MISSING:'Создать резерв на банкет: ',ISSUE_PENDING:'Выдать на банкет: ',FULFILLMENT_GAP:'Проверить исполнение: '};
  var title=(titles[reason.code]||'Устранить дефицит: ')+String(r.productName||r.dishCode||'');
  var due=r.banquetDate?new Date(r.banquetDate):new Date();if(isNaN(due.getTime()))due=new Date();due.setHours(12,0,0,0);if(due.getTime()<Date.now())due=new Date(Date.now()+60*60000);
  var type=reason.code.indexOf('PRODUCTION')===0||reason.code==='NO_PRODUCTION'?'PRODUCTION':reason.code==='RESERVE_MISSING'?'BANQUET_RESERVE':reason.code==='ISSUE_PENDING'?'BANQUET_ISSUE':'DISPATCH_EXCEPTION';
  var priority=_v48Severity_(reason.qty,Number(r.plannedQty)||0,reason.code);
  return{sourceType:'DISPATCH_DEFICIT',sourceId:gapId,title:title,description:'Банкет '+String(r.banquetId||'')+' · '+reason.text+' · дефицит '+reason.qty+' '+String(r.unit||''),taskType:type,dueAt:due,windowMin:60,role:type==='PRODUCTION'?'Повар':'Диспетчер',priority:priority,banquetId:r.banquetId||'',productionId:r.productionId||'',ttkCode:r.ttkCode||r.dishCode||'',qty:reason.qty,unit:r.unit||'',workshop:r.workshop||'',createdBy:'SYSTEM',notes:'V48: причина дефицита определена автоматически'};
}
function v48AnalyzeDeficits(fromDate,toDate,token){
  setupV48DeficitEngine();
  var dash=v47GetDashboard(fromDate,toDate,token), rows=dash.rows||[], out=[], now=new Date();
  rows.forEach(function(r){var reason=_v48Reason_(r);if(!reason)return;var key=[r.banquetId,r.productionId,r.ttkCode||r.dishCode,reason.code].join('|');var gapId=_v48Id_('GAP');var existing=_v48Rows_(V48_DEF.GAP).find(function(g){return String(g.BanquetID)===String(r.banquetId)&&String(g.ProductionID)===String(r.productionId)&&String(g.TTKCode)===String(r.ttkCode||r.dishCode)&&String(g.ReasonCode)===reason.code&&['OPEN','IN_PROGRESS'].indexOf(String(g.Status))>=0;});if(existing)gapId=existing.GapID;var task=_v48ExistingTask_(gapId);out.push({gapId:gapId,banquetId:r.banquetId,banquetDate:r.banquetDate,productionId:r.productionId,productName:r.productName,ttkCode:r.ttkCode||r.dishCode,requiredQty:Number(r.plannedQty)||0,producedQty:Number(r.productionActual)||0,reservedQty:Number(r.reservedQty)||0,issuedQty:Number(r.issuedQty)||0,deficitQty:reason.qty,reasonCode:reason.code,reasonText:reason.text,severity:_v48Severity_(reason.qty,Number(r.plannedQty)||0,reason.code),taskId:task?task.TaskID:'',source:'V47'});});
  // Банкет, под который ещё нет производства, — тоже дефицит (раньше он не попадал в анализ:
  // V47 видит только уже распределённое производство). Источник — задания по банкетам (V44).
  try{
    var seen={};out.forEach(function(g){seen[String(g.banquetId)+'|'+String(g.ttkCode)]=1;});
    var f0=fromDate?new Date(fromDate):null,t0=toDate?new Date(toDate):null;if(t0)t0.setHours(23,59,59,999);
    var evDate={};try{JSON.parse(getEvents()).forEach(function(e){evDate[String(e.id)]=e.date;});}catch(eEv){}
    var agg={};
    _v44Rows_(V44_TASK.TASK).forEach(function(t){
      if(!t.BanquetID||t.ProductionID||['COMPLETED','CANCELLED','DONE'].indexOf(String(t.Status))>=0)return;
      var due=t.DueAt instanceof Date?t.DueAt:null;if(due&&((f0&&due<f0)||(t0&&due>t0)))return;
      [String(t.BanquetID||'')].filter(Boolean).forEach(function(bid){  // общее задание нескольких банкетов — одна строка дефицита со всеми ID, без двойного счёта
        var k=bid+'|'+String(t.TTKCode||t.Title);if(seen[k])return;
        if(!agg[k])agg[k]={banquetId:bid,ttkCode:String(t.TTKCode||''),productName:String(t.Title||'').replace(/^(Производство|Отбор|Приготовить):?\s*«?/,'').replace(/\s+—\s+[\d.,]+\s*\S*$/,'').replace(/»$/,''),qty:0,unit:t.Unit,raw:String(t.TaskType)==='RAW_PICK'};
        agg[k].qty+=Number(t.Qty)||0;});
    });
    var rawNeed={};Object.keys(agg).forEach(function(k){var a=agg[k];if(a.raw){var rk=a.productName+'|'+a.unit;rawNeed[rk]=(rawNeed[rk]||0)+a.qty;}});
    Object.keys(agg).forEach(function(k){var a=agg[k];if(!(a.qty>0))return;
      if(a.raw){ // сырьё: дефицит — только нехватка на складе с учётом всех банкетов окна
        var need=rawNeed[a.productName+'|'+a.unit]||a.qty,avail=0;try{avail=_mcAvailableBase_(a.productName,a.unit||'г',false);}catch(eA){}
        var needB=_toBaseUnitServer_(need,a.unit||'г').qty,short=Math.max(0,needB-avail);if(short<=0.0001)return;
        a.qty=Math.min(_toBaseUnitServer_(a.qty,a.unit||'г').qty,short);a.reason='RAW_SHORTAGE';}
      var existing=_v48Rows_(V48_DEF.GAP).find(function(g){return String(g.BanquetID)===a.banquetId&&String(g.TTKCode)===a.ttkCode&&String(g.ReasonCode)===(a.reason||'NO_PRODUCTION')&&['OPEN','IN_PROGRESS'].indexOf(String(g.Status))>=0;});
      var gapId=existing?existing.GapID:_v48Id_('GAP'),task=_v48ExistingTask_(gapId);
      var rc=a.reason||'NO_PRODUCTION';out.push({gapId:gapId,banquetId:a.banquetId,banquetDate:evDate[String(a.banquetId).split(',')[0]]||'',productionId:'',productName:a.productName,ttkCode:a.ttkCode,unit:a.raw?_toBaseUnitServer_(1,a.unit||'г').unit:a.unit,requiredQty:a.qty,producedQty:0,reservedQty:0,issuedQty:0,deficitQty:a.qty,reasonCode:rc,reasonText:rc==='RAW_SHORTAGE'?'Не хватает сырья на складе (допущенные партии)':'Под банкет не создано производственное задание',severity:_v48Severity_(a.qty,a.qty,rc),taskId:task?task.TaskID:'',source:'V44'});});
  }catch(eNoProd){}
  return{ok:true,at:now,rows:out,totals:{deficits:out.length,critical:out.filter(function(x){return x.severity==='CRITICAL';}).length,qty:out.reduce(function(s,x){return s+x.deficitQty;},0)}};
}
function v48CreateCorrectiveTasks(fromDate,toDate,token){
  setupV48DeficitEngine();var a=v48AnalyzeDeficits(fromDate,toDate,token),sh=_v48Sheet_(V48_DEF.GAP,V48_HEADERS.GAP),created=0,updated=0;
  a.rows.forEach(function(g){var task=_v48ExistingTask_(g.gapId),payload=_v48TaskPayload_(g,{code:g.reasonCode,text:g.reasonText,qty:g.deficitQty},g.gapId),taskId;
    if(task){taskId=task.TaskID;updated++;}
    else {taskId=_v44UpsertTask_(payload);created++;_v48Audit_('CREATE_TASK',g.gapId,taskId,g.productionId,g.banquetId,'OK','Создана корректирующая задача по причине '+g.reasonCode);}
    var old=_v48Rows_(V48_DEF.GAP).find(function(x){return String(x.GapID)===String(g.gapId);});
    var row=[g.gapId,new Date(),g.banquetId,g.banquetDate,g.productionId,taskId,g.productName,g.ttkCode,g.requiredQty,g.producedQty,g.reservedQty,g.issuedQty,g.deficitQty,g.reasonCode,g.reasonText,g.severity,'OPEN','V47',new Date(),''];
    if(!old)sh.appendRow(row);else{var vals=sh.getDataRange().getValues(),ri=-1;for(var i=1;i<vals.length;i++)if(String(vals[i][0])===String(g.gapId)){ri=i+1;break;}if(ri>0)sh.getRange(ri,1,1,V48_HEADERS.GAP.length).setValues([row]);}
  });
  return{ok:true,createdTasks:created,existingTasks:updated,deficits:a.rows.length,critical:a.totals.critical};
}
function v48ResolveClosedDeficits(){setupV48DeficitEngine();var sh=_v48Sheet_(V48_DEF.GAP,V48_HEADERS.GAP),vals=sh.getDataRange().getValues(),resolved=0;if(vals.length<2)return{ok:true,resolved:0};var dash=v47GetDashboard().rows||[];for(var i=1;i<vals.length;i++){if(String(vals[i][16])!=='OPEN')continue;var bid=String(vals[i][2]),pid=String(vals[i][4]),code=String(vals[i][7]),match=dash.find(function(r){return String(r.banquetId)===bid&&String(r.productionId)===pid&&String(r.ttkCode||r.dishCode)===code;});if(match&&!_v48Reason_(match)){sh.getRange(i+1,17).setValue('RESOLVED');sh.getRange(i+1,19).setValue(new Date());resolved++;var tid=String(vals[i][5]||'');try{var t=_v44TaskRow_(tid);if(t&&String(t.Status)!=='DONE')v45RefreshProductionTaskStatuses();}catch(e){}}}return{ok:true,resolved:resolved};}
function v48AutomationTick(fromDate,toDate,token){setupV48DeficitEngine();var c=v48CreateCorrectiveTasks(fromDate,toDate,token),r=v48ResolveClosedDeficits();return{ok:true,createdTasks:c.createdTasks,deficits:c.deficits,resolved:r.resolved};}
function v48GetDashboard(fromDate,toDate,token){setupV48DeficitEngine();var r=v48AnalyzeDeficits(fromDate,toDate,token).rows;return{ok:true,total:r.length,critical:r.filter(function(x){return x.severity==='CRITICAL';}).length,high:r.filter(function(x){return x.severity==='HIGH';}).length,qty:r.reduce(function(s,x){return s+x.deficitQty;},0),rows:r};}
