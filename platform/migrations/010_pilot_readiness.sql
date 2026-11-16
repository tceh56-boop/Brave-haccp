-- ЦЕХ — этап 8 ТЗ v2: пилот, резервное копирование и проверенное восстановление, Go/No-Go.
--
-- AT-16: резервная копия и восстановление проверены; критический провал безопасности или целостности блокирует запуск.
-- Ручные подтверждения — то, что система проверить не может: сверка нормативных текстов (Б-4), ответственный и
-- политика по персональным данным (Б-6, AT-15), проверка первичных документов бухгалтером и юристом (Б-7, AT-14),
-- обучение персонала. Решение Go/No-Go хранит снимок проверок и не меняется.

-- Служебный журнал резервных копий (уровень системы, без доступа роли приложения).
create table system_backups (
  id           uuid primary key default gen_random_uuid(),
  file         text not null,
  sha256       text not null,
  size_bytes   bigint not null,
  manifest     jsonb not null,
  created_at   timestamptz not null default now(),
  verified_at  timestamptz,
  verify_ok    boolean,
  verify_report jsonb
);

create table pilot_confirmations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  key             text not null,
  confirmed       boolean not null,              -- false — отзыв подтверждения
  evidence        text not null,                 -- кем, каким документом подтверждено
  user_id         uuid not null references users(id),
  created_at      timestamptz not null default now()
);
create index pilot_confirmations_idx on pilot_confirmations(organization_id, key, created_at desc);

create table pilot_decisions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid references sites(id),
  decision        text not null check (decision in ('go', 'no_go')),
  note            text not null,
  checks          jsonb not null,                -- снимок проверок на момент решения
  user_id         uuid not null references users(id),
  created_at      timestamptz not null default now()
);

create function pilot_immutable() returns trigger language plpgsql as $$
begin raise exception 'Подтверждения и решения пилота не изменяются — внесите новую запись'; end $$;
create trigger pilot_confirmations_no_update before update or delete on pilot_confirmations for each row execute function pilot_immutable();
create trigger pilot_decisions_no_update before update or delete on pilot_decisions for each row execute function pilot_immutable();

do $$
declare t text;
begin
  foreach t in array array['pilot_confirmations', 'pilot_decisions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;

grant select, insert on pilot_confirmations, pilot_decisions to ceh_app;
