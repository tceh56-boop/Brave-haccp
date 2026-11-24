/**
 * MonChef V81 — журналы из уже внесённых данных, без двойного ввода (17.11.2026).
 *
 *  1. Обучение → инструктажи: «Санминимум», «Гигиеническое обучение» → J16; «Инструктаж ХАССП», «по охране труда» → J17.
 *  2. Неисправности → J18: «Прибор неисправен» (средства измерения) и ЧС с указанным оборудованием заводят строку J18;
 *     закрытие оценки или ЧС дописывает принятые меры и результат.
 *  3. Просроченное на складе → кнопка на главном экране и «Добавить просроченное в акт» на экране «Списание по акту».
 *  4. Фритюр (J38): «Залил масло» и «Закончил / заменил» — одна строка на цикл; вид жира и оборудование — как в прошлый раз;
 *     оценку жира и килограммы вводит человек. Время в работе показывается, предел не подставляется (нормы в комплекте нет).
 *  5. Осмотр персонала (J07): сотрудник при входе в смену отмечает «здоров, жалоб нет» (или жалобы); ответственный
 *     осматривает и подтверждает допуск списком — строки J07.
 * Подписи — от руки на распечатке, как в остальных журналах.
 */
var MC_V81_DAY_ = function (d) { return Utilities.formatDate(d || new Date(), _mcTz_(), 'dd.MM.yyyy'); };
var MC_V81_HM_ = function (d) { return Utilities.formatDate(d || new Date(), _mcTz_(), 'HH:mm'); };

/** Строка журнала по названиям колонок; вернёт номер строки листа. */
function _v81Append_(jid, obj, who, source) {
  var j = _mcJById_(jid), sh = _book_().getSheetByName(j.sheetName) || _createJournalSheet_(j);
  var row = j.columns.map(function (c) { return c === '№' ? Math.max(0, sh.getLastRow() - 1) + 1 : (obj[c] === undefined ? '' : obj[c]); });
  _mcJournalAppendTo_(sh, who, source, row);
  try { if (typeof _mcMirrorRow_ === 'function') _mcMirrorRow_(jid, sh.getLastRow()); } catch (e) {}
  return sh.getLastRow();
}
/** Найти строку журнала по ID операции в «Источнике записи» и записать значения. */
function _v81Patch_(jid, col, mark, obj) {
  // V86 (аудит R2, P1.2): строка ищется по точному ID в «Источнике записи» («… · ID»), а не по подстроке в любой ячейке —
  // тот же текст в описании или в другой записи не приводит к правке чужой строки.
  var j = _mcJById_(jid), sh = _book_().getSheetByName(j.sheetName); if (!sh || sh.getLastRow() < 2 || !mark) return 0;
  var v = sh.getDataRange().getValues(), si = v[0].indexOf('Источник записи'), id = String(mark).trim(); if (si < 0 || !id) return 0;
  for (var i = v.length - 1; i >= 1; i--) {
    var p = String(v[i][si] || '').split(' · ');
    if (p.length > 1 && p[p.length - 1].trim() === id) {
      Object.keys(obj).forEach(function (k) { var ci = j.columns.indexOf(k); if (ci >= 0) sh.getRange(i + 1, ci + 1).setValue(obj[k]); });
      try { if (typeof _mcMirrorRow_ === 'function') _mcMirrorRow_(jid, i + 1); } catch (e) {}
      return i + 1;
    }
  }
  return 0;
}

/* ---------------- 1. обучение → J16 / J17 ---------------- */
function _v81TrainingJournal_(d, token) {
  var kind = String(d.вид || ''), dt = d.дата ? _parseDate_(d.дата) : new Date(); if (!dt) dt = new Date();
  var who = _author_(token).фио, day = MC_V81_DAY_(dt), jid = '', obj = null, keys = null;
  if (/санминимум|гигиен/i.test(kind)) { jid = 'J16'; keys = ['Дата', 'ФИО сотрудника', 'Тема инструктажа'];
    obj = { 'Дата': day, 'ФИО сотрудника': d.сотрудник, 'Должность': d.должность || '', 'Тема инструктажа': (d.тема ? kind + ': ' + d.тема : kind), 'ФИО инструктирующего': d.ктоПровёл || who }; }
  else if (/хассп|охран|безопасн/i.test(kind)) { jid = 'J17'; keys = ['Дата', 'ФИО', 'Тема (ХАССП/ТБ)', 'Содержание'];
    obj = { 'Дата': day, 'ФИО': d.сотрудник, 'Должность': d.должность || '', 'Тема (ХАССП/ТБ)': kind, 'Содержание': d.тема || '' }; }
  else return null;
  // V86 (аудит R2, P1.1): повтор той же записи (дата, сотрудник, тема) возвращает уже записанную строку, второй не появляется
  var ex = _v86JournalFind_(jid, obj, keys);
  if (ex) return { j: jid, row: ex, idempotent: true };
  return { j: jid, row: _v81Append_(jid, obj, token, 'из «Обучения»') };
}
try {
  var _v81o_tr_ = addTraining;
  addTraining = function (json, token) {
    var d = {}; try { d = JSON.parse(json || '{}'); } catch (e) {}
    return _withLock_(function () {
      // V86 (аудит R2, P1.1): повторная отправка той же записи об обучении (сотрудник, вид, тема, дата) — после тайм-аута или
      // двойного нажатия — не создаёт вторую запись и вторую строку журнала: возвращается исходная (idempotent: true).
      var dup = '', s0 = null; try { s0 = _getSession_(token); if (s0 && !s0.dev && _mcRbHasExact_(s0, 'personnel')) dup = _v86TrainingDup_(d); } catch (e) {}
      if (dup) { var jr0 = null; try { jr0 = _v81TrainingJournal_(d, token); } catch (e) {}
        return _ok_({ id: dup, idempotent: true, journal: jr0 ? jr0.j : '', message: 'Эта запись об обучении уже внесена — повтор не создал дубль' }); }
      var r = _v81o_tr_(json, token);
      try { var x = typeof r === 'string' ? JSON.parse(r) : r; if (x && (x.ok || x.success)) { var jr = _v81TrainingJournal_(d, token); if (jr && x.data) { x.data.journal = jr.j; return typeof r === 'string' ? JSON.stringify(x) : x; } } } catch (e) { try { _log_('WARN', 'обучение → журнал инструктажей: ' + e); } catch (e2) {} }
      return r;
    });
  };
} catch (e) {}

