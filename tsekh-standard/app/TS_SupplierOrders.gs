/**
 * ЦЕХ Стандарт — заявки поставщикам по группам и письмо поставщику.
 *
 * 1. Формирование: система предлагает строки — товары ниже минимального остатка (полуфабрикаты собственного
 *    производства не закупаются) с последним поставщиком из прихода. Повар-закупщик правит количество и поставщика,
 *    добавляет свои строки — система создаёт по одной заявке (черновик заказа) на каждого поставщика.
 * 2. Письмо: заявка уходит на e-mail для заявок из карточки поставщика с почты системы — Google-аккаунта,
 *    под которым работает ЦЕХ Стандарт у предприятия. Ответ поставщика приходит на e-mail организации
 *    (Настройки → Организация), копия письма — туда же. К письму прикладывается PDF заявки, он же сохраняется
 *    в папке предприятия «03_Продукты_и_Поставщики / Заявки поставщикам». После отправки заказ — «Отправлен».
 * Цены в письмо не попадают: это закупочные ожидания предприятия, а не условия поставщика.
 */
var TS_PO_COLS_ = { sentAt: 13, sentTo: 14, file: 15 };   // колонки листа «Заказы_Поставщикам» после SupplierID (12)

function _tsPoRound_(x) { return Math.round(Number(x) * 1000) / 1000; }
function _tsPoDate_(v) {
  if (!v) return '';
  var d = v instanceof Date ? v : new Date(v);
  if (isNaN(d)) return String(v);
  return Utilities.formatDate(d, _mcTz_(), 'dd.MM.yyyy');
}
function _tsPoEsc_(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

/** Предложение строк заявки: товары ниже минимума с последним поставщиком. */
function _tsPoDraft_() {
  var bal = []; try { bal = JSON.parse(getStockBalances()); } catch (e) {}
  var lines = [];
  bal.forEach(function (b) {
    if (b.isSemi || !(b.minQty > 0) || !(b.qty < b.minQty)) return;
    var need = _tsPoRound_(b.minQty - Math.max(0, b.qty));
    var sup = ''; try { sup = _getLastSupplier_(b.name) || ''; } catch (e) {}
    var reg = sup && typeof _mdResolveSupplier_ === 'function' ? _mdResolveSupplier_(sup, false) : null;
    lines.push({ name: b.name, unit: b.unit, qty: need, stock: _tsPoRound_(b.qty), min: b.minQty, price: b.lastPrice || b.avgPrice || 0,
      supplier: reg ? reg.name : sup, supplierId: reg ? reg.id : '', source: 'ниже минимума' });
  });
  var sups = (typeof _mdSuppliers_ === 'function' ? _mdSuppliers_() : []).filter(function (s) { return s.status !== 'BLOCKED'; })
    .map(function (s) { return { id: s.id, name: s.name, email: s.email, contactPerson: s.contactPerson, phone: s.phone, deliveryDays: s.deliveryDays, status: s.status }; });
  return { lines: lines, suppliers: sups };
}

/** Создать по одной заявке на поставщика. lines: [{name, qty, unit, supplier, price?}]. */
function _tsPoBuild_(lines, dueDate, comment, token) {
  if (!Array.isArray(lines) || !lines.length) throw new Error('VALIDATION: нет строк заявки');
  var groups = {}, order = [], problems = [];
  lines.forEach(function (l, i) {
    var name = String(l.name || '').trim(), qty = Number(l.qty), sup = String(l.supplier || '').trim();
    if (!name) return;
    if (!(qty > 0)) { problems.push('«' + name + '»: укажите количество'); return; }
    if (!sup) { problems.push('«' + name + '»: выберите поставщика'); return; }
    var reg = _mdResolveSupplier_(sup, false);
    if (reg && reg.status === 'BLOCKED') { problems.push('«' + name + '»: поставщик «' + reg.name + '» заблокирован'); return; }
    var key = reg ? reg.id : sup.toLowerCase();
    if (!groups[key]) { groups[key] = { supplier: reg ? reg.name : sup, items: [] }; order.push(key); }
    var price = Number(l.price) || 0;
    groups[key].items.push({ name: name, qty: _tsPoRound_(qty), unit: String(l.unit || 'кг'), price: price, sum: Math.round(qty * price * 100) / 100 });
  });
  if (problems.length) throw new Error('VALIDATION: ' + problems.join('; '));
  if (!order.length) throw new Error('VALIDATION: нет строк с товаром и количеством');
  return order.map(function (k) {
    var g = groups[k], raw = JSON.parse(_createSupplierOrder_core_(JSON.stringify(g.items), g.supplier, comment || 'Заявка по поставщикам', dueDate || '', token));
    if (raw.error || raw.success === false) throw new Error('ORDER: ' + g.supplier + ': ' + (raw.error && (raw.error.message || raw.error)));
    var reg = _mdResolveSupplier_(g.supplier, false) || {};
    return { orderId: raw.id, supplier: g.supplier, lines: g.items.length, email: reg.email || '', contactPerson: reg.contactPerson || '' };
  });
}

/** Письмо по заказу: кому, тема, HTML. Ничего не отправляет. */
function _tsPoLetter_(orderId, senderName) {
  var o = JSON.parse(getSupplierOrderById(orderId));
  if (!o || o.error) throw new Error('NOT_FOUND: заказ ' + orderId + ' не найден');
  if (o.status === 'cancelled' || o.status === 'received') throw new Error('VALIDATION: заказ ' + (o.status === 'cancelled' ? 'отменён' : 'уже принят') + ' — письмо не нужно');
  var sup = _mdResolveSupplier_(o.supplier, false) || { name: o.supplier };
  var org = {}; try { org = _mcOrg_(); } catch (e) {}
  var missing = [];
  if (!sup.email) missing.push('e-mail для заявок в карточке поставщика «' + (sup.name || o.supplier) + '»');
  if (!org.name) missing.push('название организации (Настройки → Организация)');
  if (!org.email) missing.push('e-mail организации — на него поставщик ответит (Настройки → Организация)');
  var orgName = org.shortName || org.name || '', date = _tsPoDate_(new Date()), due = _tsPoDate_(o.dueDate);
  var subject = 'Заявка № ' + o.id + ' от ' + date + (orgName ? ' — ' + orgName : '') + (due ? ', поставка ' + due : '');
  var e = _tsPoEsc_, rows = (o.items || []).map(function (it, i) {
    return '<tr><td style="padding:4px 8px;border:1px solid #ccc;text-align:center">' + (i + 1) + '</td><td style="padding:4px 8px;border:1px solid #ccc">' + e(it.name) +
      '</td><td style="padding:4px 8px;border:1px solid #ccc;text-align:right">' + e(it.qty) + '</td><td style="padding:4px 8px;border:1px solid #ccc">' + e(it.unit) + '</td></tr>'; }).join('');
  var hello = sup.contactPerson ? 'Здравствуйте, ' + e(sup.contactPerson) + '!' : 'Здравствуйте!';
  var html = '<div style="font:14px/1.5 Arial,sans-serif;color:#1b1610;max-width:680px">' +
    '<h2 style="font-size:18px;margin:0 0 4px">Заявка № ' + e(o.id) + ' от ' + e(date) + '</h2>' +
    '<div style="color:#555;margin-bottom:12px">Поставщик: <b>' + e(sup.name || o.supplier) + '</b>' + (sup.inn ? ', ИНН ' + e(sup.inn) : '') + '</div>' +
    '<p>' + hello + '</p><p>Просим поставить следующие товары' + (due ? ' к <b>' + e(due) + '</b>' : '') + ':</p>' +
    '<table style="border-collapse:collapse;font-size:14px"><tr style="background:#f3eadb"><th style="padding:4px 8px;border:1px solid #ccc">№</th><th style="padding:4px 8px;border:1px solid #ccc">Наименование</th><th style="padding:4px 8px;border:1px solid #ccc">Кол-во</th><th style="padding:4px 8px;border:1px solid #ccc">Ед.</th></tr>' + rows + '</table>' +
    (org.actualAddress ? '<p>Адрес доставки: ' + e(org.actualAddress) + '</p>' : '') +
    (o.comment ? '<p>Комментарий: ' + e(o.comment) + '</p>' : '') +
    '<p>Просим подтвердить заявку ответным письмом' + (org.email ? ' на ' + e(org.email) : '') + ' и сообщить, если какой-то позиции нет в наличии. ' +
    'Товар принимается с документами: товарная накладная, документы о качестве и безопасности (декларация / сертификат), ветеринарные документы для подконтрольной продукции.</p>' +
    '<p style="margin-top:18px">С уважением,<br>' + (senderName ? e(senderName) + '<br>' : '') + e(org.name || '') + (org.inn ? ', ИНН ' + e(org.inn) : '') +
    (org.phone ? '<br>Тел.: ' + e(org.phone) : '') + (org.email ? '<br>E-mail: ' + e(org.email) : '') + '</p></div>';
  return { order: o, supplier: sup, org: org, to: sup.email || '', cc: org.email || '', replyTo: org.email || '', subject: subject, html: html, missing: missing };
}

/** Отправить заявку письмом. Без e-mail поставщика — отказ с подсказкой, что заполнить. */
function _tsPoSend_(orderId, senderName, note) {
  var L = _tsPoLetter_(orderId, senderName);
  if (!L.to) throw new Error('VALIDATION: в карточке поставщика «' + (L.supplier.name || L.order.supplier) + '» нет e-mail для заявок (Поставщики → карточка)');
  var html = note ? L.html.replace('<p>Просим поставить', '<p>' + _tsPoEsc_(note) + '</p><p>Просим поставить') : L.html;
  try { if (MailApp.getRemainingDailyQuota() < 1) throw new Error('VALIDATION: дневной лимит писем Google исчерпан — отправьте завтра или позвоните поставщику'); } catch (e) { if (/VALIDATION/.test(e.message)) throw e; }
  var fileName = 'Заявка ' + L.order.id + ' — ' + (L.supplier.name || L.order.supplier) + ' — ' + _tsPoDate_(new Date());
  var pdf = HtmlService.createHtmlOutput('<html><head><meta charset="utf-8"></head><body>' + html + '</body></html>').getBlob().getAs('application/pdf').setName(fileName + '.pdf');
  var opt = { htmlBody: html, attachments: [pdf], name: L.org.shortName || L.org.name || 'ЦЕХ Стандарт' };
  if (L.cc && L.cc.toLowerCase() !== L.to.toLowerCase()) opt.cc = L.cc;
  if (L.replyTo) opt.replyTo = L.replyTo;
  MailApp.sendEmail(L.to, L.subject, 'Заявка ' + L.order.id + ' — во вложении (PDF).', opt);
  var url = '';
  try { var folder = _tsTreeFolder_('PRODUCTS', 'Заявки поставщикам', ['ЦЕХ Стандарт — Заявки поставщикам']); url = folder.createFile(pdf).getUrl(); } catch (e) {}
  _withLock_(function () {
    _updateOrderStatus_(orderId, 'sent', null);
    var sh = _supplierOrdersSheet_(), v = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
    if (!sh.getRange(1, TS_PO_COLS_.sentAt).getValue()) sh.getRange(1, TS_PO_COLS_.sentAt, 1, 3).setValues([['Письмо отправлено', 'Кому', 'Файл заявки']]);
    for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(orderId)) { sh.getRange(i + 1, TS_PO_COLS_.sentAt, 1, 3).setValues([[new Date(), L.to + (opt.cc ? ', копия ' + opt.cc : ''), url]]); break; }
  });
  try { if (typeof _ts2Audit_ === 'function') _ts2Audit_('SUPPLIER_ORDER_EMAIL', 'SUPPLIER_ORDER', String(orderId), undefined, { to: L.to, cc: opt.cc || '', lines: (L.order.items || []).length, file: url }, L.subject); } catch (e) {}
  return { orderId: orderId, to: L.to, cc: opt.cc || '', subject: L.subject, file: url };
}

