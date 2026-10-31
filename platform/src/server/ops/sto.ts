import { z } from 'zod';
import { assertSnapshotIntact } from './integrity';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText, openTask, closeTasksFor } from './common';
import { buildTtkDoc } from './ttkdoc';
import { MICRO, type TuParams } from './techspec';
import { dishesInTree } from './dishgroups';

/**
 * Стандарт организации (СТО) на группу блюд (ГОСТ Р 1.4, ГОСТ Р 1.5). Разделы: область применения, нормативные
 * ссылки, перечень сырья с НД, требования к сырью, нормы закладки, технологический процесс, оформление/подача/
 * реализация/хранение, упаковка и маркировка, показатели качества и безопасности, методы контроля, пищевая
 * и энергетическая ценность, лист регистрации изменений. Блюда — только с утверждённой ТТК; утверждает руководитель;
 * срок действия не ограничен, актуализация — не реже раза в год (задача технологу на дату).
 */

const NORMATIVE = [
  { code: 'ГОСТ Р 1.4-2004', title: 'Стандартизация в Российской Федерации. Стандарты организаций. Общие положения' },
  { code: 'ГОСТ Р 1.5-2012', title: 'Стандарты национальные. Правила построения, изложения, оформления и обозначения' },
  { code: 'ТР ТС 021/2011', title: 'О безопасности пищевой продукции' },
  { code: 'ТР ТС 022/2011', title: 'Пищевая продукция в части её маркировки' },
  { code: 'ГОСТ 31987-2012', title: 'Технологические документы на продукцию общественного питания. Общие требования' },
  { code: 'ГОСТ 31988-2012', title: 'Метод расчёта отходов и потерь сырья и пищевых продуктов' },
  { code: 'ГОСТ 31986-2012', title: 'Метод органолептической оценки качества продукции общественного питания' },
  { code: 'ГОСТ 30390-2013', title: 'Продукция общественного питания, реализуемая населению. Общие технические условия' },
];

interface StoParams { scope?: string | null; packaging?: string | null; controlMethods?: string | null; okpo?: string | null; transport?: string | null; rawDocs?: Record<string, string> }

async function loadSto(tx: Tx, orgId: string, id: string, lock = false) {
  const s = (await tx.query(`select * from sto_standards where id = $1 and organization_id = $2 ${lock ? 'for update' : ''}`, [parse(z.uuid(), id), orgId])).rows[0];
  if (!s) throw Errors.notFound('СТО не найден.');
  return s;
}

