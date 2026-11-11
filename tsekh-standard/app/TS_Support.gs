/**
 * ЦЕХ Стандарт — связь с управляющим контуром: обезличенная статистика, технические ошибки, диагностика по согласию.
 *   • usage.report — не чаще раза в сутки, после успешной проверки лицензии; только числа и версии, без ФИО, ТТК, адресов;
 *   • tech.event — очередь технических ошибок (имя функции и код ошибки), уходит вместе со статистикой;
 *   • диагностика поддержки: только после согласия директора (tsSupportConsent). Создаётся одноразовый ключ на время сессии;
 *     админ-панель по ключу получает сводку только для чтения (версии, состояние схемы, счётчики, ошибки) — ни строк таблиц,
 *     ни персональных данных. Ключ хранится хешем, истекает сам, директор может отозвать доступ досрочно.
 */
var TS_TECH_QUEUE_MAX_ = 30;

/** Поставить техническую ошибку в очередь (без персональных данных: имя функции, код, обрезанное сообщение без цифр длиннее 3). */
function _tsTechEvent_(code, fn, message) {
  try {
    var p = _tsProps_(), q = JSON.parse(p.getProperty('TS_TECH_QUEUE') || '[]');
    var msg = String(message || '').replace(/\d{4,}/g, '#').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '@').slice(0, 160);
    q.push({ at: Date.now(), code: String(code || 'ERROR').slice(0, 40), fn: String(fn || '').slice(0, 60), message: msg });
    p.setProperty('TS_TECH_QUEUE', JSON.stringify(q.slice(-TS_TECH_QUEUE_MAX_)));
  } catch (e) {}
}
/** Обезличенные показатели работы. */
function _tsUsageMetrics_() {
  var m = _tsUsageStats_(); delete m.lastBackup;
  try {
    if (typeof _ts2Rows_ === 'function' && _book_().getSheetByName('JOURNAL_EXPECTATIONS')) {
      m.expectationsOpen = _ts2FindAll_('JOURNAL_EXPECTATIONS', 'status', 'OPEN').length;
      m.exceptionsOpen = _ts2FindAll_('AUTO_RECORDS', 'recordType', 'DEVIATION', function (r) { return r.status === 'OPEN'; }).length;
      var rd = _ts2Rows_('READINESS_RUNS').pop(); m.readiness = rd ? rd.status + ' ' + rd.passCount + '/' + (Number(rd.passCount) + Number(rd.failCount)) : '';
      m.enterpriseType = _ts2Prof_('enterpriseType', '');
    }
  } catch (e) {}
  try {   // какая версия реестра нормативов у предприятия и сколько действующих документов с истёкшим сроком
    var pp = _tsProps_(); m.normsVersion = pp.getProperty('TS_LS_REMOTE_VER') || pp.getProperty('TS_LS_NORMS_VER') || '';
    if (typeof _tsLsRows_ === 'function' && pp.getProperty('TS_LS_SEEDED')) { var td = Utilities.formatDate(new Date(), _mcTz_(), 'yyyy-MM-dd');
      m.normsExpired = _tsLsRows_('norms').filter(function (n) { var vt = n['Действует до'] instanceof Date ? Utilities.formatDate(n['Действует до'], _mcTz_(), 'yyyy-MM-dd') : String(n['Действует до'] || '').slice(0, 10); return n['Статус'] === 'ДЕЙСТВУЕТ' && vt && vt <= td; }).length; }
  } catch (e) {}
  return m;
}
/** После успешной проверки лицензии: раз в сутки статистика, очередь ошибок — сразу. Сбой связи не мешает работе. */
function _tsAfterCheck_() {
  var p = _tsProps_(), now = Date.now();
  try {
    var q = JSON.parse(p.getProperty('TS_TECH_QUEUE') || '[]');
    if (q.length) {
      q.slice(0, 10).forEach(function (ev) { _tsControlCall_({ action: 'tech.event', level: 'ERROR', code: ev.code, message: (ev.fn ? ev.fn + ': ' : '') + ev.message, version: TS_VERSION }); });
      p.setProperty('TS_TECH_QUEUE', JSON.stringify(q.slice(10)));
    }
  } catch (e) {}
  // реестр нормативов из админ-панели: отменённые документы и новые сроки доходят до предприятия в течение суток
  try { if (typeof _tsLsNormsRemote_ === 'function') _tsLsNormsRemote_(false); } catch (e) { try { _tsTechEvent_('NORMS_SYNC', '_tsLsNormsRemote_', e && e.message || e); } catch (x) {} }
  try {
    var last = Number(p.getProperty('TS_USAGE_SENT_AT') || 0);
    if (now - last > 20 * 3600000) { _tsControlCall_({ action: 'usage.report', metrics: _tsUsageMetrics_(), version: TS_VERSION }); p.setProperty('TS_USAGE_SENT_AT', String(now)); }
  } catch (e) {}
}

