-- ЦЕХ — этап 3 ТЗ v2: партии, склад, FEFO, карантин, списания, прослеживаемость; единый каталог MON CHEF.
--
--  * Справочник платформы (reference_products) — общий для всех организаций, загружается из единого каталога
--    MON CHEF: каждая исходная строка — отдельный ProductID, дубли не сливаются автоматически (ТЗ v1 AT-05),
--    пищевая ценность хранится со статусом проверки (REVIEW — не подтверждено источником).
--  * Конвертация единиц — только по подтверждённому коэффициенту (ТЗ v1 §6, AT-06).
--  * Движение запаса — неизменяемый журнал stock_movements; остаток партии меняется только движением.
--  * Повтор операции с тем же operation_id не создаёт второго движения (ТЗ v2 AT-12).

create table reference_products (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,            -- ProductID MON CHEF (PROD-0001)
  source           text not null,
  name             text not null,
  product_type     text,
  basis            text,
  kcal_100         numeric, protein_100 numeric, fat_100 numeric, carbs_100 numeric, fiber_100 numeric, sugars_100 numeric,
  storage          text, shelf_room text, shelf_fridge text, shelf_freezer text, spoilage text,
  verification_status text not null default 'REVIEW' check (verification_status in ('REVIEW', 'VERIFIED', 'REJECTED')),
  review_flags     text,
  source_file      text, source_row integer, original_id text,
  duplicate_group  text,                            -- группа одинаковых названий: «не объединять автоматически»
  imported_at      timestamptz not null default now()
);
create index reference_products_name_idx on reference_products (lower(name));
grant select on reference_products to ceh_app;

alter table products add column reference_product_id uuid references reference_products(id);

create table unit_conversions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  product_id      uuid not null references products(id),
  from_unit       text not null check (from_unit in ('кг', 'г', 'л', 'мл', 'шт')),
  to_unit         text not null check (to_unit in ('кг', 'г', 'л', 'мл', 'шт')),
  factor          numeric not null check (factor > 0),     -- 1 from_unit = factor to_unit
  source          text not null,                           -- основание: взвешивание, спецификация, маркировка
  confirmed_by    uuid not null references users(id),
  created_at      timestamptz not null default now(),
  unique (product_id, from_unit, to_unit),
  check (from_unit <> to_unit)
);

-- Идемпотентность: результат операции хранится по ключу; повтор возвращает тот же результат.
create table operations (
  organization_id uuid not null references organizations(id),
  operation_id    text not null check (length(operation_id) between 8 and 100),
  kind            text not null,
  result          jsonb not null,
  created_by      uuid references users(id),
  created_at      timestamptz not null default now(),
  primary key (organization_id, operation_id)
);

create table stock_movements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid not null references sites(id),
  lot_id          uuid not null references lots(id),
  product_id      uuid not null references products(id),
  kind            text not null check (kind in ('receipt', 'consume', 'write_off', 'transfer_out', 'transfer_in', 'count_adjust', 'return_to_supplier')),
  quantity        numeric not null check (quantity <> 0),   -- приход «+», расход «−», в единице партии
  unit            text not null,
  reason_code     text,
  reason          text,
  ref_type        text,
  ref_id          uuid,
  operation_id    text,
  fefo_override   boolean not null default false,
  created_by      uuid references users(id),
  created_at      timestamptz not null default now()
);
create index stock_movements_lot_idx on stock_movements(lot_id, created_at);
create index stock_movements_ref_idx on stock_movements(ref_type, ref_id);

create function stock_movements_immutable() returns trigger language plpgsql as $$
begin raise exception 'Движение запаса нельзя изменить или удалить — проведите корректирующее движение'; end $$;
create trigger stock_movements_no_update before update or delete on stock_movements for each row execute function stock_movements_immutable();

-- Связи партий: перемещение на другую площадку (и дальше — производство) создаёт дочернюю партию.
create table lot_links (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  parent_lot_id   uuid not null references lots(id),
  child_lot_id    uuid not null references lots(id),
  kind            text not null check (kind in ('transfer', 'production')),
  quantity        numeric not null check (quantity > 0),
  unit            text not null,
  created_at      timestamptz not null default now()
);
create index lot_links_parent_idx on lot_links(parent_lot_id);
create index lot_links_child_idx on lot_links(child_lot_id);

create table stock_counts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid not null references sites(id),
  status          text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  comment         text,
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  closed_by       uuid references users(id),
  closed_at       timestamptz
);
create unique index stock_counts_one_open on stock_counts(site_id) where status = 'open';

create table stock_count_lines (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  count_id        uuid not null references stock_counts(id),
  lot_id          uuid not null references lots(id),
  expected        numeric not null,
  counted         numeric check (counted is null or counted >= 0),
  note            text,
  counted_by      uuid references users(id),
  counted_at      timestamptz,
  unique (count_id, lot_id)
);

do $$
declare t text;
begin
  foreach t in array array['unit_conversions', 'operations', 'stock_movements', 'lot_links', 'stock_counts', 'stock_count_lines'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;

grant select, insert, update on unit_conversions, stock_counts, stock_count_lines to ceh_app;
grant select, insert on operations, stock_movements, lot_links to ceh_app;
grant update (reference_product_id) on products to ceh_app;
