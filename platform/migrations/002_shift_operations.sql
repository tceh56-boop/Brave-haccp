-- ЦЕХ — этап 2 ТЗ v2: экран сотрудника (приёмка, температуры, сроки, задачи, отклонения) и дашборд проблем.
--
-- Принципы ТЗ v2, заложенные в схему:
--  * §5: предел, частота и место контроля — только из утверждённого правила с основанием; универсальной
--    температуры в коде нет. Без утверждённого правила замер сохраняется с результатом «критерий не задан».
--  * §5, AT-04: замер хранит значение, единицу, объект, автора/датчик, время измерения и время внесения;
--    поздний ввод отмечается. Замер не изменяется и не удаляется — исправление пишется новой записью.
--  * §6, AT-02: срок годности партии — только с основанием (маркировка изготовителя и т.п.); без основания
--    «Срок не подтверждён» и задача ответственному.
--  * §4, AT-03: карантинная или незавершённая партия не попадает в доступный остаток.

-- ───────── Справочник товаров и поставщиков (минимум для приёмки; полный каталог — этап 3) ─────────

create table products (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name            text not null,
  unit            text not null check (unit in ('кг', 'г', 'л', 'мл', 'шт')),
  category        text,
  barcode         text,
  status          text not null default 'active' check (status in ('active', 'archived')),
  created_at      timestamptz not null default now()
);
create index products_org_idx on products(organization_id);
create unique index products_org_barcode on products(organization_id, barcode) where barcode is not null;

create table suppliers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name            text not null,
  inn             text,
  status          text not null default 'active' check (status in ('active', 'archived')),
  created_at      timestamptz not null default now()
);
create index suppliers_org_idx on suppliers(organization_id);

-- ───────── Объекты контроля и правила ─────────

create table control_objects (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid not null references sites(id),
  name            text not null,
  kind            text not null check (kind in ('fridge', 'freezer', 'room', 'hot_holding', 'line', 'other')),
  location        text,
  code            text not null,             -- для QR-наклейки на объекте
  status          text not null default 'active' check (status in ('active', 'archived')),
  created_at      timestamptz not null default now(),
  unique (organization_id, code)
);
create index control_objects_site_idx on control_objects(site_id);

create table control_rules (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations(id),
  control_object_id  uuid not null references control_objects(id),
  parameter          text not null default 'temperature' check (parameter in ('temperature', 'humidity')),
  unit               text not null check (unit in ('°C', '%')),
  min_value          numeric,
  max_value          numeric,
  frequency_hours    numeric check (frequency_hours is null or frequency_hours > 0),
  grace_minutes      integer not null default 30 check (grace_minutes >= 0),
  source_ref         text not null,           -- основание: документ, пункт, утверждённая процедура
  reaction           text,                    -- утверждённые шаги реакции на отклонение
  allow_isolation    boolean not null default false,
  status             text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  version            integer not null default 1,
  created_by         uuid not null references users(id),
  created_at         timestamptz not null default now(),
  approved_by        uuid references users(id),
  approved_at        timestamptz,
  retired_at         timestamptz,
  check (min_value is not null or max_value is not null),
  check (min_value is null or max_value is null or min_value <= max_value)
);
-- У объекта одновременно действует не более одного утверждённого правила на параметр.
create unique index control_rules_one_active on control_rules(control_object_id, parameter) where status = 'approved';

create table measurements (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations(id),
  site_id            uuid not null references sites(id),
  control_object_id  uuid not null references control_objects(id),
  rule_id            uuid references control_rules(id),
  parameter          text not null,
  value              numeric not null,
  unit               text not null,
  measured_at        timestamptz not null,
  entered_at         timestamptz not null default now(),
  is_late            boolean not null default false,
  author_user_id     uuid references users(id),
  sensor_id          text,
  device             text,
  criterion          text,                    -- снимок критерия на момент замера
  result             text not null check (result in ('ok', 'deviation', 'no_criterion')),
  comment            text,
  corrects_id        uuid references measurements(id),
  correction_reason  text,
  check (author_user_id is not null or sensor_id is not null),
  check (corrects_id is null or correction_reason is not null)
);
create index measurements_obj_idx on measurements(control_object_id, measured_at desc);

create function measurements_immutable() returns trigger language plpgsql as $$
begin raise exception 'Замер нельзя изменить или удалить — внесите исправление новой записью с причиной'; end $$;
create trigger measurements_no_update before update or delete on measurements for each row execute function measurements_immutable();

-- ───────── Приёмка и партии ─────────

create table receipts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid not null references sites(id),
  supplier_id     uuid references suppliers(id),
  document_no     text,
  document_date   date,
  -- §4: Черновик; Принято; На проверке; Карантин; Отказано; Возвращено.
  status          text not null default 'draft' check (status in ('draft', 'accepted', 'review', 'quarantine', 'rejected', 'returned')),
  comment         text,
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  completed_by    uuid references users(id),
  completed_at    timestamptz
);
create index receipts_site_idx on receipts(site_id, created_at desc);

