'use strict';
// Проверки среды выполнения: npm test (node --test). Каждая проверка работает в своём временном каталоге данных.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tsekh-test-'));
const tenants = require('../lib/tenants');
const { formatDate, parseCsv } = require('../lib/gas/utilities');
const { due } = require('../lib/scheduler');
const { htmlToBlocks } = require('../lib/gas/googleapi');

test.after(() => fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }));

test('formatDate: шаблоны Java и часовой пояс', () => {
  const d = Date.UTC(2026, 10, 12, 5, 7, 9); // 12.11.2026 05:07:09 UTC
  assert.strictEqual(formatDate(new Date(d), 'Asia/Yekaterinburg', 'dd.MM.yyyy HH:mm:ss'), '12.11.2026 10:07:09');
  assert.strictEqual(formatDate(new Date(d), 'Europe/Moscow', "yyyy-MM-dd'T'HH:mm"), '2026-11-12T08:07');
});

test('parseCsv: кавычки и разделитель', () => {
  assert.deepStrictEqual(parseCsv('a;"b;c";"d ""e"""\n1;2;3', ';'), [['a', 'b;c', 'd "e"'], ['1', '2', '3']]);
});

test('планировщик: ежедневный триггер в заданный час срабатывает один раз в день', () => {
  const tz = 'Asia/Yekaterinburg';
  const at = (h) => Date.UTC(2026, 10, 12, h - 5, 1); // местное время = UTC+5
  const tr = { spec: { days: 1, hour: 9 }, created: at(1), last_run: 0 };
  assert.strictEqual(due(tr, at(8), tz), false);
  assert.strictEqual(due(tr, at(9), tz), true);
  assert.strictEqual(due({ ...tr, last_run: at(9) }, at(15), tz), false);
  assert.strictEqual(due({ ...tr, last_run: at(9) }, at(9) + 86400000, tz), true);
  assert.strictEqual(due({ spec: { every: 60000 }, created: 0, last_run: 1000 }, 30000, tz), false);
});

test('htmlToBlocks: абзацы, заголовки и таблицы из Word', () => {
  const b = htmlToBlocks('<h1>ТТК</h1><p>Борщ&nbsp;тестовый</p><table><tr><td>Свёкла</td><td>0,2</td></tr></table>');
  assert.deepStrictEqual(b, [{ tag: 'h1', text: 'ТТК' }, { tag: 'p', text: 'Борщ тестовый' }, { tag: 'table', rows: [['Свёкла', '0,2']] }]);
});

test('предприятие: создание, таблицы, свойства и функции проекта', () => {
  const r = tenants.create({ slug: 'test-kafe', name: 'Тест', ownerEmail: 'owner@example.ru', timeZone: 'Asia/Yekaterinburg' });
  assert.ok(r.root && r.sheet);
  assert.deepStrictEqual(r.triggers, ['installAllTriggers: ок', 'installTsTriggers: ок']);
  const t = tenants.get('test-kafe');
  assert.ok(t.store.triggers().length > 0, 'триггеры установлены');

  // запись в таблицу в одном выполнении видна в следующем (как в Google Таблицах)
  t.execute(() => () => {
    const sh = t.spreadsheetApp().openById(r.sheet).insertSheet('Проверка');
    sh.appendRow(['Дата', 'Блюдо', 'Порций']);
    sh.appendRow([new Date(2026, 10, 12), 'Борщ', 12]);
  });
  const v = t.execute(() => () => t.spreadsheetApp().openById(r.sheet).getSheetByName('Проверка').getDataRange().getValues());
  assert.strictEqual(v.length, 2);
  assert.strictEqual(v[1][1], 'Борщ');
  assert.strictEqual(v[1][2], 12);
  assert.ok(v[1][0] instanceof Date);

  // функция из исходников .gs находится по имени, глобальные переменные не переживают выполнение
  const tz = t.execute((res) => () => typeof res('doGet'));
  assert.strictEqual(tz, 'function');
  assert.strictEqual(t.store.prop('TS_TENANT_SHEET_ID'), r.sheet);
});

test('страница предприятия открывается (doGet)', () => {
  const t = tenants.get('test-kafe');
  const out = t.execute('doGet', [{ parameter: {}, parameters: {}, queryString: '' }]);
  assert.ok(out && typeof out.getContent === 'function');
  assert.ok(out.getContent().length > 1000);
});
