/**
 * San.Lab — Api.gs
 * Единая точка входа: аутентификация → права → идемпотентность → блокировка → бизнес-правило → ответ.
 * Ответ всегда: { ok, data | code+message, request_id }. Стек ошибок пользователю не отдаётся (13.2 ТЗ).
 */

var ROUTES = {
  'auth.me': function (ctx) {
    var u = ctx.user;
    var menu = (ROLE_MENU[u.role] || []).slice();
    if (Auth.can(u, 'finance.list') && menu.indexOf('finance') < 0) menu.splice(Math.min(menu.length, 6), 0, 'finance');
    if (Auth.can(u, 'reports.queue') && menu.indexOf('review') < 0) menu.splice(2, 0, 'review');
    return { employee_id: u.employee_id, full_name: u.full_name, email: u.email, role: u.role, role_label: ROLES[u.role], menu: menu, version: APP_VERSION, company: Settings.get('COMPANY_NAME') };
  },
  'lookups.get': function (ctx) { return Lookups.get(ctx); },
  'dashboard.get': function (ctx, p) { return Dashboard.get(ctx, p); },
  'analytics.get': function (ctx, p) { return Dashboard.analytics(ctx, p); },
  'notifications.mine': function (ctx) { return Notify.mine(ctx); },
  'notifications.read': function (ctx, p) { return Notify.read(ctx, p); },

  'clients.list': function (ctx, p) { return Clients.list(ctx, p); },
  'clients.get': function (ctx, p) { return Clients.get(ctx, p); },
  'clients.save': function (ctx, p) { return Clients.save(ctx, p); },
  'clients.archive': function (ctx, p) { return Clients.archive(ctx, p); },
  'sites.save': function (ctx, p) { return Sites.save(ctx, p); },
  'sites.archive': function (ctx, p) { return Sites.archive(ctx, p); },
  'contracts.save': function (ctx, p) { return Contracts.save(ctx, p); },
  'services.list': function (ctx) { return Services.list(ctx); },
  'services.save': function (ctx, p) { return Services.save(ctx, p); },
  'employees.list': function (ctx) { return Employees.list(ctx); },
  'employees.save': function (ctx, p) { return Employees.save(ctx, p); },
  'employees.setActive': function (ctx, p) { return Employees.setActive(ctx, p); },

  'visits.list': function (ctx, p) { return Visits.list(ctx, p); },
  'visits.get': function (ctx, p) { return Visits.get(ctx, p); },
  'visits.create': function (ctx, p) { return Visits.create(ctx, p); },
  'visits.reschedule': function (ctx, p) { return Visits.reschedule(ctx, p); },
  'visits.cancel': function (ctx, p) { return Visits.cancel(ctx, p); },
  'visits.start': function (ctx, p) { return Visits.start(ctx, p); },
  'visits.finish': function (ctx, p) { return Visits.finish(ctx, p); },
  'visits.close': function (ctx, p) { return Visits.close(ctx, p); },
  'visits.retryCalendar': function (ctx, p) { return Visits.retryCalendar(ctx, p); },

  'checklists.list': function (ctx) { return Checklists.list(ctx); },
  'checklists.get': function (ctx, p) { return Checklists.get(ctx, p); },
  'checklists.saveVersion': function (ctx, p) { return Checklists.saveVersion(ctx, p); },
  'results.save': function (ctx, p) { return Results.save(ctx, p); },
  'results.waivePhoto': function (ctx, p) { return Results.waivePhoto(ctx, p); },

  'files.upload': function (ctx, p) { return Files.upload(ctx, p); },
  'files.get': function (ctx, p) { return Files.get(ctx, p); },
  'files.invalidate': function (ctx, p) { return Files.invalidate(ctx, p); },
  'documents.list': function (ctx, p) { return Documents.list(ctx, p); },

  'reports.preview': function (ctx, p) { return Reports.preview(ctx, p); },
  'reports.submit': function (ctx, p) { return Reports.submit(ctx, p); },
  'reports.queue': function (ctx, p) { return Reports.queue(ctx, p); },
  'reports.get': function (ctx, p) { return Reports.get(ctx, p); },
  'reports.approve': function (ctx, p) { return Reports.approve(ctx, p); },
  'reports.return': function (ctx, p) { return Reports['return'](ctx, p); },
  'reports.html': function (ctx, p) {
    var r = Repo.must('Reports', p.report_id, 'Отчёт');
    Auth.visit(ctx.user, r.visit_id);
    return { html: ReportHtml.render(ctx, r) };
  },

  'lab.list': function (ctx, p) { return Lab.list(ctx, p); },
  'lab.register': function (ctx, p) { return Lab.register(ctx, p); },
  'lab.advance': function (ctx, p) { return Lab.advance(ctx, p); },
  'lab.review': function (ctx, p) { return Lab.review(ctx, p); },
  'lab.cancel': function (ctx, p) { return Lab.cancel(ctx, p); },

  'tasks.list': function (ctx, p) { return Tasks.list(ctx, p); },
  'tasks.create': function (ctx, p) { return Tasks.create(ctx, p); },
  'tasks.start': function (ctx, p) { return Tasks.start(ctx, p); },
  'tasks.submit': function (ctx, p) { return Tasks.submit(ctx, p); },
  'tasks.close': function (ctx, p) { return Tasks.close(ctx, p); },
  'tasks.verify': function (ctx, p) { return Tasks.verify(ctx, p); },
  'tasks.reject': function (ctx, p) { return Tasks.reject(ctx, p); },
  'tasks.cancel': function (ctx, p) { return Tasks.cancel(ctx, p); },

  'finance.list': function (ctx, p) { return Finance.list(ctx, p); },
  'finance.summary': function (ctx, p) { return Finance.summary(ctx, p); },
  'finance.accrue': function (ctx, p) { return Finance.accrue(ctx, p); },
  'finance.invoice': function (ctx, p) { return Finance.invoice(ctx, p); },
  'finance.payment': function (ctx, p) { return Finance.payment(ctx, p); },
  'finance.expense': function (ctx, p) { return Finance.expense(ctx, p); },
  'finance.adjust': function (ctx, p) { return Finance.adjust(ctx, p); },
  'finance.approveAdjustment': function (ctx, p) { return Finance.approveAdjustment(ctx, p); },

  'audit.list': function (ctx, p) { return Audit.list(ctx, p); },
  'settings.get': function (ctx) { return { settings: Settings.list(), checklists: Checklists.list(ctx), services: Services.list(ctx) }; },
  'settings.save': function (ctx, p) { return Settings.save(ctx, p); },
  'errors.list': function (ctx, p) { return Errors.list(ctx, p); },
  'errors.resolve': function (ctx, p) { return Errors.resolve(ctx, p); },
  'jobs.run': function (ctx, p) { return p.job === 'frequent' ? Jobs.frequent(ctx) : Jobs.daily(ctx); }
};

