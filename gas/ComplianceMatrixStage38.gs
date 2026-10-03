// ЦЕХ — Stage 38: Compliance Control Matrix.
// Control -> Requirement -> Evidence -> Finding -> CAPA -> Verification.
// Реестр не изменяет первичные хозяйственные данные.
var CM38_LIMIT_=500;
var CM38_STATUSES_=['ACTIVE','INACTIVE'];
var CM38_LINK_TYPES_=['EVIDENCE','FINDING','CAPA','VERIFICATION','REQUIREMENT'];
function _cm38Now_(){return nowIso_();}
function _cm38Scope_(r,s){return r&&r.organization_id===s.organization_id&&(!r.location_id||!s.location_id||r.location_id===s.location_id);}
function _cm38Req_(v,m){if(v===undefined||v===null||String(v).trim()==='')throw new Error(m);return String(v).trim();}
function _cm38Control_(id,s){var r=findOne_('COMPLIANCE_CONTROLS','control_id',String(id||''));if(!r||!_cm38Scope_(r,s))throw new Error('Контроль не найден.');return r;}
function _cm38Links_(id,s){return findRows_('COMPLIANCE_CONTROL_LINKS',function(r){return r.control_id===id&&_cm38Scope_(r,s);}).slice(0,CM38_LIMIT_);}
function _cm38Seed_(){return [
 {code:'DQ.MASTER_DATA',title:'Качество master-data',requirement:'Дубли и нарушения master-data должны быть выявлены и иметь управляемое состояние.',category:'DATA_QUALITY',owner_role:'ДИРЕКТОР',frequency:'DAILY'},
 {code:'TRACE.BATCH',title:'Сквозная трассируемость партий',requirement:'Партия должна прослеживаться через склад, производство, отходы и реализацию.',category:'TRACEABILITY',owner_role:'КЛАДОВЩИК',frequency:'DAILY'},
 {code:'TRACE.RECON',title:'Сверка трассируемости',requirement:'Расхождения цепочки партии должны быть выявлены до закрытия периода.',category:'TRACEABILITY',owner_role:'ДИРЕКТОР',frequency:'PERIOD'},
 {code:'CLOSE.PERIOD',title:'Контроль закрытия периода',requirement:'Период закрывается только при отсутствии блокирующих расхождений.',category:'PERIOD_CLOSE',owner_role:'ДИРЕКТОР',frequency:'MONTHLY'},
 {code:'LOCK.PERIOD',title:'Блокировка закрытого периода',requirement:'Изменения закрытого периода допускаются только через контролируемое reopening.',category:'PERIOD_LOCK',owner_role:'ДИРЕКТОР',frequency:'CONTINUOUS'},
 {code:'AUDIT.INTEGRITY',title:'Целостность audit evidence',requirement:'Hash-chain аудита должна проходить проверку целостности.',category:'AUDIT',owner_role:'ДИРЕКТОР',frequency:'DAILY'},
 {code:'EVIDENCE.PACK',title:'Доказательный пакет периода',requirement:'Закрытый период должен иметь проверяемый evidence pack.',category:'COMPLIANCE',owner_role:'ДИРЕКТОР',frequency:'PERIOD'},
 {code:'CAPA.CLOSURE',title:'CAPA и проверка эффективности',requirement:'Критические findings должны иметь CAPA с verification перед закрытием.',category:'CAPA',owner_role:'ДИРЕКТОР',frequency:'CONTINUOUS'},
 {code:'HACCP.EVIDENCE',title:'Доказательства HACCP',requirement:'Критические HACCP-контроли должны иметь evidence и обработанные отклонения.',category:'HACCP',owner_role:'ШЕФ-ПОВАР',frequency:'DAILY'}
];}
function seedComplianceControls_(s){
 var created=0,seed=_cm38Seed_();seed.forEach(function(x){var ex=findRows_('COMPLIANCE_CONTROLS',function(r){return _cm38Scope_(r,s)&&r.code===x.code;});if(!ex.length){var row={control_id:generateId_('COMPLIANCE_CONTROLS'),organization_id:s.organization_id,location_id:s.location_id||'',code:x.code,title:x.title,requirement:x.requirement,category:x.category,owner_role:x.owner_role,frequency:x.frequency,status:'ACTIVE',source:'STAGE38',version:'1',created_by:s.user_id,created_at:_cm38Now_(),updated_at:_cm38Now_()};insertRow_('COMPLIANCE_CONTROLS',row);created++;}});return created;}
