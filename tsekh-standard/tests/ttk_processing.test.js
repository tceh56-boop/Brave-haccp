/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
// V74: виды обработки сырья в ТТК (нетто, выход, КБЖУ с потерями) и карточка продукта с наполнением с этикетки.
// Запуск: node tests/ttk_processing.test.js
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert'), { make } = require('./gas_mock');
const app = path.join(__dirname, '..', 'app'), G = make('owner@example.com');
let n = 0; const t = (name, f) => { f(); n++; console.log('  ✓ ' + name); };
const sheets = {};
function sheet(name) { const s = { data: [], getName: () => name, getLastRow: () => s.data.length, getLastColumn: () => Math.max(0, ...s.data.map(r => r.length)), setFrozenRows() {}, appendRow(r) { s.data.push(r.slice()); },
  getDataRange() { const w = Math.max(1, ...s.data.map(r => r.length)); return s.getRange(1, 1, Math.max(1, s.data.length), w); },
  getRange(r, c, nr = 1, nc = 1) { return { setValues(v) { v.forEach((row, i) => { s.data[r - 1 + i] = s.data[r - 1 + i] || []; row.forEach((x, j) => { s.data[r - 1 + i][c - 1 + j] = x; }); }); return this; },
    getValues() { const o = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(((s.data[r - 1 + i] || [])[c - 1 + j]) ?? ''); o.push(row); } return o; },
    setValue(v) { s.data[r - 1] = s.data[r - 1] || []; s.data[r - 1][c - 1] = v; return this; }, getValue() { return ((s.data[r - 1] || [])[c - 1]) ?? ''; },
    clearContent() { for (let i = 0; i < nr; i++) if (s.data[r - 1 + i]) for (let j = 0; j < nc; j++) s.data[r - 1 + i][c - 1 + j] = ''; return this; }, setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; } }; } }; return s; }
const book = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = sheet(n)) };
const table = (name, head, rows) => { const s = book.getSheetByName(name) || book.insertSheet(name); s.data = [head.slice()].concat(rows.map(r => r.slice())); return s; };
let session = { user_id: 'E1', name: 'Технолог Сидорова', fullName: 'Технолог Сидорова', role: 'Технолог' };
const audits = [], versions = [];
let DISHES = {}, ocr = null, matchConf = 0.9;
Object.assign(G, { _book_: () => book, _mcTz_: () => 'Europe/Moscow', _withLock_: f => f(), _log_: () => {}, _dropCatalogCache_: () => {},
  _ok_: (d, id) => JSON.stringify({ success: true, data: d }), _fail_: (c, m) => JSON.stringify({ success: false, error: { code: c, message: m } }), _failFrom_: e => JSON.stringify({ success: false, error: { message: String(e.message || e) } }),
  _requireAuth_: () => session, _beginOp_: () => ({ id: 'OP', session }), _endOp_: () => {}, _audit_: (...a) => audits.push(a),
  _v64Json_: x => (typeof x === 'string' ? JSON.parse(x || '{}') : (x || {})), _v65Who_: op => ({ name: op.session.fullName }),
  _v64Sheet_: (name, head) => { let sh = book.getSheetByName(name); if (!sh) { sh = book.insertSheet(name); sh.appendRow(head); } return sh; },
  getWasteNorm: nm => JSON.stringify(/картоф/i.test(nm) ? { name: 'Картофель', maxWastePercent: 25 } : null),
  _normNameServer_: s => String(s).toLowerCase().trim(), _nextDishCode_: () => 'BL-0100', _ttkStampProductIds_: () => {}, _ttkHist_: () => {}, _ttkDiff_: () => ({}),
  _createTTKVersion_: (code, d) => { versions.push(d); return 1; }, getNutritionFromSync: () => null,
  _buildDishIndexes_: () => ({ dishByCode: DISHES }),
  _serverExplodeInto_: (ing, k, acc) => ing.forEach(r => { acc[r[0] + '|г'] = (acc[r[0] + '|г'] || 0) + r[1] * k; }),
  _yandexVisionRecognize_: () => (ocr ? { ann: {}, fullText: ocr } : { error: 'no-key' }), _visionBlockLines_: () => [],
  _parseLabelText_: txt => ({ name: 'Морковь мытая фасованная', name_candidates: ['Морковь мытая фасованная'], calories_kcal_100g: 35, protein_g_100g: 1.3, fat_g_100g: 0.1, carbohydrate_g_100g: 6.9,
    composition: 'морковь столовая', allergens: '', manufacturer: 'ООО «Овощи»', raw_text: txt, warnings: [] }),
  _matchNomenclature_: () => ({ matched: { name: 'Морковь', confidence: matchConf }, alternatives: [] }) });
