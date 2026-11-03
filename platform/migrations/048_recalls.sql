-- ТЗ 3.0 §10.5, сценарий 4 §29.2: блокировка партии при опасности и отзыв. Блокируются исходная партия и все дочерние
-- (вскрытие, перемещение, производство) с остатком; решение принимает ответственный. Прежний статус каждой партии
-- сохраняется, чтобы при решении «вернуть в оборот» восстановить ровно его.
create table recalls (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  root_lot_id     uuid not null references lots(id),
  hazard          text not null,                       -- какая опасность обнаружена
  source          text not null,                       -- откуда сведения: лаборатория, поставщик, Роспотребнадзор, жалоба, внутренний контроль
  status          text not null default 'open' check (status in ('open', 'decided')),
  opened_by       uuid not null references users(id),
  opened_at       timestamptz not null default now(),
  decision        text check (decision in ('release', 'write_off')),
  decision_note   text,
  decided_by      uuid references users(id),
  decided_at      timestamptz,
  affected        jsonb not null,                      -- снимок затронутого на момент блокировки
  check (status = 'open' or (decision is not null and decided_by is not null and decision_note is not null))
);
create index recalls_org_idx on recalls(organization_id, status, opened_at desc);

create table recall_lots (
  recall_id       uuid not null references recalls(id),
  lot_id          uuid not null references lots(id),
  organization_id uuid not null references organizations(id),
  prev_status     text not null,
  prev_reason     text,
  quantity        numeric not null,                    -- остаток на момент блокировки
  primary key (recall_id, lot_id)
);
create index recall_lots_lot_idx on recall_lots(lot_id);

alter table recalls enable row level security;
alter table recall_lots enable row level security;
create policy recalls_tenant on recalls for all to ceh_app
  using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id));
create policy recall_lots_tenant on recall_lots for all to ceh_app
  using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id));
grant select, insert, update on recalls to ceh_app;
grant select, insert on recall_lots to ceh_app;
