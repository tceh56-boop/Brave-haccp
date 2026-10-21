import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import * as z4 from 'zod/v4';
import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { isRole, roleHas, ROLES } from '../access/roles';
import { inOrg, parse, optText, openTask, fmtNum } from './common';
import { versionState, STATE_LABEL } from './regulatory';
import { SEVERITY_LABEL, STATUS_LABEL as INC_STATUS } from './incidents';
import { CAPA_STATUS } from './capa';

/**
 * AI-помощник (этап 7 ТЗ v2, §11). Порядок ответственности:
 *  1. Требования ищет система — только в утверждённых редакциях реестра (действующих или вступающих в силу).
 *  2. Модель получает снимок данных и пронумерованные источники и отвечает строго в формате ТЗ:
 *     что обнаружено → почему важно → что сделать сейчас → что нельзя до решения → кто подтверждает →
 *     что закроет проблему → источник → ограничения и уверенность.
 *  3. Сервер проверяет ответ: цитата должна дословно совпадать с текстом источника; любое число с единицей
 *     (°C, часы, сутки, %, граммы) должно встречаться во входных данных или источниках — иначе ответ отклоняется.
 *  4. AI ничего не делает сам: предложенное действие становится задачей только по решению человека.
 * Нет источников — модель не вызывается (нечего цитировать). Нет ключа API — показываются найденные требования.
 */

export const PROMPT_VERSION = 'ceh-ai-2026-10-21.1';
export const AI_MODEL = process.env.AI_MODEL || 'claude-opus-5-5';
const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT || 300);

const AnswerSchema = z4.object({
  found: z4.string().describe('Что обнаружено — простыми словами, по входным данным'),
  why: z4.string().describe('Почему это важно для безопасности продукции или гостей'),
  do_now: z4.array(z4.string()).describe('Что сделать сейчас — конкретные шаги; каждый шаг — отдельная строка'),
  dont: z4.array(z4.string()).describe('Что нельзя делать до решения ответственного'),
  who_confirms: z4.string().describe('Кто подтверждает решение (роль)'),
  closes_when: z4.string().describe('Какой результат закроет проблему'),
  citations: z4.array(z4.object({ source: z4.string().describe('Номер источника, например S1'), quote: z4.string().describe('Дословная цитата из текста источника') })),
  limitations: z4.string().describe('Ограничения: чего нет в данных и источниках, что требует проверки специалистом'),
  confidence: z4.enum(['low', 'medium', 'high']),
});
export type AiAnswer = z4.infer<typeof AnswerSchema>;

const SYSTEM = `Ты — помощник по пищевой безопасности в системе «ЦЕХ» для предприятий общепита России. Пользователи — повара, технологи, ответственные за ХАССП, руководители. Отвечай по-русски, коротко и простыми словами.

Правила, которые нельзя нарушать:
1. Опирайся только на переданные «Данные» и «Источники». Своих знаний о нормах не добавляй.
2. Нормы, сроки годности, температуры, время, проценты, массы и результаты измерений бери только из данных или источников. Если числа там нет — не называй его, а напиши в limitations, что значение должен определить специалист по утверждённой процедуре.
3. Каждое утверждение о требовании подкрепляй ссылкой в citations: номер источника (S1, S2 …) и дословная цитата из его текста. Не цитируй то, чего нет в тексте источника.
4. Если источники не покрывают вопрос — оставь citations пустым и прямо скажи об этом в limitations.
5. Ты ничего не утверждаешь, не закрываешь, не списываешь и не меняешь. do_now — это предложения для человека; решение принимает ответственный (who_confirms).
6. Не объявляй продукцию безопасной и не разрешай её использовать — это решает ответственный после проверки.
7. confidence: high — данные полные и источник прямо отвечает; medium — частично; low — данных или источников мало.`;

/* ───────────── Провайдер ───────────── */

export interface AiRequest { system: string; user: string }
export interface AiResult { output: AiAnswer | null; model: string; refused?: boolean; usage?: unknown }
export interface AiProvider { name: string; model: string; generate(req: AiRequest): Promise<AiResult> }

class AnthropicProvider implements AiProvider {
  name = 'anthropic';
  model = AI_MODEL;
  private client = new Anthropic({ maxRetries: 2, timeout: 120_000 });
  async generate(req: AiRequest): Promise<AiResult> {
    const res = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high', format: betaZodOutputFormat(AnswerSchema) },
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: req.user }],
    });
    if (res.stop_reason === 'refusal') return { output: null, model: res.model, refused: true, usage: res.usage };
    return { output: res.parsed_output ?? null, model: res.model, usage: res.usage };
  }
}

