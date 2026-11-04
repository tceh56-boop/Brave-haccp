/**
 * San.Lab — DocsService.gs
 * Нормативная база, программа производственного контроля (ППК) и технические условия (ТУ).
 * Документы собираются из положений нормативной базы. Каждое положение помечено: сверено ли оно
 * с официальным текстом. Документ с несверенными положениями утверждается только руководителем
 * с обоснованием, а в PDF это видно.
 */

var Norms = {
  /* Документ действует на дату iso */
  inForce: function (d, iso) {
    if (d.status !== 'ACTIVE' && d.status !== 'PLANNED') return false;
    if (d.valid_from && isBefore(iso, d.valid_from)) return false;
    if (d.valid_until && !isBefore(iso, d.valid_until)) return false;
    return true;
  },
  ref: function (doc, item) { var cl = item ? V.str(item.clause) : ''; return (doc ? doc.code : '') + (cl && cl !== '—' && cl !== '-' ? ', ' + cl : ''); },

  list: function (ctx, p) {
    p = p || {};
    var items = groupBy(Store.all('NormItems'), 'norm_id');
    var warnDays = Settings.num('NORM_EXPIRY_WARN_DAYS') || 90;
    var rows = Store.all('NormDocs').filter(function (d) { return !p.scope || csvList(d.scopes).indexOf(p.scope) >= 0; });
    return sortBy(rows, 'code').map(function (d) {
      var its = filterBy(items[d.norm_id] || [], function (i) { return V.bool(i.active); });
      var o = stripSecrets(d);
      o.items_count = its.length;
      o.unverified_count = filterBy(its, function (i) { return !V.bool(i.verified); }).length + (V.bool(d.verified) ? 0 : 1);
      o.in_force = Norms.inForce(d, ctx.now);
      o.expiring = !!(d.valid_until && o.in_force && isBefore(d.valid_until, isoAddDays(ctx.now, warnDays)));
      return o;
    });
  },

  get: function (ctx, p) {
    var d = Repo.must('NormDocs', p.norm_id, 'Нормативный документ');
    var items = Repo.where('NormItems', function (i) { return i.norm_id === d.norm_id; })
      .sort(function (a, b) { return (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0); });
    return { doc: d, items: items };
  },

  /* Любая правка снимает отметку «сверено»: сверку нужно подтвердить заново */
  saveDoc: function (ctx, p) {
    V.required(p, ['code', 'title', 'kind'], { code: 'Обозначение', title: 'Наименование', kind: 'Вид документа' });
    V.oneOf(p.kind, NORM_KINDS, 'Вид документа');
    var status = p.status || 'ACTIVE';
    V.oneOf(status, NORM_STATUS, 'Статус');
    var data = {
      code: V.str(p.code), title: V.str(p.title), kind: p.kind, status: status,
      valid_from: p.valid_from ? V.date(p.valid_from, 'Действует с') : '', valid_until: p.valid_until ? V.date(p.valid_until, 'Действует до') : '',
      scopes: csvList(p.scopes).filter(function (s) { return NORM_SCOPES.hasOwnProperty(s); }).join(','), source_url: V.str(p.source_url), notes: V.str(p.notes),
      verified: false, verified_by: '', verified_at: ''
    };
    if (data.valid_from && data.valid_until && !isBefore(data.valid_from, data.valid_until)) fail('VALIDATION', 'Дата окончания действия раньше даты начала');
    var dup = Repo.where('NormDocs', function (d) { return d.code.toLowerCase() === data.code.toLowerCase() && d.norm_id !== p.norm_id; })[0];
    if (dup) fail('DUPLICATE', 'Документ ' + dup.code + ' уже есть в базе: ' + dup.norm_id, { norm_id: dup.norm_id });
    if (p.norm_id) return Repo.update(ctx, 'NormDocs', p.norm_id, data, { action: 'NORM_DOC_SAVE', expectedVersion: p.row_version });
    return Repo.create(ctx, 'NormDocs', data, { action: 'NORM_DOC_SAVE' });
  },

  saveItem: function (ctx, p) {
    V.required(p, ['norm_id', 'section', 'text'], { section: 'Вид положения', text: 'Текст положения' });
    V.oneOf(p.section, NORM_SECTIONS, 'Вид положения');
    Repo.must('NormDocs', p.norm_id, 'Нормативный документ');
    var applies = csvList(p.applies).filter(function (a) { return a === 'all' || SITE_FLAGS.hasOwnProperty(a); });
    var data = {
      norm_id: p.norm_id, section: p.section, clause: V.str(p.clause), text: V.str(p.text), applies: (applies.length ? applies : ['all']).join(','),
      product_group: V.str(p.product_group), indicator: V.str(p.indicator), norm_value: V.str(p.norm_value), frequency: V.str(p.frequency), volume: V.str(p.volume),
      active: p.active === undefined ? true : V.bool(p.active), verified: false
    };
    if (p.norm_item_id) return Repo.update(ctx, 'NormItems', p.norm_item_id, data, { action: 'NORM_ITEM_SAVE', expectedVersion: p.row_version });
    var n = Repo.where('NormItems', function (i) { return i.norm_id === p.norm_id; }).length;
    data.sort_order = (n + 1) * 10;
    return Repo.create(ctx, 'NormItems', data, { action: 'NORM_ITEM_SAVE' });
  },

  /* Подтверждение сверки с официальным текстом: документ и выбранные положения (по умолчанию — все) */
  verify: function (ctx, p) {
    var d = Repo.must('NormDocs', p.norm_id, 'Нормативный документ');
    if (!V.str(d.source_url) && !V.str(p.source_url)) fail('VALIDATION', 'Укажите источник официального текста (ссылка или реквизиты публикации), с которым проведена сверка');
    var ids = p.item_ids && p.item_ids.length ? p.item_ids : null;
    var items = Repo.where('NormItems', function (i) { return i.norm_id === d.norm_id && !V.bool(i.verified) && (!ids || ids.indexOf(i.norm_item_id) >= 0); });
    for (var i = 0; i < items.length; i++) Repo.update(ctx, 'NormItems', items[i].norm_item_id, { verified: true }, { noAudit: true });
    var patch = { verified_by: ctx.actorId, verified_at: ctx.now };
    if (!ids) patch.verified = true;
    if (V.str(p.source_url)) patch.source_url = V.str(p.source_url);
    Repo.update(ctx, 'NormDocs', d.norm_id, patch, { noAudit: true });
    Audit.log(ctx, 'NORM_VERIFY', 'NormDocs', d.norm_id, null, { items: items.length, whole_doc: !ids, source: patch.source_url || d.source_url });
    return Norms.get(ctx, { norm_id: d.norm_id });
  },

  /* Действующие положения нужного вида для документа (ППК — с учётом признаков объекта) */
  pick: function (ctx, scope, sections, flags) {
    var docs = indexBy(filterBy(Store.all('NormDocs'), function (d) { return Norms.inForce(d, ctx.now) && csvList(d.scopes).indexOf(scope) >= 0; }), 'norm_id');
    var out = filterBy(Store.all('NormItems'), function (i) {
      if (!V.bool(i.active) || !docs[i.norm_id] || sections.indexOf(i.section) < 0) return false;
      if (!flags) return true;
      var ap = csvList(i.applies);
      if (!ap.length || ap.indexOf('all') >= 0) return true;
      for (var k = 0; k < ap.length; k++) if (flags.indexOf(ap[k]) >= 0) return true;
      return false;
    });
    out.sort(function (a, b) { return a.norm_id === b.norm_id ? (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) : (docs[a.norm_id].code < docs[b.norm_id].code ? -1 : 1); });
    return { items: out, docs: docs };
  },

  /* Ежедневно: предупредить руководителя об окончании действия документов */
  checkExpiry: function (ctx) {
    var warnDays = Settings.num('NORM_EXPIRY_WARN_DAYS') || 90, n = 0;
    var owners = filterBy(Store.all('Employees'), function (e) { return e.role === 'OWNER' && V.bool(e.active); });
    Store.all('NormDocs').forEach(function (d) {
      if (!d.valid_until || !Norms.inForce(d, ctx.now) || !isBefore(d.valid_until, isoAddDays(ctx.now, warnDays))) return;
      owners.forEach(function (o) {
        if (Notify.push(ctx, o.employee_id, 'NORM_EXPIRING', 'NormDocs', d.norm_id, 'Заканчивается действие: ' + d.code, d.title + ' — действует до ' + fmtD(d.valid_until) + '. Внесите заменяющий документ и пересоберите ППК и ТУ, которые на него ссылаются.', 'normexp:' + d.norm_id + ':' + d.valid_until)) n++;
      });
    });
    return n;
  }
};

