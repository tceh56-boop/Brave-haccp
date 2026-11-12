/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
// Этап 5 SaaS: изоляция двух независимых предприятий на модели Google Диска.
// Модель: один общий «Диск Google» с тремя владельцами (клиент A, клиент B, поставщик), родители папок, корзина,
// права редактора с наследованием. Настоящий код: TS_TenantBootstrap.gs (под аккаунтом клиента), CONTROL (admin/*.gs),
// клиентское ядро (TS2_Schema/TS2_Core/TS_DriveTree/TS4) с конфигурацией, внедрённой CONTROL, от имени поставщика
// (развёртывание USER_DEPLOYING: поставщик видит Диски обоих клиентов — именно поэтому нужна проверка границ).
// Это модель, а не Google: реальные OAuth, Drive API и Shared Drives здесь не проверяются.
// Запуск: node tests/tenant_isolation.test.js
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert'), { make } = require('./gas_mock');
const root = path.join(__dirname, '..');
let n = 0; const t = (name, f) => { f(); n++; console.log('  ✓ ' + name); };
const THROWS = (f, re, msg) => { let err = null; try { f(); } catch (e) { err = e; } assert(err && re.test(String(err.message || err)), (msg || '') + ' ожидалась ошибка ' + re + ', получено: ' + (err ? err.message : 'нет ошибки')); };

/* ------------------------------------------------------------------ модель Google Диска */
const PROVIDER = 'provider@tsekh.example', CA = 'owner-a@cafe-a.example', CB = 'owner-b@cafe-b.example';
const items = {}; let seq = 1000;
const newItem = (kind, name, owner, parent) => { const id = 'id' + kind[0] + (seq++) + 'xxxxxxxxxxxx'; items[id] = { id, kind, name, owner, parents: parent ? [parent] : [], trashed: false, editors: [] }; return id; };
const ancestors = id => { const out = [], q = [...items[id].parents]; while (q.length) { const p = q.shift(); if (!items[p] || out.includes(p)) continue; out.push(p); q.push(...items[p].parents); } return out; };
const canAccess = (user, id) => { const it = items[id]; if (!it) return false; if (it.owner === user || it.editors.includes(user)) return true; return ancestors(id).some(a => items[a].owner === user || items[a].editors.includes(user)); };
const iter = arr => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
function driveFor(user) {
  const wrap = id => { const it = items[id]; const o = {
    getId: () => id, getName: () => it.name, getUrl: () => 'https://drive.google.com/' + id, isTrashed: () => it.trashed, setTrashed: v => { it.trashed = !!v; },
    getOwner: () => ({ getEmail: () => it.owner }), getParents: () => iter(it.parents.filter(p => canAccess(user, p)).map(wrap)),
    addEditor: e => { it.editors.push(e); return o; }, removeEditor: e => { it.editors = it.editors.filter(x => x !== e); return o; },
    moveTo: f => { if (!canAccess(user, f.getId())) throw new Error('Access denied: target'); it.parents = [f.getId()]; return o; },
    getFoldersByName: nm => iter(Object.values(items).filter(x => x.kind === 'folder' && !x.trashed && x.name === nm && x.parents.includes(id) && canAccess(user, x.id)).map(x => wrap(x.id))),
    getFolders: () => iter(Object.values(items).filter(x => x.kind === 'folder' && x.parents.includes(id) && canAccess(user, x.id)).map(x => wrap(x.id))),
    getFiles: () => iter(Object.values(items).filter(x => x.kind === 'file' && x.parents.includes(id) && canAccess(user, x.id)).map(x => wrap(x.id))),
    createFolder: nm => wrap(newItem('folder', nm, user, id)), createFile: b => wrap(newItem('file', (b && b.name) || 'file', user, id)), setName: nm => { it.name = nm; return o; } }; return o; };
  const get = kind => id => { if (!items[id] || items[id].kind !== kind || !canAccess(user, id)) throw new Error('No item with the given ID could be found, or you do not have permission to access it.'); return wrap(id); };
  return { getFolderById: get('folder'), getFileById: get('file'), createFolder: nm => wrap(newItem('folder', nm, user, null)), createFile: b => wrap(newItem('file', (b && b.name) || 'file', user, null)),
    getRootFolder: () => ({ removeFile() {} }),
    getFoldersByName: nm => iter(Object.values(items).filter(x => x.kind === 'folder' && !x.trashed && x.name === nm && canAccess(user, x.id)).map(x => wrap(x.id))) };
}
const ownedBy = u => Object.values(items).filter(x => x.owner === u).length;
// объекты поставщика вне деревьев клиентов (то, что попало бы на Диск поставщика)
const providerLoose = () => Object.values(items).filter(x => x.owner === PROVIDER && ![RA, RB].some(R => R && (ancestors(x.id).includes(R.rootFolderId)))).length;