let override: AiProvider | null | undefined;
/** Для тестов и офлайн-режима: подменить провайдера (null — AI отключён). */
export function setAiProvider(p: AiProvider | null | undefined) { override = p; }
function provider(): AiProvider | null {
  if (override !== undefined) return override;
  if (process.env.AI_PROVIDER === 'off') return null;
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  return new AnthropicProvider();
}
export const aiAvailable = () => provider() !== null;

/* ───────────── Поиск требований ───────────── */

export interface Source { id: string; requirement_id: string; code: string; title: string; clause: string; text: string; scope: string; edition: string;
  state: string; state_label: string; last_checked_at: string | null; next_check_at: string | null; applicable: boolean | null }

const words = (s: string) => [...new Set(s.toLowerCase().replace(/ё/g, 'е').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !/^\d+$/.test(w)))].slice(0, 30);

/** Требования утверждённых редакций (действующих или вступающих в силу), ранжированные по совпадению с текстом. */
async function findSources(tx: Tx, orgId: string, text: string, pinned: string[] = [], limit = 6): Promise<Source[]> {
  const w = words(text);
  const q = w.join(' | ');
  const rows = (await tx.query(`select r.id as requirement_id, r.clause, r.text, r.scope, v.edition, v.workflow_status, v.effective_from, v.effective_to, v.last_checked_at, v.next_check_at,
      s.code, s.title, a.applicable,
      (select min(n.effective_from) from reg_source_versions n where n.supersedes_version_id = v.id and n.workflow_status = 'approved') as replaced_from,
      (r.id = any($3::uuid[])) as pinned,
      case when $2 = '' then 0 else ts_rank(to_tsvector('russian', r.text || ' ' || r.clause || ' ' || r.scope || ' ' || s.title), to_tsquery('russian', $2)) end as rank
    from reg_requirements r join reg_source_versions v on v.id = r.version_id join reg_sources s on s.id = v.source_id
    left join reg_applicability a on a.requirement_id = r.id
    where r.organization_id = $1 and v.workflow_status = 'approved' and coalesce(a.applicable, true)
      and (r.id = any($3::uuid[]) or ($2 <> '' and to_tsvector('russian', r.text || ' ' || r.clause || ' ' || r.scope || ' ' || s.title) @@ to_tsquery('russian', $2)))
    order by pinned desc, (a.applicable is true) desc, rank desc limit 30`, [orgId, q, pinned])).rows;
  return rows.filter((r) => ['in_force', 'upcoming'].includes(versionState(r))).slice(0, limit).map((r, i) => {
    const st = versionState(r);
    return { id: `S${i + 1}`, requirement_id: r.requirement_id, code: r.code, title: r.title, clause: r.clause, text: r.text, scope: r.scope, edition: r.edition,
      state: st, state_label: STATE_LABEL[st], last_checked_at: r.last_checked_at, next_check_at: r.next_check_at, applicable: r.applicable };
  });
}

/* ───────────── Проверка ответа ───────────── */

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[«»"“”]/g, '').replace(/\s+/g, ' ').trim();
// \w и \b в JavaScript не знают кириллицы — границы слов через \p{L}.
const UNIT = /(-?\d+(?:[.,]\d+)?)\s*(?:°\s*[cс](?!\p{L})|°|градус\p{L}*|%|процент\p{L}*|мин(?:ут\p{L}*)?(?!\p{L})|час\p{L}*|ч(?!\p{L})|сут\p{L}*|дн(?:я|ей)?(?!\p{L})|день|недел\p{L}*|мес\p{L}*|кг(?!\p{L})|г(?!\p{L})|грамм\p{L}*|мл(?!\p{L})|л(?!\p{L})|литр\p{L}*)/giu;
const numKey = (s: string) => String(Number(s.replace(',', '.')));

export function checkAnswer(a: AiAnswer, sources: Source[], context: unknown) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const citations: { source: string; quote: string }[] = [];
  const badCitations: { source: string; quote: string; reason: string }[] = [];
  for (const c of a.citations) {
    const s = byId.get(c.source.trim().toUpperCase());
    if (!s) badCitations.push({ ...c, reason: 'нет такого источника' });
    else if (!c.quote.trim() || !norm(s.text).includes(norm(c.quote))) badCitations.push({ ...c, reason: 'цитаты нет в тексте источника' });
    else citations.push({ source: s.id, quote: c.quote.trim() });
  }
  const allowed = new Set<string>();
  // Даты, время и идентификаторы не «разрешают» чисел в ответе.
  const corpus = (JSON.stringify(context) + ' ' + sources.map((s) => `${s.text} ${s.clause} ${s.scope}`).join(' '))
    .replace(/\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?/g, ' ').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ' ');
  for (const m of corpus.matchAll(/-?\d+(?:[.,]\d+)?/g)) allowed.add(numKey(m[0]));
  const text = [a.found, a.why, ...a.do_now, ...a.dont, a.who_confirms, a.closes_when, a.limitations].join('\n');
  const unsupported = [...text.matchAll(UNIT)].filter((m) => !allowed.has(numKey(m[1]))).map((m) => m[0].trim());
  return { citations, badCitations, unsupported: [...new Set(unsupported)], ok: unsupported.length === 0 };
}

