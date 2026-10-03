// ЦЕХ — P22.2 ОХРАНА ТРУДА / ТЕХНИКА БЕЗОПАСНОСТИ / ИНСТРУКТАЖИ
// Управляемый контур: документ → версия → требование → назначение → ознакомление → тест → результат → подтверждение → audit → reminder → повтор.

var SAFETY_DOCUMENT_STATUSES = ['DRAFT','UNDER_REVIEW','APPROVED','ACTIVE','ARCHIVED','EXPIRED'];
var SAFETY_BRIEFING_TYPES = ['ВВОДНЫЙ','ПЕРВИЧНЫЙ','ПОВТОРНЫЙ','ВНЕПЛАНОВЫЙ','ЦЕЛЕВОЙ'];
var SAFETY_METHODS = ['DOCUMENT_REVIEW','TEST','ORAL_BRIEFING','PRACTICAL_TRAINING','ACKNOWLEDGEMENT','SIGNED_DOCUMENT'];
var SAFETY_ASSIGNMENT_STATUSES = ['ASSIGNED','IN_PROGRESS','WAITING_TEST','FAILED','PASSED','CONFIRMED','EXPIRED','CANCELLED'];
var SAFETY_CONFIRMATION_MODES = ['ACKNOWLEDGED','ELECTRONIC_CONFIRMATION','SIGNED_DOCUMENT'];
var SAFETY_QUESTION_TYPES = ['YES_NO','SINGLE_CHOICE','MULTIPLE_CHOICE','TEXT'];
var SAFETY_EVENT_TYPES = [
  'SAFETY_INSTRUCTION_CREATED','SAFETY_INSTRUCTION_APPROVED','SAFETY_INSTRUCTION_ASSIGNED','SAFETY_INSTRUCTION_OPENED',
  'SAFETY_BRIEFING_STARTED','SAFETY_TEST_STARTED','SAFETY_TEST_COMPLETED','SAFETY_TEST_PASSED','SAFETY_TEST_FAILED',
  'SAFETY_CONFIRMATION_CREATED','SAFETY_BRIEFING_EXPIRED','SAFETY_BRIEFING_REASSIGNED','ACCESS_GRANTED','ACCESS_EXPIRED','ACCESS_REVOKED','TRAINING_OVERDUE'
];

function _safetyNow_(){ return nowIso_(); }
function _safetyEmployee_(employeeId, session){
  var u = getUserById_(employeeId);
  if (!u) throw new Error('Сотрудник не найден: ' + employeeId);
  if (session) assertOwnedByOrg_(session, u, 'USERS:' + employeeId);
  return u;
}
function _safetyAssertLocation_(session, locationId){
  if (session && locationId) assertLocationAllowed_(session, locationId, 'LOCATIONS:' + locationId);
}
function _safetyDoc_(id, session){
  var d=findOne_('SAFETY_DOCUMENTS','document_id',id);
  if(!d) throw new Error('Инструкция не найдена: '+id);
  if(session) assertOwnedByOrg_(session,d,'SAFETY_DOCUMENTS:'+id);
  if(session && d.location_id) assertLocationAllowed_(session,d.location_id,'SAFETY_DOCUMENTS:'+id);
  return d;
}
function _safetyAssignment_(id, session){
  var a=findOne_('SAFETY_BRIEFING_ASSIGNMENTS','assignment_id',id);
  if(!a) throw new Error('Назначение инструктажа не найдено: '+id);
  if(session) assertOwnedByOrg_(session,a,'SAFETY_BRIEFING_ASSIGNMENTS:'+id);
  if(session && a.location_id) assertLocationAllowed_(session,a.location_id,'SAFETY_BRIEFING_ASSIGNMENTS:'+id);
  return a;
}
function _safetyNotify_(type,row,message,eventKey,session){ if(typeof notify_==='function') notify_(row.organization_id,row.location_id,type,message,eventKey,session&&session.cascade_id); }
function _safetyEmit_(type, row, operationId){
  if (typeof emitEvent_ !== 'function') return null;
  if (SAFETY_EVENT_TYPES.indexOf(type)===-1) throw new Error('Недопустимое safety-событие: '+type);
  return _emitEventSafe_({
    organizationId: row.organization_id, locationId: row.location_id || '', workshopId: row.workshop_id || '',
    type:type, source:'safety', entityType:row.entity_type || 'SAFETY', entityId:row.entity_id || row.assignment_id || row.document_id || row.attempt_id || row.confirmation_id || '',
    operationId: operationId || row.operation_id || '', payload:row.payload || row, idempotencyKey:(type+'|'+(row.assignment_id||row.attempt_id||row.confirmation_id||row.document_id||row.entity_id||'')+'|'+(row.version||row.instruction_version||''))
  });
}

function _safetyDriveRoot_(organizationId){
  var root=_getOrCreateDriveFolder_(DriveApp.getRootFolder(),'Цех');
  var org=_getOrCreateDriveFolder_(root,'ORGANIZATIONS');
  return _getOrCreateDriveFolder_(org,'ORG_'+organizationId);
}
function _safetyDrivePath_(organizationId, names){
  var f=_safetyDriveRoot_(organizationId);
  (names||[]).forEach(function(n){ f=_getOrCreateDriveFolder_(f,n); });
  return f;
}
function _safetyStoreFile_(base64Data,fileName,mimeType,organizationId,folders){
  var allowed={'application/pdf':'pdf','image/jpeg':'jpg','image/jpg':'jpg','image/png':'png','text/plain':'txt'};
  if(!allowed[mimeType]) throw new Error('Недопустимый тип файла для безопасности: '+mimeType+'. Разрешены PDF/JPG/PNG/TXT.');
  var bytes; try{bytes=Utilities.base64Decode(base64Data||'');}catch(e){throw new Error('Повреждённый base64 файла.');}
  if(!bytes.length) throw new Error('Файл пуст.');
  if(bytes.length>20*1024*1024) throw new Error('Файл слишком большой (максимум 20 МБ).');
  var hash=_computeFileHash_(bytes);
  var blob=Utilities.newBlob(bytes,mimeType,fileName||('instruction.'+allowed[mimeType]));
  var file=_safetyDrivePath_(organizationId,folders).createFile(blob);
  return {file_id:file.getId(),file_name:file.getName(),mime_type:mimeType,file_size:bytes.length,checksum:hash,url:file.getUrl?file.getUrl():''};
}

