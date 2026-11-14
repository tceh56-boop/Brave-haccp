/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
// Автосборка ТУ (V66): карточка и строки из ТТК, лабораторного плана, базы нормативов и реквизитов; ничего не придумывается.
// Запуск: node tests/tu_auto.test.js
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
const audits = [];
// ТТК: борщ (сырьё + полуфабрикат «Бульон мясной п/ф»), бульон — отдельная карта
const DISHES = {
  'T-01': { code: 'T-01', name: 'Борщ', cat: 'Первые блюда', semi: false, ing: [['Говядина охлаждённая', 80, 'г'], ['Свёкла', 60, 'г'], ['Бульон мясной п/ф', 250, 'мл'], ['Свёкла', 10, 'г']], yieldBase: 300, yieldUnit: 'г' },
  'T-02': { code: 'T-02', name: 'Бульон мясной п/ф', cat: 'Полуфабрикаты', semi: true, ing: [['Говядина охлаждённая', 100, 'г']], yieldBase: 1000, yieldUnit: 'мл' }
};
let ttkVer = { 'T-01': { v: 2, storage: 'при температуре от +2 до +6 °C', shelf: '24 ч' } };
let org = { name: 'ООО «Кафе»', objectName: 'Кафе «Цех»', actualAddress: 'г. Оренбург, ул. Ленина, 1', directorName: 'Иванов И. И.', directorPosition: 'директор' };
Object.assign(G, { _book_: () => book, _mcTz_: () => 'Europe/Moscow', _withLock_: f => f(), _log_: () => {}, mcGateSession_: () => session, MC_RB_TECH_: 'Технический доступ',
  _ok_: (d, id) => JSON.stringify({ success: true, data: d }), _fail_: (c, m) => JSON.stringify({ success: false, error: { code: c, message: m } }), _failFrom_: e => JSON.stringify({ success: false, error: { message: String(e.message || e) } }),
  _requireAuth_: () => session, _beginOp_: () => ({ id: 'OP', session }), _endOp_: () => {}, _audit_: (...a) => audits.push(a),
  _mcOrg_: () => org, _mcOrgCompleteness_: () => ({ complete: true, missing: [] }), _mcRbEmpState_: () => ({}), _dishWorkshopMap_: () => ({}), JOURNALS: [], MC_RB_ROLES_: [],
  _buildDishIndexes_: () => ({ dishByCode: DISHES, dishByNormName: {} }),
  _effectiveTTKVersion_: c => (ttkVer[c] ? ttkVer[c].v : 0), _ttkVersionsSheet_: () => null,
  _ttkFindVersion_: (sh, c, v) => (ttkVer[c] && ttkVer[c].v === v ? { data: [c, v, 'действующая', '', '', '', '', '', '', '', ttkVer[c].storage, ttkVer[c].shelf] } : null),
  _shelfLifeFor_: () => ({ 'часы': 6, 'источник': 'категория' }) });
G.Utilities.formatDate = (d) => new Date(d).toISOString().slice(0, 10);
const ctx = vm.createContext(G);
['MonChef_V64_EconomyFlow.gs', 'MonChef_V64_Finance.gs', 'MonChef_V65_PPK.gs', 'MonChef_V70_NormData.gs', 'MonChef_V70_NormBase.gs', 'MonChef_V66_TU.gs'].forEach(f => vm.runInContext(fs.readFileSync(path.join(app, f), 'utf8'), ctx, { filename: f }));
const C = ctx, J = s => { const r = JSON.parse(s); if (!r.success) throw new Error(r.error.message); return r.data; };
const NH = C.MC_V70_H.NORMS, norm = o => NH.map(h => ({ Status: 'APPROVED', Origin: 'DOC', ...o })[h] ?? '');
const rows = k => C._v66Objs_(k);
let VID, TUID;

