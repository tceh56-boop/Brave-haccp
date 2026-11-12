import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, createSite, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createControlObject, createRule, approveRule } from '../src/server/ops/control';
import { recordMeasurement } from '../src/server/ops/measurements';
import { createSource, addRequirement, markChecked, approveVersion, decideApplicability } from '../src/server/ops/regulatory';
import { listTasks } from '../src/server/ops/tasks';
import { decide, getJob, listJobs, type AiAnswer } from '../src/server/ops/ai';
import { askAgent, setAgentProvider, AGENT_TOOLS, type AgentProvider, type AgentRequest, type AgentTurn } from '../src/server/ops/aiAgent';
import { makeUser, lastLinkToken } from './helpers';

afterAll(() => { setAgentProvider(undefined); return closePool(); });
afterEach(() => { setAgentProvider(undefined); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, haccp: U, cook: U, cook2: U;
let orgId: string, siteId: string, incidentId: string;
const day = (n: number) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const RULE_TEXT = 'Охлаждённое мясо хранят при температуре от 0 до +4 °C; при отклонении продукцию изолируют до решения ответственного.';

async function invite(role: string, siteIds: string[] = []) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role, siteIds });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}

const ANSWER: AiAnswer = {
  found: 'В камере мяса замер 7,5 °C — выше предела.', why: 'Мясо может испортиться.', do_now: ['Повторить замер через 15 минут', 'Проверить дверь и уплотнитель'],
  dont: ['Не использовать мясо из камеры до решения ответственного'], who_confirms: 'Ответственный ХАССП', closes_when: 'Повторный замер в пределе и запись действия',
  citations: [{ source: 'S1', quote: 'от 0 до +4 °C' }], limitations: 'Нет данных о времени нахождения продукции вне предела.', confidence: 'medium',
};

/** Ответ только по реестру: числа — из текста требования. */
const REG: Partial<AiAnswer> = { found: 'Требование задаёт хранение от 0 до +4 °C.', do_now: ['Проверить термометр в камере', 'Записать замер в журнал'] };

let seq = 0;
const use = (name: string, input: unknown) => ({ type: 'tool_use', id: `tu_${++seq}`, name, input }) as unknown as AgentTurn['content'][number];
const call = (...blocks: AgentTurn['content']): AgentTurn => ({ content: blocks, stop_reason: 'tool_use', output: null, model: 'test-model', usage: { input_tokens: 10, output_tokens: 5 } });
const final = (a: Partial<AiAnswer> = {}): AgentTurn => ({ content: [{ type: 'text', text: '{}' } as unknown as AgentTurn['content'][number]], stop_reason: 'end_turn', output: { ...ANSWER, ...a }, model: 'test-model', usage: { input_tokens: 10, output_tokens: 5 } });

/** Тестовый агент: по очереди отдаёт заранее заданные ходы; ход может зависеть от запроса. */
function script(...turns: (AgentTurn | ((req: AgentRequest) => AgentTurn))[]): AgentProvider & { calls: AgentRequest[] } {
  const calls: AgentRequest[] = [];
  return {
    name: 'test', model: 'test-model', calls,
    async turn(req) {
      calls.push({ ...req, messages: [...req.messages] });
      const t = turns[Math.min(calls.length - 1, turns.length - 1)];
      return typeof t === 'function' ? t(req) : t;
    },
  };
}
/** Результаты инструментов, которые агент получил на последнем ходу. */
const lastResults = (req: AgentRequest) => (req.messages.at(-1)!.content as { type: string; content?: string; is_error?: boolean }[]).filter((b) => b.type === 'tool_result');

