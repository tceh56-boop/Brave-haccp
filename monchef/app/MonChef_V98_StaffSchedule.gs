/**
 * MON CHEF V98 — график смен сотрудников и нехватка персонала по сменам.
 *
 * Смены — расписание V89 («Смены_Расписание»: название, дни недели или дата, начало, окончание, площадка). График — лист «График_Смен_V98»:
 *   кто (сотрудник из штата), когда (дата и смена или своё время), на какой площадке (V97), статус: «в графике» / «отсутствует» (причина —
 *   отпуск, отгул, уважительная, без причины, другое — без медицинских подробностей) / «снят».
 * Норма персонала — лист «Нормы_Персонала_V98»: сколько сотрудников роли нужно на смене площадки; задаёт руководитель с основанием
 *   (штатное расписание, решение директора) — система норму не придумывает. Нет нормы — нехватка по роли не считается («нет нормы»).
 * Потребность поваров по прогнозу: если в «Прогнозах» задана норма выработки (порций в час на сотрудника) — пик спроса в часы смены
 *   (среднее по тем же дням недели, продажи площадки) / норма. История меньше 3 наблюдений — «НЕТ ДАННЫХ».
 * Предупреждения: сотрудник в двух сменах одновременно, неактивен, пищевая роль без действующего допуска (только статус допуска).
 * Нехватка — в «Моей смене» руководителя и в реестре рисков V93 (STAFF_SHORTAGE) на ближайшие дни горизонта.
 * Ничего не начисляется и не публикуется автоматически; ФОТ и табель в MON CHEF не рассчитываются.
 */
var MC_V98_AS_ = 'График_Смен_V98', MC_V98_AS_HEAD_ = ['AssignID', 'Дата', 'ShiftID', 'Смена', 'SiteID', 'EmployeeID', 'Сотрудник', 'Роль', 'Начало', 'Окончание', 'Статус', 'Причина',
  'Назначил', 'Назначено', 'Изменено', 'История (JSON)'];
var MC_V98_NORM_ = 'Нормы_Персонала_V98', MC_V98_NORM_HEAD_ = ['RuleID', 'SiteID', 'ShiftID', 'Роль', 'Минимум', 'Основание', 'Статус', 'Изменил', 'Изменено'];
var MC_V98_ST_RU_ = { PLANNED: 'в графике', ABSENT: 'отсутствует', CANCELLED: 'снят' };
var MC_V98_WHY_ = { VACATION: 'отпуск', DAYOFF: 'отгул', EXCUSED: 'отсутствует по уважительной причине', UNEXCUSED: 'не вышел без причины', OTHER: 'другое' };
var MC_V98_KITCHEN_ = ['Шеф-повар', 'Су-шеф', 'Повар', 'Повар горячего цеха', 'Повар холодного цеха', 'Кондитер'];

(function () {
  try { MC_RB_MODULES_.staffplan = '*'; MC_RB_MODULE_RU_.staffplan = 'График смен'; } catch (e) {}
  try { if (MC_UI_VIEWS_.indexOf('staffplan') < 0) MC_UI_VIEWS_ = MC_UI_VIEWS_.concat(['staffplan']); } catch (e) {}
  try { var o = _mcViewOfParams_; _mcViewOfParams_ = function (params) { if (params && (params.staffplan === '1' || params.schedule === '1')) return 'staffplan'; return o.apply(this, arguments); }; } catch (e) {}
  try {
    var sec = function (k, btn) { var orig = _UI_BUILDERS_[k]; if (typeof orig !== 'function') return; _UI_BUILDERS_[k] = function (token, opts, s) { var r = orig(token, opts, s) || {}; r.actions = (r.actions || []).concat([btn]); return r; }; };
    sec('home', { label: 'График смен', module: 'staffplan' });
    sec('settings', { label: 'График смен и нормы персонала', module: 'staffplan' });
  } catch (e) {}
})();