t('Пустые данные: ТУ создаётся, ничего не выдумано, список «что заполнить» полный', () => {
  const r = J(C.v66CreateTu(JSON.stringify({ number: 'ТУ-0', productName: 'Неизвестное блюдо' })));
  assert(r.auto, 'автосборка при создании');
  const v = C._v66Ver_(r.versionId);
  C.MC_V66_CARD.forEach(f => assert.strictEqual(String(v[f[0]] || ''), '', f[0] + ' должно остаться пустым'));
  ['IND', 'MET', 'RAW', 'PKL', 'REF'].forEach(k => assert.strictEqual(rows(k).filter(x => x.VersionID === r.versionId).length, 0, k));
  assert(r.auto.summary.todo.some(x => /ТТК не указаны/.test(x)), JSON.stringify(r.auto.summary.todo));
  assert(r.auto.summary.todo.some(x => /Код продукции/.test(x)));
  assert(r.auto.completeness.length > 10);
  assert(/распространяются на продукцию «Неизвестное блюдо», изготавливаемую ООО «Кафе» \(Кафе «Цех»\) по адресу: г\. Оренбург/.test(C._v66Doc_(r.tuId).Scope), 'область — из реквизитов');
});

t('Из ТТК, лабплана и базы нормативов: сырьё, п/ф, хранение, срок, показатели, методы, маркировка, ссылки', () => {
  table('Лаборатория_План', ['ID', 'Объект контроля', 'Тип объекта', 'Вид исследования', 'Периодичность, дней', 'Норматив', 'Лаборатория', 'Ответственный', 'Активен', 'Создано', 'PlanID', 'TUID', 'ObjectName', 'Indicator', 'Method', 'NormMin', 'NormMax', 'NormText', 'Unit', 'FrequencyDays'],
    [['LP1', 'Борщ', 'готовая продукция', 'КМАФАнМ', 90, 'не более 1×10³ КОЕ/г', 'ФБУЗ ЦГиЭ', '', true, '', 'LP1', '', 'Борщ', 'КМАФАнМ', 'МУК 4.2.1018-01 (ГОСТ 10444.15-94)', '', 1000, '', 'КОЕ/г', 90],
     ['LP2', 'Борщ', 'готовая продукция', 'Органолептическая оценка', 30, 'внешний вид, вкус, запах — соответствуют', '', '', true, '', 'LP2', '', 'Борщ', 'Органолептическая оценка', 'бракераж (ГОСТ 31986-2012)', '', '', 'соответствует описанию', '', 30],
     ['LP3', 'Плов', 'готовая продукция', 'КМАФАнМ', 90, '', '', '', true, '', 'LP3', '', 'Плов', 'КМАФАнМ', 'МУК', '', 1000, '', '', 90],
     ['LP4', 'Борщ', 'готовая продукция', 'Свинец', 365, '', '', '', false, '', 'LP4', '', 'Борщ', 'Свинец', 'ГОСТ', '', 0.5, '', 'мг/кг', 365]]);
  table(C.MC_V70.NORMS, NH, [norm({ NormID: 'N1', DocID: 'TRTS_021_2011', Ref: 'Приложение 1', Domain: 'MICRO', Object: 'Готовые кулинарные изделия, блюда общественного питания', Parameter: 'Патогенные микроорганизмы, в т. ч. сальмонеллы: не допускаются в массе продукта', Max: 25, Unit: 'г' }),
    norm({ NormID: 'N2', DocID: 'TRTS_022_2011', Ref: 'ст. 4', Domain: 'LABEL', Object: 'Пищевая продукция', Parameter: 'Наименование, состав, дата изготовления и срок годности' }),
    norm({ NormID: 'N3', DocID: 'TRTS_021_2011', Ref: 'Приложение 2', Domain: 'MICRO', Object: 'Молоко сырое', Parameter: 'КМАФАнМ', Max: 100000, Status: 'APPROVED' }),
    norm({ NormID: 'N4', Domain: 'MICRO', Object: 'Готовые кулинарные изделия, блюда общественного питания', Parameter: 'Листерии', Status: 'DRAFT' })]);
  const r = J(C.v66CreateTu(JSON.stringify({ number: 'ТУ-1', productName: 'Борщ', ttkCodes: ['T-01'] }))), vid = r.versionId, v = C._v66Ver_(vid);
  assert(/по составу ТТК T-01 «Борщ», версия 2: Говядина охлаждённая, Свёкла\./.test(v.RawRequirements), v.RawRequirements);
  assert(!/Бульон/.test(v.RawRequirements), 'п/ф не в сырье');
  assert.strictEqual(v.IngredientRequirements, 'Полуфабрикат «Бульон мясной п/ф» — изготавливается по ТТК T-02');
  assert.strictEqual(v.StorageConditions, 'при температуре от +2 до +6 °C (ТТК T-01, версия 2)');
  assert.strictEqual(v.ShelfLife, '24 ч (ТТК T-01, версия 2)');
  ['Organoleptic', 'Transport', 'AcceptanceRules', 'SamplingRules', 'SupplierDocs', 'NonconformingDisposal'].forEach(k => assert.strictEqual(String(v[k]), '', k + ' — данных нет, пусто'));
  const ind = rows('IND').filter(x => x.VersionID === vid), met = rows('MET').filter(x => x.VersionID === vid);
  const km = ind.find(x => x.Indicator === 'КМАФАнМ'); assert(km && km.Group === 'MICRO' && km.NormMax === 1000 && km.LabFrequencyDays === 90 && km.MethodID, JSON.stringify(km));
  assert.strictEqual(met.find(m => m.MethodID === km.MethodID).StandardRef, 'ГОСТ 10444.15-94'); assert.strictEqual(met.find(m => m.MethodID === km.MethodID).Laboratory, 'ФБУЗ ЦГиЭ');
  assert.strictEqual(ind.find(x => /Органолепт/.test(x.Indicator)).Group, 'ORGANOLEPTIC');
  assert(!ind.some(x => x.Indicator === 'Свинец'), 'неактивная строка плана не берётся');
  assert.strictEqual(ind.filter(x => x.Indicator === 'КМАФАнМ').length, 1, 'план другого блюда (Плов) и норма «Молоко сырое» не попали');
  const pat = ind.find(x => /Патогенные/.test(x.Indicator)); assert(pat && pat.Group === 'MICRO' && pat.NormMin === '' && pat.NormMax === '' && /не допускаются в массе продукта \(до 25 г\)|не допускаются в массе продукта \(25 г\)/.test(pat.NormText) && !pat.MethodID, JSON.stringify(pat));
  assert(!ind.some(x => /Листерии/.test(x.Indicator)), 'неутверждённая норма не берётся');
  const ms = ind.find(x => x.Group === 'PHYSCHEM'); assert(ms && /300 г по ТТК T-01/.test(ms.NormText) && ms.Mandatory === false, JSON.stringify(ms));
  const raw = rows('RAW').filter(x => x.VersionID === vid); assert.deepStrictEqual(raw.map(x => x.Material), ['Говядина охлаждённая', 'Свёкла'], 'сырьё без дублей и без п/ф');
  assert(rows('PKL').some(x => x.VersionID === vid && x.Kind === 'LABELING' && /Наименование, состав/.test(x.Requirement)));
  assert(!rows('PKL').some(x => x.VersionID === vid && x.Kind === 'PACKAGING'), 'упаковки в данных нет — не придумана');
  const refs = rows('REF').filter(x => x.VersionID === vid); assert(refs.some(x => /021/.test(x.Number) && x.Clause === 'Приложение 1') && refs.some(x => /022/.test(x.Number)) && refs.some(x => x.Number === 'ТТК T-01'), JSON.stringify(refs.map(x => x.Number)));
  assert(rows('IND').concat(rows('RAW'), rows('MET'), rows('PKL'), rows('REF')).filter(x => x.VersionID === vid).every(x => /^Авто: /.test(x.Notes)), 'автострока помечена');
  const td = r.auto.summary.todo.join('\n'); assert(/упаковке/.test(td) && /Методы контроля/.test(td) && /Органолептические показатели \(описание\)/.test(td), td);
  assert(r.auto.summary.notes.some(x => /подобраны по группе/.test(x)), 'предупреждение о группе продукции');
  assert.strictEqual(C._v66Doc_(r.tuId).Approver, 'Иванов И. И., директор');
  VID = vid; TUID = r.tuId;
});

