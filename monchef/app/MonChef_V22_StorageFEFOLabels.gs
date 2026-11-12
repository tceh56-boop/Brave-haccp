/**
 * MON CHEF V22 — STORAGE / FEFO / BATCH LABELS
 *
 * Приёмка -> партия -> предложение места хранения -> подтверждение -> FEFO-регистрация
 * -> резерв партии под производство -> печатная маркировка.
 *
 * Важный принцип: автоматическое предложение места не является молчаливым переносом.
 * Если правило не определено или есть конфликт условий, система требует подтверждения.
 */
var MC_V22_LOCATIONS='Склад_Места_V22';
var MC_V22_RULES='Склад_Правила_V22';
var MC_V22_RES='FEFO_Резервы_V22';
var MC_V22_LABELS='Этикетки_Партии_V22';
var MC_V22_PRODUCTS='Продукты_V22';

function _mcV22Sheet_(name,headers){
  var ss=_book_(),sh=ss.getSheetByName(name);
  if(!sh){sh=ss.insertSheet(name);sh.appendRow(headers);sh.setFrozenRows(1);}
  return sh;
}
function _mcV22Locations_(){return _mcV22Sheet_(MC_V22_LOCATIONS,['LocationID','Название','Тип','ТемператураМин','ТемператураМакс','ВлажностьМакс','Активно','Приоритет','Описание']);}
function _mcV22Rules_(){return _mcV22Sheet_(MC_V22_RULES,['RuleID','ProductType','Keyword','StorageType','LocationID','Priority','Active','Reason']);}
function _mcV22Res_(){return _mcV22Sheet_(MC_V22_RES,['ReservationID','Product','BatchID','SourceType','SourceID','Qty','Unit','ReservedAt','ReservedBy','Status','FEFOKey','Note']);}
function _mcV22Labels_(){return _mcV22Sheet_(MC_V22_LABELS,['LabelID','BatchID','Product','Unit','Qty','Manufactured','Expiry','SupplierBatch','LocationID','PrintedAt','PrintedBy','PrintCount','Status']);}
function _mcV22Products_(){return _mcV22Sheet_(MC_V22_PRODUCTS,['ProductID','Название продукта','Тип продукта','Описание','Условия хранения','Срок комнатная','Срок холодильник','Срок морозильник','Признаки порчи','Важные замечания','SourceRow','ImportedAt']);}
function _mcV22Id_(p){return p+'-'+Date.now()+'-'+Math.floor(Math.random()*100000);}
function _mcV22Parse_(x){if(x&&typeof x==='object')return x;try{return JSON.parse(x||'{}');}catch(e){return {ok:false,error:{message:String(x)}};}}
function _mcV22Num_(x){var n=Number(x);return isFinite(n)?n:0;}
function _mcV22Date_(x){if(x instanceof Date&&!isNaN(x))return x; if(!x)return null; var d=new Date(x); return isNaN(d)?null:d;}
function _mcV22Norm_(x){return _cleanProdName_(x).toLowerCase().replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,' ' ).trim();}

