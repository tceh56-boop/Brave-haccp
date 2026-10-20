/**
 * MON CHEF — жизненный цикл партии: одна партия — один источник истины — одна история.
 *
 * Партия живёт в «Склад_Партии» (остаток, действующий срок, статус хранения, место, ProductID/SupplierID);
 * паспорт партии — «Приёмка_Партии» (накладная, оригинальная этикетка, производитель, срок производителя,
 * цена, принял, вскрытие); история — «Партии_События» (только дописывание, цепочка хешей, исправление —
 * отдельной операцией CORRECTION). Прослеживаемость — общий граф связей (_mcTraceGraph_), аудит — Audit_Log.
 * Параллельной системы партий нет.
 *
 * Статусы для людей (§28) выводятся из статуса хранения и истории, чтобы не ломать FEFO, производство и
 * выдачу, которые берут только «active»:
 *   quarantine/recheck → QUARANTINE; active → ACTIVE / OPENED / PARTIALLY_USED / EXPIRED (срок истёк);
 *   blocked → BLOCKED; returned → RETURNED; consumed → CONSUMED или WASTED (если обнулило списание);
 *   expired (списана по сроку) → EXPIRED.
 *
 * Сроки: срок производителя хранится как есть (паспорт); действующий срок партии (колонка «Срок годности»)
 * после вскрытия = min(срок производителя, вскрытие + срок после вскрытия). Срок после вскрытия берётся:
 * 1) с этикетки производителя; 2) из профиля хранения продукта (утверждён ответственным);
 * 3) из утверждённого правила HACCP (V38, APPROVED). Иначе — «не определён, нужно решение ответственного».
 * Сотрудник, роль, время, номер партии и OperationID определяет только сервер.
 */
var MC_BL_EV_ = 'Партии_События';
var MC_BL_EV_HEAD_ = ['EventID', 'OperationID', 'BatchID', 'Тип', 'Время', 'EmployeeID', 'Сотрудник', 'Роль', 'До', 'После', 'Кол-во', 'Ед.',
  'Откуда', 'Куда', 'Причина', 'Документ', 'Результат', 'Корректирует', 'Hash'];
var MC_BL_PROF_ = 'Продукты_Хранение';
var MC_BL_PROF_HEAD_ = ['ProductID', 'Продукт', 'Тип хранения', 'Место по умолчанию', 'Допустимые места', 't мин', 't макс', 'Срок хранения, ч',
  'Срок после вскрытия, ч', 'Основание срока после вскрытия', 'FEFO', 'Нужна оригинальная этикетка', 'Нужна этикетка вскрытия', 'Единицы', 'Кто', 'Обновлено',
  'Основание срока хранения', 'Срок с этикетки сырья', 'Срок после размораживания, ч', 'Основание срока после размораживания', 'Дефрост, ч'];
var MC_BL_EVT_RU_ = { BATCH_CREATED: 'Партия создана', LABEL_SCANNED: 'Этикетка сфотографирована', LABEL_OCR: 'Этикетка распознана',
  LABEL_CONFIRMED: 'Данные этикетки подтверждены', RECEIVE: 'Принята', STORAGE_ASSIGNED: 'Размещена', MOVE: 'Перемещена',
  OPEN_CONTAINER: 'Тара вскрыта', RECALCULATE_EXPIRY: 'Срок пересчитан', LABEL_PRINT: 'Этикетка напечатана', BATCH_SPLIT: 'Разделена',
  BATCH_USE: 'Использована (остаток 0)', BATCH_PARTIAL_USE: 'Использована частично', BATCH_WASTE: 'Списана', BATCH_RETURN: 'Возврат поставщику',
  BATCH_BLOCK: 'Заблокирована', BATCH_RELEASE: 'Допущена', BATCH_EXPIRED: 'Срок истёк', CORRECTION: 'Корректировка',
  RECEIVE_ROLLBACK: 'Приёмка отменена — ошибка записи', INCOMING_CONTROL: 'Входной контроль', PRODUCTION: 'Производство',
  PROCESSED: 'Обработана (зачистка / разбор)', PROCESSING_WASTE: 'Отходы обработки', DEFROST_START: 'Дефрост начат', DEFROST_MEASURE: 'Замер t° в толще (дефрост)',
  DEFROST_FINISH: 'Разморожена', DEFROST_DEVIATION: 'Дефрост: отклонение ККТ', EXPIRY_DECISION: 'Срок утверждён ответственным',
  VSD_LINKED: 'ВСД привязан', VSD_CANCELLED: 'ВСД погашен', VSD_CANCEL_FAILED: 'ВСД не погашен', VSD_REJECTED: 'ВСД отклонён', VSD_UNLINKED: 'ВСД отвязан' };
var MC_BL_ST_RU_ = { DEFROSTING: 'дефрост идёт', HOLD: 'ждёт решения по сроку', CREATED: 'создана', QUARANTINE: 'карантин', ACTIVE: 'допущена', OPENED: 'вскрыта', PARTIALLY_USED: 'частично использована',
  EXPIRED: 'срок истёк', BLOCKED: 'заблокирована', REJECTED: 'брак', RETURNED: 'возвращена поставщику', CONSUMED: 'израсходована', WASTED: 'списана' };
var MC_BL_TYPE_RU_ = { FRIDGE: 'холодильник', FREEZER: 'морозильник', DRY: 'сухой склад', PRODUCE: 'овощи и фрукты', EQUIPMENT: 'оборудование' };

function _mcBlEvSheet_() { return _bcSheet_(MC_BL_EV_, MC_BL_EV_HEAD_); }
function _mcBlProfSheet_() {
  var sh = _bcSheet_(MC_BL_PROF_, MC_BL_PROF_HEAD_);
  if (String(sh.getRange(1, MC_BL_PROF_HEAD_.length).getValue() || '') !== MC_BL_PROF_HEAD_[MC_BL_PROF_HEAD_.length - 1]) sh.getRange(1, 1, 1, MC_BL_PROF_HEAD_.length).setValues([MC_BL_PROF_HEAD_]);   // лист этапа 10.4 — дописать колонки
  return sh;
}
function _mcBlP2_(n) { return ('0' + n).slice(-2); }
function _mcBlYmd_(d) { return d.getFullYear() + _mcBlP2_(d.getMonth() + 1) + _mcBlP2_(d.getDate()); }
function _mcBlNum_(x) { var n = parseFloat(String(x === null || x === undefined ? '' : x).replace(',', '.')); return isFinite(n) ? n : 0; }
function _mcBlDate_(x) { if (!x) return null; if (x instanceof Date) return isNaN(x.getTime()) ? null : x; var d = new Date(x); if (!isNaN(d.getTime()) && /T|:/.test(String(x))) return d; var p = _parseDate_(x); return p || null; }
function _mcBlJson_(x) { if (x && typeof x === 'object') return x; try { return JSON.parse(x || '{}'); } catch (e) { return {}; } }
function _mcBlHash_(s) { return _bkHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)); }

/** Права: хотя бы одно из списка (повар использует партию по праву «канбан», кладовщик — по «склад»). */
function _mcBlAuth_(token, rights) {
  var s = _requireAuth_(token, null);
  if (_mcRbHas_(s, rights.join('|'))) return s;   // этап 10.7: права роли + индивидуальные; старые ключи понимаются
  throw new Error('FORBIDDEN: недостаточно прав для операции «' + rights.join(' / ') + '»');
}
function _mcBlOp_(token, rights, type, batchId) {
  _mcBlAuth_(token, rights);
  return _beginOp_(token, null, type, 'Партия', batchId || null, null);
}

/** Запись истории партии: только дописывание, хеш связывает запись с предыдущей. */
function _mcBlEvent_(op, batchId, type, o) {
  o = o || {};
  var sh = _mcBlEvSheet_(), who = _author_(op), now = new Date(), prev = '', mk = '#CHAIN:' + MC_BL_EV_;
  // запись пачкой: внутри критической секции хеш последнего события помнится; иначе — одна ячейка с листа
  // (через кэш чтения getValue загружал весь лист событий на каждое событие)
  if (_LOCK_DEPTH > 0 && _MC_RC_[mk] !== undefined) prev = _MC_RC_[mk];
  else {
    _mcWbFlush_(MC_BL_EV_);
    var raw = _mcRcRaw_(sh), last = raw.getLastRow(), keep = _MC_CHAIN_LAST_[MC_BL_EV_];
    if (keep && keep.row === last && last > 1) prev = keep.hash;   // последняя строка — наша, хеш известен
    else if (last > 1) { try { prev = String(raw.getRange(last, MC_BL_EV_HEAD_.length).getValue() || ''); } catch (e) {} }
    _MC_RC_['#CHAINROW:' + MC_BL_EV_] = last;
  }
  var id = 'EV-' + _mcBlYmd_(now) + '-' + Utilities.getUuid().slice(0, 8);
  var js = function (x) { return x === undefined || x === null || x === '' ? '' : (typeof x === 'string' ? x : JSON.stringify(x)); };
  var row = [id, (op && op.id) || '', String(batchId), type, now, who.id, who.фио, who.роль, js(o.before), js(o.after),
    o.qty === undefined ? '' : o.qty, o.unit || '', o.from || '', o.to || '', o.reason || '', o.doc || '', o.result || 'OK', o.corrects || ''];
  row.push(_mcBlHash_(prev + '|' + row.map(function (x) { return x instanceof Date ? x.toISOString() : String(x); }).join('|')));
  sh.appendRow(row);
  if (_LOCK_DEPTH > 0) _MC_RC_[mk] = row[row.length - 1];
  var rowNo = (_MC_RC_['#CHAINROW:' + MC_BL_EV_] || 0) + 1; _MC_RC_['#CHAINROW:' + MC_BL_EV_] = rowNo;
  _MC_CHAIN_LAST_[MC_BL_EV_] = { row: rowNo, hash: row[row.length - 1] };
  return id;
}
function _mcBlEvents_(batchId) {
  var v = _mcBlEvSheet_().getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) if (String(v[i][2]) === String(batchId)) out.push({ id: v[i][0], op: v[i][1], type: v[i][3], at: v[i][4], employeeId: v[i][5], who: v[i][6], role: v[i][7],
    before: v[i][8], after: v[i][9], qty: v[i][10], unit: v[i][11], from: v[i][12], to: v[i][13], reason: v[i][14], doc: v[i][15], result: v[i][16], corrects: v[i][17] });
  return out;
}
/** Целостность истории: пересчёт цепочки хешей. */
function _mcBlChainOk_() {
  var v = _mcBlEvSheet_().getDataRange().getValues(), prev = '';
  for (var i = 1; i < v.length; i++) {
    var row = v[i].slice(0, MC_BL_EV_HEAD_.length - 1);
    var h = _mcBlHash_(prev + '|' + row.map(function (x) { return x instanceof Date ? x.toISOString() : String(x); }).join('|'));
    if (h !== String(v[i][MC_BL_EV_HEAD_.length - 1])) return { ok: false, row: i + 1 };
    prev = h;
  }
  return { ok: true, rows: v.length - 1 };
}

