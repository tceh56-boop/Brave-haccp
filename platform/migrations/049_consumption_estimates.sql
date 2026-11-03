-- Мастер-промт, раздел 2; ТЗ 3.0 §11.4, §12.5: расчётное потребление хранится отдельно от фактического расхода.
-- Движения склада (stock_movements) — только факт. Норма по ТТК на фактический выход и потребление по продажам —
-- здесь, с версией ТТК, из которой рассчитаны.
create table consumption_estimates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid not null references sites(id),
  kind            text not null check (kind in ('production_norm', 'sale')),
  ref_type        text not null,
  ref_id          uuid not null,
  product_id      uuid not null references products(id),
  quantity        numeric not null check (quantity >= 0),
  unit            text not null,
  ttk_version_id  uuid references ttk_versions(id),
  basis           text not null,                       -- как получено: «ТТК «X» v3 на 1,2 кг выхода»
  created_by      uuid references users(id),
  created_at      timestamptz not null default now()
);
create index consumption_estimates_ref_idx on consumption_estimates(ref_type, ref_id);
create index consumption_estimates_site_idx on consumption_estimates(organization_id, site_id, kind, created_at);

alter table consumption_estimates enable row level security;
create policy consumption_estimates_tenant on consumption_estimates for all to ceh_app
  using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id));
grant select, insert on consumption_estimates to ceh_app;

-- фактический расход выпуска против нормы: отклонения по позициям (снимок при выпуске)
alter table production_orders add column consumption_deviation jsonb;