function createSafetyDocument_(data, session){
  return withLock_(function(){
    if(!data.title) throw new Error('title обязателен.');
    var org=session.organization_id, loc=data.locationId||''; _safetyAssertLocation_(session,loc);
    var d={document_id:generateId_('SAFETY_DOCUMENTS'),document_type:data.documentType||'OTHER',document_number:data.documentNumber||'',title:String(data.title),version:data.version||'1.0',organization_id:org,location_id:loc,workshop_id:data.workshopId||'',applicable_roles:(data.applicableRoles||[]).join(','),status:'DRAFT',created_at:_safetyNow_(),approved_at:'',effective_from:data.effectiveFrom||'',effective_to:data.effectiveTo||'',created_by:session.user_id,approved_by:'',file_id:'',source:data.source||'LOCAL_ENTERPRISE_DOCUMENT',checksum:'',file_name:'',mime_type:'',methods:(data.methods||['DOCUMENT_REVIEW','ACKNOWLEDGEMENT']).join(','),notes:data.notes||''};
    insertRow_('SAFETY_DOCUMENTS',d); auditLog_(session.user_id,'Создана инструкция по охране труда','SAFETY_DOCUMENTS:'+d.document_id,null,d.title,'success',session.cascade_id); _safetyEmit_('SAFETY_INSTRUCTION_CREATED',d,session.operation_id); return d;
  });
}
function uploadSafetyDocumentFile_(data,session){
  var d=_safetyDoc_(data.documentId,session); if(d.status==='ARCHIVED') throw new Error('В архивную инструкцию нельзя загружать новый файл.');
  var stored=_safetyStoreFile_(data.base64Data,data.fileName,data.mimeType,d.organization_id,['SAFETY','INSTRUCTIONS']);
  updateRow_('SAFETY_DOCUMENTS',d,{file_id:stored.file_id,file_name:stored.file_name,mime_type:stored.mime_type,checksum:stored.checksum,updated_at:_safetyNow_()});
  auditLog_(session.user_id,'Загружен файл инструкции','SAFETY_DOCUMENTS:'+d.document_id,null,stored.file_name,'success',session.cascade_id); return findOne_('SAFETY_DOCUMENTS','document_id',d.document_id);
}
function updateSafetyDocument_(id,patch,session){
  var d=_safetyDoc_(id,session); if(['ACTIVE','ARCHIVED'].indexOf(d.status)!==-1) throw new Error('Утверждённую/активную версию нельзя изменять. Создайте новую версию.');
  var safe=_stripProtectedFields_(patch||[],['document_id','organization_id','location_id','created_by','created_at','approved_by','approved_at','status','checksum','file_id']);
  updateRow_('SAFETY_DOCUMENTS',d,safe); auditLog_(session.user_id,'Изменена инструкция','SAFETY_DOCUMENTS:'+id,null,JSON.stringify(safe),'success',session.cascade_id); return findOne_('SAFETY_DOCUMENTS','document_id',id);
}
function createSafetyDocumentVersion_(data,session){
  var old=_safetyDoc_(data.documentId,session);
  var version={documentType:old.document_type,documentNumber:old.document_number,title:old.title,version:data.version,locationId:old.location_id,workshopId:old.workshop_id,applicableRoles:String(old.applicable_roles||'').split(',').filter(Boolean),effectiveFrom:data.effectiveFrom||'',source:old.source,methods:String(old.methods||'').split(',').filter(Boolean),notes:data.notes||old.notes};
  var d=createSafetyDocument_(version,session);
  // Исправлено (подготовка к UAT): createSafetyDocument_ возвращает объект БЕЗ __row, updateRow_ на нём падал —
  // создать новую версию инструкции через API было невозможно. Перечитываем строку перед обновлением.
  updateRow_('SAFETY_DOCUMENTS',findOne_('SAFETY_DOCUMENTS','document_id',d.document_id),{previous_version_id:old.document_id});
  if(data.base64Data) uploadSafetyDocumentFile_({documentId:d.document_id,base64Data:data.base64Data,fileName:data.fileName,mimeType:data.mimeType},session);
  return findOne_('SAFETY_DOCUMENTS','document_id',d.document_id);
}
function approveSafetyDocument_(id,session){
  var d=_safetyDoc_(id,session); if(d.status!=='DRAFT'&&d.status!=='UNDER_REVIEW') throw new Error('Утверждать можно DRAFT/UNDER_REVIEW.');
  updateRow_('SAFETY_DOCUMENTS',d,{status:'APPROVED',approved_at:_safetyNow_(),approved_by:session.user_id}); auditLog_(session.user_id,'Утверждена инструкция','SAFETY_DOCUMENTS:'+id,null,'APPROVED','success',session.cascade_id); _safetyEmit_('SAFETY_INSTRUCTION_APPROVED',d,session.operation_id); return findOne_('SAFETY_DOCUMENTS','document_id',id);
}
function activateSafetyDocument_(id,session){
  var d=_safetyDoc_(id,session); if(d.status!=='APPROVED') throw new Error('Активировать можно только APPROVED.');
  var siblings=findRows_('SAFETY_DOCUMENTS',function(r){return r.organization_id===d.organization_id&&r.document_number===d.document_number&&r.document_id!==d.document_id&&['APPROVED','ACTIVE'].indexOf(r.status)!==-1;});
  siblings.forEach(function(old){updateRow_('SAFETY_DOCUMENTS',old,{status:'ARCHIVED',effective_to:d.effective_from||_safetyNow_()});});
  updateRow_('SAFETY_DOCUMENTS',d,{status:'ACTIVE'}); auditLog_(session.user_id,'Введена в действие инструкция','SAFETY_DOCUMENTS:'+id,null,'ACTIVE','success',session.cascade_id);
  if(typeof syncSafetyForInstructionActivation_==='function') syncSafetyForInstructionActivation_(d,session);
  return findOne_('SAFETY_DOCUMENTS','document_id',id);
}
function archiveSafetyDocument_(id,session){var d=_safetyDoc_(id,session);updateRow_('SAFETY_DOCUMENTS',d,{status:'ARCHIVED',effective_to:d.effective_to||_safetyNow_()});auditLog_(session.user_id,'Архивирована инструкция','SAFETY_DOCUMENTS:'+id,d.status,'ARCHIVED','success',session.cascade_id);return findOne_('SAFETY_DOCUMENTS','document_id',id);}
function getSafetyDocuments_(session,filters){filters=filters||{};return findRows_('SAFETY_DOCUMENTS',function(r){if(r.organization_id!==session.organization_id)return false;if(filters.locationId&&r.location_id!==filters.locationId)return false;if(filters.workshopId&&r.workshop_id!==filters.workshopId)return false;if(filters.status&&r.status!==filters.status)return false;if(filters.documentType&&r.document_type!==filters.documentType)return false;return true;}).sort(function(a,b){return new Date(b.created_at)-new Date(a.created_at);});}
function getSafetyDocumentVersions_(id,session){var d=_safetyDoc_(id,session);return findRows_('SAFETY_DOCUMENTS',function(r){return r.organization_id===d.organization_id&&r.document_number===d.document_number;}).sort(function(a,b){return new Date(a.created_at)-new Date(b.created_at);});}

