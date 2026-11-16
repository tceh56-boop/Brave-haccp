-- ЦЕХ — журналы J56/J57 (ТЗ доработки, 7.5): причина перепечати этикетки и подтверждение ответственного.
-- Запись печати неизменяема (013_labels), поэтому причина пишется при печати, подтверждение — отдельной записью.
alter table label_prints add column reason text;

create table label_print_confirmations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  print_id uuid not null unique references label_prints(id),
  confirmed_by uuid not null references users(id),
  confirmed_at timestamptz not null default now(),
  note text
);
create trigger label_print_confirmations_no_update before update or delete on label_print_confirmations for each row execute function labels_immutable();
alter table label_print_confirmations enable row level security;
create policy label_print_confirmations_tenant on label_print_confirmations for all to ceh_app
  using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id));
grant select, insert on label_print_confirmations to ceh_app;