/* ------------------------------------------------------------------ таблицы (по одной книге на предприятие) */
function sheet(name) { const s = { data: [], getName: () => name, getLastRow: () => s.data.length, getLastColumn: () => Math.max(0, ...s.data.map(r => r.length)), getMaxRows: () => 1000, getMaxColumns: () => 50,
  setFrozenRows() {}, getProtections: () => [], protect: () => ({ setDescription() { return this; } }), appendRow(r) { s.data.push(r.slice()); },
  getDataRange() { const w = Math.max(1, ...s.data.map(r => r.length)); return s.getRange(1, 1, Math.max(1, s.data.length), w); },
  getRange(r, c, nr = 1, nc = 1) { return {
    setValues(v) { v.forEach((row, i) => { s.data[r - 1 + i] = s.data[r - 1 + i] || []; row.forEach((x, j) => { s.data[r - 1 + i][c - 1 + j] = x; }); }); return this; },
    getValues() { const o = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(((s.data[r - 1 + i] || [])[c - 1 + j]) ?? ''); o.push(row); } return o; },
    createTextFinder(text) { const f = { matchEntireCell() { return f; }, matchCase() { return f; }, findAll() { const out = []; for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) { const v = (s.data[r - 1 + i] || [])[c - 1 + j]; if (v !== undefined && String(v) === String(text)) out.push({ getRow: () => r + i }); } return out; } }; return f; },
    getValue() { return ((s.data[r - 1] || [])[c - 1]) ?? ''; }, setValue(v) { s.data[r - 1] = s.data[r - 1] || []; s.data[r - 1][c - 1] = v; return this; },
    setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; }, setNumberFormat() { return this; } }; } }; return s; }
const bookOf = {}; function book(id) { if (!bookOf[id]) { const sh = {}; bookOf[id] = { getId: () => id, getSheetByName: n => sh[n] || null, insertSheet: n => (sh[n] = sheet(n)), getSheets: () => Object.values(sh) }; } return bookOf[id]; }
function sheetsAppFor(user) { return { create: nm => { const id = newItem('file', nm, user, null); book(id); return Object.assign(book(id), { getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id }); },
  openById: id => { if (!items[id] || !canAccess(user, id)) throw new Error('no access'); return Object.assign(book(id), { getUrl: () => 'u' }); }, flush() {}, ProtectionType: { SHEET: 'SHEET' } }; }

/* ------------------------------------------------------------------ CONTROL поставщика */
const GA = make(PROVIDER); GA.DriveApp = driveFor(PROVIDER); GA.MailApp = { sendEmail() {}, getRemainingDailyQuota: () => 100 };
const ctl = vm.createContext(GA); fs.readdirSync(path.join(root, 'admin')).filter(f => f.endsWith('.gs')).sort().forEach(f => vm.runInContext(fs.readFileSync(path.join(root, 'admin', f), 'utf8'), ctl, { filename: f }));
const pwd = /Временный пароль: (\S+)/.exec(ctl.setupAdmin())[1], T = ctl.adminLogin(PROVIDER, pwd).data.token;
const lic = name => ctl.adminClientSave(T, { name, email: 'x@' + name.length + '.example', plan: 'pro', months: 12 }).data;
const LA = lic('Кафе А'), LB = lic('Кафе Б');
const OA = LA.id, OB = LB.id;
const post = payload => JSON.parse(ctl.doPost({ parameter: {}, postData: { contents: JSON.stringify(payload) } }).text);

