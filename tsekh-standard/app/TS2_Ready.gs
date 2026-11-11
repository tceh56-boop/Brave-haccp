/**
 * ЦЕХ Стандарт 2.1 — режим «Готовый продукт» (ТЗ 2.1).
 *   initializeReadyToWork(): пакет первоначальной настройки — структура, зоны, роли, 25 системных документов,
 *   правила событий (матрица ККТ §7.4), расписания журналов, очередь утверждения. Идемпотентно, backup перед включением.
 *   События производства (через шлюз) создают AUTO_RECORDS один раз на (предприятие, объект, ККТ, событие, версия правила).
 *   Повар подтверждает «Да/Нет»; числовой ввод — только для разрешённых физических замеров (§6.3).
 *   Система НЕ подставляет нормативное число вместо фактического замера (§7.3): без замера — PENDING_CONFIRMATION.
 */
var TS2_SEED_VERSION = '2.1.0';
var TS2_ENTERPRISE_TYPES_ = { RESTAURANT: 'Ресторан', CANTEEN: 'Столовая', CAFE: 'Кафе', CONFECTIONERY: 'Кондитерское производство', CATERING: 'Кейтеринг', FOOD_SHOP: 'Пищевой цех', MIXED: 'Смешанный формат' };
var TS2_ZONES_ = [['HOT', 'Горячий цех', 'WORKSHOP'], ['COLD', 'Холодный цех', 'WORKSHOP'], ['CONF', 'Кондитерский цех', 'WORKSHOP'], ['RAW_STORE', 'Склад сырья', 'STORE'],
  ['CHILL', 'Холодильные зоны', 'STORE'], ['FREEZE', 'Морозильные зоны', 'STORE'], ['DISPATCH', 'Зона отгрузки и выдачи', 'DISPATCH'], ['WASTE', 'Зона отходов', 'WASTE'], ['SANIT', 'Зона санитарной обработки', 'SANITATION']];
