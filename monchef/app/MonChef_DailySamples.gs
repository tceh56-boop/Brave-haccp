/**
 * MON CHEF — суточные пробы.
 *
 * Проба всегда привязана к реальной партии готовой продукции (лист «Склад_Партии»).
 * Сервер контролирует: отобрана ли проба по допущенной к выдаче партии, масса,
 * место и температура хранения, срок хранения и уничтожение не раньше срока.
 * Параметры (масса, срок, температура) берутся из настроек «Настройки_Пробы»;
 * значения по умолчанию — из действующего СанПиН, проверьте их по нормативному реестру.
 * Без пробы партия готовой продукции на банкет не выдаётся (см. _bcReleaseState_).
 */
var MC_DS_SHEET_ = 'Суточные_Пробы';
var MC_DS_HEAD_ = ['SampleID', 'BatchID', 'Блюдо', 'Масса, г', 'Порция целиком', 'Тара', 'Место хранения', 't° хранения', 'Прибор',
  'Ответственный', 'Роль', 'Отобрана', 'Хранить до', 'Статус', 'Уничтожена', 'Кто уничтожил', 'OperationID', 'FactID'];
var MC_DS_DEFAULTS_ = { minWeightG: 100, retentionHours: 48, tMin: 2, tMax: 6 };

function _dsSheet_() { return _bcSheet_(MC_DS_SHEET_, MC_DS_HEAD_); }
function _dsCfg_() {
  var c = {}; Object.keys(MC_DS_DEFAULTS_).forEach(function (k) { c[k] = MC_DS_DEFAULTS_[k]; });
  try {
    var p = PropertiesService.getScriptProperties().getProperty('MC_DAILY_SAMPLE_CFG');
    if (p) { var o = JSON.parse(p); Object.keys(o).forEach(function (k) { if (isFinite(Number(o[k]))) c[k] = Number(o[k]); }); }
  } catch (e) {}
  return c;
}
function _dsRows_() {
  var v = _dsSheet_().getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) if (v[i][0]) out.push({ row: i + 1, id: v[i][0], batchId: String(v[i][1]), dish: v[i][2], weight: v[i][3], portion: v[i][4],
    container: v[i][5], location: v[i][6], temp: v[i][7], equipment: v[i][8], who: v[i][9], taken: v[i][11], until: v[i][12], status: String(v[i][13]),
    destroyed: v[i][14], destroyedBy: v[i][15] });
  return out;
}
/** Есть ли проба по партии (на хранении или уничтоженная по сроку). */
function _dsSampleFor_(batchId) {
  return _dsRows_().filter(function (x) { return x.batchId === String(batchId) && x.status !== 'CANCELLED'; })[0] || null;
}

