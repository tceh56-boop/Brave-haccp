// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
// Проверка установщика MonChefInstaller.gs на модели Google (Диск, Apps Script API — заглушки) с настоящим архивом сборки.
// Затем установленный проект (файлы в порядке установщика + MonChef_InstallConfig.gs) запускается на стенде.
// Запуск: node monchef/tools/installer_test.js   (сначала bash monchef/tools/build_kit.sh)
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os'), cp = require('child_process');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e)); } }
const M = path.resolve(__dirname, '..'), ZIP = path.join(M, 'dist', 'MonChef_Integrated_Application_1_0_RS.zip');
assert.ok(fs.existsSync(ZIP), 'нет ' + ZIP + ' — сначала bash monchef/tools/build_kit.sh');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcinst-')); cp.execSync('unzip -q -o ' + JSON.stringify(ZIP) + ' -d ' + JSON.stringify(path.join(tmp, 'zip')));

// ---------- модель Google ----------
const blob = (name, data) => ({ name, data, getName: () => name, getDataAsString: () => Buffer.from(data).toString('utf8'), setName(n) { this.name = n; return this; },
  copyBlob() { return blob(this.name, data); }, setContentType() { return this; }, getBytes: () => data });
const drive = {}; let idn = 0; const newId = p => p + '_' + String(++idn).padStart(30, '0');
const mkFile = (name, b, folder) => { const f = { id: newId('F'), name, blob: b, updated: new Date(2026, 10, 24, 10, idn), trashed: false, folder,
  getId() { return this.id; }, getName() { return this.name; }, getLastUpdated() { return this.updated; }, getBlob() { return this.blob; }, getUrl() { return 'https://drive/' + this.id; },
  setTrashed(v) { this.trashed = v; }, moveTo(fd) { this.folder = fd; },
  makeCopy(n, fd) { const c = mkFile(n, this.blob, fd); fd.files.push(c); return c; } }; drive[f.id] = f; return f; };
const it = a => { let i = 0; return { hasNext: () => i < a.length, next: () => a[i++] }; };
const mkFolder = name => { const fd = { id: newId('D'), name, files: [], folders: [], getName: () => name,
  getFiles() { return it(this.files.filter(f => !f.trashed)); }, getFilesByName(n) { return it(this.files.filter(f => !f.trashed && f.name === n)); },
  createFile(b) { const f = mkFile(b.getName(), b, this); this.files.push(f); return f; },
  getFoldersByName(n) { return it(this.folders.filter(x => x.name === n)); }, createFolder(n) { const x = mkFolder(n); this.folders.push(x); return x; } }; drive[fd.id] = fd; return fd; };
