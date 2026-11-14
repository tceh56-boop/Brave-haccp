/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
// «Экономика» → «Кассы и 1С» (интеграции, этап 1): загрузка отчёта кассы из Excel (.xlsx читается в браузере) и CSV, сопоставление позиций — кнопки вызывают сервер.
// Запуск: node tests/finance_integrations.browser.test.js (нужен exceljs из cloud/node_modules — npm ci в cloud)
const { chromium } = require('playwright'), path = require('path'), assert = require('assert'), fs = require('fs'), os = require('os');
const ExcelJS = require(path.join(__dirname, '..', 'cloud', 'node_modules', 'exceljs'));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'int-ui-')), xlsx = path.join(dir, 'iiko_olap.xlsx'), csv = path.join(dir, 'rk.csv');
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Продажи');
  ws.addRow(['Отчёт по продажам']); ws.addRow([]);
  ws.addRow(['Учетный день', 'Номер чека', 'Блюдо', 'Количество блюд', 'Сумма со скидкой, р.']);
  ws.addRow([new Date(Date.UTC(2026, 10, 14)), 101, 'Борщ', 2, 600]);
  ws.addRow([new Date(Date.UTC(2026, 10, 14)), 102, 'Компот домашний', 3, 450.5]);
  await wb.xlsx.writeFile(xlsx);
  fs.writeFileSync(csv, Buffer.from('Наименование;Кол-во;Сумма\r\nБорщ;1;300\r\n', 'utf8'));
  const b = await chromium.launch(), p = await (await b.newContext()).newPage(), errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => {
    window.__calls = []; window.confirm = () => true;
    const st = { mode: 'READY_TO_WORK', enterpriseType: 'RESTAURANT', types: { RESTAURANT: 'Ресторан' }, org: { name: 'Тест', inn: '', address: '', responsible: '', complete: false }, timezone: 'Europe/Moscow', employees: 1, dishes: 1,
      workshops: [], objects: [], summary: { created: 1, requiresDecision: 0, numericObjects: 0, blockers: 0 } };
    const I = { iiko: { configured: true, url: 'https://kafe.iiko.it', login: 'api', auto: true, lastSync: '2026-11-14T15:00:00.000Z', lastError: '', lastResult: { recorded: 7, pending: 1, otherSource: 0 } }, systems: [{ id: 'iiko', name: 'iiko' }, { id: 'rkeeper', name: 'R-Keeper' }, { id: '1c', name: '1С' }, { id: 'other', name: 'Другая касса' }], counts: { RECORDED: 5, PENDING: 3, SKIPPED: 1, CLOSED: 0, ERROR: 0 },
      pending: [{ system: 'iiko', systemRu: 'iiko', extId: '77', name: 'Компот домашний', lines: 1, qty: 3, sum: 450, note: 'нет в ТТК и на складе под таким названием — сопоставьте позицию' }],
      mappings: [{ id: 'MAP-1', system: 'iiko', systemRu: 'iiko', extId: '', name: 'Борщ', kind: 'DISH', kindRu: 'блюдо по ТТК', target: 'Борщ', unit: '', factor: 1, auto: 'точное совпадение названия' }],
      imports: [{ id: 'INT-1', systemRu: 'iiko', source: 'файл', fileName: 'olap.xlsx', from: '2026-11-14', to: '2026-11-14', lines: 6, recorded: 5, duplicates: 0, pending: 1, skipped: 1, closed: 0, errors: 0, at: '14.11.2026 20:00', by: 'Директор' }],
      problems: [{ date: '2026-11-14', check: '101', name: 'Борщ', qty: 2, statusRu: 'проведена', saleId: 'SL-1', note: 'списано не полностью: не хватило Свёкла' }],
      dishes: ['Борщ', 'Компот'], goods: [{ name: 'Вода питьевая', unit: 'шт' }], note: 'Продажи из кассы проводятся как обычные продажи.' };
    const D = { uiMe: () => ({ ok: true, name: 'Директор Тест', role: 'Директор', sections: ['home'], dev: true, modules: {} }), getAppUrl: () => '', uiData: () => ({ ok: true, kpis: [], tabs: [] }),
      tsGetPlanInfo: () => JSON.stringify({ success: true, data: { plan: 'pro', planName: 'Pro', status: 'ACTIVE', mode: 'full', features: { journals: true }, plans: [], featureNames: {}, lockedSections: {} } }),
      ts2Wizard: () => JSON.stringify({ success: true, data: st }), v77GetIntegrations: () => JSON.stringify({ success: true, data: I }),
      v77ImportSales: (j) => { const d = JSON.parse(j); return JSON.stringify({ success: true, data: d.dry ? { dry: true, lines: 2, from: '2026-11-14', to: '2026-11-14', sum: 1050.5, items: 2, errors: [], columns: { name: 'Блюдо', qty: 'Количество блюд' },
        unmatched: [{ name: 'Компот домашний', lines: 1, match: '' }] } : { recorded: 1, duplicates: 0, pending: 1, skipped: 0, closedSkipped: 0, errors: 0 } }); },
      v77IikoSave: () => JSON.stringify({ success: true, data: { settings: {}, check: { ok: true, message: 'Вход в iiko выполнен' } } }),
      v77IikoPull: () => JSON.stringify({ success: true, data: { lines: 3, recorded: 2, duplicates: 0, pending: 1, otherSource: 1, otherSourceDays: [{ day: '2026-11-11' }] } }),
      v77IikoCharts: () => JSON.stringify({ success: true, data: { totals: { charts: 2, same: 0, diff: 1, missing: 1 }, charts: [{ dish: 'Борщ', cehDish: 'Борщ', items: 2, issues: ['Свёкла: брутто iiko 200 г, ЦЕХ 250 г (-20 %)'] }, { dish: 'Плов', cehDish: '', items: 1, issues: ['нет в ТТК ЦЕХ'] }], note: 'ТТК ЦЕХ не меняются' } }),
      v77IikoInvoices: () => JSON.stringify({ success: true, data: { invoices: 2, loaded: { newLines: 3 }, notReceived: [{ date: '2026-11-13', number: '000077', supplier: 'ООО Мясо', lines: 1, sum: 75 }], matched: [{ date: '2026-11-12', number: 'УПД-15', supplier: 'Овощная база', lines: 2, sum: 550, cehSum: 540, diff: -10 }] } }),
      v77SaveMapping: () => JSON.stringify({ success: true, data: { applied: 1, recorded: 1, skipped: 0, closed: 0 } }) };
    function mk(s) { s = s || {}; return new Proxy({}, { get(t, k) {
      if (k === 'withSuccessHandler') return f => mk(Object.assign({}, s, { ok: f })); if (k === 'withFailureHandler') return f => mk(Object.assign({}, s, { fl: f })); if (k === 'withUserObject') return u => mk(Object.assign({}, s, { uo: u }));
      return (...a) => setTimeout(() => { window.__calls.push(k + ':' + JSON.stringify(a)); try { (s.ok || (() => {}))(D[k] ? D[k](...a) : { ok: true, data: [] }, s.uo); } catch (e) { (s.fl || (() => {}))(e, s.uo); } }, 5); } }); }
    window.google = { script: { run: mk() } };
  });
  await p.goto('file://' + path.join(__dirname, '..', 'app', 'Console.html'));
  await p.evaluate(() => { localStorage.setItem('mc_token', 'x'); TOKEN = 'x'; start(null); }); await p.waitForTimeout(400);
  const calls = () => p.evaluate(() => window.__calls.filter(c => /^v77/.test(c))), txt = async () => (await p.textContent('#vbody')).replace(/\s+/g, ' ');
  await p.evaluate(() => { openView('finance', 'int'); }); await p.waitForTimeout(500);
  let t = await txt();
  ['Кассы и 1С', 'Загрузить продажи из кассы', 'Ждут сопоставления', 'Компот домашний', 'Сопоставления', 'точное совпадение названия', 'Проведено с замечаниями', 'не хватило Свёкла', 'Загрузки', 'olap.xlsx'].forEach(s => assert(t.includes(s), 'экран: ' + s));
  // Excel → строки в браузере; «Проверить файл» — без записи
  await p.setInputFiles('#mvf_ifile', xlsx); await p.click('button[data-mv="intCheck"]'); await p.waitForTimeout(800);
  let c = (await calls()).filter(x => x.startsWith('v77ImportSales:')).pop(); assert(c, 'проверка вызвана');
  let pay = JSON.parse(JSON.parse(c.slice('v77ImportSales:'.length))[0]);
  assert.strictEqual(pay.dry, true); assert.strictEqual(pay.system, 'iiko'); assert.strictEqual(pay.fileName, 'iiko_olap.xlsx');
  assert.deepStrictEqual(pay.rows[2], ['Учетный день', 'Номер чека', 'Блюдо', 'Количество блюд', 'Сумма со скидкой, р.']);
  assert.deepStrictEqual(pay.rows[3].slice(1), [101, 'Борщ', 2, 600]); assert.strictEqual(pay.rows[4][4], 450.5);
  assert.strictEqual(pay.rows[3][0], 46340, 'дата Excel числом: 14.11.2026');
  t = await txt(); assert(t.includes('Компот домашний') && t.includes('Колонки: Блюдо, Количество блюд'), 'результат проверки показан');
  // CSV R-Keeper с датой из поля
  await p.selectOption('#mvf_isys', 'rkeeper'); await p.setInputFiles('#mvf_ifile', csv); await p.fill('#mvf_idate', '2026-11-13'); await p.click('button[data-mv="intImport"]'); await p.waitForTimeout(800);
  c = (await calls()).filter(x => x.startsWith('v77ImportSales:')).pop(); pay = JSON.parse(JSON.parse(c.slice('v77ImportSales:'.length))[0]);
  assert.strictEqual(pay.system, 'rkeeper'); assert.strictEqual(pay.date, '2026-11-13'); assert(!pay.dry); assert(/Борщ;1;300/.test(pay.text));
  // сопоставление из списка ждущих
  await p.evaluate(() => { openView('finance', 'int'); }); await p.waitForTimeout(500);
  await p.click('button[data-mv="intPick"]'); await p.selectOption('#mvf_mtarget', 'DISH|Компот'); await p.fill('#mvf_mfactor', '2'); await p.click('button[data-mv="intMap"]'); await p.waitForTimeout(500);
  c = (await calls()).filter(x => x.startsWith('v77SaveMapping:')).pop();
  assert.deepStrictEqual(JSON.parse(JSON.parse(c.slice('v77SaveMapping:'.length))[0]), { system: 'iiko', name: 'Компот домашний', extId: '77', kind: 'DISH', target: 'Компот', factor: '2' });
  // iiko по API
  await p.evaluate(() => { openView('finance', 'int'); }); await p.waitForTimeout(500);
  t = await txt(); ['iiko по API', 'Подключено: https://kafe.iiko.it', 'каждые 30 минут', 'проведено 7'].forEach(s => assert(t.includes(s), 'iiko: ' + s));
  await p.fill('#mvf_ipass', 'secret'); await p.click('button[data-mv="iikoSave"]'); await p.waitForTimeout(500);
  c = (await calls()).filter(x => x.startsWith('v77IikoSave:')).pop();
  assert.deepStrictEqual(JSON.parse(JSON.parse(c.slice('v77IikoSave:'.length))[0]), { url: 'https://kafe.iiko.it', login: 'api', password: 'secret', auto: true });
  await p.evaluate(() => { openView('finance', 'int'); }); await p.waitForTimeout(500);
  await p.fill('#mvf_ifrom', '2026-11-10'); await p.fill('#mvf_ito', '2026-11-14'); await p.click('button[data-mv="iikoPull"]'); await p.waitForTimeout(500);
  c = (await calls()).filter(x => x.startsWith('v77IikoPull:')).pop();
  assert.deepStrictEqual(JSON.parse(JSON.parse(c.slice('v77IikoPull:'.length))[0]), { from: '2026-11-10', to: '2026-11-14' });
  await p.evaluate(() => { openView('finance', 'int'); }); await p.waitForTimeout(500);
  await p.fill('#mvf_cdate', '2026-11-14'); await p.click('button[data-mv="iikoCharts"]'); await p.waitForTimeout(500);
  t = await txt(); assert(t.includes('брутто iiko 200 г') && t.includes('нет в ТТК ЦЕХ'), 'сверка техкарт показана');
  assert(/v77IikoCharts:\["\{\\"date\\":\\"2026-11-14\\"\}"/.test((await calls()).join('\n')), 'дата техкарт уходит на сервер');
  await p.click('button[data-mv="iikoInv"]'); await p.waitForTimeout(500);
  t = await txt(); assert(t.includes('Нет приёмки в ЦЕХ') && t.includes('000077') && t.includes('УПД-15'), 'сверка накладных показана');
  assert.strictEqual(errs.length, 0, 'ошибки страницы: ' + errs.join('; '));
  await b.close(); fs.rmSync(dir, { recursive: true, force: true });
  console.log('OK: Экономика → Кассы и 1С — Excel и CSV, проверка без записи, загрузка, сопоставление, iiko по API: кнопки вызывают сервер');
})().catch(e => { console.error(e); process.exit(1); });
