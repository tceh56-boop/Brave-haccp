import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { audit } from '../audit/audit';
import { withSystem } from '../db/pool';

/**
 * Резервное копирование и проверенное восстановление (ТЗ v2 AT-16, этап 8).
 *  backup  — pg_dump в одном снимке базы (--snapshot) + манифест из того же снимка: миграции с контрольными
 *            суммами, число строк каждой таблицы, длина и последний хеш цепочки аудита каждой организации,
 *            таблицы с RLS и защитные триггеры.
 *  verify  — восстановление во временную базу и сверка с манифестом: контрольная сумма файла, миграции, строки,
 *            пересчёт цепочек аудита, RLS и триггеры. Временная база удаляется всегда.
 * Копия без успешной проверки восстановления резервной копией не считается.
 */

const run = promisify(execFile);
export const BACKUP_DIR = process.env.BACKUP_DIR || path.resolve(process.cwd(), 'backups');

async function sha256File(file: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest('hex');
}

function dbUrl(name?: string) {
  const u = new URL(process.env.DATABASE_URL!);
  if (name) u.pathname = `/${name}`;
  return u.toString();
}

interface Manifest {
  database: string; taken_at: string; pg_version: string;
  migrations: { name: string; checksum: string }[];
  rows: Record<string, number>;
  audit_chains: { organization_id: string | null; length: number; last_hash: string | null; ok: boolean }[];
  rls_tables: string[]; triggers: string[];
}

