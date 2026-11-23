/**
 * Сквозной сценарий VINOVNIK на мок-окружении Google (node test/vinovnik_e2e.test.js).
 * Столы → меню (из ТТК, товар без ТТК, по весу, фото и видео) → брони (пересечения, заявка гостя с QR-меню) →
 * стоп/go-лист → «гости пришли» → блокнот официанта (кол-во, курс, вес, гость, комментарий) → кухня и бар →
 * подача курсов → отмена позиции → закрытие счёта (продажи J36, списание склада по партиям) → лимит → стоп →
 * предложения по складу → меню гостя → «Моя смена» по зонам → разделы и права ролей.
 */
'use strict';
const path = require('path'), assert = require('assert');
const { load } = require('./gas_mock');
const env = load(path.join(__dirname, '..', 'app'));
const g = env.ctx, book = env.book;
let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); }
function J(x) { return typeof x === 'string' ? JSON.parse(x) : x; }
function fresh() { Object.keys(env.cache).filter(k => /^mc_gate_/.test(k)).forEach(k => delete env.cache[k]); }   // не «двойное нажатие»
function call(fn, args, tok) { fresh(); return J(g[fn].apply(null, args.concat([tok]))); }
function data(fn, args, tok, what) { const r = call(fn, args, tok); if (!(r && (r.success === true || r.ok === true))) throw new Error((what || fn) + ': ' + JSON.stringify(r).slice(0, 700)); return r.data !== undefined ? r.data : r; }
function deny(fn, args, tok) { const r = call(fn, args, tok); return r && r.success === false ? (r.error && r.error.message) || 'отказ' : null; }
function rows(name) { const sh = book.getSheetByName(name); return sh ? sh.getDataRange().getValues() : []; }
const day = (off) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + off); return d; };
const ru = d => String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear();
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const S = JSON.stringify;

/* ---------- предприятие ---------- */
function sheet(name, head, d) { const sh = book.getSheetByName(name) || book.insertSheet(name); sh.clear(); sh.appendRow(head); (d || []).forEach(r => sh.appendRow(r)); return sh; }
const emp = (f, i, role, pin) => [f, i, '', role, role, '', '', '', pin, 'СК-' + pin, day(300), day(-30), true, '', '', new Date()];
sheet('Сотрудники', ['Фамилия', 'Имя', 'Отчество', 'Должность', 'Роль', 'Дата рождения', 'Телефон', 'Адрес', 'ПИН-код', 'Сан. книжка №', 'Срок сан. книжки', 'Посл. мед. осмотр', 'Активен', 'Цвет', 'Ставка/час', 'Создан'], [
  emp('Иванова', 'Анна', 'Шеф-повар', '1111'), emp('Петров', 'Олег', 'Директор', '2222'), emp('Смирнова', 'Ольга', 'Администратор', '3333'),
  emp('Кузнецов', 'Илья', 'Повар горячего цеха', '4444'), emp('Орлова', 'Мария', 'Официант', '5555'), emp('Белов', 'Денис', 'Официант', '5556'),
  emp('Соколов', 'Артём', 'Бармен', '6666'), emp('Лебедева', 'Вера', 'Хостес', '7777')]);
sheet('Блюда', ['Код', 'Название', 'Категория', 'Выход', 'Кол-во ингр.', 'Технология', 'Файл', 'Заготовка (JSON)', 'Цех', 'Подгруппа', 'Время приготовления, мин', 'Аллергены', 'Выход, г/мл/шт', 'Ед. выхода', 'Порций в карточке', 'Папка ТТК', 'ID папки'], [
  ['PF1', 'Соус томатный п/ф', 'Заготовки', 1000, 2, '', '', '', 'Горячий цех', '', 40, '', 1000, 'г', 1, '', ''],
  ['D1', 'Паста с томатным соусом', 'Горячее', 250, 3, '', '', '', 'Горячий цех', '', 12, '', 250, 'г', 1, '', ''],
  ['D2', 'Салат Цезарь', 'Салаты', 220, 0, '', '', '', 'Холодный цех', '', 10, '', 220, 'г', 1, '', ''],
  ['D3', 'Стейк рибай', 'Горячее', 300, 1, '', '', '', 'Горячий цех', '', 20, '', 300, 'г', 1, '', ''],
  ['D4', 'Лимонад домашний', 'Напитки', 300, 2, '', '', '', 'Бар', '', 5, '', 300, 'мл', 1, '', '']
]);
sheet('Состав', ['Код', 'Ингредиент', 'Ед. изм.', 'Брутто (ориг.)', 'Брутто, г/мл', 'Нетто, г/мл/шт', 'Выход, г/мл/шт', 'Ед.', 'Нетто на 1 порцию', 'ProductID', 'ТТК п/ф'], [
  ['PF1', 'Томаты', 'г', 1200, 1200, 1000, 1000, 'г', '', '', ''], ['PF1', 'Масло оливковое', 'мл', 50, 50, 50, 50, 'мл', '', '', ''],
  ['D1', 'Спагетти', 'г', 100, 100, 100, 100, 'г', '', '', ''], ['D1', 'Соус томатный п/ф', 'г', 120, 120, 120, 120, 'г', '', '', 'PF1'], ['D1', 'Сыр пармезан', 'г', 20, 20, 20, 20, 'г', '', '', ''],
  ['D3', 'Говядина рибай', 'г', 350, 350, 350, 300, 'г', '', '', ''],
  ['D4', 'Лимон', 'г', 50, 50, 50, 50, 'г', '', '', ''], ['D4', 'Сахар', 'г', 30, 30, 30, 30, 'г', '', '', '']
]);

