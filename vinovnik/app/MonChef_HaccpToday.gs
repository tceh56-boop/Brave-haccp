/**
 * MON CHEF — этап 10.8. Уведомления по типам и панель «ХАССП — сегодня».
 * Собственность Слепцова Дениса Владимировича.
 * Разработчик кода — Слепцов Денис Владимирович
 *
 * Уведомление закрывается не тем, что его отправили или прочитали, а условием: повторный замер в норме,
 * отклонение устранено, проверка выполнена. Пока условие не выполнено — повтор и эскалация по настройке.
 */
var MC_NT_SET_SHEET_ = 'Уведомления_Настройки';
var MC_NT_SET_HEAD_ = ['Код', 'Тип', 'Типы уведомлений', 'Кому', 'Приоритет', 'Срок реакции, мин', 'Повтор, мин', 'Повторов не больше', 'Эскалация кому', 'Эскалация через, мин', 'Закрывается', 'Условие (системное)', 'Активно', 'Изменено', 'Кто'];
/** Значения по умолчанию — раздел 8 ТЗ 10.8 (каждое меняется в настройках). */
var MC_NT_DEFAULTS_ = [
  ['temp', 'Температура вне предела', 'temperature_deviation', 'Шеф-повар', 'critical', 30, 30, 8, 'Ответственный за ХАССП, Директор', 120, 'повторный замер в норме и корректирующее действие', 'temp'],
  ['missed', 'Пропущенная проверка', 'journal_overdue', 'Шеф-повар', 'high', 60, 0, 0, 'Шеф-повар', 60, 'внесён замер или проверка отменена', 'pending'],
  ['vsd', 'Непогашенный ВСД', 'vsd_unpaid', 'Ответственный за ХАССП', 'high', 1440, 1440, 30, 'Директор', 1440, 'ВСД погашен или отклонён (этап 10.7)', 'vsd'],
  ['expiry', 'Срок годности ≤ 3 дн. / истёк', 'expiring_product, processing_expiry', 'Шеф-повар', 'medium', 480, 1440, 7, 'Ответственный за ХАССП', 1440, 'партия использована, списана или возвращена', ''],
  ['cleaning', 'Уборка не выполнена', 'cleaning_missed', 'Шеф-повар', 'medium', 240, 0, 0, 'Шеф-повар', 240, 'подтверждение уборки', 'pending'],
  ['training', 'Обучение истекает', 'training_expiring, medbook', 'Ответственный за ХАССП', 'medium', 20160, 10080, 4, 'Директор', 20160, 'запись о прохождении', ''],
  ['equipment', 'Неисправность оборудования', 'haccp_equipment, equipment_fault', 'Шеф-повар', 'high', 240, 0, 0, 'Директор', 240, 'допуск к работе', ''],
  ['calibration', 'Поверка или проверка прибора истекает', 'calibration_due', 'Ответственный за ХАССП', 'medium', 20160, 10080, 4, 'Директор', 20160, 'запись проверки', ''],
  ['ccp', 'Отклонение ККТ', 'critical_incident, haccp_critical, defrost_deviation, journal_deviation', 'Шеф-повар, Ответственный за ХАССП', 'critical', 0, 30, 8, 'Директор', 120, 'корректирующее действие и повторный замер / решение по партии', 'deviation'],
  ['solution', 'Раствор вне нормы', 'solution_out', 'Ответственный за ХАССП', 'high', 30, 0, 0, 'Шеф-повар', 30, 'повторный замер в норме', 'deviation'],
  ['ca', 'КД просрочено', 'ca_overdue', 'Ответственный за ХАССП', 'high', 1440, 1440, 7, 'Директор', 1440, 'закрыто ХАССП', 'deviation'],
  ['doc', 'Документ на пересмотр', 'ttk_review, doc_review', 'Ответственный за ХАССП', 'low', 43200, 10080, 4, 'Директор', 43200, 'новая версия утверждена', ''],
  ['lamp', 'Лампа: ресурс ≤ 10 %, обслуживание', 'lamp_resource, lamp_low, lamp_expired', 'Ответственный за ХАССП', 'medium', 10080, 10080, 4, 'Шеф-повар', 10080, 'замена подтверждена', ''],
  ['fryer', 'Фритюр: проверка масла', 'fryer_check, haccp_control', 'Повар горячего цеха', 'medium', 480, 0, 0, 'Шеф-повар', 480, 'проверка внесена', 'pending']
];
var MC_NT_EXTRA_HEAD_ = ['Повторов', 'Последнее напоминание', 'Эскалация', 'Закрыто', 'Причина закрытия'];

