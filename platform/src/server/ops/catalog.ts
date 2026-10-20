import { z } from 'zod';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText } from './common';

/** Минимальный справочник товаров и поставщиков для приёмки (полный каталог с ProductID MON CHEF — этап 3). */

const ProductInput = z.object({
  name: z.string().trim().min(2, 'Укажите название товара.').max(200),
  unit: z.enum(['кг', 'г', 'л', 'мл', 'шт'], { message: 'Единица: кг, г, л, мл или шт.' }),
  category: optText(100),
  barcode: z.string().trim().regex(/^\d{8,14}$/, 'Штрихкод — от 8 до 14 цифр.').optional().nullable().transform((v) => v || null),
});

export async function listProducts(userId: string, orgId: string, q?: string | null) {
  return inOrg(userId, orgId, 'catalog.read', async (tx) => (await tx.query(
    `select id, name, unit, category, barcode from products where organization_id = $1 and status = 'active'
       and ($2::text is null or name ilike '%' || $2 || '%' or barcode = $2) order by name limit 200`, [orgId, q || null])).rows);
}

export async function createProduct(userId: string, orgId: string, input: unknown) {
  const d = parse(ProductInput, input);
  return inOrg(userId, orgId, 'catalog.manage', async (tx) => {
    if (d.barcode && (await tx.query(`select 1 from products where organization_id = $1 and barcode = $2`, [orgId, d.barcode])).rowCount)
      throw Errors.conflict('Товар с таким штрихкодом уже есть.');
    const p = (await tx.query(`insert into products (organization_id, name, unit, category, barcode) values ($1, $2, $3, $4, $5) returning *`,
      [orgId, d.name, d.unit, d.category, d.barcode])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'product.create', entityType: 'product', entityId: p.id, after: p });
    return p;
  });
}

const SupplierInput = z.object({
  name: z.string().trim().min(2, 'Укажите поставщика.').max(200),
  inn: z.string().trim().regex(/^(\d{10}|\d{12})?$/, 'ИНН — 10 или 12 цифр.').optional().nullable().transform((v) => v || null),
});

export async function listSuppliers(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'catalog.read', async (tx) => (await tx.query(
    `select id, name, inn from suppliers where organization_id = $1 and status = 'active' order by name`, [orgId])).rows);
}

export async function createSupplier(userId: string, orgId: string, input: unknown) {
  const d = parse(SupplierInput, input);
  return inOrg(userId, orgId, 'catalog.manage', async (tx) => {
    const s = (await tx.query(`insert into suppliers (organization_id, name, inn) values ($1, $2, $3) returning *`, [orgId, d.name, d.inn])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'supplier.create', entityType: 'supplier', entityId: s.id, after: s });
    return s;
  });
}
