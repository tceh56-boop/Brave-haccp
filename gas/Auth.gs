// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Auth.gs (v2, ТЗ §1/§4/§18 — "ОШИБКА №1")
 * PIN-логин (паттерн Mon Cher Auth-модуля). Возвращает сессионный токен, который
 * фронтенд обязан слать на КАЖДЫЙ следующий вызов — серверная проверка прав в API.gs
 * идёт по этому токену и по тому, что ЛЕЖИТ В СЕССИИ НА СЕРВЕРЕ, а не по полям "роль"/
 * "organization_id"/"location_id", присланным клиентом (ТЗ §1 п.2 — клиенту нельзя верить).
 *
 * v2: исправлена ОШИБКА №1 — сессия раньше не содержала location_id вообще, из-за чего
 * весь фронтенд (Index.html) читал SESSION.locationId, которого сервер никогда не выдавал.
 * Теперь: после проверки PIN сервер сам разрешает точку(-и) пользователя:
 *   - 0 точек назначено  → отказ входа с понятной причиной (не "тихий" NULL);
 *   - 1 точка             → выбирается автоматически;
 *   - >1 точка            → сессия выдаётся БЕЗ location_id, статус requires_location = true,
 *                           фронтенд обязан вызвать SELECT_LOCATION до любых прочих действий.
 * processOperation() (API.gs) сам не пускает ни одно действие, кроме небольшого белого
 * списка, пока location_id в серверной сессии не проставлен — так что "просто скрыть
 * экран выбора точки" на фронтенде ничего не даёт (ТЗ §60).
 *
 * v2: добавлена блокировка по PIN (ТЗ §4 п. "защита от подбора"): CONFIG.PIN_MAX_ATTEMPTS
 * неверных попыток подряд → блокировка на CONFIG.PIN_LOCKOUT_MS. Блокировка привязана к
 * КОНКРЕТНОМУ пользователю, поэтому предпочтительный сценарий фронтенда — сначала выбрать
 * сотрудника из списка (GET_USERS_FOR_LOGIN), потом ввести его PIN (loginWithPin_(pin, userId)).
 * Старый режим "слепого" PIN без userId сохранён для совместимости, но у него ЕСТЬ
 * ограничение, честно описанное ниже в loginWithPinBlind_.
 */

function loginWithPin_(pin, userId) {
  if (!pin || String(pin).length < CONFIG.PIN_MIN_LENGTH) {
    throw new Error('PIN слишком короткий.');
  }
  var user = userId ? getUserById_(userId) : null;
  if (userId && !user) {
    throw new Error('Пользователь не найден.');
  }
  return user ? _loginAgainstUser_(user, pin) : loginWithPinBlind_(pin);
}

/**
 * Основной (рекомендуемый) путь: сотрудник уже выбран из списка (GET_USERS_FOR_LOGIN),
 * поэтому блокировку/счётчик попыток можно вести именно по нему.
 */
