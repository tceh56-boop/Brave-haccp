import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText, openTask } from './common';

/**
 * Нормативный реестр (ТЗ v2 §7–8). Принципы:
 *  - редакция становится действующей только после проверки специалистом и утверждения, при наличии даты
 *    начала действия, области применения требований, владельца актуализации и даты следующей проверки (AT-08);
 *  - «Скоро вступает в силу», «Действует», «Утратил силу» вычисляются из дат утверждённой редакции —
 *    сторонняя статья или AI их не присваивают;
 *  - новая редакция не стирает прежнюю: сравнение пунктов и задачи пересмотра связанных процедур (AT-09);
 *  - применимость требования к предприятию система предлагает по профилю, решает специалист.
 */

export const OBJECT_TYPES: Record<string, string> = {
  restaurant: 'Ресторан', cafe: 'Кафе', canteen: 'Столовая', catering: 'Кейтеринг', delivery: 'Доставка', school: 'Питание в образовательной организации', hospital: 'Питание в медицинской организации',
};
export const PROCESSES: Record<string, string> = {
  receiving: 'Приёмка', storage: 'Хранение', cold_prep: 'Холодная обработка', thermal: 'Тепловая обработка', cooling: 'Охлаждение', serving: 'Раздача',
  delivery: 'Доставка', cleaning: 'Уборка и дезинфекция', staff: 'Персонал', packaging: 'Упаковка и маркировка', water: 'Водоснабжение', waste: 'Отходы',
};
export const BINDING_LABEL: Record<string, string> = { mandatory: 'обязательный', voluntary: 'добровольный', methodological: 'методический', unknown: 'не определено' };

export type RegState = 'draft' | 'needs_review' | 'checked' | 'upcoming' | 'in_force' | 'repealed' | 'suspended' | 'archived';
export const STATE_LABEL: Record<RegState, string> = {
  draft: 'Проект', needs_review: 'Требует проверки', checked: 'Проверен специалистом', upcoming: 'Скоро вступает в силу', in_force: 'Действует',
  repealed: 'Утратил силу', suspended: 'Приостановлен / оспаривается', archived: 'Архивный',
};

interface VersionRow { workflow_status: string; effective_from: string | Date | null; effective_to: string | Date | null; replaced_from?: string | Date | null }

const ymd = (d: string | Date) => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));

/** Состояние редакции на дату. Утверждённая редакция, заменённая вступившей новой, — «Утратил силу». */
export function versionState(v: VersionRow, today = new Date().toISOString().slice(0, 10)): RegState {
  if (v.workflow_status !== 'approved') return v.workflow_status as RegState;
  if (v.effective_from && ymd(v.effective_from) > today) return 'upcoming';
  if (v.effective_to && ymd(v.effective_to) <= today) return 'repealed';
  if (v.replaced_from && ymd(v.replaced_from) <= today) return 'repealed';
  return 'in_force';
}

// ───────── Профиль предприятия ─────────

const arr = (keys: Record<string, string>) => z.array(z.string().refine((x) => x in keys, 'Неизвестное значение.')).max(30);
const ProfileInput = z.object({ objectTypes: arr(OBJECT_TYPES).default([]), processes: arr(PROCESSES).default([]), productGroups: z.array(z.string().trim().min(2).max(60)).max(50).default([]), salesModes: z.array(z.enum(['hall', 'takeaway', 'delivery', 'catering'])).default([]) });

export async function getProfile(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'reg.read', async (tx) => (await tx.query(`select * from org_regulatory_profiles where organization_id = $1`, [orgId])).rows[0]
    || { organization_id: orgId, object_types: [], processes: [], product_groups: [], sales_modes: [] });
}

