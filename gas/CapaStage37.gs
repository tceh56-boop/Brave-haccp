// ЦЕХ — Stage 37: Compliance Control Matrix & CAPA Engine.
// Finding -> Root Cause -> Corrective/Preventive Action -> Evidence -> Verification -> Closure.
// Не изменяет исходные findings и не проводит хозяйственные операции.
var CAPA37_LIMIT_=300;
var CAPA37_STATUSES_=['OPEN','IN_PROGRESS','PENDING_VERIFICATION','CLOSED','REJECTED'];
var CAPA37_ACTION_STATUSES_=['OPEN','IN_PROGRESS','DONE','OVERDUE'];
var CAPA37_VERIFY_RESULTS_=['PASS','FAIL'];
function _c37Scope_(r,s){return r&&r.organization_id===s.organization_id&&(!r.location_id||!s.location_id||r.location_id===s.location_id);}
function _c37Now_(){return nowIso_();}
function _c37Date_(v){return v?String(v).slice(0,10):'';}
function _c37Require_(v,msg){if(v===undefined||v===null||String(v).trim()==='')throw new Error(msg);return String(v).trim();}
function _c37Json_(v){try{return JSON.stringify(v===undefined?{}:JSON.parse(JSON.stringify(v)));}catch(e){return JSON.stringify({value:String(v)});}}
function _c37Find_(id,s){var r=findOne_('CAPA_CASES','capa_id',String(id||''));if(!r||!_c37Scope_(r,s))throw new Error('CAPA case не найден.');return r;}
function _c37Actions_(capa,s){return findRows_('CAPA_ACTIONS',function(r){return r.capa_id===capa.capa_id&&_c37Scope_(r,s);}).slice(0,CAPA37_LIMIT_);}
function _c37OpenFinding_(data,s){
  var sourceType=String(data.sourceType||'').toUpperCase(), sourceId=String(data.sourceId||''), sourceCode=String(data.sourceCode||'');
  if(!sourceType||!sourceId)return null;
  var key=sourceType+'|'+sourceId;
  var existing=findRows_('CAPA_CASES',function(r){return _c37Scope_(r,s)&&String(r.source_type||'').toUpperCase()===sourceType&&String(r.source_id||'')===sourceId&&['CLOSED','REJECTED'].indexOf(String(r.status||''))===-1;});
  if(existing.length)return existing[0];
  var title=String(data.title||('CAPA по '+sourceCode+' '+sourceId));
  var severity=String(data.severity||'MEDIUM').toUpperCase();
  var due=data.dueAt||new Date(Date.now()+72*3600000).toISOString();
  var row={capa_id:generateId_('CAPA_CASES'),organization_id:s.organization_id,location_id:s.location_id||'',source_type:sourceType,source_id:sourceId,source_code:sourceCode,title:title,description:String(data.description||''),severity:severity,status:'OPEN',root_cause:'',containment:String(data.containment||''),responsible_role:String(data.responsibleRole||'ДИРЕКТОР'),responsible_id:String(data.responsibleId||''),due_at:due,created_by:s.user_id,created_at:_c37Now_(),verified_by:'',verified_at:'',closed_by:'',closed_at:'',closure_evidence:'',last_error:''};
  insertRow_('CAPA_CASES',row); auditLog_(s.user_id,'Создан CAPA case','CAPA_CASES:'+row.capa_id,'',sourceType+'|'+sourceId,'success',s.cascade_id||''); return row;
}
function createCapaCase_(data,s){
  if(!s||!s.organization_id)throw new Error('Сессия организации обязательна.');
  var sourceType=_c37Require_(data.sourceType,'sourceType обязателен.').toUpperCase();
  var sourceId=_c37Require_(data.sourceId,'sourceId обязателен.');
  var existing=findRows_('CAPA_CASES',function(r){return _c37Scope_(r,s)&&String(r.source_type||'').toUpperCase()===sourceType&&String(r.source_id||'')===sourceId&&['CLOSED','REJECTED'].indexOf(String(r.status||''))===-1;});
  if(existing.length)return {capa:existing[0],created:false,duplicate:true};
  var due=data.dueAt||new Date(Date.now()+72*3600000).toISOString();
  var row={capa_id:generateId_('CAPA_CASES'),organization_id:s.organization_id,location_id:s.location_id||'',source_type:sourceType,source_id:sourceId,source_code:String(data.sourceCode||''),title:_c37Require_(data.title,'title обязателен.'),description:String(data.description||''),severity:String(data.severity||'MEDIUM').toUpperCase(),status:'OPEN',root_cause:'',containment:String(data.containment||''),responsible_role:String(data.responsibleRole||'ДИРЕКТОР'),responsible_id:String(data.responsibleId||''),due_at:due,created_by:s.user_id,created_at:_c37Now_(),verified_by:'',verified_at:'',closed_by:'',closed_at:'',closure_evidence:'',last_error:''};
  insertRow_('CAPA_CASES',row); auditLog_(s.user_id,'Создан CAPA case','CAPA_CASES:'+row.capa_id,'',row.title,'success',s.cascade_id||''); return {capa:row,created:true};
}
function getCapaCases_(data,s){
  var status=String(data&&data.status||'');
  var rows=findRows_('CAPA_CASES',function(r){return _c37Scope_(r,s)&&(!status||String(r.status||'')===status);});
  rows.sort(function(a,b){return new Date(b.created_at)-new Date(a.created_at);});
  return {cases:rows.slice(0,CAPA37_LIMIT_),total:rows.length,generated_at:_c37Now_()};
}
function updateCapaCase_(data,s){
  var c=_c37Find_(data.capaId,s); var patch={};
  if(data.rootCause!==undefined)patch.root_cause=String(data.rootCause);
  if(data.containment!==undefined)patch.containment=String(data.containment);
  if(data.responsibleRole!==undefined)patch.responsible_role=String(data.responsibleRole);
  if(data.responsibleId!==undefined)patch.responsible_id=String(data.responsibleId);
  if(data.dueAt!==undefined)patch.due_at=String(data.dueAt);
  if(data.description!==undefined)patch.description=String(data.description);
  if(data.status!==undefined){var st=String(data.status).toUpperCase();if(CAPA37_STATUSES_.indexOf(st)<0)throw new Error('Недопустимый статус CAPA.');patch.status=st;}
  updateRow_('CAPA_CASES',c,patch);auditLog_(s.user_id,'Обновлён CAPA case','CAPA_CASES:'+c.capa_id,'',_c37Json_(patch),'success',s.cascade_id||'');return {capa:findOne_('CAPA_CASES','capa_id',c.capa_id),actions:_c37Actions_(c,s)};
}
function completeCapaAction_(data,s){
  var a=findOne_('CAPA_ACTIONS','action_id',String(data.actionId||''));if(!a||!_c37Scope_(a,s))throw new Error('CAPA action не найдена.');
  var status=String(data.status||'DONE').toUpperCase();if(['DONE','IN_PROGRESS'].indexOf(status)<0)throw new Error('Недопустимый статус CAPA action.');
  updateRow_('CAPA_ACTIONS',a,{status:status,evidence_json:_c37Json_(data.evidence||{}),completed_by:status==='DONE'?s.user_id:'',completed_at:status==='DONE'?_c37Now_():'',verification_status:status==='DONE'?'PENDING':'',verification_note:String(data.note||'')});
  var actions=_c37Actions_(_c37Find_(a.capa_id,s),s),allDone=actions.length>0&&actions.every(function(x){return x.status==='DONE';});if(allDone)updateRow_('CAPA_CASES',_c37Find_(a.capa_id,s),{status:'PENDING_VERIFICATION'});
  auditLog_(s.user_id,'Изменён CAPA action','CAPA_ACTIONS:'+a.action_id,'',status,'success',s.cascade_id||'');return {action:findOne_('CAPA_ACTIONS','action_id',a.action_id),capa:findOne_('CAPA_CASES','capa_id',a.capa_id)};
}
function verifyCapaCase_(data,s){
  var c=_c37Find_(data.capaId,s), result=String(data.result||'').toUpperCase();if(CAPA37_VERIFY_RESULTS_.indexOf(result)<0)throw new Error('result должен быть PASS или FAIL.');
  var v={verification_id:generateId_('CAPA_VERIFICATIONS'),capa_id:c.capa_id,organization_id:s.organization_id,location_id:s.location_id||'',result:result,method:String(data.method||'REVIEW'),evidence_json:_c37Json_(data.evidence||{}),note:String(data.note||''),verified_by:s.user_id,verified_at:_c37Now_()};insertRow_('CAPA_VERIFICATIONS',v);
  if(result==='PASS'){updateRow_('CAPA_CASES',c,{status:'CLOSED',verified_by:s.user_id,verified_at:v.verified_at,closed_by:s.user_id,closed_at:v.verified_at,closure_evidence:String(data.note||'')});}
  else updateRow_('CAPA_CASES',c,{status:'IN_PROGRESS',last_error:String(data.note||'Verification failed')});
  auditLog_(s.user_id,'Проверен CAPA case','CAPA_CASES:'+c.capa_id,'',result,'success',s.cascade_id||'');return {verification:v,capa:findOne_('CAPA_CASES','capa_id',c.capa_id)};
}
function runCapaSla_(s,limit){
  var now=Date.now(),rows=findRows_('CAPA_CASES',function(r){return _c37Scope_(r,s)&&['OPEN','IN_PROGRESS','PENDING_VERIFICATION'].indexOf(String(r.status||''))>=0;}).slice(0,Number(limit)||CAPA37_LIMIT_),overdue=0;
  rows.forEach(function(c){if(c.due_at&&new Date(c.due_at).getTime()<now){overdue++;if(c.status!=='PENDING_VERIFICATION')updateRow_('CAPA_CASES',c,{last_error:'SLA просрочен',status:'IN_PROGRESS'});}});
  var actions=findRows_('CAPA_ACTIONS',function(r){return _c37Scope_(r,s)&&['OPEN','IN_PROGRESS'].indexOf(String(r.status||''))>=0;}).slice(0,CAPA37_LIMIT_);var overdueActions=0;
  actions.forEach(function(a){if(a.due_at&&new Date(a.due_at).getTime()<now){overdueActions++;updateRow_('CAPA_ACTIONS',a,{status:'OVERDUE'});}});
  return {checked:rows.length,overdue_cases:overdue,checked_actions:actions.length,overdue_actions:overdueActions,at:_c37Now_()};
}
function createCapaAction_(data,s){
  var c=_c37Find_(data.capaId,s);if(['CLOSED','REJECTED'].indexOf(c.status)>=0)throw new Error('Нельзя добавлять действие в закрытый CAPA.');
  var row={action_id:generateId_('CAPA_ACTIONS'),capa_id:c.capa_id,organization_id:s.organization_id,location_id:s.location_id||'',action_type:String(data.actionType||'CORRECTIVE').toUpperCase(),description:_c37Require_(data.description,'description обязателен.'),responsible_role:String(data.responsibleRole||c.responsible_role||'ДИРЕКТОР'),responsible_id:String(data.responsibleId||''),due_at:String(data.dueAt||c.due_at||''),status:'OPEN',evidence_json:'{}',created_by:s.user_id,created_at:_c37Now_(),completed_by:'',completed_at:'',verification_status:'',verification_note:''};insertRow_('CAPA_ACTIONS',row);if(c.status==='OPEN')updateRow_('CAPA_CASES',c,{status:'IN_PROGRESS'});auditLog_(s.user_id,'Создано CAPA action','CAPA_ACTIONS:'+row.action_id,'',row.description,'success',s.cascade_id||'');return row;
}
function getCapaCase_(data,s){var c=_c37Find_(data.capaId,s);return {capa:c,actions:_c37Actions_(c,s),verifications:findRows_('CAPA_VERIFICATIONS',function(r){return r.capa_id===c.capa_id&&_c37Scope_(r,s);}).slice(0,CAPA37_LIMIT_)};}
function capaStage37Tests_(){var o=[];function ok(n,c,d){o.push({name:n,status:c?'OK':'FAIL',detail:d||''});}ok('SCHEMA',Array.isArray(CONFIG.SCHEMA.CAPA_CASES)&&Array.isArray(CONFIG.SCHEMA.CAPA_ACTIONS)&&Array.isArray(CONFIG.SCHEMA.CAPA_VERIFICATIONS));ok('SHEETS',CONFIG.SHEETS.CAPA_CASES==='CAPA_CASES'&&CONFIG.SHEETS.CAPA_ACTIONS==='CAPA_ACTIONS'&&CONFIG.SHEETS.CAPA_VERIFICATIONS==='CAPA_VERIFICATIONS');ok('IDS',CONFIG.ID_PREFIXES.CAPA_CASES==='CAPA'&&CONFIG.ID_PREFIXES.CAPA_ACTIONS==='CAPAA'&&CONFIG.ID_PREFIXES.CAPA_VERIFICATIONS==='CAPAV');ok('API',typeof createCapaCase_==='function'&&typeof createCapaAction_==='function'&&typeof verifyCapaCase_==='function'&&typeof runCapaSla_==='function');ok('STATUS',CAPA37_STATUSES_.indexOf('PENDING_VERIFICATION')>=0&&CAPA37_ACTION_STATUSES_.indexOf('OVERDUE')>=0);ok('RBAC',CONFIG.ACTION_MODULE.CREATE_CAPA_CASE==='master_data_admin'&&CONFIG.ACTION_MODULE.VERIFY_CAPA_CASE==='audit_admin');ok('BOUNDED',CAPA37_LIMIT_===300);return o;}
