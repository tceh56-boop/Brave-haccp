-- ЦЕХ — стандарт организации (СТО) на группу блюд (ГОСТ Р 1.4, ГОСТ Р 1.5): несколько блюд в одном стандарте,
-- данные — из утверждённых ТТК; утверждает руководитель предприятия (право sto.approve), срок действия не ограничен,
-- актуализация — не реже одного раза в год (задача технологу). Утверждённая версия — неизменяемый снимок.

create table sto_standards (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  seq             integer not null,                 -- порядковый номер стандарта в организации
  title           text not null,                    -- «Салаты и холодные закуски»
  dish_ids        uuid[] not null default '{}',
  params          jsonb not null default '{}',      -- область применения, упаковка, методы контроля, ОКПО, НД на сырьё
  status          text not null default 'active' check (status in ('active', 'archived')),
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, seq)
);

create table sto_versions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  sto_id          uuid not null references sto_standards(id),
  version         integer not null,
  designation     text not null,
  snapshot        jsonb not null,
  change_note     text not null,
  review_due      date not null,                   -- актуализация не реже раза в год
  approved_by     uuid not null references users(id),
  approved_at     timestamptz not null default now(),
  unique (sto_id, version)
);
create trigger sto_versions_no_update before update or delete on sto_versions for each row execute function tech_data_immutable();

do $$
declare t text;
begin
  foreach t in array array['sto_standards', 'sto_versions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;
grant select, insert, update on sto_standards to ceh_app;
grant select, insert on sto_versions to ceh_app;
