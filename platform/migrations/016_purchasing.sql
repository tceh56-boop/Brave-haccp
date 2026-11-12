-- Этап 12: закупки (перенос Purchasing.gs прежнего ЦЕХ и MON CHEF 1.4–1.5, 1.12).
--  * Норма запаса на площадке: вручную (с основанием) или автоматически — средний расход в день за окно × дни
--    покрытия × (1 + страховой %). «Что заказать» = норма − годный остаток − уже заказанное.
--  * Заказ поставщику: черновик → отправлен → подтверждён → принят (или отменён с причиной). Поставщику с
--    блокировкой заказ не создаётся. Приёмка по заказу — обычная приёмка с проверками; после её завершения
--    заказ «принят», расхождения «заказано / принято» видны в заказе.

alter table suppliers add column phone text;
alter table suppliers add column email text;
alter table suppliers add column blocked_reason text;      -- не пусто — поставщик заблокирован для заказов

create table stock_norms (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid not null references sites(id),
  product_id      uuid not null references products(id),
  mode            text not null check (mode in ('manual', 'auto')),
  min_qty         numeric check (min_qty is null or min_qty >= 0),
  cover_days      numeric not null default 3 check (cover_days > 0 and cover_days <= 90),
  safety_pct      numeric not null default 20 check (safety_pct >= 0 and safety_pct <= 300),
  window_days     integer not null default 28 check (window_days between 7 and 180),
  basis           text,
  updated_by      uuid references users(id),
  updated_at      timestamptz not null default now(),
  unique (site_id, product_id),
  check (mode <> 'manual' or (min_qty is not null and basis is not null))
);

create table supplier_orders (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid not null references sites(id),
  supplier_id     uuid not null references suppliers(id),
  number          integer not null,
  status          text not null default 'draft' check (status in ('draft', 'sent', 'confirmed', 'received', 'cancelled')),
  expected_at     date,
  note            text,
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  sent_by         uuid references users(id),
  sent_at         timestamptz,
  confirmed_at    timestamptz,
  receipt_id      uuid references receipts(id),
  received_at     timestamptz,
  cancel_reason   text,
  unique (organization_id, number),
  check (status <> 'cancelled' or cancel_reason is not null)
);
create index supplier_orders_site_idx on supplier_orders(site_id, status, created_at desc);

create table supplier_order_lines (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  order_id        uuid not null references supplier_orders(id),
  product_id      uuid not null references products(id),
  quantity        numeric not null check (quantity > 0),
  unit            text not null,
  price           numeric check (price is null or price >= 0),
  note            text,
  unique (order_id, product_id)
);

alter table receipts add column supplier_order_id uuid references supplier_orders(id);

do $$
declare t text;
begin
  foreach t in array array['stock_norms', 'supplier_orders', 'supplier_order_lines'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;

grant select, insert, update on supplier_orders to ceh_app;
grant select, insert, update, delete on stock_norms to ceh_app;          -- «снять норму» удаляет строку (история — в аудите)
grant select, insert, update, delete on supplier_order_lines to ceh_app;   -- удаление строк — только в черновике (проверка на сервере)
