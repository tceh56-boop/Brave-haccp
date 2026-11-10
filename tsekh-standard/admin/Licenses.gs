/**
 * ЦЕХ Стандарт Admin — лицензии.
 * Ключ — TS-XXXX-XXXX-XXXX (виден клиенту), секрет подписи — в свойствах скрипта LIC_SECRET_<ключ>.
 * Секрет показывается один раз при создании: клиент вводит ключ и секрет на экране «Подписка».
 * Ответ на проверку лицензии подписывается HMAC-SHA256(лицензия|nonce, секрет) — клиент проверяет подпись.
 */
function createLicense_(s, orgId, orgName, end) {
  var key = 'TS-' + randomToken(4) + '-' + randomToken(4) + '-' + randomToken(4), secret = randomToken(32);
  PropertiesService.getScriptProperties().setProperty('LIC_SECRET_' + key, secret);
  insert('Licenses', { 'License Key': key, 'OrgID': orgId, 'Организация': orgName, 'Статус': 'ACTIVE', 'Дата окончания': end, 'Устройств': 0, 'Создана': new Date(), 'Кто создал': s ? s.email : 'система' });
  update('Organizations', orgId, { 'License Key': key });
  return { key: key, secret: secret };
}
function adminLicenses(token, f) {
  try {
    requireRole(token, 'licenses.view'); f = f || {};
    var q = String(f.q || '').toLowerCase();
    return ok(readAll('Licenses').filter(function (l) { return (!f.status || f.status === 'ALL' || l['Статус'] === f.status) && (!q || JSON.stringify(l).toLowerCase().indexOf(q) >= 0); }).reverse());
  } catch (e) { return fail(e); }
}
function adminLicenseCreate(token, orgId) {
  try {
    var s = requireRole(token, 'licenses.edit'), o = findBy('Organizations', 'ID', orgId); if (!o) throw new Error('NOT_FOUND: клиент не найден');
    var lic = withLock(function () {
      readAll('Licenses').filter(function (l) { return l['OrgID'] === orgId && l['Статус'] === 'ACTIVE'; }).forEach(function (l) { update('Licenses', l['License Key'], { 'Статус': 'REVOKED' }); });
      return createLicense_(s, orgId, o['Название'], o['Окончание подписки'] || addMonths(new Date(), 1));
    });
    logEvent('LICENSE', s.email, orgId, 'Выпущена новая лицензия ' + lic.key + ' (прежние отозваны)');
    return ok(lic);
  } catch (e) { return fail(e); }
}
function adminLicenseSetStatus(token, key, status) {
  try {
    var s = requireRole(token, 'licenses.edit');
    if (['ACTIVE', 'BLOCKED', 'REVOKED'].indexOf(status) < 0) throw new Error('VALIDATION: статус ACTIVE, BLOCKED или REVOKED');
    withLock(function () { update('Licenses', key, { 'Статус': status }); });
    if (status === 'REVOKED') PropertiesService.getScriptProperties().deleteProperty('LIC_SECRET_' + key);
    logEvent('LICENSE', s.email, key, 'Статус лицензии: ' + status);
    return ok(true);
  } catch (e) { return fail(e); }
}
/** Продлить лицензию (и подписку клиента) на N месяцев без оплаты — например, бонус или ручная оплата. */
function adminLicenseExtend(token, key, months) {
  try {
    var s = requireRole(token, 'licenses.edit'), l = findBy('Licenses', 'License Key', key); if (!l) throw new Error('NOT_FOUND: лицензия не найдена');
    months = Math.max(1, Math.min(36, Number(months) || 1));
    var end = extendOrg_(l['OrgID'], months, 'Продление вручную (' + s.email + ')');
    logEvent('LICENSE', s.email, key, 'Продлена на ' + months + ' мес. до ' + fmtDate(end));
    return ok({ end: isoDay(end) });
  } catch (e) { return fail(e); }
}
/** Сдвинуть окончание подписки клиента на months (от текущего окончания, если оно в будущем). */
function extendOrg_(orgId, months, why) {
  return withLock(function () {
    var o = findBy('Organizations', 'ID', orgId), base = o['Окончание подписки'] && new Date(o['Окончание подписки']) > new Date() ? new Date(o['Окончание подписки']) : new Date();
    var end = addMonths(base, months);
    update('Organizations', orgId, { 'Окончание подписки': end, 'Статус': o['Статус'] === 'DELETED' ? 'DELETED' : 'ACTIVE' });
    readAll('Licenses').filter(function (l) { return l['OrgID'] === orgId && l['Статус'] !== 'REVOKED'; }).forEach(function (l) { update('Licenses', l['License Key'], { 'Дата окончания': end, 'Статус': 'ACTIVE' }); });
    var sub = readAll('Subscriptions').filter(function (x) { return x['OrgID'] === orgId; }).reverse()[0];
    if (sub) {
      var hist = []; try { hist = JSON.parse(sub['История'] || '[]'); } catch (e) {}
      hist.push({ at: isoDay(), months: months, end: isoDay(end), why: why });
      update('Subscriptions', sub['ID'], { 'Окончание': end, 'Статус': 'ACTIVE', 'Следующее списание': end, 'История': JSON.stringify(hist) });
    }
    return end;
  });
}
/** Проверка лицензии клиентом (вызывается из API.gs). Возвращает подписанный ответ. */
function licenseCheck_(p) {
  var key = String(p.key || ''), l = findBy('Licenses', 'License Key', key);
  var secret = PropertiesService.getScriptProperties().getProperty('LIC_SECRET_' + key);
  if (!l || !secret) return { ok: false, error: 'Лицензия не найдена или отозвана' };
  var o = findBy('Organizations', 'ID', l['OrgID']);
  var now = new Date(), end = l['Дата окончания'] ? new Date(l['Дата окончания']) : null;
  var status = l['Статус'] === 'ACTIVE' && o && o['Статус'] === 'ACTIVE' ? (end && end < now ? 'EXPIRED' : 'ACTIVE') : (l['Статус'] === 'REVOKED' ? 'BLOCKED' : 'BLOCKED');
  var cmds = o ? String(o['Команды'] || '').split(',').filter(Boolean) : [];
  var lastUpd = readAll('Updates').filter(function (u) { return u['Статус'] === 'PUBLISHED'; }).reverse()[0];
  var notices = getSetting('CLIENT_NOTICES', []);
  var license = { key: key, plan: o ? o['Тариф'] : 'basic', status: status, expiresAt: end ? end.getTime() : 0, org: o ? o['Название'] : '',
    message: status === 'BLOCKED' ? 'Лицензия заблокирована. Свяжитесь с поддержкой ЦЕХ Стандарт.' : '', commands: cmds, notices: notices,
    update: lastUpd && String(lastUpd['Версия']) !== String(p.version || '') ? { version: String(lastUpd['Версия']), notes: String(lastUpd['Описание'] || '').slice(0, 300) } : null };
  // учёт: последняя проверка, версия, статистика использования
  withLock(function () {
    update('Licenses', key, { 'Последняя проверка': now, 'Версия клиента': p.version || '', 'Активирована': l['Активирована'] || now, 'Устройств': 1, 'Последний IP': 'недоступен в Apps Script' });
    if (o) {
      var st = p.stats || {}, patch = { 'Последний вход': now, 'Версия': p.version || '', 'Сотрудников': st.staff || '', 'ТТК': st.ttk || '', 'Размер базы': st.rows || '', 'Команды': '' };
      if (p.scriptId) patch['Script ID'] = p.scriptId; if (p.appUrl) patch['App URL'] = p.appUrl;
      update('Organizations', o['ID'], patch);
      PropertiesService.getScriptProperties().setProperty('STATS_' + o['ID'], JSON.stringify(st).slice(0, 8000));
      if (st.lastBackup && st.lastBackup.fileId && !findBy('Backups', 'Drive File ID', st.lastBackup.fileId))
        insert('Backups', { 'ID': newId('BK'), 'Дата': new Date(st.lastBackup.at), 'OrgID': o['ID'], 'Клиент': o['Название'], 'Размер': st.lastBackup.size || '', 'Drive File ID': st.lastBackup.fileId, 'Ссылка': 'https://drive.google.com/file/d/' + st.lastBackup.fileId, 'Кто': 'клиент (по команде)', 'Статус': 'OK' });
    }
  });
  logEvent('LICENSE', 'клиент', key, 'Проверка лицензии: ' + status + ', версия ' + (p.version || '—'));
  return { ok: true, license: license, sig: hmac(JSON.stringify(license) + '|' + String(p.nonce || ''), secret) };
}
/** Подпись запроса клиента для служебных вызовов (база ТТК): HMAC(key|ts, секрет), ts не старше 10 минут. */
function verifyClient_(p) {
  var key = String(p.key || ''), secret = PropertiesService.getScriptProperties().getProperty('LIC_SECRET_' + key);
  if (!secret || Math.abs(Date.now() - Number(p.ts || 0)) > 600000 || !safeEqual(hmac(key + '|' + p.ts, secret), p.sig)) return null;
  var l = findBy('Licenses', 'License Key', key); if (!l || l['Статус'] !== 'ACTIVE') return null;
  return findBy('Organizations', 'ID', l['OrgID']);
}
