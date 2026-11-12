/**
 * MON CHEF V21 — PROCUREMENT + RECEIVING LOOP
 *
 * Замыкает недельный план:
 * дефицит -> заявка/заказ поставщику -> ожидаемая поставка -> скан накладной/этикеток
 * -> сверка -> реальные партии -> склад -> автоматический пересчёт недели.
 *
 * ВАЖНО: V21 не создаёт приход только по OCR. Финальный приход выполняется
 * отдельным подтверждением пользователя после сверки фактически принятых строк.
 */
var MC_V21_PURCHASE = 'Закупки_V21';
var MC_V21_RECEIVE = 'Приемка_V21';
var MC_V21_RECEIVE_LINES = 'Приемка_Строки_V21';

function _mcV21Sheet_(name, headers){
  var ss=_book_(), sh=ss.getSheetByName(name);
  if(!sh){sh=ss.insertSheet(name);sh.appendRow(headers);sh.setFrozenRows(1);}
  return sh;
}
function _mcV21Purchase_(){return _mcV21Sheet_(MC_V21_PURCHASE,['RequestID','PlanID','WeekFrom','Product','Unit','Qty','Supplier','Status','OrderID','CreatedAt','CreatedBy','UpdatedAt']);}
function _mcV21Receive_(){return _mcV21Sheet_(MC_V21_RECEIVE,['SessionID','OrderID','Supplier','DocumentRef','ExpectedDate','Status','StartedAt','StartedBy','FinalizedAt','FinalizedBy']);}
function _mcV21ReceiveLines_(){return _mcV21Sheet_(MC_V21_RECEIVE_LINES,['LineID','SessionID','Product','Unit','ExpectedQty','ReceivedQty','Manufactured','Expiry','SupplierBatch','DocRef','MatchStatus','Warnings','BatchID','CreatedAt']);}
function _mcV21Id_(prefix){return prefix+'-'+Date.now()+'-'+Math.floor(Math.random()*10000);}
function _mcV21Actor_(token){try{var s=_requireAuth_(token,'stock');return _mcSessionFullName_(s)||'';}catch(e){return '';}}
function _mcV21Parse_(x){try{return typeof x==='string'?JSON.parse(x):x;}catch(e){throw new Error('VALIDATION:Неверный JSON');}}
function _mcV21Norm_(x){return _prodKey_(String(x||''));}
function _mcV21Num_(x){var n=Number(x);return isFinite(n)?n:0;}

/** Создать заявки на закупку из дефицитов недельного плана. Идемпотентно для PlanID. */
function _createWeeklyPurchaseRequests_core_(planId,actor){
  if(!planId)return _fail_('VALIDATION','Не указан PlanID');
  var pv=_mcV20Purchase_().getDataRange().getValues(), sh=_mcV21Purchase_(), existing=sh.getDataRange().getValues(), now=new Date(), created=[];
    var known={};
    for(var i=1;i<existing.length;i++)if(String(existing[i][1])===String(planId)&&String(existing[i][7])!=='CANCELLED')known[_mcV21Norm_(existing[i][3])+'|'+String(existing[i][4])]=true;
    for(var r=1;r<pv.length;r++){
      if(String(pv[r][0])!==String(planId))continue;
      var shortage=_mcV21Num_(pv[r][7]); if(shortage<=0)continue;
      var product=String(pv[r][2]||''),unit=String(pv[r][3]||''),key=_mcV21Norm_(product)+'|'+unit;
      if(known[key])continue;
      var supplier=''; try{supplier=_getLastSupplier_(product)||'';}catch(ignore){}
      var id=_mcV21Id_('REQ');
      sh.appendRow([id,planId,pv[r][1],product,unit,shortage,supplier||'НЕ НАЗНАЧЕН','OPEN','',now,actor,now]);
      known[key]=true;created.push({requestId:id,product:product,unit:unit,qty:shortage,supplier:supplier||'НЕ НАЗНАЧЕН'});
    }
    return _ok_({planId:planId,created:created,count:created.length});
}

function createWeeklyPurchaseRequests(planId,token){
  try{var session=_requireAuth_(token,'stock');return _createWeeklyPurchaseRequests_core_(planId,_mcSessionFullName_(session)||'');}
  catch(e){return _failFrom_(e);}
}

