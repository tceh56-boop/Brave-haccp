/**
 * ЦЕХ Стандарт Admin — администраторы панели (лист Users). Управляет только Super Admin.
 */
function adminUsersList(token) {
  try {
    requireRole(token, 'users');
    return ok(readAll('Users').map(function (u) { return { email: u['Email'], name: u['Имя'], role: u['Роль'], status: u['Статус'], lastLogin: u['Последний вход'], created: u['Создан'] }; }));
  } catch (e) { return fail(e); }
}
/** Создать администратора: возвращает временный пароль (показывается один раз). */
function adminUserCreate(token, u) {
  try {
    var s = requireRole(token, 'users'); u = u || {}; req(u, ['email', 'name', 'role']);
    var email = String(u.email).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('VALIDATION: неверный email');
    if (!ROLES[u.role]) throw new Error('VALIDATION: неизвестная роль');
    var pwd = randomToken(6) + '-' + randomToken(6), salt = Utilities.getUuid();
    withLock(function () {
      if (findBy('Users', 'Email', email)) throw new Error('VALIDATION: администратор с таким email уже есть');
      insert('Users', { 'Email': email, 'Имя': u.name, 'Роль': u.role, 'Статус': 'ACTIVE', 'Хэш пароля': hashPassword(pwd, salt), 'Соль': salt, 'Создан': new Date() });
    });
    logEvent('USER', s.email, email, 'Создан администратор, роль ' + u.role);
    return ok({ email: email, password: pwd });
  } catch (e) { return fail(e); }
}
function adminUserUpdate(token, email, patch) {
  try {
    var s = requireRole(token, 'users'); patch = patch || {};
    if (String(email) === s.email && patch.status && patch.status !== 'ACTIVE') throw new Error('VALIDATION: нельзя заблокировать себя');
    var p = {}; if (patch.role) { if (!ROLES[patch.role]) throw new Error('VALIDATION: неизвестная роль'); p['Роль'] = patch.role; }
    if (patch.status) p['Статус'] = patch.status === 'ACTIVE' ? 'ACTIVE' : 'BLOCKED'; if (patch.name) p['Имя'] = patch.name;
    withLock(function () { update('Users', email, p); });
    logEvent('USER', s.email, email, 'Изменён: ' + JSON.stringify(p));
    return ok(true);
  } catch (e) { return fail(e); }
}
function adminUserResetPassword(token, email) {
  try {
    var s = requireRole(token, 'users'), pwd = randomToken(6) + '-' + randomToken(6), salt = Utilities.getUuid();
    withLock(function () { update('Users', email, { 'Хэш пароля': hashPassword(pwd, salt), 'Соль': salt }); });
    logEvent('USER', s.email, email, 'Сброс пароля');
    return ok({ email: email, password: pwd });
  } catch (e) { return fail(e); }
}
