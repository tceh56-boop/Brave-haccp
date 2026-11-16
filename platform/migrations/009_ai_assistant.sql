-- ЦЕХ — этап 7 ТЗ v2: AI-помощник с цитированием и подтверждением человеком.
--
-- ТЗ v2 §11: каждая нормативная рекомендация — с источником, пунктом, редакцией и датой проверки (AT-07).
-- AI не выдумывает нормы, сроки, температуры и измерения; не утверждает и не закрывает; предлагает — решает человек.
-- Хранится AI-задача: входные данные, модель/версия, версия инструкции, источники, ответ, кто принял решение, итог.

create table ai_jobs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  user_id         uuid not null references users(id),
  kind            text not null check (kind in ('incident_explain', 'question', 'capa_suggest')),
  entity_type     text,
  entity_id       uuid,
  question        text,
  context         jsonb not null,               -- снимок данных, переданных модели
  sources         jsonb not null default '[]',  -- снимок требований: источник, пункт, редакция, дата проверки, текст
  provider        text not null,                -- anthropic | none
  model           text,
  prompt_version  text not null,
  status          text not null check (status in ('ok', 'guard_rejected', 'no_sources', 'unavailable', 'refused', 'error')),
  answer          jsonb,
  guard           jsonb not null default '{}',  -- проверка ответа: ссылки, числа без источника
  usage           jsonb,
  latency_ms      integer,
  error           text,
  created_at      timestamptz not null default now()
);
create index ai_jobs_org_idx on ai_jobs(organization_id, created_at desc);

create table ai_decisions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  job_id          uuid not null references ai_jobs(id),
  item_index      integer,                      -- номер предложенного действия; null — оценка ответа целиком
  decision        text not null check (decision in ('task_created', 'rejected', 'helpful', 'not_helpful')),
  note            text,
  task_id         uuid references tasks(id),
  user_id         uuid not null references users(id),
  created_at      timestamptz not null default now(),
  check (decision <> 'rejected' or note is not null)
);
create unique index ai_decisions_item_uniq on ai_decisions(job_id, item_index) where item_index is not null;

create function ai_immutable() returns trigger language plpgsql as $$
begin raise exception 'Журнал AI не изменяется и не удаляется'; end $$;
create trigger ai_jobs_no_update before update or delete on ai_jobs for each row execute function ai_immutable();
create trigger ai_decisions_no_update before update or delete on ai_decisions for each row execute function ai_immutable();

do $$
declare t text;
begin
  foreach t in array array['ai_jobs', 'ai_decisions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;

grant select, insert on ai_jobs, ai_decisions to ceh_app;
