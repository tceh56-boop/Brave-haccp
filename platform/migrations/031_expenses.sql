-- ЦЕХ — расходы предприятия для управленческой экономики (P&L, Prime Cost), как модуль Expenses прежнего ЦЕХ.
-- Разовый расход относится на дату, ежемесячный — на месяц и распределяется по дням точно (доля дней месяца в периоде).
-- Записи не изменяются: ошибочную аннулируют с причиной (история сохраняется).

create table expenses (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid references sites(id),                         -- пусто — на всё предприятие
  category        text not null check (category in ('payroll', 'rent', 'utilities', 'marketing', 'services', 'equipment', 'taxes', 'other')),
  kind            text not null check (kind in ('once', 'monthly')),
  on_date         date not null,                                     -- разовый — дата; ежемесячный — первое число месяца
  amount          numeric not null check (amount > 0),
  title           text not null,
  basis           text,                                              -- документ: договор, счёт, ведомость
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  voided_by       uuid references users(id),
  voided_at       timestamptz,
  void_reason     text,
  check (kind = 'once' or extract(day from on_date) = 1),
  check ((voided_at is null) = (voided_by is null))
);
create index expenses_org_idx on expenses(organization_id, on_date);

create function expense_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Расход не удаляется — аннулируйте с причиной'; end if;
  if old.voided_at is not null then raise exception 'Аннулированный расход не изменяется'; end if;
  if (new.site_id, new.category, new.kind, new.on_date, new.amount, new.title, new.basis) is distinct from (old.site_id, old.category, old.kind, old.on_date, old.amount, old.title, old.basis) then
    raise exception 'Расход не изменяется — аннулируйте и внесите заново';
  end if;
  return new;
end $$;
create trigger expenses_guard before update or delete on expenses for each row execute function expense_guard();

alter table expenses enable row level security;
create policy expenses_tenant on expenses for all to ceh_app
  using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id));
grant select, insert, update on expenses to ceh_app;
