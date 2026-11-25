// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
// Restaurant Service, этап 6: бар — роли, барная очередь, рецепт на карточке, списание ингредиентов по ТТК при «Готово»,
// заготовки бара через производство MON CHEF. Сценарий ТЗ §16.7. Запуск: node monchef/tools/rs_stage6.test.js
const assert = require('assert');
const { boot } = require('./gasemu');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e)); } }
const J = s => (typeof s === 'string' ? JSON.parse(s) : s);
let seq = 0; const key = () => 'st6-key-' + (++seq);

const E = boot({ now: '2026-11-25T08:00:00Z' }), C = E.ctx, ss = E.ss;
const emp = ss.insertSheet('Сотрудники');
emp.appendRow(['Фамилия', 'Имя', 'Отчество', 'Должность', 'Роль', 'ДР', 'Телефон', 'Адрес', 'ПИН-код', '', '', '', 'Активен']);
[['Директорова', 'Анна', 'Директор', '1111'], ['Админов', 'Пётр', 'Администратор', '2222'], ['Официантов', 'Иван', 'Официант', '3333'], ['Горячев', 'Олег', 'Повар горячего цеха', '4444'],
 ['Барменов', 'Лев', 'Бармен', '8888'], ['Барова', 'Ника', 'Менеджер бара', '9999']].forEach(r => emp.appendRow([r[0], r[1], '', r[2], r[2], '', '', '', r[3], '', '', '', true]));
const ds = ss.insertSheet('Блюда');
ds.appendRow(['Код', 'Название', 'Категория', 'Выход', 'Кол-во ингр.', 'Технология', 'Файл', 'Заготовка (JSON)', 'Цех', '', '', '', 'Выход, г/мл/шт', 'Ед. выхода']);
[['B010', 'Дайкири', 'Коктейли', 'Бар', 85, 'мл', 'Шейк со льдом, двойной стрейн в охлаждённое купе'],
 ['B011', 'Капучино', 'Кофе', 'Кофейня', 250, 'мл', ''],
 ['B012', 'Мохито', 'Коктейли', 'Бар', 250, 'мл', 'Билд в хайболе'],
 ['PF20', 'Сироп сахарный п/ф', 'Сиропы', 'Бар', 1000, 'мл', 'Сахар растворить в горячей воде 1:1, охладить'],
 ['PF21', 'Бульон куриный п/ф', 'Бульоны', 'Горячий цех', 1000, 'мл', '']]
  .forEach(r => ds.appendRow([r[0], r[1], r[2], r[4], '', r[6], '', '', r[3], '', '', '', r[4], r[5]]));
const so = ss.insertSheet('Состав');
so.appendRow(['Код', 'Продукт', 'Группа', '', 'Брутто', 'Нетто', 'Выход', 'Ед.']);
[['B010', 'Ром белый', 50, 50, 'мл'], ['B010', 'Сок лайма', 25, 20, 'мл'], ['B010', 'Сироп сахарный п/ф', 15, 15, 'мл'],
 ['B011', 'Молоко', 180, 180, 'мл'], ['B011', 'Кофе зерно', 18, 18, 'г'],
 ['B012', 'Ром белый', 50, 50, 'мл'], ['B012', 'Мята', 10, 8, 'г'],
 ['PF20', 'Сахар', 500, 500, 'г'], ['PF20', 'Вода питьевая', 500, 500, 'мл'], ['PF21', 'Курица', 500, 450, 'г']]
  .forEach(r => so.appendRow([r[0], r[1], '', '', r[2], r[3], r[3], r[4]]));
