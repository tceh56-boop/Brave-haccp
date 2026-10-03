// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Integrations.gs
 * Секондарные фичи, раунд 6 (после TASKS/EVENTS/Лаборатория v2/ППК/HACCP Engine, см.
 * TSEKH_v2_CHANGELOG.md разделы 27-31) — адаптерная архитектура для внешних систем
 * (iiko/r_keeper/1С, Архитектура v4 §3, §12 п.6).
 *
 * ГРАНИЦА, ЧЕСТНО: по прямому указанию архитектурного документа (и подтверждено
 * Денисом в раунде 1 — реальных кредов ни для одной из трёх систем сегодня нет) —
 * этот раунд строит ТОЛЬКО общий адаптерный интерфейс + честные заглушки. НИ ОДНА
 * функция здесь не делает реального сетевого запроса ни к iiko, ни к r_keeper, ни к
 * 1С — `UrlFetchApp` в этом файле не используется вообще. `pullIntegration_`/
 * `pushIntegration_`/`testIntegrationConnection_` всегда честно отвечают "реальное
 * подключение не реализовано" (и фиксируют это как ERROR — не как фальшивый успех
 * и не как демо-имитация со случайным результатом, см. ниже почему).
 *
 * ОТКЛОНЕНИЕ ОТ БУКВЫ АРХИТЕКТУРНОГО ДОКУМЕНТА — НАЙДЕНО И ИСПРАВЛЕНО ДО КОДА:
 * документ (§3) описывает три ОТДЕЛЬНЫХ файла-адаптера (`iikoIntegration.gs`,
 * `rKeeperIntegration.gs`, `oneCIntegration.gs`), каждый из которых должен
 * реализовывать функции с ОДИНАКОВЫМИ именами `pull_`/`push_`/`testConnection_`.
 * Это физически невозможно в Google Apps Script: весь проект — ОДНО общее
 * глобальное пространство имён функций (не модули с изоляцией, как в Node/ES-
 * модулях) — именно поэтому в конце каждого раунда этого проекта прогоняется
 * отдельная проверка "0 дублирующихся имён функций во ВСЕХ .gs-файлах разом" (см.
 * CHANGELOG, ритуал верификации). Три файла с функцией `pull_` в каждом означали бы,
 * что последний загруженный файл молча подменяет функции двух предыдущих — не
 * ошибка компиляции, а тихо неверное поведение в рантайме. Вместо трёх файлов с
 * одинаковыми именами — ОДИН файл с функциями, параметризованными по `system`
 * (`pullIntegration_(integrationId, ...)`, читает `system` из самой строки
 * `INTEGRATIONS`) — тот же контракт по СМЫСЛУ (один пул/пуш/тест на систему), без
 * коллизии имён. Разделение на отдельные файлы будет иметь смысл, когда у каждого
 * адаптера появится РЕАЛЬНАЯ, различающаяся логика (разный формат API у каждой
 * системы) — сегодня все три ведут себя одинаково (честно ничего не делают), и
 * растаскивать идентичный код по трём файлам заранее значило бы копировать
 * заглушку три раза без всякой пользы.
 *
 * settings_json хранит НАСТРОЙКИ подключения (сегодня — практически только url,
 * как и в demo.html: "не становится «Подключено», пока не введён реальный URL").
 *
 * РАУНД 11, ПРОДОЛЖЕНИЕ («Доделай оставшиеся 4 пункта») — apiLogin (секретный
 * ключ iikoCloud API) БОЛЬШЕ НЕ хранится открытым текстом. Честно, ЧЕСТНО О
 * ГРАНИЦАХ ЭТОГО РЕШЕНИЯ (не преподносится как настоящий секретный сейф):
 *   1. Хранение: apiLogin шифруется потоковым шифром на основе HMAC-SHA256
 *      (см. _encryptSecret_/_decryptSecret_ ниже) ключом, который скрипт сам
 *      генерирует один раз (Script Properties, INTEGRATIONS_SECRET_KEY) и
 *      хранит ВНЕ листа Google Таблицы. Это НЕ аудированная библиотека
 *      шифрования (в Apps Script её просто нет — только односторонний HMAC/
 *      digest) — это обфускация «лучше, чем открытый текст», а не гарантия
 *      уровня банковского сейфа. Тот, кто получит доступ и к листу settings_json,
 *      И к Script Properties проекта (то есть, по сути, к самому Apps Script
 *      проекту как редактор), всё ещё сможет расшифровать значение — эта схема
 *      защищает от чтения ячейки таблицы теми, у кого есть доступ ТОЛЬКО к
 *      таблице-БД (например, через «Поделиться» листом), а не от того, у кого
 *      есть права редактора самого скрипта.
 *   2. Передача клиенту: settings_json в ответе GET_INTEGRATIONS больше НЕ
 *      содержит ни apiLogin, ни apiLogin_enc вообще — см. _maskIntegrationForClient_
 *      в API.gs. Клиент видит только булево apiLoginConfigured. Это отдельная,
 *      более сильная защита, чем шифрование на месте: секрет физически не
 *      покидает сервер после сохранения (форма — write-only: ввёл → сохранил →
 *      поле показывает "настроено", не значение).
 * Тот же архитектурный компромисс исторически применялся к URL адресам (не
 * секретным) — они по-прежнему хранятся открытым текстом, это осознанно (URL
 * подключения не является секретом сам по себе).
 */

