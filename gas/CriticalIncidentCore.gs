// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — CriticalIncidentCore.gs
 * Контур критических ситуаций цеха: инцидент -> блокировка/карантин -> задача -> решение -> доказательство.
 * Это операционный механизм. Нормативные пределы и правила должны задаваться утверждённым ППК/журналами.
 */
var CRITICAL_INCIDENT_SEVERITIES = ['ПРЕДУПРЕЖДЕНИЕ','ОТКЛОНЕНИЕ','КРИТИЧЕСКОЕ','БЛОКИРОВКА'];
var CRITICAL_INCIDENT_STATUSES = ['ОТКРЫТ','НА_РАССМОТРЕНИИ','УСТРАНЕН','ЗАКРЫТ'];
var CRITICAL_INCIDENT_ENTITY_TYPES = ['BATCH','PRODUCTION','EQUIPMENT','LOCATION','WORKSHOP','JOURNAL','HACCP','OTHER'];

function _criticalIncidentId_(kind) { return generateId_(kind === 'CINC' ? 'CRITICAL_INCIDENTS' : (kind === 'QUAR' ? 'QUARANTINE_CASES' : kind)); }
function _criticalIncidentNow_() { return nowIso_(); }

function _criticalIncidentMustBlock_(severity, blockMode) {
  if (blockMode === true) return true;
  return ['КРИТИЧЕСКОЕ','БЛОКИРОВКА'].indexOf(String(severity || '').toUpperCase()) !== -1;
}

function _criticalIncidentAssertEntity_(session, entityType, entityId) {
  if (!entityId) return;
  var map = {
    BATCH: 'BATCHES', PRODUCTION: 'PRODUCTION', EQUIPMENT: 'EQUIPMENT',
    LOCATION: 'LOCATIONS', WORKSHOP: 'WORKSHOPS', JOURNAL: 'JOURNALS'
  };
  var table = map[entityType];
  if (!table) return;
  var key = table === 'BATCHES' ? 'batch_id' :
    table === 'PRODUCTION' ? 'production_id' :
    table === 'EQUIPMENT' ? 'equipment_id' :
    table === 'LOCATIONS' ? 'location_id' :
    table === 'WORKSHOPS' ? 'workshop_id' : 'journal_id';
  var entity = findOne_(table, key, entityId);
  if (!entity) throw new Error('Объект инцидента не найден: ' + entityType + ':' + entityId);
  assertOwnedByOrg_(session, entity, entityType + ':' + entityId);
  if (entity.location_id) assertOwnedByOrgAndLocation_(session, entity, entityType + ':' + entityId);
  return entity;
}

function _criticalIncidentCreateCorrectiveAction_(incident, session) {
  if (!incident || !incident.haccp_flag && incident.severity === 'ПРЕДУПРЕЖДЕНИЕ') return null;
  try {
    var existing = findRows_('CORRECTIVE_ACTIONS', function(r) {
      return incident.deviation_id && r.deviation_id === incident.deviation_id;
    });
    if (existing.length) return existing[0];
    var action = {
      action_id: generateId_('CORRECTIVE_ACTIONS'),
      deviation_id: incident.deviation_id || '',
      описание: (incident.описание || incident.название) + (incident.предписанное_действие ? '\nПредписанное действие: ' + incident.предписанное_действие : ''),
      source_document: incident.ppk_id || '',
      ответственный_роль: incident.ответственный_роль || 'ТЕХНОЛОГ_HACCP',
      ответственный_id: incident.ответственный_id || '',
      статус: 'ожидание',
      результат: '',
      дата: _criticalIncidentNow_()
    };
    insertRow_('CORRECTIVE_ACTIONS', action);
    auditLog_(session.user_id, 'Создано корректирующее действие по критической ситуации', 'CORRECTIVE_ACTIONS:' + action.action_id, '', JSON.stringify({incident_id:incident.incident_id}), 'success', session.cascade_id || '');
    return action;
  } catch (e) {
    logSystemError_('_criticalIncidentCreateCorrectiveAction_', session ? session.user_id : '', 'critical_incident_corrective', e);
    throw e;
  }
}