const pr = ss.insertSheet('Цены_Меню'); pr.appendRow(['PriceID', 'DishCode', 'DishName', 'Price', 'Unit', 'Source', 'EventID', 'DateFrom', 'DateTo', 'Status']);
[['B010', 650], ['B011', 250], ['B012', 600]].forEach((r, i) => pr.appendRow(['P' + i, r[0], '', r[1], 'порц.', 'MENU', '', '2026-11-01', '', 'ACTIVE']));
const tv = ss.insertSheet('ТТК_Версии'); tv.appendRow(['Код блюда', 'Версия', 'Статус', 'Название', 'Выход', 'Технология', 'Состав(JSON)', 'operation_id', 'Автор', 'Создано', 'Условия хранения', 'Срок реализации']);
['B010', 'B011', 'B012', 'PF20', 'PF21'].forEach(c => tv.appendRow([c, 2, 'действующая', '', '', '', '[]', '', '', '', c === 'PF20' ? 'при +2…+6 °C, в закрытой таре' : '', c === 'PF20' ? '7 сут' : '']));

const login = pin => J(C.loginWithPin(pin, 'dev-' + pin)).token;
const drop = () => { C._mcRcDrop_(); C._BOOK_CACHE_ = null; };
const DIR = login('1111'), ADM = login('2222'), WAI = login('3333'), HOT = login('4444'), BAR = login('8888'), BM = login('9999');
const call = (fn, tok, d) => { C._mcRcDrop_(); C._BOOK_CACHE_ = null; C._MC_ADM_CACHE = null; return J(C[fn](JSON.stringify(d || {}), tok)); };
const ok = r => { assert.ok(r.success === true || r.ok === true, JSON.stringify(r).slice(0, 400)); return r.data !== undefined ? r.data : r; };
const err = (r, code) => { assert.ok(!(r.success === true || r.ok === true), 'ожидался отказ: ' + JSON.stringify(r).slice(0, 300)); if (code) assert.strictEqual(r.error && r.error.code, code, JSON.stringify(r)); return r; };
const left = name => { C._mcRcDrop_(); C._BOOK_CACHE_ = null; const v = ss.getSheetByName('Склад_Партии').getDataRange().getValues(); return v.slice(1).filter(r => r[1] === name).reduce((a, r) => a + (Number(r[9]) || 0), 0); };
// приход сырья — существующим приходом MON CHEF (партии), партии допущены
C._withLock_(() => C._incomeWithBatches_([{ name: 'Ром белый', qty: 700, unit: 'мл', price: 2 }, { name: 'Сок лайма', qty: 300, unit: 'мл', price: 1 }, { name: 'Сахар', qty: 2000, unit: 'г', price: 0.1 },
  { name: 'Вода питьевая', qty: 5000, unit: 'мл', price: 0.01 }, { name: 'Молоко', qty: 1000, unit: 'мл', price: 0.1 }, { name: 'Кофе зерно', qty: 500, unit: 'г', price: 2 }], 'Поставщик', 'тест', null));
(() => { const sh = ss.getSheetByName('Склад_Партии'), v = sh.getDataRange().getValues(); for (let i = 1; i < v.length; i++) { sh.getRange(i + 1, 11).setValue('active'); if (!v[i][5]) sh.getRange(i + 1, 6).setValue(new Date('2027-01-01')); } })();
const hall = ok(call('rsHallSave', ADM, { idem: key(), name: 'Зал', width: 6, height: 4 }));
const T5 = ok(call('rsTableSave', ADM, { idem: key(), hallId: hall.id, number: '5', x: 1, y: 1, seatsMax: 4 }));
const kds = (tok, dept) => ok(call('rsKdsData', tok, { dept }));

