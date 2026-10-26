/** Типы расчёта СТО (сервер: src/server/ops/sto.ts). */
import type { TtkDoc } from './ttkdoc';

export interface StoDish {
  id: string; name: string; card_no: string | null; ttk_version: number; card_date: string | null; kind: string; out_g: number; out_label: string; semi_yield_g: number | null; sections: boolean;
  lines: { kind: 'item' | 'heading'; name: string; brutto_g: number | null; netto_g: number | null; ready_g: number | null; in_yield: boolean; processing: string }[];
  technology: string | null; serving: string | null; storage: string | null; shelf_life: string | null;
  organoleptic: TtkDoc['version']['organoleptic']; physico: TtkDoc['physico']; micro: TtkDoc['micro']; micro_index: string | null; nutrition: TtkDoc['nutrition'];
}
export interface StoCalc {
  designation: string; title: string; org: { name: string; legal_form: string | null; inn: string | null }; year: number; status: 'project' | 'ready'; warnings: string[]; generated_at: string;
  scope: string | null; packaging: string | null; transport: string | null; control_methods: string | null;
  normative: { code: string; title: string }[]; micro_methods: { name: string; method: string }[];
  raw: { product_id: string; name: string; doc: string | null; dishes: string[] }[]; dishes: StoDish[];
}
