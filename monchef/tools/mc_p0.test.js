// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
// MC-023 (жизненный цикл ППК), MC-024 (ККТ по фактическим процессам), MC-025 (утверждённые сроки годности). Запуск: node monchef/tools/mc_p0.test.js
const assert = require('assert');
const { boot } = require('./gasemu');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e)); } }
const J = s => (typeof s === 'string' ? JSON.parse(s) : s);
const E = boot({ now: '2026-11-25T08:00:00Z' }), C = E.ctx, ss = E.ss;
E.props[C.MC_MED_GATE_PROP_] = 'off';
const emp = ss.insertSheet('Сотрудники');
emp.appendRow(['Фамилия', 'Имя', 'Отчество', 'Должность', 'Роль', 'ДР', 'Телефон', 'Адрес', 'ПИН-код', '', '', '', 'Активен']);
[['Директорова', 'Анна', 'Директор', '1111'], ['Хасапов', 'Ким', 'Ответственный за ХАССП', '5555'], ['Контролёва', 'Ия', 'Ответственный за ХАССП', '5556'], ['Шефов', 'Марк', 'Шеф-повар', '7777'], ['Официантов', 'Иван', 'Официант', '3333']]
  .forEach(r => emp.appendRow([r[0], r[1], '', r[2], r[2], '', '', '', r[3], '', '', '', true]));
const ds = ss.insertSheet('Блюда'); ds.appendRow(['Код', 'Название', 'Категория', 'Выход', '', 'Технология', '', '', 'Цех', 'Срок реализации (ч)', '', '', 'Выход, г/мл/шт', 'Ед. выхода']);
[['D001', 'Стейк рибай', 'Горячее', 'Горячий цех', 300, 'г'], ['PF10', 'Соус перечный п/ф', 'Соусы', 'Горячий цех', 500, 'г'], ['PF11', 'Бульон куриный п/ф', 'Бульоны', 'Горячий цех', 1000, 'г']]
  .forEach(r => ds.appendRow([r[0], r[1], r[2], r[4], '', '', '', '', r[3], '', '', '', r[4], r[5]]));
const so = ss.insertSheet('Состав'); so.appendRow(['Код', 'Продукт', '', '', 'Брутто', 'Нетто', 'Выход', 'Ед.']);
[['D001', 'Говядина рибай', 300, 'г'], ['PF10', 'Сливки 33%', 400, 'мл'], ['PF10', 'Перец чёрный', 20, 'г'], ['PF11', 'Курица', 600, 'г'], ['PF11', 'Вода питьевая', 800, 'мл']].forEach(r => so.appendRow([r[0], r[1], '', '', r[2], r[2], r[2], r[3]]));
const tv = ss.insertSheet('ТТК_Версии'); tv.appendRow(['Код блюда', 'Версия', 'Статус']); ['D001', 'PF10', 'PF11'].forEach(c => tv.appendRow([c, 1, 'действующая']));
C._withLock_(() => C._incomeWithBatches_([{ name: 'Сливки 33%', qty: 5000, unit: 'мл', price: 0.4 }, { name: 'Перец чёрный', qty: 500, unit: 'г', price: 2 }, { name: 'Курица', qty: 5000, unit: 'г', price: 0.3 }, { name: 'Вода питьевая', qty: 20000, unit: 'мл', price: 0.001 }], 'Поставщик', '', null));
(() => { const sh = ss.getSheetByName('Склад_Партии'), n = sh.getLastRow(); for (let i = 2; i <= n; i++) sh.getRange(i, 11).setValue('active'); })();
const login = pin => J(C.loginWithPin(pin, 'dev-' + pin)).token;
const DIR = login('1111'), H1 = login('5555'), H2 = login('5556'), CHEF = login('7777'), WAI = login('3333'), DEV = login('2258');
const drop = () => { C._mcRcDrop_(); C._BOOK_CACHE_ = null; };
const R = r => { drop(); return J(r); };
const ok = r => { r = J(r); assert.ok(r && (r.success === true || r.ok === true), JSON.stringify(r).slice(0, 400)); return r.data !== undefined ? r.data : r; };
const no = (r, code) => { r = J(r); assert.ok(r && !(r.success === true || r.ok === true), 'ожидался отказ: ' + JSON.stringify(r).slice(0, 300)); if (code) assert.strictEqual(r.error && r.error.code, code, JSON.stringify(r)); return r; };
const notes = re => { drop(); const sh = ss.getSheetByName('Уведомления'); return sh ? sh.getDataRange().getValues().filter(r => re.test(JSON.stringify(r))).length : 0; };
const ccp = id => { drop(); return C._v30Rows_(C.MC_V30.CCP).find(r => String(r[0]) === id); };