/** Отбор пробы. json: { batchId, weight, portion, container, location, temperature, equipmentId } */
function mcTakeDailySample(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'journals', 'DAILY_SAMPLE_TAKE', 'Суточная проба', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), cfg = _dsCfg_();
    return _withLock_(function () {
      var b = _bcFind_(d.batchId);
      if (!b) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Партия не найдена — проба отбирается только от реальной партии', op.id); }
      if (String(b.v[10]) === 'blocked') { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Партия забракована — проба не отбирается', op.id); }
      var prev = _dsSampleFor_(b.v[0]);
      if (prev) { _endOp_(op, 'FAILED'); return _fail_('DUPLICATE', 'Проба по этой партии уже отобрана: ' + prev.id, op.id); }
      var portion = d.portion === true || d.portion === 'true', w = _bcNum_(d.weight), t = _bcNum_(d.temperature);
      if (!portion && (w === null || w < cfg.minWeightG)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Масса пробы должна быть не менее ' + cfg.minWeightG + ' г (или отметьте «порция целиком»)', op.id); }
      if (!String(d.container || '').trim()) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите тару (стерильная ёмкость с крышкой, маркировка)', op.id); }
      if (!String(d.location || '').trim()) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите место хранения (холодильник для проб)', op.id); }
      if (t === null) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Введите измеренную температуру в холодильнике для проб', op.id); }
      if (t < cfg.tMin || t > cfg.tMax) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Температура хранения проб ' + t + ' °C вне ' + cfg.tMin + '…' + cfg.tMax + ' °C — переложите пробу в исправный холодильник', op.id); }
      if (d.equipmentId) { var eq = _mcEquipmentUsable_(d.equipmentId); if (!eq.ok) { _endOp_(op, 'FAILED'); return _fail_('EQUIPMENT_BLOCKED', 'Измерение не принимается — ' + eq.reason, op.id); } }
      var who = _bcWho_(token), now = new Date(), until = new Date(now.getTime() + cfg.retentionHours * 3600000);
      var id = 'DS-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
      var factId = _bcFact_({ factType: 'DAILY_SAMPLE', objectType: 'BATCH', objectId: b.v[0], operationType: 'TAKE', dateTime: now, value: portion ? 'порция' : w,
        unit: portion ? '' : 'г', result: 'STORED', source: 'DAILY_SAMPLES', batchId: b.v[0], equipmentId: d.equipmentId || '', employeeName: who.name,
        description: 'Суточная проба ' + b.v[1] + ', хранить до ' + _bcDate_(until) + ', t° ' + t + ' °C' }, who.s);
      if (typeof _tMirror_ === 'function') _tMirror_({ type: 'SAMPLE', object: d.location, objectId: id, equipmentId: d.equipmentId || '', min: cfg.tMin, max: cfg.tMax, value: t, batchId: b.v[0], source: 'суточная проба', factId: factId, op: op.id }, who.s);
      _dsSheet_().appendRow([id, b.v[0], b.v[1], portion ? '' : w, portion ? 'да' : 'нет', d.container, d.location, t, d.equipmentId || '', who.name, who.role, now, until, 'STORED', '', '', op.id, factId]);
      try { _mcCreateTraceLink_('BATCH', String(b.v[0]), 'ОТОБРАНА_ПРОБА', 'DAILY_SAMPLE', id, { dateTime: now, actor: who.name, source: 'DAILY_SAMPLES' }); } catch (e) {}
      _audit_(op, 'DAILY_SAMPLE_TAKE', 'Суточная проба', id, null, { batchId: b.v[0], weight: w, t: t, until: until });
      _endOp_(op, 'COMPLETED');
      return _ok_({ sampleId: id, batchId: b.v[0], keepUntil: _bcDate_(until), factId: factId }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Уничтожение пробы — не раньше окончания срока хранения. */
function mcDestroyDailySample(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'journals', 'DAILY_SAMPLE_DESTROY', 'Суточная проба', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    return _withLock_(function () {
      var x = _dsRows_().filter(function (r) { return r.id === d.sampleId; })[0];
      if (!x) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Проба не найдена', op.id); }
      if (x.status !== 'STORED') { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Проба уже ' + (x.status === 'DESTROYED' ? 'уничтожена' : x.status), op.id); }
      var until = x.until instanceof Date ? x.until : _parseDate_(x.until);
      if (until && until.getTime() > Date.now()) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Срок хранения пробы ещё не истёк (до ' + _bcDate_(until) + ') — уничтожать нельзя', op.id); }
      var who = _bcWho_(token), sh = _dsSheet_();
      sh.getRange(x.row, 14, 1, 3).setValues([['DESTROYED', new Date(), who.name]]);
      _bcFact_({ factType: 'DAILY_SAMPLE', objectType: 'DAILY_SAMPLE', objectId: x.id, operationType: 'DESTROY', dateTime: new Date(), value: '', result: 'DESTROYED',
        source: 'DAILY_SAMPLES', batchId: x.batchId, employeeName: who.name, description: 'Уничтожена суточная проба ' + x.dish }, who.s);
      _audit_(op, 'DAILY_SAMPLE_DESTROY', 'Суточная проба', x.id, 'STORED', 'DESTROYED');
      _endOp_(op, 'COMPLETED');
      return _ok_({ sampleId: x.id, status: 'DESTROYED' }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Партии, по которым нужна проба: бракераж RELEASE за последние 3 суток, пробы нет. */
function _dsMissing_() {
  var rel = _book_().getSheetByName(MC_BC_REL_), out = [], seen = {}, since = Date.now() - 3 * 86400000;
  if (!rel) return out;
  var v = rel.getDataRange().getValues(), have = {};
  _dsRows_().forEach(function (x) { have[x.batchId] = true; });
  for (var i = v.length - 1; i >= 1; i--) {
    if (String(v[i][3]) !== 'BRAKERAGE' || String(v[i][4]) !== 'RELEASE') continue;
    var at = v[i][8] instanceof Date ? v[i][8].getTime() : 0; if (at && at < since) continue;
    var bid = String(v[i][1]); if (seen[bid] || have[bid]) continue; seen[bid] = true;
    var b = _bcFind_(bid); if (!b || String(b.v[10]) === 'blocked') continue;
    out.push({ batchId: bid, dish: v[i][2], released: _bcDate_(v[i][8]), qty: b.v[9], unit: b.v[2] });
  }
  return out;
}
function _dsState_() {
  var now = Date.now(), cfg = _dsCfg_();
  var rows = _dsRows_().map(function (x) {
    var until = x.until instanceof Date ? x.until : _parseDate_(x.until);
    return { id: x.id, batchId: x.batchId, dish: x.dish, weight: x.portion === 'да' ? 'порция' : x.weight, container: x.container, location: x.location, temp: x.temp,
      who: x.who, taken: _bcDate_(x.taken), until: _bcDate_(until), status: x.status, destroyed: _bcDate_(x.destroyed), destroyedBy: x.destroyedBy,
      due: x.status === 'STORED' && until && until.getTime() <= now };
  }).reverse();
  return { missing: _dsMissing_(), stored: rows.filter(function (x) { return x.status === 'STORED'; }), destroyed: rows.filter(function (x) { return x.status === 'DESTROYED'; }).slice(0, 100), cfg: cfg };
}
function mcGetDailySamples(token) { try { _requireAuth_(token, 'journals'); return _ok_(_dsState_()); } catch (e) { return _failFrom_(e); } }