function _v98Can_(s) { return { plan: !!s && !s.dev && _mcRbHasExact_(s, 'task_assign|personnel|grants'), norm: !!s && !s.dev && _mcRbHasExact_(s, 'personnel|grants|org_edit'), all: _mcRbHasExact_(s, 'task_assign|personnel|grants|org_edit') }; }
function _v98Min_(hm) { var m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || '')); return m ? +m[1] * 60 + +m[2] : null; }
function _v98Hm_(x) { if (x instanceof Date) return Utilities.formatDate(x, _mcTz_(), 'HH:mm'); var m = /^(\d{1,2}):(\d{2})/.exec(String(x || '')); return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : ''; }
/** Интервал в минутах; окончание раньше начала — смена через полночь. */
function _v98Span_(st, en) { var a = _v98Min_(st), b = _v98Min_(en); if (a === null) return null; if (b === null) b = 1440; if (b <= a) b += 1440; return [a, b]; }
function _v98Over_(x, y) { return x && y && x[0] < y[1] && y[0] < x[1]; }
function _v98Emps_() { var st = _mcRbEmpState_(), out = {}; Object.keys(st).forEach(function (id) { var e = st[id]; if (e && !e.hidden) out[id] = { id: id, name: e.name, role: e.role, position: e.position, active: e.active !== false }; }); return out; }
function _v98SiteOf_(loc) { try { var S = _v97Sites_(); if (S.some(function (x) { return x.id === String(loc || ''); })) return String(loc); } catch (e) {} return 'SITE-MAIN'; }
function _v98SiteName_(id) { try { var x = _v97Sites_().filter(function (s) { return s.id === id; })[0]; return x ? x.name : id; } catch (e) { return id; } }
/** Смены на дату (расписание V89): разовая (Дата) важнее шаблона по дням недели. */
function _v98ShiftsOn_(day, SH) {
  var wd = _v93Wd_(day);
  return (SH || _v89Shifts_()).filter(function (s) { return s.active && s.start && (s.date ? s.date === day : (!s.days.length || s.days.indexOf(wd) >= 0)); })
    .map(function (s) { return { id: s.id, name: s.name || s.id, site: _v98SiteOf_(s.loc), start: s.start, end: s.end || '', span: _v98Span_(s.start, s.end) }; });
}
function _v98Assigns_() {
  return _v92Rows_(MC_V98_AS_).map(function (r) { return { row: r._row, raw: r, id: String(r.AssignID), day: _v93Iso_(r['Дата']), shiftId: String(r.ShiftID || ''), shift: String(r['Смена'] || ''), site: String(r.SiteID || 'SITE-MAIN'),
    emp: String(r.EmployeeID || ''), name: String(r['Сотрудник'] || ''), role: String(r['Роль'] || ''), start: _v98Hm_(r['Начало']), end: _v98Hm_(r['Окончание']), status: String(r['Статус'] || 'PLANNED'), reason: String(r['Причина'] || '') }; });
}
function _v98Norms_() { return _v92Rows_(MC_V98_NORM_).filter(function (r) { return String(r['Статус'] || 'ACTIVE') === 'ACTIVE'; }).map(function (r) { return { id: String(r.RuleID), site: String(r.SiteID || 'SITE-MAIN'), shift: String(r.ShiftID || ''), role: String(r['Роль']), min: Number(r['Минимум']) || 0, basis: String(r['Основание'] || '') }; }); }
/** Почасовой спрос площадки по тому же дню недели: {hour: среднее порций} и число наблюдений. */
function _v98Demand_(day, site, S, cfg) {
  var wd = _v93Wd_(day), today = _v71Day_(new Date()), lo = _v89AddDays_(today, -7 * cfg.weeks), open = {};
  S.rows.forEach(function (r) { if (r.ch === 'hall' && (r.site || 'SITE-MAIN') === site && r.day < today && r.day >= lo && _v93Wd_(r.day) === wd) open[r.day] = 1; });
  var obs = Object.keys(open), h = {};
  S.rows.forEach(function (r) { if (!open[r.day] || r.ch !== 'hall' || (r.site || 'SITE-MAIN') !== site || r.min === null) return; var x = Math.floor(r.min / 60); h[x] = (h[x] || 0) + r.qty; });
  Object.keys(h).forEach(function (x) { h[x] = h[x] / Math.max(1, obs.length); });
  return { hours: h, n: obs.length };
}
/** Покрытие смен с даты на N дней: кто в графике, нормы по ролям, потребность поваров по прогнозу, предупреждения. */
function _v98Cover_(from, days) {
  var SH = _v89Shifts_(), A = _v98Assigns_(), N = _v98Norms_(), E = _v98Emps_(), cfg = _v93Cfg_(), S = null, out = [];
  try { S = _v93Sales_(); } catch (e) {}
  for (var k = 0; k < days; k++) {
    var day = _v89AddDays_(from, k), mine = A.filter(function (a) { return a.day === day && a.status === 'PLANNED'; });
    _v98ShiftsOn_(day, SH).forEach(function (sh) {
      var on = mine.filter(function (a) { return a.site === sh.site && (a.shiftId ? a.shiftId === sh.id : _v98Over_(_v98Span_(a.start, a.end), sh.span)); });
      var absent = A.filter(function (a) { return a.day === day && a.shiftId === sh.id && a.status === 'ABSENT'; });
      var by = {}; on.forEach(function (a) { by[a.role] = (by[a.role] || 0) + 1; });
      var norms = N.filter(function (n) { return n.site === sh.site && (!n.shift || n.shift === sh.id); }), seen = {};
      var nr = norms.filter(function (n) { var k2 = n.role; if (seen[k2] && !n.shift) return false; seen[k2] = 1; return true; }).map(function (n) { var have = by[n.role] || 0; return { role: n.role, min: n.min, have: have, short: Math.max(0, n.min - have), basis: n.basis }; });
      var fc = { status: 'NO_NORM', why: 'норма выработки (порций в час на сотрудника) не задана — «Прогнозы → Правила»' };
      if (cfg.staffNorm && S) {
        var dm = _v98Demand_(day, sh.site, S, cfg);
        if (dm.n < cfg.minObs) fc = { status: 'INSUFFICIENT_DATA', why: 'наблюдений по этому дню недели — ' + dm.n + ', нужно не меньше ' + cfg.minObs };
        else {
          var peak = 0, ph = null; for (var m = sh.span[0]; m < sh.span[1]; m += 60) { var hh = Math.floor((m % 1440) / 60); if ((dm.hours[hh] || 0) > peak) { peak = dm.hours[hh]; ph = hh; } }
          var need = Math.ceil(peak / cfg.staffNorm - 1e-9), have = on.filter(function (a) { return MC_V98_KITCHEN_.indexOf(a.role) >= 0; }).length;
          fc = { status: 'OK', peak: _v93R_(peak, 1), peakHour: ph === null ? '' : ('0' + ph).slice(-2) + ':00', norm: cfg.staffNorm, need: need, have: have, short: Math.max(0, need - have), n: dm.n,
            why: 'пик ' + _v93R_(peak, 1) + ' порц./ч' + (ph === null ? '' : ' в ' + ('0' + ph).slice(-2) + ':00') + ' (среднее по ' + dm.n + ' таким же дням) / норма ' + cfg.staffNorm + ' порц./ч' };
        }
      }
      var warn = [];
      on.forEach(function (a) {
        var e = E[a.emp]; if (!e || !e.active) warn.push(a.name + ': сотрудник неактивен или удалён из штата');
        var dup = A.filter(function (b) { return b.id !== a.id && b.emp === a.emp && b.day === day && b.status === 'PLANNED' && _v98Over_(_v98Span_(b.start, b.end), _v98Span_(a.start, a.end)); });
        if (dup.length) warn.push(a.name + ': в это же время в другой смене (' + dup.map(function (b) { return b.shift || b.start + '–' + b.end; }).join(', ') + ')');
        if (typeof MC_FOOD_ROLES_ !== 'undefined' && MC_FOOD_ROLES_.indexOf(a.role) >= 0) { try { _MC_ADM_CACHE = null; var ad = _mcAdmissionByName_(a.name); if (ad && ad.status !== 'ADMITTED') warn.push(a.name + ': нет действующего допуска к работе с продукцией'); } catch (e) {} }
      });
      var shortRoles = nr.filter(function (x) { return x.short > 0; });
      out.push({ day: day, shiftId: sh.id, shift: sh.name, site: sh.site, siteName: _v98SiteName_(sh.site), start: sh.start, end: sh.end, on: on.map(function (a) { return { id: a.id, emp: a.emp, name: a.name, role: a.role, start: a.start, end: a.end }; }),
        absent: absent.map(function (a) { return { id: a.id, name: a.name, role: a.role, reason: a.reason }; }), norms: nr, fc: fc, warnings: warn,
        shortage: shortRoles.length > 0 || (fc.status === 'OK' && fc.short > 0), shortText: shortRoles.map(function (x) { return x.role + ' ' + x.have + ' из ' + x.min; }).concat(fc.status === 'OK' && fc.short > 0 ? ['повара по прогнозу ' + fc.have + ' из ' + fc.need] : []).join('; ') });
    });
  }
  return out;
}