/* ---------- места хранения (Склад_Места_V22) и профиль хранения продукта ---------- */
function _mcBlLocations_() {
  var v = _mcV22Locations_().getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) if (v[i][0]) out.push({ id: String(v[i][0]), name: String(v[i][1] || v[i][0]), type: String(v[i][2] || ''), tmin: v[i][3] === '' ? null : Number(v[i][3]),
    tmax: v[i][4] === '' ? null : Number(v[i][4]), active: String(v[i][6] || 'ACTIVE') === 'ACTIVE' });
  return out;
}
function _mcBlLoc_(id) { var l = _mcBlLocations_().filter(function (x) { return x.id === String(id); })[0]; return l || null; }
function _mcBlLocName_(id) { if (!id) return ''; var l = _mcBlLoc_(id); return l ? l.name : String(id); }
function _mcBlRange_(min, max) {
  var f = function (n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n); };
  if (min !== null && min !== '' && max !== null && max !== '' && Number(min) !== Number(max)) return f(Number(min)) + '…' + f(Number(max)) + ' °C';
  if (max !== null && max !== '' && max !== undefined) return 'не выше ' + f(Number(max)) + ' °C';
  if (min !== null && min !== '' && min !== undefined) return 'не ниже ' + f(Number(min)) + ' °C';
  return '';
}
/** Тип хранения: по температуре с этикетки → по профилю → по режиму матрицы. */
function _mcBlStorageType_(label, profile, mode) {
  if (label && label.storage_mode) { if (label.storage_mode === 'FROZEN') return 'FREEZER'; if (label.storage_mode === 'CHILLED') return 'FRIDGE'; }
  if (profile && profile.type) return profile.type;
  return { fridge: 'FRIDGE', freezer: 'FREEZER', room: 'DRY' }[mode] || '';
}
function _mcBlTypeFits_(storageType, locType) {
  if (!storageType || !locType) return true;
  if (storageType === 'FREEZER') return locType === 'FREEZER';
  if (storageType === 'FRIDGE') return locType === 'FRIDGE' || locType === 'PRODUCE';
  if (storageType === 'DRY') return locType === 'DRY';
  return true;
}
/** Проверка §37: температура хранения с этикетки против диапазона места. */
function _mcBlTempConflict_(tmin, tmax, loc) {
  if (!loc) return '';
  var lmax = loc.tmax, lmin = loc.tmin;
  if (tmax !== null && tmax !== '' && tmax !== undefined && lmax !== null && Number(lmax) > Number(tmax))
    return 'на этикетке хранить ' + _mcBlRange_(tmin, tmax) + ', а «' + loc.name + '» держит ' + _mcBlRange_(lmin, lmax);
  // нижняя граница важна только охлаждённому продукту (0…+4 нельзя в морозильник); у заморозки «при −18» — это не нижний предел
  if (tmin !== null && tmin !== '' && tmin !== undefined && Number(tmin) >= -5 && lmin !== null && Number(lmin) < Number(tmin) - 1)
    return 'на этикетке хранить ' + _mcBlRange_(tmin, tmax) + ', а «' + loc.name + '» — ' + _mcBlRange_(lmin, lmax);
  return '';
}
function _mcBlProfile_(name, productId) {
  var pid = productId || (name ? _mdProductId_(name) : ''), v = _mcBlProfSheet_().getDataRange().getValues(), k = _prodKey_(name || '');
  for (var i = v.length - 1; i >= 1; i--) if ((pid && String(v[i][0]) === String(pid)) || (k && _prodKey_(v[i][1]) === k)) return {
    row: i + 1, productId: String(v[i][0]), name: v[i][1], type: String(v[i][2] || ''), defaultLocation: String(v[i][3] || ''), allowed: String(v[i][4] || ''),
    tmin: v[i][5] === '' ? null : Number(v[i][5]), tmax: v[i][6] === '' ? null : Number(v[i][6]), shelfH: v[i][7] === '' ? null : Number(v[i][7]),
    afterOpenH: v[i][8] === '' ? null : Number(v[i][8]), afterOpenBasis: String(v[i][9] || ''), fefo: String(v[i][10] || 'да') !== 'нет',
    requiresLabel: String(v[i][11]) === 'да', requiresOpeningLabel: String(v[i][12]) !== 'нет', units: String(v[i][13] || ''), by: v[i][14], at: v[i][15],
    shelfBasis: String(v[i][16] || ''), inheritLabel: v[i][17] === 'да' ? true : v[i][17] === 'нет' ? false : null, afterDefrostH: v[i][18] === '' || v[i][18] === undefined ? null : Number(v[i][18]),
    afterDefrostBasis: String(v[i][19] || ''), defrostH: v[i][20] === '' || v[i][20] === undefined ? null : Number(v[i][20]) };
  return { row: 0, productId: pid, name: name, type: '', defaultLocation: '', allowed: '', tmin: null, tmax: null, shelfH: null, afterOpenH: null, afterOpenBasis: '',
    fefo: true, requiresLabel: false, requiresOpeningLabel: true, units: '', shelfBasis: '', inheritLabel: null, afterDefrostH: null, afterDefrostBasis: '', defrostH: null };
}
/** Записать поля профиля (без перезаписи остальных). */
function _mcBlProfileSet_(name, productId, fields, who) {
  var p = _mcBlProfile_(name, productId), sh = _mcBlProfSheet_();
  var row = p.row ? sh.getRange(p.row, 1, 1, MC_BL_PROF_HEAD_.length).getValues()[0] : [p.productId || _mdProductId_(name), name, '', '', '', '', '', '', '', '', 'да', 'нет', 'да', '', '', '', '', '', '', '', ''];
  while (row.length < MC_BL_PROF_HEAD_.length) row.push('');
  var idx = { type: 2, defaultLocation: 3, allowed: 4, tmin: 5, tmax: 6, shelfH: 7, afterOpenH: 8, afterOpenBasis: 9, fefo: 10, requiresLabel: 11, requiresOpeningLabel: 12, units: 13,
    shelfBasis: 16, inheritLabel: 17, afterDefrostH: 18, afterDefrostBasis: 19, defrostH: 20 };
  Object.keys(fields || {}).forEach(function (k) { if (idx[k] !== undefined) { var x = fields[k]; row[idx[k]] = x === true ? 'да' : x === false ? 'нет' : (x === null || x === undefined ? '' : x); } });
  row[14] = who || ''; row[15] = new Date();
  if (p.row) sh.getRange(p.row, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
  return _mcBlProfile_(name, row[0]);
}
/** Место хранения для новой партии: подтверждённое место продукта → правило V22 → единственное место нужного типа → «не определено». */
function _mcBlResolveLocation_(name, productId, storageType, tmin, tmax) {
  var locs = _mcBlLocations_().filter(function (l) { return l.active; }), prof = _mcBlProfile_(name, productId), out = { id: '', source: '', reason: '' };
  var ok = function (l) { return l && l.active && _mcBlTypeFits_(storageType, l.type) && !_mcBlTempConflict_(tmin, tmax, l); };
  if (prof.defaultLocation) { var l1 = _mcBlLoc_(prof.defaultLocation); if (ok(l1)) return { id: l1.id, source: 'подтверждённое место продукта (' + (prof.by || 'профиль') + ')' }; }
  if (!locs.length) return { id: '', source: '', reason: 'Места хранения не заведены (Склад → «Партия: QR, сроки, места» → «Места хранения»)' };
  try { var s = _mcV22FindLocation_(name, '', ''); if (s.locationId) { var l2 = _mcBlLoc_(s.locationId); if (ok(l2)) return { id: l2.id, source: 'правило склада: ' + (s.reason || '') }; } } catch (e) {}
  if (storageType) { var same = locs.filter(ok); if (same.length === 1) return { id: same[0].id, source: 'единственное место типа «' + (MC_BL_TYPE_RU_[storageType] || storageType) + '»' }; }
  return { id: '', source: '', reason: 'Место хранения не определено — выберите место' };
}
function _mcBlSetLocation_(b, locId) {
  var sh = b.sh, hdr = sh.getRange(1, 15, 1, 3).getValues()[0];
  if (!hdr[0] && !hdr[1] && !hdr[2]) sh.getRange(1, 15, 1, 3).setValues([['Место хранения', 'FEFO ключ', 'Дата размещения']]);
  var exp = _mcBlDate_(b.v[5]);
  sh.getRange(b.row, 15, 1, 3).setValues([[locId, exp ? exp.getTime() : Number.MAX_SAFE_INTEGER, new Date()]]);
  b.v[14] = locId;
}

/* ---------- паспорт партии (Приёмка_Партии) ---------- */
function _mcBlPass_(batchId) {
  var sh = _mcRcvSheet_(), v = sh.getDataRange().getValues();
  for (var i = v.length - 1; i >= 1; i--) if (String(v[i][0]) === String(batchId)) return { sh: sh, row: i + 1, v: v[i], c: MC_RCV_C_ };
  return null;
}
function _mcBlPassSet_(pass, fields) {
  Object.keys(fields).forEach(function (k) { var c = MC_RCV_C_[k]; if (c === undefined) return; pass.sh.getRange(pass.row, c + 1).setValue(fields[k]); pass.v[c] = fields[k]; });
}
/** Срок с часами? (короткий срок по матрице, срок после вскрытия) */
function _mcBlWithTime_(pass) { return !!(pass && String(pass.v[MC_RCV_C_['Срок с часами']]) === 'да'); }
function _mcBlExpired_(exp, withTime, now) {
  if (!exp) return false; now = now || new Date();
  if (withTime) return exp.getTime() < now.getTime();
  return exp.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/** Статус для людей + цвет (§28–§29). */
function _mcBlState_(b, pass, events) {
  var st = String(b.v[10] || 'active'), remain = _mcBlNum_(b.v[9]), init = _mcBlNum_(b.v[3]), used = _mcBlNum_(b.v[8]);
  var exp = _mcBlDate_(b.v[5]), withTime = _mcBlWithTime_(pass), now = new Date(), opened = pass && pass.v[MC_RCV_C_['Вскрыто']];
  var lastQty = (events || []).filter(function (e) { return /^(BATCH_USE|BATCH_PARTIAL_USE|BATCH_WASTE|BATCH_RETURN)$/.test(e.type); }).slice(-1)[0];
  var s = 'ACTIVE';
  if (st === 'quarantine' || st === 'recheck') s = 'QUARANTINE';
  else if (st === 'blocked') s = 'BLOCKED';
  else if (st === 'returned') s = 'RETURNED';
  else if (st === 'expired') s = 'EXPIRED';
  else if (st === 'defrost') s = 'DEFROSTING';
  else if (st === 'hold') s = 'HOLD';
  else if (st === 'consumed' || remain <= 0.0005) s = lastQty && lastQty.type === 'BATCH_WASTE' ? 'WASTED' : lastQty && lastQty.type === 'BATCH_RETURN' ? 'RETURNED' : 'CONSUMED';
  else if (_mcBlExpired_(exp, withTime, now)) s = 'EXPIRED';
  else if (used > 0.0005 || remain < init - 0.0005) s = 'PARTIALLY_USED';
  else if (opened) s = 'OPENED';
  try { if (s !== 'CONSUMED' && s !== 'WASTED' && typeof _mcIsObjectBlocked_ === 'function' && _mcIsObjectBlocked_('BATCH', b.v[0])) s = 'BLOCKED'; } catch (e) {}
  var level = 'green', warnMs = (withTime ? 24 : 24 * (typeof BATCH_EXPIRY_WARN_DAYS !== 'undefined' ? BATCH_EXPIRY_WARN_DAYS : 3)) * 3600000;
  if (s === 'CONSUMED' || s === 'WASTED' || s === 'RETURNED') level = 'grey';
  else if (s === 'BLOCKED' || s === 'QUARANTINE' || s === 'HOLD') level = 'black';
  else if (s === 'DEFROSTING') level = 'yellow';
  else if (s === 'EXPIRED') level = 'red';
  else if (exp && exp.getTime() - now.getTime() < warnMs) level = 'yellow';
  return { status: s, statusRu: MC_BL_ST_RU_[s] || s, level: level, usable: /^(ACTIVE|OPENED|PARTIALLY_USED)$/.test(s), storageStatus: st, expiry: exp, withTime: withTime };
}
function _mcBlFmt_(d, withTime) { return d ? _mcRcvFmt_(d, withTime) : ''; }
/** Количество в единице партии (база г/мл/шт) → в единице приёмки для людей. */
function _mcBlQtyText_(qtyBase, baseUnit, dispUnit) {
  var q = _mcBlNum_(qtyBase), bu = String(baseUnit || 'г'), du = String(dispUnit || '');
  if (du && du !== bu && _unitsCompatible_(du, bu)) { var k = _toBaseUnitServer_(1, du).qty || 1; return Math.round(q / k * 1000) / 1000 + ' ' + du; }
  return Math.round(q * 1000) / 1000 + ' ' + bu;
}
function _mcBlAppUrl_() { try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; } }

/** Данные этикетки: receipt — этикетка партии при приёмке; opening — после вскрытия. */
function _mcBlLabelData_(batchId, kind) {
  var b = _bcFind_(batchId); if (!b) return null;
  var pass = _mcBlPass_(batchId), C = MC_RCV_C_, ev = _mcBlEvents_(batchId), stt = _mcBlState_(b, pass, ev), pv = function (k) { return pass ? pass.v[C[k]] : ''; };
  var loc = _mcBlLoc_(b.v[14]), store = pass ? String(pv('Хранить') || '') : '';
  if (!store && loc) store = _mcBlRange_(loc.tmin, loc.tmax);
  var dispUnit = pass ? pv('Ед.') : '', url = _mcBlAppUrl_();
  var d = { kind: kind || 'receipt', batchId: String(b.v[0]), product: String(b.v[1]), supplierBatch: String(b.v[12] || pv('Партия изготовителя') || ''),
    supplier: String(pv('Поставщик') || ''), received: _mcBlFmt_(_mcBlDate_(pv('Принято') || b.v[4]), true), acceptedBy: String(pv('Принял') || ''),
    qty: _mcBlQtyText_(b.v[9], b.v[2], dispUnit), qtyInitial: _mcBlQtyText_(b.v[3], b.v[2], dispUnit),
    expiry: stt.expiry ? _mcBlFmt_(stt.expiry, stt.withTime) : '', expirySource: String(pv('Источник срока') || ''),
    originalExpiry: pv('Срок производителя') ? _mcBlFmt_(_mcBlDate_(pv('Срок производителя')), false) : '',
    store: store, location: loc ? loc.name : (b.v[14] ? String(b.v[14]) : ''), status: stt.status, statusRu: stt.statusRu,
    openedAt: pv('Вскрыто') ? _mcBlFmt_(_mcBlDate_(pv('Вскрыто')), true) : '', openedBy: String(pv('Вскрыл') || ''),
    afterOpenBasis: String(pv('Основание срока после вскрытия') || ''), parent: String(pv('ParentBatchID') || ''),
    qrText: url ? url + '?batch=' + encodeURIComponent(String(b.v[0])) : String(b.v[0]),
    warn: 'НЕ УДАЛЯТЬ ОРИГИНАЛЬНУЮ ЭТИКЕТКУ ПРОИЗВОДИТЕЛЯ до полного использования. Её фото — в цифровом архиве партии.',
    noLabel: pass ? String(pv('Без маркировки')) === 'да' : false,
    basisDoc: 'накладная № ' + String(pv('Накладная') || '') + (pv('Дата накладной') ? ' от ' + _mcBlFmt_(_mcBlDate_(pv('Дата накладной')), false) : ''), diff: String(pv('Расхождение') || ''),
    processing: String(pv('Обработка') || ''), madeAt: _mcBlFmt_(_mcBlDate_(pv('Принято') || b.v[4]), true), madeBy: String(pv('Принял') || ''), manufacturer: String(pv('Изготовитель') || ''),
    vsd: String(pv('ВСД') || '').replace(/^UUID\s+/, 'UUID ').slice(0, 60), thawedAt: pv('Разморожено') ? _mcBlFmt_(_mcBlDate_(pv('Разморожено')), true) : '', expiryBasis: String(pv('Основание срока') || '') };
  d.pf = !!d.processing && d.processing !== 'Дефрост';
  if (d.processing === 'Дефрост' || (d.pf && d.thawedAt)) d.warn = 'РАЗМОРОЖЕНО ' + d.thawedAt + ' · ПОВТОРНАЯ ЗАМОРОЗКА ЗАПРЕЩЕНА';
  else if (d.pf) d.warn = 'ПОЛУФАБРИКАТ · сырьё: партия ' + d.parent;
  if (d.noLabel && !d.processing) { d.warn = 'БЕЗ МАРКИРОВКИ ПРОИЗВОДИТЕЛЯ · основание: ' + d.basisDoc; if (!d.supplierBatch) d.supplierBatch = ''; }
  if (kind === 'opening') d.useUntil = pass && pv('Срок после вскрытия') ? d.expiry : 'НЕ ОПРЕДЕЛЁН — решение ответственного';
  return d;
}

/* ---------- срок после вскрытия ---------- */
function _mcBlAfterOpenRule_(b, pass) {
  var name = String(b.v[1]), C = MC_RCV_C_;
  // 1) этикетка производителя
  var labelId = pass ? String(pass.v[C['OriginalLabelID']] || '') : '';
  if (labelId) { var cap = _mcRcvCapture_(labelId); var ao = cap && cap.data && cap.data.after_opening; if (ao && ao.hours) return { hours: Number(ao.hours), source: 'LABEL', basis: 'этикетка производителя: «' + ao.raw + '»' }; }
  // 2) профиль хранения продукта (утверждён ответственным)
  var prof = _mcBlProfile_(name, String(b.v[17] || ''));
  if (prof.afterOpenH) return { hours: prof.afterOpenH, source: 'PRODUCT_RULE', basis: 'правило продукта: ' + (prof.afterOpenBasis || 'утверждено ' + (prof.by || '')) };
  // 3) утверждённое правило HACCP (V38): шаблон продукта + срок после вскрытия + статус APPROVED
  try {
    if (typeof _v38Rows_ === 'function') {
      var n = _v38Norm_(name), best = null;
      _v38Rows_(MC_V38.RULE).forEach(function (r) { var pat = _v38Norm_(r[5]); if (pat && n.indexOf(pat) >= 0 && String(r[20]).toUpperCase() === 'APPROVED' && r[16] !== '' && Number(r[16]) > 0) { if (!best || Number(r[1] || 0) > Number(best[1] || 0)) best = r; } });
      if (best) return { hours: Number(best[16]), source: 'HACCP_RULE', basis: 'правило HACCP ' + best[0] + (best[18] ? ' (' + best[17] + ' ' + best[18] + ')' : '') };
    }
  } catch (e) {}
  // подсказка из матрицы — только для решения ответственного, не автоматически
  var hint = '';
  try { var x = _mcRcvDb_(), m = _mcRcvMatch_(name, x); if (m) [m.e.shelfFridge, m.e.shelfRoom].forEach(function (t) { if (!hint && /откр|вскрыт/i.test(String(t || ''))) hint = 'матрица «' + m.e.name + '»: ' + t; }); } catch (e) {}
  var raw = '';
  if (labelId) { var cap2 = _mcRcvCapture_(labelId); raw = cap2 && cap2.data && cap2.data.after_opening && cap2.data.after_opening.raw || ''; }
  return { hours: null, source: 'NONE', basis: '', hint: hint, labelText: raw };
}
function calculatePostOpeningExpiry(batchId, token) {
  try {
    _mcBlAuth_(token, ['stock', 'kanban', 'journals', 'labels']);
    var b = _bcFind_(batchId); if (!b) return _fail_('NOT_FOUND', 'Партия не найдена');
    var pass = _mcBlPass_(batchId), r = _mcBlAfterOpenRule_(b, pass), now = new Date(), exp = _mcBlDate_(b.v[5]);
    var until = r.hours ? new Date(now.getTime() + r.hours * 3600000) : null;
    if (until && exp && !_mcBlWithTime_(pass)) { var endDay = new Date(exp.getFullYear(), exp.getMonth(), exp.getDate(), 23, 59); if (endDay < until) until = endDay; }
    else if (until && exp && exp < until) until = exp;
    return _ok_({ batchId: String(batchId), hours: r.hours, source: r.source, basis: r.basis, hint: r.hint || '', labelText: r.labelText || '', useUntil: until ? _mcBlFmt_(until, true) : '',
      message: r.hours ? '' : 'Срок после вскрытия не определён. Требуется решение ответственного лица.' });
  } catch (e) { return _failFrom_(e); }
}

/* ---------- карточка партии ---------- */
function _mcBlTimeline_(batchId, b, pass) {
  var out = [], ev = _mcBlEvents_(batchId), du = pass ? String(pass.v[MC_RCV_C_['Ед.']] || '') : '';
  ev.forEach(function (e) {
    var t = MC_BL_EVT_RU_[e.type] || e.type, det = [];
    if (e.qty !== '' && e.qty !== null) det.push(e.unit === 'шт' || !du ? e.qty + ' ' + (e.unit || '') : _mcBlQtyText_(e.qty, e.unit, du));
    if (e.from || e.to) det.push((e.from ? _mcBlLocName_(e.from) : '—') + ' → ' + (e.to ? _mcBlLocName_(e.to) : '—'));
    if (e.reason) det.push(e.reason);
    if (e.corrects) det.push('исправляет ' + e.corrects);
    out.push({ at: e.at, type: e.type, title: t, who: e.who, role: e.role, detail: det.join(' · '), op: e.op, id: e.id, result: e.result });
  });
  var have = function (type) { return ev.some(function (e) { return e.type === type; }); };
  // партии, принятые раньше журнала событий: приход, входной контроль, выпуск — из их листов
  if (!have('BATCH_CREATED') && b) out.push({ at: b.v[4], type: 'BATCH_CREATED', title: 'Партия создана', who: pass ? pass.v[MC_RCV_C_['Принял']] : '', detail: String(b.v[7] || ''), op: pass ? pass.v[MC_RCV_C_['OperationID']] : '' });
  try { _bcSheet_(MC_BC_IN_, MC_BC_IN_HEAD_).getDataRange().getValues().forEach(function (r, i) { if (i && String(r[1]) === String(batchId)) out.push({ at: r[16], type: 'INCOMING_CONTROL', title: 'Входной контроль: ' + r[11], who: r[14], role: r[15], detail: [r[6] !== '' ? 't° ' + r[6] : '', r[9], r[12]].filter(Boolean).join(' · '), op: r[17] }); }); } catch (e) {}
  try { _bcSheet_(MC_BC_REL_, MC_BC_REL_HEAD_).getDataRange().getValues().forEach(function (r, i) { if (i && String(r[1]) === String(batchId)) out.push({ at: r[8], type: 'BATCH_RELEASE', title: 'Решение по партии: ' + r[4], who: r[6], role: r[7], detail: r[5], op: r[9] }); }); } catch (e) {}
  try { _mcTraceGraph_('BATCH', batchId, 'forward', 1).forEach(function (x) { if (/^(PRODUCTION|BANQUET|SALE|DAILY_SAMPLE|CCP)$/.test(x.nextType)) out.push({ at: x.link.dateTime, type: x.nextType, title: (MC_TRACE_RU_[x.nextType] || x.nextType) + ' ' + x.nextId, who: x.link.actor, detail: x.link.relation + (x.link.weight ? ' · ' + x.link.weight + ' ' + (x.link.unit || '') : '') }); }); } catch (e) {}
  out.forEach(function (x) { var d = _mcBlDate_(x.at); x.ts = d ? d.getTime() : 0; x.when = d ? _mcBlFmt_(d, true) : ''; delete x.at; });
  out.sort(function (a, b2) { return a.ts - b2.ts; });
  return out;
}
function _mcBlCard_(batchId, s) {
  var b = _bcFind_(batchId); if (!b) return null;
  var C = MC_RCV_C_, pass = _mcBlPass_(batchId), ev = _mcBlEvents_(batchId), stt = _mcBlState_(b, pass, ev), pv = function (k) { return pass ? pass.v[C[k]] : ''; };
  var price = _mcBlNum_(b.v[6]), unit = String(b.v[2] || 'г'), loc = _mcBlLoc_(b.v[14]);
  var card = _mcBlLabelData_(batchId, pv('Вскрыто') ? 'opening' : 'receipt');
  card.state = stt; card.unit = unit; card.dispUnit = pass ? String(pv('Ед.') || unit) : unit;
  card.initialBase = _mcBlNum_(b.v[3]); card.usedBase = _mcBlNum_(b.v[8]); card.remainBase = _mcBlNum_(b.v[9]);
  card.priceBase = price; card.remainCost = Math.round(price * card.remainBase * 100) / 100; card.totalCost = pass && pv('Стоимость') !== '' ? _mcBlNum_(pv('Стоимость')) : Math.round(price * card.initialBase * 100) / 100;
  card.pricePerUnit = pass && pv('Цена за ед.') !== '' ? _mcBlNum_(pv('Цена за ед.')) : '';
  card.productId = String(b.v[17] || ''); card.supplierId = String(b.v[18] || pv('SupplierID') || '');
  card.docNumber = String(pv('Накладная') || ''); card.docDate = pv('Дата накладной') ? _mcBlFmt_(_mcBlDate_(pv('Дата накладной')), false) : ''; card.documentId = String(pv('DocumentID накладной') || '');
  card.manufacturer = String(pv('Изготовитель') || ''); card.gtin = String(pv('GTIN/EAN') || '');
  card.productionDate = b.v[11] ? _mcBlFmt_(_mcBlDate_(b.v[11]), false) : (pv('Дата изготовления') ? _mcBlFmt_(_mcBlDate_(pv('Дата изготовления')), false) : '');
  card.packagingDate = pv('Дата упаковки') ? _mcBlFmt_(_mcBlDate_(pv('Дата упаковки')), false) : '';
  card.expiryBasis = String(pv('Основание срока') || ''); card.match = String(pv('Сопоставление') || '');
  card.storageType = String(pv('Тип хранения') || ''); card.storageTypeRu = MC_BL_TYPE_RU_[card.storageType] || '';
  card.locationId = String(b.v[14] || ''); card.locationText = loc ? loc.name + (loc.tmin !== null || loc.tmax !== null ? ' (' + _mcBlRange_(loc.tmin, loc.tmax) + ')' : '') : '';
  card.originalLabel = { labelId: String(pv('OriginalLabelID') || ''), documentId: String(pv('Документ этикетки') || ''), fileId: String(pv('FileID этикетки') || ''), text: '' };
  if (card.originalLabel.labelId) { var cap = _mcRcvCapture_(card.originalLabel.labelId); if (cap) card.originalLabel.text = String(cap.data && cap.data.raw_text || '').slice(0, 4000); }
  card.originalLabels = String(pv('Все этикетки') || card.originalLabel.labelId || '').split(',').filter(Boolean).map(function (lid) { var cp = _mcRcvCapture_(lid) || {}, dd = cp.data || {};
    return { labelId: lid, fileId: cp.fileId || '', net: dd.net_weight_kg || '', expiry: dd.expiration_date || '', batch: dd.supplier_batch || '', text: String(dd.raw_text || '').slice(0, 4000) }; });
  card.packages = card.originalLabels.length;
  card.afterOpen = pv('Вскрыто') ? { at: card.openedAt, by: card.openedBy, hours: pv('Срок после вскрытия'), basis: card.afterOpenBasis, undetermined: !pv('Срок после вскрытия') } : null;
  card.children = []; card.parentBatch = String(pv('ParentBatchID') || '');
  try { b.sh.getRange('A:A').getValues().forEach(function (r) { var id = String(r[0]); if (id.indexOf(String(batchId) + '-') === 0 && /^-\d{2}$/.test(id.slice(String(batchId).length))) card.children.push(id); }); } catch (e) {}
  card.documents = [];
  try { _sdRows_(MC_SD_DOC_, MC_SD_DOC_HEAD_).forEach(function (d) { if (String(d.BatchID) === String(batchId) || (card.documentId && d.DocumentID === card.documentId)) { var fs = String(d.FileID || '').split(',').filter(String), hs = String(d.Hash || '').split(','); if (fs.length < 2) card.documents.push({ id: d.DocumentID, type: d['Тип'], number: d['Номер'], date: d['Дата'], fileId: d.FileID, hash: d.Hash, status: d['Статус'], verifiedBy: d['Проверил'] });
    else fs.forEach(function (f, k) { card.documents.push({ id: d.DocumentID, type: d['Тип'] + ' · лист ' + (k + 1) + ' из ' + fs.length, number: d['Номер'], date: d['Дата'], fileId: f, hash: hs[k] || '', status: d['Статус'], verifiedBy: d['Проверил'] }); }); } }); } catch (e) {}
  card.timeline = _mcBlTimeline_(batchId, b, pass);
  card.vsd = []; try { card.vsd = _mvForBatch_(batchId); } catch (e) {}
  card.vetControlled = false; try { card.vetControlled = _sdVetControlled_(String(b.v[17] || ''), b.v[1]); } catch (e) {}
  // FEFO: другие партии того же продукта, доступные к использованию — по возрастанию срока
  card.fefo = [];
  try {
    var key = _prodKey_(b.v[1]), all = b.sh.getDataRange().getValues();
    for (var i = 1; i < all.length; i++) {
      if (!all[i][0] || (_prodKey_(all[i][1]) !== key && !(card.productId && String(all[i][17]) === card.productId))) continue;
      var bb = { v: all[i], sh: b.sh, row: i + 1 }, ps = String(all[i][0]) === String(batchId) ? pass : _mcBlPass_(all[i][0]), st2 = _mcBlState_(bb, ps, []);
      if (!st2.usable || _mcBlNum_(all[i][9]) <= 0) continue;
      card.fefo.push({ batchId: String(all[i][0]), expiry: st2.expiry ? _mcBlFmt_(st2.expiry, st2.withTime) : 'без срока', ts: st2.expiry ? st2.expiry.getTime() : 9e15,
        remain: _mcBlQtyText_(all[i][9], all[i][2], ps ? ps.v[C['Ед.']] : ''), location: _mcBlLocName_(all[i][14]), self: String(all[i][0]) === String(batchId) });
    }
    card.fefo.sort(function (a, c) { return a.ts - c.ts; });
    if (card.fefo.length) card.fefo[0].recommended = true;
  } catch (e) {}
  card.trace = null;
  try { card.trace = _mcTraceSummary_(String(batchId)); } catch (e) {}
  // этап 10.7: кнопки карточки — строго по новым правам (нет права — кнопки нет; сервер всё равно проверит)
  var can = function (r) { return !!s && _mcRbHasExact_(s, r.join('|')); };
  var live = !/^(CONSUMED|WASTED|RETURNED)$/.test(stt.status) && card.remainBase > 0;
  card.actions = { move: can(['stock']) && live, open: can(['batch_use']) && stt.usable && !card.afterOpen, use: can(['batch_use']) && stt.usable,
    waste: can(['stock']) && live, split: can(['stock']) && live && stt.usable, ret: can(['stock']) && live, print: can(['labels']),
    decideOpen: can(['haccp']) && !!card.afterOpen, correct: can(['haccp']), locations: can(['stock', 'haccp']), vsd: can(['mercury', 'vsd_cancel']), vsdCancel: _mvCanCancel_(s),
    process: can(['batch_use']) && stt.usable && !_prFrozen_(b, pass), defrost: can(['batch_use']) && stt.usable && _prFrozen_(b, pass),
    defrostRunning: can(['batch_use']) && String(b.v[10]) === 'defrost', decideExpiry: can(['haccp']) && String(b.v[10]) === 'hold', audit: can(['audit_view']) };
  card.processing = { kind: String(pv('Обработка') || ''), act: String(pv('Акт обработки') || ''), thawedAt: pv('Разморожено') ? _mcBlFmt_(_mcBlDate_(pv('Разморожено')), true) : '',
    defrostStart: pv('Дефрост начат') ? _mcBlFmt_(_mcBlDate_(pv('Дефрост начат')), true) : '', defrostUntil: pv('Дефрост до') ? _mcBlFmt_(_mcBlDate_(pv('Дефрост до')), true) : '', frozen: _prFrozen_(b, pass) };
  if (String(b.v[10]) === 'defrost') try { card.processing.measurements = _prMeasList_(batchId).map(function (m) { return { at: _mcBlFmt_(m.at, true), t: m.t, result: m.result, final: m.final, who: m.who }; }); } catch (e) {}
  try { var mc = _mvCfg_(); card.mercury = { configured: mc.ready }; } catch (e) { card.mercury = { configured: false }; }
  card.locations = _mcBlLocations_().filter(function (l) { return l.active; }).map(function (l) { return { id: l.id, name: l.name, type: l.type, range: _mcBlRange_(l.tmin, l.tmax) }; });
  return card;
}
function getBatchCard(batchId, token) {
  try {
    var s = _mcBlAuth_(token, ['stock', 'kanban', 'journals', 'labels']);
    var id = String(batchId || '').trim().replace(/^.*[?&]batch=([^&#]+).*$/, function (m, x) { return decodeURIComponent(x); });
    var c = _mcBlCard_(id, s);
    return c ? _ok_(c) : _fail_('NOT_FOUND', 'Партия «' + id + '» не найдена');
  } catch (e) { return _failFrom_(e); }
}
function getBatchTimeline(batchId, token) {
  try { _mcBlAuth_(token, ['stock', 'kanban', 'journals', 'labels']); var b = _bcFind_(batchId); if (!b) return _fail_('NOT_FOUND', 'Партия не найдена'); return _ok_(_mcBlTimeline_(String(batchId), b, _mcBlPass_(batchId))); }
  catch (e) { return _failFrom_(e); }
}
/** Аудит по партии: история операций (с цепочкой хешей) + строки Audit_Log с этим номером. */
function getBatchAuditLog(batchId, token) {
  try {
    _mcBlAuth_(token, ['haccp', 'journals']);
    var id = String(batchId || '').trim(); if (!id) return _fail_('VALIDATION', 'Укажите номер партии');
    var ev = _mcBlEvents_(id), log = [];
    try { var sh = _auditSheet_(), n = sh.getLastRow(), from = Math.max(2, n - 4000); if (n >= from) sh.getRange(from, 1, n - from + 1, 13).getValues().forEach(function (r) { if (String(r[9]).indexOf(id) >= 0 || String(r[11]).indexOf(id) >= 0) log.push({ at: _mcBlFmt_(_mcBlDate_(r[0]), true), op: r[1], who: r[2], role: r[3], action: r[7], entity: r[8], entityId: String(r[9]).slice(0, 200) }); }); } catch (e) {}
    return _ok_({ batchId: id, events: ev.map(function (e) { e.at = _mcBlFmt_(_mcBlDate_(e.at), true); return e; }), auditLog: log, chain: _mcBlChainOk_() });
  } catch (e) { return _failFrom_(e); }
}
function getReverseBatchTraceability(batchId, token) { return getReverseTraceability(batchId, token); }

/* ---------- операции ---------- */
function _mcBlRequire_(b, batchId) { if (!b) throw new Error('NOT_FOUND: партия «' + batchId + '» не найдена'); return b; }
/** Взять количество из партии (в единице партии). Блокированную/карантинную партию берёт только списание и возврат. */
function _mcBlTake_(b, takeBase) {
  var remain = _mcBlNum_(b.v[9]), used = _mcBlNum_(b.v[8]), t = Math.min(takeBase, remain);
  var nr = Math.round((remain - t) * 1000) / 1000, nu = Math.round((used + t) * 1000) / 1000;
  b.sh.getRange(b.row, 9, 1, 2).setValues([[nu, nr]]); b.v[8] = nu; b.v[9] = nr;
  return { taken: t, remainBefore: remain, remain: nr };
}
function _mcBlToBatchUnit_(qty, unit, batchUnit) {
  if (!_unitsCompatible_(unit || batchUnit, batchUnit)) throw new Error('VALIDATION: единица «' + unit + '» несовместима с единицей партии «' + batchUnit + '»');
  return _toBaseUnitServer_(_mcBlNum_(qty), unit || batchUnit).qty / (_toBaseUnitServer_(1, batchUnit).qty || 1);
}
function _mcBlUnitPrice_(b) { return _mcBlNum_(b.v[6]); }

/** Разделить партию: дочерняя партия ParentID-NN с тем же сроком, документом и местом. */
function _mcBlSplitCore_(op, b, qtyBase, reason) {
  var pid = String(b.v[0]), all = b.sh.getRange('A:A').getValues(), n = 0;
  all.forEach(function (r) { var id = String(r[0]); if (id.indexOf(pid + '-') === 0) { var m = /^-(\d{2})$/.exec(id.slice(pid.length)); if (m) n = Math.max(n, Number(m[1])); } });
  var cid = pid + '-' + _mcBlP2_(n + 1), q = Math.round(qtyBase * 1000) / 1000;
  var row = b.v.slice(); row[0] = cid; row[3] = q; row[8] = 0; row[9] = q; row[7] = String(b.v[7] || '') + ' · из партии ' + pid;
  b.sh.appendRow(row);
  var nr = Math.round((_mcBlNum_(b.v[9]) - q) * 1000) / 1000; b.sh.getRange(b.row, 10).setValue(nr); b.v[9] = nr;
  var pass = _mcBlPass_(pid), ps = _mcRcvSheet_(), C = MC_RCV_C_, prow;
  if (pass) prow = pass.v.slice(); else { prow = []; for (var i = 0; i < MC_RCV_HEAD_.length; i++) prow.push(''); prow[C['Продукт']] = b.v[1]; prow[C['Ед.']] = b.v[2]; prow[C['Принято']] = b.v[4]; prow[C['Годен до']] = b.v[5]; }
  prow[C['BatchID']] = cid; prow[C['Кол-во']] = Math.round(q / (_toBaseUnitServer_(1, prow[C['Ед.']] || b.v[2]).qty || 1) * 1000) / 1000; prow[C['ParentBatchID']] = pid; prow[C['OperationID']] = op.id;
  prow[C['Печатей этикетки']] = 0; prow[C['Последняя печать']] = ''; prow[C['Печатей этикетки вскрытия']] = 0; prow[C['Обновлено']] = new Date(); prow[C['Обновил']] = _author_(op).фио;
  while (prow.length < MC_RCV_HEAD_.length) prow.push('');
  ps.appendRow(prow.slice(0, MC_RCV_HEAD_.length));
  _mcBlEvent_(op, pid, 'BATCH_SPLIT', { qty: q, unit: b.v[2], to: '', reason: reason || '', after: { child: cid, remain: nr } });
  _mcBlEvent_(op, cid, 'BATCH_CREATED', { qty: q, unit: b.v[2], reason: 'выделена из партии ' + pid + (reason ? ': ' + reason : ''), after: { parent: pid } });
  _mcCreateTraceLink_('BATCH', pid, 'SPLIT', 'BATCH', cid, { factId: cid, actor: _author_(op).фио, source: 'BATCH_SPLIT', weight: q, unit: b.v[2] });
  return _bcFind_(cid);
}
function splitBatch(batchId, qty, unit, reason, token) {
  var op = null;
  try { op = _mcBlOp_(token, ['stock'], 'BATCH_SPLIT', batchId); } catch (e) { return _failFrom_(e); }
  try {
    return _withLock_(function () {
      var b = _mcBlRequire_(_bcFind_(batchId), batchId), st = _mcBlState_(b, _mcBlPass_(batchId), _mcBlEvents_(batchId));
      if (!st.usable) { _endOp_(op, 'FAILED'); return _fail_('BATCH_STATE', 'Делить можно только допущенную партию (сейчас: ' + st.statusRu + ')', op.id); }
      var q = _mcBlToBatchUnit_(qty, unit, b.v[2]);
      if (!(q > 0) || q >= _mcBlNum_(b.v[9]) - 0.0005) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Количество для выделения — больше нуля и меньше остатка', op.id); }
      var c = _mcBlSplitCore_(op, b, q, reason);
      _audit_(op, 'BATCH_SPLIT', 'Партия', String(batchId), null, { child: c.v[0], qty: q, unit: b.v[2] });
      _endOp_(op);
      return _ok_({ parent: String(batchId), child: String(c.v[0]), label: _mcBlLabelData_(c.v[0], 'receipt') }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Переместить партию (или её часть — выделяется дочерняя партия). */
function moveBatch(batchId, toLocationId, qty, unit, reason, token) {
  var op = null;
  try { op = _mcBlOp_(token, ['stock'], 'MOVE', batchId); } catch (e) { return _failFrom_(e); }
  try {
    return _withLock_(function () {
      var b = _mcBlRequire_(_bcFind_(batchId), batchId), pass = _mcBlPass_(batchId), st = _mcBlState_(b, pass, _mcBlEvents_(batchId));
      if (/^(CONSUMED|WASTED|RETURNED)$/.test(st.status)) { _endOp_(op, 'FAILED'); return _fail_('BATCH_STATE', 'Партия ' + st.statusRu + ' — перемещать нечего', op.id); }
      var loc = _mcBlLoc_(toLocationId);
      if (!loc || !loc.active) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Место хранения не найдено или отключено', op.id); }
      var from = String(b.v[14] || '');
      if (from === loc.id) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Партия уже в «' + loc.name + '»', op.id); }
      var C = MC_RCV_C_, st2 = pass ? String(pass.v[C['Тип хранения']] || '') : '';
      if (loc.type === 'FREEZER' && pass && pass.v[C['Разморожено']]) { _endOp_(op, 'FAILED'); return _fail_('REFREEZE_FORBIDDEN', 'Повторная заморозка размороженного продукта запрещена (разморожено ' + _mcBlFmt_(_mcBlDate_(pass.v[C['Разморожено']]), true) + ')', op.id); }
      if (String(b.v[10]) === 'defrost' && loc.type !== 'FRIDGE') { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Идёт дефрост — продукт размораживается только в холодильнике', op.id); }
      if (st2 && !_mcBlTypeFits_(st2, loc.type)) { _endOp_(op, 'FAILED'); return _fail_('STORAGE_CONFLICT', 'Продукт хранится: ' + (MC_BL_TYPE_RU_[st2] || st2) + ', а «' + loc.name + '» — ' + (MC_BL_TYPE_RU_[loc.type] || loc.type), op.id); }
      var target = b, q = qty ? _mcBlToBatchUnit_(qty, unit, b.v[2]) : 0;
      if (q > 0 && q < _mcBlNum_(b.v[9]) - 0.0005) target = _mcBlSplitCore_(op, b, q, 'перемещение части в «' + loc.name + '»');
      _mcBlSetLocation_(target, loc.id);
      var ev = _mcBlEvent_(op, target.v[0], 'MOVE', { qty: _mcBlNum_(target.v[9]), unit: target.v[2], from: from, to: loc.id, reason: reason || '', before: { location: from }, after: { location: loc.id } });
      _mcCreateTraceLink_('BATCH', String(target.v[0]), 'MOVE', 'LOCATION', loc.id, { factId: ev, actor: _author_(op).фио, source: 'MOVE', weight: _mcBlNum_(target.v[9]), unit: target.v[2] });
      _audit_(op, 'MOVE', 'Партия', String(target.v[0]), { location: from }, { location: loc.id, eventId: ev });
      _endOp_(op);
      return _ok_({ batchId: String(target.v[0]), from: _mcBlLocName_(from), to: loc.name, eventId: ev, split: target !== b }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Вскрыть тару: фиксируется кто и когда, считается новый срок, печатается этикетка вскрытия. qty — вскрыть часть (дочерняя партия). */
function openBatchContainer(batchId, qty, unit, token) {
  var op = null;
  try { op = _mcBlOp_(token, ['stock', 'kanban'], 'OPEN_CONTAINER', batchId); } catch (e) { return _failFrom_(e); }
  try {
    return _withLock_(function () {
      var b = _mcBlRequire_(_bcFind_(batchId), batchId), pass = _mcBlPass_(batchId), st = _mcBlState_(b, pass, _mcBlEvents_(batchId)), C = MC_RCV_C_;
      if (!st.usable) { _endOp_(op, 'FAILED'); return _fail_('BATCH_STATE', 'Вскрыть можно только допущенную партию со сроком (сейчас: ' + st.statusRu + ')', op.id); }
      if (pass && pass.v[C['Вскрыто']]) { _endOp_(op, 'FAILED'); return _fail_('BATCH_STATE', 'Тара уже вскрыта ' + _mcBlFmt_(_mcBlDate_(pass.v[C['Вскрыто']]), true), op.id); }
      var target = b, q = qty ? _mcBlToBatchUnit_(qty, unit, b.v[2]) : 0;
      if (q > 0 && q < _mcBlNum_(b.v[9]) - 0.0005) { target = _mcBlSplitCore_(op, b, q, 'вскрытие части тары'); }
      var tid = String(target.v[0]), tpass = _mcBlPass_(tid), now = new Date(), who = _author_(op), rule = _mcBlAfterOpenRule_(target, tpass);
      var oldExp = _mcBlDate_(target.v[5]), oldWithTime = _mcBlWithTime_(tpass), newExp = oldExp, withTime = oldWithTime;
      if (rule.hours) {
        var cand = new Date(now.getTime() + rule.hours * 3600000), limit = oldExp ? (oldWithTime ? oldExp : new Date(oldExp.getFullYear(), oldExp.getMonth(), oldExp.getDate(), 23, 59)) : null;
        newExp = limit && limit < cand ? limit : cand; withTime = true;
        target.sh.getRange(target.row, 6).setValue(newExp); target.v[5] = newExp;
        target.sh.getRange(target.row, 16).setValue(newExp.getTime());
      }
      var ev = _mcBlEvent_(op, tid, 'OPEN_CONTAINER', { qty: _mcBlNum_(target.v[9]), unit: target.v[2], reason: rule.hours ? '' : 'срок после вскрытия не определён',
        before: { expiry: oldExp ? _mcBlFmt_(oldExp, oldWithTime) : '' }, after: { openedAt: _mcBlFmt_(now, true), useUntil: rule.hours ? _mcBlFmt_(newExp, true) : '' } });
      if (rule.hours) _mcBlEvent_(op, tid, 'RECALCULATE_EXPIRY', { reason: rule.basis, before: { expiry: oldExp ? _mcBlFmt_(oldExp, oldWithTime) : '' }, after: { expiry: _mcBlFmt_(newExp, true), source: rule.source } });
      if (tpass) _mcBlPassSet_(tpass, { 'Вскрыто': now, 'Вскрыл': who.фио, 'Срок после вскрытия': rule.hours || '', 'Основание срока после вскрытия': rule.hours ? rule.basis : 'не определён — нужно решение ответственного',
        'Срок с часами': withTime ? 'да' : '', 'Обновлено': now, 'Обновил': who.фио });
      _mcCreateTraceLink_('BATCH', tid, 'OPEN', 'OPENING', ev, { factId: ev, actor: who.фио, source: 'OPEN_CONTAINER' });
      _audit_(op, 'OPEN_CONTAINER', 'Партия', tid, { expiry: oldExp ? _mcBlFmt_(oldExp, oldWithTime) : '' }, { useUntil: rule.hours ? _mcBlFmt_(newExp, true) : 'не определён', source: rule.source, basis: rule.basis });
      _endOp_(op);
      return _ok_({ batchId: tid, split: target !== b, useUntil: rule.hours ? _mcBlFmt_(newExp, true) : '', source: rule.source, basis: rule.basis, hint: rule.hint || '',
        message: rule.hours ? '' : 'Срок после вскрытия не определён. Требуется решение ответственного лица.', label: _mcBlLabelData_(tid, 'opening') }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Решение ответственного: срок после вскрытия для партии (и при желании — правило продукта). */
function setPostOpeningExpiry(batchId, hours, basis, applyToProduct, token) {
  var op = null;
  try { op = _beginOp_(token, 'haccp', 'RECALCULATE_EXPIRY', 'Партия', batchId, null); } catch (e) { return _failFrom_(e); }
  try {
    var h = _mcBlNum_(hours); basis = String(basis || '').trim();
    if (!(h > 0)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите срок после вскрытия в часах', op.id); }
    if (!basis) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите основание (документ, ТИ, решение HACCP-группы)', op.id); }
    return _withLock_(function () {
      var b = _mcBlRequire_(_bcFind_(batchId), batchId), pass = _mcBlPass_(batchId), C = MC_RCV_C_, who = _author_(op);
      if (!pass || !pass.v[C['Вскрыто']]) { _endOp_(op, 'FAILED'); return _fail_('BATCH_STATE', 'Тара не вскрыта', op.id); }
      var opened = _mcBlDate_(pass.v[C['Вскрыто']]), orig = _mcBlDate_(pass.v[C['Срок производителя']]) || _mcBlDate_(b.v[5]);
      var cand = new Date(opened.getTime() + h * 3600000), limit = orig ? new Date(orig.getFullYear(), orig.getMonth(), orig.getDate(), 23, 59) : null, exp = limit && limit < cand ? limit : cand;
      var before = _mcBlFmt_(_mcBlDate_(b.v[5]), _mcBlWithTime_(pass));
      b.sh.getRange(b.row, 6).setValue(exp); b.sh.getRange(b.row, 16).setValue(exp.getTime());
      _mcBlPassSet_(pass, { 'Срок после вскрытия': h, 'Основание срока после вскрытия': 'решение ответственного (' + who.фио + '): ' + basis, 'Срок с часами': 'да', 'Обновлено': new Date(), 'Обновил': who.фио });
      if (applyToProduct === true || applyToProduct === 'true') _mcBlProfileSet_(b.v[1], String(b.v[17] || ''), { afterOpenH: h, afterOpenBasis: basis + ' — утвердил ' + who.фио }, who.фио);
      var ev = _mcBlEvent_(op, batchId, 'RECALCULATE_EXPIRY', { reason: 'решение ответственного: ' + basis, before: { expiry: before }, after: { expiry: _mcBlFmt_(exp, true), hours: h } });
      _audit_(op, 'RECALCULATE_EXPIRY', 'Партия', String(batchId), { expiry: before }, { expiry: _mcBlFmt_(exp, true), hours: h, basis: basis, product: applyToProduct === true || applyToProduct === 'true' });
      _endOp_(op);
      return _ok_({ batchId: String(batchId), useUntil: _mcBlFmt_(exp, true), eventId: ev, label: _mcBlLabelData_(batchId, 'opening') }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Использовать из партии (производство, заготовка). FEFO: если есть партия с более ранним сроком — нужно подтверждение. */
function useBatch(batchId, qty, unit, purpose, fefoAck, token) {
  var op = null;
  try { op = _mcBlOp_(token, ['stock', 'kanban'], 'BATCH_USE', batchId); } catch (e) { return _failFrom_(e); }
  try {
    return _withLock_(function () {
      var b = _mcBlRequire_(_bcFind_(batchId), batchId), pass = _mcBlPass_(batchId), st = _mcBlState_(b, pass, _mcBlEvents_(batchId));
      if (!st.usable) { _endOp_(op, 'FAILED'); return _fail_('BATCH_STATE', 'Использование запрещено: партия ' + st.statusRu, op.id); }
      var q = _mcBlToBatchUnit_(qty, unit, b.v[2]), remain = _mcBlNum_(b.v[9]);
      if (!(q > 0)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите количество', op.id); }
      if (q > remain + 0.0005) { _endOp_(op, 'FAILED'); return _fail_('STOCK_SHORTAGE', 'В партии осталось ' + _mcBlQtyText_(remain, b.v[2], pass ? pass.v[MC_RCV_C_['Ед.']] : ''), op.id); }
      if (!(fefoAck === true || fefoAck === 'true')) {
        var card = _mcBlCard_(batchId, op.session), first = (card.fefo || [])[0];
        if (first && first.batchId !== String(batchId) && first.ts < ((st.expiry && st.expiry.getTime()) || 9e15)) { _endOp_(op, 'FAILED'); return _fail_('FEFO', 'По FEFO сначала партия ' + first.batchId + ' (годен до ' + first.expiry + ', ' + first.location + '). Использовать эту партию всё равно?', op.id); }
      }
      var t = _mcBlTake_(b, q), price = _mcBlUnitPrice_(b);
      _logStockOp_('Расход', b.v[1], t.taken, b.v[2], price, 'Партия ' + b.v[0], String(purpose || ''));
      var full = t.remain <= 0.0005;
      if (full) { b.sh.getRange(b.row, 11).setValue('consumed'); b.v[10] = 'consumed'; }
      var type = full ? 'BATCH_USE' : 'BATCH_PARTIAL_USE';
      var ev = _mcBlEvent_(op, batchId, type, { qty: t.taken, unit: b.v[2], reason: String(purpose || ''), before: { remain: t.remainBefore }, after: { remain: t.remain, status: full ? 'CONSUMED' : 'PARTIALLY_USED' } });
      _mcCreateTraceLink_('BATCH', String(batchId), type, 'USE', ev, { factId: ev, actor: _author_(op).фио, source: 'BATCH_USE', weight: t.taken, unit: b.v[2] });
      _audit_(op, type, 'Партия', String(batchId), { remain: t.remainBefore }, { remain: t.remain, used: t.taken, purpose: purpose || '' });
      _endOp_(op);
      return _ok_({ batchId: String(batchId), used: t.taken, remain: t.remain, unit: b.v[2], remainText: _mcBlQtyText_(t.remain, b.v[2], pass ? pass.v[MC_RCV_C_['Ед.']] : ''), status: full ? 'CONSUMED' : 'PARTIALLY_USED', usedCost: Math.round(price * t.taken * 100) / 100, remainCost: Math.round(price * t.remain * 100) / 100, eventId: ev }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Списать (порча, брак, просрочка): причина обязательна, фото по желанию. */
function wasteBatch(batchId, qty, unit, reason, photoDataUrl, comment, token) {
  var op = null;
  try { op = _mcBlOp_(token, ['stock'], 'BATCH_WASTE', batchId); } catch (e) { return _failFrom_(e); }
  try {
    reason = String(reason || '').trim();
    if (!reason) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите причину списания', op.id); }
    return _withLock_(function () {
      var b = _mcBlRequire_(_bcFind_(batchId), batchId), remain = _mcBlNum_(b.v[9]);
      if (remain <= 0) { _endOp_(op, 'FAILED'); return _fail_('BATCH_STATE', 'Остаток партии 0', op.id); }
      var q = qty ? _mcBlToBatchUnit_(qty, unit, b.v[2]) : remain;
      if (!(q > 0) || q > remain + 0.0005) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Количество — больше нуля и не больше остатка', op.id); }
      var photo = photoDataUrl ? _sdFile_(photoDataUrl, 'Списание ' + b.v[0] + ' ' + _mcBlYmd_(new Date())) : null;
      var t = _mcBlTake_(b, q), price = _mcBlUnitPrice_(b), loc = String(b.v[14] || '');
      _logStockOp_('Списание', b.v[1], t.taken, b.v[2], price, 'Партия ' + b.v[0], reason + (comment ? ' · ' + comment : ''));
      if (t.remain <= 0.0005) { b.sh.getRange(b.row, 11).setValue('consumed'); b.v[10] = 'consumed'; }
      var ev = _mcBlEvent_(op, batchId, 'BATCH_WASTE', { qty: t.taken, unit: b.v[2], from: loc, reason: reason + (comment ? ' · ' + comment : ''), doc: photo ? photo.fileId + ' sha256:' + photo.hash : '',
        before: { remain: t.remainBefore }, after: { remain: t.remain } });
      _mcCreateTraceLink_('BATCH', String(batchId), 'WASTE', 'WASTE', ev, { factId: ev, actor: _author_(op).фио, source: 'BATCH_WASTE', weight: t.taken, unit: b.v[2] });
      _audit_(op, 'BATCH_WASTE', 'Партия', String(batchId), { remain: t.remainBefore }, { remain: t.remain, qty: t.taken, reason: reason, photo: photo ? photo.hash : '' });
      _endOp_(op);
      var wp = _mcBlPass_(batchId);
      return _ok_({ batchId: String(batchId), wasted: t.taken, remain: t.remain, unit: b.v[2], remainText: _mcBlQtyText_(t.remain, b.v[2], wp ? wp.v[MC_RCV_C_['Ед.']] : ''), cost: Math.round(price * t.taken * 100) / 100, eventId: ev }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Возврат поставщику (брак при приёмке, несоответствие): весь остаток. */
function returnBatch(batchId, reason, token) {
  var op = null;
  try { op = _mcBlOp_(token, ['stock'], 'BATCH_RETURN', batchId); } catch (e) { return _failFrom_(e); }
  try {
    reason = String(reason || '').trim();
    if (!reason) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите причину возврата', op.id); }
    return _withLock_(function () {
      var b = _mcBlRequire_(_bcFind_(batchId), batchId), remain = _mcBlNum_(b.v[9]), st = String(b.v[10]);
      if (remain <= 0) { _endOp_(op, 'FAILED'); return _fail_('BATCH_STATE', 'Остаток партии 0', op.id); }
      var t = _mcBlTake_(b, remain), pass = _mcBlPass_(batchId);
      _logStockOp_('Возврат поставщику', b.v[1], t.taken, b.v[2], _mcBlUnitPrice_(b), pass ? String(pass.v[MC_RCV_C_['Поставщик']] || '') : 'Партия ' + b.v[0], reason);
      b.sh.getRange(b.row, 11).setValue('returned'); b.v[10] = 'returned';
      var ev = _mcBlEvent_(op, batchId, 'BATCH_RETURN', { qty: t.taken, unit: b.v[2], reason: reason, before: { status: st, remain: remain }, after: { status: 'returned', remain: 0 } });
      _mcCreateTraceLink_('BATCH', String(batchId), 'RETURN', 'SUPPLIER', String(b.v[18] || (pass && pass.v[MC_RCV_C_['Поставщик']]) || 'SUPPLIER'), { factId: ev, actor: _author_(op).фио, source: 'BATCH_RETURN', weight: t.taken, unit: b.v[2] });
      _audit_(op, 'BATCH_RETURN', 'Партия', String(batchId), { status: st, remain: remain }, { status: 'returned', reason: reason });
      _endOp_(op);
      return _ok_({ batchId: String(batchId), returned: t.taken, unit: b.v[2], eventId: ev }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Ошибочную операцию не правят: создаётся CORRECTION со ссылкой на неё. Для MOVE можно указать верное место. */
function correctBatchOperation(eventId, reason, toLocationId, token) {
  var op = null;
  try { op = _beginOp_(token, 'haccp', 'CORRECTION', 'Партия', eventId, null); } catch (e) { return _failFrom_(e); }
  try {
    reason = String(reason || '').trim();
    if (!reason) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите причину корректировки', op.id); }
    return _withLock_(function () {
      var v = _mcBlEvSheet_().getDataRange().getValues(), e = null;
      for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(eventId)) { e = v[i]; break; }
      if (!e) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Операция не найдена', op.id); }
      var batchId = String(e[2]), out = { batchId: batchId, corrects: String(eventId) };
      if (toLocationId) {
        if (String(e[3]) !== 'MOVE' && String(e[3]) !== 'STORAGE_ASSIGNED') { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Место исправляется только у перемещения или размещения', op.id); }
        var b = _mcBlRequire_(_bcFind_(batchId), batchId), loc = _mcBlLoc_(toLocationId);
        if (!loc || !loc.active) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Место хранения не найдено или отключено', op.id); }
        var from = String(b.v[14] || ''); _mcBlSetLocation_(b, loc.id);
        out.eventId = _mcBlEvent_(op, batchId, 'CORRECTION', { from: from, to: loc.id, reason: reason, corrects: String(eventId), before: { location: from }, after: { location: loc.id } });
        _mcCreateTraceLink_('BATCH', batchId, 'CORRECTION', 'LOCATION', loc.id, { factId: out.eventId, actor: _author_(op).фио, source: 'CORRECTION' });
        out.location = loc.name;
      } else out.eventId = _mcBlEvent_(op, batchId, 'CORRECTION', { reason: reason, corrects: String(eventId) });
      _audit_(op, 'CORRECTION', 'Партия', batchId, { eventId: eventId }, out);
      _endOp_(op);
      return _ok_(out, op.id);
    });
  } catch (e2) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e2, op && op.id); }
}

/** Печать этикетки партии (receipt) или вскрытия (opening): данные + запись LABEL_PRINT. */
function printBatchLabel(batchId, kind, copies, token) {
  var op = null;
  try { op = _mcBlOp_(token, ['stock', 'labels', 'kanban'], 'LABEL_PRINT', batchId); } catch (e) { return _failFrom_(e); }
  try {
    return _withLock_(function () {
      var d = _mcBlLabelData_(batchId, kind === 'opening' ? 'opening' : 'receipt');
      if (!d) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Партия не найдена', op.id); }
      var n = Math.max(1, Math.min(50, parseInt(copies, 10) || 1)), pass = _mcBlPass_(batchId);
      if (pass) { var k = d.kind === 'opening' ? 'Печатей этикетки вскрытия' : 'Печатей этикетки'; var f = {}; f[k] = _mcBlNum_(pass.v[MC_RCV_C_[k]]) + n; if (d.kind !== 'opening') f['Последняя печать'] = new Date(); _mcBlPassSet_(pass, f); }
      _mcBlEvent_(op, batchId, 'LABEL_PRINT', { qty: n, unit: 'шт', reason: d.kind === 'opening' ? 'этикетка вскрытия' : 'этикетка партии' });
      _endOp_(op);
      return _ok_({ label: d, copies: n }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function printOpeningLabel(batchId, copies, token) { return printBatchLabel(batchId, 'opening', copies, token); }

/* ---------- справочники: места хранения и профиль хранения продукта ---------- */
function mcGetStorageSetup(token) {
  try {
    var s = _mcBlAuth_(token, ['stock', 'haccp', 'kanban', 'journals']);
    var prof = _mcBlProfSheet_().getDataRange().getValues().slice(1).filter(function (r) { return r[0] || r[1]; }).map(function (r) { return { productId: r[0], name: r[1], type: r[2], defaultLocation: r[3], defaultLocationName: _mcBlLocName_(r[3]), afterOpenH: r[8], afterOpenBasis: r[9], requiresLabel: r[11], by: r[14] }; });
    return _ok_({ locations: _mcBlLocations_().map(function (l) { l.range = _mcBlRange_(l.tmin, l.tmax); l.typeRu = MC_BL_TYPE_RU_[l.type] || l.type; return l; }), types: MC_BL_TYPE_RU_, profiles: prof,
      canEdit: _mcRbHasExact_(s, 'stock|haccp') });
  } catch (e) { return _failFrom_(e); }
}
function mcSaveStorageLocation(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock|haccp', 'STORAGE_LOCATION_SAVE', 'Места хранения', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json), name = String(d.name || '').trim(), type = String(d.type || '');
    if (!name) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите название места', op.id); }
    if (!MC_BL_TYPE_RU_[type]) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Тип места: ' + Object.keys(MC_BL_TYPE_RU_).map(function (k) { return MC_BL_TYPE_RU_[k]; }).join(', '), op.id); }
    var tmin = d.tmin === '' || d.tmin === null || d.tmin === undefined ? '' : Number(d.tmin), tmax = d.tmax === '' || d.tmax === null || d.tmax === undefined ? '' : Number(d.tmax);
    if (tmin !== '' && tmax !== '' && tmin > tmax) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 't мин больше t макс', op.id); }
    return _withLock_(function () {
      var sh = _mcV22Locations_(), v = sh.getDataRange().getValues(), id = String(d.id || ''), row = -1;
      if (id) for (var i = 1; i < v.length; i++) if (String(v[i][0]) === id) { row = i + 1; break; }
      if (!id) { id = type + '-' + ('0' + (v.filter(function (r) { return String(r[0]).indexOf(type + '-') === 0; }).length + 1)).slice(-2); while (v.some(function (r) { return String(r[0]) === id; })) id += 'A'; }
      var r = [id, name, type, tmin, tmax, '', d.active === false ? 'INACTIVE' : 'ACTIVE', Number(d.priority || 10), String(d.note || '')];
      if (row > 0) sh.getRange(row, 1, 1, r.length).setValues([r]); else sh.appendRow(r);
      _audit_(op, 'STORAGE_LOCATION_SAVE', 'Места хранения', id, null, { name: name, type: type, tmin: tmin, tmax: tmax, active: r[6] });
      _endOp_(op);
      return _ok_({ id: id }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Типовые места (Холодильник №1 и т.д.) — только по явной кнопке ответственного; названия потом правятся. */
function mcSeedStorageLocations(token) {
  var op = null;
  try { op = _beginOp_(token, 'stock|haccp', 'STORAGE_LOCATION_SEED', 'Места хранения', null, null); } catch (e) { return _failFrom_(e); }
  try { var r = initMonChefV22Storage(); _endOp_(op); return r; } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function mcSaveProductStorage(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock|haccp', 'PRODUCT_STORAGE_SAVE', 'Профиль хранения', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json), name = String(d.name || '').trim();
    if (!name) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите продукт', op.id); }
    if (d.afterOpenH && !String(d.afterOpenBasis || '').trim()) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Для срока после вскрытия укажите основание', op.id); }
    if (d.defaultLocation && !_mcBlLoc_(d.defaultLocation)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Место хранения не найдено', op.id); }
    return _withLock_(function () {
      var who = _author_(op).фио, f = {};
      ['type', 'defaultLocation', 'allowed', 'tmin', 'tmax', 'shelfH', 'afterOpenH', 'afterOpenBasis', 'fefo', 'requiresLabel', 'requiresOpeningLabel', 'units'].forEach(function (k) { if (d[k] !== undefined) f[k] = d[k]; });
      if (f.afterOpenBasis) f.afterOpenBasis = f.afterOpenBasis + ' — утвердил ' + who;
      var p = _mcBlProfileSet_(name, d.productId || '', f, who);
      _audit_(op, 'PRODUCT_STORAGE_SAVE', 'Профиль хранения', p.productId, null, f);
      _endOp_(op);
      return _ok_(p, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Ежечасно: истёкшим партиям с остатком — событие BATCH_EXPIRED (один раз). FEFO и расход их уже не берут. */
function mcBatchExpiryWatchSystem() {
  var v = _stockBatchesSheet_().getDataRange().getValues(), done = {}, n = 0, now = new Date();
  _mcBlEvSheet_().getDataRange().getValues().forEach(function (r) { if (String(r[3]) === 'BATCH_EXPIRED') done[String(r[2])] = true; });
  var pv = {}; _mcRcvSheet_().getDataRange().getValues().forEach(function (r, i) { if (i && r[0]) pv[String(r[0])] = String(r[MC_RCV_C_['Срок с часами']]) === 'да'; });
  for (var i = 1; i < v.length && n < 200; i++) {
    var id = String(v[i][0]); if (!id || done[id] || String(v[i][10]) !== 'active' || _mcBlNum_(v[i][9]) <= 0) continue;
    var exp = _mcBlDate_(v[i][5]); if (!_mcBlExpired_(exp, pv[id], now)) continue;
    _mcBlEvent_(null, id, 'BATCH_EXPIRED', { reason: 'срок ' + _mcBlFmt_(exp, pv[id]) + ' истёк — использование запрещено', after: { status: 'EXPIRED' } }); n++;
  }
  return { ok: true, expired: n };
}

/** Сроки (§29): партии с остатком — жёлтые (скоро), красные (истёк), чёрные (карантин/блокировка). Только чтение. */
function mcBatchExpiryBoard(token) {
  try {
    _mcBlAuth_(token, ['stock', 'kanban', 'journals', 'labels']);
    var sh = _stockBatchesSheet_(), v = sh.getDataRange().getValues(), C = MC_RCV_C_, pass = {}, out = [], cnt = { green: 0, yellow: 0, red: 0, black: 0 };
    _mcRcvSheet_().getDataRange().getValues().forEach(function (r, i) { if (i && r[0]) pass[String(r[0])] = { v: r }; });
    var locs = {}; _mcBlLocations_().forEach(function (l) { locs[l.id] = l.name; });
    for (var i = 1; i < v.length; i++) {
      if (!v[i][0] || _mcBlNum_(v[i][9]) <= 0 || /^(consumed|returned|expired)$/.test(String(v[i][10]))) continue;
      var p = pass[String(v[i][0])] || null, st = _mcBlState_({ v: v[i], sh: sh, row: i + 1 }, p, []);
      if (cnt[st.level] !== undefined) cnt[st.level]++;
      if (st.level === 'green' || st.level === 'grey') continue;
      out.push({ batchId: String(v[i][0]), product: String(v[i][1]), status: st.status, statusRu: st.statusRu, level: st.level, expiry: st.expiry ? _mcBlFmt_(st.expiry, st.withTime) : '',
        ts: st.expiry ? st.expiry.getTime() : 9e15, remain: _mcBlQtyText_(v[i][9], v[i][2], p ? p.v[C['Ед.']] : ''), location: locs[String(v[i][14])] || String(v[i][14] || ''),
        opened: p && p.v[C['Вскрыто']] ? true : false });
    }
    var rank = { red: 0, black: 1, yellow: 2 };
    out.sort(function (a, b) { return (rank[a.level] - rank[b.level]) || (a.ts - b.ts); });
    return _ok_({ counts: cnt, items: out.slice(0, 300) });
  } catch (e) { return _failFrom_(e); }
}
