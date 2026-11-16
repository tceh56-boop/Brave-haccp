/**
 * MON CHEF — роли и права доступа (этап 10.7, ТЗ «Система ролей и разграничения прав доступа»).
 *
 * RBAC: права даёт роль (MC_RB_MATRIX_) плюс индивидуальные права, которые Директор выдаёт конкретному
 * сотруднику из разрешённого списка (MC_RB_GRANTABLE_), с причиной и сроком. Запрещено всё, что не разрешено.
 *
 * Где проверяется:
 *   • единый шлюз (zzz_MonChef_Gate.gs) — КАЖДЫЙ вызов из интерфейса, чтение и запись, по карте функция → право;
 *     отказ — код FORBIDDEN (http 403) и запись ACCESS_DENIED в аудит;
 *   • внутри функций — вторая линия (_requireAuth_, _mcBlAuth_); старые ключи прав понимаются через MC_RB_ALIAS_;
 *   • открытие страницы (doGet) и разделы нового интерфейса — по картам MC_RB_MODULES_ и MC_RB_SECTIONS_.
 * Права берутся из ТЕКУЩЕЙ роли при каждом вызове (_mcRbRefresh_): смена роли и увольнение действуют сразу.
 *
 * Технический доступ (код 2258): не роль и не сотрудник — в списках, выборе исполнителя и шапке его нет.
 * Полный доступ к настройкам и данным, но записи ХАССП (журналы, бракераж, приёмка, гашение ВСД, подписи)
 * не делает — их автор должен быть сотрудником с ролью и медицинским допуском. Каждый вход и действие — в аудите
 * с автором «Технический доступ». Код хранится только хешем; ошибки ввода блокируют технический вход
 * с нарастанием (15 мин → 1 ч → 24 ч), не блокируя сотрудников.
 */
var MC_RB_ROLES_ = ['Директор', 'Администратор', 'Шеф-повар', 'Су-шеф', 'Кондитер', 'Повар холодного цеха', 'Повар горячего цеха', 'Ответственный за ХАССП'];
var MC_RB_TECH_ = 'Технический доступ';
var MC_RB_LEGACY_ = { 'Руководитель': 'Директор' };            // прежние названия → новые (без потери прав)
var MC_RB_LEGACY_COOK_ = 'Повар';                                // прежний «Повар»: цех не указан — права обоих цехов до выбора
var MC_RB_RETIRED_ = ['Кладовщик', 'Закупщик', 'Санитарный работник', 'Медработник', 'Бракеражная комиссия', 'Аудитор'];
var MC_RB_CREATOR_POS_ = 'Создатель системы';

/** Права: ключ, что даёт, раздел. */
var MC_RB_PERMS_ = [
  ['banquets_view', 'Банкеты — просмотр, в том числе данные заказчика', 'Банкеты'],
  ['banquets', 'Банкеты — создание и изменение', 'Банкеты'],
  ['banquet_scan', 'Скан бланка и QR банкета', 'Банкеты'],
  ['catalog', 'Каталог, меню, ТТК — просмотр действующей версии', 'Меню и ТТК'],
  ['ttk_edit', 'ТТК — создание и изменение (черновик)', 'Меню и ТТК'],
  ['ttk_approve', 'ТТК — ввод версии в действие, возврат версии, архив карты', 'Меню и ТТК'],
  ['ttk_history', 'История изменений ТТК — просмотр', 'Меню и ТТК'],
  ['costs', 'Себестоимость и закупочные цены', 'Меню и ТТК'],
  ['plan', 'Планирование — просмотр', 'Производство'],
  ['plan_edit', 'Планирование — изменение (план недели, публикация)', 'Производство'],
  ['kanban', 'Производственные задания — выполнение', 'Производство'],
  ['prod_manage', 'Производство — назначение заданий, выпуск и выдача', 'Производство'],
  ['batch_use', 'Вскрытие и использование партий, обработка сырья, дефрост', 'Производство'],
  ['hot_ccp', 'ККТ горячего цеха: тепловая обработка, шоковое охлаждение, разогрев, фритюр', 'Производство'],
  ['shop_hot', 'Задания, ККТ и план горячего цеха', 'Производство'],
  ['shop_cold', 'Задания, ККТ и план холодного цеха', 'Производство'],
  ['shop_pastry', 'Задания, ККТ и план кондитерского цеха', 'Производство'],
  ['shop_all', 'Задания и план всех цехов', 'Производство'],
  ['stock_view', 'Склад — остатки и партии (просмотр)', 'Склад'],
  ['stock', 'Склад — перемещение, списание, корректировки, места хранения, ревизия', 'Склад'],
  ['receiving', 'Приёмка товара: сверка, входной контроль, подтверждение', 'Склад'],
  ['invoices_view', 'Накладные — просмотр', 'Склад'],
  ['doc_correct', 'Корректировка проведённой накладной — создание (с причиной)', 'Склад'],
  ['doc_edit', 'Корректировка проведённой накладной — утверждение', 'Склад'],
  ['procurement', 'Заказы поставщикам и поставщики', 'Склад'],
  ['labels', 'Маркировка (этикетки)', 'Склад'],
  ['documents_view', 'Документы на сырьё — просмотр', 'Документы'],
  ['documents', 'Документы на сырьё и реестр документов — регистрация и проверка', 'Документы'],
  ['vsd_view', 'ВСД — просмотр', 'Документы'],
  ['mercury', 'ВСД и «Меркурий» — просмотр, получение, сопоставление', 'Документы'],
  ['vsd_cancel', 'Гашение и отклонение ВСД', 'Документы'],
  ['brakerage', 'Бракераж', 'ХАССП'],
  ['journals', 'Журналы и замеры (по ролям журнала)', 'ХАССП'],
  ['checklists', 'Чек-листы', 'ХАССП'],
  ['haccp_view', 'ХАССП — просмотр', 'ХАССП'],
  ['haccp', 'ХАССП: план, ККТ карт, решения по отклонениям и партиям, сроки п/ф', 'ХАССП'],
  ['haccp_approve', 'Утверждение плана ХАССП, отзыв подписи журнала', 'ХАССП'],
  ['sanitation', 'Дезсредства, санобработка, вода, вредители, отходы', 'ХАССП'],
  ['lab_view', 'Лаборатория, вода, вредители, дезсредства — просмотр', 'ХАССП'],
  ['lab', 'Лабораторный контроль', 'ХАССП'],
  ['medical_view', 'Медкнижки — просмотр и контроль допуска', 'Персонал'],
  ['medical', 'Медкнижки — изменение', 'Персонал'],
  ['personnel', 'Сотрудники — создание и изменение, назначение ролей', 'Персонал'],
  ['grants', 'Индивидуальные права — выдача и отзыв', 'Персонал'],
  ['reports', 'Отчёты', 'Отчёты'],
  ['audit_view', 'Журнал аудита — просмотр', 'Проверка'],
  ['audit_create', 'QR-доступ проверяющему, пакет проверки', 'Проверка'],
  ['audit_revoke', 'Отзыв доступа проверяющего', 'Проверка'],
  ['archive', 'Резервные копии — создание', 'Настройки'],
  ['system', 'Системные настройки, интеграции, миграция, восстановление (технический доступ)', 'Настройки']
];

