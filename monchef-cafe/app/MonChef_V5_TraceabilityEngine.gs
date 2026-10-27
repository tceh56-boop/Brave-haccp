/**
 * MON CHEF V5 — Canonical Traceability + Rule Engine
 *
 * Принцип:
 *   FACT / BatchRelations / операции -> TRACE_LINKS -> forward/reverse trace.
 *   Правило -> RULE_EVENTS -> Deviation -> CorrectiveAction -> Block (если требуется).
 *
 * Блокировка всегда адресная: партия / объект / оборудование, а не вся система.
 */

var MC_TRACE_SHEET = 'TRACE_LINKS';
var MC_RULE_EVENTS_SHEET = 'RULE_EVENTS';
var MC_BLOCKS_SHEET = 'Блокировки';

function _mcTraceSheet_() {
  return _mcFullEnsureSheet_(MC_TRACE_SHEET, [
    'LinkID','FromType','FromID','Relation','ToType','ToID','FactID','DateTime',
    'Actor','Source','Weight','Unit','Status','Hash'
  ]);
}

function _mcRuleEventsSheet_() {
  return _mcFullEnsureSheet_(MC_RULE_EVENTS_SHEET, [
    'EventID','RuleID','FactID','EventType','Severity','ObjectType','ObjectID','BatchID',
    'DeviationID','CorrectiveActionID','BlockID','Message','CreatedAt','CreatedBy','Status','Hash'
  ]);
}

function _mcBlocksSheet_() {
  return _mcFullEnsureSheet_(MC_BLOCKS_SHEET, [
    'BlockID','ObjectType','ObjectID','Reason','FactID','DeviationID','RuleID','CreatedAt',
    'CreatedBy','Status','ReleasedAt','ReleasedBy','ReleaseReason'
  ]);
}

function _mcTraceHash_(row) {
  return _mcHashText_(JSON.stringify(row));
}

function _mcCreateTraceLink_(fromType, fromId, relation, toType, toId, meta) {
  if (!fromId || !toId) return null;
  meta = meta || {};
  var sh = _mcTraceSheet_();
  // Нагрузочный сценарий: проверка «такая связь уже есть» читала весь лист на КАЖДУЮ связь (приёмка накладной — 14 раз
  // под общей блокировкой, а лист связей самый быстрорастущий). Теперь ключи читаются один раз и живут, пока жив кэш
  // чтения выполнения: взятие блокировки (_withLock_) его сбрасывает — внутри критической секции ключи свежие.
  var K = _LOCK_DEPTH > 0 ? _MC_RC_['#TRACE_KEYS'] : null;
  if (!K) {
    K = {}; var rows = sh.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) { var k0 = _mcTraceKey_(rows[i][1], rows[i][2], rows[i][3], rows[i][4], rows[i][5], rows[i][6]); if (!(k0 in K)) K[k0] = rows[i][0]; }
    if (_LOCK_DEPTH > 0) _MC_RC_['#TRACE_KEYS'] = K;   // вне блокировки другие могут дописать связь — ключи не запоминаются
  }
  var key = _mcTraceKey_(fromType, fromId, relation, toType, toId, meta.factId);
  if (key in K) return K[key];
  var id = 'TRL-' + Utilities.getUuid();
  var now = new Date();
  var row = [id,fromType,fromId,relation,toType,toId,meta.factId || '',meta.dateTime || now,
    meta.actor || '',meta.source || 'MON_CHEF',meta.weight == null ? '' : meta.weight,
    meta.unit || '',meta.status || 'ACTIVE',''];
  row[13] = _mcTraceHash_(row.slice(0,13));
  sh.appendRow(row);
  K[key] = id;
  return id;
}
function _mcTraceKey_(fromType, fromId, relation, toType, toId, factId) {
  return [fromType, fromId, relation, toType, toId, factId || ''].map(function (x) { return String(x === null || x === undefined ? '' : x); }).join('\u241F');
}

