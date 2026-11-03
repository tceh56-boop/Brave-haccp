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

  /**
   * Проверка цепочки организации: каждая запись — пересчёт хеша; связь prev_hash → hash.
   * Старые записи (до chain_seq) — по связке от GENESIS; новые — строго по chain_seq без пропусков.
   */
  async verifyChain(tx: Tx, organizationId: string | null): Promise<{ ok: boolean; checked: number; brokenAt?: number }> {
    const rows = (await tx.query<{ id: string; prev_hash: string; hash: string; calc: string; chain_seq: string | null }>(
      `select id, prev_hash, hash, chain_seq, encode(sha256(convert_to(audit_chain_payload(e), 'UTF8')), 'hex') as calc
         from audit_events e where organization_id is not distinct from $1 order by chain_seq nulls first, id`, [organizationId])).rows;
    for (const r of rows) if (r.hash !== r.calc) return { ok: false, checked: rows.length, brokenAt: Number(r.id) };
    const legacy = rows.filter((r) => r.chain_seq === null), seqd = rows.filter((r) => r.chain_seq !== null);
    // старая часть: от GENESIS по ссылкам, каждая запись ровно один раз, без развилок
    const byPrev = new Map<string, typeof legacy>();
    for (const r of legacy) byPrev.set(r.prev_hash, [...(byPrev.get(r.prev_hash) || []), r]);
    let prev = 'GENESIS', walked = 0;
    while (walked < legacy.length) {
      const next = byPrev.get(prev) || [];
      if (next.length !== 1) return { ok: false, checked: rows.length, brokenAt: Number((next[1] || legacy.find((r) => !r.prev_hash) || legacy[walked])?.id ?? 0) };
      prev = next[0].hash; walked++;
    }
    // новая часть: chain_seq 1, 2, 3… и каждая ссылается на предыдущую
    for (const [i, r] of seqd.entries()) {
      if (Number(r.chain_seq) !== i + 1 || r.prev_hash !== prev) return { ok: false, checked: rows.length, brokenAt: Number(r.id) };
      prev = r.hash;
    }
    return { ok: true, checked: rows.length };
  },
};
