// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/** P21 — cross-contour journal orchestration/read model. It never invents journal facts. */
var P21_EVENT_JOURNAL_MAP = {
  RECEIPT_CREATED: 'Входной контроль сырья',
  PRODUCTION_CREATED: 'Производственный контроль',
  SALE_CREATED: 'Реализация',
  WRITE_OFF_CREATED: 'Списания',
  TEMPERATURE_RECORDED: 'Температуры',
  CLEANING_COMPLETED: 'Генеральная уборка',
  CHEMICAL_USED: 'Дезинфекция',
  TASK_CREATED: 'Контрольные задания',
  LAB_RESULT_FAILED: 'Лабораторный контроль',
  DEVIATION_CREATED: 'Отклонения',
  SHIFT_OPENED: 'Открытие смены',
  SHIFT_CLOSED: 'Закрытие смены',
  JOURNAL_ENTRY_RECORDED: 'Ручной журнал'
};

function getP21JournalMap_(){return Object.keys(P21_EVENT_JOURNAL_MAP).map(function(k){return {event_type:k,journal_type:P21_EVENT_JOURNAL_MAP[k]};});}
function getP21AutomationContract_(){return {source_of_truth:'PRIMARY_OPERATION',event_bus:'EVENTS',journal_engine:'Journals.gs',writes_facts:false,creates_fake_measurements:false,read_only:true};}

function p21LinkActualJournals_(event, session){
  if(!event || !event.operation_id) return [];
  var journals=findRows_('JOURNALS',function(j){return j.organization_id===event.organization_id && (!event.location_id||j.location_id===event.location_id) && (j.cascade_id===event.cascade_id || j.cascade_id===event.payload_json.cascade_id || j.cascade_id===event.operation_id);});
  // Avoid dynamic payload assumptions; primary event stores cascade in payload_json.
  var payload={}; try{payload=JSON.parse(event.payload_json||'{}');}catch(e){logSystemError_('p21LinkActualJournals_',session?session.user_id:null,'P21_EVENT_PAYLOAD',e);}
  journals=findRows_('JOURNALS',function(j){return j.organization_id===event.organization_id && (!event.location_id||j.location_id===event.location_id) && j.cascade_id===String(payload.cascade_id||'');});
  var linked=[];
  journals.forEach(function(j){
    var exists=findRows_('P21_JOURNAL_LINKS',function(x){return x.event_id===event.event_id&&x.journal_id===j.journal_id;})[0];
    if(exists){linked.push(exists);return;}
    var row={link_id:generateId_('P21_JOURNAL_LINKS'),organization_id:event.organization_id,location_id:event.location_id,event_id:event.event_id,operation_id:event.operation_id,journal_id:j.journal_id,journal_type:j.тип_журнала||'',created_at:nowIso_()};
    insertRow_('P21_JOURNAL_LINKS',row); linked.push(row);
  });
  return linked;
}

function getP21CoverageReport_(session,data){
  var org=session.organization_id, loc=resolveLocationScope_(session,data&&data.locationId);
  var defs=findRows_('JOURNAL_DEFINITIONS',function(d){return d.organization_id===org&&(!loc||d.location_id===loc)&&d.статус!=='архив';});
  var events=findRows_('EVENTS',function(e){return e.organization_id===org&&(!loc||e.location_id===loc);});
  var links=findRows_('P21_JOURNAL_LINKS',function(x){return x.organization_id===org&&(!loc||x.location_id===loc);});
  return Object.keys(P21_EVENT_JOURNAL_MAP).map(function(type){
    var journalType=P21_EVENT_JOURNAL_MAP[type];
    var relevant=events.filter(function(e){return e.type===type;});
    var linked=links.filter(function(l){return relevant.some(function(e){return e.event_id===l.event_id;});});
    var required=defs.some(function(d){return d.journal_type===journalType&&String(d.обязательность||'').toLowerCase()!=='нет';});
    var status=!relevant.length?'NO_EVENTS':(linked.length>=relevant.length?'COVERED':(required?'GAP':'NOT_REQUIRED'));
    return {event_type:type,source_module:relevant.length?relevant[0].source:'mapped',source_function:relevant.length?relevant[0].entity_type:'',journal_type:journalType,coverage_status:status,dedup_status:linked.length===new Set(linked.map(function(x){return x.event_id+'|'+x.journal_id;})).size?'OK':'DUPLICATE',audit_status:'AUDIT_LOG_REQUIRED',error_status:relevant.some(function(e){return e.error_message;})?'ERROR':'OK',events:relevant.length,links:linked.length,required:required};
  });
}

function getP21FinalGate_(session,data){
  var coverage=getP21CoverageReport_(session,data||{});
  var blockers=coverage.filter(function(x){return x.coverage_status==='GAP'||x.dedup_status==='DUPLICATE';});
  return {status:blockers.length?'NOT_READY':'READY_WITH_WARNINGS',blockers:blockers,coverage:coverage,read_only:true};
}
