/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
// Мастер-промт 4.0, этап 4: V65 — единственный генератор ППК: мероприятия из карты рисков, прежние генераторы V35/V37 закрыты, перенос их данных в V30.
// Запуск: node tests/ppk_stage4.test.js
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert'), { make } = require('./gas_mock');
const app = path.join(__dirname, '..', 'app'), G = make('owner@example.com');
let n = 0; const t = (name, f) => { f(); n++; console.log('  ✓ ' + name); };
const sheets = {}; let writes = 0;
function sheet(name) { const s = { data: [], getName: () => name, getLastRow: () => s.data.length, getLastColumn: () => s.data.reduce((m, r) => Math.max(m, r.length), 0), setFrozenRows() {}, appendRow(r) { s.data.push(r.slice()); },
  getMaxRows: () => 1000, clearContents() { s.data = []; return s; }, deleteRows() {}, getSheetId: () => 1, getMaxColumns: () => 26, getDataRange() { return s.getRange(1, 1, Math.max(1, s.data.length), Math.max(1, s.getLastColumn())); },
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
  _requireAuth_: () => session, _beginOp_: () => ({ id: 'OP', session }), _endOp_: () => {}, _audit_: () => {}, _mcSessionFullName_: s => s && s.name || '', _getSession_: () => session, _parseDate_: x => new Date(x),
  _mcOrg_: () => ({ name: 'Кафе', responsibleName: 'Петрова' }), _mcOrgCompleteness_: () => ({ complete: true, missing: [] }), _mcRbEmpState_: () => ({}), _dishWorkshopMap_: () => ({}), JOURNALS: [], MC_RB_ROLES_: [] });
G.Utilities.formatDate = (d, tz, f) => { const x = new Date(d), p = v => String(v).padStart(2, '0'); return f.replace('yyyy', x.getFullYear()).replace('MM', p(x.getMonth() + 1)).replace('dd', p(x.getDate())).replace("'T'", 'T').replace('HH', p(x.getHours())).replace('mm', p(x.getMinutes())).replace('ss', p(x.getSeconds())); };
const ctx = vm.createContext(G);
['TS2_Schema.gs', 'TS2_Core.gs', 'TS2_Reconcile.gs', 'TS2_Generate.gs', 'TS_TtkProcess.gs', 'MonChef_V30_ComplianceHaccpCore.gs', 'MonChef_V64_EconomyFlow.gs', 'MonChef_V64_Finance.gs', 'MonChef_V65_PPK.gs', 'TS_HaccpLink.gs', 'MonChef_V35_PPK_HACCP_BUILDER.gs', 'MonChef_V37_TTK_PPK_BRIDGE.gs', 'TS_PpkLegacy.gs'].forEach(f => {
  const file = fs.readdirSync(app).find(x => x === f) || fs.readdirSync(app).find(x => x.startsWith(f.replace(/_[A-Z_]+\.gs$/, '')) && x.endsWith('.gs'));
  vm.runInContext(fs.readFileSync(path.join(app, file), 'utf8'), ctx, { filename: file });
});
const C = ctx; vm.runInContext("var MC_WASTE_MAX_DAYS_ = { 'пищевые': 1, 'ТКО': 3 };", ctx); C._ts2Ent_ = () => 'ENT-A'; C._ts2Audit_ = (...a) => audits.push(a); C._ts2EnsureSchema_ = () => {}; C._TS2_SH_ = {};
vm.runInContext('_TS2_SH_ = {};', ctx);
const J = s => { const r = JSON.parse(s); if (!r.success) throw new Error(r.error.message); return r.data; };
const HB = ['Код', 'Название', 'Категория', 'Выход', 'Ед', 'Технология', 'Фото', 'Цена', 'Цех', 'Срок, ч'];
const dish = (code, name, tech, shelf) => [code, name, 'Горячее', 250, 'г', tech, '', '', 'Горячий', shelf || ''];
const HS = ['Код', 'Продукт', 'Ед', 'Брутто', 'База', 'Нетто'];
const reset = (dishes, comp) => { Object.keys(sheets).forEach(k => delete sheets[k]); vm.runInContext('_TS2_SH_ = {};', ctx); table('Блюда', HB, dishes); table('Состав', HS, comp); table('ID_COUNTERS', ['counterCode', 'prefix', 'year', 'lastNumber', 'updatedAt', 'updatedBy'], []); };
const live = () => C._ts2Rows_('TTK_PROCESS_MAP').filter(r => r.reviewStatus !== 'SUPERSEDED');
const issues = code => C._ts2Rows_('TTK_PROCESS_ISSUES').filter(i => i.status === 'OPEN' && (!code || i.ttkId === code)).map(i => i.code);

