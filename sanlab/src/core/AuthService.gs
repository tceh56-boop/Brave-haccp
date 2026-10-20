/**
 * San.Lab — AuthService.gs + AuditService
 * Идентификация, роли, права на действие и на конкретную запись, журнал аудита.
 * Принцип: скрытая кнопка — не защита. Каждый вызов API проходит Auth.check на сервере.
 */

var Auth = {
  /* Определить сотрудника по сессии. Integr.currentEmail(token) реализуется платформой. */
  resolve: function (token) {
    var email = V.str(Integr.currentEmail(token, Settings.get('AUTH_MODE'))).toLowerCase();
    if (!email) fail('AUTH_REQUIRED', 'Требуется вход в систему');
    var emp = Auth.byEmail(email);
    if (!emp) fail('ACCESS_DENIED', 'Учётная запись ' + email + ' не зарегистрирована в San.Lab. Обратитесь к администратору.');
    if (!V.bool(emp.active)) fail('ACCOUNT_DISABLED', 'Учётная запись отключена. Новые действия запрещены.');
    return emp;
  },

  byEmail: function (email) {
    var list = Store.all('Employees');
    for (var i = 0; i < list.length; i++) if (V.str(list[i].email).toLowerCase() === email) return list[i];
    return null;
  },

  extraActions: function (user) {
    var out = [], ex = csvList(user.extra_perms);
    for (var i = 0; i < ex.length; i++) if (EXTRA_PERMS[ex[i]]) out = out.concat(EXTRA_PERMS[ex[i]]);
    if (user.role === 'COORDINATOR' && Settings.bool('COORDINATOR_FINANCE_ACCESS')) out = out.concat(EXTRA_PERMS.finance);
    return out;
  },

  can: function (user, action) {
    var roles = PERMS[action];
    if (!roles) return false;
    if (roles.indexOf('*') >= 0 || roles.indexOf(user.role) >= 0) return true;
    return Auth.extraActions(user).indexOf(action) >= 0;
  },

  check: function (user, action) {
    if (!Auth.can(user, action)) denied('Недостаточно прав для действия «' + action + '»');
  },

  isAdminLike: function (user) { return user.role === 'OWNER' || user.role === 'COORDINATOR'; },

  /* ---------- Доступ к выезду ---------- */
  canSeeVisit: function (user, v) {
    if (!v) return false;
    if (Auth.isAdminLike(user)) return true;
    if (user.role === 'SPECIALIST') return v.employee_id === user.employee_id;
    if (user.role === 'QC' || Auth.extraActions(user).indexOf('reports.approve') >= 0) {
      if (v.report_id || ['IN_REVIEW', 'RETURNED', 'APPROVED', 'CLOSED'].indexOf(v.status) >= 0) return true;
    }
    if (user.role === 'LAB' || user.role === 'QC') {
      var s = Repo.where('LabSamples', function (x) { return x.visit_id === v.visit_id; });
      if (s.length) return true;
    }
    return false;
  },
  visit: function (user, visitId) {
    var v = Repo.get('Visits', visitId);
    /* Не раскрываем, существует ли запись: одинаковый ответ для «нет» и «нельзя» (AT-03) */
    if (!v || !Auth.canSeeVisit(user, v)) notFound('Выезд');
    return v;
  },
  visitWrite: function (user, visitId) {
    var v = Auth.visit(user, visitId);
    if (user.role === 'SPECIALIST' && v.employee_id !== user.employee_id) notFound('Выезд');
    if (['QC', 'LAB', 'FINANCE'].indexOf(user.role) >= 0) denied('Роль не может изменять результаты выезда');
    return v;
  },

  /* Объекты, которые пользователь вправе видеть */
  visibleSiteIds: function (user) {
    if (Auth.isAdminLike(user) || user.role === 'FINANCE') return null; // null = все
    var ids = {};
    var visits = Store.all('Visits');
    for (var i = 0; i < visits.length; i++) if (Auth.canSeeVisit(user, visits[i])) ids[visits[i].site_id] = true;
    if (user.role === 'LAB') {
      var s = Store.all('LabSamples');
      for (var j = 0; j < s.length; j++) ids[s[j].site_id] = true;
    }
    return ids;
  },

  /* ---------- PIN-режим (если Workspace недоступен) ---------- */
  login: function (email, pin) {
    email = V.str(email).toLowerCase();
    var lockKey = 'lock_' + email, triesKey = 'tries_' + email;
    if (Integr.cacheGet(lockKey)) fail('LOCKED', 'Слишком много попыток. Повторите через 15 минут.');
    var emp = Auth.byEmail(email);
    var ok = emp && V.bool(emp.active) && emp.pin_hash && emp.pin_hash === Integr.hash(email + ':' + V.str(pin));
    if (!ok) {
      var tries = Number(Integr.cacheGet(triesKey) || 0) + 1;
      Integr.cachePut(triesKey, String(tries), 900);
      if (tries >= 5) Integr.cachePut(lockKey, '1', 900);
      fail('AUTH_FAILED', 'Неверный e-mail или PIN-код' + (tries >= 3 && tries < 5 ? '. Осталось попыток: ' + (5 - tries) : ''));
    }
    Integr.cachePut(triesKey, '0', 1);
    var token = uuid();
    Integr.cachePut('sess_' + token, email, 21600);
    return { token: token };
  }
};

