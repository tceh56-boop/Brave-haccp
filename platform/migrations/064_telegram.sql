-- Telegram-бот «ЦЕХ ИИ» (вариант А: уведомления в Telegram, как на Google Диске; плюс вопросы помощнику и сводка смены).
--  * Привязка: сотрудник получает в приложении одноразовый код (15 минут) и отправляет боту /start КОД.
--    Бот действует от имени этого сотрудника — с его ролью и правами, только в его организации.
--  * Доставка: уведомления ролей уходят привязанным сотрудникам; каждое — один раз (telegram_deliveries).
create table telegram_links (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  user_id         uuid not null references users(id),
  chat_id         bigint not null,
  username        text,
  linked_at       timestamptz not null default now(),
  revoked_at      timestamptz
);
create unique index telegram_links_chat on telegram_links(chat_id) where revoked_at is null;
create unique index telegram_links_member on telegram_links(organization_id, user_id) where revoked_at is null;

create table telegram_link_codes (
  code_hash       text primary key,              -- sha256 от кода
  organization_id uuid not null references organizations(id),
  user_id         uuid not null references users(id),
  expires_at      timestamptz not null,
  used_at         timestamptz,
  created_at      timestamptz not null default now()
);

create table telegram_deliveries (
  notification_id uuid not null references notifications(id),
  organization_id uuid not null references organizations(id),
  chat_id         bigint not null,
  sent_at         timestamptz not null default now(),
  error           text,
  primary key (notification_id, chat_id)
);

-- служебное состояние бота (смещение getUpdates) — не данные организаций
create table telegram_state (key text primary key, value text not null, updated_at timestamptz not null default now());

do $$
declare t text;
begin
  foreach t in array array['telegram_links', 'telegram_link_codes', 'telegram_deliveries'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;
grant select, insert, update on telegram_links, telegram_link_codes to ceh_app;
grant select on telegram_deliveries to ceh_app;
