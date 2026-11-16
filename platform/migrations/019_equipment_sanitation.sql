-- Этап 15: оборудование, ТО, поверка приборов и санитария (перенос Equipment.gs прежнего ЦЕХ, реестра приборов
-- и санитарного контура MON CHEF V41–V43).
--  * Оборудование площадки: вид, модель, заводской и инвентарный номер, связь с объектом контроля.
--    Средство измерения (термометр, щуп, весы): дата поверки, срок следующей, документ. Истекла поверка —
--    прибор не принимается для замеров. График ТО — периодичность в днях.
--  * События (неизменяемые): ТО, поверка, неисправность (влияние на безопасность), ремонт с допуском к работе.
--  * Санитария: дезсредства с утверждённым режимом (концентрация, экспозиция — из инструкции производителя,
--    основание обязательно); план уборки/дезинфекции/мойки по зонам с периодичностью; выполнение (неизменяемо)
--    с замером концентрации; проверка выполнения другим сотрудником.

create table equipment (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  site_id           uuid not null references sites(id),
  name              text not null,
  kind              text not null check (kind in ('cold', 'thermal', 'mechanical', 'washing', 'instrument', 'scales', 'other')),
  model             text,
  serial_no         text,
  inventory_no      text,
  control_object_id uuid references control_objects(id),
  measuring         boolean not null default false,   -- средство измерения: нужна поверка
  calibrated_on     date,
  calibration_due   date,
  calibration_doc   text,
  maintenance_days  integer check (maintenance_days is null or maintenance_days between 1 and 730),
  maintenance_due   date,
  status            text not null default 'active' check (status in ('active', 'broken', 'retired')),
  retired_reason    text,
  created_by        uuid not null references users(id),
  created_at        timestamptz not null default now(),
  check (status <> 'retired' or retired_reason is not null)
);
create index equipment_site_idx on equipment(site_id, status);

create table equipment_events (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  site_id           uuid not null references sites(id),
  equipment_id      uuid not null references equipment(id),
  kind              text not null check (kind in ('maintenance', 'calibration', 'breakdown', 'repair')),
  happened_on       date not null,
  description       text not null,
  safety_impact     text,                              -- неисправность: влияние на безопасность продукта
  performer         text,                              -- кто выполнил (сотрудник, сервисная организация)
  document          text,                              -- свидетельство о поверке, акт
  next_due          date,                              -- поверка: срок следующей
  admitted          boolean,                           -- ремонт: допущено к работе
  breakdown_id      uuid references equipment_events(id),
  incident_id       uuid references incidents(id),
  recorded_by       uuid not null references users(id),
  recorded_at       timestamptz not null default now(),
  check (kind <> 'calibration' or (next_due is not null and document is not null)),
  check (kind <> 'repair' or admitted is not null)
);
create index equipment_events_eq_idx on equipment_events(equipment_id, recorded_at desc);

alter table measurements add column instrument_id uuid references equipment(id);
alter table daily_samples add column instrument_id uuid references equipment(id);

create table disinfectants (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  name              text not null,
  purpose           text not null,                     -- поверхности, инвентарь, посуда, руки
  concentration_min numeric check (concentration_min is null or concentration_min >= 0),
  concentration_max numeric check (concentration_max is null or concentration_max >= 0),
  exposure          text,                              -- экспозиция, как в инструкции
  basis             text not null,                     -- инструкция производителя, СГР / декларация
  status            text not null default 'draft' check (status in ('draft', 'approved', 'archived')),
  approved_by       uuid references users(id),
  approved_at       timestamptz,
  created_by        uuid not null references users(id),
  created_at        timestamptz not null default now(),
  check (concentration_min is null or concentration_max is null or concentration_min <= concentration_max),
  check (status <> 'approved' or approved_by is not null)
);

create table sanitation_plans (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  site_id           uuid not null references sites(id),
  area              text not null,                     -- зона, помещение, оборудование, инвентарь
  work              text not null,                     -- что делается
  kind              text not null check (kind in ('current', 'general', 'disinfection', 'inventory')),
  period_days       integer not null check (period_days between 1 and 365),
  disinfectant_id   uuid references disinfectants(id),
  check_concentration boolean not null default false,
  responsible_role  text not null default 'line_staff',
  next_due          date not null,
  status            text not null default 'active' check (status in ('active', 'archived')),
  created_by        uuid not null references users(id),
  created_at        timestamptz not null default now(),
  check (not check_concentration or disinfectant_id is not null)
);
create index sanitation_plans_site_idx on sanitation_plans(site_id, status, next_due);

create table sanitation_records (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  site_id           uuid not null references sites(id),
  plan_id           uuid not null references sanitation_plans(id),
  done_at           timestamptz not null default now(),
  done_by           uuid not null references users(id),
  disinfectant_id   uuid references disinfectants(id),
  concentration     numeric,
  concentration_ok  boolean,
  result            text not null check (result in ('done', 'deviation')),
  note              text,
  incident_id       uuid references incidents(id)
);
create index sanitation_records_plan_idx on sanitation_records(plan_id, done_at desc);

create table sanitation_verifications (
  record_id         uuid primary key references sanitation_records(id),
  organization_id   uuid not null references organizations(id),
  verified_by       uuid not null references users(id),
  verified_at       timestamptz not null default now(),
  ok                boolean not null,
  note              text,
  check (ok or note is not null)
);

create function equipment_sanitation_immutable() returns trigger language plpgsql as $$
begin raise exception 'Записи ТО, санитарной обработки и проверки не изменяются и не удаляются'; end $$;
create trigger equipment_events_no_update before update or delete on equipment_events for each row execute function equipment_sanitation_immutable();
create trigger sanitation_records_no_update before update or delete on sanitation_records for each row execute function equipment_sanitation_immutable();
create trigger sanitation_verifications_no_update before update or delete on sanitation_verifications for each row execute function equipment_sanitation_immutable();

alter table incidents drop constraint incidents_kind_check;
alter table incidents add constraint incidents_kind_check check (kind in ('temperature_deviation', 'receipt_problem', 'expired_lot', 'reported', 'release_check', 'lab_fail', 'equipment', 'sanitation'));

do $$
declare t text;
begin
  foreach t in array array['equipment', 'equipment_events', 'disinfectants', 'sanitation_plans', 'sanitation_records', 'sanitation_verifications'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;

grant select, insert, update on equipment, disinfectants, sanitation_plans to ceh_app;
grant select, insert on equipment_events, sanitation_records, sanitation_verifications to ceh_app;