/* ------------------------------------------------------------------ интерфейс */
function _tsPoWho_(s) { return s && (s.name || s.fullName) || ''; }
function tsOrderDraft(token) { try { _requireAuth_(token, 'procurement'); return _ok_(_tsPoDraft_()); } catch (e) { return _failFrom_(e); } }
function tsOrdersBuild(token, linesJson, dueDate, comment) {
  try { _requireAuth_(token, 'procurement'); return _ok_({ orders: _tsPoBuild_(typeof linesJson === 'string' ? JSON.parse(linesJson || '[]') : linesJson, dueDate, comment, token) }); }
  catch (e) { return _failFrom_(e); }
}
function tsOrderLetter(token, orderId) {
  try { var s = _requireAuth_(token, 'procurement'), L = _tsPoLetter_(orderId, _tsPoWho_(s)); return _ok_({ to: L.to, cc: L.cc, subject: L.subject, html: L.html, missing: L.missing, status: L.order.status }); }
  catch (e) { return _failFrom_(e); }
}
function tsOrderSend(token, orderId, note) {
  try { var s = _requireAuth_(token, 'procurement'); return _ok_(_tsPoSend_(orderId, _tsPoWho_(s), note)); } catch (e) { return _failFrom_(e); }
}
/** Отправить несколько заявок; у каждой свой результат — одна ошибка не останавливает остальные. */
function tsOrdersSendMany(token, idsJson) {
  try {
    var s = _requireAuth_(token, 'procurement'), ids = typeof idsJson === 'string' ? JSON.parse(idsJson || '[]') : idsJson;
    return _ok_({ results: (ids || []).map(function (id) { try { var r = _tsPoSend_(id, _tsPoWho_(s)); return { orderId: id, ok: true, to: r.to }; } catch (e) { return { orderId: id, ok: false, error: String(e.message || e).replace(/^[A-Z_]+:\s*/, '') }; } }) });
  } catch (e) { return _failFrom_(e); }
}
