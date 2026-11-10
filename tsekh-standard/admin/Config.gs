/**
 * ЦЕХ Стандарт Admin — конфигурация.
 *
 * Отдельный проект Apps Script (не путать с проектом клиента). База — своя Google-таблица администратора,
 * её ID хранится в свойстве скрипта ADMIN_SHEET_ID (создаётся функцией setupAdmin()).
 * Все секреты — только в свойствах скрипта (Script Properties), в таблице их нет:
 *   ADMIN_SHEET_ID, LIC_SECRET_<ключ>, YOOKASSA_SHOP_ID, YOOKASSA_SECRET, YOOMONEY_WALLET, YOOMONEY_NOTIFY_SECRET,
 *   MASTER_SCRIPT_ID (проект-эталон для обновления клиентов), WEBHOOK_TOKEN.
 */
var APP_NAME = 'ЦЕХ Стандарт Admin';
var APP_VERSION = '1.0.0';

// Листы базы и их колонки. Порядок колонок — контракт: код читает и пишет по именам колонок.
var SHEETS = {
  Users: ['Email', 'Имя', 'Роль', 'Статус', 'Хэш пароля', 'Соль', 'Последний вход', 'Создан'],
  Organizations: ['ID', 'Название', 'Email', 'Телефон', 'ИНН', 'Адрес', 'Дата регистрации', 'Тариф', 'Статус', 'Окончание подписки',
    'Сотрудников', 'ТТК', 'Журналов', 'Размер базы', 'Версия', 'Последний вход', 'Google Drive ID', 'License Key', 'Script ID', 'App URL', 'Менеджер', 'Комментарий', 'Команды'],
  Licenses: ['License Key', 'OrgID', 'Организация', 'Статус', 'Активирована', 'Дата окончания', 'Устройств', 'Последняя проверка', 'Последний IP', 'Версия клиента', 'Создана', 'Кто создал'],
  Subscriptions: ['ID', 'OrgID', 'Организация', 'Тариф', 'Статус', 'Начало', 'Окончание', 'Автоплатеж', 'Способ оплаты', 'Подключение', 'Обслуживание в месяц', 'Следующее списание', 'История'],
  Payments: ['ID', 'Дата', 'OrgID', 'Клиент', 'Сумма', 'Статус', 'Платежная система', 'ID платежа', 'Invoice', 'Назначение', 'Месяцев', 'Тариф', 'Комментарий', 'Ссылка на оплату'],
  Invoices: ['Номер', 'Дата', 'OrgID', 'Клиент', 'Сумма', 'Назначение', 'Статус', 'PaymentID', 'Файл'],
  Logs: ['Дата', 'Тип', 'Администратор', 'Объект', 'Описание'],
  Notifications: ['ID', 'Дата', 'Канал', 'Группа', 'Тема', 'Текст', 'Получателей', 'Статус', 'Кто'],
  Errors: ['Дата', 'Источник', 'Сообщение', 'Детали'],
  Backups: ['ID', 'Дата', 'OrgID', 'Клиент', 'Размер', 'Drive File ID', 'Ссылка', 'Кто', 'Статус'],
  Analytics: ['Дата', 'Клиентов', 'Активных', 'Новых', 'Ушедших', 'MRR', 'ARR', 'Выручка за день'],
  System_Settings: ['Ключ', 'Значение', 'Описание'],
  API_Keys: ['ID', 'Название', 'Хэш ключа', 'Права', 'Создан', 'Последнее использование', 'Статус'],
  Updates: ['Версия', 'Дата', 'Описание', 'Статус', 'Опубликовал', 'Обновлено клиентов', 'Ссылка на сборку'],
  TTK_Library: ['ID', 'Название', 'Категория', 'Выход', 'Состав (JSON)', 'Технология', 'Белки', 'Жиры', 'Углеводы', 'Ккал', 'Срок годности', 'Условия хранения', 'Источник', 'Статус', 'Обновлено']
};

// Тарифы по умолчанию (меняются в «Настройки → Тарифы», хранятся в System_Settings/TARIFFS).
// Pro Max: в задании указано «7000» — принято как обслуживание 7000 ₽/мес; стоимость подключения
// (70 000 ₽, как у Pro) нужно подтвердить и при необходимости поменять в настройках.
var DEFAULT_TARIFFS = [
  { code: 'basic', name: 'Basic', setup: 30000, monthly: 3000, features: ['Загрузка ТТК', 'Сроки реализации', 'КБЖУ', 'Сроки хранения', 'Себестоимость', 'Приёмка', 'Маркировка', 'Экономика'] },
  { code: 'basic_pro', name: 'Basic Pro', setup: 50000, monthly: 3000, features: ['Всё из Basic', 'Журналы', 'ППК'] },
  { code: 'pro', name: 'Pro', setup: 70000, monthly: 5000, features: ['Всё из Basic Pro', 'Партии', 'Лабораторные исследования', 'Договоры'] },
  { code: 'pro_max', name: 'Pro Max', setup: 70000, monthly: 7000, features: ['Всё из Pro', 'AI-ассистент', 'База отработанных ТТК'], note: 'Цена подключения требует подтверждения' }
];

// Роли администраторов и их права
var ROLES = {
  SUPER_ADMIN: { name: 'Super Admin', can: ['*'] },
  MANAGER: { name: 'Manager', can: ['dashboard', 'clients.view', 'clients.edit', 'subs.view', 'subs.edit', 'payments.view', 'payments.edit', 'licenses.view', 'licenses.edit', 'notify.send', 'analytics', 'backups.view', 'logs.view', 'ttk.view'] },
  SUPPORT: { name: 'Support', can: ['dashboard', 'clients.view', 'subs.view', 'licenses.view', 'notify.send', 'logs.view', 'backups.view', 'backups.create', 'ttk.view'] },
  DEVELOPER: { name: 'Developer', can: ['dashboard', 'clients.view', 'licenses.view', 'updates', 'logs.view', 'backups.view', 'backups.create', 'settings.view', 'ttk.view', 'ttk.edit', 'analytics'] }
};

var SESSION_TTL_MIN = 120;      // сессия администратора
var LOGIN_MAX_FAILS = 5;        // неудачных входов подряд → блокировка на 15 минут
var EXPIRING_DAYS = 14;         // «истекает» — за столько дней до окончания
var PASSWORD_ITER = 2000;       // итераций SHA-256 для пароля
