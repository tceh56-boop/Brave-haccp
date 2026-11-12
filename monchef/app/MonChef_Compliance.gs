/**
 * MON CHEF — проверки соответствия перед критическими операциями.
 *
 * 1. Допуск сотрудника (Employee Compliance Gate): медосмотр и гигиеническая
 *    аттестация по листу «Медкнижки». Статусы: ADMITTED / LIMITED / BLOCKED / EXPIRED.
 *    Сотрудник с пищевой ролью без действующего допуска не может вносить записи
 *    журналов, HACCP, бракераж, производство и склад (проверка в едином шлюзе).
 * 2. Приборы (Equipment Registry): поверка/калибровка измерительных приборов.
 *    Измерение прибором с истёкшей поверкой не принимается.
 * 3. Дезсредства: концентрация рабочего раствора и контроль — только по
 *    утверждённому (APPROVED) режиму; результат вычисляет сервер.
 */
// этап 10.7: пищевые роли по ТЗ (работа с продукцией); прежний «Повар» — до выбора цеха
var MC_FOOD_ROLES_ = ['Шеф-повар', 'Су-шеф', 'Кондитер', 'Повар холодного цеха', 'Повар горячего цеха', 'Ответственный за ХАССП', 'Повар'];
var MC_GATE_MED_PERMS_ = ['journals', 'brakerage', 'kanban', 'haccp', 'sanitation', 'stock', 'checklists', 'batch_use', 'receiving', 'prod_manage', 'labels'];
var MC_MED_GATE_PROP_ = 'MC_MEDICAL_GATE';     // 'off' — отключить (по умолчанию включено)
var _MC_ADM_CACHE = null;

function _mcNameKey_(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim(); }
function _mcMedGateOn_() { try { return String(PropertiesService.getScriptProperties().getProperty(MC_MED_GATE_PROP_) || 'on') !== 'off'; } catch (e) { return true; } }

/** Допуск сотрудника по ФИО. */
function _mcAdmissionByName_(name) {
  if (!_MC_ADM_CACHE) {
    _MC_ADM_CACHE = {};
    try { _medList_().forEach(function (x) { _MC_ADM_CACHE[_mcNameKey_(x.name)] = x; }); } catch (e) {}
  }
  var key = _mcNameKey_(name), x = _MC_ADM_CACHE[key];
  if (!x) { // совпадение по фамилии и имени (в сессии может не быть отчества)
    var parts = key.split(' ').slice(0, 2).join(' ');
    Object.keys(_MC_ADM_CACHE).some(function (k) { if (k.indexOf(parts) === 0) { x = _MC_ADM_CACHE[k]; return true; } return false; });
  }
  if (!x) return { status: 'BLOCKED', reason: 'нет записи медкнижки' };
  if (x.status === 'Просрочено') return { status: 'EXPIRED', reason: 'медосмотр или аттестация просрочены', item: x };
  if (x.status === 'Нет данных') return { status: 'BLOCKED', reason: 'медкнижка заполнена не полностью', item: x };
  if (/ограничен|не допуск|limited/i.test(String(x.notes || ''))) return { status: 'LIMITED', reason: 'ограничения: ' + x.notes, item: x };
  return { status: 'ADMITTED', reason: x.status === 'Истекает' ? 'срок скоро истекает' : '', item: x };
}

/**
 * Проверка из единого шлюза перед операцией записи. Возвращает текст запрета или ''.
 */
function _mcComplianceGate_(fnName, session, perm) {
  if (!session || !perm || session.dev) return '';
  var keys = String(perm).split('|'); if (!keys.some(function (k) { return MC_GATE_MED_PERMS_.indexOf(k) >= 0; })) return '';
  if (MC_FOOD_ROLES_.indexOf(_mcRbNormRole_(session.role)) < 0) return '';
  if (!_mcMedGateOn_()) return '';
  var a = _mcAdmissionByName_(session.name || session.fullName || '');
  if (a.status === 'ADMITTED' || (a.status === 'LIMITED' && /(^|\|)(stock|receiving)(\||$)/.test(perm))) return '';
  return 'Нет медицинского допуска (' + a.status + ': ' + a.reason + '). Запись от имени «' + (session.name || '') + '» не принимается — обратитесь к медработнику или администратору.';
}

