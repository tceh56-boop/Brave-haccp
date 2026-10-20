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
} as const;

export type Permission = keyof typeof PERMISSIONS;

interface RoleDef { label: string; summary: string; permissions: Permission[] }

const ALL = Object.keys(PERMISSIONS) as Permission[];

export const ROLES = {
  owner: { label: 'Владелец', summary: 'Настройки организации, экономика, приглашения, утверждение ключевых документов', permissions: ALL },
  enterprise_admin: { label: 'Администратор предприятия', summary: 'Площадки, роли, справочники, журналы, интеграции', permissions: ALL },
  director: { label: 'Директор / управляющий', summary: 'Операционные отчёты, задачи, контроль исполнения', permissions: ['org.read', 'site.read', 'member.read', 'audit.read'] },
  chef: { label: 'Шеф / су-шеф', summary: 'ТТК, рецептуры, производственные задания, выходы и списания', permissions: ['org.read', 'site.read', 'member.read'] },
  technologist: { label: 'Технолог', summary: 'Технологические параметры, расчёты, документы', permissions: ['org.read', 'site.read'] },
  haccp_lead: { label: 'Ответственный ХАССП', summary: 'Опасности, журналы, CAPA, доказательства', permissions: ['org.read', 'site.read', 'member.read'] },
  storekeeper: { label: 'Кладовщик / закупщик', summary: 'Заказы, приёмка, партии, склад, инвентаризация', permissions: ['org.read', 'site.read'] },
  line_staff: { label: 'Сотрудник цеха', summary: 'Назначенные задания и журналы без изменения утверждённых норм', permissions: ['org.read', 'site.read'] },
  accountant: { label: 'Бухгалтер / экономист', summary: 'Цены, себестоимость, выручка, отчёты', permissions: ['org.read', 'site.read'] },
  hr: { label: 'HR / обучение', summary: 'Сотрудники, тесты, инструктажи и сроки', permissions: ['org.read', 'site.read', 'member.read', 'member.invite', 'member.manage'] },
  auditor: { label: 'Аудитор', summary: 'Чтение назначенных документов и доказательств', permissions: ['org.read', 'site.read', 'audit.read'] },
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