function _mcCreateTraceFromFact_(factResult, fact, actor) {
  if (!factResult || !factResult.factId || !fact) return;
  var fid = factResult.factId;
  var actorName = actor ? _mcSessionFullName_(actor) : (fact.employeeName || '');
  var base = {factId:fid, dateTime:fact.dateTime || new Date(), actor:actorName, source:fact.source || 'FACT'};
  if (fact.batchId) {
    _mcCreateTraceLink_('FACT', fid, 'ПРИСВОЕНА_ПАРТИЯ', 'BATCH', String(fact.batchId), base);
  }
  if (fact.ttkId) {
    _mcCreateTraceLink_('FACT', fid, 'ПО_ТТК', 'TTK', String(fact.ttkId), base);
  }
  if (fact.ccpId) {
    _mcCreateTraceLink_('FACT', fid, 'ККТ', 'CCP', String(fact.ccpId), base);
  }
  if (fact.equipmentId) {
    _mcCreateTraceLink_('FACT', fid, 'ОБОРУДОВАНИЕ', 'EQUIPMENT', String(fact.equipmentId), base);
  }
  if (fact.objectId) {
    _mcCreateTraceLink_('FACT', fid, 'ОБЪЕКТ', String(fact.objectType || 'OBJECT').toUpperCase(), String(fact.objectId), base);
  }
  if (fact.journalId) {
    _mcCreateTraceLink_('JOURNAL', String(fact.journalId), 'ЗАПИСЬ_ФАКТА', 'FACT', fid, base);
  }
}

function _mcSyncBatchRelationsToTrace_() {
  var sh = _batchRelationsSheet_();
  var v = sh.getDataRange().getValues();
  var added = 0;
  for (var i = 1; i < v.length; i++) {
    if (!v[i][0] || !v[i][1] || String(v[i][1]) === '(отход)') continue;
    var before = _mcTraceSheet_().getLastRow();
    _mcCreateTraceLink_('BATCH',String(v[i][0]),'ПРЕОБРАЗОВАНА_В','BATCH',String(v[i][1]),{
      dateTime:v[i][3] || new Date(), actor:v[i][5] || '', source:v[i][4] || 'BatchRelations',
      weight:v[i][2] || '', unit:''
    });
    if (_mcTraceSheet_().getLastRow() > before) added++;
  }
  return added;
}

function _mcTraceGraph_(rootType, rootId, direction, maxDepth) {
  maxDepth = maxDepth || 12;
  _mcSyncBatchRelationsToTrace_();
  var sh = _mcTraceSheet_();
  var v = sh.getDataRange().getValues();
  var edges = [];
  for (var i = 1; i < v.length; i++) {
    if (!v[i][0]) continue;
    edges.push({linkId:v[i][0],fromType:v[i][1],fromId:String(v[i][2]),relation:v[i][3],toType:v[i][4],toId:String(v[i][5]),factId:v[i][6],dateTime:v[i][7],actor:v[i][8],source:v[i][9],weight:v[i][10],unit:v[i][11],status:v[i][12],hash:v[i][13]});
  }
  var out = [], queue = [{type:String(rootType),id:String(rootId),depth:0}], seen = {};
  seen[String(rootType)+'|'+String(rootId)] = true;
  while (queue.length) {
    var cur = queue.shift();
    if (cur.depth >= maxDepth) continue;
    edges.forEach(function(e) {
      var match = direction === 'reverse' ? (e.toType === cur.type && e.toId === cur.id) : (e.fromType === cur.type && e.fromId === cur.id);
      if (!match || e.status === 'REVOKED') return;
      var nt = direction === 'reverse' ? e.fromType : e.toType;
      var ni = direction === 'reverse' ? e.fromId : e.toId;
      var nodeKey = nt+'|'+ni;
      out.push({depth:cur.depth+1,link:e,nextType:nt,nextId:ni,direction:direction});
      if (!seen[nodeKey]) { seen[nodeKey] = true; queue.push({type:nt,id:ni,depth:cur.depth+1}); }
    });
  }
  return out;
}

function getForwardTrace(batchId, token) {
  try {
    _requireAuth_(token,'journals');
    if (!batchId) return coreErr('BATCH_REQUIRED','Укажите партию');
    return coreOk({root:{type:'BATCH',id:String(batchId)},direction:'forward',edges:_mcTraceGraph_('BATCH',batchId,'forward',16)});
  } catch(e) { return coreErr('TRACE_FORWARD_ERROR',String(e)); }
}

function getReverseTrace(batchId, token) {
  try {
    _requireAuth_(token,'journals');
    if (!batchId) return coreErr('BATCH_REQUIRED','Укажите партию');
    return coreOk({root:{type:'BATCH',id:String(batchId)},direction:'reverse',edges:_mcTraceGraph_('BATCH',batchId,'reverse',16)});
  } catch(e) { return coreErr('TRACE_REVERSE_ERROR',String(e)); }
}