/* ---------- Журнал аудита (раздел 14.1 ТЗ) ---------- */
var Audit = {
  log: function (ctx, action, entityType, entityId, oldV, newV) {
    Store.insert('AuditLog', {
      log_id: Repo.newId('AuditLog'),
      timestamp: ctx.now,
      actor_email: ctx.actorEmail || 'system',
      actor_id: ctx.actorId || 'SYSTEM',
      action: action,
      entity_type: entityType,
      entity_id: entityId,
      old_value: shortJson(oldV),
      new_value: shortJson(newV),
      request_id: ctx.requestId || ''
    });
  },

  list: function (ctx, p) {
    var u = ctx.user;
    var rows = Store.all('AuditLog');
    /* Ограниченный доступ по роли (карта окон, раздел 2 инструкции) */
    var allowTypes = null;
    if (u.role === 'QC') allowTypes = ['Reports', 'Visits', 'VisitResults', 'Tasks', 'Documents'];
    if (u.role === 'LAB') allowTypes = ['LabSamples', 'Documents', 'Tasks'];
    if (u.role === 'FINANCE') allowTypes = ['Finance', 'Contracts', 'Clients'];
    if (u.role === 'COORDINATOR') allowTypes = ['Clients', 'Sites', 'Contracts', 'Visits', 'Tasks', 'LabSamples'];
    var q = V.str(p.q).toLowerCase();
    var out = filterBy(rows, function (r) {
      if (allowTypes && allowTypes.indexOf(r.entity_type) < 0) return false;
      if (p.entity_id && r.entity_id !== p.entity_id) return false;
      if (p.entity_type && r.entity_type !== p.entity_type) return false;
      if (p.from && isBefore(r.timestamp, p.from)) return false;
      if (q && (r.entity_id + ' ' + r.action + ' ' + r.actor_email + ' ' + r.new_value).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    out = sortBy(out, 'timestamp', true);
    return { total: out.length, rows: out.slice(0, Number(p.limit) || 300) };
  }
};

/* ---------- Ошибки системы ---------- */
var Errors = {
  record: function (ctx, fnName, code, safeMessage, details, entityId) {
    try {
      Store.insert('SystemErrors', {
        error_id: Repo.newId('SystemErrors'), timestamp: ctx.now, function_name: fnName,
        request_id: ctx.requestId || '', error_code: code, safe_message: safeMessage,
        details: String(details || '').slice(0, 2000), entity_id: entityId || '', resolved_status: 'OPEN'
      });
    } catch (e) { /* журнал ошибок не должен ронять операцию */ }
  },
  list: function (ctx, p) {
    var rows = Store.all('SystemErrors');
    if (!p.all) rows = filterBy(rows, function (r) { return r.resolved_status !== 'RESOLVED'; });
    return sortBy(rows, 'timestamp', true).slice(0, 200);
  },
  resolve: function (ctx, p) {
    var e = Store.get('SystemErrors', p.error_id);
    if (!e) notFound('Ошибка');
    Store.update('SystemErrors', p.error_id, { resolved_status: 'RESOLVED', resolved_by: ctx.actorId, resolved_at: ctx.now });
    Audit.log(ctx, 'ERROR_RESOLVE', 'SystemErrors', p.error_id, null, { resolved_status: 'RESOLVED' });
    return { ok: true };
  }
};
