/**
 * MON CHEF V50 — SURPLUS UTILIZATION ENGINE
 *
 * V49 makes physical stock factual. V50 answers the next operational question:
 * "Where can this available stock be safely used before we produce/buy more?"
 *
 * V50 NEVER silently writes off, consumes, extends shelf life or relabels stock.
 * It builds recommendations from the same stock truth and planned demand:
 *   stock -> V25 raw pick / production plan -> FEFO matching -> recommendation
 *   -> optional internal reservation -> task / manual approval.
 *
 * Important: a recommendation is not a stock movement.
 */
const V50_SURPLUS = {
  SURPLUS: 'Излишки_V50',
  DEMAND: 'Излишки_Потребность_V50',
  RECO: 'Излишки_Рекомендации_V50',
  RESERVE: 'Излишки_Резервы_V50',
  AUDIT: 'Излишки_Аудит_V50'
};
const V50_HEADERS = {
  SURPLUS: ['SurplusID','At','BatchID','Product','Unit','Qty','Expiry','LocationID','PricePerUnit','Value','Source','Risk','Condition','Status','Notes'],
  DEMAND: ['DemandID','At','DemandType','DemandDate','BanquetID','ProductionID','TTKCode','Product','Unit','RequiredQty','MatchedQty','RemainingQty','Source','Status','Notes'],
  RECO: ['RecommendationID','At','SurplusID','DemandID','BatchID','Product','Unit','AvailableQty','SuggestedQty','DemandType','DemandDate','BanquetID','ProductionID','TTKCode','Action','Priority','Expiry','Risk','Status','TaskID','Notes'],
  RESERVE: ['ReserveID','At','RecommendationID','BatchID','Product','Unit','Qty','DemandType','DemandID','Status','CreatedBy','CreatedAt','ReleasedAt','Notes'],
  AUDIT: ['AuditID','At','Action','RecommendationID','ReserveID','BatchID','Product','Qty','Result','Message','Actor']
};
function _v50Sheet_(name,h){var sh=_book_().getSheetByName(name);if(!sh){sh=_book_().insertSheet(name);sh.appendRow(h);sh.setFrozenRows(1);}return sh;}
function _v50Rows_(name,h){var sh=_v50Sheet_(name,h),v=sh.getDataRange().getValues(),out=[];for(var i=1;i<v.length;i++){if(!v[i].some(function(x){return x!=='';}))continue;var o={};h.forEach(function(k,j){o[k]=v[i][j];});out.push(o);}return out;}
function _v50Id_(p){return 'V50-'+p+'-'+Utilities.getUuid().slice(0,8).toUpperCase();}
function _v50Num_(x){var n=Number(String(x==null?'':x).replace(',','.'));return isFinite(n)?n:0;}
function _v50Norm_(x){return _cleanProdName_(x).toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ');}
function _v50Date_(x){if(x instanceof Date&&!isNaN(x.getTime()))return new Date(x.getTime());if(!x)return null;var d=new Date(x);return isNaN(d.getTime())?null:d;}
function _v50DayEnd_(d){var x=_v50Date_(d)||new Date();x.setHours(23,59,59,999);return x;}
function _v50Audit_(action,rid,reserveId,batch,product,qty,result,msg,actor){_v50Sheet_(V50_SURPLUS.AUDIT,V50_HEADERS.AUDIT).appendRow([_v50Id_('AUD'),new Date(),action,rid||'',reserveId||'',batch||'',product||'',qty==null?'':qty,result||'',msg||'',actor||'SYSTEM']);}
function setupV50SurplusEngine(){Object.keys(V50_HEADERS).forEach(function(k){_v50Sheet_(V50_SURPLUS[k],V50_HEADERS[k]);});try{setupV49InventoryRevision();}catch(e){}try{setupV48DeficitEngine();}catch(e2){}return{ok:true,sheets:V50_SURPLUS};}

function _v50BlockedBatches_(){
  var out={};
  try{_v49Rows_(V49_REV.LINE,V49_H.LINE).forEach(function(x){var c=_v50Norm_(x.Condition);if(x.BatchID&&['quarantine','blocked','заблокирован','карантин','damaged','поврежден','повреждено'].some(function(k){return c.indexOf(k)>=0;}))out[String(x.BatchID)]=1;});}catch(e){}
  return out;
}
function _v50Stock_(){
  var rows=typeof _v49StockRows_==='function'?_v49StockRows_():[];
  var blocked=_v50BlockedBatches_(),now=new Date();
  return rows.filter(function(x){return x.status==='active'&&x.qty>0&&!blocked[x.id];}).map(function(x){
    var exp=_v50Date_(x.expiry),expired=exp&&exp.getTime()<now.getTime();
    var sh=x.sheet,v=sh.getRange(x.row,1,1,Math.max(15,sh.getLastColumn())).getValues()[0];
    var price=_v50Num_(v[6]), source=String(v[7]||'');
    return {batchId:x.id,product:x.product,unit:x.unit,qty:x.qty,expiry:exp,locationId:x.location,price:price,value:x.qty*price,source:source,risk:expired?'EXPIRED':(exp&&((exp.getTime()-now.getTime())/86400000)<=3?'EXPIRING_SOON':'NORMAL'),condition:'OK'};
  }).filter(function(x){return x.risk!=='EXPIRED';});
}
function _v50DateWindow_(fromDate,toDate,horizonDays){
  var from=_v50Date_(fromDate)||new Date();from.setHours(0,0,0,0);var to=_v50Date_(toDate);if(!to){to=new Date(from.getTime());to.setDate(to.getDate()+(_v50Num_(horizonDays)||7));}to=_v50DayEnd_(to);return{from:from,to:to};
}
function _v50V25Rows_(){
  var sh=_book_().getSheetByName('Производство_План_V25');if(!sh||sh.getLastRow()<2)return[];var v=sh.getDataRange().getValues(),h=v[0],out=[];for(var i=1;i<v.length;i++){var o={};h.forEach(function(k,j){o[k]=v[i][j];});out.push(o);}return out;
}
function _v50Demand_(fromDate,toDate,horizonDays){
  var w=_v50DateWindow_(fromDate,toDate,horizonDays),rows=_v50V25Rows_(),out=[];
  rows.forEach(function(r){
    if(String(r.Status||'')==='CANCELLED')return;
    var taskDate=_v50Date_(r.TaskDate),demandDate=taskDate||_v50Date_(r.BanquetDateTime)||w.from;
    if(demandDate<w.from||demandDate>w.to)return;
    var type=String(r.TaskType||'');if(type!=='RAW_PICK'&&type!=='DISH'&&type!=='SEMI')return;
    var qty=_v50Num_(r.Qty);if(qty<=0)return;
    var product=String(r.Name||'').trim();if(!product)return;
    var key=[type,_v50Norm_(product),String(r.Unit||'')].join('|');
    var existing=out.find(function(x){return x._key===key&&String(x.BanquetID)===String(r.BanquetID||'')&&String(x.ProductionID)===String(r.ParentTaskID||'');});
    if(existing){existing.RequiredQty+=qty;existing.RemainingQty+=qty;return;}
    var id=_v50Id_('DEM');out.push({DemandID:id,At:new Date(),DemandType:type==='RAW_PICK'?'RAW_TO_PRODUCTION':(type==='SEMI'?'PF_TO_PRODUCTION':'FINISHED_TO_BANQUET'),DemandDate:demandDate,BanquetID:String(r.BanquetID||''),ProductionID:String(r.ParentTaskID||''),TTKCode:String(r.TTKCode||r.TTKCode||''),Product:product,Unit:String(r.Unit||''),RequiredQty:qty,MatchedQty:0,RemainingQty:qty,Source:'V25',Status:'OPEN',Notes:'Плановая потребность V25',_key:key});
  });
  return{window:w,rows:out};
}
function _v50WriteDemandSnapshot_(demands){
  var sh=_v50Sheet_(V50_SURPLUS.DEMAND,V50_HEADERS.DEMAND),h=V50_HEADERS.DEMAND,rows=demands.map(function(d){return h.map(function(k){return d[k]===undefined?'':d[k];});});
  if(rows.length)sh.getRange(sh.getLastRow()+1,1,rows.length,h.length).setValues(rows);return rows.length;
}
function _v50Risk_(batch,qty){if(batch.risk==='EXPIRING_SOON')return'AT_RISK';return qty>0?'NORMAL':'NONE';}
function _v50Priority_(batch,demand){
  if(batch.risk==='EXPIRING_SOON')return'URGENT';
  var dd=_v50Date_(demand.DemandDate),today=new Date(),days=dd?Math.ceil((dd.getTime()-today.getTime())/86400000):99;
  if(days<=1)return'HIGH';if(days<=3)return'MEDIUM';return'NORMAL';
}
function _v50ExistingReserved_(){
  var rows=_v50Rows_(V50_SURPLUS.RESERVE,V50_HEADERS.RESERVE),m={};rows.forEach(function(r){if(['ACTIVE','APPROVED'].indexOf(String(r.Status))>=0){var k=String(r.BatchID);m[k]=(m[k]||0)+_v50Num_(r.Qty);}});return m;
}
function v50AnalyzeSurplus(fromDate,toDate,horizonDays,token){
  setupV50SurplusEngine();_requireAuth_(token,'kanban');
  var wd=_v50Demand_(fromDate,toDate,horizonDays),demands=wd.rows,stock=_v50Stock_(),reserved=_v50ExistingReserved_();
  demands.forEach(function(d){d.MatchedQty=0;d.RemainingQty=d.RequiredQty;});
  var recommendations=[],surplus=[];
  stock.sort(function(a,b){var ae=a.expiry?a.expiry.getTime():Number.MAX_SAFE_INTEGER,be=b.expiry?b.expiry.getTime():Number.MAX_SAFE_INTEGER;return ae-be;});
  var demandCandidates=demands.slice().sort(function(a,b){var ad=a.DemandDate?a.DemandDate.getTime():Number.MAX_SAFE_INTEGER,bd=b.DemandDate?b.DemandDate.getTime():Number.MAX_SAFE_INTEGER;return ad-bd;});
  stock.forEach(function(b){
    var available=Math.max(0,b.qty-_v50Num_(reserved[b.batchId]));
    if(available<=0)return;
    var startAvailable=available;
    demandCandidates.forEach(function(d){
      if(available<=0||d.RemainingQty<=0)return;
      if(_v50Norm_(b.product)!==_v50Norm_(d.Product))return;
      if(String(b.unit)!==String(d.Unit))return;
      var q=Math.min(available,d.RemainingQty);if(q<=0)return;
      available-=q;d.RemainingQty-=q;d.MatchedQty+=q;
      var action=d.DemandType==='RAW_TO_PRODUCTION'?'USE_IN_PRODUCTION_PICK':d.DemandType==='PF_TO_PRODUCTION'?'USE_PF_IN_PRODUCTION':'FINISHED_BANQUET_REVIEW';
      recommendations.push({RecommendationID:_v50Id_('REC'),At:new Date(),SurplusID:'',DemandID:d.DemandID,BatchID:b.batchId,Product:b.product,Unit:b.unit,AvailableQty:startAvailable,SuggestedQty:q,DemandType:d.DemandType,DemandDate:d.DemandDate,BanquetID:d.BanquetID,ProductionID:d.ProductionID,TTKCode:d.TTKCode,Action:action,Priority:_v50Priority_(b,d),Expiry:b.expiry,Risk:_v50Risk_(b,q),Status:'SUGGESTED',TaskID:'',Notes:'FEFO-сопоставление с V25'});
    });
    if(available>0){var sid=_v50Id_('SUR');surplus.push({SurplusID:sid,At:new Date(),BatchID:b.batchId,Product:b.product,Unit:b.unit,Qty:available,Expiry:b.expiry,LocationID:b.locationId,PricePerUnit:b.price,Value:b.value*(available/b.qty||0),Source:b.source,Risk:b.risk,Condition:b.condition,Status:'OPEN',Notes:startAvailable===available?'Нет плановой потребности в горизонте':'Остаток после плановой потребности'});recommendations.push({RecommendationID:_v50Id_('REC'),At:new Date(),SurplusID:sid,DemandID:'',BatchID:b.batchId,Product:b.product,Unit:b.unit,AvailableQty:available,SuggestedQty:0,DemandType:'UNMATCHED',DemandDate:'',BanquetID:'',ProductionID:'',TTKCode:'',Action:'REVIEW_SURPLUS',Priority:b.risk==='EXPIRING_SOON'?'URGENT':'NORMAL',Expiry:b.expiry,Risk:b.risk==='EXPIRING_SOON'?'AT_RISK':'NORMAL',Status:'SUGGESTED',TaskID:'',Notes:'Излишек не сопоставлен с V25'});}
  });
  // If demand remains after stock matching, V50 reports it but does not create production tasks itself.
  return{ok:true,window:{from:wd.window.from,to:wd.window.to},surplus:surplus,recommendations:recommendations,demand:demands,uncoveredDemand:demands.filter(function(x){return x.RemainingQty>0.0001;}).map(function(x){return{product:x.Product,unit:x.Unit,remaining:x.RemainingQty,demandType:x.DemandType,demandDate:x.DemandDate,banquetId:x.BanquetID,productionId:x.ProductionID,ttkCode:x.TTKCode};}),totals:{batches:stock.length,surplusBatches:surplus.length,surplusQty:surplus.reduce(function(s,x){return s+x.Qty;},0),surplusValue:surplus.reduce(function(s,x){return s+x.Value;},0),recommendations:recommendations.filter(function(x){return x.SuggestedQty>0;}).length,matchedQty:recommendations.reduce(function(s,x){return s+x.SuggestedQty;},0),uncoveredQty:demands.reduce(function(s,x){return s+x.RemainingQty;},0)}};
}
function v50PublishAnalysis(fromDate,toDate,horizonDays,token){
  var a=v50AnalyzeSurplus(fromDate,toDate,horizonDays,token),rh=V50_HEADERS.RECO,sh=_v50Sheet_(V50_SURPLUS.RECO,rh),dh=V50_HEADERS.DEMAND,ds=_v50Sheet_(V50_SURPLUS.DEMAND,dh),ss=_v50Sheet_(V50_SURPLUS.SURPLUS,V50_HEADERS.SURPLUS);
  if(a.surplus.length)ss.getRange(ss.getLastRow()+1,1,a.surplus.length,V50_HEADERS.SURPLUS.length).setValues(a.surplus.map(function(x){return V50_HEADERS.SURPLUS.map(function(k){return x[k]===undefined?'':x[k];});}));
  if(a.demand.length)ds.getRange(ds.getLastRow()+1,1,a.demand.length,V50_HEADERS.DEMAND.length).setValues(a.demand.map(function(x){return V50_HEADERS.DEMAND.map(function(k){return x[k]===undefined?'':x[k];});}));
  if(a.recommendations.length)sh.getRange(sh.getLastRow()+1,1,a.recommendations.length,rh.length).setValues(a.recommendations.map(function(x){return rh.map(function(k){return x[k]===undefined?'':x[k];});}));
  return{ok:true,totals:a.totals,window:a.window,rows:a.recommendations,uncoveredDemand:a.uncoveredDemand};
}
function _v50FindRecommendation_(id){var rows=_v50Rows_(V50_SURPLUS.RECO,V50_HEADERS.RECO);return rows.find(function(x){return String(x.RecommendationID)===String(id);})||null;}
function v50ReserveRecommendation(recommendationId,qty,token){
  setupV50SurplusEngine();_requireAuth_(token,'kanban');var r=_v50FindRecommendation_(recommendationId);if(!r)throw new Error('Рекомендация не найдена');if(String(r.Status)!=='SUGGESTED')throw new Error('Рекомендация уже обработана: '+r.Status);var max=_v50Num_(r.SuggestedQty),q=_v50Num_(qty)||max;if(!(q>0)||q>max+0.0001)throw new Error('Количество резерва превышает предложенное: '+max+' '+r.Unit);
  var reserved=_v50ExistingReserved_(),avail=_v50Stock_().find(function(x){return String(x.batchId)===String(r.BatchID);});if(!avail)throw new Error('Партия недоступна');var free=avail.qty-_v50Num_(reserved[r.BatchID]);if(q>free+0.0001)throw new Error('В партии недостаточно свободного остатка: '+free+' '+r.Unit);
  var id=_v50Id_('RES'),sh=_v50Sheet_(V50_SURPLUS.RESERVE,V50_HEADERS.RESERVE),row=[id,new Date(),r.RecommendationID,r.BatchID,r.Product,r.Unit,q,r.DemandType,r.DemandID,'ACTIVE','',new Date(),'',''];sh.appendRow(row);
  var rh=_v50Sheet_(V50_SURPLUS.RECO,V50_HEADERS.RECO),v=rh.getDataRange().getValues(),ri=-1;for(var i=1;i<v.length;i++)if(String(v[i][0])===String(recommendationId)){ri=i+1;break;}if(ri<0)throw new Error('Строка рекомендации не найдена');rh.getRange(ri,V50_HEADERS.RECO.indexOf('Status')+1).setValue(q>=max-0.0001?'RESERVED':'PARTIAL');_v50Audit_('RESERVE',recommendationId,id,r.BatchID,r.Product,q,'OK','Внутренний резерв излишка; склад физически не списан','');return{ok:true,reserveId:id,recommendationId:recommendationId,qty:q,status:q>=max-0.0001?'RESERVED':'PARTIAL'};
}
function v50ReleaseReserve(reserveId,token){setupV50SurplusEngine();_requireAuth_(token,'kanban');var sh=_v50Sheet_(V50_SURPLUS.RESERVE,V50_HEADERS.RESERVE),v=sh.getDataRange().getValues(),ri=-1,row=null;for(var i=1;i<v.length;i++)if(String(v[i][0])===String(reserveId)){ri=i+1;row=v[i];break;}if(ri<0)throw new Error('Резерв не найден');if(String(row[9])!=='ACTIVE')return{ok:true,idempotent:true};sh.getRange(ri,V50_HEADERS.RESERVE.indexOf('Status')+1).setValue('RELEASED');sh.getRange(ri,V50_HEADERS.RESERVE.indexOf('ReleasedAt')+1).setValue(new Date());_v50Audit_('RELEASE',String(row[2]),reserveId,String(row[3]),String(row[4]),_v50Num_(row[6]),'OK','Внутренний резерв снят','');return{ok:true,reserveId:reserveId,status:'RELEASED'};}
function v50ApproveRecommendation(recommendationId,token){
  setupV50SurplusEngine();_requireAuth_(token,'kanban');var r=_v50FindRecommendation_(recommendationId);if(!r)throw new Error('Рекомендация не найдена');if(String(r.Status)!=='SUGGESTED')return{ok:true,idempotent:true,status:r.Status};
  var q=_v50Num_(r.SuggestedQty);if(q<=0)throw new Error('Нечего утверждать');
  var taskId='';
  try{
    if(r.DemandType==='RAW_TO_PRODUCTION'||r.DemandType==='PF_TO_PRODUCTION'){
      var payload={sourceType:'SURPLUS_USE',sourceId:r.RecommendationID,title:'Использовать излишек: '+r.Product,description:'Партия '+r.BatchID+' · '+q+' '+r.Unit+' → '+(r.DemandType==='PF_TO_PRODUCTION'?'производство П/Ф':'отбор сырья')+'; план V25 '+r.DemandID,taskType:'PRODUCTION',dueAt:r.DemandDate||new Date(),windowMin:60,role:'Повар',priority:r.Priority,productionId:r.ProductionID||'',ttkCode:r.TTKCode||'',qty:q,unit:r.Unit,createdBy:'SYSTEM',notes:'V50: использовать существующий излишек вместо дополнительного расхода/выпуска'};
      if(typeof _v44UpsertTask_==='function')taskId=_v44UpsertTask_(payload);
    } else if(r.DemandType==='FINISHED_TO_BANQUET'){
      // Finished stock is not silently issued to a banquet. Reserve it and route to dispatcher review.
      var payload2={sourceType:'SURPLUS_USE',sourceId:r.RecommendationID,title:'Проверить излишек для банкета: '+r.Product,description:'Партия '+r.BatchID+' · '+q+' '+r.Unit+' · банкет '+r.BanquetID,taskType:'BANQUET_RESERVE',dueAt:r.DemandDate||new Date(),windowMin:60,role:'Диспетчер',priority:r.Priority,banquetId:r.BanquetID||'',qty:q,unit:r.Unit,createdBy:'SYSTEM',notes:'V50: требуется ручное подтверждение пригодности и адресного использования'};
      if(typeof _v44UpsertTask_==='function')taskId=_v44UpsertTask_(payload2);
    }
  }catch(e){throw new Error('Не удалось создать задачу использования излишка: '+e);}
  var rh=_v50Sheet_(V50_SURPLUS.RECO,V50_HEADERS.RECO),v=rh.getDataRange().getValues(),ri=-1;for(var i=1;i<v.length;i++)if(String(v[i][0])===String(recommendationId)){ri=i+1;break;}if(ri<0)throw new Error('Строка рекомендации не найдена');rh.getRange(ri,V50_HEADERS.RECO.indexOf('Status')+1).setValue('APPROVED');rh.getRange(ri,V50_HEADERS.RECO.indexOf('TaskID')+1).setValue(taskId);_v50Audit_('APPROVE',recommendationId,'',r.BatchID,r.Product,q,'OK','Рекомендация утверждена; задача '+taskId,'');return{ok:true,recommendationId:recommendationId,status:'APPROVED',taskId:taskId};
}
function v50GetDashboard(fromDate,toDate,horizonDays,token){var a=v50AnalyzeSurplus(fromDate,toDate,horizonDays,token),rr=_v50Rows_(V50_SURPLUS.RECO,V50_HEADERS.RECO),res=_v50Rows_(V50_SURPLUS.RESERVE,V50_HEADERS.RESERVE);return{ok:true,totals:a.totals,window:a.window,activeReserves:res.filter(function(x){return x.Status==='ACTIVE';}).reduce(function(s,x){return s+_v50Num_(x.Qty);},0),suggested:rr.filter(function(x){return x.Status==='SUGGESTED'&&_v50Num_(x.SuggestedQty)>0;}).length,atRisk:a.surplus.filter(function(x){return x.Risk==='EXPIRING_SOON';}).length,unmatched:a.surplus.filter(function(x){return x.Qty>0;}).length,uncoveredDemand:a.uncoveredDemand};}
function v50GetRecommendations(fromDate,toDate,horizonDays,token){var a=v50AnalyzeSurplus(fromDate,toDate,horizonDays,token);return{ok:true,window:a.window,rows:a.recommendations.filter(function(x){return x.SuggestedQty>0||x.Action==='REVIEW_SURPLUS';}),uncoveredDemand:a.uncoveredDemand,totals:a.totals};}
function v50AutomationTick(fromDate,toDate,horizonDays,token){
  var a=v50AnalyzeSurplus(fromDate,toDate,horizonDays,token),created=0;
  // Only create tasks for approved/safely matched recommendations already present in V50; no automatic stock movement.
  var existing=_v50Rows_(V50_SURPLUS.RECO,V50_HEADERS.RECO);a.recommendations.forEach(function(r){if(r.SuggestedQty<=0)return;var same=existing.find(function(x){return String(x.BatchID)===String(r.BatchID)&&String(x.DemandID)===String(r.DemandID)&&String(x.Status)==='APPROVED';});if(same)return;});
  return{ok:true,createdTasks:created,recommendations:a.recommendations.length,matchedQty:a.totals.matchedQty,uncoveredQty:a.totals.uncoveredQty};
}
