/**
 * MonChef License API — уведомления владельцу только о подозрительных событиях (ТЗ, п. 13).
 *
 * Типы событий:
 *   UNKNOWN_LICENSE      — обращение с неизвестным licenseId;
 *   BAD_TOKENS           — несколько неверных токенов / clientId подряд;
 *   MULTI_INSTALL        — вторая установка при лимите 1;  INSTALL_LIMIT — превышен лимит установок;
 *   FORBIDDEN_MODULE     — запрос запрещённого модуля;     FORBIDDEN_DOCUMENT — запрещённого документа;
 *   REQUEST_SPIKE        — резкий рост запросов;           MANY_ERRORS — много отказов за час;
 *   INACTIVE_LICENSE_USE — обращение по просроченной, приостановленной или отозванной лицензии;
 *   HASH_MISMATCH        — SHA-256 файла не совпал с реестром.
 *
 * Повтор одного события по одной лицензии — не чаще MC_NOTIFY_DEDUP_MINUTES, всего не больше
 * MC_NOTIFY_MAX_PER_HOUR писем в час. В письмах нет токенов, паролей и содержимого документов.
 */

var MC_EVENT_TITLES_ = {
  UNKNOWN_LICENSE: 'Обращение с неизвестным licenseId',
  BAD_TOKENS: 'Несколько неверных ключей доступа подряд',
  MULTI_INSTALL: 'Лицензия с лимитом 1 используется второй установкой',
  INSTALL_LIMIT: 'Превышен лимит установок',
  FORBIDDEN_MODULE: 'Запрос модуля, не входящего в лицензию',
  FORBIDDEN_DOCUMENT: 'Запрос документа, не входящего в лицензию',
  REQUEST_SPIKE: 'Резкий рост числа запросов',
  MANY_ERRORS: 'Много отказов по лицензии',
  INACTIVE_LICENSE_USE: 'Обращение по недействующей лицензии',
  HASH_MISMATCH: 'Несовпадение хеша документа — документ заблокирован'
};

var _MC_NOTIFY_SENT_ = [];   // для тестов: что было бы отправлено

function notifySuspiciousEvent_(event) {
  event = event || {};
  var type = String(event.type || 'UNKNOWN');
  try {
    var dedupKey = mcKey_('ntf', type + '|' + (event.licenseId || '') + '|' + (event.documentId || ''));
    if (mcCacheGet_(dedupKey)) return false;
    mcCachePut_(dedupKey, { t: Date.now() }, mcCfgInt_('MC_NOTIFY_DEDUP_MINUTES', 360) * 60);

    var hourKey = 'ntf_hour_' + Math.floor(Date.now() / 3600000);
    var n = mcCacheIncr_(hourKey, 3700);
    var details = [
      'Событие: ' + (MC_EVENT_TITLES_[type] || type) + ' (' + type + ')',
      'Время (UTC): ' + mcNowIso_(),
      event.licenseId ? 'licenseId: ' + mcClip_(event.licenseId, 64) : '',
      event.clientId ? 'clientId: ' + mcClip_(event.clientId, 64) : '',
      event.installationId ? 'installationId: ' + mcClip_(event.installationId, 128) : '',
      event.documentId ? 'documentId: ' + mcClip_(event.documentId, 64) : '',
      event.module ? 'module: ' + mcClip_(event.module, 64) : '',
      event.details ? 'Подробности: ' + mcClip_(event.details, 500) : ''
    ].filter(Boolean).join('\n');

    writeAdminLog_('NOTIFY_' + type, event.licenseId || '', event.documentId || '', details.replace(/\n/g, ' | '));
    _MC_NOTIFY_SENT_.push({ type: type, body: details });

    var to = mcCfg_('MC_ADMIN_EMAIL');
    if (!to || n > mcCfgInt_('MC_NOTIFY_MAX_PER_HOUR', 20)) return false;
    MailApp.sendEmail({ to: to, subject: 'MonChef License API: ' + (MC_EVENT_TITLES_[type] || type),
      body: details + '\n\nЖурнал обращений — лист API_AUDIT, административный журнал — ADMIN_LOG реестра лицензий.' });
    return true;
  } catch (e) {
    try { console.error('уведомление не отправлено: ' + type); } catch (x) {}
    return false;
  }
}