/* ------------------------------------------------------------------ bootstrap под аккаунтом клиента */
function bootstrapFor(user, L, name) {
  const G = make(user); G.DriveApp = driveFor(user); G.SpreadsheetApp = sheetsAppFor(user); G.Session.getEffectiveUser = () => ({ getEmail: () => user });
  G.UrlFetchApp = { fetch: (url, opt) => { const r = ctl.doPost({ parameter: {}, postData: { contents: opt.payload } }); return { getResponseCode: () => 200, getContentText: () => r.text }; } };
  const src = fs.readFileSync(path.join(root, 'installer', 'TS_TenantBootstrap.gs'), 'utf8')
    .replace("'ВСТАВЬТЕ_URL_WEB_APP_CONTROL'", "'https://script.google.com/macros/s/CONTROL/exec'").replace("'ВСТАВЬТЕ_EMAIL_ТЕХНИЧЕСКОГО_АККАУНТА_ПОСТАВЩИКА'", JSON.stringify(PROVIDER))
    .replace("'Название предприятия'", JSON.stringify(name)).replace("'TS-XXXX-XXXX-XXXX'", JSON.stringify(L.licenseKey)).replace("'СЕКРЕТ_ЛИЦЕНЗИИ_ИЗ_CONTROL'", JSON.stringify(L.secret));
  const c = vm.createContext(G); vm.runInContext(src, c, { filename: 'TS_TenantBootstrap.gs' }); return c;
}
const BA = bootstrapFor(CA, LA, 'Кафе А'), BB = bootstrapFor(CB, LB, 'Кафе Б');
let RA, RB;

/* ------------------------------------------------------------------ клиентское ядро (от имени поставщика, конфигурация от CONTROL) */
function clientFor(orgId, asUser) {   // asUser — Google-аккаунт, от имени которого выполняется код (USER_ACCESSING); по умолчанию поставщик
  const org = ctl.findBy('Organizations', 'ID', orgId);
  const core = ctl.injectTenantConfigSource_({ name: 'TS2_Core', type: 'SERVER_JS', source: fs.readFileSync(path.join(root, 'app', 'TS2_Core.gs'), 'utf8') }, org).source;
  const who = asUser || PROVIDER, G = make(who); G.DriveApp = driveFor(who); G.SpreadsheetApp = sheetsAppFor(who);
  G.Session.getActiveUser = () => ({ getEmail: () => who }); G.Session.getEffectiveUser = () => ({ getEmail: () => who });
  G.Utilities.formatDate = (d, tz, f) => new Date(d).toISOString().slice(0, 10);
  const c = vm.createContext(G);
  Object.assign(G, { _book_: () => book(c._tsTenantSpreadsheetId_()), _mcTz_: () => 'Europe/Moscow', _withLock_: f => f(), _log_: () => {}, mcGateSession_: () => null,
    _ok_: d => JSON.stringify({ success: true, data: d }), _failFrom_: e => JSON.stringify({ success: false, error: { message: String(e.message || e) } }), _requireAuth_: () => ({ name: 'Директор' }) });
  vm.runInContext(fs.readFileSync(path.join(root, 'app', 'TS2_Schema.gs'), 'utf8'), c, { filename: 'TS2_Schema.gs' });
  vm.runInContext(core, c, { filename: 'TS2_Core.gs (внедрённый)' });
  ['TS_DriveTree.gs', 'TS4_TenantIntegrity.gs'].forEach(f => vm.runInContext(fs.readFileSync(path.join(root, 'app', f), 'utf8'), c, { filename: f }));
  return c;
}
let A, B, PROVIDER_OWNED_IN_CLIENT_TREES = 0;
const inTree = (id, rootId) => ancestors(id).includes(rootId) || id === rootId;

