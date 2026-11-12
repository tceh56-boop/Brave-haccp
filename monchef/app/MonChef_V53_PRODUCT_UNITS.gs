/**
 * MON CHEF V53 — PRODUCT ID + UNIT NORMALIZATION
 *
 * Purpose: stable resource identity and safe unit conversion for TTK / stock / purchasing.
 * V53 is a reference/mapping layer. It does not change stock quantities.
 * Automatic name matching is conservative: exact normalized names only; ambiguous
 * matches are REVIEW and must not be used for automatic planning.
 */
var V53 = {
  PRODUCTS:'Продукты_ID_V53', MAP:'Продукты_Сопоставление_V53', UNITS:'Продукты_Единицы_V53', AUDIT:'Продукты_Аудит_V53'
};
var V53H = {
  PRODUCTS:['ProductID','Name','Type','SourceNo','CanonicalUnit','Dimension','Active','Source','CreatedAt'],
  MAP:['MapID','SourceType','SourceName','ProductID','MatchedName','Method','Confidence','Status','Notes','UpdatedAt','UpdatedBy'],
  UNITS:['Unit','CanonicalUnit','Dimension','Factor','Aliases','Active'],
  AUDIT:['AuditID','At','Action','ObjectType','ObjectID','Result','Message','Actor']
};
function _v53Sh_(n,h){var ss=_book_(),s=ss.getSheetByName(n);if(!s){s=ss.insertSheet(n);s.appendRow(h);s.setFrozenRows(1);}return s;}
function _v53Rows_(n,h){var s=_v53Sh_(n,h),v=s.getDataRange().getValues(),o=[];for(var i=1;i<v.length;i++){if(!v[i].some(function(x){return x!=='';}))continue;var r={};h.forEach(function(k,j){r[k]=v[i][j];});o.push(r);}return o;}
function _v53Norm_(x){return String(x==null?'':x).toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/gi,' ').replace(/\s+/g,' ').trim();}
function _v53Hash_(s){var h=2166136261;String(s||'').split('').forEach(function(c){h^=c.charCodeAt(0);h=Math.imul(h,16777619);});return ('00000000'+(h>>>0).toString(16)).slice(-8).toUpperCase();}
function _v53Pid_(name,type){return 'MC-P-'+_v53Hash_(_v53Norm_(name)+'|'+_v53Norm_(type));}
function _v53Unit_(u){var x=_v53Norm_(u);var m={g:'g',гр:'g',г:'g',gram:'g',грамм:'g',кг:'kg',kg:'kg',килограмм:'kg',мг:'mg',mg:'mg',ml:'ml',мл:'ml',миллилитр:'ml',l:'l',л:'l',литр:'l',шт:'pcs',штука:'pcs',штуки:'pcs',pcs:'pcs',pc:'pcs',уп:'pack',упак:'pack',упаковка:'pack'};return m[x]||String(u||'').trim().toLowerCase();}
function _v53Dim_(u){u=_v53Unit_(u);if(['mg','g','kg'].indexOf(u)>=0)return 'MASS';if(['ml','l'].indexOf(u)>=0)return 'VOLUME';if(u==='pcs')return 'COUNT';if(u==='pack')return 'PACKAGE';return 'UNKNOWN';}
function _v53Factor_(u){u=_v53Unit_(u);return {mg:0.001,g:1,kg:1000,ml:1,l:1000,pcs:1,pack:1}[u];}
function setupV53ProductUnits(){
  _v53Sh_(V53.PRODUCTS,V53H.PRODUCTS);_v53Sh_(V53.MAP,V53H.MAP);var us=_v53Sh_(V53.UNITS,V53H.UNITS);
  if(us.getLastRow()===1){[['mg','g','MASS',0.001,'мг;mg','YES'],['g','g','MASS',1,'г;гр;g','YES'],['kg','g','MASS',1000,'кг;kg','YES'],['ml','ml','VOLUME',1,'мл;ml','YES'],['l','ml','VOLUME',1000,'л;l;литр','YES'],['pcs','pcs','COUNT',1,'шт;штука;pcs','YES'],['pack','pack','PACKAGE',1,'уп;упак;упаковка;pack','YES']].forEach(function(r){us.appendRow(r);});}
  _v53Sh_(V53.AUDIT,V53H.AUDIT);return {ok:true,sheets:V53};
}
function _v53Audit_(action,type,id,result,msg,actor){_v53Sh_(V53.AUDIT,V53H.AUDIT).appendRow(['V53-'+Utilities.getUuid().slice(0,8),new Date(),action,type,id,result,msg,actor||'SYSTEM']);}
function v53RebuildProductIds(token){
  setupV53ProductUnits();
  try{_requireAuth_(token,'catalog');}catch(e){return _failFrom_(e);}
  var ss=_book_(),src=ss.getSheetByName(PRODUCTS_DB_SHEET),rows=src?src.getDataRange().getValues():[];
  if(!rows.length)return {ok:false,error:{code:'NOT_FOUND',message:'Нет листа '+PRODUCTS_DB_SHEET}};
  var h=rows[0].map(String), ni=h.indexOf('Название продукта'), ti=h.indexOf('Тип продукта'), no=h.indexOf('№');
  if(ni<0)return {ok:false,error:{code:'SCHEMA',message:'В справочнике нет «Название продукта»'}};
  var sh=_v53Sh_(V53.PRODUCTS,V53H.PRODUCTS), existing={};_v53Rows_(V53.PRODUCTS,V53H.PRODUCTS).forEach(function(r){existing[String(r.ProductID)]=r;});
  var added=0;
  for(var i=1;i<rows.length;i++){var name=String(rows[i][ni]||'').trim();if(!name)continue;var type=ti>=0?String(rows[i][ti]||''):'';var id=_v53Pid_(name,type);if(!existing[id]){sh.appendRow([id,name,type,no>=0?rows[i][no]:'',_v53Dim_(type),_v53Dim_(''), 'YES','PRODUCTS_DB',new Date()]);added++;}}
  // Fix canonical unit/dimension from product type is intentionally NOT inferred.
  // Product type is not a unit. Canonical unit remains blank until mapping/TTK evidence.
  var pv=sh.getDataRange().getValues();for(var r=1;r<pv.length;r++){if(!pv[r][0])continue;if(pv[r][4]===_v53Dim_('')||pv[r][4]==='UNKNOWN'){sh.getRange(r+1,5).setValue('');sh.getRange(r+1,6).setValue('UNKNOWN');}}
  _v53Audit_('REBUILD','PRODUCT_CATALOG','', 'OK','Добавлены стабильные ProductID: '+added,'USER');return {ok:true,added:added,total:Math.max(0,sh.getLastRow()-1)};
}
function _v53ProductIndex_(){var rows=_v53Rows_(V53.PRODUCTS,V53H.PRODUCTS),byId={},byName={};rows.forEach(function(r){byId[String(r.ProductID)]=r;var k=_v53Norm_(r.Name);if(!k)return;(byName[k]=byName[k]||[]).push(r);});return {rows:rows,byId:byId,byName:byName};}
function v53BuildMappings(token){
  setupV53ProductUnits();try{_requireAuth_(token,'catalog');}catch(e){return _failFrom_(e);}var idx=_v53ProductIndex_(),sh=_v53Sh_(V53.MAP,V53H.MAP),old=_v53Rows_(V53.MAP,V53H.MAP),manual={};old.forEach(function(r){if(String(r.Method)==='MANUAL')manual[String(r.SourceType)+'|'+_v53Norm_(r.SourceName)]=r;});
  var sources=[];var ss=_book_(),cs=ss.getSheetByName('Состав');if(cs){var v=cs.getDataRange().getValues();for(var i=1;i<v.length;i++)if(v[i][1])sources.push({type:'TTK',name:String(v[i][1]),unit:_v53Unit_(v[i][2])});}
  var sb=_stockBalanceSheet_();if(sb){var sv=sb.getDataRange().getValues();for(var j=1;j<sv.length;j++)if(sv[j][0])sources.push({type:'STOCK',name:String(sv[j][0]),unit:_v53Unit_(sv[j][1])});}
  var seen={};sources.forEach(function(s){var key=s.type+'|'+_v53Norm_(s.name);if(seen[key])return;seen[key]=1;var man=manual[key],cand=idx.byName[_v53Norm_(s.name)]||[];var status='REVIEW',method='NONE',pid='',matched='',conf=0,note='';if(man){pid=man.ProductID;matched=man.MatchedName;status='APPROVED';method='MANUAL';conf=1;}else if(cand.length===1){pid=cand[0].ProductID;matched=cand[0].Name;status='REVIEW';method='EXACT_NAME';conf=0.9;note='Требуется подтверждение до автоматического использования';}else if(cand.length>1){status='REVIEW';method='AMBIGUOUS';note='Несколько ProductID с одинаковым нормализованным именем';}else{note='ProductID не найден; требуется ручное сопоставление';}
    var found=_v53Rows_(V53.MAP,V53H.MAP).find(function(x){return String(x.SourceType)===s.type&&_v53Norm_(x.SourceName)===_v53Norm_(s.name);});var row=[found?found.MapID:'V53-M-'+Utilities.getUuid().slice(0,8),s.type,s.name,pid,matched,method,conf,status,note,new Date(),_mcV20Actor_(token)||'USER'];if(found){var all=sh.getDataRange().getValues();for(var z=1;z<all.length;z++)if(String(all[z][0])===String(found.MapID)){sh.getRange(z+1,1,1,row.length).setValues([row]);break;}}else sh.appendRow(row);
  });
  _v53Audit_('BUILD','MAPPINGS','', 'OK','Построено/обновлено сопоставлений: '+Object.keys(seen).length,'USER');return v53GetDashboard(token);
}
function v53SetManualMapping(sourceType,sourceName,productId,token){setupV53ProductUnits();try{_requireAuth_(token,'catalog');}catch(e){return _failFrom_(e);}var idx=_v53ProductIndex_();if(!idx.byId[String(productId)])return _fail_('NOT_FOUND','ProductID не найден');var sh=_v53Sh_(V53.MAP,V53H.MAP),rows=sh.getDataRange().getValues(),key=String(sourceType)+'|'+_v53Norm_(sourceName),done=false;for(var i=1;i<rows.length;i++){if(String(rows[i][1])+'|'+_v53Norm_(rows[i][2])===key){sh.getRange(i+1,4,1,8).setValues([[productId,idx.byId[String(productId)].Name,'MANUAL',1,'APPROVED','Ручное сопоставление',new Date(),_mcV20Actor_(token)||'USER']]);done=true;break;}}if(!done)sh.appendRow(['V53-M-'+Utilities.getUuid().slice(0,8),sourceType,sourceName,productId,idx.byId[String(productId)].Name,'MANUAL',1,'APPROVED','Ручное сопоставление',new Date(),_mcV20Actor_(token)||'USER']);_v53Audit_('MANUAL_MAP',sourceType,sourceName,'OK','ProductID='+productId,'USER');return {ok:true,productId:productId};}
function v53ConvertQty(qty,fromUnit,toUnit){var a=_v53Unit_(fromUnit),b=_v53Unit_(toUnit),da=_v53Dim_(a),db=_v53Dim_(b);if(da!==db||da==='UNKNOWN')return {ok:false,error:'Несовместимые единицы',dimensionFrom:da,dimensionTo:db};return {ok:true,qty:_v53Num_(qty)*_v53Factor_(a)/_v53Factor_(b),fromUnit:a,toUnit:b,dimension:da};}
function _v53Num_(x){var n=Number(String(x==null?'':x).replace(',','.'));return isFinite(n)?n:0;}
function v53NormalizeRequirement(name,qty,unit,sourceType,token){var maps=_v53Rows_(V53.MAP,V53H.MAP).filter(function(r){return String(r.SourceType)===String(sourceType||'TTK')&&_v53Norm_(r.SourceName)===_v53Norm_(name);});if(maps.length!==1||String(maps[0].Status)!=='APPROVED')return {ok:false,status:'REVIEW',name:name,qty:_v53Num_(qty),unit:_v53Unit_(unit),reason:'Нет единственного утверждённого ProductID'};var p=_v53ProductIndex_().byId[String(maps[0].ProductID)];return {ok:true,productId:maps[0].ProductID,name:p.Name,qty:_v53Num_(qty),unit:_v53Unit_(unit),dimension:_v53Dim_(unit)};}
function v53GetDashboard(token){setupV53ProductUnits();var p=_v53Rows_(V53.PRODUCTS,V53H.PRODUCTS),m=_v53Rows_(V53.MAP,V53H.MAP);return {ok:true,products:p.slice(-1000),mappings:m.slice(-1000),totals:{products:p.length,approved:m.filter(function(x){return String(x.Status)==='APPROVED';}).length,review:m.filter(function(x){return String(x.Status)==='REVIEW';}).length,unmapped:m.filter(function(x){return !x.ProductID;}).length}};}
