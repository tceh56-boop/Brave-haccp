-- ЦЕХ — этап 6 ТЗ v2 (часть 1): блюда и полуфабрикаты, ТТК с версиями и утверждением, себестоимость, КБЖУ,
-- архив ТТК (560 карт) как справочник.
--
-- ТЗ v1 §9, §12: ТТК утверждает человек; при производстве и продаже — списание по утверждённой версии.
-- Неизвестная цена ≠ 0: себестоимость без цены помечается неполной. КБЖУ — из справочника MON CHEF со статусом
-- проверки (блокер Б-5: все значения «REVIEW»).

-- Цена из документа поставки — за единицу партии.
alter table receipt_lines add column unit_price numeric check (unit_price is null or unit_price >= 0);
alter table lots add column unit_price numeric check (unit_price is null or unit_price >= 0);

-- Архив ТТК: справочник уровня платформы (как reference_products), только чтение для организаций.
create table ttk_archive (
  id             uuid primary key default gen_random_uuid(),
  source_path    text not null unique,
  category_path  text[] not null default '{}',
  name           text not null,
  yield_raw      text,
  yield_g        numeric,
  yield_source   text,
  basis          text,
  format         text,
  lines          jsonb not null default '[]',
  technology     text,
  issues         jsonb not null default '[]',
  imported_at    timestamptz not null default now()
);
grant select on ttk_archive to ceh_app;

create table dishes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name            text not null,
  kind            text not null default 'dish' check (kind in ('dish', 'semi')),   -- блюдо или полуфабрикат
  category        text,
  sale_price      numeric check (sale_price is null or sale_price >= 0),
  product_id      uuid references products(id),        -- п/ф как складская позиция (выпуск партии)
  archive_id      uuid references ttk_archive(id),
  status          text not null default 'active' check (status in ('active', 'archived')),
  created_by      uuid references users(id),
  created_at      timestamptz not null default now()
);
create unique index dishes_name_uniq on dishes(organization_id, lower(name)) where status = 'active';

create table ttk_versions (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations(id),
  dish_id            uuid not null references dishes(id),
  version            integer not null,
  status             text not null default 'draft' check (status in ('draft', 'review', 'approved', 'archived')),
  yield_g            numeric check (yield_g is null or yield_g > 0),     -- выход закладки
  portion_g          numeric check (portion_g is null or portion_g > 0), -- выход порции (для блюда)
  technology         text,
  storage_conditions text,
  shelf_life         text,
  quality            text,
  allergens          text,
  source             text not null default 'Собственная разработка',
  change_reason      text,
  created_by         uuid not null references users(id),
  created_at         timestamptz not null default now(),
  submitted_by       uuid references users(id),
  submitted_at       timestamptz,
  approved_by        uuid references users(id),
  approved_at        timestamptz,
  archived_at        timestamptz,
  return_note        text,
  unique (dish_id, version),
  check (status not in ('approved', 'archived') or (approved_by is not null and approved_at is not null))
);
create unique index ttk_one_approved on ttk_versions(dish_id) where status = 'approved';
create unique index ttk_one_open on ttk_versions(dish_id) where status in ('draft', 'review');

create table ttk_lines (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  version_id      uuid not null references ttk_versions(id),
  position        integer not null,
  name_raw        text not null,                     -- как в карте
  product_id      uuid references products(id),
  sub_dish_id     uuid references dishes(id),         -- полуфабрикат / вложенная ТТК
  unit            text not null check (unit in ('кг', 'г', 'л', 'мл', 'шт', 'порция')),
  brutto          numeric check (brutto is null or brutto >= 0),
  netto           numeric check (netto is null or netto >= 0),
  note            text,
  check (product_id is null or sub_dish_id is null)
);
create index ttk_lines_version_idx on ttk_lines(version_id, position);

-- Сопоставление «название в карте → товар» запоминается на организацию: сопоставили раз — применяется везде.
create table ingredient_aliases (
  organization_id uuid not null references organizations(id),
  name_norm       text not null,
  product_id      uuid references products(id),
  sub_dish_id     uuid references dishes(id),
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  primary key (organization_id, name_norm),
  check ((product_id is null) <> (sub_dish_id is null))
);

-- Утверждённая и архивная версия не меняется: изменения — новой версией.
create function ttk_lines_locked() returns trigger language plpgsql as $$
declare st text;
begin
  select status into st from ttk_versions where id = coalesce(new.version_id, old.version_id);
  if st <> 'draft' then raise exception 'ТТК не в черновике — изменения вносятся новой версией'; end if;
  return coalesce(new, old);
end $$;
create trigger ttk_lines_lock before insert or update or delete on ttk_lines for each row execute function ttk_lines_locked();

create function ttk_version_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Версия ТТК не удаляется'; end if;
  if old.status = 'archived' then raise exception 'Архивная версия ТТК не изменяется'; end if;
  if old.status = 'approved' and (new.status <> 'archived' or new.technology is distinct from old.technology or new.yield_g is distinct from old.yield_g
      or new.portion_g is distinct from old.portion_g or new.storage_conditions is distinct from old.storage_conditions or new.shelf_life is distinct from old.shelf_life) then
    raise exception 'Утверждённая ТТК не изменяется — создайте новую версию';
  end if;
  return new;
end $$;
create trigger ttk_versions_guard before update or delete on ttk_versions for each row execute function ttk_version_guard();

do $$
declare t text;
begin
  foreach t in array array['dishes', 'ttk_versions', 'ttk_lines', 'ingredient_aliases'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;

grant select, insert, update on dishes, ttk_versions to ceh_app;
grant select, insert, update, delete on ttk_lines, ingredient_aliases to ceh_app;
