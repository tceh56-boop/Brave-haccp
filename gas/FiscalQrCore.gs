// ЦЕХ — FiscalQrCore.gs
// QR-код кассового чека как дополнительное доказательство к распознанному документу (перенос
// MonChef_V13_FiscalQrEngine.gs). QR не заменяет фото: браузер расшифровывает QR (BarcodeDetector)
// и передаёт строку; сервер сверяет фискальные реквизиты с распознанным документом и хранит
// неизменяемую запись доказательства.
//   • сумма и дата из QR против суммы и даты документа; ФН и ФД — найдены ли в тексте чека;
//   • чек с теми же ФН/ФД/ФП, уже проведённый в другой приёмке, — повтор: черновик блокируется;
//   • признак расчёта «возврат прихода» — предупреждение: это чек возврата, не покупки.
// Значения документа не подменяются данными QR — расхождения показываются человеку.

var FISCAL_QR_OPERATIONS = { '1': 'приход', '2': 'возврат прихода', '3': 'расход', '4': 'возврат расхода' };

/** Строка QR кассового чека (t=…&s=…&fn=…&i=…&fp=…&n=…) → реквизиты. */
function parseFiscalQr_(raw) {
  raw = String(raw || '').trim();
  var q = raw, qm = q.indexOf('?'); if (qm >= 0) q = q.slice(qm + 1);
  var out = { raw: raw };
  q.split('&').forEach(function (pair) {
    var p = pair.indexOf('='); if (p < 0) return;
    var k = '', v = '';
    try { k = decodeURIComponent(pair.slice(0, p)).toLowerCase(); v = decodeURIComponent(pair.slice(p + 1).replace(/\+/g, ' ')); } catch (e) { return; }
    if (k) out[k] = v;
  });
  out.total = out.s !== undefined ? _irNum_(out.s) : null;
  var t = String(out.t || '').replace(/[^0-9]/g, '');
  if (t.length >= 12) out.datetime = t.slice(0, 4) + '-' + t.slice(4, 6) + '-' + t.slice(6, 8) + 'T' + t.slice(8, 10) + ':' + t.slice(10, 12);
  out.date = out.datetime ? out.datetime.slice(0, 10) : '';
  out.fn = out.fn || ''; out.fd = out.i || out.fd || ''; out.fp = out.fp || '';
  out.operation = out.n || '';
  out.valid = !!(out.datetime && out.total !== null && out.fn && out.fd && out.fp);
  out.key = out.valid ? [out.fn, out.fd, out.fp].join('|') : '';
  return out;
}

/** Сверка QR с распознанным документом: QR_MATCH | QR_PARTIAL | QR_CONFLICT | QR_INVALID. */
function compareFiscalQr_(qr, doc) {
  var warnings = [], checks = 0, ok = 0;
  if (!qr.valid) return { status: 'QR_INVALID', warnings: ['QR не похож на кассовый чек: нет даты, суммы, ФН, ФД или ФП.'], checks: 0 };
  if (doc.total !== '' && doc.total !== null && doc.total !== undefined && isFinite(Number(doc.total))) {
    checks++;
    if (Math.abs(Number(qr.total) - Number(doc.total)) <= 0.01) ok++;
    else warnings.push('Сумма по QR ' + qr.total + ' ₽, в распознанном документе ' + doc.total + ' ₽ — проверьте строки.');
  }
  if (doc.invoice_date) { checks++; if (qr.date === String(doc.invoice_date).slice(0, 10)) ok++; else warnings.push('Дата по QR ' + qr.date + ', в документе ' + doc.invoice_date + '.'); }
  var text = String(doc.raw_text || '');
  if (text) {
    checks++; if (text.indexOf(qr.fn) >= 0) ok++; else warnings.push('ФН ' + qr.fn + ' из QR не найден в тексте чека.');
    checks++; if (text.indexOf(qr.fd) >= 0) ok++; else warnings.push('ФД ' + qr.fd + ' из QR не найден в тексте чека.');
  }
  if (qr.operation && qr.operation !== '1') warnings.push('Признак расчёта по QR — «' + (FISCAL_QR_OPERATIONS[qr.operation] || qr.operation) + '»: это не чек покупки.');
  var status = !checks ? 'QR_NO_COMPARISON' : ok === checks ? 'QR_MATCH' : ok > 0 ? 'QR_PARTIAL' : 'QR_CONFLICT';
  return { status: status, warnings: warnings, checks: checks, matched: ok };
}

