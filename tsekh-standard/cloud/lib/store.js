'use strict';
/**
 * Хранилище одного предприятия: файл SQLite (по файлу на предприятие — та же изоляция, что «своя таблица и свой проект»
 * в Google). Здесь лежит всё, что в Apps Script держал Google: листы таблиц, свойства скрипта, кэш, триггеры,
 * метаданные файлов Диска, очередь писем. Сами файлы Диска — в папке рядом (drive/).
 *
 * Код Apps Script синхронный, поэтому и хранилище синхронное (better-sqlite3): лист читается из базы один раз и
 * дальше живёт в памяти процесса; изменённые строки записываются в конце каждого выполнения (flush).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const SCHEMA = `
create table if not exists props (k text primary key, v text not null);
create table if not exists cache (k text primary key, v text not null, exp integer not null);
create table if not exists books (id text primary key, name text not null, tz text, created integer not null);
create table if not exists sheets (book text not null, sid integer not null, name text not null, idx integer not null,
  frozen integer not null default 0, hidden integer not null default 0, primary key (book, sid));
create table if not exists cells (book text not null, sid integer not null, r integer not null, v text not null,
  primary key (book, sid, r));
create table if not exists files (id text primary key, name text not null, mime text not null, parents text not null default '[]',
  trashed integer not null default 0, size integer not null default 0, descr text not null default '',
  created integer not null, updated integer not null, starred integer not null default 0);
create table if not exists triggers (id text primary key, handler text not null, kind text not null, spec text not null,
  created integer not null, last_run integer, last_error text);
create table if not exists outbox (id integer primary key autoincrement, msg text not null, created integer not null,
  sent integer, attempts integer not null default 0, error text);
create table if not exists log (id integer primary key autoincrement, at integer not null, level text not null, msg text not null);
`;

/** Значения ячеек: дата хранится как {"$d": миллисекунды}, остальное — как есть (строка, число, логическое). */
function encodeRow(row) {
  return JSON.stringify((row || []).map((v) => {
    if (v instanceof Date || Object.prototype.toString.call(v) === '[object Date]') return { $d: v.getTime() };
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return String(v);
    return v;
  }));
}
function decodeRow(s) {
  return JSON.parse(s).map((v) => (v && typeof v === 'object' && '$d' in v ? new Date(v.$d) : v));
}

