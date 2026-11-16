import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { closePool, withSystem } from '../src/server/db/pool';
import { clientIp } from '../src/server/http/route';
import { login } from '../src/server/identity/auth';
import { createOrganization, updateOrganization } from '../src/server/org/organizations';
import { once } from '../src/server/ops/stock';
import { listEvidence } from '../src/server/ops/evidence';
import { makeUser, PASSWORD } from './helpers';

/** Этап 0 промта доработки: доверенный прокси, вход по паре email+IP, повтор операции, ENTITY, очистка реквизитов. */

afterAll(() => closePool());
const req = (xff: string | null) => ({ headers: { get: (n: string) => (n === 'x-forwarded-for' ? xff : null) } });

describe('Низкие пункты аудита', () => {
  it('X-Forwarded-For — только за доверенным прокси и только адрес, дописанный прокси', () => {
    const was = process.env.TRUST_PROXY;
    delete process.env.TRUST_PROXY;
    expect(clientIp(req('6.6.6.6'))).toBeNull();                               // без прокси заголовок не учитывается
    process.env.TRUST_PROXY = '1';
    expect(clientIp(req('6.6.6.6, 203.0.113.7'))).toBe('203.0.113.7');          // подставленное клиентом значение отброшено
    expect(clientIp(req(null))).toBeNull();
    process.env.TRUST_PROXY = '2';
    expect(clientIp(req('6.6.6.6, 203.0.113.7, 10.0.0.2'))).toBe('203.0.113.7');
    if (was === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = was;
  });

  it('ограничение попыток входа — по паре email + адрес: чужие ошибки не блокируют другого пользователя', async () => {
    const victim = await makeUser();
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    for (let i = 0; i < 21; i++) await login({ email: `nobody${i}-${randomUUID()}@example.test`, password: 'x' }, { ip }).catch(() => undefined);
    expect((await login({ email: victim.email, password: PASSWORD }, { ip })).session.user.id).toBe(victim.id);
  });

  it('параллельный повтор операции с тем же ключом — один результат, без ошибки уникальности', async () => {
    const owner = await makeUser();
    const orgId = (await createOrganization(owner, { name: 'Цех повторов' })).organization.id;
    const op = randomUUID();
    let runs = 0;
    const rs = await Promise.all([1, 2, 3].map(() => withSystem((tx) => once(tx, orgId, op, 'test_op', owner.id, async () => { runs++; await new Promise((r) => setTimeout(r, 50)); return { value: 42 }; }))));
    expect(runs).toBe(1);
    expect(rs.filter((r) => (r as { repeated?: boolean }).repeated)).toHaveLength(2);
    expect(rs.every((r) => r.value === 42)).toBe(true);
  });

  it('тип записи из прототипа объекта (constructor) — отказ, а не сбой', async () => {
    const owner = await makeUser();
    const orgId = (await createOrganization(owner, { name: 'Цех типов' })).organization.id;
    await expect(listEvidence(owner.id, orgId, 'constructor', randomUUID())).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('реквизиты организации очищаются пустым значением; непереданные поля не трогаются', async () => {
    const owner = await makeUser();
    const orgId = (await createOrganization(owner, { name: 'Цех реквизитов', inn: '7700000000' })).organization.id;
    await updateOrganization(owner.id, orgId, { phone: '+7 900 000-00-00', ogrn: '1027700000000' });
    const r = await updateOrganization(owner.id, orgId, { phone: '' });
    expect(r).toMatchObject({ phone: null, ogrn: '1027700000000', inn: '7700000000', name: 'Цех реквизитов' });
  });
});
