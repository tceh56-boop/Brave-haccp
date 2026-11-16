-- ЦЕХ — интеграции (ТЗ доработки, P3). Каркас: настройки по организации, секреты — только шифротекстом
-- (AES-256-GCM, ключ CEH_SECRET_KEY вне базы), журнал обмена без секретов. QR кассового чека — доказательство
-- к приёмке: реквизиты ФН/ФД/ФП, сверка с приёмкой, повторный чек блокирует проводку.

create table integrations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  system          text not null,
  enabled         boolean not null default false,
  settings        jsonb not null default '{}'::jsonb,      -- несекретные параметры
  secret          text,                                     -- шифротекст (iv.tag.data, base64)
  secret_fields   text[] not null default '{}',             -- какие секреты заданы (без значений)
  updated_by      uuid references users(id),
  updated_at      timestamptz not null default now(),
  unique (organization_id, system)
);

create table integration_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  system          text not null,
  action          text not null,
  status          text not null check (status in ('ok', 'error', 'skipped')),
  detail          text,
  created_by      uuid references users(id),
  created_at      timestamptz not null default now()
);
create index integration_events_org_idx on integration_events(organization_id, created_at desc);
create trigger integration_events_no_update before update or delete on integration_events for each row execute function tech_data_immutable();

create table fiscal_receipts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  receipt_id      uuid not null references receipts(id),
  qr_raw          text not null,
  fiscal_at       timestamp,
  total           numeric,
  fn              text,
  fd              text,
  fp              text,
  operation       text,
  fiscal_key      text,
  match_status    text not null check (match_status in ('match', 'partial', 'conflict', 'invalid', 'no_comparison', 'duplicate')),
  warnings        jsonb not null default '[]'::jsonb,
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now()
);
create index fiscal_receipts_key_idx on fiscal_receipts(organization_id, fiscal_key);
create trigger fiscal_receipts_no_update before update or delete on fiscal_receipts for each row execute function tech_data_immutable();

do $$
declare t text;
begin
  foreach t in array array['integrations', 'integration_events', 'fiscal_receipts'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;
grant select, insert, update on integrations to ceh_app;
grant select, insert on integration_events, fiscal_receipts to ceh_app;