// Ровно 3 системы, названные в Архитектуре v4 §3 — НЕ демо-набор из 6 (Контур.Маркет/
// Меркурий/Google Drive из demo.html не упомянуты в v4 §3 вообще, это отдельные,
// незапланированные в §12 пункты; Telegram — §4 того же документа, это ИНТЕРФЕЙС
// (webhook поверх processOperation()), не "интеграция" в смысле INTEGRATIONS).
var INTEGRATION_SYSTEMS = ['iiko', 'r_keeper', '1c'];

var INTEGRATION_STATUSES = ['SYNCING', 'SUCCESS', 'PARTIAL', 'ERROR', 'DISABLED', 'НЕ_НАСТРОЕНА'];
// auth_status — детализация, которой архитектурный документ не даёт явного словаря;
// разумное расширение того же принципа "честный дефолт", решено здесь.
var INTEGRATION_AUTH_STATUSES = ['НЕ_НАСТРОЕНО', 'НЕ_ПРОВЕРЕНО', 'ОШИБКА', 'ПОДТВЕРЖДЕНО'];

/**
 * Список интеграций организации. ПОБОЧНЫЙ ЭФФЕКТ, СОЗНАТЕЛЬНО: при первом вызове
 * для организации заводит по одной строке-заглушке НЕ_НАСТРОЕНА на каждую из 3
 * систем (idempotent — повторный вызов ничего не дублирует) — тот же UX-принцип,
 * что и в demo.html ("все системы видны сразу, честно со статусом «Отключено»"),
 * но не требует от клиента отдельного действия "зарегистрировать интеграцию" для
 * фиксированного, заранее известного списка систем. Решение сделать это внутри
 * GET, а не хуком в createOrganization_ — намеренное: не трогать P0-функцию,
 * которой пользуются вообще все тесты и вся остальная система, ради нового,
 * необязательного раунда.
 */
function getIntegrations_(organizationId) {
  var existing = findRows_('INTEGRATIONS', function (r) { return r.organization_id === organizationId; });
  var existingSystems = existing.map(function (r) { return r.system; });
  INTEGRATION_SYSTEMS.forEach(function (system) {
    if (existingSystems.indexOf(system) === -1) {
      var row = {
        integration_id: generateId_('INTEGRATIONS'),
        organization_id: organizationId,
        system: system,
        status: 'НЕ_НАСТРОЕНА',
        direction: 'pull',
        last_sync: '',
        next_sync: '',
        auth_status: 'НЕ_НАСТРОЕНО',
        error_count: 0,
        last_error: '',
        settings_json: '{}',
        created_at: nowIso_(),
        updated_at: nowIso_()
      };
      insertRow_('INTEGRATIONS', row);
      existing.push(row);
    }
  });
  return existing.sort(function (a, b) { return INTEGRATION_SYSTEMS.indexOf(a.system) - INTEGRATION_SYSTEMS.indexOf(b.system); });
}

