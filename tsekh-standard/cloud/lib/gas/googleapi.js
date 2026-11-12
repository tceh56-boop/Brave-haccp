'use strict';
/**
 * Обращения кода к REST API Google (UrlFetchApp на www.googleapis.com с токеном ScriptApp.getOAuthToken()).
 * В облаке их обслуживает сам сервер, без сети:
 *   POST drive/v3/files/<id>/copy  {mimeType: Таблица|Документ} — конвертация: Excel → таблица, Word → документ,
 *        PDF/фото → документ с распознанным текстом (Yandex Vision, ключ YANDEX_API_KEY в свойствах предприятия);
 *   GET  drive/v3/files/<id>/export?mimeType=text/html|text/plain — текст документа;
 *   GET  drive/v3/files/<id>?fields=… — метаданные (миниатюры нет — код берёт запасной путь);
 *   script.googleapis.com — управление проектом Apps Script (в облаке не нужно): ответ 404.
 */
const { execFileSync } = require('child_process');
const path = require('path');

const MIME_SHEET = 'application/vnd.google-apps.spreadsheet';
const MIME_DOC = 'application/vnd.google-apps.document';
const WORKER = path.join(__dirname, 'convert_worker.js');

const resp = (status, obj, type = 'application/json') => ({ status, headers: { 'content-type': type }, body: Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8').toString('base64') });
const gErr = (status, message) => resp(status, { error: { code: status, message } });

function convert(kind, bytes) {
  const out = JSON.parse(execFileSync(process.execPath, [WORKER], { input: JSON.stringify({ kind, data: bytes.toString('base64') }), maxBuffer: 200 * 1024 * 1024, timeout: 120000 }).toString('utf8'));
  if (out.error) throw new Error(out.error);
  return out;
}

/** HTML (mammoth) → блоки документа: абзацы, заголовки, таблицы. */
function htmlToBlocks(html) {
  const blocks = [];
  const text = (s) => String(s).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  const re = /<table[\s\S]*?<\/table>|<(h[1-6]|p|li)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (/^<table/i.test(m[0])) {
      const rows = [];
      m[0].replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (x, tr) => { const cells = []; tr.replace(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi, (y, td) => { cells.push(text(td)); return y; }); rows.push(cells); return x; });
      blocks.push({ tag: 'table', rows });
    } else blocks.push({ tag: m[1].toLowerCase() === 'li' ? 'li' : m[1].toLowerCase(), text: text(m[2]) });
  }
  return blocks;
}