t('Повторная сборка: правки человека и ручные строки остаются, автоматические обновляются без дублей', () => {
  J(C.v66SaveVersion(JSON.stringify({ versionId: VID, storageConditions: 'от +2 до +4 °C, в закрытой таре', organoleptic: 'вкус кисло-сладкий' }), ''));
  const km = rows('IND').find(x => x.VersionID === VID && x.Indicator === 'КМАФАнМ');
  J(C.v66SaveLine(JSON.stringify({ versionId: VID, kind: 'IND', id: km.IndicatorID, group: 'MICRO', indicator: 'КМАФАнМ', normMax: 500, unit: 'КОЕ/г', methodId: km.MethodID, notes: km.Notes })));
  J(C.v66SaveLine(JSON.stringify({ versionId: VID, kind: 'PKL', pkKind: 'PACKAGING', requirement: 'контейнер из полипропилена' })));
  ttkVer['T-01'].shelf = '18 ч';
  const r = J(C.v66Generate(JSON.stringify({ versionId: VID }))), v = C._v66Ver_(VID);
  assert.strictEqual(v.StorageConditions, 'от +2 до +4 °C, в закрытой таре', 'правка человека сохранена'); assert(r.kept.includes('Условия хранения'));
  assert.strictEqual(v.Organoleptic, 'вкус кисло-сладкий');
  assert.strictEqual(v.ShelfLife, '18 ч (ТТК T-01, версия 2)', 'автополе обновилось из ТТК');
  const ind = rows('IND').filter(x => x.VersionID === VID);
  assert.strictEqual(ind.filter(x => x.Indicator === 'КМАФАнМ').length, 1); assert.strictEqual(ind.find(x => x.Indicator === 'КМАФАнМ').NormMax, 500, 'ручная правка показателя осталась');
  assert.strictEqual(rows('RAW').filter(x => x.VersionID === VID).length, 2, 'без дублей сырья');
  assert.strictEqual(rows('MET').filter(x => x.VersionID === VID && /МУК 4\.2\.1018/.test(x.Name)).length, 1, 'метод не задвоился');
  assert(!r.todo.some(x => /упаковке/.test(x)), 'упаковка добавлена вручную — пробела нет');
  assert(C._v66Objs_('APR').some(x => x.Stage === 'Автосборка'));
});

