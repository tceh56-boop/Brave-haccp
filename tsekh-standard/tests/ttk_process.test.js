/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
// Мастер-промт 4.0, этап 2: TTK_PROCESS_ANALYZER на основном реестре ТТК («Блюда» + «Состав») — настоящий код, имитация таблиц.
// Запуск: node tests/ttk_process.test.js
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert'), { make } = require('./gas_mock');
const app = path.join(__dirname, '..', 'app'), G = make('owner@example.com');
let n = 0; const t = (name, f) => { f(); n++; console.log('  ✓ ' + name); };
const sheets = {}; let writes = 0;
function sheet(name) { const s = { data: [], getName: () => name, getLastRow: () => s.data.length, getLastColumn: () => s.data.reduce((m, r) => Math.max(m, r.length), 0), setFrozenRows() {}, appendRow(r) { s.data.push(r.slice()); },
  getMaxRows: () => 1000, getMaxColumns: () => 26,
  getRange(r, c, nr = 1, nc = 1) { return { setValues(v) { writes++; v.forEach((row, i) => { s.data[r - 1 + i] = s.data[r - 1 + i] || []; row.forEach((x, j) => { s.data[r - 1 + i][c - 1 + j] = x; }); }); return this; },
    getValues() { const o = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(((s.data[r - 1 + i] || [])[c - 1 + j]) ?? ''); o.push(row); } return o; },
    setValue(v) { writes++; s.data[r - 1] = s.data[r - 1] || []; s.data[r - 1][c - 1] = v; return this; }, getValue() { return ((s.data[r - 1] || [])[c - 1]) ?? ''; },
    setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; }, setNumberFormat() { return this; } }; } }; return s; }
const book = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = sheet(n)) };
const table = (name, head, rows) => { const s = book.getSheetByName(name) || book.insertSheet(name); s.data = [head.slice()].concat(rows.map(r => r.slice())); return s; };
let session = { user_id: 'E1', name: 'Шеф Петров', role: 'Шеф-повар' };
const audits = [];
Object.assign(G, { _book_: () => book, _mcTz_: () => 'Europe/Moscow', _withLock_: f => f(), _log_: () => {}, mcGateSession_: () => session,
  _ok_: d => JSON.stringify({ success: true, data: d }), _fail_: (c, m) => JSON.stringify({ success: false, error: { code: c, message: m } }), _failFrom_: e => JSON.stringify({ success: false, error: { message: String(e.message || e) } }),
  _requireAuth_: () => session, _beginOp_: () => ({ id: 'OP', session }), _endOp_: () => {}, _audit_: () => {}, _mcSessionFullName_: s => s && s.name || '' });
G.Utilities.formatDate = (d, tz, f) => { const x = new Date(d), p = v => String(v).padStart(2, '0'); return f.replace('yyyy', x.getFullYear()).replace('MM', p(x.getMonth() + 1)).replace('dd', p(x.getDate())).replace("'T'", 'T').replace('HH', p(x.getHours())).replace('mm', p(x.getMinutes())).replace('ss', p(x.getSeconds())); };
const ctx = vm.createContext(G);
['TS2_Schema.gs', 'TS2_Core.gs', 'TS2_Reconcile.gs', 'TS_TtkProcess.gs', 'MonChef_V36_TTK_MASTER.gs', 'MonChef_V37_TTK_PPK_BRIDGE.gs'].forEach(f => {
  const file = fs.readdirSync(app).find(x => x === f) || fs.readdirSync(app).find(x => x.startsWith(f.replace(/_[A-Z_]+\.gs$/, '')) && x.endsWith('.gs'));
  vm.runInContext(fs.readFileSync(path.join(app, file), 'utf8'), ctx, { filename: file });
});
const C = ctx; C._ts2Ent_ = () => 'ENT-A'; C._ts2Audit_ = (...a) => audits.push(a); C._ts2EnsureSchema_ = () => {}; C._TS2_SH_ = {};
vm.runInContext('_TS2_SH_ = {};', ctx);
const J = s => { const r = JSON.parse(s); if (!r.success) throw new Error(r.error.message); return r.data; };
const HB = ['Код', 'Название', 'Категория', 'Выход', 'Ед', 'Технология', 'Фото', 'Цена', 'Цех', 'Срок, ч'];
const dish = (code, name, tech, shelf) => [code, name, 'Горячее', 250, 'г', tech, '', '', 'Горячий', shelf || ''];
const HS = ['Код', 'Продукт', 'Ед', 'Брутто', 'База', 'Нетто'];
const reset = (dishes, comp) => { Object.keys(sheets).forEach(k => delete sheets[k]); vm.runInContext('_TS2_SH_ = {};', ctx); table('Блюда', HB, dishes); table('Состав', HS, comp); table('ID_COUNTERS', ['counterCode', 'prefix', 'year', 'lastNumber', 'updatedAt', 'updatedBy'], []); };
const live = () => C._ts2Rows_('TTK_PROCESS_MAP').filter(r => r.reviewStatus !== 'SUPERSEDED');
const issues = code => C._ts2Rows_('TTK_PROCESS_ISSUES').filter(i => i.status === 'OPEN' && (!code || i.ttkId === code)).map(i => i.code);

