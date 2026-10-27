/**
 * MON CHEF V30 — COMPLIANCE / HACCP CORE
 *
 * Операционный контур предприятия: карта процессов → опасности → CCP/OPRP →
 * критические пределы → мониторинг → корректирующие действия → верификация.
 * Дополнительно: ППК, лабораторный план, санитарные задачи, допуск персонала,
 * реестр документов и инспекторский readiness-dashboard.
 *
 * Важно: V30 не объявляет предприятие «соответствующим Роспотребнадзору».
 * Система хранит и контролирует фактические процедуры предприятия; нормативные
 * пределы и периодичность должны быть утверждены ответственным лицом по
 * применимым НПА, ТР ТС, СанПиН, методикам и внутренним документам.
 */

var MC_V30 = {
  PROCESS:'HACCP_Процессы_V30', HAZARD:'HACCP_Опасности_V30', CCP:'HACCP_ТочкиКонтроля_V30',
  MON:'HACCP_Мониторинг_V30', VERIFY:'HACCP_Верификация_V30', PPK:'ППК_V30',
  SAN:'Санитария_V30', PERSON:'Персонал_Допуск_V30', AUDIT:'HACCP_Аудит_V30'
};

function _v30Sheet_(name, headers) {
  var sh=_book_().getSheetByName(name);
  if(!sh){ sh=_book_().insertSheet(name); sh.appendRow(headers); sh.setFrozenRows(1); }
  return sh;
}
function _v30Rows_(name){ var sh=_book_().getSheetByName(name); if(!sh)return []; var v=sh.getDataRange().getValues(); return v.length>1?v.slice(1):[]; }
function _v30Id_(p){ return p+'-'+Utilities.getUuid(); }
function _v30Date_(x){ if(!x)return null; var d=x instanceof Date?x:_parseDate_(x); return d||null; }
function _v30Bool_(x){ return x===true || String(x).toLowerCase()==='true' || String(x).toLowerCase()==='да'; }
function _v30Actor_(op){ return op&&op.session?(op.session.fullName||op.session.user_id||''):''; }

function _v30Init_(){
  _v30Sheet_(MC_V30.PROCESS,['ProcessID','Code','Name','Sequence','Input','Output','Responsible','Status','Version','ApprovedAt','ApprovedBy','Notes','CreatedAt','CreatedBy']);
  _v30Sheet_(MC_V30.HAZARD,['HazardID','ProcessID','Category','Hazard','Cause','PreventiveMeasure','Severity','Likelihood','Risk','Significant','ExistingControl','Evidence','Status','CreatedAt','CreatedBy']);
  _v30Sheet_(MC_V30.CCP,['ControlID','ProcessID','HazardID','Type','ControlPoint','CriticalLimit','LimitUnit','MonitoringMethod','Frequency','Responsible','CorrectiveAction','VerificationMethod','RecordSource','Status','Version','ApprovedAt','ApprovedBy','CreatedAt','CreatedBy']);
  _v30Sheet_(MC_V30.MON,['MonitoringID','ControlID','Object','Parameter','Unit','TargetMin','TargetMax','Frequency','Responsible','JournalID','FactType','DueRule','Enabled','Status','CreatedAt','CreatedBy']);
  _v30Sheet_(MC_V30.VERIFY,['VerificationID','ControlID','Date','Method','Result','Evidence','Reviewer','CorrectiveAction','Status','CreatedAt','CreatedBy']);
  _v30Sheet_(MC_V30.PPK,['PPKID','Name','Version','DateFrom','DateTo','Status','Responsible','ApprovedBy','ApprovedAt','FileID','Hash','Notes','CreatedAt','CreatedBy']);
  _v30Sheet_(MC_V30.SAN,['SanitationID','Zone','Task','Frequency','Method','Chemical','Concentration','ContactTime','Responsible','LastDone','NextDue','Status','Evidence','CreatedAt','CreatedBy']);
  _v30Sheet_(MC_V30.PERSON,['RecordID','EmployeeID','FullName','Role','MedicalValidTo','TrainingValidTo','HygieneBriefingAt','Allowed','BlockReason','LastChecked','CheckedBy','Status','CreatedAt','CreatedBy']);
  _v30Sheet_(MC_V30.AUDIT,['AuditID','DateTime','Area','Check','Result','Severity','RelatedID','Action','Responsible','DueDate','Status','CreatedAt','CreatedBy']);
  return true;
}

