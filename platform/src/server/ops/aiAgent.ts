import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { audit } from '../audit/audit';
import { Errors, AppError } from '../http/errors';
import { roleHas } from '../access/roles';
import { listSites } from '../org/organizations';
import { inOrg, parse } from './common';
import { getProblems, type ProblemCard } from './dashboard';
import { listTasks } from './tasks';
import { listIncidents } from './incidents';
import { listCapas } from './capa';
import { listLots } from './lots';
import { chat, yandexStatus, type ChatMessage, type ChatToolCall } from '../integrations/yandex';
import {
  AI_MODEL, JSON_FORMAT, YANDEX_AI_MODEL, parseJsonAnswer, AnswerSchema, DAILY_LIMIT, PROMPT_VERSION, checkAnswer, findSources, incidentContext, present, usedToday, words,
  type AgentStepView, type AiAnswer, type Source,
} from './ai';

/**
 * ЦЕХ AI — агент по данным системы. Отличие от разового ответа (ai.ts): модель сама решает, какие данные ей нужны,
 * и запрашивает их инструментами — сводка проблем, задачи, отклонения, партии, CAPA, прошлые случаи, реестр требований.
 *
 * Порядок ответственности не меняется:
 *  1. Каждый инструмент — существующая функция системы с правами пользователя: агент видит ровно то, что видит человек.
 *     Инструменты только читают; изменить что-либо AI не может.
 *  2. Требования — только из утверждённых редакций реестра (find_requirements, incident_details).
 *  3. Итоговый ответ — в формате ТЗ; сервер сверяет цитаты с текстом источников, а числа с единицами — со всем,
 *     что вернули инструменты. Не совпало — ответ отклоняется.
 *  4. Предложенное действие становится задачей только по решению человека (ai.decide).
 *  5. В журнал пишутся вопрос, все шаги (инструмент, параметры, результат), источники, модель, ответ.
 */

export const AGENT_PROMPT_VERSION = `${PROMPT_VERSION}+agent-2026-11-03.1`;
const MAX_TURNS = 8;              // обращений к модели за один запуск
const MAX_ROWS = 30;              // строк в ответе инструмента
const MAX_RESULT_CHARS = 20_000;  // размер ответа инструмента, который видит модель

const SYSTEM = `Ты — ЦЕХ AI, помощник по пищевой безопасности и работе предприятия в системе «ЦЕХ» для общепита России. Пользователи — повара, технологи, ответственные за ХАССП, руководители. Отвечай по-русски, коротко и простыми словами.

У тебя есть инструменты, которые читают данные системы с правами текущего пользователя: проблемы на сегодня, задачи, отклонения, партии, CAPA, прошлые случаи предприятия и реестр утверждённых требований. Сначала собери нужные данные инструментами, потом отвечай. Не запрашивай лишнего: обычно хватает двух–четырёх вызовов. Если инструмент вернул ошибку доступа — не обходи её, а скажи в limitations, каких данных не хватило.

Правила, которые нельзя нарушать:
1. Опирайся только на то, что вернули инструменты. Своих знаний о нормах не добавляй.
2. Нормы, сроки годности, температуры, время, проценты, массы и результаты измерений бери только из ответов инструментов. Если числа там нет — не называй его, а напиши в limitations, что значение должен определить специалист по утверждённой процедуре.
3. Каждое утверждение о требовании подкрепляй ссылкой в citations: номер источника (S1, S2 …), который вернули find_requirements или incident_details, и дословная цитата из его текста. Если вопрос о требованиях — сначала вызови find_requirements.
4. Если требований по теме в реестре нет — оставь citations пустым и прямо скажи об этом в limitations.
5. Ты ничего не утверждаешь, не закрываешь, не списываешь и не меняешь. do_now — это предложения для человека; решение принимает ответственный (who_confirms).
6. Не объявляй продукцию безопасной и не разрешай её использовать — это решает ответственный после проверки.
7. Прошлые случаи (past_cases) — это опыт предприятия, а не норма: упоминай их как «в похожем случае сделали так».
8. confidence: high — данные полные и источник прямо отвечает; medium — частично; low — данных или источников мало.
Итоговый ответ дай в заданном формате, когда данных достаточно.`;

/* ───────────── Провайдер ───────────── */

