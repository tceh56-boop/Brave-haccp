-- Этап 17 (настройка): распознавание документов через Yandex Vision / YandexGPT.
-- Ключи облака — в окружении сервера, не в базе. Здесь — включение по предприятию, виды документов,
-- месячный лимит страниц (контроль расходов) и учёт каждого обращения (неизменяемый).

create table recognition_settings (
  organization_id uuid primary key references organizations(id),
  enabled         boolean not null default false,
  kinds           text[] not null default '{torg12,upd,fiscal_qr,banquet}',
  monthly_pages   integer not null default 200 check (monthly_pages between 0 and 100000),
  updated_by      uuid not null references users(id),
  updated_at      timestamptz not null default now()
);

create table recognition_usage (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  kind            text not null check (kind in ('torg12', 'upd', 'fiscal_qr', 'banquet', 'check')),
  pages           integer not null default 0 check (pages >= 0),
  llm_tokens      integer not null default 0 check (llm_tokens >= 0),
  status          text not null check (status in ('ok', 'failed', 'rejected')),
  error           text,
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now()
);
create index recognition_usage_org_idx on recognition_usage(organization_id, created_at desc);

create function recognition_usage_immutable() returns trigger language plpgsql as $$
begin raise exception 'Учёт обращений к распознаванию не изменяется и не удаляется'; end $$;
create trigger recognition_usage_no_update before update or delete on recognition_usage for each row execute function recognition_usage_immutable();

do $$
declare t text;
begin
  foreach t in array array['recognition_settings', 'recognition_usage'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;

grant select, insert, update on recognition_settings to ceh_app;
grant select, insert on recognition_usage to ceh_app;
