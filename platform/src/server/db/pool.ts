import { Pool, type PoolClient } from 'pg';

/**
 * Подключение к PostgreSQL.
 *
 * Две формы транзакции:
 *  - withSystem — под владельцем схемы, без Row-Level Security. Только для операций до входа
 *    и служебных шагов (вход по email, подтверждение, приглашение по ссылке, создание организации).
 *  - withTenant — под ролью ceh_app с контекстом пользователя и организации: база сама скрывает
 *    строки чужих организаций (второй слой изоляции после проверки прав на сервере).
 */

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL не задан');
    pool = new Pool({ connectionString, max: Number(process.env.DB_POOL_MAX || 10) });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) { await pool.end(); pool = null; }
}

export type Tx = PoolClient;

async function inTransaction<T>(setup: (c: PoolClient) => Promise<void>, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    await setup(client);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inTransaction(async () => undefined, fn);
}

export interface TenantContext {
  userId: string;
  orgId?: string | null;
}

export function withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inTransaction(async (c) => {
    await c.query('set local role ceh_app');
    await c.query("select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [ctx.userId, ctx.orgId || '']);
  }, fn);
}
