import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { closePool, withSystem, withTenant } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { getRecognition, setRecognition, checkConnection, usageGuard, recordUsage } from '../src/server/ops/recognition';
import { yandexStatus, yandexHeaders } from '../src/server/integrations/yandex';
import { makeUser, lastLinkToken } from './helpers';

// Реальных обращений к Yandex Cloud тест не делает: fetch подменяется.
afterAll(() => closePool());
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, chef: U, orgId: string;

beforeAll(async () => {
  owner = await makeUser();
  orgId = (await createOrganization(owner, { name: 'Кафе «Распознавание»' })).organization.id;
  chef = await makeUser();
  await inviteMember(owner.id, orgId, { email: chef.email, role: 'chef' });
  await acceptInvitation(chef, await lastLinkToken(chef.email, 'invitation'));
});

describe('Этап 17: настройка распознавания', () => {
  it('без ключей на сервере — «не настроено», включить нельзя; ключи не показываются', async () => {
    vi.stubEnv('YANDEX_API_KEY', ''); vi.stubEnv('YANDEX_FOLDER_ID', '');
    const r = await getRecognition(owner.id, orgId);
    expect(r.server).toMatchObject({ configured: false, missing: ['YANDEX_API_KEY', 'YANDEX_FOLDER_ID'] });
    expect(r.settings).toMatchObject({ enabled: false, monthly_pages: 200 });
    await expect(setRecognition(owner.id, orgId, { enabled: true, kinds: ['torg12'], monthlyPages: 100 })).rejects.toThrow(/не заданы ключи/);
    await expect(getRecognition(chef.id, orgId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(() => yandexHeaders()).toThrow(/не настроено/);
  });

  it('с ключами: включение, виды, лимит; в статусе — маска каталога, без ключа', async () => {
    vi.stubEnv('YANDEX_API_KEY', 'AQVN-секрет-ключа'); vi.stubEnv('YANDEX_FOLDER_ID', 'b1gabcdef12345');
    const st = yandexStatus();
    expect(st).toMatchObject({ configured: true, auth: 'api_key', folder: 'b1ga…345', model: 'yandexgpt/latest', llm: true });
    expect(JSON.stringify(st)).not.toMatch(/секрет/);
    expect(yandexHeaders()).toMatchObject({ authorization: 'Api-Key AQVN-секрет-ключа', 'x-folder-id': 'b1gabcdef12345' });
    await setRecognition(owner.id, orgId, { enabled: true, kinds: ['torg12', 'fiscal_qr'], monthlyPages: 3 });
    await withTenant({ userId: owner.id, orgId }, async (tx) => {
      await usageGuard(tx, orgId, 'torg12', 2);
      await expect(usageGuard(tx, orgId, 'banquet', 1)).rejects.toThrow(/не включено/);
      await recordUsage(tx, { orgId, kind: 'torg12', pages: 2, tokens: 900, status: 'ok', userId: owner.id });
      await expect(usageGuard(tx, orgId, 'torg12', 2)).rejects.toThrow(/Лимит распознавания на месяц исчерпан: 2 из 3/);
    });
    const r = await getRecognition(owner.id, orgId);
    expect(r.pages_used).toBe(2);
    await expect(withSystem((tx) => tx.query(`update recognition_usage set pages = 0 where organization_id = $1`, [orgId]))).rejects.toThrow(/не изменяется/);
  });

  it('проверка подключения — только с подтверждением платного запроса; результат учитывается', async () => {
    vi.stubEnv('YANDEX_API_KEY', 'AQVN-ключ'); vi.stubEnv('YANDEX_FOLDER_ID', 'b1gabcdef12345');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: { alternatives: [{ message: { text: 'готово' } }], usage: { totalTokens: '21' } } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(checkConnection(owner.id, orgId, {})).rejects.toThrow(/подтвердите/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await checkConnection(owner.id, orgId, { confirmPaid: true })).toEqual({ ok: true, tokens: 21 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://llm.api.cloud.yandex.net/foundationModels/v1/completion');
    expect(JSON.parse(String(init.body))).toMatchObject({ modelUri: 'gpt://b1gabcdef12345/yandexgpt/latest', completionOptions: { temperature: 0 } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'Permission denied' }), { status: 403 })));
    await expect(checkConnection(owner.id, orgId, { confirmPaid: true })).rejects.toThrow(/Подключение не работает: YandexGPT: 403 Permission denied/);
    const u = (await getRecognition(owner.id, orgId)).usage.find((x) => x.kind === 'check')!;
    expect(u).toMatchObject({ calls: 2, failed: 1, tokens: 21 });
  });
});
