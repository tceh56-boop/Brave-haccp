/**
 * ЦЕХ — PPK/HACCP Generator & Execution Engine.
 * Generic platform contour: enterprise data + source-backed rules -> PPK draft.
 * Does not mutate business contours automatically; approved PPK is a control model.
 */
var PPK_POINT_TYPES = ['PRP','ППОПМ','КТ','ККТ'];
var PPK_HAZARD_TYPES = ['BIO','CHEM','PHYSICAL','ALLERGEN'];
var PPK_FLOW_TYPES = ['RAW','SEMI_FINISHED','FINISHED','WASTE'];
var PPK_REVIEW_REASONS = ['PRODUCT_ADDED','RECIPE_CHANGED','SUPPLIER_CHANGED','RAW_MATERIAL_CHANGED','EQUIPMENT_ADDED','PROCESS_CHANGED','ROOM_CHANGED','TEMPERATURE_CHANGED','CHEMICAL_CHANGED','RULE_CHANGED','LAB_PROGRAM_CHANGED','MANUAL'];

function _ppkCtx_(session, locationId) {
  if (!session) throw new Error('Сессия обязательна для ППК.');
  var loc = locationId || session.location_id;
  if (!loc) throw new Error('Для ППК требуется выбранная точка.');
  assertLocationAllowed_(session, loc, 'PPK_LOCATION:' + loc);
  var location = assertOwnedByOrg_(session, findOne_('LOCATIONS','location_id',loc), 'LOCATIONS:' + loc);
  return { organizationId: session.organization_id, locationId: loc, location: location };
}
function _ppkRows_(sheet, orgId, locationId) {
  return findRows_(sheet, function(r){ return r.organization_id===orgId && (!locationId || !r.location_id || r.location_id===locationId); });
}
function _ppkJson_(v, fallback) { if (v===undefined || v===null || v==='') return fallback===undefined?{}:fallback; if (typeof v==='object') return v; try{return JSON.parse(v);}catch(e){return fallback===undefined?{}:fallback;} }
function _ppkUnique_(arr) { var seen={}; return (arr||[]).filter(function(x){var k=String(x);if(seen[k])return false;seen[k]=true;return true;}); }
function _ppkRequireDraft_(session, ppkId) {
  var p=findOne_('PPK_VERSIONS','ppk_id',ppkId); assertOwnedByOrg_(session,p,'PPK_VERSIONS:'+ppkId);
  if (p.status!=='DRAFT') throw new Error('Изменять можно только черновик ППК. Утвержденная версия неизменяема.');
  return p;
}
function _ppkId_(prefix){ return generateId_(prefix); }


function _ppkAssertRef_(session, sheet, idField, id, ppkId, label) {
  if (!id) return null;
  var r=findOne_(sheet,idField,id); if(!r) _denyScope_(session,label||sheet+':'+id,'not_found');
  assertOwnedByOrg_(session,r,label||sheet+':'+id);
  if (r.ppk_id && r.ppk_id!==ppkId) _denyScope_(session,label||sheet+':'+id,'foreign_ppk');
  return r;
}
function getPpkGeneratorContext_(session, data) {
  var c=_ppkCtx_(session, data && data.locationId);
  var org=findOne_('ORGANIZATIONS','organization_id',c.organizationId);
  var workshops=findRows_('WORKSHOPS',function(r){return r.location_id===c.locationId;});
  var equipment=findRows_('EQUIPMENT',function(r){return r.location_id===c.locationId;});
  var products=findRows_('PRODUCTS',function(r){return r.organization_id===c.organizationId && r.активность!=='неактивен';});
  var dishes=findRows_('DISHES',function(r){return r.organization_id===c.organizationId && r.статус!=='архив';});
  var semi=findRows_('SEMI_FINISHED',function(r){return r.organization_id===c.organizationId;});
  var suppliers=findRows_('SUPPLIERS',function(r){return r.organization_id===c.organizationId;});
  var recipes=findRows_('RECIPES',function(r){
    if(r.parent_type==='DISH') return dishes.some(function(d){return d.dish_id===r.parent_id;});
    if(r.parent_type==='SEMI_FINISHED') return semi.some(function(p){return p.pf_id===r.parent_id;});
    return false;
  });
  var labDefs=findRows_('LAB_TEST_DEFINITIONS',function(r){return r.organization_id===c.organizationId && (!r.location_id || r.location_id===c.locationId) && r.статус!=='архив';});
  var journalDefs=findRows_('JOURNAL_DEFINITIONS',function(r){return r.organization_id===c.organizationId && (!r.location_id || r.location_id===c.locationId) && r.статус!=='архив';});
  var rules=findRows_('RULES',function(r){return r.organization_id===c.organizationId && r.статус!=='архив';});
  return {organization:org,location:c.location,workshops:workshops,equipment:equipment,products:products,dishes:dishes,semi_finished:semi,suppliers:suppliers,recipes:recipes,lab_definitions:labDefs,journal_definitions:journalDefs,rules:rules};
}

