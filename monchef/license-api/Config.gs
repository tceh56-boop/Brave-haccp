/**
 * MonChef License API — настройки, заголовки таблиц, коды ошибок.
 *
 * Отдельный Apps Script-проект владельца MonChef. Не смешивать с клиентским проектом MonChef.
 * Все ID и служебные значения хранятся в Script Properties проекта API, а не в исходном коде.
 * Пароли, токены клиентов, ключи Yandex, резервные коды и email клиентов в коде не хранятся.
 */

/** Значения по умолчанию для Script Properties (пустое значение свойства = значение отсюда). */
var MC_CFG_DEFAULTS_ = {
  MC_LICENSE_REGISTRY_SHEET_ID: '',          // ID таблицы MONCHEF_LICENSE_REGISTRY — задаёт MC_setupLicenseRegistry()
  MC_LICENSE_SHEET_NAME: 'LICENSES',
  MC_DOCUMENTS_SHEET_NAME: 'DOCUMENTS',
  MC_API_AUDIT_SHEET_NAME: 'API_AUDIT',
  MC_REQUESTS_SHEET_NAME: 'REQUESTS',
  MC_INSTALLATIONS_SHEET_NAME: 'INSTALLATIONS',
  MC_ADMIN_LOG_SHEET_NAME: 'ADMIN_LOG',
  MC_NORMATIVE_ROOT_FOLDER_ID: '',           // закрытая папка нормативной базы — задаёт MC_setupLicenseRegistry()
  MC_API_VERSION: '1.0.0',
  MC_ADMIN_EMAIL: '',                        // адрес владельца для уведомлений; пусто — уведомления только в ADMIN_LOG
  MC_MAX_DOCUMENT_BYTES: '5242880',          // 5 МБ: больше — DOCUMENT_TOO_LARGE, Base64 не используется
  MC_HASH_ON_REQUEST_MAX_BYTES: '1048576',   // до 1 МБ хеш проверяется при каждой выдаче, больше — по кэшу и по расписанию
  MC_RATE_LIMIT_PER_LICENSE: '60',           // запросов в минуту на licenseId (все операции вместе)
  MC_RATE_LIMIT_CHECK_LICENSE: '',           // отдельные лимиты операций в минуту; пусто — только общий
  MC_RATE_LIMIT_GET_LIBRARY_VERSION: '',
  MC_RATE_LIMIT_LIST_DOCUMENTS: '',
  MC_RATE_LIMIT_GET_DOCUMENT: '20',
  MC_SPIKE_PER_HOUR: '1200',                 // «резкий рост запросов»: столько запросов за час — уведомление
  MC_ERRORS_PER_HOUR: '60',                  // «много ошибок»: столько отказов за час по лицензии — уведомление
  MC_BAD_TOKEN_THRESHOLD: '5',               // неверных ключей подряд (15 мин) — уведомление
  MC_NOTIFY_DEDUP_MINUTES: '360',            // одно и то же событие по одной лицензии — не чаще раза в 6 ч
  MC_NOTIFY_MAX_PER_HOUR: '20',              // всего писем в час
  MC_OFFLINE_GRACE_DAYS: '7',                // сообщается клиенту в CHECK_LICENSE; то же значение — в договоре
  MC_STRICT_AUTH_ERRORS: 'true',             // true: LICENSE_NOT_FOUND / CLIENT_MISMATCH / INVALID_TOKEN наружу как AUTH_FAILED
  MC_LICENSE_CACHE_SECONDS: '300',
  MC_LIBRARY_VERSION: '',                    // меняется автоматически при публикации/снятии документа
  MC_LIBRARY_PUBLISHED_AT: ''
};

/** Лист LICENSES. Колонка plan добавлена к ТЗ: тариф лицензии, сверяется с DOCUMENTS.allowedPlans. */
var MC_LICENSE_HEADERS_ = ['licenseId', 'clientId', 'customerName', 'customerEmail', 'clientTokenHash', 'status',
  'validFrom', 'validUntil', 'allowedModules', 'allowedDocuments', 'maxInstallations', 'currentInstallations',
  'lastSeenAt', 'lastSeenInstallationId', 'requestCount', 'notes', 'createdAt', 'updatedAt', 'plan'];

