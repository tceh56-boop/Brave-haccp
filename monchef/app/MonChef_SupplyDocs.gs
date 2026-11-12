/**
 * MON CHEF — документы на сырьё, ветеринарный контур, маркировка (ТЗ §5, §6, §7).
 *
 * §5 «Документы_Сырьё»: накладные, декларации, сертификаты, ветдокументы, документы маркировки —
 *    с привязкой к поставщику (SupplierID), продукту (ProductID) и партии, сроком действия,
 *    файлом на Диске (приватно) и SHA-256 его содержимого; проверку подтверждает человек.
 * §6 «ВСД»: ветеринарный сопроводительный документ по партии (номер, статус, дата гашения).
 *    Продукт отмечается как подконтрольный (лист «Ветконтроль_Продукты», по решению ответственного).
 *    Настройка REQUIRES_VET_DOCUMENT (свойство MC_REQUIRES_VET_DOCUMENT, по умолчанию включена):
 *    партия подконтрольного продукта не проходит входной контроль без погашенного ВСД.
 * §7 «Маркировка»: код маркировки (GTIN из кода), партия, приёмка, вывод из оборота с причиной.
 * Номера, даты и статусы вводит человек — система их не выдумывает. Обмен с ФГИС «Меркурий» (получение,
 * проверка, гашение ВСД) — MonChef_Mercury.gs, в тот же лист «ВСД»: статус «погашен» при включённой интеграции
 * ставится только по ответу «Меркурия»; ручной ввод гашения — только пока интеграция не настроена.
 */
var MC_SD_DOC_ = 'Документы_Сырьё', MC_SD_DOC_HEAD_ = ['DocumentID', 'Тип', 'Номер', 'Дата', 'Действует до', 'SupplierID', 'Поставщик', 'ProductID', 'Продукт', 'BatchID',
  'FileID', 'Hash', 'Статус', 'Проверил', 'Проверено', 'Внёс', 'Создано', 'OperationID'];
// первые 12 колонок — ручной контур этапа 10; дальше — данные «Меркурия» (MonChef_Mercury.gs). BatchID — одна или несколько партий через запятую.
var MC_SD_VET_ = 'ВСД', MC_SD_VET_HEAD_ = ['VetID', 'Номер ВСД', 'BatchID', 'SupplierID', 'Продукт', 'Приход (накладная)', 'Статус', 'Дата гашения', 'DocumentID', 'Кто', 'Когда', 'OperationID',
  'VSDStatus', 'MercuryUUID', 'MercuryDocumentID', 'Дата оформления', 'Дата доставки', 'Поставщик', 'ProductID', 'Продукт ВСД', 'Изготовитель', 'Страна', 'Кол-во', 'Ед.',
  'Партия изготовителя', 'Дата выработки', 'Годен до', 'Откуда', 'Куда', 'ReceivingDocumentID', 'Накладная №', 'Проверено', 'Проверил', 'Погашено', 'Погасил', 'Результат гашения',
  'Ответ Меркурия', 'Проверка', 'Подтверждения', 'ApplicationID', 'Попытка', 'Обновлено', 'GUID отправителя ХС', 'GUID отправителя площадки', 'GUID получателя площадки',
  'Статус в Меркурии', 'Ключ', 'StockEntry', 'Источник', 'Сырые данные', 'Ошибка'];
var MC_SD_VP_ = 'Ветконтроль_Продукты', MC_SD_VP_HEAD_ = ['ProductID', 'Продукт', 'Подконтролен', 'Основание', 'Кто', 'Когда'];
var MC_SD_MARK_ = 'Маркировка', MC_SD_MARK_HEAD_ = ['MarkID', 'Код маркировки', 'GTIN', 'BatchID', 'ProductID', 'Продукт', 'Приёмка', 'Статус', 'Причина вывода', 'Оператор', 'Время', 'OperationID'];
var MC_SD_TYPES_ = ['Накладная', 'Декларация', 'Сертификат', 'ВСД', 'Документ маркировки', 'Этикетка производителя', 'Фото товара при приёмке', 'Прочее'];

