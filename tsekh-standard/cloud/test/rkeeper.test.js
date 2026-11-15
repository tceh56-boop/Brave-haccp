'use strict';
// Интеграции, этап 4 (MonChef_V77_RKeeper.gs): продажи из R-Keeper 7 через XML-интерфейс кассового сервера.
// Настоящий код .gs, кассовый сервер подменён локальным HTTP-сервером в отдельном процессе (Basic-авторизация, RK7Query).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tsekh-rk-'));
const tenants = require('../lib/tenants');
const LOG = path.join(process.env.DATA_DIR, 'log.jsonl');

const pad = (n) => String(n).padStart(2, '0'), msk = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number);
const TODAY = `${msk[0]}-${pad(msk[1])}-${pad(msk[2])}`;

const LIST = `<?xml version="1.0" encoding="UTF-8"?><RK7QueryResult ServerVersion="7.6" Status="Ok"><CommandResult CMD="GetOrderList" Status="Ok">
<Visit VisitID="501" Finished="1"><Guests/><Orders><Order OrderID="1" OrderName="12.1" Finished="1" OpenTime="${TODAY}T12:00:00"/></Orders></Visit>
<Visit VisitID="502" Finished="1"><Orders><Order OrderID="1" OrderName="14.1" Finished="1" OpenTime="${TODAY}T13:00:00"/></Orders></Visit>
<Visit VisitID="503" Finished="0"><Orders><Order OrderID="1" OrderName="15.1" Finished="0" OpenTime="${TODAY}T14:00:00"/></Orders></Visit>
</CommandResult></RK7QueryResult>`;
const ORDERS = {
  '501:1': `<RK7QueryResult Status="Ok"><CommandResult CMD="GetOrder" Status="Ok"><Order visit="501" orderIdent="1" orderName="12.1" finished="1" openTime="${TODAY}T12:00:00">
<Waiter id="9" code="3" name="Анна"/><Session uni="1"><Dish id="1001" code="5" name="Борщ" uni="2" quantity="2000" price="30000" amount="60000"><Modi id="7" name="Без сметаны" price="0" amount="0" quantity="1000"/></Dish>
<Dish id="1002" code="8" name="Компот домашний" uni="3" quantity="1000" price="15000" amount="15000"/></Session><Discount id="1" name="Скидка 10%" amount="-7500"/></Order></CommandResult></RK7QueryResult>`,
  '502:1': `<RK7QueryResult Status="Ok"><CommandResult CMD="GetOrder" Status="Ok"><Order visit="502" orderIdent="1" orderName="14.1" finished="1" openTime="${TODAY}T13:00:00">
<Waiter name="Олег"/><Session uni="1"><Dish code="5" name="Борщ" uni="1" quantity="1000" price="30000" amount="30000"/><Dish code="9" name="Хлеб" uni="2" quantity="0" price="500" amount="0"/>
<Dish code="11" name="Соус острый" uni="3" quantity="1000" price="5000" amount="5000"/></Session></Order></CommandResult></RK7QueryResult>`,
};
const SERVER = `
const http = require('http'), fs = require('fs');
const LIST = ${JSON.stringify(LIST)}, ORDERS = ${JSON.stringify(ORDERS)}, AUTH = 'Basic ' + Buffer.from('xml:секрет', 'utf8').toString('base64');
http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => b += c); req.on('end', () => {
    fs.appendFileSync(${JSON.stringify(LOG)}, JSON.stringify({ p: req.url, m: req.method, b }) + '\\n');
    if (req.url !== '/rk7api/v0/xmlinterface.xml') { res.writeHead(404); return res.end('no'); }
    if (req.headers.authorization !== AUTH) { res.writeHead(401); return res.end(''); }
    const send = (x) => { res.writeHead(200, { 'content-type': 'text/xml; charset=utf-8' }); res.end(x); };
    if (/CMD="GetOrderList"/.test(b)) return send(LIST);
    const m = /<Order visit="(\\d+)" orderIdent="(\\d+)"/.exec(b);
    if (/CMD="GetOrder"/.test(b) && m && ORDERS[m[1] + ':' + m[2]]) return send(ORDERS[m[1] + ':' + m[2]]);
    send('<RK7QueryResult Status="Ok"><CommandResult CMD="GetOrder" Status="Error" ErrorText="Заказ не найден"/></RK7QueryResult>');
  });
}).listen(0, '127.0.0.1', function () { console.log('PORT ' + this.address().port); });
`;
let srv, HOST = '', T, TOKEN = '';
test.before(async () => {
  srv = spawn(process.execPath, ['-e', SERVER], { stdio: ['ignore', 'pipe', 'inherit'] });
  HOST = await new Promise((ok, bad) => { srv.stdout.on('data', (b) => { const m = /PORT (\d+)/.exec(String(b)); if (m) ok('http://127.0.0.1:' + m[1]); }); srv.on('exit', bad); });
  tenants.create({ slug: 'rk', name: 'Тест', ownerEmail: 'owner@example.ru', timeZone: 'Europe/Moscow' });
  T = tenants.get('rk');
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
const log = () => fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const sales = () => run((res) => { const sh = res('_book_')().getSheetByName('Инт_Продажи'), v = sh.getDataRange().getValues(), h = v[0]; return v.slice(1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]]))); });

