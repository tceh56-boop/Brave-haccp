/** ЦЕХ — Stage 30 Unified Master Data. */
var MD30_ENTITY_TYPES_ = ['PRODUCT','GLOBAL_PRODUCT','SUPPLIER','DISH','SEMI_FINISHED','WORKSHOP','EQUIPMENT','UNIT','CATEGORY'];
var MD30_STATUS_ = ['ACTIVE','INACTIVE','MERGED'];
var MD30_BATCH_LIMIT_ = 200;

function _md30Norm_(v){ return String(v||'').toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/gi,' ').replace(/\s+/g,' ').trim(); }
function _md30Scope_(r,s){ return r.organization_id===s.organization_id && (!r.location_id || !s.location_id || r.location_id===s.location_id); }
function _md30EntitySource_(type,id,s){
  var map={PRODUCT:['PRODUCTS','product_id','название'],GLOBAL_PRODUCT:['GLOBAL_PRODUCTS','global_product_id','name'],SUPPLIER:['SUPPLIERS','supplier_id','название'],DISH:['DISHES','dish_id','название'],SEMI_FINISHED:['SEMI_FINISHED','pf_id','название'],WORKSHOP:['WORKSHOPS','workshop_id','название'],EQUIPMENT:['EQUIPMENT','equipment_id','название'],UNIT:['UNITS','unit_id','название'],CATEGORY:['CATEGORIES','category_id','название']};
  var m=map[type]; if(!m) throw new Error('Неизвестный тип master data: '+type);
  var row=findOne_(m[0],m[1],id); if(!row) throw new Error('Объект master data не найден.');
  if(row.organization_id && row.organization_id!==s.organization_id) throw new Error('Объект принадлежит другой организации.');
  return {row:row, sheet:m[0], idField:m[1], nameField:m[2]};
}
function _md30ResolveName_(type,id,s){ var x=_md30EntitySource_(type,id,s); return String(x.row[x.nameField]||id); }

function getMasterData_(data,session){
  data=data||{}; var rows=findRows_('MASTER_DATA_REGISTRY',function(r){
    if(!_md30Scope_(r,session)) return false;
    if(data.entityType && r.entity_type!==data.entityType) return false;
    if(data.status && r.status!==data.status) return false;
    if(data.q){ var q=_md30Norm_(data.q); if((_md30Norm_(r.canonical_name)+' '+_md30Norm_(r.normalized_name)).indexOf(q)===-1) return false; }
    return true;
  });
  rows.sort(function(a,b){return String(a.canonical_name).localeCompare(String(b.canonical_name));});
  return rows.slice(0,Math.min(Number(data.limit||MD30_BATCH_LIMIT_),MD30_BATCH_LIMIT_));
}