/* ───────────── Контекст по задачам ───────────── */

const roleLabel = (r: string | null) => (r && isRole(r) ? ROLES[r].label : r);

async function incidentContext(tx: Tx, orgId: string, incidentId: string) {
  const i = (await tx.query(`select * from incidents where id = $1 and organization_id = $2`, [incidentId, orgId])).rows[0];
  if (!i) throw Errors.notFound('Отклонение не найдено.');
  const ctx: Record<string, unknown> = {
    отклонение: { название: i.title, что: i.what, вид: i.kind, риск: SEVERITY_LABEL[i.severity], статус: INC_STATUS[i.status], создано: i.created_at,
      основание_правила: i.rule_source, действие_по_процедуре: i.recommended_action, записанное_действие: i.action_note, ответственная_роль: roleLabel(i.responsible_role) },
  };
  let pinned: string[] = [];
  if (i.entity_type === 'control_object') {
    const o = (await tx.query(`select o.name, o.kind, r.min_value, r.max_value, r.unit, r.frequency_hours, r.reaction, r.source_ref, r.requirement_id, r.allow_isolation
      from control_objects o left join control_rules r on r.control_object_id = o.id and r.status = 'approved' where o.id = $1`, [i.entity_id])).rows[0];
    if (o) {
      ctx.объект = { название: o.name, тип: o.kind, предел_по_утверждённому_правилу: o.min_value !== null || o.max_value !== null ? `от ${fmtNum(o.min_value)} до ${fmtNum(o.max_value)} ${o.unit || ''}`.trim() : 'не задан',
        частота_часов: o.frequency_hours, реакция_по_процедуре: o.reaction, изоляция_предусмотрена: o.allow_isolation, основание: o.source_ref };
      if (o.requirement_id) pinned = [o.requirement_id];
    }
    ctx.последние_замеры = (await tx.query(`select value, unit, measured_at, result from measurements where control_object_id = $1 order by measured_at desc limit 6`, [i.entity_id])).rows
      .map((m) => ({ значение: `${fmtNum(m.value)} ${m.unit}`, время: m.measured_at, результат: m.result }));
    ctx.партии_на_объекте = (await tx.query(`select p.name, l.lot_no, l.quantity, l.unit, l.status from lots l join products p on p.id = l.product_id
      where l.storage_object_id = $1 and l.quantity > 0 and l.status in ('available', 'quarantine') limit 10`, [i.entity_id])).rows
      .map((l) => ({ товар: l.name, партия: l.lot_no, количество: `${fmtNum(l.quantity)} ${l.unit}`, статус: l.status }));
  } else if (i.entity_type === 'lot') {
    const l = (await tx.query(`select p.name, l.lot_no, l.quantity, l.unit, l.status, l.expires_at, l.expiry_basis from lots l join products p on p.id = l.product_id where l.id = $1`, [i.entity_id])).rows[0];
    if (l) ctx.партия = { товар: l.name, номер: l.lot_no, количество: `${fmtNum(l.quantity)} ${l.unit}`, статус: l.status, годен_до: l.expires_at, основание_срока: l.expiry_basis };
  }
  ctx.ход_работы = (await tx.query(`select event, note, at from incident_events where incident_id = $1 order by id`, [incidentId])).rows.map((e) => ({ событие: e.event, примечание: e.note, время: e.at }));
  return { ctx, searchText: `${i.title} ${i.what} ${i.kind === 'temperature_deviation' ? 'температура хранение холодильник' : ''} ${i.kind === 'expired_lot' ? 'срок годности хранение' : ''} ${i.kind === 'receipt_problem' ? 'приемка входной контроль' : ''} ${i.kind === 'release_check' ? 'тепловая обработка температура в толще ККТ' : ''}`, pinned };
}

