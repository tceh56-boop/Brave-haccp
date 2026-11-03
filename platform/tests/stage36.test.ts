import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation, updateOrganization, getOrganization } from '../src/server/org/organizations';
import { createDish } from '../src/server/ops/recipes';
import { openShift, closeShift, getMenu, createOrder, addOrderLine, payOrder, setStop } from '../src/server/ops/pos';
import { makeUser, lastLinkToken } from './helpers';
import { randomUUID } from 'node:crypto';

/** ТЗ 3.0 §1.4, §12.6: касса — необязательный модуль организации, по умолчанию выключен. */

afterAll(() => closePool());
type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, chef: U, cashier: U, orgId: string, siteId: string, dish: string, tea: string;

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}
const denials = async () => (await withSystem((tx) => tx.query(`select action, reason from audit_events where organization_id = $1 and result = 'denied' order by created_at`, [orgId]))).rows;

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кафе «Без кассы»' });
  orgId = r.organization.id; siteId = r.site.id;
  chef = await invite('chef'); cashier = await invite('cashier');
  dish = (await createDish(chef.id, orgId, { name: 'Морс', salePrice: 150 })).id;
  tea = (await createDish(chef.id, orgId, { name: 'Чай', salePrice: 150 })).id;
});

describe('Модуль «Касса и зал»', () => {
  it('новая организация — касса выключена: операции запрещены на сервере, права кассы не выдаются, стоп-лист работает', async () => {
    const o = await getOrganization(cashier.id, orgId);
    expect(o.organization.modules).toEqual([]);
    expect(o.membership.permissions).not.toContain('pos.sell');
    await expect(openShift(cashier.id, orgId, { siteId, cashStart: 0 })).rejects.toMatchObject({ code: 'FORBIDDEN', message: expect.stringMatching(/Модуль «Касса и зал» выключен/) });
    await expect(getMenu(cashier.id, orgId, siteId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await denials()).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'pos.sell', reason: 'модуль pos выключен' })]));
    await setStop(chef.id, orgId, { siteId, dishId: dish, reason: 'нет клюквы' });          // стоп-лист — кухонная функция, не касса
  });

  it('включает только право org.update; выключение при открытой смене запрещено; история остаётся', async () => {
    await expect(updateOrganization(chef.id, orgId, { modules: ['pos'] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(updateOrganization(owner.id, orgId, { modules: ['bar'] })).rejects.toThrow(/Неизвестный модуль/);
    await updateOrganization(owner.id, orgId, { modules: ['pos'] });
    expect((await getOrganization(cashier.id, orgId)).membership.permissions).toContain('pos.sell');
    await openShift(cashier.id, orgId, { siteId, cashStart: 0 });
    const order = await createOrder(cashier.id, orgId, { siteId });
    await addOrderLine(cashier.id, orgId, order.order.id, { dishId: tea });
    await payOrder(cashier.id, orgId, order.order.id, { payments: [{ method: 'card', amount: 150 }], operationId: randomUUID() });
    await expect(updateOrganization(owner.id, orgId, { modules: [] })).rejects.toThrow(/открыта смена кассы.*Закройте смену/);
    await closeShift(cashier.id, orgId, { siteId, cashFact: 0 });
    await updateOrganization(owner.id, orgId, { modules: [] });
    await expect(openShift(cashier.id, orgId, { siteId, cashStart: 0 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const kept = (await withSystem((tx) => tx.query(`select count(*)::int as n from pos_orders where organization_id = $1 and status = 'paid'`, [orgId]))).rows[0].n;
    expect(kept).toBe(1);
    const log = (await withSystem((tx) => tx.query(`select before, after from audit_events where organization_id = $1 and action = 'org.modules' order by created_at`, [orgId]))).rows;
    expect(log).toEqual([{ before: { modules: [] }, after: { modules: ['pos'] } }, { before: { modules: ['pos'] }, after: { modules: [] } }]);
  });
});