t('Распознавание: основные правила, синонимы, су-вид, вакуумирование, шоковое охлаждение; значения режимов не придумываются', () => {
  reset([dish('T1', 'Говядина су-вид', 'Мясо зачистить от плёнок. Вакуумировать. Готовить су-вид при 58 °C 24 часа. Шоковое охлаждение до +4 °C за 90 мин. Хранить в холодильнике при +2…+4 °C. Срок реализации 72 ч.', 72)], [['T1', 'Говядина', 'кг', 0.3, 0, 0.25]]);
  const r = C._ttkpAnalyze_(null);
  const codes = r.ttk[0].processes; ['VACUUM', 'SOUSVIDE', 'BLAST', 'STORE'].forEach(c => assert(codes.includes(c), c + ' не найден: ' + codes));
  const rows = live(); assert(rows.every(x => x.organizationId === 'ENT-A' && x.locationId === 'ENT-A' && /^T1@[0-9a-f]{12}$/.test(x.ttkVersion)));
  assert(rows.every(x => !/°|\d/.test(x.processCode)), 'в карте нет придуманных значений');
  assert(!issues('T1').includes('NO_COOLING_STAGE') && !issues('T1').includes('NO_PARAMS'), 'охлаждение и параметры описаны: ' + issues('T1'));
});
t('Замечания полноты «Требуется заполнение ТТК»: нет охлаждения, нет параметров, нет срока, нет технологии', () => {
  reset([dish('T2', 'Рис отварной', 'Рис промыть. Варить до готовности. Хранить в холодильнике.'), dish('T3', 'Салат', '')], [['T2', 'Рис', 'кг', 0.1, 0, 0.1]]);
  C._ttkpAnalyze_(null);
  const i2 = issues('T2'); ['NO_COOLING_STAGE', 'NO_PARAMS', 'NO_SHELF_LIFE', 'NO_STORAGE_CONDITIONS'].forEach(c => assert(i2.includes(c), c + ': ' + i2));
  assert(issues('T3').includes('NO_TECHNOLOGY'));
  assert.strictEqual(sheets['Блюда'].data[1][5], 'Рис промыть. Варить до готовности. Хранить в холодильнике.', 'текст ТТК не изменён анализом');
});
t('Вложенные полуфабрикаты: процессы п/ф попадают в блюдо (NESTED), п/ф без ТТК — замечание, цикл — замечание без зависания', () => {
  reset([
    dish('B1', 'Бефстроганов', 'Обжарить соус и говядину 5 мин при 180 °C. Подают горячим.'),
    dish('S1', 'Соус демиглас', 'Кости запечь 40 мин при 200 °C. Варить 8 часов. Охладить до +4 °C за 2 ч. Разлить в гастроёмкости. Хранить при +2…+4 °C. Срок реализации 48 ч.', 48),
    dish('C1', 'Тесто А', 'Смешать.'), dish('C2', 'Тесто Б', 'Смешать.')
  ], [['B1', 'Говядина', 'кг', 0.2, 0, 0.2], ['B1', 'Соус демиглас п/ф', 'кг', 0.05, 0, 0.05], ['B1', 'Бульон куриный п/ф', 'кг', 0.05, 0, 0.05], ['C1', 'Тесто Б', 'кг', 1, 0, 1], ['C2', 'Тесто А', 'кг', 1, 0, 1]]);
  const r = C._ttkpAnalyze_(null);
  const b1 = live().filter(x => x.ttkId === 'B1');
  assert(b1.some(x => x.parentTtkId === 'S1' && x.detectionMethod === 'NESTED' && x.processCode === 'BAKE'), 'процесс п/ф S1 в карте блюда B1');
  assert(b1.some(x => x.parentTtkId === 'S1' && x.processCode === 'COOL'));
  assert(issues('B1').includes('SEMI_LINK_MISSING'), 'п/ф «Бульон куриный» без ТТК');
  assert(issues('C1').includes('CYCLE') && issues('C2').includes('CYCLE'), 'цикл C1↔C2');
  assert(!issues('S1').includes('NO_PACKAGING'), 'гастроёмкость — упаковка указана');
  assert(r.ttk.find(x => x.ttkId === 'B1').nested.includes('S1'));
});
t('Идемпотентность и версия ТТК: повтор не плодит строки; изменение технологии — разница (добавлено/устарело), решения людей сохраняются', () => {
  reset([dish('T4', 'Котлета', 'Фарш порционировать. Жарить 6 мин при 180 °C. Довести в духовке до 75 °C в толще. Подают горячим.')], [['T4', 'Фарш', 'кг', 0.1, 0, 0.1]]);
  const a = C._ttkpAnalyze_(null), n1 = live().length;
  const b = C._ttkpAnalyze_(null); assert.strictEqual(live().length, n1); assert.strictEqual(b.added.length, 0); assert.strictEqual(b.removed.length, 0);
  const fry = live().find(x => x.processCode === 'FRY'); J(C.ttkProcReview('tok', fry.id, 'CONFIRMED', '', 'проверено'));
  sheets['Блюда'].data[1][5] = 'Фарш порционировать. Жарить 6 мин при 180 °C. Охладить до +4 °C за 2 ч. Хранить при +2…+4 °C. Срок реализации 24 ч.';
  const c = C._ttkpAnalyze_(['T4']);
  assert(c.added.some(x => /COOL/.test(x)), 'добавлено охлаждение: ' + c.added);
  assert(c.removed.some(x => /BAKE|SALE/.test(x)), 'исчезнувшие операции → SUPERSEDED: ' + c.removed);
  assert.strictEqual(live().find(x => x.id === fry.id).reviewStatus, 'CONFIRMED', 'решение человека сохранено');
  assert.notStrictEqual(live().find(x => x.id === fry.id).ttkVersion, fry.ttkVersion, 'версия ТТК обновлена');
  assert(C._ts2Rows_('TTK_PROCESS_MAP').some(x => x.reviewStatus === 'SUPERSEDED'), 'история не удаляется');
});
t('Статус ТТК: черновик не входит в активную модель (DRAFT_ANALYSIS), архив — не анализируется', () => {
  reset([dish('A1', 'Плов', 'Тушить 40 мин. Подают горячим.'), dish('D1', 'Новое блюдо', 'Запекать 30 мин при 180 °C.'), dish('X1', 'Старое блюдо', 'Варить.')], []);
  J(C.ttkProcSetStatus('tok', 'D1', 'DRAFT')); J(C.ttkProcSetStatus('tok', 'X1', 'ARCHIVED'));
  assert.strictEqual(sheets['Блюда'].data[0][10], 'Статус ТТК', 'колонка статуса в конце листа');
  C._ttkpAnalyze_(null); assert(!live().some(x => x.ttkId === 'D1' || x.ttkId === 'X1'), 'общий анализ — только действующие');
  C._ttkpAnalyze_(['D1']); assert(live().filter(x => x.ttkId === 'D1').every(x => x.reviewStatus === 'DRAFT_ANALYSIS'));
  const model = C._ttkpActiveModel_(); assert(!model.some(p => p.ttk.includes('D1')), 'черновик не в модели ППК');
  assert(model.some(p => p.processCode === 'STEW' && p.ttk.includes('A1')));
});
t('Неоднозначность → REVIEW_REQUIRED; справочник расширяется предприятием; неверное правило отклоняется', () => {
  reset([dish('M1', 'Овощи', 'Обжарить или запечь до готовности 10 мин. Подают горячим.')], []);
  C._ttkpAnalyze_(null);
  assert(live().filter(x => ['FRY', 'BAKE'].includes(x.processCode)).every(x => x.reviewStatus === 'REVIEW_REQUIRED' && Number(x.confidence) <= 0.6), 'выбор «или» — на проверку');
  assert.strictEqual(JSON.parse(C.ttkProcDictionarySave('tok', { code: 'SMOKE', name: 'Копчение', category: 'THERMAL', detectionRule: '([' })).success, false);
  J(C.ttkProcDictionarySave('tok', { code: 'SMOKE', name: 'Копчение', category: 'THERMAL', detectionRule: 'копт|копч' }));
  sheets['Блюда'].data[1][5] = 'Коптить 2 часа при 80 °C.'; C._ttkpAnalyze_(null);
  assert(live().some(x => x.processCode === 'SMOKE'), 'новая операция распознана');
  assert(C._ts2Rows_('TTK_PROCESS_DICTIONARY').find(x => x.code === 'SMOKE').source === 'предприятие');
  assert.strictEqual(JSON.parse(C.ttkProcReview('tok', 'нет', 'APPROVED')).success, false, 'только CONFIRMED/REJECTED');
});
t('Сотни ТТК: 400 карт с вложенностью — пакетная запись (без построчных обращений), повторный запуск без изменений ничего не пишет', () => {
  const D = [], S = [];
  for (let i = 0; i < 400; i++) {
    D.push(dish('P' + i, 'Блюдо ' + i, 'Нарезать. Варить 20 мин при 100 °C. Охладить до +4 °C за 2 ч. Хранить при +2…+6 °C. Срок реализации 24 ч. Подают холодным.', 24));
    if (i > 0) S.push(['P' + i, 'Блюдо ' + (i - 1) + ' п/ф', 'кг', 0.1, 0, 0.1]);
  }
  reset(D, S); writes = 0; const t0 = Date.now();
  const r = C._ttkpAnalyze_(null); const w1 = writes;
  assert.strictEqual(r.analyzed, 400); assert(w1 < 30, 'пакетная запись: ' + w1 + ' обращений');
  assert(r.rows < 400 * 12, 'карта растёт линейно (прямые п/ф), а не по всей цепочке: ' + r.rows);
  const deep = C._ttkpProcessesOf_('P399'); assert(deep.some(x => x.ttkId === 'P1' && x.parentTtkId === 'P0'), 'операции п/ф на глубине 399 раскрываются при чтении');
  writes = 0; const r2 = C._ttkpAnalyze_(null);
  assert.strictEqual(r2.added.length + r2.removed.length, 0); assert(writes <= 2, 'без изменений — без записи: ' + writes);
  assert(Date.now() - t0 < 20000, 'время на модели');
  const ids = C._ts2Rows_('TTK_PROCESS_MAP').map(x => x.id); assert.strictEqual(new Set(ids).size, ids.length, 'ID уникальны');
});
t('V37 строит ППК по основному реестру (без импорта V36): ТТК, вложенные п/ф и операции из анализатора', () => {
  reset([dish('B1', 'Бефстроганов', 'Обжарить 5 мин при 180 °C.'), dish('S1', 'Соус демиглас', 'Варить 8 часов. Охладить до +4 °C.')], [['B1', 'Соус демиглас п/ф', 'кг', 0.05, 0, 0.05]]);
  C._ttkpAnalyze_(null);
  const d = J(C.v37CreateFromTtk({ ttkIds: ['B1'] }, 'tok'));
  assert.strictEqual(d.ttkCount, 2, 'блюдо + полуфабрикат'); assert(d.processCount >= 3, 'операции из TTK_PROCESS_MAP: ' + d.processCount);
  const procs = sheets['ППК_Процессы_V37'].data.slice(1); assert(procs.every(p => p[10] === 'TTK_PROCESS_MAP'));
  assert.strictEqual(sheets['ППК_Master_V37'].data[1][10], 'TTK_REGISTRY');
});
console.log('ttk_process: ' + n + ' сценариев пройдено');