function _criticalIncidentCreateTask_(incident, session) {
  if (!incident || !incident.ответственный_роль) return null;
  try {
    return createTask_({
      organizationId: incident.organization_id,
      locationId: incident.location_id,
      type: incident.haccp_flag ? 'haccp' : 'corrective',
      title: 'КРИТИЧЕСКАЯ СИТУАЦИЯ: ' + incident.название,
      description: incident.описание + (incident.предписанное_действие ? '\nПредписанное действие: ' + incident.предписанное_действие : ''),
      responsibleRole: incident.ответственный_роль,
      responsibleId: incident.ответственный_id || '',
      priority: incident.приоритет || 'критический',
      dueAt: incident.sрок_устранения || '',
      sourceEntityId: incident.incident_id,
      userId: session ? session.user_id : incident.created_by,
      session: session
    });
  } catch (e) {
    logSystemError_('_criticalIncidentCreateTask_', session ? session.user_id : '', 'critical_incident_task', e);
    return null;
  }
}

function createCriticalIncident_(data, session) {
  return withLock_(function () {
    data = data || {};
    var severity = String(data.severity || 'ОТКЛОНЕНИЕ').toUpperCase();
    if (CRITICAL_INCIDENT_SEVERITIES.indexOf(severity) === -1) throw new Error('Недопустимый уровень инцидента.');
    var entityType = String(data.entityType || 'OTHER').toUpperCase();
    if (CRITICAL_INCIDENT_ENTITY_TYPES.indexOf(entityType) === -1) throw new Error('Недопустимый тип объекта инцидента.');
    if (!data.title && !data.название) throw new Error('Укажите название критической ситуации.');

    var entity = _criticalIncidentAssertEntity_(session, entityType, data.entityId || '');
    var locationId = data.locationId || (entity && entity.location_id) || session.location_id || '';
    if (locationId) assertLocationAllowed_(session, locationId, 'CRITICAL_INCIDENT_LOCATION');

    var incident = {
      incident_id: _criticalIncidentId_('CINC'),
      organization_id: session.organization_id,
      location_id: locationId,
      workshop_id: data.workshopId || (entity && entity.workshop_id) || '',
      entity_type: entityType,
      entity_id: data.entityId || '',
      severity: severity,
      status: 'ОТКРЫТ',
      code: data.code || '',
      название: data.title || data.название,
      описание: data.description || data.описание || '',
      причина: data.cause || data.причина || '',
      предписанное_действие: data.requiredAction || data.предписанное_действие || '',
      corrective_action_id: '',
      task_id: '',
      haccp_flag: !!data.haccpFlag,
      ppk_id: data.ppkId || '',
      control_id: data.controlId || '',
      deviation_id: data.deviationId || '',
      batch_id: entityType === 'BATCH' ? (data.entityId || '') : (data.batchId || ''),
      production_id: entityType === 'PRODUCTION' ? (data.entityId || '') : (data.productionId || ''),
      equipment_id: entityType === 'EQUIPMENT' ? (data.entityId || '') : (data.equipmentId || ''),
      prior_entity_status: entity && entity.статус ? entity.статус : '',
      quarantine_id: '',
      ответственный_роль: data.responsibleRole || (data.haccpFlag ? 'ТЕХНОЛОГ_HACCP' : 'ШЕФ-ПОВАР'),
      ответственный_id: data.responsibleId || '',
      приоритет: data.priority || (_criticalIncidentMustBlock_(severity, data.blockMode) ? 'критический' : 'высокий'),
      срок_устранения: data.dueAt || '',
      evidence_json: data.evidenceJson ? JSON.stringify(data.evidenceJson) : (data.evidence_json || ''),
      created_at: _criticalIncidentNow_(),
      created_by: session.user_id,
      resolved_at: '',
      resolved_by: '',
      resolution: '',
      cascade_id: session.cascade_id || ''
    };
    insertRow_('CRITICAL_INCIDENTS', incident);

    var correctiveAction = _criticalIncidentCreateCorrectiveAction_(incident, session);
    if (correctiveAction) {
      incident.corrective_action_id = correctiveAction.action_id;
      var incForCa = findOne_('CRITICAL_INCIDENTS','incident_id',incident.incident_id);
      updateRow_('CRITICAL_INCIDENTS', incForCa, { corrective_action_id: correctiveAction.action_id });
    }

    if (_criticalIncidentMustBlock_(severity, data.blockMode) && entityType === 'BATCH' && entity) {
      var existingQ = findRows_('QUARANTINE_CASES', function(r){ return r.organization_id === session.organization_id && r.batch_id === entity.batch_id && r.status === 'КАРАНТИН'; })[0];
      if (existingQ) {
        var existingInc = findOne_('CRITICAL_INCIDENTS','incident_id',incident.incident_id);
        updateRow_('CRITICAL_INCIDENTS', existingInc, { quarantine_id: existingQ.quarantine_id });
        incident.quarantine_id = existingQ.quarantine_id;
      } else {
      var q = {
        quarantine_id: _criticalIncidentId_('QUAR'),
        organization_id: session.organization_id,
        location_id: locationId,
        workshop_id: entity.workshop_id || '',
        incident_id: incident.incident_id,
        batch_id: entity.batch_id,
        prior_status: entity.статус || 'активна',
        status: 'КАРАНТИН',
        reason: incident.название + (incident.описание ? ': ' + incident.описание : ''),
        created_at: _criticalIncidentNow_(),
        created_by: session.user_id,
        released_at: '',
        released_by: '',
        release_decision: '',
        cascade_id: session.cascade_id || ''
      };
      updateRow_('BATCHES', entity, { статус: 'КАРАНТИН' });
      insertRow_('QUARANTINE_CASES', q);
      incident.quarantine_id = q.quarantine_id;
      var incidentRow = findOne_('CRITICAL_INCIDENTS','incident_id',incident.incident_id);
      updateRow_('CRITICAL_INCIDENTS', incidentRow, { quarantine_id: q.quarantine_id });
      }
    }

    var task = _criticalIncidentCreateTask_(incident, session);
    if (task) {
      incident.task_id = task.task_id;
      var incidentTaskRow = findOne_('CRITICAL_INCIDENTS','incident_id',incident.incident_id);
      updateRow_('CRITICAL_INCIDENTS', incidentTaskRow, { task_id: task.task_id });
    }

    auditLog_(session.user_id, 'Создана критическая ситуация', 'CRITICAL_INCIDENTS:' + incident.incident_id, '', JSON.stringify({severity:severity, entityType:entityType, entityId:data.entityId||''}), 'success', session.cascade_id);
    _emitEventSafe_({organizationId:session.organization_id, locationId:locationId, type:'CRITICAL_INCIDENT_CREATED', source:'backend', entityType:'CRITICAL_INCIDENTS', entityId:incident.incident_id, payload:{severity:severity, entityType:entityType, entityId:data.entityId||'', blocked:!!incident.quarantine_id}});
    return { incident: incident, quarantine: incident.quarantine_id ? findOne_('QUARANTINE_CASES','quarantine_id',incident.quarantine_id) : null, task: task };
  });
}