function getTraceGraph(batchId, token) {
  try {
    _requireAuth_(token,'journals');
    if (!batchId) return coreErr('BATCH_REQUIRED','Укажите партию');
    return coreOk({root:{type:'BATCH',id:String(batchId)},forward:_mcTraceGraph_('BATCH',batchId,'forward',16),reverse:_mcTraceGraph_('BATCH',batchId,'reverse',16)});
  } catch(e) { return coreErr('TRACE_GRAPH_ERROR',String(e)); }
}

function getTraceabilityReport(token) {
  try {
    _requireAuth_(token,'journals');
    _mcSyncBatchRelationsToTrace_();
    var sh=_mcTraceSheet_(), v=sh.getDataRange().getValues(), edges=[];
    for(var i=1;i<v.length;i++) if(v[i][0]) edges.push({id:v[i][0],fromType:v[i][1],fromId:v[i][2],relation:v[i][3],toType:v[i][4],toId:v[i][5],factId:v[i][6],dateTime:v[i][7],actor:v[i][8],source:v[i][9],weight:v[i][10],unit:v[i][11],status:v[i][12],hash:v[i][13]});
    var nodes={}; edges.forEach(function(e){nodes[e.fromType+'|'+e.fromId]=true;nodes[e.toType+'|'+e.toId]=true;});
    var dangling=[];
    edges.forEach(function(e){ if(!e.fromId || !e.toId) dangling.push(e.id); });
    return coreOk({edgeCount:edges.length,nodeCount:Object.keys(nodes).length,danglingCount:dangling.length,dangling:dangling,edges:edges.slice(-5000)});
  } catch(e) { return coreErr('TRACE_REPORT_ERROR',String(e)); }
}

function _mcBlockObject_(objectType, objectId, reason, meta) {
  if (!objectId) return null;
  meta=meta||{};
  var sh=_mcBlocksSheet_(), v=sh.getDataRange().getValues();
  for(var i=1;i<v.length;i++) if(String(v[i][1])===String(objectType) && String(v[i][2])===String(objectId) && String(v[i][9])==='ACTIVE') return v[i][0];
  var id='BLK-'+Utilities.getUuid(), now=new Date();
  sh.appendRow([id,objectType,objectId,reason||'',meta.factId||'',meta.deviationId||'',meta.ruleId||'',now,meta.actor||'', 'ACTIVE','','','']);
  if(objectType==='BATCH' && typeof _stockBatchesSheet_==='function') {
    var bs=_stockBatchesSheet_(), bv=bs.getDataRange().getValues();
    for(var r=1;r<bv.length;r++) if(String(bv[r][0])===String(objectId)) { bs.getRange(r+1,11).setValue('blocked'); break; }
  }
  return id;
}

function _mcIsObjectBlocked_(objectType, objectId) {
  if(!objectId) return false;
  var sh=_mcBlocksSheet_(), v=sh.getDataRange().getValues();
  for(var i=1;i<v.length;i++) if(String(v[i][1])===String(objectType) && String(v[i][2])===String(objectId) && String(v[i][9])==='ACTIVE') return true;
  return false;
}

function releaseObjectBlock(blockId, reason, token) {
  try {
    var s=_requireAuth_(token,'audit_create');
    var sh=_mcBlocksSheet_(), v=sh.getDataRange().getValues();
    for(var i=1;i<v.length;i++) if(String(v[i][0])===String(blockId)) {
      if(String(v[i][9])!=='ACTIVE') return coreErr('BLOCK_NOT_ACTIVE','Блокировка уже закрыта');
      sh.getRange(i+1,10).setValue('RELEASED'); sh.getRange(i+1,11).setValue(new Date()); sh.getRange(i+1,12).setValue(_mcSessionFullName_(s)); sh.getRange(i+1,13).setValue(reason||'');
      if(String(v[i][1])==='BATCH' && typeof _stockBatchesSheet_==='function') {
        var bs=_stockBatchesSheet_(), bv=bs.getDataRange().getValues();
        for(var r=1;r<bv.length;r++) if(String(bv[r][0])===String(v[i][2]) && String(bv[r][10])==='blocked') bs.getRange(r+1,11).setValue('active');
      }
      return coreOk({blockId:blockId,releasedBy:_mcSessionFullName_(s)});
    }
    return coreErr('BLOCK_NOT_FOUND','Блокировка не найдена');
  } catch(e) { return coreErr('BLOCK_RELEASE_ERROR',String(e)); }
}