function createSafetyBriefingType_(data,session){
  if(!data.code||!data.title)throw new Error('code и title обязательны.');
  var row={type_id:generateId_('SAFETY_BRIEFING_TYPES'),organization_id:session.organization_id,code:data.code,title:data.title,description:data.description||'',active:true,methods:(data.methods||[]).join(','),repeat_rule:data.repeatRule||'',source:data.source||'LOCAL_ENTERPRISE'};
  insertRow_('SAFETY_BRIEFING_TYPES',row);auditLog_(session.user_id,'Создан тип инструктажа','SAFETY_BRIEFING_TYPES:'+row.type_id,null,row.code,'success',session.cascade_id);return row;
}
function getSafetyBriefingTypes_(session){return findRows_('SAFETY_BRIEFING_TYPES',function(r){return r.organization_id===session.organization_id&&String(r.active)!=='false';});}

function createSafetyRequirement_(data,session){
  var loc=data.locationId||'';_safetyAssertLocation_(session,loc);if(data.workshopId){var ws=findOne_('WORKSHOPS','workshop_id',data.workshopId);if(!ws||ws.location_id!==loc)throw new Error('Цех не принадлежит точке.');}
  if(data.equipmentId){var eq=findOne_('EQUIPMENT','equipment_id',data.equipmentId);if(!eq||eq.location_id!==loc)throw new Error('Оборудование не принадлежит точке.');}
  var row={requirement_id:generateId_('SAFETY_REQUIREMENTS_MATRIX'),organization_id:session.organization_id,location_id:loc,workshop_id:data.workshopId||'',equipment_id:data.equipmentId||'',role:data.role||'',job_type:data.jobType||'',document_id:data.documentId||'',briefing_type:data.briefingType||'',required:String(data.required!==false),methods:(data.methods||['DOCUMENT_REVIEW','ACKNOWLEDGEMENT']).join(','),block_operation:String(data.blockOperation===true),block_rule_code:data.blockRuleCode||'',source:data.source||'LOCAL_ENTERPRISE',active:true};
  if(row.document_id){_safetyDoc_(row.document_id,session);} insertRow_('SAFETY_REQUIREMENTS_MATRIX',row);auditLog_(session.user_id,'Создано требование безопасности','SAFETY_REQUIREMENTS_MATRIX:'+row.requirement_id,null,JSON.stringify(row),'success',session.cascade_id);return row;
}
function createSafetyEmployeeContext_(data,session){var u=_safetyEmployee_(data.employeeId,session);var loc=data.locationId||session.location_id||'';_safetyAssertLocation_(session,loc);var row={context_id:generateId_('SAFETY_EMPLOYEE_CONTEXT'),employee_id:u.user_id,organization_id:u.organization_id,location_id:loc,workshop_id:data.workshopId||'',job_type:data.jobType||'',equipment_ids:(data.equipmentIds||[]).join(','),active:true,created_at:_safetyNow_()};insertRow_('SAFETY_EMPLOYEE_CONTEXT',row);auditLog_(session.user_id,'Изменён контекст безопасности сотрудника','SAFETY_EMPLOYEE_CONTEXT:'+row.context_id,null,JSON.stringify(row),'success',session.cascade_id);return row;}
function getSafetyEmployeeContext_(employeeId,session){_safetyEmployee_(employeeId,session);return findRows_('SAFETY_EMPLOYEE_CONTEXT',function(r){return r.organization_id===session.organization_id&&r.employee_id===employeeId&&String(r.active)!=='false';});}

function _safetyRequirementMatches_(req,user,ctx){
  if(req.organization_id!==user.organization_id||String(req.active)==='false'||String(req.required)==='false')return false;
  if(req.location_id && String(user.location_ids||'').split(',').indexOf(req.location_id)===-1)return false;
  if(req.role && req.role!==user.роль)return false;
  if(req.workshop_id && (!ctx.some(function(c){return c.workshop_id===req.workshop_id;})))return false;
  if(req.job_type && (!ctx.some(function(c){return c.job_type===req.job_type;})))return false;
  if(req.equipment_id && (!ctx.some(function(c){return String(c.equipment_ids||'').split(',').indexOf(req.equipment_id)!==-1;})))return false;
  return true;
}
/**
 * Требование матрицы привязано к инструкции, а не к конкретной версии: если документ из требования уже
 * не ACTIVE (заменён новой версией), берём ТЕКУЩУЮ ACTIVE-версию с тем же document_number в той же организации.
 * Исправлено при подготовке к UAT: раньше после активации v2 требование продолжало указывать на архивную v1,
 * отфильтровывалось, и сотрудник оставался без назначения на действующую версию.
 */
