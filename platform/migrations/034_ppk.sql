-- ЦЕХ — программа производственного контроля (ППК), собранная из нормативной библиотеки и данных предприятия.
-- Каждая строка программы — со ссылкой «документ, пункт»; пробелы в данных блокируют утверждение.
-- Утверждённая версия — неизменяемый снимок с отпечатком данных (sha-256): изменились данные — система требует пересмотра.

create table ppk_settings (
  organization_id uuid primary key references organizations(id),
  params          jsonb not null default '{}',      -- ответственный за ПК, должность утверждающего, город, номер приказа
  updated_by      uuid references users(id),
  updated_at      timestamptz not null default now()
);

create table ppk_versions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  version         integer not null,
  snapshot        jsonb not null,
  data_hash       text not null,
  change_note     text not null,
  approved_by     uuid not null references users(id),
  approved_at     timestamptz not null default now(),
  unique (organization_id, version)
);
create trigger ppk_versions_no_update before update or delete on ppk_versions for each row execute function tech_data_immutable();

do $$
declare t text;
begin
  foreach t in array array['ppk_settings', 'ppk_versions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;
grant select, insert, update on ppk_settings to ceh_app;
grant select, insert on ppk_versions to ceh_app;