// Google Диск: папки и файлы в памяти (загрузка фото и видео меню)
let fileN = 0; const shared = {};
const mkFile = b => { const id = 'FILE' + (++fileN) + 'xxxxxxxxxxxxxxxxxxxxxx'; return { getId: () => id, getName: () => b.getName ? b.getName() : 'f', setSharing: () => { shared[id] = true; } }; };
const mkFolder = name => ({ getId: () => 'FOLDER-' + name, getName: () => name, isTrashed: () => false, setSharing() {}, createFile: b => mkFile(b), createFolder: n => mkFolder(n) });
g.DriveApp = { Access: { ANYONE_WITH_LINK: 'A' }, Permission: { VIEW: 'V' }, getFolderById: id => mkFolder(id), createFolder: n => mkFolder(n),
  getFileById: id => ({ getId: () => id, setSharing: () => { shared[id] = true; } }) };
g._docsFolder_ = () => mkFolder('Документы');
const login = pin => { const r = J(g.loginWithPin(pin, 'dev-vn-' + pin)); if (!r.ok) throw new Error('вход ' + pin + ': ' + S(r)); return r.token; };
const chef = login('1111'), dir = login('2222'), adm = login('3333'), cook = login('4444'), w1 = login('5555'), w2 = login('5556'), bar = login('6666'), host = login('7777');
console.log('Вход: шеф, директор, администратор, повар, два официанта, бармен, хостес');

g.PropertiesService.getScriptProperties().setProperty('MC_BC_INCOMING', 'off');
let r = J(g.stockAddIncome(S([
  { name: 'Томаты', qty: 5, unit: 'кг', price: 200, expiry: ru(day(5)) }, { name: 'Масло оливковое', qty: 1, unit: 'л', price: 900, expiry: ru(day(200)) },
  { name: 'Спагетти', qty: 3, unit: 'кг', price: 150, expiry: ru(day(300)) }, { name: 'Сыр пармезан', qty: 500, unit: 'г', price: 2.5, expiry: ru(day(20)) },
  { name: 'Говядина рибай', qty: 1.8, unit: 'кг', price: 2400, expiry: ru(day(4)) }, { name: 'Лимон', qty: 1, unit: 'кг', price: 300, expiry: ru(day(2)) },
  { name: 'Сахар', qty: 2, unit: 'кг', price: 90, expiry: ru(day(300)) }, { name: 'Вино Пино Нуар', qty: 3, unit: 'л', price: 1600, expiry: ru(day(700)) }
]), 'ООО Поставщик, накладная 21', '', chef));
ok(r.ok, 'приход: ' + (r.batchIds || []).length + ' партий');
const admit = () => { const sh = book.getSheetByName('Склад_Партии'); const v = sh.getDataRange().getValues(); for (let i = 1; i < v.length; i++) if (v[i][10] !== 'active' && v[i][10] !== 'consumed') sh.getRange(i + 1, 11).setValue('active'); };
admit();
r = J(g.stockAddSemiProduct('Соус томатный п/ф', 1000, 'г', 0, 'заготовка', ru(day(2)), chef)); admit();
ok(r.ok || r.batchId || r.success, 'п/ф «Соус томатный» изготовлен');
const stockOf = name => rows('Склад_Партии').slice(1).filter(x => x[1] === name).reduce((a, x) => a + Number(x[9]), 0);

