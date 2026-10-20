/**
 * San.Lab — DashboardService.gs + NotificationService + Jobs
 * Панели по ролям (раздел 6 ТЗ), аналитика, очередь уведомлений, фоновые проверки (раздел 12 ТЗ).
 */

var Dashboard = {
  get: function (ctx, p) {
    var u = ctx.user, now = ctx.now, today = localDayKey(now);
    var out = { role: u.role, generated_at: now, blocks: {} };
    var visits = Visits.list(ctx, { limit: 5000 }).rows;
    var todayV = filterBy(visits, function (v) { return localDayKey(v.planned_start) === today && v.status !== 'CANCELLED'; });
    var tasks = Tasks.list(ctx, {}).rows;
    var openTasks = filterBy(tasks, function (t) { return OPEN_TASK.indexOf(t.status) >= 0; });

    if (u.role === 'SPECIALIST') {
      var mine = filterBy(visits, function (v) { return v.employee_id === u.employee_id; });
      out.blocks.my = {
        today: sortBy(filterBy(mine, function (v) { return localDayKey(v.planned_start) === today && v.status !== 'CANCELLED'; }), 'planned_start'),
        upcoming: sortBy(filterBy(mine, function (v) { return localDayKey(v.planned_start) > today && ['ASSIGNED', 'RESCHEDULED'].indexOf(v.status) >= 0; }), 'planned_start').slice(0, 10),
        overdue: filterBy(mine, function (v) { return v.attention && localDayKey(v.planned_start) < today; }),
        returned: filterBy(mine, function (v) { return v.status === 'RETURNED'; }),
        awaiting: filterBy(mine, function (v) { return v.status === 'AWAITING_REPORT'; }),
        tasks: filterBy(openTasks, function (t) { return t.responsible_id === u.employee_id; }).slice(0, 10)
      };
      return out;
    }

    var k = {};
    if (Auth.isAdminLike(u)) {
      k.clients_active = filterBy(Store.all('Clients'), function (c) { return c.status === 'ACTIVE'; }).length;
      k.visits_today = todayV.length;
      k.visits_today_done = filterBy(todayV, function (v) { return ['AWAITING_REPORT', 'IN_REVIEW', 'APPROVED', 'CLOSED', 'RETURNED'].indexOf(v.status) >= 0; }).length;
      k.visits_in_progress = filterBy(visits, function (v) { return v.status === 'IN_PROGRESS'; }).length;
      k.visits_attention = filterBy(visits, function (v) { return v.attention; }).length;
      k.critical_open = filterBy(openTasks, function (t) { return t.priority === 'CRITICAL'; }).length;
      k.calendar_errors = filterBy(visits, function (v) { return v.calendar_sync === 'ERROR'; }).length;
      k.system_errors = u.role === 'OWNER' ? filterBy(Store.all('SystemErrors'), function (e) { return e.resolved_status !== 'RESOLVED'; }).length : 0;
      out.blocks.today = sortBy(todayV, 'planned_start');
      out.blocks.attention = filterBy(visits, function (v) { return v.attention; }).slice(0, 12);
      out.blocks.workload = Dashboard.workload(ctx, visits);
    }
    if (Auth.can(u, 'reports.queue')) {
      var q = Reports.queue(ctx, {});
      k.reviews = q.length;
      k.reviews_overdue = filterBy(q, function (r) { return r.overdue; }).length;
      k.returned = filterBy(visits, function (v) { return v.status === 'RETURNED'; }).length;
      out.blocks.queue = q.slice(0, 8);
    }
    k.tasks_open = openTasks.length;
    k.tasks_overdue = filterBy(openTasks, function (t) { return t.overdue; }).length;
    k.tasks_to_verify = filterBy(openTasks, function (t) { return t.status === 'ON_CHECK' && t.responsible_id !== u.employee_id; }).length;
    out.blocks.tasks = filterBy(openTasks, function (t) { return t.overdue || t.priority === 'CRITICAL' || t.status === 'ON_CHECK' || t.responsible_id === u.employee_id; }).slice(0, 10);

    if (Auth.can(u, 'lab.list')) {
      var lab = Lab.list(ctx, {}).rows;
      var active = filterBy(lab, function (s) { return ['REVIEWED', 'CANCELLED'].indexOf(s.status) < 0; });
      k.lab_active = active.length;
      k.lab_overdue = filterBy(active, function (s) { return s.overdue; }).length;
      k.lab_to_review = filterBy(active, function (s) { return s.status === 'RESULT'; }).length;
      var byStatus = {}; active.forEach(function (s) { byStatus[s.status] = (byStatus[s.status] || 0) + 1; });
      out.blocks.lab = { by_status: byStatus, urgent: filterBy(active, function (s) { return s.overdue || s.due_soon || s.status === 'RESULT'; }).slice(0, 10) };
    }
    if (Auth.can(u, 'finance.summary')) {
      var fs = Finance.summary(ctx, { from: localDayKey(now).slice(0, 8) + '01T00:00:00.000Z', to: isoAddDays(now, 1) });
      k.receivable = fs.receivable; k.overdue_invoices = fs.overdue.length; k.month_received = fs.received; k.month_accrued = fs.accrued; k.month_expenses = fs.expenses;
      out.blocks.finance = { series: fs.series, overdue: fs.overdue.slice(0, 6), unbilled: fs.unbilled_visits.length, pending_adjustments: fs.pending_adjustments, rules: fs.rules };
    }
    out.kpi = k;
    return out;
  },

  workload: function (ctx, visits) {
    var from = isoAddDays(ctx.now, -30);
    var emps = filterBy(Store.all('Employees'), function (e) { return V.bool(e.active) && e.role === 'SPECIALIST'; });
    return emps.map(function (e) {
      var mv = filterBy(visits, function (v) { return v.employee_id === e.employee_id; });
      var recent = filterBy(mv, function (v) { return !isBefore(v.planned_start, from) && isBefore(v.planned_start, ctx.now); });
      return {
        employee_id: e.employee_id, full_name: e.full_name,
        today: filterBy(mv, function (v) { return localDayKey(v.planned_start) === localDayKey(ctx.now) && v.status !== 'CANCELLED'; }).length,
        open: filterBy(mv, function (v) { return ['ASSIGNED', 'RESCHEDULED', 'IN_PROGRESS', 'AWAITING_REPORT', 'RETURNED'].indexOf(v.status) >= 0; }).length,
        done_30d: filterBy(recent, function (v) { return ['APPROVED', 'CLOSED', 'IN_REVIEW'].indexOf(v.status) >= 0; }).length
      };
    });
  },

  /* Отчёты и аналитика: фильтры периода, сотрудника, клиента, услуги; правила расчёта в ответе */
  analytics: function (ctx, p) {
    var from = p.from || isoAddDays(ctx.now, -30), to = p.to || isoAddDays(ctx.now, 1);
    var visits = filterBy(Visits.list(ctx, { limit: 10000, employee_id: p.employee_id, client_id: p.client_id, service_id: p.service_id, site_id: p.site_id }).rows, function (v) {
      return !isBefore(v.planned_start, from) && isBefore(v.planned_start, to);
    });
    var reports = Store.all('Reports');
    var repBy = groupBy(reports, 'visit_id');
    var emps = filterBy(Store.all('Employees'), function (e) { return ['SPECIALIST', 'COORDINATOR', 'OWNER', 'QC'].indexOf(e.role) >= 0; });
    var byEmp = emps.map(function (e) {
      var mv = filterBy(visits, function (v) { return v.employee_id === e.employee_id && v.status !== 'CANCELLED'; });
      if (!mv.length) return null;
      var started = filterBy(mv, function (v) { return v.actual_start; });
      var late = filterBy(started, function (v) { return new Date(v.actual_start) - new Date(v.planned_start) > 15 * 60000; });
      var reviewed = 0, returned = 0, firstPass = 0;
      mv.forEach(function (v) {
        var rs = repBy[v.visit_id] || [];
        var dec = filterBy(rs, function (r) { return r.status === 'APPROVED' || r.status === 'RETURNED'; });
        if (dec.length) reviewed++;
        if (filterBy(rs, function (r) { return r.status === 'RETURNED'; }).length) returned++;
        else if (filterBy(rs, function (r) { return r.status === 'APPROVED'; }).length) firstPass++;
      });
      var durs = filterBy(started, function (v) { return v.actual_end; }).map(function (v) { return (new Date(v.actual_end) - new Date(v.actual_start)) / 60000; });
      return {
        employee_id: e.employee_id, full_name: e.full_name, visits: mv.length,
        done: filterBy(mv, function (v) { return ['AWAITING_REPORT', 'IN_REVIEW', 'RETURNED', 'APPROVED', 'CLOSED'].indexOf(v.status) >= 0; }).length,
        late: late.length, late_share: started.length ? Math.round(late.length / started.length * 100) : 0,
        returned: returned, return_share: reviewed ? Math.round(returned / reviewed * 100) : 0,
        avg_minutes: durs.length ? Math.round(durs.reduce(function (a, b) { return a + b; }, 0) / durs.length) : 0
      };
    }).filter(function (x) { return x; });
    var byStatus = {}; visits.forEach(function (v) { byStatus[v.status] = (byStatus[v.status] || 0) + 1; });
    var vIds = {}; visits.forEach(function (v) { vIds[v.visit_id] = true; });
    var items = indexBy(Store.all('ChecklistItems'), 'check_item_id');
    var nok = {};
    Store.all('VisitResults').forEach(function (r) {
      if (!vIds[r.visit_id] || r.result !== 'NOK') return;
      var t = (items[r.check_item_id] || {}).text || r.check_item_id;
      nok[t] = nok[t] || { text: t, count: 0, critical: 0 };
      nok[t].count++; if (r.severity === 'CRITICAL') nok[t].critical++;
    });
    var allRes = filterBy(Store.all('VisitResults'), function (r) { return vIds[r.visit_id] && r.result; });
    var okCount = filterBy(allRes, function (r) { return r.result === 'OK'; }).length;
    var nokCount = filterBy(allRes, function (r) { return r.result === 'NOK'; }).length;
    return {
      period: { from: from, to: to }, generated_at: ctx.now, total: visits.length, by_status: byStatus, by_employee: byEmp,
      top_findings: Object.keys(nok).map(function (k) { return nok[k]; }).sort(function (a, b) { return b.count - a.count; }).slice(0, 10),
      compliance: (okCount + nokCount) ? Math.round(okCount / (okCount + nokCount) * 100) : null,
      visits: visits.slice(0, 2000).map(function (v) { return pick(v, ['visit_id', 'planned_start', 'actual_start', 'actual_end', 'status_label', 'client_name', 'site_name', 'service_name', 'employee_name']); }),
      rules: 'Период — по плановой дате выезда. Опоздание — фактическое начало позже планового более чем на 15 минут. ' +
        'Доля возвратов — выезды, по которым хотя бы одна версия отчёта возвращена, от выездов с решением контролёра. ' +
        'Соответствие — доля ответов «Соответствует» среди ответов «Соответствует» и «Не соответствует» (без «Не применимо»).'
    };
  }
};

