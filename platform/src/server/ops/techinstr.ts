import { z } from 'zod';
import { assertSnapshotIntact } from './integrity';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse } from './common';
import { buildTtkDoc } from './ttkdoc';
import { versionSteps } from './processing';
import { PLAN_KIND } from './sanitation';
import { SAMPLE_DEFAULTS } from './lab';
import type { TuParams } from './techspec';
import { effectiveParams } from './dishgroups';
import { profileOf, samplesRequired } from '../norms/library';

/**
 * Технологическая инструкция (ТИ) на продукцию: титульный лист (организация, код продукции, группа, ОКС, «Утверждаю»,
 * обозначение, «вводится впервые», дата введения, «Разработано»), основная часть по ГОСТ 31987-2012 п. 5.2.4 (область
 * применения, ассортимент, сырьё, рецептура, технологический процесс с санитарной обработкой, упаковка и маркировка,
 * транспортирование и хранение, организация контроля), справочное приложение и лист регистрации изменений.
 * Источник — утверждённая ТТК и то, что уже ведётся в системе; чего система не знает, вписывает технолог (без этого — «ПРОЕКТ»).
 * Обозначение — по п. 5.2.6: при наличии ТУ — «ТИ» и обозначение ТУ без года; иначе код продукции — номер — ОКПО.
 */

const r1 = (x: number) => Math.round(x * 10) / 10, r3 = (x: number) => Math.round(x * 1000) / 1000;

const RECEIPT_CONTROL = 'При приёмке каждая партия сырья проверяется на целостность упаковки, маркировку, наличие и соответствие сопроводительных документов, '
  + 'органолептические показатели и температуру; срок годности фиксируется по маркировке. Партия с отклонением не допускается в производство '
  + '(возврат или изоляция по решению ответственного), результаты фиксируются в журнале приёмки.';