function getWeeklyPurchaseRequests(planId,token){
  try{
    _requireAuth_(token,'stock');var v=_mcV21Purchase_().getDataRange().getValues(),out=[];
    for(var i=1;i<v.length;i++)if(v[i][0]&&(!planId||String(v[i][1])===String(planId)))out.push({requestId:v[i][0],planId:v[i][1],weekFrom:v[i][2],product:v[i][3],unit:v[i][4],qty:_mcV21Num_(v[i][5]),supplier:v[i][6],status:v[i][7],orderId:v[i][8],createdAt:v[i][9],createdBy:v[i][10],updatedAt:v[i][11]});
    return _ok_(out.reverse());
  }catch(e){return _failFrom_(e);}
}

/** Создаёт черновики заказов, группируя заявки по поставщику. */
function createSupplierOrdersFromWeeklyPlan(planId,dueDate,token){
  try{
    var session=_requireAuth_(token,'stock'), v=_mcV21Purchase_().getDataRange().getValues(), groups={}, rows=[];
    for(var i=1;i<v.length;i++){
      if(String(v[i][1])!==String(planId)||String(v[i][7])!=='OPEN')continue;
      var supplier=String(v[i][6]||'НЕ НАЗНАЧЕН');
      if(!groups[supplier])groups[supplier]=[];
      groups[supplier].push({requestId:v[i][0],name:v[i][3],qty:_mcV21Num_(v[i][5]),unit:v[i][4],price:0,sum:0});
    }
    Object.keys(groups).forEach(function(supplier){
      var items=groups[supplier];
      var raw=_createSupplierOrder_core_(JSON.stringify(items.map(function(x){return {name:x.name,qty:x.qty,unit:x.unit,price:0,sum:0};})),supplier,'Автоматически из недельного плана '+planId,dueDate,token);
      var parsed=_mcV21Parse_(raw); if(parsed.error||parsed.success===false)throw new Error('ORDER_CREATE_FAILED:'+JSON.stringify(parsed));
      var orderId=parsed.id || (parsed.data&&parsed.data.id); if(!orderId)throw new Error('ORDER_CREATE_FAILED:не получен OrderID');
      var sh=_mcV21Purchase_(), data=sh.getDataRange().getValues(),now=new Date();
      for(var r=1;r<data.length;r++)if(String(data[r][1])===String(planId)&&String(data[r][6]||'НЕ НАЗНАЧЕН')===supplier&&String(data[r][7])==='OPEN'){
        var nm=_mcV21Norm_(data[r][3]), match=items.filter(function(x){return _mcV21Norm_(x.name)===nm&&String(x.unit)===String(data[r][4]);})[0];
        if(match){sh.getRange(r+1,8).setValue('ORDERED');sh.getRange(r+1,9).setValue(orderId);sh.getRange(r+1,12).setValue(now);}
      }
      rows.push({supplier:supplier,orderId:orderId,lines:items.length});
    });
    return _ok_({planId:planId,orders:rows,createdBy:_mcSessionFullName_(session)});
  }catch(e){return _failFrom_(e);}
}

function startPurchaseReceiving(orderId,documentRef,expectedDate,token){
  try{
    _requireAuth_(token,'stock');if(!orderId)return _fail_('VALIDATION','Не указан OrderID');
    var raw=getSupplierOrderById(orderId),order=_mcV21Parse_(raw);if(order.error)return _fail_('NOT_FOUND','Заказ не найден');
    var sh=_mcV21Receive_(),id=_mcV21Id_('REC'),actor=_mcV21Actor_(token),now=new Date();
    sh.appendRow([id,orderId,order.supplier||'',documentRef||'',expectedDate||order.dueDate||'','OPEN',now,actor,'','']);
    var ls=_mcV21ReceiveLines_();
    (order.items||[]).forEach(function(it){ls.appendRow([_mcV21Id_('RL'),id,it.name,it.unit||'',_mcV21Num_(it.qty),0,'','','',documentRef||'','EXPECTED','','',now]);});
    return _ok_({sessionId:id,orderId:orderId,supplier:order.supplier||'',lines:(order.items||[]).length});
  }catch(e){return _failFrom_(e);}
}

