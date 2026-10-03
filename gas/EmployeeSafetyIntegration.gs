// ЦЕХ — P22.3 Employee ↔ Position ↔ Workshop ↔ Equipment ↔ Safety integration
// Не отдельный контур: расширяет USERS/WORKSHOPS/EQUIPMENT/SAFETY/TASKS/NOTIFICATIONS/EVENTS/AUDIT.

var EMPLOYEE_SAFETY_ACCESS_STATUSES = ['PENDING','ALLOWED','BLOCKED','EXPIRED','REVOKED'];
var EMPLOYEE_SAFETY_OPERATION_MODES = ['WARNING','BLOCK'];

function createPosition_(data, session) {
  if (!data.name) throw new Error('Название должности обязательно.');
  var row = {position_id: generateId_('POSITIONS'), organization_id: session.organization_id,
    name: String(data.name), code: data.code || '', description: data.description || '', active: true,
    created_at: nowIso_(), updated_at: nowIso_()};
  insertRow_('POSITIONS', row);
  auditLog_(session.user_id, 'Создана должность', 'POSITIONS:' + row.position_id, null, JSON.stringify(row), 'success', session.cascade_id);
  return row;
}
function getPositions_(session) {
  return findRows_('POSITIONS', function(r){ return r.organization_id === session.organization_id && String(r.active) !== 'false'; });
}
function updatePosition_(positionId, patch, session) {
  var p = findOne_('POSITIONS','position_id',positionId);
  if (!p || p.organization_id !== session.organization_id) throw new Error('Должность не найдена.');
  var safe = _stripProtectedFields_(patch || {}, ['position_id','organization_id','created_at']);
  safe.updated_at = nowIso_();
  updateRow_('POSITIONS', p, safe);
  auditLog_(session.user_id, 'Изменена должность', 'POSITIONS:' + positionId, null, JSON.stringify(safe), 'success', session.cascade_id);
  return findOne_('POSITIONS','position_id',positionId);
}

function _employeePosition_(positionId, session) {
  if (!positionId) return null;
  var p = findOne_('POSITIONS','position_id',positionId);
  if (!p || p.organization_id !== session.organization_id || String(p.active) === 'false') throw new Error('Должность не принадлежит организации или неактивна.');
  return p;
}
function _employeeWorkshop_(workshopId, locationId, session) {
  if (!workshopId) return null;
  var w = findOne_('WORKSHOPS','workshop_id',workshopId);
  if (!w || w.location_id !== locationId) throw new Error('Цех не принадлежит выбранной точке.');
  var loc = findOne_('LOCATIONS','location_id',locationId);
  if (!loc || loc.organization_id !== session.organization_id) throw new Error('Точка не принадлежит организации.');
  return w;
}
function _employeeEquipmentForContext_(employee, locationId, workshopId, session) {
  if (!workshopId) return [];
  var rows = getEquipment_(locationId, workshopId);
  return rows.filter(function(eq){ return eq.location_id === locationId && eq.workshop_id === workshopId; }).map(function(eq){return eq.equipment_id;});
}

