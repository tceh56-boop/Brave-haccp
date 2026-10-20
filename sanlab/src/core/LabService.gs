/**
 * San.Lab — LabService.gs
 * Цикл лабораторной пробы (раздел 7 ТЗ). Одна проба — одна запись.
 * Система не делает заключение о соответствии: решение принимает ответственный специалист.
 */

var Lab = {
  view: function (s, ctx, idx) {
    var o = stripSecrets(s);
    o.status_label = STATUS.lab[s.status] || s.status;
    o.site_name = idx.sites[s.site_id] ? idx.sites[s.site_id].site_name : '';
    var v = idx.visits[s.visit_id];
    o.visit_employee_id = v ? v.employee_id : '';
    o.collected_by_name = idx.emps[s.collected_by] ? idx.emps[s.collected_by].full_name : '';
    o.responsible_name = idx.emps[s.responsible_id] ? idx.emps[s.responsible_id].full_name : '';
    o.decision_label = LAB_DECISIONS[s.decision] || '';
    o.overdue = ['SENT', 'ACCEPTED', 'AWAITING'].indexOf(s.status) >= 0 && s.result_due_at && isBefore(s.result_due_at, ctx.now);
    o.due_soon = !o.overdue && ['SENT', 'ACCEPTED', 'AWAITING'].indexOf(s.status) >= 0 && s.result_due_at && isBefore(s.result_due_at, isoAddDays(ctx.now, 1));
    var i = LAB_FLOW.indexOf(s.status);
    o.next_status = i >= 0 && i < LAB_FLOW.length - 1 ? LAB_FLOW[i + 1] : '';
    return o;
  },
  idx: function () {
    return { sites: indexBy(Store.all('Sites'), 'site_id'), visits: indexBy(Store.all('Visits'), 'visit_id'), emps: indexBy(Store.all('Employees'), 'employee_id') };
  },
  canSee: function (u, s, idx) {
    if (u.role === 'SPECIALIST') { var v = idx.visits[s.visit_id]; return !!v && v.employee_id === u.employee_id; }
    return Auth.can(u, 'lab.list');
  },

  list: function (ctx, p) {
    var u = ctx.user, idx = Lab.idx();
    var st = csvList(p.status), q = normText(p.q);
    var rows = filterBy(Store.all('LabSamples'), function (s) {
      if (!Lab.canSee(u, s, idx)) return false;
      if (st.length && st.indexOf(s.status) < 0) return false;
      if (p.visit_id && s.visit_id !== p.visit_id) return false;
      if (p.site_id && s.site_id !== p.site_id) return false;
      return true;
    }).map(function (s) { return Lab.view(s, ctx, idx); });
    if (q) rows = filterBy(rows, function (s) { return normText(s.sample_id + ' ' + s.site_name + ' ' + s.sample_type + ' ' + s.lab_order_no + ' ' + s.protocol_no + ' ' + s.label_code).indexOf(q) >= 0; });
    if (p.overdue) rows = filterBy(rows, function (s) { return s.overdue; });
    rows.sort(function (a, b) { return (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || String(a.result_due_at || 'z').localeCompare(String(b.result_due_at || 'z')); });
    return { total: rows.length, rows: rows };
  },

  get: function (ctx, id) {
    var s = Repo.get('LabSamples', id), idx = Lab.idx();
    if (!s || !Lab.canSee(ctx.user, s, idx)) notFound('Проба');
    return s;
  },

  register: function (ctx, p) {
    V.required(p, ['visit_id', 'sample_type', 'sample_point'], { visit_id: 'Выезд', sample_type: 'Тип пробы', sample_point: 'Точка отбора' });
    var u = ctx.user;
    var v = Auth.visit(u, p.visit_id);
    if (u.role === 'SPECIALIST') {
      if (v.employee_id !== u.employee_id) notFound('Выезд');
      if (['IN_PROGRESS', 'AWAITING_REPORT', 'RETURNED'].indexOf(v.status) < 0) fail('INVALID_STATUS', 'Пробы регистрируются во время выезда');
    }
    if (['CANCELLED'].indexOf(v.status) >= 0) fail('INVALID_STATUS', 'Выезд отменён');
    var d = {
      visit_id: v.visit_id, site_id: v.site_id, sample_type: V.str(p.sample_type), sample_point: V.str(p.sample_point),
      label_code: V.str(p.label_code), status: 'REGISTERED', registered_by: ctx.actorId
    };
    if (p.label_code) {
      var dupe = Repo.where('LabSamples', function (x) { return x.label_code === d.label_code && x.status !== 'CANCELLED'; });
      if (dupe.length) fail('DUPLICATE', 'Маркировка ' + d.label_code + ' уже использована в ' + dupe[0].sample_id);
    }
    if (p.collected_at && p.label_code) { d.status = 'COLLECTED'; d.collected_at = V.date(p.collected_at, 'Время отбора'); d.collected_by = ctx.actorId; }
    var s = Repo.create(ctx, 'LabSamples', d, { action: 'LAB_REGISTER' });
    var folder = Files.safeFolder(ctx, ['03_LABORATORY', s.sample_id], s.sample_id);
    if (folder) s = Repo.update(ctx, 'LabSamples', s.sample_id, { folder_id: folder }, { noAudit: true });
    return s;
  },

  dueFor: function (type, fromIso) {
    var map = Settings.json('LAB_DUE_DAYS');
    var days = map[type] !== undefined ? Number(map[type]) : Settings.num('LAB_DEFAULT_DUE_DAYS');
    return isoAddDays(fromIso, days || 5);
  },

  advance: function (ctx, p) {
    V.required(p, ['sample_id', 'to'], { to: 'Новый статус' });
    var u = ctx.user;
    var s = Lab.get(ctx, p.sample_id);
    if (s.status === p.to) return { sample: s, already: true };
    var from = LAB_FLOW.indexOf(s.status), to = LAB_FLOW.indexOf(p.to);
    if (from < 0 || to < 0) fail('INVALID_STATUS', 'Недопустимый переход');
    var ok = to === from + 1 || (s.status === 'SENT' && p.to === 'AWAITING');
    if (!ok) fail('INVALID_STATUS', 'Из «' + STATUS.lab[s.status] + '» нельзя перейти в «' + STATUS.lab[p.to] + '»');
    if (p.to === 'REVIEWED') fail('VALIDATION', 'Для проверки результата используйте «Рассмотреть результат»');
    if (u.role === 'SPECIALIST' && ['COLLECTED', 'SENT'].indexOf(p.to) < 0) denied('Специалист фиксирует отбор и передачу; приём и результат ведёт лабораторный координатор');
    var patch = { status: p.to };
    var fields = LAB_REQUIRED[p.to] || [];
    var allowed = ['collected_at', 'label_code', 'lab_name', 'sent_at', 'lab_order_no', 'accepted_at', 'result_due_at', 'responsible_id', 'result_date', 'protocol_no', 'result_file_id', 'result_summary', 'status_reason'];
    for (var i = 0; i < allowed.length; i++) if (!V.isEmpty(p[allowed[i]])) patch[allowed[i]] = isDateColumn(allowed[i]) ? V.date(p[allowed[i]], allowed[i]) : V.str(p[allowed[i]]);
    if (p.to === 'COLLECTED') patch.collected_by = ctx.actorId;
    if (p.to === 'AWAITING') {
      if (!patch.result_due_at && !s.result_due_at) patch.result_due_at = Lab.dueFor(s.sample_type, s.sent_at || ctx.now);
      if (!patch.responsible_id && !s.responsible_id) {
        patch.responsible_id = u.role === 'LAB' ? ctx.actorId : (filterBy(Store.all('Employees'), function (e) { return e.role === 'LAB' && V.bool(e.active); })[0] || { employee_id: ctx.actorId }).employee_id;
      }
    }
    if (p.to === 'RESULT' && patch.result_file_id) {
      var doc = Repo.must('Documents', patch.result_file_id, 'Протокол');
      if (doc.entity_type !== 'LabSamples' || doc.entity_id !== s.sample_id || doc.document_type !== 'LAB_PROTOCOL') fail('VALIDATION', 'Протокол должен быть загружен в карточку этой пробы');
    }
    var merged = {}; for (var k in s) merged[k] = s[k]; for (var k2 in patch) merged[k2] = patch[k2];
    var missing = filterBy(fields, function (f) { return V.isEmpty(merged[f]); });
    if (missing.length) fail('VALIDATION', 'Для статуса «' + STATUS.lab[p.to] + '» заполните: ' + missing.join(', '), { missing: missing });
    if (patch.label_code && patch.label_code !== s.label_code) {
      var dupe = Repo.where('LabSamples', function (x) { return x.sample_id !== s.sample_id && x.label_code === patch.label_code && x.status !== 'CANCELLED'; });
      if (dupe.length) fail('DUPLICATE', 'Маркировка уже использована в ' + dupe[0].sample_id);
    }
    var res = Repo.update(ctx, 'LabSamples', s.sample_id, patch, { action: 'LAB_' + p.to });
    if (p.to === 'RESULT') {
      Notify.push(ctx, res.responsible_id, 'LAB_RESULT', 'LabSamples', s.sample_id, 'Получен результат ' + s.sample_id, 'Протокол ' + res.protocol_no + '. Требуется рассмотрение.', 'labres:' + s.sample_id);
    }
    return { sample: res };
  },

  /* 10.3 инструкции: решение по результату, при необходимости — задача */
  review: function (ctx, p) {
    V.required(p, ['sample_id', 'decision'], { decision: 'Решение' });
    V.oneOf(p.decision, LAB_DECISIONS, 'Решение');
    var s = Lab.get(ctx, p.sample_id);
    if (s.status === 'REVIEWED') return { sample: s, already: true };
    if (s.status !== 'RESULT') fail('INVALID_STATUS', 'Рассмотреть можно только пробу с полученным результатом');
    var needsTask = p.decision === 'NONCOMPLIANT' || p.decision === 'NEEDS_ACTION';
    if (needsTask && !V.str(p.decision_comment)) fail('VALIDATION', 'Опишите отклонение и требуемые действия');
    var task = null;
    if (needsTask) {
      var v = Repo.get('Visits', s.visit_id) || {};
      task = Tasks.createInternal(ctx, {
        source_type: 'LAB', source_id: s.sample_id, site_id: s.site_id, visit_id: s.visit_id,
        title: 'Лабораторное отклонение ' + s.sample_id + ' (' + s.sample_type + ')', description: V.str(p.decision_comment),
        responsible_id: V.str(p.task_responsible_id) || v.employee_id || ctx.actorId, priority: p.priority || 'HIGH',
        due_date: p.due_date ? V.date(p.due_date, 'Срок') : '', verification_required: true
      });
    }
    var res = Repo.update(ctx, 'LabSamples', s.sample_id, {
      status: 'REVIEWED', decision: p.decision, decision_comment: V.str(p.decision_comment), reviewed_by: ctx.actorId, reviewed_at: ctx.now, task_id: task ? task.task_id : ''
    }, { action: 'LAB_REVIEW' });
    if (s.result_file_id) Repo.update(ctx, 'Documents', s.result_file_id, { approval_status: 'APPROVED' }, { action: 'DOC_APPROVE' });
    return { sample: res, task: task };
  },

  cancel: function (ctx, p) {
    V.required(p, ['sample_id', 'reason'], { reason: 'Причина отмены' });
    var s = Lab.get(ctx, p.sample_id);
    if (s.status === 'REVIEWED' || s.status === 'CANCELLED') fail('INVALID_STATUS', 'Пробу в этом статусе отменить нельзя');
    return { sample: Repo.update(ctx, 'LabSamples', s.sample_id, { status: 'CANCELLED', status_reason: V.str(p.reason) }, { action: 'LAB_CANCEL' }) };
  },

  /* AT-09: просрочка вызывает уведомление (раз в сутки на пробу) */
  checkOverdue: function (ctx) {
    var n = 0;
    var list = Repo.where('LabSamples', function (s) { return ['SENT', 'ACCEPTED', 'AWAITING'].indexOf(s.status) >= 0 && s.result_due_at && isBefore(s.result_due_at, ctx.now); });
    for (var i = 0; i < list.length; i++) {
      var s = list[i], key = 'laboverdue:' + s.sample_id + ':' + localDayKey(ctx.now);
      var to = s.responsible_id || '';
      if (to) Notify.push(ctx, to, 'LAB_OVERDUE', 'LabSamples', s.sample_id, 'Просрочен результат ' + s.sample_id, 'Ожидался ' + fmtD(s.result_due_at) + '. Свяжитесь с лабораторией и зафиксируйте новую дату.', key);
      Notify.toRole(ctx, 'OWNER', 'LAB_OVERDUE', 'LabSamples', s.sample_id, 'Просрочен результат ' + s.sample_id, s.sample_type + ', ' + (s.lab_name || '') + ', ожидался ' + fmtD(s.result_due_at), key);
      Store.update('LabSamples', s.sample_id, { overdue_notified_at: ctx.now });
      n++;
    }
    return n;
  }
};