/** Добавляет строку фактически отсканированной этикетки. OCR/сканер передаёт уже извлечённые поля. */
function addPurchaseReceivingLabel(sessionId,labelJson,token){
  try{
    _requireAuth_(token,'stock');var label=_mcV21Parse_(labelJson);if(!sessionId||!label.product)return _fail_('VALIDATION','Не хватает sessionId или product');
    var rv=_mcV21Receive_().getDataRange().getValues(),session=null;
    for(var i=1;i<rv.length;i++)if(String(rv[i][0])===String(sessionId)){session=rv[i];break;}
    if(!session)return _fail_('NOT_FOUND','Сессия приёмки не найдена');
    if(String(session[5])!=='OPEN')return _fail_('CONFLICT','Приёмка уже закрыта');
    var expected=0,lv=_mcV21ReceiveLines_().getDataRange().getValues(),norm=_mcV21Norm_(label.product),unit=String(label.unit||'');
    for(var j=1;j<lv.length;j++)if(String(lv[j][1])===String(sessionId)&&_mcV21Norm_(lv[j][2])===norm&&(!unit||String(lv[j][3])===unit)){expected+=_mcV21Num_(lv[j][4]);}
    var received=_mcV21Num_(label.qty), warnings=[];
    if(!expected)warnings.push('Товар не найден среди ожидаемых позиций заказа.');
    var lineId=_mcV21Id_('RL'), status=expected?(received<=expected?'MATCH':'OVER_QTY'):'UNEXPECTED';
    _mcV21ReceiveLines_().appendRow([lineId,sessionId,label.product,unit,expected,received,label.manufactured||'',label.expiry||'',label.supplierBatch||'',label.docRef||session[3]||'',status,warnings.join(' '),'',new Date()]);
    return _ok_({lineId:lineId,status:status,warnings:warnings,expectedQty:expected,receivedQty:received});
  }catch(e){return _failFrom_(e);}
}

function getPurchaseReceiving(sessionId,token){
  try{
    _requireAuth_(token,'stock');var rv=_mcV21Receive_().getDataRange().getValues(),session=null;
    for(var i=1;i<rv.length;i++)if(String(rv[i][0])===String(sessionId))session={sessionId:rv[i][0],orderId:rv[i][1],supplier:rv[i][2],documentRef:rv[i][3],expectedDate:rv[i][4],status:rv[i][5],startedAt:rv[i][6],startedBy:rv[i][7],finalizedAt:rv[i][8],finalizedBy:rv[i][9]};
    if(!session)return _fail_('NOT_FOUND','Сессия приёмки не найдена');
    var lv=_mcV21ReceiveLines_().getDataRange().getValues(),lines=[];
    for(var j=1;j<lv.length;j++)if(String(lv[j][1])===String(sessionId))lines.push({lineId:lv[j][0],product:lv[j][2],unit:lv[j][3],expectedQty:_mcV21Num_(lv[j][4]),receivedQty:_mcV21Num_(lv[j][5]),manufactured:lv[j][6],expiry:lv[j][7],supplierBatch:lv[j][8],docRef:lv[j][9],matchStatus:lv[j][10],warnings:lv[j][11],batchId:lv[j][12]});
    return _ok_({session:session,lines:lines});
  }catch(e){return _failFrom_(e);}
}

