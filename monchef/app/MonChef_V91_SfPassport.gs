/**
 * MonChef V91 — паспорт полуфабриката и валидация срока годности (аудит контура полуфабрикатов, срока годности, ТУ
 * и лаборатории от 23.11.2026, раздел 6, пробелы 3, 4, 6).
 *
 *  Паспорт (проект) — по существующей партии собственного производства: партия, продукт, ТТК и версия, действующие ТУ,
 *  сырьё (партии, поставщики, документы, ВСД), ККТ, бракераж, место хранения, ответственные, исследования лаборатории,
 *  проектный режим технолога, решение специалиста о форме документации (ТТК / ТИ / СТО / ТУ), список пробелов.
 *  PDF с SHA-256; каждое обновление — новая версия. Статус всегда DRAFT_NOT_RELEASE_AUTHORIZATION:
 *  паспорт не меняет срок годности партии, FEFO, этикетки, остатки и допуск.
 *
 *  Программа валидации срока — критерии (показатель, норма, метод, источник; хотя бы один микробиологический —
 *  органолептика безопасность не подтверждает), контрольные точки от 0 до конца заявленного срока, режим хранения.
 *  План утверждает не составитель. Пробы — только через лабораторию V67; фактическое время хранения каждой пробы
 *  считается от начала хранения до отбора; температура за время хранения вносится человеком с источником.
 *  Протокол засчитывается при PASS, файле и SHA-256, лаборатории из реестра аккредитации (проверено человеком,
 *  срок действия, показатель в области аккредитации). Любое FAIL / REVIEW / нет протокола / нарушение режима /
 *  последняя точка короче заявленного срока — положительного заключения нет.
 *  Заключение: рассмотрение (ХАССП / лаборатория) → утверждение уполномоченным лицом (другой сотрудник) →
 *  правило V38 со ссылками на программу, протоколы и отчёт → ввод в действие с даты (не задним числом) отдельным
 *  действием. Правило применяется только к партиям, изготовленным после ввода, и пока действует та же версия ТТК.
 *  Старые партии не продлеваются.
 *
 *  V38: утверждённое правило со сроком годности — только с основанием: нормативный документ из реестра
 *  (действующий или условно применимый), документ изготовителя (для покупного продукта) или утверждённая валидация V91.
 */
var MC_V91_ = {
  P: ['Паспорта_ПФ_V91', ['PassportID', 'Version', 'BatchID', 'ProductionID', 'Product', 'ProductID', 'TTKCode', 'TTKVersion', 'TUID', 'TUVersion', 'DocForm', 'DocFormReason', 'DocFormBy',
    'DocFormAt', 'ProjectJSON', 'ProjectBy', 'ProjectAt', 'StudyID', 'Status', 'GapsJSON', 'FileID', 'URL', 'SHA256', 'CreatedAt', 'CreatedBy', 'OperationID']],
  S: ['Валидация_Сроков_V91', ['StudyID', 'PassportID', 'TTKCode', 'Product', 'TTKVersion', 'BatchID', 'TMin', 'TMax', 'Packaging', 'Transport', 'ClaimedHours', 'CriteriaJSON', 'Rationale',
    'Status', 'CreatedAt', 'CreatedBy', 'CreatedByID', 'PlanApprovedAt', 'PlanApprovedBy', 'StorageStartAt', 'StoragePlace', 'EquipmentID', 'ReviewAt', 'ReviewBy', 'ReviewByID', 'ReviewComment',
    'AuthorizedAt', 'AuthorizedBy', 'AuthComment', 'RuleID', 'ApplyFrom', 'ActivatedBy', 'ReportFileID', 'ReportURL', 'ReportSHA256', 'RejectReason', 'OperationID']],
  T: ['Валидация_Точки_V91', ['PointID', 'StudyID', 'PointNo', 'PlannedHours', 'SampleID', 'SampledAt', 'ActualHours', 'LinkedBy', 'TempMinObs', 'TempMaxObs', 'TempSource', 'TempFileID',
    'TempHash', 'TempBy', 'TempAt', 'Status', 'Note']],
  L: ['Лаборатории_Аккредитация_V91', ['LabID', 'Name', 'AccreditationNo', 'ScopeJSON', 'ValidUntil', 'Status', 'CheckSource', 'CheckedAt', 'CheckedBy', 'EvidenceFileID', 'EvidenceHash', 'Notes']]
};
var MC_V91_PSTATUS_ = 'DRAFT_NOT_RELEASE_AUTHORIZATION';
var MC_V91_FORMS_ = { TTK: 'технико-технологическая карта', TI: 'технологическая инструкция', STO: 'стандарт организации', TU: 'технические условия' };
var MC_V91_GROUPS_ = { MICRO: 'микробиологический', SAFETY: 'показатель безопасности', PHYSCHEM: 'физико-химический', ORGANOLEPTIC: 'органолептический' };
var MC_V91_SRU_ = { DRAFT: 'план составлен', PLAN_APPROVED: 'план утверждён', IN_PROGRESS: 'идёт хранение', REVIEWED: 'рассмотрено — ждёт утверждения', APPROVED: 'срок утверждён', REJECTED: 'отклонено' };

