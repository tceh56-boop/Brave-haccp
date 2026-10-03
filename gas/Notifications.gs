// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Notifications.gs (v2, ТЗ §21)
 * Внутрисистемные уведомления + email.
 *
 * v2 — ИСПРАВЛЕНА ОШИБКА: раньше notify_() писал только в NOTIFICATIONS (внутренний
 * колокольчик) и НИКОГДА не вызывал sendEmailAlert_ — email-функция существовала, но
 * была полностью не подключена ни к одному реальному событию. Теперь notify_():
 *   1) всегда пишет во внутренний центр уведомлений (NOTIFICATIONS) — как раньше;
 *   2) смотрит NOTIFICATION_SETTINGS для (organization_id, location_id, тип) — а если
 *      её нет, берёт умолчание из CONFIG.DEFAULT_RECIPIENTS по РОЛИ;
 *   3) разворачивает роли в реальные email через USERS (never по одному захардкоженному
 *      адресу — у каждой организации свои сотрудники);
 *   4) не шлёт повторно то же самое событие чаще, чем настроено (event_key + NOTIFICATION_LOG,
 *      анти-спам) — иначе, например, "критический остаток" слался бы на каждый чих.
 */

/**
 * Раунд 12 (P0.5, §46) — добавлен необязательный cascadeId (последний параметр —
 * большинство из 11 вызывающих мест это плановые триггеры БЕЗ сессии/каскада вообще,
 * поэтому им ничего не нужно менять; передают его только вызовы, реально происходящие
 * ВНУТРИ мутирующего API-запроса — см. checkMinStockAndNotify_ ниже и _completeProduction_
 * в Production.gs).
 */
function notify_(organizationId, locationId, type, message, eventKey, cascadeId) {
  var n = {
    notification_id: generateId_('NOTIFICATIONS'),
    organization_id: organizationId || '',
    location_id: locationId || '',
    тип: type,
    сообщение: message,
    статус: 'новое',
    создано: nowIso_(),
    cascade_id: cascadeId || ''
  };
  insertRow_('NOTIFICATIONS', n);

  var key = eventKey || (type + '|' + (locationId || organizationId || ''));
  try {
    _dispatchEmailForEvent_(organizationId, locationId, type, message, key, n.notification_id);
    if (typeof _dispatchTelegramForEvent_ === 'function') _dispatchTelegramForEvent_(organizationId, locationId, type, message, key, n.notification_id);
  } catch (err) {
    logSystemError_('notify_', null, 'notify_email', err);
  }
  return n;
}

/** Настройка уведомления: сначала по точке, потом по организации целиком, иначе — умолчание. */
function _resolveNotificationSetting_(organizationId, locationId, type) {
  var byLocation = findRows_('NOTIFICATION_SETTINGS', function (r) {
    return r.organization_id === organizationId && r.location_id === locationId && r.тип_уведомления === type;
  })[0];
  if (byLocation) return byLocation;
  var byOrg = findRows_('NOTIFICATION_SETTINGS', function (r) {
    return r.organization_id === organizationId && !r.location_id && r.тип_уведомления === type;
  })[0];
  if (byOrg) return byOrg;
  return null; // нет явной настройки — используем DEFAULT_RECIPIENTS ниже
}

function _dispatchEmailForEvent_(organizationId, locationId, type, message, eventKey, notificationId) {
  var setting = _resolveNotificationSetting_(organizationId, locationId, type);
  if (setting && setting.enabled === false) return; // администратор явно выключил этот тип

  var repeatMinutes = setting ? Number(setting.repeat_interval_minutes) || 0 : 60;
  var maxRepeats = setting ? Number(setting.max_repeats) || 1 : 1;
  var recentSends = findRows_('NOTIFICATION_LOG', function (r) { return r.event_key === eventKey; })
    .sort(function (a, b) { return new Date(b.sent_at) - new Date(a.sent_at); });
  if (recentSends.length >= maxRepeats) {
    var last = recentSends[0];
    var minutesSince = (Date.now() - new Date(last.sent_at).getTime()) / 60000;
    if (minutesSince < repeatMinutes) return; // анти-спам: то же событие уже отправлялось недавно
  }

  var recipients = _resolveRecipientEmails_(organizationId, locationId, type, setting);
  if (!recipients.length) return;

  var emailEnabled = setting ? setting.email_enabled !== false : true;
  recipients.forEach(function (email) {
    var sent = false;
    if (emailEnabled) {
      sent = sendEmailAlert_(email, 'ЦЕХ — уведомление', message);
    }
    insertRow_('NOTIFICATION_LOG', {
      log_id: generateId_('NOTIFICATION_LOG'),
      notification_id: notificationId,
      event_key: eventKey,
      recipient_email: email,
      sent_at: nowIso_(),
      статус: emailEnabled ? (sent ? 'отправлено' : 'ошибка') : 'только_в_приложении',
      ошибка: '',
      попытка: 1
    });
  });
}