function _fqDuplicate_(key, draftId, session) {
  if (!key) return null;
  return findRows_('FISCAL_QR_EVIDENCE', function (e) { return e.organization_id === session.organization_id && e.fiscal_key === key && e.draft_id !== draftId; })
    .map(function (e) { return findOne_('INVOICE_INTAKE_DRAFTS', 'draft_id', e.draft_id); })
    .filter(function (d) { return d && ['POSTED', 'POSTING', 'PARTIAL', 'RECOVERY_REQUIRED'].indexOf(d.status) !== -1 && d.receipt_json; })[0] || null;
}

/** Приложить QR к черновику приёмки: сверка, запись доказательства, повтор чека → блокировка. */
function attachFiscalQr_(data, session) {
  return withLock_(function () {
    var d = findOne_('INVOICE_INTAKE_DRAFTS', 'draft_id', data.draftId); assertOwnedByOrg_(session, d, 'INVOICE_INTAKE_DRAFTS:' + data.draftId);
    if (['POSTED', 'POSTING'].indexOf(d.status) !== -1) throw new Error('Приёмка уже проведена.');
    var qr = parseFiscalQr_(data.qrRaw);
    if (!qr.raw) throw new Error('Пустая строка QR.');
    var doc = JSON.parse(d.document_json || '{}'), cmp = compareFiscalQr_(qr, doc), dup = _fqDuplicate_(qr.key, d.draft_id, session);
    if (dup) cmp.warnings.unshift('Этот чек (ФН ' + qr.fn + ', ФД ' + qr.fd + ') уже проведён в приёмке ' + dup.draft_id + '.');
    insertRow_('FISCAL_QR_EVIDENCE', { evidence_id: generateId_('FISCAL_QR_EVIDENCE'), organization_id: session.organization_id, draft_id: d.draft_id, qr_raw: qr.raw, fiscal_datetime: qr.datetime || '',
      total: qr.total === null ? '' : qr.total, fn: qr.fn, fd: qr.fd, fp: qr.fp, operation: qr.operation, fiscal_key: qr.key, match_status: dup ? 'QR_DUPLICATE' : cmp.status,
      warnings_json: JSON.stringify(cmp.warnings), created_at: nowIso_(), created_by: session.user_id });
    doc.fiscal_qr = { status: dup ? 'QR_DUPLICATE' : cmp.status, total: qr.total, datetime: qr.datetime || '', fn: qr.fn, fd: qr.fd, fp: qr.fp, operation: qr.operation, warnings: cmp.warnings, duplicate_of: dup ? dup.draft_id : '' };
    if (cmp.status === 'QR_CONFLICT' || dup) doc.requires_manual_review = true;
    var lines = JSON.parse(d.lines_json || '[]'), st = buildInvoiceDraftState_(doc, lines, session, d.draft_id);
    updateRow_('INVOICE_INTAKE_DRAFTS', d, { status: st.status, document_json: JSON.stringify(doc), lines_json: JSON.stringify(lines), matched_lines_json: JSON.stringify(st.mapped),
      integrity_json: JSON.stringify(st.integrity), warnings_json: JSON.stringify(st.warnings), errors_json: JSON.stringify(st.errors) });
    auditLog_(session.user_id, 'QR кассового чека', 'INVOICE_INTAKE_DRAFTS:' + d.draft_id, '', doc.fiscal_qr.status + ' ' + qr.key, 'success', session.cascade_id || '');
    return getInvoiceIntakeDraft_(session, { draftId: d.draft_id });
  });
}

/** Перед проводкой: чек не должен быть уже проведён (повтор мог появиться после сверки). */
function assertFiscalNotDuplicate_(draft, session) {
  var doc = JSON.parse(draft.document_json || '{}'), f = doc.fiscal_qr;
  if (!f || !f.fn) return;
  var dup = _fqDuplicate_([f.fn, f.fd, f.fp].join('|'), draft.draft_id, session);
  if (dup) throw new Error('Чек с ФН ' + f.fn + ', ФД ' + f.fd + ' уже проведён в приёмке ' + dup.draft_id + '. Повторная приёмка по тому же чеку заблокирована.');
}

function migrateFiscalQrSchema_() { return { ok: true, changed: ensureSchemaColumns_('FISCAL_QR_EVIDENCE') }; }
