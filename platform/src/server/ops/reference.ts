import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { withSystem } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse } from './common';

/**
 * Справочник платформы — единый каталог MON CHEF (1549 ProductID). Каждая исходная строка — отдельная
 * запись; одинаковые названия помечены группой и не сливаются автоматически (ТЗ v1 AT-05). Пищевая
 * ценность и сроки — справочные, со статусом проверки REVIEW: это не утверждённая норма предприятия.
 */

interface RefItem {
  code: string; name: string; type: string | null; basis: string | null; kcal: number | null; protein: number | null; fat: number | null; carbs: number | null;
  fiber: number | null; sugars: number | null; storage: string | null; shelf_room: string | null; shelf_fridge: string | null; shelf_freezer: string | null;
  spoilage: string | null; status: string; flags: string | null; source_file: string | null; source_row: number | null; original_id: string | null; duplicate_group: string | null;
}

export const REFERENCE_FILE = path.resolve(__dirname, '../../../data/reference/monchef_catalog_v55.json');

/** Загрузка (повторная загрузка обновляет записи по ProductID, ничего не удаляет). */
export async function importReference(file = REFERENCE_FILE): Promise<{ inserted: number; updated: number; total: number }> {
  const data = JSON.parse(readFileSync(file, 'utf8')) as { source: string; items: RefItem[] };
  return withSystem(async (tx) => {
    let inserted = 0, updated = 0;
    for (const i of data.items) {
      const r = await tx.query(`insert into reference_products (code, source, name, product_type, basis, kcal_100, protein_100, fat_100, carbs_100, fiber_100, sugars_100,
          storage, shelf_room, shelf_fridge, shelf_freezer, spoilage, verification_status, review_flags, source_file, source_row, original_id, duplicate_group)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
        on conflict (code) do update set name = excluded.name, product_type = excluded.product_type, basis = excluded.basis, kcal_100 = excluded.kcal_100,
          protein_100 = excluded.protein_100, fat_100 = excluded.fat_100, carbs_100 = excluded.carbs_100, fiber_100 = excluded.fiber_100, sugars_100 = excluded.sugars_100,
          storage = excluded.storage, shelf_room = excluded.shelf_room, shelf_fridge = excluded.shelf_fridge, shelf_freezer = excluded.shelf_freezer, spoilage = excluded.spoilage,
          review_flags = excluded.review_flags, duplicate_group = excluded.duplicate_group, imported_at = now()
          -- статус проверки при повторной загрузке не сбрасывается: проверенную запись не превратить обратно в REVIEW
        returning (xmax = 0) as inserted`,
        [i.code, data.source, i.name, i.type, i.basis, i.kcal, i.protein, i.fat, i.carbs, i.fiber, i.sugars, i.storage, i.shelf_room, i.shelf_fridge, i.shelf_freezer,
          i.spoilage, i.status === 'VERIFIED' ? 'VERIFIED' : 'REVIEW', i.flags, i.source_file, i.source_row, i.original_id, i.duplicate_group]);
      if (r.rows[0].inserted) inserted++; else updated++;
    }
    await audit.record(tx, { action: 'reference.import', entityType: 'reference_products', after: { source: data.source, inserted, updated, total: data.items.length } });
    return { inserted, updated, total: data.items.length };
  });
}

export async function searchReference(userId: string, orgId: string, q: string) {
  const needle = String(q || '').trim().toLowerCase();
  if (needle.length < 2) return [];
  return inOrg(userId, orgId, 'catalog.read', async (tx) => (await tx.query(
    `select id, code, name, product_type, basis, kcal_100, protein_100, fat_100, carbs_100, storage, shelf_fridge, verification_status, duplicate_group
       from reference_products where lower(name) like '%' || $1 || '%'
      order by (lower(name) = $1) desc, (lower(name) like $1 || '%') desc, length(name), code limit 30`, [needle])).rows);
}

export async function getReference(userId: string, orgId: string, id: string) {
  return inOrg(userId, orgId, 'catalog.read', async (tx) => {
    const r = (await tx.query(`select * from reference_products where id = $1`, [id])).rows[0];
    if (!r) throw Errors.notFound('Запись справочника не найдена.');
    const twins = r.duplicate_group ? (await tx.query(`select id, code, name, product_type, source_file from reference_products where duplicate_group = $1 and id <> $2`, [r.duplicate_group, id])).rows : [];
    return { ...r, twins };
  });
}

/** Привязка товара предприятия к записи справочника — решение человека; дубли не сливаются. */
export async function linkProductToReference(userId: string, orgId: string, productId: string, input: unknown) {
  const d = parse(z.object({ referenceId: z.uuid().nullable() }), input);
  return inOrg(userId, orgId, 'catalog.manage', async (tx) => {
    const p = (await tx.query(`select * from products where id = $1 and organization_id = $2 for update`, [productId, orgId])).rows[0];
    if (!p) throw Errors.notFound('Товар не найден.');
    if (d.referenceId && !(await tx.query(`select 1 from reference_products where id = $1`, [d.referenceId])).rowCount) throw Errors.notFound('Запись справочника не найдена.');
    await tx.query(`update products set reference_product_id = $2 where id = $1`, [productId, d.referenceId]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'product.link_reference', entityType: 'product', entityId: productId,
      before: { reference_product_id: p.reference_product_id }, after: { reference_product_id: d.referenceId } });
    return { ok: true };
  });
}

const FromRefInput = z.object({ referenceId: z.uuid(), unit: z.enum(['кг', 'г', 'л', 'мл', 'шт']), name: z.string().trim().min(2).max(200).optional() });

export async function createProductFromReference(userId: string, orgId: string, input: unknown) {
  const d = parse(FromRefInput, input);
  return inOrg(userId, orgId, 'catalog.manage', async (tx) => {
    const r = (await tx.query(`select id, name, product_type from reference_products where id = $1`, [d.referenceId])).rows[0];
    if (!r) throw Errors.notFound('Запись справочника не найдена.');
    const p = (await tx.query(`insert into products (organization_id, name, unit, category, reference_product_id) values ($1, $2, $3, $4, $5) returning *`,
      [orgId, d.name || r.name, d.unit, r.product_type, r.id])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'product.create', entityType: 'product', entityId: p.id, after: p, reason: `из справочника ${r.name}` });
    return p;
  });
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  importReference().then((r) => console.log('справочник:', r)).catch((e) => { console.error(e.message); process.exitCode = 1; })
    .finally(async () => (await import('../db/pool')).closePool());
}
