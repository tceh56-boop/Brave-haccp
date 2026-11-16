-- ЦЕХ — ТЗ доработки 5.4: ТУ подтверждаются протоколами испытаний аккредитованной лаборатории.
-- Реестр лабораторий (аттестат и область аккредитации — со слов документов лаборатории, сверка — по реестру Росаккредитации);
-- протокол связан с лабораторией и с образцом (номер образца в протоколе, партия или блюдо); утверждённые ТУ хранят
-- ссылки на протоколы, версии ППК и плана ХАССП на дату утверждения и запись листа регистрации изменений.

create table laboratories (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  name              text not null,
  accreditation_no  text not null,                 -- номер аттестата / записи в реестре аккредитованных лиц (RA.RU.…)
  accredited_on     date,
  scope             text not null,                 -- область аккредитации: объекты и показатели (как в документе)
  scope_checked     text,                          -- как сверено: реестр Росаккредитации, дата
  address           text,
  status            text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  created_by        uuid not null references users(id),
  created_at        timestamptz not null default now(),
  updated_by        uuid references users(id),
  updated_at        timestamptz not null default now(),
  unique (organization_id, accreditation_no)
);
alter table laboratories enable row level security;
create policy laboratories_tenant on laboratories for all to ceh_app
  using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id));
grant select, insert, update on laboratories to ceh_app;

alter table lab_results add column laboratory_id uuid references laboratories(id);
alter table lab_results add column sample_ref text;            -- номер / шифр образца в протоколе

alter table tech_spec_versions add column lab_result_ids uuid[] not null default '{}';
alter table tech_spec_versions add column ppk_version integer;
alter table tech_spec_versions add column haccp_version integer;
alter table tech_spec_versions add column change_note text;
