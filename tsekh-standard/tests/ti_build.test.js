/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
// ТИ для поваров (V73): карточка на блюдо из ТТК — состав, технология, подача/хранение, фото, выход; ничего не дописывается.
// Запуск: node tests/ti_build.test.js   (TI_HTML=путь — сохранить HTML последней сборки)
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert'), { make } = require('./gas_mock');
const app = path.join(__dirname, '..', 'app'), G = make('owner@example.com');
let n = 0; const t = (name, f) => { f(); n++; console.log('  ✓ ' + name); };
const sheets = {};
const sheet = name => { const s = { data: [], getLastRow: () => s.data.length, getDataRange: () => ({ getValues: () => s.data.map(r => r.slice()) }) }; return s; };
const book = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = sheet(n)) };
let session = { user_id: 'E1', name: 'Шеф Петров', role: 'Шеф-повар' };
const DISHES = {
  '265': { code: '265', name: 'Салат «Зимний»', cat: 'Салаты', semi: false, ing: [['Майонез «Провансаль» 67%', 15, 'г', 15], ['Морковь отварная П/Ф', 12, 'г', 12], ['Яйцо куриное С2 (масса в скорлупе)', 8.8, 'г', 7.8], ['Картофель отварной очищенный', 30, 'г', 30]], yieldBase: 100, yieldUnit: 'г' },
  '364': { code: '364', name: 'Морковь отварная П/Ф', cat: 'ПФ горячий цех', semi: true, ing: [['Морковь', 1250, 'г', 1000]], yieldBase: 1000, yieldUnit: 'г' },
  '289': { code: '289', name: 'Борщ с говядиной', cat: 'Супы', semi: false, ing: [], yieldBase: 0, yieldUnit: 'г' }
};
sheets['Блюда'] = sheet('Блюда'); sheets['Блюда'].data = [['Код', 'Название', 'Категория', 'Выход', 'Кол-во', 'Технология', 'Файл'],
  ['265', 'Салат «Зимний»', 'Салаты', '', 4, 'Отварные картофель и морковь нарезают кубиком 0,5 см, соединяют, заправляют майонезом перед отпуском.', '265.xlsx'],
  ['364', 'Морковь отварная П/Ф', 'ПФ горячий цех', '', 1, 'Морковь варят при слабом кипении 25–30 мин, охлаждают до +4 °С не более 2 ч.', ''], ['289', 'Борщ с говядиной', 'Супы', '', 0, '', '']];
const ttkVer = { '265': { v: 3, tech: '', storage: 'при +2…+6 °С', shelf: '6 ч' } };
let saved = null; const audits = [];
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
Object.assign(G, { _book_: () => book, _mcTz_: () => 'Europe/Moscow', _withLock_: f => f(), _log_: () => {},
  _ok_: (d) => JSON.stringify({ success: true, data: d }), _fail_: (c, m) => JSON.stringify({ success: false, error: { code: c, message: m } }), _failFrom_: e => JSON.stringify({ success: false, error: { message: String(e.message || e) } }),
  _requireAuth_: () => session, _beginOp_: () => ({ id: 'OP', session }), _endOp_: () => {}, _audit_: (...a) => audits.push(a),
  _buildDishIndexes_: () => ({ dishByCode: DISHES, dishByNormName: {} }), _dishWorkshopMap_: () => ({}),
  _effectiveTTKVersion_: c => (ttkVer[c] ? ttkVer[c].v : 0), _ttkVersionsSheet_: () => null,
  _ttkFindVersion_: (sh, c, v) => (ttkVer[c] && ttkVer[c].v === v ? { data: [c, v, 'действующая', '', '', ttkVer[c].tech, '', '', '', '', ttkVer[c].storage, ttkVer[c].shelf] } : null),
  _shelfLifeFor_: c => (c === '364' ? { 'часы': 72, 'источник': 'база нормативов: «Морковь отварная» — таблица сроков' } : { 'часы': 12, 'источник': 'категория' }),
  _dpPhotoOf_: c => (c === '265' ? 'PH1' : ''), _docsFolder_: () => ({ createFolder: () => ({ getId: () => 'F' }) }),
  _mockPdf_: (title, body, opts) => { saved = { title, body, opts }; return { fileId: 'FILE', url: 'https://x/file', name: opts.fileName + '.pdf', sha256: 'h' }; } });
G.DriveApp.getFileById = () => ({ getBlob: () => ({ getContentType: () => 'image/png', getBytes: () => Buffer.from(PNG, 'base64') }) });
G.DriveApp.getFolderById = () => ({}); G.Utilities.base64Encode = b => Buffer.from(b).toString('base64'); G.Utilities.formatDate = () => '14.11.2026';
const ctx = vm.createContext(G);
['MonChef_V64_EconomyFlow.gs', 'MonChef_V64_Finance.gs', 'MonChef_OrgSettings.gs', 'MonChef_V73_TI.gs'].forEach(f => vm.runInContext(fs.readFileSync(path.join(app, f), 'utf8'), ctx, { filename: f }));
ctx._mcPdfSave_ = ctx._mockPdf_;
const C = ctx, J = s => { const r = JSON.parse(s); if (!r.success) throw new Error(r.error.message); return r.data; };
const dump = () => { if (process.env.TI_HTML) fs.writeFileSync(process.env.TI_HTML, C._mcPdfHtml_(saved.title, saved.body, saved.opts)); };

