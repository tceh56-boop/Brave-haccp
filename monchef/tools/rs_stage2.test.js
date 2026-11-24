// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
// Restaurant Service, этап 2: залы, столы, бронирование, предзаказ. Вызовы — через шлюз (вход по ПИН, права ролей).
// Запуск: node monchef/tools/rs_stage2.test.js
const assert = require('assert');
const { boot } = require('./gasemu');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e)); } }
const J = s => (typeof s === 'string' ? JSON.parse(s) : s);
let seq = 0; const key = () => 'test-key-' + (++seq) + '-' + Date.now().toString(36);

const E = boot({ now: '2026-11-25T08:00:00Z' });   // 13:00 по Екатеринбургу
const C = E.ctx, ss = E.ss;
const emp = ss.insertSheet('Сотрудники');
emp.appendRow(['Фамилия', 'Имя', 'Отчество', 'Должность', 'Роль', 'Дата рождения', 'Телефон', 'Адрес', 'ПИН-код', 'Сан. книжка №', 'Срок сан. книжки', 'Посл. мед. осмотр', 'Активен', 'Цвет', 'Создан']);
emp.appendRow(['Директорова', 'Анна', '', 'Директор', 'Директор', '', '', '', '1111', '', '', '', true, '', '']);
emp.appendRow(['Админов', 'Пётр', '', 'Администратор зала', 'Администратор', '', '', '', '2222', '', '', '', true, '', '']);
emp.appendRow(['Официантов', 'Иван', '', 'Официант', 'Официант', '', '', '', '3333', '', '', '', true, '', '']);
emp.appendRow(['Поваров', 'Олег', '', 'Повар', 'Повар горячего цеха', '', '', '', '4444', '', '', '', true, '', '']);
const dishes = ss.insertSheet('Блюда');
dishes.appendRow(['Код', 'Название', 'Категория', 'Выход', 'Кол-во ингр.', 'Технология', 'Файл', 'Заготовка (JSON)', 'Цех', '', '', '', 'Выход, г/мл/шт', 'Ед. выхода']);
dishes.appendRow(['D001', 'Стейк рибай', 'Горячее', '350', 3, '', '', '', 'Горячий цех', '', '', '', 350, 'г']);
dishes.appendRow(['D002', 'Сырная тарелка', 'Закуски', '250', 4, '', '', '', 'Холодный цех', '', '', '', 250, 'г']);
dishes.appendRow(['B001', 'Негрони', 'Коктейли', '120', 3, '', '', '', 'Бар', '', '', '', 120, 'мл']);

const login = pin => { const r = J(C.loginWithPin(pin, 'dev-test-' + pin)); assert.ok(r.ok, 'вход ' + pin + ': ' + JSON.stringify(r)); return r.token; };
const DIR = login('1111'), ADM = login('2222'), WAI = login('3333'), COOK = login('4444');
// каждый вызов — новое выполнение Apps Script: кэш чтения таблицы живёт одно выполнение
const call = (fn, tok, d) => { C._mcRcDrop_(); C._BOOK_CACHE_ = null; return J(C[fn](JSON.stringify(d || {}), tok)); };
const ok = r => { assert.strictEqual(r.success, true, JSON.stringify(r)); return r.data; };
const err = (r, code) => { assert.strictEqual(r.success === true || r.ok === true, false, 'ожидался отказ: ' + JSON.stringify(r)); if (code) assert.strictEqual((r.error && r.error.code) || r.code, code, JSON.stringify(r)); return r; };