class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(path.join(dir, 'drive'), { recursive: true });
    this.db = new Database(path.join(dir, 'tenant.sqlite'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(SCHEMA);
    this.sheetData = new Map(); // `${book}/${sid}` → { rows: [][], dirty: Set<number>, rewrite: bool }
    this.q = {
      getProp: this.db.prepare('select v from props where k = ?'),
      setProp: this.db.prepare('insert into props (k, v) values (?, ?) on conflict (k) do update set v = excluded.v'),
      delProp: this.db.prepare('delete from props where k = ?'),
      allProps: this.db.prepare('select k, v from props'),
      rows: this.db.prepare('select r, v from cells where book = ? and sid = ? order by r'),
      putRow: this.db.prepare('insert into cells (book, sid, r, v) values (?, ?, ?, ?) on conflict (book, sid, r) do update set v = excluded.v'),
      delRow: this.db.prepare('delete from cells where book = ? and sid = ? and r = ?'),
      delRowsFrom: this.db.prepare('delete from cells where book = ? and sid = ? and r >= ?'),
      delSheetRows: this.db.prepare('delete from cells where book = ? and sid = ?'),
    };
  }

  close() { this.flush(); this.db.close(); }

  static newId(len = 44) {
    // как у Google Диска: длинный случайный идентификатор, его нельзя подобрать
    return crypto.randomBytes(Math.ceil(len * 0.75)).toString('base64url').slice(0, len);
  }

  /* ---------- свойства и кэш ---------- */
  prop(k) { const r = this.q.getProp.get(k); return r ? r.v : null; }
  setProp(k, v) { this.q.setProp.run(k, String(v)); }
  delProp(k) { this.q.delProp.run(k); }
  props() { const o = {}; for (const r of this.q.allProps.all()) o[r.k] = r.v; return o; }
  setProps(obj, deleteOthers) {
    this.db.transaction(() => {
      if (deleteOthers) this.db.prepare('delete from props').run();
      for (const k of Object.keys(obj)) this.setProp(k, obj[k]);
    })();
  }

  cacheGet(k) {
    const r = this.db.prepare('select v, exp from cache where k = ?').get(k);
    if (!r) return null;
    if (r.exp < Date.now()) { this.db.prepare('delete from cache where k = ?').run(k); return null; }
    return r.v;
  }
  cachePut(k, v, ttlSec) {
    const ttl = Math.min(Math.max(Number(ttlSec) || 600, 1), 21600) * 1000; // как в Apps Script: по умолчанию 10 мин, максимум 6 ч
    this.db.prepare('insert into cache (k, v, exp) values (?, ?, ?) on conflict (k) do update set v = excluded.v, exp = excluded.exp')
      .run(k, String(v), Date.now() + ttl);
  }
  cacheRemove(k) { this.db.prepare('delete from cache where k = ?').run(k); }

  /* ---------- книги (таблицы) и листы ---------- */
  book(id) { return this.db.prepare('select * from books where id = ?').get(id) || null; }
  createBook(name, id = Store.newId(), parents = []) {
    const now = Date.now();
    this.db.prepare('insert into books (id, name, tz, created) values (?, ?, ?, ?)').run(id, name, null, now);
    this.db.prepare('insert or ignore into files (id, name, mime, parents, created, updated) values (?, ?, ?, ?, ?, ?)')
      .run(id, name, 'application/vnd.google-apps.spreadsheet', JSON.stringify(parents), now, now);
    this.insertSheet(id, 'Лист1', 0);
    return id;
  }
  /** Заменить листы книги готовыми данными (конвертация Excel, импорт из Google): [{ name, rows }], даты — Date или {$d: мс}. */
  replaceBookSheets(book, sheets) {
    this.db.transaction(() => {
      this.db.prepare('delete from sheets where book = ?').run(book);
      this.db.prepare('delete from cells where book = ?').run(book);
      const ins = this.db.prepare('insert into cells (book, sid, r, v) values (?, ?, ?, ?)');
      sheets.forEach((s, i) => {
        this.db.prepare('insert into sheets (book, sid, name, idx) values (?, ?, ?, ?)').run(book, i, s.name || 'Лист' + (i + 1), i);
        s.rows.forEach((row, r) => { if (row && row.length) ins.run(book, i, r, encodeRow(row.map((v) => (v && v.$d !== undefined ? new Date(v.$d) : v)))); });
      });
    })();
    for (const k of [...this.sheetData.keys()]) if (k.startsWith(book + '/')) this.sheetData.delete(k);
  }
  renameBook(id, name) {
    this.db.prepare('update books set name = ? where id = ?').run(name, id);
    this.db.prepare('update files set name = ?, updated = ? where id = ?').run(name, Date.now(), id);
  }
  setBookTz(id, tz) { this.db.prepare('update books set tz = ? where id = ?').run(tz, id); }
  copyBook(srcId, name, parents) {
    this.flush();
    const id = Store.newId();
    const now = Date.now();
    this.db.transaction(() => {
      const src = this.book(srcId);
      this.db.prepare('insert into books (id, name, tz, created) values (?, ?, ?, ?)').run(id, name, src && src.tz, now);
      this.db.prepare('insert into files (id, name, mime, parents, created, updated) values (?, ?, ?, ?, ?, ?)')
        .run(id, name, 'application/vnd.google-apps.spreadsheet', JSON.stringify(parents || []), now, now);
      this.db.prepare('insert into sheets (book, sid, name, idx, frozen, hidden) select ?, sid, name, idx, frozen, hidden from sheets where book = ?').run(id, srcId);
      this.db.prepare('insert into cells (book, sid, r, v) select ?, sid, r, v from cells where book = ?').run(id, srcId);
    })();
    return id;
  }
  sheetsOf(book) { return this.db.prepare('select * from sheets where book = ? order by idx').all(book); }
  insertSheet(book, name, idx) {
    const max = this.db.prepare('select coalesce(max(sid), -1) m, count(*) n from sheets where book = ?').get(book);
    const sid = max.m + 1; // 0, 1, 2… как gid листа в Google
    const pos = idx === undefined || idx === null ? max.n : Math.max(0, Math.min(Number(idx), max.n));
    this.db.transaction(() => {
      this.db.prepare('update sheets set idx = idx + 1 where book = ? and idx >= ?').run(book, pos);
      this.db.prepare('insert into sheets (book, sid, name, idx) values (?, ?, ?, ?)').run(book, sid, name, pos);
    })();
    this.sheetData.set(`${book}/${sid}`, { rows: [], dirty: new Set(), rewrite: false });
    return sid;
  }
  deleteSheet(book, sid) {
    this.db.transaction(() => {
      const s = this.db.prepare('select idx from sheets where book = ? and sid = ?').get(book, sid);
      this.db.prepare('delete from sheets where book = ? and sid = ?').run(book, sid);
      this.q.delSheetRows.run(book, sid);
      if (s) this.db.prepare('update sheets set idx = idx - 1 where book = ? and idx > ?').run(book, s.idx);
    })();
    this.sheetData.delete(`${book}/${sid}`);
  }
  updateSheet(book, sid, fields) {
    for (const k of Object.keys(fields)) {
      if (!['name', 'idx', 'frozen', 'hidden'].includes(k)) continue;
      this.db.prepare(`update sheets set ${k} = ? where book = ? and sid = ?`).run(fields[k], book, sid);
    }
  }

  /** Данные листа в памяти: массив строк (строка — массив значений). */
  sheet(book, sid) {
    const key = `${book}/${sid}`;
    let d = this.sheetData.get(key);
    if (!d) {
      const rows = [];
      for (const r of this.q.rows.all(book, sid)) rows[r.r] = decodeRow(r.v);
      for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
      d = { rows, dirty: new Set(), rewrite: false };
      this.sheetData.set(key, d);
    }
    return d;
  }

  /** Записывает изменённые строки всех листов. Вызывается в конце каждого выполнения и при SpreadsheetApp.flush(). */
  flush() {
    const work = [];
    for (const [key, d] of this.sheetData) if (d.rewrite || d.dirty.size) work.push([key, d]);
    if (!work.length) return;
    this.db.transaction(() => {
      for (const [key, d] of work) {
        const i = key.indexOf('/');
        const book = key.slice(0, i);
        const sid = Number(key.slice(i + 1));
        // хвостовые пустые строки не храним
        let n = d.rows.length;
        while (n > 0 && !(d.rows[n - 1] || []).some((v) => v !== '' && v !== null && v !== undefined)) n--;
        d.rows.length = n;
        if (d.rewrite) {
          this.q.delSheetRows.run(book, sid);
          for (let r = 0; r < n; r++) this.q.putRow.run(book, sid, r, encodeRow(d.rows[r]));
        } else {
          for (const r of d.dirty) {
            if (r >= n) this.q.delRow.run(book, sid, r);
            else this.q.putRow.run(book, sid, r, encodeRow(d.rows[r]));
          }
          this.q.delRowsFrom.run(book, sid, n);
        }
        d.dirty.clear();
        d.rewrite = false;
      }
    })();
  }

  /* ---------- файлы Диска ---------- */
  file(id) {
    const f = this.db.prepare('select * from files where id = ?').get(id);
    return f ? { ...f, parents: JSON.parse(f.parents) } : null;
  }
  filesWhere(where, ...args) {
    return this.db.prepare(`select * from files where ${where} order by created`).all(...args).map((f) => ({ ...f, parents: JSON.parse(f.parents) }));
  }
  addFile({ id = Store.newId(), name, mime, parents = [], bytes = null, descr = '' }) {
    const now = Date.now();
    this.db.prepare('insert into files (id, name, mime, parents, size, descr, created, updated) values (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, String(name), String(mime), JSON.stringify(parents), bytes ? bytes.length : 0, descr, now, now);
    if (bytes) fs.writeFileSync(this.blobPath(id), bytes);
    return id;
  }
  updateFile(id, fields) {
    const sets = [];
    const args = [];
    for (const k of ['name', 'mime', 'trashed', 'descr', 'starred', 'size']) if (k in fields) { sets.push(`${k} = ?`); args.push(fields[k]); }
    if ('parents' in fields) { sets.push('parents = ?'); args.push(JSON.stringify(fields.parents)); }
    sets.push('updated = ?'); args.push(Date.now());
    this.db.prepare(`update files set ${sets.join(', ')} where id = ?`).run(...args, id);
  }
  deleteFile(id) {
    this.db.prepare('delete from files where id = ?').run(id);
    try { fs.unlinkSync(this.blobPath(id)); } catch (e) { /* файла могло не быть */ }
  }
  blobPath(id) { return path.join(this.dir, 'drive', id.replace(/[^A-Za-z0-9_-]/g, '_')); }
  readBlob(id) { try { return fs.readFileSync(this.blobPath(id)); } catch (e) { return Buffer.alloc(0); } }
  writeBlob(id, bytes) {
    fs.writeFileSync(this.blobPath(id), bytes);
    this.db.prepare('update files set size = ?, updated = ? where id = ?').run(bytes.length, Date.now(), id);
  }

  /* ---------- триггеры, почта, журнал ---------- */
  triggers() { return this.db.prepare('select * from triggers order by created').all().map((t) => ({ ...t, spec: JSON.parse(t.spec) })); }
  addTrigger(handler, kind, spec) {
    const id = String(Date.now()) + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
    this.db.prepare('insert into triggers (id, handler, kind, spec, created) values (?, ?, ?, ?, ?)').run(id, handler, kind, JSON.stringify(spec), Date.now());
    return id;
  }
  deleteTrigger(id) { this.db.prepare('delete from triggers where id = ?').run(id); }
  triggerRan(id, error) { this.db.prepare('update triggers set last_run = ?, last_error = ? where id = ?').run(Date.now(), error || null, id); }

  queueMail(msg) { this.db.prepare('insert into outbox (msg, created) values (?, ?)').run(JSON.stringify(msg), Date.now()); }
  mailSentToday() {
    const day = new Date(); day.setHours(0, 0, 0, 0);
    return this.db.prepare('select count(*) n from outbox where created >= ?').get(day.getTime()).n;
  }
  pendingMail(limit = 20) { return this.db.prepare('select * from outbox where sent is null and attempts < 8 order by id limit ?').all(limit); }
  mailDone(id, error) {
    if (error) this.db.prepare('update outbox set attempts = attempts + 1, error = ? where id = ?').run(String(error).slice(0, 500), id);
    else this.db.prepare('update outbox set sent = ?, error = null where id = ?').run(Date.now(), id);
  }

  log(level, msg) {
    this.db.prepare('insert into log (at, level, msg) values (?, ?, ?)').run(Date.now(), level, String(msg).slice(0, 4000));
  }
}

module.exports = { Store, encodeRow, decodeRow };