/* ---------------- 2. неисправности → J18 ---------------- */
try {
  var _v81o_fault_ = v76ReportFault;
  v76ReportFault = function (json, token) {
    var r = _v81o_fault_(json, token);
    try {
      var x = typeof r === 'string' ? JSON.parse(r) : r, d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
      if (x && (x.ok || x.success) && x.data) { var e = _v76Eq_(d.equipmentId) || {}, at = d.detectedAt ? _v76Date_(d.detectedAt) : new Date();
        _v81Append_('J18', { 'Дата': MC_V81_DAY_(at), 'Время': MC_V81_HM_(at), 'Оборудование': (e.name || d.equipmentId) + (e.serial ? ' № ' + e.serial : ''), 'Описание неисправности': String(d.what || ''),
          'Принятые меры': 'прибор заблокирован, оценка измерений ' + x.data.evalId, 'Результат': 'оценка открыта' }, token, 'из «Средств измерения» · ' + x.data.evalId); }
    } catch (e2) { try { _log_('WARN', 'неисправность → J18: ' + e2); } catch (e3) {} }
    return r;
  };
} catch (e) {}
try {
  var _v81o_ceval_ = v76CloseEval;
  v76CloseEval = function (json, token) {
    var r = _v81o_ceval_(json, token);
    try {
      var x = typeof r === 'string' ? JSON.parse(r) : r, d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
      if (x && (x.ok || x.success)) { var ea = _v76Ref_(MC_V76_EQACT_, String(d.equipmentAction || '')); _v81Patch_('J18', 'Принятые меры', String(d.id), { 'Результат': (ea ? (ea[1] || ea.label || ea) : d.equipmentAction) + ' · оценка закрыта ' + MC_V81_DAY_() }); }
    } catch (e2) {}
    return r;
  };
} catch (e) {}
try {
  var _v81o_inc_ = v76OpenIncident;
  v76OpenIncident = function (json, token) {
    var r = _v81o_inc_(json, token);
    try {
      var x = typeof r === 'string' ? JSON.parse(r) : r, d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
      var eq = String(d.equipment || '').trim(), id = x && x.data && x.data.id, num = x && x.data && (x.data.num || x.data.id);
      if (x && (x.ok || x.success) && eq && id) _v81Append_('J18', { 'Дата': MC_V81_DAY_(), 'Время': MC_V81_HM_(), 'Оборудование': eq, 'Описание неисправности': String(d.description || ''),
        'Принятые меры': num + ': действия по процедуре ЧС', 'Результат': 'ЧС открыта' }, token, 'из «ЧС и аварий» · ' + id);
    } catch (e2) {}
    return r;
  };
} catch (e) {}
try {
  var _v81o_cinc_ = v76CloseIncident;
  v76CloseIncident = function (json, token) {
    var r = _v81o_cinc_(json, token);
    try {
      var x = typeof r === 'string' ? JSON.parse(r) : r, d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
      if (x && (x.ok || x.success) && d.id) _v81Patch_('J18', 'Принятые меры', String(d.id), { 'Принятые меры': String(d.actions || '').slice(0, 300), 'Результат': 'ЧС закрыта ' + MC_V81_DAY_() });
    } catch (e2) {}
    return r;
  };
} catch (e) {}

/* ---------------- 3. просроченное → акт списания (кнопка) ---------------- */
function _v81ExpiredCount_() {
  try { var m = {}; _woBatches_().forEach(function (b) { if (b.expired && b.q > 0) m[b.k] = true; }); return Object.keys(m).length; } catch (e) { return 0; }
}

/* ---------------- 4. фритюр (J38) ---------------- */
var MC_V81_FRY_ = 'Фритюр_Циклы_V81', MC_V81_FRY_HEAD_ = ['CycleID', 'Фритюр', 'Вид жира', 'Начало', 'Оценка на начало', 'Продукция', 'Окончание', 'Оценка по окончании', 'Остаток, кг', 'Утилизировано, кг', 'Статус', 'Начал', 'Закончил', 'Строка J38', 'Примечание',
  // V86 (аудит R2): ключи повтора, выполненные шаги, партия масла со склада, количество, причина окончания, сверка баланса
  'Ключ начала', 'Ключ окончания', 'Шаги', 'Партия масла', 'Залито', 'Ед. залитого', 'Переходящий с прошлого, кг', 'Долито, кг', 'Причина', 'Сверка', 'Сверил'];
