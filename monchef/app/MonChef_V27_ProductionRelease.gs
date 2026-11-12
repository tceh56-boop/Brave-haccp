/** MON CHEF V27 — производственный выпуск и единый экран смены.
 * Использует существующее ядро completeProduction/_produceCore_: сырьё списывается
 * один раз, выход приходуется партией, трассировка и HACCP bridge остаются едиными.
 * Модуль не подменяет фактические измерения и не вводит сроки годности сам.
 */
var MC_V27_EXEC_SHEET = 'Выпуск_V27';
function _mcV27Sheet_(){
  var sh=_book_().getSheetByName(MC_V27_EXEC_SHEET);
  if(!sh){sh=_book_().insertSheet(MC_V27_EXEC_SHEET);sh.appendRow(['ExecutionID','ProductionID','Product','TTKCode','PlannedQty','ActualQty','Unit','StartedAt','StartedBy','CompletedAt','CompletedBy','BatchID','LabelID','Status','HACCPTasksCreated','LastError']);sh.setFrozenRows(1);}
  return sh;
}
// Ответы ядра — строка JSON с полем success (не ok). Раньше проверялось только .ok: «Начать» и «Завершить» выпуска
// возвращали ответ ядра и не доходили до записи выпуска, этикетки и задач ХАССП. Признак выравнивается здесь.
function _mcV27Parse_(x){var o;if(x&&typeof x==='object')o=x;else{try{o=JSON.parse(x||'{}');}catch(e){return {ok:false,error:{message:String(x)}};}}if(o&&typeof o==='object'&&o.ok===undefined&&o.success!==undefined)o.ok=o.success===true;return o;}
function _mcV27Find_(id){var sh=_mcV27Sheet_(),v=sh.getDataRange().getValues();for(var i=1;i<v.length;i++)if(String(v[i][1])===String(id))return {sheet:sh,row:i+1,data:v[i]};return null;}
function getV27ProductionBoard(token){
  try{
    _requireAuth_(token,'kanban');
    var raw=getProductionOrders(null,token),parsed=_mcV27Parse_(raw);if(!parsed.ok)return raw;
    var orders=parsed.data||[], sh=_mcV27Sheet_(),v=sh.getDataRange().getValues(),ix={};
    for(var i=1;i<v.length;i++)ix[String(v[i][1])]=v[i];
    var out=orders.map(function(o){var r=ix[String(o.id)]||[];return {id:o.id,name:o.name||o.product||'',code:o.code||'',planned:o.planned||0,actual:o.actual||0,unit:o.unit||'г',status:o.status||'',batch:o.batch||'',executionStatus:r[13]||'',labelId:r[12]||''};});
    return _ok_({orders:out,counts:{planned:out.filter(function(x){return x.status==='PLANNED';}).length,inProgress:out.filter(function(x){return x.status==='IN_PROGRESS';}).length,completed:out.filter(function(x){return x.status==='COMPLETED';}).length}});
  }catch(e){return _failFrom_(e);}
}
function startV27Production(productionId,token){
  try{
    _requireAuth_(token,'kanban');
    var old=_mcV27Find_(productionId);if(old){var st=String(old.data[13]);if(st==='IN_PROGRESS'||st==='COMPLETED')return _ok_({productionId:productionId,status:st,executionId:old.data[0],idempotent:true});}
    // Если для задания создан план отбора V23, выпуск разрешён только после
    // полного подтверждения всех строк. Если план не создавался в старом потоке,
    // сохраняется совместимость с прежним производственным ядром.
    try{var picks=_mcV23Rows_().filter(function(x){return String(x.productionId)===String(productionId)&&x.status!=='CANCELLED';});var pending=picks.filter(function(x){return x.status!=='PICKED'||Number(x.picked)+0.0001<Number(x.planned);});if(picks.length&&pending.length)return _fail_('PICKING_INCOMPLETE','Нельзя начать выпуск: не завершён отбор сырья ('+pending.length+' строк).');}catch(pe){return _fail_('PICKING_CHECK','Не удалось проверить отбор сырья: '+pe);}
    var raw=startProduction(productionId,token),r=_mcV27Parse_(raw);if(!r.ok)return raw;
    var found=_findProduction_(_productionSheet_(),productionId);if(!found)return _fail_('NOT_FOUND','Производственное задание не найдено после запуска');
    var d=found.data,who='';try{who=_mcV21Actor_(token);}catch(e){}
    var sh=_mcV27Sheet_(),id='EX27-'+Date.now()+'-'+String(productionId);
    sh.appendRow([id,productionId,d[PROD_COL_.name],d[PROD_COL_.code],d[PROD_COL_.plan],'',d[PROD_COL_.unit]||'г',new Date(),who,'','', '', '', 'IN_PROGRESS',0,'']);
    return _ok_({executionId:id,productionId:productionId,status:'IN_PROGRESS'});
  }catch(e){return _failFrom_(e);}
}
function completeV27Production(productionId,actualQty,expiry,token){
  try{
    _requireAuth_(token,'kanban');
    var f=_findProduction_(_productionSheet_(),productionId);if(!f)return _fail_('NOT_FOUND','Производственное задание не найдено');
    if(String(f.data[PROD_COL_.status])==='COMPLETED')return _ok_({productionId:productionId,status:'COMPLETED',batch:f.data[PROD_COL_.batch]||'',idempotent:true});
    var q=parseFloat(String(actualQty).replace(',','.'));if(!(q>0))return _fail_('VALIDATION','Введите фактический выход больше нуля');
    var ex=_mcV27Find_(productionId);if(!ex&&String(f.data[PROD_COL_.status])==='IN_PROGRESS'){// задание запущено из раздела «Производство» главного окна — запись выпуска создаётся здесь, время и исполнитель — из задания
    var d0=f.data;_mcV27Sheet_().appendRow(['EX27-'+Date.now()+'-'+String(productionId),productionId,d0[PROD_COL_.name],d0[PROD_COL_.code],d0[PROD_COL_.plan],'',d0[PROD_COL_.unit]||'г',d0[PROD_COL_.start]||'',d0[PROD_COL_.emp]||'','','','','','IN_PROGRESS',0,'']);ex=_mcV27Find_(productionId);}
    if(!ex)return _fail_('VALIDATION','Сначала нажмите «Начать» у этого задания');
    if(String(ex.data[13])==='COMPLETED')return _ok_({productionId:productionId,status:'COMPLETED',batch:ex.data[11],labelId:ex.data[12],idempotent:true});
    var raw=completeProduction(productionId,q,expiry||'',token),r=_mcV27Parse_(raw);if(!r.ok)return raw;
    var data=r.data||{},batch=data.batch||'',labelId='',labelResult=null;
    if(batch){try{labelResult=_mcV27Parse_(createBatchLabel(batch,token));// ответ — строка JSON с success (не ok): раньше этикетка создавалась, а номер не записывался; без права «склад» — внутреннее создание
    if(!(labelResult&&(labelResult.ok||labelResult.success)))labelResult=_mcV27Parse_(_mcV27CreateLabelInternal_(batch));if(labelResult&&(labelResult.ok||labelResult.success))labelId=(labelResult.data||{}).labelId||'';}catch(le){_log_('WARN','V27 label: '+le);}}
    var tasks=0;try{if(typeof _mcV17ProcessProduction_==='function')tasks=_mcV17ProcessProduction_();}catch(he){_log_('WARN','V27 HACCP bridge: '+he);}
    var sh=ex.sheet;sh.getRange(ex.row,6).setValue(q);sh.getRange(ex.row,10).setValue(new Date());sh.getRange(ex.row,11).setValue(_mcV21Actor_(token));sh.getRange(ex.row,12).setValue(batch);sh.getRange(ex.row,13).setValue(labelId);sh.getRange(ex.row,14).setValue('COMPLETED');sh.getRange(ex.row,15).setValue(tasks);
    return _ok_({productionId:productionId,status:'COMPLETED',actualQty:q,batch:batch,labelId:labelId,haccpTasksCreated:tasks,core:data,labelWarning:batch&&!labelId?'Выпуск завершён, но этикетку создать не удалось':''});
  }catch(e){return _failFrom_(e);}
}
function getV27ExecutionHistory(token){try{_requireAuth_(token,'kanban');var v=_mcV27Sheet_().getDataRange().getValues(),a=[];for(var i=v.length-1;i>=1&&a.length<200;i--)if(v[i][0])a.push({executionId:v[i][0],productionId:v[i][1],product:v[i][2],planned:v[i][4],actual:v[i][5],unit:v[i][6],startedAt:v[i][7],startedBy:v[i][8],completedAt:v[i][9],completedBy:v[i][10],batchId:v[i][11],labelId:v[i][12],status:v[i][13],haccpTasksCreated:v[i][14]});return _ok_(a);}catch(e){return _failFrom_(e);}}

// Внутреннее создание этикетки после авторизованного выпуска. Не требует
// дополнительной роли склада: факт выпуска уже подтверждён ядром производства.
function _mcV27CreateLabelInternal_(batchId){
  var sh=_stockBatchesSheet_(),v=sh.getDataRange().getValues(),r=null;
  for(var i=1;i<v.length;i++)if(String(v[i][0])===String(batchId)){r=v[i];break;}
  if(!r)return _fail_('NOT_FOUND','Партия выпуска не найдена для этикетки');
  var ls=_mcV22Labels_(),id=_mcV22Id_('LBL'),loc=r[14]||'';
  ls.appendRow([id,batchId,r[1],r[2],r[9],r[11]||'',r[5]||'',r[12]||'',loc,'','',0,'READY']);
  return _ok_({labelId:id,batchId:batchId,product:r[1],qty:r[9],expiry:r[5]||'',locationId:loc});
}
