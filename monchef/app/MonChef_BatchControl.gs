/**
 * MON CHEF — контроль партий: входной контроль, карантин, повторный контроль,
 * решение бракеража, допуск партии к выдаче.
 *
 * Статусы партии (лист «Склад_Партии», колонка «Статус»):
 *   quarantine — получена от поставщика, ждёт входного контроля или контроль не пройден;
 *   recheck    — после корректирующего действия, ждёт повторного контроля;
 *   active     — допущена (входной контроль пройден / своё производство);
 *   blocked    — брак (входной контроль, бракераж REJECT), использовать нельзя;
 *   consumed   — израсходована.
 * Всё, что расходует партию (FEFO, отбор, производство, выдача), берёт только
 * active и только не просроченные — остальные статусы недоступны автоматически.
 *
 * Решения принимает человек; система решение ВЫЧИСЛЯЕТ из введённых измерений
 * и не подставляет ни температуру, ни органолептику, ни решение бракеража.
 */
var MC_BC_IN_ = 'Входной_Контроль';
var MC_BC_IN_HEAD_ = ['ControlID', 'BatchID', 'Продукт', 'Источник', 'Документ', 'Этап', 't° факт', 't° мин', 't° макс',
  'Органолептика', 'Упаковка/маркировка', 'Решение', 'Причины', 'Корректирующее действие', 'Сотрудник', 'Роль', 'Время',
  'OperationID', 'FactID', 'DeviationID'];
var MC_BC_REL_ = 'Выпуск_Партий';
var MC_BC_REL_HEAD_ = ['ReleaseID', 'BatchID', 'Продукт', 'Основание', 'Решение', 'Комментарий', 'Сотрудник', 'Роль', 'Время',
  'OperationID', 'FactID'];
var MC_BC_PROP_ = 'MC_INCOMING_CONTROL';   // 'off' — отключить карантин новых партий (по умолчанию включён)

