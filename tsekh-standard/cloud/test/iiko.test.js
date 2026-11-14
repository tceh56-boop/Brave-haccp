'use strict';
// Интеграции, этап 2 (MonChef_V77_Iiko.gs): продажи из iiko по API на настоящем коде .gs. Сервер iiko подменён
// локальным HTTP-сервером в отдельном процессе (UrlFetchApp в облачной версии синхронный — ходит через дочерний процесс).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tsekh-iiko-'));
const tenants = require('../lib/tenants');

// «сегодня» — в часовом поясе предприятия (Europe/Moscow), как его считает сервер, а не в поясе машины тестов
const pad = (n) => String(n).padStart(2, '0'), msk = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number);
const now = new Date(msk[0], msk[1] - 1, msk[2]);
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = iso(now), YDAY = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
const ru = (s) => s.split('-').reverse().join('.');
const LOG = path.join(process.env.DATA_DIR, 'iiko-log.jsonl'), DATA = path.join(process.env.DATA_DIR, 'iiko-olap.json');

// Подменный сервер iiko: /resto/api/auth (логин + SHA-1 пароля), /v2/reports/olap, /logout. Каждый запрос — строка в журнале.
const SERVER = `
const http = require('http'), fs = require('fs');
const PASS = require('crypto').createHash('sha1').update('secret').digest('hex');
const keys = new Set();
http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
    const u = new URL(req.url, 'http://x'), key = u.searchParams.get('key');
    fs.appendFileSync(${JSON.stringify(LOG)}, JSON.stringify({ m: req.method, p: u.pathname, q: Object.fromEntries(u.searchParams), body }) + '\\n');
    if (u.pathname === '/resto/api/auth') {
      if (u.searchParams.get('login') !== 'api' || u.searchParams.get('pass') !== PASS) { res.writeHead(401); return res.end('Wrong login or password'); }
      const k = 'k' + Math.random().toString(16).slice(2); keys.add(k); res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(k);
    }
    if (u.pathname === '/resto/api/logout') { keys.delete(key); res.writeHead(200); return res.end(''); }
    if (!keys.has(key)) { res.writeHead(401); return res.end('Token is expired or invalid'); }
    if (u.pathname === '/resto/api/v2/reports/olap' && req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(fs.readFileSync(${JSON.stringify(DATA)}, 'utf8'));
    }
    res.writeHead(404); res.end('not found');
  });
}).listen(0, '127.0.0.1', function () { console.log('PORT ' + this.address().port); });
`;
let srv, URL_ = '', T, TOKEN = '';
const setOlap = (rows) => fs.writeFileSync(DATA, JSON.stringify({ data: rows, summary: [] }));
const log = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const row = (day, time, order, code, name, qty, sum) => ({ 'OpenDate.Typed': day, CloseTime: `${day}T${time}:41.000`, OrderNum: order, DishCode: code, DishName: name, 'OrderWaiter.Name': 'Анна', DishAmountInt: qty, DishDiscountSumInt: sum });

