// Все проверки облачной версии: тесты ЦЕХ на PostgreSQL + облачные тесты (+ браузер, если есть Chromium).
// Запуск: DATABASE_URL=postgres://... node cloud/test/run-all.js
const { spawnSync } = require('child_process'), fs = require('fs'), path = require('path');
if (!process.env.DATABASE_URL) { console.error('Задайте DATABASE_URL (отдельная тестовая база — она очищается!).'); process.exit(1); }
const root = path.join(__dirname, '../..'), tests = path.join(root, 'replica/tests');
const runs = fs.readdirSync(tests).filter(f => f.endsWith('_test.js')).sort().map(f => path.join(tests, f))
  .concat([path.join(__dirname, 'cloud_test.js')]);
if (!process.argv.includes('--no-browser')) runs.push(path.join(__dirname, 'e2e_browser.js'));
let bad = 0;
for (const file of runs) {
  const t = Date.now();
  const r = spawnSync(process.execPath, [file], { env: Object.assign({}, process.env, { TSEKH_BACKEND: 'pg' }), encoding: 'utf8', timeout: 600000 });
  const last = ((r.stdout || '').trim().split('\n').pop() || '').slice(0, 60);
  const ok = r.status === 0;
  if (!ok) bad++;
  console.log((ok ? 'OK   ' : 'FAIL ') + path.basename(file).padEnd(28) + ((Date.now() - t) / 1000).toFixed(1).padStart(6) + ' с  ' + last);
  if (!ok) console.log((r.stdout || '').split('\n').filter(l => /FAIL|Error/.test(l)).slice(0, 5).join('\n'), (r.stderr || '').slice(0, 500));
}
console.log(bad ? '\nПровалено: ' + bad : '\nВсе проверки облачной версии пройдены.');
process.exit(bad ? 1 : 0);
