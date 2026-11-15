'use strict';
// Интеграции, этап 2б (MonChef_V77_IikoDocs.gs): техкарты iiko — сверка с ТТК, приходные накладные iiko — сверка с приёмкой.
// Настоящий код .gs, сервер iiko подменён локальным HTTP-сервером в отдельном процессе.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tsekh-iikod-'));
const tenants = require('../lib/tenants');
const LOG = path.join(process.env.DATA_DIR, 'log.jsonl');

const PRODUCTS = [
  { id: 'p-borsch', name: 'Борщ', code: '101', type: 'DISH', mainUnit: 'u-port' },
  { id: 'p-plov', name: 'Плов', code: '102', type: 'DISH', mainUnit: 'u-port' },
  { id: 'p-svekla', name: 'Свёкла', code: '1', type: 'GOODS', mainUnit: 'u-kg' },
  { id: 'p-kap', name: 'Капуста', code: '2', type: 'GOODS', mainUnit: 'u-kg' },
  { id: 'p-luk', name: 'Лук репчатый', code: '3', type: 'GOODS', mainUnit: 'u-kg' },
];
const UNITS = [{ id: 'u-kg', name: 'кг' }, { id: 'u-port', name: 'порц' }];
const CHARTS = { assemblyCharts: [
  { id: 'c1', assembledProductId: 'p-borsch', assembledAmount: 1, items: [{ productId: 'p-svekla', amountIn: 0.2, amountOut: 0.16 }, { productId: 'p-kap', amountIn: 0.1, amountOut: 0.08 }] },
  { id: 'c2', assembledProductId: 'p-plov', assembledAmount: 10, items: [{ productId: 'p-luk', amountIn: 0.5 }] },
], preparedCharts: [] };
const SUPPLIERS = '<?xml version="1.0" encoding="UTF-8"?><employees><employee><id>s-1</id><code>7</code><name>ООО Мясо &amp; Ко</name><taxpayerIdNumber>7701234567</taxpayerIdNumber><supplier>true</supplier></employee>' +
  '<employee><id>s-2</id><name>Овощная база</name><taxpayerIdNumber>5001112223</taxpayerIdNumber></employee></employees>';
const doc = (id, no, inNo, date, sup, status, items) => `<document><id>${id}</id><documentNumber>${no}</documentNumber><incomingDocumentNumber>${inNo}</incomingDocumentNumber><incomingDate>${date}T10:00:00+05:00</incomingDate>` +
  `<supplier>${sup}</supplier><status>${status}</status><items>${items.map((x, i) => `<item><num>${i + 1}</num><product>${x[0]}</product><amount>${x[1]}</amount><actualAmount>${x[1]}</actualAmount><price>${x[2]}</price><sum>${x[1] * x[2]}</sum></item>`).join('')}</items></document>`;
const INVOICES = '<?xml version="1.0" encoding="UTF-8"?><incomingInvoiceDtoes>' +
  doc('d-1', 'ПН-0001', 'УПД-15', '2026-11-12', 's-2', 'PROCESSED', [['p-svekla', 10, 40], ['p-kap', 5, 30]]) +
  doc('d-2', 'ПН-0002', '000077', '2026-11-13', 's-1', 'PROCESSED', [['p-luk', 3, 25]]) +
  doc('d-3', 'ПН-0003', '88', '2026-11-13', 's-1', 'NEW', [['p-luk', 1, 25]]) + '</incomingInvoiceDtoes>';

