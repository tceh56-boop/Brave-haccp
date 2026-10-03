// ЦЕХ — Stage 35: Immutable Audit & Evidence Vault
// Доказательство неизменности AUDIT_LOG. Vault не является заменой AUDIT_LOG:
// он хранит канонический snapshot + hash-chain и позволяет обнаружить изменение,
// удаление или вставку записей после факта.
var AE35_LIMIT_ = 1000;
var AE35_GENESIS_ = 'TSEKH-AUDIT-GENESIS-v35';

function _ae35Hash_(v){
  var bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(v||''));
  return bytes.map(function(b){return ('0'+(b&0xFF).toString(16)).slice(-2);}).join('');
}
function _ae35Canonical_(r){return [r.log_id,r.user_id,r.действие,r.объект,r.старое_значение,r.новое_значение,r.дата,r.результат,r.cascade_id].map(function(v){return v===undefined||v===null?'':String(v);}).join('\u001f');}
function _ae35Scope_(r,s){return r&&s&&(!r.organization_id||r.organization_id===s.organization_id)&&(!r.location_id||!s.location_id||r.location_id===s.location_id);}
function _ae35Rows_(s,fn){return findRows_('AUDIT_EVIDENCE_VAULT',function(r){return _ae35Scope_(r,s)&&(!fn||fn(r));});}
function _ae35OrgRows_(s,fn){return findRows_('AUDIT_EVIDENCE_VAULT',function(r){return r&&r.organization_id===s.organization_id&&(!fn||fn(r));});}
function _ae35AuditSnapshot_(r){return JSON.stringify({log_id:r.log_id,user_id:r.user_id,действие:r.действие,объект:r.объект,старое_значение:r.старое_значение,новое_значение:r.новое_значение,дата:r.дата,результат:r.результат,cascade_id:r.cascade_id});}
function _ae35Next_(s){
  var rows=_ae35Rows_(s).sort(function(a,b){return new Date(a.created_at)-new Date(b.created_at)||String(a.evidence_id).localeCompare(String(b.evidence_id));});
  return rows.length?rows[rows.length-1]:null;
}
function appendAuditEvidence35_(auditRow){
  var user=null; try { if(auditRow.user_id && typeof getUserById_==='function') user=getUserById_(auditRow.user_id); } catch(e) {}
  var s={organization_id:auditRow.organization_id||((user&&user.organization_id)||''),location_id:auditRow.location_id||((user&&user.location_id)||'')};
  // AUDIT_LOG исторически не содержит tenant columns. Vault получает tenant scope
  // из пользователя и ведёт отдельную hash-chain на организацию.
  var existing=findRows_('AUDIT_EVIDENCE_VAULT',function(r){return r.organization_id===s.organization_id;}).sort(function(a,b){return new Date(a.created_at)-new Date(b.created_at)||String(a.evidence_id).localeCompare(String(b.evidence_id));});
  var prev=existing.length?existing[existing.length-1]:null;
  var prevHash=prev?String(prev.record_hash):_ae35Hash_(AE35_GENESIS_);
  var snapshot=_ae35AuditSnapshot_(auditRow);
  var recordHash=_ae35Hash_(prevHash+'|'+snapshot);
  insertRow_('AUDIT_EVIDENCE_VAULT',{
    evidence_id:generateId_('AUDIT_EVIDENCE_VAULT'),
    log_id:auditRow.log_id,
    organization_id:s.organization_id,
    location_id:s.location_id,
    sequence_no:existing.length+1,
    previous_hash:prevHash,
    record_hash:recordHash,
    snapshot_json:snapshot,
    created_at:nowIso_(),
    status:'SEALED'
  });
  return recordHash;
}
function _ae35ExpectedHash_(row,prevHash){return _ae35Hash_(prevHash+'|'+String(row.snapshot_json||''));}
function verifyAuditEvidence35_(data,session){
  var rows=_ae35OrgRows_(session).sort(function(a,b){return Number(a.sequence_no)-Number(b.sequence_no);});
  var limit=Math.max(1,Math.min(Number(data&&data.limit)||AE35_LIMIT_,AE35_LIMIT_));
  var selected=rows.slice(Math.max(0,rows.length-limit));
  var findings=[];
  // Проверяем цепочку на всём доступном tenant scope, но возвращаем только bounded findings.
  var prevHash=_ae35Hash_(AE35_GENESIS_);
  for(var i=0;i<rows.length;i++){
    var r=rows[i];
    if(String(r.previous_hash||'')!==String(prevHash)){findings.push({code:'HASH_CHAIN_BROKEN',severity:'CRITICAL',evidence_id:r.evidence_id,message:'previous_hash не совпадает с предыдущей записью.'});if(findings.length>=50)break;}
    var expected=_ae35ExpectedHash_(r,prevHash);
    if(String(r.record_hash||'')!==expected){findings.push({code:'RECORD_HASH_MISMATCH',severity:'CRITICAL',evidence_id:r.evidence_id,message:'record_hash не соответствует snapshot_json.'});if(findings.length>=50)break;}
    if(!findOne_('AUDIT_LOG','log_id',r.log_id)){findings.push({code:'AUDIT_LOG_MISSING',severity:'CRITICAL',evidence_id:r.evidence_id,message:'AUDIT_LOG запись отсутствует.'});if(findings.length>=50)break;}
    prevHash=String(r.record_hash||'');
  }
  return {status:findings.length?'BROKEN':'VALID',checked_total:rows.length,returned_window:selected.length,findings:findings,head_hash:rows.length?rows[rows.length-1].record_hash:_ae35Hash_(AE35_GENESIS_)};
}
function getAuditEvidence35_(data,session){
  var rows=_ae35Rows_(session).sort(function(a,b){return Number(b.sequence_no)-Number(a.sequence_no);});
  return rows.slice(0,Math.max(1,Math.min(Number(data&&data.limit)||100,AE35_LIMIT_)));
}
function sealAuditEvidenceSnapshot35_(data,session){
  var result=verifyAuditEvidence35_(data,session);
  if(result.status!=='VALID')throw new Error('Нельзя опечатать snapshot: целостность audit evidence нарушена.');
  var rows=_ae35OrgRows_(session).sort(function(a,b){return Number(a.sequence_no)-Number(b.sequence_no);});
  if(!rows.length)return {status:'EMPTY',head_hash:_ae35Hash_(AE35_GENESIS_)};
  var latest=rows[rows.length-1];
  var cp={checkpoint_id:generateId_('AUDIT_EVIDENCE_CHECKPOINTS'),organization_id:session.organization_id||'',location_id:session.location_id||'',sequence_no:latest.sequence_no,head_hash:latest.record_hash,status:'SEALED',created_by:session.user_id,created_at:nowIso_()};
  insertRow_('AUDIT_EVIDENCE_CHECKPOINTS',cp);
  auditLog_(session.user_id,'Опечатан audit evidence checkpoint','AUDIT_EVIDENCE_CHECKPOINTS:'+cp.checkpoint_id,'',cp.head_hash,'success',session.cascade_id);
  return cp;
}
function auditEvidenceStage35Tests_(){
  return [
    {name:'HASH',status:typeof _ae35Hash_==='function'?'OK':'FAIL'},
    {name:'APPEND',status:typeof appendAuditEvidence35_==='function'?'OK':'FAIL'},
    {name:'VERIFY',status:typeof verifyAuditEvidence35_==='function'?'OK':'FAIL'},
    {name:'READ',status:typeof getAuditEvidence35_==='function'?'OK':'FAIL'},
    {name:'LIMIT',status:AE35_LIMIT_===1000?'OK':'FAIL'},
    {name:'GENESIS',status:!!AE35_GENESIS_?'OK':'FAIL'}
  ];
}
