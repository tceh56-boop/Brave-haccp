// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Users.gs (v2)
 * Пользователи и их роли/точки. Права по ролям проверяются в API.gs (CONFIG.ROLE_MODULES) —
 * этот файл только хранит и читает пользователей, ничего не решает про доступ сам.
 *
 * v2: добавлена проверка уникальности PIN В ПРЕДЕЛАХ ОРГАНИЗАЦИИ (раньше её не было вообще —
 * два сотрудника одной организации могли получить одинаковый PIN, и "слепой" вход по PIN
 * без userId получил бы случайного из них). Также добавлены смена/сброс PIN и
 * деактивация/активация — раньше в файле не было ни одной из этих операций.
 */

/**
 * Внешний P0-аудит, п.3 (продолжение, раунд 12) — НАЙДЕНО ПРИ СИСТЕМАТИЧЕСКОМ ПРОХОДЕ:
 * location_ids никогда не проверялись на принадлежность organization_id этого же
 * пользователя. Директор организации А (единственная роль, которой выдан модуль 'users' —
 * см. ROLE_MODULES) мог создать сотрудника с location_ids, указывающими на точку СОВСЕМ
 * ДРУГОЙ организации Б (опечатка в ID, скопированный ID из другого места интерфейса, или
 * намеренно). Это ХУЖЕ горизонтального доступа между точками ОДНОЙ организации (см. выше
 * assertLocationAllowed_) — это утечка МЕЖДУ организациями (тот же класс риска, что и
 * P0.4 из документа аудита), потому что assertLocationAllowed_/resolveLocationScope_
 * проверяют только "входит ли locationId в session.allowed_locations" — они ОПИРАЮТСЯ на
 * гарантию, что allowed_locations были правильно проверены при создании пользователя, а
 * эта гарантия и была тем единственным местом, где проверки не было вообще.
 */
function createUser_(data) {
  if (!data.organization_id) throw new Error('createUser_: organization_id обязателен.');
  if (CONFIG.ROLE_LIST.indexOf(data.роль) === -1) {
    throw new Error('createUser_: неизвестная роль "' + data.роль + '".');
  }
  if (!data.pin || String(data.pin).length < CONFIG.PIN_MIN_LENGTH) {
    throw new Error('PIN должен быть не короче ' + CONFIG.PIN_MIN_LENGTH + ' цифр.');
  }
  var locationIds = data.location_ids || [];
  locationIds.forEach(function (locId) {
    var loc = findOne_('LOCATIONS', 'location_id', locId);
    if (!loc || loc.organization_id !== data.organization_id) {
      throw new Error('FORBIDDEN_SCOPE: точка "' + locId + '" не принадлежит вашей организации — сотрудник не создан.');
    }
  });
  _assertPinUnique_(data.organization_id, data.pin, null);
  // Внешний P0-аудит, п.2 (продолжение раунда 12, по решению Дениса "добавить соль") —
  // каждый НОВЫЙ пользователь сразу получает индивидуальную соль (см. hashPin_ ниже).
  var pinSalt = Utilities.getUuid();
  var user = {
    user_id: generateId_('USERS'),
    organization_id: data.organization_id,
    location_ids: locationIds.join(','),
    имя: data.имя || '',
    email: data.email || '',
    телефон: data.телефон || '',
    роль: data.роль,
    position_id: data.position_id || '',
    workshop_id: data.workshop_id || '',
    job_type: data.job_type || '',
    equipment_ids: data.equipment_ids ? (Array.isArray(data.equipment_ids) ? data.equipment_ids.join(',') : String(data.equipment_ids)) : '',
    статус: 'активен',
    pin_hash: hashPin_(data.pin, pinSalt),
    pin_salt: pinSalt,
    failed_attempts: 0,
    locked_until: 0,
    lockout_count: 0,
    last_login: '',
    создано: nowIso_()
  };
  insertRow_('USERS', user);
  if (data.session) {
    _emitEmployeeProfileEvent_('EMPLOYEE_CREATED', user, data.session);
    if (typeof syncEmployeeSafetyRequirements_ === 'function') { var safetySession = {}; Object.keys(data.session).forEach(function(k){ safetySession[k]=data.session[k]; }); safetySession.location_id = String(user.location_ids||'').split(',').filter(Boolean)[0] || data.session.location_id || ''; safetySession.allowed_locations = String(user.location_ids||'').split(',').filter(Boolean); syncEmployeeSafetyRequirements_(user.user_id, safetySession, {reason:'EMPLOYEE_CREATED'}); }
  }
  auditLog_(data.actorUserId, 'Создан сотрудник', 'USERS:' + user.user_id, null, user.имя + ' (' + user.роль + ')', 'success');
  return user;
}

