// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Equipment.gs (v2, новый модуль — ТЗ §11/§16)
 * Оборудование (холодильники, морозильники, духовые шкафы и т.п.) — привязывается к
 * цеху и точке. Используется двояко: как объект учёта поверки/обслуживания, и как
 * ССЫЛКА из JOURNAL_DEFINITIONS.equipment_id — "температура холодильника №3", а не
 * безликий текст "холодильник" (важно, когда в цехе несколько единиц одного типа).
 */

function createEquipment_(data, actorUserId, session) {
  if (!data.location_id) throw new Error('createEquipment_: location_id обязателен.');
  if (!data.название) throw new Error('createEquipment_: название обязательно.');
  var eq = {
    equipment_id: generateId_('EQUIPMENT'),
    location_id: data.location_id,
    workshop_id: data.workshop_id || '',
    название: data.название,
    тип: data.тип || '',
    номер: data.номер || '',
    мин_температура: data.мин_температура === undefined ? '' : Number(data.мин_температура),
    макс_температура: data.макс_температура === undefined ? '' : Number(data.макс_температура),
    статус: 'исправно',
    дата_проверки: data.дата_проверки || '',
    следующая_проверка: data.следующая_проверка || '',
    ответственный_id: data.ответственный_id || '',
    manufacturer:data.manufacturer||'', model:data.model||'', serial_number:data.serial_number||'', inventory_number:data.inventory_number||'',
    risk_level:data.risk_level||'', instruction_required:data.instruction_required===undefined?'':String(data.instruction_required), training_required:data.training_required===undefined?'':String(data.training_required), test_required:data.test_required===undefined?'':String(data.test_required), maintenance_schedule:data.maintenance_schedule||'', calibration_required:data.calibration_required===undefined?'':String(data.calibration_required), active:data.active===undefined?true:Boolean(data.active), created_at:nowIso_(), updated_at:nowIso_()
  };
  insertRow_('EQUIPMENT', eq);
  detectAndRequestPpkReview_(eq.organization_id || (findOne_('LOCATIONS','location_id',eq.location_id)||{}).organization_id,eq.location_id,'EQUIPMENT_ADDED','EQUIPMENT',eq.equipment_id,actorUserId,null,'Добавлено оборудование.');
  auditLog_(actorUserId, 'Добавлено оборудование', 'EQUIPMENT:' + eq.equipment_id, null, eq.название, 'success', session ? session.cascade_id : '');
  if (session && typeof syncEmployeesForEquipmentChange_ === 'function') syncEmployeesForEquipmentChange_(eq, session);
  return eq;
}

/**
 * Внешний P0-аудит, п.3 (продолжение, раунд 12) — НАЙДЕНО: patch применялся к updateRow_
 * без ограничения полей (см. _stripProtectedFields_ в Auth.gs). location_id из
 * клиентского patch теперь всегда игнорируется (переносить оборудование между ТОЧКАМИ
 * эта операция не умеет и не должна). workshop_id — легитимно переносимое поле (та же
 * точка, другой цех — например, холодильник переставили из цеха холодной обработки в
 * заготовочный), но если он присутствует в patch, проверяем, что целевой цех
 * действительно принадлежит ТОЙ ЖЕ точке, что и оборудование — иначе можно было бы
 * "привязать" оборудование к цеху чужой точки/организации без переноса самого
 * location_id (та же по сути дыра в обход первой проверки).
 */
function updateEquipment_(equipmentId, patch, session) {
  var eq = findOne_('EQUIPMENT', 'equipment_id', equipmentId);
  assertOwnedByLocation_(session, eq, 'EQUIPMENT:' + equipmentId); // ТЗ P0.1
  var safePatch = _stripProtectedFields_(patch, ['location_id']);
  if (safePatch.workshop_id) {
    var targetWs = findOne_('WORKSHOPS', 'workshop_id', safePatch.workshop_id);
    if (!targetWs || targetWs.location_id !== eq.location_id) {
      throw new Error('FORBIDDEN_SCOPE: цех "' + safePatch.workshop_id + '" не относится к точке этого оборудования. Действие отклонено.');
    }
  }
  updateRow_('EQUIPMENT', eq, safePatch);
  if (session && typeof syncEmployeesForEquipmentChange_ === 'function') syncEmployeesForEquipmentChange_(findOne_('EQUIPMENT','equipment_id',equipmentId), session);
  auditLog_(session.user_id, 'Изменено оборудование', 'EQUIPMENT:' + equipmentId, null, JSON.stringify(safePatch), 'success', session.cascade_id);
  return findOne_('EQUIPMENT', 'equipment_id', equipmentId);
}

