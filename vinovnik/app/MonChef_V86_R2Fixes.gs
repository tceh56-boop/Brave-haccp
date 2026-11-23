/**
 * MonChef V86 — исправления по повторному аудиту R2 от 18.11.2026 (18.11.2026).
 *
 *  P0.1  Фритюр: сначала записывается цикл, затем шаги (склад, строка J38), каждый шаг отмечается; повтор после тайм-аута
 *        (тот же ключ или тот же сотрудник и данные в течение 2 минут) возвращает тот же цикл или доводит незавершённый шаг —
 *        второго цикла и второй строки J38 нет (MonChef_V81_AutoJournals.gs).
 *  P0.2  Масло со склада: при «Залил масло» можно выбрать партию масла — она списывается (useBatch: состояние партии, FEFO,
 *        остаток), цикл связан с партией (TRACE_LINKS); утилизированный жир — связь цикла с утилизацией.
 *  P0.3  Осмотр персонала — одна модель: «самоотметка → осмотр ответственного → одна строка J07». Вопросы журнала по
 *        расписанию (autoHealthJournal) больше не создаются (режим «journal» можно вернуть на экране «Здоровье на смену»);
 *        уже заведённая строка J07 дописывается, её вопрос закрывается; ответ на вопрос журнала отражается на экране осмотра.
 *  P1.1  Обучение: повтор той же записи (сотрудник, вид, тема, дата) не создаёт второй записи и второй строки J16/J17.
 *  P1.2  J18: строка ищется по точному ID в «Источнике записи», а не по подстроке в любой ячейке.
 *  P1.3  Фритюр: причина окончания — из списка (обязательна; «другое» — с пояснением); баланс жира (переходящий + залито +
 *        долито против остатка и утилизации) — расхождение помечается «нужна сверка» и уходит шеф-повару; допуск не подставляется.
 *  5.2   Банкеты: задача бракеража ставится и для банкетов, пропущенных расписанием (до 3 суток), с пометкой «с опозданием» (Code.gs).
 */

/* ---------- общие ---------- */
function _v86Cell_(v) { return v instanceof Date ? MC_V81_DAY_(v) : String(v === undefined || v === null ? '' : v).trim(); }
/** Последняя строка журнала, где все колонки keys совпадают с obj (даты — по дню). 0 — нет. */
function _v86JournalFind_(jid, obj, keys) {
  var j = _mcJById_(jid), sh = j && _book_().getSheetByName(j.sheetName); if (!sh || sh.getLastRow() < 2) return 0;
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, j.columns.length).getValues(), ix = keys.map(function (k) { return j.columns.indexOf(k); });
  if (ix.some(function (i) { return i < 0; })) return 0;
  for (var i = v.length - 1; i >= 0; i--) if (keys.every(function (k, n) { return _v86Cell_(v[i][ix[n]]) === _v86Cell_(obj[k]); })) return i + 2;
  return 0;
}
/** Обучение уже внесено: тот же сотрудник, вид, тема и дата → ID записи. */
function _v86TrainingDup_(d) {
  if (!d || !d.сотрудник || !d.вид) return '';
  var dt = d.дата ? _parseDate_(d.дата) : new Date(); if (!dt) return '';
  var day = MC_V81_DAY_(dt), v = _trainingSheet_().getDataRange().getValues();
  for (var i = v.length - 1; i >= 1; i--) {
    if (!v[i][0]) continue;
    if (_v86Cell_(v[i][1]) === String(d.сотрудник).trim() && _v86Cell_(v[i][3]) === String(d.вид).trim() && _v86Cell_(v[i][4]) === String(d.тема || '').trim() && _v86Cell_(v[i][5] instanceof Date ? v[i][5] : _parseDate_(v[i][5]) || v[i][5]) === day) return String(v[i][0]);
  }
  return '';
}

