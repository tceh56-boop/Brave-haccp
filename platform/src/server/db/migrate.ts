import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { getPool, closePool } from './pool';

/**
 * Миграции: файлы migrations/NNN_*.sql применяются по порядку, каждый в своей транзакции.
 * В schema_migrations хранится контрольная сумма: изменённый задним числом файл останавливает
 * применение — уже применённые миграции не правят, пишут новую.
 */

const DIR = path.resolve(__dirname, '../../../migrations');

export async function migrate(log: (s: string) => void = () => undefined): Promise<string[]> {
  const pool = getPool();
  await pool.query(`create table if not exists schema_migrations (
    name text primary key, checksum text not null, applied_at timestamptz not null default now())`);
  const applied = new Map<string, string>(
    (await pool.query('select name, checksum from schema_migrations')).rows.map((r) => [r.name, r.checksum]));
  const files = readdirSync(DIR).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  const done: string[] = [];
  for (const f of files) {
    const sql = readFileSync(path.join(DIR, f), 'utf8');
    const sum = createHash('sha256').update(sql).digest('hex');
    if (applied.has(f)) {
      if (applied.get(f) !== sum) throw new Error(`Миграция ${f} изменена после применения — создайте новую миграцию`);
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migrations (name, checksum) values ($1, $2)', [f, sum]);
      await client.query('commit');
      done.push(f);
      log(`применена ${f}`);
    } catch (e) {
      await client.query('rollback');
      throw new Error(`Миграция ${f}: ${(e as Error).message}`);
    } finally {
      client.release();
    }
  }
  return done;
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  migrate((s) => console.log(s))
    .then((d) => console.log(d.length ? `готово: ${d.length}` : 'нет новых миграций'))
    .catch((e) => { console.error(e.message); process.exitCode = 1; })
    .finally(() => closePool());
}
