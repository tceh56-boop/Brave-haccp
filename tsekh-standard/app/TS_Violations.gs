/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
/**
 * ЦЕХ Стандарт — единый контур нарушений (Мастер-промт 4.0, этап 6).
 *
 * Единый реестр — существующие листы «Журналы_Отклонения» и «Корректирующие_Действия» (их читают сводка, отчёты, KPI,
 * «ХАССП сегодня», подпись журналов, пакет проверки). Новых реестров нет. Сюда же попадают нарушения, которые раньше
 * жили только в своём модуле: исключения экрана «Сейчас» (TS2 AUTO_RECORDS), нарушения санитарии V43, «Нет» по задачам ППК.
 * Ссылка на источник — колонка «ID ожидания» (TS2:<id> / V43:<id>); статус источника синхронизируется.
 *
 * Жизненный цикл: открыто → (корректирующее действие) ожидает проверки → (проверка ДРУГИМ сотрудником) устранено
 *                 или «открыто повторно». Режим «проверяет тот же сотрудник» включает только директор (профиль автоматизации).
 * Критическое нарушение по-прежнему закрывает ответственный решением по инциденту (resolveCriticalIncident).
 */
var VIO_ST_ = { OPEN: 'открыто', VERIFY: 'ожидает проверки', CLOSED: 'устранено', REOPENED: 'открыто повторно' };
var VIO_CLOSED_RE_ = /устран|закрыт|отмен|closed|cancel/i;

function _vioMode_() { try { return typeof _ts2Prof_ === 'function' ? String(_ts2Prof_('VIOLATION_VERIFY', 'SECOND_PERSON')) : 'SECOND_PERSON'; } catch (e) { return 'SECOND_PERSON'; } }
function _vioRow_(pred) {
  var sh = _devSheet_(), v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (v[i][0] && pred(v[i])) return { sh: sh, row: i + 1, v: v[i] };
  return null;
}
function _vioById_(devId) { return _vioRow_(function (r) { return String(r[0]) === String(devId); }); }
function _vioBySource_(ref) { return _vioRow_(function (r) { return String(r[1]) === String(ref); }); }