export async function calcSto(tx: Tx, orgId: string, sto: Record<string, any>) {
  const p: StoParams = sto.params || {};
  const warnings: string[] = [];
  const dishes = [];
  const rawMap = new Map<string, { name: string; doc: string | null; dishes: Set<string> }>();
  // СТО на папку: все блюда папки и подпапок (новое блюдо в папке входит в стандарт само)
  const ids: string[] = sto.group_id ? await dishesInTree(tx, sto.group_id) : sto.dish_ids;
  const group = sto.group_id ? (await tx.query(`select name from dish_groups where id = $1`, [sto.group_id])).rows[0]?.name || null : null;
  for (const id of ids) {
    const dish = (await tx.query(`select id, name, card_no from dishes where id = $1 and organization_id = $2`, [id, orgId])).rows[0];
    if (!dish) continue;
    const v = (await tx.query(`select id from ttk_versions where dish_id = $1 and status = 'approved'`, [id])).rows[0];
    if (!v) { warnings.push(`«${dish.name}»: нет утверждённой ТТК — в стандарт не включено.`); continue; }
    const doc = await buildTtkDoc(tx, orgId, id, v.id);
    const tp: TuParams = (await tx.query(`select params from tech_specs where dish_id = $1`, [id])).rows[0]?.params || {};
    const semi = (await tx.query(`select semi_yield_g from ttk_versions where id = $1`, [v.id])).rows[0]?.semi_yield_g;
    for (const r of (await tx.query(`select distinct p.id, p.name from ttk_lines l join products p on p.id = l.product_id where l.version_id = $1`, [v.id])).rows) {
      const cur = rawMap.get(r.id) || { name: r.name, doc: null, dishes: new Set<string>() };
      cur.doc = p.rawDocs?.[r.id]?.trim() || cur.doc || tp.rawDocs?.[r.id]?.trim() || null;
      cur.dishes.add(dish.name); rawMap.set(r.id, cur);
    }
    if (doc.missing.nutrition.length) warnings.push(`«${dish.name}»: пищевая ценность рассчитана не полностью (${doc.missing.nutrition.join('; ')}).`);
    if (!doc.micro_group.confirmed) warnings.push(`«${dish.name}»: не подтверждена группа продукции по ТР ТС 021/2011 для микробиологических показателей (Документы ТТК).`);
    if (!Object.values(doc.version.organoleptic || {}).some(Boolean)) warnings.push(`«${dish.name}»: не заполнены органолептические показатели.`);
    dishes.push({ id, name: dish.name, card_no: dish.card_no, ttk_version: doc.version.version, card_date: doc.version.card_date, kind: doc.dish.kind,
      out_g: doc.out_g, out_label: doc.out_label, semi_yield_g: semi === null || semi === undefined ? null : Number(semi), sections: doc.sections,
      lines: doc.lines.map((l) => ({ kind: l.kind, name: l.name, brutto_g: l.brutto_g, netto_g: l.netto_g, ready_g: l.ready_g, in_yield: l.in_yield, processing: l.processing })),
      technology: doc.version.technology, serving: doc.version.serving, storage: doc.version.storage_conditions, shelf_life: doc.version.shelf_life,
      organoleptic: doc.version.organoleptic, physico: doc.physico, micro: doc.micro, micro_index: doc.micro_index, nutrition: doc.nutrition });
  }
  if (!dishes.length) warnings.push('В стандарте нет блюд с утверждённой ТТК.');
  const raw = [...rawMap.entries()].map(([id, x]) => ({ product_id: id, name: x.name, doc: x.doc, dishes: [...x.dishes] })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  if (raw.some((r) => !r.doc)) warnings.push(`Не указаны нормативные документы на сырьё: ${raw.filter((r) => !r.doc).map((r) => r.name).join(', ')}.`);
  if (!p.scope) warnings.push('Заполните область применения.');
  if (!p.packaging) warnings.push('Заполните раздел «Упаковка и маркировка».');
  if (!p.okpo) warnings.push('Для обозначения СТО укажите ОКПО предприятия.');
  const sanpin = (await tx.query(`select s.code, s.title from reg_sources s where s.organization_id = $1 and s.kind = 'СанПиН'
      and exists (select 1 from reg_source_versions x where x.source_id = s.id and x.workflow_status = 'approved' and (x.effective_from is null or x.effective_from <= current_date)
        and (x.effective_to is null or x.effective_to > current_date)) order by s.code`, [orgId])).rows;
  if (!sanpin.length) warnings.push('В нормативном реестре нет действующих санитарных правил — стандарт не может на них сослаться.');
  const org = (await tx.query(`select name, legal_form, inn from organizations where id = $1`, [orgId])).rows[0];
  const year = new Date().getFullYear();
  return {
    designation: `СТО ${p.okpo || '________'}-${String(sto.seq).padStart(3, '0')}-${year}`, title: sto.title, org, year, group,
    status: warnings.length ? 'project' : 'ready', warnings, generated_at: new Date().toISOString(),
    scope: p.scope || null, packaging: p.packaging || null, transport: p.transport || null, control_methods: p.controlMethods || null,
    normative: [...NORMATIVE, ...sanpin.map((s) => ({ code: s.code, title: s.title }))],
    micro_methods: MICRO.map((m) => ({ name: m.name, method: m.method })),
    raw, dishes,
  };
}

const UpdateInput = z.object({
  title: z.string().trim().min(3, 'Название стандарта.').max(300).optional(),
  dishIds: z.array(z.uuid()).max(300).optional(), groupId: z.uuid().nullable().optional(),
  scope: optText(4000), packaging: optText(4000), controlMethods: optText(4000), transport: optText(2000),
  okpo: z.string().trim().regex(/^\d{8,10}$/, 'ОКПО — 8 или 10 цифр.').nullable().optional().or(z.literal('').transform(() => null)),
  rawDocs: z.record(z.uuid(), z.string().trim().max(300)).optional(),
});

export async function createSto(userId: string, orgId: string, input: unknown) {
  const d = parse(z.object({ title: z.string('Название стандарта.').trim().min(3, 'Название стандарта.').max(300), dishIds: z.array(z.uuid()).max(300).default([]), groupId: z.uuid().nullable().optional() }), input);
  return inOrg(userId, orgId, 'ttk.manage', async (tx) => {
    const okpo = (await tx.query(`select params->>'okpo' as okpo from tech_specs where organization_id = $1 and params ? 'okpo' and params->>'okpo' is not null limit 1`, [orgId])).rows[0]?.okpo || null;
    const seq = Number((await tx.query(`select coalesce(max(seq), 0) + 1 as n from sto_standards where organization_id = $1`, [orgId])).rows[0].n);
    const dishIds = await ownDishes(tx, orgId, d.dishIds);
    if (d.groupId && !(await tx.query(`select 1 from dish_groups where id = $1 and organization_id = $2`, [d.groupId, orgId])).rowCount) throw Errors.validation('Папка не найдена.');
    const s = (await tx.query(`insert into sto_standards (organization_id, seq, title, dish_ids, params, created_by, group_id) values ($1, $2, $3, $4, $5, $6, $7) returning id, seq`,
      [orgId, seq, d.title, dishIds, JSON.stringify(okpo ? { okpo } : {}), userId, d.groupId || null])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'sto.create', entityType: 'sto', entityId: s.id, after: { title: d.title, dishes: dishIds.length } });
    return s;
  });
}

