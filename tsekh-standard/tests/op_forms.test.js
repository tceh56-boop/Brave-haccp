// Формы первичных документов общепита (ОП-3, 7, 10, 11, 12, 18, 21, 23): реквизиты и цены подставляются сами,
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
    'D-03': { code: 'D-03', name: 'Компот', semi: false, ing: [['Сухофрукты', 30, 'г']] } } }),
  _dishWorkshopMap_: () => ({ 'D-01': 'Горячий цех', 'D-02': 'Горячий цех', 'D-03': 'Холодный цех' }),
  // средняя цена склада за 1 г
  _currentAvgPrice_: (n, u) => ({ 'свёкла': 0.05, 'говядина': 0.8, 'филе куриное': 0.45, 'масло сливочное': 0.9, 'мука': 0.04 })[String(n).toLowerCase()] * (u === 'кг' ? 1000 : 1) || 0,
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

t('список: 8 форм, блюда, товары склада и подразделения (цеха) для подсказок', () => {
  const d = J(C.tsOpList('t'));
  assert.deepStrictEqual(d.forms.map(f => f.code), ['ОП-3', 'ОП-7', 'ОП-10', 'ОП-11', 'ОП-12', 'ОП-18', 'ОП-21', 'ОП-23']);
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
  ['tsOpList', 'tsOpPrefill', 'tsOpPrice', 'tsOpCreate', 'tsOpGet', 'tsOpPdf'].forEach(fn => assert(new RegExp("n: '" + fn + "'.*f: 'economics'").test(src), fn));
  assert(/n: 'tsOpCreate', need: '[^']*', mut: true/.test(src));
});
console.log('Формы ОП: ' + n + ' проверок пройдено');
