/**
 * MON CHEF V52 — TTK DEFICIT RECALCULATION
 *
 * V52 turns a banquet deficit into an executable backward TTK resource plan.
 * It is planning-only until a user approves a plan. It never writes stock off.
 *
 * Flow:
 * V48 deficit -> TTK explosion (V24) -> existing PF/RAW availability -> residual
 * production -> residual purchasing signal.
 */
const V52_DEF = {
  PLAN: 'Дефициты_ТТК_План_V52',
  NODE: 'Дефициты_ТТК_Узлы_V52',
  AUDIT: 'Дефициты_ТТК_Аудит_V52'
};
const V52_HEADERS = {
  PLAN: ['PlanID','At','GapID','BanquetID','ProductionID','Product','TTKCode','RequestedQty','PFStockCoverage','RawStockCoverage','ResidualProduction','ResidualRawNeed','Status','TaskID','ApprovedAt','ApprovedBy','Notes'],
  NODE: ['NodeID','PlanID','Level','NodeType','TTKCode','Product','RequiredQty','Unit','AvailableStock','CoveredQty','ToProduce','ToBuy','ParentCode','ProductionDate','Status'],
  AUDIT: ['AuditID','At','Action','PlanID','GapID','Result','Message','Actor']
};
function _v52Sheet_(name,h){var ss=_book_(),sh=ss.getSheetByName(name);if(!sh){sh=ss.insertSheet(name);sh.appendRow(h);sh.setFrozenRows(1);}return sh;}
function _v52Rows_(name,h){var sh=_v52Sheet_(name,h),v=sh.getDataRange().getValues(),out=[];for(var i=1;i<v.length;i++){if(!v[i].some(function(x){return x!=='';}))continue;var o={};h.forEach(function(k,j){o[k]=v[i][j];});out.push(o);}return out;}
function _v52Id_(p){return 'V52-'+p+'-'+Utilities.getUuid().slice(0,8).toUpperCase();}
function _v52Num_(x){var n=Number(String(x==null?'':x).replace(',','.'));return isFinite(n)?n:0;}
function _v52Norm_(x){return String(x||'').trim().toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ');}
function _v52Audit_(action,plan,gap,result,msg,actor){_v52Sheet_(V52_DEF.AUDIT,V52_HEADERS.AUDIT).appendRow([_v52Id_('AUD'),new Date(),action,plan||'',gap||'',result||'',msg||'',actor||'SYSTEM']);}
function setupV52TtkDeficitRecalc(){Object.keys(V52_HEADERS).forEach(function(k){_v52Sheet_(V52_DEF[k],V52_HEADERS[k]);});try{setupV51DeficitSurplusBridge();}catch(e){}return{ok:true,sheets:V52_DEF};}

function _v52RawStockMap_(){
  var m={};
  try{
    var rows=typeof getStockBatches==='function'?getStockBatches(true):[];
    if(rows&&rows.rows)rows=rows.rows;
    (rows||[]).forEach(function(r){
      var name=r.product||r.Product||r['Продукт']||r.name||r.Name||'';
      var unit=r.unit||r.Unit||r['Ед.изм']||'';
      var qty=_v52Num_(r.remaining!=null?r.remaining:(r['Остаток']!=null?r['Остаток']:r.qty));
      if(qty<=0)return;
      var k=_v52Norm_(name)+'|'+String(unit);
      m[k]=(m[k]||0)+qty;
    });
  }catch(e){}
  return m;
}
function _v52DemandKey_(name,unit){return _v52Norm_(name)+'|'+String(unit||'');}

function _v52BuildPlanForGap_(g,fromDate,toDate,token){
  var q=_v52Num_(g.deficitQty); if(q<=0)return null;
  if(typeof getTTKProductionTree!=='function')throw new Error('V24 TTK engine недоступен');
  var tree=_mcV22Parse_(getTTKProductionTree(g.ttkCode,q,token)); if(!tree||tree.ok===false||tree.success===false)throw new Error((tree&&tree.error&&tree.error.message)||'Не удалось разложить ТТК');
  var data=tree.data||tree, rawStock=_v52RawStockMap_(), nodes=[], pfCovered=0, rawCovered=0, residualProduction=0, residualRaw=0;
  (data.dependencies||[]).forEach(function(n){
    var required=_v52Num_(n.required||n.RequiredQty), available=_v52Num_(n.stockAvailable), toProduce=_v52Num_(n.toProduce);
    var covered=Math.max(0,required-toProduce), type=String(n.taskType||'SEMI')==='SEMI'?'PF':'RAW';
    if(type==='PF'){pfCovered+=covered;residualProduction+=toProduce;}
    nodes.push({level:n.level||0,nodeType:type,ttkCode:n.code||'',product:n.name||'',requiredQty:required,unit:n.unit||'',availableStock:available,coveredQty:covered,toProduce:toProduce,toBuy:0,parentCode:n.parentCode||'',productionDate:g.banquetDate||'',status:'PLAN'});
  });
  // V24 already consumes known PF stock. For raw material we additionally compare
  // the aggregated raw requirement with actual stock; this does not mutate it.
  (data.raw||[]).forEach(function(r){
    var req=_v52Num_(r.qty), key=_v52DemandKey_(r.name,r.unit), avail=_v52Num_(rawStock[key]), cov=Math.min(req,avail), buy=Math.max(0,req-cov);
    rawCovered+=cov; residualRaw+=buy;
    nodes.push({level:999,nodeType:'RAW',ttkCode:'',product:r.name||'',requiredQty:req,unit:r.unit||'',availableStock:avail,coveredQty:cov,toProduce:0,toBuy:buy,parentCode:'',productionDate:g.banquetDate||'',status:buy>0?'BUY_REQUIRED':'STOCK_COVERED'});
  });
  var residualRoot=Math.max(0,q-Math.min(q,pfCovered));
  return {planId:_v52Id_('PLAN'),gap:g,requested:q,pfCovered:Math.min(q,pfCovered),rawCovered:rawCovered,residualProduction:residualRoot,residualRawNeed:residualRaw,nodes:nodes};
}

function v52RecalculateDeficits(fromDate,toDate,token){
  setupV52TtkDeficitRecalc();
  var gaps=(v48AnalyzeDeficits(fromDate,toDate,token).rows||[]), plans=[];
  gaps.forEach(function(g){
    try{plans.push(_v52BuildPlanForGap_(g,fromDate,toDate,token));}
    catch(e){plans.push({planId:_v52Id_('ERR'),gap:g,error:e.message,requested:_v52Num_(g.deficitQty),pfCovered:0,rawCovered:0,residualProduction:_v52Num_(g.deficitQty),residualRawNeed:0,nodes:[]});}
  });
  return {ok:true,plans:plans,totals:{plans:plans.length,residualProduction:plans.reduce(function(s,p){return s+_v52Num_(p.residualProduction);},0),rawNeed:plans.reduce(function(s,p){return s+_v52Num_(p.residualRawNeed);},0)}};
}

function v52PublishPlans(fromDate,toDate,token){
  var a=v52RecalculateDeficits(fromDate,toDate,token),psh=_v52Sheet_(V52_DEF.PLAN,V52_HEADERS.PLAN),nsh=_v52Sheet_(V52_DEF.NODE,V52_HEADERS.NODE);
  a.plans.forEach(function(p){
    var g=p.gap;
    psh.appendRow([p.planId,new Date(),g?g.gapId:'',g?g.banquetId:'',g?g.productionId:'',g?g.productName:'',g?g.ttkCode:'',p.requested,p.pfCovered,p.rawCovered,p.residualProduction,p.residualRawNeed,p.error?'ERROR':'DRAFT','', '', '',p.error||'TTK перерасчёт без списания склада']);
    (p.nodes||[]).forEach(function(n){nsh.appendRow([_v52Id_('NODE'),p.planId,n.level,n.nodeType,n.ttkCode,n.product,n.requiredQty,n.unit,n.availableStock,n.coveredQty,n.toProduce,n.toBuy,n.parentCode,n.productionDate,n.status]);});
    _v52Audit_('PUBLISH',p.planId,g?g.gapId:'',p.error?'ERROR':'OK',p.error||'План ТТК опубликован','SYSTEM');
  });
  return {ok:true,plans:a.plans,totals:a.totals};
}

function _v52FindPlan_(planId){return _v52Rows_(V52_DEF.PLAN,V52_HEADERS.PLAN).find(function(x){return String(x.PlanID)===String(planId);});}
function v52ApprovePlan(planId,token){
  setupV52TtkDeficitRecalc();
  _requireAuth_(token,'kanban');
  var p=_v52FindPlan_(planId);if(!p)return _fail_('NOT_FOUND','План V52 не найден');
  if(String(p.Status)!=='DRAFT')return _fail_('STATE','Утверждать можно только DRAFT');
  var nodes=_v52Rows_(V52_DEF.NODE,V52_HEADERS.NODE).filter(function(x){return String(x.PlanID)===String(planId);});
  var taskId='';
  var residual=_v52Num_(p.ResidualProduction);
  if(residual>0 && typeof _v44UpsertTask_==='function'){
    taskId=_v44UpsertTask_({sourceType:'TTK_DEFICIT_RECALC',sourceId:planId,title:'Довыпустить по ТТК: '+p.Product,description:'V52: после использования доступных П/Ф остаточная потребность '+residual+' '+(nodes[0]&&nodes[0].Unit||''),taskType:'PRODUCTION',dueAt:p.BanquetID?new Date():new Date(Date.now()+3600000),windowMin:60,role:'Повар',priority:'HIGH',banquetId:p.BanquetID||'',productionId:p.ProductionID||'',ttkCode:p.TTKCode||'',qty:residual,unit:nodes[0]&&nodes[0].Unit||'',createdBy:'SYSTEM',notes:'V52 утвержденный перерасчёт; склад не списан'});
  }
  var sh=_v52Sheet_(V52_DEF.PLAN,V52_HEADERS.PLAN),vals=sh.getDataRange().getValues();
  for(var i=1;i<vals.length;i++)if(String(vals[i][0])===String(planId)){sh.getRange(i+1,13,1,4).setValues([['APPROVED',taskId,new Date(),_mcV20Actor_(token)||'USER']]);break;}
  _v52Audit_('APPROVE',planId,p.GapID,'OK','План утверждён; создана задача только на остаточный выпуск '+residual,'USER');
  return {ok:true,planId:planId,status:'APPROVED',taskId:taskId,residualProduction:residual,rawNeed:_v52Num_(p.ResidualRawNeed)};
}
function v52GetDashboard(fromDate,toDate,token){var a=v52RecalculateDeficits(fromDate,toDate,token),pub=_v52Rows_(V52_DEF.PLAN,V52_HEADERS.PLAN);return{ok:true,plans:a.plans,totals:a.totals,published:pub.slice(-100)};}