test('подготовка: блюдо Борщ в ТТК и свёкла на складе', () => {
  run((res) => {
    const book = res('_book_')();
    const d = book.insertSheet('Блюда'), s = book.insertSheet('Состав');
    d.appendRow(['Код', 'Название', 'Категория', 'Выход']); s.appendRow(['Код', 'Продукт', 'Ед', 'x', 'Брутто', 'Нетто', 'Выход', 'Ед. изм']);
    d.appendRow(['D-BORSCH', 'Борщ', 'Супы', 300]);
    s.appendRow(['D-BORSCH', 'Свёкла', 'кг', '', 0.2, 0.2, 0.2, 'кг']);
    res('_stockBatchesSheet_')().appendRow(['B-SV1', 'Свёкла', 'кг', 10, new Date(2026, 0, 1), new Date(2099, 0, 1), 50, 'Приёмка', 0, 10, 'active']);
  });
});

test('подключение: адрес дополняется путём XML-интерфейса, неверный пароль — понятная ошибка, пароль не уходит в экран', () => {
  const w = J(call('v77RkSave', JSON.stringify({ url: HOST, login: 'xml', password: 'не тот' })));
  assert.strictEqual(w.check.ok, false);
  assert.match(w.check.message, /неверный пользователь или пароль/);
  assert.strictEqual(w.settings.url, HOST + '/rk7api/v0/xmlinterface.xml');
  assert.strictEqual(w.settings.auto, true, 'автозагрузка по умолчанию включена — касса отдаёт только текущую смену');
  const d = J(call('v77RkSave', JSON.stringify({ url: HOST + '/', login: 'xml', password: 'секрет' })));
  assert.strictEqual(d.check.ok, true, d.check.message);
  assert.match(d.check.message, /закрытых заказов в смене: 2/);
  const g = J(call('v77GetIntegrations'));
  assert.strictEqual(g.rkeeper.configured, true);
  assert.ok(!JSON.stringify(g).includes('секрет'));
});

test('загрузка смены: закрытые заказы, скидка разнесена, бесплатный модификатор и удалённое блюдо не проводятся', () => {
  fs.writeFileSync(LOG, '');
  const d = J(call('v77RkPull', ''));
  assert.strictEqual(d.orders, 2);
  assert.strictEqual(d.newOrders, 2);
  assert.strictEqual(d.lines, 4, JSON.stringify(d));
  assert.strictEqual(d.recorded, 2, 'Борщ ×2 и Борщ ×1 проведены по ТТК');
  assert.strictEqual(d.pending, 2, 'Компот и соус ждут сопоставления');
  const s = sales();
  const b1 = s.find((x) => x.ExtKey === 'rkeeper:501:1:2'), k = s.find((x) => x.ExtKey === 'rkeeper:501:1:3'), b2 = s.find((x) => x.ExtKey === 'rkeeper:502:1:1');
  assert.deepStrictEqual([b1.ExtName, b1.ExtID, Number(b1.Qty), Number(b1.Sum), b1.CheckNo, b1.Waiter, b1.Status], ['Борщ', '5', 2, 540, '12.1', 'Анна', 'RECORDED']);
  assert.deepStrictEqual([Number(k.Qty), Number(k.Sum), k.Status], [1, 135, 'PENDING']);
  assert.deepStrictEqual([Number(b2.Qty), Number(b2.Sum), b2.Waiter], [1, 300, 'Олег']);
  assert.ok(!s.some((x) => /Хлеб|сметаны/.test(x.ExtName)));
  assert.strictEqual(String(b1.Date).slice(0, 10) === TODAY || b1.Date instanceof Date, true);
  const cmds = log().map((x) => (/CMD="(\w+)"/.exec(x.b) || [])[1]);
  assert.deepStrictEqual(cmds, ['GetOrderList', 'GetOrder', 'GetOrder'], 'незакрытый заказ не запрашивается');
  assert.match(log()[1].b, /<Order visit="501" orderIdent="1"\/>/);
  const left = run((res) => res('_book_')().getSheetByName('Склад_Партии').getDataRange().getValues().find((r) => r[0] === 'B-SV1')[9]);
  assert.ok(Math.abs(Number(left) - 9.4) < 1e-6, 'свёкла списана по ТТК: 3 порции × 0,2 кг, остаток ' + left);
});

test('повтор: загруженные заказы второй раз не запрашиваются и не задваиваются', () => {
  fs.writeFileSync(LOG, '');
  const d = J(call('v77RkPull', ''));
  assert.strictEqual(d.newOrders, 0);
  assert.strictEqual(d.recorded, 0);
  assert.deepStrictEqual(log().map((x) => (/CMD="(\w+)"/.exec(x.b) || [])[1]), ['GetOrderList']);
  assert.strictEqual(sales().length, 4);
});

test('автозагрузка по расписанию и отключение', () => {
  const r = run((res) => res('v77RkSyncSystem')());
  assert.ok(!r.error, r.error);
  J(call('v77RkSave', JSON.stringify({ url: HOST, login: 'xml', password: '', auto: false })));
  assert.deepStrictEqual(run((res) => res('v77RkSyncSystem')()), { skipped: true });
  J(call('v77RkSave', JSON.stringify({ url: HOST + '/wrong.xml', login: 'xml', password: 'секрет' })));
  const bad = call('v77RkPull', '');
  assert.strictEqual(bad.success, false);
  assert.match(bad.error.message, /XML-интерфейс не найден/);
  J(call('v77RkDisconnect'));
  assert.strictEqual(J(call('v77GetIntegrations')).rkeeper.configured, false);
  assert.match(call('v77RkPull', '').error.message, /настройте подключение к R-Keeper/);
});