function _mcNtSetSheet_() {
  var sh = _bcSheet_(MC_NT_SET_SHEET_, MC_NT_SET_HEAD_);
  if (sh.getLastRow() < 2) sh.getRange(2, 1, MC_NT_DEFAULTS_.length, MC_NT_SET_HEAD_.length).setValues(MC_NT_DEFAULTS_.map(function (r) { return r.concat([true, new Date(), 'по умолчанию (ТЗ 10.8)']); }));
  return sh;
}
function _mcNtRules_() {
  return _mcNtSetSheet_().getDataRange().getValues().slice(1).filter(function (r) { return r[0]; }).map(function (r, i) {
    return { row: i + 2, code: String(r[0]), name: String(r[1]), types: String(r[2]).split(/[,;]\s*/).filter(Boolean), to: String(r[3]), priority: String(r[4]), react: Number(r[5]) || 0,
      repeat: Number(r[6]) || 0, maxRepeat: Number(r[7]) || 0, escTo: String(r[8] || ''), escAfter: Number(r[9]) || 0, closes: String(r[10]), cond: String(r[11] || ''), active: r[12] !== false && String(r[12]) !== 'нет' };
  });
}
function _mcNtRuleOf_(rules, type) { for (var i = 0; i < rules.length; i++) if (rules[i].active && rules[i].types.indexOf(String(type)) >= 0) return rules[i]; return null; }
function _mcNtSheet_() { var sh = _notificationsSheet_(); try { _tEnsureHead_(sh, ['notification_id', 'event_key', 'Тип', 'Важность', 'Заголовок', 'Текст', 'Получатель(роль)', 'Статус', 'operation_id', 'Создано', 'Прочитано'].concat(MC_NT_EXTRA_HEAD_)); } catch (e) {} return sh; }

/** Выполнено ли условие закрытия (true — закрыть, строка — причина), null — условие системой не проверяется. */
function _mcNtCondition_(rule, n, cache) {
  var key = String(n.key || ''), id = key.split('|').slice(1).join('|');
  var rows = function (name) { if (!cache[name]) { var sh = _book_().getSheetByName(name); cache[name] = sh ? sh.getDataRange().getValues() : []; } return cache[name]; };
  if (!rule || !rule.cond) return null;
  if (rule.cond === 'temp' && /^temp\|/.test(key)) {
    var t = rows(MC_T_SHEET_).filter(function (r) { return String(r[0]) === id; })[0];
    return t ? (/^(RECHECK_OK|RELEASED|REJECTED|CLOSED)$/.test(String(t[19])) ? 'повторный замер в норме / решение принято' : false) : null;
  }
  if (rule.cond === 'pending' && /^(joverdue|jreminder)\|/.test(key)) {
    var p = rows('Журналы_Ожидания').filter(function (r) { return String(r[0]) === id; })[0];
    return p ? (/^(выполнено|отменено)$/.test(String(p[8])) ? 'проверка ' + p[8] : false) : null;
  }
  if (rule.cond === 'deviation' && /^(deviation|incident|haccp_critical)\|/.test(key)) {
    var d = rows('Журналы_Отклонения').filter(function (r) { return String(r[0]) === id; })[0];
    return d ? (/устран|закрыт/i.test(String(d[7])) ? 'отклонение ' + d[7] : false) : null;
  }
  return null;
}
/** Закрываемые только условием: прочтение их не закрывает. */
function _mcNtByCondition_(type) { var r = _mcNtRuleOf_(_mcNtRules_(), type); return !!(r && r.cond && r.cond !== 'vsd'); }

