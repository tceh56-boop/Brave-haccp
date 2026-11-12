-- Этап 10: производство полуфабрикатов (перенос Production.gs / SemiFinished.gs прежнего ЦЕХ и MON CHEF 3.1–3.3).
--  * Задание: план → в работе → выпущено (или отменено с причиной). Только явные переходы — без двойного списания.
--  * Выпуск: сырьё и готовые п/ф списываются по утверждённой ТТК через FEFO; выход приходуется партией п/ф
--    с себестоимостью и сроком из ТТК (часы хранения утверждены вместе с ТТК; без них — «срок не подтверждён»).
--  * Контроль при выпуске (ККТ): параметры с пределами и основанием задаёт ХАССП; пока последний замер по каждому
--    параметру не в пределах, выпуск закрыт; замер вне предела — отклонение.

alter table ttk_versions add column shelf_life_hours numeric check (shelf_life_hours is null or shelf_life_hours > 0);

alter table stock_movements drop constraint stock_movements_kind_check;
alter table stock_movements add constraint stock_movements_kind_check
  check (kind in ('receipt', 'consume', 'write_off', 'transfer_out', 'transfer_in', 'count_adjust', 'return_to_supplier', 'open_out', 'open_in', 'produce'));

create table release_checks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  dish_id         uuid not null references dishes(id),
  name            text not null,                         -- «Температура в толще продукта»
  unit            text not null default '°C',
  min_value       numeric,
  max_value       numeric,
  basis           text not null,                         -- пункт плана ХАССП / норматива
  hazard_id       uuid references haccp_hazards(id),
  status          text not null default 'active' check (status in ('active', 'archived')),
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  check (min_value is not null or max_value is not null),
  check (min_value is null or max_value is null or min_value <= max_value)
);
create index release_checks_dish_idx on release_checks(dish_id) where status = 'active';

create table production_orders (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid not null references sites(id),
  dish_id         uuid not null references dishes(id),
  ttk_version_id  uuid not null references ttk_versions(id),
  planned_g       numeric not null check (planned_g > 0),
  planned_for     date not null,
  note            text,
  status          text not null default 'planned' check (status in ('planned', 'in_progress', 'done', 'cancelled')),
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  started_by      uuid references users(id),
  started_at      timestamptz,
  completed_by    uuid references users(id),
  completed_at    timestamptz,
  actual_g        numeric check (actual_g is null or actual_g > 0),
  output_lot_id   uuid references lots(id),
  cost            numeric,
  cancel_reason   text,
  check (status <> 'done' or (output_lot_id is not null and actual_g is not null and completed_at is not null)),
  check (status <> 'cancelled' or cancel_reason is not null)
);
create index production_orders_site_idx on production_orders(site_id, planned_for, status);

create table production_checks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  order_id        uuid not null references production_orders(id),
  check_id        uuid not null references release_checks(id),
  value           numeric not null,
  ok              boolean not null,
  incident_id     uuid references incidents(id),
  recorded_by     uuid not null references users(id),
  recorded_at     timestamptz not null default now()
);
create index production_checks_order_idx on production_checks(order_id, check_id, recorded_at desc);

create function production_checks_immutable() returns trigger language plpgsql as $$
begin raise exception 'Замеры при выпуске не изменяются и не удаляются'; end $$;
create trigger production_checks_no_update before update or delete on production_checks for each row execute function production_checks_immutable();

do $$
declare t text;
begin
  foreach t in array array['release_checks', 'production_orders', 'production_checks'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;

grant select, insert, update on release_checks, production_orders to ceh_app;
grant select, insert on production_checks to ceh_app;

-- отклонение при выпуске (замер вне предела ККТ)
alter table incidents drop constraint incidents_kind_check;
alter table incidents add constraint incidents_kind_check check (kind in ('temperature_deviation', 'receipt_problem', 'expired_lot', 'reported', 'release_check'));