function _loginAgainstUser_(user, pin) {
  if (user.статус !== 'активен') {
    throw new Error('Учётная запись отключена. Обратитесь к администратору.');
  }
  var lockedUntil = Number(user.locked_until) || 0;
  if (lockedUntil > Date.now()) {
    var minsLeft = Math.ceil((lockedUntil - Date.now()) / 60000);
    throw new Error('PIN временно заблокирован после нескольких неверных попыток. Повторите через ' + minsLeft + ' мин.');
  }
  // Внешний P0-аудит, п.2 (продолжение раунда 12, по решению Дениса) — соль на пользователя
  // (Users.gs::hashPin_); у старых учёток pin_salt пуст, hashPin_(pin, '') === hashPin_(pin)
  // старой несолёной схемы, так что уже существующие PIN проверяются без изменений.
  if (hashPin_(pin, user.pin_salt) !== user.pin_hash) {
    var attempts = (Number(user.failed_attempts) || 0) + 1;
    var patch = { failed_attempts: attempts };
    var msg;
    var lockedNow = attempts >= CONFIG.PIN_MAX_ATTEMPTS;
    if (lockedNow) {
      // Эскалация длительности блокировки (решение Дениса) — 1-я блокировка подряд у этой
      // учётки: 15 мин; 2-я подряд (без успешного входа между ними): 1 час; 3-я и далее: 4
      // часа. lockout_count сбрасывается в 0 при успешном входе или вмешательстве
      // администратора (changePin_/resetPin_/activateUser_) — эскалация копится только при
      // непрерывном переборе одной и той же учётки.
      var ladder = CONFIG.PIN_LOCKOUT_LADDER_MS;
      var tier = Math.min(Number(user.lockout_count) || 0, ladder.length - 1);
      var lockoutMs = ladder[tier];
      patch.locked_until = Date.now() + lockoutMs;
      patch.failed_attempts = 0;
      patch.lockout_count = (Number(user.lockout_count) || 0) + 1;
      msg = 'Неверный PIN. Превышено число попыток — учётная запись заблокирована на ' + Math.round(lockoutMs / 60000) + ' мин.';
    } else {
      msg = 'Неверный PIN. Осталось попыток: ' + (CONFIG.PIN_MAX_ATTEMPTS - attempts) + '.';
    }
    updateRow_('USERS', user, patch);
    // Внешний P0-аудит, п.2 (продолжение раунда 12) — НАЙДЕНО: неудачные попытки входа и
    // блокировки нигде не попадали в AUDIT_LOG — администратор мог видеть РЕЗУЛЬТАТ
    // (заблокированный сотрудник жалуется, что не может войти), но не сам факт и историю
    // подбора PIN против конкретной учётной записи. Добавлено — не влияет на логику входа.
    auditLog_(user.user_id, lockedNow ? 'Учётная запись заблокирована (перебор PIN)' : 'Неудачная попытка входа (неверный PIN)', 'USERS:' + user.user_id, null, 'попытка ' + attempts, 'forbidden');
    throw new Error(msg);
  }
  if (Number(user.failed_attempts) || Number(user.locked_until) || Number(user.lockout_count)) {
    updateRow_('USERS', user, { failed_attempts: 0, locked_until: 0, lockout_count: 0 });
  }
  updateRow_('USERS', user, { last_login: nowIso_() });
  return _buildSession_(user);
}

/**
 * Совместимость со старым фронтендом, который присылает только PIN без userId.
 * ЧЕСТНОЕ ограничение (см. TSEKH_v2_CHANGELOG.md): без выбора сотрудника система не
 * знает, КОМУ засчитать неверную попытку, поэтому здесь НЕТ персональной блокировки —
 * есть только глобальный анти-брутфорс по самому значению PIN (грубее, но не пускает
 * автоматический перебор). Рекомендуемый путь — loginWithPin_(pin, userId).
 *
 * Внешний P0-аудит, п.2 (продолжение раунда 12) — НАЙДЕНО, СЕРЬЁЗНЕЕ, ЧЕМ ОПИСАНО ВЫШЕ:
 * PIN уникален только В ПРЕДЕЛАХ организации (_assertPinUnique_ фильтрует по
 * organization_id) — это осознанное, задокументированное ограничение. Но
 * `findRows_('USERS', r => r.pin_hash === pinHash && активен)[0]` искал совпадение
 * СОВСЕМ БЕЗ фильтра по организации — то есть если сотрудники ДВУХ РАЗНЫХ организаций
 * выбрали один и тот же 4-значный PIN (при 10 000 комбинаций — реалистичный сценарий
 * при большом числе клиентов системы), слепой вход по одному только PIN мог залогинить
 * человека В ЧУЖУЮ ОРГАНИЗАЦИЮ, под случайно совпавшим сотрудником — не "путаница
 * внутри одной организации", а полноценная утечка между тенантами, доступная просто
 * подбором популярных PIN ("1234", "0000" и т.п.) БЕЗ знания какого-либо userId или
 * organization_id жертвы. Закрыто: при НЕСКОЛЬКИХ совпадениях (хэш встречается больше
 * чем у одного активного сотрудника где бы то ни было в системе) слепой вход честно
 * отказывает, а не выбирает "случайного" — неоднозначный вход ДОЛЖЕН быть отклонён, а
 * не разрешён наугад (тот же принцип, что и для email/username enumeration в целом).
 * Отдельно добавлено журналирование неудачных попыток (auditLog_) — раньше промахи PIN
 * (и в этой функции, и в _loginAgainstUser_ выше) НИГДЕ не попадали в AUDIT_LOG, то есть
 * администратор не мог увидеть в системе сам факт идущего перебора PIN против его
 * организации — только результат (блокировку), без видимой истории попыток.
 *
 * Внешний P0-аудит, п.2 (продолжение раунда 12, по решению Дениса "добавить соль") —
 * с индивидуальной солью на пользователя сравнение больше НЕ может быть "посчитать один
 * хэш введённого PIN и найти строку с таким же pin_hash" (у разных пользователей разная
 * соль → разные хэши для одного и того же PIN). Поэтому совпадение теперь ищется
 * пересчётом хэша ОТДЕЛЬНО для каждого активного пользователя, с ЕГО солью (пустая соль
 * у старых учёток — та же старая несолёная схема, см. hashPin_). throttleKey (анти-
 * брутфорс по значению PIN, а не по учётке) по-прежнему считается БЕЗ соли — это не
 * сверка с хранимым хэшем, а просто внутренний ключ группировки одинаковых попыток.
 */
