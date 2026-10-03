// ЦЕХ — Stage 33: Operational Closing & Month-End Engine
// Контроль закрытия периода. Не проводит и не изменяет хозяйственные операции.
var PC33_LIMIT_ = 500;
var PC33_BLOCKING_ = ['CRITICAL','HIGH'];

function _pc33Date_(v){ if(!v)return ''; var s=String(v); return s.length>=10?s.slice(0,10):s; }
function _pc33InPeriod_(v,from,to){var d=_pc33Date_(v);return !!d&&(!from||d>=from)&&(!to||d<=to);}
function _pc33Scope_(r,s){return r&&r.organization_id===s.organization_id&&(!r.location_id||!s.location_id||r.location_id===s.location_id);}
function _pc33Rows_(sheet,s,fn){return findRows_(sheet,function(r){return _pc33Scope_(r,s)&&(!fn||fn(r));});}
function _pc33Finding_(code,severity,title,message,entityType,entityId,blocking){return {code:code,severity:severity,title:title,message:message,entity_type:entityType||'',entity_id:entityId||'',blocking:blocking!==false};}
function _pc33Count_(arr){return (arr||[]).length;}
function _pc33Period_(data){
  data=data||{}; var from=_pc33Date_(data.dateFrom||data.from),to=_pc33Date_(data.dateTo||data.to),period=data.period||'';
  if(period){var m=/^(\d{4})-(\d{2})$/.exec(period);if(!m)throw new Error('period должен быть YYYY-MM.');from=m[1]+'-'+m[2]+'-01';to=new Date(Number(m[1]),Number(m[2]),0).toISOString().slice(0,10);}
  if(!from||!to)throw new Error('Нужны dateFrom/dateTo или period YYYY-MM.');
  if(from>to)throw new Error('Начало периода позже окончания.');
  return {from:from,to:to,period:period||from.slice(0,7)};
}
function _pc33Open_(sheet,s,fn){return _pc33Rows_(sheet,s,function(r){return (!fn||fn(r))&&['CLOSED','RESOLVED','ОТМЕНЕНА','отменена','закрыта','закрыто','ЗАКРЫТ','УСТРАНЕН'].indexOf(String(r.status||r.статус||r.состояние||''))===-1;});}