async function ownDishes(tx: Tx, orgId: string, ids: string[]) {
  const ok = (await tx.query(`select id from dishes where organization_id = $1 and id = any($2::uuid[])`, [orgId, ids])).rows.map((r) => r.id);
  if (ok.length !== new Set(ids).size) throw Errors.validation('Блюдо не найдено.');
  return [...new Set(ids)];
}

export async function updateSto(userId: string, orgId: string, stoId: string, input: unknown) {
  const d = parse(UpdateInput, input);
  const given = new Set(Object.keys((input && typeof input === 'object' ? input : {}) as object));
  return inOrg(userId, orgId, 'ttk.manage', async (tx) => {
    const s = await loadSto(tx, orgId, stoId, true);
    const dishIds = d.dishIds ? await ownDishes(tx, orgId, d.dishIds) : s.dish_ids;
    const keys = ['scope', 'packaging', 'controlMethods', 'transport', 'okpo', 'rawDocs'] as const;
    const params = { ...s.params, ...Object.fromEntries(keys.filter((k) => given.has(k)).map((k) => [k, d[k] ?? null])) };
    if (d.groupId && !(await tx.query(`select 1 from dish_groups where id = $1 and organization_id = $2`, [d.groupId, orgId])).rowCount) throw Errors.validation('Папка не найдена.');
    await tx.query(`update sto_standards set title = coalesce($2, title), dish_ids = $3, params = $4, updated_at = now(), group_id = case when $5::boolean then $6 else group_id end where id = $1`,
      [s.id, d.title || null, dishIds, JSON.stringify(params), d.groupId !== undefined, d.groupId ?? null]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'sto.update', entityType: 'sto', entityId: s.id, after: { title: d.title, dishes: dishIds.length, keys: [...given] } });
    return { ok: true };
  });
}

export async function listSto(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'menu.read', async (tx) => (await tx.query(`select s.id, s.seq, s.title, (select name from dish_groups g where g.id = s.group_id) as group_name,
      case when s.group_id is null then cardinality(s.dish_ids) else (with recursive down(id) as (select s.group_id union all select g.id from dish_groups g join down on g.parent_id = down.id)
        select count(*)::int from dishes d where d.group_id in (select id from down) and d.status = 'active') end as dishes,
      (select json_build_object('version', v.version, 'designation', v.designation, 'approved_at', v.approved_at, 'review_due', v.review_due::text) from sto_versions v where v.sto_id = s.id order by v.version desc limit 1) as last
    from sto_standards s where s.organization_id = $1 and s.status = 'active' order by s.seq`, [orgId])).rows);
}

