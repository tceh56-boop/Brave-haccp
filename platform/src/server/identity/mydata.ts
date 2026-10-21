import { withSystem } from '../db/pool';
import { audit } from '../audit/audit';

/**
 * «Мои данные» (152-ФЗ, ТЗ v2 §9, AT-15): субъект получает сведения о своих персональных данных в системе —
 * профиль, участие в организациях, сессии и входы (IP, устройство), свои действия в журнале аудита.
 * Хеши паролей и токенов не выдаются. Выгрузка записывается в аудит.
 */
export async function myData(userId: string) {
  return withSystem(async (tx) => {
    const user = (await tx.query(`select id, email, full_name, status, email_verified_at, created_at, updated_at from users where id = $1`, [userId])).rows[0];
    const memberships = (await tx.query(`select o.name as organization, m.role, m.position, m.status, m.site_ids, m.created_at from memberships m join organizations o on o.id = m.organization_id
      where m.user_id = $1 order by m.created_at`, [userId])).rows;
    const sessions = (await tx.query(`select created_at, last_seen_at, expires_at, revoked_at, ip, user_agent from sessions where user_id = $1 order by created_at desc limit 100`, [userId])).rows;
    const logins = (await tx.query(`select created_at, ip, success from login_attempts where email = $1 order by created_at desc limit 200`, [user.email])).rows;
    const actions = (await tx.query(`select e.created_at as at, e.action, e.entity_type, o.name as organization, e.result, e.ip from audit_events e left join organizations o on o.id = e.organization_id
      where e.actor_user_id = $1 order by e.id desc limit 500`, [userId])).rows;
    await audit.record(tx, { actorUserId: userId, action: 'user.data_export', entityType: 'user', entityId: userId, after: { sessions: sessions.length, actions: actions.length } });
    return {
      exported_at: new Date().toISOString(),
      note: 'Сведения о персональных данных пользователя в системе «ЦЕХ». Пароль и токены хранятся только в виде хешей и не выгружаются. Записи журналов пищевой безопасности, сделанные пользователем, принадлежат организации и хранятся по её правилам.',
      user, memberships, sessions, logins, actions,
    };
  });
}
