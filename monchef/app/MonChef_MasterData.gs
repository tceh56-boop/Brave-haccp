/**
 * MON CHEF — справочники с идентификаторами (Master Data).
 *
 * Поставщики: лист «Поставщики» (SupplierID, ИНН, статус ACTIVE / REVIEW / BLOCKED, документы).
 * Продукты:   стабильный ProductID из «Продукты_ID_V53» (модуль «Товары и единицы»).
 * Каждая новая партия хранит ProductID и SupplierID (колонки «ProductID», «SupplierID»
 * листа «Склад_Партии»), заказ поставщику — SupplierID. Название остаётся для людей,
 * связь — по ID. Новый поставщик из прихода/заказа попадает в реестр со статусом REVIEW
 * (реквизиты подтверждает человек); партия от заблокированного поставщика уходит в карантин.
 */
var MC_SUP_SHEET_ = 'Поставщики';
var MC_SUP_HEAD_ = ['SupplierID', 'Название', 'ИНН', 'Адрес', 'Контакты', 'Категории', 'Документы', 'Статус', 'Комментарий', 'Создан', 'Обновлено', 'Кто'];
var MC_BATCH_ID_COLS_ = { product: 18, supplier: 19 };   // номера колонок (1-based) в «Склад_Партии»

function _mdNorm_(x) { return String(x == null ? '' : x).toLowerCase().replace(/ё/g, 'е').replace(/[«»"']/g, '').replace(/\s+/g, ' ').trim(); }
function _mdSupSheet_() { return _bcSheet_(MC_SUP_SHEET_, MC_SUP_HEAD_); }
function _mdSuppliers_() {
  var v = _mdSupSheet_().getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) if (v[i][0]) out.push({ row: i + 1, id: String(v[i][0]), name: v[i][1], inn: String(v[i][2] || ''), address: v[i][3], contacts: v[i][4], categories: v[i][5], documents: v[i][6], status: String(v[i][7] || 'REVIEW'), note: v[i][8] });
  return out;
}
function _mdSupplierId_(name, inn) { var key = inn ? 'INN' + String(inn).replace(/\D/g, '') : _mdNorm_(name); return 'SUP-' + _v53Hash_(key); }
/** Найти поставщика по ID, ИНН или названию; при autoCreate — завести со статусом REVIEW. */
function _mdResolveSupplier_(ref, autoCreate, who) {
  var r = String(ref || '').trim(); if (!r) return null;
  var list = _mdSuppliers_(), k = _mdNorm_(r).replace(/\s*\(.*\)\s*$/, '');
  var hit = list.filter(function (s) { return s.id === r || (s.inn && s.inn === r.replace(/\D/g, '')) || _mdNorm_(s.name) === k; })[0];
  if (hit || !autoCreate) return hit || null;
  var id = _mdSupplierId_(r.replace(/\s*\(.*\)\s*$/, ''), '');
  _mdSupSheet_().appendRow([id, r.replace(/\s*\(.*\)\s*$/, ''), '', '', '', '', '', 'REVIEW', 'заведён автоматически из прихода/заказа — подтвердите реквизиты', new Date(), new Date(), who || 'SYSTEM']);
  return { id: id, name: r, status: 'REVIEW' };
}
/** ProductID по названию: из реестра «Продукты_ID_V53», при отсутствии — регистрируется (тот же стабильный хеш). */
function _mdProductId_(name) {
  var n = String(name || '').trim(); if (!n) return '';
  try {
    setupV53ProductUnits();
    var idx = _v53ProductIndex_(), k = _v53Norm_(n);
    var hit = idx.byName && idx.byName[k]; if (hit) { var h = Array.isArray(hit) ? hit[0] : hit; if (h && h.ProductID) return String(h.ProductID); }
    var m = _v53Rows_(V53.MAP, V53H.MAP).filter(function (x) { return _v53Norm_(x.SourceName) === k && x.ProductID; })[0];
    if (m) return String(m.ProductID);
    var id = _v53Pid_(n, '');
    _v53Sh_(V53.PRODUCTS, V53H.PRODUCTS).appendRow([id, n, '', '', '', 'UNKNOWN', 'YES', 'STOCK_INCOME', new Date()]);
    return id;
  } catch (e) { return ''; }
}
/** Проставить ID в новой партии (вызывается из _createBatch_). */
function _mdStampBatch_(sh, row, name, supplierRef) {
  try {
    var hdr = sh.getRange(1, MC_BATCH_ID_COLS_.product, 1, 2).getValues()[0];
    if (!hdr[0] && !hdr[1]) sh.getRange(1, MC_BATCH_ID_COLS_.product, 1, 2).setValues([['ProductID', 'SupplierID']]);
    var sup = _mdResolveSupplier_(supplierRef, true);
    sh.getRange(row, MC_BATCH_ID_COLS_.product, 1, 2).setValues([[_mdProductId_(name), sup ? sup.id : '']]);
    return sup;
  } catch (e) { return null; }
}

function mcGetSuppliers(token) { try { _requireAuth_(token); return _ok_(_mdSuppliers_()); } catch (e) { return _failFrom_(e); } }
function mcSaveSupplier(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'procurement', 'SUPPLIER_SAVE', 'Поставщик', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    if (!String(d.name || '').trim()) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите название поставщика', op.id); }
    var inn = String(d.inn || '').replace(/\D/g, '');
    if (inn && inn.length !== 10 && inn.length !== 12) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'ИНН — 10 или 12 цифр', op.id); }
    var st = d.status === 'BLOCKED' ? 'BLOCKED' : (inn ? (d.status === 'REVIEW' ? 'REVIEW' : 'ACTIVE') : 'REVIEW');
    return _withLock_(function () {
      var list = _mdSuppliers_(), cur = d.id ? list.filter(function (s) { return s.id === d.id; })[0] : null;
      var dupInn = inn && list.filter(function (s) { return s.inn === inn && s.id !== d.id; })[0];
      if (dupInn) { _endOp_(op, 'FAILED'); return _fail_('DUPLICATE', 'Поставщик с ИНН ' + inn + ' уже есть: ' + dupInn.name, op.id); }
      var id = cur ? cur.id : _mdSupplierId_(d.name, inn), who = (op.session && op.session.name) || '';
      var row = [id, d.name, inn, d.address || '', d.contacts || '', d.categories || '', d.documents || '', st, d.note || '', cur ? '' : new Date(), new Date(), who];
      var sh = _mdSupSheet_();
      if (cur) { row[9] = sh.getRange(cur.row, 10).getValue(); sh.getRange(cur.row, 1, 1, row.length).setValues([row]); } else sh.appendRow(row);
      _audit_(op, 'SUPPLIER_SAVE', 'Поставщик', id, cur ? [cur.name, cur.inn, cur.status] : null, [d.name, inn, st]);
      _endOp_(op, 'COMPLETED');
      return _ok_({ id: id, status: st, note: st === 'REVIEW' ? 'Без ИНН поставщик остаётся на проверке' : '' }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Перенос: поставщики из истории заказов и партий → реестр (статус REVIEW). Только реальные названия из данных. */
function mcMigrateSuppliers(token) {
  try {
    var s = _requireAuth_(token, 'procurement');
    var names = {};
    try { _supplierOrdersSheet_().getDataRange().getValues().slice(1).forEach(function (r) { if (r[2]) names[String(r[2]).trim()] = 1; }); } catch (e) {}
    var before = _mdSuppliers_().length;
    Object.keys(names).forEach(function (n) { _mdResolveSupplier_(n, true, s.name); });
    return _ok_({ added: _mdSuppliers_().length - before, total: _mdSuppliers_().length });
  } catch (e) { return _failFrom_(e); }
}
