/**
 * MON CHEF — производственная среда: вода, отходы, борьба с вредителями.
 *
 * Вода:      источники → план контроля (показатель, периодичность, норматив, лаборатория)
 *            → результаты по протоколам лаборатории. «Не соответствует» — отклонение.
 * Отходы:    накопление (вид, тара, зона, количество) → вывоз (подрядчик, договор,
 *            документ). Вывоз без документа не принимается.
 * Вредители: план/договор (подрядчик, № договора, срок действия, периодичность)
 *            → осмотры и обработки (зона, препарат, акт, результат). «Обнаружено» —
 *            отклонение; обработка дублируется в журнал 3-Д (J14).
 * Результаты лаборатории и подрядчика вносятся по их документам: номер протокола/акта обязателен.
 */
var MC_ENV_ = {
  WSRC: ['Вода_Источники', ['SourceID', 'Название', 'Тип', 'Точка отбора', 'Ответственный', 'Статус', 'Обновлено', 'Кто']],
  WPLAN: ['Вода_План', ['PlanID', 'SourceID', 'Показатель', 'Периодичность, дней', 'Норматив', 'Лаборатория', 'Ответственный', 'Активен', 'Обновлено', 'Кто']],
  WCTL: ['Вода_Контроль', ['ControlID', 'SourceID', 'PlanID', 'Дата отбора', 'Лаборатория', 'Протокол №', 'Показатель', 'Факт', 'Норма', 'Результат', 'DeviationID', 'Сотрудник', 'Время', 'OperationID', 'FactID']],
  WASTE: ['Отходы', ['RecordID', 'Вид отходов', 'Тара/контейнер', 'Зона', 'Накоплено', 'Количество', 'Ед.', 'Вывезено', 'Подрядчик', 'Договор', 'Документ', 'Ответственный', 'Статус', 'OperationID', 'FactID']],
  PPLAN: ['Вредители_План', ['PlanID', 'Вид работ', 'Подрядчик', 'Договор №', 'Действует до', 'Периодичность, дней', 'Зоны', 'Статус', 'Обновлено', 'Кто']],
  PEV: ['Вредители_Мероприятия', ['EventID', 'PlanID', 'Тип', 'Дата', 'Зона', 'Препарат', 'Результат', 'Акт №', 'Исполнитель', 'DeviationID', 'Сотрудник', 'Время', 'OperationID', 'FactID']]
};
var MC_WASTE_MAX_DAYS_ = { 'пищевые': 1, 'ТКО': 3, 'масло фритюрное': 30, 'опасные': 30 };

