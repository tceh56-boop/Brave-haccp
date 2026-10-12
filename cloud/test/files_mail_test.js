// Облако: файлы (база и Object Storage) и почта (Postbox). Запуск: DATABASE_URL=... node cloud/test/files_mail_test.js
const assert = require('assert'), http = require('http'), path = require('path'), { spawn } = require('child_process');
const { createRuntime } = require('../src/runtime');
const { createServer } = require('../src/server');
const { flushMail } = require('../src/mail');

let failures = 0;
async function step(name, fn) { try { await fn(); console.log('OK   ', name); } catch (e) { failures++; console.log('FAIL ', name, '—', e && e.message); } }
function get(port, p, headers) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p, headers: headers || {} }, res => { const c = []; res.on('data', x => c.push(x)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c), headers: res.headers })); }).on('error', reject);
  });
}
function startMock() {
  return new Promise((resolve, reject) => {
    const ch = spawn(process.execPath, [path.join(__dirname, 'mock_yc.js'), '0']);
    ch.stdout.on('data', d => { const m = /ready (\d+)/.exec(String(d)); if (m) resolve({ ch, port: Number(m[1]) }); });
    ch.on('error', reject);
  });
}
const PDF = Buffer.from('%PDF-1.4\n% тестовый сертификат\n%%EOF\n');

function seed(rt) {
  const G = rt.ctx;
  G.initializeDatabase();
  [['ORG-1', 'LOC-1', 'USR-1', '482915'], ['ORG-2', 'LOC-2', 'USR-2', '615283']].forEach(([o, l, u, pin]) => {
    G.insertRow_('ORGANIZATIONS', { organization_id: o, название: o, статус: 'активна' });
    G.insertRow_('LOCATIONS', { location_id: l, organization_id: o, название: l, статус: 'активна' });
    G.insertRow_('USERS', { user_id: u, organization_id: o, location_ids: l, имя: 'Директор ' + o, роль: 'ДИРЕКТОР', статус: 'активен', pin_hash: G.hashPin_(pin, 's' + u), pin_salt: 's' + u, failed_attempts: 0, lockout_count: 0 });
  });
  const login = (u, p, l) => { const d = rt.runOperation('LOGIN', { userId: u, pin: p }, null).data; return d.requires_location ? rt.runOperation('SELECT_LOCATION', { locationId: l }, d.token).data.token : d.token; };
  return { t1: login('USR-1', '482915', 'LOC-1'), t2: login('USR-2', '615283', 'LOC-2') };
}