t('Собирается только «Проект» / «Пересмотр»', () => {
  const v = C._v66Ver_(VID); C._v66Set_('VER', v._row, 'Status', 'TECH_REVIEW');
  assert.throws(() => J(C.v66Generate(JSON.stringify({ versionId: VID }))), /Проект/);
  C._v66Set_('VER', v._row, 'Status', 'PROJECT');
});

t('ТТК находится по названию продукции, если коды не указаны; срок «по категории» не подставляется', () => {
  ttkVer = {};
  const r = J(C.v66CreateTu(JSON.stringify({ number: 'ТУ-2', productName: 'Борщ' }))), v = C._v66Ver_(r.versionId);
  assert.strictEqual(C._v66Doc_(r.tuId).TTKCodes, 'T-01'); assert(r.auto.summary.notes.some(x => /найдена по названию/.test(x)));
  assert.strictEqual(String(v.ShelfLife), '', 'категорийный расчёт системы — не основание для ТУ');
  assert.strictEqual(String(v.StorageConditions), '');
});

t('Шлюз: v66Generate доступна странице и требует tu_edit', () => {
  const g = fs.readFileSync(path.join(app, 'zzz_MonChef_Gate.gs'), 'utf8');
  ['MC_GATE_CLIENT_', 'MC_GATE_MUT_'].forEach(k => assert(new RegExp('var ' + k + ' = \\[[^\\]]*"v66Generate"').test(g), k));
  assert(/var MC_GATE_PERM_ = \{[^}]*"v66Generate":"tu_edit"/.test(g) && /var MC_GATE_NEED_ = \{[^}]*"v66Generate":"tu_edit"/.test(g));
});
console.log('\nТУ автосборка: ' + n + ' проверок пройдено');
