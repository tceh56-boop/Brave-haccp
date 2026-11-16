// ЦЕХ — InvoiceRecognitionCore.gs
// Распознавание документов приёмки (накладная, УПД, счёт, кассовый/товарный чек) и
// сопоставление строк с номенклатурой. Перенесено из MonChef (V10 адаптивный OCR, V11
// номенклатура/алиасы, V12 автопилот, PdfOcr) и адаптировано к модели данных ЦЕХ:
// данные организации изолированы, проводка по-прежнему только через черновик и явное
// подтверждение (createInvoiceIntakeDraft_ → CONFIRM_INVOICE_RECEIPT).
//
// Что делает:
//  1) Yandex Vision: фото и PDF (многостраничный — асинхронно, страницы склеиваются);
//     модель page, при слабом/рукописном тексте — второй проход handwritten, выбирается лучший.
//  2) Строки таблицы собираются по координатам слов с поправкой на наклон фото.
//  3) YandexGPT извлекает реквизиты и строки (JSON); арифметика «кол-во × цена = сумма»
//     проверяется детерминированно; сомнительный документ проходит вторую проверку моделью.
//  4) Без модели (не настроена/ошибка) — разбор регулярными выражениями по строкам таблицы.
//  5) Сопоставление: штрихкод → артикул → подтверждённый алиас (с учётом поставщика) →
//     точное название → нечёткий поиск (Левенштейн по словам). Нечёткое совпадение
//     подставляется само только при явном отрыве от второго кандидата.
//  6) Алиасы запоминаются ТОЛЬКО после решения человека (правка строки или проводка
//     документа) — распознавание само себя не «обучает».
// Ничего не придумывается: что не прочитано — пусто, строка помечается для проверки.

var IR_OCR_URL = 'https://ocr.api.cloud.yandex.net/ocr/v1/';
var IR_LLM_URL = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';
var IR_ASYNC_WAIT_MS = 60000;
var IR_MAX_TEXT_FOR_MODEL = 18000;
var IR_REVIEW_THRESHOLD = 0.78;
var IR_FUZZY_MIN = 0.70;

function _irCreds_() {
  var p = PropertiesService.getScriptProperties();
  return {
    apiKey: p.getProperty('YANDEX_OCR_API_KEY') || p.getProperty('YANDEX_API_KEY') || '',
    iamToken: p.getProperty('YANDEX_OCR_IAM_TOKEN') || '',
    folderId: p.getProperty('YANDEX_FOLDER_ID') || '',
    llmModel: p.getProperty('INVOICE_LLM_MODEL') || 'yandexgpt/latest',
    llmDisabled: String(p.getProperty('INVOICE_LLM_DISABLED') || '').toLowerCase() === 'true'
  };
}
function _irHeaders_(c) { var h = { 'x-folder-id': c.folderId }; h.Authorization = c.apiKey ? 'Api-Key ' + c.apiKey : 'Bearer ' + c.iamToken; return h; }

// ---------- OCR: фото и PDF ----------

function _irMime_(mime) { var m = String(mime || '').toLowerCase(); return m.indexOf('pdf') >= 0 ? 'PDF' : (m.indexOf('png') >= 0 ? 'PNG' : 'JPEG'); }

/** Число страниц PDF по /Type /Page (0 — не определить: сжатые объекты). */
function _irPdfPages_(b64) {
  try {
    var bytes = Utilities.base64Decode(b64), s = '';
    for (var i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.slice(i, i + 8192).map(function (b) { return b & 255; }));
    var m = s.match(/\/Type\s*\/Page(?!s)/g);
    return m ? m.length : 0;
  } catch (e) { return 0; }
}

/** Склейка страниц: координаты следующей страницы сдвигаются вниз на высоту предыдущих. */
function _irMergePages_(pages) {
  if (pages.length === 1) return pages[0];
  var out = { width: 0, height: 0, blocks: [], fullText: '' }, off = 0, texts = [];
  pages.forEach(function (a) {
    var h = Number(a.height) || 0, maxY = 0;
    var shift = function (bb) { ((bb && bb.vertices) || []).forEach(function (v) { var y = Number(v.y) || 0; if (y > maxY) maxY = y; v.y = String(y + off); }); };
    (a.blocks || []).forEach(function (b) {
      shift(b.boundingBox);
      (b.lines || []).forEach(function (l) { shift(l.boundingBox); (l.words || []).forEach(function (w) { shift(w.boundingBox); }); });
      out.blocks.push(b);
    });
    off += (h || maxY) + 40;
    out.width = Math.max(out.width, Number(a.width) || 0);
    if (a.fullText) texts.push(a.fullText);
  });
  out.height = off; out.fullText = texts.join('\n');
  return out;
}