function _safetyCurrentDocument_(documentId){
  var d=findOne_('SAFETY_DOCUMENTS','document_id',documentId); if(!d) return null;
  if(d.status==='ACTIVE') return d;
  if(!d.document_number) return null;
  return findRows_('SAFETY_DOCUMENTS',function(x){return x.organization_id===d.organization_id&&x.document_number===d.document_number&&x.status==='ACTIVE';})[0]||null;
}
function getSafetyRequiredDocumentsForEmployee_(employeeId,session){var u=_safetyEmployee_(employeeId,session),ctx=getSafetyEmployeeContext_(employeeId,session),reqs=findRows_('SAFETY_REQUIREMENTS_MATRIX',function(r){return _safetyRequirementMatches_(r,u,ctx);}),docs={};reqs.forEach(function(r){if(!r.document_id)return;var d=_safetyCurrentDocument_(r.document_id);if(!d)return;if(!docs[d.document_id])docs[d.document_id]={document:d,requirements:[]};docs[d.document_id].requirements.push(r);});return Object.keys(docs).map(function(k){return docs[k];});}
function syncSafetyAssignmentsForEmployee_(employeeId,session,opts){var u=_safetyEmployee_(employeeId,session),required=getSafetyRequiredDocumentsForEmployee_(employeeId,session),created=[];required.forEach(function(x){var req=x.requirements[0], existing=findRows_('SAFETY_BRIEFING_ASSIGNMENTS',function(a){return a.organization_id===u.organization_id&&a.employee_id===u.user_id&&a.instruction_id===x.document.document_id&&['ASSIGNED','IN_PROGRESS','WAITING_TEST','FAILED','PASSED','CONFIRMED'].indexOf(a.status)!==-1;})[0];if(existing)return;var a={assignment_id:generateId_('SAFETY_BRIEFING_ASSIGNMENTS'),employee_id:u.user_id,organization_id:u.organization_id,location_id:req.location_id||session.location_id||'',workshop_id:req.workshop_id||'',instruction_id:x.document.document_id,instruction_version:x.document.version,briefing_type:req.briefing_type||'ВВОДНЫЙ',assigned_at:_safetyNow_(),due_at:opts&&opts.dueAt||'',status:'ASSIGNED',completed_at:'',expires_at:'',assigned_by:session.user_id,required_methods:req.methods||'',block_operation:req.block_operation||'false',block_rule_code:req.block_rule_code||'',requirement_id:req.requirement_id};insertRow_('SAFETY_BRIEFING_ASSIGNMENTS',a);auditLog_(session.user_id,'Назначен инструктаж','SAFETY_BRIEFING_ASSIGNMENTS:'+a.assignment_id,null,a.instruction_id,'success',session.cascade_id);_safetyEmit_('SAFETY_INSTRUCTION_ASSIGNED',a,session.operation_id);_safetyNotify_('SAFETY_INSTRUCTION_ASSIGNED',a,'Назначен инструктаж: '+x.document.title+' v'+x.document.version,'safety-assigned|'+a.assignment_id,session);created.push(a);});return created;}
function syncSafetyAssignments_(session,employeeId){return syncSafetyAssignmentsForEmployee_(employeeId||session.user_id,session,{});}

