import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation, createSite, setMemberBlocked } from '../src/server/org/organizations';
import { getSession } from '../src/server/identity/auth';
import { pinProblem, enrollDevice, listDevices, revokeDevice, setMyPin, myPinState, resetPin, kioskRoster, kioskLogin } from '../src/server/identity/kiosk';
import { GET as pinGET } from '../src/app/api/v1/orgs/[orgId]/pin/route';
import { makeUser, lastLinkToken } from './helpers';

/** Вход на кухне по PIN (вариант А: перенос с Google Диска), только на привязанном планшете. */

afterAll(() => closePool());
type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, cook: U, chef: U, other: U, orgId: string, siteId: string, site2: string, device: string, deviceId: string, otherOrg: string;

async function invite(role: string, siteIds: string[] = []) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role, siteIds });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}
const memberId = async (userId: string) => (await withSystem((tx) => tx.query(`select id from memberships where organization_id = $1 and user_id = $2`, [orgId, userId]))).rows[0].id;
const unlock = (userId: string) => withSystem((tx) => tx.query(`update member_pins set locked_until = now() - interval '1 second' where user_id = $1`, [userId]));

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кухня планшета' });
  orgId = r.organization.id; siteId = r.site.id;
  site2 = (await createSite(owner.id, orgId, { name: 'Вторая точка' })).id;
  cook = await invite('line_staff'); chef = await invite('chef'); other = await invite('line_staff', [site2]);
  otherOrg = (await createOrganization(cook, { name: 'Своё кафе повара' })).organization.id;
});