function generatePpk_(session, data) {
  return withLock_(function(){
    data=data||{}; var c=_ppkCtx_(session,data.locationId);
    var existing=findRows_('PPK_VERSIONS',function(r){return r.organization_id===c.organizationId && r.status==='DRAFT';});
    var ppk=existing.sort(function(a,b){return new Date(b.created_at)-new Date(a.created_at);})[0];
    if(!ppk){ ppk=createPpkVersion_({organizationId:c.organizationId,effectiveFrom:data.effectiveFrom,data:{location_id:c.locationId},userId:session.user_id,session:session}); }
    else { assertOwnedByOrg_(session,ppk,'PPK_VERSIONS:'+ppk.ppk_id); }
    var result={ppk_id:ppk.ppk_id,version:ppk.version,location_id:c.locationId,context:getPpkGeneratorContext_(session,{locationId:c.locationId}),created:false};
    var processes=buildPpkProcesses_(session,{ppkId:ppk.ppk_id,locationId:c.locationId});
    var flows=buildPpkFlows_(session,{ppkId:ppk.ppk_id,locationId:c.locationId});
    var hazards=buildPpkHazardAnalysis_(session,{ppkId:ppk.ppk_id,locationId:c.locationId});
    var controls=generatePpkControls_(session,{ppkId:ppk.ppk_id,locationId:c.locationId});
    var labs=generatePpkLabProgram_(session,{ppkId:ppk.ppk_id,locationId:c.locationId});
    var doc=buildPpkDocumentModel_(session,{ppkId:ppk.ppk_id,locationId:c.locationId});
    var snapshot={generator_version:'1.0.0',generated_at:nowIso_(),location_id:c.locationId,processes:processes.length,flows:flows.length,hazards:hazards.length,controls:controls.length,lab_program:labs.length,document_sections:doc.sections.length};
    updateRow_('PPK_VERSIONS',findOne_('PPK_VERSIONS','ppk_id',ppk.ppk_id),{snapshot_json:JSON.stringify(snapshot)});
    auditLog_(session.user_id,'Сгенерирована цифровая модель ППК','PPK_VERSIONS:'+ppk.ppk_id,'',JSON.stringify(snapshot),'success',session.cascade_id);
    result.created=!existing.length; result.counts=snapshot; return result;
  });
}

function buildPpkProcesses_(session,data){
  var c=_ppkCtx_(session,data.locationId), ctx=getPpkGeneratorContext_(session,data);
  var existing=_ppkRows_('PPK_PROCESSES',c.organizationId,c.locationId).filter(function(r){return r.ppk_id===data.ppkId;});
  var wanted=[];
  ctx.dishes.forEach(function(d){ wanted.push({type:'PRODUCT',id:d.dish_id,name:d.название}); });
  ctx.semi_finished.forEach(function(p){ wanted.push({type:'SEMI_FINISHED',id:p.pf_id,name:p.название}); });
  var base=[['RECEIPT','Приемка сырья'],['STORAGE','Хранение'],['PREPARATION','Подготовка/дефростация'],['PRIMARY_PROCESSING','Первичная обработка'],['TECH_PROCESS','Технологическая обработка'],['PRODUCTION','Производство'],['THERMAL','Термическая обработка'],['COOLING','Охлаждение/замораживание'],['FINISHED_STORAGE','Хранение готовой продукции'],['ASSEMBLY','Комплектация'],['DISTRIBUTION','Раздача/реализация']];
  var out=[]; base.forEach(function(x){
    var key=x[0]; var ex=existing.filter(function(r){return r.process_code===key;})[0];
    if(ex){out.push(ex);return;}
    var row={process_id:_ppkId_('PPK_PROCESSES'),ppk_id:data.ppkId,organization_id:c.organizationId,location_id:c.locationId,process_code:key,name:x[1],scope_json:JSON.stringify(wanted),status:'DRAFT',source:'GENERATOR',created_at:nowIso_()};
    insertRow_('PPK_PROCESSES',row); out.push(row);
  });
  return out;
}