function getCriticalIncidents_(session, filters) {
  filters = filters || {};
  return findRows_('CRITICAL_INCIDENTS', function (r) {
    if (r.organization_id !== session.organization_id) return false;
    if (session.location_id && CONFIG.ROLE_DATA_SCOPE[session.role || session.роль || (findOne_('USERS','user_id',session.user_id)||{}).роль || ''] === 'LOCATION' && r.location_id !== session.location_id) return false;
    if (filters.status && r.status !== filters.status) return false;
    if (filters.severity && r.severity !== String(filters.severity).toUpperCase()) return false;
    if (filters.entityType && r.entity_type !== String(filters.entityType).toUpperCase()) return false;
    if (filters.entityId && r.entity_id !== filters.entityId) return false;
    return true;
  }).sort(function(a,b){ return new Date(b.created_at) - new Date(a.created_at); });
}

function getQuarantineCases_(session, filters) {
  filters = filters || {};
  return findRows_('QUARANTINE_CASES', function (r) {
    if (r.organization_id !== session.organization_id) return false;
    if (CONFIG.ROLE_DATA_SCOPE[session.role || session.роль || (findOne_('USERS','user_id',session.user_id)||{}).роль || ''] === 'LOCATION' && r.location_id !== session.location_id) return false;
    if (filters.status && r.status !== filters.status) return false;
    if (filters.batchId && r.batch_id !== filters.batchId) return false;
    return true;
  }).sort(function(a,b){ return new Date(b.created_at) - new Date(a.created_at); });
}

