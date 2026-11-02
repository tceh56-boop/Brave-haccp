/** Типы ответа API деклараций (src/server/ops/declarations.ts). */
export interface DeclErr { field: string; text: string; basis: string[] }
export interface RawShare { product_id: string; name: string; g: number; meat_kind: 'slaughter' | 'poultry' | 'none' | null; suggest: 'slaughter' | 'poultry' | 'none' | null }
export interface Protocol { number: string; date: string; lab: string; accreditation: string | null; sampleMadeOn?: string | null; fileId?: string | null }
export interface DeclInput {
  channel?: 'services' | 'offsite' | 'outside' | null; specialized?: boolean; object?: 'serial' | 'batch';
  batch?: { size: number; unit: string; lotId?: string | null; shippingDoc?: string | null } | null;
  scheme?: string | null; tnved?: string | null; productExtra?: string | null; protocols?: Protocol[];
  sms?: { number: string; date: string; body: string; accreditation: string } | null; standards?: string | null;
  validTo?: string | null; noTerm?: boolean; replaces?: { number: string; date: string } | null;
}
export interface Decl {
  id: string; number: number; site_id: string; dish: { id: string; name: string }; status: string; status_label: string; input: DeclInput;
  regime: { decision: string; basis: string[]; regulations: string[]; schemes: string[]; reg034: boolean | null;
    meat: { raw: RawShare[]; total_g: number; meat_pct: number; slaughter_pct: number; poultry_pct: number; group: string | null; basis: string; unknown: RawShare[]; problems: string[] } };
  fields: Record<'f1' | 'f2' | 'f3' | 'f4' | 'f5' | 'f6' | 'f7' | 'f8' | 'f9' | 'f10' | 'f11' | 'f12' | 'f13', string | null>;
  valid_to: string | null; scheme: string | null; object: string; errors: DeclErr[]; notes: string[];
  complect: { item: string; status: 'ok' | 'missing' | 'warning' | 'n/a'; detail: string; basis: string }[];
  application: { label: string; value: string }[];
  acceptance: { accepted_at: string; accepted_by: string; content_hash: string } | null;
  registration: { reg_number: string; reg_date: string; valid_to: string | null; registered_by: string } | null;
  termination: { terminated_on: string; reason: string } | null;
  schemes: Record<string, { object: string; accredited: boolean; sms: boolean; title: string }>; channels: Record<string, string>; meat_kinds: Record<string, string>;
  integrity?: { content_hash: string } | null; today: string;
}
export const DECISION: Record<string, string> = {
  required: 'Декларирование обязательно', decided_by_applicant: 'Решение о декларировании — за заявителем', not_required: 'Декларация не оформляется',
  state_registration: 'Не декларирование — государственная регистрация', undetermined: 'Не определено — не хватает данных',
};
export const STATUS_BADGE: Record<string, string> = { draft: '', accepted: 'warn', registered: 'ok', expired: 'crit', terminated: '' };
export const dmy = (s: string | null | undefined) => (s ? s.slice(0, 10).split('-').reverse().join('.') : '—');
