/**
 * ЦЕХ Стандарт Admin — лицензии.
 * Ключ — TS-XXXX-XXXX-XXXX (виден клиенту один раз). В таблице ключ в открытом виде НЕ хранится (ТЗ 2.0 §10):
 * колонка «License Key» содержит SHA-256 ключа (идентификатор записи), «Маска ключа» — TS-AB12-****-**34.
 * Секрет подписи — в свойствах скрипта LIC_SECRET_<хеш ключа>. Ключ и секрет показываются один раз при создании.
 * Ответ на проверку подписывается HMAC-SHA256(лицензия|nonce, секрет); повтор nonce отклоняется.
 */
function licHash_(key) { return sha256('TSLIC|' + String(key || '').trim().toUpperCase()); }
function licMask_(key) { key = String(key || ''); return key.length < 8 ? '****' : key.slice(0, 7) + '-****-**' + key.slice(-2); }
/** Запись лицензии по ключу клиента. Старые записи с открытым ключом переводятся на хеш при первом обращении. */
function licFind_(key) {
  var h = licHash_(key), l = findBy('Licenses', 'License Key', h), P = PropertiesService.getScriptProperties();
  if (l) return { row: l, id: h, secret: P.getProperty('LIC_SECRET_' + h) };
  var old = findBy('Licenses', 'License Key', String(key || '').trim());
  if (!old) return null;
  var sec = P.getProperty('LIC_SECRET_' + old['License Key']);
  withLock(function () {
    update('Licenses', old['License Key'], { 'License Key': h, 'Маска ключа': licMask_(key) });
    if (sec) { P.setProperty('LIC_SECRET_' + h, sec); P.deleteProperty('LIC_SECRET_' + old['License Key']); }
    var o = findBy('Organizations', 'ID', old['OrgID']); if (o && o['License Key'] === String(key).trim()) update('Organizations', o['ID'], { 'License Key': licMask_(key) });
  });
  return { row: findBy('Licenses', 'License Key', h), id: h, secret: sec };
}
function enterpriseIdOf_(o) {
  if (!o) return '';
  if (o['EnterpriseID']) return String(o['EnterpriseID']);
  var id = 'ENT-' + String(o['ID']).replace(/^ORG-?/, '');
  try { withLock(function () { update('Organizations', o['ID'], { 'EnterpriseID': id }); }); } catch (e) {}
  return id;
}
function createLicense_(s, orgId, orgName, end) {
  var key = 'TS-' + randomToken(4) + '-' + randomToken(4) + '-' + randomToken(4), secret = randomToken(32), h = licHash_(key);
  PropertiesService.getScriptProperties().setProperty('LIC_SECRET_' + h, secret);
  var o = findBy('Organizations', 'ID', orgId);
  insert('Licenses', { 'License Key': h, 'OrgID': orgId, 'Организация': orgName, 'Статус': 'ACTIVE', 'Дата окончания': end, 'Устройств': 0, 'Создана': new Date(), 'Кто создал': s ? s.email : 'система',
    'Маска ключа': licMask_(key), 'EnterpriseID': enterpriseIdOf_(o) });
  update('Organizations', orgId, { 'License Key': licMask_(key) });
  return { key: key, secret: secret, masked: licMask_(key) };
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
    if (status === 'REVOKED') PropertiesService.getScriptProperties().deleteProperty('LIC_SECRET_' + key);   // key здесь — идентификатор записи (хеш)
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
  var key = String(p.key || ''), f = licFind_(key);
  if (!f || !f.row || !f.secret) return { ok: false, error: 'Лицензия не найдена или отозвана' };
  var nonce = String(p.nonce || '');
  if (nonce.length < 16) return { ok: false, error: 'Запрос без одноразового nonce не принимается' };
  var cache = CacheService.getScriptCache(), nk = 'nonce_' + sha256(f.id + '|' + nonce).slice(0, 40);
  if (cache.get(nk)) { logError('license', 'повтор nonce отклонён', f.row['Маска ключа'] || ''); return { ok: false, error: 'REPLAY: повторный запрос отклонён' }; }
  cache.put(nk, '1', NONCE_TTL_SEC);
  var l = f.row, o = findBy('Organizations', 'ID', l['OrgID']), ent = enterpriseIdOf_(o);
  var now = new Date(), end = l['Дата окончания'] ? new Date(l['Дата окончания']) : null, graceEnd = end ? new Date(end.getTime() + LICENSE_GRACE_DAYS * 864e5) : null;
  var status = l['Статус'] === 'ACTIVE' && o && o['Статус'] === 'ACTIVE' ? (end && end < now ? (graceEnd > now ? 'GRACE' : 'EXPIRED') : 'ACTIVE') : 'BLOCKED';
  var cmds = o ? String(o['Команды'] || '').split(',').filter(Boolean) : [];
  var channel = o && o['Канал обновлений'] === 'pilot' ? 'pilot' : 'stable', rel = latestRelease_(channel);
  var notices = getSetting('CLIENT_NOTICES', []);
  var plan = o ? o['Тариф'] : 'basic', t = tariff(plan) || {};
  var license = { key: key, enterpriseId: ent, plan: plan, status: status, expiresAt: end ? end.getTime() : 0, graceUntil: graceEnd ? graceEnd.getTime() : 0, org: o ? o['Название'] : '',
    features: planFeatures_(plan), limits: t.limits || {}, channel: channel,
    message: status === 'BLOCKED' ? 'Лицензия заблокирована. Свяжитесь с поддержкой ЦЕХ Стандарт.' : status === 'GRACE' ? 'Подписка закончилась ' + fmtDate(end) + '. Работа сохранится до ' + fmtDate(graceEnd) + ' — продлите подписку.' : '',
    commands: cmds, notices: notices, supportRequests: o ? supportRequestsFor_(o['ID']) : [],
    update: rel && String(rel.version) !== String(p.version || '') ? { version: String(rel.version), channel: channel, notes: String(rel.notes || '').slice(0, 300) } : null };
  withLock(function () {
    update('Licenses', f.id, { 'Последняя проверка': now, 'Версия клиента': p.version || '', 'Активирована': l['Активирована'] || now, 'Устройств': 1, 'Последний IP': 'недоступен в Apps Script', 'EnterpriseID': ent });
    if (o) {
      var st = p.stats || {}, patch = { 'Последний вход': now, 'Версия': p.version || '', 'Сотрудников': st.staff || '', 'ТТК': st.ttk || '', 'Размер базы': st.rows || '', 'Команды': '' };
      if (p.scriptId) patch['Script ID'] = p.scriptId; if (p.appUrl) patch['App URL'] = p.appUrl;
      update('Organizations', o['ID'], patch);
      PropertiesService.getScriptProperties().setProperty('STATS_' + o['ID'], JSON.stringify(st).slice(0, 8000));
      if (st.lastBackup && st.lastBackup.fileId && !findBy('Backups', 'Drive File ID', st.lastBackup.fileId)) {
        insert('Backups', { 'ID': newId('BK'), 'Дата': new Date(st.lastBackup.at), 'OrgID': o['ID'], 'Клиент': o['Название'], 'Размер': st.lastBackup.size || '', 'Drive File ID': st.lastBackup.fileId, 'Ссылка': 'https://drive.google.com/file/d/' + st.lastBackup.fileId, 'Кто': 'клиент (по команде)', 'Статус': 'OK' });
        confirmUpdateBackups_(o['ID'], st.lastBackup.at);
      }
    }
  });
  logEvent('LICENSE', 'клиент', l['Маска ключа'] || f.id.slice(0, 12), 'Проверка лицензии: ' + status + ', версия ' + (p.version || '—'));
  return { ok: true, license: license, sig: hmac(JSON.stringify(license) + '|' + nonce, f.secret) };
}
/** Возможности тарифа (накопительно): коды совпадают с клиентским TS_PLANS_. */
var PLAN_FEATURES_ = { basic: ['ttk', 'shelf_life', 'kbju', 'storage', 'costing', 'receiving', 'labeling', 'economics', 'labor_safety', 'core'], basic_pro: ['journals', 'ppk'], pro: ['batches', 'lab', 'contracts'], pro_max: ['ai', 'ttk_library'] };
function planFeatures_(plan) {
  var order = ['basic', 'basic_pro', 'pro', 'pro_max'], i = Math.max(0, order.indexOf(plan)), out = [];
  for (var k = 0; k <= i; k++) out = out.concat(PLAN_FEATURES_[order[k]]);
  return out;
}
/** Подпись запроса клиента для служебных вызовов: HMAC(key|ts, секрет), ts не старше 10 минут, повтор подписи отклоняется. */
/** Каноническая запись тела запроса для подписи v2 (ключи по алфавиту, без поля sig) — как в TS_TenantBootstrap.gs. */
function canonicalJson_(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson_).join(',') + ']';
  return '{' + Object.keys(v).filter(function (k) { return v[k] !== undefined; }).sort().map(function (k) { return JSON.stringify(k) + ':' + canonicalJson_(v[k]); }).join(',') + '}';
}
// Действия, где подпись обязана покрывать тело запроса (v2): подмена параметров при перехвате недопустима.
var SIG_V2_REQUIRED_ = ['tenant.bootstrap'];
/**
 * Подпись запроса системы клиента.
 *   v1: HMAC(key|ts) — прежние системы клиентов (проверка лицензии, статистика);
 *   v2: HMAC(key|ts|canonical(тело без sig)) — тело защищено; обязательно для SIG_V2_REQUIRED_.
 */
function verifyClient_(p) {
  var f = licFind_(p.key); if (!f || !f.secret) return null;
  if (Math.abs(Date.now() - Number(p.ts || 0)) > 600000) return null;
  var v2 = Number(p.sigV) === 2;
  if (!v2 && SIG_V2_REQUIRED_.indexOf(String(p.action || '')) >= 0) return null;
  var body = {}; if (v2) Object.keys(p).forEach(function (k) { if (k !== 'sig') body[k] = p[k]; });
  var expected = v2 ? hmac(String(p.key) + '|' + p.ts + '|' + canonicalJson_(body), f.secret) : hmac(String(p.key) + '|' + p.ts, f.secret);
  if (!safeEqual(expected, p.sig)) return null;
  var cache = CacheService.getScriptCache(), rk = 'sig_' + String(p.sig).slice(0, 40) + '_' + String(p.action || '');
  if (cache.get(rk)) return null; cache.put(rk, '1', 900);
  if (!f.row || f.row['Статус'] !== 'ACTIVE') return null;
  return findBy('Organizations', 'ID', f.row['OrgID']);
}
