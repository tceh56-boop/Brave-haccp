/**
 * MON CHEF V102 — доказательная база ХАССП: жизненный цикл ППК (MC-023), утверждение ККТ/КТ по фактическим процессам (MC-024),
 * утверждённые сроки годности для FEFO (MC-025).
 *
 * Собственность Слепцова Дениса Владимировича.
 * Разработчик кода — Слепцов Денис Владимирович.
 *
 * Модуль не переписывает V30/V65/V75/V91 — он подключается обёртками (как V91 к V38) и новыми функциями:
 *
 * MC-024. ККТ, ОПРП и контрольная точка (V30) становятся «действующими» только через утверждение (v102ControlApprove):
 *   статус, дату и имя утвердившего больше нельзя прислать с экрана. Утверждение проверяет полноту:
 *   предел (для ККТ/ОПРП), метод и периодичность мониторинга, ответственный, корректирующее действие, метод верификации,
 *   план мониторинга с границами (для ККТ), мера V75 с классификацией и обоснованием, обоснование предела, валидация V75
 *   (действует для текущих параметров). Утверждает директор (право ppk_approve), не тот, кто последним менял точку;
 *   технический доступ не утверждает. Изменение предела, мониторинга, ответственного или действий у действующей точки
 *   возвращает её в проект — до повторного утверждения выпуск и «Готово» с этой ККТ блокируются (ККТ «не действует в плане»).
 *   Назначить ККТ блюду или п/ф (ТТК_ККТ) можно только если блюдо входит в действующую подтверждённую на площадке
 *   технологическую схему (V75), в которой есть процесс этой ККТ — не по названию блюда.
 *
 * MC-023. ППК: проект → проверка → согласование → утверждение → ввод в действие → пересмотр → архив.
 *   Проверку проводит не автор; согласует ответственный за ХАССП (не автор); утверждает директор (не автор);
 *   технический доступ не утверждает и не архивирует (шлюз). Версия хранит автора, проверяющего, согласовавшего, утвердившего,
 *   дату действия и основание. Изменение процессов, опасностей, ККТ, мониторинга, схем и назначений ККТ отмечает действующую
 *   ППК «требует пересмотра» (с причинами) и уведомляет директора и ответственного за ХАССП; пересмотр — новая версия-проект
 *   с копией разделов и мероприятий. Архив и действующая версия не редактируются. Мероприятия графика — задачи в центре
 *   задач (V44) по роли; выполнение — с доказательством (запись журнала, акт, протокол), отклонение — номером отклонения.
 *   Сотрудники видят действующую версию (v102PpkActive).
 *
 * MC-025. Срок годности партии собственного производства — только утверждённый:
 *   правило валидации V91 (введено в действие, та же версия ТТК) → утверждённая строка таблицы сроков (V70) →
 *   срок в карте блюда, утверждённый с основанием. Срок в карте теперь предлагается с основанием и утверждается другим
 *   сотрудником (ответственный за ХАССП / директор); без утверждения карта срок не даёт. При выпуске п/ф срок партии
 *   ставится по утверждённому; вручную — только короче утверждённого; без утверждённого срока ручной срок не принимается
 *   (партия без срока, ответственному за ХАССП — уведомление). Паспорт п/ф (черновик) и незавершённая валидация срок не меняют.
 */

/* ========================= общее ========================= */
function _v102S_(x) { return String(x === undefined || x === null ? '' : x).trim(); }
function _v102Who_(s) { return s ? (s.dev ? (typeof MC_RB_TECH_ !== 'undefined' ? MC_RB_TECH_ : 'Технический доступ') : _v102S_(s.fullName || s.name || s.user_id)) : 'система'; }
function _v102Role_(s) { return s ? _v102S_(s.role || s.position) : ''; }
function _v102IsDirector_(s) { return !!s && !s.dev && /директор/i.test(_v102Role_(s)); }
function _v102Sess_(token) { try { return _requireAuth_(token, null); } catch (e) { return null; } }
function _v102J_(x) { try { return typeof x === 'string' ? JSON.parse(x || '{}') : (x || {}); } catch (e) { return {}; } }
function _v102Res_(r) { try { return typeof r === 'string' ? JSON.parse(r) : r; } catch (e) { return null; } }
function _v102Ok_(r) { var j = _v102Res_(r); return !!(j && (j.success === true || j.ok === true)); }
/** Дописать недостающие колонки в шапку листа (данные не трогаются). */
function _v102EnsureCols_(sheetName, cols) {
  var sh = _book_().getSheetByName(sheetName); if (!sh) return;
  var last = sh.getLastColumn(), head = last ? sh.getRange(1, 1, 1, last).getValues()[0].map(String) : [];
  cols.forEach(function (c) { if (head.indexOf(c) < 0) { head.push(c); sh.getRange(1, head.length).setValue(c); } });
}

/* ========================= MC-023: ППК ========================= */
var MC_V102_PPK_COLS_ = ['Basis', 'Reviewer', 'ReviewedAt', 'AgreedBy', 'AgreedAt', 'RevisionReason', 'RevisionAt', 'PrevPPKID', 'Author'];
(function () {
  try { MC_V102_PPK_COLS_.forEach(function (c) { if (MC_V65.PPK[1].indexOf(c) < 0) MC_V65.PPK[1].push(c); }); } catch (e) {}
  try { MC_V65_ST_RU.AGREEMENT = 'На согласовании'; MC_V65_ST_RU.REVIEW = 'На проверке'; MC_V65_ST_RU.DRAFT = 'Проект'; } catch (e) {}
})();
function _v102PpkPrep_() { try { _v65Sh_('PPK'); _v102EnsureCols_(MC_V65.PPK[0], MC_V65.PPK[1]); } catch (e) {} }
function _v102PpkActiveRow_() { _v102PpkPrep_(); return _v65Objs_('PPK').filter(function (p) { return p.Status === 'ACTIVE'; }).pop() || null; }
function _v102Author_(p) { return _v102S_(p.Author || p.CreatedBy); }
function _v102NotAuthor_(p, s) { var a = _v102Author_(p); return !a || a !== _v102Who_(s); }

