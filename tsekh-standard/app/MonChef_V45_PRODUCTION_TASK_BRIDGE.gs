/**
 * Mon Chef V45 — Production Task Bridge.
 * V44 task -> real production order -> V27 execution -> task closure.
 * Does not duplicate stock write-off or batch creation: V27 remains the source of truth.
 */
const V45_PROD = {
  LINK:'Задачи_Производство_Связи_V45',
  AUDIT:'Задачи_Производство_Аудит_V45'
};
const V45_HEADERS = {
  LINK:['LinkID','TaskID','ScheduleID','ProductionID','BanquetID','TTKCode','TaskType','PlannedQty','Unit','MatchMethod','MatchConfidence','Status','CreatedAt','UpdatedAt','Notes'],
  AUDIT:['AuditID','TaskID','ProductionID','Action','At','EmployeeID','BeforeStatus','AfterStatus','Result','Message']
};
function _v45Sheet_(name,headers){var ss=_book_();var sh=ss.getSheetByName(name);if(!sh)sh=ss.insertSheet(name);if(sh.getLastRow()===0){sh.appendRow(headers);sh.setFrozenRows(1);}return sh;}
function _v45Rows_(name){var sh=_book_().getSheetByName(name);if(!sh||sh.getLastRow()<2)return[];var v=sh.getDataRange().getValues(),h=v[0];return v.slice(1).filter(function(r){return r.some(function(x){return x!=='';});}).map(function(r){var o={};h.forEach(function(k,i){o[k]=r[i];});return o;});}
function _v45Id_(p){return 'V45-'+p+'-'+Utilities.getUuid().slice(0,8).toUpperCase();}
function setupV45ProductionBridge(){Object.keys(V45_HEADERS).forEach(function(k){_v45Sheet_(V45_PROD[k],V45_HEADERS[k]);});if(typeof setupV44TaskCenter==='function')setupV44TaskCenter();return{ok:true,sheets:V45_PROD};}
function _v45ProductionRows_(){var sh=typeof _productionSheet_==='function'?_productionSheet_():null;if(!sh||sh.getLastRow()<2)return[];var v=sh.getDataRange().getValues();return v.slice(1).filter(function(r){return r[0];}).map(function(r){return{id:String(r[0]),name:String(r[2]||''),code:String(r[3]||''),planned:Number(r[5])||0,actual:r[6]===''?null:Number(r[6]),unit:String(r[7]||''),workshop:String(r[8]||''),employee:String(r[9]||''),status:String(r[12]||''),batch:String(r[14]||''),alloc:String(r[15]||'')};});}
function _v45Norm_(x){return String(x||'').toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/g,' ').replace(/\s+/g,' ').trim();}
function _v45FindBestProduction_(task,rows){
  var code=_v45Norm_(task.TTKCode), qty=Number(task.Qty)||0, unit=_v45Norm_(task.Unit), candidates=rows.filter(function(r){return ['PLANNED','IN_PROGRESS'].indexOf(r.status)>=0 && (!code || _v45Norm_(r.code)===code);});
  // задача банкета не связывается с заданием, распределённым на ДРУГИЕ банкеты (раньше связь шла только по коду ТТК;
  // до исправления записи в строку задачи это не проявлялось — запись уходила в заголовок листа)
  var bq=String(task.BanquetID||'').split(',').map(function(x){return x.trim();}).filter(Boolean);
  if(bq.length)candidates=candidates.filter(function(r){var ev=[];try{ev=JSON.parse(r.alloc||'[]').map(function(a){return String(a&&a.eventId||'');}).filter(Boolean);}catch(e){}return !ev.length||ev.some(function(x){return bq.indexOf(x)>=0;});});
  if(!candidates.length)return null;
  candidates.sort(function(a,b){var sa=0,sb=0; if(qty&&Math.abs(a.planned-qty)<0.0001)sa+=100;if(qty&&Math.abs(b.planned-qty)<0.0001)sb+=100;if(unit&&_v45Norm_(a.unit)===unit)sa+=20;if(unit&&_v45Norm_(b.unit)===unit)sb+=20;if(task.Workshop&&_v45Norm_(a.workshop)===_v45Norm_(task.Workshop))sa+=10;if(task.Workshop&&_v45Norm_(b.workshop)===_v45Norm_(task.Workshop))sb+=10;return sb-sa;});
  return {row:candidates[0],confidence:(qty&&Math.abs(candidates[0].planned-qty)<0.0001?'HIGH':'REVIEW')};
}
function _v45Task_(taskId){return typeof _v44TaskRow_==='function'?_v44TaskRow_(taskId):null;}
function _v45WriteTask_(taskId,obj){var t=_v45Task_(taskId);if(!t)throw new Error('Task not found: '+taskId);var sh=_book_().getSheetByName(V44_TASK.TASK),h=V44_HEADERS.TASK,rows=_v44Rows_(V44_TASK.TASK),ri=t._rowNo;Object.keys(obj).forEach(function(k){var c=h.indexOf(k)+1;if(c>0)sh.getRange(ri,c).setValue(obj[k]);});return ri;}
function _v45LinkRow_(taskId){var rows=_v45Rows_(V45_PROD.LINK);for(var i=0;i<rows.length;i++)if(String(rows[i].TaskID)===String(taskId))return rows[i];return null;}
function _v45Audit_(taskId,productionId,action,employee,beforeStatus,afterStatus,result,message){_v45Sheet_(V45_PROD.AUDIT,V45_HEADERS.AUDIT).appendRow([_v45Id_('AUD'),taskId||'',productionId||'',action,new Date(),employee||'',beforeStatus||'',afterStatus||'',result||'',message||'']);}
function v45BindProductionTask(taskId,productionId,token){
  setupV45ProductionBridge();var t=_v45Task_(taskId);if(!t)throw new Error('Task not found');if(String(t.SourceType)!=='PRODUCTION_SCHEDULE')throw new Error('Привязка production_id доступна только производственным задачам');
  var rows=_v45ProductionRows_(),p=rows.find(function(x){return String(x.id)===String(productionId);});if(!p)throw new Error('Производственное задание не найдено: '+productionId);
  _v45WriteTask_(taskId,{ProductionID:p.id,Status:p.status==='IN_PROGRESS'?'IN_PROGRESS':'PLANNED'});
  var existing=_v45LinkRow_(taskId),sh=_v45Sheet_(V45_PROD.LINK,V45_HEADERS.LINK),now=new Date();
  if(existing){var data=sh.getDataRange().getValues(),h=data[0],ri=-1;for(var i=1;i<data.length;i++)if(String(data[i][1])===String(taskId)){ri=i+1;break;}if(ri>0){sh.getRange(ri,h.indexOf('ProductionID')+1).setValue(p.id);sh.getRange(ri,h.indexOf('UpdatedAt')+1).setValue(now);}}
  else sh.appendRow([_v45Id_('LINK'),taskId,t.SourceID,p.id,t.BanquetID||'',t.TTKCode||'',t.TaskType||'',t.Qty||'',t.Unit||'','MANUAL', 'HIGH', 'LINKED',now,now,'']);
  _v45Audit_(taskId,p.id,'BIND',String(t.AssignedTo||''),t.Status,p.status==='IN_PROGRESS'?'IN_PROGRESS':'PLANNED','OK','Задача связана с реальным производственным заданием');
  return{ok:true,taskId:taskId,productionId:p.id,productionStatus:p.status};
}
function v45AutoBindProductionTasks(fromDate,token){
  setupV45ProductionBridge();var tasks=_v44Rows_(V44_TASK.TASK).filter(function(t){return String(t.SourceType)==='PRODUCTION_SCHEDULE'&&!String(t.ProductionID||'')&&['PLANNED','READY','IN_PROGRESS','OVERDUE'].indexOf(String(t.Status))>=0;});var prods=_v45ProductionRows_(),created=0,review=0,linked=0;
  tasks.forEach(function(t){var b=_v45FindBestProduction_(t,prods);if(!b){review++;return;}var r=b.row;var method=b.confidence==='HIGH'?'CODE_QTY_UNIT':'CODE_REVIEW';try{v45BindProductionTask(t.TaskID,r.id,token);var sh=_v45Sheet_(V45_PROD.LINK,V45_HEADERS.LINK),v=sh.getDataRange().getValues();for(var i=1;i<v.length;i++)if(String(v[i][1])===String(t.TaskID)){sh.getRange(i+1,sh.getRange(1,1,1,V45_HEADERS.LINK.length).getValues()[0].indexOf('MatchMethod')+1).setValue(method);sh.getRange(i+1,sh.getRange(1,1,1,V45_HEADERS.LINK.length).getValues()[0].indexOf('MatchConfidence')+1).setValue(b.confidence);break;}linked++;}catch(e){review++;}});
  return{ok:true,scanned:tasks.length,linked:linked,review:review,created:created};
}
function v45GetProductionStatus(taskId,token){setupV45ProductionBridge();var t=_v45Task_(taskId);if(!t)throw new Error('Task not found');var pid=String(t.ProductionID||'');if(!pid)return{ok:true,linked:false,taskId:taskId};var p=_v45ProductionRows_().find(function(x){return String(x.id)===pid;});if(!p)return{ok:false,linked:true,productionId:pid,error:'Производственное задание удалено или не найдено'};return{ok:true,linked:true,taskId:taskId,productionId:p.id,status:p.status,planned:p.planned,actual:p.actual,unit:p.unit,batch:p.batch,product:p.name};}
function v45StartProductionTask(taskId,employee,token){
  setupV45ProductionBridge();var t=_v45Task_(taskId);if(!t)throw new Error('Task not found');var pid=String(t.ProductionID||'');if(!pid)throw new Error('Сначала привяжите production_id к задаче');var before=v45GetProductionStatus(taskId,token);if(before.status==='COMPLETED')return{ok:true,idempotent:true,taskId:taskId,productionId:pid,status:'COMPLETED'};
  var raw=typeof startV27Production==='function'?startV27Production(pid,token):startProduction(pid,token),r=typeof _mcV27Parse_==='function'?_mcV27Parse_(raw):raw;if(r&&r.ok===false)throw new Error((r.error&&r.error.message)||'Не удалось запустить производство');
  _v45WriteTask_(taskId,{Status:'IN_PROGRESS',AssignedTo:employee||t.AssignedTo||'' ,StartedAt:new Date()});_v45Audit_(taskId,pid,'START',employee,before.status,'IN_PROGRESS','OK','Производство запущено через V27');return{ok:true,taskId:taskId,productionId:pid,status:'IN_PROGRESS',production:r};
}
function v45CompleteProductionTask(taskId,employee,token){
  setupV45ProductionBridge();var t=_v45Task_(taskId);if(!t)throw new Error('Task not found');var pid=String(t.ProductionID||'');if(!pid)throw new Error('У задачи нет production_id');var s=v45GetProductionStatus(taskId,token);if(!s.linked||!s.productionId)throw new Error('Производственное задание не найдено');if(String(s.status)!=='COMPLETED')throw new Error('Нельзя закрыть задачу: производство ещё не завершено. Текущий статус: '+s.status);
  _v45WriteTask_(taskId,{Status:'DONE',CompletedAt:new Date(),CompletedBy:employee||t.AssignedTo||'',FactID:s.batch?'BATCH:'+s.batch:''});_v45Audit_(taskId,pid,'COMPLETE',employee,t.Status,'DONE','OK','Задача закрыта только после фактического выпуска'+(s.batch?' партии '+s.batch:''));return{ok:true,taskId:taskId,productionId:pid,status:'DONE',batch:s.batch,actual:s.actual};
}
function v45RefreshProductionTaskStatuses(token){setupV45ProductionBridge();var tasks=_v44Rows_(V44_TASK.TASK).filter(function(t){return String(t.ProductionID||'')&&String(t.SourceType)==='PRODUCTION_SCHEDULE'&&String(t.Status)!=='DONE';}),prods=_v45ProductionRows_(),updated=0,completed=0;tasks.forEach(function(t){var p=prods.find(function(x){return String(x.id)===String(t.ProductionID);});if(!p)return;var ns=p.status==='IN_PROGRESS'?'IN_PROGRESS':p.status==='COMPLETED'?'DONE':p.status==='CANCELLED'?'CANCELLED':t.Status;if(ns!==t.Status){_v45WriteTask_(t.TaskID,{Status:ns,CompletedAt:ns==='DONE'?new Date():'',CompletedBy:ns==='DONE'?'SYSTEM':''});updated++;if(ns==='DONE')completed++;}});return{ok:true,updated:updated,completed:completed};}
function v45GetDashboard(){setupV45ProductionBridge();var l=_v45Rows_(V45_PROD.LINK),t=_v44Rows_(V44_TASK.TASK).filter(function(x){return String(x.SourceType)==='PRODUCTION_SCHEDULE';});return{productionTasks:t.length,linked:l.filter(function(x){return String(x.Status)==='LINKED';}).length,review:l.filter(function(x){return String(x.MatchConfidence)==='REVIEW';}).length,unlinked:t.filter(function(x){return !String(x.ProductionID||'');}).length};}
