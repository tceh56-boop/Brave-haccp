/**
 * MON CHEF — Full Control Engine v3
 * Факты, реестр документов, прослеживаемость, пакет проверки,
 * отклонения/правила и безопасный Audit API.
 */

var MC_FACTS_SHEET = 'Факты';
var MC_DOC_REGISTRY_SHEET = 'DOCUMENT_REGISTRY';
var MC_RULES_SHEET = 'Правила_Автоматизации';
var MC_PACKAGE_FOLDER = 'Mon Chef — Пакеты проверки';

function _mcFullEnsureSheet_(name, headers) {
  var ss = _book_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  } else if (sh.getLastRow() === 0) sh.appendRow(headers);
  return sh;
}

function _mcFactsSheet_() {
  return _mcFullEnsureSheet_(MC_FACTS_SHEET, [
    'FactID','FactType','ObjectType','ObjectID','OperationType','DateTime',
    'EmployeeID','EmployeeName','EmployeeRole','Value','Unit','Result','Source',
    'BatchID','TTKID','CCPID','EquipmentID','DeviationID','CorrectiveActionID',
    'CreatedAt','CreatedBy','Hash','Status'
  ]);
}

function _mcDocRegistrySheet_() {
  return _mcFullEnsureSheet_(MC_DOC_REGISTRY_SHEET, [
    'DocumentID','Type','Category','Name','Version','DateFrom','DateTo','Status',
    'FileID','Hash','Signed','SignedBy','SignedAt','RelatedJournal','RelatedHACCP',
    'RelatedTTK','CreatedAt','CreatedBy','SourceDocumentID'
  ]);
}

function _mcRulesSheet_() {
  return _mcFullEnsureSheet_(MC_RULES_SHEET, [
    'RuleID','Name','EventType','ConditionJson','ActionJson','Enabled','Priority','CreatedAt'
  ]);
}

function _mcPackageFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('MC_INSPECTION_PACKAGE_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var it = DriveApp.getFoldersByName(MC_PACKAGE_FOLDER);
  var f = it.hasNext() ? it.next() : DriveApp.createFolder(MC_PACKAGE_FOLDER);
  props.setProperty('MC_INSPECTION_PACKAGE_FOLDER_ID', f.getId());
  return f;
}

function _mcSessionNameFromToken_(token) {
  try { var s = _getSession_(token); return _mcSessionFullName_(s); } catch (e) { return ''; }
}

function _mcCreateFactInternal_(fact, actor) {
  var now = new Date();
  var f = fact || {};
  var id = f.factId || ('FCT-' + Utilities.getUuid());
  var payload = JSON.stringify({
    id:id, type:f.factType || '', objectType:f.objectType || '', objectId:f.objectId || '',
    operationType:f.operationType || '', dateTime:f.dateTime || now.toISOString(),
    value:f.value == null ? '' : f.value, unit:f.unit || '', result:f.result || '',
    batchId:f.batchId || '', ttkId:f.ttkId || '', ccpId:f.ccpId || '', equipmentId:f.equipmentId || ''
  });
  var hash = _mcHashText_(payload);
  _mcFactsSheet_().appendRow([
    id, f.factType || 'OTHER', f.objectType || '', f.objectId || '', f.operationType || '',
    f.dateTime || now, f.employeeId || (actor && actor.user_id) || '',
    f.employeeName || _mcSessionFullName_(actor), f.employeeRole || (actor && actor.role) || '',
    f.value == null ? '' : f.value, f.unit || '', f.result || '', f.source || 'MON_CHEF',
    f.batchId || '', f.ttkId || '', f.ccpId || '', f.equipmentId || '', f.deviationId || '',
    f.correctiveActionId || '', now, _mcSessionFullName_(actor), hash, f.status || 'RECORDED'
  ]);
  var result = { factId:id, hash:hash, createdAt:now };
  try { if (typeof _mcCreateTraceFromFact_ === 'function') _mcCreateTraceFromFact_(result, f, actor); } catch (traceErr) { try { _log_('WARN','TRACE не создан для '+id+': '+traceErr); } catch(ignore) {} }
  // Единая точка запуска Rule Engine. Историческая миграция только строит FACT/TRACE,
  // но не создаёт новые отклонения и блокировки задним числом.
  try {
    var source = String(f.source || '');
    if (typeof _mcEvaluateFactRulesV5_ === 'function' && source.indexOf('MIGRATION:') !== 0 && f.skipRules !== true) {
      var ev = _mcEvaluateFactRulesV5_(Object.assign({}, f, result), actor, f.ruleId || f.factType || '');
      if (ev && ev.actions && ev.actions.length && typeof _mcRecordRuleEvent_ === 'function') {
        _mcRecordRuleEvent_(Object.assign({}, f, result), f.ruleId || f.factType || '', ev, actor);
      }
    }
  } catch (ruleErr) { try { _log_('WARN','RULE ENGINE не применён для '+id+': '+ruleErr); } catch(ignoreRule) {} }
  return result;
}