console.log('MC-024 · ККТ/КТ по фактическим процессам');
let CID, PROC, HAZ;
t('статус «действует», дату и утвердившего нельзя прислать с экрана: точка сохраняется проектом', () => {
  drop(); C._v30Init_();
  PROC = ok(R(C.v30SaveProcess(JSON.stringify({ name: 'Тепловая обработка', code: 'P-HOT' }), H1))).id;
  HAZ = ok(R(C.v30SaveHazard(JSON.stringify({ processId: PROC, category: 'Биологическая', hazard: 'Выживание патогенов', significant: true }), H1))).id;
  CID = ok(R(C.v30SaveControl(JSON.stringify({ processId: PROC, hazardId: HAZ, type: 'CCP', controlPoint: 'Температура в толще', criticalLimit: '≥ 75', limitUnit: '°C', status: 'ACTIVE', approvedBy: 'кто угодно', approvedAt: '2026-01-01' }), H1))).id;
  const r = ccp(CID); assert.strictEqual(r[13], 'DRAFT'); assert.strictEqual(String(r[16]), '');
});
t('утверждение проверяет полноту: без мониторинга, действий, верификации, меры V75, обоснования предела и валидации — отказ с перечнем', () => {
  const rd = ok(R(C.v102ControlReadiness(DIR))).controls.find(x => x.id === CID);
  ['ответственный', 'метод мониторинга', 'корректирующее действие', 'метод верификации', 'план мониторинга', 'мера управления'].forEach(w => assert.ok(rd.missing.some(m => m.indexOf(w) >= 0), w + ' — ' + rd.missing.join(' | ')));
  const r = no(R(C.v102ControlApprove(JSON.stringify({ controlId: CID }), DIR)), 'NOT_READY'); assert.ok(/не хватает/.test(r.error.message));
});
t('полная точка: директор утверждает; автор изменений, ответственный за ХАССП и технический доступ — нет', () => {
  ok(R(C.v30SaveControl(JSON.stringify({ id: CID, processId: PROC, hazardId: HAZ, type: 'CCP', controlPoint: 'Температура в толще', criticalLimit: '≥ 75', limitUnit: '°C', monitoringMethod: 'термощуп в центр куска',
    frequency: 'каждая порция', responsible: 'повар горячего цеха', correctiveAction: 'догреть до 75 °C и повторить замер', verificationMethod: 'просмотр записей шефом ежедневно' }), H1)));
  ok(R(C.v30SaveMonitoring(JSON.stringify({ controlId: CID, parameter: 't° в толще', unit: '°C', targetMin: 75, frequency: 'каждая порция', responsible: 'повар' }), H1)));
  drop(); C._v75Append_('MS', { MeasureID: 'MS-1', 'Опасности (JSON)': JSON.stringify([HAZ]), ProcessID: PROC, 'Мера': 'Прогрев до 75 °C в толще', 'Классификация': 'CCP',
    'Обоснование': 'измеримый предел, мониторинг каждой порции, коррекция догревом до подачи', 'Обоснование предела': 'СанПиН 2.3/2.4.3590-20, п. 8.1.4', ControlID: CID, 'Статус': 'ACTIVE' });
  no(R(C.v102ControlApprove(JSON.stringify({ controlId: CID }), DIR)), 'NOT_READY');   // валидации ещё нет
  ok(R(C.v75Validate(JSON.stringify({ controlId: CID, method: R(C.v75Data(H1)).data ? Object.keys({}).concat(C.MC_V75_VMETHOD_.map(x => x[0]))[0] : C.MC_V75_VMETHOD_[0][0], evidence: 'протокол замеров 30 порций, журнал', result: 'VALID', conclusion: 'предел обеспечивает уничтожение патогенов' }), H2)));
  no(R(C.v102ControlApprove(JSON.stringify({ controlId: CID }), H1)));
  no(R(C.v102ControlApprove(JSON.stringify({ controlId: CID }), DEV)));
  const a = ok(R(C.v102ControlApprove(JSON.stringify({ controlId: CID, comment: 'обоснование проверено' }), DIR)));
  const r = ccp(CID); assert.strictEqual(r[13], 'ACTIVE'); assert.ok(/Директорова Анна, Директор/.test(r[16])); assert.ok(r[15]);
});
t('ККТ блюду — только по процессу: нет схемы — отказ; схема без процесса ККТ — отказ; не подтверждена на площадке — отказ; подтверждена — назначено', () => {
  no(R(C.mcSetTtkCcp(JSON.stringify({ code: 'D001', controlId: CID }), H1)), 'VALIDATION');
  drop(); C._v75Append_('FLW', { FlowID: 'FLW-1', 'Название': 'Горячее из мяса', 'Для продукции (JSON)': '["Горячее"]', 'Шаги (JSON)': '[{"processId":"P-X"},{"processId":"P-Y"}]', 'Версия': 1, 'Статус': 'ACTIVE' });
  assert.ok(/нет процесса этой ККТ/.test(no(R(C.mcSetTtkCcp(JSON.stringify({ code: 'D001', controlId: CID }), H1))).error.message));
  drop(); C._v75Append_('FLW', { FlowID: 'FLW-2', 'Название': 'Стейки', 'Для продукции (JSON)': '["D001"]', 'Шаги (JSON)': JSON.stringify([{ processId: 'P-X' }, { processId: PROC }]), 'Версия': 1, 'Статус': 'ACTIVE' });
  assert.ok(/не подтверждена на производственной площадке/.test(no(R(C.mcSetTtkCcp(JSON.stringify({ code: 'D001', controlId: CID }), H1))).error.message));
  drop(); C._v75Append_('CNF', { ConfID: 'CNF-2', FlowID: 'FLW-2', 'Версия схемы': 1, 'Результат': 'CONFIRMED', 'Подтвердил': 'Шефов Марк' });
  ok(R(C.mcSetTtkCcp(JSON.stringify({ code: 'D001', controlId: CID }), H1)));
  drop(); assert.strictEqual(C._tccpFor_('D001')[0].id, CID);
});
t('тестовое отклонение: замер 62 °C — факт с автором и временем, отклонение и корректирующее действие по процедуре', () => {
  const r = ok(R(C.v31RecordHaccpFact(JSON.stringify({ controlId: CID, value: 62, relatedBatchId: 'TEST-1', object: 'проверка процедуры', correctiveAction: 'догреть до 75 °C' }), CHEF)));
  drop(); const f = C._v31Rows_(C.MC_V31.FACT).filter(x => String(x[13]) === 'TEST-1').pop();
  assert.ok(f, 'факт записан'); assert.notStrictEqual(String(f[7]), 'OK'); assert.ok(/Шефов/.test(f.join('|')), 'автор'); assert.ok(f.some(x => Object.prototype.toString.call(x) === '[object Date]'), 'время');
  assert.ok(r.deviationId || f.join('|').indexOf('DEV') >= 0 || JSON.stringify(r).indexOf('deviation') >= 0, 'отклонение зарегистрировано: ' + JSON.stringify(r).slice(0, 200));
  drop(); assert.ok(!C._tccpState_('D001', 'TEST-1').ok, 'выпуск по такому заказу заблокирован');
});
t('изменение предела у действующей ККТ — снова проект: выпуск блокируется («не действует в плане»), директору и ХАССП — уведомление', () => {
  ok(R(C.v30SaveControl(JSON.stringify({ id: CID, processId: PROC, hazardId: HAZ, type: 'CCP', controlPoint: 'Температура в толще', criticalLimit: '≥ 70', limitUnit: '°C', monitoringMethod: 'термощуп в центр куска',
    frequency: 'каждая порция', responsible: 'повар горячего цеха', correctiveAction: 'догреть до 75 °C и повторить замер', verificationMethod: 'просмотр записей шефом ежедневно' }), H1)));
  const r = ccp(CID); assert.strictEqual(r[13], 'DRAFT'); assert.strictEqual(String(r[14]), '2');
  drop(); assert.strictEqual(C._tccpState_('D001', 'ANY').items[0].status, 'INACTIVE');
  assert.ok(notes(/требует повторного утверждения/) >= 2);
});

