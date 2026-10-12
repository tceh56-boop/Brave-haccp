// Все фоновые задачи ЦЕХ (как их запускают триггеры) отрабатывают без ошибок в журнале — защита от повторения B6.
// Запуск: node replica/tests/jobs_test.js (на PostgreSQL — через cloud/test/run-all.js)
const assert = require('assert');
const H = require('./harness.js'), G = H.ctx;
G.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', H.runtime ? 'pg' : 'SS');
const setup = G.setupProduction();
const jobs = [].concat(...Object.values(G.TRIGGER_SCHEDULE_), Object.keys(G.DAILY_TRIGGER_HOURS_));
const before = G.findRows_('SYSTEM_ERRORS', () => true).length;
const thrown = [];
jobs.forEach(f => { try { G[f](); } catch (e) { thrown.push(f + ': ' + e.message); } });
// На стенде нет Google Диска — ночная копия таблицы падает ожидаемо; в облаке она заменена бэкапами PostgreSQL.
const errors = G.findRows_('SYSTEM_ERRORS', () => true).slice(before)
  .filter(e => !(H.runtime === undefined && e.функция === 'dailyBackupTrigger_'))
  .map(e => e.функция + ': ' + String(e.техническое_описание || '').split('\n')[0]);
let failures = 0;
try { assert.equal(jobs.length, 30); console.log('OK    в расписании 30 фоновых задач'); } catch (e) { failures++; console.log('FAIL  число задач', e.message); }
try { assert.deepEqual(thrown, []); console.log('OK    ни одна задача не выбросила исключение'); } catch (e) { failures++; console.log('FAIL  исключения:', thrown); }
try { assert.deepEqual(errors, []); console.log('OK    журнал ошибок пуст (B6: этапы 51–80 больше не падают)'); } catch (e) { failures++; console.log('FAIL  ошибки в журнале:', errors); }
try { assert(setup.director && setup.director.created); console.log('OK    установка создала первого директора'); } catch (e) { failures++; console.log('FAIL  установка'); }
console.log(failures ? '\n' + failures + ' FAILED' : '\nALL PASSED');
process.exit(failures ? 1 : 0);
