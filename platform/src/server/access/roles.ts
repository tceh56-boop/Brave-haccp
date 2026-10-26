/**
 * Роли и права (ТЗ v1 §4). Права проверяются на сервере для каждого действия и объекта; скрытая
 * кнопка в интерфейсе защитой не считается. Набор прав расширяется по этапам: здесь — права
 * этапа 1 (организация, площадки, участники, аудит).
 */

export const PERMISSIONS = {
  'org.read': 'Просмотр организации',
  'org.update': 'Изменение реквизитов организации',
  'site.read': 'Просмотр площадок',
  'site.manage': 'Создание и изменение площадок',
  'member.read': 'Просмотр сотрудников',
  'member.invite': 'Приглашение сотрудников',
  'member.manage': 'Смена роли и блокировка сотрудников',
  'audit.read': 'Просмотр журнала аудита',
  // Этап 2: смена сотрудника и дашборд проблем.
  'dashboard.read': 'Дашборд проблем',
  'catalog.read': 'Просмотр товаров и поставщиков',
  'catalog.manage': 'Ведение товаров и поставщиков',
  'control.read': 'Просмотр объектов контроля и правил',
  'control.manage': 'Ведение объектов контроля и проектов правил',
  'control.approve': 'Утверждение правил контроля (пределы, частота, реакция)',
  'measure.record': 'Внесение замеров',
  'receipt.record': 'Приёмка',
  'receipt.decide': 'Решение по карантину',
  'lot.read': 'Просмотр партий и сроков',
  'task.read': 'Просмотр задач',
  'task.work': 'Выполнение задач',
  'incident.read': 'Просмотр отклонений',
  'incident.report': 'Сообщить о проблеме',
  'incident.work': 'Работа с отклонением',
  'incident.confirm': 'Подтверждение закрытия отклонения',
  // Этап 3: склад, FEFO, списания, прослеживаемость.
  'stock.consume': 'Расход со склада (FEFO)',
  'stock.write_off': 'Списание',
  'stock.transfer': 'Перемещение между площадками',
  'stock.count': 'Инвентаризация',
  'trace.read': 'Прослеживаемость партий',
  // Этап 4: нормативный реестр.
  'reg.read': 'Просмотр нормативного реестра',
  'reg.manage': 'Ведение нормативного реестра и профиля',
  'reg.verify': 'Проверка редакции и применимости специалистом',
  'reg.approve': 'Утверждение редакции для применения',
  // Этап 5: журналы ХАССП, CAPA, доказательства.
  'journal.read': 'Просмотр и выгрузка журналов',
  'journal.record': 'Ручная запись в журнал',
  'journal.sign': 'Подпись журнала за период',
  'haccp.read': 'Просмотр плана ХАССП',
  'haccp.manage': 'Ведение плана ХАССП: этапы, опасности, мониторинг',
  'haccp.approve': 'Утверждение плана ХАССП',
  'capa.read': 'Просмотр CAPA',
  'capa.manage': 'Ведение CAPA: причина, действия, исполнение',
  'capa.verify': 'Проверка эффективности CAPA',
  'evidence.read': 'Просмотр доказательств',
  'evidence.add': 'Прикрепление доказательств (фото, документы)',
  'pack.export': 'Пакет документов для проверки',
  // Этап 6: блюда, ТТК, себестоимость.
  'menu.read': 'Просмотр блюд и ТТК',
  'ttk.manage': 'Разработка ТТК: состав, технология, сопоставление сырья',
  'ttk.approve': 'Утверждение ТТК',
  'sto.approve': 'Утверждение стандартов организации (СТО) — руководитель',
  'menu.price': 'Цены продажи блюд',
  'cost.read': 'Себестоимость, цены закупки, фудкост',
  // Этап 6: касса, продажи, экономика.
  'pos.sell': 'Касса: смена, заказы, оплата',
  'pos.refund': 'Возврат и отмена оплаченного',
  'pos.stop': 'Стоп-лист',
  'sales.manage': 'Импорт продаж внешней кассы, очередь списания',
  'econ.read': 'Экономика: выручка, себестоимость продаж, маржа',
  // Этап 7: AI-помощник.
  'ai.use': 'AI-помощник: объяснение, поиск требований с цитатой, предложения',
  'ai.audit': 'Журнал AI: входные данные, источники, ответы, решения',
  // Этап 8: пилот.
  'pilot.read': 'Готовность к пилоту',
  'pilot.confirm': 'Подтверждения ответственных для пилота',
  'pilot.decide': 'Решение Go/No-Go',
  // Этап 9: маркировка.
  'label.print': 'Печать этикеток партий',
  'lot.open': 'Вскрытие тары (новый срок, этикетка)',
  // Этап 10: производство полуфабрикатов.
  'production.read': 'Просмотр производственных заданий',
  'production.plan': 'Планирование и отмена производственных заданий',
  'production.run': 'Выполнение заданий: старт, замеры при выпуске, выпуск партии п/ф',
  // Этап 12: закупки.
  'purchase.read': 'Закупки: что заказать, заказы поставщикам, нормы запаса',
  'purchase.manage': 'Заказы поставщикам и нормы запаса',
  // Этап 13: план-меню (мероприятия, банкеты).
  'event.read': 'План-меню: мероприятия, меню, потребность',
  'event.manage': 'Мероприятия: меню, порции, подтверждение, проведение и списание',
  // Этап 14: суточные пробы и лабораторный контроль.
  'sample.record': 'Суточные пробы: отбор и уничтожение по сроку',
  'lab.read': 'Лабораторный контроль: программа и результаты',
  'lab.manage': 'Программа лабораторного контроля, результаты исследований, параметры проб',
  // Этап 15: оборудование и санитария.
  'equipment.read': 'Оборудование: реестр, поверка, ТО, неисправности',
  'equipment.report': 'Сообщить о неисправности оборудования',
  'equipment.manage': 'Реестр оборудования, ТО, поверка, ремонт и допуск к работе',
  'sanitation.record': 'Санитария: отметка выполнения уборки, дезинфекции, мойки',
  'sanitation.verify': 'Санитария: проверка выполнения',
  'sanitation.manage': 'Санитария: дезсредства, режимы, план уборок',
  // Этап 16: персонал.
  'staff.read': 'Персонал: готовность к работе (допуск, осмотр, инструктажи)',
  'staff.medical': 'Медицинский допуск: даты медосмотра и аттестации (персональные данные о здоровье)',
  'staff.health_check': 'Осмотр сотрудников перед сменой',
  'staff.brief': 'Инструктажи и обучение: темы, проведение',
  // Этап 17: распознавание документов (Yandex Vision / YandexGPT).
  'recognition.manage': 'Распознавание документов: включение, виды, лимит, проверка подключения (платно)',
} as const;

