import { z } from 'zod';
import type { Tx } from '../db/pool';
import { withSystem } from '../db/pool';
import { audit } from '../audit/audit';
import { inOrg, parse } from './common';
import book from '../../../data/reference/sbornik2022.json';

/**
 * Реестр норм обработки сырья: продукт / вид обработки / процент и все данные источника (брутто, нетто, масса после
 * обработки, сезон, страница или рецептуры, все встречающиеся значения, продукт справочника). Общий для всех
 * организаций; загружается из data/reference/sbornik2022.json (tools/norms/sbornik2022.py).
 */

interface Row {
  id: string; product: string; method: string; kind: string; pct: number; pct_min: number; pct_max: number; brutto: number | null; netto: number | null; after: number | null;
  season: [number, number] | null; season_text: string | null; source: string; page: number | null; recipes: number[]; recipes_total?: number;
  values: unknown[]; note: string | null; basis: string; base: { code: string; name: string }[];
}
const B = book as unknown as { source: Record<string, any>; norms: Row[] };
export const REGISTRY_SOURCE = B.source;

/** Полная перезагрузка реестра из файла (в одной транзакции; ссылок на строки реестра нет — норма предприятия хранит основание текстом). */
export async function importProcessingRegistry(tx?: Tx) {
  const run = async (t: Tx) => {
    await t.query(`delete from reference_processing_norms`);
    const doc = `${B.source.title}, ${B.source.edition}, ${B.source.publisher}, ${B.source.year}`;
    for (const r of B.norms) {
      await t.query(`insert into reference_processing_norms (code, source_doc, product, method_code, kind, pct, pct_min, pct_max, brutto, netto, after_mass, season_from, season_to, season_text,
          source_kind, page, recipes, recipes_total, variants, note, basis, base_products) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)`,
        [r.id, doc, r.product, r.method, r.kind, r.pct, r.pct_min, r.pct_max, r.brutto, r.netto, r.after, r.season?.[0] ?? null, r.season?.[1] ?? null, r.season_text,
          r.source, r.page, r.recipes, r.recipes_total ?? null, JSON.stringify(r.values), r.note, r.basis, JSON.stringify(r.base)]);
    }
    await audit.record(t, { action: 'reference.processing_import', entityType: 'reference_processing_norms', after: { source: B.source.short, rows: B.norms.length, sha256: B.source.sha256 } });
    return { rows: B.norms.length };
  };
  return tx ? run(tx) : withSystem(run);
}

/** Реестр пуст (новая установка) — загрузить. */
export async function ensureRegistry(tx: Tx) {
  const n = Number((await tx.query(`select count(*) from reference_processing_norms`)).rows[0].count);
  if (n === 0) await withSystem((t) => importProcessingRegistry(t));
}

const Q = z.object({
  q: z.string().trim().max(100).optional().default(''),
  kind: z.enum(['', 'cold', 'thermal']).optional().default(''),
  source: z.enum(['', 'table', 'recipes', 'pf']).optional().default(''),
});

export async function listRegistry(userId: string, orgId: string, input: unknown) {
  const d = parse(Q, input || {});
  return inOrg(userId, orgId, 'menu.read', async (tx) => {
    await ensureRegistry(tx);
    const rows = (await tx.query(`select r.*, m.name as method_name from reference_processing_norms r join processing_methods m on m.code = r.method_code
      where ($1 = '' or lower(r.product) like '%' || lower($1) || '%' or exists (select 1 from jsonb_array_elements(r.base_products) b where lower(b->>'name') like '%' || lower($1) || '%'))
        and ($2 = '' or r.kind = $2) and ($3 = '' or r.source_kind = $3)
      order by r.source_kind = 'table' desc, lower(r.product), m.position, r.season_from nulls first`, [d.q, d.kind, d.source])).rows;
    const total = (await tx.query(`select kind, source_kind, count(*)::int as n from reference_processing_norms group by 1, 2`)).rows;
    return { source: B.source, rows: rows.map((r) => ({ ...r, pct: Number(r.pct), pct_min: Number(r.pct_min), pct_max: Number(r.pct_max),
      brutto: r.brutto === null ? null : Number(r.brutto), netto: r.netto === null ? null : Number(r.netto), after_mass: r.after_mass === null ? null : Number(r.after_mass) })), total };
  });
}
