import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, assertSiteAccess } from './common';
import { calcTechSpec } from './techspec';
import { effectiveParams } from './dishgroups';
import { newLabelCode } from './labels';

/**
 * Потребительская этикетка упакованной продукции собственного изготовления — ТР ТС 022/2011, ст. 4.1 п. 1:
 * наименование, состав, количество, дата изготовления, срок годности, условия хранения (в т. ч. после вскрытия),
 * изготовитель и место нахождения, пищевая ценность, сведения о ГМО (если есть), единый знак обращения (ЕАС).
 * Данные — из утверждённой ТТК, расчёта ТУ и партии. Система не печатает этикетку, по которой утверждение было бы
 * недостоверным: пока не хватает обязательных сведений, вместо этикетки — перечень того, что исправить.
 *  - Пищевая ценность — только если данные есть по всему сырью и подтверждены документами.
 *  - «Аллергены: не содержит» — только при полном профиле аллергенов.
 *  - Знак ЕАС — только при зарегистрированной декларации (модуля деклараций пока нет — знак не печатается).
 * Снимок хранится как этикетка вида 'consumer' (код для QR, журнал печати).
 */

export const CONSUMER_FORMATS = { '58x60': 'Термоэтикетка 58×60 мм', '100x70': 'Термоэтикетка 100×70 мм' } as const;
const ddmmyyyy = (d: Date, tz: string) => new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);

async function lotContext(tx: Tx, orgId: string, lotId: string) {
  const l = (await tx.query(`select l.*, p.name as product, p.opened_shelf_hours, p.opened_shelf_basis, s.address as site_address, s.name as site_name
    from lots l join products p on p.id = l.product_id join sites s on s.id = l.site_id where l.id = $1 and l.organization_id = $2`, [lotId, orgId])).rows[0];
  if (!l) throw Errors.notFound('Партия не найдена.');
  // продукция собственного изготовления: партия выпущена заданием производства или товар — продукт блюда
  const po = (await tx.query(`select dish_id, completed_at from production_orders where output_lot_id = $1`, [lotId])).rows[0];
  const dishId = po?.dish_id || (await tx.query(`select id from dishes where organization_id = $1 and product_id = $2 and status = 'active' limit 1`, [orgId, l.product_id])).rows[0]?.id;
  return { l, dishId: dishId as string | undefined, madeAt: po?.completed_at ? new Date(po.completed_at) : l.manufactured_at ? new Date(`${l.manufactured_at}T00:00:00`) : null };
}