// ---------- Шифрование секретов интеграций (apiLogin и т.п.) — см. докстринг выше ----------

var INTEGRATIONS_SECRET_KEY_PROP_ = 'INTEGRATIONS_SECRET_KEY';

/** Ключ шифрования — генерируется один раз при первом использовании, хранится в Script Properties (не в листе БД). */
function _integrationsSecretKey_() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty(INTEGRATIONS_SECRET_KEY_PROP_);
  if (!key) {
    key = Utilities.getUuid() + Utilities.getUuid(); // 72 симв. — с запасом энтропии для HMAC-ключа
    props.setProperty(INTEGRATIONS_SECRET_KEY_PROP_, key);
  }
  return key;
}

/** Один блок кейстрима (32 байта, длина дайджеста HMAC-SHA256) для позиции blockIndex. */
function _integrationsKeystreamBlock_(key, blockIndex) {
  return Utilities.computeHmacSha256Signature(String(blockIndex), key);
}

/**
 * XOR потокового шифра: побайтово XOR-ит bytes с кейстримом, полученным из
 * повторяющихся HMAC-SHA256(blockIndex, key) блоков по 32 байта. Симметрично —
 * тот же вызов и шифрует, и расшифровывает. `& 0xFF` на каждом байте — чтобы
 * не зависеть от того, знаковые (Java byte[]) или беззнаковые байты пришли
 * (реальный Apps Script и тестовый шим отдают их по-разному, см. tests/shim.js).
 */
function _integrationsXor_(bytes, key) {
  var out = [];
  var blockIndex = 0;
  var block = [];
  for (var i = 0; i < bytes.length; i++) {
    var pos = i % 32;
    if (pos === 0) { block = _integrationsKeystreamBlock_(key, blockIndex); blockIndex++; }
    out.push((bytes[i] & 0xFF) ^ (block[pos] & 0xFF));
  }
  return out;
}

/** Шифрует строку секрета → base64 для хранения в settings_json как apiLogin_enc. */
function _encryptSecret_(plaintext) {
  var key = _integrationsSecretKey_();
  var bytes = Utilities.newBlob(String(plaintext), 'text/plain').getBytes();
  return Utilities.base64Encode(_integrationsXor_(bytes, key));
}

/** Расшифровывает apiLogin_enc обратно в исходную строку секрета. */
function _decryptSecret_(ciphertextB64) {
  if (!ciphertextB64) return '';
  var key = _integrationsSecretKey_();
  var bytes = Utilities.base64Decode(ciphertextB64);
  return Utilities.newBlob(_integrationsXor_(bytes, key), 'text/plain').getDataAsString();
}

/**
 * Маскирует строку интеграции перед отправкой клиенту (GET_INTEGRATIONS) —
 * apiLogin_enc (и любой унаследованный незашифрованный apiLogin) НИКОГДА не
 * покидают сервер; клиент получает только булево apiLoginConfigured.
 */
function _maskIntegrationForClient_(row) {
  var masked = {};
  Object.keys(row).forEach(function (k) { masked[k] = row[k]; });
  var settings = {};
  try { settings = JSON.parse(row.settings_json || '{}'); } catch (e) { settings = {}; }
  var settingsOut = {};
  Object.keys(settings).forEach(function (k) { settingsOut[k] = settings[k]; });
  var hasSecret = !!settingsOut.apiLogin_enc || !!settingsOut.apiLogin;
  delete settingsOut.apiLogin_enc;
  delete settingsOut.apiLogin;
  settingsOut.apiLoginConfigured = hasSecret;
  masked.settings_json = JSON.stringify(settingsOut);
  return masked;
}

/**
 * Сохраняет настройки подключения (сегодня практически только `url`). Как и в
 * demo.html — статус honестно переходит из НЕ_НАСТРОЕНА в DISABLED, КОГДА появился
 * реальный url, а не автоматически в "подключено"/SUCCESS — включение синхронизации
 * (enableIntegration_) и реальная проверка (testIntegrationConnection_) остаются
 * ОТДЕЛЬНЫМИ, явными действиями администратора, не автоматическими последствиями
 * сохранения формы.
 */
