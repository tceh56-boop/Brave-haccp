/**
 * San.Lab — Config.gs
 * Схема таблиц, роли, права, статусы, переходы, настройки по умолчанию.
 * Общий файл ядра: работает и в Apps Script, и в демо (браузер).
 * ES5: только var/function.
 */

var APP_VERSION = '1.0.0';

/* ---------- Префиксы ID (Приложение B ТЗ) ---------- */
var ID_PREFIX = {
  Employees: 'EMP', Teams: 'TEAM', Clients: 'CLI', Sites: 'SITE', Contracts: 'CON',
  Services: 'SRV', Visits: 'VIS', Checklists: 'CHK', ChecklistItems: 'CI',
  VisitResults: 'RES', Reports: 'REP', LabSamples: 'LAB', Tasks: 'TSK',
  Documents: 'DOC', Finance: 'FIN', AuditLog: 'LOG', Notifications: 'NTF',
  SystemErrors: 'ERR'
};

var AUDIT_COLS = ['created_at', 'created_by', 'updated_at', 'updated_by', 'record_status', 'row_version'];

/* ---------- Схема SANITARY_ERP_DB (раздел 10 ТЗ) ----------
 * Первая колонка — ключ. Технические имена стабильны.
 * Колонки, оканчивающиеся на _at, _date, _start, _end, valid_from, valid_until, timestamp — даты.
 */
var SCHEMA = {
  Employees: ['employee_id', 'full_name', 'email', 'phone', 'role', 'team_id', 'extra_perms', 'active', 'pin_hash', 'deactivated_at'].concat(AUDIT_COLS),
  Teams: ['team_id', 'team_name', 'lead_employee_id', 'active'].concat(AUDIT_COLS),
  Clients: ['client_id', 'legal_name', 'inn', 'contact_person', 'contact_phone', 'contact_email', 'legal_address', 'manager_id', 'status', 'drive_folder_id', 'notes'].concat(AUDIT_COLS),
  Sites: ['site_id', 'client_id', 'site_name', 'address', 'contact_name', 'contact_phone', 'service_frequency', 'contract_id', 'service_ids', 'instructions', 'drive_folder_id', 'active'].concat(AUDIT_COLS),
  Contracts: ['contract_id', 'client_id', 'number', 'start_date', 'end_date', 'terms', 'amount', 'status', 'drive_file_id'].concat(AUDIT_COLS),
  Services: ['service_id', 'name', 'description', 'price', 'unit', 'checklist_id', 'requires_samples', 'active'].concat(AUDIT_COLS),
  Visits: ['visit_id', 'site_id', 'client_id', 'employee_id', 'service_id', 'checklist_id', 'planned_start', 'planned_end', 'actual_start', 'actual_end', 'status', 'instructions', 'report_id', 'folder_id', 'photos_folder_id', 'reports_folder_id', 'calendar_event_id', 'calendar_sync', 'reschedule_count', 'status_reason', 'closed_at'].concat(AUDIT_COLS),
  Checklists: ['checklist_id', 'family_id', 'name', 'version', 'valid_from', 'active', 'source', 'approved_by'].concat(AUDIT_COLS),
  ChecklistItems: ['check_item_id', 'checklist_id', 'section', 'text', 'severity', 'photo_required', 'sort_order', 'active'],
  VisitResults: ['result_id', 'visit_id', 'check_item_id', 'result', 'comment', 'severity', 'photo_file_id', 'photo_waived', 'photo_waiver_reason', 'photo_waived_by', 'task_id', 'updated_by', 'updated_at', 'created_at', 'row_version'],
  Reports: ['report_id', 'visit_id', 'version', 'status', 'prev_report_id', 'submitted_by', 'submitted_at', 'reviewer_id', 'reviewed_at', 'review_comment', 'review_due_date', 'document_id', 'snapshot_json', 'created_at'],
  LabSamples: ['sample_id', 'visit_id', 'site_id', 'sample_type', 'sample_point', 'label_code', 'status', 'registered_by', 'collected_at', 'collected_by', 'lab_name', 'sent_at', 'lab_order_no', 'accepted_at', 'result_due_at', 'responsible_id', 'result_date', 'protocol_no', 'result_file_id', 'result_summary', 'reviewed_by', 'reviewed_at', 'decision', 'decision_comment', 'task_id', 'folder_id', 'status_reason', 'overdue_notified_at'].concat(AUDIT_COLS),
  Tasks: ['task_id', 'source_type', 'source_id', 'site_id', 'visit_id', 'title', 'description', 'responsible_id', 'priority', 'due_date', 'status', 'verification_required', 'evidence_file_id', 'evidence_comment', 'verified_by', 'verified_at', 'verification_comment', 'escalated_at', 'closed_at', 'cancel_reason'].concat(AUDIT_COLS),
  Documents: ['document_id', 'entity_type', 'entity_id', 'document_type', 'document_no', 'title', 'file_name', 'mime_type', 'size_bytes', 'drive_file_id', 'check_item_id', 'version', 'approval_status', 'valid_until', 'is_actual', 'invalid_reason', 'prev_document_id', 'created_at', 'created_by', 'updated_at', 'updated_by'],
  Finance: ['finance_id', 'operation_type', 'client_id', 'contract_id', 'site_id', 'visit_id', 'service_id', 'invoice_id', 'invoice_no', 'category', 'amount', 'operation_date', 'due_date', 'payment_status', 'basis', 'document_file_id', 'approved_by', 'approved_at'].concat(AUDIT_COLS),
  AuditLog: ['log_id', 'timestamp', 'actor_email', 'actor_id', 'action', 'entity_type', 'entity_id', 'old_value', 'new_value', 'request_id'],
  Settings: ['setting_key', 'value', 'description', 'updated_by', 'updated_at'],
  Notifications: ['notification_id', 'recipient_id', 'recipient_email', 'type', 'entity_type', 'entity_id', 'title', 'message', 'dedupe_key', 'scheduled_at', 'status', 'attempts', 'last_error', 'sent_at', 'read_at', 'created_at'],
  SystemErrors: ['error_id', 'timestamp', 'function_name', 'request_id', 'error_code', 'safe_message', 'details', 'entity_id', 'resolved_status', 'resolved_by', 'resolved_at'],
  Requests: ['request_id', 'action', 'actor_email', 'response_json', 'created_at']
};