function updateEmployeeProfile_(employeeId, patch, session) {
  var u = _safetyEmployee_(employeeId, session);
  if (session.user_id !== employeeId && session.роль !== 'ADMIN' && session.роль !== 'ДИРЕКТОР' && session.роль !== 'ШЕФ-ПОВАР') {
    throw new Error('Изменять профиль сотрудника может только администратор, директор или шеф-повар.');
  }
  var old = {location_ids:u.location_ids||'', workshop_id:u.workshop_id||'', position_id:u.position_id||'', equipment_ids:u.equipment_ids||''};
  var locationId = patch.locationId || (String(u.location_ids||'').split(',').filter(Boolean)[0] || session.location_id || '');
  _safetyAssertLocation_(session, locationId);
  if (patch.positionId) _employeePosition_(patch.positionId, session);
  _employeeWorkshop_(patch.workshopId || u.workshop_id, locationId, session);
  var safe = _stripProtectedFields_(patch || {}, ['user_id','organization_id','pin_hash','pin_salt','статус','created_at','location_ids','role','роль']);
  if (patch.locationId) safe.location_ids = patch.locationId;
  if (patch.positionId !== undefined) safe.position_id = patch.positionId || '';
  if (patch.workshopId !== undefined) safe.workshop_id = patch.workshopId || '';
  if (patch.jobType !== undefined) safe.job_type = patch.jobType || '';
  if (patch.equipmentIds !== undefined) safe.equipment_ids = (patch.equipmentIds || []).join ? (patch.equipmentIds || []).join(',') : String(patch.equipmentIds || '');
  safe.updated_at = nowIso_();
  updateRow_('USERS', u, safe);
  var fresh = getUserById_(employeeId);
  auditLog_(session.user_id, 'Изменён профиль сотрудника', 'USERS:' + employeeId, null, JSON.stringify({position_id:fresh.position_id||'',workshop_id:fresh.workshop_id||'',location_ids:fresh.location_ids||'',job_type:fresh.job_type||''}), 'success', session.cascade_id);
  _emitEmployeeProfileEvent_('EMPLOYEE_UPDATED', fresh, session, old);
  if (old.position_id !== (fresh.position_id||'')) _emitEmployeeProfileEvent_('POSITION_CHANGED', fresh, session, old);
  if (old.workshop_id !== (fresh.workshop_id||'')) _emitEmployeeProfileEvent_('WORKSHOP_CHANGED', fresh, session, old);
  if (old.equipment_ids !== (fresh.equipment_ids||'')) _emitEmployeeProfileEvent_('EQUIPMENT_CHANGED', fresh, session, old);
  return syncEmployeeSafetyRequirements_(employeeId, session, {reason:'EMPLOYEE_UPDATED'});
}
function transferEmployee_(employeeId, data, session) {
  var u = _safetyEmployee_(employeeId, session);
  var old = {location_ids:u.location_ids||'', workshop_id:u.workshop_id||'', position_id:u.position_id||'', equipment_ids:u.equipment_ids||''};
  var result = updateEmployeeProfile_(employeeId, {locationId:data.locationId, workshopId:data.workshopId, positionId:data.positionId}, session);
  var fresh = getUserById_(employeeId);
  _emitEmployeeProfileEvent_('EMPLOYEE_TRANSFERRED', fresh, session, old);
  return result;
}
function _emitEmployeeProfileEvent_(type, user, session, old) {
  var allowed = ['EMPLOYEE_CREATED','EMPLOYEE_UPDATED','EMPLOYEE_TRANSFERRED','POSITION_CHANGED','WORKSHOP_CHANGED','EQUIPMENT_ASSIGNED','EQUIPMENT_CHANGED'];
  if (allowed.indexOf(type) === -1) throw new Error('Недопустимое событие employee: '+type);
  return _emitEventSafe_({organizationId:user.organization_id,locationId:String(user.location_ids||'').split(',')[0]||'',workshopId:user.workshop_id||'',operationId:session&&session.operation_id||'',type:type,source:'users',entityType:'USERS',entityId:user.user_id,payload:{user:user,old:old||null},idempotencyKey:type+'|'+user.user_id+'|'+(session&&session.operation_id||'')});
}