function buildPpkFlows_(session,data){
  var c=_ppkCtx_(session,data.locationId), ctx=getPpkGeneratorContext_(session,data), procs=buildPpkProcesses_(session,data);
  var stages=_ppkRows_('PPK_FLOW_STAGES',c.organizationId,c.locationId).filter(function(r){return r.ppk_id===data.ppkId;});
  var flows=_ppkRows_('PPK_FLOWS',c.organizationId,c.locationId).filter(function(r){return r.ppk_id===data.ppkId;});
  var stageByCode={};
  procs.forEach(function(p){var ex=stages.filter(function(s){return s.stage_code===p.process_code;})[0];if(!ex){ex={stage_id:_ppkId_('PPK_FLOW_STAGES'),ppk_id:data.ppkId,organization_id:c.organizationId,location_id:c.locationId,stage_code:p.process_code,name:p.name,process_id:p.process_id,previous_stage_id:'',next_stage_id:'',product_ids_json:'[]',workshop_id:'',equipment_id:'',input_json:'[]',output_json:'[]',parameters_json:'{}',responsible_role:'',status:'DRAFT'};insertRow_('PPK_FLOW_STAGES',ex);}stageByCode[p.process_code]=ex;});
  for(var i=0;i<procs.length;i++){var s=stageByCode[procs[i].process_code];updateRow_('PPK_FLOW_STAGES',findOne_('PPK_FLOW_STAGES','stage_id',s.stage_id),{previous_stage_id:i?stageByCode[procs[i-1].process_code].stage_id:'',next_stage_id:i<procs.length-1?stageByCode[procs[i+1].process_code].stage_id:''});}
  var routes=[
    {type:'RAW',name:'Поток сырья',codes:['RECEIPT','STORAGE','PREPARATION','PRIMARY_PROCESSING','TECH_PROCESS','PRODUCTION']},
    {type:'SEMI_FINISHED',name:'Поток полуфабрикатов',codes:['PRIMARY_PROCESSING','TECH_PROCESS','PRODUCTION']},
    {type:'FINISHED',name:'Поток готовой продукции',codes:['PRODUCTION','THERMAL','COOLING','FINISHED_STORAGE','ASSEMBLY','DISTRIBUTION']},
    {type:'WASTE',name:'Поток отходов',codes:['PRIMARY_PROCESSING','TECH_PROCESS','PRODUCTION','ASSEMBLY']}
  ];
  var out=[]; routes.forEach(function(rt){var ex=flows.filter(function(f){return f.flow_type===rt.type;})[0];var stageIds=rt.codes.map(function(code){return stageByCode[code]&&stageByCode[code].stage_id;}).filter(Boolean);var payload={route:rt.codes,stage_ids:stageIds,product_ids:ctx.products.map(function(x){return x.product_id;})};if(!ex){ex={flow_id:_ppkId_('PPK_FLOWS'),ppk_id:data.ppkId,organization_id:c.organizationId,location_id:c.locationId,flow_type:rt.type,name:rt.name,stage_ids_json:JSON.stringify(stageIds),product_ids_json:JSON.stringify(payload.product_ids),route_json:JSON.stringify(payload),status:'DRAFT',created_at:nowIso_()};insertRow_('PPK_FLOWS',ex);}else{updateRow_('PPK_FLOWS',findOne_('PPK_FLOWS','flow_id',ex.flow_id),{stage_ids_json:JSON.stringify(stageIds),product_ids_json:JSON.stringify(payload.product_ids),route_json:JSON.stringify(payload)});}out.push(ex);});
  return out.concat(stages);
}

function buildPpkHazardAnalysis_(session,data){
  var c=_ppkCtx_(session,data.locationId), procs=buildPpkProcesses_(session,data), existing=_ppkRows_('HAZARD_ANALYSIS',c.organizationId,c.locationId).filter(function(r){return r.ppk_id===data.ppkId;});
  var candidates=[];
  procs.forEach(function(p){
    candidates.push({process_id:p.process_id,process_code:p.process_code,type:'BIO',description:'Биологическая опасность — требуется оценка для этапа '+p.name});
    candidates.push({process_id:p.process_id,process_code:p.process_code,type:'CHEM',description:'Химическая опасность — требуется оценка для этапа '+p.name});
    candidates.push({process_id:p.process_id,process_code:p.process_code,type:'PHYSICAL',description:'Физическая опасность — требуется оценка для этапа '+p.name});
    candidates.push({process_id:p.process_id,process_code:p.process_code,type:'ALLERGEN',description:'Аллергенная опасность — применимость требуется подтвердить по номенклатуре/рецептам'});
  });
  var out=[]; candidates.forEach(function(x){var ex=existing.filter(function(h){return h.process_id===x.process_id&&h.hazard_type===x.type;})[0];if(ex){out.push(ex);return;}var row={hazard_id:_ppkId_('HAZARD_ANALYSIS'),ppk_id:data.ppkId,organization_id:c.organizationId,location_id:c.locationId,process_id:x.process_id,product_id:'',stage_id:'',hazard_type:x.type,hazard_description:x.description,source:'AI_SUGGESTED/GENERATOR — требует подтверждения',likelihood:'',severity:'',risk_score:'',control_measure:'',classification:'',critical_limit:'',monitoring_method:'',monitoring_frequency:'',responsible_role:'',corrective_action:'',verification_method:'',record_type:'',human_confirmed:false,confirmed_by:'',confirmed_at:'',status:'AI_SUGGESTED',created_at:nowIso_()};insertRow_('HAZARD_ANALYSIS',row);out.push(row);});return out;
}

function confirmPpkHazard_(session,data){return withLock_(function(){var h=findOne_('HAZARD_ANALYSIS','hazard_id',data.hazardId);assertOwnedByOrg_(session,h,'HAZARD_ANALYSIS:'+data.hazardId);var p=findOne_('PPK_VERSIONS','ppk_id',h.ppk_id);assertOwnedByOrg_(session,p,'PPK_VERSIONS:'+h.ppk_id);if(p.status!=='DRAFT')throw new Error('Опасность можно подтверждать только в черновике ППК.');var patch=data.patch||{};_ppkAssertRef_(session,'PRODUCTS','product_id',patch.product_id||'',h.ppk_id,'PRODUCTS:'+(patch.product_id||''));_ppkAssertRef_(session,'PPK_FLOW_STAGES','stage_id',patch.stage_id||'',h.ppk_id,'PPK_FLOW_STAGES:'+(patch.stage_id||''));var allowed=['product_id','stage_id','likelihood','severity','risk_score','control_measure','classification','critical_limit','monitoring_method','monitoring_frequency','responsible_role','corrective_action','verification_method','record_type'];var safe={};allowed.forEach(function(k){if(patch[k]!==undefined)safe[k]=patch[k];});safe.human_confirmed=true;safe.confirmed_by=session.user_id;safe.confirmed_at=nowIso_();safe.status='CONFIRMED';updateRow_('HAZARD_ANALYSIS',h,safe);auditLog_(session.user_id,'Подтверждена опасность HACCP','HAZARD_ANALYSIS:'+h.hazard_id,h.status,JSON.stringify(safe),'success',session.cascade_id);return findOne_('HAZARD_ANALYSIS','hazard_id',h.hazard_id);});}

