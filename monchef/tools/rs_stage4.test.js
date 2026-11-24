// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
// Restaurant Service, этап 4: экран кухни и бара, статусы, «Готово» → официант, «Подано», Stop/Go, отмена с расходом.
// Сценарии ТЗ §16: 1 (кухня видит стол), 6 (Stop/Go), 7 (бар отдельно), 8 (отмена после начала). Запуск: node monchef/tools/rs_stage4.test.js
const assert = require('assert');
const { boot } = require('./gasemu');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e)); } }
const J = s => (typeof s === 'string' ? JSON.parse(s) : s);
let seq = 0; const key = () => 'st4-key-' + (++seq);

const E = boot({ now: '2026-11-25T08:00:00Z' }), C = E.ctx, ss = E.ss;
const emp = ss.insertSheet('Сотрудники');
emp.appendRow(['Фамилия', 'Имя', 'Отчество', 'Должность', 'Роль', 'ДР', 'Телефон', 'Адрес', 'ПИН-код', '', '', '', 'Активен']);
[['Директорова', 'Анна', 'Директор', '1111'], ['Админов', 'Пётр', 'Администратор', '2222'], ['Официантов', 'Иван', 'Официант', '3333'], ['Горячев', 'Олег', 'Повар горячего цеха', '4444'],
 ['Холодова', 'Нина', 'Повар холодного цеха', '5555'], ['Шефов', 'Марк', 'Шеф-повар', '7777']].forEach(r => emp.appendRow([r[0], r[1], '', r[2], r[2], '', '', '', r[3], '', '', '', true]));
const ds = ss.insertSheet('Блюда');
ds.appendRow(['Код', 'Название', 'Категория', 'Выход', '', '', '', '', 'Цех', '', '', '', 'Выход, г/мл/шт', 'Ед. выхода']);
[['D001', 'Стейк рибай', 'Горячее', 'Горячий цех'], ['D002', 'Сырная тарелка', 'Закуски', 'Холодный цех'], ['D005', 'Борщ', 'Супы', 'Горячий цех'], ['D006', 'Тартар', 'Закуски', 'Мясной цех'],
 ['B001', 'Негрони', 'Коктейли', 'Бар'], ['B002', 'Капучино', 'Кофе', 'Бар']].forEach(r => ds.appendRow([r[0], r[1], r[2], '', '', '', '', '', r[3], '', '', '', 300, 'г']));
const pr = ss.insertSheet('Цены_Меню'); pr.appendRow(['PriceID', 'DishCode', 'DishName', 'Price', 'Unit', 'Source', 'EventID', 'DateFrom', 'DateTo', 'Status']);
['D001', 'D002', 'D005', 'D006', 'B001', 'B002'].forEach((c, i) => pr.appendRow(['P' + i, c, '', 500 + i * 100, 'порц.', 'MENU', '', '2026-11-01', '', 'ACTIVE']));
const tv = ss.insertSheet('ТТК_Версии'); tv.appendRow(['Код блюда', 'Версия', 'Статус']); ['D001', 'D002', 'D005', 'D006', 'B001', 'B002'].forEach(c => tv.appendRow([c, 1, 'действующая']));

const login = pin => J(C.loginWithPin(pin, 'dev-' + pin)).token;
const DIR = login('1111'), ADM = login('2222'), WAI = login('3333'), HOT = login('4444'), COLD = login('5555'), CHEF = login('7777');
const call = (fn, tok, d) => { C._mcRcDrop_(); C._BOOK_CACHE_ = null; C._MC_ADM_CACHE = null; return J(C[fn](JSON.stringify(d || {}), tok)); };
const ok = r => { assert.strictEqual(r.success, true, JSON.stringify(r)); return r.data; };
const err = (r, code) => { assert.notStrictEqual(r.success, true, 'ожидался отказ: ' + JSON.stringify(r).slice(0, 300)); if (code) assert.strictEqual(r.error && r.error.code, code, JSON.stringify(r)); return r; };
const hall = ok(call('rsHallSave', ADM, { idem: key(), name: 'Зал', width: 8, height: 5 }));
const T = {}; ['10', '12', '14', '16'].forEach((n, i) => { T[n] = ok(call('rsTableSave', ADM, { idem: key(), hallId: hall.id, number: n, seatsMax: 6, x: i * 2, y: 1 })); });
const kds = (tok, dept) => ok(call('rsKdsData', tok, { dept: dept || 'KITCHEN' }));
const tkOf = (tok, name, dept) => kds(tok, dept).tickets.find(x => x.name === name && ['CANCELLED', 'ISSUED'].indexOf(x.status) < 0);
const item = (o, name) => ok(call('rsOrderGet', WAI, { id: o })).items.find(x => x.name === name && x.status !== 'CANCELLED');