/** Открыть нарушение (или вернуть уже открытое по той же ссылке источника). */
function _vioOpen_(o) {
  if (o.source) { var ex = _vioBySource_(o.source); if (ex) return String(ex.v[0]); }
  var devId = 'DV-' + Date.now() + '-' + Math.floor(Math.random() * 1000), now = new Date();
  _devSheet_().appendRow([devId, o.source || '', o.journal || '', o.object || '', o.text || '', o.value === undefined ? '' : o.value, !!o.critical, VIO_ST_.OPEN, o.taskId || '', '', o.who || '', now, '', o.operationId || '']);
  _corrSheet_().appendRow(['CA-' + Date.now() + '-' + Math.floor(Math.random() * 1000), devId, 'Устранить нарушение, выполнить корректирующее действие и приложить доказательство.', o.who || '', '', 'ОТКРЫТО', '', o.who || '', now, '']);
  if (o.onOpen) { try { o.onOpen(devId); } catch (e) {} }
  return devId;
}
/** Кто записал последнее корректирующее действие по нарушению. */
function _vioCorrector_(devId) {
  var v = _corrSheet_().getDataRange().getValues(), who = '';
  for (var i = 1; i < v.length; i++) if (String(v[i][1]) === String(devId) && /выполнен/i.test(String(v[i][5]))) who = String(v[i][7] || '');
  return who;
}
/** Статус источника: TS2 (исключение экрана «Сейчас»), V43 (санитария). */
function _vioSyncSource_(ref, state, note) {
  var m = /^(TS2|V43|V42|V44):(.+)$/.exec(String(ref || '')); if (!m) return;
  try {
    if (m[1] === 'TS2' && typeof _ts2Update_ === 'function') _ts2Update_('AUTO_RECORDS', 'autoRecordId', m[2], { status: { VERIFY: 'VERIFY_REQUIRED', CLOSED: 'RESOLVED', REOPENED: 'OPEN' }[state] || 'OPEN' });
    if (m[1] === 'V43' && typeof _v43SetRow_ === 'function') {
      var a = _v43Rows_(V43_SAN.ALERT).filter(function (r) { return String(r.AlertID) === m[2]; })[0]; if (!a) return;
      var patch = { Status: { VERIFY: 'VERIFY_REQUIRED', CLOSED: 'CLOSED', REOPENED: 'REOPENED' }[state] || 'OPEN', Message: String(a.Message) + (note ? ' | ' + note : '') };
      if (state === 'CLOSED') patch.ResolvedAt = new Date();
      _v43SetRow_('ALERT', m[2], patch);
    }
    if (m[1] === 'V42' || m[1] === 'V44') {
      // лист сигналов модуля: AlertID | AlertType | ObjectID | … | Status (7-я колонка) | … ResolvedAt (последняя)
      var sh = _book_().getSheetByName(m[1] === 'V42' ? 'Санитария_Алерты_V42' : 'Задачи_Алерты_V44'); if (!sh) return;
      var v = sh.getDataRange().getValues(), w = v[0].length, key = m[2].split(':'), st = { VERIFY: 'VERIFY_REQUIRED', CLOSED: 'CLOSED', REOPENED: 'OPEN' }[state] || 'OPEN';
      for (var i = 1; i < v.length; i++) {
        var hit = key.length === 1 ? String(v[i][0]) === key[0] : String(v[i][1]) === key[0] && String(v[i][2]) === key.slice(1).join(':');
        if (!hit || /CLOSED|RESOLVED/.test(String(v[i][6]))) continue;
        sh.getRange(i + 1, 7).setValue(st); if (state === 'CLOSED') sh.getRange(i + 1, w).setValue(new Date());
      }
    }
  } catch (e) { try { _log_('WARN', 'статус источника нарушения ' + ref + ': ' + e.message); } catch (x) {} }
}
/** Корректирующее действие: нарушение → «ожидает проверки» (или «устранено», если директор разрешил самопроверку). */
function _vioCorrect_(devId, d, who) {
  var act = String(d.action || '').trim(); if (!act) throw new Error('VALIDATION: опишите корректирующее действие');
  var r = _vioById_(devId); if (!r) throw new Error('NOT_FOUND: нарушение не найдено');
  var st = String(r.v[7]);
  if (VIO_CLOSED_RE_.test(st)) throw new Error('VALIDATION: нарушение уже закрыто');
  if (st === VIO_ST_.VERIFY) throw new Error('VALIDATION: устранение уже записано — нарушение ждёт проверки');
  var critical = r.v[6] === true || String(r.v[6]).toUpperCase() === 'TRUE', now = new Date();
  _corrSheet_().appendRow(['CA' + Date.now(), devId, act, d.executor || who, d.due || '', 'выполнено', d.evidence || '', who, now, d.operationId || '']);
  try { var csh = _corrSheet_(), cv = csh.getDataRange().getValues(); for (var i = 1; i < cv.length; i++) if (String(cv[i][1]) === String(devId) && /^открыт/i.test(String(cv[i][5]))) csh.getRange(i + 1, 6).setValue('выполнено'); } catch (e) {}
  var self = _vioMode_() === 'SELF' && !critical, next = self ? 'CLOSED' : 'VERIFY';
  r.sh.getRange(r.row, 8).setValue(self ? VIO_ST_.CLOSED : VIO_ST_.VERIFY); if (self) r.sh.getRange(r.row, 13).setValue(now);
  // корректирующее действие — и в регулируемый журнал J34 (как прежде)
  try { if (typeof _addCorrectiveAction_ === 'function') _addCorrectiveAction_(Utilities.formatDate(now, _mcTz_(), 'dd.MM.yyyy'), Utilities.formatDate(now, _mcTz_(), 'HH:mm'), String(r.v[3] || ''), String(r.v[4] || ''), String(d.cause || ''), act, d.executor || who); } catch (e) {}
  _vioSyncSource_(r.v[1], next, 'Устранено: ' + act + ' (' + (who || '—') + ', ' + Utilities.formatDate(now, _mcTz_(), 'dd.MM.yyyy HH:mm') + ')');
  return { devId: devId, status: self ? VIO_ST_.CLOSED : VIO_ST_.VERIFY, critical: critical };
}
/** Проверка устранения: другой сотрудник; критическое — только с правом ХАССП. Не подтверждено — «открыто повторно». */
function _vioVerify_(devId, ok, comment, who, session) {
  var r = _vioById_(devId); if (!r) throw new Error('NOT_FOUND: нарушение не найдено');
  if (String(r.v[7]) !== VIO_ST_.VERIFY) throw new Error('VALIDATION: проверять можно нарушение «ожидает проверки»');
  var corrector = _vioCorrector_(devId);
  if (_vioMode_() !== 'SELF' && corrector && who && corrector === who) throw new Error('VALIDATION: устранение подтверждает другой сотрудник');
  var critical = r.v[6] === true || String(r.v[6]).toUpperCase() === 'TRUE';
  if (critical && session && typeof _mcRbHas_ === 'function' && !_mcRbHas_(session, 'haccp|haccp_approve')) throw new Error('FORBIDDEN: критическое нарушение подтверждает ответственный за ХАССП');
  ok = ok === true || String(ok) === 'true';
  if (!ok && !String(comment || '').trim()) throw new Error('VALIDATION: укажите, что не устранено');
  r.sh.getRange(r.row, 8).setValue(ok ? VIO_ST_.CLOSED : VIO_ST_.REOPENED); if (ok) r.sh.getRange(r.row, 13).setValue(new Date());
  _corrSheet_().appendRow(['VR' + Date.now(), devId, 'Проверка устранения: ' + (ok ? 'подтверждено' : 'не подтверждено') + (comment ? ' — ' + comment : ''), who, '', ok ? 'проверено' : 'ОТКРЫТО', '', who, new Date(), '']);
  _vioSyncSource_(r.v[1], ok ? 'CLOSED' : 'REOPENED', 'Проверка: ' + (ok ? 'подтверждено' : 'не подтверждено') + (comment ? ' — ' + comment : '') + ' (' + (who || '—') + ')');
  return { devId: devId, status: ok ? VIO_ST_.CLOSED : VIO_ST_.REOPENED };
}