function generatePpkControls_(session,data){
  var c=_ppkCtx_(session,data.locationId), hazards=_ppkRows_('HAZARD_ANALYSIS',c.organizationId,c.locationId).filter(function(h){return h.ppk_id===data.ppkId && h.status==='CONFIRMED';}), existing=_ppkRows_('PPK_CONTROLS',c.organizationId,c.locationId).filter(function(r){return r.ppk_id===data.ppkId;}), out=[];
  hazards.forEach(function(h){var cls=h.classification||'PRP';if(PPK_POINT_TYPES.indexOf(cls)===-1)cls='PRP';var ex=existing.filter(function(x){return x.hazard_id===h.hazard_id;})[0];if(ex){out.push(ex);return;}var row={control_id:_ppkId_('PPK_CONTROLS'),ppk_id:data.ppkId,organization_id:c.organizationId,location_id:c.locationId,process_id:h.process_id,stage_id:h.stage_id,product_id:h.product_id,hazard_id:h.hazard_id,point_type:cls,control_name:h.control_measure||('Контроль: '+h.hazard_description),purpose:'Контроль опасности из подтвержденного анализа',risk_description:h.hazard_description,critical_limit_ref:'',monitoring_parameter:'',monitoring_method:h.monitoring_method||'',frequency:h.monitoring_frequency||'',responsible_role:h.responsible_role||'',journal_definition_id:'',corrective_action:h.corrective_action||'',verification_method:h.verification_method||'',status:'AI_SUGGESTED',human_confirmed:false,confirmed_by:'',confirmed_at:'',source:'PPK/HACCP',created_at:nowIso_()};insertRow_('PPK_CONTROLS',row);out.push(row);});return out;}

function confirmPpkControl_(session,data){return withLock_(function(){var x=findOne_('PPK_CONTROLS','control_id',data.controlId);assertOwnedByOrg_(session,x,'PPK_CONTROLS:'+data.controlId);var p=findOne_('PPK_VERSIONS','ppk_id',x.ppk_id);assertOwnedByOrg_(session,p,'PPK_VERSIONS:'+x.ppk_id);if(p.status!=='DRAFT')throw new Error('Контроль можно подтверждать только в черновике ППК.');var patch=data.patch||{}, safe={};['point_type','control_name','purpose','risk_description','critical_limit_ref','monitoring_parameter','monitoring_method','frequency','responsible_role','corrective_action','verification_method'].forEach(function(k){if(patch[k]!==undefined)safe[k]=patch[k];});var type=safe.point_type||x.point_type;if(PPK_POINT_TYPES.indexOf(type)===-1)throw new Error('Недопустимый тип контрольной точки.');safe.point_type=type;safe.human_confirmed=true;safe.confirmed_by=session.user_id;safe.confirmed_at=nowIso_();safe.status='CONFIRMED';updateRow_('PPK_CONTROLS',x,safe);auditLog_(session.user_id,'Подтверждена контрольная точка ППК','PPK_CONTROLS:'+x.control_id,x.status,JSON.stringify(safe),'success',session.cascade_id);return findOne_('PPK_CONTROLS','control_id',x.control_id);});}

function createPpkCriticalLimit_(session,data){return withLock_(function(){var c=_ppkCtx_(session,data.locationId),p=findOne_('PPK_VERSIONS','ppk_id',data.ppkId);assertOwnedByOrg_(session,p,'PPK_VERSIONS:'+data.ppkId);if(p.status!=='DRAFT')throw new Error('Критический предел можно менять только в черновике.');if(!data.parameter||!data.sourceDocument)throw new Error('Для критического предела обязательны parameter и sourceDocument.');_ppkAssertRef_(session,'PPK_CONTROLS','control_id',data.controlId||'',data.ppkId,'PPK_CONTROLS:'+(data.controlId||''));var row={limit_id:_ppkId_('PPK_CRITICAL_LIMITS'),ppk_id:data.ppkId,organization_id:c.organizationId,location_id:c.locationId,control_id:data.controlId||'',parameter:data.parameter,min_value:data.minValue===undefined?'':data.minValue,max_value:data.maxValue===undefined?'':data.maxValue,unit:data.unit||'',applicable_stage:data.stageId||'',applicable_product:data.productId||'',source:data.source||'USER_CONFIRMED',source_document:data.sourceDocument,effective_date:data.effectiveDate||todayDateStr_(),version:Number(data.version||1),approved_by:'',status:'DRAFT',created_at:nowIso_()};insertRow_('PPK_CRITICAL_LIMITS',row);auditLog_(session.user_id,'Создан критический предел ППК','PPK_CRITICAL_LIMITS:'+row.limit_id,'',JSON.stringify(row),'success',session.cascade_id);return row;});}

