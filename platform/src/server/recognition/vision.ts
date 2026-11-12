import { yandexConfig, yandexHeaders } from '../integrations/yandex';

/**
 * Yandex Vision OCR — перенос MON CHEF (MonChef_PdfOcr.gs, V10 _mcV10Vision_/_mcV10BestVision_, Code.gs _rebuildTableText_,
 * ориентация и наклон — MonChef_BanquetOcr.gs _bqoOrient_/_bqoSkew_). Логика и пороги — как в MON CHEF.
 * Адаптация для ЦЕХ: несколько фото одного документа (лист 1, лист 2) распознаются по отдельности и склеиваются как страницы
 * PDF; ориентация (фото боком или вверх ногами) определяется для каждой страницы до склейки — в MON CHEF так делает
 * разбор банкетного бланка, разбор накладной поправлял только наклон.
 */

const OCR_BASE = (process.env.YANDEX_OCR_URL || 'https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText').replace(/recognizeText$/, '');
const OPERATION_URL = 'https://operation.api.cloud.yandex.net/operations/';
const ASYNC_WAIT_MS = 60_000;
export const MODEL = { PAGE: 'page', HANDWRITTEN: 'handwritten' } as const;

export interface Vertex { x?: string | number; y?: string | number }
export interface Word { text?: string; boundingBox?: { vertices?: Vertex[] } }
export interface Ann { width?: string | number; height?: string | number; fullText?: string; markdown?: string; blocks?: { boundingBox?: { vertices?: Vertex[] }; lines?: { boundingBox?: { vertices?: Vertex[] }; words?: Word[] }[] }[]; tables?: unknown[]; pageTops?: number[] }
export interface Vis { ann: Ann; fullText: string; markdown: string; layoutText: string; model: string; quality: number; pages: number; orient: number[] }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function ocrMime(mime: string) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('pdf')) return 'PDF';
  return m.includes('png') ? 'PNG' : 'JPEG';
}

/** Число страниц PDF по словарям /Type /Page (0 — не удалось определить: объекты сжаты). */
export function pdfPages(bytes: Buffer) {
  const m = bytes.toString('latin1').match(/\/Type\s*\/Page(?!s)/g);
  return m ? m.length : 0;
}

/** Склеить страницы: блоки следующей страницы сдвигаются вниз на высоту предыдущих (верх страницы — в pageTops). */
export function mergeAnn(pages: Ann[]): Ann {
  if (pages.length === 1) return pages[0];
  const out: Ann = { width: 0, height: 0, blocks: [], fullText: '', pageTops: [] };
  let off = 0;
  const texts: string[] = [];
  for (const a of pages) {
    out.pageTops!.push(off);
    const h = Number(a.height) || 0;
    let maxY = 0;
    const shift = (bb?: { vertices?: Vertex[] }) => (bb?.vertices || []).forEach((v) => { const y = Number(v.y) || 0; if (y > maxY) maxY = y; v.y = String(y + off); });
    for (const b of a.blocks || []) {
      shift(b.boundingBox);
      for (const l of b.lines || []) { shift(l.boundingBox); (l.words || []).forEach((w) => shift(w.boundingBox)); }
      out.blocks!.push(b);
    }
    off += (h || maxY) + 40;
    out.width = Math.max(Number(out.width) || 0, Number(a.width) || 0);
    if (a.fullText) texts.push(a.fullText);
    if (a.markdown) out.markdown = [out.markdown, a.markdown].filter(Boolean).join('\n\n');
  }
  out.height = off; out.fullText = texts.join('\n');
  return out;
}

/* ───────────── ориентация и наклон (MonChef_BanquetOcr.gs) ───────────── */

const center = (w: Word) => { const v = w.boundingBox!.vertices!; let sx = 0, sy = 0; v.forEach((p) => { sx += Number(p.x) || 0; sy += Number(p.y) || 0; }); return [sx / v.length, sy / v.length]; };

/** Ориентация по направлению чтения: в строке Vision слова идут по порядку чтения. 0 / 90 / 180 / 270. */
export function orient(ann: Ann) {
  const votes: Record<number, number> = { 0: 0, 90: 0, 180: 0, 270: 0 };
  let n = 0;
  for (const b of ann.blocks || []) for (const ln of b.lines || []) {
    const ws = (ln.words || []).filter((w) => (w.boundingBox?.vertices?.length || 0) >= 4);
    if (ws.length < 2) continue;
    const a = center(ws[0]), z = center(ws[ws.length - 1]), dx = z[0] - a[0], dy = z[1] - a[1];
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) continue;
    n++;
    if (Math.abs(dx) >= Math.abs(dy)) votes[dx > 0 ? 0 : 180]++; else votes[dy > 0 ? 270 : 90]++;
  }
  let best = 0;
  for (const k of [90, 180, 270]) if (votes[k] > votes[best]) best = k;
  if (n < 6 || votes[best] < n * 0.7) best = 0;
  return best;
}