var TS2_ROLES_ = ['Директор', 'Шеф-повар', 'Су-шеф', 'Ответственный за ХАССП', 'Повар горячего цеха', 'Повар холодного цеха', 'Кондитер', 'Администратор', 'Технический доступ'];
// [templateId, название, тип, approvalMode, статус, требует утверждения предприятия, роль утверждения]
var TS2_SYSTEM_DOCS_ = [
  ['TPL-001', 'Положение о системе производственного контроля', 'PPK', 'AUTO_GENERATED', 'AUTO_PREPARED', true, 'Директор'],
  ['TPL-002', 'Программа производственного контроля (типовая, заполнена данными предприятия)', 'PPK', 'AUTO_GENERATED', 'AUTO_PREPARED', true, 'Директор'],
  ['TPL-003', 'План ХАССП (типовой, заполнен данными предприятия)', 'PPK', 'AUTO_GENERATED', 'AUTO_PREPARED', true, 'Ответственный за ХАССП'],
  ['TPL-004', 'Реестр опасностей', 'PPK', 'AUTO_GENERATED', 'AUTO_PREPARED', true, 'Ответственный за ХАССП'],
  ['TPL-005', 'Реестр ККТ', 'PPK', 'AUTO_GENERATED', 'AUTO_PREPARED', true, 'Ответственный за ХАССП'],
  ['TPL-006', 'Матрица ответственности', 'ACT', 'AUTO_GENERATED', 'AUTO_PREPARED', true, 'Директор'],
  ['TPL-007', 'Типовые журналы контроля', 'OTHER', 'PROVIDER_TEMPLATE', 'SYSTEM_APPROVED', false, ''],
  ['TPL-008', 'Типовые чек-листы открытия и закрытия смены', 'OTHER', 'PROVIDER_TEMPLATE', 'SYSTEM_APPROVED', false, ''],
  ['TPL-009', 'Инструкция по приёмке сырья', 'INSTRUCTION', 'PROVIDER_TEMPLATE', 'REQUIRES_LOCAL_CONFIRMATION', true, 'Ответственный за ХАССП'],
  ['TPL-010', 'Инструкция по хранению', 'INSTRUCTION', 'PROVIDER_TEMPLATE', 'REQUIRES_LOCAL_CONFIRMATION', true, 'Ответственный за ХАССП'],
  ['TPL-011', 'Инструкция по маркировке', 'INSTRUCTION', 'PROVIDER_TEMPLATE', 'REQUIRES_LOCAL_CONFIRMATION', true, 'Ответственный за ХАССП'],
  ['TPL-012', 'Инструкция по обработке сырья', 'INSTRUCTION', 'PROVIDER_TEMPLATE', 'REQUIRES_LOCAL_CONFIRMATION', true, 'Ответственный за ХАССП'],
  ['TPL-013', 'Инструкция по выпуску продукции', 'INSTRUCTION', 'PROVIDER_TEMPLATE', 'REQUIRES_LOCAL_CONFIRMATION', true, 'Ответственный за ХАССП'],
  ['TPL-014', 'Инструкция по уборке и санитарной обработке', 'INSTRUCTION', 'PROVIDER_TEMPLATE', 'REQUIRES_LOCAL_CONFIRMATION', true, 'Ответственный за ХАССП'],
  ['TPL-015', 'Инструкция по обращению с отходами', 'INSTRUCTION', 'PROVIDER_TEMPLATE', 'REQUIRES_LOCAL_CONFIRMATION', true, 'Ответственный за ХАССП'],
  ['TPL-016', 'Инструкция по действиям при отклонении', 'INSTRUCTION', 'PROVIDER_TEMPLATE', 'REQUIRES_LOCAL_CONFIRMATION', true, 'Ответственный за ХАССП'],
  ['TPL-017', 'Должностные инструкции (комплект)', 'INSTRUCTION', 'AUTO_GENERATED', 'AUTO_PREPARED', true, 'Директор'],
  ['TPL-018', 'Инструкции по охране труда (комплект)', 'INSTRUCTION', 'AUTO_GENERATED', 'AUTO_PREPARED', true, 'Директор'],
  ['TPL-019', 'Форма акта списания', 'ACT', 'PROVIDER_TEMPLATE', 'SYSTEM_APPROVED', false, ''],
  ['TPL-020', 'Форма акта несоответствия', 'ACT', 'PROVIDER_TEMPLATE', 'SYSTEM_APPROVED', false, ''],
  ['TPL-021', 'Форма корректирующего действия', 'ACT', 'PROVIDER_TEMPLATE', 'SYSTEM_APPROVED', false, ''],
  ['TPL-022', 'Форма внутреннего расследования', 'ACT', 'PROVIDER_TEMPLATE', 'SYSTEM_APPROVED', false, ''],
  ['TPL-023', 'Реестр оборудования', 'OTHER', 'PROVIDER_TEMPLATE', 'ACTIVE_TEMPLATE', false, ''],
  ['TPL-024', 'Реестр договоров', 'OTHER', 'PROVIDER_TEMPLATE', 'ACTIVE_TEMPLATE', false, ''],
  ['TPL-025', 'Реестр нормативов', 'NORM', 'PROVIDER_TEMPLATE', 'ACTIVE_TEMPLATE', false, '']
];
// Матрица ККТ (ТЗ 2.1 §7.4, §15). measurementMode: CONFIRMATION — только подтверждение; MEASURE_IF_REQUIRED — число вводится, если требует ППК;
// SENSOR_OR_DERIVED_OR_PENDING — из датчика или подтверждённого замера, иначе ожидание замера; NONE — числа нет.
var TS2_EVENT_RULES_ = [
  ['EVR-RECEIVING-001', 'RECEIVING_CONFIRMED', 'STOCK_RECEIVING', 'INCOMING_CONTROL', 'J-RECEIVING', 'MEASURE_IF_REQUIRED', 'RECORDED_FROM_RECEIVING', 'Приёмка сырья: входной контроль'],
  ['EVR-RECEIVING-VSD', 'RECEIVING_CONFIRMED', 'STOCK_RECEIVING', 'VSD_TASK', 'J-VSD', 'NONE', 'TASK_CREATED', 'Приёмка сырья: задача по ВСД (подконтрольный товар)'],
  ['EVR-BATCH-OPEN-001', 'BATCH_OPENED', 'STOCK_BATCH', 'BATCH_OPENING', 'J-MARKING', 'NONE', 'RECORDED_FROM_OPENING', 'Вскрытие: срок после вскрытия и этикетка'],
  ['EVR-DEFROST-001', 'DEFROST_FINISHED', 'STOCK_BATCH', 'HACCP_FACT', 'J-DEFROST', 'MEASURE_IF_REQUIRED', 'RECORDED_FROM_DEFROST', 'Размораживание: температура в толще по ППК'],
  ['EVR-RELEASE-THERMAL-001', 'PRODUCTION_RELEASE', 'PRODUCTION_OUTPUT', 'HACCP_FACT', 'J-KKT-THERMAL', 'SENSOR_OR_DERIVED_OR_PENDING', 'RECORDED_FROM_RELEASE', 'Тепловая обработка: ККТ при выпуске'],
  ['EVR-RELEASE-MARKING-001', 'PRODUCTION_RELEASE', 'PRODUCTION_OUTPUT', 'MARKING', 'J-MARKING', 'NONE', 'RECORDED_FROM_RELEASE', 'Маркировка выходной партии'],
  ['EVR-RELEASE-JOURNAL-001', 'PRODUCTION_RELEASE', 'PRODUCTION_OUTPUT', 'PRODUCTION_JOURNAL', 'J-RELEASE', 'NONE', 'RECORDED_FROM_RELEASE', 'Журнал выпуска продукции'],
  ['EVR-HALL-SAMPLE-001', 'RELEASE_TO_HALL', 'BANQUET_ISSUE', 'DAILY_SAMPLE', 'J-SAMPLES', 'CONFIRMATION', 'PENDING_CONFIRMATION', 'Суточная проба выданной партии'],
  ['EVR-HALL-RELEASE-001', 'RELEASE_TO_HALL', 'BANQUET_ISSUE', 'PRODUCTION_JOURNAL', 'J-RELEASE', 'NONE', 'RECORDED_FROM_RELEASE', 'Выдача в зал / банкет'],
  ['EVR-SAMPLE-001', 'DAILY_SAMPLE_TAKEN', 'DAILY_SAMPLE', 'HACCP_FACT', 'J-SAMPLES', 'NONE', 'RECORDED_FROM_SAMPLE', 'Суточная проба отобрана'],
  ['EVR-SANITATION-001', 'SANITATION_CONFIRMED', 'CHECKLIST', 'SANITATION', 'J-SANITATION', 'CONFIRMATION', 'RECORDED_FROM_CHECKLIST', 'Санитарная обработка'],
  ['EVR-COOLING-001', 'COOLING_FINISHED', 'PRODUCTION_OUTPUT', 'HACCP_FACT', 'J-COOLING', 'SENSOR_OR_DERIVED_OR_PENDING', 'RECORDED_FROM_COOLING', 'Охлаждение: ККТ'],
  ['EVR-REHEAT-001', 'REHEAT_FINISHED', 'PRODUCTION_OUTPUT', 'HACCP_FACT', 'J-REHEAT', 'SENSOR_OR_DERIVED_OR_PENDING', 'RECORDED_FROM_REHEAT', 'Разогрев: ККТ']
];
// Расписания (ТЗ 2.1 §9.1): [код, название, журнал, тип объекта, время, режим, роль]
var TS2_SCHEDULES_ = [
  ['SHIFT_OPEN', 'Открытие смены', 'J-SHIFT', 'SHIFT', '09:00', 'CONFIRM', 'Повар'], ['SHIFT_CLOSE', 'Закрытие смены', 'J-SHIFT', 'SHIFT', '22:00', 'CONFIRM', 'Повар'],
  ['FRIDGE', 'Холодильник: температура', 'J-STORAGE-T', 'FRIDGE', '09:00,18:00', 'MEASURE', 'Повар'], ['FREEZER', 'Морозильник: температура', 'J-STORAGE-T', 'FREEZER', '09:00,18:00', 'MEASURE', 'Повар'],
  ['ROOM_TEMP', 'Температура помещения', 'J-ROOM', 'ROOM', '10:00', 'MEASURE_TEMP', 'Ответственный за ХАССП'], ['ROOM_HUMIDITY', 'Влажность помещения', 'J-ROOM', 'ROOM', '10:00', 'MEASURE_HUMIDITY', 'Ответственный за ХАССП'],
  ['SANITATION', 'Санитарная обработка рабочих мест', 'J-SANITATION', 'WORKSHOP', '15:00', 'CONFIRM', 'Повар'], ['FRYER_OIL', 'Фритюрный жир: состояние / замена', 'J-FRYER', 'FRYER', '12:00', 'MEASURE', 'Повар'],
  ['UV_LAMP', 'Бактерицидная лампа: часы работы', 'J-UV', 'UV_LAMP', '21:00', 'MEASURE', 'Повар'], ['EQUIPMENT', 'Проверка оборудования', 'J-EQUIPMENT', 'SHIFT', '09:30', 'CONFIRM', 'Су-шеф'],
  ['EXPIRY', 'Контроль сроков годности партий', 'J-EXPIRY', 'SHIFT', '11:00', 'CONFIRM', 'Су-шеф'], ['MED', 'Контроль медицинских допусков смены', 'J-MED', 'SHIFT', '09:00', 'CONFIRM', 'Ответственный за ХАССП'],
  ['LAB_PLAN', 'Лабораторный план (по графику ППК)', 'J-LAB', 'MONTHLY', '1 10:00', 'CONFIRM', 'Ответственный за ХАССП'], ['DOCS_EXPIRY', 'Договоры и документы с датой окончания', 'J-DOCS', 'WEEKLY', '1 10:00', 'CONFIRM', 'Директор']
];
var TS2_MEASURE_TYPES_ = { FRIDGE: ['FRIDGE_TEMP', '°C'], FREEZER: ['FREEZER_TEMP', '°C'], ROOM: ['ROOM_TEMP', '°C'], ROOM_HUMIDITY: ['ROOM_HUMIDITY', '%'], FRYER: ['FRYER_OIL', ''], UV_LAMP: ['UV_LAMP_HOURS', 'ч'], OTHER: ['OTHER_PHYSICAL', ''] };

/* ------------------------------------------------------------------ профиль автоматизации */
function _ts2Prof_(k, d) { var r = _ts2Find_('AUTOMATION_PROFILE', 'key', k); return r ? r.value : d; }
function _ts2SetProf_(k, v) { var row = { key: k, value: v, updatedAt: new Date(), updatedBy: _ts2Actor_().name }; if (_ts2Find_('AUTOMATION_PROFILE', 'key', k)) _ts2Update_('AUTOMATION_PROFILE', 'key', k, row); else _ts2Insert_('AUTOMATION_PROFILE', row); }