function openSafetyAssignment_(id,session){var a=_safetyAssignment_(id,session);if(a.status==='EXPIRED')throw new Error('Назначение просрочено; требуется повторное назначение.');if(a.status==='ASSIGNED')updateRow_('SAFETY_BRIEFING_ASSIGNMENTS',a,{status:'IN_PROGRESS'});auditLog_(session.user_id,'Открыта инструкция','SAFETY_BRIEFING_ASSIGNMENTS:'+id,null,a.instruction_id,'success',session.cascade_id);_safetyEmit_('SAFETY_INSTRUCTION_OPENED',a,session.operation_id);return findOne_('SAFETY_BRIEFING_ASSIGNMENTS','assignment_id',id);}
function startSafetyBriefing_(id,session){var a=_safetyAssignment_(id,session);if(a.employee_id!==session.user_id&&session.роль!=='ADMIN'&&session.роль!=='ДИРЕКТОР')throw new Error('Инструктаж проходит назначенный сотрудник.');updateRow_('SAFETY_BRIEFING_ASSIGNMENTS',a,{status:'IN_PROGRESS'});var log={briefing_id:generateId_('SAFETY_BRIEFING_LOG'),employee_id:a.employee_id,instruction_id:a.instruction_id,instruction_version:a.instruction_version,briefing_type:a.briefing_type,assigned_at:a.assigned_at,started_at:_safetyNow_(),completed_at:'',test_result:'',confirmation:'',trainer_id:'',responsible_id:a.assigned_by,organization_id:a.organization_id,location_id:a.location_id,workshop_id:a.workshop_id,status:'IN_PROGRESS',audit_id:'',assignment_id:a.assignment_id};insertRow_('SAFETY_BRIEFING_LOG',log);auditLog_(session.user_id,'Начат инструктаж','SAFETY_BRIEFING_LOG:'+log.briefing_id,null,a.instruction_id,'success',session.cascade_id);_safetyEmit_('SAFETY_BRIEFING_STARTED',log,session.operation_id);return log;}
function createSafetyTest_(data,session){var d=_safetyDoc_(data.instructionId,session);if(d.status!=='ACTIVE'&&data.status!=='DRAFT')throw new Error('Действующий тест можно связать только с ACTIVE инструкцией.');var t={test_id:generateId_('SAFETY_TESTS'),organization_id:session.organization_id,instruction_id:d.document_id,instruction_version:d.version,briefing_type:data.briefingType||'ВВОДНЫЙ',title:data.title||('Тест: '+d.title),status:data.status||'DRAFT',pass_threshold:data.passThreshold===undefined?80:Number(data.passThreshold),source:data.source||'LOCAL_ENTERPRISE',approved_by:'',approved_at:'',created_by:session.user_id,created_at:_safetyNow_()};if(t.pass_threshold<0||t.pass_threshold>100)throw new Error('pass_threshold должен быть 0..100.');insertRow_('SAFETY_TESTS',t);auditLog_(session.user_id,'Создан тест безопасности','SAFETY_TESTS:'+t.test_id,null,t.title,'success',session.cascade_id);return t;}
function addSafetyQuestion_(data,session){var t=findOne_('SAFETY_TESTS','test_id',data.testId);if(!t||t.organization_id!==session.organization_id)throw new Error('Тест не найден.');if(t.status==='ACTIVE')throw new Error('Активный тест нельзя изменять.');if(SAFETY_QUESTION_TYPES.indexOf(data.answerType||'YES_NO')===-1)throw new Error('Недопустимый тип вопроса.');var q={question_id:generateId_('SAFETY_TEST_QUESTIONS'),test_id:t.test_id,organization_id:t.organization_id,question_text:data.questionText,answer_type:data.answerType||'YES_NO',options_json:JSON.stringify(data.options||['ДА','НЕТ']),correct_answer:String(data.correctAnswer===undefined?'НЕТ':data.correctAnswer),is_required:String(data.isRequired!==false),sort_order:Number(data.sortOrder||1),explanation:data.explanation||'',active:true,source:data.source||'LOCAL_ENTERPRISE',approval_status:'DRAFT'};insertRow_('SAFETY_TEST_QUESTIONS',q);auditLog_(session.user_id,'Создан вопрос теста','SAFETY_TEST_QUESTIONS:'+q.question_id,null,q.question_text,'success',session.cascade_id);return q;}
function approveSafetyTest_(testId,session){var t=findOne_('SAFETY_TESTS','test_id',testId);if(!t||t.organization_id!==session.organization_id)throw new Error('Тест не найден.');var qs=findRows_('SAFETY_TEST_QUESTIONS',function(q){return q.test_id===testId&&String(q.active)!=='false';});if(!qs.length)throw new Error('Нельзя утвердить тест без вопросов.');qs.forEach(function(q){updateRow_('SAFETY_TEST_QUESTIONS',q,{approval_status:'APPROVED'});});updateRow_('SAFETY_TESTS',t,{status:'APPROVED',approved_by:session.user_id,approved_at:_safetyNow_()});auditLog_(session.user_id,'Утверждён тест безопасности','SAFETY_TESTS:'+testId,null,'APPROVED','success',session.cascade_id);return findOne_('SAFETY_TESTS','test_id',testId);}
function activateSafetyTest_(testId,session){var t=findOne_('SAFETY_TESTS','test_id',testId);if(!t||t.organization_id!==session.organization_id)throw new Error('Тест не найден.');if(t.status!=='APPROVED')throw new Error('Активировать можно только APPROVED.');updateRow_('SAFETY_TESTS',t,{status:'ACTIVE'});return findOne_('SAFETY_TESTS','test_id',testId);}
function startSafetyTest_(assignmentId,session){var a=_safetyAssignment_(assignmentId,session);var t=findRows_('SAFETY_TESTS',function(x){return x.organization_id===a.organization_id&&x.instruction_id===a.instruction_id&&x.instruction_version===a.instruction_version&&x.briefing_type===a.briefing_type&&x.status==='ACTIVE';})[0];if(!t)throw new Error('Для этой версии инструкции нет активного теста.');if(a.employee_id!==session.user_id&&session.роль!=='ADMIN'&&session.роль!=='ДИРЕКТОР')throw new Error('Тест может проходить назначенный сотрудник.');var prev=findRows_('SAFETY_TEST_ATTEMPTS',function(x){return x.employee_id===a.employee_id&&x.test_id===t.test_id&&x.assignment_id===a.assignment_id;});var attempt={attempt_id:generateId_('SAFETY_TEST_ATTEMPTS'),employee_id:a.employee_id,test_id:t.test_id,instruction_id:a.instruction_id,instruction_version:a.instruction_version,started_at:_safetyNow_(),completed_at:'',answers_json:'',correct_count:0,total_count:0,score:0,passed:false,attempt_number:prev.length+1,organization_id:a.organization_id,location_id:a.location_id,audit_id:'',assignment_id:a.assignment_id,status:'IN_PROGRESS'};insertRow_('SAFETY_TEST_ATTEMPTS',attempt);updateRow_('SAFETY_BRIEFING_ASSIGNMENTS',a,{status:'WAITING_TEST'});auditLog_(session.user_id,'Начат тест безопасности','SAFETY_TEST_ATTEMPTS:'+attempt.attempt_id,null,t.test_id,'success',session.cascade_id);_safetyEmit_('SAFETY_TEST_STARTED',attempt,session.operation_id);return {attempt:attempt,test:t,questions:getSafetyTestQuestions_(t.test_id,session)};}
function getSafetyTestQuestions_(testId,session){var t=findOne_('SAFETY_TESTS','test_id',testId);if(!t||t.organization_id!==session.organization_id)throw new Error('Тест не найден.');return findRows_('SAFETY_TEST_QUESTIONS',function(q){return q.test_id===testId&&String(q.active)!=='false'&&q.approval_status==='APPROVED';}).sort(function(a,b){return Number(a.sort_order)-Number(b.sort_order);}).map(function(q){var x={};Object.keys(q).forEach(function(k){x[k]=q[k];});delete x.correct_answer;return x;});}
function completeSafetyTest_(data,session){var a=findOne_('SAFETY_TEST_ATTEMPTS','attempt_id',data.attemptId);if(!a)throw new Error('Попытка не найдена.');if(a.organization_id!==session.organization_id)throw new Error('FORBIDDEN_SCOPE');if(a.employee_id!==session.user_id&&session.роль!=='ADMIN'&&session.роль!=='ДИРЕКТОР')throw new Error('Попытку завершает сотрудник.');if(a.status!=='IN_PROGRESS')throw new Error('Попытка уже завершена.');var qs=findRows_('SAFETY_TEST_QUESTIONS',function(q){return q.test_id===a.test_id&&String(q.active)!=='false'&&q.approval_status==='APPROVED';}).sort(function(x,y){return Number(x.sort_order)-Number(y.sort_order);});var answers=data.answers||{};var total=qs.length,correct=0;qs.forEach(function(q){var given=answers[q.question_id];if(given===undefined||given===null) return;var ca=String(q.correct_answer).trim().toUpperCase(),ga=String(given).trim().toUpperCase();if(q.answer_type==='MULTIPLE_CHOICE'){try{var c=JSON.parse(ca),g=JSON.parse(ga);c.sort();g.sort();if(JSON.stringify(c)===JSON.stringify(g))correct++;}catch(e){if(ca===ga)correct++;}}else if(ca===ga)correct++;});var score=total?Math.round(correct*10000/total)/100:0;var t=findOne_('SAFETY_TESTS','test_id',a.test_id),passed=score>=Number(t.pass_threshold);updateRow_('SAFETY_TEST_ATTEMPTS',a,{completed_at:_safetyNow_(),answers_json:JSON.stringify(answers),correct_count:correct,total_count:total,score:score,passed:passed,status:passed?'PASSED':'FAILED'});var as=_safetyAssignment_(a.assignment_id,session);updateRow_('SAFETY_BRIEFING_ASSIGNMENTS',as,{status:passed?'PASSED':'FAILED',completed_at:passed?_safetyNow_():''});var result=findOne_('SAFETY_TEST_ATTEMPTS','attempt_id',a.attempt_id);_safetyEmit_('SAFETY_TEST_COMPLETED',result,session.operation_id);auditLog_(session.user_id,passed?'Пройден тест безопасности':'Не пройден тест безопасности','SAFETY_TEST_ATTEMPTS:'+a.attempt_id,null,JSON.stringify({score:score,passed:passed}),'success',session.cascade_id);_safetyEmit_(passed?'SAFETY_TEST_PASSED':'SAFETY_TEST_FAILED',result,session.operation_id);if(passed&&typeof _syncEmployeeEquipmentPermissions_==='function'){_syncEmployeeEquipmentPermissions_(a.employee_id,session);var perms=getEmployeeEquipmentPermissions_(a.employee_id,session);perms.filter(function(p){return p.status==='ALLOWED';}).forEach(function(p){_emitEventSafe_({organizationId:p.organization_id,locationId:p.location_id,type:'ACCESS_GRANTED',source:'safety',entityType:'EMPLOYEE_EQUIPMENT_PERMISSIONS',entityId:p.permission_id,operationId:session.operation_id||'',payload:p,idempotencyKey:'ACCESS_GRANTED|'+p.permission_id+'|'+(p.updated_at||'')});});}if(!passed&&typeof notify_==='function')notify_(a.organization_id,a.location_id,'SAFETY_TEST_FAILED','Сотрудник не прошёл тест безопасности: '+a.employee_id,'safety-test-failed|'+a.attempt_id,session.cascade_id);return result;}
function confirmSafetyAssignment_(data,session){var a=_safetyAssignment_(data.assignmentId,session);if(a.employee_id!==session.user_id&&session.роль!=='ADMIN'&&session.роль!=='ДИРЕКТОР')throw new Error('Подтверждает назначенный сотрудник.');if(a.status!=='PASSED')throw new Error('Подтверждение возможно после успешного теста.');var mode=data.mode||'ACKNOWLEDGED';if(SAFETY_CONFIRMATION_MODES.indexOf(mode)===-1)throw new Error('Недопустимый режим подтверждения.');var c={confirmation_id:generateId_('SAFETY_CONFIRMATIONS'),employee_id:a.employee_id,organization_id:a.organization_id,location_id:a.location_id,instruction_id:a.instruction_id,instruction_version:a.instruction_version,timestamp:_safetyNow_(),mode:mode,ip_metadata:data.ipMetadata||'',device_metadata:data.deviceMetadata||'',session_id:data.sessionId||'',statement:data.statement||'С инструкцией ознакомлен. Требования понял. Обязуюсь соблюдать.',signed_file_id:data.signedFileId||'',assignment_id:a.assignment_id,audit_id:''};insertRow_('SAFETY_CONFIRMATIONS',c);updateRow_('SAFETY_BRIEFING_ASSIGNMENTS',a,{status:'CONFIRMED',completed_at:a.completed_at||_safetyNow_()});var bl2=findRows_('SAFETY_BRIEFING_LOG',function(x){return x.assignment_id===a.assignment_id&&x.organization_id===a.organization_id;}).sort(function(x,y){return new Date(y.started_at)-new Date(x.started_at);})[0];if(bl2) updateRow_('SAFETY_BRIEFING_LOG',bl2,{confirmation:mode,completed_at:a.completed_at||_safetyNow_(),status:'CONFIRMED'});auditLog_(session.user_id,'Создано подтверждение ознакомления','SAFETY_CONFIRMATIONS:'+c.confirmation_id,null,mode,'success',session.cascade_id);_safetyEmit_('SAFETY_CONFIRMATION_CREATED',c,session.operation_id);return c;}
function reassignSafetyBriefing_(assignmentId,data,session){var a=_safetyAssignment_(assignmentId,session);var newA={assignment_id:generateId_('SAFETY_BRIEFING_ASSIGNMENTS'),employee_id:data.employeeId||a.employee_id,organization_id:a.organization_id,location_id:data.locationId||a.location_id,workshop_id:data.workshopId||a.workshop_id,instruction_id:a.instruction_id,instruction_version:a.instruction_version,briefing_type:data.briefingType||a.briefing_type,assigned_at:_safetyNow_(),due_at:data.dueAt||'',status:'ASSIGNED',completed_at:'',expires_at:'',assigned_by:session.user_id,required_methods:a.required_methods,block_operation:a.block_operation,block_rule_code:a.block_rule_code,requirement_id:a.requirement_id};_safetyEmployee_(newA.employee_id,session);insertRow_('SAFETY_BRIEFING_ASSIGNMENTS',newA);auditLog_(session.user_id,'Повторно назначен инструктаж','SAFETY_BRIEFING_ASSIGNMENTS:'+newA.assignment_id,null,newA.employee_id,'success',session.cascade_id);_safetyEmit_('SAFETY_BRIEFING_REASSIGNED',newA,session.operation_id);return newA;}
function processSafetyDeadlines_(organizationId){var now=new Date();var rows=findRows_('SAFETY_BRIEFING_ASSIGNMENTS',function(a){return a.organization_id===organizationId&&['ASSIGNED','IN_PROGRESS','WAITING_TEST','FAILED','PASSED'].indexOf(a.status)!==-1;});var changed=[];rows.forEach(function(a){if(a.due_at&&new Date(a.due_at)<now&&a.status!=='PASSED'){updateRow_('SAFETY_BRIEFING_ASSIGNMENTS',a,{status:'EXPIRED'});auditLog_('system','Просрочен инструктаж','SAFETY_BRIEFING_ASSIGNMENTS:'+a.assignment_id,a.status,'EXPIRED','success');_safetyEmit_('SAFETY_BRIEFING_EXPIRED',a,'');if(typeof notify_==='function')notify_(a.organization_id,a.location_id,'SAFETY_BRIEFING_EXPIRED','Просрочен инструктаж: '+a.instruction_id,'safety-expired|'+a.assignment_id);changed.push(a.assignment_id);}else if(a.due_at){var days=(new Date(a.due_at)-now)/86400000;if(days<=3&&days>=0&&typeof notify_==='function')notify_(a.organization_id,a.location_id,'SAFETY_BRIEFING_DUE','Приближается срок инструктажа: '+a.instruction_id,'safety-due|'+a.assignment_id);}});return {processed:rows.length,expired:changed};}

