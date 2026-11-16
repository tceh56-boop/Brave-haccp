-- ЦЕХ — этап 1 ТЗ v2: организации, пользователи, роли, изоляция данных, аудит.
--
-- Изоляция двумя слоями:
--  1) сервер проверяет право роли на действие и область (организация/площадка);
--  2) Row-Level Security: приложение работает под ролью ceh_app, и строка организации видна
--     только активному участнику этой организации — даже если код по ошибке подставит чужой
--     organization_id, база строк не вернёт.
-- Служебные операции до входа (вход по email, подтверждение, приглашение по ссылке) идут под
-- владельцем схемы в отдельном «системном» контексте сервера.

create extension if not exists citext;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'ceh_app') then
    create role ceh_app nologin;
  end if;
end $$;

-- Контекст запроса: задаётся сервером через set_config(..., true) в начале транзакции.
create function app_user_id() returns uuid language sql stable as
$$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
create function app_org_id() returns uuid language sql stable as
$$ select nullif(current_setting('app.org_id', true), '')::uuid $$;

-- ───────────────────────── Пользователи и вход ─────────────────────────

create table users (
  id               uuid primary key default gen_random_uuid(),
  email            citext not null unique,
  full_name        text not null,
  password_hash    text not null,
  email_verified_at timestamptz,
  status           text not null default 'active' check (status in ('active', 'disabled')),
  failed_logins    integer not null default 0,
  locked_until     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Одноразовые ссылки: подтверждение email, сброс пароля. В базе только хеш токена.
create table email_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id),
  purpose     text not null check (purpose in ('verify_email', 'reset_password')),
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create table sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id),
  token_hash   text not null unique,
  ip           text,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz
);
create index sessions_user_idx on sessions(user_id);

-- Ограничение попыток входа по адресу (ТЗ v2 §9: «ограничение попыток входа»).
create table login_attempts (
  id         bigserial primary key,
  ip         text not null,
  email      citext,
  success    boolean not null,
  created_at timestamptz not null default now()
);
create index login_attempts_ip_idx on login_attempts(ip, created_at);

-- Исходящие письма: адаптер отправки забирает их отсюда (повторная отправка без потерь).
create table outbox_emails (
  id         uuid primary key default gen_random_uuid(),
  to_email   citext not null,
  template   text not null,
  subject    text not null,
  body       text not null,
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  error      text
);

-- ───────────────────────── Организации, площадки, участники ─────────────────────────

