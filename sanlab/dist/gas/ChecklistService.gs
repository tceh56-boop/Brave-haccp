/**
 * San.Lab — ChecklistService.gs
 * Версионируемые чек-листы и ответы осмотра (раздел 4.4 ТЗ).
 * Каждый ответ — отдельная строка VisitResults. Выезд навсегда привязан к версии чек-листа.
 */

var Checklists = {
  items: function (checklistId) {
    return sortBy(Repo.where('ChecklistItems', function (i) { return i.checklist_id === checklistId && V.bool(i.active); }), 'sort_order')
      .sort(function (a, b) { return Number(a.sort_order) - Number(b.sort_order); });
  },

  list: function (ctx) {
    var items = groupBy(Store.all('ChecklistItems'), 'checklist_id');
    var services = Store.all('Services');
    return sortBy(Store.all('Checklists'), 'name').map(function (c) {
      var o = stripSecrets(c);
      o.items_count = (items[c.checklist_id] || []).length;
      o.photo_required_count = (items[c.checklist_id] || []).filter(function (i) { return V.bool(i.photo_required); }).length;
      o.services = services.filter(function (s) { return s.checklist_id === c.checklist_id; }).map(function (s) { return s.name; });
      return o;
    });
  },

  get: function (ctx, p) {
    var c = Repo.must('Checklists', p.checklist_id, 'Чек-лист');
    return { checklist: c, items: Checklists.items(c.checklist_id) };
  },

  /* Новая версия: старая деактивируется, но остаётся привязанной к прошлым выездам */
  saveVersion: function (ctx, p) {
    V.required(p, ['name'], { name: 'Название чек-листа' });
    var items = p.items || [];
    if (!items.length) fail('VALIDATION', 'Добавьте хотя бы один пункт');
    for (var i = 0; i < items.length; i++) {
      if (!V.str(items[i].text)) fail('VALIDATION', 'Пункт №' + (i + 1) + ': пустой текст');
      V.oneOf(items[i].severity || 'NORMAL', SEVERITY, 'Критичность');
    }
    var family = V.str(p.family_id);
    var prev = family ? Repo.where('Checklists', function (c) { return c.family_id === family; }) : [];
    var version = 1;
    for (var j = 0; j < prev.length; j++) version = Math.max(version, Number(prev[j].version) + 1);
    var chk = Repo.create(ctx, 'Checklists', {
      family_id: family || '', name: V.str(p.name), version: version, valid_from: p.valid_from ? V.date(p.valid_from, 'Действует с') : ctx.now,
      active: true, source: V.str(p.source), approved_by: ctx.actorId
    }, { action: 'CHECKLIST_VERSION' });
    if (!family) chk = Repo.update(ctx, 'Checklists', chk.checklist_id, { family_id: chk.checklist_id }, { noAudit: true });
    for (var k = 0; k < items.length; k++) {
      Repo.create(ctx, 'ChecklistItems', {
        checklist_id: chk.checklist_id, section: V.str(items[k].section), text: V.str(items[k].text),
        severity: items[k].severity || 'NORMAL', photo_required: V.bool(items[k].photo_required), sort_order: (k + 1) * 10, active: true
      }, { noAudit: true });
    }
    var services = Store.all('Services');
    for (var m = 0; m < prev.length; m++) {
      if (V.bool(prev[m].active)) Repo.update(ctx, 'Checklists', prev[m].checklist_id, { active: false }, { action: 'CHECKLIST_RETIRE' });
      for (var s = 0; s < services.length; s++) {
        if (services[s].checklist_id === prev[m].checklist_id) Repo.update(ctx, 'Services', services[s].service_id, { checklist_id: chk.checklist_id });
      }
    }
    return Checklists.get(ctx, { checklist_id: chk.checklist_id });
  },

  /* Список недостающих данных — используется при завершении и отправке (4.5 ТЗ, AT-05) */
  missing: function (v) {
    var out = [];
    var items = Checklists.items(v.checklist_id);
    var results = indexBy(Repo.where('VisitResults', function (r) { return r.visit_id === v.visit_id; }), 'check_item_id');
    var photos = Repo.where('Documents', function (d) { return d.entity_type === 'Visits' && d.entity_id === v.visit_id && d.document_type === 'PHOTO' && V.bool(d.is_actual); });
    var photoBy = groupBy(photos, 'check_item_id');
    var naNeeds = Settings.bool('NA_REQUIRES_COMMENT'), nokNeeds = Settings.bool('NOK_REQUIRES_COMMENT');
    for (var i = 0; i < items.length; i++) {
      var it = items[i], r = results[it.check_item_id], label = '«' + it.text + '»';
      if (!r || !r.result) { out.push({ code: 'NO_ANSWER', item: it.check_item_id, text: 'Нет ответа: ' + label }); continue; }
      if (r.result === 'NA' && naNeeds && !V.str(r.comment)) out.push({ code: 'NA_COMMENT', item: it.check_item_id, text: 'Поясните «не применимо»: ' + label });
      if (r.result === 'NOK' && nokNeeds && !V.str(r.comment)) out.push({ code: 'NOK_COMMENT', item: it.check_item_id, text: 'Опишите замечание: ' + label });
      if (V.bool(it.photo_required) && r.result !== 'NA' && !(photoBy[it.check_item_id] || []).length && !V.bool(r.photo_waived)) {
        out.push({ code: 'NO_PHOTO', item: it.check_item_id, text: 'Обязательное фото не приложено: ' + label });
      }
    }
    var service = Repo.get('Services', v.service_id) || {};
    if (V.bool(service.requires_samples)) {
      var s = Repo.where('LabSamples', function (x) { return x.visit_id === v.visit_id && x.status !== 'CANCELLED'; });
      if (!s.length) out.push({ code: 'NO_SAMPLES', item: '', text: 'Услуга предусматривает отбор проб — зарегистрируйте пробы' });
    }
    return out;
  }
};