export async function saveProfile(userId: string, orgId: string, input: unknown) {
  const d = parse(ProfileInput, input);
  return inOrg(userId, orgId, 'reg.manage', async (tx) => {
    const before = (await tx.query(`select * from org_regulatory_profiles where organization_id = $1`, [orgId])).rows[0] || null;
    const p = (await tx.query(`insert into org_regulatory_profiles (organization_id, object_types, processes, product_groups, sales_modes, updated_by)
      values ($1, $2, $3, $4, $5, $6) on conflict (organization_id) do update set object_types = excluded.object_types, processes = excluded.processes,
      product_groups = excluded.product_groups, sales_modes = excluded.sales_modes, updated_by = excluded.updated_by, updated_at = now() returning *`,
      [orgId, d.objectTypes, d.processes, d.productGroups, d.salesModes, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'reg.profile_save', entityType: 'reg_profile', entityId: orgId, before, after: p });
    return p;
  });
}

// ───────── Стартовый перечень (ТЗ v2 §8) ─────────

interface StartItem { code: string; kind: string; title: string; issuer?: string; url?: string; jurisdiction?: string; binding?: string; note: string;
  version: { edition: string; published_at?: string; effective_from?: string; effective_to?: string; transitional?: string } }

/**
 * Только то, что прямо указано в ТЗ v2 §8. Пункты, редакции и даты, которых нет в ТЗ, не заполняются —
 * их вносит специалист по официальному тексту. Всё — в статусе «Требует проверки».
 */
export const START_LIST: StartItem[] = [
  { code: 'СанПиН 2.3/2.4.4282-26', kind: 'СанПиН', title: 'СанПиН 2.3/2.4.4282-26 (санитарные требования к организациям общественного питания)',
    issuer: 'Главный государственный санитарный врач РФ', url: 'https://zpp.rospotrebnadzor.ru/news/federal/593840', jurisdiction: 'РФ', binding: 'mandatory',
    note: 'По ТЗ v2 §8: утверждён постановлением Главного государственного санитарного врача РФ от 02.06.2026 № 18; заявленный период действия с 01.09.2026 по 01.09.2032. Официальный текст, пункты и переходные положения вносит и проверяет специалист.',
    version: { edition: 'утв. постановлением от 02.06.2026 № 18', published_at: '2026-06-02', effective_from: '2026-09-01', effective_to: '2032-09-01' } },
  { code: 'СанПиН 2.3/2.4.3590-20', kind: 'СанПиН', title: 'СанПиН 2.3/2.4.3590-20 «Санитарно-эпидемиологические требования к организации общественного питания населения»',
    issuer: 'Главный государственный санитарный врач РФ', jurisdiction: 'РФ', binding: 'mandatory',
    note: 'По ТЗ v2 §8: хранить как исторический/переходный источник по официальным датам; не применять автоматически как текущую основу после вступления новых правил.',
    version: { edition: 'требует указания редакции' } },
  { code: 'ТР ТС 021/2011', kind: 'ТР ТС', title: 'ТР ТС 021/2011 «О безопасности пищевой продукции»', issuer: 'Комиссия Таможенного союза', jurisdiction: 'ЕАЭС', binding: 'mandatory', note: 'Проверить применимость и актуальную редакцию (ТЗ v2 §8).', version: { edition: 'требует указания редакции' } },
  { code: 'ТР ТС 022/2011', kind: 'ТР ТС', title: 'ТР ТС 022/2011 «Пищевая продукция в части её маркировки»', issuer: 'Комиссия Таможенного союза', jurisdiction: 'ЕАЭС', binding: 'mandatory', note: 'Применимость зависит от продукта и способа реализации (ТЗ v1 §18).', version: { edition: 'требует указания редакции' } },
  { code: 'ТР ТС 005/2011', kind: 'ТР ТС', title: 'ТР ТС 005/2011 «О безопасности упаковки»', issuer: 'Комиссия Таможенного союза', jurisdiction: 'ЕАЭС', binding: 'mandatory', note: 'Если применяется упаковка (ТЗ v1 §18).', version: { edition: 'требует указания редакции' } },
  { code: '52-ФЗ', kind: 'ФЗ', title: 'Федеральный закон № 52-ФЗ «О санитарно-эпидемиологическом благополучии населения»', jurisdiction: 'РФ', binding: 'mandatory', note: 'Проверить актуальную редакцию.', version: { edition: 'требует указания редакции' } },
  { code: '152-ФЗ', kind: 'ФЗ', title: 'Федеральный закон № 152-ФЗ «О персональных данных»', url: 'https://mintrud.gov.ru/docs/laws/130', jurisdiction: 'РФ', binding: 'mandatory', note: 'Юридическая проверка обработки и доступа (ТЗ v2 §9).', version: { edition: 'требует указания редакции' } },
  { code: '402-ФЗ', kind: 'ФЗ', title: 'Федеральный закон № 402-ФЗ «О бухгалтерском учёте»', url: 'https://minjust.gov.ru/ru/documents/7616/', jurisdiction: 'РФ', binding: 'mandatory', note: 'Для документов, заявленных как первичные (ТЗ v2 §10).', version: { edition: 'требует указания редакции' } },
  { code: '54-ФЗ', kind: 'ФЗ', title: 'Федеральный закон № 54-ФЗ о применении контрольно-кассовой техники', url: 'https://www.nalog.gov.ru/rn77/about_fts/docs/3997100/', jurisdiction: 'РФ', binding: 'mandatory', note: 'Касса работает через интеграцию с ККТ; система не заменяет фискальную кассу (ТЗ v2 §10).', version: { edition: 'требует указания редакции' } },
  { code: '162-ФЗ', kind: 'ФЗ', title: 'Федеральный закон № 162-ФЗ «О стандартизации в Российской Федерации»', jurisdiction: 'РФ', binding: 'mandatory', note: 'Проверить актуальную редакцию.', version: { edition: 'требует указания редакции' } },
  { code: 'ГОСТ Р 51740-2016', kind: 'ГОСТ', title: 'ГОСТ Р 51740-2016 «Технические условия на пищевую продукцию. Общие требования к разработке и оформлению»', jurisdiction: 'РФ', binding: 'voluntary', note: 'В части применимости; ТУ не нужны автоматически на каждое блюдо (ТЗ v2 §8).', version: { edition: '2016' } },
];

export async function seedStartList(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'reg.manage', async (tx) => {
    let added = 0;
    for (const s of START_LIST) {
      const src = (await tx.query(`insert into reg_sources (organization_id, code, kind, title, issuer, official_url, jurisdiction, binding, note, created_by)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict (organization_id, code) do nothing returning id`,
        [orgId, s.code, s.kind, s.title, s.issuer || null, s.url || null, s.jurisdiction || 'РФ', s.binding || 'unknown', s.note, userId])).rows[0];
      if (!src) continue;
      await tx.query(`insert into reg_source_versions (organization_id, source_id, edition, published_at, effective_from, effective_to, transitional, workflow_status, data_origin, created_by)
        values ($1, $2, $3, $4, $5, $6, $7, 'needs_review', 'ТЗ v2 §8 — требует сверки с официальным текстом', $8)`,
        [orgId, src.id, s.version.edition, s.version.published_at || null, s.version.effective_from || null, s.version.effective_to || null, s.version.transitional || null, userId]);
      added++;
    }
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'reg.seed_start_list', entityType: 'reg_sources', after: { added } });
    return { added, total: START_LIST.length };
  });
}