/**
 * Бросает исключение, если этот PIN (в открытом виде — сравнение теперь делается ПО
 * КАЖДОМУ существующему сотруднику с ЕГО СОБСТВЕННОЙ солью, см. hashPin_) уже занят
 * активным сотрудником той же организации.
 *
 * Внешний P0-аудит, п.2 (продолжение раунда 12) — раньше сравнивались готовые ХЭШИ
 * напрямую (`r.pin_hash === pinHash`), что работало, только пока ВСЕ хэши считались
 * одной и той же (несолёной) схемой. С индивидуальной солью на пользователя два разных
 * человека с ОДИНАКОВЫМ PIN теперь дают РАЗНЫЕ хэши — сравнение хэш-строк перестало бы
 * находить настоящие совпадения. Поэтому здесь пересчитываем хэш кандидата ОТДЕЛЬНО для
 * каждого существующего сотрудника, с ЕГО солью (или без соли — для старых, ещё не
 * получивших pin_salt), и сравниваем результат с его же pin_hash.
 */
function _assertPinUnique_(organizationId, candidatePin, excludeUserId) {
  var clash = findRows_('USERS', function (r) {
    if (r.organization_id !== organizationId || r.статус !== 'активен' || r.user_id === excludeUserId) return false;
    return hashPin_(candidatePin, r.pin_salt) === r.pin_hash;
  })[0];
  if (clash) {
    throw new Error('Этот PIN уже используется другим сотрудником организации. Выберите другой.');
  }
}

/**
 * Внешний P0-аудит, п.2 (продолжение раунда 12, по решению Дениса) — добавлена
 * ИНДИВИДУАЛЬНАЯ СОЛЬ на пользователя. Раньше `hashPin_(pin)` был простым
 * SHA-256(PIN) БЕЗ соли — одинаковый PIN у РАЗНЫХ пользователей (возможно в разных
 * организациях — уникальность PIN проверяется только В ПРЕДЕЛАХ одной организации)
 * давал ИДЕНТИЧНЫЙ хэш. При гипотетической утечке содержимого листа USERS (не через
 * API — например, прямым доступом к самой таблице) один заранее посчитанный список
 * хэшей всех 10 000 четырёхзначных комбинаций (доли секунды) вскрыл бы ВСЕ PIN сразу.
 * С солью на пользователя такая заранее посчитанная таблица бесполезна — переборщик
 * вынужден пересчитывать хэши заново для КАЖДОГО пользователя отдельно (всё ещё быстро
 * при всего 10 000 комбинаций и 4-значном PIN, но это отдельный, обсуждённый с Денисом
 * компромисс — длину PIN он попросил не менять).
 *
 * ОБРАТНАЯ СОВМЕСТИМОСТЬ (решение Дениса — "старые PIN работают как раньше, без
 * принудительного сброса"): `salt` не передан/пуст → `(salt ? salt : '') + pin` даёт
 * ПРОСТО `pin` — ТОТ ЖЕ вход, что и в старой несолёной схеме, так что уже существующие
 * пользователи (у которых `pin_salt` пуст, потому что созданы ДО этого раунда) продолжают
 * логиниться без каких-либо действий с их стороны. Соль появляется у учётки при
 * следующей смене/сбросе PIN (changePin_/resetPin_) или у новых сотрудников (createUser_)
 * — то есть защита нарастает естественным образом, а не разом.
 */
function hashPin_(pin, salt) {
  var input = (salt ? salt : '') + String(pin);
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input);
  return digest.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function getUsers_(organizationId) {
  return findRows_('USERS', function (r) {
    return (!organizationId || r.organization_id === organizationId) && r.статус !== 'удалён';
  });
}