/* ------------------------------------------------------------------ пакет первоначальной настройки */
function _ts2InitializeReadyToWork_(mode, enterpriseType) {
  mode = mode || 'READY_TO_WORK'; if (['READY_TO_WORK', 'PILOT', 'CUSTOM'].indexOf(mode) < 0) throw new Error('VALIDATION: режим READY_TO_WORK, PILOT или CUSTOM');
  _ts2EnsureSchema_(true);
  var backupId = _ts2Prof_('mode', '') ? '' : _ts2Backup_('PRE_UPDATE', 'ready_to_work');
  var created = { locations: 0, workshops: 0, documents: 0, rules: 0, roles: 0, approvals: 0 }, now = _ts2Iso_(), ent = _ts2Ent_(), actor = _ts2Actor_().name;
  if (!_ts2Rows_('LOCATIONS').length) {
    var loc = _ts2Id_('LOCATIONS'); _ts2Insert_('LOCATIONS', { locationId: loc, enterpriseId: ent, organizationId: _ts2Cfg_('ORGANIZATION_ID', ''), name: 'Основная площадка', address: (typeof _mcOrg_ === 'function' && _mcOrg_().actualAddress) || '', locationType: 'PRIMARY', status: 'ACTIVE', notApplicableReason: '', createdAt: now, createdBy: actor });
    _ts2SetCfg_('PRIMARY_LOCATION_ID', loc, 'SYSTEM'); created.locations++;
  }
  var locId = _ts2Cfg_('PRIMARY_LOCATION_ID', ''), ws = _ts2Rows_('WORKSHOPS'), have = {}; ws.forEach(function (w) { have[w.code] = true; });
  var wsRows = TS2_ZONES_.filter(function (z) { return !have[z[0]]; }).map(function (z) { created.workshops++; return { workshopId: _ts2Id_('WORKSHOPS'), enterpriseId: ent, locationId: locId, code: z[0], name: z[1], zoneType: z[2], status: 'ACTIVE', notApplicableReason: '', legacyName: z[1], createdAt: now, createdBy: actor }; });
  _ts2InsertMany_('WORKSHOPS', wsRows);
  if (!_ts2Rows_('ROLE_PERMISSIONS').length) {
    var rp = [];
    TS2_ROLES_.forEach(function (role) {
      var perms = {}; try { perms = role === 'Технический доступ' ? {} : (getRolePermissions(role) || {}); } catch (e) {}
      Object.keys(TS2_ACTIONS_).forEach(function (a) { var need = TS2_ACTIONS_[a]; var ok = role === 'Технический доступ' ? /^(enterprise\.view|backup\.)/.test(a) : need === '*' || String(need).split('|').some(function (k) { return perms[k] === true; }); rp.push({ roleCode: role, roleName: role, actionCode: a, allowed: ok, source: 'SEED ' + TS2_SEED_VERSION, version: 1, updatedAt: now }); });
    });
    _ts2InsertMany_('ROLE_PERMISSIONS', rp); created.roles = TS2_ROLES_.length;
  }
  var docs = {}; _ts2Rows_('SYSTEM_DOCUMENTS').forEach(function (d) { docs[d.templateId] = d; });
  var dRows = [], qRows = [];
  TS2_SYSTEM_DOCS_.forEach(function (t) {
    if (docs[t[0]]) return;
    var id = _ts2Id_('SYSTEM_DOCUMENTS'); created.documents++;
    dRows.push({ documentId: id, enterpriseId: ent, templateId: t[0], templateVersion: TS2_SEED_VERSION, documentType: t[2], title: t[1], approvalMode: t[3], status: t[4], requiresLocalApproval: t[5],
      localApprovalStatus: t[5] ? 'REQUIRES_ENTERPRISE_APPROVAL' : 'NOT_REQUIRED', source: t[3] === 'PROVIDER_TEMPLATE' ? 'ЦЕХ Стандарт, пакет ' + TS2_SEED_VERSION : 'автоматически собран из данных предприятия', fileId: '', validFrom: '', validTo: '', createdAt: now, updatedAt: now, approvedByEnterprise: '', approvedAt: '' });
    if (t[5]) { created.approvals++; qRows.push({ approvalId: _ts2Id_('APPROVAL_QUEUE'), enterpriseId: ent, objectType: 'SYSTEM_DOCUMENT', objectId: id, title: t[1], reason: t[3] === 'PROVIDER_TEMPLATE' ? 'Подтвердите применимость типовой инструкции' : 'Документ подготовлен системой — утвердите от имени предприятия', preparedBySystem: true, requiredRole: t[6], status: 'PENDING', approvedBy: '', approvedAt: '', comment: '' }); }
  });
  _ts2InsertMany_('SYSTEM_DOCUMENTS', dRows); _ts2InsertMany_('APPROVAL_QUEUE', qRows);
  var rules = {}; _ts2Rows_('EVENT_RULES').forEach(function (r) { rules[r.eventRuleId] = true; });
  var rRows = TS2_EVENT_RULES_.filter(function (r) { return !rules[r[0]]; }).map(function (r) { created.rules++;
    return { eventRuleId: r[0], enterpriseId: ent, eventType: r[1], sourceEntityType: r[2], sourceEvent: r[1], createsRecordType: r[3], journalCode: r[4], haccpControlPointId: '', requiredConfirmation: r[5] === 'CONFIRMATION',
      measurementMode: r[5], defaultResult: r[6], notificationRuleId: 'EXCEPTIONS_ONLY', active: true, version: 1, title: r[7], sourceTtkId: '' }; });
  _ts2InsertMany_('EVENT_RULES', rRows);
  _ts2SetProf_('mode', mode); _ts2SetProf_('seedVersion', TS2_SEED_VERSION); if (enterpriseType) _ts2SetProf_('enterpriseType', enterpriseType);
  _ts2SetProf_('manualInputPolicy', 'PHYSICAL_MEASUREMENTS_ONLY'); _ts2SetProf_('sensorPolicy', 'SENSOR_IF_REGISTERED');
  _ts2SyncLegacyObjects_();
  _ts2Audit_('READY_TO_WORK_INIT', 'ENTERPRISE', ent, undefined, { mode: mode, created: created, backupId: backupId }, 'пакет ' + TS2_SEED_VERSION);
  return { mode: mode, seedVersion: TS2_SEED_VERSION, created: created, backupId: backupId };
}
/** Холодильники и морозильники из существующего реестра температур → объекты замеров 2.1 (без изменения реестра). */
function _ts2SyncLegacyObjects_() {
  var have = {}; _ts2Rows_('MEASUREMENT_OBJECTS').forEach(function (o) { if (o.legacyObjectId) have[o.legacyObjectId] = true; });
  var rows = [];
  _ts2Legacy_('Температурные_Объекты').forEach(function (r) {
    var id = String(r['ObjectID'] || ''), t = String(r['Тип'] || ''); if (!id || have[id] || String(r['Статус']) === 'INACTIVE') return;
    var type = t === 'FREEZER' ? 'FREEZER' : t === 'STORAGE' ? 'ROOM' : /REFRIGERATOR|DISPLAY/.test(t) ? 'FRIDGE' : ''; if (!type) return;
    rows.push({ objectId: _ts2Id_('MEASUREMENT_OBJECTS'), enterpriseId: _ts2Ent_(), objectType: type, name: r['Название'], workshopId: '', minValue: r['Мин'], maxValue: r['Макс'], unit: '°C', setpoint: r['Установленная t°'],
      checkTimes: r['Время проверок'] || '', legacyObjectId: id, status: 'ACTIVE', notApplicableReason: '', lastReplacedAt: '', resourceHours: '', createdAt: _ts2Iso_(), createdBy: 'адаптер «Температурные_Объекты»' });
  });
  _ts2InsertMany_('MEASUREMENT_OBJECTS', rows);
  return rows.length;
}