async function capaContext(tx: Tx, orgId: string, capaId: string) {
  const c = (await tx.query(`select c.*, i.title as incident_title, i.what as incident_what, i.kind as incident_kind, i.action_note from capas c left join incidents i on i.id = c.incident_id
    where c.id = $1 and c.organization_id = $2`, [capaId, orgId])).rows[0];
  if (!c) throw Errors.notFound('CAPA не найдено.');
  const ctx = { capa: { название: c.title, проблема: c.problem, статус: CAPA_STATUS[c.status], риск: c.risk, причина: c.root_cause, корректирующее: c.corrective_action,
    предупреждающее: c.preventive_action, критерий_эффективности: c.effectiveness_criterion },
    отклонение: c.incident_id ? { название: c.incident_title, что: c.incident_what, сделано: c.action_note } : null,
    задача_помощника: 'Предложи гипотезы корневой причины для проверки, корректирующие и предупреждающие действия и измеримый критерий эффективности. Это предложения — их проверяет и вносит ответственный.' };
  return { ctx, searchText: `${c.title} ${c.problem} ${c.incident_what || ''}`, pinned: [] as string[] };
}

/* ───────────── Запуск ───────────── */

const KIND_PERMISSION = { incident_explain: 'incident.read', capa_suggest: 'capa.read', question: 'ai.use' } as const;

async function run(userId: string, orgId: string, kind: keyof typeof KIND_PERMISSION, opts: { entityId?: string; question?: string }) {
  // 1. Данные и источники — в транзакции с правами пользователя.
  const prep = await inOrg(userId, orgId, 'ai.use', async (tx, m) => {
    if (kind !== 'question' && !roleHas(m.role, KIND_PERMISSION[kind])) throw Errors.forbidden('Нет доступа к этой записи.');
    let built: { ctx: unknown; searchText: string; pinned: string[] };
    if (kind === 'incident_explain') {
      const i = (await tx.query(`select site_id from incidents where id = $1 and organization_id = $2`, [opts.entityId, orgId])).rows[0];
      if (i?.site_id && m.site_ids.length && !m.site_ids.includes(i.site_id)) throw Errors.forbidden('Нет доступа к этой площадке.');
      built = await incidentContext(tx, orgId, opts.entityId!);
    } else if (kind === 'capa_suggest') built = await capaContext(tx, orgId, opts.entityId!);
    else built = { ctx: { вопрос: opts.question }, searchText: opts.question!, pinned: [] };
    const sources = await findSources(tx, orgId, built.searchText, built.pinned);
    const used = Number((await tx.query(`select count(*) from ai_jobs where organization_id = $1 and provider <> 'none' and created_at > now() - interval '1 day'`, [orgId])).rows[0].count);
    return { ...built, sources, used };
  });

  const p = provider();
  let status: string, answer: AiAnswer | null = null, guard: ReturnType<typeof checkAnswer> | Record<string, never> = {}, model: string | null = null, usage: unknown = null, error: string | null = null;
  const started = Date.now();
  if (!p) status = 'unavailable';
  else if (kind === 'question' && !prep.sources.length) status = 'no_sources';   // нечего цитировать — модель не вызывается
  else if (prep.used >= DAILY_LIMIT) throw Errors.conflict(`Достигнут дневной лимит запросов к AI (${DAILY_LIMIT}). Он задаётся настройкой AI_DAILY_LIMIT.`);
  else {
    const user = [
      `Задача: ${kind === 'incident_explain' ? 'объясни отклонение и что делать' : kind === 'capa_suggest' ? 'помоги с CAPA' : 'ответь на вопрос по требованиям'}.`,
      `Данные:\n${JSON.stringify(prep.ctx, null, 1)}`,
      `Источники (утверждённые редакции реестра предприятия):\n${prep.sources.length ? prep.sources.map((s) => `[${s.id}] ${s.code}, ${s.clause} (${/^ред/i.test(s.edition) ? s.edition : `ред. ${s.edition}`}; ${s.state_label}). Область: ${s.scope}.\nТекст: ${s.text}`).join('\n\n') : 'нет — в реестре не найдено утверждённых требований по теме.'}`,
    ].join('\n\n');
    try {
      const r = await p.generate({ system: SYSTEM, user });
      model = r.model; usage = r.usage ?? null;
      if (r.refused) status = 'refused';
      else if (!r.output) { status = 'error'; error = 'Ответ не соответствует формату.'; }
      else {
        guard = checkAnswer(r.output, prep.sources, prep.ctx);
        answer = { ...r.output, citations: guard.citations };
        status = guard.ok ? 'ok' : 'guard_rejected';
      }
    } catch (e) {
      status = 'error';
      error = e instanceof Anthropic.RateLimitError ? 'AI перегружен — повторите позже.' : e instanceof Anthropic.APIError ? `Ошибка AI (${e.status}).` : 'AI недоступен.';
    }
  }
  const latency = Date.now() - started;

  // 2. Журнал — неизменяемая запись.
  return inOrg(userId, orgId, 'ai.use', async (tx) => {
    const job = (await tx.query(`insert into ai_jobs (organization_id, user_id, kind, entity_type, entity_id, question, context, sources, provider, model, prompt_version, status, answer, guard, usage, latency_ms, error)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) returning id, created_at`,
      [orgId, userId, kind, kind === 'incident_explain' ? 'incident' : kind === 'capa_suggest' ? 'capa' : null, opts.entityId || null, opts.question || null,
        JSON.stringify(prep.ctx), JSON.stringify(prep.sources), p && status !== 'no_sources' ? p.name : 'none', model, PROMPT_VERSION, status,
        answer ? JSON.stringify(answer) : null, JSON.stringify(guard), usage ? JSON.stringify(usage) : null, latency, error])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'ai.job', entityType: 'ai_job', entityId: job.id, after: { kind, status, model, sources: prep.sources.length } });
    return present(job.id, status, answer, prep.sources, guard, model, error);
  });
}

