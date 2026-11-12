/**
 * ЦЕХ Стандарт Admin — рассылки клиентам.
 * Каналы: EMAIL (MailApp), SYSTEM (сообщение в системе клиента — приходит с проверкой лицензии и
 * показывается на экране «Подписка»). PUSH — через системное уведомление (отдельного push-сервиса у Apps Script нет).
 * Группы: ALL, EXPIRING, NEW (за 30 дней), EXPIRED, PLAN:<код тарифа>.
 */
function mailHtml_(title, text) {
  return '<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #eadfca;border-radius:14px;overflow:hidden">' +
    '<div style="background:#0b0b0b;color:#d4af37;padding:16px 20px;font:700 18px Arial">ЦЕХ <span style="color:#fff">Стандарт</span></div>' +
    '<div style="padding:20px;color:#1a1510;line-height:1.5"><h2 style="margin:0 0 10px;font-size:18px">' + esc(title) + '</h2><div style="white-space:pre-wrap">' + esc(text) + '</div></div>' +
    '<div style="padding:12px 20px;background:#f4ede1;color:#7a6c5c;font-size:12px">Порядок. Контроль. Развитие.</div></div>';
}
function groupOrgs_(group) {
  var today = isoDay(), orgs = readAll('Organizations').filter(function (o) { return o['Статус'] !== 'DELETED'; });
  return orgs.filter(function (o) {
    var end = o['Окончание подписки'] ? isoDay(new Date(o['Окончание подписки'])) : '';
    if (group === 'ALL') return true;
    if (group === 'EXPIRING') return end && end >= today && daysBetween(today, end) <= EXPIRING_DAYS;
    if (group === 'EXPIRED') return end && end < today;
    if (group === 'NEW') return o['Дата регистрации'] && daysBetween(new Date(o['Дата регистрации']), new Date()) <= 30;
    if (String(group).indexOf('PLAN:') === 0) return o['Тариф'] === group.slice(5);
    return false;
  });
}
/** Отправить рассылку. n: {channel: EMAIL|SYSTEM|PUSH, group, subject, text}. */
function adminNotify(token, n) {
  try {
    var s = requireRole(token, 'notify.send'); n = n || {}; req(n, ['channel', 'group', 'subject', 'text']);
    var orgs = groupOrgs_(n.group), sent = 0, errors = 0;
    if (n.channel === 'EMAIL') {
      if (orgs.length > MailApp.getRemainingDailyQuota()) throw new Error('VALIDATION: дневной лимит писем Google меньше числа получателей (' + orgs.length + ')');
      orgs.forEach(function (o) { if (!o['Email']) return; try { MailApp.sendEmail({ to: o['Email'], name: 'ЦЕХ Стандарт', subject: n.subject, htmlBody: mailHtml_(n.subject, n.text) }); sent++; } catch (e) { errors++; } });
    } else {
      // системное уведомление: общий список для клиентов группы, живёт 14 дней
      var list = getSetting('CLIENT_NOTICES', []).filter(function (x) { return x.until > Date.now(); });
      list.push({ id: newId('N'), text: n.subject + ': ' + n.text, group: n.group, until: Date.now() + 14 * 864e5 });
      setSetting('CLIENT_NOTICES', list, 'Системные уведомления для клиентов');
      sent = orgs.length;
    }
    insert('Notifications', { 'ID': newId('NT'), 'Дата': new Date(), 'Канал': n.channel, 'Группа': n.group, 'Тема': n.subject, 'Текст': n.text, 'Получателей': sent, 'Статус': errors ? 'PARTIAL' : 'SENT', 'Кто': s.email });
    logEvent('NOTIFY', s.email, n.group, n.channel + ': «' + n.subject + '» — ' + sent + ' получателей' + (errors ? ', ошибок ' + errors : ''));
    return ok({ sent: sent, errors: errors });
  } catch (e) { return fail(e); }
}
function adminNotifications(token) {
  try { requireRole(token, 'notify.send'); return ok(readAll('Notifications').reverse().slice(0, 300)); } catch (e) { return fail(e); }
}
