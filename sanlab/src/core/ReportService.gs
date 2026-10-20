/**
 * San.Lab — ReportService.gs
 * Сборка отчёта, очередь контроля качества, возврат, утверждение, PDF и версии (раздел 4.6 ТЗ).
 * Утверждённая версия не перезаписывается: исправление = новая версия со ссылкой на предыдущую.
 */

var Reports = {
  snapshot: function (ctx, v) {
    var site = Repo.get('Sites', v.site_id) || {};
    var client = Repo.get('Clients', v.client_id) || {};
    var emp = Repo.get('Employees', v.employee_id) || {};
    var service = Repo.get('Services', v.service_id) || {};
    var chk = Repo.get('Checklists', v.checklist_id) || {};
    var items = Checklists.items(v.checklist_id);
    var res = indexBy(Repo.where('VisitResults', function (r) { return r.visit_id === v.visit_id; }), 'check_item_id');
    var photos = Repo.where('Documents', function (d) { return d.entity_type === 'Visits' && d.entity_id === v.visit_id && d.document_type === 'PHOTO' && V.bool(d.is_actual); });
    var pBy = groupBy(photos, 'check_item_id');
    var samples = Repo.where('LabSamples', function (s) { return s.visit_id === v.visit_id && s.status !== 'CANCELLED'; });
    var rows = items.map(function (it) {
      var r = res[it.check_item_id] || {};
      return {
        check_item_id: it.check_item_id, section: it.section, text: it.text, item_severity: it.severity,
        result: r.result || '', comment: r.comment || '', severity: r.severity || it.severity,
        photo_ids: (pBy[it.check_item_id] || []).map(function (d) { return d.document_id; }),
        photo_waived: V.bool(r.photo_waived), photo_waiver_reason: r.photo_waiver_reason || ''
      };
    });
    var nok = rows.filter(function (r) { return r.result === 'NOK'; });
    return {
      generated_at: ctx.now,
      visit: pick(v, ['visit_id', 'planned_start', 'planned_end', 'actual_start', 'actual_end', 'instructions']),
      site: { site_id: site.site_id, site_name: site.site_name, address: site.address, contact_name: site.contact_name },
      client: { client_id: client.client_id, legal_name: client.legal_name, inn: client.inn },
      employee: { employee_id: emp.employee_id, full_name: emp.full_name },
      service: { service_id: service.service_id, name: service.name },
      checklist: { checklist_id: chk.checklist_id, name: chk.name, version: chk.version },
      rows: rows,
      general_photos: (pBy[''] || []).concat(pBy[undefined] || []).map(function (d) { return d.document_id; }),
      samples: samples.map(function (s) { return pick(s, ['sample_id', 'sample_type', 'sample_point', 'label_code', 'collected_at', 'lab_name', 'lab_order_no', 'status', 'result_due_at']); }),
      totals: {
        items: rows.length, ok: rows.filter(function (r) { return r.result === 'OK'; }).length,
        nok: nok.length, na: rows.filter(function (r) { return r.result === 'NA'; }).length,
        critical: nok.filter(function (r) { return r.severity === 'CRITICAL'; }).length
      }
    };
  },

  preview: function (ctx, p) {
    var v = Auth.visit(ctx.user, p.visit_id);
    return { snapshot: Reports.snapshot(ctx, v), missing: Checklists.missing(v) };
  },

  latest: function (visitId) {
    var list = Repo.where('Reports', function (r) { return r.visit_id === visitId; });
    var best = null;
    for (var i = 0; i < list.length; i++) if (!best || Number(list[i].version) > Number(best.version)) best = list[i];
    return best;
  },

  pickReviewer: function (v) {
    var fixed = Settings.get('REVIEW_ASSIGNEE_ID');
    var indep = Settings.bool('INDEPENDENT_REVIEW');
    if (fixed) { var f = Repo.get('Employees', fixed); if (f && V.bool(f.active) && !(indep && f.employee_id === v.employee_id)) return f.employee_id; }
    var qcs = filterBy(Store.all('Employees'), function (e) { return V.bool(e.active) && e.role === 'QC' && !(indep && e.employee_id === v.employee_id); });
    if (!qcs.length) qcs = filterBy(Store.all('Employees'), function (e) { return V.bool(e.active) && e.role === 'OWNER' && !(indep && e.employee_id === v.employee_id); });
    if (!qcs.length) return '';
    var open = groupBy(Repo.where('Tasks', function (t) { return t.source_type === 'REPORT_REVIEW' && (t.status === 'NEW' || t.status === 'IN_PROGRESS'); }), 'responsible_id');
    qcs.sort(function (a, b) { return (open[a.employee_id] || []).length - (open[b.employee_id] || []).length; });
    return qcs[0].employee_id;
  },

  submit: function (ctx, p) {
    var v = Auth.visitWrite(ctx.user, p.visit_id);
    if (v.employee_id !== ctx.user.employee_id) denied('Отправить отчёт может только исполнитель выезда');
    if (v.status === 'IN_REVIEW') { var cur = Reports.latest(v.visit_id); return { report: stripSecrets(cur), already: true }; }
    if (v.status === 'IN_PROGRESS') fail('INVALID_STATUS', 'Сначала завершите выезд');
    if (['AWAITING_REPORT', 'RETURNED'].indexOf(v.status) < 0) fail('INVALID_STATUS', 'Отчёт нельзя отправить в статусе «' + STATUS.visit[v.status] + '»');
    var missing = Checklists.missing(v);
    if (missing.length) fail('INCOMPLETE', 'Отчёт не отправлен: не хватает обязательных данных', { missing: missing });

    var prev = Reports.latest(v.visit_id);
    var snap = Reports.snapshot(ctx, v);
    var reviewer = Reports.pickReviewer(v);
    var dueAt = isoAddHours(ctx.now, Settings.num('REVIEW_DUE_HOURS') || 24);
    var rep = Repo.create(ctx, 'Reports', {
      visit_id: v.visit_id, version: prev ? Number(prev.version) + 1 : 1, status: 'SUBMITTED', prev_report_id: prev ? prev.report_id : '',
      submitted_by: ctx.actorId, submitted_at: ctx.now, reviewer_id: reviewer, review_due_date: dueAt, snapshot_json: JSON.stringify(snap)
    }, { action: 'REPORT_SUBMIT' });
    Repo.update(ctx, 'Visits', v.visit_id, { status: 'IN_REVIEW', report_id: rep.report_id }, { action: 'VISIT_STATUS' });

    /* Закрыть задачу «исправить отчёт» после повторной отправки */
    var ret = Repo.where('Tasks', function (t) { return t.source_type === 'REPORT_RETURN' && t.visit_id === v.visit_id && ['NEW', 'IN_PROGRESS'].indexOf(t.status) >= 0; });
    for (var i = 0; i < ret.length; i++) Repo.update(ctx, 'Tasks', ret[i].task_id, { status: 'CLOSED', closed_at: ctx.now, evidence_comment: 'Отчёт отправлен повторно, версия ' + rep.version }, { action: 'TASK_AUTOCLOSE' });

    Reports.autoCorrective(ctx, v);

    if (reviewer) {
      Tasks.createInternal(ctx, {
        source_type: 'REPORT_REVIEW', source_id: rep.report_id, site_id: v.site_id, visit_id: v.visit_id,
        title: 'Проверить отчёт ' + v.visit_id + ' v' + rep.version, description: 'Отчёт ожидает проверки контролёром качества.',
        responsible_id: reviewer, priority: 'NORMAL', due_date: dueAt, verification_required: false
      });
    } else {
      Errors.record(ctx, 'Reports.submit', 'NO_REVIEWER', 'Нет активного контролёра для проверки отчёта', '', rep.report_id);
    }
    return { report: stripSecrets(rep), reviewer_id: reviewer };
  },

  /* Корректирующие задачи по замечаниям (раздел 8 ТЗ). Идемпотентно: одна задача на результат. */
  autoCorrective: function (ctx, v) {
    var sev = csvList(Settings.get('AUTO_TASK_SEVERITIES'));
    var items = indexBy(Checklists.items(v.checklist_id), 'check_item_id');
    var res = Repo.where('VisitResults', function (r) { return r.visit_id === v.visit_id && r.result === 'NOK' && sev.indexOf(r.severity) >= 0 && !r.task_id; });
    var site = Repo.get('Sites', v.site_id) || {};
    for (var i = 0; i < res.length; i++) {
      var it = items[res[i].check_item_id] || {};
      var t = Tasks.createInternal(ctx, {
        source_type: 'CHECKLIST', source_id: res[i].result_id, site_id: v.site_id, visit_id: v.visit_id,
        title: 'Устранить: ' + (it.text || 'замечание'), description: 'Объект: ' + (site.site_name || '') + '. Замечание: ' + res[i].comment + '. Ожидаемый результат: несоответствие устранено, подтверждение приложено.',
        responsible_id: v.employee_id, priority: res[i].severity, verification_required: res[i].severity === 'CRITICAL' || res[i].severity === 'HIGH'
      });
      Repo.update(ctx, 'VisitResults', res[i].result_id, { task_id: t.task_id }, { noAudit: true });
    }
  },

  queue: function (ctx, p) {
    var u = ctx.user;
    var visits = indexBy(Visits.enrich(Store.all('Visits'), ctx), 'visit_id');
    var emps = indexBy(Store.all('Employees'), 'employee_id');
    var st = p.status ? csvList(p.status) : ['SUBMITTED'];
    var rows = filterBy(Store.all('Reports'), function (r) { return st.indexOf(r.status) >= 0 && visits[r.visit_id]; });
    var indep = Settings.bool('INDEPENDENT_REVIEW');
    rows = rows.map(function (r) {
      var v = visits[r.visit_id];
      var snap = safeJson(r.snapshot_json, {});
      return {
        report_id: r.report_id, visit_id: r.visit_id, version: r.version, status: r.status, status_label: STATUS.report[r.status],
        submitted_at: r.submitted_at, reviewed_at: r.reviewed_at, review_comment: r.review_comment, review_due_date: r.review_due_date,
        reviewer_name: emps[r.reviewer_id] ? emps[r.reviewer_id].full_name : '', site_name: v.site_name, client_name: v.client_name,
        employee_name: v.employee_name, service_name: v.service_name, totals: snap.totals || {},
        overdue: r.status === 'SUBMITTED' && r.review_due_date && isBefore(r.review_due_date, ctx.now),
        own: indep && v.employee_id === u.employee_id
      };
    });
    return sortBy(rows, 'submitted_at', st[0] !== 'SUBMITTED');
  },

  get: function (ctx, p) {
    var r = Repo.must('Reports', p.report_id, 'Отчёт');
    Auth.visit(ctx.user, r.visit_id);
    var versions = sortBy(Repo.where('Reports', function (x) { return x.visit_id === r.visit_id; }), 'version', true)
      .map(function (x) { return pick(x, ['report_id', 'version', 'status', 'submitted_at', 'reviewed_at', 'review_comment', 'document_id']); });
    var prev = r.prev_report_id ? Repo.get('Reports', r.prev_report_id) : null;
    var snap = safeJson(r.snapshot_json, {});
    var changed = [];
    if (prev) {
      var ps = indexBy(safeJson(prev.snapshot_json, {}).rows || [], 'check_item_id');
      (snap.rows || []).forEach(function (row) {
        var o = ps[row.check_item_id] || {};
        if (o.result !== row.result || o.comment !== row.comment || (o.photo_ids || []).length !== row.photo_ids.length) changed.push(row.check_item_id);
      });
    }
    var o = stripSecrets(r);
    o.status_label = STATUS.report[r.status];
    var emps = indexBy(Store.all('Employees'), 'employee_id');
    o.reviewer_name = emps[r.reviewer_id] ? emps[r.reviewer_id].full_name : '';
    var v = Repo.get('Visits', r.visit_id);
    return {
      report: o, snapshot: snap, versions: versions, changed_items: changed,
      can_review: r.status === 'SUBMITTED' && Auth.can(ctx.user, 'reports.approve') && !(Settings.bool('INDEPENDENT_REVIEW') && v.employee_id === ctx.actorId)
    };
  },

  assertReviewable: function (ctx, r) {
    var v = Repo.must('Visits', r.visit_id, 'Выезд');
    if (Settings.bool('INDEPENDENT_REVIEW') && v.employee_id === ctx.actorId) denied('Нельзя утверждать или возвращать собственный отчёт: требуется независимая проверка');
    var latest = Reports.latest(r.visit_id);
    if (latest.report_id !== r.report_id) fail('INVALID_STATUS', 'Это не последняя версия отчёта');
    return v;
  },

  /* AT-08, AT-15 */
  approve: function (ctx, p) {
    var r = Repo.must('Reports', p.report_id, 'Отчёт');
    var v = Reports.assertReviewable(ctx, r);
    if (r.status === 'APPROVED') return { report: stripSecrets(r), already: true };
    if (r.status !== 'SUBMITTED') fail('INVALID_STATUS', 'Отчёт не ожидает проверки');
    r = Repo.update(ctx, 'Reports', r.report_id, { status: 'APPROVED', reviewer_id: ctx.actorId, reviewed_at: ctx.now, review_comment: V.str(p.comment) }, { action: 'REPORT_APPROVE' });
    Repo.update(ctx, 'Visits', v.visit_id, { status: 'APPROVED' }, { action: 'VISIT_STATUS' });
    Reports.closeReviewTasks(ctx, r, 'Отчёт утверждён');
    var doc = Reports.makePdf(ctx, r);
    Notify.push(ctx, v.employee_id, 'REPORT_APPROVED', 'Reports', r.report_id, 'Отчёт ' + v.visit_id + ' утверждён', 'Версия ' + r.version, 'approved:' + r.report_id);
    var closed = false;
    if (!Visits.closeBlockers(Repo.get('Visits', v.visit_id)).length) {
      Repo.update(ctx, 'Visits', v.visit_id, { status: 'CLOSED', closed_at: ctx.now }, { action: 'VISIT_CLOSE' });
      closed = true;
    }
    return { report: stripSecrets(Repo.get('Reports', r.report_id)), document: doc, visit_closed: closed };
  },

  /* AT-07: комментарий обязателен, создаётся задача, статус меняется */
  'return': function (ctx, p) {
    V.required(p, ['report_id', 'comment'], { comment: 'Что нужно исправить' });
    if (V.str(p.comment).length < 10) fail('VALIDATION', 'Опишите конкретно, что нужно исправить (не короче 10 символов)');
    var r = Repo.must('Reports', p.report_id, 'Отчёт');
    var v = Reports.assertReviewable(ctx, r);
    if (r.status === 'RETURNED') return { report: stripSecrets(r), already: true };
    if (r.status !== 'SUBMITTED') fail('INVALID_STATUS', 'Отчёт не ожидает проверки');
    r = Repo.update(ctx, 'Reports', r.report_id, { status: 'RETURNED', reviewer_id: ctx.actorId, reviewed_at: ctx.now, review_comment: V.str(p.comment) }, { action: 'REPORT_RETURN' });
    Repo.update(ctx, 'Visits', v.visit_id, { status: 'RETURNED', status_reason: 'Возврат: ' + p.comment }, { action: 'VISIT_STATUS' });
    Reports.closeReviewTasks(ctx, r, 'Возвращён на доработку');
    var t = Tasks.createInternal(ctx, {
      source_type: 'REPORT_RETURN', source_id: r.report_id, site_id: v.site_id, visit_id: v.visit_id,
      title: 'Исправить отчёт ' + v.visit_id, description: V.str(p.comment), responsible_id: v.employee_id, priority: 'HIGH',
      due_date: p.due_date ? V.date(p.due_date, 'Срок') : isoAddDays(ctx.now, 1), verification_required: false
    });
    return { report: stripSecrets(r), task: t };
  },

  closeReviewTasks: function (ctx, r, comment) {
    var list = Repo.where('Tasks', function (t) { return t.source_type === 'REPORT_REVIEW' && t.source_id === r.report_id && ['NEW', 'IN_PROGRESS'].indexOf(t.status) >= 0; });
    for (var i = 0; i < list.length; i++) Repo.update(ctx, 'Tasks', list[i].task_id, { status: 'CLOSED', closed_at: ctx.now, evidence_comment: comment }, { action: 'TASK_AUTOCLOSE' });
  },

  makePdf: function (ctx, r) {
    var v = Repo.get('Visits', r.visit_id);
    var prevDoc = Repo.where('Documents', function (d) { return d.entity_type === 'Visits' && d.entity_id === v.visit_id && d.document_type === 'REPORT_PDF'; });
    var fileName = v.visit_id + '_' + localDayKey(ctx.now) + '_Report_v' + pad2(Number(r.version)) + '.pdf';
    try {
      var folder = Integr.ensureFolder(['02_VISITS', v.visit_id, 'Reports']);
      var html = ReportHtml.render(ctx, r);
      var saved = Integr.makePdf(folder, fileName, html);
      var prevApproved = prevDoc.filter(function (d) { return d.approval_status === 'APPROVED'; });
      for (var i = 0; i < prevApproved.length; i++) Repo.update(ctx, 'Documents', prevApproved[i].document_id, { approval_status: 'ARCHIVED' }, { action: 'DOC_ARCHIVE' });
      var doc = Repo.create(ctx, 'Documents', {
        entity_type: 'Visits', entity_id: v.visit_id, document_type: 'REPORT_PDF', document_no: v.visit_id + '/v' + r.version,
        title: 'Отчёт о выезде ' + v.visit_id + ', версия ' + r.version, file_name: fileName, mime_type: 'application/pdf',
        size_bytes: saved.size || 0, drive_file_id: saved.fileId, version: Number(r.version), approval_status: 'APPROVED', is_actual: true,
        prev_document_id: prevApproved.length ? prevApproved[prevApproved.length - 1].document_id : ''
      }, { action: 'REPORT_PDF' });
      Repo.update(ctx, 'Reports', r.report_id, { document_id: doc.document_id }, { noAudit: true });
      return doc;
    } catch (e) {
      Errors.record(ctx, 'Reports.makePdf', 'PDF_ERROR', 'PDF отчёта не создан, повтор в фоновой задаче', e && e.message, r.report_id);
      return null;
    }
  }
};

