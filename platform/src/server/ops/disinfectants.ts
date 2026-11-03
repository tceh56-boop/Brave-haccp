import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText } from './common';

/**
 * Режимы применения дезинфицирующих и моющих средств (ТЗ 3.0 §16.1) и их импорт из таблицы (§25.2).
 *  - Режим — объект обработки, концентрация, экспозиция, способ, расход, срок годности раствора — как в инструкции средства.
 *    Числа (концентрация в %, экспозиция в минутах) разбираются из текста только когда записаны однозначно;
 *    иначе остаётся текст источника, а замер концентрации по такому режиму невозможен.
 *  - Импорт: разбор → предпросмотр с предупреждениями и дублями → подтверждение человеком → протокол (import_jobs).
 *    Всё импортированное — черновик. Утверждает ответственный, когда к средству приложена инструкция производителя.
 */

export const AGENT_KIND: Record<string, string> = { disinfectant: 'дезинфицирующее', detergent: 'моющее', antiseptic: 'кожный антисептик', combined: 'моюще-дезинфицирующее' };

/** CSV по RFC 4180: кавычки, запятая или точка с запятой, BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const first = src.split(/\r?\n/, 1)[0] || '';
  const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && src[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean));
}

const num = (s: string) => Number(s.replace(',', '.'));
const N = String.raw`(\d+(?:[.,]\d+)?)`;

/** «0,5%» → 0,5…0,5; «15-20%» → 15…20; «0,1% (1 г/л)» → 0,1. «Готовый раствор», «неразведённый» — null. */
export function parsePercent(text: string): { min: number; max: number } | null {
  const m = text.match(new RegExp(`^\\s*${N}\\s*(?:[-–—]\\s*${N}\\s*)?%`));
  if (!m) return null;
  const a = num(m[1]), b = m[2] ? num(m[2]) : a;
  return a <= b && b <= 100 ? { min: a, max: b } : null;
}

/** «30 мин» → 30; «30-120 мин» → 30…120; «30 сек – 3 мин» → 0,5…3; «1 ч» → 60. «Не требуется», «по необходимости» — null. */
export function parseExposure(text: string): { min: number; max: number } | null {
  const U = String.raw`(сек|с|мин|ч|час[аов]*)\.?`;
  const m = text.toLowerCase().match(new RegExp(`^\\s*${N}\\s*(?:${U})?\\s*(?:[-–—]\\s*${N}\\s*${U})?\\s*$`));
  if (!m) return null;
  const unit1 = m[2] || m[4]; if (!unit1) return null;
  const k = (u: string) => (u.startsWith('с') ? 1 / 60 : u.startsWith('ч') ? 60 : 1);
  const a = num(m[1]) * k(unit1), b = m[3] ? num(m[3]) * k(m[4]) : a;
  return a <= b ? { min: Math.round(a * 1000) / 1000, max: Math.round(b * 1000) / 1000 } : null;
}

const HEAD: [key: string, re: RegExp, required: boolean][] = [
  ['name', /средств/i, true], ['object', /объект/i, true], ['concentration', /концентрац/i, true], ['exposure', /экспозиц/i, true],
  ['method', /способ/i, true], ['consumption', /расход/i, false], ['shelf', /срок/i, false],
];
const EMPTY = /^[—–\-]?$/;

interface Row { line: number; name: string; object: string; concentration: string; exposure: string; method: string; consumption: string | null; shelf: string | null;
  pct: { min: number; max: number } | null; exp: { min: number; max: number } | null; rinse: boolean | null; warnings: string[]; duplicate: boolean; agent_exists: boolean }

const ImportInput = z.object({
  csv: z.string().min(10, 'Файл пустой.').max(2_000_000, 'Файл больше 2 МБ.'), filename: optText(200),
  basis: z.string().trim().min(5, 'Укажите источник режимов: инструкция производителя (номер, дата) или документ, из которого взята таблица.').max(500),
  confirm: z.boolean().default(false),
});

