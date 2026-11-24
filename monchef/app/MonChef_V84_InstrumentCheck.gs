/**
 * MonChef V84 — журналы J19 (калибровка термометров) и J20 (проверка весов) из проверки прибора по эталону (18.11.2026).
 *
 * Раньше: раз в месяц вопрос «Термометры откалиброваны, погрешность в допуске?» — «да / нет», а показаний эталона и прибора,
 * которых требует бланк, нигде не было. Теперь в «Средствах измерения»:
 *  1. «Допуск по паспорту» — у каждого термометра и весов: ± погрешность и документ, откуда она (паспорт, описание типа).
 *     Вносит ответственный за ХАССП; система допуск не подставляет.
 *  2. «Проверка по эталону» — точки проверки: показание эталона (контрольный термометр, тающий лёд, контрольная гиря)
 *     и показание прибора; контрольный прибор или гиря и их документ — обязательно (п. 8.7 a ГОСТ Р ИСО 22000-2019).
 *     Отклонение = прибор − эталон; «годен», если по модулю не больше допуска. Сохранение — строки J19 или J20 (по точке),
 *     запись в историю проверок прибора. «Не годен» — прибор блокируется и открывается оценка прежних измерений (как V76).
 *  3. Ежемесячный вопрос J19 / J20 больше не ставится, когда хоть у одного прибора этого вида внесён допуск: вместо него —
 *     «Проверка приборов: ждут N» на главном экране (приборы с допуском без проверки в этом месяце).
 * Внутренняя проверка не продлевает поверку: срок поверки в реестре не меняется.
 */
var MC_V84_TOL_ = 'СИ_Допуск_V84', MC_V84_TOL_HEAD_ = ['EquipmentID', 'Допуск ±', 'Ед.', 'Основание', 'Изменил', 'Изменено', 'OperationID'];
var MC_V84_KINDS_ = { THERMO_PROBE: 'J19', THERMO_IR: 'J19', THERMO_FRIDGE: 'J19', THERMO_LIQ: 'J19', SCALE: 'J20' };
var MC_V84_UNIT_ = { J19: '°C', J20: 'г' };

function _v84Num_(x) { if (x === '' || x == null) return null; var n = Number(String(x).replace(',', '.').replace(/\s/g, '')); return isFinite(n) ? n : null; }
function _v84R_(n) { return Math.round(n * 1000) / 1000; }
function _v84Tol_() {
  var m = {}; _v82Rows_(MC_V84_TOL_, MC_V84_TOL_HEAD_).forEach(function (r) { m[String(r.EquipmentID)] = { value: Number(r['Допуск ±']), unit: String(r['Ед.']), basis: String(r['Основание']), by: String(r['Изменил']) }; });
  return m;
}
function _v84Kinds_() { var m = {}; try { _v76Rows_('EQ').forEach(function (r) { m[String(r.EquipmentID)] = String(r['Вид']); }); } catch (e) {} return m; }
function _v84Month_(d) { return Utilities.formatDate(d || new Date(), _mcTz_(), 'yyyy-MM'); }
/** Проверки по эталону (V84) этого месяца: { EquipmentID: {result, date} } — последняя. */
function _v84MonthChecks_() {
  var m = {}, mon = _v84Month_();
  try { _v76Rows_('CAL').forEach(function (r) {
    if (String(r['Вид работ']) !== 'CHECK' || String(r['Документ']).indexOf('проверка по эталону') < 0) return;
    var d = _v76Date_(r['Дата']); if (!d || _v84Month_(d) !== mon) return;
    var k = String(r.EquipmentID); if (!m[k] || d >= m[k].date) m[k] = { result: String(r['Результат']), date: d };
  }); } catch (e) {}
  return m;
}
/** Приборы с допуском, не проверенные по эталону в этом месяце (или с результатом «не годен»). */
function _v84Due_() {
  var T = _v84Tol_(), K = _v84Kinds_(), C = _v84MonthChecks_(), out = [];
  _mcEqList_().forEach(function (e) {
    var j = MC_V84_KINDS_[K[String(e.id)]]; if (!j || !e.measuring || e.status !== 'ACTIVE' || !T[String(e.id)]) return;
    var c = C[String(e.id)]; if (c && c.result === 'PASS') return;
    out.push({ id: String(e.id), name: e.name, journal: j, failed: !!c });
  });
  return out;
}
function _v84Opted_(jid) { var T = _v84Tol_(), K = _v84Kinds_(); return Object.keys(T).some(function (id) { return MC_V84_KINDS_[K[id]] === jid; }); }

