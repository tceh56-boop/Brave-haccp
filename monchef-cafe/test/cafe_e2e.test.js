/**
 * Сквозной сценарий MON CHEF · Кафе на мок-окружении Google (node test/cafe_e2e.test.js).
 * Вход по ПИН → приход сырья → изготовление п/ф → прайс → продажи по позициям (списание по ТТК/FEFO,
 * журнал J36, история партий, прослеживаемость, расхождения) → задачи по остаткам → нормы → сторно →
 * статьи и расходы → P&L → аудит → разделы интерфейса → права ролей.
 */
'use strict';
const path = require('path'), assert = require('assert');
const { load } = require('./gas_mock');
const env = load(path.join(__dirname, '..', 'app'));
const g = env.ctx, book = env.book;
let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); }
function J(x) { return typeof x === 'string' ? JSON.parse(x) : x; }
function data(x, what) { const r = J(x); if (!(r && (r.success === true || r.ok === true))) throw new Error((what || '') + ': ' + JSON.stringify(r).slice(0, 600)); return r.data !== undefined ? r.data : r; }
function rows(name) { const sh = book.getSheetByName(name); return sh ? sh.getDataRange().getValues() : []; }
function hdr(name) { return rows(name)[0] || []; }
function col(name, c) { const h = hdr(name), i = h.indexOf(c); assert.ok(i >= 0, 'колонка ' + c + ' в ' + name); return rows(name).slice(1).map(r => r[i]); }
const day = (off) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + off); return d; };
const ru = d => String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear();

/* ---------- данные предприятия ---------- */
function sheet(name, head, data) { const sh = book.getSheetByName(name) || book.insertSheet(name); sh.clear(); sh.appendRow(head); (data || []).forEach(r => sh.appendRow(r)); return sh; }
const empHead = ['Фамилия', 'Имя', 'Отчество', 'Должность', 'Роль', 'Дата рождения', 'Телефон', 'Адрес', 'ПИН-код', 'Сан. книжка №', 'Срок сан. книжки', 'Посл. мед. осмотр', 'Активен', 'Цвет', 'Ставка/час', 'Создан'];
sheet('Сотрудники', empHead, [
  ['Иванова', 'Анна', 'Петровна', 'Шеф-повар', 'Шеф-повар', '', '', '', '1111', 'СК-1', day(300), day(-30), true, '', '', new Date()],
  ['Петров', 'Олег', 'Иванович', 'Директор', 'Директор', '', '', '', '2222', 'СК-2', day(300), day(-30), true, '', '', new Date()],
  ['Смирнова', 'Ольга', '', 'Администратор', 'Администратор', '', '', '', '3333', 'СК-3', day(300), day(-30), true, '', '', new Date()],
  ['Кузнецов', 'Илья', '', 'Повар горячего цеха', 'Повар горячего цеха', '', '', '', '4444', 'СК-4', day(300), day(-30), true, '', '', new Date()]
]);
sheet('Блюда', ['Код', 'Название', 'Категория', 'Выход', 'Кол-во ингр.', 'Технология', 'Файл', 'Заготовка (JSON)', 'Цех', 'Подгруппа', 'Время приготовления, мин', 'Выход, г/мл/шт', 'Ед. выхода', 'Порций в карточке', 'Папка ТТК', 'ID папки'], [
  ['PF1', 'Соус томатный п/ф', 'Заготовки', 1000, 2, 'Томаты протереть, уварить с маслом', '', '', 'Горячий цех', '', 40, 1000, 'г', 1, '', ''],
  ['D1', 'Паста с томатным соусом', 'Горячее', 250, 3, 'Отварить пасту, соединить с соусом', '', '', 'Горячий цех', '', 12, 250, 'г', 1, '', ''],
  ['D2', 'Салат Цезарь', 'Салаты', 220, 0, '', '', '', 'Холодный цех', '', 10, 220, 'г', 1, '', '']
]);
sheet('Состав', ['Код', 'Ингредиент', 'Ед. изм.', 'Брутто (ориг.)', 'Брутто, г/мл', 'Нетто, г/мл/шт', 'Выход, г/мл/шт', 'Ед.', 'Нетто на 1 порцию', 'ProductID', 'ТТК п/ф'], [
  ['PF1', 'Томаты', 'г', 1200, 1200, 1000, 1000, 'г', '', '', ''],
  ['PF1', 'Масло оливковое', 'мл', 50, 50, 50, 50, 'мл', '', '', ''],
  ['D1', 'Спагетти', 'г', 100, 100, 100, 100, 'г', '', '', ''],
  ['D1', 'Соус томатный п/ф', 'г', 120, 120, 120, 120, 'г', '', '', 'PF1'],
  ['D1', 'Сыр пармезан', 'г', 20, 20, 20, 20, 'г', '', '', '']
]);

