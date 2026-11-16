// Формы первичных документов общепита (ОП-1…ОП-25, с форматами листов): реквизиты и цены подставляются сами,
// логотипов и названий сторонних организаций в формах нет.
// Запуск: node tests/op_forms.test.js
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert'), { make } = require('./gas_mock');
const root = path.join(__dirname, '..'), G = make('kitchen@example.com');
const S = {}; const mk = n => { const s = { data: [], getName: () => n, getLastRow: () => s.data.length, setFrozenRows() {}, appendRow(r) { s.data.push(r.slice()); },
  getRange(r, c, nr = 1, nc = 1) { return { setValues(v) { v.forEach((row, i) => { s.data[r - 1 + i] = s.data[r - 1 + i] || []; row.forEach((x, j) => { s.data[r - 1 + i][c - 1 + j] = x; }); }); return this; },
    getValues() { const o = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(((s.data[r - 1 + i] || [])[c - 1 + j]) ?? ''); o.push(row); } return o; }, setFontWeight() { return this; } }; },
  getDataRange() { const w = Math.max(1, ...s.data.map(r => r.length)); return s.getRange(1, 1, Math.max(1, s.data.length), w); } }; return s; };
const book = { getSheetByName: n => S[n] || null, insertSheet: n => (S[n] = mk(n)) };
const sheet = (n, rows) => { const s = book.insertSheet(n); rows.forEach(r => s.appendRow(r)); return s; };
const pdfs = [];
let session = { name: 'Иванова Ольга', fullName: 'Иванова Ольга Петровна' };
Object.assign(G, {
  _book_: () => book, _mcTz_: () => 'Europe/Moscow', _withLock_: f => f(),
  _ok_: d => JSON.stringify({ success: true, data: d }), _fail_: (c, m) => JSON.stringify({ success: false, error: { code: c, message: m } }),
  _failFrom_: e => JSON.stringify({ success: false, error: { message: String(e.stack || e.message || e) } }), _requireAuth_: () => session,
  _beginOp_: () => ({ id: 'OP', session }), _endOp_: () => {}, _audit_: () => {}, _ts2Audit_: () => {},
  _bcSheet_: (n, head) => book.getSheetByName(n) || sheet(n, [head]),
  _prodKey_: s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim(),
  _isPfName_: s => /п\/ф/i.test(String(s || '')),
  _buildDishIndexes_: () => ({ dishByCode: {
    'D-01': { code: 'D-01', name: 'Борщ', semi: false, ing: [['Свёкла', 80, 'г'], ['Говядина', 50, 'г']] },
    'D-02': { code: 'D-02', name: 'Котлета по-киевски', semi: false, ing: [['Филе куриное', 120, 'г'], ['Масло сливочное', 20, 'г']] },
    'D-03': { code: 'D-03', name: 'Компот', semi: false, ing: [['Сухофрукты', 30, 'г']] },
    'D-04': { code: 'D-04', name: 'Суп харчо', semi: false, ing: [['Говядина', 60, 'г'], ['Соль поваренная', 3, 'г'], ['Перец черный молотый', 0.5, 'г'], ['Перец болгарский', 20, 'г']] } } }),
  _dishWorkshopMap_: () => ({ 'D-01': 'Горячий цех', 'D-02': 'Горячий цех', 'D-03': 'Холодный цех' }),
  // средняя цена склада за 1 г
  _currentAvgPrice_: (n, u) => ({ 'свёкла': 0.05, 'говядина': 0.8, 'филе куриное': 0.45, 'масло сливочное': 0.9, 'мука': 0.04, 'соль поваренная': 0.02, 'перец черный молотый': 1.2 })[String(n).toLowerCase()] * (u === 'кг' ? 1000 : 1) || 0,
});
G.Utilities.newBlob = (h) => ({ getAs: t => ({ type: t, html: h, setName(n) { this.name = n; return this; } }) });
const ctx = vm.createContext(G);
['MonChef_OrgSettings.gs', 'MonChef_V64_EconomyFlow.gs', 'TS_OpForms.gs'].forEach(f => vm.runInContext(fs.readFileSync(path.join(root, 'app', f), 'utf8'), ctx, { filename: f }));
ctx._mcReportsFolder_ = () => ({ createFile: b => { pdfs.push(b); return { getUrl: () => 'https://drive/' + b.name }; } });
const C = ctx, J = s => { const r = JSON.parse(s); if (!r.success) throw new Error(r.error.message); return r.data; }, F = s => JSON.parse(s);
let n = 0; const t = (name, f) => { f(); n++; console.log('  ✓ ' + name); };

