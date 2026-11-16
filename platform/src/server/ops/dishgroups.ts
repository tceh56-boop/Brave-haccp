import { z } from 'zod';
import { MICRO_GROUPS } from '../norms/micro';
const MicroGroupCode = z.string().refine((c) => c === 'custom' || MICRO_GROUPS.some((g) => g.code === c), 'Нет такой группы ТР ТС 021.').nullable().optional();
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText } from './common';
import { MICRO, type TuParams } from './techspec';

/**
 * Дерево папок блюд (как группы Шеф Эксперта). Правила папки — нормируемые физико-химические показатели
 * и коэффициенты, микробиология (документ, группа, нормативы), органолептика по умолчанию — наследуются вниз по
 * дереву: ближняя папка сильнее дальней, значение у блюда сильнее папки. Правила вводит технолог по документу;
 * система их не подставляет.
 */

export const GROUP_KEYS = ['physNormed', 'gerberPct', 'saltMaxPct', 'dryCoef', 'sugarCoef', 'physBasis', 'microIndex', 'microNote', 'microGroup', 'microGroupCode'] as const;
export interface GroupParams extends Pick<TuParams, typeof GROUP_KEYS[number] | 'micro'> {
  organoleptic?: { appearance?: string | null; color?: string | null; consistency?: string | null; taste?: string | null };
}

const isSet = (v: unknown) => v !== null && v !== undefined && v !== '' && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v as object).length);

/** Цепочка папок от корня до папки. */
async function chainOf(tx: Tx, groupId: string | null) {
  if (!groupId) return [];
  return (await tx.query(`with recursive up(id, parent_id, name, params, depth) as (select id, parent_id, name, params, 0 from dish_groups where id = $1
      union all select g.id, g.parent_id, g.name, g.params, u.depth + 1 from dish_groups g join up u on g.id = u.parent_id where u.depth < 20)
    select id, name, params from up order by depth desc`, [groupId])).rows as { id: string; name: string; params: GroupParams }[];
}

/** Правила папки с наследованием: значение и папка, откуда оно взято. */
export async function groupRules(tx: Tx, groupId: string | null) {
  const out: Record<string, unknown> = {}, from: Record<string, string> = {};
  const micro: Record<string, string> = {}, organoleptic: Record<string, string> = {};
  for (const g of await chainOf(tx, groupId)) {
    for (const k of GROUP_KEYS) if (isSet((g.params as Record<string, unknown>)[k])) { out[k] = (g.params as Record<string, unknown>)[k]; from[k] = g.name; }
    for (const [k, v] of Object.entries(g.params.micro || {})) if (v) { micro[k] = v; from[`micro.${k}`] = g.name; }
    for (const [k, v] of Object.entries(g.params.organoleptic || {})) if (v) { organoleptic[k] = v; from[`organoleptic.${k}`] = g.name; }
  }
  return { params: { ...out, micro, organoleptic } as GroupParams, from };
}

/**
 * Параметры блюда для документов: правила папок + параметры блюда (заданное у блюда сильнее).
 * Ключи, которых нет в правилах папки (ОКПД2, ОКПО, ТИ…), — только из блюда.
 */
export async function effectiveParams(tx: Tx, dishId: string): Promise<TuParams & { organolepticDefault?: GroupParams['organoleptic']; inherited: Record<string, string> }> {
  const own: TuParams = (await tx.query(`select params from tech_specs where dish_id = $1`, [dishId])).rows[0]?.params || {};
  const groupId = (await tx.query(`select group_id from dishes where id = $1`, [dishId])).rows[0]?.group_id || null;
  const g = await groupRules(tx, groupId);
  const out: Record<string, unknown> = { ...own };
  const inherited: Record<string, string> = {};
  for (const k of GROUP_KEYS) if (!isSet((own as Record<string, unknown>)[k]) && isSet((g.params as Record<string, unknown>)[k])) { out[k] = (g.params as Record<string, unknown>)[k]; inherited[k] = g.from[k]; }
  const micro: Record<string, string> = { ...(g.params.micro || {}) };
  for (const k of Object.keys(micro)) inherited[`micro.${k}`] = g.from[`micro.${k}`];
  for (const [k, v] of Object.entries(own.micro || {})) if (v) { micro[k] = v; delete inherited[`micro.${k}`]; }
  out.micro = micro;
  return { ...(out as TuParams), organolepticDefault: g.params.organoleptic, inherited };
}

