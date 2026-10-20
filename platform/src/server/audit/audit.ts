import { withSystem, type Tx } from '../db/pool';

export interface AuditEvent {
  organizationId?: string | null;
  siteId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  result?: 'success' | 'denied' | 'error';
  ip?: string | null;
}

const INSERT = `insert into audit_events
  (organization_id, site_id, actor_user_id, action, entity_type, entity_id, before, after, reason, result, ip, prev_hash, hash)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, '', '')`;

function params(e: AuditEvent) {
  return [e.organizationId || null, e.siteId || null, e.actorUserId || null, e.action, e.entityType || null, e.entityId || null,
    e.before === undefined ? null : JSON.stringify(e.before), e.after === undefined ? null : JSON.stringify(e.after),
    e.reason || null, e.result || 'success', e.ip || null];
}

// Секреты в аудит не попадают ни при каких обстоятельствах.
const SECRET_KEYS = /pass|token|secret|hash/i;
export function redact<T>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) out[k] = SECRET_KEYS.test(k) ? '[скрыто]' : v;
  return out as T;
}

export const audit = {
  /** Запись в той же транзакции, что и действие: откат действия откатывает и запись. */
  async record(tx: Tx, e: AuditEvent): Promise<void> {
    await tx.query(INSERT, params({ ...e, before: redact(e.before), after: redact(e.after) }));
  },

  /** Отказ в доступе — отдельной транзакцией, чтобы попытка не потерялась при откате. */
  async denied(e: AuditEvent): Promise<void> {
    await withSystem((tx) => tx.query(INSERT, params({ ...e, result: 'denied' })));
  },

  /** Проверка цепочки организации: пересчёт хешей по порядку записей. */
  async verifyChain(tx: Tx, organizationId: string | null): Promise<{ ok: boolean; checked: number; brokenAt?: number }> {
    const rows = (await tx.query<{ id: string; prev_hash: string; hash: string; calc: string }>(
      `select id, prev_hash, hash, encode(sha256(convert_to(audit_chain_payload(e), 'UTF8')), 'hex') as calc
         from audit_events e where organization_id is not distinct from $1 order by id`, [organizationId])).rows;
    let prev = 'GENESIS';
    for (const r of rows) {
      if (r.prev_hash !== prev || r.hash !== r.calc) return { ok: false, checked: rows.length, brokenAt: Number(r.id) };
      prev = r.hash;
    }
    return { ok: true, checked: rows.length };
  },
};