/** Допуск по паспорту: {equipmentId, tolerance, basis}. Единица — °C для термометров, г для весов. */
function v84SetTolerance(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V76_ME_EDIT_, 'INSTRUMENT_TOLERANCE', 'Средства измерения', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v76J_(json, {}), e = _v76Eq_(d.equipmentId);
    if (!e) return _v76Fail_(op, 'NOT_FOUND', 'Прибор не найден в реестре');
    var j = MC_V84_KINDS_[_v84Kinds_()[String(e.id)]];
    if (!j) return _v76Fail_(op, 'VALIDATION', 'Допуск для журналов J19 / J20 — только у термометров и весов: укажите вид прибора в «Сведениях»');
    var t = _v84Num_(d.tolerance);
    if (!(t > 0) || t > (j === 'J19' ? 10 : 5000)) return _v76Fail_(op, 'VALIDATION', 'Допуск — положительное число, ± ' + MC_V84_UNIT_[j] + ' (по паспорту прибора)');
    if (_v76S_(d.basis).length < 3) return _v76Fail_(op, 'VALIDATION', 'Укажите основание допуска: паспорт прибора, описание типа, руководство изготовителя');
    return _withLock_(function () {
      var who = _v76Who_(op), sh = _bcSheet_(MC_V84_TOL_, MC_V84_TOL_HEAD_), ex = _v82Rows_(MC_V84_TOL_, MC_V84_TOL_HEAD_).filter(function (r) { return String(r.EquipmentID) === String(e.id); })[0];
      var row = [String(e.id), t, MC_V84_UNIT_[j], _v76S_(d.basis), who.name, new Date(), op.id];
      if (ex) sh.getRange(ex._row, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
      _audit_(op, 'INSTRUMENT_TOLERANCE', 'Средства измерения', String(e.id), ex ? { допуск: ex['Допуск ±'] } : null, { допуск: t, ед: MC_V84_UNIT_[j], основание: _v76S_(d.basis) });
      _endOp_(op); return _ok_({ id: String(e.id), tolerance: t, unit: MC_V84_UNIT_[j], journal: j }, op.id);
    });
  } catch (e2) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e2, op && op.id); }
}

/** Проверка по эталону: {equipmentId, date, reference, points: [{ref, value}], confirm: true} → J19 / J20 и история прибора. */
function v84SaveCheck(json, token) {
  var op = null;
  try { op = _beginOp_(token, '*', 'INSTRUMENT_CHECK', 'Средства измерения', null, null); } catch (e) { return _failFrom_(e); }
  try {
    if (op.session && op.session.dev) return _v76Fail_(op, 'FORBIDDEN', 'Технический доступ записей не делает');
    var d = _v76J_(json, {}), e = _v76Eq_(d.equipmentId);
    if (!e) return _v76Fail_(op, 'NOT_FOUND', 'Прибор не найден в реестре');
    if (!e.measuring) return _v76Fail_(op, 'VALIDATION', 'Прибор не отмечен как измерительный');
    var j = MC_V84_KINDS_[_v84Kinds_()[String(e.id)]];
    if (!j) return _v76Fail_(op, 'VALIDATION', 'Проверка по эталону с записью в J19 / J20 — для термометров и весов: укажите вид прибора в «Сведениях»');
    if (!_mcRbJournalAllowed_(op.session, j)) return _v76Fail_(op, 'FORBIDDEN', 'Журнал ' + (j === 'J19' ? 'калибровки термометров' : 'проверки весов') + ' вы не ведёте');
    var T = _v84Tol_()[String(e.id)];
    if (!T) return _v76Fail_(op, 'VALIDATION', 'У прибора не внесён допуск по паспорту — его вносит ответственный за ХАССП («Допуск по паспорту»)');
    var dt = d.date ? _v76Date_(d.date) : new Date(); if (!dt || dt.getTime() > Date.now() + 60000) return _v76Fail_(op, 'VALIDATION', 'Дата проверки — не позже сегодняшней');
    if (_v76S_(d.reference).length < 5) return _v76Fail_(op, 'VALIDATION', j === 'J19' ? 'Укажите эталон: контрольный термометр (№ и свидетельство о поверке) или тающий лёд / кипящая вода и чем подтверждено' : 'Укажите контрольную гирю: масса, класс точности, документ');
    var P = [].concat(d.points || []).map(function (p) { return { ref: _v84Num_(p && p.ref), value: _v84Num_(p && p.value) }; }).filter(function (p) { return p.ref !== null || p.value !== null; });
    if (!P.length || P.length > 5) return _v76Fail_(op, 'VALIDATION', 'Внесите от 1 до 5 точек проверки: показание эталона и показание прибора');
    if (P.some(function (p) { return p.ref === null || p.value === null; })) return _v76Fail_(op, 'VALIDATION', 'В каждой точке — и показание эталона, и показание прибора (числом)');
    if (j === 'J20' && P.some(function (p) { return !(p.ref > 0); })) return _v76Fail_(op, 'VALIDATION', 'Масса контрольной гири — больше нуля, в граммах');
    if (d.confirm !== true) return _v76Fail_(op, 'VALIDATION', 'Подтвердите, что показания сняли сами');
    P.forEach(function (p) { p.dev = _v84R_(p.value - p.ref); p.pass = Math.abs(p.dev) <= T.value + 1e-9; });
    var pass = P.every(function (p) { return p.pass; }), u = MC_V84_UNIT_[j], who = _v76Who_(op), a = _author_(op);
    var sum = P.map(function (p) { return 'эталон ' + p.ref + ' ' + u + ' → прибор ' + p.value + ' ' + u + ' (' + (p.dev > 0 ? '+' : '') + p.dev + ', ' + (p.pass ? 'в допуске' : 'вне допуска') + ')'; }).join('; ');
    return _withLock_(function () {
      var id = _v76Id_('CAL');
      _v76Append_('CAL', { CalID: id, EquipmentID: String(e.id), 'Вид работ': 'CHECK', 'Дата': dt, 'Действует до': '', 'Результат': pass ? 'PASS' : 'FAIL',
        'Документ': 'журнал ' + j + ', проверка по эталону', 'Выполнил': who.name, 'Прослеживаемость / база': _v76S_(d.reference), 'Регулировка': 'нет', 'Что отрегулировано': '',
        'Примечание': 'допуск ±' + T.value + ' ' + u + ' (' + T.basis + '); ' + sum, 'Внёс': who.name, 'Внесено': new Date(), OperationID: op.id });
      var nm = e.name + (e.serial ? ', зав. № ' + e.serial : '') + (e.model ? ' (' + e.model + ')' : ''), day = _v76Day_(dt), src = 'проверка по эталону · ' + id;
      P.forEach(function (p) {
        var o = { 'Дата': day, 'Погрешность': (p.dev > 0 ? '+' : '') + p.dev + ' ' + u + ' (допуск ±' + T.value + ')', 'Годен (да/нет)': p.pass ? 'да' : 'нет', 'ФИО': a.фио };
        if (j === 'J19') { o['Термометр (№, тип)'] = nm; o['Показания эталона'] = p.ref + ' °C (' + _v76S_(d.reference) + ')'; o['Показания термометра'] = p.value + ' °C'; }
        else { o['Весы (№, тип)'] = nm; o['Эталонный вес'] = p.ref + ' г (' + _v76S_(d.reference) + ')'; o['Показания весов'] = p.value + ' г'; }
        _v81Append_(j, o, op, src);   // автор записи — из операции (сессия), не из готовой карточки
      });
      var out = { id: id, journal: j, result: pass ? 'PASS' : 'FAIL', points: P, tolerance: T.value, unit: u };
      if (!pass) {
        var ev = _v76OpenEval_(op, e, 'FAILED', 'проверка по эталону ' + day + ': вне допуска ±' + T.value + ' ' + u + ' — ' + sum, dt, _v76EqInfo_());
        out.evalId = ev.id; out.measurements = ev.impact.count; out.batches = ev.impact.batches.length;
      }
      _audit_(op, 'INSTRUMENT_CHECK', 'Средства измерения', String(e.id), null, { calId: id, journal: j, result: out.result, точки: P });
      _endOp_(op); return _ok_(out, op.id);
    });
  } catch (e2) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e2, op && op.id); }
}

