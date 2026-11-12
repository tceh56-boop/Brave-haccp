/**
 * MON CHEF — единый реестр температур (ТЗ §15, Temperature Engine).
 *
 * Объекты контроля («Температурные_Объекты»): холодильник, морозильник, склад, витрина,
 * транспорт и др. — с допустимым диапазоном и прибором; заводит ответственный за HACCP.
 * Каждое измерение («Температуры»): MeasurementID, объект, прибор, ожидаемый диапазон,
 * фактическое значение, ед., сотрудник, время, результат, FactID, DeviationID.
 * Измерения из журналов, ККТ, входного контроля и суточных проб попадают сюда же
 * (источник указан) — одно место для всех температур, без повторных отклонений.
 *
 * Отклонение → DEVIATION (+ партия в карантин, если указана) → корректирующее действие →
 * повторный замер (RECHECK) → решение ответственного: RELEASE (партия снова доступна)
 * или REJECT (партия заблокирована). Значения вводит человек; система их не подставляет.
 */
var MC_T_OBJ_SHEET_ = 'Температурные_Объекты';
// Этап 10.8: у объекта — установленная температура (уставка) и время проверок. По ним система задаёт вопрос
// «Холодильник №5: температура +2 °C?»; склад — ещё влажность. Колонки дописаны в конец: старые листы читаются как раньше.
var MC_T_OBJ_HEAD_ = ['ObjectID', 'Тип', 'Название', 'EquipmentID', 'Мин', 'Макс', 'Ед.', 'Статус', 'Кто', 'Обновлено',
  'Установленная t°', 'Влажность мин', 'Влажность макс', 'Установленная влажность', 'Время проверок', 'Журнал'];
var MC_T_SHEET_ = 'Температуры';
var MC_T_HEAD_ = ['MeasurementID', 'Тип объекта', 'Объект', 'ObjectID', 'EquipmentID', 'Мин', 'Макс', 'Факт', 'Ед.', 'Сотрудник', 'Время',
  'Результат', 'FactID', 'DeviationID', 'BatchID', 'Источник', 'Повтор для', 'Корректирующее действие', 'Решение', 'Статус', 'OperationID', 'Внесено'];
var MC_T_TYPES_ = { REFRIGERATOR: 'Холодильник', FREEZER: 'Морозильник', STORAGE: 'Склад', COOKING: 'Приготовление', COOLING: 'Охлаждение',
  REGENERATION: 'Регенерация', DISPLAY: 'Витрина', TRANSPORT: 'Транспорт', SAMPLE: 'Хранение проб', INCOMING: 'Приёмка', DEFROST: 'Размораживание (t° в толще)',
  HOT_HOLDING: 'Горячее хранение (мармит)' };
/** Объекты с плановыми проверками и их журнал: холодильное оборудование и мармиты — J01 (формы J25, J42), помещения — J04 (форма J43). */
var MC_T_SCHEDULED_ = { REFRIGERATOR: 'J01', FREEZER: 'J01', DISPLAY: 'J01', HOT_HOLDING: 'J01', STORAGE: 'J04' };
var MC_T_TRIG_PREFIX_ = 'TQ-';

