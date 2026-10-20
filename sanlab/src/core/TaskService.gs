/**
 * San.Lab — TaskService.gs
 * Задачи и корректирующие действия (раздел 8 ТЗ): источник, ответственный, срок,
 * подтверждение, независимая проверка, напоминания и эскалация.
 */

var OPEN_TASK = ['NEW', 'IN_PROGRESS', 'ON_CHECK'];

var Tasks = {
  view: function (t, idx) {
    var emps = idx && idx.emps ? idx.emps : indexBy(Store.all('Employees'), 'employee_id');
    var sites = idx && idx.sites ? idx.sites : indexBy(Store.all('Sites'), 'site_id');
    var o = stripSecrets(t);
    o.status_label = STATUS.task[t.status];
    o.priority_label = PRIORITY[t.priority];
    o.source_label = TASK_SOURCES[t.source_type] || t.source_type;
    o.responsible_name = emps[t.responsible_id] ? emps[t.responsible_id].full_name : '';
    o.verified_by_name = emps[t.verified_by] ? emps[t.verified_by].full_name : '';
    o.site_name = sites[t.site_id] ? sites[t.site_id].site_name : '';
    o.overdue = OPEN_TASK.indexOf(t.status) >= 0 && t.due_date && isBefore(t.due_date, Integr.now());
    return o;
  },

  dueDefault: function (priority, now) {
    var map = Settings.json('TASK_DUE_DAYS');
    return isoAddDays(now, Number(map[priority]) || 7);
  },

  /* Внутреннее создание: используется отчётами, лабораторией, ручным созданием. Идемпотентно по источнику. */
  createInternal: function (ctx, d) {
    V.required(d, ['source_type', 'title', 'responsible_id'], { title: 'Описание действия', responsible_id: 'Ответственный' });
    V.oneOf(d.source_type, TASK_SOURCES, 'Источник');
    var priority = d.priority || 'NORMAL';
    V.oneOf(priority, PRIORITY, 'Приоритет');
    var resp = Repo.must('Employees', d.responsible_id, 'Ответственный');
    if (!V.bool(resp.active)) fail('VALIDATION', 'Ответственный отключён: ' + resp.full_name);
    if (d.source_id && ['INTERNAL', 'CLIENT'].indexOf(d.source_type) < 0) {
      var ex = Repo.where('Tasks', function (t) { return t.source_type === d.source_type && t.source_id === d.source_id && t.status !== 'CANCELLED' && (d.source_type !== 'REPORT_RETURN' || OPEN_TASK.indexOf(t.status) >= 0); });
      if (ex.length) return ex[0];
    }
    var due = d.due_date || Tasks.dueDefault(priority, ctx.now);
    if ((priority === 'CRITICAL' || priority === 'HIGH') && !due) fail('VALIDATION', 'Для срочной задачи срок обязателен');
    var verif = V.bool(d.verification_required) || (priority === 'CRITICAL' && Settings.bool('CRITICAL_REQUIRES_VERIFICATION'));
    var t = Repo.create(ctx, 'Tasks', {
      source_type: d.source_type, source_id: V.str(d.source_id), site_id: V.str(d.site_id), visit_id: V.str(d.visit_id),
      title: V.str(d.title), description: V.str(d.description), responsible_id: resp.employee_id, priority: priority,
      due_date: due, status: 'NEW', verification_required: verif
    }, { action: 'TASK_CREATE' });
    Notify.push(ctx, resp.employee_id, 'TASK_ASSIGNED', 'Tasks', t.task_id, 'Новая задача: ' + t.title, PRIORITY[priority] + ' приоритет, срок ' + fmtD(due), 'task:' + t.task_id);
    return t;
  },

  create: function (ctx, p) {
    var src = p.source_type || 'INTERNAL';
    if (['INTERNAL', 'CLIENT', 'DOCUMENT'].indexOf(src) < 0) fail('VALIDATION', 'Вручную создаются задачи типа: внутреннее поручение, запрос клиента, срок документа');
    V.required(p, ['title', 'responsible_id', 'due_date'], { title: 'Действие', responsible_id: 'Ответственный', due_date: 'Срок' });
    if (p.site_id) Repo.must('Sites', p.site_id, 'Объект');
    return Tasks.createInternal(ctx, {
      source_type: src, source_id: V.str(p.source_id), site_id: p.site_id, visit_id: p.visit_id, title: p.title, description: p.description,
      responsible_id: p.responsible_id, priority: p.priority, due_date: V.date(p.due_date, 'Срок'), verification_required: V.bool(p.verification_required)
    });
  },

  canSee: function (u, t) {
    if (Auth.isAdminLike(u)) return true;
    if (t.responsible_id === u.employee_id || t.created_by === u.employee_id) return true;
    if (u.role === 'QC') return V.bool(t.verification_required) || ['CHECKLIST', 'LAB', 'REPORT_RETURN', 'REPORT_REVIEW'].indexOf(t.source_type) >= 0;
    if (u.role === 'LAB') return t.source_type === 'LAB';
    return false;
  },

  list: function (ctx, p) {
    var u = ctx.user;
    var idx = { emps: indexBy(Store.all('Employees'), 'employee_id'), sites: indexBy(Store.all('Sites'), 'site_id') };
    var st = csvList(p.status), q = normText(p.q);
    var rows = filterBy(Store.all('Tasks'), function (t) {
      if (!Tasks.canSee(u, t)) return false;
      if (p.mine && t.responsible_id !== u.employee_id) return false;
      if (p.responsible_id && t.responsible_id !== p.responsible_id) return false;
      if (st.length && st.indexOf(t.status) < 0) return false;
      if (p.priority && t.priority !== p.priority) return false;
      if (p.source_type && t.source_type !== p.source_type) return false;
      if (p.visit_id && t.visit_id !== p.visit_id) return false;
      if (p.to_verify && !(t.status === 'ON_CHECK' && !(Settings.bool('INDEPENDENT_REVIEW') && t.responsible_id === u.employee_id))) return false;
      return true;
    }).map(function (t) { return Tasks.view(t, idx); });
    if (q) rows = filterBy(rows, function (t) { return normText(t.task_id + ' ' + t.title + ' ' + t.site_name + ' ' + t.responsible_name).indexOf(q) >= 0; });
    if (p.overdue) rows = filterBy(rows, function (t) { return t.overdue; });
    var pr = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
    rows.sort(function (a, b) {
      var ao = OPEN_TASK.indexOf(a.status) >= 0 ? 0 : 1, bo = OPEN_TASK.indexOf(b.status) >= 0 ? 0 : 1;
      return ao - bo || (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || pr[a.priority] - pr[b.priority] || String(a.due_date).localeCompare(String(b.due_date));
    });
    return { total: rows.length, rows: rows.slice(0, 500) };
  },

  mustOwn: function (ctx, id) {
    var t = Repo.get('Tasks', id);
    if (!t || !Tasks.canSee(ctx.user, t)) notFound('Задача');
    return t;
  },

  start: function (ctx, p) {
    var t = Tasks.mustOwn(ctx, p.task_id);
    if (t.responsible_id !== ctx.actorId) denied('Взять в работу может только ответственный');
    if (t.status === 'IN_PROGRESS') return { task: t, already: true };
    if (t.status !== 'NEW') fail('INVALID_STATUS', 'Задача уже в статусе «' + STATUS.task[t.status] + '»');
    return { task: Repo.update(ctx, 'Tasks', t.task_id, { status: 'IN_PROGRESS' }, { action: 'TASK_START' }) };
  },

  /* Исполнитель вносит результат. С обязательной проверкой — «На проверке», иначе — «Закрыта». */
  submit: function (ctx, p) {
    var t = Tasks.mustOwn(ctx, p.task_id);
    if (t.responsible_id !== ctx.actorId) denied('Результат вносит ответственный');
    if (t.status === 'ON_CHECK' || t.status === 'CLOSED') return { task: t, already: true };
    if (['NEW', 'IN_PROGRESS'].indexOf(t.status) < 0) fail('INVALID_STATUS', 'Задача не в работе');
    V.required(p, ['evidence_comment'], { evidence_comment: 'Что сделано' });
    if (p.evidence_file_id) {
      var d = Repo.must('Documents', p.evidence_file_id, 'Файл подтверждения');
      if (d.entity_type !== 'Tasks' || d.entity_id !== t.task_id) fail('VALIDATION', 'Файл подтверждения должен быть загружен в эту задачу');
    }
    var verif = V.bool(t.verification_required);
    if (verif && t.priority === 'CRITICAL' && !p.evidence_file_id) fail('VALIDATION', 'Для критической задачи приложите файл-подтверждение');
    var patch = { evidence_comment: V.str(p.evidence_comment), evidence_file_id: V.str(p.evidence_file_id) || t.evidence_file_id, status: verif ? 'ON_CHECK' : 'CLOSED' };
    if (!verif) patch.closed_at = ctx.now;
    var res = Repo.update(ctx, 'Tasks', t.task_id, patch, { action: verif ? 'TASK_SUBMIT' : 'TASK_CLOSE' });
    if (verif) Notify.toRole(ctx, 'QC', 'TASK_TO_VERIFY', 'Tasks', t.task_id, 'Проверить выполнение: ' + t.title, 'Исполнитель отметил выполнение. Требуется независимая проверка.', 'verify:' + t.task_id + ':' + res.row_version);
    return { task: res };
  },

  /* Прямое закрытие: только для задач без обязательной проверки (AT-10) */
  close: function (ctx, p) {
    var t = Tasks.mustOwn(ctx, p.task_id);
    if (V.bool(t.verification_required)) fail('VERIFICATION_REQUIRED', 'Задачу нельзя закрыть без независимой проверки. Отметьте выполнение — проверяющий подтвердит закрытие.');
    if (t.responsible_id !== ctx.actorId && !Auth.isAdminLike(ctx.user)) denied();
    return Tasks.submit(ctx, { task_id: t.task_id, evidence_comment: p.evidence_comment || p.comment, evidence_file_id: p.evidence_file_id });
  },

  verify: function (ctx, p) {
    var t = Tasks.mustOwn(ctx, p.task_id);
    if (t.status === 'CLOSED') return { task: t, already: true };
    if (t.status !== 'ON_CHECK') fail('INVALID_STATUS', 'Задача не передана на проверку');
    if (Settings.bool('INDEPENDENT_REVIEW') && (t.responsible_id === ctx.actorId)) denied('Нельзя проверять собственное корректирующее действие');
    V.required(p, ['comment'], { comment: 'Результат проверки' });
    return { task: Repo.update(ctx, 'Tasks', t.task_id, { status: 'CLOSED', verified_by: ctx.actorId, verified_at: ctx.now, verification_comment: V.str(p.comment), closed_at: ctx.now }, { action: 'TASK_VERIFY' }) };
  },

  reject: function (ctx, p) {
    var t = Tasks.mustOwn(ctx, p.task_id);
    if (t.status !== 'ON_CHECK') fail('INVALID_STATUS', 'Задача не на проверке');
    if (Settings.bool('INDEPENDENT_REVIEW') && t.responsible_id === ctx.actorId) denied('Нельзя проверять собственное корректирующее действие');
    V.required(p, ['comment'], { comment: 'Что не так' });
    var res = Repo.update(ctx, 'Tasks', t.task_id, { status: 'IN_PROGRESS', verification_comment: V.str(p.comment) }, { action: 'TASK_REJECT' });
    Notify.push(ctx, t.responsible_id, 'TASK_REJECTED', 'Tasks', t.task_id, 'Проверка не пройдена: ' + t.title, p.comment, 'reject:' + t.task_id + ':' + res.row_version);
    return { task: res };
  },

  cancel: function (ctx, p) {
    V.required(p, ['task_id', 'reason'], { reason: 'Причина отмены' });
    var t = Tasks.mustOwn(ctx, p.task_id);
    if (OPEN_TASK.indexOf(t.status) < 0) fail('INVALID_STATUS', 'Задача уже закрыта');
    if (t.priority === 'CRITICAL' && ctx.user.role !== 'OWNER') denied('Критическую задачу отменяет только руководитель');
    return { task: Repo.update(ctx, 'Tasks', t.task_id, { status: 'CANCELLED', cancel_reason: V.str(p.reason), closed_at: ctx.now }, { action: 'TASK_CANCEL' }) };
  },

  /* Напоминания до срока и эскалация после (фоновая задача) */
  remindAndEscalate: function (ctx) {
    var before = Settings.num('TASK_REMIND_DAYS_BEFORE') || 1;
    var soon = isoAddDays(ctx.now, before), day = localDayKey(ctx.now), n = 0;
    var list = Repo.where('Tasks', function (t) { return ['NEW', 'IN_PROGRESS'].indexOf(t.status) >= 0 && t.due_date; });
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (isBefore(t.due_date, ctx.now)) {
        Notify.push(ctx, t.responsible_id, 'TASK_OVERDUE', 'Tasks', t.task_id, 'Просрочена задача: ' + t.title, 'Срок был ' + fmtD(t.due_date), 'taskover:' + t.task_id + ':' + day);
        if (!t.escalated_at) {
          Notify.toRole(ctx, 'OWNER', 'TASK_ESCALATION', 'Tasks', t.task_id, 'Эскалация: ' + t.title, 'Ответственный: ' + ((Repo.get('Employees', t.responsible_id) || {}).full_name || '') + ', срок ' + fmtD(t.due_date), 'esc:' + t.task_id);
          Repo.update(ctx, 'Tasks', t.task_id, { escalated_at: ctx.now }, { action: 'TASK_ESCALATE' });
        }
        n++;
      } else if (isBefore(t.due_date, soon)) {
        Notify.push(ctx, t.responsible_id, 'TASK_DUE_SOON', 'Tasks', t.task_id, 'Скоро срок: ' + t.title, 'Срок ' + fmtD(t.due_date), 'tasksoon:' + t.task_id + ':' + day);
      }
    }
    return n;
  }
};