/** Повернуть координаты страницы так, чтобы текст читался слева направо (на месте; ширина и высота меняются при 90/270). */
export function rotateAnn(ann: Ann, rot: number) {
  if (!rot) return ann;
  let W = Number(ann.width) || 0, H = Number(ann.height) || 0;
  if (!W || !H) {
    let mx = 0, my = 0;
    for (const b of ann.blocks || []) for (const ln of b.lines || []) for (const w of ln.words || []) for (const p of w.boundingBox?.vertices || []) { mx = Math.max(mx, Number(p.x) || 0); my = Math.max(my, Number(p.y) || 0); }
    W = W || mx; H = H || my;
  }
  // 180 — (W−x, H−y); текст сверху вниз (270) — (y, W−x); снизу вверх (90) — (H−y, x)
  const tr = rot === 180 ? (x: number, y: number) => [W - x, H - y] : rot === 270 ? (x: number, y: number) => [y, W - x] : (x: number, y: number) => [H - y, x];
  const fix = (bb?: { vertices?: Vertex[] }) => (bb?.vertices || []).forEach((v) => { const [x, y] = tr(Number(v.x) || 0, Number(v.y) || 0); v.x = String(x); v.y = String(y); });
  for (const b of ann.blocks || []) { fix(b.boundingBox); for (const l of b.lines || []) { fix(l.boundingBox); (l.words || []).forEach((w) => fix(w.boundingBox)); } }
  if (rot !== 180) { ann.width = String(H); ann.height = String(W); }
  return ann;
}

const median = (a: number[]) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

/** Наклон строк (тангенс), перебор с шагом 0,002 по гистограмме выпрямленной высоты. */
export function skew(ws: { cx: number; cy: number; w: number; h: number }[], lo = -0.12, hi = 0.12) {
  if (ws.length < 12) return 0;
  const h = median(ws.map((w) => w.h)) || 10, bin = Math.max(2, h * 0.35);
  let best = 0, bestS = -1;
  for (let s = lo; s <= hi + 1e-4; s += 0.002) {
    const hist: Record<number, number> = {};
    let sc = 0;
    for (const w of ws) { const k = Math.round((w.cy - s * w.cx) / bin); hist[k] = (hist[k] || 0) + w.w; }
    for (const k in hist) sc += hist[k] * hist[k];
    if (sc > bestS || (sc === bestS && Math.abs(s) < Math.abs(best))) { bestS = sc; best = s; }
  }
  return Math.round(best * 1000) / 1000;
}

/** Таблица по координатам слов (Code.gs _rebuildTableText_): строки по выпрямленной высоте, внутри — слева направо. */
export function rebuildTableText(ann: Ann): string | null {
  const words: { text: string; x: number; y: number; h: number }[] = [];
  for (const b of ann.blocks || []) for (const ln of b.lines || []) for (const w of ln.words || []) {
    const v = w.boundingBox?.vertices;
    if (!v || v.length < 4 || !w.text) continue;
    const ys = v.map((p) => Number(p.y) || 0), xs = v.map((p) => Number(p.x) || 0);
    const h = Math.max(...ys) - Math.min(...ys);
    words.push({ text: w.text, x: Math.min(...xs), y: (Math.min(...ys) + Math.max(...ys)) / 2, h: h || 20 });
  }
  if (!words.length) return null;
  const sk = skew(words.map((w) => ({ cx: w.x + 10, cy: w.y, w: 20, h: w.h })));
  if (sk) words.forEach((w) => { w.y = w.y - sk * w.x; });
  const avgH = words.reduce((s, w) => s + w.h, 0) / words.length;
  const threshold = Math.max(10, avgH * 0.6);
  words.sort((a, b) => a.y - b.y);
  const rows: typeof words[] = [];
  let current = [words[0]], rowY = words[0].y;
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (Math.abs(w.y - rowY) <= threshold) { current.push(w); rowY = current.reduce((s, x) => s + x.y, 0) / current.length; }
    else { rows.push(current); current = [w]; rowY = w.y; }
  }
  rows.push(current);
  return rows.map((row) => row.sort((a, b) => a.x - b.x).map((w) => w.text).join(' ')).join('\n');
}

