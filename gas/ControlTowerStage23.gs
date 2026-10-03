/**
 * ЦЕХ — Stage 23: Operational Control Tower.
 *
 * Единый read-only слой для директора/менеджмента. Не дублирует бизнес-правила:
 * собирает факты из существующих контуров HACCP, склада, производства,
 * закупок, экономики и Cash Flow и превращает их в список проверяемых сигналов.
 * Никаких автоматических списаний, платежей, закупок или изменений HACCP.
 */
function _ct23Date_(v){return String(v||'').slice(0,10);}
function _ct23Scope_(r,s){return !!r&&r.organization_id===s.organization_id&&(!s.location_id||!r.location_id||r.location_id===s.location_id);}
function _ct23Num_(v){var n=Number(v);return isNaN(n)?0:n;}
function _ct23Push_(arr,code,severity,title,value,action,source){
  arr.push({code:code,severity:severity,title:title,value:value,action:action,source:source||''});
}

function getControlTower_(data,session){
  data=data||{};
  var loc=data.locationId||session.location_id||'';
  if(loc) assertLocationAllowed_(session,loc,'LOCATIONS:'+loc);
  var dateFrom=_ct23Date_(data.dateFrom||todayDateStr_());
  var dateTo=_ct23Date_(data.dateTo||todayDateStr_());
  if(dateTo<dateFrom) throw new Error('Некорректный период Control Tower.');

  var actions=[];
  var eco=getManagementEconomics_(session.organization_id,loc,dateFrom,dateTo);
  var loss=getLossEngine_(session.organization_id,loc,dateFrom,dateTo);
  var cash=getCashForecast_({days:Number(data.forecastDays)||30,dateFrom:dateTo,locationId:loc},session);
  var compliance=getComplianceDashboard_(session.organization_id);
  var production=getProductionEnterpriseDashboard_(session,{locationId:loc});
  production.recalls=(production.recalls||[]).filter(function(r){return !loc||!r.location_id||r.location_id===loc;});
  var demandCalc=calculateDemandPlan_({locationId:loc,horizonDays:Number(data.demandHorizonDays)||1,safetyStockPct:Number(data.safetyStockPct)||0,dateTo:dateTo},session);
  var demand={shortage_count:demandCalc.продукты.filter(function(x){return x.чистая_потребность>0;}).length,estimated_purchase:demandCalc.итоги.ориентировочная_сумма_закупки,products:demandCalc.продукты.length};

  var criticalStock=getProducts_(session.organization_id).filter(function(p){
    if(!loc)return false;
    return getStockLevel_(p.product_id,loc)<Number(p.мин_остаток||0);
  });
  var pendingJournals=loc?getPendingAutoJournals_(loc):[];
  var openTasks=getTasks_(session.organization_id,loc,{status:'новая'});
  var openPurchase=getPurchaseRequests_(loc).filter(function(r){return OPEN_REQUEST_STATUSES.indexOf(r.статус)!==-1;});

  if(criticalStock.length)_ct23Push_(actions,'STOCK_CRITICAL','HIGH','Критические остатки',criticalStock.length,'Проверить FEFO и потребность в закупке.','warehouse');
  if(pendingJournals.length)_ct23Push_(actions,'HACCP_PENDING','HIGH','Есть ожидающие контрольные записи',pendingJournals.length,'Выполнить реальные измерения и закрыть отклонения.','haccp');
  if(compliance.expired>0)_ct23Push_(actions,'COMPLIANCE_EXPIRED','CRITICAL','Есть истёкшие документы поставщиков',compliance.expired,'Проверить документы и применить действующий режим блокировки.','compliance');
  if(compliance.истекают_30_дней>0)_ct23Push_(actions,'COMPLIANCE_EXPIRING','MEDIUM','Документы истекают в ближайшие 30 дней',compliance.истекают_30_дней,'Назначить ответственному проверку продления.','compliance');
  if(production.dispatcher&&production.dispatcher.summary&&production.dispatcher.summary.waiting_material>0)_ct23Push_(actions,'PRODUCTION_MATERIAL_WAIT','HIGH','Производственные задания ждут сырьё',production.dispatcher.summary.waiting_material,'Проверить FEFO, дефицит и закупочные заявки.','production');
  if(production.yield_deviations&&production.yield_deviations.length)_ct23Push_(actions,'YIELD_DEVIATIONS','HIGH','Есть открытые отклонения выхода',production.yield_deviations.length,'Закрыть корректирующие действия с доказательством.','production');
  if(production.recalls&&production.recalls.length)_ct23Push_(actions,'RECALL_OPEN','CRITICAL','Есть открытые Recall-кейсы',production.recalls.length,'Ограничить оборот затронутых партий и завершить Recall-процедуру.','haccp');
  if(openPurchase.length)_ct23Push_(actions,'PURCHASE_OPEN','MEDIUM','Есть открытые закупочные заявки',openPurchase.length,'Сверить с прогнозом потребности и Cash Flow.','purchasing');
  if(cash.cash_gap_risk)_ct23Push_(actions,'CASH_GAP_RISK','CRITICAL','Прогнозируется отрицательный денежный поток',cash.forecast_net,'Проверить обязательства, сроки оплат и план платежей.','finance');
  if(loss.отклонения_выхода.критические>0)_ct23Push_(actions,'YIELD_CRITICAL','CRITICAL','Есть критические отклонения выхода',loss.отклонения_выхода.критические,'Провести разбор причины и подтвердить корректирующее действие.','economics');
  if(eco.prime_cost_pct>70)_ct23Push_(actions,'PRIME_COST_HIGH','HIGH','Prime Cost выше контрольного порога',eco.prime_cost_pct,'Проверить Food Cost, ФОТ и списания.','economics');
  if(eco.списания>0&&eco.выручка>0&&eco.списания/eco.выручка*100>3)_ct23Push_(actions,'WRITEOFF_RATE_HIGH','HIGH','Списания превышают 3% выручки',round2_(eco.списания/eco.выручка*100),'Разобрать причины списаний и проверить FEFO/планирование.','economics');
  if(demand&&demand.shortage_count>0)_ct23Push_(actions,'DEMAND_SHORTAGE','HIGH','Есть дефицит по плану потребности',demand.shortage_count,'Проверить открытые закупки и производственный план.','demand');
  if(openTasks.length)_ct23Push_(actions,'TASKS_OPEN','MEDIUM','Есть невыполненные задачи',openTasks.length,'Проверить ответственных и сроки.','tasks');

  var severityOrder={CRITICAL:0,HIGH:1,MEDIUM:2,LOW:3};
  actions.sort(function(a,b){return (severityOrder[a.severity]||9)-(severityOrder[b.severity]||9)||String(a.code).localeCompare(String(b.code));});
  return {
    generated_at:nowIso_(),period:{from:dateFrom,to:dateTo},location_id:loc,
    kpi:{revenue:eco.выручка,gross_margin_pct:eco.валовая_маржа_pct,prime_cost_pct:eco.prime_cost_pct,operating_profit:eco.операционная_прибыль,writeoffs:eco.списания,stock_value:eco.стоимость_склада,cash_forecast_net:cash.forecast_net,open_commitments:cash.open_commitments},
    counts:{actions:actions.length,critical_actions:actions.filter(function(x){return x.severity==='CRITICAL';}).length,critical_stock:criticalStock.length,pending_haccp:pendingJournals.length,open_tasks:openTasks.length,open_purchases:openPurchase.length},
    actions:actions,
    haccp:{compliance:compliance,pending_journals:pendingJournals.length,open_recalls:(production.recalls||[]).length},
    production:{dispatcher:production.dispatcher,yield_deviations:(production.yield_deviations||[]).length},
    demand:demand,
    finance:cash,
    economics:eco,
    losses:loss
  };
}

function controlTowerStage23Trigger_(){
  try{
    getOrganizations_(null).forEach(function(org){
      try{
        (getLocations_(org.organization_id)||[]).forEach(function(loc){
          var s={user_id:'system',organization_id:org.organization_id,location_id:loc.location_id,'роль':'ADMIN',allowed_locations:[loc.location_id],cascade_id:'',operation_id:''};
          var t=getControlTower_({locationId:loc.location_id,dateFrom:todayDateStr_(),dateTo:todayDateStr_(),forecastDays:30},s);
          t.actions.forEach(function(a){
            if(a.severity==='CRITICAL'||a.severity==='HIGH') notify_(org.organization_id,loc.location_id,'CONTROL_TOWER',a.title+': '+a.action+' Значение: '+a.value,'ct23|'+loc.location_id+'|'+todayDateStr_()+'|'+a.code);
          });
        });
      }catch(e){logSystemError_('controlTowerStage23Trigger_',org.organization_id,'control_tower',e);}
    });
  }catch(err){logSystemError_('controlTowerStage23Trigger_',null,'control_tower',err);}
}
