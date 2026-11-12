-- ЦЕХ — обработка сырья в ТТК (ГОСТ 31988-2012: отходы при холодной обработке, потери при тепловой).
--  * Способы обработки — справочник платформы (только названия, без процентов).
--  * Нормы отходов и потерь вносит организация по основанию: Сборник рецептур (таблица) или акт контрольной
--    проработки. Сезонные нормы (морковь до 1 января / с 1 января) — диапазоном дат. Система норм не придумывает.
--    Норма — черновик → утверждена (человек с правом ttk.approve) → архив; значения не меняются, только новой нормой.
--  * Строка ТТК: брутто → (холодная обработка) → нетто → (тепловая) → выход. Шаги — снимок процента и основания
--    на момент расчёта: изменение нормы не меняет утверждённые карты; черновики пересчитываются по решению человека
--    (выход строки сохраняется, брутто и нетто пересчитываются — как в Шеф Эксперте).

create table processing_methods (
  code     text primary key,
  name     text not null,
  kind     text not null check (kind in ('cold', 'thermal')),
  position integer not null
);
grant select on processing_methods to ceh_app;

insert into processing_methods (code, name, kind, position) values
  ('defrost', 'Размораживание', 'cold', 10), ('wash', 'Мойка', 'cold', 20), ('clean', 'Очистка', 'cold', 30), ('trim', 'Зачистка', 'cold', 40),
  ('debone', 'Обвалка, жиловка', 'cold', 50), ('gut', 'Разделка рыбы, потрошение', 'cold', 60), ('cut', 'Нарезка', 'cold', 70), ('soak', 'Замачивание', 'cold', 80),
  ('portion', 'Порционирование', 'cold', 90),
  ('boil', 'Варка', 'thermal', 110), ('poach', 'Припускание', 'thermal', 120), ('steam', 'Варка на пару', 'thermal', 130), ('blanch', 'Бланширование', 'thermal', 140),
  ('fry', 'Жарка основным способом', 'thermal', 150), ('deepfry', 'Жарка во фритюре', 'thermal', 160), ('grill', 'Жарка на гриле', 'thermal', 170),
  ('saute', 'Пассерование', 'thermal', 180), ('stew', 'Тушение', 'thermal', 190), ('bake', 'Запекание', 'thermal', 200), ('sousvide', 'Су-вид', 'thermal', 210),
  ('smoke', 'Копчение', 'thermal', 220);

create table processing_norms (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id),
  product_id       uuid not null references products(id),
  method_code      text not null references processing_methods(code),
  loss_pct         numeric not null check (loss_pct < 100 and loss_pct > -500),   -- отрицательное — привар (крупы, макароны)
  season_from      smallint check (season_from between 101 and 1231),             -- ММДД; пусто — круглый год
  season_to        smallint check (season_to between 101 and 1231),
  protein_loss_pct numeric check (protein_loss_pct between 0 and 100),             -- потери нутриентов (тепловая), если известны
  fat_loss_pct     numeric check (fat_loss_pct between 0 and 100),
  carbs_loss_pct   numeric check (carbs_loss_pct between 0 and 100),
  basis            text not null,
  note             text,
  is_default       boolean not null default false,                                 -- обработка по умолчанию: подставляется в новую строку ТТК
  status           text not null default 'draft' check (status in ('draft', 'approved', 'archived')),
  created_by       uuid not null references users(id),
  created_at       timestamptz not null default now(),
  approved_by      uuid references users(id),
  approved_at      timestamptz,
  archived_by      uuid references users(id),
  archived_at      timestamptz,
  archive_reason   text,
  check ((season_from is null) = (season_to is null)),
  check (status = 'draft' or status = 'archived' or (approved_by is not null and approved_at is not null))
);
create index processing_norms_idx on processing_norms(organization_id, product_id, method_code, status);

create function processing_norm_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Норма обработки не удаляется — переведите в архив'; end if;
  if old.status = 'archived' then raise exception 'Архивная норма не изменяется'; end if;
  if (new.product_id, new.method_code, new.loss_pct, new.season_from, new.season_to, new.protein_loss_pct, new.fat_loss_pct, new.carbs_loss_pct, new.basis)
     is distinct from (old.product_id, old.method_code, old.loss_pct, old.season_from, old.season_to, old.protein_loss_pct, old.fat_loss_pct, old.carbs_loss_pct, old.basis) then
    raise exception 'Значения нормы не изменяются — внесите новую норму';
  end if;
  if old.status = 'approved' and (new.status not in ('approved', 'archived') or (new.approved_by, new.approved_at) is distinct from (old.approved_by, old.approved_at)) then
    raise exception 'Утверждённая норма только переводится в архив'; end if;
  return new;
end $$;
create trigger processing_norms_guard before update or delete on processing_norms for each row execute function processing_norm_guard();

alter table ttk_lines add column ready numeric check (ready is null or ready >= 0);              -- выход после обработки
alter table ttk_lines add column in_yield boolean not null default true;   -- учитывать в выходе (соль, специи — нет; КБЖУ по ним не считается)
alter table ttk_lines add column calc_from text check (calc_from in ('brutto', 'netto', 'ready')); -- от чего считана цепочка

create table ttk_line_steps (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id),
  version_id       uuid not null references ttk_versions(id),
  line_id          uuid not null references ttk_lines(id) on delete cascade,
  position         integer not null,
  method_code      text not null references processing_methods(code),
  norm_id          uuid references processing_norms(id),
  loss_pct         numeric not null check (loss_pct < 100 and loss_pct > -500),
  protein_loss_pct numeric check (protein_loss_pct between 0 and 100),
  fat_loss_pct     numeric check (fat_loss_pct between 0 and 100),
  carbs_loss_pct   numeric check (carbs_loss_pct between 0 and 100),
  basis            text not null,
  unique (line_id, position)
);
create index ttk_line_steps_version_idx on ttk_line_steps(version_id);

-- шаги меняются только в черновике (по версии — строка при каскадном удалении уже удалена)
create function ttk_steps_locked() returns trigger language plpgsql as $$
declare st text;
begin
  select status into st from ttk_versions where id = coalesce(new.version_id, old.version_id);
  if st <> 'draft' then raise exception 'ТТК не в черновике — изменения вносятся новой версией'; end if;
  return coalesce(new, old);
end $$;
create trigger ttk_line_steps_lock before insert or update or delete on ttk_line_steps for each row execute function ttk_steps_locked();

do $$
declare t text;
begin
  foreach t in array array['processing_norms', 'ttk_line_steps'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;

grant select, insert, update on processing_norms to ceh_app;
grant select, insert, delete on ttk_line_steps to ceh_app;
