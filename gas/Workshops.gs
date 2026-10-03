// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Workshops.gs (v2, новый модуль — ТЗ §9/§10)
 * Цех — самостоятельная сущность МЕЖДУ точкой (LOCATION) и конкретной операцией
 * (партия/журнал/задача производства): "Организация → Точка → Цех". Раньше в системе
 * не было ни одной строки про цеха вообще — все операции знали только про location_id.
 * v2 добавляет workshop_id как необязательный, но сквозной признак у BATCHES/PRODUCTION/
 * JOURNALS/AUTO_JOURNAL_PENDING/EQUIPMENT (см. Config.gs) — им можно не пользоваться
 * (тогда всё работает как раньше, в разрезе одной точки), но если цеха заведены, каждая
 * операция может быть привязана к конкретному цеху.
 *
 * Цветовая маркировка (CONFIG.WORKSHOP_COLOR_PRESET) — это предустановка для удобства
 * (visual differentiation), а не универсальная законодательная норма СанПиН — организация
 * вправе перенастроить цвет под свои реальные внутренние правила (ТЗ §10).
 */

function createWorkshop_(data, actorUserId) {
  if (!data.location_id) throw new Error('createWorkshop_: location_id обязателен.');
  if (!data.название) throw new Error('createWorkshop_: название обязательно.');
  var type = CONFIG.WORKSHOP_TYPES.indexOf(data.тип) !== -1 ? data.тип : 'ДРУГОЙ';
  var workshop = {
    workshop_id: generateId_('WORKSHOPS'),
    location_id: data.location_id,
    название: data.название,
    тип: type,
    цвет: data.цвет || CONFIG.WORKSHOP_COLOR_PRESET[type] || '#8a7a6a',
    статус: 'активен',
    описание: data.описание || '',
    ответственный_id: data.ответственный_id || '',
    создано: nowIso_(),
    обновлено: nowIso_()
  };
  insertRow_('WORKSHOPS', workshop);
  auditLog_(actorUserId, 'Создан цех', 'WORKSHOPS:' + workshop.workshop_id, null, workshop.название, 'success');
  return workshop;
}

/**
 * Внешний P0-аудит, п.3 (продолжение, раунд 12) — НАЙДЕНО: patch применялся к updateRow_
 * без ограничения полей (см. _stripProtectedFields_ в Auth.gs). Владение цехом
 * проверяется ВЫШЕ, ДО применения patch — но patch.location_id, если бы он прошёл как
 * есть, позволил бы клиенту переподчинить СВОЙ (легитимно принадлежащий) цех ЛЮБОЙ другой
 * точке, в т.ч. чужой организации, одним запросом. Теперь location_id из клиентского
 * patch всегда игнорируется — переносить цех между точками эта операция не умеет и не
 * должна (для этого нет отдельного, явно проверяемого действия).
 */
function updateWorkshop_(workshopId, patch, session) {
  var workshop = findOne_('WORKSHOPS', 'workshop_id', workshopId);
  assertOwnedByLocation_(session, workshop, 'WORKSHOPS:' + workshopId); // ТЗ P0.1
  var safePatch = _stripProtectedFields_(patch, ['location_id', 'workshop_id']);
  safePatch.обновлено = nowIso_();
  updateRow_('WORKSHOPS', workshop, safePatch);
  auditLog_(session.user_id, 'Изменён цех', 'WORKSHOPS:' + workshopId, null, JSON.stringify(safePatch), 'success', session.cascade_id);
  return findOne_('WORKSHOPS', 'workshop_id', workshopId);
}

/** Цех не удаляется (история не должна теряться) — только архивируется (ТЗ §29/§48 — статус-архив, не delete). */
function archiveWorkshop_(workshopId, session) {
  return updateWorkshop_(workshopId, { статус: 'архив' }, session);
}

function getWorkshops_(locationId) {
  return findRows_('WORKSHOPS', function (r) {
    return (!locationId || r.location_id === locationId) && r.статус !== 'архив';
  });
}

function getWorkshopColorPreset_() {
  return { типы: CONFIG.WORKSHOP_TYPES, цвета: CONFIG.WORKSHOP_COLOR_PRESET };
}