export type Permission = keyof typeof PERMISSIONS;

interface RoleDef { label: string; summary: string; permissions: Permission[] }

const ALL = Object.keys(PERMISSIONS) as Permission[];

const STAFF: Permission[] = ['org.read', 'site.read', 'catalog.read', 'control.read', 'measure.record', 'receipt.record', 'lot.read', 'task.read', 'task.work', 'incident.read', 'incident.report', 'stock.consume', 'journal.read', 'journal.record', 'evidence.read', 'evidence.add', 'menu.read', 'ai.use', 'label.print', 'lot.open', 'production.read', 'production.run', 'event.read', 'sample.record', 'equipment.read', 'equipment.report', 'sanitation.record'];
const READ_OPS: Permission[] = ['org.read', 'site.read', 'dashboard.read', 'catalog.read', 'control.read', 'lot.read', 'task.read', 'incident.read', 'trace.read', 'reg.read', 'journal.read', 'haccp.read', 'capa.read', 'evidence.read', 'pack.export', 'menu.read', 'ai.use', 'production.read', 'event.read', 'lab.read', 'equipment.read'];

export const ROLES = {
  owner: { label: 'Владелец', summary: 'Настройки организации, экономика, приглашения, утверждение ключевых документов', permissions: ALL },
  enterprise_admin: { label: 'Администратор предприятия', summary: 'Площадки, роли, справочники, журналы, интеграции', permissions: ALL },
  director: { label: 'Директор / управляющий', summary: 'Операционные отчёты, задачи, контроль исполнения',
    permissions: [...READ_OPS, 'member.read', 'audit.read', 'task.work', 'incident.report', 'incident.work', 'incident.confirm', 'reg.approve', 'journal.sign', 'haccp.approve', 'capa.verify', 'ttk.approve', 'sto.approve', 'menu.price', 'cost.read', 'pos.sell', 'pos.refund', 'pos.stop', 'sales.manage', 'econ.read', 'ai.audit', 'pilot.read', 'pilot.confirm', 'purchase.read', 'purchase.manage', 'event.manage', 'equipment.manage', 'sanitation.verify', 'staff.read', 'staff.medical', 'staff.health_check', 'staff.brief', 'recognition.manage'] },
  chef: { label: 'Шеф / су-шеф', summary: 'ТТК, рецептуры, производственные задания, выходы и списания',
    permissions: [...STAFF, 'member.read', 'dashboard.read', 'catalog.manage', 'receipt.decide', 'incident.work', 'incident.confirm', 'stock.write_off', 'stock.transfer', 'stock.count', 'trace.read', 'reg.read', 'journal.sign', 'haccp.read', 'capa.read', 'capa.manage', 'capa.verify', 'ttk.manage', 'ttk.approve', 'menu.price', 'cost.read', 'pos.stop', 'sales.manage', 'production.plan', 'purchase.read', 'purchase.manage', 'event.manage', 'lab.read', 'equipment.manage', 'sanitation.verify', 'sanitation.manage', 'staff.read', 'staff.health_check', 'staff.brief'] },
  technologist: { label: 'Технолог', summary: 'Технологические параметры, расчёты, документы',
    permissions: [...READ_OPS, 'catalog.manage', 'control.manage', 'control.approve', 'task.work', 'incident.report', 'incident.work', 'reg.manage', 'reg.verify', 'haccp.manage', 'capa.manage', 'evidence.add', 'ttk.manage', 'ttk.approve', 'cost.read', 'label.print', 'production.plan', 'lab.manage', 'equipment.manage', 'sanitation.manage', 'sanitation.verify', 'staff.read', 'staff.brief'] },
  haccp_lead: { label: 'Ответственный ХАССП', summary: 'Опасности, журналы, CAPA, доказательства',
    permissions: [...STAFF, 'member.read', 'dashboard.read', 'control.manage', 'control.approve', 'receipt.decide', 'incident.work', 'incident.confirm', 'stock.write_off', 'trace.read', 'reg.read', 'reg.manage', 'reg.verify', 'journal.sign', 'haccp.read', 'haccp.manage', 'capa.read', 'capa.manage', 'capa.verify', 'pack.export', 'pilot.read', 'lab.read', 'lab.manage', 'equipment.manage', 'sanitation.manage', 'sanitation.verify', 'staff.read', 'staff.medical', 'staff.health_check', 'staff.brief'] },
  storekeeper: { label: 'Кладовщик / закупщик', summary: 'Заказы, приёмка, партии, склад, инвентаризация',
    permissions: [...STAFF, 'catalog.manage', 'dashboard.read', 'stock.write_off', 'stock.transfer', 'stock.count', 'trace.read', 'purchase.read', 'purchase.manage'] },
  line_staff: { label: 'Сотрудник цеха', summary: 'Назначенные задания и журналы без изменения утверждённых норм', permissions: STAFF },
  accountant: { label: 'Бухгалтер / экономист', summary: 'Цены, себестоимость, выручка, отчёты', permissions: ['org.read', 'site.read', 'catalog.read', 'lot.read', 'trace.read', 'menu.read', 'cost.read', 'menu.price', 'sales.manage', 'econ.read', 'purchase.read', 'event.read'] },
  cashier: { label: 'Кассир / официант', summary: 'Смена кассы, заказы, оплата; чек пробивает ККТ предприятия',
    permissions: ['org.read', 'site.read', 'menu.read', 'pos.sell', 'task.read', 'incident.read', 'incident.report'] },
  hr: { label: 'HR / обучение', summary: 'Сотрудники, тесты, инструктажи и сроки', permissions: ['org.read', 'site.read', 'member.read', 'member.invite', 'member.manage', 'task.read'] },
  auditor: { label: 'Аудитор', summary: 'Чтение назначенных документов и доказательств', permissions: [...READ_OPS, 'audit.read', 'ai.audit', 'pilot.read'] },
} satisfies Record<string, RoleDef>;

export type Role = keyof typeof ROLES;

export function isRole(x: unknown): x is Role {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(ROLES, x);
}

export function roleHas(role: string, permission: Permission): boolean {
  return isRole(role) && (ROLES[role].permissions as readonly string[]).includes(permission);
}

/**
 * Кого может назначать роль: владелец — любую роль; администратор — любую, кроме владельца;
 * HR — линейные и специалистов, но не владельца, администратора и аудитора.
 */
export function canAssignRole(actor: string, target: Role): boolean {
  if (actor === 'owner') return true;
  if (actor === 'enterprise_admin') return target !== 'owner';
  if (actor === 'hr') return !['owner', 'enterprise_admin', 'auditor', 'hr'].includes(target);
  return false;
}