/* Подписи листов для интерфейса */
var TABLE_LABELS = {
  Employees: 'Сотрудники', Teams: 'Команды', Clients: 'Клиенты', Sites: 'Объекты', Contracts: 'Договоры',
  Services: 'Услуги', Visits: 'Выезды', Checklists: 'Чек-листы', ChecklistItems: 'Пункты чек-листов',
  VisitResults: 'Результаты осмотра', Reports: 'Отчёты', LabSamples: 'Пробы', Tasks: 'Задачи',
  Documents: 'Документы', Finance: 'Финансы', AuditLog: 'Журнал аудита', Settings: 'Настройки',
  Notifications: 'Уведомления', SystemErrors: 'Ошибки', Requests: 'Запросы'
};

function isDateColumn(col) {
  return /(_at|_date|_start|_end)$/.test(col) || col === 'timestamp' || col === 'valid_from' || col === 'valid_until';
}

/* ---------- Роли (раздел 3 ТЗ) ---------- */
var ROLES = {
  OWNER: 'Руководитель',
  COORDINATOR: 'Координатор',
  SPECIALIST: 'Санитарный специалист',
  QC: 'Контролёр качества',
  FINANCE: 'Финансовый сотрудник',
  LAB: 'Лабораторный координатор'
};

/* Права на действие API. Проверка уровня записи — в сервисах.
 * '*' — все активные пользователи. */
