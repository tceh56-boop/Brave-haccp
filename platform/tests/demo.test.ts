import { afterAll, describe, expect, it } from 'vitest';
import { closePool, withSystem } from '../src/server/db/pool';
import { audit } from '../src/server/audit/audit';
import { seedDemo } from '../src/server/demo/seed';

afterAll(() => closePool());

describe('Демо-организация для показа и инструкции', () => {
  it('создаётся настоящими операциями, повторный запуск ничего не дублирует, цепочка аудита цела', async () => {
    const first = await seedDemo();
    const again = await seedDemo();
    expect(again).toMatchObject({ created: false, orgId: first.orgId });
    const n = (await withSystem((tx) => tx.query(
      `select (select count(*) from organizations where id = $1)::int as orgs,
              (select count(*) from memberships where organization_id = $1)::int as members,
              (select count(*) from incidents where organization_id = $1)::int as incidents,
              (select count(*) from pos_orders where organization_id = $1)::int as orders`, [first.orgId]))).rows[0];
    expect(n).toEqual({ orgs: 1, members: 8, incidents: expect.any(Number), orders: 3 });
    expect(n.incidents).toBeGreaterThan(0);
    expect((await withSystem((tx) => audit.verifyChain(tx, first.orgId))).ok).toBe(true);
  }, 60_000);
});