/* HTML отчёта → PDF (Integr.makePdf). Общий шаблон для GAS и демо. */
var ReportHtml = {
  esc: function (s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
  render: function (ctx, r, opts) {
    var e = ReportHtml.esc;
    var s = safeJson(r.snapshot_json, {});
    var emps = indexBy(Store.all('Employees'), 'employee_id');
    var reviewer = emps[r.reviewer_id] ? emps[r.reviewer_id].full_name : '';
    var company = Settings.get('COMPANY_NAME');
    var resLabel = { OK: 'Соответствует', NOK: 'Не соответствует', NA: 'Не применимо' };
    var h = [];
    h.push('<html><head><meta charset="utf-8"><title>' + e(s.visit.visit_id) + ' v' + e(r.version) + '</title><style>');
    h.push('body{font-family:Arial,Helvetica,sans-serif;color:#13233f;font-size:11px;margin:28px}h1{font-size:18px;margin:0 0 4px;color:#0b2a5b}');
    h.push('.muted{color:#5b6b85}.hdr{display:flex;justify-content:space-between;border-bottom:2px solid #0b2a5b;padding-bottom:10px;margin-bottom:14px}');
    h.push('table{width:100%;border-collapse:collapse;margin:8px 0 16px}td,th{border:1px solid #c9d3e3;padding:5px 6px;text-align:left;vertical-align:top}th{background:#eef2f9;font-size:10px;text-transform:uppercase;letter-spacing:.04em}');
    h.push('.ok{color:#1f7a3d}.nok{color:#b42318;font-weight:bold}.na{color:#5b6b85}.kv td{border:none;padding:2px 8px 2px 0}.sec{background:#f6f8fc;font-weight:bold}');
    h.push('.ph{display:inline-block;margin:4px;text-align:center;font-size:9px}.ph img{width:150px;height:110px;object-fit:cover;border:1px solid #c9d3e3}.sign{margin-top:24px;display:flex;gap:40px}.foot{margin-top:24px;font-size:9px;color:#5b6b85;border-top:1px solid #c9d3e3;padding-top:6px}');
    h.push('</style></head><body>');
    h.push('<div class="hdr"><div><h1>Отчёт о санитарном выезде</h1><div class="muted">' + e(company) + ' · ' + e(s.visit.visit_id) + ' · версия ' + e(r.version) + '</div></div>');
    h.push('<div style="text-align:right"><b>' + (r.status === 'APPROVED' ? 'УТВЕРЖДЁН' : e(STATUS.report[r.status] || 'ПРЕДПРОСМОТР')) + '</b><br><span class="muted">' + (r.reviewed_at ? fmtDT(r.reviewed_at) : fmtDT(s.generated_at)) + '</span></div></div>');
    h.push('<table class="kv"><tr><td class="muted">Заказчик</td><td><b>' + e(s.client.legal_name) + '</b>' + (s.client.inn ? ', ИНН ' + e(s.client.inn) : '') + '</td></tr>');
    h.push('<tr><td class="muted">Объект</td><td>' + e(s.site.site_name) + ', ' + e(s.site.address) + '</td></tr>');
    h.push('<tr><td class="muted">Услуга</td><td>' + e(s.service.name) + '</td></tr>');
    h.push('<tr><td class="muted">Исполнитель</td><td>' + e(s.employee.full_name) + '</td></tr>');
    h.push('<tr><td class="muted">Фактическое время</td><td>' + fmtDT(s.visit.actual_start) + ' — ' + fmtDT(s.visit.actual_end) + '</td></tr>');
    h.push('<tr><td class="muted">Чек-лист</td><td>' + e(s.checklist.name) + ', версия ' + e(s.checklist.version) + '</td></tr></table>');
    h.push('<p><b>Итог:</b> пунктов ' + s.totals.items + '; соответствует ' + s.totals.ok + '; не соответствует ' + s.totals.nok + (s.totals.critical ? ' (критических: ' + s.totals.critical + ')' : '') + '; не применимо ' + s.totals.na + '.</p>');
    h.push('<table><tr><th style="width:28px">№</th><th>Пункт</th><th style="width:110px">Результат</th><th>Комментарий</th></tr>');
    var sec = null, n = 0;
    (s.rows || []).forEach(function (row) {
      if (row.section && row.section !== sec) { sec = row.section; h.push('<tr><td class="sec" colspan="4">' + e(sec) + '</td></tr>'); }
      n++;
      var cls = row.result === 'OK' ? 'ok' : row.result === 'NOK' ? 'nok' : 'na';
      h.push('<tr><td>' + n + '</td><td>' + e(row.text) + '</td><td class="' + cls + '">' + e(resLabel[row.result] || '') + (row.result === 'NOK' ? '<br>' + e(SEVERITY[row.severity]) : '') + '</td><td>' + e(row.comment) +
        (row.photo_waived ? '<br><i class="muted">Фото не требуется: ' + e(row.photo_waiver_reason) + '</i>' : '') + (row.photo_ids.length ? '<br><span class="muted">Фото: ' + row.photo_ids.length + '</span>' : '') + '</td></tr>');
    });
    h.push('</table>');
    if ((s.samples || []).length) {
      h.push('<h3>Отобранные пробы</h3><table><tr><th>ID</th><th>Тип</th><th>Точка отбора</th><th>Маркировка</th><th>Отбор</th><th>Лаборатория</th></tr>');
      s.samples.forEach(function (x) { h.push('<tr><td>' + e(x.sample_id) + '</td><td>' + e(x.sample_type) + '</td><td>' + e(x.sample_point) + '</td><td>' + e(x.label_code) + '</td><td>' + fmtDT(x.collected_at) + '</td><td>' + e(x.lab_name) + ' ' + e(x.lab_order_no) + '</td></tr>'); });
      h.push('</table><p class="muted">Результаты исследований оформляются протоколом лаборатории отдельно.</p>');
    }
    var photoIds = [];
    (s.rows || []).forEach(function (row) { row.photo_ids.forEach(function (id) { photoIds.push({ id: id, text: row.text }); }); });
    (s.general_photos || []).forEach(function (id) { photoIds.push({ id: id, text: 'Общее фото' }); });
    if (photoIds.length && !(opts && opts.noPhotos)) {
      h.push('<h3>Фотоматериалы</h3><div>');
      photoIds.slice(0, 16).forEach(function (ph) {
        var d = Repo.get('Documents', ph.id);
        var img = '';
        try { var f = Integr.readFile(d.drive_file_id, true); img = 'data:' + (f.mime || 'image/jpeg') + ';base64,' + f.base64; } catch (err) { img = ''; }
        h.push('<div class="ph">' + (img ? '<img src="' + img + '">' : '[' + e(ph.id) + ']') + '<br>' + e(ph.id) + '<br>' + e(String(ph.text).slice(0, 40)) + '</div>');
      });
      h.push('</div>');
    }
    h.push('<div class="sign"><div>Исполнитель: ' + e(s.employee.full_name) + '<br><span class="muted">отчёт отправлен ' + fmtDT(r.submitted_at) + '</span></div>');
    h.push('<div>Проверил: ' + e(reviewer || '—') + '<br><span class="muted">' + (r.reviewed_at ? fmtDT(r.reviewed_at) : '') + '</span></div></div>');
    h.push('<div class="foot">Документ сформирован системой ' + e(company) + ' (' + e(r.report_id) + (r.prev_report_id ? ', заменяет ' + e(r.prev_report_id) : '') + '). Система фиксирует наблюдения специалиста и не заменяет профессиональную оценку санитарного специалиста или лаборатории.</div>');
    h.push('</body></html>');
    return h.join('');
  }
};
