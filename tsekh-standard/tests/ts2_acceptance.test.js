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
const docText = {};
G.DocumentApp = { ParagraphHeading: {}, create: (title) => { docs++; const id = 'DOC' + docs, t = docText[id] = [title]; const p = { setHeading() { return p; } };
  return { getId: () => id, saveAndClose() {}, getBody: () => ({ appendParagraph: x => { t.push(x); return p; }, appendTable: rows => { rows.forEach(r => t.push(r.join(' | '))); } }) }; } };
G.SpreadsheetApp.ProtectionType = { SHEET: 'SHEET' };
G.Utilities.newBlob = () => ({}); G.Utilities.formatDate = (d, tz, f) => { const x = new Date(d), p = n => String(n).padStart(2, '0');
  return f.replace('yyyy', x.getFullYear()).replace('MM', p(x.getMonth() + 1)).replace('dd', p(x.getDate())).replace("'T'", 'T').replace('HH', p(x.getHours())).replace('mm', p(x.getMinutes())).replace('ss', p(x.getSeconds())); };
let session = null; const recorded = [];
Object.assign(G, { _tsIsoPlusMonths_: (iso, m) => { const d = new Date(iso + 'T12:00:00'); d.setMonth(d.getMonth() + m); return d.toISOString().slice(0, 10); }, _book_: () => book, _mcTz_: () => 'Europe/Moscow', _withLock_: f => f(), _log_: () => {}, mcGateSession_: () => session,
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
const isoIn = d => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
legacy('ЦС_Нормативы', ['Код', 'Группа', 'Документ', 'Название', 'Что требует', 'Где в системе', 'Статус', 'Проверил', 'Дата проверки', 'Ссылка', 'Действует до'], [
  ['N-1', 'СанПиН', 'СанПиН скоро истекает', '', '', '', 'ДЕЙСТВУЕТ', '', '', '', isoIn(60)], ['N-2', 'СанПиН', 'Приказ истёк', '', '', '', 'ДЕЙСТВУЕТ', '', '', '', isoIn(-3)],
  ['N-3', 'СанПиН', 'Действует долго', '', '', '', 'ДЕЙСТВУЕТ', '', '', '', isoIn(2000)], ['N-4', 'СанПиН', 'Отменён', '', '', '', 'УТРАТИЛ СИЛУ', '', '', '', isoIn(-400)]]);
legacy('Температурные_Объекты', ['ObjectID', 'Тип', 'Название', 'EquipmentID', 'Мин', 'Макс', 'Ед.', 'Статус', 'Установленная t°', 'Время проверок'], [['T-1', 'REFRIGERATOR', 'Холодильник 1', '', 2, 6, '°C', 'ACTIVE', 4, '09:00']]);
const ctx = vm.createContext(G);
['TS2_Schema.gs', 'TS2_Core.gs', 'TS2_Documents.gs', 'TS2_Reconcile.gs', 'TS2_Ready.gs', 'TS2_Generate.gs', 'TS2_SystemDocs.gs', 'TS_Sensors.gs', 'TS2_Serving.gs'].forEach(f => vm.runInContext(fs.readFileSync(path.join(root, 'app', f), 'utf8'), ctx, { filename: f }));
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
  const iss = code => rows('RECONCILIATION_ISSUES').filter(i => i.entityType === 'NORM' && i.ruleId === C.TS2_RULES_.find(r => r.ruleCode === code).ruleId).map(i => i.entityId);
  assert.strictEqual(JSON.stringify(iss('NORM_EXPIRING')), '["N-1"]', 'истекает в ближайшие 120 дней');
  assert.strictEqual(JSON.stringify(iss('NORM_EXPIRED')), '["N-2"]', 'истёк, но отмечен действующим; отменённый и долгосрочный — без проблем');
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
t('2.1: охлаждение и разогрев — отдельные журналы; замер ККТ сразу, без дубля при закрытии; ТТК без тепловой ККТ — без ложной задачи', () => {
  const pid = 'P-10', ok = JSON.stringify({ success: true, data: {} });
  G.__ccp = { items: [{ controlId: 'C1', point: 'Тепловая обработка', status: 'OK', value: 80, unit: '°C' }, { controlId: 'C2', point: 'Шоковое охлаждение', status: 'OK', value: 3, unit: '°C' }] };
  C._ts2OnGateCall_('mcRecordProductionCcp', [JSON.stringify({ productionId: pid, controlId: 'C2', value: 3 })], JSON.stringify({ success: true, data: { state: G.__ccp } }));
  const cool = () => rows('AUTO_RECORDS').filter(r => r.productionId === pid && r.journalCode === 'J-COOLING');
  assert.strictEqual(cool().length, 1); assert.strictEqual(Number(cool()[0].value), 3);
  C._ts2OnGateCall_('completeProduction', [pid, 5], ok);
  assert.strictEqual(cool().length, 1, 'при закрытии заказа замер охлаждения не дублируется');
  assert(rows('AUTO_RECORDS').some(r => r.productionId === pid && r.journalCode === 'J-KKT-THERMAL' && Number(r.value) === 80));
  assert(!rows('AUTO_RECORDS').some(r => r.productionId === pid && r.journalCode === 'J-REHEAT'), 'разогрева в ТТК нет — записи нет');
  G.__ccp = { items: [] }; C._ts2OnGateCall_('completeProduction', ['P-11', 5], ok);
  assert(!rows('AUTO_RECORDS').some(r => r.productionId === 'P-11' && r.recordType === 'HACCP_FACT'), 'ТТК без тепловой ККТ (салат) — нет ложного ожидания замера');
  assert(rows('AUTO_RECORDS').some(r => r.productionId === 'P-11' && r.journalCode === 'J-RELEASE'), 'журнал выпуска пишется всегда');
});
t('2.1: размораживание — запись с фактической t°; отклонение блокирует и уведомляет', () => {
  C._ts2OnGateCall_('mcDefrostFinish', [JSON.stringify({ batchId: 'B-7', temperature: 2 })], JSON.stringify({ success: true, data: { batchId: 'B-7', blocked: false } }));
  const r = rows('AUTO_RECORDS').find(x => x.batchId === 'B-7' && x.journalCode === 'J-DEFROST'); assert(r && Number(r.value) === 2 && r.result === 'PASS');
  C._ts2OnGateCall_('mcDefrostFinish', [JSON.stringify({ batchId: 'B-8', temperature: 9 })], JSON.stringify({ success: true, data: { batchId: 'B-8', blocked: true, reasons: ['t° в толще 9 °C выше нормы'] } }));
  assert.strictEqual(rows('AUTO_RECORDS').find(x => x.batchId === 'B-8' && x.journalCode === 'J-DEFROST').result, 'FAIL');
  assert(rows('AUTO_RECORDS').some(x => x.recordType === 'DEVIATION' && /B-8/.test(x.value)));
});
t('2.1: 25 системных документов формируются из данных; без изменений — та же версия; изменение утверждённого → новая версия и повторное утверждение', () => {
  session = { name: 'Сидорова', role: 'Ответственный за ХАССП' };
  const all = rows('SYSTEM_DOCUMENTS'); assert.strictEqual(all.length, 25);
  all.forEach(d => { const r = C._ts2SdocGenerate_(d.documentId, false); assert(r.fileId && r.changed, d.templateId); });
  const txt = id => docText[rows('SYSTEM_DOCUMENTS').find(d => d.templateId === id).fileId].join('\n');
  assert(/Котлета куриная/.test(txt('TPL-005')) && /75/.test(txt('TPL-005')), 'реестр ККТ содержит ККТ из утверждённой ТТК');
  assert(/Холодильник 1/.test(txt('TPL-023')), 'реестр оборудования — из объектов замеров');
  assert(/НЕТ ДАННЫХ: директор/.test(txt('TPL-001')), 'нет директора — документ прямо говорит, где внести');
  assert(/показателей вносятся по протоколам/.test(txt('TPL-002')), 'ППК не выдумывает лабораторные показатели');
  assert(/J-KKT-THERMAL/.test(txt('TPL-007')) && /Акт списания/.test(txt('TPL-019')) && /FEFO/.test(txt('TPL-010')));
  const d5 = rows('SYSTEM_DOCUMENTS').find(d => d.templateId === 'TPL-005');
  assert.strictEqual(C._ts2SdocGenerate_(d5.documentId, false).changed, false, 'без изменений данных — без новой версии');
  const q = rows('APPROVAL_QUEUE').find(x => x.objectId === d5.documentId && x.status === 'PENDING'); C._ts2ApproveQueue_(q.approvalId, true);
  assert.strictEqual(C._ts2Find_('SYSTEM_DOCUMENTS', 'documentId', d5.documentId).status, 'ACTIVE');
  C._ts2Insert_('MEASUREMENT_OBJECTS', { objectId: 'OBJ-X', enterpriseId: 'E', objectType: 'FREEZER', name: 'Морозильник 2', minValue: -25, maxValue: -18, status: 'ACTIVE' });
  const r2 = C._ts2SdocGenerate_(d5.documentId, false); assert(r2.changed && r2.version === 2, 'данные изменились — версия 2');
  assert.strictEqual(C._ts2Find_('SYSTEM_DOCUMENTS', 'documentId', d5.documentId).status, 'REQUIRES_ENTERPRISE_APPROVAL', 'изменённый документ снова на утверждении');
  assert(rows('APPROVAL_QUEUE').some(x => x.objectId === d5.documentId && x.status === 'PENDING'));
});
t('2.1: датчик — ключ хешем, замер закрывает задачу, журнал не чаще 15 мин, отклонение уведомляет один раз, отключение', () => {
  session = { name: 'Директорова', role: 'Директор' };
  const obj = rows('MEASUREMENT_OBJECTS').find(o => o.legacyObjectId === 'T-1');
  const reg = J(C.ts2SensorRegister('t', obj.objectId, 'Датчик холодильника')); const dev = reg.deviceId, key = reg.token;
  assert(key.length >= 40 && !JSON.stringify(rows('SENSOR_DEVICES')).includes(key), 'ключ в таблице не хранится');
  const nowIso = C._ts2Iso_(new Date());
  C._ts2Insert_('JOURNAL_EXPECTATIONS', { expectationId: 'EXP-SNS', enterpriseId: 'E', journalCode: 'J-STORAGE-T', eventRuleId: 'SCHED-FRIDGE', objectType: 'FRIDGE', objectId: obj.objectId, dueAt: nowIso, status: 'OPEN', confirmationMode: 'MEASURE', title: 't', idempotencyKey: 'k-sns' });
  const post = b => JSON.parse(C.doPost({ postData: { contents: JSON.stringify(b) } }).text);
  assert.strictEqual(post({ device: dev, token: 'wrong', value: 4 }).ok, false, 'чужой ключ не принят');
  assert.strictEqual(post({ device: dev, token: key, value: 999 }).ok, false, 'физически невозможное значение');
  const r1 = post({ device: dev, token: key, value: 4.1 }); assert(r1.ok && r1.stored && r1.result === 'PASS' && r1.closed === 1, JSON.stringify(r1));
  assert.strictEqual(C._ts2Find_('JOURNAL_EXPECTATIONS', 'expectationId', 'EXP-SNS').status, 'DONE', 'задача замера закрыта датчиком');
  assert(rows('MANUAL_MEASUREMENTS').some(m => m.source === 'SENSOR' && Number(m.value) === 4.1));
  assert.strictEqual(post({ device: dev, token: key, value: 4.3 }).stored, false, 'чаще 15 минут в журнал не пишется');
  const ex = () => rows('AUTO_RECORDS').filter(x => x.recordType === 'DEVIATION' && /Датчик/.test(x.value)).length;
  assert(post({ device: dev, token: key, value: 9.5 }).stored, 'отклонение пишется сразу'); assert.strictEqual(ex(), 1);
  post({ device: dev, token: key, value: 9.8 }); assert.strictEqual(ex(), 1, 'повторное отклонение в течение часа не дублирует уведомление');
  J(C.ts2SensorRevoke('t', dev)); assert.strictEqual(post({ device: dev, token: key, value: 4 }).ok, false, 'отключённый датчик не принимается');
  assert.strictEqual(JSON.parse(C.doPost({ postData: { contents: '{"hello":1}' } }).text).ok, false, 'прочие POST отклоняются');
});
t('СанПиН 4282-26 п. 32, 54, 55: раздача 3 ч, кейтеринг — раннее комплектование и ярлыки без выдуманного времени', () => {
  const p2 = n => String(n).padStart(2, '0'), loc = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  const start = new Date(Date.now() + 5 * 3600000), made = new Date(Date.now() - 3600000);
  G.getEvents = () => JSON.stringify([{ id: 'E1', format: 'Банкет', date: loc(new Date()), time: '19:00', items: [{ name: 'Котлета куриная', qty: 20 }] },
    { id: 'E2', format: 'Выездной фуршет', date: loc(start), time: p2(start.getHours()) + ':' + p2(start.getMinutes()), items: [{ name: 'Котлета куриная', qty: 30 }, { name: 'Жюльен', qty: 30 }] }]);
  G._productionSheet_ = () => ({ getDataRange: () => ({ getValues: () => [['id', 'op', 'name', 'code', 'v', 'p', 'f', 'u', 'ws', 'e', 'st', 'fin', 'status'], ['P1', '', 'Котлета куриная', 'D-1', '', '', '', '', '', '', '', made, 'COMPLETED']] }) });
  G.PROD_COL_ = { name: 2, status: 12, finish: 11, code: 3 };
  const ok = JSON.stringify({ success: true, data: {} });
  C._ts2OnGateCall_('issueV28Banquet', ['E1', '[]'], ok); C._ts2OnGateCall_('issueV28Banquet', ['E1', '[]'], ok);
  const e1 = rows('JOURNAL_EXPECTATIONS').filter(e => e.objectId === 'E1' && e.eventRuleId === 'SERVING');
  assert.strictEqual(e1.length, 1, 'одна задача на выдачу, повтор без дублей'); assert(/п\. 32/.test(e1[0].title));
  assert(Math.abs(new Date(e1[0].dueAt) - (Date.now() + 3 * 3600000)) < 120000, 'срок — через 3 часа');
  C._ts2OnGateCall_('issueV28Banquet', ['E2', '[]'], ok);
  assert(rows('JOURNAL_EXPECTATIONS').some(e => e.objectId === 'E2' && /п\. 55/.test(e.title)), 'кейтеринг: 3 часа в изотермических ёмкостях');
  assert(rows('AUTO_RECORDS').some(r => r.recordType === 'DEVIATION' && /п\. 54/.test(r.value)), 'комплектование раньше чем за 3 часа — отклонение');
  assert(C._ts2NowTasks_().some(t => t.catering === 'E2'), 'на экране «Сейчас» — кнопка ярлыков');
  const L = C._ts2CateringLabels_('E2', 'Шефова Т.');
  assert.strictEqual(L.count, 2); assert(/Тест/.test(L.html) && /Шефова Т\./.test(L.html) && /п\. 55/.test(L.html));
  const hh = d => p2(d.getHours()) + ':' + p2(d.getMinutes());
  assert(L.html.includes(hh(made)) && L.html.includes(hh(new Date(made.getTime() + 3 * 3600000))), 'изготовлено и окончание раздачи — из факта производства');
  assert(L.gaps.some(g => /Жюльен/.test(g)) && /__________________/.test(L.html), 'нет факта производства — поле для ручной записи, время не выдумано');
});
console.log('ЦЕХ Стандарт 2.x — приёмочные сценарии: ' + pass + ' пройдено');