function _bcSheet_(name, head) {
  var ss = _book_(), sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold'); sh.setFrozenRows(1); }
  return sh;
}
function _bcIncomingOn_() {
  try { return String(PropertiesService.getScriptProperties().getProperty(MC_BC_PROP_) || 'on') !== 'off'; } catch (e) { return true; }
}
function _bcToday0_() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
function _bcExpired_(expiry) {
  if (!expiry) return false;
  var d = _parseDate_(expiry);
  return !!(d && d.getTime && d.getTime() < _bcToday0_().getTime());
}
function _bcDate_(x) {
  if (!x) return '';
  var d = x instanceof Date ? x : _parseDate_(x);
  if (!(d instanceof Date) || isNaN(d.getTime())) return String(x);
  var p = function (n) { return ('0' + n).slice(-2); };
  return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear();
}
function _bcNum_(x) { if (x === '' || x === null || x === undefined) return null; var n = parseFloat(String(x).replace(',', '.')); return isFinite(n) ? n : null; }
function _bcFind_(batchId) {
  var sh = _stockBatchesSheet_(), v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(batchId)) return { sh: sh, row: i + 1, v: v[i] };
  return null;
}
function _bcSetStatus_(b, status) { b.sh.getRange(b.row, 11).setValue(status); b.v[10] = status; }
function _bcWho_(token) { var s = _getSession_(token); return { s: s, name: s ? String(s.name || s.fullName || s.user_id || '') : '', role: s ? String(s.role || '') : '' }; }
function _bcFact_(f, s) { try { var r = _mcCreateFactInternal_(f, s); return (r && (r.factId || r.id)) || ''; } catch (e) { return ''; } }
function _bcDeviation_(batchId, product, message, value, s) {
  try {
    if (typeof _mcOpenDeviationAndAction_ === 'function') {
      var d = _mcOpenDeviationAndAction_({ journalId: 'J03', objectId: batchId, batchId: batchId, value: value, critical: true, description: message }, s, 'BATCH_CONTROL', message, 'HIGH');
      return (d && (d.deviationId || d.id)) || '';
    }
  } catch (e) {}
  return '';
}
function _bcRelease_(b, basis, decision, comment, who, opId, factId) {
  var id = 'REL-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  _bcSheet_(MC_BC_REL_, MC_BC_REL_HEAD_).appendRow([id, b.v[0], b.v[1], basis, decision, comment || '', who.name, who.role, new Date(), opId || '', factId || '']);
  return id;
}
function _bcLastControl_(batchId) {
  var sh = _book_().getSheetByName(MC_BC_IN_); if (!sh) return '';
  var v = sh.getDataRange().getValues();
  for (var i = v.length - 1; i >= 1; i--) if (String(v[i][1]) === String(batchId)) return String(v[i][11]);
  return '';
}
// Последнее решение по партии из «Выпуск_Партий» (основание — фильтр, например 'BRAKERAGE')
function _bcLastDecision_(batchId, basis) {
  var sh = _book_().getSheetByName(MC_BC_REL_); if (!sh) return null;
  var v = sh.getDataRange().getValues();
  for (var i = v.length - 1; i >= 1; i--) if (String(v[i][1]) === String(batchId) && (!basis || String(v[i][3]) === basis)) return { decision: String(v[i][4]), at: v[i][8], who: v[i][6] };
  return null;
}
// Незавершённые обязательные проверки ККТ по партии (вопросы «Журналы_Ожидания» с номером партии)
function _bcOpenChecks_(batchId) {
  var sh = _book_().getSheetByName('Журналы_Ожидания'); if (!sh) return [];
  var v = sh.getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][4]).indexOf(String(batchId)) < 0) continue;
    if (!/^J2[2-4]$|^J28$|^J29$|^J30$/.test(String(v[i][2]))) continue;
    if (String(v[i][8]) === 'ожидает') out.push({ id: v[i][0], journal: v[i][2], question: v[i][4], status: 'ожидает' });
    else if (v[i][13]) out.push({ id: v[i][0], journal: v[i][2], question: v[i][4], status: 'отклонение ' + v[i][13] });
  }
  return out;
}

/**
 * Допуск партии к выдаче/использованию как готовой продукции:
 * статус active, срок не истёк, бракераж с решением RELEASE, нет незакрытых ККТ.
 * Возвращает { ok, reasons[] }.
 */
function _bcReleaseState_(batchId) {
  var b = _bcFind_(batchId), reasons = [];
  if (!b) return { ok: false, reasons: ['партия ' + batchId + ' не найдена'] };
  if (String(b.v[10] || 'active') !== 'active') reasons.push('статус партии «' + b.v[10] + '»');
  if (_bcExpired_(b.v[5])) reasons.push('срок годности истёк');
  var br = _bcLastDecision_(batchId, 'BRAKERAGE');
  if (!br) reasons.push('нет бракеража');
  else if (br.decision !== 'RELEASE') reasons.push('бракераж: ' + br.decision);
  if (typeof _dsSampleFor_ === 'function' && !_dsSampleFor_(batchId)) reasons.push('нет суточной пробы');
  var open = _bcOpenChecks_(batchId);
  if (open.length) reasons.push('не выполнены ККТ: ' + open.length);
  return { ok: !reasons.length, reasons: reasons, product: b.v[1] };
}

