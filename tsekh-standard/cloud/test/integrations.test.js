'use strict';
// Интеграции с учётными системами, этап 1 (MonChef_V77_Integrations.gs): загрузка продаж из отчёта кассы на настоящем коде .gs
// в среде выполнения сервера — журнал продаж, списание склада по партиям, повторы, сопоставление позиций.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tsekh-int-'));
const tenants = require('../lib/tenants');
test.after(() => fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }));

let T;
test.before(() => {
  tenants.create({ slug: 'int-kafe', name: 'Тест', ownerEmail: 'owner@example.ru', timeZone: 'Europe/Moscow' });
  T = tenants.get('int-kafe');
});

// Сессия директора заводится настоящей функцией входа (_createSession_) с правами роли; проверка прав — настоящая.
let TOKEN = '';
function run(body) {
  return T.execute((res) => () => {
    if (!TOKEN) TOKEN = res('_createSession_')({ id: 'E1', fullName: 'Директор Иванова', position: 'Директор', role: 'Директор' }, res('_mcRbEffective_')('Директор', 'E1')).token;
    const R = (n) => { if (/^\w+$/.test(n)) return res(n); return undefined; };
    return body(R);
  });
}
const J = (s) => { const r = typeof s === 'string' ? JSON.parse(s) : s; if (!r.success) throw new Error(JSON.stringify(r.error)); return r.data; };
// «сегодня» — в часовом поясе предприятия (Europe/Moscow), как его считает сервер, а не в поясе машины тестов
const pad = (n) => String(n).padStart(2, '0'), msk = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number);
const today = new Date(msk[0], msk[1] - 1, msk[2]);
const day = `${pad(today.getDate())}.${pad(today.getMonth() + 1)}.${today.getFullYear()}`;

test('подготовка: блюдо в ТТК и партии на складе', () => {
  run((res) => {
    const book = res('_book_')();
    const d = book.getSheetByName('Блюда') || book.insertSheet('Блюда'), s = book.getSheetByName('Состав') || book.insertSheet('Состав');
    if (d.getLastRow() < 1) d.appendRow(['Код', 'Название', 'Категория', 'Выход']);
    if (s.getLastRow() < 1) s.appendRow(['Код', 'Продукт', 'Ед', 'x', 'Брутто', 'Нетто', 'Выход', 'Ед. изм']);
    d.appendRow(['D-BORSCH', 'Борщ', 'Супы', 300]);
    s.appendRow(['D-BORSCH', 'Свёкла', 'кг', '', 0.2, 0.2, 0.2, 'кг']);
    const st = res('_stockBatchesSheet_')();
    st.appendRow(['B-SV1', 'Свёкла', 'кг', 10, new Date(2026, 0, 1), new Date(2099, 0, 1), 50, 'Приёмка', 0, 10, 'active']);
    st.appendRow(['B-W1', 'Вода питьевая', 'шт', 24, new Date(2026, 0, 1), new Date(2099, 0, 1), 20, 'Приёмка', 0, 24, 'active']);
  });
});

const CSV = [
  'Отчёт по продажам iiko',
  '',
  'Учетный день;Время закрытия;Номер чека;Блюдо;Количество блюд;Сумма со скидкой, р.',
  `${day};12:05;101;Борщ;2;600,00`,
  `${day};12:05;101;Вода питьевая;1;80`,
  `${day};12:40;102;Компот домашний;3;450`,
  `${day};13:10;103;Борщ;1;300`,
  `${day};13:10;103;Обслуживание 10%;1;30`,
  `${day};13:20;104;Борщ;-1;-300`,
  'Итого;;;;9;1160'
].join('\r\n');

test('предпросмотр: колонки найдены, неизвестные позиции названы, ничего не записано', () => {
  const d = run((res) => J(res('v77ImportSales')(JSON.stringify({ system: 'iiko', text: CSV, fileName: 'olap.csv', dry: true }), TOKEN)));
  assert.strictEqual(d.dry, true);
  assert.strictEqual(d.lines, 6);
  assert.strictEqual(d.columns.name, 'Блюдо');
  assert.strictEqual(d.columns.sum, 'Сумма со скидкой, р.');
  assert.deepStrictEqual(d.unmatched.map((x) => x.name).sort(), ['Компот домашний', 'Обслуживание 10%']);
  const n = run((res) => { const sh = res('_book_')().getSheetByName('Инт_Продажи'); return sh ? sh.getLastRow() : 0; });
  assert.ok(n <= 1);
});

