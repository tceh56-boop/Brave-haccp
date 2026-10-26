-- ЦЕХ — технологическая инструкция (ТИ) на продукцию: титульный лист, 9 разделов, лист регистрации изменений.
-- Расчётная часть — из утверждённой ТТК (рецептура, обработка сырья с нормами), контроль — из системы (ККТ при выпуске,
-- программа лабораторного контроля, суточные пробы), санитария — из плана санитарной обработки и нормативного реестра.
-- Что система не знает (НД на сырьё, упаковка и маркировка, охрана труда), вписывает технолог; параметры — в tech_specs.params.
-- Утверждённая ТИ — неизменяемый снимок; версии образуют лист регистрации изменений.

create table ti_versions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  dish_id         uuid not null references dishes(id),
  version         integer not null,
  ttk_version_id  uuid not null references ttk_versions(id),
  designation     text not null,
  snapshot        jsonb not null,
  change_note     text not null,
  approved_by     uuid not null references users(id),
  approved_at     timestamptz not null default now(),
  unique (dish_id, version)
);
create trigger ti_versions_no_update before update or delete on ti_versions for each row execute function tech_data_immutable();

alter table ti_versions enable row level security;
create policy ti_versions_tenant on ti_versions for all to ceh_app
  using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id));
grant select, insert on ti_versions to ceh_app;
