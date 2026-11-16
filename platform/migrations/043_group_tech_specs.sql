-- ЦЕХ — групповые технические условия (ГОСТ Р 51740-2016, 4.2.8, 4.3.6–4.3.8, 5.1.3): одни ТУ на несколько наименований
-- продукции с ассортиментом. Расчёт по каждому наименованию — как в ТУ на одно блюдо; утверждённая версия — неизменяемый
-- снимок с контрольной суммой (как tech_spec_versions).

create table group_tech_specs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  seq             integer not null,
  title           text not null,                 -- обобщённое наименование во множественном числе (4.3.6)
  dish_ids        uuid[] not null,
  params          jsonb not null default '{}'::jsonb,
  status          text not null default 'active' check (status in ('active', 'archived')),
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  updated_by      uuid references users(id),
  updated_at      timestamptz not null default now(),
  unique (organization_id, seq)
);

create table group_tech_spec_versions (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  spec_id           uuid not null references group_tech_specs(id),
  version           integer not null,
  designation       text not null,
  snapshot          jsonb not null,
  lab_protocol      text not null,
  content_hash      text not null,
  generator_version text not null default 'ceh-2026.11',
  approved_by       uuid not null references users(id),
  approved_at       timestamptz not null default now(),
  unique (spec_id, version)
);
create trigger group_tech_spec_versions_hash before insert on group_tech_spec_versions for each row execute function set_content_hash();
create trigger group_tech_spec_versions_no_update before update or delete on group_tech_spec_versions for each row execute function tech_data_immutable();

do $$
declare t text;
begin
  foreach t in array array['group_tech_specs', 'group_tech_spec_versions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;
grant select, insert, update on group_tech_specs to ceh_app;
grant select, insert on group_tech_spec_versions to ceh_app;
