/* ============================================================================
 * MON CHEF V9 — DOCUMENT INTAKE / REAL DOCUMENT PROFILES
 *
 * Based on real production samples:
 *   - retail fiscal receipt (Пятёрочка / Магнит)
 *   - handwritten товарный чек
 *   - supplier invoice / счёт на оплату
 *   - УПД
 *   - payment order / bank document
 *   - banquet order sheet with handwritten notes
 *
 * IMPORTANT:
 *   This module does not invent missing values and does not post stock merely
 *   because a document was photographed. A human confirmation step remains
 *   required for ambiguous OCR and for documents that create accounting/stock
 *   movements.
 * ========================================================================== */

var MC_V9_DOC_TYPES = {
  RETAIL_RECEIPT: 'RETAIL_RECEIPT',       // кассовый чек магазина
  PRODUCT_RECEIPT: 'PRODUCT_RECEIPT',     // товарный чек, incl. handwritten
  INVOICE: 'INVOICE',                     // счёт на оплату
  UPD: 'UPD',                             // универсальный передаточный документ
  PAYMENT_ORDER: 'PAYMENT_ORDER',         // платёжное поручение / подтверждение оплаты
  BANQUET_ORDER: 'BANQUET_ORDER',         // заказ/бланк банкета
  UNKNOWN: 'UNKNOWN'
};

var MC_V9_DOC_STATUS = {
  OCR: 'OCR',
  REVIEW: 'REVIEW',
  CONFIRMED: 'CONFIRMED',
  REJECTED: 'REJECTED',
  LINKED: 'LINKED'
};

/** Create the sheet structures without deleting existing data. */
function mcV9EnsureDocumentIntakeSheets() {
  var ss = _book_();
  var specs = {
    'DOC_CAPTURE': [
      'CaptureID','DocumentType','SourceType','SourceFileID','CapturedAt','CapturedBy',
      'Supplier','DocumentNumber','DocumentDate','PaymentDate','RelatedCaptureID','BanquetID',
      'Total','Currency','RecognitionConfidence','Status','ReviewReason','OCRTextFileID','Hash','CreatedAt'
    ],
    'DOC_CAPTURE_LINES': [
      'CaptureID','LineNumber','RawName','NormalizedName','ProductName','ProductMatchConfidence',
      'Quantity','Unit','Price','Sum','VAT','BatchNumber','ExpiryDate','CalculationMismatch','NeedsReview'
    ],
    'DOC_CAPTURE_LINKS': [
      'LinkID','CaptureID','LinkType','TargetID','CreatedAt','CreatedBy','Note'
    ]
  };
  Object.keys(specs).forEach(function(name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) sh.appendRow(specs[name]);
  });
  return {ok:true, sheets:Object.keys(specs)};
}

/**
 * Document profiles are deliberately separate from business postings.
 * Example: a payment order confirms payment but must not create a stock batch.
 */
function mcV9DocumentProfile(type) {
  var p = {
    RETAIL_RECEIPT: {
      label:'Кассовый чек магазина',
      createsStock:false,
      needsHumanReview:true,
      links:['SUPPLIER','RAW_BATCH','RECEIVING','J03','FACT','TRACE'],
      qrUseful:true,
      handwrittenRisk:false
    },
    PRODUCT_RECEIPT: {
      label:'Товарный чек',
      createsStock:false,
      needsHumanReview:true,
      links:['SUPPLIER','RAW_BATCH','RECEIVING','J03','FACT','TRACE'],
      qrUseful:false,
      handwrittenRisk:true
    },
    INVOICE: {
      label:'Счёт на оплату',
      createsStock:false,
      needsHumanReview:true,
      links:['SUPPLIER','PURCHASE_ORDER','PAYMENT_ORDER'],
      qrUseful:false,
      handwrittenRisk:false
    },
    UPD: {
      label:'УПД',
      createsStock:false,
      needsHumanReview:true,
      links:['SUPPLIER','RAW_BATCH','RECEIVING','J03','FACT','TRACE','INVOICE'],
      qrUseful:false,
      handwrittenRisk:false
    },
    PAYMENT_ORDER: {
      label:'Платёжный документ',
      createsStock:false,
      needsHumanReview:false,
      links:['INVOICE','SUPPLIER','PAYMENT'],
      qrUseful:false,
      handwrittenRisk:false
    },
    BANQUET_ORDER: {
      label:'Бланк заказа банкета',
      createsStock:false,
      needsHumanReview:true,
      links:['BANQUET','TTK','PRODUCTION_PLAN','RESERVATION','FACT'],
      qrUseful:false,
      handwrittenRisk:true
    },
    UNKNOWN: {
      label:'Неизвестный документ',
      createsStock:false,
      needsHumanReview:true,
      links:[],
      qrUseful:false,
      handwrittenRisk:true
    }
  };
  return p[type] || p.UNKNOWN;
}

