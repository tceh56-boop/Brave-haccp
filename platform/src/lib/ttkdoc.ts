/** Типы расчёта документов ТТК (сервер: src/server/ops/ttkdoc.ts). */
export type NPF = { protein: number; fat: number; carbs: number };
export interface DocLine {
  kind: 'item' | 'heading'; name: string; brutto_g: number | null; netto_g: number | null; ready_g: number | null; processing: string; in_yield: boolean;
  per100: NPF | null; source: string | null; in_dish: NPF | null; nutr_loss: NPF | null; after_loss: number; with_losses: NPF | null;
  dry_g: number | null; fat_mass_g: number | null; sugar_g: number | null; dry_100: number | null; fat_mass_100: number | null; sucrose_100: number | null;
}
type Per = NPF & { kcal: number; kj: number };
type Phys<T> = ({ normed: false } | ({ normed: true; missing: string[] } & T));
export interface TtkDoc {
  org: { name: string; legal_form: string | null; inn: string | null }; sites: string[];
  dish: { id: string; name: string; kind: string; card_no: string | null };
  version: { id: string; version: number; status: string; card_date: string | null; yield_g: number | null; portion_g: number | null; technology: string | null; serving: string | null;
    storage_conditions: string | null; shelf_life: string | null; organoleptic: { appearance?: string | null; color?: string | null; consistency?: string | null; taste?: string | null };
    menu_description: string | null; source: string };
  out_g: number; out_label: string; sections: boolean; lines: DocLine[];
  nutrition: { total: Per; per100: Per; complete: boolean } | null;
  physico: { dry: Phys<{ theoretical_pct: number; max: number | null; min: number | null }>; fat: Phys<{ max: number | null; min: number | null; ingredients: string[] }>;
    sugar: Phys<{ value: number | null; ingredients: string[] }>; salt: Phys<{ value: number | null }>; basis: string | null };
  micro: { code: string; name: string; method: string; norm: string | null }[]; micro_index: string | null; micro_note: string | null;
  missing: { nutrition: string[] };
  params: { physNormed: { dry?: boolean; fat?: boolean; sugar?: boolean; salt?: boolean }; gerberPct: number | null; saltMaxPct: number | null; dryCoef: number | null; sugarCoef: number | null;
    physBasis: string | null; microIndex: string | null; microNote: string | null; micro: Record<string, string> };
}
export const orgTitle = (o: { name: string; legal_form: string | null }) => `${o.legal_form && o.legal_form !== 'другое' && !o.name.startsWith(o.legal_form) ? `${o.legal_form} ` : ''}${o.name}`;
export const dmy = (d: string | null) => (d ? String(d).slice(0, 10).split('-').reverse().join('.') : '');
export const fx = (v: number | null | undefined, digits = 2) => (v === null || v === undefined ? '—' : String(Math.round(v * 10 ** digits) / 10 ** digits).replace('.', ','));