var MC_RB_COOK_ = ['catalog', 'plan', 'kanban', 'batch_use', 'stock_view', 'receiving', 'invoices_view', 'documents_view', 'labels', 'journals', 'checklists'];
var MC_RB_MATRIX_ = {
  // Директор — по матрице раздела 3 ТЗ: производство, склад, журналы, ХАССП, лаборатория, санитария, ВСД — просмотр («П»);
  // банкеты, каталог и ТТК, закупки, приёмка, маркировка, бракераж, медкнижки, сотрудники, права — полностью; утверждение плана ХАССП
  'Директор': ['banquets_view', 'banquets', 'banquet_scan', 'catalog', 'ttk_edit', 'ttk_approve', 'ttk_history', 'costs', 'plan',
    'shop_all', 'stock_view', 'receiving', 'invoices_view', 'doc_correct', 'procurement', 'labels', 'documents_view', 'documents', 'vsd_view', 'brakerage',
    'haccp_view', 'haccp_approve', 'lab_view', 'medical_view', 'medical', 'personnel', 'grants', 'reports', 'audit_view',
    'audit_create', 'audit_revoke', 'archive'],
  'Администратор': ['banquets_view', 'banquets', 'banquet_scan'],
  'Шеф-повар': ['banquets_view', 'catalog', 'ttk_edit', 'ttk_approve', 'ttk_history', 'costs', 'plan', 'plan_edit', 'kanban', 'prod_manage', 'batch_use', 'hot_ccp',
    'shop_all', 'stock_view', 'stock', 'receiving', 'invoices_view', 'doc_correct', 'procurement', 'labels', 'documents_view', 'brakerage', 'journals', 'checklists', 'haccp_view',
    'reports', 'audit_view'],
  'Кондитер': ['catalog', 'ttk_history', 'plan', 'kanban', 'batch_use', 'shop_pastry', 'stock_view', 'labels', 'documents_view', 'journals', 'checklists'],
  'Повар холодного цеха': MC_RB_COOK_.concat(['shop_cold']),
  'Повар горячего цеха': MC_RB_COOK_.concat(['shop_hot', 'hot_ccp']),
  'Ответственный за ХАССП': ['catalog', 'ttk_history', 'shop_all', 'stock_view', 'invoices_view', 'documents_view', 'documents', 'mercury', 'vsd_cancel', 'brakerage',
    'journals', 'checklists', 'haccp_view', 'haccp', 'sanitation', 'lab', 'medical_view', 'reports', 'audit_view', 'audit_create', 'audit_revoke']
};
MC_RB_MATRIX_['Су-шеф'] = MC_RB_MATRIX_['Шеф-повар'].slice();
MC_RB_MATRIX_[MC_RB_LEGACY_COOK_] = MC_RB_COOK_.concat(['shop_hot', 'shop_cold', 'hot_ccp']);

/** Индивидуальные права: какое право какой роли Директор может выдать (замещение, «по необходимости», «по правам»). */
var MC_RB_GRANTABLE_ = {
  vsd_cancel: ['Директор', 'Шеф-повар', 'Су-шеф'],
  mercury: ['Директор', 'Шеф-повар', 'Су-шеф'],
  banquets: ['Шеф-повар', 'Су-шеф'],
  receiving: ['Кондитер'],
  invoices_view: ['Кондитер'],
  brakerage: ['Кондитер', 'Повар холодного цеха', 'Повар горячего цеха', MC_RB_LEGACY_COOK_],
  labels: ['Ответственный за ХАССП'],
  plan: ['Ответственный за ХАССП'],
  doc_edit: ['Директор']
};

/** Старые ключи, которые запрашивают функции изнутри (вторая линия), → новые ключи. Точная проверка — в шлюзе. */
var MC_RB_ALIAS_ = {
  stock: ['stock', 'stock_view', 'receiving', 'batch_use', 'documents', 'documents_view', 'mercury', 'vsd_cancel', 'invoices_view', 'procurement', 'labels'],
  kanban: ['kanban', 'prod_manage', 'plan', 'batch_use', 'labels'],
  journals: ['journals', 'checklists', 'brakerage', 'haccp', 'haccp_view', 'hot_ccp', 'lab', 'sanitation', 'documents', 'documents_view', 'audit_view', 'receiving'],
  catalog: ['catalog', 'ttk_edit', 'ttk_approve', 'banquets', 'banquets_view'],
  banquets: ['banquets', 'banquets_view', 'prod_manage'],
  plan: ['plan', 'plan_edit'],
  audit_create: ['audit_create', 'audit_view'],
  personnel: ['personnel', 'medical_view', 'medical', 'grants'],
  archive: ['archive', 'journals', 'audit_view', 'haccp_view'],
  checklists: ['checklists', 'sanitation'],
  sanitation: ['sanitation', 'checklists'],
  medical: ['medical', 'medical_view'],
  documents: ['documents', 'documents_view'],
  production: ['kanban', 'prod_manage'], manager: ['prod_manage', 'personnel'], events: ['banquets', 'banquets_view'], admin: ['system']
};

/** Цех роли: какие задания и ККТ видит повар. null — все цеха. */
var MC_RB_SHOPS_ = {
  'Повар холодного цеха': ['Холодный цех'],
  'Повар горячего цеха': ['Горячий цех'],
  'Кондитер': ['Кондитерский цех']
};
var MC_RB_HOT_CCP_RE_ = /терм|жар|варк|варен|запек|выпек|t° в толще|температур[аы] в толще|охлажд|разогрев|регенер|фритюр/i;   // ККТ горячего цеха
var MC_RB_SHARED_SHOPS_ = ['Полуфабрикаты', 'П/Ф', 'Без цеха', ''];   // общие задания поваров обоих цехов (не кондитера)

