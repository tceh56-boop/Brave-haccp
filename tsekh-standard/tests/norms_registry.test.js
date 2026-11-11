// Реестр нормативов: актуальные редакции (СанПиН 4282-26, СП 4284-26, СП 4285-26 с 01.09.2026) и перенос в таблицы предприятий.
// Запуск: node tests/norms_registry.test.js
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert'), { make } = require('./gas_mock');
const G = make('owner@example.com'), sheets = {};
const sheet = () => { const s = { data: [], getLastRow: () => s.data.length, getDataRange: () => ({ getValues: () => s.data.map(r => r.slice()) }),
  getRange: (r, c, nr = 1, nc = 1) => ({ setValues(v) { v.forEach((row, i) => { s.data[r - 1 + i] = s.data[r - 1 + i] || []; row.forEach((x, j) => { s.data[r - 1 + i][c - 1 + j] = x; }); }); return this; },
    setValue(x) { s.data[r - 1][c - 1] = x; return this; }, clearContent() { return this; } }) }; return s; };
const audits = [];
Object.assign(G, { _bcSheet_: (n, head) => { if (!sheets[n]) { sheets[n] = sheet(); sheets[n].data.push(head.slice()); } return sheets[n]; }, _withLock_: f => f(), _mcTz_: () => 'Europe/Moscow',
  _ts2Audit_: (...a) => audits.push(a), mcGateSession_: () => null });
const ctx = vm.createContext(G); vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app', 'TS_LaborSafety.gs'), 'utf8'), ctx);
const R = ctx.TS_LS_NORMS_, by = c => R.find(r => r[0] === c);
// 1. реестр поставщика
assert.strictEqual(by('SN-01')[6], 'УТРАТИЛ СИЛУ', 'СанПиН 3590-20 утратил силу с 01.09.2026');
assert.strictEqual(by('SN-06')[2], 'СанПиН 2.3/2.4.4282-26'); assert.strictEqual(by('SN-06')[6], 'ДЕЙСТВУЕТ');
assert.strictEqual(by('UT-03')[6], 'УТРАТИЛ СИЛУ'); assert.strictEqual(by('UT-06')[2], 'СП 2.2.4285-26'); assert.strictEqual(by('SN-07')[2], 'СП 2.1.4284-26');
assert(!R.some(r => r[6] === 'ПРОВЕРИТЬ'), 'все сверены');
assert.strictEqual(by('SN-02')[8], '2027-03-01'); assert.strictEqual(by('SN-06')[8], '2032-09-01'); assert.strictEqual(by('MO-01')[8], '2027-04-01'); assert(/01\.03\.2027/.test(by('SN-02')[4]) && /01\.04\.2027/.test(by('MO-01')[4]), 'ограниченный срок действия указан');
const src = fs.readdirSync(path.join(__dirname, '..', 'app')).filter(f => /^TS/.test(f)).map(f => fs.readFileSync(path.join(__dirname, '..', 'app', f), 'utf8')).join('\n');
const act = src.split('\n').filter(l => /3590-20/.test(l) && !/УТРАТИЛ СИЛУ|заменил|заменён|3590_20\.pdf|SN-05/.test(l));
assert.strictEqual(act.length, 0, 'СанПиН 3590-20 не упоминается как действующий: ' + act.join('\n'));
// 2. предприятие, развёрнутое до сверки: SN-01 само отметило «ДЕЙСТВУЕТ», TR-01 проверило само, остальное «ПРОВЕРИТЬ»
const head = ctx.TS_LS_SHEETS_.norms.head, oldHead = head.slice(0, 10), old = R.filter(r => !['SN-06', 'SN-07', 'UT-06'].includes(r[0]));
sheets['ЦС_Нормативы'] = sheet(); sheets['ЦС_Нормативы'].data.push(oldHead.slice());   // таблица старого формата — без «Действует до»
old.forEach(r => sheets['ЦС_Нормативы'].data.push([r[0], r[1], r[2], r[3], 'старый текст', r[5], r[0] === 'SN-01' ? 'ДЕЙСТВУЕТ' : r[0] === 'TR-01' ? 'ДЕЙСТВУЕТ' : r[0] === 'SN-05' ? 'УТРАТИЛ СИЛУ' : 'ПРОВЕРИТЬ', r[0] === 'TR-01' ? 'Иванова (ответственный)' : '', r[0] === 'TR-01' ? '2026-10-01' : '', '']));
G.PropertiesService.getScriptProperties().setProperty('TS_LS_SEEDED', '1');
const res = ctx._tsLsNormsMigrate_(), rows = () => { const d = sheets['ЦС_Нормативы'].data; return d.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]]))); }, row = c => rows().find(r => r['Код'] === c);
assert.strictEqual(row('SN-01')['Статус'], 'УТРАТИЛ СИЛУ', 'отменённый СанПиН снят даже при отметке предприятия');
assert(row('SN-06') && row('SN-07') && row('UT-06'), 'новые документы добавлены');
assert.strictEqual(row('TR-01')['Проверил'], 'Иванова (ответственный)', 'собственная проверка предприятия сохранена');
assert(rows().every(r => r['Статус'] !== 'ПРОВЕРИТЬ'));
assert(/drive\.google\.com/.test(row('TR-01')['Ссылка']), 'пустая ссылка заполнена');
assert(audits.some(a => a[0] === 'NORMS_REGISTRY_UPDATE'), 'изменения в аудите');
assert.strictEqual(sheets['ЦС_Нормативы'].data[0][10], 'Действует до', 'новая колонка дописана в старую таблицу');
assert.strictEqual(row('SN-02')['Действует до'], '2027-03-01', 'срок действия перенесён');
assert.strictEqual(ctx._tsLsNormsMigrate_().changed, 0, 'повторный запуск ничего не меняет');
console.log('OK: реестр нормативов — ' + R.length + ' документов, перенос в таблицу предприятия: ' + res.changed + ' изменений');