var PERMS = {
  'auth.me': ['*'],
  'dashboard.get': ['*'],
  'notifications.mine': ['*'], 'notifications.read': ['*'],
  'lookups.get': ['*'],

  'clients.list': ['OWNER', 'COORDINATOR', 'SPECIALIST', 'QC', 'LAB', 'FINANCE'],
  'clients.get': ['OWNER', 'COORDINATOR', 'SPECIALIST', 'QC', 'LAB', 'FINANCE'],
  'clients.save': ['OWNER', 'COORDINATOR'],
  'clients.archive': ['OWNER', 'COORDINATOR'],
  'sites.save': ['OWNER', 'COORDINATOR'],
  'sites.archive': ['OWNER', 'COORDINATOR'],
  'contracts.save': ['OWNER', 'COORDINATOR'],
  'services.list': ['*'],
  'services.save': ['OWNER'],

  'employees.list': ['OWNER', 'COORDINATOR', 'QC', 'LAB', 'FINANCE', 'SPECIALIST'],
  'employees.save': ['OWNER'],
  'employees.setActive': ['OWNER'],

  'visits.list': ['OWNER', 'COORDINATOR', 'SPECIALIST', 'QC', 'LAB', 'FINANCE'],
  'visits.get': ['OWNER', 'COORDINATOR', 'SPECIALIST', 'QC', 'LAB'],
  'visits.create': ['OWNER', 'COORDINATOR'],
  'visits.reschedule': ['OWNER', 'COORDINATOR'],
  'visits.cancel': ['OWNER', 'COORDINATOR'],
  'visits.start': ['SPECIALIST', 'OWNER', 'COORDINATOR'],
  'visits.finish': ['SPECIALIST', 'OWNER', 'COORDINATOR'],
  'visits.close': ['OWNER', 'COORDINATOR'],
  'visits.retryCalendar': ['OWNER', 'COORDINATOR'],

  'checklists.list': ['OWNER', 'COORDINATOR', 'QC'],
  'checklists.get': ['OWNER', 'COORDINATOR', 'QC', 'SPECIALIST'],
  'checklists.saveVersion': ['OWNER'],

  'results.save': ['SPECIALIST', 'OWNER', 'COORDINATOR'],
  'results.waivePhoto': ['OWNER', 'QC'],

  'files.upload': ['SPECIALIST', 'OWNER', 'COORDINATOR', 'QC', 'LAB', 'FINANCE'],
  'files.get': ['*'],
  'files.invalidate': ['SPECIALIST', 'OWNER', 'COORDINATOR', 'QC', 'LAB', 'FINANCE'],

  'reports.preview': ['SPECIALIST', 'OWNER', 'COORDINATOR', 'QC'],
  'reports.submit': ['SPECIALIST', 'OWNER', 'COORDINATOR'],
  'reports.queue': ['OWNER', 'QC', 'COORDINATOR'],
  'reports.get': ['OWNER', 'QC', 'COORDINATOR', 'SPECIALIST', 'LAB'],
  'reports.approve': ['OWNER', 'QC'],
  'reports.return': ['OWNER', 'QC'],

  'lab.list': ['OWNER', 'COORDINATOR', 'SPECIALIST', 'QC', 'LAB'],
  'lab.register': ['SPECIALIST', 'LAB', 'OWNER'],
  'lab.advance': ['SPECIALIST', 'LAB', 'OWNER'],
  'lab.review': ['LAB', 'QC', 'OWNER'],
  'lab.cancel': ['LAB', 'OWNER'],

  'tasks.list': ['*'],
  'tasks.create': ['OWNER', 'COORDINATOR', 'QC', 'LAB', 'FINANCE'],
  'tasks.start': ['*'],
  'tasks.submit': ['*'],
  'tasks.verify': ['OWNER', 'QC', 'COORDINATOR', 'LAB'],
  'tasks.reject': ['OWNER', 'QC', 'COORDINATOR', 'LAB'],
  'tasks.cancel': ['OWNER', 'COORDINATOR'],

  'finance.list': ['OWNER', 'FINANCE'],
  'finance.summary': ['OWNER', 'FINANCE'],
  'finance.accrue': ['OWNER', 'FINANCE'],
  'finance.invoice': ['OWNER', 'FINANCE'],
  'finance.payment': ['OWNER', 'FINANCE'],
  'finance.expense': ['OWNER', 'FINANCE'],
  'finance.adjust': ['OWNER', 'FINANCE'],
  'finance.approveAdjustment': ['OWNER'],

  'documents.list': ['OWNER', 'COORDINATOR', 'QC', 'LAB', 'FINANCE', 'SPECIALIST'],
  'audit.list': ['OWNER', 'COORDINATOR', 'QC', 'LAB', 'FINANCE'],
  'settings.get': ['OWNER'],
  'settings.save': ['OWNER'],
  'errors.list': ['OWNER'],
  'errors.resolve': ['OWNER'],
  'jobs.run': ['OWNER'],
  'analytics.get': ['OWNER', 'COORDINATOR'],
  'tasks.close': ['*'],
  'reports.html': ['OWNER', 'QC', 'COORDINATOR', 'SPECIALIST']
};

/* Дополнительные права сотрудника (колонка extra_perms, через запятую) */
var EXTRA_PERMS = {
  finance: ['finance.list', 'finance.summary'],
  finance_edit: ['finance.list', 'finance.summary', 'finance.accrue', 'finance.invoice', 'finance.payment', 'finance.expense', 'finance.adjust'],
  settings: ['settings.get', 'settings.save', 'checklists.saveVersion', 'services.save'],
  approve_reports: ['reports.approve', 'reports.return', 'reports.queue', 'results.waivePhoto'],
  lab: ['lab.list', 'lab.register', 'lab.advance', 'lab.review']
};

