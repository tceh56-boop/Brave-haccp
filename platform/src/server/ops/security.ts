import { withSystem } from '../db/pool';

/**
 * Автоматическая проверка безопасности базы (ТЗ v2 §9, AT-10, AT-11, AT-16). Регрессия здесь блокирует запуск:
 *  — у каждой таблицы с organization_id включена RLS и есть политика для роли приложения (изоляция организаций);
 *  — роль приложения не суперпользователь, не обходит RLS и не владеет таблицами;
 *  — у роли приложения нет UPDATE/DELETE на неизменяемых журналах, и защитные триггеры на месте;
 *  — в сессиях хранится только хеш токена, а у пользователей — хеш пароля.
 */

/** Записи, которые по ТЗ не переписываются: исправление — новой записью. */
export const IMMUTABLE = ['labels', 'label_prints', 'production_checks', 'product_nutrition', 'product_allergens', 'tech_spec_versions', 'audit_events', 'measurements', 'stock_movements', 'journal_entries', 'journal_signoffs', 'evidence_files', 'capa_events',
  'pos_payments', 'ai_jobs', 'ai_decisions', 'pilot_confirmations', 'pilot_decisions',
  'daily_samples', 'daily_sample_destructions', 'lab_results', 'equipment_events', 'sanitation_records', 'sanitation_verifications',
  'staff_medical', 'health_checks', 'briefings', 'briefing_acks', 'recognition_usage'];
/** Таблицы без строк организаций (справочники платформы, служебные). */
const PLATFORM_TABLES = new Set(['users', 'email_tokens', 'sessions', 'login_attempts', 'outbox_emails', 'organizations', 'schema_migrations', 'reference_products', 'ttk_archive', 'system_backups']);

export interface Check { key: string; title: string; ok: boolean; detail?: string; severity: 'critical' | 'warning' }

export async function securityChecks(): Promise<{ ok: boolean; checks: Check[] }> {
  return withSystem(async (tx) => {
    const checks: Check[] = [];
    const orgTables = (await tx.query(`select c.relname, c.relrowsecurity, c.relforcerowsecurity,
        exists (select 1 from pg_policy p where p.polrelid = c.oid and 'ceh_app'::regrole = any(p.polroles)) as has_policy
      from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by c.relname`)).rows.filter((r) => !PLATFORM_TABLES.has(r.relname));
    const noRls = orgTables.filter((r) => !r.relrowsecurity || !r.has_policy).map((r) => r.relname);
    checks.push({ key: 'rls', title: `Изоляция организаций: RLS и политика на ${orgTables.length} таблицах`, ok: !noRls.length, severity: 'critical', detail: noRls.length ? `без защиты: ${noRls.join(', ')}` : undefined });

    const role = (await tx.query(`select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb from pg_roles where rolname = 'ceh_app'`)).rows[0];
    checks.push({ key: 'app_role', title: 'Роль приложения без особых привилегий', severity: 'critical',
      ok: !!role && !role.rolsuper && !role.rolbypassrls && !role.rolcreaterole && !role.rolcreatedb, detail: role ? undefined : 'роль ceh_app не найдена' });
    const owned = (await tx.query(`select count(*)::int as n from pg_class where relowner = 'ceh_app'::regrole and relnamespace = 'public'::regnamespace`)).rows[0].n;
    checks.push({ key: 'app_owner', title: 'Роль приложения не владеет таблицами (владелец обходит RLS)', ok: owned === 0, severity: 'critical', detail: owned ? `таблиц: ${owned}` : undefined });

    const writable: string[] = [], noTrigger: string[] = [];
    for (const t of IMMUTABLE) {
      const exists = (await tx.query(`select to_regclass($1) is not null as e`, [`public.${t}`])).rows[0].e;
      if (!exists) { noTrigger.push(`${t} (нет таблицы)`); continue; }
      const p = (await tx.query(`select has_table_privilege('ceh_app', $1, 'UPDATE') as u, has_table_privilege('ceh_app', $1, 'DELETE') as d`, [`public.${t}`])).rows[0];
      if (p.u || p.d) writable.push(t);
      const trg = (await tx.query(`select count(*)::int as n from pg_trigger where tgrelid = $1::regclass and not tgisinternal and tgenabled <> 'D'`, [`public.${t}`])).rows[0].n;
      if (!trg) noTrigger.push(t);
    }
    checks.push({ key: 'immutable_grants', title: `Неизменяемые журналы (${IMMUTABLE.length}): у приложения нет прав на изменение`, ok: !writable.length, severity: 'critical', detail: writable.length ? writable.join(', ') : undefined });
    checks.push({ key: 'immutable_triggers', title: 'Неизменяемые журналы: защитные триггеры включены', ok: !noTrigger.length, severity: 'critical', detail: noTrigger.length ? noTrigger.join(', ') : undefined });

    const cols = (await tx.query(`select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name in ('sessions', 'users', 'email_tokens')`)).rows
      .map((r) => `${r.table_name}.${r.column_name}`);
    const plain = cols.filter((c) => /\.(token|password)$/.test(c));
    checks.push({ key: 'secrets', title: 'Пароли и токены хранятся только в виде хешей', ok: !plain.length && cols.includes('sessions.token_hash'), severity: 'critical', detail: plain.length ? plain.join(', ') : undefined });

    const me = (await tx.query(`select rolsuper from pg_roles where rolname = current_user`)).rows[0];
    checks.push({ key: 'owner_role', title: 'Сервер подключается к базе не суперпользователем', ok: !me.rolsuper, severity: 'warning',
      detail: me.rolsuper ? 'на стенде — допустимо; в эксплуатации владелец схемы должен быть отдельной ролью без SUPERUSER' : undefined });
    return { ok: checks.every((c) => c.ok || c.severity !== 'critical'), checks };
  });
}