/* ------------------------------------------------------------------ адаптеры источников */
/** Исключение экрана «Сейчас» (TS2) → нарушение. Замер холодильника уже записан модулем температур — связывается, не дублируется. */
function _vioFromTs2_(rec, type, text, objectId, opts) {
  opts = opts || {};
  if (opts.deviationId) { var lr = _vioById_(opts.deviationId); if (lr && !lr.v[1]) lr.sh.getRange(lr.row, 2).setValue('TS2:' + rec.autoRecordId); return opts.deviationId; }
  var e = null; try { e = objectId ? _ts2Find_('JOURNAL_EXPECTATIONS', 'expectationId', objectId) : null; } catch (x) {}
  return _vioOpen_({ source: 'TS2:' + rec.autoRecordId, journal: (e && e.journalCode) || 'J-DEVIATIONS', object: (e && e.title) || String(objectId || type), text: text, critical: /KKT|CCP|CRITICAL/.test(type), who: rec.confirmedByEmployee || '',
    onOpen: function (devId) { if (e && e.objectType === 'PPK_SCHEDULE' && typeof _v65Objs_ === 'function') { var s = _v65Objs_('SCH').filter(function (x) { return x.ScheduleID === e.objectId; })[0]; if (s) _v65SetCell_('SCH', s._row, 'DeviationID', devId); } } });
}
function _vioFromV43_(alertId, type, obj, sev, msg) {
  return _vioOpen_({ source: 'V43:' + alertId, journal: 'Санитария', object: String(obj || ''), text: msg, critical: /CRIT/i.test(String(sev)), who: (typeof _v43Who_ === 'function' ? _v43Who_().name : '') || '' });
}

