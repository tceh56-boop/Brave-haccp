/**
 * ЦЕХ — Stage 24: Operations Copilot.
 *
 * Read-only explainability layer over existing Control Tower and economics APIs.
 * No direct DB access, no external LLM call, no mutation. Every answer contains
 * source objects from the same organization/location scope.
 */
var AI_COPILOT_MAX_ACTIONS_ = 8;

function _ai24norm_(s){ return String(s||'').toLowerCase().replace(/ё/g,'е').trim(); }
function _ai24source_(type,id,label,value){ return {type:type,id:id||'',label:label||'',value:value===undefined?null:value}; }
function _ai24Action_(a){ return {code:a.code,severity:a.severity,title:a.title,value:a.value,action:a.action,source:a.source}; }

function getOperationsCopilot_(data, session){
  data=data||{};
  var question=String(data.question||'').trim();
  if(!question) return {intent:'EMPTY',answer:'Укажите вопрос. Например: «что сегодня требует внимания?» или «почему выросли потери?».',sources:[],actions:[]};
  var lower=_ai24norm_(question);
  var ct=getControlTower_({
    locationId:data.locationId||session.location_id||'',
    dateFrom:data.dateFrom||todayDateStr_(),
    dateTo:data.dateTo||todayDateStr_(),
    forecastDays:Number(data.forecastDays)||30,
    demandHorizonDays:Number(data.demandHorizonDays)||1
  },session);
  var result={intent:'CONTROL_TOWER',answer:'',sources:[],actions:[],generated_at:nowIso_(),scope:{organization_id:session.organization_id,location_id:ct.location_id,period:ct.period}};

  if(lower.indexOf('вниман')>=0 || lower.indexOf('сегодня')>=0 || lower.indexOf('проблем')>=0 || lower.indexOf('что происходит')>=0){
    result.intent='PRIORITIES';
    var acts=(ct.actions||[]).slice(0,AI_COPILOT_MAX_ACTIONS_);
    result.actions=acts.map(_ai24Action_);
    result.sources=acts.map(function(a){return _ai24source_('control_tower_action',a.code,a.title,a.value);});
    result.answer=acts.length ? 'Сейчас обнаружено '+acts.length+' существенных сигнала. Сначала проверьте критические и высокие по приоритету.' : 'Существенных сигналов в текущем периоде не обнаружено.';
    return result;
  }

  if(lower.indexOf('деньг')>=0 || lower.indexOf('cash')>=0 || lower.indexOf('касс')>=0 || lower.indexOf('платеж')>=0){
    result.intent='CASH_FLOW';
    var f=ct.finance||{};
    result.sources=[_ai24source_('cash_forecast','', 'Прогноз Cash Flow', f.forecast_net),_ai24source_('cash_commitments','', 'Открытые обязательства', f.open_commitments)];
    result.answer='Прогнозный чистый денежный поток: '+_ai24num_(f.forecast_net)+'; открытые обязательства: '+_ai24num_(f.open_commitments)+'.';
    if(f.cash_gap_risk) result.answer+=' Есть риск отрицательного прогноза — требуется проверить сроки обязательств и платежей.';
    return result;
  }

  if(lower.indexOf('потер')>=0 || lower.indexOf('списан')>=0 || lower.indexOf('отход')>=0 || lower.indexOf('loss')>=0){
    result.intent='LOSSES';
    var l=ct.losses||{};
    result.sources=[_ai24source_('loss_engine','', 'Списания', l.списания),_ai24source_('yield_deviations','', 'Отклонения выхода', l.отклонения_выхода&&l.отклонения_выхода.критические)];
    result.answer='Списания за период: '+_ai24num_(l.списания)+'. Критические отклонения выхода: '+_ai24num_(l.отклонения_выхода&&l.отклонения_выхода.критические)+'.';
    if(l.списания>0 && ct.kpi.revenue>0) result.answer+=' Доля списаний относительно выручки: '+_ai24num_(l.списания/ct.kpi.revenue*100)+'%.';
    return result;
  }

  if(lower.indexOf('прибыл')>=0 || lower.indexOf('марж')>=0 || lower.indexOf('себестоим')>=0 || lower.indexOf('food cost')>=0 || lower.indexOf('prime cost')>=0){
    result.intent='ECONOMICS';
    var e=ct.economics||{};
    result.sources=[_ai24source_('economics','', 'Выручка',e.выручка),_ai24source_('economics','', 'Валовая маржа %',e.валовая_маржа_pct),_ai24source_('economics','', 'Prime Cost %',e.prime_cost_pct),_ai24source_('economics','', 'Операционная прибыль',e.операционная_прибыль)];
    result.answer='Выручка: '+_ai24num_(e.выручка)+'; валовая маржа: '+_ai24num_(e.валовая_маржа_pct)+'%; Prime Cost: '+_ai24num_(e.prime_cost_pct)+'%; операционная прибыль: '+_ai24num_(e.операционная_прибыль)+'.';
    return result;
  }

  if(lower.indexOf('haccp')>=0 || lower.indexOf('санпин')>=0 || lower.indexOf('наруш')>=0 || lower.indexOf('контрол')>=0 || lower.indexOf('recall')>=0){
    result.intent='COMPLIANCE';
    var h=ct.haccp||{};
    result.sources=[_ai24source_('haccp_pending','', 'Ожидающие контрольные записи',h.pending_journals),_ai24source_('recall','', 'Открытые Recall',h.open_recalls),_ai24source_('compliance','', 'Состояние документов','')];
    result.answer='Ожидающих HACCP-контролей: '+_ai24num_(h.pending_journals)+'; открытых Recall: '+_ai24num_(h.open_recalls)+'.';
    return result;
  }

  if(lower.indexOf('закуп')>=0 || lower.indexOf('сырь')>=0 || lower.indexOf('дефиц')>=0 || lower.indexOf('потребн')>=0){
    result.intent='DEMAND';
    var d=ct.demand||{};
    result.sources=[_ai24source_('demand','', 'Позиций в расчёте',d.products),_ai24source_('demand_shortage','', 'Дефицитных позиций',d.shortage_count),_ai24source_('purchase_estimate','', 'Ориентировочная закупка',d.estimated_purchase)];
    result.answer='В расчёте потребности: '+_ai24num_(d.products)+' позиций; дефицитных: '+_ai24num_(d.shortage_count)+'; ориентировочная сумма закупки: '+_ai24num_(d.estimated_purchase)+'.';
    return result;
  }

  result.intent='UNRECOGNIZED';
  result.answer='Запрос не попал в поддерживаемый сценарий. Доступны вопросы о приоритетах, экономике, потерях, Cash Flow, HACCP/Recall и закупочной потребности.';
  return result;
}
function _ai24num_(v){var n=Number(v);return isNaN(n)?0:round2_(n);}
