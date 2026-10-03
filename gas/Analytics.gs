// ЦЕХ — Analytics.gs
// Управленческая аналитика блюд и продуктов: ABC + XYZ + Food Cost + drill-down.
// Все показатели рассчитываются из первичных данных и не изменяют историю продаж.

function _analyticsDateKey_(v) {
  if (!v) return '';
  var s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}
function _analyticsPeriod_(dateFrom, dateTo) {
  var end = dateTo ? new Date(String(dateTo) + 'T23:59:59') : new Date();
  var start = dateFrom ? new Date(String(dateFrom) + 'T00:00:00') : new Date(end.getTime() - 29 * 86400000);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) throw new Error('Некорректный период аналитики.');
  return {from: start, to: end, fromKey: start.toISOString().slice(0,10), toKey: end.toISOString().slice(0,10), days: Math.floor((end-start)/86400000)+1};
}
function _analyticsInPeriod_(v, p) { var k=_analyticsDateKey_(v); return k && k>=p.fromKey && k<=p.toKey; }
function _analyticsLocation_(row, locationId) { return !locationId || row.location_id === locationId; }
function _cv_(values) {
  if (!values.length) return 0;
  var mean=values.reduce(function(a,b){return a+b;},0)/values.length;
  if (mean===0) return 0;
  var variance=values.reduce(function(a,b){return a+Math.pow(b-mean,2);},0)/values.length;
  return Math.sqrt(variance)/mean*100;
}
function _xyz_(cv, total) {
  if (!total) return 'Z';
  if (cv <= 10) return 'X';
  if (cv <= 25) return 'Y';
  return 'Z';
}
function _dailySeries_(rows, valueFn, p) {
  var map={};
  for(var i=0;i<p.days;i++) { var d=new Date(p.from.getTime()+i*86400000); map[d.toISOString().slice(0,10)]=0; }
  rows.forEach(function(r){var k=_analyticsDateKey_(r.дата||r.date||r.created_at); if(map.hasOwnProperty(k)) map[k]+=Number(valueFn(r))||0;});
  return Object.keys(map).sort().map(function(k){return map[k];});
}
function _abcClassByBand_(previousPct) { return previousPct < 80 ? 'A' : (previousPct < 95 ? 'B' : 'C'); }

function getDishAnalytics_(organizationId, locationId, dateFrom, dateTo) {
  var p=_analyticsPeriod_(dateFrom,dateTo), sales=getSales_(organizationId,locationId,p.fromKey,p.toKey), by={};
  sales.forEach(function(s){ if(!by[s.dish_id]) by[s.dish_id]={dish_id:s.dish_id,qty:0,revenue:0,cost:0,days:[]}; by[s.dish_id].qty+=Number(s.qty)||0; by[s.dish_id].revenue+=Number(s.сумма)||0; by[s.dish_id].cost+=Number(s.себестоимость_на_момент)||0; by[s.dish_id].days.push(s); });
  var list=Object.keys(by).map(function(id){var x=by[id], dish=findOne_('DISHES','dish_id',id)||{}; var daily=_dailySeries_(x.days,function(r){return Number(r.qty)||0;},p); return {dish_id:id,название:dish.название||'(блюдо удалено/недоступно)',категория_id:dish.категория_id||'',количество:round2_(x.qty),выручка:round2_(x.revenue),себестоимость:round2_(x.cost),маржинальный_доход:round2_(x.revenue-x.cost),food_cost_pct:x.revenue?round2_(x.cost/x.revenue*100):0,средняя_цена:x.qty?round2_(x.revenue/x.qty):0,xyz_cv_pct:round2_(_cv_(daily)),xyz:_xyz_(_cv_(daily),x.qty),среднее_в_день:round2_(x.qty/p.days)}; });
  list.sort(function(a,b){return b.выручка-a.выручка;}); var total=list.reduce(function(s,x){return s+x.выручка;},0),cum=0;
  list.forEach(function(x){x.доля_выручки_pct=total?round2_(x.выручка/total*100):0;cum+=x.доля_выручки_pct;var previous=cum-x.доля_выручки_pct;x.накопленная_доля_pct=round2_(cum);x.abc=_abcClassByBand_(previous);x.abc_xyz=x.abc+x.xyz;});
  return {период_с:p.fromKey,период_по:p.toKey,дней:p.days,общая_выручка:round2_(total),блюда:list,матрица:_analyticsMatrix_(list)};
}

function _analyticsMatrix_(list) { var m={AX:0,AY:0,AZ:0,BX:0,BY:0,BZ:0,CX:0,CY:0,CZ:0}; list.forEach(function(x){if(m.hasOwnProperty(x.abc_xyz))m[x.abc_xyz]++;}); return m; }

