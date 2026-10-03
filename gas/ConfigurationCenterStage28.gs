/**
 * ЦЕХ Stage 28 — Master Data & Configuration Center.
 * Версионируемая конфигурация без перезаписи истории.
 * Критические изменения всегда проходят approve -> activate.
 */
var CFG28_STATUSES_=['DRAFT','APPROVED','ACTIVE','ROLLED_BACK','REJECTED'];
var CFG28_TYPES_=['string','number','boolean','json'];
var CFG28_BATCH_LIMIT_=100;
function _cfg28Scope_(r,s){return !!r&&r.organization_id===s.organization_id&&(!s.location_id||!r.location_id||r.location_id===s.location_id);}
function _cfg28Json_(v){try{return JSON.stringify(v===undefined?null:v);}catch(e){throw new Error('Значение конфигурации не сериализуется.');}}
function _cfg28Version_(id,s){var r=findOne_('CONFIGURATION_VERSIONS','config_version_id',id);if(!r||!_cfg28Scope_(r,s))throw new Error('Версия конфигурации не найдена.');return r;}
function _cfg28Values_(versionId,s){return findRows_('CONFIGURATION_VALUES',function(r){return r.config_version_id===versionId&&_cfg28Scope_(r,s);});}
function _cfg28Checksum_(values){var raw=values.map(function(v){return [v.namespace,v.key,v.value_json,v.value_type,v.critical].join('|');}).sort().join('\n');var bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,raw);return bytes.map(function(b){return ('0'+(b<0?b+256:b).toString(16)).slice(-2);}).join('');}
function getConfiguration_(data,session){
  data=data||{};var rows=findRows_('CONFIGURATION_VERSIONS',function(r){return _cfg28Scope_(r,session)&&(!data.status||r.status===data.status);});
  rows.sort(function(a,b){return Number(b.version_no)-Number(a.version_no);});
  var limit=Math.min(Number(data.limit||20),CFG28_BATCH_LIMIT_);
  return rows.slice(0,limit).map(function(v){return {version_id:v.config_version_id,version_no:Number(v.version_no),status:v.status,change_type:v.change_type,reason:v.reason,created_by:v.created_by,created_at:v.created_at,approved_by:v.approved_by,approved_at:v.approved_at,activated_by:v.activated_by,activated_at:v.activated_at,values:_cfg28Values_(v.config_version_id,session).map(function(x){return {namespace:x.namespace,key:x.key,value:JSON.parse(x.value_json),value_type:x.value_type,critical:x.critical==='true'||x.critical===true,description:x.description};})};});
}
function createConfigurationRevision_(data,session){
  if(!data.values||!Array.isArray(data.values)||!data.values.length)throw new Error('values обязателен и не пуст.');
  var existing=findRows_('CONFIGURATION_VERSIONS',function(r){return _cfg28Scope_(r,session)&&['DRAFT','APPROVED'].indexOf(r.status)>=0;});
  if(existing.length)throw new Error('Уже существует незавершённая версия конфигурации. Сначала согласуйте или отклоните её.');
  var versions=findRows_('CONFIGURATION_VERSIONS',function(r){return _cfg28Scope_(r,session);});
  var next=versions.reduce(function(m,r){return Math.max(m,Number(r.version_no)||0);},0)+1;
  var now=nowIso_(), id=generateId_('CONFIGURATION_VERSIONS');
  var vals=data.values.map(function(v,i){
    if(!v.namespace||!v.key)throw new Error('Каждое значение требует namespace и key.');
    var type=v.value_type||typeof v.value;if(CFG28_TYPES_.indexOf(type)<0)throw new Error('Недопустимый value_type: '+type);
    return {config_value_id:generateId_('CONFIGURATION_VALUES'),config_version_id:id,organization_id:session.organization_id,location_id:session.location_id||'',namespace:String(v.namespace),key:String(v.key),value_json:_cfg28Json_(v.value),value_type:type,critical:!!v.critical?'true':'false',description:String(v.description||''),created_at:now};
  });
  var checksum=_cfg28Checksum_(vals);
  insertRow_('CONFIGURATION_VERSIONS',{config_version_id:id,organization_id:session.organization_id,location_id:session.location_id||'',version_no:next,status:'DRAFT',change_type:data.changeType||'UPDATE',reason:String(data.reason||''),created_by:session.user_id,created_at:now,approved_by:'',approved_at:'',activated_by:'',activated_at:'',supersedes_version_id:data.supersedesVersionId||'',checksum:checksum});
  vals.forEach(function(v){insertRow_('CONFIGURATION_VALUES',v);});
  auditLog_(session.user_id,'Создана версия конфигурации','CONFIGURATION_VERSIONS:'+id,null,checksum,'success',session.cascade_id||'');
  return getConfiguration_({status:'DRAFT',limit:1},session)[0];
}
function approveConfigurationRevision_(versionId,session){
  return withLock_(function(){var v=_cfg28Version_(versionId,session);if(v.status!=='DRAFT')throw new Error('Согласовать можно только DRAFT.');updateRow_('CONFIGURATION_VERSIONS',v,{status:'APPROVED',approved_by:session.user_id,approved_at:nowIso_});auditLog_(session.user_id,'Согласована версия конфигурации','CONFIGURATION_VERSIONS:'+versionId,'DRAFT','APPROVED','success',session.cascade_id||'');return getConfiguration_({status:'APPROVED',limit:1},session)[0];});
}
function activateConfigurationRevision_(versionId,session){
  return withLock_(function(){var v=_cfg28Version_(versionId,session);if(v.status!=='APPROVED')throw new Error('Активировать можно только APPROVED.');var vals=_cfg28Values_(versionId,session);var checksum=_cfg28Checksum_(vals);if(checksum!==v.checksum)throw new Error('Checksum конфигурации не совпадает.');var active=findRows_('CONFIGURATION_VERSIONS',function(r){return _cfg28Scope_(r,session)&&r.status==='ACTIVE';});active.forEach(function(a){updateRow_('CONFIGURATION_VERSIONS',a,{status:'ROLLED_BACK'});});updateRow_('CONFIGURATION_VERSIONS',v,{status:'ACTIVE',activated_by:session.user_id,activated_at:nowIso_()});auditLog_(session.user_id,'Активирована версия конфигурации','CONFIGURATION_VERSIONS:'+versionId,null,'ACTIVE','success',session.cascade_id||'');return getConfiguration_({status:'ACTIVE',limit:1},session)[0];});
}
function rollbackConfiguration_(versionId,session){
  return withLock_(function(){var target=_cfg28Version_(versionId,session);if(target.status!=='ACTIVE')throw new Error('Откатить можно только ACTIVE.');var previous=findRows_('CONFIGURATION_VERSIONS',function(r){return _cfg28Scope_(r,session)&&Number(r.version_no)<Number(target.version_no)&&r.status==='ROLLED_BACK';}).sort(function(a,b){return Number(b.version_no)-Number(a.version_no);})[0];if(!previous)throw new Error('Нет предыдущей версии для отката.');updateRow_('CONFIGURATION_VERSIONS',target,{status:'ROLLED_BACK'});updateRow_('CONFIGURATION_VERSIONS',previous,{status:'ACTIVE',activated_by:session.user_id,activated_at:nowIso_()});auditLog_(session.user_id,'Откат конфигурации','CONFIGURATION_VERSIONS:'+versionId,target.version_no,previous.version_no,'success',session.cascade_id||'');return getConfiguration_({status:'ACTIVE',limit:1},session)[0];});
}
function configurationStage28Tests_(){var out=[];function ok(n,c,d){out.push({name:n,status:c?'OK':'FAIL',detail:d||''});}ok('SCHEMA',Array.isArray(CONFIG.SCHEMA.CONFIGURATION_VERSIONS)&&Array.isArray(CONFIG.SCHEMA.CONFIGURATION_VALUES),'schemas registered');ok('SHEETS',CONFIG.SHEETS.CONFIGURATION_VERSIONS==='CONFIGURATION_VERSIONS'&&CONFIG.SHEETS.CONFIGURATION_VALUES==='CONFIGURATION_VALUES','sheets registered');ok('IDS',CONFIG.ID_PREFIXES.CONFIGURATION_VERSIONS==='CFG'&&CONFIG.ID_PREFIXES.CONFIGURATION_VALUES==='CFGV','ids registered');ok('API',typeof getConfiguration_==='function'&&typeof createConfigurationRevision_==='function'&&typeof approveConfigurationRevision_==='function'&&typeof activateConfigurationRevision_==='function'&&typeof rollbackConfiguration_==='function','api functions');ok('RBAC',CONFIG.ACTION_MODULE.GET_CONFIGURATION==='configuration_admin'&&CONFIG.ACTION_MODULE.ACTIVATE_CONFIGURATION_REVISION==='configuration_admin','rbac contract');ok('ROLE',CONFIG.ROLE_MODULES['ДИРЕКТОР'].indexOf('configuration_admin')>=0,'director has config admin');ok('STATUS',CFG28_STATUSES_.indexOf('ACTIVE')>=0&&CFG28_STATUSES_.indexOf('ROLLED_BACK')>=0,'statuses');ok('CHECKSUM',typeof _cfg28Checksum_==='function','checksum protection');ok('LIMIT',CFG28_BATCH_LIMIT_===100,'batch bounded');return out;}
