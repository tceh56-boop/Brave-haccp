import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText, assertSiteAccess, getSite } from './common';
import { approvedRecipe, calcVersion, convertUnits, productPrice } from './recipes';
import { semiGrams } from './bom';

/**
 * Калькуляционная карточка (форма ОП-1) по утверждённой ТТК. Норма — брутто на 1 блюдо (п/ф — на 1 кг выхода) в
 * единице цены; сумма = норма × цена; себестоимость 1 блюда = Σ сумм; сырьевой набор на 100 блюд = × 100;
 * наценка = (цена продажи − себестоимость) / себестоимость × 100. Цена — средневзвешенная по партиям в остатке,
 * иначе последняя закупка; нет ни того, ни другого — цену вводит человек с основанием (неизвестная цена ≠ 0).
 * Утверждённая калькуляция не меняется: новые цены — новая калькуляция.
 */

const r2 = (x: number) => Math.round(x * 100) / 100, r4 = (x: number) => Math.round(x * 10000) / 10000;

interface CLine { key: string; name: string; unit: string; norm: number; price: number | null; sum: number | null; price_source: string | null }

async function build(tx: Tx, orgId: string, dishId: string, manual: Map<string, { price: number; basis: string }>) {
  const dish = (await tx.query(`select * from dishes where id = $1 and organization_id = $2`, [dishId, orgId])).rows[0];
  if (!dish) throw Errors.notFound('Блюдо не найдено.');
  const r = await approvedRecipe(tx, orgId, dishId);
  if (!r) throw Errors.conflict(`У «${dish.name}» нет утверждённой ТТК — калькуляция составляется по утверждённой карте.`);
  const v = r.version;
  if (!v.yield_g) throw Errors.conflict('В ТТК не указан выход.');
  const isDish = dish.kind === 'dish';
  if (isDish && !v.portion_g) throw Errors.conflict('В ТТК не указан выход порции.');
  const factor = isDish ? Number(v.portion_g) / Number(v.yield_g) : 1000 / Number(v.yield_g);
  const lines: CLine[] = [], missing: string[] = [];
  for (const l of r.lines) {
    const gross = Number(l.brutto ?? l.netto ?? 0) * factor;
    if (l.product_id) {
      const key = `p:${l.product_id}`, m = manual.get(key);
      const pp = m ? null : await productPrice(tx, orgId, l.product_id);
      const unit = pp ? pp.unit : l.product_unit;
      const q = await convertUnits(tx, l.product_id, gross, l.unit, unit);
      if (q === null) { missing.push(`${l.product_name}: нет коэффициента «${l.unit} → ${unit}»`); lines.push({ key, name: l.product_name, unit, norm: 0, price: null, sum: null, price_source: null }); continue; }
      const norm = r4(q), price = m ? m.price : pp ? pp.price : null;
      if (price === null) missing.push(`${l.product_name}: нет цены закупки`);
      lines.push({ key, name: l.product_name, unit, norm, price: price === null ? null : r2(price), sum: price === null ? null : r2(norm * r2(price)),
        price_source: m ? `вручную: ${m.basis}` : pp ? pp.source : null });
    } else if (l.sub_dish_id) {
      const key = `s:${l.sub_dish_id}`, m = manual.get(key);
      const sub = (await tx.query(`select d.name, v.id as vid, v.yield_g from dishes d left join ttk_versions v on v.dish_id = d.id and v.status = 'approved' where d.id = $1`, [l.sub_dish_id])).rows[0];
      const g = await semiGrams(tx, l.sub_dish_id, gross, l.unit);
      const name = `${sub?.name || l.name_raw} (п/ф)`;
      if (g === null) { missing.push(`${name}: не определить массу`); lines.push({ key, name, unit: 'кг', norm: 0, price: null, sum: null, price_source: null }); continue; }
      let price: number | null = m ? m.price : null, src = m ? `вручную: ${m.basis}` : null;
      if (!m && sub?.vid && sub.yield_g) {
        const c = await calcVersion(tx, orgId, sub.vid, new Set([dishId, l.sub_dish_id]));
        if (c.cost.complete) { price = c.cost.total / Number(sub.yield_g) * 1000; src = 'по ТТК полуфабриката'; }
      }
      if (price === null) missing.push(`${name}: себестоимость полуфабриката неполная`);
      const norm = r4(g / 1000);
      lines.push({ key, name, unit: 'кг', norm, price: price === null ? null : r2(price), sum: price === null ? null : r2(norm * r2(price)), price_source: src });
    }
  }
  const cost1 = missing.length ? null : r2(lines.reduce((s, x) => s + (x.sum || 0), 0));
  return { dish, version: v, lines, missing, cost1, raw100: cost1 === null ? null : r2(cost1 * 100), isDish,
    basisLabel: isDish ? `1 блюдо, выход ${Number(v.portion_g)} г` : '1 кг выхода п/ф', yieldG: isDish ? Number(v.portion_g) : 1000 };
}

const markup = (sale: number | null, cost: number | null) => (sale && cost ? r2((sale - cost) / cost * 100) : null);