console.log('Restaurant Service — этап 6');
t('роли: «Бармен» и «Менеджер бара» — права по ТЗ §8; запрещённое по умолчанию запрещено', () => {
  assert.ok(C.MC_RB_ROLES_.includes('Бармен') && C.MC_RB_ROLES_.includes('Менеджер бара'));
  const b = C.MC_RB_MATRIX_['Бармен'], m = C.MC_RB_MATRIX_['Менеджер бара'];
  ['bar_queue', 'stopgo_bar', 'batch_use', 'stock_view', 'kanban'].forEach(k => assert.ok(b.includes(k), k));
  ['costs', 'ttk_approve', 'finance_view', 'finance_edit', 'personnel', 'grants', 'kitchen_queue'].forEach(k => assert.ok(!b.includes(k), 'бармену нельзя: ' + k));
  ['stopgo_approve', 'bar_manage', 'prod_manage'].forEach(k => assert.ok(m.includes(k), k)); assert.ok(!m.includes('costs'), 'себестоимость — только по праву директора');
  assert.ok(C.MC_FOOD_ROLES_.includes('Бармен'), 'бармен — с медицинским допуском');
});
let o5;
t('медицинский допуск: бармен без медкнижки задания бара не ведёт', () => {
  o5 = ok(call('rsOrderOpen', WAI, { idem: key(), tableId: T5.id, guests: 3 })).orderId;
  ok(call('rsItemAdd', WAI, { idem: key(), orderId: o5, items: [{ code: 'B010', qty: 2 }, { code: 'B011' }] }));
  ok(call('rsOrderSend', WAI, { idem: key(), orderId: o5, mode: 'all' }));
  const tk = kds(BAR, 'BAR').tickets[0];
  err(call('rsTicketAct', BAR, { idem: key(), ticketId: tk.id, version: tk.version, action: 'start' }));
  E.props[C.MC_MED_GATE_PROP_] = 'off';
});
t('сценарий 7: коктейли — бармену, кофе — в назначенный участок (кофейня); бармен не видит кухню', () => {
  const bar = kds(BAR, 'BAR').tickets; assert.deepStrictEqual(bar.map(x => x.name + '×' + x.qty), ['Дайкири×2']);
  const k = kds(DIR, 'KITCHEN').tickets; assert.deepStrictEqual(k.map(x => x.name + '|' + x.shop), ['Капучино|Кофейня']);
  assert.strictEqual(kds(BAR, 'KITCHEN').can.act, false);
});
t('бармен видит рецепт на карточке: состав на порцию и технологию', () => {
  const r = kds(BAR, 'BAR').tickets[0].recipe;
  assert.deepStrictEqual(r.ing.map(x => x.name + ' ' + x.qty + ' ' + x.unit), ['Ром белый 50 мл', 'Сок лайма 20 мл', 'Сироп сахарный п/ф 15 мл']);
  assert.ok(/двойной стрейн/.test(r.tech));
});
t('заготовка бара: бармен планирует сироп, начинает и выпускает — сырьё списано, партия заготовки создана', () => {
  err(call('rsBarPrepPlan', BAR, { idem: key(), code: 'PF21', qty: 1000, unit: 'мл' }), 'VALIDATION');   // бульон — не заготовка бара
  // MC-025: срок сиропа утверждён с основанием (предложил менеджер бара, утвердил директор) — иначе партия без срока в коктейль не идёт
  drop(); C._v102ShelfSheet_().appendRow(['SH-TEST', 'PF20', 'Сироп сахарный п/ф', 72, 'ТИ предприятия на сиропы, п. 3.2; протокол № 12', 'APPROVED', 'Барнов', new Date(), 'Директорова Анна', new Date(), '', 'OP']);
  const id = ok(call('rsBarPrepPlan', BAR, { idem: key(), code: 'PF20', qty: 1000, unit: 'мл' })).id;
  err(J(C.startProduction(id, HOT)));   // повар горячего цеха задание бара не начинает (цех проверяет сервер)
  ok(call('rsBarPrepStart', BAR, { idem: key(), id }));
  const sugar0 = left('Сахар');
  const r = ok(call('rsBarPrepComplete', BAR, { idem: key(), id, qty: 1000 }));
  assert.ok(sugar0 - left('Сахар') > 499, 'сахар списан: ' + (sugar0 - left('Сахар')));
  assert.ok(left('Сироп сахарный') >= 999, 'партия сиропа: ' + left('Сироп сахарный'));
  const p = ok(call('rsBarPreps', BAR, {})); assert.strictEqual(p.orders.find(o => o.id === id).status, 'COMPLETED'); assert.ok(!('cost' in p.orders[0]), 'бармен не видит себестоимость');
});
t('«Готовить» проверяет наличие (без списания); «Готово» — списание по ТТК: ром, лайм, сироп; себестоимость; связь с заказом', () => {
  const rum0 = left('Ром белый'), lime0 = left('Сок лайма'), syr0 = left('Сироп сахарный');
  let tk = kds(BAR, 'BAR').tickets[0];
  const st = ok(call('rsTicketAct', BAR, { idem: key(), ticketId: tk.id, version: tk.version, action: 'start' }));
  assert.strictEqual(st.warning, ''); assert.strictEqual(left('Ром белый'), rum0, 'на старте не списано');
  tk = kds(BAR, 'BAR').tickets[0];
  const rd = ok(call('rsTicketAct', BAR, { idem: key(), ticketId: tk.id, version: tk.version, action: 'ready' }));
  assert.strictEqual(rd.stock.status, 'FULL');
  assert.strictEqual(rum0 - left('Ром белый'), 100); assert.strictEqual(lime0 - left('Сок лайма'), 50, 'со склада — брутто ТТК (25 мл × 2), в бокал — нетто'); assert.ok(Math.abs(syr0 - left('Сироп сахарный') - 30) < 0.01);
  const q = ss.getSheetByName('ОчередьПроизводства_V1').getDataRange().getValues(), h = q[0], row = q.find(r => r[0] === tk.id);
  assert.ok(row[h.indexOf('Себестоимость, коп')] > 0, 'себестоимость');
  assert.ok(JSON.parse(row[h.indexOf('Списано по партиям')]).lines.length >= 3);
  const tr = ss.getSheetByName(C._mcTraceSheet_().getName()).getDataRange().getValues(); assert.ok(tr.some(r => r.includes('ORDER_ITEM') && r.includes(tk.itemId)), 'связь партия → позиция заказа');
  const ops = ss.getSheetByName('Склад_Операции').getDataRange().getValues(); assert.ok(ops.some(r => r[8] === 'Производство заказа ' + tk.id), 'складская операция подписана заданием');
});
t('повтор не списывает второй раз', () => {
  const tk = kds(BAR, 'BAR').tickets[0], rum0 = left('Ром белый');
  const q = ss.getSheetByName('ОчередьПроизводства_V1').getDataRange().getValues(), h = q[0], raw = {}; h.forEach((k, i) => raw[k] = q.find(r => r[0] === tk.id)[i]);
  const r = C._withLock_(() => C._rsConsume_(raw, null, false)); assert.strictEqual(r.status, 'ALREADY'); assert.strictEqual(left('Ром белый'), rum0);
});
t('нехватка: недостающее не досписывается, бармен видит предупреждение, менеджеру бара — уведомление', () => {
  ok(call('rsItemAdd', WAI, { idem: key(), orderId: o5, items: [{ code: 'B012', qty: 1 }] }));
  ok(call('rsOrderSend', WAI, { idem: key(), orderId: o5, mode: 'all' }));
  let tk = kds(BAR, 'BAR').tickets.find(x => x.name === 'Мохито');
  const st = ok(call('rsTicketAct', BAR, { idem: key(), ticketId: tk.id, version: tk.version, action: 'start' }));
  assert.ok(/Мята/.test(st.warning), st.warning);
  tk = kds(BAR, 'BAR').tickets.find(x => x.name === 'Мохито');
  const rd = ok(call('rsTicketAct', BAR, { idem: key(), ticketId: tk.id, version: tk.version, action: 'ready' }));
  assert.strictEqual(rd.stock.status, 'PARTIAL'); assert.ok(/не хватило: Мята/.test(rd.warning));
  assert.ok(ss.getSheetByName('Уведомления').getDataRange().getValues().some(r => /Списание не полностью: Мохито/.test(r[4]) && r[6] === 'Менеджер бара'));
});
t('сценарий 8 (бар): отмена после начала с полным расходом — списано по ТТК; отмена уже готового — без второго списания', () => {
  ok(call('rsItemAdd', WAI, { idem: key(), orderId: o5, items: [{ code: 'B010' }] }));
  ok(call('rsOrderSend', WAI, { idem: key(), orderId: o5, mode: 'all' }));
  let tk = kds(BAR, 'BAR').tickets.find(x => x.name === 'Дайкири' && x.status === 'NEW');
  ok(call('rsTicketAct', BAR, { idem: key(), ticketId: tk.id, version: tk.version, action: 'start' }));
  const rum0 = left('Ром белый');
  tk = kds(BAR, 'BAR').tickets.find(x => x.id === tk.id);
  const c = ok(call('rsTicketCancel', BAR, { idem: key(), ticketId: tk.id, version: tk.version, reason: 'разбил бокал', consumption: 'FULL' })).consumption;
  assert.strictEqual(c.posted, true); assert.strictEqual(rum0 - left('Ром белый'), 50);
  // готовый мохито отменяют с полным расходом — уже списан при «Готово»
  const mo = kds(BAR, 'BAR').tickets.find(x => x.name === 'Мохито'), rum1 = left('Ром белый');
  const c2 = ok(call('rsTicketCancel', BAR, { idem: key(), ticketId: mo.id, version: mo.version, reason: 'гость отказался', consumption: 'FULL' })).consumption;
  assert.strictEqual(c2.stock, 'списано при «Готово»'); assert.strictEqual(left('Ром белый'), rum1);
});
t('рецептуры бара: состав, потери, хранение и срок из ТТК; себестоимость — только с правом costs', () => {
  const r = ok(call('rsBarRecipes', BAR, {})); assert.strictEqual(r.costs, false);
  assert.deepStrictEqual(r.recipes.map(x => x.name), ['Дайкири', 'Мохито', 'Сироп сахарный п/ф']);
  const d = r.recipes.find(x => x.name === 'Дайкири'); assert.strictEqual(d.ing.find(x => x.name === 'Сок лайма').lossPct, 20); assert.strictEqual(d.version, 2);
  assert.ok(!('costPerPortion' in d));
  const s = r.recipes.find(x => x.semi); assert.ok(/\+2…\+6/.test(s.storage)); assert.strictEqual(s.term, '7 сут'); assert.strictEqual(s.equipment, 'не указано в ТТК');
  ok(call('rsRoleSave', DIR, { idem: key(), role: 'Менеджер бара', perms: { costs: true }, reason: 'менеджер бара считает себестоимость' }));
  const m = ok(call('rsBarRecipes', BM, {})); assert.strictEqual(m.costs, true); assert.ok(m.recipes.find(x => x.name === 'Дайкири').costPerPortion > 0);
});
t('менеджер бара снимает «на проверке» в баре; бармен — нет', () => {
  ok(call('rsStopSet', BAR, { idem: key(), code: 'B012', dept: 'BAR', status: 'REVIEW', reason: 'Проблема качества', comment: 'проверить мяту' }));
  err(call('rsStopGo', BAR, { idem: key(), code: 'B012', dept: 'BAR', reason: 'ок', confirm: true }), 'FORBIDDEN');
  ok(call('rsStopGo', BM, { idem: key(), code: 'B012', dept: 'BAR', reason: 'мята свежая', confirm: true }));
});
t('кухня тем же механизмом: капучино «Готово» — молоко и кофе списаны', () => {
  const milk0 = left('Молоко'); let tk = kds(DIR, 'KITCHEN').tickets.find(x => x.name === 'Капучино');
  ok(call('rsTicketAct', DIR, { idem: key(), ticketId: tk.id, version: tk.version, action: 'start' }));
  tk = kds(DIR, 'KITCHEN').tickets.find(x => x.name === 'Капучино');
  ok(call('rsTicketAct', DIR, { idem: key(), ticketId: tk.id, version: tk.version, action: 'ready' }));
  assert.strictEqual(milk0 - left('Молоко'), 180);
});

console.log(`\nИтого: ${pass} пройдено, ${fail} не пройдено`);
process.exit(fail ? 1 : 0);