/* ---------- Уведомления: очередь + доставка, без дублей (раздел 12 ТЗ) ---------- */
var Notify = {
  push: function (ctx, recipientId, type, entityType, entityId, title, message, dedupeKey) {
    if (!recipientId) return null;
    var e = Repo.get('Employees', recipientId);
    if (!e || !V.bool(e.active)) return null;
    var key = dedupeKey ? dedupeKey + '>' + recipientId : '';
    if (key && Repo.where('Notifications', function (n) { return n.dedupe_key === key; }).length) return null;
    var n = {
      notification_id: Repo.newId('Notifications'), recipient_id: recipientId, recipient_email: e.email, type: type,
      entity_type: entityType, entity_id: entityId, title: title, message: message, dedupe_key: key,
      scheduled_at: ctx.now, status: 'PENDING', attempts: 0, last_error: '', sent_at: '', read_at: '', created_at: ctx.now
    };
    Store.insert('Notifications', n);
    return n;
  },
  toRole: function (ctx, role, type, entityType, entityId, title, message, dedupeKey) {
    var list = filterBy(Store.all('Employees'), function (e) { return e.role === role && V.bool(e.active) && e.employee_id !== ctx.actorId; });
    for (var i = 0; i < list.length; i++) Notify.push(ctx, list[i].employee_id, type, entityType, entityId, title, message, dedupeKey);
  },
  mine: function (ctx) {
    var rows = sortBy(Repo.where('Notifications', function (n) { return n.recipient_id === ctx.actorId; }), 'created_at', true);
    return { unread: filterBy(rows, function (n) { return !n.read_at; }).length, rows: rows.slice(0, 60) };
  },
  read: function (ctx, p) {
    var ids = p.ids || [];
    var rows = Repo.where('Notifications', function (n) { return n.recipient_id === ctx.actorId && !n.read_at && (p.all || ids.indexOf(n.notification_id) >= 0); });
    for (var i = 0; i < rows.length; i++) Store.update('Notifications', rows[i].notification_id, { read_at: ctx.now });
    return { marked: rows.length };
  },
  /* Доставка e-mail. Повтор не дублирует: статус SENT больше не обрабатывается. */
  processQueue: function (ctx) {
    var list = Repo.where('Notifications', function (n) { return (n.status === 'PENDING' || (n.status === 'FAILED' && Number(n.attempts) < 3)) && !isBefore(ctx.now, n.scheduled_at); });
    var sent = 0, company = Settings.get('COMPANY_NAME');
    for (var i = 0; i < list.length && i < 80; i++) {
      var n = list[i];
      try {
        Integr.sendMail(n.recipient_email, '[' + company + '] ' + n.title, n.message + '\n\nЗапись: ' + n.entity_id + '\nОткройте ' + company + ', чтобы увидеть подробности.');
        Store.update('Notifications', n.notification_id, { status: 'SENT', sent_at: ctx.now, attempts: Number(n.attempts) + 1, last_error: '' });
        sent++;
      } catch (e) {
        Store.update('Notifications', n.notification_id, { status: 'FAILED', attempts: Number(n.attempts) + 1, last_error: String(e && e.message).slice(0, 300) });
        if (Number(n.attempts) + 1 >= 3) Errors.record(ctx, 'Notify.processQueue', 'MAIL_ERROR', 'Уведомление не доставлено после 3 попыток', e && e.message, n.notification_id);
      }
    }
    return sent;
  }
};