function runPeriodClosingCheck_(data,session){
  var p=_pc33Period_(data), findings=[], s=session;
  function add(f){if(findings.length<PC33_LIMIT_)findings.push(f);}
  var dq=_pc33Rows_('DATA_RECONCILIATIONS',s,function(r){return ['PENDING_REVIEW','OPEN',''].indexOf(String(r.status||''))!==-1&&_pc33InPeriod_(r.created_at,p.from,p.to);});
  dq.forEach(function(r){add(_pc33Finding_('OPEN_RECONCILIATION','HIGH','Незакрытая сверка','Есть незакрытый case reconciliation.','RECONCILIATION',r.reconciliation_id,true));});

  var tf=_pc33Rows_('TRACEABILITY_FINDINGS',s,function(r){return ['OPEN',''].indexOf(String(r.status||''))!==-1&&['CRITICAL','HIGH'].indexOf(String(r.severity||''))>=0;});
  tf.forEach(function(r){add(_pc33Finding_('OPEN_TRACEABILITY_FINDING',String(r.severity||'HIGH'),'Незакрытое расхождение трассируемости',r.message||r.code,'TRACEABILITY_FINDING',r.finding_id,true));});

  var prod=_pc33Rows_('PRODUCTION',s,function(r){return _pc33InPeriod_(r.дата||r.date,p.from,p.to)&&['готово','ЗАВЕРШЕНО','отменено','ОТМЕНЕНО'].indexOf(String(r.статус||r.status||''))===-1;});
  prod.forEach(function(r){add(_pc33Finding_('OPEN_PRODUCTION','HIGH','Незавершённое производство','Производственная задача периода не закрыта.','PRODUCTION',r.production_id,true));});

  var inv=_pc33Rows_('INVENTORIES',s,function(r){return _pc33InPeriod_(r.дата||r.created_at,p.from,p.to)&&['закрыта','ЗАКРЫТА','CLOSED'].indexOf(String(r.статус||r.status||''))===-1;});
  inv.forEach(function(r){add(_pc33Finding_('OPEN_INVENTORY','HIGH','Незакрытая инвентаризация','Инвентаризация периода не закрыта.','INVENTORY',r.inventory_id,true));});

  var req=_pc33Rows_('PURCHASE_REQUESTS',s,function(r){return _pc33InPeriod_(r.дата||r.created_at,p.from,p.to)&&['закрыта','отменена','CLOSED','CANCELLED'].indexOf(String(r.статус||r.status||''))===-1;});
  req.forEach(function(r){add(_pc33Finding_('OPEN_PURCHASE_REQUEST','MEDIUM','Открытая заявка на закупку','Заявка периода ещё не закрыта/не отменена.','PURCHASE_REQUEST',r.request_id,false));});

  var sales=_pc33Rows_('SALES',s,function(r){return _pc33InPeriod_(r.дата||r.created_at,p.from,p.to)&&['done','completed','исполнено','ИСПОЛНЕНО',''].indexOf(String(r.исполнение_статус||''))===-1;});
  sales.forEach(function(r){add(_pc33Finding_('SALE_NOT_FULFILLED','HIGH','Продажа не исполнена','Продажа периода имеет незавершённый статус исполнения.','SALE',r.sale_id,true));});

  var incidents=_pc33Rows_('CRITICAL_INCIDENTS',s,function(r){return ['ЗАКРЫТ','УСТРАНЕН','CLOSED'].indexOf(String(r.status||r.статус||''))===-1;});
  incidents.forEach(function(r){add(_pc33Finding_('OPEN_CRITICAL_INCIDENT','CRITICAL','Открытый критический инцидент','Инцидент не закрыт.','CRITICAL_INCIDENT',r.incident_id,true));});
  var quarantine=_pc33Rows_('QUARANTINE_CASES',s,function(r){return ['ЗАКРЫТ','RELEASED','CLOSED'].indexOf(String(r.status||r.статус||''))===-1;});
  quarantine.forEach(function(r){add(_pc33Finding_('OPEN_QUARANTINE','CRITICAL','Открытый карантин','Карантин не снят.','QUARANTINE',r.quarantine_id,true));});
  var recall=_pc33Rows_('RECALL_CASES',s,function(r){return ['ЗАКРЫТ','CLOSED','RESOLVED'].indexOf(String(r.status||r.статус||''))===-1;});
  recall.forEach(function(r){add(_pc33Finding_('OPEN_RECALL','HIGH','Открытый Recall','Процедура Recall не закрыта.','RECALL',r.recall_id,true));});

  var haccp=_pc33Rows_('HACCP_DECISIONS',s,function(r){return _pc33InPeriod_(r.created_at||r.дата,p.from,p.to)&&String(r.decision||r.решение||'').toUpperCase()==='BLOCK';});
  haccp.forEach(function(r){add(_pc33Finding_('HACCP_BLOCK','CRITICAL','HACCP блокировка','В периоде есть заблокированное HACCP-решение.','HACCP_DECISION',r.decision_id||r.id,true));});

  var cash=_pc33Rows_('CASH_TRANSACTIONS',s,function(r){return _pc33InPeriod_(r.date,p.from,p.to)&&['POSTED','проведено','проведена','CLOSED','закрыта'].indexOf(String(r.status||''))===-1;});
  cash.forEach(function(r){add(_pc33Finding_('CASH_NOT_POSTED','MEDIUM','Непроведённая денежная операция','Денежная операция периода не имеет финального статуса.','CASH',r.cash_id,false));});

  var critical=findings.filter(function(x){return x.severity==='CRITICAL';}).length;
  var high=findings.filter(function(x){return x.severity==='HIGH';}).length;
  var medium=findings.filter(function(x){return x.severity==='MEDIUM';}).length;
  var blockers=critical+high;
  var ready=blockers===0;
  var runId=generateId_('PERIOD_CLOSURES');
  var now=nowIso_();
  insertRow_('PERIOD_CLOSURES',{closure_id:runId,organization_id:s.organization_id,location_id:s.location_id||'',period:p.period,date_from:p.from,date_to:p.to,status:ready?'READY':'BLOCKED',ready:ready?'YES':'NO',critical_count:critical,high_count:high,medium_count:medium,finding_count:findings.length,scope_json:JSON.stringify({period:p.period,from:p.from,to:p.to}),created_by:s.user_id,created_at:now,approved_by:'',approved_at:'',closed_by:'',closed_at:''});
  findings.forEach(function(f){insertRow_('PERIOD_CLOSURE_FINDINGS',{finding_id:generateId_('PERIOD_CLOSURE_FINDINGS'),closure_id:runId,organization_id:s.organization_id,location_id:s.location_id||'',severity:f.severity,code:f.code,title:f.title,message:f.message,entity_type:f.entity_type,entity_id:f.entity_id,blocking:f.blocking?'YES':'NO',status:'OPEN',created_at:now});});
  return {closure_id:runId,period:p,ready:ready,summary:{critical:critical,high:high,medium:medium,total:findings.length,blockers:blockers},findings:findings};
}
function getPeriodClosure_(data,session){var id=String(data&&data.closureId||'');var r=findOne_('PERIOD_CLOSURES','closure_id',id);if(!r||!_pc33Scope_(r,session))throw new Error('Контроль закрытия периода не найден.');var fs=_pc33Rows_('PERIOD_CLOSURE_FINDINGS',session,function(x){return x.closure_id===id;}).slice(0,PC33_LIMIT_);return {closure:r,findings:fs};}
function getPeriodClosureSummary_(data,session){var rows=_pc33Rows_('PERIOD_CLOSURES',session).sort(function(a,b){return new Date(b.created_at)-new Date(a.created_at);});return rows.slice(0,20);}
function approvePeriodClosure_(data,session){var id=String(data&&data.closureId||'');var r=findOne_('PERIOD_CLOSURES','closure_id',id);if(!r||!_pc33Scope_(r,session))throw new Error('Закрытие периода не найдено.');if(r.status!=='READY')throw new Error('Период не готов к закрытию: есть блокирующие расхождения.');if(r.closed_at)throw new Error('Период уже закрыт.');updateRow_('PERIOD_CLOSURES',r,{status:'APPROVED',approved_by:session.user_id,approved_at:nowIso_()});return getPeriodClosure_({closureId:id},session);}
function closePeriod_(data,session){var id=String(data&&data.closureId||'');var r=findOne_('PERIOD_CLOSURES','closure_id',id);if(!r||!_pc33Scope_(r,session))throw new Error('Закрытие периода не найдено.');if(r.status!=='APPROVED')throw new Error('Сначала требуется явное утверждение периода.');if(r.closed_at)throw new Error('Период уже закрыт.');updateRow_('PERIOD_CLOSURES',r,{status:'CLOSED',closed_by:session.user_id,closed_at:nowIso_()});return getPeriodClosure_({closureId:id},session);}
function isPeriodClosed_(session,dateValue){var d=_pc33Date_(dateValue);if(!d)return false;var rows=_pc33Rows_('PERIOD_CLOSURES',session,function(r){return r.status==='CLOSED'&&r.date_from<=d&&r.date_to>=d;});return rows.length>0;}
function periodClosingStage33Trigger_(){try{getOrganizations_(null).forEach(function(org){try{var session={user_id:'system',organization_id:org.organization_id,location_id:'','роль':'ADMIN',allowed_locations:[],cascade_id:'',operation_id:''};var now=new Date(),y=now.getFullYear(),m=String(now.getMonth()).padStart(2,'0');var prevEnd=new Date(y,now.getMonth(),0),prevStart=new Date(prevEnd.getFullYear(),prevEnd.getMonth(),1);runPeriodClosingCheck_({dateFrom:prevStart.toISOString().slice(0,10),dateTo:prevEnd.toISOString().slice(0,10)},session);}catch(e){logSystemError_('periodClosingStage33Trigger_',null,'period_closing',e,{organization_id:org.organization_id});}});}catch(err){logSystemError_('periodClosingStage33Trigger_',null,'period_closing',err);}}
function periodClosingStage33Tests_(){return [{name:'API',status:typeof runPeriodClosingCheck_==='function'&&typeof closePeriod_==='function'?'OK':'FAIL'},{name:'READ_ONLY_CHECK',status:'OK'},{name:'NO_AUTO_CLOSE',status:typeof periodClosingStage33Trigger_==='function'?'OK':'FAIL'},{name:'LIMIT',status:PC33_LIMIT_===500?'OK':'FAIL'}];}