// ───────── Источники и редакции ─────────

async function versionsWithState(tx: Tx, where: string, params: unknown[]) {
  const rows = (await tx.query(`select v.*, s.code, s.title, s.kind, s.binding, s.official_url, s.issuer, s.jurisdiction,
      cu.full_name as checked_by_name, au.full_name as approved_by_name, ou.full_name as owner_name,
      (select min(n.effective_from) from reg_source_versions n where n.supersedes_version_id = v.id and n.workflow_status = 'approved') as replaced_from,
      (select count(*) from reg_requirements r where r.version_id = v.id)::int as requirements
    from reg_source_versions v join reg_sources s on s.id = v.source_id
    left join users cu on cu.id = v.checked_by left join users au on au.id = v.approved_by left join users ou on ou.id = v.owner_user_id
    where ${where} order by v.created_at`, params)).rows;
  return rows.map((v) => { const st = versionState(v); return { ...v, state: st, state_label: STATE_LABEL[st] }; });
}

export async function listSources(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'reg.read', async (tx) => {
    const sources = (await tx.query(`select * from reg_sources where organization_id = $1 order by kind, code`, [orgId])).rows;
    const versions = await versionsWithState(tx, 'v.organization_id = $1', [orgId]);
    const today = new Date().toISOString().slice(0, 10);
    return sources.map((s) => {
      const vs = versions.filter((v) => v.source_id === s.id);
      const current = vs.find((v) => v.state === 'in_force') || vs.find((v) => v.state === 'upcoming') || vs[vs.length - 1] || null;
      return { ...s, binding_label: BINDING_LABEL[s.binding], current, versions: vs.length,
        check_overdue: !!vs.find((v) => v.workflow_status === 'approved' && v.next_check_at && ymd(v.next_check_at) < today) };
    });
  });
}