console.log('Вход по ПИН');
const login = pin => { const r = J(g.loginWithPin(pin, 'dev-test-' + pin)); if (!r.ok) throw new Error('вход ' + pin + ': ' + JSON.stringify(r)); return r.token; };
const chef = login('1111'), dir = login('2222'), adm = login('3333'), cook = login('4444');
ok(chef && dir && adm && cook, 'шеф, директор, администратор и повар вошли');

console.log('Приход сырья (партии) и изготовление п/ф');
g.PropertiesService.getScriptProperties().setProperty('MC_BC_INCOMING', 'off');
let r = J(g.stockAddIncome(JSON.stringify([
  { name: 'Томаты', qty: 5, unit: 'кг', price: 200, expiry: ru(day(5)) },
  { name: 'Масло оливковое', qty: 1, unit: 'л', price: 900, expiry: ru(day(200)) },
  { name: 'Спагетти', qty: 3, unit: 'кг', price: 150, expiry: ru(day(300)) },
  { name: 'Сыр пармезан', qty: 500, unit: 'г', price: 2.5, expiry: ru(day(1)) },
  { name: 'Вода питьевая 0,5', qty: 24, unit: 'шт', price: 30, expiry: ru(day(300)) },
  { name: 'Базилик свежий', qty: 200, unit: 'г', price: 1.2, expiry: ru(day(1)) },
  { name: 'Сливки 33%', qty: 1, unit: 'л', price: 400, expiry: ru(day(-1)) }
]), 'ООО Поставщик, накладная 15', '', chef));
ok(r.ok, 'приход проведён: ' + (r.batchIds || []).length + ' партий');
const bst = col('Склад_Партии', 'Статус'); ok(bst.length >= 5, 'партии созданы, статусы: ' + bst.join(','));
// входной контроль может ставить партии в карантин — допускаем их (как кладовщик после контроля)
(function admit() { const sh = book.getSheetByName('Склад_Партии'); const v = sh.getDataRange().getValues(); for (let i = 1; i < v.length; i++) if (v[i][10] !== 'active') sh.getRange(i + 1, 11).setValue('active'); })();
r = J(g.stockAddSemiProduct('Соус томатный п/ф', 1000, 'г', 0, 'заготовка', ru(day(2)), chef));
ok(r.ok || r.batchId || r.success, 'п/ф изготовлен (сырьё списано по ТТК): ' + JSON.stringify(r).slice(0, 160));
(function admit() { const sh = book.getSheetByName('Склад_Партии'); const v = sh.getDataRange().getValues(); for (let i = 1; i < v.length; i++) if (v[i][10] !== 'active' && v[i][10] !== 'consumed') sh.getRange(i + 1, 11).setValue('active'); })();
const pfBatch = rows('Склад_Партии').slice(1).find(x => /Соус томатный/.test(x[1]));
ok(pfBatch && Number(pfBatch[9]) === 1000, 'партия п/ф 1000 г на складе');

console.log('Прайс');
let d = data(g.mcCafePriceSave(JSON.stringify({ items: [{ code: 'D1', price: 450, active: true }, { code: 'D2', price: 390, active: true }, { code: 'PF1', price: 1 }] }), chef), 'прайс');
ok(d.changed === 2, 'в прайсе 2 позиции (п/ф в прайс не попадает)');
d = data(g.mcCafeData(JSON.stringify({ withCost: true }), chef), 'данные продаж');
const d1 = d.menu.find(x => x.code === 'D1');
ok(d1 && d1.price === 450 && d1.cost > 0, 'себестоимость порции пасты по ТТК: ' + d1.cost + ' ₽, food cost ' + d1.fc + ' %');
ok(!d.menu.some(x => x.code === 'PF1'), 'п/ф не продаётся как блюдо');