console.log('MC-023 · жизненный цикл ППК');
let PPK;
const sect = () => { drop(); return C._v65Objs_('SEC').filter(x => String(x.PPKID) === PPK); };
t('проект → проверка (не автор) → согласование (не автор) → утверждение (директор, не автор) → ввод в действие; версия хранит всех и основание', () => {
  drop(); C._v65Check_ = () => ({ status: 'PASS', blocking: 0, checks: [] }); C._v65Folder_ = () => null;   // полнота разделов проверяется существующей проверкой V65; здесь — только жизненный цикл
  C._mcPdfSave_ = (name) => ({ fileId: 'FILE-PPK', url: 'https://drive/ppk', sha256: 'abc', name: name });
  PPK = ok(R(C.v65CreatePpk(JSON.stringify({ name: 'ППК ресторана', version: 1, dateFrom: '2026-11-26', responsible: 'Хасапов Ким', basis: 'ввод системы ХАССП' }), H1))).ppkId;
  drop(); ss.getSheetByName('ППК_Разделы').appendRow(['SEC-1', PPK, 'HACCP', 'ХАССП и ККТ', 1, 'ККТ: температура в толще ≥ 75 °C', 'Ответственный за ХАССП', 'EDITED', 1, '', new Date(), 'Хасапов Ким']);
  ok(R(C.v65Submit(PPK, H1)));
  no(R(C.v102PpkReview(JSON.stringify({ ppkId: PPK, decision: 'PASS' }), H1)), 'FORBIDDEN');
  no(R(C.v65Approve(JSON.stringify({ ppkId: PPK }), DIR)), 'FORBIDDEN');   // не прошла проверку и согласование
  ok(R(C.v102PpkReview(JSON.stringify({ ppkId: PPK, decision: 'PASS', comment: 'разделы полные' }), H2)));
  no(R(C.v65Approve(JSON.stringify({ ppkId: PPK }), DIR)), 'FORBIDDEN');   // не согласована
  no(R(C.v102PpkAgree(JSON.stringify({ ppkId: PPK }), H1)), 'FORBIDDEN');
  ok(R(C.v102PpkAgree(JSON.stringify({ ppkId: PPK, comment: 'согласовано' }), H2)));
  no(R(C.v65Approve(JSON.stringify({ ppkId: PPK }), DEV)));
  ok(R(C.v65Approve(JSON.stringify({ ppkId: PPK, comment: 'утверждаю' }), DIR)));
  ok(R(C.v65Activate(PPK, DIR)));
  drop(); const p = C._v65Get_(PPK);
  assert.strictEqual(p.Status, 'ACTIVE'); assert.ok(/Хасапов/.test(p.Author)); assert.ok(/Контролёва/.test(p.Reviewer)); assert.ok(/Контролёва/.test(p.AgreedBy)); assert.ok(/Директорова/.test(p.ApprovedBy)); assert.strictEqual(p.Basis, 'ввод системы ХАССП');
});
t('сотрудники (официант) видят действующую версию; действующая и архивная не редактируются', () => {
  const a = ok(R(C.v102PpkActive(WAI))).active; assert.strictEqual(a.ppkId, PPK); assert.ok(/Директорова/.test(a.approvedBy)); assert.ok(a.sections.some(x => x.text === 'ККТ: температура в толще ≥ 75 °C'));
  no(R(C.v65SaveSection(JSON.stringify({ ppkId: PPK, sectionCode: 'HACCP', text: 'правка' }), H1)));
  assert.ok(sect().some(x => x.Text === 'ККТ: температура в толще ≥ 75 °C') && !sect().some(x => x.Text === 'правка'));
});
t('изменение процесса — действующая ППК «требует пересмотра», уведомления; пересмотр — новая версия-проект с копией разделов; повтор — отказ', () => {
  ok(R(C.v30SaveProcess(JSON.stringify({ name: 'Охлаждение', code: 'P-COOL' }), H1)));
  drop(); const p = C._v65Get_(PPK); assert.ok(/изменён процесс «Охлаждение»/.test(p.RevisionReason), p.RevisionReason); assert.ok(notes(/требует пересмотра/) >= 2);
  assert.ok(ok(R(C.v102PpkActive(WAI))).active.revision);
  const n = ok(R(C.v102PpkRevisionStart(JSON.stringify({ ppkId: PPK, basis: 'добавлен процесс охлаждения' }), H1)));
  assert.strictEqual(n.version, 2); assert.strictEqual(n.sections, sect().length);
  drop(); const v2 = C._v65Get_(n.ppkId); assert.strictEqual(v2.Status, 'DRAFT'); assert.strictEqual(v2.PrevPPKID, PPK); assert.ok(/Пересмотр v1: добавлен процесс охлаждения/.test(v2.Basis));
  no(R(C.v102PpkRevisionStart(JSON.stringify({ ppkId: PPK, basis: 'ещё раз' }), H1)), 'CONFLICT');
  assert.strictEqual(C._v65Get_(PPK).Status, 'ACTIVE', 'старая действует до ввода новой');
});
t('мероприятия графика — задачи центра задач по роли; технический доступ не архивирует; архив не принимает отметки графика', () => {
  drop(); ss.getSheetByName('ППК_Мероприятия').appendRow(['CP-1', PPK, '', '', 'Холодильник №1', 'температура', '+2…+6 °C', 'ежедневно', 'термометр', 'Шеф-повар', 'J01', 'запись журнала', 'перенести продукты', true, '', '']);
  drop(); const b = ok(R(C.v65BuildSchedule(JSON.stringify({ ppkId: PPK, from: '2026-11-25', to: '2026-11-27' }), DIR))); assert.ok(b.created >= 1);
  drop(); const r = C._v102PpkTasksTick_(); assert.ok(r.tasks >= 1);
  drop(); const tsh = ss.getSheets().find(x => /Задач/.test(x.getName()) && x.getDataRange().getValues()[0].indexOf('SourceType') >= 0), tv = tsh.getDataRange().getValues(), th = tv[0]; const tasks = tv.slice(1).map(r => { const o = {}; th.forEach((k, i) => o[k] = r[i]); return o; }).filter(x => x.SourceType === 'PPK_SCHEDULE'); assert.ok(tasks.length >= 1 && /ППК: Холодильник №1 — температура/.test(tasks[0].Title) && tasks[0].Role === 'Шеф-повар');
  no(R(C.v65Archive(JSON.stringify({ ppkId: PPK, comment: 'проверка' }), DEV)));
});