/* ------------------------------------------------------------------ ожидания (задачи журналов) */
function _ts2Today_() { return Utilities.formatDate(new Date(), _mcTz_(), 'yyyy-MM-dd'); }
/** Задачи на день по расписаниям — только для активных объектов (ТЗ 2.1 §9.2). Повтор не создаёт дублей. */
function _ts2GenerateDay_(day) {
  day = day || _ts2Today_();
  var mode = _ts2Prof_('mode', ''); if (!mode) return 0;
  var dow = (new Date(day + 'T12:00:00').getDay() + 6) % 7 + 1, dom = Number(day.slice(8, 10));
  var keys = {}; _ts2Rows_('JOURNAL_EXPECTATIONS', function (e) { return String(e.dueAt).slice(0, 10) === day; }).forEach(function (e) { keys[e.idempotencyKey] = true; });
  var objs = _ts2Rows_('MEASUREMENT_OBJECTS', function (o) { return o.status === 'ACTIVE'; }), ws = _ts2Rows_('WORKSHOPS', function (w) { return w.status === 'ACTIVE' && w.zoneType === 'WORKSHOP'; });
  var rows = [], push = function (s, time, objType, objId, title) {
    var key = [_ts2Ent_(), day, s[0], objId, time].join('|'); if (keys[key]) return; keys[key] = true;
    rows.push({ expectationId: _ts2Id_('JOURNAL_EXPECTATIONS'), enterpriseId: _ts2Ent_(), journalCode: s[2], eventRuleId: 'SCHED-' + s[0], objectType: objType, objectId: objId, productionId: '', batchId: '',
      dueAt: day + 'T' + time + ':00', responsibleRole: s[6], status: 'OPEN', confirmationMode: /MEASURE/.test(s[5]) ? 'MEASURE' : 'CONFIRM', measurementRequired: /MEASURE/.test(s[5]),
      completedAt: '', completedBy: '', factId: '', title: title, idempotencyKey: key });
  };
  TS2_SCHEDULES_.forEach(function (s) {
    var times = String(s[4]).split(',');
    if (s[3] === 'WEEKLY') { if (Number(s[4].split(' ')[0]) !== dow) return; times = [s[4].split(' ')[1]]; }
    if (s[3] === 'MONTHLY') { if (Number(s[4].split(' ')[0]) !== dom) return; times = [s[4].split(' ')[1]]; }
    if (s[3] === 'SHIFT' || s[3] === 'WEEKLY' || s[3] === 'MONTHLY') { times.forEach(function (t) { push(s, t, s[3], 'SHIFT', s[1]); }); return; }
    if (s[3] === 'WORKSHOP') { ws.forEach(function (w) { times.forEach(function (t) { push(s, t, 'WORKSHOP', w.workshopId, s[1] + ' — ' + w.name); }); }); return; }
    var otype = s[0] === 'ROOM_TEMP' || s[0] === 'ROOM_HUMIDITY' ? 'ROOM' : s[3];
    objs.filter(function (o) { return o.objectType === otype; }).forEach(function (o) {
      (String(o.checkTimes || '').trim() ? String(o.checkTimes).split(',') : times).forEach(function (t) { push(s, String(t).trim(), s[0] === 'ROOM_HUMIDITY' ? 'ROOM_HUMIDITY' : o.objectType, o.objectId, s[1] + ': ' + o.name); });
    });
  });
  _ts2InsertMany_('JOURNAL_EXPECTATIONS', rows);
  return rows.length;
}

/* ------------------------------------------------------------------ автоматические записи по событиям */
function _ts2AutoRecord_(r) {
  return _withLock_(function () {
    var dup = _ts2Find_('AUTO_RECORDS', 'idempotencyKey', r.idempotencyKey);
    if (dup) return { duplicate: true, autoRecordId: dup.autoRecordId };
    var p = PropertiesService.getScriptProperties(), prev = p.getProperty('TS2_AUTO_LAST_HASH') || '';
    r.autoRecordId = _ts2Id_('AUTO_RECORDS'); r.enterpriseId = _ts2Ent_(); r.createdAt = _ts2Iso_(); r.createdBySystem = true; r.schemaVersion = TS2_SCHEMA_VERSION; r.prevHash = prev;
    if (_ts2Prof_('mode', '') === 'PILOT') r.status = 'PILOT';
    r.hash = _ts2Sha_(prev + '|' + [r.autoRecordId, r.eventType, r.sourceType, r.sourceId, r.recordType, r.kktId, r.productionId, r.batchId, r.result, r.measurementMode, r.value, r.createdAt, r.confirmedByEmployee].join('|'));
    _ts2Insert_('AUTO_RECORDS', r); p.setProperty('TS2_AUTO_LAST_HASH', r.hash);
    return { duplicate: false, autoRecordId: r.autoRecordId, result: r.result };
  });
}
/** Событие производства → записи по активным правилам. ctx: {sourceType, sourceId, productionId, batchId, ttkId, measurements:[{kktId, value, unit, ok, factId}], employee} */
function _ts2Emit_(eventType, ctx) {
  var mode = _ts2Prof_('mode', ''); if (!mode) return [];
  ctx = ctx || {}; var out = [], rules = _ts2Rows_('EVENT_RULES', function (r) { return r.eventType === eventType && String(r.active) === 'true'; });
  rules.forEach(function (rule) {
    var subject = ctx.productionId || ctx.batchId || ctx.sourceId || '';
    if (ctx.noCcp && rule.createsRecordType === 'HACCP_FACT') return;   // в ТТК нет такой ККТ — нечего ждать
    var meas = (ctx.measurements || []).filter(function (m) { return rule.createsRecordType === 'HACCP_FACT'; });
    var base = { eventType: eventType, sourceType: ctx.sourceType || eventType, sourceId: ctx.sourceId || subject, recordType: rule.createsRecordType, journalCode: rule.journalCode,
      productionId: ctx.productionId || '', batchId: ctx.batchId || '', ttkId: ctx.ttkId || rule.sourceTtkId || '', unit: '', confidence: 1, operationId: ctx.operationId || '',
      confirmedByEmployee: '', confirmedAt: '', ruleVersion: rule.eventRuleId + '@' + rule.version, status: 'ACTIVE' };
    var key = function (kkt) { return [_ts2Ent_(), subject, kkt || rule.eventRuleId, eventType, rule.version].join('|'); };
    if (rule.measurementMode === 'SENSOR_OR_DERIVED_OR_PENDING' || rule.measurementMode === 'MEASURE_IF_REQUIRED') {
      if (meas.length) meas.forEach(function (m) {
        var rec = Object.assign({}, base, { kktId: m.kktId || '', value: m.value, unit: m.unit || '', measurementMode: m.sensor ? 'SENSOR' : 'DERIVED', result: m.ok === false ? 'FAIL' : 'PASS',
          idempotencyKey: key(m.kktId), confirmedByEmployee: m.who || '', confirmedAt: m.at || '' });
        rec.sourceType = m.factId ? 'PRODUCTION_EVENT+LEGACY_FACT:' + m.factId : base.sourceType;
        var ar = _ts2AutoRecord_(rec); out.push(ar);
        if (m.ok === false && !ar.duplicate) _ts2Exception_('KKT_FAIL', 'ККТ вне предела: ' + (m.point || m.kktId) + ' = ' + m.value + ' ' + (m.unit || ''), subject);
      });
      else if (rule.measurementMode === 'SENSOR_OR_DERIVED_OR_PENDING' || ctx.measurementRequired) {
        // §7.3: нет замера — не придумываем число; создаём ожидание ручного замера
        out.push(_ts2AutoRecord_(Object.assign({}, base, { kktId: '', value: '', measurementMode: 'MANUAL_OR_SENSOR_REQUIRED', result: 'PENDING_CONFIRMATION', idempotencyKey: key('') })));
        _ts2Expect_(rule, subject, ctx, 'MEASURE', rule.title + ' — замер не получен автоматически: укажите значение');
      } else out.push(_ts2AutoRecord_(Object.assign({}, base, { kktId: '', value: '', measurementMode: 'EVENT', result: 'PASS', idempotencyKey: key('') })));
    } else if (rule.measurementMode === 'CONFIRMATION') {
      out.push(_ts2AutoRecord_(Object.assign({}, base, { kktId: '', value: '', measurementMode: 'OPERATOR_CONFIRMATION', result: 'PENDING_CONFIRMATION', idempotencyKey: key('') })));
      _ts2Expect_(rule, subject, ctx, 'CONFIRM', rule.title);
    } else {
      out.push(_ts2AutoRecord_(Object.assign({}, base, { kktId: '', value: '', measurementMode: 'EVENT', result: ctx.failed ? 'FAIL' : 'PASS', idempotencyKey: key('') })));
    }
  });
  return out;
}
function _ts2Expect_(rule, subject, ctx, mode, title) {
  var key = [_ts2Ent_(), subject, rule.eventRuleId, rule.version, 'EXP'].join('|');
  if (_ts2Find_('JOURNAL_EXPECTATIONS', 'idempotencyKey', key)) return;
  _ts2Insert_('JOURNAL_EXPECTATIONS', { expectationId: _ts2Id_('JOURNAL_EXPECTATIONS'), enterpriseId: _ts2Ent_(), journalCode: rule.journalCode, eventRuleId: rule.eventRuleId, objectType: rule.sourceEntityType,
    objectId: subject, productionId: ctx.productionId || '', batchId: ctx.batchId || '', dueAt: _ts2Iso_(), responsibleRole: 'Повар', status: 'OPEN', confirmationMode: mode, measurementRequired: mode === 'MEASURE',
    completedAt: '', completedBy: '', factId: '', title: title + (ctx.title ? ' — ' + ctx.title : ''), idempotencyKey: key });
}
/** Исключение: только они создают уведомления (ТЗ 2.1 §17). */
function _ts2Exception_(type, text, objectId) {
  var r = _ts2AutoRecord_({ eventType: 'EXCEPTION', sourceType: type, sourceId: objectId || '', recordType: 'DEVIATION', journalCode: 'J-DEVIATIONS', kktId: '', productionId: '', batchId: '', ttkId: '',
    result: 'FAIL', measurementMode: 'EVENT', value: text, unit: '', confidence: 1, status: 'OPEN', idempotencyKey: [_ts2Ent_(), type, objectId, _ts2Iso_()].join('|'), operationId: '', confirmedByEmployee: _ts2Actor_().name, confirmedAt: _ts2Iso_(), ruleVersion: '' });
  try { var to = PropertiesService.getScriptProperties().getProperty('MC_NOTIFY_EMAIL'); if (to && /KKT|TEMP|CRITICAL|HUMIDITY/.test(type)) MailApp.sendEmail(to, 'ЦЕХ Стандарт: отклонение', text); } catch (e) {}
  return r;
}