function _sdRows_(name, head) {
  var v = (name === MC_SD_VET_ ? _mvSheet_() : _bcSheet_(name, head)).getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) if (v[i][0]) { var o = { _row: i + 1 }; head.forEach(function (h, j) { o[h] = v[i][j] instanceof Date ? _bcDate_(v[i][j]) : v[i][j]; }); o._raw = v[i]; out.push(o); }
  return out;
}
function _sdVetOn_() { try { return String(PropertiesService.getScriptProperties().getProperty('MC_REQUIRES_VET_DOCUMENT') || 'on') !== 'off'; } catch (e) { return true; } }
function _sdDate_(x) { if (!x) return null; var d = x instanceof Date ? x : _parseDate_(String(x)); return d && !isNaN(d) ? d : null; }
function _sdToday0_() { var t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
/** Продукт подконтролен ветнадзору? (решение ответственного в «Ветконтроль_Продукты»; последняя запись) */
function _sdVetControlled_(productId, name) {
  var last = null, k = _prodKey_(name || '');
  _sdRows_(MC_SD_VP_, MC_SD_VP_HEAD_).forEach(function (r) { if ((productId && String(r.ProductID) === String(productId)) || (k && _prodKey_(r['Продукт']) === k)) last = r; });
  return !!(last && String(last['Подконтролен']) === 'да');
}
function _sdBatchVet_(batchId) {
  var vs = _sdRows_(MC_SD_VET_, MC_SD_VET_HEAD_).filter(function (r) { return String(r.BatchID).split(',').map(function (x) { return x.trim(); }).indexOf(String(batchId)) >= 0 && r['Статус'] !== 'АННУЛИРОВАН'; });
  return { list: vs, extinguished: vs.filter(function (r) { return r['Статус'] === 'ПОГАШЕН'; })[0] || null };
}
/** Для входного контроля: причины не допускать партию по документам (ветконтроль, просроченные документы). */
function _sdIncomingReasons_(b) {
  var out = [], pid = String(b.v[17] || ''), name = b.v[1];
  try {
    var bv = _sdBatchVet_(b.v[0]);
    if (_sdVetOn_() && _sdVetControlled_(pid, name) && !bv.extinguished)
      out.push('ветеринарно подконтрольный продукт: нет погашенного ВСД (REQUIRES_VET_DOCUMENT)');
    // к партии привязан ВСД — до гашения партия не допускается, даже если продукт не отмечен подконтрольным
    bv.list.forEach(function (r) { if (r['Статус'] !== 'ПОГАШЕН' && !(_sdVetOn_() && _sdVetControlled_(pid, name))) out.push('ВСД ' + r['Номер ВСД'] + ' не погашен (' + _mvRu_(String(r.VSDStatus || 'FOUND')) + ')'); });
    var t0 = _sdToday0_();
    _sdRows_(MC_SD_DOC_, MC_SD_DOC_HEAD_).forEach(function (d) {
      if (String(d.BatchID) !== String(b.v[0]) || d['Статус'] === 'REVOKED') return;
      var till = _sdDate_(d._raw[4]); if (till && till < t0) out.push(d['Тип'] + ' № ' + d['Номер'] + ' истёк ' + _bcDate_(till));
    });
  } catch (e) {}
  return out;
}
function _sdFile_(dataUrl, name) {
  var m = String(dataUrl || '').match(/^data:([^;]+);base64,(.*)$/); if (!m) return null;
  var bytes = Utilities.base64Decode(m[2]), hash = _bkHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes));
  var folder = null; try { var it = DriveApp.getFoldersByName('Документы на сырьё Mon Chef'); folder = it.hasNext() ? it.next() : DriveApp.createFolder('Документы на сырьё Mon Chef'); } catch (e) {}
  var blob = Utilities.newBlob(bytes, m[1], name), f = folder ? folder.createFile(blob) : DriveApp.createFile(blob);
  return { fileId: f.getId(), hash: hash };
}