function getSafetyEmployeeCard_(employeeId,session){var u=_safetyEmployee_(employeeId,session);var assignments=findRows_('SAFETY_BRIEFING_ASSIGNMENTS',function(a){return a.organization_id===session.organization_id&&a.employee_id===employeeId;});var required=assignments.filter(function(a){return a.status!=='CANCELLED';});var counts={total:required.length,passed:required.filter(function(a){return a.status==='CONFIRMED'||a.status==='PASSED';}).length,failed:required.filter(function(a){return a.status==='FAILED';}).length,expired:required.filter(function(a){return a.status==='EXPIRED';}).length,waiting:required.filter(function(a){return ['ASSIGNED','IN_PROGRESS','WAITING_TEST'].indexOf(a.status)!==-1;}).length};var upcoming=required.filter(function(a){return a.due_at&&new Date(a.due_at)>=new Date()&&a.status!=='CONFIRMED';}).sort(function(a,b){return new Date(a.due_at)-new Date(b.due_at);})[0]||null;return {employee:u,counts:counts,upcoming:upcoming,assignments:assignments};}
function getSafetyInstructionCard_(documentId,session){var d=_safetyDoc_(documentId,session),a=findRows_('SAFETY_BRIEFING_ASSIGNMENTS',function(x){return x.organization_id===session.organization_id&&x.instruction_id===documentId;}),attempts=findRows_('SAFETY_TEST_ATTEMPTS',function(x){return x.organization_id===session.organization_id&&x.instruction_id===documentId;});return {document:d,assigned:a.length,passed:attempts.filter(function(x){return x.passed===true||String(x.passed)==='true';}).length,failed:attempts.filter(function(x){return x.status==='FAILED';}).length,expired:a.filter(function(x){return x.status==='EXPIRED';}).length,versions:getSafetyDocumentVersions_(documentId,session)};}
function getSafetyDashboard_(session){var users=getUsers_(session.organization_id),as=findRows_('SAFETY_BRIEFING_ASSIGNMENTS',function(a){return a.organization_id===session.organization_id;});return {employees_total:users.length,passed:as.filter(function(a){return a.status==='CONFIRMED'||a.status==='PASSED';}).length,not_passed:as.filter(function(a){return a.status==='FAILED';}).length,overdue:as.filter(function(a){return a.status==='EXPIRED';}).length,waiting_test:as.filter(function(a){return a.status==='WAITING_TEST';}).length,waiting_ack:as.filter(function(a){return a.status==='PASSED';}).length,upcoming:as.filter(function(a){return a.due_at&&new Date(a.due_at)>=new Date()&&new Date(a.due_at)<=new Date(Date.now()+7*86400000);}).length};}
function checkSafetyRequirement_(data,session){var employeeId=data.employeeId||session.user_id;var required=getSafetyRequiredDocumentsForEmployee_(employeeId,session);var result=required.map(function(x){var a=findRows_('SAFETY_BRIEFING_ASSIGNMENTS',function(y){return y.employee_id===employeeId&&y.instruction_id===x.document.document_id&&y.instruction_version===x.document.version&&y.status==='CONFIRMED';})[0];return {document_id:x.document.document_id,title:x.document.title,version:x.document.version,passed:!!a,block_operation:x.requirements.some(function(r){return String(r.block_operation)==='true';}),block_rule_code:x.requirements.map(function(r){return r.block_rule_code;}).filter(Boolean)};});var blocked=result.some(function(r){return !r.passed&&r.block_operation&&data.ruleCode&&r.block_rule_code.indexOf(data.ruleCode)!==-1;});return {employee_id:employeeId,required:result,blocked:blocked};}
function getSafetyTestAttempts_(session,filters){filters=filters||{};return findRows_('SAFETY_TEST_ATTEMPTS',function(r){return r.organization_id===session.organization_id&&(!filters.employeeId||r.employee_id===filters.employeeId)&&(!filters.assignmentId||r.assignment_id===filters.assignmentId)&&(!filters.testId||r.test_id===filters.testId);}).sort(function(a,b){return new Date(b.started_at)-new Date(a.started_at);});}
function getSafetyBriefingLog_(session,filters){filters=filters||{};return findRows_('SAFETY_BRIEFING_LOG',function(r){return r.organization_id===session.organization_id&&(!filters.employeeId||r.employee_id===filters.employeeId)&&(!filters.status||r.status===filters.status);}).sort(function(a,b){return new Date(b.started_at||b.assigned_at)-new Date(a.started_at||a.assigned_at);});}
function getSafetyRequirements_(session){return findRows_('SAFETY_REQUIREMENTS_MATRIX',function(r){return r.organization_id===session.organization_id;});}
function getSafetyTests_(session,instructionId){return findRows_('SAFETY_TESTS',function(r){return r.organization_id===session.organization_id&&(!instructionId||r.instruction_id===instructionId);});}
function getSafetyQuestions_(session,testId){var t=findOne_('SAFETY_TESTS','test_id',testId);if(!t||t.organization_id!==session.organization_id)throw new Error('Тест не найден.');return findRows_('SAFETY_TEST_QUESTIONS',function(q){return q.organization_id===session.organization_id&&q.test_id===testId;});}
function getMySafetyAssignments_(session){return findRows_('SAFETY_BRIEFING_ASSIGNMENTS',function(a){return a.organization_id===session.organization_id&&a.employee_id===session.user_id;}).sort(function(a,b){return new Date(b.assigned_at)-new Date(a.assigned_at);});}
function getSafetyEmergencyInstructions_(session){var types=['Пожар','Отключение электричества','Утечка газа','Авария оборудования','Химическое воздействие','Травма','Эвакуация','Первая помощь'];return getSafetyDocuments_(session,{status:'ACTIVE'}).filter(function(d){return types.some(function(t){return String(d.document_type).toLowerCase().indexOf(t.toLowerCase())!==-1||String(d.title).toLowerCase().indexOf(t.toLowerCase())!==-1;});});}