// реквизиты клиента — как их сохраняет экран «Настройки → Организация»
G.PropertiesService.getScriptProperties().setProperty('MC_ORG_SETTINGS', JSON.stringify({ name: 'ООО «Тест-Кухня»', inn: '7707083893', okpo: '12345678', division: 'Столовая № 1',
  actualAddress: 'г. Оренбург, ул. Тестовая, 1', directorName: 'Петров П. П.', directorPosition: 'Генеральный директор' }));
// данные системы
const D = '12.11.2026', ISO = '2026-11-12';
sheet('Ж_Продажи', [['№', 'Дата', 'Время', 'Блюдо', 'Количество', 'Цена', 'Сумма', 'ФИО продавца', 'Должность', 'Подпись'],
  [1, D, '12:00', 'Борщ', 3, 250, 750, 'Кассир', '', ''], [2, D, '12:10', 'Борщ', 2, 250, 500, 'Кассир', '', ''],
  [3, D, '12:20', 'Котлета по-киевски', 1, '', '', 'Кассир', '', ''], [4, D, '12:30', 'Компот', 4, '', '', 'Кассир', '', ''],
  [5, '11.11.2026', '12:00', 'Борщ', 9, 240, 2160, 'Кассир', '', '']]);
sheet('Цены_Меню', [['PriceID', 'DishCode', 'DishName', 'Price', 'Unit', 'Source', 'EventID', 'DateFrom', 'DateTo', 'Status'],
  ['P1', 'D-02', 'Котлета по-киевски', 420, 'порц', 'меню', '', '2026-01-01', '', 'ACTIVE']]);
sheet('Склад_Остатки', [['Продукт', 'Ед.изм', 'Остаток', 'Мин.запас', 'Сред.цена', 'Цена послед.закупки', 'Обновлено'],
  ['Мука', 'кг', 25, 10, 40, 42, ''], ['Говядина', 'кг', 4.5, 2, 800, 820, ''], ['Соль', 'кг', 0, 1, 20, 20, '']]);
sheet('Сотрудники', [['Фамилия', 'Имя', 'Отчество', 'Должность', 'Роль', 'Дата рождения', 'Телефон', 'Адрес', 'ПИН-код', 'Сан. книжка №', 'Срок сан. книжки', 'Посл. мед. осмотр', 'Активен', 'Цвет', 'Создан'],
  ['Сидоров', 'Иван', 'Ильич', 'Повар', '', '', '', '', '', '', '', '', true, '', ''], ['Уволенный', 'Пётр', '', 'Повар', '', '', '', '', '', '', '', '', false, '', '']]);
sheet('Склад_Партии', [['ID', 'Продукт', 'Ед.изм', 'Кол-во', 'Получено', 'Срок годности', 'Цена за ед.', 'Источник', 'Использовано', 'Остаток', 'Статус'],
  ['B-1', 'Говядина на кости', 'г', 10000, ISO, '', 0.6, 'Приход', 0, 10000, 'ACTIVE']]);
sheet('Разбор_Акты', [['ID', 'Дата', 'ПартияИсточник', 'Продукт', 'ИсходныйВес', 'ЕдИзм', 'Статус', 'Сотрудник', 'СуммаВыход', 'СуммаОтход', 'ПроцентОтход', 'НормаПроцент', 'ТребуетПроверки', 'Создано'],
  ['A-1', ISO, 'B-1', 'Говядина на кости', 10000, 'г', 'DONE', 'Сидоров', 7000, 3000, 30, 30, false, '']]);
sheet('Разбор_Строки', [['АктID', 'Тип', 'Название', 'Вес', 'НовыйBatchID'], ['A-1', 'product', 'Вырезка п/ф', 4000, 'B-2'], ['A-1', 'product', 'Фарш п/ф', 3000, 'B-3'], ['A-1', 'waste', 'Кость', 3000, '']]);