type Msg = Anthropic.Beta.Messages.BetaMessageParam;
type Tool = Anthropic.Beta.Messages.BetaTool;
type Block = Anthropic.Beta.Messages.BetaContentBlock;
type ToolUse = Anthropic.Beta.Messages.BetaToolUseBlock;

export interface AgentRequest { system: string; tools: Tool[]; messages: Msg[] }
export interface AgentTurn { content: Block[]; stop_reason: string | null; output: AiAnswer | null; model: string; usage?: { input_tokens?: number; output_tokens?: number } | null }
export interface AgentProvider { name: string; model: string; turn(req: AgentRequest): Promise<AgentTurn> }

class AnthropicAgent implements AgentProvider {
  name = 'anthropic';
  model = AI_MODEL;
  private client = new Anthropic({ maxRetries: 2, timeout: 180_000 });
  async turn(req: AgentRequest): Promise<AgentTurn> {
    const res = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high', format: betaZodOutputFormat(AnswerSchema) },
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      tools: req.tools,
      messages: req.messages,
    });
    return { content: res.content, stop_reason: res.stop_reason, output: res.stop_reason === 'end_turn' ? res.parsed_output ?? null : null, model: res.model, usage: res.usage };
  }
}

/**
 * YandexGPT — агент для установок в России (Yandex Cloud). Вызов функций — через OpenAI-совместимый API AI Studio.
 * Внутри агента история хранится в формате Anthropic; здесь она переводится туда и обратно, поэтому цикл, инструменты,
 * журнал и серверные проверки ответа одни для обоих провайдеров. Структурированного вывода вместе с инструментами нет:
 * итоговый ответ модель даёт JSON-текстом, сервер сверяет его со схемой; не сошлось — один повтор с требованием JSON.
 */
export class YandexAgent implements AgentProvider {
  name = 'yandexgpt';
  model = YANDEX_AI_MODEL;
  async turn(req: AgentRequest): Promise<AgentTurn> {
    const messages = toChat(req);
    const tools = req.tools.map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description || '', parameters: t.input_schema } }));
    const r = await chat(messages, { model: this.model, tools, maxTokens: 6000 });
    const usage = { input_tokens: r.usage?.prompt_tokens || 0, output_tokens: r.usage?.completion_tokens || 0 };
    const calls = r.message.tool_calls || [];
    if (calls.length) {
      const content = [
        ...(r.message.content?.trim() ? [{ type: 'text', text: r.message.content, citations: null }] : []),
        ...calls.map((c, i) => ({ type: 'tool_use', id: c.id || `ya_${Date.now().toString(36)}_${i}`, name: c.function.name, input: args(c) })),
      ] as Block[];
      return { content, stop_reason: 'tool_use', output: null, model: this.model, usage };
    }
    const text = r.message.content || '';
    const content = [{ type: 'text', text, citations: null }] as Block[];
    if (r.finish_reason === 'content_filter') return { content, stop_reason: 'refusal', output: null, model: this.model, usage };
    if (r.finish_reason === 'length') return { content, stop_reason: 'max_tokens', output: null, model: this.model, usage };
    let output = parseJsonAnswer(text);
    if (!output) {
      // Модель ответила текстом, а не JSON: просим переписать тот же ответ в формате (без инструментов).
      const fix = await chat([...messages, { role: 'assistant', content: text }, { role: 'user', content: `Перепиши свой ответ в требуемом формате, ничего не добавляя.\n\n${JSON_FORMAT}` }],
        { model: this.model, maxTokens: 4000, json: true });
      usage.input_tokens += fix.usage?.prompt_tokens || 0; usage.output_tokens += fix.usage?.completion_tokens || 0;
      output = parseJsonAnswer(fix.message.content || '');
    }
    return { content, stop_reason: 'end_turn', output, model: this.model, usage };
  }
}

function args(c: ChatToolCall): unknown {
  const a = c.function.arguments;
  if (a && typeof a === 'object') return a;
  try { return JSON.parse(String(a || '{}')); } catch { return { _неразобрано: a }; }
}