beforeAll(async () => {
  owner = await makeUser({ name: 'Ольга Владелец' });
  const r = await createOrganization(owner, { name: 'Кафе «ЦЕХ AI»' });
  orgId = r.organization.id; siteId = r.site.id;
  const site2 = (await createSite(owner.id, orgId, { name: 'Вторая точка' })).id;
  haccp = await invite('haccp_lead'); cook = await invite('line_staff', [siteId]); cook2 = await invite('line_staff', [site2]);
  const { version } = await createSource(haccp.id, orgId, { code: 'ПК-03', kind: 'Внутренний', title: 'Процедура контроля холодильного хранения мяса', binding: 'mandatory', edition: 'ред. 1', effectiveFrom: day(-10) });
  const req = await addRequirement(haccp.id, orgId, version.id, { clause: 'п. 2', text: RULE_TEXT, scope: 'холодильное хранение мяса', processes: ['storage'] });
  await markChecked(haccp.id, orgId, version.id, { evidence: 'Сверено с приказом директора № 12 от 01.10.2026', nextCheckAt: day(180) });
  await approveVersion(owner.id, orgId, version.id);
  await decideApplicability(haccp.id, orgId, req.id, { applicable: true, rationale: 'кафе хранит охлаждённое мясо' });
  const fridge = (await createControlObject(owner.id, orgId, { siteId, name: 'Камера мяса', kind: 'fridge' })).id;
  const rule = await createRule(haccp.id, orgId, { controlObjectId: fridge, minValue: 0, maxValue: 4, frequencyHours: 4, requirementId: req.id,
    reaction: 'Повторить замер через 15 минут; проверить дверь; при повторном отклонении изолировать продукцию.', allowIsolation: true });
  await approveRule(haccp.id, orgId, rule.id);
  incidentId = (await recordMeasurement(cook.id, orgId, { controlObjectId: fridge, value: 7.5 })).incidentId!;
});