function createFact(json, token) {
  try {
    var s = _requireAuth_(token, 'journals');
    var f = JSON.parse(json || '{}');
    if (!f.factType) return coreErr('FACT_TYPE_REQUIRED','Не указан тип факта');
    return coreOk(_mcCreateFactInternal_(f, s));
  } catch (e) { return coreErr('FACT_CREATE_ERROR', String(e)); }
}

function getFacts(filtersJson, token) {
  try {
    _requireAuth_(token, 'journals');
    var f = {}; try { f = JSON.parse(filtersJson || '{}'); } catch (e) {}
    var v = _mcFactsSheet_().getDataRange().getValues(), out=[];
    for (var i=1;i<v.length;i++) {
      if (!v[i][0]) continue;
      if (f.factType && String(v[i][1]) !== String(f.factType)) continue;
      if (f.objectId && String(v[i][3]) !== String(f.objectId)) continue;
      if (f.batchId && String(v[i][13]) !== String(f.batchId)) continue;
      if (f.status && String(v[i][22]) !== String(f.status)) continue;
      out.push({factId:v[i][0],factType:v[i][1],objectType:v[i][2],objectId:v[i][3],operationType:v[i][4],dateTime:v[i][5],employeeName:v[i][7],employeeRole:v[i][8],value:v[i][9],unit:v[i][10],result:v[i][11],source:v[i][12],batchId:v[i][13],ttkId:v[i][14],ccpId:v[i][15],equipmentId:v[i][16],deviationId:v[i][17],correctiveActionId:v[i][18],hash:v[i][21],status:v[i][22]});
    }
    return coreOk(out.slice(-1000).reverse());
  } catch (e) { return coreErr('FACT_LIST_ERROR', String(e)); }
}

function _mcDocumentHash_(fileId, fallback) {
  if (fileId) {
    try { return _mcHashText_(Utilities.base64Encode(DriveApp.getFileById(fileId).getBlob().getBytes())); } catch (e) {}
  }
  return _mcHashText_(fallback || '');
}

function syncDocumentRegistry(token) {
  try {
    _requireAuth_(token, 'journals');
    var src = _docsSheet_().getDataRange().getValues();
    var reg = _mcDocRegistrySheet_();
    var existing = {};
    var rv = reg.getDataRange().getValues();
    for (var i=1;i<rv.length;i++) existing[String(rv[i][0])] = true;
    var added=0;
    for (var r=1;r<src.length;r++) {
      var id=src[r][0]; if (!id || existing[String(id)]) continue;
      var fileId=src[r][7] || '';
      var hash=_mcDocumentHash_(fileId, JSON.stringify(src[r]));
      reg.appendRow([id,src[r][1] || 'DOCUMENT',src[r][1],src[r][2],'1',  /* было: тип = MIME, версия = номер документа */src[r][4] || '',src[r][5] || '',src[r][5] && _parseDate_(src[r][5]) < new Date() ? 'ARCHIVED' : 'ACTIVE',fileId,hash,false,'','',src[r][6] || '','','',src[r][10] || new Date(),src[r][9] || '',id]);
      added++;
    }
    return coreOk({added:added,total:Math.max(0,reg.getLastRow()-1)});
  } catch (e) { return coreErr('DOCUMENT_REGISTRY_SYNC_ERROR',String(e)); }
}