function loginWithPinBlind_(pin) {
  var throttleKey = 'pin_blind_fail_' + hashPin_(pin);
  var cache = CacheService.getScriptCache();
  if (Number(cache.get(throttleKey) || 0) >= CONFIG.PIN_MAX_ATTEMPTS) {
    throw new Error('Слишком много неверных попыток с этим PIN. Повторите позже.');
  }
  var matches = findRows_('USERS', function (r) {
    return r.статус === 'активен' && hashPin_(pin, r.pin_salt) === r.pin_hash;
  });
  if (matches.length > 1) {
    // НЕ инкрементируем throttleKey как обычную "неудачную попытку" — это не угадывание
    // (хэш совпал), а системная неоднозначность между организациями. Тем не менее вход
    // отклоняется безусловно: у слепого режима физически нет способа понять, КОГО
    // именно имел в виду вошедший, а разрешать наугад — это и есть дыра.
    auditLog_(null, 'Слепой вход отклонён (неоднозначный PIN между организациями)', 'AUTH:blind_login', null, String(matches.length) + ' совпадений', 'forbidden_scope');
    throw new Error('Не удаётся однозначно определить учётную запись по одному PIN. Войдите, выбрав себя из списка сотрудников.');
  }
  var user = matches[0];
  if (!user) {
    var fails = Number(cache.get(throttleKey) || 0) + 1;
    cache.put(throttleKey, String(fails), CONFIG.PIN_LOCKOUT_MS / 1000);
    auditLog_(null, 'Неудачный слепой вход (PIN не найден)', 'AUTH:blind_login', null, null, 'forbidden');
    throw new Error('Неверный PIN.');
  }
  var lockedUntil = Number(user.locked_until) || 0;
  if (lockedUntil > Date.now()) {
    auditLog_(user.user_id, 'Слепой вход отклонён (учётная запись заблокирована)', 'USERS:' + user.user_id, null, null, 'forbidden');
    throw new Error('PIN временно заблокирован. Повторите позже.');
  }
  updateRow_('USERS', user, { last_login: nowIso_(), failed_attempts: 0, locked_until: 0, lockout_count: 0 });
  return _buildSession_(user);
}

/** Список активных сотрудников для экрана "выбери себя" (без PIN/pin_hash — не раскрываем). */
function getUsersForLogin_(organizationId) {
  return getUsers_(organizationId)
    .filter(function (u) { return u.статус === 'активен'; })
    .map(function (u) { return { user_id: u.user_id, имя: u.имя, роль: u.роль, organization_id: u.organization_id }; });
}