t('bootstrap: каждый клиент создаёт папку и таблицу на своём Диске, поставщик — только редактор; CONTROL подтверждает владельца (подпись v2)', () => {
  RA = BA.tsTenantBootstrapStart(); RB = BB.tsTenantBootstrapStart();
  // А и Б — прежняя модель (код от имени поставщика); новая модель P1-2 — предприятие В ниже
  ctl.update('Organizations', OA, { 'Execution Model': 'USER_DEPLOYING' }); ctl.update('Organizations', OB, { 'Execution Model': 'USER_DEPLOYING' });
  assert.strictEqual(items[RA.rootFolderId].owner, CA); assert.strictEqual(items[RB.rootFolderId].owner, CB);
  assert.strictEqual(items[RA.spreadsheetId].parents[0], RA.rootFolderId); assert(items[RA.rootFolderId].editors.includes(PROVIDER));
  const oa = ctl.findBy('Organizations', 'ID', OA), ob = ctl.findBy('Organizations', 'ID', OB);
  assert(oa['Customer Drive Root ID'] === RA.rootFolderId && oa['Customer Drive Owner Email'] === CA && ob['Customer Drive Root ID'] === RB.rootFolderId);
  assert.strictEqual(ownedBy(PROVIDER), 0, 'на Диске поставщика ничего не создано');
});
t('CONTROL: чужой корень, чужая таблица, ложный владелец, подмена тела, повтор и подпись v1 — отказ', () => {
  const sign = (L, p) => { const q = Object.assign({ action: 'tenant.bootstrap', key: L.licenseKey, ts: String(Date.now() + Math.random()), sigV: 2 }, p); q.sig = ctl.hmac(q.key + '|' + q.ts + '|' + ctl.canonicalJson_(q), L.secret); return q; };
  const r1 = post(sign(LB, { rootFolderId: RA.rootFolderId, spreadsheetId: RB.spreadsheetId, ownerEmail: CB })); assert(/TENANT_ISOLATION/.test(r1.error), 'Б не может занять корень А: ' + JSON.stringify(r1));
  const r2 = (() => { try { return post(sign(LB, { rootFolderId: RB.rootFolderId, spreadsheetId: RA.spreadsheetId, ownerEmail: CB })); } catch (e) { return { error: e.message }; } })(); assert(/TENANT_ISOLATION/.test(r2.error), 'Б не может занять таблицу А: ' + r2.error);
  assert(ctl.readAll('Logs').some(l => l['Тип'] === 'SECURITY' && /TENANT_ISOLATION/.test(l['Описание'])), 'попытка в журнале безопасности');
  // папка Б, но владельцем заявлен А
  const r3 = post(sign(LB, { rootFolderId: RB.rootFolderId, spreadsheetId: RB.spreadsheetId, ownerEmail: CA })); assert(/TENANT_OWNERSHIP/.test(r3.error), JSON.stringify(r3));
  // подмена тела после подписи
  const q = sign(LB, { rootFolderId: RB.rootFolderId, spreadsheetId: RB.spreadsheetId, ownerEmail: CB }); q.rootFolderId = RA.rootFolderId; assert(/Подпись/.test(post(q).error), 'подменённое тело не принимается');
  // повтор того же запроса
  const ok = sign(LB, { rootFolderId: RB.rootFolderId, spreadsheetId: RB.spreadsheetId, ownerEmail: CB }); assert(post(ok).ok); assert(/Подпись/.test(post(ok).error), 'повтор отклонён');
  // старая подпись v1 для привязки хранилища не принимается
  const v1 = { action: 'tenant.bootstrap', key: LB.licenseKey, ts: String(Date.now()), rootFolderId: RB.rootFolderId, spreadsheetId: RB.spreadsheetId, ownerEmail: CB }; v1.sig = ctl.hmac(v1.key + '|' + v1.ts, LB.secret);
  assert(/Подпись/.test(post(v1).error), 'v1 для tenant.bootstrap отклонена');
  // обычные действия по v1 (существующие системы клиентов) работают
  const rc = { action: 'release.check', key: LB.licenseKey, ts: String(Date.now()) }; rc.sig = ctl.hmac(rc.key + '|' + rc.ts, LB.secret); assert(post(rc).ok, 'v1 для прочих действий сохранена');
});
t('CONTROL: конфигурация внедряется в проект своего предприятия; без хранилища — ни установки, ни обновления', () => {
  const src = fs.readFileSync(path.join(root, 'app', 'TS2_Core.gs'), 'utf8');
  const ia = ctl.injectTenantConfigSource_({ name: 'TS2_Core', source: src }, ctl.findBy('Organizations', 'ID', OA)).source;
  assert(ia.includes(RA.rootFolderId) && ia.includes(CA) && !ia.includes(RB.rootFolderId), 'в проект А попадает только хранилище А');
  const lc = lic('Кафе без хранилища'), oc = ctl.findBy('Organizations', 'ID', lc.id);
  THROWS(() => ctl.injectTenantConfigSource_({ name: 'TS2_Core', source: src }, oc), /ONBOARDING_REQUIRED/);
  THROWS(() => ctl.updateOneOrg_(oc, { files: [] }, '9.9.9'), /ONBOARDING_REQUIRED/);
  THROWS(() => ctl.injectTenantConfigSource_({ name: 'TS2_Core', source: 'var x = 1;' }, ctl.findBy('Organizations', 'ID', OA)), /TENANT_CONFIG_TEMPLATE_MISSING/);
});
t('клиентское ядро: всё дерево папок А — внутри корня А, Б — внутри корня Б; на Диске поставщика ничего не создаётся', () => {
  A = clientFor(OA); B = clientFor(OB);
  A._ts2EnsureSchema_(true); B._ts2EnsureSchema_(true);
  const ta = A._ts2EnsureDriveTree_(), tb = B._ts2EnsureDriveTree_();
  assert(ta.length > 20 && ta.every(x => inTree(x.id, RA.rootFolderId)), 'дерево А в корне А');
  assert(tb.every(x => inTree(x.id, RB.rootFolderId)) && !tb.some(x => inTree(x.id, RA.rootFolderId)), 'дерево Б в корне Б');
  assert.strictEqual(providerLoose(), 0, 'ни одной папки вне Дисков клиентов');
  // ИЗВЕСТНОЕ ОГРАНИЧЕНИЕ: папки, созданные скриптом от имени поставщика, принадлежат поставщику (так устроен «Мой диск» Google)
  PROVIDER_OWNED_IN_CLIENT_TREES = ownedBy(PROVIDER);
  assert.strictEqual(A._tsTenantSpreadsheetId_(), RA.spreadsheetId); assert.strictEqual(B._tsTenantSpreadsheetId_(), RB.spreadsheetId);
  assert.strictEqual(A._ts2Ent_(), ctl.enterpriseIdOf_(ctl.findBy('Organizations', 'ID', OA)));
});
t('А не получает доступ к папкам и файлам Б, хотя поставщик видит оба Диска', () => {
  const bInbox = B._ts2Folder_('INBOX'), bFile = bInbox.createFile({ name: 'накладная Б.pdf' });
  assert(GA.DriveApp.getFileById(bFile.getId()), 'поставщик технически видит файл Б');
  THROWS(() => A._tsTenantAssertFileWithin_(bFile.getId(), 'INBOX'), /TENANT_BOUNDARY/, 'файл Б в INBOX А');
  THROWS(() => A._tsTenantAssertFolderWithin_(RB.rootFolderId, 'ROOT'), /TENANT_BOUNDARY/, 'корень Б');
  const aFile = A._ts2Folder_('INBOX').createFile({ name: 'накладная А.pdf' }); assert(A._tsTenantAssertFileWithin_(aFile.getId(), 'INBOX'));
  THROWS(() => A._tsTenantAssertFileWithin_(aFile.getId(), 'PHOTO'), /TENANT_BOUNDARY/, 'свой файл, но не в той папке');
});
t('подмена реестра папок: папка Б в DRIVE_REGISTRY А или строка другого предприятия — отказ', () => {
  const bPhoto = B._ts2Folder_('PHOTO').getId(), aPhoto = A._ts2Folder_('PHOTO').getId();
  A._ts2Update_('DRIVE_REGISTRY', 'logicalCode', 'PHOTO', { googleId: bPhoto });
  THROWS(() => A._ts2Folder_('PHOTO'), /TENANT_BOUNDARY/, 'папка Б вместо фото А');
  A._ts2Update_('DRIVE_REGISTRY', 'logicalCode', 'PHOTO', { googleId: aPhoto, enterpriseId: 'ENT-ЧУЖОЕ' });
  THROWS(() => A._ts2Folder_('PHOTO'), /TENANT_BOUNDARY/, 'строка реестра другого предприятия');
  A._ts2Update_('DRIVE_REGISTRY', 'logicalCode', 'PHOTO', { enterpriseId: A._ts2Ent_() }); assert.strictEqual(A._ts2Folder_('PHOTO').getId(), aPhoto);
});
t('таблица чужого предприятия: ENTERPRISE_ID в таблице не совпадает с конфигурацией проекта — работа останавливается', () => {
  const saved = A._ts2Find_('SYSTEM_CONFIG', 'key', 'ENTERPRISE_ID').value;
  A._ts2Update_('SYSTEM_CONFIG', 'key', 'ENTERPRISE_ID', { value: B._ts2Ent_() });
  THROWS(() => A._ts2Ent_(), /TENANT_BOUNDARY/);
  A._ts2Update_('SYSTEM_CONFIG', 'key', 'ENTERPRISE_ID', { value: saved }); assert.strictEqual(A._ts2Ent_(), saved);
});
t('перенос «старых» папок по имени не трогает чужие ресурсы в tenant-режиме', () => {
  const decoy = B._ts2Folder_('JOURNALS').createFolder('MON CHEF — Журналы'); decoy.createFile({ name: 'журнал Б' });
  const before = JSON.stringify(items[decoy.getId()].parents);
  const j = A._tsTreeFolder_('JOURNALS', '', ['MON CHEF — Журналы']);
  assert(inTree(j.getId(), RA.rootFolderId)); assert.strictEqual(JSON.stringify(items[decoy.getId()].parents), before, 'папка Б не перемещена');
  assert(!Object.values(items).some(x => x.name === 'журнал Б' && inTree(x.id, RA.rootFolderId)), 'файлы Б не попали к А');
});
t('fail-closed: нет конфигурации или корня — отказ, без создания папок на Диске поставщика', () => {
  const c = clientFor(OA); c.TS_TENANT_CONFIG_.rootFolderId = ''; c.TS2_TENANT_ROOT_ID = ''; c.PropertiesService.getScriptProperties().deleteProperty('TS_TENANT_ROOT_ID');
  const items0 = Object.keys(items).length;
  THROWS(() => c._ts2Folder_('ROOT'), /TENANT_STORAGE_NOT_CONFIGURED/);
  const d = clientFor(OA); d.TS_TENANT_CONFIG_.spreadsheetId = ''; THROWS(() => d._tsTenantSpreadsheetId_(), /TENANT_STORAGE_NOT_CONFIGURED/);
  assert.strictEqual(Object.keys(items).length, items0, 'ничего не создано'); assert.strictEqual(providerLoose(), 0);
});
t('проверка целостности: А — PASS; файл реестра документов А оказался у Б — FAIL с указанием файла', () => {
  const r = A._ts4TenantIntegrity_(); assert.strictEqual(r.status, 'PASS', JSON.stringify(r.checks.filter(x => x.status !== 'PASS')));
  const bf = B._ts2Folder_('INBOX').createFile({ name: 'чужой.pdf' });
  A._ts2Insert_('FILES', { fileId: 'FILE-X', enterpriseId: A._ts2Ent_(), googleFileId: bf.getId() });
  const r2 = A._ts4TenantIntegrity_(), fc = r2.checks.find(x => x.check === 'REGISTERED_DOCUMENT_FILES');
  assert(r2.status === 'FAIL' && fc.status === 'FAIL' && /FILE-X/.test(fc.detail), JSON.stringify(fc));
  assert.strictEqual(B._ts4TenantIntegrity_().status, 'PASS', 'у Б всё в порядке');
});
t('клиент отозвал доступ поставщика: операции А завершаются отказом, данные А не перемещаются, Б продолжает работать', () => {
  const rootA = items[RA.rootFolderId]; rootA.editors = rootA.editors.filter(e => e !== PROVIDER);
  const c = clientFor(OA);
  THROWS(() => c._ts2Folder_('ROOT'), /TENANT_STORAGE_UNAVAILABLE/);
  assert.strictEqual(providerLoose(), 0, 'запасная папка у поставщика не создана');
  assert(B._ts2Folder_('INBOX'), 'Б работает'); assert.strictEqual(items[RA.spreadsheetId].owner, CA, 'таблица А у клиента А');
});

