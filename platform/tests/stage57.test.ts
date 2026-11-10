import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation, setMemberBlocked } from '../src/server/org/organizations';
import { createControlObject, createRule, approveRule } from '../src/server/ops/control';
import { recordMeasurement } from '../src/server/ops/measurements';
import { YandexProvider, setAiProvider } from '../src/server/ops/ai';
import { createLinkCode, telegramStatus, handleUpdate, deliverNotifications } from '../src/server/telegram/bot';
import { makeUser, lastLinkToken } from './helpers';

/** Telegram-бот «ЦЕХ ИИ» и помощник на YandexGPT. Обращений к Telegram и Yandex Cloud нет: отправка и fetch подменены. */

afterAll(() => closePool());
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); setAiProvider(undefined); });
type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, cook: U, haccp: U, orgId: string, siteId: string, fridge: string;
const sent: { chat: number; text: string }[] = [];
const deliver = async (chat: number, text: string) => { sent.push({ chat, text }); };
const msg = (chat: number, text: string, type = 'private') => handleUpdate({ update_id: 1, message: { chat: { id: chat, type }, from: { username: `u${chat}` }, text } }, deliver);
const COOK = 7001, HACCP = 7002, STRANGER = 7999;

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кухня бота' });
  orgId = r.organization.id; siteId = r.site.id;
  cook = await invite('line_staff'); haccp = await invite('haccp_lead');
  fridge = (await createControlObject(owner.id, orgId, { siteId, name: 'Холодильник рыбы', kind: 'fridge' })).id;
  await approveRule(haccp.id, orgId, (await createRule(haccp.id, orgId, { controlObjectId: fridge, minValue: 0, maxValue: 4, frequencyHours: 4, sourceRef: 'ППК, раздел 4 (тест)' })).id);
});

describe('Привязка чата', () => {
  it('без привязки бот ничего не показывает; группам отказывает; код одноразовый', async () => {
    expect(await msg(STRANGER, '/smena')).toMatch(/Чат не привязан/);
    expect(await msg(STRANGER, 'Какая температура хранения рыбы?')).toMatch(/Чат не привязан/);
    expect(await msg(STRANGER, '/smena', 'group')).toMatch(/только в личном чате/);
    expect(await msg(COOK, '/start НЕВЕРНЫЙ')).toMatch(/Код не подошёл/);
    const c = await createLinkCode(cook.id, orgId);
    expect(c.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(JSON.stringify((await withSystem((tx) => tx.query(`select code_hash from telegram_link_codes where user_id = $1`, [cook.id]))).rows)).not.toContain(c.code);   // в базе только хеш
    expect(await msg(COOK, `/start ${c.code.toLowerCase()}`)).toMatch(/Чат привязан к «Кухня бота»/);
    expect(await msg(STRANGER, `/start ${c.code}`)).toMatch(/Код не подошёл/);   // повторно код не работает
    expect(await telegramStatus(cook.id, orgId)).toMatchObject({ linked: true, username: 'u7001' });
  });
});

describe('Команды — от имени сотрудника, с его правами', () => {
  it('/smena — карточки смены; /problems — отклонения; вопрос без источника в реестре — модель не вызывается', async () => {
    expect(await msg(COOK, '/smena')).toMatch(/🔴 Просрочено[\s\S]*Температура: Холодильник рыбы/);
    expect(await msg(COOK, '/problems')).toBe('Открытых отклонений нет.');
    let called = 0;
    setAiProvider({ name: 'fake', model: 'fake', generate: async () => { called++; return { output: null, model: 'fake' }; } });
    expect(await msg(COOK, 'Сколько хранить суточную пробу?')).toMatch(/нет утверждённого требования/);
    expect(called).toBe(0);
    expect(await msg(COOK, '/unknown')).toMatch(/Не знаю такой команды/);
  });
});

describe('Уведомления', () => {
  it('отклонение уходит в Telegram только привязанным с нужной ролью и один раз', async () => {
    await msg(HACCP, `/start ${(await createLinkCode(haccp.id, orgId)).code}`);
    sent.length = 0;
    await recordMeasurement(cook.id, orgId, { controlObjectId: fridge, value: 9 });   // вне предела → отклонение ответственному ХАССП
    expect(await deliverNotifications(deliver)).toBeGreaterThan(0);
    expect(sent.every((s) => s.chat === HACCP)).toBe(true);                          // повару это уведомление не адресовано
    expect(sent[0].text).toMatch(/Холодильник рыбы/);
    expect(sent[0].text).toMatch(new RegExp(`/app/${orgId}/incidents/`));
    expect(await deliverNotifications(deliver)).toBe(0);                             // повторно не отправляется
    expect(await msg(HACCP, '/problems')).toMatch(/Открытые отклонения: 1/);
  });

  it('/stop отвязывает чат; заблокированный сотрудник теряет доступ через бота сразу', async () => {
    expect(await msg(HACCP, '/stop')).toMatch(/Чат отвязан/);
    expect(await telegramStatus(haccp.id, orgId)).toMatchObject({ linked: false });
    const mid = (await withSystem((tx) => tx.query(`select id from memberships where organization_id = $1 and user_id = $2`, [orgId, cook.id]))).rows[0].id;
    await setMemberBlocked(owner.id, orgId, mid, true, 'увольнение');
    expect(await msg(COOK, '/smena')).toMatch(/Чат не привязан/);
  });
});

describe('Помощник на YandexGPT', () => {
  it('ответ модели — JSON по схеме (в том числе в ```json); мусор — не ответ, а отказ формата', async () => {
    vi.stubEnv('YANDEX_API_KEY', 'AQVN-тест'); vi.stubEnv('YANDEX_FOLDER_ID', 'b1gtest00000');
    const answer = { found: 'Температура выше предела', why: 'Риск роста микроорганизмов', do_now: ['Переложить продукцию'], dont: ['Не использовать до решения'], who_confirms: 'Ответственный ХАССП',
      closes_when: 'Замер в пределах', citations: [{ source: 'S1', quote: 'не выше 4' }], limitations: 'Нет данных о времени', confidence: 'medium' };
    const reply = (text: string) => vi.fn(async (_u: unknown, init?: { body?: string }) => { expect(JSON.parse(init!.body!).modelUri).toBe('gpt://b1gtest00000/yandexgpt/latest');
      return new Response(JSON.stringify({ result: { alternatives: [{ message: { text } }], usage: { totalTokens: '321' } } }), { status: 200 }); });
    vi.stubGlobal('fetch', reply('```json\n' + JSON.stringify(answer) + '\n```'));
    const ok = await new YandexProvider().generate({ system: 'S', user: 'U' });
    expect(ok).toMatchObject({ output: answer, model: 'yandexgpt/latest', usage: { total_tokens: 321 } });
    vi.stubGlobal('fetch', reply('Конечно! Вот ответ: температура должна быть ниже.'));
    expect((await new YandexProvider().generate({ system: 'S', user: 'U' })).output).toBeNull();
  });
});