/** История агента (формат Anthropic) → сообщения chat/completions. */
function toChat(req: AgentRequest): ChatMessage[] {
  const out: ChatMessage[] = [{ role: 'system', content: `${req.system}\n\nКогда данных достаточно, инструменты больше не вызывай. ${JSON_FORMAT}` }];
  for (const m of req.messages) {
    if (typeof m.content === 'string') { out.push({ role: m.role, content: m.content }); continue; }
    const blocks = m.content as { type: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown }[];
    if (m.role === 'assistant') {
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const tool_calls = blocks.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id!, type: 'function' as const, function: { name: b.name!, arguments: JSON.stringify(b.input ?? {}) } }));
      out.push({ role: 'assistant', content: text || null, ...(tool_calls.length ? { tool_calls } : {}) });
      continue;
    }
    for (const b of blocks.filter((x) => x.type === 'tool_result')) out.push({ role: 'tool', tool_call_id: b.tool_use_id!, content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content) });
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    if (text) out.push({ role: 'user', content: text });
  }
  return out;
}

let override: AgentProvider | null | undefined;
/** Для тестов и офлайн-режима: подменить провайдера агента (null — AI отключён). */
export function setAgentProvider(p: AgentProvider | null | undefined) { override = p; }
function provider(): AgentProvider | null {
  if (override !== undefined) return override;
  if (process.env.AI_PROVIDER === 'off') return null;
  // Как у разового помощника: YandexGPT — только явно (AI_PROVIDER=yandex) и при заданных ключах Yandex Cloud.
  if (process.env.AI_PROVIDER === 'yandex') return yandexStatus().configured ? new YandexAgent() : null;
  // Зарубежный провайдер — только по явному AI_PROVIDER=anthropic: один ключ без этой настройки не отправляет данные за рубеж (152-ФЗ)
  if (process.env.AI_PROVIDER !== 'anthropic') return null;
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  return new AnthropicAgent();
}

/* ───────────── Инструменты ───────────── */

interface Ctx {
  userId: string; orgId: string;
  /** Источники запуска: единая нумерация S1, S2 … по всем вызовам инструментов. */
  sources: Source[];
}

const nullableUuid = { type: ['string', 'null'], description: 'UUID; null — все доступные' } as const;
const obj = (properties: Record<string, unknown>) => ({ type: 'object' as const, properties, required: Object.keys(properties), additionalProperties: false });

interface ToolDef { label: string; tool: Tool; input: z.ZodType; run(c: Ctx, input: any): Promise<unknown> }

/** Добавляет найденные требования в общий список запуска и отдаёт модели их номера и тексты. */
function addSources(c: Ctx, found: Source[]) {
  const out: Source[] = [];
  for (const s of found) {
    let have = c.sources.find((x) => x.requirement_id === s.requirement_id);
    if (!have) { have = { ...s, id: `S${c.sources.length + 1}` }; c.sources.push(have); }
    out.push(have);
  }
  return out.map((s) => ({ источник: s.id, документ: s.code, название: s.title, пункт: s.clause, редакция: s.edition, статус: s.state_label, область: s.scope, текст: s.text }));
}

const cut = <T,>(rows: T[]) => ({ всего: rows.length, ...(rows.length > MAX_ROWS ? { показано: MAX_ROWS } : {}), строки: rows.slice(0, MAX_ROWS) });
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

