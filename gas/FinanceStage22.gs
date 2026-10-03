/**
 * ЦЕХ — Stage 22: Budget / Commitments / Cash Flow / Plan-Fact.
 * Управленческий контур. Не является регламентированным бухгалтерским учетом.
 * Фактическое движение денег вводится явно; обязательства строятся из открытых закупочных заявок.
 */
function _f22Date_(v){return String(v||'').slice(0,10);}
function _f22Period_(d,from,to){d=_f22Date_(d);return (!from||d>=from)&&(!to||d<=to);}
function _f22Scope_(r,s){return r&&r.organization_id===s.organization_id&&(!r.location_id||r.location_id===s.location_id);}
function _f22Money_(v){var n=Number(v)||0;return round2_(n);}

function createBudgetPlan_(data,session){
  return withLock_(function(){
    var from=_f22Date_(data.dateFrom),to=_f22Date_(data.dateTo),category=String(data.category||'').trim();
    var amount=Number(data.amount); var direction=String(data.direction||'OUTFLOW').toUpperCase(); if(!from||!to||to<from) throw new Error('Некорректный период бюджета.');
    if(['INFLOW','OUTFLOW'].indexOf(direction)<0) throw new Error('Недопустимое направление бюджета.');
    if(!category||!(amount>=0)) throw new Error('Нужны категория и неотрицательная сумма.');
    var loc=data.locationId||session.location_id||'';
    if(loc) assertLocationAllowed_(session,loc,'LOCATIONS:'+loc);
    var row={budget_id:generateId_('BUDGET_PLANS'),organization_id:session.organization_id,location_id:loc,category:category,direction:direction,amount:_f22Money_(amount),date_from:from,date_to:to,status:'ACTIVE',created_by:session.user_id,created_at:nowIso_()};
    insertRow_('BUDGET_PLANS',row);
    auditLog_(session.user_id,'Создан бюджет','BUDGET_PLANS:'+row.budget_id,'',JSON.stringify(row),'success',session.cascade_id||'');
    return row;
  });
}
function getBudgetPlans_(data,session){
  var from=data.dateFrom,to=data.dateTo,loc=data.locationId||session.location_id||'';
  if(loc) assertLocationAllowed_(session,loc,'LOCATIONS:'+loc);
  return findRows_('BUDGET_PLANS',function(r){return _f22Scope_(r,session)&&(!loc||!r.location_id||r.location_id===loc)&&(!from||r.date_to>=from)&&(!to||r.date_from<=to);}).sort(function(a,b){return String(a.date_from).localeCompare(String(b.date_from));});
}
function recordCashTransaction_(data,session){
  return withLock_(function(){
    var amount=Number(data.amount); if(!(amount>0)) throw new Error('Сумма должна быть положительной.');
    var type=String(data.type||'').toUpperCase(); if(['INFLOW','OUTFLOW'].indexOf(type)<0) throw new Error('Недопустимый тип движения денег.');
    var date=_f22Date_(data.date||todayDateStr_()); if(!date) throw new Error('Не указана дата.');
    var loc=data.locationId||session.location_id||''; if(loc) assertLocationAllowed_(session,loc,'LOCATIONS:'+loc);
    var row={cash_id:generateId_('CASH_TRANSACTIONS'),organization_id:session.organization_id,location_id:loc,date:date,type:type,category:String(data.category||'Прочее'),amount:_f22Money_(amount),description:String(data.description||''),status:'POSTED',created_by:session.user_id,created_at:nowIso_(),cascade_id:session.cascade_id||''};
    insertRow_('CASH_TRANSACTIONS',row); auditLog_(session.user_id,'Движение денежных средств','CASH_TRANSACTIONS:'+row.cash_id,'',JSON.stringify(row),'success',session.cascade_id||''); return row;
  });
}
function getCashFlow_(data,session){
  var from=_f22Date_(data.dateFrom),to=_f22Date_(data.dateTo),loc=data.locationId||session.location_id||'';
  if(loc) assertLocationAllowed_(session,loc,'LOCATIONS:'+loc);
  var rows=findRows_('CASH_TRANSACTIONS',function(r){return _f22Scope_(r,session)&&(!loc||!r.location_id||r.location_id===loc)&&_f22Period_(r.date,from,to);});
  var inflow=0,outflow=0,by={}; rows.forEach(function(r){var a=Number(r.amount)||0;if(r.type==='INFLOW')inflow+=a;else outflow+=a;var k=r.category||'Прочее';by[k]=(by[k]||0)+(r.type==='INFLOW'?a:-a);});
  var commitments=getPurchaseRequests_(loc).filter(function(r){return ['закрыта','отменена'].indexOf(r.статус)<0;}).reduce(function(s,r){var p=getProductById_(r.product_id)||{};return s+(Number(r.количество)||0)*(Number(p.текущая_цена||p.закупочная_цена)||0);},0);
  return {period:{from:from||'',to:to||''},inflow:_f22Money_(inflow),outflow:_f22Money_(outflow),net:_f22Money_(inflow-outflow),commitments:_f22Money_(commitments),available_after_commitments:_f22Money_(inflow-outflow-commitments),by_category:Object.keys(by).map(function(k){return {category:k,net:_f22Money_(by[k])};}),transactions:rows};
}
function getPlanFact_(data,session){
  var from=_f22Date_(data.dateFrom),to=_f22Date_(data.dateTo),loc=data.locationId||session.location_id||'';
  var budgets=getBudgetPlans_({dateFrom:from,dateTo:to,locationId:loc},session);
  var cash=getCashFlow_({dateFrom:from,dateTo:to,locationId:loc},session);
  var actual={};cash.transactions.forEach(function(r){actual[r.category]=(actual[r.category]||0)+(r.type==='INFLOW'?1:-1)*(Number(r.amount)||0);});
  var rows=budgets.map(function(b){var raw=Number(actual[b.category]||0);var fact=b.direction==='OUTFLOW'?Math.abs(raw):Math.max(0,raw);return {category:b.category,direction:b.direction,plan:_f22Money_(b.amount),fact:_f22Money_(fact),variance:_f22Money_(fact-b.amount),variance_pct:b.amount?_f22Money_((fact-b.amount)/b.amount*100):0};});
  return {period:{from:from||'',to:to||''},rows:rows,total_plan:_f22Money_(rows.reduce(function(s,r){return s+r.plan;},0)),total_fact:_f22Money_(rows.reduce(function(s,r){return s+r.fact;},0)),cash_net:cash.net,commitments:cash.commitments};
}
function getCashForecast_(data,session){
  var days=Math.max(1,Math.min(90,Number(data.days)||30)),from=_f22Date_(data.dateFrom||todayDateStr_());
  var d=new Date(from+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days-1);var to=d.toISOString().slice(0,10);
  var histFrom=new Date(from+'T00:00:00Z');histFrom.setUTCDate(histFrom.getUTCDate()-29);var hf=histFrom.toISOString().slice(0,10);
  var hist=getCashFlow_({dateFrom:hf,dateTo:from,locationId:data.locationId||session.location_id},session);
  var dailyNet=hist.net/30;var commitments=hist.commitments;var forecastNet=dailyNet*days-commitments;
  return {from:from,to:to,days:days,historical_30d_net:hist.net,average_daily_net:_f22Money_(dailyNet),open_commitments:_f22Money_(commitments),forecast_net:_f22Money_(forecastNet),cash_gap_risk:forecastNet<0,method:'Экстраполяция среднего чистого денежного потока за последние 30 дней; закупочные обязательства вычитаются отдельно. Не является банковским прогнозом.'};
}
function financeStage22Trigger_(){
  try{getOrganizations_(null).forEach(function(org){try{var locs=getLocations_(org.organization_id)||[];locs.forEach(function(loc){var s={user_id:'system',organization_id:org.organization_id,location_id:loc.location_id,'роль':'ADMIN',allowed_locations:[loc.location_id],cascade_id:'',operation_id:''};var f=getCashForecast_({days:30,locationId:loc.location_id},s);if(f.cash_gap_risk){notify_(org.organization_id,loc.location_id,'cash_flow_risk','Прогнозируемый кассовый риск: чистый поток '+f.forecast_net+'; открытые обязательства '+f.open_commitments+'.','cash_flow_risk|'+loc.location_id+'|'+f.to);}});}catch(e){logSystemError_('financeStage22Trigger_',org.organization_id,'finance_forecast',e);}});}catch(err){logSystemError_('financeStage22Trigger_',null,'finance_forecast',err);}}
