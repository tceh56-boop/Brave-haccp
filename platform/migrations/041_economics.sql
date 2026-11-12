-- ЦЕХ — экономический контур P2 (ТЗ доработки, раздел 9): отдельные статьи «эквайринг» и «доставка»;
-- бюджет (план) по статьям на месяц для план-факта. Бюджет не изменяется — новая запись заменяет прежнюю (история сохраняется).
alter table expenses drop constraint expenses_category_check;
alter table expenses add constraint expenses_category_check check (category in ('payroll', 'rent', 'utilities', 'marketing', 'services', 'equipment', 'taxes', 'acquiring', 'delivery', 'other'));

create table budgets (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid references sites(id),
  month           date not null check (extract(day from month) = 1),
  item            text not null,            -- revenue | статья расходов
  amount          numeric not null check (amount >= 0),
  note            text,
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now()
);
create index budgets_org_idx on budgets(organization_id, month);
create trigger budgets_no_update before update or delete on budgets for each row execute function tech_data_immutable();
alter table budgets enable row level security;
create policy budgets_tenant on budgets for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id));
grant select, insert on budgets to ceh_app;
