// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Utils.gs
 * Мелкие переиспользуемые хелперы. Ничего из этого не дублировать в других файлах.
 */

/**
 * Генерирует ID вида PREFIX-XXXXXXXX (8 hex-символов из UUID). Не зависит от имени объекта.
 * @param {string} sheetKey ключ из CONFIG.SHEETS / CONFIG.ID_PREFIXES, например 'PRODUCTS'
 */
function generateId_(sheetKey) {
  var prefix = CONFIG.ID_PREFIXES[sheetKey];
  if (!prefix) {
    throw new Error('Нет префикса ID для ' + sheetKey + ' — добавь его в CONFIG.ID_PREFIXES.');
  }
  var raw = Utilities.getUuid().replace(/-/g, '').substring(0, 8).toUpperCase();
  return prefix + '-' + raw;
}

/** Текущая дата/время в ISO — единый формат для всех дата-полей. */
function nowIso_() {
  return new Date().toISOString();
}

/** Экранирование для вставки текста в HTML (защита от XSS в будущих печатных формах). */
function escHtml_(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Единый формат JSON-ответа API (используется в Этапе 3). */
function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Единый формат ошибки для пользователя — технические детали никогда не показываются
 * напрямую (ТЗ §24). P0.2 (ТЗ §17): добавлено необязательное error_code — один из
 * CONFIG.ERROR_CODES — РЯДОМ с уже существующим текстом error, ничего не заменяя
 * (фронтенд как читал .ok/.error/.data, так и продолжает это делать без изменений).
 * operation_id/cascade_id добавляются отдельно в processOperation() (API.gs), а не
 * здесь — на момент вызова userError_ они не всегда ещё известны (например, самые
 * ранние отказы processOperation — сессия не найдена — ещё до создания cascade).
 */
function userError_(message, errorCode) {
  return { ok: false, error: message, error_code: errorCode || CONFIG.ERROR_CODES.INTERNAL_ERROR };
}

function userSuccess_(data) {
  return { ok: true, data: data };
}

/**
 * Централизованная запись ошибки (ТЗ §24). Вызывается из catch-блоков всех модулей,
 * чтобы пользователь видел понятное сообщение, а техническое описание уходило в SYSTEM_ERRORS.
 */
function logSystemError_(functionName, userId, operation, err, context) {
  try {
    var sheet = getSheet_('SYSTEM_ERRORS');
    sheet.appendRow([
      generateId_('SYSTEM_ERRORS'),
      functionName,
      userId || '',
      nowIso_(),
      operation || '',
      (err && err.stack) ? err.stack : String(err)
    ]);
  } catch (loggingErr) {
    Logger.log('logSystemError_ failed: ' + loggingErr + ' (original: ' + err + ')');
  }
  // P22: тот же системный сигнал дополнительно попадает в структурированный
  // ErrorService. Ошибка логирования не должна скрывать исходную ошибку.
  try {
    if (typeof logP22Error_ === 'function') {
      var c=context||{};
      logP22Error_(err,{module:c.module||'legacy',functionName:functionName,operationId:c.operationId||'',eventId:c.eventId||'',organizationId:c.organizationId||'',locationId:c.locationId||'',workshopId:c.workshopId||'',userId:userId||c.userId||'',entityType:c.entityType||'',entityId:c.entityId||'',errorCode:c.errorCode||'INTERNAL_ERROR',retryable:c.retryable===true,recoveryStatus:c.recoveryStatus||''});
    }
  } catch (structuredErr) { Logger.log('P22 error service failed: '+structuredErr); }
}

/**
 * Защита от утечки учётных данных через API (подготовка к UAT, P0): рекурсивно копирует результат,
 * НЕ включая поля pin_hash / pin_salt. Вызывается в processOperation для КАЖДОГО ответа — единая
 * точка, поэтому новые действия, возвращающие строку USERS целиком, не могут раскрыть хэш PIN.
 * Не мутирует исходные объекты (строки листов могут использоваться дальше внутри операции).
 */
var SECRET_RESPONSE_KEYS_ = { pin_hash: true, pin_salt: true };
function stripSecrets_(value, depth) {
  depth = depth || 0;
  if (value === null || typeof value !== 'object' || Object.prototype.toString.call(value) === '[object Date]' || depth > 12) return value;
  if (Array.isArray(value)) return value.map(function (v) { return stripSecrets_(v, depth + 1); });
  var out = {};
  Object.keys(value).forEach(function (k) {
    if (SECRET_RESPONSE_KEYS_[k]) return;
    out[k] = stripSecrets_(value[k], depth + 1);
  });
  return out;
}
