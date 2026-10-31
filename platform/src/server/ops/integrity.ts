import type { Tx } from '../db/pool';
import { withSystem } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';

/**
 * Целостность утверждённых документов (ТЗ доработки, 11.3). Снимок сверяется с content_hash, который база посчитала при
 * утверждении. Расхождение — документ не выдаётся как достоверный: отказ, событие безопасности в аудите (пишется
 * отдельно, чтобы отказ его не откатил), экспорт и печать блокируются.
 */
export const SNAPSHOT_TABLES = { ppk_versions: 'программа производственного контроля', tech_spec_versions: 'технические условия', sto_versions: 'стандарт организации', ti_versions: 'технологическая инструкция' } as const;

export async function assertSnapshotIntact(tx: Tx, table: keyof typeof SNAPSHOT_TABLES, id: string, ctx: { orgId: string; userId: string }) {
  const r = (await tx.query(`select content_hash, snapshot_hash(snapshot) as actual, generator_version from ${table} where id = $1`, [id])).rows[0];
  if (!r) throw Errors.notFound('Документ не найден.');
  if (r.content_hash === r.actual) return { content_hash: r.content_hash as string, generator_version: r.generator_version as string };
  await withSystem((t) => audit.record(t, { organizationId: ctx.orgId, actorUserId: ctx.userId, action: 'security.snapshot_mismatch', entityType: table, entityId: id,
    after: { expected: r.content_hash, actual: r.actual } }));
  throw Errors.conflict(`Документ «${SNAPSHOT_TABLES[table]}» не прошёл проверку целостности: содержимое не совпадает с утверждённым (хеш). Выдача и экспорт заблокированы, событие записано в аудит.`);
}
