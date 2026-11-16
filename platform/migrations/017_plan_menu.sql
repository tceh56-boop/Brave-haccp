-- Этап 13: «План-меню» — мероприятия и банкеты (перенос PlanMenu.gs и банкетного бланка Stage 114 прежнего ЦЕХ).
--  * Мероприятие на площадке: дата, время, гости, формат, контакт. Статусы: план → подтверждено → проведено
--    (или отменено с причиной).
--  * Позиции меню: блюдо и порции. Норма на гостя (порции пересчитываются при смене числа гостей) или
--    фиксированное число порций (как на бланке заказа). Цена порции — из карточки блюда, можно задать свою.
--  * Потребность в сырье и п/ф считается по утверждённым ТТК; нехватка → заказ поставщику (связь с мероприятием).
--  * «Проведено»: фактические порции, списание по ТТК (FEFO) с источником «мероприятие», себестоимость и выручка.

create table plan_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid not null references sites(id),
  number          integer not null,
  title           text not null,
  event_date      date not null,
  event_time      text,
  guests          integer not null check (guests > 0 and guests <= 10000),
  format          text,
  contact         text,
  note            text,
  status          text not null default 'planned' check (status in ('planned', 'confirmed', 'done', 'cancelled')),
  cancel_reason   text,
  revenue         numeric,
  cost            numeric,
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  confirmed_at    timestamptz,
  completed_by    uuid references users(id),
  completed_at    timestamptz,
  unique (organization_id, number),
  check (status <> 'cancelled' or cancel_reason is not null)
);
create index plan_events_site_idx on plan_events(site_id, event_date);

create table plan_event_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  event_id        uuid not null references plan_events(id),
  dish_id         uuid not null references dishes(id),
  per_guest       numeric check (per_guest is null or (per_guest > 0 and per_guest <= 20)),
  portions        numeric not null check (portions > 0),
  price           numeric check (price is null or price >= 0),
  note            text,
  actual_portions numeric check (actual_portions is null or actual_portions >= 0),
  cost            numeric,
  unique (event_id, dish_id)
);

alter table supplier_orders add column plan_event_id uuid references plan_events(id);
alter table production_orders add column plan_event_id uuid references plan_events(id);

do $$
declare t text;
begin
  foreach t in array array['plan_events', 'plan_event_items'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;

grant select, insert, update on plan_events to ceh_app;
grant select, insert, update, delete on plan_event_items to ceh_app;   -- удаление позиций — только до проведения (проверка на сервере)
