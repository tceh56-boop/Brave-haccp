/**
 * ЦЕХ — SystemHardening.gs
 * Финальный инженерный слой: индексированные кэши, безопасные интеграционные REST-адаптеры,
 * Telegram-уведомления и операционное закрытие recovery-записей.
 *
 * ВАЖНО: внешняя система никогда не получает права менять склад напрямую.
 * Внешние данные проходят через существующие API/валидаторы ЦЕХ.
 */

var TSEKH_CACHE_PREFIX_ = 'tsekh:v3:';
var TSEKH_CACHE_INDEX_TTL_ = 300;

function _hardCacheKey_(name, orgId, suffix) {
  return TSEKH_CACHE_PREFIX_ + name + ':' + String(orgId || '_') + ':' + String(suffix || '_');
}

function getCachedProductIndex_(organizationId) {
  var key = _hardCacheKey_('products', organizationId, 'barcode_article_name');
  var cache = CacheService.getScriptCache();
  var raw = cache.get(key);
  if (raw) return JSON.parse(raw);
  var rows = findRows_('PRODUCTS', function (r) { return r.organization_id === organizationId; });
  var index = { barcode: {}, article: {}, name: {} };
  rows.forEach(function (r) {
    var barcode = String(r.штрихкод || '').trim();
    if (barcode) index.barcode[barcode] = r.product_id;
    var article = String(r.артикул || r.article || '').trim().toLowerCase();
    if (article) index.article[article] = r.product_id;
    var name = _hardNormalizeProductName_(r.название);
    if (name) index.name[name] = r.product_id;
  });
  cache.put(key, JSON.stringify(index), TSEKH_CACHE_INDEX_TTL_);
  return index;
}

function invalidateProductIndex_(organizationId) {
  CacheService.getScriptCache().remove(_hardCacheKey_('products', organizationId, 'barcode_article_name'));
}

function _hardNormalizeProductName_(value) {
  return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').trim().replace(/\s+/g, ' ');
}

function findProductFast_(organizationId, barcode, article, name) {
  var idx = getCachedProductIndex_(organizationId);
  var b = String(barcode || '').replace(/\D/g, '');
  if (b && idx.barcode[b]) return { productId: idx.barcode[b], match: 'barcode' };
  var a = String(article || '').trim().toLowerCase();
  if (a && idx.article[a]) return { productId: idx.article[a], match: 'article' };
  var n = _hardNormalizeProductName_(name);
  if (n && idx.name[n]) return { productId: idx.name[n], match: 'name' };
  return null;
}

/** Ручное/триггерное инвалидирование после массового импорта. */
function invalidateOrganizationCaches_(organizationId) {
  if (!organizationId) return;
  invalidateProductIndex_(organizationId);
  ['PRODUCTS', 'BATCHES', 'WAREHOUSE_OPS', 'CALCULATIONS', 'NOTIFICATIONS'].forEach(function (k) {
    try { invalidateCache_(k); } catch (e) {}
  });
}

/**
 * Telegram Bot API. Токен хранится только в Script Properties:
 * TSEKH_TELEGRAM_BOT_TOKEN. chat_id берётся из NOTIFICATION_SETTINGS.recipients
 * в формате tg:<chat_id>,tg:<chat_id> или из TSEKH_TELEGRAM_CHAT_IDS как fallback.
 */
function _telegramBotToken_() {
  return PropertiesService.getScriptProperties().getProperty('TSEKH_TELEGRAM_BOT_TOKEN') || '';
}

function _telegramRecipients_(setting) {
  var result = [];
  String(setting && setting.recipients || '').split(/[,;\s]+/).forEach(function (x) {
    if (x.indexOf('tg:') === 0) result.push(x.slice(3));
  });
  if (!result.length) {
    String(PropertiesService.getScriptProperties().getProperty('TSEKH_TELEGRAM_CHAT_IDS') || '')
      .split(/[,;\s]+/).forEach(function (x) { if (x) result.push(x); });
  }
  return result.filter(function (x, i, a) { return x && a.indexOf(x) === i; });
}

function sendTelegramAlertReal_(chatId, message) {
  var token = _telegramBotToken_();
  if (!token) return false;
  try {
    var response = UrlFetchApp.fetch('https://api.telegram.org/bot' + encodeURIComponent(token) + '/sendMessage', {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify({ chat_id: String(chatId), text: String(message || '').slice(0, 4096), disable_web_page_preview: true })
    });
    var code = response.getResponseCode();
    if (code < 200 || code >= 300) throw new Error('Telegram HTTP ' + code + ': ' + response.getContentText().slice(0, 300));
    var body = JSON.parse(response.getContentText());
    return body.ok === true;
  } catch (err) {
    logSystemError_('sendTelegramAlert_', null, 'telegram', err);
    return false;
  }
}

function _dispatchTelegramForEvent_(organizationId, locationId, type, message, eventKey, notificationId) {
  var setting = _resolveNotificationSetting_(organizationId, locationId, type);
  if (setting && setting.enabled === false) return;
  var chats = _telegramRecipients_(setting);
  if (!chats.length) return;
  chats.forEach(function (chatId) {
    var ok = sendTelegramAlertReal_(chatId, 'ЦЕХ — ' + type + '\n' + message);
    insertRow_('NOTIFICATION_LOG', {
      log_id: generateId_('NOTIFICATION_LOG'), notification_id: notificationId,
      event_key: eventKey + '|tg:' + chatId, recipient_email: 'telegram:' + chatId,
      sent_at: nowIso_(), статус: ok ? 'отправлено' : 'ошибка', ошибка: ok ? '' : 'telegram_send_failed', попытка: 1
    });
  });
}