/** Кто ведёт какой журнал (ответственный из реестра журналов → новые роли). Повар горячего цеха — ККТ тепловой
 *  обработки, охлаждения, разогрева и фритюр; холодного — нет. «+право» — журнал доступен и по этому праву. */
var MC_RB_J_ = { D: 'Директор', S: 'Шеф-повар', SS: 'Су-шеф', K: 'Кондитер', PC: 'Повар холодного цеха', PH: 'Повар горячего цеха', X: 'Ответственный за ХАССП', P: MC_RB_LEGACY_COOK_, A: 'Администратор' };
var MC_RB_JOURNAL_ROLES_ = (function () {
  var all = 'S SS PC PH K X P', kit = 'S SS PC PH K X P';
  return {
    J01: kit, J25: kit, J04: kit, J05: kit, J29: kit, J37: kit, J09: kit, J10: kit, J11: kit, J12: kit, J13: kit,
    J02: 'S SS X D +brakerage', J03: 'S SS PC PH P D X +receiving', J21: 'S SS PC PH P D X +receiving',
    J22: 'PH K S SS P', J23: 'PH K S SS P', J24: 'PH S SS P', J38: 'PH S SS P', J06: 'S SS PH K P',
    J07: 'S SS X D', J08: 'S SS X D', J27: 'S SS X D', J14: 'X D', J28: 'X D', J15: 'X S SS', J26: 'X S SS',
    J16: 'D X S', J17: 'D X S', J18: all + ' D', J19: 'X S', J20: 'X S SS',
    J30: 'X D', J31: 'X D', J32: 'X D', J33: 'X D', J35: 'X D', J34: 'X S SS D', J36: 'D A S'
  };
})();

/** Разделы нового интерфейса → право (любое из перечисленных). '*' — всем вошедшим. */
var MC_RB_SECTIONS_ = {
  home: '*', banquets: 'banquets_view', menu: 'catalog', planning: 'plan', production: 'kanban|plan|prod_manage', stock: 'stock_view',
  revisions: 'stock', deficits: 'plan_edit|procurement', surplus: 'plan_edit|stock', procurement: 'procurement', issue: 'prod_manage',
  haccp: 'haccp_view', sanitation: 'sanitation|checklists|lab_view', personnel: 'personnel|medical_view', lab: 'lab|lab_view', equipment: 'haccp_view',
  documents: 'documents_view|mercury|vsd_view', reports: 'reports', inspection: 'audit_create|audit_view|haccp_view', settings: 'system|grants|archive',
  picking: 'kanban|prod_manage'
};
/** Страницы (параметр адреса) → право. */
var MC_RB_MODULES_ = { haccptasks: 'haccp_view|journals', weekly: 'plan', procurement: 'procurement|receiving', journals: 'journals|haccp_view|audit_view', haccptoday: 'journals|haccp_view|audit_view', staff: 'personnel|medical_view|grants', labs: 'lab|lab_view', inspectors: 'audit_create',
  docs: 'documents_view|haccp_view', orders: 'procurement', processing: 'batch_use|haccp', batch: 'stock_view|receiving|haccp_view', income: 'receiving',
  supplydocs: 'documents_view|mercury|invoices_view|vsd_view', temperatures: 'journals|haccp_view', corrections: 'journals|haccp', allergens: 'catalog|haccp_view',
  suppliers: 'procurement|documents', environment: 'sanitation|lab_view', backup: 'archive', samples: 'journals|haccp_view', equipment: 'haccp_view|journals',
  batchcontrol: 'receiving|haccp_view|stock_view', picking: 'kanban|prod_manage', scheduler: 'system', fulfillment: 'prod_manage|banquets_view',
  closure: 'prod_manage', execution: 'kanban|plan', ttkmaster: 'ttk_edit|haccp', ttkppk: 'haccp', disinfectants: 'sanitation|lab_view|haccp', sanitationauto: 'checklists|sanitation',
  productiontasks: 'kanban|prod_manage', dispatcher: 'plan', revision: 'stock',
  deficitbridge: 'plan_edit|procurement', ttkrecalc: 'plan_edit', productunits: 'ttk_approve|stock', productionrelease: 'prod_manage', normative: 'haccp_view', ppkbuilder: 'haccp|haccp_approve|haccp_view', compliance: 'haccp_view',
  grants: 'grants', ttkhistory: 'ttk_history',
  // бывшие возможности старого интерфейса и страницы «Смена» — экраны главного окна
  myshift: 'kanban|journals|checklists', kanban: 'kanban|plan|prod_manage', printqueue: 'labels', checklists: 'haccp|prod_manage|sanitation', minstock: 'stock',
  nutrition: 'catalog|ttk_edit', wastenorms: 'stock|haccp|batch_use', lamps: 'journals|haccp_view', journaltriggers: 'journals|haccp_view|haccp', prices: 'costs', brakerage: 'brakerage', haccpevents: 'haccp|haccp_view',
  // после «полной инструкции»: списание по акту (питание персонала и др.), приход полуфабрикатов
  writeoff: 'stock|costs', pfincome: 'kanban|prod_manage|stock',
  // возвращено из прежнего интерфейса: выполнение чек-листов, журнал склада, задачи, этикетка вручную, контур ХАССП, журнал продаж
  checklistrun: 'checklists|sanitation|haccp_view', stockops: 'stock|stock_view|costs', tasks: 'kanban|plan|prod_manage', labels: 'labels', haccpcontour: 'journals|haccp_view|audit_view', sales: 'banquets|journals'
};
/** Кнопки разделов, которые вызывают функцию экрана (Console.html), → право. Нет в списке — кнопка видна всем, кто видит раздел. */
var MC_RB_UI_FN_ = { banqNew: 'banquets', banqScanPick: 'banquet_scan', dishNew: 'ttk_edit', dpOpen: 'ttk_edit', syncTtk: 'ttk_edit', ttkFixDoubled: 'ttk_approve', mcTtkIds: 'ttk_approve',
  openMed: 'medical', openMedSec: 'haccp_view', mcProtect: 'system', mcMigrate: 'system', inspRerun: 'audit_create|audit_view|haccp_view', inspPackage: 'audit_create', auditVerify: 'audit_view', rbMigrate: 'system', rbDevPin: 'system' };
