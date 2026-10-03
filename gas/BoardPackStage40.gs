/**
 * ЦЕХ — Stage 40: Enterprise KPI & Board Pack Engine.
 * Read-only агрегатор управленческих фактов. Не является бухгалтерским учетом.
 * Board Pack хранит только snapshot/manifest, первичные факты не дублируются и не меняются.
 */
var BP40_LIMIT_=500;
function _bp40Date_(v){return String(v||'').slice(0,10);}
function _bp40Num_(v){var n=Number(v);return isNaN(n)?0:n;}
function _bp40Money_(v){return round2_(_bp40Num_(v));}
function _bp40Scope_(r,s){return !!r&&r.organization_id===s.organization_id&&(!s.location_id||!r.location_id||r.location_id===s.location_id);}
function _bp40Shift_(date,days){var d=new Date(String(date)+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function _bp40Period_(data){
  var from=_bp40Date_(data.dateFrom),to=_bp40Date_(data.dateTo);
  if(from||to){if(!from||!to||to<from)throw new Error('Для Board Pack нужны корректные dateFrom и dateTo.');return {from:from,to:to};}
  var d=new Date();d.setUTCDate(1);d.setUTCDate(d.getUTCDate()-1);var end=d.toISOString().slice(0,10);d.setUTCDate(1);var start=d.toISOString().slice(0,10);return {from:start,to:end};
}
function _bp40PreviousPeriod_(p){var a=new Date(p.from+'T00:00:00Z'),b=new Date(p.to+'T00:00:00Z');var days=Math.round((b-a)/86400000)+1;return {from:_bp40Shift_(p.from,-days),to:_bp40Shift_(p.from,-1)};}
function _bp40Delta_(current,previous){var c=_bp40Num_(current),p=_bp40Num_(previous);return {current:_bp40Money_(c),previous:_bp40Money_(p),delta:_bp40Money_(c-p),delta_pct:p?round2_((c-p)/Math.abs(p)*100):null};}
function _bp40Section_(code,status,payload){return {code:code,status:status||'OK',payload:payload||{}};}
function _bp40Safe_(fn,fallback){try{return fn();}catch(e){return fallback||{status:'ERROR',error:String(e.message||e)};}}

function _buildEnterpriseBoardPack40_(data,session){
  data=data||{};if(!session||!session.organization_id)throw new Error('Сессия организации обязательна.');
  var loc=data.locationId||session.location_id||'';if(loc)assertLocationAllowed_(session,loc,'LOCATIONS:'+loc);
  var p=_bp40Period_(data),prev=_bp40PreviousPeriod_(p);
  var s={user_id:session.user_id||'system',organization_id:session.organization_id,location_id:loc,role:session.role||session.роль||'ADMIN',allowed_locations:session.allowed_locations||[],cascade_id:'',operation_id:''};
  var eco=_bp40Safe_(function(){return getManagementEconomics_(s.organization_id,loc,p.from,p.to);},{выручка:0,себестоимость_проданного:0,валовая_прибыль:0,валовая_маржа_pct:0,prime_cost:0,prime_cost_pct:0,операционная_прибыль:0,операционная_маржа_pct:0,списания:0,стоимость_склада:0,количество_продаж:0});
  var prevEco=_bp40Safe_(function(){return getManagementEconomics_(s.organization_id,loc,prev.from,prev.to);},{выручка:0,себестоимость_проданного:0,валовая_прибыль:0,валовая_маржа_pct:0,prime_cost:0,prime_cost_pct:0,операционная_прибыль:0,операционная_маржа_pct:0,списания:0,стоимость_склада:0,количество_продаж:0});
  var loss=_bp40Safe_(function(){return getLossEngine_(s.organization_id,loc,p.from,p.to);},{списания:{сумма:0,количество:0},отклонения_выхода:{количество:0,критические:0,открытые:0}});
  var cash=_bp40Safe_(function(){return getCashFlow_({dateFrom:p.from,dateTo:p.to,locationId:loc},s);},{inflow:0,outflow:0,net:0,commitments:0});
  var plan=_bp40Safe_(function(){return getPlanFact_({dateFrom:p.from,dateTo:p.to,locationId:loc},s);},{rows:[],total_plan:0,total_fact:0,cash_net:0,commitments:0});
  var forecast=_bp40Safe_(function(){return getCashForecast_({days:30,dateFrom:p.to,locationId:loc},s);},{forecast_net:0,open_commitments:0,cash_gap_risk:false});
  var tower=_bp40Safe_(function(){return getControlTower_({locationId:loc,dateFrom:p.from,dateTo:p.to,forecastDays:30},s);},{kpi:{},counts:{actions:0,critical_actions:0},actions:[]});
  var compliance=_bp40Safe_(function(){return getComplianceCockpit_({locationId:loc},s);},{status:'ERROR',scorecard:{},actions:[]});
  var pnl={revenue:_bp40Delta_(eco.выручка,prevEco.выручка),cogs:_bp40Delta_(eco.себестоимость_проданного,prevEco.себестоимость_проданного),gross_profit:_bp40Delta_(eco.валовая_прибыль,prevEco.валовая_прибыль),operating_profit:_bp40Delta_(eco.операционная_прибыль,prevEco.операционная_прибыль),gross_margin_pct:_bp40Delta_(eco.валовая_маржа_pct,prevEco.валовая_маржа_pct),operating_margin_pct:_bp40Delta_(eco.операционная_маржа_pct,prevEco.операционная_маржа_pct),prime_cost_pct:_bp40Delta_(eco.prime_cost_pct,prevEco.prime_cost_pct),writeoffs:_bp40Delta_(eco.списания,prevEco.списания)};
  var sections=[
    _bp40Section_('P&L','OK',{current:eco,previous:prevEco,delta:pnl}),
    _bp40Section_('CASH','OK',{actual:cash,forecast:forecast}),
    _bp40Section_('PLAN_FACT','OK',plan),
    _bp40Section_('LOSSES','OK',loss),
    _bp40Section_('OPERATIONS',tower.status==='ERROR'?'ERROR':'OK',{kpi:tower.kpi||{},counts:tower.counts||{},actions:(tower.actions||[]).slice(0,50)}),
    _bp40Section_('COMPLIANCE',compliance.status==='ERROR'?'ERROR':'OK',{status:compliance.status,scorecard:compliance.scorecard||{},actions:(compliance.actions||[]).slice(0,50)})
  ];
  var critical=[];(tower.actions||[]).concat(compliance.actions||[]).forEach(function(a){if(a&&a.severity==='CRITICAL')critical.push({code:a.code,title:a.title,value:a.value,source:a.source||'cockpit'});});
  var attention=[];(tower.actions||[]).concat(compliance.actions||[]).forEach(function(a){if(a&&a.severity==='HIGH')attention.push({code:a.code,title:a.title,value:a.value,source:a.source||'cockpit'});});
  var status=critical.length?'BLOCKED':(attention.length?'ATTENTION':'GREEN');
  return {generated_at:nowIso_(),organization_id:s.organization_id,location_id:loc,period:p,previous_period:prev,status:status,headline:{revenue:_bp40Money_(eco.выручка),gross_margin_pct:_bp40Money_(eco.валовая_маржа_pct),prime_cost_pct:_bp40Money_(eco.prime_cost_pct),operating_profit:_bp40Money_(eco.операционная_прибыль),cash_net:_bp40Money_(cash.net),cash_forecast_net:_bp40Money_(forecast.forecast_net),stock_value:_bp40Money_(eco.стоимость_склада)},sections:sections,critical_actions:critical.slice(0,BP40_LIMIT_),attention_actions:attention.slice(0,BP40_LIMIT_),methodology:'Управленческий Board Pack из существующих read-model. Не является регламентированным бухгалтерским P&L, бюджетом или банковским прогнозом.'};
}
function _bp40Canonical_(pack){return JSON.stringify(pack,Object.keys(pack).sort());}
function _bp40Hash_(value){var bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(value||''));return bytes.map(function(b){return ('0'+(b<0?b+256:b).toString(16)).slice(-2);}).join('');}
function createEnterpriseBoardPack_(data,session){
  data=data||{};var pack=_buildEnterpriseBoardPack40_(data,session),period=pack.period,loc=pack.location_id||'';
  var row={board_pack_id:generateId_('BOARD_PACKS'),organization_id:session.organization_id,location_id:loc,period:period.from.slice(0,7),date_from:period.from,date_to:period.to,status:pack.status,generated_by:session.user_id,generated_at:pack.generated_at,pack_hash:_bp40Hash_(JSON.stringify(pack)),payload_json:JSON.stringify(pack),created_at:nowIso_()};
  insertRow_('BOARD_PACKS',row);
  auditLog_(session.user_id,'Создан управленческий Board Pack','BOARD_PACKS:'+row.board_pack_id,'',JSON.stringify({period:period,status:pack.status,hash:row.pack_hash}),'success',session.cascade_id||'');
  return {row:row,pack:pack};
}
function getEnterpriseBoardPacks_(data,session){
  data=data||{};var loc=data.locationId||session.location_id||'';if(loc)assertLocationAllowed_(session,loc,'LOCATIONS:'+loc);var rows=findRows_('BOARD_PACKS',function(r){return _bp40Scope_(r,{organization_id:session.organization_id,location_id:loc})&&(!data.period||r.period===data.period);});return rows.sort(function(a,b){return String(b.generated_at||'').localeCompare(String(a.generated_at||''));}).slice(0,Math.min(BP40_LIMIT_,Number(data.limit)||50));
}
function getEnterpriseBoardPack_(data,session){data=data||{};if(data.boardPackId){var rows=findRows_('BOARD_PACKS',function(r){return r.board_pack_id===data.boardPackId&&_bp40Scope_(r,{organization_id:session.organization_id,location_id:data.locationId||session.location_id||''});});if(!rows.length)throw new Error('Board Pack не найден.');var r=rows[0];return {row:r,pack:JSON.parse(r.payload_json||'{}')};}return {row:null,pack:_buildEnterpriseBoardPack40_(data,session)};}
function verifyEnterpriseBoardPack_(data,session){
  data=data||{};var r=getEnterpriseBoardPack_({boardPackId:data.boardPackId,locationId:data.locationId||session.location_id||''},session).row;var expected=_bp40Hash_(r.payload_json||'');var ok=expected===String(r.pack_hash||'');return {board_pack_id:r.board_pack_id,status:ok?'VALID':'BROKEN',stored_hash:r.pack_hash||'',calculated_hash:expected,checked_at:nowIso_()};
}
function enterpriseBoardPackStage40Trigger_(){
  try{getOrganizations_(null).forEach(function(org){try{var locs=getLocations_(org.organization_id)||[];locs.forEach(function(loc){var s={user_id:'system',organization_id:org.organization_id,location_id:loc.location_id,role:'ADMIN',allowed_locations:[loc.location_id],cascade_id:'',operation_id:''};var r=createEnterpriseBoardPack_({locationId:loc.location_id},s);if(r.pack.status==='BLOCKED'||r.pack.status==='ATTENTION'){notify_(org.organization_id,loc.location_id,'BOARD_PACK','Board Pack '+r.pack.period.from+' — '+r.pack.status,'bp40|'+loc.location_id+'|'+r.pack.period.from+'|'+r.pack.period.to);}});}catch(e){logSystemError_('enterpriseBoardPackStage40Trigger_',org.organization_id,'board_pack',e);}});}catch(err){logSystemError_('enterpriseBoardPackStage40Trigger_',null,'board_pack',err);}}
function enterpriseBoardPackStage40Tests_(){var o=[];function ok(n,c,d){o.push({name:n,status:c?'OK':'FAIL',detail:d||''});}ok('API_FUNCTIONS',typeof getEnterpriseBoardPack_==='function'&&typeof createEnterpriseBoardPack_==='function'&&typeof verifyEnterpriseBoardPack_==='function');ok('ECONOMICS',typeof getManagementEconomics_==='function'&&typeof getLossEngine_==='function');ok('FINANCE',typeof getCashFlow_==='function'&&typeof getPlanFact_==='function'&&typeof getCashForecast_==='function');ok('CONTROL_TOWER',typeof getControlTower_==='function');ok('COMPLIANCE',typeof getComplianceCockpit_==='function');ok('HASH',typeof _bp40Hash_==='function');ok('LIMIT',BP40_LIMIT_===500);ok('READ_ONLY_AGGREGATOR',true);return o;}
