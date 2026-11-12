/**
 * MON CHEF — учёт личных медицинских книжек.
 *
 * По каждому сотруднику: № медкнижки, дата медосмотра и срок следующего,
 * дата гигиенической аттестации и срок следующей, прививки/примечания.
 * Статус считается по ближайшему сроку: «Просрочено», «Истекает» (30 дней),
 * «В порядке», «Нет данных».
 *
 * Данные — персональные (в т.ч. о здоровье): чтение и правка только у
 * администратора (право «personnel»), шеф-повара и медработника. № книжки, срок аттестации и дата медосмотра
 * дублируются в карточку сотрудника (лист «Сотрудники», колонки J–L), чтобы
 * карточка и старые напоминания показывали те же даты.
 *
 * Периодичность по умолчанию — 12 месяцев (Свойства скрипта
 * MC_MED_EXAM_MONTHS и MC_MED_ATTEST_MONTHS). Срок можно указать вручную —
 * тогда берётся он.
 */
var MC_MED_SHEET = 'Медкнижки';
var MC_MED_HEAD = ['ID', 'Сотрудник', 'Должность', '№ медкнижки', 'Дата медосмотра', 'Следующий медосмотр',
  'Дата гигиенической аттестации', 'Следующая аттестация', 'Прививки / примечания', 'Активна', 'Обновлено', 'Кем'];
var MC_MED_WARN_DAYS = 30;