function createComplianceControl_(data,s){
 if(!s||!s.organization_id)throw new Error('Сессия организации обязательна.');
 var code=_cm38Req_(data.code,'code обязателен.').toUpperCase();var dup=findRows_('COMPLIANCE_CONTROLS',function(r){return _cm38Scope_(r,s)&&String(r.code||'').toUpperCase()===code;});if(dup.length)return {control:dup[0],created:false,duplicate:true};
 var row={control_id:generateId_('COMPLIANCE_CONTROLS'),organization_id:s.organization_id,location_id:s.location_id||'',code:code,title:_cm38Req_(data.title,'title обязателен.'),requirement:_cm38Req_(data.requirement,'requirement обязателен.'),category:String(data.category||'GENERAL').toUpperCase(),owner_role:String(data.ownerRole||'ДИРЕКТОР'),frequency:String(data.frequency||'CONTINUOUS').toUpperCase(),status:String(data.status||'ACTIVE').toUpperCase(),source:String(data.source||'MANUAL'),version:String(data.version||'1'),created_by:s.user_id,created_at:_cm38Now_(),updated_at:_cm38Now_()};
 if(CM38_STATUSES_.indexOf(row.status)<0)throw new Error('Недопустимый статус контроля.');insertRow_('COMPLIANCE_CONTROLS',row);auditLog_(s.user_id,'Создан compliance control','COMPLIANCE_CONTROLS:'+row.control_id,'',row.code,'success',s.cascade_id||'');return {control:row,created:true};
}
function linkComplianceControl_(data,s){
 var c=_cm38Control_(data.controlId,s),type=_cm38Req_(data.linkType,'linkType обязателен.').toUpperCase();if(CM38_LINK_TYPES_.indexOf(type)<0)throw new Error('Недопустимый тип связи.');
 var sourceType=_cm38Req_(data.sourceType,'sourceType обязателен.'),sourceId=_cm38Req_(data.sourceId,'sourceId обязателен.');var dup=findRows_('COMPLIANCE_CONTROL_LINKS',function(r){return _cm38Scope_(r,s)&&r.control_id===c.control_id&&r.link_type===type&&r.source_type===sourceType&&r.source_id===sourceId;});if(dup.length)return {link:dup[0],created:false,duplicate:true};
 var row={link_id:generateId_('COMPLIANCE_CONTROL_LINKS'),control_id:c.control_id,organization_id:s.organization_id,location_id:s.location_id||'',link_type:type,source_type:sourceType,source_id:sourceId,source_code:String(data.sourceCode||''),status:'ACTIVE',note:String(data.note||''),evidence_json:JSON.stringify(data.evidence||{}),created_by:s.user_id,created_at:_cm38Now_()};insertRow_('COMPLIANCE_CONTROL_LINKS',row);auditLog_(s.user_id,'Связан compliance control','COMPLIANCE_CONTROL_LINKS:'+row.link_id,'',c.code+' -> '+sourceType+':'+sourceId,'success',s.cascade_id||'');return {link:row,created:true};
}
function getComplianceControls_(data,s){seedComplianceControls_(s);var status=String(data&&data.status||'');var category=String(data&&data.category||'').toUpperCase();var rows=findRows_('COMPLIANCE_CONTROLS',function(r){return _cm38Scope_(r,s)&&(!status||r.status===status)&&(!category||r.category===category);});rows.sort(function(a,b){return String(a.code).localeCompare(String(b.code));});return {controls:rows.slice(0,CM38_LIMIT_),total:rows.length,generated_at:_cm38Now_()};}
function getComplianceControl_(data,s){var c=_cm38Control_(data.controlId,s);return {control:c,links:_cm38Links_(c.control_id,s)};}
function _cm38Assess_(c,links){
 var findings=links.filter(function(x){return x.link_type==='FINDING'&&x.status!=='CLOSED';}).length;
 var capas=links.filter(function(x){return x.link_type==='CAPA'&&['CLOSED','REJECTED'].indexOf(x.status)<0;}).length;
 var evidence=links.filter(function(x){return x.link_type==='EVIDENCE';}).length;
 var verification=links.filter(function(x){return x.link_type==='VERIFICATION'&&String(x.status).toUpperCase()==='PASS';}).length;
 var status='NO_EVIDENCE',severity=findings?'HIGH':'NONE';
 if(findings)status=capas?'REMEDIATION_OPEN':'FINDING_OPEN';else if(evidence||verification)status='SUPPORTED';
 return {control_id:c.control_id,code:c.code,status:status,severity:severity,evidence_count:evidence,finding_count:findings,open_capa_count:capas,verification_count:verification,link_count:links.length};
}
function runComplianceMatrix_(data,s){
 if(!s||!s.organization_id)throw new Error('Сессия организации обязательна.');seedComplianceControls_(s);var controls=findRows_('COMPLIANCE_CONTROLS',function(r){return _cm38Scope_(r,s)&&r.status==='ACTIVE';}).slice(0,CM38_LIMIT_);var results=controls.map(function(c){return _cm38Assess_(c,_cm38Links_(c.control_id,s));});var counts={total:results.length,supported:0,findings:0,remediation:0,no_evidence:0};results.forEach(function(r){if(r.status==='SUPPORTED')counts.supported++;else if(r.status==='FINDING_OPEN')counts.findings++;else if(r.status==='REMEDIATION_OPEN')counts.remediation++;else counts.no_evidence++;});return {generated_at:_cm38Now_(),organization_id:s.organization_id,location_id:s.location_id||'',summary:counts,controls:results};}