/** Состав этикетки, сведения и блокирующие замечания. */
export async function buildConsumerLabel(tx: Tx, orgId: string, lotId: string, netMassG: number | null) {
  const { l, dishId, madeAt } = await lotContext(tx, orgId, lotId);
  const blockers: string[] = [], notes: string[] = [];
  if (!dishId) throw Errors.conflict(`«${l.product}» — не продукция собственного изготовления: на упаковке остаётся маркировка изготовителя.`);
  const org = (await tx.query(`select name, legal_form, inn, timezone from organizations where id = $1`, [orgId])).rows[0];
  const tz = org.timezone || 'Europe/Moscow';
  const dish = (await tx.query(`select name from dishes where id = $1`, [dishId])).rows[0];
  const calc = await calcTechSpec(tx, orgId, dishId, await effectiveParams(tx, dishId));
  const v = (await tx.query(`select storage_conditions, shelf_life from ttk_versions where id = $1`, [calc.object.ttk_version_id])).rows[0];
  const tu = (await tx.query(`select designation from tech_spec_versions where dish_id = $1 order by version desc limit 1`, [dishId])).rows[0];

  for (const e of calc.errors) blockers.push(`ТТК: ${e}`);
  // состав — в порядке убывания массовой доли (одинаковое сырьё из разных строк — одной позицией)
  const mass = new Map<string, number>();
  for (const r of calc.recipe) if (r.netto_g != null) mass.set(r.name, (mass.get(r.name) || 0) + r.netto_g);
  const composition = [...mass.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  if (!composition.length) blockers.push('Состав не определён: в утверждённой ТТК нет учтённых строк сырья.');
  // аллергены
  const allergens = calc.allergens.contains.map((a) => a.label);
  if (!calc.allergens.complete) blockers.push(`Профиль аллергенов неполный (${calc.allergens.no_profile.join(', ') || 'часть сырья не вошла в расчёт'}) — сведения об аллергенах на этикетке были бы недостоверны.`);
  // пищевая ценность
  const per100 = calc.nutrition.per100;
  if (!per100) blockers.push('Пищевая ценность не рассчитана — нет данных о сырье.');
  else if (calc.nutrition.coverage_pct < 100) blockers.push(`Пищевая ценность рассчитана по ${calc.nutrition.coverage_pct} % массы сырья — значения занижены.`);
  else if (calc.nutrition.verified_pct < 100) blockers.push(`Пищевая ценность подтверждена документами на ${calc.nutrition.verified_pct} % массы сырья — остальное справочные данные «на проверке». Внесите данные по документу (маркировка изготовителя сырья).`);
  if (calc.processing.mode === 'thermal' && !calc.processing.by_norms_pct) notes.push('Потери пищевых веществ при тепловой обработке не учтены (нет норм обработки с основанием) — значения могут быть завышены.');
  // количество, даты, хранение
  if (!netMassG) blockers.push('Укажите массу нетто упаковки.');
  if (!madeAt) blockers.push('У партии нет даты изготовления.');
  if (!l.expires_at) blockers.push('У партии нет срока годности с основанием.');
  else if (new Date(l.expires_at) <= new Date()) blockers.push('Срок годности партии истёк — этикетку не печатать.');
  if (l.status !== 'available') blockers.push(`Партия в статусе «${l.status}» — к реализации не допускается.`);
  if (!v.storage_conditions) blockers.push('В ТТК не указаны условия хранения.');
  const afterOpening = l.opened_shelf_hours ? `после вскрытия упаковки — не более ${Number(l.opened_shelf_hours)} ч при тех же условиях` : null;
  if (!afterOpening) blockers.push(`Не установлен срок хранения после вскрытия упаковки для «${l.product}» (правило товара с основанием) — ТР ТС 022/2011, ст. 4.1 п. 1 пп. 6.`);
  // изготовитель
  const manufacturer = `${org.legal_form && org.legal_form !== 'другое' && !org.name.startsWith(org.legal_form) ? `${org.legal_form} ` : ''}${org.name}`;
  if (!l.site_address) blockers.push(`Не указан адрес площадки «${l.site_name}» — место нахождения изготовителя (место производства).`);
  if (!tu) notes.push('Нет утверждённых ТУ — обозначение документа, по которому изготовлена продукция, на этикетке не указывается.');
  notes.push('Знак ЕАС не печатается: декларация о соответствии в системе не зарегистрирована.');

  return {
    lot_id: l.id, site_id: l.site_id, dish_id: dishId, lot_no: l.lot_no,
    payload: {
      kind: 'consumer', product: dish.name, lot_no: l.lot_no, composition, allergens,
      allergen_text: allergens.length ? `Содержит: ${allergens.join(', ')}.` : calc.allergens.complete ? 'Аллергены: не содержит.' : null,
      nutrition: per100 ? { protein: per100.protein, fat: per100.fat, carbs: per100.carbs, kcal: per100.kcal, kj: per100.kj } : null,
      net_mass_g: netMassG, manufactured_at: madeAt ? madeAt.toISOString() : null, manufactured_text: madeAt ? ddmmyyyy(madeAt, tz) : null,
      expires_at: l.expires_at ? new Date(l.expires_at).toISOString() : null, expires_text: l.expires_at ? ddmmyyyy(new Date(l.expires_at), tz) : null,
      storage: v.storage_conditions, shelf_life: v.shelf_life, after_opening: afterOpening,
      manufacturer, address: l.site_address, inn: org.inn, tu: tu?.designation || null, eac: false,
    },
    blockers, notes,
  };
}

/** Сравнение снимков без учёта порядка ключей (jsonb хранит ключи в своём порядке). */
const canon = (x: unknown): string => Array.isArray(x) ? `[${x.map(canon).join(',')}]`
  : x && typeof x === 'object' ? `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canon((x as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(x ?? null);

const NetMass = z.coerce.number('Масса нетто, г.').positive('Масса нетто больше нуля.').max(100000).nullable().optional();

export async function previewConsumerLabel(userId: string, orgId: string, lotId: string, netMassG?: unknown) {
  const m = parse(NetMass, netMassG ?? null) ?? null;
  return inOrg(userId, orgId, 'lot.read', async (tx, mem) => {
    const r = await buildConsumerLabel(tx, orgId, parse(z.uuid(), lotId), m);
    assertSiteAccess(mem, r.site_id);
    return r;
  });
}

/** Выпуск этикетки (снимок). С замечаниями — отказ с их перечнем. */
export async function createConsumerLabel(userId: string, orgId: string, lotId: string, input: unknown) {
  const d = parse(z.object({ netMassG: z.coerce.number('Масса нетто, г.').positive('Масса нетто больше нуля.').max(100000) }), input);
  return inOrg(userId, orgId, 'label.print', async (tx, mem) => {
    const r = await buildConsumerLabel(tx, orgId, parse(z.uuid(), lotId), d.netMassG);
    assertSiteAccess(mem, r.site_id);
    if (r.blockers.length) throw Errors.conflict(`Этикетку печатать нельзя: ${r.blockers.join(' ')}`);
    const last = (await tx.query(`select id, code, payload from labels where lot_id = $1 and kind = 'consumer' order by created_at desc limit 1`, [r.lot_id])).rows[0];
    if (last && canon(last.payload) === canon(r.payload)) return { id: last.id as string, code: last.code as string, reused: true };
    for (let i = 0; i < 5; i++) {
      const ins = await tx.query(`insert into labels (organization_id, site_id, lot_id, code, kind, payload, created_by) values ($1, $2, $3, $4, 'consumer', $5, $6)
        on conflict (code) do nothing returning id, code`, [orgId, r.site_id, r.lot_id, newLabelCode(), JSON.stringify(r.payload), userId]);
      if (ins.rows[0]) {
        await audit.record(tx, { organizationId: orgId, siteId: r.site_id, actorUserId: userId, action: 'label.consumer', entityType: 'lot', entityId: r.lot_id, after: { label: ins.rows[0].id, net_mass_g: d.netMassG } });
        return { ...ins.rows[0], reused: false } as { id: string; code: string; reused: boolean };
      }
    }
    throw Errors.conflict('Не удалось выдать код этикетки — повторите.');
  });
}