function syncEmployeeSafetyRequirements_(employeeId, session, opts) {
  return withLock_(function(){
    var u = _safetyEmployee_(employeeId, session);
    var employeeLocations = String(u.location_ids||'').split(',').filter(Boolean);
    var loc = (session.location_id && employeeLocations.indexOf(session.location_id)!==-1) ? session.location_id : (employeeLocations[0] || '');
    _safetyAssertLocation_(session, loc);
    var equipmentIds = _employeeEquipmentForContext_(u, loc, u.workshop_id || '', session);
    String(u.equipment_ids||'').split(',').filter(Boolean).forEach(function(id){ if(equipmentIds.indexOf(id)===-1){ var eq=findOne_('EQUIPMENT','equipment_id',id); if(eq&&eq.location_id===loc) equipmentIds.push(id); } });
    // Existing SAFETY_EMPLOYEE_CONTEXT remains the source of safety context; this function only synchronizes it.
    var ctx = getSafetyEmployeeContext_(employeeId, session);
    ctx.forEach(function(c){ updateRow_('SAFETY_EMPLOYEE_CONTEXT', c, {active:false}); });
    var c = {context_id:generateId_('SAFETY_EMPLOYEE_CONTEXT'),employee_id:employeeId,organization_id:u.organization_id,location_id:loc,workshop_id:u.workshop_id||'',job_type:u.job_type||'',equipment_ids:equipmentIds.join(','),active:true,created_at:nowIso_()};
    insertRow_('SAFETY_EMPLOYEE_CONTEXT',c);
    var assigned = syncSafetyAssignmentsForEmployee_(employeeId, session, opts || {});
    var required = getSafetyRequiredDocumentsForEmployee_(employeeId,session);
    revokeEmployeeSafetyRequirementsNoLongerApplicable_(employeeId,session,required.map(function(x){return x.document.document_id;}));
    _syncEmployeeEquipmentPermissions_(employeeId, session);
    _createSafetyTrainingTasks_(employeeId, assigned, session);
    auditLog_(session.user_id, 'Пересчитаны требования безопасности сотрудника', 'USERS:' + employeeId, null, JSON.stringify({context_id:c.context_id,assigned:assigned.length,equipment_ids:equipmentIds}), 'success', session.cascade_id);
    return {employee:u, context:c, assigned:assigned, readiness:getEmployeeReadiness_(employeeId,session)};
  });
}
function _createSafetyTrainingTasks_(employeeId, assignments, session) {
  if (typeof createTask_ !== 'function') return [];
  var u = _safetyEmployee_(employeeId, session), created=[];
  (assignments||[]).forEach(function(a){
    var existing = findRows_('TASKS', function(t){ return t.organization_id===u.organization_id && t.type==='briefing' && t.source_entity_id===a.assignment_id && t.status==='открыта'; })[0];
    if (existing) return;
    var task = createTask_({organizationId:u.organization_id,locationId:a.location_id,type:'briefing',title:'Пройти инструктаж: '+a.instruction_id,description:'Ознакомление, предусмотренная проверка знаний и подтверждение по назначению '+a.assignment_id,responsibleId:employeeId,priority:'обычный',dueAt:a.due_at||'',sourceEntityId:a.assignment_id,userId:session.user_id,session:session});
    created.push(task);
  });
  return created;
}