function present(id: string, status: string, answer: AiAnswer | null, sources: Source[], guard: Partial<ReturnType<typeof checkAnswer>>, model: string | null, error: string | null) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const visible = status === 'ok' ? answer : null;
  return {
    job_id: id, status, model, error,
    message: { ok: null, guard_rejected: 'Ответ отклонён проверкой: AI назвал значения, которых нет в данных и утверждённых источниках. Решение — по утверждённой процедуре.',
      no_sources: 'В реестре предприятия нет утверждённого требования по этому вопросу. AI не отвечает без источника — обратитесь к специалисту или внесите требование в реестр.',
      unavailable: 'AI не подключён. Ниже — требования, которые система нашла в реестре.', refused: 'AI отказался отвечать на этот запрос.', error: error || 'Ошибка AI.' }[status] || null,
    answer: visible,
    citations: (visible?.citations || []).map((c) => ({ ...byId.get(c.source)!, quote: c.quote })),
    sources, unsupported: guard.unsupported || [], bad_citations: guard.badCitations || [],
  };
}

export async function explainIncident(userId: string, orgId: string, incidentId: string) {
  return run(userId, orgId, 'incident_explain', { entityId: parse(z.uuid(), incidentId) });
}
export async function suggestCapa(userId: string, orgId: string, capaId: string) {
  return run(userId, orgId, 'capa_suggest', { entityId: parse(z.uuid(), capaId) });
}
export async function askQuestion(userId: string, orgId: string, input: unknown) {
  const d = parse(z.object({ question: z.string().trim().min(5, 'Сформулируйте вопрос.').max(1000) }), input);
  return run(userId, orgId, 'question', { question: d.question });
}

/* ───────────── Решение человека ───────────── */

const DecideInput = z.object({
  itemIndex: z.number().int().min(0).max(20).nullable().optional(),
  decision: z.enum(['task_created', 'rejected', 'helpful', 'not_helpful']),
  assigneeRole: z.string().refine(isRole, 'Выберите роль исполнителя.').optional(),
  note: optText(500),
}).refine((d) => (d.decision === 'task_created' || d.decision === 'rejected') === (d.itemIndex !== null && d.itemIndex !== undefined), 'Укажите действие.')
  .refine((d) => d.decision !== 'rejected' || !!d.note, 'Укажите, почему действие отклонено.');

