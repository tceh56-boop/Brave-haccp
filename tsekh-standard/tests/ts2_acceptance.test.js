// Приёмочные сценарии ЦЕХ Стандарт 2.0–2.2 (ТЗ 2.0 §20, 2.1 §21, 2.2 §14) на имитации Apps Script.
// Запуск: node tests/ts2_acceptance.test.js
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert'), { make } = require('./gas_mock');
const root = path.join(__dirname, '..');
const G = make('owner@example.com');
// таблица: листы с поддержкой всего, что использует ядро 2.0
function sheet(name) {
  const s = { data: [], getName: () => name, getLastRow: () => s.data.length, getLastColumn: () => Math.max(0, ...s.data.map(r => r.length)), getMaxRows: () => 1000, getMaxColumns: () => 50,
    setFrozenRows() {}, getProtections: () => [], protect: () => ({ setDescription() { return this; }, setWarningOnly() { return this; } }),
    appendRow(r) { s.data.push(r.slice()); },
    getRange(r, c, nr = 1, nc = 1) { return {
      setValues(v) { v.forEach((row, i) => { s.data[r - 1 + i] = s.data[r - 1 + i] || []; row.forEach((x, j) => { s.data[r - 1 + i][c - 1 + j] = x; }); }); return this; },
      getValues() { const o = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(((s.data[r - 1 + i] || [])[c - 1 + j]) ?? ''); o.push(row); } return o; },
      getValue() { return ((s.data[r - 1] || [])[c - 1]) ?? ''; }, setValue(v) { s.data[r - 1] = s.data[r - 1] || []; s.data[r - 1][c - 1] = v; return this; },
      setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; }, setNumberFormat() { return this; } }; } };
  return s;
}
const sheets = {}; const book = { getId: () => 'BOOK', getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = sheet(n)), getSheets: () => Object.values(sheets) };
function legacy(name, head, rows) { const s = book.insertSheet(name); s.data.push(head); rows.forEach(r => s.data.push(r)); }
const files = {};
const folder = () => ({ getId: () => 'FOLDER', getUrl: () => 'u', isTrashed: () => false, getFoldersByName: () => ({ hasNext: () => false }), createFolder: folder,
  createFile: (n, content) => { const id = 'FILE' + Math.random().toString(36).slice(2, 9); files[id] = typeof content === 'string' ? content : ''; return { getId: () => id, getUrl: () => 'u' }; } });
let docs = 0;
G.DriveApp = { getFolderById: folder, getFoldersByName: () => ({ hasNext: () => false }), createFolder: folder,
  getFileById: id => ({ moveTo() {}, getBlob: () => ({ getDataAsString: () => files[id] || '' }), getAs: () => ({ setName() { return this; } }), makeCopy: () => ({ getId: () => 'COPY', getSize: () => 1, getUrl: () => 'u' }) }) };
G.DocumentApp = { ParagraphHeading: {}, create: () => { docs++; const p = { setHeading() { return p; } }; return { getId: () => 'DOC' + docs, saveAndClose() {}, getBody: () => ({ appendParagraph: () => p, appendTable() {} }) }; } };
G.SpreadsheetApp.ProtectionType = { SHEET: 'SHEET' };
G.Utilities.newBlob = () => ({}); G.Utilities.formatDate = (d, tz, f) => { const x = new Date(d), p = n => String(n).padStart(2, '0');
  return f.replace('yyyy', x.getFullYear()).replace('MM', p(x.getMonth() + 1)).replace('dd', p(x.getDate())).replace("'T'", 'T').replace('HH', p(x.getHours())).replace('mm', p(x.getMinutes())).replace('ss', p(x.getSeconds())); };
let session = null; const recorded = [];
Object.assign(G, { _book_: () => book, _mcTz_: () => 'Europe/Moscow', _withLock_: f => f(), _log_: () => {}, mcGateSession_: () => session,
  _ok_: d => JSON.stringify({ success: true, data: d }), _fail_: (c, m) => JSON.stringify({ success: false, error: { code: c, message: m } }),
  _failFrom_: e => JSON.stringify({ success: false, error: { message: String(e.message || e) } }), _requireAuth_: () => session || {},
  _mcRbHas_: (s, p) => s.role === 'Ответственный за ХАССП' || s.role === 'Директор', getRolePermissions: () => ({ journals: true, haccp: true }),
  _mcOrg_: () => ({ name: 'Тест', inn: '7700000000' }), _mcOrgCompleteness_: () => ({ complete: true }),
  mcRecordTemperature: (j) => { recorded.push(JSON.parse(j)); return JSON.stringify({ success: true }); },
  _tsLicense_: () => ({ plan: 'pro_max' }), _tsPlanFeatures_: () => ({ lab: true, ppk: true, journals: true }),
  _findProduction_: () => ({ data: { 0: 'D-1' } }), _productionSheet_: () => null, PROD_COL_: { code: 0 }, _tccpState_: () => G.__ccp });
