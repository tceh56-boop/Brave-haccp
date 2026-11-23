/**
 * MON CHEF V51 — DEFICIT ↔ SURPLUS BRIDGE
 *
 * V51 is the orchestration layer between V48 and V50.
 * It does NOT create a second stock ledger and does NOT silently consume stock.
 *
 * Flow:
 *   V48 deficit
 *      -> search V50 finished-stock surplus for the same banquet/product/unit
 *      -> reserve the matching batch (planning reservation only)
 *      -> create a V44 dispatch task
 *      -> only the uncovered remainder becomes a production corrective task
 *
 * This prevents the classic error: "there is a banquet deficit, therefore produce more"
 * when a suitable finished product already exists in stock.
 */
const V51_BRIDGE = {
  COVER: 'Дефициты_Покрытие_V51',
  AUDIT: 'Дефициты_Покрытие_Аудит_V51'
};
const V51_HEADERS = {
  COVER: ['CoverageID','At','GapID','BanquetID','ProductionID','Product','Unit','DeficitQty','CoveredQty','RemainingQty','BatchID','RecommendationID','ReserveID','DemandID','Status','TaskID','Priority','Notes'],
  AUDIT: ['AuditID','At','Action','CoverageID','GapID','BatchID','ReserveID','TaskID','Qty','Result','Message']
};
function _v51Sheet_(name,h){var ss=_book_(),sh=ss.getSheetByName(name);if(!sh){sh=ss.insertSheet(name);sh.appendRow(h);sh.setFrozenRows(1);}return sh;}
function _v51Rows_(name,h){var sh=_v51Sheet_(name,h),v=sh.getDataRange().getValues(),out=[];for(var i=1;i<v.length;i++){if(!v[i].some(function(x){return x!=='';}))continue;var o={};h.forEach(function(k,j){o[k]=v[i][j];});out.push(o);}return out;}
function _v51Id_(p){return 'V51-'+p+'-'+Utilities.getUuid().slice(0,8).toUpperCase();}
function _v51Num_(x){var n=Number(String(x==null?'':x).replace(',','.'));return isFinite(n)?n:0;}
function _v51Norm_(x){return _cleanProdName_(x).toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ');}
function _v51Audit_(action,c,g,batch,reserve,task,qty,result,msg){_v51Sheet_(V51_BRIDGE.AUDIT,V51_HEADERS.AUDIT).appendRow([_v51Id_('AUD'),new Date(),action,c||'',g||'',batch||'',reserve||'',task||'',qty==null?'':qty,result||'',msg||'']);}
function setupV51DeficitSurplusBridge(){Object.keys(V51_HEADERS).forEach(function(k){_v51Sheet_(V51_BRIDGE[k],V51_HEADERS[k]);});try{setupV50SurplusEngine();}catch(e){}try{setupV48DeficitEngine();}catch(e2){}try{setupV44TaskCenter();}catch(e3){}return{ok:true,sheets:V51_BRIDGE};}

/** Банкеты спроса и дефицита пересекаются (в обоих может быть список ID через запятую — общее задание). */
function _v51SameBanquets_(a,b){var x=String(a||'').split(',').map(function(t){return t.trim();}).filter(Boolean),y=String(b||'').split(',').map(function(t){return t.trim();}).filter(Boolean);return y.some(function(t){return x.indexOf(t)>=0;});}
function _v51CandidateRecommendations_(gap,fromDate,toDate,token){
  if(typeof v50GetRecommendations!=='function')return[];
  var horizon=14, a=v50GetRecommendations(fromDate,toDate,horizon,token), rows=a.rows||[];
  var product=_v51Norm_(gap.productName), unit=String(gap.unit||'');
  var cand=rows.filter(function(r){
    // готовое блюдо, п/ф или сырьё под этот банкет (задание расписания может обслуживать несколько банкетов)
    return ['FINISHED_TO_BANQUET','PF_TO_PRODUCTION','RAW_TO_PRODUCTION'].indexOf(String(r.DemandType))>=0 &&
      _v51SameBanquets_(r.BanquetID,gap.banquetId) &&
      _v51Norm_(r.Product)===product &&
      (!unit||String(r.Unit||'')===unit||_toBaseUnitServer_(1,String(r.Unit||'г')).unit===_toBaseUnitServer_(1,unit).unit) &&
      _v51Num_(r.SuggestedQty)>0 &&
      ['SUGGESTED'].indexOf(String(r.Status))>=0;
  }).sort(function(a,b){
    var ad=a.DemandDate?new Date(a.DemandDate).getTime():Number.MAX_SAFE_INTEGER;
    var bd=b.DemandDate?new Date(b.DemandDate).getTime():Number.MAX_SAFE_INTEGER;
    return ad-bd;
  });
  // рекомендации анализа излишков не сохранялись — резерв по ним падал «Рекомендация не найдена».
  // Сохраняем выбранные кандидаты, чтобы резерв шёл по записанной рекомендации.
  try{var rh=_v50Sheet_(V50_SURPLUS.RECO,V50_HEADERS.RECO),have={};_v50Rows_(V50_SURPLUS.RECO,V50_HEADERS.RECO).forEach(function(x){have[String(x.RecommendationID)]=1;});
    cand.forEach(function(r){if(!have[String(r.RecommendationID)])rh.appendRow(V50_HEADERS.RECO.map(function(k){return r[k]===undefined?'':r[k];}));});}catch(ePersist){}
  return cand;
}

function v51FindCoverage(gap,fromDate,toDate,token){
  gap = gap || {};
  if (!gap.productName) return { ok: false, error: { code: 'VALIDATION', message: 'Не указан продукт дефицита' } };
  setupV51DeficitSurplusBridge();
  var recs=_v51CandidateRecommendations_(gap,fromDate,toDate,token),need=_v51Num_(gap.deficitQty),out=[];
  recs.forEach(function(r){if(need<=0)return;var q=Math.min(need,_v51Num_(r.SuggestedQty));if(q>0){out.push({recommendationId:r.RecommendationID,batchId:r.BatchID,demandId:r.DemandID,product:r.Product,unit:r.Unit,qty:q,priority:r.Priority,expiry:r.Expiry});need-=q;}});
  return{ok:true,requested:_v51Num_(gap.deficitQty),covered:_v51Num_(gap.deficitQty)-need,remaining:need,candidates:out};
}

function _v51ExistingCoverage_(gapId){return _v51Rows_(V51_BRIDGE.COVER,V51_HEADERS.COVER).filter(function(x){return String(x.GapID)===String(gapId)&&['RESERVED','TASK_CREATED','DONE'].indexOf(String(x.Status))>=0;});}

function _v51CreateIssueTask_(gap,c,token){
  var taskId='';
  var payload={sourceType:'SURPLUS_DEFICIT_BRIDGE',sourceId:c.coverageId,title:'Выдать излишек на банкет: '+gap.productName,description:'Банкет '+gap.banquetId+' · партия '+c.batchId+' · '+c.qty+' '+gap.unit+'; покрывает дефицит V48 '+gap.gapId,taskType:'BANQUET_ISSUE',dueAt:gap.banquetDate||new Date(),windowMin:60,role:'Диспетчер',priority:c.priority||gap.severity||'HIGH',banquetId:gap.banquetId||'',productionId:gap.productionId||'',ttkCode:gap.ttkCode||'',qty:c.qty,unit:gap.unit||'',createdBy:'SYSTEM',notes:'V51: сначала использовать уже имеющийся готовый излишек; склад автоматически не списывается'};
  if(typeof _v44UpsertTask_==='function')taskId=_v44UpsertTask_(payload);
  else throw new Error('V44 Task Center недоступен');
  return taskId;
}

function v51CoverDeficit(gap,fromDate,toDate,token){
  setupV51DeficitSurplusBridge();
  gap=gap||{};var coverage=v51FindCoverage(gap,fromDate,toDate,token),created=[],remaining=_v51Num_(gap.deficitQty);
  if(!coverage||coverage.ok===false||!coverage.candidates)return coverage;
  coverage.candidates.forEach(function(c){
    if(remaining<=0)return;
    var q=Math.min(remaining,c.qty);if(!(q>0))return;
    var reserve=v50ReserveRecommendation(c.recommendationId,q,token);
    var coverageId=_v51Id_('COV');
    var item={coverageId:coverageId,gapId:gap.gapId,banquetId:gap.banquetId,productionId:gap.productionId,product:gap.productName,unit:gap.unit,deficitQty:gap.deficitQty,coveredQty:q,remainingQty:Math.max(0,_v51Num_(gap.deficitQty)-q),batchId:c.batchId,recommendationId:c.recommendationId,reserveId:reserve.reserveId,demandId:c.demandId,status:'RESERVED',taskId:'',priority:c.priority||gap.severity,notes:'V50 резерв; фактическая выдача выполняется отдельной операцией'};
    try{item.taskId=_v51CreateIssueTask_(gap,item,token);item.status='TASK_CREATED';}catch(e){item.status='RESERVED';item.notes+='; задача не создана: '+e.message;}
    _v51Sheet_(V51_BRIDGE.COVER,V51_HEADERS.COVER).appendRow([coverageId,new Date(),gap.gapId,gap.banquetId,gap.productionId,gap.productName,gap.unit,gap.deficitQty,q,Math.max(0,_v51Num_(gap.deficitQty)-q),c.batchId,c.recommendationId,reserve.reserveId,c.demandId,item.status,item.taskId,c.priority,item.notes]);
    _v51Audit_('COVER',coverageId,gap.gapId,c.batchId,reserve.reserveId,item.taskId,q,'OK','Дефицит частично покрыт существующим готовым излишком');
    created.push(item);remaining-=q;
  });
  return{ok:true,gapId:gap.gapId,requested:_v51Num_(gap.deficitQty),covered:_v51Num_(gap.deficitQty)-remaining,remaining:remaining,coverage:created};
}

function _v51CoveredAlready_(gap){return _v51ExistingCoverage_(gap.gapId).reduce(function(s,x){return s+_v51Num_(x.CoveredQty);},0);}

function v51BuildDispatchPlan(fromDate,toDate,token){
  setupV51DeficitSurplusBridge();
  var deficits=v48AnalyzeDeficits(fromDate,toDate,token).rows||[],plan=[];
  deficits.forEach(function(g){
    var already=_v51CoveredAlready_(g),effective=Math.max(0,_v51Num_(g.deficitQty)-already);
    var cov=v51FindCoverage(Object.assign({},g,{deficitQty:effective}),fromDate,toDate,token);
    plan.push({gapId:g.gapId,banquetId:g.banquetId,productionId:g.productionId,product:g.productName,unit:g.unit,originalDeficit:g.deficitQty,alreadyCovered:already,availableSurplus:cov.covered,remainingAfterSurplus:Math.max(0,effective-cov.covered),reasonCode:g.reasonCode,reasonText:g.reasonText,severity:g.severity,candidates:cov.candidates});
  });
  return{ok:true,rows:plan,totals:{deficits:plan.length,covered:plan.reduce(function(s,x){return s+x.alreadyCovered+x.availableSurplus;},0),remaining:plan.reduce(function(s,x){return s+x.remainingAfterSurplus;},0)}};
}

function v51AutomationTick(fromDate,toDate,token){
  setupV51DeficitSurplusBridge();
  var a=v48AnalyzeDeficits(fromDate,toDate,token),covered=0,remaining=0,createdTasks=0,errors=[];
  (a.rows||[]).forEach(function(g){
    try{
      var already=_v51CoveredAlready_(g);
      var need=Math.max(0,_v51Num_(g.deficitQty)-already);
      if(need>0){
        var r=v51CoverDeficit(Object.assign({},g,{deficitQty:need}),fromDate,toDate,token);
        covered+=r.covered;need=r.remaining;createdTasks+=(r.coverage||[]).filter(function(x){return !!x.taskId;}).length;
      }
      remaining+=need;
    }catch(e){errors.push({gapId:g.gapId,message:e.message});remaining+=_v51Num_(g.deficitQty);}
  });
  return{ok:errors.length===0,deficits:a.rows.length,coveredQty:covered,remainingDeficit:remaining,createdIssueTasks:createdTasks,errors:errors};
}

function v51GetDashboard(fromDate,toDate,token){var p=v51BuildDispatchPlan(fromDate,toDate,token),c=_v51Rows_(V51_BRIDGE.COVER,V51_HEADERS.COVER);return{ok:true,plan:p.rows,totals:p.totals,reservedQty:c.filter(function(x){return ['RESERVED','TASK_CREATED'].indexOf(String(x.Status))>=0;}).reduce(function(s,x){return s+_v51Num_(x.CoveredQty);},0),coverageRows:c.length};}