/** Вид ККТ по названию точки: тепловая обработка / охлаждение / разогрев. */
function _ts2CcpKind_(point) { var p = String(point || '').toLowerCase(); return /охлажд/.test(p) ? 'COOLING' : /разогр|регенер/.test(p) ? 'REHEAT' : 'THERMAL'; }
function _ts2CcpGroups_(items) {
  var g = { THERMAL: { items: [], meas: [] }, COOLING: { items: [], meas: [] }, REHEAT: { items: [], meas: [] } };
  items.forEach(function (x) { var k = _ts2CcpKind_(x.point); g[k].items.push(x);
    if (x.status === 'OK' || x.status === 'DEVIATION') g[k].meas.push({ kktId: x.controlId, point: x.point, value: x.value, unit: x.unit, ok: x.status === 'OK', factId: x.factId, who: x.who, at: x.at }); });
  return g;
}
/** Хук шлюза: после успешной записи из интерфейса создаёт события. Ошибка здесь никогда не ломает исходную операцию. */
function _ts2OnGateCall_(name, args, res) {
  try {
    if (!_ts2Prof_('mode', '')) return;
    var r = typeof res === 'string' ? _ts2J_(res) : res; if (r && (r.success === false || r.ok === false)) return;
    var d = r && r.data || r || {}, a = args || [];
    if (name === 'completeProduction' || name === 'completeV27Production') {
      var pid = String(a[0]), code = '', ccp = { items: [] };
      try { var f = _findProduction_(_productionSheet_(), pid); if (f) { code = String(f.data[PROD_COL_.code]); ccp = _tccpState_(code, pid); } } catch (e) {}
      var by = _ts2CcpGroups_(ccp.items || []), base = { sourceType: 'PRODUCTION_EVENT', sourceId: pid, productionId: pid, batchId: d.batchId || d.batch || '', ttkId: code, title: code };
      // выпуск: журналы выпуска и маркировки всегда; ККТ тепловой обработки — только если она есть в ТТК
      _ts2Emit_('PRODUCTION_RELEASE', Object.assign({}, base, { measurements: by.THERMAL.meas, noCcp: !by.THERMAL.items.length }));
      if (by.COOLING.items.length) _ts2Emit_('COOLING_FINISHED', Object.assign({}, base, { measurements: by.COOLING.meas }));
      if (by.REHEAT.items.length) _ts2Emit_('REHEAT_FINISHED', Object.assign({}, base, { measurements: by.REHEAT.meas }));
    } else if (name === 'mcRecordProductionCcp') {
      // замер охлаждения / разогрева записывается сразу, не дожидаясь закрытия заказа (повтор при закрытии не дублируется)
      var q = _ts2Json_(a[0], {}), st = d.state || { items: [] }, it = (st.items || []).filter(function (x) { return String(x.controlId) === String(q.controlId); })[0];
      var kind = it ? _ts2CcpKind_(it.point) : '';
      if (it && (kind === 'COOLING' || kind === 'REHEAT') && (it.status === 'OK' || it.status === 'DEVIATION'))
        _ts2Emit_(kind === 'COOLING' ? 'COOLING_FINISHED' : 'REHEAT_FINISHED', { sourceType: 'PRODUCTION_EVENT', sourceId: String(q.productionId), productionId: String(q.productionId), measurements: _ts2CcpGroups_([it])[kind].meas });
    } else if (name === 'createBatchFromReceiving' || name === 'mcRecordIncomingControl') {
      var j = _ts2Json_(a[0], {}); _ts2Emit_('RECEIVING_CONFIRMED', { sourceType: 'RECEIVING', sourceId: d.batchId || j.batchId || (d.batches && d.batches[0] && d.batches[0].batchId) || '', batchId: d.batchId || j.batchId || '' });
    } else if (name === 'openBatchContainer') { _ts2Emit_('BATCH_OPENED', { sourceType: 'BATCH', sourceId: String(a[0]) + '|' + _ts2Iso_().slice(0, 16), batchId: String(a[0]) }); }
    else if (name === 'mcDefrostFinish') {
      var df = _ts2Json_(a[0], {}), tv = _ts2Num_(df.temperature);
      _ts2Emit_('DEFROST_FINISHED', { sourceType: 'DEFROST', sourceId: String(d.batchId || df.batchId), batchId: String(d.batchId || df.batchId), measurementRequired: true,
        measurements: tv === null ? [] : [{ kktId: 'DEFROST', point: 'Размораживание: t° в толще', value: tv, unit: '°C', ok: !d.blocked, who: '', at: _ts2Iso_() }] });
      if (d.blocked) _ts2Exception_('DEFROST_FAIL', 'Размораживание партии ' + (d.batchId || df.batchId) + ': ' + (d.reasons || []).join('; '), String(d.batchId || df.batchId));
    }
    else if (name === 'mcDefrostMeasure') { if (d.result === 'DEVIATION') { var dm = _ts2Json_(a[0], {}); _ts2Exception_('DEFROST_FAIL', 'Размораживание партии ' + dm.batchId + ': t° в толще ' + dm.temperature + ' °C выше нормы — партия заблокирована до решения', String(dm.batchId)); } }
    else if (name === 'issueV28Banquet') { _ts2Emit_('RELEASE_TO_HALL', { sourceType: 'BANQUET_ISSUE', sourceId: String(a[0]) + '|' + _ts2Iso_().slice(0, 13), title: 'банкет ' + a[0] }); }
    else if (name === 'mcTakeDailySample') { _ts2Emit_('DAILY_SAMPLE_TAKEN', { sourceType: 'DAILY_SAMPLE', sourceId: String(d.id || d.sampleId || _ts2Json_(a[0], {}).batchId || ''), batchId: String(_ts2Json_(a[0], {}).batchId || '') }); }
    else if (name === 'saveChecklistExecution') { _ts2Emit_('SANITATION_CONFIRMED', { sourceType: 'CHECKLIST', sourceId: String(d.id || d.executionId || _ts2Iso_()) }); }
  } catch (e) { try { _log_('WARN', 'ЦЕХ 2.1 событие ' + name + ': ' + (e && e.message || e)); } catch (x) {} }
}