test.before(async () => {
  srv = spawn(process.execPath, ['-e', SERVER], { stdio: ['ignore', 'pipe', 'inherit'] });
  URL_ = await new Promise((ok, bad) => { srv.stdout.on('data', (b) => { const m = /PORT (\d+)/.exec(String(b)); if (m) ok('http://127.0.0.1:' + m[1]); }); srv.on('exit', bad); });
  tenants.create({ slug: 'iiko-kafe', name: 'Тест', ownerEmail: 'owner@example.ru', timeZone: 'Europe/Moscow' });
  T = tenants.get('iiko-kafe');
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

test('подготовка: блюдо в ТТК и партия на складе', () => {
  run((res) => {
    const book = res('_book_')();
    const d = book.getSheetByName('Блюда') || book.insertSheet('Блюда'), s = book.getSheetByName('Состав') || book.insertSheet('Состав');
    if (d.getLastRow() < 1) d.appendRow(['Код', 'Название', 'Категория', 'Выход']);
    if (s.getLastRow() < 1) s.appendRow(['Код', 'Продукт', 'Ед', 'x', 'Брутто', 'Нетто', 'Выход', 'Ед. изм']);
    d.appendRow(['D-BORSCH', 'Борщ', 'Супы', 300]);
    s.appendRow(['D-BORSCH', 'Свёкла', 'кг', '', 0.2, 0.2, 0.2, 'кг']);
    res('_stockBatchesSheet_')().appendRow(['B-SV1', 'Свёкла', 'кг', 10, new Date(2026, 0, 1), new Date(2099, 0, 1), 50, 'Приёмка', 0, 10, 'active']);
  });
});

test('неверный пароль: настройки сохраняются, вход не удался — понятная причина', () => {
  const d = J(call('v77IikoSave', JSON.stringify({ url: URL_ + '/resto/', login: 'api', password: 'wrong' })));
  assert.strictEqual(d.check.ok, false);
  assert.match(d.check.message, /неверный логин или пароль/);
  assert.strictEqual(d.settings.url, URL_);
});

test('верный пароль: вход и выход; пароль хранится только как SHA-1 и в ответ не уходит', () => {
  fs.writeFileSync(LOG, '');
  const d = J(call('v77IikoSave', JSON.stringify({ url: URL_, login: 'api', password: 'secret', auto: true })));
  assert.strictEqual(d.check.ok, true, d.check.message);
  assert.strictEqual(d.settings.auto, true);
  assert.ok(!JSON.stringify(d).includes('secret') && !('passHash' in d.settings));
  const stored = run((res) => res('PropertiesService').getScriptProperties().getProperty('MC_V77_IIKO'));
  assert.ok(stored.includes(crypto.createHash('sha1').update('secret').digest('hex')) && !stored.includes('"secret"'));
  assert.deepStrictEqual(log().map((x) => x.p), ['/resto/api/auth', '/resto/api/logout']);
  // пароль пустой при тех же сервере и логине — остаётся прежний
  const again = J(call('v77IikoSave', JSON.stringify({ url: URL_, login: 'api', password: '', auto: true })));
  assert.strictEqual(again.check.ok, true);
});

test('загрузка продаж за период: OLAP-запрос, проведение, ждущие позиции, выход из сессии', () => {
  fs.writeFileSync(LOG, '');
  setOlap([row(YDAY, '20:15', 11, '101', 'Борщ', 2, 560), row(TODAY, '12:05', 12, '101', 'Борщ', 1, 280), row(TODAY, '12:05', 12, '205', 'Морс клюквенный', 2, 240)]);
  const d = J(call('v77IikoPull', JSON.stringify({ from: YDAY, to: TODAY })));
  assert.strictEqual(d.lines, 3);
  assert.strictEqual(d.recorded, 2);
  assert.strictEqual(d.pending, 1);
  const L = log(), olap = L.find((x) => x.p === '/resto/api/v2/reports/olap');
  assert.ok(olap && olap.q.key, 'запрос с ключом сессии');
  const body = JSON.parse(olap.body);
  assert.strictEqual(body.reportType, 'SALES');
  assert.deepStrictEqual(body.aggregateFields, ['DishAmountInt', 'DishDiscountSumInt']);
  assert.strictEqual(body.filters['OpenDate.Typed'].from, YDAY + 'T00:00:00.000');
  assert.strictEqual(body.filters['OpenDate.Typed'].includeHigh, false);
  assert.strictEqual(L[L.length - 1].p, '/resto/api/logout');
  const j = run((res) => { const jj = res('_mcJById_')('J36'), v = res('_book_')().getSheetByName(jj.sheetName).getDataRange().getValues(), si = v[0].indexOf('Источник записи');
    return v.slice(1).map((x) => [x[1] instanceof Date ? x[1].toISOString() : String(x[1]), String(x[2]), x[3], Number(x[4]), Number(x[6]), x[7], String(x[si])]); });
  assert.strictEqual(j.length, 2);
  assert.deepStrictEqual(j.map((x) => [x[2], x[3], x[4], x[5]]), [['Борщ', 2, 560, 'Анна'], ['Борщ', 1, 280, 'Анна']]);
  assert.strictEqual(j[0][1], '20:15');
  assert.ok(j.every((x) => /^загрузка iiko · чек 1[12] · SL-/.test(x[6])), j.map((x) => x[6]).join(' | '));
  const sv = run((res) => res('_stockBatchesSheet_')().getDataRange().getValues().find((x) => x[0] === 'B-SV1')[9]);
  assert.strictEqual(Number(sv), 9.4);
});

test('повторная загрузка того же периода ничего не задваивает; настройки помнят последний обмен', () => {
  const d = J(call('v77IikoPull', JSON.stringify({ from: YDAY, to: TODAY })));
  assert.strictEqual(d.recorded, 0);
  assert.strictEqual(d.duplicates, 3);
  const g = J(call('v77GetIntegrations'));
  assert.strictEqual(g.iiko.configured, true);
  assert.strictEqual(g.iiko.lastResult.duplicates, 3);
  assert.ok(g.pending.some((p) => p.name === 'Морс клюквенный' && p.extId === '205'));
});

test('день, загруженный файлом, API не дублирует', () => {
  const back = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3), BD = iso(back);
  const csv = `Учетный день;Номер чека;Блюдо;Количество блюд;Сумма со скидкой\n${ru(BD)};50;Борщ;1;280\n${ru(BD)};51;Борщ;1;280`;
  assert.strictEqual(J(call('v77ImportSales', JSON.stringify({ system: 'iiko', text: csv }))).recorded, 2);
  setOlap([row(BD, '13:00', 50, '101', 'Борщ', 2, 560)]);   // тот же день из API, сгруппировано иначе
  const d = J(call('v77IikoPull', JSON.stringify({ from: BD, to: BD })));
  assert.strictEqual(d.recorded, 0);
  assert.strictEqual(d.otherSource, 1);
  assert.deepStrictEqual(d.otherSourceDays, [{ day: BD, lines: 1, loadedBy: 'файлом' }]);
});

test('автозагрузка по расписанию: вчера и сегодня; выключена — ничего не делает', () => {
  setOlap([row(TODAY, '18:30', 13, '101', 'Борщ', 1, 280)]);
  fs.writeFileSync(LOG, '');
  const r = T.execute('v77IikoSyncSystem');
  assert.strictEqual(r.recorded, 1);
  const body = JSON.parse(log().find((x) => x.p === '/resto/api/v2/reports/olap').body);
  assert.strictEqual(body.filters['OpenDate.Typed'].from, YDAY + 'T00:00:00.000');
  J(call('v77IikoSave', JSON.stringify({ url: URL_, login: 'api', password: '', auto: false })));
  assert.deepStrictEqual(T.execute('v77IikoSyncSystem'), { skipped: true });
  assert.ok(run((res) => res('MC_SCHEDULE')).some((j) => j.fn === 'v77IikoSyncSystem' && j.everyMin === 30));
});

test('сервер недоступен: ошибка с причиной, запись в настройках', () => {
  J(call('v77IikoSave', JSON.stringify({ url: 'http://127.0.0.1:1', login: 'api', password: 'secret' })));
  const r = call('v77IikoPull', JSON.stringify({}));
  assert.strictEqual(r.success, false);
  assert.match(r.error.message, /недоступен/);
  assert.ok(J(call('v77GetIntegrations')).iiko.lastError);
  J(call('v77IikoDisconnect'));
  assert.strictEqual(J(call('v77GetIntegrations')).iiko.configured, false);
});