describe('ЦЕХ AI: агент сам собирает данные системы', () => {
  it('отклонения → подробности → ответ с цитатой; шаги и источники в журнале; модель видит данные', async () => {
    const p = script(
      call(use('list_incidents', { only_open: true })),
      (req) => {
        const inc = JSON.parse(lastResults(req)[0].content!).строки[0];
        return call(use('incident_details', { incident_id: inc.id }));
      },
      final(),
    );
    setAgentProvider(p);
    const r = await askAgent(cook.id, orgId, { question: 'Что у меня сейчас не в порядке с холодильниками?' });
    expect(r.status).toBe('ok');
    expect(r.steps!.map((s) => s.tool)).toEqual(['list_incidents', 'incident_details']);
    expect(r.citations).toEqual([expect.objectContaining({ id: 'S1', code: 'ПК-03', clause: 'п. 2', quote: 'от 0 до +4 °C' })]);
    // Модель получила список инструментов, правила и данные отклонения (с замером 7,5 °C) и текст требования.
    expect(p.calls[0].tools.map((t) => t.name).sort()).toEqual([...AGENT_TOOLS].sort());
    expect(p.calls[0].system).toMatch(/Нормы, сроки годности, температуры/);
    const detail = lastResults(p.calls[2])[0].content!;
    expect(detail).toContain('7,5 °C');
    expect(detail).toContain(RULE_TEXT);
    // Журнал: вид, шаги с результатами, число обращений к модели.
    const j = await getJob(cook.id, orgId, r.job_id);
    expect(j.steps!.map((s) => s.label)).toEqual(['Отклонения', 'Отклонение подробно']);
    expect((j.context as { шаги: unknown[] }).шаги).toHaveLength(2);
    const row = await withSystem(async (tx) => (await tx.query(`select kind, usage, prompt_version from ai_jobs where id = $1`, [r.job_id])).rows[0]);
    expect(row.kind).toBe('agent');
    expect(row.usage.turns).toBe(3);
    expect(row.prompt_version).toMatch(/agent/);
    expect((await listJobs(cook.id, orgId, { mine: true })).some((x) => x.id === r.job_id && x.kind === 'agent')).toBe(true);
  });

  it('предложенное действие становится задачей только по решению человека', async () => {
    setAgentProvider(script(call(use('find_requirements', { query: 'хранение охлаждённого мяса температура' })), final(REG)));
    const r = await askAgent(haccp.id, orgId, { question: 'Как хранить охлаждённое мясо?' });
    expect(r.status).toBe('ok');
    expect((await listTasks(haccp.id, orgId, { all: true })).some((t) => t.kind === 'ai_action' && t.title === 'Проверить термометр в камере')).toBe(false);
    const d = await decide(haccp.id, orgId, r.job_id, { itemIndex: 0, decision: 'task_created', assigneeRole: 'line_staff' });
    expect(d.task_id).toBeTruthy();
  });

  it('права пользователя: сотрудник другой площадки не получает чужое отклонение — модель видит ошибку доступа', async () => {
    const p = script(call(use('incident_details', { incident_id: incidentId })), final({ citations: [], found: 'Нет доступа к данным.', do_now: [] }));
    setAgentProvider(p);
    const r = await askAgent(cook2.id, orgId, { question: 'Что случилось с камерой мяса?' });
    const res = lastResults(p.calls[1])[0];
    expect(res.is_error).toBe(true);
    expect(res.content).toMatch(/Нет доступа/);
    expect(r.steps).toEqual([expect.objectContaining({ tool: 'incident_details', ok: false })]);
    expect(r.sources).toEqual([]);                                   // требования из чужого отклонения не попали
  });

  it('неверные параметры и неизвестный инструмент — ошибка шага, а не сбой', async () => {
    const p = script(call(use('incident_details', { incident_id: 'не-uuid' }), use('drop_table', {})), final({ citations: [] }));
    setAgentProvider(p);
    const r = await askAgent(cook.id, orgId, { question: 'Проверь отклонение номер один' });
    expect(lastResults(p.calls[1]).map((x) => x.is_error)).toEqual([true, true]);
    expect(r.steps!.map((s) => s.ok)).toEqual([false, false]);
  });

  it('проверка ответа: число без источника отклоняет ответ; ссылка на несуществующий источник отбрасывается', async () => {
    setAgentProvider(script(call(use('find_requirements', { query: 'хранение мяса' })), final({ ...REG, do_now: ['Хранить не более 72 часов'] })));
    const bad = await askAgent(cook.id, orgId, { question: 'Сколько можно хранить мясо?' });
    expect(bad.status).toBe('guard_rejected');
    expect(bad.answer).toBeNull();
    expect(bad.unsupported).toContain('72 часов');

    setAgentProvider(script(call(use('find_requirements', { query: 'хранение мяса' })), final({ ...REG, citations: [{ source: 'S1', quote: 'от 0 до +4 °C' }, { source: 'S9', quote: 'что-то' }] })));
    const r = await askAgent(cook.id, orgId, { question: 'При какой температуре хранить мясо?' });
    expect(r.status).toBe('ok');
    expect(r.citations).toHaveLength(1);
    expect(r.bad_citations).toEqual([expect.objectContaining({ source: 'S9', reason: 'нет такого источника' })]);
  });

  it('лимит шагов: агент, который не останавливается, получает предупреждение и статус step_limit', async () => {
    const p = script(call(use('list_tasks', {})));
    setAgentProvider(p);
    const r = await askAgent(cook.id, orgId, { question: 'Покажи задачи снова и снова' });
    expect(r.status).toBe('step_limit');
    expect(p.calls).toHaveLength(8);
    const last = p.calls[7].messages.at(-1)!.content as { type: string; text?: string }[];
    expect(last.some((b) => b.type === 'text' && /последний шаг/.test(b.text!))).toBe(true);
    expect(r.message).toMatch(/шагов/);
  });

  it('отказ модели и отсутствие AI', async () => {
    setAgentProvider(script({ content: [], stop_reason: 'refusal', output: null, model: 'test-model' }));
    expect((await askAgent(cook.id, orgId, { question: 'Что-нибудь о мясе' })).status).toBe('refused');

    setAgentProvider(null);
    const r = await askAgent(cook.id, orgId, { question: 'При какой температуре хранить охлаждённое мясо?' });
    expect(r.status).toBe('unavailable');
    expect(r.sources.map((s) => s.code)).toEqual(['ПК-03']);         // система всё равно показывает найденные требования
  });

  it('без права на AI — отказ до обращения к модели', async () => {
    const p = script(final());
    setAgentProvider(p);
    const stranger = await makeUser();
    await expect(askAgent(stranger.id, orgId, { question: 'Что у вас в холодильнике?' })).rejects.toThrow();
    expect(p.calls).toHaveLength(0);
  });
});