/**
 * Внешний P0-аудит, п.1 — сессия раньше жила ТОЛЬКО в CacheService с TTL, равным
 * SESSION_TTL_MS (12 часов) — но реальный Apps Script CacheService.put() физически
 * не принимает expirationInSeconds больше 21600 (6 часов), бросает исключение. Это
 * означало, что КАЖДЫЙ вход в систему в реальной таблице падал бы с ошибкой прямо на
 * этой строке (см. tests/shim.js — теперь честно воспроизводит этот лимит платформы,
 * и без исправления ниже login() не проходит ни один тест).
 *
 * Исправление: CacheService остаётся быстрым кэшем (как и был), но настоящий срок
 * жизни сессии (до SESSION_TTL_MS) хранится в SESSIONS — обычном листе таблицы, той же
 * durable-опорой, что и всё остальное состояние системы (Database.gs). Кэш пишется с
 * TTL, ограниченным сверху CACHE_MAX_TTL_SECONDS: попадание в кэш — быстрый путь без
 * чтения листа; промах кэша (сессия "протухла" в CacheService, но ещё не истекла по
 * SESSIONS.expires) — резолвится из листа и кэш перезаполняется (см. resolveSession_
 * ниже). Так сессия реально доживает до 12 часов, а не до 6, оставаясь при этом
 * совместимой с ограничением платформы.
 */
function _sessionCacheTtlSeconds_(expiresAtMs) {
  var remainingSeconds = Math.ceil((expiresAtMs - Date.now()) / 1000);
  return Math.max(1, Math.min(CONFIG.CACHE_MAX_TTL_SECONDS, remainingSeconds));
}

function _putSessionCache_(session) {
  CacheService.getScriptCache().put('session_' + session.token, JSON.stringify(session), _sessionCacheTtlSeconds_(session.expires));
}

/**
 * Строит серверную сессию и разрешает location_id по правилам ТЗ §1 (см. заголовок файла).
 * Ничего из этого не присылается клиентом — все данные берутся из строки USERS.
 */
