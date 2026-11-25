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

console.log(' 2) предзаказы → закупки и план производства');
(() => {
  const ds = ss.insertSheet('Блюда'); ds.appendRow(['Код', 'Название', 'Категория', 'Выход', '', 'Технология', '', '', 'Цех', '', '', '', 'Выход, г/мл/шт', 'Ед. выхода']);
  [['D001', 'Стейк рибай', 'Горячее', 'Горячий цех', 300, 'г'], ['PF10', 'Соус перечный п/ф', 'Соусы', 'Горячий цех', 500, 'г'], ['B010', 'Дайкири', 'Коктейли', 'Бар', 85, 'мл']]
    .forEach(r => ds.appendRow([r[0], r[1], r[2], r[4], '', '', '', '', r[3], '', '', '', r[4], r[5]]));
  const so = ss.insertSheet('Состав'); so.appendRow(['Код', 'Продукт', '', '', 'Брутто', 'Нетто', 'Выход', 'Ед.']);
  [['D001', 'Говядина рибай', 300, 'г'], ['D001', 'Соус перечный п/ф', 50, 'г'], ['PF10', 'Сливки 33%', 400, 'мл'], ['PF10', 'Перец чёрный', 20, 'г'], ['B010', 'Ром белый', 50, 'мл']]
    .forEach(r => so.appendRow([r[0], r[1], '', '', r[2], r[2], r[2], r[3]]));
  const pr = ss.insertSheet('Цены_Меню'); pr.appendRow(['PriceID', 'DishCode', 'DishName', 'Price', 'Unit', 'Source', 'EventID', 'DateFrom', 'DateTo', 'Status']);
  [['P1', 'D001', 1500, '100 г'], ['P3', 'B010', 650, 'порц.']].forEach(r => pr.appendRow([r[0], r[1], '', r[2], r[3], 'MENU', '', '2026-11-01', '', 'ACTIVE']));
  const tv = ss.insertSheet('ТТК_Версии'); tv.appendRow(['Код блюда', 'Версия', 'Статус']); ['D001', 'PF10', 'B010'].forEach(c => tv.appendRow([c, 1, 'действующая']));
})();
let planW;
t('подтверждённый предзаказ (2 стейка, 680 г весом, 2 дайкири) — в недельном плане: сырьё и п/ф к закупке и производству', () => {
  const bk = ok(call('rsBookingCreate', ADM, { idem: key(), tables: [V[0].id], guest: 'Соколовы', date: '2026-11-26', start: '19:00', duration: 120, guests: 4, status: 'CONFIRMED',
    preorder: { items: [{ code: 'D001', qty: 680, unit: 'г' }, { code: 'B010', qty: 2 }] } })).booking;
  const po = ok(call('rsBookingList', ADM, { from: '2026-11-26' })).bookings.find(b => b.id === bk.id).preorder;
  ok(call('rsPreorderSave', ADM, { idem: key(), bookingId: bk.id, version: po.version, confirm: true, items: po.items }));
  drop(); planW = J(C.getWeeklyDispatcher('2026-11-25', CHEF)); assert.ok(planW.ok || planW.success, JSON.stringify(planW).slice(0, 300)); planW = planW.data.plan;
  const pe = planW.events.filter(e => e.source === 'PREORDER'); assert.strictEqual(pe.length, 1); assert.strictEqual(pe[0].items.find(i => i.code === 'D001').qty, 2.267, '680 г ÷ 300 г');
  const beef = planW.purchase.find(p => p.name === 'Говядина рибай'), rum = planW.purchase.find(p => p.name === 'Ром белый');
  assert.ok(beef && Math.abs(beef.required - 680) < 0.5, JSON.stringify(beef)); assert.ok(rum && rum.required === 100 && rum.shortage === 100);
  assert.ok(planW.pfShortages.some(p => p.name === 'Соус перечный п/ф'), 'п/ф соуса — к производству');
  assert.ok(planW.purchase.some(p => p.name === 'Сливки 33%' && p.required > 0), 'сырьё п/ф — к закупке');
  assert.ok(!planW.production.some(x => x.code === 'D001' || x.code === 'B010'), 'блюда предзаказа не превращаются в задания «изготовить заранее»');
  assert.ok(planW.production.some(x => x.code === 'PF10'), 'задание на п/ф');
});
t('план записан: строка «PREORDER» в плане, задачи канбана п/ф, заявки поставщикам по нехватке', () => {
  drop(); const r = J(C.createWeeklyDispatcherPlan('2026-11-25', CHEF)); assert.ok(r.ok || r.success, JSON.stringify(r).slice(0, 300));
  const pid = (r.data || r).planId;
  assert.ok(rows('Недельный_План').some(x => x.Type === 'PREORDER' && x.PlanID === pid), 'строка предзаказа в плане');
  drop(); const q = J(C.createWeeklyPurchaseRequests(pid, CHEF)); assert.ok(q.success, JSON.stringify(q).slice(0, 300));
  const names = q.data.created.map(x => x.product); assert.ok(names.includes('Ром белый') && names.includes('Говядина рибай'), names.join(', '));
});
t('отменённая бронь — предзаказ из плана уходит; склад предзаказ не трогает', () => {
  const b = rows('Бронирования_V1').find(r => r['Гость'] === 'Соколовы');
  ok(call('rsBookingStatus', ADM, { idem: key(), id: b.BookingID, version: b.Version, status: 'CANCELLED', reason: 'гости отменили' }));
  drop(); const p2 = J(C.getWeeklyDispatcher('2026-11-25', CHEF)).data.plan; assert.strictEqual(p2.events.filter(e => e.source === 'PREORDER').length, 0);
  assert.ok(!rows('Склад_Операции').length);
});

