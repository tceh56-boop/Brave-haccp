/** Типы расчёта технологической инструкции (сервер: src/server/ops/techinstr.ts). */
import type { TtkDoc } from './ttkdoc';

export interface TiCalc {
  designation: string; status: 'project' | 'ready'; warnings: string[]; generated_at: string;
  org: TtkDoc['org']; sites: string[]; dish: { id: string; name: string; kind: string; card_no: string | null };
  ttk: { version_id: string; version: number; card_no: string | null; card_date: string | null };
  title: { okpd2: string | null; group: string | null; oks: string | null; city: string | null; year: number };
  tu: { designation: string; version: number } | null;
  out_g: number; out_label: string; sections: boolean;
  raw: { product_id: string; name: string; doc: string | null }[];
  recipe: { name: string; brutto_g: number | null; netto_g: number | null; ready_g: number | null; in_yield: boolean; per_kg: { brutto: number | null; netto: number | null };
    per_100: { brutto_kg: number | null; netto_kg: number | null } | null; losses: { method: string; kind: string; loss_pct: number; basis: string }[] }[];
  prep: string[]; technology: string | null; serving: string | null; equipment: string | null; packaging: string | null; safety: string | null; environment: string | null;
  control: { receipt: string; ccp: { name: string; limits: string; basis: string }[]; lab: { test: string; target: string; period: string; basis: string }[];
    samples: { weight_g: number; hours: number; t: string; basis: string; confirmed: boolean }; organoleptic: TtkDoc['version']['organoleptic']; physico: TtkDoc['physico'];
    micro: TtkDoc['micro']; micro_index: string | null };
  storage: { conditions: string | null; shelf_life: string | null };
  sanitation: { plans: { area: string; work: string; kind: string; period: string }[]; medical_gate: string; sanpin: { code: string; title: string }[] };
}
