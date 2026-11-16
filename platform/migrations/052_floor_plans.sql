-- ТЗ 3.0 §15.2, §15.4; мастер-промт, раздел 4: 2D-план предприятия — мастер-модель (3D строится из неё позже).
-- Геометрия хранится в реальных единицах (мм), независимо от способа отображения. Подложка (чертёж) — файл
-- с калибровкой «сколько мм в пикселе». Утверждённая версия не меняется: правки — новой версией (снимок + хеш).
create table floor_plans (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid not null references sites(id),
  name            text not null,
  width_mm        integer not null check (width_mm between 1000 and 500000),
  height_mm       integer not null check (height_mm between 1000 and 500000),
  background_file_id uuid references evidence_files(id),
  bg_mm_per_px    numeric check (bg_mm_per_px is null or bg_mm_per_px > 0),     -- калибровка по известному размеру
  bg_offset_x     numeric not null default 0,
  bg_offset_y     numeric not null default 0,
  revision        integer not null default 1,                                   -- для защиты от одновременной правки
  status          text not null default 'draft' check (status in ('draft', 'archived')),
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index floor_plans_site_idx on floor_plans(organization_id, site_id);

-- объекты плана: помещения, стены, двери, окна, зоны, оборудование и мебель — прямоугольник с поворотом
create table plan_objects (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  plan_id         uuid not null references floor_plans(id),
  kind            text not null,                                               -- из библиотеки (src/lib/floorplan.ts)
  label           text,
  x_mm            numeric not null, y_mm numeric not null,                     -- центр
  w_mm            numeric not null check (w_mm > 0), h_mm numeric not null check (h_mm > 0),
  rotation        numeric not null default 0,                                   -- градусы
  zone_class      text,                                                         -- сырьё, п/ф, готовое, отходы, чистое, грязное, химия, персонал
  equipment_id    uuid references equipment(id),
  size_confirmed  boolean not null default false,                               -- габарит по паспорту/замеру, а не условный
  props           jsonb not null default '{}'
);
create index plan_objects_plan_idx on plan_objects(plan_id);

-- маршруты потоков: ломаная в мм
create table plan_routes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  plan_id         uuid not null references floor_plans(id),
  flow            text not null check (flow in ('raw', 'semi', 'ready', 'staff', 'clean_inventory', 'dirty_inventory', 'waste', 'return_tare', 'allergen')),
  label           text,
  points          jsonb not null                                                -- [[x_mm, y_mm], ...], не менее 2 точек
);
create index plan_routes_plan_idx on plan_routes(plan_id);

-- утверждённые версии плана: неизменяемый снимок с хешем
create table floor_plan_versions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  plan_id         uuid not null references floor_plans(id),
  version         integer not null,
  snapshot        jsonb not null,
  content_hash    text not null,
  change_note     text not null,
  approved_by     uuid not null references users(id),
  approved_at     timestamptz not null default now(),
  unique (plan_id, version)
);

-- решения специалиста по выявленным потенциальным рискам (пересечения, наложения): риск — не доказанное нарушение
create table plan_risk_decisions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  plan_id         uuid not null references floor_plans(id),
  risk_key        text not null,                                               -- детерминированный ключ риска
  decision        text not null check (decision in ('confirmed', 'rejected')),
  rationale       text not null,
  measure         text,
  decided_by      uuid not null references users(id),
  decided_at      timestamptz not null default now(),
  unique (plan_id, risk_key)
);

do $$ declare t text; begin
  foreach t in array array['floor_plans', 'plan_objects', 'plan_routes', 'floor_plan_versions', 'plan_risk_decisions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;
grant select, insert, update on floor_plans, plan_risk_decisions to ceh_app;
grant select, insert, update, delete on plan_objects, plan_routes to ceh_app;
grant select, insert on floor_plan_versions to ceh_app;
create trigger floor_plan_versions_immutable before update or delete on floor_plan_versions for each row execute function tech_data_immutable();