export async function getSto(userId: string, orgId: string, stoId: string) {
  return inOrg(userId, orgId, 'menu.read', async (tx) => {
    const s = await loadSto(tx, orgId, stoId);
    const calc = await calcSto(tx, orgId, s);
    const versions = (await tx.query(`select v.version, v.designation, v.change_note, v.approved_at, v.review_due::text as review_due, u.full_name as approved_by_name
      from sto_versions v join users u on u.id = v.approved_by where v.sto_id = $1 order by v.version`, [s.id])).rows;
    const today = (await tx.query(`select (now() at time zone timezone)::date::text as d from organizations where id = $1`, [orgId])).rows[0].d;
    const last = versions[versions.length - 1];
    return { sto: { id: s.id, seq: s.seq, title: s.title, dish_ids: s.dish_ids, group_id: s.group_id, params: s.params }, calc, versions, review_overdue: !!last && last.review_due < today };
  });
}

/** Утверждение руководителем: полный стандарт; снимок; задача технологу — актуализировать через год. */
export async function approveSto(userId: string, orgId: string, stoId: string, input: unknown) {
  const d = parse(z.object({ changeNote: z.string('Что введено или изменено.').trim().min(3, 'Укажите, что введено или изменено (лист регистрации изменений).').max(500) }), input);
  return inOrg(userId, orgId, 'sto.approve', async (tx) => {
    const s = await loadSto(tx, orgId, stoId, true);
    const calc = await calcSto(tx, orgId, s);
    if (calc.status !== 'ready') throw Errors.conflict(`СТО — проект, утвердить нельзя: ${calc.warnings.join(' ')}`);
    const n = Number((await tx.query(`select coalesce(max(version), 0) + 1 as n from sto_versions where sto_id = $1`, [s.id])).rows[0].n);
    const due = (await tx.query(`select ((now() at time zone timezone)::date + interval '1 year')::date::text as d from organizations where id = $1`, [orgId])).rows[0].d;
    const row = (await tx.query(`insert into sto_versions (organization_id, sto_id, version, designation, snapshot, change_note, review_due, approved_by) values ($1, $2, $3, $4, $5, $6, $7, $8)
      returning version, approved_at, review_due::text as review_due`, [orgId, s.id, n, calc.designation, JSON.stringify(calc), d.changeNote, due, userId])).rows[0];
    await closeTasksFor(tx, orgId, 'sto_review', s.id, userId, `утверждена версия ${n}`);
    await openTask(tx, { orgId, kind: 'sto_review', title: `Актуализировать ${calc.designation} «${s.title}»`, details: 'Стандарт организации актуализируется не реже одного раза в год.',
      entityType: 'sto', entityId: s.id, assigneeRole: 'technologist', dueAt: new Date(`${due}T09:00:00Z`), createdBy: userId });
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'sto.approve', entityType: 'sto', entityId: s.id, after: { version: n, designation: calc.designation, review_due: due } });
    return row;
  });
}

export async function getStoVersion(userId: string, orgId: string, stoId: string, version: number) {
  return inOrg(userId, orgId, 'menu.read', async (tx) => {
    const s = await loadSto(tx, orgId, stoId);
    const v = (await tx.query(`select v.*, v.review_due::text as review_due, u.full_name as approved_by_name from sto_versions v join users u on u.id = v.approved_by where v.sto_id = $1 and v.version = $2`, [s.id, version])).rows[0];
    if (!v) throw Errors.notFound('Версия СТО не найдена.');
    v.integrity = await assertSnapshotIntact(tx, 'sto_versions', v.id, { orgId, userId });
    const all = (await tx.query(`select v.version, v.designation, v.change_note, v.approved_at, u.full_name as approved_by_name from sto_versions v join users u on u.id = v.approved_by
      where v.sto_id = $1 and v.version <= $2 order by v.version`, [s.id, version])).rows;
    return { ...v, versions: all };
  });
}