/** Дописывает недостающие колонки в шапку существующего листа (только в конец). */
function _tEnsureHead_(sh, head) {
  var w = sh.getLastColumn();
  if (w >= head.length) return sh;
  var cur = sh.getRange(1, 1, 1, Math.max(w, 1)).getValues()[0];
  for (var i = 0; i < w; i++) if (String(cur[i] || '') !== head[i]) return sh;   // чужая шапка — не трогаем
  sh.getRange(1, w + 1, 1, head.length - w).setValues([head.slice(w)]).setFontWeight('bold');
  return sh;
}
function _tSheet_() { return _tEnsureHead_(_bcSheet_(MC_T_SHEET_, MC_T_HEAD_), MC_T_HEAD_); }
function _tObjSheet_() { return _tEnsureHead_(_bcSheet_(MC_T_OBJ_SHEET_, MC_T_OBJ_HEAD_), MC_T_OBJ_HEAD_); }
function _tNum_(x) {
  if (x === '' || x === null || x === undefined) return null;
  if (typeof x === 'number') return isNaN(x) ? null : x;
  var m = /^\s*([+\-−]?\d+(?:[.,]\d+)?)\s*(?:°\s*[cс]?|[cс])?\s*$/i.exec(String(x));
  return m ? Number(m[1].replace('−', '-').replace(',', '.')) : null;
}
/** «+2…+6», «от 2 до 6 °C», «не выше +6», «-18 и ниже» → {min,max} (только из текста документа). */
function _tRangeOf_(text) {
  var t = String(text || '').replace(/−/g, '-'), n = (t.match(/[+\-]?\d+(?:[.,]\d+)?/g) || []).map(function (x) { return Number(x.replace(',', '.')); });
  if (n.length >= 2) return { min: Math.min(n[0], n[1]), max: Math.max(n[0], n[1]) };
  if (n.length === 1) { if (/не выше|не более|до|≤|ниже|max/i.test(t)) return { min: null, max: n[0] }; if (/не ниже|не менее|от|≥|выше|min/i.test(t)) return { min: n[0], max: null }; }
  return { min: null, max: null };
}
function _tObjects_() {
  var v = _tObjSheet_().getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) if (v[i][0]) out.push({ row: i + 1, id: String(v[i][0]), type: String(v[i][1]), name: String(v[i][2]), equipmentId: String(v[i][3] || ''), min: _tNum_(v[i][4]), max: _tNum_(v[i][5]), unit: String(v[i][6] || '°C'), status: String(v[i][7] || 'ACTIVE'),
    setpoint: _tNum_(v[i][10]), hMin: _tNum_(v[i][11]), hMax: _tNum_(v[i][12]), hSet: _tNum_(v[i][13]), times: String(v[i][14] || ''), journalId: String(v[i][15] || MC_T_SCHEDULED_[String(v[i][1])] || '') });
  return out;
}
/** «+2», «-18», «0», «+3,5» — как пишут в журнале. */
function _tFmt_(n) { return n === null || n === undefined || n === '' ? '…' : (Number(n) > 0 ? '+' : '') + String(n).replace('.', ','); }
/** Вопрос сотруднику: «Холодильник №5: температура +2 °C?» (помещение — с влажностью). */
function _tQuestion_(o) {
  return o.name + ': температура ' + _tFmt_(o.setpoint) + ' ' + (o.unit || '°C') + (o.hSet !== null && o.hSet !== undefined ? ', влажность ' + String(o.hSet).replace('.', ',') + ' %' : '') + '?';
}
function _tNormText_(set, min, max, unit) {
  var f = unit === '%' ? function (n) { return n === null || n === undefined || n === '' ? '…' : String(n).replace('.', ','); } : _tFmt_;
  return (set !== null && set !== undefined ? 'уст. ' + f(set) + ' ' + unit + '; ' : '') + 'допустимо ' + f(min) + '…' + f(max) + ' ' + unit;
}
/** Время проверок: «09:00, 21:00». Пусто — начало и конец смены (холодильники), начало смены (помещения). */
function _tTimes_(o) {
  var t = String(o.times || '').split(/[,;\s]+/).map(function (x) { var m = _hm2min_(x); return m === null ? '' : _min2hm_(m); }).filter(Boolean);
  if (t.length) return t;
  var sh = _shift_();
  return (o.journalId || MC_T_SCHEDULED_[o.type]) === 'J04' ? [sh.start] : [sh.start, sh.end];
}
/**
 * Плановая проверка объекта: строка «Журналы_Расписание» с ID «TQ-<объект>», режим «темп_да_нет».
 * Сегодняшние неотвеченные проверки получают новый текст вопроса; у выведенного объекта — отменяются.
 */
function _tSyncSchedule_(o) {
  var j = MC_T_SCHEDULED_[o.type];
  var sh = _jtrigSheet_(), v = sh.getDataRange().getValues(), id = MC_T_TRIG_PREFIX_ + o.id, row = -1;
  for (var i = 1; i < v.length; i++) if (String(v[i][0]) === id) { row = i + 1; break; }
  var active = !!j && o.status === 'ACTIVE' && o.setpoint !== null;
  if (!j && row < 0) return null;
  var room = o.hMin !== null || o.hMax !== null;
  var vals = [id, j || o.journalId || '', o.name, _tQuestion_(o), 'в_заданное_время', _tTimes_(o).join(', '), 'темп_да_нет', room ? '°C / %' : (o.unit || '°C'),
    o.min === null ? '' : o.min, o.max === null ? '' : o.max, false, '', active, row > 0 ? v[row - 1][13] : new Date()];
  if (row > 0) sh.getRange(row, 1, 1, vals.length).setValues([vals]); else sh.appendRow(vals);
  if (active) _tRetireGenericChecks_();
  var psh = _pendSheet_(), pv = psh.getDataRange().getValues();
  for (var k = 1; k < pv.length; k++) {
    if (String(pv[k][1]) !== id || String(pv[k][8]) === 'выполнено' || String(pv[k][8]) === 'отменено') continue;
    if (active) { psh.getRange(k + 1, 4, 1, 2).setValues([[o.name, _tQuestion_(o)]]); }
    else psh.getRange(k + 1, 9).setValue('отменено');
  }
  return id;
}
function _tRows_() {
  var v = _tSheet_().getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) if (v[i][0]) out.push({ row: i + 1, id: String(v[i][0]), type: v[i][1], object: v[i][2], objectId: v[i][3], equipmentId: v[i][4], min: v[i][5], max: v[i][6], value: v[i][7], unit: v[i][8],
    employee: v[i][9], at: _bcDate_(v[i][10]), result: String(v[i][11]), factId: v[i][12], deviationId: v[i][13], batchId: v[i][14], source: v[i][15], parent: v[i][16], action: v[i][17], decision: v[i][18], status: String(v[i][19]), op: v[i][20], entered: v[i][21] ? _bcDate_(v[i][21]) : '' });
  return out;
}
function _tFind_(id) { return _tRows_().filter(function (r) { return r.id === String(id); })[0] || null; }