console.log('Продажа по позициям');
const spagBefore = rows('Склад_Партии').slice(1).filter(x => x[1] === 'Спагетти').reduce((a, x) => a + Number(x[9]), 0);
d = data(g.mcCafeSalePost(JSON.stringify({ payment: 'CARD', check: '101', lines: [
  { kind: 'dish', code: 'D1', qty: 4 }, { kind: 'dish', code: 'D2', qty: 1 }, { kind: 'product', name: 'Вода питьевая 0,5', qty: 2, unit: 'шт', price: 80 }, { kind: 'dish', code: 'D1', qty: '' }] }), chef), 'продажа');
ok(d.lines.length === 3 && d.sum === 450 * 4 + 390 + 160, 'документ ' + d.docId + ': 3 позиции на ' + d.sum + ' ₽ (пустые строки пропущены)');
ok(d.cost > 0 && d.shortages.length === 0, 'себестоимость ' + d.cost + ' ₽, нехватки нет');
ok(d.noTtk.indexOf('Салат Цезарь') >= 0, 'блюдо без состава ТТК отмечено');
const spagAfter = rows('Склад_Партии').slice(1).filter(x => x[1] === 'Спагетти').reduce((a, x) => a + Number(x[9]), 0);
ok(Math.abs((spagBefore - spagAfter) - 400) < 1e-6, 'спагетти списаны с партии по ТТК: 4 × 100 г = 400 г (партии — в базовых единицах)');
const pfNow = rows('Склад_Партии').slice(1).find(x => /Соус томатный/.test(x[1]));
ok(Math.abs(Number(pfNow[9]) - (1000 - 480)) < 1e-6, 'соус взят с готовой партии п/ф (FEFO): осталось ' + pfNow[9] + ' г');
const tomOps = rows('Склад_Операции').slice(1).filter(x => x[3] === 'Томаты' && /^Продажа/.test(String(x[8])));
ok(tomOps.length === 0, 'томаты продажей не тронуты: п/ф был готов, раскладка до сырья не понадобилась');
const water = rows('Склад_Партии').slice(1).find(x => /Вода/.test(x[1]));
ok(Number(water[9]) === 22, 'товар со склада (вода) списан поштучно: осталось 22');
const ev = rows('Партии_События').slice(1).filter(x => x[3] === 'SALE_USE');
ok(ev.length >= 4, 'история партий: событий «Продажа» ' + ev.length + ' (цепочка хешей)');
ok(g._mcBlChainOk_().ok !== false, 'цепочка истории партий цела');
const tl = rows('TRACE_LINKS').slice(1).filter(x => x[4] === 'SALE');
ok(tl.length >= 4, 'прослеживаемость «партия → продажа»: ' + tl.length + ' связей');
const tr = J(g.getBatchTraceability(String(pfNow[0]), chef));
ok(tr && tr.ok !== false && JSON.stringify(tr).indexOf(d.docId) >= 0, 'карточка партии п/ф показывает продажу ' + d.docId);
const j36 = rows('Ж_Продажи');
ok(j36.length - 1 === 3 && j36.slice(1).every(x => /кафе · ПР-/.test(x.join('|'))), 'журнал продаж J36: 3 строки с источником «кафе»');
const ops = rows('Склад_Операции').slice(1).filter(x => /^Продажа ПР-/.test(String(x[8])));
ok(ops.length >= 4 && ops.every(x => x[2] === 'Расход'), 'журнал склада: расход по продаже (' + ops.length + ' операций)');

console.log('Продажа сверх остатка → расхождение');
d = data(g.mcCafeSalePost(JSON.stringify({ payment: 'CASH', lines: [{ kind: 'dish', code: 'D1', qty: 40 }] }), adm), 'продажа 2');
ok(d.shortages.length > 0 && d.shortSum > 0, 'продажа проведена, нехватка записана: ' + d.shortages.map(x => x.product + ' ' + x.qty + ' ' + x.unit).join('; '));
ok(rows('Кафе_Расхождения').length - 1 === d.shortages.length, 'расхождения в листе «Кафе_Расхождения»');
const pfLeft = rows('Склад_Партии').slice(1).filter(x => /Соус томатный/.test(x[1])).reduce((a, x) => a + Number(x[9]), 0);
ok(pfLeft === 0, 'п/ф израсходован полностью, отрицательных остатков в партиях нет');

