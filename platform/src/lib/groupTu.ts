import type { TuCalc } from '@/app/app/[orgId]/menu/[dishId]/tu/page';

/** Типы ответа API групповых ТУ (src/server/ops/groupTechSpec.ts). */
export interface GtuItem extends Pick<TuCalc, 'recipe' | 'physico' | 'tolerance' | 'nutrition' | 'micro' | 'storage' | 'organoleptic_table' | 'allergens' | 'processing'> {
  dish_id: string; name: string; kind: string; okpd2: string | null; ttk_version: number; status: string; meat_regulation: string | null;
  object: TuCalc['object']; normative: TuCalc['normative']; raw?: TuCalc['raw'];
}
export interface GtuCalc {
  id: string; name: string; items: GtuItem[]; designation: string; status: string; errors: string[]; warnings: string[]; generated_at: string;
  title: NonNullable<TuCalc['title']>; normative: TuCalc['normative']; ppk: TuCalc['ppk']; suggested_category: string | null; channel: string; packaging: string | null; meat_regulation: string | null;
}
export interface GtuData {
  spec: { id: string; seq: number; title: string; dish_ids: string[]; params: Record<string, unknown> & { items?: Record<string, { okpd2?: string | null }> } };
  calc: GtuCalc; versions: { version: number; designation: string; lab_protocol: string; approved_at: string; approved_by_name: string }[];
  dishes: { id: string; name: string; kind: string }[];
}
export const GTU_STATUS: Record<string, [string, string]> = { ready: ['готовы к утверждению', 'ok'], project: ['проект', 'warn'], error: ['ошибки в данных', 'crit'] };