/** Лист DOCUMENTS. Колонка category добавлена к ТЗ: правовой статус материала (см. MC_DOC_CATEGORIES_). */
var MC_DOCUMENT_HEADERS_ = ['documentId', 'fileId', 'title', 'description', 'module', 'version', 'status', 'mimeType',
  'sha256', 'sizeBytes', 'allowedPlans', 'publishedAt', 'updatedAt', 'isOfficialSource', 'sourceUrl', 'category'];

var MC_AUDIT_HEADERS_ = ['timestamp', 'requestId', 'licenseId', 'clientId', 'installationId', 'action', 'documentId',
  'module', 'result', 'errorCode', 'appVersion', 'apiVersion', 'durationMs'];

var MC_REQUEST_HEADERS_ = ['requestId', 'licenseId', 'clientId', 'installationId', 'action', 'payloadHash', 'status',
  'responseJson', 'createdAt', 'finishedAt'];

/** Установки по лицензиям: без этого листа нельзя проверить «разрешённость installationId». */
var MC_INSTALLATION_HEADERS_ = ['licenseId', 'installationId', 'status', 'firstSeenAt', 'lastSeenAt', 'appVersion', 'notes'];

/** Административный журнал: регистрация, отзыв, замена токена, публикация, уведомления. */
var MC_ADMIN_LOG_HEADERS_ = ['timestamp', 'actor', 'action', 'licenseId', 'documentId', 'details'];

var MC_LICENSE_STATUSES_ = ['ACTIVE', 'SUSPENDED', 'EXPIRED', 'REVOKED', 'TEST'];
var MC_DOCUMENT_STATUSES_ = ['DRAFT', 'ACTIVE', 'ARCHIVED', 'BLOCKED'];
var MC_INSTALLATION_STATUSES_ = ['ACTIVE', 'BLOCKED', 'RELEASED'];

/**
 * Правовой статус материалов. INTERNAL не выдаётся никогда.
 *   OFFICIAL      — официальные нормативные тексты (isOfficialSource = TRUE, sourceUrl — официальный источник);
 *   MONCHEF_GUIDE — собственные пояснения MonChef;
 *   TEMPLATE      — шаблоны форм и журналов;
 *   MAPPING       — таблицы соответствий (требование → контроль → доказательство);
 *   METHODOLOGY   — методические документы;
 *   INTERNAL      — внутренние материалы владельца.
 */
var MC_DOC_CATEGORIES_ = ['OFFICIAL', 'MONCHEF_GUIDE', 'TEMPLATE', 'MAPPING', 'METHODOLOGY', 'INTERNAL'];

var MC_ACTIONS_ = ['CHECK_LICENSE', 'GET_LIBRARY_VERSION', 'LIST_DOCUMENTS', 'GET_DOCUMENT'];

/** Поля запроса, которые API принимает. Любое другое поле (в том числе fileId) — INVALID_REQUEST. */
var MC_REQUEST_FIELDS_ = ['requestId', 'licenseId', 'clientId', 'installationId', 'clientToken', 'action', 'appVersion',
  'documentId', 'module'];

var MC_MAX_REQUEST_BYTES_ = 100 * 1024;
var MC_MAX_STRING_ = 500;

/** Коды ошибок: текст для клиента и признак «можно повторить позже». */
var MC_ERRORS_ = {
  INVALID_REQUEST: ['Некорректный запрос', false],
  REQUEST_TOO_LARGE: ['Запрос больше 100 КБ', false],
  METHOD_NOT_ALLOWED: ['Сервис принимает только POST-запросы с JSON', false],
  UNKNOWN_ACTION: ['Неизвестная операция', false],
  AUTH_FAILED: ['Лицензия не найдена или данные доступа неверны', false],
  LICENSE_NOT_FOUND: ['Лицензия не найдена', false],
  CLIENT_MISMATCH: ['Лицензия выдана другому клиенту', false],
  INVALID_TOKEN: ['Неверный ключ доступа установки', false],
  LICENSE_INACTIVE: ['Лицензия приостановлена, отозвана или ещё не действует', false],
  LICENSE_EXPIRED: ['Срок лицензии истёк', false],
  INSTALLATION_NOT_ALLOWED: ['Установка не разрешена для этой лицензии', false],
  MODULE_NOT_ALLOWED: ['Модуль не входит в лицензию', false],
  DOCUMENT_NOT_ALLOWED: ['Документ не входит в лицензию', false],
  DOCUMENT_NOT_FOUND: ['Документ не найден или снят с публикации', false],
  DOCUMENT_TOO_LARGE: ['Документ слишком большой для выдачи через API — запросите подготовленную копию у MonChef', false],
  DOCUMENT_INTEGRITY_FAILED: ['Документ временно недоступен: не пройдена проверка целостности', true],
  RATE_LIMIT_EXCEEDED: ['Слишком много запросов — повторите через минуту', true],
  REQUEST_ID_PAYLOAD_MISMATCH: ['Этот requestId уже использован для другого запроса', false],
  PROCESSING: ['Запрос с этим requestId ещё выполняется', true],
  BUSY: ['Сервис занят — повторите позже', true],
  SERVICE_UNAVAILABLE: ['Сервис временно недоступен', true],
  INTERNAL_ERROR: ['Внутренняя ошибка сервиса', true]
};