console.log('Задачи по остаткам');
let t = data(g.mcCafeTasksRebuild(chef), 'задачи');
const tasks = () => { const h = hdr('Задачи_Единый_V44'); return rows('Задачи_Единый_V44').slice(1).map(x => { const o = {}; h.forEach((k, i) => o[k] = x[i]); return o; }).filter(x => x.SourceType === 'CAFE_STOCK'); };
let open = tasks().filter(x => x.Status !== 'DONE');
ok(open.some(x => /^Приготовить п\/ф: Соус томатный/.test(x.Title)), 'задача «Приготовить п/ф: Соус томатный» — ' + (open.find(x => /^Приготовить/.test(x.Title)) || {}).Title);
ok(open.some(x => /^Использовать в первую очередь: Базилик свежий/.test(x.Title)), 'задача FEFO: базилик истекает завтра');
ok(open.some(x => /^Списать просроченную партию: Сливки/.test(x.Title)), 'задача: списать просроченные сливки');
const pfTask = open.find(x => /^Приготовить п\/ф/.test(x.Title));
ok(pfTask.Priority === 'CRITICAL' && /не хватает|Сырья не хватает|Остаток/.test(pfTask.Description), 'п/ф нет в наличии → критический приоритет; описание: ' + pfTask.Description.slice(0, 140));
t = data(g.mcCafeTasksRebuild(chef), 'задачи 2');
ok(t.created === 0 && tasks().filter(x => x.Status !== 'DONE').length === open.length, 'повторный пересчёт не плодит задачи (новых 0)');
const tdata = J(g.mcTaskData(JSON.stringify({ status: 'open' }), chef));
ok(tdata.success && tdata.data.tasks.some(x => x.source === 'остатки'), 'задачи видны в едином экране «Задачи» с источником «остатки»');
// повар делает соус → задача закрывается сама
r = J(g.stockAddSemiProduct('Соус томатный п/ф', 2000, 'г', 0, '', ru(day(2)), chef));
(function admit() { const sh = book.getSheetByName('Склад_Партии'); const v = sh.getDataRange().getValues(); for (let i = 1; i < v.length; i++) if (v[i][10] !== 'active' && v[i][10] !== 'consumed') sh.getRange(i + 1, 11).setValue('active'); })();
t = data(g.mcCafeTasksRebuild(chef), 'задачи 3');
ok(tasks().find(x => x.TaskID === pfTask.TaskID).Status === 'DONE', 'после изготовления п/ф задача закрыта системой (закрыто ' + t.closed + ')');

console.log('Нормы и план');
d = data(g.mcCafeNormSave(JSON.stringify({ name: 'Спагетти', type: 'Сырьё', unit: 'кг', min: 5, target: 10 }), chef), 'норма');
ok(d.mode === 'вручную', 'норма спагетти задана вручную');
open = tasks().filter(x => x.Status !== 'DONE');
ok(open.some(x => /^Закупить: Спагетти/.test(x.Title)), 'задача «Закупить: Спагетти» — ' + (open.find(x => /^Закупить: Спагетти/.test(x.Title)) || {}).Title);
d = data(g.mcCafePlanData(chef), 'план');
ok(d.items.some(x => x.name === 'Спагетти' && x.mode === 'вручную' && x.min.qty === 5 && x.min.unit === 'кг' && x.status === 'нет в наличии'), 'экран норм: спагетти — норма вручную 5 кг, нет в наличии');
ok(Array.isArray(d.forecast) && d.forecast.length === 0, 'прогноз строится по прошлым дням (сегодняшние продажи не входят)');
d = data(g.mcCafeNormSave(JSON.stringify({ name: 'Спагетти', unit: 'кг', clear: true }), chef), 'норма авто');
ok(d.mode === 'авто', 'норма возвращена в авто');