export async function getSource(userId: string, orgId: string, sourceId: string) {
  return inOrg(userId, orgId, 'reg.read', async (tx) => {
    const s = (await tx.query(`select * from reg_sources where id = $1 and organization_id = $2`, [sourceId, orgId])).rows[0];
    if (!s) throw Errors.notFound('Источник не найден.');
    const versions = await versionsWithState(tx, 'v.source_id = $1', [sourceId]);
    const reqs = (await tx.query(`select r.*, a.applicable, a.rationale, a.decided_at, du.full_name as decided_by_name,
        (select count(*) from control_rules c where c.requirement_id = r.id and c.status = 'approved')::int as rules
      from reg_requirements r left join reg_applicability a on a.requirement_id = r.id left join users du on du.id = a.decided_by
      where r.version_id = any($1::uuid[]) order by r.clause`, [versions.map((v) => v.id)])).rows;
    const reviews = (await tx.query(`select * from reg_reviews where new_version_id = any($1::uuid[]) order by created_at desc`, [versions.map((v) => v.id)])).rows;
    const profile = (await tx.query(`select * from org_regulatory_profiles where organization_id = $1`, [orgId])).rows[0] || null;
    return { source: { ...s, binding_label: BINDING_LABEL[s.binding] }, versions, requirements: reqs.map((r) => ({ ...r, proposal: proposeApplicability(r, profile) })), reviews };
  });
}

const date = z.iso.date().optional().nullable();

const SourceInput = z.object({
  code: z.string().trim().min(2).max(120), kind: z.enum(['СанПиН', 'ТР ТС', 'ФЗ', 'ГОСТ', 'МУК', 'Постановление', 'Приказ', 'Внутренний', 'Другое']),
  title: z.string().trim().min(5, 'Укажите официальное название.').max(500), issuer: optText(300), officialUrl: z.url().optional().nullable(),
  jurisdiction: z.enum(['РФ', 'ЕАЭС', 'Субъект РФ', 'Организация']).default('РФ'), binding: z.enum(['mandatory', 'voluntary', 'methodological', 'unknown']).default('unknown'), note: optText(1000),
  edition: z.string().trim().min(2, 'Укажите редакцию.').max(200), publishedAt: date, effectiveFrom: date, effectiveTo: date, transitional: optText(2000), fileRef: optText(500),
});

export async function createSource(userId: string, orgId: string, input: unknown) {
  const d = parse(SourceInput, input);
  return inOrg(userId, orgId, 'reg.manage', async (tx) => {
    if ((await tx.query(`select 1 from reg_sources where organization_id = $1 and code = $2`, [orgId, d.code])).rowCount) throw Errors.conflict('Источник с таким обозначением уже есть.');
    const s = (await tx.query(`insert into reg_sources (organization_id, code, kind, title, issuer, official_url, jurisdiction, binding, note, created_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`, [orgId, d.code, d.kind, d.title, d.issuer, d.officialUrl || null, d.jurisdiction, d.binding, d.note, userId])).rows[0];
    const v = (await tx.query(`insert into reg_source_versions (organization_id, source_id, edition, published_at, effective_from, effective_to, transitional, file_ref, workflow_status, data_origin, created_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', 'ввод специалиста', $9) returning *`,
      [orgId, s.id, d.edition, d.publishedAt || null, d.effectiveFrom || null, d.effectiveTo || null, d.transitional, d.fileRef, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'reg.source_create', entityType: 'reg_source', entityId: s.id, after: { source: s, version: v } });
    return { source: s, version: v };
  });
}

const VersionInput = z.object({ edition: z.string().trim().min(2).max(200), publishedAt: date, effectiveFrom: date, effectiveTo: date, transitional: optText(2000), fileRef: optText(500) });

/** Новая редакция источника: прежняя остаётся в истории; пункты переносятся как черновик для сверки. */
export async function addVersion(userId: string, orgId: string, sourceId: string, input: unknown) {
  const d = parse(VersionInput, input);
  return inOrg(userId, orgId, 'reg.manage', async (tx) => {
    if (!(await tx.query(`select 1 from reg_sources where id = $1 and organization_id = $2`, [sourceId, orgId])).rowCount) throw Errors.notFound('Источник не найден.');
    const prev = (await tx.query(`select * from reg_source_versions where source_id = $1 and workflow_status = 'approved' order by approved_at desc limit 1`, [sourceId])).rows[0] || null;
    const v = (await tx.query(`insert into reg_source_versions (organization_id, source_id, edition, published_at, effective_from, effective_to, transitional, file_ref, workflow_status, supersedes_version_id, data_origin, created_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, 'ввод специалиста', $10) returning *`,
      [orgId, sourceId, d.edition, d.publishedAt || null, d.effectiveFrom || null, d.effectiveTo || null, d.transitional, d.fileRef, prev?.id || null, userId])).rows[0];
    if (prev) await tx.query(`insert into reg_requirements (organization_id, version_id, clause, text, scope, object_types, processes, product_groups, created_by)
      select organization_id, $2, clause, text, scope, object_types, processes, product_groups, $3 from reg_requirements where version_id = $1`, [prev.id, v.id, userId]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'reg.version_add', entityType: 'reg_version', entityId: v.id, after: { ...v, copied_from: prev?.id || null } });
    return v;
  });
}