function getInspectionDocuments(rawToken) {
  try {
    var s = _requireAuditAccess_(rawToken, 'documents');
    syncDocumentRegistryForAudit_();
    var v=_mcDocRegistrySheet_().getDataRange().getValues(), out=[];
    for(var i=1;i<v.length;i++) if(v[i][0]) {
      out.push({documentId:v[i][0],type:v[i][1],category:v[i][2],name:v[i][3],version:v[i][4],dateFrom:v[i][5],dateTo:v[i][6],status:v[i][7],fileId:v[i][8],hash:v[i][9],signed:v[i][10],signedBy:v[i][11],signedAt:v[i][12],relatedJournal:v[i][13],relatedHaccp:v[i][14],relatedTtk:v[i][15],createdAt:v[i][16],createdBy:v[i][17]});
    }
    _mcAuditAccessSheet_().appendRow([_mcUuid_(),s.sessionId,new Date(),'AUDIT_OPEN_DOCUMENTS',s.inspectorName,'DOCUMENT_REGISTRY','', '', '', 'OK']);
    return coreOk(out.reverse());
  } catch(e){return coreErr('AUDIT_DOCUMENTS_ERROR',String(e));}
}

function syncDocumentRegistryForAudit_() {
  try {
    var src=_docsSheet_().getDataRange().getValues(), reg=_mcDocRegistrySheet_(), rv=reg.getDataRange().getValues(), seen={};
    for(var i=1;i<rv.length;i++) seen[String(rv[i][0])]=true;
    for(var r=1;r<src.length;r++) if(src[r][0] && !seen[String(src[r][0])]) {
      var fileId=src[r][7] || ''; reg.appendRow([src[r][0],src[r][1] || 'DOCUMENT',src[r][1],src[r][2],'1',src[r][4] || '',src[r][5] || '','ACTIVE',fileId,_mcDocumentHash_(fileId,JSON.stringify(src[r])),false,'','',src[r][6] || '','','',src[r][10] || new Date(),src[r][9] || '',src[r][0]]);
    }
  } catch(e) {}
}

function getAuditDocument(rawToken, documentId) {
  try {
    var s=_requireAuditAccess_(rawToken,'documents');
    syncDocumentRegistryForAudit_();
    var v=_mcDocRegistrySheet_().getDataRange().getValues();
    for(var i=1;i<v.length;i++) if(String(v[i][0])===String(documentId)) {
      if(s.objectId && String(s.objectId)!=='ALL' && String(s.objectId)!==String(documentId)) return coreErr('AUDIT_SCOPE_DENIED','Документ не входит в область проверки');
      _mcAuditAccessSheet_().appendRow([_mcUuid_(),s.sessionId,new Date(),'AUDIT_OPEN_DOCUMENT',s.inspectorName,'DOCUMENT',documentId,documentId,'','OK']);
      return coreOk({documentId:v[i][0],type:v[i][1],category:v[i][2],name:v[i][3],version:v[i][4],dateFrom:v[i][5],dateTo:v[i][6],status:v[i][7],hash:v[i][9],signed:v[i][10],signedBy:v[i][11],signedAt:v[i][12]});
    }
    return coreErr('DOCUMENT_NOT_FOUND','Документ не найден');
  }catch(e){return coreErr('AUDIT_DOCUMENT_ERROR',String(e));}
}

function verifyInspectionDocument(rawToken, documentId) {
  try {
    var s=_requireAuditAccess_(rawToken,'documents');
    syncDocumentRegistryForAudit_();
    var v=_mcDocRegistrySheet_().getDataRange().getValues();
    for(var i=1;i<v.length;i++) if(String(v[i][0])===String(documentId)) {
      var actual=_mcDocumentHash_(v[i][8],JSON.stringify(v[i]));
      var valid=actual===String(v[i][9] || '');
      _mcAuditAccessSheet_().appendRow([_mcUuid_(),s.sessionId,new Date(),'AUDIT_VERIFY_DOCUMENT',s.inspectorName,'DOCUMENT',documentId,documentId,'',valid?'OK':'INVALID']);
      return coreOk({documentId:documentId,name:v[i][3],valid:valid,storedHash:v[i][9],calculatedHash:actual,status:v[i][7],version:v[i][4]});
    }
    return coreErr('DOCUMENT_NOT_FOUND','Документ не найден');
  }catch(e){return coreErr('DOCUMENT_VERIFY_ERROR',String(e));}
}