function mcGetMyAdmission(token) {
  try { var s = _requireAuth_(token); return _ok_({ name: s.name, role: s.role, gate: MC_FOOD_ROLES_.indexOf(s.role) >= 0 && _mcMedGateOn_(), admission: _mcAdmissionByName_(s.name) }); }
  catch (e) { return _failFrom_(e); }
}

// ---------------------------------------------------------------- приборы
var MC_EQ_SHEET_ = 'Оборудование_Реестр';
var MC_EQ_HEAD_ = ['EquipmentID', 'Наименование', 'Модель', 'Заводской №', 'Место', 'Ответственный', 'Измерительный (да/нет)',
  'Диапазон', 'Точность', 'Дата поверки', 'Следующая поверка', 'Документ поверки', 'Статус', 'Обновлено', 'Кто'];
function _mcEqSheet_() {
  var ss = _book_(), sh = ss.getSheetByName(MC_EQ_SHEET_);
  if (!sh) { sh = ss.insertSheet(MC_EQ_SHEET_); sh.getRange(1, 1, 1, MC_EQ_HEAD_.length).setValues([MC_EQ_HEAD_]).setFontWeight('bold'); sh.setFrozenRows(1); }
  return sh;
}
function _mcEqList_() {
  var v = _mcEqSheet_().getDataRange().getValues(), out = [], t0 = _bcToday0_();
  for (var i = 1; i < v.length; i++) {
    if (!v[i][0]) continue;
    var meas = String(v[i][6]).toLowerCase() === 'да' || v[i][6] === true, next = _parseDate_(v[i][10]);
    var st = String(v[i][12] || 'ACTIVE'), eff = st;
    if (st === 'ACTIVE' && meas && (!next || next.getTime() < t0.getTime())) eff = 'BLOCKED';
    out.push({ id: v[i][0], name: v[i][1], model: v[i][2], serial: v[i][3], location: v[i][4], responsible: v[i][5], measuring: meas,
      range: v[i][7], accuracy: v[i][8], calibrated: _bcDate_(v[i][9]), nextCalibration: _bcDate_(v[i][10]), document: v[i][11],
      status: st, effective: eff, reason: eff === 'BLOCKED' && st === 'ACTIVE' ? (next ? 'поверка истекла ' + _bcDate_(next) : 'нет даты следующей поверки') : '',
      daysLeft: next ? Math.round((next.getTime() - t0.getTime()) / 86400000) : null });
  }
  return out;
}
/** Прибор пригоден для измерения? { ok, reason } */
function _mcEquipmentUsable_(equipmentId) {
  if (!equipmentId) return { ok: true };
  var e = _mcEqList_().filter(function (x) { return String(x.id) === String(equipmentId); })[0];
  if (!e) return { ok: false, reason: 'прибор ' + equipmentId + ' не найден в реестре' };
  if (e.effective !== 'ACTIVE') return { ok: false, reason: '«' + e.name + '»: ' + (e.reason || 'статус ' + e.status) };
  return { ok: true, item: e };
}
function _mcAssertEquipment_(equipmentId) {
  var u = _mcEquipmentUsable_(equipmentId);
  if (!u.ok) throw new Error('EQUIPMENT_BLOCKED: измерение не принимается — ' + u.reason);
  return u;
}
function mcGetEquipment(token) { try { _requireAuth_(token); return _ok_({ items: _mcEqList_() }); } catch (e) { return _failFrom_(e); } }
function mcSaveEquipment(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'haccp', 'EQUIPMENT_SAVE', 'Оборудование', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    if (!String(d.name || '').trim()) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите наименование прибора', op.id); }
    var meas = d.measuring === true || d.measuring === 'да';
    var cal = d.calibrated ? _parseDate_(d.calibrated) : '', next = d.nextCalibration ? _parseDate_(d.nextCalibration) : '';
    if (meas && (!cal || !next)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Для измерительного прибора укажите дату поверки и дату следующей поверки (по свидетельству)', op.id); }
    if (meas && !String(d.document || '').trim()) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите документ поверки (номер свидетельства)', op.id); }
    return _withLock_(function () {
      var sh = _mcEqSheet_(), v = sh.getDataRange().getValues(), row = -1, id = d.id || ('EQ-' + Date.now() + '-' + Utilities.getUuid().slice(0, 6));
      for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(id)) { row = i + 1; break; }
      var who = (op.session && (op.session.name || op.session.fullName)) || '';
      var r = [id, d.name, d.model || '', d.serial || '', d.location || '', d.responsible || '', meas ? 'да' : 'нет', d.range || '', d.accuracy || '',
        cal || '', next || '', d.document || '', d.status === 'RETIRED' || d.status === 'REPAIR' ? d.status : 'ACTIVE', new Date(), who];
      var before = row > 0 ? v[row - 1].slice(0, 13) : null;
      if (row > 0) sh.getRange(row, 1, 1, r.length).setValues([r]); else sh.appendRow(r);
      _audit_(op, 'EQUIPMENT_SAVE', 'Оборудование', id, before, r.slice(0, 13));
      _endOp_(op, 'COMPLETED');
      return _ok_({ id: id }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

// ---------------------------------------------------------------- дезсредства
/** Утверждённый режим для средства (режим APPROVED, средство APPROVED и разрешено в общепите). */
function _mcDsApprovedRegime_(disinfectantId, regimeId) {
  setupV41Disinfectants();
  var d = _v42Find_('Дезсредства_V41', 'DisinfectantID', disinfectantId);
  if (!d) throw new Error('VALIDATION: дезсредство не найдено');
  if (String(d.ApprovalStatus) !== 'APPROVED' || String(d.AllowedForCatering) !== 'YES')
    throw new Error('DISINFECTANT_NOT_APPROVED: средство «' + (d.ProductName || disinfectantId) + '» не утверждено для общепита — использовать нельзя');
  var sh = _book_().getSheetByName('Дезсредства_Режимы_V41'), v = sh ? sh.getDataRange().getValues() : [], h = v[0] || [], out = null;
  for (var i = 1; i < v.length; i++) {
    var r = {}; h.forEach(function (k, j) { r[k] = v[i][j]; });
    if (String(r.DisinfectantID) !== String(disinfectantId) || String(r.ApprovalStatus) !== 'APPROVED') continue;
    if (regimeId && String(r.RegimeID) !== String(regimeId)) continue;
    out = r; break;
  }
  if (!out) throw new Error('REGIME_NOT_APPROVED: для средства нет утверждённого режима' + (regimeId ? ' ' + regimeId : '') + ' — произвольная концентрация не допускается');
  var range = _v42ParsePercentRange_(out.ConcentrationRaw);
  if (!range) throw new Error('REGIME_NOT_APPROVED: в утверждённом режиме не указана концентрация в %');
  return { regime: out, disinfectant: d, range: range };
}
/** Утвердить режим применения (по инструкции производителя). */
function mcApproveDisinfectantRegime(regimeId, token) {
  var op = null;
  try { op = _beginOp_(token, 'sanitation', 'DS_REGIME_APPROVE', 'Дезсредства', regimeId, null); } catch (e) { return _failFrom_(e); }
  try {
    var s = op.session; if (!_mcRbHasExact_(s, 'haccp')) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', '403 — режим утверждает ответственный за ХАССП или директор (было: шеф-повар, руководитель или администратор', op.id); }
    var sh = _book_().getSheetByName('Дезсредства_Режимы_V41'); if (!sh) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Режимов нет', op.id); }
    var v = sh.getDataRange().getValues(), h = v[0];
    for (var i = 1; i < v.length; i++) if (String(v[i][h.indexOf('RegimeID')]) === String(regimeId)) {
      if (!_v42ParsePercentRange_(v[i][h.indexOf('ConcentrationRaw')])) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'В режиме нет концентрации в % — утвердить нельзя', op.id); }
      var before = v[i][h.indexOf('ApprovalStatus')];
      sh.getRange(i + 1, h.indexOf('ApprovalStatus') + 1).setValue('APPROVED');
      _audit_(op, 'DS_REGIME_APPROVE', 'Дезсредства', regimeId, before, 'APPROVED');
      _endOp_(op, 'COMPLETED'); return _ok_({ regimeId: regimeId, status: 'APPROVED' }, op.id);
    }
    _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Режим не найден', op.id);
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
