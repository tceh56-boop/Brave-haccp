/**
 * MonChef License API — журнал обращений (API_AUDIT) и административный журнал (ADMIN_LOG).
 *
 * В API_AUDIT пишется только то, что нужно для лицензирования и разбора инцидентов (ТЗ, п. 6):
 * без clientToken, хешей токенов, содержимого документов, паролей, IP-адресов и персональных данных.
 * Ошибка записи журнала не ломает ответ клиенту.
 */

function writeAudit_(rec) {
  try {
    mcStore_().appendAudit({
      timestamp: mcNowIso_(),
      requestId: mcClip_(rec.requestId, 128),
      licenseId: mcClip_(rec.licenseId, 64),
      clientId: mcClip_(rec.clientId, 64),
      installationId: mcClip_(rec.installationId, 128),
      action: mcClip_(rec.action, 40),
      documentId: mcClip_(rec.documentId, 64),
      module: mcClip_(rec.module, 64),
      result: rec.result || '',
      errorCode: rec.errorCode || '',
      appVersion: mcClip_(rec.appVersion, 40),
      apiVersion: mcCfg_('MC_API_VERSION'),
      durationMs: rec.durationMs || 0
    });
  } catch (e) {
    try { console.error('API_AUDIT: запись не выполнена'); } catch (x) {}
  }
}

/** Административный журнал. actor — владелец, запустивший функцию в редакторе, или «API». */
function writeAdminLog_(action, licenseId, documentId, details) {
  var actor = 'API';
  try { actor = Session.getActiveUser().getEmail() || 'API'; } catch (e) {}
  try {
    mcStore_().appendAdminLog({ timestamp: mcNowIso_(), actor: actor, action: action, licenseId: licenseId || '',
      documentId: documentId || '', details: mcClip_(details, 1000) });
  } catch (e) {
    try { console.error('ADMIN_LOG: запись не выполнена — ' + action); } catch (x) {}
  }
}

/** Строка из запроса — обрезанная и только из безопасных символов (для журналов). */
function mcClip_(v, n) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[\u0000-\u001f]/g, ' ').slice(0, n || 200);
}