function _mcHaccpAuditSnapshot_(days) {
  var period=parseInt(days,10)||7, since=new Date(Date.now()-period*86400000);
  var journals=[], missing=[];
  (typeof JOURNALS!=='undefined'?JOURNALS:[]).forEach(function(j){
    var sh=_book_().getSheetByName(j.sheetName), count=0;
    if(sh){ var v=sh.getDataRange().getValues(); for(var i=1;i<v.length;i++){ var d=v[i][1] instanceof Date?v[i][1]:_parseDate_(v[i][1]); if(d&&d>=since) count++; }}
    journals.push({id:j.id,name:j.name,required:!!j.required,records:count});
    if(j.required&&count===0) missing.push(j.name);
  });
  var deviations=[]; try { var dv=_devSheet_().getDataRange().getValues(); for(var r=1;r<dv.length;r++) if(dv[r][0] && String(dv[r][7])!=='закрыто' && String(dv[r][7])!=='устранено') deviations.push({id:dv[r][0],journal:dv[r][2],object:dv[r][3],fact:dv[r][4],critical:dv[r][6],status:dv[r][7]}); } catch(e) {}
  return {periodDays:period,journals:journals,missingRequiredJournals:missing,openDeviations:deviations,gate:missing.length?'ЗАКРЫТ':'ОТКРЫТ'};
}

function getAuditHaccp(rawToken, days) {
  try {
    var s=_requireAuditAccess_(rawToken,'haccp');
    var data=_mcHaccpAuditSnapshot_(days);
    _mcAuditAccessSheet_().appendRow([_mcUuid_(),s.sessionId,new Date(),'AUDIT_OPEN_HACCP',s.inspectorName,'HACCP','', '', '', 'OK']);
    return coreOk(data);
  }catch(e){return coreErr('AUDIT_HACCP_ERROR',String(e));}
}

function getAuditTraceability(rawToken, batchId) {
  try {
    var s=_requireAuditAccess_(rawToken,'traceability');
    if(!batchId) return coreErr('BATCH_REQUIRED','Укажите партию');
    if(s.objectId && String(s.objectId)!=='ALL' && String(s.objectId)!==String(batchId)) return coreErr('AUDIT_SCOPE_DENIED','Партия не входит в область проверки');
    var lineage=(typeof _mcTraceGraph_==='function') ? {root:{type:'BATCH',id:String(batchId)},forward:_mcTraceGraph_('BATCH',batchId,'forward',16),reverse:_mcTraceGraph_('BATCH',batchId,'reverse',16)} : JSON.parse(getBatchLineage(batchId) || '{}');
    _mcAuditAccessSheet_().appendRow([_mcUuid_(),s.sessionId,new Date(),'AUDIT_OPEN_BATCH',s.inspectorName,'BATCH',batchId,'','', 'OK']);
    return coreOk(lineage);
  }catch(e){return coreErr('AUDIT_TRACEABILITY_ERROR',String(e));}
}

function getInspectionReadiness(rawToken) {
  try {
    var s=_requireAuditAccess_(rawToken,'read');
    var h=_mcHaccpAuditSnapshot_(30);
    syncDocumentRegistryForAudit_();
    var dv=_mcDocRegistrySheet_().getDataRange().getValues(), expired=[];
    var now=new Date();
    for(var i=1;i<dv.length;i++){ if(!dv[i][0]) continue; var till=dv[i][6] instanceof Date?dv[i][6]:_parseDate_(dv[i][6]); if(till&&till<now) expired.push({id:dv[i][0],name:dv[i][3],dateTo:dv[i][6]}); }
    var sv=_mcSignatureSheet_().getDataRange().getValues(), unsignedRequired=0;
    var signedKeys={}; for(var j=1;j<sv.length;j++) if(sv[j][14]==='SIGNED') signedKeys[String(sv[j][1])+'|'+String(sv[j][3])+'|'+String(sv[j][4])]=true;
    (JOURNALS||[]).forEach(function(jr){ if(jr.required && !signedKeys[String(jr.id)+'|'+Utilities.formatDate(new Date(new Date().getFullYear(),new Date().getMonth(),1),_mcTz_(),'yyyy-MM-dd')]) unsignedRequired++; });
    var items=[{name:'Обязательные журналы',ok:h.missingRequiredJournals.length===0,detail:h.missingRequiredJournals.length?'Нет записей: '+h.missingRequiredJournals.join('; '):'Записи найдены'},
      {name:'Открытые отклонения',ok:h.openDeviations.length===0,detail:h.openDeviations.length?'Открыто: '+h.openDeviations.length:'Нет открытых'},
      {name:'Просроченные документы',ok:expired.length===0,detail:expired.length?'Просрочено: '+expired.length:'Нет просроченных'}];
    _mcAuditAccessSheet_().appendRow([_mcUuid_(),s.sessionId,new Date(),'AUDIT_READINESS',s.inspectorName,'READINESS','', '', '', 'OK']);
    return coreOk({ready:items.every(function(x){return x.ok}),items:items,periodDays:30});
  }catch(e){return coreErr('READINESS_ERROR',String(e));}
}