t('реквизиты: ОКПО, подразделение и руководитель — новые поля настроек организации; ОКПО проверяется', () => {
  const keys = C.MC_ORG_FIELDS_.map(f => f[0]);
  ['okpo', 'division', 'directorName', 'directorPosition'].forEach(k => assert(keys.includes(k), k));
  assert(C._mcOrgValidate_({ okpo: '123' }).some(e => /ОКПО/.test(e)));
  assert.strictEqual(C._mcOrgValidate_({ okpo: '12345678' }).length, 0);
  const o = J(C.tsOpList('t')).org;
  assert.strictEqual(o.okpo, '12345678'); assert.strictEqual(o.division, 'Столовая № 1'); assert.strictEqual(o.director, 'Петров П. П.');
  assert.deepStrictEqual(o.missing, []);
});

// перечень форм первичной учётной документации — как прислал Денис: номер, наименование, формат листа
const CATALOG = [['ОП-1', 'Калькуляционная карточка', 'A4L'], ['ОП-2', 'План-меню', 'A4'], ['ОП-3', 'Требование в кладовую', 'A4'],
  ['ОП-4', 'Накладная на отпуск товара', 'A4L'], ['ОП-5', 'Закупочный акт', 'A4'], ['ОП-6', 'Дневной заборный лист', 'A4L'],
  ['ОП-7', 'Опись дневных заборных листов (накладных)', 'A4'], ['ОП-8', 'Акт о бое, ломе и утрате посуды и приборов', 'A4L'],
  ['ОП-9', 'Ведомость учета движения посуды и приборов', 'A4L'], ['ОП-10', 'Акт о реализации и отпуске изделий кухни', 'A4L'],
  ['ОП-11', 'Акт о продаже и отпуске изделий кухни', 'A4'], ['ОП-12', 'Акт о реализации готовых изделий кухни за наличный расчет', 'A4'],
  ['ОП-13', 'Контрольный расчет расхода специй и соли', 'A4'], ['ОП-14', 'Ведомость учета движения продуктов и тары на кухне', 'A4'],
  ['ОП-15', 'Акт о снятии остатков продуктов, полуфабрикатов и готовых изделий кухни', 'A3L'],
  ['ОП-16', 'Ведомость учета остатков продуктов и товаров на складе (в кладовой)', 'A4L'],
  ['ОП-17', 'Контрольный расчет расхода продуктов по нормам рецептур на выпущенные изделия', 'A4L'],
  ['ОП-18', 'Акт о передаче товаров и тары при смене материально ответственного лица', 'A4'],
  ['ОП-19', 'Журнал учета столовой посуды и приборов, выдаваемых под отчет работникам организации', '2A4L'],
  ['ОП-20', 'Заказ-счет', 'A4'], ['ОП-21', 'Акт на отпуск питания сотрудникам организации', 'A4'], ['ОП-22', 'Акт на отпуск питания по безналичному расчету', 'A4'],
  ['ОП-23', 'Акт о разделке мяса-сырья на полуфабрикаты', 'A3L'], ['ОП-24', 'Ведомость учета движения готовых изделий в кондитерском и других цехах', 'A4L'],
  ['ОП-25', 'Наряд-заказ на изготовление кондитерских и других изделий', 'A3L']];

t('перечень: все 25 форм ОП-1…ОП-25 с наименованиями, кодами ОКУД 03305xx и форматами листов', () => {
  const d = J(C.tsOpList('t'));
  assert.deepStrictEqual(d.forms.map(f => [f.code, f.title, f.format]), CATALOG);
  d.forms.forEach((f, i) => assert.strictEqual(f.okud, '03305' + String(i + 1).padStart(2, '0'), f.code));
  const html = J(C.tsOpCatalog('t')).html;
  assert(/ПЕРЕЧЕНЬ ФОРМ ПЕРВИЧНОЙ УЧЕТНОЙ ДОКУМЕНТАЦИИ/.test(html) && /А3 альбомный/.test(html) && /разворот/.test(html));
  CATALOG.forEach(([code]) => assert(html.includes('>' + code + '<'), code));
});