function _mcOpenDeviationAndAction_(fact, actor, ruleId, message, severity) {
  var devId='DV-'+Date.now()+'-'+Math.floor(Math.random()*1000);
  try {
    _devSheet_().appendRow([devId,'',fact.journalId||fact.objectId||'',fact.objectId||fact.batchId||'',message||fact.description||fact.fact||'',fact.value||'',fact.ccpId||!!fact.critical,'открыто','', '', _mcSessionFullName_(actor),new Date(),'','']);
  } catch(e) {}
  var actionId='CA-'+Date.now()+'-'+Math.floor(Math.random()*1000);
  try {
    _corrSheet_().appendRow([actionId,devId,'Проверить отклонение, выполнить корректирующее действие и приложить доказательство.',fact.employeeName||_mcSessionFullName_(actor),'', 'ОТКРЫТО','',_mcSessionFullName_(actor),new Date(),'']);
  } catch(e) {}
  var blockId='';
  if(severity==='CRITICAL') {
    var objectType=fact.batchId?'BATCH':(fact.equipmentId?'EQUIPMENT':(fact.objectId?'OBJECT':''));
    var objectId=fact.batchId||fact.equipmentId||fact.objectId||'';
    if(objectType && objectId) blockId=_mcBlockObject_(objectType,objectId,message,{factId:fact.factId||'',deviationId:devId,ruleId:ruleId,actor:_mcSessionFullName_(actor)});
  }
  return {deviationId:devId,correctiveActionId:actionId,blockId:blockId};
}

function _mcEvaluateFactRulesV5_(fact, actor, ruleIdHint) {
  var f=fact||{}, result=String(f.result||'').toUpperCase(), message='';
  var severity=f.critical===true?'CRITICAL':'NORMAL';
  var eventType=f.eventType||f.factType||'';
  var deviates=(result==='ОТКЛОНЕНИЕ'||result==='FAIL'||result==='FAILED'||f.isDeviation===true);
  var value=parseFloat(f.value), min=f.normMin===''||f.normMin==null?null:parseFloat(f.normMin), max=f.normMax===''||f.normMax==null?null:parseFloat(f.normMax);
  if(!isNaN(value) && min!==null && !isNaN(min) && value<min){deviates=true;message='Фактическое значение ниже установленного предела: '+value+' < '+min;}
  if(!isNaN(value) && max!==null && !isNaN(max) && value>max){deviates=true;message='Фактическое значение выше установленного предела: '+value+' > '+max;}
  if(!message) message=f.description||f.fact||('Отклонение по событию '+eventType);
  if(f.shelfLifeExpired===true){deviates=true;message='Срок годности партии истёк';severity='CRITICAL';}
  if(f.receivingRejected===true){deviates=true;message='Партия отклонена при входном контроле';severity='CRITICAL';}
  if(!deviates) return {actions:[],deviationId:'',correctiveActionId:'',blockId:''};
  var ids=_mcOpenDeviationAndAction_(Object.assign({},f,{factId:f.factId}),actor,ruleIdHint||eventType,message,severity);
  return {actions:[{type:'CREATE_DEVIATION',id:ids.deviationId},{type:'CREATE_CORRECTIVE_ACTION',id:ids.correctiveActionId}].concat(ids.blockId?[{type:'BLOCK_OBJECT',id:ids.blockId}]:[]),deviationId:ids.deviationId,correctiveActionId:ids.correctiveActionId,blockId:ids.blockId,message:message,severity:severity};
}

function evaluateFactRulesV5(fact, token) {
  try {
    var actor=_requireAuth_(token,'journals');
    var f=typeof fact==='string'?JSON.parse(fact):fact||{};
    return coreOk(_mcEvaluateFactRulesV5_(f,actor,''));
  } catch(e) { return coreErr('RULE_ENGINE_V5_ERROR',String(e)); }
}

