// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Organizations.gs
 * Организации и точки (ТЗ §17 — мультиорганизационная архитектура).
 * Все остальные модули фильтруют данные по organization_id/location_id,
 * которые отсюда и берутся — здесь не дублируется ничего специфичного для складов/ТТК.
 */

/**
 * Внешний P0-аудит, остаток P0.3 (раунд 12, систематический проход по CREATE_ORGANIZATION) —
 * НАЙДЕНО: ни createOrganization_, ни createLocation_ ни разу не вызывали auditLog_ — во
 * всём остальном проекте создание записи (сотрудник, продукт, рецепт и т.д.) всегда пишется
 * в историю, а тут нет. Для createLocation_ это несоответствие стиля; для createOrganization_
 * это хуже: это ЕДИНСТВЕННОЕ действие, создающее новых АРЕНДАТОРОВ платформы — и до этой
 * правки не было ни единой записи о том, кто и когда создал ту или иную организацию.
 * Добавлено actorUserId (необязателен — не ломает старые вызовы без сессии, например
 * прямой вызов из редактора Apps Script) и auditLog_ в обеих функциях.
 *
 * Это НЕ решает более крупный вопрос "кому вообще можно вызывать CREATE_ORGANIZATION"
 * (сейчас — любому ADMIN любой организации, см. Config.gs ROLE_MODULES и открытый вопрос
 * там же про CREATE_BACKUP/GET_BACKUPS) — это отдельное архитектурное решение, которое
 * должен принять Денис, а не тихо сузить здесь. Эта правка только устраняет то, что можно
 * исправить БЕЗ такого решения: полное отсутствие следа "кто создал организацию".
 */
function createOrganization_(data) {
  var org = {
    organization_id: generateId_('ORGANIZATIONS'),
    название: data.название || '',
    ИНН: data.ИНН || '',
    ОГРН: data.ОГРН || '',
    тип: data.тип || '',
    статус: 'активна',
    создано: nowIso_()
  };
  insertRow_('ORGANIZATIONS', org);
  auditLog_(data.actorUserId || null, 'Создана организация', 'ORGANIZATIONS:' + org.organization_id, null, org.название, 'success');
  return org;
}

function createLocation_(data) {
  if (!data.organization_id) throw new Error('createLocation_: organization_id обязателен.');
  var loc = {
    location_id: generateId_('LOCATIONS'),
    organization_id: data.organization_id,
    название: data.название || '',
    адрес: data.адрес || '',
    статус: 'активна',
    создано: nowIso_()
  };
  insertRow_('LOCATIONS', loc);
  auditLog_(data.actorUserId || null, 'Создана точка', 'LOCATIONS:' + loc.location_id, null, loc.название, 'success');
  return loc;
}

/**
 * ТЗ P0.1 — раньше не принимала organizationId вообще и отдавала ВСЕ организации
 * системы любому вызывающему. API.gs теперь всегда передаёт session.organization_id
 * (обычный пользователь не должен видеть чужие организации); organizationId оставлен
 * необязательным только для внутренних/скриптовых вызовов (например, из редактора
 * Apps Script напрямую), где полный список — осознанный выбор оператора, а не утечка.
 */
function getOrganizations_(organizationId) {
  return findRows_('ORGANIZATIONS', function (r) {
    return r.статус !== 'удалена' && (!organizationId || r.organization_id === organizationId);
  });
}

function getLocations_(organizationId) {
  return findRows_('LOCATIONS', function (r) {
    return (!organizationId || r.organization_id === organizationId) && r.статус !== 'удалена';
  });
}