function getAuditDashboard(rawToken) {
  try {
    var s=_requireAuditAccess_(rawToken,'read');
    var journals=[];
    (typeof JOURNALS!=='undefined'?JOURNALS:[]).forEach(function(j){
      var sh=_book_().getSheetByName(j.sheetName); var count=sh?Math.max(0,sh.getLastRow()-1):0;
      journals.push({id:j.id,name:j.name,category:j.category,required:!!j.required,records:count});
    });
    var signatures=[]; try { var sv=_mcSignatureSheet_().getDataRange().getValues(); for(var si=1;si<sv.length;si++) if(sv[si][0]) signatures.push({signatureId:sv[si][0],journalId:sv[si][1],journalName:sv[si][2],periodFrom:sv[si][3],periodTo:sv[si][4],recordCount:sv[si][6],signedBy:sv[si][8],signedByRole:sv[si][9],signedAt:sv[si][10],status:sv[si][14],verificationCode:sv[si][16]}); } catch(e) {}
    var docs=[]; try { syncDocumentRegistryForAudit_(); var dv=_mcDocRegistrySheet_().getDataRange().getValues(); docs=dv.slice(1).filter(function(r){return r[0];}).map(function(r){return {id:r[0],name:r[3],status:r[7],version:r[4],hash:r[9]};}); } catch(e) {}
    var dev=[]; try { var vv=_devSheet_().getDataRange().getValues(); dev=vv.slice(1).filter(function(r){return r[0] && String(r[7])!=='закрыто' && String(r[7])!=='устранено';}).map(function(r){return {id:r[0],journal:_journalName_(r[2]),object:r[3],fact:r[4],critical:r[6],status:r[7],when:r[11]};}); }catch(e){}
    _mcAuditAccessSheet_().appendRow([_mcUuid_(),s.sessionId,new Date(),'AUDIT_DASHBOARD',s.inspectorName,'DASHBOARD','', '', '', 'OK']);
    return coreOk({organization:'MON CHEF',sessionId:s.sessionId,inspector:s.inspectorName,expiresAt:s.expiresAt,journals:journals,signatures:signatures,dataDocuments:docs,openDeviations:dev});
  }catch(e){return coreErr('AUDIT_DASHBOARD_ERROR',String(e));}
}