test('загрузка: Борщ и вода проведены со списанием склада, неизвестное ждёт, возврат не проводится', () => {
  const d = run((res) => J(res('v77ImportSales')(JSON.stringify({ system: 'iiko', text: CSV, fileName: 'olap.csv' }), TOKEN)));
  assert.strictEqual(d.lines, 6);
  assert.strictEqual(d.recorded, 3, JSON.stringify(d));
  assert.strictEqual(d.pending, 2);
  assert.strictEqual(d.skipped, 1);
  assert.strictEqual(d.duplicates, 0);
  assert.strictEqual(d.autoMapped, 2);   // Борщ и Вода — точное совпадение названия
  const r = run((res) => {
    const j = res('_mcJById_')('J36'), v = res('_book_')().getSheetByName(j.sheetName).getDataRange().getValues();
    const st = res('_stockBatchesSheet_')().getDataRange().getValues();
    return { rows: v.slice(1).map((x) => [x[3], x[4], x[6], String(x[x.length - 2])]), sv: st.find((x) => x[0] === 'B-SV1')[9], w: st.find((x) => x[0] === 'B-W1')[9] };
  });
  assert.strictEqual(r.rows.length, 3);
  assert.ok(r.rows.every((x) => /загрузка iiko/.test(x[3]) && /SL-\d{8}-/.test(x[3])), JSON.stringify(r.rows));
  assert.deepStrictEqual(r.rows.map((x) => [x[0], Number(x[1]), Number(x[2])]), [['Борщ', 2, 600], ['Вода питьевая', 1, 80], ['Борщ', 1, 300]]);
  assert.strictEqual(Number(r.sv), 9.4);   // 3 порции × 0,2 кг свёклы
  assert.strictEqual(Number(r.w), 23);
});

test('повторная загрузка того же отчёта ничего не задваивает', () => {
  const d = run((res) => J(res('v77ImportSales')(JSON.stringify({ system: 'iiko', text: CSV, fileName: 'olap.csv' }), TOKEN)));
  assert.strictEqual(d.recorded, 0);
  assert.strictEqual(d.duplicates, 6);
  const n = run((res) => res('_book_')().getSheetByName(res('_mcJById_')('J36').sheetName).getLastRow());
  assert.strictEqual(n, 4);
});

test('два одинаковых пробития в одном чеке — две продажи, не повтор', () => {
  const csv = 'Дата;Время;Чек;Блюдо;Кол-во;Сумма\n' + `${day};14:00;200;Вода питьевая;1;80\n${day};14:00;200;Вода питьевая;1;80`;
  const d = run((res) => J(res('v77ImportSales')(JSON.stringify({ system: 'iiko', text: csv }), TOKEN)));
  assert.strictEqual(d.recorded, 2);
  const d2 = run((res) => J(res('v77ImportSales')(JSON.stringify({ system: 'iiko', text: csv }), TOKEN)));
  assert.strictEqual(d2.duplicates, 2);
});

test('сопоставление: «Обслуживание» не учитывается, «Компот» нельзя привязать к несуществующему блюду', () => {
  const s = run((res) => J(res('v77SaveMapping')(JSON.stringify({ system: 'iiko', name: 'Обслуживание 10%', kind: 'SKIP' }), TOKEN)));
  assert.strictEqual(s.applied, 1);
  assert.strictEqual(s.skipped, 1);
  const bad = run((res) => JSON.parse(res('v77SaveMapping')(JSON.stringify({ system: 'iiko', name: 'Компот домашний', kind: 'DISH', target: 'Компот' }), TOKEN)));
  assert.strictEqual(bad.success, false);
  assert.match(bad.error.message, /нет в ТТК/);
});