console.log('Роли и права');
const perms = role => g._mcRbRolePerms_(role);
ok(perms('Официант').hall && !perms('Официант').booking && !perms('Официант').hall_manage, 'официант: зал (свои столы), без бронирования и управления залом');
ok(perms('Бармен').bar && perms('Бармен').stoplist && perms('Хостес').booking && !perms('Хостес').hall, 'бармен: бар и стоп-лист; хостес: только бронирование');
ok(perms('Администратор').hall_manage && perms('Директор').guestmenu && perms('Шеф-повар').stoplist, 'администратор управляет залом, директор — меню, шеф — стоп-лист');
ok(g.MC_FOOD_ROLES_.indexOf('Официант') >= 0 && g.MC_FOOD_ROLES_.indexOf('Бармен') >= 0, 'официант и бармен — персонал, работающий с пищей (медицинский допуск)');

console.log('Столы');
ok(/недоступна|прав/i.test(deny('vnTableSave', [S({ table: '1', seats: 2 })], w1) || ''), 'официант столы не меняет');
let d = data('vnTableSave', [S({ tables: [{ table: '1', zone: 'Основной зал', seats: 2 }, { table: '2', zone: 'Основной зал', seats: 4 }, { table: '3', zone: 'Основной зал', seats: 4 },
  { table: '4', zone: 'Основной зал', seats: 6 }, { table: '5', zone: 'Веранда', seats: 2 }, { table: '6', zone: 'Веранда', seats: 4 }] })], adm);
ok(d.tables.length === 6, 'администратор завёл 6 столов в двух залах');
ok(deny('vnTableSave', [S({ table: '7', seats: 0 })], adm), 'стол без мест не сохраняется');

