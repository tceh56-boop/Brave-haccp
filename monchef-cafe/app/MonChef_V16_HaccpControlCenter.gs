/**
 * MON CHEF V16 — HACCP CONTROL CENTER
 *
 * Реальное оборудование -> контроль -> ожидаемая задача -> напоминание -> факт -> отклонение.
 * Модуль не подменяет измерение: фактический показатель всегда вводит сотрудник.
 */
var MC_V16_EQUIPMENT = 'HACCP_Оборудование';
var MC_V16_TASKS = 'HACCP_Задачи';

function _mcV16Sheet_(name, headers) {
  var ss = _book_(), sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(headers); sh.setFrozenRows(1); }
  return sh;
}
function _mcV16EquipmentSheet_() {
  return _mcV16Sheet_(MC_V16_EQUIPMENT, ['EquipmentID','Name','Type','Zone','ControlID','Responsible','Enabled','Min','Max','Unit','Critical','Notes','CreatedAt','UpdatedAt']);
}
function _mcV16TasksSheet_() {
  return _mcV16Sheet_(MC_V16_TASKS, ['TaskID','ControlID','EquipmentID','EquipmentName','TaskDate','DueTime','Deadline','Status','FactValue','Unit','Employee','AnsweredAt','DeviationID','NotificationState','CreatedAt','UpdatedAt']);
}
function _mcV16ControlRows_() {
  var sh=_mcV15HaccpControlsSheet_(), v=sh.getDataRange().getValues(), out=[];
  for(var i=1;i<v.length;i++) if(v[i][0]) out.push({id:String(v[i][0]),name:String(v[i][1]||''),type:String(v[i][2]||''),journalId:String(v[i][3]||''),object:String(v[i][4]||''),question:String(v[i][5]||''),schedule:String(v[i][6]||''),parameter:String(v[i][7]||''),mode:String(v[i][8]||'да_нет'),unit:String(v[i][9]||''),min:v[i][10],max:v[i][11],critical:v[i][12]===true,responsible:String(v[i][13]||''),enabled:v[i][14]!==false,reminder:Number(v[i][15]||60)});
  return out;
}
function seedMonChefHaccpEquipment(token) {
  try { _requireAuth_(token,'journals');
    var sh=_mcV16EquipmentSheet_(); if(sh.getLastRow()>1) return JSON.stringify({ok:true,added:0});
    var now=new Date(), rows=[
      ['EQ-FR-01','Холодильник №1','REFRIGERATOR','Холодильная зона','HC-FR-01','Шеф-повар',true,-2,8,'°C',true,''],
      ['EQ-FR-02','Холодильник №2','REFRIGERATOR','Холодильная зона','HC-FR-01','Шеф-повар',true,-2,8,'°C',true,''],
      ['EQ-FZ-01','Морозильник №1','FREEZER','Морозильная зона','HC-FR-01','Шеф-повар',true,-25,-18,'°C',true,'Для морозильной камеры границы рекомендуется уточнить в настройках предприятия'],
      ['EQ-ST-01','Складская зона №1','STORAGE','Сухой склад','HC-ST-01','Кладовщик',true,0,25,'°C',false,'Границы уточняются по зоне'],
      ['EQ-OIL-01','Фритюр №1','FRYER','Горячий цех','HC-OIL-01','Шеф-повар',true,'','','',true,'Порог замены настраивается по фактическому регламенту предприятия']
    ];
    rows.forEach(function(r){sh.appendRow(r.concat([now,now]));});
    return JSON.stringify({ok:true,added:rows.length});
  } catch(e){return JSON.stringify({ok:false,error:String(e)});}
}
function getHaccpEquipment(token) {
  try { _requireAuth_(token,null); var v=_mcV16EquipmentSheet_().getDataRange().getValues(), out=[];
    for(var i=1;i<v.length;i++) if(v[i][0]) out.push({id:v[i][0],name:v[i][1],type:v[i][2],zone:v[i][3],controlId:v[i][4],responsible:v[i][5],enabled:v[i][6]!==false,min:v[i][7],max:v[i][8],unit:v[i][9],critical:v[i][10]===true,notes:v[i][11]||''});
    return _ok_({equipment:out});
  } catch(e){return _failFrom_(e);}
}
function upsertHaccpEquipment(json,token) {
  try { _requireAuth_(token,'journals'); var d=JSON.parse(json||'{}'); if(!d.name||!d.controlId) return _fail_('VALIDATION','Название оборудования и ControlID обязательны');
    var sh=_mcV16EquipmentSheet_(), v=sh.getDataRange().getValues(), row=-1;
    for(var i=1;i<v.length;i++) if(String(v[i][0])===String(d.id||'')){row=i+1;break;}
    var id=d.id||('EQ-'+Date.now()), now=new Date(), vals=[id,d.name,d.type||'CUSTOM',d.zone||'',d.controlId,d.responsible||'',d.enabled!==false,d.min==null?'':d.min,d.max==null?'':d.max,d.unit||'',d.critical===true,d.notes||''];
    if(row<0) sh.appendRow(vals.concat([now,now])); else sh.getRange(row,1,1,14).setValues([vals.concat([v[row-1][12]||now,now])]);
    return _ok_({id:id});
  } catch(e){return _failFrom_(e);}
}
function _mcV16Today_(d){return Utilities.formatDate(d||new Date(),_mcTz_(),'yyyy-MM-dd');}
function _mcV16TaskKey_(control,equipment,date,hm){return [control,equipment,date,hm].join('|');}
function _mcV16GenerateEquipmentTasks_() {
  generateJournalPending();
  var today=_mcV16Today_(), controls=_mcV16ControlRows_(), equipmentSheet=_mcV16EquipmentSheet_(), ev=equipmentSheet.getDataRange().getValues(), tasks=_mcV16TasksSheet_(), tv=tasks.getDataRange().getValues(), have={};
  for(var i=1;i<tv.length;i++) if(tv[i][0]) have[_mcV16TaskKey_(tv[i][1],tv[i][2],tv[i][4],tv[i][5])]=true;
  var added=0, rows=[];
  for(var e=1;e<ev.length;e++){
    if(!ev[e][0]||ev[e][6]===false) continue;
    var eqId=String(ev[e][0]), eqName=String(ev[e][1]), cid=String(ev[e][4]), c=null;
    for(var cidx=0;cidx<controls.length;cidx++) if(controls[cidx].id===cid){c=controls[cidx];break;}
    if(!c||!c.enabled) continue;
    var times=_trigTimes_({тип:c.schedule,parametr:c.parameter},_shift_(),new Date());
    times.forEach(function(hm){var key=_mcV16TaskKey_(cid,eqId,today,hm);if(have[key])return;var mins=_hm2min_(hm);rows.push(['HT'+Date.now()+'-'+(rows.length+1),cid,eqId,eqName,today,hm,_min2hm_(mins+(c.reminder||60)),'ОЖИДАЕТ','',''+(c.unit||ev[e][9]||''),'','', '', 'NEW',new Date(),new Date()]);have[key]=true;added++;});
  }
  if(rows.length) tasks.getRange(tasks.getLastRow()+1,1,rows.length,16).setValues(rows);
  return added;
}
function runMonChefHaccpControlCenterCycle(token) {
  try { if(token)_requireAuth_(token,'journals'); var added=_mcV16GenerateEquipmentTasks_(), result=_mcV16NotifyEquipmentTasks_(); return JSON.stringify({ok:true,data:{tasksAdded:added,notifications:result,checkedAt:new Date()}}); }
  catch(e){return JSON.stringify({ok:false,error:String(e)});}
}
function runMonChefHaccpControlCenterCycleSystem(){return runMonChefHaccpControlCenterCycle(null);}
function _mcV16NotifyEquipmentTasks_(){
  var sh=_mcV16TasksSheet_(), v=sh.getDataRange().getValues(), today=_mcV16Today_(), nowMin=_hm2min_(Utilities.formatDate(new Date(),_mcTz_(),'HH:mm')), count=0;
  for(var i=1;i<v.length;i++){
    if(!v[i][0]||String(v[i][4])!==today||String(v[i][7])==='ВЫПОЛНЕНО') continue;
    var due=_hm2min_(v[i][5]), deadline=_hm2min_(v[i][6]); if(due===null||deadline===null)continue;
    var overdue=nowMin>deadline, soon=!overdue&&nowMin>=due-30; if(!overdue&&!soon)continue;
    var state=overdue?'OVERDUE':'REMINDER'; if(String(v[i][13])===state)continue;
    var sev=overdue?'warning':'info', title=(overdue?'Просрочен':'Скоро')+' контроль: '+v[i][3], text='Проверить: '+v[i][3]+' · до '+v[i][6];
    var nid=_notify_('haccp_equipment',sev,title,text,'', 'haccp_equipment|'+v[i][0],null);
    if(nid){sh.getRange(i+1,14).setValue(state);sh.getRange(i+1,16).setValue(new Date());count++;}
  }
  return count;
}
function getHaccpControlCenter(token) {
  try { _requireAuth_(token,null); _mcV16GenerateEquipmentTasks_(); var sh=_mcV16TasksSheet_(),v=sh.getDataRange().getValues(),today=_mcV16Today_(),out=[],due=0,overdue=0,done=0;
    var now=_hm2min_(Utilities.formatDate(new Date(),_mcTz_(),'HH:mm'));
    for(var i=1;i<v.length;i++){if(!v[i][0]||String(v[i][4])!==today)continue;var st=String(v[i][7]);if(st==='ВЫПОЛНЕНО')done++;else {var dl=_hm2min_(v[i][6]);if(dl!==null&&now>dl)overdue++;else due++;}out.push({id:v[i][0],controlId:v[i][1],equipmentId:v[i][2],equipment:v[i][3],date:v[i][4],due:v[i][5],deadline:v[i][6],status:st,fact:v[i][8],unit:v[i][9],employee:v[i][10],answeredAt:v[i][11],deviationId:v[i][12]});}
    return _ok_({date:today,summary:{total:out.length,due:due,overdue:overdue,done:done},tasks:out});
  } catch(e){return _failFrom_(e);}
}
function completeHaccpEquipmentTask(json,token) {
  try { var op=_beginOp_(token,'journals','HACCP_EQUIPMENT_TASK_COMPLETE','HACCP',null,null), d=JSON.parse(json||'{}'); if(!d.id){_endOp_(op,'FAILED');return _fail_('VALIDATION','Не указана задача',op.id);}
    return _withLock_(function(){var sh=_mcV16TasksSheet_(),v=sh.getDataRange().getValues(),row=-1;for(var i=1;i<v.length;i++)if(String(v[i][0])===String(d.id)){row=i+1;break;}if(row<0){_endOp_(op,'FAILED');return _fail_('NOT_FOUND','Задача не найдена',op.id);}if(String(v[row-1][7])==='ВЫПОЛНЕНО'){_endOp_(op,'FAILED');return _fail_('VALIDATION','Задача уже выполнена',op.id);}var controlId=v[row-1][1], controls=_mcV16ControlRows_(), c=null;for(var j=0;j<controls.length;j++)if(controls[j].id===String(controlId)){c=controls[j];break;}c=c||{};var val=(d.value===''||d.value==null)?null:Number(String(d.value).replace(',','.'));if(c.mode==='число'&&(val===null||isNaN(val))){_endOp_(op,'FAILED');return _fail_('VALIDATION','Нужно фактическое числовое значение',op.id);}var out=false;if(val!==null&&!isNaN(val)){if(c.min!==''&&c.min!=null&&val<Number(c.min))out=true;if(c.max!==''&&c.max!=null&&val>Number(c.max))out=true;}var emp=d.employee||'';var now=new Date(), status=out?'ОТКЛОНЕНИЕ':'ВЫПОЛНЕНО';sh.getRange(row,8,1,6).setValues([[status,val,c.unit||'',emp,now,'']]);sh.getRange(row,16).setValue(now);
      if(out){var dev=_devSheet_();var did='DV'+Date.now();dev.appendRow([did,'',c.journalId||'',v[row-1][3],'Значение вне установленного диапазона',val,c.critical===true,'ОТКРЫТО','', '',emp,now,'','']);sh.getRange(row,13).setValue(did);if(c.critical===true){_notify_('haccp_critical','critical','Критическое отклонение: '+v[row-1][3],'Фактическое значение '+val+' '+(c.unit||'')+' вне допустимого диапазона. Отклонение '+did,'Шеф-повар','haccp_critical|'+did,op);}}
      _endOp_(op);return _ok_({id:d.id,status:status,value:val,deviationId:out?sh.getRange(row,13).getValue():'',operationId:op.id});
    });
  } catch(e){return _failFrom_(e);}
}
function installMonChefHaccpControlCenterTrigger(token){try{_requireAuth_(token,'audit_create');ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction()==='runMonChefHaccpControlCenterCycleSystem')ScriptApp.deleteTrigger(t);});ScriptApp.newTrigger('runMonChefHaccpControlCenterCycleSystem').timeBased().everyMinutes(15).create();return _ok_({message:'Центр HACCP будет проверяться каждые 15 минут'});}catch(e){return _failFrom_(e);}}
