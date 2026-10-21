import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, createSite, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createControlObject, createRule, approveRule } from '../src/server/ops/control';
import { recordMeasurement } from '../src/server/ops/measurements';
import { createSource, addRequirement, markChecked, approveVersion, decideApplicability } from '../src/server/ops/regulatory';
import { listTasks } from '../src/server/ops/tasks';
import { setAiProvider, explainIncident, askQuestion, decide, listJobs, getJob, checkAnswer, type AiAnswer, type AiProvider, type AiRequest } from '../src/server/ops/ai';
import { makeUser, lastLinkToken } from './helpers';

afterAll(() => { setAiProvider(undefined); return closePool(); });
afterEach(() => setAiProvider(undefined));

type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, haccp: U, cook: U, cook2: U, auditor: U, stranger: U;
let orgId: string, siteId: string, incidentId: string;
const day = (n: number) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const RULE_TEXT = 'Охлаждённое мясо хранят при температуре от 0 до +4 °C; при отклонении продукцию изолируют до решения ответственного.';

async function invite(role: string, siteIds: string[] = []) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role, siteIds });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}

/** Тестовый провайдер: отдаёт заранее заданный ответ и запоминает запросы. */
function fake(answer: Partial<AiAnswer> | 'refuse'): AiProvider & { calls: AiRequest[] } {
  const calls: AiRequest[] = [];
  return {
    name: 'test', model: 'test-model', calls,
    async generate(req) {
      calls.push(req);
      if (answer === 'refuse') return { output: null, model: 'test-model', refused: true };
      return { model: 'test-model', output: { found: 'Температура в камере выше предела.', why: 'Мясо может испортиться.', do_now: ['Повторить замер через 15 минут', 'Проверить дверь и уплотнитель'],
        dont: ['Не использовать мясо из камеры до решения ответственного'], who_confirms: 'Ответственный ХАССП', closes_when: 'Повторный замер в пределе и запись действия',
        citations: [{ source: 'S1', quote: 'от 0 до +4 °C' }], limitations: 'Нет данных о времени нахождения продукции вне предела.', confidence: 'medium', ...answer } };
    },
  };
}

beforeAll(async () => {
  owner = await makeUser({ name: 'Ольга Владелец' });
  const r = await createOrganization(owner, { name: 'Кафе «AI»' });
  orgId = r.organization.id; siteId = r.site.id;
  const site2 = (await createSite(owner.id, orgId, { name: 'Вторая точка' })).id;
  haccp = await invite('haccp_lead'); cook = await invite('line_staff', [siteId]); cook2 = await invite('line_staff', [site2]); auditor = await invite('auditor');
  stranger = await makeUser();
  await createOrganization(stranger, { name: 'Чужое кафе' });
  // Утверждённое требование: источник → пункт → проверка → утверждение → применимость.
  const { version } = await createSource(haccp.id, orgId, { code: 'ПК-03', kind: 'Внутренний', title: 'Процедура контроля холодильного хранения мяса', binding: 'mandatory', edition: 'ред. 1', effectiveFrom: day(-10) });
  const req = await addRequirement(haccp.id, orgId, version.id, { clause: 'п. 2', text: RULE_TEXT, scope: 'холодильное хранение мяса', processes: ['storage'] });
  await markChecked(haccp.id, orgId, version.id, { evidence: 'Сверено с приказом директора № 12 от 01.10.2026 (оригинал в папке ХАССП)', nextCheckAt: day(180) });
  await approveVersion(owner.id, orgId, version.id);
  await decideApplicability(haccp.id, orgId, req.id, { applicable: true, rationale: 'кафе хранит охлаждённое мясо' });
  // Не утверждённое требование — AI его не цитирует.
  const draft = await createSource(haccp.id, orgId, { code: 'ЧЕРН-1', kind: 'Внутренний', title: 'Черновик про мясо', binding: 'mandatory', edition: 'ред. 0', effectiveFrom: day(-1) });
  await addRequirement(haccp.id, orgId, draft.version.id, { clause: 'п. 1', text: 'Мясо хранят при температуре до +8 °C.', scope: 'хранение мяса', processes: ['storage'] });

  const fridge = (await createControlObject(owner.id, orgId, { siteId, name: 'Камера мяса', kind: 'fridge' })).id;
  const rule = await createRule(haccp.id, orgId, { controlObjectId: fridge, minValue: 0, maxValue: 4, frequencyHours: 4, requirementId: req.id,
    reaction: 'Повторить замер через 15 минут; проверить дверь; при повторном отклонении изолировать продукцию.', allowIsolation: true });
  await approveRule(haccp.id, orgId, rule.id);
  incidentId = (await recordMeasurement(cook.id, orgId, { controlObjectId: fridge, value: 7.5 })).incidentId!;
});

