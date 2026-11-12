/**
 * MON CHEF V23 — Склад → Производство
 * FEFO-подбор партий для производственного задания.
 * Партия резервируется до отбора; фактический отбор подтверждается сканированием.
 */
var MC_V23_PICK = 'Отбор_V23';

function _mcV23Pick_(){return _mcV22Sheet_(MC_V23_PICK,['PickID','ProductionID','Product','BatchID','QtyPlanned','QtyPicked','Unit','LocationID','ReservationID','Status','PickedAt','PickedBy','CreatedAt','Note']);}
function _mcV23Norm_(x){return String(x==null?'':x).trim().toLowerCase();}
function _mcV23Rows_(){var v=_mcV23Pick_().getDataRange().getValues(),a=[];for(var i=1;i<v.length;i++)if(v[i][0])a.push({row:i+1,id:v[i][0],productionId:v[i][1],product:v[i][2],batchId:v[i][3],planned:Number(v[i][4])||0,picked:Number(v[i][5])||0,unit:v[i][6],locationId:v[i][7],reservationId:v[i][8],status:v[i][9],pickedAt:v[i][10],pickedBy:v[i][11],createdAt:v[i][12],note:v[i][13]});return a;}

function createProductionPickPlan(productionId,requirements,token){
  try{
    _requireAuth_(token,'stock');
    if(!productionId)return _fail_('PRODUCTION_REQUIRED','Укажите производственное задание');
    if(!Array.isArray(requirements)||!requirements.length)return _fail_('REQUIREMENTS_REQUIRED','Передайте состав потребности по продуктам');
    var created=[],warnings=[];
    requirements.forEach(function(req){
      var product=req.product||req.name,qty=_mcV22Num_(req.qty),unit=req.unit||'';if(!product||qty<=0)return;
      var existing=_mcV23Rows_().filter(function(x){return String(x.productionId)===String(productionId)&&_mcV23Norm_(x.product)===_mcV23Norm_(product)&&x.status!=='CANCELLED'&&x.status!=='PICKED';});
      var already=existing.reduce(function(s,x){return s+Math.max(0,x.planned-x.picked);},0);var need=Math.max(0,qty-already);if(need<=0)return;
      var res=getFEFOBatches(product,need,token),data=_mcV22Parse_(res),b=data.data||{},arr=b.batches||[];
      var usable=arr.filter(function(x){return x.suggestedQty>0&&x.locationId;});
      var covered=0;
      usable.forEach(function(x){var q=Math.min(_mcV22Num_(x.suggestedQty),need-covered);if(q<=0)return;var r=reserveFEFO(product,q,unit,'PRODUCTION',productionId,token),rd=_mcV22Parse_(r),d=rd.data||{};var rr=(d.reserved||[]).filter(function(z){return String(z.batchId)===String(x.batchId);})[0];if(rr){var id=_mcV22Id_('PICK');_mcV23Pick_().appendRow([id,productionId,product,x.batchId,q,0,unit||x.unit,x.locationId,rr.reservationId,'RESERVED','',_mcV21Actor_(token),new Date(),'FEFO']);created.push({pickId:id,product:product,batchId:x.batchId,qty:q,unit:unit||x.unit,locationId:x.locationId,reservationId:rr.reservationId,expiry:x.expiry});covered+=q;}});
      if(covered<need)warnings.push({product:product,required:qty,reserved:covered,shortage:need-covered,reason:usable.length?'Недостаточно доступного остатка':'Есть партии без места хранения или нет доступной партии'});
    });
    return _ok_({productionId:productionId,picks:created,warnings:warnings});
  }catch(e){return _failFrom_(e);}
}

function getProductionPickPlan(productionId,token){try{_requireAuth_(token,'stock');return _ok_({productionId:productionId,rows:_mcV23Rows_().filter(function(x){return String(x.productionId)===String(productionId);})});}catch(e){return _failFrom_(e);}}