function _irOcrAsync_(c, mime, b64, model) {
  var r = UrlFetchApp.fetch(IR_OCR_URL + 'recognizeTextAsync', { method: 'post', contentType: 'application/json', headers: _irHeaders_(c),
    payload: JSON.stringify({ mimeType: mime, languageCodes: ['ru', 'en'], model: model || 'page', content: b64 }), muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) return { error: 'Ошибка OCR (код ' + r.getResponseCode() + '): ' + r.getContentText().slice(0, 300) };
  var op = JSON.parse(r.getContentText()), id = op.id, t0 = Date.now(), done = !!op.done;
  while (!done && Date.now() - t0 < IR_ASYNC_WAIT_MS) {
    Utilities.sleep(2000);
    var st = UrlFetchApp.fetch('https://operation.api.cloud.yandex.net/operations/' + encodeURIComponent(id), { headers: _irHeaders_(c), muteHttpExceptions: true });
    if (st.getResponseCode() !== 200) return { error: 'Ошибка OCR (код ' + st.getResponseCode() + ')' };
    var sj = JSON.parse(st.getContentText()); done = !!sj.done;
    if (sj.error) return { error: 'Ошибка OCR: ' + JSON.stringify(sj.error).slice(0, 300) };
  }
  if (!done) return { error: 'Распознавание PDF не закончилось за ' + Math.round(IR_ASYNC_WAIT_MS / 1000) + ' с — повторите позже.' };
  var g = UrlFetchApp.fetch(IR_OCR_URL + 'getRecognition?operationId=' + encodeURIComponent(id), { headers: _irHeaders_(c), muteHttpExceptions: true });
  if (g.getResponseCode() !== 200) return { error: 'Ошибка OCR (код ' + g.getResponseCode() + ')' };
  // Ответ — объекты JSON страниц подряд.
  var txt = g.getContentText(), pages = [], depth = 0, start = -1, inStr = false, esc = false;
  for (var i = 0; i < txt.length; i++) {
    var ch = txt.charAt(i);
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') { depth--; if (depth === 0 && start >= 0) { try { pages.push(JSON.parse(txt.slice(start, i + 1))); } catch (e) {} start = -1; } }
  }
  pages.sort(function (a, b) { return (Number(a.result && a.result.page) || 0) - (Number(b.result && b.result.page) || 0); });
  var anns = pages.map(function (p) { return (p.result && p.result.textAnnotation) || null; }).filter(Boolean);
  if (!anns.length) return { error: 'Документ не распознан: пустой результат OCR.' };
  return { ann: _irMergePages_(anns), pages: anns.length };
}

function _irOcrAnn_(c, mimeType, b64, model) {
  var mime = _irMime_(mimeType);
  if (mime === 'PDF' && _irPdfPages_(b64) > 1) return _irOcrAsync_(c, mime, b64, model);
  var r = UrlFetchApp.fetch(IR_OCR_URL + 'recognizeText', { method: 'post', contentType: 'application/json', headers: _irHeaders_(c),
    payload: JSON.stringify({ mimeType: mime, languageCodes: ['ru', 'en'], model: model || 'page', content: b64 }), muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) {
    if (mime === 'PDF') return _irOcrAsync_(c, mime, b64, model); // синхронный вызов не принял PDF
    return { error: 'Ошибка OCR (код ' + r.getResponseCode() + '): ' + r.getContentText().slice(0, 300) };
  }
  var oj = JSON.parse(r.getContentText());
  return { ann: (oj.result && oj.result.textAnnotation) || {}, pages: 1 };
}

// ---------- Таблица по координатам ----------

function _irMedian_(a) { if (!a.length) return 0; var s = a.slice().sort(function (x, y) { return x - y; }); return s[Math.floor(s.length / 2)]; }

/** Наклон строк: перебор углов, максимум «резкости» гистограммы по выпрямленной высоте. */
function _irSkew_(ws) {
  if (ws.length < 12) return 0;
  var h = _irMedian_(ws.map(function (w) { return w.h; })) || 10, bin = Math.max(2, h * 0.35), best = 0, bestS = -1;
  for (var s = -0.12; s <= 0.12 + 1e-4; s += 0.002) {
    var hist = {}, sc = 0;
    ws.forEach(function (w) { var k = Math.round((w.y - s * w.x) / bin); hist[k] = (hist[k] || 0) + 1; });
    Object.keys(hist).forEach(function (k) { sc += hist[k] * hist[k]; });
    if (sc > bestS || (sc === bestS && Math.abs(s) < Math.abs(best))) { bestS = sc; best = s; }
  }
  return best;
}

/** Строки таблицы из слов OCR: группировка по выпрямленному Y, сортировка по X. */
function _irRebuildTableText_(ann) {
  try {
    var words = [];
    (ann.blocks || []).forEach(function (b) { (b.lines || []).forEach(function (ln) { (ln.words || []).forEach(function (w) {
      var v = w.boundingBox && w.boundingBox.vertices; if (!v || v.length < 4 || !w.text) return;
      var ys = v.map(function (p) { return parseFloat(p.y); }), xs = v.map(function (p) { return parseFloat(p.x); });
      words.push({ text: w.text, x: Math.min.apply(null, xs), y: (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2, h: (Math.max.apply(null, ys) - Math.min.apply(null, ys)) || 20 });
    }); }); });
    if (!words.length) return null;
    var sk = _irSkew_(words);
    if (sk) words.forEach(function (w) { w.y = w.y - sk * w.x; });
    var avgH = words.reduce(function (s, w) { return s + w.h; }, 0) / words.length, thr = Math.max(10, avgH * 0.6);
    words.sort(function (a, b) { return a.y - b.y; });
    var rows = [], cur = [words[0]], rowY = words[0].y;
    for (var i = 1; i < words.length; i++) {
      var w = words[i];
      if (Math.abs(w.y - rowY) <= thr) { cur.push(w); rowY = cur.reduce(function (s, x) { return s + x.y; }, 0) / cur.length; }
      else { rows.push(cur); cur = [w]; rowY = w.y; }
    }
    rows.push(cur);
    return rows.map(function (r) { r.sort(function (a, b) { return a.x - b.x; }); return r.map(function (w) { return w.text; }).join(' '); }).join('\n');
  } catch (e) { return null; }
}

// ---------- Качество и выбор прохода ----------

function _irQuality_(ann, fullText, markdown) {
  var text = String(fullText || ''), nonSpace = text.replace(/\s/g, '');
  var digits = (text.match(/[0-9]/g) || []).length, cyr = (text.match(/[А-Яа-яЁё]/g) || []).length;
  var lines = text.split(/\n+/).filter(function (x) { return String(x).trim(); }).length;
  var score = 0.15;
  if (nonSpace.length >= 40) score += 0.18;
  if (nonSpace.length >= 120) score += 0.15;
  if (lines >= 4) score += 0.10;
  if (lines >= 10) score += 0.10;
  if (cyr >= 15) score += 0.10;
  if (digits >= 3) score += 0.06;
  if (((ann && ann.blocks) || []).length >= 2) score += 0.06;
  if (((ann && ann.tables) || []).length > 0) score += 0.10;
  if (String(markdown || '').length > 80) score += 0.08;
  if (/[�]{2,}/.test(text)) score -= 0.15;
  if (/([A-Za-zА-Яа-яЁё])\1\1\1/.test(text)) score -= 0.05;
  return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
}

function _irVision_(c, mimeType, b64, model) {
  var rr = _irOcrAnn_(c, mimeType, b64, model);
  if (rr.error) return rr;
  var ann = rr.ann || {}, fullText = String(ann.fullText || '').trim(), markdown = String(ann.markdown || '').trim();
  if (!fullText && !markdown) return { error: 'Документ не распознан: текст не найден.' };
  return { ann: ann, fullText: fullText, markdown: markdown, layoutText: _irRebuildTableText_(ann) || fullText, model: model, pages: rr.pages || 1, quality: _irQuality_(ann, fullText, markdown) };
}

function _irBestVision_(c, mimeType, b64, typeHint) {
  var page = _irVision_(c, mimeType, b64, 'page');
  if (page.error) return page;
  var t = (page.fullText + '\n' + page.markdown).toLowerCase().replace(/ё/g, 'е');
  var need = typeHint === 'PRODUCT_RECEIPT' || page.quality < 0.68 || t.length < 60 || (/товарный чек|подпись продавца/.test(t) && page.quality < 0.82);
  if (!need) return page;
  var hand = _irVision_(c, mimeType, b64, 'handwritten');
  if (hand.error) return page;
  if (typeHint === 'PRODUCT_RECEIPT') return hand.quality >= page.quality * 0.92 ? hand : page;
  return hand.quality > page.quality + 0.08 ? hand : page;
}

function _irPackText_(vis) {
  var parts = ['=== КООРДИНАТНЫЕ СТРОКИ ===\n' + String(vis.layoutText || vis.fullText || '').trim()];
  if (vis.markdown) parts.push('=== MARKDOWN / ТАБЛИЦЫ VISION ===\n' + vis.markdown);
  if (vis.fullText && vis.fullText !== vis.layoutText) parts.push('=== ПОЛНЫЙ ТЕКСТ ===\n' + vis.fullText);
  var out = parts.join('\n\n');
  return out.length > IR_MAX_TEXT_FOR_MODEL ? out.slice(0, IR_MAX_TEXT_FOR_MODEL) : out;
}

// ---------- YandexGPT ----------

var IR_EXTRACT_PROMPT = 'Ты — модуль извлечения данных из документов приёмки кухни/ресторана. Тебе переданы результаты OCR одного документа: ' +
  'координатные строки, полный текст и иногда Markdown-таблица. Определи тип: retail_receipt, product_receipt, invoice, upd, payment_order или unknown. ' +
  'Никогда не смешивай числа из разных физических строк; для широкой таблицы сверяй координаты и Markdown. Для кассового чека учитывай «цена x количество = сумма» и скидки. ' +
  'Верни ТОЛЬКО JSON: {"document_type":"...","document_number":null,"document_date":null,"supplier":null,"supplier_inn":null,"buyer":null,"total":null,' +
  '"recognition_confidence":0.0,"warnings":[],"items":[{"line_number":1,"raw_name":"","quantity":null,"unit":null,"price":null,"sum":null,"vat":null,' +
  '"barcode":null,"article":null,"batch_number":null,"production_date":null,"expiry_date":null,"confidence":0.0}]}. Правила: ' +
  '1) raw_name — что реально видно, не додумывай. 2) quantity, price и sum — одной позиции. 3) Отсутствующее вычисляй только арифметически. ' +
  '4) Скидка, НДС, итоги, ИНН, ФН, ФД, ККТ, QR, адрес и телефон — не товар. 5) Для розничного чека магазин — supplier. ' +
  '6) Единицу не придумывай: нет явной — null. 7) Даты — ISO YYYY-MM-DD, только если уверенно прочитаны. ' +
  '8) Сомнительная строка — confidence < 0.75 и предупреждение. 9) Для УПД/счёта различай цену без НДС, ставку НДС и стоимость. ' +
  '10) Рукописные исправления укажи в warnings.';

var IR_AUDIT_PROMPT = 'Ты проверяешь результат распознавания документа кухни. Дан OCR-текст и JSON извлечения. Не переписывай документ целиком. Верни ТОЛЬКО JSON: ' +
  '{"ok":true,"document_number":null,"document_date":null,"supplier":null,"total":null,"line_corrections":[],"warnings":[]}. ' +
  'line_corrections — только подтверждаемые текстом исправления: [{"line_number":1,"raw_name":null,"quantity":null,"unit":null,"price":null,"sum":null}]. ' +
  'Ничего не угадывай; нет данных — null. Проверяй числа, номер, дату, поставщика и quantity*price≈sum.';

function _irLlm_(c, system, user, maxTokens) {
  if (c.llmDisabled) return { error: 'llm-disabled' };
  try {
    var body = { modelUri: 'gpt://' + c.folderId + '/' + c.llmModel, completionOptions: { stream: false, temperature: 0, maxTokens: maxTokens || 4000 }, messages: [{ role: 'system', text: system }, { role: 'user', text: user }] };
    var r = UrlFetchApp.fetch(IR_LLM_URL, { method: 'post', contentType: 'application/json', headers: _irHeaders_(c), payload: JSON.stringify(body), muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) return { error: 'llm', code: r.getResponseCode() };
    var j = JSON.parse(r.getContentText());
    var raw = String(j.result.alternatives[0].message.text || '').replace(/```json|```/g, '').trim();
    var obj = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    obj._raw = raw;
    return obj;
  } catch (e) { return { error: 'llm-parse', body: String(e) }; }
}

// ---------- Нормализация ----------

function _irNum_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  var n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.').replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : null;
}

function _irDate_(v) {
  if (!v) return '';
  var s = String(v).trim().replace(/\./g, '-').replace(/\//g, '-');
  var m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (m) { var y = Number(m[3]); if (y < 100) y += 2000; return y + '-' + ('0' + Number(m[2])).slice(-2) + '-' + ('0' + Number(m[1])).slice(-2); }
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function _irClassify_(text, llmType) {
  var s = String(text || '').toLowerCase().replace(/ё/g, 'е');
  if (/универсальн.{0,25}передаточн|\bупд\b/.test(s)) return 'UPD';
  if (/счет\s+на\s+оплату/.test(s)) return 'INVOICE';
  if (/товарн.{0,10}накладн|торг-12/.test(s)) return 'WAYBILL';
  if (/платежн.{0,25}поручен/.test(s)) return 'PAYMENT_ORDER';
  if (/кассовый чек|ккт|фн\s*[:№]|фд\s*[:№]/.test(s)) return 'RETAIL_RECEIPT';
  if (/товарный чек|подпись продавца/.test(s)) return 'PRODUCT_RECEIPT';
  return String(llmType || 'UNKNOWN').toUpperCase();
}

/** Нормализация для сравнения: латиница-двойники → кириллица, единицы, пунктуация (числа не трогаем). */
function _irNorm_(s) {
  var map = { a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', b: 'в', h: 'н' };
  var x = String(s || '').toLowerCase().replace(/ё/g, 'е').split('').map(function (ch) { return map[ch] || ch; }).join('');
  x = x.replace(/[«»"'`]/g, ' ').replace(/[.,;:()\[\]{}]/g, ' ')
    .replace(/(^|\s)(шт|штук)(?=\s|$)/g, ' шт ').replace(/(^|\s)(килограмм\S*|кг)(?=\s|$)/g, ' кг ')
    .replace(/(^|\s)(грамм\S*|гр)(?=\s|$)/g, ' г ').replace(/(^|\s)(литр\S*)(?=\s|$)/g, ' л ').replace(/(^|\s)(миллилитр\S*)(?=\s|$)/g, ' мл ');
  return x.replace(/\s+/g, ' ').trim();
}
function _irWords_(s) { return _irNorm_(s).split(' ').filter(function (w) { return w.length >= 2 && !/^\d+$/.test(w) && !/^(кг|г|л|мл|шт)$/.test(w); }); }
function _irEdit_(a, b) {
  if (a === b) return 0; if (!a.length) return b.length; if (!b.length) return a.length;
  var prev = [], cur = []; for (var j = 0; j <= b.length; j++) prev[j] = j;
  for (var i = 1; i <= a.length; i++) { cur[0] = i; for (var k = 1; k <= b.length; k++) cur[k] = Math.min(cur[k - 1] + 1, prev[k] + 1, prev[k - 1] + (a[i - 1] === b[k - 1] ? 0 : 1)); var t = prev; prev = cur; cur = t; }
  return prev[b.length];
}
function _irTokenSim_(a, b) {
  if (!a || !b) return 0; if (a === b) return 1;
  if ((a.length >= 5 && b.indexOf(a) === 0) || (b.length >= 5 && a.indexOf(b) === 0)) return 0.92;
  var max = Math.max(a.length, b.length); if (max < 4) return 0;
  return 1 - _irEdit_(a, b) / max;
}
/** Сходство названий 0..1: покрытие слов строки документа словами кандидата. */
function _irFuzzy_(query, candidate) {
  var q = _irWords_(query), c = _irWords_(candidate);
  if (!q.length || !c.length) return 0;
  var matched = 0, exactish = 0;
  q.forEach(function (w) {
    var best = 0; c.forEach(function (v) { best = Math.max(best, _irTokenSim_(w, v)); });
    if (best >= IR_FUZZY_MIN) matched += best;
    if (best >= 0.92) exactish++;
  });
  return Math.min(1, (matched / q.length) * 0.8 + (exactish / q.length) * 0.2);
}

// ---------- Сопоставление с номенклатурой ----------

function _irSupplierKey_(s) { return _irNorm_(s).replace(/\b(ооо|ип|зао|оао|пао|ао)\b/g, ' ').replace(/[^а-яa-z0-9]+/g, ' ').trim(); }

function _irAliases_(organizationId) {
  return findRows_('OCR_ALIASES', function (a) { return a.organization_id === organizationId && a.active !== false && a.active !== 'FALSE'; });
}

/**
 * Строка документа → продукт организации. Возвращает {product_id, product, source, score,
 * candidates:[{product_id, название, score, source}], auto}. auto=false — человек должен выбрать.
 */
function irMatchProduct_(line, session, supplierText) {
  var org = session.organization_id;
  var products = getProducts_(org);
  var byId = {}; products.forEach(function (p) { byId[p.product_id] = p; });
  var res = function (p, source, score, cands) { return { product_id: p ? p.product_id : '', product: p || null, source: source, score: score, candidates: cands || [], auto: !!p }; };
  if (line.barcode) { var pb = findProductByBarcode_(org, String(line.barcode)); if (pb) return res(pb, 'BARCODE', 1); }
  if (line.article) {
    var art = String(line.article).toLowerCase().trim();
    var pa = products.filter(function (p) { return String(p.артикул || '').toLowerCase().trim() === art; });
    if (pa.length === 1) return res(pa[0], 'ARTICLE', 1);
  }
  var name = line.raw_name || line.name || '', qn = _irNorm_(name), sup = _irSupplierKey_(supplierText);
  if (!qn) return res(null, 'NONE', 0);
  var aliases = _irAliases_(org).filter(function (a) { return byId[a.product_id]; });
  var alias = aliases.filter(function (a) { return a.raw_norm === qn && a.supplier_key === sup; })[0] || aliases.filter(function (a) { return a.raw_norm === qn && !a.supplier_key; })[0] || aliases.filter(function (a) { return a.raw_norm === qn; })[0];
  if (alias) return res(byId[alias.product_id], 'ALIAS', 1);
  var exact = products.filter(function (p) { return _irNorm_(p.название) === qn || (p.внутреннее_название && _irNorm_(p.внутреннее_название) === qn); });
  if (exact.length === 1) return res(exact[0], 'EXACT', 1);
  var scored = products.map(function (p) {
    var s = Math.max(_irFuzzy_(name, p.название), p.внутреннее_название ? _irFuzzy_(name, p.внутреннее_название) : 0);
    aliases.forEach(function (a) { if (a.product_id === p.product_id) s = Math.max(s, _irFuzzy_(name, a.raw_text) * 0.97); });
    return { product_id: p.product_id, название: p.название, единица: p.единица, score: Math.round(s * 100) / 100, source: 'FUZZY' };
  }).filter(function (x) { return x.score >= IR_FUZZY_MIN; }).sort(function (a, b) { return b.score - a.score; }).slice(0, 5);
  // Нечёткое совпадение подставляется само только с явным отрывом — иначе выбирает человек.
  if (scored.length && scored[0].score >= 0.92 && (scored.length === 1 || scored[0].score - scored[1].score >= 0.08)) {
    var top = byId[scored[0].product_id]; return res(top, 'FUZZY', scored[0].score, scored.slice(1));
  }
  return { product_id: '', product: null, source: scored.length ? 'CANDIDATES' : 'NONE', score: scored.length ? scored[0].score : 0, candidates: scored, auto: false };
}

/** Запомнить подтверждённое человеком соответствие «строка документа → продукт». */
function rememberInvoiceAlias_(session, rawName, productId, supplierText) {
  var qn = _irNorm_(rawName); if (!qn || !productId) return null;
  var sup = _irSupplierKey_(supplierText);
  var cur = findRows_('OCR_ALIASES', function (a) { return a.organization_id === session.organization_id && a.raw_norm === qn && a.supplier_key === sup; })[0];
  if (cur) {
    updateRow_('OCR_ALIASES', cur, { product_id: productId, hits: (Number(cur.hits) || 0) + 1, last_used_at: nowIso_(), active: true, created_by: cur.product_id === productId ? cur.created_by : session.user_id });
    return cur.alias_id;
  }
  var row = { alias_id: generateId_('OCR_ALIASES'), organization_id: session.organization_id, raw_norm: qn, raw_text: String(rawName).trim(), product_id: productId, supplier_key: sup, hits: 1, created_by: session.user_id, created_at: nowIso_(), last_used_at: nowIso_(), active: true };
  insertRow_('OCR_ALIASES', row);
  return row.alias_id;
}

function _irMatchSupplier_(organizationId, supplierText) {
  var k = _irSupplierKey_(supplierText); if (!k) return '';
  var s = (typeof getSuppliers_ === 'function' ? getSuppliers_(organizationId) : findRows_('SUPPLIERS', function (r) { return r.organization_id === organizationId; }))
    .filter(function (r) { var rk = _irSupplierKey_(r.название); return rk && (rk === k || (rk.length >= 5 && (k.indexOf(rk) !== -1 || rk.indexOf(k) !== -1))); });
  return s.length === 1 ? s[0].supplier_id : '';
}

// ---------- Разбор без модели ----------

function _irRegexParse_(vis) {
  var text = String(vis.layoutText || vis.fullText || '');
  var out = { document_type: 'unknown', items: [], warnings: ['Модель извлечения недоступна — строки разобраны по шаблону, проверьте каждую.'] };
  var inv = text.match(/(?:накладн(?:ая|ой)|УПД|счет[- ]?фактур[аы]|счёт[- ]?фактур[аы]|документ).{0,50}?(?:№|N)\s*([A-ZА-ЯЁ0-9\-\/]+)/i); if (inv) out.document_number = inv[1];
  var dt = text.match(/(?:от|дата)\s*(\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{2,4})/i); if (dt) out.document_date = dt[1];
  text.split(/\n/).forEach(function (s, i) {
    var m = s.match(/^\s*(?:\d+[.)]?\s+)?(.+?)\s+(\d+(?:[.,]\d+)?)\s*(кг|г|шт|л|уп|упак\.?)?\s+(\d+(?:[.,]\d+)?)(?:\s+(\d+(?:[.,]\d+)?))?\s*$/i);
    if (!m || /итого|всего|ндс|сумма/i.test(m[1])) return;
    var q = _irNum_(m[2]), p = _irNum_(m[4]), sum = _irNum_(m[5]);
    out.items.push({ line_number: out.items.length + 1, raw_name: m[1].trim(), quantity: q, unit: m[3] || null, price: p, sum: sum, confidence: 0.6 });
  });
  return out;
}

// ---------- Сборка результата ----------

function _irApplyAudit_(ext, audit) {
  if (!audit || audit.error) return ext;
  ['document_number', 'document_date', 'supplier'].forEach(function (k) { if (audit[k] && !ext[k]) ext[k] = audit[k]; });
  if (audit.total !== null && audit.total !== undefined && (ext.total === null || ext.total === undefined)) ext.total = audit.total;
  var items = Array.isArray(ext.items) ? ext.items : [];
  (Array.isArray(audit.line_corrections) ? audit.line_corrections : []).forEach(function (c) {
    var it = items[Number(c.line_number) - 1]; if (!it) return;
    ['raw_name', 'quantity', 'unit', 'price', 'sum'].forEach(function (k) { if (c[k] !== null && c[k] !== undefined && c[k] !== '') it[k] = c[k]; });
    it.confidence = Math.max(Number(it.confidence) || 0, 0.82); it._audited = true;
  });
  if (Array.isArray(audit.warnings)) ext.warnings = (ext.warnings || []).concat(audit.warnings.map(String));
  ext._audit = audit.ok !== false ? 'SECOND_PASS_OK' : 'SECOND_PASS_WARNINGS';
  return ext;
}

/** Калибровка уверенности: распознавание × сопоставление × арифметика × тип документа. */
function _irCalibrate_(raw, visQuality, matchScore, arithOk, docType) {
  var c = _irNum_(raw); if (c === null) c = Number(visQuality) || 0;
  c = Math.max(0, Math.min(1, c));
  if (matchScore !== null && matchScore !== undefined) c = c * 0.78 + Math.max(0, Math.min(1, Number(matchScore) || 0)) * 0.22;
  if (arithOk === false) c -= 0.14;
  if (docType === 'PRODUCT_RECEIPT') c -= 0.04;
  return Math.round(Math.max(0, Math.min(1, c)) * 100) / 100;
}

function _irFinalize_(ext, vis, session) {
  ext = ext || {};
  var rawText = String(vis.layoutText || vis.fullText || ''), type = _irClassify_(rawText, ext.document_type);
  var supplier = String(ext.supplier || '').trim(), warnings = Array.isArray(ext.warnings) ? ext.warnings.slice() : [];
  var total = 0, review = 0, allArith = true;
  var lines = (Array.isArray(ext.items) ? ext.items : []).map(function (it, idx) {
    var raw = String(it.raw_name || it.name || '').trim();
    var q = _irNum_(it.quantity), p = _irNum_(it.price), sum = _irNum_(it.sum), mismatch = false;
    if (q !== null && p !== null && sum !== null) mismatch = Math.abs(q * p - sum) > Math.max(1, Math.abs(sum) * 0.02);
    if (mismatch) allArith = false;
    if (sum === null && q !== null && p !== null) sum = Math.round(q * p * 100) / 100;
    if (p === null && q !== null && sum !== null && q > 0) p = Math.round(sum / q * 100) / 100;
    if (sum !== null) total += sum;
    var line = { line_no: idx + 1, name: raw, raw_name: raw, qty: q, unit: it.unit ? String(it.unit).trim() : '', price: p, sum: sum, vat: _irNum_(it.vat),
      barcode: it.barcode ? String(it.barcode).replace(/\D/g, '') : '', article: it.article ? String(it.article).trim() : '', batch_number: it.batch_number || '',
      productionDate: _irDate_(it.production_date), expiryDate: _irDate_(it.expiry_date), calculation_mismatch: mismatch, line_warnings: [] };
    var m = irMatchProduct_(line, session, supplier);
    line.match_hint = { product_id: m.product_id, source: m.source, score: m.score, candidates: m.candidates };
    line.confidence = _irCalibrate_(it.confidence, vis.quality, m.product_id ? m.score : null, !mismatch, type);
    if (!raw) line.line_warnings.push('нет названия');
    if (q === null || q <= 0) line.line_warnings.push('количество не прочитано');
    if (mismatch) line.line_warnings.push('количество × цена ≠ сумма');
    if (!m.product_id) line.line_warnings.push(m.candidates.length ? 'выберите продукт из похожих' : 'продукт не найден в номенклатуре');
    line.requires_manual_review = !raw || q === null || q <= 0 || mismatch || line.confidence < IR_REVIEW_THRESHOLD || !m.product_id || m.source === 'FUZZY';
    if (line.requires_manual_review) review++;
    return line;
  });
  var docConf = _irCalibrate_(ext.recognition_confidence, vis.quality, lines.length ? lines.reduce(function (s, x) { return s + x.confidence; }, 0) / lines.length : null, allArith, type);
  if (vis.model === 'handwritten') warnings.push('Использован проход распознавания рукописного текста.');
  if (vis.quality < 0.68) warnings.push('Низкое качество фото — при ошибках переснимите документ.');
  if (review) warnings.push('Требуют проверки строк: ' + review + '.');
  var docTotal = _irNum_(ext.total);
  if (docTotal !== null && total && Math.abs(docTotal - total) > Math.max(1, docTotal * 0.01)) warnings.push('Сумма строк (' + Math.round(total * 100) / 100 + ') не совпадает с итогом документа (' + docTotal + ').');
  return {
    document: { invoice_number: ext.document_number ? String(ext.document_number) : '', invoice_date: _irDate_(ext.document_date), supplier: supplier, supplier_inn: ext.supplier_inn || '',
      supplier_id: _irMatchSupplier_(session.organization_id, supplier), total: docTotal !== null ? docTotal : (total ? Math.round(total * 100) / 100 : null), document_type: type,
      recognition_confidence: docConf, warnings: warnings, requires_manual_review: review > 0 || warnings.length > 0, ocr_model: vis.model, ocr_quality: vis.quality, pages: vis.pages || 1,
      second_pass: ext._audit || '', raw_text: rawText.slice(0, 20000) },
    lines: lines
  };
}

/**
 * Распознать документ приёмки. Возвращает формат createInvoiceIntakeDraft_:
 * {document:{invoice_number, invoice_date, supplier, supplier_id, ...}, lines:[{line_no, name, qty, unit, price, ...}]}.
 */
function recognizeSupplierDocument_(base64Image, mimeType, session, typeHint) {
  var c = _irCreds_();
  if ((!c.apiKey && !c.iamToken) || !c.folderId) throw new Error('Распознавание документов не настроено: задайте YANDEX_OCR_API_KEY (или YANDEX_API_KEY) и YANDEX_FOLDER_ID.');
  var b64 = String(base64Image || '').replace(/^data:[^;]+;base64,/, '');
  if (!b64) throw new Error('Загрузите фото или PDF документа.');
  var vis = _irBestVision_(c, mimeType || 'image/jpeg', b64, typeHint || '');
  if (vis.error) throw new Error(vis.error);
  var ext = _irLlm_(c, IR_EXTRACT_PROMPT, _irPackText_(vis), 4000);
  if (ext.error || !Array.isArray(ext.items)) ext = _irRegexParse_(vis);
  else {
    var pre = _irFinalize_(JSON.parse(JSON.stringify(ext)), vis, session);
    // Вторая проверка моделью — только для сомнительных документов (время и лимит).
    if (pre.document.requires_manual_review || pre.document.recognition_confidence < 0.9) ext = _irApplyAudit_(ext, _irLlm_(c, IR_AUDIT_PROMPT, '=== OCR ===\n' + _irPackText_(vis) + '\n\n=== EXTRACTED JSON ===\n' + JSON.stringify(ext), 2500));
  }
  return _irFinalize_(ext, vis, session);
}

/**
 * Скан этикетки производителя для строки черновика: даты, штрихкод. Ничего не проводит —
 * возвращает найденные поля и предупреждение, если штрихкод этикетки не совпал с продуктом строки.
 */
function scanInvoiceLineLabel_(data, session) {
  var c = _irCreds_();
  if ((!c.apiKey && !c.iamToken) || !c.folderId) throw new Error('Распознавание не настроено: задайте YANDEX_OCR_API_KEY и YANDEX_FOLDER_ID.');
  var vis = _irVision_(c, data.mimeType || 'image/jpeg', String(data.base64Image || '').replace(/^data:[^;]+;base64,/, ''), 'page');
  if (vis.error) throw new Error(vis.error);
  var label = _parseProductLabelText_(vis.fullText);
  return { manufactured_date: label.manufactured_date || '', expiration_date: label.expiration_date || '', barcode: label.barcode || '', name: label.name || '', shelf_life_raw: label.shelf_life_raw || '', storage_conditions: label.storage_conditions || '', raw_text: vis.fullText.slice(0, 4000) };
}

/** Подсказка срока годности по справочнику продукта (режим хранения: холодильник → комнатная → морозильник). */
function suggestReceiptExpiry_(productId, receiptDate) {
  var p = getProductById_(productId); if (!p || !p.global_product_id) return null;
  var rows = findRows_('PRODUCT_SHELF_LIFE', function (r) { return r.product_id === p.global_product_id && r.активен !== 'нет' && Number(r.duration) > 0; });
  var order = ['REFRIGERATOR', 'ROOM', 'FREEZER'];
  rows.sort(function (a, b) { return order.indexOf(String(a.storage_mode).toUpperCase()) - order.indexOf(String(b.storage_mode).toUpperCase()); });
  var r = rows[0]; if (!r) return null;
  var hours = { hours: 1, days: 24, months: 24 * 30 }[r.duration_unit] || 0; if (!hours) return null;
  var d = receiptDate ? new Date(receiptDate) : new Date(); d = new Date(d.getTime() + Number(r.duration) * hours * 3600000);
  var mode = { REFRIGERATOR: 'холодильник', ROOM: 'комнатная температура', FREEZER: 'морозильник' }[String(r.storage_mode).toUpperCase()] || r.storage_mode;
  return { date: d.toISOString().slice(0, 10), source: 'справочник: ' + (r.raw_text || (r.duration + ' ' + r.duration_unit)) + ' (' + mode + ')', verified: r.verified === true || r.verified === 'да' };
}

function migrateInvoiceRecognitionSchema_() {
  return { ok: true, changed: typeof ensureSchemaColumns_ === 'function' ? ensureSchemaColumns_('OCR_ALIASES') : [] };
}

// ---------- Правка черновика приёмки ----------

/**
 * Правка черновика до проводки: реквизиты документа и строки (продукт, количество, цена,
 * единица, даты, исключение строки). Ручной выбор продукта — решение человека: строка
 * фиксируется (source MANUAL), соответствие запоминается как алиас. После правки черновик
 * пересчитывается целиком (buildInvoiceDraftState_): ХАССП, целостность, статус.
 */
function updateInvoiceDraft_(data, session) {
  return withLock_(function () {
    var d = findOne_('INVOICE_INTAKE_DRAFTS', 'draft_id', data.draftId); _ocOwned_(session, d, 'INVOICE_INTAKE_DRAFTS:' + data.draftId);
    if (['POSTED', 'POSTING', 'RECOVERY_REQUIRED'].indexOf(d.status) !== -1) throw new Error('Документ в статусе ' + d.status + ' не редактируется.');
    var doc = JSON.parse(d.document_json || '{}'), lines = JSON.parse(d.lines_json || '[]');
    var dp = data.document || {};
    if (dp.invoice_number !== undefined) doc.invoice_number = String(dp.invoice_number || '').trim();
    if (dp.invoice_date !== undefined) { var dd = _irDate_(dp.invoice_date); if (dp.invoice_date && !dd) throw new Error('Дата документа: формат ГГГГ-ММ-ДД или ДД.ММ.ГГГГ.'); doc.invoice_date = dd; }
    if (dp.supplier_id !== undefined) {
      if (dp.supplier_id) { var s = findOne_('SUPPLIERS', 'supplier_id', dp.supplier_id); if (!s || s.organization_id !== session.organization_id) throw new Error('Поставщик не найден.'); doc.supplier_id = s.supplier_id; if (!doc.supplier) doc.supplier = s.название; }
      else doc.supplier_id = '';
    }
    var learned = [];
    (Array.isArray(data.lines) ? data.lines : []).forEach(function (p) {
      var l = lines.filter(function (x) { return Number(x.line_no) === Number(p.line_no); })[0];
      if (!l) throw new Error('Строка ' + p.line_no + ' не найдена.');
      if (p.skip !== undefined) l.skip = !!p.skip;
      ['qty', 'price'].forEach(function (k) { if (p[k] !== undefined) l[k] = p[k] === '' || p[k] === null ? null : _irNum_(p[k]); });
      if (p.unit !== undefined) l.unit = String(p.unit || '');
      ['expiryDate', 'productionDate'].forEach(function (k) { if (p[k] !== undefined) { var v = _irDate_(p[k]); if (p[k] && !v) throw new Error('Строка ' + p.line_no + ': дата в формате ГГГГ-ММ-ДД.'); l[k] = v; } });
      if (p.barcode !== undefined) l.barcode = String(p.barcode || '').replace(/\D/g, '');
      if (p.product_id !== undefined) {
        if (p.product_id) {
          var prod = getProductById_(p.product_id);
          if (!prod || prod.organization_id !== session.organization_id) throw new Error('Строка ' + p.line_no + ': продукт не найден.');
          l.match = { product_id: prod.product_id, source: 'MANUAL', score: 1, candidates: [] };
          l.line_warnings = (l.line_warnings || []).filter(function (w) { return !/продукт не найден|выберите продукт/.test(w); });
          if (rememberInvoiceAlias_(session, l.raw_name || l.name, prod.product_id, doc.supplier || '')) learned.push(l.line_no);
        } else if (l.match) { delete l.match; }
      }
    });
    var st = buildInvoiceDraftState_(doc, lines, session, d.draft_id);
    var fp = st.integrity;
    updateRow_('INVOICE_INTAKE_DRAFTS', d, { status: st.status, document_json: JSON.stringify(doc), lines_json: JSON.stringify(lines), matched_lines_json: JSON.stringify(st.mapped), integrity_json: JSON.stringify(fp), haccp_json: JSON.stringify(st.mapped.map(function (x) { return x.haccp; })), warnings_json: JSON.stringify(st.warnings), errors_json: JSON.stringify(st.errors) });
    findRows_('INVOICE_DOCUMENTS', function (r) { return r.draft_id === d.draft_id; }).forEach(function (r) {
      updateRow_('INVOICE_DOCUMENTS', r, { document_number: String(doc.invoice_number || ''), document_date: String(doc.invoice_date || ''), supplier_id: String(doc.supplier_id || ''), document_fingerprint: fp.document_fingerprint, lines_fingerprint: fp.lines_fingerprint });
    });
    auditLog_(session.user_id, 'Правка черновика приёмки', 'INVOICE_INTAKE_DRAFTS:' + d.draft_id, '', JSON.stringify({ document: dp, lines: (data.lines || []).length, learned: learned }), 'success', session.cascade_id || '');
    var out = getInvoiceIntakeDraft_(session, { draftId: d.draft_id }); out.learned_aliases = learned; return out;
  });
}

/** Скан этикетки для строки черновика: найденные даты/штрихкод сразу записываются в строку. */
function scanInvoiceDraftLineLabel_(data, session) {
  var d = findOne_('INVOICE_INTAKE_DRAFTS', 'draft_id', data.draftId); _ocOwned_(session, d, 'INVOICE_INTAKE_DRAFTS:' + data.draftId);
  var label = scanInvoiceLineLabel_(data, session);
  var lines = JSON.parse(d.lines_json || '[]'), l = lines.filter(function (x) { return Number(x.line_no) === Number(data.lineNo); })[0];
  if (!l) throw new Error('Строка ' + data.lineNo + ' не найдена.');
  var patch = { line_no: l.line_no }, notes = [];
  if (label.expiration_date) patch.expiryDate = label.expiration_date; else notes.push('срок годности на этикетке не найден');
  if (label.manufactured_date) patch.productionDate = label.manufactured_date;
  if (label.barcode && !l.barcode) patch.barcode = label.barcode;
  var pid = l.match && l.match.product_id;
  if (label.barcode && pid) { var pr = getProductById_(pid); if (pr && pr.штрихкод && String(pr.штрихкод) !== String(label.barcode)) notes.push('штрихкод этикетки ' + label.barcode + ' не совпадает со штрихкодом продукта ' + pr.штрихкод + ' — проверьте товар'); }
  var res = updateInvoiceDraft_({ draftId: d.draft_id, lines: [patch] }, session);
  res.label = label; res.label_notes = notes;
  return res;
}

/** Последние черновики приёмки точки (для возврата к незавершённой приёмке). */
function getInvoiceDrafts_(session, data) {
  var rows = findRows_('INVOICE_INTAKE_DRAFTS', function (r) { return r.organization_id === session.organization_id && r.location_id === session.location_id && (!data || !data.status || r.status === data.status); });
  return rows.slice(-30).reverse().map(function (r) { var doc = {}; try { doc = JSON.parse(r.document_json || '{}'); } catch (e) {} return { draft_id: r.draft_id, status: r.status, created_at: r.created_at, invoice_number: doc.invoice_number || '', invoice_date: doc.invoice_date || '', supplier: doc.supplier || '', total: doc.total || '' }; });
}