t('список: блюда, товары склада и подразделения (цеха) для подсказок', () => {
  const d = J(C.tsOpList('t'));
  assert(d.dishes.includes('Борщ') && d.products.some(p => p.name === 'Мука'));
  assert(d.divisions.includes('Горячий цех') && d.divisions[0] === 'Столовая № 1');
});

t('ОП-10: продажи за день сводятся по блюдам; цена продажи — из продажи или меню, учётная — себестоимость по ТТК', () => {
  const d = J(C.tsOpPrefill('t', 'OP10', { date: ISO }));
  const borsch = d.rows.find(r => r.name === 'Борщ'), kiev = d.rows.find(r => r.name === 'Котлета по-киевски'), komp = d.rows.find(r => r.name === 'Компот');
  assert.strictEqual(borsch.qty, 5, 'вчерашняя продажа не попадает'); assert.strictEqual(borsch.salePrice, 250); assert.strictEqual(borsch.saleSum, 1250);
  assert.strictEqual(borsch.code, 'D-01'); assert.strictEqual(borsch.price, 44, 'себестоимость 80 г × 0,05 + 50 г × 0,8 = 44');
  assert.strictEqual(kiev.salePrice, 420, 'нет цены в продаже — из меню'); assert.strictEqual(kiev.price, 72);
  assert(komp.noPrice, 'нет цены ни в меню, ни в продаже, ни на складе — строка помечается'); assert.strictEqual(komp.salePrice, 0);
  assert.strictEqual(d.totals.saleSum, 1670); assert.strictEqual(d.noPrice, 1);
});

let op3no;
t('ОП-3: строка вручную — цена подставляется со склада; сумма считается сервером, а не берётся из запроса', () => {
  const p = J(C.tsOpPrice('t', 'OP3', 'Мука', '', ISO));
  assert.strictEqual(p.unit, 'кг'); assert.strictEqual(p.price, 40); assert.strictEqual(p.okei, '166');
  const r = J(C.tsOpCreate('t', 'OP3', { params: { date: ISO, recipient: 'Горячий цех' }, rows: [{ name: 'Мука', unit: 'кг', qty: 2.5, sum: 999999 }, { name: 'Говядина', unit: 'кг', qty: 1, price: 810 }] }));
  op3no = r.no;
  assert.strictEqual(r.no, 'ОП-3/2026/1'); assert.strictEqual(r.totals.sum, 910, '2,5 × 40 + 1 × 810 (введённая цена сохраняется)');
  assert(/ТРЕБОВАНИЕ В КЛАДОВУЮ/.test(r.html) && /0330503/.test(r.html) && /12345678/.test(r.html) && /ООО «Тест-Кухня»/.test(r.html) && /Столовая № 1/.test(r.html));
  assert(/Девятьсот десять рублей 00 копеек/.test(r.html), 'сумма прописью');
  assert.strictEqual(J(C.tsOpCreate('t', 'OP3', { params: { date: ISO }, rows: [{ name: 'Мука', unit: 'кг', qty: 1 }] })).no, 'ОП-3/2026/2', 'номер по порядку внутри года');
  assert.strictEqual(F(C.tsOpCreate('t', 'OP3', { params: { date: ISO }, rows: [] })).success, false);
});

t('ОП-7: опись собирает требования ОП-3 за период с их суммами', () => {
  const d = J(C.tsOpPrefill('t', 'OP7', { from: ISO, to: ISO }));
  assert.deepStrictEqual(d.rows.map(r => r.docNo), ['ОП-3/2026/1', 'ОП-3/2026/2']); assert.strictEqual(d.totals.sum, 950);
});

t('ОП-18: остатки склада на дату передачи с учётными ценами; нулевые остатки не попадают', () => {
  const d = J(C.tsOpPrefill('t', 'OP18', { date: ISO }));
  assert.deepStrictEqual(d.rows.map(r => r.name), ['Говядина', 'Мука']); assert.strictEqual(d.totals.sum, 4600);
});

t('ОП-21: работающие сотрудники, стоимость порции — цена рациона из меню', () => {
  const d = J(C.tsOpPrefill('t', 'OP21', { date: ISO, dish: 'Котлета по-киевски' }));
  assert.deepStrictEqual(d.rows.map(r => r.name), ['Сидоров Иван Ильич']); assert.strictEqual(d.rows[0].saleSum, 420);
});