function getProductAnalytics_(organizationId, locationId, dateFrom, dateTo) {
  var p=_analyticsPeriod_(dateFrom,dateTo), usage=findRows_('SALE_INGREDIENT_USAGE',function(r){return r.organization_id===organizationId&&_analyticsLocation_(r,locationId)&&_analyticsInPeriod_(r.дата,p);});
  var prodUsage={};
  usage.forEach(function(r){var id=r.product_id;if(!id)return;if(!prodUsage[id])prodUsage[id]={product_id:id,qty:0,cost:0,days:[]};prodUsage[id].qty+=Number(r.брутто||r.нетто)||0;prodUsage[id].cost+=Number(r.стоимость_брутто||0)||0;prodUsage[id].days.push(r);});
  // Если продажи ещё не исполнялись, берём расход из производственных проводок как резервный источник.
  if(!Object.keys(prodUsage).length){ findRows_('PRODUCTION_INGREDIENT_USAGE',function(r){return r.organization_id===organizationId&&_analyticsLocation_(r,locationId)&&_analyticsInPeriod_(r.дата,p);}).forEach(function(r){var id=r.product_id;if(!id)return;if(!prodUsage[id])prodUsage[id]={product_id:id,qty:0,cost:0,days:[]};prodUsage[id].qty+=Number(r.брутто||r.нетто)||0;prodUsage[id].cost+=Number(r.стоимость_брутто||0)||0;prodUsage[id].days.push(r);}); }
  var products=getProducts_(organizationId), list=[];
  products.forEach(function(prod){var x=prodUsage[prod.product_id]||{qty:0,cost:0,days:[]};var daily=_dailySeries_(x.days,function(r){return Number(r.брутто||r.нетто)||0;},p);var stock=locationId?getStockLevel_(prod.product_id,locationId):0;var price=Number(prod.текущая_цена||prod.закупочная_цена)||0;list.push({product_id:prod.product_id,название:prod.название,категория_id:prod.категория_id||'',единица:prod.единица,расход:round2_(x.qty),стоимость_расхода:round2_(x.cost||x.qty*price),остаток:round2_(stock),стоимость_остатка:round2_(stock*price),текущая_цена:round2_(price),xyz_cv_pct:round2_(_cv_(daily)),xyz:_xyz_(_cv_(daily),x.qty)});});
  list=list.filter(function(x){return x.расход>0;}).sort(function(a,b){return b.стоимость_расхода-a.стоимость_расхода;});var total=list.reduce(function(s,x){return s+x.стоимость_расхода;},0),cum=0;list.forEach(function(x){x.доля_стоимости_pct=total?round2_(x.стоимость_расхода/total*100):0;cum+=x.доля_стоимости_pct;var previous=cum-x.доля_выручки_pct;x.накопленная_доля_pct=round2_(cum);x.abc=_abcClassByBand_(previous);x.abc_xyz=x.abc+x.xyz;});
  return {период_с:p.fromKey,период_по:p.toKey,дней:p.days,общая_стоимость_расхода:round2_(total),продукты:list,матрица:_analyticsMatrix_(list)};
}

function getDishAnalyticsDetail_(dishId, organizationId, locationId, dateFrom, dateTo) {
  var a=getDishAnalytics_(organizationId,locationId,dateFrom,dateTo), d=a.блюда.filter(function(x){return x.dish_id===dishId;})[0]; if(!d) return null;
  var lines=getRecipeLines_('DISH',dishId,{organization_id:organizationId,location_id:locationId});
  return {блюдо:d,состав:lines};
}

function getProductAnalyticsDetail_(productId, organizationId, locationId, dateFrom, dateTo) {
  var a=getProductAnalytics_(organizationId,locationId,dateFrom,dateTo), p=a.продукты.filter(function(x){return x.product_id===productId;})[0]; if(!p) return null;
  var dishes=getDishAnalytics_(organizationId,locationId,dateFrom,dateTo).блюда.filter(function(d){var lines=getRecipeLines_('DISH',d.dish_id,{organization_id:organizationId,location_id:locationId})||[];return lines.some(function(l){return l.ingredient_id===productId||l.product_id===productId;});});
  return {продукт:p,используется_в_блюдах: dishes};
}

function getAnalyticsDashboard_(session,data) {
  data=data||{};var from=data.dateFrom,to=data.dateTo;
  var dishes=getDishAnalytics_(session.organization_id,session.location_id,from,to),products=getProductAnalytics_(session.organization_id,session.location_id,from,to);
  return {period:{from:dishes.период_с,to:dishes.период_по,days:dishes.дней},dishes:dishes,products:products,top_dishes:dishes.блюда.slice(0,10),top_products:products.продукты.slice(0,10)};
}