/** Названия страниц и разделов — для сообщения «Нет доступа». */
var MC_RB_MODULE_RU_ = { haccptoday: 'ХАССП — сегодня', income: 'Приёмка товара', supplydocs: 'Документы на сырьё и ВСД', staff: 'Сотрудники', backup: 'Резервные копии', processing: 'Обработка сырья',
  batch: 'Партия', orders: 'Заказы поставщикам', scheduler: 'Планировщик производства', ttkmaster: 'Мастер ТТК', revision: 'Ревизия', weekly: 'Диспетчер недели',
  fulfillment: 'Выдача банкета', closure: 'Закрытие банкета', ppkbuilder: 'Конструктор ППК', compliance: 'ХАССП: процессы и ККТ', normative: 'Нормативы', grants: 'Права сотрудников', ttkhistory: 'История ТТК',
  myshift: 'Моя смена', kanban: 'Задания кухни', printqueue: 'Очередь печати этикеток', checklists: 'Шаблоны чек-листов', minstock: 'Норма запаса', nutrition: 'КБЖУ продуктов',
  wastenorms: 'Нормы отходов', lamps: 'Бактерицидные лампы', journaltriggers: 'Вопросы журналов', prices: 'Изменения закупочных цен', brakerage: 'Бракераж', haccpevents: 'События → контроли ХАССП', writeoff: 'Списание по акту', pfincome: 'Приход полуфабрикатов', checklistrun: 'Чек-листы: выполнить', stockops: 'Журнал склада', tasks: 'Задачи', labels: 'Этикетка вручную', haccpcontour: 'Контур ХАССП за 7 дней', sales: 'Журнал продаж', disinfectants: 'Дезсредства' };

/** Уведомления, адресованные прежним ролям, → кто получает теперь. */
var MC_RB_TARGETS_ = {
  'Шеф-повар': ['Шеф-повар', 'Су-шеф'], 'Повар': ['Повар холодного цеха', 'Повар горячего цеха', MC_RB_LEGACY_COOK_],
  'Кладовщик': ['Шеф-повар', 'Су-шеф'], 'Закупщик': ['Директор', 'Шеф-повар', 'Су-шеф'], 'Санитарный работник': ['Ответственный за ХАССП'],
  'Медработник': ['Ответственный за ХАССП', 'Директор'], 'Бракеражная комиссия': ['Шеф-повар', 'Су-шеф'], 'Руководитель': ['Директор'],
  'Администратор': ['Директор'], 'Аудитор': []
};
/** Уведомление какого типа требует какое право (кроме адресата). */
var MC_RB_NOTIFY_PERM_ = { vsd_unpaid: 'mercury|vsd_cancel|vsd_view', vsd_overdue: 'mercury|vsd_cancel|vsd_view|personnel', vsd_missing: 'mercury|vsd_cancel|vsd_view|personnel' };
/** Уведомления, которые вручную не закрываются (закрывает система по событию). */
var MC_RB_STICKY_ = ['vsd_unpaid', 'vsd_missing'];

/* ------------------------------------------------------------------ роли ---- */
function _mcRbNormRole_(role) {
  var r = String(role || '').replace(/\s+/g, ' ').trim();
  return MC_RB_LEGACY_[r] || r;
}
function _mcRbRoleKnown_(role) { var r = _mcRbNormRole_(role); return MC_RB_ROLES_.indexOf(r) >= 0 || r === MC_RB_LEGACY_COOK_; }
function _mcRbRoleNote_(role) {
  var r = _mcRbNormRole_(role);
  if (!r) return 'Роль не назначена — обратитесь к директору. До назначения разделы недоступны.';
  if (r === MC_RB_LEGACY_COOK_) return 'Цех не указан: директор должен выбрать «Повар холодного цеха» или «Повар горячего цеха».';
  if (MC_RB_RETIRED_.indexOf(r) >= 0) return 'Роль «' + r + '» больше не используется — директор назначит новую роль. До назначения разделы недоступны.';
  if (MC_RB_ROLES_.indexOf(r) < 0) return 'Роль «' + r + '» неизвестна системе — обратитесь к директору.';
  return '';
}
/** Права роли без индивидуальных (объект ключ → true). */
function _mcRbRolePerms_(role) {
  var r = _mcRbNormRole_(role), list = MC_RB_MATRIX_[r] || [], p = {};
  MC_RB_PERMS_.forEach(function (x) { p[x[0]] = list.indexOf(x[0]) >= 0; });
  return p;
}
function _mcRbAllPerms_() { var p = { all: true }; MC_RB_PERMS_.forEach(function (x) { p[x[0]] = true; }); return p; }

/* ------------------------------------------------------------------ сотрудники (кэш состояния) ---- */
var _MC_RB_EMP_ = null, _MC_RB_GR_ = null;
function _mcRbIsCreatorRow_(row) {
  if (String(row[3] || '').trim() === MC_RB_CREATOR_POS_) return true;
  try { return String(row[8] || '').trim() === _hashPin_(MC_RB_DEV_PIN_DEFAULT_); } catch (e) { return false; }
}
function _mcRbEmpState_() {
  if (_MC_RB_EMP_) return _MC_RB_EMP_;
  var cc = null; try { cc = CacheService.getScriptCache(); var hit = cc.get('mc_rb_emp'); if (hit) return (_MC_RB_EMP_ = JSON.parse(hit)); } catch (e) {}
  var out = {};
  try {
    var v = _authEmployeesSheet_().getDataRange().getValues();
    for (var i = 1; i < v.length; i++) {
      if (!v[i][0] && !v[i][1]) continue;
      out['EMP' + ('00' + i).slice(-3)] = { role: _mcRbNormRole_(v[i][4]), rawRole: String(v[i][4] || ''), active: v[i][12] !== false,
        name: [v[i][0], v[i][1], v[i][2]].filter(Boolean).join(' '), position: String(v[i][3] || ''), hidden: _mcRbIsCreatorRow_(v[i]) };
    }
  } catch (e) {}
  try { if (cc) cc.put('mc_rb_emp', JSON.stringify(out), 60); } catch (e) {}
  return (_MC_RB_EMP_ = out);
}
/** Сбросить кэш (после изменения сотрудника или права) — сессии подхватят новое состояние при следующем вызове. */
function _mcRbDrop_() { _MC_RB_EMP_ = null; _MC_RB_GR_ = null; try { CacheService.getScriptCache().removeAll(['mc_rb_emp', 'mc_rb_grants']); } catch (e) {} }