function approvePpkCriticalLimit_(session,data){return withLock_(function(){var r=findOne_('PPK_CRITICAL_LIMITS','limit_id',data.limitId);assertOwnedByOrg_(session,r,'PPK_CRITICAL_LIMITS:'+data.limitId);var p=findOne_('PPK_VERSIONS','ppk_id',r.ppk_id);assertOwnedByOrg_(session,p,'PPK_VERSIONS:'+r.ppk_id);if(p.status!=='DRAFT')throw new Error('Предел можно подтвердить только в черновике ППК.');if(!r.source_document)throw new Error('Предел без источника не может быть подтвержден.');updateRow_('PPK_CRITICAL_LIMITS',r,{status:'CONFIRMED',approved_by:session.user_id});return findOne_('PPK_CRITICAL_LIMITS','limit_id',r.limit_id);});}

function generatePpkJournals_(session,data){return withLock_(function(){var c=_ppkCtx_(session,data.locationId), controls=_ppkRows_('PPK_CONTROLS',c.organizationId,c.locationId).filter(function(x){return x.ppk_id===data.ppkId&&x.human_confirmed===true&&x.status==='CONFIRMED';}), created=[];controls.forEach(function(x){if(!x.monitoring_parameter || !x.frequency || !x.responsible_role) return;var source='PPK_CONTROL:'+x.control_id;var defs=findRows_('JOURNAL_DEFINITIONS',function(d){return d.organization_id===c.organizationId&&d.location_id===c.locationId&&d.source_document===source&&d.статус!=='архив';});var def=defs[0];if(!def){var limit=findRows_('PPK_CRITICAL_LIMITS',function(l){return l.control_id===x.control_id&&l.status==='CONFIRMED';})[0];def=createJournalDefinition_({organization_id:c.organizationId,location_id:c.locationId,workshop_id:'',journal_type:'PPK_'+String(x.monitoring_parameter).toUpperCase().replace(/[^A-Z0-9А-Яа-я]+/g,'_'),название:x.control_name,периодичность:x.frequency,роль_ответственная:x.responsible_role,equipment_id:'',мин_норма:limit?limit.min_value:'',макс_норма:limit?limit.max_value:'',единица:limit?limit.unit:'',source_type:'ppk',source_document:source,обязательность:true,ppk_id:data.ppkId,ppk_version:(findOne_('PPK_VERSIONS','ppk_id',data.ppkId)||{}).version},session.user_id,session);created.push(def);}var ctl=findOne_('PPK_CONTROLS','control_id',x.control_id);updateRow_('PPK_CONTROLS',ctl,{journal_definition_id:def.definition_id});});return {controls_processed:controls.length,journals_created:created.length,journals:created};});}

function generatePpkLabProgram_(session,data){
  var c=_ppkCtx_(session,data.locationId), controls=_ppkRows_('PPK_CONTROLS',c.organizationId,c.locationId).filter(function(x){return x.ppk_id===data.ppkId&&x.human_confirmed===true&&x.monitoring_parameter&&/lab|лаборат/i.test(x.monitoring_method||'');});
  var out=[]; controls.forEach(function(x){var defs=findRows_('LAB_TEST_DEFINITIONS',function(d){return d.organization_id===c.organizationId&&d.location_id===c.locationId&&d.source_document==='PPK_CONTROL:'+x.control_id&&d.статус!=='архив';});if(defs.length){out.push(defs[0]);return;}var d=createLabTestDefinition_({organization_id:c.organizationId,location_id:c.locationId,target_type:'PPK_CONTROL',target_id:x.control_id,target_name:x.control_name,тип_исследования:x.monitoring_parameter,периодичность_дней:30,роль_ответственная:x.responsible_role,source_document:'PPK_CONTROL:'+x.control_id},session.user_id,session);out.push(d);});return out;}