/** Коды, которые в строгом режиме наружу отдаются как AUTH_FAILED (нельзя перечислить licenseId). */
var MC_AUTH_CODES_ = ['LICENSE_NOT_FOUND', 'CLIENT_MISMATCH', 'INVALID_TOKEN'];

// ---------------------------------------------------------------- чтение настроек

var _MC_PROPS_ = null;            // Script Properties, прочитанные один раз за выполнение
var _MC_CFG_OVERRIDE_ = null;     // подмена настроек в тестах

function mcProps_() {
  if (!_MC_PROPS_) {
    try { _MC_PROPS_ = PropertiesService.getScriptProperties().getProperties() || {}; } catch (e) { _MC_PROPS_ = {}; }
  }
  return _MC_PROPS_;
}
function mcResetProps_() { _MC_PROPS_ = null; }

function mcCfg_(key) {
  if (_MC_CFG_OVERRIDE_ && Object.prototype.hasOwnProperty.call(_MC_CFG_OVERRIDE_, key)) return String(_MC_CFG_OVERRIDE_[key]);
  var v = mcProps_()[key];
  if (v === undefined || v === null || v === '') v = MC_CFG_DEFAULTS_[key];
  return v === undefined || v === null ? '' : String(v);
}
function mcCfgInt_(key, def) {
  var n = parseInt(mcCfg_(key), 10);
  return isFinite(n) ? n : (def === undefined ? 0 : def);
}
function mcSetProp_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, String(value));
  mcResetProps_();
}

// ---------------------------------------------------------------- общие утилиты

function mcNowIso_() { return new Date().toISOString(); }

function mcTz_() {
  try { return Session.getScriptTimeZone() || 'UTC'; } catch (e) { return 'UTC'; }
}

/** Дата 'yyyy-MM-dd' в часовом поясе проекта (для сроков лицензии). */
function mcDay_(d) {
  if (d === null || d === undefined || d === '') return '';
  if (Object.prototype.toString.call(d) === '[object Date]') return isNaN(d.getTime()) ? '' : Utilities.formatDate(d, mcTz_(), 'yyyy-MM-dd');
  var s = String(d).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  var m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s);
  if (m) return m[3] + '-' + m[2] + '-' + m[1];
  var t = new Date(s);
  return isNaN(t.getTime()) ? '' : Utilities.formatDate(t, mcTz_(), 'yyyy-MM-dd');
}

function mcIso_(d) {
  if (d === null || d === undefined || d === '') return '';
  if (Object.prototype.toString.call(d) === '[object Date]') return isNaN(d.getTime()) ? '' : d.toISOString();
  return String(d);
}

function mcHex_(bytes) {
  var out = [];
  for (var i = 0; i < bytes.length; i++) { var b = bytes[i] & 0xff; out.push((b < 16 ? '0' : '') + b.toString(16)); }
  return out.join('');
}

function mcSha256Hex_(valueOrBytes) {
  var d = typeof valueOrBytes === 'string'
    ? Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, valueOrBytes, Utilities.Charset.UTF_8)
    : Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, valueOrBytes);
  return mcHex_(d);
}

/** Короткий ключ для кэша: licenseId и прочие значения клиента в ключи кэша напрямую не попадают. */
function mcKey_(prefix, value) { return prefix + '_' + mcSha256Hex_(String(value)).slice(0, 32); }

function mcList_(v) {
  return String(v === null || v === undefined ? '' : v).split(/[,;\s]+/).map(function (x) { return x.trim(); }).filter(Boolean);
}

function mcBool_(v) { return v === true || /^(true|1|да|yes)$/i.test(String(v).trim()); }

/** Ошибка с кодом API: текст исключения наружу не уходит, только код. */
function mcFail_(code, internal) {
  var e = new Error(internal || code);
  e.mcCode = code;
  return e;
}
