import { Client } from 'pg';

/** Перед прогоном: чистая тестовая база и все миграции с нуля. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL || 'postgres://ceh@localhost:54329/ceh_test';
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query('drop schema public cascade; create schema public;');
  await c.end();
  process.env.DATABASE_URL = url;
  const { migrate } = await import('../src/server/db/migrate');
  const { closePool } = await import('../src/server/db/pool');
  await migrate();
  await closePool();
}
