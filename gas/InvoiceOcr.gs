/**
 * OCR документа приёмки. Точка входа сохранена для существующего потока
 * (createInvoiceIntakeDraft_, scanAndReceiveInvoice_, UAT): распознавание и сопоставление —
 * InvoiceRecognitionCore.gs (Yandex Vision page/handwritten, PDF, таблица по координатам,
 * YandexGPT, арифметика, вторая проверка, алиасы). Формат результата прежний:
 * {document:{invoice_number, invoice_date, supplier_id, ...}, lines:[{line_no, name, qty, unit, price, ...}]}.
 */
function runSupplierInvoiceOcr_(base64Image, mimeType, session) {
  return recognizeSupplierDocument_(base64Image, mimeType, session, '');
}