/**
 * Запись измерения (общая для ручного ввода и зеркала из журналов/ККТ/приёмки/проб).
 * m: {type, object, objectId, equipmentId, min, max, value, unit, batchId, source, parent, action, factId, deviationId}
 * Если factId/deviationId уже созданы исходным модулем — новые не создаются.
 */
function _tRecord_(m, s, opId) {
  var val = _tNum_(m.value), min = _tNum_(m.min), max = _tNum_(m.max), unit = m.unit || '°C';
  var res = val === null ? 'INVALID' : (min === null && max === null) ? 'NO_RANGE' : ((min !== null && val < min) || (max !== null && val > max)) ? 'DEVIATION' : 'OK';
  var id = 'TM-' + Date.now() + '-' + Utilities.getUuid().slice(0, 6), who = s ? String(s.name || s.fullName || s.user_id || '') : String(m.employee || 'система');
  var factId = m.factId || '', devId = m.deviationId || '';
  if (!factId) factId = _bcFact_({ factType: 'TEMPERATURE', objectType: MC_T_TYPES_[m.type] ? m.type : 'TEMPERATURE', objectId: m.objectId || m.object, operationType: m.parent ? 'RECHECK' : 'MEASUREMENT',
    dateTime: new Date(), value: val === null ? m.value : val, unit: unit, result: res, source: m.source || 'TEMPERATURE', batchId: m.batchId || '', equipmentId: m.equipmentId || '', employeeName: who,
    description: (MC_T_TYPES_[m.type] || m.type) + ' «' + m.object + '»: ' + m.value + ' ' + unit + (min !== null || max !== null ? ' (норма ' + (min === null ? '…' : min) + '…' + (max === null ? '…' : max) + ')' : '') }, s);
  if (res === 'DEVIATION' && !devId && !m.noDeviation) {
    try { var d = _mcOpenDeviationAndAction_({ factId: factId, journalId: m.journalId || 'J01', objectId: m.objectId || m.object, batchId: m.batchId || '', value: val, critical: !!m.batchId || m.type === 'COOKING' || m.type === 'COOLING',
      description: 'Температура вне диапазона: ' + (MC_T_TYPES_[m.type] || m.type) + ' «' + m.object + '» ' + val + ' ' + unit }, s, 'TEMPERATURE', 'Температура вне допустимого диапазона', 'HIGH');
      devId = (d && (d.deviationId || d.id)) || ''; } catch (e) {}
  }
  // зеркало из ККТ/приёмки/проб: отклонение отрабатывается в модуле-источнике (ККТ — повторным замером, приёмка — повторным контролем)
  var status = res === 'DEVIATION' ? (m.handled ? 'IN_SOURCE' : m.parent ? 'RECHECK_FAIL' : 'OPEN') : m.parent ? 'RECHECK_OK' : res === 'OK' ? 'CLOSED' : res;
  // «Время» — когда измерено (событие), «Внесено» — когда записано в систему (этап 10.8)
  var entered = new Date(), at = m.at instanceof Date ? m.at : (typeof _mcNow_ === 'function' ? _mcNow_() : entered);
  _tSheet_().appendRow([id, MC_T_TYPES_[m.type] || m.type || '', m.object || '', m.objectId || '', m.equipmentId || '', min === null ? '' : min, max === null ? '' : max, val === null ? String(m.value) : val, unit, who, at,
    res, factId, devId, m.batchId || '', m.source || 'ручной ввод', m.parent || '', m.action || '', '', status, opId || '', entered]);
  return { measurementId: id, result: res, factId: factId, deviationId: devId, status: status };
}
/** Зеркало из других модулей (журнал температур, ККТ, приёмка, пробы): без новых отклонений. */
function _tMirror_(m, s) { try { m.noDeviation = true; m.handled = true; return _tRecord_(m, s, m.op || ''); } catch (e) { return null; } }

