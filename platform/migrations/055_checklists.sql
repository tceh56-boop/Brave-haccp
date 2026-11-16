-- ТЗ 3.0 §15.6; мастер-промт, раздел 7: чек-листы формируются из утверждённых источников (этапы ТТК на плане,
-- мониторинг плана ХАССП). Пункт: действие, объект, критерий, вид (отметка / фактическое измерение), периодичность,
-- ответственный, источник с версией. Шаблон утверждает специалист; утверждённый не меняется — новой версией.
-- Выполнение: факт с временем события и временем внесения; пропуск — задача; норма вместо факта не подставляется.
create table checklist_templates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid not null references sites(id),
  scope_key       text not null,                       -- 'place:<id>' | 'haccp'
  name            text not null,
  version         integer not null,
  status          text not null default 'draft' check (status in ('draft', 'approved', 'archived')),
  sources         jsonb not null default '[]',
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  approved_by     uuid references users(id),
  approved_at     timestamptz,
  unique (site_id, scope_key, version),
  check (status <> 'approved' or approved_by is not null)
);
create table checklist_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  template_id     uuid not null references checklist_templates(id),
  position        integer not null,
  action          text not null,
  object          text,
  criterion       text,
  kind            text not null check (kind in ('check', 'measure', 'observe')),   -- отметка / число в пределах / наблюдение текстом
  unit            text,
  min_value       numeric,
  max_value       numeric,
  frequency       text,
  responsible_role text,
  source_type     text not null check (source_type in ('ttk_stage', 'haccp_monitoring', 'manual')),
  source_id       uuid,
  source_ref      text not null,                       -- «ТТК «X» v3, этап 2», «План ХАССП v1, О-02»
  check (kind <> 'measure' or (unit is not null and (min_value is not null or max_value is not null)))
);
create index checklist_items_tpl_idx on checklist_items(template_id, position);
create function checklist_items_locked() returns trigger language plpgsql as $$
declare st text;
begin
  select status into st from checklist_templates where id = coalesce(new.template_id, old.template_id);
  if st <> 'draft' then raise exception 'Чек-лист утверждён — изменения вносятся новой версией'; end if;
  return coalesce(new, old);
end $$;
create trigger checklist_items_lock before insert or update or delete on checklist_items for each row execute function checklist_items_locked();

create table checklist_runs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid not null references sites(id),
  template_id     uuid not null references checklist_templates(id),
  run_date        date not null,
  status          text not null default 'open' check (status in ('open', 'closed')),
  started_by      uuid not null references users(id),
  started_at      timestamptz not null default now(),
  closed_by       uuid references users(id),
  closed_at       timestamptz,
  missing         integer,
  unique (template_id, run_date)
);
create table checklist_results (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  run_id          uuid not null references checklist_runs(id),
  item_id         uuid not null references checklist_items(id),
  done            boolean not null,                    -- false — не выполнено (с причиной)
  value           numeric,
  observation     text,
  ok              boolean,                             -- для измерения: в пределах
  comment         text,
  incident_id     uuid references incidents(id),
  event_at        timestamptz not null,                -- когда сделано
  recorded_at     timestamptz not null default now(),  -- когда внесено
  done_by         uuid not null references users(id),
  unique (run_id, item_id),
  check (done or (comment is not null and length(trim(comment)) >= 3))
);
create trigger checklist_results_immutable before update or delete on checklist_results for each row execute function tech_data_immutable();

do $$ declare t text; begin
  foreach t in array array['checklist_templates', 'checklist_items', 'checklist_runs', 'checklist_results'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;
grant select, insert, update on checklist_templates, checklist_runs to ceh_app;
grant select, insert, update, delete on checklist_items to ceh_app;
grant select, insert on checklist_results to ceh_app;