/** Причины окончания цикла (V86, аудит R2 P1.3): выбор из списка; «другое» — с пояснением. */
var MC_V86_FRY_REASONS_ = ['окончание работы — жир остаётся во фритюре', 'плановая замена', 'ухудшение органолептики', 'результат теста', 'загрязнение', 'аварийная замена', 'другое'];
var MC_V86_RETRY_MS_ = 2 * 60000;   // повтор без ключа: тот же сотрудник и те же данные в течение 2 минут — тот же цикл
function _v81FrySheet_() {
  var sh = _bcSheet_(MC_V81_FRY_, MC_V81_FRY_HEAD_);
  try { var n = sh.getLastColumn(); if (n < MC_V81_FRY_HEAD_.length) sh.getRange(1, n + 1, 1, MC_V81_FRY_HEAD_.length - n).setValues([MC_V81_FRY_HEAD_.slice(n)]).setFontWeight('bold'); } catch (e) {}
  return sh;
}
function _v81FryRows_() {
  var sh = _book_().getSheetByName(MC_V81_FRY_); if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, MC_V81_FRY_HEAD_.length).getValues().map(function (r, i) { var o = { _row: i + 2 }; MC_V81_FRY_HEAD_.forEach(function (h, j) { o[h] = r[j] === undefined ? '' : r[j]; }); return o; });
}
function _v86FrySet_(row, pairs) {
  var sh = _v81FrySheet_();
  Object.keys(pairs).forEach(function (k) { var ci = MC_V81_FRY_HEAD_.indexOf(k); if (ci >= 0) sh.getRange(row, ci + 1).setValue(pairs[k]); });
}
function _v86FryCycle_(id) { return _v81FryRows_().filter(function (r) { return String(r.CycleID) === String(id); })[0] || null; }
function _v86Num_(x) { var n = parseFloat(String(x === undefined || x === null ? '' : x).replace(',', '.')); return isFinite(n) && n >= 0 ? n : null; }
function _v86R1_(n) { return Math.round(n * 1000) / 1000; }
function _v81FryAllowed_(op) { if (op.session && op.session.dev) return 'Технический доступ записей не делает'; return _mcRbJournalAllowed_(op.session, 'J38') ? '' : 'Журнал фритюрных жиров ведут: ' + _mcRbJournalRoles_('J38').join(', ') + '.'; }
/** Сверку баланса жира подтверждают шеф-повар, су-шеф, ответственный за ХАССП, директор. */
function _v86FryReviewer_(s) {
  if (!s || s.dev) return false;
  var r = _mcRbNormRole_(s.role); return ['S', 'SS', 'X', 'D'].some(function (k) { return MC_RB_J_[k] === r; });
}
/** Масло на складе: действующие партии с остатком, название — растительное масло / фритюрный жир / топлёное (V86, аудит R2 P0.2). */
var MC_V86_OIL_RE_ = /растительн|подсолнечн|рапсов|оливков|пальм|кукурузн|соев|фритюр|жир|топл[её]н/i;
function _v86OilBatches_() {
  var out = [];
  try {
    var v = _stockBatchesSheet_().getDataRange().getValues(), t0 = new Date(); t0 = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate());
    for (var i = 1; i < v.length; i++) {
      var r = v[i]; if (!r[0] || String(r[10] || 'active') !== 'active' || !(parseFloat(r[9]) > 0)) continue;
      if (!MC_V86_OIL_RE_.test(String(r[1] || ''))) continue;
      var ex = _parseDate_(r[5]); if (ex && ex.getTime && ex.getTime() < t0.getTime()) continue;
      var bu = String(r[2] || ''), u = _v86OilUnit_(bu), q = parseFloat(r[9]); if (bu === 'г' || bu === 'мл') q = q / 1000;
      out.push({ id: String(r[0]), name: String(r[1]), unit: u, remain: _v86R1_(q), expiry: ex && ex.getTime ? Utilities.formatDate(ex, _mcTz_(), 'dd.MM.yyyy') : '' });
    }
  } catch (e) {}
  return out;
}
/** Единица ввода «залито»: масса — кг, объём — л (партия может храниться в г / мл), иначе — как в партии. */
function _v86OilUnit_(bu) { bu = String(bu || '').toLowerCase(); return bu === 'г' || bu === 'кг' || bu === '' ? 'кг' : (bu === 'мл' || bu === 'л' ? 'л' : bu); }
function _v86KgOf_(q, unit) { var u = String(unit || '').toLowerCase(); if (!(q > 0)) return null; if (u === 'кг' || u === '') return q; if (u === 'г') return q / 1000; return null; }
function _v86Res_(r) { var x = typeof r === 'string' ? JSON.parse(r) : (r || {}); return { ok: !!(x.success || x.ok), data: x.data || {}, code: x.error && x.error.code || '', msg: x.error ? (x.error.message || String(x.error)) : '' }; }

