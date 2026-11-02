-- ЦЕХ — декларирование соответствия пищевой продукции собственного изготовления.
-- Основания: ТР ТС 021/2011 ст. 21–23; ТР ТС 034/2013 п. 4, 132–142; решение Коллегии ЕЭК от 25.12.2012 N 293 (единая форма
-- и правила оформления); решение Совета ЕЭК от 18.04.2018 N 44 (типовые схемы); приказ Минэкономразвития России от 31.07.2020
-- N 478 (порядок регистрации). Система готовит проект и комплект документов; принимает декларацию заявитель, регистрирует —
-- Росаккредитация в ФГИС с УКЭП заявителя. Принятый текст и сведения о регистрации не изменяются.

-- Реквизиты заявителя для поля 3 и 4 формы (решение N 293, разд. II п. 5 пп. «в», «г»; приказ N 478 п. 7.1 «а», п. 7.2, п. 12).
alter table organizations
  add column ogrn text,
  add column legal_address text,
  add column email text,
  add column head_position text,
  add column head_name text,
  add column head_basis text,
  add column activity_notice text;
alter table organizations add constraint organizations_ogrn_check check (ogrn is null or ogrn ~ '^[0-9]{13}$|^[0-9]{15}$');

-- Вид сырья для ТР ТС 034/2013 п. 4 «в», «е»: продукты убоя, мясо птицы, не мясное. Не указано — неизвестно (не «не мясо»).
alter table products add column meat_kind text check (meat_kind in ('slaughter', 'poultry', 'none'));

create table declarations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id uuid not null references sites(id),
  number integer not null,
  dish_id uuid not null references dishes(id),
  input jsonb not null default '{}'::jsonb,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references users(id),
  updated_at timestamptz not null default now(),
  unique (organization_id, number)
);

-- Принятие заявителем (поле 10): неизменяемый снимок полей формы, хеш.
create table declaration_acceptances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  declaration_id uuid not null unique references declarations(id),
  snapshot jsonb not null,
  content_hash text not null,
  generator_version text not null default 'ceh-2026.11',
  accepted_by uuid not null references users(id),
  accepted_at timestamptz not null default now()
);
create trigger declaration_acceptances_hash before insert on declaration_acceptances for each row execute function set_content_hash();
create trigger declaration_acceptances_no_update before update or delete on declaration_acceptances for each row execute function tech_data_immutable();

-- Регистрация в едином реестре (поля 11–12): номер и дата из ФГИС Росаккредитации, вносятся один раз.
create table declaration_registrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  declaration_id uuid not null unique references declarations(id),
  reg_number text not null,
  reg_date date not null,
  valid_to date,
  registered_by uuid not null references users(id),
  registered_at timestamptz not null default now(),
  unique (organization_id, reg_number)
);
create trigger declaration_registrations_no_update before update or delete on declaration_registrations for each row execute function tech_data_immutable();

-- Прекращение действия (решение заявителя, напр. отмена сертификата СМ при 6д — решение N 44 п. 33).
create table declaration_terminations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  declaration_id uuid not null unique references declarations(id),
  terminated_on date not null,
  reason text not null,
  terminated_by uuid not null references users(id),
  terminated_at timestamptz not null default now()
);
create trigger declaration_terminations_no_update before update or delete on declaration_terminations for each row execute function tech_data_immutable();

-- Проект редактируется только до принятия.
create function declarations_draft_only() returns trigger language plpgsql as $$
begin
  if exists (select 1 from declaration_acceptances a where a.declaration_id = old.id) then
    raise exception 'Декларация принята заявителем — текст не изменяется (решение ЕЭК N 293, разд. II п. 7). Оформите новую декларацию.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger declarations_draft_only before update or delete on declarations for each row execute function declarations_draft_only();

do $$
declare t text;
begin
  foreach t in array array['declarations', 'declaration_acceptances', 'declaration_registrations', 'declaration_terminations'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;

grant select, insert, update, delete on declarations to ceh_app;
grant select, insert on declaration_acceptances, declaration_registrations, declaration_terminations to ceh_app;
