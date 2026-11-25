// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
// MC-018: сырьё → выпуск п/ф → партия п/ф (срок с основанием) → хранение → блюдо гостю → отзыв; просроченный, заблокированный и п/ф без
// утверждённого срока не используется. Запуск: node monchef/tools/mc018.test.js
const assert = require('assert');
const { boot } = require('./gasemu');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e)); } }
const J = s => (typeof s === 'string' ? JSON.parse(s) : s);
const E = boot({ now: '2026-11-25T08:00:00Z' }), C = E.ctx, ss = E.ss;
E.props[C.MC_MED_GATE_PROP_] = 'off';
const emp = ss.insertSheet('Сотрудники');
emp.appendRow(['Фамилия', 'Имя', 'Отчество', 'Должность', 'Роль', 'ДР', 'Телефон', 'Адрес', 'ПИН-код', '', '', '', 'Активен']);
[['Директорова', 'Анна', 'Директор', '1111'], ['Админов', 'Пётр', 'Администратор', '2222'], ['Официантов', 'Иван', 'Официант', '3333'], ['Шефов', 'Марк', 'Шеф-повар', '7777'], ['Хасапов', 'Ким', 'Ответственный за ХАССП', '5555']]
  .forEach(r => emp.appendRow([r[0], r[1], '', r[2], r[2], '', '', '', r[3], '', '', '', true]));
const ds = ss.insertSheet('Блюда'); ds.appendRow(['Код', 'Название', 'Категория', 'Выход', '', 'Технология', '', '', 'Цех', 'Срок реализации (ч)', '', '', 'Выход, г/мл/шт', 'Ед. выхода']);
[['PF11', 'Бульон куриный п/ф', 'Бульоны', 'Горячий цех', 1000, 'мл'], ['D010', 'Суп куриный', 'Супы', 'Горячий цех', 350, 'мл']].forEach(r => ds.appendRow([r[0], r[1], r[2], r[4], '', '', '', '', r[3], '', '', '', r[4], r[5]]));
const so = ss.insertSheet('Состав'); so.appendRow(['Код', 'Продукт', '', '', 'Брутто', 'Нетто', 'Выход', 'Ед.']);
[['PF11', 'Курица', 600, 'г'], ['PF11', 'Вода питьевая', 800, 'мл'], ['D010', 'Бульон куриный п/ф', 300, 'мл'], ['D010', 'Лапша', 50, 'г']].forEach(r => so.appendRow([r[0], r[1], '', '', r[2], r[2], r[2], r[3]]));
const pr = ss.insertSheet('Цены_Меню'); pr.appendRow(['PriceID', 'DishCode', 'DishName', 'Price', 'Unit', 'Source', 'EventID', 'DateFrom', 'DateTo', 'Status']); pr.appendRow(['P1', 'D010', '', 450, 'порц.', 'MENU', '', '2026-11-01', '', 'ACTIVE']);
const tv = ss.insertSheet('ТТК_Версии'); tv.appendRow(['Код блюда', 'Версия', 'Статус']); ['PF11', 'D010'].forEach(c => tv.appendRow([c, 1, 'действующая']));
C._withLock_(() => C._incomeWithBatches_([{ name: 'Курица', qty: 600, unit: 'г', price: 0.3, expiry: '2026-11-27' }, { name: 'Курица', qty: 2000, unit: 'г', price: 0.32, expiry: '2026-11-28' }, { name: 'Вода питьевая', qty: 20000, unit: 'мл', price: 0.001 }, { name: 'Лапша', qty: 1000, unit: 'г', price: 0.2 }], 'Поставщик', '', null));
(() => { const sh = ss.getSheetByName('Склад_Партии'), n = sh.getLastRow(); for (let i = 2; i <= n; i++) sh.getRange(i, 11).setValue('active'); })();
const login = pin => J(C.loginWithPin(pin, 'dev-' + pin)).token;
const DIR = login('1111'), ADM = login('2222'), WAI = login('3333'), CHEF = login('7777'), H1 = login('5555');
const drop = () => { C._mcRcDrop_(); C._BOOK_CACHE_ = null; };
const ok = r => { r = J(r); assert.ok(r && (r.success === true || r.ok === true), JSON.stringify(r).slice(0, 300)); return r.data !== undefined ? r.data : r; };
let seq = 0; const key = () => 'mc018-key-' + (++seq);
const call = (fn, tk, d) => { drop(); return ok(C[fn](JSON.stringify(d), tk)); };
const batches = name => { drop(); return ss.getSheetByName('Склад_Партии').getDataRange().getValues().slice(1).filter(r => r[1] === name); };
const block = id => { drop(); C._mcBlocksSheet_().appendRow(['BLK-' + id, 'BATCH', id, 'отзыв поставщика', '', '', '', new Date(), 'Хасапов Ким', 'ACTIVE', '', '', '']); };
let pn = 0;
const produce = (code, qty) => { E.setNow(new Date(Date.UTC(2026, 10, 25, 8, ++pn)).toISOString()); drop(); const p = ok(C.planProduction(code, qty, 'мл', '[]', 'т' + pn, CHEF)); drop(); ok(C.startProduction(p.id, CHEF)); drop(); return ok(C.completeProduction(p.id, qty, '', CHEF)); };