/** Первичная настройка типовых мест. Названия можно изменить, а правила — дополнить. */
function initMonChefV22Storage(){
  var sh=_mcV22Locations_(),existing=sh.getDataRange().getValues();
  if(existing.length===1){[
    ['FRIDGE-01','Холодильник №1','FRIDGE',2,6,80,'ACTIVE',10,'Основное охлаждение'],
    ['FRIDGE-02','Холодильник №2','FRIDGE',2,6,80,'ACTIVE',20,'Основное охлаждение'],
    ['FREEZER-01','Морозильник №1','FREEZER',-25,-18,85,'ACTIVE',10,'Замороженная продукция'],
    ['DRY-01','Сухой склад','DRY',14,22,70,'ACTIVE',10,'Сухие продукты'],
    ['PRODUCE-01','Овощи и фрукты','PRODUCE',2,10,90,'ACTIVE',5,'Зона овощей и фруктов'],
    ['FRY-01','Фритюрная зона','EQUIPMENT',15,30,80,'ACTIVE',10,'Масло/фритюр'],
  ].forEach(function(r){sh.appendRow(r);});
  }
  var rs=_mcV22Rules_(),rv=rs.getDataRange().getValues();
  if(rv.length===1){[
    ['RULE-PRODUCE','фрукт','', 'PRODUCE','PRODUCE-01',10,'ACTIVE','Фрукты — отдельная зона'],
    ['RULE-VEG','овощ','', 'PRODUCE','PRODUCE-01',10,'ACTIVE','Овощи — отдельная зона'],
    ['RULE-MEAT','мяс','', 'FRIDGE','FRIDGE-01',20,'ACTIVE','Охлаждённое мясо'],
    ['RULE-FISH','рыб','', 'FRIDGE','FRIDGE-02',20,'ACTIVE','Рыба отдельно от другого сырья'],
    ['RULE-FROZEN','заморож','', 'FREEZER','FREEZER-01',10,'ACTIVE','Замороженное сырьё'],
    ['RULE-DRY','бакале','', 'DRY','DRY-01',20,'ACTIVE','Сухой склад'],
  ].forEach(function(r){rs.appendRow(r);});
  }
  return _ok_({locations:Math.max(0,sh.getLastRow()-1),rules:Math.max(0,rs.getLastRow()-1)});
}

/** Импортирует базу продуктов из CSV, подготовленного из пользовательского XLSX. */
function importMonChefV22ProductCatalog(csvText,token){
  try{
    _requireAuth_(token,'stock');
    if(!csvText) return _fail_('VALIDATION','Пустой CSV');
    var lines=Utilities.parseCsv(csvText,';');
    if(!lines.length) return _fail_('VALIDATION','CSV не распознан');
    var sh=_mcV22Products_();
    if(sh.getLastRow()>1) sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).clearContent();
    var now=new Date(),out=[];
    for(var i=1;i<lines.length;i++){
      var r=lines[i]; if(!r||!r[1]) continue;
      out.push([String(r[0]||('P'+i)),r[1],r[2]||'',r[3]||'',r[11]||'',r[12]||'',r[13]||'',r[14]||'',r[15]||'',r[16]||'',i+1,now]);
    }
    if(out.length) sh.getRange(2,1,out.length,out[0].length).setValues(out);
    return _ok_({imported:out.length,source:'ProductCatalog_V22.csv'});
  }catch(e){return _failFrom_(e);}
}

function getMonChefV22Product(name,token){
  try{
    _requireAuth_(token,'stock'); var sh=_mcV22Products_(),v=sh.getDataRange().getValues(),key=_mcV22Norm_(name);
    for(var i=1;i<v.length;i++) if(_mcV22Norm_(v[i][1])===key) return _ok_({productId:v[i][0],name:v[i][1],type:v[i][2],description:v[i][3],storage:v[i][4],roomShelfLife:v[i][5],fridgeShelfLife:v[i][6],freezerShelfLife:v[i][7],spoilage:v[i][8],notes:v[i][9]});
    return _fail_('NOT_FOUND','Продукт не найден в базе V22');
  }catch(e){return _failFrom_(e);}
}

