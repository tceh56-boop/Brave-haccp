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
[['Директорова', 'Анна', 'Директор', '1111'], ['Админов', 'Пётр', 'Администратор', '2222'], ['Официантов', 'Иван', 'Официант', '3333'], ['Шефов', 'Марк', 'Шеф-повар', '7777'], ['Барменов', 'Лев', 'Бармен', '8888'], ['Холодов', 'Ян', 'Повар холодного цеха', '4444'], ['Хасапов', 'Ким', 'Ответственный за ХАССП', '5555'], ['Петров', 'Олег', 'Официант', '3334']]
  .forEach(r => emp.appendRow([r[0], r[1], '', r[2], r[2], '', '', '', r[3], '', '', '', true]));
const login = pin => J(C.loginWithPin(pin, 'dev-' + pin)).token;
const DIR = login('1111'), ADM = login('2222'), WAI = login('3333'), CHEF = login('7777'), BAR = login('8888'), COLD = login('4444'), HACCP = login('5555'), WAI2 = login('3334');
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

console.log(' 4) ХАССП у плиты: ККТ при «Готово», бракераж блюд зала');
let o4, tk4;
t('стейку назначена ККТ «t° в толще ≥ 75 °C»: на карточке задания — поле замера; «Готово» без замера заблокировано', () => {
  C._v30Init_();
  ss.getSheetByName('HACCP_ТочкиКонтроля_V30').appendRow(['CCP-T1', 'P1', 'H1', 'CCP', 'Температура в толще', '≥ 75', '°C', 'термощуп', 'каждая порция', 'повар', 'догреть', 'проверка шефом', 'J', 'ACTIVE', 1, '', '', new Date(), 'test']);
  ss.getSheetByName('HACCP_Мониторинг_V30').appendRow(['MON-T1', 'CCP-T1', 'Стейк', 't° в толще', '°C', 75, '', 'каждая порция', 'повар', '', 'CCP', '', true, 'ACTIVE', new Date(), 'test']);
  // ККТ назначается по процессу блюда: стейк входит в подтверждённую на площадке схему, где есть процесс P1 (MC-024)
  C._v75Append_('FLW', { FlowID: 'FLW-HOT', 'Название': 'Горячие блюда из мяса', 'Для продукции (JSON)': '["D001"]', 'Шаги (JSON)': '[{"processId":"P0"},{"processId":"P1"}]', 'Версия': 1, 'Статус': 'ACTIVE' });
  C._v75Append_('CNF', { ConfID: 'CNF-1', FlowID: 'FLW-HOT', 'Версия схемы': 1, 'Результат': 'CONFIRMED', 'Подтвердил': 'Хасапов Ким' });
  drop(); const a = J(C.mcSetTtkCcp(JSON.stringify({ code: 'D001', controlId: 'CCP-T1' }), HACCP)); assert.ok(a.success, JSON.stringify(a));
  o4 = ok(call('rsOrderOpen', WAI, { idem: key(), tableId: T[1].id, guests: 1 })).orderId;
  ok(call('rsItemAdd', WAI, { idem: key(), orderId: o4, items: [{ code: 'D001', amount: 300 }] }));
  ok(call('rsOrderSend', WAI, { idem: key(), orderId: o4, mode: 'all' }));
  tk4 = ok(call('rsKdsData', CHEF, { dept: 'KITCHEN' })).tickets.find(x => x.orderId === o4);
  tk4 = ok(call('rsTicketAct', CHEF, { idem: key(), ticketId: tk4.id, version: tk4.version, action: 'start' })).ticket;
  const card = ok(call('rsKdsData', CHEF, { dept: 'KITCHEN' })).tickets.find(x => x.id === tk4.id);
  assert.ok(card.ccp && !card.ccp.ok && card.ccp.items[0].point === 'Температура в толще' && card.ccp.items[0].status === 'MISSING' && card.ccp.items[0].thermal);
  err(call('rsTicketAct', CHEF, { idem: key(), ticketId: tk4.id, version: tk4.version, action: 'ready' }), 'CCP_REQUIRED');
});
t('замер 62 °C — вне предела, «Готово» заблокировано; повар холодного цеха тепловую ККТ не вносит; 78 °C — «Готово» проходит, склад списан', () => {
  const r1 = J(C.rsTicketCcp(JSON.stringify({ ticketId: tk4.id, controlId: 'CCP-T1', value: 62, correctiveAction: 'догреть до 75 °C' }), CHEF)); drop();
  assert.ok(r1.success || r1.ok, JSON.stringify(r1).slice(0, 300)); assert.strictEqual(r1.data.state.items[0].status, 'DEVIATION');
  err(call('rsTicketAct', CHEF, { idem: key(), ticketId: tk4.id, version: tk4.version, action: 'ready' }), 'CCP_REQUIRED');
  const r0 = J(C.rsTicketCcp(JSON.stringify({ ticketId: tk4.id, controlId: 'CCP-T1', value: 80 }), COLD)); assert.ok(!(r0.success || r0.ok), 'холодный цех — нельзя');
  drop(); const r2 = J(C.rsTicketCcp(JSON.stringify({ ticketId: tk4.id, controlId: 'CCP-T1', value: 78 }), CHEF)); assert.ok(r2.success || r2.ok); assert.ok(r2.data.state.ok);
  ok(call('rsTicketAct', CHEF, { idem: key(), ticketId: tk4.id, version: tk4.version, action: 'ready' }));
  assert.ok(rows('HACCP_Факты_V31').filter(r => String(Object.values(r)[13]) === tk4.id).length === 2, 'два факта HACCP по заданию');
});
t('бракераж: стейк зала — «продано без бракеража» сразу после «Готово»; после оплаты и закрытия заказа второй раз не считается', () => {
  drop(); let b = J(C.v77BrakData(CHEF)); assert.ok(b.success || b.ok, JSON.stringify(b).slice(0, 300));
  let it = b.data.items.find(x => x.dish === 'Стейк рибай'); assert.ok(it && it.status === 'SOLD' && it.soldToday === 1, JSON.stringify(it));
  const od = ok(call('rsOrderGet', WAI, { id: o4 }));
  ok(call('rsItemServe', WAI, { idem: key(), orderId: o4, itemIds: od.items.map(x => x.id) }));
  const st4 = ok(call('rsOrderGet', WAI, { id: o4 })).items[0]; ok(call('rsItemWeight', WAI, { idem: key(), itemId: st4.id, version: st4.version, amount: 300 }));
  ok(call('rsBillSplit', WAI, { idem: key(), orderId: o4, mode: 'one' }));
  const bl = ok(call('rsOrderGet', ADM, { id: o4 })).bills[0];
  ok(call('rsBillPay', ADM, { idem: key(), billId: bl.id, version: bl.version, method: 'CARD', receipt: '9', amountKop: bl.totalKop }));
  ok(call('rsOrderClose', WAI, { idem: key(), orderId: o4, version: ok(call('rsOrderGet', ADM, { id: o4 })).version }));
  assert.ok(rows('Продажи_Списание_V71').length >= 1, 'продажа зала проведена');
  drop(); b = J(C.v77BrakData(CHEF)); it = b.data.items.find(x => x.dish === 'Стейк рибай'); assert.strictEqual(it.soldToday, 1, 'без двойного счёта');
});