/* Меню по ролям (карта окон, раздел 2 инструкции) */
var ROLE_MENU = {
  OWNER: ['home', 'clients', 'visits', 'review', 'lab', 'tasks', 'finance', 'documents', 'analytics', 'staff', 'settings', 'audit'],
  COORDINATOR: ['home', 'clients', 'visits', 'review', 'lab', 'tasks', 'documents', 'analytics', 'audit'],
  SPECIALIST: ['home', 'myvisits', 'tasks', 'lab', 'documents'],
  QC: ['home', 'review', 'visits', 'tasks', 'lab', 'documents', 'audit'],
  FINANCE: ['home', 'finance', 'clients', 'tasks', 'documents', 'audit'],
  LAB: ['home', 'lab', 'visits', 'tasks', 'documents', 'audit']
};

/* ---------- Статусы (Приложение A ТЗ) ---------- */
var STATUS = {
  visit: {
    ASSIGNED: 'Назначен', RESCHEDULED: 'Перенесён', IN_PROGRESS: 'В работе',
    AWAITING_REPORT: 'Ожидает отчёт', IN_REVIEW: 'На проверке', RETURNED: 'Возвращён на доработку',
    APPROVED: 'Утверждён', CLOSED: 'Закрыт', CANCELLED: 'Отменён'
  },
  task: { NEW: 'Новая', IN_PROGRESS: 'В работе', ON_CHECK: 'На проверке', CLOSED: 'Закрыта', CANCELLED: 'Отменена' },
  lab: {
    REGISTERED: 'Зарегистрирована', COLLECTED: 'Отобрана', SENT: 'Передана', ACCEPTED: 'Принята лабораторией',
    AWAITING: 'Ожидает результат', RESULT: 'Результат получен', REVIEWED: 'Проверена', CANCELLED: 'Отменена'
  },
  report: { SUBMITTED: 'На проверке', RETURNED: 'Возвращён', APPROVED: 'Утверждён', SUPERSEDED: 'Заменён новой версией' },
  document: { DRAFT: 'Черновик', PENDING: 'На согласовании', APPROVED: 'Утверждён', ARCHIVED: 'Архивный' },
  client: { ACTIVE: 'Активный', PAUSED: 'Приостановлен', ARCHIVED: 'Архив' },
  contract: { DRAFT: 'Черновик', ACTIVE: 'Действует', EXPIRED: 'Истёк', TERMINATED: 'Расторгнут' },
  payment: { UNPAID: 'Не оплачен', PARTIAL: 'Частично', PAID: 'Оплачен', PENDING: 'Ожидает утверждения', APPROVED: 'Утверждена', REJECTED: 'Отклонена', POSTED: 'Проведено' },
  notification: { PENDING: 'В очереди', SENT: 'Отправлено', FAILED: 'Ошибка', SKIPPED: 'Пропущено' }
};

/* Допустимые переходы статуса выезда: из → [в] */
var VISIT_TRANSITIONS = {
  ASSIGNED: ['IN_PROGRESS', 'RESCHEDULED', 'CANCELLED'],
  RESCHEDULED: ['IN_PROGRESS', 'RESCHEDULED', 'CANCELLED'],
  IN_PROGRESS: ['AWAITING_REPORT', 'CANCELLED'],
  AWAITING_REPORT: ['IN_REVIEW'],
  IN_REVIEW: ['APPROVED', 'RETURNED'],
  RETURNED: ['IN_REVIEW'],
  APPROVED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: []
};

/* Цепочка лабораторной пробы и обязательные поля для перехода (раздел 7 ТЗ) */
var LAB_FLOW = ['REGISTERED', 'COLLECTED', 'SENT', 'ACCEPTED', 'AWAITING', 'RESULT', 'REVIEWED'];
var LAB_REQUIRED = {
  REGISTERED: ['visit_id', 'sample_type', 'sample_point'],
  COLLECTED: ['collected_at', 'label_code'],
  SENT: ['lab_name', 'sent_at'],
  ACCEPTED: ['accepted_at', 'lab_order_no'],
  AWAITING: ['result_due_at', 'responsible_id'],
  RESULT: ['result_date', 'protocol_no', 'result_file_id'],
  REVIEWED: ['decision']
};
var LAB_DECISIONS = { COMPLIANT: 'Соответствует', NONCOMPLIANT: 'Не соответствует', NEEDS_ACTION: 'Требуются действия', INCONCLUSIVE: 'Требуется перепроверка' };