const inst = mkFolder('MonChef — установка');
const oldZip = mkFile('MonChef_Integrated_Application_1_0_TTK.zip', blob('old.zip', Buffer.from('')), inst); oldZip.updated = new Date(2026, 9, 1); inst.files.push(oldZip);
const appZip = mkFile('MonChef_Integrated_Application_1_0_RS.zip', blob('app.zip', fs.readFileSync(ZIP)), inst); appZip.updated = new Date(2026, 10, 24, 12); inst.files.push(appZip);
const kit = mkFile('Установка_MonChef_RS_2026-11-24.zip', blob('kit.zip', Buffer.from('')), inst); inst.files.push(kit);
const sheetDefault = mkFile('Mon Cher — База блюд (из ТТК)', blob('s', Buffer.from('')), null); sheetDefault.id = '1yCYIBLdGHCpclL_NgpoX5Hf9zDy7MdLL7tBENjsdPNQ'; drive[sheetDefault.id] = sheetDefault;
const sheetWork = mkFile('Рабочая таблица ресторана', blob('s', Buffer.from('')), null);
const unzipDir = d => fs.readdirSync(d).map(n => blob(n, fs.readFileSync(path.join(d, n))));
const projects = {}, api = []; let dep = 0;
function fetch(url, o) {
  const p = url.replace('https://script.googleapis.com/v1/projects', ''), m = (o.method || 'get').toLowerCase(), body = o.payload ? JSON.parse(o.payload) : null; api.push(m + ' ' + p);
  const res = (code, obj) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(obj) });
  if (m === 'post' && p === '') { const id = newId('S'); projects[id] = { files: [], versions: 0, deployments: [] }; drive[id] = mkFile(body.title, null, null); drive[id].id = id; return res(200, { scriptId: id }); }
  const mm = /^\/([^/]+)(\/.*)?$/.exec(p), pr = projects[mm[1]], rest = mm[2] || ''; if (!pr) return res(404, { error: 'нет проекта' });
  if (rest === '/content' && m === 'get') return res(200, { files: pr.files });
  if (rest === '/content' && m === 'put') { pr.files = body.files; return res(200, {}); }
  if (rest === '/versions' && m === 'post') return res(200, { versionNumber: ++pr.versions });
  if (rest === '/deployments' && m === 'get') return res(200, { deployments: pr.deployments });
  if (rest === '/deployments' && m === 'post') { const d = { deploymentId: 'DEP' + (++dep), deploymentConfig: body, entryPoints: [{ entryPointType: 'WEB_APP', webApp: { url: 'https://script.google.com/macros/s/DEP' + dep + '/exec' } }] }; pr.deployments.push(d); return res(200, d); }
  const dm = /^\/deployments\/(.+)$/.exec(rest); if (dm && m === 'put') { const d = pr.deployments.find(x => x.deploymentId === dm[1]); d.deploymentConfig = body.deploymentConfig; return res(200, d); }
  return res(400, { error: 'не поддержано ' + m + ' ' + p });
}
const props = {}, logs = [];
const ctx = { console, Date, JSON, Math, String, Object, Array, RegExp, Error, Buffer,
  DriveApp: { getFolderById: id => { if (!drive[id]) throw new Error('No item with the given ID could be found'); return drive[id]; }, getFileById: id => { if (!drive[id]) throw new Error('No item with the given ID could be found'); return drive[id]; } },
  Utilities: { unzip: b => { assert.strictEqual(b, appZip.blob, 'распакован не архив сборки'); return unzipDir(path.join(tmp, 'zip')); },
    newBlob: (data, type, name) => blob(name, Buffer.from(data)), zip: (bs, name) => blob(name, Buffer.from('zip')), formatDate: () => '2026-11-24_19-30' },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
  UrlFetchApp: { fetch }, ScriptApp: { getOAuthToken: () => 'TOKEN' }, Session: { getScriptTimeZone: () => 'Asia/Yekaterinburg' }, Logger: { log: s => logs.push(s) } };
vm.createContext(ctx);
const SRC = fs.readFileSync(path.join(M, 'install', 'MonChefInstaller.gs'), 'utf8');
vm.runInContext(SRC, ctx);
ctx.MC_INSTALL_FOLDER_ID_ = inst.id;
const zipNames = fs.readdirSync(path.join(tmp, 'zip'));
const expected = zipNames.filter(n => /\.(gs|html)$/.test(n)).length + 1 + 1;   // + appsscript.json + MonChef_InstallConfig

