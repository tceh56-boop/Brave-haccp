-- Вход на кухне по PIN (перенос из версии на Google Диске: выбрать себя → PIN, сессия 12 ч, лестница блокировок).
-- Безопаснее, чем было: PIN принимается только на устройстве, которое владелец привязал к площадке («кухонный планшет»);
-- с других устройств по PIN не войти. Сессия по PIN действует только в этой организации и закрывается при отвязке устройства.
create table kiosk_devices (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid not null references sites(id),
  name            text not null,
  token_hash      text not null unique,          -- sha256 от токена в cookie устройства
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz,
  revoked_at      timestamptz,
  revoked_by      uuid references users(id)
);
create index kiosk_devices_org_idx on kiosk_devices(organization_id) where revoked_at is null;

create table member_pins (
  organization_id uuid not null references organizations(id),
  user_id         uuid not null references users(id),
  pin_hash        text not null,                 -- scrypt, как пароль
  failed          integer not null default 0,
  lock_level      integer not null default 0,    -- 0 → 15 мин, 1 → 1 ч, 2+ → 4 ч
  locked_until    timestamptz,
  set_at          timestamptz not null default now(),
  primary key (organization_id, user_id)
);

alter table sessions
  add column organization_id uuid references organizations(id),   -- сессия по PIN — только в этой организации
  add column kiosk_device_id uuid references kiosk_devices(id);

do $$
declare t text;
begin
  foreach t in array array['kiosk_devices', 'member_pins'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;
grant select, insert, update on kiosk_devices, member_pins to ceh_app;
grant delete on member_pins to ceh_app;