G.SpreadsheetApp.flush = () => {};
G.Utilities.formatDate = d => new Date(d).toISOString().slice(0, 10);
const ctx = vm.createContext(G);
const code = fs.readFileSync(path.join(app, 'Code.gs'), 'utf8');
const fn = name => { const i = code.indexOf('function ' + name + '('); assert(i >= 0, name); let d = 0, j = code.indexOf('{', i); for (; j < code.length; j++) { if (code[j] === '{') d++; else if (code[j] === '}' && --d === 0) break; } return code.slice(i, j + 1); };
vm.runInContext(['createDish', 'calculateKBZHU', 'getNutritionData', '_findNutrition_', '_nutritionSheet_', '_cleanProdName_', '_toBaseUnitServer_'].map(fn).join('\n'), ctx);
vm.runInContext(fs.readFileSync(path.join(app, 'MonChef_V74_Processing.gs'), 'utf8'), ctx, { filename: 'MonChef_V74_Processing.gs' });
const C = ctx, J = s => { const r = JSON.parse(s); if (!r.success) throw new Error(r.error.message); return r.data; }, F = s => JSON.parse(s);
table('Блюда', ['Код', 'Название'], []); table('Состав', ['Код', 'Ингредиент', 'Ед', 'Брутто', 'Брутто, г', 'Нетто', 'Выход', 'Ед. выхода', 'Нетто на порцию'], []);
table('Справочник_Пищевая_Ценность', ['Продукт', 'Ккал', 'Белки', 'Жиры', 'Углеводы'], [['Морковь', 35, 1.3, 0.1, 6.9], ['Картофель', 77, 2, 0.4, 16.3]]);

t('Карточка продукта: КБЖУ, состав и виды обработки; колонки дописываются в старый справочник', () => {
  const r = J(C.v74SaveProduct(JSON.stringify({ name: 'Морковь', kcal: 35, protein: 1.3, fat: 0.1, carbs: 6.9, composition: 'морковь столовая', allergens: '',
    processing: [{ name: 'Очистка, варка', cold: 20, thermal: 3, final: '', lossP: 10, lossF: '', lossC: 15, isDefault: true }, { name: 'Очистка, тушение', cold: 20, thermal: 10 }] })));
  assert.strictEqual(r.processing, 2);
  const h = sheets['Справочник_Пищевая_Ценность'].data[0];
  assert.deepStrictEqual(h.slice(5), [...C.MC_V74_NUT_EXT], 'колонки справа от КБЖУ');
  const card = J(C.v74ProductCard('морковь'));
  assert.strictEqual(card.composition, 'морковь столовая'); assert.strictEqual(card.processing.length, 2);
  assert(card.processing[0].isDefault && card.processing[0].cold === 20 && card.processing[0].lossC === 15);
  assert(/^вручную: Технолог Сидорова/.test(card.source));
});

t('Проверки: проценты 0–99,9, КБЖУ все четыре или ни одного, одна обработка по умолчанию', () => {
  assert(/0 до 99/.test(F(C.v74SaveProduct(JSON.stringify({ name: 'Свёкла', processing: [{ name: 'Варка', cold: 120 }] }))).error.message));
  assert(/все четыре|ккал, белки/.test(F(C.v74SaveProduct(JSON.stringify({ name: 'Свёкла', kcal: 40 }))).error.message));
  assert(/только одна/.test(F(C.v74SaveProduct(JSON.stringify({ name: 'Свёкла', processing: [{ name: 'А', isDefault: true }, { name: 'Б', isDefault: true }] }))).error.message));
});