t('Одно блюдо: номер = ТТК, состав с брутто/нетто и ссылкой на П/Ф, технология из карточки, хранение и срок из версии ТТК, фото, выход', () => {
  const r = J(C.v73TiBuild(JSON.stringify({ codes: ['265'] }))), b = saved.body;
  assert.strictEqual(r.cards, 1); assert.strictEqual(saved.title, 'Технологическая инструкция № 265 «Салат «Зимний»»');
  assert(/№ 265&nbsp;&nbsp;&nbsp;Салат «Зимний»/.test(b) && /ТТК, версия 3/.test(b));
  assert(/Морковь отварная П\/Ф \(№ 364\)<\/td><td class="n">12<\/td><td class="n">12</.test(b), 'полуфабрикат со ссылкой на свою ТТК');
  assert(/Яйцо куриное С2 \(масса в скорлупе\)<\/td><td class="n">8,8<\/td><td class="n">7,8</.test(b), 'брутто и нетто');
  assert(/нарезают кубиком 0,5 см/.test(b), 'технология из карточки, если в версии пусто');
  assert(/Подача и хранение:<\/b> при \+2…\+6 °С; срок реализации — 6 ч <span class="src">\(ТТК, версия 3\)/.test(b));
  assert(/<img src="data:image\/png;base64,/.test(b), 'фото'); assert(/100 г \(1 порция\)/.test(b), 'выход');
  assert(!/МЕСТО ДЛЯ ФОТО/.test(b) && !/Оглавление/.test(b)); assert.deepStrictEqual(r.gaps, []);
  dump();
});
t('Полуфабрикат: «Хранение», срок из таблицы сроков; срок «по категории» не подставляется; пробелы честно отмечены', () => {
  const r = J(C.v73TiBuild(JSON.stringify({ codes: ['364', '289'] }))), b = saved.body;
  assert(/Хранение:<\/b> <span class="gap">не указано в ТТК<\/span>/.test(b) === false, 'у П/Ф есть срок');
  assert(/Хранение:<\/b> срок реализации — не более 72 ч/.test(b), b.slice(0, 300));
  const borsch = r.gaps.find(g => g.code === '289'); assert(borsch && ['состав', 'технология', 'выход', 'условия хранения', 'срок реализации', 'фото'].every(x => borsch.gaps.includes(x)), JSON.stringify(r.gaps));
  assert(!/12 ч/.test(b), 'категорийный срок не попал'); assert(/МЕСТО ДЛЯ ФОТО/.test(b));
  assert(b.indexOf('№ 289') < b.indexOf('№ 364'), 'блюда раньше полуфабрикатов'); assert(/Оглавление/.test(b));
});
t('Категория и всё меню: оглавление по категориям, номера ТТК в подзаголовке', () => {
  J(C.v73TiBuild(JSON.stringify({ category: 'Салаты' }))); assert(/Салат «Зимний»/.test(saved.body) && !/Борщ/.test(saved.body));
  const r = J(C.v73TiBuild(JSON.stringify({ all: true, photos: false }))); assert.strictEqual(r.cards, 3);
  assert(/<h2 class="cat">Салаты<\/h2>/.test(saved.body) && /<h2 class="cat">Супы<\/h2>/.test(saved.body)); assert(/№ 265–364/.test(saved.opts.subtitle)); assert(!/<img/.test(saved.body), 'без фото');
  assert(!r.gaps.some(g => g.gaps.includes('фото')), 'без фото — фото не пробел');
});
t('Проверки: пустой выбор и неизвестный номер', () => {
  assert.throws(() => J(C.v73TiBuild(JSON.stringify({}))), /Выберите/); assert.throws(() => J(C.v73TiBuild(JSON.stringify({ codes: ['999'] }))), /999/);
});
t('Список для экрана; шлюз и права', () => {
  const d = J(C.v73TiList('')); assert.deepStrictEqual(d.items.map(x => x.code), ['265', '289', '364']); assert.deepStrictEqual(d.categories, ['Салаты', 'Супы', 'ПФ горячий цех']);
  const g = fs.readFileSync(path.join(app, 'zzz_MonChef_Gate.gs'), 'utf8');
  assert(/var MC_GATE_CLIENT_ = \[[^\]]*"v73TiBuild"/.test(g) && /var MC_GATE_MUT_ = \[[^\]]*"v73TiBuild"/.test(g) && /"v73TiList":"catalog\|ttk_edit\|ttk_approve"/.test(g));
  assert(/ti: 'catalog\|ttk_edit\|ttk_approve'/.test(fs.readFileSync(path.join(app, 'MonChef_Rbac.gs'), 'utf8')));
});
console.log('\nТИ: ' + n + ' проверок пройдено');
