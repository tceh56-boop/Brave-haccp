// M12: алкоголь — лицензия, марки, вскрытие тары, журнал. Запуск: node replica/tests/alco_test.js
const assert = require('assert');
const { ctx: G } = require('./harness.js');
let failures = 0;
function step(name, fn) {
  try { const r = fn(); console.log('OK   ', name); return r; }
  catch (e) { failures++; console.log('FAIL ', name, '—', e && e.message); }
}
function api(a, d, t) { const r = G.processOperation(a, d || {}, t); if (!r.ok) throw new Error(a + ': ' + r.error); return r.data; }
function apiErr(a, d, t) { const r = G.processOperation(a, d || {}, t); assert(!r.ok, a + ' должен был вернуть ошибку'); return r.error; }

G.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', 'SS');
G.initializeDatabase();
G.insertRow_('ORGANIZATIONS', { organization_id: 'ORG-1', название: 'Бар', статус: 'активна' });
G.insertRow_('LOCATIONS', { location_id: 'LOC-1', organization_id: 'ORG-1', название: 'Точка', статус: 'активна' });
function mk(id, role, pin) { const s = 's' + id; G.insertRow_('USERS', { user_id: id, organization_id: 'ORG-1', location_ids: 'LOC-1', имя: role, роль: role, статус: 'активен', pin_hash: G.hashPin_(pin, s), pin_salt: s, failed_attempts: 0, lockout_count: 0 }); }
mk('USR-D', 'ДИРЕКТОР', '739164'); mk('USR-M', 'МЕНЕДЖЕР', '615283'); mk('USR-K', 'КАССИР', '284617'); mk('USR-W', 'ОФИЦИАНТ', '531846'); mk('USR-P', 'ПОВАР', '927364'); mk('USR-S', 'КЛАДОВЩИК', '846275');
function login(u, p) { const d = api('LOGIN', { userId: u, pin: p }); return d.requires_location ? (api('SELECT_LOCATION', { locationId: 'LOC-1' }, d.token).token || d.token) : d.token; }
const tD = login('USR-D', '739164'), tM = login('USR-M', '615283'), tK = login('USR-K', '284617'), tW = login('USR-W', '531846'), tP = login('USR-P', '927364'), tS = login('USR-S', '846275');

const today = G.todayDateStr_(), day = n => G._dpAddDays_(today, n);
const prod = (n, unit, price) => { const p = api('CREATE_PRODUCT', { название: n, единица: unit, цена: price }, tD); return p.product_id || p.product.product_id; };
const vodka = prod('Водка «Пшеничная»', 'л', 600), beer = prod('Пиво светлое разливное', 'л', 180), cognac = prod('Коньяк', 'л', 2400), juice = prod('Сок яблочный', 'л', 90), lemon = prod('Лимон', 'кг', 200);
const dish = (n, price, lines) => { const d = api('CREATE_DISH', { название: n, выход: 50, цена_продажи: price }, tD); lines.forEach(l => api('ADD_RECIPE_LINE', { parentType: 'DISH', parentId: d.dish_id, ingredientId: l[0], брутто: l[1], нетто: l[1], единица: l[2] }, tD)); return d.dish_id; };
const shot = dish('Водка 50 мл', 250, [[vodka, 50, 'мл']]), pint = dish('Пиво 0,5', 300, [[beer, 500, 'мл']]), cog = dish('Коньяк 50 мл', 600, [[cognac, 50, 'мл']]), juiceGlass = dish('Сок 200 мл', 150, [[juice, 200, 'мл']]);
const tincture = api('CREATE_SEMI_FINISHED', { название: 'Настойка лимонная', выход: 1, единица: 'л' }, tD).pf_id;
api('ADD_RECIPE_LINE', { parentType: 'PF', parentId: tincture, ingredientId: vodka, брутто: 0.9, нетто: 0.9, единица: 'л' }, tD);
api('ADD_RECIPE_LINE', { parentType: 'PF', parentId: tincture, ingredientId: lemon, брутто: 0.2, нетто: 0.2, единица: 'кг' }, tD);
const tinctShot = dish('Настойка 50 мл', 220, [[tincture, 50, 'мл']]);
const m68 = i => ('22N' + String(i).padStart(5, '0')).padEnd(68, 'A'), m150 = i => ('10' + String(i).padStart(6, '0')).padEnd(150, 'Z');
const keg = '0104607012345678215Ab3Cd9' + '\u001d' + '93XyZ1';