// Закрыть вопросы входного контроля (J03/J21), заведённые при приходе, ответами из формы
function _bcClosePending_(batchId, vals, who) {
  try {
    var psh = _book_().getSheetByName('Журналы_Ожидания'); if (!psh) return 0;
    var pv = psh.getDataRange().getValues(), n = 0, now = new Date(), rows = {};
    for (var i = 1; i < pv.length; i++) {
      var jid = String(pv[i][2]); if ((jid !== 'J03' && jid !== 'J21') || String(pv[i][8]) !== 'ожидает') continue;
      var j = JOURNALS.filter(function (x) { return x.id === jid; })[0]; if (!j) continue;
      var jsh = _book_().getSheetByName(j.sheetName); var jr = parseInt(pv[i][16], 10); if (!jsh || !(jr > 1)) continue;
      var pc = j.columns.indexOf('Партия'); if (pc < 0 || String(jsh.getRange(jr, pc + 1).getValue()) !== String(batchId)) continue;
      var col = String(pv[i][17] || ''), ci = j.columns.indexOf(col), ans = '', val = '';
      if (/t°/.test(col)) { val = vals.t === null ? 'не требуется' : vals.t; ans = vals.tOk ? 'да' : 'нет'; }
      else if (/органолепт/i.test(col)) { ans = vals.org ? 'да' : 'нет'; val = ans; }
      else if (/решение/i.test(col)) { ans = vals.release ? 'да' : 'нет'; val = vals.release ? 'принято' : 'карантин'; }
      else continue;
      if (ci >= 0) jsh.getRange(jr, ci + 1).setValue(val);
      psh.getRange(i + 1, 9, 1, 5).setValues([['выполнено', ans, val, who.name, now]]);
      if (jid === 'J03') rows[jr] = true;
      n++;
    }
    // этап 10.8: ККТ-1 (J21) — копия строки J03 с теми же ответами
    Object.keys(rows).forEach(function (r) { try { _mcMirrorRow_('J03', Number(r)); } catch (e) {} });
    return n;
  } catch (e) { try { _log_('WARN', 'входной контроль: вопросы J03 не закрыты: ' + e); } catch (x) {} return 0; }
}

/** Список партий под контролем: карантин, повторный контроль, брак, просрочка. */
function mcGetBatchControl(token) {
  try { _requireAuth_(token, 'stock'); return _ok_(_bcControlList_()); } catch (e) { return _failFrom_(e); }
}
function _bcControlList_() {
  {
    var v = _stockBatchesSheet_().getDataRange().getValues(), out = { quarantine: [], recheck: [], blocked: [], expired: [], incomingControl: _bcIncomingOn_() };
    var last = {}; var ic = _book_().getSheetByName(MC_BC_IN_);
    if (ic) ic.getDataRange().getValues().slice(1).forEach(function (r) { last[String(r[1])] = { decision: r[11], reasons: r[12], at: _bcDate_(r[16]) }; });
    for (var i = 1; i < v.length; i++) {
      var r = v[i]; if (!r[0] || !r[1]) continue;
      var st = String(r[10] || 'active'), remain = parseFloat(r[9]) || 0;
      var item = { batchId: r[0], product: r[1], unit: r[2], qty: remain, received: _bcDate_(r[4]), expiry: _bcDate_(r[5]),
        source: r[7], docRef: r[13] || '', supplierBatch: r[12] || '', status: st, last: last[String(r[0])] || null };
      if (st === 'quarantine') out.quarantine.push(item);
      else if (st === 'recheck') out.recheck.push(item);
      else if (st === 'blocked' && remain > 0) out.blocked.push(item);
      else if (st === 'active' && remain > 0 && _bcExpired_(r[5])) out.expired.push(item);
    }
    return out;
  }
}

/**
 * Входной (или повторный) контроль партии. Решение вычисляется сервером:
 *  RELEASED   — t° в заданном пределе (или t° не требуется с указанной причиной),
 *               органолептика и упаковка соответствуют, есть документ;
 *  QUARANTINE — иначе: партия недоступна, открывается отклонение.
 * json: { batchId, temperature, tMin, tMax, tempNotRequired, tempReason, organoleptic:'PASS'|'FAIL',
 *         packaging:'PASS'|'FAIL', docRef, correctiveAction (обязательно на повторном контроле) }
 */