/**
 * Раунд 11 — НАЙДЕНО ПРИ АУДИТЕ (честно указано в отчёте раунда 10): дата_проверки/
 * следующая_проверка существуют в схеме EQUIPMENT с самых ранних раундов, но
 * НИКОГДА и нигде не читались обратно — только записывались при создании/правке.
 * Никакого расчёта просрочки не было вообще. Добавлено АДДИТИВНО (только новые
 * вычисляемые поля на возвращаемых строках, ни одно существующее поле не меняется —
 * безопасно для всего, что уже читает getEquipment_ сегодня): просрочено = true, если
 * следующая_проверка задана и она СТРОГО в прошлом относительно сегодня; дней_до_проверки
 * — знаковое число дней (отрицательное — просрочено на N дней). Оборудование без
 * заданной следующая_проверка честно помечается просрочено:false/дней_до_проверки:null
 * (нет данных — не "не просрочено", а "неизвестно"; на UI это должно показываться
 * иначе, чем "исправно по графику" — см. Index.html).
 */
function _withMaintenanceStatus_(eq) {
  var result = {};
  Object.keys(eq).forEach(function (k) { result[k] = eq[k]; });
  if (!eq.следующая_проверка) {
    result.просрочено = false;
    result.дней_до_проверки = null;
    return result;
  }
  var next = new Date(eq.следующая_проверка);
  var today = new Date(new Date().toDateString());
  var diffDays = Math.round((next - today) / (24 * 60 * 60 * 1000));
  result.просрочено = diffDays < 0;
  result.дней_до_проверки = diffDays;
  return result;
}

function getEquipment_(locationId, workshopId) {
  return findRows_('EQUIPMENT', function (r) {
    return (!locationId || r.location_id === locationId) && (!workshopId || r.workshop_id === workshopId);
  }).map(_withMaintenanceStatus_);
}

var EQUIPMENT_MAINTENANCE_TYPES = ['обслуживание', 'поломка', 'ремонт', 'проверка'];

/**
 * Раунд 11 — журнал событий ТО (честно указано в отчёте раунда 10: "оборудование —
 * без истории обслуживания"). Событие типа 'проверка' с указанной nextCheckDate ОБНОВЛЯЕТ
 * EQUIPMENT.дата_проверки/следующая_проверка (та же запись, что раньше делалась только
 * вручную через UPDATE_EQUIPMENT) — так что после отметки о пройденной проверке
 * просрочка в getEquipment_ выше честно пересчитывается на следующий вызов, без
 * отдельного ручного шага "и ещё не забудь поправить дату в карточке оборудования".
 */
function logEquipmentMaintenance_(data, userId, session) {
  return withLock_(function () {
    var eq = findOne_('EQUIPMENT', 'equipment_id', data.equipmentId);
    if (session) assertOwnedByLocation_(session, eq, 'EQUIPMENT:' + data.equipmentId); // ТЗ P0.1
    else if (!eq) throw new Error('Оборудование не найдено: ' + data.equipmentId);
    if (EQUIPMENT_MAINTENANCE_TYPES.indexOf(data.тип) === -1) {
      throw new Error('Недопустимый тип события: "' + data.тип + '". Разрешено: ' + EQUIPMENT_MAINTENANCE_TYPES.join(', ') + '.');
    }
    var log = {
      log_id: generateId_('EQUIPMENT_MAINTENANCE_LOG'),
      equipment_id: eq.equipment_id,
      location_id: eq.location_id,
      дата: data.дата || nowIso_().slice(0, 10),
      тип: data.тип,
      описание: data.описание || '',
      user_id: userId || '',
      создано: nowIso_()
    };
    insertRow_('EQUIPMENT_MAINTENANCE_LOG', log);

    if (data.тип === 'проверка') {
      var patch = { дата_проверки: log.дата };
      if (data.следующая_проверка) patch.следующая_проверка = data.следующая_проверка;
      updateRow_('EQUIPMENT', eq, patch);
    }

    auditLog_(userId, 'Событие ТО оборудования', 'EQUIPMENT:' + eq.equipment_id, null, data.тип + (data.описание ? ': ' + data.описание : ''), 'success', session ? session.cascade_id : '');
    return log;
  });
}

function getEquipmentMaintenanceLog_(equipmentId, session) {
  var eq = findOne_('EQUIPMENT', 'equipment_id', equipmentId);
  if (session) assertOwnedByLocation_(session, eq, 'EQUIPMENT:' + equipmentId); // ТЗ P0.1
  return findRows_('EQUIPMENT_MAINTENANCE_LOG', function (r) { return r.equipment_id === equipmentId; })
    .sort(function (a, b) { return new Date(b.дата) - new Date(a.дата); });
}
