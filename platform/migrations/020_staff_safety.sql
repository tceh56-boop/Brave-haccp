-- Этап 16: персонал — медицинский допуск, осмотр перед сменой, инструктажи и обучение (перенос Safety.gs /
-- EmployeeSafetyIntegration.gs прежнего ЦЕХ и допуска сотрудника MON CHEF).
--  * Медицинский допуск: номер ЛМК, даты медосмотра и гигиенической аттестации и сроки их действия — как в книжке;
--    диагнозы и результаты исследований не хранятся. Записи не меняются: новая заменяет прежнюю, история остаётся.
--    Режим допуска предприятия: «выкл.», «предупреждать», «блокировать» (без действующего допуска сотрудник
--    пищевой роли не вносит замеры, производство, пробы, приёмку, санитарию).
--  * Осмотр перед сменой (J07): допущен / не допущен с признаками и мерами; одна запись на сотрудника в день.
--  * Инструктажи: темы (охрана труда, санминимум, ХАССП) с материалом, периодичностью и ролями; проведение
--    (вид, дата, результат, инструктирующий) и подтверждение сотрудником.

create table staff_settings (
  organization_id uuid primary key references organizations(id),
  medical_gate    text not null default 'warn' check (medical_gate in ('off', 'warn', 'block')),
  updated_by      uuid not null references users(id),
  updated_at      timestamptz not null default now()
);

create table staff_medical (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  user_id         uuid not null references users(id),
  med_book_no     text,
  exam_on         date,
  exam_due        date not null,
  hygiene_on      date,
  hygiene_due     date not null,
  restrictions    text,
  recorded_by     uuid not null references users(id),
  recorded_at     timestamptz not null default now(),
  check (exam_on is null or exam_due > exam_on),
  check (hygiene_on is null or hygiene_due > hygiene_on)
);
create index staff_medical_user_idx on staff_medical(organization_id, user_id, recorded_at desc);

create table health_checks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid not null references sites(id),
  user_id         uuid not null references users(id),
  checked_on      date not null,
  admitted        boolean not null,
  signs           text,
  action          text,
  checked_by      uuid not null references users(id),
  checked_at      timestamptz not null default now(),
  unique (organization_id, user_id, checked_on),
  check (admitted or (signs is not null and action is not null))
);

create table briefing_topics (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  title           text not null,
  category        text not null check (category in ('safety', 'sanitary', 'haccp')),
  material        text not null,                    -- инструкция, программа, версия
  period_months   integer check (period_months is null or period_months between 1 and 60),
  roles           text[] not null default '{}',     -- кому обязательно; пусто — всем
  status          text not null default 'active' check (status in ('active', 'archived')),
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now()
);

create table briefings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  topic_id        uuid not null references briefing_topics(id),
  user_id         uuid not null references users(id),
  briefing_type   text not null check (briefing_type in ('intro', 'primary', 'repeat', 'unscheduled', 'target', 'training')),
  held_on         date not null,
  result          text not null check (result in ('passed', 'failed')),
  note            text,
  next_due        date,
  instructor_id   uuid not null references users(id),
  recorded_at     timestamptz not null default now(),
  check (result = 'passed' or note is not null)
);
create index briefings_user_idx on briefings(organization_id, user_id, topic_id, held_on desc);

create table briefing_acks (
  briefing_id     uuid primary key references briefings(id),
  organization_id uuid not null references organizations(id),
  user_id         uuid not null references users(id),
  acknowledged_at timestamptz not null default now()
);

create function staff_records_immutable() returns trigger language plpgsql as $$
begin raise exception 'Записи допуска, осмотров и инструктажей не изменяются и не удаляются'; end $$;
create trigger staff_medical_no_update before update or delete on staff_medical for each row execute function staff_records_immutable();
create trigger health_checks_no_update before update or delete on health_checks for each row execute function staff_records_immutable();
create trigger briefings_no_update before update or delete on briefings for each row execute function staff_records_immutable();
create trigger briefing_acks_no_update before update or delete on briefing_acks for each row execute function staff_records_immutable();

do $$
declare t text;
begin
  foreach t in array array['staff_settings', 'staff_medical', 'health_checks', 'briefing_topics', 'briefings', 'briefing_acks'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;

grant select, insert, update on staff_settings, briefing_topics to ceh_app;
grant select, insert on staff_medical, health_checks, briefings, briefing_acks to ceh_app;
