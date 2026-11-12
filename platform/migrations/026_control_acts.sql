-- ЦЕХ — акт контрольной проработки кулинарной продукции, определения норм отходов и потерь (ГОСТ 31988-2012).
-- Черновик заполняется из ТТК (плановые массы), комиссия вписывает фактические массы; проценты отходов — по массам:
-- при холодной (брутто → нетто), при тепловой (нетто → после тепловой), после тепловой (→ выход).
-- Утверждённый акт не меняется; на него ссылаются нормы обработки как на основание.

create table control_acts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid references sites(id),                 -- место проведения
  dish_id         uuid not null references dishes(id),
  ttk_version_id  uuid not null references ttk_versions(id),
  number          integer not null,
  act_date        date not null,
  commission      jsonb not null default '[]',               -- [{position, name}]
  lines           jsonb not null,                            -- [{name, unit, processing, brutto, netto, thermal, ready}] — граммы
  output_g        numeric check (output_g is null or output_g > 0),
  technology      text,
  note            text,
  status          text not null default 'draft' check (status in ('draft', 'approved')),
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  approved_by     uuid references users(id),
  approved_at     timestamptz,
  unique (organization_id, number),
  check (status = 'draft' or (approved_by is not null and approved_at is not null))
);
create index control_acts_dish_idx on control_acts(dish_id, number desc);

create function control_act_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'approved' then raise exception 'Утверждённый акт не удаляется'; end if;
    return old;
  end if;
  if old.status = 'approved' then raise exception 'Утверждённый акт не изменяется'; end if;
  return new;
end $$;
create trigger control_acts_guard before update or delete on control_acts for each row execute function control_act_guard();

alter table control_acts enable row level security;
create policy control_acts_tenant on control_acts for all to ceh_app
  using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id));
grant select, insert, update, delete on control_acts to ceh_app;
