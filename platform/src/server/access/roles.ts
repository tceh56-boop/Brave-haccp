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
} as const;

export type Permission = keyof typeof PERMISSIONS;

interface RoleDef { label: string; summary: string; permissions: Permission[] }

const ALL = Object.keys(PERMISSIONS) as Permission[];

const STAFF: Permission[] = ['org.read', 'site.read', 'catalog.read', 'control.read', 'measure.record', 'receipt.record', 'lot.read', 'task.read', 'task.work', 'incident.read', 'incident.report', 'stock.consume', 'journal.read', 'journal.record', 'evidence.read', 'evidence.add', 'menu.read', 'ai.use', 'label.print', 'lot.open'];
const READ_OPS: Permission[] = ['org.read', 'site.read', 'dashboard.read', 'catalog.read', 'control.read', 'lot.read', 'task.read', 'incident.read', 'trace.read', 'reg.read', 'journal.read', 'haccp.read', 'capa.read', 'evidence.read', 'pack.export', 'menu.read', 'ai.use'];

export const ROLES = {
  owner: { label: 'Владелец', summary: 'Настройки организации, экономика, приглашения, утверждение ключевых документов', permissions: ALL },
  enterprise_admin: { label: 'Администратор предприятия', summary: 'Площадки, роли, справочники, журналы, интеграции', permissions: ALL },
  director: { label: 'Директор / управляющий', summary: 'Операционные отчёты, задачи, контроль исполнения',
    permissions: [...READ_OPS, 'member.read', 'audit.read', 'task.work', 'incident.report', 'incident.work', 'incident.confirm', 'reg.approve', 'journal.sign', 'haccp.approve', 'capa.verify', 'ttk.approve', 'menu.price', 'cost.read', 'pos.sell', 'pos.refund', 'pos.stop', 'sales.manage', 'econ.read', 'ai.audit', 'pilot.read', 'pilot.confirm'] },
  chef: { label: 'Шеф / су-шеф', summary: 'ТТК, рецептуры, производственные задания, выходы и списания',
    permissions: [...STAFF, 'member.read', 'dashboard.read', 'catalog.manage', 'receipt.decide', 'incident.work', 'incident.confirm', 'stock.write_off', 'stock.transfer', 'stock.count', 'trace.read', 'reg.read', 'journal.sign', 'haccp.read', 'capa.read', 'capa.manage', 'capa.verify', 'ttk.manage', 'ttk.approve', 'menu.price', 'cost.read', 'pos.stop', 'sales.manage'] },
  technologist: { label: 'Технолог', summary: 'Технологические параметры, расчёты, документы',
    permissions: [...READ_OPS, 'catalog.manage', 'control.manage', 'control.approve', 'task.work', 'incident.report', 'incident.work', 'reg.manage', 'reg.verify', 'haccp.manage', 'capa.manage', 'evidence.add', 'ttk.manage', 'ttk.approve', 'cost.read', 'label.print'] },
  haccp_lead: { label: 'Ответственный ХАССП', summary: 'Опасности, журналы, CAPA, доказательства',
    permissions: [...STAFF, 'member.read', 'dashboard.read', 'control.manage', 'control.approve', 'receipt.decide', 'incident.work', 'incident.confirm', 'stock.write_off', 'trace.read', 'reg.read', 'reg.manage', 'reg.verify', 'journal.sign', 'haccp.read', 'haccp.manage', 'capa.read', 'capa.manage', 'capa.verify', 'pack.export', 'pilot.read'] },
  storekeeper: { label: 'Кладовщик / закупщик', summary: 'Заказы, приёмка, партии, склад, инвентаризация',
    permissions: [...STAFF, 'catalog.manage', 'dashboard.read', 'stock.write_off', 'stock.transfer', 'stock.count', 'trace.read'] },
  line_staff: { label: 'Сотрудник цеха', summary: 'Назначенные задания и журналы без изменения утверждённых норм', permissions: STAFF },
  accountant: { label: 'Бухгалтер / экономист', summary: 'Цены, себестоимость, выручка, отчёты', permissions: ['org.read', 'site.read', 'catalog.read', 'lot.read', 'trace.read', 'menu.read', 'cost.read', 'menu.price', 'sales.manage', 'econ.read'] },
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
