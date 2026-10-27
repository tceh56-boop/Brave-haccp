/**
 * Mon Chef V44 — Unified Task Center + manual task creation.
 * Manual tasks enter the same operational task stream as automated tasks.
 * No regulatory values are invented here.
 */
const V44_TASK = {
  TASK: 'Задачи_Единый_V44',
  EXEC: 'Задачи_Выполнение_V44',
  SOURCE: 'Задачи_Источники_V44',
  ALERT: 'Задачи_Алерты_V44'
};
const V44_HEADERS = {
  TASK: ['TaskID','SourceType','SourceID','Title','Description','TaskType','DueAt','WindowMin','AssignedTo','Role','AreaID','Priority','Status','CreatedAt','CreatedBy','StartedAt','CompletedAt','CompletedBy','FactID','DeviationID','Notes','BanquetID','ProductionID','TTKCode','Qty','Unit','Workshop'],
  EXEC: ['ExecutionID','TaskID','DateTime','EmployeeID','Status','Comment','Result','FactID','DeviationID','CreatedAt'],
  SOURCE: ['SourceID','TaskID','SourceType','SourceObjectID','CreatedAt','CreatedBy','Notes'],
  ALERT: ['AlertID','AlertType','TaskID','DateTime','Severity','Message','Status','CreatedAt','ResolvedAt']
};
function _v44Sheet_(name,headers){var ss=_book_();var sh=ss.getSheetByName(name);if(!sh)sh=ss.insertSheet(name);if(sh.getLastRow()===0){sh.appendRow(headers);sh.setFrozenRows(1);}return sh;}
function _v44Rows_(name){var sh=_book_().getSheetByName(name);if(!sh||sh.getLastRow()<2)return[];var v=sh.getDataRange().getValues(),h=v[0],out=[];for(var i=1;i<v.length;i++){var r=v[i];if(!r.some(function(x){return x!=='';}))continue;var o={};h.forEach(function(k,j){o[k]=r[j];});o._row=r;o._rowNo=i+1;out.push(o);}return out;} // _rowNo — номер строки листа (раньше строку искали indexOf по объекту из другого чтения: -1 → запись в заголовок)
function _v44Id_(p){return 'TASK44-'+p+'-'+Utilities.getUuid().slice(0,8).toUpperCase();}
function setupV44TaskCenter(){Object.keys(V44_HEADERS).forEach(function(k){_v44Sheet_(V44_TASK[k],V44_HEADERS[k]);});try{if(typeof setupV43SanitationChecklist==='function')setupV43SanitationChecklist();}catch(e){}return{ok:true,sheets:V44_TASK};}
function v44CreateTask(p,token){
  setupV44TaskCenter(); p=p||{};
  var title=String(p.title||'').trim(); if(!title)throw new Error('Название задачи обязательно');
  var due=p.dueAt?new Date(p.dueAt):new Date(); if(isNaN(due.getTime()))throw new Error('Некорректный срок задачи');
  var priority=String(p.priority||'NORMAL').toUpperCase(); if(['LOW','NORMAL','HIGH','CRITICAL'].indexOf(priority)<0)priority='NORMAL';
  var status='PLANNED', now=new Date(), taskId=_v44Id_('M');
  var sh=_v44Sheet_(V44_TASK.TASK,V44_HEADERS.TASK);
  sh.appendRow([taskId,'MANUAL',String(p.sourceId||''),title,String(p.description||''),String(p.taskType||'GENERAL'),due,Number(p.windowMin||60),String(p.assignedTo||''),String(p.role||''),String(p.areaId||''),priority,status,now,String(p.createdBy||p.assignedTo||''),'','','','','',String(p.notes||''),String(p.banquetId||''),String(p.productionId||''),String(p.ttkCode||''),p.qty===''||p.qty==null?'':Number(p.qty),String(p.unit||''),String(p.workshop||'')]);
  var ss=_v44Sheet_(V44_TASK.SOURCE,V44_HEADERS.SOURCE); ss.appendRow([_v44Id_('SRC'),taskId,'MANUAL',String(p.sourceId||''),now,String(p.createdBy||p.assignedTo||''),String(p.notes||'')]);
  return {ok:true,taskId:taskId,status:status,sourceType:'MANUAL',createdAt:now};
}
function _v44FindColumn_(headers,name){return headers.indexOf(name)+1;}
function _v44WriteByHeader_(sh,headers,row,obj){Object.keys(obj||{}).forEach(function(k){var c=_v44FindColumn_(headers,k);if(c>0)sh.getRange(row,c).setValue(obj[k]);});}
function _v44Event_(id){try{return id&&typeof _getEventById_==='function'?_getEventById_(id):null;}catch(e){return null;}}
function _v44TaskBySource_(sourceType,sourceId){var rows=_v44Rows_(V44_TASK.TASK);for(var i=0;i<rows.length;i++)if(String(rows[i].SourceType)===String(sourceType)&&String(rows[i].SourceID)===String(sourceId))return rows[i];return null;}
function _v44UpsertTask_(data){
  setupV44TaskCenter();var sh=_v44Sheet_(V44_TASK.TASK,V44_HEADERS.TASK),rows=_v44Rows_(V44_TASK.TASK),found=_v44TaskBySource_(data.sourceType,data.sourceId),now=new Date(),h=V44_HEADERS.TASK;
  if(found){var ri=found._rowNo;_v44WriteByHeader_(sh,h,ri,{Title:data.title,Description:data.description,TaskType:data.taskType,DueAt:data.dueAt,WindowMin:data.windowMin||60,Role:data.role||'',AreaID:data.areaId||'',Priority:data.priority||'NORMAL',BanquetID:data.banquetId||'',ProductionID:data.productionId||'',TTKCode:data.ttkCode||'',Qty:data.qty==null?'':data.qty,Unit:data.unit||'',Workshop:data.workshop||''});if(data.status==='DONE')_v44WriteByHeader_(sh,h,ri,{Status:'DONE',CompletedAt:found.CompletedAt||now});return found.TaskID;}
  var id=_v44Id_('AUTO'),row={TaskID:id,SourceType:data.sourceType,SourceID:data.sourceId,Title:data.title,Description:data.description||'',TaskType:data.taskType||'GENERAL',DueAt:data.dueAt,WindowMin:data.windowMin||60,AssignedTo:data.assignedTo||'',Role:data.role||'',AreaID:data.areaId||'',Priority:data.priority||'NORMAL',Status:data.status||'PLANNED',CreatedAt:now,CreatedBy:data.createdBy||'SYSTEM',StartedAt:'',CompletedAt:data.status==='DONE'?now:'',CompletedBy:data.status==='DONE'?'SYSTEM':'',FactID:'',DeviationID:'',Notes:data.notes||'',BanquetID:data.banquetId||'',ProductionID:data.productionId||'',TTKCode:data.ttkCode||'',Qty:data.qty==null?'':data.qty,Unit:data.unit||'',Workshop:data.workshop||''};sh.appendRow(h.map(function(k){return row[k]!==undefined?row[k]:'';}));_v44Sheet_(V44_TASK.SOURCE,V44_HEADERS.SOURCE).appendRow([_v44Id_('SRC'),id,data.sourceType,data.sourceId,now,data.createdBy||'SYSTEM',data.notes||'']);return id;
}
function v44SyncProductionTasks(fromDate,token){
  setupV44TaskCenter();var actor='SYSTEM';try{actor=_mcV20Actor_(token)||actor;}catch(e){}
  var sh=_book_().getSheetByName('Производство_План_V25');if(!sh||sh.getLastRow()<2)return{ok:true,count:0,created:0,updated:0};
  var v=sh.getDataRange().getValues(),count=0,created=0,updated=0,from=fromDate?new Date(fromDate):new Date();from.setHours(0,0,0,0);var to=new Date(from);to.setDate(to.getDate()+7);
  for(var i=1;i<v.length;i++){
    var taskDate=v[i][4],dueText=String(v[i][6]||'16:00'),due=new Date(String(taskDate).slice(0,10)+'T'+dueText+':00');if(isNaN(due.getTime()))continue;if(due<from||due>=to)continue;
    var sid=String(v[i][0]||'');if(!sid)continue;var banquetId=String(v[i][2]||''),ev=_v44Event_(banquetId.split(',')[0]||'');var eventText=ev?((ev.format||ev.name||'Банкет')+' '+(ev.date||'')+' '+(ev.time||'')):('Банкет '+banquetId)+(banquetId.indexOf(',')>0?' (общее задание для банкетов '+banquetId+')':'');
    var status=String(v[i][16]||'PLANNED');var existing=_v44TaskBySource_('PRODUCTION_SCHEDULE',sid);var data={sourceType:'PRODUCTION_SCHEDULE',sourceId:sid,title:'Производство: '+String(v[i][10]||'')+' — '+String(v[i][11]||'')+' '+String(v[i][12]||''),description:eventText+(v[i][13]?' · цех: '+v[i][13]:''),taskType:String(v[i][8]||'PRODUCTION'),dueAt:due,windowMin:60,role:'Повар',areaId:String(v[i][13]||''),priority:due.getTime()-Date.now()<2*3600000?'HIGH':'NORMAL',status:status==='COMPLETED'?'DONE':'PLANNED',createdBy:actor,banquetId:banquetId,ttkCode:String(v[i][9]||''),qty:Number(v[i][11])||0,unit:String(v[i][12]||''),workshop:String(v[i][13]||''),notes:'Автоматически из графика производства V25'};
    _v44UpsertTask_(data);count++;if(existing)updated++;else created++;
  }
  return{ok:true,count:count,created:created,updated:updated};
}
function v44SyncBanquetProduction(fromDate,token){return v44SyncProductionTasks(fromDate,token);}
function v44GetTasks(p,token){
  setupV44TaskCenter(); p=p||{}; var now=new Date(), horizon=new Date(now.getTime()+24*3600000), emp=String(p.employee||'').trim();
  var rows=_v44Rows_(V44_TASK.TASK).filter(function(x){return ['PLANNED','READY','IN_PROGRESS','OVERDUE'].indexOf(String(x.Status))>=0;});
  if(emp)rows=rows.filter(function(x){return !x.AssignedTo||String(x.AssignedTo)===emp;});
  if(p.todayOnly!==false)rows=rows.filter(function(x){return x.DueAt instanceof Date && x.DueAt<=horizon;});
  rows.forEach(function(x){if(x.DueAt instanceof Date && x.DueAt.getTime()<now.getTime() && ['PLANNED','READY','IN_PROGRESS'].indexOf(String(x.Status))>=0)x._overdue=true;});
  return rows.map(function(x){return {taskId:x.TaskID,sourceType:x.SourceType,sourceId:x.SourceID,title:x.Title,description:x.Description,taskType:x.TaskType,dueAt:x.DueAt,assignedTo:x.AssignedTo,role:x.Role,areaId:x.AreaID,priority:x.Priority,status:x._overdue?'OVERDUE':x.Status,createdBy:x.CreatedBy,banquetId:x.BanquetID||'',productionId:x.ProductionID||'',ttkCode:x.TTKCode||'',qty:x.Qty===''?'':Number(x.Qty)||0,unit:x.Unit||'',workshop:x.Workshop||''};});
}
function _v44TaskRow_(taskId){var rows=_v44Rows_(V44_TASK.TASK);return rows.find(function(x){return String(x.TaskID)===String(taskId);})||null;}
function v44StartTask(taskId,employee,token){setupV44TaskCenter();var t=_v44TaskRow_(taskId);if(!t)throw new Error('Task not found');var sh=_v44Sheet_(V44_TASK.TASK,V44_HEADERS.TASK),rows=_v44Rows_(V44_TASK.TASK),ri=t._rowNo,h=V44_HEADERS.TASK;sh.getRange(ri,h.indexOf('Status')+1).setValue('IN_PROGRESS');sh.getRange(ri,h.indexOf('StartedAt')+1).setValue(new Date());if(employee)sh.getRange(ri,h.indexOf('AssignedTo')+1).setValue(employee);return{ok:true,taskId:taskId,status:'IN_PROGRESS'};}
function v44CompleteTask(p,token){
  setupV44TaskCenter(); p=p||{}; var t=_v44TaskRow_(p.taskId);if(!t)throw new Error('Task not found');if(String(t.Status)==='DONE')return{ok:true,idempotent:true,taskId:p.taskId};
  var now=new Date(),execId=_v44Id_('EXEC'),factId=_v44Id_('FACT'),result=String(p.status||'DONE').toUpperCase()==='FAILED'?'DEVIATION':'OK';
  _v44Sheet_(V44_TASK.EXEC,V44_HEADERS.EXEC).appendRow([execId,t.TaskID,now,String(p.employeeId||t.AssignedTo||''),p.status||'DONE',String(p.comment||''),result,factId,String(p.deviationId||''),now]);
  var sh=_v44Sheet_(V44_TASK.TASK,V44_HEADERS.TASK),rows=_v44Rows_(V44_TASK.TASK),ri=t._rowNo,h=V44_HEADERS.TASK;sh.getRange(ri,h.indexOf('Status')+1).setValue('DONE');sh.getRange(ri,h.indexOf('CompletedAt')+1).setValue(now);sh.getRange(ri,h.indexOf('CompletedBy')+1).setValue(p.employeeId||t.AssignedTo||'');sh.getRange(ri,h.indexOf('FactID')+1).setValue(factId);if(result==='DEVIATION'){var aid=v44CreateAlert_('TASK_FAILED',t.TaskID,'HIGH','Ручная/операционная задача завершена с отклонением',now);sh.getRange(ri,h.indexOf('DeviationID')+1).setValue(p.deviationId||aid);}return{ok:true,taskId:t.TaskID,executionId:execId,factId:factId,result:result};
}
function v44CreateAlert_(type,taskId,sev,msg,now){var sh=_v44Sheet_(V44_TASK.ALERT,V44_HEADERS.ALERT),id=_v44Id_('ALT');sh.appendRow([id,type,taskId,now,sev,msg,'OPEN',now,'']);return id;}
function v44BuildAlerts(){setupV44TaskCenter();var now=new Date(),created=0;_v44Rows_(V44_TASK.TASK).forEach(function(t){if(['PLANNED','READY','IN_PROGRESS'].indexOf(String(t.Status))>=0&&t.DueAt instanceof Date&&t.DueAt.getTime()<now.getTime()){v44CreateAlert_('TASK_OVERDUE',t.TaskID,String(t.Priority)==='CRITICAL'?'CRITICAL':'HIGH','Просрочена задача: '+String(t.Title||''),now);created++;}});return{ok:true,created:created};}
function v44GetDashboard(){setupV44TaskCenter();var r=_v44Rows_(V44_TASK.TASK),now=new Date();return{total:r.length,open:r.filter(function(x){return ['PLANNED','READY','IN_PROGRESS','OVERDUE'].indexOf(String(x.Status))>=0;}).length,manual:r.filter(function(x){return String(x.SourceType)==='MANUAL';}).length,overdue:r.filter(function(x){return ['PLANNED','READY','IN_PROGRESS'].indexOf(String(x.Status))>=0&&x.DueAt instanceof Date&&x.DueAt<now;}).length,critical:r.filter(function(x){return String(x.Priority)==='CRITICAL'&&String(x.Status)!=='DONE';}).length};}