/** Позволяет вручную проверить Telegram из админского API. */
function testTelegramConnection_(session, chatId) {
  if (!session) throw new Error('Сессия обязательна.');
  if (!chatId) throw new Error('chatId обязателен.');
  if (!_telegramBotToken_()) throw new Error('TSEKH_TELEGRAM_BOT_TOKEN не настроен.');
  return { ok: sendTelegramAlertReal_(chatId, 'Тестовое уведомление ЦЕХ. ' + nowIso_()) };
}

/**
 * Generic REST adapter для r_keeper/1c. Это НЕ притворяется нативным API:
 * администратор задаёт endpoint и JSON-шаблон. Ответ импортируется только через
 * безопасные существующие операции, если payloadType поддержан.
 */
function _externalRestRequest_(integration, settings, method, payload) {
  var endpoint = settings.endpoint || settings.url || '';
  if (!endpoint) throw new Error('Не задан endpoint интеграции ' + integration.system + '.');
  var options = { method: method || 'post', contentType: 'application/json', muteHttpExceptions: true };
  var headers = settings.headers || {};
  var bearer = PropertiesService.getScriptProperties().getProperty('TSEKH_INTEGRATION_BEARER_' + integration.integration_id) || '';
  if (bearer) headers.Authorization = 'Bearer ' + bearer;
  options.headers = headers;
  if (payload !== undefined) options.payload = JSON.stringify(payload);
  var response = UrlFetchApp.fetch(endpoint, options);
  var code = response.getResponseCode();
  var text = response.getContentText();
  if (code < 200 || code >= 300) throw new Error('HTTP ' + code + ': ' + text.slice(0, 500));
  try { return JSON.parse(text); } catch (e) { return { raw: text }; }
}

function testExternalRestIntegration_(integrationId, session) {
  var integration = findOne_('INTEGRATIONS', 'integration_id', integrationId);
  assertOwnedByOrg_(session, integration, 'INTEGRATIONS:' + integrationId);
  var settings = JSON.parse(integration.settings_json || '{}');
  if (!settings.endpoint && !settings.url) throw new Error('Для ' + integration.system + ' не задан endpoint/url.');
  var response = _externalRestRequest_(integration, settings, settings.testMethod || 'get');
  updateRow_('INTEGRATIONS', integration, { status: 'SUCCESS', auth_status: 'ПОДТВЕРЖДЕНО', last_error: '', updated_at: nowIso_() });
  return { success: true, system: integration.system, response: response };
}

function pullExternalRestIntegration_(integrationId, session) {
  var integration = findOne_('INTEGRATIONS', 'integration_id', integrationId);
  assertOwnedByOrg_(session, integration, 'INTEGRATIONS:' + integrationId);
  var settings = JSON.parse(integration.settings_json || '{}');
  var response = _externalRestRequest_(integration, settings, settings.pullMethod || 'get');
  updateRow_('INTEGRATIONS', integration, { status: 'SUCCESS', last_sync: nowIso_(), last_error: '', updated_at: nowIso_() });
  return { success: true, system: integration.system, data: response };
}

function pushExternalRestIntegration_(integrationId, payload, session) {
  var integration = findOne_('INTEGRATIONS', 'integration_id', integrationId);
  assertOwnedByOrg_(session, integration, 'INTEGRATIONS:' + integrationId);
  var settings = JSON.parse(integration.settings_json || '{}');
  var response = _externalRestRequest_(integration, settings, settings.pushMethod || 'post', payload || {});
  updateRow_('INTEGRATIONS', integration, { status: 'SUCCESS', last_sync: nowIso_(), last_error: '', updated_at: nowIso_() });
  return { success: true, system: integration.system, data: response };
}

/** Безопасное закрытие recovery после проверки человеком. Ничего не удаляет. */
function resolveRecoveryManually_(cascadeId, note, session) {
  return withLock_(function () {
    var row = findOne_('CASCADES', 'cascade_id', cascadeId);
    if (!row) throw new Error('Операция не найдена: ' + cascadeId);
    assertOwnedByOrg_(session, row, 'CASCADES:' + cascadeId);
    if (row.статус !== 'RECOVERY_REQUIRED') throw new Error('Операция не находится в RECOVERY_REQUIRED.');
    updateRow_('CASCADES', row, { статус: 'RECOVERED', ошибка: String(note || 'Восстановление подтверждено оператором.'), завершено: nowIso_() });
    auditLog_(session.user_id, 'Recovery подтверждён оператором', 'CASCADES:' + cascadeId, null, String(note || ''), 'success', cascadeId);
    return getCascade_(cascadeId);
  });
}

function getSystemHealth_(session) {
  var integrations = getIntegrations_(session.organization_id).map(function (x) {
    return { system: x.system, status: x.status, auth_status: x.auth_status, last_sync: x.last_sync, last_error: x.last_error };
  });
  var recovery = getCascadesByStatus_(session.organization_id, 'RECOVERY_REQUIRED');
  return {
    generated_at: nowIso_(), cache: { ttl_seconds: CONFIG.CACHE_TTL_SECONDS, max_ttl_seconds: CONFIG.CACHE_MAX_TTL_SECONDS },
    integrations: integrations, recovery_required: recovery.length,
    telegram_configured: !!_telegramBotToken_()
  };
}
