-- ЦЕХ — этап 4 ТЗ v2: реестр нормативных требований, применимость, версии, даты, проверка специалистом.
--
-- ТЗ v2 §7: для каждого требования — источник, вид/номер/издатель, официальный URL/файл, пункт, юрисдикция,
-- обязательность, область применения, процессы и продукты, даты публикации/начала/окончания действия,
-- переходные положения, редакция, даты последней и следующей проверки, проверивший, статус проверки,
-- доказательство и владелец актуализации. AI или сторонняя статья не могут сами присвоить «Действует».
-- AT-08: без даты начала действия, области применения и проверки специалистом редакция не активируется.
-- AT-09: новая редакция сохраняет историю, сравнивается с прежней и открывает задачи пересмотра процедур.

-- Нормативный профиль предприятия: по нему система предлагает применимость, решает специалист.
create table org_regulatory_profiles (
  organization_id uuid primary key references organizations(id),
  object_types    text[] not null default '{}',   -- restaurant, cafe, canteen, catering, delivery, school, …
  processes       text[] not null default '{}',   -- receiving, storage, cold_prep, thermal, cooling, serving, delivery, cleaning, staff, packaging
  product_groups  text[] not null default '{}',
  sales_modes     text[] not null default '{}',   -- hall, takeaway, delivery, catering
  updated_by      uuid references users(id),
  updated_at      timestamptz not null default now()
);

create table reg_sources (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  code            text not null,                   -- краткое обозначение: СанПиН 2.3/2.4.4282-26
  kind            text not null check (kind in ('СанПиН', 'ТР ТС', 'ФЗ', 'ГОСТ', 'МУК', 'Постановление', 'Приказ', 'Внутренний', 'Другое')),
  title           text not null,                   -- официальное название
  issuer          text,
  official_url    text,
  jurisdiction    text not null default 'РФ' check (jurisdiction in ('РФ', 'ЕАЭС', 'Субъект РФ', 'Организация')),
  binding         text not null default 'unknown' check (binding in ('mandatory', 'voluntary', 'methodological', 'unknown')),
  note            text,
  created_by      uuid references users(id),
  created_at      timestamptz not null default now(),
  unique (organization_id, code)
);

create table reg_source_versions (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organizations(id),
  source_id             uuid not null references reg_sources(id),
  edition               text not null,             -- редакция: «ред. от …», «первоначальная»
  published_at          date,
  effective_from        date,
  effective_to          date,
  transitional          text,                      -- переходные положения
  file_ref              text,                      -- официальный файл/URL редакции
  -- Порядок работы: Проект → Требует проверки → Проверен специалистом → Утверждён для применения.
  -- «Скоро вступает в силу» / «Действует» / «Утратил силу» вычисляются из дат утверждённой редакции.
  workflow_status       text not null default 'needs_review'
                        check (workflow_status in ('draft', 'needs_review', 'checked', 'approved', 'suspended', 'archived')),
  check_evidence        text,                      -- где и как сверено (официальный текст, номер публикации)
  last_checked_at       timestamptz,
  checked_by            uuid references users(id),
  next_check_at         date,
  approved_by           uuid references users(id),
  approved_at           timestamptz,
  owner_user_id         uuid references users(id), -- владелец актуализации
  supersedes_version_id uuid references reg_source_versions(id),
  data_origin           text,                      -- откуда данные: «ТЗ v2 §8 — требует сверки», ввод специалиста
  created_by            uuid references users(id),
  created_at            timestamptz not null default now(),
  check (effective_to is null or effective_from is null or effective_to > effective_from),
  check (workflow_status not in ('checked', 'approved') or (last_checked_at is not null and checked_by is not null and check_evidence is not null)),
  check (workflow_status <> 'approved' or (effective_from is not null and approved_by is not null and owner_user_id is not null and next_check_at is not null))
);
create index reg_versions_source_idx on reg_source_versions(source_id, created_at);

create table reg_requirements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  version_id      uuid not null references reg_source_versions(id),
  clause          text not null,                   -- пункт: «п. 2.5», «ст. 10 ч. 3»
  text            text not null,                   -- формулировка из официального текста
  scope           text not null,                   -- область применения
  object_types    text[] not null default '{}',
  processes       text[] not null default '{}',
  product_groups  text[] not null default '{}',
  created_by      uuid references users(id),
  created_at      timestamptz not null default now(),
  unique (version_id, clause)
);

-- Решение о применимости требования к предприятию (нормативный профиль). Предложение системы ≠ решение.
create table reg_applicability (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  requirement_id  uuid not null references reg_requirements(id),
  applicable      boolean not null,
  rationale       text not null,
  decided_by      uuid not null references users(id),
  decided_at      timestamptz not null default now(),
  unique (requirement_id)
);

-- Связь требование → контрольная процедура (правило контроля) → журнал/запись.
alter table control_rules add column requirement_id uuid references reg_requirements(id);

-- Пересмотр при новой редакции: сравнение пунктов и задачи на пересмотр связанных процедур.
create table reg_reviews (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  old_version_id  uuid not null references reg_source_versions(id),
  new_version_id  uuid not null references reg_source_versions(id),
  diff            jsonb not null,                  -- { added: [...], removed: [...], changed: [...] }
  affected_rules  integer not null default 0,
  created_by      uuid references users(id),
  created_at      timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['org_regulatory_profiles', 'reg_sources', 'reg_source_versions', 'reg_requirements', 'reg_applicability', 'reg_reviews'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;

grant select, insert, update on org_regulatory_profiles, reg_sources, reg_source_versions, reg_requirements, reg_applicability to ceh_app;
grant select, insert on reg_reviews to ceh_app;