/* ---------- Общая часть ППК и ТУ: разделы, подсчёт несверенного, PDF ---------- */
var DocContent = {
  MAX: 45000,
  row: function (cells, doc, item, manual) {
    var r = { c: cells, ref: manual ? '' : Norms.ref(doc, item), nid: item ? item.norm_item_id : '', v: manual ? true : !!(item && V.bool(item.verified) && doc && V.bool(doc.verified)) };
    if (manual) { r.manual = true; r.src = 'input'; }
    return r;
  },
  table: function (key, title, cols, rows, note) { return { key: key, title: title, type: 'table', cols: cols, rows: rows, note: note || '' }; },
  text: function (key, title, text, v, ref) { return { key: key, title: title, type: 'text', text: text, v: v !== false, ref: ref || '' }; },
  unverified: function (content) {
    var n = 0;
    (content.sections || []).forEach(function (s) {
      if (s.type === 'text' && s.v === false) n++;
      (s.rows || []).forEach(function (r) { if (r.v === false) n++; });
    });
    return n;
  },
  /* Правка черновика: принимаются только известные разделы; новые строки — ручные (без основания) */
  merge: function (oldC, newC) {
    var byKey = indexBy(oldC.sections || [], 'key');
    var out = [];
    (newC.sections || []).forEach(function (s) {
      var o = byKey[s.key]; if (!o) return;
      var t = JSON.parse(JSON.stringify(o));
      if (t.type === 'text') { if (s.text !== undefined) { t.text = V.str(s.text); } }
      else {
        var oldRows = indexBy((o.rows || []).map(function (r, i) { var x = JSON.parse(JSON.stringify(r)); x._i = i; return x; }), '_i');
        t.rows = (s.rows || []).map(function (r) {
          var cells = (r.c || []).slice(0, t.cols.length).map(V.str);
          while (cells.length < t.cols.length) cells.push('');
          var src = r.i !== undefined && r.i !== null && r.i !== '' ? oldRows[r.i] : null;
          if (src) { delete src._i; src.c = cells; return src; }
          return { c: cells, ref: '', nid: '', v: true, manual: true };
        });
      }
      out.push(t);
    });
    return { sections: out, built_at: oldC.built_at, norms: oldC.norms };
  },
  serialize: function (content) {
    var s = JSON.stringify(content);
    if (s.length > DocContent.MAX) fail('VALIDATION', 'Документ слишком большой для хранения (' + s.length + ' символов). Сократите тексты или разделите таблицы.');
    return s;
  },
  esc: function (s) { return ReportHtml.esc(s); },
  multiline: function (s) { return DocContent.esc(s).replace(/\n/g, '<br>'); },
  css: 'body{font-family:"Times New Roman",Times,serif;color:#111;font-size:12pt;margin:36px 44px;line-height:1.35}h1{font-size:15pt;text-align:center;margin:18px 0 6px}h2{font-size:12.5pt;margin:20px 0 8px}' +
    '.c{text-align:center}.r{text-align:right}.muted{color:#555}.small{font-size:10pt}table{width:100%;border-collapse:collapse;margin:6px 0 12px;font-size:10.5pt}td,th{border:1px solid #444;padding:4px 6px;vertical-align:top;text-align:left}th{background:#eee}' +
    '.ref{font-size:9pt;color:#444}.unv{background:#fff3cd}.flag{color:#8a5a00;font-size:9pt}.appr{width:46%;margin-left:auto;margin-top:6px}.title{margin-top:120px}.warn{border:1.5px solid #b7791f;background:#fff8e6;padding:8px 10px;margin:10px 0;font-size:10.5pt}.pb{page-break-before:always}',
  sectionsHtml: function (sections, numbered) {
    var e = DocContent.esc, h = [], n = 0;
    sections.forEach(function (s) {
      n++;
      h.push('<h2>' + (numbered ? n + ' ' : '') + e(s.title) + '</h2>');
      if (s.type === 'text') {
        h.push('<div' + (s.v === false ? ' class="unv"' : '') + '>' + DocContent.multiline(s.text) + (s.v === false ? ' <span class="flag">[не сверено' + (s.ref ? ': ' + e(s.ref) : '') + ']</span>' : '') + '</div>');
        return;
      }
      if (!(s.rows || []).length) { h.push('<p class="muted">Не применяется для данного объекта / продукции.</p>'); return; }
      h.push('<table><tr><th style="width:26px">№</th>' + s.cols.map(function (c) { return '<th>' + e(c) + '</th>'; }).join('') + '<th style="width:22%">Основание</th></tr>');
      s.rows.forEach(function (r, i) {
        h.push('<tr' + (r.v === false ? ' class="unv"' : '') + '><td>' + (i + 1) + '</td>' + r.c.map(function (c) { return '<td>' + DocContent.multiline(c) + '</td>'; }).join('') +
          '<td class="ref">' + e(r.ref || (r.manual ? (r.src === 'input' ? 'данные организации' : 'по решению организации') : '')) + (r.v === false ? '<br><span class="flag">не сверено</span>' : '') + '</td></tr>');
      });
      h.push('</table>');
      if (s.note) h.push('<p class="small muted">' + DocContent.multiline(s.note) + '</p>');
    });
    return h.join('');
  },
  approvalBlock: function (who, position, org) {
    var e = DocContent.esc;
    return '<div class="appr"><b>УТВЕРЖДАЮ</b><br>' + e(position || 'Руководитель') + '<br>' + e(org || '') + '<br><br>_______________ / ' + e(who || '________________') + '<br>«___» ____________ 20___ г.<br>М.П.</div>';
  },
  /* Сохранить PDF в папку клиента и зарегистрировать в «Документах» */
  savePdf: function (ctx, entityType, entityId, clientId, folderName, docType, fileBase, title, version, html) {
    var fileName = fileBase + '_v' + pad2(Number(version)) + '.pdf';
    var folder = Integr.ensureFolder(['01_CLIENTS', clientId || 'NO_CLIENT', folderName]);
    var saved = Integr.makePdf(folder, fileName, html);
    var prev = Repo.where('Documents', function (d) { return d.entity_type === entityType && d.document_type === docType && d.approval_status === 'APPROVED' && d.document_no.indexOf(fileBase.split('_')[0]) === 0; });
    return Repo.create(ctx, 'Documents', {
      entity_type: entityType, entity_id: entityId, document_type: docType, document_no: entityId + '/v' + version, title: title, file_name: fileName, mime_type: 'application/pdf',
      size_bytes: saved.size || 0, drive_file_id: saved.fileId, version: Number(version), approval_status: 'APPROVED', is_actual: true, prev_document_id: prev.length ? prev[prev.length - 1].document_id : ''
    }, { action: docType + '_PDF' });
  },
  /* Утверждение: проверка независимости и несверенных положений */
  checkApproval: function (ctx, rec, p, label) {
    if (rec.status !== 'DRAFT') fail('INVALID_STATUS', 'Утверждается только черновик. Для изменений создайте новую версию.');
    if (Settings.bool('INDEPENDENT_REVIEW') && rec.created_by === ctx.actorId && ctx.user.role !== 'OWNER') denied('Нельзя утверждать ' + label + ', которую вы составили сами');
    var n = Number(rec.unverified_count) || 0;
    if (!n) return '';
    if (!p.accept_unverified) fail('UNVERIFIED', 'В документе ' + n + ' положений не сверены с официальным текстом нормативов. Сверьте их в «Нормативной базе» и пересоберите документ, либо утвердите с обоснованием (только руководитель).', { unverified: n });
    if (ctx.user.role !== 'OWNER') denied('Утвердить документ с несверенными положениями может только руководитель');
    if (V.str(p.reason).length < 10) fail('VALIDATION', 'Опишите обоснование утверждения с несверенными положениями (не короче 10 символов)');
    return V.str(p.reason);
  }
};