function setupV30Compliance(token){
  try{
    _requireAuth_(token,'journals');
    _v30Init_();
    var sh=_book_().getSheetByName(MC_V30.PROCESS);
    if(sh.getLastRow()===1){
      var now=new Date(), actor=_v30Actor_({session:_getSession_(token)});
      var rows=[
        ['P01','RECEIVING','Приёмка сырья и продукции',1,'Поставка','Принято/отклонено','Кладовщик','DRAFT','1','','','Проверить применимость и фактические процедуры',now,actor],
        ['P02','STORAGE','Хранение сырья',2,'Принятое сырьё','Партии на хранении','Кладовщик','DRAFT','1','','','Зоны и пределы настраиваются по фактическому оборудованию',now,actor],
        ['P03','PREP','Первичная обработка',3,'Сырьё','Подготовленные полуфабрикаты','Повар','DRAFT','1','','','',now,actor],
        ['P04','THERMAL','Тепловая обработка',4,'Полуфабрикат','Готовый продукт','Повар','DRAFT','1','','','Критические пределы утверждаются по конкретным ТТК/процессам',now,actor],
        ['P05','COOLING','Охлаждение',5,'Готовый/полуфабрикат','Охлаждённый продукт','Повар','DRAFT','1','','','',now,actor],
        ['P06','REHEAT','Повторный разогрев',6,'Охлаждённый продукт','Продукт к отпуску','Повар','DRAFT','1','','','',now,actor],
        ['P07','PORTION','Порционирование и комплектация',7,'Готовый продукт','Порции/банкетная выдача','Повар','DRAFT','1','','','',now,actor],
        ['P08','DISPATCH','Отпуск/выдача',8,'Порции','Выданная продукция','Шеф-повар','DRAFT','1','','','',now,actor]
      ];
      sh.getRange(2,1,rows.length,rows[0].length).setValues(rows);
    }
    return _ok_({initialized:true,processes:_v30Rows_(MC_V30.PROCESS).length},'V30_SETUP');
  }catch(e){return _failFrom_(e);}
}

function v30SaveProcess(json,token){
  var op=null; try{op=_beginOp_(token,'journals','V30_PROCESS_SAVE','HACCP process',null,null);}catch(e){return _failFrom_(e);}
  try{return _withLock_(function(){_v30Init_();var d=JSON.parse(json||'{}');if(!d.name)throw new Error('Название процесса обязательно');var sh=_book_().getSheetByName(MC_V30.PROCESS),id=d.id||_v30Id_('PROC'),actor=_v30Actor_(op),v=sh.getDataRange().getValues(),row=-1;for(var i=1;i<v.length;i++)if(String(v[i][0])===String(id)){row=i+1;break;}var r=[id,d.code||'',d.name,d.sequence||'',d.input||'',d.output||'',d.responsible||'',d.status||'DRAFT',d.version||'1',d.approvedAt||'',d.approvedBy||'',d.notes||'',new Date(),actor];if(row<0)sh.appendRow(r);else sh.getRange(row,1,1,r.length).setValues([r]);_audit_(op,'V30_PROCESS_SAVE','PROCESS',id,null,{name:d.name,status:r[7]});_endOp_(op);return _ok_({id:id},op.id);});}catch(e){if(op)_endOp_(op,'FAILED');return _failFrom_(e,op&&op.id);}
}

function v30SaveHazard(json,token){
  var op=null;try{op=_beginOp_(token,'journals','V30_HAZARD_SAVE','HACCP hazard',null,null);}catch(e){return _failFrom_(e);}
  try{return _withLock_(function(){_v30Init_();var d=JSON.parse(json||'{}');if(!d.processId||!d.hazard)throw new Error('Процесс и опасность обязательны');var sh=_book_().getSheetByName(MC_V30.HAZARD),id=d.id||_v30Id_('HZ'),actor=_v30Actor_(op),v=sh.getDataRange().getValues(),row=-1;for(var i=1;i<v.length;i++)if(String(v[i][0])===String(id)){row=i+1;break;}var r=[id,d.processId,d.category||'',d.hazard,d.cause||'',d.preventiveMeasure||'',d.severity||'',d.likelihood||'',d.risk||'',_v30Bool_(d.significant),d.existingControl||'',d.evidence||'',d.status||'DRAFT',new Date(),actor];if(row<0)sh.appendRow(r);else sh.getRange(row,1,1,r.length).setValues([r]);_audit_(op,'V30_HAZARD_SAVE','HAZARD',id,null,{processId:d.processId,hazard:d.hazard});_endOp_(op);return _ok_({id:id},op.id);});}catch(e){if(op)_endOp_(op,'FAILED');return _failFrom_(e,op&&op.id);}
}