function _mcV22FindLocation_(product,manufactured,expiry){
  var p=_mcV22Norm_(product), ps=_mcV22Products_().getDataRange().getValues(),ptype='',storage='';
  for(var i=1;i<ps.length;i++) if(_mcV22Norm_(ps[i][1])===p){ptype=_mcV22Norm_(ps[i][2]);storage=String(ps[i][4]||'').toLowerCase();break;}
  var rules=_mcV22Rules_().getDataRange().getValues(),c=[];
  for(var j=1;j<rules.length;j++){
    if(String(rules[j][6])!=='ACTIVE')continue;
    var typ=_mcV22Norm_(rules[j][1]),kw=_mcV22Norm_(rules[j][2]);
    if((typ&&ptype.indexOf(typ)>=0)||(kw&&p.indexOf(kw)>=0)) c.push({locationId:rules[j][4],priority:_mcV22Num_(rules[j][5]),reason:rules[j][7]||''});
  }
  if(storage.indexOf('мороз')>=0)c.push({locationId:'FREEZER-01',priority:1,reason:'Условия хранения продукта указывают на морозильник'});
  if(storage.indexOf('холод')>=0)c.push({locationId:'FRIDGE-01',priority:50,reason:'Условия хранения продукта указывают на холодильник'});
  if(storage.indexOf('комнат')>=0||storage.indexOf('сух')>=0)c.push({locationId:'DRY-01',priority:60,reason:'Условия хранения допускают сухой склад'});
  c.sort(function(a,b){return a.priority-b.priority;});
  return c.length?{locationId:c[0].locationId,reason:c[0].reason,confidence:c[0].priority<=10?'HIGH':'MEDIUM'}:{locationId:'',reason:'Нет правила — требуется выбрать место вручную',confidence:'LOW'};
}

function _mcV22AutoPutAwayBatch_(batchId){
  var sh=_stockBatchesSheet_(),v=sh.getDataRange().getValues(),r=-1,row=null;
  for(var i=1;i<v.length;i++)if(String(v[i][0])===String(batchId)){r=i+1;row=v[i];break;}
  if(r<0)return {batchId:batchId,status:'NOT_FOUND'};
  var s=_mcV22FindLocation_(row[1],row[11],row[5]);
  if(!s.locationId)return {batchId:batchId,status:'MANUAL_REQUIRED',reason:s.reason};
  var hdr=sh.getRange(1,15,1,3).getValues()[0];
  if(!hdr[0]&&!hdr[1]&&!hdr[2])sh.getRange(1,15,1,3).setValues([['Место хранения','FEFO ключ','Дата размещения']]);
  var exp=_mcV22Date_(row[5]),fefo=exp?exp.getTime():Number.MAX_SAFE_INTEGER;
  sh.getRange(r,15,1,3).setValues([[s.locationId,fefo,new Date()]]);
  return {batchId:batchId,status:'AUTO_ASSIGNED',locationId:s.locationId,confidence:s.confidence,reason:s.reason};
}

function suggestBatchStorage(batchId,token){
  try{
    _requireAuth_(token,'stock'); var sh=_stockBatchesSheet_(),v=sh.getDataRange().getValues(),row=null;
    for(var i=1;i<v.length;i++)if(String(v[i][0])===String(batchId)){row=v[i];break;}
    if(!row)return _fail_('NOT_FOUND','Партия не найдена');
    return _ok_({batchId:batchId,product:row[1],manufactured:row[11],expiry:row[5],suggestion:_mcV22FindLocation_(row[1],row[11],row[5])});
  }catch(e){return _failFrom_(e);}
}