legacy('Блюда', ['Код', 'Название', 'Категория', 'Выход', 'Кол-во', 'Технология', 'Файл', 'Шаги', 'Цех', 'Срок реализации (ч)'], [
  ['D-1', 'Котлета куриная', 'Горячие блюда', '150 г', 2, 'Филе нарезать, сформовать котлеты. Обжарить и запекать до температуры в толще не ниже 75 °C. Хранить при t от +2 до +6 °C.', '', '', 'Горячий цех', 24],
  ['D-2', 'Салат без срока', 'Салаты', '200 г', 1, 'Овощи промыть, нарезать, заправить. Тушить 10 минут.', '', '', 'Холодный цех', ''],
  ['D-3', 'Котлета куриная', 'Горячие блюда', '', 0, '', '', '', 'Горячий цех', ''],
  ['D-4', 'Соус сливочный', 'Соусы', '', 1, 'Сливки довести до кипения.', '', '', 'Горячий цех', '']]);
legacy('Состав', ['code', 'name', 'unit', 'qty', 'base', 'netto'], [['D-1', 'Филе куриное', 'г', 120, 0, 110], ['D-1', 'Сливки', 'мл', 20, 0, 20], ['D-2', 'Огурец', 'г', 100, 0, 90], ['D-4', 'Сливки', 'мл', 200, 0, 180]]);
legacy('Сотрудники', ['last', 'first', 'middle', 'pos', 'role'], []);
legacy('Температурные_Объекты', ['ObjectID', 'Тип', 'Название', 'EquipmentID', 'Мин', 'Макс', 'Ед.', 'Статус', 'Установленная t°', 'Время проверок'], [['T-1', 'REFRIGERATOR', 'Холодильник 1', '', 2, 6, '°C', 'ACTIVE', 4, '09:00']]);
const ctx = vm.createContext(G);
['TS2_Schema.gs', 'TS2_Core.gs', 'TS2_Documents.gs', 'TS2_Reconcile.gs', 'TS2_Ready.gs', 'TS2_Generate.gs'].forEach(f => vm.runInContext(fs.readFileSync(path.join(root, 'app', f), 'utf8'), ctx, { filename: f }));
const C = ctx, J = s => { const r = JSON.parse(s); if (!r.success) throw new Error(r.error.message); return r.data; };
const rows = n => C._ts2Rows_(n);
let pass = 0; const t = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