export async function calcTi(tx: Tx, orgId: string, dishId: string, params: TuParams) {
  const dish = (await tx.query(`select id, name, kind from dishes where id = $1 and organization_id = $2`, [dishId, orgId])).rows[0];
  if (!dish) throw Errors.notFound('Блюдо не найдено.');
  const v = (await tx.query(`select id from ttk_versions where dish_id = $1 and status = 'approved'`, [dishId])).rows[0];
  if (!v) throw Errors.conflict(`У «${dish.name}» нет утверждённой ТТК — ТИ составляется по утверждённой карте.`);
  const doc = await buildTtkDoc(tx, orgId, dishId, v.id);
  const steps = await versionSteps(tx, v.id);
  const lineIds = (await tx.query(`select id, product_id from ttk_lines where version_id = $1 and kind = 'item' order by position`, [v.id])).rows;
  const items = doc.lines.filter((l) => l.kind === 'item');
  const out = doc.out_g;
  const warnings: string[] = [];

  // 2. сырьё и НД на него
  const rawDocs = params.rawDocs || {};
  const products = (await tx.query(`select distinct p.id, p.name from ttk_lines l join products p on p.id = l.product_id where l.version_id = $1 order by p.name`, [v.id])).rows;
  const raw = products.map((p) => ({ product_id: p.id, name: p.name, doc: rawDocs[p.id]?.trim() || null }));
  if (raw.some((x) => !x.doc)) warnings.push(`Не указаны нормативные документы на сырьё: ${raw.filter((x) => !x.doc).map((x) => x.name).join(', ')}.`);

  // 3. рецептура: на выход ТТК и на 1 кг (100 порций для блюда), нормы отходов и потерь
  const recipe = items.map((l, i) => {
    const ls = steps.get(lineIds[i]?.id) || [];
    return { name: l.name, brutto_g: l.brutto_g, netto_g: l.netto_g, ready_g: l.ready_g, in_yield: l.in_yield,
      per_kg: { brutto: l.brutto_g === null || !out ? null : r1(l.brutto_g / out * 1000), netto: l.netto_g === null || !out ? null : r1(l.netto_g / out * 1000) },
      per_100: dish.kind === 'dish' ? { brutto_kg: l.brutto_g === null ? null : r3(l.brutto_g * 100 / 1000), netto_kg: l.netto_g === null ? null : r3(l.netto_g * 100 / 1000) } : null,
      losses: ls.map((s) => ({ method: s.method_name, kind: s.kind, loss_pct: s.loss_pct, basis: s.basis })) };
  });

  // 4. технологический процесс: подготовка сырья по шагам обработки, затем технология ТТК
  const prep = recipe.filter((x) => x.losses.length).map((x) => `${x.name}: ${x.losses.map((s) => `${s.method.toLowerCase()} (${s.loss_pct < 0 ? 'привар' : s.kind === 'cold' ? 'отходы' : 'потери'} ${Math.abs(s.loss_pct)} %)`).join(' → ')}`);

  // 6. контроль: ККТ при выпуске, лабораторный контроль, суточные пробы, приёмка
  const ccp = (await tx.query(`select name, unit, min_value, max_value, basis from release_checks where dish_id = $1 and status = 'active' order by created_at`, [dishId])).rows
    .map((c) => ({ name: c.name, limits: [c.min_value !== null ? `не ниже ${Number(c.min_value)}` : '', c.max_value !== null ? `не выше ${Number(c.max_value)}` : ''].filter(Boolean).join(', ') + (c.unit ? ` ${c.unit}` : ''), basis: c.basis }));
  const lab = (await tx.query(`select test_type, target, period_days, basis from lab_programs where organization_id = $1 and status = 'active' and (dish_id = $2 or dish_id is null) order by test_type`, [orgId, dishId])).rows
    .map((p) => ({ test: p.test_type, target: p.target, period: `раз в ${p.period_days} дн.`, basis: p.basis }));
  const ss = (await tx.query(`select min_weight_g, retention_hours, t_min, t_max, basis from sample_settings where organization_id = $1`, [orgId])).rows[0];
  const samples = ss ? { weight_g: Number(ss.min_weight_g), hours: Number(ss.retention_hours), t: `${Number(ss.t_min)}…${Number(ss.t_max)} °C`, basis: ss.basis, confirmed: true }
    : { weight_g: SAMPLE_DEFAULTS.min_weight_g, hours: SAMPLE_DEFAULTS.retention_hours, t: `${SAMPLE_DEFAULTS.t_min}…${SAMPLE_DEFAULTS.t_max} °C`, basis: SAMPLE_DEFAULTS.basis, confirmed: false };
  const needSamples = samplesRequired(await profileOf(tx, orgId));
  if (needSamples && !samples.confirmed) warnings.push('Параметры суточной пробы не утверждены в разделе «Лаборатория» — в ТИ указаны значения по умолчанию.');
  if (!lab.length) warnings.push('Нет программы лабораторного контроля — раздел «Организация контроля за качеством и безопасностью продукции» неполный.');

  // 8. санитария: план санитарной обработки, допуск персонала, санитарные правила из реестра
  const sanitation = (await tx.query(`select distinct on (area, work, kind) area, work, kind, period_days from sanitation_plans where organization_id = $1 and status = 'active' order by area, work, kind`, [orgId])).rows
    .map((s) => ({ area: s.area, work: s.work, kind: PLAN_KIND[s.kind] || s.kind, period: `раз в ${s.period_days} дн.` }));
  if (!sanitation.length) warnings.push('Нет плана санитарной обработки — пункт 5.4 «Санитарная обработка» неполный.');
  const gate = (await tx.query(`select medical_gate from staff_settings where organization_id = $1`, [orgId])).rows[0]?.medical_gate || 'warn';
  const sanpin = (await tx.query(`select s.code, s.title from reg_sources s where s.organization_id = $1 and s.kind = 'СанПиН'
      and exists (select 1 from reg_source_versions x where x.source_id = s.id and x.workflow_status = 'approved' and (x.effective_from is null or x.effective_from <= current_date)
        and (x.effective_to is null or x.effective_to > current_date)) order by s.code`, [orgId])).rows;
  if (!sanpin.length) warnings.push('В нормативном реестре нет действующих санитарных правил — ТИ не может на них сослаться.');

  const tu = (await tx.query(`select designation, version from tech_spec_versions where dish_id = $1 order by version desc limit 1`, [dishId])).rows[0] || null;
  if (!tu && (!params.okpd2 || !params.okpo)) warnings.push('Для обозначения ТИ укажите код продукции ОКПД2 и ОКПО предприятия (в параметрах ТУ) или утвердите ТУ — тогда обозначение ТИ строится от обозначения ТУ (ГОСТ 31987-2012, п. 5.2.6).');
  if (!params.tiPackaging) warnings.push('Заполните раздел «Упаковка и маркировка».');
  if (!params.tiSafety) warnings.push('Заполните приложение «Требования безопасности» (охрана труда, оборудование).');
  if (!doc.version.storage_conditions || !doc.version.shelf_life) warnings.push('В ТТК не указаны условия хранения или срок годности.');

  const year = new Date().getFullYear();
  // ГОСТ 31987-2012, п. 5.2.6: для продукции по ТУ — «ТИ» и обозначение ТУ без года; иначе обозначение присваивает
  // держатель подлинника (код продукции, регистрационный номер, ОКПО — без года)
  const code4 = (params.okpd2 || '').replace(/\D/g, '').slice(0, 4).padEnd(4, '_');
  const designation = tu ? `ТИ ${tu.designation.replace(/^ТУ\s*/, '').replace(/-\d{2,4}$/, '')}`
    : `ТИ ${code4}-${(params.tiSeq || '001').padStart(3, '0')}-${params.okpo || '________'}`;
  return {
    designation, status: warnings.length ? 'project' : 'ready', warnings, generated_at: new Date().toISOString(),
    org: doc.org, sites: doc.sites, dish: { ...doc.dish, kind: dish.kind }, ttk: { version_id: v.id, version: doc.version.version, card_no: doc.dish.card_no, card_date: doc.version.card_date },
    title: { okpd2: params.okpd2 || null, group: params.tiGroup || null, oks: params.tiOks || null, city: params.tiCity || null, year },
    tu: tu ? { designation: tu.designation, version: tu.version } : null,
    out_g: out, out_label: doc.out_label, raw, recipe, sections: doc.sections, prep, technology: doc.version.technology, serving: doc.version.serving,
    equipment: params.tiEquipment || null, packaging: params.tiPackaging || null, safety: params.tiSafety || null, environment: params.tiEnvironment || null,
    control: { receipt: RECEIPT_CONTROL, ccp, lab, samples: { ...samples, required: needSamples }, organoleptic: doc.version.organoleptic, physico: doc.physico, micro: doc.micro, micro_index: doc.micro_index },
    storage: { conditions: doc.version.storage_conditions, shelf_life: doc.version.shelf_life },
    sanitation: { plans: sanitation, medical_gate: gate, sanpin },
  };
}