/* ---------- Программа производственного контроля ---------- */
var Programs = {
  SECTIONS: ['DOCS', 'LAB', 'PROF', 'CCP', 'EMERG', 'JOURNAL', 'MEASURE'],
  profile: function (p) {
    var pr = p || {};
    var flags = csvList(pr.flags).filter(function (f) { return SITE_FLAGS.hasOwnProperty(f); });
    var ot = OBJECT_TYPES.hasOwnProperty(pr.object_type) ? pr.object_type : 'CAFE';
    if ((ot === 'SCHOOL' || ot === 'KINDERGARTEN') && flags.indexOf('children') < 0) flags.push('children');
    return {
      object_type: ot, flags: flags.join(','), seats: V.str(pr.seats), staff_count: V.str(pr.staff_count), work_mode: V.str(pr.work_mode),
      water_source: V.str(pr.water_source), head_name: V.str(pr.head_name), head_position: V.str(pr.head_position) || 'Руководитель',
      responsible: V.str(pr.responsible), positions: V.str(pr.positions), lab_name: V.str(pr.lab_name), pest_control: V.str(pr.pest_control),
      waste: V.str(pr.waste), assortment: V.str(pr.assortment), extra: V.str(pr.extra),
      /* Для комплекта документов ППК + ХАССП */
      ogrn: V.str(pr.ogrn), area: V.str(pr.area), activity: V.str(pr.activity), utilities: V.str(pr.utilities), ventilation_desc: V.str(pr.ventilation_desc),
      tu_declarations: V.str(pr.tu_declarations), equipment: V.str(pr.equipment), staff: V.str(pr.staff), chemicals: V.str(pr.chemicals)
    };
  },
  build: function (ctx, p) {
    var old = p.program_id ? Repo.must('Programs', p.program_id, 'Программа') : null;
    if (old && old.status !== 'DRAFT') fail('INVALID_STATUS', 'Пересобрать можно только черновик. Создайте новую версию.');
    var site = Repo.must('Sites', old ? old.site_id : p.site_id, 'Объект');
    var client = Repo.must('Clients', site.client_id, 'Клиент');
    if (!old) {
      var draft = Repo.where('Programs', function (x) { return x.site_id === site.site_id && x.status === 'DRAFT'; })[0];
      if (draft) fail('DUPLICATE', 'Для объекта уже есть черновик программы: ' + draft.program_id + '. Откройте его.', { program_id: draft.program_id });
    }
    var prof = Programs.profile(p.profile || (old ? safeJson(old.profile_json, {}) : {}));
    var content = Programs.compose(ctx, client, site, prof);
    var data = { profile_json: JSON.stringify(prof), content_json: DocContent.serialize(content), unverified_count: DocContent.unverified(content), title: 'Программа производственного контроля: ' + site.site_name };
    if (old) return Programs.get(ctx, { program_id: Repo.update(ctx, 'Programs', old.program_id, data, { action: 'PPC_REBUILD' }).program_id });
    var prev = Repo.where('Programs', function (x) { return x.site_id === site.site_id; });
    var ver = 1; prev.forEach(function (x) { ver = Math.max(ver, Number(x.version) + 1); });
    data.client_id = client.client_id; data.site_id = site.site_id; data.version = ver; data.status = 'DRAFT';
    var rec = Repo.create(ctx, 'Programs', data, { action: 'PPC_CREATE' });
    return Programs.get(ctx, { program_id: rec.program_id });
  },

  compose: function (ctx, client, site, prof) {
    var flags = csvList(prof.flags);
    var pk = Norms.pick(ctx, 'PPC', Programs.SECTIONS, flags);
    var by = groupBy(pk.items, 'section'), D = pk.docs, R = DocContent.row;
    var sec = [];
    var flagNames = flags.map(function (f) { return SITE_FLAGS[f]; }).join(', ');
    sec.push(DocContent.text('general', 'Общие сведения',
      'Наименование организации: ' + client.legal_name + (client.inn ? ', ИНН ' + client.inn : '') + '.\n' +
      'Юридический адрес: ' + (client.legal_address || '—') + '.\n' +
      'Объект: ' + site.site_name + ', ' + site.address + '.\n' +
      'Тип объекта: ' + OBJECT_TYPES[prof.object_type] + (prof.seats ? ', посадочных мест: ' + prof.seats : '') + (prof.staff_count ? ', работников: ' + prof.staff_count : '') + '.\n' +
      (prof.work_mode ? 'Режим работы: ' + prof.work_mode + '.\n' : '') +
      (flagNames ? 'Особенности: ' + flagNames + '.\n' : '') +
      (prof.water_source ? 'Водоснабжение: ' + prof.water_source + '.\n' : '') +
      (prof.assortment ? 'Ассортимент и виды деятельности: ' + prof.assortment + '.\n' : '') +
      'Цель производственного контроля — обеспечение безопасности для человека выпускаемой продукции и оказываемых услуг, соблюдение санитарных правил и выполнение санитарно-противоэпидемических (профилактических) мероприятий.'));
    var usedDocs = {};
    pk.items.forEach(function (i) { usedDocs[i.norm_id] = true; });
    filterBy(Store.all('NormDocs'), function (d) { return Norms.inForce(d, ctx.now) && csvList(d.scopes).indexOf('PPC') >= 0; }).forEach(function (d) { usedDocs[d.norm_id] = true; });
    var docRows = sortBy(Object.keys(usedDocs).map(function (id) { return Repo.get('NormDocs', id); }), 'code').map(function (d) {
      return { c: [d.code, d.title, d.valid_until ? 'до ' + fmtD(d.valid_until) : 'без ограничения срока'], ref: d.code, nid: '', v: V.bool(d.verified), doc: d.norm_id };
    });
    (by.DOCS || []).forEach(function (i) { docRows.push(R([i.text, i.indicator || '', ''], D[i.norm_id], i)); });
    sec.push(DocContent.table('docs', 'Перечень официально изданных нормативных документов', ['Обозначение', 'Наименование', 'Срок действия'], docRows));
    var resp = V.str(prof.responsible).split('\n').filter(function (l) { return V.str(l); }).map(function (l) { var a = l.split(';'); return R([V.str(a[0]), V.str(a[1]), V.str(a.slice(2).join(';'))], null, null, true); });
    if (!resp.length) resp.push(R([prof.head_name || '', prof.head_position || 'Руководитель', 'Общее руководство и ответственность за организацию производственного контроля'], null, null, true));
    sec.push(DocContent.table('officials', 'Должностные лица, ответственные за осуществление производственного контроля', ['ФИО', 'Должность', 'Функции'], resp));
    sec.push(DocContent.table('lab', 'Лабораторные и инструментальные исследования: объекты, показатели, точки отбора, периодичность', ['Объект контроля / точка отбора', 'Показатели', 'Периодичность', 'Объём'],
      (by.LAB || []).map(function (i) { return R([i.text, i.indicator, i.frequency, i.volume], D[i.norm_id], i); }),
      'Исследования проводит аккредитованная лаборатория' + (prof.lab_name ? ': ' + prof.lab_name : '') + '. Периодичность установлена организацией в соответствии с нормативными документами, указанными в графе «Основание».'));
    var positions = V.str(prof.positions) || 'все работники, занятые приготовлением, раздачей, хранением пищевой продукции, мойкой посуды и инвентаря';
    sec.push(DocContent.table('prof', 'Должности работников, подлежащих медицинским осмотрам, профессиональной гигиенической подготовке и аттестации', ['Требование', 'Должности', 'Периодичность'],
      (by.PROF || []).map(function (i) { return R([i.text, i.indicator || positions, i.frequency], D[i.norm_id], i); })));
    sec.push(DocContent.table('ccp', 'Опасные факторы, процессы и критические контрольные точки (принципы ХАССП)', ['Процесс / этап', 'Опасный фактор', 'Критический предел / требование', 'Мониторинг'],
      (by.CCP || []).map(function (i) { return R([i.text, i.indicator, i.norm_value, i.frequency], D[i.norm_id], i); })));
    sec.push(DocContent.table('emerg', 'Возможные аварийные ситуации и действия персонала', ['Ситуация', 'Действия'],
      (by.EMERG || []).map(function (i) { return R([i.text, i.norm_value], D[i.norm_id], i); })));
    sec.push(DocContent.table('journals', 'Формы учёта и отчётности по производственному контролю', ['Форма учёта', 'Периодичность заполнения', 'Ответственный'],
      (by.JOURNAL || []).map(function (i) { return R([i.text, i.frequency, i.indicator], D[i.norm_id], i); })));
    var meas = (by.MEASURE || []).map(function (i) { return R([i.text, i.frequency, i.indicator], D[i.norm_id], i); });
    if (prof.pest_control) meas.push(R(['Дезинсекция и дератизация по договору со специализированной организацией: ' + prof.pest_control, 'по договору', ''], null, null, true));
    if (prof.waste) meas.push(R(['Вывоз отходов по договору: ' + prof.waste, 'по графику вывоза', ''], null, null, true));
    sec.push(DocContent.table('measures', 'Мероприятия производственного контроля', ['Мероприятие', 'Периодичность', 'Ответственный'], meas));
    sec.push(DocContent.text('final', 'Заключительные положения', 'Программа вступает в силу с даты утверждения. Программа пересматривается при изменении вида деятельности, ассортимента, технологии, нормативных документов, а также не реже одного раза в ' + (Settings.num('PPC_REVIEW_MONTHS') || 12) + ' мес. Результаты производственного контроля фиксируются в формах учёта и хранятся в организации.' + (prof.extra ? '\n' + prof.extra : '')));
    return { sections: sec, built_at: ctx.now, norms: Object.keys(usedDocs) };
  },

  enrich: function (rec) {
    var o = stripSecrets(rec); delete o.content_json; delete o.profile_json;
    var c = Repo.get('Clients', rec.client_id) || {}, s = Repo.get('Sites', rec.site_id) || {};
    o.client_name = c.legal_name || ''; o.site_name = s.site_name || ''; o.site_address = s.address || '';
    return o;
  },
  list: function (ctx, p) {
    p = p || {};
    var rows = Repo.where('Programs', function (x) { return (!p.site_id || x.site_id === p.site_id) && (!p.client_id || x.client_id === p.client_id) && (p.all || x.status !== 'ARCHIVED'); });
    return sortBy(rows, 'updated_at', true).map(Programs.enrich);
  },
  get: function (ctx, p) {
    var rec = Repo.must('Programs', p.program_id, 'Программа');
    var content = safeJson(rec.content_json, { sections: [] });
    var warn = [], warnDays = Settings.num('NORM_EXPIRY_WARN_DAYS') || 90;
    (content.norms || []).forEach(function (id) {
      var d = Repo.get('NormDocs', id); if (!d) return;
      if (!Norms.inForce(d, ctx.now)) warn.push(d.code + ' больше не действует — пересоберите программу или создайте новую версию.');
      else if (d.valid_until && isBefore(d.valid_until, isoAddDays(ctx.now, warnDays))) warn.push(d.code + ' действует до ' + fmtD(d.valid_until) + '.');
    });
    return { program: Programs.enrich(rec), row_version: rec.row_version, profile: safeJson(rec.profile_json, {}), content: content, warnings: warn,
      history: sortBy(Repo.where('Programs', function (x) { return x.site_id === rec.site_id; }), 'version', true).map(Programs.enrich) };
  },
  save: function (ctx, p) {
    var rec = Repo.must('Programs', p.program_id, 'Программа');
    if (rec.status !== 'DRAFT') fail('INVALID_STATUS', 'Утверждённую программу изменить нельзя. Создайте новую версию.');
    var content = DocContent.merge(safeJson(rec.content_json, { sections: [] }), p.content || {});
    var patch = { content_json: DocContent.serialize(content), unverified_count: DocContent.unverified(content) };
    if (p.profile) patch.profile_json = JSON.stringify(Programs.profile(p.profile));
    Repo.update(ctx, 'Programs', rec.program_id, patch, { action: 'PPC_EDIT', expectedVersion: p.row_version });
    return Programs.get(ctx, { program_id: rec.program_id });
  },
  approve: function (ctx, p) {
    var rec = Repo.must('Programs', p.program_id, 'Программа');
    var reason = DocContent.checkApproval(ctx, rec, p, 'программу');
    var content = safeJson(rec.content_json, { sections: [] });
    var due = isoAddDays(ctx.now, Math.round((Settings.num('PPC_REVIEW_MONTHS') || 12) * 30.4));
    (content.norms || []).forEach(function (id) { var d = Repo.get('NormDocs', id); if (d && d.valid_until && isBefore(d.valid_until, due)) due = d.valid_until; });
    Repo.where('Programs', function (x) { return x.site_id === rec.site_id && x.status === 'APPROVED'; }).forEach(function (x) {
      Repo.update(ctx, 'Programs', x.program_id, { status: 'ARCHIVED' }, { action: 'PPC_ARCHIVE' });
      if (x.document_id) Repo.update(ctx, 'Documents', x.document_id, { approval_status: 'ARCHIVED' }, { action: 'DOC_ARCHIVE' });
    });
    rec = Repo.update(ctx, 'Programs', rec.program_id, { status: 'APPROVED', approved_by: ctx.actorId, approved_at: ctx.now, review_due_date: due, unverified_reason: reason }, { action: 'PPC_APPROVE' });
    Programs.makePdf(ctx, rec);
    return Programs.get(ctx, { program_id: rec.program_id });
  },
  makePdf: function (ctx, rec) {
    try {
      var doc = DocContent.savePdf(ctx, 'Programs', rec.program_id, rec.client_id, 'PPC', 'PPC', rec.program_id + '_PPC', 'Программа производственного контроля ' + rec.program_id + ', версия ' + rec.version, rec.version, Programs.render(ctx, rec));
      Repo.update(ctx, 'Programs', rec.program_id, { document_id: doc.document_id }, { noAudit: true });
      return doc;
    } catch (e) {
      Errors.record(ctx, 'Programs.makePdf', 'PDF_ERROR', 'PDF программы не создан, повтор в фоновой задаче', e && e.message, rec.program_id);
      return null;
    }
  },
  newVersion: function (ctx, p) {
    var rec = Repo.must('Programs', p.program_id, 'Программа');
    if (rec.status === 'DRAFT') fail('INVALID_STATUS', 'Это уже черновик — редактируйте его.');
    var draft = Repo.where('Programs', function (x) { return x.site_id === rec.site_id && x.status === 'DRAFT'; })[0];
    if (draft) fail('DUPLICATE', 'Для объекта уже есть черновик: ' + draft.program_id, { program_id: draft.program_id });
    var ver = 1; Repo.where('Programs', function (x) { return x.site_id === rec.site_id; }).forEach(function (x) { ver = Math.max(ver, Number(x.version) + 1); });
    var n = Repo.create(ctx, 'Programs', { client_id: rec.client_id, site_id: rec.site_id, title: rec.title, version: ver, status: 'DRAFT', profile_json: rec.profile_json, content_json: rec.content_json, unverified_count: rec.unverified_count, prev_program_id: rec.program_id }, { action: 'PPC_NEW_VERSION' });
    return Programs.get(ctx, { program_id: n.program_id });
  },
  render: function (ctx, rec) {
    var e = DocContent.esc, prof = safeJson(rec.profile_json, {}), content = safeJson(rec.content_json, { sections: [] });
    var client = Repo.get('Clients', rec.client_id) || {}, site = Repo.get('Sites', rec.site_id) || {};
    var draft = rec.status !== 'APPROVED' && rec.status !== 'ARCHIVED', unv = Number(rec.unverified_count) || 0;
    var h = ['<html><head><meta charset="utf-8"><title>' + e(rec.program_id) + '</title><style>' + DocContent.css + '</style></head><body>'];
    h.push(DocContent.approvalBlock(prof.head_name, prof.head_position, client.legal_name));
    h.push('<div class="c title"><h1>ПРОГРАММА<br>производственного контроля</h1><div>за соблюдением санитарных правил и выполнением санитарно-противоэпидемических (профилактических) мероприятий</div><br><div><b>' + e(client.legal_name) + '</b></div><div>' + e(site.site_name) + ', ' + e(site.address) + '</div><br><div class="small muted">' + e(rec.program_id) + ' · версия ' + e(rec.version) + (draft ? ' · ПРОЕКТ' : '') + '</div></div>');
    if (draft) h.push('<div class="warn">Проект документа. Не утверждён.</div>');
    if (unv) h.push('<div class="warn">Документ содержит положений, не сверенных с официальным текстом нормативов: ' + unv + ' (выделены цветом).' + (rec.unverified_reason ? ' Утверждён с обоснованием: ' + e(rec.unverified_reason) : '') + '</div>');
    h.push('<div class="pb"></div>');
    h.push(DocContent.sectionsHtml(content.sections || [], true));
    h.push('<h2>Лист ознакомления</h2><table><tr><th>ФИО</th><th>Должность</th><th>Дата</th><th>Подпись</th></tr>' + new Array(8).join('<tr><td>&nbsp;</td><td></td><td></td><td></td></tr>') + '</table>');
    h.push('<p class="small muted">Сформировано системой ' + e(Settings.get('COMPANY_NAME')) + ' ' + fmtDT(ctx.now) + '. Нормативная база по состоянию на ' + fmtD(content.built_at || ctx.now) + '.</p></body></html>');
    return h.join('');
  },
  html: function (ctx, p) { return { html: Programs.render(ctx, Repo.must('Programs', p.program_id, 'Программа')) }; }
};

