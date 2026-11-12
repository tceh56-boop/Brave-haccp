'use strict';
/**
 * Перенос предприятия из Google в облако.
 *
 * Вход:
 *   • опись cloud-manifest.json (tools/google-export.gs): свойства скрипта, ID и места всех файлов и папок;
 *   • архивы .zip корневой папки, скачанные с Диска (Google Таблицы приходят как .xlsx, Документы — как .docx);
 *   • при необходимости — таблица-база отдельным .xlsx, если она лежала вне корневой папки.
 *
 * Файлы, папки и таблицы получают те же ID, что были в Google, поэтому свойства (TS_TENANT_ROOT_ID, SHEET_ID…) и ссылки
 * на файлы в листах продолжают работать. Ссылки вида https://drive.google.com/file/d/<id>/… в ячейках заменяются на
 * адреса файлов на своём сервере.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { convert, htmlToBlocks } = require('./gas/googleapi');

const MIME_FOLDER = 'application/vnd.google-apps.folder';
const MIME_SHEET = 'application/vnd.google-apps.spreadsheet';
const MIME_DOC = 'application/vnd.google-apps.document';
const EXPORT_EXT = { [MIME_SHEET]: '.xlsx', [MIME_DOC]: '.docx', 'application/vnd.google-apps.presentation': '.pptx', 'application/vnd.google-apps.drawing': '.pdf' };
// Свойства, привязанные к проекту Google, а не к предприятию: на сервере не нужны и сбивают с толку.
const DROP_PROPS = /^(DEPLOYMENT_ID|TS_DEPLOYMENT_ID|SCRIPT_ID|MASTER_SCRIPT_ID|OAUTH.*|MC_JOB.*|MC_LOCK.*)$/;

/** Чтение .zip по центральному каталогу (Диск пишет размеры в дескрипторы после данных, локальные заголовки их не содержат). */
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Это не .zip-архив или архив повреждён');
  let count = buf.readUInt16LE(eocd + 10); let cd = buf.readUInt32LE(eocd + 16);
  if (cd === 0xffffffff || count === 0xffff) { // ZIP64: архивы Диска больше 4 ГБ
    const loc = eocd - 20;
    if (loc < 0 || buf.readUInt32LE(loc) !== 0x07064b50) throw new Error('Архив ZIP64 без указателя каталога');
    const z = Number(buf.readBigUInt64LE(loc + 8));
    count = Number(buf.readBigUInt64LE(z + 32)); cd = Number(buf.readBigUInt64LE(z + 48));
  }
  const out = new Map();
  for (let n = 0, i = cd; n < count; n++) {
    if (buf.readUInt32LE(i) !== 0x02014b50) throw new Error('Повреждён каталог архива');
    const flags = buf.readUInt16LE(i + 8); const method = buf.readUInt16LE(i + 10);
    let csize = buf.readUInt32LE(i + 20); let usize = buf.readUInt32LE(i + 24);
    const nlen = buf.readUInt16LE(i + 28); const xlen = buf.readUInt16LE(i + 30); const clen = buf.readUInt16LE(i + 32);
    let off = buf.readUInt32LE(i + 42);
    const name = buf.slice(i + 46, i + 46 + nlen).toString(flags & 0x800 ? 'utf8' : 'utf8');
    // ZIP64 extra: размеры и смещение по 8 байт, только для полей со значением 0xffffffff
    for (let x = i + 46 + nlen; x < i + 46 + nlen + xlen;) {
      const id = buf.readUInt16LE(x); const len = buf.readUInt16LE(x + 2); let p = x + 4;
      if (id === 1) {
        if (usize === 0xffffffff) { usize = Number(buf.readBigUInt64LE(p)); p += 8; }
        if (csize === 0xffffffff) { csize = Number(buf.readBigUInt64LE(p)); p += 8; }
        if (off === 0xffffffff) { off = Number(buf.readBigUInt64LE(p)); p += 8; }
      }
      x += 4 + len;
    }
    i += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    const lnlen = buf.readUInt16LE(off + 26); const lxlen = buf.readUInt16LE(off + 28);
    const raw = buf.slice(off + 30 + lnlen + lxlen, off + 30 + lnlen + lxlen + csize);
    out.set(name.normalize('NFC'), () => (method === 8 ? zlib.inflateRawSync(raw) : raw));
  }
  return out;
}

