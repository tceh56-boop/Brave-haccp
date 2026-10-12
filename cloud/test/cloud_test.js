// Облачная версия ЦЕХ: хранилище, перенос данных, HTTP-сервер.
// Запуск: DATABASE_URL=postgres://... node cloud/test/cloud_test.js
const assert = require('assert'), http = require('http'), path = require('path');
const { createRuntime, formatDate } = require('../src/runtime');
const { createServer, tickFromBody } = require('../src/server');
const { importExport } = require('../src/import');

let failures = 0;
async function step(name, fn) {
  try { await fn(); console.log('OK   ', name); }
  catch (e) { failures++; console.log('FAIL ', name, '—', e && e.message); }
}
function request(port, method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => { const t = Buffer.concat(chunks).toString('utf8'); let j = null; try { j = JSON.parse(t); } catch (e) { /* html */ } resolve({ status: res.statusCode, text: t, json: j, headers: res.headers }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  if (!process.env.DATABASE_URL) { console.error('Задайте DATABASE_URL.'); process.exit(1); }
  const rt = createRuntime({ logger: () => {} });
  rt.store.wipeAll();
  const G = rt.ctx;

  await step('даты по Москве: 21:30 UTC — уже завтра; литералы формата', () => {
    assert.equal(formatDate(new Date('2026-10-11T21:30:00Z'), 'Europe/Moscow', 'yyyy-MM-dd'), '2026-10-12');
    assert.equal(formatDate(new Date('2026-10-11T21:30:00Z'), 'Europe/Moscow', 'HH:mm'), '00:30');
    assert.equal(formatDate(new Date('2026-10-11T21:30:00Z'), 'Europe/Moscow', "yyyy-MM-dd'T'HH:mm:ss"), '2026-10-12T00:30:00');
    assert.equal(formatDate(new Date('2026-10-11T21:30:00Z'), 'Europe/Moscow', 'yyMMdd'), '261012');
    assert.equal(formatDate(new Date('2026-10-11T21:30:00Z'), 'Europe/Moscow', 'H'), '0');
  });

  await step('лист: добавление, запись диапазона, даты, заголовок A1, удаление строк со сдвигом', () => {
    const sh = rt.store.spreadsheet.insertSheet('T_DEMO');
    assert.equal(sh.getDataRange().getA1Notation(), 'A1');
    sh.getRange(1, 1, 1, 3).setValues([['id', 'имя', 'когда']]);
    const d = new Date('2026-10-12T09:00:00Z');
    sh.appendRow(['1', 'Борщ', d]); sh.appendRow(['2', 'Солянка', '']); sh.appendRow(['3', 'Котлета', 5]);
    assert.equal(sh.getRange('A1').getValue(), 'id');
    const v = sh.getDataRange().getValues();
    assert(v[1][2] instanceof Date && v[1][2].getTime() === d.getTime(), 'дата вернулась датой');
    assert.deepEqual(v.map(r => r[1]), ['имя', 'Борщ', 'Солянка', 'Котлета']);
    sh.getRange(3, 2).setValue('Солянка сборная');
    sh.deleteRows(2, 1);
    assert.deepEqual(sh.getDataRange().getValues().map(r => r[1]), ['имя', 'Солянка сборная', 'Котлета']);
    assert.equal(sh.getLastRow(), 3); assert.equal(sh.getLastColumn(), 3);
    rt.store.spreadsheet.deleteSheet(sh);
    assert.equal(rt.store.spreadsheet.getSheetByName('T_DEMO'), null);
  });

  await step('свойства: в базе; секрет из окружения TSEKH_PROP_* перекрывает базу и не пишется в неё', () => {
    process.env.TSEKH_PROP_DEMO_TOKEN = 'из-lockbox';
    const { createStore } = require('../src/store');
    const s2 = createStore(rt.db);
    s2.properties.setProperty('DEMO_TOKEN', 'в-базе');
    assert.equal(s2.properties.getProperty('DEMO_TOKEN'), 'из-lockbox');
    assert.equal(rt.db.query("SELECT value FROM tsekh_props WHERE key = 'DEMO_TOKEN'")[0].value, 'в-базе');
    s2.properties.deleteProperty('DEMO_TOKEN'); delete process.env.TSEKH_PROP_DEMO_TOKEN;
  });

  await step('блокировка записи — общая через PostgreSQL: второе соединение её не получит', () => {
    const { createSyncPg } = require('../src/syncpg');
    const { createStore } = require('../src/store');
    const other = createSyncPg(process.env.DATABASE_URL), s2 = createStore(other);
    assert(rt.store.lock.tryLock(1000));
    assert.equal(s2.lock.tryLock(100), false, 'чужой экземпляр ждёт');
    rt.store.lock.releaseLock();
    assert(s2.lock.tryLock(1000)); s2.lock.releaseLock();
    other.close();
  });

  let director;
  await step('установка: setupProduction создаёт листы и первого директора; повтор безопасен', () => {
    const res = G.setupProduction();
    director = res.director;
    assert(director.created && /^\d{6}$/.test(String(director.pin)), 'PIN директора');
    assert(rt.db.query('SELECT count(*)::int AS n FROM tsekh_sheets')[0].n > 100);
    assert.equal(G.setupProduction().director.created, false);
  });

  // HTTP
  const srv = createServer(rt, { cronSecret: 'cron-secret-42', trustTrigger: false });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  let token;
  await step('GET / — интерфейс с заменой google.script.run на fetch', async () => {
    const r = await request(port, 'GET', '/');
    assert.equal(r.status, 200); assert(/text\/html/.test(r.headers['content-type']));
    assert(r.text.indexOf("fetch('api'") !== -1 && r.text.indexOf("defineProperty(window.google.script, 'run'") !== -1);
    assert.equal(r.headers['x-frame-options'], 'DENY');
  });
  await step('POST /api: список для входа, вход директора по PIN, сессия', async () => {
    const users = await request(port, 'POST', '/api', { action: 'GET_USERS_FOR_LOGIN', data: {} });
    assert(users.json.ok && users.json.data.some(u => u.user_id === director.user_id));
    const bad = await request(port, 'POST', '/api', { action: 'LOGIN', data: { userId: director.user_id, pin: '000000' } });
    assert.equal(bad.json.ok, false);
    const login = await request(port, 'POST', '/api', { action: 'LOGIN', data: { userId: director.user_id, pin: String(director.pin) } });
    assert(login.json.ok, login.text);
    token = login.json.data.token;
    if (login.json.data.requires_location) token = (await request(port, 'POST', '/api', { action: 'SELECT_LOCATION', data: { locationId: director.location_id }, token })).json.data.token || token;
    const ov = await request(port, 'POST', '/api', { action: 'ALCO_GET_OVERVIEW', data: {}, token });
    assert(ov.json.ok, ov.text);
  });
  await step('POST /api: ошибки запроса — понятные ответы', async () => {
    assert.equal((await request(port, 'POST', '/api', '{не json')).status, 400);
    assert.equal((await request(port, 'POST', '/api', {})).status, 400);
    const big = await request(port, 'POST', '/api', JSON.stringify({ action: 'X', data: 'x'.repeat(16 * 1024 * 1024) })).catch(e => ({ status: 413 }));
    assert.equal(big.status, 413);
    assert.equal((await request(port, 'GET', '/' + encodeURIComponent('нет'))).status, 404);
  });
  await step('/cron: без секрета — 403; с секретом — задача выполнена; формат таймера Yandex Cloud', async () => {
    assert.equal((await request(port, 'POST', '/cron', { tick: 'tick15m_' })).status, 403);
    const ok = await request(port, 'POST', '/cron', { tick: 'tick15m_' }, { 'X-Tsekh-Cron': 'cron-secret-42' });
    assert.equal(ok.status, 200, ok.text); assert.deepEqual(ok.json, { ok: true, tick: 'tick15m_' });
    const bad = await request(port, 'POST', '/cron', { tick: 'eval' }, { 'X-Tsekh-Cron': 'cron-secret-42' });
    assert.equal(bad.status, 500, 'неизвестная задача не запускается');
    assert.equal(tickFromBody(JSON.stringify({ messages: [{ details: { payload: 'tickHourly_' } }] })), 'tickHourly_');
    assert.equal((await request(port, 'POST', '/cron', { messages: [{ details: { payload: 'tick15m_' } }] })).status, 403, 'триггер не доверен по умолчанию');
  });
  await step('/health', async () => { assert.deepEqual((await request(port, 'GET', '/health')).json, { ok: true }); });
  srv.close();

  await step('перенос: выгрузка CloudExport.gs со стенда → загрузка в PostgreSQL → вход тем же PIN', () => {
    // Выгрузка — тем же кодом, что в Apps Script, но на имитации таблицы (отдельный процесс-стенд).
    const { execFileSync } = require('child_process');
    const dump = execFileSync(process.execPath, [path.join(__dirname, 'make_export.js')], { env: Object.assign({}, process.env, { TSEKH_BACKEND: '' }), maxBuffer: 64 * 1024 * 1024 }).toString();
    const data = JSON.parse(dump);
    assert(data.secrets_not_exported.indexOf('TELEGRAM_BOT_TOKEN') !== -1 && !('TELEGRAM_BOT_TOKEN' in data.properties), 'секрет не выгружен');
    assert.throws(() => importExport(rt.db, rt.store, data, {}), /уже есть данные/);
    const res = importExport(rt.db, rt.store, data, { replace: true });
    assert(res.строк > 0);
    rt.store.resetRequestState();
    const login = rt.runOperation('LOGIN', { userId: 'USR-EXP', pin: '482915' }, null);
    assert(login.ok, JSON.stringify(login));
    const tok = login.data.requires_location ? rt.runOperation('SELECT_LOCATION', { locationId: 'LOC-1' }, login.data.token).data.token : login.data.token;
    const shift = rt.runOperation('POS_GET_SHIFT', {}, tok);
    assert(shift.ok && shift.data && shift.data.shift && shift.data.shift.статус === 'открыта', JSON.stringify(shift));
    const b = rt.ctx.findRows_('BATCHES', x => x.batch_id === 'B-EXP')[0];
    assert(b && new Date(b.срок_годности).toISOString().slice(0, 10) === '2099-01-01', 'дата осталась датой');
  });

  rt.close();
  console.log(failures ? '\n' + failures + ' FAILED' : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})();