function mcSaveTempObject(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'haccp', 'TEMP_OBJECT_SAVE', 'Температуры', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    var name = String(d.name || '').trim(), type = String(d.type || ''), min = _tNum_(d.min), max = _tNum_(d.max);
    var set = _tNum_(d.setpoint), hMin = _tNum_(d.hMin), hMax = _tNum_(d.hMax), hSet = _tNum_(d.hSet), sched = MC_T_SCHEDULED_[type];
    var bad = function (t) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', t, op.id); };
    if (!name) return bad('Укажите объект (например, «Холодильник №2, мясной цех»)');
    if (!MC_T_TYPES_[type]) return bad('Тип объекта: ' + Object.keys(MC_T_TYPES_).map(function (k) { return MC_T_TYPES_[k]; }).join(', '));
    if (min === null && max === null) return bad('Укажите допустимый диапазон (по документу: инструкция, ТТК, СанПиН) — система его не подставляет');
    if (min !== null && max !== null && min > max) return bad('Минимум больше максимума');
    // ответ «да» записывает в журнал установленную температуру — значит, она должна быть задана и лежать в пределах
    if (sched && set === null && d.status !== 'INACTIVE') return bad('Укажите установленную температуру — её система спрашивает у сотрудника: «' + name + ': температура +2 °C?»');
    if (set !== null && ((min !== null && set < min) || (max !== null && set > max))) return bad('Установленная температура ' + _tFmt_(set) + ' вне допустимого диапазона ' + _tFmt_(min) + '…' + _tFmt_(max));
    if (hMin !== null || hMax !== null) {
      if (type !== 'STORAGE') return bad('Влажность контролируется только в помещениях (тип «' + MC_T_TYPES_.STORAGE + '»)');
      if (hMin !== null && hMax !== null && hMin > hMax) return bad('Влажность: минимум больше максимума');
      if (hSet === null) return bad('Укажите установленную влажность — её система спрашивает вместе с температурой');
      if ((hMin !== null && hSet < hMin) || (hMax !== null && hSet > hMax)) return bad('Установленная влажность вне допустимого диапазона');
    } else hSet = null;
    var times = String(d.times || '').trim();
    if (times && !String(times).split(/[,;\s]+/).filter(Boolean).every(function (x) { return /^\d{1,2}:\d{2}$/.test(x) && _hm2min_(x) < 24 * 60; })) return bad('Время проверок — через запятую, например «09:00, 21:00»');
    if (d.equipmentId) _mcAssertEquipment_(d.equipmentId);
    return _withLock_(function () {
      var all = _tObjects_(), cur = d.id ? all.filter(function (o) { return o.id === String(d.id); })[0] : null;
      if (d.id && !cur) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Объект не найден', op.id); }
      if (all.some(function (o) { return o.status === 'ACTIVE' && o.name.toLowerCase() === name.toLowerCase() && (!cur || o.id !== cur.id); })) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Объект «' + name + '» уже есть', op.id); }
      var id = cur ? cur.id : 'TO-' + Date.now(), who = (op.session && (op.session.fullName || op.session.name)) || '';
      var row = [id, type, name, d.equipmentId || '', min === null ? '' : min, max === null ? '' : max, d.unit || '°C', d.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE', who, new Date(),
        set === null ? '' : set, hMin === null ? '' : hMin, hMax === null ? '' : hMax, hSet === null ? '' : hSet, times, sched || ''];
      if (cur) _tObjSheet_().getRange(cur.row, 1, 1, row.length).setValues([row]); else _tObjSheet_().appendRow(row);
      var o = { id: id, type: type, name: name, unit: row[6], status: row[7], min: min, max: max, setpoint: set, hMin: hMin, hMax: hMax, hSet: hSet, times: times, journalId: sched || '' };
      var trig = _tSyncSchedule_(o);
      _audit_(op, 'TEMP_OBJECT_SAVE', 'Температуры', id, cur ? { min: cur.min, max: cur.max, setpoint: cur.setpoint, status: cur.status } : null, { min: min, max: max, setpoint: set, humidity: hSet, status: row[7], times: _tTimes_(o).join(', ') });
      _endOp_(op, 'COMPLETED');
      return _ok_({ id: id, scheduleId: trig || '', question: sched ? _tQuestion_(o) : '', times: sched ? _tTimes_(o) : [], journalId: sched || '' }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Прежние общие проверки «Все холодильники» и «Склад» (HC-FR-01/02, HC-ST-01) выключаются, когда появился первый объект с вопросом: иначе сотрудника спрашивают дважды. */
var MC_T_GENERIC_CHECKS_ = ['HC-FR-01', 'HC-FR-02', 'HC-ST-01'];
function _tRetireGenericChecks_() {
  var n = 0;
  try {
    var ts = _jtrigSheet_(), tv = ts.getDataRange().getValues();
    for (var i = 1; i < tv.length; i++) if (MC_T_GENERIC_CHECKS_.indexOf(String(tv[i][0])) >= 0 && tv[i][12] !== false) { ts.getRange(i + 1, 13).setValue(false); n++; }
    var ps = _pendSheet_(), pv = ps.getDataRange().getValues();
    for (var k = 1; k < pv.length; k++) if (MC_T_GENERIC_CHECKS_.indexOf(String(pv[k][1])) >= 0 && String(pv[k][8]) !== 'выполнено' && String(pv[k][8]) !== 'отменено') { ps.getRange(k + 1, 9).setValue('отменено'); n++; }
    if (typeof _mcV15HaccpControlsSheet_ === 'function' && _book_().getSheetByName(MC_V15_HACCP_CONTROLS)) {
      var cs = _mcV15HaccpControlsSheet_(), cv = cs.getDataRange().getValues();
      for (var c = 1; c < cv.length; c++) if (MC_T_GENERIC_CHECKS_.indexOf(String(cv[c][0])) >= 0 && cv[c][14] !== false) { cs.getRange(c + 1, 15).setValue(false); n++; }
    }
  } catch (e) {}
  return n;
}

/**
 * Ответ на плановую проверку объекта (режим «темп_да_нет»). Вызывается из answerJournalCheck под блокировкой.
 * «Да» — в журнал и реестр идёт установленная температура (у помещения и влажность) с меткой «подтверждение «да»» (П).
 * «Нет» — сотрудник вносит фактическое значение, метка «замер» (И). Отклонение — только вне предела: «нет» и +3 °C
 * при пределе 0…+4 — обычная запись с фактом. Одна запись: журнал J01/J04 и реестр «Температуры» (формы J25, J42, J43 — из него).
 */
function _tAnswerCheck_(d, ans, prow, row, psh, trigId, journalId, op) {
  var fail = function (code, t) { _endOp_(op, 'FAILED'); return _fail_(code, t, op.id); };
  var objId = String(trigId || '').indexOf(MC_T_TRIG_PREFIX_) === 0 ? String(trigId).slice(MC_T_TRIG_PREFIX_.length) : '';
  var o = objId ? _tObjects_().filter(function (x) { return x.id === objId; })[0] : null;
  if (!o) return fail('NOT_FOUND', 'Объект контроля не найден');
  if (o.status !== 'ACTIVE') return fail('VALIDATION', 'Объект «' + o.name + '» выведен из работы');
  var j = (typeof JOURNALS !== 'undefined' ? JOURNALS : []).filter(function (x) { return x.id === journalId; })[0];
  if (!j) return fail('NOT_FOUND', 'Журнал ' + journalId + ' не найден');
  var room = o.hMin !== null || o.hMax !== null, src = ans === 'да' ? 'подтверждение «да»' : 'замер', t, h = null;
  if (ans === 'да') {
    if (o.setpoint === null) return fail('VALIDATION', 'У объекта не задана установленная температура — ответьте «нет» и внесите фактическую');
    t = o.setpoint; h = room ? o.hSet : null;
  } else {
    t = _tNum_(d.значение);
    if (t === null) return fail('VALIDATION', 'Внесите фактическую температуру, ' + (o.unit || '°C') + ' — система её не подставляет');
    if (t < -60 || t > 350) return fail('VALIDATION', 'Температура ' + t + ' вне физически возможного диапазона');
    if (room) { h = _tNum_(d.влажность); if (h === null || h < 0 || h > 100) return fail('VALIDATION', 'Внесите фактическую влажность, % — система её не подставляет'); }
  }
  var ev = _mcEventTime_(d.время);
  _mcAssertJournalPeriodOpen_(journalId, ev.at);
  if (o.equipmentId) _mcAssertEquipment_(o.equipmentId);
  var s = op.session, who = (s && (s.fullName || s.name || s.user_id)) || '', tz = _mcTz_();
  var r = _tRecord_({ type: o.type, object: o.name, objectId: o.id, equipmentId: o.equipmentId, min: o.min, max: o.max, value: t, unit: o.unit,
    source: 'журнал ' + journalId + ' · ' + src, journalId: journalId, at: ev.at }, s, op.id);
  var hDevId = '';
  if (h !== null && ((o.hMin !== null && h < o.hMin) || (o.hMax !== null && h > o.hMax))) {
    try { var hd = _mcOpenDeviationAndAction_({ factId: r.factId, journalId: journalId, objectId: o.id, value: h },
      s, 'HUMIDITY', 'Влажность вне допустимого диапазона: «' + o.name + '» ' + h + ' % (' + _tNormText_(o.hSet, o.hMin, o.hMax, '%') + ')', 'HIGH');
      hDevId = (hd && hd.deviationId) || 'да'; } catch (e) { hDevId = 'да'; }
  }
  var devIds = [r.result === 'DEVIATION' ? (r.deviationId || 'да') : '', hDevId].filter(Boolean), dev = devIds.length > 0;
  var late = ev.late > _mcLateMin_(), notes = [];
  if (late) notes.push('по графику ' + String(prow[6] || '') + '; внесено ' + Utilities.formatDate(new Date(), tz, 'dd.MM HH:mm') + ' — ' + who);
  if (r.result === 'DEVIATION') notes.push('t° вне предела — отклонение ' + (r.deviationId || ''));
  if (hDevId) notes.push('влажность вне предела — отклонение ' + hDevId);
  var cm = String(d.комментарий || d.факт || '').trim(); if (cm) notes.push(cm);
  var date = Utilities.formatDate(ev.at, tz, 'dd.MM.yyyy'), hm = Utilities.formatDate(ev.at, tz, 'HH:mm');
  var vals = journalId === 'J04'
    ? { 'Дата': date, 'Время': hm, 'Помещение': o.name, 't° факт': t, 'Влажность %': h === null ? '' : h, 'Норма t°': _tNormText_(o.setpoint, o.min, o.max, o.unit),
        'Норма влажности': room ? _tNormText_(o.hSet, o.hMin, o.hMax, '%') : '', 'Подпись': who, 'Примечания': notes.join('; ') }
    : { 'Дата': date, 'Время (утро/вечер)': hm, 'Наименование оборудования': o.name, 'Установленный режим': _tNormText_(o.setpoint, o.min, o.max, o.unit),
        'Фактическая t°': t, 'Подпись ответственного': who, 'Примечания / корректирующие действия': notes.join('; ') };
  var sh = _book_().getSheetByName(j.sheetName) || _createJournalSheet_(j);
  var line = (j.columns || []).map(function (c) { return c === '№' ? sh.getLastRow() : (vals[c] !== undefined ? vals[c] : ''); });
  _mcJournalAppendTo_(sh, op, src, line);
  var jrow = sh.getLastRow();
  if (journalId === 'J01') _mcMirrorRow_('J01', jrow);   // КТ-5 (J25) — копия, второй вопрос не задаётся
  psh.getRange(row, 9, 1, 8).setValues([['выполнено', ans, t, who, typeof _mcNow_ === 'function' ? _mcNow_() : new Date(), devIds.join(', '), prow[14] || 0, op.id]]);
  if (dev) _notify_('temperature_deviation', 'critical', 'Вне предела: ' + o.name,
    o.name + ': ' + _tFmt_(t) + ' ' + o.unit + (h !== null ? ', влажность ' + h + ' %' : '') + ' (' + _tNormText_(o.setpoint, o.min, o.max, o.unit) + '). Нужны корректирующее действие и повторный замер.',
    'Шеф-повар', 'temp|' + r.measurementId, op);
  _audit_(op, 'JOURNAL_CHECK_TEMP', 'Журналы', d.id, null, { журнал: journalId, объект: o.name, t: t, влажность: h, источник: src, итог: dev ? 'отклонение' : 'норма',
    время_замера: Utilities.formatDate(ev.at, tz, 'dd.MM.yyyy HH:mm'), поздно: late, строка: jrow, замер: r.measurementId });
  _endOp_(op);
  return _ok_({ отклонение: dev, записано: true, температура: t, влажность: h, источник: src, id_замера: r.measurementId, id_отклонения: devIds.join(', '),
    строка_журнала: jrow, позднее_внесение: late,
    следующий_шаг: dev ? 'Корректирующее действие и повторный замер — в разделе «Температуры». До повторного замера в норме отклонение открыто.' : '' }, op.id);
}

function mcRecordTemperature(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'journals', 'TEMP_MEASURE', 'Температуры', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    var o = d.objectId ? _tObjects_().filter(function (x) { return x.id === String(d.objectId) && x.status === 'ACTIVE'; })[0] : null;
    if (d.objectId && !o) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Объект контроля не найден или выведен из работы', op.id); }
    var type = o ? o.type : String(d.type || ''), min = o ? o.min : _tNum_(d.min), max = o ? o.max : _tNum_(d.max);
    if (!o && !MC_T_TYPES_[type]) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Выберите объект контроля или тип процесса', op.id); }
    if (!o && MC_T_SCHEDULED_[type]) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Холодильник, морозильник, склад и витрина замеряются по объекту из реестра (с утверждённым диапазоном)', op.id); }
    if (min === null && max === null) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Нет допустимого диапазона — укажите его по ТТК/инструкции', op.id); }
    var val = _tNum_(d.value);
    if (val === null) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Температура — только число (получено «' + d.value + '»)', op.id); }
    if (val < -60 || val > 350) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Температура ' + val + ' вне физически возможного диапазона', op.id); }
    var eq = d.equipmentId || (o && o.equipmentId) || '';
    if (eq) _mcAssertEquipment_(eq);
    else if (_mcEqList_().some(function (e) { return e.measuring; })) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите прибор (термометр) из реестра', op.id); }
    return _withLock_(function () {
      var s = op.session, b = d.batchId ? _bcFind_(d.batchId) : null;
      if (d.batchId && !b) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Партия не найдена', op.id); }
      var r = _tRecord_({ type: type, object: o ? o.name : String(d.object || MC_T_TYPES_[type]), objectId: o ? o.id : '', equipmentId: eq, min: min, max: max, value: val, unit: (o && o.unit) || d.unit || '°C', batchId: d.batchId || '', source: 'ручной ввод' }, s, op.id);
      // ТЗ §15: отклонение по партии → карантин до повторного замера и решения
      if (r.result === 'DEVIATION' && b && String(b.v[10]) === 'active') { _bcSetStatus_(b, 'quarantine'); r.batchStatus = 'quarantine'; }
      _audit_(op, 'TEMP_MEASURE', 'Температуры', r.measurementId, null, { value: val, min: min, max: max, result: r.result, batch: d.batchId || '' });
      _endOp_(op, 'COMPLETED');
      return _ok_(r, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Повторный замер после корректирующего действия. */
function mcTemperatureRecheck(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'journals', 'TEMP_RECHECK', 'Температуры', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    var act = String(d.correctiveAction || '').trim(), val = _tNum_(d.value);
    if (!act) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Опишите корректирующее действие (что сделано с оборудованием/продукцией)', op.id); }
    if (val === null) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Повторный замер — только число', op.id); }
    return _withLock_(function () {
      var p = _tFind_(d.measurementId);
      if (!p) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Измерение не найдено', op.id); }
      if (p.status !== 'OPEN' && p.status !== 'RECHECK_FAIL') { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Повторный замер нужен только для открытого отклонения', op.id); }
      var eq = d.equipmentId || p.equipmentId || ''; if (eq) _mcAssertEquipment_(eq);
      var typeKey = Object.keys(MC_T_TYPES_).filter(function (k) { return MC_T_TYPES_[k] === p.type; })[0] || p.type;
      var r = _tRecord_({ type: typeKey, object: p.object, objectId: p.objectId, equipmentId: eq, min: p.min, max: p.max, value: val, unit: p.unit, batchId: p.batchId, source: 'повторный замер', parent: p.id, action: act, deviationId: p.deviationId }, op.session, op.id);
      var sh = _tSheet_();
      sh.getRange(p.row, 18).setValue(act);
      sh.getRange(p.row, 20).setValue(r.result === 'OK' ? 'RECHECK_OK' : 'RECHECK_FAIL');
      _audit_(op, 'TEMP_RECHECK', 'Температуры', p.id, p.status, { recheck: r.measurementId, value: val, result: r.result, action: act });
      _endOp_(op, 'COMPLETED');
      return _ok_({ measurementId: p.id, recheckId: r.measurementId, result: r.result, status: r.result === 'OK' ? 'RECHECK_OK' : 'RECHECK_FAIL', next: r.result === 'OK' ? 'Решение ответственного: выпустить или забраковать' : 'Снова вне диапазона — новое корректирующее действие и повторный замер' }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Решение по отклонению: RELEASE (только после повторного замера в норме) или REJECT. */
function mcTemperatureDecision(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'haccp', 'TEMP_DECISION', 'Температуры', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    var dec = String(d.decision || '').toUpperCase(), cm = String(d.comment || '').trim();
    if (dec !== 'RELEASE' && dec !== 'REJECT') { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Решение: RELEASE или REJECT', op.id); }
    if (dec === 'REJECT' && !cm) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите причину брака', op.id); }
    return _withLock_(function () {
      var p = _tFind_(d.measurementId);
      if (!p) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Измерение не найдено', op.id); }
      if (p.decision) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Решение уже принято: ' + p.decision, op.id); }
      if (dec === 'RELEASE' && p.status !== 'RECHECK_OK') { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Выпуск — только после корректирующего действия и повторного замера в норме', op.id); }
      if (p.status === 'CLOSED') { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'По этому измерению отклонения нет', op.id); }
      var sh = _tSheet_(), who = { name: (op.session && (op.session.name || op.session.fullName)) || '', role: (op.session && op.session.role) || '' }, bst = '';
      sh.getRange(p.row, 19).setValue(dec);
      sh.getRange(p.row, 20).setValue(dec === 'RELEASE' ? 'RELEASED' : 'REJECTED');
      if (p.batchId) {
        var b = _bcFind_(p.batchId);
        if (b && String(b.v[10]) !== 'consumed') {
          var before = String(b.v[10]);
          if (dec === 'REJECT') { _bcSetStatus_(b, 'blocked'); bst = 'blocked'; }
          else if (before === 'quarantine' || before === 'recheck') { _bcSetStatus_(b, 'active'); bst = 'active'; }
          try { _bcRelease_(b, 'TEMPERATURE', dec, cm || ('повторный замер ' + p.id), who, op.id, p.factId); } catch (e) {}
        }
      }
      _audit_(op, 'TEMP_DECISION', 'Температуры', p.id, p.status, { decision: dec, comment: cm, batch: p.batchId || '', batchStatus: bst });
      _endOp_(op, 'COMPLETED');
      return _ok_({ measurementId: p.id, decision: dec, batchStatus: bst }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

function mcGetTemperatures(token) {
  try {
    var s = _requireAuth_(token), perm = s.permissions || {};
    var rows = _tRows_().reverse();
    var objs = _tObjects_().map(function (o) { if (MC_T_SCHEDULED_[o.type]) { o.question = _tQuestion_(o); o.checkTimes = _tTimes_(o); o.journalId = MC_T_SCHEDULED_[o.type]; } return o; });
    return _ok_({ objects: objs, types: MC_T_TYPES_, scheduled: MC_T_SCHEDULED_, measurements: rows.slice(0, 400),
      open: rows.filter(function (r) { return r.status === 'OPEN' || r.status === 'RECHECK_FAIL' || r.status === 'RECHECK_OK'; }),
      equipment: _uiTry_(function () { return _mcEqList_().filter(function (e) { return e.measuring; }); }, []),
      canDecide: perm.all === true || perm.haccp === true, canSetup: perm.all === true || perm.haccp === true });
  } catch (e) { return _failFrom_(e); }
}

/** Журнал с температурой (холодильники, склад, термообработка…) → реестр. Диапазон — из графы «режим/норма» самой записи. */
function _tFromJournal_(j, row, factId, actor, equipmentId) {
  var cols = (j.columns || []).map(function (c) { return String(c).toLowerCase(); }), out = [];
  var rc = cols.findIndex(function (c) { return /режим|норма/.test(c); }), oc = cols.findIndex(function (c) { return /оборудован|объект|помещен|холодил|наименован/.test(c); });
  var nm = String(j.name || '').toLowerCase();
  var type = /морозил/.test(nm) ? 'FREEZER' : /холодил/.test(nm) ? 'REFRIGERATOR' : /охлажд/.test(nm) ? 'COOLING' : /термич|термообраб|приготов|фритюр/.test(nm) ? 'COOKING' : /витрин/.test(nm) ? 'DISPLAY' : 'STORAGE';
  cols.forEach(function (c, i) {
    if (!/t°|температур/.test(c) || /режим|норма|способ/.test(c)) return;
    var v = _tNum_(row[i]); if (v === null) return;
    var rg = rc >= 0 ? _tRangeOf_(row[rc]) : { min: null, max: null };
    out.push(_tRecord_({ type: type, object: (oc >= 0 && row[oc]) ? String(row[oc]) : j.name, objectId: j.id, equipmentId: equipmentId, min: rg.min, max: rg.max, value: v, source: 'журнал ' + j.id, factId: factId || '' }, actor, ''));
  });
  return out;
}
