-- ТЗ 3.0 §16.1: справочник средств — вид средства, изготовитель, действующее вещество, сроки годности концентрата и раствора,
-- меры безопасности, условия хранения; режимы применения по объектам обработки. Концентрация, экспозиция и способ —
-- только из инструкции конкретного средства; универсальных значений нет. Режим утверждает ответственный при приложенной инструкции.
alter table disinfectants
  add column agent_kind text check (agent_kind in ('disinfectant', 'detergent', 'antiseptic', 'combined')),   -- null — вид не указан
  add column manufacturer text,
  add column active_substance text,
  add column concentrate_shelf text,
  add column safety text,
  add column storage text;

create table disinfectant_regimes (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations(id),
  disinfectant_id    uuid not null references disinfectants(id),
  object             text not null,                      -- объект обработки, как в инструкции
  concentration_text text not null,                      -- как в источнике: «0,5%», «15-20%», «готовый раствор»
  concentration_min  numeric check (concentration_min is null or concentration_min between 0 and 100),
  concentration_max  numeric check (concentration_max is null or concentration_max between 0 and 100),
  exposure_text      text not null,                      -- «30 мин», «30 сек – 3 мин», «не требуется»
  exposure_min       numeric check (exposure_min is null or exposure_min >= 0),   -- минуты
  exposure_max       numeric check (exposure_max is null or exposure_max >= 0),
  method             text not null,
  consumption        text,                               -- норма расхода, как в источнике
  solution_shelf     text,                               -- срок годности рабочего раствора
  rinse_required     boolean,                            -- null — инструкция не говорит
  basis              text not null,                      -- инструкция: номер, дата, пункт
  status             text not null default 'draft' check (status in ('draft', 'approved', 'archived')),
  import_job_id      uuid,
  created_by         uuid not null references users(id),
  created_at         timestamptz not null default now(),
  approved_by        uuid references users(id),
  approved_at        timestamptz,
  check (concentration_min is null or concentration_max is null or concentration_min <= concentration_max),
  check (exposure_min is null or exposure_max is null or exposure_min <= exposure_max),
  check (status <> 'approved' or approved_by is not null)
);
create index disinfectant_regimes_agent_idx on disinfectant_regimes(disinfectant_id, status);

-- ТЗ 3.0 §7.5, §25.2: у каждого импорта — протокол (файл, строки, предупреждения, результат, кто подтвердил)
create table import_jobs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  kind            text not null,
  filename        text,
  file_sha256     text not null,
  rows_total      integer not null,
  result          jsonb not null,
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now()
);
create index import_jobs_org_idx on import_jobs(organization_id, kind, created_at desc);
alter table disinfectant_regimes add constraint disinfectant_regimes_job_fk foreign key (import_job_id) references import_jobs(id);

alter table sanitation_plans add column regime_id uuid references disinfectant_regimes(id);

alter table disinfectant_regimes enable row level security;
alter table import_jobs enable row level security;
create policy disinfectant_regimes_tenant on disinfectant_regimes for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id));
create policy import_jobs_tenant on import_jobs for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id));
grant select, insert, update on disinfectant_regimes to ceh_app;
grant select, insert on import_jobs to ceh_app;