/** Предпросмотр по текущим ценам: что войдёт в калькуляцию и каких цен не хватает. */
export async function previewCosting(userId: string, orgId: string, dishId: string) {
  return inOrg(userId, orgId, 'cost.read', async (tx) => {
    const b = await build(tx, orgId, parse(z.uuid(), dishId), new Map());
    const sale = b.dish.sale_price === null ? null : Number(b.dish.sale_price);
    const next = Number((await tx.query(`select coalesce(max(seq), 0) + 1 as n from costing_cards where dish_id = $1`, [dishId])).rows[0].n);
    return { seq: next, doc_no: b.dish.card_no, ttk_version: b.version.version, basis_label: b.basisLabel, yield_g: b.yieldG, lines: b.lines, missing: b.missing,
      cost_1: b.cost1, raw_100: b.raw100, sale_price: sale, markup_pct: markup(sale, b.cost1) };
  });
}

const CostingInput = z.object({
  siteId: z.uuid().nullable().optional(),
  calcDate: z.iso.date().optional(),
  salePrice: z.coerce.number().positive('Цена продажи больше нуля.').nullable().optional(),
  prices: z.array(z.object({ key: z.string().regex(/^[ps]:[0-9a-f-]{36}$/), price: z.coerce.number().positive('Цена больше нуля.'),
    basis: z.string('Основание цены.').trim().min(5, 'Укажите основание цены: прайс поставщика, счёт, договор.').max(300) })).max(200).default([]),
  signers: z.object({ chef: optText(120), accountant: optText(120), director: optText(120) }).partial().default({}),
});

/** Утверждение калькуляции — снимок норм и цен (право цен продажи: шеф, руководитель, бухгалтер). */
export async function createCosting(userId: string, orgId: string, dishId: string, input: unknown) {
  const d = parse(CostingInput, input);
  return inOrg(userId, orgId, 'menu.price', async (tx, m) => {
    if (d.siteId) { await getSite(tx, orgId, d.siteId); assertSiteAccess(m, d.siteId); }
    const b = await build(tx, orgId, parse(z.uuid(), dishId), new Map(d.prices.map((p) => [p.key, { price: p.price, basis: p.basis }])));
    if (b.missing.length) throw Errors.validation(`Калькуляцию не составить: ${b.missing.join('; ')}.`, b.missing);
    const sale = d.salePrice !== undefined ? d.salePrice : b.dish.sale_price === null ? null : Number(b.dish.sale_price);
    if (b.isDish && !sale) throw Errors.validation('Укажите цену продажи блюда.');
    const seq = Number((await tx.query(`select coalesce(max(seq), 0) + 1 as n from costing_cards where dish_id = $1`, [dishId])).rows[0].n);
    const today = (await tx.query(`select (now() at time zone timezone)::date::text as d from organizations where id = $1`, [orgId])).rows[0].d;
    const c = (await tx.query(`insert into costing_cards (organization_id, dish_id, ttk_version_id, site_id, seq, doc_no, calc_date, basis_qty, basis_label, lines, raw_100, cost_1, sale_price, markup_pct, yield_g, signers, approved_by)
      values ($1, $2, $3, $4, $5, $6, $7, 1, $8, $9, $10, $11, $12, $13, $14, $15, $16) returning id, seq`,
      [orgId, dishId, b.version.id, d.siteId || null, seq, b.dish.card_no, d.calcDate || today, b.basisLabel, JSON.stringify(b.lines), b.raw100, b.cost1, sale, markup(sale, b.cost1), b.yieldG,
        JSON.stringify(d.signers), userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId || null, actorUserId: userId, action: 'costing.approve', entityType: 'dish', entityId: dishId,
      after: { seq, cost_1: b.cost1, sale_price: sale, manual_prices: d.prices.length } });
    return c;
  });
}

export async function listCosting(userId: string, orgId: string, dishId: string) {
  return inOrg(userId, orgId, 'cost.read', async (tx) => (await tx.query(`select c.id, c.seq, c.calc_date::text as calc_date, c.cost_1, c.sale_price, c.markup_pct, c.approved_at, u.full_name as approved_by_name, v.version as ttk_version
    from costing_cards c join users u on u.id = c.approved_by join ttk_versions v on v.id = c.ttk_version_id where c.dish_id = $1 and c.organization_id = $2 order by c.seq desc`, [parse(z.uuid(), dishId), orgId])).rows);
}

export async function getCosting(userId: string, orgId: string, cardId: string) {
  return inOrg(userId, orgId, 'cost.read', async (tx) => {
    const c = (await tx.query(`select c.*, c.calc_date::text as calc_date, d.name as dish_name, d.kind as dish_kind, s.name as site_name, u.full_name as approved_by_name, v.version as ttk_version
      from costing_cards c join dishes d on d.id = c.dish_id left join sites s on s.id = c.site_id join users u on u.id = c.approved_by join ttk_versions v on v.id = c.ttk_version_id
      where c.id = $1 and c.organization_id = $2`, [parse(z.uuid(), cardId), orgId])).rows[0];
    if (!c) throw Errors.notFound('Калькуляция не найдена.');
    const org = (await tx.query(`select name, legal_form, inn from organizations where id = $1`, [orgId])).rows[0];
    return { ...c, org };
  });
}