test('сопоставление с коэффициентом проводит ждущие строки сразу; экран показывает остаток', () => {
  run((res) => { const d = res('_book_')().getSheetByName('Блюда'); d.appendRow(['D-KOMPOT', 'Компот', 'Напитки', 200]); });
  const s = run((res) => J(res('v77SaveMapping')(JSON.stringify({ system: 'iiko', name: 'Компот домашний', kind: 'DISH', target: 'Компот', factor: '2' }), TOKEN)));
  assert.strictEqual(s.recorded, 1);
  assert.strictEqual(s.stillPending, 0);
  const g = run((res) => J(res('v77GetIntegrations')(TOKEN)));
  assert.strictEqual(g.pending.length, 0);
  assert.strictEqual(g.counts.RECORDED, 6);
  assert.ok(g.mappings.some((m) => m.name === 'Компот домашний' && m.factor === 2 && m.target === 'Компот'));
  assert.ok(g.imports.length >= 3);
  const last = run((res) => { const j = res('_mcJById_')('J36'), v = res('_book_')().getSheetByName(j.sheetName).getDataRange().getValues(); const r = v[v.length - 1]; return [r[3], Number(r[4]), Number(r[5]), Number(r[6])]; });
  assert.deepStrictEqual(last, ['Компот', 6, 75, 450]);   // 3 кружки × 2 = 6 порций, сумма из кассы
});

test('без колонки даты нужна дата; строки из Excel (rows) принимаются', () => {
  const rows = [['Наименование', 'Кол-во', 'Цена'], ['Борщ', 1, 300]];
  const bad = run((res) => JSON.parse(res('v77ImportSales')(JSON.stringify({ system: 'rkeeper', rows }), TOKEN)));
  assert.strictEqual(bad.success, false);
  assert.match(bad.error.message, /укажите дату/);
  const ok = run((res) => J(res('v77ImportSales')(JSON.stringify({ system: 'rkeeper', rows, date: day }), TOKEN)));
  assert.strictEqual(ok.recorded, 1);
  assert.strictEqual(ok.systemRu, 'R-Keeper');
});

test('ручная продажа после выделения общей записи работает как раньше', () => {
  const d = run((res) => J(res('mcSaleAdd')(JSON.stringify({ dish: 'Борщ', qty: 1, price: 300, requestId: 'manual-1' }), TOKEN)));
  assert.match(d.saleId, /^SL-\d{8}-/);
  assert.strictEqual(d.stock.status, 'FULL');
  const src = run((res) => { const j = res('_mcJById_')('J36'), v = res('_book_')().getSheetByName(j.sheetName).getDataRange().getValues(); return String(v[v.length - 1][v[0].indexOf('Источник записи')]); });
  assert.match(src, /^вручную · SL-\d{8}-[0-9A-F]{8} · req:manual-1$/);
  const again = run((res) => J(res('mcSaleAdd')(JSON.stringify({ dish: 'Борщ', qty: 1, price: 300, requestId: 'manual-1' }), TOKEN)));
  assert.strictEqual(again.duplicate, true);
});

test('строки из Excel: дата числом Excel, повтор файла не задваивается', () => {
  const serial = Math.round((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / 86400000) + 25569);
  const rows = [['Учетный день', 'Номер чека', 'Блюдо', 'Количество блюд', 'Сумма со скидкой, р.'], [serial + 0.5, 900, 'Вода питьевая', 2, 160]];
  const d = run((res) => J(res('v77ImportSales')(JSON.stringify({ system: 'iiko', rows, fileName: 'x.xlsx' }), TOKEN)));
  assert.strictEqual(d.recorded, 1);
  assert.strictEqual(d.from, `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`);
  const last = run((res) => { const j = res('_mcJById_')('J36'), v = res('_book_')().getSheetByName(j.sheetName).getDataRange().getValues(); return String(v[v.length - 1][2]); });
  assert.strictEqual(last, '12:00');
  const again = run((res) => J(res('v77ImportSales')(JSON.stringify({ system: 'iiko', rows, fileName: 'x.xlsx' }), TOKEN)));
  assert.strictEqual(again.duplicates, 1);
});