/* ------------------------------------------------------------------ экран повара */
function _ts2NowTasks_() {
  _ts2GenerateDay_();
  var day = _ts2Today_(), objs = {}; _ts2Rows_('MEASUREMENT_OBJECTS').forEach(function (o) { objs[o.objectId] = o; });
  var list = _ts2Rows_('JOURNAL_EXPECTATIONS', function (e) { return e.status === 'OPEN' && String(e.dueAt).slice(0, 10) <= day; });
  list.sort(function (a, b) { return String(a.dueAt) < String(b.dueAt) ? -1 : 1; });
  return list.map(function (e) {
    var o = objs[e.objectId] || null, kind = e.objectType === 'ROOM_HUMIDITY' ? 'ROOM_HUMIDITY' : o ? o.objectType : '';
    return { id: e.expectationId, title: e.title, due: String(e.dueAt).slice(11, 16), overdue: String(e.dueAt) < _ts2Iso_(), mode: e.confirmationMode, role: e.responsibleRole,
      measure: e.confirmationMode === 'MEASURE' ? { kind: kind || 'OTHER', unit: (TS2_MEASURE_TYPES_[kind] || TS2_MEASURE_TYPES_.OTHER)[1], min: kind === 'ROOM_HUMIDITY' ? '' : o ? o.minValue : '', max: kind === 'ROOM_HUMIDITY' ? '' : o ? o.maxValue : '', object: o ? o.name : '' } : null };
  });
}
function _ts2Confirm_(id, yes, reason, comment) {
  var e = _ts2Find_('JOURNAL_EXPECTATIONS', 'expectationId', id); if (!e) throw new Error('NOT_FOUND: задача не найдена');
  if (e.status !== 'OPEN') throw new Error('VALIDATION: задача уже закрыта');
  if (e.confirmationMode === 'MEASURE' && yes) throw new Error('VALIDATION: для этой задачи нужен замер — введите значение');
  if (!yes && !String(reason || '').trim()) throw new Error('VALIDATION: укажите причину');
  var a = _ts2Actor_();
  var r = _ts2AutoRecord_({ eventType: 'CONFIRMATION', sourceType: 'JOURNAL_EXPECTATION', sourceId: id, recordType: 'JOURNAL_CONFIRMATION', journalCode: e.journalCode, kktId: '', productionId: e.productionId, batchId: e.batchId, ttkId: '',
    result: yes ? 'CONFIRMED_BY_OPERATOR' : 'FAIL', measurementMode: 'OPERATOR_CONFIRMATION', value: yes ? '' : String(reason) + (comment ? ': ' + comment : ''), unit: '', confidence: 1, status: 'ACTIVE',
    idempotencyKey: [_ts2Ent_(), id, 'CONFIRM'].join('|'), operationId: '', confirmedByEmployee: a.name, confirmedAt: _ts2Iso_(), ruleVersion: e.eventRuleId });
  _ts2Update_('JOURNAL_EXPECTATIONS', 'expectationId', id, { status: yes ? 'DONE' : 'FAILED', completedAt: _ts2Iso_(), completedBy: a.name, factId: r.autoRecordId });
  if (!yes) _ts2Exception_('TASK_NO', e.title + ' — «Нет»: ' + reason + (comment ? ' (' + comment + ')' : ''), id);
  _ts2CloseAutoPending_(e);
  return { id: id, result: yes ? 'CONFIRMED_BY_OPERATOR' : 'FAIL', record: r.autoRecordId };
}
/** Ручной замер — только разрешённые виды (ТЗ 2.1 §6.3). Результат вычисляется по пределам объекта. */
function _ts2Measure_(id, value, comment, token) {
  var e = _ts2Find_('JOURNAL_EXPECTATIONS', 'expectationId', id); if (!e) throw new Error('NOT_FOUND: задача не найдена');
  if (e.status !== 'OPEN') throw new Error('VALIDATION: задача уже закрыта');
  if (e.confirmationMode !== 'MEASURE') throw new Error('VALIDATION: эта задача подтверждается кнопкой «Да/Нет»');
  var o = _ts2Find_('MEASUREMENT_OBJECTS', 'objectId', e.objectId), kind = e.objectType === 'ROOM_HUMIDITY' ? 'ROOM_HUMIDITY' : o ? o.objectType : (e.eventRuleId.indexOf('EVR-') === 0 ? 'OTHER' : '');
  if (!TS2_MEASURE_TYPES_[kind]) throw new Error('VALIDATION: ручной числовой ввод для этой операции не предусмотрен');
  var isFryer = kind === 'FRYER', v = isFryer ? String(value || '').trim() : _ts2Num_(value);
  if (!isFryer && v === null) throw new Error('VALIDATION: введите число');
  var min = kind === 'ROOM_HUMIDITY' || !o ? '' : o.minValue, max = kind === 'ROOM_HUMIDITY' || !o ? '' : o.maxValue;
  var res = isFryer ? (/замен|плох|темн|не годен/i.test(v) ? 'FAIL' : 'PASS') : ((min !== '' && v < Number(min)) || (max !== '' && v > Number(max)) ? 'FAIL' : (min === '' && max === '' ? 'REVIEW' : 'PASS'));
  if (res === 'FAIL' && !String(comment || '').trim() && !isFryer) throw new Error('VALIDATION: значение вне нормы — добавьте комментарий');
  var a = _ts2Actor_(), mId = _ts2Id_('MANUAL_MEASUREMENTS'), unit = TS2_MEASURE_TYPES_[kind][1];
  _ts2Insert_('MANUAL_MEASUREMENTS', { measurementId: mId, enterpriseId: _ts2Ent_(), measurementType: TS2_MEASURE_TYPES_[kind][0], objectType: kind, objectId: e.objectId, value: v, unit: unit, minValue: min, maxValue: max,
    result: res, employeeId: a.name, recordedAt: _ts2Iso_(), source: 'MANUAL', comment: comment || '', photoFileId: '', operationId: '' });
  if (o && o.legacyObjectId && (kind === 'FRIDGE' || kind === 'FREEZER') && typeof mcRecordTemperature === 'function') {
    try { mcRecordTemperature(JSON.stringify({ objectId: o.legacyObjectId, value: v, comment: comment || '' }), token); } catch (x) {}   // журнал температур ведётся как прежде
  }
  if (kind === 'UV_LAMP' && o) _ts2Update_('MEASUREMENT_OBJECTS', 'objectId', o.objectId, { resourceHours: Number(o.resourceHours || 0) + (Number(v) || 0) });
  var r = _ts2AutoRecord_({ eventType: 'MEASUREMENT', sourceType: 'MANUAL_MEASUREMENT', sourceId: mId, recordType: 'HACCP_FACT', journalCode: e.journalCode, kktId: '', productionId: e.productionId, batchId: e.batchId, ttkId: '',
    result: res, measurementMode: 'MANUAL', value: v, unit: unit, confidence: 1, status: 'ACTIVE', idempotencyKey: [_ts2Ent_(), id, 'MEASURE'].join('|'), operationId: '', confirmedByEmployee: a.name, confirmedAt: _ts2Iso_(), ruleVersion: e.eventRuleId });
  _ts2Update_('JOURNAL_EXPECTATIONS', 'expectationId', id, { status: res === 'FAIL' ? 'FAILED' : 'DONE', completedAt: _ts2Iso_(), completedBy: a.name, factId: r.autoRecordId });
  if (res === 'FAIL') _ts2Exception_(kind === 'ROOM_HUMIDITY' ? 'HUMIDITY_OUT' : isFryer ? 'FRYER_REPLACE' : 'TEMP_OUT', e.title + ': ' + v + ' ' + unit + (min !== '' || max !== '' ? ' (норма ' + min + '…' + max + ')' : '') + (comment ? ' — ' + comment : ''), e.objectId);
  _ts2CloseAutoPending_(e, v, res);
  return { id: id, result: res, value: v, unit: unit };
}
/** Ожидание по событию (замер ККТ) закрыто — соответствующая запись PENDING получает итог. */
function _ts2CloseAutoPending_(e, v, res) {
  if (e.eventRuleId.indexOf('EVR-') !== 0) return;
  var p = _ts2Rows_('AUTO_RECORDS', function (r) { return r.result === 'PENDING_CONFIRMATION' && r.ruleVersion.indexOf(e.eventRuleId) === 0 && (r.productionId === e.productionId || r.sourceId === e.objectId); })[0];
  if (p) _ts2Update_('AUTO_RECORDS', 'autoRecordId', p.autoRecordId, { status: 'SUPERSEDED' });
}

