/**
 * MON CHEF — распознавание текста Yandex Vision для фото и PDF (накладные, бланки банкетов, этикетки).
 *
 * Фото JPEG/PNG — синхронный запрос, как раньше.
 * PDF: одна страница — синхронный запрос с типом PDF; несколько страниц (или если синхронный
 * запрос PDF не принял) — асинхронный: recognizeTextAsync → ожидание операции → getRecognition.
 * Страницы склеиваются по порядку: координаты строк каждой следующей страницы сдвигаются вниз на
 * высоту предыдущих — сборка таблицы накладной по координатам (_rebuildTableText_) работает через
 * страницы. Ничего не додумывается: что не распознано — того нет.
 */
var MC_OCR_URL_ = 'https://ocr.api.cloud.yandex.net/ocr/v1/';
var MC_OCR_ASYNC_WAIT_MS_ = 60000;

function _mcOcrMime_(dataMime) {
  var m = String(dataMime || '').toLowerCase();
  if (m.indexOf('pdf') >= 0) return 'PDF';
  return m.indexOf('png') >= 0 ? 'PNG' : 'JPEG';
}
/** Число страниц PDF по словарям /Type /Page (0 — не удалось определить: объекты сжаты). */
function _mcPdfPages_(b64) {
  try {
    var bytes = Utilities.base64Decode(b64), s = '';
    for (var i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.slice(i, i + 8192).map(function (b) { return b & 255; }));
    var m = s.match(/\/Type\s*\/Page(?!s)/g);
    return m ? m.length : 0;
  } catch (e) { return 0; }
}
function _mcOcrHeaders_(key, folder) { return { Authorization: 'Api-Key ' + key, 'x-folder-id': folder }; }

/** Склеить страницы: блоки следующей страницы сдвигаются вниз на высоту предыдущих. */
function _mcMergeAnn_(pages) {
  if (pages.length === 1) return pages[0];
  var out = { width: 0, height: 0, blocks: [], fullText: '', pageTops: [] }, off = 0, texts = [];
  pages.forEach(function (a) {
    out.pageTops.push(off);   // верх страницы в общей системе координат — номер страницы у строки бланка
    var h = Number(a.height) || 0, maxY = 0;
    (a.blocks || []).forEach(function (b) {
      var shift = function (bb) { ((bb && bb.vertices) || []).forEach(function (v) { var y = Number(v.y) || 0; if (y > maxY) maxY = y; v.y = String(y + off); }); };
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

function _mcOcrAsync_(key, folder, mime, b64, model) {
  var r = UrlFetchApp.fetch(MC_OCR_URL_ + 'recognizeTextAsync', { method: 'post', contentType: 'application/json', headers: _mcOcrHeaders_(key, folder),
    payload: JSON.stringify({ mimeType: mime, languageCodes: ['ru', 'en'], model: model || 'page', content: b64 }), muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) return { error: 'ocr', code: r.getResponseCode(), body: r.getContentText().slice(0, 300) };
  var op = JSON.parse(r.getContentText()), id = op.id, t0 = Date.now(), done = !!op.done;
  while (!done && Date.now() - t0 < MC_OCR_ASYNC_WAIT_MS_) {
    Utilities.sleep(2000);
    var st = UrlFetchApp.fetch('https://operation.api.cloud.yandex.net/operations/' + encodeURIComponent(id), { headers: _mcOcrHeaders_(key, folder), muteHttpExceptions: true });
    if (st.getResponseCode() !== 200) return { error: 'ocr', code: st.getResponseCode(), body: st.getContentText().slice(0, 300) };
    var sj = JSON.parse(st.getContentText()); done = !!sj.done;
    if (sj.error) return { error: 'ocr', code: sj.error.code || 500, body: JSON.stringify(sj.error).slice(0, 300) };
  }
  if (!done) return { error: 'ocr', code: 504, body: 'распознавание PDF не закончилось за ' + Math.round(MC_OCR_ASYNC_WAIT_MS_ / 1000) + ' с — повторите позже' };
  var g = UrlFetchApp.fetch(MC_OCR_URL_ + 'getRecognition?operationId=' + encodeURIComponent(id), { headers: _mcOcrHeaders_(key, folder), muteHttpExceptions: true });
  if (g.getResponseCode() !== 200) return { error: 'ocr', code: g.getResponseCode(), body: g.getContentText().slice(0, 300) };
  // ответ — по объекту JSON на страницу подряд
  var txt = g.getContentText(), pages = [], depth = 0, start = -1, inStr = false, esc = false;
  for (var i = 0; i < txt.length; i++) {
    var ch = txt.charAt(i);
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') { depth--; if (depth === 0 && start >= 0) { try { var pj = JSON.parse(txt.slice(start, i + 1)); pages.push(pj); } catch (e) {} start = -1; } }
  }
  pages.sort(function (a, b) { return (Number(a.result && a.result.page) || 0) - (Number(b.result && b.result.page) || 0); });
  var anns = pages.map(function (p) { return (p.result && p.result.textAnnotation) || null; }).filter(Boolean);
  if (!anns.length) return { error: 'empty' };
  return { ann: _mcMergeAnn_(anns), pages: anns.length };
}

/** Распознать dataUrl (фото или PDF). Возвращает {ann, pages} или {error, code, body}. */
function _mcOcrAnn_(key, folder, dataMime, b64, model) {
  var mime = _mcOcrMime_(dataMime);
  if (mime === 'PDF' && _mcPdfPages_(b64) > 1) return _mcOcrAsync_(key, folder, mime, b64, model);
  var r = UrlFetchApp.fetch(MC_OCR_URL_ + 'recognizeText', { method: 'post', contentType: 'application/json', headers: _mcOcrHeaders_(key, folder),
    payload: JSON.stringify({ mimeType: mime, languageCodes: ['ru', 'en'], model: model || 'page', content: b64 }), muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) {
    if (mime === 'PDF') return _mcOcrAsync_(key, folder, mime, b64, model);   // синхронный не принял PDF (несколько страниц, размер)
    return { error: 'ocr', code: r.getResponseCode(), body: r.getContentText().slice(0, 300) };
  }
  var oj = JSON.parse(r.getContentText());
  return { ann: (oj.result && oj.result.textAnnotation) || {}, pages: 1 };
}