/* ---------- Фоновые задачи ---------- */
var Jobs = {
  daily: function (ctx) {
    var day = localDayKey(ctx.now), r = { reminders: 0, tasks_overdue: 0, lab_overdue: 0, closed: 0, pdf_retry: 0, calendar_retry: 0 };
    Store.all('Visits').forEach(function (v) {
      if (['ASSIGNED', 'RESCHEDULED'].indexOf(v.status) >= 0 && localDayKey(v.planned_start) === day) {
        var site = Repo.get('Sites', v.site_id) || {};
        if (Notify.push(ctx, v.employee_id, 'VISIT_TODAY', 'Visits', v.visit_id, 'Сегодня выезд ' + fmtDT(v.planned_start).slice(11), site.site_name + ', ' + site.address, 'today:' + v.visit_id + ':' + day)) r.reminders++;
      }
    });
    r.tasks_overdue = Tasks.remindAndEscalate(ctx);
    r.lab_overdue = Lab.checkOverdue(ctx);
    Store.all('Visits').forEach(function (v) {
      if (v.status === 'APPROVED' && !Visits.closeBlockers(v).length) { Repo.update(ctx, 'Visits', v.visit_id, { status: 'CLOSED', closed_at: ctx.now }, { action: 'VISIT_CLOSE' }); r.closed++; }
      if (v.calendar_sync === 'ERROR' && v.status !== 'CLOSED') { Calendar.sync(ctx, v); r.calendar_retry++; }
    });
    Store.all('Reports').forEach(function (rep) {
      if (rep.status === 'APPROVED' && !rep.document_id) { if (Reports.makePdf(ctx, rep)) r.pdf_retry++; }
    });
    Audit.log(ctx, 'JOB_DAILY', 'System', day, null, r);
    return r;
  },
  frequent: function (ctx) { return { sent: Notify.processQueue(ctx) }; }
};