function updateIntegrationSettings_(integrationId, settings, session) {
  return withLock_(function () {
    var row = findOne_('INTEGRATIONS', 'integration_id', integrationId);
    assertOwnedByOrg_(session, row, 'INTEGRATIONS:' + integrationId); // ТЗ P0.1
    var current = JSON.parse(row.settings_json || '{}');
    var merged = {};
    Object.keys(current).forEach(function (k) { merged[k] = current[k]; });
    Object.keys(settings || {}).forEach(function (k) { merged[k] = settings[k]; });

    // apiLogin — секрет, НИКОГДА не хранится открытым текстом (см. докстринг файла).
    // Пришло новое значение в этом вызове → шифруем и кладём как apiLogin_enc;
    // пришла пустая строка → это явная очистка сохранённого секрета; в любом
    // случае открытый ключ 'apiLogin' (в т.ч. унаследованный от сохранения ДО
    // этого изменения) никогда не остаётся в settings_json.
    if (Object.prototype.hasOwnProperty.call(settings || {}, 'apiLogin')) {
      var newSecret = String(settings.apiLogin || '').trim();
      if (newSecret) {
        merged.apiLogin_enc = _encryptSecret_(newSecret);
      } else {
        delete merged.apiLogin_enc;
      }
    }
    delete merged.apiLogin;

    var patch = { settings_json: JSON.stringify(merged), updated_at: nowIso_() };
    var hasUrl = !!(merged.url && String(merged.url).trim());
    if (hasUrl) {
      if (row.status === 'НЕ_НАСТРОЕНА') patch.status = 'DISABLED';
      // Настройки изменились — ЛЮБОЙ прежний auth_status (в т.ч. 'ОШИБКА' от
      // предыдущей проверки с другим/отсутствующим url, или даже 'ПОДТВЕРЖДЕНО')
      // считается устаревшим: адрес мог поменяться, старая проверка к нему уже не
      // относится. Не только "было НЕ_НАСТРОЕНО" — иначе правка URL после неудачной
      // проверки молча оставляла бы висеть старый статус 'ОШИБКА'.
      patch.auth_status = 'НЕ_ПРОВЕРЕНО';
    } else {
      patch.status = 'НЕ_НАСТРОЕНА';
      patch.auth_status = 'НЕ_НАСТРОЕНО';
    }
    updateRow_('INTEGRATIONS', row, patch);
    auditLog_(session.user_id, 'Изменены настройки интеграции', 'INTEGRATIONS:' + integrationId, row.status, patch.status || row.status, 'success', session.cascade_id);
    return findOne_('INTEGRATIONS', 'integration_id', integrationId);
  });
}

/** Включить синхронизацию — требует уже сохранённого url (нельзя включить пустую заглушку). */
function enableIntegration_(integrationId, session) {
  return withLock_(function () {
    var row = findOne_('INTEGRATIONS', 'integration_id', integrationId);
    assertOwnedByOrg_(session, row, 'INTEGRATIONS:' + integrationId); // ТЗ P0.1
    var settings = JSON.parse(row.settings_json || '{}');
    if (!settings.url) throw new Error('Нельзя включить интеграцию без указанного адреса подключения (url) — сначала UPDATE_INTEGRATION_SETTINGS.');
    if (row.status === 'НЕ_НАСТРОЕНА') throw new Error('Интеграция не настроена.');
    updateRow_('INTEGRATIONS', row, { status: 'DISABLED', updated_at: nowIso_() });
    // ЧЕСТНО: "включена" здесь означает лишь "снята с ручной блокировки" — статус
    // остаётся DISABLED до первого реального pullIntegration_/pushIntegration_
    // (которые сегодня всегда честно проваливаются, см. докстринг файла), НЕ
    // выдаётся заранее за SUCCESS/SYNCING.
    auditLog_(session.user_id, 'Интеграция включена (административно)', 'INTEGRATIONS:' + integrationId, null, null, 'success', session.cascade_id);
    return findOne_('INTEGRATIONS', 'integration_id', integrationId);
  });
}