async function editableVersion(tx: Tx, orgId: string, versionId: string) {
  const v = (await tx.query(`select * from reg_source_versions where id = $1 and organization_id = $2 for update`, [versionId, orgId])).rows[0];
  if (!v) throw Errors.notFound('Редакция не найдена.');
  if (['approved', 'archived'].includes(v.workflow_status)) throw Errors.conflict('Утверждённая редакция не изменяется — добавьте новую редакцию.');
  return v;
}

/** Правка данных редакции. Проверенная редакция после правки снова требует проверки. */
export async function updateVersion(userId: string, orgId: string, versionId: string, input: unknown) {
  const d = parse(VersionInput.partial(), input);
  return inOrg(userId, orgId, 'reg.manage', async (tx) => {
    const v = await editableVersion(tx, orgId, versionId);
    const after = (await tx.query(`update reg_source_versions set edition = coalesce($2, edition), published_at = coalesce($3, published_at), effective_from = coalesce($4, effective_from),
      effective_to = coalesce($5, effective_to), transitional = coalesce($6, transitional), file_ref = coalesce($7, file_ref),
      workflow_status = case when workflow_status = 'checked' then 'needs_review' else workflow_status end,
      last_checked_at = case when workflow_status = 'checked' then null else last_checked_at end, checked_by = case when workflow_status = 'checked' then null else checked_by end,
      check_evidence = case when workflow_status = 'checked' then null else check_evidence end
      where id = $1 returning *`, [versionId, d.edition ?? null, d.publishedAt ?? null, d.effectiveFrom ?? null, d.effectiveTo ?? null, d.transitional ?? null, d.fileRef ?? null])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'reg.version_update', entityType: 'reg_version', entityId: versionId, before: v, after });
    return after;
  });
}

const ReqInput = z.object({
  clause: z.string().trim().min(1, 'Укажите пункт.').max(60),
  text: z.string().trim().min(10, 'Внесите формулировку из официального текста.').max(4000),
  scope: z.string().trim().min(5, 'Укажите область применения.').max(500),
  objectTypes: arr(OBJECT_TYPES).default([]), processes: arr(PROCESSES).default([]), productGroups: z.array(z.string().trim().min(2).max(60)).max(30).default([]),
});

export async function addRequirement(userId: string, orgId: string, versionId: string, input: unknown) {
  const d = parse(ReqInput, input);
  return inOrg(userId, orgId, 'reg.manage', async (tx) => {
    const v = await editableVersion(tx, orgId, versionId);
    if ((await tx.query(`select 1 from reg_requirements where version_id = $1 and clause = $2`, [versionId, d.clause])).rowCount) throw Errors.conflict('Этот пункт уже внесён в редакцию.');
    const r = (await tx.query(`insert into reg_requirements (organization_id, version_id, clause, text, scope, object_types, processes, product_groups, created_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`, [orgId, versionId, d.clause, d.text, d.scope, d.objectTypes, d.processes, d.productGroups, userId])).rows[0];
    if (v.workflow_status === 'checked') await tx.query(`update reg_source_versions set workflow_status = 'needs_review', last_checked_at = null, checked_by = null, check_evidence = null where id = $1`, [versionId]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'reg.requirement_add', entityType: 'reg_requirement', entityId: r.id, after: r });
    return r;
  });
}

const CheckInput = z.object({
  evidence: z.string().trim().min(10, 'Опишите, по какому официальному тексту сверено (публикация, номер, дата).').max(1000),
  nextCheckAt: z.iso.date(),
  ownerUserId: z.uuid().optional(),
});

