/**
 * ЦЕХ Стандарт Admin — дашборд и аналитика: MRR, ARR, LTV, Churn, новые/ушедшие, средний чек, графики.
 *   MRR  — сумма «обслуживания в месяц» по активным (неистёкшим, не отменённым) подпискам;
 *   ARR  — MRR × 12;
 *   Churn — доля клиентов, чья подписка истекла (и не продлена) за последние 30 дней, от активных на начало периода;
 *   LTV  — средний доход с клиента (сумма оплат / число клиентов, плативших хоть раз);
 *   Средний чек — средняя сумма оплаченного платежа.
 */
function metrics_() {
  var today = isoDay(), now = new Date(), orgs = readAll('Organizations').filter(function (o) { return o['Статус'] !== 'DELETED'; });
  var subs = {}; readAll('Subscriptions').forEach(function (s) { subs[s['OrgID']] = s; });
  var pays = readAll('Payments'), paid = pays.filter(function (p) { return p['Статус'] === 'PAID'; });
  var mrr = 0, active = 0, expiring = 0, expiredRecent = 0;
  orgs.forEach(function (o) {
    var s = subs[o['ID']], end = o['Окончание подписки'] ? isoDay(new Date(o['Окончание подписки'])) : '';
    var live = o['Статус'] === 'ACTIVE' && end && end >= today;
    if (live) { active++; if (s && s['Статус'] !== 'CANCELLED') mrr += Number(s['Обслуживание в месяц']) || 0; if (daysBetween(today, end) <= EXPIRING_DAYS) expiring++; }
    if (end && end < today && daysBetween(end, today) <= 30) expiredRecent++;
  });
  var month = today.slice(0, 7), year = today.slice(0, 4);
  var sum = function (arr) { return arr.reduce(function (a, p) { return a + (Number(p['Сумма']) || 0); }, 0); };
  var payers = {}; paid.forEach(function (p) { payers[p['OrgID']] = true; });
  return {
    total: orgs.length, active: active, blocked: orgs.filter(function (o) { return o['Статус'] === 'BLOCKED'; }).length, expiring: expiring,
    newToday: orgs.filter(function (o) { return o['Дата регистрации'] && isoDay(new Date(o['Дата регистрации'])) === today; }).length,
    newMonth: orgs.filter(function (o) { return o['Дата регистрации'] && isoDay(new Date(o['Дата регистрации'])).slice(0, 7) === month; }).length,
    churned: expiredRecent,
    incomeMonth: sum(paid.filter(function (p) { return isoDay(new Date(p['Дата'])).slice(0, 7) === month; })),
    incomeYear: sum(paid.filter(function (p) { return isoDay(new Date(p['Дата'])).slice(0, 4) === year; })),
    expected: sum(pays.filter(function (p) { return p['Статус'] === 'PENDING'; })),
    licenses: readAll('Licenses').filter(function (l) { return l['Статус'] === 'ACTIVE'; }).length,
    errors: readAll('Errors').filter(function (e) { return daysBetween(new Date(e['Дата']), now) <= 7; }).length,
    backups: readAll('Backups').filter(function (b) { return daysBetween(new Date(b['Дата']), now) <= 7; }).length,
    mrr: mrr, arr: mrr * 12,
    churnRate: active + expiredRecent ? Math.round(expiredRecent / (active + expiredRecent) * 1000) / 10 : 0,
    ltv: Object.keys(payers).length ? Math.round(sum(paid) / Object.keys(payers).length) : 0,
    avgCheck: paid.length ? Math.round(sum(paid) / paid.length) : 0
  };
}
/** Ряд по дням за N дней: регистрации, оплаты, активность (проверки лицензий). */
function series_(days) {
  var out = [], idx = {}, now = new Date();
  for (var i = days - 1; i >= 0; i--) { var d = isoDay(new Date(now.getTime() - i * 864e5)); idx[d] = out.length; out.push({ day: d, reg: 0, pay: 0, active: 0, logins: 0, clients: 0 }); }
  readAll('Organizations').forEach(function (o) { var d = o['Дата регистрации'] ? isoDay(new Date(o['Дата регистрации'])) : ''; if (idx[d] !== undefined) out[idx[d]].reg++; });
  readAll('Payments').forEach(function (p) { if (p['Статус'] !== 'PAID') return; var d = isoDay(new Date(p['Дата'])); if (idx[d] !== undefined) out[idx[d]].pay += Number(p['Сумма']) || 0; });
  readAll('Logs').forEach(function (l) { var d = String(l['Дата']).slice(0, 10); if (idx[d] === undefined) return; if (l['Тип'] === 'LICENSE') out[idx[d]].active++; if (l['Тип'] === 'LOGIN') out[idx[d]].logins++; });
  var snaps = {}; readAll('Analytics').forEach(function (a) { snaps[String(a['Дата']).slice(0, 10)] = Number(a['Клиентов']) || 0; });
  var run = 0, first = out.length ? out[0].day : '';
  readAll('Organizations').forEach(function (o) { if (o['Дата регистрации'] && isoDay(new Date(o['Дата регистрации'])) < first) run++; });
  out.forEach(function (r) { run += r.reg; r.clients = snaps[r.day] || run; });
  return out;
}
function adminDashboard(token) {
  try { requireRole(token, 'dashboard'); return ok({ m: metrics_(), series: series_(30), tariffs: tariffs() }); } catch (e) { return fail(e); }
}
function adminAnalytics(token) {
  try {
    requireRole(token, 'analytics');
    var m = metrics_(), byPlan = {}, orgs = readAll('Organizations').filter(function (o) { return o['Статус'] === 'ACTIVE'; });
    orgs.forEach(function (o) { byPlan[o['Тариф']] = (byPlan[o['Тариф']] || 0) + 1; });
    // самые используемые функции и активные организации — по данным проверок лицензий (статистика клиента)
    var props = PropertiesService.getScriptProperties(), activity = orgs.map(function (o) {
      var st = {}; try { st = JSON.parse(props.getProperty('STATS_' + o['ID']) || '{}'); } catch (e) {}
      return { org: o['Название'], plan: o['Тариф'], rows: Number(st.rows) || 0, ttk: Number(st.ttk) || 0, staff: Number(st.staff) || 0, lastSeen: o['Последний вход'] };
    }).sort(function (a, b) { return b.rows - a.rows; }).slice(0, 15);
    var features = {}; orgs.forEach(function (o) { var t = tariff(o['Тариф']); (t && t.features || []).forEach(function (f) { if (!/^Всё из/.test(f)) features[f] = (features[f] || 0) + 1; }); });
    return ok({ m: m, byPlan: byPlan, activity: activity, features: Object.keys(features).map(function (k) { return { name: k, orgs: features[k] }; }).sort(function (a, b) { return b.orgs - a.orgs; }), series: series_(90) });
  } catch (e) { return fail(e); }
}
function snapshotAnalytics_() {
  try {
    var m = metrics_(), today = isoDay();
    if (readAll('Analytics').some(function (a) { return String(a['Дата']).slice(0, 10) === today; })) return;
    var dayIncome = readAll('Payments').filter(function (p) { return p['Статус'] === 'PAID' && isoDay(new Date(p['Дата'])) === today; }).reduce(function (a, p) { return a + Number(p['Сумма']); }, 0);
    insert('Analytics', { 'Дата': today, 'Клиентов': m.total, 'Активных': m.active, 'Новых': m.newToday, 'Ушедших': m.churned, 'MRR': m.mrr, 'ARR': m.arr, 'Выручка за день': dayIncome });
  } catch (e) { logError('analytics', e.message, e.stack); }
}