function disableIntegration_(integrationId, session) {
  return withLock_(function () {
    var row = findOne_('INTEGRATIONS', 'integration_id', integrationId);
    assertOwnedByOrg_(session, row, 'INTEGRATIONS:' + integrationId); // ТЗ P0.1
    updateRow_('INTEGRATIONS', row, { status: 'DISABLED', updated_at: nowIso_() });
    auditLog_(session.user_id, 'Интеграция отключена', 'INTEGRATIONS:' + integrationId, row.status, 'DISABLED', 'success', session.cascade_id);
    return findOne_('INTEGRATIONS', 'integration_id', integrationId);
  });
}

/**
 * ЧЕСТНАЯ заглушка — НЕ имитация со случайным результатом (как demo.html делает для
 * визуального предпросмотра UI), а прямой правдивый ответ: реального подключения
 * нет. В отличие от demo (клиентский мокап, где случайный результат нужен только
 * чтобы показать, как БУДЕТ выглядеть экран), backend-функция, которая врёт про
 * успех, — это ровно то, что запрещает базовый принцип проекта "никогда не
 * подставлять неизмеренное значение как настоящее".
 */
function testIntegrationConnection_(integrationId, session) {
  return withLock_(function () {
    var row = findOne_('INTEGRATIONS', 'integration_id', integrationId);
    assertOwnedByOrg_(session, row, 'INTEGRATIONS:' + integrationId); // ТЗ P0.1
    var settings = JSON.parse(row.settings_json || '{}');
    var message;
    if (!settings.url) {
      message = 'Адрес подключения не указан.';
    } else {
      message = 'Реальное подключение к "' + row.system + '" не реализовано в этом раунде — нет учётных данных/API (Открытое решение D, Архитектура v4 §9). Заведён только контракт адаптера.';
    }
    updateRow_('INTEGRATIONS', row, { auth_status: 'ОШИБКА', last_error: message, updated_at: nowIso_() });
    auditLog_(session.user_id, 'Проверка соединения интеграции', 'INTEGRATIONS:' + integrationId, null, message, 'warning', session.cascade_id);
    return { success: false, message: message };
  });
}

/**
 * pull/push — та же честная заглушка, но обновляет ОСНОВНОЙ статус (не auth_status)
 * и error_count/last_sync, потому что это симулирует реальную попытку синхронизации
 * данных, а не просто проверку соединения. Что важно и специально сохранено на
 * будущее в докстринге: КОГДА появится реальный адаптер, он обязан писать
 * результат ТОЛЬКО через processOperation() с уже существующими действиями
 * (RECEIVE_GOODS и т.п.) — НЕ напрямую в БД — ровно как требует архитектурный
 * документ ("данные, пришедшие из iiko, проходят ту же валидацию и тот же каскад
 * пересчёта, что и ручной ввод"). Сегодня эта функция ничего не пишет ни туда, ни
 * сюда — потому и нечего проводить через processOperation().
 */
function pullIntegration_(integrationId, session) {
  return withLock_(function () {
    var row = findOne_('INTEGRATIONS', 'integration_id', integrationId);
    assertOwnedByOrg_(session, row, 'INTEGRATIONS:' + integrationId); // ТЗ P0.1
    var message = 'Реальный приём данных из "' + row.system + '" не реализован — нет учётных данных/API (Открытое решение D).';
    updateRow_('INTEGRATIONS', row, {
      status: 'ERROR', last_error: message, last_sync: nowIso_(),
      error_count: (Number(row.error_count) || 0) + 1, updated_at: nowIso_()
    });
    auditLog_(session.user_id, 'Попытка синхронизации (pull)', 'INTEGRATIONS:' + integrationId, null, message, 'warning', session.cascade_id);
    return { success: false, message: message };
  });
}