function v30SaveControl(json,token){
  var op=null;try{op=_beginOp_(token,'journals','V30_CONTROL_SAVE','HACCP control',null,null);}catch(e){return _failFrom_(e);}
  try{return _withLock_(function(){_v30Init_();var d=JSON.parse(json||'{}');if(!d.processId||!d.controlPoint||!d.type)throw new Error('Процесс, тип и точка контроля обязательны');var sh=_book_().getSheetByName(MC_V30.CCP),id=d.id||_v30Id_('CCP'),actor=_v30Actor_(op),v=sh.getDataRange().getValues(),row=-1;for(var i=1;i<v.length;i++)if(String(v[i][0])===String(id)){row=i+1;break;}var r=[id,d.processId,d.hazardId||'',d.type,d.controlPoint,d.criticalLimit||'',d.limitUnit||'',d.monitoringMethod||'',d.frequency||'',d.responsible||'',d.correctiveAction||'',d.verificationMethod||'',d.recordSource||'',d.status||'DRAFT',d.version||'1',d.approvedAt||'',d.approvedBy||'',new Date(),actor];if(row<0)sh.appendRow(r);else sh.getRange(row,1,1,r.length).setValues([r]);_audit_(op,'V30_CONTROL_SAVE','CCP',id,null,{type:d.type,point:d.controlPoint,status:r[13]});_endOp_(op);return _ok_({id:id},op.id);});}catch(e){if(op)_endOp_(op,'FAILED');return _failFrom_(e,op&&op.id);}
}

function v30SaveMonitoring(json,token){
  var op=null;try{op=_beginOp_(token,'journals','V30_MONITOR_SAVE','HACCP monitoring',null,null);}catch(e){return _failFrom_(e);}
  try{_v30Init_();var d=JSON.parse(json||'{}');if(!d.controlId||!d.parameter)throw new Error('Точка контроля и параметр обязательны');var sh=_book_().getSheetByName(MC_V30.MON),id=d.id||_v30Id_('MON'),r=[id,d.controlId,d.object||'',d.parameter,d.unit||'',d.targetMin==null?'':d.targetMin,d.targetMax==null?'':d.targetMax,d.frequency||'',d.responsible||'',d.journalId||'',d.factType||'',d.dueRule||'',d.enabled!==false,d.status||'DRAFT',new Date(),_v30Actor_(op)];var v=sh.getDataRange().getValues(),row=-1;for(var i=1;i<v.length;i++)if(String(v[i][0])===String(id)){row=i+1;break;}if(row<0)sh.appendRow(r);else sh.getRange(row,1,1,r.length).setValues([r]);_audit_(op,'V30_MONITOR_SAVE','MONITORING',id,null,{controlId:d.controlId});_endOp_(op);return _ok_({id:id},op.id);}catch(e){if(op)_endOp_(op,'FAILED');return _failFrom_(e,op&&op.id);}
}

function v30SaveVerification(json,token){
  var op=null;try{op=_beginOp_(token,'journals','V30_VERIFY','HACCP verification',null,null);}catch(e){return _failFrom_(e);}
  try{_v30Init_();var d=JSON.parse(json||'{}');if(!d.controlId||!d.result)throw new Error('Точка контроля и результат обязательны');var sh=_book_().getSheetByName(MC_V30.VERIFY),id=d.id||_v30Id_('VER'),now=new Date(),r=[id,d.controlId,d.date||now,d.method||'',d.result,d.evidence||'',d.reviewer||_v30Actor_(op),d.correctiveAction||'',d.status||'RECORDED',now,_v30Actor_(op)];sh.appendRow(r);if(String(d.result).toUpperCase().indexOf('НЕ')>=0 && typeof _mcOpenDeviationAndAction_==='function'){try{_mcOpenDeviationAndAction_({type:'HACCP_VERIFICATION',description:d.correctiveAction||('Несоответствие верификации '+d.controlId),criticality:'HIGH',source:'V30',objectId:d.controlId},op.session);}catch(ignore){}}_audit_(op,'V30_VERIFY','CCP',d.controlId,null,{result:d.result});_endOp_(op);return _ok_({id:id},op.id);}catch(e){if(op)_endOp_(op,'FAILED');return _failFrom_(e,op&&op.id);}
}