/** Deterministic classification from extracted OCR text. */
function mcV9ClassifyDocumentType(text) {
  var s = String(text || '').toLowerCase().replace(/ё/g,'е');
  if (/универсальн.{0,20}передаточн|упд/.test(s)) return MC_V9_DOC_TYPES.UPD;
  if (/счет\s+на\s+оплату|счет на оплату/.test(s)) return MC_V9_DOC_TYPES.INVOICE;
  if (/платежн.{0,20}поручен|платежное поручение/.test(s)) return MC_V9_DOC_TYPES.PAYMENT_ORDER;
  if (/формат мероприятия|место проведения|количество персон|пожелания|выездное обслуживание/.test(s)) return MC_V9_DOC_TYPES.BANQUET_ORDER;
  if (/кассовый чек|приход|ккт|фн\s*:|фд\s*:|qr/.test(s)) return MC_V9_DOC_TYPES.RETAIL_RECEIPT;
  if (/товарный чек|наименование товара|подпись продавца/.test(s)) return MC_V9_DOC_TYPES.PRODUCT_RECEIPT;
  return MC_V9_DOC_TYPES.UNKNOWN;
}

/**
 * Rules specific to the real samples. Returns warnings; it never silently
 * converts an uncertain document into a stock operation.
 */
function mcV9ValidateDocumentCapture(doc) {
  doc = doc || {};
  var warnings = [];
  var type = doc.documentType || MC_V9_DOC_TYPES.UNKNOWN;
  var profile = mcV9DocumentProfile(type);
  var confidence = Number(doc.recognitionConfidence);

  if (!doc.sourceFileId) warnings.push('Нет ссылки на оригинал документа.');
  if (!isFinite(confidence) || confidence < 0.80) warnings.push('OCR ниже порога 0.80 — требуется проверка человеком.');
  if (profile.handwrittenRisk && !doc.humanVerified) warnings.push('Документ содержит/может содержать рукописные данные — обязательна проверка.');
  if (type === MC_V9_DOC_TYPES.PAYMENT_ORDER && doc.createsStock) warnings.push('Платёжный документ не должен создавать приход на склад.');
  if (type === MC_V9_DOC_TYPES.INVOICE && doc.createsStock) warnings.push('Счёт на оплату не является подтверждением фактического поступления товара.');
  if (type === MC_V9_DOC_TYPES.BANQUET_ORDER && doc.createsStock) warnings.push('Бланк банкета не должен напрямую списывать склад.');

  var lines = Array.isArray(doc.items) ? doc.items : [];
  lines.forEach(function(it, idx) {
    var q = Number(it.quantity), price = Number(it.price), sum = Number(it.sum);
    if (!it.rawName) warnings.push('Строка '+(idx+1)+': нет исходного названия.');
    if (!isFinite(q) || q <= 0) warnings.push('Строка '+(idx+1)+': не распознано количество.');
    if (isFinite(q) && isFinite(price) && isFinite(sum) && Math.abs(q*price-sum) > Math.max(1, Math.abs(sum)*0.02)) {
      warnings.push('Строка '+(idx+1)+': не сходится количество × цена = сумма.');
    }
    if (it.requiresManualReview || it.needsReview) warnings.push('Строка '+(idx+1)+': требуется сопоставление с номенклатурой.');
  });

  return {ok:warnings.length===0, warnings:warnings, profile:profile};
}

/** Human-readable workflow used by UI and future OCR adapters. */
function mcV9DocumentWorkflow(type) {
  var p = mcV9DocumentProfile(type);
  if (type === MC_V9_DOC_TYPES.RETAIL_RECEIPT || type === MC_V9_DOC_TYPES.PRODUCT_RECEIPT) {
    return ['Фото','OCR','QR/фискальные реквизиты (если есть)','Распознавание строк','Сопоставление номенклатуры','Проверка','Приход','Партии','J03','FACT','TRACE'];
  }
  if (type === MC_V9_DOC_TYPES.INVOICE) {
    return ['Фото/PDF','OCR','Счёт','Сопоставление поставщика и номенклатуры','Связать с оплатой','Ожидание фактического прихода'];
  }
  if (type === MC_V9_DOC_TYPES.UPD) {
    return ['Фото/PDF','OCR','Проверка продавца/покупателя','Строки','Проверка количества/сумм','Фактический приход','Партии','J03','FACT','TRACE'];
  }
  if (type === MC_V9_DOC_TYPES.PAYMENT_ORDER) {
    return ['Фото/PDF','OCR','Проверка реквизитов','Связать со счётом/УПД','Подтверждение оплаты'];
  }
  if (type === MC_V9_DOC_TYPES.BANQUET_ORDER) {
    return ['Фото','OCR','Распознавание шапки','Распознавание позиций','Проверка рукописных пометок','Сопоставление блюд с ТТК','План производства','Резерв','FACT'];
  }
  return ['Фото/PDF','OCR','Классификация','Ручная проверка'];
}