/** Роли из NOTIFICATION_SETTINGS.recipients (если задано) или CONFIG.DEFAULT_RECIPIENTS -> реальные email сотрудников. */
function _resolveRecipientEmails_(organizationId, locationId, type, setting) {
  var explicit = setting && setting.recipients ? String(setting.recipients).split(',').map(function (s) { return s.trim(); }).filter(Boolean) : null;
  if (explicit && explicit.length) {
    // Может быть список готовых email ИЛИ список ролей — распознаём по наличию "@".
    var emails = [];
    var roles = [];
    explicit.forEach(function (v) { (v.indexOf('@') !== -1 ? emails : roles).push(v); });
    if (roles.length) emails = emails.concat(_emailsForRoles_(organizationId, locationId, roles));
    return emails.filter(Boolean);
  }
  var defaultRoles = CONFIG.DEFAULT_RECIPIENTS[type] || [];
  return _emailsForRoles_(organizationId, locationId, defaultRoles);
}

function _emailsForRoles_(organizationId, locationId, roles) {
  if (!roles.length) return [];
  return getUsers_(organizationId)
    .filter(function (u) {
      if (roles.indexOf(u.роль) === -1 || u.статус !== 'активен' || !u.email) return false;
      if (!locationId) return true;
      var locs = String(u.location_ids || '').split(',');
      return locs.indexOf(locationId) !== -1;
    })
    .map(function (u) { return u.email; });
}

function getNotifications_(locationId, onlyUnread) {
  return findRows_('NOTIFICATIONS', function (r) {
    return (!locationId || r.location_id === locationId) && (!onlyUnread || r.статус === 'новое');
  }).sort(function (a, b) { return new Date(b.создано) - new Date(a.создано); });
}

function markNotificationRead_(notificationId, session) {
  var n = findOne_('NOTIFICATIONS', 'notification_id', notificationId);
  if (!n) return false;
  if (session) assertOwnedByOrgAndLocation_(session, n, 'NOTIFICATIONS:' + notificationId); // ТЗ P0.1
  updateRow_('NOTIFICATIONS', n, { статус: 'прочитано' });
  return true;
}

/**
 * Раунд 11 — locationId необязателен, ЧТО ИМЕННО НОВОЕ: честно указано в отчёте раунда
 * 10 ("настройки уведомлений — без выбора конкретной точки"). updateNotificationSetting_
 * УЖЕ поддерживал per-location настройки с самого начала (NOTIFICATION_SETTINGS.location_id
 * в схеме, upsert по паре (organizationId, locationId, type)) — не хватало только способа
 * их РАЗДЕЛЬНО прочитать и формы выбора точки на фронтенде. Без locationId — прежнее
 * поведение (все настройки организации разом, и org-wide, и по всем точкам).
 */
function getNotificationSettings_(organizationId, locationId) {
  return findRows_('NOTIFICATION_SETTINGS', function (r) {
    if (r.organization_id !== organizationId) return false;
    // locationId===undefined — фильтр не запрошен (прежнее поведение, все настройки
    // организации разом); locationId==='' — ЯВНО запрошены только org-wide настройки
    // (location_id пуст); любая другая строка — только настройки этой точки.
    if (locationId === undefined) return true;
    return r.location_id === locationId;
  });
}

/**
 * P0.7 — НАЙДЕНО ПРИ АУДИТЕ: organizationId резолвится из session на стороне API.gs
 * (саму организацию подменить нельзя), но locationId приходил от клиента и не
 * проверялся — организация А могла создать/изменить у СЕБЯ (organization_id верный)
 * настройку уведомлений, ссылающуюся на locationId ЧУЖОЙ организации Б. Тот же класс
 * дыры, что и найденный в P0.6 для CREATE_JOURNAL_DEFINITION — конфигурационный
 * объект со ссылкой "наружу", а не транзакция, но тот же принцип проверки.
 */
