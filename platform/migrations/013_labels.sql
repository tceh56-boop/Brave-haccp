-- Этап 9: маркировка партий и вскрытие тары (перенос из прежнего ЦЕХ: Labeling.gs, MON CHEF 8.1–8.2).
--  * Срок после вскрытия задаётся на товаре только с основанием (маркировка изготовителя, утверждённое правило).
--    Без него система срок не назначает: сотрудник вводит срок и основание с маркировки при вскрытии.
--  * Вскрытие — дочерняя партия (lot_links.kind = 'opened') с новым сроком: раньше из срока изготовителя
--    и «вскрыто + N часов». Количество переходит движениями open_out / open_in.
--  * Этикетка — неизменяемый снимок данных партии на момент печати; QR ведёт на карточку партии.
--  * Журнал маркировки — каждая печать (сколько, в каком формате, кто), только дописывание.

alter table products add column opened_shelf_hours numeric check (opened_shelf_hours is null or opened_shelf_hours > 0);
alter table products add column opened_shelf_basis text;
alter table products add constraint products_opened_shelf_basis check (opened_shelf_hours is null or opened_shelf_basis is not null);

alter table lots add column opened_at timestamptz;

alter table lot_links drop constraint lot_links_kind_check;
alter table lot_links add constraint lot_links_kind_check check (kind in ('transfer', 'production', 'opened'));

alter table stock_movements drop constraint stock_movements_kind_check;
alter table stock_movements add constraint stock_movements_kind_check
  check (kind in ('receipt', 'consume', 'write_off', 'transfer_out', 'transfer_in', 'count_adjust', 'return_to_supplier', 'open_out', 'open_in'));

create table labels (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid not null references sites(id),
  lot_id          uuid not null references lots(id),
  code            text not null unique check (code ~ '^[A-Z2-9]{8}$'),   -- короткий код для QR и ручного ввода
  kind            text not null check (kind in ('lot', 'opened')),
  payload         jsonb not null,                                        -- что напечатано: товар, партия, даты, предупреждения
  created_by      uuid references users(id),
  created_at      timestamptz not null default now()
);
create index labels_lot_idx on labels(lot_id, created_at desc);

create table label_prints (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid not null references sites(id),
  label_id        uuid not null references labels(id),
  copies          integer not null check (copies between 1 and 100),
  format          text not null check (format in ('58x40', '58x30', 'a4')),
  printed_by      uuid not null references users(id),
  printed_at      timestamptz not null default now()
);
create index label_prints_site_idx on label_prints(site_id, printed_at desc);

create function labels_immutable() returns trigger language plpgsql as $$
begin raise exception 'Этикетки и журнал маркировки не изменяются и не удаляются'; end $$;
create trigger labels_no_update before update or delete on labels for each row execute function labels_immutable();
create trigger label_prints_no_update before update or delete on label_prints for each row execute function labels_immutable();

do $$
declare t text;
begin
  foreach t in array array['labels', 'label_prints'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;

grant select, insert on labels, label_prints to ceh_app;