/** Экран: {from?, days?}. Руководитель — весь график; сотрудник — свои смены. */
function v98Data(json, token) {
  var s; try { s = _requireAuth_(token); } catch (e) { return _failFrom_(e); }
  try {
    var d = (function () { try { return _mcBlJson_(json) || {}; } catch (e) { return {}; } })(), today = _v71Day_(new Date()), from = /^\d{4}-\d{2}-\d{2}$/.test(String(d.from || '')) ? d.from : today, days = Math.min(14, Math.max(1, Number(d.days) || 7));
    var can = _v98Can_(s), E = _v98Emps_(), SH = _v89Shifts_().filter(function (x) { return x.active; });
    var my = _v98Assigns_().filter(function (a) { return a.emp === String(s.user_id || '') && a.day >= today && a.status !== 'CANCELLED'; }).sort(function (a, b) { return (a.day + a.start).localeCompare(b.day + b.start); })
      .map(function (a) { return { day: a.day, shift: a.shift, site: _v98SiteName_(a.site), start: a.start, end: a.end, status: a.status, statusRu: MC_V98_ST_RU_[a.status] }; });
    var out = { can: can, from: from, days: days, today: today, my: my, shifts: SH.map(function (x) { return { id: x.id, name: x.name || x.id, start: x.start, end: x.end, site: _v98SiteOf_(x.loc), days: x.days, date: x.date }; }), why: MC_V98_WHY_ };
    if (!SH.length) out.note = 'Смены не заведены: «Сменные письма → Расписание смен» (название, дни недели, начало и окончание).';
    if (can.all) {
      out.cover = _v98Cover_(from, days);
      out.employees = Object.keys(E).map(function (k) { return E[k]; }).filter(function (e) { return e.active; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); });
      out.norms = _v98Norms_().map(function (n) { n.siteName = _v98SiteName_(n.site); n.shiftName = n.shift ? ((SH.filter(function (x) { return x.id === n.shift; })[0] || {}).name || n.shift) : 'все смены'; return n; });
      out.sites = (function () { try { return _v97Sites_().filter(function (x) { return x.active; }).map(function (x) { return { id: x.id, name: x.name }; }); } catch (e) { return [{ id: 'SITE-MAIN', name: 'Основная площадка' }]; } })();
      out.roles = MC_RB_ROLES_.slice();
      out.staffNorm = _v93Cfg_().staffNorm;
    }
    return _ok_(out);
  } catch (e) { return _failFrom_(e); }
}
function _v98Fail_(op, c, m) { _endOp_(op, 'FAILED'); return _fail_(c, m, op.id); }
/** Поставить в график: {date, shiftId | start+end (+siteId), employeeId, confirm}. */
function v98Assign(json, token) {
  var op = null; try { op = _beginOp_(token, 'task_assign|personnel|grants', 'V98_ASSIGN', 'График смен', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {}, day = String(d.date || ''), today = _v71Day_(new Date());
    if (op.session.dev) return _v98Fail_(op, 'FORBIDDEN', 'Технический доступ график не меняет');
    if (d.confirm !== true) return _v98Fail_(op, 'VALIDATION', 'Подтвердите галочкой');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return _v98Fail_(op, 'VALIDATION', 'Дата смены — ГГГГ-ММ-ДД');
    if (day < today) return _v98Fail_(op, 'VALIDATION', 'Прошедшую дату в график не ставят');
    return _withLock_(function () {
      try { _mcRbDrop_(); } catch (er) {}   // новый сотрудник виден сразу (кэш штата — 60 с)
      var E = _v98Emps_(), e = E[String(d.employeeId || '')];
      if (!e || !e.active) return _v98Fail_(op, 'VALIDATION', 'Выберите действующего сотрудника');
      var sh = d.shiftId ? _v98ShiftsOn_(day).filter(function (x) { return x.id === String(d.shiftId); })[0] : null, st, en, site;
      if (d.shiftId && !sh) return _v98Fail_(op, 'VALIDATION', 'Смены нет в расписании на эту дату');
      if (sh) { st = sh.start; en = sh.end; site = sh.site; }
      else { st = _v98Hm_(d.start); en = _v98Hm_(d.end); site = _v98SiteOf_(d.siteId); if (!st || !en) return _v98Fail_(op, 'VALIDATION', 'Выберите смену или укажите начало и окончание (ЧЧ:ММ)'); }
      var span = _v98Span_(st, en), A = _v98Assigns_(), dup = A.filter(function (a) { return a.emp === e.id && a.day === day && a.status === 'PLANNED' && _v98Over_(_v98Span_(a.start, a.end), span); });
      if (dup.length) return _v98Fail_(op, 'CONFLICT', e.name + ' уже в графике ' + _v93Dmy_(day) + ' ' + dup[0].start + '–' + (dup[0].end || '…') + (dup[0].shift ? ' («' + dup[0].shift + '»)' : ''));
      var warn = [];
      if (typeof MC_FOOD_ROLES_ !== 'undefined' && MC_FOOD_ROLES_.indexOf(e.role) >= 0) { try { _MC_ADM_CACHE = null; var ad = _mcAdmissionByName_(e.name); if (ad && ad.status !== 'ADMITTED') warn.push('нет действующего допуска к работе с продукцией — до смены оформите медосмотр'); } catch (er) {} }
      var who = _author_(op).фио, id = 'SA-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
      _v93Write_(MC_V98_AS_, MC_V98_AS_HEAD_, { AssignID: id, 'Дата': day, ShiftID: sh ? sh.id : '', 'Смена': sh ? sh.name : '', SiteID: site, EmployeeID: e.id, 'Сотрудник': e.name, 'Роль': e.role, 'Начало': st, 'Окончание': en,
        'Статус': 'PLANNED', 'Назначил': who, 'Назначено': new Date(), 'Изменено': new Date(), 'История (JSON)': JSON.stringify([{ at: new Date().toISOString(), who: who, what: 'в графике' }]) });
      _audit_(op, 'V98_ASSIGN', MC_V98_AS_, id, null, { дата: day, смена: sh ? sh.name : st + '–' + en, сотрудник: e.name, роль: e.role });
      _endOp_(op); return _ok_({ id: id, day: day, shift: sh ? sh.name : '', start: st, end: en, name: e.name, role: e.role, warnings: warn }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Отсутствие / снять / вернуть: {id, status: 'ABSENT'|'CANCELLED'|'PLANNED', why?: код причины, comment?, confirm}. */
function v98SetStatus(json, token) {
  var op = null; try { op = _beginOp_(token, 'task_assign|personnel|grants', 'V98_STATUS', 'График смен', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {}, st = String(d.status || '');
    if (op.session.dev) return _v98Fail_(op, 'FORBIDDEN', 'Технический доступ график не меняет');
    if (d.confirm !== true) return _v98Fail_(op, 'VALIDATION', 'Подтвердите галочкой');
    if (!MC_V98_ST_RU_[st]) return _v98Fail_(op, 'VALIDATION', 'Статус: в графике, отсутствует, снят');
    if (st === 'ABSENT' && !MC_V98_WHY_[d.why]) return _v98Fail_(op, 'VALIDATION', 'Причина отсутствия: ' + Object.keys(MC_V98_WHY_).map(function (k) { return MC_V98_WHY_[k]; }).join(', '));
    return _withLock_(function () {
      var a = _v98Assigns_().filter(function (x) { return x.id === String(d.id || ''); })[0]; if (!a) return _v98Fail_(op, 'NOT_FOUND', 'Запись графика не найдена');
      if (a.day < _v71Day_(new Date()) && st !== 'ABSENT') return _v98Fail_(op, 'VALIDATION', 'Прошедшую смену можно только отметить отсутствием');
      if (st === 'PLANNED') { var dup = _v98Assigns_().filter(function (b) { return b.id !== a.id && b.emp === a.emp && b.day === a.day && b.status === 'PLANNED' && _v98Over_(_v98Span_(b.start, b.end), _v98Span_(a.start, a.end)); }); if (dup.length) return _v98Fail_(op, 'CONFLICT', a.name + ' уже в другой смене в это время'); }
      var r = a.raw, who = _author_(op).фио, why = st === 'ABSENT' ? MC_V98_WHY_[d.why] + (d.comment ? ': ' + String(d.comment).slice(0, 120) : '') : String(d.comment || '').slice(0, 120), h = [];
      try { h = JSON.parse(String(r['История (JSON)'] || '[]')); } catch (e) {}
      h.push({ at: new Date().toISOString(), who: who, what: MC_V98_ST_RU_[st] + (why ? ' — ' + why : '') });
      r['Статус'] = st; r['Причина'] = why; r['Изменено'] = new Date(); r['История (JSON)'] = JSON.stringify(h.slice(-20));
      _v93Write_(MC_V98_AS_, MC_V98_AS_HEAD_, r);
      _audit_(op, 'V98_STATUS', MC_V98_AS_, a.id, { статус: a.status }, { статус: st, причина: why });
      _endOp_(op); return _ok_({ id: a.id, status: st, statusRu: MC_V98_ST_RU_[st], reason: why }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Повторить неделю: {from: дата недели-образца (любой день), to: дата целевой недели, confirm}. Конфликты пропускаются и перечисляются. */
function v98CopyWeek(json, token) {
  var op = null; try { op = _beginOp_(token, 'task_assign|personnel|grants', 'V98_COPY_WEEK', 'График смен', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {}, mon = function (x) { return _v89AddDays_(x, -(_v93Wd_(x) - 1)); };
    if (op.session.dev) return _v98Fail_(op, 'FORBIDDEN', 'Технический доступ график не меняет');
    if (d.confirm !== true) return _v98Fail_(op, 'VALIDATION', 'Подтвердите галочкой');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.from || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(d.to || ''))) return _v98Fail_(op, 'VALIDATION', 'Укажите неделю-образец и целевую неделю');
    var f0 = mon(d.from), t0 = mon(d.to), shift = Math.round((Date.parse(t0) - Date.parse(f0)) / 864e5);
    if (!shift) return _v98Fail_(op, 'VALIDATION', 'Недели совпадают');
    return _withLock_(function () {
      var A = _v98Assigns_(), E = _v98Emps_(), today = _v71Day_(new Date()), who = _author_(op).фио, made = [], skip = [], rows = [];
      A.filter(function (a) { return a.status === 'PLANNED' && a.day >= f0 && a.day <= _v89AddDays_(f0, 6); }).forEach(function (a) {
        var nd = _v89AddDays_(a.day, shift), e = E[a.emp];
        if (nd < today) return skip.push(a.name + ' ' + _v93Dmy_(nd) + ': дата прошла');
        if (!e || !e.active) return skip.push(a.name + ': сотрудник неактивен');
        if (a.shiftId && !_v98ShiftsOn_(nd).some(function (x) { return x.id === a.shiftId; })) return skip.push(a.name + ' ' + _v93Dmy_(nd) + ': смены «' + a.shift + '» в этот день нет');
        var sp = _v98Span_(a.start, a.end);
        if (A.concat(rows).some(function (b) { return b.emp === a.emp && b.day === nd && b.status === 'PLANNED' && _v98Over_(_v98Span_(b.start, b.end), sp); })) return skip.push(a.name + ' ' + _v93Dmy_(nd) + ': уже в графике');
        var id = 'SA-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
        rows.push({ emp: a.emp, day: nd, status: 'PLANNED', start: a.start, end: a.end });
        _v93Write_(MC_V98_AS_, MC_V98_AS_HEAD_, { AssignID: id, 'Дата': nd, ShiftID: a.shiftId, 'Смена': a.shift, SiteID: a.site, EmployeeID: a.emp, 'Сотрудник': e.name, 'Роль': e.role, 'Начало': a.start, 'Окончание': a.end,
          'Статус': 'PLANNED', 'Назначил': who, 'Назначено': new Date(), 'Изменено': new Date(), 'История (JSON)': JSON.stringify([{ at: new Date().toISOString(), who: who, what: 'скопировано из недели ' + _v93Dmy_(f0) }]) });
        made.push(id);
      });
      _audit_(op, 'V98_COPY_WEEK', MC_V98_AS_, '', null, { из: f0, в: t0, создано: made.length, пропущено: skip });
      _endOp_(op); return _ok_({ created: made.length, skipped: skip }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Норма персонала: {id?, siteId, shiftId ('' — все смены), role, min, basis, status?, confirm}. */
function v98SaveNorm(json, token) {
  var op = null; try { op = _beginOp_(token, 'personnel|grants|org_edit', 'V98_NORM', 'График смен', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {}, min = Number(d.min), basis = String(d.basis || '').replace(/\s+/g, ' ').trim(), role = String(d.role || '');
    if (op.session.dev) return _v98Fail_(op, 'FORBIDDEN', 'Технический доступ нормы не меняет');
    if (d.confirm !== true) return _v98Fail_(op, 'VALIDATION', 'Подтвердите галочкой');
    if (MC_RB_ROLES_.indexOf(role) < 0) return _v98Fail_(op, 'VALIDATION', 'Выберите роль');
    if (!(min >= 0) || Math.floor(min) !== min || min > 50) return _v98Fail_(op, 'VALIDATION', 'Минимум — целое число от 0 до 50');
    if (basis.length < 5) return _v98Fail_(op, 'VALIDATION', 'Основание нормы обязательно: штатное расписание, приказ, решение директора (не короче 5 символов)');
    return _withLock_(function () {
      var site = _v98SiteOf_(d.siteId), shiftId = String(d.shiftId || ''), R = _v92Rows_(MC_V98_NORM_), cur = d.id ? R.filter(function (r) { return String(r.RuleID) === String(d.id); })[0] : R.filter(function (r) { return String(r.SiteID) === site && String(r.ShiftID || '') === shiftId && String(r['Роль']) === role && String(r['Статус'] || 'ACTIVE') === 'ACTIVE'; })[0];
      if (shiftId && !_v89Shifts_().some(function (x) { return x.id === shiftId; })) return _v98Fail_(op, 'VALIDATION', 'Смена не найдена в расписании');
      var row = cur || { RuleID: 'SN-' + Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase() };
      row.SiteID = site; row.ShiftID = shiftId; row['Роль'] = role; row['Минимум'] = min; row['Основание'] = basis.slice(0, 200); row['Статус'] = d.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE'; row['Изменил'] = _author_(op).фио; row['Изменено'] = new Date();
      _v93Write_(MC_V98_NORM_, MC_V98_NORM_HEAD_, row);
      _audit_(op, 'V98_NORM', MC_V98_NORM_, row.RuleID, cur ? { минимум: cur['Минимум'] } : null, { площадка: site, смена: shiftId || 'все', роль: role, минимум: min, основание: basis });
      _endOp_(op); return _ok_({ id: row.RuleID, role: role, min: min }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- V93: нехватка по графику в реестре рисков и в потребности по часам ---------------- */
/** Риски нехватки на горизонт: смены с нехваткой (по норме или по прогнозу). null — графика нет. */
function _v98Risks_(day, cfg) {
  if (!_book_().getSheetByName(MC_V98_AS_) && !_book_().getSheetByName(MC_V98_NORM_)) return null;
  var C = _v98Cover_(day, Math.max(1, (cfg && cfg.horizonDays) || 3)), out = [], nowMs = Date.now();
  C.forEach(function (c) {
    if (!c.shortage) return;
    var startMs = Date.parse(c.day + 'T' + (c.start || '00:00') + ':00'), h = isNaN(startMs) ? 24 : Math.max(0, (startMs - nowMs) / 36e5);
    out.push({ type: 'STAFF_SHORTAGE', objectType: 'SHIFT', objectId: _v93Dmy_(c.day) + ' «' + c.shift + '» (' + c.siteName + ')', expected: c.day, P: 1, pWhy: 'по графику смен: ' + c.shortText, I: 3, iWhy: 'смена без нужного числа сотрудников',
      E: typeof _v93Expo_ === 'function' ? _v93Expo_(h) : 1, eWhy: h < 1 ? 'смена идёт или начнётся в течение часа' : 'до начала смены ≈ ' + Math.round(h) + ' ч',
      desc: 'Нехватка персонала ' + _v93Dmy_(c.day) + ', смена «' + c.shift + '» ' + c.start + '–' + (c.end || '…') + ': ' + c.shortText + (c.fc.status === 'OK' ? ' (' + c.fc.why + ')' : ''),
      action: 'Поставить сотрудников в график («График смен») или перенести задачи смены', money: null, conf: 'HIGH' });
  });
  return out;
}
(function () {
  if (typeof _v93Forecast_ !== 'function') return;
  var orig = _v93Forecast_;
  _v93Forecast_ = function () {
    var F = orig.apply(this, arguments);
    try {
      if (!_book_().getSheetByName(MC_V98_AS_)) return F;
      var A = _v98Assigns_().filter(function (a) { return a.day === F.day && a.status === 'PLANNED' && MC_V98_KITCHEN_.indexOf(a.role) >= 0; });
      if (F.staff && F.staff.status === 'OK') F.staff.rows.forEach(function (r) {
        var hm = _v98Min_(r.hour), n = A.filter(function (a) { var sp = _v98Span_(a.start, a.end); return sp && ((hm >= sp[0] && hm < sp[1]) || (hm + 1440 >= sp[0] && hm + 1440 < sp[1])); }).length;
        r.scheduled = n; r.short = Math.max(0, r.staff - n);
      });
      else if (F.staff && F.staff.missing) F.staff.missing = F.staff.missing.filter(function (m) { return !/график смен/.test(m); });
      if (F.staff) F.staff.scheduleNote = 'в графике смен на сегодня — поваров и кондитеров: ' + A.length;
    } catch (e) {}
    return F;
  };
})();

/* ---------------- «Моя смена» ---------------- */
try {
  MC_V87_SOURCES_.push(function (ctx) {
    var s = ctx.s; if (!s || s.dev || !_book_().getSheetByName(MC_V98_AS_)) return [];
    var out = [], today = _v71Day_(new Date());
    if (_mcRbHasExact_(s, 'task_assign|personnel|grants')) _v98Cover_(today, 2).forEach(function (c) {
      if (!c.shortage) return;
      out.push({ key: 'V98|short|' + c.day + '|' + c.shiftId, group: c.day === today ? 'now' : 'later', source: 'График смен', title: 'Нехватка персонала: ' + (c.day === today ? 'сегодня' : 'завтра') + ' «' + c.shift + '» — ' + c.shortText,
        detail: c.siteName + ', ' + c.start + '–' + (c.end || '…') + '. В графике: ' + (c.on.map(function (a) { return a.name + ' (' + a.role + ')'; }).join(', ') || 'никого') + (c.absent.length ? '; отсутствуют: ' + c.absent.map(function (a) { return a.name; }).join(', ') : ''),
        act: _v87ModOk_(s, 'staffplan') ? { kind: 'open', module: 'staffplan', label: 'График смен' } : null });
    });
    var mine = _v98Assigns_().filter(function (a) { return a.emp === String(s.user_id || '') && a.day === today && a.status === 'PLANNED'; });
    mine.forEach(function (a) { out.push({ key: 'V98|my|' + a.id, group: 'later', source: 'График смен', title: 'Ваша смена сегодня: ' + a.start + '–' + (a.end || '…') + (a.shift ? ' («' + a.shift + '»)' : ''), detail: _v98SiteName_(a.site), act: null }); });
    return out;
  });
} catch (e) {}
