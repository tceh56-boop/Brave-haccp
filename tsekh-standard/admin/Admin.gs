/**
 * ЦЕХ Стандарт Admin — клиенты (CRM): список, карточка, правка, блокировка, удаление, сообщения.
 */
function orgView_(o, subs, today) {
  var end = o['Окончание подписки'] ? isoDay(new Date(o['Окончание подписки'])) : '';
  var left = end ? daysBetween(today, end) : null;
  return {
    id: o['ID'], name: o['Название'], email: o['Email'], phone: o['Телефон'], inn: o['ИНН'], address: o['Адрес'],
    registered: o['Дата регистрации'] ? isoDay(new Date(o['Дата регистрации'])) : '', plan: o['Тариф'], planName: (tariff(o['Тариф']) || {}).name || o['Тариф'],
    status: o['Статус'], subEnd: end, daysLeft: left, staff: o['Сотрудников'], ttk: o['ТТК'], journals: o['Журналов'], dbSize: o['Размер базы'],
    version: o['Версия'], lastSeen: o['Последний вход'], driveId: o['Google Drive ID'], licenseKey: o['License Key'], scriptId: o['Script ID'], appUrl: o['App URL'],
    manager: o['Менеджер'], comment: o['Комментарий']
  };
}
/** Таблица клиентов. f: {q, status, plan}. */
function adminClients(token, f) {
  try {
    requireRole(token, 'clients.view'); f = f || {};
    var today = isoDay(), q = String(f.q || '').toLowerCase();
    var rows = readAll('Organizations').filter(function (o) { return o['Статус'] !== 'DELETED'; }).map(function (o) { return orgView_(o, null, today); }).filter(function (o) {
      if (f.status && f.status !== 'ALL' && o.status !== f.status) return false;
      if (f.plan && f.plan !== 'ALL' && o.plan !== f.plan) return false;
      if (q && [o.id, o.name, o.email, o.phone, o.inn, o.licenseKey].join(' ').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    return ok(rows);
  } catch (e) { return fail(e); }
}
/** Создать или изменить клиента. Новому клиенту сразу создаются подписка (статус по оплате) и лицензия. */
function adminClientSave(token, c) {
  try {
    var s = requireRole(token, 'clients.edit'); c = c || {}; req(c, ['name', 'email', 'plan']);
    if (!tariff(c.plan)) throw new Error('VALIDATION: неизвестный тариф');
    if (c.inn && !/^\d{10}(\d{2})?$/.test(String(c.inn))) throw new Error('VALIDATION: ИНН — 10 или 12 цифр');
    var result = withLock(function () {
      if (c.id) {
        var cur = findBy('Organizations', 'ID', c.id); if (!cur) throw new Error('NOT_FOUND: клиент не найден');
        update('Organizations', c.id, { 'Название': c.name, 'Email': c.email, 'Телефон': c.phone || '', 'ИНН': c.inn || '', 'Адрес': c.address || '', 'Менеджер': c.manager || '', 'Комментарий': c.comment || '', 'Google Drive ID': c.driveId || cur['Google Drive ID'] });
        if (c.plan !== cur['Тариф']) changePlan_(s, c.id, c.plan);
        return { id: c.id, created: false };
      }
      var id = newId('ORG'), months = Number(c.months || 1), end = addMonths(new Date(), months);
      insert('Organizations', { 'ID': id, 'Название': c.name, 'Email': c.email, 'Телефон': c.phone || '', 'ИНН': c.inn || '', 'Адрес': c.address || '', 'Дата регистрации': new Date(),
        'Тариф': c.plan, 'Статус': 'ACTIVE', 'Окончание подписки': end, 'Менеджер': c.manager || s.name, 'Комментарий': c.comment || '', 'Google Drive ID': c.driveId || '' });
      var lic = createLicense_(s, id, c.name, end);
      createSubscription_(id, c.name, c.plan, new Date(), end);
      return { id: id, created: true, licenseKey: lic.key, secret: lic.secret };
    });
    logEvent('CHANGE', s.email, result.id, result.created ? 'Создан клиент ' + c.name + ' (' + c.plan + ')' : 'Изменён клиент ' + c.name);
    return ok(result);
  } catch (e) { return fail(e); }
}
/** Карточка клиента: всё по клиенту в одном ответе. */
function adminClientCard(token, id) {
  try {
    requireRole(token, 'clients.view');
    var o = findBy('Organizations', 'ID', id); if (!o) throw new Error('NOT_FOUND: клиент не найден');
    var today = isoDay();
    var logs = readAll('Logs').filter(function (l) { return String(l['Объект']) === String(id) || String(l['Объект']) === String(o['License Key']); }).reverse();
    var stats = {}; try { stats = JSON.parse(PropertiesService.getScriptProperties().getProperty('STATS_' + id) || '{}'); } catch (e) {}
    return ok({
      info: orgView_(o, null, today),
      subscription: readAll('Subscriptions').filter(function (x) { return x['OrgID'] === id; }).reverse()[0] || null,
      payments: readAll('Payments').filter(function (x) { return x['OrgID'] === id; }).reverse(),
      licenses: readAll('Licenses').filter(function (x) { return x['OrgID'] === id; }),
      logins: logs.filter(function (l) { return l['Тип'] === 'LICENSE'; }).slice(0, 50),
      actions: logs.filter(function (l) { return l['Тип'] !== 'LICENSE'; }).slice(0, 50),
      errors: readAll('Errors').filter(function (x) { return String(x['Источник']) === String(id); }).reverse().slice(0, 50),
      backups: readAll('Backups').filter(function (x) { return x['OrgID'] === id; }).reverse(),
      stats: stats,
      commands: String(o['Команды'] || '')
    });
  } catch (e) { return fail(e); }
}
function adminClientBlock(token, id, block) {
  try {
    var s = requireRole(token, 'clients.edit');
    withLock(function () {
      update('Organizations', id, { 'Статус': block ? 'BLOCKED' : 'ACTIVE' });
      readAll('Licenses').filter(function (l) { return l['OrgID'] === id && l['Статус'] !== 'REVOKED'; }).forEach(function (l) { update('Licenses', l['License Key'], { 'Статус': block ? 'BLOCKED' : 'ACTIVE' }); });
    });
    logEvent('CHANGE', s.email, id, block ? 'Клиент заблокирован' : 'Клиент разблокирован');
    return ok(true);
  } catch (e) { return fail(e); }
}
/** Удаление — мягкое: статус DELETED, лицензии отзываются, история платежей сохраняется. */
function adminClientDelete(token, id) {
  try {
    var s = requireRole(token, 'clients.delete');
    withLock(function () {
      update('Organizations', id, { 'Статус': 'DELETED' });
      readAll('Licenses').filter(function (l) { return l['OrgID'] === id; }).forEach(function (l) { update('Licenses', l['License Key'], { 'Статус': 'REVOKED' }); });
    });
    logEvent('DELETE', s.email, id, 'Клиент удалён (мягкое удаление, лицензии отозваны)');
    return ok(true);
  } catch (e) { return fail(e); }
}
/** Письмо клиенту на email карточки. */
function adminClientMessage(token, id, subject, text) {
  try {
    var s = requireRole(token, 'notify.send'), o = findBy('Organizations', 'ID', id); if (!o) throw new Error('NOT_FOUND: клиент не найден');
    req({ subject: subject, text: text }, ['subject', 'text']);
    MailApp.sendEmail({ to: o['Email'], subject: subject, htmlBody: mailHtml_(subject, text), name: 'ЦЕХ Стандарт' });
    insert('Notifications', { 'ID': newId('NT'), 'Дата': new Date(), 'Канал': 'EMAIL', 'Группа': 'Клиент ' + o['Название'], 'Тема': subject, 'Текст': text, 'Получателей': 1, 'Статус': 'SENT', 'Кто': s.email });
    logEvent('NOTIFY', s.email, id, 'Письмо: ' + subject);
    return ok(true);
  } catch (e) { return fail(e); }
}
/** Команда клиенту (выполнится при следующей проверке лицензии): backup. */
function queueCommand_(orgId, cmd) {
  var o = findBy('Organizations', 'ID', orgId), list = String(o['Команды'] || '').split(',').filter(Boolean);
  if (list.indexOf(cmd) < 0) list.push(cmd);
  update('Organizations', orgId, { 'Команды': list.join(',') });
}