/* ------------------------------------------------------------------ индивидуальные права ---- */
var MC_RB_GR_SHEET_ = 'Права_Индивидуальные';
var MC_RB_GR_HEAD_ = ['GrantID', 'EmployeeID', 'Сотрудник', 'Роль', 'Право', 'Что даёт', 'Выдал', 'Выдано', 'Причина', 'Действует до', 'Статус', 'Отозвал', 'Отозвано', 'Причина отзыва', 'OperationID'];
function _mcRbGrSheet_() {
  var ss = _book_(), sh = ss.getSheetByName(MC_RB_GR_SHEET_);
  if (!sh) { sh = ss.insertSheet(MC_RB_GR_SHEET_); sh.appendRow(MC_RB_GR_HEAD_); sh.setFrozenRows(1); sh.getRange(1, 1, 1, MC_RB_GR_HEAD_.length).setBackground('#6e1423').setFontColor('#ffffff').setFontWeight('bold'); }
  return sh;
}
function _mcRbGrants_() {
  if (_MC_RB_GR_) return _MC_RB_GR_;
  var cc = null; try { cc = CacheService.getScriptCache(); var hit = cc.get('mc_rb_grants'); if (hit) return (_MC_RB_GR_ = JSON.parse(hit)); } catch (e) {}
  var out = [];
  try {
    var ss = _book_(), sh = ss.getSheetByName(MC_RB_GR_SHEET_);
    var ts = function (x) { if (x && typeof x.getTime === 'function') return x.getTime() || 0; if (!x) return 0; var d = new Date(x); return isNaN(d.getTime()) ? 0 : d.getTime(); };   // дата, введённая в таблицу вручную, — тоже дата
    if (sh) { var v = sh.getDataRange().getValues(); for (var i = 1; i < v.length; i++) if (v[i][0]) out.push({ id: String(v[i][0]), emp: String(v[i][1]), name: String(v[i][2]), role: String(v[i][3]),
      perm: String(v[i][4]), by: String(v[i][6]), at: ts(v[i][7]), reason: String(v[i][8] || ''), until: ts(v[i][9]),
      status: String(v[i][10] || ''), revokedBy: String(v[i][11] || ''), revokedAt: ts(v[i][12]), row: i + 1 }); }
  } catch (e) {}
  try { if (cc) cc.put('mc_rb_grants', JSON.stringify(out), 60); } catch (e) {}
  return (_MC_RB_GR_ = out);
}
function _mcRbGrantActive_(g, role, now) {
  return g.status === 'ACTIVE' && (!g.until || g.until >= now) && (MC_RB_GRANTABLE_[g.perm] || []).indexOf(_mcRbNormRole_(role)) >= 0;
}
/** Действующие права сотрудника: роль + действующие индивидуальные права (только допустимые для его роли). */
function _mcRbEffective_(role, empId) {
  var p = _mcRbRolePerms_(role), now = Date.now(), gl = [];
  _mcRbGrants_().forEach(function (g) { if (g.emp === String(empId) && _mcRbGrantActive_(g, role, now)) { p[g.perm] = true; gl.push(g.perm); } });
  p.__grants = gl;
  return p;
}

/* ------------------------------------------------------------------ сессия ---- */
/** Обновить сессию по текущей роли сотрудника. Уволенный/отключённый — сессия недействительна. */
function _mcRbRefresh_(s) {
  if (!s || s.dev || s.portal) return s;
  var st = _mcRbEmpState_()[String(s.user_id || '')];
  if (!st) return s;                                   // строка не найдена (стенд без листа) — права по роли из сессии
  if (st.active === false) { s.revoked = true; return s; }
  s.role = st.role; s.name = st.name || s.name; s.position = st.position || s.position;
  s.permissions = _mcRbEffective_(st.role, s.user_id);
  return s;
}
/** Есть ли у сессии право (spec — ключ или «a|b»; '*' — любой вошедший; учитываются старые ключи). */
function _mcRbHas_(s, spec) {
  if (!s) return false;
  if (s.dev === true) return true;
  if (!spec || spec === '*') return true;
  var p = s.permissions || {};
  if (p.all === true && s.dev === true) return true;
  return String(spec).split('|').some(function (k) {
    k = k.trim(); if (!k) return false;
    if (p[k] === true) return true;
    return (MC_RB_ALIAS_[k] || []).some(function (a) { return p[a] === true; });
  });
}
/** Строгая проверка (без старых ключей) — для шлюза, разделов и страниц. */
function _mcRbHasExact_(s, spec) {
  if (!s) return false;
  if (s.dev === true) return true;
  if (!spec || spec === '*') return true;
  var p = s.permissions || {};
  return String(spec).split('|').some(function (k) { return p[k.trim()] === true; });
}
function _mcRbShopOf_(s) {
  if (!s || s.dev) return null;
  var p = s.permissions || {};
  if (p.shop_all) return null;
  var out = [];
  if (p.shop_hot) out.push('Горячий цех'); if (p.shop_cold) out.push('Холодный цех'); if (p.shop_pastry) out.push('Кондитерский цех');
  if (p.shop_hot || p.shop_cold) out = out.concat(MC_RB_SHARED_SHOPS_);
  return out.length ? out : null;
}
/** Видит ли сотрудник задание/блюдо этого цеха. */
function _mcRbShopAllowed_(s, shop) {
  var allowed = _mcRbShopOf_(s); if (!allowed) return true;
  var w = String(shop || '').trim();
  return allowed.indexOf(w) >= 0 || (allowed.indexOf('') >= 0 && !w);
}
/** Может ли роль вести журнал. */
function _mcRbJournalAllowed_(s, journalId) {
  if (!s) return false;
  if (s.dev) return false;                              // технический доступ записи ХАССП не делает
  var spec = MC_RB_JOURNAL_ROLES_[String(journalId || '').toUpperCase()];
  if (!spec) return _mcRbHasExact_(s, 'journals');
  var role = _mcRbNormRole_(s.role), p = s.permissions || {}, ok = false;
  spec.split(/\s+/).forEach(function (t) { if (!t) return; if (t.charAt(0) === '+') { if (p[t.slice(1)] === true) ok = true; } else if (MC_RB_J_[t] === role) ok = true; });
  return ok;
}
function _mcRbJournalRoles_(journalId) {
  var spec = MC_RB_JOURNAL_ROLES_[String(journalId || '').toUpperCase()]; if (!spec) return [];
  return spec.split(/\s+/).filter(function (t) { return t && t.charAt(0) !== '+'; }).map(function (t) { return MC_RB_J_[t]; }).filter(Boolean);
}
/** Получит ли роль уведомление, адресованное targetRole. */
function _mcRbTargetMatches_(target, s) {
  if (!s) return false;
  if (s.dev) return true;
  var t = String(target || '').trim(), role = _mcRbNormRole_(s.role);
  if (!t || t === 'Все') return true;
  if (role === 'Директор') return true;                 // директор контролирует работу подразделений
  if (t === role) return true;
  return (MC_RB_TARGETS_[t] || []).indexOf(role) >= 0;
}