function _mcBuildJournalCsv_(j) {
  var sh=_book_().getSheetByName(j.sheetName); if(!sh) return null;
  var v=sh.getDataRange().getDisplayValues();
  return v.map(function(row){return row.map(function(x){var s=String(x==null?'':x).replace(/"/g,'""');return '"'+s+'"';}).join(';');}).join('\r\n');
}


function _mcHtmlEsc_(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

function _mcJournalSnapshotPdf_(j){
  var sh=_book_().getSheetByName(j.sheetName); if(!sh) return null;
  var rows=sh.getDataRange().getDisplayValues();
  var sig=null; try { var sv=_mcSignatureSheet_().getDataRange().getValues(); for(var i=sv.length-1;i>=1;i--) if(String(sv[i][1])===String(j.id)&&String(sv[i][14])==='SIGNED'){sig={name:sv[i][2],from:sv[i][3],to:sv[i][4],by:sv[i][8],role:sv[i][9],at:sv[i][10],hash:sv[i][12],code:sv[i][16]};break;} } catch(e){}
  var html='<html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;font-size:8px}h1{font-size:15px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:3px;vertical-align:top}th{background:#eee}.meta{font-size:9px;margin:6px 0}</style></head><body>';
  html+='<h1>'+_mcHtmlEsc_(j.name)+'</h1><div class="meta">Технический ID: '+_mcHtmlEsc_(j.id)+' · записей: '+Math.max(0,rows.length-1)+'</div>';
  if(sig) html+='<div class="meta"><b>Подписан:</b> '+_mcHtmlEsc_(sig.by)+' · '+_mcHtmlEsc_(sig.role)+' · '+_mcHtmlEsc_(String(sig.at))+' · период '+_mcHtmlEsc_(sig.from)+' — '+_mcHtmlEsc_(sig.to)+' · код '+_mcHtmlEsc_(sig.code)+' · hash '+_mcHtmlEsc_(sig.hash)+'</div>';
  html+='<table><thead><tr>'+rows[0].map(_mcHtmlEsc_).map(function(x){return '<th>'+x+'</th>';}).join('')+'</tr></thead><tbody>';
  for(var r=1;r<rows.length;r++) html+='<tr>'+rows[r].map(_mcHtmlEsc_).map(function(x){return '<td>'+x+'</td>';}).join('')+'</tr>';
  html+='</tbody></table></body></html>';
  return Utilities.newBlob(html,'text/html',j.name+'.html').getAs('application/pdf').setName(j.name+'.pdf');
}

function createInspectionPackage(token) {
  var manifest_readiness=null;
  try {
    var _pkS=_requireAuth_(token,'audit_create');
    var folder=_mcPackageFolder_();
    // в пакет идёт актуальный прогон готовности (R01–R18), а не устаревший
    try { manifest_readiness=_mcReadinessRecord_(_pkS); } catch(rdErr) { manifest_readiness=null; }
    syncDocumentRegistry(token);
    var stamp=Utilities.formatDate(new Date(),_mcTz_(),'yyyy-MM-dd_HH-mm-ss');
    var manifest={readiness:manifest_readiness?{runId:manifest_readiness.runId,overall:manifest_readiness.overall,counts:manifest_readiness.counts}:null,packageVersion:'1.0',createdAt:new Date().toISOString(),createdBy:_mcSessionNameFromToken_(token),organization:'MON CHEF',journals:[],documents:[],signatures:[],files:[]};
    var blobs=[];
    (typeof JOURNALS!=='undefined'?JOURNALS:[]).forEach(function(j){
      var csv=_mcBuildJournalCsv_(j); if(csv==null)return;
      var b=Utilities.newBlob(csv,'text/csv',j.name+'.csv'); blobs.push(b);
      manifest.files.push({name:b.getName(),type:'journal_csv',hash:_mcHashText_(csv)});
      try { var pdf=_mcJournalSnapshotPdf_(j); if(pdf){blobs.push(pdf);manifest.files.push({name:pdf.getName(),type:'journal_snapshot_pdf',hash:_mcHashText_(Utilities.base64Encode(pdf.getBytes()))});} } catch(e) {}
      manifest.journals.push({id:j.id,name:j.name,records:Math.max(0,(_book_().getSheetByName(j.sheetName)||{getLastRow:function(){return 1;}}).getLastRow()-1),internalCode:j.id});
    });
    try { var sv=_mcSignatureSheet_().getDataRange().getValues(); for(var si=1;si<sv.length;si++) if(sv[si][0]) manifest.signatures.push({signatureId:sv[si][0],journalId:sv[si][1],journalName:sv[si][2],periodFrom:sv[si][3],periodTo:sv[si][4],signedBy:sv[si][8],signedByRole:sv[si][9],signedAt:sv[si][10],status:sv[si][14],hash:sv[si][12],verificationCode:sv[si][16]}); } catch(e) {}
    var rv=_mcDocRegistrySheet_().getDataRange().getValues();
    for(var i=1;i<rv.length;i++) if(rv[i][0]) {
      var rec={documentId:rv[i][0],name:rv[i][3],version:rv[i][4],status:rv[i][7],hash:rv[i][9],fileId:rv[i][8]}; manifest.documents.push(rec);
      if(rv[i][8]) { try { var file=DriveApp.getFileById(rv[i][8]); var db=file.getBlob().setName('documents/'+file.getName()); blobs.push(db); manifest.files.push({name:db.getName(),type:'document',hash:_mcHashText_(Utilities.base64Encode(db.getBytes())),documentId:rv[i][0]}); } catch(e) {} }
    }
    // V5: отдельные машинно-читаемые следы прослеживаемости и автоматических действий.
    try {
      if (typeof _mcSyncBatchRelationsToTrace_ === 'function') _mcSyncBatchRelationsToTrace_();
      var tv = _mcTraceSheet_().getDataRange().getDisplayValues();
      var tcsv = tv.map(function(row){return row.map(function(x){var z=String(x==null?'':x).replace(/"/g,'""');return '"'+z+'"';}).join(';');}).join('\r\n');
      var tb=Utilities.newBlob(tcsv,'text/csv','TRACEABILITY.csv'); blobs.push(tb); manifest.files.push({name:'TRACEABILITY.csv',type:'traceability',hash:_mcHashText_(tcsv)});
      var dv5=_devSheet_().getDataRange().getDisplayValues();
      var dvcsv=dv5.map(function(row){return row.map(function(x){var z=String(x==null?'':x).replace(/"/g,'""');return '"'+z+'"';}).join(';');}).join('\r\n');
      var db=Utilities.newBlob(dvcsv,'text/csv','DEVIATIONS.csv'); blobs.push(db); manifest.files.push({name:'DEVIATIONS.csv',type:'deviations',hash:_mcHashText_(dvcsv)});
      var cv5=_corrSheet_().getDataRange().getDisplayValues();
      var ccsv=cv5.map(function(row){return row.map(function(x){var z=String(x==null?'':x).replace(/"/g,'""');return '"'+z+'"';}).join(';');}).join('\r\n');
      var cb=Utilities.newBlob(ccsv,'text/csv','CORRECTIVE_ACTIONS.csv'); blobs.push(cb); manifest.files.push({name:'CORRECTIVE_ACTIONS.csv',type:'corrective_actions',hash:_mcHashText_(ccsv)});
      var rv5=_mcRuleEventsSheet_().getDataRange().getDisplayValues();
      var rcsv=rv5.map(function(row){return row.map(function(x){var z=String(x==null?'':x).replace(/"/g,'""');return '"'+z+'"';}).join(';');}).join('\r\n');
      var rb=Utilities.newBlob(rcsv,'text/csv','RULE_EVENTS.csv'); blobs.push(rb); manifest.files.push({name:'RULE_EVENTS.csv',type:'rule_events',hash:_mcHashText_(rcsv)});
      var bv5=_mcBlocksSheet_().getDataRange().getDisplayValues();
      var bcsv=bv5.map(function(row){return row.map(function(x){var z=String(x==null?'':x).replace(/"/g,'""');return '"'+z+'"';}).join(';');}).join('\r\n');
      var bb=Utilities.newBlob(bcsv,'text/csv','BLOCKS.csv'); blobs.push(bb); manifest.files.push({name:'BLOCKS.csv',type:'blocks',hash:_mcHashText_(bcsv)});
    } catch(tracePackageErr) { manifest.traceabilityExportError=String(tracePackageErr); }
    // Разделы пакета по ТЗ §33: каждый лист — отдельный CSV с хешем; пустой/отсутствующий раздел явно помечается в манифесте
    manifest.sections=[];
    var SECTIONS=[['READINESS','Готовность по контрольному листу','Готовность_Проверки'],['NORMATIVE','Нормативная база','Нормативы_V33'],['NORMATIVE_REQ','Нормативные требования','Требования_V33'],
      ['PPK','ППК','ППК_V30'],['HACCP_PROCESS','HACCP процессы','HACCP_Процессы_V30'],['HACCP_HAZARD','HACCP опасности','HACCP_Опасности_V30'],['HACCP_CCP','HACCP ККТ','HACCP_ТочкиКонтроля_V30'],
      ['HACCP_MONITORING','HACCP мониторинг','HACCP_Мониторинг_V30'],['HACCP_FACTS','HACCP факты','HACCP_Факты_V31'],['FACTS','Факты (FACT)',typeof MC_FACTS_SHEET!=='undefined'?MC_FACTS_SHEET:'Факты'],
      ['INCOMING','Входной контроль сырья','Входной_Контроль'],['BATCH_RELEASE','Допуск и бракераж партий','Выпуск_Партий'],['STOCK_BATCHES','Склад: партии','Склад_Партии'],
      ['DAILY_SAMPLES','Суточные пробы','Суточные_Пробы'],['MEDBOOKS','Медкнижки','Медкнижки'],['LAB_PLAN','Лаборатория: план','Лаборатория_План'],['LAB_TESTS','Лаборатория: исследования','Лаборатория_Исследования'],
      ['EQUIPMENT','Оборудование и поверка','Оборудование_Реестр'],['DISINFECTANTS','Дезсредства','Дезсредства_V41'],['DS_REGIMES','Режимы дезсредств','Дезсредства_Режимы_V41'],['DS_FACTS','Контроль дезрастворов','Дезсредства_Факты_V41'],
      ['PESTS','Дезинсекция и дератизация (журнал 3-Д)','Ж_Дезинсекция_Дератизация'],['PEST_PLAN','Вредители: план и договоры','Вредители_План'],['PEST_EVENTS','Вредители: осмотры и обработки','Вредители_Мероприятия'],['WASTE','Отходы','Отходы'],['WATER_SOURCES','Вода: источники','Вода_Источники'],['WATER_PLAN','Вода: план контроля','Вода_План'],['WATER','Вода: результаты','Вода_Контроль'],['SUPPLY_DOCS','Документы на сырьё','Документы_Сырьё'],['VET','Ветеринарные документы (ВСД)','ВСД'],['VET_PRODUCTS','Ветконтроль: подконтрольные продукты','Ветконтроль_Продукты'],['MARKING','Маркировка','Маркировка'],['TEMPERATURES','Температуры (единый реестр)','Температуры'],['TEMP_OBJECTS','Температурные объекты','Температурные_Объекты'],['CORRECTIONS','Запросы на исправление','Корректировки'],['AUDIT','Журнал аудита','Audit_Log'],['BACKUP','Резервные копии и учения','Резерв_Восстановление']];
    SECTIONS.forEach(function(sec){
      var sh=_book_().getSheetByName(sec[2]);
      if(!sh||sh.getLastRow()<2){manifest.sections.push({code:sec[0],title:sec[1],sheet:sec[2],status:'NO_DATA',records:0,note:'Данные не внесены — раздел пуст в пакете'});return;}
      var vv=sh.getDataRange().getDisplayValues();
      var csv=vv.map(function(row){return row.map(function(x){var z=String(x==null?'':x).replace(/"/g,'""');return '"'+z+'"';}).join(';');}).join('\r\n');
      var nm=sec[0]+'_'+sec[2]+'.csv',bl=Utilities.newBlob(csv,'text/csv',nm);blobs.push(bl);
      var h=_mcHashText_(csv);manifest.files.push({name:nm,type:'section',hash:h});manifest.sections.push({code:sec[0],title:sec[1],sheet:sec[2],status:'INCLUDED',records:vv.length-1,hash:h});
    });
    manifest.note='Комплект документов по внутреннему контрольному листу. Подписи — внутренние подписи системы (INTERNAL_SIGNATURE), не квалифицированная ЭП.';
    var manifestBlob=Utilities.newBlob(JSON.stringify(manifest,null,2),'application/json','MANIFEST.json'); blobs.push(manifestBlob); manifest.files.push({name:'MANIFEST.json',type:'manifest'});
    var zip=Utilities.zip(blobs,'MON_CHEF_ПАКЕТ_ПРОВЕРКИ_'+stamp+'.zip');
    var file=folder.createFile(zip);
    try { _audit_({session:_getSession_(token),tenant:_defaultTenant_(),id:file.getId(),type:'INSPECTION_PACKAGE'},'INSPECTION_PACKAGE_CREATE','Проверка',file.getName(),null,{fileId:file.getId(),count:blobs.length}); } catch(e) {}
    return coreOk({fileId:file.getId(),url:file.getUrl(),name:file.getName(),manifest:manifest});
  }catch(e){return coreErr('INSPECTION_PACKAGE_ERROR',String(e));}
}

function getAuditInspectionPackage(rawToken) {
  try {
    var s=_requireAuditAccess_(rawToken,'download');
    return coreOk({allowed:true,message:'Пакет проверки доступен для скачивания через отдельное разрешение.'});
  }catch(e){return coreErr('AUDIT_PACKAGE_FORBIDDEN',String(e));}
}

function evaluateFactRules(fact, token) {
  try {
    var actor=token?_requireAuth_(token,'journals'):null;
    var f=typeof fact==='string'?JSON.parse(fact):fact||{};
    var actions=[];
    if(f.result==='ОТКЛОНЕНИЕ' || f.result==='отклонение' || f.isDeviation===true) {
      var devId='DV-'+Date.now()+'-'+Math.floor(Math.random()*1000);
      try { _devSheet_().appendRow([devId,'',f.journalId||f.objectId||'',f.objectId||'',f.description||f.fact||'',f.value||'',!!f.critical,'открыто','', '', _mcSessionFullName_(actor),new Date(),'','']); } catch(e) {}
      actions.push({type:'CREATE_DEVIATION',id:devId});
      if(f.critical===true) actions.push({type:'BLOCK_OBJECT',objectId:f.batchId||f.objectId||''});
    }
    return coreOk({actions:actions});
  }catch(e){return coreErr('RULE_ENGINE_ERROR',String(e));}
}