function v30SavePpk(json,token){
  var op=null;try{op=_beginOp_(token,'journals','V30_PPK_SAVE','ППК',null,null);}catch(e){return _failFrom_(e);}
  try{_v30Init_();var d=JSON.parse(json||'{}');if(!d.name)throw new Error('Название ППК обязательно');var sh=_book_().getSheetByName(MC_V30.PPK),id=d.id||_v30Id_('PPK'),r=[id,d.name,d.version||'1',d.dateFrom||'',d.dateTo||'',d.status||'DRAFT',d.responsible||_v30Actor_(op),d.approvedBy||'',d.approvedAt||'',d.fileId||'',d.hash||'',d.notes||'',new Date(),_v30Actor_(op)];var v=sh.getDataRange().getValues(),row=-1;for(var i=1;i<v.length;i++)if(String(v[i][0])===String(id)){row=i+1;break;}if(row<0)sh.appendRow(r);else sh.getRange(row,1,1,r.length).setValues([r]);_audit_(op,'V30_PPK_SAVE','PPK',id,null,{status:d.status||'DRAFT'});_endOp_(op);return _ok_({id:id},op.id);}catch(e){if(op)_endOp_(op,'FAILED');return _failFrom_(e,op&&op.id);}
}

function v30SaveSanitation(json,token){
  var op=null;try{op=_beginOp_(token,'journals','V30_SAN_SAVE','Санитария',null,null);}catch(e){return _failFrom_(e);}
  try{_v30Init_();var d=JSON.parse(json||'{}');if(!d.zone||!d.task)throw new Error('Зона и задача обязательны');var sh=_book_().getSheetByName(MC_V30.SAN),id=d.id||_v30Id_('SAN'),r=[id,d.zone,d.task,d.frequency||'',d.method||'',d.chemical||'',d.concentration||'',d.contactTime||'',d.responsible||_v30Actor_(op),d.lastDone||'',d.nextDue||'',d.status||'ACTIVE',d.evidence||'',new Date(),_v30Actor_(op)];var v=sh.getDataRange().getValues(),row=-1;for(var i=1;i<v.length;i++)if(String(v[i][0])===String(id)){row=i+1;break;}if(row<0)sh.appendRow(r);else sh.getRange(row,1,1,r.length).setValues([r]);_audit_(op,'V30_SAN_SAVE','SANITATION',id,null,{zone:d.zone,task:d.task});_endOp_(op);return _ok_({id:id},op.id);}catch(e){if(op)_endOp_(op,'FAILED');return _failFrom_(e,op&&op.id);}
}

function v30SavePersonCompliance(json,token){
  var op=null;try{op=_beginOp_(token,'personnel','V30_PERSON_SAVE','Допуск персонала',null,null);}catch(e){return _failFrom_(e);}
  try{_v30Init_();var d=JSON.parse(json||'{}');if(!d.fullName)throw new Error('ФИО обязательно');var allowed=_v30Bool_(d.allowed),sh=_book_().getSheetByName(MC_V30.PERSON),id=d.id||_v30Id_('PER'),r=[id,d.employeeId||'',d.fullName,d.role||'',d.medicalValidTo||'',d.trainingValidTo||'',d.hygieneBriefingAt||'',allowed,d.blockReason||'',new Date(),_v30Actor_(op),d.status||'ACTIVE',new Date(),_v30Actor_(op)];sh.appendRow(r);_audit_(op,'V30_PERSON_SAVE','PERSON',id,null,{fullName:d.fullName,allowed:allowed});_endOp_(op);return _ok_({id:id},op.id);}catch(e){if(op)_endOp_(op,'FAILED');return _failFrom_(e,op&&op.id);}
}

