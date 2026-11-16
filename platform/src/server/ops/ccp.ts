import type { Tx } from '../db/pool';
import { fmtNum } from './common';

/**
 * ККТ из производства (этап 1 доработки под кухню и ХАССП). Какие замеры нужны при выпуске — только из документов:
 *  - этап утверждённой ТТК ссылается на ККТ/ОПП плана ХАССП (код опасности, ttk_stages.ccp_code);
 *  - мониторинг этой опасности в утверждённом плане задаёт форму записи (J22 — тепловая обработка, J23 — охлаждение,
 *    J24 — разогрев) и корректирующее действие;
 *  - числовой предел — утверждённый параметр выпуска блюда (release_checks, status = 'active') с тем же кодом.
 * Нет утверждённого плана, мониторинга или предела — «не настроено» и выпуск закрыт (fail-closed), а не «в норме».
 * Параметры выпуска без кода ККТ (введённые до этапа) действуют как прежде.
 */

export type CheckKind = 'core_temp' | 'cooling' | 'reheat' | 'other';
export const KIND_LABEL: Record<CheckKind, string> = { core_temp: 'Тепловая обработка: температура в толще', cooling: 'Охлаждение: начало и конец', reheat: 'Разогрев', other: 'Замер при выпуске' };
/** Форма записи мониторинга → вид замера при выпуске. */
export const FORM_KIND: Record<string, CheckKind> = { J22: 'core_temp', J23: 'cooling', J24: 'reheat' };
export const KIND_FORM: Partial<Record<CheckKind, string>> = { core_temp: 'J22', cooling: 'J23', reheat: 'J24' };
/** Для замеров ККТ щуп обязателен: только прибор из реестра с действующей поверкой. */
export const NEEDS_PROBE = new Set<CheckKind>(['core_temp', 'cooling', 'reheat']);

export interface Monitoring { code: string; class: string | null; what: string; critical_limit: string | null; corrective_action: string; record_form: string | null; plan_version: number }

/** Мониторинг опасности с данным кодом в утверждённом плане ХАССП организации. */
export async function monitoringByCode(tx: Tx, orgId: string, codes: string[]): Promise<Map<string, Monitoring>> {
  if (!codes.length) return new Map();
  const rows = (await tx.query(`select h.code, h.class, m.what, m.critical_limit, m.corrective_action, m.record_form, p.version as plan_version
    from haccp_plans p join haccp_hazards h on h.plan_id = p.id join haccp_monitoring m on m.hazard_id = h.id
    where p.organization_id = $1 and p.status = 'approved' and h.code = any($2::text[]) and h.class in ('ccp', 'oprp')`, [orgId, codes])).rows;
  return new Map(rows.map((r) => [r.code as string, r as Monitoring]));
}

type Lim = { kind?: string; min_value: string | number | null; max_value: string | number | null; unit: string; max_minutes?: string | number | null; start_min?: string | number | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const limitsText = (row: Record<string, any>) => {
  const c = row as Lim;
  const v = [c.min_value !== null && c.min_value !== undefined ? `не ниже ${fmtNum(c.min_value)}` : '', c.max_value !== null && c.max_value !== undefined ? `не выше ${fmtNum(c.max_value)}` : ''].filter(Boolean).join(' и ') + ` ${c.unit}`;
  if (c.kind !== 'cooling') return v;
  return [c.start_min != null ? `в начале не ниже ${fmtNum(c.start_min)} ${c.unit}` : '', `в конце ${v}`, c.max_minutes != null ? `за ${fmtNum(c.max_minutes)} мин` : ''].filter(Boolean).join(', ');
};

export interface Requirement {
  key: string; ccp_code: string | null; kind: CheckKind; kind_label: string; source: string;
  state: 'ready' | 'not_configured'; reason: string | null;
  check: Record<string, any> | null; monitoring: Monitoring | null;
}

/**
 * Требования к замерам при выпуске задания: этапы ТТК с ККТ + действующие параметры выпуска блюда.
 * Для каждого — готов ли утверждённый предел.
 */
export async function requirementsFor(tx: Tx, orgId: string, o: { dish_id: string; ttk_version_id: string }): Promise<Requirement[]> {
  const stages = (await tx.query(`select position, operation, ccp_code from ttk_stages where version_id = $1 and ccp_code is not null order by position`, [o.ttk_version_id])).rows;
  const checks = (await tx.query(`select * from release_checks where dish_id = $1 and status in ('active', 'draft') order by created_at`, [o.dish_id])).rows;
  const ver = (await tx.query(`select v.version, d.name from ttk_versions v join dishes d on d.id = v.dish_id where v.id = $1`, [o.ttk_version_id])).rows[0];
  const codes = [...new Set([...stages.map((s) => s.ccp_code as string), ...checks.map((c) => c.ccp_code).filter(Boolean)])];
  const mon = await monitoringByCode(tx, orgId, codes);
  const out: Requirement[] = [];
  const seen = new Set<string>();
  for (const s of stages) {
    if (seen.has(s.ccp_code)) continue;
    seen.add(s.ccp_code);
    const m = mon.get(s.ccp_code) || null;
    const kind: CheckKind = (m?.record_form && FORM_KIND[m.record_form]) || 'other';
    const active = checks.find((c) => c.status === 'active' && c.ccp_code === s.ccp_code) || null;
    const draft = checks.find((c) => c.status === 'draft' && c.ccp_code === s.ccp_code);
    const reason = !m ? `${s.ccp_code} нет среди ККТ/ОПП с мониторингом в утверждённом плане ХАССП`
      : !active ? (draft ? `предел «${draft.name}» ждёт утверждения` : 'нет утверждённого предела для этого блюда')
      : active.kind !== kind ? `вид замера параметра («${KIND_LABEL[active.kind as CheckKind]}») не совпадает с формой мониторинга ${m.record_form || '—'}` : null;
    out.push({ key: `ccp:${s.ccp_code}`, ccp_code: s.ccp_code, kind, kind_label: KIND_LABEL[kind], source: `ТТК «${ver.name}» v${ver.version}, этап ${s.position} «${s.operation}» — ${s.ccp_code}`,
      state: reason ? 'not_configured' : 'ready', reason, check: reason ? null : active, monitoring: m });
  }
  for (const c of checks) {
    if (c.status !== 'active' || (c.ccp_code && seen.has(c.ccp_code))) continue;
    const m = c.ccp_code ? mon.get(c.ccp_code) || null : null;
    const reason = c.ccp_code && !m ? `${c.ccp_code} нет среди ККТ/ОПП с мониторингом в утверждённом плане ХАССП` : null;
    out.push({ key: `check:${c.id}`, ccp_code: c.ccp_code, kind: c.kind, kind_label: KIND_LABEL[c.kind as CheckKind], source: c.basis,
      state: reason ? 'not_configured' : 'ready', reason, check: reason ? null : c, monitoring: m });
  }
  return out;
}