console.log('Сторно');
const sid = rows('Кафе_Продажи').slice(1).find(x => x[8] === 'Салат Цезарь')[0];
let cr = J(g.mcCafeSaleCancel(sid, '', chef));
ok(cr.success === false, 'сторно без причины не проходит');
d = data(g.mcCafeSaleCancel(sid, 'ошибка ввода', chef), 'сторно');
ok(rows('Кафе_Продажи').slice(1).find(x => x[0] === sid)[19] === 'CANCELLED', 'продажа ' + sid + ' — сторно');

console.log('Экономика');
d = data(g.mcCafeEconData(JSON.stringify({}), dir), 'экономика');
ok(d.articles.length >= 20, 'статьи расходов заведены по умолчанию: ' + d.articles.length);
ok(J(g.mcCafeArticleSave(JSON.stringify({ code: 'RENT', name: 'Аренда помещения', group: 'Помещение', type: 'постоянные', plan: 90000 }), dir)).success, 'план аренды 90 000 ₽/мес');
let ex = data(g.mcCafeExpenseAdd(JSON.stringify({ code: 'RENT', sum: 90000, doc: 'счёт 12', counterparty: 'ИП Арендодатель' }), dir), 'расход');
ok(/^РХ-/.test(ex.id), 'расход записан ' + ex.id);
ex = data(g.mcCafeExpenseAdd(JSON.stringify({ code: 'PACK', sum: 3500 }), dir), 'расход 2');
ok(ex.noDoc, 'расход без документа отмечен');
ok(J(g.mcCafeExpenseAdd(JSON.stringify({ code: 'OTHER', sum: 10 }), dir)).success === false, '«Прочие» без пояснения не проходят');
const ex3 = data(g.mcCafeExpenseAdd(JSON.stringify({ code: 'MKT', sum: 777, doc: 'чек 1' }), dir), 'расход 3');
ok(data(g.mcCafeExpenseCancel(ex3.id, 'внесено дважды', dir), 'сторно расхода').id === ex3.id, 'сторно расхода');
d = data(g.mcCafeEconData(JSON.stringify({}), dir), 'P&L');
const p = d.pnl;
ok(p.revenue === 450 * 4 + 160 + 450 * 40, 'выручка без сторно: ' + p.revenue + ' ₽');
ok(p.opex === 93500 && p.cogs > 0 && Math.abs(p.gross - (p.revenue - p.cogs)) < 0.02, 'расходы 93 500 ₽ (сторно не в счёт), валовая ' + p.gross + ' ₽, food cost ' + p.foodCost + ' %');
ok(Math.abs(p.operating - (p.gross - p.lossCancel - p.writeOffs.total - p.opex)) < 0.05 && p.operating < 0, 'операционная прибыль = валовая − сторно − списания − расходы: ' + p.operating + ' ₽');
ok(p.menu.length === 2 && p.menu[0].abc === 'A' && p.menu.every(x => x.cls && x.abc), 'меню-инжиниринг и ABC (сторно не в счёт): ' + p.menu.map(x => x.name + ' — ' + x.cls + '/' + x.abc).join('; '));
ok(p.planVsFact.some(x => x.code === 'RENT' && x.fact === 90000), 'план-факт по аренде');
ok(Array.isArray(p.lines) && p.lines[0].line === 'Выручка', 'строки отчёта P&L');
ok(J(g.mcCafeExpenseAdd(JSON.stringify({ code: 'RENT', sum: 1 }), chef)).success === false, 'шеф-повар не вносит расходы (нет права «Экономика»)');