console.log('Restaurant Service — этап 4');
let o12;
t('медицинский допуск: повар без действующей медкнижки заданием не управляет', () => {
  o12 = ok(call('rsOrderOpen', WAI, { idem: key(), tableId: T['12'].id, guests: 2 })).orderId;
  ok(call('rsItemAdd', WAI, { idem: key(), orderId: o12, items: [{ code: 'D001' }, { code: 'D002', course: 1 }, { code: 'D005', course: 2 }, { code: 'B001', qty: 2 }, { code: 'B002' }] }));
  ok(call('rsOrderSend', WAI, { idem: key(), orderId: o12, mode: 'all' }));
  const tk = tkOf(HOT, 'Стейк рибай');
  const r = err(call('rsTicketAct', HOT, { idem: key(), ticketId: tk.id, version: tk.version, action: 'accept' }));
  assert.ok(/допуск/i.test(r.error.message), r.error.message);
  E.props[C.MC_MED_GATE_PROP_] = 'off';   // дальше — проверка остального без медицинского допуска
});
t('сценарий 1: кухня видит стол; горячий цех не видит холодный; бар — отдельно', () => {
  const hot = kds(HOT).tickets.map(x => x.name).sort();
  assert.deepStrictEqual(hot, ['Борщ', 'Стейк рибай']); assert.ok(kds(HOT).tickets.every(x => x.table === '12'));
  assert.deepStrictEqual(kds(COLD).tickets.map(x => x.name), ['Сырная тарелка']);
  assert.strictEqual(kds(CHEF).tickets.length, 3, 'шеф видит все цеха кухни');
  assert.strictEqual(kds(HOT, 'BAR').tickets.length, 0, 'повар не видит бар');
  assert.deepStrictEqual(kds(DIR, 'BAR').tickets.map(x => x.name).sort(), ['Капучино', 'Негрони']);
  assert.strictEqual(kds(HOT).tickets.find(x => x.name === 'Борщ').status, 'WAIT_COURSE');
  const cold = tkOf(COLD, 'Сырная тарелка');
  err(call('rsTicketAct', HOT, { idem: key(), ticketId: cold.id, version: cold.version, action: 'accept' }), 'FORBIDDEN');
});
t('статусы: новый → принят → готовится → готово (официант видит, уведомление) → выдано → подано', () => {
  let tk = tkOf(HOT, 'Стейк рибай');
  ok(call('rsTicketAct', HOT, { idem: key(), ticketId: tk.id, version: tk.version, action: 'accept' }));
  assert.strictEqual(item(o12, 'Стейк рибай').status, 'COOKING');
  tk = tkOf(HOT, 'Стейк рибай'); ok(call('rsTicketAct', HOT, { idem: key(), ticketId: tk.id, version: tk.version, action: 'start' }));
  tk = tkOf(HOT, 'Стейк рибай'); err(call('rsTicketAct', HOT, { idem: key(), ticketId: tk.id, version: tk.version, action: 'issue' }), 'VALIDATION');
  ok(call('rsTicketAct', HOT, { idem: key(), ticketId: tk.id, version: tk.version, action: 'ready' }));
  assert.strictEqual(item(o12, 'Стейк рибай').status, 'READY');
  const plan = ok(call('rsHallData', WAI, {})).tables.find(x => x.id === T['12'].id); assert.strictEqual(plan.order.ready, 1);
  const n = ss.getSheetByName('Уведомления').getDataRange().getValues(); assert.ok(n.some(r => /Готово: стол № 12/.test(r[4]) && r[6] === 'Официант'));
  tk = tkOf(HOT, 'Стейк рибай'); ok(call('rsTicketAct', HOT, { idem: key(), ticketId: tk.id, version: tk.version, action: 'issue', result: 'отдано на раздаче' }));
  assert.strictEqual(item(o12, 'Стейк рибай').status, 'READY', 'выдано кухней — ещё не подано гостю');
  ok(call('rsItemServe', WAI, { idem: key(), orderId: o12, itemIds: [item(o12, 'Стейк рибай').id] }));
  const st = ok(call('rsOrderGet', WAI, { id: o12 })).items.find(x => x.name === 'Стейк рибай');
  assert.strictEqual(st.status, 'SERVED'); assert.ok(st.servedAt); assert.ok(st.readyAt);
});
t('нельзя готовить курс, который официант не запустил; подать неготовое — нельзя', () => {
  const tk = tkOf(HOT, 'Борщ');
  err(call('rsTicketAct', HOT, { idem: key(), ticketId: tk.id, version: tk.version, action: 'start' }), 'VALIDATION');
  err(call('rsItemServe', WAI, { idem: key(), orderId: o12, itemIds: [item(o12, 'Борщ').id] }), 'VALIDATION');
});
t('сценарий 7: бар готовит напитки независимо от кухни; «Подано» — задание бара выдано', () => {
  let tk = tkOf(DIR, 'Негрони', 'BAR');
  ok(call('rsTicketAct', DIR, { idem: key(), ticketId: tk.id, version: tk.version, action: 'start' }));
  tk = tkOf(DIR, 'Негрони', 'BAR'); ok(call('rsTicketAct', DIR, { idem: key(), ticketId: tk.id, version: tk.version, action: 'ready' }));
  ok(call('rsItemServe', WAI, { idem: key(), orderId: o12, itemIds: [item(o12, 'Негрони').id] }));
  assert.strictEqual(kds(DIR, 'BAR').tickets.find(x => x.name === 'Негрони').status, 'ISSUED');
});
t('проблема: официант видит описание; «решено» — снова в работе', () => {
  let tk = tkOf(COLD, 'Сырная тарелка');
  err(call('rsTicketAct', COLD, { idem: key(), ticketId: tk.id, version: tk.version, action: 'problem' }), 'VALIDATION');
  ok(call('rsTicketAct', COLD, { idem: key(), ticketId: tk.id, version: tk.version, action: 'problem', reason: 'нет пармезана, есть грана падано' }));
  const it = item(o12, 'Сырная тарелка'); assert.strictEqual(it.status, 'PROBLEM'); assert.ok(/грана/.test(it.problem));
  tk = tkOf(COLD, 'Сырная тарелка'); ok(call('rsTicketAct', COLD, { idem: key(), ticketId: tk.id, version: tk.version, action: 'resolve', reason: 'гость согласен на грана падано' }));
  assert.strictEqual(item(o12, 'Сырная тарелка').status, 'COOKING');
});
t('сценарий 8: отмена после начала — только с расходом; история и основание сохранены, расхода без начала нет', () => {
  const o = ok(call('rsOrderOpen', WAI, { idem: key(), tableId: T['10'].id, guests: 2 })).orderId;
  ok(call('rsItemAdd', WAI, { idem: key(), orderId: o, items: [{ code: 'D001' }, { code: 'D005' }] }));
  ok(call('rsOrderSend', WAI, { idem: key(), orderId: o, mode: 'all' }));
  const kt = kds(HOT).tickets.filter(x => x.orderId === o);
  let steak = kt.find(x => x.name === 'Стейк рибай');
  ok(call('rsTicketAct', HOT, { idem: key(), ticketId: steak.id, version: steak.version, action: 'start' }));
  // официант не отменяет начатое сам — запрос кухне
  const it = ok(call('rsOrderGet', WAI, { id: o })).items.find(x => x.name === 'Стейк рибай');
  err(call('rsItemCancel', WAI, { idem: key(), itemId: it.id, version: it.version }), 'VALIDATION');
  const rq = ok(call('rsItemCancel', WAI, { idem: key(), itemId: it.id, version: it.version, reason: 'гость ушёл' }));
  assert.strictEqual(rq.requested, true);
  steak = kds(HOT).tickets.find(x => x.id === steak.id); assert.ok(/гость ушёл/.test(steak.cancelRequest));
  err(call('rsTicketCancel', HOT, { idem: key(), ticketId: steak.id, version: steak.version, reason: 'гость ушёл', consumption: 'NONE' }), 'VALIDATION');
  err(call('rsTicketCancel', HOT, { idem: key(), ticketId: steak.id, version: steak.version, reason: 'гость ушёл', consumption: 'PARTIAL' }), 'VALIDATION');
  const c = ok(call('rsTicketCancel', HOT, { idem: key(), ticketId: steak.id, version: steak.version, reason: 'гость ушёл', consumption: 'FULL' })).consumption;
  assert.strictEqual(c.mode, 'FULL'); assert.strictEqual(c.started, true); assert.strictEqual(c.posted, false);
  const after = ok(call('rsOrderGet', WAI, { id: o })).items.find(x => x.name === 'Стейк рибай');
  assert.strictEqual(after.status, 'CANCELLED'); assert.strictEqual(after.consumption.mode, 'FULL'); assert.strictEqual(after.cancelReason, 'гость ушёл');
  // не начатый борщ — отмена кухней без расхода
  const b = kds(HOT).tickets.find(x => x.orderId === o && x.name === 'Борщ');
  ok(call('rsTicketCancel', HOT, { idem: key(), ticketId: b.id, version: b.version, reason: 'ошибка официанта', consumption: 'NONE' }));
  const ev = ss.getSheetByName('СобытияОбслуживания_V1').getDataRange().getValues().filter(r => r[5] === o).map(r => r[6]);
  ['ITEM_CANCEL_REQUESTED', 'TICKET_COOKING', 'TICKET_CANCELLED'].forEach(e => assert.ok(ev.includes(e), e));
  ['Склад_Операции', 'Продажи_Списание_V71'].forEach(nm => { const sh = ss.getSheetByName(nm); assert.ok(!sh || sh.getLastRow() <= 1, nm); });
});
let o14, oLim;
t('сценарий 6: STOP — официант не может добавить и отправить; принятые не удаляются; GO — снова доступно', () => {
  o14 = ok(call('rsOrderOpen', WAI, { idem: key(), tableId: T['14'].id, guests: 2 })).orderId;
  ok(call('rsItemAdd', WAI, { idem: key(), orderId: o14, items: [{ code: 'D002', guest: 1 }] }));
  ok(call('rsOrderSend', WAI, { idem: key(), orderId: o14, mode: 'all' }));
  ok(call('rsItemAdd', WAI, { idem: key(), orderId: o14, items: [{ code: 'D002', guest: 2 }] }));       // добавлена до STOP, не отправлена
  err(call('rsStopSet', WAI, { idem: key(), code: 'D002', dept: 'KITCHEN', status: 'STOP', reason: 'Закончилось сырьё' }));
  err(call('rsStopSet', COLD, { idem: key(), code: 'D002', dept: 'KITCHEN', status: 'STOP', reason: 'кончилось' }), 'VALIDATION');
  const r = ok(call('rsStopSet', COLD, { idem: key(), code: 'D002', dept: 'KITCHEN', status: 'STOP', reason: 'Закончилось сырьё', comment: 'нет пармезана', affected: 'KEEP' }));
  assert.ok(r.affected >= 1);
  err(call('rsItemAdd', WAI, { idem: key(), orderId: o14, items: [{ code: 'D002' }] }), 'VALIDATION');
  const s1 = err(call('rsOrderSend', WAI, { idem: key(), orderId: o14, mode: 'all' }), 'VALIDATION'); assert.ok(/STOP/.test(s1.error.message));
  assert.strictEqual(kds(COLD).tickets.filter(x => x.orderId === o14 && x.name === 'Сырная тарелка').length, 1, 'принятый заказ остался у кухни');
  assert.ok(ss.getSheetByName('Уведомления').getDataRange().getValues().some(r => /STOP: Сырная тарелка/.test(r[4])), 'зал уведомлён');
  assert.ok(ok(call('rsStopList', WAI, {})).current.some(x => x.code === 'D002'), 'официант видит STOP');
  err(call('rsStopGo', COLD, { idem: key(), code: 'D002', dept: 'KITCHEN', reason: 'поставка' }), 'VALIDATION');   // без подтверждения
  ok(call('rsStopGo', COLD, { idem: key(), code: 'D002', dept: 'KITCHEN', reason: 'поставка принята', confirm: true }));
  ok(call('rsOrderSend', WAI, { idem: key(), orderId: o14, mode: 'all' }));
  ok(call('rsItemAdd', WAI, { idem: key(), orderId: o14, items: [{ code: 'D002' }] }));
  const h = ok(call('rsStopList', DIR, { dept: 'KITCHEN' })).history.map(x => x.status); assert.ok(h.includes('STOP') && h.includes('GO'));
});
t('кухня и бар независимы: STOP бара не блокирует кухню и наоборот', () => {
  ok(call('rsStopSet', DIR, { idem: key(), code: 'B002', dept: 'BAR', status: 'STOP', reason: 'Неисправность оборудования', comment: 'кофемашина' }));
  err(call('rsItemAdd', WAI, { idem: key(), orderId: o14, items: [{ code: 'B002' }] }), 'VALIDATION');
  err(call('rsStopSet', CHEF, { idem: key(), code: 'B002', dept: 'BAR', status: 'GO', reason: 'Временное ограничение' }));   // у шефа нет Stop/Go бара
  ok(call('rsItemAdd', WAI, { idem: key(), orderId: o14, items: [{ code: 'D005' }] }));
  const cur = ok(call('rsStopList', DIR, {})).current; assert.deepStrictEqual(cur.map(x => x.code + '|' + x.dept), ['B002|BAR']);
});
t('LIMITED: остаток уменьшается при отправке; закончился — STOP «лимит исчерпан»', () => {
  ok(call('rsStopSet', HOT, { idem: key(), code: 'D005', dept: 'KITCHEN', status: 'LIMITED', left: 3, reason: 'Закончилась заготовка' }));
  const o = oLim = ok(call('rsOrderOpen', WAI, { idem: key(), tableId: T['16'].id, guests: 4 })).orderId;
  err(call('rsItemAdd', WAI, { idem: key(), orderId: o, items: [{ code: 'D005', qty: 4 }] }), 'VALIDATION');
  ok(call('rsItemAdd', WAI, { idem: key(), orderId: o, items: [{ code: 'D005', qty: 2 }] }));
  ok(call('rsOrderSend', WAI, { idem: key(), orderId: o, mode: 'all' }));
  let c = ok(call('rsStopList', DIR, {})).current.find(x => x.code === 'D005'); assert.strictEqual(c.status, 'LIMITED'); assert.strictEqual(c.left, 1);
  // в o14 уже лежит борщ (1 шт., не отправлен) — его отправка доедает лимит
  ok(call('rsOrderSend', WAI, { idem: key(), orderId: o14, mode: 'all' }));
  c = ok(call('rsStopList', DIR, {})).current.find(x => x.code === 'D005'); assert.strictEqual(c.status, 'STOP'); assert.strictEqual(c.comment, 'лимит исчерпан');
  err(call('rsItemAdd', WAI, { idem: key(), orderId: o, items: [{ code: 'D005' }] }), 'VALIDATION');
});
t('STOP «не выполним»: принятые не начатые — «проблема», официант меняет блюдо; решение — в истории', () => {
  ok(call('rsStopGo', HOT, { idem: key(), code: 'D005', dept: 'KITCHEN', reason: 'сварили ещё', confirm: true }));
  ok(call('rsItemAdd', WAI, { idem: key(), orderId: oLim, items: [{ code: 'D005', guest: 3 }] }));
  ok(call('rsOrderSend', WAI, { idem: key(), orderId: oLim, mode: 'all' }));
  const r = ok(call('rsStopSet', HOT, { idem: key(), code: 'D005', dept: 'KITCHEN', status: 'STOP', reason: 'Проблема качества', comment: 'пересол', affected: 'PROBLEM' }));
  assert.ok(r.needReplace.some(x => x.table === '16'), JSON.stringify(r.needReplace));
  const it = ok(call('rsOrderGet', WAI, { id: oLim })).items.find(x => x.name === 'Борщ' && x.status === 'PROBLEM' && x.guest === 3);
  assert.ok(it, 'позиция — «проблема»'); assert.ok(/нужна замена/.test(it.problem));
  err(call('rsItemReplace', WAI, { idem: key(), itemId: it.id, version: it.version, code: 'D005', reason: 'то же' }), 'VALIDATION');   // замена тоже на STOP
  const rep = ok(call('rsItemReplace', WAI, { idem: key(), itemId: it.id, version: it.version, code: 'D002', reason: 'гость выбрал сырную тарелку' })).item;
  assert.strictEqual(rep.status, 'DRAFT'); assert.strictEqual(rep.replaces, it.id); assert.strictEqual(rep.guest, 3);
  const old = ok(call('rsOrderGet', WAI, { id: oLim })).items.find(x => x.id === it.id);
  assert.strictEqual(old.status, 'CANCELLED'); assert.strictEqual(old.consumption.mode, 'NONE');
  assert.ok(ss.getSheetByName('СобытияОбслуживания_V1').getDataRange().getValues().some(e => e[6] === 'ITEM_REPLACED' && /сырную/.test(e[8])));
  ok(call('rsStopGo', HOT, { idem: key(), code: 'D005', dept: 'KITCHEN', reason: 'новая партия', confirm: true }));
});
t('REVIEW: снимает только ответственный (шеф), повар — нет', () => {
  ok(call('rsStopSet', HOT, { idem: key(), code: 'D001', dept: 'KITCHEN', status: 'REVIEW', reason: 'Проблема качества', comment: 'проверить мясо' }));
  err(call('rsItemAdd', WAI, { idem: key(), orderId: o14, items: [{ code: 'D001' }] }));
  err(call('rsStopGo', HOT, { idem: key(), code: 'D001', dept: 'KITCHEN', reason: 'нормально', confirm: true }), 'FORBIDDEN');
  ok(call('rsStopGo', CHEF, { idem: key(), code: 'D001', dept: 'KITCHEN', reason: 'мясо проверено', confirm: true }));
});
t('гостевое меню: STOP виден сразу («сейчас нет»)', () => {
  assert.ok(ok(call('rsStopList', DIR, {})).current.some(x => x.code === 'B002'));
  const idx = C._rsStopIdx_(); assert.strictEqual(C._rsStopOf_(idx, 'B002', 'BAR').status, 'STOP'); assert.strictEqual(C._rsStopOf_(idx, 'B002', 'KITCHEN').status, 'GO');
});
t('мясной цех: задание видно только тому, кому директор выдал «shop_meat»', () => {
  ok(call('rsItemAdd', WAI, { idem: key(), orderId: o12, items: [{ code: 'D006' }] }));
  ok(call('rsOrderSend', WAI, { idem: key(), orderId: o12, mode: 'items', itemIds: [item(o12, 'Тартар').id] }));
  assert.ok(!kds(HOT).tickets.some(x => x.name === 'Тартар'), 'горячий цех мясной не видит');
  assert.ok(kds(CHEF).tickets.some(x => x.name === 'Тартар'), 'шеф видит все цеха');
  ok(call('rsRoleSave', DIR, { idem: key(), role: 'Повар горячего цеха', perms: { shop_meat: true }, reason: 'горячий цех ведёт и мясо' }));
  assert.ok(kds(HOT).tickets.some(x => x.name === 'Тартар'), 'после права — видит');
  assert.ok(kds(HOT).shops.includes('Мясной цех'));
});
t('экран не перегружается: без изменений сервер отвечает «то же самое»', () => {
  const a = kds(HOT), b = ok(call('rsKdsData', HOT, { dept: 'KITCHEN', gen: a.gen }));
  assert.strictEqual(b.same, true);
});

console.log(`\nИтого: ${pass} пройдено, ${fail} не пройдено`);
process.exit(fail ? 1 : 0);
