// ЦЕХ — ReceiptCorrectionCore.gs
// Корректировка проведённой приёмки (перенос MonChef_ReceiptCorrection.gs).
// Проведённую накладную «по месту» не правят: партия и исходная операция остаются как были,
// ошибку исправляют корректировкой — предложение с причиной → утверждение другим человеком.
//   • количество: меняется количество партии; остаток = количество − расход, поэтому уменьшить
//     можно только на то, что ещё не израсходовано (иначе — списание или возврат);
//     в журнал склада пишется операция «корректировка» на разницу;
//   • цена: меняется цена партии, средневзвешенная цена продукта пересчитывается на разницу по
//     остатку партии, затем себестоимость блюд (каскад Food Cost);
//   • срок годности корректировкой не меняется (срок — с этикетки или решением по ХАССП).
// Создаёт — кто принимает товар (модуль warehouse_receive); утверждает — директор/администратор
// (audit_admin), и не автор корректировки.

var RECEIPT_CORRECTION_FIELDS = { qty: 'Количество', price: 'Цена за единицу' };
var RECEIPT_CORRECTION_STATUS = { OPEN: 'На утверждении', APPROVED: 'Утверждена', REJECTED: 'Отклонена' };

/** Приёмка по накладной, в которой создана партия. */
function _rcDraftOfBatch_(batchId, session) {
  return findRows_('INVOICE_INTAKE_DRAFTS', function (d) { return d.organization_id === session.organization_id && d.receipt_json && String(d.receipt_json).indexOf('"' + batchId + '"') !== -1; })[0] || null;
}

function _rcBatch_(batchId, session) {
  var b = findOne_('BATCHES', 'batch_id', batchId); if (!b) throw new Error('Партия не найдена: ' + batchId);
  var p = getProductById_(b.product_id); assertOwnedByOrg_(session, p, 'PRODUCTS:' + b.product_id);
  return { batch: b, product: p };
}

function createReceiptCorrection_(data, session) {
  return withLock_(function () {
    var field = String(data.field || ''), reason = String(data.reason || '').trim(), val = _irNum_(data.value);
    if (!RECEIPT_CORRECTION_FIELDS[field]) throw new Error('Что исправить: количество (qty) или цену (price).');
    if (val === null || val < 0 || (field === 'qty' && val === 0)) throw new Error(field === 'qty' ? 'Новое количество — число больше нуля (полный отказ — списание или возврат).' : 'Новая цена — число не меньше нуля.');
    if (reason.length < 5) throw new Error('Укажите причину корректировки.');
    var x = _rcBatch_(data.batchId, session), b = x.batch;
    var draft = _rcDraftOfBatch_(b.batch_id, session);
    if (!draft) throw new Error('Партия не из приёмки по накладной — корректировка накладной к ней не относится.');
    var before = field === 'qty' ? Number(b.количество) : Number(b.цена_прихода);
    if (Math.abs(before - val) < 1e-9) throw new Error('Новое значение совпадает с проведённым.');
    var open = findRows_('RECEIPT_CORRECTIONS', function (r) { return r.batch_id === b.batch_id && r.field === field && r.status === 'OPEN'; })[0];
    if (open) throw new Error('По этой партии уже ждёт утверждения корректировка ' + open.correction_id + '.');
    var doc = JSON.parse(draft.document_json || '{}');
    var row = { correction_id: generateId_('RECEIPT_CORRECTIONS'), organization_id: session.organization_id, location_id: b.location_id, batch_id: b.batch_id, draft_id: draft.draft_id,
      document_number: doc.invoice_number || '', supplier_id: doc.supplier_id || '', product_id: b.product_id, field: field, before: before, after: val, unit: x.product.единица || '',
      reason: reason, status: 'OPEN', created_by: session.user_id, created_at: nowIso_(), decided_by: '', decided_at: '', decision_comment: '', applied_json: '' };
    insertRow_('RECEIPT_CORRECTIONS', row);
    if (typeof notifyRole_ === 'function') { try { notifyRole_(session.organization_id, 'ДИРЕКТОР', 'Корректировка накладной № ' + row.document_number, x.product.название + ': ' + RECEIPT_CORRECTION_FIELDS[field].toLowerCase() + ' ' + before + ' → ' + val + '. Причина: ' + reason); } catch (e) {} }
    auditLog_(session.user_id, 'Корректировка приёмки создана', 'BATCHES:' + b.batch_id, String(before), String(val) + ' (' + field + '): ' + reason, 'success', session.cascade_id || '');
    var view = _rcView_(row);
    if (field === 'qty' && b.veterinary_document_id) view.warning = 'К партии привязан ВСД: после утверждения количество в приёмке разойдётся с ВСД, и гашение заблокируется. Частичную приёмку оформляют в «Меркурии».';
    return view;
  });
}

