// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
// Restaurant Service, этап 9: связи с модулями MON CHEF. Запуск: node monchef/tools/rs_stage9.test.js
const assert = require('assert');
const { boot } = require('./gasemu');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e)); } }
const J = s => (typeof s === 'string' ? JSON.parse(s) : s);
let seq = 0; const key = () => 'st9-key-' + (++seq);

const E = boot({ now: '2026-11-25T08:00:00Z' }), C = E.ctx, ss = E.ss;
E.props[C.MC_MED_GATE_PROP_] = 'off';
const emp = ss.insertSheet('Сотрудники');
emp.appendRow(['Фамилия', 'Имя', 'Отчество', 'Должность', 'Роль', 'ДР', 'Телефон', 'Адрес', 'ПИН-код', '', '', '', 'Активен']);
[['Директорова', 'Анна', 'Директор', '1111'], ['Админов', 'Пётр', 'Администратор', '2222'], ['Официантов', 'Иван', 'Официант', '3333'], ['Шефов', 'Марк', 'Шеф-повар', '7777'], ['Барменов', 'Лев', 'Бармен', '8888']]
  .forEach(r => emp.appendRow([r[0], r[1], '', r[2], r[2], '', '', '', r[3], '', '', '', true]));
const login = pin => J(C.loginWithPin(pin, 'dev-' + pin)).token;
const DIR = login('1111'), ADM = login('2222'), WAI = login('3333'), CHEF = login('7777'), BAR = login('8888');
const drop = () => { C._mcRcDrop_(); C._BOOK_CACHE_ = null; };
const call = (fn, tok, d) => { drop(); return J(C[fn](JSON.stringify(d || {}), tok)); };
const ok = r => { assert.ok(r.success === true || r.ok === true, JSON.stringify(r).slice(0, 400)); return r.data !== undefined ? r.data : r; };
const err = (r, code) => { assert.ok(!(r.success === true || r.ok === true), 'ожидался отказ: ' + JSON.stringify(r).slice(0, 300)); if (code) assert.strictEqual(r.error && r.error.code, code, JSON.stringify(r)); return r; };
const rows = name => { drop(); const sh = ss.getSheetByName(name); if (!sh) return []; const v = sh.getDataRange().getValues(), h = v[0]; return v.slice(1).map(r => { const o = {}; h.forEach((k, i) => o[k] = r[i]); return o; }); };
const saveEv = ev => { drop(); const id = C.saveEvent(JSON.stringify(Object.assign({ items: [], status: 'Подтверждён' }, ev)), DIR); assert.ok(/^E\d/.test(String(id)), 'банкет: ' + id); return id; };
const bqBk = id => rows('Бронирования_V1').filter(r => String(r['Банкет']) === id);

const hall = ok(call('rsHallSave', ADM, { idem: key(), name: 'Основной зал', width: 8, height: 5 }));
const veranda = ok(call('rsHallSave', ADM, { idem: key(), name: 'Веранда', width: 6, height: 4 }));
const T = ['1', '2', '3'].map((n, i) => ok(call('rsTableSave', ADM, { idem: key(), hallId: hall.id, number: n, x: i * 2, y: 1, seatsMax: 6 })));
const V = ['21', '22'].map((n, i) => ok(call('rsTableSave', ADM, { idem: key(), hallId: veranda.id, number: n, x: i * 2, y: 1, seatsMax: 4 })));