/** Проверка специалистом: сверено с официальным текстом. */
export async function markChecked(userId: string, orgId: string, versionId: string, input: unknown) {
  const d = parse(CheckInput, input);
  return inOrg(userId, orgId, 'reg.verify', async (tx) => {
    const v = await editableVersion(tx, orgId, versionId);
    if (!['draft', 'needs_review'].includes(v.workflow_status)) throw Errors.conflict('Редакция уже проверена.');
    if (d.nextCheckAt <= new Date().toISOString().slice(0, 10)) throw Errors.validation('Дата следующей проверки — в будущем.');
    if (d.ownerUserId && !(await tx.query(`select 1 from memberships where organization_id = $1 and user_id = $2 and status = 'active'`, [orgId, d.ownerUserId])).rowCount)
      throw Errors.validation('Владелец актуализации — сотрудник этой организации.');
    const after = (await tx.query(`update reg_source_versions set workflow_status = 'checked', check_evidence = $2, last_checked_at = now(), checked_by = $3, next_check_at = $4,
      owner_user_id = coalesce($5, owner_user_id, $3) where id = $1 returning *`, [versionId, d.evidence, userId, d.nextCheckAt, d.ownerUserId || null])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'reg.version_check', entityType: 'reg_version', entityId: versionId, before: { workflow_status: v.workflow_status }, after: { workflow_status: 'checked', evidence: d.evidence } });
    return after;
  });
}

function clauseKey(r: { clause: string }) { return r.clause.replace(/\s+/g, ' ').trim().toLowerCase(); }

/**
 * Утверждение для применения (AT-08): только проверенная редакция с датой начала действия, хотя бы одним
 * требованием с областью применения, владельцем и датой следующей проверки. При замене прежней
 * утверждённой редакции — сравнение пунктов и задачи пересмотра связанных правил контроля (AT-09).
 */
export async function approveVersion(userId: string, orgId: string, versionId: string) {
  return inOrg(userId, orgId, 'reg.approve', async (tx) => {
    const v = (await tx.query(`select * from reg_source_versions where id = $1 and organization_id = $2 for update`, [versionId, orgId])).rows[0];
    if (!v) throw Errors.notFound('Редакция не найдена.');
    const problems: string[] = [];
    if (v.workflow_status !== 'checked') problems.push('редакция не проверена специалистом');
    if (!v.effective_from) problems.push('не указана дата начала действия');
    if (!v.next_check_at) problems.push('не указана дата следующей проверки');
    if (!v.owner_user_id) problems.push('не назначен владелец актуализации');
    const reqs = (await tx.query(`select * from reg_requirements where version_id = $1`, [versionId])).rows;
    if (!reqs.length) problems.push('не внесено ни одного требования (пункта) с областью применения');
    if (problems.length) throw Errors.validation(`Утвердить нельзя: ${problems.join('; ')}.`, problems);

    await tx.query(`update reg_source_versions set workflow_status = 'approved', approved_by = $2, approved_at = now() where id = $1`, [versionId, userId]);
    let review = null;
    if (v.supersedes_version_id) {
      const old = (await tx.query(`select * from reg_requirements where version_id = $1`, [v.supersedes_version_id])).rows;
      const oldBy = new Map(old.map((r) => [clauseKey(r), r]));
      const newBy = new Map(reqs.map((r) => [clauseKey(r), r]));
      const added = reqs.filter((r) => !oldBy.has(clauseKey(r))).map((r) => ({ clause: r.clause, text: r.text }));
      const removed = old.filter((r) => !newBy.has(clauseKey(r))).map((r) => ({ clause: r.clause, text: r.text, id: r.id }));
      const changed = reqs.filter((r) => { const o = oldBy.get(clauseKey(r)); return o && (o.text !== r.text || o.scope !== r.scope); })
        .map((r) => ({ clause: r.clause, before: oldBy.get(clauseKey(r))!.text, after: r.text }));
      // Неизменённые пункты: правила контроля переходят на новую редакцию автоматически.
      for (const r of reqs) {
        const o = oldBy.get(clauseKey(r));
        if (o && o.text === r.text && o.scope === r.scope) await tx.query(`update control_rules set requirement_id = $2 where requirement_id = $1`, [o.id, r.id]);
      }
      // Изменённые и удалённые: задача пересмотра каждого связанного правила.
      const affectedOld = [...removed.map((x) => x.id), ...changed.map((c) => oldBy.get(clauseKey(c))!.id)];
      const rules = affectedOld.length ? (await tx.query(`select c.id, c.control_object_id, o.name as object, o.site_id, r.clause from control_rules c join control_objects o on o.id = c.control_object_id
        join reg_requirements r on r.id = c.requirement_id where c.requirement_id = any($1::uuid[]) and c.status <> 'retired'`, [affectedOld])).rows : [];
      const src = (await tx.query(`select code from reg_sources where id = $1`, [v.source_id])).rows[0];
      for (const rule of rules) {
        await openTask(tx, { orgId, siteId: rule.site_id, kind: 'reg_review', title: `Пересмотреть правило контроля: ${rule.object}`,
          details: `${src.code}: в новой редакции «${v.edition}» изменён или исключён ${rule.clause}. Проверьте пределы и процедуру.`,
          entityType: 'control_object', entityId: rule.control_object_id, assigneeRole: 'haccp_lead', dueAt: v.effective_from ? new Date(v.effective_from) : null, createdBy: userId });
      }
      review = (await tx.query(`insert into reg_reviews (organization_id, old_version_id, new_version_id, diff, affected_rules, created_by) values ($1, $2, $3, $4, $5, $6) returning *`,
        [orgId, v.supersedes_version_id, versionId, JSON.stringify({ added, removed: removed.map(({ id: _id, ...x }) => x), changed }), rules.length, userId])).rows[0];
    }
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'reg.version_approve', entityType: 'reg_version', entityId: versionId,
      before: { workflow_status: v.workflow_status }, after: { workflow_status: 'approved', review: review?.id || null } });
    const after = (await versionsWithState(tx, 'v.id = $1', [versionId]))[0];
    return { version: after, review };
  });
}

