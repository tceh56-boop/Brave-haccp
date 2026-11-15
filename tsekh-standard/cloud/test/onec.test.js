'use strict';
// Интеграции, этап 3 (MonChef_V77_1C.gs): выгрузка продаж, списаний и поступлений для 1С файлом CSV;
// загрузка проведённых «Поступлений товаров и услуг» из 1С по OData и сверка с приёмкой ЦЕХ.
// Настоящий код .gs, сервер 1С (стандартный интерфейс OData) подменён локальным HTTP-сервером в отдельном процессе.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tsekh-1c-'));
const tenants = require('../lib/tenants');
const LOG = path.join(process.env.DATA_DIR, 'log.jsonl');

// «сегодня» — в часовом поясе предприятия (Europe/Moscow), как его считает сервер
const pad = (n) => String(n).padStart(2, '0'), msk = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number);
const today = new Date(msk[0], msk[1] - 1, msk[2]);
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, ru = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
const TODAY = iso(today), DAY = ru(today), Y = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1), YISO = iso(Y);

const G = (n) => '00000000-0000-0000-0000-00000000000' + n;
const ODATA = {
  docs: [
    { Ref_Key: G(1), Number: '0000-000015', Date: YISO + 'T10:00:00', Posted: true, DeletionMark: false, НомерВходящегоДокумента: 'УПД-15', Контрагент_Key: G(5),
      Товары: [{ LineNumber: '1', Номенклатура_Key: G(7), Количество: 10, Цена: 40, Сумма: 400, ЕдиницаИзмерения_Key: G(9) },
        { LineNumber: '2', Номенклатура_Key: G(8), Количество: 5, Цена: 30, Сумма: 150, ЕдиницаИзмерения_Key: G(9) }] },
    { Ref_Key: G(2), Number: '0000-000016', Date: TODAY + 'T09:30:00', Posted: true, DeletionMark: false, НомерВходящегоДокумента: '000077', Контрагент_Key: G(6),
      Товары: [{ LineNumber: '1', Номенклатура_Key: G(7), Количество: 3, Цена: 25, Сумма: 75, ЕдиницаИзмерения_Key: G(9) }] },
  ],
  Catalog_Контрагенты: [{ Ref_Key: G(5), Description: 'Овощная база', ИНН: '5001112223' }, { Ref_Key: G(6), Description: 'ООО "Мясо и Ко"', ИНН: '7701234567' }],
  Catalog_Номенклатура: [{ Ref_Key: G(7), Description: 'Свёкла', Code: '00-001 ' }, { Ref_Key: G(8), Description: 'Капуста', Code: '00-002' }],
  Catalog_КлассификаторЕдиницИзмерения: [{ Ref_Key: G(9), Description: 'кг' }],
};
const SERVER = `
const http = require('http'), fs = require('fs');
const D = ${JSON.stringify(ODATA)}, AUTH = 'Basic ' + Buffer.from('Бухгалтер:пароль 1С', 'utf8').toString('base64');
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), p = decodeURIComponent(u.pathname), q = Object.fromEntries(u.searchParams);
  fs.appendFileSync(${JSON.stringify(LOG)}, JSON.stringify({ p, q }) + '\\n');
  if (req.headers.authorization !== AUTH) { res.writeHead(401); return res.end('Unauthorized'); }
  const base = '/buh/odata/standard.odata/', name = p.indexOf(base) === 0 ? p.slice(base.length) : '';
  const send = (value) => { res.writeHead(200, { 'content-type': 'application/json;charset=utf-8' }); res.end(JSON.stringify({ 'odata.metadata': 'x', value })); };
  if (q.$format !== 'json') { res.writeHead(406); return res.end('format'); }
  if (name === 'Document_ПоступлениеТоваровУслуг') return send(q.$top ? D.docs.slice(0, 1).map((d) => ({ Ref_Key: d.Ref_Key })) : D.docs);
  if (D[name]) { const ids = (q.$filter || '').match(/guid'([0-9a-f-]+)'/g) || []; return send(D[name].filter((x) => ids.some((i) => i.indexOf(x.Ref_Key) >= 0))); }
  res.writeHead(404); res.end('{"odata.error":{"message":{"value":"not found"}}}');
}).listen(0, '127.0.0.1', function () { console.log('PORT ' + this.address().port); });
`;
let srv, URL_ = '', T, TOKEN = '';
test.before(async () => {
  srv = spawn(process.execPath, ['-e', SERVER], { stdio: ['ignore', 'pipe', 'inherit'] });
  URL_ = await new Promise((ok, bad) => { srv.stdout.on('data', (b) => { const m = /PORT (\d+)/.exec(String(b)); if (m) ok('http://127.0.0.1:' + m[1]); }); srv.on('exit', bad); });
  tenants.create({ slug: 'onec', name: 'Тест', ownerEmail: 'owner@example.ru', timeZone: 'Europe/Moscow' });
  T = tenants.get('onec');
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
const parse = (csv) => csv.trim().split('\r\n').map((l) => l.split(';'));

test('подготовка: ТТК, склад, продажи из кассы, списание, приёмка, поставщик с ИНН', () => {
  run((res) => {
    const book = res('_book_')();
    const d = book.insertSheet('Блюда'), s = book.insertSheet('Состав');
    d.appendRow(['Код', 'Название', 'Категория', 'Выход']); s.appendRow(['Код', 'Продукт', 'Ед', 'x', 'Брутто', 'Нетто', 'Выход', 'Ед. изм']);
    d.appendRow(['D-BORSCH', 'Борщ', 'Супы', 300]);
    s.appendRow(['D-BORSCH', 'Свёкла', 'кг', '', 0.2, 0.2, 0.2, 'кг']);
    res('_stockBatchesSheet_')().appendRow(['B-SV1', 'Свёкла', 'кг', 10, new Date(2026, 0, 1), new Date(2099, 0, 1), 50, 'Приёмка', 0, 10, 'active']);
    const p = book.insertSheet('Приёмка_Партии');
    p.appendRow(['BatchID', 'Продукт', 'Кол-во', 'Ед.', 'Поставщик', 'Накладная', 'Принято', 'Дата накладной', 'Цена за ед.', 'Стоимость']);
    p.appendRow(['B1', 'Свёкла', 10, 'кг', 'Овощная база', 'УПД 15', YISO, YISO, 40, 400]);
    p.appendRow(['B2', 'Капуста', 5, 'кг', 'Овощная база', 'УПД 15', YISO, YISO, 28, 140]);
    p.appendRow(['B0', 'Лук', 1, 'кг', 'Овощная база', 'УПД 3', '2025-01-10', '2025-01-10', 20, 20]);
    const sup = res('_mdSupSheet_')(); sup.appendRow(['SUP-1', 'Овощная база', '5001112223', '', '', '', '', 'APPROVED']);
  });
  const csv = ['Учетный день;Номер чека;Блюдо;Количество блюд;Сумма со скидкой, р.', `${DAY};1;Борщ;2;600`, `${DAY};2;Борщ;1;300,00`, `${DAY};3;Вода "Святой источник";1;80`].join('\r\n');
  run((res) => {
    res('_stockBatchesSheet_')().appendRow(['B-W1', 'Вода "Святой источник"', 'шт', 24, new Date(2026, 0, 1), new Date(2099, 0, 1), 20, 'Приёмка', 0, 24, 'active']);
  });
  const d = J(call('v77ImportSales', JSON.stringify({ system: 'iiko', text: csv, fileName: 'olap.csv' })));
  assert.strictEqual(d.recorded, 3, JSON.stringify(d));
  const w = run((res) => res('stockWriteOff')('Свёкла', 1, 'кг', 'испорчена', TOKEN));
  assert.ok(!/ошиб|нет прав|error/i.test(String(w)), String(w));
});

test('выгрузка продаж: по дню и блюду, код из ТТК, десятичная запятая, кавычки экранированы', () => {
  const d = J(call('v77Export1C', JSON.stringify({ kind: 'sales', from: TODAY, to: TODAY })));
  assert.strictEqual(d.fileName, `tsekh_1c_sales_${TODAY}_${TODAY}.csv`);
  assert.strictEqual(d.lines, 2);
  assert.strictEqual(d.total, 980);
  const t = parse(d.csv);
  assert.deepStrictEqual(t[0], ['Дата', 'Номенклатура', 'Код', 'Количество', 'Ед.', 'Цена', 'Сумма']);
  assert.deepStrictEqual(t[1], [DAY, 'Борщ', 'D-BORSCH', '3', 'порц', '300', '900']);
  assert.match(d.csv, /"Вода ""Святой источник""";;1;шт;80;80/);
  const empty = J(call('v77Export1C', JSON.stringify({ kind: 'sales', from: '2025-01-01', to: '2025-01-31' })));
  assert.strictEqual(empty.lines, 0);
  assert.strictEqual(parse(empty.csv).length, 1);
});

test('выгрузка списаний: себестоимость по партии и причина', () => {
  const d = J(call('v77Export1C', JSON.stringify({ kind: 'writeoffs', from: TODAY, to: TODAY })));
  const t = parse(d.csv), r = t.find((x) => x[1] === 'Свёкла' && x[5] !== 'Продажа');
  assert.ok(r, d.csv);
  assert.deepStrictEqual(r.slice(0, 5), [DAY, 'Свёкла', '1', 'кг', '50']);
  assert.ok(r[5], 'причина указана');
  assert.ok(!t.some((x) => /Борщ/.test(x[1])), 'продажи в списания не попадают');
});

test('выгрузка поступлений: за период, ИНН из справочника поставщиков, старые не попадают', () => {
  const d = J(call('v77Export1C', JSON.stringify({ kind: 'purchases', from: YISO, to: TODAY })));
  const t = parse(d.csv);
  assert.strictEqual(d.lines, 2);
  assert.deepStrictEqual(t[1], [ru(Y), 'Овощная база', '5001112223', 'УПД 15', 'Свёкла', '10', 'кг', '40', '400', 'B1']);
  assert.strictEqual(d.total, 540);
  const bad = call('v77Export1C', JSON.stringify({ kind: 'всё', from: TODAY, to: TODAY }));
  assert.strictEqual(bad.success, false);
});

test('1С: неверный пароль — сохранено, но доступа нет; верный — доступ есть, пароль не отдаётся в экран', () => {
  const w = J(call('v77OneCSave', JSON.stringify({ url: URL_ + '/buh/odata/standard.odata/', login: 'Бухгалтер', password: 'не тот' })));
  assert.strictEqual(w.check.ok, false);
  assert.match(w.check.message, /неверный логин или пароль/);
  assert.strictEqual(w.settings.url, URL_ + '/buh');
  const d = J(call('v77OneCSave', JSON.stringify({ url: URL_ + '/buh', login: 'Бухгалтер', password: 'пароль 1С' })));
  assert.strictEqual(d.check.ok, true, d.check.message);
  const again = J(call('v77OneCSave', JSON.stringify({ url: URL_ + '/buh', login: 'Бухгалтер', password: '' })));
  assert.strictEqual(again.check.ok, true, 'пустой пароль — остаётся прежний');
  const g = J(call('v77GetIntegrations'));
  assert.strictEqual(g.onec.configured, true);
  assert.ok(!JSON.stringify(g).includes('пароль 1С'));
});

test('1С: поступления загружены, сверены с приёмкой; повтор не задваивает', () => {
  fs.writeFileSync(LOG, '');
  const d = J(call('v77OneCPull', JSON.stringify({ from: YISO, to: TODAY })));
  assert.deepStrictEqual(d.loaded, { documents: 2, newLines: 3 });
  assert.deepStrictEqual(d.matched.map((x) => [x.number, x.supplier, x.sum, x.cehSum, x.diff]), [['УПД-15', 'Овощная база', 550, 540, -10]]);
  assert.deepStrictEqual(d.notReceived.map((x) => [x.number, x.supplier, x.lines, x.sum]), [['000077', 'ООО "Мясо и Ко"', 1, 75]]);
  assert.match(d.note, /^Поступление в 1С без приёмки/);
  const q = log().find((x) => /Document_/.test(x.p)).q.$filter;
  assert.strictEqual(q, `Date ge datetime'${YISO}T00:00:00' and Date lt datetime'${iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1))}T00:00:00' and Posted eq true and DeletionMark eq false`);
  const rows = run((res) => res('_book_')().getSheetByName('Инт_Накладные_1С').getDataRange().getValues());
  assert.strictEqual(rows.length, 4);
  assert.deepStrictEqual(rows.slice(1).map((r) => [r[5], r[6], r[9], r[10], Number(r[11]), r[12], Number(r[13])]),
    [['Овощная база', '5001112223', 'Свёкла', '00-001', 10, 'кг', 40], ['Овощная база', '5001112223', 'Капуста', '00-002', 5, 'кг', 30], ['ООО "Мясо и Ко"', '7701234567', 'Свёкла', '00-001', 3, 'кг', 25]]);
  const again = J(call('v77OneCPull', JSON.stringify({ from: YISO, to: TODAY })));
  assert.strictEqual(again.loaded.newLines, 0);
  assert.strictEqual(again.notReceived.length, 1);
  const iikoSheet = run((res) => res('_book_')().getSheetByName('Инт_Накладные_iiko'));
  assert.ok(!iikoSheet, 'накладные 1С не смешиваются с iiko');
});

test('1С: ошибка сети записывается, отключение удаляет настройки', () => {
  J(call('v77OneCSave', JSON.stringify({ url: URL_ + '/nope', login: 'Бухгалтер', password: 'пароль 1С' })));
  const r = call('v77OneCPull', JSON.stringify({ from: TODAY, to: TODAY }));
  assert.strictEqual(r.success, false);
  assert.match(r.error.message, /не найдено Document_ПоступлениеТоваровУслуг/);
  assert.ok(J(call('v77GetIntegrations')).onec.lastError);
  J(call('v77OneCDisconnect'));
  assert.strictEqual(J(call('v77GetIntegrations')).onec.configured, false);
  const r2 = call('v77OneCPull', '{}');
  assert.strictEqual(r2.success, false);
  assert.match(r2.error.message, /настройте подключение к 1С/);
});
