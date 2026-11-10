/**
 * ЦЕХ Стандарт Admin — журналирование всех действий и ошибок.
 * Типы событий: LOGIN, LOGIN_FAIL, ERROR, CHANGE, PAYMENT, USER, DELETE, UPDATE, LICENSE, NOTIFY, BACKUP, API.
 */
function logEvent(type, admin, object, text) {
  try { sheet('Logs').appendRow([new Date(), type, admin || 'система', object || '', String(text || '').slice(0, 2000)]); } catch (e) { console.log('log fail ' + e); }
}
function logError(source, message, details) {
  try { sheet('Errors').appendRow([new Date(), source, String(message || '').slice(0, 1000), String(details || '').slice(0, 3000)]); } catch (e) { console.log('error log fail ' + e); }
}
/** Логи с фильтром: тип, текст, период. */
function adminLogs(token, f) {
  try {
    requireRole(token, 'logs.view'); f = f || {};
    var src = f.kind === 'errors' ? readAll('Errors').map(function (r) { return { 'Дата': r['Дата'], 'Тип': 'ERROR', 'Администратор': r['Источник'], 'Объект': '', 'Описание': r['Сообщение'] + (r['Детали'] ? ' — ' + r['Детали'] : '') }; }) : readAll('Logs');
    var q = String(f.q || '').toLowerCase(), from = f.from || '', to = f.to || '';
    var out = src.filter(function (r) {
      if (f.type && f.type !== 'ALL' && r['Тип'] !== f.type) return false;
      var d = String(r['Дата']).slice(0, 10);
      if (from && d < from) return false; if (to && d > to) return false;
      if (q && JSON.stringify(r).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).reverse().slice(0, 500);
    return ok(out);
  } catch (e) { return fail(e); }
}