async function analyse(tx: Tx, orgId: string, csv: string) {
  const rows = parseCsv(csv);
  if (rows.length < 2) throw Errors.validation('В файле нет строк с режимами.');
  const head = rows[0];
  const col: Record<string, number> = {};
  for (const [key, re, req] of HEAD) {
    const i = head.findIndex((h) => re.test(h));
    if (i < 0 && req) throw Errors.validation(`Не найден столбец «${key === 'name' ? 'Средство' : key === 'object' ? 'Объект обработки' : key === 'concentration' ? 'Концентрация' : key === 'exposure' ? 'Время экспозиции' : 'Способ обработки'}». Первая строка файла — заголовки.`);
    if (i >= 0) col[key] = i;
  }
  const agents = (await tx.query(`select id, name from disinfectants where organization_id = $1 and status <> 'archived'`, [orgId])).rows;
  const byName = new Map(agents.map((a) => [a.name.toLowerCase().replace(/ё/g, 'е'), a.id as string]));
  const existing = new Set((await tx.query(`select x.name, r.object from disinfectant_regimes r join disinfectants x on x.id = r.disinfectant_id where r.organization_id = $1 and r.status <> 'archived'`, [orgId])).rows
    .map((r) => `${r.name.toLowerCase().replace(/ё/g, 'е')}|${r.object.toLowerCase()}`));
  const out: Row[] = []; const errors: string[] = []; const seen = new Set<string>();
  let current = '';
  rows.slice(1).forEach((r, i) => {
    const line = i + 2, get = (k: string) => (col[k] === undefined ? '' : r[col[k]] || '');
    if (get('name')) current = get('name');
    if (!current) { errors.push(`Строка ${line}: не указано средство.`); return; }
    const object = get('object'), concentration = get('concentration'), exposure = get('exposure'), method = get('method');
    if (!object || !concentration || !exposure || !method) { errors.push(`Строка ${line} («${current}»): не заполнены объект, концентрация, экспозиция или способ.`); return; }
    const pct = parsePercent(concentration), exp = parseExposure(exposure);
    const consumption = EMPTY.test(get('consumption')) ? null : get('consumption'), shelf = EMPTY.test(get('shelf')) ? null : get('shelf');
    const warnings: string[] = [];
    if (!pct) warnings.push('концентрация не в процентах — замер концентрации по этому режиму невозможен');
    else if (pct.min !== pct.max) warnings.push(`в источнике диапазон ${concentration} — уточните по инструкции, какая концентрация для какого случая`);
    if (!exp) warnings.push(`экспозиция «${exposure}» не задана временем`);
    if (!shelf || /уточн/i.test(shelf)) warnings.push('срок годности раствора не указан — уточните по инструкции или упаковке');
    const key = `${current.toLowerCase().replace(/ё/g, 'е')}|${object.toLowerCase()}`;
    const duplicate = existing.has(key) || seen.has(key); seen.add(key);
    out.push({ line, name: current, object, concentration, exposure, method, consumption, shelf, pct, exp,
      rinse: /смыв|промыв|ополаскив/i.test(method) ? true : null, warnings, duplicate, agent_exists: byName.has(current.toLowerCase().replace(/ё/g, 'е')) });
  });
  return { rows: out, errors, byName };
}