describe('Ответ с цитатой (AT-07): источник, пункт, редакция, дата проверки', () => {
  it('объяснение отклонения: только утверждённые источники; цитата с реквизитами; модель получает данные и правила', async () => {
    const p = fake({});
    setAiProvider(p);
    const r = await explainIncident(cook.id, orgId, incidentId);
    expect(r.status).toBe('ok');
    expect(r.answer!.do_now).toHaveLength(2);
    expect(r.citations).toEqual([expect.objectContaining({ code: 'ПК-03', clause: 'п. 2', edition: 'ред. 1', state_label: 'Действует', last_checked_at: expect.anything(), next_check_at: expect.anything(), quote: 'от 0 до +4 °C' })]);
    expect(r.sources.map((s) => s.code)).toEqual(['ПК-03']);            // черновик не попадает
    expect(p.calls[0].system).toMatch(/Нормы, сроки годности, температуры/);
    expect(p.calls[0].user).toContain(RULE_TEXT);
    expect(p.calls[0].user).toContain('7,5 °C');
  });

  it('число, которого нет в данных и источниках, — ответ отклонён проверкой и не показывается', async () => {
    setAiProvider(fake({ do_now: ['Хранить мясо при +2 °C не более 48 часов'] }));
    const r = await explainIncident(haccp.id, orgId, incidentId);
    expect(r.status).toBe('guard_rejected');
    expect(r.answer).toBeNull();
    expect(r.unsupported).toEqual(expect.arrayContaining(['48 часов']));
    expect(checkAnswer({ ...(r as never as { answer: AiAnswer }).answer ?? {}, found: 'x', why: 'x', do_now: ['Выдержать 99 минут', 'Охладить до 3 °С'], dont: [], who_confirms: 'x', closes_when: 'x', citations: [], limitations: 'x', confidence: 'low' } as AiAnswer, [], {}).unsupported).toEqual(['99 минут', '3 °С']);
    expect(r.message).toMatch(/отклонён проверкой/);
  });

  it('цитата, которой нет в тексте источника, — убирается и показывается как недостоверная', async () => {
    setAiProvider(fake({ citations: [{ source: 'S1', quote: 'мясо можно хранить сутки' }, { source: 'S9', quote: 'x' }] }));
    const r = await explainIncident(haccp.id, orgId, incidentId);
    expect(r.status).toBe('ok');
    expect(r.citations).toEqual([]);
    expect(r.bad_citations.map((b) => b.reason)).toEqual(['цитаты нет в тексте источника', 'нет такого источника']);
  });

  it('без источника по вопросу — модель не вызывается; без ключа — показываются найденные требования; отказ модели фиксируется', async () => {
    const p = fake({});
    setAiProvider(p);
    const none = await askQuestion(cook.id, orgId, { question: 'Как часто менять масло во фритюрнице?' });
    expect(none.status).toBe('no_sources');
    expect(p.calls).toHaveLength(0);
    // В вопросе нет данных об отклонении: «15 минут» из процедуры объекта здесь не подтверждено — ответ отклоняется.
    expect((await askQuestion(cook.id, orgId, { question: 'При какой температуре хранить охлаждённое мясо?' })).status).toBe('guard_rejected');
    setAiProvider(fake({ do_now: ['Хранить мясо в камере в пределах, указанных в процедуре ПК-03'] }));
    const q = await askQuestion(cook.id, orgId, { question: 'При какой температуре хранить охлаждённое мясо?' });
    expect(q.status).toBe('ok');
    expect(q.citations[0]).toMatchObject({ code: 'ПК-03', quote: 'от 0 до +4 °C' });
    setAiProvider(null);
    const off = await askQuestion(cook.id, orgId, { question: 'При какой температуре хранить охлаждённое мясо?' });
    expect(off).toMatchObject({ status: 'unavailable', answer: null });
    expect(off.sources[0]).toMatchObject({ code: 'ПК-03', text: RULE_TEXT });
    setAiProvider(fake('refuse'));
    expect((await explainIncident(haccp.id, orgId, incidentId)).status).toBe('refused');
  });

  it('проверка чисел не «разрешает» значения по датам и идентификаторам', () => {
    const a = { found: 'x', why: 'x', do_now: ['Хранить 21 день'], dont: [], who_confirms: 'x', closes_when: 'x', citations: [], limitations: 'x', confidence: 'low' } as AiAnswer;
    expect(checkAnswer(a, [], { время: '2026-10-21T10:00:00Z' }).unsupported).toEqual(['21 день']);
  });
});

