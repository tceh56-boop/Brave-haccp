// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
// Манифесты MON CHEF по фактическим файлам сборки: точка входа, интерфейс, список файлов с SHA-256.
// Запуск: node monchef/tools/gen_manifest.js   (пишет app/BUILD_MANIFEST.json и app/DEPLOY_MANIFEST_FINAL.json)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const A = path.resolve(__dirname, '../app');
const read = f => JSON.parse(fs.readFileSync(path.join(A, f), 'utf8'));
const files = fs.readdirSync(A).filter(f => /\.(gs|html|json)$/.test(f) && !/MANIFEST/.test(f)).sort()
  .map(f => ({ file: f, bytes: fs.statSync(path.join(A, f)).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(A, f))).digest('hex') }));
const gs = fs.readdirSync(A).filter(f => f.endsWith('.gs')).map(f => fs.readFileSync(path.join(A, f), 'utf8'));
const doGet = gs.reduce((n, s) => n + (s.match(/^function doGet\(/gm) || []).length, 0), doPost = gs.reduce((n, s) => n + (s.match(/^function doPost\(/gm) || []).length, 0);
if (!fs.existsSync(path.join(A, 'Console.html'))) throw new Error('нет Console.html');
const b = read('BUILD_MANIFEST.json');
const upd = new Date().toISOString().slice(0, 10);
const entry = { server: 'Code.gs', function: 'doGet', doGet: doGet, doPost: doPost, ui: 'Console.html', gate: 'zzz_MonChef_Gate.gs (загружается последним)' };
const mods = b.modules.filter(m => !/Restaurant Service/.test(m)).concat(['Restaurant Service: halls, tables, bookings, preorders, forecast; waiter order book — orders, courses, weighed items, production queue, internal bills and split; guest menu Reels with in-app media, publication, guest requests by table QR; role editor; kitchen and bar display, Stop/Go, serve, replace, cancel with consumption; bar roles, bar recipes and preps via MON CHEF production, stock write-off by TTK at «ready» (V101, stages 2–6)']);
fs.writeFileSync(path.join(A, 'BUILD_MANIFEST.json'), JSON.stringify(Object.assign({}, b, { entrypoint: undefined, server: undefined, entry: entry, modules: mods,
  validation: Object.assign({}, b.validation, { app_javascript_syntax: undefined, ui: 'Console.html (App.html удалён)' }), files: files, updated: upd }), null, 2) + '\n');
const d = read('DEPLOY_MANIFEST_FINAL.json');
fs.writeFileSync(path.join(A, 'DEPLOY_MANIFEST_FINAL.json'), JSON.stringify(Object.assign({}, d, { entry: entry, ui: undefined, production_stack: 'V4–V101',
  files_count: files.length, files_sha256_source: 'BUILD_MANIFEST.json → files', updated: upd }), null, 2) + '\n');
console.log('манифесты: ' + files.length + ' файлов; doGet ' + doGet + ', doPost ' + doPost);