function buildPpkDocumentModel_(session,data){
  var c=_ppkCtx_(session,data.locationId), p=findOne_('PPK_VERSIONS','ppk_id',data.ppkId);assertOwnedByOrg_(session,p,'PPK_VERSIONS:'+data.ppkId);var ctx=getPpkGeneratorContext_(session,data), hazards=_ppkRows_('HAZARD_ANALYSIS',c.organizationId,c.locationId).filter(function(x){return x.ppk_id===data.ppkId;}), controls=_ppkRows_('PPK_CONTROLS',c.organizationId,c.locationId).filter(function(x){return x.ppk_id===data.ppkId;});
  var titles=['Общие положения','Характеристика предприятия','Область применения ППК','Нормативная и документальная база','Ответственные лица','Организация производства','Описание помещений и зон','Оборудование','Номенклатура продукции','Поставщики и входной контроль','Приемка сырья','Хранение','Технологические процессы','Блок-схемы движения продукта','Потоки сырья','Потоки полуфабрикатов','Потоки готовой продукции','Потоки отходов','Анализ опасностей HACCP','PRP','ППОПМ','КТ','ККТ','Критические пределы','Мониторинг','Корректирующие действия','Верификация','Лабораторный контроль','Медицинский контроль','Личная гигиена','Уборка и мойка','Дезинфекция','Pest Control','Вода','Вентиляция','Оборудование и измерительные средства','Химические средства','Отходы','Формы журналов','Лист утверждения'];
  var sections=titles.map(function(t,i){var body={};if(t==='Характеристика предприятия')body=ctx.organization;if(t==='Описание помещений и зон')body={location:ctx.location,workshops:ctx.workshops};if(t==='Оборудование')body=ctx.equipment;if(t==='Номенклатура продукции')body={products:ctx.products,dishes:ctx.dishes,semi_finished:ctx.semi_finished};if(t==='Поставщики и входной контроль')body=ctx.suppliers;if(t==='Анализ опасностей HACCP')body=hazards;if(['PRP','ППОПМ','КТ','ККТ','Мониторинг'].indexOf(t)>=0)body=controls.filter(function(x){return t==='Мониторинг'||x.point_type===t;});return {number:i+1,title:t,body:body,source_status:'GENERATED_FROM_TSEKH_DATA'};});
  var existing=findRows_('PPK_DOCUMENTS',function(r){return r.ppk_id===data.ppkId;})[0];var row={document_id:existing?existing.document_id:_ppkId_('PPK_DOCUMENTS'),ppk_id:data.ppkId,organization_id:c.organizationId,location_id:c.locationId,title:'Программа производственного контроля (ППК)',document_version:p.version,status:p.status,sections_json:JSON.stringify(sections),generated_at:nowIso_(),generated_by:session.user_id,file_id:existing?existing.file_id:'',url:existing?existing.url:'',checksum:''};if(existing)updateRow_('PPK_DOCUMENTS',existing,row);else insertRow_('PPK_DOCUMENTS',row);return {document_id:row.document_id,sections:sections,status:row.status};}

function getPpkModel_(session,data){var c=_ppkCtx_(session,data&&data.locationId),p=data&&data.ppkId?findOne_('PPK_VERSIONS','ppk_id',data.ppkId):getCurrentPpk_(c.organizationId);assertOwnedByOrg_(session,p,'PPK_VERSIONS');if(!p)throw new Error('ППК не найдена.');return {ppk:p,processes:_ppkRows_('PPK_PROCESSES',c.organizationId,c.locationId).filter(function(x){return x.ppk_id===p.ppk_id;}),stages:_ppkRows_('PPK_FLOW_STAGES',c.organizationId,c.locationId).filter(function(x){return x.ppk_id===p.ppk_id;}),flows:_ppkRows_('PPK_FLOWS',c.organizationId,c.locationId).filter(function(x){return x.ppk_id===p.ppk_id;}),hazards:_ppkRows_('HAZARD_ANALYSIS',c.organizationId,c.locationId).filter(function(x){return x.ppk_id===p.ppk_id;}),controls:_ppkRows_('PPK_CONTROLS',c.organizationId,c.locationId).filter(function(x){return x.ppk_id===p.ppk_id;}),limits:_ppkRows_('PPK_CRITICAL_LIMITS',c.organizationId,c.locationId).filter(function(x){return x.ppk_id===p.ppk_id;}),verification:_ppkRows_('PPK_VERIFICATION',c.organizationId,c.locationId).filter(function(x){return x.ppk_id===p.ppk_id;}),reviews:_ppkRows_('PPK_REVIEW_REQUESTS',c.organizationId,c.locationId).filter(function(x){return x.ppk_id===p.ppk_id;}),document:_ppkRows_('PPK_DOCUMENTS',c.organizationId,c.locationId).filter(function(x){return x.ppk_id===p.ppk_id;})[0]||null};}

function getPpkHazards_(session,data){var c=_ppkCtx_(session,data&&data.locationId);return _ppkRows_('HAZARD_ANALYSIS',c.organizationId,c.locationId).filter(function(x){return !data||!data.ppkId||x.ppk_id===data.ppkId;});}
function getPpkControls_(session,data){var c=_ppkCtx_(session,data&&data.locationId);return _ppkRows_('PPK_CONTROLS',c.organizationId,c.locationId).filter(function(x){return !data||!data.ppkId||x.ppk_id===data.ppkId;});}
function getPpkCompliance_(session,data){var m=getPpkModel_(session,data||{}),openDev=getDeviations_(session.organization_id,true),tasks=getTasks_(session.organization_id,session.location_id,{});return {ppk_id:m.ppk.ppk_id,status:m.ppk.status,counts:{processes:m.processes.length,stages:m.stages.length,flows:m.flows.length,hazards:m.hazards.length,confirmed_hazards:m.hazards.filter(function(x){return x.human_confirmed===true;}).length,controls:m.controls.length,confirmed_controls:m.controls.filter(function(x){return x.human_confirmed===true;}).length,critical_limits:m.limits.length,open_deviations:openDev.length,open_tasks:tasks.filter(function(x){return x.status!=='completed'&&x.status!=='выполнено';}).length},gates:buildPpkReadinessGate_(m)};}
function buildPpkReadinessGate_(m){var blockers=[];if(!m.ppk)blockers.push('NO_PPK');m.hazards.filter(function(x){return x.status==='AI_SUGGESTED';}).forEach(function(){blockers.push('UNCONFIRMED_HAZARD');});m.controls.filter(function(x){return x.status==='AI_SUGGESTED';}).forEach(function(){blockers.push('UNCONFIRMED_CONTROL');});m.controls.filter(function(x){return x.point_type==='ККТ'&&x.human_confirmed!==true;}).forEach(function(){blockers.push('CCP_NOT_HUMAN_CONFIRMED');});m.limits.filter(function(x){return x.status!=='CONFIRMED';}).forEach(function(){blockers.push('LIMIT_NOT_CONFIRMED');});return {status:blockers.length?'BLOCKED':'READY',blockers:_ppkUnique_(blockers),read_only:true};}