/* ------------------------------------------------------------------ диагностика по согласию */
function _tsDiagState_() { try { return JSON.parse(_tsProps_().getProperty('TS_SUPPORT_DIAG') || 'null'); } catch (e) { return null; } }
/** Выдать ключ диагностики (вызывается при согласии). Возвращает открытый ключ — он уходит только в админ-панель по подписанному каналу. */
function _tsDiagIssue_(sessionId, until) {
  var key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  _tsProps_().setProperty('TS_SUPPORT_DIAG', JSON.stringify({ sessionId: sessionId, hash: _tsDiagHash_(key), until: Number(until) }));
  return key;
}
function _tsDiagHash_(key) { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'TSDIAG|' + key, Utilities.Charset.UTF_8)); }
function _tsDiagRevoke_() { var p = _tsProps_(); p.deleteProperty('TS_SUPPORT_DIAG'); p.deleteProperty('TS_SUPPORT_UNTIL'); }
/** Страница doGet ?diag=<ключ>: сводка только для чтения. Неверный или истёкший ключ — отказ без подробностей. */
function _tsDiagPage_(key) {
  var out = function (o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); };
  var st = _tsDiagState_();
  if (!st || !key || st.until < Date.now() || _tsDiagHash_(String(key)) !== st.hash) return out({ ok: false, error: 'доступ не разрешён или истёк' });
  var d = { ok: true, at: new Date().toISOString(), sessionId: st.sessionId, until: new Date(st.until).toISOString(), version: TS_VERSION };
  try { var lic = _tsLicense_(false); d.license = { plan: lic.plan, status: lic.status, mode: lic.mode, daysLeft: lic.daysLeft }; } catch (e) { d.license = { error: String(e.message || e).slice(0, 100) }; }
  try { d.usage = _tsUsageMetrics_(); } catch (e) {}
  try {
    var ss = _book_(); d.sheets = ss.getSheets().map(function (s) { return { name: s.getName(), rows: Math.max(0, s.getLastRow() - 1), cols: s.getLastColumn() }; });
    if (typeof TS2_ENTERPRISE_SCHEMA_ !== 'undefined') d.schema = { version: TS2_SCHEMA_VERSION, missing: Object.keys(TS2_ENTERPRISE_SCHEMA_).filter(function (n) { return !ss.getSheetByName(n); }) };
  } catch (e) {}
  try { d.triggers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }); } catch (e) {}
  try {
    if (typeof _ts2Rows_ === 'function' && _book_().getSheetByName('RECONCILIATION_ISSUES')) {
      var iss = _ts2Rows_('RECONCILIATION_ISSUES', function (i) { return i.status === 'OPEN'; }), by = {};
      iss.forEach(function (i) { by[i.severity + ' ' + i.ruleId] = (by[i.severity + ' ' + i.ruleId] || 0) + 1; }); d.reconciliation = by;
      d.backups = _ts2Rows_('BACKUP_CATALOG').slice(-5).map(function (b) { return { type: b.backupType, at: b.createdAt, status: b.status }; });
      var v = _ts2VerifyAudit_(); d.audit = { records: v.records, broken: v.broken.length };
      d.mode = _ts2Prof_('mode', '');
    }
  } catch (e) {}
  try { d.techEvents = JSON.parse(_tsProps_().getProperty('TS_TECH_QUEUE') || '[]').slice(-20); } catch (e) {}
  try { if (typeof _ts2Audit_ === 'function') _ts2Audit_('SUPPORT_DIAGNOSTICS_READ', 'SUPPORT_SESSION', st.sessionId, undefined, { sections: Object.keys(d) }, 'чтение диагностики поддержкой'); } catch (e) {}
  return out(d);
}
/** Директор отзывает доступ поддержки досрочно. */
function tsSupportRevoke(token) {
  try {
    _requireAuth_(token, 'org_edit'); var st = _tsDiagState_(); _tsDiagRevoke_();
    if (typeof _ts2Audit_ === 'function') { try { _ts2Audit_('SUPPORT_REVOKE', 'SUPPORT_SESSION', st ? st.sessionId : '', undefined, { revoked: true }, 'отозвано предприятием'); } catch (e) {} }
    try { if (st) _tsControlCall_({ action: 'support.consent', sessionId: st.sessionId, allow: false, revoke: true, by: 'предприятие' }); } catch (e) {}
    return _ok_({ revoked: true });
  } catch (e) { return _failFrom_(e); }
}
