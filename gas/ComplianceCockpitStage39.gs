/**
 * ЦЕХ — Stage 39: Enterprise Compliance Dashboard & Management Cockpit.
 * Read-only агрегатор: Compliance Matrix + CAPA + Evidence + Period Closing + Audit + Traceability + Data Quality.
 * Не изменяет первичные хозяйственные данные.
 */
var CC39_LIMIT_=500;
var CC39_SEVERITY_ORDER_={CRITICAL:0,HIGH:1,MEDIUM:2,LOW:3,NONE:9};
function _cc39Scope_(r,s){return !!r&&r.organization_id===s.organization_id&&(!s.location_id||!r.location_id||r.location_id===s.location_id);}
function _cc39Date_(v){return v?String(v).slice(0,10):'';}
function _cc39Count_(rows,fn){return (rows||[]).filter(fn||function(){return true;}).length;}
function _cc39Level_(critical,attention){if(critical>0)return 'BLOCKED';if(attention>0)return 'ATTENTION';return 'GREEN';}
function _cc39Action_(arr,code,severity,title,value,source){arr.push({code:code,severity:severity,title:title,value:value,source:source||''});}
function _cc39Latest_(sheet,session,dateField){
  var rows=findRows_(sheet,function(r){return _cc39Scope_(r,session);});
  rows.sort(function(a,b){return new Date(b[dateField||'created_at']||0)-new Date(a[dateField||'created_at']||0);});
  return rows[0]||null;
}
function _cc39OpenCapas_(session){return findRows_('CAPA_CASES',function(r){return _cc39Scope_(r,session)&&['CLOSED','REJECTED'].indexOf(String(r.status||''))<0;});}
function _cc39Period_(session){return _cc39Latest_('PERIOD_CLOSURES',session,'created_at');}
function _cc39Audit_(session){
  try{return verifyAuditEvidence35_({},session);}catch(e){return {status:'ERROR',checked_total:0,findings:[{code:'AUDIT_VERIFY_ERROR',severity:'CRITICAL',message:String(e.message||e)}],head_hash:''};}
}
function _cc39Trace_(session){
  try{return getTraceabilitySummary_({},session)||{};}catch(e){return {summary:{total:0,critical:1,high:0,medium:0},findings:[{code:'TRACEABILITY_VERIFY_ERROR',severity:'CRITICAL',message:String(e.message||e)}]};}
}
function getComplianceCockpit_(data,session){
  data=data||{};if(!session||!session.organization_id)throw new Error('Сессия организации обязательна.');
  var loc=data.locationId||session.location_id||'';if(loc)assertLocationAllowed_(session,loc,'LOCATIONS:'+loc);
  var s={organization_id:session.organization_id,location_id:loc,user_id:session.user_id||'system'};
  var matrix=runComplianceMatrix_({},s),summary=matrix.summary||{};
  var capas=_cc39OpenCapas_(s),criticalCapas=capas.filter(function(x){return String(x.severity||'').toUpperCase()==='CRITICAL';}),overdueCapas=capas.filter(function(x){return x.due_at&&new Date(x.due_at).getTime()<Date.now();});
  var audit=_cc39Audit_(s),trace=_cc39Trace_(s),dq;
  try{dq=runDataQualityAudit_({},s)||{summary:{total:0,critical:0,high:0,medium:0},issues:[]};}catch(e){dq={summary:{total:0,critical:1,high:0,medium:0},issues:[{code:'DQ_VERIFY_ERROR',severity:'CRITICAL',message:String(e.message||e)}]};}
  var closure=_cc39Period_(s),openReconc=findRows_('DATA_RECONCILIATIONS',function(r){return _cc39Scope_(r,s)&&String(r.status||'')==='PENDING_REVIEW';});
  var packs=findRows_('COMPLIANCE_EVIDENCE_PACKS',function(r){return _cc39Scope_(r,s);}).sort(function(a,b){return new Date(b.generated_at||b.created_at||0)-new Date(a.generated_at||a.created_at||0);});
  var latestPack=packs[0]||null;
  var actions=[];
  var matrixBlocked=Number(summary.findings||0)>0;
  var matrixAttention=Number(summary.remediation||0)+Number(summary.no_evidence||0);
  if(matrixBlocked)_cc39Action_(actions,'MATRIX_FINDINGS','CRITICAL','Контроли имеют открытые findings',summary.findings,'compliance_matrix');
  if(matrixAttention)_cc39Action_(actions,'MATRIX_GAPS','HIGH','Есть controls без полной поддержки или с открытой remediation',matrixAttention,'compliance_matrix');
  if(criticalCapas.length)_cc39Action_(actions,'CAPA_CRITICAL','CRITICAL','Есть критические незакрытые CAPA',criticalCapas.length,'capa');
  if(overdueCapas.length)_cc39Action_(actions,'CAPA_OVERDUE','HIGH','Есть просроченные CAPA',overdueCapas.length,'capa');
  if(openReconc.length)_cc39Action_(actions,'RECON_OPEN','CRITICAL','Есть незакрытые reconciliation cases',openReconc.length,'reconciliation');
  if(audit.status!=='VALID')_cc39Action_(actions,'AUDIT_INTEGRITY','CRITICAL','Целостность audit evidence требует проверки',audit.findings?audit.findings.length:1,'audit');
  var traceSummary=trace.summary||{};if(Number(traceSummary.critical||0)>0)_cc39Action_(actions,'TRACE_CRITICAL','CRITICAL','Есть критические расхождения трассируемости',traceSummary.critical,'traceability');
  if(Number(dq.summary&&dq.summary.critical||0)>0)_cc39Action_(actions,'DQ_CRITICAL','CRITICAL','Есть критические ошибки качества данных',dq.summary.critical,'data_quality');
  if(!closure)_cc39Action_(actions,'PERIOD_NO_CHECK','HIGH','Нет результата последней проверки закрытия периода',1,'period_closing');
  else if(String(closure.status||'')==='BLOCKED'||String(closure.ready||'').toLowerCase()==='false')_cc39Action_(actions,'PERIOD_BLOCKED','CRITICAL','Последний период не готов к закрытию',closure.critical_count||closure.finding_count||1,'period_closing');
  if(!latestPack)_cc39Action_(actions,'EVIDENCE_PACK_MISSING','HIGH','Нет evidence pack за текущий контур',1,'evidence_pack');
  else if(String(latestPack.status||'')==='REVIEW_REQUIRED')_cc39Action_(actions,'EVIDENCE_PACK_REVIEW','HIGH','Последний evidence pack требует проверки',1,'evidence_pack');
  actions.sort(function(a,b){return (CC39_SEVERITY_ORDER_[a.severity]||9)-(CC39_SEVERITY_ORDER_[b.severity]||9)||String(a.code).localeCompare(String(b.code));});
  var critical=actions.filter(function(x){return x.severity==='CRITICAL';}).length;
  var attention=actions.filter(function(x){return x.severity==='HIGH'||x.severity==='MEDIUM';}).length;
  var level=_cc39Level_(critical,attention);
  var controlCoverage=summary.total?round2_(Number(summary.supported||0)/Number(summary.total)*100):0;
  return {
    generated_at:nowIso_(),organization_id:s.organization_id,location_id:loc,status:level,
    scorecard:{control_total:summary.total||0,control_supported:summary.supported||0,control_findings:summary.findings||0,control_remediation:summary.remediation||0,control_no_evidence:summary.no_evidence||0,control_coverage_pct:controlCoverage,open_capa:capas.length,critical_capa:criticalCapas.length,overdue_capa:overdueCapas.length,open_reconciliation:openReconc.length,audit_status:audit.status,trace_critical:Number(traceSummary.critical||0),dq_critical:Number(dq.summary&&dq.summary.critical||0),period_status:closure?String(closure.status||''):'NO_CHECK',evidence_pack_status:latestPack?String(latestPack.status||''):'MISSING'},
    actions:actions.slice(0,CC39_LIMIT_),
    compliance_matrix:matrix,
    capa:{open:capas.length,critical:criticalCapas.length,overdue:overdueCapas.length},
    period:{latest:closure},
    audit:{status:audit.status,head_hash:audit.head_hash||'',checked_total:audit.checked_total||0,findings:(audit.findings||[]).slice(0,50)},
    traceability:{summary:traceSummary,findings:(trace.findings||[]).slice(0,50)},
    data_quality:{summary:dq.summary||{},issues:(dq.issues||[]).slice(0,50)},
    evidence_pack:{latest:latestPack,total:packs.length}
  };
}
function getComplianceCockpitSummary_(data,session){var r=getComplianceCockpit_(data||{},session);return {generated_at:r.generated_at,organization_id:r.organization_id,location_id:r.location_id,status:r.status,scorecard:r.scorecard,actions:r.actions};}
function complianceCockpitStage39Trigger_(){
  try{getOrganizations_(null).forEach(function(org){try{var s={user_id:'system',organization_id:org.organization_id,location_id:'',role:'ADMIN',allowed_locations:[],cascade_id:'',operation_id:''};var r=getComplianceCockpit_({},s);r.actions.filter(function(a){return a.severity==='CRITICAL'||a.severity==='HIGH';}).slice(0,20).forEach(function(a){notify_(org.organization_id,'','COMPLIANCE_COCKPIT',a.title+' | '+a.code+' | '+a.value,'cc39|'+org.organization_id+'|'+todayDateStr_()+'|'+a.code);});}catch(e){logSystemError_('complianceCockpitStage39Trigger_',null,'compliance_cockpit',e,{organization_id:org.organization_id});}});}catch(err){logSystemError_('complianceCockpitStage39Trigger_',null,'compliance_cockpit',err);}}
function complianceCockpitStage39Tests_(){var o=[];function ok(n,c,d){o.push({name:n,status:c?'OK':'FAIL',detail:d||''});}ok('API',typeof getComplianceCockpit_==='function'&&typeof getComplianceCockpitSummary_==='function');ok('MATRIX',typeof runComplianceMatrix_==='function');ok('CAPA',typeof getCapaCases_==='function');ok('AUDIT',typeof verifyAuditEvidence35_==='function');ok('TRACE',typeof getTraceabilitySummary_==='function');ok('DQ',typeof runDataQualityAudit_==='function');ok('SCOPE',typeof _cc39Scope_==='function');ok('LIMIT',CC39_LIMIT_===500);ok('READ_ONLY',true);return o;}