console.log('Установщик MonChefInstaller.gs');
let r1, r2;
t('шапка: собственность и разработчик', () => { assert.ok(/Собственность Слепцова Дениса Владимировича\./.test(SRC) && /Разработчик кода — Слепцов Денис Владимирович\./.test(SRC)); });
t('первая установка (копия таблицы): проект, ' + expected + ' файлов, Code.gs первым и без изменений, таблица — в настройках установки', () => {
  r1 = vm.runInContext('installMonChef()', ctx);
  const pr = projects[r1.scriptId]; assert.strictEqual(pr.files.length, expected); assert.strictEqual(r1.files, expected);
  assert.deepStrictEqual(pr.files.slice(0, 2).map(f => f.name), ['appsscript', 'Code']);
  assert.strictEqual(pr.files.find(f => f.name === 'Code').source, fs.readFileSync(path.join(tmp, 'zip', 'Code.gs'), 'utf8'), 'Code.gs не правится');
  const names = pr.files.map(f => f.name);
  ['Hall', 'Kds', 'GuestMenu', 'MenuEditor', 'Roles', 'MonChef_V101_RS_Economy', 'zz_MonChef_RS_RoleMatrix', 'zzz_MonChef_Gate', 'MonChef_InstallConfig'].forEach(n => assert.ok(names.includes(n), n));
  assert.ok(names.indexOf('zz_MonChef_RS_RoleMatrix') < names.indexOf('zzz_MonChef_Gate') && names.indexOf('zzz_MonChef_Gate') < names.indexOf('MonChef_InstallConfig') || names.indexOf('MonChef_InstallConfig') > names.indexOf('Code'), 'порядок');
  const cfg = pr.files.find(f => f.name === 'MonChef_InstallConfig').source;
  assert.ok(cfg.includes("var MC_INSTALL_SHEET_ID_ = '" + r1.sheetId + "'")); assert.notStrictEqual(r1.sheetId, sheetDefault.id, 'копия, а не рабочая');
  assert.ok(/— пилот MonChef$/.test(drive[r1.sheetId].name) && drive[r1.sheetId].folder === inst, 'копия рабочей таблицы в папке установки');
  assert.ok(/Собственность Слепцова/.test(cfg));
  assert.strictEqual(r1.versionNumber, 1); assert.ok(/DEP1\/exec$/.test(r1.webAppUrl));
  assert.ok(logs[0].includes('файлов в проекте: ' + expected) && logs[0].includes('Пропущены как дубли: нет.') && logs[0].includes('(копия для пилота)'));
  assert.ok(drive[r1.scriptId].folder === inst, 'проект в папке установки');
});
t('взят самый свежий архив сборки; комплект «Установка_…» и прежний архив не взяты', () => { assert.ok(logs[0].includes('Архив: MonChef_Integrated_Application_1_0_RS.zip.')); });
t('прочие файлы сборки (логотипы, документы) — в «Файлы пакета», не в проекте', () => {
  const a = inst.folders.find(f => f.name === 'Файлы пакета'); assert.ok(a.files.some(f => f.name === 'monchef_wordmark.png') && a.files.some(f => f.name === 'RS_ЭТАП_7_ОТЧЁТ.md'));
  assert.ok(!a.files.some(f => /\.gs$/.test(f.name)));
});
t('повторный запуск — обновление: тот же проект и развёртывание (ссылка та же), версия 2, резервная копия кода, копия таблицы та же', () => {
  r2 = vm.runInContext('installMonChef()', ctx);
  assert.strictEqual(r2.scriptId, r1.scriptId); assert.strictEqual(r2.webAppUrl, r1.webAppUrl); assert.strictEqual(r2.versionNumber, 2); assert.strictEqual(r2.sheetId, r1.sheetId);
  assert.strictEqual(projects[r1.scriptId].deployments.length, 1);
  assert.ok(inst.files.some(f => /^backup_S_/.test(f.name)), 'backup_*.json');
  const a = inst.folders.find(f => f.name === 'Файлы пакета'); assert.strictEqual(a.files.filter(f => !f.trashed && f.name === 'monchef_wordmark.png').length, 1, 'без дублей в «Файлы пакета»');
});
t('переход на рабочую таблицу: MC_SHEET_ID_ = ссылка, MC_USE_SHEET_COPY_ = false', () => {
  ctx.MC_SHEET_ID_ = 'https://docs.google.com/spreadsheets/d/' + sheetWork.id + '/edit#gid=0'; ctx.MC_USE_SHEET_COPY_ = false;
  const r = vm.runInContext('installMonChef()', ctx);
  assert.strictEqual(r.sheetId, sheetWork.id); assert.ok(projects[r.scriptId].files.find(f => f.name === 'MonChef_InstallConfig').source.includes(sheetWork.id));
  assert.ok(logs[logs.length - 1].includes('Таблица (рабочая)'));
});
t('ошибки понятные: неверная таблица, папка без архива, архив без Restaurant Service', () => {
  ctx.MC_SHEET_ID_ = 'таблица'; assert.throws(() => vm.runInContext('installMonChef()', ctx), /не похоже на ссылку или ID таблицы/); ctx.MC_SHEET_ID_ = '';
  const empty = mkFolder('пусто'); ctx.MC_INSTALL_FOLDER_ID_ = empty.id; assert.throws(() => vm.runInContext('installMonChef()', ctx), /нет \.zip-архива MonChef/);
  ctx.MC_INSTALL_FOLDER_ID_ = inst.id;
  const keep = ctx.Utilities.unzip; ctx.Utilities.unzip = () => unzipDir(path.join(tmp, 'zip')).filter(b => b.getName() !== 'Hall.html');
  assert.throws(() => vm.runInContext('installMonChef()', ctx), /нет файла Hall\.html/); ctx.Utilities.unzip = keep;
});
t('MonChefPatches.json для другой сборки не применяется', () => {
  inst.files.push(mkFile('MonChefPatches.json', blob('p', Buffer.from(JSON.stringify({ forArchive: 'MonChef_FINAL_PROJECT_ROOT', add: [{ file: 'Console.html', content: 'старое' }] }))), inst));
  const r = vm.runInContext('installMonChef()', ctx);
  assert.notStrictEqual(projects[r.scriptId].files.find(f => f.name === 'Console').source, 'старое'); assert.ok(logs[logs.length - 1].includes('MonChefPatches.json не применён'));
});
// ---------- установленный проект на стенде ----------
const out = path.join(tmp, 'project'); fs.mkdirSync(out);
projects[r1.scriptId].files.forEach(f => fs.writeFileSync(path.join(out, f.name + (f.type === 'HTML' ? '.html' : f.type === 'JSON' ? '.json' : '.gs')), f.source));
t('установленный проект запускается (порядок установщика): главное окно, таблица из настроек установки', () => {
  const res = cp.execFileSync('node', ['-e', `
    const { boot } = require(${JSON.stringify(path.join(__dirname, 'gasemu'))}); const E = boot({}); const C = E.ctx;
    const i = C._mcSheetIdInfo_(); const h = C.doGet({ parameter: {} }).getContent();
    console.log(JSON.stringify({ src: i.src, id: i.id, ok: /MON CHEF/.test(h), gate: typeof C.rsShiftReport }));`], { env: Object.assign({}, process.env, { MC_APP_DIR: out, MC_ORDER: 'install' }) }).toString().trim().split('\n').pop();
  const j = JSON.parse(res); assert.strictEqual(j.src, 'INSTALL_CONFIG'); const cfgId = /MC_INSTALL_SHEET_ID_ = '([^']+)'/.exec(fs.readFileSync(path.join(out, 'MonChef_InstallConfig.gs'), 'utf8'))[1]; assert.strictEqual(j.id, cfgId); assert.ok(j.ok); assert.strictEqual(j.gate, 'function');
});
t('полный цикл Restaurant Service (этап 7) на установленном проекте', () => {
  const o = cp.execFileSync('node', [path.join(__dirname, 'rs_stage7.test.js')], { env: Object.assign({}, process.env, { MC_APP_DIR: out, MC_ORDER: 'install' }) }).toString();
  assert.ok(/Итого: 12 пройдено, 0 не пройдено/.test(o), o.slice(-400));
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log('\nИтого: ' + pass + ' пройдено, ' + fail + ' не пройдено');
process.exit(fail ? 1 : 0);
