// Снимки экранов ЦЕХ Стандарт для руководства (новые модули и вход) с нумерованными метками, как в руководстве MonChef.
// node tools/manual_shots.js <путь к app/Console.html> <папка результата>
// Данные на снимках проверочные («… Тест»), сервер подменяется заглушкой.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const [, , CONSOLE, OUT, PLAN = 'pro_max'] = process.argv;
const PLANS = { basic: ['Basic', 1], basic_pro: ['Basic Pro', 2], pro: ['Pro', 3], pro_max: ['Pro Max', 4] };
fs.mkdirSync(OUT, { recursive: true });

const fakeInit = () => {
  const plans = [{ code: 'basic', name: 'Basic', features: ['Загрузка ТТК', 'Сроки реализации', 'КБЖУ', 'Сроки хранения', 'Себестоимость', 'Приёмка', 'Маркировка', 'Экономика', 'Нормативы и охрана труда'] },
    { code: 'basic_pro', name: 'Basic Pro', features: ['Журналы', 'ППК'] }, { code: 'pro', name: 'Pro', features: ['Партии', 'Лабораторные исследования', 'Договоры'] }, { code: 'pro_max', name: 'Pro Max', features: ['AI-ассистент', 'База отработанных ТТК'] }];
  const LV = { ttk: 1, shelf_life: 1, kbju: 1, storage: 1, costing: 1, receiving: 1, labeling: 1, economics: 1, labor_safety: 1, core: 1, journals: 2, ppk: 2, batches: 3, lab: 3, contracts: 3, ai: 4, ttk_library: 4 };
  const allF = {}; Object.keys(LV).forEach(k => { if (LV[k] <= window.__LVL) allF[k] = true; });
  const locked = {}; if (window.__LVL < 2) { locked.haccp = 'basic_pro'; locked.sanitation = 'basic_pro'; locked.inspection = 'basic_pro'; } if (window.__LVL < 3) locked.lab = 'pro';
  const norms = [
    ['OT-02', 'Охрана труда', 'Постановление Правительства РФ от 24.12.2021 № 2464', 'О порядке обучения по охране труда и проверки знания требований охраны труда', 'Инструктажи: вводный, первичный, повторный (не реже 1 раза в 6 месяцев)', 'Инструктажи', 'ПРОВЕРИТЬ'],
    ['OT-03', 'Охрана труда', 'Приказ Минтруда России от 29.10.2021 № 772н', 'Требования к правилам и инструкциям по охране труда', 'Структура инструкции', 'Инструкции по ОТ', 'ДЕЙСТВУЕТ'],
    ['UT-01', 'Условия труда', 'Федеральный закон от 28.12.2013 № 426-ФЗ', 'О специальной оценке условий труда', 'СОУТ не реже 1 раза в 5 лет', 'СОУТ', 'ПРОВЕРИТЬ'],
    ['SN-01', 'СанПиН', 'СанПиН 2.3/2.4.3590-20', 'Требования к организации общественного питания населения', 'Приёмка, хранение, технология, гигиена', 'ХАССП, журналы, приёмка', 'ДЕЙСТВУЕТ']
  ].map(r => ({ 'Код': r[0], 'Группа': r[1], 'Документ': r[2], 'Название': r[3], 'Что требует': r[4], 'Где в системе': r[5], 'Статус': r[6], 'Проверил': r[6] === 'ДЕЙСТВУЕТ' ? 'Шефова Тест' : '', 'Дата проверки': r[6] === 'ДЕЙСТВУЕТ' ? '2026-11-10' : '' }));
  const acts = [{ code: 'MICRO', name: 'Справка о рассмотрении причин микроповреждения (микротравмы)', basis: 'ТК РФ ст. 226; приказ Минтруда № 632н', fields: [['victim', 'Работник (ФИО, должность)'], ['when', 'Дата и время', 'datetime-local'], ['place', 'Место'], ['what', 'Характер микроповреждения'], ['firstaid', 'Оказанная первая помощь'], ['circumstances', 'Обстоятельства', 'textarea'], ['causes', 'Причины', 'textarea'], ['measures', 'Мероприятия по предупреждению', 'textarea']] },
    { code: 'N1', name: 'Акт о несчастном случае на производстве (форма Н-1)', basis: '', fields: [] }];
  const D = {
    uiMe: () => ({ ok: true, name: 'Шефова Тест', role: 'Директор', sections: ['home', 'banquets', 'menu', 'planning', 'production', 'stock', 'finance', 'haccp', 'sanitation', 'personnel', 'lab', 'documents', 'reports', 'inspection', 'settings'], perms: {}, modules: {} }),
    getAppUrl: () => '', uiData: () => ({ ok: true, kpis: [], tabs: [] }),
    tsGetPlanInfo: () => JSON.stringify({ success: true, data: { plan: window.__PLAN || 'pro_max', planName: window.__PLANNAME || 'Pro Max', status: 'ACTIVE', mode: 'full', expiresAt: '31.12.2026', daysLeft: 51, message: '', features: allF, featureNames: { contracts: 'Договоры', ai: 'AI-ассистент', ttk_library: 'База отработанных ТТК' }, lockedSections: locked, plans, notices: [], version: '1.0.0', keyMasked: 'TS-K7QM…H2PX', adminUrl: 'https://script.google.com/macros/s/…/exec', canManage: true } }),
    tsLsGetAll: () => JSON.stringify({ success: true, data: { norms, ot: [{ code: 'ИОТ-01', who: 'Повар', ver: '1', approved: '2026-11-01' }, { code: 'ИОТ-05', who: 'Работа с ножами', ver: '1', approved: '' }], jobs: [{ code: 'ДИ-03', name: 'Повар', ver: '2', approved: '2026-11-01' }],
      haccp: [], briefings: [{ 'Дата': '2026-11-02', 'Сотрудник': 'Поварова Тест', 'Должность': 'Повар', 'Вид': 'Первичный', 'Инструкции': 'ИОТ-01, ИОТ-05', 'Провёл': 'Шефова Тест', 'Следующий до': '2027-05-02' }], sout: [], ppe: [], actsIssued: [{ no: 'ОТ-2026-001', kind: 'Справка о рассмотрении причин микроповреждения (микротравмы)', date: '2026-11-05', who: 'Шефова Тест' }],
      actTypes: acts, alerts: [{ kind: 'Инструктаж', what: 'Кондитерова Тест', due: '2026-11-08', overdue: true }, { kind: 'СИЗ', what: 'Поварова Тест: фартук', due: '2026-11-25', overdue: false }] } }),
    tsLsGetDoc: () => JSON.stringify({ success: true, data: { kind: 'ot', org: 'ООО «Тест»', row: { 'Код': 'ИОТ-01', 'Профессия / вид работ': 'Повар', 'Название': 'Инструкция по охране труда для повара', 'Текст': '1. ОБЩИЕ ТРЕБОВАНИЯ ОХРАНЫ ТРУДА\n1.1. К работе допускаются лица, прошедшие медосмотр, вводный и первичный инструктаж…\n\n2. ТРЕБОВАНИЯ ОХРАНЫ ТРУДА ПЕРЕД НАЧАЛОМ РАБОТЫ\n2.1. Надеть спецодежду…', 'Версия': '1', 'Утверждена': '2026-11-01', 'Основание': 'Приказ Минтруда № 772н' } } }),
    tsContractsList: () => JSON.stringify({ success: true, data: { kinds: ['Поставка продуктов', 'Дезинсекция и дератизация', 'Вывоз отходов', 'Лабораторные исследования'], expiring: 1, rows: [
      { ID: 'CT-1', 'Номер': 'П-14/26', 'Дата': '2026-01-10', 'Контрагент': 'ООО «Мясной двор»', 'Вид': 'Поставка продуктов', 'Сумма': 1200000, 'Окончание': '2026-12-01', 'Файл': 'https://drive.google.com', state: 'ИСТЕКАЕТ' },
      { ID: 'CT-2', 'Номер': 'Д-3', 'Дата': '2026-02-01', 'Контрагент': 'ООО «Дезсервис»', 'Вид': 'Дезинсекция и дератизация', 'Сумма': 36000, 'Окончание': '2027-01-31', 'Файл': '', state: 'ДЕЙСТВУЕТ' }] } }),
    tsAiAsk: () => JSON.stringify({ success: true, data: { answer: '1. Разлейте бульон в неглубокие гастроёмкости (слой до 5–7 см).\n2. Охлаждайте в шкафу шоковой заморозки или в ванне со льдом, помешивая.\n3. Зафиксируйте температуру в толще в журнале.\nТочные пределы — в вашей ППК и СанПиН 2.3/2.4.3590-20.\nСверьте с первоисточником перед применением.' } }),
    tsTtkLibrary: () => JSON.stringify({ success: true, data: { total: 3, categories: { 'Супы': 1, 'Горячие блюда': 2 }, sync: { synced: false }, items: [
      { id: 'T1', name: 'Борщ украинский', category: 'Супы', yield: 300, kcal: 112 }, { id: 'T2', name: 'Котлета по-киевски', category: 'Горячие блюда', yield: 150, kcal: 389 }, { id: 'T3', name: 'Бефстроганов', category: 'Горячие блюда', yield: 200, kcal: 276 }] } }),
    tsTtkLibraryCard: () => JSON.stringify({ success: true, data: { id: 'T1', name: 'Борщ украинский', category: 'Супы', yield: 300, protein: 4.1, fat: 5.3, carbs: 11.8, kcal: 112, source: 'ЦЕХ Стандарт',
      ingredients: [{ name: 'Говядина', brutto: 80, netto: 59, unit: 'г' }, { name: 'Свёкла', brutto: 60, netto: 48, unit: 'г' }, { name: 'Капуста белокочанная', brutto: 50, netto: 40, unit: 'г' }], method: 'Свёклу тушат с томатом… Подают со сметаной.', storage: '+2…+6 °C', shelfLife: '24 ч' } }),
    // ---- 2.x
    ts2Now: () => JSON.stringify({ success: true, data: { mode: 'READY_TO_WORK', tasks: [
      { id: 'EXP-1', title: 'Холодильник: температура: Холодильник мясной №1', due: '09:00', overdue: true, mode: 'MEASURE', measure: { kind: 'FRIDGE', unit: '°C', min: 2, max: 6, object: 'Холодильник мясной №1' } },
      { id: 'EXP-2', title: 'Открытие смены', due: '09:00', overdue: false, mode: 'CONFIRM' },
      { id: 'EXP-5', title: 'Морозильник: температура: Морозильник рыбный №2', due: '18:00', overdue: false, auto: true, mode: 'MEASURE', measure: { kind: 'FREEZER', unit: '°C', min: -25, max: -18, object: 'Морозильник рыбный №2' } },
      { id: 'EXP-3', title: 'Тепловая обработка: ККТ при выпуске — замер не получен автоматически: укажите значение — Котлета куриная', due: '12:40', overdue: false, mode: 'MEASURE', measure: { kind: 'CCP', unit: '°C', min: '', max: '', object: '' } },
      { id: 'EXP-4', title: 'Санитарная обработка рабочих мест — Горячий цех', due: '15:00', overdue: false, mode: 'CONFIRM' },
      { id: 'EXP-6', title: 'ППК: Смывы с рук: Лабораторное исследование: БГКП', due: '10:00', overdue: false, mode: 'CONFIRM', checklist: ['Выполнено: Лабораторное исследование: БГКП — Смывы с рук', 'Способ: ГОСТ 31747', 'Протокол лаборатории получен и приложен'], onFail: 'при несоответствии — блокировка партии, повторное исследование, отклонение и корректирующее действие' }] } }),
    ts2Exceptions: () => JSON.stringify({ success: true, data: { exceptions: [{ autoRecordId: 'ARC-1', createdAt: '2026-11-11T08:12:00Z', value: 'Морозильник №2: -12 °C (норма -25…-18) — дверь была открыта', confirmedByEmployee: 'Поварова Тест' }], overdue: [], autoToday: 14 } }),
    ts2Wizard: () => JSON.stringify({ success: true, data: { mode: 'READY_TO_WORK', enterpriseType: 'RESTAURANT', types: { RESTAURANT: 'Ресторан', CANTEEN: 'Столовая', CAFE: 'Кафе', CONFECTIONERY: 'Кондитерское производство', CATERING: 'Кейтеринг' },
      org: { name: 'ООО «Тест»', inn: '7700000000', address: 'г. Москва, ул. Тестовая, 1', responsible: 'Хассапова Тест', complete: true }, timezone: 'Europe/Moscow', employees: 12, dishes: 148,
      workshops: [['WS-1', 'Горячий цех', 'ACTIVE', ''], ['WS-2', 'Холодный цех', 'ACTIVE', ''], ['WS-3', 'Кондитерский цех', 'NOT_APPLICABLE', 'Десерты закупаем готовыми'], ['WS-4', 'Склад сырья', 'ACTIVE', ''], ['WS-5', 'Зона отгрузки и выдачи', 'ACTIVE', '']].map(w => ({ workshopId: w[0], name: w[1], status: w[2], notApplicableReason: w[3], zoneType: 'WORKSHOP' })),
      objects: [{ objectId: 'OBJ-1', name: 'Холодильник мясной №1', objectType: 'FRIDGE', minValue: 2, maxValue: 6, checkTimes: '09:00,18:00', status: 'ACTIVE' }, { name: 'Морозильник №2', objectType: 'FREEZER', minValue: -25, maxValue: -18, checkTimes: '09:00,18:00', status: 'ACTIVE' }, { name: 'Горячий цех', objectType: 'ROOM', minValue: 16, maxValue: 28, checkTimes: '10:00', status: 'ACTIVE' }],
      summary: { created: 214, requiresDecision: 15, numericObjects: 3, blockers: 1 } } }),
    ts2Sensors: () => JSON.stringify({ success: true, data: { url: 'https://script.google.com/macros/s/TEST/exec', devices: [{ deviceId: 'SNS-000001', object: 'Холодильник мясной №1', status: 'ACTIVE', inputMode: 'SENSOR', lastValue: 4.2, silentMin: 3, rssi: -62, offset: 0.3, calibratedAt: '2026-10-02T10:15:00.000Z', calDueDays: 52 }, { deviceId: 'SNS-000002', object: 'Склад сухих продуктов', status: 'ACTIVE', inputMode: 'MANUAL', lastValue: 18.4, silentMin: 74, silent: true, rssi: -83, offset: 0, calibratedAt: '', calDueDays: 60 }], calibrations: [{ at: '2026-10-02T10:15:00.000Z', deviceId: 'SNS-000001', thermometer: 'Testo 104, зав. № 41207', reference: 4.5, raw: 4.2, difference: 0.3, offset: 0.3, result: 'OK', by: 'Иванова А. С.' }] } }),
    ts2SensorRegister: () => JSON.stringify({ success: true, data: { deviceId: 'SNS-000002', token: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4', url: 'https://script.google.com/macros/s/TEST/exec', example: { device: 'SNS-000002', token: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4', value: 4.2 } } }),
    ts2ApprovalQueue: () => JSON.stringify({ success: true, data: { queue: [
      { approvalId: 'APQ-1', objectType: 'SYSTEM_DOCUMENT', objectId: 'SDOC-2', title: 'Программа производственного контроля', reason: 'Документ подготовлен системой — утвердите от имени предприятия', requiredRole: 'Директор', status: 'PENDING' },
      { approvalId: 'APQ-2', objectType: 'SYSTEM_DOCUMENT', objectId: 'SDOC-9', title: 'Инструкция по приёмке сырья', reason: 'Подтвердите применимость типовой инструкции', requiredRole: 'Ответственный за ХАССП', status: 'PENDING' },
      { approvalId: 'APQ-3', objectType: 'GENERATION_PACKAGE', objectId: 'GEN-1', title: 'ТУ/СТО/ППК по ТТК «Котлета куриная»', reason: 'Документы подготовлены системой из ТТК — утвердите одной кнопкой', requiredRole: 'Ответственный за ХАССП', status: 'PENDING' }],
      documents: [['TPL-001', 'Положение о системе производственного контроля', 'ACTIVE', 'Директорова Тест (Директор)', 'F1'], ['TPL-002', 'Программа производственного контроля', 'REQUIRES_ENTERPRISE_APPROVAL', '', ''], ['TPL-005', 'Реестр ККТ', 'ACTIVE', 'Хассапова Тест (Ответственный за ХАССП)', 'F5'], ['TPL-007', 'Типовые журналы контроля', 'SYSTEM_APPROVED', '', '']]
        .map(d => ({ documentId: 'SDOC-' + d[0].slice(4), templateId: d[0], title: d[1], status: d[2], approvedByEnterprise: d[3], fileId: d[4] })) } }),
    ts2GenList: () => JSON.stringify({ success: true, data: { dishes: [{ code: 'D-1', name: 'Котлета куриная' }, { code: 'D-2', name: 'Салат овощной' }], jobs: [{ id: 'GEN-1', ttkId: 'D-1', name: 'Котлета куриная', status: 'APPLIED', types: 'TU+STO+PPK', issues: 1, at: '2026-11-11T09:00:00Z' }],
      tu: [{ tuNumber: 'ТУ 000001-0001', title: 'Изменение ТУ «Горячие блюда» — Котлета куриная (версия 1)', version: 1, status: 'REQUIRES_ENTERPRISE_APPROVAL', fileId: 'X' }], sto: [], ppk: [] } }),
    ts2GenPreview: () => JSON.stringify({ success: true, data: { job: { generationJobId: 'GEN-2', status: 'PREVIEW' }, existing: false, name: 'Котлета куриная', types: ['TU', 'STO', 'PPK'], tuSkipped: false,
      counts: { facts: 9, auto: 8, review: 1, issues: 1, blocking: 1 }, canApply: true, canApprove: false,
      controls: [{ name: 'ККТ: тепловая обработка — Котлета куриная', criticalLimit: 't° не ниже 75 °C', limitSource: 'ТТК D-1: «до температуры в толще не ниже 75 °C»', journalCode: 'J-KKT-THERMAL' }, { name: 'ККТ: охлаждение — Котлета куриная', criticalLimit: '', limitSource: 'REQUIRES_SOURCE', journalCode: 'J-COOLING' }],
      hazards: [{ process: 'THERMAL', hazardType: 'B', description: 'Выживание патогенных микроорганизмов при недостаточной тепловой обработке' }, { process: 'MECHANICAL', hazardType: 'P', description: 'Металлические и иные посторонние примеси' }],
      issues: [{ issueId: 'GI-1', severity: 'CONFLICT', message: 'CONFLICT_DUPLICATE_TTK: ТТК с тем же названием — D-3', suggestedAction: 'Архивируйте дубликат или переименуйте', status: 'OPEN' }],
      facts: [{ fieldCode: 'limit.THERMAL', normalizedValue: '{"op":">=","value":75}', sourceText: 'Обжарить и запекать до температуры в толще не ниже 75 °C', confidence: 0.95, status: 'ACCEPTED' }, { fieldCode: 'yield', normalizedValue: '150', sourceText: 'Блюда!D2', confidence: 1, status: 'ACCEPTED' }, { fieldCode: 'shelfLifeHours', normalizedValue: '24', sourceText: 'Блюда, «Срок реализации (ч)»', confidence: 1, status: 'ACCEPTED' },
        { fieldCode: 'storageConditions', normalizedValue: '{"min":2,"max":6}', sourceText: 'Хранить при t от +2 до +6 °C', confidence: 0.9, status: 'REVIEW' }] } }),
    ts2Reconciliation: () => JSON.stringify({ success: true, data: { runs: [], rules: [], issues: [
      { issueId: 'I1', severity: 'BLOCKER', entityType: 'Сотрудники и роли', message: 'Не назначен ответственный за ХАССП', suggestedAction: 'Назначьте роль в «Персонал»', entityId: '—', status: 'OPEN' },
      { issueId: 'I2', severity: 'MAJOR', entityType: 'DISH', message: 'Срок реализации не задан или указан без основания', suggestedAction: 'Укажите срок и основание', entityId: 'D-12', status: 'OPEN' },
      { issueId: 'I3', severity: 'CRITICAL', entityType: 'EMPLOYEE', message: 'У сотрудника нет действующего медицинского допуска', suggestedAction: 'Внесите медкнижку', entityId: 'Поварова Тест', status: 'OPEN' }],
      proposals: [{ changeProposalId: 'CHG-1', operationType: 'UPDATE', entityId: 'D-7', reason: 'Выход = сумма нетто состава (420 г)', status: 'PROPOSED' }, { changeProposalId: 'CHG-2', operationType: 'ARCHIVE', entityId: 'D-3', reason: 'Дубликат D-1', status: 'APPLIED', rollbackAvailable: true }] } }),
    // ---- Мастер-промт 4.0: цепочка контроля
    ttkProcOverview: () => JSON.stringify({ success: true, data: { ttk: { ACTIVE: 148, DRAFT: 3, ARCHIVED: 12 }, analyzed: 148, dictVersion: '2026-11-11.1', dictionary: [], issuesTotal: 9,
      model: [{ processCode: 'FRY', name: 'Жарка', ttkCount: 41, reviewRequired: 1 }, { processCode: 'BOIL', name: 'Варка', ttkCount: 37, reviewRequired: 0 }, { processCode: 'COOL', name: 'Охлаждение', ttkCount: 22, reviewRequired: 0 },
        { processCode: 'BAKE', name: 'Запекание', ttkCount: 19, reviewRequired: 1 }, { processCode: 'SOUSVIDE', name: 'Су-вид', ttkCount: 4, reviewRequired: 0 }, { processCode: 'VACUUM', name: 'Вакуумирование', ttkCount: 6, reviewRequired: 0 }],
      review: [{ id: 'TPM-000412', ttkId: 'ТТК-0087', process: 'Жарка', text: 'Овощи обжарить или запечь до готовности 10 мин.', parent: '', confidence: 0.6, method: 'DICTIONARY', note: '' },
        { id: 'TPM-000415', ttkId: 'ТТК-0087', process: 'Запекание', text: 'Овощи обжарить или запечь до готовности 10 мин.', parent: '', confidence: 0.6, method: 'DICTIONARY', note: '' }],
      issues: [{ ttkId: 'ТТК-0102', code: 'NO_COOLING_STAGE', message: 'После тепловой обработки продукт хранится, но этап охлаждения не описан' }, { ttkId: 'ТТК-0102', code: 'NO_PARAMS', message: 'Операция «Варка»: не указаны параметры (температура или время)' },
        { ttkId: 'ТТК-0131', code: 'SEMI_LINK_MISSING', message: 'Ингредиент «Бульон куриный п/ф» — полуфабрикат, но его ТТК в реестре не найдена' }] } }),
    ttkProcAnalyze: () => JSON.stringify({ success: true, data: { analyzed: 148, added: ['x'], removed: [], openIssues: 9 } }),
    haccpLinkMap: () => JSON.stringify({ success: true, data: { counts: { NEEDS_DECISION: 2, CONTROLLED: 9, NOT_SIGNIFICANT: 4, NO_CONTROL: 1 }, gaps: ['значимая опасность «Перекрёстное загрязнение сырья» (Мойка): нет ККТ/ОППУ и доказательства'],
      rows: [{ processName: 'Жарка', ttkCount: 41, hazard: 'Выживание патогенов при недостаточной прожарке', controlMeasure: 'ОППУ: температура в толще термощупом', journalId: 'J-KKT-THERMAL', status: 'CONTROLLED', controlType: 'ОППУ/ППУ', v30HazardId: 'HZ-PROC-TTK-FRY-MH-B-THERMAL' },
        { processName: 'Охлаждение', ttkCount: 22, hazard: 'Прорастание спор и рост микрофлоры при медленном охлаждении', controlMeasure: 'Шоковое охлаждение, контроль времени', journalId: 'J-COOLING', status: 'CONTROLLED', controlType: 'ККТ', v30HazardId: 'HZ-P05-MH-B-COOLING' },
        { processName: 'Нарезка', ttkCount: 63, hazard: 'Металлические и иные посторонние примеси', controlMeasure: 'исправность инвентаря и оборудования', journalId: '', status: 'NEEDS_DECISION', controlType: '', v30HazardId: 'HZ-PROC-TTK-CUT-MH-P-METAL' },
        { processName: 'Мойка', ttkCount: 30, hazard: 'Перекрёстное загрязнение сырья', controlMeasure: '', journalId: '', status: 'NO_CONTROL', controlType: '', v30HazardId: 'HZ-PROC-TTK-WASH-MH-B-CROSS' }] } }),
    haccpLinkSync: () => JSON.stringify({ success: true, data: { processesAdded: 0, hazardsProposed: 0, needDecision: 2 } }),
    clgTemplates: () => JSON.stringify({ success: true, data: { ppk: { id: 'PPK-1', name: 'Программа производственного контроля', version: 3 }, templates: [
      { id: 'CLT-000003', title: 'Вентиляция: Чистка фильтров', items: ['Выполнено: Чистка фильтров — Вентиляция'], mode: 'NO_SCHEDULE', coveredBy: '', frequency: '', time: '10:00', role: 'Директор' },
      { id: 'CLT-000001', title: 'Смывы с рук: Лабораторное исследование: БГКП', items: ['Выполнено: Лабораторное исследование: БГКП — Смывы с рук', 'Способ: ГОСТ 31747', 'Протокол лаборатории получен и приложен'], mode: 'TASK', coveredBy: '', frequency: 'раз в 30 дней', time: '10:00', role: 'Ответственный за ХАССП' },
      { id: 'CLT-000002', title: 'Программа производственного контроля: Верификация выполнения ППК', items: ['Выполнено: Верификация выполнения ППК', 'Способ: анализ графика, отклонений, протоколов'], mode: 'TASK', coveredBy: '', frequency: 'ежемесячно', time: '10:00', role: 'Ответственный за ХАССП' },
      { id: 'CLT-000004', title: 'Жарка (ТТК: 41): Мера управления: ОППУ: температура в толще термощупом', items: ['Выполнено: Мера управления', 'Запись в журнале J-KKT-THERMAL'], mode: 'EVENT', coveredBy: 'Выпуск продукции (бракераж, ККТ по событию)', frequency: 'при каждой выработке', time: '10:00', role: 'Повар' },
      { id: 'CLT-000005', title: 'Персонал: Ежедневный осмотр на допуск к работе', items: ['Выполнено: Ежедневный осмотр'], mode: 'COVERED', coveredBy: 'Контроль медицинских допусков смены (экран «Сейчас»)', frequency: 'ежедневно', time: '10:00', role: 'Шеф-повар' },
      { id: 'CLT-000006', title: 'Персонал: Медицинские осмотры и гигиеническая аттестация', items: ['Выполнено: Медицинские осмотры'], mode: 'DATE', coveredBy: 'Контроль медицинских допусков (правило R-006)', frequency: 'по сроку медицинской книжки', time: '10:00', role: 'Директор' }] } }),
    clgBuild: () => JSON.stringify({ success: true, data: { ppkId: 'PPK-1', TASK: 2, EVENT: 1, COVERED: 1, DATE: 1, NO_SCHEDULE: 1 } }),
    vioList: () => JSON.stringify({ success: true, data: { mode: 'SECOND_PERSON', items: [
      { id: 'DV-1731', source: 'TS2', journal: 'J-STORAGE-T', object: 'Морозильник рыбный №2', text: 'Морозильник №2: -12 °C (норма -25…-18) — дверь была открыта', status: 'ожидает проверки', critical: false, foundBy: 'Поварова Тест', at: '2026-11-12T08:12:00', corrector: 'Поварова Тест' },
      { id: 'DV-1729', source: 'V43', journal: 'Санитария', object: 'Горячий цех', text: 'Концентрация 0,3 % вне режима 0,5 %', status: 'открыто повторно', critical: false, foundBy: 'Мойщикова Тест', at: '2026-11-11T16:40:00', corrector: '' },
      { id: 'DV-1725', source: 'TS2', journal: 'LAB:L1', object: 'ППК: Смывы с рук: БГКП', text: 'Не выполнен пункт 3: Протокол лаборатории получен и приложен', status: 'открыто', critical: false, foundBy: 'Хассапова Тест', at: '2026-11-11T10:05:00', corrector: '' },
      { id: 'DV-1720', source: 'журналы', journal: 'J03', object: 'Котлета куриная', text: 'ККТ: 68 °C в толще (норма не ниже 75 °C)', status: 'открыто', critical: true, foundBy: 'Поварова Тест', at: '2026-11-11T12:40:00', corrector: '' }] } }),
    a360Run: () => JSON.stringify({ success: true, data: { overall: 'READY_WITH_WARNINGS', score: 82, runId: 'RDY-1762930000000', html: '<h2>Акт внутреннего санитарного аудита 360°</h2>', note: 'Готовность по внутреннему контрольному листу. Не является заключением надзорного органа.',
      counts: { PASS: 22, FAIL: 2, REVIEW: 3, MISSING_EVIDENCE: 0, NOT_APPLICABLE: 1 }, items: [
        { id: 'R22', area: 'HACCP', requirement: 'Для каждой операции действующих ТТК проведён анализ опасностей; значимые опасности под ККТ или мерой с доказательством', status: 'FAIL', blocking: true, detail: 'операций: 18, без анализа: 0, без решения: 2, значимых без меры: 1', evidence: ['HZ-PROC-TTK-WASH-MH-B-CROSS', 'HZ-PROC-TTK-CUT-MH-P-METAL'], correctiveAction: 'Процессы ТТК → «Опасности ХАССП»: свяжите с ТТК и примите решения', go: { module: 'tsTtkProc' } },
        { id: 'R25', area: 'ППК', requirement: 'График ППК за 30 дней выполнен: по каждому пункту есть факт; пропусков нет', status: 'FAIL', blocking: false, detail: 'пунктов со сроком: 46, выполнено: 44, не выполнено: 1, с отклонением: 1 (96%)', evidence: ['SCH-7F3A21C0'], correctiveAction: 'Экран «Сейчас»: задачи ППК; пропуски разберите как нарушения', go: { module: 'tsNow' } },
        { id: 'R27', area: 'Нарушения', requirement: 'Нарушения устраняются в течение 3 суток, устранение подтверждено другим сотрудником', status: 'REVIEW', blocking: false, detail: 'открыто: 4, дольше 3 суток: 0, открыто повторно: 0, ждут проверки: 1', evidence: ['DV-1731'], correctiveAction: 'Экран «Сейчас»: отклонения и «Ожидают проверки»', go: { module: 'tsNow' } },
        { id: 'R21', area: 'ТТК', requirement: 'Действующие ТТК проанализированы: операции определены, режимы и сроки указаны в картах', status: 'REVIEW', blocking: false, detail: 'ТТК действующих: 148, не проанализировано: 0, «требуется заполнение ТТК»: 9, операций на проверку: 2', evidence: ['TPI-000031', 'TPI-000032'], correctiveAction: 'Процессы ТТК → «Проанализировать все ТТК», дополните карты по замечаниям', go: { module: 'tsTtkProc' } },
        { id: 'R23', area: 'ППК', requirement: 'Действующая ППК полна: зоны, опасности, ККТ, лаборатория, ответственные, документы, связь с ТТК, разделы', status: 'PASS', blocking: true, detail: 'все проверки пройдены', evidence: ['PPK-1'], correctiveAction: '' },
        { id: 'R05', area: 'Температуры', requirement: 'Температура холодильного оборудования замеряется ежедневно; отклонения отработаны', status: 'PASS', blocking: true, detail: 'последний замер сегодня', evidence: ['TM-20261112-01'], correctiveAction: '' }] } }),
    a360Evidence: (tok, id) => JSON.stringify({ success: true, data: { id, kind: 'Опасность (анализ опасностей ХАССП)', sheet: 'HACCP_Опасности_V30', module: 'tsTtkProc', related: [],
      fields: [['ID опасности', id], ['Процесс', 'PROC-TTK-WASH'], ['Вид', 'B'], ['Опасность', 'Перекрёстное загрязнение сырья'], ['Причина', 'Операция «Мойка» в действующих ТТК'], ['Предупреждающая мера', 'обработка сырья в отдельной зоне'], ['Значима', 'да'], ['Статус', 'действует'], ['Кем', 'ЦЕХ Стандарт (предложение) (решение: Хассапова Тест, 2026-11-11)']] } }),
    ppkLegacyState: () => JSON.stringify({ success: true, data: { v35: { documents: 1, processes: 6, hazards: 14, controls: 5 }, v37: { documents: 2, processes: 31, controls: 3 }, importedToV30: 0 } }),
  };
  function mk() { let ok = () => {}, fl = () => {}; const o = new Proxy({}, { get(t, k) {
    if (k === 'withSuccessHandler') return f => { ok = f; return o; }; if (k === 'withFailureHandler') return f => { fl = f; return o; }; if (k === 'withUserObject') return () => o;
    return (...a) => setTimeout(() => { try { ok(D[k] ? D[k](...a) : { ok: true, data: [] }); } catch (e) { fl(e); } }, 10);
  } }); return o; }
  window.google = { script: { get run() { return mk(); } } };
};

const MARK = (boxes) => {
  // метки как в руководстве MonChef: оранжевая рамка и номер в кружке
  document.querySelectorAll('.__mk').forEach(e => e.remove());
  boxes.forEach((b, i) => {
    const r = b.getBoundingClientRect ? b.getBoundingClientRect() : b;
    const f = document.createElement('div'); f.className = '__mk';
    Object.assign(f.style, { position: 'fixed', left: (r.left - 4) + 'px', top: (r.top - 4) + 'px', width: (r.width + 8) + 'px', height: (r.height + 8) + 'px', border: '3px solid #e8731a', borderRadius: '10px', zIndex: 99999, pointerEvents: 'none', boxSizing: 'border-box' });
    const c = document.createElement('div'); c.className = '__mk'; c.textContent = String(i + 1);
    Object.assign(c.style, { position: 'fixed', left: (r.left + r.width - 8) + 'px', top: (r.top - 16) + 'px', width: '26px', height: '26px', borderRadius: '50%', background: '#e8731a', color: '#fff', font: '700 15px Arial', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100000, border: '2px solid #fff' });
    document.body.append(f, c);
  });
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2, locale: 'ru-RU' });
  const p = await ctx.newPage();
  await p.addInitScript(([n, l]) => { window.__PLAN = n; window.__LVL = l[1]; window.__PLANNAME = l[0]; }, [PLAN, PLANS[PLAN]]);
  await p.addInitScript(fakeInit);
  const shot = async (name, sels, clip) => {
    await p.evaluate(() => document.querySelectorAll('.__mk').forEach(e => e.remove()));
    const els = [];
    for (const s of sels) { const h = await p.$(s); if (!h) throw new Error('нет элемента ' + s + ' для ' + name); els.push(h); }
    await p.evaluate((list) => window.__mark(list), els);
    await p.waitForTimeout(150);
    await p.screenshot({ path: path.join(OUT, name + '.png'), clip: clip || undefined, fullPage: !clip });
  };
  await p.goto('file://' + CONSOLE);
  await p.evaluate(`window.__mark = ${MARK.toString()}`);
  // вход
  await shot('login', ['#pad', '#pad button[data-k="Войти"]'], { x: 400, y: 120, width: 600, height: 640 });
  // главное окно
  await p.evaluate(() => { localStorage.setItem('mc_token', 'x'); TOKEN = 'x'; start(null); });
  await p.waitForTimeout(600);
  await p.evaluate(() => { if (ACC && ACC.modules) ['ppk', 'ppkbuilder', 'ttkppk', 'compliance'].forEach(m => { ACC.modules[m] = true; }); });   // как у директора: полоса цепочки без приглушённых шагов
  const view = async (id) => { await p.evaluate(() => { try { closeMdl(); } catch (e) {} }); await p.click(`button[data-ts="${id}"]`); await p.waitForTimeout(500); };
  await view('tsPlan');
  await shot('plan', ['#tsPlanBadge', '.kpis', '.pwdays', '#mvf_key', 'button[data-mv="activate"]'], { x: 0, y: 0, width: 1400, height: 900 });
  await view('tsLabor');
  await shot('labor_norms', ['.mvcard', '.tabs', 'button[data-mv="verify"]'], { x: 0, y: 0, width: 1400, height: 900 });
  await p.click('button[data-mv="tab"][data-a="brief"]'); await p.waitForTimeout(300);
  await shot('labor_brief', ['#mvf_Сотрудник', '#mvf_Вид', '#mvf_Инструкции', 'button[data-mv="save"]'], { x: 230, y: 0, width: 1170, height: 900 });
  await p.click('button[data-mv="tab"][data-a="ot"]'); await p.waitForTimeout(300);
  await p.click('button[data-mv="doc"]'); await p.waitForTimeout(400);
  await shot('labor_doc', ['textarea[data-tsk="Текст"]', 'input[data-tsk="Утверждена"]', '#tsDocSave', '#tsDocPrint'], { x: 200, y: 0, width: 1200, height: 900 });
  await p.evaluate(() => closeMdl());
  await p.click('button[data-mv="tab"][data-a="acts"]'); await p.waitForTimeout(300);
  await shot('labor_acts', ['#tsActType', '#mvf_act_victim', 'button[data-mv="act"]'], { x: 230, y: 0, width: 1170, height: 900 });
  const lvl = PLANS[PLAN][1];
  if (lvl >= 3) {
  await view('tsContracts');
  await shot('contracts', ['.kpis', '#mvf_Номер', 'button[data-mv="save"]', 'button[data-mv="upload"]'], null);
  }
  if (lvl >= 4) {
  await view('tsAi');
  await p.fill('#mvf_q', 'Как правильно охладить бульон после варки?');
  await p.click('button[data-mv="ask"]'); await p.waitForTimeout(500);
  await shot('ai', ['#tsChat', '#mvf_q', '#mvf_ttk', 'button[data-mv="ask"]'], { x: 230, y: 0, width: 1170, height: 900 });
  await view('tsTtkLib');
  await shot('ttklib', ['#mvf_lq', 'button[data-mv="refresh"]', 'button[data-mv="card"]'], { x: 230, y: 0, width: 1170, height: 700 });
  await p.click('button[data-mv="card"]'); await p.waitForTimeout(400);
  await shot('ttklib_card', ['.kb', '#tsLibAdd'], { x: 200, y: 0, width: 1200, height: 900 });
  }
  if (lvl >= 2) {   // режим «Готов к работе» и генерация ППК — с Basic Pro
  await view('tsNow');
  await shot('now', ['.kpis', 'input[id="ts2v_EXP-1"]', 'button[data-mv="measure"][data-a="EXP-1"]', 'button[data-mv="yes"][data-a="EXP-2"]', 'button[data-mv="no"][data-a="EXP-2"]', 'button[data-mv="resolve"]'], null);
  await view('tsSetup');
  await p.click('button[data-mv="go"][data-a="2"]'); await p.waitForTimeout(300);
  await shot('setup_mode', ['.kpis', '.tabs', '#mvf_type', '#mvf_mode', 'button[data-mv="save2"]'], { x: 0, y: 0, width: 1400, height: 900 });
  await p.click('button[data-mv="go"][data-a="4"]'); await p.waitForTimeout(300);
  await p.waitForTimeout(300);
  await shot('setup_equipment', ['#mvf_otype', '#mvf_omin', '#mvf_omax', 'button[data-mv="save4"]', 'button[data-mv="snsAdd"]'], null);
  await shot('setup_sensors', ['button[data-mv="snsMan"]', 'button[data-mv="snsAuto"]', 'button[data-mv="snsCal"]'], null);
  await p.click('button[data-mv="snsAdd"]'); await p.waitForTimeout(400);
  await shot('setup_sensor', ['#mdlBox pre'], null);
  await p.evaluate(() => closeMdl());
  await p.click('button[data-mv="go"][data-a="7"]'); await p.waitForTimeout(300);
  await shot('setup_queue', ['button[data-mv="sdoc"]', 'button[data-mv="approve"]', 'button[data-mv="sdocr"]'], null);
  await view('tsGen');
  await p.click('button[data-mv="preview"]'); await p.waitForTimeout(500);
  await shot('gen_preview', ['.kpis', 'button[data-mv="resolve"]', 'button[data-mv="apply"]'], null);
  }
  if (lvl >= 2) {   // Мастер-промт 4.0: цепочка ТТК → ХАССП → ППК → чек-листы (функция ППК — с Basic Pro)
  await view('tsTtkProc');
  await shot('ttkproc', ['nav.tschain', '.kpis', 'button[data-mv="run"]', 'button[data-mv="tab"][data-a="model"]'], { x: 0, y: 0, width: 1400, height: 900 });
  await p.click('button[data-mv="tab"][data-a="review"]'); await p.waitForTimeout(300);
  await shot('ttkproc_review', ['button[data-mv="ok"][data-a="TPM-000412"]', 'button[data-mv="no"][data-a="TPM-000412"]', 'button[data-mv="ai"][data-a="TPM-000412"]'], { x: 230, y: 0, width: 1170, height: 900 });
  await p.click('button[data-mv="tab"][data-a="issues"]'); await p.waitForTimeout(300);
  await shot('ttkproc_issues', ['.mvcard:last-of-type'], { x: 230, y: 0, width: 1170, height: 900 });
  await p.click('button[data-mv="tab"][data-a="haccp"]'); await p.waitForTimeout(500);
  await shot('ttkproc_haccp', ['.kpis', 'button[data-mv="hzSync"]', 'button[data-mv="hzYes"][data-a="HZ-PROC-TTK-CUT-MH-P-METAL"]', 'button[data-mv="hzNo"][data-a="HZ-PROC-TTK-CUT-MH-P-METAL"]'], null);
  await view('tsChecklists');
  await shot('checklists', ['.kpis', 'button[data-mv="build"]'], null);
  await view('tsNow');
  await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(200);
  await shot('now_checklist', ['button[data-mv="yes"][data-a="EXP-6"]', 'button[data-mv="no"][data-a="EXP-6"]', 'button[data-mv="vok"]', 'button[data-mv="vno"]'], null);
  await p.evaluate(() => { if (ACC && ACC.modules) ACC.modules.ppkbuilder = true; openView('ppkbuilder'); }); await p.waitForTimeout(500);
  await shot('ppk_legacy', ['.ttnote', 'button[data-mv="imp"]'], { x: 230, y: 0, width: 1170, height: 700 });
  }
  // нарушения и аудит 360° — во всех тарифах
  await view('tsViolations');
  await shot('violations', ['.kpis', '.tabs', 'button[data-mv="fix"][data-a="DV-1720"]', 'button[data-mv="vok"][data-a="DV-1731"]', 'button[data-mv="vno"][data-a="DV-1731"]'], null);
  await view('tsAudit360');
  await shot('audit360', ['.kpis', 'button[data-mv="print"]', '.tabs', 'button[data-mv="go"]'], null);
  await p.click('a:has-text("HZ-PROC-TTK-WASH-MH-B-CROSS")'); await p.waitForTimeout(400);
  await shot('audit_evidence', ['#mdlBox table', '#mdlBox .btn.pri'], { x: 200, y: 0, width: 1200, height: 900 });
  await p.evaluate(() => closeMdl());
  await view('tsData');
  await p.waitForTimeout(400);
  await shot('data_recon', ['.kpis', 'button[data-mv="recon"]', 'button[data-mv="pok"]', 'button[data-mv="prb"]'], null);
  await b.close();
  console.log('снимки готовы:', fs.readdirSync(OUT).length);
})().catch(e => { console.error(e); process.exit(1); });
