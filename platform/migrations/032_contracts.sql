-- ЦЕХ — договоры предприятия: дезинсекция и дератизация, лаборатория, вывоз отходов, аренда, стирка спецодежды и др.
-- Нужны программе производственного контроля (раздел «договоры» паспорта объекта, дезинсекция, лабораторный контроль).
-- Реквизиты договора правятся (с записью в аудит), файлы договора — неизменяемые доказательства (evidence_files,
-- entity_type = 'contract'): скан или DOCX добавляется, но не удаляется. Расторжение — статус с датой и причиной.

create table contracts (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  site_id           uuid references sites(id),                       -- пусто — на всё предприятие
  kind              text not null check (kind in ('pest_control', 'lab', 'waste', 'lease', 'water', 'laundry', 'ventilation',
                                                  'equipment_service', 'medical', 'disinfection', 'grease_trap', 'other')),
  title             text not null,
  counterparty      text not null,
  counterparty_inn  text check (counterparty_inn is null or counterparty_inn ~ '^\d{10}(\d{2})?$'),
  number            text,
  signed_on         date,
  valid_from        date,
  valid_to          date,                                            -- пусто — бессрочный
  auto_renew        boolean not null default false,
  subject           text,                                            -- предмет, периодичность услуг (из договора)
  status            text not null default 'active' check (status in ('active', 'terminated')),
  terminated_on     date,
  terminate_reason  text,
  created_by        uuid not null references users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to >= valid_from),
  check ((status = 'terminated') = (terminated_on is not null))
);
create index contracts_org_idx on contracts(organization_id, kind);

create function contract_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Договор не удаляется — отметьте расторжение с причиной'; end if;
  if old.status = 'terminated' then raise exception 'Расторгнутый договор не изменяется — внесите новый'; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger contracts_guard before update or delete on contracts for each row execute function contract_guard();

alter table contracts enable row level security;
create policy contracts_tenant on contracts for all to ceh_app
  using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id));
grant select, insert, update on contracts to ceh_app;
