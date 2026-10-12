// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * Загрузка выгрузки из Google-таблицы (gas/CloudExport.gs → exportForCloud) в облачную базу.
 *   DATABASE_URL=... node src/import.js tsekh_export_2026-10-12.json [--replace]
 * Без --replace откажется, если в базе уже есть сотрудники: случайно затереть рабочие данные нельзя.
 * После загрузки запускает миграции (новые колонки и листы модулей) и сверяет число строк.
 */
const fs = require('fs');
const { createSyncPg } = require('./syncpg');
const { createStore } = require('./store');

const BATCH = 500;

function importExport(db, store, data, opts) {
  if (!data || data.format !== 'tsekh-cloud-export' || !data.sheets) throw new Error('Это не файл выгрузки ЦЕХ (ожидается format: tsekh-cloud-export).');
  store.migrate();
  const users = db.query("SELECT count(*)::int AS n FROM tsekh_rows WHERE sheet = 'USERS' AND row_no > 1")[0].n;
  if (users > 0 && !(opts && opts.replace)) throw new Error('В облачной базе уже есть данные (сотрудников: ' + users + '). Чтобы заменить их выгрузкой, запустите с --replace.');
  const props = db.query("SELECT value FROM tsekh_props WHERE key = 'SPREADSHEET_ID'");
  store.wipeAll();
  const names = Object.keys(data.sheets);
  db.batch(names.map(n => ({ sql: 'INSERT INTO tsekh_sheets (name) VALUES ($1)', params: [n] })));
  const counts = {};
  names.forEach(n => {
    const rows = data.sheets[n];
    counts[n] = rows.length;
    for (let i = 0; i < rows.length; i += BATCH) {
      const part = rows.slice(i, i + BATCH);
      const params = [], values = [];
      part.forEach((row, j) => {
        params.push(n, i + j + 1, JSON.stringify(row));
        values.push('($' + (params.length - 2) + ', $' + (params.length - 1) + ', $' + params.length + '::jsonb)');
      });
      db.query('INSERT INTO tsekh_rows (sheet, row_no, vals) VALUES ' + values.join(', '), params);
    }
  });
  Object.keys(data.properties || {}).forEach(k => store.properties.setProperty(k, data.properties[k]));
  store.properties.setProperty('SPREADSHEET_ID', props.length ? props[0].value : 'pg');
  // Сверка: сколько строк легло в базу по каждому листу.
  const got = {};
  db.query('SELECT sheet, count(*)::int AS n FROM tsekh_rows GROUP BY sheet').forEach(r => { got[r.sheet] = r.n; });
  const mismatch = names.filter(n => (got[n] || 0) !== counts[n]);
  if (mismatch.length) throw new Error('Не совпало число строк: ' + mismatch.join(', '));
  return { листов: names.length, строк: names.reduce((s, n) => s + Math.max(0, counts[n] - 1), 0), секреты_задать_вручную: data.secrets_not_exported || [] };
}

function main() {
  const file = process.argv[2];
  if (!file || !process.env.DATABASE_URL) { console.error('Запуск: DATABASE_URL=... node src/import.js выгрузка.json [--replace]'); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const db = createSyncPg(process.env.DATABASE_URL);
  try {
    const res = importExport(db, createStore(db), data, { replace: process.argv.includes('--replace') });
    console.log('Загружено: листов ' + res.листов + ', строк ' + res.строк + '.');
    if (res.секреты_задать_вручную.length) console.log('Задайте в Lockbox / переменных окружения: ' + res.секреты_задать_вручную.join(', '));
    console.log('Дальше: node src/migrate.js — допишет колонки и листы новых модулей.');
  } finally { db.close(); }
}

if (require.main === module) main();
module.exports = { importExport };