function resolveCriticalIncident_(data, session) {
  return withLock_(function () {
    var incident = findOne_('CRITICAL_INCIDENTS','incident_id',data.incidentId);
    if (!incident) throw new Error('Критическая ситуация не найдена.');
    assertOwnedByOrgAndLocation_(session, incident, 'CRITICAL_INCIDENTS:' + data.incidentId);
    if (incident.status === 'ЗАКРЫТ') throw new Error('Инцидент уже закрыт.');
    var status = String(data.status || 'УСТРАНЕН').toUpperCase();
    if (['УСТРАНЕН','ЗАКРЫТ'].indexOf(status) === -1) throw new Error('Недопустимый статус закрытия инцидента.');
    if (['КРИТИЧЕСКОЕ','БЛОКИРОВКА'].indexOf(incident.severity) !== -1) {
      if (!String(data.resolution || '').trim()) throw new Error('Для критического инцидента обязательно решение/описание устранения.');
      if (!data.evidenceJson && !data.evidence_json && !incident.evidence_json) throw new Error('Для критического инцидента обязательно доказательство устранения.');
    }
    updateRow_('CRITICAL_INCIDENTS', incident, { status: status, resolved_at: _criticalIncidentNow_(), resolved_by: session.user_id, resolution: data.resolution || '', evidence_json: data.evidenceJson ? JSON.stringify(data.evidenceJson) : (data.evidence_json || incident.evidence_json) });
    if (incident.corrective_action_id) {
      var ca = findOne_('CORRECTIVE_ACTIONS','action_id',incident.corrective_action_id);
      if (!ca) throw new Error('Связанное корректирующее действие не найдено.');
      updateRow_('CORRECTIVE_ACTIONS', ca, { статус:'выполнено', результат:data.resolution || 'Инцидент устранён', ответственный_id:session.user_id });
      if (incident.deviation_id) {
        var dev = findOne_('JOURNAL_DEVIATIONS','deviation_id',incident.deviation_id);
        if (dev) updateRow_('JOURNAL_DEVIATIONS', dev, { статус:'закрыто', corrective_action_id:incident.corrective_action_id });
      }
    }
    auditLog_(session.user_id, 'Решение по критической ситуации', 'CRITICAL_INCIDENTS:' + incident.incident_id, incident.status, status + ': ' + (data.resolution || ''), 'success', session.cascade_id);
    return findOne_('CRITICAL_INCIDENTS','incident_id',incident.incident_id);
  });
}

