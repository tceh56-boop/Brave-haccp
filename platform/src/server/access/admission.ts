import type { Tx } from '../db/pool';
import { Errors } from '../http/errors';
import type { Membership } from './guard';
import type { Permission } from './roles';

/**
 * Допуск сотрудника к работе с продукцией (этап 16; механика MON CHEF «Employee Compliance Gate»).
 * В режиме предприятия «блокировать» сотрудник пищевой роли без действующих медосмотра и гигиенической аттестации
 * или признанный «не допущен» на сегодняшнем осмотре не вносит записи по продукции. В режиме «предупреждать»
 * — только карточки в «Проблемах».
 */

export const FOOD_ROLES = ['chef', 'line_staff'];
/** Действия с продукцией, закрытые без допуска. */
export const GATED: ReadonlySet<Permission> = new Set<Permission>(['measure.record', 'production.run', 'sample.record', 'sanitation.record', 'receipt.record', 'stock.consume', 'lot.open']);

export interface MedicalState { status: 'ok' | 'soon' | 'expired' | 'missing'; exam_due: string | null; hygiene_due: string | null; restrictions: string | null }

/** Медицинский допуск по последней записи: истёк один из сроков — «истёк», меньше 30 дней — «истекает». */
export function medicalState(row: { exam_due: string; hygiene_due: string; restrictions: string | null } | undefined, today: string): MedicalState {
  if (!row) return { status: 'missing', exam_due: null, hygiene_due: null, restrictions: null };
  const first = row.exam_due < row.hygiene_due ? row.exam_due : row.hygiene_due;
  const soon = new Date(`${today}T12:00:00Z`); soon.setUTCDate(soon.getUTCDate() + 30);
  const status = first < today ? 'expired' : first <= soon.toISOString().slice(0, 10) ? 'soon' : 'ok';
  return { status, exam_due: row.exam_due, hygiene_due: row.hygiene_due, restrictions: row.restrictions };
}

export async function admissionGate(tx: Tx, m: Membership, permission: Permission) {
  if (!GATED.has(permission) || !FOOD_ROLES.includes(m.role)) return;
  const s = (await tx.query(`select coalesce(st.medical_gate, 'warn') as gate, (now() at time zone o.timezone)::date::text as today
    from organizations o left join staff_settings st on st.organization_id = o.id where o.id = $1`, [m.organization_id])).rows[0];
  if (!s || s.gate !== 'block') return;
  const med = (await tx.query(`select exam_due::text as exam_due, hygiene_due::text as hygiene_due, restrictions from staff_medical
    where organization_id = $1 and user_id = $2 order by recorded_at desc limit 1`, [m.organization_id, m.user_id])).rows[0];
  const st = medicalState(med, s.today);
  if (st.status === 'missing') throw Errors.forbidden('Нет медицинского допуска: данные ЛМК не внесены. Запись не принимается — обратитесь к ответственному.');
  if (st.status === 'expired') throw Errors.forbidden('Нет медицинского допуска: срок медосмотра или гигиенической аттестации истёк. Запись не принимается — обратитесь к ответственному.');
  const hc = (await tx.query(`select admitted from health_checks where organization_id = $1 and user_id = $2 and checked_on = $3`, [m.organization_id, m.user_id, s.today])).rows[0];
  if (hc && !hc.admitted) throw Errors.forbidden('Сегодня по осмотру перед сменой вы не допущены к работе с продукцией.');
}