/** §5 документ на сырьё. */
function mcSaveSupplyDocument(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock', 'SUPPLY_DOC_SAVE', 'Документы на сырьё', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    var type = String(d.type || ''), num = String(d.number || '').trim(), dt = _sdDate_(d.date), till = d.expiry ? _sdDate_(d.expiry) : null;
    if (MC_SD_TYPES_.indexOf(type) < 0) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Тип документа: ' + MC_SD_TYPES_.join(', '), op.id); }
    if (!num) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите номер документа', op.id); }
    if (!dt) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите дату документа', op.id); }
    if (d.expiry && !till) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Срок действия не распознаётся как дата', op.id); }
    if (till && till < dt) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Срок действия раньше даты документа', op.id); }
    if ((type === 'Декларация' || type === 'Сертификат') && !till) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Для декларации/сертификата укажите срок действия', op.id); }
    return _withLock_(function () {
      var b = d.batchId ? _bcFind_(d.batchId) : null;
      if (d.batchId && !b) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Партия не найдена', op.id); }
      var sup = d.supplier ? _mdResolveSupplier_(d.supplier, false) : null;
      var supId = b ? String(b.v[18] || '') : sup ? sup.id : '', supName = sup ? sup.name : supId ? ((_mdSuppliers_().filter(function (x) { return x.id === supId; })[0] || {}).name || '') : String(d.supplier || '');
      var prodName = b ? b.v[1] : String(d.product || ''), pid = b ? String(b.v[17] || '') : (prodName ? _mdProductId_(prodName) : '');
      var dup = _sdRows_(MC_SD_DOC_, MC_SD_DOC_HEAD_).filter(function (x) { return x['Тип'] === type && String(x['Номер']).trim() === num && String(x.SupplierID || '') === supId && String(x.BatchID || '') === String(d.batchId || '') && x['Статус'] !== 'REVOKED'; })[0];
      if (dup) { _endOp_(op, 'FAILED'); return _fail_('DUPLICATE', 'Такой документ уже внесён: ' + dup.DocumentID, op.id); }
      var file = d.fileDataUrl ? _sdFile_(d.fileDataUrl, type + ' ' + num) : null;
      var id = 'SD-' + Date.now() + '-' + Utilities.getUuid().slice(0, 4), who = (op.session && (op.session.name || op.session.fullName)) || '';
      _bcSheet_(MC_SD_DOC_, MC_SD_DOC_HEAD_).appendRow([id, type, num, dt, till || '', supId, supName, pid, prodName, d.batchId || '', file ? file.fileId : '', file ? file.hash : '',
        till && till < _sdToday0_() ? 'EXPIRED' : 'ACTIVE', '', '', who, new Date(), op.id]);
      _audit_(op, 'SUPPLY_DOC_SAVE', 'Документы на сырьё', id, null, { type: type, number: num, batch: d.batchId || '', supplier: supId, product: pid, hash: file ? file.hash : '' });
      _endOp_(op, 'COMPLETED');
      return _ok_({ documentId: id, hash: file ? file.hash : '', status: till && till < _sdToday0_() ? 'EXPIRED' : 'ACTIVE' }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Проверка документа человеком (сверил с оригиналом). Внёсший документ его не проверяет. */
function mcVerifySupplyDocument(documentId, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock', 'SUPPLY_DOC_VERIFY', 'Документы на сырьё', documentId, null); } catch (e) { return _failFrom_(e); }
  try {
    return _withLock_(function () {
      var r = _sdRows_(MC_SD_DOC_, MC_SD_DOC_HEAD_).filter(function (x) { return x.DocumentID === String(documentId); })[0];
      if (!r) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Документ не найден', op.id); }
      if (r['Проверил']) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Документ уже проверен: ' + r['Проверил'], op.id); }
      var who = (op.session && (op.session.name || op.session.fullName)) || '';
      if (who && String(r['Внёс']) === who) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', 'Проверяет другой сотрудник, не тот, кто внёс документ', op.id); }
      var till = _sdDate_(r._raw[4]); if (till && till < _sdToday0_()) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Срок действия документа истёк — подтвердить нельзя', op.id); }
      _bcSheet_(MC_SD_DOC_, MC_SD_DOC_HEAD_).getRange(r._row, 14, 1, 2).setValues([[who, new Date()]]);
      _audit_(op, 'SUPPLY_DOC_VERIFY', 'Документы на сырьё', r.DocumentID, null, { verifiedBy: who });
      _endOp_(op, 'COMPLETED');
      return _ok_({ documentId: r.DocumentID, verifiedBy: who }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** §6 отметить продукт как подконтрольный ветнадзору (или снять отметку) — с основанием. */
function mcSetVetControlled(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'haccp', 'VET_PRODUCT', 'Ветконтроль', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    var name = String(d.product || '').trim(), basis = String(d.basis || '').trim();
    if (!name) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите продукт', op.id); }
    if (!basis) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите основание (перечень подконтрольных товаров, решение ответственного)', op.id); }
    var pid = _mdProductId_(name), on = d.controlled !== false;
    _bcSheet_(MC_SD_VP_, MC_SD_VP_HEAD_).appendRow([pid, name, on ? 'да' : 'нет', basis, (op.session && (op.session.name || op.session.fullName)) || '', new Date()]);
    _audit_(op, 'VET_PRODUCT', 'Ветконтроль', pid, null, { product: name, controlled: on, basis: basis });
    _endOp_(op, 'COMPLETED');
    return _ok_({ productId: pid, controlled: on }, op.id);
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** §6 ВСД по партии: оформлен или погашен (дату гашения вводит человек, не в будущем). */
function mcSaveVetDocument(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock', 'VET_DOC_SAVE', 'ВСД', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    var num = String(d.number || '').trim(), st = String(d.status || 'ОФОРМЛЕН');
    if (!num) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите номер ВСД', op.id); }
    if (['ОФОРМЛЕН', 'ПОГАШЕН', 'АННУЛИРОВАН'].indexOf(st) < 0) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Статус: ОФОРМЛЕН / ПОГАШЕН / АННУЛИРОВАН', op.id); }
    var ext = st === 'ПОГАШЕН' ? _sdDate_(d.extinguishedAt) : null;
    if (st === 'ПОГАШЕН' && !ext) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите дату гашения ВСД', op.id); }
    if (ext && ext > new Date()) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Дата гашения не может быть в будущем', op.id); }
    if (st === 'ПОГАШЕН' && _mvCfg_().ready) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Интеграция с «Меркурием» включена: гашение выполняется кнопкой «Погасить ВСД», а статус берётся только из «Меркурия» («Проверить статус»)', op.id); }
    return _withLock_(function () {
      var b = _bcFind_(d.batchId);
      if (!b) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Партия не найдена', op.id); }
      var all = _sdRows_(MC_SD_VET_, MC_SD_VET_HEAD_), cur = all.filter(function (x) { return String(x['Номер ВСД']).trim() === num && String(x.BatchID) === String(b.v[0]); })[0];
      var other = all.filter(function (x) { return String(x['Номер ВСД']).trim() === num && String(x.BatchID) !== String(b.v[0]) && x['Статус'] !== 'АННУЛИРОВАН'; })[0];
      if (other) { _endOp_(op, 'FAILED'); return _fail_('DUPLICATE', 'ВСД ' + num + ' уже привязан к партии ' + other.BatchID, op.id); }
      if (cur && cur['Статус'] === 'ПОГАШЕН' && st !== 'АННУЛИРОВАН') { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'ВСД уже погашен', op.id); }
      var who = (op.session && (op.session.name || op.session.fullName)) || '', sh = _bcSheet_(MC_SD_VET_, MC_SD_VET_HEAD_);
      var row = [cur ? cur.VetID : 'VSD-' + Date.now(), num, b.v[0], String(b.v[18] || ''), b.v[1], d.arrivalRef || b.v[13] || '', st, ext || '', d.documentId || '', who, new Date(), op.id];
      if (cur && cur.MercuryUUID) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'ВСД получен из «Меркурия» — его статус меняется только через интеграцию', op.id); }
      if (cur) sh.getRange(cur._row, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
      var rr = _mvFind_(row[0]); if (rr) _mvSet_(rr, { VSDStatus: st === 'ПОГАШЕН' ? 'CANCELLED' : st === 'АННУЛИРОВАН' ? 'REJECTED' : 'FOUND', 'Источник': 'MANUAL',
        'Погашено': ext || '', 'Погасил': st === 'ПОГАШЕН' ? who + ' (внесено вручную)' : '', 'Результат гашения': st === 'ПОГАШЕН' ? 'внесено вручную, без подтверждения «Меркурия» (интеграция не настроена)' : '' });
      if (rr) _mvPassport_(b.v[0], rr);
      _audit_(op, 'VET_DOC_SAVE', 'ВСД', num, cur ? cur['Статус'] : null, { status: st, batch: b.v[0], extinguishedAt: ext ? _bcDate_(ext) : '' });
      _endOp_(op, 'COMPLETED');
      return _ok_({ vetId: row[0], status: st, batchId: b.v[0], note: st === 'ПОГАШЕН' && String(b.v[10]) === 'quarantine' ? 'ВСД погашен — отправьте партию на повторный входной контроль' : '' }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** §7 коды маркировки при приёмке партии (один код — одна единица товара; дубль кода — отказ). */
function mcAddMarkingCodes(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock', 'MARKING_ADD', 'Маркировка', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    var codes = (Array.isArray(d.codes) ? d.codes : String(d.codes || '').split(/\r?\n/)).map(function (x) { return String(x).replace(/[\u001d]/g, '').trim(); }).filter(Boolean);
    if (!codes.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Отсканируйте или введите коды маркировки', op.id); }
    return _withLock_(function () {
      var b = _bcFind_(d.batchId);
      if (!b) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Партия не найдена', op.id); }
      var have = {}; _sdRows_(MC_SD_MARK_, MC_SD_MARK_HEAD_).forEach(function (r) { have[String(r['Код маркировки'])] = r.BatchID; });
      var bad = [], dup = [], rows = [], who = (op.session && (op.session.name || op.session.fullName)) || '', seen = {};
      codes.forEach(function (c) {
        var g = /^01(\d{14})21/.exec(c);
        if (!g) { bad.push(c); return; }
        if (have[c] || seen[c]) { dup.push(c); return; }
        seen[c] = 1;
        rows.push(['MK-' + Date.now() + '-' + rows.length, c, g[1], b.v[0], String(b.v[17] || ''), b.v[1], d.receiptRef || b.v[13] || '', 'IN_CIRCULATION', '', who, new Date(), op.id]);
      });
      if (bad.length || dup.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', (bad.length ? 'Не распознаны как код маркировки (01+GTIN+21…): ' + bad.slice(0, 3).join(', ') + (bad.length > 3 ? '…' : '') + '. ' : '') + (dup.length ? 'Уже учтены: ' + dup.slice(0, 3).join(', ') : ''), op.id); }
      var sh = _bcSheet_(MC_SD_MARK_, MC_SD_MARK_HEAD_); sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
      _audit_(op, 'MARKING_ADD', 'Маркировка', b.v[0], null, { codes: rows.length, gtin: rows[0][2] });
      _endOp_(op, 'COMPLETED');
      return _ok_({ batchId: b.v[0], added: rows.length }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** §7 вывод из оборота (продажа/использование, списание, возврат) — с причиной; повторно — нельзя. */
function mcWithdrawMarking(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock', 'MARKING_WITHDRAW', 'Маркировка', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    var code = String(d.code || '').replace(/[\u001d]/g, '').trim(), reason = String(d.reason || '').trim();
    if (!reason) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите причину вывода из оборота (использовано в производстве, списание, возврат поставщику…)', op.id); }
    return _withLock_(function () {
      var r = _sdRows_(MC_SD_MARK_, MC_SD_MARK_HEAD_).filter(function (x) { return String(x['Код маркировки']) === code; })[0];
      if (!r) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Код не найден в учёте — сначала примите его с партией', op.id); }
      if (r['Статус'] === 'WITHDRAWN') { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Код уже выведен из оборота: ' + r['Причина вывода'], op.id); }
      var who = (op.session && (op.session.name || op.session.fullName)) || '';
      _bcSheet_(MC_SD_MARK_, MC_SD_MARK_HEAD_).getRange(r._row, 8, 1, 4).setValues([['WITHDRAWN', reason, who, new Date()]]);
      _audit_(op, 'MARKING_WITHDRAW', 'Маркировка', code, 'IN_CIRCULATION', { reason: reason, batch: r.BatchID });
      _endOp_(op, 'COMPLETED');
      return _ok_({ code: code, status: 'WITHDRAWN' }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

function mcGetSupplyDocs(token) {
  try {
    var s = _requireAuth_(token), perm = s.permissions || {}, t0 = _sdToday0_();
    var docs = _sdRows_(MC_SD_DOC_, MC_SD_DOC_HEAD_).reverse().map(function (r) { var till = _sdDate_(r._raw[4]); delete r._raw; r.expired = !!(till && till < t0); return r; });
    var vet = _mvRows_().reverse().map(function (r) { var v = _mvView_(r); v['Номер ВСД'] = v.number; v.BatchID = v.batches.join(', '); v['Статус'] = r['Статус']; v['Дата гашения'] = v.cancelledAt; v['Продукт'] = v.product; v['Кто'] = String(r['Кто'] || ''); return v; });
    var vpLast = {}; _sdRows_(MC_SD_VP_, MC_SD_VP_HEAD_).forEach(function (r) { delete r._raw; vpLast[String(r.ProductID)] = r; });
    var marks = _sdRows_(MC_SD_MARK_, MC_SD_MARK_HEAD_).reverse().slice(0, 500).map(function (r) { delete r._raw; return r; });
    var bv = _stockBatchesSheet_().getDataRange().getValues().slice(1).filter(function (r) { return r[0] && String(r[10]) !== 'consumed'; }).slice(-300).reverse()
      .map(function (r) { return { id: r[0], product: r[1], status: r[10], received: _bcDate_(r[4]), supplierId: r[18] || '', productId: r[17] || '', vet: _sdVetControlled_(r[17], r[1]) }; });
    bv.forEach(function (b) { if (b.vet) { var v = _sdBatchVet_(b.id); b.vetStatus = v.extinguished ? 'ПОГАШЕН' : v.list.length ? v.list[0]['Статус'] : 'нет ВСД'; } });
    var mc = _mvCfg_();
    return _ok_({ types: MC_SD_TYPES_, docs: docs, vet: vet, mercury: { configured: mc.ready, missing: mc.missing, canCancel: _mvCanCancel_(s), isAdmin: s.dev === true }, vetProducts: Object.keys(vpLast).map(function (k) { return vpLast[k]; }), marks: marks, batches: bv,
      vetRequired: _sdVetOn_(), canEdit: perm.all === true || perm.stock === true, canVet: perm.all === true || perm.haccp === true });
  } catch (e) { return _failFrom_(e); }
}