/** Предложенное действие становится задачей только по решению человека; отказ — с причиной. */
export async function decide(userId: string, orgId: string, jobId: string, input: unknown) {
  const d = parse(DecideInput, input);
  return inOrg(userId, orgId, 'ai.use', async (tx) => {
    const job = (await tx.query(`select * from ai_jobs where id = $1 and organization_id = $2`, [jobId, orgId])).rows[0];
    if (!job) throw Errors.notFound('Ответ AI не найден.');
    let taskId: string | null = null;
    const decisionId = randomUUID();
    if (d.decision === 'task_created' || d.decision === 'rejected') {
      if (job.status !== 'ok') throw Errors.conflict('По отклонённому или неполному ответу задачи не создаются.');
      const item = job.answer?.do_now?.[d.itemIndex!];
      if (!item) throw Errors.notFound('Действие не найдено.');
      if ((await tx.query(`select 1 from ai_decisions where job_id = $1 and item_index = $2`, [jobId, d.itemIndex])).rowCount) throw Errors.conflict('По этому действию решение уже принято.');
      if (d.decision === 'task_created') {
        const site = job.entity_type === 'incident' ? (await tx.query(`select site_id from incidents where id = $1`, [job.entity_id])).rows[0]?.site_id
          : job.entity_type === 'capa' ? (await tx.query(`select site_id from capas where id = $1`, [job.entity_id])).rows[0]?.site_id : null;
        // Задача привязана к своему решению: по одной записи может быть несколько принятых действий.
        const t = (await tx.query(`insert into tasks (organization_id, site_id, kind, title, details, entity_type, entity_id, assignee_role, created_by)
          values ($1, $2, 'ai_action', $3, $4, 'ai_job', $5, $6, $7) returning id`,
          [orgId, site || null, item.slice(0, 300), `Предложено AI-помощником, принято человеком${job.entity_type === 'incident' ? ' (по отклонению)' : job.entity_type === 'capa' ? ' (по CAPA)' : ''}.${d.note ? ` ${d.note}` : ''}`,
            decisionId, d.assigneeRole || 'haccp_lead', userId])).rows[0];
        taskId = t.id;
      }
    }
    await tx.query(`insert into ai_decisions (id, organization_id, job_id, item_index, decision, note, task_id, user_id) values ($8, $1, $2, $3, $4, $5, $6, $7)`,
      [orgId, jobId, d.itemIndex ?? null, d.decision, d.note, taskId, userId, decisionId]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'ai.decision', entityType: 'ai_job', entityId: jobId, after: { item: d.itemIndex, decision: d.decision, task_id: taskId }, reason: d.note || undefined });
    return { ok: true, task_id: taskId };
  });
}

/* ───────────── Журнал ───────────── */

export async function listJobs(userId: string, orgId: string, opts: { mine?: boolean } = {}) {
  return inOrg(userId, orgId, opts.mine ? 'ai.use' : 'ai.audit', async (tx) => (await tx.query(`select j.id, j.kind, j.status, j.question, j.entity_type, j.entity_id, j.model, j.prompt_version, j.latency_ms, j.created_at,
      u.full_name as user_name, jsonb_array_length(j.sources) as sources, j.answer->>'confidence' as confidence,
      (select count(*)::int from ai_decisions d where d.job_id = j.id and d.decision = 'task_created') as tasks
    from ai_jobs j join users u on u.id = j.user_id where j.organization_id = $1 and ($2::uuid is null or j.user_id = $2) order by j.created_at desc limit 200`,
    [orgId, opts.mine ? userId : null])).rows);
}

export async function getJob(userId: string, orgId: string, jobId: string) {
  return inOrg(userId, orgId, 'ai.use', async (tx, m) => {
    const j = (await tx.query(`select * from ai_jobs where id = $1 and organization_id = $2`, [parse(z.uuid(), jobId), orgId])).rows[0];
    if (!j) throw Errors.notFound('Ответ AI не найден.');
    if (j.user_id !== userId && !roleHas(m.role, 'ai.audit')) throw Errors.forbidden('Чужие запросы видит только руководитель или аудитор.');
    const decisions = (await tx.query(`select d.item_index, d.decision, d.note, d.task_id, d.created_at, u.full_name as user_name from ai_decisions d join users u on u.id = d.user_id where d.job_id = $1 order by d.created_at`, [j.id])).rows;
    return { ...present(j.id, j.status, j.answer, j.sources, j.guard, j.model, j.error), prompt_version: j.prompt_version, context: j.context, question: j.question, created_at: j.created_at, decisions };
  });
}