function createPpkVerification_(session,data){var c=_ppkCtx_(session,data.locationId),p=findOne_('PPK_VERSIONS','ppk_id',data.ppkId);assertOwnedByOrg_(session,p,'PPK_VERSIONS:'+data.ppkId);_ppkAssertRef_(session,'PPK_CONTROLS','control_id',data.controlId||'',data.ppkId,'PPK_CONTROLS:'+(data.controlId||''));var row={verification_id:_ppkId_('PPK_VERIFICATION'),ppk_id:data.ppkId,organization_id:c.organizationId,location_id:c.locationId,control_id:data.controlId||'',method:data.method||'',frequency:data.frequency||'',responsible_role:data.responsibleRole||'',evidence_source:data.evidenceSource||'',result:data.result||'PENDING',verified_at:data.verifiedAt||'',status:'PENDING',notes:data.notes||'',created_by:session.user_id,created_at:nowIso_()};insertRow_('PPK_VERIFICATION',row);return row;}
function completePpkVerification_(session,data){var r=findOne_('PPK_VERIFICATION','verification_id',data.verificationId);assertOwnedByOrg_(session,r,'PPK_VERIFICATION:'+data.verificationId);if(String(data.result||'').toUpperCase()!=='PASS')throw new Error('Верификация ППК закрывается только результатом PASS.');updateRow_('PPK_VERIFICATION',r,{result:'PASS',verified_at:nowIso_(),status:'VERIFIED',notes:data.notes||r.notes});auditLog_(session.user_id,'Выполнена верификация ППК','PPK_VERIFICATION:'+r.verification_id,r.status,'VERIFIED','success',session.cascade_id);return findOne_('PPK_VERIFICATION','verification_id',r.verification_id);}

function requestPpkReview_(session,data){return withLock_(function(){var c=_ppkCtx_(session,data.locationId),p=findOne_('PPK_VERSIONS','ppk_id',data.ppkId);assertOwnedByOrg_(session,p,'PPK_VERSIONS:'+data.ppkId);var row={review_id:_ppkId_('PPK_REVIEW_REQUESTS'),ppk_id:data.ppkId,organization_id:c.organizationId,location_id:c.locationId,reason_type:data.reasonType||'MANUAL',reason:data.reason||'',source_entity_type:data.sourceEntityType||'',source_entity_id:data.sourceEntityId||'',impact_json:JSON.stringify(data.impact||{}),status:'OPEN',created_by:session.user_id,created_at:nowIso_(),resolved_at:'',resolved_by:''};insertRow_('PPK_REVIEW_REQUESTS',row);auditLog_(session.user_id,'Создан запрос пересмотра ППК','PPK_REVIEW_REQUESTS:'+row.review_id,'',JSON.stringify(row),'success',session.cascade_id);return row;});}
function getPpkImpactAnalysis_(session,data){var c=_ppkCtx_(session,data.locationId),changeType=data.changeType||'MANUAL',sourceId=data.sourceEntityId||'';var affected=[];var rules={PRODUCT_ADDED:'product_id',RECIPE_CHANGED:'parent_id',SUPPLIER_CHANGED:'supplier_id',EQUIPMENT_ADDED:'equipment_id'};if(rules[changeType])affected.push({field:rules[changeType],source_entity_id:sourceId,impact:'POTENTIAL_HACCP_REVIEW'});return {organization_id:c.organizationId,location_id:c.locationId,change_type:changeType,affected:affected,review_required:affected.length>0||changeType==='PROCESS_CHANGED'||changeType==='ROOM_CHANGED'||changeType==='TEMPERATURE_CHANGED'||changeType==='CHEMICAL_CHANGED'||changeType==='RULE_CHANGED'||changeType==='LAB_PROGRAM_CHANGED',automatic_mutation:false};}
function recordPpkChange_(session,data){var impact=getPpkImpactAnalysis_(session,data);if(impact.review_required)return requestPpkReview_(session,{locationId:data.locationId,ppkId:data.ppkId,reasonType:data.changeType,reason:data.reason||'Изменение предприятия может влиять на HACCP',sourceEntityType:data.sourceEntityType,sourceEntityId:data.sourceEntityId,impact:impact});return impact;}
function getPpkTraceability_(session,data){var c=_ppkCtx_(session,data.locationId), batch=findOne_('BATCHES','batch_id',data.batchId);if(!batch) { _denyScope_(session,'BATCHES:'+data.batchId,'not_found'); } if(batch.location_id!==c.locationId) { _denyScope_(session,'BATCHES:'+data.batchId,'foreign_location'); } assertOwnedByOrg_(session, findOne_('PRODUCTS','product_id',batch.product_id),'BATCHES:'+data.batchId);var ops=findRows_('WAREHOUSE_OPS',function(r){return r.organization_id===c.organizationId&&r.location_id===c.locationId&&r.batch_id===data.batchId;});var prod=findRows_('PRODUCTION',function(r){return r.location_id===c.locationId&&r.batch_id===data.batchId;});return {batch:batch,warehouse_ops:ops,production:prod,backward:{batch_id:batch.batch_id,product_id:batch.product_id,supplier_id:(findOne_('PRODUCTS','product_id',batch.product_id)||{}).поставщик_id||'',upstream_batch_ids:ops.map(function(x){return x.batch_id;}).filter(Boolean)},forward:{batch_id:batch.batch_id,warehouse_ops:ops,production:prod}};}

