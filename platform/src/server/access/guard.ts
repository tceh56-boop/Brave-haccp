import type { Tx } from '../db/pool';
import { Errors } from '../http/errors';
import { roleHas, moduleOf, MODULES, type Permission } from './roles';
import { audit } from '../audit/audit';

export interface Membership {
  id: string;
  organization_id: string;
  user_id: string;
  role: string;
  site_ids: string[];
  status: 'active' | 'blocked';
  modules: string[];                                   // включённые модули организации
}

/**
 * Право на действие в организации (и на площадке, если она указана). Отказ пишется в аудит
 * отдельной записью — попытка доступа не теряется вместе с откатом транзакции действия.
 */
export async function requirePermission(tx: Tx, userId: string, orgId: string, permission: Permission, siteId?: string | null): Promise<Membership> {
  const m = (await tx.query<Membership>(
    `select m.id, m.organization_id, m.user_id, m.role, m.site_ids, m.status, o.modules from memberships m join organizations o on o.id = m.organization_id
      where m.organization_id = $1 and m.user_id = $2`, [orgId, userId])).rows[0];
  // Чужая организация и заблокированный участник неотличимы для клиента: «не найдено».
  if (!m || m.status !== 'active') throw Errors.notFound('Организация не найдена.');
  if (!roleHas(m.role, permission)) {
    await audit.denied({ organizationId: orgId, actorUserId: userId, action: permission, reason: `роль ${m.role}` });
    throw Errors.forbidden();
  }
  const mod = moduleOf(permission);
  if (mod && !m.modules.includes(mod)) {
    await audit.denied({ organizationId: orgId, actorUserId: userId, action: permission, reason: `модуль ${mod} выключен` });
    throw Errors.forbidden(`Модуль «${MODULES[mod].label}» выключен в настройках организации.`);
  }
  if (siteId && m.site_ids.length && !m.site_ids.includes(siteId)) {
    await audit.denied({ organizationId: orgId, actorUserId: userId, action: permission, entityType: 'site', entityId: siteId, reason: 'площадка вне области доступа' });
    throw Errors.forbidden('Нет доступа к этой площадке.');
  }
  return m;
}