/* ---------- P0.3: осмотр персонала — одна строка J07 ---------- */
var MC_V86_HEALTH_PROP_ = 'MC_HEALTH_ROUTE';
function _v86HealthRoute_() { try { return String(PropertiesService.getScriptProperties().getProperty(MC_V86_HEALTH_PROP_) || 'shift') === 'journal' ? 'journal' : 'shift'; } catch (e) { return 'shift'; } }
function _v86HealthRouteAllowed_(s) { var r = _mcRbNormRole_(s.role); return r === MC_RB_J_.X || r === MC_RB_J_.D; }
function _v86Admit_(v) { var t = String(v || '').trim().toLowerCase(); if (!t) return ''; if (/^нет|^не соответствует/.test(t)) return 'нет'; if (/^да|^соответствует/.test(t)) return 'да'; return String(v); }
/** Строки J07 за день: ФИО → {row, admit: 'да'|'нет'|'', by}. */
function _v86J07Day_(day) {
  var out = {}, j = _mcJById_('J07'), sh = j && _book_().getSheetByName(j.sheetName); if (!sh || sh.getLastRow() < 2) return out;
  var v = sh.getDataRange().getValues(), cd = j.columns.indexOf('Дата'), cf = j.columns.indexOf('ФИО сотрудника'), ca = j.columns.indexOf('Допуск к работе (да/нет)');
  for (var i = 1; i < v.length; i++) { if (_v86Cell_(v[i][cd]) !== day || !v[i][cf]) continue; var n = String(v[i][cf]).trim(), a = _v86Admit_(v[i][ca]); if (!out[n] || a || !out[n].admit) out[n] = { row: i + 1, admit: a, by: '' }; }
  // кто ответил на вопрос журнала
  try { var pv = _pendSheet_().getDataRange().getValues(); for (var p = 1; p < pv.length; p++) if (String(pv[p][2]) === 'J07' && String(pv[p][8]) === 'выполнено') Object.keys(out).forEach(function (n) { if (out[n].row === Number(pv[p][16])) out[n].by = String(pv[p][11] || ''); }); } catch (e) {}
  return out;
}
function _v86J07Patch_(row, vals, src) {
  var j = _mcJById_('J07'), sh = _book_().getSheetByName(j.sheetName), hd = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  Object.keys(vals).forEach(function (k) { var ci = j.columns.indexOf(k); if (ci >= 0) sh.getRange(row, ci + 1).setValue(vals[k]); });
  var si = hd.indexOf('Источник записи'); if (si >= 0) { var cur = String(sh.getRange(row, si + 1).getValue() || ''); sh.getRange(row, si + 1).setValue((cur ? cur + ' → ' : '') + src); }
  try { if (typeof _mcMirrorRow_ === 'function') _mcMirrorRow_('J07', row); } catch (e) {}
  return row;
}
/** Закрыть открытые вопросы журнала по строке (ответ дан другим маршрутом). */
function _v86ClosePending_(jid, row, ans, who) {
  var n = 0;
  try { var ps = _pendSheet_(), pv = ps.getDataRange().getValues();
    for (var i = 1; i < pv.length; i++) if (String(pv[i][2]) === jid && Number(pv[i][16]) === Number(row) && ['выполнено', 'отменено'].indexOf(String(pv[i][8])) < 0) {
      ps.getRange(i + 1, 9, 1, 5).setValues([['выполнено', ans, '', who, new Date()]]); n++; } } catch (e) {}
  return n;
}
function _v86HlMark_(sh, row, admit, who, jr) {
  var H = MC_V81_HL_HEAD_; [['Допуск', admit], ['Осмотрел', who], ['Время осмотра', new Date()], ['Строка J07', jr]].forEach(function (p) { sh.getRange(row, H.indexOf(p[0]) + 1).setValue(p[1]); });
}
/** Ждут осмотра: отметились, решения нет ни на экране, ни в J07. */
function _v86HlWaiting_(day, R) {
  var J = _v86J07Day_(day);
  return (R || _v81HlRows_(day)).filter(function (x) { var n = String(x['Сотрудник']); return !x['Допуск'] && !(J[n] && J[n].admit); });
}
function _v86ActiveStaff_() {
  try { return JSON.parse(getEmployeesFull_() || '[]').filter(function (e) { return e.active !== false && e.fullName; }).map(function (e) { return { name: String(e.fullName), position: String(e.position || '') }; }); } catch (e) { return []; }
}
/** Режим осмотра: {route: 'shift' | 'journal'} — ответственный за ХАССП или директор. */
function v86HealthRoute(json, token) {
  var op = null;
  try { op = _beginOp_(token, '', 'HEALTH_ROUTE', 'Персонал', 'J07', null); } catch (e) { return _failFrom_(e); }
  try {
    var s = op.session; if (!s || s.dev || !_v86HealthRouteAllowed_(s)) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', 'Режим осмотра меняют ответственный за ХАССП и директор', op.id); }
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), r = String(d.route || '');
    if (['shift', 'journal'].indexOf(r) < 0) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Режим: shift (самоотметка и осмотр) или journal (вопросы журнала по расписанию)', op.id); }
    var was = _v86HealthRoute_(); PropertiesService.getScriptProperties().setProperty(MC_V86_HEALTH_PROP_, r);
    _audit_(op, 'HEALTH_ROUTE', 'Персонал', 'J07', { route: was }, { route: r });
    _endOp_(op); return _ok_({ route: r }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
// расписание: в режиме «shift» бланки J07 с вопросами не заводятся — второго маршрута нет
try {
  var _v86o_ahj_ = autoHealthJournal;
  autoHealthJournal = function (token) {
    if (_v86HealthRoute_() === 'journal') return _v86o_ahj_(token);
    var op = null; try { op = _beginOpOrTrigger_(token, 'journals', 'JOURNAL_HEALTH_AUTO', 'Журналы'); } catch (e) { return _failFrom_(e); }
    _endOp_(op);
    return _ok_({ сотрудников: 0, режим: 'shift', примечание: 'Осмотр ведётся на экране «Здоровье на смену»: сотрудник отмечается сам, ответственный осматривает и подтверждает допуск — одна строка J07 на человека. Вопросы журнала по расписанию не создаются.' }, op && op.id);
  };
} catch (e) {}
// ответ на вопрос журнала J07 (прежний маршрут) — отражается на экране осмотра, «ждут осмотра» не дублирует
function _v86HealthSyncFromPending_(pid) {
  var pv = _pendSheet_().getDataRange().getValues(), p = null;
  for (var i = 1; i < pv.length; i++) if (String(pv[i][0]) === String(pid)) { p = pv[i]; break; }
  if (!p || String(p[2]) !== 'J07' || !(Number(p[16]) > 1)) return 0;
  var j = _mcJById_('J07'), sh = _book_().getSheetByName(j.sheetName), r = sh.getRange(Number(p[16]), 1, 1, j.columns.length).getValues()[0];
  var day = _v86Cell_(r[j.columns.indexOf('Дата')]), n = String(r[j.columns.indexOf('ФИО сотрудника')] || '').trim(), a = _v86Admit_(r[j.columns.indexOf('Допуск к работе (да/нет)')]);
  if (!a) return 0;
  var hr = _v81HlRows_(day).filter(function (x) { return String(x['Сотрудник']) === n && !x['Допуск']; })[0]; if (!hr) return 0;
  _v86HlMark_(_bcSheet_(MC_V81_HL_, MC_V81_HL_HEAD_), hr._row, a + ' (журнал J07)', String(p[11] || ''), Number(p[16]));
  return 1;
}
try {
  var _v86o_ajc_ = answerJournalCheck;
  answerJournalCheck = function (json, token) {
    var r = _v86o_ajc_(json, token);
    try { var x = typeof r === 'string' ? JSON.parse(r) : r; if (x && (x.success || x.ok)) _withLock_(function () { _v86HealthSyncFromPending_(JSON.parse(json || '{}').id); }); } catch (e) {}
    return r;
  };
} catch (e) {}

/* ---------- P1.3: сверка баланса фритюрного жира ---------- */
/** {cycle, note} — шеф-повар, су-шеф, ответственный за ХАССП, директор: что выяснили при сверке. */
function v86FryerReview(json, token) {
  var op = null;
  try { op = _beginOp_(token, '', 'FRYER_REVIEW', 'Журналы', 'J38', null); } catch (e) { return _failFrom_(e); }
  try {
    if (!_v86FryReviewer_(op.session)) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', 'Сверку баланса жира подтверждают шеф-повар, су-шеф, ответственный за ХАССП, директор', op.id); }
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), note = String(d.note || '').trim();
    if (!note) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Опишите, что выяснили при сверке (ошибка взвешивания, не внесён долив и т. п.)', op.id); }
    return _withLock_(function () {
      var c = _v86FryCycle_(d.cycle);
      if (!c) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Цикл не найден', op.id); }
      if (!/^НУЖНА СВЕРКА/.test(String(c['Сверка']))) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Цикл не ждёт сверки', op.id); }
      var who = _author_(op).фио, was = String(c['Сверка']), txt = 'сверено: ' + note + ' (было: ' + was.replace(/^НУЖНА СВЕРКА:\s*/, '') + ')';
      _v86FrySet_(c._row, { 'Сверка': txt, 'Сверил': who + ', ' + Utilities.formatDate(new Date(), _mcTz_(), 'dd.MM.yyyy HH:mm') });
      var j = _mcJById_('J38'), js = _book_().getSheetByName(j.sheetName), jr = Number(c['Строка J38']), ci = j.columns.indexOf('Примечания / корректирующие действия');
      if (js && jr > 1 && ci >= 0) { js.getRange(jr, ci + 1).setValue(String(js.getRange(jr, ci + 1).getValue() || '').replace('баланс жира не сходится — передано на сверку', 'баланс сверен: ' + note)); try { _mcMirrorRow_('J38', jr); } catch (e) {} }
      _audit_(op, 'FRYER_REVIEW', 'Журналы', 'J38', { сверка: was }, { сверка: txt });
      _endOp_(op); return _ok_({ cycle: String(c.CycleID) }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
