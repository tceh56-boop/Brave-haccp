import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation, listMembers, changeMember } from '../src/server/org/organizations';
import { canAssignRole, ROLES, type Role } from '../src/server/access/roles';
import { makeUser, lastLinkToken } from './helpers';

/** Этап 0 промта доработки, вопрос 1: HR назначает только согласованные владельцем роли (белый список). */

afterAll(() => closePool());
type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, hr: U, orgId: string;
const HR_ALLOWED: Role[] = ['line_staff', 'cashier', 'storekeeper', 'chef'];   // решение владельца 03.11.2026

beforeAll(async () => {
  owner = await makeUser();
  orgId = (await createOrganization(owner, { name: 'Цех ролей' })).organization.id;
  hr = await makeUser();
  await inviteMember(owner.id, orgId, { email: hr.email, role: 'hr' });
  await acceptInvitation(hr, await lastLinkToken(hr.email, 'invitation'));
});

describe('Белый список ролей для HR', () => {
  it('HR назначает только сотрудника цеха, кассира, кладовщика и шефа', () => {
    for (const r of Object.keys(ROLES) as Role[]) expect([r, canAssignRole('hr', r)]).toEqual([r, HR_ALLOWED.includes(r)]);
  });

  it('приглашение и смена роли HR — по белому списку; сотрудника вне списка HR не меняет', async () => {
    const u = await makeUser();
    await expect(inviteMember(hr.id, orgId, { email: u.email, role: 'director' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(inviteMember(hr.id, orgId, { email: u.email, role: 'technologist' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await inviteMember(hr.id, orgId, { email: u.email, role: 'line_staff' });
    await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
    const m = (await listMembers(owner.id, orgId)).find((x: { user_id: string }) => x.user_id === u.id)!;
    await expect(changeMember(hr.id, orgId, m.id, { role: 'director' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await changeMember(hr.id, orgId, m.id, { role: 'chef' });
    // директора, назначенного владельцем, HR изменить не может
    const d = await makeUser();
    await inviteMember(owner.id, orgId, { email: d.email, role: 'director' });
    await acceptInvitation(d, await lastLinkToken(d.email, 'invitation'));
    const dm = (await listMembers(owner.id, orgId)).find((x: { user_id: string }) => x.user_id === d.id)!;
    await expect(changeMember(hr.id, orgId, dm.id, { role: 'line_staff' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