console.log(' 5) отзыв продукции: стол и время подачи');
t('отзыв партии говядины: получатель — гость зала, стол № 2, время подачи, официант; в балансе партии стейк учтён один раз (300 г)', () => {
  drop(); const bid = ss.getSheetByName('Склад_Партии').getDataRange().getValues().slice(1).filter(r => r[1] === 'Говядина рибай').map(r => String(r[0]));
  const r = J(C.v74Preview(JSON.stringify({ scope: { batchIds: bid } }), HACCP)); assert.ok(r.success || r.ok, JSON.stringify(r).slice(0, 300));
  const rec = r.data.recipients.filter(x => x.type === 'SALE'); assert.strictEqual(rec.length, 1, JSON.stringify(rec));
  assert.ok(/Гость зала: стол № 2, заказ .*подано \d{2}\.\d{2}\.\d{4} \d{2}:\d{2}.*официант Официантов Иван/.test(rec[0].to), rec[0].to);
  assert.strictEqual(rec[0].what, 'Стейк рибай'); assert.strictEqual(rec[0].qty, 300);
  const bal = r.data.balance.find(b => bid.indexOf(b.batchId) >= 0 && b.traced > 0); assert.strictEqual(bal.traced, 300); assert.ok(!bal.over);
});

console.log(' 6) график смен ↔ зал, кухня, бар');
const empId = name => { drop(); const st = C._mcRbEmpState_(), id = Object.keys(st).find(k => String(st[k].name).indexOf(name) === 0); assert.ok(id, 'нет сотрудника ' + name); return id; };
const assign = (name, date, start, end) => { drop(); const r = J(C.v98Assign(JSON.stringify({ date, employeeId: empId(name), start, end, siteId: 'SITE-MAIN', confirm: true }), DIR)); assert.ok(r.success || r.ok, JSON.stringify(r).slice(0, 300)); };
t('зал видит смену из графика: официанты, кухня, бар; «сейчас» — по часам смены; ночная смена учитывается на следующий день', () => {
  assign('Официантов', '2026-11-25', '10:00', '22:00'); assign('Шефов', '2026-11-25', '09:00', '21:00'); assign('Барменов', '2026-11-25', '12:00', '23:00');
  assign('Петров', '2026-11-25', '18:00', '02:00');
  const sh = ok(call('rsHallData', ADM, { date: '2026-11-25', time: '13:00' })).shift; assert.ok(sh && sh.has);
  const g = x => sh.list.filter(y => y.group === x).map(y => y.name.split(' ')[0] + (y.now ? '*' : ''));
  assert.deepStrictEqual(g('hall').sort(), ['Официантов*', 'Петров'].sort()); assert.deepStrictEqual(g('kitchen'), ['Шефов*']); assert.deepStrictEqual(g('bar'), ['Барменов*']);
  drop(); const night = C._rsOnShift_('SITE-MAIN', '2026-11-26', '01:00'); assert.ok(night.list.some(x => /^Петров/.test(x.name) && x.now), 'ночная смена до 02:00');
});
t('администратор закрепляет столы за официантами из графика; не из графика — отказ; стол переходит от одного официанта к другому', () => {
  ok(call('rsShiftTablesSave', ADM, { idem: key(), date: '2026-11-25', waiterId: empId('Официантов'), tables: [T[0].id, T[1].id] }));
  err(call('rsShiftTablesSave', ADM, { idem: key(), date: '2026-11-25', waiterId: empId('Холодов'), tables: [T[2].id] }), 'VALIDATION');
  err(call('rsShiftTablesSave', WAI, { idem: key(), date: '2026-11-25', waiterId: empId('Официантов'), tables: [T[2].id] }));
  const r = ok(call('rsShiftTablesSave', ADM, { idem: key(), date: '2026-11-25', waiterId: empId('Петров'), tables: [T[1].id, T[2].id] }));
  assert.deepStrictEqual(r.moved, [{ table: '2', from: 'Официантов Иван' }]);
  const a = ok(call('rsShiftTables', ADM, { date: '2026-11-25' })).assign;
  assert.strictEqual(a[T[0].id].waiter, 'Официантов Иван'); assert.ok(/^Петров/.test(a[T[1].id].waiter)); assert.ok(/^Петров/.test(a[T[2].id].waiter));
  const tb = ok(call('rsHallData', WAI2, { date: '2026-11-25', time: '13:00' })).tables.find(x => x.id === T[2].id); assert.ok(tb.assigned.mine);
});
t('открытие стола: администратор — заказ сразу на закреплённого официанта; официант на чужом столе и вне смены — с предупреждением', () => {
  const o1 = ok(call('rsOrderOpen', ADM, { idem: key(), tableId: T[0].id, guests: 2 })); assert.strictEqual(o1.waiter, 'Официантов Иван'); assert.deepStrictEqual(o1.warnings, []);
  const t8 = ok(call('rsTableSave', ADM, { idem: key(), hallId: hall.id, number: '8', x: 6, y: 4, seatsMax: 2 }));
  ok(call('rsShiftTablesSave', ADM, { idem: key(), date: '2026-11-25', waiterId: empId('Петров'), tables: [T[1].id, T[2].id, t8.id] }));
  const o2 = ok(call('rsOrderOpen', WAI, { idem: key(), tableId: t8.id, guests: 2 })); assert.ok(o2.warnings.some(w => /закреплён на сегодня за Петров/.test(w)), JSON.stringify(o2.warnings));
  const t9 = ok(call('rsTableSave', ADM, { idem: key(), hallId: hall.id, number: '9', x: 7, y: 4, seatsMax: 2 }));
  const o3 = ok(call('rsOrderOpen', WAI2, { idem: key(), tableId: t9.id, guests: 1 })); assert.ok(o3.warnings.some(w => /нет в графике смен на сейчас/.test(w)), JSON.stringify(o3.warnings));
});

console.log('\nИтого: ' + pass + ' пройдено, ' + fail + ' не пройдено');
process.exit(fail ? 1 : 0);
