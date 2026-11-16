'use strict';
// Граница доступа сервера (аудит 16.11.2026: C-01 файлы без входа, C-02 вызовы функций без сессии).
// Настоящий server.js в отдельном процессе, запросы по HTTP — как из браузера постороннего.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const gw = require('../lib/gateway');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tsekh-sec-'));
const tenants = require('../lib/tenants');

const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}`;
let srv, T, A, TOKEN = '', FILE = '', FOLDER = '', ADMIN_FILE = '';

const rpc = async (p, fn, args, headers = {}) => {
  const r = await fetch(`${BASE}${p}/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ fn, args }) });
  return { status: r.status, cookie: r.headers.get('set-cookie') || '', body: await r.json() };
};
const failed = (v) => { const x = typeof v === 'string' ? JSON.parse(v) : v; return x && (x.ok === false || x.success === false); };

test.before(async () => {
  tenants.create({ slug: 'sec-kafe', name: 'Тест', ownerEmail: 'owner@example.ru', timeZone: 'Europe/Moscow' });
  T = tenants.get('sec-kafe');
  T.execute((res) => () => {
    TOKEN = res('_createSession_')({ id: 'E1', fullName: 'Директор Иванова', position: 'Директор', role: 'Директор' }, res('_mcRbEffective_')('Директор', 'E1')).token;
    const folder = res('DriveApp').createFolder('Медкнижки');
    FOLDER = folder.getId();
    FILE = folder.createFile(res('Utilities').newBlob('секрет', 'text/plain', 'медкнижка.txt')).getId();
  });
  tenants.createAdmin({ ownerEmail: 'owner@example.ru' });
  A = tenants.get(tenants.ADMIN_SLUG);
  A.execute('setupAdmin', []);
  ADMIN_FILE = A.execute((res) => () => res('DriveApp').createFile(res('Utilities').newBlob('счёт', 'text/plain', 'счёт.txt')).getId());
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), SINGLE_PROCESS: '1', ROLE: 'web', APP_URL: BASE, LOGIN_RATE: '5' }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((ok, bad) => { srv.stdout.on('data', (b) => { if (/http:\/\/0\.0\.0\.0/.test(String(b))) ok(); }); srv.on('exit', bad); });
});
test.after(() => { try { srv.kill(); } catch (e) {} fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); });

test('C-02: без сессии служебные и рабочие функции предприятия не выполняются', async () => {
  for (const fn of ['getData', 'migrateAllPinsToHash', 'createSystemBackup', 'getEvents', 'getAuditLog']) {
    const r = await rpc('/t/sec-kafe', fn, []);
    assert.ok(r.body.ok === false || failed(r.body.value), `${fn}: ${JSON.stringify(r.body)}`);
    if (r.body.ok) assert.match(String(r.body.value), /AUTH_REQUIRED/);
  }
});

test('C-02: doGet, служебные с «_», несуществующие — недоступны', async () => {
  for (const fn of ['doGet', 'doPost', '_getSession_', 'eval', 'нет', 'noSuchFunction', 'MC_GATE_CLIENT_']) {
    const r = await rpc('/t/sec-kafe', fn, []);
    assert.strictEqual(r.body.ok, false, fn);
  }
});

test('C-02: с сессией разрешённая функция работает', async () => {
  const r = await rpc('/t/sec-kafe', 'uiMe', [TOKEN, { __mct: TOKEN }]);
  assert.strictEqual(r.body.ok, true, JSON.stringify(r.body));
  assert.ok(!/AUTH_REQUIRED/.test(JSON.stringify(r.body.value)), JSON.stringify(r.body.value));
});