create table lots (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations(id),
  site_id            uuid not null references sites(id),
  product_id         uuid not null references products(id),
  receipt_line_id    uuid,
  lot_no             text,
  quantity           numeric not null check (quantity >= 0),
  unit               text not null,
  received_at        timestamptz not null default now(),
  manufactured_at    date,
  expires_at         timestamptz,
  expiry_basis       text,                    -- основание срока; null — срок не подтверждён
  storage_object_id  uuid references control_objects(id),
  status             text not null check (status in ('available', 'quarantine', 'blocked', 'consumed', 'written_off')),
  status_reason      text,
  created_at         timestamptz not null default now(),
  check (expires_at is null or expiry_basis is not null)
);
create index lots_site_idx on lots(site_id, status, expires_at);
create index lots_storage_idx on lots(storage_object_id) where status in ('available', 'quarantine');

create table receipt_lines (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations(id),
  receipt_id         uuid not null references receipts(id),
  product_id         uuid not null references products(id),
  quantity           numeric not null check (quantity > 0),
  unit               text not null,
  lot_no             text,
  manufactured_at    date,
  expires_at         timestamptz,
  expiry_basis       text,
  temperature        numeric,
  checks             jsonb not null default '{}',   -- packaging / labeling / documents / quality: true | false
  decision           text not null check (decision in ('accepted', 'quarantine', 'rejected')),
  decision_reason    text,
  storage_object_id  uuid references control_objects(id),
  lot_id             uuid references lots(id),
  created_at         timestamptz not null default now(),
  check (expires_at is null or expiry_basis is not null),
  check (decision = 'accepted' or decision_reason is not null)
);
create index receipt_lines_receipt_idx on receipt_lines(receipt_id);
alter table lots add constraint lots_receipt_line_fk foreign key (receipt_line_id) references receipt_lines(id);

-- ───────── Задачи, инциденты, уведомления ─────────

create table tasks (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id),
  site_id          uuid references sites(id),
  kind             text not null,
  title            text not null,
  details          text,
  entity_type      text,
  entity_id        uuid,
  assignee_role    text,
  assignee_user_id uuid references users(id),
  due_at           timestamptz,
  status           text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  result           text,
  created_by       uuid references users(id),       -- null — создано системой
  created_at       timestamptz not null default now(),
  done_by          uuid references users(id),
  done_at          timestamptz
);
create index tasks_open_idx on tasks(organization_id, status, due_at);
-- Одна открытая задача одного вида на объект: повторное событие не плодит дубли.
create unique index tasks_open_unique on tasks(organization_id, kind, entity_id) where status = 'open' and entity_id is not null;

create table incidents (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organizations(id),
  site_id               uuid references sites(id),
  severity              text not null check (severity in ('critical', 'high', 'medium', 'low')),
  kind                  text not null check (kind in ('temperature_deviation', 'receipt_problem', 'expired_lot', 'reported')),
  title                 text not null,
  what                  text not null,
  entity_type           text,
  entity_id             uuid,
  -- §2: Новая → В работе → Ожидает проверки → Закрыта.
  status                text not null default 'new' check (status in ('new', 'in_progress', 'pending_review', 'closed')),
  responsible_role      text,
  responsible_user_id   uuid references users(id),
  due_at                timestamptz,
  rule_source           text,
  recommended_action    text,
  requires_confirmation boolean not null default true,
  action_note           text,
  action_by             uuid references users(id),
  action_at             timestamptz,
  confirmed_by          uuid references users(id),
  confirmed_at          timestamptz,
  closed_at             timestamptz,
  created_by            uuid references users(id),
  created_at            timestamptz not null default now(),
  check (status <> 'closed' or action_at is not null),
  check (status <> 'closed' or not requires_confirmation or confirmed_at is not null)
);
create index incidents_open_idx on incidents(organization_id, status, severity);

create table incident_events (
  id              bigserial primary key,
  organization_id uuid not null references organizations(id),
  incident_id     uuid not null references incidents(id),
  at              timestamptz not null default now(),
  user_id         uuid references users(id),
  event           text not null,
  note            text,
  data            jsonb
);
create index incident_events_idx on incident_events(incident_id, id);

create table notifications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid references sites(id),
  role            text,
  user_id         uuid references users(id),
  title           text not null,
  body            text,
  entity_type     text,
  entity_id       uuid,
  created_at      timestamptz not null default now(),
  check (role is not null or user_id is not null)
);
create index notifications_org_idx on notifications(organization_id, created_at desc);

create table notification_reads (
  notification_id uuid not null references notifications(id),
  user_id         uuid not null references users(id),
  organization_id uuid not null references organizations(id),
  read_at         timestamptz not null default now(),
  primary key (notification_id, user_id)
);

-- ───────── Row-Level Security: все таблицы этапа — строго внутри организации ─────────

do $$
declare t text;
begin
  foreach t in array array['products', 'suppliers', 'control_objects', 'control_rules', 'measurements', 'receipts', 'receipt_lines',
                           'lots', 'tasks', 'incidents', 'incident_events', 'notifications', 'notification_reads'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;

grant select, insert, update on products, suppliers, control_objects, control_rules, receipts, receipt_lines, lots, tasks, incidents to ceh_app;
grant select, insert on measurements, incident_events, notifications, notification_reads to ceh_app;
grant delete on receipt_lines to ceh_app;  -- только строки черновика (проверка статуса — на сервере)
grant usage on sequence incident_events_id_seq to ceh_app;