t('ОП-23: разделка — сырьё по цене партии, п/ф по массе выхода, отходы без стоимости; итог — стоимость сырья', () => {
  const d = J(C.tsOpPrefill('t', 'OP23', { date: ISO }));
  const raw = d.rows.find(r => r.kind === 'сырьё'), cut = d.rows.find(r => r.name === 'Вырезка п/ф'), bone = d.rows.find(r => r.kind === 'отходы');
  assert.strictEqual(raw.sum, 6000); assert.strictEqual(cut.pct, 40); assert.strictEqual(cut.sum, 3428.57);
  assert.strictEqual(bone.sum, 0); assert.strictEqual(d.totals.sum, 6000);
});

t('форматы листов: А4 книжный, А4 альбомный, А3 альбомный — в разметке печати', () => {
  const html = form => C._tsOpHtml_({ form, n: 1, params: { date: ISO }, rows: [], org: C._tsOpOrg_('') });
  assert(/size:A4 portrait/.test(html('OP3')) && /size:A4 landscape/.test(html('OP10')) && /size:A3 landscape/.test(html('OP23')) && /size:A3 landscape/.test(html('OP15')));
  assert(/формат А3 альбомный/.test(html('OP25')));
});

t('ОП-1: калькуляция по ТТК на N порций — цены склада, себестоимость порции, цена продажи и наценка', () => {
  const d = J(C.tsOpPrefill('t', 'OP1', { date: ISO, dish: 'Борщ', portions: '10' }));
  assert.deepStrictEqual(d.rows.map(r => [r.name, r.qty, r.sum]), [['Свёкла', 800, 40], ['Говядина', 500, 400]]);
  const r = J(C.tsOpCreate('t', 'OP1', { params: { date: ISO, dish: 'Борщ', portions: '10' }, rows: d.rows }));
  assert.strictEqual(r.totals.sum, 440);
  assert(/КАЛЬКУЛЯЦИОННАЯ КАРТОЧКА/.test(r.html) && /0330501/.test(r.html) && /Количество порций: <b>10/.test(r.html));
  assert(/1 порции: <b>44,00/.test(r.html), 'себестоимость порции');
  assert(/Цена продажи 1 порции: <b>250,00/.test(r.html), 'цена — последняя по дате продажа, а не последняя строка журнала');
  assert(/Наценка: <b>468,18 %/.test(r.html));
});

t('ОП-2: план-меню по продажам того же дня неделю назад; блюда без количества в план не попадают', () => {
  const d = J(C.tsOpPrefill('t', 'OP2', { date: '2026-11-19' }));
  assert.deepStrictEqual(d.rows.map(r => [r.name, r.qty]), [['Борщ', 5], ['Компот', 4], ['Котлета по-киевски', 1]]);
  d.rows.find(r => r.name === 'Компот').qty = 0;
  const r = J(C.tsOpCreate('t', 'OP2', { params: { date: '2026-11-19' }, rows: d.rows }));
  assert.strictEqual(r.totals.saleSum, 1670, '5 × 250 + 1 × 420'); assert(/ПЛАН-МЕНЮ/.test(r.html) && !/Компот/.test(r.html));
});

// продажи следующего дня — суп с солью и специями
S['Ж_Продажи'].appendRow([6, '13.11.2026', '13:00', 'Суп харчо', 10, 300, 3000, 'Кассир', '', '']);

t('ОП-13: расход соли и специй по нормам ТТК на проданные блюда; овощной «перец болгарский» — не специя', () => {
  const d = J(C.tsOpPrefill('t', 'OP13', { date: '2026-11-13' }));
  assert.deepStrictEqual(d.rows.map(r => [r.name, r.unit, r.qty, r.sum]), [['Перец черный молотый', 'г', 5, 6], ['Соль поваренная', 'г', 30, 0.6]]);
  assert.strictEqual(d.totals.sum, 6.6);
});