function getComplianceMatrixSummary_(data,s){var r=runComplianceMatrix_(data||{},s);return {generated_at:r.generated_at,organization_id:r.organization_id,location_id:r.location_id,summary:r.summary};}
function complianceMatrixStage38Tests_(){var o=[];function ok(n,c,d){o.push({name:n,status:c?'OK':'FAIL',detail:d||''});}ok('SCHEMA',Array.isArray(CONFIG.SCHEMA.COMPLIANCE_CONTROLS)&&Array.isArray(CONFIG.SCHEMA.COMPLIANCE_CONTROL_LINKS));ok('SHEETS',CONFIG.SHEETS.COMPLIANCE_CONTROLS==='COMPLIANCE_CONTROLS'&&CONFIG.SHEETS.COMPLIANCE_CONTROL_LINKS==='COMPLIANCE_CONTROL_LINKS');ok('IDS',CONFIG.ID_PREFIXES.COMPLIANCE_CONTROLS==='CTRL'&&CONFIG.ID_PREFIXES.COMPLIANCE_CONTROL_LINKS==='CLNK');ok('API',typeof createComplianceControl_==='function'&&typeof linkComplianceControl_==='function'&&typeof runComplianceMatrix_==='function');ok('SEED',_cm38Seed_().length===9);ok('LINK_TYPES',CM38_LINK_TYPES_.indexOf('CAPA')>=0&&CM38_LINK_TYPES_.indexOf('VERIFICATION')>=0);ok('SCOPE',typeof _cm38Scope_==='function');ok('BOUNDED',CM38_LIMIT_===500);return o;}