/** Качество распознавания (V10 _mcV10OcrQuality_). */
export function quality(ann: Ann, fullText: string, markdown: string) {
  const text = String(fullText || '');
  const nonSpace = text.replace(/\s/g, '');
  const digits = (text.match(/[0-9]/g) || []).length;
  const cyr = (text.match(/[А-Яа-яЁё]/g) || []).length;
  const lines = text.split(/\n+/).filter((x) => x.trim()).length;
  const blocks = (ann.blocks || []).length, tables = (ann.tables || []).length;
  let score = 0.15;
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

/* ───────────── обращения к Vision ───────────── */

async function ocrAsync(mime: string, b64: string, model: string): Promise<{ anns: Ann[] }> {
  const h = yandexHeaders();
  const r = await fetch(`${OCR_BASE}recognizeTextAsync`, { method: 'POST', headers: h, body: JSON.stringify({ mimeType: mime, languageCodes: ['ru', 'en'], model, content: b64 }) });
  if (!r.ok) throw new Error(`Yandex Vision: ${r.status} ${(await r.text()).slice(0, 200)}`);
  const op = await r.json() as { id: string; done?: boolean };
  let done = !!op.done;
  const t0 = Date.now();
  while (!done && Date.now() - t0 < ASYNC_WAIT_MS) {
    await sleep(2000);
    const st = await fetch(OPERATION_URL + encodeURIComponent(op.id), { headers: h });
    if (!st.ok) throw new Error(`Yandex Vision: ${st.status}`);
    const sj = await st.json() as { done?: boolean; error?: { code?: number } };
    if (sj.error) throw new Error(`Yandex Vision: ${JSON.stringify(sj.error).slice(0, 200)}`);
    done = !!sj.done;
  }
  if (!done) throw new Error(`Распознавание PDF не закончилось за ${ASYNC_WAIT_MS / 1000} с — повторите позже.`);
  const g = await fetch(`${OCR_BASE}getRecognition?operationId=${encodeURIComponent(op.id)}`, { headers: h });
  if (!g.ok) throw new Error(`Yandex Vision: ${g.status}`);
  // ответ — по объекту JSON на страницу подряд
  const txt = await g.text(), pages: { result?: { page?: number; textAnnotation?: Ann } }[] = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') { depth--; if (depth === 0 && start >= 0) { try { pages.push(JSON.parse(txt.slice(start, i + 1))); } catch { /* неполная страница */ } start = -1; } }
  }
  pages.sort((a, b) => (Number(a.result?.page) || 0) - (Number(b.result?.page) || 0));
  return { anns: pages.map((p) => p.result?.textAnnotation).filter(Boolean) as Ann[] };
}

/** Распознать один файл (фото или PDF) → страницы. */
async function ocrFile(bytes: Buffer, mimeType: string, model: string): Promise<Ann[]> {
  const mime = ocrMime(mimeType), b64 = bytes.toString('base64');
  if (mime === 'PDF' && pdfPages(bytes) > 1) return (await ocrAsync(mime, b64, model)).anns;
  const r = await fetch(`${OCR_BASE}recognizeText`, { method: 'POST', headers: yandexHeaders(), body: JSON.stringify({ mimeType: mime, languageCodes: ['ru', 'en'], model, content: b64 }) });
  if (!r.ok) {
    if (mime === 'PDF') return (await ocrAsync(mime, b64, model)).anns;   // синхронный не принял PDF
    throw new Error(`Yandex Vision: ${r.status} ${(await r.text()).slice(0, 200)}`);
  }
  const oj = await r.json() as { result?: { textAnnotation?: Ann } };
  return [oj.result?.textAnnotation || {}];
}

export interface InputFile { bytes: Buffer; mimeType: string }

/** Один проход OCR по всем файлам документа: страницы повёрнуты к чтению и склеены. */
export async function vision(files: InputFile[], model: string): Promise<Vis> {
  if (!yandexConfig().folderId) throw new Error('Распознавание не настроено на сервере.');
  const pages: Ann[] = [];
  for (const f of files) pages.push(...await ocrFile(f.bytes, f.mimeType, model));
  const rot = pages.map((p) => orient(p));
  pages.forEach((p, i) => rotateAnn(p, rot[i]));
  const ann = mergeAnn(pages);
  const fullText = String(ann.fullText || '').trim(), markdown = String(ann.markdown || '').trim();
  if (!fullText && !markdown) throw new Error('Текст на изображении не найден — переснимите документ ровнее и при хорошем свете.');
  const layoutText = rebuildTableText(ann) || fullText;
  return { ann, fullText, markdown, layoutText, model, quality: quality(ann, fullText, markdown), pages: pages.length, orient: rot };
}

/** Нужен ли второй проход моделью handwritten (V10 _mcV10NeedHandwritten_). */
export function needHandwritten(page: Vis, typeHint: string) {
  const t = `${page.fullText}\n${page.markdown}`.toLowerCase().replace(/ё/g, 'е');
  if (typeHint === 'PRODUCT_RECEIPT' || typeHint === 'HANDWRITTEN') return true;
  if (page.quality < 0.68) return true;
  if (t.length < 60) return true;
  if (/товарный чек|подпись продавца/.test(t) && page.quality < 0.82) return true;
  return false;
}

/** Лучший результат из page и handwritten (V10 _mcV10BestVision_). Страниц к оплате — по каждому проходу. */
export async function bestVision(files: InputFile[], typeHint = ''): Promise<{ vis: Vis; pagesBilled: number }> {
  const page = await vision(files, MODEL.PAGE);
  if (!needHandwritten(page, typeHint)) return { vis: page, pagesBilled: page.pages };
  let hand: Vis;
  try { hand = await vision(files, MODEL.HANDWRITTEN); } catch { return { vis: page, pagesBilled: page.pages }; }
  const billed = page.pages + hand.pages;
  if (typeHint === 'PRODUCT_RECEIPT' || typeHint === 'HANDWRITTEN') return { vis: hand.quality >= page.quality * 0.92 ? hand : page, pagesBilled: billed };
  return { vis: hand.quality > page.quality + 0.08 ? hand : page, pagesBilled: billed };
}
