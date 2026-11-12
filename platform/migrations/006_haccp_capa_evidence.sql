-- ЦЕХ — этап 5 ТЗ v2 (часть 2): план ХАССП, CAPA, доказательства.
--
-- ТЗ v1 §10: описание процесса с подтверждением на месте; анализ биологических, химических, физических и иных
-- опасностей по этапам; PRP/OPRP/CCP назначаются по анализу опасностей, не автоматически; план мониторинга:
-- что, где, как, частота, предел, прибор, ответственный, запись и реакция. Утверждённая версия плана не правится —
-- изменения идут новой версией. ТЗ v2 §12: отклонение → CAPA и проверка эффективности; доказательства неизменяемы.

create table haccp_plans (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  version         integer not null,
  status          text not null default 'draft' check (status in ('draft', 'approved', 'superseded')),
  scope           text not null,                      -- продукция, процессы, площадки
  team            text,                               -- группа ХАССП
  based_on_id     uuid references haccp_plans(id),
  change_reason   text,
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  approved_by     uuid references users(id),
  approved_at     timestamptz,
  approval_note   text,
  unique (organization_id, version),
  check (status = 'draft' or (approved_by is not null and approved_at is not null)),
  check (version = 1 or change_reason is not null)
);
create unique index haccp_plans_one_draft on haccp_plans(organization_id) where status = 'draft';
create unique index haccp_plans_one_approved on haccp_plans(organization_id) where status = 'approved';

create table haccp_steps (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  plan_id           uuid not null references haccp_plans(id),
  position          integer not null,
  name              text not null,
  description       text,
  confirmed_by      uuid references users(id),        -- технологическая схема подтверждена на месте
  confirmed_at      timestamptz,
  confirmation_note text
);

create table haccp_hazards (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id),
  plan_id          uuid not null references haccp_plans(id),
  step_id          uuid not null references haccp_steps(id),
  code             text not null,                     -- О-01, О-02 … в пределах плана
  hazard_type      text not null check (hazard_type in ('biological', 'chemical', 'physical', 'allergen', 'radiological', 'other')),
  description      text not null,
  requirement_id   uuid references reg_requirements(id),
  likelihood       smallint check (likelihood between 1 and 3),   -- оценивает человек; неизвестно ≠ 0
  severity         smallint check (severity between 1 and 3),
  control_measures text,
  answers          jsonb not null default '{}',        -- ответы на вопросы дерева решений
  proposal         text check (proposal in ('ccp', 'not_ccp', 'modify_step')),
  class            text check (class in ('prp', 'oprp', 'ccp')),
  class_rationale  text,
  classified_by    uuid references users(id),
  classified_at    timestamptz,
  check (class is null or (class_rationale is not null and classified_by is not null))
);

create table haccp_monitoring (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  plan_id           uuid not null references haccp_plans(id),
  hazard_id         uuid not null references haccp_hazards(id),
  what              text not null,
  where_text        text,
  method            text not null,
  frequency         text not null,
  critical_limit    text,
  device            text,
  responsible_role  text not null,
  record_form       text check (record_form is null or record_form ~ '^J\d{2}$'),
  corrective_action text not null,
  control_rule_id   uuid references control_rules(id),
  unique (hazard_id)
);

-- Утверждённый и заменённый план не меняется: изменения — новой версией.
create function haccp_locked() returns trigger language plpgsql as $$
declare st text;
begin
  select status into st from haccp_plans where id = coalesce(new.plan_id, old.plan_id);
  if st <> 'draft' then raise exception 'План ХАССП утверждён — изменения вносятся новой версией'; end if;
  return coalesce(new, old);
end $$;
create trigger haccp_steps_lock before insert or update or delete on haccp_steps for each row execute function haccp_locked();
create trigger haccp_hazards_lock before insert or update or delete on haccp_hazards for each row execute function haccp_locked();
create trigger haccp_monitoring_lock before insert or update or delete on haccp_monitoring for each row execute function haccp_locked();

create function haccp_plan_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'План ХАССП не удаляется'; end if;
  if old.status = 'superseded' or (old.status = 'approved' and (new.status <> 'superseded' or new.scope is distinct from old.scope or new.team is distinct from old.team)) then
    raise exception 'План ХАССП утверждён — изменения вносятся новой версией';
  end if;
  return new;
end $$;
create trigger haccp_plans_guard before update or delete on haccp_plans for each row execute function haccp_plan_guard();

-- CAPA: корректирующие и предупреждающие действия с проверкой эффективности.
create table capas (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references organizations(id),
  site_id                uuid references sites(id),
  incident_id            uuid references incidents(id),
  title                  text not null,
  problem                text not null,
  risk                   text,
  root_cause             text,
  corrective_action      text,
  preventive_action      text,
  effectiveness_criterion text,
  responsible_user_id    uuid references users(id),
  due_at                 date,
  check_due_at           date,                 -- когда проверять эффективность
  status                 text not null default 'open' check (status in ('open', 'in_progress', 'verification', 'closed')),
  done_note              text,
  done_by                uuid references users(id),
  done_at                timestamptz,
  verified_by            uuid references users(id),
  verified_at            timestamptz,
  verification_note      text,
  created_by             uuid references users(id),
  created_at             timestamptz not null default now(),
  check (status in ('open', 'in_progress') or (root_cause is not null and corrective_action is not null and effectiveness_criterion is not null and done_at is not null)),
  check (status <> 'closed' or (verified_by is not null and verified_at is not null and verified_by <> done_by))
);
create unique index capas_incident_uniq on capas(incident_id) where incident_id is not null;

create table capa_events (
  id              bigserial primary key,
  organization_id uuid not null references organizations(id),
  capa_id         uuid not null references capas(id),
  user_id         uuid references users(id),
  event           text not null,
  note            text,
  at              timestamptz not null default now()
);

-- Доказательства: файл неизменяем, хранится с хешем; к записи — только добавлять.
create table evidence_files (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid references sites(id),
  entity_type     text not null,
  entity_id       uuid not null,
  filename        text not null,
  mime            text not null,
  size_bytes      integer not null check (size_bytes > 0),
  sha256          text not null,
  content         bytea not null,
  note            text,
  uploaded_by     uuid not null references users(id),
  uploaded_at     timestamptz not null default now()
);
create index evidence_entity_idx on evidence_files(organization_id, entity_type, entity_id);

create function evidence_immutable() returns trigger language plpgsql as $$
begin raise exception 'Доказательство нельзя изменить или удалить'; end $$;
create trigger evidence_no_update before update or delete on evidence_files for each row execute function evidence_immutable();
create function capa_events_immutable() returns trigger language plpgsql as $$
begin raise exception 'История CAPA не изменяется'; end $$;
create trigger capa_events_no_update before update or delete on capa_events for each row execute function capa_events_immutable();

do $$
declare t text;
begin
  foreach t in array array['haccp_plans', 'haccp_steps', 'haccp_hazards', 'haccp_monitoring', 'capas', 'capa_events', 'evidence_files'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;

grant select, insert, update on haccp_plans, capas to ceh_app;
grant select, insert, update, delete on haccp_steps, haccp_hazards, haccp_monitoring to ceh_app;
grant select, insert on capa_events, evidence_files to ceh_app;
grant usage on sequence capa_events_id_seq to ceh_app;