t('схема: повторная установка не создаёт дублей листов и ID уникальны', () => {
  const a = C._ts2EnsureSchema_(false), b = C._ts2EnsureSchema_(false);
  assert(a.sheetsCreated > 30 && b.sheetsCreated === 0);
  const ids = new Set([1, 2, 3].map(() => C._ts2Id_('APPROVAL_QUEUE'))); assert.strictEqual(ids.size, 3);
});
t('2.1: initializeReadyToWork идемпотентен (25 документов, 9 зон, правила событий)', () => {
  const r1 = C._ts2InitializeReadyToWork_('READY_TO_WORK', 'RESTAURANT'), r2 = C._ts2InitializeReadyToWork_('READY_TO_WORK', 'RESTAURANT');
  assert.strictEqual(rows('SYSTEM_DOCUMENTS').length, 25); assert.strictEqual(rows('WORKSHOPS').length, 9);
  assert.strictEqual(rows('EVENT_RULES').length, C.TS2_EVENT_RULES_.length); assert.strictEqual(r2.created.documents, 0);
  assert(r1.backupId === '' || /BKP/.test(r1.backupId));
  assert.strictEqual(rows('MEASUREMENT_OBJECTS').filter(o => o.legacyObjectId === 'T-1').length, 1, 'холодильник из старого реестра');
  assert(rows('APPROVAL_QUEUE').length >= 15, 'документы на утверждение предприятия');
});
t('2.1: расписание дня создаётся один раз', () => {
  const n1 = C._ts2GenerateDay_('2026-11-10'), n2 = C._ts2GenerateDay_('2026-11-10');
  assert(n1 > 5); assert.strictEqual(n2, 0);
});
t('2.1: выпуск без замера ККТ — число не выдумывается, создаётся ожидание замера', () => {
  G.__ccp = { items: [{ controlId: 'C1', point: 'Тепловая обработка', status: 'MISSING' }] };
  C._ts2OnGateCall_('completeProduction', ['P-1', 10], JSON.stringify({ success: true, data: {} }));
  const thermal = rows('AUTO_RECORDS').filter(r => r.productionId === 'P-1' && r.recordType === 'HACCP_FACT');
  assert.strictEqual(thermal.length, 1); assert.strictEqual(thermal[0].result, 'PENDING_CONFIRMATION'); assert.strictEqual(String(thermal[0].value), '');
  assert(rows('JOURNAL_EXPECTATIONS').some(e => e.productionId === 'P-1' && e.confirmationMode === 'MEASURE'));
});
t('2.1: повтор события не создаёт дублей (ключ предприятие+производство+ККТ+событие+версия)', () => {
  const before = rows('AUTO_RECORDS').length;
  C._ts2OnGateCall_('completeProduction', ['P-1', 10], JSON.stringify({ success: true, data: {} }));
  assert.strictEqual(rows('AUTO_RECORDS').length, before);
});
t('2.1: фактический замер из ККТ переносится с источником; отклонение — исключение', () => {
  G.__ccp = { items: [{ controlId: 'C1', point: 'Тепловая обработка', status: 'DEVIATION', value: 62, unit: '°C', factId: 'F-9', who: 'Иванов' }] };
  C._ts2OnGateCall_('completeProduction', ['P-2', 5], JSON.stringify({ success: true, data: {} }));
  const r = rows('AUTO_RECORDS').filter(x => x.productionId === 'P-2' && x.recordType === 'HACCP_FACT')[0];
  assert.strictEqual(r.result, 'FAIL'); assert.strictEqual(Number(r.value), 62); assert(/F-9/.test(r.sourceType));
  assert(rows('AUTO_RECORDS').some(x => x.recordType === 'DEVIATION' && /62/.test(x.value)));
});
t('2.1: неудачная операция шлюза событий не создаёт', () => {
  const before = rows('AUTO_RECORDS').length;
  C._ts2OnGateCall_('completeProduction', ['P-3', 5], JSON.stringify({ success: false }));
  assert.strictEqual(rows('AUTO_RECORDS').length, before);
});
t('2.1: экран повара — «Да», «Нет» только с причиной, замер вне нормы требует комментарий', () => {
  session = { name: 'Петров', role: 'Повар горячего цеха' };
  const tasks = C._ts2NowTasks_(), conf = tasks.find(x => x.mode === 'CONFIRM'), fr = tasks.find(x => x.measure && x.measure.kind === 'FRIDGE');
  assert(conf && fr);
  assert.throws(() => C._ts2Confirm_(conf.id, false, ''), /причину/);
  assert.strictEqual(C._ts2Confirm_(conf.id, true).result, 'CONFIRMED_BY_OPERATOR');
  assert.throws(() => C._ts2Confirm_(conf.id, true), /закрыта/);
  assert.throws(() => C._ts2Confirm_(fr.id, true), /замер/);
  assert.throws(() => C._ts2Measure_(fr.id, 9), /комментарий/);
  assert.strictEqual(C._ts2Measure_(fr.id, 4).result, 'PASS');
  assert.strictEqual(recorded.length, 1, 'замер холодильника записан и в прежний журнал температур');
});
t('2.1: цепочка хешей автозаписей и аудита не нарушена', () => {
  const ar = rows('AUTO_RECORDS'); for (let i = 1; i < ar.length; i++) assert.strictEqual(ar[i].prevHash, ar[i - 1].hash);
  const v = C._ts2VerifyAudit_(); assert(v.records > 0 && v.broken.length === 0, JSON.stringify(v));
});
t('2.1: технический доступ не утверждает документы предприятия; ответственный — утверждает', () => {
  const q = rows('APPROVAL_QUEUE').find(x => x.requiredRole === 'Ответственный за ХАССП' && x.status === 'PENDING');
  session = { name: 'Тех', role: '', dev: true }; assert.throws(() => C._ts2ApproveQueue_(q.approvalId, true), /технический/);
  session = { name: 'Повар', role: 'Повар горячего цеха' }; assert.throws(() => C._ts2ApproveQueue_(q.approvalId, true), /утверждает/);
  session = { name: 'Сидорова', role: 'Ответственный за ХАССП' }; assert.strictEqual(C._ts2ApproveQueue_(q.approvalId, true).status, 'APPROVED');
});
t('2.2: полная ТТК → ТУ, СТО, ППК; предел ККТ взят из текста ТТК с источником', () => {
  const card = C._ts2GenPreview_('D-1');
  assert(!card.issues.some(i => i.severity === 'BLOCKER'), JSON.stringify(card.issues)); assert(card.canApply);
  assert(card.controls.some(c => /75/.test(c.criticalLimit) && /ТТК D-1/.test(c.limitSource)));
  const again = C._ts2GenPreview_('D-1'); assert(again.existing && again.job.generationJobId === card.job.generationJobId, 'повторный предпросмотр той же версии ТТК — тот же пакет');
  const applied = C._ts2GenApply_(card.job.generationJobId);
  assert.strictEqual(applied.documents.tu.length, 1); assert.strictEqual(applied.documents.sto.length, 1); assert.strictEqual(applied.documents.ppk.length, 1);
  assert.strictEqual(applied.documents.ppk[0].changeType, 'INITIAL');
  assert(rows('DOCUMENT_SOURCE_LINKS').length >= 10);
  assert(rows('EVENT_RULES').filter(r => r.sourceTtkId === 'D-1').every(r => String(r.active) === 'false'), 'правила неактивны до утверждения');
  C._ts2GenApply_(card.job.generationJobId); assert.strictEqual(rows('PPK_DOCUMENTS').length, 1, 'повторное применение без дублей');
  session = { name: 'Сидорова', role: 'Ответственный за ХАССП' };
  const q = rows('APPROVAL_QUEUE').find(x => x.objectType === 'GENERATION_PACKAGE');
  assert.throws(() => C._ts2ApproveQueue_(q.approvalId, true), /заблокировано/, 'конфликт (дубликат D-3) блокирует утверждение');
  card.issues.filter(i => i.severity === 'CONFLICT').forEach(i => C._ts2GenResolveIssue_(i.issueId, 'D-3 — черновик, будет архивирован'));
  C._ts2ApproveQueue_(q.approvalId, true);
  assert(rows('EVENT_RULES').filter(r => r.sourceTtkId === 'D-1').every(r => String(r.active) === 'true'));
  assert.strictEqual(rows('PPK_DOCUMENTS')[0].status, 'APPROVED');
});
t('2.2: ТТК без срока и предела — REQUIRES_SOURCE, число не подставляется; ППК — новая версия-дополнение', () => {
  const card = C._ts2GenPreview_('D-2');
  assert(card.issues.some(i => i.fieldCode === 'shelfLife'));
  assert(card.controls.every(c => c.criticalLimit === '' && c.limitSource === 'REQUIRES_SOURCE'));
  const ap = C._ts2GenApply_(card.job.generationJobId);
  const ppk = ap.documents.ppk[0]; assert.strictEqual(ppk.changeType, 'TTK_ADDENDUM'); assert.strictEqual(Number(ppk.version), 2); assert(ppk.baseVersionId);
  assert.strictEqual(rows('PPK_DOCUMENTS').length, 2, 'прежняя версия не перезаписана');
});
t('2.2: дубликат и пустая ТТК — блок и конфликт; утверждение заблокировано', () => {
  const card = C._ts2GenPreview_('D-3');
  assert(card.issues.some(i => i.severity === 'BLOCKER')); assert(card.issues.some(i => /CONFLICT_DUPLICATE/.test(i.message)));
  assert.strictEqual(card.canApply, false); assert.throws(() => C._ts2GenApply_(card.job.generationJobId), /блокирующ/);
});
t('2.0: сверка находит блокирующие проблемы и не дублирует их при повторе', () => {
  const r1 = C._ts2RunReconciliation_ ? C._ts2RunReconciliation_() : null; if (!r1) return;
  const n1 = rows('RECONCILIATION_ISSUES').filter(i => i.status === 'OPEN').length; C._ts2RunReconciliation_();
  assert.strictEqual(rows('RECONCILIATION_ISSUES').filter(i => i.status === 'OPEN').length, n1);
  assert(rows('RECONCILIATION_ISSUES').some(i => i.severity === 'BLOCKER'));
});
t('2.0: BLOCKER → предложение → согласование → backup → применение → аудит → откат', () => {
  session = { name: 'Иванов', role: 'Директор', dev: false };
  const p = rows('CHANGE_PROPOSALS').find(x => x.operationType === 'UPDATE' && x.entityId === 'D-4' && x.status === 'PROPOSED');
  assert(p, 'предложение выхода для D-4: ' + JSON.stringify(rows('CHANGE_PROPOSALS').map(x => [x.entityId, x.operationType])));
  const cell = () => sheets['Блюда'].data.find(r => r[0] === 'D-4')[3];
  assert.strictEqual(cell(), '');
  const bk = rows('BACKUP_CATALOG').length;
  C._ts2Approve_(p.changeProposalId, true, 'ок'); C._ts2ApplyProposals_([p.changeProposalId]);
  assert.strictEqual(Number(cell()), 180, 'выход = сумма нетто'); assert(rows('BACKUP_CATALOG').length > bk, 'резервная копия перед применением');
  assert(rows('AUDIT_CHAIN').some(a => a.action === 'PROPOSAL_APPROVE'));
  C._ts2Rollback_(p.changeProposalId); assert.strictEqual(cell(), '', 'откат вернул прежнее значение');
  assert.strictEqual(C._ts2VerifyAudit_().broken.length, 0);
});
console.log('ЦЕХ Стандарт 2.x — приёмочные сценарии: ' + pass + ' пройдено');