/* ------------------------------------------------------------------ P1-2: проект у поставщика, выполнение от имени клиента */
const CC = 'owner-c@cafe-c.example'; let LC, RC, OC, apiCalls = [];
t('P1-2 CONTROL: отдельный проект поставщика без привязки к таблице; служебное развёртывание (без входа) и рабочее USER_ACCESSING', () => {
  LC = lic('Кафе В'); OC = LC.id; RC = bootstrapFor(CC, LC, 'Кафе В').tsTenantBootstrapStart();
  ctl.update('Organizations', OC, { 'Allowed Google Accounts': 'chef@cafe-c.example, ' + CC });
  GA.PropertiesService.getScriptProperties().setProperty('MASTER_SCRIPT_ID', 'MASTER');
  const master = { files: [{ name: 'appsscript', type: 'JSON', source: fs.readFileSync(path.join(root, 'app', 'appsscript.json'), 'utf8') },
    { name: 'TS2_Core', type: 'SERVER_JS', source: fs.readFileSync(path.join(root, 'app', 'TS2_Core.gs'), 'utf8') }, { name: 'Code', type: 'SERVER_JS', source: "var SHEET_ID        = 'OLD';" }] };
  let v = 0, dn = 0; const content = {};
  ctl.scriptApi_ = (m, p, b) => { apiCalls.push({ m, p, b: JSON.parse(JSON.stringify(b || null)) });
    if (m === 'post' && p === '') return { scriptId: 'SCRIPT-C' }; if (m === 'get') return master; if (m === 'put' && /content$/.test(p)) { content.last = b; return {}; }
    if (m === 'post' && /versions$/.test(p)) return { versionNumber: ++v }; if (m === 'post' && /deployments$/.test(p)) { dn++; return { deploymentId: 'DEP' + dn, entryPoints: [{ entryPointType: 'WEB_APP', webApp: { url: 'https://script.google.com/macros/s/DEP' + dn + '/exec' } }] }; }
    return {}; };
  const res = ctl.adminProvision(T, OC); assert(res.ok, JSON.stringify(res));
  const create = apiCalls.find(c => c.m === 'post' && c.p === ''); assert(create && !('parentId' in create.b), 'проект не привязан к таблице клиента');
  const puts = apiCalls.filter(c => c.m === 'put' && /content$/.test(c.p)).map(c => c.b.files);
  const man = f => JSON.parse(f.find(x => x.name === 'appsscript').source).webapp, cfg = f => JSON.parse(/var TS_TENANT_CONFIG_ = (\{.*?\});/.exec(f.find(x => x.name === 'TS2_Core').source)[1]);
  assert.deepStrictEqual(man(puts[0]), { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' }, 'служебное — без входа');
  assert.deepStrictEqual(man(puts[1]), { executeAs: 'USER_ACCESSING', access: 'ANYONE' }, 'рабочее — от имени открывшего, только вошедшие');
  const c1 = cfg(puts[1]); assert(c1.execution === 'USER_ACCESSING' && c1.ownerEmail === CC && c1.allowedEmails.includes('chef@cafe-c.example') && c1.serviceUrl === 'https://script.google.com/macros/s/DEP1/exec', JSON.stringify(c1));
  const oc = ctl.findBy('Organizations', 'ID', OC); assert(oc['App URL'] === 'https://script.google.com/macros/s/DEP2/exec' && oc['Service URL'] === 'https://script.google.com/macros/s/DEP1/exec' && oc['Script ID'] === 'SCRIPT-C');
  // обновление релизом: новые версии, те же развёртывания, клиентские данные не трогаются
  apiCalls = []; const up = ctl.updateOneOrg_(oc, master, '2.3.0');
  assert(!apiCalls.some(c => c.m === 'post' && /deployments$/.test(c.p)), 'новых развёртываний нет'); assert.strictEqual(apiCalls.filter(c => c.m === 'put' && /deployments\/DEP[12]$/.test(c.p)).length, 2);
  assert(!apiCalls.some(c => /spreadsheets|drive/i.test(c.p)), 'API Диска и таблиц при обновлении не вызываются'); assert.strictEqual(up.execution, 'USER_ACCESSING');
});
let C3;
t('P1-2 клиент: код выполняется от имени владельца предприятия — все папки и файлы принадлежат клиенту, квота поставщика не расходуется', () => {
  const before = ownedBy(PROVIDER);
  C3 = clientFor(OC, CC); assert(C3._tsExecAccessing_() && C3._tsIdentityAllowed_() && !C3._tsIdentityAllowed_('stranger@x.example'));
  C3._ts2EnsureSchema_(true); const tree = C3._ts2EnsureDriveTree_();
  const doc = C3._ts2Folder_('GEN_PPK').createFile({ name: 'ППК.pdf' }), arc = C3._ts2Folder_('ARCHIVE').createFile({ name: 'Архив ноябрь' }), bk = C3._ts2Folder_('SYS_BACKUPS').createFile({ name: 'backup' });
  C3._ts2Insert_('FILES', { fileId: 'F1', enterpriseId: C3._ts2Ent_(), googleFileId: C3._ts2Folder_('INBOX').createFile({ name: 'накладная.pdf' }).getId() });
  C3._ts2Insert_('BACKUP_CATALOG', { backupId: 'B1', enterpriseId: C3._ts2Ent_(), backupType: 'MANUAL', fileId: bk.getId() });
  const inC = Object.values(items).filter(x => ancestors(x.id).includes(RC.rootFolderId));
  assert(tree.length > 20 && inC.length > 25 && inC.every(x => x.owner === CC), 'всё в дереве В принадлежит клиенту В: ' + JSON.stringify(inC.filter(x => x.owner !== CC).map(x => x.name)));
  assert.strictEqual(ownedBy(PROVIDER), before, 'ни одного нового объекта у поставщика');
  [doc, arc, bk].forEach(f => assert.strictEqual(items[f.getId()].owner, CC));
  assert.strictEqual(C3._tsPublicUrl_(), 'https://script.google.com/macros/s/DEP1/exec', 'датчики и QR — на служебный адрес');
});
t('P1-2 проверка владельцев: у В — PASS; у А (дерево создано от имени поставщика) в режиме USER_ACCESSING — FAIL с примерами', () => {
  const r = C3._ts4TenantIntegrity_(), own = r.checks.find(x => x.check === 'OWNERSHIP');
  assert(own.status === 'PASS' && own.detail.checked > 25 && own.detail.foreign === 0, JSON.stringify(own));
  items[RA.rootFolderId].editors.push(PROVIDER);   // вернуть доступ после сценария отзыва
  ctl.update('Organizations', OA, { 'Execution Model': 'USER_ACCESSING' }); const A2 = clientFor(OA, CA);
  const own2 = A2._ts4TenantIntegrity_().checks.find(x => x.check === 'OWNERSHIP'); assert(own2.status === 'FAIL' && /provider@/.test(own2.detail), JSON.stringify(own2).slice(0, 300));
});
t('P1-2 изоляция при выполнении от имени клиента: аккаунт Б не проходит в систему В; файлы А недоступны коду В физически', () => {
  const asB = clientFor(OC, CB); assert(!asB._tsIdentityAllowed_(), 'аккаунт Б не подключён к В');
  THROWS(() => C3._tsTenantAssertFileWithin_(Object.values(items).find(x => x.name === 'накладная А.pdf').id, 'INBOX'), /TENANT_BOUNDARY/);
  THROWS(() => driveFor(CC).getFileById(Object.values(items).find(x => x.name === 'накладная А.pdf').id), /permission/, 'у клиента В нет прав на Диск А');
});
t('P1-2 отзыв доступа поставщика не мешает клиенту В и не уничтожает его документы', () => {
  items[RC.rootFolderId].editors = items[RC.rootFolderId].editors.filter(e => e !== PROVIDER);
  const again = clientFor(OC, CC); assert(again._ts2Folder_('INBOX').createFile({ name: 'после отзыва' }), 'клиент работает от своего имени');
  assert(Object.values(items).filter(x => ancestors(x.id).includes(RC.rootFolderId)).every(x => !x.trashed && x.owner === CC), 'документы на месте и у клиента');
  THROWS(() => driveFor(PROVIDER).getFolderById(RC.rootFolderId), /permission/, 'поставщик доступа больше не имеет');
});
console.log('Изоляция двух предприятий (модель Google Диска): ' + n + ' сценариев пройдено');
console.log('  ОГРАНИЧЕНИЕ: объектов в деревьях клиентов, владелец которых — аккаунт поставщика: ' + PROVIDER_OWNED_IN_CLIENT_TREES + ' (создаются клиентским кодом, работающим от имени поставщика)');