console.log('MC-025 · утверждённые сроки годности');
const batch = name => { drop(); return ss.getSheetByName('Склад_Партии').getDataRange().getValues().slice(1).filter(r => r[1] === name).pop(); };
let pn = 0;
const produce = (code, qty, expiry) => {
  E.setNow(new Date(Date.UTC(2026, 10, 25, 8, ++pn)).toISOString());   // стенд: время стоит — номера заданий не должны совпасть
  drop(); const p = J(C.planProduction(code, qty, 'г', '[]', 'тест ' + pn, CHEF)); assert.ok(p.success || p.ok, JSON.stringify(p).slice(0, 200)); const id = (p.data && (p.data.id || p.data.productionId)) || p.id;
  drop(); ok(C.startProduction(id, CHEF)); drop(); return J(C.completeProduction(id, qty, expiry || '', CHEF));
};
t('срок в карте — только с основанием и после утверждения другим сотрудником; до утверждения не применяется', () => {
  no(R(C.setDishShelfLife('PF10', 48, CHEF)), 'VALIDATION');
  const p = ok(R(C.setDishShelfLife('PF10', 48, CHEF, 'СанПиН 2.3/2.4.3590-20, прил. 7, п. 12')));
  assert.strictEqual(p.status, 'PROPOSED'); drop(); assert.strictEqual(C._shelfLifeFor_('PF10')['часы'], null);
  no(R(C.v102ShelfDecide(JSON.stringify({ id: p.id, approve: true }), CHEF)));
  ok(R(C.v102ShelfDecide(JSON.stringify({ id: p.id, approve: true, comment: 'основание проверено' }), H1)));
  drop(); assert.strictEqual(C._shelfLifeFor_('PF10')['часы'], 48);
});
t('срок, заданный в карте без основания (до V102), не применяется и виден в списке «без утверждённого основания»', () => {
  drop(); const sh = ss.getSheetByName('Блюда'), v = sh.getDataRange().getValues(); for (let i = 1; i < v.length; i++) if (v[i][0] === 'PF11') sh.getRange(i + 1, 10).setValue(72);
  drop(); const r = C._shelfLifeFor_('PF11'); assert.strictEqual(r['часы'], null); assert.ok(/без утверждённого основания/.test(r['источник']));
  assert.ok(ok(R(C.v102ShelfData(H1))).unapproved.some(x => x.code === 'PF11' && x.hours === 72));
});
t('выпуск п/ф: срок партии — по утверждённому (48 ч); длиннее — отказ; короче — можно', () => {
  const r1 = J(produce('PF10', 500)); assert.ok(r1.success || r1.ok, JSON.stringify(r1).slice(0, 300)); assert.strictEqual(r1.data.expiry, '2026-11-27'); assert.ok(/карта, утверждено/.test(r1.data.expiryBasis));
  const b = batch('Соус перечный'); assert.ok(b && String(b.join('|')).indexOf('2026-11-27') >= 0 || (b && b.some(x => Object.prototype.toString.call(x) === '[object Date]' && x.getDate() === 27)), 'партия со сроком 27.11: ' + JSON.stringify(b));
  const r2 = produce('PF10', 500, '2026-12-05'); no(r2, 'SHELF_NOT_APPROVED'); assert.ok(/длиннее утверждённого/.test(r2.error.message));
  const r3 = produce('PF10', 500, '2026-11-26'); assert.ok(r3.success || r3.ok); assert.strictEqual(r3.data.expiry, '2026-11-26');
});
t('нет утверждённого срока (бульон): ручной срок не принимается; выпуск без срока — уведомление ответственному за ХАССП', () => {
  const r1 = produce('PF11', 1000, '2026-11-28'); no(r1, 'SHELF_NOT_APPROVED');
  const r2 = produce('PF11', 1000); assert.ok(r2.success || r2.ok, JSON.stringify(r2).slice(0, 300)); assert.strictEqual(r2.data.expiry, '');
  assert.ok(notes(/Партия выпущена без срока годности: PF11/) >= 1);
});
t('паспорт п/ф (черновик) срок партии не меняет — проверено в V91; правило валидации действует только после утверждения и ввода', () => {
  drop(); assert.strictEqual(C._v91ActiveRule_('PF11'), null);
  drop(); assert.strictEqual(C._v102ApprovedShelf_('PF11'), null);
});

console.log('\nИтого: ' + pass + ' пройдено, ' + fail + ' не пройдено');
process.exit(fail ? 1 : 0);