function _syncEmployeeEquipmentPermissions_(employeeId, session) {
  if (!CONFIG.SHEETS.EMPLOYEE_EQUIPMENT_PERMISSIONS) return [];
  var u=_safetyEmployee_(employeeId,session), locationId=String(u.location_ids||'').split(',').filter(Boolean)[0]||'';
  var eqs=_employeeEquipmentForContext_(u,locationId,u.workshop_id||'',session), changed=[];
  var activeRules=findRows_('SAFETY_REQUIREMENTS_MATRIX',function(r){return r.organization_id===u.organization_id&&String(r.active)!=='false'&&String(r.required)!=='false'&&r.equipment_id&&eqs.indexOf(r.equipment_id)!==-1;});
  var existingAll=findRows_('EMPLOYEE_EQUIPMENT_PERMISSIONS',function(p){return p.organization_id===u.organization_id&&p.employee_id===employeeId;});
  existingAll.forEach(function(old){ if(eqs.indexOf(old.equipment_id)===-1 && old.status!=='REVOKED'){ updateRow_('EMPLOYEE_EQUIPMENT_PERMISSIONS',old,{status:'REVOKED',updated_at:nowIso_()}); _emitEventSafe_({organizationId:old.organization_id,locationId:old.location_id,type:'ACCESS_REVOKED',source:'safety',entityType:'EMPLOYEE_EQUIPMENT_PERMISSIONS',entityId:old.permission_id,operationId:session.operation_id||'',payload:old,idempotencyKey:'ACCESS_REVOKED|'+old.permission_id+'|'+(u.workshop_id||'')}); auditLog_(session.user_id,'Отозван допуск из-за изменения контекста','EMPLOYEE_EQUIPMENT_PERMISSIONS:'+old.permission_id,old.status,'REVOKED','success',session.cascade_id); }});
  eqs.forEach(function(eqId){
    var rules=activeRules.filter(function(r){return r.equipment_id===eqId;});
    var required=rules.length>0, blocked=rules.some(function(r){return String(r.block_operation)==='true';});
    var allowed=required && rules.every(function(r){
      var a=findRows_('SAFETY_BRIEFING_ASSIGNMENTS',function(x){return x.employee_id===employeeId&&x.instruction_id===r.document_id&&x.instruction_version===(_safetyDoc_(r.document_id,session).version)&&['CONFIRMED','PASSED'].indexOf(x.status)!==-1;})[0];
      return !!a;
    });
    var desired=required ? (allowed?'ALLOWED':(blocked?'BLOCKED':'PENDING')) : 'PENDING';
    var existing=findRows_('EMPLOYEE_EQUIPMENT_PERMISSIONS',function(p){return p.organization_id===u.organization_id&&p.employee_id===employeeId&&p.equipment_id===eqId;})[0];
    var row={permission_id:existing?existing.permission_id:generateId_('EMPLOYEE_EQUIPMENT_PERMISSIONS'),employee_id:employeeId,equipment_id:eqId,organization_id:u.organization_id,location_id:locationId,instruction_id:rules[0]&&rules[0].document_id||'',test_id:'',result:allowed?'PASSED':'',approved_by:allowed?session.user_id:'',approved_at:allowed?nowIso_():'',valid_until:'',status:desired,block_rule_code:rules[0]&&rules[0].block_rule_code||'',created_at:existing?existing.created_at:nowIso_(),updated_at:nowIso_()};
    if (existing) updateRow_('EMPLOYEE_EQUIPMENT_PERMISSIONS',existing,row); else insertRow_('EMPLOYEE_EQUIPMENT_PERMISSIONS',row);
    changed.push(row);
  });
  return changed;
}
function getEmployeeEquipmentPermissions_(employeeId,session){ _safetyEmployee_(employeeId,session); return findRows_('EMPLOYEE_EQUIPMENT_PERMISSIONS',function(r){return r.organization_id===session.organization_id&&r.employee_id===employeeId;}); }
function expireEmployeeEquipmentPermissions_(session){
  var now=new Date(), rows=findRows_('EMPLOYEE_EQUIPMENT_PERMISSIONS',function(r){return r.organization_id===session.organization_id&&r.status==='ALLOWED'&&r.valid_until&&new Date(r.valid_until)<now;}), out=[];
  rows.forEach(function(r){updateRow_('EMPLOYEE_EQUIPMENT_PERMISSIONS',r,{status:'EXPIRED',updated_at:nowIso_()});_emitEventSafe_({organizationId:r.organization_id,locationId:r.location_id,type:'ACCESS_EXPIRED',source:'safety',entityType:'EMPLOYEE_EQUIPMENT_PERMISSIONS',entityId:r.permission_id,operationId:session.operation_id||'',payload:r,idempotencyKey:'ACCESS_EXPIRED|'+r.permission_id+'|'+r.valid_until});_safetyNotify_('SAFETY_ACCESS_EXPIRED',r,'Истёк допуск к оборудованию: '+r.equipment_id,'safety-access-expired|'+r.permission_id,session);auditLog_(session.user_id,'Истёк допуск к оборудованию','EMPLOYEE_EQUIPMENT_PERMISSIONS:'+r.permission_id,'ALLOWED','EXPIRED','success',session.cascade_id);out.push(r.permission_id);}); return out;
}
function checkEmployeeOperationSafety_(data,session){
  var employeeId=data.employeeId||session.user_id, perms=getEmployeeEquipmentPermissions_(employeeId,session), eqId=data.equipmentId||'', p=perms.filter(function(x){return x.equipment_id===eqId;})[0];
  // valid_until проверяется и здесь, а не только в планировщике: иначе допуск действовал бы до 6 ч после истечения (пока не отработает триггер).
  var notExpired = p && !(p.valid_until && new Date(p.valid_until) < new Date());
  if (!p || p.status!=='ALLOWED' || !notExpired) {
    var mode=data.mode||'';
    var blocked=(mode==='BLOCK');
    if (!blocked) return {allowed:true,warning:true,reason:'SAFETY_ACCESS_REQUIRED',permission:p||null};
    auditLog_(session.user_id,'Заблокирована операция без допуска','EMPLOYEE_EQUIPMENT_PERMISSIONS:'+(p?p.permission_id:'missing'),null,data.operationRuleCode||'SAFETY_ACCESS_REQUIRED','blocked',session.cascade_id);
    throw new Error('SAFETY_ACCESS_REQUIRED: отсутствует действующий допуск к оборудованию.');
  }
  return {allowed:true,warning:false,permission:p};
}
function getEmployeeReadiness_(employeeId,session){
  var u=_safetyEmployee_(employeeId,session), card=getSafetyEmployeeCard_(employeeId,session), perms=getEmployeeEquipmentPermissions_(employeeId,session), missing=perms.filter(function(p){return p.status!=='ALLOWED';});
  return {employee:u,training:card.counts,equipment:perms,missing_access:missing,ready:missing.length===0&&card.counts.expired===0&&card.counts.failed===0&&card.counts.waiting===0};
}
function getEmployeeSafetyReadiness_(employeeId,session){return getEmployeeReadiness_(employeeId||session.user_id,session);}