function pushIntegration_(integrationId, payload, session) {
  return withLock_(function () {
    var row = findOne_('INTEGRATIONS', 'integration_id', integrationId);
    assertOwnedByOrg_(session, row, 'INTEGRATIONS:' + integrationId); // ТЗ P0.1
    var message = 'Реальная отправка данных в "' + row.system + '" не реализована — нет учётных данных/API (Открытое решение D).';
    updateRow_('INTEGRATIONS', row, {
      status: 'ERROR', last_error: message, last_sync: nowIso_(),
      error_count: (Number(row.error_count) || 0) + 1, updated_at: nowIso_()
    });
    auditLog_(session.user_id, 'Попытка синхронизации (push)', 'INTEGRATIONS:' + integrationId, null, message, 'warning', session.cascade_id);
    return { success: false, message: message };
  });
}

// ---------- iiko — РЕАЛЬНАЯ синхронизация продаж (раунд 11) ----------

/**
 * Раунд 11, по прямому запросу Дениса ("Реализуй все три направления" → включая
 * "прямую интеграцию с API кассы"; на уточняющий вопрос, какая касса — ответ
 * "Айко и р кипер для двух"). Это ЕДИНСТВЕННАЯ функция в файле, которая делает
 * РЕАЛЬНЫЙ сетевой запрос (UrlFetchApp) — весь остальной файл, как и раньше,
 * честная заглушка (см. докстринг файла выше).
 *
 * ГРАНИЦА ЧЕСТНОСТИ — ФЛАГУЮ МАКСИМАЛЬНО ЯВНО, ПОВТОРЯЮ В CHANGELOG И В ОТЧЁТЕ ДЕНИСУ:
 * официальная документация iikoCloud API (api-ru.iiko.services) закрыта для
 * автоматического чтения (robots.txt блокирует доступ инструментов этой сессии).
 * Базовый URL и ПУТИ auth/organizations эндпоинтов подтверждены двумя независимыми
 * вторичными источниками (описание пакета на PyPI, обзор публичного репозитория на
 * GitHub), но точные имена JSON-полей запроса/ответа для endpoint'а отчёта о продажах
 * (OLAP-отчёт) НЕ подтверждены ни одним живым/авторитетным источником в этой сессии.
 * Реализация ниже — ЛУЧШАЯ ПОПЫТКА по общим знаниям об iikoCloud API, структурно
 * корректная (реальный HTTP-вызов, реальная обработка ошибок, реальный парсинг), но
 * НИ РАЗУ не проверенная против настоящего аккаунта/кредов iiko — тот же честный
 * паттерн, что и OcrYandex.gs (см. его докстринг). ПЕРЕД первым реальным
 * использованием эту функцию нужно прогнать на тестовом аккаунте Дениса и поправить
 * под фактический формат ответа — это НЕ сделано и не может быть сделано в этой сессии.
 *
 * ИДЕМПОТЕНТНОСТЬ, ЧЕСТНО: iikoCloud OLAP-отчёт агрегирует продажи (сумма/кол-во по
 * блюду за период), а не отдаёт отдельные заказы с уникальным ID — поэтому здесь
 * выбран дизайн "одна строка SALES на пару (день, блюдо) из iiko", внешний_id
 * строится как ключ "iiko:<iikoOrganizationId>:<дата>:<dishId>". Повторный синк того
 * же дня ОБНОВЛЯЕТ эту строку (upsertSaleFromExternal_), а не создаёт новую — так что
 * пересинк не удваивает выручку, но и не даёт честной информации об отдельных чеках
 * (её и не даёт сам агрегирующий отчёт).
 */
var IIKO_API_BASE = 'https://api-ru.iiko.services/api/1';

function _iikoAuth_(apiLogin) {
  var response = UrlFetchApp.fetch(IIKO_API_BASE + '/auth/access_token', {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ apiLogin: apiLogin }),
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Ошибка авторизации iiko (код ' + code + '): ' + response.getContentText().slice(0, 300));
  }
  var parsed = JSON.parse(response.getContentText());
  // НЕ ПОДТВЕРЖДЕНО ВЖИВУЮ: имя поля токена в ответе — лучшее предположение ("token").
  var token = parsed.token || parsed.accessToken || parsed.access_token;
  if (!token) throw new Error('Ошибка авторизации iiko: в ответе не найдено поле токена (ожидалось "token"). Формат ответа отличается от предполагаемого — нужна сверка с реальным API.');
  return token;
}