/* ───────────── Папки ───────────── */

export async function listGroups(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'menu.read', async (tx) => (await tx.query(`select g.id, g.parent_id, g.name, g.position, g.params,
      (select count(*)::int from dishes d where d.group_id = g.id and d.status = 'active') as dishes,
      (select count(*)::int from dish_groups c where c.parent_id = g.id) as children
    from dish_groups g where g.organization_id = $1 order by g.position, lower(g.name)`, [orgId])).rows);
}

async function assertParent(tx: Tx, orgId: string, parentId: string | null | undefined, self?: string) {
  if (!parentId) return;
  if (!(await tx.query(`select 1 from dish_groups where id = $1 and organization_id = $2`, [parentId, orgId])).rowCount) throw Errors.validation('Родительская папка не найдена.');
  if (self && (await chainOf(tx, parentId)).some((g) => g.id === self)) throw Errors.validation('Папку нельзя переместить внутрь самой себя.');
}

export async function createGroup(userId: string, orgId: string, input: unknown) {
  const d = parse(z.object({ name: z.string('Название папки.').trim().min(1, 'Название папки.').max(200), parentId: z.uuid().nullable().optional() }), input);
  return inOrg(userId, orgId, 'ttk.manage', async (tx) => {
    await assertParent(tx, orgId, d.parentId);
    try {
      const g = (await tx.query(`insert into dish_groups (organization_id, parent_id, name, created_by) values ($1, $2, $3, $4) returning *`, [orgId, d.parentId || null, d.name, userId])).rows[0];
      await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'dish_group.create', entityType: 'dish_group', entityId: g.id, after: d });
      return g;
    } catch (e) { if ((e as { code?: string }).code === '23505') throw Errors.conflict('Папка с таким названием здесь уже есть.'); throw e; }
  });
}

const pct = z.coerce.number().min(0).max(100).nullable().optional();
const RulesInput = z.object({
  physNormed: z.object({ dry: z.boolean(), fat: z.boolean(), sugar: z.boolean(), salt: z.boolean() }).partial().optional(),
  gerberPct: pct, saltMaxPct: z.coerce.number().min(0).max(20).nullable().optional(), dryCoef: z.coerce.number().min(0).max(1).nullable().optional(),
  sugarCoef: z.coerce.number().min(0).max(1).nullable().optional(), physBasis: optText(500), microIndex: optText(300), microNote: optText(1000), microGroup: optText(200), microGroupCode: MicroGroupCode,
  micro: z.record(z.string(), z.string().trim().max(200)).optional(),
  organoleptic: z.object({ appearance: optText(1000), color: optText(1000), consistency: optText(1000), taste: optText(1000) }).optional(),
});

export async function updateGroup(userId: string, orgId: string, groupId: string, input: unknown) {
  const d = parse(z.object({ name: z.string().trim().min(1).max(200).optional(), parentId: z.uuid().nullable().optional(), rules: RulesInput.optional() }), input);
  return inOrg(userId, orgId, 'ttk.manage', async (tx) => {
    const g = (await tx.query(`select * from dish_groups where id = $1 and organization_id = $2 for update`, [parse(z.uuid(), groupId), orgId])).rows[0];
    if (!g) throw Errors.notFound('Папка не найдена.');
    if (d.parentId !== undefined) await assertParent(tx, orgId, d.parentId, g.id);
    let params = g.params;
    if (d.rules) {
      const micro = Object.fromEntries(Object.entries(d.rules.micro || {}).filter(([k, v]) => MICRO.some((m) => m.code === k) && v));
      params = { ...d.rules, micro };
    }
    try {
      await tx.query(`update dish_groups set name = coalesce($2, name), parent_id = case when $3::boolean then $4 else parent_id end, params = $5 where id = $1`,
        [g.id, d.name || null, d.parentId !== undefined, d.parentId ?? null, JSON.stringify(params)]);
    } catch (e) { if ((e as { code?: string }).code === '23505') throw Errors.conflict('Папка с таким названием здесь уже есть.'); throw e; }
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'dish_group.update', entityType: 'dish_group', entityId: g.id, before: { name: g.name, params: g.params }, after: d });
    return { ok: true };
  });
}

