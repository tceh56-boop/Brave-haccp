// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * Установка и обновление облачной базы: таблицы хранилища + setupProduction() ЦЕХ
 * (листы и колонки всех модулей, первый директор со случайным PIN — только если сотрудников нет).
 * Повторный запуск безопасен. Запуск: DATABASE_URL=... node src/migrate.js
 */
const { createRuntime } = require('./runtime');

function main() {
  if (!process.env.DATABASE_URL) { console.error('Задайте DATABASE_URL.'); process.exit(1); }
  const rt = createRuntime({ logger: () => {} });
  try {
    const res = rt.ctx.setupProduction();
    if (typeof rt.ctx.migratePosSchema_ === 'function') rt.ctx.migratePosSchema_();
    const sheets = rt.db.query('SELECT count(*)::int AS n FROM tsekh_sheets')[0].n;
    console.log('Готово: листов в базе — ' + sheets + '.');
    if (res.director && res.director.created) {
      console.log('Первый вход: ДИРЕКТОР «' + res.director.name + '», PIN ' + res.director.pin + ' — сохраните и смените после входа.');
    } else {
      console.log('Сотрудники уже есть — первый директор не создавался.');
    }
  } finally {
    rt.close();
  }
}

if (require.main === module) main();
module.exports = { main };