function decideReceiptCorrection_(data, session) {
  return withLock_(function () {
    var r = findOne_('RECEIPT_CORRECTIONS', 'correction_id', data.id); assertOwnedByOrg_(session, r, 'RECEIPT_CORRECTIONS:' + data.id);
    var dec = String(data.decision || '').toUpperCase(), comment = String(data.comment || '').trim();
    if (dec !== 'APPROVE' && dec !== 'REJECT') throw new Error('Решение: APPROVE или REJECT.');
    if (dec === 'REJECT' && !comment) throw new Error('Укажите, почему корректировка отклонена.');
    if (r.status !== 'OPEN') throw new Error('Корректировка уже ' + RECEIPT_CORRECTION_STATUS[r.status].toLowerCase() + '.');
    if (r.created_by === session.user_id) throw new Error('Свою корректировку утверждает другой сотрудник.');
    var applied = null;
    if (dec === 'APPROVE') {
      var x = _rcBatch_(r.batch_id, session), b = x.batch, after = Number(r.after);
      if (r.field === 'qty') {
        var got = Number(b.количество), rest = getBatchRemaining_(b), delta = after - got, newRest = Math.round((rest + delta) * 1000) / 1000;
        if (newRest < 0) throw new Error('Из партии уже израсходовано больше: остаток ' + rest + ' ' + (x.product.единица || '') + ', уменьшение на ' + (-delta) + '. Оформите списание или возврат.');
        updateRow_('BATCHES', b, { количество: after });
        _recordOp_(session.organization_id, b.location_id, b.product_id, OP_TYPES.ADJUSTMENT, Math.round(delta * 1000) / 1000, Number(b.цена_прихода) || 0, b.batch_id, session.user_id, session);
        applied = { qty: { before: got, after: after }, remaining: { before: rest, after: newRest } };
      } else {
        var oldPrice = Number(b.цена_прихода) || 0, rem = getBatchRemaining_(b), p = x.product;
        updateRow_('BATCHES', b, { цена_прихода: after });
        // Средневзвешенная цена: поправка на разницу цены по ещё не израсходованному остатку партии.
        var stock = (typeof uniqueLocationsForProduct_ === 'function' ? uniqueLocationsForProduct_(p.product_id) : [b.location_id]).reduce(function (s, loc) { return s + getStockLevel_(p.product_id, loc); }, 0);
        var avg = Number(p.текущая_цена) || 0, newAvg = stock > 0 && b.статус === 'активна' ? round2_(avg + (after - oldPrice) * rem / stock) : avg;
        if (newAvg !== avg) {
          updateRow_('PRODUCTS', p, { текущая_цена: newAvg, обновлено: nowIso_() });
          if (typeof recordPriceHistory_ === 'function') recordPriceHistory_({ organization_id: p.organization_id, product_id: p.product_id, price_type: 'WEIGHTED_AVG', old_price: avg, new_price: newAvg, source: 'RECEIPT_CORRECTION', batch_id: b.batch_id });
          if (typeof recalcFoodCostForProduct_ === 'function') recalcFoodCostForProduct_(p.product_id);
        }
        applied = { price: { before: oldPrice, after: after }, product_avg_price: { before: avg, after: newAvg } };
      }
    }
    updateRow_('RECEIPT_CORRECTIONS', r, { status: dec === 'APPROVE' ? 'APPROVED' : 'REJECTED', decided_by: session.user_id, decided_at: nowIso_(), decision_comment: comment, applied_json: applied ? JSON.stringify(applied) : '' });
    auditLog_(session.user_id, dec === 'APPROVE' ? 'Корректировка приёмки утверждена' : 'Корректировка приёмки отклонена', 'BATCHES:' + r.batch_id, String(r.before), String(r.after) + ' (' + r.field + ')' + (applied ? ' ' + JSON.stringify(applied) : '') + (comment ? ': ' + comment : ''), 'success', session.cascade_id || '');
    return _rcView_(r);
  });
}

function _rcView_(r) {
  var p = getProductById_(r.product_id);
  return { id: r.correction_id, batch_id: r.batch_id, draft_id: r.draft_id, document_number: r.document_number, product: p ? p.название : r.product_id, field: r.field, field_ru: RECEIPT_CORRECTION_FIELDS[r.field],
    before: r.before, after: r.after, unit: r.unit, reason: r.reason, status: r.status, status_ru: RECEIPT_CORRECTION_STATUS[r.status], created_by: r.created_by, created_at: String(r.created_at || ''),
    decided_by: r.decided_by, decided_at: String(r.decided_at || ''), comment: r.decision_comment, applied: r.applied_json ? JSON.parse(r.applied_json) : null };
}

function getReceiptCorrections_(data, session) {
  data = data || {};
  return findRows_('RECEIPT_CORRECTIONS', function (r) { return r.organization_id === session.organization_id && (!data.batchId || r.batch_id === data.batchId) && (!data.draftId || r.draft_id === data.draftId) && (!data.status || r.status === data.status); })
    .slice(-200).reverse().map(_rcView_);
}

/** Партии проведённой приёмки — для экрана корректировки. */
function getReceiptBatches_(data, session) {
  var d = findOne_('INVOICE_INTAKE_DRAFTS', 'draft_id', data.draftId); assertOwnedByOrg_(session, d, 'INVOICE_INTAKE_DRAFTS:' + data.draftId);
  var rc = d.receipt_json ? JSON.parse(d.receipt_json) : null, ids = [];
  ((rc && rc.результаты) || []).forEach(function (x) { if (x.результат && x.результат.batch_id) ids.push(x.результат.batch_id); });
  return ids.map(function (id) {
    var b = findOne_('BATCHES', 'batch_id', id); if (!b) return null;
    var p = getProductById_(b.product_id);
    return { batch_id: id, product: p ? p.название : b.product_id, unit: p ? p.единица : '', qty: Number(b.количество), price: Number(b.цена_прихода), remaining: getBatchRemaining_(b), status: b.статус,
      vsd: b.veterinary_document_id || '', expiry: b.срок_годности || '' };
  }).filter(Boolean);
}

function migrateReceiptCorrectionSchema_() { return { ok: true, changed: ensureSchemaColumns_('RECEIPT_CORRECTIONS') }; }
