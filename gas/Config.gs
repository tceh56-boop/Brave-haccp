// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Config.gs
 * Единая точка правды для имён листов, префиксов ID и списка ролей.
 * Ничего в этом файле не должно дублироваться в других модулях —
 * все обращения к листам идут через CONFIG.SHEETS, а не через строковые литералы.
 *
 * v2 (аудит + доработка): добавлены ЦЕХА/оборудование/полное ХАССП (определения
 * лимитов/отклонения/корректирующие действия)/настройки уведомлений и их журнал/
 * план-меню (банкетный модуль) — см. TSEKH_v2_CHANGELOG.md за полным списком
 * найденных при аудите ошибок и того, что именно исправлено в каждом файле.
 */

var CONFIG = {

  SPREADSHEET_ID: '',

  // Базовое расписание заведения. Точки могут переопределить его в SETTINGS.
  JOURNAL_SCHEDULER: { OPEN: '10:00', CLOSE: '22:00', SLOTS_PER_SHIFT: 4, REMINDER_BEFORE_MINUTES: 10 },

  SHEETS: {
    ORGANIZATIONS: 'ORGANIZATIONS',
    LOCATIONS: 'LOCATIONS',
    USERS: 'USERS',
    ROLES: 'ROLES',
    SETTINGS: 'SETTINGS',
    SYSTEM_LOG: 'SYSTEM_LOG',

    PRODUCTS: 'PRODUCTS',
    PRICE_HISTORY: 'PRICE_HISTORY',
    UNITS: 'UNITS',
    CATEGORIES: 'CATEGORIES',
    SUPPLIERS: 'SUPPLIERS',
    DISHES: 'DISHES',
    SEMI_FINISHED: 'SEMI_FINISHED',
    PRODUCT_MATRIX: 'PRODUCT_MATRIX',

    RECIPES: 'RECIPES',
    TECH_CARDS: 'TECH_CARDS',
    TTK_VERSIONS: 'TTK_VERSIONS',
    TTK_HACCP_LINKS: 'TTK_HACCP_LINKS',
    TTK_SANPIN_LINKS: 'TTK_SANPIN_LINKS',
    BREAKDOWN_PLANS: 'BREAKDOWN_PLANS',
    BREAKDOWN_PLAN_OUTPUTS: 'BREAKDOWN_PLAN_OUTPUTS',
    BREAKDOWN_PLAN_STEPS: 'BREAKDOWN_PLAN_STEPS',
    BREAKDOWN_ACTS: 'BREAKDOWN_ACTS',
    BREAKDOWN_ACT_LINES: 'BREAKDOWN_ACT_LINES',
    BREAKDOWN_TASKS: 'BREAKDOWN_TASKS',

    WAREHOUSE_OPS: 'WAREHOUSE_OPS',
    BATCHES: 'BATCHES',
    MARKINGS: 'MARKINGS',
    MARKING_JOURNAL: 'MARKING_JOURNAL',
    LABEL_PRINT_JOBS: 'LABEL_PRINT_JOBS',
    LABEL_PRINT_ITEMS: 'LABEL_PRINT_ITEMS',

    PRODUCTION: 'PRODUCTION',
    PRODUCTION_YIELD_DEVIATIONS: 'PRODUCTION_YIELD_DEVIATIONS',
    PRODUCTION_PLANS: 'PRODUCTION_PLANS',
    PRODUCTION_PLAN_LINES: 'PRODUCTION_PLAN_LINES',
    PRODUCTION_DISPATCH_CONFIG: 'PRODUCTION_DISPATCH_CONFIG',
    PRODUCTION_DISPATCH_PLANS: 'PRODUCTION_DISPATCH_PLANS',
    PRODUCTION_DISPATCH_LINES: 'PRODUCTION_DISPATCH_LINES',
    PRODUCTION_INGREDIENT_USAGE: 'PRODUCTION_INGREDIENT_USAGE',
    SALE_INGREDIENT_USAGE: 'SALE_INGREDIENT_USAGE',
    WASTE_RECORDS: 'WASTE_RECORDS',
    RECALL_CASES: 'RECALL_CASES',
    CRITICAL_INCIDENTS: 'CRITICAL_INCIDENTS',
    QUARANTINE_CASES: 'QUARANTINE_CASES',
    INVOICE_INTAKE_DRAFTS: 'INVOICE_INTAKE_DRAFTS', INVOICE_DOCUMENTS: 'INVOICE_DOCUMENTS',
    HACCP_DECISIONS: 'HACCP_DECISIONS', OFFLINE_QUEUE: 'OFFLINE_QUEUE', PF_QUALITY_RELEASES: 'PF_QUALITY_RELEASES',
    RECALL_BLOCKS: 'RECALL_BLOCKS',
    DEFECTS: 'DEFECTS',

    WRITE_OFFS: 'WRITE_OFFS',
    WRITEOFF_REASONS: 'WRITEOFF_REASONS',

    PURCHASE_REQUESTS: 'PURCHASE_REQUESTS',
    DEMAND_PLANS: 'DEMAND_PLANS',
    DEMAND_PLAN_DISH_LINES: 'DEMAND_PLAN_DISH_LINES',
    DEMAND_PLAN_PRODUCT_LINES: 'DEMAND_PLAN_PRODUCT_LINES',

    INVENTORIES: 'INVENTORIES',
    INVENTORY_LINES: 'INVENTORY_LINES',

    JOURNALS: 'JOURNALS',                       // = JOURNAL_ENTRIES из ТЗ §14 (см. CHANGELOG — не переименовано, чтобы не ломать уже написанный код, функционально то же самое)
    AUTO_JOURNAL_PENDING: 'AUTO_JOURNAL_PENDING', // = JOURNAL_PENDING из ТЗ §14
    JOURNAL_DEFINITIONS: 'JOURNAL_DEFINITIONS',
    JOURNAL_TRIGGERS: 'JOURNAL_TRIGGERS',
    JOURNAL_DEVIATIONS: 'JOURNAL_DEVIATIONS',
    CORRECTIVE_ACTIONS: 'CORRECTIVE_ACTIONS',

    CALCULATIONS: 'CALCULATIONS',

    REPORTS: 'REPORTS',
    AUDIT_LOG: 'AUDIT_LOG',
    SYSTEM_ERRORS: 'SYSTEM_ERRORS',
    P22_ERRORS: 'P22_ERRORS',
    P22_RECOVERY: 'P22_RECOVERY',
    P21_JOURNAL_LINKS: 'P21_JOURNAL_LINKS',
    SAFETY_DOCUMENTS: 'SAFETY_DOCUMENTS', SAFETY_BRIEFING_TYPES: 'SAFETY_BRIEFING_TYPES',
    SAFETY_REQUIREMENTS_MATRIX: 'SAFETY_REQUIREMENTS_MATRIX', SAFETY_EMPLOYEE_CONTEXT: 'SAFETY_EMPLOYEE_CONTEXT',
    SAFETY_BRIEFING_ASSIGNMENTS: 'SAFETY_BRIEFING_ASSIGNMENTS', SAFETY_BRIEFING_LOG: 'SAFETY_BRIEFING_LOG',
    SAFETY_TESTS: 'SAFETY_TESTS', SAFETY_TEST_QUESTIONS: 'SAFETY_TEST_QUESTIONS', SAFETY_TEST_ATTEMPTS: 'SAFETY_TEST_ATTEMPTS',
    SAFETY_CONFIRMATIONS: 'SAFETY_CONFIRMATIONS', SAFETY_QR: 'SAFETY_QR',
    POSITIONS: 'POSITIONS', EMPLOYEE_EQUIPMENT_PERMISSIONS: 'EMPLOYEE_EQUIPMENT_PERMISSIONS',

    NOTIFICATIONS: 'NOTIFICATIONS',
    NOTIFICATION_SETTINGS: 'NOTIFICATION_SETTINGS',
    NOTIFICATION_LOG: 'NOTIFICATION_LOG',
    BACKUPS: 'BACKUPS',

    CORE100_EVENTS: 'CORE100_EVENTS', CORE100_WORKFLOWS: 'CORE100_WORKFLOWS', CORE100_UAT_RUNS: 'CORE100_UAT_RUNS', CORE100_DEPLOY_EVIDENCE: 'CORE100_DEPLOY_EVIDENCE', CORE100_GO_LIVE_GATES: 'CORE100_GO_LIVE_GATES',
    WORKSHOPS: 'WORKSHOPS',
    EQUIPMENT: 'EQUIPMENT',

    PLAN_MENU_EVENTS: 'PLAN_MENU_EVENTS',
    PLAN_MENU_ITEMS: 'PLAN_MENU_ITEMS',

    // P0.2, новое (ТЗ §4-7): идемпотентность (OPERATIONS) и жизненный цикл каскада
    // (CASCADES) — см. Idempotency.gs/CascadeEngine.gs. cascade_id в AUDIT_LOG уже
    // существовал (v2) как метка НА записях аудита; CASCADES — это сама операция
    // как отдельная сущность со статусом (PENDING/PROCESSING/SUCCESS/FAILED/
    // RECOVERY_REQUIRED), а не только метка на чужих строках.
    OPERATIONS: 'OPERATIONS',
    CASCADES: 'CASCADES',
    OPERATION_STEPS: 'OPERATION_STEPS',

    // Секондарные фичи, раунд 1 (Архитектура v4 §6, Открытое решение B) — единая
    // таблица задач. См. Tasks.gs и SCHEMA.TASKS ниже за подробностями.
    TASKS: 'TASKS',

    // Секондарные фичи, раунд 2 (Архитектура v4 §2, Открытое решение A) — Event Bus.
    // См. Events.gs и SCHEMA.EVENTS ниже за подробностями.
    EVENTS: 'EVENTS',

    // Секондарные фичи, раунд 3 (Архитектура v4 §8, §12 п.3) — Лабораторный модуль v2.
    // См. LabTests.gs и SCHEMA.LAB_TESTS/LAB_TEST_DEFINITIONS ниже за подробностями.
    LAB_TESTS: 'LAB_TESTS',
    LAB_TEST_DEFINITIONS: 'LAB_TEST_DEFINITIONS',

    // Секондарные фичи, раунд 4 (Архитектура v4 §7, §12 п.4) — версионирование ППК
    // (регистрации предприятия/программы производственного контроля).
    // См. Ppk.gs и SCHEMA.PPK_VERSIONS ниже за подробностями.
    PPK_VERSIONS: 'PPK_VERSIONS',
    PPK_PROCESSES: 'PPK_PROCESSES', PPK_FLOW_STAGES: 'PPK_FLOW_STAGES', PPK_FLOWS: 'PPK_FLOWS', HAZARD_ANALYSIS: 'HAZARD_ANALYSIS', PPK_CONTROLS: 'PPK_CONTROLS', PPK_CRITICAL_LIMITS: 'PPK_CRITICAL_LIMITS', PPK_VERIFICATION: 'PPK_VERIFICATION', PPK_REVIEW_REQUESTS: 'PPK_REVIEW_REQUESTS', PPK_DOCUMENTS: 'PPK_DOCUMENTS', PPK_INSPECTION_PACKETS: 'PPK_INSPECTION_PACKETS',
    HACCP_REQUIREMENTS: 'HACCP_REQUIREMENTS', HACCP_CONTROL_LINKS: 'HACCP_CONTROL_LINKS', HACCP_EVIDENCE: 'HACCP_EVIDENCE', HACCP_VERIFICATION_PLAN: 'HACCP_VERIFICATION_PLAN', SANITARY_TASKS: 'SANITARY_TASKS',

    // Секондарные фичи, раунд 5 (Архитектура v4 §12 п.5, обобщение RULES из
    // TSEKH_Architecture_Journals_Chemicals.md §2.1) — Нормативная база / HACCP Engine.
    // См. Rules.gs и SCHEMA.RULES ниже за подробностями.
    RULES: 'RULES',

    // Секондарные фичи, раунд 6 (Архитектура v4 §3, §12 п.6) — адаптерная архитектура
    // интеграций (iiko/r_keeper/1С) + честные заглушки. См. Integrations.gs и
    // SCHEMA.INTEGRATIONS/INTEGRATION_MAPPINGS ниже за подробностями.
    INTEGRATIONS: 'INTEGRATIONS',
    INTEGRATION_MAPPINGS: 'INTEGRATION_MAPPINGS',

    // Секондарные фичи, раунд 8 (ТЗ «Справочник продуктов + Декларации соответствия +
    // Документы продукта», P1) — расширение Product Master и весь модуль комплаенса.
    // См. ProductMaster.gs/Suppliers.gs/Declarations.gs/SupplierDocuments.gs/
    // Compliance.gs/ProductImport.gs/OcrYandex.gs и соответствующие SCHEMA ниже.
    GLOBAL_PRODUCTS: 'GLOBAL_PRODUCTS',
    PRODUCT_ALLERGENS: 'PRODUCT_ALLERGENS',
    PRODUCT_SHELF_LIFE: 'PRODUCT_SHELF_LIFE',
    PRODUCT_SPOILAGE_SIGNS: 'PRODUCT_SPOILAGE_SIGNS',
    PRODUCT_DATA_VERSIONS: 'PRODUCT_DATA_VERSIONS',
    DECLARATIONS: 'DECLARATIONS',
    DECLARATION_PRODUCTS: 'DECLARATION_PRODUCTS',
    SUPPLIER_DOCUMENTS: 'SUPPLIER_DOCUMENTS',
    PRODUCT_COMPLIANCE_PROFILES: 'PRODUCT_COMPLIANCE_PROFILES',
    REGULATORY_SOURCES: 'REGULATORY_SOURCES',
    OCR_RESULTS: 'OCR_RESULTS',
    PRODUCT_IMPORT_BATCHES: 'PRODUCT_IMPORT_BATCHES',
    PRODUCT_IMPORT_ROWS: 'PRODUCT_IMPORT_ROWS',

    // Раунд 11 (по прямому указанию Дениса «Настрой это всё» — настоящий P&L/ABC-анализ,
    // история/недельные-месячные отчёты, обслуживание оборудования, уведомления по точкам).
    // См. Sales.gs/SalesAnalytics.gs — модель продаж (ручной ввод/CSV-импорт/iiko-синк),
    // без которой P&L был структурно невозможен (ТЗ этого раунда, обсуждено с Денисом).
    SALES: 'SALES',
    SALES_IMPORT_BATCHES: 'SALES_IMPORT_BATCHES',
    SALES_IMPORT_ROWS: 'SALES_IMPORT_ROWS',

    // Раунд 11 — история обслуживания оборудования (Equipment.gs получил соседа:
    // лог отдельных событий ТО/поломок/ремонтов, из которого честно считается
    // "просрочено ли ТО", а не только статичные дата_проверки/следующая_проверка,
    // которые раньше нигде не читались).
    EQUIPMENT_MAINTENANCE_LOG: 'EQUIPMENT_MAINTENANCE_LOG',

    // Раунд 11, продолжение («Доделай оставшиеся 4 пункта») — операционные расходы,
    // впервые дающие GET_PNL возможность честно посчитать чистую прибыль (раньше
    // структурно невозможно — система вообще не хранила расходы, см. Expenses.gs).
    EXPENSES: 'EXPENSES',
    BUDGET_PLANS: 'BUDGET_PLANS',
    CASH_TRANSACTIONS: 'CASH_TRANSACTIONS',
    AUTOMATION_DECISIONS: 'AUTOMATION_DECISIONS',
    AUTOMATION_RULES: 'AUTOMATION_RULES',
    AUTOMATION_EVENT_DISPATCH: 'AUTOMATION_EVENT_DISPATCH',
    AUTOMATION_WORKFLOWS: 'AUTOMATION_WORKFLOWS',
    AUTOMATION_WORKFLOW_STEPS: 'AUTOMATION_WORKFLOW_STEPS',
    CONFIGURATION_VERSIONS: 'CONFIGURATION_VERSIONS',
    CONFIGURATION_VALUES: 'CONFIGURATION_VALUES', MANAGEMENT_ACTION_BACKLOG: 'MANAGEMENT_ACTION_BACKLOG', WORKFORCE_PLANS: 'WORKFORCE_PLANS', SUPPLIER_SCORECARDS: 'SUPPLIER_SCORECARDS', PROCUREMENT_ACTIONS: 'PROCUREMENT_ACTIONS', INVENTORY_POLICIES: 'INVENTORY_POLICIES', CAPACITY_PLANS: 'CAPACITY_PLANS', SCENARIOS: 'SCENARIOS', EXECUTION_PLANS: 'EXECUTION_PLANS', EXECUTION_ITEMS: 'EXECUTION_ITEMS', EXECUTION_REQUESTS: 'EXECUTION_REQUESTS', SHIFT_PLANS: 'SHIFT_PLANS', SHIFT_ASSIGNMENTS: 'SHIFT_ASSIGNMENTS', PRODUCTION_CALENDARS: 'PRODUCTION_CALENDARS', PRODUCTION_CALENDAR_ITEMS: 'PRODUCTION_CALENDAR_ITEMS', DEMAND_SENSING_PLANS: 'DEMAND_SENSING_PLANS', MRP_RUNS: 'MRP_RUNS', CUSTOMER_CHANNEL_ANALYTICS: 'CUSTOMER_CHANNEL_ANALYTICS', CHANNEL_MARGIN_SNAPSHOTS: 'CHANNEL_MARGIN_SNAPSHOTS', LABOR_FORECASTS: 'LABOR_FORECASTS', DIGITAL_TWIN_V2_SNAPSHOTS: 'DIGITAL_TWIN_V2_SNAPSHOTS', MASTER_DATA_REGISTRY: 'MASTER_DATA_REGISTRY', MASTER_DATA_ALIASES: 'MASTER_DATA_ALIASES', DATA_RECONCILIATIONS: 'DATA_RECONCILIATIONS', TRACEABILITY_RUNS: 'TRACEABILITY_RUNS', TRACEABILITY_FINDINGS: 'TRACEABILITY_FINDINGS', PERIOD_CLOSURES: 'PERIOD_CLOSURES', PERIOD_CLOSURE_FINDINGS: 'PERIOD_CLOSURE_FINDINGS', PERIOD_REOPEN_REQUESTS: 'PERIOD_REOPEN_REQUESTS', AUDIT_EVIDENCE_VAULT: 'AUDIT_EVIDENCE_VAULT', AUDIT_EVIDENCE_CHECKPOINTS: 'AUDIT_EVIDENCE_CHECKPOINTS', COMPLIANCE_EVIDENCE_PACKS: 'COMPLIANCE_EVIDENCE_PACKS', COMPLIANCE_EVIDENCE_ITEMS: 'COMPLIANCE_EVIDENCE_ITEMS', COMPLIANCE_CONTROLS: 'COMPLIANCE_CONTROLS', COMPLIANCE_CONTROL_LINKS: 'COMPLIANCE_CONTROL_LINKS', CAPA_CASES: 'CAPA_CASES', CAPA_ACTIONS: 'CAPA_ACTIONS', CAPA_VERIFICATIONS: 'CAPA_VERIFICATIONS', BOARD_PACKS: 'BOARD_PACKS', KPI_TARGETS: 'KPI_TARGETS', KPI_VARIANCES: 'KPI_VARIANCES', KPI_ACTIONS: 'KPI_ACTIONS',

    // Внешний P0-аудит (сентябрь 2026) — п.1 «SESSION TTL»: сессия жила ТОЛЬКО в
    // CacheService, который в реальном Apps Script физически не принимает TTL больше
    // 21600 секунд (6 часов) — при SESSION_TTL_MS=12ч каждый вызов
    // CacheService.put() в проде бросал бы исключение. См. Auth.gs — сессия теперь
    // дополнительно хранится здесь как надёжная опора (durable backing store),
    // CacheService остаётся быстрым кэшем поверх неё.
    SESSIONS: 'SESSIONS',

    // Модуль «Касса» (Pos.gs, replica/architecture.md, этап M1): смены, заказы, оплаты.
    POS_SHIFTS: 'POS_SHIFTS', POS_ORDERS: 'POS_ORDERS', POS_ORDER_LINES: 'POS_ORDER_LINES', POS_PAYMENTS: 'POS_PAYMENTS',
    // Этап M2: зал и столы.
    POS_HALLS: 'POS_HALLS', POS_TABLES: 'POS_TABLES',
    // Этап M3: модификаторы и их расход со склада.
    MODIFIER_GROUPS: 'MODIFIER_GROUPS', MODIFIERS: 'MODIFIERS', DISH_MODIFIER_LINKS: 'DISH_MODIFIER_LINKS',
    POS_MODIFIER_USAGE: 'POS_MODIFIER_USAGE',
    // Этап M4: стоп-лист.
    STOP_LIST: 'STOP_LIST',
    PREP_PARS: 'PREP_PARS',
    PREP_LISTS: 'PREP_LISTS',
    // Этап M6: гости и бонусы.
    GUESTS: 'GUESTS', BONUS_TXNS: 'BONUS_TXNS',
    // Этап M7: ссылки сотрудников на сервис чаевых.
    POS_TIP_LINKS: 'POS_TIP_LINKS',
    // Этап M8: снимок меню для публичного QR-меню (единственный лист, который читает проект qrmenu/).
    PUBLIC_MENU: 'PUBLIC_MENU'
  },

  // Схема заголовков для initializeDatabase(). Порядок колонок = порядок в листе.
  // Первая колонка каждой таблицы — её первичный ключ.
  SCHEMA: {
    ORGANIZATIONS: ['organization_id', 'название', 'ИНН', 'ОГРН', 'тип', 'статус', 'создано'],
    LOCATIONS: ['location_id', 'organization_id', 'название', 'адрес', 'статус', 'создано'],
    // v2: добавлены failed_attempts/locked_until/last_login (защита от перебора PIN, ТЗ §4).
    // Внешний P0-аудит, п.2 (продолжение раунда 12, по решению Дениса) — добавлены:
    //   pin_salt      — индивидуальная соль на пользователя (Users.gs::hashPin_). У СТАРЫХ
    //                    строк (созданных до этого раунда) пусто '' — hashPin_(pin, '') даёт
    //                    ТОТ ЖЕ хэш, что и старая несолёная схема, так что существующие PIN
    //                    продолжают работать без принудительного сброса (решение Дениса —
    //                    "добавить соль, старые PIN работают как раньше"); соль появляется
    //                    у учётки при следующей смене/сбросе PIN или при создании нового
    //                    сотрудника.
    //   lockout_count — счётчик ПОДРЯД идущих блокировок одной учётки (без успешного входа
    //                    между ними) — управляет эскалацией длительности следующей блокировки
    //                    (CONFIG.PIN_LOCKOUT_LADDER_MS). Сбрасывается в 0 при успешном входе
    //                    или ручном вмешательстве администратора.
    USERS: ['user_id', 'organization_id', 'location_ids', 'имя', 'email', 'телефон', 'роль', 'position_id', 'workshop_id', 'job_type', 'equipment_ids', 'статус', 'pin_hash', 'pin_salt', 'failed_attempts', 'locked_until', 'lockout_count', 'last_login', 'создано'],
    ROLES: ['role_id', 'название', 'модули'],
    // v2: SETTINGS раньше не имел location_id — из-за этого _getLocationSetting_ мог
    // применить настройку одной точки ко всем остальным (см. CHANGELOG, ошибка №56)
    SETTINGS: ['organization_id', 'location_id', 'ключ', 'значение'],
    SYSTEM_LOG: ['log_id', 'тип', 'сообщение', 'дата'],

    // Раунд 8 — добавлены только ДЕЙСТВИТЕЛЬНО организационно-специфичные поля
    // (ТЗ §6: "внутренний артикул... внутреннее название"). Цена/поставщик/срок
    // хранения (дней) уже были здесь и не дублируются. global_product_id — связь с
    // GLOBAL_PRODUCTS (общесправочные данные: пищевая ценность/условия хранения/
    // аллергены/сроки/признаки порчи), см. ProductMaster.gs.
    PRODUCTS: ['product_id', 'organization_id', 'название', 'категория_id', 'единица', 'закупочная_цена', 'текущая_цена', 'поставщик_id', 'срок_хранения_дней', 'мин_остаток', 'активность', 'создано', 'обновлено', 'штрихкод', 'global_product_id', 'артикул', 'внутреннее_название'],
    PRICE_HISTORY: ['price_history_id','organization_id','product_id','price_type','old_price','new_price','source','batch_id','supplier_id','effective_at','user_id','cascade_id','reason','metadata_json'],
    UNITS: ['unit_id', 'название', 'коэффициент_перевода'],
    CATEGORIES: ['category_id', 'название', 'тип'],
    SUPPLIERS: ['supplier_id', 'organization_id', 'название', 'контакты'],
    DISHES: ['dish_id', 'organization_id', 'название', 'категория_id', 'выход', 'цена_продажи', 'себестоимость', 'food_cost', 'маржа', 'статус', 'version', 'обновлено'],
    SEMI_FINISHED: ['pf_id', 'organization_id', 'workshop_id', 'название', 'выход', 'единица', 'потери_процент', 'срок_хранения_часов', 'условия_хранения', 'себестоимость', 'version', 'обновлено'],
    PRODUCT_MATRIX: ['matrix_id', 'location_id', 'product_ids'],

    RECIPES: ['recipe_id', 'parent_type', 'parent_id', 'product_id', 'брутто', 'нетто', 'единица', 'потери_процент'],
    TECH_CARDS: ['ttk_id', 'dish_id', 'технология', 'фото_url', 'version', 'created_at', 'created_by', 'status'],
    TTK_VERSIONS: ['ttk_version_id','dish_id','organization_id','version','status','источник','область_применения','технология','условия_хранения','срок_реализации','показатели_качества','пищевая_ценность','аллергенная_информация','технологические_этапы_json','ppk_id','recipe_snapshot_json','cost_snapshot','food_cost_snapshot','created_at','created_by','submitted_at','submitted_by','approved_at','approved_by','archived_at','archived_by'],
    TTK_HACCP_LINKS: ['link_id','organization_id','ttk_version_id','ppk_id','hazard_id','control_id','stage_id','control_type','critical_limit_id','status','created_at','created_by'],
    BREAKDOWN_PLANS: ['plan_id','organization_id','название','input_product_id','input_unit','input_basis_qty','thaw_loss_pct','trim_loss_pct','status','version','workshop_id','created_at','created_by','approved_at','approved_by'],
    BREAKDOWN_PLAN_OUTPUTS: ['output_id','plan_id','organization_id','step_no','output_type','output_id_ref','название','planned_qty','единица','доля_распределения','приоритет','task_title','status','created_at'],
    BREAKDOWN_ACTS: ['act_id','organization_id','location_id','workshop_id','batch_id','plan_id','input_product_id','input_qty','input_unit','thawed_qty','trim_waste','thermal_loss','other_waste','total_waste','usable_qty','status','user_id','created_at','closed_at','source_cascade_id','cascade_id'],
    BREAKDOWN_ACT_LINES: ['line_id','act_id','organization_id','batch_id','output_batch_id','output_type','output_id','planned_qty','actual_qty','единица','unit_cost','amount','created_at','cascade_id'],
    BREAKDOWN_TASKS: ['task_id','act_id','organization_id','location_id','workshop_id','batch_id','step_id','output_type','output_id','название','planned_qty','единица','статус','приоритет','task_title','production_id','created_at','completed_at','cascade_id'],
    BREAKDOWN_PLAN_STEPS: ['step_id','plan_id','organization_id','step_no','stage_type','название','описание','equipment','temperature_min','temperature_max','time_minutes','input_basis_qty','expected_loss_pct','expected_output_qty','output_unit','haccp_control_id','required_confirmation','status','created_at'],
    TTK_SANPIN_LINKS: ['link_id','organization_id','ttk_version_id','requirement_id','clause','source_document','status','created_at','created_by'],

    // P0.3 (ТЗ §8) — добавлено api_operation_id: id КОНКРЕТНОГО вызова processOperation()
    // (P0.2, Idempotency.gs), который породил эту складскую проводку — НЕ путать с
    // operation_id (первая колонка), который был и остаётся собственным первичным
    // ключом строки WAREHOUSE_OPS (как и everywhere: batch_id/writeoff_id/product_id
    // и т.д.). cascade_id уже был в схеме — теперь оба поля реально заполняются
    // (_recordOp_, Warehouse.gs), а не просто зарезервированы пустыми.
    WAREHOUSE_OPS: ['operation_id', 'organization_id', 'location_id', 'product_id', 'тип_операции', 'количество', 'цена', 'сумма', 'batch_id', 'user_id', 'дата', 'cascade_id', 'api_operation_id'],
    // Раунд 8 (ТЗ §14) — необязательные ссылки на документы этой конкретной партии.
    // certificate_id/veterinary_document_id ссылаются на SUPPLIER_DOCUMENTS.doc_id
    // (doc_type='CERTIFICATE'/'VETERINARY') — отдельных таблиц CERTIFICATES/
    // VETERINARY_DOCUMENTS не заводим, это тот же SUPPLIER_DOCUMENTS с разным doc_type
    // (не плодим параллельные структуры под то, что уже покрыто одной сущностью).
    // Раунд 12 (P0.5, §46) — добавлен cascade_id: партия (приход/выпуск ПФ) до этого
    // раунда была ОРФАННОЙ записью — не имела никакой связи с породившим её вызовом
    // API, в отличие от WAREHOUSE_OPS-проводки, которая на эту же партию ссылается и
    // cascade_id уже имеет. Без него нельзя было одним фильтром найти "какая партия
    // получилась из этой конкретной операции прихода/производства".
    BATCHES: ['batch_id', 'product_id', 'location_id', 'workshop_id', 'количество', 'цена_прихода', 'дата_прихода', 'дата_производства', 'срок_годности', 'статус', 'партия_номер', 'ответственный_id', 'declaration_id', 'certificate_id', 'veterinary_document_id', 'cascade_id', 'source_batch_id', 'marking_type'],
    MARKINGS: ['marking_id','organization_id','location_id','batch_id','product_id','marking_type','code','status','source','external_id','issued_at','applied_at','verified_at','printed_at','reprint_count','revoked_at','created_by','created_at','metadata_json'],
    MARKING_JOURNAL: ['journal_id','organization_id','location_id','workshop_id','batch_id','marking_id','product_id','ttk_version_id','production_id','marking_type','marking_code','operation','status','operator_id','timestamp','print_job_id','evidence_id','cascade_id','api_operation_id','reason','metadata_json'],
    LABEL_PRINT_JOBS: ['print_job_id','organization_id','location_id','label_type','status','requested_by','requested_at','printed_at','verified_at','reason','cascade_id'],
    LABEL_PRINT_ITEMS: ['item_id','print_job_id','batch_id','marking_id','label_number','status','printed_at','verified_at','error'],

    // Раунд 12 (P0.5, §46) — добавлен cascade_id, тем же смыслом, что у BATCHES выше.
    PRODUCTION: ['production_id', 'location_id', 'workshop_id', 'parent_type', 'parent_id', 'количество', 'batch_id', 'статус', 'user_id', 'дата', 'cascade_id'],
    PRODUCTION_INGREDIENT_USAGE: ['usage_id','organization_id','location_id','workshop_id','production_id','ttk_version_id','dish_id','product_id','batch_ids','единица','брутто','нетто','отход','процент_отхода','стоимость_брутто','стоимость_отхода','user_id','дата','cascade_id'],
    WASTE_RECORDS: ['waste_id','organization_id','location_id','workshop_id','production_id','sale_id','ttk_version_id','dish_id','product_id','batch_ids','причина','единица','брутто','нетто','отход','процент_отхода','сумма','user_id','дата','cascade_id','journal_id'],
    SALE_INGREDIENT_USAGE: ['usage_id','organization_id','location_id','sale_id','ttk_version_id','dish_id','product_id','batch_ids','единица','брутто','нетто','отход','процент_отхода','стоимость_брутто','стоимость_отхода','user_id','дата','cascade_id'],
    DEFECTS: ['defect_id', 'production_id', 'количество', 'причина'],

    // P0.3 (ТЗ §8) — тот же api_operation_id, тем же смыслом, что и у WAREHOUSE_OPS выше.
    WRITE_OFFS: ['writeoff_id', 'location_id', 'workshop_id', 'product_id', 'количество', 'reason_id', 'сумма', 'user_id', 'дата', 'cascade_id', 'api_operation_id'],
    WRITEOFF_REASONS: ['reason_id', 'название'],

    // Раунд 12 (P0.5, §46) — добавлен cascade_id.
    PURCHASE_REQUESTS: ['request_id', 'location_id', 'product_id', 'количество', 'supplier_id', 'статус', 'user_id', 'дата', 'дедуп_ключ', 'cascade_id'],
    DEMAND_PLANS: ['plan_id','organization_id','location_id','date_from','date_to','horizon_days','safety_stock_pct','status','created_at','created_by','approved_at','approved_by'],
    DEMAND_PLAN_DISH_LINES: ['line_id','plan_id','organization_id','location_id','dish_id','forecast_qty','historical_qty','avg_daily_qty','status','production_id','created_at'],
    DEMAND_PLAN_PRODUCT_LINES: ['line_id','plan_id','organization_id','location_id','product_id','demand_qty','fefo_stock_qty','open_purchase_qty','net_purchase_qty','estimated_cost','supplier_id','status','purchase_request_id','created_at'],

    // Раунд 12 (P0.5, §46) — добавлен cascade_id к обеим таблицам.
    INVENTORIES: ['inventory_id', 'location_id', 'статус', 'создано', 'закрыто', 'cascade_id'],
    INVENTORY_LINES: ['line_id', 'inventory_id', 'product_id', 'участок', 'user_id', 'факт_количество', 'системный_остаток', 'отклонение', 'сумма_отклонения', 'cascade_id'],

    // JOURNALS = фактические записи (JOURNAL_ENTRIES). v2: добавлены workshop_id и
    // ссылка на определение/отклонение, чтобы запись была привязана к конкретному
    // нормативу, а не к "температуре вообще" (ТЗ §18).
    // Раунд 12 (P0.5, §46) — добавлен cascade_id (только для записей, реально созданных
    // ВНУТРИ вызова API с сессией — например, corrective-action-триггерная запись из
    // WriteOffs.gs; записи, созданные плановыми триггерами auto-журналов, законно имеют
    // пустой cascade_id — у триггера нет вызова processOperation() и, соответственно, нет
    // cascade).
    JOURNALS: ['journal_id', 'organization_id', 'location_id', 'workshop_id', 'тип_журнала', 'definition_id', 'значение', 'статус', 'user_id', 'дата', 'deviation_id', 'cascade_id', 'ppk_id', 'ppk_version', 'тип_ответа', 'текст_вопроса', 'ожидаемый_ответ'],
    // v2: КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ (ТЗ §16) — дедуп теперь по organization_id+location_id+
    // workshop_id+journal_type+date+slot_time, а не только journal_type+slot_time.
    // Раньше запись за вчера в 08:00 навсегда блокировала создание записи на 08:00 сегодня.
    AUTO_JOURNAL_PENDING: ['pending_id', 'organization_id', 'location_id', 'workshop_id', 'journal_type', 'definition_id', 'date', 'slot_time', 'статус', 'dedup_key', 'trigger_id', 'тип_ответа', 'текст_вопроса', 'ожидаемый_ответ', 'уровень_при_нет'],
    // v2, новое (ТЗ §14/§18/§19): пределы конкретного журнала/оборудования/продукта.
    // Пределы НЕ зашиты в код — заводятся администратором для каждого предприятия.
    JOURNAL_DEFINITIONS: ['definition_id', 'organization_id', 'location_id', 'workshop_id', 'journal_type', 'название', 'периодичность', 'роль_ответственная', 'equipment_id', 'мин_норма', 'макс_норма', 'мин_предупреждение', 'макс_предупреждение', 'единица', 'source_type', 'source_document', 'обязательность', 'статус', 'ppk_id', 'ppk_version', 'тип_ответа', 'текст_вопроса', 'ожидаемый_ответ', 'уровень_при_нет', 'напомнить_за_минут'],
    JOURNAL_TRIGGERS: ['trigger_id', 'organization_id', 'location_id', 'workshop_id', 'definition_id', 'journal_type', 'название', 'режим', 'время', 'интервал_минут', 'смещение_минут', 'активен', 'тип_ответа', 'текст_вопроса', 'ожидаемый_ответ', 'уровень_при_нет'],
    // v2, новое: фиксирует сам факт отклонения (не подменяет запись журнала, а ссылается на неё)
    JOURNAL_DEVIATIONS: ['deviation_id', 'journal_id', 'definition_id', 'уровень', 'значение', 'предел_нарушен', 'дата', 'статус', 'corrective_action_id'],
    // v2, новое (ТЗ §19): предлагаемое действие берётся из утверждённой процедуры (source_document),
    // это НЕ придуманная системой рекомендация "на глаз"
    // P0.6 — + pending_id: корректирующее действие бывает по ДВУМ разным причинам —
    // критическое отклонение ВВЕДЁННОГО значения (deviation_id ссылается на JOURNAL_DEVIATIONS)
    // ИЛИ пропущенное измерение, которое вообще не было введено вовремя (pending_id
    // ссылается на AUTO_JOURNAL_PENDING, см. escalateOverdueJournals_) — у второго случая
    // просто нет JOURNAL_DEVIATIONS-записи, отклонять-то нечего, значения не было вовсе.
    // Ровно одно из двух полей заполнено, второе — пустая строка.
    CORRECTIVE_ACTIONS: ['action_id', 'deviation_id', 'pending_id', 'описание', 'source_document', 'ответственный_роль', 'ответственный_id', 'статус', 'результат', 'дата'],

    // Раунд 12 (P0.5, §46) — добавлен cascade_id. recalcEconomics_ вызывается и из
    // read-only GET_ECONOMICS (законно без cascade — GET_-действия не создают cascade
    // вообще, см. API.gs::_isMutatingAction_), и из мутирующих CREATE_WRITEOFF/
    // UPDATE_PRODUCT_PRICE — там теперь передаётся и сохраняется.
    CALCULATIONS: ['calculation_id', 'объект_тип', 'объект_id', 'тип_расчёта', 'значение', 'дата_расчёта', 'cascade_id'],

    REPORTS: ['report_id', 'organization_id', 'тип', 'период', 'ссылка_на_файл', 'создано'],
    // v2: добавлен cascade_id (ТЗ §64 — одна операция = один cascade_id по всем затронутым таблицам)
    AUDIT_LOG: ['log_id', 'user_id', 'действие', 'объект', 'старое_значение', 'новое_значение', 'дата', 'результат', 'cascade_id'],
    SYSTEM_ERRORS: ['error_id', 'функция', 'user_id', 'дата', 'операция', 'техническое_описание'],
    SAFETY_DOCUMENTS: ['document_id','document_type','document_number','title','version','organization_id','location_id','workshop_id','applicable_roles','status','created_at','approved_at','effective_from','effective_to','created_by','approved_by','file_id','source','checksum','file_name','mime_type','methods','notes','previous_version_id'],
    SAFETY_BRIEFING_TYPES: ['type_id','organization_id','code','title','description','active','methods','repeat_rule','source'],
    SAFETY_REQUIREMENTS_MATRIX: ['requirement_id','organization_id','location_id','workshop_id','equipment_id','role','job_type','document_id','briefing_type','required','methods','block_operation','block_rule_code','source','active'],
    SAFETY_EMPLOYEE_CONTEXT: ['context_id','employee_id','organization_id','location_id','workshop_id','job_type','equipment_ids','active','created_at'],
    SAFETY_BRIEFING_ASSIGNMENTS: ['assignment_id','employee_id','organization_id','location_id','workshop_id','instruction_id','instruction_version','briefing_type','assigned_at','due_at','status','completed_at','expires_at','assigned_by','required_methods','block_operation','block_rule_code','requirement_id'],
    SAFETY_BRIEFING_LOG: ['briefing_id','employee_id','instruction_id','instruction_version','briefing_type','assigned_at','started_at','completed_at','test_result','confirmation','trainer_id','responsible_id','organization_id','location_id','workshop_id','status','audit_id','assignment_id'],
    SAFETY_TESTS: ['test_id','organization_id','instruction_id','instruction_version','briefing_type','title','status','pass_threshold','source','approved_by','approved_at','created_by','created_at'],
    SAFETY_TEST_QUESTIONS: ['question_id','test_id','organization_id','question_text','answer_type','options_json','correct_answer','is_required','sort_order','explanation','active','source','approval_status'],
    SAFETY_TEST_ATTEMPTS: ['attempt_id','employee_id','test_id','instruction_id','instruction_version','started_at','completed_at','answers_json','correct_count','total_count','score','passed','attempt_number','organization_id','location_id','audit_id','assignment_id','status'],
    SAFETY_CONFIRMATIONS: ['confirmation_id','employee_id','organization_id','location_id','instruction_id','instruction_version','timestamp','mode','ip_metadata','device_metadata','session_id','statement','signed_file_id','assignment_id','audit_id'],
    SAFETY_QR: ['qr_id','organization_id','location_id','instruction_id','instruction_version','equipment_id','token','created_at','created_by','active'],
    POSITIONS: ['position_id','organization_id','name','code','description','active','created_at','updated_at'],
    EMPLOYEE_EQUIPMENT_PERMISSIONS: ['permission_id','employee_id','equipment_id','organization_id','location_id','instruction_id','test_id','result','approved_by','approved_at','valid_until','status','block_rule_code','created_at','updated_at'],
    P22_ERRORS: ['error_id','timestamp','severity','module','function','operation_id','event_id','organization_id','location_id','workshop_id','user_id','entity_type','entity_id','error_code','message','stack','payload_hash','retryable','recovery_status'],
    P22_RECOVERY: ['recovery_id','organization_id','location_id','operation_id','event_id','cascade_id','status','error_code','message','retryable','attempt','created_at','updated_at','resolved_at','resolved_by'],
    P21_JOURNAL_LINKS: ['link_id','organization_id','location_id','event_id','operation_id','journal_id','journal_type','created_at'],

    // Раунд 12 (P0.5, §46) — добавлен cascade_id. Большинство уведомлений рождаются из
    // плановых триггеров (просрочка/сроки годности/критический остаток и т.д.) — у них
    // законно нет cascade (нет вызова processOperation). Уведомление, реально порождённое
    // ВНУТРИ мутирующего вызова API с сессией (например, критический остаток сразу после
    // списания), теперь сохраняет cascade_id этого вызова.
    NOTIFICATIONS: ['notification_id', 'organization_id', 'location_id', 'тип', 'сообщение', 'статус', 'создано', 'event_key', 'cascade_id'],
    // v2, новое (ТЗ §22-24): кому/через что/с каким троттлингом отправлять по каждому типу события
    NOTIFICATION_SETTINGS: ['setting_id', 'organization_id', 'location_id', 'тип_уведомления', 'enabled', 'email_enabled', 'recipients', 'delay_minutes', 'repeat_interval_minutes', 'max_repeats'],
    // v2, новое (ТЗ §24): факт отправки, чтобы не спамить и чтобы было видно, что реально ушло
    NOTIFICATION_LOG: ['log_id', 'notification_id', 'event_key', 'recipient_email', 'sent_at', 'статус', 'ошибка', 'попытка'],
    BACKUPS: ['backup_id', 'тип', 'ссылка_на_файл', 'статус', 'создано'],

    // v2, новое (ТЗ §8-9): цеха — производственные участки ВНУТРИ точки, не путать
    // с точкой или организацией (ТЗ §8: организация/точка/цех — разные сущности)
    WORKSHOPS: ['workshop_id', 'location_id', 'название', 'тип', 'цвет', 'статус', 'описание', 'ответственный_id', 'создано', 'обновлено'],
    // v2, новое (ТЗ §53): оборудование с температурным диапазоном, привязанное к цеху; QR ведёт на него
    EQUIPMENT: ['equipment_id', 'location_id', 'workshop_id', 'название', 'тип', 'номер', 'мин_температура', 'макс_температура', 'статус', 'дата_проверки', 'следующая_проверка', 'ответственный_id', 'manufacturer', 'model', 'serial_number', 'inventory_number', 'risk_level', 'instruction_required', 'training_required', 'test_required', 'maintenance_schedule', 'calibration_required', 'active', 'created_at', 'updated_at'],

    // v2, новое: банкетный/событийный модуль «План-меню» (см. PlanMenu.gs)
    PLAN_MENU_EVENTS: ['event_id', 'organization_id', 'location_id', 'название', 'дата', 'время', 'гостей', 'статус', 'ответственный_id', 'создано'],
    PLAN_MENU_ITEMS: ['item_id', 'event_id', 'dish_id', 'порций_на_гостя', 'порций_итого'],

    // P0.2, новое (ТЗ §7) — идемпотентность: один operation_id = максимум одно реальное
    // исполнение. результат_json хранит уже готовый ответ (envelope), чтобы повтор с тем
    // же operation_id отдавал ЕГО, а не пересчитывал заново.
    OPERATIONS: ['operation_id', 'action', 'user_id', 'organization_id', 'cascade_id', 'статус', 'результат_json', 'request_hash', 'event_id', 'error_code', 'создано', 'обновлено', 'начато', 'завершено'],
    // P0.2, новое (ТЗ §4-6) — сама бизнес-операция как сущность со статусом.
    // Честно: статус_машина здесь фиксирует ТОЛЬКО факт успеха/провала операции и число
    // шагов аудита с этим cascade_id — компенсирующих откатов (настоящего rollback уже
    // записанных строк) в этой версии НЕТ, RECOVERY_REQUIRED — это пометка "нужно
    // разобраться руками", не автоматическое исправление (см. CascadeEngine.gs).
    CASCADES: ['cascade_id', 'operation_id', 'action', 'organization_id', 'location_id', 'user_id', 'статус', 'шагов', 'ошибка', 'event_id', 'failure_class', 'recovery_id', 'начато', 'завершено', 'обновлено'],

    // Секондарные фичи, раунд 1 (Архитектура v4 §6) — единая таблица задач, куда
    // ПИШУТ (не заменяя их) уже существующие источники: CORRECTIVE_ACTIONS
    // (отклонения/просрочка журналов, Journals.gs), позже — лаборатория/химия/ППК
    // по мере реализации соответствующих разделов v4. Поля намеренно латиницей
    // (не "статус"/"дата"), как уже сделано у TECH_CARDS выше (status/created_at/
    // created_by) — тот же прецедент стиля для новых, "инфраструктурных" таблиц,
    // в отличие от предметных (JOURNALS/PRODUCTION и т.д.), которые остаются на
    // кириллице по уже устоявшемуся в проекте стилю.
    TASKS: ['task_id', 'organization_id', 'location_id', 'type', 'title', 'description', 'responsible_role', 'responsible_id', 'priority', 'created_at', 'due_at', 'status', 'source_event_id', 'source_entity_id', 'completed_at', 'completed_by'],

    // Секондарные фичи, раунд 2 (Архитектура v4 §2) — Event Bus. Схема ровно по
    // архитектурному документу. НЕ путать с AUDIT_LOG (см. Events.gs — докстринг
    // объясняет разницу читателей: AUDIT_LOG для человека, EVENTS для машин-подписчиков).
    // payload_json хранится строкой (Google Sheets не имеет типа "объект") — та же
    // техника, что уже используется у OPERATIONS.результат_json.
    EVENTS: ['event_id', 'organization_id', 'location_id', 'workshop_id', 'type', 'source', 'entity_type', 'entity_id', 'operation_id', 'payload_json', 'idempotency_key', 'status', 'retry_count', 'created_at', 'processed_at', 'error_code', 'error_message', 'processing_started_at', 'failed_at'],
    OPERATION_STEPS: ['step_id','operation_id','cascade_id','event_id','name','status','sequence','detail_json','started_at','completed_at','updated_at'],

    // Секондарные фичи, раунд 3 (Архитектура v4 §8) — Лабораторный модуль v2.
    // ЗАПИСЬ ФАКТА ИССЛЕДОВАНИЯ. Стиль полей — как у JOURNALS (предметная таблица):
    // ссылки на другие сущности латиницей (*_id), содержательные поля кириллицей.
    // target_type/target_id/target_name — унаследовано от уже существующего демо-модуля
    // (demo.html, раздел 17: DB.labTests) — что именно проверяем (обычно блюдо или продукт).
    // product_id/lot_id(=BATCHES.batch_id)/production_id/recipe_id/hazard_id/ccp_id — НОВЫЕ
    // связи из ТЗ v4 §8 п.1, которых не было в демо. hazard_id/ccp_id ЧЕСТНО не проверяются
    // на принадлежность организации при создании (см. LabTests.gs) — таблиц HAZARDS/CCP пока
    // не существует, это §12 п.5 (Нормативная база/HACCP Engine), следующий раунд.
    LAB_TESTS: ['test_id', 'organization_id', 'location_id', 'workshop_id', 'definition_id',
      'target_type', 'target_id', 'target_name', 'product_id', 'lot_id', 'production_id', 'recipe_id', 'hazard_id', 'ccp_id',
      'тип_исследования', 'лаборатория', 'протокол', 'дата_отбора', 'дата_результата', 'следующая_дата',
      'результат', 'заключение', 'ответственный_роль', 'ответственный_id', 'параметры_json', 'user_id', 'создано'],

    // "LabSchedule" из ТЗ v4 §8 п.2 — план периодических исследований, по образцу
    // JOURNAL_DEFINITIONS (лимиты/периодичность НЕ хардкодятся, заводятся администратором,
    // ТЗ §27). В отличие от JOURNAL_DEFINITIONS (несколько слотов В ТЕЧЕНИЕ смены), лабораторные
    // исследования — низкочастотные (раз в неделю/месяц/квартал), поэтому вместо полноценного
    // движка слотов (regenerateJournalSlots_/AUTO_JOURNAL_PENDING) — облегчённый механизм:
    // одна дата следующая_дата прямо на самой строке расписания, сдвигаемая вперёд при
    // срабатывании (см. checkOverdueLabTests_, LabTests.gs). Это сознательно ПРОЩЕ, чем
    // журнальный движок — для дневных/сменных слотов такое упрощение было бы неверным,
    // для недельного/месячного лабораторного контроля — соразмерно задаче.
    // дни_на_повтор_при_fail — ТЗ v4 §8 п.3 (обязательный повторный отбор после FAIL) —
    // ОБЯЗАТЕЛЬНО настраивается администратором, не зашито числом в код (тот же принцип,
    // что и мин_норма/макс_норма у JOURNAL_DEFINITIONS).
    LAB_TEST_DEFINITIONS: ['definition_id', 'organization_id', 'location_id', 'workshop_id',
      'target_type', 'target_id', 'target_name', 'тип_исследования', 'периодичность_дней',
      'роль_ответственная', 'ответственный_id', 'дни_на_повтор_при_fail',
      'source_document', 'следующая_дата', 'статус'],

    // Секондарные фичи, раунд 4 (Архитектура v4 §7) — версионирование ППК. Схема РОВНО
    // по архитектурному документу (§7, блок PPK_VERSIONS) — поля латиницей, как у
    // TASKS/EVENTS/OPERATIONS/CASCADES: это тоже "инфраструктурная" таблица с явной
    // машиной состояний (DRAFT/REVIEW/APPROVED/ARCHIVED), а не предметный факт вроде
    // JOURNALS. snapshot_json — строка (та же техника, что уже у OPERATIONS.результат_json
    // и EVENTS.payload_json) — см. докстринг Ppk.gs за структурой самого снимка.
    PPK_VERSIONS: ['ppk_id', 'version', 'organization_id', 'created_at', 'effective_from',
      'author_id', 'approved_by', 'status', 'snapshot_json'],
    PPK_PROCESSES: ['process_id','ppk_id','organization_id','location_id','process_code','name','scope_json','status','source','created_at'],
    PPK_FLOW_STAGES: ['stage_id','ppk_id','organization_id','location_id','stage_code','name','process_id','previous_stage_id','next_stage_id','product_ids_json','workshop_id','equipment_id','input_json','output_json','parameters_json','responsible_role','status'],
    PPK_FLOWS: ['flow_id','ppk_id','organization_id','location_id','flow_type','name','stage_ids_json','product_ids_json','route_json','status','created_at'],
    HAZARD_ANALYSIS: ['hazard_id','ppk_id','organization_id','location_id','process_id','product_id','stage_id','hazard_type','hazard_description','source','likelihood','severity','risk_score','control_measure','classification','critical_limit','monitoring_method','monitoring_frequency','responsible_role','corrective_action','verification_method','record_type','human_confirmed','confirmed_by','confirmed_at','status','created_at'],
    PPK_CONTROLS: ['control_id','ppk_id','organization_id','location_id','process_id','stage_id','product_id','hazard_id','point_type','control_name','purpose','risk_description','critical_limit_ref','monitoring_parameter','monitoring_method','frequency','responsible_role','journal_definition_id','corrective_action','verification_method','status','human_confirmed','confirmed_by','confirmed_at','source','created_at'],
    PPK_CRITICAL_LIMITS: ['limit_id','ppk_id','organization_id','location_id','control_id','parameter','min_value','max_value','unit','applicable_stage','applicable_product','source','source_document','effective_date','version','approved_by','status','created_at'],
    PPK_VERIFICATION: ['verification_id','ppk_id','organization_id','location_id','control_id','method','frequency','responsible_role','evidence_source','result','verified_at','status','notes','created_by','created_at'],
    PPK_REVIEW_REQUESTS: ['review_id','ppk_id','organization_id','location_id','reason_type','reason','source_entity_type','source_entity_id','impact_json','status','created_by','created_at','resolved_at','resolved_by'],
    PPK_DOCUMENTS: ['document_id','ppk_id','organization_id','location_id','title','document_version','status','sections_json','generated_at','generated_by','file_id','url','checksum'],
    PRODUCTION_YIELD_DEVIATIONS: ['deviation_id','organization_id','location_id','production_id','act_id','stage_id','product_id','planned_qty','actual_qty','deviation_qty','deviation_pct','threshold_pct','level','reason','corrective_action_id','status','created_at','created_by','cascade_id'],
    RECALL_CASES: ['recall_id','organization_id','location_id','batch_id','product_id','reason','severity','status','opened_at','opened_by','closed_at','closed_by','cascade_id'],
    CRITICAL_INCIDENTS: ['incident_id','organization_id','location_id','workshop_id','entity_type','entity_id','severity','status','code','название','описание','причина','предписанное_действие','corrective_action_id','task_id','haccp_flag','ppk_id','control_id','deviation_id','batch_id','production_id','equipment_id','prior_entity_status','quarantine_id','ответственный_роль','ответственный_id','приоритет','срок_устранения','evidence_json','created_at','created_by','resolved_at','resolved_by','resolution','cascade_id'],
    QUARANTINE_CASES: ['quarantine_id','organization_id','location_id','workshop_id','incident_id','batch_id','prior_status','status','reason','created_at','created_by','released_at','released_by','release_decision','cascade_id'],
    INVOICE_INTAKE_DRAFTS: ['draft_id','organization_id','location_id','status','document_json','lines_json','matched_lines_json','integrity_json','haccp_json','warnings_json','errors_json','operation_id','created_at','created_by','confirmed_at','confirmed_by','receipt_json','cascade_id'],
    INVOICE_DOCUMENTS: ['document_id','organization_id','location_id','draft_id','status','document_number','document_date','supplier_id','document_fingerprint','lines_fingerprint','created_at','created_by','posted_at','posted_by'],
    HACCP_DECISIONS: ['decision_id','organization_id','location_id','event_type','ppk_id','control_id','batch_id','production_id','journal_id','value','decision','reasons_json','warnings_json','created_at','created_by','cascade_id'],
    OFFLINE_QUEUE: ['queue_id','organization_id','location_id','user_id','operation_id','action','payload_json','status','created_at','synced_at','result_json','error'],
    PF_QUALITY_RELEASES: ['release_id','organization_id','location_id','batch_id','decision','reason','evidence_json','created_at','created_by','cascade_id'],
    RECALL_BLOCKS: ['block_id','recall_id','organization_id','location_id','batch_id','product_id','remaining_qty','reason','status','created_at','created_by','cascade_id'],
    PRODUCTION_PLANS: ['plan_id','organization_id','location_id','workshop_id','plan_date','status','created_at','created_by','approved_at','approved_by'],
    PRODUCTION_PLAN_LINES: ['line_id','plan_id','organization_id','dish_id','qty','unit','priority','status','production_id','created_at'],
    PRODUCTION_DISPATCH_CONFIG: ['config_id','organization_id','location_id','workshop_id','capacity_qty_per_hour','working_hours_per_day','active','updated_at','updated_by'],
    PRODUCTION_DISPATCH_PLANS: ['dispatch_plan_id','organization_id','location_id','plan_date','status','capacity_hours','planned_hours','utilization_pct','created_at','created_by','approved_at','approved_by'],
    PRODUCTION_DISPATCH_LINES: ['line_id','dispatch_plan_id','organization_id','location_id','production_id','dish_id','qty','priority','workshop_id','planned_hours','sequence_no','status','fefo_ready','fefo_shortage_qty','created_at'],
    PPK_INSPECTION_PACKETS: ['packet_id','organization_id','location_id','ppk_id','status','generated_at','generated_by','sections_json'],
    HACCP_REQUIREMENTS: ['requirement_id','organization_id','source_document','source_revision','clause','requirement_text','control_type','applies_to','status','effective_from','effective_to','created_at'],
    HACCP_CONTROL_LINKS: ['link_id','organization_id','ppk_id','requirement_id','control_id','journal_definition_id','evidence_type','status','created_at'],
    HACCP_EVIDENCE: ['evidence_id','organization_id','ppk_id','control_id','journal_id','deviation_id','batch_id','production_id','result','evidence_json','created_at','created_by'],
    HACCP_VERIFICATION_PLAN: ['plan_id','organization_id','ppk_id','control_id','method','frequency','responsible_role','next_due','status','created_at'],
    SANITARY_TASKS: ['task_id','organization_id','location_id','task_type','object_id','frequency','chemical','concentration','exposure_minutes','responsible_role','next_due','status','last_done_at','created_at'],

    // Секондарные фичи, раунд 5 (обобщение RULES, Архитектура v4 §12 п.5 +
    // TSEKH_Architecture_Journals_Chemicals.md §2.1) — простые ОДИНОЧНЫЕ числовые
    // нормативы (температура хранения, влажность, срок после вскрытия/разморозки и
    // т.п.), привязанные к продукту/категории — НЕ норма разведения химии (там
    // составные текстовые значения — диапазоны, "готовый раствор" — сюда не годятся,
    // см. докстринг Rules.gs за полным обоснованием этой границы). organization_id —
    // добавлено сверх исходного черновика таблицы в TSEKH_Architecture_Journals_
    // Chemicals.md (тот документ старше ТЗ P0.1) — без него норматив одной организации
    // был бы виден/редактируем из любой другой, та же дыра, что P0.1 закрыл везде
    // остальном; см. докстринг Rules.gs.
    RULES: ['rule_id', 'organization_id', 'тип_правила', 'scope_type', 'scope_id',
      'мин_значение', 'макс_значение', 'единица', 'source_document', 'version',
      'effective_from', 'effective_to', 'статус'],

    // Секондарные фичи, раунд 6 (Архитектура v4 §3) — интеграции. Схема РОВНО по
    // документу. status использует ЧЕСТНЫЙ смешанный словарь ровно как написано в
    // документе (SYNCING/SUCCESS/PARTIAL/ERROR/DISABLED — латиницей, плюс
    // НЕ_НАСТРОЕНА — кириллицей, "честный дефолт", намеренно выделен визуально от
    // технических статусов). settings_json/auth_status — см. докстринг Integrations.gs.
    INTEGRATIONS: ['integration_id', 'organization_id', 'system', 'status', 'direction',
      'last_sync', 'next_sync', 'auth_status', 'error_count', 'last_error',
      'settings_json', 'created_at', 'updated_at'],

    // Одна таблица на ВСЕ системы (а не iiko_item_id/rkeeper_item_id/onec_nomenklatura
    // отдельными колонками) — прямое требование документа: "иначе четвёртая система
    // потребует новую таблицу".
    INTEGRATION_MAPPINGS: ['mapping_id', 'integration_id', 'external_id', 'external_type',
      'internal_type', 'internal_id'],

    // ============================================================================
    // Раунд 8 — ТЗ «Справочник продуктов + Декларации соответствия + Документы
    // продукта» (P1). См. ProductMaster.gs/Suppliers.gs/Declarations.gs/
    // SupplierDocuments.gs/Compliance.gs/ProductImport.gs/OcrYandex.gs.
    // ============================================================================

    // ТЗ §4/§6/§23/§26 — GLOBAL PRODUCT: общесправочные данные ОДНОГО продукта,
    // НЕ привязанные к organization_id (пищевая ценность/условия хранения — это
    // свойство самого ингредиента, не коммерческая тайна конкретного предприятия;
    // одна и та же "Морковь" одинакова у организации А и организации Б). ORGANIZATION
    // PRODUCT (PRODUCTS выше, уже organization_id-scoped) — ссылается на неё через
    // global_product_id и хранит то, что ДЕЙСТВИТЕЛЬНО специфично организации: цену,
    // поставщика, артикул. Это единственная таблица во всём проекте без
    // organization_id по архитектурному замыслу (не путать с "утечкой
    // multi-tenant" — здесь просто нечему течь, в таблице нет ничьих бизнес-данных).
    GLOBAL_PRODUCTS: ['global_product_id', 'name', 'normalized_name', 'aliases_json', 'search_name', 'external_codes_json',
      'category', 'product_type', 'description', 'status',
      'calories_kcal_100g', 'protein_g_100g', 'fat_g_100g', 'carbohydrate_g_100g', 'fiber_g_100g', 'sugar_g_100g', 'nutrients_json',
      'storage_conditions_text', 'storage_temperature_min', 'storage_temperature_max', 'storage_humidity', 'storage_container', 'storage_location', 'light_requirement', 'special_conditions',
      'important_notes',
      'source', 'source_type', 'source_date', 'verified', 'verified_by', 'confidence',
      'created_at', 'updated_at'],

    // ТЗ §22 — аллергены НЕ выводятся из названия продукта, только явно заносятся/
    // подтверждаются (verified). product_id ссылается на GLOBAL_PRODUCTS (аллерген —
    // свойство ингредиента, не организации).
    // активен — нет физического удаления нигде в проекте (см. RULES.effective_to,
    // PRODUCTS.активность и т.д.); ошибочно добавленный аллерген деактивируется, а не
    // стирается, история остаётся видна.
    PRODUCT_ALLERGENS: ['allergen_id', 'product_id', 'allergen', 'source', 'verified', 'notes', 'активен'],

    // ТЗ §24 — raw_text ВСЕГДА хранится как источник истины (реальные данные из
    // базы — произвольный текст вроде "5-7 дней", не всегда чисто число+единица);
    // duration/duration_unit — лучшее возможное разбирание raw_text, не гарантия.
    // Не считать данные юридически обязательными без проверки source/verified.
    PRODUCT_SHELF_LIFE: ['shelf_life_id', 'product_id', 'storage_mode', 'raw_text', 'duration', 'duration_unit', 'temperature_min', 'temperature_max', 'source', 'verified', 'notes', 'активен'],

    // ТЗ §25 — справочная информация для человека при списании по порче, НЕ автодиагностика.
    PRODUCT_SPOILAGE_SIGNS: ['spoilage_id', 'product_id', 'sign_text', 'category', 'source', 'verified', 'активен'],

    // ТЗ §31 — версионирование критических характеристик (не только деклараций —
    // общий журнал для любой сущности/поля, entity_type универсален).
    PRODUCT_DATA_VERSIONS: ['version_id', 'entity_type', 'entity_id', 'field', 'old_value', 'new_value', 'changed_by', 'changed_at', 'source', 'reason'],

    // ТЗ §7/§8/§9/§10 — декларация как отдельная сущность (НЕ текстовое поле в
    // PRODUCTS). product_id — organization-scoped PRODUCTS.product_id (декларация
    // всегда принадлежит организации через организационный продукт, ТЗ §7
    // "ORGANIZATION PRODUCT... декларации"), может быть пустым, если декларация
    // относится к ГРУППЕ товаров — тогда связи только через DECLARATION_PRODUCTS.
    // P0, НАЙДЕНО ПРИ НАПИСАНИИ ТЕСТОВ РАУНДА 8 (критическая брешь, не мелочь): здесь
    // ошибочно стояло 'status' (латиница) — а Declarations.gs/API.gs/Compliance.gs
    // ПОВСЮДУ читают/пишут поле 'статус' (кириллица). Поскольку insertRow_/updateRow_
    // (Database.gs) переносят в лист ТОЛЬКО поля, перечисленные в CONFIG.SCHEMA[...], а
    // findOne_/findRows_ восстанавливают объект ТОЛЬКО из заголовков листа — 'статус'
    // просто не было колонкой: любой updateRow_(..., {статус: ...}) молча ИГНОРИРОВАЛСЯ
    // (запись не терялась с ошибкой — она просто никогда не попадала в лист), а каждое
    // свежее чтение (findOne_) получало статус=undefined, что _refreshDeclarationStatus_
    // трактует как "не ручной" и ВСЕГДА принудительно пересчитывает по датам. Итог: РУЧНЫЕ
    // статусы (SUSPENDED/REVOKED/CANCELLED/DRAFT/UNDER_REVIEW/VERIFICATION_REQUIRED,
    // ТЗ §8) были полностью нефункциональны — тихо никогда не сохранялись. Поймано
    // именно тестом "ручной статус переживает автопересчёт" (тесты/run_tests.js §8.5) —
    // без этого теста брешь осталась бы незамеченной, т.к. сам createDeclaration_
    // возвращает JS-объект СРАЗУ после insertRow_ (ещё с правильным полем в памяти),
    // маскируя проблему при первом же чтении сразу после записи.
    DECLARATIONS: ['declaration_id', 'organization_id', 'product_id', 'supplier_id', 'registration_number', 'document_type', 'статус',
      'issue_date', 'effective_from', 'effective_to', 'applicant', 'manufacturer', 'manufacturer_country', 'product_name', 'product_group',
      'technical_regulation', 'conformity_scheme', 'certification_body', 'registration_authority',
      'document_url', 'file_id', 'document_hash',
      'verification_status', 'verification_source', 'verification_url', 'verification_date', 'verification_method', 'verification_result',
      'created_at', 'updated_at', 'verified_at', 'verified_by'],

    // ТЗ §12 — один документ может относиться к нескольким SKU (DIRECT/GROUP/VARIANT).
    DECLARATION_PRODUCTS: ['link_id', 'declaration_id', 'product_id', 'relation_type'],

    // ТЗ §13/§10 — доки поставщика (в т.ч. сертификаты/вет.документы через doc_type,
    // см. комментарий у BATCHES выше). Файл хранится в Google Drive (SupplierDocuments.gs),
    // здесь — только метаданные + file_id, не содержимое (ТЗ §10 "не хранить большие
    // файлы непосредственно внутри строк таблицы").
    SUPPLIER_DOCUMENTS: ['doc_id', 'organization_id', 'supplier_id', 'product_id', 'declaration_id', 'doc_type', 'file_id', 'file_name', 'mime_type', 'file_size', 'document_hash', 'uploaded_at', 'uploaded_by'],

    // ТЗ §16 — какие документы ТРЕБУЮТСЯ для категории/типа продукции. Настраиваемо,
    // не зашито в код (ТЗ явно требует именно это). block_mode — необязательный
    // override дефолтного WARNING/BLOCKING организации (Compliance.gs) для ЭТОЙ
    // конкретной категории; пусто = использовать общую настройку организации.
    PRODUCT_COMPLIANCE_PROFILES: ['profile_id', 'organization_id', 'category', 'product_type', 'requirements_json', 'block_mode', 'created_at', 'updated_at'],

    // ТЗ §17 — обновляемая нормативная база, отдельно от кода.
    REGULATORY_SOURCES: ['source_id', 'name', 'type', 'url', 'version', 'effective_from', 'effective_to', 'status', 'last_checked', 'notes'],

    // ТЗ §11 — результат OCR ВСЕГДА требует подтверждения человеком (status
    // PENDING_REVIEW до CONFIRM_OCR_RESULT), никогда не пишется в DECLARATIONS
    // автоматически. См. OcrYandex.gs.
    OCR_RESULTS: ['ocr_id', 'organization_id', 'declaration_id', 'file_id', 'provider', 'extracted_json', 'raw_text', 'status', 'created_at', 'created_by', 'confirmed_at', 'confirmed_by'],

    // ТЗ §27/§28/§29/§30 — мастер импорта, staging ДО записи в рабочие таблицы.
    PRODUCT_IMPORT_BATCHES: ['import_id', 'organization_id', 'source_file_name', 'status', 'total_rows', 'valid_rows', 'warning_rows', 'error_rows', 'duplicate_rows', 'created_by', 'created_at', 'committed_at'],
    PRODUCT_IMPORT_ROWS: ['row_id', 'import_id', 'external_row_number', 'raw_json', 'mapped_json', 'row_status', 'messages_json', 'duplicate_candidate_global_id', 'decision', 'created_global_id'],

    // Раунд 11 — модель продаж. себестоимость_на_момент фиксируется В МОМЕНТ продажи
    // (копия dish.себестоимость на тот момент) — иначе более поздний пересчёт рецепта
    // задним числом искажал бы уже закрытую историю P&L. источник — как строка попала
    // в систему (честность происхождения данных, та же идея, что и WRITE_OFFS.cascade_id).
    // внешний_id — для идемпотентной синхронизации с кассой (iiko/r_keeper): повторный
    // синк того же периода не плодит дубли, а обновляет существующую строку.
    SALES: ['sale_id', 'organization_id', 'location_id', 'dish_id', 'qty', 'цена_продажи', 'сумма',
      'себестоимость_на_момент', 'источник', 'внешний_id', 'дата', 'user_id', 'создано',
      'исполнение_статус','исполнено_в','ttk_version_id','cascade_id','фактическая_себестоимость_сырья','стоимость_отходов','food_cost_факт','ошибка_исполнения'],

    // Тот же паттерн preview → resolve → commit, что и PRODUCT_IMPORT_* (ProductImport.gs) —
    // см. подробное обоснование в Sales.gs.
    SALES_IMPORT_BATCHES: ['import_id', 'organization_id', 'location_id', 'source_file_name', 'status',
      'total_rows', 'valid_rows', 'warning_rows', 'error_rows', 'created_by', 'created_at', 'committed_at'],
    SALES_IMPORT_ROWS: ['row_id', 'import_id', 'external_row_number', 'raw_json', 'mapped_json',
      'row_status', 'messages_json', 'matched_dish_id', 'decision', 'created_sale_id'],

    // Раунд 11 — до этого раунда EQUIPMENT.дата_проверки/следующая_проверка существовали
    // в схеме, но НИКТО и НИКОГДА их не читал (см. CHANGELOG §38.5) — только записывались
    // при создании/правке. Теперь есть отдельный лог событий ТО, из которого честно
    // считается просрочка (getEquipment_ сравнивает следующая_проверка с "сегодня").
    EQUIPMENT_MAINTENANCE_LOG: ['log_id', 'equipment_id', 'location_id', 'дата', 'тип', 'описание', 'user_id', 'создано'],

    // Раунд 11, продолжение — операционные расходы (аренда/ЗП/коммунальные/налоги и
    // т.п.), которых в системе не было НИКОГДА (см. честную границу в докстринге
    // SalesAnalytics.gs::getPnl_ до этого изменения). location_id пустой = расход
    // организации целиком (тот же смысл "org-wide", что уже применён к
    // NOTIFICATION_SETTINGS.location_id) — например, аренда одного здания на 2 точки
    // не привязана к одной конкретной точке. периодичность: 'разовый' считается
    // в P&L полностью, если дата попадает в период; 'ежемесячный' — пропорционально
    // (см. Expenses.gs::calcExpensesForPeriod_, честно документировано как
    // ПРИБЛИЖЕНИЕ — сумма/30 × дней пересечения периода, не календарная точность).
    EXPENSES: ['expense_id', 'organization_id', 'location_id', 'категория', 'сумма',
      'периодичность', 'дата', 'user_id', 'создано'],
    BUDGET_PLANS: ['budget_id','organization_id','location_id','category','direction','amount','date_from','date_to','status','created_by','created_at'],
    CASH_TRANSACTIONS: ['cash_id','organization_id','location_id','date','type','category','amount','description','status','created_by','created_at','cascade_id'],
    AUTOMATION_DECISIONS: ['decision_id','organization_id','location_id','source_code','source_module','severity','title','description','proposed_action','payload_json','status','created_at','expires_at','approved_at','approved_by','executed_at','error'],
    AUTOMATION_RULES: ['rule_id','organization_id','location_id','event_type','source','action','severity','title','description','priority','responsible_role','status','created_at','updated_at'],
    AUTOMATION_EVENT_DISPATCH: ['dispatch_id','organization_id','location_id','event_id','rule_id','dispatch_key','status','decision_id','created_at','processed_at','error'],
    AUTOMATION_WORKFLOWS: ['workflow_id','organization_id','location_id','decision_id','status','current_step','owner_role','owner_id','sla_due_at','created_at','updated_at','completed_at','last_error'],
    AUTOMATION_WORKFLOW_STEPS: ['step_id','workflow_id','organization_id','location_id','step_no','step_type','title','status','owner_role','owner_id','due_at','started_at','completed_at','attempts','last_error','result_json'],
    CONFIGURATION_VERSIONS: ['config_version_id','organization_id','location_id','version_no','status','change_type','reason','created_by','created_at','approved_by','approved_at','activated_by','activated_at','supersedes_version_id','checksum'],
    CONFIGURATION_VALUES: ['config_value_id','config_version_id','organization_id','location_id','namespace','key','value_json','value_type','critical','description','created_at'],
    MASTER_DATA_REGISTRY: ['master_id','organization_id','location_id','workshop_id','entity_type','entity_id','parent_master_id','canonical_name','normalized_name','status','version','attributes_json','source','effective_from','effective_to','created_by','created_at','updated_at'],
    MASTER_DATA_ALIASES: ['alias_id','master_id','organization_id','location_id','alias','normalized_alias','source','status','created_by','created_at'],
    DATA_RECONCILIATIONS: ['reconciliation_id','organization_id','location_id','issue_code','entity_type','entity_id','action','status','reason','created_by','created_at','resolved_by','resolved_at','resolution_json'],
    TRACEABILITY_RUNS: ['run_id','organization_id','location_id','scope_json','status','generated_at','created_by','critical_count','high_count','medium_count','finding_count'],
    TRACEABILITY_FINDINGS: ['finding_id','run_id','organization_id','location_id','code','severity','entity_type','entity_id','message','expected_json','actual_json','status','created_at'],
    PERIOD_CLOSURES: ['closure_id','organization_id','location_id','period','date_from','date_to','status','ready','critical_count','high_count','medium_count','finding_count','scope_json','created_by','created_at','approved_by','approved_at','closed_by','closed_at','reopened_by','reopened_at','reopen_reason'],
    PERIOD_CLOSURE_FINDINGS: ['finding_id','closure_id','organization_id','location_id','severity','code','title','message','entity_type','entity_id','blocking','status','created_at'],
    PERIOD_REOPEN_REQUESTS: ['reopen_request_id','closure_id','organization_id','location_id','period','date_from','date_to','reason','status','created_by','created_at','approved_by','approved_at','reopened_by','reopened_at'],
    AUDIT_EVIDENCE_VAULT: ['evidence_id','log_id','organization_id','location_id','sequence_no','previous_hash','record_hash','snapshot_json','created_at','status'],
    AUDIT_EVIDENCE_CHECKPOINTS: ['checkpoint_id','organization_id','location_id','sequence_no','head_hash','status','created_by','created_at'],
    COMPLIANCE_EVIDENCE_PACKS: ['pack_id','organization_id','location_id','period','date_from','date_to','status','closure_id','audit_status','audit_head_hash','traceability_run_id','generated_by','generated_at','manifest_json','file_id','file_url'],
    COMPLIANCE_EVIDENCE_ITEMS: ['item_id','pack_id','organization_id','location_id','section','code','title','status','severity','payload_json','created_at'],
    CAPA_CASES: ['capa_id','organization_id','location_id','source_type','source_id','source_code','title','description','severity','status','root_cause','containment','responsible_role','responsible_id','due_at','created_by','created_at','verified_by','verified_at','closed_by','closed_at','closure_evidence','last_error'],
    CAPA_ACTIONS: ['action_id','capa_id','organization_id','location_id','action_type','description','responsible_role','responsible_id','due_at','status','evidence_json','created_by','created_at','completed_by','completed_at','verification_status','verification_note'],
    CAPA_VERIFICATIONS: ['verification_id','capa_id','organization_id','location_id','result','method','evidence_json','note','verified_by','verified_at'],
    BOARD_PACKS: ['board_pack_id','organization_id','location_id','period','date_from','date_to','status','generated_by','generated_at','pack_hash','payload_json','created_at'],
    KPI_TARGETS: ['target_id','organization_id','location_id','metric_code','metric_title','direction','target_value','tolerance','period_from','period_to','status','owner_role','owner_id','note','created_by','created_at','updated_at'],
    KPI_VARIANCES: ['variance_id','organization_id','location_id','period','date_from','date_to','target_id','metric_code','actual_value','target_value','delta','delta_pct','status','board_pack_id','generated_by','generated_at','created_at'],
    KPI_ACTIONS: ['action_id','variance_id','organization_id','location_id','title','description','responsible_role','responsible_id','due_at','status','created_by','created_at','completed_by','completed_at','evidence_json','updated_at'],
    MANAGEMENT_ACTION_BACKLOG: ['action_id','organization_id','location_id','source_type','source_id','title','description','priority','status','owner_role','owner_id','due_at','dependency_json','evidence_json','created_by','created_at','completed_by','completed_at','updated_at'],
    WORKFORCE_PLANS: ['plan_id','organization_id','location_id','date_from','date_to','workshop_id','required_hours','planned_hours','hourly_cost','status','owner_id','created_by','created_at','updated_at'],
    SUPPLIER_SCORECARDS: ['scorecard_id','organization_id','location_id','supplier_id','period_from','period_to','request_count','open_request_count','score','status','generated_at'],
    PROCUREMENT_ACTIONS: ['action_id','organization_id','location_id','supplier_id','title','description','priority','status','owner_role','owner_id','due_at','created_by','created_at'],
    INVENTORY_POLICIES: ['policy_id','organization_id','location_id','product_id','min_qty','max_qty','safety_qty','fefo_required','expiry_warning_days','status','created_by','created_at','updated_at'],
    CAPACITY_PLANS: ['capacity_plan_id','organization_id','location_id','date_from','date_to','workshop_id','available_hours','planned_hours','planned_qty','status','created_by','created_at','updated_at'],
    SCENARIOS: ['scenario_id','organization_id','location_id','name','date_from','date_to','status','assumptions_json','created_by','created_at','updated_at'],
    EXECUTION_PLANS: ['execution_plan_id','organization_id','location_id','date_from','date_to','name','status','owner_id','created_by','created_at','updated_at'],
    EXECUTION_ITEMS: ['item_id','execution_plan_id','organization_id','location_id','source_type','source_id','title','priority','owner_role','owner_id','due_at','status','dependency_json','evidence_json','created_by','created_at','completed_at'],
    SHIFT_PLANS: ['shift_plan_id','organization_id','location_id','date','shift_code','workshop_id','planned_hours','status','owner_id','created_by','created_at'],
    SHIFT_ASSIGNMENTS: ['assignment_id','shift_plan_id','organization_id','location_id','employee_id','role','planned_hours','status','created_by','created_at'],
    PRODUCTION_CALENDARS: ['calendar_id','organization_id','location_id','date_from','date_to','name','status','created_by','created_at'],
    PRODUCTION_CALENDAR_ITEMS: ['item_id','calendar_id','organization_id','location_id','date','workshop_id','production_plan_id','planned_qty','priority','status','created_by','created_at'],
    DEMAND_SENSING_PLANS: ['demand_sensing_id','organization_id','location_id','as_of','horizon_days','status','forecast_json','created_by','created_at'],
    MRP_RUNS: ['mrp_run_id','organization_id','location_id','as_of','horizon_days','status','lines_json','created_by','created_at'],
    CUSTOMER_CHANNEL_ANALYTICS: ['analytics_id','organization_id','location_id','date_from','date_to','channel','orders','qty','revenue','cost','gross_margin','margin_pct','created_at'],
    CHANNEL_MARGIN_SNAPSHOTS: ['snapshot_id','organization_id','location_id','date_from','date_to','channel','revenue_share','contribution','contribution_pct','service_cost','created_at'],
    LABOR_FORECASTS: ['labor_forecast_id','organization_id','location_id','as_of','horizon_days','forecast_output_qty','hours_per_unit','forecast_labor_hours','source_plan_id','created_by','created_at'],
    DIGITAL_TWIN_V2_SNAPSHOTS: ['snapshot_id','organization_id','location_id','status','generated_at','forecast_json','alerts_json','created_by','created_at'],
    PLANNING_RUNS: ['planning_run_id','organization_id','location_id','date_from','date_to','horizon_days','status','proposal_hash','summary_json','created_by','created_at'],
    PLANNING_PROPOSALS: ['proposal_id','planning_run_id','organization_id','location_id','type','entity_type','entity_id','qty','priority','reason','status','approval_gate_id','created_by','created_at'],
    APPROVAL_GATES: ['approval_gate_id','organization_id','location_id','planning_run_id','proposal_hash','proposal_count','status','requested_by','requested_at','approved_by','approved_at','rejected_by','rejected_at','reason'],
    EXECUTION_OUTCOMES: ['outcome_id','proposal_id','approval_gate_id','organization_id','location_id','status','actual_qty','actual_cost','reference_type','reference_id','evidence_json','recorded_by','recorded_at'],
    EXECUTION_REQUESTS: ['execution_request_id','proposal_id','approval_gate_id','organization_id','location_id','status','preflight_json','preflight_hash','request_fingerprint','execution_nonce','nonce_expires_at','requested_by','requested_at','executed_by','executed_at','reference_type','reference_id','error_message'],
    COMPLIANCE_CONTROLS: ['control_id','organization_id','location_id','code','title','requirement','category','owner_role','frequency','status','source','version','created_by','created_at','updated_at'],
    COMPLIANCE_CONTROL_LINKS: ['link_id','control_id','organization_id','location_id','link_type','source_type','source_id','source_code','status','note','evidence_json','created_by','created_at'],

    // Внешний P0-аудит — durable backing store сессии (см. пояснение у CONFIG.SHEETS.SESSIONS
    // и докстринг Auth.gs). token — уже глобально уникальный UUID, используется как
    // первичный ключ напрямую (без отдельного generateId_/ID_PREFIXES) — так же, как
    // и раньше служил ключом кэша 'session_'+token. allowed_locations хранится как
    // CSV-строка (как USERS.location_ids) — Auth.gs разбирает её обратно в массив при
    // восстановлении из этого листа (cache miss).
    CORE100_EVENTS: ['event_id','organization_id','location_id','event_type','aggregate_type','aggregate_id','payload_json','source','occurred_at','created_by'],
    CORE100_WORKFLOWS: ['workflow_id','organization_id','location_id','workflow_type','source_type','source_id','status','steps_json','owner_id','created_by','created_at','updated_at'],
    CORE100_UAT_RUNS: ['uat_run_id','organization_id','location_id','environment','status','checks_json','started_at','completed_at','created_by'],
    CORE100_DEPLOY_EVIDENCE: ['evidence_id','organization_id','location_id','evidence_type','payload_json','payload_hash','created_by','created_at'],
    CORE100_GO_LIVE_GATES: ['gate_id','organization_id','location_id','status','criteria_json','health_json','dr_json','uat_json','created_by','created_at'],
    SESSIONS: ['token', 'user_id', 'organization_id', 'роль', 'location_id',
      'allowed_locations', 'expires', 'revoked', 'created_at'],

    // Модуль «Касса» (Pos.gs). Деньги — рубли с round2_, как во всём ЦЕХ.
    // POS_SHIFTS.статус: открыта | закрыта (не более одной открытой на точку).
    POS_SHIFTS: ['shift_id','organization_id','location_id','кассир_id','открыта','закрыта',
      'нал_начало','нал_конец_факт','итог_нал','итог_карта','итог_прочее',
      'заказов','возвратов_сумма','статус','cascade_id',
      // M5 (новые колонки — только в конец: insertRow_ пишет в порядке схемы, migratePosSchema_ дописывает заголовки).
      'cash_ids'],
    // POS_ORDERS.статус: открыт | пречек | оплачен | отменён | возврат; version — защита
    // от одновременной правки одного заказа с двух устройств.
    POS_ORDERS: ['order_id','organization_id','location_id','shift_id','table_id','официант_id',
      'номер','гостей','статус','сумма','скидка','итого','комментарий',
      'version','создано','обновлено','оплачен','cascade_id',
      'возвращено',
      // M6
      'guest_id','бонусы_списано','бонусы_начислено'],
    // POS_ORDER_LINES.статус: новая | на_кухне | готово | отменена | возврат.
    POS_ORDER_LINES: ['line_id','order_id','organization_id','dish_id','название_снимок','qty',
      'цена','модификаторы_json','сумма','статус','на_кухню_в','sale_ids','создано','готово_в',
      'возврат_в'],
    // тип: оплата | возврат (у возврата сумма отрицательная — итоги смены считаются как сумма строк).
    POS_PAYMENTS: ['payment_id','order_id','organization_id','location_id','shift_id','способ',
      'сумма','operation_id','создано','user_id',
      'тип','причина'],
    // Залы и столы точки. Занятость стола не хранится — считается из открытых заказов смены.
    POS_HALLS: ['hall_id','organization_id','location_id','название','порядок','статус','создано'],
    POS_TABLES: ['table_id','organization_id','location_id','hall_id','название','мест','порядок','статус','создано'],
    // Модификаторы — общие для организации. Группа: сколько можно выбрать (мин..макс).
    MODIFIER_GROUPS: ['group_id','organization_id','название','мин','макс','статус','создано'],
    // цена_delta может быть отрицательной (например, «маленькая порция»). product_id/расход_qty —
    // необязательно: продукт списывается со склада при исполнении продажи.
    MODIFIERS: ['modifier_id','organization_id','group_id','название','цена_delta','product_id','расход_qty','единица','порядок','статус','создано'],
    // Связь блюдо ↔ группа. Отвязка — статус «архив», строки не удаляются (как везде в ЦЕХ).
    DISH_MODIFIER_LINKS: ['link_id','organization_id','dish_id','group_id','порядок','статус'],
    // Расход продуктов модификаторов по оплаченным позициям. статус: ожидает | списано | ошибка.
    POS_MODIFIER_USAGE: ['usage_id','organization_id','location_id','order_id','line_id','sale_id','modifier_id','product_id',
      'qty','единица','статус','ошибка','создано','списано_в','cascade_id'],
    // Стоп-лист точки. Активен, пока «снято» пусто. источник: ручной | авто_остатки.
    // Авто-стопы ставит и снимает пересчёт по остаткам; ручные — только человек.
    STOP_LIST: ['stop_id','organization_id','location_id','dish_id','причина','источник','создано','user_id','снято','снял_id'],
    // Волна 3, M9 — заготовочный лист: нормы запаса ПФ на начало смены и лист на дату.
    PREP_PARS: ['par_id','organization_id','location_id','pf_id','норма','статус','обновлено','user_id'],
    PREP_LISTS: ['prep_id','organization_id','location_id','дата','pf_id','название','единица','прогноз','норма','остаток','к_заготовке','сделано','статус','production_id','user_id','обновлено'],
    // Гости (персональные данные, 152-ФЗ): создаются только с согласием (дата в согласие_пд).
    // телефон — +7XXXXXXXXXX, уникален в организации. бонусы — кэш баланса, источник правды — BONUS_TXNS.
    GUESTS: ['guest_id','organization_id','телефон','имя','день_рождения','согласие_пд','бонусы','всего_оплачено','визитов',
      'последний_визит','статус','создано','комментарий','user_id'],
    // тип: начисление | списание | отмена_начисления | возврат_списания | корректировка. сумма со знаком.
    BONUS_TXNS: ['txn_id','organization_id','guest_id','order_id','тип','сумма','остаток_после','создано','user_id','причина'],
    // Одна строка на сотрудника. ЦЕХ деньги не принимает — только показывает QR на страницу сервиса чаевых.
    POS_TIP_LINKS: ['tip_id','user_id','organization_id','ссылка','сервис','обновлено','обновил_id'],
    // Одна строка на точку. token — случайный ключ в ссылке QR (?m=token), json — готовый снимок меню
    // без цен закупки, себестоимости и данных сотрудников. Публичный проект читает только этот лист.
    PUBLIC_MENU: ['menu_id','organization_id','location_id','token','json','обновлено','включено']
  },

  // Префиксы ID (ТЗ §28 — никогда не использовать название объекта как ключ)
  ID_PREFIXES: {
    POS_SHIFTS: 'PSH', POS_ORDERS: 'PORD', POS_ORDER_LINES: 'POL', POS_PAYMENTS: 'PPAY', POS_HALLS: 'PHALL', POS_TABLES: 'PTBL',
    MODIFIER_GROUPS: 'MODG', MODIFIERS: 'MOD', DISH_MODIFIER_LINKS: 'DML', POS_MODIFIER_USAGE: 'PMU', STOP_LIST: 'STOP', PREP_PARS: 'PPAR', PREP_LISTS: 'PREP',
    GUESTS: 'GST', BONUS_TXNS: 'BTX', POS_TIP_LINKS: 'PTIP', PUBLIC_MENU: 'PMENU',
    ORGANIZATIONS: 'ORG', LOCATIONS: 'LOC', USERS: 'USR',
    PRODUCTS: 'PROD', PRICE_HISTORY: 'PRH', DISHES: 'DISH', SEMI_FINISHED: 'PF',
    RECIPES: 'REC', TECH_CARDS: 'TTK', TTK_VERSIONS: 'TTKV', TTK_HACCP_LINKS: 'THL', TTK_SANPIN_LINKS: 'TSL',
    WAREHOUSE_OPS: 'WOP', BATCHES: 'BATCH', MARKINGS: 'MRK', MARKING_JOURNAL: 'MRKJ', LABEL_PRINT_JOBS: 'LPJ', LABEL_PRINT_ITEMS: 'LPI',
    PRODUCTION: 'PRD', PRODUCTION_INGREDIENT_USAGE: 'PIU', SALE_INGREDIENT_USAGE: 'SIU', WASTE_RECORDS: 'WST', DEFECTS: 'DEF',
    WRITE_OFFS: 'WR', PURCHASE_REQUESTS: 'REQ', BUDGET_PLANS: 'BUD', CASH_TRANSACTIONS: 'CASH', AUTOMATION_DECISIONS: 'AUTO', AUTOMATION_RULES: 'ARULE', AUTOMATION_EVENT_DISPATCH: 'AED', AUTOMATION_WORKFLOWS: 'AWF', AUTOMATION_WORKFLOW_STEPS: 'AWFS', CONFIGURATION_VERSIONS: 'CFG', CONFIGURATION_VALUES: 'CFGV', MASTER_DATA_REGISTRY: 'MD', MASTER_DATA_ALIASES: 'MDA', DATA_RECONCILIATIONS: 'DQR', TRACEABILITY_RUNS: 'TRUN', TRACEABILITY_FINDINGS: 'TFND', PERIOD_CLOSURES: 'PCLOSE', PERIOD_CLOSURE_FINDINGS: 'PCF', PERIOD_REOPEN_REQUESTS: 'PRR', AUDIT_EVIDENCE_VAULT: 'AEV', AUDIT_EVIDENCE_CHECKPOINTS: 'AEC', COMPLIANCE_EVIDENCE_PACKS: 'EPK', COMPLIANCE_EVIDENCE_ITEMS: 'EPI', CAPA_CASES: 'CAPA', CAPA_ACTIONS: 'CAPAA', CAPA_VERIFICATIONS: 'CAPAV', BOARD_PACKS: 'BPK', KPI_TARGETS: 'KPI', KPI_VARIANCES: 'KPIV', KPI_ACTIONS: 'KPIA', COMPLIANCE_CONTROLS: 'CTRL', COMPLIANCE_CONTROL_LINKS: 'CLNK', MANAGEMENT_ACTION_BACKLOG: 'MAB', WORKFORCE_PLANS: 'WFP', SUPPLIER_SCORECARDS: 'SSC', PROCUREMENT_ACTIONS: 'PRA', INVENTORY_POLICIES: 'INVP', CAPACITY_PLANS: 'CAPP', SCENARIOS: 'SCN', EXECUTION_PLANS: 'EXPL', EXECUTION_ITEMS: 'EXI', SHIFT_PLANS: 'SHP', SHIFT_ASSIGNMENTS: 'SHA', PRODUCTION_CALENDARS: 'PCAL', PRODUCTION_CALENDAR_ITEMS: 'PCALI', DEMAND_SENSING_PLANS: 'DSEN', MRP_RUNS: 'MRP', CUSTOMER_CHANNEL_ANALYTICS: 'CCA', CHANNEL_MARGIN_SNAPSHOTS: 'CMS', LABOR_FORECASTS: 'LFR', DIGITAL_TWIN_V2_SNAPSHOTS: 'DTV2', PLANNING_RUNS: 'PLANRUN', PLANNING_PROPOSALS: 'PLANPROP', APPROVAL_GATES: 'APG', EXECUTION_OUTCOMES: 'EXOUT', EXECUTION_REQUESTS: 'EXREQ',
    INVENTORIES: 'INV', INVENTORY_LINES: 'INVL',
    JOURNALS: 'JRN', AUTO_JOURNAL_PENDING: 'AJP',
    JOURNAL_DEFINITIONS: 'JDEF', JOURNAL_DEVIATIONS: 'DEV', CORRECTIVE_ACTIONS: 'CACT',
    CALCULATIONS: 'CALC', REPORTS: 'RPT',
    AUDIT_LOG: 'LOG', SYSTEM_ERRORS: 'ERR', SUPPLIERS: 'SUP',
    CATEGORIES: 'CAT', UNITS: 'UNIT', PRODUCT_MATRIX: 'MTX',
    ROLES: 'ROLE', WRITEOFF_REASONS: 'WRR', SYSTEM_LOG: 'SLOG',
    NOTIFICATIONS: 'NOTIF', NOTIFICATION_SETTINGS: 'NSET', NOTIFICATION_LOG: 'NLOG', BACKUPS: 'BKP',
    WORKSHOPS: 'WS', EQUIPMENT: 'EQ',
    PLAN_MENU_EVENTS: 'EVT', PLAN_MENU_ITEMS: 'EVI',
    OPERATIONS: 'OP', CASCADES: 'CSC', OPERATION_STEPS: 'OPS',
    TASKS: 'TASK',
    EVENTS: 'EVT2', // EVT уже занят PLAN_MENU_EVENTS выше — не переиспользуем чужой префикс
    LAB_TESTS: 'LABT', LAB_TEST_DEFINITIONS: 'LABD',
    PPK_VERSIONS: 'PPK',
    PPK_PROCESSES: 'PPKPR', PPK_FLOW_STAGES: 'PPKFS', PPK_FLOWS: 'PPKFL', HAZARD_ANALYSIS: 'PPKHA', PPK_CONTROLS: 'PPKCT', PPK_CRITICAL_LIMITS: 'PPKCL', PPK_VERIFICATION: 'PPKVR', PPK_REVIEW_REQUESTS: 'PPKRR', PPK_DOCUMENTS: 'PPKDOC',
    RULES: 'RULE',
    INTEGRATIONS: 'INTG', INTEGRATION_MAPPINGS: 'IMAP',
    GLOBAL_PRODUCTS: 'GPROD', PRODUCT_ALLERGENS: 'PALG', PRODUCT_SHELF_LIFE: 'PSHL',
    PRODUCT_SPOILAGE_SIGNS: 'PSPL', PRODUCT_DATA_VERSIONS: 'PVER',
    DECLARATIONS: 'DECL', DECLARATION_PRODUCTS: 'DPRD', SUPPLIER_DOCUMENTS: 'SDOC',
    PRODUCT_COMPLIANCE_PROFILES: 'PCPR', REGULATORY_SOURCES: 'RSRC', OCR_RESULTS: 'OCRR',
    PRODUCT_IMPORT_BATCHES: 'PIMP', PRODUCT_IMPORT_ROWS: 'PIMR',
    SALES: 'SALE', SALES_IMPORT_BATCHES: 'SIMP', SALES_IMPORT_ROWS: 'SIMR',
    EQUIPMENT_MAINTENANCE_LOG: 'EQML',
    EXPENSES: 'EXP', INVOICE_INTAKE_DRAFTS:'RID', INVOICE_DOCUMENTS:'RDO', HACCP_DECISIONS:'HDEC', OFFLINE_QUEUE:'OFFQ', PF_QUALITY_RELEASES:'PFQR', HACCP_EVIDENCE:'HACEV', PRODUCTION_YIELD_DEVIATIONS:'PYD', RECALL_CASES:'RCL', RECALL_BLOCKS:'RBL', PRODUCTION_PLANS:'PPLN', PRODUCTION_PLAN_LINES:'PPLL', PRODUCTION_DISPATCH_CONFIG:'PDCF', PRODUCTION_DISPATCH_PLANS:'PDPLN', PRODUCTION_DISPATCH_LINES:'PDPLL', DEMAND_PLANS:'DPLAN', DEMAND_PLAN_DISH_LINES:'DDISH', DEMAND_PLAN_PRODUCT_LINES:'DPROD', PPK_INSPECTION_PACKETS:'PPKIP', BREAKDOWN_PLANS:'BPLAN', BREAKDOWN_PLAN_OUTPUTS:'BPOUT', BREAKDOWN_PLAN_STEPS:'BSTEP', BREAKDOWN_ACTS:'BACT', BREAKDOWN_ACT_LINES:'BLINE', BREAKDOWN_TASKS:'BTASK', POSITIONS:'POS', EMPLOYEE_EQUIPMENT_PERMISSIONS:'EEPERM', P22_ERRORS: 'P22ERR', P22_RECOVERY: 'P22REC', P21_JOURNAL_LINKS: 'P21LNK', CRITICAL_INCIDENTS:'CINC', QUARANTINE_CASES:'QUAR', SAFETY_DOCUMENTS:'SAFDOC', SAFETY_BRIEFING_TYPES:'SAFTYPE', SAFETY_REQUIREMENTS_MATRIX:'SAFREQ', SAFETY_EMPLOYEE_CONTEXT:'SAFCTX', SAFETY_BRIEFING_ASSIGNMENTS:'SAFASN', SAFETY_BRIEFING_LOG:'SAFLOG', SAFETY_TESTS:'SAFTEST', SAFETY_TEST_QUESTIONS:'SAFQ', SAFETY_TEST_ATTEMPTS:'SAFATT', SAFETY_CONFIRMATIONS:'SAFCONF', SAFETY_QR:'SAFQR', CORE100_EVENTS:'C100EV', CORE100_WORKFLOWS:'C100WF', CORE100_UAT_RUNS:'C100UAT', CORE100_DEPLOY_EVIDENCE:'C100EVD', CORE100_GO_LIVE_GATES:'C100GL'
  },

  // P0.2 (ТЗ §17) — единый перечень кодов ошибок ответа processOperation(). Текст
  // сообщения (error) как показывался человеку по-русски, так и продолжает
  // показываться без изменений (см. humanizeError_) — error_code добавлен РЯДОМ,
  // для фронтенда/интеграций, которым нужно различать типы ошибок программно, а не
  // парсить русский текст.
  ERROR_CODES: {
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',
    FORBIDDEN_SCOPE: 'FORBIDDEN_SCOPE',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    NOT_FOUND: 'NOT_FOUND',
    DUPLICATE_OPERATION: 'DUPLICATE_OPERATION',
    CONFLICT: 'CONFLICT',
    LOCK_TIMEOUT: 'LOCK_TIMEOUT',
    CASCADE_FAILED: 'CASCADE_FAILED',
    RECOVERY_REQUIRED: 'RECOVERY_REQUIRED',
    IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
    INTERNAL_ERROR: 'INTERNAL_ERROR'
  },

  // ТЗ §21 — типы уведомлений
  NOTIFICATION_TYPES: {
    CRITICAL_STOCK: 'критический_остаток',
    OVERDUE_TASK: 'просроченная_задача',
    LARGE_SHORTAGE: 'большая_недостача',
    WRITEOFF_SPIKE: 'превышение_списаний',
    FOODCOST_DEVIATION: 'отклонение_food_cost',
    OPEN_INVENTORY: 'незакрытая_инвентаризация',
    OVERDUE_REQUEST: 'просроченная_заявка',
    SYSTEM_ERROR: 'ошибка_системы',
    AUTOMATION_EVENT: 'AUTOMATION_EVENT',
    JOURNAL_DEVIATION: 'критическое_отклонение_журнала',
    // P0.6 — найдено при аудите: до этого раунда уровень "предупреждение" в
    // _evaluateJournalValue_ (Journals.gs) отправлял уведомление С ТИПОМ
    // 'критическое_отклонение_журнала' (тем же, что и настоящее критическое) — код
    // буквально выбирал ОДИН И ТОТ ЖЕ тип в обеих ветках тернарного оператора. Отдельный
    // тип нужен, чтобы получатели/маршрутизация (DEFAULT_RECIPIENTS ниже,
    // NOTIFICATION_SETTINGS) могли настраиваться раздельно для "стоит присмотреться" и
    // "точно нарушение регламента, сейчас" — раньше это технически было невозможно.
    JOURNAL_DEVIATION_WARNING: 'предупреждение_отклонение_журнала',
    JOURNAL_OVERDUE: 'просроченный_журнал',
    EXPIRING_BATCH: 'истекает_срок_партии',

    // Секондарные фичи, раунд 3 (Архитектура v4 §8) — Лабораторный модуль v2.
    LAB_RESULT_FAILED: 'провал_лабораторного_теста',
    LAB_TEST_OVERDUE: 'просрочен_лабораторный_отбор',

    // Секондарные фичи, раунд 4 (Архитектура v4 §7) — версионирование ППК.
    PPK_SUBMITTED_FOR_REVIEW: 'ппк_на_утверждении',

    // Раунд 8 (ТЗ §18) — многоступенчатые напоминания об истечении декларации.
    // Периоды НАСТРАИВАЕМЫЕ (Compliance.gs::DECLARATION_EXPIRY_THRESHOLDS_DAYS),
    // здесь — только словарь типов уведомлений под каждый порог.
    DECLARATION_EXPIRING_90: 'декларация_истекает_90',
    DECLARATION_EXPIRING_60: 'декларация_истекает_60',
    DECLARATION_EXPIRING_30: 'декларация_истекает_30',
    DECLARATION_EXPIRING_14: 'декларация_истекает_14',
    DECLARATION_EXPIRING_7: 'декларация_истекает_7',
    DECLARATION_EXPIRING_TODAY: 'декларация_истекает_сегодня',
    DECLARATION_EXPIRED: 'декларация_истекла',
    CASH_FLOW_RISK: 'cash_flow_risk',
    CONTROL_TOWER: 'CONTROL_TOWER',
    SAFETY_ASSIGNED: 'SAFETY_INSTRUCTION_ASSIGNED', SAFETY_DUE: 'SAFETY_BRIEFING_DUE', SAFETY_EXPIRED: 'SAFETY_BRIEFING_EXPIRED', SAFETY_TEST_FAILED: 'SAFETY_TEST_FAILED', SAFETY_REPEAT: 'SAFETY_BRIEFING_REASSIGNED'
  },

  // ТЗ §21 — кто получает какой тип уведомления по умолчанию (преднастройка,
  // администратор переопределяет через NOTIFICATION_SETTINGS.recipients)
  DEFAULT_RECIPIENTS: {
    'критическое_отклонение_журнала': ['ШЕФ-ПОВАР', 'ДИРЕКТОР'],
    // P0.6 — новый тип (см. NOTIFICATION_TYPES выше): предупреждение НЕ поднимается до
    // ДИРЕКТОРА по умолчанию, в отличие от настоящего критического отклонения — это
    // осознанная разница в маршрутизации, не техническая недоработка.
    'предупреждение_отклонение_журнала': ['ШЕФ-ПОВАР'],
    'просроченный_журнал': ['ПОВАР', 'ШЕФ-ПОВАР'],
    'критический_остаток': ['ШЕФ-ПОВАР', 'КЛАДОВЩИК'],
    'отклонение_food_cost': ['ШЕФ-ПОВАР', 'КАЛЬКУЛЯТОР'],
    'истекает_срок_партии': ['ШЕФ-ПОВАР', 'КЛАДОВЩИК'],
    'ошибка_системы': ['ADMIN'],
    // Секондарные фичи, раунд 3 — провал лаб. теста поднимается до ДИРЕКТОРА сразу
    // (та же логика маршрутизации, что и у настоящего критического отклонения журнала —
    // ХАССП-значимое событие), просрочка планового отбора — только до исполнителей.
    'провал_лабораторного_теста': ['ШЕФ-ПОВАР', 'ДИРЕКТОР'],
    'просрочен_лабораторный_отбор': ['ШЕФ-ПОВАР', 'ЛАБОРАНТ'],
    // Секондарные фичи, раунд 4 — версия ППК на утверждении идёт ТОЛЬКО ДИРЕКТОРУ (тот
    // же круг, кто и утверждает — см. ROLE_MODULES['ppk'] ниже).
    'ппк_на_утверждении': ['ДИРЕКТОР'],
    'cash_flow_risk': ['ДИРЕКТОР', 'БУХГАЛТЕР'],
    'CONTROL_TOWER': ['ДИРЕКТОР', 'ШЕФ-ПОВАР', 'МЕНЕДЖЕР'],
    'SAFETY_INSTRUCTION_ASSIGNED': ['ПОВАР','ШЕФ-ПОВАР','КЛАДОВЩИК','МЕНЕДЖЕР'],
    'SAFETY_BRIEFING_DUE': ['ШЕФ-ПОВАР','МЕНЕДЖЕР','ДИРЕКТОР'],
    'SAFETY_BRIEFING_EXPIRED': ['ШЕФ-ПОВАР','МЕНЕДЖЕР','ДИРЕКТОР'],
    'SAFETY_TEST_FAILED': ['ШЕФ-ПОВАР','МЕНЕДЖЕР','ДИРЕКТОР'],
    'SAFETY_BRIEFING_REASSIGNED': ['ШЕФ-ПОВАР','МЕНЕДЖЕР','ДИРЕКТОР']
  },

  // ТЗ §27/§62 — карта "какое действие какому модулю разрешено" (fail-closed).
  // Немаркированное действие ЗАПРЕЩЕНО по умолчанию.
  // v2: warehouse разделён на warehouse_view/warehouse_receive — шеф-повар видит
  // склад, но не может создавать/менять накладные прихода (ТЗ §7/§31, ошибка №1 из §61).
  ACTION_MODULE: {
    // Модуль «Касса» (Pos.gs). pos — касса, pos_shift — смена, pos_admin — отмены и сервис.
    POS_GET_MENU: 'pos', POS_GET_SHIFT: 'pos', POS_CREATE_ORDER: 'pos', POS_ADD_LINE: 'pos', POS_UPDATE_LINE: 'pos',
    POS_GET_ORDER: 'pos', POS_GET_ORDERS: 'pos', POS_PAY: 'pos',
    POS_OPEN_SHIFT: 'pos_shift', POS_CLOSE_SHIFT: 'pos_shift',
    POS_CANCEL_ORDER: 'pos_admin', POS_FULFILL_PENDING: 'pos_admin',
    // Этап M2: зал, официант, кухня.
    POS_GET_FLOOR: 'pos', POS_SEND_TO_KITCHEN: 'pos', POS_PRECHECK: 'pos', POS_MOVE_ORDER: 'pos',
    POS_REOPEN_ORDER: 'pos_admin', POS_SAVE_HALL: 'pos_admin', POS_SAVE_TABLE: 'pos_admin',
    POS_GET_KITCHEN_QUEUE: 'pos_kitchen', POS_MARK_LINE_READY: 'pos_kitchen',
    // Этап M3: модификаторы.
    POS_GET_MODIFIERS: 'pos_admin', POS_SAVE_MODIFIER_GROUP: 'pos_admin', POS_SAVE_MODIFIER: 'pos_admin', POS_LINK_DISH_MODIFIERS: 'pos_admin',
    // Этап M4: стоп-лист — ведут кухня и менеджмент (pos_stop); кассир видит стопы в меню кассы.
    PREP_GET_LIST: 'production', PREP_BUILD_LIST: 'production', PREP_MARK_DONE: 'production', PREP_SKIP: 'production', PREP_GET_PARS: 'production', PREP_SAVE_PAR: 'production',
    POS_GET_STOP_LIST: 'pos_stop', POS_SET_STOP: 'pos_stop', POS_CLEAR_STOP: 'pos_stop', POS_RECALC_STOP_LIST: 'pos_stop',
    // Этап M5: возвраты и отчёт по сотрудникам — менеджмент.
    POS_REFUND: 'pos_admin', POS_GET_STAFF_REPORT: 'pos_admin', POS_GET_SHIFTS: 'pos_admin',
    // Этап M6: гости и бонусы. Найти/завести/привязать гостя — касса и официант; список, корректировки,
    // обезличивание и правила программы — менеджмент.
    POS_FIND_GUEST: 'pos', POS_SAVE_GUEST: 'pos', POS_ATTACH_GUEST: 'pos', POS_GET_GUEST: 'pos',
    POS_GET_GUESTS: 'pos_admin', POS_ADJUST_BONUS: 'pos_admin', POS_ANONYMIZE_GUEST: 'pos_admin',
    POS_GET_LOYALTY_SETTINGS: 'pos', POS_SAVE_LOYALTY_SETTINGS: 'pos_admin',
    // Этап M7: чаевые. Свою ссылку задаёт сам сотрудник; чужие — менеджмент (проверка в Pos.gs).
    POS_GET_TIP_LINKS: 'pos', POS_SAVE_TIP_LINK: 'pos',
    // Этап M8: QR-меню — публикация и QR столов у менеджмента.
    POS_GET_QRMENU: 'pos_admin', POS_PUBLISH_QRMENU: 'pos_admin', POS_SAVE_QRMENU_SETTINGS: 'pos_admin',
    // Убрать пустой (без позиций) заказ — может тот, кто его открыл; заказ с позициями отменяет только менеджмент.
    POS_DISCARD_EMPTY_ORDER: 'pos',
    LOGIN: 'auth', GET_SESSION: 'auth', SELECT_LOCATION: 'auth', LOGOUT: 'auth',

    CREATE_USER: 'users', CREATE_POSITION:'users', GET_POSITIONS:'users', UPDATE_POSITION:'users', UPDATE_EMPLOYEE_PROFILE:'users', TRANSFER_EMPLOYEE:'users', GET_EMPLOYEE_READINESS:'safety', GET_EMPLOYEE_EQUIPMENT_PERMISSIONS:'safety', CHECK_EMPLOYEE_OPERATION_SAFETY:'safety', CHANGE_PIN: 'users', RESET_PIN: 'users',
    DEACTIVATE_USER: 'users', ACTIVATE_USER: 'users', GET_USERS: 'users',

    GET_ORGANIZATIONS: 'organizations', CREATE_ORGANIZATION: 'organizations',
    // Раунд 9 — НАЙДЕНО при постройке интерфейса «Сотрудники»: GET_LOCATIONS/CREATE_LOCATION
    // сидели в ТОМ ЖЕ модуле 'organizations', что и GET_ORGANIZATIONS/CREATE_ORGANIZATION —
    // платформенно-уровневые действия (список/создание АРЕНДАТОРОВ), которые сознательно
    // забрали у ДИРЕКТОРА раньше (см. комментарий "ТЗ P0.1" ниже). Но getLocations_/
    // createLocation_ УЖЕ фильтруются по organization_id (Organizations.gs) — межарендаторской
    // утечки в них никогда не было, в отличие от старой getOrganizations_. Итог: страховка от
    // одной реальной уязвимости (organizations) заодно тихо забрала у ДИРЕКТОРА (и у
    // КЛАДОВЩИКА для перемещения между точками) возможность вообще увидеть список точек СВОЕЙ
    // организации — блокируя, например, форму создания сотрудника (нужно выбрать точку) и
    // форму межточечного перемещения остатков. Разделено на отдельный модуль 'locations' —
    // безопасный (org-scoped) сам по себе, выдан явно только тем ролям, кому нужен (см.
    // ROLE_MODULES ниже), 'organizations' по-прежнему только у ADMIN.
    GET_LOCATIONS: 'locations', CREATE_LOCATION: 'locations',

    GET_BACKUPS: 'backup', CREATE_BACKUP: 'backup',

    GET_DEVIATIONS: 'journals', COMPLETE_CORRECTIVE_ACTION: 'journals',

    GENERATE_PLAN_MENU_PURCHASE_REQUESTS: 'plan_menu', UPDATE_PLAN_MENU_GUESTS: 'plan_menu',
    GET_WORKSHOP_COLOR_PRESET: 'workshops_use',

    GET_DASHBOARD: 'dashboard',
    GET_CONTROL_TOWER: 'dashboard',
    GET_PRODUCTS: 'products', CREATE_PRODUCT: 'products', UPDATE_PRODUCT_PRICE: 'products', GET_PRICE_HISTORY: 'products', GET_PRICE_CASCADE: 'economics',
    GET_ANALYTICS_DASHBOARD: 'economics', GET_DISH_ANALYTICS: 'economics', GET_PRODUCT_ANALYTICS: 'economics', GET_DISH_ANALYTICS_DETAIL: 'economics', GET_PRODUCT_ANALYTICS_DETAIL: 'economics',
    GET_RECIPES: 'recipes', UPDATE_RECIPE: 'recipes', CREATE_DISH: 'recipes', UPDATE_DISH: 'recipes', ADD_RECIPE_LINE: 'recipes',
    // P0.4 — CREATE_TECH_CARD/GET_TECH_CARDS: функции существовали (FoodCost.gs), но не
    // были размечены ни в одном модуле — действие было физически недостижимо через API.
    CREATE_TECH_CARD: 'recipes', GET_TECH_CARDS: 'recipes',
    CREATE_TTK_VERSION: 'recipes', GET_TTK_VERSIONS: 'recipes', GET_TTK_CONTEXT: 'recipes', GET_TTK_EDITOR_CONTEXT: 'recipes', UPDATE_TTK_DRAFT: 'recipes', SUBMIT_TTK_FOR_APPROVAL: 'recipes', APPROVE_TTK_VERSION: 'recipes', CREATE_TTK_HACCP_LINK: 'ppk', CREATE_TTK_SANPIN_LINK: 'ppk',
    CREATE_BREAKDOWN_PLAN: 'recipes', GET_BREAKDOWN_PLANS: 'recipes', APPROVE_BREAKDOWN_PLAN: 'recipes', GET_BREAKDOWN_TASKS: 'production', START_BREAKDOWN_ACT: 'production', COMPLETE_BREAKDOWN_ACT: 'production', GET_BREAKDOWN_TRACE: 'journals', CREATE_BREAKDOWN_PLAN_STEP: 'recipes', GET_BREAKDOWN_PLAN_MAP: 'recipes',
    // Раунд 9 — тот же класс восполненного пробела: GET_DISHES/CREATE_SEMI_FINISHED/
    // GET_SEMI_FINISHED существовали как функции (или не существовали вовсе), но не были
    // подключены к системе прав ни разу до постройки интерфейса «Рецепты/Тех.карты».
    GET_DISHES: 'recipes', CREATE_SEMI_FINISHED: 'recipes', GET_SEMI_FINISHED: 'recipes',

    GET_WAREHOUSE: 'warehouse_view',
    RECEIVE_GOODS: 'warehouse_receive', RECEIVE_GOODS_BATCH: 'warehouse_receive',
    RUN_PRODUCT_LABEL_OCR: 'warehouse_receive', CREATE_PRODUCT_FROM_OCR: 'warehouse_receive', MATCH_PRODUCT_FROM_LABEL: 'warehouse_receive',
    // P0.3, новое — TRANSFER_STOCK. Тот же модуль, что и приход: перемещение так же
    // меняет остаток на двух точках сразу, как и приход меняет остаток на одной —
    // роли без warehouse_receive (например, ШЕФ-ПОВАР) намеренно тоже не могут его
    // делать, тем же обоснованием, что уже есть для warehouse_receive (ТЗ §7/§31).
    TRANSFER_STOCK: 'warehouse_receive',
    FIND_PRODUCT_BY_BARCODE: 'warehouse_view',

    CREATE_WRITEOFF: 'writeoffs', GET_WRITEOFFS: 'writeoffs',
    CREATE_PURCHASE_REQUEST: 'purchasing', GET_PURCHASE_REQUESTS: 'purchasing', UPDATE_PURCHASE_REQUEST_STATUS: 'purchasing',
    CREATE_PRODUCTION_TASK: 'production', ADVANCE_PRODUCTION: 'production', GET_PRODUCTION: 'production', GET_PRODUCTION_WASTE: 'journals', GET_WASTE_TRACE: 'journals',
    GET_PRODUCTION_DISPATCHER: 'production', DISPATCH_PRODUCTION_TASK: 'production', RECORD_PRODUCTION_YIELD_DEVIATION: 'production', GET_PRODUCTION_YIELD_DEVIATIONS: 'production',
    GET_SEMI_FINISHED_PASSPORT: 'recipes', CREATE_RECALL_CASE: 'warehouse_receive', CLOSE_RECALL_CASE: 'warehouse_receive', GET_RECALL_CASE: 'warehouse_view',
    GET_HACCP_EVIDENCE: 'ppk', CAPTURE_HACCP_EVIDENCE: 'ppk', GET_ACTUAL_COST_TRACE: 'economics', GET_BATCH_COST_TRACE: 'warehouse_view',
    CREATE_PRODUCTION_PLAN: 'production', GET_PRODUCTION_PLAN: 'production', APPROVE_PRODUCTION_PLAN: 'production', GET_MOBILE_PRODUCTION_BOARD: 'production',
    GET_PRODUCTION_DISPATCH_PLAN: 'production', CREATE_PRODUCTION_DISPATCH_PLAN: 'production', APPROVE_PRODUCTION_DISPATCH_PLAN: 'production', SET_PRODUCTION_DISPATCH_CONFIG: 'production',
    GET_BATCH_PASSPORT: 'warehouse_view', GENERATE_PPK_INSPECTION_PACKET: 'ppk', GET_PPK_INSPECTION_PACKET: 'ppk', GET_PRODUCTION_ENTERPRISE_DASHBOARD: 'dashboard',
    GET_CRITICAL_INCIDENTS: 'critical_incidents', CREATE_CRITICAL_INCIDENT: 'critical_incidents', RESOLVE_CRITICAL_INCIDENT: 'critical_incidents', GET_QUARANTINE_CASES: 'critical_incidents', RELEASE_QUARANTINE: 'critical_incidents', GET_CRITICAL_INCIDENT_DASHBOARD: 'dashboard',
    START_INVENTORY: 'inventory', SUBMIT_INVENTORY_LINE: 'inventory', CLOSE_INVENTORY: 'inventory', GET_INVENTORY: 'inventory', CREATE_ADJUSTMENT_FROM_INVENTORY: 'inventory',

    ADD_JOURNAL_ENTRY: 'journals', GET_JOURNALS: 'journals',
    CONFIRM_AUTO_JOURNAL: 'journals', GET_PENDING_JOURNALS: 'journals', SUBMIT_JOURNAL_VALUE: 'journals',
    GET_JOURNAL_DEFINITIONS: 'journal_admin', CREATE_JOURNAL_DEFINITION: 'journal_admin', UPDATE_JOURNAL_DEFINITION: 'journal_admin', CREATE_JOURNAL_TRIGGER: 'journal_admin', GET_JOURNAL_TRIGGERS: 'journal_admin',

    GET_WORKSHOPS: 'workshops_use', CREATE_WORKSHOP: 'workshops_manage', UPDATE_WORKSHOP: 'workshops_manage',
    GET_EQUIPMENT: 'equipment', CREATE_EQUIPMENT: 'equipment', UPDATE_EQUIPMENT: 'equipment',
    GENERATE_LABEL: 'marking', GET_LABEL: 'marking', GET_BATCH_BY_QR: 'warehouse_view',
    GET_MARKING_JOURNAL: 'marking', CREATE_LABEL_PRINT_JOB: 'marking', VERIFY_LABEL_PRINT: 'marking', OPEN_CONTAINER: 'marking',
    CONFIRM_BATCH_SHELF_LIFE: 'warehouse_receive',

    GET_ECONOMICS: 'economics',
    CREATE_BUDGET_PLAN: 'economics', GET_BUDGET_PLANS: 'economics', RECORD_CASH_TRANSACTION: 'economics', GET_CASH_FLOW: 'economics', GET_PLAN_FACT: 'economics', GET_CASH_FORECAST: 'economics',
    GET_AUTOMATION_DECISIONS: 'dashboard', RUN_AUTOMATION_DECISIONS: 'dashboard', APPROVE_AUTOMATION_DECISION: 'automation_approve', REJECT_AUTOMATION_DECISION: 'automation_approve',
    GET_CONFIGURATION: 'configuration_admin', GET_POLICY_DECISION: 'dashboard', GET_POLICY_CATALOG: 'dashboard', GET_MASTER_DATA: 'dashboard', GET_MASTER_DATA_DUPLICATES: 'dashboard', RUN_DATA_QUALITY_AUDIT: 'dashboard', GET_RECONCILIATION_CASES: 'master_data_admin', GET_UNIFIED_BATCH_TRACEABILITY: 'warehouse_view', GET_UNIFIED_SALE_TRACEABILITY: 'journals', GET_UNIFIED_PRODUCTION_TRACEABILITY: 'production', RUN_TRACEABILITY_RECONCILIATION: 'dashboard', GET_TRACEABILITY_SUMMARY: 'dashboard', GET_TRACEABILITY_RUN: 'dashboard', GET_PERIOD_CLOSURE_SUMMARY: 'dashboard', RUN_PERIOD_CLOSING_CHECK: 'dashboard', GET_PERIOD_CLOSURE: 'dashboard', GET_PERIOD_REOPEN_REQUESTS: 'dashboard', CREATE_PERIOD_REOPEN_REQUEST: 'master_data_admin', APPROVE_PERIOD_REOPEN: 'master_data_admin', REOPEN_PERIOD: 'master_data_admin', VERIFY_AUDIT_EVIDENCE: 'dashboard', GET_AUDIT_EVIDENCE: 'dashboard', SEAL_AUDIT_EVIDENCE: 'audit_admin', CREATE_COMPLIANCE_EVIDENCE_PACK: 'audit_admin', GET_COMPLIANCE_EVIDENCE_PACK: 'dashboard', VERIFY_COMPLIANCE_EVIDENCE_PACK: 'dashboard', GET_COMPLIANCE_COCKPIT: 'dashboard', GET_COMPLIANCE_COCKPIT_SUMMARY: 'dashboard', GET_ENTERPRISE_BOARD_PACK: 'economics', GET_ENTERPRISE_BOARD_PACKS: 'economics', CREATE_ENTERPRISE_BOARD_PACK: 'economics', VERIFY_ENTERPRISE_BOARD_PACK: 'economics', GET_KPI_METRIC_CATALOG: 'economics', GET_KPI_TARGETS: 'economics', CREATE_KPI_TARGET: 'economics', RUN_KPI_VARIANCE: 'economics', GET_KPI_VARIANCES: 'economics', CREATE_KPI_ACTION: 'economics', GET_KPI_ACTIONS: 'economics', COMPLETE_KPI_ACTION: 'economics', GET_CAPA_CASES: 'dashboard', GET_COMPLIANCE_CONTROLS: 'dashboard', GET_COMPLIANCE_CONTROL: 'dashboard', GET_COMPLIANCE_MATRIX: 'dashboard', GET_COMPLIANCE_MATRIX_SUMMARY: 'dashboard', CREATE_COMPLIANCE_CONTROL: 'audit_admin', LINK_COMPLIANCE_CONTROL: 'audit_admin', GET_CAPA_CASE: 'dashboard', CREATE_CAPA_CASE: 'master_data_admin', CREATE_CAPA_ACTION: 'master_data_admin', UPDATE_CAPA_CASE: 'master_data_admin', COMPLETE_CAPA_ACTION: 'master_data_admin', VERIFY_CAPA_CASE: 'audit_admin', RUN_CAPA_SLA: 'dashboard', APPROVE_PERIOD_CLOSURE: 'master_data_admin', CLOSE_PERIOD: 'master_data_admin', CREATE_RECONCILIATION_CASE: 'master_data_admin', RESOLVE_RECONCILIATION_CASE: 'master_data_admin', CREATE_MASTER_DATA_ALIAS: 'master_data_admin', RESOLVE_MASTER_DATA_DUPLICATE: 'master_data_admin', CREATE_CONFIGURATION_REVISION: 'configuration_admin', APPROVE_CONFIGURATION_REVISION: 'configuration_admin', ACTIVATE_CONFIGURATION_REVISION: 'configuration_admin', ROLLBACK_CONFIGURATION: 'configuration_admin',
    GET_EVENT_AUTOMATION_RULES: 'dashboard', CREATE_EVENT_AUTOMATION_RULE: 'automation_approve', SET_EVENT_AUTOMATION_RULE_STATUS: 'automation_approve', RUN_EVENT_AUTOMATION: 'dashboard', GET_AUTOMATION_WORKFLOWS: 'dashboard', CREATE_AUTOMATION_WORKFLOW: 'automation_approve', COMPLETE_AUTOMATION_WORKFLOW_STEP: 'automation_approve', RUN_AUTOMATION_WORKFLOW_SLA: 'dashboard',
    GET_REPORTS: 'reports', GENERATE_DAILY_REPORT: 'reports',
    // Stage 20 (перенесено): дашборд руководителя и каталог управленческих отчётов — ReportsDashboard.gs.
    GET_EXECUTIVE_DASHBOARD: 'reports', GET_MANAGEMENT_REPORTS: 'reports',
    GET_AI_RECOMMENDATIONS: 'ai',
    COMPLETE_CHECKLIST: 'journals',

    GET_NOTIFICATIONS: 'dashboard', MARK_NOTIFICATION_READ: 'dashboard',
    GET_NOTIFICATION_SETTINGS: 'notifications_admin', UPDATE_NOTIFICATION_SETTINGS: 'notifications_admin',

    GET_PLAN_MENU_EVENTS: 'plan_menu', CREATE_PLAN_MENU_EVENT: 'plan_menu',
    ADD_PLAN_MENU_ITEM: 'plan_menu', GET_PLAN_MENU_ITEMS: 'plan_menu', CALC_PLAN_MENU_NEEDS: 'plan_menu',

    // Секондарные фичи, раунд 1 (Архитектура v4 §6) — единая таблица задач.
    CREATE_TASK: 'tasks', GET_TASKS: 'tasks', COMPLETE_TASK: 'tasks',

    // Секондарные фичи, раунд 3 (Архитектура v4 §8) — Лабораторный модуль v2. Один
    // модуль 'lab' на всё (запись результата И редактирование расписания/лимитов) —
    // ОСОЗНАННОЕ упрощение по сравнению с journals/journal_admin: архитектурный документ
    // (§10) сам предлагает ЛАБОРАНТ: ['lab'] одним модулем, без разделения на "заполняет"/
    // "администрирует"; если на практике лаборанту нельзя будет доверять менять расписание
    // самому — это будущий, отдельно обсуждаемый с Денисом раскол на 'lab'/'lab_admin' по
    // тому же образцу, что и у журналов, а не то, что решается тихо сейчас без запроса.
    CREATE_LAB_TEST: 'lab', GET_LAB_TESTS: 'lab',
    CREATE_LAB_TEST_DEFINITION: 'lab', GET_LAB_TEST_DEFINITIONS: 'lab', UPDATE_LAB_TEST_DEFINITION: 'lab',

    // Секондарные фичи, раунд 4 (Архитектура v4 §7) — версионирование ППК. Отдельный
    // модуль 'ppk' — это регистрационный/системный документ предприятия (кто директор,
    // какие процессы, какие журналы обязательны), тот же уровень чувствительности, что
    // у journal_admin, НЕ у journals — см. ROLE_MODULES ниже.
    CREATE_PPK_VERSION: 'ppk', GET_PPK_VERSIONS: 'ppk', GET_CURRENT_PPK: 'ppk',
    UPDATE_PPK_VERSION: 'ppk', SUBMIT_PPK_VERSION_FOR_REVIEW: 'ppk',
    APPROVE_PPK_VERSION: 'ppk', ARCHIVE_PPK_VERSION: 'ppk',
    GET_PPK_GENERATOR_CONTEXT: 'ppk', GENERATE_PPK: 'ppk', GET_PPK_MODEL: 'ppk',
    GET_PPK_FLOW: 'ppk', BUILD_PRODUCT_FLOW: 'ppk', BUILD_HAZARD_ANALYSIS: 'ppk', GET_PPK_HAZARDS: 'ppk', CONFIRM_PPK_HAZARD: 'ppk',
    GET_PPK_CONTROLS: 'ppk', GENERATE_PPK_CONTROLS: 'ppk', CREATE_PPK_CONTROL: 'ppk', CONFIRM_PPK_CONTROL: 'ppk', CREATE_PPK_CRITICAL_LIMIT: 'ppk', APPROVE_PPK_CRITICAL_LIMIT: 'ppk',
    GENERATE_PPK_JOURNALS: 'ppk', GET_PPK_COMPLIANCE: 'ppk', GET_PPK_VERIFICATION: 'ppk', CREATE_PPK_VERIFICATION: 'ppk', COMPLETE_PPK_VERIFICATION: 'ppk',
    GET_PPK_REVIEWS: 'ppk', REQUEST_PPK_REVIEW: 'ppk', RESOLVE_PPK_REVIEW: 'ppk', GET_PPK_IMPACT_ANALYSIS: 'ppk', RECORD_PPK_CHANGE: 'ppk',
    GET_PPK_TRACEABILITY: 'ppk', GET_PPK_TRACEABILITY_BY_PRODUCT: 'ppk', GET_PPK_DOCUMENT: 'ppk', GENERATE_PPK_DOCUMENT: 'ppk',

    // Секондарные фичи, раунд 5 (§12 п.5) — Нормативная база / HACCP Engine. Модуль
    // назван 'haccp_rules', а не 'rules_admin' из более раннего черновика документа —
    // это ровно имя, которое уже использует АКТУАЛЬНЫЙ архитектурный документ (§10,
    // список модулей ОТВЕТСТВЕННЫЙ_ЗА_HACCP) для этой же самой функции.
    CREATE_RULE: 'haccp_rules', GET_RULES: 'haccp_rules', GET_ACTIVE_RULE: 'haccp_rules',
    GET_RULE_HISTORY: 'haccp_rules', ARCHIVE_RULE: 'haccp_rules',

    // Секондарные фичи, раунд 6 (Архитектура v4 §3, §12 п.6) — интеграции. Настройка
    // внешних систем — минимум того же уровня системной чувствительности, что и
    // haccp_rules/ppk (а в перспективе, когда появятся реальные креды — выше: см.
    // CHANGELOG за флагом риска хранения секретов).
    GET_INTEGRATIONS: 'integrations', UPDATE_INTEGRATION_SETTINGS: 'integrations',
    ENABLE_INTEGRATION: 'integrations', DISABLE_INTEGRATION: 'integrations',
    TEST_INTEGRATION_CONNECTION: 'integrations',
    PULL_INTEGRATION_DATA: 'integrations', PUSH_INTEGRATION_DATA: 'integrations',
    CREATE_INTEGRATION_MAPPING: 'integrations', GET_INTEGRATION_MAPPINGS: 'integrations',
    PUBLISH_CORE100_EVENT: 'recovery', GET_CORE100_EVENTS: 'dashboard', CREATE_CORE100_WORKFLOW: 'recovery', GET_CORE100_WORKFLOWS: 'dashboard', ADVANCE_CORE100_WORKFLOW: 'recovery', ENTERPRISE_SEARCH: 'dashboard', GET_DEPLOYMENT_HEALTH_CORE100: 'dashboard', VERIFY_BACKUP_CORE100: 'recovery', RUN_CORE100_UAT: 'recovery', GET_CORE100_UAT: 'dashboard', CREATE_DEPLOYMENT_EVIDENCE: 'recovery', GET_DISASTER_RECOVERY_CORE100: 'recovery', RUN_CORE100_GO_LIVE_GATE: 'recovery', GET_CORE100_GO_LIVE_GATES: 'dashboard', GET_CORE100_FINAL_COMMAND_CENTER: 'dashboard',
    TEST_TELEGRAM_CONNECTION: 'notifications_admin', GET_SYSTEM_HEALTH: 'dashboard', RESOLVE_RECOVERY_MANUALLY: 'recovery',

    // Секондарные фичи, раунд 7 (Архитектура v4 §5, §12 п.7) — ЦЕХ AI чат-мок. Тот же
    // модуль 'ai', что уже был у GET_AI_RECOMMENDATIONS (не новый модуль) — осознанно:
    // кто уже мог получать AI-рекомендации, теперь может и спросить чат тем же правом,
    // расширять список ролей сверх уже имеющих 'ai' в этом раунде не запрошено Денисом.
    AI_CHAT: 'ai',
    AI_COPILOT: 'ai',

    // Раунд 8 — ТЗ «Справочник продуктов + Декларации соответствия». Модуль 'products'
    // (уже существующий) — расширенная карточка продукта/глобальный справочник/
    // нутриенты/аллергены/сроки/признаки порчи: то же самое "кто видел продукт, тот
    // видит и его расширенную карточку", без нового модуля. Модуль 'compliance' —
    // НОВЫЙ: декларации/OCR/документы поставщика/compliance-профили/регуляторные
    // источники/дашборд/импорт-мастер — административная функция уровня ДИРЕКТОР/
    // ADMIN (ТЗ §41), не даётся ролям ниже по умолчанию (см. ROLE_MODULES).
    // Действие на приёмке (CHECK_RECEIPT_COMPLIANCE) — под 'warehouse_receive' (тем же
    // модулем, что и сам приход), а не под 'compliance': КЛАДОВЩИК уже имеет
    // 'warehouse_receive' и должен видеть статус соответствия ПРИ приёмке (ТЗ §41
    // "работа... с документами при приёмке"), не получая полный административный
    // доступ к декларациям/дашборду — тот же принцип, что уже применён к
    // FIND_PRODUCT_BY_BARCODE ('warehouse_view', не 'products').
    // Внешний P0-аудит, п.4 (раунд 12) — НАЙДЕНО: CREATE_GLOBAL_PRODUCT/UPDATE_GLOBAL_PRODUCT
    // (и все действия, тоже пишущие в GLOBAL_PRODUCTS/PRODUCT_ALLERGENS/PRODUCT_SHELF_LIFE/
    // PRODUCT_SPOILAGE_SIGNS — общий для ВСЕХ организаций платформы справочник пищевой
    // ценности/аллергенов/сроков хранения/признаков порчи, ProductMaster.gs) делили модуль
    // 'products' с обычным созданием/редактированием СВОЕГО продукта организации — то есть
    // сегодня их мог менять не только ADMIN/ДИРЕКТОР, но и ШЕФ-ПОВАР, и КАЛЬКУЛЯТОР ЛЮБОЙ
    // организации (у обоих есть 'products'). Ошибка одного повара/калькулятора могла
    // испортить справочные данные, которыми пользуются ВСЕ организации платформы — ровно
    // то, о чём предупреждает документ аудита ("Обычный ADMIN организации не должен
    // автоматически получать право менять глобальную нормативную базу всей системы" — здесь
    // было даже хуже, это касалось не только ADMIN). По решению Дениса выделен отдельный
    // модуль 'global_catalog' — ТОЛЬКО для действий, реально МЕНЯЮЩИХ содержимое глобального
    // справочника; чтение (GET_GLOBAL_PRODUCTS/GET_GLOBAL_PRODUCT/SEARCH_PRODUCTS/
    // GET_PRODUCT_CARD/GET_PRODUCT_VERSIONS) и привязка СВОЕГО продукта к уже существующей
    // глобальной записи (LINK_PRODUCT_TO_GLOBAL — меняет только PRODUCTS.global_product_id
    // организации вызывающего, не сам глобальный справочник) сознательно оставлены в
    // 'products' — они не мутируют общие данные, ограничивать их не за что.
    GET_GLOBAL_PRODUCTS: 'products', GET_GLOBAL_PRODUCT: 'products',
    CREATE_GLOBAL_PRODUCT: 'global_catalog', UPDATE_GLOBAL_PRODUCT: 'global_catalog',
    SEARCH_PRODUCTS: 'products', GET_PRODUCT_CARD: 'products',
    SET_PRODUCT_NUTRIENTS: 'global_catalog', SET_PRODUCT_ALLERGENS: 'global_catalog',
    SET_PRODUCT_SHELF_LIFE: 'global_catalog', SET_PRODUCT_SPOILAGE_SIGNS: 'global_catalog',
    GET_PRODUCT_VERSIONS: 'products', LINK_PRODUCT_TO_GLOBAL: 'products',

    // Раунд 12 (P0.6, §47) — новый модуль 'recovery': чтение состояния cascade/операций
    // (GET_CASCADE/GET_RECOVERY_CASCADES, CascadeEngine.gs) — та же системная
    // чувствительность, что у 'integrations'/'haccp_rules' (не эксплуатационная работа
    // точки, а разбор технических сбоев всей организации) — только ДИРЕКТОР + ADMIN
    // ('all'), см. ROLE_MODULES ниже. Обе операции только читают, ничего не меняют.
    CREATE_SAFETY_DOCUMENT:'safety_admin', GET_SAFETY_DOCUMENTS:'safety', UPDATE_SAFETY_DOCUMENT:'safety_admin', UPLOAD_SAFETY_DOCUMENT:'safety_admin',
    CREATE_SAFETY_DOCUMENT_VERSION:'safety_admin', APPROVE_SAFETY_DOCUMENT:'safety_admin', ACTIVATE_SAFETY_DOCUMENT:'safety_admin', ARCHIVE_SAFETY_DOCUMENT:'safety_admin', GET_SAFETY_DOCUMENT_VERSIONS:'safety',
    CREATE_SAFETY_BRIEFING_TYPE:'safety_admin', CREATE_REQUIREMENT_RULE:'safety_admin', GET_REQUIREMENT_RULES:'safety', GET_SAFETY_BRIEFING_TYPES:'safety', CREATE_SAFETY_REQUIREMENT:'safety_admin', GET_SAFETY_REQUIREMENTS:'safety', CREATE_SAFETY_EMPLOYEE_CONTEXT:'safety_admin', GET_SAFETY_EMPLOYEE_CONTEXT:'safety',
    SYNC_SAFETY_ASSIGNMENTS:'safety_admin', GET_MY_SAFETY_ASSIGNMENTS:'safety', OPEN_SAFETY_ASSIGNMENT:'safety', START_SAFETY_BRIEFING:'safety', REASSIGN_SAFETY_BRIEFING:'safety_admin',
    CREATE_SAFETY_TEST:'safety_admin', ADD_SAFETY_QUESTION:'safety_admin', APPROVE_SAFETY_TEST:'safety_admin', ACTIVATE_SAFETY_TEST:'safety_admin', GET_SAFETY_TESTS:'safety', GET_SAFETY_QUESTIONS:'safety', START_SAFETY_TEST:'safety', COMPLETE_SAFETY_TEST:'safety', GET_SAFETY_TEST_ATTEMPTS:'safety',
    CONFIRM_SAFETY_ASSIGNMENT:'safety', GET_SAFETY_BRIEFING_LOG:'safety', GET_SAFETY_EMPLOYEE_CARD:'safety', GET_SAFETY_INSTRUCTION_CARD:'safety', GET_SAFETY_DASHBOARD:'safety', PROCESS_SAFETY_DEADLINES:'safety_admin', CHECK_SAFETY_REQUIREMENT:'safety', GET_SAFETY_EMERGENCY:'safety', CREATE_SAFETY_QR:'safety', GET_SAFETY_BY_QR:'safety', GET_SAFETY_REPORT:'safety', EXPORT_SAFETY_CSV:'safety', GET_SAFETY_FINAL_GATE:'recovery',
    GET_CASCADE: 'recovery', GET_RECOVERY_CASCADES: 'recovery',
    GET_P22_COVERAGE: 'recovery', GET_P22_FINAL_GATE: 'recovery', GET_P22_RECOVERY: 'recovery', RETRY_P22_RECOVERY: 'recovery', GET_PRODUCTION_READINESS: 'recovery',
    GET_P21_JOURNAL_MAP: 'recovery', GET_P21_AUTOMATION_CONTRACT: 'recovery', GET_P21_COVERAGE: 'recovery', GET_P21_FINAL_GATE: 'recovery',
    SCAN_AND_RECEIVE_INVOICE: 'warehouse_receive', SCAN_INVOICE_PREVIEW:'warehouse_receive', GET_INVOICE_INTAKE_DRAFT:'warehouse_view', CONFIRM_INVOICE_RECEIPT:'warehouse_receive', RESOLVE_INVOICE_INTAKE_LINE:'warehouse_receive', APPEND_INVOICE_INTAKE_PAGE:'warehouse_receive', GET_DOCUMENT_INTEGRITY_DASHBOARD:'warehouse_view',
    CHECK_DOCUMENT_INTEGRITY:'warehouse_receive', RUN_HACCP_DECISION_ENGINE:'ppk', GET_HACCP_DECISIONS:'ppk',
    GET_EMERGENCY_CENTER:'dashboard', GENERATE_TTK_A4_PDF:'recipes', GENERATE_PPK_INSPECTION_A4_PDF:'ppk',
    ENQUEUE_OFFLINE_OPERATION:'offline', SYNC_OFFLINE_QUEUE:'offline', GET_RECURSIVE_BATCH_COST_TRACE:'warehouse_view',
    RELEASE_SEMI_FINISHED_QUALITY:'production', GET_DEPLOYMENT_READINESS:'dashboard', GET_OPERATIONAL_READINESS_STAGE12:'dashboard', GET_OPERATIONAL_READINESS_STAGE13:'dashboard', RUN_ENTERPRISE_E2E_TEST: 'recovery', GET_HACCP_DASHBOARD: 'ppk', GET_PPK_FINAL_GATE: 'ppk',

    CREATE_SUPPLIER: 'purchasing', GET_SUPPLIERS: 'purchasing', UPDATE_SUPPLIER: 'purchasing',

    CHECK_RECEIPT_COMPLIANCE: 'warehouse_receive',

    CREATE_DECLARATION: 'compliance', GET_DECLARATIONS: 'compliance', GET_DECLARATION: 'compliance',
    UPDATE_DECLARATION: 'compliance', VERIFY_DECLARATION: 'compliance', SET_DECLARATION_STATUS: 'compliance',
    LINK_DECLARATION_PRODUCT: 'compliance', UNLINK_DECLARATION_PRODUCT: 'compliance',
    UPLOAD_DECLARATION_FILE: 'compliance', UPLOAD_SUPPLIER_DOCUMENT: 'compliance', GET_SUPPLIER_DOCUMENTS: 'compliance',
    RUN_DECLARATION_OCR: 'compliance', GET_OCR_RESULT: 'compliance', CONFIRM_OCR_RESULT: 'compliance',
    CREATE_COMPLIANCE_PROFILE: 'compliance', GET_COMPLIANCE_PROFILES: 'compliance', UPDATE_COMPLIANCE_PROFILE: 'compliance',
    SET_COMPLIANCE_BLOCK_MODE: 'compliance', GET_COMPLIANCE_BLOCK_MODE: 'compliance',
    CREATE_REGULATORY_SOURCE: 'compliance', GET_REGULATORY_SOURCES: 'compliance', UPDATE_REGULATORY_SOURCE: 'compliance',
    GET_COMPLIANCE_DASHBOARD: 'compliance',
    IMPORT_PRODUCTS_PREVIEW: 'compliance', IMPORT_PRODUCTS_COMMIT: 'compliance',
    GET_IMPORT_BATCHES: 'compliance', GET_IMPORT_ROWS: 'compliance', RESOLVE_DUPLICATE_CANDIDATE: 'compliance',

    // Раунд 11 (по прямому указанию Дениса «Настрой это всё» — см. CHANGELOG §39). Модуль
    // 'sales' — НОВЫЙ, отдельный от 'economics'/'reports': запись фактов продаж —
    // операционная функция (кто был на смене/вносит выручку), а не системная конфигурация
    // или чтение отчётности — тот же принцип разделения, что уже применён к
    // workshops_use/workshops_manage. Кто имеет 'economics' — видит P&L/ABC (чтение);
    // кто имеет 'sales' — может завести факт продажи вручную/импортом.
    CREATE_SALE: 'sales', CREATE_SALE_AND_FULFILL: 'sales', FULFILL_SALE: 'sales', GET_SALE_TRACE: 'sales', GET_SALES: 'sales',
    IMPORT_SALES_PREVIEW: 'sales', IMPORT_SALES_COMMIT: 'sales',
    GET_SALES_IMPORT_BATCHES: 'sales', GET_SALES_IMPORT_ROWS: 'sales', RESOLVE_SALES_IMPORT_ROW: 'sales',

    // Настоящий P&L/ABC-анализ (см. SalesAnalytics.gs) — тот же модуль 'economics', что
    // уже даёт ДИРЕКТОРУ/БУХГАЛТЕРУ/КАЛЬКУЛЯТОРУ доступ к остальной экономике. История
    // расчётов (CALCULATIONS, раньше писалась, но никогда не читалась — см. CHANGELOG
    // §38.5) — туда же.
    GET_PNL: 'economics', GET_ABC_ANALYSIS: 'economics', GET_CALCULATIONS_HISTORY: 'economics', GET_MANAGEMENT_ECONOMICS: 'economics', GET_LOSS_ENGINE: 'economics', GET_MANAGEMENT_ACTIONS: 'economics',

    // Раунд 11, продолжение — операционные расходы (Expenses.gs). Тот же модуль
    // 'economics', что и P&L/ABC — намеренно НЕ отдельный модуль: кто видит P&L,
    // тот же человек по смыслу вносит и расходы для него (ДИРЕКТОР/БУХГАЛТЕР/
    // КАЛЬКУЛЯТОР) — избегаем разрастания ROLE_MODULES/CLIENT_ROLE_MODULES ради
    // функции, которая всегда используется вместе с уже существующим модулем.
    CREATE_EXPENSE: 'economics', GET_EXPENSES: 'economics',

    // Недельные/месячные отчёты — тот же модуль 'reports', что и GENERATE_DAILY_REPORT.
    GENERATE_WEEKLY_REPORT: 'reports', GENERATE_MONTHLY_REPORT: 'reports',

    // Синхронизация с кассой (iiko) — явное, ручное действие ("нажал кнопку — подтянулись
    // продажи за период"), не фоновый процесс (в Apps Script нет живого фонового сервера,
    // только триггеры по расписанию — их настройка отдельный шаг при реальном деплое).
    // Модуль 'integrations' — тот же, что у остальных действий настройки касс.
    SYNC_IIKO_SALES: 'integrations',

    // Обслуживание оборудования — тот же модуль 'equipment', что и CREATE_EQUIPMENT.
    LOG_EQUIPMENT_MAINTENANCE: 'equipment', GET_EQUIPMENT_MAINTENANCE_LOG: 'equipment'
  },

  // Роль → разрешённые модули (ТЗ §58). 'all' = ADMIN. Сверяется на сервере в API.gs
  // на каждый вызов — фронтенд НИКОГДА не является источником прав (ТЗ §18/§59).
  // ШЕФ-ПОВАР намеренно НЕ имеет warehouse_receive/workshops_manage/users/journal_admin/
  // notifications_admin — это прямое требование ТЗ §7 ("шеф не может менять накладные,
  // не может создавать/удалять цеха, не может менять системные правила").
  //
  // ТЗ P0.1 (аудит безопасности) — ДИРЕКТОР ЛИШЁН 'organizations' и 'backup':
  //   - 'organizations' раньше давал GET_ORGANIZATIONS/CREATE_ORGANIZATION — это модули
  //     ПЛАТФОРМЕННОГО уровня (список/создание арендаторов), а не уровня своей точки; любой
  //     ДИРЕКТОР одной организации мог увидеть список ВСЕХ организаций в системе.
  //   - 'backup' раньше давал CREATE_BACKUP/GET_BACKUPS — createBackup_() копирует ВЕСЬ
  //     файл таблицы целиком (Warehouse всех организаций сразу, т.к. архитектура — одна
  //     общая таблица с разделением по organization_id в строках, см. Database.gs), и отдаёт
  //     ссылку на копию в Google Drive. ДИРЕКТОР одной организации не должен получать
  //     ссылку на полный дамп данных ВСЕХ остальных организаций платформы.
  // РЕШЕНО Денисом (раунд 12, §44 changelog) — 'ADMIN': 'all' формально по-прежнему
  // означает, что и ADMIN одной организации может вызвать CREATE_BACKUP/GET_BACKUPS/
  // CREATE_ORGANIZATION и получить дамп ВСЕЙ платформы, потому что отдельной роли
  // "оператор платформы", отличной от ADMIN арендатора, в системе нет. Денис явно решил
  // ОСТАВИТЬ КАК ЕСТЬ — пока в системе только один арендатор (сам Денис), любой ADMIN — это
  // и есть он сам, вводить отдельную роль сейчас незачем и рискованно (можно случайно
  // ограничить его же собственный доступ). Если/когда появится ВТОРОЙ независимый арендатор
  // (реальный сторонний ресторан со своим ADMIN), этот вопрос нужно поднять заново — тогда
  // разница между "ADMIN своего ресторана" и "оператор платформы" станет реальной, а не
  // теоретической. НЕ менять этот доступ по собственной инициативе без нового решения Дениса.
  // Секондарные фичи, раунд 1 — 'tasks' добавлен ТОЛЬКО ролям, у которых уже есть
  // 'journals' (единственный сегодня реальный источник, пишущий в TASKS —
  // CORRECTIVE_ACTIONS из Journals.gs, см. Tasks.gs/Архитектура v4 §6/§10):
  // ДИРЕКТОР, ШЕФ-ПОВАР, ПОВАР. Осознанно НЕ добавлено остальным ролям автоматически
  // "на всякий случай" — прямое требование Архитектуры v4 §10 ("добавлять новые
  // модули осознанно, по необходимости, а не автоматически всем сразу"); когда
  // появятся реальные источники задач для склада/бухгалтерии (лаборатория, химия,
  // закупки — ТЗ v4 §30), это будет отдельным осознанным расширением списка, а не
  // сейчас впрок.
  // Секондарные фичи, раунд 3 (Архитектура v4 §8/§10) — 'lab' добавлен ДИРЕКТОРУ и
  // ШЕФ-ПОВАРУ (оба уже видят journals/production — лаборатория логически рядом, оба
  // правдоподобные проверяющие по демо-данным), и новой роли ЛАБОРАНТ — ровно как
  // архитектурный документ предлагает в §10 (`ЛАБОРАНТ: ['lab']`). Остальным ролям
  // 'lab' сознательно НЕ добавлен — тот же принцип §10 "осознанно, по необходимости",
  // что уже применялся к 'tasks' в раунде 1.
  // Секондарные фичи, раунд 4 (Архитектура v4 §7) — 'ppk' добавлен ТОЛЬКО ДИРЕКТОРУ
  // (+ ADMIN через 'all') — версия ППК фиксирует, кто директор/какие процессы
  // предприятия/какие журналы обязательны, тот же уровень системной чувствительности,
  // что у journal_admin (которого у ШЕФ-ПОВАРА тоже нет). Роль ОТВЕТСТВЕННЫЙ_ЗА_HACCP,
  // которую предлагает §10 с модулем 'ppk' в списке, ЗДЕСЬ СОЗНАТЕЛЬНО НЕ заведена —
  // §10 даёт ей ещё 'safety'/'haccp_rules', которых как реальных модулей пока не
  // существует (это §12 п.5, следующий раунд); заводить роль с половиной
  // недостающих модулей значило бы нарушить тот же принцип "осознанно, по
  // необходимости", а не сэкономить время.
  // Секондарные фичи, раунд 5 (§12 п.5) — 'haccp_rules' тоже добавлен ТОЛЬКО
  // ДИРЕКТОРУ, тем же обоснованием, что 'ppk'/'journal_admin' (нормативы — системная
  // конфигурация, не эксплуатационное использование). Роль ОТВЕТСТВЕННЫЙ_ЗА_HACCP
  // ВСЁ ЕЩЁ сознательно не заведена: у неё в §10 остаётся 'safety' (Охрана труда —
  // демо-модуль раздела 17, вне порядка §12 вообще, отдельный незапланированный
  // раунд) — роль по-прежнему была бы неполной.
  // Секондарные фичи, раунд 6 (§12 п.6) — 'integrations' тоже ТОЛЬКО ДИРЕКТОРУ, тем
  // же обоснованием — настройка внешних систем (пусть пока и без реальных ключей)
  // системная конфигурация уровня организации, не то, что должно быть доступно
  // ролям уровня цеха/точки.
    CREATE_MANAGEMENT_ACTION: 'enterprise_control', GET_MANAGEMENT_ACTION_BACKLOG: 'enterprise_control', COMPLETE_MANAGEMENT_ACTION: 'enterprise_control', RUN_MANAGEMENT_ORCHESTRATOR: 'enterprise_control',
    CREATE_WORKFORCE_PLAN: 'enterprise_control', GET_WORKFORCE_PLANS: 'enterprise_control', GET_WORKFORCE_CAPACITY: 'enterprise_control',
    RUN_SUPPLIER_SCORECARDS: 'enterprise_control', CREATE_PROCUREMENT_ACTION: 'enterprise_control',
    CREATE_INVENTORY_POLICY: 'enterprise_control', GET_INVENTORY_SIGNALS: 'enterprise_control',
    CREATE_CAPACITY_PLAN: 'enterprise_control', GET_CAPACITY_OVERVIEW: 'enterprise_control', GET_MENU_ENGINEERING: 'enterprise_control',
    CREATE_SCENARIO_PLAN: 'enterprise_control', RUN_SCENARIO: 'enterprise_control',
    CREATE_EXECUTION_PLAN: 'enterprise_control', ADD_EXECUTION_ITEM: 'enterprise_control', GET_EXECUTION_PLANS: 'enterprise_control',
    RUN_AUTONOMOUS_PLANNING: 'enterprise_control', GET_PLANNING_PROPOSALS: 'enterprise_control', CREATE_PLANNING_APPROVAL_GATE: 'enterprise_control', APPROVE_PLANNING_GATE: 'enterprise_control', REJECT_PLANNING_GATE: 'enterprise_control', RECORD_PLANNING_OUTCOME: 'enterprise_control', GET_PLANNING_OUTCOMES: 'enterprise_control', GET_AUTONOMOUS_PLAN_SUMMARY: 'enterprise_control', VERIFY_AUTONOMOUS_PLANNING_GUARD: 'enterprise_control', GET_AUTONOMOUS_PLANNING_ALERTS: 'enterprise_control', GET_AUTONOMOUS_PLANNING_COMMAND_CENTER: 'enterprise_control', CREATE_EXECUTION_GATEWAY_REQUEST: 'enterprise_control', GET_EXECUTION_GATEWAY_REQUESTS: 'enterprise_control', RUN_EXECUTION_PREFLIGHT: 'enterprise_control', EXECUTE_APPROVED_PROPOSAL: 'enterprise_control', GET_EXECUTION_OUTCOMES: 'enterprise_control', RUN_EXECUTION_RECONCILIATION: 'enterprise_control', GET_EXECUTION_QUALITY_GATE: 'enterprise_control', GET_EXECUTION_FINANCIAL_PREVIEW: 'enterprise_control', GET_EXECUTION_ALERTS: 'enterprise_control', GET_AUTONOMOUS_OPERATIONS_COMMAND_CENTER: 'enterprise_control', GET_CORE100_HARDENING_STATUS: 'dashboard',    GET_ENTERPRISE_COMMAND_CENTER: 'enterprise_control', GET_CUSTOMER_SALES_INTELLIGENCE: 'enterprise_control', RUN_DEMAND_SENSING: 'enterprise_control', RUN_MATERIAL_REQUIREMENTS: 'enterprise_control', GET_COST_TO_SERVE: 'enterprise_control', GET_CHANNEL_MARGINS: 'enterprise_control', GET_DYNAMIC_MENU_SIGNALS: 'enterprise_control', GET_LABOR_FORECAST: 'enterprise_control', GET_PROCUREMENT_FORECAST: 'enterprise_control', GET_ENTERPRISE_FORECAST: 'enterprise_control', GET_DIGITAL_TWIN_V2: 'enterprise_control',
    CREATE_SHIFT_PLAN: 'enterprise_control', GET_SHIFT_PLANS: 'enterprise_control', CREATE_SHIFT_ASSIGNMENT: 'enterprise_control', GET_SHIFT_DISPATCHER: 'enterprise_control', GET_LABOR_PRODUCTIVITY: 'enterprise_control', GET_PROCUREMENT_CYCLE: 'enterprise_control', CREATE_PROCUREMENT_CYCLE_ACTION: 'enterprise_control', GET_WORKSHOP_PERFORMANCE: 'enterprise_control', CREATE_PRODUCTION_CALENDAR: 'enterprise_control', ADD_PRODUCTION_CALENDAR_ITEM: 'enterprise_control', GET_PRODUCTION_CALENDAR: 'enterprise_control', GET_UNIT_ECONOMICS: 'enterprise_control', GET_DIGITAL_TWIN: 'enterprise_control', RUN_EXECUTION_SCENARIO: 'enterprise_control', GET_OPERATIONAL_ALERTS: 'enterprise_control', GET_DIGITAL_FACTORY_COMMAND_CENTER: 'enterprise_control',

  ROLE_MODULES: {
    'ADMIN': 'all',
    // Раунд 8 — добавлен 'compliance' (декларации/OCR/документы поставщика/дашборд
    // комплаенса/импорт-мастер, ТЗ §41: "ДИРЕКТОР: просмотр/контроль документов и
    // продуктов").
    // Раунд 11 — добавлен 'sales' (модель продаж/заказов для настоящего P&L и
    // ABC-анализа, ТЗ по запросу Дениса "Реализуй все три направления"): продажи
    // фиксируют ДИРЕКТОР/БУХГАЛТЕР (финансовый учёт), ШЕФ-ПОВАР/МЕНЕДЖЕР (операционный
    // ввод по месту). ADMIN — по 'all', КЛАДОВЩИК/ПОВАР/КАЛЬКУЛЯТОР/ЛАБОРАНТ — не даётся.
    // Раунд 12 (§45) — добавлен 'global_catalog': ДИРЕКТОР по-прежнему может вести общий
    // справочник продуктов платформы (пищевая ценность/аллергены/сроки/признаки порчи), как
    // и раньше через 'products' — но теперь это отдельное, явно выданное право, а не
    // побочный эффект обычного доступа к продуктам организации. ШЕФ-ПОВАР/КАЛЬКУЛЯТОР его
    // не получают (см. докстринг у CREATE_GLOBAL_PRODUCT в ACTION_MODULE выше).
    'ДИРЕКТОР': ['pos', 'pos_shift', 'pos_admin', 'pos_kitchen', 'pos_stop', 'enterprise_control', 'audit_admin', 'configuration_admin', 'master_data_admin', 'automation_approve', 'marking', 'critical_incidents', 'dashboard', 'economics', 'reports', 'warehouse_view', 'warehouse_receive', 'production', 'writeoffs', 'purchasing', 'inventory', 'journals', 'journal_admin', 'ai', 'products', 'recipes', 'workshops_use', 'workshops_manage', 'equipment', 'notifications_admin', 'plan_menu', 'users', 'tasks', 'lab', 'ppk', 'haccp_rules', 'integrations', 'compliance', 'locations', 'sales', 'global_catalog', 'recovery', 'safety', 'safety_admin', 'offline'],
    'ШЕФ-ПОВАР': ['pos_kitchen', 'pos_stop', 'marking', 'critical_incidents', 'dashboard', 'production', 'warehouse_view', 'inventory', 'writeoffs', 'recipes', 'products', 'journals', 'workshops_use', 'equipment', 'plan_menu', 'tasks', 'lab', 'sales', 'safety', 'safety_admin', 'offline'],
    // ПОВАР: чтение ТТК/рецептур/полуфабрикатов и производственный контур.
    // Себестоимость и Food Cost доступны через ТТК/рецептуры, но права на изменение
    // рецептур/ТТК и финансовые отчёты не выдаются.
    'ПОВАР': ['pos_kitchen', 'pos_stop', 'marking', 'recipes', 'critical_incidents', 'products', 'inventory', 'writeoffs', 'journals', 'production', 'workshops_use', 'tasks', 'safety', 'offline'],
    // КЛАДОВЩИК: склад + чтение ТТК/рецептур для понимания потребности и себестоимости
    // сырья. Производственный и финансовый контур остаётся закрытым.
    'КЛАДОВЩИК': ['marking', 'critical_incidents', 'warehouse_view', 'warehouse_receive', 'inventory', 'purchasing', 'recipes', 'products', 'workshops_use', 'locations', 'safety', 'offline'],
    'БУХГАЛТЕР': ['enterprise_control', 'recipes', 'economics', 'reports', 'purchasing', 'writeoffs', 'inventory', 'sales', 'safety'],
    'КАЛЬКУЛЯТОР': ['recipes', 'economics', 'products', 'safety'],
    'МЕНЕДЖЕР': ['pos', 'pos_shift', 'pos_admin', 'pos_kitchen', 'pos_stop', 'enterprise_control', 'dashboard', 'purchasing', 'production', 'plan_menu', 'sales', 'safety', 'offline'],
    // Модуль «Касса»: кассир принимает заказы и оплату в своей точке, отмены — у менеджера.
    'КАССИР': ['pos', 'pos_shift', 'safety', 'offline'],
    // Официант: зал, свои заказы, отправка на кухню и пречек. Оплата и смена — у кассира
    // (см. ROLE_ACTION_DENY), чужие столы — запрет в Pos.gs::_posAssertWaiterOwns_.
    'ОФИЦИАНТ': ['pos', 'safety', 'offline'],
    'ЛАБОРАНТ': ['lab', 'safety'],
    // RBAC v2: технолог/HACCP получает технологический + нормативный контур,
    // но не получает users/finance/admin integrations.
    'ТЕХНОЛОГ_HACCP': ['marking', 'critical_incidents', 'dashboard', 'production', 'warehouse_view', 'inventory', 'writeoffs', 'recipes', 'products', 'journals', 'tasks', 'lab', 'ppk', 'haccp_rules', 'reports', 'workshops_use', 'equipment', 'plan_menu', 'safety', 'offline']
  },

  ROLE_LIST: [
    'ADMIN', 'ДИРЕКТОР', 'ШЕФ-ПОВАР', 'ПОВАР',
    'КЛАДОВЩИК', 'ТЕХНОЛОГ_HACCP', 'БУХГАЛТЕР', 'КАЛЬКУЛЯТОР', 'МЕНЕДЖЕР', 'ЛАБОРАНТ',
    'КАССИР', 'ОФИЦИАНТ'
  ],

  // RBAC v2 — область данных. LOCATION = только выбранная точка;
  // ORGANIZATION = все разрешённые точки организации. UI может быть шире,
  // но сервер всегда применяет этот scope.
  ROLE_DATA_SCOPE: {
    'ADMIN': 'ORGANIZATION',
    'ДИРЕКТОР': 'ORGANIZATION',
    'ШЕФ-ПОВАР': 'ORGANIZATION',
    'ПОВАР': 'LOCATION',
    'КЛАДОВЩИК': 'LOCATION',
    'ТЕХНОЛОГ_HACCP': 'ORGANIZATION',
    'БУХГАЛТЕР': 'ORGANIZATION',
    'КАЛЬКУЛЯТОР': 'ORGANIZATION',
    'МЕНЕДЖЕР': 'ORGANIZATION',
    'ЛАБОРАНТ': 'ORGANIZATION',
    'КАССИР': 'LOCATION',
    'ОФИЦИАНТ': 'LOCATION'
  },

  // Точечные запреты поверх ROLE_MODULES. Нужны там, где роль должна читать
  // технологический/стоимостной контур, но не иметь права менять мастер-данные.
  ROLE_ACTION_DENY: {
    // Официант собирает заказ и отправляет на кухню, но деньги принимает кассир.
    'ОФИЦИАНТ': ['POS_PAY', 'POS_OPEN_SHIFT', 'POS_CLOSE_SHIFT'],
    'ПОВАР': ['PREP_SAVE_PAR','RELEASE_SEMI_FINISHED_QUALITY','RESOLVE_CRITICAL_INCIDENT','RELEASE_QUARANTINE','CREATE_PRODUCT','UPDATE_PRODUCT_PRICE','UPDATE_RECIPE','CREATE_DISH','UPDATE_DISH','ADD_RECIPE_LINE','CREATE_TECH_CARD','CREATE_TTK_VERSION','UPDATE_TTK_DRAFT','SUBMIT_TTK_FOR_APPROVAL','APPROVE_TTK_VERSION','CREATE_SEMI_FINISHED','CREATE_BREAKDOWN_PLAN','APPROVE_BREAKDOWN_PLAN','CREATE_BREAKDOWN_PLAN_STEP'],
    'КЛАДОВЩИК': ['RELEASE_SEMI_FINISHED_QUALITY','RESOLVE_CRITICAL_INCIDENT','RELEASE_QUARANTINE','CREATE_PRODUCT','UPDATE_PRODUCT_PRICE','UPDATE_RECIPE','CREATE_DISH','UPDATE_DISH','ADD_RECIPE_LINE','CREATE_TECH_CARD','CREATE_TTK_VERSION','UPDATE_TTK_DRAFT','SUBMIT_TTK_FOR_APPROVAL','APPROVE_TTK_VERSION','CREATE_SEMI_FINISHED','CREATE_BREAKDOWN_PLAN','APPROVE_BREAKDOWN_PLAN','CREATE_BREAKDOWN_PLAN_STEP','CREATE_PURCHASE_REQUEST','UPDATE_PURCHASE_REQUEST_STATUS','CREATE_WRITEOFF','CREATE_PRODUCTION_TASK','ADVANCE_PRODUCTION','CREATE_RECALL_CASE','CLOSE_RECALL_CASE'],
    // КАЛЬКУЛЯТОР меняет калькуляцию/рецептуру, но не утверждает технологию или HACCP/ППК.
    'КАЛЬКУЛЯТОР': ['APPROVE_TTK_VERSION','SUBMIT_TTK_FOR_APPROVAL','APPROVE_BREAKDOWN_PLAN','APPROVE_PRODUCTION_PLAN','CREATE_TTK_HACCP_LINK','CREATE_TTK_SANPIN_LINK','CREATE_PPK_VERSION','UPDATE_PPK_VERSION','APPROVE_PPK_VERSION'],
    // ПОВАР работает с утверждёнными технологическими данными и своим производством.
    'ПОВАР': ['PREP_SAVE_PAR','RELEASE_SEMI_FINISHED_QUALITY','RESOLVE_CRITICAL_INCIDENT','RELEASE_QUARANTINE','CREATE_PRODUCT','UPDATE_PRODUCT_PRICE','UPDATE_RECIPE','CREATE_DISH','UPDATE_DISH','ADD_RECIPE_LINE','CREATE_TECH_CARD','CREATE_TTK_VERSION','UPDATE_TTK_DRAFT','SUBMIT_TTK_FOR_APPROVAL','APPROVE_TTK_VERSION','CREATE_SEMI_FINISHED','CREATE_BREAKDOWN_PLAN','APPROVE_BREAKDOWN_PLAN','CREATE_BREAKDOWN_PLAN_STEP','CREATE_PPK_VERSION','UPDATE_PPK_VERSION','APPROVE_PPK_VERSION','GET_ECONOMICS','GET_PNL','GET_ABC_ANALYSIS'],
    // Технолог/HACCP управляет ТТК + ППК/HACCP, но не финансами и не пользователями.
    'ТЕХНОЛОГ_HACCP': ['UPDATE_PRODUCT_PRICE','CREATE_GLOBAL_PRODUCT','UPDATE_GLOBAL_PRODUCT','CREATE_EXPENSE','GET_ECONOMICS','GET_PNL','GET_ABC_ANALYSIS','CREATE_USER','UPDATE_EMPLOYEE_PROFILE','DEACTIVATE_USER','ACTIVATE_USER','APPROVE_PRODUCTION_PLAN','CREATE_PRODUCTION_PLAN'],
    // Кладовщик не меняет цену номенклатуры: закупочная цена формируется приходом/калькуляцией.
    'КЛАДОВЩИК': ['UPDATE_PRODUCT_PRICE','CREATE_PRODUCT','UPDATE_RECIPE','CREATE_DISH','UPDATE_DISH','ADD_RECIPE_LINE','CREATE_TECH_CARD','CREATE_TTK_VERSION','UPDATE_TTK_DRAFT','SUBMIT_TTK_FOR_APPROVAL','APPROVE_TTK_VERSION','CREATE_SEMI_FINISHED','CREATE_BREAKDOWN_PLAN','APPROVE_BREAKDOWN_PLAN','CREATE_BREAKDOWN_PLAN_STEP','CREATE_PURCHASE_REQUEST','UPDATE_PURCHASE_REQUEST_STATUS','CREATE_WRITEOFF','CREATE_PRODUCTION_TASK','ADVANCE_PRODUCTION','CREATE_RECALL_CASE','CLOSE_RECALL_CASE']
  },

  // ТЗ §9 — типы цехов (преднастройка, список расширяем при необходимости)
  WORKSHOP_TYPES: ['ОВОЩНОЙ', 'МЯСНОЙ', 'РЫБНЫЙ', 'ПТИЦА', 'ГОРЯЧИЙ', 'ХОЛОДНЫЙ', 'КОНДИТЕРСКИЙ', 'ЗАГОТОВОЧНЫЙ', 'МОЕЧНЫЙ', 'СКЛАД', 'ДРУГОЙ'],

  // ТЗ §10 — преднастройка цветовой маркировки. Явно НЕ утверждается как универсальная
  // законодательная норма (см. ТЗ §10/§27) — редактируется администратором организации
  // через NOTIFICATION_SETTINGS-подобный конфиг (WORKSHOP_COLOR_OVERRIDES в SETTINGS).
  WORKSHOP_COLOR_PRESET: {
    'МЯСНОЙ': '#EF4444', 'РЫБНЫЙ': '#388276', 'ПТИЦА': '#F0A93A',
    'ОВОЩНОЙ': '#16A344', 'ХОЛОДНЫЙ': '#16A344', 'КОНДИТЕРСКИЙ': '#FFFFFF',
    'ЗАГОТОВОЧНЫЙ': '#C9A97A', 'МОЕЧНЫЙ': '#211812', 'СКЛАД': '#8a7a6a', 'ДРУГОЙ': '#8a7a6a'
  },

  // ТЗ §5 п.13/§32 — порог "большого" списания, при превышении которого создаётся
  // уведомление независимо от минимального остатка (сумма в рублях, настраиваемо позже per-org)
  LARGE_WRITEOFF_THRESHOLD: 5000,

  SESSION_TTL_MS: 12 * 60 * 60 * 1000, // 12 часов (ТЗ §5) — реальный СРОК ЖИЗНИ сессии
  // в SESSIONS (durable backing store, Auth.gs). CacheService — быстрый кэш ПОВЕРХ
  // него, ограниченный платформой (см. CACHE_MAX_TTL_SECONDS ниже) — эти два числа
  // теперь СОЗНАТЕЛЬНО разные, не должны совпадать.
  PIN_MAX_ATTEMPTS: 5,                  // ТЗ §4 — защита от перебора
  PIN_LOCKOUT_MS: 15 * 60 * 1000,       // 15 минут — база (1-я блокировка подряд), используется
  // также как TTL глобального анти-брутфорс throttle слепого входа (Auth.gs::loginWithPinBlind_).
  // Внешний P0-аудит, п.2 (продолжение раунда 12, по решению Дениса) — ЭСКАЛАЦИЯ длительности
  // блокировки при ПОВТОРНЫХ блокировках ОДНОЙ и той же учётной записи подряд (без успешного
  // входа между ними): 1-я блокировка — 15 мин, 2-я подряд — 1 час, 3-я и далее — 4 часа.
  // Индексируется по USERS.lockout_count (см. SCHEMA ниже), который сбрасывается в 0 при
  // успешном входе или ручном вмешательстве администратора (смена/сброс PIN, включение
  // учётки) — то есть эскалация КОПИТСЯ только при неоднократном НЕПРЕРЫВНОМ переборе.
  PIN_LOCKOUT_LADDER_MS: [15 * 60 * 1000, 60 * 60 * 1000, 4 * 60 * 60 * 1000],
  PIN_MIN_LENGTH: 4,

  CACHE_TTL_SECONDS: 300,

  // Внешний P0-аудит, п.1 — ЖЁСТКИЙ лимит платформы Google Apps Script:
  // CacheService.put(key, value, expirationInSeconds) принимает expirationInSeconds
  // ТОЛЬКО в диапазоне 1..21600 (6 часов) — значение больше этого в реальном Apps
  // Script бросает исключение "Argument too large". До этого исправления
  // SESSION_TTL_MS/1000 = 43200 передавался в put() напрямую — при разворачивании в
  // реальную таблицу КАЖДЫЙ вход в систему падал бы с ошибкой на этой строке
  // (некритично проявлялось раньше, потому что tests/shim.js не воспроизводил этот
  // лимит платформы — см. CHANGELOG). Используется Auth.gs для расчёта TTL кэша
  // сессии, отдельно от настоящего срока жизни самой сессии (SESSION_TTL_MS).
  CACHE_MAX_TTL_SECONDS: 21600
};

/**
 * Открыть таблицу-БД. Приоритет: Script Property SPREADSHEET_ID, иначе CONFIG.SPREADSHEET_ID.
 * Так один и тот же код можно развернуть на разных аккаунтах без правки Config.gs.
 */
function getDatabase_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || CONFIG.SPREADSHEET_ID;
  if (!id) {
    throw new Error('SPREADSHEET_ID не задан. Установи Script Property SPREADSHEET_ID или CONFIG.SPREADSHEET_ID.');
  }
  return SpreadsheetApp.openById(id);
}
