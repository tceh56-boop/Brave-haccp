-- ЦЕХ — этап 6 ТЗ v2 (часть 2): касса, продажи, списание по ТТК, стоп-лист, импорт продаж внешней кассы.
--
-- Механика — модуль «Касса и зал» прежнего ЦЕХ (Pos.gs): смена с наличными на начало и сверкой при закрытии;
-- сумма заказа считается на сервере по цене блюда; повтор оплаты с тем же ключом операции не создаёт вторую
-- оплату (ТЗ v2 AT-12); возврат — отрицательной строкой оплаты и продажи; стоп-лист ручной и автоматический по
-- годному остатку и утверждённой ТТК; оплата → продажа → списание по ТТК (FEFO), ошибка — в очередь и задача шефу.
-- ТЗ v2 §10: фискальный чек пробивает ККТ предприятия — система её не заменяет; ключ операции — ключ чека.

create table pos_shifts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid not null references sites(id),
  opened_by       uuid not null references users(id),
  opened_at       timestamptz not null default now(),
  cash_start      numeric not null check (cash_start >= 0),
  status          text not null default 'open' check (status in ('open', 'closed')),
  closed_by       uuid references users(id),
  closed_at       timestamptz,
  cash_fact       numeric,
  totals          jsonb,
  check (status = 'open' or (closed_at is not null and cash_fact is not null and totals is not null))
);
create unique index pos_shifts_one_open on pos_shifts(site_id) where status = 'open';

create table pos_orders (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid not null references sites(id),
  shift_id        uuid not null references pos_shifts(id),
  number          integer not null,
  table_label     text,
  guests          integer,
  status          text not null default 'open' check (status in ('open', 'paid', 'cancelled', 'refunded')),
  total           numeric not null default 0,
  refunded        numeric not null default 0,
  version         integer not null default 1,
  comment         text,
  cancel_reason   text,
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  paid_at         timestamptz,
  unique (shift_id, number),
  check (status <> 'cancelled' or cancel_reason is not null)
);

create table pos_order_lines (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  order_id        uuid not null references pos_orders(id),
  dish_id         uuid not null references dishes(id),
  name            text not null,                -- снимок названия
  qty             numeric not null check (qty > 0),
  price           numeric not null check (price >= 0),   -- снимок цены на момент заказа
  amount          numeric not null,
  status          text not null default 'new' check (status in ('new', 'removed', 'sold', 'refunded')),
  created_at      timestamptz not null default now()
);

create table pos_payments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid not null references sites(id),
  shift_id        uuid not null references pos_shifts(id),
  order_id        uuid not null references pos_orders(id),
  method          text not null check (method in ('cash', 'card', 'other')),
  amount          numeric not null check (amount <> 0),     -- возврат — отрицательная сумма
  kind            text not null check (kind in ('payment', 'refund')),
  reason          text,
  operation_id    text not null,
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  check ((kind = 'payment') = (amount > 0)),
  check (kind = 'payment' or reason is not null)
);

-- Продажа — единая строка для кассы и импорта внешней кассы; внешний ID уникален (повтор не дублирует).
create table sales (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid not null references sites(id),
  source          text not null,                -- pos | iiko | r_keeper | other
  external_id     text not null,
  dish_id         uuid references dishes(id),
  name            text not null,
  qty             numeric not null check (qty <> 0),           -- возврат — отрицательное количество
  price           numeric not null,
  amount          numeric not null,
  sold_at         timestamptz not null,
  order_line_id   uuid references pos_order_lines(id),
  fulfil_status   text not null check (fulfil_status in ('pending', 'done', 'failed', 'no_ttk', 'unmatched', 'not_required')),
  fulfil_error    text,
  ttk_version_id  uuid references ttk_versions(id),
  cost            numeric,                      -- себестоимость списанного по ценам партий; null — неизвестна
  fulfilled_at    timestamptz,
  created_by      uuid references users(id),
  created_at      timestamptz not null default now(),
  unique (organization_id, source, external_id)
);
create index sales_site_date_idx on sales(organization_id, site_id, sold_at);
create index sales_queue_idx on sales(organization_id, fulfil_status) where fulfil_status in ('failed', 'no_ttk', 'unmatched', 'pending');

-- Название позиции внешней кассы → блюдо: сопоставили раз — применяется ко всем продажам с этим названием.
create table sale_aliases (
  organization_id uuid not null references organizations(id),
  source          text not null,
  name_norm       text not null,
  dish_id         uuid not null references dishes(id),
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  primary key (organization_id, source, name_norm)
);

create table stop_list (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid not null references sites(id),
  dish_id         uuid not null references dishes(id),
  reason          text not null,
  source          text not null check (source in ('manual', 'auto')),
  created_by      uuid references users(id),
  created_at      timestamptz not null default now(),
  lifted_at       timestamptz,
  lifted_by       uuid references users(id)
);
create unique index stop_list_one_active on stop_list(site_id, dish_id, source) where lifted_at is null;

-- Оплаты и продажи не правятся и не удаляются: исправление — возвратом.
create function pos_immutable() returns trigger language plpgsql as $$
begin raise exception 'Оплата не изменяется и не удаляется — оформите возврат'; end $$;
create trigger pos_payments_no_update before update or delete on pos_payments for each row execute function pos_immutable();

create function sales_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Продажа не удаляется — оформите возврат'; end if;
  if new.qty is distinct from old.qty or new.price is distinct from old.price or new.amount is distinct from old.amount or new.sold_at is distinct from old.sold_at
     or new.external_id is distinct from old.external_id or new.site_id is distinct from old.site_id then
    raise exception 'Сумма, количество и время продажи не изменяются — оформите возврат';
  end if;
  return new;
end $$;
create trigger sales_guard before update or delete on sales for each row execute function sales_guard();


do $$
declare t text;
begin
  foreach t in array array['pos_shifts', 'pos_orders', 'pos_order_lines', 'pos_payments', 'sales', 'sale_aliases', 'stop_list'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;

grant select, insert, update on pos_shifts, pos_orders, pos_order_lines, sales, stop_list to ceh_app;
grant select, insert on pos_payments to ceh_app;
grant select, insert, update on sale_aliases to ceh_app;