/* ---------------- экран, главный экран, расписание ---------------- */
try {
  var _v84o_me_ = v76MeData;
  v76MeData = function (token) {
    var r = _v84o_me_.apply(this, arguments);
    try {
      var x = JSON.parse(r); if (!x || !x.success || !x.data) return r;
      var s = _getSession_(token), T = _v84Tol_(), K = _v84Kinds_(), C = _v84MonthChecks_();
      (x.data.instruments || []).forEach(function (e) {
        var j = MC_V84_KINDS_[K[String(e.id)]]; e.j = j || '';
        if (!j) return;
        e.tol = T[String(e.id)] || null; e.tolUnit = MC_V84_UNIT_[j];
        var c = C[String(e.id)]; e.monthCheck = c ? { result: c.result, date: _v76Day_(c.date) } : null;
        e.canCheck = !!s && !s.dev && _mcRbJournalAllowed_(s, j);
      });
      x.data.due = _v84Due_(); x.data.canTol = !!s && _mcRbHasExact_(s, MC_V76_ME_EDIT_);
      return JSON.stringify(x);
    } catch (e) { return r; }
  };
} catch (e) {}
// ежемесячный вопрос J19 / J20 не ставится, когда проверки ведутся по эталону (у прибора этого вида внесён допуск)
try {
  var _v84o_auto_ = _isAutoJournal_;
  _isAutoJournal_ = function (jid) {
    if (_v84o_auto_.apply(this, arguments)) return true;
    if (jid !== 'J19' && jid !== 'J20') return false;
    try { return _v84Opted_(jid); } catch (e) { return false; }
  };
} catch (e) {}
(function () {
  if (typeof _UI_BUILDERS_ !== 'object') return;
  var orig = _UI_BUILDERS_.home; if (typeof orig !== 'function') return;
  _UI_BUILDERS_.home = function (token, opts, s) {
    var r = orig(token, opts, s) || {};
    try {
      if (s && !s.dev) {
        var D = _v84Due_().filter(function (x) { return _mcRbJournalAllowed_(s, x.journal); });
        if (D.length) r.actions = (r.actions || []).concat([{ label: 'Проверка приборов: ждут ' + D.length, module: 'metrology' }]);
      }
    } catch (e) {}
    return r;
  };
})();