var Results = {
  save: function (ctx, p) {
    V.required(p, ['visit_id', 'check_item_id', 'result'], { result: 'Результат' });
    var v = Auth.visitWrite(ctx.user, p.visit_id);
    if (v.employee_id !== ctx.user.employee_id) denied('Заполнять чек-лист может только исполнитель выезда');
    if (['IN_PROGRESS', 'AWAITING_REPORT', 'RETURNED'].indexOf(v.status) < 0) fail('INVALID_STATUS', 'Чек-лист нельзя менять в статусе «' + STATUS.visit[v.status] + '»');
    V.oneOf(p.result, CHECK_RESULTS, 'Результат');
    var item = Repo.must('ChecklistItems', p.check_item_id, 'Пункт чек-листа');
    if (item.checklist_id !== v.checklist_id) fail('VALIDATION', 'Пункт не относится к чек-листу выезда');
    var sev = V.str(p.severity) || item.severity || 'NORMAL';
    V.oneOf(sev, SEVERITY, 'Критичность');
    var existing = Repo.where('VisitResults', function (r) { return r.visit_id === v.visit_id && r.check_item_id === item.check_item_id; })[0];
    var data = { result: p.result, comment: V.str(p.comment), severity: p.result === 'NOK' ? sev : item.severity, updated_by: ctx.actorId, updated_at: ctx.now };
    var afterSubmit = v.status === 'RETURNED' || !!v.report_id;
    if (existing) {
      if (p.expected_version && Number(existing.row_version) !== Number(p.expected_version)) fail('CONFLICT', 'Ответ уже изменён. Обновите карточку.');
      return Repo.update(ctx, 'VisitResults', existing.result_id, data, { action: afterSubmit ? 'RESULT_CHANGE_AFTER_SUBMIT' : 'RESULT_SAVE' });
    }
    data.visit_id = v.visit_id; data.check_item_id = item.check_item_id; data.photo_waived = false;
    return Repo.create(ctx, 'VisitResults', data, { action: 'RESULT_SAVE' });
  },

  /* Документированное исключение для обязательного фото — только уполномоченная роль (4.4 ТЗ) */
  waivePhoto: function (ctx, p) {
    V.required(p, ['visit_id', 'check_item_id', 'reason'], { reason: 'Основание исключения' });
    var v = Repo.must('Visits', p.visit_id, 'Выезд');
    if (Settings.bool('INDEPENDENT_REVIEW') && v.employee_id === ctx.actorId) denied('Нельзя оформлять исключение для собственного выезда');
    var r = Repo.where('VisitResults', function (x) { return x.visit_id === v.visit_id && x.check_item_id === p.check_item_id; })[0];
    if (!r) fail('VALIDATION', 'Сначала исполнитель должен заполнить пункт');
    return Repo.update(ctx, 'VisitResults', r.result_id, { photo_waived: true, photo_waiver_reason: V.str(p.reason), photo_waived_by: ctx.actorId }, { action: 'PHOTO_WAIVER' });
  }
};
