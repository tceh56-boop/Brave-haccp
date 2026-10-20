/**
 * San.Lab — VisitService.gs + CalendarService
 * Назначение, перенос, отмена, старт, завершение, закрытие выезда (разделы 4.2–4.7 ТЗ).
 * Источник истины для статуса — лист Visits; Calendar — только расписание.
 */

var OPEN_VISIT = ['ASSIGNED', 'RESCHEDULED', 'IN_PROGRESS'];

var Visits = {
  enrich: function (rows, ctx) {
    var sites = indexBy(Store.all('Sites'), 'site_id');
    var clients = indexBy(Store.all('Clients'), 'client_id');
    var emps = indexBy(Store.all('Employees'), 'employee_id');
    var services = indexBy(Store.all('Services'), 'service_id');
    var now = ctx.now;
    return rows.map(function (v) {
      var o = stripSecrets(v);
      var s = sites[v.site_id] || {};
      o.site_name = s.site_name || ''; o.address = s.address || '';
      o.client_name = clients[v.client_id] ? clients[v.client_id].legal_name : '';
      o.employee_name = emps[v.employee_id] ? emps[v.employee_id].full_name : '';
      o.service_name = services[v.service_id] ? services[v.service_id].name : '';
      o.status_label = STATUS.visit[v.status] || v.status;
      o.is_late_start = (v.status === 'ASSIGNED' || v.status === 'RESCHEDULED') && isBefore(v.planned_start, now);
      o.is_overrun = v.status === 'IN_PROGRESS' && isBefore(isoAddHours(v.planned_end, 2), now);
      o.no_report = v.status === 'AWAITING_REPORT' && isBefore(isoAddHours(v.actual_end || v.planned_end, 24), now);
      o.attention = o.is_late_start || o.is_overrun || o.no_report || v.status === 'RETURNED' || v.calendar_sync === 'ERROR';
      return o;
    });
  },

  list: function (ctx, p) {
    var u = ctx.user;
    var st = csvList(p.status);
    var q = normText(p.q);
    var rows = filterBy(Store.all('Visits'), function (v) {
      if (u.role === 'FINANCE') { if (['APPROVED', 'CLOSED'].indexOf(v.status) < 0) return false; }
      else if (!Auth.canSeeVisit(u, v)) return false;
      if (p.mine && v.employee_id !== u.employee_id) return false;
      if (p.employee_id && v.employee_id !== p.employee_id) return false;
      if (p.client_id && v.client_id !== p.client_id) return false;
      if (p.site_id && v.site_id !== p.site_id) return false;
      if (p.service_id && v.service_id !== p.service_id) return false;
      if (st.length && st.indexOf(v.status) < 0) return false;
      if (p.from && isBefore(v.planned_start, p.from)) return false;
      if (p.to && !isBefore(v.planned_start, p.to)) return false;
      return true;
    });
    rows = Visits.enrich(rows, ctx);
    if (q) rows = filterBy(rows, function (v) { return normText(v.visit_id + ' ' + v.site_name + ' ' + v.client_name + ' ' + v.employee_name + ' ' + v.address).indexOf(q) >= 0; });
    if (p.attention) rows = filterBy(rows, function (v) { return v.attention; });
    rows = sortBy(rows, 'planned_start', p.desc !== false && !p.asc);
    if (u.role === 'FINANCE') rows = rows.map(function (v) { return pick(v, ['visit_id', 'site_id', 'client_id', 'service_id', 'planned_start', 'status', 'status_label', 'site_name', 'client_name', 'service_name']); });
    return { total: rows.length, rows: rows.slice(0, Number(p.limit) || 500) };
  },

  get: function (ctx, p) {
    var u = ctx.user;
    var v = Auth.visit(u, p.visit_id);
    var view = Visits.enrich([v], ctx)[0];
    var site = Repo.get('Sites', v.site_id) || {};
    var client = Repo.get('Clients', v.client_id) || {};
    var items = Checklists.items(v.checklist_id);
    var results = Repo.where('VisitResults', function (r) { return r.visit_id === v.visit_id; });
    var docs = Repo.where('Documents', function (d) { return d.entity_type === 'Visits' && d.entity_id === v.visit_id; });
    var samples = Repo.where('LabSamples', function (s) { return s.visit_id === v.visit_id; });
    var reports = sortBy(Repo.where('Reports', function (r) { return r.visit_id === v.visit_id; }), 'version', true)
      .map(function (r) { var o = stripSecrets(r); o.status_label = STATUS.report[r.status]; return o; });
    var tasks = Repo.where('Tasks', function (t) { return t.visit_id === v.visit_id && (u.role !== 'SPECIALIST' || t.responsible_id === u.employee_id); });
    var isMine = v.employee_id === u.employee_id;
    var editable = isMine && ['IN_PROGRESS', 'AWAITING_REPORT', 'RETURNED'].indexOf(v.status) >= 0;
    return {
      visit: view,
      site: { site_id: site.site_id, site_name: site.site_name, address: site.address, contact_name: site.contact_name, contact_phone: site.contact_phone, instructions: site.instructions },
      client: { client_id: client.client_id, legal_name: client.legal_name, contact_person: client.contact_person, contact_phone: client.contact_phone },
      checklist: Repo.get('Checklists', v.checklist_id),
      items: items,
      results: results,
      photos: docs.filter(function (d) { return d.document_type === 'PHOTO'; }),
      documents: docs.filter(function (d) { return d.document_type !== 'PHOTO'; }),
      samples: samples.map(function (s) { var o = stripSecrets(s); o.status_label = STATUS.lab[s.status]; return o; }),
      reports: reports,
      tasks: tasks.map(function (t) { return Tasks.view(t); }),
      missing: ['IN_PROGRESS', 'AWAITING_REPORT', 'RETURNED'].indexOf(v.status) >= 0 ? Checklists.missing(v) : [],
      can: {
        start: isMine && (v.status === 'ASSIGNED' || v.status === 'RESCHEDULED'),
        edit: editable,
        finish: isMine && v.status === 'IN_PROGRESS',
        submit: isMine && (v.status === 'AWAITING_REPORT' || v.status === 'RETURNED'),
        reschedule: Auth.can(u, 'visits.reschedule') && OPEN_VISIT.indexOf(v.status) >= 0 && v.status !== 'IN_PROGRESS',
        cancel: Auth.can(u, 'visits.cancel') && OPEN_VISIT.indexOf(v.status) >= 0,
        close: Auth.can(u, 'visits.close') && v.status === 'APPROVED',
        review: Auth.can(u, 'reports.approve') && v.status === 'IN_REVIEW' && !(Settings.bool('INDEPENDENT_REVIEW') && v.employee_id === u.employee_id),
        waivePhoto: Auth.can(u, 'results.waivePhoto') && ['IN_PROGRESS', 'AWAITING_REPORT', 'RETURNED', 'IN_REVIEW'].indexOf(v.status) >= 0,
        sample: (isMine && ['IN_PROGRESS', 'AWAITING_REPORT', 'RETURNED'].indexOf(v.status) >= 0) || Auth.can(u, 'lab.register') && u.role !== 'SPECIALIST',
        retryCalendar: Auth.can(u, 'visits.retryCalendar') && v.calendar_sync === 'ERROR'
      }
    };
  },

  assertEmployee: function (employeeId) {
    var e = Repo.must('Employees', employeeId, 'Исполнитель');
    if (!V.bool(e.active)) fail('VALIDATION', 'Исполнитель отключён: ' + e.full_name);
    if (['SPECIALIST', 'OWNER', 'COORDINATOR', 'QC'].indexOf(e.role) < 0) fail('VALIDATION', 'Роль «' + ROLES[e.role] + '» не может выполнять выезды');
    return e;
  },

  conflicts: function (employeeId, start, end, exceptId) {
    return filterBy(Store.all('Visits'), function (v) {
      if (v.visit_id === exceptId || v.employee_id !== employeeId || OPEN_VISIT.indexOf(v.status) < 0) return false;
      return isBefore(v.planned_start, end) && isBefore(start, v.planned_end);
    }).map(function (v) { return v.visit_id + ' ' + fmtDT(v.planned_start) + '–' + fmtDT(v.planned_end).slice(11); });
  },

  times: function (p) {
    var start = V.date(p.planned_start, 'Плановое начало');
    var end = p.planned_end ? V.date(p.planned_end, 'Плановое окончание') : isoAddHours(start, Number(p.duration_hours) || 2);
    if (!isBefore(start, end)) fail('VALIDATION', 'Окончание должно быть позже начала');
    return { start: start, end: end };
  },

  create: function (ctx, p) {
    V.required(p, ['site_id', 'service_id', 'employee_id', 'planned_start'], { site_id: 'Объект', service_id: 'Услуга', employee_id: 'Исполнитель', planned_start: 'Дата и время' });
    var site = Repo.must('Sites', p.site_id, 'Объект');
    if (!V.bool(site.active)) fail('VALIDATION', 'Объект не активен');
    var client = Repo.must('Clients', site.client_id, 'Клиент');
    if (client.status !== 'ACTIVE') fail('VALIDATION', 'Клиент не активен: ' + STATUS.client[client.status]);
    var service = Repo.must('Services', p.service_id, 'Услуга');
    if (!V.bool(service.active)) fail('VALIDATION', 'Услуга не активна');
    var emp = Visits.assertEmployee(p.employee_id);
    var t = Visits.times(p);
    var checklistId = V.str(p.checklist_id) || service.checklist_id;
    if (!checklistId) fail('VALIDATION', 'Для услуги не задан чек-лист. Выберите чек-лист.');
    var chk = Repo.must('Checklists', checklistId, 'Чек-лист');
    if (!V.bool(chk.active)) fail('VALIDATION', 'Чек-лист «' + chk.name + '» v' + chk.version + ' не активен');
    var conf = Visits.conflicts(emp.employee_id, t.start, t.end, null);
    if (conf.length && !p.force) fail('SCHEDULE_CONFLICT', 'У исполнителя пересечение по времени: ' + conf.join('; '), { conflicts: conf });

    var v = Repo.create(ctx, 'Visits', {
      site_id: site.site_id, client_id: site.client_id, employee_id: emp.employee_id, service_id: service.service_id,
      checklist_id: checklistId, planned_start: t.start, planned_end: t.end, status: 'ASSIGNED',
      instructions: V.str(p.instructions), calendar_sync: 'PENDING', reschedule_count: 0
    }, { action: 'VISIT_ASSIGN' });

    var root = Files.safeFolder(ctx, ['02_VISITS', v.visit_id], v.visit_id);
    var ph = root ? Files.safeFolder(ctx, ['02_VISITS', v.visit_id, 'Photos'], v.visit_id) : '';
    var rp = root ? Files.safeFolder(ctx, ['02_VISITS', v.visit_id, 'Reports'], v.visit_id) : '';
    v = Repo.update(ctx, 'Visits', v.visit_id, { folder_id: root, photos_folder_id: ph, reports_folder_id: rp }, { noAudit: true });
    v = Calendar.sync(ctx, v);
    Notify.push(ctx, emp.employee_id, 'VISIT_ASSIGNED', 'Visits', v.visit_id, 'Новый выезд ' + v.visit_id,
      site.site_name + ', ' + site.address + ' — ' + fmtDT(v.planned_start), 'assign:' + v.visit_id);
    return { visit: v, warnings: conf.length ? ['Назначено с пересечением: ' + conf.join('; ')] : [] };
  },

  reschedule: function (ctx, p) {
    V.required(p, ['visit_id', 'reason'], { reason: 'Причина переноса' });
    var v = Repo.must('Visits', p.visit_id, 'Выезд');
    if (['ASSIGNED', 'RESCHEDULED'].indexOf(v.status) < 0) fail('INVALID_STATUS', 'Перенос возможен только до начала выезда (сейчас: ' + STATUS.visit[v.status] + ')');
    var t = Visits.times({ planned_start: p.planned_start || v.planned_start, planned_end: p.planned_end, duration_hours: p.planned_end ? null : (new Date(v.planned_end) - new Date(v.planned_start)) / 3600000 });
    var empId = V.str(p.employee_id) || v.employee_id;
    if (empId !== v.employee_id) Visits.assertEmployee(empId);
    var conf = Visits.conflicts(empId, t.start, t.end, v.visit_id);
    if (conf.length && !p.force) fail('SCHEDULE_CONFLICT', 'У исполнителя пересечение по времени: ' + conf.join('; '), { conflicts: conf });
    var oldEmp = v.employee_id;
    v = Repo.update(ctx, 'Visits', v.visit_id, {
      planned_start: t.start, planned_end: t.end, employee_id: empId, status: 'RESCHEDULED',
      reschedule_count: (Number(v.reschedule_count) || 0) + 1, status_reason: 'Перенос: ' + p.reason, calendar_sync: 'PENDING'
    }, { action: 'VISIT_RESCHEDULE', expectedVersion: p.row_version });
    v = Calendar.sync(ctx, v);
    Notify.push(ctx, empId, 'VISIT_RESCHEDULED', 'Visits', v.visit_id, 'Перенос выезда ' + v.visit_id, 'Новое время: ' + fmtDT(v.planned_start) + '. Причина: ' + p.reason, 'resched:' + v.visit_id + ':' + v.reschedule_count);
    if (oldEmp !== empId) Notify.push(ctx, oldEmp, 'VISIT_UNASSIGNED', 'Visits', v.visit_id, 'Выезд ' + v.visit_id + ' передан другому исполнителю', 'Причина: ' + p.reason, 'unassign:' + v.visit_id + ':' + v.reschedule_count);
    return { visit: v };
  },

  cancel: function (ctx, p) {
    V.required(p, ['visit_id', 'reason'], { reason: 'Причина отмены' });
    var v = Repo.must('Visits', p.visit_id, 'Выезд');
    if (OPEN_VISIT.indexOf(v.status) < 0) fail('INVALID_STATUS', 'Отменить можно только незавершённый выезд');
    v = Repo.update(ctx, 'Visits', v.visit_id, { status: 'CANCELLED', status_reason: 'Отмена: ' + p.reason }, { action: 'VISIT_CANCEL' });
    Calendar.cancel(ctx, v);
    Notify.push(ctx, v.employee_id, 'VISIT_CANCELLED', 'Visits', v.visit_id, 'Выезд ' + v.visit_id + ' отменён', 'Причина: ' + p.reason, 'cancel:' + v.visit_id);
    return { visit: v };
  },

  /* 4.3 ТЗ. AT-04, AT-06: серверное время, повтор не создаёт дубль */
  start: function (ctx, p) {
    var v = Auth.visitWrite(ctx.user, p.visit_id);
    if (v.employee_id !== ctx.user.employee_id) denied('Начать выезд может только назначенный исполнитель');
    if (v.status === 'IN_PROGRESS') return { visit: v, already: true };
    if (['ASSIGNED', 'RESCHEDULED'].indexOf(v.status) < 0) fail('INVALID_STATUS', 'Выезд нельзя начать в статусе «' + STATUS.visit[v.status] + '»');
    v = Repo.update(ctx, 'Visits', v.visit_id, { status: 'IN_PROGRESS', actual_start: ctx.now }, { action: 'VISIT_START' });
    return { visit: v };
  },

  /* 4.5 ТЗ */
  finish: function (ctx, p) {
    var v = Auth.visitWrite(ctx.user, p.visit_id);
    if (v.employee_id !== ctx.user.employee_id) denied('Завершить выезд может только назначенный исполнитель');
    if (v.status === 'AWAITING_REPORT') return { visit: v, already: true };
    if (v.status !== 'IN_PROGRESS') fail('INVALID_STATUS', 'Завершить можно только выезд «В работе»');
    var missing = Checklists.missing(v);
    if (missing.length) fail('INCOMPLETE', 'Не хватает данных для завершения', { missing: missing });
    v = Repo.update(ctx, 'Visits', v.visit_id, { status: 'AWAITING_REPORT', actual_end: ctx.now }, { action: 'VISIT_FINISH' });
    return { visit: v };
  },

  close: function (ctx, p) {
    var v = Repo.must('Visits', p.visit_id, 'Выезд');
    if (v.status === 'CLOSED') return { visit: v, already: true };
    if (v.status !== 'APPROVED') fail('INVALID_STATUS', 'Закрыть можно только выезд с утверждённым отчётом');
    var blockers = Visits.closeBlockers(v);
    if (blockers.length) fail('BLOCKED', 'Выезд нельзя закрыть', { missing: blockers });
    v = Repo.update(ctx, 'Visits', v.visit_id, { status: 'CLOSED', closed_at: ctx.now }, { action: 'VISIT_CLOSE' });
    return { visit: v };
  },

  closeBlockers: function (v) {
    var out = [];
    var service = Repo.get('Services', v.service_id) || {};
    var samples = Repo.where('LabSamples', function (s) { return s.visit_id === v.visit_id && s.status !== 'CANCELLED'; });
    if (V.bool(service.requires_samples) && !samples.length) out.push('Для услуги обязательны пробы, но ни одна не зарегистрирована');
    if (!Settings.bool('ALLOW_CLOSE_WITH_PENDING_LAB')) {
      var pend = filterBy(samples, function (s) { return s.status !== 'REVIEWED'; });
      if (pend.length) out.push('Не завершены лабораторные пробы: ' + pend.map(function (s) { return s.sample_id; }).join(', '));
    }
    var sev = csvList(Settings.get('AUTO_TASK_SEVERITIES'));
    var res = Repo.where('VisitResults', function (r) { return r.visit_id === v.visit_id && r.result === 'NOK' && sev.indexOf(r.severity) >= 0 && !r.task_id; });
    if (res.length) out.push('Для ' + res.length + ' замечаний не созданы корректирующие задачи');
    return out;
  },

  retryCalendar: function (ctx, p) {
    var v = Repo.must('Visits', p.visit_id, 'Выезд');
    v = v.status === 'CANCELLED' ? (Calendar.cancel(ctx, v), Repo.get('Visits', v.visit_id)) : Calendar.sync(ctx, v);
    return { visit: v };
  }
};