function _v30Parse_(name,fn){return _v30Rows_(name).map(function(r){return fn(r);});}
function v30GetMasterData(token){try{_requireAuth_(token,'journals');_v30Init_();return _ok_({processes:_v30Parse_(MC_V30.PROCESS,function(r){return{id:r[0],code:r[1],name:r[2],sequence:r[3],input:r[4],output:r[5],responsible:r[6],status:r[7],version:r[8],approvedAt:r[9],approvedBy:r[10],notes:r[11]};}),hazards:_v30Parse_(MC_V30.HAZARD,function(r){return{id:r[0],processId:r[1],category:r[2],hazard:r[3],cause:r[4],preventiveMeasure:r[5],severity:r[6],likelihood:r[7],risk:r[8],significant:r[9],existingControl:r[10],evidence:r[11],status:r[12]};}),controls:_v30Parse_(MC_V30.CCP,function(r){return{id:r[0],processId:r[1],hazardId:r[2],type:r[3],controlPoint:r[4],criticalLimit:r[5],limitUnit:r[6],monitoringMethod:r[7],frequency:r[8],responsible:r[9],correctiveAction:r[10],verificationMethod:r[11],recordSource:r[12],status:r[13],version:r[14]};}),monitoring:_v30Parse_(MC_V30.MON,function(r){return{id:r[0],controlId:r[1],object:r[2],parameter:r[3],unit:r[4],targetMin:r[5],targetMax:r[6],frequency:r[7],responsible:r[8],journalId:r[9],factType:r[10],dueRule:r[11],enabled:r[12],status:r[13]};}),verification:_v30Parse_(MC_V30.VERIFY,function(r){return{id:r[0],controlId:r[1],date:r[2],method:r[3],result:r[4],evidence:r[5],reviewer:r[6],correctiveAction:r[7],status:r[8]};}),ppk:_v30Parse_(MC_V30.PPK,function(r){return{id:r[0],name:r[1],version:r[2],dateFrom:r[3],dateTo:r[4],status:r[5],responsible:r[6],approvedBy:r[7],approvedAt:r[8],fileId:r[9],hash:r[10],notes:r[11]};}),sanitation:_v30Parse_(MC_V30.SAN,function(r){return{id:r[0],zone:r[1],task:r[2],frequency:r[3],method:r[4],chemical:r[5],concentration:r[6],contactTime:r[7],responsible:r[8],lastDone:r[9],nextDue:r[10],status:r[11],evidence:r[12]};}),personnel:_v30Parse_(MC_V30.PERSON,function(r){return{id:r[0],employeeId:r[1],fullName:r[2],role:r[3],medicalValidTo:r[4],trainingValidTo:r[5],hygieneBriefingAt:r[6],allowed:r[7],blockReason:r[8],lastChecked:r[9],checkedBy:r[10],status:r[11]};})});}catch(e){return _failFrom_(e);}}