/* Чтение — без блокировки и без записи в Requests */
function isReadAction(action) { return /\.(list|get|me|mine|queue|summary|preview|html)$/.test(action); }

var Api = {
  handle: function (action, payload, token, requestId) {
    var ctx = { now: Integr.now(), requestId: requestId || uuid(), actorId: '', actorEmail: '' };
    try {
      Settings.reset();
      if (action === 'auth.login') return Api.ok(ctx, Auth.login(payload.email, payload.pin));
      if (action === 'auth.mode') return Api.ok(ctx, { mode: Settings.get('AUTH_MODE'), company: Settings.get('COMPANY_NAME') });
      var route = ROUTES[action];
      if (!route) fail('NOT_FOUND', 'Неизвестное действие');
      var user = Auth.resolve(token);
      ctx.user = user; ctx.actorId = user.employee_id; ctx.actorEmail = user.email;
      Auth.check(user, action);
      var p = payload || {};
      if (isReadAction(action)) return Api.ok(ctx, route(ctx, p));
      return Integr.withLock(function () {
        Store.beginBatch && Store.beginBatch();
        /* Идемпотентность: повтор того же request_id возвращает сохранённый ответ */
        var prev = requestId ? Store.get('Requests', requestId) : null;
        if (prev && prev.actor_email === user.email) { var saved = safeJson(prev.response_json, null); if (saved) { saved.replayed = true; return saved; } }
        ctx.now = Integr.now();
        var data = route(ctx, p);
        var resp = { ok: true, data: data, request_id: ctx.requestId };
        if (requestId) {
          var js = JSON.stringify(resp);
          Store.insert('Requests', { request_id: requestId, action: action, actor_email: user.email, response_json: js.length < 45000 ? js : JSON.stringify({ ok: true, data: { truncated: true }, request_id: ctx.requestId }), created_at: ctx.now });
        }
        Store.commitBatch && Store.commitBatch();
        return resp;
      });
    } catch (e) {
      /* Ничего из незавершённой операции не записывается; фиксируется только ошибка */
      Store.rollbackBatch && Store.rollbackBatch();
      var r = Api.err(ctx, action, e);
      Store.commitBatch && Store.commitBatch();
      return r;
    }
  },
  ok: function (ctx, data) { return { ok: true, data: data, request_id: ctx.requestId }; },
  err: function (ctx, action, e) {
    if (e && e.name === 'AppError') return { ok: false, code: e.code, message: e.message, details: e.details, request_id: ctx.requestId };
    Errors.record(ctx, action, 'INTERNAL', 'Внутренняя ошибка', (e && (e.stack || e.message)) || String(e), '');
    return { ok: false, code: 'INTERNAL', message: 'Внутренняя ошибка. Сообщите администратору код запроса: ' + ctx.requestId, request_id: ctx.requestId };
  },
  /* Фоновые задачи от имени системы */
  runJob: function (name) {
    var ctx = { now: Integr.now(), requestId: 'job-' + uuid(), actorId: 'SYSTEM', actorEmail: 'system', user: { role: 'OWNER', employee_id: 'SYSTEM' } };
    Settings.reset();
    return Integr.withLock(function () {
      try {
        var r = name === 'frequent' ? Jobs.frequent(ctx) : Jobs.daily(ctx);
        Store.commitBatch && Store.commitBatch();
        return r;
      } catch (e) {
        Errors.record(ctx, 'job.' + name, 'JOB_ERROR', 'Фоновая задача завершилась с ошибкой', e && (e.stack || e.message), '');
        Store.commitBatch && Store.commitBatch();
        throw e;
      }
    });
  }
};