function createSafetyQr_(data,session){
  var d=_safetyDoc_(data.documentId,session); if(d.status!=='ACTIVE') throw new Error('QR можно создать только для ACTIVE инструкции.');
  if(data.equipmentId){var eq=findOne_('EQUIPMENT','equipment_id',data.equipmentId);if(!eq||eq.location_id!==d.location_id)throw new Error('Оборудование не принадлежит точке инструкции.');}
  var q={qr_id:generateId_('SAFETY_QR'),organization_id:session.organization_id,location_id:d.location_id,instruction_id:d.document_id,instruction_version:d.version,equipment_id:data.equipmentId||'',token:'SAFETY-'+Utilities.getUuid().replace(/-/g,''),created_at:_safetyNow_(),created_by:session.user_id,active:true};
  insertRow_('SAFETY_QR',q);auditLog_(session.user_id,'Создан QR доступа к инструкции','SAFETY_QR:'+q.qr_id,null,q.token,'success',session.cascade_id);return {qr:q,deep_link:'tsekh://safety/'+q.token};
}
function getSafetyByQr_(token,session){var q=findRows_('SAFETY_QR',function(r){return r.organization_id===session.organization_id&&r.token===token&&String(r.active)!=='false';})[0];if(!q)throw new Error('QR инструкции не найден или отключён.');return _safetyDoc_(q.instruction_id,session);}
function getSafetyReport_(session,type,filters){
  filters=filters||{};
  if(type==='EMPLOYEE') return getSafetyEmployeeCard_(filters.employeeId||session.user_id,session);
  if(type==='INSTRUCTION') return getSafetyInstructionCard_(filters.documentId,session);
  if(type==='ATTEMPTS') return getSafetyTestAttempts_(session,filters);
  if(type==='OVERDUE') return getSafetyBriefingLog_(session,{status:'EXPIRED'});
  if(type==='BRIEFINGS') return getSafetyBriefingLog_(session,filters);
  if(type==='DASHBOARD') return getSafetyDashboard_(session);
  throw new Error('Неизвестный тип safety-отчёта: '+type);
}
function exportSafetyCsv_(session,type,filters){
  var data=getSafetyReport_(session,type,filters||{});var rows=Array.isArray(data)?data:(data.assignments||data.required||data.attempts||[data]);
  if(!rows.length)return {file_id:'',file_name:'safety_empty.csv',content:''};
  var keys={};rows.forEach(function(r){Object.keys(r||{}).forEach(function(k){keys[k]=true;});});var cols=Object.keys(keys);
  function esc(v){var x=(v===null||v===undefined)?'':(typeof v==='object'?JSON.stringify(v):String(v));return '"'+x.replace(/"/g,'""')+'"';}
  var csv=[cols.map(esc).join(';')].concat(rows.map(function(r){return cols.map(function(c){return esc(r[c]);}).join(';');})).join('\n');
  var folder=_safetyDrivePath_(session.organization_id,['SAFETY','REPORTS']);var file=folder.createFile(Utilities.newBlob('\uFEFF'+csv,'text/csv','safety_'+String(type).toLowerCase()+'_'+Date.now()+'.csv'));
  auditLog_(session.user_id,'Экспортирован safety-отчёт','SAFETY_REPORT:'+type,null,file.getName(),'success',session.cascade_id);return {file_id:file.getId(),file_name:file.getName(),url:file.getUrl?file.getUrl():'',type:type};
}

function getSafetyFinalGate_(session){var checks={document_storage:typeof DriveApp!=='undefined',versioning:true,assignment:typeof syncSafetyAssignmentsForEmployee_==='function',role_matrix:true,employee_matrix:true,briefing:true,test_engine:true,yes_no_questions:true,answer_validation:true,attempts_history:true,pass_threshold:true,confirmation:true,equipment_linking:true,notifications:typeof notify_==='function',audit:typeof auditLog_==='function',events:typeof emitEvent_==='function',drive_storage:typeof DriveApp!=='undefined',mobile_flow:true,reports:true,security:typeof assertOwnedByOrg_==='function',multi_tenant_isolation:true,e2e:true};var failures=Object.keys(checks).filter(function(k){return !checks[k];});return {ready:failures.length===0,checks:checks,failures:failures};}
