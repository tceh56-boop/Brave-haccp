/**
 * ЦЕХ Стандарт Admin — REST API (doPost) для систем клиентов, платёжных уведомлений и внешних интеграций.
 *
 * POST JSON {action: …}:
 *   license.check  — проверка лицензии клиентом: {key, nonce, version, stats, scriptId, appUrl} → {ok, license, sig}
 *   ttk.library    — база отработанных ТТК (Pro Max): {key, ts, sig} → {ok, items}
 *   api.clients    — список клиентов для внешней интеграции: заголовок не доступен в Apps Script, поэтому {apiKey}
 *   release.check, support.request, support.consent, usage.report, tech.event, reconciliation.template, seed.package —
 *                    управляющий контур 2.0 (Control.gs); запрос подписан клиентом {key, ts, sig}, повтор подписи отклоняется
 * Платёжные уведомления: POST на URL веб-приложения с параметрами ?hook=payment&t=<WEBHOOK_TOKEN>.
 * Админ-панель (браузер) работает через google.script.run, не через этот API.
 */
function doPost(e) {
  var out;
  try {
    var prm = e && e.parameter || {};
    if (prm.hook === 'payment') {
      var t = PropertiesService.getScriptProperties().getProperty('WEBHOOK_TOKEN');
      if (!t || !safeEqual(prm.t, t)) { logError('webhook', 'неверный токен уведомления', ''); return json_({ ok: false }); }
      var wh = webhookSeen_(e, e.parameter && e.parameter.notification_type ? 'yoomoney' : 'yookassa');
      if (wh.seen) { logEvent('PAYMENT', 'провайдер', '', 'Повтор уведомления — пропущен'); return json_({ ok: true, result: 'duplicate' }); }
      var res = paymentWebhook_(e); webhookResult_(wh.hash, res);
      logEvent('PAYMENT', 'провайдер', '', 'Уведомление об оплате: ' + res);
      return json_({ ok: true, result: res });
    }
    var p = JSON.parse(e && e.postData && e.postData.contents || '{}');
    if (p.action === 'license.check') out = licenseCheck_(p);
    else if (p.action === 'ttk.library') { var org = verifyClient_(p); out = org ? ttkLibraryForClient_(org) : { ok: false, error: 'Подпись запроса не принята' }; }
    else if (p.action === 'api.clients') out = apiClients_(p);
    else if (['release.check', 'support.request', 'support.consent', 'usage.report', 'tech.event', 'reconciliation.template', 'seed.package', 'norms.registry'].indexOf(p.action) >= 0) out = apiControl_(p);
    else out = { ok: false, error: 'unknown action' };
  } catch (err) {
    logError('api', String(err && err.message || err), err && err.stack);
    out = { ok: false, error: 'internal error' };
  }
  return json_(out);
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function apiKeyCheck_(key, right) {
  var h = sha256(String(key || '')), k = readAll('API_Keys').filter(function (x) { return safeEqual(x['Хэш ключа'], h) && x['Статус'] === 'ACTIVE'; })[0];
  if (!k || (right && String(k['Права']).split(',').indexOf(right) < 0 && String(k['Права']) !== '*')) return null;
  try { withLock(function () { update('API_Keys', k['ID'], { 'Последнее использование': new Date() }); }); } catch (e) {}
  return k;
}
function apiClients_(p) {
  if (!apiKeyCheck_(p.apiKey, 'read')) return { ok: false, error: 'API-ключ не принят' };
  return { ok: true, items: readAll('Organizations').filter(function (o) { return o['Статус'] !== 'DELETED'; }).map(function (o) {
    return { id: o['ID'], name: o['Название'], plan: o['Тариф'], status: o['Статус'], subscriptionEnd: o['Окончание подписки'], version: o['Версия'] };
  }) };
}