function v81FryerData(token) {
  var op = null;
  try { op = _beginOp_(token, 'journals|haccp_view', 'FRYER_VIEW', 'Журналы', 'J38', null); } catch (e) { return _failFrom_(e); }
  try {
    var R = _v81FryRows_(), now = Date.now(), fry = {}, oils = {}, prods = {};
    R.forEach(function (r) {
      var f = String(r['Фритюр']), st = String(r['Статус']); fry[f] = fry[f] || { name: f, open: null, last: null, closed: null };
      if (/^(OPEN|STARTING|CLOSING)$/.test(st)) fry[f].open = r; if (st !== 'CANCELLED') fry[f].last = r; if (st === 'CLOSED') fry[f].closed = r;
      if (r['Вид жира']) oils[String(r['Вид жира'])] = true; if (r['Продукция']) prods[String(r['Продукция'])] = true;
    });
    var list = Object.keys(fry).filter(function (k) { return fry[k].last || fry[k].open; }).map(function (k) {
      var f = fry[k], o = f.open, l = o || f.last, st = o && o['Начало'] instanceof Date ? o['Начало'] : null, c = f.closed;
      var carry = c && !o && (!c['Причина'] || c['Причина'] === MC_V86_FRY_REASONS_[0]) ? (_v86Num_(c['Остаток, кг']) || 0) : 0;
      return { name: k, open: !!o, state: o ? String(o['Статус']) : '', cycle: o ? String(o.CycleID) : '', oil: String(l['Вид жира'] || ''), since: st ? Utilities.formatDate(st, _mcTz_(), 'dd.MM HH:mm') : '', minutes: st ? Math.round((now - st.getTime()) / 60000) : 0,
        product: String(l['Продукция'] || ''), by: o ? String(o['Начал'] || '') : '', batch: o ? String(o['Партия масла'] || '') : '', poured: o && o['Залито'] !== '' ? Number(o['Залито']) : null, pouredUnit: o ? String(o['Ед. залитого'] || '') : '',
        carry: o ? (_v86Num_(o['Переходящий с прошлого, кг']) || 0) : carry,
        pending: o && String(o['Статус']) === 'STARTING' ? 'начало цикла не дописано в журнал J38 (сбой связи) — нажмите «Дописать начало»: второй цикл не появится, масло со склада повторно не спишется' :
          o && String(o['Статус']) === 'CLOSING' ? 'окончание не дописано в журнал J38 (сбой связи) — нажмите «Дописать окончание»: строка будет дописана по уже введённым данным' : '' };
    });
    var deny = _v81FryAllowed_(op), s = op.session, rev = _v86FryReviewer_(s);
    var review = rev ? R.filter(function (r) { return /^НУЖНА СВЕРКА/.test(String(r['Сверка'])); }).map(function (r) {
      return { cycle: String(r.CycleID), fryer: String(r['Фритюр']), oil: String(r['Вид жира']), ended: r['Окончание'] instanceof Date ? Utilities.formatDate(r['Окончание'], _mcTz_(), 'dd.MM HH:mm') : '', by: String(r['Закончил'] || ''), text: String(r['Сверка']).replace(/^НУЖНА СВЕРКА:\s*/, '') }; }) : [];
    var canStock = !deny && !!s && !s.dev && _mcRbHasExact_(s, 'stock|kanban');
    _endOp_(op);
    return _ok_({ fryers: list, oils: Object.keys(oils), products: Object.keys(prods), canAdd: !deny, deny: deny, reasons: MC_V86_FRY_REASONS_, batches: canStock ? _v86OilBatches_() : [], canStock: canStock, review: review, canReview: rev }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Шаги начала цикла после записи самого цикла: списание масла со склада (если выбрана партия), строка J38, статус «в работе».
    Каждый выполненный шаг отмечается в цикле — повтор продолжает с невыполненного и не повторяет списание и строку журнала. */
function _v86FryStartSteps_(cyc, op, token, fefoAck) {
  var id = String(cyc.CycleID), f = String(cyc['Фритюр']), steps = String(cyc['Шаги'] || '').split(',').filter(String), out = { ok: true, batch: null, row: Number(cyc['Строка J38']) || 0 };
  var bid = String(cyc['Партия масла'] || '');
  if (bid && steps.indexOf('stock') < 0) {
    var u = _v86Res_(useBatch(bid, Number(cyc['Залито']), String(cyc['Ед. залитого'] || 'кг'), 'фритюр «' + f + '» · цикл ' + id, fefoAck === true, token));
    if (!u.ok) return { ok: false, code: u.code || 'BATCH', msg: 'Масло со склада не списано, цикл не начат: ' + u.msg };
    try { _mcCreateTraceLink_('BATCH', bid, 'FRYER_OIL', 'FRYER_CYCLE', id, { actor: _author_(op).фио, source: 'FRYER_START', weight: u.data.used, unit: u.data.unit }); } catch (e) {}
    steps.push('stock'); _v86FrySet_(cyc._row, { 'Шаги': steps.join(',') }); out.batch = { id: bid, used: u.data.used, unit: u.data.unit, remainText: u.data.remainText };
  }
  if (steps.indexOf('j38') < 0) {
    var st = cyc['Начало'] instanceof Date ? cyc['Начало'] : new Date();
    out.row = _v81Append_('J38', { 'Дата': MC_V81_DAY_(st), 'Время начала использования жира': MC_V81_HM_(st), 'Вид фритюрного жира': String(cyc['Вид жира']) + (bid ? ' (партия ' + bid + ')' : ''), 'Органолептическая оценка жира на начало жарки': String(cyc['Оценка на начало']),
      'Тип жарочного оборудования': f, 'Вид продукции': String(cyc['Продукция'] || ''), 'ФИО контролёра': String(cyc['Начал'] || _author_(op).фио) }, op, 'фритюр · ' + id);
    steps.push('j38'); _v86FrySet_(cyc._row, { 'Шаги': steps.join(','), 'Строка J38': out.row });
  }
  _v86FrySet_(cyc._row, { 'Статус': 'OPEN' });
  return out;
}
/** «Залил масло»: {fryer, oil, organoleptic, product, batchId?, addedQty?, key?, confirm: true}.
    V86 (аудит R2, P0.1): сначала записывается цикл, затем шаги (склад, J38); повтор с тем же ключом (или тем же сотрудником
    и данными в течение 2 минут) возвращает тот же цикл или доводит незавершённый шаг — второго цикла и второй строки J38 нет. */
function v81FryerStart(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'journals', 'FRYER_START', 'Журналы', 'J38', null); } catch (e) { return _failFrom_(e); }
  try {
    var deny = _v81FryAllowed_(op); if (deny) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', deny, op.id); }
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), f = String(d.fryer || '').trim(), oil = String(d.oil || '').trim(), org = String(d.organoleptic || '').trim();
    var key = String(d.key || '').slice(0, 80), bid = String(d.batchId || '').trim(), q = _v86Num_(d.addedQty);
    if (!f) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите фритюр', op.id); }
    return _withLock_(function () {
      var R = _v81FryRows_(), now = new Date(), who = _author_(op).фио;
      var cur = R.filter(function (r) { return String(r['Фритюр']) === f && /^(OPEN|STARTING|CLOSING)$/.test(String(r['Статус'])); })[0];
      if (cur) {
        var st0 = String(cur['Статус']), t0 = cur['Начало'] instanceof Date ? cur['Начало'].getTime() : 0;
        var same = key ? String(cur['Ключ начала']) === key : (String(cur['Начал']) === who && (!oil || String(cur['Вид жира']) === oil) && now.getTime() - t0 <= MC_V86_RETRY_MS_);
        if (d.resume === true && st0 === 'STARTING') same = true;
        if (same && st0 === 'OPEN') { _endOp_(op); return _ok_({ cycle: String(cur.CycleID), row: Number(cur['Строка J38']) || 0, idempotent: true, message: '«Залил масло» уже записано — повтор не создал второй цикл' }, op.id); }
        if (st0 === 'STARTING' && (same || String(cur['Начал']) === who)) {
          var rs = _v86FryStartSteps_(cur, op, token, d.fefoAck === true);
          if (!rs.ok) { _v86FrySet_(cur._row, { 'Статус': 'CANCELLED', 'Примечание': rs.msg }); _endOp_(op, 'FAILED'); return _fail_(rs.code, rs.msg, op.id); }
          _audit_(op, 'FRYER_START_RESUMED', 'Журналы', 'J38', null, { цикл: String(cur.CycleID), фритюр: f });
          _endOp_(op); return _ok_({ cycle: String(cur.CycleID), row: rs.row, batch: rs.batch, resumed: true, message: 'Незавершённое начало цикла дописано' }, op.id);
        }
        _endOp_(op, 'FAILED');
        return _fail_('CONFLICT', st0 === 'CLOSING' ? '«' + f + '»: окончание прошлого цикла не дописано — нажмите «Дописать окончание»' : '«' + f + '» уже в работе — сначала «Закончил / заменил»', op.id);
      }
      // новый цикл — проверки ввода (повтор и доведение незавершённого выше их не требуют: данные уже в цикле)
      if (d.resume === true) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', '«' + f + '»: незавершённой записи нет', op.id); }
      if (!oil && !bid) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите фритюр и вид жира', op.id); }
      if (bid && !(q > 0)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите, сколько масла залили из партии ' + bid, op.id); }
      if (!org) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Оцените жир на начало жарки (цвет, запах, вкус)', op.id); }
      if (d.confirm !== true) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Подтвердите, что сами оценили жир', op.id); }
      var b = null;
      if (bid) { b = _v86OilBatches_().filter(function (x) { return x.id === bid; })[0];
        if (!b) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Партия масла ' + bid + ' не найдена среди действующих (остаток, срок годности)', op.id); }
        if (!oil) oil = b.name; }
      var prev = R.filter(function (r) { return String(r['Фритюр']) === f && String(r['Статус']) === 'CLOSED'; }).slice(-1)[0];
      var carry = prev && (!prev['Причина'] || prev['Причина'] === MC_V86_FRY_REASONS_[0]) ? (_v86Num_(prev['Остаток, кг']) || 0) : 0;
      var id = 'FRY-' + Date.now(), sh = _v81FrySheet_(), rec = {};
      MC_V81_FRY_HEAD_.forEach(function (h) { rec[h] = ''; });
      rec.CycleID = id; rec['Фритюр'] = f; rec['Вид жира'] = oil; rec['Начало'] = now; rec['Оценка на начало'] = org; rec['Продукция'] = String(d.product || ''); rec['Статус'] = 'STARTING'; rec['Начал'] = who;
      rec['Ключ начала'] = key; rec['Шаги'] = 'cycle'; rec['Партия масла'] = bid; rec['Залито'] = q > 0 ? q : ''; rec['Ед. залитого'] = q > 0 ? (b ? b.unit : 'кг') : ''; rec['Переходящий с прошлого, кг'] = carry || '';
      sh.appendRow(MC_V81_FRY_HEAD_.map(function (h) { return rec[h]; }));
      var cyc = _v86FryCycle_(id), res = _v86FryStartSteps_(cyc, op, token, d.fefoAck === true);
      if (!res.ok) { _v86FrySet_(cyc._row, { 'Статус': 'CANCELLED', 'Примечание': res.msg }); _endOp_(op, 'FAILED'); return _fail_(res.code, res.msg, op.id); }
      _audit_(op, 'FRYER_START', 'Журналы', 'J38', null, { цикл: id, фритюр: f, жир: oil, оценка: org, партия: bid, залито: q, переходящий: carry });
      _endOp_(op); return _ok_({ cycle: id, row: res.row, batch: res.batch, carry: carry }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Сверка баланса жира: было во фритюре (переходящий + залито + долито) против остатка и утилизации. Допуск не подставляется. */
function _v86FryBalance_(cyc, left, disp, topped) {
  var carry = _v86Num_(cyc['Переходящий с прошлого, кг']) || 0, pq = _v86Num_(cyc['Залито']), pkg = pq !== null ? _v86KgOf_(pq, cyc['Ед. залитого']) : null;
  if (pq !== null && pq > 0 && pkg === null) return 'не сверялось: масло залито в «' + cyc['Ед. залитого'] + '», остаток — в кг (пересчёт по плотности система не делает)';
  if (!(pkg > 0) && !(carry > 0) && !(topped > 0)) return 'не сверялось: не внесено, сколько жира было во фритюре';
  var inKg = _v86R1_(carry + (pkg || 0) + (topped || 0)), out = _v86R1_(left + disp), used = _v86R1_(inKg - out);
  if (used < -0.0005) return 'НУЖНА СВЕРКА: остаток и утилизация ' + out + ' кг больше, чем было во фритюре ' + inKg + ' кг (переходящий ' + carry + ' + залито ' + (pkg || 0) + ' + долито ' + (topped || 0) + ') — проверьте взвешивание и долив';
  return 'сходится: было ' + inKg + ' кг, остаток и утилизация ' + out + ' кг, израсходовано в работе ' + used + ' кг';
}
function _v86FryEndJ38_(cyc, note) {
  var j = _mcJById_('J38'), js = _book_().getSheetByName(j.sheetName), jr = Number(cyc['Строка J38']); if (!js || !(jr > 1)) return 0;
  var put = function (c, v) { var ci = j.columns.indexOf(c); if (ci >= 0) js.getRange(jr, ci + 1).setValue(v); };
  var en = cyc['Окончание'] instanceof Date ? cyc['Окончание'] : new Date();
  put('Время окончания жарки', MC_V81_HM_(en)); put('Органолептическая оценка жира по окончании жарки', String(cyc['Оценка по окончании'])); put('Переходящий остаток жира, кг', Number(cyc['Остаток, кг']) || 0); put('Утилизированный жир, кг', Number(cyc['Утилизировано, кг']) || 0);
  put('Примечания / корректирующие действия', note);
  try { if (typeof _mcMirrorRow_ === 'function') _mcMirrorRow_('J38', jr); } catch (e) {}
  return jr;
}
function _v86FryNote_(cyc) {
  var t = String(cyc['Причина'] || ''); if (cyc['Примечание']) t += (t ? ': ' : '') + String(cyc['Примечание']);
  if (/^НУЖНА СВЕРКА/.test(String(cyc['Сверка']))) t += (t ? ' · ' : '') + 'баланс жира не сходится — передано на сверку';
  return t;
}
/** «Закончил / заменил»: {fryer, organoleptic, leftKg, disposedKg, reason, note, toppedKg?, key?, confirm: true}.
    V86 (аудит R2, P0.1, P1.3): причина — из списка (обязательна; «другое» — с пояснением); баланс жира сверяется, расхождение —
    «нужна сверка» у шеф-повара; сначала закрывается цикл, затем дописывается J38; повтор не дублирует и доводит незавершённое. */
function v81FryerEnd(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'journals', 'FRYER_END', 'Журналы', 'J38', null); } catch (e) { return _failFrom_(e); }
  try {
    var deny = _v81FryAllowed_(op); if (deny) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', deny, op.id); }
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), f = String(d.fryer || '').trim(), org = String(d.organoleptic || '').trim(), key = String(d.key || '').slice(0, 80);
    var left = _v86Num_(d.leftKg), disp = _v86Num_(d.disposedKg), top = d.toppedKg === undefined || d.toppedKg === '' ? 0 : _v86Num_(d.toppedKg), reason = String(d.reason || '').trim(), note = String(d.note || '').trim();
    return _withLock_(function () {
      var R = _v81FryRows_(), now = new Date(), who = _author_(op).фио;
      var cur = R.filter(function (x) { return String(x['Фритюр']) === f && /^(OPEN|STARTING|CLOSING)$/.test(String(x['Статус'])); })[0];
      if (!cur) {
        var last = R.filter(function (x) { return String(x['Фритюр']) === f && String(x['Статус']) === 'CLOSED'; }).slice(-1)[0], te = last && last['Окончание'] instanceof Date ? last['Окончание'].getTime() : 0;
        if (last && (key ? String(last['Ключ окончания']) === key : (String(last['Закончил']) === who && now.getTime() - te <= MC_V86_RETRY_MS_ && Number(last['Остаток, кг']) === left && Number(last['Утилизировано, кг']) === disp))) {
          _endOp_(op); return _ok_({ cycle: String(last.CycleID), row: Number(last['Строка J38']) || 0, idempotent: true, balance: String(last['Сверка'] || ''), message: '«Закончил / заменил» уже записано — повтор ничего не изменил' }, op.id);
        }
        _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', '«' + f + '» не в работе', op.id);
      }
      if (String(cur['Статус']) === 'STARTING') { _endOp_(op, 'FAILED'); return _fail_('CONFLICT', '«' + f + '»: начало цикла не дописано в журнал — сначала нажмите «Дописать начало»', op.id); }
      if (String(cur['Статус']) === 'CLOSING') {
        var jr0 = _v86FryEndJ38_(cur, _v86FryNote_(cur)); _v86FrySet_(cur._row, { 'Статус': 'CLOSED', 'Шаги': String(cur['Шаги'] || '') + ',j38end' });
        _audit_(op, 'FRYER_END_RESUMED', 'Журналы', 'J38', null, { цикл: String(cur.CycleID), фритюр: f });
        _endOp_(op); return _ok_({ cycle: String(cur.CycleID), row: jr0, resumed: true, balance: String(cur['Сверка'] || ''), message: 'Окончание цикла дописано в журнал по ранее введённым данным' }, op.id);
      }
      if (!org) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Оцените жир по окончании жарки', op.id); }
      if (left === null || disp === null) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите переходящий остаток и утилизированный жир, кг (0, если нет)', op.id); }
      if (top === null) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Долито за цикл — число, кг (0 или пусто, если не доливали)', op.id); }
      if (MC_V86_FRY_REASONS_.indexOf(reason) < 0) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Выберите причину: ' + MC_V86_FRY_REASONS_.join(', '), op.id); }
      if (reason === 'другое' && !note) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Причина «другое» — поясните', op.id); }
      if (d.confirm !== true) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Подтвердите, что сами оценили жир и взвесили остаток', op.id); }
      var bal = _v86FryBalance_(cur, left, disp, top || 0);
      // шаг 1: цикл (CLOSING) — внесённые данные сохранены; шаг 2: строка J38; шаг 3: CLOSED
      _v86FrySet_(cur._row, { 'Окончание': now, 'Оценка по окончании': org, 'Остаток, кг': left, 'Утилизировано, кг': disp, 'Статус': 'CLOSING', 'Закончил': who, 'Примечание': note, 'Ключ окончания': key, 'Долито, кг': top || '', 'Причина': reason, 'Сверка': bal });
      var cyc = _v86FryCycle_(cur.CycleID), jr = _v86FryEndJ38_(cyc, _v86FryNote_(cyc));
      _v86FrySet_(cur._row, { 'Статус': 'CLOSED', 'Шаги': String(cyc['Шаги'] || '') + ',j38end' });
      if (disp > 0) try { _mcCreateTraceLink_('FRYER_CYCLE', String(cur.CycleID), 'DISPOSED', 'WASTE_OIL', String(cur.CycleID) + '-OUT', { actor: who, source: 'FRYER_END', weight: disp, unit: 'кг' }); } catch (e) {}
      var review = /^НУЖНА СВЕРКА/.test(bal);
      if (review) try { _notify_('fryer_balance', 'warning', 'Фритюр: баланс жира не сходится — ' + f, bal.replace(/^НУЖНА СВЕРКА:\s*/, '') + '. Цикл ' + cur.CycleID + ', закончил ' + who + '.', 'Шеф-повар', 'fry|' + cur.CycleID, op); } catch (e) {}
      _audit_(op, 'FRYER_END', 'Журналы', 'J38', null, { цикл: String(cur.CycleID), фритюр: f, оценка: org, остаток: left, утилизировано: disp, долито: top || 0, причина: reason, сверка: bal });
      _endOp_(op); return _ok_({ cycle: String(cur.CycleID), row: jr, balance: bal, needsReview: review }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- 5. осмотр персонала (J07) ---------------- */
var MC_V81_HL_ = 'Здоровье_Смена_V81', MC_V81_HL_HEAD_ = ['Дата', 'Сотрудник', 'Должность', 'Отметка', 'Жалобы', 'Время отметки', 'Допуск', 'Осмотрел', 'Время осмотра', 'Строка J07'];
function _v81HlRows_(day) {
  var sh = _book_().getSheetByName(MC_V81_HL_); if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, MC_V81_HL_HEAD_.length).getValues().map(function (r, i) { var o = { _row: i + 2 }; MC_V81_HL_HEAD_.forEach(function (h, j) { o[h] = r[j]; }); return o; })
    .filter(function (o) { return !day || (o['Дата'] instanceof Date ? MC_V81_DAY_(o['Дата']) : String(o['Дата'])) === day; });
}
/** Сотрудник о себе: {healthy: true} или {healthy: false, complaints}. Один раз в день. */
function v81HealthSelf(json, token) {
  var op = null;
  try { op = _beginOp_(token, '', 'HEALTH_SELF', 'Персонал', 'J07', null); } catch (e) { return _failFrom_(e); }
  try {
    if (op.session && op.session.dev) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', 'Технический доступ — не сотрудник', op.id); }
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), a = _author_(op), day = MC_V81_DAY_();
    if (d.healthy !== true && !String(d.complaints || '').trim()) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Отметьте «здоров» или опишите жалобы', op.id); }
    return _withLock_(function () {
      if (_v81HlRows_(day).some(function (r) { return String(r['Сотрудник']) === a.фио; })) { _endOp_(op, 'FAILED'); return _fail_('DUPLICATE', 'Вы уже отметились сегодня', op.id); }
      _bcSheet_(MC_V81_HL_, MC_V81_HL_HEAD_).appendRow([day, a.фио, a.должность, d.healthy === true ? 'здоров, жалоб нет' : 'есть жалобы', d.healthy === true ? '' : String(d.complaints), new Date(), '', '', '', '']);
      _audit_(op, 'HEALTH_SELF', 'Персонал', 'J07', null, { сотрудник: a.фио, здоров: d.healthy === true });
      _endOp_(op); return _ok_({ day: day, healthy: d.healthy === true }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function _v81HlAllowed_(s) { return !!s && !s.dev && _mcRbJournalAllowed_(s, 'J07'); }
function v81HealthData(token) {
  var op = null;
  try { op = _beginOp_(token, '', 'HEALTH_VIEW', 'Персонал', 'J07', null); } catch (e) { return _failFrom_(e); }
  try {
    var a = _author_(op), day = MC_V81_DAY_(), R = _v81HlRows_(day), me = R.filter(function (r) { return String(r['Сотрудник']) === a.фио; })[0];
    var can = _v81HlAllowed_(op.session), J = can || me ? _v86J07Day_(day) : {};
    var adm = function (r) { var n = String(r['Сотрудник']); return String(r['Допуск'] || '') || (J[n] && J[n].admit ? J[n].admit + ' (журнал J07)' : ''); };
    var list = can ? R.map(function (r) { return { name: String(r['Сотрудник']), position: String(r['Должность'] || ''), mark: String(r['Отметка']), complaints: String(r['Жалобы'] || ''), at: r['Время отметки'] instanceof Date ? MC_V81_HM_(r['Время отметки']) : '', admitted: adm(r), by: String(r['Осмотрел'] || (J[String(r['Сотрудник'])] || {}).by || '') }; }) : [];
    // V86 (аудит R2, P0.3): кто не отметился и ещё не осмотрен — ответственный может осмотреть лично (одна строка J07 на человека)
    var notMarked = can ? _v86ActiveStaff_().filter(function (e) { return !R.some(function (r) { return String(r['Сотрудник']) === e.name; }) && !(J[e.name] && J[e.name].admit); }) : [];
    var route = _v86HealthRoute_(), s = op.session;
    _endOp_(op);
    return _ok_({ day: day, me: me ? { mark: String(me['Отметка']), admitted: adm(me) } : (J[a.фио] && J[a.фио].admit ? { mark: 'осмотр без самоотметки', admitted: J[a.фио].admit } : null), canApprove: can, list: list, notMarked: notMarked,
      route: route, canRoute: !!s && !s.dev && _v86HealthRouteAllowed_(s) }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Ответственный: {names: [...], confirm: true, temp?: {name: t°}, admit?: false, note?, inPerson?: [имена без самоотметки]}.
    V86 (аудит R2, P0.3): одна строка J07 на сотрудника в день — если строка уже заведена (бланк по расписанию), она дописывается,
    а её вопрос в «ожидающих» закрывается; если решение уже принято через вопрос журнала — второй раз не записывается. */
function v81HealthApprove(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'journals', 'HEALTH_APPROVE', 'Персонал', 'J07', null); } catch (e) { return _failFrom_(e); }
  try {
    if (!_v81HlAllowed_(op.session)) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', 'Осмотр персонала записывают: ' + _mcRbJournalRoles_('J07').join(', ') + '.', op.id); }
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), names = Array.isArray(d.names) ? d.names : [], admit = d.admit !== false, inPerson = Array.isArray(d.inPerson) ? d.inPerson : [];
    if (!names.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Выберите сотрудников', op.id); }
    if (d.confirm !== true) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Подтвердите, что осмотрели сотрудников сами', op.id); }
    var day = MC_V81_DAY_(), who = _author_(op).фио, done = [], refused = [], T = d.temp || {}, note = String(d.note || '').trim();
    return _withLock_(function () {
      var R = _v81HlRows_(day), sh = _bcSheet_(MC_V81_HL_, MC_V81_HL_HEAD_), J = _v86J07Day_(day), staff = {};
      _v86ActiveStaff_().forEach(function (e) { staff[e.name] = e; });
      names.forEach(function (n) {
        var r = R.filter(function (x) { return String(x['Сотрудник']) === n; })[0], jx = J[n];
        if (jx && jx.admit) { refused.push({ name: n, reason: 'уже осмотрен: журнал J07, допуск — ' + jx.admit });
          if (r && !r['Допуск']) _v86HlMark_(sh, r._row, jx.admit + ' (журнал J07)', jx.by || '', jx.row);
          return; }
        if (!r) {
          if (inPerson.indexOf(n) < 0 || !staff[n]) { refused.push({ name: n, reason: 'не отметился сегодня' }); return; }
          sh.appendRow([day, n, staff[n].position, 'без самоотметки — осмотрен ответственным лично', '', '', '', '', '', '']);
          r = { _row: sh.getLastRow(), 'Сотрудник': n, 'Должность': staff[n].position, 'Отметка': 'без самоотметки — осмотрен ответственным лично', 'Жалобы': '', 'Время отметки': '' };
        }
        if (r['Допуск']) { refused.push({ name: n, reason: 'уже осмотрен: ' + r['Допуск'] }); return; }
        var sick = String(r['Отметка']) === 'есть жалобы';
        if (sick && admit && !note) { refused.push({ name: n, reason: 'есть жалобы — допуск только с пояснением' }); return; }
        if (!admit && !note && !sick) { refused.push({ name: n, reason: 'не допущен — укажите причину в пояснении' }); return; }
        var now = new Date(), vals = { 'Время': MC_V81_HM_(now), 't° тела': T[n] === undefined ? '' : T[n],
          'Кожа рук (гнойнички)': admit && !sick ? 'нет' : '', 'Признаки ОРВИ': admit && !sick ? 'нет' : '',
          'Жалобы/травмы': sick ? String(r['Жалобы'] || 'есть') + (note ? '; ' + note : '') : (admit ? 'нет' : note), 'Допуск к работе (да/нет)': admit ? 'да' : 'нет' };
        var src = 'осмотр · ' + (String(r['Отметка']).indexOf('без самоотметки') === 0 ? 'без самоотметки' : 'отметка сотрудника ' + (r['Время отметки'] instanceof Date ? MC_V81_HM_(r['Время отметки']) : ''));
        var jr;
        if (jx && jx.row) { jr = _v86J07Patch_(jx.row, vals, src + ' · ' + who); _v86ClosePending_('J07', jr, admit ? 'да' : 'нет', who); }
        else { vals['Дата'] = day; vals['ФИО сотрудника'] = n; vals['Должность'] = String(r['Должность'] || ''); jr = _v81Append_('J07', vals, op, src); }
        _v86HlMark_(sh, r._row, admit ? 'да' : 'нет' + (note ? ': ' + note : ''), who, jr);
        done.push({ name: n, admitted: admit, row: jr, merged: !!(jx && jx.row) });
      });
      _audit_(op, 'HEALTH_APPROVE', 'Персонал', 'J07', null, { допущены: done.filter(function (x) { return x.admitted; }).map(function (x) { return x.name; }), не_допущены: done.filter(function (x) { return !x.admitted; }).map(function (x) { return x.name; }), отказ: refused });
      _endOp_(op, done.length ? 'COMPLETED' : 'FAILED');
      if (!done.length) return _fail_('VALIDATION', refused.map(function (x) { return x.name + ' — ' + x.reason; }).join('; '), op.id);
      return _ok_({ done: done, refused: refused }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- главное окно ---------------- */
(function () {
  if (typeof _UI_BUILDERS_ !== 'object') return;
  var orig = _UI_BUILDERS_.home; if (typeof orig !== 'function') return;
  _UI_BUILDERS_.home = function (token, opts, s) {
    var r = orig(token, opts, s) || {};
    try {
      if (s && !s.dev) {
        var day = MC_V81_DAY_(), R = _v81HlRows_(day), a = _author_(token), add = [];
        if (!R.some(function (x) { return String(x['Сотрудник']) === a.фио; })) add.push({ label: 'Здоровье: отметиться на смену', module: 'health' });
        if (_v81HlAllowed_(s)) { var w = _v86HlWaiting_(day, R).length; if (w) add.push({ label: 'Осмотр персонала: ждут ' + w, module: 'health' }); }
        if (_mcRbHasExact_(s, 'stock')) { var n = _v81ExpiredCount_(); if (n) add.push({ label: 'Просрочено: ' + n + ' — акт списания', module: 'writeoff' }); }
        var FR = _v81FryRows_();
        if (_mcRbJournalAllowed_(s, 'J38') && FR.some(function (x) { return /^(OPEN|STARTING|CLOSING)$/.test(String(x['Статус'])); })) add.push({ label: FR.some(function (x) { return /^(STARTING|CLOSING)$/.test(String(x['Статус'])); }) ? 'Фритюр: запись не завершена' : 'Фритюр в работе', module: 'fryer' });
        if (_v86FryReviewer_(s)) { var nr = FR.filter(function (x) { return /^НУЖНА СВЕРКА/.test(String(x['Сверка'])); }).length; if (nr) add.push({ label: 'Фритюр: сверить ' + nr, module: 'fryer' }); }
        var A0 = r.actions || [], bi = A0.findIndex ? A0.findIndex(function (x) { return x && x.module === 'brakesales'; }) : -1;   // «Бракераж» остаётся первым
        r.actions = bi === 0 ? [A0[0]].concat(add, A0.slice(1)) : add.concat(A0);
      }
    } catch (e) {}
    return r;
  };
})();
// разделы: «Фритюр» — в Производстве и ХАССП (кто ведёт J38); «Здоровье на смену» — в Персонале (всем)
(function () {
  if (typeof _UI_BUILDERS_ !== 'object') return;
  var add = function (sec, btn, ok) {
    var orig = _UI_BUILDERS_[sec]; if (typeof orig !== 'function') return;
    _UI_BUILDERS_[sec] = function (token, opts, s) { var r = orig(token, opts, s) || {}; try { if (!s || ok(s)) r.actions = (r.actions || []).concat([btn]); } catch (e) {} return r; };
  };
  var fry = function (s) { return !s.dev && (_mcRbJournalAllowed_(s, 'J38') || _v86FryReviewer_(s)); };
  add('production', { label: 'Фритюр', module: 'fryer' }, fry); add('haccp', { label: 'Фритюр', module: 'fryer' }, fry);
  add('personnel', { label: 'Здоровье на смену', module: 'health' }, function () { return true; });
})();
try { ['fryer', 'health'].forEach(function (k) { if (MC_UI_VIEWS_.indexOf(k) < 0) MC_UI_VIEWS_ = MC_UI_VIEWS_.concat([k]); }); } catch (e) {}