console.log('Restaurant Service — этап 2');
let hall, t12, t13, t14;
t('шлюз знает функции зала (не служебные)', () => {
  assert.ok(C.MC_GATE_CLIENT_.includes('rsBookingCreate'));
  assert.strictEqual(C.MC_GATE_NEED_.rsBookingCreate, 'booking');
  assert.ok(C.MC_GATE_MUT_.includes('rsBookingCreate'));
});
t('роль «Официант» добавлена; раздел и страница «Зал»', () => {
  assert.ok(C.MC_RB_ROLES_.includes('Официант'));
  assert.strictEqual(C.MC_RB_MODULES_.hall, 'hall_view|booking|hall_manage');
  assert.ok(C.UI_SECTIONS.includes('hall'));
});
t('официант не настраивает зал (FORBIDDEN)', () => { err(call('rsHallSave', WAI, { idem: key(), name: 'Основной' })); });
t('повар не видит зал', () => { err(call('rsHallData', COOK, {})); });
t('администратор создаёт зал и столы 12, 13, 14 (13 и 14 объединяются)', () => {
  hall = ok(call('rsHallSave', ADM, { idem: key(), name: 'Основной зал', width: 10, height: 6 }));
  t12 = ok(call('rsTableSave', ADM, { idem: key(), hallId: hall.id, number: '12', seatsMin: 2, seatsMax: 4, x: 1, y: 1 }));
  t13 = ok(call('rsTableSave', ADM, { idem: key(), hallId: hall.id, number: '13', seatsMax: 4, x: 3, y: 1 }));
  t14 = ok(call('rsTableSave', ADM, { idem: key(), hallId: hall.id, number: '14', seatsMax: 4, x: 5, y: 1, combine: [t13.id] }));
  const d = ok(call('rsHallData', ADM, { date: '2026-11-25', time: '13:00' }));
  assert.strictEqual(d.tables.length, 3);
  assert.deepStrictEqual(d.tables.find(x => x.id === t13.id).combine, [t14.id], 'объединение взаимное');
});
t('номер стола в зале уникален; стол вне сетки — отказ', () => {
  err(call('rsTableSave', ADM, { idem: key(), hallId: hall.id, number: '12', seatsMax: 2, x: 0, y: 0 }), 'VALIDATION');
  err(call('rsTableSave', ADM, { idem: key(), hallId: hall.id, number: '99', seatsMax: 2, x: 10, y: 0 }), 'VALIDATION');
});