/** Предпросмотр (confirm: false) или импорт (confirm: true). Ошибки строк блокируют импорт целиком. */
export async function importRegimes(userId: string, orgId: string, input: unknown) {
  const d = parse(ImportInput, input);
  return inOrg(userId, orgId, 'sanitation.manage', async (tx) => {
    const a = await analyse(tx, orgId, d.csv);
    const agents = [...new Set(a.rows.map((r) => r.name))].map((name) => ({ name, exists: a.rows.find((r) => r.name === name)!.agent_exists,
      regimes: a.rows.filter((r) => r.name === name && !r.duplicate).length }));
    const summary = { rows: a.rows.length, new_regimes: a.rows.filter((r) => !r.duplicate).length, duplicates: a.rows.filter((r) => r.duplicate).length,
      with_warnings: a.rows.filter((r) => r.warnings.length).length, new_agents: agents.filter((x) => !x.exists).map((x) => x.name), errors: a.errors };
    if (!d.confirm) return { preview: true, summary, agents, rows: a.rows };
    if (a.errors.length) throw Errors.validation(`Импорт невозможен: ${a.errors.join(' ')}`);
    if (!summary.new_regimes) throw Errors.conflict('Все режимы из файла уже есть в справочнике — нечего импортировать.');
    const sha = createHash('sha256').update(d.csv).digest('hex');
    const job = (await tx.query(`insert into import_jobs (organization_id, kind, filename, file_sha256, rows_total, result, created_by) values ($1, 'disinfectant_regimes', $2, $3, $4, $5, $6) returning id, created_at`,
      [orgId, d.filename, sha, a.rows.length, JSON.stringify({ ...summary, basis: d.basis }), userId])).rows[0];
    const ids = new Map(a.byName);
    for (const r of a.rows.filter((x) => !x.duplicate)) {
      const k = r.name.toLowerCase().replace(/ё/g, 'е');
      if (!ids.has(k)) {
        const ag = (await tx.query(`insert into disinfectants (organization_id, name, purpose, basis, created_by) values ($1, $2, $3, $4, $5) returning id`,
          [orgId, r.name, a.rows.filter((x) => x.name === r.name).map((x) => x.object).join('; ').slice(0, 500), d.basis.slice(0, 300), userId])).rows[0];
        ids.set(k, ag.id);
        await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'disinfectant.create', entityType: 'disinfectant', entityId: ag.id, after: { name: r.name, import_job: job.id } });
      }
      await tx.query(`insert into disinfectant_regimes (organization_id, disinfectant_id, object, concentration_text, concentration_min, concentration_max, exposure_text, exposure_min, exposure_max,
          method, consumption, solution_shelf, rinse_required, basis, import_job_id, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [orgId, ids.get(k), r.object, r.concentration, r.pct?.min ?? null, r.pct?.max ?? null, r.exposure, r.exp?.min ?? null, r.exp?.max ?? null, r.method, r.consumption, r.shelf, r.rinse,
        `${d.basis} (импорт ${d.filename || 'файла'}, строка ${r.line})`, job.id, userId]);
    }
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'disinfectant.import', entityType: 'import_job', entityId: job.id, after: { ...summary, sha256: sha, basis: d.basis } });
    return { preview: false, import_job_id: job.id as string, summary };
  });
}

export async function listRegimes(tx: Tx, orgId: string) {
  return (await tx.query(`select r.id, r.disinfectant_id, r.object, r.concentration_text, r.concentration_min, r.concentration_max, r.exposure_text, r.exposure_min, r.exposure_max,
      r.method, r.consumption, r.solution_shelf, r.rinse_required, r.basis, r.status, r.approved_at, u.full_name as approved_by
    from disinfectant_regimes r left join users u on u.id = r.approved_by where r.organization_id = $1 and r.status <> 'archived' order by r.created_at, r.object`, [orgId])).rows
    .map((r) => ({ ...r, concentration_min: r.concentration_min === null ? null : Number(r.concentration_min), concentration_max: r.concentration_max === null ? null : Number(r.concentration_max),
      exposure_min: r.exposure_min === null ? null : Number(r.exposure_min), exposure_max: r.exposure_max === null ? null : Number(r.exposure_max) }));
}

/** Утверждение режима — только при приложенной к средству инструкции (файл) и указанном виде средства. */
export async function approveRegime(userId: string, orgId: string, id: string) {
  return inOrg(userId, orgId, 'sanitation.manage', async (tx) => {
    const r = (await tx.query(`select r.*, x.name, x.agent_kind from disinfectant_regimes r join disinfectants x on x.id = r.disinfectant_id
      where r.id = $1 and r.organization_id = $2 for update of r`, [parse(z.uuid(), id), orgId])).rows[0];
    if (!r) throw Errors.notFound('Режим не найден.');
    if (r.status !== 'draft') throw Errors.conflict('Утвердить можно только черновик.');
    const file = (await tx.query(`select 1 from evidence_files where organization_id = $1 and entity_type = 'disinfectant' and entity_id = $2 limit 1`, [orgId, r.disinfectant_id])).rowCount;
    if (!file) throw Errors.conflict(`Приложите к средству «${r.name}» инструкцию производителя (файл) — режим сверяется с ней.`);
    if (!r.agent_kind) throw Errors.conflict(`Укажите вид средства «${r.name}»: дезинфицирующее, моющее, антисептик или моюще-дезинфицирующее.`);
    await tx.query(`update disinfectant_regimes set status = 'approved', approved_by = $2, approved_at = now() where id = $1`, [r.id, userId]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'disinfectant.regime_approve', entityType: 'disinfectant', entityId: r.disinfectant_id,
      after: { regime: r.id, object: r.object, concentration: r.concentration_text, exposure: r.exposure_text, basis: r.basis } });
    return { ok: true };
  });
}

export async function archiveRegime(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(z.object({ reason: z.string().trim().min(5, 'Укажите причину.').max(300) }), input);
  return inOrg(userId, orgId, 'sanitation.manage', async (tx) => {
    const r = (await tx.query(`select * from disinfectant_regimes where id = $1 and organization_id = $2 for update`, [parse(z.uuid(), id), orgId])).rows[0];
    if (!r) throw Errors.notFound('Режим не найден.');
    if ((await tx.query(`select 1 from sanitation_plans where regime_id = $1 and status = 'active'`, [r.id])).rowCount) throw Errors.conflict('Режим указан в действующем плане санобработки — сначала выведите пункт плана.');
    await tx.query(`update disinfectant_regimes set status = 'archived' where id = $1`, [r.id]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'disinfectant.regime_archive', entityType: 'disinfectant', entityId: r.disinfectant_id, reason: d.reason, after: { regime: r.id } });
    return { ok: true };
  });
}

const AgentPatch = z.object({
  agentKind: z.enum(['disinfectant', 'detergent', 'antiseptic', 'combined']).optional(), manufacturer: optText(200), activeSubstance: optText(300),
  concentrateShelf: optText(200), safety: optText(2000), storage: optText(500),
});

/** Сведения о средстве по ТЗ 3.0 §16.1 (вид, изготовитель, действующее вещество, сроки, безопасность, хранение). Режимы — отдельно. */
export async function updateAgent(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(AgentPatch, input);
  return inOrg(userId, orgId, 'sanitation.manage', async (tx) => {
    const before = (await tx.query(`select * from disinfectants where id = $1 and organization_id = $2 for update`, [parse(z.uuid(), id), orgId])).rows[0];
    if (!before) throw Errors.notFound('Средство не найдено.');
    if (before.status === 'archived') throw Errors.conflict('Средство в архиве.');
    const after = (await tx.query(`update disinfectants set agent_kind = coalesce($2, agent_kind), manufacturer = coalesce($3, manufacturer), active_substance = coalesce($4, active_substance),
        concentrate_shelf = coalesce($5, concentrate_shelf), safety = coalesce($6, safety), storage = coalesce($7, storage) where id = $1 returning *`,
    [before.id, d.agentKind ?? null, d.manufacturer, d.activeSubstance, d.concentrateShelf, d.safety, d.storage])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'disinfectant.update', entityType: 'disinfectant', entityId: before.id, before, after });
    return after;
  });
}
