/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
/**
 * ЦЕХ Стандарт — модель полномочий P1-2: веб-приложение выполняется от имени открывшего его Google-аккаунта.
 *   • Фоновые задачи (триггеры) Apps Script работают от имени того, кто их установил. В режиме USER_ACCESSING
 *     их включает директор предприятия из приложения — задачи, архивы и резервные копии создаются от имени клиента.
 *   • Поставщик фоновые задачи клиента не ставит; CONTROL управляет только кодом и версиями.
 *   • ScriptApp.getProjectTriggers() показывает только триггеры текущего пользователя.
 */
var TS_EXEC_HANDLERS_ = ['monChefFrequentTick', 'monChefHourlyTick'];
function _tsExecStatus_() {
  var mine = []; try { mine = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }); } catch (e) {}
  var c = TS_TENANT_CONFIG_ || {};
  return { mode: typeof _tsExecAccessing_ === 'function' && _tsExecAccessing_() ? 'USER_ACCESSING' : (c.mode === '1' ? 'USER_DEPLOYING' : 'LEGACY'),
    account: typeof _tsIdentity_ === 'function' ? _tsIdentity_() : '', ownerEmail: String(c.ownerEmail || ''),
    background: TS_EXEC_HANDLERS_.map(function (h) { return { handler: h, installed: mine.indexOf(h) >= 0 }; }), allInstalled: TS_EXEC_HANDLERS_.every(function (h) { return mine.indexOf(h) >= 0; }) };
}
function tsExecStatus(token) { try { _requireAuth_(token); return _ok_(_tsExecStatus_()); } catch (e) { return _failFrom_(e); } }
/** Включить фоновые задачи от имени текущего Google-аккаунта (директор предприятия). */
function tsBackgroundEnable(token) {
  try {
    _requireAuth_(token, 'org_edit');
    if (typeof _tsExecAccessing_ === 'function' && _tsExecAccessing_()) {
      var me = _tsIdentity_(), owner = String((TS_TENANT_CONFIG_ || {}).ownerEmail || '').toLowerCase();
      if (!me || me !== owner) return _fail_('VALIDATION', 'Фоновые задачи включает владелец предприятия (' + owner + ') — войдите в Google под этим аккаунтом');
    }
    var r = installAllTriggers();
    try { if (typeof _ts2Audit_ === 'function') _ts2Audit_('BACKGROUND_ENABLE', 'TRIGGERS', 'ALL', undefined, { account: _tsIdentity_ ? _tsIdentity_() : '', installed: r && r.installedTriggers }, 'фоновые задачи включены'); } catch (e) {}
    return _ok_(_tsExecStatus_());
  } catch (e) { return _failFrom_(e); }
}