const H30 = () => C._v30Rows_('HACCP_Опасности_V30'), P30 = () => C._v30Rows_('HACCP_Процессы_V30'), K30 = () => C._v30Rows_('HACCP_ТочкиКонтроля_V30');
const TECH = 'Мясо нарезать. Жарить 6 мин при 180 °C. Охладить до +4 °C за 2 ч. Хранить при +2…+4 °C. Срок реализации 24 ч.';
const base = () => { reset([dish('A1', 'Говядина жареная', TECH, 24), dish('A2', 'Курица жареная', 'Жарить 8 мин при 180 °C. Подают горячим.')], []); C._ttkpAnalyze_(null); C._hzlSync_(); };
const D0 = () => ({ ccp: [], mon: [], ctl: [], zones: [], sanPlans: [], lab: [], wplan: [], wsrc: [], pest: [], eq: [], places: [], dis: [] });

t('Мероприятия ППК из карты рисков: значимая опасность под мерой предприятия → событийное мероприятие с журналом; ККТ не дублируется; незначимая — без мероприятия', () => {
  base();
  const fry = H30().find(h => h[1] === 'PROC-TTK-FRY' && /прожарке/.test(h[3]))[0];
  J(C.haccpHazardDecide('tok', fry, 'да', 'ОППУ: температура в толще термощупом', 'журнал бракеража'));
  const cut = H30().filter(h => h[1] === 'PROC-TTK-CUT');
  J(C.haccpHazardDecide('tok', cut[0][0], 'нет', '', 'нож исправен, контроль инвентаря — ППУ'));
  const acts = C._v65AutoActivities_('PPK-1', D0(), {}).filter(a => /^Мера управления/.test(a[5]));
  assert.strictEqual(acts.length, 1, JSON.stringify(acts.map(a => a[5])));
  const a = acts[0];
  assert(a[2] === 'PROC-TTK-FRY' && /ТТК: 2/.test(a[4]) && /термощупом/.test(a[5]) && /прожарке/.test(a[5]), 'операция, ТТК, мера, опасность');
  assert(a[10] === 'J-KKT-THERMAL' && a[7] === 'при каждой выработке' && C._v65Interval_(a[7]) === 0, 'журнал и событийная периодичность (строка-правило графика)');
  assert(!/\d+\s*°/.test(a[6]), 'норматив не подставлен');
  sheets['HACCP_ТочкиКонтроля_V30'].data.push(['CCP-9', 'PROC-TTK-FRY', fry, 'ККТ', 'Температура в толще', '', '', '', '', '', '', '', '', 'ACTIVE']); C._hzlSync_();
  assert(!C._v65AutoActivities_('PPK-1', D0(), {}).some(x => /^Мера управления/.test(x[5])), 'опасность под ККТ — мероприятие даёт ККТ (D.ccp), не карта');
  assert(/Связь с технико-технологическими картами: операций \d+/.test(C._hzlSectionText_()) && /прожарке.*ККТ/.test(C._hzlSectionText_()), 'раздел «ХАССП и ККТ»');
});
t('V35 «Конструктор ППК» и V37 «ТТК → ППК» закрыты: ответ LEGACY_CLOSED, параллельные реестры не пополняются', () => {
  base(); C._v35Init_(); C._v37Init_();
  const before = ['Процессы_ППК_V35', 'Опасности_ХАССП_V35', 'CCP_OPRP_V35', 'ППК_V35', 'ППК_Master_V37', 'ППК_Контроли_V37'].map(n => sheets[n].data.length);
  [['v35CreateDraft', ['{}', 'tok']], ['v35AddProcess', ['{"name":"x"}', 'tok']], ['v35AddHazard', ['{}', 'tok']], ['v35AddControl', ['{}', 'tok']], ['v35Approve', ['D', 'tok']],
   ['v37CreateFromTtk', [{ ttkIds: ['A1'] }, 'tok']], ['v37AddControl', ['{}', 'tok']], ['v37Approve', ['D', 'tok']]].forEach(([f, args]) => {
    const r = JSON.parse(C[f](...args)); assert(!r.success && r.error.code === 'LEGACY_CLOSED', f); });
  assert.deepStrictEqual(['Процессы_ППК_V35', 'Опасности_ХАССП_V35', 'CCP_OPRP_V35', 'ППК_V35', 'ППК_Master_V37', 'ППК_Контроли_V37'].map(n => sheets[n].data.length), before);
  assert.strictEqual(typeof C.v35SetOrganization, 'function', 'реквизиты организации (шапка журналов) — не тронуты');
});
t('Перенос V35/V37 → V30: процессы, опасности (решение — только явное), меры; привязка мер V37 по операции; повтор без дублей; прежние данные не удаляются', () => {
  base(); C._v35Init_(); C._v37Init_();
  sheets['Процессы_ППК_V35'].data.push(['P1', 'Жарка мяса', 4, 'Горячий цех', 'Плита', 'п/ф', 'готовое', true, 'USER', 'DRAFT'], ['P2', 'Хранение сырья', 2, '', '', '', '', true, 'USER', 'DRAFT']);
  sheets['Опасности_ХАССП_V35'].data.push(['H1', 'P1', 'B', 'Сальмонелла в недожаренном мясе', '', 'прожарка', '', '', true, 'анализ 01.10', 'DRAFT'], ['H2', 'P1', 'P', 'Кость', '', '', '', '', false, 'USER', 'DRAFT']);
  sheets['CCP_OPRP_V35'].data.push(['C1', 'P1', 'ККТ', 'Температура в толще', '75', '°C', 'термощуп', 'каждая партия', 'Повар', 'дожарить', 'проверка журнала', 'СанПиН', 'DRAFT']);
  sheets['ППК_Процессы_V37'].data.push(['DOC1', 'PR1', 'A2', 'S1', 'Жарить 8 мин при 180 °C', '', '', '', '', true, 'TTK', 'DRAFT'], ['DOC1', 'PR2', 'A2', 'S2', 'Особая операция', '', '', '', '', true, 'TTK', 'DRAFT']);
  sheets['ППК_Контроли_V37'].data.push(['DOC1', 'K1', 'PR1', 'ОППУ', 'Цвет сока', '', '', 'визуально', 'каждая партия', 'Повар', 'дожарить', '', '', 'DRAFT'], ['DOC1', 'K2', 'PR2', 'ОППУ', 'Что-то', '', '', '', '', '', '', '', '', 'DRAFT']);
  const st = J(C.ppkLegacyState('tok')); assert(st.v35.hazards === 2 && st.v37.controls === 2 && st.importedToV30 === 0);
  const r = J(C.ppkLegacyImport('tok')); assert.deepStrictEqual([r.processes, r.hazards, r.controls, r.needBinding], [2, 2, 3, 1], JSON.stringify(r));
  const h1 = H30().find(h => h[0] === 'V35-H1'), h2 = H30().find(h => h[0] === 'V35-H2');
  assert(h1[9] === 'да' && h1[12] === 'ACTIVE' && /анализ 01.10/.test(h1[11]), 'явное «значима» перенесено');
  assert(h2[9] === '' && h2[12] === 'PROPOSED', '«нет» по умолчанию V35 решением не считается');
  assert.strictEqual(K30().find(k => k[0] === 'V35-C1')[5], '75', 'предел перенесён как был, не придуман');
  assert.strictEqual(K30().find(k => k[0] === 'V37-K1')[1], 'PROC-TTK-FRY', 'мера V37 привязана к процессу операции «жарка»');
  assert.strictEqual(K30().find(k => k[0] === 'V37-K2')[1], 'V37-UNBOUND', 'нераспознанная операция — «требуется привязка»');
  const n = [P30().length, H30().length, K30().length]; const r2 = J(C.ppkLegacyImport('tok'));
  assert.deepStrictEqual([r2.processes, r2.hazards, r2.controls], [0, 0, 0]); assert.deepStrictEqual([P30().length, H30().length, K30().length], n, 'повтор без дублей');
  assert.strictEqual(sheets['Опасности_ХАССП_V35'].data.length, 3, 'данные V35 не удалены');
  assert(audits.some(a => a[0] === 'PPK_LEGACY_IMPORT'));
  // после переноса V65 видит меры и опасности: проверка ККТ требует предел у переносённой меры V37
  ['PPK', 'ACT', 'SEC'].forEach(k => C._v65Sh_(k));
  const ccp = C._v65Check_('PPK-X').checks.find(x => x.code === 'CCP'); assert(ccp.issues.some(i => /Цвет сока.*критический предел/.test(i)), JSON.stringify(ccp.issues.slice(0, 5)));
});
t('Перенос: процесс V35 с тем же названием, что в ХАССП, не дублируется', () => {
  base(); C._v35Init_(); C._v37Init_();
  sheets['HACCP_Процессы_V30'].data.push(['P02', 'STORAGE', 'Хранение сырья', 2, '', '', '', 'DRAFT', '1', '', '', '', new Date(), 'x']);
  sheets['Процессы_ППК_V35'].data.push(['P2', 'Хранение сырья', 2, '', '', '', '', true, 'USER', 'DRAFT']);
  sheets['Опасности_ХАССП_V35'].data.push(['H9', 'P2', 'B', 'Рост микрофлоры на складе', '', '', '', '', false, 'USER', 'DRAFT']);
  const r = J(C.ppkLegacyImport('tok')); assert.strictEqual(r.processes, 0);
  assert.strictEqual(H30().find(h => h[0] === 'V35-H9')[1], 'P02');
});
t('Формирование ППК V65: связь ТТК → ХАССП пересчитывается перед формированием; мероприятия и раздел «ХАССП и ККТ» из карты рисков', () => {
  base();
  H30().forEach(h => J(C.haccpHazardDecide('tok', h[0], 'да', 'ОППУ по инструкции', 'журнал')));
  sheets['Блюда'].data[2][5] = 'Запекать 30 мин при 180 °C. Подают горячим.';   // A2: жарка → запекание, анализ ТТК без синхронизации ХАССП
  C._ttkpAnalyze_(null);
  const created = J(C.v65CreatePpk(JSON.stringify({ name: 'ППК', dateFrom: '2026-11-12' }), 'tok'));
  const id = created.ppkId || created.PPKID || created.id;
  J(C.v65Generate(id, 'tok'));
  assert(H30().some(h => h[1] === 'PROC-TTK-BAKE'), 'новая операция ТТК предложена в ХАССП при формировании ППК');
  const acts = C._v65Objs_('ACT').filter(a => String(a.PPKID) === String(id));
  assert(acts.some(a => /^Мера управления/.test(a.Parameter) && a.ProcessID === 'PROC-TTK-FRY'), 'мероприятие из карты рисков');
  const sec = C._v65Objs_('SEC').find(x => String(x.PPKID) === String(id) && x.SectionCode === 'HACCP');
  assert(/Связь с технико-технологическими картами/.test(sec.Text), 'раздел «ХАССП и ККТ»');
  const chk = C._v65Check_(id).checks.find(x => x.code === 'TTK_HACCP'); assert(chk.status === 'PASS', 'нерешённые новые опасности показывает пункт ККТ: ' + JSON.stringify(chk));
});
console.log('ppk_stage4: ' + n + ' сценариев пройдено');
