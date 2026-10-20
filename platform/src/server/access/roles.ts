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
} as const;

export type Permission = keyof typeof PERMISSIONS;

interface RoleDef { label: string; summary: string; permissions: Permission[] }

const ALL = Object.keys(PERMISSIONS) as Permission[];

const STAFF: Permission[] = ['org.read', 'site.read', 'catalog.read', 'control.read', 'measure.record', 'receipt.record', 'lot.read', 'task.read', 'task.work', 'incident.read', 'incident.report'];
const READ_OPS: Permission[] = ['org.read', 'site.read', 'dashboard.read', 'catalog.read', 'control.read', 'lot.read', 'task.read', 'incident.read'];

export const ROLES = {
  owner: { label: 'Владелец', summary: 'Настройки организации, экономика, приглашения, утверждение ключевых документов', permissions: ALL },
  enterprise_admin: { label: 'Администратор предприятия', summary: 'Площадки, роли, справочники, журналы, интеграции', permissions: ALL },
  director: { label: 'Директор / управляющий', summary: 'Операционные отчёты, задачи, контроль исполнения',
    permissions: [...READ_OPS, 'member.read', 'audit.read', 'task.work', 'incident.report', 'incident.work', 'incident.confirm'] },
  chef: { label: 'Шеф / су-шеф', summary: 'ТТК, рецептуры, производственные задания, выходы и списания',
    permissions: [...STAFF, 'member.read', 'dashboard.read', 'catalog.manage', 'receipt.decide', 'incident.work', 'incident.confirm'] },
  technologist: { label: 'Технолог', summary: 'Технологические параметры, расчёты, документы',
    permissions: [...READ_OPS, 'catalog.manage', 'control.manage', 'control.approve', 'task.work', 'incident.report', 'incident.work'] },
  haccp_lead: { label: 'Ответственный ХАССП', summary: 'Опасности, журналы, CAPA, доказательства',
    permissions: [...STAFF, 'member.read', 'dashboard.read', 'control.manage', 'control.approve', 'receipt.decide', 'incident.work', 'incident.confirm'] },
  storekeeper: { label: 'Кладовщик / закупщик', summary: 'Заказы, приёмка, партии, склад, инвентаризация',
    permissions: [...STAFF, 'catalog.manage', 'dashboard.read'] },
  line_staff: { label: 'Сотрудник цеха', summary: 'Назначенные задания и журналы без изменения утверждённых норм', permissions: STAFF },
  accountant: { label: 'Бухгалтер / экономист', summary: 'Цены, себестоимость, выручка, отчёты', permissions: ['org.read', 'site.read', 'catalog.read', 'lot.read'] },
  hr: { label: 'HR / обучение', summary: 'Сотрудники, тесты, инструктажи и сроки', permissions: ['org.read', 'site.read', 'member.read', 'member.invite', 'member.manage', 'task.read'] },
  auditor: { label: 'Аудитор', summary: 'Чтение назначенных документов и доказательств', permissions: [...READ_OPS, 'audit.read'] },
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
