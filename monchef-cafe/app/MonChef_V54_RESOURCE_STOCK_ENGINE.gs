/**
 * MON CHEF V54 — RESOURCE / STOCK ENGINE
 *
 * Goal: one canonical resource identity and one transactional facade for stock.
 * V54 does not create a second warehouse. It hardens the existing Склад_Партии
 * and exposes a single service layer for receive/adjust/reserve/consume/release.
 *
 * Safety rule: if ProductID mapping is not APPROVED, planning may show REVIEW,
 * but stock automation must not silently substitute a product.
 */
var V54 = {
  BATCH_MAP:'Склад_Ресурсы_V54',
  RESERVES:'Склад_Резервы_V54',
  OPS:'Склад_Операции_V54',
  AUDIT:'Склад_Аудит_V54'
};
var V54H = {
  BATCH_MAP:['BatchID','ProductID','MappingStatus','Dimension','CanonicalUnit','CanonicalQty','UpdatedAt','UpdatedBy'],
  RESERVES:['ReserveID','BatchID','ProductID','Qty','Unit','CanonicalQty','SourceType','SourceID','Status','CreatedAt','ReleasedAt','OperationID','Actor'],
  OPS:['OperationID','At','Action','BatchID','ProductID','Qty','Unit','CanonicalQty','BeforeQty','AfterQty','Source','SourceID','Status','Actor','Message'],
  AUDIT:['AuditID','At','Action','ObjectType','ObjectID','OperationID','Before','After','Result','Message','Actor']
};
function _v54Sh_(n,h){var s=_book_().getSheetByName(n);if(!s){s=_book_().insertSheet(n);s.appendRow(h);s.setFrozenRows(1);}return s;}
function _v54Rows_(n,h){var s=_v54Sh_(n,h),v=s.getDataRange().getValues(),o=[];for(var i=1;i<v.length;i++){if(!v[i].some(function(x){return x!=='';}))continue;var r={};h.forEach(function(k,j){r[k]=v[i][j];});o.push(r);}return o;}
function _v54Id_(p){return 'V54-'+p+'-'+Utilities.getUuid().slice(0,8);}
function _v54Audit_(action,type,id,op,before,after,result,msg,actor){_v54Sh_(V54.AUDIT,V54H.AUDIT).appendRow([_v54Id_('AUD'),new Date(),action,type,id,op||'',before==null?'':JSON.stringify(before),after==null?'':JSON.stringify(after),result||'OK',msg||'',actor||'SYSTEM']);}
function _v54Actor_(token){try{var s=_getSession_(token);return s?(s.fullName||s.user_id||'USER'):'SYSTEM';}catch(e){return 'SYSTEM';}}
function _v54ApprovedMap_(sourceType,name){
  if(typeof _v53Rows_!=='function') return null;
  var rows=_v53Rows_(V53.MAP,V53H.MAP).filter(function(r){return String(r.SourceType)===String(sourceType||'STOCK')&&_v53Norm_(r.SourceName)===_v53Norm_(name)&&String(r.Status)==='APPROVED'&&r.ProductID;});
  return rows.length===1?rows[0]:null;
}
function _v54ResolveProduct_(name,unit){
  var m=_v54ApprovedMap_('STOCK',name)||_v54ApprovedMap_('TTK',name);
  if(!m) return {ok:false,status:'REVIEW',name:String(name||''),unit:_v53Unit_(unit||''),reason:'Нет утверждённого ProductID'};
  var p=_v53ProductIndex_().byId[String(m.ProductID)];
  if(!p) return {ok:false,status:'REVIEW',name:name,unit:_v53Unit_(unit||''),reason:'ProductID отсутствует в каталоге'};
  return {ok:true,status:'APPROVED',productId:String(m.ProductID),name:p.Name,unit:_v53Unit_(unit||''),dimension:_v53Dim_(unit||'')};
}
function setupV54ResourceStockEngine(){
  _v54Sh_(V54.BATCH_MAP,V54H.BATCH_MAP);_v54Sh_(V54.RESERVES,V54H.RESERVES);_v54Sh_(V54.OPS,V54H.OPS);_v54Sh_(V54.AUDIT,V54H.AUDIT);
  return {ok:true,sheets:V54};
}
function v54MigrateBatchResourceIds(token){
  setupV54ResourceStockEngine();try{_requireAuth_(token,'stock');}catch(e){return _failFrom_(e);}
  return _withLock_(function(){
    var sh=_stockBatchesSheet_(),v=sh.getDataRange().getValues();
    var hdr=v[0].map(String), pidCol=hdr.indexOf('ProductID')+1, dimCol=hdr.indexOf('Dimension')+1, cuCol=hdr.indexOf('Канон.ед.')+1, cqCol=hdr.indexOf('Канон.кол-во')+1;
    if(!pidCol){pidCol=hdr.length+1;sh.getRange(1,pidCol).setValue('ProductID');}
    if(!dimCol){dimCol=sh.getLastColumn()+1;sh.getRange(1,dimCol).setValue('Dimension');}
    if(!cuCol){cuCol=sh.getLastColumn()+1;sh.getRange(1,cuCol).setValue('Канон.ед.');}
    if(!cqCol){cqCol=sh.getLastColumn()+1;sh.getRange(1,cqCol).setValue('Канон.кол-во');}
    var added=0,review=0,rows=[];
    v=sh.getDataRange().getValues();
    for(var i=1;i<v.length;i++){
      if(!v[i][0])continue;var name=String(v[i][1]||''),unit=String(v[i][2]||''),map=_v54ResolveProduct_(name,unit);
      if(map.ok){
        var conv=v53ConvertQty(v[i][9]||0,unit,map.dimension==='MASS'?'g':map.dimension==='VOLUME'?'ml':map.dimension==='COUNT'?'pcs':unit);
        var canonUnit=conv.ok?conv.toUnit:unit, canonQty=conv.ok?conv.qty:(Number(v[i][9])||0);
        sh.getRange(i+1,pidCol,1,4).setValues([[map.productId,map.dimension,canonUnit,canonQty]]);added++;rows.push({batchId:v[i][0],productId:map.productId,status:'APPROVED'});
      }else{sh.getRange(i+1,pidCol,1,4).setValues([['','REVIEW',unit,'']]);review++;rows.push({batchId:v[i][0],status:'REVIEW',reason:map.reason});}
    }
    _v54Audit_('MIGRATE_BATCH_IDS','BATCH','','',null,{approved:added,review:review},'OK','Ресурсы партий нормализованы без изменения физического остатка',_v54Actor_(token));
    return {ok:true,approved:added,review:review,rows:rows.slice(-500)};
  });
}
function v54GetBatchResource(batchId,token){
  setupV54ResourceStockEngine();var sh=_stockBatchesSheet_(),v=sh.getDataRange().getValues(),h=v[0].map(String);var row=null;for(var i=1;i<v.length;i++)if(String(v[i][0])===String(batchId)){row=v[i];break;}if(!row)return {ok:false,error:'Партия не найдена'};
  var pcol=h.indexOf('ProductID'),dcol=h.indexOf('Dimension'),ucol=h.indexOf('Канон.ед.'),qcol=h.indexOf('Канон.кол-во');return {ok:true,batchId:batchId,name:row[1],unit:row[2],qty:Number(row[9])||0,productId:pcol>=0?String(row[pcol]||''):'',dimension:dcol>=0?String(row[dcol]||''):'',canonicalUnit:ucol>=0?String(row[ucol]||''):'',canonicalQty:qcol>=0?Number(row[qcol])||0:null,status:row[10]||'active'};
}
function _v54WriteOp_(opId,action,batchId,productId,qty,unit,canonQty,before,after,source,sourceId,status,message,actor){_v54Sh_(V54.OPS,V54H.OPS).appendRow([opId,new Date(),action,batchId||'',productId||'',qty||0,unit||'',canonQty||0,before||0,after||0,source||'',sourceId||'',status||'COMPLETED',actor||'SYSTEM',message||'']);}
function stockEngineConsumeSpecificBatch(batchId,qty,unit,source,sourceId,token){
  setupV54ResourceStockEngine();var op=null;try{op=_beginOp_(token,'stock','STOCK_CONSUME_V54','Партия',batchId,null);}catch(e){return _failFrom_(e);}
  return _withLock_(function(){try{
    if(!(Number(qty)>0))throw new Error('VALIDATION: количество должно быть больше нуля');
    var info=v54GetBatchResource(batchId,token);if(!info.ok)throw new Error('NOT_FOUND: '+info.error);if(info.status!=='active')throw new Error('VALIDATION: партия не активна');
    var conv=v53ConvertQty(qty,unit||info.unit,info.unit);if(!conv.ok)throw new Error('VALIDATION: несовместимые единицы');
    if(conv.qty>info.qty+0.0001)throw new Error('VALIDATION: недостаточно остатка в партии');
    var r=_consumeSpecificBatch_(batchId,conv.qty);var actor=_v54Actor_(token);var canon=r.taken;
    _v54WriteOp_(op.id,'CONSUME',batchId,info.productId,qty,unit||info.unit,canon,info.qty,r.remainBefore-conv.qty,source,sourceId,'COMPLETED','Проведено единым Stock Engine',actor);
    _v54Audit_('CONSUME','BATCH',batchId,op.id,{qty:info.qty},{qty:r.remainBefore-conv.qty},'OK','Партия списана через V54',actor);_endOp_(op);return {ok:true,operationId:op.id,batchId:batchId,taken:conv.qty,unit:info.unit,remaining:r.remainBefore-conv.qty};
  }catch(e){_endOp_(op,'FAILED');return {ok:false,error:String(e&&e.message||e),operationId:op.id};}});
}
function stockEngineAdjustBatch(batchId,newQty,reason,token){
  setupV54ResourceStockEngine();var op=null;try{op=_beginOp_(token,'stock','STOCK_ADJUST_V54','Партия',batchId,null);}catch(e){return _failFrom_(e);}
  return _withLock_(function(){try{
    var info=v54GetBatchResource(batchId,token);if(!info.ok)throw new Error('NOT_FOUND: '+info.error);var q=Number(newQty);if(!isFinite(q)||q<0)throw new Error('VALIDATION: некорректное количество');
    var sh=_stockBatchesSheet_(),v=sh.getDataRange().getValues(),before=info.qty,row=-1;for(var i=1;i<v.length;i++)if(String(v[i][0])===String(batchId)){row=i+1;break;}if(row<0)throw new Error('NOT_FOUND: партия не найдена');
    sh.getRange(row,10).setValue(Math.round(q*1000)/1000);var st0=String(v[row-1][10]||'');/* этап 10.7: корректировка остатка не снимает карантин и блокировку */sh.getRange(row,11).setValue(q<=0.001?'consumed':(st0==='consumed'||st0===''?'active':st0));
    var delta=q-before,actor=_v54Actor_(token);_v54WriteOp_(op.id,'ADJUST',batchId,info.productId,delta,info.unit,delta,before,q,'REVISION','', 'COMPLETED',reason||'Корректировка остатка',actor);_v54Audit_('ADJUST','BATCH',batchId,op.id,{qty:before},{qty:q},'OK',reason||'',actor);_endOp_(op);return {ok:true,operationId:op.id,batchId:batchId,before:before,after:q,delta:delta};
  }catch(e){_endOp_(op,'FAILED');return {ok:false,error:String(e&&e.message||e),operationId:op.id};}});
}
function v54CreateReservation(batchId,qty,unit,sourceType,sourceId,token){
  setupV54ResourceStockEngine();var op=null;try{op=_beginOp_(token,'stock','STOCK_RESERVE_V54','Партия',batchId,null);}catch(e){return _failFrom_(e);}
  return _withLock_(function(){try{
    var info=v54GetBatchResource(batchId,token);if(!info.ok)throw new Error('NOT_FOUND: '+info.error);if(info.status!=='active')throw new Error('VALIDATION: партия не активна');var conv=v53ConvertQty(qty,unit||info.unit,info.unit);if(!conv.ok)throw new Error('VALIDATION: несовместимые единицы');if(conv.qty>info.qty+0.0001)throw new Error('VALIDATION: недостаточно остатка');
    var active=_v54Rows_(V54.RESERVES,V54H.RESERVES).filter(function(r){return String(r.BatchID)===String(batchId)&&['ACTIVE','TASK_CREATED'].indexOf(String(r.Status))>=0;}).reduce(function(s,r){return s+Number(r.Qty)||0;},0);if(active+conv.qty>info.qty+0.0001)throw new Error('VALIDATION: недостаточно свободного остатка с учётом резервов');
    var id=_v54Id_('RES'),actor=_v54Actor_(token),canon=conv.qty;_v54Sh_(V54.RESERVES,V54H.RESERVES).appendRow([id,batchId,info.productId,qty,unit||info.unit,canon,sourceType||'',sourceId||'','ACTIVE',new Date(),' ',op.id,actor]);_v54Audit_('RESERVE','BATCH',batchId,op.id,{free:info.qty-active},{free:info.qty-active-canon},'OK','Резерв без физического списания',actor);_endOp_(op);return {ok:true,reserveId:id,operationId:op.id,batchId:batchId,qty:qty,unit:unit||info.unit};
  }catch(e){_endOp_(op,'FAILED');return {ok:false,error:String(e&&e.message||e),operationId:op.id};}});
}
function v54ReleaseReservation(reserveId,token){setupV54ResourceStockEngine();var op=null;try{op=_beginOp_(token,'stock','STOCK_RESERVE_RELEASE_V54','Резерв',reserveId,null);}catch(e){return _failFrom_(e);}return _withLock_(function(){try{var sh=_v54Sh_(V54.RESERVES,V54H.RESERVES),v=sh.getDataRange().getValues(),h=v[0].map(String),row=-1,r=null;for(var i=1;i<v.length;i++)if(String(v[i][0])===String(reserveId)){row=i+1;r=v[i];break;}if(row<0)throw new Error('NOT_FOUND: резерв не найден');var si=h.indexOf('Status')+1;if(String(r[si-1])==='RELEASED'){_endOp_(op);return {ok:true,idempotent:true};}sh.getRange(row,si).setValue('RELEASED');sh.getRange(row,h.indexOf('ReleasedAt')+1).setValue(new Date());_v54Audit_('RELEASE_RESERVE','RESERVATION',reserveId,op.id,{status:r[si-1]},{status:'RELEASED'},'OK','Резерв снят',_v54Actor_(token));_endOp_(op);return {ok:true,reserveId:reserveId,operationId:op.id,status:'RELEASED'};}catch(e){_endOp_(op,'FAILED');return {ok:false,error:String(e&&e.message||e),operationId:op.id};}});}
function v54GetFreeBatch(batchId){var info=v54GetBatchResource(batchId);if(!info.ok)return info;var reserved=_v54Rows_(V54.RESERVES,V54H.RESERVES).filter(function(r){return String(r.BatchID)===String(batchId)&&['ACTIVE','TASK_CREATED'].indexOf(String(r.Status))>=0;}).reduce(function(s,r){return s+Number(r.Qty)||0;},0);return {ok:true,batchId:batchId,qty:info.qty,unit:info.unit,reserved:reserved,free:Math.max(0,info.qty-reserved),productId:info.productId};}
function v54GetDashboard(token){setupV54ResourceStockEngine();var map=_v54Rows_(V54.BATCH_MAP,V54H.BATCH_MAP),res=_v54Rows_(V54.RESERVES,V54H.RESERVES),ops=_v54Rows_(V54.OPS,V54H.OPS);return {ok:true,totals:{batchMapped:map.filter(function(x){return x.ProductID&&x.MappingStatus==='APPROVED';}).length,batchReview:map.filter(function(x){return x.MappingStatus==='REVIEW';}).length,activeReservations:res.filter(function(x){return ['ACTIVE','TASK_CREATED'].indexOf(String(x.Status))>=0;}).length,operations:ops.length},recentOperations:ops.slice(-100),reviewBatches:map.filter(function(x){return x.MappingStatus==='REVIEW';}).slice(-100)};}
function v54Readiness(token){setupV54ResourceStockEngine();var d=v54GetDashboard(token);var failures=[];if(d.totals.batchReview>0)failures.push('Есть партии без утверждённого ProductID: '+d.totals.batchReview);if(typeof v53ConvertQty!=='function')failures.push('V53 conversion engine отсутствует');return {ok:failures.length===0,status:failures.length?'BLOCKED':'READY',failures:failures,metrics:d.totals};}