function _mcRecordRuleEvent_(fact, ruleId, evaluation, actor) {
  var sh=_mcRuleEventsSheet_(), id='RLE-'+Utilities.getUuid(), now=new Date();
  var hash=_mcHashText_(JSON.stringify([id,ruleId,fact.factId||'',fact.factType||'',evaluation.message||'',now.toISOString()]));
  sh.appendRow([id,ruleId||fact.factType||'',fact.factId||'',fact.factType||'',evaluation.severity||'NORMAL',fact.objectType||'',fact.objectId||'',fact.batchId||'',evaluation.deviationId||'',evaluation.correctiveActionId||'',evaluation.blockId||'',evaluation.message||'',now,_mcSessionFullName_(actor), 'APPLIED',hash]);
  return id;
}

function getRuleEvents(token) {
  try {
    _requireAuth_(token,'journals');
    var v=_mcRuleEventsSheet_().getDataRange().getValues(), out=[];
    for(var i=1;i<v.length;i++) if(v[i][0]) out.push({eventId:v[i][0],ruleId:v[i][1],factId:v[i][2],eventType:v[i][3],severity:v[i][4],objectType:v[i][5],objectId:v[i][6],batchId:v[i][7],deviationId:v[i][8],correctiveActionId:v[i][9],blockId:v[i][10],message:v[i][11],createdAt:v[i][12],createdBy:v[i][13],status:v[i][14],hash:v[i][15]});
    return coreOk(out.slice(-1000).reverse());
  } catch(e){return coreErr('RULE_EVENTS_ERROR',String(e));}
}

function getBlocks(token) {
  try {
    _requireAuth_(token,'journals');
    var v=_mcBlocksSheet_().getDataRange().getValues(), out=[];
    for(var i=1;i<v.length;i++) if(v[i][0]) out.push({blockId:v[i][0],objectType:v[i][1],objectId:v[i][2],reason:v[i][3],factId:v[i][4],deviationId:v[i][5],ruleId:v[i][6],createdAt:v[i][7],createdBy:v[i][8],status:v[i][9],releasedAt:v[i][10],releasedBy:v[i][11],releaseReason:v[i][12]});
    return coreOk(out.slice(-1000).reverse());
  } catch(e){return coreErr('BLOCKS_ERROR',String(e));}
}

function getAuditCanonicalTrace(rawToken, batchId) {
  try {
    var s=_requireAuditAccess_(rawToken,'read');
    if(!batchId) return coreErr('BATCH_REQUIRED','Укажите партию');
    if(s.objectId && String(s.objectId)!=='ALL' && String(s.objectId)!==String(batchId)) return coreErr('AUDIT_SCOPE_DENIED','Партия не входит в область проверки');
    var graph={root:{type:'BATCH',id:String(batchId)},forward:_mcTraceGraph_('BATCH',batchId,'forward',16),reverse:_mcTraceGraph_('BATCH',batchId,'reverse',16)};
    try { _mcAuditAccessSheet_().appendRow([_mcUuid_(),s.sessionId,new Date(),'AUDIT_CANONICAL_TRACE',s.inspectorName,'BATCH',batchId,'','', 'OK']); } catch(e) {}
    return coreOk(graph);
  } catch(e) { return coreErr('AUDIT_CANONICAL_TRACE_ERROR',String(e)); }
}

function getAuditRuleState(rawToken) {
  try {
    var s=_requireAuditAccess_(rawToken,'read');
    // Для Audit API не используем обычную авторизацию: чтение разрешено самим audit-token.
    var rv=_mcRuleEventsSheet_().getDataRange().getValues(), events=[];
    for(var i=1;i<rv.length;i++) if(rv[i][0]) events.push({eventId:rv[i][0],ruleId:rv[i][1],factId:rv[i][2],eventType:rv[i][3],severity:rv[i][4],objectType:rv[i][5],objectId:rv[i][6],batchId:rv[i][7],deviationId:rv[i][8],correctiveActionId:rv[i][9],blockId:rv[i][10],message:rv[i][11],createdAt:rv[i][12],createdBy:rv[i][13],status:rv[i][14]});
    var bv=_mcBlocksSheet_().getDataRange().getValues(), blocks=[];
    for(var j=1;j<bv.length;j++) if(bv[j][0]) blocks.push({blockId:bv[j][0],objectType:bv[j][1],objectId:bv[j][2],reason:bv[j][3],deviationId:bv[j][5],status:bv[j][9],createdAt:bv[j][7],releasedAt:bv[j][10],releasedBy:bv[j][11]});
    return coreOk({events:events.slice(-1000).reverse(),blocks:blocks.slice(-1000).reverse()});
  } catch(e) { return coreErr('AUDIT_RULE_STATE_ERROR',String(e)); }
}