const SERVER = `
const http = require('http'), fs = require('fs'), crypto = require('crypto');
const PASS = crypto.createHash('sha1').update('secret').digest('hex'), keys = new Set();
const J = ${JSON.stringify({ PRODUCTS, UNITS, CHARTS, SUPPLIERS, INVOICES })};
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), key = u.searchParams.get('key');
  fs.appendFileSync(${JSON.stringify(LOG)}, JSON.stringify({ p: u.pathname, q: Object.fromEntries(u.searchParams) }) + '\\n');
  const send = (ct, b) => { res.writeHead(200, { 'content-type': ct }); res.end(typeof b === 'string' ? b : JSON.stringify(b)); };
  if (u.pathname === '/resto/api/auth') { if (u.searchParams.get('pass') !== PASS) { res.writeHead(401); return res.end('Wrong'); } const k = 'k' + Math.random().toString(16).slice(2); keys.add(k); return send('text/plain', k); }
  if (u.pathname === '/resto/api/logout') { keys.delete(key); return send('text/plain', ''); }
  if (!keys.has(key)) { res.writeHead(401); return res.end('expired'); }
  if (u.pathname === '/resto/api/v2/entities/products/list') return send('application/json', J.PRODUCTS);
  if (u.pathname === '/resto/api/v2/entities/list') return send('application/json', J.UNITS);
  if (u.pathname === '/resto/api/v2/assemblyCharts/getAll') return send('application/json', J.CHARTS);
  if (u.pathname === '/resto/api/suppliers') return send('application/xml', J.SUPPLIERS);
  if (u.pathname === '/resto/api/documents/export/incomingInvoice') return send('application/xml', J.INVOICES);
  res.writeHead(404); res.end('not found');
}).listen(0, '127.0.0.1', function () { console.log('PORT ' + this.address().port); });
`;
let srv, URL_ = '', T, TOKEN = '';
test.before(async () => {
  srv = spawn(process.execPath, ['-e', SERVER], { stdio: ['ignore', 'pipe', 'inherit'] });
  URL_ = await new Promise((ok, bad) => { srv.stdout.on('data', (b) => { const m = /PORT (\d+)/.exec(String(b)); if (m) ok('http://127.0.0.1:' + m[1]); }); srv.on('exit', bad); });
  tenants.create({ slug: 'iikod', name: 'Тест', ownerEmail: 'owner@example.ru', timeZone: 'Europe/Moscow' });
  T = tenants.get('iikod');
});
test.after(() => { try { srv.kill(); } catch (e) {} fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); });
function run(body) {
  return T.execute((res) => () => {
    if (!TOKEN) TOKEN = res('_createSession_')({ id: 'E1', fullName: 'Директор Иванова', position: 'Директор', role: 'Директор' }, res('_mcRbEffective_')('Директор', 'E1')).token;
    return body(res);
  });
}
const J = (s) => { const r = typeof s === 'string' ? JSON.parse(s) : s; if (!r.success) throw new Error(JSON.stringify(r.error)); return r.data; };
const call = (fn, ...a) => run((res) => JSON.parse(res(fn)(...a, TOKEN)));
const log = () => fs.readFileSync(LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('подготовка: ТТК Борщ (свёкла 250 г, морковь), приёмка по одной накладной, подключение iiko', () => {
  run((res) => {
    const book = res('_book_')();
    const d = book.insertSheet('Блюда'), s = book.insertSheet('Состав');
    d.appendRow(['Код', 'Название', 'Категория', 'Выход']); s.appendRow(['Код', 'Продукт', 'Ед', 'x', 'Брутто', 'Нетто', 'Выход', 'Ед. изм']);
    d.appendRow(['D-BORSCH', 'Борщ', 'Супы', 300]);
    s.appendRow(['D-BORSCH', 'Свёкла', 'г', '', 250, 200, 200, 'г']);
    s.appendRow(['D-BORSCH', 'Морковь', 'г', '', 30, 25, 25, 'г']);
    const p = book.insertSheet('Приёмка_Партии');
    p.appendRow(['BatchID', 'Поставщик', 'Накладная', 'DocumentID накладной', 'Дата накладной', 'Стоимость', 'Цена за ед.', 'Ед.', 'Кол-во', 'Принял']);
    p.appendRow(['B1', 'Овощная база', 'УПД 15', '', '2026-11-12', 400, 40, 'кг', 10, 'Петров']);
    p.appendRow(['B2', 'Овощная база', 'УПД 15', '', '2026-11-12', 140, 28, 'кг', 5, 'Петров']);
  });
  assert.strictEqual(J(call('v77IikoSave', JSON.stringify({ url: URL_, login: 'api', password: 'secret' }))).check.ok, true);
});

test('техкарты: расхождения с ТТК названы, блюда без ТТК — отдельно, ТТК не меняется', () => {
  fs.writeFileSync(LOG, '');
  const d = J(call('v77IikoCharts', JSON.stringify({ date: '2026-11-14' })));
  assert.deepStrictEqual(d.totals, { charts: 2, same: 0, diff: 1, missing: 1 });
  const b = d.charts.find((x) => x.dish === 'Борщ'), p = d.charts.find((x) => x.dish === 'Плов');
  assert.strictEqual(b.cehDish, 'Борщ');
  assert.ok(b.issues.some((i) => /^Свёкла: брутто iiko 200 г, ЦЕХ 250 г \(-20 %\)$/.test(i)), b.issues.join(' | '));
  assert.ok(b.issues.includes('только в iiko: Капуста 0,1 кг'));
  assert.ok(b.issues.includes('только в ЦЕХ: Морковь'));
  assert.deepStrictEqual(p.issues, ['нет в ТТК ЦЕХ']);
  const ch = log().find((x) => x.p === '/resto/api/v2/assemblyCharts/getAll');
  assert.strictEqual(ch.q.dateFrom, '2026-11-14');
  assert.strictEqual(log().pop().p, '/resto/api/logout');
  const n = run((res) => res('_book_')().getSheetByName('Состав').getLastRow());
  assert.strictEqual(n, 3);
});

test('накладные: проведённые сохраняются, черновик пропущен, без приёмки в ЦЕХ — названа; повтор не задваивает', () => {
  const d = J(call('v77IikoInvoices', JSON.stringify({ from: '2026-11-10', to: '2026-11-14' })));
  assert.deepStrictEqual(d.loaded, { documents: 2, newLines: 3, skippedDrafts: 1 });
  assert.strictEqual(d.invoices, 2);
  assert.deepStrictEqual(d.matched.map((x) => [x.number, x.supplier, x.sum, x.cehSum, x.diff]), [['УПД-15', 'Овощная база', 550, 540, -10]]);
  assert.deepStrictEqual(d.notReceived.map((x) => [x.number, x.supplier, x.lines, x.sum]), [['000077', 'ООО Мясо & Ко', 1, 75]]);
  const rows = run((res) => res('_book_')().getSheetByName('Инт_Накладные_iiko').getDataRange().getValues());
  assert.strictEqual(rows.length, 4);
  assert.deepStrictEqual(rows.slice(1).map((r) => [r[9], Number(r[11]), r[12], Number(r[13])]), [['Свёкла', 10, 'кг', 40], ['Капуста', 5, 'кг', 30], ['Лук репчатый', 3, 'кг', 25]]);
  assert.strictEqual(rows[3][6], '7701234567');
  const again = J(call('v77IikoInvoices', JSON.stringify({ from: '2026-11-10', to: '2026-11-14' })));
  assert.strictEqual(again.loaded.newLines, 0);
  assert.strictEqual(again.notReceived.length, 1);
});

test('без подключения — понятный отказ', () => {
  J(call('v77IikoDisconnect'));
  const r = call('v77IikoCharts', '{}');
  assert.strictEqual(r.success, false);
  assert.match(r.error.message, /настройте подключение/);
});