function _iikoOrganizationId_(token, cachedId) {
  if (cachedId) return cachedId;
  var response = UrlFetchApp.fetch(IIKO_API_BASE + '/organizations', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({}),
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Ошибка получения организаций iiko (код ' + code + '): ' + response.getContentText().slice(0, 300));
  }
  var parsed = JSON.parse(response.getContentText());
  var orgs = parsed.organizations || parsed.organizationIds || [];
  var first = orgs[0];
  var id = first && first.id ? first.id : first;
  if (!id) throw new Error('Ошибка получения организаций iiko: список организаций пуст или формат ответа отличается от предполагаемого.');
  return id;
}

/**
 * dateFrom/dateTo — 'YYYY-MM-DD'. Возвращает {синхронизировано, не_найдено_блюд, ошибки}.
 */
function syncIikoSales_(integrationId, dateFrom, dateTo, session) {
  return withLock_(function () {
    var row = findOne_('INTEGRATIONS', 'integration_id', integrationId);
    assertOwnedByOrg_(session, row, 'INTEGRATIONS:' + integrationId); // ТЗ P0.1
    if (row.system !== 'iiko') {
      throw new Error('Синхронизация продаж реализована только для системы "iiko" (для "' + row.system + '" — см. заглушку pullIntegration_, требуется установочная документация конкретной инсталляции).');
    }
    var settings = JSON.parse(row.settings_json || '{}');
    if (!settings.apiLogin_enc) {
      throw new Error('Синхронизация iiko не настроена: в настройках интеграции не указан apiLogin (UPDATE_INTEGRATION_SETTINGS с полем apiLogin — секретный ключ доступа к iikoCloud API).');
    }
    if (!dateFrom || !dateTo) throw new Error('Для синхронизации продаж iiko нужны dateFrom и dateTo.');

    var summary = { синхронизировано: 0, не_найдено_блюд: [], ошибки: [] };
    try {
      var apiLoginSecret = _decryptSecret_(settings.apiLogin_enc);
      var token = _iikoAuth_(apiLoginSecret);
      var iikoOrgId = _iikoOrganizationId_(token, settings.iikoOrganizationId);
      if (!settings.iikoOrganizationId) {
        var merged = {}; Object.keys(settings).forEach(function (k) { merged[k] = settings[k]; });
        merged.iikoOrganizationId = iikoOrgId;
        updateRow_('INTEGRATIONS', row, { settings_json: JSON.stringify(merged) });
      }

      // НЕ ПОДТВЕРЖДЕНО ВЖИВУЮ: путь/имена полей запроса OLAP-отчёта о продажах —
      // лучшее предположение по общей структуре iikoCloud Reports API.
      var response = UrlFetchApp.fetch(IIKO_API_BASE + '/reports/olap', {
        method: 'post', contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + token },
        payload: JSON.stringify({
          reportType: 'SALES',
          organizationIds: [iikoOrgId],
          groupByRowFields: ['OrderItem.DishName', 'OrderItem.DishId'],
          aggregateFields: ['DishAmountInt', 'DishSumInt'],
          filters: {
            'Date': { filterType: 'DateRange', periodType: 'CUSTOM', from: dateFrom, to: dateTo }
          }
        }),
        muteHttpExceptions: true
      });
      var code = response.getResponseCode();
      if (code < 200 || code >= 300) {
        throw new Error('Ошибка запроса отчёта о продажах iiko (код ' + code + '): ' + response.getContentText().slice(0, 300));
      }
      var parsed = JSON.parse(response.getContentText());
      var reportRows = parsed.data || parsed.rows || [];

      var dishes = getDishes_(row.organization_id).filter(function (d) { return d.статус !== 'архив'; });
      var byNormalizedName = {};
      dishes.forEach(function (d) { byNormalizedName[normalizeProductName_(d.название)] = d; });

      reportRows.forEach(function (r) {
        try {
          var dishName = r['OrderItem.DishName'] || r.DishName || '';
          var qty = Number(r['DishAmountInt'] || r.qty || 0);
          var sum = Number(r['DishSumInt'] || r.sum || 0);
          var dateOfRow = r['Date'] || dateFrom;
          var match = byNormalizedName[normalizeProductName_(dishName)];
          if (!match) { summary.не_найдено_блюд.push(dishName); return; }
          if (!qty || qty <= 0) return;
          upsertSaleFromExternal_({
            dishId: match.dish_id,
            qty: qty,
            цена_продажи: qty > 0 ? round2_(sum / qty) : 0,
            дата: String(dateOfRow).slice(0, 10),
            locationId: '', источник: 'iiko_синк',
            внешний_id: 'iiko:' + iikoOrgId + ':' + String(dateOfRow).slice(0, 10) + ':' + match.dish_id
          }, session.user_id, session);
          summary.синхронизировано++;
        } catch (rowErr) {
          summary.ошибки.push(String(rowErr.message || rowErr));
        }
      });

      updateRow_('INTEGRATIONS', row, { status: 'SUCCESS', last_sync: nowIso_(), last_error: '', updated_at: nowIso_() });
      auditLog_(session.user_id, 'Синхронизация продаж iiko', 'INTEGRATIONS:' + integrationId, null,
        'синхронизировано:' + summary.синхронизировано + ' не_найдено:' + summary.не_найдено_блюд.length, 'success', session.cascade_id);
      return summary;
    } catch (err) {
      var message = String(err.message || err);
      updateRow_('INTEGRATIONS', row, {
        status: 'ERROR', last_error: message, last_sync: nowIso_(),
        error_count: (Number(row.error_count) || 0) + 1, updated_at: nowIso_()
      });
      auditLog_(session.user_id, 'Синхронизация продаж iiko', 'INTEGRATIONS:' + integrationId, null, message, 'warning', session.cascade_id);
      throw new Error('Синхронизация iiko не удалась: ' + message + ' (НАПОМИНАНИЕ: точный формат iikoCloud API не подтверждён вживую в этой реализации — см. докстринг syncIikoSales_).');
    }
  });
}

