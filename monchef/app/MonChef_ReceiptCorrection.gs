/**
 * MON CHEF — корректировка проведённой накладной (этап 10.7, улучшенное ТЗ §5).
 *
 * Проведённую накладную никто не правит «по месту»: паспорт партии («Приёмка_Партии») и исходная операция
 * остаются как были. Ошибку исправляют корректировкой:
 *   • создаёт Шеф-повар, Су-шеф или Директор (право «корректировка накладной — создание») с причиной;
 *   • утверждает Директор с индивидуальным правом «Корректировка проведённой накладной» (doc_edit) — и не автор;
 *   • после утверждения меняется партия (количество и остаток или цена), в истории партии — CORRECTION,
 *     в журнале склада — операция «Корректировка», в аудите — было → стало.
 * Повара, кондитер, администратор и ответственный за ХАССП корректировку не создают (шлюз: 403).
 * Срок годности корректировкой не меняется: срок — с этикетки или решением ответственного за ХАССП.
 */
var MC_RC_SHEET_ = 'Корректировки_Накладных';
var MC_RC_HEAD_ = ['ID', 'Создано', 'Поставщик', 'Накладная', 'BatchID', 'Товар', 'Что исправить', 'Было', 'Стало', 'Ед.', 'Причина',
  'Автор', 'Роль автора', 'ID автора', 'Статус', 'Решил', 'Когда решено', 'Комментарий решения', 'OperationID'];
var MC_RC_C_ = {}; MC_RC_HEAD_.forEach(function (h, i) { MC_RC_C_[h] = i; });
var MC_RC_FIELDS_ = { qty: 'Количество', price: 'Цена за единицу' };
var MC_RC_ST_ = { OPEN: 'На утверждении', APPROVED: 'Утверждена', REJECTED: 'Отклонена' };

function _rcSheet_() { return _bcSheet_(MC_RC_SHEET_, MC_RC_HEAD_); }
function _rcRows_() {
  var v = _rcSheet_().getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) if (v[i][0]) out.push({ row: i + 1, v: v[i] });
  return out;
}
function _rcView_(r) {
  var v = r.v, C = MC_RC_C_, f = function (d) { return d instanceof Date ? _mcRbFmt_(d) : String(d || ''); };
  return { id: v[C['ID']], created: f(v[C['Создано']]), supplier: v[C['Поставщик']], docNo: v[C['Накладная']], batchId: v[C['BatchID']], product: v[C['Товар']],
    field: v[C['Что исправить']], before: v[C['Было']], after: v[C['Стало']], unit: v[C['Ед.']], reason: v[C['Причина']], author: v[C['Автор']], authorRole: v[C['Роль автора']],
    authorId: String(v[C['ID автора']] || ''), status: v[C['Статус']], decidedBy: v[C['Решил']], decidedAt: f(v[C['Когда решено']]), comment: v[C['Комментарий решения']] };
}