/* ------------------------------------------------------------------ отказ (403) и аудит ---- */
function _mcRbDenyJson_(message, code) {
  return JSON.stringify({ ok: false, success: false, error: { code: code || 'FORBIDDEN', http: 403, message: '403 — недостаточно прав. ' + message } });
}
/** Запись отказа в аудит (попытка запрещённого действия). */
function _mcRbAuditDenied_(s, what, need, objectId) {
  try {
    var op = { id: '', type: 'ACCESS_DENIED', tenant: _defaultTenant_(), session: s || null };
    _audit_(op, 'ACCESS_DENIED', 'Доступ', String(objectId || what || ''), null, { function: what, need: need || '', role: s ? (s.dev ? MC_RB_TECH_ : s.role) : '' }, 'ОТКАЗ');
  } catch (e) {}
}

/* ------------------------------------------------------------------ технический доступ и вход ---- */
var MC_RB_DEV_PIN_DEFAULT_ = '2258';
var MC_RB_DEV_PROP_ = 'MC_DEV_PIN_HASH';
function _mcRbDevHash_() { var h = ''; try { h = String(PropertiesService.getScriptProperties().getProperty(MC_RB_DEV_PROP_) || ''); } catch (e) {} return h || _hashPin_(MC_RB_DEV_PIN_DEFAULT_); }
function _mcRbIsDevPin_(pin) { try { return _hashPin_(String(pin)) === _mcRbDevHash_(); } catch (e) { return false; } }
/** Счётчики неудачных попыток: устройство (5 → 15 мин), технический вход (нарастающая блокировка), вся система (30 за 15 мин). */
var MC_RB_LOCK_ = { device: 5, deviceMin: 15, tech: 5, techMin: [15, 60, 1440], global: 30, globalMin: 15 };
function _mcRbCache_() { return CacheService.getScriptCache(); }
function _mcRbGet_(k, d) { try { var v = _mcRbCache_().get(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function _mcRbPut_(k, o, sec) { try { _mcRbCache_().put(k, JSON.stringify(o), Math.max(60, Math.min(21600, sec))); } catch (e) {} }
function _mcRbDevKey_(deviceId) { return 'mc_pin_dev_' + String(deviceId || 'unknown').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40); }
function _mcRbLoginLocked_(deviceId) {
  var now = Date.now(), d = _mcRbGet_(_mcRbDevKey_(deviceId), {}), g = _mcRbGet_('mc_pin_global', {});
  if (d.lockedUntil && d.lockedUntil > now) return { by: 'device', left: Math.ceil((d.lockedUntil - now) / 60000) };
  if (g.lockedUntil && g.lockedUntil > now) return { by: 'global', left: Math.ceil((g.lockedUntil - now) / 60000) };
  return null;
}
function _mcRbTechLocked_() { var t = _mcRbGet_('mc_pin_tech', {}); return !!(t.lockedUntil && t.lockedUntil > Date.now()); }
function _mcRbLoginFailed_(deviceId) {
  var now = Date.now(), L = MC_RB_LOCK_, dk = _mcRbDevKey_(deviceId);
  var d = _mcRbGet_(dk, { count: 0 }); d.count = (d.count || 0) + 1; if (d.count >= L.device) { d.lockedUntil = now + L.deviceMin * 60000; d.count = 0; } _mcRbPut_(dk, d, L.deviceMin * 60);
  var g = _mcRbGet_('mc_pin_global', { list: [] }); g.list = (g.list || []).filter(function (t) { return t > now - L.globalMin * 60000; }); g.list.push(now);
  if (g.list.length >= L.global) { g.lockedUntil = now + L.globalMin * 60000; g.list = []; try { _mcRbAlertOwner_('Вход в MON CHEF заблокирован на ' + L.globalMin + ' мин', L.global + ' неверных ПИН за ' + L.globalMin + ' минут — возможен подбор. Время: ' + new Date()); } catch (e) {} }
  _mcRbPut_('mc_pin_global', g, L.globalMin * 60);
  // любой неверный ПИН мог быть попыткой подобрать технический код — счётчик технического входа
  var t = _mcRbGet_('mc_pin_tech', { count: 0, level: 0 }); if (t.lastFail && now - t.lastFail > 86400000) { t.level = 0; } t.lastFail = now; t.count = (t.count || 0) + 1;
  if (t.count >= L.tech) { t.lockedUntil = now + L.techMin[Math.min(t.level || 0, L.techMin.length - 1)] * 60000; t.level = (t.level || 0) + 1; t.count = 0; }
  _mcRbPut_('mc_pin_tech', t, 21600);
  return { device: d, global: g };
}
function _mcRbLoginOk_(deviceId) { try { _mcRbCache_().remove(_mcRbDevKey_(deviceId)); } catch (e) {} }
function _mcRbAlertOwner_(subject, body) {
  var to = ''; try { to = String(PropertiesService.getScriptProperties().getProperty('MC_NOTIFY_EMAIL') || '') || Session.getEffectiveUser().getEmail(); } catch (e) {}
  if (to) try { MailApp.sendEmail(to, 'MON CHEF: ' + subject, body); } catch (e) {}
}
/** Сессия технического доступа. */
function _mcRbTechSession_() {
  var token = Utilities.getUuid().replace(/-/g, '');
  var payload = { token: token, user_id: 'TECH', name: MC_RB_TECH_, position: '', role: '', dev: true, permissions: _mcRbAllPerms_(),
    created_at: Date.now(), expires_at: Date.now() + CORE.SESSION_TTL_MIN * 60 * 1000 };
  try { CacheService.getScriptCache().put(_sessionKey_(token), JSON.stringify(payload), CORE.SESSION_TTL_MIN * 60); } catch (e) {}
  return payload;
}
/** Сменить код технического доступа (только технический доступ). Хранится только хеш. */
function mcRbSetDevPin(json, token) {
  try {
    var s = _requireAuth_(token); if (!s.dev) return _mcRbDenyJson_('Код технического доступа меняет только технический доступ.');
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), p = String(d.pin || '');
    if (!/^\d{4,6}$/.test(p)) return _fail_('VALIDATION', 'Код — 4–6 цифр (столько принимает экран входа)');
    var clash = false; try { var v = _authEmployeesSheet_().getDataRange().getValues(), h = _hashPin_(p); for (var i = 1; i < v.length; i++) if (String(v[i][8]).trim() === h && !_mcRbIsCreatorRow_(v[i])) clash = true; } catch (e) {}
    if (clash) return _fail_('VALIDATION', 'Такой ПИН уже у сотрудника');
    PropertiesService.getScriptProperties().setProperty(MC_RB_DEV_PROP_, _hashPin_(p));
    _audit_({ id: '', type: 'TECH', tenant: _defaultTenant_(), session: s }, 'TECH_PIN_CHANGED', 'Технический доступ', '', null, { changed: true }, 'УСПЕХ');
    return _ok_({ changed: true });
  } catch (e) { return _failFrom_(e); }
}

/* ------------------------------------------------------------------ сведения для интерфейса ---- */
/** Что доступно вошедшему: роль (для шапки), права, разделы, страницы, цех. */
function _mcRbAccess_(s) {
  var p = s.permissions || {}, sec = [], mod = {};
  Object.keys(MC_RB_SECTIONS_).forEach(function (k) { if (_mcRbHasExact_(s, MC_RB_SECTIONS_[k])) sec.push(k); });
  Object.keys(MC_RB_MODULES_).forEach(function (k) { if (_mcRbHasExact_(s, MC_RB_MODULES_[k])) mod[k] = true; });
  var perms = {}; MC_RB_PERMS_.forEach(function (x) { if (s.dev || p[x[0]] === true) perms[x[0]] = true; });
  var idle = 15; try { idle = Math.max(3, Math.min(240, parseInt(PropertiesService.getScriptProperties().getProperty('MC_IDLE_MIN') || '15', 10) || 15)); } catch (e) {}
  return { name: s.dev ? '' : (s.name || ''), role: s.dev ? '' : _mcRbNormRole_(s.role), dev: !!s.dev, perms: perms, grants: p.__grants || [], sections: sec, modules: mod,
    shop: _mcRbShopOf_(s), note: s.dev ? '' : _mcRbRoleNote_(s.role), idleMin: idle };
}
/** Можно ли открыть раздел нового интерфейса. */
function _mcRbSectionAllowed_(s, section) { return _mcRbHasExact_(s, MC_RB_SECTIONS_[section] || 'system'); }
/** Можно ли открыть страницу (параметр адреса). Возвращает ключ страницы или '' если страница не из карты. */
function _mcRbModuleOf_(params) {
  var keys = Object.keys(MC_RB_MODULES_);
  for (var i = 0; i < keys.length; i++) { var k = keys[i], v = params[k]; if (v === '1' || (k === 'batch' && v)) return k; }
  return '';
}
/** Страница «Нет доступа» (403). */
function _mcRbNoAccessPage_(module, s) {
  var name = MC_RB_MODULE_RU_[module] || module, home = ''; try { home = ScriptApp.getService().getUrl(); } catch (e) {}
  var esc = function (x) { return String(x || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MON CHEF — нет доступа</title>' +
    '<style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f2ef;color:#2b1a1d;display:flex;min-height:100vh;align-items:center;justify-content:center}' +
    '.b{background:#fff;border:1px solid #e6dcd6;border-radius:14px;padding:28px 26px;max-width:440px;margin:16px}.c{font-size:13px;color:#8a6d73;letter-spacing:.08em}h1{font-size:22px;margin:8px 0 10px}' +
    'p{line-height:1.5;color:#5a474b}a{display:inline-block;margin-top:14px;background:#6e1423;color:#fff;text-decoration:none;padding:10px 16px;border-radius:10px}</style></head><body><div class="b">' +
    '<div class="c">403 — НЕДОСТАТОЧНО ПРАВ</div><h1>Нет доступа к разделу</h1><p>«' + esc(name) + '» недоступен' + (s && s.role ? ' для роли «' + esc(_mcRbNormRole_(s.role)) + '»' : '') +
    '. Если доступ нужен для работы, обратитесь к директору.</p><a href="' + esc(home) + '" target="_top">На главную</a></div></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('MON CHEF — нет доступа').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ------------------------------------------------------------------ экран «Права сотрудников» (Директор) ---- */
function mcGetAccessAdmin(token) {
  try {
    var s = _requireAuth_(token); if (!_mcRbHasExact_(s, 'grants|personnel')) return _mcRbDenyJson_('Права сотрудников видит директор.');
    var st = _mcRbEmpState_(), gr = _mcRbGrants_(), now = Date.now(), emps = [];
    Object.keys(st).forEach(function (id) {
      var e = st[id]; if (e.hidden) return;
      var role = e.role, mine = gr.filter(function (g) { return g.emp === id; }).map(function (g) {
        var active = _mcRbGrantActive_(g, role, now);
        return { id: g.id, perm: g.perm, what: _mcRbPermRu_(g.perm), by: g.by, at: g.at ? _mcRbFmt_(new Date(g.at)) : '', reason: g.reason, until: g.until ? _mcRbFmt_(new Date(g.until)) : '',
          status: g.status === 'REVOKED' ? 'Отозвано' : g.until && g.until < now ? 'Истекло' : active ? 'Действует' : 'Не действует для роли' };
      });
      emps.push({ id: id, name: e.name, role: role, rawRole: e.rawRole, active: e.active, note: _mcRbRoleNote_(role), shop: (MC_RB_SHOPS_[role] || []).join(', '),
        grantable: Object.keys(MC_RB_GRANTABLE_).filter(function (k) { return MC_RB_GRANTABLE_[k].indexOf(role) >= 0; }).map(function (k) { return { perm: k, what: _mcRbPermRu_(k) }; }), grants: mine });
    });
    return _ok_({ employees: emps, roles: MC_RB_ROLES_.filter(function (r) { return s.dev || r !== 'Директор'; }), matrix: _mcRbMatrixRu_(), canGrant: _mcRbHasExact_(s, 'grants'), me: String(s.user_id || '') });
  } catch (e) { return _failFrom_(e); }
}
function _mcRbFmt_(d) { try { return Utilities.formatDate(d, _mcTz_(), 'dd.MM.yyyy HH:mm'); } catch (e) { return String(d); } }
function _mcRbPermRu_(k) { for (var i = 0; i < MC_RB_PERMS_.length; i++) if (MC_RB_PERMS_[i][0] === k) return MC_RB_PERMS_[i][1]; return k; }
function _mcRbMatrixRu_() {
  return MC_RB_PERMS_.filter(function (x) { return x[0] !== 'system'; }).map(function (x) {
    var row = { key: x[0], what: x[1], group: x[2] };
    MC_RB_ROLES_.forEach(function (r) { row[r] = (MC_RB_MATRIX_[r] || []).indexOf(x[0]) >= 0 ? 'да' : (MC_RB_GRANTABLE_[x[0]] || []).indexOf(r) >= 0 ? 'инд.' : ''; });
    return row;
  });
}
/** Выдать индивидуальное право. json: {employeeId, perm, reason, until:'ГГГГ-ММ-ДД'} */
function mcGrantPermission(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'grants', 'GRANT', 'Индивидуальное право', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var s = op.session, d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), id = String(d.employeeId || ''), perm = String(d.perm || ''), reason = String(d.reason || '').trim();
    var st = _mcRbEmpState_()[id];
    if (!st || st.hidden) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Сотрудник не найден', op.id); }
    if (id === String(s.user_id)) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', 'Себе права не выдаются', op.id); }
    if ((MC_RB_GRANTABLE_[perm] || []).indexOf(st.role) < 0) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Право «' + _mcRbPermRu_(perm) + '» нельзя выдать роли «' + (st.role || 'без роли') + '»', op.id); }
    if (!reason) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите причину (например, «замещение на время отпуска»)', op.id); }
    var until = null; if (d.until) { until = new Date(String(d.until) + 'T23:59:59'); if (isNaN(until.getTime()) || until.getTime() < Date.now()) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Срок окончания — дата в будущем', op.id); } }
    var dup = _mcRbGrants_().filter(function (g) { return g.emp === id && g.perm === perm && _mcRbGrantActive_(g, st.role, Date.now()); })[0];
    if (dup) { _endOp_(op, 'FAILED'); return _fail_('DUPLICATE', 'Это право уже выдано (' + dup.id + ')', op.id); }
    var who = _author_(op), gid = 'GR-' + Utilities.getUuid().slice(0, 8), now = new Date();
    _withLock_(function () { _mcRbGrSheet_().appendRow([gid, id, st.name, st.role, perm, _mcRbPermRu_(perm), who.фио, now, reason, until || '', 'ACTIVE', '', '', '', op.id]); });
    _mcRbDrop_();
    _audit_(op, 'GRANT', 'Индивидуальное право', gid, null, { employee: st.name, role: st.role, perm: perm, reason: reason, until: until ? _mcRbFmt_(until) : '' });
    _endOp_(op);
    return _ok_({ grantId: gid }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Отозвать индивидуальное право. json: {grantId, reason} */
function mcRevokeGrant(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'grants', 'GRANT_REVOKE', 'Индивидуальное право', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), g = _mcRbGrants_().filter(function (x) { return x.id === String(d.grantId || ''); })[0];
    if (!g) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Право не найдено', op.id); }
    if (g.status === 'REVOKED') { _endOp_(op, 'FAILED'); return _fail_('BATCH_STATE', 'Уже отозвано', op.id); }
    var who = _author_(op), sh = _mcRbGrSheet_();
    _withLock_(function () { sh.getRange(g.row, 11, 1, 4).setValues([['REVOKED', who.фио, new Date(), String(d.reason || '')]]); });
    _mcRbDrop_();
    _audit_(op, 'GRANT_REVOKE', 'Индивидуальное право', g.id, { status: g.status }, { status: 'REVOKED', employee: g.name, perm: g.perm, reason: String(d.reason || '') });
    _endOp_(op);
    return _ok_({ grantId: g.id }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Проверка назначения роли: Директора назначает только технический доступ; свою роль менять нельзя. */
function _mcRbCheckRoleChange_(s, targetId, oldRole, newRole) {
  var nr = _mcRbNormRole_(newRole), or = _mcRbNormRole_(oldRole);
  if (nr === or) return '';
  if (!s || !s.dev) {
    if (targetId && String(targetId) === String(s && s.user_id)) return 'Свою роль изменить нельзя';
    if (nr === 'Директор' || or === 'Директор') return 'Роль «Директор» назначает и снимает только технический доступ';
  }
  if (MC_RB_ROLES_.indexOf(nr) < 0) return 'Роль «' + (newRole || '') + '» не из списка ролей: ' + MC_RB_ROLES_.join(', ');
  return '';
}

/* ------------------------------------------------------------------ перенос ролей (миграция) ---- */
/** Переименовать «Руководитель» → «Директор», убрать лишние пробелы; показать, кому директор должен назначить роль. */
function mcRbMigrateRoles(token) {
  var op = null;
  try { op = _beginOp_(token, 'system', 'ROLES_MIGRATION', 'Сотрудники', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var sh = _authEmployeesSheet_(), v = sh.getDataRange().getValues(), changed = [], todo = [];
    _withLock_(function () {
      for (var i = 1; i < v.length; i++) {
        if (!v[i][0] && !v[i][1]) continue; if (_mcRbIsCreatorRow_(v[i])) continue;
        var raw = String(v[i][4] || ''), norm = _mcRbNormRole_(raw), name = [v[i][0], v[i][1], v[i][2]].filter(Boolean).join(' ');
        if (norm !== raw && norm) { sh.getRange(i + 1, 5).setValue(norm); changed.push({ name: name, from: raw, to: norm }); }
        var note = _mcRbRoleNote_(norm); if (note) todo.push({ name: name, role: norm || '(нет)', note: note });
      }
    });
    _mcRbDrop_();
    _audit_(op, 'ROLES_MIGRATION', 'Сотрудники', '', null, { changed: changed, todo: todo });
    _endOp_(op);
    return _ok_({ changed: changed, todo: todo }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