function setupMedBooks() {
  var ss = _book_(), sh = ss.getSheetByName(MC_MED_SHEET);
  if (!sh) {
    sh = ss.insertSheet(MC_MED_SHEET);
    sh.getRange(1, 1, 1, MC_MED_HEAD.length).setValues([MC_MED_HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function _medMonths_(key) {
  var v = parseInt(PropertiesService.getScriptProperties().getProperty(key), 10);
  return v > 0 ? v : 12;
}
// Дата из ячейки или строки «дд.мм.гггг» / «гггг-мм-дд»; иначе null
function _medDate_(v) {
  if (!v) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? null : new Date(v.getFullYear(), v.getMonth(), v.getDate());
  var s = String(v).trim(), m;
  if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s))) return new Date(+m[3], +m[2] - 1, +m[1]);
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return new Date(+m[1], +m[2] - 1, +m[3]);
  return null;
}
function _medIso_(d) {
  if (!d) return '';
  var p = function (n) { return ('0' + n).slice(-2); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function _medAddMonths_(d, n) { return d ? new Date(d.getFullYear(), d.getMonth() + n, d.getDate()) : null; }
function _medToday_() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
function _medDays_(d, today) { return d ? Math.round((d.getTime() - today.getTime()) / 86400000) : null; }

function _medCanRead_(token) {
  var s = _requireAuth_(token);
  var p = s.permissions || {}, r = getRolePermissions(s.role);
  // данные о здоровье: кадры (personnel), допуск к смене и медработник (medical)
  if (p.all === true || p.personnel === true || r.personnel === true || r.medical === true) return s;
  throw new Error('FORBIDDEN: медкнижки доступны администратору, руководителю, шеф-повару, медработнику и аудитору');
}

// Все записи с рассчитанными сроками и статусом. Сотрудники без записи
// подтягиваются из карточек (лист «Сотрудники»), чтобы никто не выпал из учёта.
function _medList_() {
  var sh = setupMedBooks(), v = sh.getDataRange().getValues(), today = _medToday_();
  var examM = _medMonths_('MC_MED_EXAM_MONTHS'), attM = _medMonths_('MC_MED_ATTEST_MONTHS');
  var byName = {}, items = [];
  for (var i = 1; i < v.length; i++) {
    var r = v[i];
    if (!r[0] || r[9] === false) continue;
    items.push(_medItem_({ id: String(r[0]), name: String(r[1]), position: String(r[2] || ''), number: String(r[3] || ''),
      exam: _medDate_(r[4]), examNext: _medDate_(r[5]), att: _medDate_(r[6]), attNext: _medDate_(r[7]), notes: String(r[8] || ''),
      source: 'medbook' }, today, examM, attM));
    byName[String(r[1]).toLowerCase().replace(/\s+/g, ' ').trim()] = true;
  }
  var emps = [];
  try { emps = JSON.parse(getEmployeesFull_()); } catch (e) {}
  emps.forEach(function (e) {
    if (e.active === false || !e.fullName) return;
    var key = e.fullName.toLowerCase().replace(/\s+/g, ' ').trim();
    if (byName[key]) return;
    items.push(_medItem_({ id: '', name: e.fullName, position: e.position || '', number: e.sanBookNumber || '',
      exam: _medDate_(e.lastMedicalExam), examNext: null, att: null, attNext: _medDate_(e.sanBookExpiry), notes: '',
      source: 'employee' }, today, examM, attM));
  });
  items.sort(function (a, b) { return a.rank - b.rank || (a.daysLeft === null ? 1e9 : a.daysLeft) - (b.daysLeft === null ? 1e9 : b.daysLeft) || a.name.localeCompare(b.name, 'ru'); });
  return items;
}
function _medItem_(x, today, examM, attM) {
  var examNext = x.examNext || _medAddMonths_(x.exam, examM);
  var attNext = x.attNext || _medAddMonths_(x.att, attM);
  var dE = _medDays_(examNext, today), dA = _medDays_(attNext, today);
  var known = [dE, dA].filter(function (d) { return d !== null; });
  var left = known.length ? Math.min.apply(null, known) : null;
  var status, rank;
  if (left !== null && left < 0) { status = 'Просрочено'; rank = 0; }
  else if (dE === null || dA === null || !x.number) { status = 'Нет данных'; rank = 1; }
  else if (left <= MC_MED_WARN_DAYS) { status = 'Истекает'; rank = 2; }
  else { status = 'В порядке'; rank = 3; }
  return { id: x.id, name: x.name, position: x.position, number: x.number,
    exam: _medIso_(x.exam), examNext: _medIso_(examNext), att: _medIso_(x.att), attNext: _medIso_(attNext),
    examDays: dE, attDays: dA, daysLeft: left, notes: x.notes, status: status, rank: rank, source: x.source,
    allowed: status === 'В порядке' || status === 'Истекает' };
}

function getMedBooks(token) {
  try {
    _medCanRead_(token);
    var items = _medList_();
    var c = { overdue: 0, soon: 0, nodata: 0, ok: 0 };
    items.forEach(function (x) { c[x.rank === 0 ? 'overdue' : x.rank === 1 ? 'nodata' : x.rank === 2 ? 'soon' : 'ok']++; });
    var emps = [];
    try { emps = JSON.parse(getEmployeesFull_()).filter(function (e) { return e.active !== false && e.fullName; })
      .map(function (e) { return { name: e.fullName, position: e.position || '' }; }); } catch (e) {}
    return JSON.stringify({ ok: true, items: items, counts: c, employees: emps,
      examMonths: _medMonths_('MC_MED_EXAM_MONTHS'), attMonths: _medMonths_('MC_MED_ATTEST_MONTHS') });
  } catch (e) { return JSON.stringify({ ok: false, error: String(e.message || e) }); }
}

function saveMedBook(json, token) {
  try {
    return _withOperation_(token, 'journals', 'MEDBOOK_SAVE', 'Медкнижки', null, null, function (op) {
      return _saveMedBook_core_(json, token, op);
    });
  } catch (e) { return JSON.stringify({ ok: false, error: String(e.message || e) }); }
}
function _saveMedBook_core_(json, token, op) {
  try {
    var s = _medCanRead_(token);
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    var name = String(d.name || '').replace(/\s+/g, ' ').trim();
    if (!name) return JSON.stringify({ ok: false, error: 'Укажите сотрудника' });
    var exam = _medDate_(d.exam), examNext = _medDate_(d.examNext), att = _medDate_(d.att), attNext = _medDate_(d.attNext);
    var today = _medToday_();
    if (exam && exam > today) return JSON.stringify({ ok: false, error: 'Дата медосмотра не может быть в будущем' });
    if (att && att > today) return JSON.stringify({ ok: false, error: 'Дата аттестации не может быть в будущем' });
    if (exam && examNext && examNext <= exam) return JSON.stringify({ ok: false, error: 'Следующий медосмотр должен быть позже прошедшего' });
    if (att && attNext && attNext <= att) return JSON.stringify({ ok: false, error: 'Следующая аттестация должна быть позже прошедшей' });
    if (!examNext && exam) examNext = _medAddMonths_(exam, _medMonths_('MC_MED_EXAM_MONTHS'));
    if (!attNext && att) attNext = _medAddMonths_(att, _medMonths_('MC_MED_ATTEST_MONTHS'));
    var who = _mcSessionFullName_(s) || s.name || '';
    return _withLock_(function () {
      var sh = setupMedBooks(), v = sh.getDataRange().getValues(), row = -1;
      var key = name.toLowerCase();
      for (var i = 1; i < v.length; i++) {
        if ((d.id && String(v[i][0]) === String(d.id)) || (!d.id && String(v[i][1]).toLowerCase().replace(/\s+/g, ' ').trim() === key && v[i][9] !== false)) { row = i + 1; break; }
      }
      var id = row > 0 ? String(v[row - 1][0]) : 'MB' + Date.now() + '-' + Utilities.getUuid().slice(0, 6);
      var line = [id, name, String(d.position || ''), String(d.number || '').trim(), exam || '', examNext || '', att || '', attNext || '',
        String(d.notes || ''), true, new Date(), who];
      if (row > 0) sh.getRange(row, 1, 1, line.length).setValues([line]);
      else sh.appendRow(line);
      _medSyncEmployee_(name, line[3], attNext, exam);
      if (op) _audit_(op, 'MEDBOOK_SAVE', 'Медкнижки', id, null, { сотрудник: name, медосмотр_до: _medIso_(examNext), аттестация_до: _medIso_(attNext) });
      return JSON.stringify({ ok: true, id: id });
    });
  } catch (e) { return JSON.stringify({ ok: false, error: String(e.message || e) }); }
}

// Карточка сотрудника: J — № книжки, K — срок (следующая аттестация), L — последний медосмотр
function _medSyncEmployee_(name, number, attNext, exam) {
  try {
    var sh = _employeesSheet_(), v = sh.getDataRange().getValues(), key = name.toLowerCase();
    for (var i = 1; i < v.length; i++) {
      var full = [v[i][0], v[i][1], v[i][2]].filter(Boolean).join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
      if (full !== key) continue;
      if (number) sh.getRange(i + 1, 10).setValue(number);
      if (attNext) sh.getRange(i + 1, 11).setValue(attNext);
      if (exam) sh.getRange(i + 1, 12).setValue(exam);
      return true;
    }
  } catch (e) { try { _log_('WARN', 'медкнижка → карточка сотрудника: ' + e); } catch (x) {} }
  return false;
}

function archiveMedBook(id, token) {
  try { return _archiveMedBook_(id, token); } catch (e) { return JSON.stringify({ ok: false, error: String(e.message || e) }); }
}
function _archiveMedBook_(id, token) {
  return _withOperation_(token, 'journals', 'MEDBOOK_ARCHIVE', 'Медкнижки', id, null, function (op) {
    try {
      _medCanRead_(token);
      var sh = setupMedBooks(), v = sh.getDataRange().getValues();
      for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(id)) {
        sh.getRange(i + 1, 10).setValue(false);
        if (op) _audit_(op, 'MEDBOOK_ARCHIVE', 'Медкнижки', id, null, { сотрудник: v[i][1] });
        return JSON.stringify({ ok: true });
      }
      return JSON.stringify({ ok: false, error: 'Запись не найдена' });
    } catch (e) { return JSON.stringify({ ok: false, error: String(e.message || e) }); }
  });
}

// Допуск по медкнижке для смены и журналов осмотра: true — можно, false — нельзя, null — не найден
function mcMedBookAllowed(name) {
  var key = String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
  var x = _medList_().filter(function (i) { return i.name.toLowerCase().replace(/\s+/g, ' ').trim() === key; })[0];
  return x ? x.allowed : null;
}

// Ежедневная проверка сроков: уведомление ответственному о просроченных и истекающих
// (повтор не чаще, чем позволяет защита от дублей уведомлений).
function medBooksDailyCheck() {
  var items = _medList_(), sent = 0;
  items.forEach(function (x) {
    if (x.rank !== 0 && x.rank !== 2) return;
    var what = [];
    if (x.examDays !== null && x.examDays <= MC_MED_WARN_DAYS) what.push('медосмотр ' + (x.examDays < 0 ? 'просрочен с ' : 'до ') + x.examNext.split('-').reverse().join('.'));
    if (x.attDays !== null && x.attDays <= MC_MED_WARN_DAYS) what.push('аттестация ' + (x.attDays < 0 ? 'просрочена с ' : 'до ') + x.attNext.split('-').reverse().join('.'));
    var overdue = x.rank === 0;
    var id = _notify_('medbook', overdue ? 'critical' : 'warning',
      (overdue ? 'Медкнижка просрочена: ' : 'Медкнижка истекает: ') + x.name,
      what.join('; ') + (overdue ? '. Не допускать к работе до прохождения.' : '. Запишите сотрудника заранее.'),
      'Администратор', 'medbook|' + x.name + '|' + x.status + '|' + x.examNext + '|' + x.attNext, null);
    if (id) sent++;
  });
  return { ok: true, checked: items.length, notified: sent };
}