function assignBatchStorage(batchId,locationId,token){
  try{
    var op=_beginOp_(token,'stock','BATCH_STORAGE_ASSIGN','Склад',batchId,null);
    return _withLock_(function(){
      var sh=_stockBatchesSheet_(),v=sh.getDataRange().getValues(),r=-1,row=null;
      for(var i=1;i<v.length;i++)if(String(v[i][0])===String(batchId)){r=i+1;row=v[i];break;}
      if(r<0){_endOp_(op,'FAILED');return _fail_('NOT_FOUND','Партия не найдена',op.id);}
      var ls=_mcV22Locations_().getDataRange().getValues(),valid=false;
      for(var j=1;j<ls.length;j++)if(String(ls[j][0])===String(locationId)&&String(ls[j][6])==='ACTIVE')valid=true;
      if(!valid){_endOp_(op,'FAILED');return _fail_('VALIDATION','Место хранения не найдено или отключено',op.id);}
      var hdr=sh.getRange(1,15,1,3).getValues()[0];
      if(!hdr[0]&&!hdr[1]&&!hdr[2]) sh.getRange(1,15,1,3).setValues([['Место хранения','FEFO ключ','Дата размещения']]);
      var expiry=_mcV22Date_(row[5]),fefo=expiry?expiry.getTime():Number.MAX_SAFE_INTEGER;
      sh.getRange(r,15,1,3).setValues([[locationId,fefo,new Date()]]);
      try{_mcCreateFactInternal_({factType:'STORAGE_ASSIGNMENT',objectType:'BATCH',objectId:batchId,operationType:'PUT_AWAY',dateTime:new Date(),value:locationId,result:'RECORDED',source:'STORAGE',batchId:batchId,description:'Партия размещена: '+locationId},op&&op.session?op.session:null);}catch(ignore){}
      _endOp_(op,'COMPLETED');
      return _ok_({batchId:batchId,locationId:locationId,fefoKey:fefo,operationId:op.id});
    });
  }catch(e){return _failFrom_(e);}
}

/** Возвращает партии одного продукта в FEFO-порядке. */
function getFEFOBatches(product,qty,token){
  try{
    _requireAuth_(token,'stock'); var v=_mcRO_('v22batches',function(){return _stockBatchesSheet_().getDataRange().getValues();}),arr=[],need=_mcV22Num_(qty),reserved={};
    try{var rv=_mcRO_('v22res',function(){return _mcV22Res_().getDataRange().getValues();});for(var rr=1;rr<rv.length;rr++)if(String(rv[rr][9])==='ACTIVE')reserved[String(rv[rr][2])]=Number(reserved[String(rv[rr][2])]||0)+_mcV22Num_(rv[rr][5]);}catch(ignore){}
    for(var i=1;i<v.length;i++){
      if(_mcV22Norm_(v[i][1])!==_mcV22Norm_(product)||String(v[i][10])!=='active')continue;
      if(typeof _bcExpired_==='function'&&_bcExpired_(v[i][5]))continue; // просроченная партия не предлагается
      var available=Math.max(0,_mcV22Num_(v[i][9])-Number(reserved[String(v[i][0])]||0)); if(available<=0)continue;
      var exp=_mcV22Date_(v[i][5]); arr.push({batchId:v[i][0],product:v[i][1],unit:v[i][2],available:available,expiry:v[i][5],manufactured:v[i][11],supplierBatch:v[i][12],locationId:v[i][14]||'',fefoKey:exp?exp.getTime():Number.MAX_SAFE_INTEGER});
    }
    arr.sort(function(a,b){return a.fefoKey-b.fefoKey;});
    var remaining=need;arr.forEach(function(x){x.suggestedQty=Math.min(x.available,remaining);remaining=Math.max(0,remaining-x.suggestedQty);});
    return _ok_({product:product,requested:need,batches:arr,uncovered:remaining});
  }catch(e){return _failFrom_(e);}
}

/** Резервирует партии в FEFO-порядке. Резерв не списывает товар. */
function reserveFEFO(product,qty,unit,sourceType,sourceId,token){
  try{
    var op=_beginOp_(token,'stock','FEFO_RESERVE','Склад',sourceId,null);
    return _withLock_(function(){
      var raw=getFEFOBatches(product,qty,token),data=_mcV22Parse_(raw),b=data.data||{},arr=b.batches||[],need=_mcV22Num_(qty),actor=_mcV21Actor_(token),now=new Date(),sh=_mcV22Res_(),created=[];
      for(var i=0;i<arr.length&&need>0;i++){
        var q=Math.min(_mcV22Num_(arr[i].available),need);if(q<=0)continue;
        var id=_mcV22Id_('RES');sh.appendRow([id,product,arr[i].batchId,sourceType||'PRODUCTION',sourceId||'',q,unit||arr[i].unit,now,actor,'ACTIVE',arr[i].fefoKey,'Авто-FEFO']);created.push({reservationId:id,batchId:arr[i].batchId,qty:q,expiry:arr[i].expiry,locationId:arr[i].locationId});need-=q;
      }
      if(need>0){_endOp_(op,'FAILED');return _fail_('SHORTAGE','Недостаточно партии для FEFO-резерва: '+need,op.id);}
      _endOp_(op,'COMPLETED');return _ok_({product:product,requested:qty,reserved:created,operationId:op.id});
    });
  }catch(e){return _failFrom_(e);}
}

