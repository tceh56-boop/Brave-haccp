'use strict';
/**
 * SpreadsheetApp поверх хранилища предприятия. Поведение — как у Google Таблиц в том объёме, который использует
 * ЦЕХ Стандарт: диапазоны по номерам и в нотации A1, getValues/setValues, appendRow, удаление и вставка строк,
 * сортировка, поиск текста. Оформление (цвета, ширина колонок, шрифты) в облаке не хранится — вызовы принимаются
 * и ничего не меняют, как если бы таблицу никто не открывал глазами.
 */
const { formatDate } = require('./utilities');

const MIME_SHEET = 'application/vnd.google-apps.spreadsheet';
const isDate = (v) => v instanceof Date || Object.prototype.toString.call(v) === '[object Date]';
const norm = (v) => {
  if (v === null || v === undefined) return '';
  if (isDate(v)) return new Date(v.getTime());
  if (typeof v === 'number' && !isFinite(v)) return '#NUM!';
  if (typeof v === 'object') return String(v);
  return v;
};
const copyOut = (v) => (isDate(v) ? new Date(v.getTime()) : v === undefined || v === null ? '' : v);

function colToNum(s) { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
function numToCol(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

/** Отображаемое значение ячейки: как Google показывает его на экране (дата — дд.ММ.гггг, число — без лишних нулей). */
function display(v, tz) {
  if (v === '' || v === null || v === undefined) return '';
  if (isDate(v)) {
    const hasTime = formatDate(v, tz, 'HH:mm:ss') !== '00:00:00';
    return formatDate(v, tz, hasTime ? 'dd.MM.yyyy H:mm:ss' : 'dd.MM.yyyy');
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(Math.round(v * 1e10) / 1e10).replace('.', ',');
  return String(v);
}

/** Строка из таблицы: ведущее '=' — формула. Формулы в облаке не вычисляются; храним текст как значение. */
const noFormat = new Set();

function chainable(obj, label) {
  // Методы оформления, которых нет в списке, принимаются молча и возвращают тот же объект (как setX…() в Google).
  return new Proxy(obj, {
    get(t, k) {
      if (k in t || typeof k === 'symbol') return t[k];
      if (/^(set|auto|hide|show|unhide|activate|insertCheckboxes|removeCheckboxes|applyRowBanding|clearFormat|clearNote|clearDataValidations|breakApart|trimWhitespace|setBorder|expand|collapse|group|ungroup|toast|setNote)/.test(k)) {
        if (!noFormat.has(label + '.' + k)) noFormat.add(label + '.' + k);
        return function () { return this; };
      }
      return undefined;
    },
  });
}

class Ctx {
  constructor(store, tenant) { this.store = store; this.tenant = tenant; }
}

class Range {
  constructor(sheet, row, col, nr, nc) {
    if (!(row >= 1) || !(col >= 1)) throw new Error(`Начальная строка или столбец диапазона слишком малы (${row}, ${col})`);
    if (!(nr >= 1) || !(nc >= 1)) throw new Error('Количество строк в диапазоне должно быть не меньше 1');
    this._s = sheet; this._r = row; this._c = col; this._nr = nr; this._nc = nc;
    return chainable(this, 'Range');
  }
  _data() { return this._s._d(); }
  getSheet() { return this._s; }
  getRow() { return this._r; }
  getRowIndex() { return this._r; }
  getColumn() { return this._c; }
  getColumnIndex() { return this._c; }
  getLastRow() { return this._r + this._nr - 1; }
  getLastColumn() { return this._c + this._nc - 1; }
  getNumRows() { return this._nr; }
  getNumColumns() { return this._nc; }
  getHeight() { return this._nr; }
  getWidth() { return this._nc; }
  getA1Notation() {
    const a = numToCol(this._c) + this._r;
    return this._nr === 1 && this._nc === 1 ? a : a + ':' + numToCol(this._c + this._nc - 1) + (this._r + this._nr - 1);
  }
  getValues() {
    const rows = this._data().rows; const out = [];
    for (let i = 0; i < this._nr; i++) {
      const src = rows[this._r - 1 + i] || []; const row = new Array(this._nc);
      for (let j = 0; j < this._nc; j++) row[j] = copyOut(src[this._c - 1 + j]);
      out.push(row);
    }
    return out;
  }
  getValue() { return copyOut((this._data().rows[this._r - 1] || [])[this._c - 1]); }
  getDisplayValues() { const tz = this._s._book.getSpreadsheetTimeZone(); return this.getValues().map((r) => r.map((v) => display(v, tz))); }
  getDisplayValue() { return display(this.getValue(), this._s._book.getSpreadsheetTimeZone()); }
  getFormulas() { return this.getValues().map((r) => r.map((v) => (typeof v === 'string' && v[0] === '=' ? v : ''))); }
  getFormula() { const v = this.getValue(); return typeof v === 'string' && v[0] === '=' ? v : ''; }
  getRichTextValue() { const v = this.getDisplayValue(); return { getText: () => v, getLinkUrl: () => null, getRuns: () => [] }; }
  getNote() { return ''; }
  getBackground() { return '#ffffff'; }
  getBackgrounds() { return this.getValues().map((r) => r.map(() => '#ffffff')); }
  getFontWeight() { return 'normal'; }
  getMergedRanges() { return []; }
  getDataValidation() { return null; }
  isBlank() { return this.getValues().every((r) => r.every((v) => v === '')); }
  _set(i, j, v) {
    const d = this._data(); const r = this._r - 1 + i;
    while (d.rows.length <= r) d.rows.push([]);
    const row = d.rows[r] || (d.rows[r] = []);
    const c = this._c - 1 + j;
    while (row.length < c) row.push('');
    row[c] = norm(v);
    d.dirty.add(r);
  }
  setValues(values) {
    if (!Array.isArray(values) || values.length !== this._nr) throw new Error(`Количество строк в данных (${values && values.length}) не соответствует диапазону (${this._nr})`);
    for (let i = 0; i < this._nr; i++) {
      if (!Array.isArray(values[i]) || values[i].length !== this._nc) throw new Error(`Количество столбцов в данных (${values[i] && values[i].length}) не соответствует диапазону (${this._nc})`);
      for (let j = 0; j < this._nc; j++) this._set(i, j, values[i][j]);
    }
    return this;
  }
  setValue(v) { for (let i = 0; i < this._nr; i++) for (let j = 0; j < this._nc; j++) this._set(i, j, v); return this; }
  setFormula(f) { return this.setValue(f); }
  setFormulas(f) { return this.setValues(f); }
  clearContent() { for (let i = 0; i < this._nr; i++) for (let j = 0; j < this._nc; j++) this._set(i, j, ''); return this; }
  clear() { return this.clearContent(); }
  offset(dr, dc, nr, nc) { return new Range(this._s, this._r + dr, this._c + dc, nr || this._nr, nc || this._nc); }
  getCell(r, c) { return new Range(this._s, this._r + r - 1, this._c + c - 1, 1, 1); }
  merge() { return this; }
  protect() { return protection(); }
  sort(spec) { this._s._sortRows(this._r, this._nr, this._c, this._nc, spec); return this; }
  createTextFinder(text) { return finder(this._s, text, this); }
  copyTo(dest) { const v = this.getValues(); dest.offset(0, 0, this._nr, this._nc).setValues(v); return this; }
  deleteCells() { return this.clearContent(); }
  activate() { return this; }
}

function protection() {
  const p = { setDescription: () => p, setWarningOnly: () => p, removeEditors: () => p, addEditor: () => p, addEditors: () => p, getEditors: () => [],
    canDomainEdit: () => false, setDomainEdit: () => p, remove: () => {}, getDescription: () => '', isWarningOnly: () => false, setUnprotectedRanges: () => p, getRange: () => null };
  return p;
}

function finder(sheet, text, within) {
  let opts = { matchCase: false, entire: false };
  let pos = -1; let hits = null;
  const f = {
    matchCase(b) { opts.matchCase = !!b; hits = null; return f; },
    matchEntireCell(b) { opts.entire = !!b; hits = null; return f; },
    matchFormulaText() { return f; }, useRegularExpression() { return f; }, ignoreDiacritics() { return f; },
    findAll() { compute(); return hits.map(([r, c]) => new Range(sheet, r, c, 1, 1)); },
    findNext() { compute(); pos++; return pos < hits.length ? new Range(sheet, hits[pos][0], hits[pos][1], 1, 1) : null; },
    replaceAllWith(rep) { compute(); hits.forEach(([r, c]) => { const rg = new Range(sheet, r, c, 1, 1); const v = String(rg.getValue()); rg.setValue(v.split(String(text)).join(rep)); }); return hits.length; },
  };
  function compute() {
    if (hits) return;
    hits = [];
    const tz = sheet._book.getSpreadsheetTimeZone();
    const rows = sheet._d().rows;
    const r0 = within ? within.getRow() : 1, c0 = within ? within.getColumn() : 1;
    const r1 = within ? within.getLastRow() : rows.length, c1 = within ? within.getLastColumn() : Infinity;
    const needle = opts.matchCase ? String(text) : String(text).toLowerCase();
    for (let r = r0; r <= Math.min(r1, rows.length); r++) {
      const row = rows[r - 1] || [];
      for (let c = c0; c <= Math.min(c1, row.length); c++) {
        let v = display(row[c - 1], tz); if (!opts.matchCase) v = v.toLowerCase();
        if (opts.entire ? v === needle : v.includes(needle)) hits.push([r, c]);
      }
    }
  }
  return f;
}

class Sheet {
  constructor(book, meta) {
    this._book = book; this._meta = meta;
    return chainable(this, 'Sheet');
  }
  _d() { return this._book._store.sheet(this._book._id, this._meta.sid); }
  getName() { return this._meta.name; }
  setName(n) { this._book._store.updateSheet(this._book._id, this._meta.sid, { name: String(n) }); this._meta.name = String(n); return this; }
  getSheetId() { return this._meta.sid; }
  getSheetName() { return this._meta.name; }
  getIndex() { return this._meta.idx + 1; }
  getParent() { return this._book; }
  getType() { return 'GRID'; }
  isSheetHidden() { return !!this._meta.hidden; }
  hideSheet() { this._book._store.updateSheet(this._book._id, this._meta.sid, { hidden: 1 }); this._meta.hidden = 1; return this; }
  showSheet() { this._book._store.updateSheet(this._book._id, this._meta.sid, { hidden: 0 }); this._meta.hidden = 0; return this; }
  getLastRow() {
    const rows = this._d().rows;
    for (let r = rows.length - 1; r >= 0; r--) if ((rows[r] || []).some((v) => v !== '' && v !== null && v !== undefined)) return r + 1;
    return 0;
  }
  getLastColumn() {
    let m = 0;
    for (const row of this._d().rows) if (row) for (let c = row.length - 1; c >= m; c--) if (row[c] !== '' && row[c] !== null && row[c] !== undefined) { m = c + 1; break; }
    return m;
  }
  getMaxRows() { return Math.max(1000, this._d().rows.length); }
  getMaxColumns() { return Math.max(26, this.getLastColumn()); }
  getFrozenRows() { return this._meta.frozen || 0; }
  setFrozenRows(n) { this._book._store.updateSheet(this._book._id, this._meta.sid, { frozen: Number(n) || 0 }); this._meta.frozen = Number(n) || 0; return this; }
  getFrozenColumns() { return 0; }
  getRange(a, b, c, d) {
    if (typeof a === 'string') return this._a1(a);
    return new Range(this, Number(a), Number(b), c === undefined ? 1 : Number(c), d === undefined ? 1 : Number(d));
  }
  getRangeList(list) { const rs = list.map((x) => this._a1(x)); return { getRanges: () => rs, clearContent() { rs.forEach((r) => r.clearContent()); return this; }, setValue(v) { rs.forEach((r) => r.setValue(v)); return this; } }; }
  _a1(s) {
    const str = String(s).replace(/^.*!/, '').replace(/\$/g, '').trim();
    const m = /^([A-Za-z]*)(\d*)(?::([A-Za-z]*)(\d*))?$/.exec(str);
    if (!m) throw new Error('Диапазон не найден: ' + s);
    const lastRow = Math.max(this.getLastRow(), 1), lastCol = Math.max(this.getLastColumn(), 1);
    const c1 = m[1] ? colToNum(m[1]) : 1, r1 = m[2] ? Number(m[2]) : 1;
    if (m[3] === undefined) return new Range(this, r1, c1, 1, 1);
    const c2 = m[3] ? colToNum(m[3]) : Math.max(lastCol, c1), r2 = m[4] ? Number(m[4]) : Math.max(this.getMaxRows(), r1);
    return new Range(this, Math.min(r1, r2), Math.min(c1, c2), Math.abs(r2 - r1) + 1, Math.abs(c2 - c1) + 1);
  }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  appendRow(row) {
    if (!Array.isArray(row)) throw new Error('appendRow: нужен массив значений');
    const d = this._d(); const r = this.getLastRow();
    d.rows.length = Math.max(d.rows.length, r);
    d.rows[r] = row.map(norm);
    d.dirty.add(r);
    return this;
  }
  _shift(fn) { const d = this._d(); fn(d.rows); for (let i = 0; i < d.rows.length; i++) if (!d.rows[i]) d.rows[i] = []; d.rewrite = true; }
  deleteRow(r) { this._shift((rows) => rows.splice(r - 1, 1)); return this; }
  deleteRows(r, n) { this._shift((rows) => rows.splice(r - 1, n)); return this; }
  insertRowBefore(r) { this._shift((rows) => rows.splice(r - 1, 0, [])); return this; }
  insertRowAfter(r) { this._shift((rows) => rows.splice(r, 0, [])); return this; }
  insertRowsBefore(r, n) { this._shift((rows) => rows.splice(r - 1, 0, ...Array.from({ length: n }, () => []))); return this; }
  insertRowsAfter(r, n) { this._shift((rows) => rows.splice(r, 0, ...Array.from({ length: n }, () => []))); return this; }
  insertRows(r, n = 1) { return this.insertRowsBefore(r, n); }
  deleteColumn(c) { this._shift((rows) => rows.forEach((row) => row && row.splice(c - 1, 1))); return this; }
  deleteColumns(c, n) { this._shift((rows) => rows.forEach((row) => row && row.splice(c - 1, n))); return this; }
  insertColumnAfter(c) { this._shift((rows) => rows.forEach((row) => row && row.length > c && row.splice(c, 0, ''))); return this; }
  insertColumnBefore(c) { this._shift((rows) => rows.forEach((row) => row && row.length >= c && row.splice(c - 1, 0, ''))); return this; }
  insertColumnsAfter(c, n) { this._shift((rows) => rows.forEach((row) => row && row.length > c && row.splice(c, 0, ...Array(n).fill('')))); return this; }
  clear() { this._shift((rows) => { rows.length = 0; }); return this; }
  clearContents() { return this.clear(); }
  clearFormats() { return this; }
  sort(col, asc = true) { const last = this.getLastRow(); const from = (this._meta.frozen || 0) + 1; if (last >= from) this._sortRows(from, last - from + 1, 1, Math.max(1, this.getLastColumn()), [{ column: col, ascending: asc }]); return this; }
  _sortRows(r, nr, c, nc, spec) {
    const specs = (Array.isArray(spec) ? spec : [spec]).map((s) => (typeof s === 'number' ? { column: s, ascending: true } : { column: s.column, ascending: s.ascending !== false }));
    const d = this._d();
    const block = d.rows.slice(r - 1, r - 1 + nr).map((row) => (row || []).slice(c - 1, c - 1 + nc));
    const cmp = (a, b) => {
      for (const s of specs) {
        const i = s.column - c; let x = a[i], y = b[i];
        if (isDate(x)) x = x.getTime(); if (isDate(y)) y = y.getTime();
        const ex = x === '' || x === undefined, ey = y === '' || y === undefined;
        if (ex !== ey) return ex ? 1 : -1; // пустые — в конце, как в Google
        if (x === y) continue;
        const res = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ru');
        if (res) return s.ascending ? res : -res;
      }
      return 0;
    };
    block.sort(cmp);
    block.forEach((vals, i) => { const row = d.rows[r - 1 + i] || (d.rows[r - 1 + i] = []); for (let j = 0; j < nc; j++) row[c - 1 + j] = vals[j] === undefined ? '' : vals[j]; d.dirty.add(r - 1 + i); });
  }
  createTextFinder(text) { return finder(this, text, null); }
  protect() { return protection(); }
  getProtections() { return []; }
  copyTo(book) { const s = book.insertSheet('Копия ' + this.getName()); s._d().rows = this._d().rows.map((r) => r.slice()); s._d().rewrite = true; return s; }
  activate() { return this; }
  getCharts() { return []; }
  getNamedRanges() { return []; }
  getDataRegion() { return this.getDataRange(); }
}

class Spreadsheet {
  constructor(app, id) {
    this._app = app; this._store = app.store; this._id = id;
    return chainable(this, 'Spreadsheet');
  }
  _metas() {
    if (!this._app.metaCache.has(this._id)) this._app.metaCache.set(this._id, this._store.sheetsOf(this._id));
    return this._app.metaCache.get(this._id);
  }
  _reset() { this._app.metaCache.delete(this._id); }
  getId() { return this._id; }
  getName() { const b = this._store.book(this._id); return b ? b.name : ''; }
  rename(n) { this._store.renameBook(this._id, String(n)); return this; }
  getUrl() { return `${this._app.tenant.baseUrl}/sheet/${this._id}`; }
  getSpreadsheetTimeZone() { const b = this._store.book(this._id); return (b && b.tz) || this._app.tenant.timeZone(); }
  setSpreadsheetTimeZone(tz) { this._store.setBookTz(this._id, tz); return this; }
  getSpreadsheetLocale() { return 'ru_RU'; }
  getSheets() { return this._metas().map((m) => new Sheet(this, m)); }
  getNumSheets() { return this._metas().length; }
  getSheetByName(n) { const m = this._metas().find((x) => x.name === String(n)); return m ? new Sheet(this, m) : null; }
  getSheetById(id) { const m = this._metas().find((x) => x.sid === Number(id)); return m ? new Sheet(this, m) : null; }
  getActiveSheet() { const m = this._metas()[0]; return m ? new Sheet(this, m) : null; }
  getSheet() { return this.getActiveSheet(); }
  insertSheet(name, idx) {
    let n = typeof name === 'string' ? name : null;
    if (typeof name === 'number') { idx = name; n = null; }
    if (!n) { let i = this._metas().length + 1; while (this.getSheetByName('Лист' + i)) i++; n = 'Лист' + i; }
    if (this.getSheetByName(n)) throw new Error(`Лист с названием «${n}» уже существует. Введите другое название.`);
    this._store.insertSheet(this._id, n, idx);
    this._reset();
    return this.getSheetByName(n);
  }
  deleteSheet(sheet) { this._store.deleteSheet(this._id, sheet.getSheetId()); this._reset(); }
  setActiveSheet(s) { return s; }
  getRange(a1) { const m = /^'?(.+?)'?!(.+)$/.exec(String(a1)); const sh = m ? this.getSheetByName(m[1]) : this.getActiveSheet(); return sh.getRange(m ? m[2] : a1); }
  getRangeByName() { return null; }
  getOwner() { return this._app.tenant.user(); }
  getEditors() { return [this._app.tenant.user()]; }
  getViewers() { return []; }
  addEditor() { return this; }
  addEditors() { return this; }
  removeEditor() { return this; }
  addViewer() { return this; }
  copy(name) { return new Spreadsheet(this._app, this._store.copyBook(this._id, String(name || 'Копия ' + this.getName()), [])); }
  getProtections() { return []; }
  toast() { return this; }
  getBlob() { return this._app.exportCsvBlob(this); }
  getAs(type) { return this.getBlob().getAs(type); }
}

function makeSpreadsheetApp(tenant) {
  const app = { store: tenant.store, tenant, metaCache: new Map() };
  app.exportCsvBlob = (book) => {
    // «Скачать таблицу»: CSV первого листа (xlsx в облаке не собирается)
    const { Blob } = require('./blob');
    const sh = book.getSheets()[0];
    const v = sh ? sh.getDataRange().getDisplayValues() : [];
    const csv = v.map((r) => r.map((x) => (/[",\n;]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x)).join(';')).join('\n');
    return new Blob('﻿' + csv, 'text/csv', book.getName() + '.csv');
  };
  const open = (id) => {
    const sid = String(id || '').trim();
    if (!sid || !tenant.store.book(sid)) throw new Error(`Таблица не найдена или нет доступа (ID ${sid || 'пустой'})`);
    return new Spreadsheet(app, sid);
  };
  const SA = {
    openById: open,
    openByUrl: (url) => { const m = /\/(?:sheet|d)\/([A-Za-z0-9_-]+)/.exec(String(url)); return open(m ? m[1] : url); },
    open: (file) => open(file.getId()),
    create: (name) => new Spreadsheet(app, tenant.store.createBook(String(name || 'Без названия'))),
    getActiveSpreadsheet: () => { const id = tenant.mainBookId(); return id ? open(id) : null; },
    getActive: () => SA.getActiveSpreadsheet(),
    getActiveSheet: () => { const b = SA.getActiveSpreadsheet(); return b ? b.getActiveSheet() : null; },
    getUi: () => { throw new Error('Меню и окна таблицы недоступны: система работает как веб-приложение'); },
    flush: () => tenant.store.flush(),
    newDataValidation: () => { const b = new Proxy({}, { get: (t, k) => (k === 'build' ? () => ({}) : () => b) }); return b; },
    newRichTextValue: () => { const b = new Proxy({}, { get: (t, k) => (k === 'build' ? () => ({}) : () => b) }); return b; },
    newTextStyle: () => { const b = new Proxy({}, { get: (t, k) => (k === 'build' ? () => ({}) : () => b) }); return b; },
    newConditionalFormatRule: () => { const b = new Proxy({}, { get: (t, k) => (k === 'build' ? () => ({}) : () => b) }); return b; },
    ProtectionType: { RANGE: 'RANGE', SHEET: 'SHEET' },
    BorderStyle: { SOLID: 'SOLID', SOLID_MEDIUM: 'SOLID_MEDIUM', SOLID_THICK: 'SOLID_THICK', DOTTED: 'DOTTED', DASHED: 'DASHED', DOUBLE: 'DOUBLE' },
    WrapStrategy: { WRAP: 'WRAP', CLIP: 'CLIP', OVERFLOW: 'OVERFLOW' },
    DataValidationCriteria: {}, SheetType: { GRID: 'GRID' }, Dimension: { ROWS: 'ROWS', COLUMNS: 'COLUMNS' },
    CopyPasteType: { PASTE_VALUES: 'PASTE_VALUES', PASTE_NORMAL: 'PASTE_NORMAL' },
  };
  return SA;
}

module.exports = { makeSpreadsheetApp, MIME_SHEET, display, colToNum, numToCol, unsupportedFormatting: noFormat };