describe('Предложение → задача только по решению человека; журнал', () => {
  let jobId: string;

  it('принять действие — задача; повторно — нельзя; отклонить — с причиной; по отклонённому ответу — нельзя', async () => {
    setAiProvider(fake({}));
    jobId = (await explainIncident(haccp.id, orgId, incidentId)).job_id;
    const r = await decide(haccp.id, orgId, jobId, { itemIndex: 1, decision: 'task_created', assigneeRole: 'line_staff' });
    const task = (await listTasks(cook.id, orgId)).find((t) => t.id === r.task_id)!;
    expect(task).toMatchObject({ kind: 'ai_action', title: 'Проверить дверь и уплотнитель', assignee_role: 'line_staff', details: expect.stringContaining('принято человеком') });
    await expect(decide(haccp.id, orgId, jobId, { itemIndex: 1, decision: 'task_created' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(decide(haccp.id, orgId, jobId, { itemIndex: 0, decision: 'rejected' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await decide(haccp.id, orgId, jobId, { itemIndex: 0, decision: 'rejected', note: 'замер уже повторили' });
    await decide(cook.id, orgId, jobId, { decision: 'helpful' });
    setAiProvider(fake({ do_now: ['Выдержать 99 минут'] }));
    const bad = await explainIncident(haccp.id, orgId, incidentId);
    await expect(decide(haccp.id, orgId, bad.job_id, { itemIndex: 0, decision: 'task_created' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('журнал: модель, версия инструкции, входные данные, источники, решения; журнал неизменяем', async () => {
    const j = await getJob(auditor.id, orgId, jobId);
    expect(j).toMatchObject({ model: 'test-model', prompt_version: expect.stringMatching(/^ceh-ai-/), context: expect.objectContaining({ отклонение: expect.any(Object) }) });
    expect(j.decisions.map((d) => d.decision)).toEqual(['task_created', 'rejected', 'helpful']);
    expect((await listJobs(auditor.id, orgId)).length).toBeGreaterThanOrEqual(6);
    await expect(listJobs(cook.id, orgId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await listJobs(cook.id, orgId, { mine: true })).every((x) => x.user_name)).toBe(true);
    await expect(getJob(cook.id, orgId, jobId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(withSystem((tx) => tx.query(`update ai_jobs set status = 'ok' where id = $1`, [jobId]))).rejects.toThrow(/не изменяется/);
  });

  it('изоляция: чужая площадка и чужая организация', async () => {
    setAiProvider(fake({}));
    await expect(explainIncident(cook2.id, orgId, incidentId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(explainIncident(stranger.id, orgId, incidentId)).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) });
  });
});