/** Сигналы V42 (растворы) и V44 (задачи) — в реестр только нарушения, не складские сигналы.
 *  Сигнал, который модуль создаёт повторно при каждом запуске (просроченный раствор), — одна запись по «вид:объект». */
function _vioFromAlert_(mod, alertId, type, obj, sev, msg) {
  if (mod === 'V42' && !/CONCENTRATION|EXPIRED/.test(String(type))) return '';
  if (mod === 'V44' && !/FAILED/.test(String(type))) return '';
  var src = mod === 'V42' && !/CONCENTRATION/.test(String(type)) ? 'V42:' + type + ':' + obj : mod + ':' + alertId;
  return _vioOpen_({ source: src, journal: mod === 'V42' ? 'Дезсредства' : 'Задачи', object: String(obj || ''), text: msg, critical: /CRIT/i.test(String(sev)), who: (typeof _v43Who_ === 'function' ? _v43Who_().name : '') || '' });
}

/* ------------------------------------------------------------------ API */
function _vioWho_(s) { return (s && (s.fullName || s.name || s.user_id)) || ''; }
/** Нарушения в работе: открытые и ожидающие проверки (все источники). */
function vioList(token) {
  try {
    _requireAuth_(token);
    var v = _devSheet_().getDataRange().getValues(), out = [];
    for (var i = v.length - 1; i >= 1 && out.length < 300; i--) { var r = v[i]; if (!r[0] || VIO_CLOSED_RE_.test(String(r[7]))) continue;
      out.push({ id: r[0], source: String(r[1] || '').split(':')[0] || 'журналы', journal: r[2], object: r[3], text: r[4], value: r[5], critical: r[6] === true, status: r[7], foundBy: r[10], at: r[11] instanceof Date ? r[11].toISOString() : String(r[11] || ''), corrector: String(r[7]) === VIO_ST_.VERIFY ? _vioCorrector_(r[0]) : '' }); }
    return _ok_({ items: out, mode: _vioMode_() });
  } catch (e) { return _failFrom_(e); }
}
function vioCorrect(token, devId, action, evidence) {
  try { var s = _requireAuth_(token, 'haccp|prod_manage|sanitation|journals'); return _withLock_(function () { var r = _vioCorrect_(devId, { action: action, evidence: evidence }, _vioWho_(s)); _ts2AuditSafe_('VIOLATION_CORRECT', devId, r); return _ok_(r); }); } catch (e) { return _failFrom_(e); }
}
function vioVerify(token, devId, ok, comment) {
  try { var s = _requireAuth_(token, 'haccp|haccp_approve|prod_manage|sanitation'); return _withLock_(function () { var r = _vioVerify_(devId, ok, comment, _vioWho_(s), s); _ts2AuditSafe_('VIOLATION_VERIFY', devId, r); return _ok_(r); }); } catch (e) { return _failFrom_(e); }
}
/** Режим проверки: SECOND_PERSON (по умолчанию) или SELF — для предприятия из одного ответственного; меняет только директор. */
function vioSetVerifyMode(token, mode) {
  try { _requireAuth_(token, 'org_edit'); mode = String(mode || '').toUpperCase(); if (['SECOND_PERSON', 'SELF'].indexOf(mode) < 0) return _fail_('VALIDATION', 'Режим — SECOND_PERSON или SELF');
    var was = _vioMode_(); _ts2SetProf_('VIOLATION_VERIFY', mode); _ts2AuditSafe_('VIOLATION_VERIFY_MODE', 'PROFILE', { was: was, now: mode }); return _ok_({ mode: mode }); } catch (e) { return _failFrom_(e); }
}
function _ts2AuditSafe_(action, id, after) { try { if (typeof _ts2Audit_ === 'function') _ts2Audit_(action, 'VIOLATION', String(id), undefined, after, ''); } catch (e) {} }
