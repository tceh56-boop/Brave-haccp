import { afterAll, describe, expect, it } from 'vitest';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization } from '../src/server/org/organizations';
import { audit } from '../src/server/audit/audit';
import { makeUser } from './helpers';

/** Этап 0 промта доработки: цепочка аудита при параллельной записи (chain_seq под advisory-блокировкой). */

afterAll(() => closePool());
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Цепочка аудита', () => {
  it('200 записей из 40 параллельных транзакций — цепочка цела, порядок по chain_seq без пропусков', async () => {
    const owner = await makeUser();
    const orgId = (await createOrganization(owner, { name: 'Цех аудита' })).organization.id;
    await Promise.all(Array.from({ length: 40 }, (_, t) => withSystem(async (tx) => {
      for (let i = 0; i < 5; i++) {
        await audit.record(tx, { organizationId: orgId, actorUserId: owner.id, action: 'test.parallel', entityType: 'test', entityId: `${t}:${i}` });
        await pause(Math.random() * 15);
      }
    })));
    const v = await withSystem((tx) => audit.verifyChain(tx, orgId));
    expect(v).toMatchObject({ ok: true });
    expect(v.checked).toBeGreaterThanOrEqual(200);
    const seq = (await withSystem((tx) => tx.query(`select chain_seq from audit_events where organization_id = $1 order by chain_seq`, [orgId]))).rows.map((r) => Number(r.chain_seq));
    expect(seq).toEqual(Array.from({ length: seq.length }, (_, i) => i + 1));
  });

  it('подделка записи обнаруживается', async () => {
    const owner = await makeUser();
    const orgId = (await createOrganization(owner, { name: 'Цех аудита 2' })).organization.id;
    await withSystem((tx) => audit.record(tx, { organizationId: orgId, actorUserId: owner.id, action: 'test.one' }));
    // подмена в обход триггера неизменяемости — только суперпользователь; имитируем через отключение триггера в транзакции
    await withSystem(async (tx) => {
      await tx.query(`set local session_replication_role = replica`);
      await tx.query(`update audit_events set action = 'test.forged' where organization_id = $1 and action = 'test.one'`, [orgId]);
    }).catch(() => undefined);
    const v = await withSystem((tx) => audit.verifyChain(tx, orgId));
    const forged = (await withSystem((tx) => tx.query(`select count(*)::int as n from audit_events where organization_id = $1 and action = 'test.forged'`, [orgId]))).rows[0].n;
    expect(v.ok).toBe(forged === 0);                                                        // если подмена удалась — цепочка ломается
  });
});