function _envSh_(k) { return _bcSheet_(MC_ENV_[k][0], MC_ENV_[k][1]); }
function _envRows_(k) {
  var sh = _book_().getSheetByName(MC_ENV_[k][0]); if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getValues(), h = v[0];
  return v.slice(1).map(function (r, i) { var o = { _row: i + 2 }; h.forEach(function (c, j) { o[c] = r[j]; }); return o; }).filter(function (o) { return o[h[0]]; });
}
function _envId_(p) { return p + '-' + Date.now() + '-' + Utilities.getUuid().slice(0, 6); }
function _envParse_(json) { return typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}); }
function _envReq_(d, fields) {
  for (var i = 0; i < fields.length; i++) if (!String(d[fields[i][0]] === undefined || d[fields[i][0]] === null ? '' : d[fields[i][0]]).trim()) throw new Error('VALIDATION: ' + fields[i][1]);
}
function _envUpsert_(k, idField, id, row, op, action) {
  var sh = _envSh_(k), v = sh.getDataRange().getValues(), at = -1;
  for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(id)) { at = i + 1; break; }
  var before = at > 0 ? v[at - 1] : null;
  if (at > 0) sh.getRange(at, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
  _audit_(op, action, MC_ENV_[k][0], id, before, row);
}
function _envRun_(perm, type, fn) {
  var op = null, tok = arguments[3];
  try { op = _beginOp_(tok, perm, type, 'Производственная среда', null, null); op._tok = tok; } catch (e) { return _failFrom_(e); }
  try { var r = _withLock_(function () { return fn(op); }); _endOp_(op, 'COMPLETED'); return _ok_(r, op.id); }
  catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function _envWho_(op) { return (op && op.session && (op.session.name || op.session.fullName)) || ''; }
function _envDays_(x) { var t = x instanceof Date ? x : _parseDate_(x); return t && t.getTime ? Math.floor((Date.now() - t.getTime()) / 86400000) : null; }

// ---------------------------------------------------------------- вода
function mcEnvSaveWaterSource(json, token) {
  return _envRun_('haccp', 'WATER_SOURCE_SAVE', function (op) {
    var d = _envParse_(json); _envReq_(d, [['name', 'Укажите название источника'], ['point', 'Укажите точку отбора проб']]);
    var id = d.id || _envId_('WS');
    _envUpsert_('WSRC', 'SourceID', id, [id, d.name, d.type || 'централизованное водоснабжение', d.point, d.responsible || '', d.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE', new Date(), _envWho_(op)], op, 'WATER_SOURCE_SAVE');
    return { id: id };
  }, token);
}
function mcEnvSaveWaterPlan(json, token) {
  return _envRun_('haccp', 'WATER_PLAN_SAVE', function (op) {
    var d = _envParse_(json); _envReq_(d, [['sourceId', 'Выберите источник'], ['parameter', 'Укажите показатель'], ['periodDays', 'Укажите периодичность'], ['norm', 'Укажите норматив (документ, показатель, норма)']]);
    if (!(Number(d.periodDays) > 0)) throw new Error('VALIDATION: периодичность — число дней');
    if (!_envRows_('WSRC').some(function (s) { return String(s.SourceID) === String(d.sourceId); })) throw new Error('VALIDATION: источник не найден');
    var id = d.id || _envId_('WP');
    _envUpsert_('WPLAN', 'PlanID', id, [id, d.sourceId, d.parameter, Number(d.periodDays), d.norm, d.lab || '', d.responsible || '', d.active !== false, new Date(), _envWho_(op)], op, 'WATER_PLAN_SAVE');
    return { id: id };
  }, token);
}
/** Результат по протоколу лаборатории. result: PASS | FAIL (как в протоколе). */
function mcEnvRecordWaterControl(json, token) {
  return _envRun_('sanitation', 'WATER_CONTROL', function (op) {
    var d = _envParse_(json); _envReq_(d, [['planId', 'Выберите пункт плана'], ['sampledAt', 'Укажите дату отбора'], ['protocol', 'Укажите номер протокола лаборатории'], ['result', 'Укажите результат по протоколу']]);
    if (d.result !== 'PASS' && d.result !== 'FAIL') throw new Error('VALIDATION: результат — «соответствует» или «не соответствует»');
    var plan = _envRows_('WPLAN').filter(function (p) { return String(p.PlanID) === String(d.planId); })[0];
    if (!plan) throw new Error('VALIDATION: пункт плана не найден');
    var dt = _parseDate_(d.sampledAt); if (!dt) throw new Error('VALIDATION: дата отбора не распознана');
    if (dt.getTime() > Date.now() + 3600000) throw new Error('VALIDATION: дата отбора в будущем');
    var id = _envId_('WC'), who = _envWho_(op), devId = '';
    var factId = _bcFact_({ factType: 'WATER_CONTROL', objectType: 'WATER_SOURCE', objectId: plan.SourceID, operationType: 'LAB_PROTOCOL', dateTime: dt, value: d.actual || '',
      unit: '', result: d.result, source: 'WATER', employeeName: who, description: 'Вода: ' + plan['Показатель'] + ', протокол ' + d.protocol }, op.session);
    if (d.result === 'FAIL') {
      try { var dv = _mcOpenDeviationAndAction_({ journalId: 'WATER', objectId: plan.SourceID, value: d.actual || '', critical: true, description: 'Вода не соответствует: ' + plan['Показатель'] + ', протокол ' + d.protocol }, op.session, 'WATER', 'Несоответствие питьевой воды', 'HIGH'); devId = (dv && (dv.deviationId || dv.id)) || ''; } catch (e) {}
    }
    _envSh_('WCTL').appendRow([id, plan.SourceID, plan.PlanID, dt, d.lab || plan['Лаборатория'] || '', d.protocol, plan['Показатель'], d.actual || '', plan['Норматив'], d.result, devId, who, new Date(), op.id, factId]);
    _audit_(op, 'WATER_CONTROL', 'Вода', id, null, { plan: plan.PlanID, protocol: d.protocol, result: d.result });
    return { id: id, result: d.result, deviationId: devId, factId: factId };
  }, token);
}

// ---------------------------------------------------------------- отходы
function mcEnvWasteAccumulate(json, token) {
  return _envRun_('sanitation', 'WASTE_ACCUMULATE', function (op) {
    var d = _envParse_(json); _envReq_(d, [['type', 'Выберите вид отходов'], ['container', 'Укажите тару/контейнер'], ['area', 'Укажите зону'], ['qty', 'Укажите количество']]);
    var q = _bcNum_(d.qty); if (q === null || q <= 0) throw new Error('VALIDATION: количество — положительное число');
    var id = _envId_('WST'), who = _envWho_(op);
    var factId = _bcFact_({ factType: 'WASTE', objectType: 'WASTE', objectId: id, operationType: 'ACCUMULATE', dateTime: new Date(), value: q, unit: d.unit || 'кг', result: 'RECORDED', source: 'WASTE', employeeName: who, description: 'Отходы: ' + d.type + ', ' + d.area }, op.session);
    _envSh_('WASTE').appendRow([id, d.type, d.container, d.area, new Date(), q, d.unit || 'кг', '', '', '', '', who, 'НАКОПЛЕНО', op.id, factId]);
    _audit_(op, 'WASTE_ACCUMULATE', 'Отходы', id, null, { type: d.type, qty: q });
    return { id: id };
  }, token);
}
function mcEnvWasteRemove(json, token) {
  return _envRun_('sanitation', 'WASTE_REMOVE', function (op) {
    var d = _envParse_(json); _envReq_(d, [['id', 'Выберите запись'], ['contractor', 'Укажите подрядчика'], ['contract', 'Укажите договор'], ['document', 'Укажите документ вывоза (акт, талон)']]);
    var r = _envRows_('WASTE').filter(function (x) { return String(x.RecordID) === String(d.id); })[0];
    if (!r) throw new Error('NOT_FOUND: запись не найдена');
    if (r['Статус'] === 'ВЫВЕЗЕНО') throw new Error('VALIDATION: уже вывезено');
    var sh = _envSh_('WASTE');
    sh.getRange(r._row, 8, 1, 4).setValues([[new Date(), d.contractor, d.contract, d.document]]);
    sh.getRange(r._row, 13).setValue('ВЫВЕЗЕНО');
    _bcFact_({ factType: 'WASTE', objectType: 'WASTE', objectId: d.id, operationType: 'REMOVE', dateTime: new Date(), value: r['Количество'], unit: r['Ед.'], result: 'REMOVED', source: 'WASTE', employeeName: _envWho_(op), description: 'Вывоз отходов: ' + d.contractor + ', ' + d.document }, op.session);
    _audit_(op, 'WASTE_REMOVE', 'Отходы', d.id, 'НАКОПЛЕНО', { contractor: d.contractor, document: d.document });
    return { id: d.id, status: 'ВЫВЕЗЕНО' };
  }, token);
}

// ---------------------------------------------------------------- вредители
function mcEnvSavePestPlan(json, token) {
  return _envRun_('haccp', 'PEST_PLAN_SAVE', function (op) {
    var d = _envParse_(json); _envReq_(d, [['kind', 'Укажите вид работ'], ['contractor', 'Укажите подрядчика'], ['contract', 'Укажите номер договора'], ['validTo', 'Укажите срок действия договора'], ['periodDays', 'Укажите периодичность']]);
    var vt = _parseDate_(d.validTo); if (!vt) throw new Error('VALIDATION: срок действия договора не распознан');
    if (!(Number(d.periodDays) > 0)) throw new Error('VALIDATION: периодичность — число дней');
    var id = d.id || _envId_('PP');
    _envUpsert_('PPLAN', 'PlanID', id, [id, d.kind, d.contractor, d.contract, vt, Number(d.periodDays), d.zones || '', d.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE', new Date(), _envWho_(op)], op, 'PEST_PLAN_SAVE');
    return { id: id };
  }, token);
}
/** Осмотр или обработка. type: 'осмотр' | 'обработка'; result: 'не обнаружено' | 'обнаружено'. */
function mcEnvRecordPestEvent(json, token) {
  return _envRun_('sanitation', 'PEST_EVENT', function (op) {
    var d = _envParse_(json); _envReq_(d, [['planId', 'Выберите план/договор'], ['type', 'Укажите тип мероприятия'], ['zone', 'Укажите зону'], ['result', 'Укажите результат'], ['act', 'Укажите номер акта/записи подрядчика']]);
    if (d.type !== 'осмотр' && d.type !== 'обработка') throw new Error('VALIDATION: тип — осмотр или обработка');
    if (d.result !== 'не обнаружено' && d.result !== 'обнаружено') throw new Error('VALIDATION: результат — «не обнаружено» или «обнаружено»');
    if (d.type === 'обработка' && !String(d.agent || '').trim()) throw new Error('VALIDATION: для обработки укажите препарат');
    var plan = _envRows_('PPLAN').filter(function (p) { return String(p.PlanID) === String(d.planId); })[0];
    if (!plan) throw new Error('VALIDATION: план не найден');
    var vt = plan['Действует до'] instanceof Date ? plan['Действует до'] : _parseDate_(plan['Действует до']);
    if (vt && vt.getTime() < _bcToday0_().getTime()) throw new Error('CONTRACT_EXPIRED: договор ' + plan['Договор №'] + ' истёк — продлите договор в плане');
    var id = _envId_('PE'), who = _envWho_(op), devId = '';
    var factId = _bcFact_({ factType: 'PEST_CONTROL', objectType: 'AREA', objectId: d.zone, operationType: d.type, dateTime: new Date(), value: d.agent || '', result: d.result, source: 'PESTS', employeeName: who, description: 'Вредители: ' + d.type + ', ' + d.zone + ', акт ' + d.act }, op.session);
    if (d.result === 'обнаружено') {
      try { var dv = _mcOpenDeviationAndAction_({ journalId: 'J14', objectId: d.zone, value: d.result, critical: true, description: 'Обнаружены вредители: ' + d.zone + ', акт ' + d.act }, op.session, 'PESTS', 'Обнаружены вредители', 'HIGH'); devId = (dv && (dv.deviationId || dv.id)) || ''; } catch (e) {}
    }
    _envSh_('PEV').appendRow([id, plan.PlanID, d.type, new Date(), d.zone, d.agent || '', d.result, d.act, d.executor || plan['Подрядчик'], devId, who, new Date(), op.id, factId]);
    if (d.type === 'обработка') {
      try { _addJournalEntry_core_('J14', JSON.stringify({ 'Вид обработки': plan['Вид работ'], 'Площадь/помещение': d.zone, 'Препарат': d.agent, 'Организация': plan['Подрядчик'], 'Договор №': plan['Договор №'], 'Эффективность': d.result }), _envTok_(op)); } catch (e) {}
    }
    _audit_(op, 'PEST_EVENT', 'Вредители', id, null, { type: d.type, zone: d.zone, result: d.result, act: d.act });
    return { id: id, deviationId: devId, factId: factId };
  }, token);
}
function _envTok_(op) { return (op && op._tok) || ''; }

// ---------------------------------------------------------------- сводка
function _envState_() {
  var now = Date.now(), day = 86400000;
  var src = _envRows_('WSRC'), plans = _envRows_('WPLAN').filter(function (p) { return p['Активен'] !== false; }), ctl = _envRows_('WCTL');
  var wPlans = plans.map(function (p) {
    var last = null; ctl.forEach(function (c) { if (String(c.PlanID) === String(p.PlanID)) { var t = _parseDate_(c['Дата отбора']); if (t && (!last || t > last)) last = t; } });
    var src0 = src.filter(function (s) { return String(s.SourceID) === String(p.SourceID); })[0];
    var due = !last || now - last.getTime() > Number(p['Периодичность, дней']) * day;
    return { id: p.PlanID, source: src0 ? src0['Название'] : p.SourceID, parameter: p['Показатель'], period: p['Периодичность, дней'], norm: p['Норматив'], lab: p['Лаборатория'], last: last ? _bcDate_(last) : '', overdue: due };
  });
  var wCtl = ctl.slice(-50).reverse().map(function (c) { return { id: c.ControlID, date: _bcDate_(c['Дата отбора']), parameter: c['Показатель'], protocol: c['Протокол №'], result: c['Результат'], dev: c.DeviationID }; });
  var waste = _envRows_('WASTE').map(function (r) {
    var days = _envDays_(r['Накоплено']), max = MC_WASTE_MAX_DAYS_[r['Вид отходов']] || 3;
    return { id: r.RecordID, type: r['Вид отходов'], container: r['Тара/контейнер'], area: r['Зона'], qty: r['Количество'], unit: r['Ед.'], at: _bcDate_(r['Накоплено']), removed: _bcDate_(r['Вывезено']),
      contractor: r['Подрядчик'], document: r['Документ'], status: r['Статус'], overdue: r['Статус'] !== 'ВЫВЕЗЕНО' && days !== null && days > max };
  }).reverse().slice(0, 100);
  var pp = _envRows_('PPLAN').filter(function (p) { return p['Статус'] === 'ACTIVE'; }), pev = _envRows_('PEV');
  var pPlans = pp.map(function (p) {
    var last = null; pev.forEach(function (e) { if (String(e.PlanID) === String(p.PlanID)) { var t = e['Дата'] instanceof Date ? e['Дата'] : _parseDate_(e['Дата']); if (t && (!last || t > last)) last = t; } });
    var vt = p['Действует до'] instanceof Date ? p['Действует до'] : _parseDate_(p['Действует до']);
    return { id: p.PlanID, kind: p['Вид работ'], contractor: p['Подрядчик'], contract: p['Договор №'], validTo: _bcDate_(vt), expired: !!(vt && vt.getTime() < _bcToday0_().getTime()),
      period: p['Периодичность, дней'], last: last ? _bcDate_(last) : '', overdue: !last || now - last.getTime() > Number(p['Периодичность, дней']) * day };
  });
  var pEv = pev.slice(-50).reverse().map(function (e) { return { id: e.EventID, date: _bcDate_(e['Дата']), type: e['Тип'], zone: e['Зона'], agent: e['Препарат'], result: e['Результат'], act: e['Акт №'], dev: e.DeviationID }; });
  return { water: { sources: src.map(function (s) { return { id: s.SourceID, name: s['Название'], type: s['Тип'], point: s['Точка отбора'], status: s['Статус'] }; }), plans: wPlans, controls: wCtl },
    waste: { records: waste, open: waste.filter(function (x) { return x.status !== 'ВЫВЕЗЕНО'; }).length, overdue: waste.filter(function (x) { return x.overdue; }).length, types: Object.keys(MC_WASTE_MAX_DAYS_) },
    pests: { plans: pPlans, events: pEv } };
}
function mcEnvGet(token) { try { _requireAuth_(token); return _ok_(_envState_()); } catch (e) { return _failFrom_(e); } }