console.log(' 3) Stop/Go по остаткам');
const income = (name, qty, unit) => { drop(); C._withLock_(() => C._incomeWithBatches_([{ name, qty, unit, price: 1 }], 'Поставщик', '', null)); const sh = ss.getSheetByName('Склад_Партии'), n = sh.getLastRow(); for (let i = 2; i <= n; i++) sh.getRange(i, 11).setValue('active'); };
const sugs = () => rows('СтопГО_Предложения_V1');
t('«Готово» по дайкири: на следующую порцию рома не хватает — предложение STOP бару и уведомление менеджеру бара; STOP сам не ставится', () => {
  income('Ром белый', 120, 'мл');
  const o = ok(call('rsOrderOpen', WAI, { idem: key(), tableId: V[1].id, guests: 2 })).orderId;
  ok(call('rsItemAdd', WAI, { idem: key(), orderId: o, items: [{ code: 'B010', qty: 2 }] }));
  ok(call('rsOrderSend', WAI, { idem: key(), orderId: o, mode: 'all' }));
  let tk = ok(call('rsKdsData', BAR, { dept: 'BAR' })).tickets[0];
  tk = ok(call('rsTicketAct', BAR, { idem: key(), ticketId: tk.id, version: tk.version, action: 'start' })).ticket;
  ok(call('rsTicketAct', BAR, { idem: key(), ticketId: tk.id, version: tk.version, action: 'ready' }));
  const sg = sugs().filter(r => r.DishCode === 'B010' && r['Статус'] === 'OPEN'); assert.strictEqual(sg.length, 1); assert.strictEqual(sg[0]['Предложение'], 'STOP'); assert.strictEqual(sg[0]['Подразделение'], 'BAR');
  assert.ok(/Ром белый/.test(sg[0]['Нехватка']));
  assert.ok(rows('Уведомления').some(r => /Не хватит на следующую порцию: Дайкири/.test(JSON.stringify(r))));
  assert.ok(!ok(call('rsStopList', BAR, { dept: 'BAR' })).current.some(x => x.code === 'B010'), 'STOP не поставлен автоматически');
});
t('проверка всего меню (кнопка): стейк без говядины — предложение кухне; повтор не дублирует предложения', () => {
  const r = ok(call('rsStopWatchRun', CHEF, {})); assert.ok(r.checked >= 2);
  assert.ok(sugs().some(x => x.DishCode === 'D001' && x['Статус'] === 'OPEN' && x['Подразделение'] === 'KITCHEN'));
  const n = sugs().length; ok(call('rsStopWatchRun', CHEF, {})); assert.strictEqual(sugs().length, n);
  err(call('rsStopWatchRun', WAI, {}));
});
t('экран: предложения по подразделению; бармен ставит STOP одним нажатием (причина «Закончилось сырьё»), кухонное — не может', () => {
  const l = ok(call('rsStopSuggestions', BAR, { dept: 'BAR' })).suggestions; assert.deepStrictEqual(l.map(x => x.code), ['B010']);
  const k = ok(call('rsStopSuggestions', CHEF, { dept: 'KITCHEN' })).suggestions.find(x => x.code === 'D001');
  err(call('rsStopSuggestDecide', BAR, { idem: key(), id: k.id, accept: true }));
  ok(call('rsStopSuggestDecide', BAR, { idem: key(), id: l[0].id, accept: true }));
  const cur = ok(call('rsStopList', BAR, { dept: 'BAR' })).current.find(x => x.code === 'B010'); assert.strictEqual(cur.status, 'STOP'); assert.strictEqual(cur.reason, 'Закончилось сырьё');
  assert.ok(/По остаткам: нет Ром белый/.test(cur.comment)); assert.strictEqual(sugs().find(x => x.SuggID === l[0].id)['Статус'], 'APPLIED');
  err(call('rsItemAdd', WAI, { idem: key(), orderId: ok(call('rsOrderOpen', WAI, { idem: key(), tableId: T[2].id, guests: 1 })).orderId, items: [{ code: 'B010', qty: 1 }] }));
});
t('приход рома — предложение вернуть GO; приход говядины — предложение STOP по стейку закрывается само', () => {
  income('Ром белый', 700, 'мл'); income('Говядина рибай', 3000, 'г'); income('Сливки 33%', 1000, 'мл'); income('Перец чёрный', 100, 'г');
  ok(call('rsStopWatchRun', CHEF, {}));
  const go = sugs().filter(x => x.DishCode === 'B010' && x['Предложение'] === 'GO' && x['Статус'] === 'OPEN'); assert.strictEqual(go.length, 1);
  assert.ok(sugs().filter(x => x.DishCode === 'D001' && x['Предложение'] === 'STOP').every(x => x['Статус'] !== 'OPEN'), 'предложение по стейку закрыто');
  ok(call('rsStopSuggestDecide', BAR, { idem: key(), id: go[0].SuggID, accept: false, comment: 'вернём после проверки льда' }));
  assert.strictEqual(sugs().find(x => x.SuggID === go[0].SuggID)['Статус'], 'DISMISSED');
  assert.ok(C.MC_SCHEDULE.some(j => j.fn === 'rsStopWatchTick_' && j.everyMin === 60), 'проверка раз в час — в расписании');
});

console.log('\nИтого: ' + pass + ' пройдено, ' + fail + ' не пройдено');
process.exit(fail ? 1 : 0);
