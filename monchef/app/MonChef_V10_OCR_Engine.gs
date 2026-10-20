/* ============================================================================
 * MON CHEF V10 — ADAPTIVE OCR ENGINE
 *
 * Улучшения над V9:
 * 1. Использует актуальные возможности Yandex Vision OCR: page + handwritten.
 * 2. Сохраняет сразу три представления OCR: fullText, координатную раскладку,
 *    Markdown/таблицы Vision.
 * 3. Для рукописных/слабых документов автоматически делает второй проход
 *    моделью handwritten и выбирает лучший результат по качеству.
 * 4. Для таблиц передаёт LLM одновременно геометрию строк и Markdown Vision,
 *    чтобы цена/количество/сумма не перепутывались.
 * 5. Вводит детерминированную проверку арифметики и аномалий OCR.
 *
 * Модуль не проводит склад автоматически. Он только улучшает распознавание.
 * ========================================================================== */

var MC_V10_OCR = {
  PAGE: 'page',
  HANDWRITTEN: 'handwritten',
  MAX_TEXT_FOR_MODEL: 18000
};

function _mcV10Vision_(dataUrl, model) {
  var props = PropertiesService.getScriptProperties();
  var key = _clean1_(props.getProperty('YANDEX_API_KEY'));
  var folder = _clean1_(props.getProperty('YANDEX_FOLDER_ID'));
  if (!key || !folder) return { error: 'no-key' };
  var m = String(dataUrl || '').match(/^data:([^;]+);base64,(.*)$/);
  if (!m) return { error: 'format' };
  // фото и PDF (в т.ч. многостраничный) — общий вызов MonChef_PdfOcr.gs
  var rr = _mcOcrAnn_(key, folder, m[1], m[2], model || MC_V10_OCR.PAGE);
  if (rr.error) { rr.model = model; return rr; }
  try {
    var ann = rr.ann || {};
    var fullText = String(ann.fullText || '').trim();
    var markdown = String(ann.markdown || '').trim();
    if (!fullText && !markdown) return { error: 'empty', model: model };
    var layout = _rebuildTableText_(ann) || fullText;
    return {
      key: key,
      folder: folder,
      ann: ann,
      fullText: fullText,
      markdown: markdown,
      layoutText: layout,
      model: model,
      quality: _mcV10OcrQuality_(ann, fullText, markdown, layout)
    };
  } catch (e) {
    return { error: 'ocr-json', body: String(e), model: model };
  }
}

function _mcV10OcrQuality_(ann, fullText, markdown, layout) {
  var text = String(fullText || '');
  var nonSpace = text.replace(/\s/g, '');
  var digits = (text.match(/[0-9]/g) || []).length;
  var cyr = (text.match(/[А-Яа-яЁё]/g) || []).length;
  var lines = text.split(/\n+/).filter(function (x) { return String(x).trim(); }).length;
  var blocks = ((ann && ann.blocks) || []).length;
  var tables = ((ann && ann.tables) || []).length;
  var score = 0.15;
  if (nonSpace.length >= 40) score += 0.18;
  if (nonSpace.length >= 120) score += 0.15;
  if (lines >= 4) score += 0.10;
  if (lines >= 10) score += 0.10;
  if (cyr >= 15) score += 0.10;
  if (digits >= 3) score += 0.06;
  if (blocks >= 2) score += 0.06;
  if (tables > 0) score += 0.10;
  if (String(markdown || '').length > 80) score += 0.08;
  if (/[�]{2,}/.test(text)) score -= 0.15;
  if (/([A-Za-zА-Яа-яЁё])\1\1\1/.test(text)) score -= 0.05;
  return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
}

function _mcV10NeedHandwritten_(page, typeHint) {
  if (!page || page.error) return true;
  var t = String((page.fullText || '') + '\n' + (page.markdown || '')).toLowerCase().replace(/ё/g, 'е');
  if (typeHint === 'PRODUCT_RECEIPT' || typeHint === 'HANDWRITTEN') return true;
  if (page.quality < 0.68) return true;
  if (t.length < 60) return true;
  if (/товарный чек|подпись продавца/.test(t) && page.quality < 0.82) return true;
  return false;
}

function _mcV10BestVision_(dataUrl, typeHint) {
  var page = _mcV10Vision_(dataUrl, MC_V10_OCR.PAGE);
  if (page.error) return page;
  if (!_mcV10NeedHandwritten_(page, typeHint)) return page;
  var hand = _mcV10Vision_(dataUrl, MC_V10_OCR.HANDWRITTEN);
  if (hand.error) return page;
  // Для рукописного чека важнее наличие осмысленного текста и цифр; для печатной
  // накладной page обычно лучше. Не выбираем handwritten только из-за более длинного текста.
  var handScore = hand.quality;
  var pageScore = page.quality;
  if (typeHint === 'PRODUCT_RECEIPT' || typeHint === 'HANDWRITTEN') {
    return handScore >= pageScore * 0.92 ? hand : page;
  }
  return handScore > pageScore + 0.08 ? hand : page;
}

