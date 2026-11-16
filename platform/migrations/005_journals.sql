-- ЦЕХ — этап 5 ТЗ v2 (часть 1): журналы ХАССП из событий.
--
-- Принцип ТЗ v2 §0: сотрудник выполняет операцию один раз — журналы J01–J53 формируются из событий системы
-- (замеры, приёмка, партии, отклонения). Для форм, у которых ещё нет событий, — ручная запись по столбцам
-- утверждённого шаблона; запись неизменяема, исправление — новой записью с причиной (ТЗ v2 §10, AT-11).
-- Подпись журнала за период хранит хеш содержимого: правка после подписи видна.

create table journal_entries (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  site_id           uuid not null references sites(id),
  form_code         text not null check (form_code ~ '^J\d{2}$'),
  occurred_at       timestamptz not null,              -- когда выполнено (факт)
  entered_at        timestamptz not null default now(),-- когда внесено
  is_late           boolean not null default false,
  values            jsonb not null,                    -- значения по столбцам шаблона
  author_user_id    uuid not null references users(id),
  corrects_id       uuid references journal_entries(id),
  correction_reason text,
  check (corrects_id is null or correction_reason is not null)
);
create index journal_entries_form_idx on journal_entries(organization_id, site_id, form_code, occurred_at);

create function journal_entries_immutable() returns trigger language plpgsql as $$
begin raise exception 'Запись журнала нельзя изменить или удалить — внесите исправление с причиной'; end $$;
create trigger journal_entries_no_update before update or delete on journal_entries for each row execute function journal_entries_immutable();

create table journal_signoffs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid not null references sites(id),
  form_code       text not null,
  period_from     date not null,
  period_to       date not null,
  rows_count      integer not null,
  content_hash    text not null,
  note            text,
  signed_by       uuid not null references users(id),
  signed_at       timestamptz not null default now(),
  check (period_to >= period_from)
);
create index journal_signoffs_idx on journal_signoffs(organization_id, site_id, form_code, period_from);

create function journal_signoffs_immutable() returns trigger language plpgsql as $$
begin raise exception 'Подпись журнала нельзя изменить или удалить'; end $$;
create trigger journal_signoffs_no_update before update or delete on journal_signoffs for each row execute function journal_signoffs_immutable();

do $$
declare t text;
begin
  foreach t in array array['journal_entries', 'journal_signoffs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;

grant select, insert on journal_entries, journal_signoffs to ceh_app;