/** Распознавание PDF/изображения через Yandex Vision (тот же ключ, что у распознавания накладных). */
function ocrText(tenant, bytes, mime, urlfetch) {
  const key = tenant.store.prop('YANDEX_API_KEY'); const folder = tenant.store.prop('YANDEX_FOLDER_ID');
  if (!key || !folder) throw new Error('Распознавание PDF и фото: добавьте YANDEX_API_KEY и YANDEX_FOLDER_ID в свойства предприятия');
  const r = urlfetch.fetch('https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText', { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Api-Key ' + key, 'x-folder-id': folder },
    payload: JSON.stringify({ mimeType: /pdf/.test(mime) ? 'application/pdf' : mime, languageCodes: ['ru', 'en'], model: 'page', content: bytes.toString('base64') }) });
  if (r.getResponseCode() >= 300) throw new Error('Yandex Vision ответил ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
  const j = JSON.parse(r.getContentText() || '{}');
  return String((j.result && j.result.textAnnotation && j.result.textAnnotation.fullText) || '');
}

function handle(url, req, tenant, urlfetch) {
  const u = new URL(url);
  if (u.hostname === 'script.googleapis.com') return gErr(404, 'Управление проектом Apps Script в облачной версии не используется');
  if (u.hostname !== 'www.googleapis.com' || !/^\/drive\/v[23]\/files/.test(u.pathname)) return gErr(404, 'Служба Google недоступна в облачной версии');
  const store = tenant.store;
  const m = /^\/drive\/v[23]\/files\/([^/]+)(\/copy|\/export)?$/.exec(u.pathname);
  if (!m) return gErr(404, 'Запрос к Диску не поддерживается');
  const id = decodeURIComponent(m[1]);
  const meta = store.file(id);
  if (!meta) return gErr(404, 'File not found: ' + id);
  const body = req.body ? JSON.parse(Buffer.from(req.body, 'base64').toString('utf8') || '{}') : {};

  if (m[2] === '/copy') {
    const target = body.mimeType || meta.mime;
    const name = body.name || meta.name;
    const parents = body.parents || meta.parents;
    const bytes = store.readBlob(id);
    const lname = meta.name.toLowerCase();
    if (target === MIME_SHEET) {
      let sheets;
      if (meta.mime === MIME_SHEET) { const nid = store.copyBook(id, name, parents); return resp(200, { id: nid }); }
      if (/csv/.test(meta.mime) || /\.csv$/.test(lname)) {
        const { parseCsv } = require('./utilities');
        const t = bytes.toString('utf8'); sheets = [{ name: 'Лист1', rows: parseCsv(t, t.split(';').length > t.split(',').length ? ';' : ',') }];
      } else if (/spreadsheetml|macroenabled/.test(meta.mime) || /\.(xlsx|xlsm)$/.test(lname)) sheets = convert('xlsx', bytes).sheets;
      else return gErr(400, `Формат «${meta.name}» в облаке не конвертируется: сохраните файл как .xlsx`);
      const nid = store.createBook(name, undefined, parents);
      const { encodeRow } = require('../store');
      store.db.transaction(() => {
        store.db.prepare('delete from sheets where book = ?').run(nid);
        sheets.forEach((s, i) => {
          store.db.prepare('insert into sheets (book, sid, name, idx) values (?, ?, ?, ?)').run(nid, i, s.name || 'Лист' + (i + 1), i);
          s.rows.forEach((row, r) => { if (row.length) store.db.prepare('insert into cells (book, sid, r, v) values (?, ?, ?, ?)').run(nid, i, r, encodeRow(row.map((v) => (v && v.$d ? new Date(v.$d) : v)))); });
        });
      })();
      for (const k of [...store.sheetData.keys()]) if (k.startsWith(nid + '/')) store.sheetData.delete(k);
      return resp(200, { id: nid });
    }
    if (target === MIME_DOC) {
      let blocks;
      if (meta.mime === MIME_DOC) blocks = JSON.parse(bytes.toString('utf8') || '{"blocks":[]}').blocks;
      else if (/wordprocessingml/.test(meta.mime) || /\.docx$/.test(lname)) blocks = htmlToBlocks(convert('docx', bytes).html);
      else if (/^text\//.test(meta.mime)) blocks = bytes.toString('utf8').split(/\r?\n/).map((t) => ({ tag: 'p', text: t }));
      else if (/pdf|image\//.test(meta.mime) || /\.(pdf|jpe?g|png)$/.test(lname)) blocks = ocrText(tenant, bytes, meta.mime, urlfetch).split(/\r?\n/).map((t) => ({ tag: 'p', text: t }));
      else return gErr(400, `Формат «${meta.name}» в облаке не конвертируется: сохраните файл как .docx или PDF`);
      const nid = store.addFile({ name, mime: MIME_DOC, parents, bytes: Buffer.from(JSON.stringify({ blocks }), 'utf8') });
      return resp(200, { id: nid });
    }
    const nid = store.addFile({ name, mime: meta.mime, parents, bytes });
    return resp(200, { id: nid });
  }
  if (m[2] === '/export') {
    const mime = u.searchParams.get('mimeType') || 'text/plain';
    if (meta.mime === MIME_DOC) {
      const doc = tenant.documentApp().openById(id);
      if (/html/.test(mime)) return resp(200, doc.getBlob().getDataAsString(), 'text/html');
      return resp(200, doc.getBody().getText(), 'text/plain');
    }
    if (meta.mime === MIME_SHEET) {
      const v = tenant.spreadsheetApp().openById(id).getSheets()[0].getDataRange().getDisplayValues();
      return resp(200, v.map((r) => r.join(',')).join('\n'), 'text/csv');
    }
    return gErr(400, 'Экспорт возможен только для документов и таблиц');
  }
  if (req.method === 'GET') return resp(200, { id, name: meta.name, mimeType: meta.mime, size: String(meta.size), modifiedTime: new Date(meta.updated).toISOString(), parents: meta.parents });
  if (req.method === 'DELETE') { store.updateFile(id, { trashed: 1 }); return resp(204, ''); }
  return gErr(400, 'Запрос к Диску не поддерживается');
}

module.exports = { handle, htmlToBlocks };