function releaseQuarantine_(data, session) {
  return withLock_(function () {
    var q = findOne_('QUARANTINE_CASES','quarantine_id',data.quarantineId);
    if (!q) throw new Error('Карантин не найден.');
    assertOwnedByOrgAndLocation_(session, q, 'QUARANTINE_CASES:' + data.quarantineId);
    var incident = findOne_('CRITICAL_INCIDENTS','incident_id',q.incident_id);
    if (!incident) throw new Error('Связанный инцидент не найден.');
    assertOwnedByOrgAndLocation_(session, incident, 'CRITICAL_INCIDENTS:' + q.incident_id);
    if (q.status !== 'КАРАНТИН') throw new Error('Карантин уже закрыт.');
    if (incident.status !== 'УСТРАНЕН' && incident.status !== 'ЗАКРЫТ') throw new Error('Нельзя снять карантин: критическая ситуация ещё не устранена.');
    if (!String(data.resolution || '').trim()) throw new Error('Для решения по карантину обязательно обоснование.');
    var batch = findOne_('BATCHES','batch_id',q.batch_id);
    if (!batch) throw new Error('Партия карантина не найдена.');
    assertOwnedByOrgAndLocation_(session, batch, 'BATCHES:' + q.batch_id);
    var decision = String(data.decision || 'RELEASE').toUpperCase();
    if (decision === 'RELEASE') {
      updateRow_('BATCHES', batch, { статус: q.prior_status || 'активна' });
    } else if (decision === 'DISPOSE') {
      updateRow_('BATCHES', batch, { статус: 'УТИЛИЗИРОВАНА' });
    } else {
      throw new Error('Решение по карантину должно быть RELEASE или DISPOSE.');
    }
    updateRow_('QUARANTINE_CASES', q, { status: decision === 'RELEASE' ? 'РАЗБЛОКИРОВАН' : 'УТИЛИЗИРОВАН', released_at: _criticalIncidentNow_(), released_by: session.user_id, release_decision: (data.resolution || '') + ' [' + decision + ']' });
    auditLog_(session.user_id, 'Решение по карантину партии', 'QUARANTINE_CASES:' + q.quarantine_id, 'КАРАНТИН', decision, 'success', session.cascade_id);
    return { quarantine: findOne_('QUARANTINE_CASES','quarantine_id',q.quarantine_id), batch: findOne_('BATCHES','batch_id',q.batch_id) };
  });
}

function assertNoBlockingIncidentForBatch_(batchId, session) {
  if (!batchId) return;
  var rows = findRows_('CRITICAL_INCIDENTS', function(r){ return r.organization_id === session.organization_id && r.batch_id === batchId && ['ОТКРЫТ','НА_РАССМОТРЕНИИ'].indexOf(r.status)!==-1 && ['КРИТИЧЕСКОЕ','БЛОКИРОВКА'].indexOf(r.severity)!==-1; });
  if (rows.length) throw new Error('Операция заблокирована критической ситуацией по партии ' + batchId + '. Сначала устраните инцидент и снимите карантин.');
}

function getCriticalIncidentDashboard_(session) {
  var rows = getCriticalIncidents_(session, {});
  var open = rows.filter(function(r){return ['ОТКРЫТ','НА_РАССМОТРЕНИИ'].indexOf(r.status)!==-1;});
  return { total: rows.length, open: open.length, critical: open.filter(function(r){return ['КРИТИЧЕСКОЕ','БЛОКИРОВКА'].indexOf(r.severity)!==-1;}).length, quarantines: getQuarantineCases_(session,{status:'КАРАНТИН'}).length, incidents: rows.slice(0,50) };
}


function assertNoBlockingIncidentForProduction_(productionId, session) {
  if (!productionId) return;
  var rows = findRows_('CRITICAL_INCIDENTS', function(r){
    return r.organization_id === session.organization_id && r.production_id === productionId && ['ОТКРЫТ','НА_РАССМОТРЕНИИ'].indexOf(r.status)!==-1 && ['КРИТИЧЕСКОЕ','БЛОКИРОВКА'].indexOf(r.severity)!==-1;
  });
  if (rows.length) throw new Error('Производственное задание заблокировано критической ситуацией: ' + rows[0].название);
}