t('ОП-17: расход продуктов по нормам; фактический расход вводится — отклонение считается сервером', () => {
  const d = J(C.tsOpPrefill('t', 'OP17', { date: '2026-11-13' }));
  const beef = d.rows.find(r => r.name === 'Говядина');
  assert.strictEqual(beef.qty, 600); assert.strictEqual(beef.sum, 480); assert.strictEqual(beef.diff, '', 'пока факт не введён — отклонения нет');
  assert(d.rows.find(r => r.name === 'Перец болгарский').noPrice, 'нет цены склада — строка помечается');
  beef.fact = 650; beef.diff = -999;
  const r = J(C.tsOpCreate('t', 'OP17', { params: { date: '2026-11-13' }, rows: d.rows }));
  assert(/<td[^>]*>50<\/td>/.test(r.html), 'отклонение +50 г посчитано сервером');
});

t('ОП-9 и ОП-14: остаток на конец = начало + поступило − выбыло; отрицательный остаток не сохраняется', () => {
  const r = J(C.tsOpCreate('t', 'OP9', { params: { from: '2026-11-01', to: '2026-11-30' }, rows: [{ name: 'Тарелка мелкая', price: 150, open: 100, in: 20, out: 5, qty: 1 }, { name: 'Вилка', price: 40, open: 10, in: 0, out: 10 }] }));
  assert.strictEqual(r.totals.sum, 17250); assert.strictEqual(r.totals.qty, 115);
  assert(/за период с <b>01\.11\.2026<\/b> по <b>30\.11\.2026/.test(r.html) && /Дата составления[\s\S]*30\.11\.2026/.test(r.html));
  assert(/^ОП-9\/2026\/1$/.test(r.no));
  assert.strictEqual(F(C.tsOpCreate('t', 'OP14', { params: { from: ISO, to: ISO }, rows: [{ name: 'Мука', unit: 'кг', open: 1, in: 0, out: 3 }] })).success, false);
  const k = J(C.tsOpCreate('t', 'OP14', { params: { from: ISO, to: ISO }, rows: [{ name: 'Мука', unit: 'кг', open: 1, in: 5, out: 3 }] }));
  assert.strictEqual(k.totals.sum, 120, 'остаток 3 кг × 40 — цена склада подставлена');
});

t('ОП-19: журнал на развороте из двух листов А4 альбомных; недостача считается; без суммы прописью', () => {
  const r = J(C.tsOpCreate('t', 'OP19', { params: { date: ISO }, rows: [{ issueDate: '12.11.2026', person: 'Сидоров И. И.', tab: '7', name: 'Ложка столовая', qty: 3, ret: 2 }] }));
  assert(/size:A4 landscape/.test(r.html) && /page-break-before:always/.test(r.html) && /Правая сторона разворота/.test(r.html));
  assert(!/Итого на сумму/.test(r.html));
  const right = r.html.split('Правая сторона разворота')[1];
  assert(/Недостача, шт\./.test(right) && /<td[^>]*>1<\/td>/.test(right) && !/Работник \(ФИО\)/.test(right));
});

t('ОП-24: движение готовых изделий за период — «отпущено» по продажам, остаток 0 допускается', () => {
  const d = J(C.tsOpPrefill('t', 'OP24', { from: '2026-11-11', to: '2026-11-13' }));
  const b = d.rows.find(r => r.name === 'Борщ');
  assert.strictEqual(b.out, 14); assert.strictEqual(b.in, 14); assert.strictEqual(b.qty, 0);
  assert.strictEqual(J(C.tsOpCreate('t', 'OP24', { params: { from: '2026-11-11', to: '2026-11-13' }, rows: d.rows })).totals.qty, 0);
});

t('ОП-25: наряд-заказ — цена из продажи, потребность в сырье по нормам ТТК', () => {
  const r = J(C.tsOpCreate('t', 'OP25', { params: { date: '2026-11-13', customer: 'Банкет', due: '14.11.2026' }, rows: [{ name: 'Суп харчо', qty: 2 }] }));
  assert.strictEqual(r.totals.saleSum, 600);
  assert(/<td[^>]*>Суп харчо<\/td><td[^>]*>D-04<\/td>/.test(r.html), '№ ТТК подставлен по названию изделия');
  assert(/Потребность в сырье/.test(r.html) && /Говядина/.test(r.html) && /Заказчик \(подразделение, организация\): <b>Банкет/.test(r.html) && /Срок исполнения: <b>14\.11\.2026/.test(r.html));
});