function _mcV10PackOcrText_(vis) {
  var layout = String(vis.layoutText || vis.fullText || '').trim();
  var full = String(vis.fullText || '').trim();
  var md = String(vis.markdown || '').trim();
  var parts = [];
  parts.push('=== КООРДИНАТНЫЕ СТРОКИ ===\n' + layout);
  if (md) parts.push('=== MARKDOWN / ТАБЛИЦЫ VISION ===\n' + md);
  if (full && full !== layout) parts.push('=== ПОЛНЫЙ ТЕКСТ ===\n' + full);
  var out = parts.join('\n\n');
  return out.length > MC_V10_OCR.MAX_TEXT_FOR_MODEL ? out.slice(0, MC_V10_OCR.MAX_TEXT_FOR_MODEL) : out;
}

function _mcV10InvoicePrompt_() {
  return 'Ты — модуль извлечения данных из реальных документов кухни/ресторана. ' +
    'Тебе переданы результаты OCR одного изображения. Есть координатные строки, полный текст и иногда Markdown-таблица. ' +
    'Сначала определи тип: retail_receipt, product_receipt, invoice, upd, payment_order или unknown. ' +
    'Никогда не смешивай числа из разных физических строк. Для широкой таблицы используй координаты X/Y и Markdown как взаимную проверку. ' +
    'Для узкого кассового чека учитывай конструкции вида "цена x количество = сумма", а также строки скидок. ' +
    'Для рукописного товарного чека сохраняй текст максимально близко к оригиналу и снижай confidence, если не уверен. ' +
    'Верни ТОЛЬКО JSON: ' +
    '{"document_type":"...","document_number":null,"document_date":null,"supplier":null,"buyer":null,' +
    '"total":null,"recognition_confidence":0.0,"warnings":[],"items":[' +
    '{"line_number":1,"raw_name":"","normalized_name":"","quantity":null,"unit":null,' +
    '"price":null,"sum":null,"vat":null,"batch_number":null,"expiry_date":null,"confidence":0.0}]} . ' +
    'Правила: ' +
    '1) raw_name — что реально видно; не додумывай. ' +
    '2) quantity, price и sum должны соответствовать одной позиции. ' +
    '3) Если в документе цена за кг/шт и количество даны отдельно — вычисляй отсутствующее только арифметически. ' +
    '4) Не превращай скидку, НДС, итоги, ИНН, ФН, ФД, ККТ, QR, адрес и телефоны в товар. ' +
    '5) Для розничного чека магазин — supplier. ' +
    '6) Единицу измерения не придумывай: если явно нет единицы, null; затем сервер может предложить нормализацию. ' +
    '7) Дату всегда ISO YYYY-MM-DD, если уверенно прочитана. ' +
    '8) Если строка сомнительная — confidence < 0.75 и добавь предупреждение. ' +
    '9) Для УПД/счёта различай цену без НДС, ставку НДС и итоговую стоимость. ' +
    '10) Если документ имеет рукописные изменения, отдельно укажи это в warnings.';
}

function _mcV10CallGpt_(text, key, folder) {
  try {
    var body = {
      modelUri: 'gpt://' + folder + '/yandexgpt/latest',
      completionOptions: { stream: false, temperature: 0, maxTokens: 4000 },
      messages: [{ role: 'system', text: _mcV10InvoicePrompt_() }, { role: 'user', text: text }]
    };
    var r = UrlFetchApp.fetch('https://llm.api.cloud.yandex.net/foundationModels/v1/completion', {
      method: 'post', contentType: 'application/json',
      headers: { 'Authorization': 'Api-Key ' + key, 'x-folder-id': folder },
      payload: JSON.stringify(body), muteHttpExceptions: true
    });
    if (r.getResponseCode() !== 200) return { error: 'llm', code: r.getResponseCode() };
    var j = JSON.parse(r.getContentText());
    var raw = String(j.result.alternatives[0].message.text || '').replace(/```json|```/g, '').trim();
    var obj = JSON.parse(raw);
    obj._modelRaw = raw;
    return obj;
  } catch (e) { return { error: 'llm-parse', body: String(e) }; }
}

function _mcV10NormalizeNumber_(v) {
  if (v === null || v === undefined || v === '') return null;
  var s = String(v).replace(/\s/g, '').replace(',', '.').replace(/[^0-9.\-]/g, '');
  var n = parseFloat(s);
  return isFinite(n) ? n : null;
}