export async function setVersionSuspended(userId: string, orgId: string, versionId: string, input: unknown) {
  const d = parse(z.object({ suspended: z.boolean(), reason: z.string().trim().min(5, 'Укажите основание.').max(500) }), input);
  return inOrg(userId, orgId, 'reg.approve', async (tx) => {
    const v = (await tx.query(`select * from reg_source_versions where id = $1 and organization_id = $2 for update`, [versionId, orgId])).rows[0];
    if (!v) throw Errors.notFound('Редакция не найдена.');
    if (d.suspended && v.workflow_status !== 'approved') throw Errors.conflict('Приостановить можно утверждённую редакцию.');
    if (!d.suspended && v.workflow_status !== 'suspended') throw Errors.conflict('Редакция не приостановлена.');
    await tx.query(`update reg_source_versions set workflow_status = $2 where id = $1`, [versionId, d.suspended ? 'suspended' : 'approved']);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: d.suspended ? 'reg.version_suspend' : 'reg.version_resume', entityType: 'reg_version', entityId: versionId, reason: d.reason });
    return { ok: true };
  });
}

// ───────── Применимость и профиль ─────────

export interface Proposal { proposed: boolean | null; reason: string }

/** Предложение применимости по профилю. Пустой список в требовании — «для всех»; пустой профиль — решить нельзя. */
export function proposeApplicability(r: { object_types: string[]; processes: string[] }, profile: { object_types: string[]; processes: string[] } | null): Proposal {
  if (!profile || (!profile.object_types.length && !profile.processes.length)) return { proposed: null, reason: 'Профиль предприятия не заполнен' };
  const typeOk = !r.object_types.length || r.object_types.some((t) => profile.object_types.includes(t));
  const procOk = !r.processes.length || r.processes.some((p) => profile.processes.includes(p));
  if (typeOk && procOk) {
    const why = [r.object_types.length ? `тип: ${r.object_types.filter((t) => profile.object_types.includes(t)).map((t) => OBJECT_TYPES[t]).join(', ')}` : 'для всех типов',
      r.processes.length ? `процессы: ${r.processes.filter((p) => profile.processes.includes(p)).map((p) => PROCESSES[p]).join(', ')}` : 'для всех процессов'].join('; ');
    return { proposed: true, reason: `Совпадает с профилем (${why})` };
  }
  return { proposed: false, reason: !typeOk ? 'Тип объекта не совпадает с профилем' : 'Процессы не совпадают с профилем' };
}

