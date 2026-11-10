/**
 * ЦЕХ Стандарт Admin — авторизация администраторов и разграничение ролей.
 *
 * Вход: email + пароль. Пароль хранится как SHA-256 с солью и PASSWORD_ITER итерациями (лист Users),
 * сам пароль нигде не хранится. Сессия — случайный токен в CacheService на SESSION_TTL_MIN минут.
 * После LOGIN_MAX_FAILS неудачных попыток вход по этому email блокируется на 15 минут.
 * Роли: SUPER_ADMIN, MANAGER, SUPPORT, DEVELOPER (права — ROLES в Config.gs).
 */
function hashPassword(password, salt) {
  var h = String(salt) + '|' + String(password);
  for (var i = 0; i < PASSWORD_ITER; i++) h = sha256(h + '|' + salt);
  return h;
}
function adminLogin(email, password) {
  try {
    email = String(email || '').trim().toLowerCase();
    var cache = CacheService.getScriptCache(), fk = 'fail_' + sha256(email).slice(0, 24), fails = Number(cache.get(fk) || 0);
    if (fails >= LOGIN_MAX_FAILS) throw new Error('AUTH: слишком много попыток — вход заблокирован на 15 минут');
    var u = findBy('Users', 'Email', email);
    if (!u || u['Статус'] !== 'ACTIVE' || !safeEqual(hashPassword(password, u['Соль']), u['Хэш пароля'])) {
      cache.put(fk, String(fails + 1), 900);
      logEvent('LOGIN_FAIL', email, 'Users', 'Неверный email или пароль');
      throw new Error('AUTH: неверный email или пароль');
    }
    cache.remove(fk);
    var token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
    cache.put('sess_' + token, JSON.stringify({ email: email, name: u['Имя'], role: u['Роль'], at: Date.now() }), SESSION_TTL_MIN * 60);
    update('Users', email, { 'Последний вход': new Date() });
    logEvent('LOGIN', email, 'Users', 'Вход в админ-панель');
    return ok({ token: token, email: email, name: u['Имя'], role: u['Роль'], roleName: (ROLES[u['Роль']] || {}).name, can: (ROLES[u['Роль']] || {}).can || [] });
  } catch (e) { return fail(e); }
}
function adminLogout(token) { try { CacheService.getScriptCache().remove('sess_' + token); } catch (e) {} return ok(true); }
function session(token) {
  if (!token) throw new Error('AUTH: войдите в админ-панель');
  var raw = CacheService.getScriptCache().get('sess_' + token);
  if (!raw) throw new Error('AUTH: сессия истекла — войдите снова');
  var s = JSON.parse(raw);
  CacheService.getScriptCache().put('sess_' + token, raw, SESSION_TTL_MIN * 60);   // продление при активности
  return s;
}
function can(s, perm) { var r = ROLES[s.role]; return !!r && (r.can.indexOf('*') >= 0 || r.can.indexOf(perm) >= 0); }
/** Сессия + право. Бросает AUTH/FORBIDDEN. */
function requireRole(token, perm) {
  var s = session(token);
  if (perm && !can(s, perm)) throw new Error('FORBIDDEN: недостаточно прав (' + perm + ') для роли ' + ((ROLES[s.role] || {}).name || s.role));
  return s;
}
function adminMe(token) { try { var s = session(token); return ok({ email: s.email, name: s.name, role: s.role, roleName: (ROLES[s.role] || {}).name, can: (ROLES[s.role] || {}).can || [] }); } catch (e) { return fail(e); } }
function adminChangePassword(token, oldPwd, newPwd) {
  try {
    var s = session(token), u = findBy('Users', 'Email', s.email);
    if (!safeEqual(hashPassword(oldPwd, u['Соль']), u['Хэш пароля'])) throw new Error('VALIDATION: текущий пароль неверен');
    checkPasswordStrength(newPwd);
    var salt = Utilities.getUuid();
    withLock(function () { update('Users', s.email, { 'Хэш пароля': hashPassword(newPwd, salt), 'Соль': salt }); });
    logEvent('USER', s.email, s.email, 'Смена пароля');
    return ok(true);
  } catch (e) { return fail(e); }
}
function checkPasswordStrength(p) {
  p = String(p || '');
  if (p.length < 10 || !/[0-9]/.test(p) || !/[A-Za-zА-Яа-я]/.test(p)) throw new Error('VALIDATION: пароль — не короче 10 символов, буквы и цифры');
}