function confirmProductionPick(pickId,batchId,qty,token){
  try{
    var op=_beginOp_(token,'stock','PRODUCTION_PICK','Производство',pickId,null);
    return _withLock_(function(){
      var sh=_mcV23Pick_(),v=sh.getDataRange().getValues(),r=-1,row=null;for(var i=1;i<v.length;i++)if(String(v[i][0])===String(pickId)){r=i+1;row=v[i];break;}
      if(r<0){_endOp_(op,'FAILED');return _fail_('NOT_FOUND','Задание отбора не найдено',op.id);}
      if(String(row[3])!==String(batchId)){_endOp_(op,'FAILED');return _fail_('BATCH_MISMATCH','Сканированная партия не соответствует заданию отбора',op.id);}
      var planned=_mcV22Num_(row[4]),picked=_mcV22Num_(row[5]),q=_mcV22Num_(qty);if(q<=0||picked+q>planned){_endOp_(op,'FAILED');return _fail_('QTY_INVALID','Количество отбора превышает план',op.id);}
      var bs=_stockBatchesSheet_(),bv=bs.getDataRange().getValues(),br=-1,b=null;for(var j=1;j<bv.length;j++)if(String(bv[j][0])===String(batchId)){br=j+1;b=bv[j];break;}
      if(br<0){_endOp_(op,'FAILED');return _fail_('BATCH_NOT_FOUND','Партия не найдена',op.id);}
      if(String(b[10]||'active')!=='active'){_endOp_(op,'FAILED');return _fail_('BATCH_NOT_RELEASED','Партия «'+b[1]+'» недоступна: статус «'+b[10]+'» (карантин/брак/повторный контроль)',op.id);}
      if(typeof _bcExpired_==='function'&&_bcExpired_(b[5])){_endOp_(op,'FAILED');return _fail_('BATCH_EXPIRED','Срок годности партии «'+b[1]+'» истёк — использовать нельзя',op.id);}
      var available=_mcV22Num_(b[9]);if(q>available){_endOp_(op,'FAILED');return _fail_('STOCK_SHORTAGE','Недостаточно остатка партии',op.id);}
      // Списание именно фактически отобранного количества.
      bs.getRange(br,10).setValue(available-q);bs.getRange(br,9).setValue(_mcV22Num_(b[8])+q);if(available-q<=0)bs.getRange(br,11).setValue('consumed');
      var np=picked+q,status=np>=planned?'PICKED':'PARTIAL';sh.getRange(r,6).setValue(np);sh.getRange(r,10).setValue(status);sh.getRange(r,11).setValue(new Date());sh.getRange(r,12).setValue(_mcV21Actor_(token));
      try{_mcCreateFactInternal_({factType:'PRODUCTION_PICK',objectType:'PRODUCTION',objectId:row[1],operationType:'STOCK_ISSUE',dateTime:new Date(),value:q,unit:row[6],result:'PICKED',source:'PRODUCTION_PICK',batchId:batchId,description:'Отбор сырья по FEFO: '+row[2]},op&&op.session?op.session:null);}catch(ignore){}
      try{_mcCreateTraceLink_('BATCH',String(batchId),'ИЗРАСХОДОВАНА_В','PRODUCTION',String(row[1]),{dateTime:new Date(),actor:_mcV21Actor_(token),source:'PRODUCTION_PICK',qty:q,product:row[2]});}catch(ignore2){}
      _endOp_(op,'COMPLETED');return _ok_({pickId:pickId,productionId:row[1],batchId:batchId,qtyPicked:q,status:status,remaining:planned-np,operationId:op.id});
    });
  }catch(e){return _failFrom_(e);}
}

function scanProductionPick(batchId,token){try{_requireAuth_(token,'stock');var rows=_mcV23Rows_().filter(function(x){return String(x.batchId)===String(batchId)&&x.status!=='PICKED'&&x.status!=='CANCELLED';});return _ok_({batchId:batchId,matches:rows});}catch(e){return _failFrom_(e);}}

function cancelProductionPick(pickId,reason,token){try{_requireAuth_(token,'stock');var sh=_mcV23Pick_(),v=sh.getDataRange().getValues();for(var i=1;i<v.length;i++)if(String(v[i][0])===String(pickId)){sh.getRange(i+1,10).setValue('CANCELLED');sh.getRange(i+1,14).setValue(reason||'');return _ok_({pickId:pickId,status:'CANCELLED'});}return _fail_('NOT_FOUND','Задание отбора не найдено');}catch(e){return _failFrom_(e);}}