console.log('Restaurant Service — этап 9: связи модулей');
console.log(' 1) банкеты ↔ брони зала');
let e1, e2, e3;
t('банкет «Место: Основной зал, 18:00–23:00» → бронь всех столов зала на это время; столы банкета не забронировать', () => {
  e1 = saveEv({ date: '2026-11-27', time: '18:00–23:00', format: 'Юбилей Петровых', place: 'Основной зал', guests: 40, contact: '+7 900 000-00-00' });
  const b = bqBk(e1); assert.strictEqual(b.length, 1); assert.strictEqual(b[0]['Статус'], 'CONFIRMED');
  assert.deepStrictEqual(JSON.parse(b[0]['Столы']).sort(), T.map(x => x.id).sort()); assert.strictEqual(b[0]['Начало'], '18:00'); assert.strictEqual(Number(b[0]['Длительность, мин']), 300);
  err(call('rsBookingCreate', ADM, { idem: key(), tables: [T[0].id], guest: 'Смирнов', date: '2026-11-27', start: '20:00', duration: 90, guests: 2, status: 'CONFIRMED' }), 'CONFLICT');
  ok(call('rsBookingCreate', ADM, { idem: key(), tables: [T[0].id], guest: 'Смирнов', date: '2026-11-27', start: '13:00', duration: 90, guests: 2, status: 'CONFIRMED' }));
  ok(call('rsBookingCreate', ADM, { idem: key(), tables: [V[0].id], guest: 'Ивановы', date: '2026-11-27', start: '19:00', duration: 90, guests: 2, status: 'CONFIRMED' }));
});
t('схема зала: в часы банкета столы заняты бронью банкета', () => {
  const d = ok(call('rsHallData', ADM, { date: '2026-11-27', time: '19:00' }));
  const st = d.tables.filter(x => x.hallId === hall.id).map(x => x.state); assert.ok(st.every(x => x !== 'free'), JSON.stringify(st));
});
t('банкет поверх принятых броней записывается, администратор и директор получают уведомление, в списке банкетов — пересечение', () => {
  ok(call('rsBookingCreate', ADM, { idem: key(), tables: [V[1].id], guest: 'Кузнецов', date: '2026-11-28', start: '19:00', duration: 120, guests: 3, status: 'CONFIRMED' }));
  e2 = saveEv({ date: '2026-11-28', time: '18:00', format: 'Корпоратив', place: 'Веранда', guests: 8 });
  const b = bqBk(e2); assert.strictEqual(b.length, 1); assert.strictEqual(Number(b[0]['Длительность, мин']), 300, 'только начало — 5 часов');
  const n = rows('Уведомления').filter(r => /Корпоратив/.test(JSON.stringify(r))); assert.ok(n.length >= 1, 'уведомление');
  const l = ok(call('rsBanquetList', ADM, { from: '2026-11-25' })).banquets.find(x => x.id === e2);
  assert.strictEqual(l.booking.hall, 'Веранда'); assert.strictEqual(l.conflicts.length, 1); assert.strictEqual(l.conflicts[0].guest, 'Кузнецов');
});
t('правка банкета (время, гости) — бронь обновлена; повторное сохранение без изменений бронь не трогает', () => {
  saveEv({ id: e1, date: '2026-11-27', time: '19:00–23:30', format: 'Юбилей Петровых', place: 'Основной зал', guests: 45 });
  let b = bqBk(e1)[0]; assert.strictEqual(b['Начало'], '19:00'); assert.strictEqual(Number(b['Длительность, мин']), 270); assert.strictEqual(Number(b['Гостей']), 45);
  const v = b.Version; drop(); const r = C._rsBanquetSync_(e1, { id: e1, date: '2026-11-27', time: '19:00–23:30', format: 'Юбилей Петровых', place: 'Основной зал', guests: 45, status: 'Подтверждён' }, null);
  assert.ok(r.unchanged); b = bqBk(e1)[0]; assert.strictEqual(b.Version, v);
});
t('бронь банкета не меняется и не отменяется из зала — только в «Банкетах»', () => {
  const b = bqBk(e1)[0];
  err(call('rsBookingUpdate', ADM, { idem: key(), id: b.BookingID, version: b.Version, guests: 10 }), 'VALIDATION');
  err(call('rsBookingStatus', ADM, { idem: key(), id: b.BookingID, version: b.Version, status: 'CANCELLED', reason: 'x' }), 'VALIDATION');
});
t('банкет без зала («Место: выездной») не бронирует; привязка вручную к двум столам; правка банкета сохраняет столы', () => {
  e3 = saveEv({ date: '2026-11-29', time: '', format: 'Фуршет', place: 'выездной', guests: 10 });
  assert.strictEqual(bqBk(e3).length, 0);
  const l = ok(call('rsBanquetList', ADM, { from: '2026-11-25' })).banquets.find(x => x.id === e3); assert.strictEqual(l.booking, null); assert.ok(l.allDay);
  err(call('rsBanquetLink', WAI, { idem: key(), eventId: e3, tables: [T[0].id, T[1].id], start: '12:00', duration: 180 }));
  ok(call('rsBanquetLink', ADM, { idem: key(), eventId: e3, tables: [T[0].id, T[1].id], start: '12:00', duration: 180 }));
  saveEv({ id: e3, date: '2026-11-29', time: '', format: 'Фуршет', place: 'выездной', guests: 12 });
  const b = bqBk(e3).filter(r => r['Статус'] !== 'CANCELLED')[0];
  assert.deepStrictEqual(JSON.parse(b['Столы']).sort(), [T[0].id, T[1].id].sort()); assert.strictEqual(b['Начало'], '12:00'); assert.strictEqual(Number(b['Длительность, мин']), 180); assert.strictEqual(Number(b['Гостей']), 12);
});
t('ручная привязка поверх брони — только «несмотря на пересечения»', () => {
  const e4 = saveEv({ date: '2026-11-27', time: '13:00', format: 'Бизнес-ланч', place: 'офис', guests: 4 });
  err(call('rsBanquetLink', ADM, { idem: key(), eventId: e4, tables: [T[0].id] }), 'CONFLICT');
  ok(call('rsBanquetLink', ADM, { idem: key(), eventId: e4, tables: [T[0].id], force: true }));
});
t('отмена банкета (статус) и удаление банкета освобождают столы', () => {
  saveEv({ id: e2, date: '2026-11-28', time: '18:00', format: 'Корпоратив', place: 'Веранда', guests: 8, status: 'Отменён' });
  assert.strictEqual(bqBk(e2)[0]['Статус'], 'CANCELLED');
  drop(); assert.strictEqual(C.deleteEvent(e1, DIR), 'ok');
  assert.ok(bqBk(e1).every(r => r['Статус'] === 'CANCELLED'));
  ok(call('rsBookingCreate', ADM, { idem: key(), tables: [T[2].id], guest: 'Орлов', date: '2026-11-27', start: '20:00', duration: 90, guests: 2, status: 'CONFIRMED' }));
});

console.log('\nИтого: ' + pass + ' пройдено, ' + fail + ' не пройдено');
process.exit(fail ? 1 : 0);