/* ---------- Технические условия ---------- */
var Specs = {
  SECTIONS: ['TU_TEXT', 'MICRO', 'TOX', 'METHOD', 'LABEL'],
  groups: function () {
    var g = {};
    Store.all('NormItems').forEach(function (i) { var pg = V.str(i.product_group); if (V.bool(i.active) && (i.section === 'MICRO' || i.section === 'TOX') && pg && pg !== 'all' && pg.charAt(0) !== '~') g[pg] = true; });
    return Object.keys(g).sort();
  },
  /* Группа положения: пусто/all — любая продукция; «~слово» — группы, содержащие слово; иначе точное совпадение */
  match: function (itemGroup, grp) {
    var g = V.str(itemGroup);
    if (!g || g === 'all') return true;
    if (g.charAt(0) === '~') return String(grp).toLowerCase().indexOf(g.slice(1).toLowerCase()) >= 0;
    return g === grp;
  },
  lines: function (s, n) {
    return V.str(s).split('\n').filter(function (l) { return V.str(l); }).map(function (l) {
      var a = l.split(';').map(V.str); while (a.length < n) a.push('');
      return DocContent.row(a.slice(0, n - 1).concat([a.slice(n - 1).join('; ')]), null, null, true);
    });
  },
  profile: function (p) {
    var pr = p || {};
    return {
      product_name: V.str(pr.product_name), product_group: V.str(pr.product_group), okpd2: V.str(pr.okpd2), okpo: V.str(pr.okpo) || Settings.get('ORG_OKPO'),
      purpose: V.str(pr.purpose), composition: V.str(pr.composition), organoleptic: V.str(pr.organoleptic), physchem: V.str(pr.physchem),
      shelf_life: V.str(pr.shelf_life), storage: V.str(pr.storage), packaging: V.str(pr.packaging), net_mass: V.str(pr.net_mass), transport: V.str(pr.transport),
      head_name: V.str(pr.head_name), head_position: V.str(pr.head_position) || 'Руководитель',
      /* Из технико-технологической карты */
      nutrition: V.str(pr.nutrition), technology: V.str(pr.technology), ttk_no: V.str(pr.ttk_no), ttk_file: V.str(pr.ttk_file), ttk_document_id: V.str(pr.ttk_document_id)
    };
  },
  /* Сохранить исходный файл ТТК при ТУ (папка клиента, «Документы») */
  saveTtk: function (ctx, rec, ttk, prof) {
    var b64 = V.str(ttk.data_base64);
    if (!b64) return prof;
    if (b64.length * 3 / 4 > (Settings.num('FILE_MAX_MB') || 15) * 1048576) fail('VALIDATION', 'Файл ТТК больше ' + Settings.num('FILE_MAX_MB') + ' МБ');
    var name = V.str(ttk.file_name) || 'TTK.docx';
    var folder = Integr.ensureFolder(['01_CLIENTS', rec.client_id, 'TU']);
    var saved = Integr.saveFile(folder, rec.spec_id + '_TTK_' + name.replace(/[\\\/:*?"<>|]/g, ''), V.str(ttk.mime_type) || 'application/octet-stream', b64);
    var doc = Repo.create(ctx, 'Documents', { entity_type: 'TechSpecs', entity_id: rec.spec_id, document_type: 'TTK', document_no: V.str(ttk.ttk_no), title: 'ТТК' + (ttk.ttk_no ? ' № ' + ttk.ttk_no : '') + ' — исходный файл для ' + rec.designation,
      file_name: name, mime_type: V.str(ttk.mime_type), size_bytes: saved.size || 0, drive_file_id: saved.fileId, version: 1, approval_status: 'APPROVED', is_actual: true }, { action: 'TTK_UPLOAD' });
    prof.ttk_file = name; prof.ttk_document_id = doc.document_id; if (V.str(ttk.ttk_no)) prof.ttk_no = V.str(ttk.ttk_no);
    return prof;
  },
  designation: function (prof, clientId, existing) {
    if (existing) return existing;
    var n = Repo.where('TechSpecs', function (x) { return x.client_id === clientId && !x.prev_spec_id; }).length + 1;
    var okpd = /^\d{2}\.\d{2}\.\d{2}/.test(prof.okpd2) ? prof.okpd2.slice(0, 8) : 'ХХ.ХХ.ХХ';
    var okpo = /^\d{8}$/.test(prof.okpo) ? prof.okpo : 'ХХХХХХХХ';
    var used = indexBy(Store.all('TechSpecs'), 'designation'), d;
    do { var s = String(n++); while (s.length < 3) s = '0' + s; d = 'ТУ ' + okpd + '-' + s + '-' + okpo + '-' + new Date().getFullYear(); } while (used[d] && okpo !== 'ХХХХХХХХ');
    return d;
  },
  build: function (ctx, p) {
    var old = p.spec_id ? Repo.must('TechSpecs', p.spec_id, 'ТУ') : null;
    if (old && old.status !== 'DRAFT') fail('INVALID_STATUS', 'Пересобрать можно только черновик. Создайте новую версию.');
    var client = Repo.must('Clients', old ? old.client_id : p.client_id, 'Клиент');
    var prof = Specs.profile(p.profile || (old ? safeJson(old.profile_json, {}) : {}));
    V.required(prof, ['product_name', 'product_group'], { product_name: 'Наименование продукции', product_group: 'Группа продукции' });
    var designation = Specs.designation(prof, client.client_id, old ? old.designation : '');
    if (old && !p.ttk && !p.profile) { var op = safeJson(old.profile_json, {}); prof.ttk_file = op.ttk_file || ''; prof.ttk_document_id = op.ttk_document_id || ''; }
    if (old && p.profile && !p.ttk) { var op2 = safeJson(old.profile_json, {}); if (!prof.ttk_document_id) { prof.ttk_file = op2.ttk_file || ''; prof.ttk_document_id = op2.ttk_document_id || ''; } }
    var rec = old;
    if (!old) rec = Repo.create(ctx, 'TechSpecs', { client_id: client.client_id, designation: designation, version: 1, status: 'DRAFT', product_name: prof.product_name, product_group: prof.product_group, okpd2: prof.okpd2 }, { action: 'TU_CREATE' });
    if (p.ttk) prof = Specs.saveTtk(ctx, rec, p.ttk, prof);
    var content = Specs.compose(ctx, client, prof, designation);
    var data = { profile_json: JSON.stringify(prof), content_json: DocContent.serialize(content), unverified_count: DocContent.unverified(content), product_name: prof.product_name, product_group: prof.product_group, okpd2: prof.okpd2 };
    Repo.update(ctx, 'TechSpecs', rec.spec_id, data, { action: old ? 'TU_REBUILD' : 'TU_COMPOSE', noAudit: !old });
    return Specs.get(ctx, { spec_id: rec.spec_id });
  },
  fill: function (t, prof, designation) {
    return String(t || '').replace(/\{product\}/g, prof.product_name).replace(/\{designation\}/g, designation)
      .replace(/\{shelf_life\}/g, prof.shelf_life || '[срок годности]').replace(/\{storage\}/g, prof.storage || '[условия хранения]')
      .replace(/\{packaging\}/g, prof.packaging || '[вид упаковки]').replace(/\{net_mass\}/g, prof.net_mass || '[масса нетто]');
  },
  compose: function (ctx, client, prof, designation) {
    var pk = Norms.pick(ctx, 'TU', Specs.SECTIONS, null);
    var D = pk.docs, R = DocContent.row, grp = prof.product_group;
    var forGroup = function (sec) { return filterBy(pk.items, function (i) { return i.section === sec && Specs.match(i.product_group, grp); }); };
    var texts = {}; forGroup('TU_TEXT').forEach(function (i) { (texts[i.indicator] = texts[i.indicator] || []).push(i); });
    var textSec = function (key, title, extra) {
      var its = texts[key] || [];
      var body = its.map(function (i) { return Specs.fill(i.text, prof, designation); }).join('\n');
      if (extra) body = body ? body + '\n' + extra : extra;
      var v = its.every(function (i) { return V.bool(i.verified) && D[i.norm_id] && V.bool(D[i.norm_id].verified); });
      return DocContent.text(key, title, body || '[заполните раздел]', v && !!body, its.map(function (i) { return Norms.ref(D[i.norm_id], i); }).join('; '));
    };
    /* Порядок разделов — ГОСТ 2.114-2016, п. 5.1.1; подразделы технических требований — п. 5.3.1 */
    var sec = [];
    sec.push(textSec('intro', 'Вводная часть', 'Пример записи продукции при заказе и в документации: «' + prof.product_name + ' ' + designation + '».' + (prof.purpose ? '\nНазначение: ' + prof.purpose + '.' : '')));
    sec.push(textSec('general', '1 Технические требования', prof.ttk_no || prof.ttk_file ? 'Продукцию изготавливают по рецептуре и технологии, установленным технико-технологической картой' + (prof.ttk_no ? ' № ' + prof.ttk_no : '') + ', утверждённой в установленном порядке.' : ''));
    sec.push(DocContent.table('organoleptic', '1.1 Основные параметры и характеристики. Органолептические показатели', ['Показатель', 'Характеристика'], Specs.lines(prof.organoleptic, 2)));
    sec.push(DocContent.table('physchem', '1.1 (продолжение) Физико-химические показатели', ['Показатель', 'Норма'], Specs.lines(prof.physchem, 2)));
    if (V.str(prof.nutrition)) sec.push(DocContent.table('nutrition', '1.1 (продолжение) Пищевая и энергетическая ценность (на 100 г продукции)', ['Показатель', 'Значение'], Specs.lines(prof.nutrition, 2)));
    sec.push(DocContent.table('micro', '1.1 (продолжение) Микробиологические показатели безопасности', ['Показатель', 'Допустимый уровень, не более'],
      forGroup('MICRO').map(function (i) { var r = R([i.indicator || i.text, (i.norm_value || '[внесите норматив]') + (V.str(i.volume) ? ' (' + i.volume + ')' : '')], D[i.norm_id], i); if (!i.norm_value) r.v = false; return r; }),
      'Группа продукции: ' + grp + '. Патогенные микроорганизмы, в том числе сальмонеллы и L. monocytogenes, нормируются по ТР ТС 021/2011.'));
    sec.push(DocContent.table('tox', '1.1 (продолжение) Содержание потенциально опасных веществ', ['Показатель', 'Допустимый уровень'],
      forGroup('TOX').map(function (i) { var r = R([i.indicator || i.text, i.norm_value || '[внесите норматив]'], D[i.norm_id], i); if (!i.norm_value) r.v = false; return r; })));
    sec.push(DocContent.table('recipe', '1.2 Требования к сырью и материалам. Рецептура', ['Наименование сырья', 'Масса нетто, г / требования'], Specs.lines(prof.composition, 2),
      'Сырьё, используемое для изготовления продукции, должно соответствовать требованиям технических регламентов ЕАЭС и сопровождаться документами, подтверждающими его безопасность и прослеживаемость.'));
    sec.push(DocContent.table('labeling', '1.3 Маркировка', ['Требование к маркировке'], forGroup('LABEL').map(function (i) { return R([Specs.fill(i.text, prof, designation)], D[i.norm_id], i); })));
    sec.push(textSec('packaging', '1.4 Упаковка', prof.packaging ? 'Продукцию упаковывают: ' + prof.packaging + (prof.net_mass ? '. Масса нетто: ' + prof.net_mass : '') + '.' : ''));
    sec.push(textSec('safety', '2 Требования безопасности'));
    sec.push(textSec('environment', '3 Требования охраны окружающей среды'));
    sec.push(textSec('acceptance', '4 Правила приёмки'));
    sec.push(DocContent.table('methods', '5 Методы контроля (испытаний)', ['Показатель', 'Метод (нормативный документ)'], forGroup('METHOD').map(function (i) { return R([i.indicator || i.text, i.text], D[i.norm_id], i); })));
    sec.push(textSec('transport', '6 Указания по эксплуатации, в том числе требования хранения, транспортирования и утилизации', 'Срок годности: ' + (prof.shelf_life || '[укажите]') + '. Условия хранения: ' + (prof.storage || '[укажите]') + '.' + (prof.transport ? '\nТранспортирование: ' + prof.transport + '.' : '')));
    sec.push(textSec('warranty', '7 Гарантии изготовителя'));
    var refs = {}; pk.items.forEach(function (i) { if (Specs.match(i.product_group, grp)) refs[i.norm_id] = true; });
    sec.push(DocContent.table('references', 'Перечень документов, на которые даны ссылки', ['Обозначение', 'Наименование'], sortBy(Object.keys(refs).map(function (id) { return D[id]; }), 'code').map(function (d) { return { c: [d.code, d.title], ref: d.code, nid: '', v: V.bool(d.verified) }; })));
    if (/ХХ/.test(designation)) sec[0].v = false;
    return { sections: sec, built_at: ctx.now, norms: Object.keys(refs), designation: designation };
  },
  enrich: function (rec) {
    var o = stripSecrets(rec); delete o.content_json; delete o.profile_json;
    o.client_name = (Repo.get('Clients', rec.client_id) || {}).legal_name || '';
    return o;
  },
  list: function (ctx, p) {
    p = p || {};
    return sortBy(Repo.where('TechSpecs', function (x) { return (!p.client_id || x.client_id === p.client_id) && (p.all || x.status !== 'ARCHIVED'); }), 'updated_at', true).map(Specs.enrich);
  },
  get: function (ctx, p) {
    var rec = Repo.must('TechSpecs', p.spec_id, 'ТУ');
    var content = safeJson(rec.content_json, { sections: [] }), warn = [];
    (content.norms || []).forEach(function (id) { var d = Repo.get('NormDocs', id); if (d && !Norms.inForce(d, ctx.now)) warn.push(d.code + ' больше не действует — пересоберите ТУ.'); });
    if (/ХХ/.test(rec.designation)) warn.push('В обозначении ТУ не заполнены код ОКПД2 или ОКПО — укажите их в данных продукции и пересоберите черновик (для нового обозначения создайте ТУ заново).');
    return { spec: Specs.enrich(rec), row_version: rec.row_version, profile: safeJson(rec.profile_json, {}), content: content, warnings: warn, groups: Specs.groups(),
      history: sortBy(Repo.where('TechSpecs', function (x) { return x.designation === rec.designation; }), 'version', true).map(Specs.enrich) };
  },
  save: function (ctx, p) {
    var rec = Repo.must('TechSpecs', p.spec_id, 'ТУ');
    if (rec.status !== 'DRAFT') fail('INVALID_STATUS', 'Утверждённые ТУ изменить нельзя. Создайте новую версию (изменение).');
    var content = DocContent.merge(safeJson(rec.content_json, { sections: [] }), p.content || {});
    content.designation = rec.designation;
    Repo.update(ctx, 'TechSpecs', rec.spec_id, { content_json: DocContent.serialize(content), unverified_count: DocContent.unverified(content) }, { action: 'TU_EDIT', expectedVersion: p.row_version });
    return Specs.get(ctx, { spec_id: rec.spec_id });
  },
  approve: function (ctx, p) {
    var rec = Repo.must('TechSpecs', p.spec_id, 'ТУ');
    if (/ХХ/.test(rec.designation)) fail('VALIDATION', 'В обозначении ТУ не заполнены коды ОКПД2/ОКПО. Создайте ТУ заново с кодами.');
    var reason = DocContent.checkApproval(ctx, rec, p, 'ТУ');
    Repo.where('TechSpecs', function (x) { return x.designation === rec.designation && x.status === 'APPROVED'; }).forEach(function (x) {
      Repo.update(ctx, 'TechSpecs', x.spec_id, { status: 'ARCHIVED' }, { action: 'TU_ARCHIVE' });
      if (x.document_id) Repo.update(ctx, 'Documents', x.document_id, { approval_status: 'ARCHIVED' }, { action: 'DOC_ARCHIVE' });
    });
    rec = Repo.update(ctx, 'TechSpecs', rec.spec_id, { status: 'APPROVED', approved_by: ctx.actorId, approved_at: ctx.now, unverified_reason: reason }, { action: 'TU_APPROVE' });
    Specs.makePdf(ctx, rec);
    return Specs.get(ctx, { spec_id: rec.spec_id });
  },
  makePdf: function (ctx, rec) {
    try {
      var doc = DocContent.savePdf(ctx, 'TechSpecs', rec.spec_id, rec.client_id, 'TU', 'TU', rec.spec_id + '_TU', rec.designation + ' «' + rec.product_name + '», версия ' + rec.version, rec.version, Specs.render(ctx, rec));
      Repo.update(ctx, 'TechSpecs', rec.spec_id, { document_id: doc.document_id }, { noAudit: true });
      return doc;
    } catch (e) {
      Errors.record(ctx, 'Specs.makePdf', 'PDF_ERROR', 'PDF технических условий не создан, повтор в фоновой задаче', e && e.message, rec.spec_id);
      return null;
    }
  },
  newVersion: function (ctx, p) {
    var rec = Repo.must('TechSpecs', p.spec_id, 'ТУ');
    if (rec.status === 'DRAFT') fail('INVALID_STATUS', 'Это уже черновик — редактируйте его.');
    var draft = Repo.where('TechSpecs', function (x) { return x.designation === rec.designation && x.status === 'DRAFT'; })[0];
    if (draft) fail('DUPLICATE', 'Уже есть черновик изменения: ' + draft.spec_id, { spec_id: draft.spec_id });
    var ver = 1; Repo.where('TechSpecs', function (x) { return x.designation === rec.designation; }).forEach(function (x) { ver = Math.max(ver, Number(x.version) + 1); });
    var n = Repo.create(ctx, 'TechSpecs', { client_id: rec.client_id, designation: rec.designation, product_name: rec.product_name, product_group: rec.product_group, okpd2: rec.okpd2, version: ver, status: 'DRAFT', profile_json: rec.profile_json, content_json: rec.content_json, unverified_count: rec.unverified_count, prev_spec_id: rec.spec_id }, { action: 'TU_NEW_VERSION' });
    return Specs.get(ctx, { spec_id: n.spec_id });
  },
  render: function (ctx, rec) {
    var e = DocContent.esc, prof = safeJson(rec.profile_json, {}), content = safeJson(rec.content_json, { sections: [] });
    var client = Repo.get('Clients', rec.client_id) || {};
    var draft = rec.status !== 'APPROVED' && rec.status !== 'ARCHIVED', unv = Number(rec.unverified_count) || 0;
    var secs = content.sections || [], intro = secs[0] || { text: '' };
    var h = ['<html><head><meta charset="utf-8"><title>' + e(rec.designation) + '</title><style>' + DocContent.css + '</style></head><body>'];
    h.push('<div class="r small">ОКПД2 ' + e(rec.okpd2 || '—') + '</div>');
    h.push(DocContent.approvalBlock(prof.head_name, prof.head_position, client.legal_name));
    h.push('<div class="c title"><h1>' + e(String(rec.product_name).toUpperCase()) + '</h1><div>Технические условия</div><br><div><b>' + e(rec.designation) + '</b></div><br><div>Введены впервые' + (Number(rec.version) > 1 ? ' · изменение ' + (Number(rec.version) - 1) : '') + '</div><div>Дата введения: «___» ____________ 20___ г.</div><br><div>Разработчик: ' + e(client.legal_name) + '</div>' + (draft ? '<div class="small muted">ПРОЕКТ · ' + e(rec.spec_id) + '</div>' : '') + '</div>');
    if (draft) h.push('<div class="warn">Проект документа. Не утверждён.</div>');
    if (unv) h.push('<div class="warn">Документ содержит положений, не сверенных с официальным текстом нормативов: ' + unv + ' (выделены цветом).' + (rec.unverified_reason ? ' Утверждён с обоснованием: ' + e(rec.unverified_reason) : '') + '</div>');
    h.push('<div class="pb"></div><div' + (intro.v === false ? ' class="unv"' : '') + '>' + DocContent.multiline(intro.text) + '</div>');
    h.push(DocContent.sectionsHtml(secs.slice(1), false));
    h.push('<h2>Лист регистрации изменений</h2><table><tr><th>Изм.</th><th>Номера листов (страниц)</th><th>Номер документа</th><th>Подпись</th><th>Дата</th></tr>' + new Array(6).join('<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>') + '</table>');
    h.push('<p class="small muted">Сформировано системой ' + e(Settings.get('COMPANY_NAME')) + ' ' + fmtDT(ctx.now) + '. Нормативная база по состоянию на ' + fmtD(content.built_at || ctx.now) + '.</p></body></html>');
    return h.join('');
  },
  html: function (ctx, p) { return { html: Specs.render(ctx, Repo.must('TechSpecs', p.spec_id, 'ТУ')) }; }
};

/* Фоновая проверка: сроки нормативов, пересмотр ППК, повтор PDF */
var DocJobs = {
  daily: function (ctx) {
    var r = { norms_expiring: Norms.checkExpiry(ctx), ppc_review: 0, docs_pdf_retry: 0 };
    var owners = filterBy(Store.all('Employees'), function (e) { return e.role === 'OWNER' && V.bool(e.active); });
    Store.all('Programs').forEach(function (x) {
      if (x.status !== 'APPROVED') return;
      if (!x.document_id && Programs.makePdf(ctx, x)) r.docs_pdf_retry++;
      if (x.review_due_date && isBefore(x.review_due_date, isoAddDays(ctx.now, 30))) {
        var site = Repo.get('Sites', x.site_id) || {};
        owners.forEach(function (o) { if (Notify.push(ctx, o.employee_id, 'PPC_REVIEW', 'Programs', x.program_id, 'Пересмотр программы ПК: ' + (site.site_name || x.site_id), 'Срок пересмотра программы ' + x.program_id + ' — ' + fmtD(x.review_due_date) + '. Создайте новую версию и пересоберите её по актуальной нормативной базе.', 'ppcrev:' + x.program_id + ':' + x.review_due_date)) r.ppc_review++; });
      }
    });
    Store.all('TechSpecs').forEach(function (x) { if (x.status === 'APPROVED' && !x.document_id && Specs.makePdf(ctx, x)) r.docs_pdf_retry++; });
    return r;
  }
};
