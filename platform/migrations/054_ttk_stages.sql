-- Мастер-промт, раздел 6: ТТК — исполняемая карта маршрута. Этап: операция, место на 2D-плане (стол, оборудование, зона),
-- состояние продукта после этапа (сырьё / п/ф / готовое), параметры и контроль — как в утверждённой технологии.
-- Ссылка на объект плана — по стабильному идентификатору (объекты плана пересохраняются целиком).
-- Утверждённая версия ТТК не меняется — как и её строки.
create table ttk_stages (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  version_id      uuid not null references ttk_versions(id),
  position        integer not null,
  operation       text not null,
  plan_id         uuid references floor_plans(id),
  plan_object_id  uuid,
  state           text not null check (state in ('raw', 'semi', 'ready')),
  params          text,                                -- режим: температура, время — из технологии ТТК
  control         text,                                -- что контролируется на этапе
  check ((plan_id is null) = (plan_object_id is null)),
  unique (version_id, position)
);
create index ttk_stages_plan_idx on ttk_stages(plan_id);

create function ttk_stages_locked() returns trigger language plpgsql as $$
declare st text;
begin
  select status into st from ttk_versions where id = coalesce(new.version_id, old.version_id);
  if st <> 'draft' then raise exception 'ТТК не в черновике — изменения вносятся новой версией'; end if;
  return coalesce(new, old);
end $$;
create trigger ttk_stages_lock before insert or update or delete on ttk_stages for each row execute function ttk_stages_locked();

alter table ttk_stages enable row level security;
create policy ttk_stages_tenant on ttk_stages for all to ceh_app
  using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id));
grant select, insert, update, delete on ttk_stages to ceh_app;