function _mcV10NormalizeDate_(v) {
  if (!v) return null;
  var s = String(v).trim().replace(/\./g, '-').replace(/\//g, '-');
  var m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (m) {
    var y = Number(m[3]); if (y < 100) y += 2000;
    return y + '-' + ('0' + Number(m[2])).slice(-2) + '-' + ('0' + Number(m[1])).slice(-2);
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function _mcV10FinalizeInvoice_(obj, vis) {
  obj = obj || {};
  var items = Array.isArray(obj.items) ? obj.items : [];
  var warnings = Array.isArray(obj.warnings) ? obj.warnings.slice() : [];
  var calcTotal = 0;
  var clean = items.map(function (it, idx) {
    var q = _mcV10NormalizeNumber_(it.quantity);
    var p = _mcV10NormalizeNumber_(it.price);
    var sum = _mcV10NormalizeNumber_(it.sum);
    var mismatch = false;
    if (q !== null && p !== null && sum !== null) {
      mismatch = Math.abs(q * p - sum) > Math.max(1, Math.abs(sum) * 0.02);
    }
    if (sum === null && q !== null && p !== null) sum = Math.round(q * p * 100) / 100;
    if (p === null && q !== null && sum !== null && q > 0) p = Math.round(sum / q * 100) / 100;
    if (sum !== null) calcTotal += sum;
    var conf = _mcV10NormalizeNumber_(it.confidence);
    if (conf === null) conf = mismatch ? 0.55 : 0.80;
    if (!it.raw_name) warnings.push('Строка ' + (idx + 1) + ': нет названия.');
    if (q === null || q <= 0) warnings.push('Строка ' + (idx + 1) + ': количество не распознано.');
    if (mismatch) warnings.push('Строка ' + (idx + 1) + ': количество × цена не совпадает с суммой.');
    if (conf < 0.75) warnings.push('Строка ' + (idx + 1) + ': низкая уверенность OCR.');
    return {
      line_number: it.line_number || idx + 1,
      raw_name: String(it.raw_name || it.name || '').trim(),
      normalized_name: String(it.normalized_name || it.raw_name || it.name || '').trim(),
      quantity: q,
      unit: it.unit ? String(it.unit).trim() : null,
      price: p,
      sum: sum,
      vat: _mcV10NormalizeNumber_(it.vat),
      batch_number: it.batch_number || null,
      expiry_date: _mcV10NormalizeDate_(it.expiry_date),
      confidence: Math.max(0, Math.min(1, conf)),
      calculation_mismatch: mismatch,
      requires_manual_review: mismatch || conf < 0.75 || !it.raw_name || q === null
    };
  });
  var docConf = _mcV10NormalizeNumber_(obj.recognition_confidence);
  if (docConf === null) docConf = vis.quality;
  if (vis.model === MC_V10_OCR.HANDWRITTEN) warnings.push('Использован дополнительный проход OCR для рукописного текста.');
  if (vis.quality < 0.68) warnings.push('Качество исходного распознавания низкое — проверьте оригинал фото.');
  return {
    document_type: obj.document_type || 'unknown',
    document_number: obj.document_number || null,
    document_date: _mcV10NormalizeDate_(obj.document_date),
    supplier: obj.supplier || null,
    buyer: obj.buyer || null,
    total: obj.total !== null && obj.total !== undefined ? _mcV10NormalizeNumber_(obj.total) : (calcTotal || null),
    recognition_confidence: Math.max(0, Math.min(1, docConf)),
    items: clean,
    warnings: warnings,
    requires_manual_review: warnings.length > 0 || clean.some(function (x) { return x.requires_manual_review; }),
    _debug: {
      model: vis.model,
      ocrQuality: vis.quality,
      ocrText: vis.layoutText || vis.fullText || '',
      ocrMarkdown: vis.markdown || '',
      ocrTextOriginal: vis.fullText || '',
      modelRaw: obj._modelRaw || ''
    }
  };
}

/** Main V10 entry point for stock documents. */
function scanInvoiceV10(dataUrl, typeHint) {
  try {
    var vis = _mcV10BestVision_(dataUrl, typeHint || '');
    if (vis.error) return JSON.stringify(vis);
    var extracted = _mcV10CallGpt_(_mcV10PackOcrText_(vis), vis.key, vis.folder);
    if (extracted.error) return JSON.stringify(extracted);
    return JSON.stringify(_mcV10FinalizeInvoice_(extracted, vis));
  } catch (e) { return JSON.stringify({ error: 'exception', body: String(e) }); }
}

function scanProductReceiptV10(dataUrl) {
  return scanInvoiceV10(dataUrl, 'PRODUCT_RECEIPT');
}