describe('ЦЕХ AI-агент на YandexGPT (AI_PROVIDER=yandex)', () => {
  type Body = { model: string; messages: { role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string }[]; tools?: { type: string; function: { name: string } }[]; response_format?: unknown };
  /** Подменённый chat/completions: по очереди отдаёт ответы, запоминает запросы. Обращений к Yandex Cloud нет. */
  function yandex(...replies: ((b: Body) => object)[]) {
    const bodies: Body[] = []; const headers: Record<string, string>[] = []; const urls: string[] = [];
    vi.stubEnv('AI_PROVIDER', 'yandex'); vi.stubEnv('YANDEX_API_KEY', 'AQVN-тест'); vi.stubEnv('YANDEX_FOLDER_ID', 'b1gtest00000');
    vi.stubGlobal('fetch', vi.fn(async (u: unknown, init?: { body?: string; headers?: Record<string, string> }) => {
      const b = JSON.parse(init!.body!) as Body; bodies.push(b); headers.push(init!.headers!); urls.push(String(u));
      const msg = replies[Math.min(bodies.length - 1, replies.length - 1)](b);
      return new Response(JSON.stringify({ choices: [{ message: msg, finish_reason: 'tool_calls' in msg ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 } }), { status: 200 });
    }));
    return { bodies, headers, urls };
  }
  const toolCall = (id: string, name: string, a: unknown) => ({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(a) } }] });

  it('вызывает инструменты через chat/completions, получает данные и отвечает JSON; проверки те же', async () => {
    const y = yandex(
      () => toolCall('c1', 'list_incidents', { only_open: true }),
      (b) => toolCall('c2', 'incident_details', { incident_id: JSON.parse(b.messages.at(-1)!.content!).строки[0].id }),
      () => ({ role: 'assistant', content: JSON.stringify(ANSWER) }),
    );
    const r = await askAgent(cook.id, orgId, { question: 'Что сегодня не в порядке с холодильниками?' });
    expect(r.status).toBe('ok');
    expect(r.model).toBe('yandexgpt/latest');
    expect(r.steps!.map((s) => s.tool)).toEqual(['list_incidents', 'incident_details']);
    expect(r.citations).toEqual([expect.objectContaining({ id: 'S1', quote: 'от 0 до +4 °C' })]);
    expect(y.urls[0]).toBe('https://ai.api.cloud.yandex.net/v1/chat/completions');
    expect(y.headers[0]).toMatchObject({ authorization: 'Api-Key AQVN-тест', 'OpenAI-Project': 'b1gtest00000' });
    expect(y.bodies[0].model).toBe('gpt://b1gtest00000/yandexgpt/latest');
    expect(y.bodies[0].tools!.map((t) => t.function.name).sort()).toEqual([...AGENT_TOOLS].sort());
    expect(y.bodies[0].messages[0]).toMatchObject({ role: 'system', content: expect.stringContaining('JSON-объектом') });
    // История: вызов модели и результат инструмента с тем же id; в результате — замер и текст требования.
    const third = y.bodies[2].messages;
    expect(third.filter((m) => m.role === 'tool').map((m) => m.tool_call_id)).toEqual(['c1', 'c2']);
    expect(third.at(-1)!.content).toContain('7,5 °C');
    expect(third.at(-1)!.content).toContain(RULE_TEXT);
    const row = await withSystem(async (tx) => (await tx.query(`select provider, usage from ai_jobs where id = $1`, [r.job_id])).rows[0]);
    expect(row).toMatchObject({ provider: 'yandexgpt', usage: { turns: 3, input_tokens: 300, output_tokens: 60 } });
  });

  it('ответ текстом вместо JSON — один повтор с требованием формата; не помогло — ошибка формата, а не выдумка', async () => {
    const y = yandex(() => ({ role: 'assistant', content: 'Всё хорошо, не волнуйтесь.' }), () => ({ role: 'assistant', content: '```json\n' + JSON.stringify({ ...ANSWER, citations: [], found: 'Данных нет.', do_now: [] }) + '\n```' }));
    const ok = await askAgent(cook.id, orgId, { question: 'Что сегодня не в порядке?' });
    expect(ok.status).toBe('ok');
    expect(y.bodies).toHaveLength(2);
    expect(y.bodies[1].tools).toBeUndefined();
    expect(y.bodies[1].response_format).toEqual({ type: 'json_object' });

    yandex(() => ({ role: 'assistant', content: 'Не знаю.' }));
    const bad = await askAgent(cook.id, orgId, { question: 'Что сегодня не в порядке?' });
    expect(bad.status).toBe('error');
    expect(bad.answer).toBeNull();
  });

  it('без ключей Yandex Cloud агент выключен и не обращается к сети', async () => {
    vi.stubEnv('AI_PROVIDER', 'yandex'); vi.stubEnv('YANDEX_API_KEY', ''); vi.stubEnv('YANDEX_IAM_TOKEN', ''); vi.stubEnv('YANDEX_FOLDER_ID', '');
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    expect((await askAgent(cook.id, orgId, { question: 'Что сегодня не в порядке?' })).status).toBe('unavailable');
    expect(f).not.toHaveBeenCalled();
  });
});