t('Форма ТТК получает обработки; без своих — норма разбора как холодная обработка; без данных — пусто, ничего не выдумано', () => {
  const d = J(C.v74ProcessingFor(JSON.stringify(['Морковь', 'Картофель', 'Соль'])));
  assert.strictEqual(d['Морковь'].length, 2);
  assert(d['Картофель'][0].fromWasteNorm && d['Картофель'][0].cold === 25 && d['Картофель'][0].isDefault);
  assert.strictEqual(d['Соль'].length, 0);
});

t('Новая обработка из формы ТТК добавляется к продукту, остальные не трогаются', () => {
  const r = J(C.v74AddProcessing(JSON.stringify({ product: 'Морковь', proc: { name: 'Очистка, нарезка', cold: 22, isDefault: true } })));
  assert.strictEqual(r.processing.length, 3);
  assert.strictEqual(r.processing.filter(p => p.isDefault).length, 1, 'по умолчанию — одна');
  assert(r.processing.find(p => p.name === 'Очистка, нарезка').isDefault);
  J(C.v74AddProcessing(JSON.stringify({ product: 'морковь', proc: { name: 'Очистка, нарезка', cold: 21 } })));
  assert.strictEqual(J(C.v74ProcessingFor(JSON.stringify(['Морковь'])))['Морковь'].find(p => p.name === 'Очистка, нарезка').cold, 21, 'та же обработка обновляется, не дублируется');
});

t('Создание ТТК с обработкой: нетто и выход в «Составе», выход карты = сумма выходов, обработка сохранена', () => {
  const proc = { name: 'Очистка, варка', cold: 20, thermal: 3, final: 0, lossP: 10, lossF: 0, lossC: 15 };
  const r = J(C.createDish(JSON.stringify({ name: 'Морковь отварная П/Ф', ingredients: [{ name: 'Морковь', qty: 0.1, unit: 'кг', proc }, { name: 'Соль', qty: 1, unit: 'г' }] })));
  assert.strictEqual(r.code, 'BL-0100');
  const s = sheets['Состав'].data.slice(1);
  assert.deepStrictEqual([...s[0].slice(0, 7)], ['BL-0100', 'Морковь', 'кг', 0.1, 100, 80, 77.6]);
  assert.deepStrictEqual([...s[1].slice(0, 7)], ['BL-0100', 'Соль', 'г', 1, 1, '', ''], 'строка без обработки — как раньше');
  assert.strictEqual(sheets['Блюда'].data[1][3], 78.6, 'выход = 77,6 + 1');
  assert.strictEqual(versions[0].ingredients[0].processing, 'Очистка, варка'); assert.strictEqual(versions[0].ingredients[0].netto, 80);
  const L = sheets['ТТК_Обработка'].data;
  assert.strictEqual(L.length, 2); assert.deepStrictEqual([...L[1].slice(0, 10)], ['BL-0100', 1, 'Морковь', 'Очистка, варка', 100, 20, 3, 0, 80, 77.6]);
  assert(/0 до 99/.test(F(C.createDish(JSON.stringify({ name: 'Х', ingredients: [{ name: 'Морковь', qty: 10, proc: { name: 'Б', cold: 100 } }] }))).error.message));
});

t('КБЖУ блюда: на нетто и с потерями белков/углеводов; без обработки — как раньше', () => {
  DISHES = { 'BL-0100': { code: 'BL-0100', name: 'Морковь отварная П/Ф', semi: false, ing: [['Морковь', 100]], yieldBase: 77.6, yieldUnit: 'г' },
    'BL-0200': { code: 'BL-0200', name: 'Морковь сырая', semi: false, ing: [['Морковь', 100]], yieldBase: 100, yieldUnit: 'г' } };
  const a = F(C.calculateKBZHU('BL-0100')), b = F(C.calculateKBZHU('BL-0200'));
  assert.strictEqual(b.total.protein, 1.3); assert.strictEqual(b.total.kcal, 35);
  assert.strictEqual(a.total.protein, Math.round(1.3 * 0.8 * 0.9 * 10) / 10, 'белки: нетто 80% и потери 10%');
  assert.strictEqual(a.total.carbs, Math.round(6.9 * 0.8 * 0.85 * 10) / 10, 'углеводы: потери 15%');
  assert(a.total.kcal < 35 * 0.8 && a.total.kcal > 20, 'калорийность снижается вместе с веществами: ' + a.total.kcal);
  assert.strictEqual(a.perIngredient[0].processing, 'Очистка, варка');
});