/** По расписанию: закрыть выполненные, повторить и эскалировать незакрытые. */
function mcNotifyTick() {
  var rules = _mcNtRules_(), sh = _mcNtSheet_(), v = sh.getDataRange().getValues(), now = Date.now(), cache = {}, out = { closed: 0, repeated: 0, escalated: 0 };
  for (var i = 1; i < v.length; i++) {
    var st = String(v[i][7]); if (!v[i][0] || st === 'CLOSED') continue;
    var rule = _mcNtRuleOf_(rules, v[i][2]); if (!rule) continue;
    var n = { id: v[i][0], key: v[i][1], type: v[i][2] }, c = _mcNtCondition_(rule, n, cache);
    if (c) { sh.getRange(i + 1, 8).setValue('CLOSED'); sh.getRange(i + 1, 15, 1, 2).setValues([[new Date(), c]]); out.closed++; continue; }
    if (c === null && st === 'READ') continue;                  // условие системой не проверяется — прочитано достаточно
    var created = v[i][9] && v[i][9].getTime ? v[i][9].getTime() : now, last = v[i][12] && v[i][12].getTime ? v[i][12].getTime() : created, rep = Number(v[i][11]) || 0;
    if (rule.repeat > 0 && (now - last) / 60000 >= rule.repeat && (!rule.maxRepeat || rep < rule.maxRepeat)) {
      sh.getRange(i + 1, 8).setValue('NEW'); sh.getRange(i + 1, 12, 1, 2).setValues([[rep + 1, new Date()]]); out.repeated++;
    }
    if (rule.escTo && !v[i][13] && (now - created) / 60000 >= Math.max(rule.escAfter, rule.react)) {
      rule.escTo.split(/[,;]\s*/).filter(Boolean).forEach(function (role) {
        _notify_(String(v[i][2]), rule.priority === 'critical' ? 'critical' : 'warning', 'Эскалация: ' + v[i][4], v[i][5] + ' — не закрыто за ' + Math.round((now - created) / 60000) + ' мин (' + rule.closes + ').', role, 'esc|' + v[i][0] + '|' + role, null);
      });
      if (rule.priority === 'critical' && /Директор/.test(rule.escTo)) try { _mcRbAlertOwner_('Эскалация: ' + v[i][4], v[i][5] + '\nНе закрыто: ' + rule.closes); } catch (e) {}
      sh.getRange(i + 1, 14).setValue(new Date()); out.escalated++;
    }
  }
  return JSON.stringify({ ok: true, result: out });
}
function mcNotifySettings(token) {
  try { _requireAuth_(token, 'haccp_view|audit_view'); return _ok_({ rules: _mcNtRules_(), roles: Object.keys(MC_RB_MATRIX_).filter(function (r) { return r !== MC_RB_LEGACY_COOK_; }) }); } catch (e) { return _failFrom_(e); }
}
function mcNotifySettingsSave(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'haccp|haccp_approve', 'NOTIFY_SETTINGS', 'Уведомления', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), rules = _mcNtRules_(), r = rules.filter(function (x) { return x.code === String(d.code); })[0];
    if (!r) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Тип уведомления не найден', op.id); }
    var num = function (x, def) { var n = Number(x); return x === undefined || x === '' ? def : (isFinite(n) && n >= 0 ? n : NaN); };
    var vals = { to: d.to !== undefined ? String(d.to).trim() : r.to, priority: d.priority || r.priority, react: num(d.react, r.react), repeat: num(d.repeat, r.repeat), maxRepeat: num(d.maxRepeat, r.maxRepeat),
      escTo: d.escTo !== undefined ? String(d.escTo).trim() : r.escTo, escAfter: num(d.escAfter, r.escAfter), active: d.active === undefined ? r.active : d.active !== false };
    if (['critical', 'high', 'medium', 'low'].indexOf(vals.priority) < 0) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Приоритет: critical, high, medium, low', op.id); }
    if ([vals.react, vals.repeat, vals.maxRepeat, vals.escAfter].some(function (x) { return isNaN(x); })) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Сроки и повторы — неотрицательные числа (минуты)', op.id); }
    if (!vals.to) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите, кому отправлять', op.id); }
    var who = (op.session && (op.session.fullName || op.session.name)) || '';
    return _withLock_(function () {
      _mcNtSetSheet_().getRange(r.row, 4, 1, 12).setValues([[vals.to, vals.priority, vals.react, vals.repeat, vals.maxRepeat, vals.escTo, vals.escAfter, r.closes, r.cond, vals.active, new Date(), who]]);
      _audit_(op, 'NOTIFY_SETTINGS', 'Уведомления', r.code, { to: r.to, priority: r.priority, react: r.react, repeat: r.repeat, escTo: r.escTo, escAfter: r.escAfter }, vals);
      _endOp_(op);
      return _ok_({ code: r.code }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ============================== ПАНЕЛЬ «ХАССП — СЕГОДНЯ» ============================== */
var MC_HT_ST_ = { ok: 'ВСЁ ВЫПОЛНЕНО', part: 'ЕСТЬ НЕЗАВЕРШЁННОЕ', bad: 'НАРУШЕНИЕ', none: 'НЕТ ДАННЫХ' };
function _mcHtCard_(key, title, state, lines, go) { return { key: key, title: title, state: state, status: MC_HT_ST_[state], lines: lines.filter(Boolean), go: go || null }; }
function _mcHaccpToday_(s) {
  var tz = _mcTz_(), now = new Date(), today = Utilities.formatDate(now, tz, 'yyyy-MM-dd'), nowMin = _hm2min_(Utilities.formatDate(now, tz, 'HH:mm')), cards = [];
  var allowJ = function (jid) { return !s || _mcRbJournalAllowed_(s, jid); };
  var pv = _pendSheet_().getDataRange().getValues().slice(1).filter(function (r) { return r[0] && (_jfIso_(r[5]) === today) && String(r[8]) !== 'отменено' && allowJ(String(r[2])); });
  var isDone = function (r) { return String(r[8]) === 'выполнено'; }, isLate = function (r) { var dl = _hm2min_(r[7]); return !isDone(r) && dl !== null && nowMin > dl; };
  // 1. проверки на сегодня
  var done = pv.filter(isDone), late = pv.filter(isLate), devs = done.filter(function (r) { return r[13]; }), lateCrit = late.filter(function (r) { return r[22] === true; });
  cards.push(_mcHtCard_('checks', 'Проверки на сегодня', !pv.length ? 'none' : (lateCrit.length || devs.length) ? 'bad' : done.length < pv.length ? 'part' : 'ok',
    ['выполнено ' + done.length + ' из ' + pv.length, late.length ? 'просрочено: ' + late.length + (lateCrit.length ? ' (критических ' + lateCrit.length + ')' : '') : '', devs.length ? 'с отклонением: ' + devs.length : ''], { module: 'journals' }));
  // 2. температуры: объекты с проверками, замеры сегодня, открытые отклонения
  var objs = _tObjects_().filter(function (o) { return o.status === 'ACTIVE' && MC_T_SCHEDULED_[o.type] && allowJ(MC_T_SCHEDULED_[o.type]); });
  var tm = _tRows_(), tToday = tm.filter(function (r) { return _jfIso_(r.at) === today || String(r.at).slice(0, 10) === Utilities.formatDate(now, tz, 'dd.MM.yyyy'); });
  var measured = {}; tToday.forEach(function (r) { measured[String(r.objectId)] = true; });
  var tOpen = tm.filter(function (r) { return r.status === 'OPEN' || r.status === 'RECHECK_FAIL'; }), tWait = tm.filter(function (r) { return r.status === 'RECHECK_OK' && !r.decision; });
  var tLate = pv.filter(function (r) { return /^TQ-/.test(String(r[1])) && isLate(r); });
  cards.push(_mcHtCard_('temps', 'Температуры', !objs.length ? 'none' : tOpen.length ? 'bad' : (tLate.length || objs.some(function (o) { return !measured[o.id]; })) ? 'part' : 'ok',
    ['объектов ' + objs.length + ', замерено сегодня ' + objs.filter(function (o) { return measured[o.id]; }).length, tLate.length ? 'не выполнено по графику: ' + tLate.length : '', tOpen.length ? 'вне предела, без повторного замера: ' + tOpen.length : '',
     tWait.length ? 'ждут решения: ' + tWait.length : '', !objs.length ? 'объекты не заведены — замеров нет' : ''], { module: 'temperatures' }));
  if (!s || _mcRbHasExact_(s, 'stock_view|haccp_view')) {
    var ex = {}; try { ex = JSON.parse(getStockExpirySummary()); } catch (e) {}
    cards.push(_mcHtCard_('expiry', 'Сроки годности', (ex.expired || 0) ? 'bad' : (ex.expiringSoon || 0) ? 'part' : (ex.totalActive ? 'ok' : 'none'),
      ['активных партий ' + (ex.totalActive || 0), ex.expiringSoon ? 'истекает в 3 дня: ' + ex.expiringSoon : '', ex.expired ? 'истёк срок, есть остаток: ' + ex.expired : ''], { section: 'stock' }));
  }
  var dv = _devSheet_().getDataRange().getValues().slice(1).filter(function (r) { return r[0] && !/устран|закрыт/i.test(String(r[7])); });
  var dvCrit = dv.filter(function (r) { return r[6] === true || String(r[6]) === 'true'; });
  cards.push(_mcHtCard_('ca', 'Отклонения и корректирующие действия', dvCrit.length ? 'bad' : dv.length ? 'part' : 'ok', ['открыто: ' + dv.length, dvCrit.length ? 'критических: ' + dvCrit.length : ''], { module: 'journals' }));
  if (!s || _mcRbHasExact_(s, 'mercury|vsd_cancel|vsd_view')) {
    var nv = _notificationsSheet_().getDataRange().getValues().slice(1).filter(function (r) { return String(r[2]) === 'vsd_unpaid' && String(r[7]) === 'NEW'; });
    var nvo = _notificationsSheet_().getDataRange().getValues().slice(1).filter(function (r) { return String(r[2]) === 'vsd_overdue' && String(r[7]) !== 'CLOSED' && String(r[7]) !== 'READ'; });
    cards.push(_mcHtCard_('vsd', 'ВСД', nvo.length ? 'bad' : nv.length ? 'part' : 'ok', ['непогашенных накладных: ' + nv.length, nvo.length ? 'просрочено гашение: ' + nvo.length : ''], { module: 'supplydocs' }));
  }
  var cl = pv.filter(function (r) { return /^J(09|10|11|12|13)$/.test(String(r[2])); }), clLate = cl.filter(isLate), clDone = cl.filter(isDone);
  cards.push(_mcHtCard_('cleaning', 'Уборки и чек-листы смены', !cl.length ? 'none' : clLate.some(function (r) { return r[22] === true; }) ? 'bad' : clDone.length < cl.length ? 'part' : 'ok',
    ['выполнено ' + clDone.length + ' из ' + cl.length, clLate.length ? 'просрочено: ' + clLate.length : '', !cl.length ? 'чек-лист смены ещё не сформирован (формируется после входа)' : ''], { module: 'journals' }));
  if (!s || _mcRbHasExact_(s, 'haccp_view|medical_view|personnel')) {
    var med = []; try { med = _medList_(); } catch (e) {}
    var medBad = med.filter(function (x) { return /просроч|нет/i.test(String(x.status || '')); }), medSoon = med.filter(function (x) { return /истекает|скоро/i.test(String(x.status || '')); });
    var tr = []; try { tr = _trainingSheet_().getDataRange().getValues().slice(1).filter(function (r) { return r[0]; }); } catch (e) {}
    var trBad = tr.filter(function (r) { var t = _jfIso_(r[6]); return t && t < today; });
    cards.push(_mcHtCard_('training', 'Обучение и медкнижки', (medBad.length || trBad.length) ? 'bad' : medSoon.length ? 'part' : (med.length ? 'ok' : 'none'),
      ['медкнижек ' + med.length, medBad.length ? 'просрочено / нет допуска: ' + medBad.length : '', medSoon.length ? 'истекает: ' + medSoon.length : '', trBad.length ? 'обучение просрочено: ' + trBad.length : ''], { module: 'staff' }));
  }
  var eq = []; try { eq = _mcEqList_(); } catch (e) {}
  var eqBad = eq.filter(function (x) { return x.effective === 'BLOCKED' || x.status === 'REPAIR'; }), eqSoon = eq.filter(function (x) { return x.measuring && x.daysLeft !== null && x.daysLeft >= 0 && x.daysLeft <= 14; });
  cards.push(_mcHtCard_('equipment', 'Оборудование и приборы', eqBad.length ? 'bad' : eqSoon.length ? 'part' : (eq.length ? 'ok' : 'none'),
    ['в реестре ' + eq.length, eqBad.length ? 'нельзя использовать: ' + eqBad.map(function (x) { return x.name; }).slice(0, 3).join(', ') : '', eqSoon.length ? 'поверка в 14 дней: ' + eqSoon.length : ''], { module: 'equipment' }));
  if (!s || _mcRbHasExact_(s, 'haccp|haccp_view')) {
    var bc = {}; try { bc = _bcControlList_(); } catch (e) {}
    var inc = []; try { inc = _incSheet_().getDataRange().getValues().slice(1).filter(function (r) { return r[0] && !/закрыт/i.test(String(r[9])); }); } catch (e) {}
    var wait = (bc.quarantine || []).length + (bc.recheck || []).length + tWait.length + inc.length;
    cards.push(_mcHtCard_('decisions', 'Решения ответственного', inc.length ? 'bad' : wait ? 'part' : 'ok',
      [(bc.quarantine || []).length ? 'партий в карантине: ' + bc.quarantine.length : '', (bc.recheck || []).length ? 'на повторном контроле: ' + bc.recheck.length : '', tWait.length ? 'температуры ждут решения: ' + tWait.length : '', inc.length ? 'критических инцидентов: ' + inc.length : '', !wait ? 'решений не ждёт ничего' : ''], { module: 'batchcontrol' }));
  }
  var worst = cards.some(function (c) { return c.state === 'bad'; }) ? 'bad' : cards.some(function (c) { return c.state === 'part' || c.state === 'none'; }) ? 'part' : 'ok';
  return { date: _jfRu_(today), overall: MC_HT_ST_[worst], state: worst, cards: cards };
}
function mcHaccpToday(token) {
  try {
    var s = _requireAuth_(token, 'journals|haccp_view|audit_view'), r = _mcHaccpToday_(s);
    try { CacheService.getScriptCache().put('mc_htoday_' + String(s.user_id || s.name || ''), JSON.stringify({ state: r.state, overall: r.overall }), 300); } catch (e) {}
    return _ok_(r);
  } catch (e) { return _failFrom_(e); }
}