function v30GetReadiness(token){
  try{
    _requireAuth_(token,'journals');_v30Init_();var now=new Date(),days=30;
    var processes=_v30Rows_(MC_V30.PROCESS), hazards=_v30Rows_(MC_V30.HAZARD), controls=_v30Rows_(MC_V30.CCP), mon=_v30Rows_(MC_V30.MON), ver=_v30Rows_(MC_V30.VERIFY),ppk=_v30Rows_(MC_V30.PPK),san=_v30Rows_(MC_V30.SAN),per=_v30Rows_(MC_V30.PERSON);
    var activeProc=processes.filter(function(r){return String(r[7])==='ACTIVE'||String(r[7])==='APPROVED';});
    var missingHazard=activeProc.filter(function(p){return !hazards.some(function(h){return String(h[1])===String(p[0])&&String(h[12])!=='ARCHIVED';});});
    var missingControl=hazards.filter(function(h){return _v30Bool_(h[9])&&String(h[12])!=='ARCHIVED'&&!controls.some(function(c){return String(c[2])===String(h[0])&&String(c[13])!=='ARCHIVED';});});
    var missingMon=controls.filter(function(c){return String(c[13])!=='ARCHIVED'&&!mon.some(function(m){return String(m[1])===String(c[0])&&_v30Bool_(m[12])&&String(m[13])!=='ARCHIVED';});});
    var unverified=controls.filter(function(c){return String(c[13])==='ACTIVE'||String(c[13])==='APPROVED';}).filter(function(c){return !ver.some(function(v){return String(v[1])===String(c[0])&&String(v[8])!=='CANCELLED';});});
    var ppkCurrent=ppk.filter(function(r){return String(r[5])==='ACTIVE'||String(r[5])==='APPROVED';}).sort(function(a,b){return String(b[2]).localeCompare(String(a[2]));})[0]||null;
    var sanOverdue=san.filter(function(r){var d=_v30Date_(r[10]);return String(r[11])==='ACTIVE'&&d&&d<now;});
    var personBlocked=per.filter(function(r){return r[7]===false||String(r[11])==='BLOCKED';});
    var labPending=[];try{var lt=_labTestSheet_().getDataRange().getValues();for(var i=1;i<lt.length;i++)if(lt[i][0]&&String(lt[i][14])==='ожидает результата')labPending.push(lt[i][0]);}catch(ignore){}
    var items=[
      {id:'PROCESS',name:'Карта процессов',count:processes.length,problem:missingHazard.length?missingHazard.length:0,ok:processes.length>0&&missingHazard.length===0,detail:missingHazard.length?'У активных процессов нет анализа опасностей: '+missingHazard.length:'Процессы и анализ опасностей связаны'},
      {id:'CCP',name:'Опасности → ККТ/ОПРП',count:controls.length,problem:missingControl.length,ok:missingControl.length===0,detail:missingControl.length?'Значимые опасности без точки контроля: '+missingControl.length:'Значимые опасности имеют контроль'},
      {id:'MON',name:'Мониторинг',count:mon.length,problem:missingMon.length,ok:missingMon.length===0,detail:missingMon.length?'Нет плана мониторинга: '+missingMon.length:'План мониторинга задан'},
      {id:'VERIFY',name:'Верификация',count:ver.length,problem:unverified.length,ok:unverified.length===0,detail:unverified.length?'Нет записи верификации для: '+unverified.length+' точек':'Верификация зафиксирована'},
      {id:'PPK',name:'ППК',count:ppk.length,problem:ppkCurrent?0:1,ok:!!ppkCurrent,detail:ppkCurrent?'Есть активная версия ППК':'Нет активной/утверждённой версии ППК'},
      {id:'SAN',name:'Санитария',count:san.length,problem:sanOverdue.length,ok:sanOverdue.length===0,detail:sanOverdue.length?'Просроченные задачи: '+sanOverdue.length:'Просроченных задач нет'},
      {id:'PERSON',name:'Допуск персонала',count:per.length,problem:personBlocked.length,ok:personBlocked.length===0,detail:personBlocked.length?'Заблокировано/не допущено: '+personBlocked.length:'Блокировок нет'},
      {id:'LAB',name:'Лабораторные исследования',count:labPending.length,problem:labPending.length,ok:labPending.length===0,detail:labPending.length?'Ожидают результата: '+labPending.length:'Ожидающих результатов нет'}
    ];
    var score=Math.round(100*items.filter(function(x){return x.ok;}).length/items.length);
    return _ok_({score:score,generatedAt:now,items:items,counts:{processes:processes.length,hazards:hazards.length,controls:controls.length,monitoring:mon.length,verification:ver.length,ppk:ppk.length,sanitation:san.length,personnel:per.length,labPending:labPending.length},gates:{activePpk:!!ppkCurrent,blockedPersonnel:personBlocked.length,overdueSanitation:sanOverdue.length}});
  }catch(e){return _failFrom_(e);}
}

function v30BuildAuditSnapshot(token){
  try{_requireAuth_(token,'journals');var r=v30GetReadiness(token),d=typeof r==='string'?JSON.parse(r):r;if(!d||!d.success)throw new Error('Не удалось получить readiness');var id=_v30Id_('AUD'),s=_v30Sheet_(MC_V30.AUDIT,['AuditID','DateTime','Area','Check','Result','Severity','RelatedID','Action','Responsible','DueDate','Status','CreatedAt','CreatedBy']);var now=new Date();d.data.items.forEach(function(x){s.appendRow([id,now,x.name,x.detail,x.ok?'PASS':'FAIL',x.ok?'INFO':'HIGH',x.id,x.ok?'':'Требуется разбор и назначение действия','',x.ok?'':'',x.ok?'CLOSED':'OPEN',now,'system']);});return _ok_({auditId:id,readiness:d.data},'V30_AUDIT_SNAPSHOT');}catch(e){return _failFrom_(e);}
}
