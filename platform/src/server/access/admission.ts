import type { Tx } from '../db/pool';
import { Errors } from '../http/errors';
import type { Membership } from './guard';
import type { Permission } from './roles';

/**
 * Допуск сотрудника к работе с продукцией (этап 16; механика MON CHEF «Employee Compliance Gate»).
 * В режиме предприятия «блокировать» сотрудник пищевой роли без действующих медосмотра и гигиенической аттестации,
 * без осмотра перед сменой за сегодня или признанный «не допущен» на осмотре не вносит записи по продукции.
 * В режиме «предупреждать» — только карточки в «Проблемах».
 * Решения владельца (доработка под кухню, вопрос 2): режим по умолчанию — «блокировать»; без сегодняшнего осмотра — нельзя;
 * кладовщик — пищевая роль (приёмка, вскрытие тары, перемещение продуктов).
 */

export const FOOD_ROLES = ['chef', 'line_staff', 'storekeeper'];
export type AdmissionMode = 'off' | 'warn' | 'block';

/**
 * Режим допуска организации: явная настройка предприятия; если её нет — значение установки ADMISSION_DEFAULT
 * (off | warn | block), иначе «блокировать».
 */
export async function admissionMode(tx: Tx, orgId: string): Promise<AdmissionMode> {
  const set = (await tx.query(`select medical_gate from staff_settings where organization_id = $1`, [orgId])).rows[0]?.medical_gate as AdmissionMode | undefined;
  if (set) return set;
  const env = process.env.ADMISSION_DEFAULT;
  return env === 'off' || env === 'warn' || env === 'block' ? env : 'block';
}
/** Действия с продукцией, закрытые без допуска. */
export const GATED: ReadonlySet<Permission> = new Set<Permission>(['measure.record', 'production.run', 'brakerage.decide', 'sample.record', 'sanitation.record', 'receipt.record', 'stock.consume', 'lot.open']);

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
  if ((await admissionMode(tx, m.organization_id)) !== 'block') return;
  const s = (await tx.query(`select org_today($1)::text as today`, [m.organization_id])).rows[0];
  const med = (await tx.query(`select exam_due::text as exam_due, hygiene_due::text as hygiene_due, restrictions from staff_medical
    where organization_id = $1 and user_id = $2 order by recorded_at desc limit 1`, [m.organization_id, m.user_id])).rows[0];
  const st = medicalState(med, s.today);
  if (st.status === 'missing') throw Errors.forbidden('Нет медицинского допуска: данные ЛМК не внесены. Запись не принимается — обратитесь к ответственному.');
  if (st.status === 'expired') throw Errors.forbidden('Нет медицинского допуска: срок медосмотра или гигиенической аттестации истёк. Запись не принимается — обратитесь к ответственному.');
  const hc = (await tx.query(`select admitted from health_checks where organization_id = $1 and user_id = $2 and checked_on = $3`, [m.organization_id, m.user_id, s.today])).rows[0];
  if (!hc) throw Errors.forbidden('Сегодня нет осмотра перед сменой: запись не принимается. Попросите шефа или ответственного отметить осмотр (журнал здоровья).');
  if (!hc.admitted) throw Errors.forbidden('Сегодня по осмотру перед сменой вы не допущены к работе с продукцией.');
}