/** Проверка проекта (не автор): PASS — на согласование, RETURN — в проект с замечаниями. {ppkId, decision, comment} */
function v102PpkReview(json, token) {
  var op = null; try { op = _beginOp_(token, 'ppk_edit|haccp|ppk_approve', 'V102_PPK_REVIEW', 'ППК', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v102J_(json); _v102PpkPrep_();
    return _withLock_(function () {
      var p = _v65Get_(d.ppkId); if (!p) return _v65Fail_(op, 'NOT_FOUND', 'ППК не найдена');
      if (p.Status !== 'REVIEW') return _v65Fail_(op, 'VALIDATION', 'Проверяется версия «На проверке» (сейчас «' + (MC_V65_ST_RU[p.Status] || p.Status) + '»)');
      if (op.session.dev) return _v65Fail_(op, 'FORBIDDEN', 'Технический доступ не проверяет ППК');
      if (!_v102NotAuthor_(p, op.session)) return _v65Fail_(op, 'FORBIDDEN', 'Проверяет не автор проекта');
      var who = _v102Who_(op.session), dec = String(d.decision || '').toUpperCase(), com = _v102S_(d.comment);
      if (dec === 'RETURN') {
        if (com.length < 3) return _v65Fail_(op, 'VALIDATION', 'Укажите, что доработать');
        _v65SetCell_('PPK', p._row, 'Status', 'DRAFT'); _v65Approval_(p.PPKID, 'Проверка', 'RETURNED', com, op);
        _audit_(op, 'V102_PPK_REVIEW', 'ППК', p.PPKID, 'REVIEW', { status: 'DRAFT', comment: com }); _endOp_(op); return _ok_({ ppkId: p.PPKID, status: 'DRAFT' }, op.id);
      }
      var chk = _v65Check_(p.PPKID);
      if (chk.status !== 'PASS') { _v65Approval_(p.PPKID, 'Проверка', 'REFUSED', 'пробелов: ' + chk.blocking, op); return _v65Fail_(op, 'PPK_REVIEW', 'Проверка полноты не пройдена (пробелов: ' + chk.blocking + ') — верните на доработку'); }
      _v65SetCell_('PPK', p._row, 'Reviewer', who + (_v102Role_(op.session) ? ', ' + _v102Role_(op.session) : '')); _v65SetCell_('PPK', p._row, 'ReviewedAt', new Date());
      _v65SetCell_('PPK', p._row, 'Status', 'AGREEMENT'); _v65Approval_(p.PPKID, 'Проверка', 'PASSED', com, op);
      _audit_(op, 'V102_PPK_REVIEW', 'ППК', p.PPKID, 'REVIEW', { status: 'AGREEMENT', reviewer: who }); _endOp_(op);
      return _ok_({ ppkId: p.PPKID, status: 'AGREEMENT' }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Согласование ответственным за ХАССП (не автор): {ppkId, comment}. */
function v102PpkAgree(json, token) {
  var op = null; try { op = _beginOp_(token, 'haccp|haccp_approve', 'V102_PPK_AGREE', 'ППК', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v102J_(json); _v102PpkPrep_();
    return _withLock_(function () {
      var p = _v65Get_(d.ppkId); if (!p) return _v65Fail_(op, 'NOT_FOUND', 'ППК не найдена');
      if (p.Status !== 'AGREEMENT') return _v65Fail_(op, 'VALIDATION', 'Согласуется версия после проверки (сейчас «' + (MC_V65_ST_RU[p.Status] || p.Status) + '»)');
      if (op.session.dev) return _v65Fail_(op, 'FORBIDDEN', 'Технический доступ не согласует ППК');
      if (!_v102NotAuthor_(p, op.session)) return _v65Fail_(op, 'FORBIDDEN', 'Согласует не автор проекта');
      var who = _v102Who_(op.session);
      _v65SetCell_('PPK', p._row, 'AgreedBy', who + (_v102Role_(op.session) ? ', ' + _v102Role_(op.session) : '')); _v65SetCell_('PPK', p._row, 'AgreedAt', new Date());
      _v65Approval_(p.PPKID, 'Согласование', 'AGREED', _v102S_(d.comment), op);
      _audit_(op, 'V102_PPK_AGREE', 'ППК', p.PPKID, null, { agreedBy: who }); _endOp_(op);
      return _ok_({ ppkId: p.PPKID, status: 'AGREEMENT', agreed: true, note: 'Согласовано. Утверждает директор.' }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Условия утверждения (вызывает v65Approve): версия согласована, утверждает директор, не автор. */
function _v102PpkApproveGate_(p, s) {
  if (p.Status !== 'AGREEMENT') return 'Утверждается версия, прошедшая проверку и согласование (сейчас «' + (MC_V65_ST_RU[p.Status] || p.Status) + '»)';
  if (!_v102S_(p.AgreedBy)) return 'Версию ещё не согласовал ответственный за ХАССП';
  if (!_v102IsDirector_(s)) return 'ППК утверждает директор';
  if (!_v102NotAuthor_(p, s)) return 'Утверждает не автор проекта';
  return '';
}
/** Отметить действующую ППК «требует пересмотра» (изменение процесса). Повтор той же причины не дублируется; уведомление — раз в день. */
function _v102PpkFlag_(reason, op) {
  try {
    var p = _v102PpkActiveRow_(); if (!p) return null;
    var now = new Date(), day = Utilities.formatDate(now, _mcTz_(), 'dd.MM.yyyy'), cur = _v102S_(p.RevisionReason), line = day + ': ' + reason;
    if (cur.indexOf(reason) >= 0) return p.PPKID;
    _v65SetCell_('PPK', p._row, 'RevisionReason', (cur ? cur + '\n' : '') + line);
    _v65SetCell_('PPK', p._row, 'RevisionAt', now);
    ['Директор', 'Ответственный за ХАССП'].forEach(function (role) {
      try { _notify_('PPK_REVISION', 'warning', 'ППК «' + p.Name + '» v' + p.Version + ' требует пересмотра', reason + '. Создайте новую версию: ППК → «Начать пересмотр».', role, 'PPK_REV_' + p.PPKID + '_' + day + '_' + role, op || null); } catch (e) {}
    });
    return p.PPKID;
  } catch (e) { return null; }
}
/** Начать пересмотр: новая версия-проект из действующей (разделы и мероприятия копируются). {ppkId, basis} */
function v102PpkRevisionStart(json, token) {
  var op = null; try { op = _beginOp_(token, 'ppk_edit', 'V102_PPK_REVISION', 'ППК', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v102J_(json), basis = _v102S_(d.basis); _v102PpkPrep_();
    if (basis.length < 5) return _v65Fail_(op, 'VALIDATION', 'Основание пересмотра: что изменилось (процесс, оборудование, ТТК, требования)');
    return _withLock_(function () {
      var p = _v65Get_(d.ppkId); if (!p || p.Status !== 'ACTIVE') return _v65Fail_(op, 'VALIDATION', 'Пересматривается действующая версия');
      if (_v65Objs_('PPK').some(function (x) { return String(x.PrevPPKID) === String(p.PPKID) && ['DRAFT', 'REVIEW', 'AGREEMENT', 'APPROVED'].indexOf(x.Status) >= 0; }))
        return _v65Fail_(op, 'CONFLICT', 'Пересмотр уже начат — откройте новую версию');
      var who = _v102Who_(op.session), now = new Date(), id = 'PPK-' + Utilities.getUuid().slice(0, 8).toUpperCase(), H = MC_V65.PPK[1];
      var o = {}; H.forEach(function (c) { o[c] = ''; });
      o.PPKID = id; o.Name = p.Name; o.Version = (parseInt(p.Version, 10) || 1) + 1; o.DateFrom = ''; o.DateTo = ''; o.Status = 'DRAFT'; o.Responsible = p.Responsible;
      o.Notes = p.Notes; o.CreatedAt = now; o.CreatedBy = who; o.Author = who; o.Basis = 'Пересмотр v' + p.Version + ': ' + basis; o.PrevPPKID = p.PPKID;
      _v65Sh_('PPK').appendRow(H.map(function (c) { return o[c]; }));
      var secH = MC_V65.SEC[1], actH = MC_V65.ACT[1], secs = [], acts = [];
      _v65Objs_('SEC').filter(function (x) { return String(x.PPKID) === String(p.PPKID); }).forEach(function (x) { var r = secH.map(function (c) { return x[c]; }); r[0] = 'SEC-' + Utilities.getUuid().slice(0, 8).toUpperCase(); r[1] = id; secs.push(r); });
      _v65Objs_('ACT').filter(function (x) { return String(x.PPKID) === String(p.PPKID); }).forEach(function (x) { var r = actH.map(function (c) { return x[c]; }); r[0] = 'CP-' + Utilities.getUuid().slice(0, 8).toUpperCase(); r[1] = id; acts.push(r); });
      if (secs.length) _v65Sh_('SEC').getRange(_v65Sh_('SEC').getLastRow() + 1, 1, secs.length, secH.length).setValues(secs);
      if (acts.length) _v65Sh_('ACT').getRange(_v65Sh_('ACT').getLastRow() + 1, 1, acts.length, actH.length).setValues(acts);
      _v65Approval_(id, 'Пересмотр', 'STARTED', basis, op);
      _audit_(op, 'V102_PPK_REVISION', 'ППК', id, { from: p.PPKID, version: p.Version }, { version: o.Version, basis: basis, sections: secs.length, activities: acts.length });
      _endOp_(op); return _ok_({ ppkId: id, version: o.Version, from: p.PPKID, sections: secs.length, activities: acts.length, note: 'Действующая версия действует до ввода новой.' }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Действующая ППК — всем сотрудникам (только чтение). */
function v102PpkActive(token) {
  try {
    var s = _requireAuth_(token, null), p = _v102PpkActiveRow_();
    if (!p) return _ok_({ active: null, note: 'Действующей ППК нет' });
    var fmt = function (x) { var dd = _v64Date_(x); return dd ? Utilities.formatDate(dd, _mcTz_(), 'dd.MM.yyyy') : ''; }, url = '';
    try { if (p.FileID) url = DriveApp.getFileById(p.FileID).getUrl(); } catch (e) {}
    var secs = _v65Objs_('SEC').filter(function (x) { return String(x.PPKID) === String(p.PPKID); }).sort(function (a, b) { return a.Sequence - b.Sequence; })
      .map(function (x) { return { code: x.SectionCode, name: x.SectionName, text: String(x.Text || '') }; });
    return _ok_({ active: { ppkId: p.PPKID, name: p.Name, version: p.Version, from: fmt(p.DateFrom), to: fmt(p.DateTo), author: _v102Author_(p), reviewer: p.Reviewer || '', agreedBy: p.AgreedBy || '',
      approvedBy: p.ApprovedBy || '', approvedAt: fmt(p.ApprovedAt), basis: p.Basis || '', url: url, sha256: p.Hash || '', revision: _v102S_(p.RevisionReason) ? { reason: _v102S_(p.RevisionReason), at: fmt(p.RevisionAt) } : null, sections: secs } });
  } catch (e) { return _failFrom_(e); }
}
/** Мероприятия графика действующей ППК — задачи центра задач по роли (раз в час): срок сегодня и просроченные; выполненные закрываются. */
function _v102PpkTasksTick_() {
  try {
    var p = _v102PpkActiveRow_(); if (!p || typeof _v44UpsertTask_ !== 'function') return { tasks: 0 };
    var today = Utilities.formatDate(new Date(), _mcTz_(), 'yyyy-MM-dd'), n = 0;
    _v65ScheduleState_(p.PPKID, '', today).forEach(function (x) {
      if (x.status === 'PLANNED' && x.due > today) return;
      _v44UpsertTask_({ sourceType: 'PPK_SCHEDULE', sourceId: x.scheduleId, title: 'ППК: ' + (x.object || '') + (x.parameter ? ' — ' + x.parameter : ''),
        description: 'Мероприятие программы производственного контроля v' + p.Version + '. Выполнение — с доказательством (запись журнала, акт, протокол); отклонение — с номером отклонения.',
        taskType: 'PPK', dueAt: new Date(x.due + 'T23:00:00'), role: x.role || 'Ответственный за ХАССП', priority: x.status === 'OVERDUE' ? 'HIGH' : 'NORMAL', status: x.status === 'DONE' ? 'DONE' : 'PLANNED' });
      n++;
    });
    return { tasks: n };
  } catch (e) { try { _log_('WARN', 'ППК → задачи: ' + e); } catch (x) {} return null; }
}

/* ========================= MC-024: ККТ / ОПРП / КТ ========================= */
var MC_V102_CTL_KEYS_ = { processId: 1, hazardId: 2, type: 3, controlPoint: 4, criticalLimit: 5, limitUnit: 6, monitoringMethod: 7, frequency: 8, responsible: 9, correctiveAction: 10, verificationMethod: 11 };
function _v102CtlRows_() { try { return _v30Rows_(MC_V30.CCP); } catch (e) { return []; } }
function _v102CtlRow_(id) { var sh = _book_().getSheetByName(MC_V30.CCP); if (!sh) return null; var v = sh.getDataRange().getValues(); for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(id)) return { row: i + 1, r: v[i] }; return null; }
/** Что не хватает для утверждения точки: [тексты]. */
function _v102CtlMissing_(r) {
  var id = String(r[0]), type = String(r[3]).toUpperCase(), miss = [], need = function (i, t) { if (!_v102S_(r[i])) miss.push(t); };
  need(4, 'точка контроля'); need(9, 'ответственный'); need(7, 'метод мониторинга'); need(8, 'периодичность мониторинга');
  if (type === 'CCP' || type === 'OPRP') { need(5, type === 'CCP' ? 'критический предел' : 'критерий действия'); need(10, 'корректирующее действие'); need(11, 'метод верификации'); }
  var mons = []; try { mons = _v30Rows_(MC_V30.MON).filter(function (m) { return String(m[1]) === id && String(m[13] || 'ACTIVE') !== 'ARCHIVED'; }); } catch (e) {}
  if (!mons.length) miss.push('план мониторинга');
  else if (type === 'CCP' && !mons.some(function (m) { return _v102S_(m[5]) !== '' || _v102S_(m[6]) !== ''; })) miss.push('границы в плане мониторинга (от / до) — без них замер нельзя оценить');
  if (type === 'CCP' || type === 'OPRP') {
    var ms = null; try { ms = _v75Rows_('MS').filter(function (x) { return String(x.ControlID) === id && String(x['Статус'] || 'ACTIVE') !== 'ARCHIVED'; }).pop(); } catch (e) {}
    if (!ms) miss.push('мера управления в анализе опасностей (V75): опасность, классификация, обоснование');
    else {
      if (String(ms['Классификация']) !== type) miss.push('классификация меры в анализе опасностей — «' + ms['Классификация'] + '», а точка — «' + type + '»');
      if (_v102S_(ms['Обоснование']).length < 10) miss.push('обоснование классификации');
      if (_v102S_(ms['Обоснование предела']).length < 5) miss.push('обоснование предела (документ и пункт, протокол)');
    }
    try { var V = _v75V30_(), c = V.C[id], vals = _v75Rows_('VAL'); if (c) { var vs = _v75ValState_(c, V.M, vals); if (vs.state !== 'VALID') miss.push('валидация меры: ' + vs.text); } } catch (e) { miss.push('валидация меры'); }
  }
  return miss;
}
/** Точки контроля и готовность к утверждению — для экрана «ХАССП: процессы и ККТ». */
function v102ControlReadiness(token) {
  try {
    var s = _requireAuth_(token, 'journals|haccp|ppk_approve|ppk_view');
    var list = _v102CtlRows_().map(function (r) {
      var miss = _v102CtlMissing_(r);
      return { id: String(r[0]), type: String(r[3]), point: String(r[4]), limit: _v102S_(r[5]) + (_v102S_(r[6]) ? ' ' + _v102S_(r[6]) : ''), status: String(r[13] || 'DRAFT'),
        approvedBy: _v102S_(r[16]), approvedAt: r[15] ? (Object.prototype.toString.call(r[15]) === '[object Date]' ? Utilities.formatDate(r[15], _mcTz_(), 'dd.MM.yyyy') : String(r[15])) : '', editedBy: _v102S_(r[18]), missing: miss };
    });
    return _ok_({ controls: list, can: { approve: !s.dev && _mcRbHasExact_(s, 'ppk_approve') && _v102IsDirector_(s) } });
  } catch (e) { return _failFrom_(e); }
}
/** Утвердить точку контроля: {controlId, comment}. Директор, не тот, кто последним менял точку; всё обязательное заполнено. */
function v102ControlApprove(json, token) {
  var op = null; try { op = _beginOp_(token, 'ppk_approve', 'V102_CCP_APPROVE', 'ХАССП', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v102J_(json);
    return _withLock_(function () {
      var x = _v102CtlRow_(d.controlId); if (!x) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Точка контроля не найдена', op.id); }
      if (op.session.dev || !_v102IsDirector_(op.session)) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', 'Точку контроля утверждает директор', op.id); }
      var who = _v102Who_(op.session);
      if (_v102S_(x.r[18]) && _v102S_(x.r[18]) === who) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', 'Утверждает не тот, кто последним вносил изменения (' + who + ')', op.id); }
      var miss = _v102CtlMissing_(x.r);
      if (miss.length) { _endOp_(op, 'FAILED'); return _fail_('NOT_READY', 'Не утверждается — не хватает: ' + miss.join('; '), op.id); }
      var sh = _book_().getSheetByName(MC_V30.CCP), now = new Date();
      sh.getRange(x.row, 14).setValue('ACTIVE'); sh.getRange(x.row, 16).setValue(now); sh.getRange(x.row, 17).setValue(who + ', ' + _v102Role_(op.session));
      _audit_(op, 'V102_CCP_APPROVE', 'CCP', String(x.r[0]), { status: String(x.r[13]) }, { status: 'ACTIVE', approvedBy: who, limit: _v102S_(x.r[5]) + ' ' + _v102S_(x.r[6]), comment: _v102S_(d.comment) });
      _v102PpkFlag_('утверждена точка контроля «' + x.r[4] + '»', op);
      _endOp_(op); return _ok_({ controlId: String(x.r[0]), status: 'ACTIVE', approvedBy: who }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Вернуть действующую точку в проект (изменились параметры) — до повторного утверждения она не действует. */
function _v102CtlReopen_(controlId, why, op) {
  var x = _v102CtlRow_(controlId); if (!x || String(x.r[13]) !== 'ACTIVE') return false;
  var sh = _book_().getSheetByName(MC_V30.CCP); sh.getRange(x.row, 14).setValue('DRAFT'); sh.getRange(x.row, 16).setValue(''); sh.getRange(x.row, 17).setValue('');
  sh.getRange(x.row, 15).setValue((parseInt(x.r[14], 10) || 1) + 1);
  try { if (op) _audit_(op, 'V102_CCP_REOPEN', 'CCP', String(controlId), { status: 'ACTIVE' }, { status: 'DRAFT', why: why }); } catch (e) {}
  ['Директор', 'Ответственный за ХАССП'].forEach(function (role) { try { _notify_('CCP_REOPEN', 'warning', 'Точка контроля «' + x.r[4] + '» требует повторного утверждения', why + '. До утверждения выпуск с этой ККТ заблокирован.', role, 'CCP_REOPEN_' + controlId + '_' + Date.now() + role, op || null); } catch (e) {} });
  _v102PpkFlag_('изменена точка контроля «' + x.r[4] + '» (' + why + ')', op);
  return true;
}
/** Блюдо (ТТК) входит в действующую подтверждённую на площадке схему, где есть процесс ККТ. */
function _v102FlowCovers_(code, controlId) {
  var x = _v102CtlRow_(controlId); if (!x) return { ok: false, msg: 'Точка контроля не найдена' };
  var proc = String(x.r[1]), dish = null; try { dish = _buildDishIndexes_().dishByCode[code]; } catch (e) {}
  var keys = [String(code)].concat(dish ? [String(dish.name || ''), String(dish.cat || dish.category || '')] : []).filter(Boolean).map(function (k) { return k.toLowerCase(); });
  var flows = [], conf = []; try { flows = _v75Rows_('FLW').filter(function (f) { return String(f['Статус'] || 'ACTIVE') === 'ACTIVE'; }); conf = _v75Rows_('CNF'); } catch (e) {}
  var mine = flows.filter(function (f) { var pr = []; try { pr = JSON.parse(f['Для продукции (JSON)'] || '[]'); } catch (e) {} return pr.some(function (p) { return keys.indexOf(String(p).toLowerCase()) >= 0; }); });
  if (!mine.length) return { ok: false, msg: '«' + (dish ? dish.name : code) + '» не входит ни в одну технологическую схему анализа опасностей — сначала опишите процесс блюда (ХАССП → схемы), ККТ назначается по процессу, а не по названию' };
  var withProc = mine.filter(function (f) { var st = []; try { st = JSON.parse(f['Шаги (JSON)'] || '[]'); } catch (e) {} return st.some(function (s) { return String(s.processId) === proc; }); });
  if (!withProc.length) return { ok: false, msg: 'В схеме «' + mine[0]['Название'] + '» нет процесса этой ККТ — ККТ не относится к процессу блюда' };
  var ok = withProc.filter(function (f) { var c = conf.filter(function (k) { return String(k.FlowID) === String(f.FlowID) && String(k['Версия схемы']) === String(f['Версия']); }).pop(); return c && String(c['Результат']) === 'CONFIRMED'; });
  if (!ok.length) return { ok: false, msg: 'Схема «' + withProc[0]['Название'] + '» (версия ' + withProc[0]['Версия'] + ') не подтверждена на производственной площадке' };
  return { ok: true, flow: String(ok[0].FlowID) };
}

/* ========================= MC-025: сроки годности ========================= */
var MC_V102_SHELF_ = 'Сроки_Карт_V102', MC_V102_SHELF_HEAD_ = ['ID', 'Код ТТК', 'Блюдо', 'Часы', 'Основание', 'Статус', 'Предложил', 'Предложено', 'Решил', 'Решено', 'Комментарий', 'OperationID'];
function _v102ShelfRows_() { var sh = _book_().getSheetByName(MC_V102_SHELF_); if (!sh || sh.getLastRow() < 2) return []; var v = sh.getDataRange().getValues(), h = v[0]; return v.slice(1).map(function (r, i) { var o = { _row: i + 2 }; h.forEach(function (k, j) { o[k] = r[j]; }); return o; }); }
function _v102ShelfSheet_() { var sh = _book_().getSheetByName(MC_V102_SHELF_); if (!sh) { sh = _book_().insertSheet(MC_V102_SHELF_); sh.appendRow(MC_V102_SHELF_HEAD_); } return sh; }
function _v102ShelfApprovedCard_(code) { return _v102ShelfRows_().filter(function (r) { return String(r['Код ТТК']) === String(code) && String(r['Статус']) === 'APPROVED'; }).pop() || null; }
/** Утверждённый срок партии собственного производства: {hours, source, ref} или null. */
function _v102ApprovedShelf_(code) {
  try { var r = typeof _v91ActiveRule_ === 'function' ? _v91ActiveRule_(code) : null; if (r && r.hours > 0 && !r.stale) return { hours: r.hours, source: 'валидация срока ' + r.studyId, ref: r.ruleId }; } catch (e) {}
  try { var nb = typeof _v70ShelfFor_ === 'function' ? _v70ShelfFor_(code) : null; if (nb && nb.hours > 0) return { hours: nb.hours, source: nb.src || 'утверждённая таблица сроков', ref: '' }; } catch (e) {}
  var c = _v102ShelfApprovedCard_(code); if (c && Number(c['Часы']) > 0) return { hours: Number(c['Часы']), source: 'карта, утверждено: ' + c['Решил'], ref: String(c['Основание'] || '') };
  return null;
}
/** Срок партии при выпуске: expiry (YYYY-MM-DD или '') → {exp, basis} или {fail}. */
function _v102ReleaseExpiry_(code, expiry, at) {
  var ap = _v102ApprovedShelf_(code), end = ap ? new Date(at.getTime() + ap.hours * 3600000) : null, endDay = end ? Utilities.formatDate(end, _mcTz_(), 'yyyy-MM-dd') : '';
  if (!expiry) return ap ? { exp: endDay, basis: ap.source + ' (' + ap.hours + ' ч)' } : { exp: '', basis: 'утверждённого срока нет', none: true };
  if (!ap) return { fail: 'Для этой ТТК нет утверждённого срока годности: ручной срок не принимается. Утвердите срок (валидация, таблица сроков или срок в карте с основанием) — до этого партия выпускается без срока.' };
  if (expiry > endDay) return { fail: 'Срок ' + expiry.split('-').reverse().join('.') + ' длиннее утверждённого: не позднее ' + endDay.split('-').reverse().join('.') + ' (' + ap.source + ', ' + ap.hours + ' ч).' };
  return { exp: expiry, basis: 'сокращён вручную; утверждено до ' + endDay + ' (' + ap.source + ')' };
}
/** Утвердить или отклонить предложенный срок в карте: {id, approve, comment}. Не автор предложения; ХАССП или директор. */
function v102ShelfDecide(json, token) {
  var op = null; try { op = _beginOp_(token, 'haccp|haccp_approve|ppk_approve|ttk_approve', 'V102_SHELF_DECIDE', 'ТТК', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v102J_(json);
    return _withLock_(function () {
      var r = _v102ShelfRows_().filter(function (x) { return String(x.ID) === String(d.id); })[0];
      if (!r || String(r['Статус']) !== 'PROPOSED') { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Предложение не найдено или уже рассмотрено', op.id); }
      var who = _v102Who_(op.session);
      if (op.session.dev) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', 'Технический доступ не утверждает сроки', op.id); }
      if (String(r['Предложил']) === who) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', 'Утверждает не тот, кто предложил срок', op.id); }
      var sh = _v102ShelfSheet_(), H = MC_V102_SHELF_HEAD_, set = function (k, v) { sh.getRange(r._row, H.indexOf(k) + 1).setValue(v); };
      var st = d.approve ? 'APPROVED' : 'REJECTED'; set('Статус', st); set('Решил', who); set('Решено', new Date()); set('Комментарий', _v102S_(d.comment)); set('OperationID', op.id);
      if (st === 'APPROVED') {
        _v102ShelfRows_().forEach(function (x) { if (x.ID !== r.ID && String(x['Код ТТК']) === String(r['Код ТТК']) && String(x['Статус']) === 'APPROVED') sh.getRange(x._row, H.indexOf('Статус') + 1).setValue('REPLACED'); });
        var bs = _shelfCol_(), v = bs.getDataRange().getValues(); for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(r['Код ТТК'])) { bs.getRange(i + 1, 10).setValue(Number(r['Часы'])); break; }
      }
      _audit_(op, 'V102_SHELF_' + st, 'ТТК', String(r['Код ТТК']), null, { hours: r['Часы'], basis: r['Основание'], by: who });
      _endOp_(op); return _ok_({ id: r.ID, status: st, code: String(r['Код ТТК']), hours: Number(r['Часы']) }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Сроки в картах: предложенные (к рассмотрению) и заданные без утверждённого основания (было до V102). */
function v102ShelfData(token) {
  try {
    var s = _requireAuth_(token, 'catalog|haccp|haccp_approve|ppk_approve|ttk_approve'), rows = _v102ShelfRows_(), idx = _buildDishIndexes_(), legacy = [];
    try { var v = _shelfCol_().getDataRange().getValues(); for (var i = 1; i < v.length; i++) { var h = parseFloat(v[i][9]); if (h > 0) { var a = _v102ShelfApprovedCard_(v[i][0]); if (!a || Number(a['Часы']) !== h) legacy.push({ code: String(v[i][0]), name: String(v[i][1] || ''), hours: h }); } } } catch (e) {}
    return _ok_({ proposed: rows.filter(function (r) { return r['Статус'] === 'PROPOSED'; }).map(function (r) { return { id: r.ID, code: r['Код ТТК'], name: r['Блюдо'], hours: r['Часы'], basis: r['Основание'], by: r['Предложил'] }; }),
      unapproved: legacy, can: { decide: !s.dev && _mcRbHasExact_(s, 'haccp|haccp_approve|ppk_approve|ttk_approve') } });
  } catch (e) { return _failFrom_(e); }
}

/* ========================= обёртки существующих функций ========================= */
(function (g) {
  var wrap = function (name, f) { var o = g[name]; if (typeof o === 'function') g[name] = f(o); };
  // MC-024: статус и утверждение точки контроля — только сервером
  wrap('v30SaveControl', function (orig) { return function (json, token) {
    var d = _v102J_(json), x = d.id ? _v102CtlRow_(d.id) : null, changed = [], reopen = false;
    if (x) {
      Object.keys(MC_V102_CTL_KEYS_).forEach(function (k) { var i = MC_V102_CTL_KEYS_[k]; if (d[k] !== undefined && _v102S_(d[k]) !== _v102S_(x.r[i])) changed.push(k); });
      var act = String(x.r[13]) === 'ACTIVE';
      d.status = act && !changed.length ? 'ACTIVE' : 'DRAFT'; d.version = String(x.r[14] || '1'); d.approvedAt = act && !changed.length ? x.r[15] : ''; d.approvedBy = act && !changed.length ? x.r[16] : '';
      reopen = act && changed.length > 0; if (reopen) d.version = String((parseInt(x.r[14], 10) || 1) + 1);
    } else { d.status = 'DRAFT'; d.version = '1'; d.approvedAt = ''; d.approvedBy = ''; }
    var res = orig.call(this, JSON.stringify(d), token);
    if (_v102Ok_(res)) {
      if (reopen) ['Директор', 'Ответственный за ХАССП'].forEach(function (role) { try { _notify_('CCP_REOPEN', 'warning', 'Точка контроля «' + (d.controlPoint || x.r[4]) + '» требует повторного утверждения', 'Изменено: ' + changed.join(', ') + '. До утверждения выпуск с этой ККТ заблокирован.', role, 'CCP_REOPEN_' + d.id + '_' + Date.now() + role, null); } catch (e) {} });
      if (!x || changed.length) _v102PpkFlag_((x ? 'изменена' : 'добавлена') + ' точка контроля «' + (d.controlPoint || (x && x.r[4]) || '') + '»' + (changed.length ? ' (' + changed.join(', ') + ')' : ''), null);
    }
    return res;
  }; });
  wrap('v30SaveMonitoring', function (orig) { return function (json, token) {
    var d = _v102J_(json), before = null;
    try { before = d.id ? _v30Rows_(MC_V30.MON).filter(function (m) { return String(m[0]) === String(d.id); })[0] : null; } catch (e) {}
    var res = orig.apply(this, arguments);
    if (_v102Ok_(res)) {
      var diff = !before || ['parameter', 'unit', 'targetMin', 'targetMax'].some(function (k, i) { var col = [3, 4, 5, 6][i]; return d[k] !== undefined && _v102S_(d[k] === null ? '' : d[k]) !== _v102S_(before[col]); });
      if (diff && !_v102CtlReopen_(d.controlId, 'изменён план мониторинга', null)) _v102PpkFlag_('изменён план мониторинга точки ' + d.controlId, null);
    }
    return res;
  }; });
  ['v30SaveProcess', 'v30SaveHazard', 'v75SaveFlow', 'v75SaveMeasure', 'v75LimitBasis', 'v75Validate', 'v75ConfirmFlow'].forEach(function (fn) {
    var what = { v30SaveProcess: 'изменён процесс', v30SaveHazard: 'изменена опасность', v75SaveFlow: 'изменена технологическая схема', v75SaveMeasure: 'изменена мера управления',
      v75LimitBasis: 'изменено обоснование предела', v75Validate: 'проведена валидация меры', v75ConfirmFlow: 'подтверждение схемы на площадке' }[fn];
    wrap(fn, function (orig) { return function (json, token) { var res = orig.apply(this, arguments); if (_v102Ok_(res)) { var d = _v102J_(json); _v102PpkFlag_(what + (d.name ? ' «' + d.name + '»' : ''), null); } return res; }; });
  });
  // MC-024: ККТ блюду — только по процессу из подтверждённой схемы
  wrap('mcSetTtkCcp', function (orig) { return function (json, token) {
    var d = _v102J_(json);
    if (d.remove !== true) { var fc = _v102FlowCovers_(String(d.code || ''), String(d.controlId || '')); if (!fc.ok) return _fail_('VALIDATION', fc.msg); }
    var res = orig.apply(this, arguments);
    if (_v102Ok_(res)) _v102PpkFlag_((d.remove === true ? 'снята' : 'назначена') + ' ККТ ' + d.controlId + ' для ТТК ' + d.code, null);
    return res;
  }; });
  // MC-023: утверждение — после проверки и согласования, директором, не автором
  wrap('v65Approve', function (orig) { return function (json, token) {
    var s = _v102Sess_(token), d = typeof json === 'string' && !/^\s*\{/.test(json) ? { ppkId: json } : _v102J_(json); _v102PpkPrep_();
    var p = _v65Get_(d.ppkId); if (!p) return _fail_('NOT_FOUND', 'ППК не найдена');
    var why = _v102PpkApproveGate_(p, s); if (why) return _fail_('FORBIDDEN', why);
    _v65SetCell_('PPK', p._row, 'Status', 'REVIEW');   // прежняя проверка v65Approve ждёт «На проверке» и повторяет проверку полноты
    var res = orig.apply(this, arguments);
    if (!_v102Ok_(res)) { var p2 = _v65Get_(d.ppkId); if (p2 && p2.Status === 'REVIEW') _v65SetCell_('PPK', p2._row, 'Status', 'AGREEMENT'); }
    return res;
  }; });
  wrap('v65Return', function (orig) { return function (json, token) {
    var d = _v102J_(json); _v102PpkPrep_(); var p = _v65Get_(d.ppkId);
    if (p && p.Status === 'AGREEMENT') _v65SetCell_('PPK', p._row, 'Status', 'REVIEW');
    return orig.apply(this, arguments);
  }; });
  wrap('v65CreatePpk', function (orig) { return function (json, token) {
    var res = orig.apply(this, arguments), j = _v102Res_(res);
    try { if (j && (j.success || j.ok)) { _v102PpkPrep_(); var id = j.data && (j.data.ppkId || j.data.id), p = id ? _v65Get_(id) : null, s = _v102Sess_(token), dd = _v102J_(json);
      if (p) { _v65SetCell_('PPK', p._row, 'Author', _v102Who_(s)); if (dd.basis) _v65SetCell_('PPK', p._row, 'Basis', _v102S_(dd.basis)); } } } catch (e) {}
    return res;
  }; });
  wrap('v65CompleteScheduleItem', function (orig) { return function (json, token) {
    var d = _v102J_(json), sc = null; try { sc = _v65Objs_('SCH').filter(function (x) { return x.ScheduleID === d.scheduleId; })[0]; } catch (e) {}
    var p = sc ? _v65Get_(sc.PPKID) : null; if (p && p.Status === 'ARCHIVED') return _fail_('VALIDATION', 'ППК в архиве — график не изменяется');
    return orig.apply(this, arguments);
  }; });
  // MC-025: срок в карте — предложение с основанием; действует после утверждения другим сотрудником
  wrap('setDishShelfLife', function (orig) { return function (code, hours, token, basis) {
    var op = null; try { op = _beginOp_(token, 'catalog', 'DISH_SHELF_PROPOSE', 'ТТК', code, null); } catch (e) { return _failFrom_(e); }
    try {
      var h = parseFloat(String(hours).replace(',', '.')), b = _v102S_(basis), dish = _buildDishIndexes_().dishByCode[code];
      if (!dish) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Карта не найдена', op.id); }
      if (!(h > 0 && h <= 8760)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Срок реализации: от 1 до 8760 часов', op.id); }
      if (b.length < 5) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Основание срока: документ и пункт (СанПиН, ТР ТС, ТУ), протокол исследований или утверждённая валидация', op.id); }
      var id = 'SH-' + Utilities.getUuid().slice(0, 8).toUpperCase(), who = _v102Who_(op.session);
      _withLock_(function () { _v102ShelfSheet_().appendRow([id, code, dish.name, h, b, 'PROPOSED', who, new Date(), '', '', '', op.id]); });
      ['Ответственный за ХАССП', 'Директор'].forEach(function (role) { try { _notify_('SHELF_PROPOSED', 'info', 'Срок реализации «' + dish.name + '» — на утверждение', h + ' ч, основание: ' + b + '. Предложил: ' + who, role, 'SHELF_' + id + role, op); } catch (e) {} });
      _audit_(op, 'DISH_SHELF_PROPOSE', 'ТТК', code, null, { hours: h, basis: b });
      _endOp_(op); return _ok_({ id: id, code: code, hours: h, status: 'PROPOSED', note: 'Срок предложен. Действует после утверждения ответственным за ХАССП или директором.' }, op.id);
    } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
  }; });
  wrap('_shelfLifeFor_', function (orig) { return function (code) {
    var r = orig.apply(this, arguments);
    if (r && r['источник'] === 'карта') { var a = _v102ShelfApprovedCard_(code); if (!a || Number(a['Часы']) !== Number(r['часы'])) {
      var nb = null; try { nb = typeof _v70ShelfFor_ === 'function' ? _v70ShelfFor_(code) : null; } catch (e) {}
      return nb && nb.hours > 0 ? { 'часы': nb.hours, 'источник': nb.src } : { 'часы': null, 'источник': 'в карте срок без утверждённого основания (' + r['часы'] + ' ч) — не применяется' }; } }
    return r;
  }; });
  // MC-025: срок партии п/ф при выпуске — только утверждённый (или короче)
  wrap('completeProduction', function (orig) { return function (id, actualQty, expiry, token) {
    var code = ''; try { var f = _findProduction_(_productionSheet_(), id); if (f) code = String(f.data[PROD_COL_.code]); } catch (e) {}
    if (!code) return orig.apply(this, arguments);
    var exp = expiry ? (typeof _lblDate_ === 'function' ? _lblDate_(expiry) : String(expiry)) : '';
    if (expiry && !exp) return orig.apply(this, arguments);   // формат даты проверит выпуск
    var rel = _v102ReleaseExpiry_(code, exp, new Date());
    if (rel.fail) return _fail_('SHELF_NOT_APPROVED', rel.fail);
    var res = orig.call(this, id, actualQty, rel.exp, token);
    try { if (_v102Ok_(res) && rel.none) ['Ответственный за ХАССП'].forEach(function (role) { _notify_('SHELF_MISSING', 'warning', 'Партия выпущена без срока годности: ' + code, 'Для ТТК нет утверждённого срока. Утвердите срок: валидация, таблица сроков или срок в карте с основанием.', role, 'SHELF_MISS_' + code + '_' + Utilities.formatDate(new Date(), _mcTz_(), 'yyyyMMdd'), null); }); } catch (e) {}
    try { var j = _v102Res_(res); if (j && (j.success || j.ok)) { j.data = j.data || {}; j.data.expiry = rel.exp; j.data.expiryBasis = rel.basis; return JSON.stringify(j); } } catch (e) {}
    return res;
  }; });
})(this);

(function () { try { if (!MC_SCHEDULE.some(function (j) { return j.fn === '_v102PpkTasksTick_'; })) MC_SCHEDULE.push({ fn: '_v102PpkTasksTick_', everyMin: 60 }); } catch (e) {} })();

MC_GATE_EXT_.v102PpkReview = { need: 'ppk_edit|haccp|ppk_approve', mut: true };
MC_GATE_EXT_.v102PpkAgree = { need: 'haccp|haccp_approve', mut: true };
MC_GATE_EXT_.v102PpkRevisionStart = { need: 'ppk_edit', mut: true };
MC_GATE_EXT_.v102PpkActive = { need: '*' };
MC_GATE_EXT_.v102ControlReadiness = { need: 'journals|haccp|ppk_approve|ppk_view' };
MC_GATE_EXT_.v102ControlApprove = { need: 'ppk_approve', mut: true };
MC_GATE_EXT_.v102ShelfDecide = { need: 'haccp|haccp_approve|ppk_approve|ttk_approve', mut: true };
MC_GATE_EXT_.v102ShelfData = { need: 'catalog|haccp|haccp_approve|ppk_approve|ttk_approve' };

/* Действующая ППК — экран главного окна для всех сотрудников (ссылки на главной и в ХАССП). */
(function () {
  try { MC_RB_MODULES_.ppkactive = '*'; MC_RB_MODULE_RU_.ppkactive = 'Действующая ППК'; } catch (e) {}
  try { if (MC_UI_VIEWS_.indexOf('ppkactive') < 0) MC_UI_VIEWS_ = MC_UI_VIEWS_.concat(['ppkactive']); } catch (e) {}
  try {
    ['home', 'haccp'].forEach(function (k) { var orig = _UI_BUILDERS_[k]; if (typeof orig !== 'function') return;
      _UI_BUILDERS_[k] = function (token, opts, s) { var r = orig(token, opts, s) || {}; r.actions = (r.actions || []).concat([{ label: 'Действующая ППК', module: 'ppkactive' }]); return r; }; });
  } catch (e) {}
})();