const norm = (p) => String(p).normalize('NFC').replace(/\\/g, '/').replace(/^\/+/, '');

/** Найти файл описи в архивах: путь из описи, с расширением выгрузки для файлов Google, с суффиксом « (1)» Диска. */
function locate(entries, item, used = new Set()) {
  const has = (k) => entries.has(k) && !used.has(k);
  const ext = EXPORT_EXT[item.mime] || '';
  const p = norm(item.path);
  const cands = [p];
  if (ext && !p.toLowerCase().endsWith(ext)) cands.push(p + ext);
  for (const c of cands) if (has(c)) return c;
  // архив, скачанный из самой корневой папки, начинается с её содержимого, без имени корня
  const tail = (c) => c.split('/').slice(1).join('/');
  for (const c of cands) if (has(tail(c))) return tail(c);
  // одинаковые имена в одной папке Диск выгружает как «имя (1).ext»
  const dot = (c) => { const m = /^(.*?)(\.[^./]+)?$/.exec(c); return [m[1], m[2] || '']; };
  for (const c of cands) for (let k = 1; k < 10; k++) { const [b, e] = dot(c); for (const v of [`${b} (${k})${e}`, tail(`${b} (${k})${e}`)]) if (has(v)) return v; }
  return null;
}

/** Ссылки на Диск и Таблицы в тексте ячейки → адреса своего сервера (только для перенесённых ID). */
function rewriteLinks(v, known, baseUrl) {
  if (typeof v !== 'string' || !/google\.com/.test(v)) return v;
  return v.replace(/https?:\/\/(?:drive|docs)\.google\.com\/(?:[a-z]+\/)*(?:d|folders)\/([A-Za-z0-9_-]{20,})(?:\/[^\s"'<>]*)?(?:\?[^\s"'<>]*)?/g,
    (m, id) => (known.has(id) ? `${baseUrl}/${known.get(id) === MIME_FOLDER ? 'folder' : 'file'}/${id}` : m))
    .replace(/https?:\/\/drive\.google\.com\/(?:open|uc)\?(?:[^\s"'<>]*&)?id=([A-Za-z0-9_-]{20,})[^\s"'<>]*/g,
      (m, id) => (known.has(id) ? `${baseUrl}/${known.get(id) === MIME_FOLDER ? 'folder' : 'file'}/${id}` : m));
}

/**
 * @param tenant   Tenant (lib/runtime) — новое, пустое предприятие
 * @param opts     { manifest: объект описи, zips: [Buffer], xlsx: Buffer|null, adminUrl?: string, log?: fn }
 * @returns отчёт { folders, files, books, docs, missing: [], props, links }
 */
function importGoogle(tenant, { manifest, zips = [], xlsx = null, adminUrl = '', log = () => {} }) {
  if (!manifest || !/^tsekh-cloud-export\//.test(manifest.format || '')) throw new Error('Это не опись ЦЕХ Стандарт (cloud-manifest.json из tools/google-export.gs)');
  const store = tenant.store;
  if (store.file(manifest.rootId)) throw new Error('Это предприятие уже содержит перенесённые данные: создайте новое предприятие для импорта');
  const entries = new Map();
  for (const z of zips) for (const [k, v] of readZip(z)) entries.set(k, v);
  const report = { folders: 0, files: 0, books: 0, docs: 0, missing: [], props: 0, links: 0 };
  const known = new Map(manifest.items.map((x) => [x.id, x.mime]));
  known.set(manifest.rootId, MIME_FOLDER);
  if (manifest.sheetId) known.set(manifest.sheetId, MIME_SHEET);

  // корневая папка предприятия с прежним ID, внутри «Моего диска» сервера
  store.addFile({ id: manifest.rootId, name: manifest.rootName, mime: MIME_FOLDER, parents: ['root'] });
  report.folders++;
  // папки — по порядку обхода: родитель всегда раньше вложенных
  for (const it of manifest.items.filter((x) => x.mime === MIME_FOLDER)) {
    store.addFile({ id: it.id, name: it.name, mime: MIME_FOLDER, parents: [it.parent] }); report.folders++;
  }

  const used = new Set(); // одно место в архиве — одному файлу описи (одинаковые имена в папке)
  const books = []; // книги переносятся после файлов, чтобы ссылки в них переписывались по полному списку ID
  for (const it of manifest.items.filter((x) => x.mime !== MIME_FOLDER)) {
    const at = locate(entries, it, used);
    if (!at) { report.missing.push(it.path); continue; }
    used.add(at);
    const bytes = entries.get(at)();
    if (it.mime === MIME_SHEET) { books.push({ id: it.id, name: it.name, parent: it.parent, bytes }); continue; }
    if (it.mime === MIME_DOC) {
      const blocks = htmlToBlocks(convert('docx', bytes).html);
      store.addFile({ id: it.id, name: it.name, mime: MIME_DOC, parents: [it.parent], bytes: Buffer.from(JSON.stringify({ blocks }), 'utf8'), descr: it.descr || '' });
      report.docs++; continue;
    }
    const mime = EXPORT_EXT[it.mime] ? (it.mime === 'application/vnd.google-apps.drawing' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation') : it.mime;
    store.addFile({ id: it.id, name: it.name, mime, parents: [it.parent], bytes, descr: it.descr || '' });
    report.files++;
  }
  if (manifest.sheetId && !manifest.sheetInRoot) {
    if (!xlsx) throw new Error('Таблица-база лежит вне корневой папки: передайте её выгрузку (--xlsx база.xlsx)');
    books.push({ id: manifest.sheetId, name: manifest.sheetName || 'ЦЕХ Стандарт — база', parent: manifest.rootId, bytes: xlsx });
  } else if (manifest.sheetId && xlsx) {
    const b = books.find((x) => x.id === manifest.sheetId); if (b) b.bytes = xlsx; // свежая выгрузка базы важнее копии из архива
  }
  for (const b of books) {
    const { sheets } = convert('xlsx', b.bytes);
    for (const s of sheets) s.rows = s.rows.map((row) => row.map((v) => { const w = rewriteLinks(v, known, tenant.baseUrl); if (w !== v) report.links++; return w; }));
    store.createBook(b.name, b.id, [b.parent]);
    store.setBookTz(b.id, manifest.timeZone || tenant.timeZone());
    store.replaceBookSheets(b.id, sheets);
    report.books++;
    log(`таблица «${b.name}»: листов ${sheets.length}`);
  }
  if (manifest.sheetId && !store.book(manifest.sheetId)) throw new Error(`Таблица-база (${manifest.sheetId}) не найдена в архивах: передайте её выгрузку (--xlsx база.xlsx)`);

  // свойства: как были в Google, кроме привязанных к проекту Google; режим и ID — на перенесённые объекты
  const props = {};
  for (const [k, v] of Object.entries(manifest.properties || {})) if (!DROP_PROPS.test(k)) props[k] = typeof v === 'string' ? rewriteLinks(v, known, tenant.baseUrl) : String(v);
  Object.assign(props, { TS_TENANT_ROOT_ID: manifest.rootId, TS2_ROOT_PARENT_ID: props.TS2_ROOT_PARENT_ID || manifest.rootId, TS_CLOUD: '1', MC_TZ: props.MC_TZ || manifest.timeZone || tenant.timeZone() });
  if (manifest.sheetId) { props.TS_TENANT_SHEET_ID = manifest.sheetId; if (!props.SHEET_ID || props.SHEET_ID === manifest.sheetId) props.SHEET_ID = manifest.sheetId; }
  if (!props.TS_ENTERPRISE_ID) props.TS_ENTERPRISE_ID = tenant.slug;
  if (!props.TS_TENANT_MODE) props.TS_TENANT_MODE = '1';
  if (adminUrl) props.TS_ADMIN_URL = adminUrl;
  store.setProps(props, true);
  report.props = Object.keys(props).length;
  return report;
}

module.exports = { importGoogle, readZip, locate, rewriteLinks };
