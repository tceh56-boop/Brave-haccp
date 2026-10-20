/**
 * San.Lab — FileService.gs
 * Файлы в Drive + метаданные в Documents (разделы 5.2, 11 ТЗ).
 * В таблице — только метаданные и ID файла. Удаления нет: ошибочный файл помечается неактуальным с причиной.
 */

var Files = {
  safeFolder: function (ctx, path, entityId) {
    try { return Integr.ensureFolder(path); }
    catch (e) {
      Errors.record(ctx, 'Files.ensureFolder', 'DRIVE_ERROR', 'Не удалось создать папку ' + path.join('/'), e && e.message, entityId);
      return '';
    }
  },

  folderFor: function (ctx, entityType, entity) {
    switch (entityType) {
      case 'Visits': return ['02_VISITS', entity.visit_id, 'Photos'];
      case 'Reports': return ['02_VISITS', entity.visit_id, 'Reports'];
      case 'LabSamples': return ['03_LABORATORY', entity.sample_id];
      case 'Tasks': return entity.visit_id ? ['02_VISITS', entity.visit_id, 'Evidence'] : ['00_ADMIN', 'Tasks', entity.task_id];
      case 'Clients': return ['01_CLIENTS', entity.client_id];
      case 'Contracts': return ['01_CLIENTS', entity.client_id, 'Contracts'];
      case 'Sites': return ['01_CLIENTS', entity.client_id, entity.site_id];
      case 'Finance': return ['05_FINANCE', String(entity.operation_date || ctx.now).slice(0, 7)];
    }
    fail('VALIDATION', 'Неизвестный тип записи для файла');
  },

  /* Проверка права прикреплять файл к записи */
  entityForWrite: function (ctx, type, id, docType) {
    var u = ctx.user;
    if (type === 'Visits') {
      var v = Auth.visitWrite(u, id);
      if (v.employee_id !== u.employee_id) denied('Фото выезда загружает исполнитель');
      if (['IN_PROGRESS', 'AWAITING_REPORT', 'RETURNED'].indexOf(v.status) < 0) fail('INVALID_STATUS', 'Фото можно добавлять, пока выезд в работе или на доработке');
      return v;
    }
    if (type === 'LabSamples') {
      var s = Repo.must('LabSamples', id, 'Проба');
      if (u.role === 'SPECIALIST') { var sv = Repo.get('Visits', s.visit_id); if (!sv || sv.employee_id !== u.employee_id) notFound('Проба'); }
      else if (!Auth.can(u, 'lab.advance')) denied();
      return s;
    }
    if (type === 'Tasks') {
      var t = Repo.must('Tasks', id, 'Задача');
      if (t.responsible_id !== u.employee_id && !Auth.can(u, 'tasks.verify')) notFound('Задача');
      return t;
    }
    if (type === 'Clients' || type === 'Sites' || type === 'Contracts') {
      if (!(Auth.isAdminLike(u) || u.role === 'FINANCE')) denied();
      return Repo.must(type, id);
    }
    if (type === 'Finance') {
      if (!Auth.can(u, 'finance.invoice')) denied();
      return Repo.must('Finance', id, 'Операция');
    }
    fail('VALIDATION', 'Нельзя прикрепить файл к записи этого типа');
  },

  upload: function (ctx, p) {
    V.required(p, ['entity_type', 'entity_id', 'document_type', 'file_name', 'data_base64'], { data_base64: 'Файл' });
    V.oneOf(p.document_type, DOC_TYPES, 'Тип документа');
    var entity = Files.entityForWrite(ctx, p.entity_type, p.entity_id, p.document_type);
    var mime = V.str(p.mime_type) || 'application/octet-stream';
    var bytes = Math.floor(String(p.data_base64).length * 3 / 4);
    var isPhoto = p.document_type === 'PHOTO';
    var maxMb = isPhoto ? Settings.num('PHOTO_MAX_MB') : Settings.num('FILE_MAX_MB');
    if (bytes > maxMb * 1048576) fail('VALIDATION', 'Файл больше ' + maxMb + ' МБ');
    if (isPhoto && csvList(Settings.get('PHOTO_ALLOWED_TYPES')).indexOf(mime) < 0) fail('VALIDATION', 'Недопустимый формат фото: ' + mime);
    if (p.check_item_id) {
      var it = Repo.must('ChecklistItems', p.check_item_id, 'Пункт чек-листа');
      if (p.entity_type !== 'Visits' || it.checklist_id !== entity.checklist_id) fail('VALIDATION', 'Пункт не относится к выезду');
    }
    var same = Repo.where('Documents', function (d) { return d.entity_type === p.entity_type && d.entity_id === p.entity_id && d.document_type === p.document_type; });
    var version = same.length + 1;
    var ext = (String(p.file_name).match(/\.([A-Za-z0-9]{2,5})$/) || [null, mime.split('/')[1] || 'bin'])[1].toLowerCase();
    var fileName = p.entity_id + '_' + localDayKey(ctx.now) + '_' + p.document_type + '_v' + pad2(version) + '.' + ext;
    var folderId;
    try { folderId = Integr.ensureFolder(Files.folderFor(ctx, p.entity_type, entity)); }
    catch (e) { Errors.record(ctx, 'Files.upload', 'DRIVE_ERROR', 'Папка недоступна', e && e.message, p.entity_id); fail('INTEGRATION', 'Drive недоступен. Файл не сохранён — повторите загрузку.'); }
    var saved;
    try { saved = Integr.saveFile(folderId, fileName, mime, p.data_base64); }
    catch (e2) { Errors.record(ctx, 'Files.upload', 'DRIVE_ERROR', 'Не удалось сохранить файл', e2 && e2.message, p.entity_id); fail('INTEGRATION', 'Файл не сохранён в Drive — повторите загрузку.'); }
    var doc = Repo.create(ctx, 'Documents', {
      entity_type: p.entity_type, entity_id: p.entity_id, document_type: p.document_type, document_no: V.str(p.document_no),
      title: V.str(p.title) || DOC_TYPES[p.document_type], file_name: fileName, mime_type: mime, size_bytes: saved.size || bytes,
      drive_file_id: saved.fileId, check_item_id: V.str(p.check_item_id), version: version,
      approval_status: isPhoto ? '' : 'DRAFT', valid_until: p.valid_until ? V.date(p.valid_until, 'Действует до') : '', is_actual: true
    }, { action: 'FILE_UPLOAD' });
    if (isPhoto && p.check_item_id) {
      var r = Repo.where('VisitResults', function (x) { return x.visit_id === p.entity_id && x.check_item_id === p.check_item_id; })[0];
      if (r) Repo.update(ctx, 'VisitResults', r.result_id, { photo_file_id: doc.document_id }, { noAudit: true });
    }
    return doc;
  },

  canSee: function (u, d) {
    if (u.role === 'OWNER') return true;
    if (d.entity_type === 'Visits' || d.entity_type === 'Reports') {
      var vid = d.entity_type === 'Visits' ? d.entity_id : (Repo.get('Reports', d.entity_id) || {}).visit_id;
      return Auth.canSeeVisit(u, Repo.get('Visits', vid));
    }
    if (d.entity_type === 'LabSamples') {
      if (Auth.can(u, 'lab.review') || u.role === 'COORDINATOR') return true;
      var s = Repo.get('LabSamples', d.entity_id);
      return !!s && Auth.canSeeVisit(u, Repo.get('Visits', s.visit_id));
    }
    if (d.entity_type === 'Tasks') {
      var t = Repo.get('Tasks', d.entity_id);
      return !!t && (t.responsible_id === u.employee_id || Auth.can(u, 'tasks.verify'));
    }
    if (d.entity_type === 'Finance') return Auth.can(u, 'finance.list');
    if (d.entity_type === 'Clients' || d.entity_type === 'Contracts' || d.entity_type === 'Sites') return Auth.isAdminLike(u) || u.role === 'FINANCE';
    return false;
  },

  get: function (ctx, p) {
    var d = Repo.get('Documents', p.document_id);
    if (!d || !Files.canSee(ctx.user, d)) notFound('Файл');
    var data;
    try { data = Integr.readFile(d.drive_file_id, !!p.thumb); }
    catch (e) { Errors.record(ctx, 'Files.get', 'DRIVE_ERROR', 'Файл недоступен', e && e.message, d.document_id); fail('INTEGRATION', 'Файл недоступен в Drive'); }
    return { document: d, mime_type: data.mime || d.mime_type, data_base64: data.base64, file_name: d.file_name };
  },

  invalidate: function (ctx, p) {
    V.required(p, ['document_id', 'reason'], { reason: 'Причина' });
    var d = Repo.get('Documents', p.document_id);
    if (!d || !Files.canSee(ctx.user, d)) notFound('Файл');
    if (!V.bool(d.is_actual)) return { document: d, already: true };
    var u = ctx.user;
    if (!(d.created_by === u.employee_id || Auth.isAdminLike(u) || u.role === 'QC')) denied('Пометить файл неактуальным может автор, контролёр или руководитель');
    if (d.document_type === 'REPORT_PDF' && d.approval_status === 'APPROVED') fail('BLOCKED', 'Утверждённый отчёт не отменяется — создайте новую версию через возврат');
    var res = Repo.update(ctx, 'Documents', d.document_id, { is_actual: false, invalid_reason: V.str(p.reason) }, { action: 'FILE_INVALIDATE' });
    if (d.document_type === 'PHOTO' && d.check_item_id) {
      var r = Repo.where('VisitResults', function (x) { return x.visit_id === d.entity_id && x.check_item_id === d.check_item_id && x.photo_file_id === d.document_id; })[0];
      if (r) Repo.update(ctx, 'VisitResults', r.result_id, { photo_file_id: '' }, { noAudit: true });
    }
    return { document: res };
  }
};

var Documents = {
  listFor: function (ctx, fn) {
    var u = ctx.user;
    return sortBy(filterBy(Store.all('Documents'), function (d) { return fn(d) && Files.canSee(u, d); }), 'created_at', true)
      .map(function (d) { var o = stripSecrets(d); o.type_label = DOC_TYPES[d.document_type]; o.status_label = STATUS.document[d.approval_status] || ''; return o; });
  },
  list: function (ctx, p) {
    var q = normText(p.q);
    var rows = Documents.listFor(ctx, function (d) {
      if (p.document_type && d.document_type !== p.document_type) return false;
      if (!p.include_photos && d.document_type === 'PHOTO' && !p.document_type) return false;
      if (p.entity_id && d.entity_id !== p.entity_id) return false;
      if (!p.include_invalid && !V.bool(d.is_actual)) return false;
      if (q && normText(d.document_id + ' ' + d.entity_id + ' ' + d.file_name + ' ' + d.title + ' ' + d.document_no).indexOf(q) < 0) return false;
      return true;
    });
    var soon = isoAddDays(ctx.now, 30);
    rows.forEach(function (d) { d.expiring = d.valid_until && isBefore(d.valid_until, soon); });
    return { total: rows.length, rows: rows.slice(0, 400) };
  }
};