function _buildSession_(user) {
  var locIds = String(user.location_ids || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (locIds.length === 0) {
    throw new Error('Пользователю не назначена ни одна точка. Обратитесь к администратору.');
  }
  var allLocations = getLocations_(user.organization_id).filter(function (l) { return locIds.indexOf(l.location_id) !== -1; });
  var token = Utilities.getUuid();
  var session = {
    token: token,
    user_id: user.user_id,
    роль: user.роль,
    organization_id: user.organization_id,
    location_id: locIds.length === 1 ? locIds[0] : null,
    allowed_locations: locIds,
    expires: Date.now() + CONFIG.SESSION_TTL_MS
  };
  withLock_(function () {
    insertRow_('SESSIONS', {
      token: token, user_id: user.user_id, organization_id: user.organization_id,
      роль: user.роль, location_id: session.location_id || '',
      allowed_locations: locIds.join(','), expires: session.expires,
      revoked: false, created_at: nowIso_()
    });
  });
  _putSessionCache_(session);
  return _publicSession_(session, user, allLocations);
}

function _publicSession_(session, user, locations) {
  return {
    token: session.token,
    имя: user.имя,
    роль: session.роль,
    organization_id: session.organization_id,
    location_id: session.location_id,
    requires_location: !session.location_id,
    locations: (locations || getLocations_(session.organization_id).filter(function (l) { return session.allowed_locations.indexOf(l.location_id) !== -1; }))
      .map(function (l) { return { location_id: l.location_id, название: l.название }; })
  };
}

/**
 * Действие SELECT_LOCATION — фронтенд обязан вызвать это, когда requires_location=true,
 * ДО любого другого действия. Сервер сам проверяет, что locationId входит в allowed_locations
 * сессии (клиент не может подставить чужую точку).
 */
function selectLocation_(session, locationId) {
  if (session.allowed_locations.indexOf(locationId) === -1) {
    throw new Error('Эта точка не назначена вашей учётной записи.');
  }
  session.location_id = locationId;
  _putSessionCache_(session);
  // Durable SESSIONS-строка тоже обновляется — иначе промах кэша (см. resolveSession_)
  // восстановил бы сессию БЕЗ выбранной точки, теряя SELECT_LOCATION при "протухании"
  // быстрого кэша до истечения настоящего срока жизни сессии.
  var sessionRow = findOne_('SESSIONS', 'token', session.token);
  if (sessionRow) withLock_(function () { updateRow_('SESSIONS', sessionRow, { location_id: locationId }); });
  var user = getUserById_(session.user_id);
  return _publicSession_(session, user);
}

/** Возвращает текущую сессию клиенту (для восстановления после перезагрузки страницы). */
function getSessionInfo_(session) {
  var user = getUserById_(session.user_id);
  return _publicSession_(session, user);
}

function logout_(session) {
  CacheService.getScriptCache().remove('session_' + session.token);
  // Внешний P0-аудит, п.1/п.2 — logout теперь честно отзывает сессию НАДЁЖНО (в
  // SESSIONS), а не только удаляет её из быстрого кэша: раньше повторное появление
  // того же токена в кэше (например, если бы кто-то успел скопировать значение кэша
  // до logout) не было ничем ограничено на уровне хранения, кроме истечения TTL.
  var sessionRow = findOne_('SESSIONS', 'token', session.token);
  if (sessionRow) withLock_(function () { updateRow_('SESSIONS', sessionRow, { revoked: true }); });
  return { выход: true };
}

/**
 * Возвращает сессию или null. Никогда не доверяем данным, пришедшим только из браузера.
 *
 * Внешний P0-аудит, п.1 — быстрый путь (попадание в CacheService) остаётся, как и
 * раньше, без обращения к листу. Промах кэша (сессия "протухла" в CacheService из-за
 * платформенного лимита в 6 часов, но её настоящий срок жизни — до 12 часов, см.
 * _buildSession_) резолвится из SESSIONS: если строка найдена, не отозвана и ещё не
 * истекла по-настоящему — кэш ПЕРЕЗАПОЛНЯЕТСЯ (следующие запросы снова идут быстрым
 * путём), сессия восстанавливается как валидная. Отозванная (revoked, см. logout_)
 * или истёкшая по SESSIONS.expires сессия — невалидна независимо от кэша.
 */
function resolveSession_(token) {
  if (!token) return null;
  var raw = CacheService.getScriptCache().get('session_' + token);
  if (raw) {
    var cached = JSON.parse(raw);
    if (cached.expires < Date.now()) return null;
    return cached;
  }
  var row = findOne_('SESSIONS', 'token', token);
  if (!row) return null;
  if (row.revoked === true || row.revoked === 'TRUE') return null; // Sheets может отдать булево как строку
  var expires = Number(row.expires);
  if (!expires || expires < Date.now()) return null;
  var session = {
    token: row.token,
    user_id: row.user_id,
    роль: row.роль,
    organization_id: row.organization_id,
    location_id: row.location_id || null,
    allowed_locations: String(row.allowed_locations || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean),
    expires: expires
  };
  _putSessionCache_(session);
  return session;
}

/**
 * ЦЕХ — критическое исправление безопасности (ТЗ "P0.1": подмена ID в запросе).
 *
 * ПРОБЛЕМА, найденная аудитом: почти каждый обработчик, который принимает
 * СУЩЕСТВУЮЩИЙ объект по ID от клиента (productionId, workshopId, batchId,
 * requestId, inventoryId, eventId, definitionId, targetUserId и т.д.), находил
 * его функцией findOne_() по всей таблице ЦЕЛИКОМ — без проверки, что этот
 * объект вообще принадлежит организации/точке вошедшего пользователя. Сессия
 * (Auth.gs) была надёжной, RBAC по модулям (API.gs) была надёжной, но между
 * "у тебя есть право на это ДЕЙСТВИЕ" и "этот конкретный ОБЪЕКТ — твой" проверки
 * не было вообще. Итог: сотрудник организации А, отправив productionId/batchId/
 * requestId и т.п., принадлежащий организации Б (случайно узнанный или
 * подобранный), мог прочитать или изменить чужие данные.
 *
 * Ниже — единая точка проверки принадлежности объекта сессии. Используется
 * ВЕЗДЕ, где объект ищется по клиентскому ID перед изменением/использованием.
 * При нарушении: (1) пишет отказ в AUDIT_LOG с результатом 'forbidden_scope'
 * (тем же способом, что и отказ RBAC в API.gs), (2) бросает исключение с кодом
 * FORBIDDEN_SCOPE, который humanizeError_ (API.gs) показывает пользователю как
 * есть (сообщение уже по-русски).
 */
function _denyScope_(session, label, detail) {
  // P0.2: cascade_id (если операция уже начата — см. API.gs::processOperation) идёт и
  // сюда, чтобы попытка подмены ID тоже была видна одним фильтром по cascade_id этой
  // конкретной операции, а не только по результату 'forbidden_scope' отдельно.
  auditLog_(session ? session.user_id : null, 'Отказ FORBIDDEN_SCOPE', label || 'unknown', detail || null, null, 'forbidden_scope', session ? session.cascade_id : '');
  throw new Error('FORBIDDEN_SCOPE: объект вне вашей организации или точки. Действие отклонено и записано в аудит.');
}

/**
 * Проверка "объект принадлежит организации текущей сессии". Применяется к любой
 * сущности со своим полем organization_id (USERS, PRODUCTS, DISHES, SEMI_FINISHED,
 * JOURNAL_DEFINITIONS, PLAN_MENU_EVENTS, JOURNALS, AUTO_JOURNAL_PENDING, NOTIFICATIONS…).
 * Бросает, если entity отсутствует (не найден = для клиента неотличимо от чужого — не
 * раскрываем сам факт существования чужого объекта другой формулировкой ошибки) или
 * если organization_id не совпадает с сессией.
 */
function assertOwnedByOrg_(session, entity, label) {
  if (!entity) _denyScope_(session, label, 'not_found');
  if (entity.organization_id && entity.organization_id !== session.organization_id) {
    _denyScope_(session, label, entity.organization_id);
  }
  return entity;
}

/**
 * Проверка "объект принадлежит ТОЧКЕ текущей сессии". Применяется к сущностям, у которых
 * нет собственного organization_id, но есть location_id (BATCHES, PRODUCTION, WRITE_OFFS,
 * PURCHASE_REQUESTS, INVENTORIES, WORKSHOPS, EQUIPMENT) — поскольку location_id создаётся
 * только внутри createLocation_(session.organization_id), совпадение location_id уже
 * транзитивно гарантирует совпадение организации (id — глобально уникальный UUID-суффикс,
 * не переиспользуется между организациями).
 */
function assertOwnedByLocation_(session, entity, label) {
  if (!entity) _denyScope_(session, label, 'not_found');
  if (entity.location_id && entity.location_id !== session.location_id) {
    _denyScope_(session, label, entity.location_id);
  }
  return entity;
}

/**
 * Комбинированная проверка для сущностей с ОБОИМИ полями сразу (JOURNALS, AUTO_JOURNAL_PENDING,
 * PLAN_MENU_EVENTS, NOTIFICATIONS) — организация проверяется всегда, точка — только если у
 * записи она вообще проставлена (например, JOURNAL_DEFINITIONS с пустым location_id — это
 * намеренно "на все точки организации", а не "ничья", см. Journals.gs::getJournalDefinitions_).
 */
function assertOwnedByOrgAndLocation_(session, entity, label) {
  assertOwnedByOrg_(session, entity, label);
  if (entity.location_id && entity.location_id !== session.location_id) {
    _denyScope_(session, label, entity.location_id);
  }
  return entity;
}

/**
 * Внешний P0-аудит, п.3 — «горизонтальный доступ между точками ОДНОЙ организации».
 *
 * НАЙДЕНО: assertOwnedByOrg_/assertOwnedByLocation_ выше защищают от МЕЖ-организационной
 * утечки и от подмены session.location_id объектом чужой точки — но несколько действий
 * (GET_SALES, GET_PNL, GET_ABC_ANALYSIS, GET_CALCULATIONS_HISTORY, GET_EXPENSES и др.)
 * принимают НЕОБЯЗАТЕЛЬНЫЙ data.locationId от клиента как явное переопределение
 * session.location_id (идиома `data.locationId || session.location_id` в API.gs) — и
 * НИКАК не проверяли, что запрошенная точка вообще входит в session.allowed_locations
 * этого пользователя. Сотрудник, назначенный только на Точку 1 своей организации, мог
 * передать locationId Точки 2 (той же организации) и увидеть её продажи/P&L/расходы.
 *
 * assertLocationAllowed_ — единичная проверка (бросает FORBIDDEN_SCOPE, как и остальные
 * проверки выше). resolveLocationScope_ — готовая замена идиомы
 * `data.locationId || session.location_id`, которая теперь ВСЕГДА проверяет клиентский
 * locationId перед использованием.
 */
function assertLocationAllowed_(session, locationId, label) {
  if (!locationId) return;
  if (!session || session.allowed_locations.indexOf(locationId) === -1) {
    _denyScope_(session, label || 'LOCATION_SCOPE', locationId);
  }
  // RBAC v2: ПОВАР и КЛАДОВЩИК работают только в текущей выбранной точке.
  // Даже если в USERS.location_ids указано несколько точек, нельзя передать
  // чужую/соседнюю точку через data.locationId и обойти рабочий scope.
  var scope = CONFIG.ROLE_DATA_SCOPE && CONFIG.ROLE_DATA_SCOPE[session.роль];
  if (scope === 'LOCATION' && session.location_id && locationId !== session.location_id) {
    _denyScope_(session, label || 'ROLE_LOCATION_SCOPE', locationId);
  }
}

function resolveLocationScope_(session, locationId) {
  if (!locationId) return session.location_id;
  assertLocationAllowed_(session, locationId, 'LOCATION_SCOPE');
  return locationId;
}

/**
 * Внешний P0-аудит, п.3 (продолжение, раунд 12) — НАЙДЕНО ПРИ СИСТЕМАТИЧЕСКОМ ПРОХОДЕ:
 * ~12 действий (UPDATE_WORKSHOP, UPDATE_EQUIPMENT, UPDATE_JOURNAL_DEFINITION и другие)
 * передают клиентский объект data.patch напрямую в updateRow_() — а updateRow_
 * (Database.gs) применяет ЛЮБОЙ ключ patch, совпадающий с именем столбца схемы, без
 * какого-либо белого списка. Владение сущностью (assertOwnedByLocation_/assertOwnedByOrg_)
 * проверяется ОДИН РАЗ, ДО применения patch — но если сам patch содержит
 * organization_id/location_id, клиент, легитимно владеющий сущностью СЕЙЧАС, может
 * этим же запросом переподчинить её ЛЮБОЙ другой точке/организации, задним числом обходя
 * все проверки владения (следующий читатель этой сущности увидит её уже "своей").
 * Это отдельный класс риска ("mass assignment"), не тождественный горизонтальному
 * доступу между точками, но обнаруженный при том же системном проходе. Закрыт пока
 * только для сущностей, прямо затронутых в этом раунде (WORKSHOPS, EQUIPMENT,
 * JOURNAL_DEFINITIONS) — остальные ~9 действий с тем же паттерном НЕ проверены и НЕ
 * исправлены в этом раунде (см. честный список в CHANGELOG).
 */
function _stripProtectedFields_(patch, protectedFields) {
  var safe = {};
  for (var key in patch) {
    if (Object.prototype.hasOwnProperty.call(patch, key) && protectedFields.indexOf(key) === -1) {
      safe[key] = patch[key];
    }
  }
  return safe;
}
