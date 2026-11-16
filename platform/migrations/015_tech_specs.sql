-- Этап 11: технические условия (ТУ) из ТТК (перенос TechSpecCore.gs прежнего ЦЕХ, Stage 106; MON CHEF 9–10).
--  * Пищевая ценность товара по документу (маркировка изготовителя, протокол) — подтверждённые данные для расчёта;
--    без них используется справочник MON CHEF со статусом «требует проверки».
--  * Профиль аллергенов товара по ТР ТС 022/2011 вводит человек по документу («содержит» / «не содержит»);
--    действует последняя запись. По названию система только подсказывает, что проверить.
--  * Параметры ТУ блюда/п/ф (микробиология, допуск, обозначение…) — черновик; утверждённая ТУ — неизменяемый снимок
--    расчёта с протоколом испытаний аккредитованной лаборатории.

create table product_nutrition (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  product_id      uuid not null references products(id),
  kcal_100        numeric not null check (kcal_100 >= 0),
  protein_100     numeric not null check (protein_100 >= 0),
  fat_100         numeric not null check (fat_100 >= 0),
  carbs_100       numeric not null check (carbs_100 >= 0),
  basis           text not null,
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now()
);
create index product_nutrition_idx on product_nutrition(product_id, created_at desc);

create table product_allergens (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  product_id      uuid not null references products(id),
  allergens       text[] not null,                  -- коды по ТР ТС 022/2011; пустой массив — «не содержит»
  basis           text not null,
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now()
);
create index product_allergens_idx on product_allergens(product_id, created_at desc);

create table tech_specs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  dish_id         uuid not null references dishes(id) unique,
  params          jsonb not null default '{}',
  updated_by      uuid references users(id),
  updated_at      timestamptz not null default now()
);

create table tech_spec_versions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  dish_id         uuid not null references dishes(id),
  version         integer not null,
  ttk_version_id  uuid not null references ttk_versions(id),
  designation     text not null,
  snapshot        jsonb not null,
  lab_protocol    text not null,
  approved_by     uuid not null references users(id),
  approved_at     timestamptz not null default now(),
  unique (dish_id, version)
);

create function tech_data_immutable() returns trigger language plpgsql as $$
begin raise exception 'Данные по документу и утверждённые ТУ не изменяются и не удаляются — внесите новую запись'; end $$;
create trigger product_nutrition_no_update before update or delete on product_nutrition for each row execute function tech_data_immutable();
create trigger product_allergens_no_update before update or delete on product_allergens for each row execute function tech_data_immutable();
create trigger tech_spec_versions_no_update before update or delete on tech_spec_versions for each row execute function tech_data_immutable();

do $$
declare t text;
begin
  foreach t in array array['product_nutrition', 'product_allergens', 'tech_specs', 'tech_spec_versions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;

grant select, insert on product_nutrition, product_allergens, tech_spec_versions to ceh_app;
grant select, insert, update on tech_specs to ceh_app;