/** Финализирует приёмку. Только подтверждённые строки становятся партиями и остатком. */
function finalizePurchaseReceiving(sessionId,token){
  try{
    var op=_beginOp_(token,'stock','PURCHASE_RECEIVING_FINALIZE','Приемка',sessionId,null);
    return _withLock_(function(){
      try{
        var rv=_mcV21Receive_().getDataRange().getValues(),row=-1,session=null;
        for(var i=1;i<rv.length;i++)if(String(rv[i][0])===String(sessionId)){row=i+1;session=rv[i];break;}
        if(row<0){_endOp_(op,'FAILED');return _fail_('NOT_FOUND','Сессия приёмки не найдена',op.id);}
        if(String(session[5])!=='OPEN'){_endOp_(op,'FAILED');return _fail_('CONFLICT','Приёмка уже закрыта',op.id);}
        var lv=_mcV21ReceiveLines_().getDataRange().getValues(),items=[],errors=[];
        for(var j=1;j<lv.length;j++)if(String(lv[j][1])===String(sessionId)&&!lv[j][12]){
          var q=_mcV21Num_(lv[j][5]); if(q<=0)continue;
          if(String(lv[j][10])==='UNEXPECTED')errors.push('Неожидаемый товар: '+lv[j][2]);
          if(String(lv[j][10])==='OVER_QTY')errors.push('Количество больше ожидаемого: '+lv[j][2]);
          items.push({name:lv[j][2],qty:q,unit:lv[j][3]||'г',price:0,expiry:lv[j][7]||'',manufactured:lv[j][6]||'',supplierBatch:lv[j][8]||'',docRef:lv[j][9]||session[3]||''});
        }
        if(errors.length){_endOp_(op,'FAILED');return _fail_('VALIDATION',errors.join('; '),op.id);}
        if(!items.length){_endOp_(op,'FAILED');return _fail_('VALIDATION','Нет подтверждённых строк для прихода',op.id);}
        var result=_incomeWithBatches_(items,'Заказ '+session[1]+' ('+(session[2]||'поставщик')+')','Подтверждённая приёмка '+sessionId,op);
        var lsh=_mcV21ReceiveLines_(),ldata=lsh.getDataRange().getValues(),batchIdx=0;
        for(var k=1;k<ldata.length;k++)if(String(ldata[k][1])===String(sessionId)&&_mcV21Num_(ldata[k][5])>0&&!ldata[k][12]){lsh.getRange(k+1,13).setValue(result.batchIds[batchIdx++]||'');lsh.getRange(k+1,11).setValue('RECEIVED');}
        var putAway=[];
        try{(result.batchIds||[]).forEach(function(bid){if(typeof _mcV22AutoPutAwayBatch_==='function')putAway.push(_mcV22AutoPutAwayBatch_(bid));});}catch(putErr){putAway.push({status:'ERROR',message:String(putErr)});}
        var actor=_mcV21Actor_(token),now=new Date();_mcV21Receive_().getRange(row,6).setValue('RECEIVED');_mcV21Receive_().getRange(row,9).setValue(now);_mcV21Receive_().getRange(row,10).setValue(actor);
        _endOp_(op,'COMPLETED');
        return _ok_({sessionId:sessionId,batchIds:result.batchIds,receivedLines:items.length,priceAlerts:result.priceAlerts,putAway:putAway,operationId:op.id});
      }catch(e){_endOp_(op,'FAILED');throw e;}
    });
  }catch(e){return _failFrom_(e);}
}

/** Сверка недельного плана после прихода: сколько дефицита осталось. */
function getWeeklyPurchaseAfterReceiving(planId,token){
  try{
    _requireAuth_(token,'stock');var req=JSON.parse(getWeeklyPurchaseRequests(planId,token)),data=req.data||[],stock={};
    try{var batches=_stockBatchesSheet_().getDataRange().getValues();for(var i=1;i<batches.length;i++)if(batches[i][1])stock[_mcV21Norm_(batches[i][1])+'|'+String(batches[i][2])]=Number(stock[_mcV21Norm_(batches[i][1])+'|'+String(batches[i][2])]||0)+Number(batches[i][9]||0);}catch(ignore){}
    return _ok_(data.map(function(x){var k=_mcV21Norm_(x.product)+'|'+String(x.unit),on=stock[k]||0;return {requestId:x.requestId,product:x.product,unit:x.unit,planned:x.qty,onHandNow:on,remainingShortage:Math.max(0,x.qty-on),status:on>=x.qty?'CLOSED':'OPEN'};}));
  }catch(e){return _failFrom_(e);}
}

function runMonChefProcurementCycle(token){
  try{
    var actor=null;
    if(token) actor=_requireAuth_(token,'audit_create');
    var d=new Date(),m=_mcV20Monday_(d);m.setDate(m.getDate()+7),from=_mcV20Date_(m);
    var plan=_mcV14Build_(from,token||null,true), planId=plan.planId;
    _mcV20SyncPurchase_(plan,planId);
    var req=_createWeeklyPurchaseRequests_core_(planId,actor?_mcSessionFullName_(actor):'SYSTEM');
    if(typeof req==='string') req=JSON.parse(req);
    return _ok_({planId:planId,weekFrom:plan.weekFrom,weekTo:plan.weekTo,purchaseRequests:req.data||[],runAt:new Date(),runBy:actor?_mcSessionFullName_(actor):'SYSTEM'});
  }catch(e){return _failFrom_(e);}
}
function runMonChefProcurementCycleSystem(){return runMonChefProcurementCycle(null);}