/** Создать корректировку. json: {batchId, field:'qty'|'price', value, reason} */
function mcReceiptCorrectionCreate(json, token) {
  var op = null;
  try { op = _beginOp_(token, null, 'RECEIPT_CORRECTION', 'Накладная', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var s = op.session;
    if (!_mcRbHasExact_(s, 'doc_correct|doc_edit')) { _mcRbAuditDenied_(s, 'mcReceiptCorrectionCreate', 'doc_correct|doc_edit', ''); _endOp_(op, 'FAILED'); return _mcRbDenyJson_('Корректировку накладной создают шеф-повар, су-шеф или директор.'); }
    var d = _mcBlJson_(json), field = String(d.field || ''), reason = String(d.reason || '').trim(), val = _bcNum_(d.value);
    if (!MC_RC_FIELDS_[field]) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Что исправить: количество или цену', op.id); }
    if (val === null || val < 0) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Новое значение — число не меньше нуля', op.id); }
    if (reason.length < 5) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите причину корректировки', op.id); }
    var b = _bcFind_(d.batchId), pass = _mcBlPass_(d.batchId);
    if (!b) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Партия не найдена', op.id); }
    if (!pass) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Партия не из приёмки по накладной — корректировка накладной к ней не относится', op.id); }
    var before = field === 'qty' ? _bcNum_(b.v[3]) : _bcNum_(b.v[6]);
    if (before === val) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Новое значение совпадает с проведённым', op.id); }
    var open = _rcRows_().filter(function (r) { return String(r.v[MC_RC_C_['BatchID']]) === String(d.batchId) && r.v[MC_RC_C_['Статус']] === MC_RC_ST_.OPEN && r.v[MC_RC_C_['Что исправить']] === MC_RC_FIELDS_[field]; })[0];
    if (open) { _endOp_(op, 'FAILED'); return _fail_('DUPLICATE', 'По этой партии уже ждёт утверждения корректировка ' + open.v[0], op.id); }
    var who = _author_(op), id = 'КН-' + _mcBlYmd_(new Date()) + '-' + Utilities.getUuid().slice(0, 6).toUpperCase();
    var supplier = String(pass.v[MC_RCV_C_['Поставщик']] || ''), docNo = String(pass.v[MC_RCV_C_['Накладная']] || '');
    _withLock_(function () { _rcSheet_().appendRow([id, new Date(), supplier, docNo, String(d.batchId), String(b.v[1]), MC_RC_FIELDS_[field], before === null ? '' : before, val, String(b.v[2] || ''), reason,
      who.фио, who.роль, who.id, MC_RC_ST_.OPEN, '', '', '', op.id]); });
    _notify_('receipt_correction', 'warning', 'Корректировка накладной № ' + docNo, supplier + ' · ' + b.v[1] + ': ' + MC_RC_FIELDS_[field].toLowerCase() + ' ' + before + ' → ' + val + '. Причина: ' + reason + '. Автор: ' + who.фио + '.', 'Директор', 'rc|' + id, op);
    _audit_(op, 'RECEIPT_CORRECTION_CREATE', 'Накладная', docNo, { [MC_RC_FIELDS_[field]]: before }, { [MC_RC_FIELDS_[field]]: val, batchId: String(d.batchId), reason: reason, correctionId: id });
    _endOp_(op);
    return _ok_({ id: id, status: MC_RC_ST_.OPEN, note: 'Корректировка ' + id + ' ждёт утверждения директором. Партия и накладная не изменены.' }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Утвердить или отклонить. json: {id, decision:'APPROVE'|'REJECT', comment} */
function mcReceiptCorrectionDecide(json, token) {
  var op = null;
  try { op = _beginOp_(token, null, 'RECEIPT_CORRECTION_DECIDE', 'Накладная', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var s = op.session;
    if (!_mcRbHasExact_(s, 'doc_edit')) { _mcRbAuditDenied_(s, 'mcReceiptCorrectionDecide', 'doc_edit', ''); _endOp_(op, 'FAILED'); return _mcRbDenyJson_('Корректировку накладной утверждает директор с правом «Корректировка проведённой накладной».'); }
    var d = _mcBlJson_(json), dec = String(d.decision || '').toUpperCase(), comment = String(d.comment || '').trim();
    if (dec !== 'APPROVE' && dec !== 'REJECT') { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Решение: утвердить или отклонить', op.id); }
    if (dec === 'REJECT' && !comment) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите, почему корректировка отклонена', op.id); }
    return _withLock_(function () {
      var r = _rcRows_().filter(function (x) { return String(x.v[0]) === String(d.id || ''); })[0];
      if (!r) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Корректировка не найдена', op.id); }
      var C = MC_RC_C_, v = r.v;
      if (v[C['Статус']] !== MC_RC_ST_.OPEN) { _endOp_(op, 'FAILED'); return _fail_('BATCH_STATE', 'Корректировка уже ' + String(v[C['Статус']]).toLowerCase(), op.id); }
      if (!s.dev && String(v[C['ID автора']]) === String(s.user_id)) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', 'Свою корректировку утверждает другой сотрудник', op.id); }
      var who = _author_(op), sh = _rcSheet_(), batchId = String(v[C['BatchID']]), field = v[C['Что исправить']], after = _bcNum_(v[C['Стало']]), applied = null;
      if (dec === 'APPROVE') {
        var b = _bcFind_(batchId); if (!b) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Партия ' + batchId + ' не найдена', op.id); }
        if (field === MC_RC_FIELDS_.qty) {
          var got = _bcNum_(b.v[3]) || 0, rest = _bcNum_(b.v[9]) || 0, delta = after - got, newRest = Math.round((rest + delta) * 1000) / 1000;
          if (newRest < 0) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Из партии уже израсходовано больше: остаток ' + rest + ' ' + b.v[2] + ', уменьшение на ' + (-delta) + '. Оформите списание или возврат.', op.id); }
          b.sh.getRange(b.row, 4).setValue(after); b.sh.getRange(b.row, 10).setValue(newRest);
          if (newRest <= 0.001 && b.v[10] === 'active') _bcSetStatus_(b, 'consumed');
          else if (newRest > 0.001 && b.v[10] === 'consumed') _bcSetStatus_(b, 'active');
          var price = _bcNum_(b.v[6]) || 0;
          _stockOpsSheet_().appendRow(['OP' + Date.now() + Math.floor(Math.random() * 1000), new Date(), 'Корректировка', _cleanProdName_(b.v[1]), Math.round(delta * 1000) / 1000, b.v[2] || 'г',
            price, Math.round(price * delta * 100) / 100, 'Корректировка накладной ' + v[C['ID']], 'накладная № ' + v[C['Накладная']] + ' · ' + v[C['Причина']], new Date()]);
          _applyStockDelta_(b.v[1], b.v[2] || 'г', delta, 0);
          applied = { qty: { before: got, after: after }, rest: { before: rest, after: newRest } };
        } else {
          var oldPrice = _bcNum_(b.v[6]); b.sh.getRange(b.row, 7).setValue(after);
          applied = { price: { before: oldPrice, after: after } };
        }
        _mcBlEvent_(op, batchId, 'CORRECTION', { before: applied, after: { correction: v[C['ID']] }, reason: 'Корректировка накладной № ' + v[C['Накладная']] + ': ' + v[C['Причина']], doc: v[C['ID']] });
      }
      sh.getRange(r.row, C['Статус'] + 1, 1, 4).setValues([[dec === 'APPROVE' ? MC_RC_ST_.APPROVED : MC_RC_ST_.REJECTED, who.фио, new Date(), comment]]);
      try { _rcNotifyDone_('rc|' + v[C['ID']]); } catch (e) {}
      _audit_(op, dec === 'APPROVE' ? 'RECEIPT_CORRECTION_APPROVED' : 'RECEIPT_CORRECTION_REJECTED', 'Накладная', String(v[C['Накладная']]), { [field]: v[C['Было']] }, { [field]: v[C['Стало']], correctionId: v[C['ID']], author: v[C['Автор']], applied: applied, comment: comment });
      _endOp_(op);
      return _ok_({ id: v[C['ID']], status: dec === 'APPROVE' ? MC_RC_ST_.APPROVED : MC_RC_ST_.REJECTED, applied: applied }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Список корректировок (по накладной или все последние). json: {supplier, docNo, batchId} */
function mcGetReceiptCorrections(json, token) {
  try {
    var s = _requireAuth_(token);
    if (!_mcRbHasExact_(s, 'invoices_view|stock|doc_correct|doc_edit')) return _mcRbDenyJson_('Корректировки накладных — для тех, кто видит накладные.');
    var d = _mcBlJson_(json), C = MC_RC_C_;
    var out = _rcRows_().filter(function (r) {
      if (d.batchId && String(r.v[C['BatchID']]) !== String(d.batchId)) return false;
      if (d.docNo && String(r.v[C['Накладная']]) !== String(d.docNo)) return false;
      if (d.supplier && String(r.v[C['Поставщик']]) !== String(d.supplier)) return false;
      return true;
    }).reverse().slice(0, 200).map(_rcView_);
    return _ok_({ items: out, canCreate: _mcRbHasExact_(s, 'doc_correct|doc_edit'), canDecide: _mcRbHasExact_(s, 'doc_edit'), me: String(s.user_id || '') });
  } catch (e) { return _failFrom_(e); }
}

/** Уведомление о корректировке закрыть после решения (если есть такая функция уведомлений). */
function _rcNotifyDone_(key) {
  var sh = _book_().getSheetByName('Уведомления'); if (!sh) return;
  var v = sh.getDataRange().getValues(), h = v[0] || [], kc = -1, sc = -1;
  for (var j = 0; j < h.length; j++) { if (/ключ|key/i.test(String(h[j]))) kc = j; if (/^статус$|^status$/i.test(String(h[j]))) sc = j; }
  if (kc < 0 || sc < 0) return;
  for (var i = 1; i < v.length; i++) if (String(v[i][kc]) === key) sh.getRange(i + 1, sc + 1).setValue('DONE');
}
