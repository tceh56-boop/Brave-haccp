/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
// Мастер-промт 4.0, этап 3: связь «процессы ТТК → опасности ХАССП (V30) → меры → журналы» и проверка ППК V65 — настоящий код, имитация таблиц.
// Запуск: node tests/haccp_link.test.js
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert'), { make } = require('./gas_mock');
const app = path.join(__dirname, '..', 'app'), G = make('owner@example.com');
let n = 0; const t = (name, f) => { f(); n++; console.log('  ✓ ' + name); };
const sheets = {}; let writes = 0;
function sheet(name) { const s = { data: [], getName: () => name, getLastRow: () => s.data.length, getLastColumn: () => s.data.reduce((m, r) => Math.max(m, r.length), 0), setFrozenRows() {}, appendRow(r) { s.data.push(r.slice()); },
  getMaxRows: () => 1000, getMaxColumns: () => 26, getDataRange() { return s.getRange(1, 1, Math.max(1, s.data.length), Math.max(1, s.getLastColumn())); },
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
['TS2_Schema.gs', 'TS2_Core.gs', 'TS2_Reconcile.gs', 'TS2_Generate.gs', 'TS_TtkProcess.gs', 'MonChef_V30_ComplianceHaccpCore.gs', 'MonChef_V64_EconomyFlow.gs', 'MonChef_V64_Finance.gs', 'MonChef_V65_PPK.gs', 'TS_HaccpLink.gs'].forEach(f => {
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

const H30 = () => C._v30Rows_('HACCP_Опасности_V30'), P30 = () => C._v30Rows_('HACCP_Процессы_V30');
const risk = () => C._ts2Rows_('PPK_HACCP_RISK_MAP');
const TECH_A = 'Мясо нарезать. Жарить 6 мин при 180 °C. Охладить до +4 °C за 2 ч. Хранить при +2…+4 °C. Срок реализации 24 ч.';

t('Операции действующих ТТК → процессы и опасности в V30 как предложения (PROPOSED, без решения о значимости)', () => {
  reset([dish('A1', 'Говядина жареная', TECH_A, 24)], []);
  C._ttkpAnalyze_(null); const r = C._hzlSync_();
  assert(r.processesAdded >= 3 && r.hazardsProposed >= 3, JSON.stringify(r));
  const fry = P30().find(p => p[1] === 'FRY'); assert(fry && fry[0] === 'PROC-TTK-FRY' && fry[7] === 'DRAFT' && /A1/.test(fry[11]), 'процесс FRY с источником: ' + fry);
  const hz = H30().filter(h => h[1] === 'PROC-TTK-FRY'); assert(hz.some(h => /прожарке/.test(h[3])) && hz.some(h => /фритюрного жира/.test(h[3])) === false, 'опасности жарки из мастер-справочника');
  assert(H30().every(h => h[12] === 'PROPOSED' && h[9] === ''), 'решение о значимости не принимается системой');
  assert(risk().length === H30().length && risk().every(x => x.status === 'NEEDS_DECISION'), 'карта рисков: всё ждёт решения');
  assert(risk().find(x => x.processCode === 'FRY').journalId === 'J-KKT-THERMAL' && risk().find(x => x.processCode === 'COOL').journalId === 'J-COOLING', 'журналы контроля');
});
t('Повторная синхронизация идемпотентна; процессы первичной настройки V30 не дублируются (Хранение, Охлаждение)', () => {
  reset([dish('A1', 'Говядина жареная', TECH_A, 24)], []);
  C._v30Init_(); sheets['HACCP_Процессы_V30'].data.push(['P02', 'STORAGE', 'Хранение сырья', 2, '', '', '', 'DRAFT', '1', '', '', '', new Date(), 'x'], ['P05', 'COOLING', 'Охлаждение', 5, '', '', '', 'DRAFT', '1', '', '', '', new Date(), 'x']);
  C._ttkpAnalyze_(null); C._hzlSync_(); const n1 = H30().length, p1 = P30().length, ids = risk().map(x => x.riskId).join();
  const r2 = C._hzlSync_(); assert.strictEqual(r2.processesAdded + r2.hazardsProposed, 0); assert.strictEqual(H30().length, n1); assert.strictEqual(P30().length, p1);
  assert.strictEqual(risk().map(x => x.riskId).join(), ids, 'ID строк карты стабильны');
  assert(!P30().some(p => p[1] === 'STORE' || p[1] === 'COOL'), 'STORE → P02, COOL → P05');
  assert(H30().some(h => h[1] === 'P05' && /медленном охлаждении/.test(h[3])), 'опасность охлаждения — у процесса первичной настройки');
});
t('Решение человека: значима/нет с обоснованием; значимая без ККТ и доказательства → пробел; с мерой и доказательством или ККТ → под контролем', () => {
  reset([dish('A1', 'Говядина жареная', TECH_A, 24)], []);
  C._ttkpAnalyze_(null); C._hzlSync_();
  const id = H30().find(h => h[1] === 'PROC-TTK-FRY' && /прожарке/.test(h[3]))[0];
  assert.strictEqual(JSON.parse(C.haccpHazardDecide('tok', id, 'возможно')).success, false);
  assert.strictEqual(JSON.parse(C.haccpHazardDecide('tok', id, 'нет', '', '')).success, false, 'незначимая — только с обоснованием');
  J(C.haccpHazardDecide('tok', id, 'да', '', ''));
  assert.strictEqual(risk().find(x => x.v30HazardId === id).status, 'NO_CONTROL');
  assert(C._hzlGaps_().some(g => /прожарке/.test(g)), 'пробел для проверки ППК');
  J(C.haccpHazardDecide('tok', id, 'да', 'ОППУ: контроль температуры в толще термощупом', 'журнал бракеража, запись термощупа'));
  assert.strictEqual(risk().find(x => x.v30HazardId === id).status, 'CONTROLLED');
  const h = H30().find(x => x[0] === id); assert(h[9] === 'да' && h[12] === 'ACTIVE' && /решение: Шеф Петров/.test(h[14]));
  assert(audits.some(a => a[0] === 'HACCP_HAZARD_DECIDE' && a[2] === id), 'решение в журнале аудита');
  const id2 = H30().find(h => h[1] === 'PROC-TTK-CUT')[0];
  J(C.haccpHazardDecide('tok', id2, 'да', '', ''));
  sheets['HACCP_ТочкиКонтроля_V30'].data.push(['CCP-1', 'PROC-TTK-CUT', id2, 'OPRP', 'Исправность ножей и инвентаря', '', '', '', '', '', '', '', '', 'ACTIVE']);
  C._hzlSync_(); const rr = risk().find(x => x.v30HazardId === id2); assert(rr.status === 'CONTROLLED' && rr.controlType === 'OPRP' && rr.controlId === 'CCP-1');
});
t('Операция исчезла из ТТК: нерешённые предложения → ARCHIVED, решённые остаются и помечаются «пересмотреть»; при возврате — снова предложение', () => {
  reset([dish('A1', 'Говядина жареная', TECH_A, 24), dish('B1', 'Пюре', 'Картофель очистить. Варить 25 мин. Подают горячим.')], []);
  C._ttkpAnalyze_(null); C._hzlSync_();
  const boil = H30().find(h => h[1] === 'PROC-TTK-BOIL')[0], peel = H30().find(h => h[1] === 'PROC-TTK-PEEL')[0];
  J(C.haccpHazardDecide('tok', boil, 'нет', '', 'варка до кипения — по ТТК, микрофлора не выживает'));
  J(C.ttkProcSetStatus('tok', 'B1', 'ARCHIVED')); C._ttkpAnalyze_(null); const r = C._hzlSync_();
  assert(r.archived >= 1 && H30().find(h => h[0] === peel)[12] === 'ARCHIVED', 'нерешённое предложение снято');
  assert.strictEqual(H30().find(h => h[0] === boil)[12], 'ACTIVE', 'решение человека сохранено');
  assert.strictEqual(risk().find(x => x.v30HazardId === boil).status, 'OBSOLETE');
  assert(P30().find(p => p[0] === 'PROC-TTK-PEEL')[7] === 'ARCHIVED' && P30().find(p => p[0] === 'PROC-TTK-BOIL')[7] !== 'ARCHIVED');
  J(C.ttkProcSetStatus('tok', 'B1', 'ACTIVE')); C._ttkpAnalyze_(null); C._hzlSync_();
  assert.strictEqual(H30().find(h => h[0] === peel)[12], 'PROPOSED', 'операция вернулась — предложение снова');
  assert.strictEqual(risk().find(x => x.v30HazardId === boil).status, 'NOT_SIGNIFICANT');
});
t('Ручные опасности и процессы V30 не меняются; дубль по тексту не предлагается', () => {
  reset([dish('A1', 'Говядина жареная', TECH_A, 24)], []);
  C._v30Init_(); sheets['HACCP_Процессы_V30'].data.push(['PROC-TTK-FRY', 'FRY', 'Жарка', 4, '', '', 'Повар', 'ACTIVE', '2', '', '', 'мой процесс', new Date(), 'Шеф']);
  sheets['HACCP_Опасности_V30'].data.push(['HZ-MY', 'PROC-TTK-FRY', 'B', 'Выживание патогенов при недостаточной прожарке', '', 'термощуп', '', '', '', 'да', 'ККТ-1', 'журнал', 'ACTIVE', new Date(), 'Шеф']);
  C._ttkpAnalyze_(null); C._hzlSync_();
  assert.strictEqual(H30().filter(h => h[1] === 'PROC-TTK-FRY' && /прожарке/.test(h[3])).length, 1, 'дубль не создан');
  const my = H30().find(h => h[0] === 'HZ-MY'); assert(my[9] === 'да' && my[10] === 'ККТ-1' && my[12] === 'ACTIVE');
  assert.strictEqual(P30().find(p => p[0] === 'PROC-TTK-FRY')[7], 'ACTIVE', 'статус процесса предприятия не тронут');
});
t('Проверка ППК V65: пробелы ТТК → ХАССП блокируют утверждение, после решений — пункт пройден', () => {
  reset([dish('A1', 'Говядина жареная', TECH_A, 24)], []);
  C._ttkpAnalyze_(null);
  ['PPK', 'ACT', 'SEC'].forEach(k => C._v65Sh_(k));
  let ck = C._v65Check_('PPK-X').checks.find(x => x.code === 'TTK_HACCP');
  assert(ck.status === 'REVIEW' && ck.issues.some(i => /не связана с анализом опасностей/.test(i)), 'до связи: ' + JSON.stringify(ck));
  C._hzlSync_();
  H30().forEach(h => J(C.haccpHazardDecide('tok', h[0], 'да', 'ОППУ по инструкции', 'журнал')));
  ck = C._v65Check_('PPK-X').checks.find(x => x.code === 'TTK_HACCP'); assert.strictEqual(ck.status, 'PASS', JSON.stringify(ck));
  assert.strictEqual(C._v65Check_('PPK-X').checks.find(x => x.code === 'CCP').status, 'PASS', 'отсутствие ККТ обосновано решениями по опасностям');
});
console.log('haccp_link: ' + n + ' сценариев пройдено');