create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  legal_form  text check (legal_form in ('ИП', 'ООО', 'АО', 'другое')),
  inn         text,
  phone       text,
  region      text,
  timezone    text not null default 'Europe/Moscow',
  currency    char(3) not null default 'RUB',
  -- ТЗ v1 §5: DRAFT до заполнения паспорта, CONFIGURED после проверки, COMPLIANCE_REVIEW после
  -- назначения нормативной проверки. Соответствие автоматически не выставляется.
  status      text not null default 'DRAFT' check (status in ('DRAFT', 'CONFIGURED', 'COMPLIANCE_REVIEW', 'ARCHIVED')),
  created_by  uuid not null references users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table sites (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name            text not null,
  address         text,
  timezone        text,
  status          text not null default 'active' check (status in ('active', 'archived')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index sites_org_idx on sites(organization_id);

-- Роль — код из src/server/access/roles.ts. site_ids пусто = все площадки организации.
create table memberships (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  user_id         uuid not null references users(id),
  role            text not null,
  site_ids        uuid[] not null default '{}',
  position        text,
  status          text not null default 'active' check (status in ('active', 'blocked')),
  created_at      timestamptz not null default now(),
  blocked_at      timestamptz,
  blocked_reason  text,
  unique (organization_id, user_id)
);
create index memberships_user_idx on memberships(user_id);

create table invitations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  email           citext not null,
  full_name       text,
  role            text not null,
  site_ids        uuid[] not null default '{}',
  position        text,
  token_hash      text not null unique,
  invited_by      uuid not null references users(id),
  expires_at      timestamptz not null,
  accepted_at     timestamptz,
  accepted_by     uuid references users(id),
  revoked_at      timestamptz,
  created_at      timestamptz not null default now()
);
create index invitations_org_idx on invitations(organization_id);

-- Активный участник организации. SECURITY DEFINER: политики других таблиц вызывают её без
-- рекурсии через политику memberships.
create function app_is_member(org uuid) returns boolean language sql stable security definer
set search_path = public as
$$ select exists (select 1 from memberships m where m.organization_id = org and m.user_id = app_user_id() and m.status = 'active') $$;

-- ───────────────────────── Аудит ─────────────────────────
-- ТЗ v1 §1.1, v2 AT-11: кто, когда, что, основание, результат. Только дописывание, цепочка
-- SHA-256 внутри организации: правка или удаление любой записи ломает проверку цепочки.

create table audit_events (
  id              bigserial primary key,
  organization_id uuid references organizations(id),
  site_id         uuid,
  actor_user_id   uuid references users(id),
  action          text not null,
  entity_type     text,
  entity_id       text,
  before          jsonb,
  after           jsonb,
  reason          text,
  result          text not null default 'success' check (result in ('success', 'denied', 'error')),
  ip              text,
  created_at      timestamptz not null default clock_timestamp(),
  prev_hash       text not null,
  hash            text not null
);
create index audit_org_idx on audit_events(organization_id, id);

create function audit_chain_payload(e audit_events) returns text language sql immutable as
$$ select concat_ws('|', e.prev_hash, coalesce(e.organization_id::text, ''), coalesce(e.site_id::text, ''),
     coalesce(e.actor_user_id::text, ''), e.action, coalesce(e.entity_type, ''), coalesce(e.entity_id, ''),
     coalesce(e.before::text, ''), coalesce(e.after::text, ''), coalesce(e.reason, ''), e.result,
     coalesce(e.ip, ''), to_char(e.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')) $$;

create function audit_events_chain() returns trigger language plpgsql security definer
set search_path = public as $$
declare last text;
begin
  -- Последовательная цепочка на организацию: блокировка на время транзакции.
  perform pg_advisory_xact_lock(hashtext('audit:' || coalesce(new.organization_id::text, 'platform')));
  select hash into last from audit_events
   where organization_id is not distinct from new.organization_id order by id desc limit 1;
  new.prev_hash := coalesce(last, 'GENESIS');
  new.created_at := clock_timestamp();
  new.hash := encode(sha256(convert_to(audit_chain_payload(new), 'UTF8')), 'hex');
  return new;
end $$;
create trigger audit_events_chain before insert on audit_events for each row execute function audit_events_chain();

create function audit_events_immutable() returns trigger language plpgsql as $$
begin raise exception 'Записи аудита нельзя изменять или удалять'; end $$;
create trigger audit_events_no_update before update or delete on audit_events for each row execute function audit_events_immutable();

-- ───────────────────────── Row-Level Security ─────────────────────────

alter table organizations enable row level security;
create policy org_member_read on organizations for select to ceh_app using (app_is_member(id));
create policy org_member_update on organizations for update to ceh_app
  using (id = app_org_id() and app_is_member(id)) with check (id = app_org_id());

alter table sites enable row level security;
create policy sites_tenant on sites for all to ceh_app
  using (organization_id = app_org_id() and app_is_member(organization_id))
  with check (organization_id = app_org_id() and app_is_member(organization_id));

alter table memberships enable row level security;
create policy memberships_own on memberships for select to ceh_app using (user_id = app_user_id());
create policy memberships_tenant on memberships for all to ceh_app
  using (organization_id = app_org_id() and app_is_member(organization_id))
  with check (organization_id = app_org_id() and app_is_member(organization_id));

alter table invitations enable row level security;
create policy invitations_tenant on invitations for all to ceh_app
  using (organization_id = app_org_id() and app_is_member(organization_id))
  with check (organization_id = app_org_id() and app_is_member(organization_id));

alter table users enable row level security;
create policy users_self on users for select to ceh_app using (id = app_user_id());
create policy users_colleagues on users for select to ceh_app using (
  app_org_id() is not null and app_is_member(app_org_id())
  and exists (select 1 from memberships m where m.user_id = users.id and m.organization_id = app_org_id()));
create policy users_self_update on users for update to ceh_app using (id = app_user_id()) with check (id = app_user_id());

alter table audit_events enable row level security;
create policy audit_tenant_read on audit_events for select to ceh_app
  using (organization_id = app_org_id() and app_is_member(organization_id));
create policy audit_insert on audit_events for insert to ceh_app
  with check ((organization_id = app_org_id() and app_is_member(organization_id))
              or (organization_id is null and actor_user_id = app_user_id()));

grant usage on schema public to ceh_app;
grant select, update (full_name, updated_at) on users to ceh_app;
grant select, update on organizations to ceh_app;
grant select, insert, update on sites, memberships, invitations to ceh_app;
grant select, insert on audit_events to ceh_app;
grant usage on sequence audit_events_id_seq to ceh_app;
-- sessions, email_tokens, login_attempts, outbox_emails — только системный контекст.