/* ------------------------------------------------------------------ мастер и готовность */
function _ts2WizardState_() {
  _ts2EnsureSchema_(false);
  var org = {}; try { org = _mcOrg_(); } catch (e) {}
  var complete = false; try { complete = _mcOrgCompleteness_(org).complete; } catch (e) {}
  var created = _ts2Rows_('SYSTEM_DOCUMENTS').length + _ts2Rows_('EVENT_RULES').length + _ts2Rows_('WORKSHOPS').length + _ts2Rows_('ROLE_PERMISSIONS').length + _ts2Rows_('LOCATIONS').length;
  var decide = _ts2Rows_('APPROVAL_QUEUE', function (q) { return q.status === 'PENDING'; }).length;
  var numeric = _ts2Rows_('MEASUREMENT_OBJECTS', function (o) { return o.status === 'ACTIVE'; }).length;
  var blockers = _ts2Rows_('RECONCILIATION_ISSUES', function (i) { return i.status === 'OPEN' && i.severity === 'BLOCKER'; }).length;
  var emps = []; try { emps = _ts2Employees_(); } catch (e) {}
  return { mode: _ts2Prof_('mode', ''), enterpriseType: _ts2Prof_('enterpriseType', ''), types: TS2_ENTERPRISE_TYPES_, org: { name: org.name || '', inn: org.inn || '', address: org.actualAddress || '', responsible: org.responsibleName || '', complete: complete },
    timezone: _ts2Cfg_('TIMEZONE', _mcTz_()), workshops: _ts2Rows_('WORKSHOPS'), objects: _ts2Rows_('MEASUREMENT_OBJECTS'), employees: emps.length, dishes: (function () { try { return _ts2Dishes_().length; } catch (e) { return 0; } })(),
    summary: { created: created, requiresDecision: decide, numericObjects: numeric, blockers: blockers } };
}
function _ts2WizardSave_(step, data, token) {
  data = data || {};
  if (step === 1) {
    if (data.org) { var r = _ts2J_(mcOrgSave(JSON.stringify(data.org), token)); if (r && r.success === false) throw new Error('VALIDATION: ' + (r.error && r.error.message)); }
    if (data.timezone) _ts2SetCfg_('TIMEZONE', data.timezone, 'CLIENT');
    if (data.org && data.org.name) _ts2SetCfg_('ENTERPRISE_NAME', data.org.name, 'CLIENT');
  } else if (step === 2) {
    if (!TS2_ENTERPRISE_TYPES_[data.type]) throw new Error('VALIDATION: выберите тип предприятия');
    if (!_ts2Prof_('mode', '')) _ts2InitializeReadyToWork_(data.mode || 'READY_TO_WORK', data.type); else _ts2SetProf_('enterpriseType', data.type);
  } else if (step === 3) {
    (data.workshops || []).forEach(function (w) {
      var cur = _ts2Find_('WORKSHOPS', 'workshopId', w.workshopId); if (!cur) return;
      var st = w.active ? 'ACTIVE' : 'NOT_APPLICABLE';
      if (st === 'NOT_APPLICABLE' && !String(w.reason || '').trim()) throw new Error('VALIDATION: укажите причину для «' + cur.name + '»');
      if (cur.status !== st) { _ts2Update_('WORKSHOPS', 'workshopId', w.workshopId, { status: st, notApplicableReason: st === 'ACTIVE' ? '' : w.reason }); _ts2Audit_('WORKSHOP_APPLICABILITY', 'WORKSHOP', w.workshopId, { status: cur.status }, { status: st, reason: w.reason || '' }, w.reason || ''); }
    });
  } else if (step === 4) {
    var o = data.object || {};
    if (!TS2_MEASURE_TYPES_[o.objectType] || o.objectType === 'ROOM_HUMIDITY' || o.objectType === 'OTHER') throw new Error('VALIDATION: тип объекта: холодильник, морозильник, помещение, фритюрница, бактерицидная лампа');
    if (!String(o.name || '').trim()) throw new Error('VALIDATION: укажите название объекта');
    if ((o.objectType === 'FRIDGE' || o.objectType === 'FREEZER' || o.objectType === 'ROOM') && o.minValue === '' && o.maxValue === '') throw new Error('VALIDATION: укажите допустимый диапазон по документу (инструкция оборудования, условия хранения)');
    var legacy = '';
    if ((o.objectType === 'FRIDGE' || o.objectType === 'FREEZER') && typeof mcSaveTempObject === 'function') {
      var lr = _ts2J_(mcSaveTempObject(JSON.stringify({ name: o.name, type: o.objectType === 'FRIDGE' ? 'REFRIGERATOR' : 'FREEZER', min: o.minValue, max: o.maxValue, setpoint: o.setpoint, times: o.checkTimes }), token));
      if (lr && lr.success === false) throw new Error('VALIDATION: ' + (lr.error && lr.error.message));
      legacy = lr && lr.data && (lr.data.id || lr.data.objectId) || '';
    }
    _ts2Insert_('MEASUREMENT_OBJECTS', { objectId: _ts2Id_('MEASUREMENT_OBJECTS'), enterpriseId: _ts2Ent_(), objectType: o.objectType, name: o.name, workshopId: o.workshopId || '', minValue: o.minValue === undefined ? '' : o.minValue,
      maxValue: o.maxValue === undefined ? '' : o.maxValue, unit: (TS2_MEASURE_TYPES_[o.objectType] || [])[1] || '', setpoint: o.setpoint || '', checkTimes: o.checkTimes || '', legacyObjectId: legacy, status: 'ACTIVE', notApplicableReason: '',
      lastReplacedAt: o.lastReplacedAt || '', resourceHours: o.resourceHours || '', createdAt: _ts2Iso_(), createdBy: _ts2Actor_().name });
  } else if (step === 5) {
    var made = 0, errs = [];
    (data.employees || []).forEach(function (e) {
      var r = _ts2J_(createEmployee(JSON.stringify(e), token)); if (r && (r.success === false || r.error)) errs.push((e.lastName || '') + ': ' + (r.error && (r.error.message || r.error))); else made++;
    });
    return { created: made, errors: errs };
  } else if (step === 6) {
    _ts2SetProf_('ttkChoice', data.choice || 'OWN');
  } else if (step === 7) {
    return _ts2Readiness_();
  } else throw new Error('VALIDATION: шаг 1–7');
  _ts2Audit_('WIZARD_STEP', 'ENTERPRISE', _ts2Ent_(), undefined, { step: step }, '');
  return _ts2WizardState_();
}
/** Отчёт «готово к работе» (ТЗ 2.0 §9.5, 2.1 §20). */
function _ts2Readiness_() {
  var emps = []; try { emps = _ts2Employees_(); } catch (e) {}
  var org = {}, orgOk = false; try { org = _mcOrg_(); orgOk = _mcOrgCompleteness_(org).complete; } catch (e) {}
  var crit = [
    ['NO_BLOCKERS', 'Нет блокирующих проблем сверки', !_ts2Rows_('RECONCILIATION_ISSUES', function (i) { return i.status === 'OPEN' && i.severity === 'BLOCKER'; }).length && _ts2Rows_('RECONCILIATION_RUNS').length > 0],
    ['DIRECTOR', 'Директор назначен', emps.some(function (e) { return e.role === 'Директор'; })],
    ['HACCP', 'Ответственный за ХАССП назначен', emps.some(function (e) { return e.role === 'Ответственный за ХАССП'; })],
    ['BACKUP', 'Резервная копия создана', _ts2Rows_('BACKUP_CATALOG', function (b) { return b.status === 'OK'; }).length > 0],
    ['ROLES', 'Роли и права проверены', _ts2Rows_('ROLE_PERMISSIONS').length > 0],
    ['TTK', 'Основные ТТК сопоставлены', _ts2Rows_('MIGRATION_MAP', function (m) { return m.entityType === 'DISH' || m.entityType === 'TTK'; }).length > 0],
    ['JOURNALS', 'Обязательные журналы и ККТ заведены', _ts2Rows_('EVENT_RULES', function (r) { return String(r.active) === 'true'; }).length >= TS2_EVENT_RULES_.length],
    ['ORG', 'Реквизиты предприятия подтверждены', orgOk],
    ['TEST_CYCLE', 'Тестовый производственный цикл пройден', _ts2Rows_('AUTO_RECORDS', function (r) { return r.eventType === 'PRODUCTION_RELEASE'; }).length > 0],
    ['PROTOCOL', 'Протокол запуска подписан ответственным', _ts2Rows_('APPROVAL_QUEUE', function (q) { return q.objectType === 'LAUNCH_PROTOCOL' && q.status === 'APPROVED'; }).length > 0]
  ];
  var pass = crit.filter(function (c) { return c[2]; }).length, id = _ts2Id_('READINESS_RUNS');
  _ts2Insert_('READINESS_RUNS', { readinessRunId: id, enterpriseId: _ts2Ent_(), runType: 'GO_LIVE', startedAt: _ts2Iso_(), completedAt: _ts2Iso_(), status: pass === crit.length ? 'READY' : 'NOT_READY', passCount: pass,
    failCount: crit.length - pass, reviewCount: 0, missingEvidenceCount: crit.length - pass, detailsJson: JSON.stringify(crit), reportFileId: '', createdBy: _ts2Actor_().name });
  return { readinessRunId: id, ready: pass === crit.length, pass: pass, total: crit.length, criteria: crit.map(function (c) { return { code: c[0], title: c[1], ok: c[2] }; }), summary: _ts2WizardState_().summary };
}