export async function deleteGroup(userId: string, orgId: string, groupId: string) {
  return inOrg(userId, orgId, 'ttk.manage', async (tx) => {
    const g = (await tx.query(`select * from dish_groups where id = $1 and organization_id = $2`, [parse(z.uuid(), groupId), orgId])).rows[0];
    if (!g) throw Errors.notFound('Папка не найдена.');
    if ((await tx.query(`select 1 from dish_groups where parent_id = $1 union all select 1 from dishes where group_id = $1 union all select 1 from sto_standards where group_id = $1`, [g.id])).rowCount)
      throw Errors.conflict('В папке есть блюда, вложенные папки или к ней относится СТО — сначала перенесите их.');
    await tx.query(`delete from dish_groups where id = $1`, [g.id]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'dish_group.delete', entityType: 'dish_group', entityId: g.id, before: { name: g.name } });
    return { ok: true };
  });
}

/** Папка и её правила: свои, унаследованные (откуда), блюда, путь. */
export async function getGroup(userId: string, orgId: string, groupId: string) {
  return inOrg(userId, orgId, 'menu.read', async (tx) => {
    const g = (await tx.query(`select * from dish_groups where id = $1 and organization_id = $2`, [parse(z.uuid(), groupId), orgId])).rows[0];
    if (!g) throw Errors.notFound('Папка не найдена.');
    const path = await chainOf(tx, g.id);
    const inherited = await groupRules(tx, g.parent_id);
    const dishes = (await tx.query(`select d.id, d.name, d.kind, (select v.version from ttk_versions v where v.dish_id = d.id and v.status = 'approved') as approved
      from dishes d where d.group_id = $1 and d.status = 'active' order by d.name`, [g.id])).rows;
    const sto = (await tx.query(`select id, seq, title from sto_standards where group_id = $1 and status = 'active'`, [g.id])).rows;
    return { group: g, path: path.map((x) => ({ id: x.id, name: x.name })), inherited, dishes, sto, micro_list: MICRO };
  });
}

/** Все блюда папки и её подпапок (для СТО на папку). */
export async function dishesInTree(tx: Tx, groupId: string) {
  return (await tx.query(`with recursive down(id) as (select $1::uuid union all select g.id from dish_groups g join down on g.parent_id = down.id)
    select d.id from dishes d where d.group_id in (select id from down) and d.status = 'active' order by d.name`, [groupId])).rows.map((r) => r.id as string);
}

/** Блюдо — в папку (или без папки). */
export async function setDishGroup(userId: string, orgId: string, dishId: string, input: unknown) {
  const d = parse(z.object({ groupId: z.uuid().nullable() }), input);
  return inOrg(userId, orgId, 'ttk.manage', async (tx) => {
    const dish = (await tx.query(`select id, group_id from dishes where id = $1 and organization_id = $2`, [parse(z.uuid(), dishId), orgId])).rows[0];
    if (!dish) throw Errors.notFound('Блюдо не найдено.');
    if (d.groupId && !(await tx.query(`select 1 from dish_groups where id = $1 and organization_id = $2`, [d.groupId, orgId])).rowCount) throw Errors.validation('Папка не найдена.');
    await tx.query(`update dishes set group_id = $2 where id = $1`, [dish.id, d.groupId]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'dish.move', entityType: 'dish', entityId: dish.id, before: { group_id: dish.group_id }, after: d });
    return { ok: true };
  });
}

/** Папка по пути (создаётся при необходимости) — для импорта архива. */
export async function groupByPath(tx: Tx, orgId: string, userId: string, path: string[]) {
  let parent: string | null = null;
  for (const part of path.map((x) => x.trim()).filter(Boolean)) {
    const found: { id: string } | undefined = (await tx.query(`select id from dish_groups where organization_id = $1 and parent_id is not distinct from $2 and lower(name) = lower($3)`, [orgId, parent, part])).rows[0];
    parent = found ? found.id : (await tx.query(`insert into dish_groups (organization_id, parent_id, name, created_by) values ($1, $2, $3, $4) returning id`, [orgId, parent, part, userId])).rows[0].id;
  }
  return parent;
}