const TOOLS: Record<string, ToolDef> = {
  list_sites: {
    label: 'Площадки',
    tool: { name: 'list_sites', description: 'Площадки (точки) предприятия, доступные пользователю: id и название. Нужны, чтобы смотреть партии по площадке.', input_schema: obj({}), strict: true },
    input: z.object({}),
    async run(c) {
      return (await listSites(c.userId, c.orgId)).filter((s) => s.status === 'active').map((s) => ({ id: s.id, название: s.name }));
    },
  },
  problems_today: {
    label: 'Проблемы на сегодня',
    tool: { name: 'problems_today', description: 'Сводка «что не в порядке сейчас», как на главном экране: открытые отклонения, партии с истёкшим или истекающим сроком, карантин, пропущенные замеры и т. п. Начинай с неё на вопросы вида «что у меня не так».', input_schema: obj({ site_id: nullableUuid }), strict: true },
    input: z.object({ site_id: z.uuid().nullable() }),
    async run(c, i) {
      const { cards } = await getProblems(c.userId, c.orgId, i.site_id);
      return cut(cards.map((p: ProblemCard) => ({ что: p.title, подробно: p.what, где: p.where, риск: p.risk, ответственный: p.responsible, срок: p.due_at, основание: p.source, действие: p.action, статус: p.status ?? null })));
    },
  },
  list_tasks: {
    label: 'Открытые задачи',
    tool: { name: 'list_tasks', description: 'Открытые задачи пользователя и его роли (у руководителей — все): что сделать, срок, просрочена ли.', input_schema: obj({}), strict: true },
    input: z.object({}),
    async run(c) {
      const rows = await listTasks(c.userId, c.orgId, { all: true });
      return cut(rows.map((t) => ({ задача: t.title, подробно: t.details, площадка: t.site_name, срок: t.due_at, просрочена: t.overdue, роль: t.assignee_role })));
    },
  },
  list_incidents: {
    label: 'Отклонения',
    tool: { name: 'list_incidents', description: 'Отклонения (несоответствия): id, что случилось, риск, статус. only_open=true — только незакрытые.', input_schema: obj({ only_open: { type: 'boolean' } }), strict: true },
    input: z.object({ only_open: z.boolean() }),
    async run(c, i) {
      const rows = await listIncidents(c.userId, c.orgId, { open: i.only_open });
      return cut(rows.map((r) => ({ id: r.id, название: r.title, что: r.what, риск: r.severity_label, статус: r.status_label, площадка: r.site_name, создано: r.created_at, срок: r.due_at })));
    },
  },
  incident_details: {
    label: 'Отклонение подробно',
    tool: { name: 'incident_details', description: 'Подробности отклонения по id: объект, утверждённое правило и реакция, последние замеры, партии, ход работы, а также требования реестра, на которые можно ссылаться.', input_schema: obj({ incident_id: { type: 'string', description: 'UUID отклонения из list_incidents' } }), strict: true },
    input: z.object({ incident_id: z.uuid() }),
    async run(c, i) {
      return inOrg(c.userId, c.orgId, 'incident.read', async (tx, m) => {
        const row = (await tx.query(`select site_id from incidents where id = $1 and organization_id = $2`, [i.incident_id, c.orgId])).rows[0];
        if (row?.site_id && m.site_ids.length && !m.site_ids.includes(row.site_id)) throw Errors.forbidden('Нет доступа к этой площадке.');
        const built = await incidentContext(tx, c.orgId, i.incident_id);
        return { данные: built.ctx, требования: addSources(c, await findSources(tx, c.orgId, built.searchText, built.pinned)) };
      });
    },
  },
  list_lots: {
    label: 'Партии',
    tool: { name: 'list_lots', description: 'Партии продукции на площадке: товар, номер, количество, срок годности, место хранения, статус. state: all — все в наличии; expired — срок истёк; soon — скоро истекает; unconfirmed — срок не подтверждён; quarantine — на карантине.',
      input_schema: obj({ site_id: { type: 'string', description: 'UUID площадки из list_sites' }, state: { type: 'string', enum: ['all', 'expired', 'soon', 'unconfirmed', 'quarantine'] } }), strict: true },
    input: z.object({ site_id: z.uuid(), state: z.enum(['all', 'expired', 'soon', 'unconfirmed', 'quarantine']) }),
    async run(c, i) {
      const rows = await listLots(c.userId, c.orgId, i.site_id, i.state === 'all' ? {} : { state: i.state });
      return cut(rows.map((l) => ({ товар: l.product, партия: l.lot_no, количество: `${num(l.quantity)} ${l.unit}`, годен_до: l.expires_at, срок: l.expiry_label, хранение: l.storage_name, статус: l.status_label })));
    },
  },
  list_capas: {
    label: 'CAPA',
    tool: { name: 'list_capas', description: 'Корректирующие и предупреждающие действия (CAPA): название, статус, срок, просрочено ли, ответственный. only_open=true — только незакрытые.', input_schema: obj({ only_open: { type: 'boolean' } }), strict: true },
    input: z.object({ only_open: z.boolean() }),
    async run(c, i) {
      const rows = await listCapas(c.userId, c.orgId, { open: i.only_open });
      return cut(rows.map((r) => ({ название: r.title, статус: r.status_label, срок: r.due_at, просрочено: r.overdue, ответственный: r.responsible, площадка: r.site_name })));
    },
  },
  past_cases: {
    label: 'Прошлые случаи',
    tool: { name: 'past_cases', description: 'Опыт предприятия: закрытые отклонения и закрытые CAPA, похожие на запрос (что случилось, причина, что сделали, проверка эффективности). Это не норма, а история решений.', input_schema: obj({ query: { type: 'string', description: 'О чём случай, ключевые слова' } }), strict: true },
    input: z.object({ query: z.string().trim().min(3).max(300) }),
    async run(c, i) {
      const q = words(i.query).join(' | ');
      if (!q) return { случаи: [] };
      return inOrg(c.userId, c.orgId, 'incident.read', async (tx, m) => {
        const sites = m.site_ids.length ? m.site_ids : null;
        const inc = (await tx.query(`select title, what, action_note, closed_at from incidents
          where organization_id = $1 and status = 'closed' and ($3::uuid[] is null or site_id is null or site_id = any($3::uuid[]))
            and to_tsvector('russian', title || ' ' || what || ' ' || coalesce(action_note, '')) @@ to_tsquery('russian', $2)
          order by closed_at desc nulls last limit 5`, [c.orgId, q, sites])).rows
          .map((r) => ({ вид: 'отклонение', что: r.title, подробно: r.what, сделано: r.action_note, закрыто: r.closed_at }));
        const capa = roleHas(m.role, 'capa.read') ? (await tx.query(`select title, problem, root_cause, corrective_action, preventive_action, verification_note, verified_at from capas
          where organization_id = $1 and status = 'closed' and ($3::uuid[] is null or site_id is null or site_id = any($3::uuid[]))
            and to_tsvector('russian', title || ' ' || problem || ' ' || coalesce(root_cause, '') || ' ' || coalesce(corrective_action, '')) @@ to_tsquery('russian', $2)
          order by verified_at desc nulls last limit 5`, [c.orgId, q, sites])).rows
          .map((r) => ({ вид: 'CAPA', что: r.title, проблема: r.problem, причина: r.root_cause, коррекция: r.corrective_action, предупреждение: r.preventive_action, проверка_эффективности: r.verification_note })) : [];
        return { случаи: [...inc, ...capa] };
      });
    },
  },
  find_requirements: {
    label: 'Требования реестра',
    tool: { name: 'find_requirements', description: 'Поиск в реестре утверждённых требований предприятия (действующие и вступающие в силу редакции, применимые к предприятию). Возвращает номера источников S1, S2 … для цитирования.', input_schema: obj({ query: { type: 'string', description: 'Тема: процесс, продукт, параметр' } }), strict: true },
    input: z.object({ query: z.string().trim().min(3).max(300) }),
    async run(c, i) {
      const found = await inOrg(c.userId, c.orgId, 'ai.use', (tx) => findSources(tx, c.orgId, i.query));
      return { требования: addSources(c, found), ...(found.length ? {} : { примечание: 'В реестре нет утверждённых требований по этой теме.' }) };
    },
  },
};

