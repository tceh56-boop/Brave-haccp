-- ЦЕХ — калькуляционная карточка (унифицированная форма ОП-1, постановление Госкомстата России от 25.12.98 № 132).
-- Калькуляция — снимок норм и цен на дату утверждения по утверждённой ТТК: изменилась цена — новая калькуляция
-- (порядковый номер по блюду). Неизвестная цена ≠ 0: без цены партии цену вводит человек с основанием.

create table costing_cards (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  dish_id         uuid not null references dishes(id),
  ttk_version_id  uuid not null references ttk_versions(id),
  site_id         uuid references sites(id),                 -- структурное подразделение
  seq             integer not null,                          -- порядковый номер калькуляции блюда
  doc_no          text,                                      -- номер документа (номер рецептуры)
  calc_date       date not null,
  basis_qty       numeric not null,                          -- на сколько блюд (порций / кг выхода п/ф) — 1
  basis_label     text not null,                             -- «1 блюдо, 300 г» / «1 кг выхода»
  lines           jsonb not null,                            -- [{name, unit, norm, price, sum, price_source}]
  raw_100         numeric not null,                          -- стоимость сырьевого набора на 100 блюд
  cost_1          numeric not null,                          -- себестоимость 1 блюда
  sale_price      numeric check (sale_price is null or sale_price >= 0),
  markup_pct      numeric,
  yield_g         numeric,
  signers         jsonb not null default '{}',               -- {chef, accountant, director}
  approved_by     uuid not null references users(id),
  approved_at     timestamptz not null default now(),
  unique (dish_id, seq)
);
create index costing_cards_dish_idx on costing_cards(dish_id, seq desc);

create trigger costing_cards_no_update before update or delete on costing_cards for each row execute function tech_data_immutable();

alter table costing_cards enable row level security;
create policy costing_cards_tenant on costing_cards for all to ceh_app
  using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id));
grant select, insert on costing_cards to ceh_app;
