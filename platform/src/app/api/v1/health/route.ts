import { NextResponse } from 'next/server';
import { getPool } from '@/server/db/pool';

/** Проверка состояния для мониторинга: база отвечает, миграции применены. Без подробностей наружу. */
export async function GET() {
  try {
    const r = (await getPool().query(`select count(*)::int as migrations, max(name) as last from schema_migrations`)).rows[0];
    return NextResponse.json({ status: 'ok', db: 'ok', migrations: r.migrations, last_migration: r.last, time: new Date().toISOString() }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ status: 'error', db: 'unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