/* ---------------- листы ---------------- */
function _v91Sh_(k) { var d = MC_V91_[k], ss = _book_(), sh = ss.getSheetByName(d[0]); if (!sh) { sh = ss.insertSheet(d[0]); sh.getRange(1, 1, 1, d[1].length).setValues([d[1]]); sh.setFrozenRows(1); } return sh; }
function _v91All_(k) { var sh0 = _book_().getSheetByName(MC_V91_[k][0]); if (!sh0) return []; var v = sh0.getDataRange().getValues(), h = v[0], out = []; for (var i = 1; i < v.length; i++) { if (!v[i][0]) continue; var o = { _row: i + 1 }; h.forEach(function (c, j) { o[c] = v[i][j]; }); out.push(o); } return out; }
function _v91Add_(k, o) { var h = MC_V91_[k][1]; _v91Sh_(k).appendRow(h.map(function (c) { var x = o[c]; return x === undefined || x === null ? '' : x; })); }
function _v91Upd_(k, row, o) { var sh = _v91Sh_(k), h = MC_V91_[k][1]; Object.keys(o).forEach(function (c) { var j = h.indexOf(c); if (j >= 0) sh.getRange(row, j + 1).setValue(o[c] === undefined || o[c] === null ? '' : o[c]); }); }
function _v91Id_(p) { return p + '-' + Utilities.formatDate(new Date(), _mcTz_(), 'yyMMddHHmmss') + '-' + Math.floor(100 + Math.random() * 900); }
function _v91F_(op, code, msg) { try { _endOp_(op, 'FAILED'); } catch (e) {} return _fail_(code, msg, op && op.id); }
function _v91J_(x, d) { try { return x ? JSON.parse(x) : d; } catch (e) { return d; } }
function _v91Fmt_(d) { d = d instanceof Date ? d : _v64Date_(d); return d ? Utilities.formatDate(d, _mcTz_(), 'dd.MM.yyyy HH:mm') : ''; }
function _v91H_(x) { return Math.round(Number(x) * 10) / 10; }
function _v91E_(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function _v91Num_(x) { if (x === '' || x === null || x === undefined) return null; var n = parseFloat(String(x).replace(',', '.')); return isFinite(n) ? n : null; }
function _v91Study_(id) { return _v91All_('S').filter(function (x) { return String(x.StudyID) === String(id); })[0] || null; }
function _v91Points_(id) { return _v91All_('T').filter(function (x) { return String(x.StudyID) === String(id); }).sort(function (a, b) { return Number(a.PlannedHours) - Number(b.PlannedHours); }); }
function _v91Pass_(id) { var l = _v91All_('P').filter(function (x) { return String(x.PassportID) === String(id); }); return l.length ? l[l.length - 1] : null; }

/* ---------------- паспорт ---------------- */
/** Всё, что система знает о партии собственного производства. */
function _v91Ctx_(batchId) {
  var b = _bcFind_(batchId); if (!b) return null;
  var src = String(b.v[7] || ''), m = /^Производство\s+(\S+)/.exec(src), prod = null;
  if (m) { var pv = _productionSheet_().getDataRange().getValues(); for (var i = 1; i < pv.length; i++) if (String(pv[i][0]) === m[1]) { prod = pv[i]; break; } }
  if (!prod) return { b: b, produced: false };
  var code = String(prod[PROD_COL_.code]), dish = null; try { dish = _buildDishIndexes_().dishByCode[code] || null; } catch (e) {}
  var tr = {}; try { tr = _mcTraceSummary_(String(b.v[0])); } catch (e) {}
  var parents = ((tr.whereFrom || {}).parentBatches || []).slice(0, 30).map(function (p) {
    var pb = _bcFind_(p.id), vsd = []; try { vsd = _mvForBatch_(p.id) || []; } catch (e) {}
    return { id: p.id, product: pb ? String(pb.v[1]) : '', qty: p.qty, unit: p.unit, supplier: pb ? String(pb.v[7] || '') : '', doc: pb ? String(pb.v[13] || '') : '', mfgBatch: pb ? String(pb.v[12] || '') : '',
      received: pb ? _v91Fmt_(pb.v[4]) : '', expiry: pb ? _bcDate_(pb.v[5]) : '', vsd: vsd.map(function (x) { return (x.number || x.uuid || x.id) + (x.statusRu ? ' (' + x.statusRu + ')' : ''); }) };
  });
  var tu = null; try { tu = _v66ActiveFor_(code); } catch (e) {}
  var lab = []; try { lab = _v65Rows_('Лаборатория_Исследования').filter(function (r) { return String(r.BatchID) === String(b.v[0]); }).map(function (r) {
    return { indicator: r.Indicator, result: r.Result, protocol: r.ProtocolNo, lab: r.Laboratory, file: !!String(r.FileID || ''), date: _bcDate_(r.ResultDate) }; }); } catch (e) {}
  var brak = null; try { brak = _bcLastDecision_(String(b.v[0]), 'BRAKERAGE'); } catch (e) {}
  return { b: b, produced: true, productionId: String(prod[0]), code: code, name: String(prod[PROD_COL_.name]), ttkVer: prod[PROD_COL_.ver] || '', cook: String(prod[PROD_COL_.emp] || ''),
    started: _v91Fmt_(prod[PROD_COL_.start]), finished: _v91Fmt_(prod[PROD_COL_.finish]), qty: prod[PROD_COL_.fact], unit: String(prod[PROD_COL_.unit] || ''), semi: !!(dish && dish.semi),
    ingredients: dish ? (dish.ing || []).map(function (x) { return x[0] + ' — ' + x[1] + ' ' + x[2]; }) : [], yieldText: dish ? (dish.yield + ' ' + (dish.yieldUnit || '')) : '',
    product: String(b.v[1]), productId: String(b.v[17] || ''), expiry: _bcDate_(b.v[5]), location: String(b.v[14] || (tr.storedAt || '')), status: String(b.v[10] || ''),
    parents: parents, ccp: (tr.ccp || []).map(function (x) { return x.id + ' ' + (x.relation || ''); }), brak: brak, tu: tu, lab: lab };
}
function _v91Gaps_(c, pr, docForm, study) {
  var g = [];
  if (!c.ttkVer) g.push('нет действующей версии ТТК на момент выпуска');
  if (!pr || !pr.claimedHours) g.push('технолог не задал проектный режим (термообработка, охлаждение, упаковка, температура, заявляемый срок)');
  if (!docForm) g.push('специалист не определил форму документации (ТТК, ТИ, СТО или ТУ)');
  if (docForm === 'TU' && !c.tu) g.push('выбраны ТУ, но действующих ТУ на продукт нет');
  if (!c.parents.length) g.push('сырьё партии не прослеживается');
  c.parents.forEach(function (p) { if (!p.supplier && !p.doc) g.push('сырьё ' + p.product + ' (' + p.id + '): нет поставщика и документа'); });
  if (!c.brak) g.push('нет бракеража партии'); else if (c.brak.decision !== 'RELEASE') g.push('бракераж: ' + c.brak.decision);
  if (!c.location) g.push('место хранения партии не указано');
  if (!study) g.push('нет программы валидации срока годности');
  else if (study.Status !== 'APPROVED') g.push('валидация срока: ' + (MC_V91_SRU_[study.Status] || study.Status));
  if (!c.lab.length) g.push('по партии нет исследований лаборатории');
  return g;
}
function _v91PdfPassport_(pid, ver, c, pr, df, study, gaps) {
  var row = function (a, b) { return '<tr><th style="width:34%">' + _v91E_(a) + '</th><td>' + (b === '' || b === null || b === undefined ? '<span class="muted">не указано</span>' : _v91E_(b)) + '</td></tr>'; };
  var h = '<p class="bad"><b>ПРОЕКТ. Не разрешает увеличение срока годности.</b> Паспорт не меняет срок годности партии, FEFO, этикетки, остатки и допуск. Статус: ' + MC_V91_PSTATUS_ + '.</p>' +
    '<h2>1. Идентификация</h2><table class="r">' + row('Паспорт', pid + ', версия ' + ver) + row('Партия', c.b.v[0]) + row('Продукт', c.product) + row('ProductID', c.productId) +
    row('ТТК', c.code + (c.ttkVer ? ', версия ' + c.ttkVer : '')) + row('Действующие ТУ', c.tu ? c.tu.number + ', версия ' + c.tu.version : '') +
    row('Выпуск', c.started + ' — ' + c.finished + ', ' + c.qty + ' ' + c.unit + (c.cook ? ', ' + c.cook : '')) + row('Срок годности партии (без изменений)', c.expiry) + row('Место хранения', c.location) + '</table>' +
    '<h2>2. Состав по ТТК</h2><p>' + (c.ingredients.length ? c.ingredients.map(_v91E_).join('; ') + (c.yieldText ? '. Выход ' + _v91E_(c.yieldText) : '') : '<span class="muted">нет данных</span>') + '</p>' +
    '<h2>3. Сырьё партии</h2><table class="r"><tr><th>Партия</th><th>Продукт</th><th>Кол-во</th><th>Поставщик</th><th>Документ</th><th>ВСД</th><th>Срок</th></tr>' +
    c.parents.map(function (p) { return '<tr><td>' + _v91E_(p.id) + '</td><td>' + _v91E_(p.product) + '</td><td>' + _v91E_(p.qty + ' ' + (p.unit || '')) + '</td><td>' + _v91E_(p.supplier) + '</td><td>' + _v91E_(p.doc) + '</td><td>' + _v91E_(p.vsd.join(', ') || '—') + '</td><td>' + _v91E_(p.expiry) + '</td></tr>'; }).join('') + '</table>' +
    '<h2>4. Контроль</h2><table class="r">' + row('ККТ', c.ccp.join('; ') || 'нет записей') + row('Бракераж', c.brak ? c.brak.decision + ' ' + _v91Fmt_(c.brak.at) + ' ' + (c.brak.who || '') : '') +
    row('Исследования', c.lab.map(function (x) { return x.indicator + ': ' + x.result + ' (протокол ' + x.protocol + ', ' + x.lab + (x.file ? '' : ', без файла') + ')'; }).join('; ')) + '</table>' +
    '<h2>5. Проектный режим (вносит технолог; проектные значения)</h2><table class="r">' + row('Состав (ссылка)', pr.compositionRef) + row('Термообработка', pr.heatTreatment) + row('Охлаждение', pr.cooling) + row('Упаковка', pr.packaging) +
    row('Температура хранения', pr.tMin !== undefined && pr.tMin !== '' ? pr.tMin + '…' + pr.tMax + ' °C' : '') + row('Заявляемый срок (проект)', pr.claimedHours ? pr.claimedHours + ' ч' : '') + row('Назначение', pr.purpose) + row('Внёс', pr.by) + '</table>' +
    '<h2>6. Форма документации</h2><p>' + (df.form ? _v91E_(MC_V91_FORMS_[df.form] + ' — ' + df.reason + ' (' + df.by + ')') : '<span class="muted">не определена специалистом</span>') + '</p>' +
    '<h2>7. Валидация срока годности</h2><p>' + (study ? _v91E_(study.StudyID + ': ' + (MC_V91_SRU_[study.Status] || study.Status) + (study.RuleID ? ', правило ' + study.RuleID : '')) : '<span class="muted">программы нет</span>') + '</p>' +
    '<h2>8. Пробелы</h2>' + (gaps.length ? '<ol>' + gaps.map(function (x) { return '<li>' + _v91E_(x) + '</li>'; }).join('') + '</ol>' : '<p>Пробелов не найдено.</p>');
  return _mcPdfSave_('Паспорт полуфабриката (проект)', h, { fileName: 'Паспорт ПФ ' + c.b.v[0] + ' v' + ver, subtitle: c.product + ' · партия ' + c.b.v[0], footer: 'проект, не разрешает увеличение срока' });
}
function _v91BuildPassport_(batchId, op, patch) {
  var c = _v91Ctx_(batchId); if (!c) return { error: ['NOT_FOUND', 'Партия не найдена'] };
  if (!c.produced) return { error: ['VALIDATION', 'Паспорт формируется по партии собственного производства (выпуск по ТТК)'] };
  var pid = 'PFP-' + c.b.v[0], prev = _v91Pass_(pid), w = _v65Who_(op), now = new Date();
  var pr = _v91J_(prev && prev.ProjectJSON, {}), df = { form: prev ? String(prev.DocForm || '') : '', reason: prev ? String(prev.DocFormReason || '') : '', by: prev ? String(prev.DocFormBy || '') : '', at: prev ? prev.DocFormAt : '' };
  if (patch && patch.project) pr = patch.project;
  if (patch && patch.docForm) df = patch.docForm;
  var study = _v91All_('S').filter(function (s) { return String(s.TTKCode) === c.code; }).pop() || null;
  var gaps = _v91Gaps_(c, pr, df.form, study), ver = prev ? Number(prev.Version || 0) + 1 : 1;
  var pdf = null; try { pdf = _v91PdfPassport_(pid, ver, c, pr, df, study, gaps); } catch (e) { pdf = null; }
  _v91Add_('P', { PassportID: pid, Version: ver, BatchID: c.b.v[0], ProductionID: c.productionId, Product: c.product, ProductID: c.productId, TTKCode: c.code, TTKVersion: c.ttkVer,
    TUID: c.tu ? c.tu.tuId : '', TUVersion: c.tu ? c.tu.version : '', DocForm: df.form, DocFormReason: df.reason, DocFormBy: df.by, DocFormAt: df.at || '', ProjectJSON: JSON.stringify(pr),
    ProjectBy: pr.by || '', ProjectAt: pr.at || '', StudyID: study ? study.StudyID : '', Status: MC_V91_PSTATUS_, GapsJSON: JSON.stringify(gaps), FileID: pdf ? pdf.fileId : '', URL: pdf ? pdf.url : '',
    SHA256: pdf ? pdf.sha256 : '', CreatedAt: now, CreatedBy: w.name, OperationID: op.id });
  return { passportId: pid, version: ver, batchId: c.b.v[0], product: c.product, gaps: gaps, url: pdf ? pdf.url : '', sha256: pdf ? pdf.sha256 : '', status: MC_V91_PSTATUS_,
    statusRu: 'проект, не разрешает увеличение срока', expiry: c.expiry };
}
/** Сформировать или обновить паспорт партии (новая версия; срок годности партии не меняется). */
function v91PassportBuild(json, token) {
  var op = null; try { op = _beginOp_(token, 'tu_edit|tu_approve|haccp', 'V91_PASSPORT', 'Паспорт ПФ', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json); if (!d.batchId) return _v91F_(op, 'VALIDATION', 'Укажите партию');
    return _withLock_(function () {
      var exp0 = (_bcFind_(d.batchId) || { v: [] }).v[5], r = _v91BuildPassport_(String(d.batchId), op);
      if (r.error) return _v91F_(op, r.error[0], r.error[1]);
      var exp1 = (_bcFind_(d.batchId) || { v: [] }).v[5]; r.expiryUnchanged = String(exp0) === String(exp1);
      _audit_(op, 'V91_PASSPORT', 'Паспорта_ПФ_V91', r.passportId, null, { version: r.version, gaps: r.gaps.length, sha256: r.sha256 });
      _endOp_(op); return _ok_(r, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Проектный режим технолога (проектные значения, не разрешение). */
function v91PassportProject(json, token) {
  var op = null; try { op = _beginOp_(token, 'tu_edit|haccp', 'V91_PROJECT', 'Паспорт ПФ', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), p = _v91Pass_(d.passportId); if (!p) return _v91F_(op, 'NOT_FOUND', 'Паспорт не найден');
    var tMin = _v91Num_(d.tMin), tMax = _v91Num_(d.tMax), h = _v91Num_(d.claimedHours);
    if (tMin === null || tMax === null || !(tMin < tMax)) return _v91F_(op, 'VALIDATION', 'Укажите диапазон температуры хранения: от и до (от меньше до)');
    if (!(h > 0)) return _v91F_(op, 'VALIDATION', 'Укажите заявляемый срок в часах');
    var need = [['heatTreatment', 'термообработку'], ['cooling', 'охлаждение'], ['packaging', 'упаковку'], ['purpose', 'назначение продукта']].filter(function (x) { return !String(d[x[0]] || '').trim(); });
    if (need.length) return _v91F_(op, 'VALIDATION', 'Укажите ' + need.map(function (x) { return x[1]; }).join(', '));
    var w = _v65Who_(op);
    var pr = { compositionRef: String(d.compositionRef || ''), heatTreatment: String(d.heatTreatment), cooling: String(d.cooling), packaging: String(d.packaging), tMin: tMin, tMax: tMax, claimedHours: h, purpose: String(d.purpose), by: w.name, at: new Date().toISOString() };
    return _withLock_(function () {
      var r = _v91BuildPassport_(String(p.BatchID), op, { project: pr }); if (r.error) return _v91F_(op, r.error[0], r.error[1]);
      _audit_(op, 'V91_PROJECT', 'Паспорта_ПФ_V91', r.passportId, null, pr); _endOp_(op); return _ok_(r, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Форма документации — решение специалиста с обоснованием (система не выбирает её сама). */
function v91PassportDocForm(json, token) {
  var op = null; try { op = _beginOp_(token, 'tu_edit|tu_approve|haccp', 'V91_DOCFORM', 'Паспорт ПФ', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), p = _v91Pass_(d.passportId); if (!p) return _v91F_(op, 'NOT_FOUND', 'Паспорт не найден');
    var f = String(d.form || '').toUpperCase(); if (!MC_V91_FORMS_[f]) return _v91F_(op, 'VALIDATION', 'Выберите форму: ТТК, ТИ, СТО или ТУ');
    if (String(d.reason || '').trim().length < 15) return _v91F_(op, 'VALIDATION', 'Обоснуйте выбор: категория продукции, модель деятельности, применимые требования');
    var w = _v65Who_(op);
    return _withLock_(function () {
      var r = _v91BuildPassport_(String(p.BatchID), op, { docForm: { form: f, reason: String(d.reason).trim(), by: w.name, at: new Date() } }); if (r.error) return _v91F_(op, r.error[0], r.error[1]);
      _audit_(op, 'V91_DOCFORM', 'Паспорта_ПФ_V91', r.passportId, p.DocForm, { form: f, reason: d.reason }); _endOp_(op); return _ok_(r, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- программа валидации ---------------- */
function v91StudyCreate(json, token) {
  var op = null; try { op = _beginOp_(token, 'tu_edit|haccp|lab_edit', 'V91_STUDY', 'Валидация срока', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), p = _v91Pass_(d.passportId); if (!p) return _v91F_(op, 'NOT_FOUND', 'Паспорт не найден — сначала сформируйте паспорт партии');
    var pr = _v91J_(p.ProjectJSON, {});
    if (!pr.claimedHours) return _v91F_(op, 'VALIDATION', 'Сначала технолог задаёт проектный режим и заявляемый срок');
    var claimed = _v91Num_(d.claimedHours !== undefined && d.claimedHours !== '' ? d.claimedHours : pr.claimedHours), tMin = _v91Num_(d.tMin !== undefined && d.tMin !== '' ? d.tMin : pr.tMin), tMax = _v91Num_(d.tMax !== undefined && d.tMax !== '' ? d.tMax : pr.tMax);
    if (!(claimed > 0) || tMin === null || tMax === null || !(tMin < tMax)) return _v91F_(op, 'VALIDATION', 'Заявляемый срок и диапазон температуры хранения обязательны');
    var pack = String(d.packaging || pr.packaging || '').trim(); if (!pack) return _v91F_(op, 'VALIDATION', 'Укажите упаковку');
    var crit = [];
    if (d.criteriaFromTU) {
      var tu = null; try { tu = _v66ActiveFor_(String(p.TTKCode)); } catch (e) {}
      if (!tu) return _v91F_(op, 'VALIDATION', 'Действующих ТУ на продукт нет — введите критерии вручную');
      _v66Objs_('IND', function (x) { return x.VersionID === tu.versionId && _v65On_(x.Mandatory); }).forEach(function (x) {
        crit.push({ indicator: String(x.Indicator), group: MC_V91_GROUPS_[String(x.Group)] ? String(x.Group) : 'SAFETY', normMin: x.NormMin, normMax: x.NormMax, normText: x.NormText || '', method: x.MethodID || x.Method || '', source: 'ТУ ' + tu.number + ', версия ' + tu.version }); });
    }
    (d.criteria || []).forEach(function (x) { if (x && String(x.indicator || '').trim()) crit.push({ indicator: String(x.indicator).trim(), group: String(x.group || '').toUpperCase(), normMin: x.normMin === undefined ? '' : x.normMin, normMax: x.normMax === undefined ? '' : x.normMax, normText: String(x.normText || ''), method: String(x.method || ''), source: String(x.source || '').trim() }); });
    if (!crit.length) return _v91F_(op, 'VALIDATION', 'Добавьте критерии: показатель, норма, метод, источник нормы');
    for (var i = 0; i < crit.length; i++) {
      var c = crit[i]; if (!MC_V91_GROUPS_[c.group]) return _v91F_(op, 'VALIDATION', '«' + c.indicator + '»: группа — микробиологический, безопасность, физико-химический или органолептический');
      if ((c.normMin === '' || c.normMin === null) && (c.normMax === '' || c.normMax === null) && !c.normText) return _v91F_(op, 'VALIDATION', '«' + c.indicator + '»: укажите норму (предел или текст нормы)');
      if (!c.source) return _v91F_(op, 'VALIDATION', '«' + c.indicator + '»: укажите источник нормы (документ, пункт)');
    }
    if (!crit.some(function (c) { return c.group === 'MICRO'; })) return _v91F_(op, 'VALIDATION', 'Нужен хотя бы один микробиологический показатель: органолептика не подтверждает микробиологическую безопасность');
    var pts = (d.points || []).map(_v91Num_).filter(function (x) { return x !== null && x >= 0; }).sort(function (a, b) { return a - b; }).filter(function (x, i, a) { return !i || x !== a[i - 1]; });
    if (pts[0] !== 0) return _v91F_(op, 'VALIDATION', 'Нужна точка 0 — исходное состояние');
    if (!(pts[pts.length - 1] >= claimed)) return _v91F_(op, 'VALIDATION', 'Последняя точка должна быть не раньше конца заявляемого срока (' + claimed + ' ч)');
    if (pts.length > 12) return _v91F_(op, 'VALIDATION', 'Не больше 12 точек');
    if (String(d.rationale || '').trim().length < 15) return _v91F_(op, 'VALIDATION', 'Обоснование плана: кто составил (технолог, лаборатория) и на чём основаны точки и показатели');
    if (_v91All_('S').some(function (s) { return String(s.TTKCode) === String(p.TTKCode) && /^(DRAFT|PLAN_APPROVED|IN_PROGRESS|REVIEWED)$/.test(String(s.Status)); }))
      return _v91F_(op, 'DUPLICATE', 'По этой ТТК уже идёт программа валидации — завершите или отклоните её');
    var w = _v65Who_(op), id = _v91Id_('VAL'), now = new Date();
    return _withLock_(function () {
      _v91Add_('S', { StudyID: id, PassportID: p.PassportID, TTKCode: p.TTKCode, Product: p.Product, TTKVersion: p.TTKVersion, BatchID: p.BatchID, TMin: tMin, TMax: tMax, Packaging: pack, Transport: String(d.transport || ''),
        ClaimedHours: claimed, CriteriaJSON: JSON.stringify(crit), Rationale: String(d.rationale).trim(), Status: 'DRAFT', CreatedAt: now, CreatedBy: w.name, CreatedByID: w.id, OperationID: op.id });
      pts.forEach(function (h, k) { _v91Add_('T', { PointID: id + '-P' + k, StudyID: id, PointNo: k, PlannedHours: h, Status: 'PLANNED' }); });
      _audit_(op, 'V91_STUDY', 'Валидация_Сроков_V91', id, null, { passport: p.PassportID, claimed: claimed, points: pts, criteria: crit.length });
      _endOp_(op); return _ok_({ studyId: id, points: pts, criteria: crit, warnings: pts.length < 3 ? ['промежуточных точек нет — добавьте по оценке риска'] : [] }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function v91StudyApprovePlan(json, token) {
  var op = null; try { op = _beginOp_(token, 'haccp|tu_approve|lab_approve', 'V91_PLAN', 'Валидация срока', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), s = _v91Study_(d.studyId); if (!s) return _v91F_(op, 'NOT_FOUND', 'Программа не найдена');
    if (s.Status !== 'DRAFT') return _v91F_(op, 'VALIDATION', 'План уже ' + (MC_V91_SRU_[s.Status] || s.Status));
    var w = _v65Who_(op); if (w.id && String(s.CreatedByID) === w.id) return _v91F_(op, 'SAME_PERSON', 'План утверждает не тот, кто его составил');
    if (d.confirm !== true) return _v91F_(op, 'CONFIRM_REQUIRED', 'Подтвердите: показатели, нормы, точки и режим хранения проверены');
    return _withLock_(function () { _v91Upd_('S', s._row, { Status: 'PLAN_APPROVED', PlanApprovedAt: new Date(), PlanApprovedBy: w.name }); _audit_(op, 'V91_PLAN', 'Валидация_Сроков_V91', s.StudyID, 'DRAFT', 'PLAN_APPROVED'); _endOp_(op); return _ok_({ studyId: s.StudyID, status: 'PLAN_APPROVED' }, op.id); });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Начало хранения образцов партии в режиме программы (точка 0 отбирается сразу). */
function v91StudyStart(json, token) {
  var op = null; try { op = _beginOp_(token, 'tu_edit|lab_edit|haccp', 'V91_START', 'Валидация срока', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), s = _v91Study_(d.studyId); if (!s) return _v91F_(op, 'NOT_FOUND', 'Программа не найдена');
    if (s.Status !== 'PLAN_APPROVED') return _v91F_(op, 'VALIDATION', 'Хранение начинается после утверждения плана');
    if (!String(d.storagePlace || '').trim()) return _v91F_(op, 'VALIDATION', 'Укажите место хранения образцов (холодильник, камера)');
    var b = _bcFind_(s.BatchID); if (!b) return _v91F_(op, 'NOT_FOUND', 'Партия программы не найдена');
    if (String(b.v[10]) === 'blocked') return _v91F_(op, 'VALIDATION', 'Партия забракована');
    var now = new Date(), w = _v65Who_(op);
    return _withLock_(function () { _v91Upd_('S', s._row, { Status: 'IN_PROGRESS', StorageStartAt: now, StoragePlace: String(d.storagePlace).trim(), EquipmentID: String(d.equipmentId || '') });
      _audit_(op, 'V91_START', 'Валидация_Сроков_V91', s.StudyID, 'PLAN_APPROVED', { start: now, place: d.storagePlace, by: w.name }); _endOp_(op);
      return _ok_({ studyId: s.StudyID, storageStartAt: _v91Fmt_(now), schedule: _v91Points_(s.StudyID).map(function (p) { return { no: p.PointNo, hours: p.PlannedHours, due: _v91Fmt_(new Date(now.getTime() + Number(p.PlannedHours) * 3600000)) }; }) }, op.id); });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Привязать пробу V67 к точке: фактическое время хранения = отбор − начало хранения. */
function v91PointSample(json, token) {
  var op = null; try { op = _beginOp_(token, 'lab_edit|lab|tu_edit', 'V91_POINT', 'Валидация срока', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), p = _v91All_('T').filter(function (x) { return x.PointID === d.pointId; })[0]; if (!p) return _v91F_(op, 'NOT_FOUND', 'Точка не найдена');
    var s = _v91Study_(p.StudyID); if (!s || s.Status !== 'IN_PROGRESS') return _v91F_(op, 'VALIDATION', 'Пробы привязываются, пока идёт хранение');
    if (p.SampleID) return _v91F_(op, 'VALIDATION', 'К точке уже привязана проба ' + p.SampleID);
    var smp = _v65Rows_('Лаборатория_Отбор').filter(function (x) { return String(x.SampleID) === String(d.sampleId); })[0];
    if (!smp) return _v91F_(op, 'NOT_FOUND', 'Проба не найдена — отберите её на экране «Лаборатория»');
    if (String(smp.BatchID) !== String(s.BatchID)) return _v91F_(op, 'VALIDATION', 'Проба от другой партии: в программе — партия ' + s.BatchID);
    if (_v91All_('T').some(function (x) { return String(x.SampleID) === String(d.sampleId); })) return _v91F_(op, 'DUPLICATE', 'Эта проба уже привязана к точке');
    var at = _v64Date_(smp.SampledAt), st = _v64Date_(s.StorageStartAt);
    if (!at || !st || at.getTime() < st.getTime() - 60000) return _v91F_(op, 'VALIDATION', 'Проба отобрана до начала хранения по программе (' + _v91Fmt_(st) + ')');
    var hrs = _v91H_((at.getTime() - st.getTime()) / 3600000), w = _v65Who_(op), note = hrs < Number(p.PlannedHours) ? 'отобрано раньше плана: ' + hrs + ' ч из ' + p.PlannedHours + ' ч — точка подтверждает только ' + hrs + ' ч' : '';
    return _withLock_(function () { _v91Upd_('T', p._row, { SampleID: smp.SampleID, SampledAt: at, ActualHours: hrs, LinkedBy: w.name, Status: 'SAMPLED', Note: note });
      _audit_(op, 'V91_POINT', 'Валидация_Точки_V91', p.PointID, null, { sample: smp.SampleID, hours: hrs }); _endOp_(op); return _ok_({ pointId: p.PointID, actualHours: hrs, planned: Number(p.PlannedHours), note: note }, op.id); });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Температура хранения образцов за период до отбора точки: наименьшая и наибольшая, источник (журнал, логгер). */
function v91PointTemps(json, token) {
  var op = null; try { op = _beginOp_(token, 'tu_edit|lab_edit|haccp', 'V91_TEMPS', 'Валидация срока', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), p = _v91All_('T').filter(function (x) { return x.PointID === d.pointId; })[0]; if (!p) return _v91F_(op, 'NOT_FOUND', 'Точка не найдена');
    if (!p.SampleID) return _v91F_(op, 'VALIDATION', 'Сначала привяжите пробу точки — температура вносится за период хранения до отбора');
    if (p.TempMinObs !== '' || p.TempMaxObs !== '') return _v91F_(op, 'ALREADY_RECORDED', 'Температура по точке уже внесена (' + p.TempMinObs + '…' + p.TempMaxObs + ' °C, ' + p.TempSource + ') — запись не перезаписывается; нарушение режима оформляется отклонением программы');
    var lo = _v91Num_(d.tMinObs), hi = _v91Num_(d.tMaxObs); if (lo === null || hi === null || lo > hi) return _v91F_(op, 'VALIDATION', 'Введите измеренные наименьшую и наибольшую температуру за период хранения');
    if (String(d.source || '').trim().length < 5) return _v91F_(op, 'VALIDATION', 'Укажите источник: журнал температур, логгер (номер), прибор');
    var f = d.file ? _v67File_(d.file, 'Температура ' + p.PointID) : null, w = _v65Who_(op), s = _v91Study_(p.StudyID);
    return _withLock_(function () { _v91Upd_('T', p._row, { TempMinObs: lo, TempMaxObs: hi, TempSource: String(d.source).trim(), TempFileID: f ? f.fileId : '', TempHash: f ? f.sha256 : '', TempBy: w.name, TempAt: new Date() });
      var dev = s && (lo < Number(s.TMin) || hi > Number(s.TMax));
      _audit_(op, 'V91_TEMPS', 'Валидация_Точки_V91', p.PointID, null, { min: lo, max: hi, source: d.source, deviation: !!dev }); _endOp_(op);
      return _ok_({ pointId: p.PointID, deviation: !!dev, regime: s ? s.TMin + '…' + s.TMax + ' °C' : '' }, op.id); });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- реестр аккредитации лабораторий ---------------- */
function v91LabSave(json, token) {
  var op = null; try { op = _beginOp_(token, 'lab_approve', 'V91_LAB', 'Лаборатории', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), name = String(d.name || '').trim(), no = String(d.accreditationNo || '').trim(), st = String(d.status || 'VERIFIED').toUpperCase();
    if (!name || !no) return _v91F_(op, 'VALIDATION', 'Укажите лабораторию и номер аттестата аккредитации');
    if (['VERIFIED', 'SUSPENDED'].indexOf(st) < 0) return _v91F_(op, 'VALIDATION', 'Статус: VERIFIED (проверено) или SUSPENDED (приостановлено)');
    var scope = (Array.isArray(d.scope) ? d.scope : String(d.scope || '').split(/[\n;]+/)).map(function (x) { return String(x).trim(); }).filter(Boolean);
    if (st === 'VERIFIED' && !scope.length) return _v91F_(op, 'VALIDATION', 'Перечислите показатели из области аккредитации (по приложению к аттестату)');
    var vu = _v64Date_(d.validUntil); if (st === 'VERIFIED' && d.validUntil && !vu) return _v91F_(op, 'VALIDATION', 'Срок действия не распознан');
    if (String(d.checkSource || '').trim().length < 10) return _v91F_(op, 'VALIDATION', 'Где проверено: реестр аккредитованных лиц (дата проверки), аттестат, область аккредитации');
    var f = d.evidence ? _v67File_(d.evidence, 'Аккредитация ' + name) : null, w = _v65Who_(op), now = new Date();
    return _withLock_(function () {
      var ex = _v91All_('L').filter(function (x) { return _v64Key_(x.Name) === _v64Key_(name); })[0], o = { LabID: ex ? ex.LabID : _v91Id_('LAB'), Name: name, AccreditationNo: no, ScopeJSON: JSON.stringify(scope), ValidUntil: vu || '',
        Status: st, CheckSource: String(d.checkSource).trim(), CheckedAt: now, CheckedBy: w.name, EvidenceFileID: f ? f.fileId : (ex ? ex.EvidenceFileID : ''), EvidenceHash: f ? f.sha256 : (ex ? ex.EvidenceHash : ''), Notes: String(d.notes || '') };
      if (ex) _v91Upd_('L', ex._row, o); else _v91Add_('L', o);
      _audit_(op, 'V91_LAB', 'Лаборатории_Аккредитация_V91', o.LabID, ex ? { status: ex.Status } : null, { status: st, no: no, scope: scope.length }); _endOp_(op); return _ok_({ labId: o.LabID, status: st, scope: scope }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- оценка доказательств ---------------- */
function _v91Eval_(s) {
  var crit = _v91J_(s.CriteriaJSON, []), pts = _v91Points_(s.StudyID), res = _v65Rows_('Лаборатория_Исследования'), labs = _v91All_('L'), out = [], confirmed = null, chain = true, anyFail = false;
  pts.forEach(function (p) {
    var o = { pointId: p.PointID, no: Number(p.PointNo), planned: Number(p.PlannedHours), actual: p.ActualHours === '' ? null : Number(p.ActualHours), sampleId: String(p.SampleID || ''), items: [], blockers: [], status: 'OK',
      temps: p.TempMinObs === '' ? '' : p.TempMinObs + '…' + p.TempMaxObs + ' °C (' + p.TempSource + ')', note: String(p.Note || '') };
    if (!o.sampleId) { o.blockers.push('нет пробы'); o.status = 'WAITING'; }
    else crit.forEach(function (c) {
      var rows = res.filter(function (r) { return String(r.SampleID) === o.sampleId && _v64Key_(r.Indicator) === _v64Key_(c.indicator) && String(r.Result) !== 'PENDING'; }), r = rows[rows.length - 1];
      if (!r) { o.blockers.push(c.indicator + ': нет протокола'); o.items.push({ indicator: c.indicator, result: 'MISSING' }); return; }
      var ev = _v67Eval_(r.FactValue, c.normMin, c.normMax, c.normText), it = { indicator: c.indicator, result: String(r.Result), byCriterion: ev, fact: r.FactValue, protocol: r.ProtocolNo, lab: r.Laboratory };
      o.items.push(it);
      if (String(r.Result) === 'FAIL' || ev === 'FAIL') { anyFail = true; o.blockers.push(c.indicator + ': не соответствует (' + r.FactValue + ', протокол ' + r.ProtocolNo + ')'); }
      else if (String(r.Result) !== 'PASS' || ev !== 'PASS') o.blockers.push(c.indicator + ': требует экспертной оценки (' + r.FactValue + ')');
      if (!String(r.FileID || '').trim() || !String(r.Hash || '').trim()) o.blockers.push(c.indicator + ': протокол ' + r.ProtocolNo + ' без файла и SHA-256');
      var lab = labs.filter(function (l) { return _v64Key_(l.Name) === _v64Key_(r.Laboratory); })[0], rd = _v64Date_(r.ResultDate), vu = lab ? _v64Date_(lab.ValidUntil) : null;
      if (!lab) o.blockers.push(c.indicator + ': лаборатория «' + r.Laboratory + '» не внесена в реестр аккредитации');
      else if (String(lab.Status) !== 'VERIFIED') o.blockers.push(c.indicator + ': аккредитация лаборатории «' + lab.Name + '» не подтверждена');
      else {
        if (vu && rd && rd.getTime() > vu.getTime() + 86399000) o.blockers.push(c.indicator + ': аккредитация «' + lab.Name + '» истекла на дату результата');
        if (!_v91J_(lab.ScopeJSON, []).some(function (x) { return _v64Key_(x) === _v64Key_(c.indicator); })) o.blockers.push(c.indicator + ': показатель вне области аккредитации «' + lab.Name + '»');
      }
    });
    if (o.sampleId) {
      if (p.TempMinObs === '' || p.TempMaxObs === '') o.blockers.push('нет записи температуры хранения за период');
      else if (Number(p.TempMinObs) < Number(s.TMin) || Number(p.TempMaxObs) > Number(s.TMax)) o.blockers.push('нарушение режима хранения: ' + p.TempMinObs + '…' + p.TempMaxObs + ' °C при режиме ' + s.TMin + '…' + s.TMax + ' °C');
    }
    if (o.blockers.length && o.status !== 'WAITING') o.status = o.blockers.some(function (x) { return /не соответствует/.test(x); }) ? 'FAIL' : o.blockers.some(function (x) { return /нарушение режима/.test(x); }) ? 'DEVIATION' : 'INCOMPLETE';
    if (chain && o.status === 'OK') confirmed = o.actual; else chain = false;
    out.push(o);
  });
  var claimed = Number(s.ClaimedHours), blockers = [];
  out.forEach(function (o) { o.blockers.forEach(function (b) { blockers.push('точка ' + o.no + ' (' + o.planned + ' ч): ' + b); }); });
  var last = out[out.length - 1];
  if (last && last.status === 'OK' && last.actual !== null && last.actual < claimed) blockers.push('последняя точка: фактическое хранение ' + last.actual + ' ч меньше заявленного срока ' + claimed + ' ч');
  return { points: out, blockers: blockers, anyFail: anyFail, confirmedHours: confirmed, claimedHours: claimed, complete: !blockers.length && !!out.length };
}
/** Рассмотрение доказательств: ответственный за ХАССП / лаборатория. */
function v91StudyReview(json, token) {
  var op = null; try { op = _beginOp_(token, 'haccp|lab_approve', 'V91_REVIEW', 'Валидация срока', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), s = _v91Study_(d.studyId); if (!s) return _v91F_(op, 'NOT_FOUND', 'Программа не найдена');
    if (s.Status !== 'IN_PROGRESS') return _v91F_(op, 'VALIDATION', 'Рассматривается программа, по которой идёт хранение');
    var dec = String(d.decision || '').toUpperCase(), cm = String(d.comment || '').trim(), w = _v65Who_(op), E = _v91Eval_(s);
    if (dec === 'REJECT') { if (cm.length < 10) return _v91F_(op, 'VALIDATION', 'Укажите причину отклонения');
      return _withLock_(function () { _v91Upd_('S', s._row, { Status: 'REJECTED', RejectReason: cm, ReviewAt: new Date(), ReviewBy: w.name, ReviewByID: w.id, ReviewComment: cm }); _audit_(op, 'V91_REVIEW', 'Валидация_Сроков_V91', s.StudyID, 'IN_PROGRESS', 'REJECTED'); _endOp_(op); return _ok_({ studyId: s.StudyID, status: 'REJECTED' }, op.id); }); }
    if (dec !== 'CONFIRM') return _v91F_(op, 'VALIDATION', 'Решение: CONFIRM (доказательства достаточны) или REJECT');
    if (!E.complete) return _v91F_(op, E.anyFail ? 'NONCONFORMING' : 'EVIDENCE_INCOMPLETE', 'Положительное заключение невозможно: ' + E.blockers.slice(0, 6).join('; ') + (E.blockers.length > 6 ? '; …ещё ' + (E.blockers.length - 6) : ''));
    if (cm.length < 10) return _v91F_(op, 'VALIDATION', 'Заключение: что рассмотрено (протоколы, лаборатории, методы, режим, применимость нормативов)');
    return _withLock_(function () { _v91Upd_('S', s._row, { Status: 'REVIEWED', ReviewAt: new Date(), ReviewBy: w.name, ReviewByID: w.id, ReviewComment: cm }); _audit_(op, 'V91_REVIEW', 'Валидация_Сроков_V91', s.StudyID, 'IN_PROGRESS', 'REVIEWED'); _endOp_(op);
      return _ok_({ studyId: s.StudyID, status: 'REVIEWED', confirmedHours: E.confirmedHours }, op.id); });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function _v91Report_(s, E, auth) {
  var crit = _v91J_(s.CriteriaJSON, []);
  var h = '<h2>1. Программа</h2><table class="r"><tr><th>Программа</th><td>' + _v91E_(s.StudyID) + '</td></tr><tr><th>Продукт / ТТК</th><td>' + _v91E_(s.Product + ' · ' + s.TTKCode + (s.TTKVersion ? ', версия ' + s.TTKVersion : '')) + '</td></tr>' +
    '<tr><th>Партия</th><td>' + _v91E_(s.BatchID) + '</td></tr><tr><th>Режим</th><td>' + _v91E_(s.TMin + '…' + s.TMax + ' °C, упаковка: ' + s.Packaging + (s.Transport ? ', транспортировка: ' + s.Transport : '')) + '</td></tr>' +
    '<tr><th>Заявляемый срок</th><td>' + _v91E_(s.ClaimedHours + ' ч') + '</td></tr><tr><th>Обоснование плана</th><td>' + _v91E_(s.Rationale) + '</td></tr><tr><th>План составил / утвердил</th><td>' + _v91E_(s.CreatedBy + ' / ' + s.PlanApprovedBy + ' ' + _v91Fmt_(s.PlanApprovedAt)) + '</td></tr>' +
    '<tr><th>Начало хранения</th><td>' + _v91E_(_v91Fmt_(s.StorageStartAt) + ', ' + s.StoragePlace) + '</td></tr></table>' +
    '<h2>2. Критерии</h2><table class="r"><tr><th>Показатель</th><th>Группа</th><th>Норма</th><th>Метод</th><th>Источник</th></tr>' + crit.map(function (c) { return '<tr><td>' + _v91E_(c.indicator) + '</td><td>' + _v91E_(MC_V91_GROUPS_[c.group]) + '</td><td>' + _v91E_(c.normText || [c.normMin !== '' && c.normMin !== null ? 'от ' + c.normMin : '', c.normMax !== '' && c.normMax !== null ? 'до ' + c.normMax : ''].filter(Boolean).join(' ')) + '</td><td>' + _v91E_(c.method) + '</td><td>' + _v91E_(c.source) + '</td></tr>'; }).join('') + '</table>' +
    '<h2>3. Контрольные точки</h2><table class="r"><tr><th>Точка</th><th>План, ч</th><th>Факт, ч</th><th>Проба</th><th>Температура хранения</th><th>Результаты</th></tr>' + E.points.map(function (o) {
      return '<tr><td>' + o.no + '</td><td>' + o.planned + '</td><td>' + (o.actual === null ? '' : o.actual) + '</td><td>' + _v91E_(o.sampleId) + '</td><td>' + _v91E_(o.temps) + '</td><td>' + _v91E_(o.items.map(function (i) { return i.indicator + ': ' + i.fact + ' — ' + i.result + ' (протокол ' + i.protocol + ', ' + i.lab + ')'; }).join('; ')) + '</td></tr>'; }).join('') + '</table>' +
    '<h2>4. Заключение</h2><p>Рассмотрел: ' + _v91E_(s.ReviewBy + ' ' + _v91Fmt_(s.ReviewAt) + ' — ' + s.ReviewComment) + '</p><p>Утвердил: ' + _v91E_(auth.by + ' ' + _v91Fmt_(auth.at) + ' — ' + auth.comment) + '</p>' +
    '<p><b>Срок годности ' + _v91E_(s.ClaimedHours) + ' ч при ' + _v91E_(s.TMin + '…' + s.TMax) + ' °C, упаковка: ' + _v91E_(s.Packaging) + '.</b> Правило ' + _v91E_(auth.ruleId) + ' применяется к партиям, изготовленным после ввода в действие, при той же версии ТТК. Старые партии не продлеваются.</p>';
  return _mcPdfSave_('Отчёт о валидации срока годности', h, { fileName: 'Валидация срока ' + s.StudyID, subtitle: s.Product + ' · ' + s.StudyID });
}
/** Утверждение уполномоченным лицом (не тем, кто рассматривал): отчёт PDF и правило V38 (не применяется до ввода в действие). */
function v91StudyAuthorize(json, token) {
  var op = null; try { op = _beginOp_(token, 'tu_approve', 'V91_AUTH', 'Валидация срока', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), s = _v91Study_(d.studyId); if (!s) return _v91F_(op, 'NOT_FOUND', 'Программа не найдена');
    if (s.Status !== 'REVIEWED') return _v91F_(op, 'VALIDATION', 'Утверждается программа после рассмотрения ответственным за ХАССП');
    var w = _v65Who_(op), dec = String(d.decision || '').toUpperCase(), cm = String(d.comment || '').trim();
    if (w.id && String(s.ReviewByID) === w.id) return _v91F_(op, 'SAME_PERSON', 'Утверждает уполномоченное лицо — не тот, кто рассматривал');
    if (dec === 'REJECT') { if (cm.length < 10) return _v91F_(op, 'VALIDATION', 'Укажите причину');
      return _withLock_(function () { _v91Upd_('S', s._row, { Status: 'REJECTED', RejectReason: cm, AuthorizedAt: new Date(), AuthorizedBy: w.name, AuthComment: cm }); _audit_(op, 'V91_AUTH', 'Валидация_Сроков_V91', s.StudyID, 'REVIEWED', 'REJECTED'); _endOp_(op); return _ok_({ studyId: s.StudyID, status: 'REJECTED' }, op.id); }); }
    if (dec !== 'APPROVE') return _v91F_(op, 'VALIDATION', 'Решение: APPROVE или REJECT');
    if (d.confirm !== true) return _v91F_(op, 'CONFIRM_REQUIRED', 'Подтвердите утверждение срока годности');
    if (cm.length < 10) return _v91F_(op, 'VALIDATION', 'Укажите основание решения (приказ, протокол совещания)');
    var E = _v91Eval_(s); if (!E.complete) return _v91F_(op, 'EVIDENCE_INCOMPLETE', 'Доказательства изменились: ' + E.blockers.slice(0, 5).join('; '));
    return _withLock_(function () {
      var now = new Date(), ruleId = 'V91-' + s.StudyID, rep = null; try { rep = _v91Report_(s, E, { by: w.name, at: now, comment: cm, ruleId: ruleId }); } catch (e) { rep = null; }
      var prot = []; E.points.forEach(function (o) { o.items.forEach(function (i) { if (prot.indexOf(i.protocol) < 0) prot.push(i.protocol); }); });
      // карта в реестре V36 (по ней V38 подбирает правило); нет — код карты каталога
      var v36 = ''; try { var dn = ''; try { dn = (_buildDishIndexes_().dishByCode[s.TTKCode] || {}).name || ''; } catch (e) {} var nms = [_v36Norm_(s.Product), _v36Norm_(dn)].filter(Boolean); (_v36Rows_(MC_V36.MASTER) || []).forEach(function (m) { if (!v36 && nms.indexOf(_v36Norm_(m[8])) >= 0) v36 = String(m[0]); }); } catch (e) {}
      _v38Init_(); _book_().getSheetByName(MC_V38.RULE).appendRow([ruleId, 100, '', '', v36 || s.TTKCode, '', s.Packaging + ', ' + s.TMin + '…' + s.TMax + ' °C', Number(s.TMin), Number(s.TMax), Number(s.ClaimedHours), '', '', '', '', '', s.Packaging, '',
        'VALIDATION_V91', 'Валидация ' + s.StudyID + '; протоколы: ' + prot.join(', ') + (rep ? '; отчёт SHA-256 ' + rep.sha256 : ''), Utilities.formatDate(now, _mcTz_(), 'yyyy-MM-dd'), 'APPROVED',
        'ТТК ' + s.TTKCode + (s.TTKVersion ? ' версии ' + s.TTKVersion : '') + (v36 ? ' (реестр ТТК: ' + v36 + ')' : '') + '. Применяется к партиям, изготовленным после ввода в действие (V91); до ввода не применяется. Старые партии не продлеваются.', now, now]);
      _v91Upd_('S', s._row, { Status: 'APPROVED', AuthorizedAt: now, AuthorizedBy: w.name, AuthComment: cm, RuleID: ruleId, ReportFileID: rep ? rep.fileId : '', ReportURL: rep ? rep.url : '', ReportSHA256: rep ? rep.sha256 : '' });
      _audit_(op, 'V91_AUTH', 'Валидация_Сроков_V91', s.StudyID, 'REVIEWED', { status: 'APPROVED', rule: ruleId, report: rep ? rep.sha256 : '' }); _endOp_(op);
      return _ok_({ studyId: s.StudyID, status: 'APPROVED', ruleId: ruleId, reportUrl: rep ? rep.url : '', reportSha256: rep ? rep.sha256 : '', applied: false, next: 'Введите правило в действие с даты — до этого оно к партиям не применяется' }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Ввод правила в действие для новых партий с даты (не раньше сегодняшней). */
function v91ActivateRule(json, token) {
  var op = null; try { op = _beginOp_(token, 'tu_approve', 'V91_ACTIVATE', 'Валидация срока', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), s = _v91Study_(d.studyId); if (!s) return _v91F_(op, 'NOT_FOUND', 'Программа не найдена');
    if (s.Status !== 'APPROVED' || !s.RuleID) return _v91F_(op, 'VALIDATION', 'Вводится в действие только утверждённый срок');
    var f = _v64Date_(d.applyFrom), t0 = new Date(); t0.setHours(0, 0, 0, 0);
    if (!f) return _v91F_(op, 'VALIDATION', 'Укажите дату ввода в действие');
    if (f.getTime() < t0.getTime()) return _v91F_(op, 'BACKDATED', 'Задним числом не вводится: партии, изготовленные раньше, не продлеваются');
    if (d.confirm !== true) return _v91F_(op, 'CONFIRM_REQUIRED', 'Подтвердите: с этой даты срок применяется к новым партиям этой ТТК');
    var w = _v65Who_(op);
    return _withLock_(function () { _v91Upd_('S', s._row, { ApplyFrom: f, ActivatedBy: w.name }); _audit_(op, 'V91_ACTIVATE', 'Валидация_Сроков_V91', s.StudyID, s.ApplyFrom || null, { applyFrom: f, rule: s.RuleID }); _endOp_(op);
      return _ok_({ studyId: s.StudyID, ruleId: s.RuleID, applyFrom: _bcDate_(f) }, op.id); });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Утверждённая и введённая в действие валидация для ТТК (та же версия ТТК, дата ввода наступила). */
function _v91ActiveRule_(code, at) {
  at = at || new Date();
  var cur = 0; try { cur = _effectiveTTKVersion_(code); } catch (e) {}
  var s = _v91All_('S').filter(function (x) { var f = _v64Date_(x.ApplyFrom); return String(x.TTKCode) === String(code) && x.Status === 'APPROVED' && x.RuleID && f && f.getTime() <= at.getTime(); }).pop();
  if (!s) return null;
  if (String(Number(s.TTKVersion) || 0) !== String(Number(cur) || 0)) return { stale: true, studyId: s.StudyID, ruleId: s.RuleID, ttkVersion: s.TTKVersion, current: cur };
  return { hours: Number(s.ClaimedHours), studyId: s.StudyID, ruleId: s.RuleID, regime: s.TMin + '…' + s.TMax + ' °C', packaging: s.Packaging, applyFrom: _v64Date_(s.ApplyFrom) };
}
(function (g) {
  // подсказка срока при выпуске / этикетке: утверждённая и введённая в действие валидация этой ТТК
  var gd = g.getDefaultShelfLife;
  if (typeof gd === 'function') g.getDefaultShelfLife = function (code) { try { var r = _v91ActiveRule_(code); if (r && r.hours > 0 && !r.stale) return r.hours; } catch (e) {} return gd.apply(this, arguments); };
  // V38: правило валидации V91 — только для партий, изготовленных после ввода в действие
  var calc = g.v38Calculate;
  if (typeof calc === 'function') g.v38Calculate = function (json, token) {
    try { var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), rr = JSON.parse(v38ResolveRule(d.ttkId, token)), rule = rr && rr.data && rr.data.rule;
      if (rule && /^V91-/.test(String(rule.id || rule.RuleID || ''))) { var sid = String(rule.id || rule.RuleID).slice(4), s = _v91Study_(sid), f = s ? _v64Date_(s.ApplyFrom) : null, pa = _v64Date_(d.productionAt);
        if (!f || !pa || pa.getTime() < f.getTime()) return _fail_('NOT_APPLICABLE', 'Правило валидации ' + sid + (f ? ' действует для партий, изготовленных с ' + _bcDate_(f) : ' ещё не введено в действие') + ' — старые партии не продлеваются'); } } catch (e) {}
    return calc.apply(this, arguments);
  };
  // V38: утверждённое правило со сроком — только с основанием (аудит 23.11.2026, пробел 6)
  var add = g.v38AddRule;
  if (typeof add === 'function') g.v38AddRule = function (json, token) {
    try {
      var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
      if (String(d.status || '').toUpperCase() === 'APPROVED') {
        var s = null; try { s = _getSession_(token); } catch (e) {}
        if (!s || s.dev || !_mcRbHasExact_(s, 'haccp|haccp_approve|tu_approve')) return _fail_('FORBIDDEN', 'Утверждённое правило срока создаёт ответственный за ХАССП или руководитель');
        var hasLife = [d.shelfLifeHours, d.realizationHours, d.freezeShelfLifeHours].some(function (x) { return x !== undefined && x !== null && x !== '' && Number(x) > 0; });
        if (hasLife) {
          var t = String(d.sourceType || '').toUpperCase(), ref = String(d.sourceRef || '');
          if (t === 'VALIDATION') { var st = _v91Study_(ref.trim()); if (!st || st.Status !== 'APPROVED') return _fail_('VALIDATION_REQUIRED', 'Основание «валидация» — номер утверждённой программы валидации V91'); }
          else if (t === 'MANUFACTURER') { if (!String(d.productPattern || '').trim() || ref.trim().length < 5) return _fail_('VALIDATION_REQUIRED', 'Основание «изготовитель» — для покупного продукта: укажите продукт и документ изготовителя (маркировка, спецификация)'); }
          else if (t === 'NORMATIVE') {
            var ok = false; try { var nv = _book_().getSheetByName('Нормативы_V33').getDataRange().getValues(); for (var i = 1; i < nv.length; i++) { var num = String(nv[i][3] || ''); if (num && /^(ACTIVE|CONDITIONAL)$/.test(String(nv[i][2])) && ref.replace(/\s+/g, '').toLowerCase().indexOf(num.replace(/\s+/g, '').toLowerCase()) >= 0) { ok = true; break; } } } catch (e) {}
            if (!ok || !/п\.|ст\.|пункт|статья|раздел|прил/i.test(ref)) return _fail_('VALIDATION_REQUIRED', 'Основание «нормативный документ» — документ из реестра со статусом «действует» или «если применимо» и пункт');
          } else return _fail_('VALIDATION_REQUIRED', 'Срок годности утверждается только с основанием: NORMATIVE (документ и пункт), MANUFACTURER (покупной продукт) или VALIDATION (утверждённая программа V91). Срок готового полуфабриката — через валидацию');
        }
      }
    } catch (e) {}
    return add.apply(this, arguments);
  };
})(this);

/* ---------------- данные экрана ---------------- */
function v91Data(token) {
  try {
    var s = _requireAuth_(token);
    var since = Date.now() - 60 * 86400000, pv = _productionSheet_().getDataRange().getValues(), batches = [], seen = {};
    for (var i = pv.length - 1; i >= 1 && batches.length < 40; i--) {
      var bid = String(pv[i][PROD_COL_.batch] || ''); if (!bid || seen[bid] || String(pv[i][PROD_COL_.status]) !== 'COMPLETED') continue; seen[bid] = 1;
      var fin = _v64Date_(pv[i][PROD_COL_.finish]); if (fin && fin.getTime() < since) continue;
      var b = _bcFind_(bid); if (!b) continue;
      batches.push({ batchId: bid, product: String(pv[i][PROD_COL_.name]), code: String(pv[i][PROD_COL_.code]), made: _v91Fmt_(fin), expiry: _bcDate_(b.v[5]), status: String(b.v[10] || '') });
    }
    var all = _v91All_('P'), last = {}; all.forEach(function (p) { last[p.PassportID] = p; });
    var passports = Object.keys(last).map(function (k) { var p = last[k]; return { passportId: p.PassportID, version: Number(p.Version), batchId: String(p.BatchID), product: String(p.Product), code: String(p.TTKCode),
      ttkVersion: p.TTKVersion, docForm: String(p.DocForm || ''), docFormRu: MC_V91_FORMS_[String(p.DocForm)] || '', docFormReason: String(p.DocFormReason || ''), project: _v91J_(p.ProjectJSON, {}), gaps: _v91J_(p.GapsJSON, []),
      url: String(p.URL || ''), sha256: String(p.SHA256 || ''), studyId: String(p.StudyID || ''), created: _v91Fmt_(p.CreatedAt), by: String(p.CreatedBy || '') }; }).reverse();
    var smp = _v65Rows_('Лаборатория_Отбор'), linked = {}; _v91All_('T').forEach(function (t) { if (t.SampleID) linked[String(t.SampleID)] = 1; });
    var studies = _v91All_('S').map(function (x) { var E = _v91Eval_(x);
      return { studyId: x.StudyID, passportId: x.PassportID, product: x.Product, code: x.TTKCode, ttkVersion: x.TTKVersion, batchId: String(x.BatchID), regime: x.TMin + '…' + x.TMax + ' °C', packaging: x.Packaging,
        claimed: Number(x.ClaimedHours), criteria: _v91J_(x.CriteriaJSON, []), rationale: x.Rationale, status: x.Status, statusRu: MC_V91_SRU_[x.Status] || x.Status, createdBy: x.CreatedBy,
        planApprovedBy: x.PlanApprovedBy, start: _v91Fmt_(x.StorageStartAt), place: x.StoragePlace, reviewBy: x.ReviewBy, reviewComment: x.ReviewComment, authorizedBy: x.AuthorizedBy, ruleId: x.RuleID,
        applyFrom: x.ApplyFrom ? _bcDate_(x.ApplyFrom) : '', reportUrl: x.ReportURL, reportSha256: x.ReportSHA256, rejectReason: x.RejectReason, eval: E,
        due: x.Status === 'IN_PROGRESS' && x.StorageStartAt ? E.points.filter(function (o) { return !o.sampleId && Date.now() >= _v64Date_(x.StorageStartAt).getTime() + o.planned * 3600000; }).map(function (o) { return o.no; }) : [],
        samples: smp.filter(function (m) { return String(m.BatchID) === String(x.BatchID) && !linked[String(m.SampleID)]; }).map(function (m) { return { id: m.SampleID, at: _v91Fmt_(m.SampledAt), lab: m.Laboratory, status: m.Status }; }) }; }).reverse();
    var labs = _v91All_('L').map(function (l) { return { labId: l.LabID, name: l.Name, no: l.AccreditationNo, scope: _v91J_(l.ScopeJSON, []), validUntil: l.ValidUntil ? _bcDate_(l.ValidUntil) : '', status: l.Status, checkSource: l.CheckSource, checked: _v91Fmt_(l.CheckedAt) + ' ' + l.CheckedBy }; });
    var can = function (k) { return !s.dev && _mcRbHasExact_(s, k); };
    return _ok_({ batches: batches, passports: passports, studies: studies, labs: labs, forms: MC_V91_FORMS_, groups: MC_V91_GROUPS_,
      can: { passport: can('tu_edit|tu_approve|haccp'), project: can('tu_edit|haccp'), study: can('tu_edit|haccp|lab_edit'), approvePlan: can('haccp|tu_approve|lab_approve'), link: can('lab_edit|lab|tu_edit'),
        review: can('haccp|lab_approve'), authorize: can('tu_approve'), labs: can('lab_approve') }, me: String(s.user_id || '') });
  } catch (e) { return _failFrom_(e); }
}

/* ---------------- права экрана, меню, «Моя смена» ---------------- */
(function () {
  try { MC_RB_MODULES_.sfpass = 'tu_view|tu_edit|tu_approve|lab_view|lab_edit|lab_approve|haccp|haccp_view'; MC_RB_MODULE_RU_.sfpass = 'Паспорт полуфабриката и валидация сроков'; } catch (e) {}
  try { if (MC_UI_VIEWS_.indexOf('sfpass') < 0) MC_UI_VIEWS_ = MC_UI_VIEWS_.concat(['sfpass']); } catch (e) {}
  try {
    var o = _mcViewOfParams_;
    _mcViewOfParams_ = function (params) { if (params && (params.semifinished === '1' || params.sfpass === '1')) return 'sfpass'; return o.apply(this, arguments); };
  } catch (e) {}
  try {
    var sec = function (k, btn) { var orig = _UI_BUILDERS_[k]; if (typeof orig !== 'function') return; _UI_BUILDERS_[k] = function (token, opts, s) { var r = orig(token, opts, s) || {}; r.actions = (r.actions || []).concat([btn]); return r; }; };
    sec('lab', { label: 'Паспорт полуфабриката и валидация срока годности', module: 'sfpass' });
    sec('haccp', { label: 'Паспорт полуфабриката и валидация срока годности', module: 'sfpass' });
  } catch (e) {}
})();
try {
  MC_V87_SOURCES_.push(function (ctx) {
    var s = ctx.s, out = []; if (!s || s.dev) return out;
    var st = _v91All_('S');
    if (_mcRbHasExact_(s, 'lab_edit|lab|tu_edit')) st.filter(function (x) { return x.Status === 'IN_PROGRESS' && x.StorageStartAt; }).forEach(function (x) {
      var t0 = _v64Date_(x.StorageStartAt).getTime(), due = _v91Points_(x.StudyID).filter(function (p) { return !p.SampleID && Date.now() >= t0 + Number(p.PlannedHours) * 3600000; });
      if (due.length) out.push({ key: 'V91|due|' + x.StudyID, group: 'now', source: 'Валидация срока', title: 'Отобрать пробу: ' + x.Product + ', точка ' + due.map(function (p) { return p.PlannedHours + ' ч'; }).join(', '),
        detail: 'Программа ' + x.StudyID + ', партия ' + x.BatchID + ', хранение с ' + _v91Fmt_(x.StorageStartAt) + ' (' + x.StoragePlace + '). Проба — на экране «Лаборатория», затем привяжите её к точке.', who: 'вы', act: { kind: 'open', module: 'sfpass', label: 'Открыть программу' } });
    });
    if (_mcRbHasExact_(s, 'tu_approve')) { var rv = st.filter(function (x) { return x.Status === 'REVIEWED'; }); if (rv.length) out.push({ key: 'V91|auth', group: 'now', source: 'Валидация срока', title: 'Срок годности ждёт утверждения: ' + rv.length, detail: rv.map(function (x) { return x.Product + ' — ' + x.ClaimedHours + ' ч'; }).join('; '), who: 'вы', act: { kind: 'open', module: 'sfpass', label: 'Открыть' } }); }
    if (_mcRbHasExact_(s, 'haccp|tu_approve|lab_approve')) { var dr = st.filter(function (x) { return x.Status === 'DRAFT' && String(x.CreatedByID) !== String(s.user_id || ''); }); if (dr.length) out.push({ key: 'V91|plan', group: 'now', source: 'Валидация срока', title: 'План валидации срока ждёт утверждения: ' + dr.length, detail: dr.map(function (x) { return x.Product; }).join('; '), who: 'вы', act: { kind: 'open', module: 'sfpass', label: 'Открыть' } }); }
    return out;
  });
} catch (e) {}