/* ---------- Calendar (раздел 12 ТЗ) ---------- */
var Calendar = {
  payload: function (v) {
    var site = Repo.get('Sites', v.site_id) || {};
    var service = Repo.get('Services', v.service_id) || {};
    var emp = Repo.get('Employees', v.employee_id) || {};
    return {
      tag: '[' + v.visit_id + ']',
      title: v.visit_id + ' · ' + (site.site_name || '') + ' · ' + (service.name || ''),
      start: v.planned_start, end: v.planned_end, location: site.address || '',
      description: 'Выезд ' + v.visit_id + '\nИсполнитель: ' + (emp.full_name || '') + '\nКонтакт: ' + (site.contact_name || '') + ' ' + (site.contact_phone || '') +
        (v.instructions ? '\nИнструкции: ' + v.instructions : '') + '\n\nСтатус выезда смотрите в San.Lab. Календарь не является источником статуса.\n[' + v.visit_id + ']',
      guest: Settings.bool('CALENDAR_INVITE_EMPLOYEE') ? emp.email : '',
      calendarId: Settings.get('CALENDAR_ID')
    };
  },
  /* Идемпотентно: есть event_id — обновляем; нет — ищем по тегу, затем создаём (AT-13) */
  sync: function (ctx, v) {
    try {
      var eventId = Integr.calendarUpsert(v.calendar_event_id, Calendar.payload(v));
      return Repo.update(ctx, 'Visits', v.visit_id, { calendar_event_id: eventId, calendar_sync: 'OK' }, { action: v.calendar_event_id ? 'CALENDAR_UPDATE' : 'CALENDAR_CREATE' });
    } catch (e) {
      Errors.record(ctx, 'Calendar.sync', 'CALENDAR_ERROR', 'Не удалось синхронизировать событие календаря для ' + v.visit_id, e && e.message, v.visit_id);
      Notify.toRole(ctx, 'OWNER', 'INTEGRATION_ERROR', 'Visits', v.visit_id, 'Ошибка Calendar: ' + v.visit_id, 'Выезд сохранён, событие календаря не синхронизировано. Повторите из карточки выезда.', 'calerr:' + v.visit_id + ':' + localDayKey(ctx.now));
      return Repo.update(ctx, 'Visits', v.visit_id, { calendar_sync: 'ERROR' }, { noAudit: true });
    }
  },
  cancel: function (ctx, v) {
    if (!v.calendar_event_id) return;
    try {
      Integr.calendarCancel(v.calendar_event_id, Calendar.payload(v));
      Repo.update(ctx, 'Visits', v.visit_id, { calendar_sync: 'OK' }, { action: 'CALENDAR_CANCEL' });
    } catch (e) {
      Errors.record(ctx, 'Calendar.cancel', 'CALENDAR_ERROR', 'Не удалось отменить событие календаря ' + v.visit_id, e && e.message, v.visit_id);
      Repo.update(ctx, 'Visits', v.visit_id, { calendar_sync: 'ERROR' }, { noAudit: true });
    }
  }
};
