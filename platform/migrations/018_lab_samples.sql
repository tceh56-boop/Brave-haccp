-- Этап 14: суточные пробы и лабораторный контроль (перенос MonChef_DailySamples.gs и LabTests.gs прежнего ЦЕХ).
--  * Суточная проба: от блюда мероприятия (банкета), партии п/ф или блюда смены. Масса (или порция целиком), тара,
--    место и измеренная температура хранения, срок хранения. Параметры — настройка предприятия с основанием.
--    Запись неизменяема; уничтожение — отдельная неизменяемая запись, не раньше окончания срока.
--  * Программа лабораторного контроля: вид исследования, объект, периодичность, основание (программа ПК),
--    повторный отбор при несоответствии. Результат — неизменяемая запись с протоколом и показателями;
--    «не соответствует» → отклонение ответственному и срок повторного отбора.

create table sample_settings (
  organization_id uuid primary key references organizations(id),
  min_weight_g    numeric not null check (min_weight_g > 0),
  retention_hours numeric not null check (retention_hours > 0 and retention_hours <= 720),
  t_min           numeric not null,
  t_max           numeric not null,
  basis           text not null,
  updated_by      uuid not null references users(id),
  updated_at      timestamptz not null default now(),
  check (t_min < t_max)
);

create table daily_samples (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid not null references sites(id),
  source          text not null check (source in ('event', 'lot', 'dish')),
  plan_event_id   uuid references plan_events(id),
  lot_id          uuid references lots(id),
  dish_id         uuid references dishes(id),
  title           text not null,                     -- что отобрано: блюдо / партия
  weight_g        numeric check (weight_g is null or weight_g > 0),
  whole_portion   boolean not null default false,
  container       text not null,
  storage_object_id uuid references control_objects(id),
  storage_place   text not null,
  temperature     numeric not null,
  basis           text not null,                     -- параметры, по которым принята (масса, срок, t°) и их основание
  taken_by        uuid not null references users(id),
  taken_at        timestamptz not null default now(),
  keep_until      timestamptz not null,
  check (whole_portion or weight_g is not null),
  check (source <> 'event' or (plan_event_id is not null and dish_id is not null)),
  check (source <> 'lot' or lot_id is not null),
  check (source <> 'dish' or dish_id is not null)
);
create unique index daily_samples_event_dish on daily_samples(plan_event_id, dish_id) where plan_event_id is not null;
create unique index daily_samples_lot on daily_samples(lot_id) where lot_id is not null;
create index daily_samples_site_idx on daily_samples(site_id, taken_at desc);

create table daily_sample_destructions (
  sample_id       uuid primary key references daily_samples(id),
  organization_id uuid not null references organizations(id),
  destroyed_by    uuid not null references users(id),
  destroyed_at    timestamptz not null default now(),
  note            text
);

create table lab_programs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid not null references sites(id),
  test_type       text not null,                     -- микробиология готовой продукции, смывы, вода …
  target          text not null,                     -- объект: блюдо, поверхность, вода
  dish_id         uuid references dishes(id),
  period_days     integer not null check (period_days between 1 and 730),
  retest_days     integer check (retest_days is null or retest_days between 1 and 90),
  next_due        date not null,
  basis           text not null,                     -- программа производственного контроля, пункт
  responsible_role text not null default 'haccp_lead',
  status          text not null default 'active' check (status in ('active', 'archived')),
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now()
);
create index lab_programs_site_idx on lab_programs(site_id, status, next_due);

create table lab_results (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid not null references sites(id),
  program_id      uuid references lab_programs(id),
  test_type       text not null,
  target          text not null,
  dish_id         uuid references dishes(id),
  lot_id          uuid references lots(id),
  lab_name        text not null,
  protocol_no     text not null,
  sampled_on      date not null,
  result_on       date not null,
  params          jsonb not null default '[]',
  result          text not null check (result in ('pass', 'fail')),
  conclusion      text,
  incident_id     uuid references incidents(id),
  recorded_by     uuid not null references users(id),
  recorded_at     timestamptz not null default now(),
  check (result_on >= sampled_on)
);
create index lab_results_site_idx on lab_results(site_id, result_on desc);

create function lab_samples_immutable() returns trigger language plpgsql as $$
begin raise exception 'Записи суточных проб и результатов исследований не изменяются и не удаляются'; end $$;
create trigger daily_samples_no_update before update or delete on daily_samples for each row execute function lab_samples_immutable();
create trigger daily_sample_destructions_no_update before update or delete on daily_sample_destructions for each row execute function lab_samples_immutable();
create trigger lab_results_no_update before update or delete on lab_results for each row execute function lab_samples_immutable();

alter table incidents drop constraint incidents_kind_check;
alter table incidents add constraint incidents_kind_check check (kind in ('temperature_deviation', 'receipt_problem', 'expired_lot', 'reported', 'release_check', 'lab_fail'));

do $$
declare t text;
begin
  foreach t in array array['sample_settings', 'daily_samples', 'daily_sample_destructions', 'lab_programs', 'lab_results'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;

grant select, insert, update on sample_settings, lab_programs to ceh_app;
grant select, insert on daily_samples, daily_sample_destructions, lab_results to ceh_app;