console.log('Электронное меню');
d = data('vnMenuData', [], adm);
ok(d.notInMenu.length === 4 && !d.notInMenu.some(x => x.code === 'PF1'), 'блюд ТТК вне меню: 4 (п/ф не предлагается)');
ok(d.notInMenu.find(x => x.code === 'D4').station === 'Бар' && d.notInMenu.find(x => x.code === 'D1').station === 'Кухня', 'станция по категории: «Напитки» — бар, «Горячее» — кухня');
d = data('vnMenuSync', [S({ all: true })], adm); ok(d.added === 4, 'добавлено из ТТК: 4');
d = data('vnMenuSync', [S({ all: true })], adm); ok(d.added === 0, 'повторно не дублируется');
ok(deny('vnMenuSave', [S({ items: [{ code: 'D1', price: 1 }] })], w1), 'официант меню не правит');
d = data('vnMenuSave', [S({ items: [{ code: 'D1', price: 590, desc: 'Спагетти, томатный соус, пармезан', tags: 'хит' }, { code: 'D2', price: 520 }, { code: 'D3', price: 450, byWeight: true, per: 100 }, { code: 'D4', price: 290 }] })], adm);
ok(d.saved === 4, 'цены, описание, теги; стейк — по весу, 450 ₽ за 100 г');
ok(deny('vnMenuSave', [S({ items: [{ code: 'G-1', kind: 'GOODS', name: 'Шампанское Кристал', price: 1 }] })], adm), 'товар без партий на складе в меню не добавить');
d = data('vnMenuSave', [S({ items: [{ code: 'G-WINE', kind: 'GOODS', name: 'Вино Пино Нуар', section: 'Вино', station: 'Бар', price: 650, yield: 150, yieldUnit: 'мл', desc: 'Бокал 150 мл' }] })], adm);
ok(d.added === 1, 'вино по бокалу (150 мл со склада) — товар без ТТК');
ok(/распознана/.test(deny('vnMediaAdd', [S({ code: 'D1', url: 'ftp://x' })], adm) || ''), 'ссылка не https — отказ');
d = data('vnMediaAdd', [S({ code: 'D1', url: 'https://youtube.com/shorts/AbCdEf12345' })], adm);
ok(d.media[0].type === 'embed' && /youtube\.com\/embed\/AbCdEf12345\?autoplay=1&mute=1/.test(d.media[0].src), 'YouTube Shorts → плеер в ленте (автозапуск без звука)');
d = data('vnMediaAdd', [S({ code: 'D1', url: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view?usp=sharing', cover: true })], adm);
ok(d.media[0].type === 'photo' && /lh3\.googleusercontent\.com\/d\/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/.test(d.media[0].src), 'фото с Google Диска — обложкой');
d = data('vnMediaAdd', [S({ code: 'D4', url: 'https://cdn.example.com/reels/lemonade.mp4' })], adm);
ok(d.media[0].type === 'video', 'видео mp4 для Reels');
ok(deny('vnMediaAdd', [S({ code: 'D4', url: 'https://cdn.example.com/reels/lemonade.mp4' })], adm), 'то же видео второй раз не добавляется');
d = data('vnMediaRemove', [S({ code: 'D1', index: 1, cover: true })], adm); ok(d.media[0].type === 'embed' && d.media.length === 2, 'обложка изменена');
d = data('vnMediaUpload', [S({ code: 'D2', name: 'caesar.jpg', mime: 'image/jpeg', b64: Buffer.from('jpegdata').toString('base64') })], adm);
ok(d.media.length === 1 && d.media[0].type === 'photo' && d.fileId, 'фото загружено файлом в папку меню на Диске');
ok(deny('vnMediaUpload', [S({ code: 'D2', name: 'x.exe', mime: 'application/x-msdownload', b64: 'AAAA' })], adm), 'не фото и не видео — отказ');

console.log('Бронирование');
const today = g._vnToday_(), tomorrow = (d0 => { const d = new Date(d0 + 'T12:00:00'); d.setDate(d.getDate() + 1); return iso(d); })(g._vnToday_());
ok(deny('vnBookingSave', [S({ date: tomorrow, from: '19:00', guests: 2, guest: 'Иван', phone: '+79001112233', tables: ['2'] })], w1), 'официант брони не создаёт');
d = data('vnBookingSave', [S({ date: tomorrow, from: '19:00', guests: 4, guest: 'Иван Петров', phone: '+7 900 111-22-33', tables: ['2'], occasion: 'день рождения', deposit: 5000 })], host);
const b1 = d.id; ok(d.status === 'CONFIRMED', 'хостес: бронь ' + b1 + ' на завтра 19:00, стол 2, 4 гостя');
ok(/Стол занят/.test(deny('vnBookingSave', [S({ date: tomorrow, from: '20:30', guests: 2, guest: 'Анна', phone: '+79002223344', tables: ['2'] })], host) || ''), 'пересечение по столу 2 (19:00–21:00 и 20:30) — отказ');
d = data('vnBookingSave', [S({ date: tomorrow, from: '21:00', guests: 2, guest: 'Анна', phone: '+79002223344', tables: ['2'] })], host);
ok(d.status === 'CONFIRMED', 'стык 21:00 без пересечения — принят');
d = data('vnBookingSave', [S({ date: tomorrow, from: '19:00', guests: 6, guest: 'Компания', phone: '+79003334455', tables: ['3'] })], host);
ok(/Мест за столами 4, гостей 6/.test(d.seatsWarn), 'мест меньше, чем гостей, — предупреждение');
d = data('vnHallData', [S({ date: tomorrow, from: '19:30', guests: 4 })], host);
ok(d.free.every(t => ['2', '3'].indexOf(t.table) < 0) && d.free[0].fits, 'подбор свободных столов на 19:30: заняты 2 и 3, подходящие по местам — первыми');
// заявка гостя с QR-меню (без входа)
const gb = (x, did) => J(g.vnGuestBook(S(x), did));
ok(gb({ name: 'Гость', phone: '123', date: tomorrow, time: '19:00', guests: 2 }, 'g1').ok === false, 'заявка без телефона — отказ');
ok(gb({ name: 'Гость', phone: '+79005556677', date: (d0 => { const d = new Date(d0 + 'T12:00:00'); d.setDate(d.getDate() - 1); return iso(d); })(today), time: '19:00', guests: 2 }, 'g1').ok === false, 'заявка на прошедший день — отказ');
ok(gb({ name: 'Гость', phone: '+79005556677', date: tomorrow, time: '05:00', guests: 2 }, 'g1').ok === false, 'заявка вне часов работы — отказ');
let q = gb({ name: 'Елена', phone: '+7 900 555-66-77', date: tomorrow, time: '20:00', guests: 3, note: 'у окна', table: '5' }, 'g1');
ok(q.ok && /\+7 900 555-66-77/.test(q.message), 'заявка гостя принята: ' + q.message);
ok(gb({ name: 'Елена', phone: '+79005556677', date: tomorrow, time: '20:00', guests: 3 }, 'g1').id === q.id, 'повтор той же заявки не дублируется');
gb({ name: 'Елена', phone: '+79005550000', date: tomorrow, time: '21:00', guests: 3 }, 'g1');
ok(/уже отправлены/.test(gb({ name: 'Елена', phone: '+79005551111', date: tomorrow, time: '22:00', guests: 3 }, 'g1').error || ''), 'с одного устройства — не больше 3 заявок за 10 минут');
ok(gb({ name: 'робот', phone: '+79000000000', date: tomorrow, time: '19:00', guests: 2, hp: 'x' }, 'g2').id === '', 'поле-ловушка: робот получает «принято», бронь не создаётся');
const req = rows('VN_Брони').slice(1).filter(x => x[8] === 'REQUEST');
ok(req.length === 2 && /QR-меню \(стол 5\)/.test(req[0][9]), 'заявок гостя: 2, источник «QR-меню (стол 5)»');
fresh(); ok(J(g.vnHallData(S({}))).error.code === 'AUTH_REQUIRED', 'данные зала без входа — нет');
ok(deny('vnBookingStatus', [S({ id: q.id, status: 'CONFIRMED' })], host), 'подтвердить заявку без стола — отказ');
d = data('vnBookingStatus', [S({ id: q.id, status: 'CONFIRMED', tables: '5' })], host); ok(d.status === 'CONFIRMED', 'хостес подтвердила заявку гостя: стол 5');
ok(deny('vnBookingStatus', [S({ id: b1, status: 'CANCELLED' })], w1), 'официант бронь не отменяет');
ok(deny('vnBookingStatus', [S({ id: b1, status: 'NOSHOW' })], host), '«не пришли» без комментария — отказ');
d = data('vnBookingSave', [S({ date: today, from: '00:00', minutes: 1439, guests: 3, guest: 'Сергей', phone: '+79007778899', tables: ['4'] })], host);
const bToday = d.id;

console.log('Стоп/go-лист');
ok(deny('vnStopSave', [S({ code: 'D2', status: 'STOP', reason: 'x' })], w1), 'официант стоп не ставит');
ok(deny('vnStopSave', [S({ code: 'D2', status: 'STOP' })], chef), 'стоп без причины — отказ');
d = data('vnStopSave', [S({ items: [{ code: 'D2', status: 'STOP', reason: 'закончились листья романо' }, { code: 'D1', status: 'LIMIT', left: 5, reason: 'мало соуса' }, { code: 'D4', status: 'GO', reason: '' }] })], chef);
ok(d.items.length === 3, 'шеф: Цезарь — стоп, паста — лимит 5, лимонад — go');

console.log('Гости пришли → блокнот официанта');
d = data('vnBookingStatus', [S({ id: bToday, status: 'SEATED' })], w1);
const o1 = d.order.id; ok(d.status === 'SEATED' && d.order && d.order.table === '4', 'официант отметил «гости пришли» — открыт заказ стола 4 (' + o1 + ')');
d = data('vnOrderOpen', [S({ table: '4', guests: 3 })], w1); ok(d.id === o1, 'повторное открытие стола 4 — тот же заказ');
ok(/в стопе/.test(deny('vnOrderAdd', [S({ order: o1, lines: [{ code: 'D2', qty: 1 }] })], w1) || ''), 'Цезарь в стопе — в заказ не добавляется');
ok(/осталось 5/.test(deny('vnOrderAdd', [S({ order: o1, lines: [{ code: 'D1', qty: 6 }] })], w1) || ''), 'паста × 6 при лимите 5 — отказ');
ok(deny('vnOrderAdd', [S({ order: o1, lines: [{ code: 'D1', qty: 1, course: 9 }] })], w1), 'курс 9 — отказ');
d = data('vnOrderAdd', [S({ order: o1, lines: [
  { code: 'D1', qty: 2, course: 1, seat: '1', comment: 'без пармезана' },
  { code: 'D3', qty: 1, weight: 320, course: 3, seat: '2', comment: 'прожарка medium' },
  { code: 'G-WINE', qty: 2, course: 0 },
  { code: 'D4', qty: 1 }] })], w1);
const L = {}; d.lines.forEach(l => { L[l.code] = l; });
ok(L.D1.status === 'SENT' && L['G-WINE'].status === 'SENT' && L.D4.status === 'SENT' && L.D3.status === 'HOLD', 'курс 1 и «сразу» — на кухню и бар, курс 3 (стейк) ждёт команды');
ok(L.D4.course === 0 && L.D4.station === 'Бар', 'напиток без курса — «сразу», в бар');
ok(L.D3.sum === 1440 && L.D3.weight === 320, 'стейк 320 г × 450 ₽/100 г = 1440 ₽');
ok(d.sumNow === 590 * 2 + 1440 + 650 * 2 + 290, 'сумма заказа на лету: ' + d.sumNow + ' ₽');
ok(d.limits[0].left === 3, 'лимит пасты: осталось 3');
ok(/официанта Орлова|заказ официанта/.test(deny('vnOrderAdd', [S({ order: o1, lines: [{ code: 'D4', qty: 1 }] })], w2) || ''), 'другой официант в чужой заказ не пишет');

console.log('Кухня и бар');
d = data('vnQueueData', [S({ station: 'Кухня' })], cook);
const tk = d.tickets.filter(t => t.table === '4');
ok(tk.length === 2 && tk[0].state === 'cooking' && tk[0].lines[0].comment === 'без пармезана' && tk[1].state === 'held', 'очередь кухни: стол 4 — курс 1 готовится (с комментарием), курс 3 ждёт команды');
ok(!d.tickets.some(t => t.lines.some(l => /Вино|Лимонад/.test(l.name))), 'напитки на кухню не попадают');
d = data('vnQueueData', [S({ station: 'Бар' })], bar);
ok(d.tickets.length === 1 && d.tickets[0].lines.length === 2, 'очередь бара: вино и лимонад');
ok(deny('vnQueueData', [S({ station: 'Бар' })], cook), 'повар очередь бара не видит');
ok(/бармен/.test(deny('vnLineStatus', [S({ ids: [L['G-WINE'].id], status: 'READY' })], cook) || ''), 'повар «готово» по бару не отмечает');
ok(/повар/.test(deny('vnLineStatus', [S({ ids: [L.D1.id], status: 'READY' })], bar) || ''), 'бармен «готово» по кухне не отмечает');
d = data('vnLineStatus', [S({ ids: [L['G-WINE'].id, L.D4.id], status: 'READY' })], bar); ok(d.count === 2, 'бармен: напитки готовы');
d = data('vnLineStatus', [S({ ids: [L.D1.id], status: 'READY' })], cook); ok(d.count === 1, 'повар: паста готова');
ok(deny('vnLineStatus', [S({ ids: [L.D3.id], status: 'READY' })], cook), 'стейк (курс не подан) готовым не отмечается');

console.log('Моя смена по зонам');
d = data('vnShiftData', [S({ zone: 'hall' })], w1);
ok(d.zone === 'hall' && d.zones.length === 1 && d.toServe.length === 3 && d.summary.held === 1, 'официант: зона «Зал»; подать сейчас — 3 позиции, курс ждёт — 1 стол');
d = data('vnShiftData', [S({ zone: 'kitchen' })], cook); ok(d.zone === 'kitchen' && d.zones.map(z => z.id).join() === 'kitchen', 'повар: только «Кухня»');
d = data('vnShiftData', [S({})], bar); ok(d.zones.map(z => z.id).join() === 'hall,bar', 'бармен: «Зал» и «Бар»');
d = data('vnShiftData', [S({ zone: 'bar' })], bar); ok(d.zone === 'bar' && d.summary.ready === 1, 'бармен в зоне «Бар»: готово, ждёт официанта — 1 заказ');
d = data('vnShiftData', [S({})], host); ok(d.zone === 'hall' && d.can.orders === false && d.orders.length === 0, 'хостес: зал без заказов');
ok(/нет смены/.test(deny('vnShiftData', [S({})], dir) || '') === false, 'директор видит зоны (полный доступ)');

console.log('Подача и курсы');
d = data('vnLineStatus', [S({ ids: [L.D1.id, L['G-WINE'].id, L.D4.id], status: 'SERVED' })], w1); ok(d.orders[0].counts.served === 3, 'официант: подано 3 позиции');
ok(deny('vnOrderFire', [S({ order: o1, course: 2 })], w1), 'курс 2 пуст — отказ');
d = data('vnOrderFire', [S({ order: o1, course: 3 })], w1); ok(d.fired === 1 && d.nextCourse === null, 'подан курс 3 — стейк ушёл на кухню');
data('vnLineStatus', [S({ ids: [L.D3.id], status: 'READY' })], cook);
data('vnLineStatus', [S({ ids: [L.D3.id], status: 'SERVED' })], w1);
d = data('vnOrderAdd', [S({ order: o1, lines: [{ code: 'D4', qty: 1, course: 4 }] })], w1);
const late = d.lines.filter(l => l.course === 4)[0];
ok(late.status === 'HOLD', 'добавлен десертный курс 4 (ждёт)');
ok(/Причина/.test(deny('vnLineStatus', [S({ ids: [late.id], status: 'VOID' })], w1) || ''), 'отмена без причины — отказ');
ok(/администратор/.test(deny('vnLineStatus', [S({ ids: [L.D1.id], status: 'VOID', reason: 'не понравилось' })], w1) || ''), 'поданную позицию официант не отменяет');
d = data('vnLineStatus', [S({ ids: [late.id], status: 'VOID', reason: 'гость передумал' })], w1); ok(d.orders[0].counts.void === 1, 'неподанный курс отменён с причиной');

console.log('Закрытие счёта → продажи MON CHEF');
const j36Before = Math.max(1, rows('Ж_Продажи').length), spag0 = stockOf('Спагетти'), beef0 = stockOf('Говядина рибай'), wine0 = stockOf('Вино Пино Нуар'), lemon0 = stockOf('Лимон');
ok(/скидку даёт администратор/.test(deny('vnOrderClose', [S({ order: o1, payment: 'CARD', discountPct: 10 })], w1) || ''), 'скидка от официанта — отказ');
ok(/способ оплаты/.test(deny('vnOrderClose', [S({ order: o1, payment: 'BTC' })], w1) || ''), 'неизвестная оплата — отказ');
d = data('vnOrderClose', [S({ order: o1, payment: 'CARD', check: '0457' })], w1);
ok(d.sales.length === 4 && d.errors.length === 0, 'счёт закрыт: 4 продажи (отменённая не проводится), ошибок нет');
ok(d.total === 590 * 2 + 1440 + 650 * 2 + 290 && d.cost > 0, 'к оплате ' + d.total + ' ₽, себестоимость по партиям ' + d.cost + ' ₽');
const j36 = rows('Ж_Продажи'); ok(j36.length - j36Before === 4, 'журнал продаж J36: +4 строки');
const h36 = j36[0], last = j36.slice(-4);
ok(last.every(x => x[h36.indexOf('ФИО продавца')] === 'Орлова Мария'), 'продавец в J36 — официант стола');
ok(Math.abs((spag0 - stockOf('Спагетти')) - 200) < 1e-6, 'спагетти: списано 2 × 100 г по ТТК');
ok(Math.abs((beef0 - stockOf('Говядина рибай')) - 350 * 320 / 300) < 0.5, 'рибай по весу: 320 г выхода → ' + (350 * 320 / 300).toFixed(1) + ' г сырья');
ok(Math.abs((wine0 - stockOf('Вино Пино Нуар')) - 300) < 1e-6, 'вино: 2 бокала × 150 мл = 300 мл с партии');
ok(Math.abs((lemon0 - stockOf('Лимон')) - 50) < 1e-6, 'лимонад: лимон 50 г по ТТК');
ok(rows('Продажи_Списание_V71').length - 1 >= 4, 'лист списаний V71: продажи связаны с партиями');
const ordRow = rows('VN_Заказы').find(x => x[0] === o1); ok(ordRow[7] === 'CLOSED' && ordRow[14] === 'CARD', 'заказ закрыт, оплата — карта');
ok(rows('VN_Брони').find(x => x[0] === bToday)[8] === 'DONE', 'бронь стола завершена');
ok(deny('vnOrderClose', [S({ order: o1, payment: 'CARD' })], w1), 'повторное закрытие — отказ');

console.log('Лимит кончился → стоп');
d = data('vnOrderOpen', [S({ table: '1', guests: 2 })], w2); const o2 = d.id;
d = data('vnOrderAdd', [S({ order: o2, lines: [{ code: 'D1', qty: 3 }] })], w2);
ok(d.limits[0].left === 0 && d.limits[0].stopped, 'паста × 3 — лимит 0, позиция ушла в стоп сама');
ok(/в стопе/.test(deny('vnOrderAdd', [S({ order: o2, lines: [{ code: 'D1', qty: 1 }] })], w2) || ''), 'следующая паста — в стопе');
d = data('vnOrderClose', [S({ order: o2, payment: 'CASH' })], w2); ok(d.needForce && d.notServed.length === 1, 'не подано — закрытие спрашивает подтверждение');
ok(deny('vnOrderCancel', [S({ order: o2, reason: 'x' })], w2), 'официант заказ целиком не отменяет');
ok(deny('vnOrderCancel', [S({ order: o2 })], adm), 'отмена заказа без причины — отказ');
d = data('vnOrderCancel', [S({ order: o2, reason: 'ошиблись столом' })], adm); ok(d.voided === 1, 'администратор отменил заказ с причиной');

console.log('Предложения по складу');
data('vnStopClear', [S({ codes: ['D4'] })], chef);
d = data('vnStopSuggest', [], chef);
const sD3 = d.stop.find(x => x.code === 'D3');
ok(sD3 && sD3.status === 'LIMIT' && sD3.left === 4, 'рибай: по складу хватит на 4 порции — лимит 4');
ok(d.go.some(x => x.code === 'D4' && /Лимон/.test(x.reason)), 'go: лимонад — лимон с подходящим сроком');
ok(!d.stop.some(x => x.code === 'D1' || x.code === 'D2'), 'то, что уже в стопе, не предлагается');

console.log('Меню гостя');
let gd = g._vnGuestData_('5');
ok(gd.table === '5' && gd.items.length === 5 && gd.sections.length >= 3, 'страница гостя: стол 5, позиций 5, разделов ' + gd.sections.length);
const gi = c => gd.items.find(i => i.c === c);
ok(gi('D2').out && gi('D1').out && !gi('D3').out, 'Цезарь и паста — «нет в наличии»');
ok(gi('D3').bw && gi('D3').per === 100 && gi('G-WINE').y === 150, 'стейк по весу (за 100 г), вино — бокал 150 мл');
ok(gi('D1').md.length === 2 && gi('D4').md[0].type === 'video', 'фото и видео в ленте');
ok(!/cost|себесто|batch|партия|waiter|Орлова/i.test(S(gd)), 'гостю не передаются себестоимость, партии, сотрудники');
ok(g._vnGuestData_('99').table === '', 'несуществующий стол в QR не показывается');
data('vnSettings', [S({ hideStop: true, phone: '+7 (343) 000-00-00', name: 'VINOVNIK' })], adm);
gd = g._vnGuestData_(''); ok(!gd.items.some(i => i.c === 'D2') && gd.phone === '+7 (343) 000-00-00', 'настройка «скрывать стоп»: позиций в стопе у гостя нет');
data('vnMenuSave', [S({ items: [{ code: 'D3', guest: false }] })], adm);
ok(!g._vnGuestData_('').items.some(i => i.c === 'D3'), 'позиция «не показывать гостям» скрыта');

console.log('Разделы и главная');
const ui = (t, sec) => g.uiData(t, sec, {});
let u = ui(adm, 'hall'); ok(u.ok !== false && u.kpis.some(k => /Выручка зала/.test(k.label)) && u.actions.some(a => a.module === 'vnbook'), 'администратор: раздел «Зал» с выручкой и бронированием');
u = ui(w1, 'hall'); ok(u.ok !== false && !u.kpis.some(k => /Выручка/.test(k.label)) && u.actions.some(a => a.module === 'vnorder'), 'официант: «Зал» без выручки, с блокнотом');
u = ui(cook, 'hall'); ok(u.forbidden, 'повар: раздела «Зал» нет');
u = ui(w1, 'home'); ok(u.kpis[0].label === 'Зал: мои столы', 'главная официанта: первая плитка — «Зал: мои столы»');
u = ui(cook, 'home'); ok(u.kpis.some(k => /Кухня: заказы/.test(k.label)), 'главная повара: «Кухня: заказы»');
u = ui(host, 'home'); ok(u.kpis[0].label === 'Брони: заявки гостей', 'главная хостес: заявки гостей');
ok(g.UI_SECTIONS.indexOf('hall') === 1 && g.MC_UI_VIEWS_.indexOf('vnorder') >= 0, 'раздел «Зал» — второй; экраны зала открываются по адресу');

console.log('Журнал аудита');
const au = rows('Audit_Log');
const acts = au.map(x => x.join('|')).join('\n');
ok(/VN_ORDER_CLOSE/.test(acts) && /VN_BOOKING/.test(acts) && /VN_STOP/.test(acts) && /VN_GUEST_BOOK/.test(acts), 'в аудите: брони, заявка гостя, стоп-лист, закрытие счёта');

console.log('\nVINOVNIK: проверок пройдено ' + passed);
module.exports = { g, env, tokens: { chef, dir, adm, cook, w1, w2, bar, host } };