function syncEmployeesForEquipmentChange_(equipment, session) {
  var users=findRows_('USERS',function(u){return u.organization_id===session.organization_id&&u.статус==='активен'&&String(u.location_ids||'').split(',').indexOf(equipment.location_id)!==-1&&u.workshop_id===equipment.workshop_id;});
  var out=[]; users.forEach(function(u){ out.push(syncEmployeeSafetyRequirements_(u.user_id,session,{reason:'EQUIPMENT_CHANGED'})); });
  _emitEventSafe_({organizationId:equipment.organization_id||session.organization_id,locationId:equipment.location_id,workshopId:equipment.workshop_id||'',type:'EQUIPMENT_CHANGED',source:'equipment',entityType:'EQUIPMENT',entityId:equipment.equipment_id,operationId:session.operation_id||'',payload:equipment,idempotencyKey:'EQUIPMENT_CHANGED|'+equipment.equipment_id+'|'+(equipment.updated_at||'')});
  return out;
}

function revokeEmployeeSafetyRequirementsNoLongerApplicable_(employeeId, session, requiredIds) {
  var keep={}; (requiredIds||[]).forEach(function(id){keep[id]=true;});
  var rows=findRows_('SAFETY_BRIEFING_ASSIGNMENTS',function(a){return a.organization_id===session.organization_id&&a.employee_id===employeeId&&['ASSIGNED','IN_PROGRESS','WAITING_TEST','FAILED','PASSED'].indexOf(a.status)!==-1;});
  rows.forEach(function(a){ if(!keep[a.instruction_id]) { updateRow_('SAFETY_BRIEFING_ASSIGNMENTS',a,{status:'CANCELLED'}); auditLog_(session.user_id,'Снято неактуальное требование безопасности','SAFETY_BRIEFING_ASSIGNMENTS:'+a.assignment_id,a.status,'CANCELLED','success',session.cascade_id); } });
}

function getRequirementRules_(session) { return getSafetyRequirements_(session); }
function createRequirementRule_(data, session) { return createSafetyRequirement_(data, session); }

function syncSafetyForInstructionActivation_(document, session) {
  var employees=findRows_('USERS',function(u){
    return u.organization_id===session.organization_id && u.статус==='активен' && String(u.location_ids||'').split(',').indexOf(document.location_id)!==-1;
  });
  var out=[];
  employees.forEach(function(u){
    var s2={}; Object.keys(session).forEach(function(k){s2[k]=session[k];});
    s2.location_id=document.location_id; s2.allowed_locations=String(u.location_ids||'').split(',').filter(Boolean);
    out.push(syncEmployeeSafetyRequirements_(u.user_id,s2,{reason:'INSTRUCTION_VERSION_ACTIVATED'}));
  });
  return out;
}