t('Этикетка → черновик карточки: ничего не сохраняет; без ключей — понятная ошибка', () => {
  ocr = null; assert(/ключи Yandex Cloud/.test(F(C.v74LabelToProduct('data:image/jpeg;base64,AA==')).error.message));
  ocr = 'Морковь мытая фасованная ...'; const before = JSON.stringify(sheets['Справочник_Пищевая_Ценность'].data);
  const d = J(C.v74LabelToProduct('data:image/jpeg;base64,AA=='));
  assert.strictEqual(d.name, 'Морковь'); assert.strictEqual(d.labelName, 'Морковь мытая фасованная'); assert.strictEqual(d.kcal, 35); assert.strictEqual(d.manufacturer, 'ООО «Овощи»');
  assert.strictEqual(JSON.stringify(sheets['Справочник_Пищевая_Ценность'].data), before, 'ничего не записано');
});

t('Автонаполнение при приёмке: новый продукт пополняется; ручные данные не перезаписываются; неуверенное сопоставление — пропуск', () => {
  const p = c => ({ ...C._parseLabelText_('x'), matched_product: { name: c, confidence: 0.9 } });
  const r1 = C._v74LearnFromLabel_(p('Морковь'), 'LBL1');
  assert.strictEqual(r1.written, false); assert(/вручную/.test(r1.reason));
  const r2 = C._v74LearnFromLabel_(p('Морковь мини'), 'LBL2');
  assert(r2.written && r2.created && r2.nutrition);
  let card = J(C.v74ProductCard('Морковь мини'));
  assert.strictEqual(card.kcal, 35); assert.strictEqual(card.manufacturer, 'ООО «Овощи»'); assert(/^этикетка LBL2/.test(card.source));
  const r3 = C._v74LearnFromLabel_({ ...p('Морковь мини'), calories_kcal_100g: 36, protein_g_100g: 1.2, fat_g_100g: 0.2, carbohydrate_g_100g: 7 }, 'LBL3');
  assert(r3.written, 'данные с этикетки обновляются следующей этикеткой');
  assert.strictEqual(J(C.v74ProductCard('Морковь мини')).kcal, 36);
  assert.strictEqual(C._v74LearnFromLabel_({ ...p('Лук'), matched_product: { name: 'Лук', confidence: 0.7 } }, 'LBL4'), null);
  assert.strictEqual(C._v74LearnFromLabel_({ ...p('Лук'), calories_kcal_100g: null, composition: '' }, 'LBL5'), null, 'на этикетке нечего брать');
  J(C.v74SaveProduct(JSON.stringify({ name: 'Морковь мини', kcal: 30, protein: 1, fat: 0, carbs: 6 })));
  assert.strictEqual(C._v74LearnFromLabel_(p('Морковь мини'), 'LBL6').written, false, 'после ручной правки этикетка не перезаписывает');
});

t('Список продуктов: КБЖУ, число обработок, источник', () => {
  const l = J(C.v74ProductList()).items, m = l.find(x => x.name === 'Морковь');
  assert.strictEqual(m.processing, 3); assert.strictEqual(m.composition, 'да');
  assert(l.find(x => x.name === 'Морковь мини'));
});

t('Gate и роли: новые функции зарегистрированы', () => {
  const g = fs.readFileSync(path.join(app, 'zzz_MonChef_Gate.gs'), 'utf8').split('\n');
  const arr = i => JSON.parse(g[i].slice(g[i].indexOf('=') + 1).trim().replace(/;$/, ''));
  const [cl, mut, perm, need] = [arr(25), arr(26), arr(30), arr(31)];
  ['v74ProcessingFor', 'v74ProductCard', 'v74ProductList', 'v74SaveProduct', 'v74LabelToProduct', 'v74AddProcessing'].forEach(f => { assert(cl.includes(f), f); assert(need[f], f); });
  ['v74SaveProduct', 'v74LabelToProduct', 'v74AddProcessing'].forEach(f => { assert(mut.includes(f), f); assert(perm[f], f); });
});

console.log('ttk_processing: ' + n + ' проверок пройдено');