console.log('MC-018 · прослеживаемость полуфабриката');
let PFB, rawBlocked, rawUsed;
t('заблокированная партия сырья (отзыв) в выпуск п/ф не идёт — берётся следующая по FEFO', () => {
  rawBlocked = String(batches('Курица')[0][0]); rawUsed = String(batches('Курица')[1][0]); block(rawBlocked);
  // срок бульона утверждён с основанием (MC-025)
  const p = ok(C.setDishShelfLife('PF11', 48, CHEF, 'СанПиН 2.3/2.4.3590-20, прил. 7, п. 8')); drop(); ok(C.v102ShelfDecide(JSON.stringify({ id: p.id, approve: true }), H1));
  const r = produce('PF11', 1000); PFB = String(r.batch);
  const b = batches('Курица'); assert.strictEqual(b.find(x => String(x[0]) === rawBlocked)[9], 600, 'заблокированная не тронута'); assert.strictEqual(b.find(x => String(x[0]) === rawUsed)[9], 1400);
});
t('партия п/ф: срок по утверждённому правилу, основание — источник, версия ТТК, кто утвердил', () => {
  const tr = ok(C.v102TraceSemi(JSON.stringify({ batchId: PFB }), CHEF));
  assert.strictEqual(tr.batch.expiry, '27.11.2026'); assert.ok(tr.usable);
  assert.ok(/карта, утверждено/.test(tr.expiryBasis['Основание']) && /СанПиН/.test(tr.expiryBasis['Источник правила']) && /Хасапов/.test(tr.expiryBasis['Утвердил основание']) && Number(tr.expiryBasis['Версия ТТК']) === 1, JSON.stringify(tr.expiryBasis));
  assert.ok(tr.raw.some(x => x.batchId === rawUsed && x.product === 'Курица'), 'из какого сырья: ' + JSON.stringify(tr.raw));
});
t('просроченный, заблокированный и п/ф без утверждённого срока в блюдо не идут; берётся годная партия п/ф', () => {
  drop(); C._withLock_(() => { C._incomeWithBatches_([{ name: 'Бульон куриный', qty: 1000, unit: 'мл', price: 0.2, expiry: '2026-11-24' }], 'Производство PR-OLD', '', null); C._incomeWithBatches_([{ name: 'Бульон куриный', qty: 1000, unit: 'мл', price: 0.2, expiry: '2026-11-26' }], 'Производство PR-BLK', '', null); C._incomeWithBatches_([{ name: 'Бульон куриный', qty: 1000, unit: 'мл', price: 0.2 }], 'Производство PR-NOEXP', '', null); });
  (() => { const sh = ss.getSheetByName('Склад_Партии'), n = sh.getLastRow(); for (let i = 2; i <= n; i++) sh.getRange(i, 11).setValue('active'); })();
  const all = batches('Бульон куриный'), expired = all.find(r => /PR-OLD/.test(r[7])), blk = all.find(r => /PR-BLK/.test(r[7])), noexp = all.find(r => /PR-NOEXP/.test(r[7]));
  block(String(blk[0]));
  const hall = call('rsHallSave', ADM, { idem: key(), name: 'Зал', width: 4, height: 4 }), t1 = call('rsTableSave', ADM, { idem: key(), hallId: hall.id, number: '5', x: 0, y: 0, seatsMax: 4 });
  const o = call('rsOrderOpen', WAI, { idem: key(), tableId: t1.id, guests: 2 }).orderId;
  call('rsItemAdd', WAI, { idem: key(), orderId: o, items: [{ code: 'D010', qty: 2 }] }); call('rsOrderSend', WAI, { idem: key(), orderId: o, mode: 'all' });
  let tk = call('rsKdsData', CHEF, { dept: 'KITCHEN' }).tickets[0]; tk = call('rsTicketAct', CHEF, { idem: key(), ticketId: tk.id, version: tk.version, action: 'start' }).ticket;
  call('rsTicketAct', CHEF, { idem: key(), ticketId: tk.id, version: tk.version, action: 'ready' });
  const after = batches('Бульон куриный');
  assert.strictEqual(after.find(r => r[0] === expired[0])[9], 1000, 'просроченный не тронут'); assert.strictEqual(after.find(r => r[0] === blk[0])[9], 1000, 'заблокированный не тронут');
  assert.strictEqual(after.find(r => r[0] === noexp[0])[9], 1000, 'без срока не тронут'); assert.strictEqual(after.find(r => String(r[0]) === PFB)[9], 400, 'годная партия: 1000 − 2 × 300');
  const tr = ok(C.v102TraceSemi(JSON.stringify({ batchId: String(noexp[0]) }), CHEF)); assert.ok(!tr.usable && /нет утверждённого срока/.test(tr.why));
  const tb = ok(C.v102TraceSemi(JSON.stringify({ batchId: String(blk[0]) }), CHEF)); assert.ok(!tb.usable && /заблокирована/.test(tb.why));
});
t('где применён п/ф: стол, заказ, официант; отзыв партии сырья доходит до гостя зала через п/ф', () => {
  const tr = ok(C.v102TraceSemi(JSON.stringify({ batchId: PFB }), CHEF));
  const u = tr.used.find(x => x.toType === 'ORDER_ITEM'); assert.ok(u && /Гость зала: стол № 5/.test(u.to) && u.dish === 'Суп куриный', JSON.stringify(tr.used));
  drop(); const rc = J(C.v74Preview(JSON.stringify({ scope: { batchIds: [rawUsed] } }), H1)); assert.ok(rc.success, JSON.stringify(rc).slice(0, 300));
  assert.ok(rc.data.batches.some(b => b.batchId === PFB && b.role === 'DERIVED'), 'п/ф в охвате отзыва');
  assert.ok(rc.data.recipients.some(x => /Гость зала: стол № 5/.test(x.to)), JSON.stringify(rc.data.recipients.map(x => x.to)));
});

console.log('\nИтого: ' + pass + ' пройдено, ' + fail + ' не пройдено');
process.exit(fail ? 1 : 0);