// ---------- INTEGRATION_MAPPINGS — соответствие внешних/внутренних сущностей ----------

/**
 * internal_type/internal_id — та же мягкая типизация, что уже применена в проекте
 * (LabTests.gs::_assertLabTargetOwned_): владение проверяется только для известных
 * сегодня типов ('product' → PRODUCTS), остальные значения (например, будущие
 * 'dish') принимаются без проверки — расширяемо без изменения сигнатуры.
 */
function createIntegrationMapping_(params, session) {
  return withLock_(function () {
    var integration = findOne_('INTEGRATIONS', 'integration_id', params.integrationId);
    assertOwnedByOrg_(session, integration, 'INTEGRATIONS:' + params.integrationId); // ТЗ P0.1
    if (!params.externalId || !params.internalId) {
      throw new Error('externalId и internalId обязательны для соответствия интеграции.');
    }
    if (params.internalType === 'product') {
      assertOwnedByOrg_(session, getProductById_(params.internalId), 'PRODUCTS:' + params.internalId);
    }
    var mapping = {
      mapping_id: generateId_('INTEGRATION_MAPPINGS'),
      integration_id: params.integrationId,
      external_id: params.externalId,
      external_type: params.externalType || '',
      internal_type: params.internalType || '',
      internal_id: params.internalId
    };
    insertRow_('INTEGRATION_MAPPINGS', mapping);
    auditLog_(session.user_id, 'Создано соответствие интеграции', 'INTEGRATION_MAPPINGS:' + mapping.mapping_id, null,
      params.externalId + ' ↔ ' + params.internalId, 'success', session.cascade_id);
    return mapping;
  });
}

function getIntegrationMappings_(integrationId, session) {
  var integration = findOne_('INTEGRATIONS', 'integration_id', integrationId);
  assertOwnedByOrg_(session, integration, 'INTEGRATIONS:' + integrationId); // ТЗ P0.1
  return findRows_('INTEGRATION_MAPPINGS', function (r) { return r.integration_id === integrationId; });
}
