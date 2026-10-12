// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * Листы, свойства, кэш и блокировка Apps Script поверх PostgreSQL.
 *
 * Этап 1 переноса: Database.gs и весь код ЦЕХ работают как с Google-таблицей — лист,
 * строка, ячейки. Каждая строка листа хранится в tsekh_rows (sheet, row_no, vals jsonb).
 * Это повторяет поведение таблицы один в один, поэтому все тесты ЦЕХ проходят без правок.
 * Этап 2 — нормальные таблицы с индексами — делается уже под этой прослойкой.
 */

const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS tsekh_sheets (name text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS tsekh_rows (
     sheet text NOT NULL REFERENCES tsekh_sheets(name) ON UPDATE CASCADE ON DELETE CASCADE,
     row_no integer NOT NULL,
     vals jsonb NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT tsekh_rows_pk PRIMARY KEY (sheet, row_no))`,
  `CREATE TABLE IF NOT EXISTS tsekh_props (key text PRIMARY KEY, value text NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS tsekh_mail (id bigserial PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), recipient text, subject text, body text, status text NOT NULL DEFAULT 'к_отправке')`
];

const LOCK_KEY = 4127001; // общий ключ блокировки записи (аналог LockService.getScriptLock)

function encodeCell(v) {
  if (v instanceof Date) return { $d: v.toISOString() };
  if (v === undefined || v === null) return '';
  return v;
}
function decodeCell(v) {
  if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.$d === 'string') return new Date(v.$d);
  return v;
}
function colLetter(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s || 'A'; }

function createStore(db) {
  function rowsOf(name) {
    const data = [];
    db.query('SELECT row_no, vals FROM tsekh_rows WHERE sheet = $1 ORDER BY row_no', [name])
      .forEach(r => { data[r.row_no - 1] = r.vals.map(decodeCell); });
    for (let i = 0; i < data.length; i++) if (!data[i]) data[i] = [];
    return data;
  }
  function padded(data) {
    const w = data.reduce((m, r) => Math.max(m, r.length), 0);
    return data.map(r => { const o = r.slice(); while (o.length < w) o.push(''); return o; });
  }
  function readRows(name, from, count) {
    const out = {};
    db.query('SELECT row_no, vals FROM tsekh_rows WHERE sheet = $1 AND row_no >= $2 AND row_no < $3', [name, from, from + count])
      .forEach(r => { out[r.row_no] = r.vals.map(decodeCell); });
    return out;
  }
  function writeRows(name, rows) {
    db.batch(Object.keys(rows).map(no => ({
      sql: `INSERT INTO tsekh_rows (sheet, row_no, vals) VALUES ($1, $2, $3::jsonb)
            ON CONFLICT ON CONSTRAINT tsekh_rows_pk DO UPDATE SET vals = EXCLUDED.vals, updated_at = now()`,
      params: [name, Number(no), JSON.stringify(rows[no].map(encodeCell))]
    })));
  }

  function makeRange(sheet, r, c, nr, nc) {
    nr = nr || 1; nc = nc || 1;
    const range = {
      getValues() {
        const rows = readRows(sheet.name, r, nr), out = [];
        for (let i = 0; i < nr; i++) {
          const row = rows[r + i] || [], o = [];
          for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]);
          out.push(o);
        }
        return out;
      },
      setValues(values) {
        if (!Array.isArray(values) || values.length !== nr) throw new Error('Число строк данных не совпадает с размером диапазона.');
        const rows = readRows(sheet.name, r, nr);
        values.forEach((vals, i) => {
          const row = (rows[r + i] || []).slice();
          while (row.length < c - 1) row.push('');
          vals.forEach((v, j) => { row[c - 1 + j] = v; });
          rows[r + i] = row;
        });
        writeRows(sheet.name, rows);
        return range;
      },
      getValue() { return range.getValues()[0][0]; },
      setValue(v) { return range.setValues([[v]]); },
      getA1Notation() { return colLetter(c) + r + (nr > 1 || nc > 1 ? ':' + colLetter(c + nc - 1) + (r + nr - 1) : ''); },
      setFontWeight() { return range; }, setBackground() { return range; }, setNumberFormat() { return range; }, setFontColor() { return range; },
      clearContent() { return range.setValues(Array.from({ length: nr }, () => Array.from({ length: nc }, () => ''))); }
    };
    return range;
  }

  function makeSheet(name) {
    const sheet = {
      name,
      getName: () => sheet.name,
      getSheetId: () => sheet.name,
      getDataRange() {
        const data = padded(rowsOf(sheet.name));
        return { getValues: () => data.map(r => r.slice()),
          getA1Notation: () => data.length ? 'A1:' + colLetter((data[0] || []).length || 1) + data.length : 'A1' };
      },
      appendRow(row) {
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            db.query(`INSERT INTO tsekh_rows (sheet, row_no, vals)
                      SELECT $1, COALESCE(MAX(row_no), 0) + 1, $2::jsonb FROM tsekh_rows WHERE sheet = $1`, [sheet.name, JSON.stringify(row.map(encodeCell))]);
            return sheet;
          } catch (e) { if (e.code !== '23505' || attempt === 4) throw e; }
        }
        return sheet;
      },
      getRange(r, c, nr, nc) {
        if (typeof r === 'string') {
          const m = /^([A-Z]+)(\d+)$/.exec(r.trim().toUpperCase());
          if (!m) throw new Error('Диапазон ' + r + ' не поддерживается.');
          const col = m[1].split('').reduce((s, ch) => s * 26 + ch.charCodeAt(0) - 64, 0);
          return makeRange(sheet, Number(m[2]), col, 1, 1);
        }
        return makeRange(sheet, r, c, nr, nc);
      },
      getLastRow() { return Number(db.query('SELECT COALESCE(MAX(row_no), 0) AS n FROM tsekh_rows WHERE sheet = $1', [sheet.name])[0].n); },
      getLastColumn() { return Number(db.query('SELECT COALESCE(MAX(jsonb_array_length(vals)), 0) AS n FROM tsekh_rows WHERE sheet = $1', [sheet.name])[0].n); },
      deleteRows(start, count) {
        db.batch([
          { sql: 'DELETE FROM tsekh_rows WHERE sheet = $1 AND row_no >= $2 AND row_no < $3', params: [sheet.name, start, start + count] },
          // Сдвиг в два шага через отрицательные номера: ключ (sheet, row_no) не конфликтует посреди UPDATE.
          { sql: 'UPDATE tsekh_rows SET row_no = -(row_no - $3) WHERE sheet = $1 AND row_no >= $2', params: [sheet.name, start + count, count] },
          { sql: 'UPDATE tsekh_rows SET row_no = -row_no WHERE sheet = $1 AND row_no < 0', params: [sheet.name] }
        ]);
      },
      deleteRow(r) { sheet.deleteRows(r, 1); },
      clear() { db.query('DELETE FROM tsekh_rows WHERE sheet = $1', [sheet.name]); return sheet; },
      setName(n) { db.query('UPDATE tsekh_sheets SET name = $2 WHERE name = $1', [sheet.name, n]); sheet.name = n; return sheet; },
      setFrozenRows() {}, autoResizeColumns() {}, setColumnWidth() {}, hideSheet() {}
    };
    return sheet;
  }

  const spreadsheet = {
    getId: () => 'pg', getUrl: () => '', getName: () => 'ЦЕХ',
    getSheetByName(n) { return db.query('SELECT 1 FROM tsekh_sheets WHERE name = $1', [n]).length ? makeSheet(n) : null; },
    insertSheet(n) { db.query('INSERT INTO tsekh_sheets (name) VALUES ($1) ON CONFLICT DO NOTHING', [n]); return makeSheet(n); },
    getSheets() { return db.query('SELECT name FROM tsekh_sheets ORDER BY created_at, name').map(r => makeSheet(r.name)); },
    deleteSheet(sh) { db.query('DELETE FROM tsekh_sheets WHERE name = $1', [sh.name || sh]); }
  };

  // Свойства скрипта — в базе (общие для всех экземпляров), с памятью на время запроса.
  // Секреты (ключи API, токены) в базу не кладутся: переменная окружения TSEKH_PROP_<ИМЯ>
  // (в Yandex Cloud её заполняет Lockbox) перекрывает значение из базы.
  const envProps = {};
  Object.keys(process.env).forEach(k => { if (k.indexOf('TSEKH_PROP_') === 0) envProps[k.slice(11)] = process.env[k]; });
  let propsMemo = null;
  const properties = {
    getProperty(k) { if (Object.prototype.hasOwnProperty.call(envProps, k)) return envProps[k]; if (!propsMemo) properties.getProperties(); return Object.prototype.hasOwnProperty.call(propsMemo, k) ? propsMemo[k] : null; },
    getProperties() { if (!propsMemo) { propsMemo = {}; db.query('SELECT key, value FROM tsekh_props').forEach(r => { propsMemo[r.key] = r.value; }); } return Object.assign({}, propsMemo, envProps); },
    setProperty(k, v) { db.query('INSERT INTO tsekh_props (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [k, String(v)]); if (propsMemo) propsMemo[k] = String(v); return properties; },
    setProperties(obj, deleteAllOthers) {
      if (deleteAllOthers) db.query('DELETE FROM tsekh_props');
      Object.keys(obj || {}).forEach(k => properties.setProperty(k, obj[k]));
      propsMemo = null; return properties;
    },
    deleteProperty(k) { db.query('DELETE FROM tsekh_props WHERE key = $1', [k]); if (propsMemo) delete propsMemo[k]; return properties; },
    deleteAllProperties() { db.query('DELETE FROM tsekh_props'); propsMemo = {}; return properties; }
  };

  // Кэш живёт только внутри одного запроса: у нескольких экземпляров контейнера нет общего
  // кэша, а устаревшие строки листа в чужой памяти недопустимы. Ограничение 100 КБ — как в Apps Script.
  let cacheMap = new Map();
  const cache = {
    get(k) { const e = cacheMap.get(k); if (!e) return null; if (e.until < Date.now()) { cacheMap.delete(k); return null; } return e.v; },
    put(k, v, ttl) { if (String(v).length > 100 * 1024) throw new Error('Argument too large: value'); cacheMap.set(k, { v: String(v), until: Date.now() + 1000 * (ttl || 600) }); },
    remove(k) { cacheMap.delete(k); },
    removeAll(keys) { (keys || []).forEach(k => cacheMap.delete(k)); },
    getAll(keys) { const o = {}; (keys || []).forEach(k => { const v = cache.get(k); if (v !== null) o[k] = v; }); return o; },
    putAll(obj, ttl) { Object.keys(obj || {}).forEach(k => cache.put(k, obj[k], ttl)); }
  };

  // Блокировка записи — рекомендательная блокировка PostgreSQL: общая для всех экземпляров.
  let held = 0;
  const lock = {
    tryLock(ms) {
      if (held) { held++; return true; }
      const until = Date.now() + (ms || 0);
      for (;;) {
        if (db.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY])[0].ok) { held = 1; return true; }
        if (Date.now() >= until) return false;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
    },
    waitLock(ms) { if (!lock.tryLock(ms)) throw new Error('LOCK_TIMEOUT: Система занята другой операцией, повтори через несколько секунд.'); },
    releaseLock() { if (!held) return; held--; if (!held) db.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]); },
    hasLock() { return held > 0; }
  };

  function migrate() { db.batch(SCHEMA_SQL.map(sql => ({ sql }))); }
  function resetRequestState() { cacheMap = new Map(); propsMemo = null; while (held) lock.releaseLock(); }
  function wipeAll() { db.batch([{ sql: 'TRUNCATE tsekh_rows, tsekh_sheets, tsekh_props, tsekh_mail RESTART IDENTITY CASCADE' }]); resetRequestState(); }
  function queueMail(to, subject, body) { db.query('INSERT INTO tsekh_mail (recipient, subject, body) VALUES ($1, $2, $3)', [String(to), String(subject), String(body)]); }

  return { spreadsheet, properties, cache, lock, migrate, resetRequestState, wipeAll, queueMail, rowsOf };
}

module.exports = { createStore, SCHEMA_SQL };
