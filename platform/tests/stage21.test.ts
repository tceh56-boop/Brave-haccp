import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { getCompliance } from '../src/server/ops/compliance';
import { saveProfile } from '../src/server/ops/regulatory';
import { createControlObject } from '../src/server/ops/control';
import { recordMeasurement } from '../src/server/ops/measurements';
import { recordHealthCheck } from '../src/server/ops/staff';
import { CLAUSES, DOCS } from '../src/server/norms/library';
import { CHECK_KEYS } from '../src/server/norms/checks';
import { makeUser, lastLinkToken } from './helpers';

/** Встроенная нормативная база: применимость по профилю, проверки по данным, ссылки на пункты. */

afterAll(() => closePool());

type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, cook: U, orgId: string, siteId: string;
const item = async (id: string) => (await getCompliance(owner.id, orgId)).items.find((i) => i.id === id);

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кафе «Нормы»' });
  orgId = r.organization.id; siteId = r.site.id;
  cook = await makeUser();
  await inviteMember(owner.id, orgId, { email: cook.email, role: 'line_staff' });
  await acceptInvitation(cook, await lastLinkToken(cook.email, 'invitation'));
});

describe('Нормативная библиотека', () => {
  it('у каждого пункта — документ, пункт, текст; у проверки — реализация', () => {
    for (const c of CLAUSES) {
      expect(DOCS[c.doc], c.id).toBeTruthy();
      expect(c.text.length, c.id).toBeGreaterThan(40);
      if (c.check) expect(CHECK_KEYS, c.id).toContain(c.check);
    }
    expect(DOCS.sanpin4282.effectiveFrom).toBe('2026-09-01');
  });

  it('суточная проба для кафе не требуется; для медицинской организации — требуется (п. 56 пп. 4)', async () => {
    let c = await getCompliance(owner.id, orgId);
    expect(c.items.find((i) => i.id === 'sanpin4282:56.4')).toBeUndefined();
    expect(c.not_applicable.map((i) => i.id)).toContain('sanpin4282:56.4');
    await saveProfile(owner.id, orgId, { objectTypes: ['hospital'] });
    c = await getCompliance(owner.id, orgId);
    expect(c.items.find((i) => i.id === 'sanpin4282:56.4')!.status).toBe('fail');   // параметры проб не утверждены
    await saveProfile(owner.id, orgId, { objectTypes: ['cafe'], seats: 20, features: ['fryer'] });
    expect((await item('sanpin4282:56.4'))).toBeUndefined();
    expect((await item('sanpin4282:44'))!.status).toBe('fail');                       // фритюр есть — журнала нет
  });

  it('нет плана ХАССП — нарушение п. 4 со ссылкой и путём исправления', async () => {
    const i = (await item('sanpin4282:4'))!;
    expect(i.status).toBe('fail');
    expect(i.doc).toBe('СанПиН 2.3/2.4.4282-26');
    expect(i.clause).toBe('п. 4');
    expect(i.href).toContain('/haccp');
  });

  it('ежедневная регистрация температуры (п. 35) и осмотр работавших сегодня (п. 25)', async () => {
    expect((await item('sanpin4282:35'))!.status).toBe('fail');   // объектов нет
    const o = await createControlObject(owner.id, orgId, { siteId, name: 'Холодильник', kind: 'fridge' });
    // объект создан сегодня → нужен замер за сегодня
    expect((await item('sanpin4282:35'))!.items!.join()).toMatch(/Холодильник: температура/);
    await recordMeasurement(cook.id, orgId, { controlObjectId: o.id, value: 4 });
    expect((await item('sanpin4282:35'))!.status).toBe('ok');
    // повар работал сегодня — без осмотра нарушение
    const h = (await item('sanpin4282:25'))!;
    expect(h.status).toBe('fail');
    await recordHealthCheck(owner.id, orgId, cook.id, { siteId, admitted: true });
    expect((await item('sanpin4282:25'))!.status).toBe('ok');
  });

  it('просроченная партия на остатке — нарушение п. 6', async () => {
    expect((await item('sanpin4282:6'))!.status).toBe('ok');
    await withSystem(async (tx) => {
      const p = (await tx.query(`insert into products (organization_id, name, unit) values ($1, 'Сметана', 'кг') returning id`, [orgId])).rows[0].id;
      await tx.query(`insert into lots (organization_id, site_id, product_id, quantity, unit, expires_at, expiry_basis, status) values ($1, $2, $3, 1, 'кг', now() - interval '1 day', 'маркировка', 'available')`, [orgId, siteId, p]);
    });
    const i = (await item('sanpin4282:6'))!;
    expect(i.status).toBe('fail');
    expect(i.items!.join()).toMatch(/Сметана/);
  });

  it('разъяснение Роспотребнадзора о декларировании — только при доставке, выносе, кейтеринге', async () => {
    expect(await item('rpn:declaration')).toBeUndefined();
    await saveProfile(owner.id, orgId, { objectTypes: ['cafe'], salesModes: ['hall', 'delivery'] });
    const i = (await item('rpn:declaration'))!;
    expect(i.doc_kind).toBe('Разъяснение');
    expect(i.status).toBe('onsite');
  });
});
