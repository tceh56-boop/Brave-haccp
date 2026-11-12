/**
 * ЦЕХ Стандарт Admin — платежи, счета, ЮMoney / ЮKassa.
 *
 * Провайдеры (System_Settings/PAYMENT_PROVIDER):
 *   yookassa — API ЮKassa: создание платежа (POST https://api.yookassa.ru/v3/payments, Basic shopId:secret,
 *              заголовок Idempotence-Key), оплата по ссылке confirmation_url. Уведомление на webhook проверяется
 *              повторным запросом статуса платежа в API (уведомлению на слово не верим).
 *   yoomoney — кошелёк ЮMoney: форма quickpay, HTTP-уведомление проверяется по sha1_hash
 *              (notification_type&operation_id&amount&currency&datetime&sender&codepro&secret&label).
 *   manual   — счёт без онлайн-оплаты; оплату отмечает менеджер.
 * Успешная оплата: SETUP — подключение; MONTHLY — продление подписки на «Месяцев».
 */
function recordPayment_(p) {
  var o = findBy('Organizations', 'ID', p.orgId) || {};
  var pay = { 'ID': p.id || newId('PAY'), 'Дата': new Date(), 'OrgID': p.orgId, 'Клиент': o['Название'] || '', 'Сумма': Number(p.amount) || 0, 'Статус': p.status || 'PENDING',
    'Платежная система': p.provider || 'manual', 'ID платежа': p.extId || '', 'Invoice': p.invoice || '', 'Назначение': p.purpose || 'MONTHLY', 'Месяцев': p.months || 0,
    'Тариф': o['Тариф'] || '', 'Комментарий': p.comment || '', 'Ссылка на оплату': p.url || '' };
  withLock(function () { insert('Payments', pay); });
  if (pay['Статус'] === 'PAID') applyPaid_(pay);
  return pay;
}
/** Применить оплату: продление подписки, статус счёта. */
function applyPaid_(pay) {
  if (pay['Назначение'] === 'MONTHLY' && Number(pay['Месяцев']) > 0) extendOrg_(pay['OrgID'], Number(pay['Месяцев']), 'Оплата ' + pay['ID']);
  if (pay['Invoice']) try { withLock(function () { update('Invoices', pay['Invoice'], { 'Статус': 'PAID', 'PaymentID': pay['ID'] }); }); } catch (e) {}
  logEvent('PAYMENT', 'система', pay['OrgID'], 'Оплачено ' + money(pay['Сумма']) + ' (' + pay['Назначение'] + ')');
}
/** Счёт + платёж у провайдера. Возвращает {invoice, payment, url}. */
function createInvoicePayment_(orgId, amount, purpose, months, who) {
  var o = findBy('Organizations', 'ID', orgId), no = 'СЧ-' + Utilities.formatDate(new Date(), tz(), 'yyyyMMdd') + '-' + randomToken(4);
  var provider = getSetting('PAYMENT_PROVIDER', 'manual'), url = '', extId = '';
  var descr = 'ЦЕХ Стандарт: ' + (purpose === 'SETUP' ? 'подключение' : 'обслуживание ' + months + ' мес.') + ', ' + o['Название'];
  if (provider === 'yookassa') { var y = yookassaCreate_(amount, descr, no); url = y.url; extId = y.id; }
  else if (provider === 'yoomoney') url = yoomoneyLink_(amount, descr, no);
  withLock(function () { insert('Invoices', { 'Номер': no, 'Дата': new Date(), 'OrgID': orgId, 'Клиент': o['Название'], 'Сумма': amount, 'Назначение': purpose, 'Статус': 'ISSUED' }); });
  var pay = recordPayment_({ orgId: orgId, amount: amount, purpose: purpose, months: months, provider: provider, status: 'PENDING', invoice: no, extId: extId, url: url, comment: 'Счёт выставил ' + who });
  return { invoice: no, payment: pay['ID'], url: url };
}
/* ------------------------- ЮKassa ------------------------- */
function yookassaAuth_() {
  var p = PropertiesService.getScriptProperties(), shop = p.getProperty('YOOKASSA_SHOP_ID'), sec = p.getProperty('YOOKASSA_SECRET');
  if (!shop || !sec) throw new Error('VALIDATION: не заданы свойства YOOKASSA_SHOP_ID и YOOKASSA_SECRET');
  return 'Basic ' + Utilities.base64Encode(shop + ':' + sec);
}
function yookassaCreate_(amount, descr, invoice) {
  var r = UrlFetchApp.fetch('https://api.yookassa.ru/v3/payments', { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: yookassaAuth_(), 'Idempotence-Key': invoice },
    payload: JSON.stringify({ amount: { value: Number(amount).toFixed(2), currency: 'RUB' }, capture: true, description: descr.slice(0, 128),
      confirmation: { type: 'redirect', return_url: getSetting('PAYMENT_RETURN_URL', 'https://ya.ru') }, metadata: { invoice: invoice } }) });
  if (r.getResponseCode() >= 300) throw new Error('ЮKassa: HTTP ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 200));
  var j = JSON.parse(r.getContentText());
  return { id: j.id, url: j.confirmation && j.confirmation.confirmation_url || '' };
}
function yookassaStatus_(id) {
  var r = UrlFetchApp.fetch('https://api.yookassa.ru/v3/payments/' + encodeURIComponent(id), { headers: { Authorization: yookassaAuth_() }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('ЮKassa: HTTP ' + r.getResponseCode());
  return JSON.parse(r.getContentText());
}
/* ------------------------- ЮMoney (кошелёк) ------------------------- */
function yoomoneyLink_(amount, descr, label) {
  var wallet = PropertiesService.getScriptProperties().getProperty('YOOMONEY_WALLET');
  if (!wallet) throw new Error('VALIDATION: не задано свойство YOOMONEY_WALLET (номер кошелька)');
  return 'https://yoomoney.ru/quickpay/confirm?receiver=' + encodeURIComponent(wallet) + '&quickpay-form=button&paymentType=AC&sum=' + encodeURIComponent(Number(amount).toFixed(2)) +
    '&label=' + encodeURIComponent(label) + '&targets=' + encodeURIComponent(descr.slice(0, 150));
}
function yoomoneyVerify_(p) {
  var secret = PropertiesService.getScriptProperties().getProperty('YOOMONEY_NOTIFY_SECRET'); if (!secret) return false;
  var s = [p.notification_type, p.operation_id, p.amount, p.currency, p.datetime, p.sender, p.codepro, secret, p.label].join('&');
  var h = hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, s, Utilities.Charset.UTF_8));
  return safeEqual(h, String(p.sha1_hash || ''));
}
/** Уведомление провайдера (из doPost). Возвращает текст для журнала. */
function paymentWebhook_(e) {
  var params = e.parameter || {}, body = {};
  try { body = JSON.parse(e.postData && e.postData.contents || '{}'); } catch (x) {}
  if (params.notification_type) {   // ЮMoney
    if (!yoomoneyVerify_(params)) { logError('webhook', 'ЮMoney: подпись не сошлась', JSON.stringify(params).slice(0, 500)); return 'bad signature'; }
    if (String(params.codepro) === 'true' || String(params.unaccepted) === 'true') return 'not accepted';
    return markInvoicePaid_(params.label, Number(params.withdraw_amount || params.amount), params.operation_id, 'yoomoney');
  }
  if (body && body.object && body.object.id) {   // ЮKassa: статус берём из API, не из уведомления
    var pay = yookassaStatus_(body.object.id);
    if (pay.status !== 'succeeded' || !pay.paid) return 'status ' + pay.status;
    return markInvoicePaid_(pay.metadata && pay.metadata.invoice, Number(pay.amount.value), pay.id, 'yookassa');
  }
  return 'unknown';
}
function markInvoicePaid_(invoice, amount, extId, provider) {
  var pay = readAll('Payments').filter(function (p) { return p['Invoice'] === invoice; }).reverse()[0];
  if (!pay) { logError('webhook', 'Платёж по счёту ' + invoice + ' не найден', extId); return 'no invoice'; }
  if (pay['Статус'] === 'PAID') return 'already paid';
  if (Math.abs(Number(pay['Сумма']) - amount) > 1 && provider === 'yookassa') { logError('webhook', 'Сумма не совпала по счёту ' + invoice, amount + ' vs ' + pay['Сумма']); return 'amount mismatch'; }
  var upd = withLock(function () { return update('Payments', pay['ID'], { 'Статус': 'PAID', 'ID платежа': extId || pay['ID платежа'] }); });
  applyPaid_(upd);
  return 'paid';
}
/* ------------------------- экран «Платежи» ------------------------- */
function adminPayments(token, f) {
  try {
    requireRole(token, 'payments.view'); f = f || {};
    var q = String(f.q || '').toLowerCase();
    return ok(readAll('Payments').filter(function (p) {
      var d = String(p['Дата']).slice(0, 10);
      return (!f.status || f.status === 'ALL' || p['Статус'] === f.status) && (!f.from || d >= f.from) && (!f.to || d <= f.to) && (!q || JSON.stringify(p).toLowerCase().indexOf(q) >= 0);
    }).reverse().slice(0, 1000));
  } catch (e) { return fail(e); }
}
/** Выставить счёт: подключение (SETUP) или обслуживание (MONTHLY, months). */
function adminInvoiceCreate(token, orgId, purpose, months) {
  try {
    var s = requireRole(token, 'payments.edit'), o = findBy('Organizations', 'ID', orgId); if (!o) throw new Error('NOT_FOUND: клиент не найден');
    var t = tariff(o['Тариф']); months = Number(months) || 1;
    var amount = purpose === 'SETUP' ? t.setup : t.monthly * months;
    var r = createInvoicePayment_(orgId, amount, purpose === 'SETUP' ? 'SETUP' : 'MONTHLY', purpose === 'SETUP' ? 0 : months, s.email);
    logEvent('PAYMENT', s.email, orgId, 'Счёт ' + r.invoice + ' на ' + money(amount));
    return ok(r);
  } catch (e) { return fail(e); }
}
/** Отметить оплату вручную (банковский перевод). */
function adminPaymentMarkPaid(token, id) {
  try {
    var s = requireRole(token, 'payments.edit'), p = findBy('Payments', 'ID', id); if (!p) throw new Error('NOT_FOUND: платёж не найден');
    if (p['Статус'] === 'PAID') return ok(true);
    var upd = withLock(function () { return update('Payments', id, { 'Статус': 'PAID', 'Комментарий': String(p['Комментарий'] || '') + ' · оплату отметил ' + s.email }); });
    applyPaid_(upd);
    logEvent('PAYMENT', s.email, p['OrgID'], 'Оплата отмечена вручную: ' + money(p['Сумма']));
    return ok(true);
  } catch (e) { return fail(e); }
}
/** «Повторить запрос статуса» у провайдера. */
function adminPaymentRecheck(token, id) {
  try {
    var s = requireRole(token, 'payments.view'), p = findBy('Payments', 'ID', id); if (!p) throw new Error('NOT_FOUND: платёж не найден');
    if (p['Платежная система'] !== 'yookassa' || !p['ID платежа']) return ok({ status: p['Статус'], note: 'Статус у провайдера можно запросить только для ЮKassa' });
    var y = yookassaStatus_(p['ID платежа']);
    if (y.status === 'succeeded' && y.paid && p['Статус'] !== 'PAID') markInvoicePaid_(p['Invoice'], Number(y.amount.value), y.id, 'yookassa');
    if (y.status === 'canceled' && p['Статус'] === 'PENDING') withLock(function () { update('Payments', id, { 'Статус': 'FAILED' }); });
    logEvent('PAYMENT', s.email, p['OrgID'], 'Запрос статуса ' + id + ': ' + y.status);
    return ok({ status: y.status });
  } catch (e) { return fail(e); }
}
/** Счёт в PDF (Drive) — ссылка. */
function adminInvoicePdf(token, invoice) {
  try {
    requireRole(token, 'payments.view');
    var inv = findBy('Invoices', 'Номер', invoice); if (!inv) throw new Error('NOT_FOUND: счёт не найден');
    var o = findBy('Organizations', 'ID', inv['OrgID']) || {}, req0 = getSetting('VENDOR', { name: 'ЦЕХ Стандарт', inn: '', bank: '', account: '' });
    var html = '<html><body style="font:12px Arial;color:#111"><h2 style="border-bottom:3px solid #d4af37;padding-bottom:6px">Счёт № ' + esc(invoice) + ' от ' + fmtDate(inv['Дата']) + '</h2>' +
      '<p><b>Поставщик:</b> ' + esc(req0.name) + (req0.inn ? ', ИНН ' + esc(req0.inn) : '') + (req0.bank ? '<br>' + esc(req0.bank) + ', р/с ' + esc(req0.account) : '') + '</p>' +
      '<p><b>Покупатель:</b> ' + esc(o['Название']) + (o['ИНН'] ? ', ИНН ' + esc(o['ИНН']) : '') + '<br>' + esc(o['Адрес'] || '') + '</p>' +
      '<table style="width:100%;border-collapse:collapse" border="1" cellpadding="6"><tr style="background:#f4ede1"><th>Наименование</th><th>Сумма</th></tr><tr><td>Программа «ЦЕХ Стандарт», ' +
      (inv['Назначение'] === 'SETUP' ? 'подключение' : 'обслуживание') + ', тариф ' + esc((tariff(o['Тариф']) || {}).name || '') + '</td><td style="text-align:right">' + money(inv['Сумма']) + '</td></tr></table>' +
      '<p style="font-size:14px"><b>Итого к оплате: ' + money(inv['Сумма']) + '</b></p></body></html>';
    var blob = Utilities.newBlob(html, 'text/html', invoice + '.html').getAs('application/pdf').setName('Счёт ' + invoice + '.pdf');
    var file = docsFolder_('Счета').createFile(blob);
    withLock(function () { update('Invoices', invoice, { 'Файл': file.getUrl() }); });
    return ok({ url: file.getUrl() });
  } catch (e) { return fail(e); }
}
/** Экспорт таблицы в Excel (.xlsx) — base64 для скачивания в браузере. kind: payments | clients | subscriptions | licenses. */
function adminExportXlsx(token, kind) {
  try {
    requireRole(token, kind === 'payments' ? 'payments.view' : 'clients.view');
    var name = { payments: 'Payments', clients: 'Organizations', subscriptions: 'Subscriptions', licenses: 'Licenses' }[kind];
    if (!name) throw new Error('VALIDATION: неизвестная таблица');
    var head = SHEETS[name], rows = readAll(name).map(function (r) { return head.map(function (h) { return r[h]; }); });
    var tmp = SpreadsheetApp.create('export_' + kind + '_' + Date.now()), sh = tmp.getSheets()[0];
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    if (rows.length) sh.getRange(2, 1, rows.length, head.length).setValues(rows);
    SpreadsheetApp.flush();
    var r = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + tmp.getId() + '/export?format=xlsx', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } });
    DriveApp.getFileById(tmp.getId()).setTrashed(true);
    return ok({ name: kind + '_' + isoDay() + '.xlsx', b64: Utilities.base64Encode(r.getBlob().getBytes()) });
  } catch (e) { return fail(e); }
}
function docsFolder_(sub) {
  var p = PropertiesService.getScriptProperties(), id = p.getProperty('ADMIN_FOLDER_ID'), root = null;
  if (id) try { root = DriveApp.getFolderById(id); } catch (e) {}
  if (!root) { root = DriveApp.createFolder('ЦЕХ Стандарт Admin'); p.setProperty('ADMIN_FOLDER_ID', root.getId()); }
  if (!sub) return root;
  var it = root.getFoldersByName(sub); return it.hasNext() ? it.next() : root.createFolder(sub);
}