step('права: повар без доступа; кассир и официант только вскрывают', () => {
  assert(/Недостаточно прав/.test(apiErr('ALCO_GET_OVERVIEW', {}, tP)));
  assert(/Недостаточно прав/.test(apiErr('ALCO_SAVE_LICENSE', { номер: '123' }, tK)));
  assert(/Недостаточно прав/.test(apiErr('ALCO_GET_JOURNAL', {}, tW)));
  api('ALCO_GET_OVERVIEW', {}, tK); api('ALCO_GET_OVERVIEW', {}, tW);
});
step('карточки: единица только литры, код вида 3 цифры; пиво → «Честный знак»', () => {
  assert(/единица «кг»/.test(apiErr('ALCO_SAVE_PRODUCT', { productId: lemon, категория: 'крепкий', объём_тары_л: 0.5, крепость: 40, код_вида: '200' }, tD)));
  assert(/3 цифры/.test(apiErr('ALCO_SAVE_PRODUCT', { productId: vodka, категория: 'крепкий', объём_тары_л: 0.5, крепость: 40, код_вида: '2' }, tD)));
  assert.equal(api('ALCO_SAVE_PRODUCT', { productId: vodka, категория: 'крепкий', объём_тары_л: 0.5, крепость: 40, код_вида: '200', алкокод: '0300123456789012345' }, tS).маркировка, 'ЕГАИС');
  assert.equal(api('ALCO_SAVE_PRODUCT', { productId: beer, категория: 'пиво_разлив', объём_тары_л: 30, крепость: 4.5, код_вида: '261' }, tD).маркировка, 'ЧЗ');
  api('ALCO_SAVE_PRODUCT', { productId: cognac, категория: 'крепкий', объём_тары_л: 0.5, крепость: 40, код_вида: '230' }, tD);
  const list = api('ALCO_GET_PRODUCTS', {}, tM);
  assert.deepEqual(list.filter(x => !x.карточка).map(x => x.название), ['Сок яблочный']);
});
let order;
step('касса без лицензии: алкоголь (и через полуфабрикат) не добавляется, сок — да', () => {
  api('POS_OPEN_SHIFT', { cashStart: 0 }, tK);
  order = api('POS_CREATE_ORDER', {}, tK).order;
  assert(/нет действующей алкогольной лицензии/.test(apiErr('POS_ADD_LINE', { orderId: order.order_id, dishId: shot, qty: 1, version: order.version }, tK)));
  assert(/нет действующей алкогольной лицензии/.test(apiErr('POS_ADD_LINE', { orderId: order.order_id, dishId: tinctShot, qty: 1, version: order.version }, tK)));
  order = api('POS_ADD_LINE', { orderId: order.order_id, dishId: juiceGlass, qty: 1, version: order.version }, tK).order;
});
step('лицензия: проверка дат; действующая открывает продажу; истёкшая снова закрывает', () => {
  assert(/позже даты выдачи/.test(apiErr('ALCO_SAVE_LICENSE', { номер: '77РПА0012345', выдана: today, действует_до: day(-1) }, tD)));
  api('ALCO_SAVE_LICENSE', { номер: '77РПА0012345', выдана: day(-400), действует_до: day(-1), орган: 'Департамент торговли' }, tD);
  assert(/нет действующей/.test(apiErr('POS_ADD_LINE', { orderId: order.order_id, dishId: shot, qty: 1, version: order.version }, tK)));
  api('ALCO_SAVE_LICENSE', { номер: '77РПА0099999', выдана: day(-1), действует_до: day(20), орган: 'Департамент торговли' }, tM);
  order = api('POS_ADD_LINE', { orderId: order.order_id, dishId: shot, qty: 3, version: order.version }, tK).order;
  assert.equal(G.findRows_('ALCO_LICENSES', l => l.статус === 'действует').length, 1);
  assert.equal(api('ALCO_GET_OVERVIEW', {}, tK).лицензия.осталось_дней, 20);
});
let vodkaBatch, beerBatch;
step('приём марок: формат, дубли, не больше бутылок в партии', () => {
  api('RECEIVE_GOODS', { productId: vodka, qty: 1.5, price: 600, expiryDate: '2099-01-01', productionDate: today }, tD);
  api('RECEIVE_GOODS', { productId: beer, qty: 30, price: 180, expiryDate: day(60), productionDate: today }, tD);
  const batches = api('ALCO_GET_BATCHES', {}, tS);
  vodkaBatch = batches.find(b => /Водка/.test(b.название)); beerBatch = batches.find(b => /Пиво/.test(b.название));
  assert.deepEqual([vodkaBatch.бутылок, vodkaBatch.принято_марок, beerBatch.бутылок], [3, 0, 1]);
  assert(/Марка №1: Это не акцизная марка/.test(apiErr('ALCO_RECEIVE_MARKS', { batchId: vodkaBatch.batch_id, marks: ['12345'] }, tS)));
  assert(/нельзя принять ещё 4/.test(apiErr('ALCO_RECEIVE_MARKS', { batchId: vodkaBatch.batch_id, marks: [m68(1), m68(2), m68(3), m68(4)] }, tS)));
  assert(/дважды/.test(apiErr('ALCO_RECEIVE_MARKS', { batchId: vodkaBatch.batch_id, marks: [m68(1), m68(1)] }, tS)));
  assert.equal(api('ALCO_RECEIVE_MARKS', { batchId: vodkaBatch.batch_id, marks: [m68(1), m150(2).toLowerCase()], ттн: 'ТТН-0001' }, tS).принято, 2);
  assert(/уже есть в системе/.test(apiErr('ALCO_RECEIVE_MARKS', { batchId: vodkaBatch.batch_id, marks: [m68(1)] }, tS)));
  assert(/не код «Честного знака»/.test(apiErr('ALCO_RECEIVE_MARKS', { batchId: beerBatch.batch_id, marks: [m68(9)] }, tS)));
  assert.equal(api('ALCO_RECEIVE_MARKS', { batchId: beerBatch.batch_id, marks: [keg] }, tS).принято, 1);
});
step('вскрытие: неизвестная марка — отказ; бутылка → ЕГАИС, кега → «Честный знак»; повтор — отказ', () => {
  assert(/не принимали при приходе/.test(apiErr('ALCO_OPEN', { mark: m68(77) }, tK)));
  const r = api('ALCO_OPEN', { mark: m68(1) }, tK);
  assert.deepEqual([r.тип, r.система, r.объём_л], ['вскрытие_тары', 'ЕГАИС', 0.5]);
  assert(/уже вскрыта/.test(apiErr('ALCO_OPEN', { mark: m68(1) }, tW)));
  const k = api('ALCO_OPEN', { mark: keg.replace('\u001d', '') .slice(0, 25) + '\u001d93other' }, tW);
  assert.deepEqual([k.тип, k.система], ['подключение_кеги', 'ЧЗ']);
  const ov = api('ALCO_GET_OVERVIEW', {}, tM);
  assert.deepEqual([ov.на_складе, ov.вскрыто_сегодня, ov.к_отправке, ov.просрочено], [1, 2, 2, 0]);
});
step('очередь: отметка «отправлено» требует номер квитанции', () => {
  const docs = api('ALCO_GET_OUTBOX', {}, tM);
  assert.deepEqual(docs.map(d => d.тип).sort(), ['вскрытие_тары', 'подключение_кеги']);
  assert(docs.find(d => d.тип === 'вскрытие_тары').марка === m68(1) && docs.find(d => d.тип === 'вскрытие_тары').алкокод === '0300123456789012345');
  assert(/номер квитанции/.test(apiErr('ALCO_MARK_SENT', { docIds: docs.map(d => d.doc_id) }, tM)));
  assert.equal(api('ALCO_MARK_SENT', { docIds: docs.map(d => d.doc_id), квитанция: 'ACT-2026-001' }, tM).отмечено, 2);
  assert.equal(api('ALCO_GET_OUTBOX', {}, tM).length, 0);
});
step('журнал: литры по кассе (возврат вычитается) и вскрытие; коньяк продан без вскрытия — сигнал', () => {
  const sale = (dishId, qty, d) => G.insertRow_('SALES', { sale_id: 'S-' + Math.random(), organization_id: 'ORG-1', location_id: 'LOC-1', dish_id: dishId, qty, сумма: qty * 100, дата: d, источник: 'тест' });
  sale(shot, 4, today); sale(shot, -1, today); sale(pint, 2, today); sale(cog, 2, day(-1)); sale(tinctShot, 2, today); sale(juiceGlass, 5, today);
  const j = api('ALCO_GET_JOURNAL', { dateFrom: day(-1), dateTo: today }, tD);
  const r = (n, d) => j.rows.find(x => x.название === n && x.дата === d);
  assert.equal(r('Водка «Пшеничная»', today).продано_л, 0.24); // 3 × 50 мл + 2 × 50 мл × 0,9 настойки
  assert.equal(r('Водка «Пшеничная»', today).вскрыто_л, 0.5);
  assert.equal(r('Пиво светлое разливное', today).продано_л, 1); assert.equal(r('Пиво светлое разливное', today).вскрыто_л, 30);
  assert.equal(r('Коньяк', day(-1)).продано_л, 0.1);
  assert(!j.rows.some(x => /Сок/.test(x.название)));
  assert.deepEqual(j.сверка.filter(c => c.продано_больше).map(c => c.название), ['Коньяк']);
  assert(/3 месяцев/.test(apiErr('ALCO_GET_JOURNAL', { dateFrom: day(-200), dateTo: today }, tD)));
});
step('вскрытие в 00:30 по Москве (вчера по UTC) считается сегодняшним', () => {
  const before = api('ALCO_GET_OVERVIEW', {}, tM).вскрыто_сегодня;
  G.insertRow_('ALCO_MARKS', { mark_id: 'ALCM-NIGHT', organization_id: 'ORG-1', location_id: 'LOC-1', product_id: vodka, марка: m68(50), ключ: m68(50), система: 'ЕГАИС', объём_л: 0.5, статус: 'вскрыта', вскрыта: new Date(today + 'T00:30:00+03:00').toISOString() });
  assert.equal(api('ALCO_GET_OVERVIEW', {}, tM).вскрыто_сегодня, before + 1);
  assert(api('ALCO_GET_MARKS', { статус: 'вскрыта', сегодня: true }, tK).some(m => m.mark_id === 'ALCM-NIGHT'));
});
step('ежедневно: лицензия истекает через 20 дней → напоминание (без дублей); просроченная отправка → напоминание', () => {
  G.insertRow_('ALCO_OUTBOX', { doc_id: 'ALCO-OLD', organization_id: 'ORG-1', location_id: 'LOC-1', тип: 'вскрытие_тары', система: 'ЕГАИС', mark_id: '', product_id: vodka, дата: day(-2), срок_отправки: day(-2), статус: 'к_отправке' });
  const r = G.alcoDailyTrigger_();
  assert.deepEqual([r.лицензии, r.просрочки], [1, 1]);
  G.alcoDailyTrigger_();
  const n = G.findRows_('NOTIFICATIONS', x => x.тип === 'алкоголь_егаис');
  assert.equal(n.filter(x => /истекает/.test(x.сообщение)).length, 1, 'одно напоминание о лицензии');
  assert(n.some(x => /после срока: 1/.test(x.сообщение)));
  assert.equal(api('ALCO_GET_OVERVIEW', {}, tM).просрочено, 1);
});
step('самопроверка (runPosTests_) видит листы и действия алкоголя; ежедневная задача в расписании', () => {
  assert.deepEqual(G.runPosTests_().filter(x => x.status !== 'OK' && /ALCO/.test(x.name)), []);
  assert.equal(G.DAILY_TRIGGER_HOURS_.alcoDailyTrigger_, 9);
});
console.log(failures ? '\n' + failures + ' FAILED' : '\nALL PASSED');
process.exit(failures ? 1 : 0);