const DecideInput = z.object({ applicable: z.boolean(), rationale: z.string().trim().min(5, 'Обоснуйте решение.').max(1000) });

export async function decideApplicability(userId: string, orgId: string, requirementId: string, input: unknown) {
  const d = parse(DecideInput, input);
  return inOrg(userId, orgId, 'reg.verify', async (tx) => {
    const r = (await tx.query(`select r.id from reg_requirements r where r.id = $1 and r.organization_id = $2`, [requirementId, orgId])).rows[0];
    if (!r) throw Errors.notFound('Требование не найдено.');
    const before = (await tx.query(`select applicable, rationale from reg_applicability where requirement_id = $1`, [requirementId])).rows[0] || null;
    const a = (await tx.query(`insert into reg_applicability (organization_id, requirement_id, applicable, rationale, decided_by) values ($1, $2, $3, $4, $5)
      on conflict (requirement_id) do update set applicable = excluded.applicable, rationale = excluded.rationale, decided_by = excluded.decided_by, decided_at = now() returning *`,
      [orgId, requirementId, d.applicable, d.rationale, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'reg.applicability', entityType: 'reg_requirement', entityId: requirementId, before, after: { applicable: d.applicable, rationale: d.rationale } });
    return a;
  });
}

/** Нормативный профиль: требования действующих и вступающих редакций — предложение, решение, связанные правила. */
export async function regulatoryProfile(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'reg.read', async (tx) => {
    const profile = (await tx.query(`select * from org_regulatory_profiles where organization_id = $1`, [orgId])).rows[0] || null;
    const versions = (await versionsWithState(tx, `v.organization_id = $1 and v.workflow_status = 'approved'`, [orgId])).filter((v) => v.state === 'in_force' || v.state === 'upcoming');
    const reqs = versions.length ? (await tx.query(`select r.*, a.applicable, a.rationale, (select count(*) from control_rules c where c.requirement_id = r.id and c.status = 'approved')::int as rules
      from reg_requirements r left join reg_applicability a on a.requirement_id = r.id where r.version_id = any($1::uuid[]) order by r.clause`, [versions.map((v) => v.id)])).rows : [];
    const items = reqs.map((r) => {
      const v = versions.find((x) => x.id === r.version_id)!;
      return { ...r, source_code: v.code, edition: v.edition, state: v.state, state_label: v.state_label, proposal: proposeApplicability(r, profile),
        gap: r.applicable === true && r.rules === 0 };
    });
    return {
      profile, items,
      counts: { total: items.length, applicable: items.filter((i) => i.applicable === true).length, not_applicable: items.filter((i) => i.applicable === false).length,
        undecided: items.filter((i) => i.applicable === null || i.applicable === undefined).length, without_control: items.filter((i) => i.gap).length },
    };
  });
}

/** Требования, на которые можно сослаться в правиле контроля: применимые, в действующей или вступающей редакции. */
export async function linkableRequirements(userId: string, orgId: string) {
  const p = await regulatoryProfile(userId, orgId);
  return p.items.filter((i) => i.applicable === true).map((i) => ({ id: i.id, label: `${i.source_code}, ${i.clause} (ред. ${i.edition})`, scope: i.scope, state_label: i.state_label }));
}

export async function requirementRef(tx: Tx, orgId: string, requirementId: string): Promise<string> {
  const r = (await tx.query(`select r.clause, r.version_id, v.edition, v.workflow_status, v.effective_from, v.effective_to, s.code, a.applicable,
      (select min(n.effective_from) from reg_source_versions n where n.supersedes_version_id = v.id and n.workflow_status = 'approved') as replaced_from
    from reg_requirements r join reg_source_versions v on v.id = r.version_id join reg_sources s on s.id = v.source_id
    left join reg_applicability a on a.requirement_id = r.id where r.id = $1 and r.organization_id = $2`, [requirementId, orgId])).rows[0];
  if (!r) throw Errors.notFound('Требование не найдено.');
  const st = versionState(r);
  if (st !== 'in_force' && st !== 'upcoming') throw Errors.validation(`Требование из редакции в статусе «${STATE_LABEL[st]}» — сослаться можно только на действующую или вступающую в силу утверждённую редакцию.`);
  if (r.applicable !== true) throw Errors.validation('Применимость требования к предприятию не подтверждена специалистом.');
  return `${r.code}, ${r.clause} (ред. ${r.edition})`;
}