function updateNotificationSetting_(organizationId, locationId, type, patch, session) {
  if (session && locationId) {
    assertOwnedByOrg_(session, findOne_('LOCATIONS', 'location_id', locationId), 'LOCATIONS:' + locationId);
    // Внешний P0-аудит, п.3 — org-проверка выше защищает от чужой организации, но не от
    // ЧУЖОЙ ТОЧКИ ТОЙ ЖЕ организации: пользователь, назначенный не на все точки, мог
    // создать/изменить настройку уведомлений для точки, к которой не имеет отношения.
    assertLocationAllowed_(session, locationId, 'LOCATIONS:' + locationId);
  }
  var existing = _resolveNotificationSetting_(organizationId, locationId, type);
  if (existing && existing.organization_id === organizationId && existing.location_id === locationId) {
    // Внешний P0-аудит, п.3 (mass assignment, продолжение раунда 12) — НАЙДЕНО: patch
    // применялся напрямую к updateRow_ — клиент мог передать organization_id/location_id/
    // setting_id/тип_уведомления в patch и переподчинить существующую настройку чужой
    // организации/точке или другому типу уведомления, минуя обе проверки выше (они
    // проверяют ПАРАМЕТРЫ функции locationId/organizationId, а не содержимое patch).
    var safePatch = _stripProtectedFields_(patch, ['setting_id', 'organization_id', 'location_id', 'тип_уведомления']);
    updateRow_('NOTIFICATION_SETTINGS', existing, safePatch);
    return findOne_('NOTIFICATION_SETTINGS', 'setting_id', existing.setting_id);
  }
  var row = {
    setting_id: generateId_('NOTIFICATION_SETTINGS'),
    organization_id: organizationId,
    location_id: locationId || '',
    тип_уведомления: type,
    enabled: patch.enabled !== undefined ? patch.enabled : true,
    email_enabled: patch.email_enabled !== undefined ? patch.email_enabled : true,
    recipients: patch.recipients || '',
    delay_minutes: patch.delay_minutes || 0,
    repeat_interval_minutes: patch.repeat_interval_minutes || 60,
    max_repeats: patch.max_repeats || 1
  };
  insertRow_('NOTIFICATION_SETTINGS', row);
  return row;
}

/** Email работает "как есть" (Apps Script MailApp), Telegram — заглушка до подключения бота. */
function sendEmailAlert_(toEmail, subject, body) {
  try {
    MailApp.sendEmail(toEmail, subject, body);
    return true;
  } catch (err) {
    logSystemError_('sendEmailAlert_', null, 'email', err);
    return false;
  }
}

function sendTelegramAlert_(chatId, message) {
  // Заглушка: реализуется через UrlFetchApp к Telegram Bot API, когда появится токен бота.
  Logger.log('[Telegram-заглушка] ' + chatId + ': ' + message);
  return false;
}

/**
 * Проверка минимального остатка после любой операции расхода (ТЗ §5 п.11-13).
 * Раунд 12 (P0.5, §46) — необязательный cascadeId: вызывается и синхронно из
 * CREATE_WRITEOFF (session/cascade есть), и из criticalStockTrigger_ (Main.gs,
 * плановый обход всех продуктов/точек — там его законно нет и не может быть).
 */
function checkMinStockAndNotify_(product, locationId, cascadeId) {
  var stock = getStockLevel_(product.product_id, locationId);
  var configuredMin = _policy29Value_('warehouse','min_stock_override', {organization_id:product.organization_id, location_id:locationId}, null);
  var minStock = configuredMin !== null && configuredMin !== undefined && configuredMin !== '' ? Number(configuredMin) : Number(product.мин_остаток);
  if (stock < minStock) {
    notify_(product.organization_id, locationId, CONFIG.NOTIFICATION_TYPES.CRITICAL_STOCK,
      'Остаток "' + product.название + '" (' + round2_(stock) + ' ' + product.единица + ') ниже минимума (' + product.мин_остаток + ').',
      'critical_stock|' + product.product_id + '|' + locationId, cascadeId);
    return true;
  }
  return false;
}