console.log('Аудит предприятия');
data(g.mcCafeSalePost(JSON.stringify({ payment: 'SBP', lines: [{ kind: 'dish', code: 'D2', qty: 2 }] }), adm), 'салат');
d = data(g.mcCafeAuditRun(JSON.stringify({ days: 30, tasks: true }), dir), 'аудит');
ok(d.score >= 0 && d.score <= 100 && d.areas.length === 6, 'балл ' + d.score + ' (' + d.grade + '), разделов 6');
const codes = d.findings.map(f => f.code);
d.findings.forEach(f => console.log('     · [' + f.sevRu + '] ' + f.area + ': ' + f.title + (f.sum !== null ? ' (' + f.sum + ' ₽)' : '')));
ok(!codes.includes('SALES_GAPS'), 'дни до первой продажи не считаются «днями без продаж»');
['SALES_SHORTAGE', 'MENU_NO_TTK', 'LOSS', 'OPEX_NO_DOC', 'BATCH_EXPIRED'].forEach(c => ok(codes.indexOf(c) >= 0, 'находка ' + c + ': ' + (d.findings.find(f => f.code === c) || {}).title));
ok(d.tasks > 0 && rows('Задачи_Единый_V44').slice(1).some(x => x[1] === 'CAFE_AUDIT'), 'задачи по критичным и высоким находкам: ' + d.tasks);
d = data(g.mcCafeAuditData(dir), 'аудит данные');
ok(d.last && d.history.length === 1, 'история аудита сохранена');
d = data(g.mcCafeGapResolve(JSON.stringify({ ids: rows('Кафе_Расхождения').slice(1).map(x => x[0]), decision: 'SHORTAGE', comment: 'недостача' }), chef), 'расхождения');
ok(d.resolved > 0, 'расхождения разобраны: ' + d.resolved);

console.log('Разделы интерфейса');
['home', 'cafesales', 'cafeplan', 'economics', 'entaudit', 'stock', 'menu'].forEach(sec => {
  const u = g.uiData(dir, sec, {});
  ok(u.ok, 'раздел «' + sec + '» (директор): ' + (u.ok ? u.title + ', плиток ' + (u.kpis || []).length : u.error));
});
const home = g.uiData(chef, 'home', {});
ok(home.ok && !home.kpis.some(k => k.label === 'Банкеты') && home.kpis.some(k => k.label === 'Выручка сегодня'), 'главная: без банкетов, с выручкой и задачами по остаткам');
ok(g.uiData(cook, 'economics', {}).forbidden, 'повар не видит экономику (403)');
const meCook = g.uiMe(cook), meAdm = g.uiMe(adm), meDir = g.uiMe(dir);
ok(meCook.sections.indexOf('cafeplan') >= 0 && meCook.sections.indexOf('cafesales') < 0, 'повар видит «План по остаткам», не видит продажи');
ok(meAdm.sections.indexOf('cafesales') >= 0 && meAdm.modules.cafesale, 'администратор вводит продажи');
ok(meDir.sections.indexOf('economics') >= 0 && meDir.sections.indexOf('entaudit') >= 0 && meDir.modules.cafeexpenses, 'директор: экономика и аудит');
ok(J(g.mcCafeSalePost(JSON.stringify({ lines: [{ kind: 'dish', code: 'D1', qty: 1 }] }), cook)).success === false, 'повар не проводит продажи (403)');

console.log('Расписание');
const auditTasks = rows('Задачи_Единый_V44').slice(1).filter(x => x[1] === 'CAFE_AUDIT').length;
data(g.mcCafeAuditRun(JSON.stringify({ days: 30, tasks: true }), dir), 'аудит 2');
ok(rows('Задачи_Единый_V44').slice(1).filter(x => x[1] === 'CAFE_AUDIT').length === auditTasks, 'повторный аудит в ту же неделю не размножает задачи');
g._MC_GATE_DEPTH = 1;   // вызов из диспетчера расписания (monChefHourlyTick) — вложенный, шлюз уже пройден
const auto = g.cafeAutoTasksSystem();
ok(auto && typeof auto.open === 'number', 'ежечасный пересчёт задач по расписанию');
const wk = g.cafeAutoAuditSystem();
ok(wk && wk.runId, 'еженедельный аудит по расписанию: балл ' + wk.score);
g._MC_GATE_DEPTH = 0;
ok(J(g.cafeAutoTasksSystem()).success === false, 'из браузера без сессии функция расписания недоступна');
ok(g.MC_SCHEDULE.some(x => x.fn === 'cafeAutoTasksSystem') && g.MC_GATE_TRIGGER_.indexOf('cafeAutoAuditSystem') >= 0, 'задачи кафе в едином планировщике');

console.log('\nВсе проверки пройдены: ' + passed);

module.exports = { env, g, book, tokens: { chef, dir, adm, cook } };