describe('PIN и кухонный планшет', () => {
  it('слабые PIN не принимаются', () => {
    for (const p of ['123', '1234', '0000', '98765', '12a4', '1234567']) expect(pinProblem(p)).not.toBeNull();
    for (const p of ['4719', '250683']) expect(pinProblem(p)).toBeNull();
  });

  it('привязать планшет может только владелец (право device.manage); токен не выдаётся в списке', async () => {
    await expect(enrollDevice(cook.id, orgId, { siteId, name: 'Планшет горячего цеха' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(enrollDevice(chef.id, orgId, { siteId, name: 'Планшет горячего цеха' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const r = await enrollDevice(owner.id, orgId, { siteId, name: 'Планшет горячего цеха' });
    device = r.token; deviceId = r.device.id;
    expect(device.length).toBeGreaterThan(30);
    const list = await listDevices(owner.id, orgId);
    expect(list[0]).toMatchObject({ name: 'Планшет горячего цеха', site: expect.any(String), revoked_at: null });
    expect(JSON.stringify(list)).not.toContain(device);
  });

  it('на планшете — только сотрудники площадки с заданным PIN; без cookie устройства — пусто', async () => {
    expect(await kioskRoster(null)).toEqual({ device: null, people: [] });
    expect(await kioskRoster('чужой-токен')).toEqual({ device: null, people: [] });
    await expect(setMyPin(cook.id, orgId, { pin: '1111' })).rejects.toThrow(/одинаковых/);
    await setMyPin(cook.id, orgId, { pin: '4719' });
    await setMyPin(other.id, orgId, { pin: '5820' });   // сотрудник другой площадки
    expect(await myPinState(cook.id, orgId)).toMatchObject({ has_pin: true, locked: false });
    const r = await kioskRoster(device);
    expect(r.device).toMatchObject({ name: 'Планшет горячего цеха', organization: 'Кухня планшета' });
    expect(r.people.map((p) => p.id)).toEqual([cook.id]);   // шеф без PIN и сотрудник другой площадки не видны
    expect(r.people[0].role_label).toBe('Сотрудник цеха');
  });

  it('PIN только с привязанного планшета; неверный PIN — лестница блокировок 15 мин → 1 ч', async () => {
    await expect(kioskLogin(null, { userId: cook.id, pin: '4719' }, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(kioskLogin(device, { userId: other.id, pin: '5820' }, {})).rejects.toThrow(/Неверный PIN/);   // нет доступа к площадке
    for (let i = 1; i <= 4; i++) await expect(kioskLogin(device, { userId: cook.id, pin: '0001' }, {})).rejects.toThrow(new RegExp(`Осталось попыток: ${5 - i}`));
    await expect(kioskLogin(device, { userId: cook.id, pin: '0001' }, {})).rejects.toThrow(/заблокирован на 15 мин/);
    await expect(kioskLogin(device, { userId: cook.id, pin: '4719' }, {})).rejects.toThrow(/заблокирован до/);   // верный PIN во время блокировки не пускает
    await unlock(cook.id);
    for (let i = 1; i <= 4; i++) await kioskLogin(device, { userId: cook.id, pin: '0002' }, {}).catch(() => undefined);
    await expect(kioskLogin(device, { userId: cook.id, pin: '0002' }, {})).rejects.toThrow(/заблокирован на 1 ч/);
    await unlock(cook.id);
  });

  it('вход по PIN: сессия 12 ч только в организации планшета; задать PIN и управлять планшетами из неё нельзя', async () => {
    const r = await kioskLogin(device, { userId: cook.id, pin: '4719' }, { ip: '10.1.1.1' });
    expect(r).toMatchObject({ orgId, siteId });
    const s = await getSession(r.token);
    expect(s).toMatchObject({ orgScope: orgId, user: { id: cook.id } });
    const exp = (await withSystem((tx) => tx.query(`select extract(epoch from expires_at - created_at) / 3600 as h from sessions where id = $1`, [s!.sessionId]))).rows[0].h;
    expect(Number(exp)).toBeCloseTo(12, 1);
    const call = (org: string) => pinGET(new NextRequest(`http://test.local/api/v1/orgs/${org}/pin`, { headers: { cookie: `ceh_session=${r.token}` } }), { params: Promise.resolve({ orgId: org }) });
    expect((await (await call(orgId)).json()).ok).toBe(true);
    const foreign = await (await call(otherOrg)).json();   // своя другая организация повара — не из сессии планшета
    expect(foreign).toMatchObject({ ok: false, error: { code: 'FORBIDDEN', message: expect.stringMatching(/только в организации этого планшета/) } });
    // ошибки сбрасываются после успешного входа
    expect((await withSystem((tx) => tx.query(`select failed, lock_level from member_pins where user_id = $1`, [cook.id]))).rows[0]).toEqual({ failed: 0, lock_level: 0 });
  });

  it('сброс PIN руководителем закрывает сессии планшета; заблокированный сотрудник исчезает из списка', async () => {
    const r = await kioskLogin(device, { userId: cook.id, pin: '4719' }, {});
    await expect(resetPin(cook.id, orgId, chef.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await resetPin(owner.id, orgId, cook.id);
    expect(await getSession(r.token)).toBeNull();
    expect((await kioskRoster(device)).people).toEqual([]);
    await setMyPin(chef.id, orgId, { pin: '8352' });
    expect((await kioskRoster(device)).people.map((p) => p.id)).toEqual([chef.id]);
    await setMemberBlocked(owner.id, orgId, await memberId(chef.id), true, 'увольнение');
    expect((await kioskRoster(device)).people).toEqual([]);
    await expect(kioskLogin(device, { userId: chef.id, pin: '8352' }, {})).rejects.toThrow(/Неверный PIN/);
  });

  it('отвязка планшета: его сессии закрыты, вход по PIN с него невозможен', async () => {
    await setMyPin(cook.id, orgId, { pin: '4719' });
    const r = await kioskLogin(device, { userId: cook.id, pin: '4719' }, {});
    expect(await revokeDevice(owner.id, orgId, deviceId)).toMatchObject({ sessions_closed: 1 });
    expect(await getSession(r.token)).toBeNull();
    expect((await kioskRoster(device)).device).toBeNull();
    await expect(kioskLogin(device, { userId: cook.id, pin: '4719' }, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