var CHECK_RESULTS = { OK: 'Соответствует', NOK: 'Не соответствует', NA: 'Не применимо' };
var SEVERITY = { LOW: 'Низкая', NORMAL: 'Обычная', HIGH: 'Высокая', CRITICAL: 'Критическая' };
var PRIORITY = { LOW: 'Низкий', NORMAL: 'Обычный', HIGH: 'Высокий', CRITICAL: 'Критический' };
var TASK_SOURCES = { CHECKLIST: 'Замечание чек-листа', LAB: 'Лабораторный результат', REPORT_RETURN: 'Возврат отчёта', REPORT_REVIEW: 'Проверка отчёта', DOCUMENT: 'Срок документа', CLIENT: 'Запрос клиента', INTERNAL: 'Внутреннее поручение' };
var FIN_TYPES = { ACCRUAL: 'Начисление', INVOICE: 'Счёт', PAYMENT: 'Поступление', EXPENSE: 'Расход', ADJUSTMENT: 'Корректировка' };
var EXPENSE_CATEGORIES = ['Лаборатория', 'Транспорт', 'Расходные материалы', 'Зарплата', 'Аренда', 'Связь и ПО', 'Прочее'];
var DOC_TYPES = { PHOTO: 'Фото', REPORT_PDF: 'Отчёт (PDF)', LAB_PROTOCOL: 'Протокол лаборатории', LAB_REFERRAL: 'Направление в лабораторию', CONTRACT: 'Договор', INVOICE: 'Счёт', ACT: 'Акт', EVIDENCE: 'Подтверждение', OTHER: 'Прочее' };
var SAMPLE_TYPES = ['Смыв', 'Вода', 'Продукты', 'Воздух', 'Готовые блюда'];

/* ---------- Настройки по умолчанию (лист Settings) ---------- */
var SETTINGS_DEFAULTS = {
  COMPANY_NAME: ['San.Lab', 'Название в интерфейсе и отчётах'],
  AUTH_MODE: ['GOOGLE', 'GOOGLE — вход по аккаунту Workspace; PIN — e-mail + PIN-код'],
  INDEPENDENT_REVIEW: ['true', 'Запрет утверждать собственный отчёт / проверять собственную задачу'],
  REVIEW_DUE_HOURS: ['24', 'Срок проверки отчёта контролёром, часов'],
  ALLOW_CLOSE_WITH_PENDING_LAB: ['true', 'Можно закрыть выезд, пока лабораторный результат в работе'],
  NA_REQUIRES_COMMENT: ['true', '«Не применимо» требует пояснения'],
  NOK_REQUIRES_COMMENT: ['true', '«Не соответствует» требует комментария'],
  AUTO_TASK_SEVERITIES: ['HIGH,CRITICAL', 'Для каких замечаний автоматически создаётся корректирующая задача'],
  CRITICAL_REQUIRES_VERIFICATION: ['true', 'Критическая задача закрывается только после независимой проверки'],
  TASK_DUE_DAYS: ['{"CRITICAL":1,"HIGH":3,"NORMAL":7,"LOW":14}', 'Срок задачи по приоритету, дней'],
  TASK_REMIND_DAYS_BEFORE: ['1', 'За сколько дней напоминать о сроке задачи'],
  LAB_DUE_DAYS: ['{"Смыв":3,"Вода":5,"Продукты":7,"Воздух":5,"Готовые блюда":5}', 'Ожидаемый срок результата по типу пробы, дней'],
  LAB_DEFAULT_DUE_DAYS: ['5', 'Срок результата, если тип не указан в LAB_DUE_DAYS'],
  COORDINATOR_FINANCE_ACCESS: ['false', 'Координатор видит финансовую сводку'],
  PHOTO_MAX_MB: ['8', 'Максимальный размер фото, МБ'],
  PHOTO_ALLOWED_TYPES: ['image/jpeg,image/png,image/webp,image/heic', 'Допустимые форматы фото'],
  FILE_MAX_MB: ['15', 'Максимальный размер документа, МБ'],
  CALENDAR_ID: ['', 'ID календаря выездов (пусто — календарь владельца скрипта)'],
  CALENDAR_INVITE_EMPLOYEE: ['true', 'Добавлять исполнителя гостем в событие'],
  VISIT_REMINDER_HOUR: ['7', 'Час ежедневной рассылки напоминаний'],
  BACKUP_KEEP: ['14', 'Сколько резервных копий хранить'],
  INVOICE_PREFIX: ['СЧ', 'Префикс номера счёта'],
  DRIVE_ROOT_ID: ['', 'ID корневой папки San.Lab в Drive (заполняется при установке)'],
  TIMEZONE: ['Asia/Yekaterinburg', 'Часовой пояс отчётов']
};