/* ------------------------------------------------------------------ очередь утверждения */
function _ts2ApproveQueue_(id, approve, comment) {
  var q = _ts2Find_('APPROVAL_QUEUE', 'approvalId', id); if (!q) throw new Error('NOT_FOUND: элемент очереди не найден');
  if (q.status !== 'PENDING') throw new Error('VALIDATION: уже ' + q.status);
  var s = typeof mcGateSession_ === 'function' ? mcGateSession_() : null;
  if (s && s.dev) throw new Error('FORBIDDEN: технический доступ не утверждает документы предприятия');
  if (s) {
    var ok = q.requiredRole === 'Ответственный за ХАССП' ? (_mcRbHas_(s, 'haccp_approve') || s.role === 'Директор') : q.requiredRole === 'Директор' ? (s.role === 'Директор' || _mcRbHas_(s, 'org_edit')) : true;
    if (!ok) throw new Error('FORBIDDEN: утверждает роль «' + q.requiredRole + '»');
  }
  if (q.objectType === 'GENERATION_PACKAGE' && approve) _ts2GenCheck_(q.objectId);   // BLOCKER и конфликты не дают утвердить
  if (q.objectType === 'SYSTEM_DOCUMENT' && approve) {   // утверждают текст, а не строку реестра: документ формируется до утверждения
    var sd = _ts2Find_('SYSTEM_DOCUMENTS', 'documentId', q.objectId);
    if (sd && !sd.fileId) _ts2SdocGenerate_(q.objectId, false);
  }
  var a = _ts2Actor_(), st = approve ? 'APPROVED' : 'REJECTED';
  _ts2Update_('APPROVAL_QUEUE', 'approvalId', id, { status: st, approvedBy: a.name, approvedAt: _ts2Iso_(), comment: comment || '' });
  if (q.objectType === 'SYSTEM_DOCUMENT') _ts2Update_('SYSTEM_DOCUMENTS', 'documentId', q.objectId, { localApprovalStatus: st, status: approve ? 'ACTIVE' : 'REJECTED', approvedByEnterprise: approve ? a.name + ' (' + a.role + ')' : '', approvedAt: approve ? _ts2Iso_() : '', updatedAt: _ts2Iso_() });
  if (q.objectType === 'GENERATION_PACKAGE' && approve) _ts2GenApprove_(q.objectId);
  _ts2Audit_(approve ? 'ENTERPRISE_APPROVE' : 'ENTERPRISE_REJECT', q.objectType, q.objectId, { status: 'PENDING' }, { status: st }, comment);
  return { id: id, status: st };
}

/* ------------------------------------------------------------------ API */
function ts2InitializeReadyToWork(token, mode, enterpriseType) { try { _requireAuth_(token, 'org_edit'); return _ok_(_ts2InitializeReadyToWork_(mode, enterpriseType)); } catch (e) { return _failFrom_(e); } }
function initializeReadyToWork() { return _ts2InitializeReadyToWork_('READY_TO_WORK', ''); }   // из редактора (владелец)
function ts2Now(token) { try { _requireAuth_(token); _ts2EnsureSchema_(false); return _ok_({ mode: _ts2Prof_('mode', ''), tasks: _ts2NowTasks_() }); } catch (e) { return _failFrom_(e); } }
function ts2Confirm(token, id, yes, reason, comment) { try { _requireAuth_(token); return _ok_(_ts2Confirm_(id, yes === true || yes === 'true', reason, comment)); } catch (e) { return _failFrom_(e); } }
function ts2Measure(token, id, value, comment) { try { _requireAuth_(token); return _ok_(_ts2Measure_(id, value, comment, token)); } catch (e) { return _failFrom_(e); } }
function ts2Exceptions(token) {
  try {
    _requireAuth_(token); _ts2EnsureSchema_(false);
    var ex = _ts2Rows_('AUTO_RECORDS', function (r) { return r.recordType === 'DEVIATION' && r.status === 'OPEN'; }).reverse();
    var pend = _ts2Rows_('JOURNAL_EXPECTATIONS', function (e) { return e.status === 'OPEN' && String(e.dueAt) < _ts2Iso_(); });
    return _ok_({ exceptions: ex, overdue: pend, autoToday: _ts2Rows_('AUTO_RECORDS', function (r) { return String(r.createdAt).slice(0, 10) === _ts2Today_(); }).length });
  } catch (e) { return _failFrom_(e); }
}
function ts2ResolveException(token, id, action) {
  try {
    _requireAuth_(token); if (!String(action || '').trim()) return _fail_('VALIDATION', 'Опишите корректирующее действие');
    var r = _ts2Find_('AUTO_RECORDS', 'autoRecordId', id); if (!r) return _fail_('NOT_FOUND', 'Отклонение не найдено');
    _ts2Update_('AUTO_RECORDS', 'autoRecordId', id, { status: 'RESOLVED' });
    _ts2Audit_('DEVIATION_RESOLVE', 'DEVIATION', id, { status: 'OPEN' }, { status: 'RESOLVED', action: action }, action);
    return _ok_({ id: id });
  } catch (e) { return _failFrom_(e); }
}
function ts2Wizard(token) { try { _requireAuth_(token); return _ok_(_ts2WizardState_()); } catch (e) { return _failFrom_(e); } }
function ts2WizardSave(token, step, data) { try { _requireAuth_(token, 'org_edit'); return _ok_(_ts2WizardSave_(Number(step), data, token)); } catch (e) { return _failFrom_(e); } }
function ts2Readiness(token) { try { _requireAuth_(token); return _ok_(_ts2Readiness_()); } catch (e) { return _failFrom_(e); } }
function ts2ApprovalQueue(token) {
  try { _requireAuth_(token); _ts2EnsureSchema_(false); return _ok_({ queue: _ts2Rows_('APPROVAL_QUEUE').reverse(), documents: _ts2Rows_('SYSTEM_DOCUMENTS') }); } catch (e) { return _failFrom_(e); }
}
function ts2ApproveQueueItem(token, id, approve, comment) { try { _requireAuth_(token); return _ok_(_ts2ApproveQueue_(id, approve === true || approve === 'true', comment)); } catch (e) { return _failFrom_(e); } }
/** Протокол запуска: создаётся в очереди утверждения, подписывает директор (критерий перехода в эксплуатацию). */
function ts2RequestLaunchProtocol(token) {
  try {
    _requireAuth_(token);
    if (_ts2Rows_('APPROVAL_QUEUE', function (q) { return q.objectType === 'LAUNCH_PROTOCOL' && q.status === 'PENDING'; }).length) return _ok_({ exists: true });
    _ts2Insert_('APPROVAL_QUEUE', { approvalId: _ts2Id_('APPROVAL_QUEUE'), enterpriseId: _ts2Ent_(), objectType: 'LAUNCH_PROTOCOL', objectId: _ts2Ent_(), title: 'Протокол запуска в эксплуатацию', reason: 'Подтвердите переход из пилота в рабочий режим', preparedBySystem: true, requiredRole: 'Директор', status: 'PENDING', approvedBy: '', approvedAt: '', comment: '' });
    return _ok_({ created: true });
  } catch (e) { return _failFrom_(e); }
}
