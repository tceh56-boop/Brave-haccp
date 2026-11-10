/**
 * ЦЕХ Стандарт Admin — подписки: активные, истекающие, просроченные, отменённые, с автоплатежом.
 * Стоимость: подключение (разово) + обслуживание в месяц — из тарифа (System_Settings/TARIFFS).
 */
function createSubscription_(orgId, orgName, plan, start, end) {
  var t = tariff(plan) || {};
  var sub = { 'ID': newId('SUB'), 'OrgID': orgId, 'Организация': orgName, 'Тариф': plan, 'Статус': 'ACTIVE', 'Начало': start, 'Окончание': end,
    'Автоплатеж': 'нет', 'Способ оплаты': '', 'Подключение': t.setup || 0, 'Обслуживание в месяц': t.monthly || 0, 'Следующее списание': end,
    'История': JSON.stringify([{ at: isoDay(start), plan: plan, end: isoDay(end), why: 'создание' }]) };
  insert('Subscriptions', sub);
  return sub;
}
function subState_(sub, org, today) {
  if (sub['Статус'] === 'CANCELLED') return 'CANCELLED';
  var end = sub['Окончание'] ? isoDay(new Date(sub['Окончание'])) : '';
  if (!end) return 'ACTIVE';
  if (end < today) return 'EXPIRED';
  if (daysBetween(today, end) <= EXPIRING_DAYS) return 'EXPIRING';
  return 'ACTIVE';
}
/** Список подписок с остатком дней. f.group: ALL | ACTIVE | EXPIRING | EXPIRED | CANCELLED | AUTOPAY. */
function adminSubscriptions(token, f) {
  try {
    requireRole(token, 'subs.view'); f = f || {};
    var today = isoDay(), orgs = {}; readAll('Organizations').forEach(function (o) { orgs[o['ID']] = o; });
    var last = {}; readAll('Subscriptions').forEach(function (s) { last[s['OrgID']] = s; });   // действующая — последняя по клиенту
    var rows = Object.keys(last).map(function (k) {
      var s = last[k], o = orgs[k] || {}, st = subState_(s, o, today), end = s['Окончание'] ? isoDay(new Date(s['Окончание'])) : '';
      var hist = []; try { hist = JSON.parse(s['История'] || '[]'); } catch (e) {}
      return { id: s['ID'], orgId: k, org: o['Название'] || s['Организация'], plan: s['Тариф'], planName: (tariff(s['Тариф']) || {}).name || s['Тариф'], state: st,
        end: end, daysLeft: end ? daysBetween(today, end) : null, nextCharge: s['Следующее списание'] ? isoDay(new Date(s['Следующее списание'])) : '',
        monthly: s['Обслуживание в месяц'], autopay: s['Автоплатеж'] === 'да', method: s['Способ оплаты'], history: hist, orgStatus: o['Статус'] };
    }).filter(function (r) {
      if (r.orgStatus === 'DELETED') return false;
      var g = f.group || 'ALL';
      return g === 'ALL' || (g === 'AUTOPAY' ? r.autopay : r.state === g);
    }).sort(function (a, b) { return (a.daysLeft === null ? 1e9 : a.daysLeft) - (b.daysLeft === null ? 1e9 : b.daysLeft); });
    return ok(rows);
  } catch (e) { return fail(e); }
}
/** Сменить тариф клиента: новая цена обслуживания с текущей даты, окончание сохраняется. */
function changePlan_(s, orgId, plan) {
  var t = tariff(plan); if (!t) throw new Error('VALIDATION: неизвестный тариф');
  update('Organizations', orgId, { 'Тариф': plan });
  var sub = readAll('Subscriptions').filter(function (x) { return x['OrgID'] === orgId; }).reverse()[0];
  if (sub) {
    var hist = []; try { hist = JSON.parse(sub['История'] || '[]'); } catch (e) {}
    hist.push({ at: isoDay(), plan: plan, why: 'смена тарифа (' + (s ? s.email : 'система') + ')' });
    update('Subscriptions', sub['ID'], { 'Тариф': plan, 'Обслуживание в месяц': t.monthly, 'История': JSON.stringify(hist) });
  }
}
function adminSubscriptionChangePlan(token, orgId, plan) {
  try { var s = requireRole(token, 'subs.edit'); withLock(function () { changePlan_(s, orgId, plan); }); logEvent('CHANGE', s.email, orgId, 'Тариф → ' + plan); return ok(true); }
  catch (e) { return fail(e); }
}
/** «Продлить»: выставить счёт на N месяцев обслуживания (оплата продлит подписку) или продлить сразу (paid=true — оплачено вне системы). */
function adminSubscriptionRenew(token, orgId, months, paid) {
  try {
    var s = requireRole(token, 'subs.edit'); months = Math.max(1, Math.min(36, Number(months) || 1));
    var o = findBy('Organizations', 'ID', orgId); if (!o) throw new Error('NOT_FOUND: клиент не найден');
    var t = tariff(o['Тариф']), amount = (t.monthly || 0) * months;
    if (paid) {
      var pay = recordPayment_({ orgId: orgId, amount: amount, purpose: 'MONTHLY', months: months, provider: 'manual', status: 'PAID', comment: 'Оплата вне системы, отметил ' + s.email });
      logEvent('PAYMENT', s.email, orgId, 'Ручное продление на ' + months + ' мес., ' + money(amount));
      return ok({ payment: pay['ID'] });
    }
    var inv = createInvoicePayment_(orgId, amount, 'MONTHLY', months, s.email);
    logEvent('PAYMENT', s.email, orgId, 'Выставлен счёт ' + inv.invoice + ' на ' + money(amount));
    return ok(inv);
  } catch (e) { return fail(e); }
}
function adminSubscriptionSetAutopay(token, orgId, on, method) {
  try {
    var s = requireRole(token, 'subs.edit'), sub = readAll('Subscriptions').filter(function (x) { return x['OrgID'] === orgId; }).reverse()[0];
    if (!sub) throw new Error('NOT_FOUND: подписка не найдена');
    withLock(function () { update('Subscriptions', sub['ID'], { 'Автоплатеж': on ? 'да' : 'нет', 'Способ оплаты': method || sub['Способ оплаты'] }); });
    logEvent('CHANGE', s.email, orgId, 'Автоплатёж: ' + (on ? 'вкл' : 'выкл'));
    return ok(true);
  } catch (e) { return fail(e); }
}
function adminSubscriptionCancel(token, orgId) {
  try {
    var s = requireRole(token, 'subs.edit'), sub = readAll('Subscriptions').filter(function (x) { return x['OrgID'] === orgId; }).reverse()[0];
    if (!sub) throw new Error('NOT_FOUND: подписка не найдена');
    withLock(function () { update('Subscriptions', sub['ID'], { 'Статус': 'CANCELLED', 'Автоплатеж': 'нет' }); });
    logEvent('CHANGE', s.email, orgId, 'Подписка отменена (действует до окончания оплаченного периода)');
    return ok(true);
  } catch (e) { return fail(e); }
}
/** Ежедневно: напоминания клиентам об окончании подписки (за 14, 7, 3, 1 день) и снимок аналитики. */
function dailyJob() {
  var today = isoDay(), orgs = readAll('Organizations');
  readAll('Subscriptions').forEach(function (sub) {
    var o = orgs.filter(function (x) { return x['ID'] === sub['OrgID']; })[0];
    if (!o || o['Статус'] !== 'ACTIVE' || sub['Статус'] === 'CANCELLED' || !sub['Окончание']) return;
    var left = daysBetween(today, isoDay(new Date(sub['Окончание'])));
    if ([14, 7, 3, 1].indexOf(left) >= 0 && o['Email']) {
      try {
        var t = tariff(sub['Тариф']) || {};
        MailApp.sendEmail({ to: o['Email'], name: 'ЦЕХ Стандарт', subject: 'Подписка ЦЕХ Стандарт заканчивается через ' + left + ' дн.',
          htmlBody: mailHtml_('Подписка заканчивается', 'Подписка на тариф ' + (t.name || sub['Тариф']) + ' действует до ' + fmtDate(sub['Окончание']) + '. Обслуживание — ' + money(t.monthly) + ' в месяц. Для продления свяжитесь с менеджером или оплатите счёт.') });
        logEvent('NOTIFY', 'система', o['ID'], 'Напоминание об окончании подписки (' + left + ' дн.)');
      } catch (e) { logError('dailyJob', e.message, o['ID']); }
    }
  });
  snapshotAnalytics_();
}