function createBatchLabel(batchId,token){
  try{
    var op=_beginOp_(token,'stock','BATCH_LABEL_CREATE','Склад',batchId,null);var sh=_stockBatchesSheet_(),v=sh.getDataRange().getValues(),r=null;
    for(var i=1;i<v.length;i++)if(String(v[i][0])===String(batchId)){r=v[i];break;}
    if(!r){_endOp_(op,'FAILED');return _fail_('NOT_FOUND','Партия не найдена',op.id);}
    var ls=_mcV22Labels_(),id=_mcV22Id_('LBL'),loc=r[14]||'',now=new Date();ls.appendRow([id,batchId,r[1],r[2],r[9],r[11]||'',r[5]||'',r[12]||'',loc,'','',0,'READY']);
    _endOp_(op,'COMPLETED');return _ok_({labelId:id,batchId:batchId,product:r[1],unit:r[2],qty:r[9],manufactured:r[11]||'',expiry:r[5]||'',supplierBatch:r[12]||'',locationId:loc,operationId:op.id});
  }catch(e){return _failFrom_(e);}
}

function markBatchLabelPrinted(labelId,token){
  try{
    _requireAuth_(token,'stock');var sh=_mcV22Labels_(),v=sh.getDataRange().getValues();
    for(var i=1;i<v.length;i++)if(String(v[i][0])===String(labelId)){sh.getRange(i+1,10).setValue(new Date());sh.getRange(i+1,11).setValue(_mcV21Actor_(token));sh.getRange(i+1,12).setValue(_mcV22Num_(v[i][11])+1);sh.getRange(i+1,13).setValue('PRINTED');return _ok_({labelId:labelId,printCount:_mcV22Num_(v[i][11])+1});}
    return _fail_('NOT_FOUND','Этикетка не найдена');
  }catch(e){return _failFrom_(e);}
}

function getBatchLabelData(batchId,token){
  try{
    _requireAuth_(token,'stock');var sh=_stockBatchesSheet_(),v=sh.getDataRange().getValues();
    for(var i=1;i<v.length;i++)if(String(v[i][0])===String(batchId)){
      return _ok_({batchId:v[i][0],product:v[i][1],unit:v[i][2],qty:v[i][9],received:v[i][4],expiry:v[i][5],manufactured:v[i][11]||'',supplierBatch:v[i][12]||'',docRef:v[i][13]||'',locationId:v[i][14]||'',labelCode:'MC-'+v[i][0]});
    }
    return _fail_('NOT_FOUND','Партия не найдена');
  }catch(e){return _failFrom_(e);}
}

function getStorageDashboardV22(token){
  try{
    _requireAuth_(token,'stock');var sh=_stockBatchesSheet_(),v=sh.getDataRange().getValues(),unplaced=0,near=0,now=new Date(),days=3*86400000,loc={};
    for(var i=1;i<v.length;i++){if(!v[i][0]||String(v[i][10])!=='active')continue; if(!v[i][14])unplaced++; var e=_mcV22Date_(v[i][5]);if(e&&e.getTime()-now.getTime()<=days)near++;var l=v[i][14]||'UNPLACED';loc[l]=(loc[l]||0)+_mcV22Num_(v[i][9]);}
    return _ok_({activeBatches:Math.max(0,v.length-1),unplacedBatches:unplaced,nearExpiryBatches:near,byLocation:loc});
  }catch(e){return _failFrom_(e);}
}