function mcRecordIncomingControl(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock', 'INCOMING_CONTROL', 'Партия', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    return _withLock_(function () {
      var b = _bcFind_(d.batchId);
      if (!b) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Партия не найдена', op.id); }
      var st = String(b.v[10] || 'active');
      if (st !== 'quarantine' && st !== 'recheck') { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Партия не ждёт контроля (статус «' + st + '»)', op.id); }
      var stage = st === 'recheck' ? 'RECHECK' : 'INCOMING';
      if (stage === 'INCOMING' && _bcLastControl_(b.v[0]) === 'QUARANTINE') { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Партия уже не прошла входной контроль. Сначала зафиксируйте корректирующее действие и отправьте её на повторный контроль — или признайте браком', op.id); }
      var t = _bcNum_(d.temperature), tMin = _bcNum_(d.tMin), tMax = _bcNum_(d.tMax);
      var noT = d.tempNotRequired === true || d.tempNotRequired === 'true';
      if (!noT && t === null) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Введите измеренную температуру (числом) или отметьте, что для этого товара она не требуется', op.id); }
      if (!noT && (t < -60 || t > 100)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Температура ' + t + ' °C невозможна для приёмки — проверьте прибор и ввод', op.id); }
      if (!noT && tMin === null && tMax === null) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите допустимый диапазон температуры для этого товара', op.id); }
      if (noT && !String(d.tempReason || '').trim()) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите, почему температура не измеряется (например, бакалея при комнатной t°)', op.id); }
      if (d.organoleptic !== 'PASS' && d.organoleptic !== 'FAIL') { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Отметьте органолептику: соответствует / не соответствует', op.id); }
      if (d.packaging !== 'PASS' && d.packaging !== 'FAIL') { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Отметьте упаковку и маркировку: соответствует / не соответствует', op.id); }
      var doc = String(d.docRef || b.v[13] || '').trim();
      if (!noT) {
        if (d.equipmentId) { var eqU = _mcEquipmentUsable_(d.equipmentId); if (!eqU.ok) { _endOp_(op, 'FAILED'); return _fail_('EQUIPMENT_BLOCKED', 'Измерение не принимается — ' + eqU.reason, op.id); } }
        else if (_mcEqList_().some(function (x) { return x.measuring && x.effective === 'ACTIVE'; })) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Выберите термометр, которым измеряли (из реестра приборов)', op.id); }
      }
      if (stage === 'RECHECK' && !String(d.correctiveAction || '').trim()) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Повторный контроль: опишите выполненное корректирующее действие', op.id); }
      var who = _bcWho_(token), reasons = [];
      var tOk = noT || ((tMin === null || t >= tMin) && (tMax === null || t <= tMax));
      if (!tOk) reasons.push('t° ' + t + ' °C вне ' + (tMin === null ? '' : 'от ' + tMin + ' ') + (tMax === null ? '' : 'до ' + tMax) + ' °C');
      if (d.organoleptic === 'FAIL') reasons.push('органолептика не соответствует');
      if (d.packaging === 'FAIL') reasons.push('упаковка/маркировка не соответствует');
      if (!doc) reasons.push('нет сопроводительного документа');
      // ТЗ §5–6: ветконтроль (REQUIRES_VET_DOCUMENT) и сроки документов на сырьё
      try { if (typeof _sdIncomingReasons_ === 'function') _sdIncomingReasons_(b).forEach(function (x) { reasons.push(x); }); } catch (eSd) {}
      try {
        var supId = String(b.sh.getRange(b.row, MC_BATCH_ID_COLS_.supplier).getValue() || '');
        var sup = supId ? _mdSuppliers_().filter(function (x) { return x.id === supId; })[0] : null;
        if (sup && sup.status === 'BLOCKED') reasons.push('поставщик «' + sup.name + '» заблокирован');
      } catch (eSup) {}
      var release = !reasons.length;
      // этап 10.7: проверки повара пройдены, не погашен только ВСД — партия ждёт гашения ответственным за ХАССП (без отклонения);
      // после гашения допускается сама (MonChef_VsdTasks.gs)
      var holdVsd = !release && _vtVetOnly_(reasons);
      var factId = _bcFact_({ factType: 'INCOMING_CONTROL', objectType: 'BATCH', objectId: b.v[0], operationType: stage, dateTime: new Date(),
        value: noT ? 'не требуется: ' + d.tempReason : t, unit: noT ? '' : '°C', result: release || holdVsd ? 'PASS' : 'FAIL', source: 'BATCH_CONTROL', batchId: b.v[0],
        employeeName: who.name, description: (stage === 'RECHECK' ? 'Повторный' : 'Входной') + ' контроль ' + b.v[1] + (holdVsd ? ': проверки пройдены, ждёт гашения ВСД' : reasons.length ? ': ' + reasons.join('; ') : '') }, who.s);
      var devId = release || holdVsd ? '' : _bcDeviation_(b.v[0], b.v[1], 'Входной контроль «' + b.v[1] + '» не пройден: ' + reasons.join('; '), noT ? '' : t, who.s);
      _bcSetStatus_(b, release ? 'active' : 'quarantine');
      var cid = 'IC-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
      _bcSheet_(MC_BC_IN_, MC_BC_IN_HEAD_).appendRow([cid, b.v[0], b.v[1], b.v[7], doc, stage, noT ? 'не требуется: ' + d.tempReason : t, tMin === null ? '' : tMin, tMax === null ? '' : tMax,
        d.organoleptic, d.packaging, release ? 'RELEASED' : holdVsd ? 'HOLD_VSD' : 'QUARANTINE', reasons.join('; '), d.correctiveAction || '', who.name, who.role, new Date(), op.id, factId, devId]);
      if (release) _bcRelease_(b, stage, 'RELEASE', 'входной контроль пройден', who, op.id, factId);
      if (!noT && typeof _tMirror_ === 'function') _tMirror_({ type: 'INCOMING', object: b.v[1], objectId: b.v[0], equipmentId: d.equipmentId || '', min: tMin, max: tMax, value: t, batchId: b.v[0], source: 'входной контроль', factId: factId, deviationId: devId, op: op.id }, who.s);
      _bcClosePending_(b.v[0], { t: noT ? null : t, tOk: tOk, org: d.organoleptic === 'PASS', release: release }, who);
      var decision = release ? 'RELEASED' : holdVsd ? 'HOLD_VSD' : 'QUARANTINE';
      if (holdVsd) try { _vtRefreshBatches_([b.v[0]], op); } catch (eVt) {}
      _audit_(op, 'INCOMING_CONTROL', 'Партия', b.v[0], st, { decision: decision, reasons: reasons, t: t });
      _endOp_(op, 'COMPLETED');
      return _ok_({ batchId: b.v[0], decision: decision, reasons: reasons, controlId: cid, factId: factId, deviationId: devId,
        note: holdVsd ? 'Проверки пройдены. Партия ждёт гашения ВСД ответственным за ХАССП и допустится сама после гашения.' : '' }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Карантин → повторный контроль: фиксируется корректирующее действие. */
function mcSendBatchToRecheck(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock', 'BATCH_RECHECK', 'Партия', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    var act = String(d.correctiveAction || '').trim();
    if (!act) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Опишите корректирующее действие (например, «партия охлаждена до +2 °C»)', op.id); }
    return _withLock_(function () {
      var b = _bcFind_(d.batchId);
      if (!b) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Партия не найдена', op.id); }
      if (String(b.v[10]) !== 'quarantine') { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'На повторный контроль отправляется только партия в карантине', op.id); }
      var who = _bcWho_(token);
      _bcSetStatus_(b, 'recheck');
      var factId = _bcFact_({ factType: 'CORRECTIVE_ACTION', objectType: 'BATCH', objectId: b.v[0], operationType: 'RECHECK_REQUEST', dateTime: new Date(),
        value: act, result: 'RECORDED', source: 'BATCH_CONTROL', batchId: b.v[0], employeeName: who.name, description: 'Корректирующее действие по партии ' + b.v[1] + ': ' + act }, who.s);
      _bcRelease_(b, 'CORRECTIVE_ACTION', 'RECHECK', act, who, op.id, factId);
      _audit_(op, 'BATCH_RECHECK', 'Партия', b.v[0], 'quarantine', { status: 'recheck', action: act });
      _endOp_(op, 'COMPLETED');
      return _ok_({ batchId: b.v[0], status: 'recheck', factId: factId }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Брак: партия блокируется (использовать нельзя), остаток остаётся до утилизации/возврата. */
function mcRejectBatch(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock', 'BATCH_REJECT', 'Партия', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    var reason = String(d.reason || '').trim();
    if (!reason) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите причину брака', op.id); }
    return _withLock_(function () {
      var b = _bcFind_(d.batchId);
      if (!b) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Партия не найдена', op.id); }
      var before = String(b.v[10] || 'active'), who = _bcWho_(token);
      if (before === 'consumed') { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Партия уже израсходована', op.id); }
      _bcSetStatus_(b, 'blocked');
      var factId = _bcFact_({ factType: 'BATCH_REJECT', objectType: 'BATCH', objectId: b.v[0], operationType: 'REJECT', dateTime: new Date(), value: reason,
        result: 'REJECT', source: 'BATCH_CONTROL', batchId: b.v[0], employeeName: who.name, description: 'Брак партии ' + b.v[1] + ': ' + reason }, who.s);
      _bcRelease_(b, 'REJECT', 'REJECT', reason, who, op.id, factId);
      _audit_(op, 'BATCH_REJECT', 'Партия', b.v[0], before, { status: 'blocked', reason: reason });
      _endOp_(op, 'COMPLETED');
      return _ok_({ batchId: b.v[0], status: 'blocked', factId: factId }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Партии продукта для бракеража: допущенные/на доработке, с текущим решением. */
function mcGetBatchesForBrakerage(name, token) {
  try {
    _requireAuth_(token, 'journals');
    var key = _prodKey_(name), v = _stockBatchesSheet_().getDataRange().getValues(), out = [];
    for (var i = v.length - 1; i >= 1; i--) {
      var r = v[i]; if (!r[0] || _prodKey_(r[1]) !== key) continue;
      var st = String(r[10] || 'active'); if (st !== 'active' && st !== 'recheck') continue;
      if (!(parseFloat(r[9]) > 0)) continue;
      var br = _bcLastDecision_(r[0], 'BRAKERAGE');
      out.push({ batchId: r[0], qty: parseFloat(r[9]) || 0, unit: r[2], made: _bcDate_(r[11] || r[4]), expiry: _bcDate_(r[5]),
        status: st, brakerage: br ? br.decision : '' });
      if (out.length >= 30) break;
    }
    return _ok_(out);
  } catch (e) { return _failFrom_(e); }
}

/** Допуск партии к выдаче — для экранов (почему нельзя выдать). */
function mcGetBatchRelease(batchId, token) {
  try { _requireAuth_(token, 'journals'); return _ok_(_bcReleaseState_(batchId)); } catch (e) { return _failFrom_(e); }
}

/** Включить/выключить карантин новых партий от поставщика (только администратор). */
function mcSetIncomingControlMode(on, token) {
  try {
    var s = _requireAuth_(token, 'personnel');
    if (!s.dev) throw new Error('FORBIDDEN: 403 — только технический доступ');
    PropertiesService.getScriptProperties().setProperty(MC_BC_PROP_, on === false || on === 'off' ? 'off' : 'on');
    try { _audit_({ id: '', session: s }, 'INCOMING_CONTROL_MODE', 'Настройки', MC_BC_PROP_, null, { on: _bcIncomingOn_() }); } catch (e) {}
    return _ok_({ incomingControl: _bcIncomingOn_() });
  } catch (e) { return _failFrom_(e); }
}