function generatePpkDocument_(session,data){var m=buildPpkDocumentModel_(session,data);return m;}

/** Called by business contours after successful mutations; creates a review request for the active APPROVED PPK. */
function detectAndRequestPpkReview_(organizationId, locationId, changeType, sourceEntityType, sourceEntityId, actorUserId, session, reason) {
  try {
    if (!organizationId || typeof getCurrentPpk_ !== 'function') return null;
    if (!locationId) {
      var locations=findRows_('LOCATIONS',function(l){return l.organization_id===organizationId&&l.статус!=='архив';});
      var many=[]; locations.forEach(function(l){var r=detectAndRequestPpkReview_(organizationId,l.location_id,changeType,sourceEntityType,sourceEntityId,actorUserId,session,reason);if(r)many.push(r);});
      return many;
    }
    var active=getCurrentPpk_(organizationId);
    if (!active || active.status!=='APPROVED') return null;
    var impact=getPpkImpactAnalysis_(session || {organization_id:organizationId,location_id:locationId,allowed_locations:[locationId],user_id:actorUserId}, {locationId:locationId,changeType:changeType,sourceEntityId:sourceEntityId});
    if (!impact.review_required) return null;
    var existing=findRows_('PPK_REVIEW_REQUESTS',function(r){return r.ppk_id===active.ppk_id&&r.source_entity_id===sourceEntityId&&r.reason_type===changeType&&r.status==='OPEN';})[0];
    if(existing) return existing;
    var row={review_id:_ppkId_('PPK_REVIEW_REQUESTS'),ppk_id:active.ppk_id,organization_id:organizationId,location_id:locationId,reason_type:changeType,reason:reason||('Изменение '+changeType+' может влиять на HACCP.'),source_entity_type:sourceEntityType||'',source_entity_id:sourceEntityId||'',impact_json:JSON.stringify(impact),status:'OPEN',created_by:actorUserId||'',created_at:nowIso_(),resolved_at:'',resolved_by:''};
    insertRow_('PPK_REVIEW_REQUESTS',row);
    auditLog_(actorUserId,'Автоматически создан запрос пересмотра ППК','PPK_REVIEW_REQUESTS:'+row.review_id,'',JSON.stringify(row),'success',session?session.cascade_id:'');
    return row;
  } catch(e) {
    // Governance must not break the business mutation. The review engine is read/control layer.
    logSystemError_('detectAndRequestPpkReview_', actorUserId || '', 'PPK_REVIEW', e, 'NON_BLOCKING');
    return null;
  }
}

function buildProductFlow_(session,data){
  var c=_ppkCtx_(session,data.locationId), p=assertOwnedByOrg_(session,getProductById_(data.productId),'PRODUCTS:'+data.productId);
  var dishes=findRows_('DISHES',function(d){return d.organization_id===c.organizationId;});
  var hits=[];
  dishes.forEach(function(d){var lines=findRows_('RECIPES',function(r){return r.parent_type==='DISH'&&r.parent_id===d.dish_id&&r.product_id===p.product_id;});if(lines.length)hits.push({dish:d,recipe_lines:lines});});
  var semi=findRows_('SEMI_FINISHED',function(x){return x.organization_id===c.organizationId;});
  semi.forEach(function(x){var lines=findRows_('RECIPES',function(r){return r.parent_type==='PF'&&r.parent_id===x.pf_id&&r.product_id===p.product_id;});if(lines.length)hits.push({semi_finished:x,recipe_lines:lines});});
  var stages=_ppkRows_('PPK_FLOW_STAGES',c.organizationId,c.locationId).sort(function(a,b){return a.stage_code.localeCompare(b.stage_code);});
  return {product:p,used_in:hits,stages:stages,raw_flow:['SUPPLIER','BATCH','RECEIPT','STORAGE','PRODUCTION'],forward_flow:['PRODUCTION','FINISHED_STORAGE','DISTRIBUTION'],note:'Фактическая партия/операция определяется по BATCHES/WAREHOUSE_OPS/PRODUCTION; генератор не создаёт складские движения.'};
}