function getUserById_(userId) {
  return findOne_('USERS', 'user_id', userId);
}

/** Пользователь (или админ) меняет свой/чужой PIN — всегда с проверкой уникальности по организации. */
function changePin_(actorSession, targetUserId, newPin) {
  var target = getUserById_(targetUserId);
  assertOwnedByOrg_(actorSession, target, 'USERS:' + targetUserId); // ТЗ P0.1 — нельзя менять PIN сотруднику чужой организации
  var isSelf = actorSession.user_id === targetUserId;
  if (!isSelf && actorSession.роль !== 'ADMIN' && actorSession.роль !== 'ДИРЕКТОР') {
    throw new Error('Менять PIN другому сотруднику может только администратор.');
  }
  if (!newPin || String(newPin).length < CONFIG.PIN_MIN_LENGTH) {
    throw new Error('PIN должен быть не короче ' + CONFIG.PIN_MIN_LENGTH + ' цифр.');
  }
  _assertPinUnique_(target.organization_id, newPin, target.user_id);
  // Смена/сброс PIN — момент, когда старая (возможно, ещё несолёная) учётка получает
  // свежую индивидуальную соль, см. hashPin_.
  var pinSalt = Utilities.getUuid();
  updateRow_('USERS', target, { pin_hash: hashPin_(newPin, pinSalt), pin_salt: pinSalt, failed_attempts: 0, locked_until: 0, lockout_count: 0 });
  auditLog_(actorSession.user_id, isSelf ? 'Смена своего PIN' : 'Сброс PIN сотруднику', 'USERS:' + target.user_id, null, null, 'success');
  return { изменено: true };
}

/** Админ принудительно сбрасывает PIN и снимает блокировку (сотрудник забыл PIN). */
function resetPin_(actorSession, targetUserId, newPin) {
  if (actorSession.роль !== 'ADMIN' && actorSession.роль !== 'ДИРЕКТОР') {
    throw new Error('Сброс PIN доступен только администратору.');
  }
  return changePin_(actorSession, targetUserId, newPin);
}

function deactivateUser_(actorSession, targetUserId) {
  var target = getUserById_(targetUserId);
  assertOwnedByOrg_(actorSession, target, 'USERS:' + targetUserId); // ТЗ P0.1
  updateRow_('USERS', target, { статус: 'отключён' });
  auditLog_(actorSession.user_id, 'Отключён сотрудник', 'USERS:' + target.user_id, 'активен', 'отключён', 'success');
  return { статус: 'отключён' };
}

function activateUser_(actorSession, targetUserId) {
  var target = getUserById_(targetUserId);
  assertOwnedByOrg_(actorSession, target, 'USERS:' + targetUserId); // ТЗ P0.1
  updateRow_('USERS', target, { статус: 'активен', failed_attempts: 0, locked_until: 0, lockout_count: 0 });
  auditLog_(actorSession.user_id, 'Включён сотрудник', 'USERS:' + target.user_id, 'отключён', 'активен', 'success');
  return { статус: 'активен' };
}

/** Проверка: разрешён ли пользователю данный модуль (ТЗ §16/§18 — серверная проверка прав). */
function userCanAccessModule_(user, moduleName) {
  if (!user) return false;
  var allowed = CONFIG.ROLE_MODULES[user.роль];
  if (allowed === 'all') return true;
  if (!allowed) return false; // fail-closed: роль без записи в ROLE_MODULES не проходит никуда
  return allowed.indexOf(moduleName) !== -1;
}

/** Точечная проверка действия: модуль даёт базовый доступ, ROLE_ACTION_DENY
 * может отнять конкретную операцию. Это позволяет ПОВАРУ/КЛАДОВЩИКУ читать
 * ТТК и Food Cost без права менять рецептуры и версии ТТК. */
function userCanAccessAction_(user, action, moduleName) {
  if (!user || !userCanAccessModule_(user, moduleName)) return false;
  var deny = CONFIG.ROLE_ACTION_DENY && CONFIG.ROLE_ACTION_DENY[user.роль];
  return !(deny && deny.indexOf(action) !== -1);
}