t('ОП-5, ОП-20, ОП-22, ОП-16: ручные формы и реквизиты; закупка — только договорная цена', () => {
  const z = J(C.tsOpPrefill('t', 'OP5', { date: ISO })); assert.strictEqual(z.rows.length, 0);
  const p5 = J(C.tsOpPrice('t', 'OP5', 'Мука', 'кг', ISO)); assert.strictEqual(p5.price, 0, 'цена склада в закупочный акт не подставляется'); assert(p5.noPrice);
  const a = J(C.tsOpCreate('t', 'OP5', { params: { date: ISO, seller: 'Фермер А. А.', sellerDoc: '5300 123456' }, rows: [{ name: 'Картофель', unit: 'кг', qty: 50, price: 30 }] }));
  assert.strictEqual(a.totals.sum, 1500); assert(/Продавец \(ФИО\): <b>Фермер А\. А\./.test(a.html) && /<td[^>]*>166<\/td>/.test(a.html));
  const p22 = J(C.tsOpPrice('t', 'OP22', 'Котлета по-киевски', '', ISO)); assert.strictEqual(p22.salePrice, 420);
  const b = J(C.tsOpCreate('t', 'OP22', { params: { date: ISO, customer: 'ООО «Сосед»', contract: 'Договор № 5' }, rows: [{ name: 'Котлета по-киевски', qty: 3 }] }));
  assert.strictEqual(b.totals.saleSum, 1260); assert(/Получатель \(организация\): <b>ООО «Сосед»/.test(b.html));
  assert.strictEqual(J(C.tsOpCreate('t', 'OP20', { params: { date: ISO, table: '5' }, rows: [{ name: 'Борщ', qty: 2 }] })).totals.saleSum, 500);
  assert.strictEqual(J(C.tsOpPrefill('t', 'OP16', { date: ISO })).totals.sum, 4600);
});

t('печать: без логотипов и чужих названий; «Утверждаю» — руководитель из настроек; PDF — в папку отчётов', () => {
  const r = J(C.tsOpCreate('t', 'OP12', { params: { date: ISO }, rows: J(C.tsOpPrefill('t', 'OP12', { date: ISO })).rows }));
  assert(!/<img/i.test(r.html), 'логотипа нет'); assert(!/креатив|creative|kreativ/i.test(r.html), 'упоминаний «Креатив шеф» нет');
  assert(/УТВЕРЖДАЮ/.test(r.html) && /Генеральный директор/.test(r.html) && /Петров П\. П\./.test(r.html));
  assert(/нет цены/.test(r.html), 'строка без цены видна в документе');
  const g = J(C.tsOpGet('t', r.no)); assert.strictEqual(g.html, r.html);
  const p = J(C.tsOpPdf('t', r.no)); assert(/^ОП-12 .*\.pdf$/.test(p.name) && pdfs.length === 1);
  const all = Object.values(C.TS_OP_FORMS_).map(f => JSON.stringify(f)).join(' ') + fs.readFileSync(path.join(root, 'app', 'TS_OpForms.gs'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert(!/креатив|creative/i.test(all));
});

t('сумма прописью: склонения', () => {
  assert.strictEqual(C._tsOpRubWords_(1), 'Один рубль 00 копеек');
  assert.strictEqual(C._tsOpRubWords_(21.01), 'Двадцать один рубль 01 копейка');
  assert.strictEqual(C._tsOpRubWords_(2002.32), 'Две тысячи два рубля 32 копейки');
  assert.strictEqual(C._tsOpRubWords_(1000000), 'Один миллион рублей 00 копеек');
  assert.strictEqual(C._tsOpRubWords_(0), 'Ноль рублей 00 копеек');
});

t('шлюз: функции форм зарегистрированы, запись — только с правом записи, возможность тарифа «Экономика»', () => {
  const src = fs.readFileSync(path.join(root, 'app', 'TS_Subscription.gs'), 'utf8');
  ['tsOpList', 'tsOpPrefill', 'tsOpPrice', 'tsOpCreate', 'tsOpGet', 'tsOpCatalog', 'tsOpPdf'].forEach(fn => assert(new RegExp("n: '" + fn + "'.*f: 'economics'").test(src), fn));
  assert(/n: 'tsOpCreate', need: '[^']*', mut: true/.test(src));
});
console.log('Формы ОП: ' + n + ' проверок пройдено');