(async () => {
  if (!process.env.DATABASE_URL) { console.error('Задайте DATABASE_URL.'); process.exit(1); }
  const mock = await startMock();
  const env = Object.assign({}, process.env, { YC_ACCESS_KEY_ID: 'test-key-id', YC_SECRET_ACCESS_KEY: 'test-secret' });
  delete env.TSEKH_S3_BUCKET; delete env.TSEKH_MAIL_FROM;

  // 1. Файлы в базе (без Object Storage).
  let rt = createRuntime({ logger: () => {}, env });
  rt.store.wipeAll();
  let tok = seed(rt);
  const srv = createServer(rt, { cronSecret: 'x' });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  let doc;
  await step('документ поставщика через действие ЦЕХ: файл в базе, привязан к организации', () => {
    const r = rt.runOperation('UPLOAD_SUPPLIER_DOCUMENT', { docType: rt.ctx.SUPPLIER_DOCUMENT_TYPES[0], base64Data: PDF.toString('base64'), fileName: 'сертификат.pdf', mimeType: 'application/pdf' }, tok.t1);
    assert(r.ok, JSON.stringify(r));
    doc = r.data;
    const row = rt.db.query('SELECT storage, organization_id, size, name FROM tsekh_files WHERE id = $1', [doc.file_id])[0];
    assert.deepEqual([row.storage, row.organization_id, row.size, row.name], ['pg', 'ORG-1', PDF.length, 'сертификат.pdf']);
    const folders = rt.db.query("SELECT name FROM tsekh_folders WHERE parent_id = 'root'").map(x => x.name);
    assert(folders.length === 1, 'папка документов поставщиков создана один раз');
  });
  await step('скачивание: своя организация — файл; чужая — 404; без входа — 401; кривой id — 404', async () => {
    const ok = await get(port, '/files/' + doc.file_id, { 'X-Tsekh-Token': tok.t1 });
    assert.equal(ok.status, 200); assert(ok.body.equals(PDF)); assert.equal(ok.headers['content-type'], 'application/pdf');
    assert.equal(ok.headers['content-security-policy'], 'sandbox');
    assert(/filename\*=UTF-8''%D1%81/.test(ok.headers['content-disposition']));
    assert.equal((await get(port, '/files/' + doc.file_id, { 'X-Tsekh-Token': tok.t2 })).status, 404);
    assert.equal((await get(port, '/files/' + doc.file_id)).status, 401);
    assert.equal((await get(port, '/files/' + doc.file_id, { 'X-Tsekh-Token': 'not-a-token' })).status, 401);
    assert.equal((await get(port, '/files/../../etc/passwd', { 'X-Tsekh-Token': tok.t1 })).status, 404);
  });
  await step('интерфейс в облаке: ссылки на файлы — «files/<id>» и скачивание с токеном в заголовке', async () => {
    const html = (await get(port, '/')).body.toString('utf8');
    assert(html.includes('window.TSEKH_CLOUD = true') && html.includes("'X-Tsekh-Token'"));
    assert(html.includes("function tsekhFileHref(fileId)"));
  });
  srv.close(); rt.close();

  // 2. Файлы в Object Storage (имитация с проверкой подписи).
  const envS3 = Object.assign({}, env, { TSEKH_S3_BUCKET: 'tsekh-files', TSEKH_S3_ENDPOINT: 'http://127.0.0.1:' + mock.port });
  rt = createRuntime({ logger: () => {}, env: envS3 });
  rt.store.wipeAll();
  tok = seed(rt);
  await step('Object Storage: файл уходит в бакет (подпись проверена), в базе только карточка; читается обратно', () => {
    const r = rt.runOperation('UPLOAD_SUPPLIER_DOCUMENT', { docType: rt.ctx.SUPPLIER_DOCUMENT_TYPES[0], base64Data: PDF.toString('base64'), fileName: 'декларация.pdf', mimeType: 'application/pdf' }, tok.t1);
    assert(r.ok, JSON.stringify(r));
    const row = rt.db.query('SELECT storage, s3_key, data FROM tsekh_files WHERE id = $1', [r.data.file_id])[0];
    assert.equal(row.storage, 's3'); assert.equal(row.data, null); assert.equal(row.s3_key, 'files/ORG-1/' + r.data.file_id);
    const back = rt.files.readForDownload(r.data.file_id);
    assert(Buffer.from(back.bytes).equals(PDF));
  });
  await step('Object Storage: неверный ключ — понятная ошибка, операция не проходит', () => {
    const bad = createRuntime({ logger: () => {}, env: Object.assign({}, envS3, { YC_SECRET_ACCESS_KEY: 'чужой' }), migrate: false });
    const t = bad.runOperation('LOGIN', { userId: 'USR-1', pin: '482915' }, null).data;
    const tk = t.requires_location ? bad.runOperation('SELECT_LOCATION', { locationId: 'LOC-1' }, t.token).data.token : t.token;
    const r = bad.runOperation('UPLOAD_SUPPLIER_DOCUMENT', { docType: bad.ctx.SUPPLIER_DOCUMENT_TYPES[0], base64Data: PDF.toString('base64'), fileName: 'x.pdf', mimeType: 'application/pdf' }, tk);
    assert.equal(r.ok, false);
    bad.close();
  });

  // 3. Почта через Postbox.
  await step('почта: без TSEKH_MAIL_FROM письма ждут в очереди', () => {
    rt.ctx.MailApp.sendEmail('chef@example.ru', 'Отклонение температуры', 'Холодильник №2: +9 °C');
    assert.deepEqual(flushMail(rt.db, envS3).пропущено, 'не задан TSEKH_MAIL_FROM');
    assert.equal(rt.db.query("SELECT count(*)::int n FROM tsekh_mail WHERE status = 'к_отправке'")[0].n, 1);
  });
  const envMail = Object.assign({}, envS3, { TSEKH_MAIL_FROM: 'noreply@tsekh.example', TSEKH_POSTBOX_ENDPOINT: 'http://127.0.0.1:' + mock.port });
  await step('почта: tick15m_ отправляет через Postbox (подпись, кириллица); сбой — повтор, после 5 попыток «ошибка»', async () => {
    rt.ctx.MailApp.sendEmail('fail@example.ru', 'Не дойдёт', '…');
    const rt2 = createRuntime({ logger: () => {}, env: envMail, migrate: false });
    const res = rt2.runTick('tick15m_');
    assert.deepEqual(res.почта, { отправлено: 1, ошибок: 1 });
    const state = JSON.parse((await get(mock.port, '/__state')).body);
    assert.equal(state.emails.length, 1);
    assert.equal(state.emails[0].Content.Simple.Subject.Data, 'Отклонение температуры');
    assert.deepEqual(state.emails[0].Destination.ToAddresses, ['chef@example.ru']);
    for (let i = 0; i < 4; i++) flushMail(rt2.db, envMail);
    const failed = rt2.db.query("SELECT status, attempts, last_error FROM tsekh_mail WHERE recipient = 'fail@example.ru'")[0];
    assert.deepEqual([failed.status, failed.attempts], ['ошибка', 5]); assert(/500/.test(failed.last_error));
    assert.equal(flushMail(rt2.db, envMail).отправлено, 0, 'ошибочные больше не отправляются');
    rt2.close();
  });
  rt.close();
  mock.ch.kill();
  console.log(failures ? '\n' + failures + ' FAILED' : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})();