function _md30EnsureRegistry_(type,id,session){
  var source=_md30EntitySource_(type,id,session), name=_md30ResolveName_(type,id,session);
  var existing=findRows_('MASTER_DATA_REGISTRY',function(r){return r.organization_id===session.organization_id&&r.entity_type===type&&r.entity_id===id;})[0];
  if(existing) return existing;
  var row={master_id:generateId_('MASTER_DATA_REGISTRY'),organization_id:session.organization_id,location_id:session.location_id||'',workshop_id:source.row.workshop_id||'',entity_type:type,entity_id:id,parent_master_id:'',canonical_name:name,normalized_name:_md30Norm_(name),status:'ACTIVE',version:1,attributes_json:'{}',source:'ENTITY_SYNC',effective_from:nowIso_(),effective_to:'',created_by:session.user_id,created_at:nowIso_(),updated_at:nowIso_()};
  insertRow_('MASTER_DATA_REGISTRY',row); return row;
}
function createMasterDataAlias_(data,session){
  var type=String(data.entityType||''); if(MD30_ENTITY_TYPES_.indexOf(type)<0) throw new Error('Недопустимый тип master data.');
  var master=_md30EnsureRegistry_(type,data.entityId,session), alias=String(data.alias||'').trim(); if(!alias) throw new Error('Алиас обязателен.');
  var norm=_md30Norm_(alias); var dup=findRows_('MASTER_DATA_ALIASES',function(r){return _md30Scope_(r,session)&&r.normalized_alias===norm&&r.status==='ACTIVE';});
  if(dup.length && dup[0].master_id!==master.master_id) throw new Error('Такой алиас уже привязан к другому объекту.');
  if(dup.length) return dup[0];
  var row={alias_id:generateId_('MASTER_DATA_ALIASES'),master_id:master.master_id,organization_id:session.organization_id,location_id:session.location_id||'',alias:alias,normalized_alias:norm,source:String(data.source||'manual'),status:'ACTIVE',created_by:session.user_id,created_at:nowIso_()};
  insertRow_('MASTER_DATA_ALIASES',row); auditLog_(session.user_id,'Создан master-data алиас','MASTER_DATA_ALIASES:'+row.alias_id,null,alias,'success',session.cascade_id||''); return row;
}
function getMasterDataDuplicates_(data,session){
  data=data||{}; var rows=getMasterData_(data,session), aliases=findRows_('MASTER_DATA_ALIASES',function(r){return _md30Scope_(r,session)&&r.status==='ACTIVE';}), buckets={};
  rows.forEach(function(r){var key=r.entity_type+'|'+r.normalized_name;(buckets[key]||(buckets[key]=[])).push(r);});
  aliases.forEach(function(a){var key='ALIAS|'+a.normalized_alias;(buckets[key]||(buckets[key]=[])).push(a);});
  return Object.keys(buckets).map(function(k){return {key:k,items:buckets[k]};}).filter(function(g){return g.items.length>1;});
}
function resolveMasterDataDuplicate_(data,session){
  data=data||{}; var target=String(data.targetMasterId||''), source=String(data.sourceMasterId||''); if(!target||!source||target===source) throw new Error('Нужно указать два разных master_id.');
  var t=findOne_('MASTER_DATA_REGISTRY','master_id',target), s=findOne_('MASTER_DATA_REGISTRY','master_id',source); if(!t||!s||!_md30Scope_(t,session)||!_md30Scope_(s,session)) throw new Error('Master data объект не найден.');
  if(t.entity_type!==s.entity_type) throw new Error('Объекты должны быть одного типа.');
  var aliases=findRows_('MASTER_DATA_ALIASES',function(r){return r.master_id===s.master_id&&_md30Scope_(r,session)&&r.status==='ACTIVE';});
  aliases.forEach(function(a){ var clash=findRows_('MASTER_DATA_ALIASES',function(x){return x.master_id===t.master_id&&x.normalized_alias===a.normalized_alias&&x.status==='ACTIVE';}); if(!clash.length) updateRow_('MASTER_DATA_ALIASES',a,{master_id:t.master_id}); else updateRow_('MASTER_DATA_ALIASES',a,{status:'MERGED'}); });
  updateRow_('MASTER_DATA_REGISTRY',s,{status:'MERGED',attributes_json:JSON.stringify({merged_into:target,merged_at:nowIso_()}) ,updated_at:nowIso_(),version:Number(s.version||1)+1});
  auditLog_(session.user_id,'Объединены master-data записи','MASTER_DATA_REGISTRY:'+source,target,source,'success',session.cascade_id||'');
  return {target:t,merged_source:getMasterData_({status:'MERGED',limit:MD30_BATCH_LIMIT_},session).filter(function(r){return r.master_id===source;})[0]||s};
}
function masterDataStage30Tests_(){var o=[];function ok(n,c,d){o.push({name:n,status:c?'OK':'FAIL',detail:d||''});}
 ok('SCHEMA',Array.isArray(CONFIG.SCHEMA.MASTER_DATA_REGISTRY)&&Array.isArray(CONFIG.SCHEMA.MASTER_DATA_ALIASES),'schemas');
 ok('SHEETS',CONFIG.SHEETS.MASTER_DATA_REGISTRY==='MASTER_DATA_REGISTRY'&&CONFIG.SHEETS.MASTER_DATA_ALIASES==='MASTER_DATA_ALIASES','sheets');
 ok('IDS',CONFIG.ID_PREFIXES.MASTER_DATA_REGISTRY==='MD'&&CONFIG.ID_PREFIXES.MASTER_DATA_ALIASES==='MDA','ids');
 ok('API',typeof getMasterData_==='function'&&typeof getMasterDataDuplicates_==='function'&&typeof createMasterDataAlias_==='function'&&typeof resolveMasterDataDuplicate_==='function','api');
 ok('RBAC',CONFIG.ACTION_MODULE.GET_MASTER_DATA==='dashboard'&&CONFIG.ACTION_MODULE.CREATE_MASTER_DATA_ALIAS==='master_data_admin'&&CONFIG.ACTION_MODULE.RESOLVE_MASTER_DATA_DUPLICATE==='master_data_admin','rbac');
 ok('LIMIT',MD30_BATCH_LIMIT_===200,'batch bounded');
 ok('TYPES',MD30_ENTITY_TYPES_.indexOf('PRODUCT')>=0&&MD30_ENTITY_TYPES_.indexOf('SUPPLIER')>=0&&MD30_ENTITY_TYPES_.indexOf('WORKSHOP')>=0,'entity types');
 ok('NORMALIZE',_md30Norm_(' Ёлка  /  TEST-1 ')==='елка test 1','normalization');
 return o;}