const TOOL_LIST = Object.values(TOOLS).map((t) => t.tool);

interface Step { инструмент: string; название: string; параметры: unknown; результат?: unknown; ошибка?: string }

async function runTool(c: Ctx, use: ToolUse): Promise<{ step: Step; text: string; isError: boolean }> {
  const def = TOOLS[use.name];
  const base = { инструмент: use.name, название: def?.label || use.name, параметры: use.input };
  try {
    if (!def) throw Errors.validation('Нет такого инструмента.');
    const result = await def.run(c, parse(def.input, use.input));
    let text = JSON.stringify(result);
    if (text.length > MAX_RESULT_CHARS) text = `${text.slice(0, MAX_RESULT_CHARS)}… [обрезано: уточните запрос]`;
    return { step: { ...base, результат: result }, text, isError: false };
  } catch (e) {
    // Ошибки доступа и проверки показываем модели как есть; прочие — без подробностей.
    const msg = e instanceof AppError ? e.message : 'Не удалось получить данные.';
    if (!(e instanceof AppError)) console.error('ai agent tool', use.name, e);
    return { step: { ...base, ошибка: msg }, text: msg, isError: true };
  }
}

/* ───────────── Запуск ───────────── */

export async function askAgent(userId: string, orgId: string, input: unknown) {
  const { question } = parse(z.object({ question: z.string().trim().min(5, 'Сформулируйте вопрос.').max(1000) }), input);
  // Право на AI и лимит — до первого обращения к модели.
  const used = await inOrg(userId, orgId, 'ai.use', (tx) => usedToday(tx, orgId));
  const p = provider();
  if (p && used >= DAILY_LIMIT) throw Errors.conflict(`Достигнут дневной лимит запросов к AI (${DAILY_LIMIT}). Он задаётся настройкой AI_DAILY_LIMIT.`);

  const c: Ctx = { userId, orgId, sources: [] };
  const steps: Step[] = [];
  let status = 'unavailable', answer: AiAnswer | null = null, model: string | null = null, error: string | null = null;
  let guard: ReturnType<typeof checkAnswer> | Record<string, never> = {};
  const usage = { turns: 0, input_tokens: 0, output_tokens: 0 };
  const started = Date.now();

  if (p) {
    // История только дополняется: ответы модели (вместе с блоками размышлений) возвращаются ей без изменений.
    const messages: Msg[] = [{ role: 'user', content: `Вопрос пользователя: ${question}` }];
    try {
      for (;;) {
        if (usage.turns >= MAX_TURNS) { status = 'step_limit'; break; }
        const r = await p.turn({ system: SYSTEM, tools: TOOL_LIST, messages });
        usage.turns++; usage.input_tokens += r.usage?.input_tokens || 0; usage.output_tokens += r.usage?.output_tokens || 0;
        model = r.model;
        if (r.stop_reason === 'refusal') { status = 'refused'; break; }
        if (r.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: r.content }); continue; }
        if (r.stop_reason === 'tool_use') {
          messages.push({ role: 'assistant', content: r.content });
          const results: Anthropic.Beta.Messages.BetaContentBlockParam[] = [];
          for (const use of r.content.filter((b): b is ToolUse => b.type === 'tool_use')) {
            const t = await runTool(c, use);
            steps.push(t.step);
            results.push({ type: 'tool_result', tool_use_id: use.id, content: t.text, is_error: t.isError });
          }
          if (usage.turns === MAX_TURNS - 1) results.push({ type: 'text', text: 'Это последний шаг: больше инструменты не вызывай, дай итоговый ответ по собранным данным.' });
          messages.push({ role: 'user', content: results });
          continue;
        }
        if (r.stop_reason === 'end_turn' && r.output) {
          guard = checkAnswer(r.output, c.sources, { вопрос: question, шаги: steps });
          answer = { ...r.output, citations: guard.citations };
          status = guard.ok ? 'ok' : 'guard_rejected';
        } else { status = 'error'; error = r.stop_reason === 'max_tokens' ? 'Ответ AI оборвался — уточните вопрос.' : 'Ответ не соответствует формату.'; }
        break;
      }
    } catch (e) {
      status = 'error';
      error = e instanceof Anthropic.RateLimitError ? 'AI перегружен — повторите позже.' : e instanceof Anthropic.APIError ? `Ошибка AI (${e.status}).` : 'AI недоступен.';
      if (!(e instanceof Anthropic.APIError)) console.error('ai agent', e);
    }
  }
  const latency = Date.now() - started;

  // Без модели — то, что система нашла в реестре сама (как у разового вопроса).
  if (!p) await TOOLS.find_requirements.run(c, { query: question }).catch(() => null);

  return inOrg(userId, orgId, 'ai.use', async (tx) => {
    const context = { вопрос: question, шаги: steps };
    const job = (await tx.query(`insert into ai_jobs (organization_id, user_id, kind, question, context, sources, provider, model, prompt_version, status, answer, guard, usage, latency_ms, error)
      values ($1, $2, 'agent', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id, created_at`,
      [orgId, userId, question, JSON.stringify(context), JSON.stringify(c.sources), p ? p.name : 'none', model, AGENT_PROMPT_VERSION, status,
        answer ? JSON.stringify(answer) : null, JSON.stringify(guard), p ? JSON.stringify(usage) : null, latency, error])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'ai.job', entityType: 'ai_job', entityId: job.id,
      after: { kind: 'agent', status, model, sources: c.sources.length, steps: steps.map((s) => s.инструмент), turns: usage.turns } });
    const view: AgentStepView[] = steps.map((s) => ({ tool: s.инструмент, label: s.название, input: s.параметры, ok: !s.ошибка }));
    return present(job.id, status, answer, c.sources, guard, model, error, view);
  });
}

export const AGENT_TOOLS = Object.keys(TOOLS);