let bk;
t('сценарий 5: бронь стола 12 на 19:00 на 2 часа с предзаказом', () => {
  const r = ok(call('rsBookingCreate', ADM, { idem: key(), tables: [t12.id], guest: 'Смирнов', phone: '+7 900 123-45-67', date: '2026-11-25', start: '19:00', duration: 120, guests: 4,
    status: 'CONFIRMED', preorder: { items: [{ code: 'D001', qty: 2, unit: 'порц', amount: 350, course: 3 }, { code: 'B001', qty: 4, unit: 'шт', course: 1 }] } }));
  bk = r.booking;
  assert.strictEqual(bk.end, '21:00'); assert.strictEqual(r.preorder.status, 'DRAFT'); assert.strictEqual(r.preorder.items.length, 2);
  assert.strictEqual(r.preorder.items[1].dept, 'BAR');
});
t('сценарий 5: другой сотрудник — тот же стол на 20:30 — отказ CONFLICT', () => {
  const r = err(call('rsBookingCreate', DIR, { idem: key(), tables: [t12.id], guest: 'Иванов', date: '2026-11-25', start: '20:30', duration: 60, guests: 2 }), 'CONFLICT');
  assert.ok(/уже забронирован/.test(r.error.message));
});
t('стык интервалов (21:00) — разрешён', () => {
  ok(call('rsBookingCreate', DIR, { idem: key(), tables: [t12.id], guest: 'Петров', date: '2026-11-25', start: '21:00', duration: 60, guests: 2 }));
});
t('вместимость: 6 гостей за стол на 4 — отказ; столы 13+14 — можно; 12+13 не объединяются', () => {
  err(call('rsBookingCreate', ADM, { idem: key(), tables: [t13.id], guest: 'А', date: '2026-11-26', start: '12:00', duration: 90, guests: 6 }), 'VALIDATION');
  ok(call('rsBookingCreate', ADM, { idem: key(), tables: [t13.id, t14.id], guest: 'Б', date: '2026-11-26', start: '12:00', duration: 90, guests: 6 }));
  err(call('rsBookingCreate', ADM, { idem: key(), tables: [t12.id, t13.id], guest: 'В', date: '2026-11-27', start: '12:00', duration: 90, guests: 6 }), 'VALIDATION');
});
t('прошедшее время — отказ', () => {
  err(call('rsBookingCreate', ADM, { idem: key(), tables: [t13.id], guest: 'Г', date: '2026-11-25', start: '10:00', duration: 60, guests: 2 }), 'VALIDATION');
});
t('сценарий 9: повтор с тем же ключом — тот же ответ, вторая бронь не создаётся', () => {
  const k = key(), d = { idem: k, tables: [t13.id], guest: 'Повтор', date: '2026-11-28', start: '18:00', duration: 60, guests: 2 };
  const a = ok(call('rsBookingCreate', ADM, d));
  // защита шлюза от двойного нажатия (кэш 15 с) срабатывает только на подряд идущий вызов — другое действие между ними
  // моделирует обрыв связи и повтор позже: повтор доходит до функции, и её ключ операции возвращает прежний ответ
  err(call('rsHallSave', ADM, { idem: key(), name: '' }), 'VALIDATION');
  const b = ok(call('rsBookingCreate', ADM, d));
  assert.strictEqual(a.booking.id, b.booking.id);
  const n = ss.getSheetByName('Бронирования_V1').getDataRange().getValues().filter(r => r[4] === 'Повтор').length;
  assert.strictEqual(n, 1);
});
t('тот же ключ другим действием — отказ', () => {
  const k = key();
  ok(call('rsBookingCreate', ADM, { idem: k, tables: [t13.id], guest: 'Ключ', date: '2026-11-29', start: '18:00', duration: 60, guests: 2 }));
  err(call('rsPreorderSave', ADM, { idem: k, bookingId: bk.id, items: [] }));
});
t('без ключа операции запись не принимается', () => {
  err(call('rsBookingCreate', ADM, { tables: [t13.id], guest: 'Без ключа', date: '2026-11-30', start: '18:00', duration: 60, guests: 2 }), 'VALIDATION');
});
t('оптимистичная блокировка: изменение по устаревшей версии — CONFLICT', () => {
  const v = bk.version;
  ok(call('rsBookingUpdate', ADM, { idem: key(), id: bk.id, version: v, comment: 'у окна' }));
  err(call('rsBookingUpdate', DIR, { idem: key(), id: bk.id, version: v, guests: 3 }), 'CONFLICT');
});
t('перенос брони на занятое время — CONFLICT; на свободное — ок', () => {
  const cur = ok(call('rsBookingList', ADM, { from: '2026-11-25' })).bookings.find(x => x.id === bk.id);
  err(call('rsBookingUpdate', ADM, { idem: key(), id: bk.id, version: cur.version, start: '20:00' }), 'CONFLICT');
  const r = ok(call('rsBookingUpdate', ADM, { idem: key(), id: bk.id, version: cur.version, start: '18:30', duration: 150 }));
  assert.strictEqual(r.booking.end, '21:00');
});
t('официант видит брони, телефон скрыт; создать бронь не может', () => {
  const l = ok(call('rsBookingList', WAI, { from: '2026-11-25' }));
  const b = l.bookings.find(x => x.id === bk.id);
  assert.strictEqual(b.phone, '•••67');
  err(call('rsBookingCreate', WAI, { idem: key(), tables: [t13.id], guest: 'Д', date: '2026-11-30', start: '18:00', duration: 60, guests: 2 }));
});
t('предзаказ: подтвердить; неизвестное блюдо и дробные порции — отказ', () => {
  const l = ok(call('rsBookingList', ADM, { from: '2026-11-25' })).bookings.find(x => x.id === bk.id);
  err(call('rsPreorderSave', ADM, { idem: key(), bookingId: bk.id, version: l.preorder.version, items: [{ code: 'NOPE', qty: 1 }] }), 'VALIDATION');
  err(call('rsPreorderSave', ADM, { idem: key(), bookingId: bk.id, version: l.preorder.version, items: [{ code: 'D001', qty: 1.5, unit: 'порц' }] }), 'VALIDATION');
  const r = ok(call('rsPreorderSave', ADM, { idem: key(), bookingId: bk.id, version: l.preorder.version, confirm: true,
    items: [{ code: 'D001', qty: 2, unit: 'порц', amount: 350, course: 3 }, { code: 'D002', qty: 1, course: 1 }, { code: 'B001', qty: 4, unit: 'шт' }] }));
  assert.strictEqual(r.preorder.status, 'CONFIRMED');
});
t('предзаказ не продажа: склад, журнал продаж и списания не тронуты', () => {
  ['Склад_Операции', 'Продажи_Списание_V71', 'Ж_Продажи'].forEach(n => { const sh = ss.getSheetByName(n); assert.ok(!sh || sh.getLastRow() <= 1, n + ' изменён'); });
});
t('прогноз потребности: блюда подтверждённого предзаказа по подразделениям', () => {
  const f = ok(call('rsPreorderForecast', ADM, { from: '2026-11-25', to: '2026-11-26' }));
  assert.strictEqual(f.bookings, 1);
  const steak = f.rows.find(r => r.code === 'D001'), neg = f.rows.find(r => r.code === 'B001');
  assert.strictEqual(steak.qty, 2); assert.strictEqual(steak.dept, 'KITCHEN'); assert.strictEqual(neg.dept, 'BAR');
});
t('статусы: CONFIRMED → CLOSED нельзя; «не пришёл» до начала — нельзя; отмена без причины — нельзя', () => {
  const v = () => ok(call('rsBookingList', ADM, { from: '2026-11-25' })).bookings.find(x => x.id === bk.id).version;
  err(call('rsBookingStatus', ADM, { idem: key(), id: bk.id, version: v(), status: 'CLOSED' }), 'VALIDATION');
  err(call('rsBookingStatus', ADM, { idem: key(), id: bk.id, version: v(), status: 'NO_SHOW', reason: 'нет' }), 'VALIDATION');
  err(call('rsBookingStatus', ADM, { idem: key(), id: bk.id, version: v(), status: 'CANCELLED' }), 'VALIDATION');
});
t('гость пришёл → стол занят: схема зала показывает «гости за столом»', () => {
  const v = () => ok(call('rsBookingList', ADM, { from: '2026-11-25' })).bookings.find(x => x.id === bk.id).version;
  ok(call('rsBookingStatus', ADM, { idem: key(), id: bk.id, version: v(), status: 'ARRIVED' }));
  ok(call('rsBookingStatus', ADM, { idem: key(), id: bk.id, version: v(), status: 'SEATED' }));
  const d = ok(call('rsHallData', WAI, { date: '2026-11-25', time: '19:00' }));
  assert.strictEqual(d.tables.find(x => x.id === t12.id).state, 'seated');
  assert.strictEqual(d.tables.find(x => x.id === t13.id).state, 'free');
});
t('лист ожидания без стола; при подтверждении — проверка стола', () => {
  const w = ok(call('rsBookingCreate', ADM, { idem: key(), guest: 'Ждущий', date: '2026-11-25', start: '19:30', duration: 60, guests: 2, status: 'WAITING' })).booking;
  err(call('rsBookingStatus', ADM, { idem: key(), id: w.id, version: w.version, status: 'CONFIRMED' }), 'VALIDATION');
  const w2 = ok(call('rsBookingUpdate', ADM, { idem: key(), id: w.id, version: w.version, tables: [t12.id] })).booking;
  err(call('rsBookingStatus', ADM, { idem: key(), id: w.id, version: w2.version, status: 'CONFIRMED' }), 'CONFLICT');
});
t('отмена брони отменяет предзаказ; история событий сохранена', () => {
  const b = ok(call('rsBookingCreate', ADM, { idem: key(), tables: [t13.id], guest: 'Отмена', date: '2026-11-27', start: '14:00', duration: 60, guests: 2,
    preorder: { items: [{ code: 'D002', qty: 1 }] } })).booking;
  ok(call('rsBookingStatus', ADM, { idem: key(), id: b.id, version: b.version, status: 'CANCELLED', reason: 'гость перенёс' }));
  const l = ok(call('rsBookingList', ADM, { from: '2026-11-27' })).bookings.find(x => x.id === b.id);
  assert.strictEqual(l.status, 'CANCELLED'); assert.strictEqual(l.preorder.status, 'CANCELLED');
  const h = ok(call('rsBookingHistory', ADM, { id: b.id }));
  assert.deepStrictEqual(h.map(x => x.event), ['BOOKING_CREATED', 'BOOKING_CANCELLED']);
});
t('зал с предстоящими бронями в архив не уходит', () => {
  const d = ok(call('rsHallData', ADM, {}));
  err(call('rsHallSave', ADM, { idem: key(), id: hall.id, version: d.halls[0].version, name: hall.name, status: 'ARCHIVED' }), 'VALIDATION');
});
t('восстановление: транзакция PENDING доводится по плану, без дублей', () => {
  const tx = ss.getSheetByName('ЖурналТранзакций_RS');
  const row = { BookingID: 'BK-TEST-RECOVER', SiteID: 'SITE-MAIN', HallID: hall.id, 'Столы': JSON.stringify([t13.id]), 'Гость': 'Сбой', 'Дата': '2026-12-01', 'Начало': '18:00',
    'Длительность, мин': 60, 'Окончание': '19:00', 'Гостей': 2, 'Статус': 'NEW', Version: 1 };
  tx.appendRow(['TX-TEST', '', 'RS_BOOKING_CREATE', JSON.stringify([{ sheet: 'Бронирования_V1', row }]), 1, 0, 'PENDING', '', new Date('2026-11-25T07:00:00Z'), '']);
  const r1 = ok(call('rsTxRecover', ADM, {})); assert.deepStrictEqual(r1.recovered, ['TX-TEST']);
  const r2 = ok(call('rsTxRecover', ADM, { again: 1 })); assert.deepStrictEqual(r2.recovered, []);
  const n = ss.getSheetByName('Бронирования_V1').getDataRange().getValues().filter(r => r[0] === 'BK-TEST-RECOVER').length;
  assert.strictEqual(n, 1);
});
t('каждая запись — в аудите и в журнале транзакций (COMMITTED)', () => {
  const a = ss.getSheetByName('Audit_Log').getDataRange().getValues().map(r => r[7]);
  assert.ok(a.includes('RS_BOOKING_CREATED')); assert.ok(a.includes('RS_TABLE_CREATED'));
  const st = ss.getSheetByName('ЖурналТранзакций_RS').getDataRange().getValues().slice(1).map(r => r[6]);
  assert.ok(st.every(s => s === 'COMMITTED' || s === 'RECOVERED'), st.join(','));
});
t('адрес ?hall=1: администратору — главное окно сразу на экране «Зал и бронирование», повару — нет доступа', () => {
  const p = C.doGet({ parameter: { hall: '1', token: ADM } });
  assert.strictEqual(p.getTitle(), 'MON CHEF'); assert.ok(/OPENV="hall"/.test(p.getContent()), 'главное окно откроется на экране зала');
  const q = C.doGet({ parameter: { hall: '1', token: COOK } });
  assert.ok(/403|нет доступа|НЕДОСТАТОЧНО/i.test(q.getContent()) && !/id="app"/.test(q.getContent()), 'повару — страница «нет доступа»');
});

console.log(`\nИтого: ${pass} пройдено, ${fail} не пройдено`);
process.exit(fail ? 1 : 0);