async function params(tx: Tx, dishId: string): Promise<TuParams> {
  return effectiveParams(tx, dishId);
}

export async function getTi(userId: string, orgId: string, dishId: string) {
  return inOrg(userId, orgId, 'menu.read', async (tx) => {
    const id = parse(z.uuid(), dishId);
    const p = await params(tx, id);
    const calc = await calcTi(tx, orgId, id, p);
    const versions = (await tx.query(`select v.version, v.designation, v.change_note, v.approved_at, u.full_name as approved_by_name, t.version as ttk_version
      from ti_versions v join users u on u.id = v.approved_by join ttk_versions t on t.id = v.ttk_version_id where v.dish_id = $1 order by v.version`, [id])).rows;
    return { params: p, calc, versions };
  });
}

/** Утверждение ТИ: только полный расчёт; снимок не меняется, версия попадает в лист регистрации изменений. */
export async function approveTi(userId: string, orgId: string, dishId: string, input: unknown) {
  const d = parse(z.object({ changeNote: z.string('Что введено или изменено.').trim().min(3, 'Укажите, что введено или изменено (для листа регистрации изменений).').max(500) }), input);
  return inOrg(userId, orgId, 'ttk.approve', async (tx) => {
    const id = parse(z.uuid(), dishId);
    const calc = await calcTi(tx, orgId, id, await params(tx, id));
    if (calc.status !== 'ready') throw Errors.conflict(`ТИ — проект, утвердить нельзя: ${calc.warnings.join(' ')}`);
    const n = Number((await tx.query(`select coalesce(max(version), 0) + 1 as n from ti_versions where dish_id = $1`, [id])).rows[0].n);
    const row = (await tx.query(`insert into ti_versions (organization_id, dish_id, version, ttk_version_id, designation, snapshot, change_note, approved_by) values ($1, $2, $3, $4, $5, $6, $7, $8) returning version, approved_at`,
      [orgId, id, n, calc.ttk.version_id, calc.designation, JSON.stringify(calc), d.changeNote, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'ti.approve', entityType: 'dish', entityId: id, after: { version: n, designation: calc.designation, note: d.changeNote } });
    return row;
  });
}

export async function getTiVersion(userId: string, orgId: string, dishId: string, version: number) {
  return inOrg(userId, orgId, 'menu.read', async (tx) => {
    const v = (await tx.query(`select v.*, u.full_name as approved_by_name from ti_versions v join users u on u.id = v.approved_by where v.dish_id = $1 and v.organization_id = $2 and v.version = $3`,
      [parse(z.uuid(), dishId), orgId, version])).rows[0];
    if (!v) throw Errors.notFound('Версия ТИ не найдена.');
    v.integrity = await assertSnapshotIntact(tx, 'ti_versions', v.id, { orgId, userId });
    const all = (await tx.query(`select version, designation, change_note, approved_at, u.full_name as approved_by_name from ti_versions v join users u on u.id = v.approved_by
      where v.dish_id = $1 and v.version <= $2 order by version`, [dishId, version])).rows;
    return { ...v, versions: all };
  });
}