async function describe(c: Client): Promise<Omit<Manifest, 'database' | 'taken_at'>> {
  const pg_version = (await c.query(`show server_version`)).rows[0].server_version;
  const migrations = (await c.query(`select name, checksum from schema_migrations order by name`)).rows;
  const tables = (await c.query(`select tablename from pg_tables where schemaname = 'public' order by tablename`)).rows.map((r) => r.tablename as string);
  const rows: Record<string, number> = {};
  for (const t of tables) rows[t] = Number((await c.query(`select count(*) from public."${t.replace(/"/g, '""')}"`)).rows[0].count);
  const audit_chains = [];
  for (const ch of (await c.query(`select organization_id, count(*)::int as length,
      (select hash from audit_events e2 where e2.organization_id is not distinct from e.organization_id order by id desc limit 1) as last_hash
    from audit_events e group by organization_id order by organization_id nulls first`)).rows) {
    // Состояние цепочки на момент снимка: копия должна воспроизвести его, а не «починить» или «сломать».
    audit_chains.push({ ...ch, ok: (await audit.verifyChain(c as never, ch.organization_id)).ok });
  }
  const rls_tables = (await c.query(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity order by relname`)).rows.map((r) => r.relname);
  const triggers = (await c.query(`select tgrelid::regclass::text || '.' || tgname as t from pg_trigger where not tgisinternal and tgrelid::regclass::text not like 'pg_%' order by 1`)).rows.map((r) => r.t);
  return { pg_version, migrations, rows, audit_chains, rls_tables, triggers };
}

/** Резервная копия: файл .dump, манифест .json рядом и запись в журнале копий. */
export async function backup(dir = BACKUP_DIR) {
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `ceh_${stamp}.dump`);
  const c = new Client({ connectionString: dbUrl() });
  await c.connect();
  try {
    // Один снимок для дампа и манифеста: числа строк и цепочки совпадают с содержимым файла.
    await c.query('begin isolation level repeatable read read only');
    const snapshot = (await c.query('select pg_export_snapshot() as s')).rows[0].s;
    const desc = await describe(c);
    await run('pg_dump', ['--format=custom', '--no-password', `--snapshot=${snapshot}`, `--file=${file}`, `--dbname=${dbUrl()}`], { maxBuffer: 1 << 26 });
    await c.query('commit');
    const manifest: Manifest = { database: new URL(dbUrl()).pathname.slice(1), taken_at: new Date().toISOString(), ...desc };
    const sha256 = await sha256File(file);
    const size = statSync(file).size;
    writeFileSync(`${file}.json`, JSON.stringify({ ...manifest, file: path.basename(file), sha256, size_bytes: size }, null, 1));
    const rec = await withSystem(async (tx) => {
      const r = (await tx.query(`insert into system_backups (file, sha256, size_bytes, manifest) values ($1, $2, $3, $4) returning id`, [file, sha256, size, JSON.stringify(manifest)])).rows[0];
      await audit.record(tx, { action: 'system.backup', entityType: 'system_backup', entityId: r.id, after: { file: path.basename(file), size, sha256, tables: Object.keys(desc.rows).length } });
      return r;
    });
    return { id: rec.id as string, file, sha256, size_bytes: size, manifest };
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
}

/** Проверка восстановления: временная база, восстановление, сверка с манифестом, удаление временной базы. */
export async function verifyRestore(backupId?: string) {
  const rec = await withSystem(async (tx) => (await tx.query(`select * from system_backups ${backupId ? 'where id = $1' : 'order by created_at desc limit 1'}`, backupId ? [backupId] : [])).rows[0]);
  if (!rec) throw new Error('Резервных копий нет — сначала выполните backup.');
  const manifest = rec.manifest as Manifest;
  const checks: { name: string; ok: boolean; detail?: string }[] = [];
  const temp = `ceh_restore_${Date.now().toString(36)}`;
  const admin = new Client({ connectionString: dbUrl() });
  await admin.connect();
  const started = Date.now();
  try {
    const sum = await sha256File(rec.file).catch(() => null);
    checks.push({ name: 'Контрольная сумма файла', ok: sum === rec.sha256, detail: sum ? undefined : 'файл не найден' });
    await admin.query(`create database ${temp}`);
    try {
      await run('pg_restore', ['--exit-on-error', '--no-password', `--dbname=${dbUrl(temp)}`, rec.file], { maxBuffer: 1 << 26 });
      checks.push({ name: 'Восстановление без ошибок', ok: true });
    } catch (e) {
      checks.push({ name: 'Восстановление без ошибок', ok: false, detail: String((e as { stderr?: string }).stderr || (e as Error).message).slice(0, 500) });
    }
    if (checks.every((c) => c.ok)) {
      const r = new Client({ connectionString: dbUrl(temp) });
      await r.connect();
      try {
        const got = await describe(r);
        const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
        checks.push({ name: 'Миграции и контрольные суммы', ok: same(got.migrations, manifest.migrations) });
        const diff = Object.keys(manifest.rows).filter((t) => got.rows[t] !== manifest.rows[t]);
        checks.push({ name: `Строки всех таблиц (${Object.keys(manifest.rows).length})`, ok: !diff.length, detail: diff.length ? `расходятся: ${diff.join(', ')}` : undefined });
        checks.push({ name: 'Таблицы с RLS', ok: same(got.rls_tables, manifest.rls_tables) });
        checks.push({ name: `Защитные триггеры (${manifest.triggers.length})`, ok: same(got.triggers, manifest.triggers) });
        // Цепочки аудита пересчитываются заново в восстановленной базе и сверяются с оригиналом:
        // длина, последний хеш и результат проверки должны совпасть.
        const differ: string[] = [];
        for (const ch of manifest.audit_chains) {
          const v = await audit.verifyChain(r as never, ch.organization_id);
          const last = got.audit_chains.find((x) => x.organization_id === ch.organization_id);
          if (v.ok !== ch.ok || v.checked !== ch.length || last?.last_hash !== ch.last_hash) differ.push(ch.organization_id || 'система');
        }
        const brokenAtSource = manifest.audit_chains.filter((ch) => !ch.ok).length;
        checks.push({ name: `Цепочки аудита (${manifest.audit_chains.length})`, ok: !differ.length,
          detail: [differ.length ? `не совпали с оригиналом: ${differ.join(', ')}` : '', brokenAtSource ? `нарушены уже в оригинале: ${brokenAtSource} — разберите по журналу аудита` : ''].filter(Boolean).join('; ') || undefined });
      } finally {
        await r.end();
      }
    }
  } finally {
    await admin.query(`drop database if exists ${temp} with (force)`).catch(() => undefined);
    await admin.end();
  }
  const ok = checks.every((c) => c.ok);
  const report = { checks, ok, seconds: Math.round((Date.now() - started) / 100) / 10, verified_at: new Date().toISOString() };
  await withSystem(async (tx) => {
    await tx.query(`update system_backups set verified_at = now(), verify_ok = $2, verify_report = $3 where id = $1`, [rec.id, ok, JSON.stringify(report)]);
    await audit.record(tx, { action: 'system.backup_verify', entityType: 'system_backup', entityId: rec.id, after: { ok, checks: checks.filter((c) => !c.ok).map((c) => c.name) }, result: ok ? 'success' : 'error' });
  });
  return { id: rec.id as string, file: rec.file as string, ...report };
}

/** Последняя копия с успешно проверенным восстановлением — для готовности к пилоту. */
export async function lastVerifiedBackup() {
  return withSystem(async (tx) => (await tx.query(`select id, created_at, verified_at, verify_ok, size_bytes from system_backups order by created_at desc limit 1`)).rows[0] || null);
}

if (typeof require !== 'undefined' && require.main === module) {
  const cmd = process.argv[2];
  (cmd === 'verify' ? verifyRestore(process.argv[3]) : backup())
    .then((r) => console.log(JSON.stringify(r, (k, v) => (k === 'manifest' ? undefined : v), 1)))
    .catch((e) => { console.error(e.message); process.exitCode = 1; })
    .finally(async () => (await import('../db/pool')).closePool());
}