test('C-02: админ-панель — служебные функции закрыты, admin… без ключа отказывают', async () => {
  for (const fn of ['setupAdmin', 'readAll', 'getSetting', 'setSetting', 'update', 'removeRow', 'tariffs', 'session']) {
    const r = await rpc('/admin', fn, ['Users']);
    assert.strictEqual(r.body.ok, false, `${fn}: ${JSON.stringify(r.body).slice(0, 200)}`);
  }
  const r = await rpc('/admin', 'adminClients', ['']);
  assert.strictEqual(r.body.ok, true);
  assert.strictEqual(r.body.value.ok, false);
});

test('C-01: файл, лист и папка без входа не отдаются', async () => {
  for (const p of [`/t/sec-kafe/file/${FILE}`, `/t/sec-kafe/folder/${FOLDER}`, `/t/sec-kafe/file/${FILE}?download=1`, `/admin/file/${ADMIN_FILE}`]) {
    const r = await fetch(BASE + p);
    assert.strictEqual(r.status, 401, p);
    assert.ok(!(await r.text()).includes('секрет'));
  }
  const bad = await fetch(`${BASE}/t/sec-kafe/file/${FILE}`, { headers: { cookie: `${gw.COOKIE}=fake-key-0123456789` } });
  assert.strictEqual(bad.status, 401);
});

test('C-01: после вызова с сессией сервер ставит cookie, и файл открывается', async () => {
  const r = await rpc('/t/sec-kafe', 'uiMe', [TOKEN, { __mct: TOKEN }]);
  assert.match(r.cookie, new RegExp(`^${gw.COOKIE}=`));
  assert.match(r.cookie, /HttpOnly/);
  assert.match(r.cookie, /Path=\/t\/sec-kafe\//);
  const cookie = r.cookie.split(';')[0];
  const f = await fetch(`${BASE}/t/sec-kafe/file/${FILE}`, { headers: { cookie } });
  assert.strictEqual(f.status, 200);
  assert.strictEqual(await f.text(), 'секрет');
  const d = await fetch(`${BASE}/t/sec-kafe/folder/${FOLDER}`, { headers: { cookie } });
  assert.strictEqual(d.status, 200);
  // ключ одного предприятия не открывает файлы админ-панели
  const other = await fetch(`${BASE}/admin/file/${ADMIN_FILE}`, { headers: { cookie } });
  assert.strictEqual(other.status, 401);
});

test('C-01: ключ страницы в заголовке x-ts-session тоже даёт cookie (вызовы, где ключ — обычный аргумент)', async () => {
  const r = await rpc('/t/sec-kafe', 'uiMe', [TOKEN], { 'x-ts-session': TOKEN });
  assert.match(r.cookie, new RegExp(`^${gw.COOKIE}=`));
});

test('C-01: выход стирает cookie', async () => {
  const r = await rpc('/t/sec-kafe', 'destroySession', [TOKEN], { cookie: `${gw.COOKIE}=${TOKEN}` });
  assert.match(r.cookie, /Max-Age=0/);
});

test('вход: частые попытки с одного адреса ограничены', async () => {
  let last;
  for (let i = 0; i < 7; i++) last = await rpc('/admin', 'adminLogin', ['x@example.ru', 'неверный']);
  assert.strictEqual(last.body.ok, false);
  assert.match(last.body.error.message, /Слишком много попыток/);
});

test('rpcAllowed: правила списка', () => {
  const gated = Object.assign(() => 0, { __mcGate: 'client' });
  assert.strictEqual(gw.rpcAllowed('tenant', 'saveDish', gated), true);
  assert.strictEqual(gw.rpcAllowed('tenant', 'saveDish', () => 0), false);
  assert.strictEqual(gw.rpcAllowed('tenant', 'doGet', Object.assign(() => 0, { __mcGate: 'entry' })), false);
  assert.strictEqual(gw.rpcAllowed('tenant', 'x_', gated), false);
  assert.strictEqual(gw.rpcAllowed('admin', 'adminClients', () => 0), true);
  assert.strictEqual(gw.rpcAllowed('admin', 'readAll', () => 0), false);
  assert.strictEqual(gw.rpcAllowed('admin', 'administrator', () => 0), false);
});
